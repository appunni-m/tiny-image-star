import {
  addNode, addVariableMode, addCommentReply, alignLayers, applyColorStyle, bindColorVariable, bindVariable, canAlignLayers, canBindVariable, applyImageRecipe, canCombineBoolean, canGroupLayers, canUngroupLayers, cloneDocument, combineBoolean, createColorStyle, createColorVariable, createVariable, createComponent, createComponentInstance, createComponentSet, createCommentThread,
  createDocument, createExportSetting, createId, createImageRecipe, createLayoutGuide, createLayerEffect, createNode, createVariableCollection, deleteVariable, deleteVariableCollection, detachComponentInstance, duplicateNode, findNode,
  findNodeAcrossPages, getActivePage, getNodeColor, getNodePropertyValue, parseDocument, removeNode, resolveVariableValue, serializeDocument, setColorVariableValue, setVariableAlias, setVariableValue, setComponentVariantProperty, setFrameVariableMode, variableModeForNode,
  canCreateMaskGroup, createMaskGroup, groupLayers, releaseMaskGroup, removeCommentThread, setCommentResolved, separateBoolean, switchComponentInstanceVariant, syncAllComponentInstances, ungroupLayers,
  updateNode, walkNodes
} from './model.js';
import { History } from './history.js';
import { SceneRenderer, hitTestPage, screenToWorld, worldToScreen } from './renderer.js';
import { calculateTextBox } from './text-layout.js';
import { LocalImageEngine } from './image-engine.js';
import { downloadLocalPackage, loadImageAsset, loadLatestDocument, saveDocument, saveImageAsset, saveImageAssetBytes, unpackLocalPackage } from './storage.js';
import { icon } from './icons.js';
import { applyAutoLayout, createAutoLayout } from './layout-engine.js';
import { interpolateSmartFrame } from './smart-animate.js';
import { buildInspectOutput } from './inspect.js';
import { addPrototypeInteraction, applyPrototypeInteraction, backPrototypeSession, createPrototypeSession, easePrototypeProgress, findClickableInteraction, findFrameAtPoint, getPrototypeStartFrame, listPrototypeFrames, prototypeEasingTimingFunction, removePrototypeInteraction, setPrototypeStartPoint } from './prototype.js';
import { applyFrameConstraints, captureChildGeometry, horizontalConstraints, verticalConstraints } from './constraints.js';
import {
  appendVectorNetworkPath, closestVectorNetworkEdge, closestVectorSegment, insertVectorNetworkPoint, insertVectorNodePoint,
  longestVectorNetworkEdge, longestVectorSegment, removeVectorNetworkVertex, removeVectorNodePoint,
  setVectorNetworkEdgeControlPoint, setVectorNetworkVertexPoint, setVectorNodePoint, vectorGeometryFromAnchors,
  vectorNetworkEdgePoints, vectorNetworkGeometryFromAnchors, vectorNetworkVertexPoint, vectorNodePoint
} from './vector-path.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const CPU_LIMIT = Math.min(8, Math.max(1, navigator.hardwareConcurrency || 4));
const state = {
  document: createDocument(), selectedIds: [], selectedVectorPoint: null, tool: 'select', zoom: 1, panX: 0, panY: 0,
  assets: new Map(), previews: new Map(), previewUrls: new Map(), imageStatus: new Map(), renderVersion: new Map(),
  draftNode: null, penDraft: null, penHover: null, marquee: null, interaction: null, pointerMap: new Map(),
  sidebarTab: 'layers', inspectorTab: 'design', clipboard: [], controlEdit: false,
  bulk: null, textNodeId: null, spaceDown: false, ready: false, layerSearch: '', showLayoutGuides: true, outlineMode: false,
  statusTimer: null, saveTimer: null, lastLayerSelection: null,
  pendingVariableDialog: null, pendingCommentAnchor: null, activeCommentId: null,
  layoutGuideControlEdit: false,
  prototypeSourceId: null, prototypeAction: 'navigate', prototypeTrigger: 'on-click', prototypeTransition: 'instant', prototypeEasing: 'ease-in-out', prototypeDuration: 300,
  prototypeOverlayPosition: 'center', prototypeOverlayOutsideClick: true, prototypeOverlayBackground: true,
  prototypeOverlayBackgroundColor: '#000000', prototypeOverlayBackgroundOpacity: 0.32,
  presenting: null
};
const history = new History(120);
const canvas = $('#scene-canvas');
const canvasScroll = $('#canvas-scroll');
let renderer;
let pendingRecipeNodeId = null;
let latestPageLayerIds = [];
let currentToastTimer = 0;
let presentationAnimationFrame = 0;
const imageEngine = new LocalImageEngine({ maxWorkers: CPU_LIMIT, onChange: updateImageEngineState });
const previewTimers = new Map();
let presentRenderer = null;
let presentRenderState = null;
let textMeasureContext = null;

function activePage() { return getActivePage(state.document); }
function selectedEntries() { return state.selectedIds.map(id => findNode(state.document, id)).filter(Boolean); }
function selectedNodes() { return selectedEntries().map(entry => entry.node); }
function componentInstanceRoot(nodeId) {
  const entry = findNode(state.document, nodeId);
  if (!entry) return null;
  return [...entry.parents, entry.node].reverse().find(node => node.isInstance) || null;
}
function recordComponentOverride(instanceRoot, node, property) {
  if (!instanceRoot || !node.componentSourceId) return;
  const key = property.split('.')[0];
  if (node.id === instanceRoot.id && (key === 'x' || key === 'y')) return;
  instanceRoot.componentOverrides ||= {};
  instanceRoot.componentOverrides[node.componentSourceId] ||= {};
  instanceRoot.componentOverrides[node.componentSourceId][key] = structuredClone(node[key]);
}
function recordNodeComponentOverrides(node, properties) {
  const instanceRoot = componentInstanceRoot(node.id);
  for (const property of properties) recordComponentOverride(instanceRoot, node, property);
}
function setNodePropertyValue(node, property, value) {
  const variableId = node.variableBindings?.[property];
  if (!variableId) { node[property] = value; return true; }
  const variable = state.document.variables?.find(item => item.id === variableId);
  if (!variable) return false;
  const modeId = variableModeForNode(state.document, variable.collectionId, node);
  return setVariableValue(state.document, variableId, value, modeId);
}
function imageNodes(page = activePage()) {
  const nodes = [];
  if (page) walkNodes(page.children, ({ node }) => { if (node.type === 'image') nodes.push(node); });
  return nodes;
}
function rootSelectedIds() {
  const selected = new Set(state.selectedIds);
  return selectedEntries().filter(entry => !entry.parents.some(parent => selected.has(parent.id))).map(entry => entry.node.id);
}
function setSaveState(kind, text) {
  const element = $('#save-state');
  element.classList.toggle('is-saving', kind === 'saving');
  element.classList.toggle('is-error', kind === 'error');
  element.lastElementChild.textContent = text;
}
function queueSave() {
  if (!state.ready) return;
  if (syncAllComponentInstances(state.document)) {
    renderLayers();
    renderer?.invalidate();
  }
  setSaveState('saving', 'Saving locally…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      await saveDocument(JSON.parse(serializeDocument(state.document)));
      setSaveState('saved', 'Saved locally');
    } catch (error) {
      setSaveState('error', 'Could not save');
      showToast(error.message || 'Could not save this design locally.');
    }
  }, 260);
}
function checkpoint(label) { history.checkpoint(state.document, label); }
function setSelection(ids, { keepInspector = false } = {}) {
  const valid = ids.filter(id => findNode(state.document, id));
  state.selectedIds = [...new Set(valid)];
  if (state.selectedVectorPoint && (state.selectedIds.length !== 1 || state.selectedIds[0] !== state.selectedVectorPoint.nodeId)) state.selectedVectorPoint = null;
  renderLayers();
  if (!keepInspector) renderInspector();
  updateSelectionStatus();
  renderer?.invalidate();
}
function updateSelectionStatus() {
  const nodes = selectedNodes();
  $('#selection-status').textContent = nodes.length === 0 ? `Tool · ${state.tool}` : nodes.length === 1 ? `${nodes[0].name} · ${nodes[0].type}` : `${nodes.length} layers selected`;
  if (nodes.length === 1) $('#position-status').textContent = `${Math.round(nodes[0].x)}, ${Math.round(nodes[0].y)} · ${Math.round(nodes[0].width)} × ${Math.round(nodes[0].height)}`;
  else $('#position-status').textContent = `${Math.round(state.zoom * 100)}%`;
}
function showToast(message, duration = 2500) {
  const region = $('#toast-region');
  region.replaceChildren();
  const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message;
  region.append(toast);
  clearTimeout(currentToastTimer);
  currentToastTimer = setTimeout(() => toast.remove(), duration);
}
function setTool(tool) {
  if (state.penDraft && tool !== 'pen' && !finishPenPath(false, { selectAfter: false })) cancelPenPath();
  if (tool !== 'comment' && state.pendingCommentAnchor) state.pendingCommentAnchor = null;
  state.tool = tool;
  $$('.tool-button').forEach(button => button.classList.toggle('is-selected', button.dataset.tool === tool));
  canvas.className = `tool-${tool}`;
  updateSelectionStatus();
  renderInspector();
}

function renderPageList() {
  const list = $('#pages-list'); list.replaceChildren();
  for (const page of state.document.pages) {
    const button = document.createElement('button');
    button.className = `page-row${page.id === state.document.activePageId ? ' is-active' : ''}`;
    button.dataset.pageId = page.id; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(page.id === state.document.activePageId));
    button.innerHTML = `<span class="page-row-icon">▧</span><span class="page-row-name">${escapeHtml(page.name)}</span>`;
    list.append(button);
  }
  const page = activePage();
  $('#canvas-page-name').textContent = page?.name || 'Page';
}

function renderLayers() {
  const list = $('#layers-list'); list.replaceChildren();
  const page = activePage();
  latestPageLayerIds = [];
  const search = state.layerSearch.trim().toLowerCase();
  const matchingNode = node => !search || node.name.toLowerCase().includes(search) || (node.children || []).some(matchingNode);
  const addRows = (nodes, depth = 0) => {
    for (const node of [...nodes].reverse()) {
      if (!matchingNode(node)) continue;
      latestPageLayerIds.push(node.id);
      const row = document.createElement('div');
      row.className = `layer-row${state.selectedIds.includes(node.id) ? ' is-selected' : ''}${getNodePropertyValue(state.document, node, 'visible') ? '' : ' layer-hidden'}${node.locked ? ' layer-locked' : ''}`;
      row.setAttribute('role', 'treeitem'); row.dataset.layerId = node.id; row.tabIndex = 0;
      row.style.paddingLeft = `${7 + depth * 13}px`;
      const iconName = node.type === 'frame' || node.type === 'group' ? 'layerFrame' : node.type === 'text' ? 'layerText' : node.type === 'image' ? 'layerImage' : node.type === 'ellipse' ? 'layerEllipse' : node.type === 'section' ? 'layerSection' : node.type === 'path' || node.type === 'network' || node.type === 'boolean' ? 'layerVector' : 'rectangleSmall';
      const chevron = node.children?.length ? '⌄' : '';
      const componentMarker = node.isComponent ? '◆' : node.isInstance ? '◇' : node.mask ? '◩' : '';
      row.title = node.mask ? 'Mask group · use Layer options or Inspector to release' : '';
      row.innerHTML = `<span class="layer-chevron">${chevron}</span><span class="layer-icon">${componentMarker || icon(iconName, 14)}</span><span class="layer-name">${escapeHtml(node.name)}</span><button class="layer-visibility" data-action="visibility" aria-label="Toggle visibility" title="Toggle visibility">${icon('eye', 13)}</button>`;
      list.append(row);
      if (node.children?.length) addRows(node.children, depth + 1);
    }
  };
  if (page) addRows(page.children);
  $('#empty-layers').hidden = latestPageLayerIds.length > 0;
  $('#layers-list').hidden = latestPageLayerIds.length === 0;
}

function section(title, body, iconName = null) {
  return `<section class="property-section"><div class="property-heading">${iconName ? `<span>${icon(iconName, 13)} </span>` : ''}<span>${title}</span></div>${body}</section>`;
}
function numberField(label, prop, value, step = 1, min = null, max = null, disabled = false) {
  return `<div class="property-field"><label>${label}</label><input class="prop-input" data-prop="${prop}" type="number" step="${step}"${min == null ? '' : ` min="${min}"`}${max == null ? '' : ` max="${max}"`}${disabled ? ' disabled' : ''} value="${Number.isFinite(Number(value)) ? Number(value) : 0}" aria-label="${label}" /></div>`;
}
function optionalNumberField(label, prop, value) {
  return `<label class="size-limit-field"><span>${label}</span><input class="prop-input" data-prop="${prop}" data-optional-number type="number" min="0" step="1" value="${Number.isFinite(value) ? value : ''}" placeholder="None" title="Leave blank for no limit" aria-label="${label}"/></label>`;
}
function sliderField(label, prop, value, min, max, step = 1) {
  return `<div class="slider-row"><label>${label}</label><input class="prop-input" data-prop="${prop}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"/><output>${Number(value).toFixed(step < 1 ? 2 : 0)}${prop === 'opacity' ? '%' : ''}</output></div>`;
}
function colorField(label, prop, value, opacity = 100) {
  const safe = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff';
  return `<div class="fill-row"><label class="color-swatch" title="${label}"><input class="prop-input" data-prop="${prop}" type="color" value="${safe}" aria-label="${label} color"/></label><input class="prop-input color-value" data-prop="${prop}" type="text" value="${safe}" maxlength="7" aria-label="${label} color value"/><input class="prop-input fill-opacity" data-prop="fillOpacity" type="number" min="0" max="100" value="${opacity}" title="Opacity percent"/></div>`;
}
function networkFaceControls(node) {
  return (node.faces || []).map((face, index) => {
    const color = /^#[0-9a-f]{6}$/i.test(face.fill || '') ? face.fill : getNodeColor(state.document, node, 'fill');
    const safeColor = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#ffffff';
    const opacity = Math.round((face.fillOpacity ?? 1) * 100);
    const label = `Region ${index + 1}`;
    return `<div class="network-face-control"><div class="network-face-heading"><span>${label}</span><output>${opacity}%</output></div><div class="network-face-fields"><label class="color-swatch" title="${label} fill"><input type="color" data-network-face-fill="${escapeHtml(face.id)}" value="${safeColor}" aria-label="${label} fill color"${node.locked ? ' disabled' : ''}/></label><input type="range" min="0" max="100" value="${opacity}" data-network-face-opacity="${escapeHtml(face.id)}" aria-label="${label} opacity"${node.locked ? ' disabled' : ''}/></div></div>`;
  }).join('');
}
function variableBindingControl(node, kind) {
  const property = { fill: 'fillVariableId', text: 'textVariableId', stroke: 'strokeVariableId' }[kind];
  const variables = state.document.variables || [];
  const selected = node[property] || '';
  const options = variables.filter(variable => variable.type === 'color').map(variable => {
    const collection = state.document.variableCollections?.find(item => item.id === variable.collectionId);
    return `<option value="${escapeHtml(variable.id)}"${selected === variable.id ? ' selected' : ''}>${escapeHtml(variable.name)} · ${escapeHtml(collection?.name || 'Collection')}</option>`;
  }).join('');
  return `<label class="variable-binding-row"><span>Variable</span><select class="select-field" data-variable-binding="${kind}" aria-label="${kind} color variable"><option value="">No variable</option>${options}</select></label>`;
}
function variablePropertyBindingControl(node, property, label) {
  const type = { visible: 'boolean', opacity: 'number', radius: 'number', text: 'string', fontSize: 'number', lineHeight: 'number', letterSpacing: 'number' }[property];
  const selected = node.variableBindings?.[property] || '';
  const matchingVariables = (state.document.variables || []).filter(variable => variable.type === type);
  if (!matchingVariables.length && !selected) return '';
  const options = matchingVariables.map(variable => {
    const collection = state.document.variableCollections?.find(item => item.id === variable.collectionId);
    return `<option value="${escapeHtml(variable.id)}"${selected === variable.id ? ' selected' : ''}>${escapeHtml(variable.name)} · ${escapeHtml(collection?.name || 'Collection')}</option>`;
  }).join('');
  return `<label class="variable-binding-row"><span>${escapeHtml(label)}</span><select class="select-field" data-variable-property-binding="${property}" aria-label="${escapeHtml(label)} variable"><option value="">No variable</option>${options}</select></label>`;
}
function transformSection(node) {
  const opacity = getNodePropertyValue(state.document, node, 'opacity');
  const body = `<div class="property-grid">${numberField('X', 'x', node.x)}${numberField('Y', 'y', node.y)}${numberField('W', 'width', node.width)}${numberField('H', 'height', node.height)}${numberField('↻', 'rotation', node.rotation, 1)}${numberField('◐', 'opacity', Math.round((opacity ?? 1) * 100))}</div>${variablePropertyBindingControl(node, 'opacity', 'Opacity')}${variablePropertyBindingControl(node, 'visible', 'Visibility')}`;
  return section('Position', body);
}
function appearanceSection(node) {
  const hasFill = node.type !== 'network' || (node.faces || []).length > 0;
  const fill = hasFill ? colorField('Fill', 'fill', getNodeColor(state.document, node, 'fill'), Math.round((node.fillOpacity ?? 1) * 100)) : '';
  const fillVariable = hasFill ? variableBindingControl(node, 'fill') : '';
  const stroke = node.stroke ? `${colorField('Stroke', 'stroke', getNodeColor(state.document, node, 'stroke'), 100)}${variableBindingControl(node, 'stroke')}<button class="add-fill" data-action="create-color-variable" data-kind="stroke">＋ Create stroke variable</button>` : '';
  const radiusValue = getNodePropertyValue(state.document, node, 'radius');
  const radius = ['rectangle', 'frame', 'section', 'image'].includes(node.type) ? `<div class="property-grid" style="margin-top:8px">${numberField('◒', 'radius', radiusValue || 0)}</div>${variablePropertyBindingControl(node, 'radius', 'Corner radius')}` : '';
  const styleActions = node.type === 'path' || (node.type === 'network' && !hasFill) ? '<div class="style-actions"><button class="add-fill" data-action="add-stroke">＋ Add stroke</button></div>' : node.type === 'boolean' ? `<div class="style-actions"><button class="add-fill" data-action="create-color-style">${node.fillStyleId ? '✦ Linked color style' : '＋ Create color style'}</button><button class="add-fill" data-action="create-color-variable" data-kind="fill">＋ Create color variable</button></div>` : `<div class="style-actions"><button class="add-fill" data-action="add-stroke">＋ Add stroke</button><button class="add-fill" data-action="create-color-style">${node.fillStyleId ? '✦ Linked color style' : '＋ Create color style'}</button><button class="add-fill" data-action="create-color-variable" data-kind="fill">＋ Create color variable</button></div>`;
  const body = `${fill}${fillVariable}${stroke}${styleActions}${radius}`;
  return section('Appearance', body);
}
function imageAdjustmentsSection(node) {
  const adjustments = node.adjustments || { brightness: 0, contrast: 0, saturation: 0, blur: 0 };
  const status = state.imageStatus.get(node.id) || 'Ready · Pillow-RS WebAssembly';
  const statusClass = status.startsWith('Updated') || status.startsWith('Ready') ? 'image-engine-status' : '';
  const body = `${sliderField('Brightness', 'adjustments.brightness', adjustments.brightness || 0, -100, 100)}${sliderField('Contrast', 'adjustments.contrast', adjustments.contrast || 0, -100, 100)}${sliderField('Saturation', 'adjustments.saturation', adjustments.saturation || 0, -100, 100)}${sliderField('Blur', 'adjustments.blur', adjustments.blur || 0, 0, 24)}<div class="image-engine-status ${statusClass}" id="image-engine-status">${escapeHtml(status)}</div><p class="image-properties-note">Every preview starts from the original image held in memory. Your image never leaves this device.</p>`;
  return section('Image adjustments', body);
}
function effectNumberField(label, effect, field, step = 1, min = 0, max = 100) {
  return `<div class="property-field"><label>${label}</label><input data-effect-field="${field}" data-effect-id="${escapeHtml(effect.id)}" type="number" step="${step}" min="${min}" max="${max}" value="${Number(effect[field])}" aria-label="${label}" /></div>`;
}
function layerEffectsSection(node) {
  const effects = node.effects || [];
  const rows = effects.map(effect => {
    const name = effect.type === 'drop-shadow' ? 'Drop shadow' : 'Layer blur';
    const fields = effect.type === 'drop-shadow'
      ? `<div class="effect-color-row"><label><span>Color</span><input type="color" data-effect-field="color" data-effect-id="${escapeHtml(effect.id)}" value="${escapeHtml(effect.color)}" aria-label="Shadow color" /></label><label class="effect-opacity"><span>Opacity</span><input type="range" min="0" max="100" step="1" value="${Math.round(effect.opacity * 100)}" data-effect-field="opacity" data-effect-id="${escapeHtml(effect.id)}" aria-label="Shadow opacity" /><output>${Math.round(effect.opacity * 100)}%</output></label></div><div class="property-grid">${effectNumberField('X', effect, 'offsetX', 1, -1000, 1000)}${effectNumberField('Y', effect, 'offsetY', 1, -1000, 1000)}${effectNumberField('Blur', effect, 'blur', 1, 0, 100)}</div>`
      : `<div class="property-grid">${effectNumberField('Radius', effect, 'radius', 1, 0, 100)}</div>`;
    return `<div class="layer-effect-card" data-effect-row="${escapeHtml(effect.id)}"><div class="layer-effect-heading"><strong>${name}</strong><label><input type="checkbox" data-effect-field="visible" data-effect-id="${escapeHtml(effect.id)}" ${effect.visible ? 'checked' : ''} aria-label="Show ${name.toLowerCase()}"${node.locked ? ' disabled' : ''}/> Show</label><button class="tiny-icon-button" type="button" data-action="remove-layer-effect" data-effect-id="${escapeHtml(effect.id)}" aria-label="Remove ${name.toLowerCase()}"${node.locked ? ' disabled' : ''}>×</button></div>${fields}</div>`;
  }).join('');
  const disabled = node.locked || effects.length >= 8;
  const note = effects.length >= 8 ? 'A layer can have up to 8 effects.' : effects.length ? '' : '<div class="image-properties-note">Add shadows or blur. Effects stay editable and are saved with this design.</div>';
  const buttons = `<div class="style-actions"><button class="add-fill" type="button" data-action="add-layer-effect" data-effect-type="drop-shadow"${disabled ? ' disabled' : ''}>＋ Drop shadow</button><button class="add-fill" type="button" data-action="add-layer-effect" data-effect-type="layer-blur"${disabled ? ' disabled' : ''}>＋ Layer blur</button></div>`;
  return section('Effects', `${rows}${note}${buttons}`);
}
function exportSettingsSection(node) {
  const settings = node.exportSettings || [];
  const formats = [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']];
  const scales = [0.5, 0.75, 1, 1.5, 2, 3, 4];
  const rows = settings.map(setting => {
    const options = formats.map(([value, label]) => `<option value="${value}"${setting.format === value ? ' selected' : ''}>${label}</option>`).join('');
    const scaleOptions = scales.map(value => `<option value="${value}"${setting.scale === value ? ' selected' : ''}>${value}×</option>`).join('');
    const size = exportDimensions(node.id, setting.scale);
    const quality = setting.format === 'png' ? '' : `<label class="export-quality"><span>Quality</span><input type="range" min="1" max="100" step="1" value="${setting.quality}" data-export-field="quality" data-export-id="${escapeHtml(setting.id)}" aria-label="Export quality"/><output aria-live="polite">${setting.quality}%</output></label>`;
    return `<div class="export-setting-row" data-export-row="${escapeHtml(setting.id)}"><div class="export-setting-controls"><label><span>Format</span><select class="select-field" data-export-field="format" data-export-id="${escapeHtml(setting.id)}" aria-label="Export format">${options}</select></label><label><span>Scale</span><select class="select-field" data-export-field="scale" data-export-id="${escapeHtml(setting.id)}" aria-label="Export scale">${scaleOptions}</select></label></div><label class="export-suffix"><span>Suffix</span><input type="text" maxlength="24" value="${escapeHtml(setting.suffix)}" placeholder="@2x" data-export-field="suffix" data-export-id="${escapeHtml(setting.id)}" aria-label="Export suffix"/></label>${quality}<div class="export-setting-actions"><span>${size.width} × ${size.height} px</span><button class="secondary-button" type="button" data-action="export-setting" data-export-id="${escapeHtml(setting.id)}">Export</button><button class="tiny-icon-button" type="button" data-action="remove-export-setting" data-export-id="${escapeHtml(setting.id)}" aria-label="Remove export setting">×</button></div></div>`;
  }).join('');
  const message = settings.length ? '' : '<div class="image-properties-note">Add one or more PNG, JPG, or WebP sizes for this layer.</div>';
  const add = settings.length >= 8 ? '<div class="image-properties-note">This layer has reached the 8-setting limit.</div>' : '<button class="add-fill" type="button" data-action="add-export-setting">＋ Add export setting</button>';
  return section('Export', `${rows}${message}${add}`);
}
function autoLayoutSection(node) {
  if (!node.autoLayout) return section('Layout', `<button class="add-fill" data-action="auto-layout-toggle">＋ Add auto layout</button><div class="image-properties-note">Flow child layers with direction, spacing, alignment, and wrap sizing.</div>`);
  const layout = createAutoLayout(node.autoLayout);
  const select = (prop, value, values) => `<select class="prop-input select-field" data-prop="autoLayout.${prop}" aria-label="${prop}">${values.map(([key, label]) => `<option value="${key}"${value === key ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  const axis = select('axis', layout.axis, [['vertical','Vertical'],['horizontal','Horizontal'],['grid','Grid']]);
  const padding = `<div class="property-grid">${numberField('Top', 'autoLayout.padding.top', layout.padding.top, 1, 0)}${numberField('Right', 'autoLayout.padding.right', layout.padding.right, 1, 0)}${numberField('Bottom', 'autoLayout.padding.bottom', layout.padding.bottom, 1, 0)}${numberField('Left', 'autoLayout.padding.left', layout.padding.left, 1, 0)}</div>`;
  const body = layout.axis === 'grid'
    ? `<div class="property-grid"><span class="field-caption">Flow</span>${axis}${numberField('Columns', 'autoLayout.columns', layout.columns, 1, 1, 64)}<span class="field-caption">Rows</span>${select('rows', layout.rows, [['auto','Auto'], ...Array.from({ length: 64 }, (_, index) => [String(index + 1), String(index + 1)])])}${numberField('Horizontal gap', 'autoLayout.columnGap', layout.columnGap, 1, 0)}${numberField('Vertical gap', 'autoLayout.rowGap', layout.rowGap, 1, 0)}<label class="field-caption" for="auto-layout-auto-positioning">Auto position</label><input class="prop-input" data-prop="autoLayout.autoPositioning" type="checkbox" id="auto-layout-auto-positioning" ${layout.autoPositioning ? 'checked' : ''}/></div>${padding}<div class="image-properties-note">Grid cells flow in layer order. Turn off Auto position to edit a layer’s row and column.</div><button class="add-fill" data-action="auto-layout-toggle">− Remove auto layout</button>`
    : `<div class="property-grid"><span class="field-caption">Flow</span>${axis}${numberField('Horizontal gap', 'autoLayout.columnGap', layout.columnGap, 1, 0)}${numberField('Vertical gap', 'autoLayout.rowGap', layout.rowGap, 1, 0)}<span class="field-caption">Align</span>${select('align', layout.align, [['start','Start'],['center','Center'],['end','End'],['stretch','Stretch']])}<span class="field-caption">Distribute</span>${select('justify', layout.justify, [['start','Packed'],['center','Center'],['end','End'],['space-between','Space between']])}<span class="field-caption">Main size</span>${select('mainSizing', layout.mainSizing, [['fixed','Fixed'],['hug','Hug contents']])}<span class="field-caption">Cross size</span>${select('crossSizing', layout.crossSizing, [['fixed','Fixed'],['hug','Hug contents']])}<label class="field-caption" for="auto-layout-wrap">Wrap</label><input class="prop-input" data-prop="autoLayout.wrap" type="checkbox" id="auto-layout-wrap" ${layout.wrap ? 'checked' : ''}/></div>${padding}<button class="add-fill" data-action="auto-layout-toggle">− Remove auto layout</button>`;
  return section('Auto layout', body);
}
function guideNumberField(guide, label, property, value, min = 0, max = 10_000, step = 1) {
  return `<label class="layout-guide-field"><span>${label}</span><input type="number" min="${min}" max="${max}" step="${step}" value="${value}" data-guide-id="${escapeHtml(guide.id)}" data-guide-field="${property}" aria-label="${label}"/></label>`;
}
function layoutGuidesSection(node) {
  const guides = node.layoutGuides || [];
  const types = [['grid','Grid'],['columns','Columns'],['rows','Rows']];
  const rows = guides.map(guide => {
    const typeOptions = types.map(([value, label]) => `<option value="${value}"${guide.type === value ? ' selected' : ''}>${label}</option>`).join('');
    const alignmentOptions = guide.type === 'columns'
      ? [['stretch','Stretch'],['left','Left'],['center','Center'],['right','Right']]
      : [['stretch','Stretch'],['top','Top'],['center','Center'],['bottom','Bottom']];
    const alignment = guide.type === 'grid' ? '' : `<label class="layout-guide-field"><span>Type</span><select data-guide-id="${escapeHtml(guide.id)}" data-guide-field="alignment" aria-label="Guide placement">${alignmentOptions.map(([value, label]) => `<option value="${value}"${guide.alignment === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
    const geometry = guide.type === 'grid'
      ? guideNumberField(guide, 'Size', 'size', guide.size, 1, 500)
      : `<div class="layout-guide-fields">${guideNumberField(guide, 'Count', 'count', guide.count, 1, 64)}${alignment}${guide.alignment === 'stretch' ? `${guideNumberField(guide, 'Margin', 'margin', guide.margin)}${guideNumberField(guide, 'Gutter', 'gutter', guide.gutter)}` : `${guideNumberField(guide, guide.type === 'columns' ? 'Width' : 'Height', 'bandSize', guide.bandSize, 1)}${['left','right','top','bottom'].includes(guide.alignment) ? guideNumberField(guide, 'Offset', 'offset', guide.offset) : ''}`}</div>`;
    return `<div class="layout-guide-card" data-layout-guide="${escapeHtml(guide.id)}"><div class="layout-guide-heading"><button class="tiny-icon-button layout-guide-visibility" type="button" data-action="toggle-layout-guide" data-guide-id="${escapeHtml(guide.id)}" aria-label="${guide.visible ? 'Hide' : 'Show'} this guide" aria-pressed="${guide.visible}">${guide.visible ? '◉' : '○'}</button><select data-guide-id="${escapeHtml(guide.id)}" data-guide-field="type" aria-label="Layout guide type">${typeOptions}</select><button class="tiny-icon-button layout-guide-remove" type="button" data-action="remove-layout-guide" data-guide-id="${escapeHtml(guide.id)}" aria-label="Remove layout guide">×</button></div>${geometry}<div class="layout-guide-appearance"><label><span>Color</span><input type="color" value="${escapeHtml(guide.color)}" data-guide-id="${escapeHtml(guide.id)}" data-guide-field="color" aria-label="Guide color"/></label><label class="layout-guide-opacity"><span>Opacity</span><input type="range" min="0" max="100" step="1" value="${Math.round(guide.opacity * 100)}" data-guide-id="${escapeHtml(guide.id)}" data-guide-field="opacity" aria-label="Guide opacity"/><output>${Math.round(guide.opacity * 100)}%</output></label></div></div>`;
  }).join('');
  const add = guides.length >= 32
    ? '<div class="image-properties-note">This frame has reached the 32-guide limit.</div>'
    : `<div class="layout-guide-adds">${types.map(([type, label]) => `<button type="button" data-action="add-layout-guide" data-guide-type="${type}">＋ ${label}</button>`).join('')}</div>`;
  const empty = guides.length ? '' : '<div class="image-properties-note">Add grid, row, or column guides. Combine them to build a precise frame layout.</div>';
  const rotationHint = guides.length ? '<div class="image-properties-note">Guides are shown while this frame is unrotated.</div>' : '';
  return section('Layout guides', `${rows}${empty}${rotationHint}${add}`);
}
function gridPlacementSection(node, parent) {
  const cell = { row: 1, column: 1, rowSpan: 1, columnSpan: 1, alignX: 'start', alignY: 'start', ...(node.gridCell || {}) };
  const automatic = parent.autoLayout.autoPositioning !== false;
  const select = (prop, value, values) => `<select class="prop-input select-field" data-prop="gridCell.${prop}" aria-label="${prop}">${values.map(([key, label]) => `<option value="${key}"${value === key ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  const sizing = (property, value) => `<select class="prop-input select-field" data-prop="${property}" aria-label="${property}"><option value="fixed"${value !== 'fill' ? ' selected' : ''}>Fixed</option><option value="fill"${value === 'fill' ? ' selected' : ''}>Fill cell</option></select>`;
  return section('Grid placement', `<div class="property-grid">${numberField('Row', 'gridCell.row', cell.row, 1, 1, 64, automatic)}${numberField('Column', 'gridCell.column', cell.column, 1, 1, 64, automatic)}${numberField('Row span', 'gridCell.rowSpan', cell.rowSpan, 1, 1, 64)}${numberField('Column span', 'gridCell.columnSpan', cell.columnSpan, 1, 1, 64)}<span class="field-caption">Align X</span>${select('alignX', cell.alignX, [['start','Left'],['center','Center'],['end','Right']])}<span class="field-caption">Align Y</span>${select('alignY', cell.alignY, [['start','Top'],['center','Center'],['end','Bottom']])}<span class="field-caption">Width</span>${sizing('layoutSizingX', node.layoutSizingX)}<span class="field-caption">Height</span>${sizing('layoutSizingY', node.layoutSizingY)}</div>${automatic ? '<div class="image-properties-note">Turn off Auto position on the grid frame to edit row and column.</div>' : ''}`);
}
function constraintsSection(node) {
  const constraints = { horizontal: 'left', vertical: 'top', ...(node.constraints || {}) };
  const select = (prop, value, values) => `<select class="prop-input select-field" data-prop="constraints.${prop}" aria-label="${prop} constraint">${values.map(([key, label]) => `<option value="${key}"${value === key ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  return section('Constraints', `<div class="property-grid"><span class="field-caption">Horizontal</span>${select('horizontal', constraints.horizontal, horizontalConstraints)}<span class="field-caption">Vertical</span>${select('vertical', constraints.vertical, verticalConstraints)}</div><div class="image-properties-note">Pins and scales this layer when its parent frame changes size.</div>`);
}
function sizeLimitsSection(node, parent) {
  if (!node.autoLayout && !parent?.autoLayout) return '';
  const fields = `<div class="property-grid size-limits-grid">${optionalNumberField('Min width', 'minWidth', node.minWidth)}${optionalNumberField('Max width', 'maxWidth', node.maxWidth)}${optionalNumberField('Min height', 'minHeight', node.minHeight)}${optionalNumberField('Max height', 'maxHeight', node.maxHeight)}</div><div class="image-properties-note">Leave a value blank for no limit. Limits are in pixels and apply as this layer resizes.</div>`;
  return section('Size limits', fields);
}
function componentSection(node) {
  const linkedInstance = componentInstanceRoot(node.id);
  if (linkedInstance) {
    const component = state.document.components?.find(item => item.id === linkedInstance.componentId);
    const set = state.document.componentSets?.find(item => item.id === component?.componentSetId);
    const label = node.id === linkedInstance.id ? 'Linked instance · local edits remain as overrides' : 'Layer inside a linked instance · local edits remain as overrides';
    const selectors = set ? set.properties.map(property => {
      const selected = component.variantProperties?.[property.name] || '';
      const options = property.values.map(value => `<option value="${escapeHtml(value)}"${selected === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
      return `<label class="variant-control"><span>${escapeHtml(property.name)}</span><select class="prop-input select-field" data-variant-property="${escapeHtml(property.name)}" data-instance-id="${escapeHtml(linkedInstance.id)}" aria-label="${escapeHtml(property.name)} variant">${options}</select></label>`;
    }).join('') : '';
    return section('Instance', `<div class="component-link-copy"><strong>${escapeHtml(set?.name || component?.name || 'Missing component')}</strong><span>${label}</span></div>${selectors ? `<div class="variant-controls">${selectors}</div>` : ''}<button class="add-fill" data-action="detach-component-instance" data-instance-id="${escapeHtml(linkedInstance.id)}">Detach instance</button>`);
  }
  if (node.isComponent) {
    const component = state.document.components?.find(item => item.id === node.componentId);
    const set = state.document.componentSets?.find(item => item.id === component?.componentSetId);
    const variantFields = set ? set.properties.map(property => `<label class="variant-control"><span>${escapeHtml(property.name)}</span><input class="prop-input" data-variant-master-property="${escapeHtml(property.name)}" data-component-id="${escapeHtml(component.id)}" value="${escapeHtml(component.variantProperties?.[property.name] || '')}" aria-label="${escapeHtml(property.name)} variant value"/></label>`).join('') : '';
    const variantLabel = set ? `Variant in ${set.name} · changes update linked instances` : 'Main component · changes update linked instances';
    return section('Component', `<div class="component-link-copy"><strong>${escapeHtml(component?.name || node.name)}</strong><span>${escapeHtml(variantLabel)}</span></div>${variantFields ? `<div class="variant-controls">${variantFields}</div>` : ''}<button class="add-fill" data-action="create-component-instance" data-component-id="${escapeHtml(node.componentId)}">＋ Create instance</button>`);
  }
  if (node.isInstance) {
    const component = state.document.components?.find(item => item.id === node.componentId);
    return section('Instance', `<div class="component-link-copy"><strong>${escapeHtml(component?.name || 'Missing component')}</strong><span>Linked instance · local edits remain as overrides</span></div><button class="add-fill" data-action="detach-component-instance">Detach instance</button>`);
  }
  return section('Component', '<button class="add-fill" data-action="create-component">◇ Create component</button><div class="image-properties-note">Create a reusable main component from this layer and its children.</div>');
}
function textSection(node) {
  const fontSize = getNodePropertyValue(state.document, node, 'fontSize');
  const lineHeight = getNodePropertyValue(state.document, node, 'lineHeight');
  const letterSpacing = getNodePropertyValue(state.document, node, 'letterSpacing');
  const textFit = node.textFit || 'auto-height';
  const body = `<div class="property-grid"><select class="prop-input select-field" data-prop="fontFamily" aria-label="Font family" style="grid-column:span 2"><option value="Inter, Arial, sans-serif">Inter</option><option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value="monospace">Mono</option></select><select class="prop-input select-field" data-prop="textFit" aria-label="Text resize mode" style="grid-column:span 2"><option value="fixed"${textFit === 'fixed' ? ' selected' : ''}>Fixed size</option><option value="auto-height"${textFit === 'auto-height' ? ' selected' : ''}>Auto height</option><option value="auto-width"${textFit === 'auto-width' ? ' selected' : ''}>Auto width</option></select>${numberField('Size', 'fontSize', fontSize, 1)}<select class="prop-input select-field" data-prop="fontWeight" aria-label="Font weight"><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semi bold</option><option value="700">Bold</option></select>${numberField('Line', 'lineHeight', lineHeight, .05)}${numberField('↔', 'letterSpacing', letterSpacing || 0, .1)}<select class="prop-input select-field" data-prop="align" aria-label="Text align"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></div><div class="image-properties-note">Auto height wraps to the box width. Auto width expands to fit each line.</div>${variablePropertyBindingControl(node, 'fontSize', 'Font size')}${variablePropertyBindingControl(node, 'lineHeight', 'Line height')}${variablePropertyBindingControl(node, 'letterSpacing', 'Letter spacing')}<div style="margin-top:9px">${colorField('Text color', 'color', getNodeColor(state.document, node, 'text'), 100)}${variableBindingControl(node, 'text')}</div>${variablePropertyBindingControl(node, 'text', 'Text content')}<button class="add-fill" data-action="edit-text">Edit text content</button><button class="add-fill" data-action="create-color-style">${node.textStyleId ? '✦ Linked text style' : '＋ Create text color style'}</button><button class="add-fill" data-action="create-color-variable" data-kind="text">＋ Create color variable</button>`;
  return section('Typography', body);
}
function frameVariableModesSection(frame) {
  const collections = state.document.variableCollections || [];
  if (!collections.length) return '';
  const controls = collections.map(collection => {
    const selected = frame.variableModes?.[collection.id] || '';
    const modes = collection.modes.map(mode => `<option value="${escapeHtml(mode.id)}"${selected === mode.id ? ' selected' : ''}>${escapeHtml(mode.name)}</option>`).join('');
    return `<label class="frame-variable-mode"><span>${escapeHtml(collection.name)}</span><select class="select-field" data-frame-variable-mode="${escapeHtml(collection.id)}"><option value="">Inherit</option>${modes}</select></label>`;
  }).join('');
  return section('Variables', `${controls}<div class="image-properties-note">Nested layers use the closest frame mode override.</div>`);
}
function inspectPanel() {
  const entries = selectedEntries();
  if (!entries.length) return '<div class="inspect-empty"><strong>Inspect design values</strong><span>Select a layer to review its page-space geometry, resolved styles, and copyable handoff data.</span></div>';
  const output = buildInspectOutput(state.document, entries);
  const number = value => Number.isFinite(Number(value)) ? String(Number(Number(value).toFixed(2))) : '0';
  const cards = output.layers.map(layer => {
    const properties = [
      ['Position', `${number(layer.position.x)}, ${number(layer.position.y)} px`],
      ['Size', `${number(layer.size.width)} × ${number(layer.size.height)} px`],
      ['Rotation', `${number(layer.rotation)}°`],
      ['Opacity', `${Math.round(layer.opacity * 100)}%`]
    ];
    if (layer.color) properties.push(['Color', `<span class="inspect-color"><i style="background:${escapeHtml(layer.color)}"></i>${escapeHtml(layer.color)}</span>`]);
    if (layer.stroke) properties.push(['Stroke', `${escapeHtml(layer.stroke.color)} · ${number(layer.stroke.width)} px`]);
    if (layer.typography) properties.push(['Type', `${number(layer.typography.fontSize)} px · ${escapeHtml(layer.typography.fontFamily || 'Arial')}`]);
    if (layer.image) properties.push(['Source', `${number(layer.image.sourceWidth || layer.size.width)} × ${number(layer.image.sourceHeight || layer.size.height)} px`]);
    if (layer.autoLayout) properties.push(['Layout', layer.autoLayout.axis === 'grid' ? `Grid · ${layer.autoLayout.columns} columns` : `${layer.autoLayout.axis} auto layout`]);
    return `<article class="inspect-layer-card"><header><strong>${escapeHtml(layer.name)}</strong><span>${escapeHtml(layer.type)} · ${escapeHtml(layer.parent)}</span></header><dl>${properties.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${label === 'Color' ? value : escapeHtml(value)}</dd></div>`).join('')}</dl>${layer.text ? `<div class="inspect-text-value"><span>Text content</span><p>${escapeHtml(layer.text)}</p></div>` : ''}</article>`;
  }).join('');
  const css = output.css || '/* Select a layer to generate CSS. */';
  const json = output.json || '[]';
  return `<div class="inspect-panel"><div class="inspect-intro"><span>LOCAL HANDOFF</span><strong>${entries.length === 1 ? 'Layer values' : `${entries.length} selected layers`}</strong><small>Resolved from the current local design · positions are relative to the page</small></div><div class="inspect-layer-list">${cards}</div><section class="inspect-code-card"><header><div><strong>CSS</strong><span>Layout and style starting point</span></div><button class="inspect-copy" type="button" data-inspect-copy="css">Copy CSS</button></header><pre><code>${escapeHtml(css)}</code></pre><p>Vector paths, masks, and Boolean geometry remain exact in the layer JSON below.</p></section><section class="inspect-code-card inspect-json-card"><header><div><strong>Layer JSON</strong><span>Exact selected layer data</span></div><button class="inspect-copy" type="button" data-inspect-copy="json">Copy JSON</button></header><details><summary>View structured data</summary><pre><code>${escapeHtml(json)}</code></pre></details></section></div>`;
}
function prototypeInspector() {
  const node = selectedNodes()[0] || null;
  const entry = node ? findNode(state.document, node.id) : null;
  const frame = node?.type === 'frame' ? node : [...(entry?.parents || [])].reverse().find(parent => parent.type === 'frame');
  const start = getPrototypeStartFrame(state.document, node?.id);
  const startBody = frame
    ? `<div class="prototype-current-frame"><span>${escapeHtml(frame.name)}</span><button class="secondary-button" data-action="prototype-start">${state.document.prototypeStartPoint?.nodeId === frame.id ? 'Starting point' : 'Set as starting point'}</button></div>`
    : `<p class="prototype-hint">${start ? `Present starts at “${escapeHtml(start.frame.name)}”.` : 'Create a frame to make a prototype.'}</p>`;
  const interactions = (node?.interactions || []).map(interaction => {
    const target = interaction.destinationId ? findNode(state.document, interaction.destinationId, interaction.destinationPageId)?.node : null;
    const targetPage = interaction.destinationPageId ? state.document.pages.find(page => page.id === interaction.destinationPageId) : null;
    const actionLabel = interaction.action === 'open-overlay' ? `Open overlay · ${interaction.overlayPosition || 'center'}` : interaction.action === 'close-overlay' ? 'Close overlay' : 'Navigate to';
    const triggerLabel = interaction.trigger === 'while-hovering' ? 'While hovering' : 'On click / tap';
    const destinationLabel = target ? `${target.name} · ${targetPage?.name || 'Page'}` : interaction.action === 'close-overlay' ? 'Current overlay' : 'Missing frame';
    return `<div class="prototype-interaction-row"><span class="prototype-interaction-icon">${interaction.action === 'close-overlay' ? '×' : interaction.action === 'open-overlay' ? '▱' : '↗'}</span><span class="prototype-interaction-copy"><strong>${escapeHtml(triggerLabel)} · ${escapeHtml(actionLabel)}</strong><small>${escapeHtml(destinationLabel)}${interaction.transition && interaction.transition !== 'instant' ? ` · ${escapeHtml(interaction.easing || 'ease-in-out')}` : ''}</small></span><button class="tiny-icon-button" data-action="remove-prototype-interaction" data-interaction-id="${escapeHtml(interaction.id)}" aria-label="Remove interaction" title="Remove interaction">×</button></div>`;
  }).join('');
  const connectState = state.prototypeSourceId === node?.id ? `<div class="prototype-connect-hint">${state.prototypeAction === 'open-overlay' ? 'Click the frame to show as an overlay.' : 'Click a destination frame on the canvas.'} Press Escape to cancel.</div>` : '';
  const overlayControls = state.prototypeAction === 'open-overlay' ? `<label>Position<select id="prototype-overlay-position" class="select-field">${[['center','Center'],['top-left','Top left'],['top-center','Top center'],['top-right','Top right'],['left-center','Left center'],['right-center','Right center'],['bottom-left','Bottom left'],['bottom-center','Bottom center'],['bottom-right','Bottom right']].map(([value, label]) => `<option value="${value}"${state.prototypeOverlayPosition === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label><span>Dismiss on outside click</span><input id="prototype-overlay-outside" type="checkbox"${state.prototypeOverlayOutsideClick ? ' checked' : ''}/></label><label><span>Show background</span><input id="prototype-overlay-background" type="checkbox"${state.prototypeOverlayBackground ? ' checked' : ''}/></label>${state.prototypeOverlayBackground ? `<label>Background<input id="prototype-overlay-color" type="color" value="${state.prototypeOverlayBackgroundColor}"/><input id="prototype-overlay-opacity" type="range" min="0" max="100" value="${Math.round(state.prototypeOverlayBackgroundOpacity * 100)}" aria-label="Overlay background opacity"/></label>` : ''}` : '';
  const transitionOptions = [['instant', 'Instant'], ['dissolve', 'Dissolve'], ['move-left', 'Move in · left'], ['move-right', 'Move in · right'], ...(state.prototypeAction === 'navigate' ? [['smart-animate', 'Smart animate']] : [])]
    .map(([value, label]) => `<option value="${value}"${state.prototypeTransition === value ? ' selected' : ''}>${label}</option>`).join('');
  const easingOptions = [['ease-in-out', 'Ease in and out'], ['linear', 'Linear'], ['ease-in', 'Ease in'], ['ease-out', 'Ease out']]
    .map(([value, label]) => `<option value="${value}"${state.prototypeEasing === value ? ' selected' : ''}>${label}</option>`).join('');
  const easingControl = state.prototypeTransition === 'instant' ? '' : `<label>Easing<select id="prototype-easing" class="select-field">${easingOptions}</select></label>`;
  const controls = node ? `<div class="prototype-controls"><label>Trigger<select id="prototype-trigger" class="select-field"><option value="on-click"${state.prototypeTrigger === 'on-click' ? ' selected' : ''}>On click / tap</option><option value="while-hovering"${state.prototypeTrigger === 'while-hovering' ? ' selected' : ''}>While hovering</option></select></label><label>Action<select id="prototype-action" class="select-field"><option value="navigate"${state.prototypeAction === 'navigate' ? ' selected' : ''}>Navigate to</option><option value="open-overlay"${state.prototypeAction === 'open-overlay' ? ' selected' : ''}>Open overlay</option><option value="close-overlay"${state.prototypeAction === 'close-overlay' ? ' selected' : ''}>Close overlay</option></select></label>${state.prototypeAction !== 'close-overlay' ? `<label>Transition<select id="prototype-transition" class="select-field">${transitionOptions}</select></label>${easingControl}<label>Duration <span id="prototype-duration-value">${(state.prototypeDuration / 1000).toFixed(1)} s</span><input id="prototype-duration" type="range" min="0" max="2000" step="100" value="${state.prototypeDuration}" /></label>${overlayControls}` : ''}<button class="primary-button prototype-add-link" data-action="prototype-connect">${state.prototypeAction === 'close-overlay' ? '＋ Add close overlay' : '＋ Add interaction'}</button>${connectState}</div>` : '<p class="prototype-hint">Select a layer to add an interaction, or choose a frame above to set the starting point.</p>';
  const sourceLabel = node ? `<div class="prototype-section-label">${escapeHtml(node.name)} interactions</div>${interactions || '<div class="prototype-empty-links">No interactions yet</div>'}` : '';
  return `<div class="prototype-inspector"><section class="prototype-section"><div class="prototype-section-label">Flow starting point</div>${startBody}<button class="primary-button prototype-present-button" data-action="present">▶ Present</button></section>${node ? `<section class="prototype-section">${sourceLabel}${controls}</section>` : ''}<section class="prototype-section prototype-help"><strong>Prototype links</strong><span>Connect a selected layer to a frame, then use Present to try the flow.</span></section></div>`;
}

function pageComments(pageId = activePage()?.id) {
  return (state.document.comments || []).filter(comment => comment.pageId === pageId);
}

function commentTimestamp(timestamp) {
  try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp); }
  catch { return 'Saved locally'; }
}

function commentPanel() {
  const comments = pageComments();
  const active = comments.find(comment => comment.id === state.activeCommentId);
  const ordered = [...comments].sort((a, b) => a.createdAt - b.createdAt);
  const numberById = new Map(ordered.map((comment, index) => [comment.id, index + 1]));
  const composer = (replyTo = null) => `<form class="comment-compose" data-comment-form="${replyTo ? 'reply' : 'new'}"${replyTo ? ` data-thread-id="${escapeHtml(replyTo)}"` : ''}><label for="comment-draft">${replyTo ? 'Write a reply' : 'Add a comment'}</label><textarea id="comment-draft" maxlength="4000" rows="3" placeholder="Share a clear note…" required></textarea><div class="comment-compose-actions"><span>Saved with this design</span><div>${replyTo ? '' : '<button class="secondary-button" type="button" data-comment-action="cancel">Cancel</button>'}<button class="primary-button" type="submit">${replyTo ? 'Reply' : 'Post comment'}</button></div></div></form>`;
  const newDraft = state.pendingCommentAnchor ? `<div class="comment-anchor-hint">New comment at ${Math.round(state.pendingCommentAnchor.x)}, ${Math.round(state.pendingCommentAnchor.y)} px</div>${composer()}` : '';
  if (active) {
    const messages = active.messages.map(message => `<article class="comment-message"><header><strong>${escapeHtml(message.author)}</strong><time>${escapeHtml(commentTimestamp(message.createdAt))}</time></header><p>${escapeHtml(message.text)}</p></article>`).join('');
    return `<div class="comments-panel"><header class="comments-panel-header"><div><strong>Comment ${numberById.get(active.id)}</strong><span>${active.resolved ? 'Resolved · saved in this file' : 'Saved in this file on this device'}</span></div><button class="comment-text-button" data-comment-action="back">All comments</button></header>${messages}<div class="comment-thread-actions"><button class="secondary-button" data-comment-action="resolve" data-thread-id="${escapeHtml(active.id)}">${active.resolved ? 'Reopen thread' : 'Resolve thread'}</button><button class="comment-delete-button" data-comment-action="delete" data-thread-id="${escapeHtml(active.id)}" aria-label="Delete comment thread">Delete</button></div>${composer(active.id)}</div>`;
  }
  const visible = [...comments].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
  const rows = visible.map(comment => {
    const first = comment.messages[0];
    const preview = first.text.length > 82 ? `${first.text.slice(0, 79)}…` : first.text;
    return `<button class="comment-thread-row${comment.resolved ? ' is-resolved' : ''}" data-comment-action="open" data-thread-id="${escapeHtml(comment.id)}"><span class="comment-mini-pin">${numberById.get(comment.id)}</span><span class="comment-row-copy"><strong>${escapeHtml(preview)}</strong><small>${comment.messages.length} message${comment.messages.length === 1 ? '' : 's'} · ${comment.resolved ? 'Resolved' : commentTimestamp(comment.updatedAt)}</small></span><span class="comment-row-arrow">›</span></button>`;
  }).join('');
  const overflow = comments.length > visible.length ? `<p class="comment-list-limit">Showing the latest 100 of ${comments.length} threads on this page.</p>` : '';
  const empty = comments.length || state.pendingCommentAnchor ? '' : '<div class="comments-empty"><span>◌</span><strong>No comments on this page</strong><p>Choose Comment, then tap a spot on the canvas to leave a note.</p></div>';
  return `<div class="comments-panel"><header class="comments-panel-header"><div><strong>Review notes</strong><span>Stored locally with this design</span></div><button class="comment-new-button" data-comment-action="new">＋ Comment</button></header>${newDraft}${empty}<div class="comment-thread-list">${rows}</div>${overflow}</div>`;
}

function setInspectorTab(tab) {
  state.inspectorTab = tab;
  if (tab !== 'prototype') state.prototypeSourceId = null;
  $$('.inspector-tab').forEach(item => {
    item.classList.toggle('is-active', item.dataset.inspectorTab === tab);
    item.setAttribute('aria-selected', String(item.dataset.inspectorTab === tab));
  });
  renderInspector();
  renderer?.invalidate();
}

function beginCommentAt(point) {
  const page = activePage();
  if (!page) return;
  state.pendingCommentAnchor = { pageId: page.id, x: point.x, y: point.y };
  state.activeCommentId = null;
  setInspectorTab('comments');
  if (innerWidth <= 820 && !$('#right-panel').classList.contains('is-open')) toggleMobilePanel('right');
  requestAnimationFrame(() => $('#comment-draft')?.focus());
}

function openCommentThread(threadId) {
  const comment = pageComments().find(item => item.id === threadId);
  if (!comment) return;
  state.pendingCommentAnchor = null;
  state.activeCommentId = threadId;
  state.panX = canvas.clientWidth / 2 - comment.x * state.zoom;
  state.panY = canvas.clientHeight / 2 - comment.y * state.zoom;
  setInspectorTab('comments');
  if (innerWidth <= 820 && !$('#right-panel').classList.contains('is-open')) toggleMobilePanel('right');
}

function handleCommentAction(button) {
  const action = button.dataset.commentAction;
  const threadId = button.dataset.threadId;
  if (action === 'new') {
    state.pendingCommentAnchor = null;
    state.activeCommentId = null;
    setTool('comment');
    setInspectorTab('comments');
    showToast('Tap a point on the canvas to add a comment.');
  } else if (action === 'open') openCommentThread(threadId);
  else if (action === 'back') { state.activeCommentId = null; state.pendingCommentAnchor = null; renderInspector(); }
  else if (action === 'cancel') { state.pendingCommentAnchor = null; renderInspector(); }
  else if (action === 'resolve') {
    const comment = pageComments().find(item => item.id === threadId);
    if (!comment) return;
    checkpoint(comment.resolved ? 'Reopen comment thread' : 'Resolve comment thread');
    setCommentResolved(state.document, threadId, !comment.resolved);
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'delete') {
    if (!pageComments().some(item => item.id === threadId)) return;
    if (!confirm('Delete this comment thread from the local design?')) return;
    checkpoint('Delete comment thread'); removeCommentThread(state.document, threadId);
    state.activeCommentId = null; renderInspector(); queueSave(); renderer.invalidate();
  }
}

function submitCommentForm(form) {
  const textarea = form.querySelector('textarea');
  const text = textarea?.value.trim();
  if (!text) { textarea?.focus(); return; }
  try {
    if (form.dataset.commentForm === 'new') {
      if ((state.document.comments || []).length >= 10_000) { showToast('This design has reached the 10,000 comment thread limit.'); return; }
      const anchor = state.pendingCommentAnchor;
      if (!anchor || !state.document.pages.some(page => page.id === anchor.pageId)) { showToast('Choose a point on the canvas before posting.'); return; }
      checkpoint('Add comment');
      const thread = createCommentThread(state.document, { ...anchor, text });
      state.pendingCommentAnchor = null; state.activeCommentId = thread.id;
    } else {
      const threadId = form.dataset.threadId;
      checkpoint('Reply to comment');
      addCommentReply(state.document, threadId, text);
    }
    renderInspector(); queueSave(); renderer.invalidate();
  } catch (error) { showToast(error.message || 'Could not save this comment.'); }
}

function renderInspector() {
  const content = $('#inspector-content');
  if (state.inspectorTab !== 'design') {
    if (state.inspectorTab === 'prototype') { content.innerHTML = prototypeInspector(); return; }
    if (state.inspectorTab === 'inspect') { content.innerHTML = inspectPanel(); return; }
    if (state.inspectorTab === 'comments') { content.innerHTML = commentPanel(); return; }
    content.innerHTML = '<div class="prototype-placeholder">Choose a properties tab.</div>';
    return;
  }
  const entries = selectedEntries();
  if (!entries.length) {
    const page = activePage();
    content.innerHTML = `<div class="inspector-empty"><div class="empty-layer-icon">✣</div><strong>Nothing selected</strong><span>Choose a layer or create something on the canvas. Everything is saved locally as you work.</span></div>${section('Page', `<div class="property-heading" style="font-weight:400;color:#777">${escapeHtml(page?.name || 'Page 1')}</div><button class="add-fill" data-action="create-frame">＋ Create a frame</button>`)}`;
    return;
  }
  if (entries.length > 1) {
    const imageCount = entries.filter(entry => entry.node.type === 'image').length;
    const alignments = [['left', 'Left'], ['center-x', 'Center X'], ['right', 'Right'], ['distribute-horizontal', 'H space'], ['top', 'Top'], ['center-y', 'Center Y'], ['bottom', 'Bottom'], ['distribute-vertical', 'V space']];
    const controls = alignments.map(([mode, label]) => `<button class="multi-align-button" type="button" data-action="align-selection" data-align-mode="${mode}" aria-label="${label === 'H space' ? 'Distribute horizontally' : label === 'V space' ? 'Distribute vertically' : `Align ${label.toLowerCase()}`}" title="${label === 'H space' ? 'Distribute horizontally' : label === 'V space' ? 'Distribute vertically' : `Align ${label.toLowerCase()}`}"${canAlignLayers(state.document, state.selectedIds, mode) ? '' : ' disabled'}>${label}</button>`).join('');
    const layoutNote = entries.some(entry => entry.parent?.autoLayout) ? 'Auto layout controls child positions; change spacing or alignment in the parent frame.' : 'Align uses visual bounds. Distribute needs at least three sibling layers.';
    content.innerHTML = `<div class="multi-selection-card"><strong>${entries.length} layers selected</strong><span>${imageCount ? `${imageCount} image${imageCount === 1 ? '' : 's'} in selection. Right-click to apply a saved image recipe.` : 'Use the Layers panel to change their order.'}</span></div>${section('Align & distribute', `<div class="multi-align-controls">${controls}</div><div class="image-properties-note">${layoutNote}</div>`)}${section('Selection', `<div class="property-grid">${numberField('X', 'selectionX', 0)}${numberField('Y', 'selectionY', 0)}</div>`)}`;
    return;
  }
  const node = entries[0].node;
  let body = componentSection(node) + transformSection(node);
  if (node.type === 'boolean') {
    const operations = [['union', 'Union'], ['subtract', 'Subtract'], ['intersect', 'Intersect'], ['exclude', 'Exclude']];
    body += section('Boolean', `<select class="prop-input select-field" data-prop="operation" aria-label="Boolean operation">${operations.map(([value, label]) => `<option value="${value}"${node.operation === value ? ' selected' : ''}>${label}</option>`).join('')}</select><button class="add-fill" data-action="separate-boolean" style="margin-top:8px">Separate Boolean</button><div class="image-properties-note">The source shapes stay editable inside this live Boolean group.</div>`);
  }
  if (node.type === 'group' && node.mask) {
    const maskSource = node.children.find(child => child.id === node.maskSourceId);
    body += section('Mask', `<div class="image-properties-note">${escapeHtml(maskSource?.name || 'Vector shape')} masks the editable layers inside this group.</div><button class="add-fill" data-action="release-mask">Release mask</button>`);
  }
  if (node.type === 'text') body += textSection(node);
  if (node.type === 'image') body += imageAdjustmentsSection(node);
  if (node.type === 'path') {
    const pointCount = node.points?.length || 0;
    const selectedPoint = state.selectedVectorPoint?.nodeId === node.id;
    body += section('Vector', `<label class="field-caption" style="display:flex;align-items:center;gap:8px"><input class="prop-input" data-prop="closed" type="checkbox" ${node.closed ? 'checked' : ''}/> Closed path</label><div class="image-properties-note">${pointCount} points · double-click a segment to insert; drag anchors and handles to refine it.</div><div class="vector-point-actions"><button class="add-fill" data-action="insert-vector-point">＋ Add point</button><button class="add-fill" data-action="delete-vector-point"${selectedPoint ? '' : ' disabled'}>− Delete point</button></div>`);
    if (node.closed) body += appearanceSection(node);
    else body += section('Stroke', colorField('Stroke', 'stroke', getNodeColor(state.document, node, 'stroke'), 100) + variableBindingControl(node, 'stroke') + `<button class="add-fill" data-action="create-color-variable" data-kind="stroke">＋ Create stroke variable</button><div class="property-grid" style="margin-top:8px">${numberField('W', 'strokeWidth', node.strokeWidth || 1)}</div>`);
  } else if (node.type === 'network') {
    const selectedVertex = state.selectedVectorPoint?.nodeId === node.id && state.selectedVectorPoint.vertexId;
    body += section('Vector network', `<div class="image-properties-note">${node.vertices.length} points · ${node.edges.length} edges · ${node.faces.length} closed regions. Select a point, then use Pen to branch from it.</div><div class="vector-point-actions"><button class="add-fill" data-action="insert-vector-point">＋ Add point</button><button class="add-fill" data-action="delete-vector-point"${selectedVertex ? '' : ' disabled'}>− Delete point</button></div>`);
    if (node.faces.length) body += section('Region fills', networkFaceControls(node));
    body += appearanceSection(node);
  } else if (!['image', 'text', 'line'].includes(node.type)) body += appearanceSection(node);
  else if (node.type === 'line') body += section('Stroke', colorField('Stroke', 'stroke', getNodeColor(state.document, node, 'stroke'), 100) + variableBindingControl(node, 'stroke') + `<button class="add-fill" data-action="create-color-variable" data-kind="stroke">＋ Create stroke variable</button><div class="property-grid" style="margin-top:8px">${numberField('W', 'strokeWidth', node.strokeWidth || 1)}</div>`);
  body += layerEffectsSection(node);
  if (node.type === 'frame') body += frameVariableModesSection(node) + autoLayoutSection(node) + layoutGuidesSection(node);
  const parent = entries[0].parent;
  if (parent?.autoLayout) {
    if (parent.autoLayout.axis === 'grid') body += gridPlacementSection(node, { ...parent, autoLayout: createAutoLayout(parent.autoLayout) });
    else {
      const sizing = node.layoutSizingMain || 'hug';
      const axis = parent.autoLayout.axis === 'horizontal' ? 'Width' : 'Height';
      const cross = node.layoutSizingCross || 'hug';
      body += section('Layout sizing', `<div class="property-heading" style="font-weight:400;color:#777">${axis} in auto layout</div><select class="prop-input select-field" data-prop="layoutSizingMain" aria-label="Main axis sizing" style="width:100%"><option value="hug"${sizing === 'hug' ? ' selected' : ''}>Hug contents</option><option value="fill"${sizing === 'fill' ? ' selected' : ''}>Fill container</option></select><div class="property-heading" style="font-weight:400;color:#777;margin-top:8px">Cross axis sizing</div><select class="prop-input select-field" data-prop="layoutSizingCross" aria-label="Cross axis sizing" style="width:100%"><option value="hug"${cross === 'hug' ? ' selected' : ''}>Fixed size</option><option value="fill"${cross === 'fill' ? ' selected' : ''}>Fill container</option></select>`);
    }
  } else if (parent?.type === 'frame') body += constraintsSection(node);
  body += sizeLimitsSection(node, parent);
  if (node.type === 'image') body += section('Image', `<div class="property-heading" style="font-weight:400;color:#777">${escapeHtml(node.fileName || node.name)}</div><div class="property-grid"><select class="prop-input select-field" data-prop="fit" aria-label="Image fill mode"><option value="cover">Fill</option><option value="contain">Fit</option></select><button class="add-fill" data-action="reset-image">Reset image</button></div>`);
  body += exportSettingsSection(node);
  content.innerHTML = body;
  for (const input of content.querySelectorAll('[data-prop="fontFamily"],[data-prop="fontWeight"],[data-prop="align"],[data-prop="fit"],[data-prop="textFit"]')) input.value = String(node[input.dataset.prop] ?? input.value);
}

function renderAssetsTab() {
  const list = $('#assets-list'); list.replaceChildren();
  const components = $('#components-list'); components.replaceChildren();
  const variableCollections = $('#variable-collections-list'); variableCollections.replaceChildren();
  const collections = state.document.variableCollections || [];
  if (!collections.length) {
    const empty = document.createElement('div'); empty.className = 'variables-empty'; empty.textContent = 'Create typed variables, aliases, and theme modes for this design.'; variableCollections.append(empty);
  }
  for (const collection of collections) {
    const card = document.createElement('section'); card.className = 'variable-collection-card';
    const header = document.createElement('div'); header.className = 'variable-collection-header';
    const title = document.createElement('strong'); title.textContent = collection.name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'tiny-icon-button'; remove.dataset.action = 'delete-variable-collection'; remove.dataset.collectionId = collection.id; remove.setAttribute('aria-label', `Delete ${collection.name} variable collection`); remove.title = 'Delete collection'; remove.textContent = '×';
    header.append(title, remove);
    const controls = document.createElement('div'); controls.className = 'variable-collection-controls';
    const mode = document.createElement('select'); mode.className = 'select-field'; mode.dataset.variableDefaultMode = collection.id; mode.setAttribute('aria-label', `${collection.name} default mode`);
    for (const item of collection.modes) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; option.selected = item.id === collection.defaultModeId; mode.append(option); }
    const addMode = document.createElement('button'); addMode.type = 'button'; addMode.className = 'variable-mode-add'; addMode.dataset.action = 'add-variable-mode'; addMode.dataset.collectionId = collection.id; addMode.textContent = '+ Mode';
    controls.append(mode, addMode);
    const rows = document.createElement('div'); rows.className = 'variable-rows';
    const variables = (state.document.variables || []).filter(variable => variable.collectionId === collection.id);
    for (const variable of variables) {
      const row = document.createElement('div'); row.className = 'variable-row';
      const heading = document.createElement('div'); heading.className = 'variable-item-heading';
      if (variable.type === 'color') {
        const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'variable-apply'; apply.dataset.variableApply = variable.id; apply.title = `Apply ${variable.name} to selected layers`;
        const swatch = document.createElement('span'); swatch.className = 'variable-swatch'; swatch.style.backgroundColor = resolveVariableValue(state.document, variable.id) || '#ffffff';
        const name = document.createElement('span'); name.className = 'variable-name'; name.textContent = variable.name;
        apply.append(swatch, name); heading.append(apply);
      } else {
        const name = document.createElement('span'); name.className = 'variable-name'; name.textContent = variable.name; heading.append(name);
      }
      const kind = document.createElement('span'); kind.className = 'variable-type-badge'; kind.textContent = variable.type;
      const removeVariable = document.createElement('button'); removeVariable.type = 'button'; removeVariable.className = 'tiny-icon-button variable-remove'; removeVariable.dataset.action = 'delete-variable'; removeVariable.dataset.variableId = variable.id; removeVariable.setAttribute('aria-label', `Delete ${variable.name}`); removeVariable.title = 'Delete variable'; removeVariable.textContent = '×';
      heading.append(kind, removeVariable);
      const values = document.createElement('div'); values.className = 'variable-mode-values';
      for (const item of collection.modes) {
        const modeRow = document.createElement('div'); modeRow.className = 'variable-mode-value';
        const modeName = document.createElement('span'); modeName.className = 'variable-mode-name'; modeName.textContent = item.name;
        const alias = document.createElement('select'); alias.className = 'select-field variable-alias'; alias.dataset.variableAlias = variable.id; alias.dataset.modeId = item.id; alias.setAttribute('aria-label', `${variable.name} ${item.name} alias`);
        const literalOption = document.createElement('option'); literalOption.value = ''; literalOption.textContent = 'Value'; alias.append(literalOption);
        for (const target of state.document.variables || []) {
          if (target.id === variable.id || target.type !== variable.type) continue;
          const option = document.createElement('option'); option.value = target.id; option.textContent = `${target.collectionId === collection.id ? '' : `${state.document.variableCollections.find(entry => entry.id === target.collectionId)?.name || 'Collection'} · `}${target.name}`; alias.append(option);
        }
        const aliasId = variable.aliasesByMode?.[item.id] || '';
        alias.value = aliasId;
        const input = document.createElement('input'); input.className = 'variable-value'; input.dataset.variableValue = variable.id; input.dataset.modeId = item.id; input.disabled = Boolean(aliasId);
        if (variable.type === 'boolean') {
          input.type = 'checkbox'; input.checked = Boolean(variable.valuesByMode?.[item.id]);
        } else {
          input.type = variable.type === 'color' ? 'color' : variable.type === 'number' ? 'number' : 'text';
          if (input.type === 'number') input.step = 'any';
          input.value = String(variable.valuesByMode?.[item.id] ?? (variable.type === 'color' ? '#1e1e1e' : ''));
        }
        input.title = `${variable.name} · ${item.name}`; input.setAttribute('aria-label', `${variable.name} ${item.name} value`);
        modeRow.append(modeName, alias, input); values.append(modeRow);
      }
      row.append(heading, values); rows.append(row);
    }
    const addVariable = document.createElement('button'); addVariable.type = 'button'; addVariable.className = 'add-fill'; addVariable.dataset.action = 'add-variable'; addVariable.dataset.collectionId = collection.id; addVariable.textContent = '＋ New variable';
    card.append(header, controls, rows, addVariable); variableCollections.append(card);
  }
  const componentItems = state.document.components || [];
  const componentSetItems = state.document.componentSets || [];
  const groupedComponentIds = new Set(componentSetItems.flatMap(set => set.componentIds));
  if (!componentItems.length) {
    const empty = document.createElement('div'); empty.className = 'components-empty'; empty.textContent = 'Create a component from any layer.'; components.append(empty);
  }
  for (const set of componentSetItems) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'component-card'; card.dataset.componentSetId = set.id; card.title = `${set.name} · ${set.componentIds.length} variants`;
    const mark = document.createElement('span'); mark.className = 'component-card-icon'; mark.textContent = '◇';
    const name = document.createElement('span'); name.className = 'component-card-name'; name.textContent = `${set.name} · ${set.componentIds.length}`;
    card.append(mark, name); components.append(card);
  }
  for (const component of componentItems.filter(item => !groupedComponentIds.has(item.id))) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'component-card'; card.dataset.componentId = component.id; card.title = `Create an instance of ${component.name}`;
    const mark = document.createElement('span'); mark.className = 'component-card-icon'; mark.textContent = '◇';
    const name = document.createElement('span'); name.className = 'component-card-name'; name.textContent = component.name;
    card.append(mark, name); components.append(card);
  }
  const styles = $('#color-styles-list'); styles.replaceChildren();
  const colorStyles = state.document.colorStyles || [];
  if (!colorStyles.length) {
    const empty = document.createElement('div'); empty.className = 'color-styles-empty'; empty.textContent = 'Create styles from a layer’s Fill or Text color.'; styles.append(empty);
  }
  for (const style of colorStyles) {
    const card = document.createElement('button'); card.className = 'color-style-card'; card.dataset.colorStyleId = style.id; card.title = `${style.name} · ${style.value}`;
    const swatch = document.createElement('span'); swatch.className = 'color-style-swatch'; swatch.style.background = style.value;
    const name = document.createElement('span'); name.className = 'color-style-name'; name.textContent = style.name;
    card.append(swatch, name); styles.append(card);
  }
  for (const node of imageNodes()) {
    const asset = state.assets.get(node.assetId);
    const card = document.createElement('button'); card.className = 'asset-card'; card.dataset.layerId = node.id; card.title = `Place ${node.name}`;
    const thumb = document.createElement('span'); thumb.className = 'asset-thumb';
    const image = document.createElement('img'); image.alt = ''; image.src = state.previewUrls.get(node.id) || asset?.bitmapUrl || '';
    thumb.append(image);
    const name = document.createElement('span'); name.className = 'asset-card-name'; name.textContent = node.name;
    card.append(thumb, name); list.append(card);
  }
}

function renderUI() {
  $('#document-name').value = state.document.name;
  $('#canvas-file-name').textContent = state.document.name;
  renderPageList(); renderLayers(); renderInspector(); renderAssetsTab(); updateSelectionStatus(); updateZoomUI();
  renderer?.invalidate();
}

function pageLayerRows(page = activePage()) {
  const rows = [];
  if (page) walkNodes(page.children, entry => rows.push(entry));
  return rows;
}
function deepestContainerAt(point) {
  let result = null;
  const visit = (nodes, parentX = 0, parentY = 0) => {
    for (const node of nodes) {
      const x = parentX + node.x; const y = parentY + node.y;
      if (['frame', 'group'].includes(node.type) && point.x >= x && point.y >= y && point.x <= x + node.width && point.y <= y + node.height) result = { node, x, y };
      visit(node.children || [], x, y);
    }
  };
  visit(activePage()?.children || []);
  return result;
}
function localizeToParent(node, worldX, worldY, parent) {
  node.x = worldX - (parent?.x || 0);
  node.y = worldY - (parent?.y || 0);
  addNode(state.document, node, { parentId: parent?.node.id ?? null });
  if (parent?.node.autoLayout) applyAutoLayout(parent.node);
}

function networkAnchorAt(world, node, pointerType = 'mouse') {
  if (!node || node.type !== 'network' || node.locked) return null;
  const origin = absolutePosition(node.id);
  const center = { x: origin.x + node.width / 2, y: origin.y + node.height / 2 };
  let best = null;
  for (const vertex of node.vertices || []) {
    const localPoint = vectorNetworkVertexPoint(node, vertex.id, origin);
    const screenPoint = rotatePoint(localPoint, center, node.rotation);
    const distance = checkPointDistance(world, screenPoint);
    const tolerance = (pointerType === 'touch' ? 22 : 12) / Math.max(.08, state.zoom);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { node, origin, vertexId: vertex.id, localPoint, distance };
  }
  return best;
}

function startPenPath(world, pointerType = 'mouse') {
  const selected = selectedNodes();
  const targetNetwork = selected.length === 1 && selected[0].type === 'network' && !selected[0].locked ? selected[0] : null;
  const closeTolerance = 10 / Math.max(.08, state.zoom);
  const draft = state.penDraft;
  if (draft) {
    const target = draft.networkNodeId ? findNode(state.document, draft.networkNodeId)?.node : targetNetwork;
    const existing = target ? networkAnchorAt(world, target, pointerType) : null;
    const first = draft.anchors[0];
    if (existing && draft.anchors.length >= 2) {
      const existingOrigin = absolutePosition(target.id);
      const firstWorld = rotatePoint(first, { x: existingOrigin.x + target.width / 2, y: existingOrigin.y + target.height / 2 }, target.rotation);
      const closesAtFirst = (first.vertexId && first.vertexId === existing.vertexId)
        || (!first.vertexId && checkPointDistance(world, firstWorld) <= closeTolerance);
      if (closesAtFirst) {
        if (draft.anchors.length >= 3) finishPenPath(true);
        else showToast('Add one more point before closing a region.');
        return;
      }
      const point = { ...existing.localPoint, in: { ...existing.localPoint }, out: { ...existing.localPoint }, vertexId: existing.vertexId };
      draft.anchors.push(point);
      finishPenPath(false);
      return;
    }
    const targetOrigin = target ? absolutePosition(target.id) : null;
    const firstWorld = target ? rotatePoint(first, { x: targetOrigin.x + target.width / 2, y: targetOrigin.y + target.height / 2 }, target.rotation) : first;
    if (draft.anchors.length >= 3 && checkPointDistance(world, firstWorld) <= closeTolerance) {
      finishPenPath(true);
      return;
    }
    const pointPosition = target ? unrotateForPath(world, target, targetOrigin) : world;
    const point = { ...pointPosition, in: { ...pointPosition }, out: { ...pointPosition } };
    draft.anchors.push(point);
    const pointIndex = draft.anchors.length - 1;
    state.interaction = { kind: 'pen-anchor', start: world, pointIndex, moved: false, ...(target ? { networkNodeId: target.id } : {}) };
  } else {
    const existing = targetNetwork ? networkAnchorAt(world, targetNetwork, pointerType) : null;
    const origin = targetNetwork ? absolutePosition(targetNetwork.id) : null;
    const point = existing ? existing.localPoint : targetNetwork ? unrotateForPath(world, targetNetwork, origin) : world;
    state.penDraft = {
      ...(targetNetwork ? { networkNodeId: targetNetwork.id } : {}),
      anchors: [{ ...point, in: { ...point }, out: { ...point }, ...(existing ? { vertexId: existing.vertexId } : {}) }]
    };
    state.interaction = { kind: 'pen-anchor', start: world, pointIndex: 0, moved: false, ...(targetNetwork ? { networkNodeId: targetNetwork.id } : {}) };
    showToast(existing ? 'Starting at a shared point · add a branch, connect another point, then press Enter.' : 'Click to add points · drag for curves · Enter to finish · Escape to cancel.', 5000);
  }
  state.penHover = world;
  $('#selection-status').textContent = 'Pen · draw connected vector networks · Enter finish · Esc cancel';
  renderer.invalidate();
}

function finishPenPath(closed = false, { selectAfter = true } = {}) {
  const draft = state.penDraft;
  if (!draft || draft.anchors.length < 2) return false;
  state.penDraft = null; state.penHover = null; state.interaction = null;
  const existing = draft.networkNodeId ? findNode(state.document, draft.networkNodeId)?.node : null;
  let node;
  if (existing?.type === 'network' && !existing.locked) {
    node = existing;
    checkpoint('Extend vector network');
    const origin = absolutePosition(node.id);
    const result = appendVectorNetworkPath(node, draft.anchors, origin, { closed });
    if (!result?.addedEdges) { showToast('Add at least two distinct points to make a vector path.'); renderer.invalidate(); return false; }
    recordNodeComponentOverrides(node, ['vertices', 'edges', 'faces', 'x', 'y', 'width', 'height']);
  } else {
    const geometry = vectorNetworkGeometryFromAnchors(draft.anchors, { closed });
    node = createNode('network', geometry);
    checkpoint('Create vector network');
    const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    const parent = deepestContainerAt(center);
    localizeToParent(node, node.x, node.y, parent);
  }
  if (selectAfter) setTool('select');
  setSelection([node.id]); queueSave(); renderer.invalidate();
  showToast(`${closed ? 'Closed region' : 'Vector path'} ${existing ? 'added to network' : 'created'} · select a point and use Pen to branch.`);
  return true;
}

function cancelPenPath() {
  state.penDraft = null; state.penHover = null; state.interaction = null;
  renderer.invalidate(); updateSelectionStatus();
}

function rotatePoint(point, center, degrees) {
  if (!degrees) return point;
  const angle = degrees * Math.PI / 180;
  const dx = point.x - center.x; const dy = point.y - center.y;
  return { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function vectorPathControlAt(world, pointerType = 'mouse') {
  const nodes = selectedNodes();
  const node = nodes.length === 1 && ['path', 'network'].includes(nodes[0].type) && !nodes[0].locked ? nodes[0] : null;
  if (!node || state.tool !== 'select') return null;
  const origin = absolutePosition(node.id);
  const center = { x: origin.x + node.width / 2, y: origin.y + node.height / 2 };
  const tolerance = (pointerType === 'touch' ? 22 : 9) / Math.max(.08, state.zoom);
  let best = null;
  if (node.type === 'network') {
    for (const edge of node.edges || []) {
      const points = vectorNetworkEdgePoints(node, edge.id, origin);
      if (!points) continue;
      for (const [part, handle, anchor] of [['control1', points[1], points[0]], ['control2', points[2], points[3]]]) {
        if (!edge[part]) continue;
        const point = rotatePoint(handle, center, node.rotation);
        const distance = checkPointDistance(world, point);
        if (distance <= tolerance && (!best || distance < best.distance)) best = { node, origin, edgeId: edge.id, part, distance };
      }
    }
    for (const vertex of node.vertices || []) {
      const point = rotatePoint(vectorNetworkVertexPoint(node, vertex.id, origin), center, node.rotation);
      const distance = checkPointDistance(world, point);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { node, origin, vertexId: vertex.id, part: 'anchor', distance };
    }
    return best;
  }
  for (let index = 0; index < (node.points || []).length; index += 1) {
    for (const part of ['in', 'out', 'anchor']) {
      if (part !== 'anchor') {
        const handle = node.points[index][part];
        if (!handle || (Number(handle.x) === 0 && Number(handle.y) === 0)) continue;
      }
      const point = rotatePoint(vectorNodePoint(node, index, part, origin), center, node.rotation);
      const distance = checkPointDistance(world, point);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { node, origin, index, part, distance };
    }
  }
  return best;
}

function insertPathPoint(node, segmentIndex, t = .5, origin = absolutePosition(node.id)) {
  if (!node || !['path', 'network'].includes(node.type) || node.locked) return false;
  if (node.type === 'network') {
    const vertexId = insertVectorNetworkPoint(node, segmentIndex, t, origin);
    if (!vertexId) return false;
    state.selectedVectorPoint = { nodeId: node.id, vertexId };
    recordNodeComponentOverrides(node, ['vertices', 'edges', 'faces']);
  } else {
    const pointIndex = insertVectorNodePoint(node, segmentIndex, t, origin);
    if (pointIndex < 0) return false;
    state.selectedVectorPoint = { nodeId: node.id, index: pointIndex };
    recordNodeComponentOverrides(node, ['points']);
  }
  renderInspector(); renderer.invalidate(); queueSave();
  showToast('Vector point inserted. The Bézier curve keeps its original shape.');
  return true;
}

function insertPathPointOnLongestSegment(nodeId = selectedNodes()[0]?.id) {
  const node = nodeId ? findNode(state.document, nodeId)?.node : null;
  if (!node || !['path', 'network'].includes(node.type)) return;
  const origin = absolutePosition(node.id);
  const segment = node.type === 'network' ? longestVectorNetworkEdge(node, origin) : longestVectorSegment(node, origin);
  if (!segment) { showToast('This vector shape has no segment to split.'); return; }
  checkpoint('Insert vector point');
  insertPathPoint(node, node.type === 'network' ? segment.edgeId : segment.segmentIndex, segment.t, origin);
}

function insertPathPointAtWorld(world) {
  let node = selectedNodes().length === 1 && ['path', 'network'].includes(selectedNodes()[0].type) ? selectedNodes()[0] : null;
  if (!node) {
    const hit = hitTestPage(activePage(), world, null, state.document);
    if (!['path', 'network'].includes(hit?.type)) return false;
    node = hit;
    setSelection([node.id]);
  }
  if (node.locked || vectorPathControlAt(world)) return false;
  const origin = absolutePosition(node.id);
  const localWorld = unrotateForPath(world, node, origin);
  const closest = node.type === 'network' ? closestVectorNetworkEdge(node, localWorld, origin) : closestVectorSegment(node, localWorld, origin);
  if (!closest || closest.distance > 12 / Math.max(.08, state.zoom)) return false;
  checkpoint('Insert vector point');
  return insertPathPoint(node, node.type === 'network' ? closest.edgeId : closest.segmentIndex, closest.t, origin);
}

function deleteSelectedVectorPoint(nodeId = state.selectedVectorPoint?.nodeId) {
  const node = nodeId ? findNode(state.document, nodeId)?.node : null;
  const index = state.selectedVectorPoint?.index;
  if (!node || state.selectedVectorPoint?.nodeId !== node.id) return false;
  checkpoint('Delete vector point');
  if (node.type === 'network') {
    if (!removeVectorNetworkVertex(node, state.selectedVectorPoint.vertexId)) { showToast('That point cannot be removed without destroying the network.'); return false; }
    state.selectedVectorPoint = null;
    recordNodeComponentOverrides(node, ['vertices', 'edges', 'faces']);
  } else if (node.type === 'path' && Number.isInteger(index)) {
    if (node.points.length <= 2) { showToast('A vector path must keep at least two points.'); return false; }
    removeVectorNodePoint(node, index);
    state.selectedVectorPoint.index = Math.min(index, node.points.length - 1);
    recordNodeComponentOverrides(node, ['points']);
  } else return false;
  renderInspector(); renderLayers(); renderer.invalidate(); queueSave();
  showToast('Vector point deleted.');
  return true;
}

function unrotateForPath(world, node, origin) {
  const center = { x: origin.x + node.width / 2, y: origin.y + node.height / 2 };
  return rotatePoint(world, center, -(node.rotation || 0));
}

function checkPointDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function commentPinAt(world) {
  const comments = [...pageComments()].sort((a, b) => a.createdAt - b.createdAt);
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    if (checkPointDistance(world, comments[index]) <= 12 / Math.max(.08, state.zoom)) return comments[index];
  }
  return null;
}
function resizeHandleAt(event) {
  const nodes = selectedNodes();
  if (nodes.length !== 1 || nodes[0].locked) return null;
  const entry = findNode(state.document, nodes[0].id);
  if (!entry) return null;
  let x = nodes[0].x; let y = nodes[0].y;
  for (const parent of entry.parents) { x += parent.x; y += parent.y; }
  const node = nodes[0];
  const handles = {
    nw: [x, y], n: [x + node.width / 2, y], ne: [x + node.width, y], e: [x + node.width, y + node.height / 2],
    se: [x + node.width, y + node.height], s: [x + node.width / 2, y + node.height], sw: [x, y + node.height], w: [x, y + node.height / 2]
  };
  const point = screenToWorld(event, canvas, state);
  const tolerance = 8 / state.zoom;
  for (const [name, [hx, hy]] of Object.entries(handles)) if (checkPointDistance(point, { x: hx, y: hy }) <= tolerance) return { name, node, entry };
  return null;
}
function selectedNodeDragStart(node, world, shiftKey) {
  if (!shiftKey && !state.selectedIds.includes(node.id)) setSelection([node.id]);
  const entry = findNode(state.document, node.id);
  if (!shiftKey && state.selectedIds.length === 1 && entry?.parent?.autoLayout) {
    checkpoint('Reorder auto layout items');
    state.interaction = { kind: 'reorder', node, parent: entry.parent };
    return;
  }
  const nodes = selectedNodes();
  checkpoint('Move layers');
  const originals = new Map(nodes.map(item => [item.id, { x: item.x, y: item.y }]));
  state.interaction = { kind: 'move', start: world, originals, shiftKey };
}

function onCanvasPointerDown(event) {
  if (event.button !== 0 && event.button !== 1) return;
  state.pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType });
  canvas.setPointerCapture?.(event.pointerId);
  if (state.pointerMap.size === 2 && [...state.pointerMap.values()].every(point => point.pointerType !== 'mouse')) {
    const points = [...state.pointerMap.values()];
    state.interaction = { kind: 'pinch', distance: checkPointDistance(points[0], points[1]), zoom: state.zoom, center: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, panX: state.panX, panY: state.panY };
    event.preventDefault(); return;
  }
  if (event.button === 1 || state.spaceDown || state.tool === 'hand') {
    state.interaction = { kind: 'pan', clientX: event.clientX, clientY: event.clientY, panX: state.panX, panY: state.panY };
    canvas.classList.add('is-panning'); event.preventDefault(); return;
  }
  const world = screenToWorld(event, canvas, state);
  const commentPin = commentPinAt(world);
  if (commentPin) { openCommentThread(commentPin.id); event.preventDefault(); return; }
  if (state.tool === 'comment') { beginCommentAt(world); event.preventDefault(); return; }
  if (state.prototypeSourceId) {
    const target = findFrameAtPoint(activePage(), world);
    if (!target) { showToast('Choose a frame as the interaction destination.'); return; }
    if (target.id === state.prototypeSourceId) { showToast('Choose a different destination frame.'); return; }
    try {
      checkpoint('Add prototype interaction');
      addPrototypeInteraction(state.document, state.prototypeSourceId, target.id, {
        action: state.prototypeAction,
        trigger: state.prototypeTrigger,
        transition: state.prototypeTransition,
        easing: state.prototypeEasing,
        duration: state.prototypeDuration,
        overlayPosition: state.prototypeOverlayPosition,
        overlayOutsideClick: state.prototypeOverlayOutsideClick,
        overlayBackground: state.prototypeOverlayBackground,
        overlayBackgroundColor: state.prototypeOverlayBackgroundColor,
        overlayBackgroundOpacity: state.prototypeOverlayBackgroundOpacity
      });
      state.prototypeSourceId = null;
      renderInspector(); queueSave(); renderer.invalidate();
      showToast(state.prototypeAction === 'open-overlay' ? `Overlay “${target.name}” added.` : `Connected to “${target.name}”.`);
    } catch (error) { showToast(error.message); }
    event.preventDefault(); return;
  }
  if (state.tool === 'pen') { startPenPath(world, event.pointerType); event.preventDefault(); return; }
  if (state.tool === 'select') {
    const vectorControl = vectorPathControlAt(world, event.pointerType);
    if (vectorControl) {
      if (vectorControl.node.type === 'network') {
        state.selectedVectorPoint = vectorControl.part === 'anchor' ? { nodeId: vectorControl.node.id, vertexId: vectorControl.vertexId } : null;
        checkpoint('Edit vector network');
        state.interaction = { kind: 'network-control', ...vectorControl };
      } else {
        state.selectedVectorPoint = { nodeId: vectorControl.node.id, index: vectorControl.index };
        checkpoint('Edit vector path');
        state.interaction = { kind: 'vector-control', ...vectorControl };
      }
      event.preventDefault(); return;
    }
    const handle = resizeHandleAt(event);
    if (handle) {
      checkpoint('Resize layer');
      state.interaction = { kind: 'resize', handle: handle.name, node: handle.node, entry: handle.entry, start: world, x: handle.node.x, y: handle.node.y, width: handle.node.width, height: handle.node.height, aspect: handle.node.height ? handle.node.width / handle.node.height : 1 };
      if (handle.node.type === 'frame') state.interaction.childGeometry = captureChildGeometry(handle.node);
      event.preventDefault(); return;
    }
    const hit = hitTestPage(activePage(), world, (node, point, x, y) => renderer?.hitTestBoolean(node, point, x, y) ?? true, state.document);
    if (hit) {
      if (event.shiftKey) {
        const ids = state.selectedIds.includes(hit.id) ? state.selectedIds.filter(id => id !== hit.id) : [...state.selectedIds, hit.id];
        setSelection(ids);
        if (!ids.includes(hit.id)) return;
      } else if (!state.selectedIds.includes(hit.id)) setSelection([hit.id]);
      if (!hit.locked) selectedNodeDragStart(hit, world, event.shiftKey);
      return;
    }
    if (!event.shiftKey) setSelection([]);
    state.marquee = { x1: world.x, y1: world.y, x2: world.x, y2: world.y };
    state.interaction = { kind: 'marquee', start: world, additive: event.shiftKey };
    renderer.invalidate(); return;
  }
  if (state.tool === 'image') { $('#image-input').click(); return; }
  if (state.tool === 'text') { createTextAt(world); return; }
  const typeByTool = { frame: 'frame', section: 'section', rectangle: 'rectangle', ellipse: 'ellipse', line: 'line', polygon: 'polygon' };
  const type = typeByTool[state.tool];
  if (!type) return;
  const node = createNode(type, { x: world.x, y: world.y, width: 1, height: 1 });
  state.draftNode = node;
  state.interaction = { kind: 'draw', type, start: world, moved: false };
  renderer.invalidate();
  event.preventDefault();
}

function onCanvasPointerMove(event) {
  if (state.pointerMap.has(event.pointerId)) state.pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType });
  const interaction = state.interaction;
  if (!interaction) {
    if (state.penDraft && state.tool === 'pen') { state.penHover = screenToWorld(event, canvas, state); renderer.invalidate(); }
    return;
  }
  if (interaction.kind === 'pinch' && state.pointerMap.size >= 2) {
    const points = [...state.pointerMap.values()];
    const distance = checkPointDistance(points[0], points[1]);
    const nextZoom = Math.max(.08, Math.min(8, interaction.zoom * (distance / Math.max(1, interaction.distance))));
    const rect = canvas.getBoundingClientRect();
    const centerX = (points[0].x + points[1].x) / 2 - rect.left;
    const centerY = (points[0].y + points[1].y) / 2 - rect.top;
    const worldX = (centerX - interaction.panX) / interaction.zoom;
    const worldY = (centerY - interaction.panY) / interaction.zoom;
    state.zoom = nextZoom; state.panX = centerX - worldX * nextZoom; state.panY = centerY - worldY * nextZoom;
    updateZoomUI(); renderer.invalidate(); return;
  }
  if (interaction.kind === 'pan') {
    state.panX = interaction.panX + event.clientX - interaction.clientX;
    state.panY = interaction.panY + event.clientY - interaction.clientY;
    renderer.invalidate(); return;
  }
  const world = screenToWorld(event, canvas, state);
  if (interaction.kind === 'pen-anchor') {
    const point = state.penDraft?.anchors[interaction.pointIndex];
    if (!point) return;
    interaction.moved ||= checkPointDistance(world, interaction.start) > 3 / state.zoom;
    const network = interaction.networkNodeId ? findNode(state.document, interaction.networkNodeId)?.node : null;
    const anchorWorld = network ? unrotateForPath(world, network, absolutePosition(network.id)) : world;
    point.out = { ...anchorWorld };
    point.in = { x: point.x - (anchorWorld.x - point.x), y: point.y - (anchorWorld.y - point.y) };
    state.penHover = world; renderer.invalidate(); return;
  }
  if (interaction.kind === 'vector-control') {
    const local = unrotateForPath(world, interaction.node, interaction.origin);
    setVectorNodePoint(interaction.node, interaction.index, interaction.part, local, {
      origin: interaction.origin,
      symmetric: interaction.part !== 'anchor' && !event.altKey
    });
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'network-control') {
    const local = unrotateForPath(world, interaction.node, interaction.origin);
    if (interaction.part === 'anchor') setVectorNetworkVertexPoint(interaction.node, interaction.vertexId, local, interaction.origin);
    else setVectorNetworkEdgeControlPoint(interaction.node, interaction.edgeId, interaction.part, local, interaction.origin);
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'move') {
    let dx = world.x - interaction.start.x; let dy = world.y - interaction.start.y;
    if (state.document.settings.snap && !event.altKey) { const grid = state.document.settings.grid || 8; dx = Math.round(dx / grid) * grid; dy = Math.round(dy / grid) * grid; }
    for (const [id, original] of interaction.originals) updateNode(state.document, id, { x: original.x + dx, y: original.y + dy });
    $('#position-status').textContent = `${Math.round(dx)}, ${Math.round(dy)} moved`;
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'reorder') {
    const parent = interaction.parent;
    const parentWorld = absolutePosition(parent.id);
    const axis = parent.autoLayout.axis;
    const localMain = axis === 'horizontal' ? world.x - parentWorld.x : world.y - parentWorld.y;
    const siblings = parent.children.filter(item => item.id !== interaction.node.id && item.visible && item.layoutPositioning !== 'absolute');
    const targetIndex = siblings.findIndex(item => {
      const center = axis === 'horizontal' ? item.x + item.width / 2 : item.y + item.height / 2;
      return localMain < center;
    });
    const currentIndex = parent.children.findIndex(item => item.id === interaction.node.id);
    const [moving] = parent.children.splice(currentIndex, 1);
    const insertionIndex = targetIndex < 0 ? parent.children.length : Math.min(parent.children.length, targetIndex > currentIndex ? targetIndex - 1 : targetIndex);
    parent.children.splice(insertionIndex, 0, moving);
    applyAutoLayout(parent);
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'resize') {
    const dx = world.x - interaction.start.x; const dy = world.y - interaction.start.y;
    let x = interaction.x; let y = interaction.y; let width = interaction.width; let height = interaction.height;
    if (interaction.handle.includes('e')) width = Math.max(1, interaction.width + dx);
    if (interaction.handle.includes('s')) height = Math.max(1, interaction.height + dy);
    if (interaction.handle.includes('w')) { width = Math.max(1, interaction.width - dx); x = interaction.x + interaction.width - width; }
    if (interaction.handle.includes('n')) { height = Math.max(1, interaction.height - dy); y = interaction.y + interaction.height - height; }
    if (event.shiftKey && interaction.aspect) {
      if (Math.abs(dx) >= Math.abs(dy)) height = width / interaction.aspect;
      else width = height * interaction.aspect;
      if (interaction.handle.includes('w')) x = interaction.x + interaction.width - width;
      if (interaction.handle.includes('n')) y = interaction.y + interaction.height - height;
    }
    Object.assign(interaction.node, { x, y, width, height });
    if (interaction.node.type === 'frame' && interaction.node.autoLayout) applyAutoLayout(interaction.node);
    else if (interaction.node.type === 'frame') applyFrameConstraints(interaction.node, interaction.width, interaction.height, width, height, interaction.childGeometry);
    const parent = findNode(state.document, interaction.node.id)?.parent;
    if (parent?.autoLayout) applyAutoLayout(parent);
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'draw') {
    const dx = world.x - interaction.start.x; const dy = world.y - interaction.start.y;
    interaction.moved ||= Math.hypot(dx, dy) > 4 / state.zoom;
    const node = state.draftNode;
    const left = Math.min(interaction.start.x, world.x); const top = Math.min(interaction.start.y, world.y);
    node.x = left; node.y = top; node.width = Math.max(1, Math.abs(dx)); node.height = Math.max(1, Math.abs(dy));
    if (node.type === 'path') node.points = [{ x: dx < 0 ? 1 : 0, y: dy < 0 ? 1 : 0 }, { x: dx < 0 ? 0 : 1, y: dy < 0 ? 0 : 1 }];
    state.draftNode = node; renderer.invalidate(); return;
  }
  if (interaction.kind === 'marquee') {
    state.marquee.x2 = world.x; state.marquee.y2 = world.y; renderer.invalidate();
  }
}

function onCanvasPointerUp(event) {
  state.pointerMap.delete(event.pointerId);
  const interaction = state.interaction;
  if (!interaction) return;
  if (interaction.kind === 'pinch' && state.pointerMap.size < 2) { state.interaction = null; return; }
  if (interaction.kind === 'pan') { canvas.classList.remove('is-panning'); state.interaction = null; return; }
  if (interaction.kind === 'pen-anchor') {
    const point = state.penDraft?.anchors[interaction.pointIndex];
    if (point && !interaction.moved) { point.in = { x: point.x, y: point.y }; point.out = { x: point.x, y: point.y }; }
    state.interaction = null; renderer.invalidate(); return;
  }
  if (interaction.kind === 'vector-control') {
    recordNodeComponentOverrides(interaction.node, ['points']);
    state.interaction = null; renderInspector(); queueSave(); renderer.invalidate(); return;
  }
  if (interaction.kind === 'network-control') {
    recordNodeComponentOverrides(interaction.node, ['vertices', 'edges', 'faces']);
    state.interaction = null; renderInspector(); queueSave(); renderer.invalidate(); return;
  }
  if (interaction.kind === 'move' || interaction.kind === 'resize' || interaction.kind === 'reorder') {
    const editedIds = interaction.kind === 'move' ? [...interaction.originals.keys()] : interaction.node ? [interaction.node.id] : [];
    if (interaction.kind === 'reorder') editedIds.push(interaction.parent?.id);
    for (const id of editedIds.filter(Boolean)) {
      const node = findNode(state.document, id)?.node;
      if (!node) continue;
      if (interaction.kind === 'reorder') {
        const instanceRoot = componentInstanceRoot(id);
        if (instanceRoot && node.componentSourceId) {
          instanceRoot.componentOverrides ||= {};
          instanceRoot.componentOverrides[node.componentSourceId] ||= {};
          instanceRoot.componentOverrides[node.componentSourceId].__childOrder = node.children.map(child => child.componentSourceId);
        }
      } else recordNodeComponentOverrides(node, interaction.kind === 'resize' ? ['x', 'y', 'width', 'height'] : ['x', 'y']);
    }
    if (interaction.kind === 'resize' && interaction.node?.type === 'frame') {
      const instanceRoot = componentInstanceRoot(interaction.node.id);
      if (instanceRoot) walkNodes(interaction.node.children || [], ({ node }) => recordNodeComponentOverrides(node, ['x', 'y', 'width', 'height']));
    }
    state.interaction = null; renderLayers(); renderInspector(); queueSave(); renderer.invalidate(); return;
  }
  if (interaction.kind === 'marquee') {
    const rect = { x: Math.min(state.marquee.x1, state.marquee.x2), y: Math.min(state.marquee.y1, state.marquee.y2), width: Math.abs(state.marquee.x2 - state.marquee.x1), height: Math.abs(state.marquee.y2 - state.marquee.y1) };
    const hits = pageLayerRows().filter(({ node, parents }) => {
      let x = node.x; let y = node.y; for (const parent of parents) { x += parent.x; y += parent.y; }
      return x <= rect.x + rect.width && x + node.width >= rect.x && y <= rect.y + rect.height && y + node.height >= rect.y;
    }).map(entry => entry.node.id);
    setSelection(interaction.additive ? [...state.selectedIds, ...hits] : hits);
    state.marquee = null; state.interaction = null; renderer.invalidate(); return;
  }
  if (interaction.kind === 'draw') {
    const node = state.draftNode;
    state.draftNode = null; state.interaction = null;
    if (!interaction.moved) {
      if (node.type === 'frame') { node.width = 390; node.height = 844; }
      else if (node.type === 'section') { node.width = 480; node.height = 320; }
      else if (node.type === 'line' || node.type === 'path') { node.width = 120; node.height = 1; if (node.type === 'path') node.points = [{ x: 0, y: 0 }, { x: 1, y: 0 }]; }
      else { node.width = 120; node.height = 80; }
      node.x -= node.width / 2; node.y -= node.height / 2;
    }
    checkpoint(`Create ${node.type}`);
    const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    const parent = node.type === 'section' ? null : deepestContainerAt(center);
    localizeToParent(node, node.x, node.y, parent);
    setSelection([node.id]); queueSave(); renderer.invalidate(); return;
  }
}

function resizeTextNode(node) {
  if (node?.type !== 'text') return false;
  textMeasureContext ||= document.createElement('canvas').getContext('2d');
  if (!textMeasureContext) return false;
  const before = { width: node.width, height: node.height };
  const size = calculateTextBox(textMeasureContext, node, {
    fontSize: getNodePropertyValue(state.document, node, 'fontSize'),
    lineHeight: getNodePropertyValue(state.document, node, 'lineHeight'),
    letterSpacing: getNodePropertyValue(state.document, node, 'letterSpacing'),
    text: getNodePropertyValue(state.document, node, 'text')
  });
  node.width = size.width; node.height = size.height;
  return before.width !== size.width || before.height !== size.height;
}

function resizeTextLayers(roots, variableId = null) {
  const layoutParents = new Set();
  walkNodes(roots, ({ node, parent }) => {
    if (node.type !== 'text') return;
    const bindings = node.variableBindings || {};
    const sizeProperties = ['text', 'fontSize', 'lineHeight', 'letterSpacing'];
    if (variableId && !sizeProperties.some(property => bindings[property] === variableId)) return;
    if (!variableId && !sizeProperties.some(property => bindings[property])) return;
    if (resizeTextNode(node) && parent?.autoLayout) layoutParents.add(parent);
  });
  for (const parent of layoutParents) applyAutoLayout(parent);
}

function createTextAt(world) {
  const node = createNode('text', { x: world.x, y: world.y, text: '', width: 240, height: 48 });
  checkpoint('Create text');
  const parent = deepestContainerAt(world);
  localizeToParent(node, world.x, world.y, parent);
  setSelection([node.id]);
  queueSave();
  editTextNode(node.id);
}

function editTextNode(nodeId) {
  const entry = findNode(state.document, nodeId);
  if (!entry || entry.node.type !== 'text') return;
  state.textNodeId = nodeId;
  const editor = $('#text-editor-overlay');
  const absolute = absolutePosition(nodeId);
  const screen = worldToScreen(absolute, canvas, state);
  const canvasRect = canvasScroll.getBoundingClientRect();
  editor.style.left = `${screen.x - canvasRect.left}px`;
  editor.style.top = `${screen.y - canvasRect.top}px`;
  editor.style.width = entry.node.textFit === 'auto-width' ? 'max-content' : `${Math.max(64, entry.node.width * state.zoom)}px`;
  editor.style.minHeight = `${Math.max(28, entry.node.height * state.zoom)}px`;
  editor.style.whiteSpace = entry.node.textFit === 'auto-width' ? 'pre' : 'pre-wrap';
  editor.style.fontFamily = entry.node.fontFamily;
  editor.style.fontWeight = String(entry.node.fontWeight || 400);
  editor.style.fontSize = `${getNodePropertyValue(state.document, entry.node, 'fontSize') * state.zoom}px`;
  editor.style.lineHeight = String(getNodePropertyValue(state.document, entry.node, 'lineHeight'));
  editor.style.letterSpacing = `${getNodePropertyValue(state.document, entry.node, 'letterSpacing') * state.zoom}px`;
  editor.style.color = getNodeColor(state.document, entry.node, 'text');
  const text = getNodePropertyValue(state.document, entry.node, 'text');
  editor.textContent = text;
  editor.hidden = false; editor.focus();
  if (!text) document.execCommand?.('selectAll', false, null);
}

function absolutePosition(nodeId) {
  const entry = findNode(state.document, nodeId);
  if (!entry) return { x: 0, y: 0 };
  let x = entry.node.x; let y = entry.node.y;
  for (const parent of entry.parents) { x += parent.x; y += parent.y; }
  return { x, y };
}

function commitTextEdit() {
  const editor = $('#text-editor-overlay');
  if (!state.textNodeId) return;
  const node = findNode(state.document, state.textNodeId)?.node;
  if (node) {
    const oldWidth = node.width; const oldHeight = node.height;
    setNodePropertyValue(node, 'text', editor.innerText.replace(/\n$/, ''));
    node.textFit ||= 'auto-height';
    resizeTextNode(node);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, node.variableBindings?.text ? 'variableBindings' : 'text');
    if (instanceRoot && node.width !== oldWidth) recordComponentOverride(instanceRoot, node, 'width');
    if (instanceRoot && node.height !== oldHeight) recordComponentOverride(instanceRoot, node, 'height');
    const parent = findNode(state.document, node.id)?.parent;
    if (parent?.autoLayout) applyAutoLayout(parent);
  }
  editor.hidden = true; state.textNodeId = null;
  renderInspector(); renderLayers(); queueSave(); renderer.invalidate();
}

function updateZoomUI() {
  $('#zoom-readout').textContent = `${Math.round(state.zoom * 100)}%`;
  updateSelectionStatus();
}
function zoomAt(clientX, clientY, nextZoom) {
  const rect = canvas.getBoundingClientRect();
  const px = clientX == null ? rect.width / 2 : clientX - rect.left;
  const py = clientY == null ? rect.height / 2 : clientY - rect.top;
  const worldX = (px - state.panX) / state.zoom; const worldY = (py - state.panY) / state.zoom;
  state.zoom = Math.max(.08, Math.min(8, nextZoom));
  state.panX = px - worldX * state.zoom; state.panY = py - worldY * state.zoom;
  updateZoomUI(); renderer.invalidate();
}
function zoomToSelection() {
  const entries = selectedEntries();
  const ids = entries.length ? entries.map(entry => entry.node.id) : pageLayerRows().filter(entry => entry.node.type === 'frame').map(entry => entry.node.id);
  if (!ids.length) { state.zoom = 1; state.panX = canvas.clientWidth / 2; state.panY = canvas.clientHeight / 2; updateZoomUI(); renderer.invalidate(); return; }
  const bounds = ids.map(id => absolutePosition(id)).map((position, index) => ({ ...position, width: findNode(state.document, ids[index]).node.width, height: findNode(state.document, ids[index]).node.height }));
  const x = Math.min(...bounds.map(item => item.x)); const y = Math.min(...bounds.map(item => item.y));
  const right = Math.max(...bounds.map(item => item.x + item.width)); const bottom = Math.max(...bounds.map(item => item.y + item.height));
  const zoom = Math.min(2, (canvas.clientWidth - 100) / Math.max(1, right - x), (canvas.clientHeight - 100) / Math.max(1, bottom - y));
  state.zoom = Math.max(.08, zoom); state.panX = (canvas.clientWidth - (right - x) * state.zoom) / 2 - x * state.zoom; state.panY = (canvas.clientHeight - (bottom - y) * state.zoom) / 2 - y * state.zoom;
  updateZoomUI(); renderer.invalidate();
}

function updateLayerEffectInput(input) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  const effect = node?.effects?.find(item => item.id === input.dataset.effectId);
  if (!effect || node.locked) return;
  if (!state.controlEdit) { checkpoint('Edit layer effect'); state.controlEdit = true; }
  const field = input.dataset.effectField;
  if (field === 'visible') effect.visible = input.checked;
  else if (field === 'color') effect.color = input.value;
  else if (field === 'opacity') {
    effect.opacity = Number(input.value) / 100;
    input.nextElementSibling.value = `${input.value}%`;
  } else if (['offsetX', 'offsetY', 'blur', 'radius'].includes(field) && Number.isFinite(Number(input.value))) effect[field] = Number(input.value);
  else return;
  recordNodeComponentOverrides(node, ['effects']);
  renderer.invalidate();
}

function updateInspectorInput(event) {
  const input = event.target.closest('[data-prop]');
  if (!input || !selectedNodes().length) return;
  if (!state.controlEdit) { checkpoint('Edit properties'); state.controlEdit = true; }
  const prop = input.dataset.prop;
  const value = input.dataset.optionalNumber !== undefined && !input.value.trim() ? null : input.type === 'checkbox' ? input.checked : input.type === 'number' || input.type === 'range' ? Number(input.value) : input.value;
  const propertyValue = prop === 'opacity' ? value / 100 : value;
  if (input.type === 'range' && input.nextElementSibling) input.nextElementSibling.value = `${Math.round(value)}${prop === 'opacity' ? '%' : ''}`;
  const adjustments = prop.startsWith('adjustments.');
  const layoutSetting = prop.startsWith('autoLayout.');
  const constraintSetting = prop.startsWith('constraints.');
  const gridCellSetting = prop.startsWith('gridCell.');
  const key = adjustments ? prop.slice('adjustments.'.length) : layoutSetting ? prop.slice('autoLayout.'.length) : constraintSetting ? prop.slice('constraints.'.length) : prop;
  for (const node of selectedNodes()) {
    const instanceRoot = componentInstanceRoot(node.id);
    const oldWidth = node.width; const oldHeight = node.height;
    let adjustedSizeLimit = null;
    const variableProperty = prop === 'fill' ? 'fillVariableId' : prop === 'color' ? 'textVariableId' : prop === 'stroke' ? 'strokeVariableId' : null;
    const boundVariableId = node.variableBindings?.[prop];
    if (boundVariableId) setNodePropertyValue(node, prop, propertyValue);
    else if (adjustments) node.adjustments = { ...node.adjustments, [key]: value };
    else if (constraintSetting) { node.constraints = { horizontal: 'left', vertical: 'top', ...(node.constraints || {}), [key]: value }; }
    else if (variableProperty && instanceRoot) { delete node[variableProperty]; if (prop === 'fill') delete node.fillStyleId; if (prop === 'color') delete node.textStyleId; node[prop] = value; }
    else if (prop === 'fill' && node.fillVariableId) setColorVariableValue(state.document, node.fillVariableId, value, variableModeForNode(state.document, state.document.variables.find(item => item.id === node.fillVariableId)?.collectionId, node));
    else if (prop === 'color' && node.textVariableId) setColorVariableValue(state.document, node.textVariableId, value, variableModeForNode(state.document, state.document.variables.find(item => item.id === node.textVariableId)?.collectionId, node));
    else if (prop === 'stroke' && node.strokeVariableId) setColorVariableValue(state.document, node.strokeVariableId, value, variableModeForNode(state.document, state.document.variables.find(item => item.id === node.strokeVariableId)?.collectionId, node));
    else if (prop === 'fill' && instanceRoot) { delete node.fillStyleId; node.fill = value; }
    else if (prop === 'color' && instanceRoot) { delete node.textStyleId; node.color = value; }
    else if (prop === 'fill' && node.fillStyleId) {
      const style = state.document.colorStyles?.find(item => item.id === node.fillStyleId);
      if (style) style.value = value; else node.fill = value;
    } else if (prop === 'color' && node.textStyleId) {
      const style = state.document.colorStyles?.find(item => item.id === node.textStyleId);
      if (style) style.value = value; else node.color = value;
    }
    else if (layoutSetting) {
      node.autoLayout = createAutoLayout(node.autoLayout || {});
      if (key.startsWith('padding.')) {
        const side = key.slice('padding.'.length);
        if (['top', 'right', 'bottom', 'left'].includes(side)) node.autoLayout.padding[side] = value;
      } else node.autoLayout[key] = value;
      applyAutoLayout(node);
    } else if (gridCellSetting) {
      const parent = findNode(state.document, node.id)?.parent;
      node.gridCell ||= {};
      node.gridCell[key.slice('gridCell.'.length)] = value;
      if (parent?.autoLayout) applyAutoLayout(parent);
    } else if (['minWidth', 'maxWidth', 'minHeight', 'maxHeight'].includes(prop)) {
      node[prop] = propertyValue;
      const pair = { minWidth: 'maxWidth', maxWidth: 'minWidth', minHeight: 'maxHeight', maxHeight: 'minHeight' }[prop];
      if (propertyValue != null && Number.isFinite(node[pair]) && ((prop.startsWith('min') && propertyValue > node[pair]) || (prop.startsWith('max') && propertyValue < node[pair]))) {
        node[pair] = propertyValue;
        adjustedSizeLimit = pair;
      }
      const parent = findNode(state.document, node.id)?.parent;
      if (node.type === 'frame' && node.autoLayout) applyAutoLayout(node);
      if (parent?.autoLayout) applyAutoLayout(parent);
    }
    else if (prop === 'opacity' || prop === 'fillOpacity') node[prop] = value / 100;
    else node[prop] = value;
    if (node.type === 'text' && ['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textFit', 'text', 'width'].includes(prop)) {
      const resized = resizeTextNode(node);
      const parent = findNode(state.document, node.id)?.parent;
      if (boundVariableId && ['text', 'fontSize', 'lineHeight', 'letterSpacing'].includes(prop)) resizeTextLayers(state.document.pages.flatMap(page => page.children), boundVariableId);
      else if (resized && parent?.autoLayout) applyAutoLayout(parent);
    }
    if ((prop === 'width' || prop === 'height') && node.type === 'frame' && !node.autoLayout) applyFrameConstraints(node, oldWidth, oldHeight, node.width, node.height);
    if (node.type === 'image' && adjustments) schedulePreview(node);
    if (prop === 'width' || prop === 'height' || prop === 'layoutSizingMain' || prop === 'layoutSizingCross' || prop === 'layoutSizingX' || prop === 'layoutSizingY') {
      if (node.type === 'frame' && node.autoLayout) applyAutoLayout(node);
      const parent = findNode(state.document, node.id)?.parent;
      if (parent?.autoLayout) applyAutoLayout(parent);
    }
    if (instanceRoot) {
      recordComponentOverride(instanceRoot, node, boundVariableId ? 'variableBindings' : layoutSetting ? 'autoLayout' : gridCellSetting ? 'gridCell' : prop);
      if (node.width !== oldWidth) recordComponentOverride(instanceRoot, node, 'width');
      if (node.height !== oldHeight) recordComponentOverride(instanceRoot, node, 'height');
      if (adjustedSizeLimit) recordComponentOverride(instanceRoot, node, adjustedSizeLimit);
    }
  }
  renderer.invalidate();
}

function updateNetworkFaceInput(input) {
  const node = selectedNodes().length === 1 && selectedNodes()[0].type === 'network' ? selectedNodes()[0] : null;
  const face = node?.faces?.find(item => item.id === input.dataset.networkFaceFill || item.id === input.dataset.networkFaceOpacity);
  if (!node || node.locked || !face) return;
  if (!state.controlEdit) { checkpoint('Edit vector region'); state.controlEdit = true; }
  if (input.matches('[data-network-face-fill]')) face.fill = input.value;
  else {
    face.fillOpacity = Number(input.value) / 100;
    input.parentElement.parentElement.querySelector('output').value = `${input.value}%`;
  }
  recordNodeComponentOverrides(node, ['faces']);
  renderer.invalidate();
}

function finishInspectorInput() {
  if (!state.controlEdit) return;
  clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(() => { state.controlEdit = false; renderLayers(); renderInspector(); renderAssetsTab(); queueSave(); }, 160);
}
function schedulePreview(node, immediate = false) {
  const previous = previewTimers.get(node.id);
  if (previous) clearTimeout(previous);
  state.imageStatus.set(node.id, 'Updating preview…');
  const run = () => renderImagePreview(node.id, node.assetId, node.adjustments).catch(error => { state.imageStatus.set(node.id, 'Preview failed'); showToast(error.message); renderInspector(); });
  const timer = setTimeout(run, immediate ? 0 : 110);
  previewTimers.set(node.id, timer);
  if (state.selectedIds.includes(node.id)) {
    const status = $('#image-engine-status'); if (status) { status.textContent = 'Updating preview…'; status.classList.remove('image-engine-status'); }
  }
}
async function renderImagePreview(nodeId, assetId, adjustments) {
  const asset = state.assets.get(assetId);
  if (!asset?.sourceBytes) throw new Error('The original image could not be found on this device.');
  const version = (state.renderVersion.get(nodeId) || 0) + 1;
  state.renderVersion.set(nodeId, version);
  state.imageStatus.set(nodeId, 'Processing locally…');
  const result = await imageEngine.render(assetId, asset.sourceBytes, adjustments);
  const bitmap = await createImageBitmap(new Blob([result.bytes], { type: 'image/png' }));
  if (state.renderVersion.get(nodeId) !== version) { bitmap.close?.(); return false; }
  state.previews.get(nodeId)?.close?.();
  const previousUrl = state.previewUrls.get(nodeId); if (previousUrl) URL.revokeObjectURL(previousUrl);
  state.previewUrls.set(nodeId, URL.createObjectURL(new Blob([result.bytes], { type: 'image/png' })));
  state.previews.set(nodeId, bitmap);
  state.imageStatus.set(nodeId, 'Updated · Pillow-RS WASM');
  renderer.invalidate(); renderAssetsTab();
  if (state.selectedIds.includes(nodeId)) { const status = $('#image-engine-status'); if (status) { status.textContent = 'Updated · Pillow-RS WASM'; status.classList.add('image-engine-status'); } }
  return true;
}

function setZoomButtonHandlers() {
  $('#zoom-in').addEventListener('click', () => zoomAt(null, null, state.zoom * 1.2));
  $('#zoom-out').addEventListener('click', () => zoomAt(null, null, state.zoom / 1.2));
  $('#zoom-readout').addEventListener('click', () => zoomAt(null, null, 1));
  $('#zoom-fit').addEventListener('click', zoomToSelection);
  canvas.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) { zoomAt(event.clientX, event.clientY, state.zoom * Math.exp(-event.deltaY * .002)); }
    else { state.panX -= event.deltaX; state.panY -= event.deltaY; renderer.invalidate(); }
    event.preventDefault();
  }, { passive: false });
}

function chooseImageFiles() { $('#image-input').click(); }
async function importImageFiles(files, point = null) {
  const inputs = [...files].filter(file => file.type.startsWith('image/'));
  if (!inputs.length) { showToast('Choose an image file to place it on the canvas.'); return; }
  checkpoint(`Place ${inputs.length} image${inputs.length === 1 ? '' : 's'}`);
  const defaultWorld = point || { x: (canvas.clientWidth / 2 - state.panX) / state.zoom, y: (canvas.clientHeight / 2 - state.panY) / state.zoom };
  let imported = 0;
  for (const [index, file] of inputs.entries()) {
    try {
      const assetId = createId('asset');
      const sourceBytes = new Uint8Array(await file.arrayBuffer());
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale)); const height = Math.max(1, Math.round(bitmap.height * scale));
      const asset = { id: assetId, name: file.name, type: file.type, sourceBytes, bitmap, bitmapUrl: URL.createObjectURL(file) };
      state.assets.set(assetId, asset);
      await saveImageAsset(assetId, file);
      const node = createNode('image', { id: createId('image'), name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, assetId, width, height, sourceWidth: bitmap.width, sourceHeight: bitmap.height, x: defaultWorld.x - width / 2 + index * 24, y: defaultWorld.y - height / 2 + index * 24, fit: 'cover' });
      localizeToParent(node, node.x, node.y, deepestContainerAt({ x: node.x + width / 2, y: node.y + height / 2 }));
      state.imageStatus.set(node.id, 'Processing locally…');
      renderImagePreview(node.id, assetId, node.adjustments).catch(error => { state.imageStatus.set(node.id, 'Preview failed'); showToast(error.message); });
      state.selectedIds = [node.id]; imported += 1;
    } catch (error) { showToast(`${file.name}: ${error.message || 'Could not load image.'}`); }
  }
  if (imported) { renderUI(); queueSave(); showToast(`${imported} image${imported === 1 ? '' : 's'} placed. Source images stay on this device.`); }
  $('#image-input').value = '';
}

async function restoreImageAssets() {
  const nodes = imageNodesAcrossPages();
  for (const node of nodes) {
    try {
      const existing = state.assets.get(node.assetId);
      if (existing) { renderImagePreview(node.id, node.assetId, node.adjustments).catch(error => showToast(error.message)); continue; }
      const saved = await loadImageAsset(node.assetId);
      if (!saved) { state.imageStatus.set(node.id, 'Original image missing'); continue; }
      const sourceBytes = new Uint8Array(saved.bytes);
      const bitmap = await createImageBitmap(new Blob([sourceBytes], { type: saved.type || 'image/png' }));
      state.assets.set(node.assetId, { id: node.assetId, name: saved.name || node.name, type: saved.type, sourceBytes, bitmap, bitmapUrl: URL.createObjectURL(new Blob([sourceBytes], { type: saved.type || 'image/png' })) });
      state.imageStatus.set(node.id, 'Restoring local preview…');
      renderImagePreview(node.id, node.assetId, node.adjustments).catch(error => { state.imageStatus.set(node.id, 'Preview failed'); showToast(error.message); });
    } catch (error) { state.imageStatus.set(node.id, 'Could not restore image'); showToast(error.message); }
  }
  renderAssetsTab();
}

function renderBulkBar() {
  const bar = $('#bulk-bar'); const bulk = state.bulk;
  bar.hidden = !bulk;
  if (!bulk) return;
  const total = bulk.targets.length;
  $('#bulk-title').textContent = bulk.cancelled ? 'Recipe stopped' : bulk.done ? (bulk.failed ? 'Recipe finished with errors' : 'Recipe applied') : bulk.paused ? 'Processing paused' : `Applying ${bulk.recipe.name}`;
  $('#bulk-subtitle').textContent = bulk.cancelled ? `${bulk.completed} completed · ${bulk.targets.length - bulk.completed} left untouched` : bulk.done ? `${bulk.completed} updated${bulk.failed ? ` · ${bulk.failed} failed` : ''} in place` : bulk.paused ? `${bulk.inflight} image${bulk.inflight === 1 ? '' : 's'} finishing before pause` : `Editing original layers · ${bulk.inflight} active`;
  $('#bulk-progress-fill').style.width = `${total ? Math.min(100, (bulk.completed / total) * 100) : 0}%`;
  $('#bulk-progress-label').textContent = `${bulk.completed} / ${total}`;
  $('#bulk-speed').value = bulk.concurrency;
  $('#bulk-speed-value').textContent = `${bulk.concurrency} worker${bulk.concurrency === 1 ? '' : 's'}`;
  $('#bulk-spinner').classList.toggle('is-done', bulk.done || bulk.cancelled);
  $('#bulk-spinner').classList.toggle('is-paused', bulk.paused);
  $('#bulk-pause').hidden = bulk.done || bulk.cancelled;
  $('#bulk-pause').textContent = bulk.paused ? 'Resume' : 'Pause';
  $('#bulk-cancel').hidden = bulk.done || bulk.cancelled;
  $('#bulk-done').hidden = !(bulk.done || bulk.cancelled);
}

function scheduleBulk() {
  const bulk = state.bulk;
  if (!bulk || bulk.paused || bulk.cancelled || bulk.done) return;
  while (bulk.inflight < bulk.concurrency && bulk.next < bulk.targets.length) {
    const id = bulk.targets[bulk.next++];
    const entry = findNode(state.document, id);
    if (!entry || entry.node.type !== 'image') { bulk.failed += 1; bulk.completed += 1; continue; }
    const node = entry.node; const oldAdjustments = { ...node.adjustments }; const oldFit = node.fit; const oldOpacity = node.opacity;
    applyImageRecipe(state.document, id, bulk.recipe);
    bulk.inflight += 1; state.imageStatus.set(id, 'Processing recipe…');
    renderImagePreview(id, node.assetId, node.adjustments).then(() => {
      if (state.bulk !== bulk) return;
      bulk.completed += 1;
    }).catch(error => {
      if (state.bulk !== bulk) return;
      node.adjustments = oldAdjustments; node.fit = oldFit; node.opacity = oldOpacity;
      state.imageStatus.set(id, 'Recipe failed'); bulk.failed += 1; bulk.completed += 1;
      showToast(`${node.name}: ${error.message}`);
    }).finally(() => {
      if (state.bulk !== bulk) return;
      bulk.inflight -= 1;
      queueSave(); renderLayers(); renderer.invalidate();
      if (!bulk.paused && !bulk.cancelled) scheduleBulk();
      if ((bulk.next >= bulk.targets.length || bulk.cancelled) && bulk.inflight === 0) {
        bulk.done = !bulk.cancelled;
        if (bulk.cancelled) bulk.done = true;
      }
      renderBulkBar();
    });
  }
  renderBulkBar();
}

function startRecipe(recipe, targets) {
  const unique = [...new Set(targets)].filter(id => findNode(state.document, id)?.node.type === 'image');
  if (!unique.length) { showToast('Select one or more image layers first.'); return; }
  checkpoint(`Apply ${recipe.name} to ${unique.length} image${unique.length === 1 ? '' : 's'}`);
  const concurrency = Math.min(2, CPU_LIMIT);
  state.bulk = { recipe, targets: unique, next: 0, completed: 0, failed: 0, inflight: 0, concurrency, paused: false, cancelled: false, done: false };
  imageEngine.setConcurrency(concurrency);
  renderBulkBar(); scheduleBulk();
}

function saveRecipeFor(nodeId) {
  const node = findNode(state.document, nodeId)?.node;
  if (!node || node.type !== 'image') return;
  pendingRecipeNodeId = nodeId;
  const adjustments = node.adjustments || {};
  const active = ['brightness', 'contrast', 'saturation', 'blur'].filter(key => Number(adjustments[key]) !== 0);
  $('#recipe-name').value = `${node.name} look`;
  $('#recipe-preview-summary').textContent = active.length ? active.map(key => `${key[0].toUpperCase()}${key.slice(1)} ${adjustments[key]}`).join(' · ') : 'Original image look · No adjustments';
  $('#recipe-dialog').showModal(); $('#recipe-name').focus(); $('#recipe-name').select();
}

function applyStyleToSelection(styleId) {
  const style = state.document.colorStyles?.find(item => item.id === styleId);
  if (!style || !state.selectedIds.length) { showToast('Select a compatible layer to apply this style.'); return; }
  const compatible = selectedNodes().filter(node => style.kind === 'text' ? node.type === 'text'
    : !['text', 'image', 'line', 'path'].includes(node.type) && (node.type !== 'network' || (node.faces || []).length > 0));
  if (!compatible.length) { showToast(style.kind === 'text' ? 'Select a text layer to apply this style.' : 'Select a shape or frame to apply this style.'); return; }
  checkpoint(`Apply ${style.name}`);
  for (const node of compatible) {
    applyColorStyle(state.document, node.id, style.id);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, style.kind === 'text' ? 'textStyleId' : 'fillStyleId');
  }
  renderUI(); queueSave();
}

function applyColorVariableToSelection(variableId, requestedKind = null) {
  if (!state.selectedIds.length) { showToast('Select a layer to bind a color variable.'); return; }
  if (variableId && !state.document.variables?.some(variable => variable.id === variableId && variable.type === 'color')) { showToast('This color variable no longer exists.'); return; }
  const nodes = selectedNodes();
  const changes = nodes.map(node => {
    const kind = requestedKind || (node.type === 'text' ? 'text' : node.type === 'line' || (node.type === 'path' && !node.closed) || (node.type === 'network' && !node.faces?.length) ? 'stroke' : 'fill');
    const compatible = kind === 'text' ? node.type === 'text'
      : kind === 'fill' ? !['text', 'image', 'line'].includes(node.type) && (node.type !== 'path' || node.closed) && (node.type !== 'network' || (node.faces || []).length > 0)
        : !['text', 'image', 'group', 'boolean'].includes(node.type);
    return compatible ? { node, kind } : null;
  }).filter(Boolean);
  if (!changes.length) { showToast('This color variable is not compatible with the selection.'); return; }
  checkpoint(variableId ? 'Bind color variable' : 'Remove color variable');
  for (const { node, kind } of changes) {
    bindColorVariable(state.document, node.id, variableId || null, kind);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, { fill: 'fillVariableId', text: 'textVariableId', stroke: 'strokeVariableId' }[kind]);
  }
  renderUI(); queueSave(); renderer.invalidate();
}

function applyVariablePropertyToSelection(property, variableId) {
  if (!state.selectedIds.length) { showToast('Select a layer before binding a variable.'); return; }
  const nodes = selectedNodes();
  const compatible = nodes.filter(node => canBindVariable(state.document, node.id, variableId || null, property));
  if (!compatible.length) { renderUI(); showToast('That variable type is not compatible with the selected layer property.'); return; }
  checkpoint(variableId ? `Bind ${property} variable` : `Unbind ${property} variable`);
  for (const node of compatible) {
    bindVariable(state.document, node.id, variableId || null, property);
    if (node.type === 'text') resizeTextLayers([node]);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'variableBindings');
  }
  renderUI(); queueSave(); renderer.invalidate();
}

function createColorVariableFromSelection(kind = null) {
  const nodes = selectedNodes();
  if (!nodes.length) { showToast('Select a layer before creating a color variable.'); return; }
  const source = nodes.find(node => kind === 'text' ? node.type === 'text' : kind === 'stroke' ? !['text', 'image', 'group', 'boolean'].includes(node.type) : !['text', 'image', 'line'].includes(node.type) && (node.type !== 'path' || node.closed) && (node.type !== 'network' || (node.faces || []).length > 0));
  if (!source) { showToast('Select a compatible color layer first.'); return; }
  const variableKind = kind || (source.type === 'text' ? 'text' : source.type === 'line' || (source.type === 'path' && !source.closed) || (source.type === 'network' && !source.faces?.length) ? 'stroke' : 'fill');
  const current = getNodeColor(state.document, source, variableKind);
  openVariableNameDialog({
    type: 'selection', colorKind: variableKind, colorValue: /^#[0-9a-f]{6}$/i.test(current) ? current : '#1e1e1e',
    title: 'Create color variable', label: 'Variable name', copy: 'Create a reusable color and bind it to the selected layer.', defaultName: `${source.name} color`
  });
}

function selectedColorForVariable() {
  const node = selectedNodes()[0];
  if (!node) return '#1e1e1e';
  return getNodeColor(state.document, node, node.type === 'text' ? 'text' : node.type === 'line' || (node.type === 'path' && !node.closed) || (node.type === 'network' && !node.faces?.length) ? 'stroke' : 'fill');
}

function handleVariableAssetsAction(action, details = {}) {
  if (action === 'add-variable-collection') {
    openVariableNameDialog({ type: 'collection', title: 'Create variable collection', label: 'Collection name', copy: 'Collections group color variables and their theme modes.', defaultName: 'Colors' });
  } else if (action === 'add-variable-mode') {
    const collection = state.document.variableCollections?.find(item => item.id === details.collectionId);
    if (!collection) return;
    openVariableNameDialog({ type: 'mode', collectionId: collection.id, title: 'Create mode', label: 'Mode name', copy: `Add a theme mode to ${collection.name}. Existing values start from the collection default mode.`, defaultName: `Mode ${collection.modes.length + 1}` });
  } else if (action === 'add-variable') {
    const collection = state.document.variableCollections?.find(item => item.id === details.collectionId);
    if (!collection) return;
    openVariableNameDialog({ type: 'variable', collectionId: collection.id, title: 'Create variable', label: 'Variable name', copy: `Add a typed design token to ${collection.name}.`, defaultName: `Variable ${(state.document.variables || []).filter(item => item.collectionId === collection.id).length + 1}` });
  } else if (action === 'delete-variable') {
    checkpoint('Delete variable'); deleteVariable(state.document, details.variableId);
  } else if (action === 'delete-variable-collection') {
    checkpoint('Delete variable collection'); deleteVariableCollection(state.document, details.collectionId);
  } else return;
  renderUI(); queueSave(); renderer.invalidate();
}

function openVariableNameDialog(options) {
  const dialog = $('#variable-dialog');
  const input = $('#variable-name');
  state.pendingVariableDialog = options;
  $('#variable-dialog-title').textContent = options.title;
  $('#variable-dialog-copy').textContent = options.copy;
  $('#variable-name-label').textContent = options.label;
  $('#variable-type-field').hidden = options.type !== 'variable';
  $('#variable-type').value = options.variableType || 'color';
  input.value = options.defaultName || '';
  dialog.returnValue = '';
  dialog.showModal();
  input.focus(); input.select();
}

function commitVariableNameDialog() {
  const pending = state.pendingVariableDialog;
  state.pendingVariableDialog = null;
  if (!pending || $('#variable-dialog').returnValue !== 'save') return;
  const name = $('#variable-name').value.trim();
  if (!name) { showToast('Enter a name before creating this item.'); return; }
  try {
    if (pending.type === 'mode') {
      const collection = state.document.variableCollections?.find(item => item.id === pending.collectionId);
      if (!collection) throw new Error('The variable collection no longer exists.');
      if (collection.modes.some(mode => mode.name.toLowerCase() === name.toLowerCase())) throw new Error('Choose a unique name for this mode.');
      checkpoint('Add variable mode'); addVariableMode(state.document, collection.id, name);
    } else if (pending.type === 'variable') {
      const collection = state.document.variableCollections?.find(item => item.id === pending.collectionId);
      if (!collection) throw new Error('The variable collection no longer exists.');
      if ((state.document.variables || []).some(variable => variable.collectionId === collection.id && variable.name.toLowerCase() === name.toLowerCase())) throw new Error('A variable with that name already exists in this collection.');
      const variableType = $('#variable-type').value;
      const initialValue = variableType === 'color' ? selectedColorForVariable() : variableType === 'number' ? 0 : variableType === 'boolean' ? false : '';
      checkpoint(`Create ${variableType} variable`); createVariable(state.document, collection.id, name, variableType, initialValue);
    } else if (pending.type === 'collection') {
      checkpoint('Create variable collection'); createVariableCollection(state.document, name);
    } else if (pending.type === 'selection') {
      const nodes = selectedNodes();
      if (!nodes.length) throw new Error('Select a layer before creating a color variable.');
      const collection = state.document.variableCollections?.[0] || null;
      if (collection && (state.document.variables || []).some(variable => variable.collectionId === collection.id && variable.name.toLowerCase() === name.toLowerCase())) throw new Error('A variable with that name already exists in this collection.');
      checkpoint('Create color variable');
      const targetCollection = collection || createVariableCollection(state.document, 'Colors');
      const variable = createColorVariable(state.document, targetCollection.id, name, pending.colorValue || '#1e1e1e');
      for (const node of nodes) {
        const kind = pending.colorKind || (node.type === 'text' ? 'text' : node.type === 'line' || (node.type === 'path' && !node.closed) || (node.type === 'network' && !node.faces?.length) ? 'stroke' : 'fill');
        if (!bindColorVariable(state.document, node.id, variable.id, kind)) continue;
        const instanceRoot = componentInstanceRoot(node.id);
        if (instanceRoot) recordComponentOverride(instanceRoot, node, { fill: 'fillVariableId', text: 'textVariableId', stroke: 'strokeVariableId' }[kind]);
      }
      showToast(`Color variable “${variable.name}” created.`);
    } else return;
  } catch (error) { showToast(error.message || 'Could not create this variable item.'); return; }
  renderUI(); queueSave(); renderer.invalidate();
}

function showMenu(items, x, y) {
  const menu = $('#context-menu'); menu.replaceChildren(); menu.hidden = false;
  for (const item of items) {
    if (item.separator) { const divider = document.createElement('div'); divider.className = 'menu-separator'; menu.append(divider); continue; }
    if (item.labelOnly) { const label = document.createElement('div'); label.className = 'menu-label'; label.textContent = item.label; menu.append(label); continue; }
    const button = document.createElement('button'); button.type = 'button'; button.disabled = Boolean(item.disabled); button.className = item.className || ''; button.setAttribute('role', 'menuitem');
    const label = document.createElement('span'); label.textContent = item.label;
    button.append(label);
    if (item.shortcut) { const shortcut = document.createElement('span'); shortcut.className = 'shortcut'; shortcut.textContent = item.shortcut; button.append(shortcut); }
    button.addEventListener('click', () => { menu.hidden = true; item.action?.(); });
    menu.append(button);
  }
  const width = menu.offsetWidth; const height = menu.offsetHeight;
  menu.style.maxHeight = `${Math.max(120, innerHeight - 16)}px`;
  menu.style.overflowY = 'auto';
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
}
function closeMenu() { $('#context-menu').hidden = true; }

function openNodeMenu(nodeId, x, y, commentAnchor = null) {
  const node = findNode(state.document, nodeId)?.node;
  const linkedInstance = componentInstanceRoot(nodeId);
  const nodePosition = absolutePosition(nodeId);
  const commentPoint = commentAnchor || { x: nodePosition.x + (node?.width || 0) / 2, y: nodePosition.y + (node?.height || 0) / 2 };
  if (!state.selectedIds.includes(nodeId)) setSelection([nodeId]);
  const images = selectedNodes().filter(item => item.type === 'image');
  const items = [
    { label: 'Add comment here', action: () => beginCommentAt(commentPoint) },
    { separator: true },
    { label: 'Duplicate', shortcut: '⌘D', action: duplicateSelected },
    { label: 'Rename', shortcut: '↵', action: () => renameSelected() },
    { label: 'Bring to front', action: () => reorderSelected('front') },
    { label: 'Send to back', action: () => reorderSelected('back') },
    { separator: true },
    { label: 'Delete', shortcut: '⌫', action: deleteSelected }
  ];
  const selectedMainComponents = selectedNodes().filter(item => item.isComponent);
  const canCombine = canCombineBoolean(state.document, state.selectedIds);
  const selectedBoolean = selectedNodes().length === 1 && selectedNodes()[0].type === 'boolean' ? selectedNodes()[0] : null;
  const selectedGroup = selectedNodes().length === 1 && selectedNodes()[0].type === 'group' ? selectedNodes()[0] : null;
  if (canGroupLayers(state.document, rootSelectedIds())) items.unshift({ label: `Group ${rootSelectedIds().length} layers`, shortcut: '⌘G', action: groupSelectedLayers }, { separator: true });
  if (selectedGroup && canUngroupLayers(state.document, selectedGroup.id)) items.unshift({ label: 'Ungroup', shortcut: '⌘⇧G', action: () => ungroupSelectedLayers(selectedGroup.id) }, { separator: true });
  if (canCreateMaskGroup(state.document, rootSelectedIds())) items.unshift({ label: 'Use as mask', action: maskSelectedLayers }, { separator: true });
  if (node?.type === 'group' && node.mask) items.unshift({ label: 'Release mask', action: () => releaseSelectedMask(node.id) }, { separator: true });
  if (canCombine) {
    items.unshift(
      { label: 'Combine as Union', action: () => combineSelectedBoolean('union') },
      { label: 'Combine as Subtract', action: () => combineSelectedBoolean('subtract') },
      { label: 'Combine as Intersect', action: () => combineSelectedBoolean('intersect') },
      { label: 'Combine as Exclude', action: () => combineSelectedBoolean('exclude') },
      { separator: true }
    );
  }
  if (selectedBoolean) {
    items.unshift(
      { label: 'Separate Boolean', action: () => separateSelectedBoolean(selectedBoolean.id) },
      { label: 'Boolean operation', labelOnly: true },
      ...[['union','Union'],['subtract','Subtract'],['intersect','Intersect'],['exclude','Exclude']].map(([operation, label]) => ({
        label: label === selectedBoolean.operation ? `✓ ${label}` : label,
        action: () => setBooleanOperation(selectedBoolean.id, operation)
      })),
      { separator: true }
    );
  }
  if (selectedNodes().length > 1 && selectedMainComponents.length === selectedNodes().length) {
    items.unshift({ label: `Combine ${selectedMainComponents.length} as variants`, action: combineSelectedComponents }, { separator: true });
  }
  if (linkedInstance) items.splice(0, 0, { label: 'Detach component instance', action: () => detachInstance(linkedInstance.id) }, { separator: true });
  else if (node?.isComponent) items.splice(0, 0, { label: 'Create component instance', action: () => createInstanceAt(node.componentId) }, { separator: true });
  else if (node) items.splice(0, 0, { label: 'Create component', action: () => makeComponent(node.id) }, { separator: true });
  if (node?.type === 'image') {
    items.splice(0, 0, { label: 'Save image recipe…', action: () => saveRecipeFor(nodeId) }, { separator: true });
  }
  if (images.length) {
    items.push({ separator: true }, { label: `Apply recipe to ${images.length} image${images.length === 1 ? '' : 's'}`, labelOnly: true });
    if (state.document.recipes.length) for (const recipe of state.document.recipes) items.push({ label: recipe.name, className: 'recipe-option', action: () => startRecipe(recipe, images.map(item => item.id)) });
    else items.push({ label: 'Save a recipe from an edited image first', className: 'recipe-option is-empty', disabled: true });
  }
  const compatibleStyles = (state.document.colorStyles || []).filter(style => style.kind === 'text'
    ? selectedNodes().some(item => item.type === 'text')
    : selectedNodes().some(item => !['text', 'image', 'line', 'path'].includes(item.type) && (item.type !== 'network' || (item.faces || []).length > 0)));
  if (compatibleStyles.length) items.push({ separator: true }, { label: 'Apply color style', labelOnly: true }, ...compatibleStyles.map(style => ({ label: style.name, action: () => applyStyleToSelection(style.id) })));
  showMenu(items, x, y);
}

function combineSelectedBoolean(operation) {
  const ids = rootSelectedIds();
  try {
    checkpoint(`Combine as ${operation}`);
    const group = combineBoolean(state.document, ids, operation);
    setSelection([group.id]); renderUI(); queueSave(); renderer.invalidate();
    showToast(`${operation[0].toUpperCase()}${operation.slice(1)} Boolean group created. Its source shapes remain editable.`);
  } catch (error) { showToast(error.message || 'These layers cannot be combined.'); }
}

function groupSelectedLayers() {
  const ids = rootSelectedIds();
  try {
    checkpoint('Group layers');
    const group = groupLayers(state.document, ids);
    setSelection([group.id]); renderUI(); queueSave();
    showToast(`${ids.length} layers grouped.`);
  } catch (error) { showToast(error.message || 'These layers cannot be grouped.'); }
}

function alignSelectedLayers(mode) {
  const ids = state.selectedIds;
  if (!canAlignLayers(state.document, ids, mode)) { showToast('Select unlocked sibling layers outside auto layout to align them.'); return; }
  const labels = { left: 'left', 'center-x': 'horizontal centers', right: 'right', top: 'top', 'center-y': 'vertical centers', bottom: 'bottom', 'distribute-horizontal': 'horizontally', 'distribute-vertical': 'vertically' };
  checkpoint(mode.startsWith('distribute-') ? `Distribute layers ${labels[mode]}` : `Align layers ${labels[mode]}`);
  const changed = alignLayers(state.document, ids, mode);
  for (const node of changed) {
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) {
      recordComponentOverride(instanceRoot, node, 'x');
      recordComponentOverride(instanceRoot, node, 'y');
    }
  }
  renderUI(); queueSave(); renderer.invalidate();
  showToast(mode.startsWith('distribute-') ? `Layers distributed ${labels[mode]}.` : `Layers aligned by ${labels[mode]}.`);
}

function ungroupSelectedLayers(groupId = selectedNodes()[0]?.id) {
  try {
    checkpoint('Ungroup layers');
    const children = ungroupLayers(state.document, groupId);
    setSelection(children.map(child => child.id)); renderUI(); queueSave();
    showToast(`${children.length} layers ungrouped.`);
  } catch (error) { showToast(error.message || 'This group cannot be ungrouped.'); }
}

function maskSelectedLayers() {
  const ids = rootSelectedIds();
  try {
    checkpoint('Create mask group');
    const group = createMaskGroup(state.document, ids);
    setSelection([group.id]); renderUI(); queueSave(); renderer.invalidate();
    showToast(`Mask group created from “${group.children.find(child => child.id === group.maskSourceId)?.name || 'Vector shape'}”. Its source layers remain editable.`);
  } catch (error) { showToast(error.message || 'These layers cannot form a mask.'); }
}

function releaseSelectedMask(groupId = selectedNodes()[0]?.id) {
  try {
    checkpoint('Release mask');
    const children = releaseMaskGroup(state.document, groupId);
    setSelection(children.map(child => child.id)); renderUI(); queueSave(); renderer.invalidate();
    showToast('Mask released. The source layers remain editable.');
  } catch (error) { showToast(error.message); }
}

function setBooleanOperation(nodeId, operation) {
  const node = findNode(state.document, nodeId)?.node;
  if (!node || node.type !== 'boolean' || node.operation === operation) return;
  checkpoint(`Change Boolean operation to ${operation}`);
  node.operation = operation;
  const instanceRoot = componentInstanceRoot(node.id);
  if (instanceRoot) recordComponentOverride(instanceRoot, node, 'operation');
  renderUI(); queueSave(); renderer.invalidate();
}

function separateSelectedBoolean(nodeId = selectedNodes()[0]?.id) {
  try {
    checkpoint('Separate Boolean');
    const children = separateBoolean(state.document, nodeId);
    setSelection(children.map(child => child.id)); renderUI(); queueSave(); renderer.invalidate();
    showToast('Boolean source shapes separated.');
  } catch (error) { showToast(error.message); }
}

function openFileMenu(x, y, commentAnchor = null) {
  showMenu([
    ...(commentAnchor ? [{ label: 'Add comment here', action: () => beginCommentAt(commentAnchor) }, { separator: true }] : []),
    { label: 'New design', shortcut: '⌘N', action: newDesign },
    { label: 'Open local design…', action: () => $('#open-file-input').click() },
    { separator: true },
    { label: 'Save local copy…', shortcut: '⌘⇧S', action: exportDesign },
    { label: 'Export selected layer as PNG', action: exportSelectionPng, disabled: state.selectedIds.length === 0 },
    { separator: true },
    { label: `${state.showLayoutGuides ? '✓' : '○'} Layout guides`, shortcut: '⇧G', action: toggleLayoutGuides },
    { separator: true },
    { label: 'Undo', shortcut: '⌘Z', action: undo, disabled: !history.canUndo },
    { label: 'Redo', shortcut: '⌘⇧Z', action: redo, disabled: !history.canRedo }
  ], x, y);
}
function toggleLayoutGuides() { state.showLayoutGuides = !state.showLayoutGuides; renderer.invalidate(); }
function toggleOutlineMode() {
  state.outlineMode = !state.outlineMode;
  const button = $('#outline-mode');
  button.classList.toggle('is-active', state.outlineMode);
  button.setAttribute('aria-pressed', String(state.outlineMode));
  button.title = state.outlineMode ? 'Exit outline view' : 'Show outline view';
  renderer.invalidate();
}

function deleteSelected() {
  const ids = rootSelectedIds(); if (!ids.length) return;
  checkpoint('Delete layers');
  for (const id of ids) removeNode(state.document, id);
  state.selectedIds = []; state.selectedVectorPoint = null; renderUI(); queueSave();
}
function duplicateSelected() {
  const ids = rootSelectedIds(); if (!ids.length) return;
  checkpoint('Duplicate layers');
  const duplicates = ids.map(id => duplicateNode(state.document, id)).filter(Boolean);
  setSelection(duplicates.map(node => node.id)); renderUI(); queueSave();
}
function renameSelected() {
  const node = selectedNodes()[0]; if (!node) return;
  const name = prompt('Rename layer', node.name); if (name == null) return;
  checkpoint('Rename layer'); node.name = name.trim() || node.name;
  const instanceRoot = componentInstanceRoot(node.id);
  if (instanceRoot) {
    if (instanceRoot.id === node.id) instanceRoot.componentNameIsInherited = false;
    recordComponentOverride(instanceRoot, node, 'name');
  }
  if (node.isComponent) {
    const component = state.document.components?.find(item => item.id === node.componentId);
    if (component) component.name = node.name;
  }
  renderUI(); queueSave();
}
function combineSelectedComponents() {
  const selected = selectedNodes();
  if (selected.length < 2 || selected.some(node => !node.isComponent)) { showToast('Select at least two main components to combine as variants.'); return; }
  const commonName = selected.map(node => state.document.components.find(item => item.id === node.componentId)?.name || node.name);
  const prefix = commonName[0].split('/')[0].trim();
  const name = prompt('Component set name', commonName.every(value => value.split('/')[0].trim() === prefix) ? prefix : 'Component set');
  if (name == null) return;
  try {
    checkpoint('Combine components as variants');
    const set = createComponentSet(state.document, selected.map(node => node.componentId), name);
    renderUI(); queueSave(); showToast(`Component set “${set.name}” created with ${set.componentIds.length} variants.`);
  } catch (error) { showToast(error.message); }
}
function changeInstanceVariant(instanceId, propertyName, value) {
  const instance = findNode(state.document, instanceId)?.node;
  const component = instance?.isInstance && state.document.components.find(item => item.id === instance.componentId);
  const set = component && state.document.componentSets?.find(item => item.id === component.componentSetId);
  if (!instance || !component || !set) return;
  const candidate = set.componentIds.map(id => state.document.components.find(item => item.id === id)).find(item =>
    item.variantProperties?.[propertyName] === value && set.properties.every(property => property.name === propertyName || item.variantProperties?.[property.name] === component.variantProperties?.[property.name])
  );
  if (!candidate) { showToast('That variant combination is not available.'); renderInspector(); return; }
  try {
    checkpoint(`Change ${set.name} ${propertyName}`);
    switchComponentInstanceVariant(state.document, instanceId, candidate.id);
    renderUI(); queueSave(); showToast(`${set.name} switched to ${value}.`);
  } catch (error) { showToast(error.message); renderInspector(); }
}
function changeMainVariantProperty(componentId, propertyName, value) {
  try {
    checkpoint(`Rename ${propertyName} variant`);
    setComponentVariantProperty(state.document, componentId, propertyName, value);
    renderUI(); queueSave(); showToast(`${propertyName} variant updated.`);
  } catch (error) { showToast(error.message); renderInspector(); }
}
function makeComponent(nodeId = selectedNodes()[0]?.id) {
  const node = nodeId ? findNode(state.document, nodeId)?.node : null;
  if (!node) { showToast('Select a layer to create a component.'); return; }
  if (componentInstanceRoot(node.id)) { showToast('Detach this instance before creating a component.'); return; }
  if (node.isComponent) { showToast('This layer is already a main component.'); return; }
  const name = prompt('Component name', node.name);
  if (name == null) return;
  try {
    checkpoint('Create component');
    const component = createComponent(state.document, node.id, name);
    renderUI(); queueSave(); showToast(`Component “${component.name}” created.`);
  } catch (error) { showToast(error.message); }
}
function createInstanceAt(componentId, position = null) {
  if (!componentId) return;
  const x = position?.x ?? (canvas.clientWidth / 2 - state.panX) / state.zoom;
  const y = position?.y ?? (canvas.clientHeight / 2 - state.panY) / state.zoom;
  try {
    checkpoint('Create component instance');
    const instance = createComponentInstance(state.document, componentId, { pageId: activePage().id, x, y });
    setSelection([instance.id]); renderUI(); queueSave();
    showToast('Component instance added to this page.');
  } catch (error) { showToast(error.message); }
}
function detachInstance(nodeId = selectedNodes()[0]?.id) {
  const linkedRoot = nodeId ? componentInstanceRoot(nodeId) : null;
  const rootId = linkedRoot?.id || nodeId;
  if (!rootId || !findNode(state.document, rootId)?.node.isInstance) { showToast('Select a component instance to detach.'); return; }
  checkpoint('Detach component instance');
  detachComponentInstance(state.document, rootId);
  renderUI(); queueSave(); showToast('Instance detached. It can now be edited independently.');
}
function reorderSelected(direction) {
  const ids = new Set(rootSelectedIds()); if (!ids.size) return;
  checkpoint(direction === 'front' ? 'Bring layers forward' : 'Send layers backward');
  const page = activePage();
  const reorder = nodes => {
    const chosen = nodes.filter(node => ids.has(node.id));
    const remaining = nodes.filter(node => !ids.has(node.id));
    const next = direction === 'front' ? [...remaining, ...chosen] : [...chosen, ...remaining];
    nodes.splice(0, nodes.length, ...next);
    for (const node of nodes) reorder(node.children || []);
  };
  reorder(page.children); renderUI(); queueSave();
}

function undo() { const next = history.undo(state.document); if (!next) return; state.document = next; state.selectedIds = state.selectedIds.filter(id => findNode(state.document, id)); state.selectedVectorPoint = null; renderUI(); queueSave(); }
function redo() { const next = history.redo(state.document); if (!next) return; state.document = next; state.selectedIds = state.selectedIds.filter(id => findNode(state.document, id)); state.selectedVectorPoint = null; renderUI(); queueSave(); }
function newDesign() {
  state.document = createDocument(); state.selectedIds = []; state.selectedVectorPoint = null; state.pendingCommentAnchor = null; state.activeCommentId = null; state.zoom = 1; state.panX = canvas.clientWidth / 2; state.panY = canvas.clientHeight / 2;
  history.undoStack.length = 0; history.redoStack.length = 0; renderUI(); queueSave(); showToast('New local design created.');
}
function addPage() {
  const page = { id: createId('page'), name: `Page ${state.document.pages.length + 1}`, children: [] };
  checkpoint('Add page'); state.document.pages.push(page); state.document.activePageId = page.id; state.selectedIds = []; state.selectedVectorPoint = null; state.pendingCommentAnchor = null; state.activeCommentId = null; renderUI(); queueSave();
}
function renamePage(pageId) {
  const page = state.document.pages.find(item => item.id === pageId); if (!page) return;
  const name = prompt('Rename page', page.name); if (!name) return;
  checkpoint('Rename page'); page.name = name.trim() || page.name; renderUI(); queueSave();
}

function overlayPositionInFrame(position, frame, overlay) {
  if (position === 'center') return { x: (frame.width - overlay.width) / 2, y: (frame.height - overlay.height) / 2 };
  const xSide = position.endsWith('left') ? 'left' : position.endsWith('right') ? 'right' : 'center';
  const ySide = position.startsWith('top') ? 'top' : position.startsWith('bottom') ? 'bottom' : 'center';
  const gap = 16;
  return {
    x: xSide === 'left' ? gap : xSide === 'right' ? frame.width - overlay.width - gap : (frame.width - overlay.width) / 2,
    y: ySide === 'top' ? gap : ySide === 'bottom' ? frame.height - overlay.height - gap : (frame.height - overlay.height) / 2
  };
}

function isNodeInSubtree(root, nodeId) {
  let found = false;
  walkNodes([root], ({ node }) => { if (node.id === nodeId) found = true; });
  return found;
}

function renderPresentationFrame(interaction = null, previousFrame = null, progress = null) {
  if (!state.presenting || !presentRenderState) return;
  const target = findNodeAcrossPages(state.document, state.presenting.frameId);
  if (!target || target.node.type !== 'frame') { showToast('This prototype destination no longer exists.'); $('#present-dialog').close(); return; }
  const displayFrame = previousFrame && Number.isFinite(progress)
    ? interpolateSmartFrame(previousFrame, target.node, progress)
    : structuredClone(target.node);
  displayFrame.x = 0; displayFrame.y = 0;
  const sceneChildren = [displayFrame];
  for (const [index, overlayState] of state.presenting.overlays.entries()) {
    const overlayTarget = findNode(state.document, overlayState.frameId, overlayState.pageId) || findNodeAcrossPages(state.document, overlayState.frameId);
    if (!overlayTarget || overlayTarget.node.type !== 'frame') continue;
    if (overlayState.background) sceneChildren.push({
      id: `presentation-overlay-backdrop-${index}`, type: 'rectangle', name: 'Overlay background',
      x: 0, y: 0, width: displayFrame.width, height: displayFrame.height, rotation: 0,
      opacity: overlayState.backgroundOpacity, visible: true, fill: overlayState.backgroundColor,
      fillOpacity: 1, stroke: null, strokeWidth: 0, radius: 0, clip: false, children: []
    });
    const displayOverlay = structuredClone(overlayTarget.node);
    Object.assign(displayOverlay, overlayPositionInFrame(overlayState.position, displayFrame, displayOverlay));
    sceneChildren.push(displayOverlay);
  }
  presentRenderState.document = {
    activePageId: target.page.id, pages: [{ id: target.page.id, name: target.page.name, children: sceneChildren }],
    colorStyles: state.document.colorStyles || [], variableCollections: state.document.variableCollections || [], variables: state.document.variables || []
  };
  presentRenderState.assets = state.assets;
  presentRenderState.previews = state.previews;
  const rect = $('#present-canvas').getBoundingClientRect();
  const width = Math.max(1, rect.width); const height = Math.max(1, rect.height);
  const margin = Math.min(72, Math.max(24, Math.min(width, height) * .08));
  presentRenderState.zoom = Math.max(.05, Math.min(1.25, (width - margin * 2) / Math.max(1, displayFrame.width), (height - margin * 2) / Math.max(1, displayFrame.height)));
  presentRenderState.panX = (width - displayFrame.width * presentRenderState.zoom) / 2;
  presentRenderState.panY = (height - displayFrame.height * presentRenderState.zoom) / 2;
  $('#present-title').textContent = target.node.name;
  $('#present-back').disabled = state.presenting.stack.length === 0 && state.presenting.overlays.length === 0;
  $('#present-dialog').dataset.frameId = state.presenting.frameId;
  $('#present-dialog').dataset.overlayDepth = String(state.presenting.overlays.length);
  $('#present-dialog').dataset.navigationDepth = String(state.presenting.stack.length);
  if (previousFrame && Number.isFinite(progress)) {
    $('#present-dialog').dataset.smartAnimating = 'true';
    $('#present-dialog').dataset.smartProgress = String(progress);
  } else {
    delete $('#present-dialog').dataset.smartAnimating;
    delete $('#present-dialog').dataset.smartProgress;
  }
  $('#present-dialog').style.setProperty('--present-duration', `${Math.max(0, interaction?.duration ?? 240)}ms`);
  $('#present-dialog').style.setProperty('--present-easing', prototypeEasingTimingFunction(interaction?.easing || 'ease-in-out'));
  if (interaction?.transition === 'smart-animate') {
    $('#present-canvas').style.opacity = '1';
    $('#present-canvas').style.transform = 'translateX(0)';
    presentRenderer?.invalidate();
  } else if (interaction?.transition && interaction.transition !== 'instant' && interaction.duration > 0) {
    const enterFrom = interaction.transition === 'move-left' ? 'translateX(22px)' : interaction.transition === 'move-right' ? 'translateX(-22px)' : 'translateX(0)';
    const canvasElement = $('#present-canvas');
    canvasElement.style.opacity = '0';
    canvasElement.style.transform = enterFrom;
    requestAnimationFrame(() => {
      presentRenderer?.invalidate();
      requestAnimationFrame(() => { canvasElement.style.opacity = '1'; canvasElement.style.transform = 'translateX(0)'; });
    });
  } else {
    $('#present-canvas').style.opacity = '1';
    $('#present-canvas').style.transform = 'translateX(0)';
    presentRenderer?.invalidate();
  }
}

function cancelPresentationAnimation() {
  if (presentationAnimationFrame) cancelAnimationFrame(presentationAnimationFrame);
  presentationAnimationFrame = 0;
}

function animateSmartTransition(fromFrame, interaction) {
  cancelPresentationAnimation();
  const duration = Math.max(0, Number(interaction.duration) || 0);
  if (!duration) { renderPresentationFrame(); return; }
  const startTime = performance.now();
  const tick = now => {
    if (!state.presenting) { presentationAnimationFrame = 0; return; }
    const linear = Math.min(1, (now - startTime) / duration);
    const eased = easePrototypeProgress(linear, interaction.easing || 'ease-in-out');
    renderPresentationFrame(interaction, fromFrame, eased);
    if (linear < 1) presentationAnimationFrame = requestAnimationFrame(tick);
    else {
      presentationAnimationFrame = 0;
      renderPresentationFrame();
    }
  };
  presentationAnimationFrame = requestAnimationFrame(tick);
}

function startPresentation(selectedId = null) {
  const start = getPrototypeStartFrame(state.document, selectedId);
  if (!start) { showToast('Create a frame before presenting this design.'); return; }
  cancelPresentationAnimation();
  const dialog = $('#present-dialog');
  state.presenting = createPrototypeSession(start);
  presentRenderState = { document: null, assets: state.assets, previews: state.previews, selectedIds: [], zoom: 1, panX: 0, panY: 0, draftNode: null, marquee: null, inspectorTab: 'design' };
  dialog.showModal();
  requestAnimationFrame(() => {
    if (!presentRenderer) presentRenderer = new SceneRenderer($('#present-canvas'), () => presentRenderState);
    renderPresentationFrame();
  });
}

function navigatePresentation(interaction) {
  if (!state.presenting) return;
  const source = interaction.action === 'navigate' && interaction.transition === 'smart-animate'
    ? findNode(state.document, state.presenting.frameId, state.presenting.pageId)?.node
    : null;
  const previousFrame = source ? structuredClone(source) : null;
  cancelPresentationAnimation();
  const result = applyPrototypeInteraction(state.document, state.presenting, interaction);
  if (!result) { showToast(interaction.action === 'close-overlay' ? 'There is no open overlay to close.' : 'This prototype destination no longer exists.'); return; }
  if (result === 'navigated' && previousFrame) animateSmartTransition(previousFrame, interaction);
  else renderPresentationFrame(interaction);
}

function handlePresentationPointer(event, trigger) {
  if (!state.presenting || !presentRenderState?.document) return;
  if ($('#present-dialog').dataset.smartAnimating === 'true') return;
  const page = presentRenderState.document.pages[0];
  const hit = hitTestPage(page, screenToWorld(event, $('#present-canvas'), presentRenderState), (node, point, x, y) => presentRenderer?.hitTestBoolean(node, point, x, y) ?? true, state.document);
  const topOverlayState = state.presenting.overlays.at(-1);
  if (trigger === 'on-click' && topOverlayState) {
    const overlayTarget = findNode(state.document, topOverlayState.frameId, topOverlayState.pageId) || findNodeAcrossPages(state.document, topOverlayState.frameId);
    const insideOverlay = hit && overlayTarget && isNodeInSubtree(overlayTarget.node, hit.id);
    if (!insideOverlay && topOverlayState.outsideClick) {
      state.presenting.overlays.pop();
      state.presenting.lastHoverInteractionId = null;
      renderPresentationFrame();
      return;
    }
  }
  if (!hit) { if (trigger === 'while-hovering') state.presenting.lastHoverInteractionId = null; return; }
  const found = findClickableInteraction(state.document, state.presenting.pageId, hit.id, trigger);
  if (!found) { if (trigger === 'while-hovering') state.presenting.lastHoverInteractionId = null; return; }
  if (trigger === 'while-hovering' && state.presenting.lastHoverInteractionId === found.interaction.id) return;
  navigatePresentation(found.interaction);
}

function backPresentation() {
  cancelPresentationAnimation();
  if (!backPrototypeSession(state.presenting)) return;
  renderPresentationFrame();
}

async function exportDesign() {
  try {
    const assets = [];
    for (const node of imageNodesAcrossPages()) {
      if (assets.some(asset => asset.id === node.assetId)) continue;
      const saved = await loadImageAsset(node.assetId);
      if (saved) assets.push({ id: saved.id, name: saved.name, type: saved.type, bytes: saved.bytes });
    }
    await downloadLocalPackage(JSON.parse(serializeDocument(state.document)), assets);
    showToast('Local design copy downloaded.');
  } catch (error) { showToast(error.message || 'Could not export this local design.'); }
}
function imageNodesAcrossPages() { const result = []; for (const page of state.document.pages) walkNodes(page.children, ({ node }) => { if (node.type === 'image') result.push(node); }); return result; }

function exportBoundsForNode(nodeId) {
  const entry = findNode(state.document, nodeId);
  if (!entry) return null;
  const node = entry.node;
  const stroke = node.stroke && node.strokeWidth ? node.strokeWidth / 2 : 0;
  const corners = [[-stroke, -stroke], [node.width + stroke, -stroke], [node.width + stroke, node.height + stroke], [-stroke, node.height + stroke]];
  const points = corners.map(([x, y]) => {
    const rotated = rotatePoint({ x, y }, { x: node.width / 2, y: node.height / 2 }, node.rotation || 0);
    let point = { x: rotated.x + node.x, y: rotated.y + node.y };
    for (let index = entry.parents.length - 1; index >= 0; index -= 1) {
      const parent = entry.parents[index];
      point = rotatePoint(point, { x: parent.width / 2, y: parent.height / 2 }, parent.rotation || 0);
      point.x += parent.x; point.y += parent.y;
    }
    return point;
  });
  const xs = points.map(point => point.x); const ys = points.map(point => point.y);
  const left = Math.min(...xs); const top = Math.min(...ys); const right = Math.max(...xs); const bottom = Math.max(...ys);
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function exportDimensions(nodeId, scale = 1) {
  const bounds = exportBoundsForNode(nodeId);
  return bounds ? { width: Math.ceil(bounds.width * scale), height: Math.ceil(bounds.height * scale) } : { width: 0, height: 0 };
}

function exportRenderTree(nodeId) {
  const entry = findNode(state.document, nodeId);
  if (!entry) return null;
  let branch = structuredClone(entry.node);
  for (let index = entry.parents.length - 1; index >= 0; index -= 1) {
    const parent = entry.parents[index];
    const wrapper = structuredClone(parent);
    const maskSource = parent.mask ? parent.children.find(child => child.id === parent.maskSourceId) : null;
    if (maskSource && maskSource.id !== branch.id) wrapper.children = [branch, structuredClone(maskSource)];
    else wrapper.children = [branch];
    wrapper.type = 'group'; wrapper.fill = 'transparent'; wrapper.stroke = null; wrapper.strokeWidth = 0;
    wrapper.fillOpacity = 0;
    delete wrapper.fillStyleId; delete wrapper.fillVariableId;
    if (wrapper.variableBindings) delete wrapper.variableBindings.fill;
    if (!maskSource || maskSource.id === branch.id) { wrapper.mask = false; delete wrapper.maskSourceId; }
    branch = wrapper;
  }
  return branch;
}

function orderedRootSelection() {
  const rows = pageLayerRows();
  const index = new Map(rows.map((entry, position) => [entry.node.id, position]));
  return rootSelectedIds().sort((left, right) => (index.get(left) ?? 0) - (index.get(right) ?? 0));
}

async function refreshImagesForExport(nodeIds) {
  const images = new Map();
  for (const id of nodeIds) {
    const node = findNode(state.document, id)?.node;
    if (node) walkNodes([node], ({ node: child }) => { if (child.type === 'image') images.set(child.id, child); });
  }
  await Promise.all([...images.values()].map(async node => {
    const asset = state.assets.get(node.assetId);
    if (!asset?.sourceBytes) throw new Error(`The original image for “${node.name}” is unavailable on this device.`);
    const status = state.imageStatus.get(node.id) || '';
    const timer = previewTimers.get(node.id);
    if (timer) { clearTimeout(timer); previewTimers.delete(node.id); }
    if (timer || status === 'Updating preview…' || status === 'Processing locally…') await renderImagePreview(node.id, node.assetId, node.adjustments);
    if (!state.previews.has(node.id) && node.adjustments && Object.values(node.adjustments).some(value => Number(value) !== 0)) await renderImagePreview(node.id, node.assetId, node.adjustments);
  }));
}

function safeExportName(value) { return String(value || 'layer').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim() || 'layer'; }

async function renderAndDownload(ids, setting, baseName) {
  if (!ids.length) throw new Error('Select a layer to export.');
  const boundsList = ids.map(exportBoundsForNode).filter(Boolean);
  if (!boundsList.length) throw new Error('The selected layer is no longer available.');
  const left = Math.min(...boundsList.map(item => item.x)); const top = Math.min(...boundsList.map(item => item.y));
  const right = Math.max(...boundsList.map(item => item.x + item.width)); const bottom = Math.max(...boundsList.map(item => item.y + item.height));
  const scale = Number(setting.scale) || 1;
  const width = Math.max(1, Math.ceil((right - left) * scale)); const height = Math.max(1, Math.ceil((bottom - top) * scale));
  if (width > 16_384 || height > 16_384 || width * height > 16_000_000) throw new Error(`This export would be ${width} × ${height} px. Choose a smaller scale to stay within the local memory limit.`);
  await refreshImagesForExport(ids);
  await document.fonts?.ready;
  const output = document.createElement('canvas'); output.width = width; output.height = height;
  const context = output.getContext('2d', { alpha: setting.format !== 'jpeg' });
  if (!context) throw new Error('This browser could not create an export surface.');
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  if (setting.format === 'jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
  context.scale(scale, scale); context.translate(-left, -top);
  for (const id of ids) {
    const tree = exportRenderTree(id);
    if (tree) renderer.drawNode(context, tree, 0, 0, state.assets, false, false, { showLayoutGuides: false, outlineMode: false });
  }
  const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[setting.format];
  const extension = { png: 'png', jpeg: 'jpg', webp: 'webp' }[setting.format];
  const blob = await new Promise((resolve, reject) => {
    try { output.toBlob(value => value ? resolve(value) : reject(new Error('The browser could not encode this export.')), mime, setting.format === 'png' ? undefined : setting.quality / 100); }
    catch (error) { reject(error); }
  });
  if (blob.type !== mime) throw new Error(`${setting.format.toUpperCase()} export is not supported by this browser.`);
  const suffix = String(setting.suffix || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim();
  const scaleSuffix = !suffix && scale !== 1 ? `@${String(scale).replace('.', '_')}x` : suffix;
  const filename = `${safeExportName(baseName)}${scaleSuffix}.${extension}`;
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { blob, filename, width, height };
}

async function exportLayerWithSetting(nodeId, settingId) {
  const node = findNode(state.document, nodeId)?.node;
  const setting = node?.exportSettings?.find(item => item.id === settingId);
  if (!node || !setting) throw new Error('The export setting no longer exists.');
  const result = await renderAndDownload([nodeId], setting, node.name);
  showToast(`Downloaded ${result.filename} · ${result.width} × ${result.height} px.`);
}

async function exportSelectionPng() {
  const ids = orderedRootSelection();
  const names = ids.map(id => findNode(state.document, id)?.node.name).filter(Boolean);
  try { await renderAndDownload(ids, { format: 'png', scale: 1, suffix: '', quality: 90 }, names.length === 1 ? names[0] : `selection-${names.length}`); }
  catch (error) { showToast(error.message || 'Could not export this selection.'); }
}

function updateLayoutGuide(input, finalize = false) {
  const node = selectedNodes()[0];
  const guide = node?.layoutGuides?.find(item => item.id === input.dataset.guideId);
  if (node?.type !== 'frame' || !guide) return;
  const property = input.dataset.guideField;
  let value = input.value;
  if (property === 'opacity') value = Number(value) / 100;
  else if (input.type === 'number') {
    value = Number(value);
    if (!Number.isFinite(value) || value < Number(input.min) || value > Number(input.max) || (property === 'count' && !Number.isInteger(value))) {
      if (finalize) {
        const hadEdit = state.layoutGuideControlEdit;
        state.layoutGuideControlEdit = false; renderInspector();
        if (hadEdit) queueSave();
      }
      return;
    }
  }
  if (property === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) return;
  if (guide[property] !== value) {
    if (!state.layoutGuideControlEdit) { checkpoint('Edit layout guide'); state.layoutGuideControlEdit = true; }
    guide[property] = value;
    if (property === 'type') {
      const valid = value === 'columns' ? ['stretch', 'left', 'center', 'right'] : value === 'rows' ? ['stretch', 'top', 'center', 'bottom'] : [];
      if (value !== 'grid' && !valid.includes(guide.alignment)) guide.alignment = 'stretch';
    }
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'layoutGuides');
    renderer.invalidate();
  }
  if (finalize && state.layoutGuideControlEdit) {
    state.layoutGuideControlEdit = false;
    renderInspector(); queueSave();
  }
}

function updateExportSetting(input) {
  const node = selectedNodes()[0];
  const setting = node?.exportSettings?.find(item => item.id === input.dataset.exportId);
  if (!node || !setting) return;
  const property = input.dataset.exportField;
  const value = property === 'scale' || property === 'quality' ? Number(input.value) : input.value;
  if (setting[property] === value) return;
  checkpoint('Update export setting');
  setting[property] = value;
  const instanceRoot = componentInstanceRoot(node.id);
  if (instanceRoot) recordComponentOverride(instanceRoot, node, 'exportSettings');
  renderInspector(); queueSave();
}

async function copyInspectText(kind) {
  const text = buildInspectOutput(state.document, selectedEntries())[kind];
  if (!text) { showToast('Select a layer before copying handoff data.'); return; }
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${kind === 'css' ? 'CSS' : 'Layer JSON'} copied.`);
    return;
  } catch { /* Use the selection-based fallback when clipboard access is unavailable. */ }
  const field = document.createElement('textarea');
  field.value = text; field.setAttribute('readonly', ''); field.setAttribute('aria-hidden', 'true');
  field.style.position = 'fixed'; field.style.left = '-9999px'; field.style.top = '0';
  document.body.append(field); field.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* A blocked clipboard can still be copied from the visible code block. */ }
  field.remove();
  showToast(copied ? `${kind === 'css' ? 'CSS' : 'Layer JSON'} copied.` : 'Clipboard unavailable. Select the code block and copy it.');
}

function applyInspectorAction(action, details = {}) {
  const node = selectedNodes()[0];
  if (action === 'align-selection') alignSelectedLayers(details.alignMode);
  else if (action === 'add-layer-effect' && node && !node.locked) {
    if ((node.effects || []).length >= 8) { showToast('A layer can have up to 8 effects.'); return; }
    try {
      checkpoint('Add layer effect');
      node.effects ||= [];
      node.effects.push(createLayerEffect(details.effectType));
      recordNodeComponentOverrides(node, ['effects']);
      renderInspector(); queueSave(); renderer.invalidate();
    } catch (error) { showToast(error.message); }
  } else if (action === 'remove-layer-effect' && node && !node.locked) {
    if (!node.effects?.some(effect => effect.id === details.effectId)) return;
    checkpoint('Remove layer effect');
    node.effects = node.effects.filter(effect => effect.id !== details.effectId);
    recordNodeComponentOverrides(node, ['effects']);
    renderInspector(); queueSave(); renderer.invalidate();
  }
  else if (action === 'add-layout-guide' && node?.type === 'frame') {
    node.layoutGuides ||= [];
    if (node.layoutGuides.length >= 32) { showToast('A frame can have up to 32 layout guides.'); return; }
    checkpoint('Add layout guide'); node.layoutGuides.push(createLayoutGuide(details.guideType || 'grid'));
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'layoutGuides');
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'remove-layout-guide' && node?.type === 'frame') {
    const guides = node.layoutGuides || [];
    if (!guides.some(guide => guide.id === details.guideId)) return;
    checkpoint('Remove layout guide'); node.layoutGuides = guides.filter(guide => guide.id !== details.guideId);
    const instanceRoot = componentInstanceRoot(node.id);
    if (!node.layoutGuides.length) {
      if (instanceRoot) node.layoutGuides = [];
      else delete node.layoutGuides;
    }
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'layoutGuides');
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'toggle-layout-guide' && node?.type === 'frame') {
    const guide = node.layoutGuides?.find(item => item.id === details.guideId);
    if (!guide) return;
    checkpoint('Toggle layout guide'); guide.visible = !guide.visible;
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'layoutGuides');
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'add-export-setting' && node) {
    if ((node.exportSettings || []).length >= 8) { showToast('A layer can have up to 8 export settings.'); return; }
    checkpoint('Add export setting');
    node.exportSettings ||= [];
    node.exportSettings.push(createExportSetting());
    renderInspector(); queueSave();
  } else if (action === 'remove-export-setting' && node) {
    const settings = node.exportSettings || [];
    if (!settings.some(setting => setting.id === details.exportId)) return;
    checkpoint('Remove export setting');
    node.exportSettings = settings.filter(setting => setting.id !== details.exportId);
    if (!node.exportSettings.length) delete node.exportSettings;
    renderInspector(); queueSave();
  } else if (action === 'export-setting' && node) {
    exportLayerWithSetting(node.id, details.exportId).catch(error => showToast(error.message || 'Could not export this layer.'));
  } else if (action === 'create-component') makeComponent(node?.id);
  else if (action === 'combine-components') combineSelectedComponents();
  else if (action === 'create-component-instance') createInstanceAt(details.componentId || node?.componentId);
  else if (action === 'detach-component-instance') detachInstance(details.instanceId || node?.id);
  else if (action === 'prototype-start') {
    const entry = node ? findNode(state.document, node.id) : null;
    const frame = node?.type === 'frame' ? node : [...(entry?.parents || [])].reverse().find(parent => parent.type === 'frame');
    if (!frame) { showToast('Select a frame to set the starting point.'); return; }
    checkpoint('Set prototype starting point');
    setPrototypeStartPoint(state.document, frame.id);
    renderInspector(); queueSave(); showToast(`“${frame.name}” is now the prototype starting point.`);
  } else if (action === 'prototype-connect') {
    if (!node) { showToast('Select a layer to add an interaction.'); return; }
    if (state.prototypeAction === 'close-overlay') {
      try {
        checkpoint('Add close overlay interaction');
        addPrototypeInteraction(state.document, node.id, null, {
          action: 'close-overlay', trigger: state.prototypeTrigger,
          transition: state.prototypeTransition, easing: state.prototypeEasing, duration: state.prototypeDuration
        });
        renderInspector(); queueSave(); renderer.invalidate(); showToast('Close overlay interaction added.');
      } catch (error) { showToast(error.message); }
      return;
    }
    state.prototypeSourceId = node.id;
    state.inspectorTab = 'prototype';
    $$('.inspector-tab').forEach(tab => { tab.classList.toggle('is-active', tab.dataset.inspectorTab === 'prototype'); tab.setAttribute('aria-selected', String(tab.dataset.inspectorTab === 'prototype')); });
    renderInspector(); renderer.invalidate(); showToast('Choose a destination frame on the canvas.');
  } else if (action === 'remove-prototype-interaction') {
    const interactionId = details.interactionId;
    if (!node || !interactionId) return;
    checkpoint('Remove prototype interaction');
    removePrototypeInteraction(state.document, node.id, interactionId);
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'present') startPresentation(node?.id);
  else if (action === 'separate-boolean' && node?.type === 'boolean') separateSelectedBoolean(node.id);
  else if (action === 'release-mask' && node?.type === 'group' && node.mask) releaseSelectedMask(node.id);
  else if (action === 'insert-vector-point' && ['path', 'network'].includes(node?.type)) insertPathPointOnLongestSegment(node.id);
  else if (action === 'delete-vector-point' && ['path', 'network'].includes(node?.type)) deleteSelectedVectorPoint(node.id);
  else if (action === 'create-color-variable') createColorVariableFromSelection(details.kind || null);
  else if (action === 'create-color-style') {
    if (!node) { showToast('Select a layer with a solid Fill or Text color.'); return; }
    const current = getNodeColor(state.document, node, node.type === 'text' ? 'text' : 'fill');
    if (!/^#[0-9a-f]{6}$/i.test(current)) { showToast('Choose a solid color before creating a style.'); return; }
    const name = prompt('Color style name', `${node.name} color`);
    if (name == null) return;
    try {
      checkpoint('Create color style');
      const style = createColorStyle(state.document, node.id, name);
      renderUI(); queueSave(); showToast(`Color style “${style.name}” created.`);
    } catch (error) { showToast(error.message); }
  }
  else if (action === 'edit-text' && node?.type === 'text') editTextNode(node.id);
  else if (action === 'reset-image' && node?.type === 'image') {
    checkpoint('Reset image'); node.adjustments = { brightness: 0, contrast: 0, saturation: 0, blur: 0 }; node.fit = 'cover';
    schedulePreview(node, true); renderInspector(); queueSave();
  } else if (action === 'create-frame') { setTool('frame'); showToast('Drag on the canvas to create a frame.'); }
  else if (action === 'add-stroke') {
    if (!node) return; checkpoint('Add stroke'); node.stroke ||= '#1e1e1e'; node.strokeWidth ||= 1; renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'auto-layout-toggle') {
    if (!node || node.type !== 'frame') return;
    checkpoint(node.autoLayout ? 'Remove auto layout' : 'Add auto layout');
    if (node.autoLayout) delete node.autoLayout;
    else { node.autoLayout = createAutoLayout(); applyAutoLayout(node); }
    renderInspector(); renderLayers(); renderer.invalidate(); queueSave();
  }
}

function updateImageEngineState(metrics) {
  const output = $('#bulk-speed-value');
  if (output && state.bulk) output.textContent = `${state.bulk.concurrency} worker${state.bulk.concurrency === 1 ? '' : 's'}`;
}

function toggleMobilePanel(panel) {
  const left = $('#left-panel'); const right = $('#right-panel'); const scrim = $('#mobile-scrim');
  if (panel === 'left') { right.classList.remove('is-open'); left.classList.toggle('is-open'); }
  else { left.classList.remove('is-open'); right.classList.toggle('is-open'); }
  scrim.classList.toggle('is-visible', left.classList.contains('is-open') || right.classList.contains('is-open'));
}

function initEvents() {
  for (const button of $$('.tool-button')) button.innerHTML = `${icon(button.querySelector('[data-icon]')?.dataset.icon || 'cursor', 18)}<kbd>${button.querySelector('kbd')?.textContent || ''}</kbd>`;
  $$('.tool-button').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.tool === 'image') chooseImageFiles(); else setTool(button.dataset.tool);
  }));
  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  canvas.addEventListener('pointermove', onCanvasPointerMove);
  canvas.addEventListener('pointerup', onCanvasPointerUp);
  canvas.addEventListener('pointercancel', onCanvasPointerUp);
  canvas.addEventListener('dblclick', event => {
    if (state.tool !== 'select') return;
    const world = screenToWorld(event, canvas, state);
    if (insertPathPointAtWorld(world)) event.preventDefault();
  });
  canvas.addEventListener('contextmenu', event => {
    event.preventDefault();
    const world = screenToWorld(event, canvas, state); const hit = hitTestPage(activePage(), world, (node, point, x, y) => renderer?.hitTestBoolean(node, point, x, y) ?? true, state.document);
    if (hit) openNodeMenu(hit.id, event.clientX, event.clientY, world);
    else if (state.selectedIds.length) openNodeMenu(state.selectedIds[0], event.clientX, event.clientY, world);
    else openFileMenu(event.clientX, event.clientY, world);
  });
  canvasScroll.addEventListener('dragover', event => { event.preventDefault(); $('#canvas-drop-overlay').classList.add('is-visible'); });
  canvasScroll.addEventListener('dragleave', event => { if (!canvasScroll.contains(event.relatedTarget)) $('#canvas-drop-overlay').classList.remove('is-visible'); });
  canvasScroll.addEventListener('drop', event => {
    event.preventDefault(); $('#canvas-drop-overlay').classList.remove('is-visible');
    const point = screenToWorld(event, canvas, state); importImageFiles(event.dataTransfer.files, point);
  });
  $('#image-input').addEventListener('change', event => importImageFiles(event.currentTarget.files));
  $('#open-file-input').addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files?.[0]; if (!file) return;
    try {
      const packageData = unpackLocalPackage(new Uint8Array(await file.arrayBuffer()));
      const importedDocument = parseDocument(packageData.document);
      for (const asset of packageData.assets) await saveImageAssetBytes(asset.id, asset.name, asset.type, asset.bytes);
      state.document = importedDocument; state.selectedIds = []; state.selectedVectorPoint = null; state.pendingCommentAnchor = null; state.activeCommentId = null; state.zoom = 1; state.panX = canvas.clientWidth / 2; state.panY = canvas.clientHeight / 2;
      history.undoStack.length = 0; history.redoStack.length = 0; renderUI(); queueSave(); await restoreImageAssets(); showToast('Local design opened on this device.');
    } catch (error) { showToast(error.message || 'This file is not a valid local design package.'); }
    input.value = '';
  });
  setZoomButtonHandlers();
  $('#document-name').addEventListener('change', event => { const name = event.currentTarget.value.trim() || 'Untitled'; checkpoint('Rename design'); state.document.name = name; renderUI(); queueSave(); });
  $('#add-page').addEventListener('click', addPage);
  $('#pages-list').addEventListener('click', event => { const row = event.target.closest('[data-page-id]'); if (!row) return; state.document.activePageId = row.dataset.pageId; state.selectedIds = []; state.selectedVectorPoint = null; state.pendingCommentAnchor = null; state.activeCommentId = null; renderUI(); });
  $('#pages-list').addEventListener('dblclick', event => { const row = event.target.closest('[data-page-id]'); if (row) renamePage(row.dataset.pageId); });
  $('#layers-list').addEventListener('click', event => {
    const row = event.target.closest('[data-layer-id]'); if (!row) return;
    const node = findNode(state.document, row.dataset.layerId)?.node; if (!node) return;
    if (event.target.closest('[data-action="visibility"]')) { checkpoint('Toggle visibility'); setNodePropertyValue(node, 'visible', !getNodePropertyValue(state.document, node, 'visible')); renderUI(); queueSave(); return; }
    if (event.shiftKey) {
      const rows = latestPageLayerIds; const a = rows.indexOf(state.lastLayerSelection || row.dataset.layerId); const b = rows.indexOf(row.dataset.layerId); const range = rows.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSelection([...new Set([...state.selectedIds, ...range])]);
    } else if (event.metaKey || event.ctrlKey) {
      setSelection(state.selectedIds.includes(node.id) ? state.selectedIds.filter(id => id !== node.id) : [...state.selectedIds, node.id]);
    } else setSelection([node.id]);
    state.lastLayerSelection = node.id;
  });
  $('#layers-list').addEventListener('dblclick', event => { const row = event.target.closest('[data-layer-id]'); if (row) { setSelection([row.dataset.layerId]); renameSelected(); } });
  $('#layers-list').addEventListener('contextmenu', event => { const row = event.target.closest('[data-layer-id]'); if (!row) return; event.preventDefault(); openNodeMenu(row.dataset.layerId, event.clientX, event.clientY); });
  $('#inspector-content').addEventListener('input', event => {
    const effectField = event.target.closest('[data-effect-field]');
    if (effectField) { updateLayerEffectInput(effectField); return; }
    const networkFace = event.target.closest('[data-network-face-fill], [data-network-face-opacity]');
    if (networkFace) { updateNetworkFaceInput(networkFace); return; }
    const quality = event.target.closest('[data-export-field="quality"]');
    if (quality) { quality.parentElement.querySelector('output').value = `${quality.value}%`; return; }
    const guideField = event.target.closest('[data-guide-field]');
    if (guideField) {
      if (guideField.dataset.guideField === 'opacity') guideField.parentElement.querySelector('output').value = `${guideField.value}%`;
      updateLayoutGuide(guideField);
      return;
    }
    updateInspectorInput(event);
    if (event.target.id === 'prototype-duration') {
      state.prototypeDuration = Number(event.target.value);
      $('#prototype-duration-value').textContent = `${(state.prototypeDuration / 1000).toFixed(1)} s`;
    }
    if (event.target.id === 'prototype-overlay-opacity') state.prototypeOverlayBackgroundOpacity = Number(event.target.value) / 100;
  });
  $('#inspector-content').addEventListener('change', event => {
    if (event.target.matches('[data-effect-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-network-face-fill], [data-network-face-opacity]')) { finishInspectorInput(); return; }
    const guideField = event.target.closest('[data-guide-field]');
    if (guideField) { updateLayoutGuide(guideField, true); return; }
    const exportField = event.target.closest('[data-export-field]');
    if (exportField) { updateExportSetting(exportField); return; }
    if (event.target.matches('[data-prop]')) finishInspectorInput();
    if (event.target.matches('[data-variable-binding]')) applyColorVariableToSelection(event.target.value, event.target.dataset.variableBinding);
    if (event.target.matches('[data-variable-property-binding]')) applyVariablePropertyToSelection(event.target.dataset.variablePropertyBinding, event.target.value);
    if (event.target.matches('[data-frame-variable-mode]')) {
      const frame = selectedNodes()[0];
      if (frame?.type === 'frame') {
        checkpoint('Set frame variable mode');
        setFrameVariableMode(state.document, frame.id, event.target.dataset.frameVariableMode, event.target.value || null);
        resizeTextLayers([frame]);
        const instanceRoot = componentInstanceRoot(frame.id);
        if (instanceRoot) recordComponentOverride(instanceRoot, frame, 'variableModes');
        renderUI(); queueSave(); renderer.invalidate();
      }
    }
    if (event.target.matches('[data-variant-property]')) changeInstanceVariant(event.target.dataset.instanceId, event.target.dataset.variantProperty, event.target.value);
    if (event.target.matches('[data-variant-master-property]')) changeMainVariantProperty(event.target.dataset.componentId, event.target.dataset.variantMasterProperty, event.target.value);
    if (event.target.id === 'prototype-action') {
      state.prototypeAction = event.target.value;
      if (state.prototypeAction !== 'navigate' && state.prototypeTransition === 'smart-animate') state.prototypeTransition = 'dissolve';
      renderInspector();
    }
    if (event.target.id === 'prototype-trigger') state.prototypeTrigger = event.target.value;
    if (event.target.id === 'prototype-transition') { state.prototypeTransition = event.target.value; renderInspector(); }
    if (event.target.id === 'prototype-easing') state.prototypeEasing = event.target.value;
    if (event.target.id === 'prototype-duration') state.prototypeDuration = Number(event.target.value);
    if (event.target.id === 'prototype-overlay-position') state.prototypeOverlayPosition = event.target.value;
    if (event.target.id === 'prototype-overlay-outside') state.prototypeOverlayOutsideClick = event.target.checked;
    if (event.target.id === 'prototype-overlay-background') { state.prototypeOverlayBackground = event.target.checked; renderInspector(); }
    if (event.target.id === 'prototype-overlay-color') state.prototypeOverlayBackgroundColor = event.target.value;
    if (event.target.id === 'prototype-overlay-opacity') state.prototypeOverlayBackgroundOpacity = Number(event.target.value) / 100;
  });
  $('#inspector-content').addEventListener('focusout', finishInspectorInput);
  $('#inspector-content').addEventListener('click', event => {
    const commentAction = event.target.closest('[data-comment-action]');
    if (commentAction) { handleCommentAction(commentAction); return; }
    const copy = event.target.closest('[data-inspect-copy]');
    if (copy) { copyInspectText(copy.dataset.inspectCopy); return; }
    const button = event.target.closest('[data-action]');
    if (button) applyInspectorAction(button.dataset.action, button.dataset);
  });
  $('#inspector-content').addEventListener('submit', event => {
    const form = event.target.closest('[data-comment-form]');
    if (!form) return;
    event.preventDefault(); submitCommentForm(form);
  });
  $('#layers-section').addEventListener('dblclick', event => { if (event.target.id === 'empty-layers') setTool('frame'); });
  $('#search-layers').addEventListener('click', () => { $('#layer-search-wrap').hidden = !$('#layer-search-wrap').hidden; if (!$('#layer-search-wrap').hidden) $('#layer-search').focus(); });
  $('#layer-search').addEventListener('input', event => { state.layerSearch = event.currentTarget.value; renderLayers(); });
  $('#layer-options').addEventListener('click', event => {
    const items = [
      { label: 'Show all layers', action: () => { checkpoint('Show all layers'); walkNodes(activePage().children, ({ node }) => { setNodePropertyValue(node, 'visible', true); }); renderUI(); queueSave(); } },
      { label: 'Unlock all layers', action: () => { checkpoint('Unlock all layers'); walkNodes(activePage().children, ({ node }) => { node.locked = false; }); renderUI(); queueSave(); } },
      { label: 'Select all layers', shortcut: '⌘A', action: () => setSelection(pageLayerRows().map(entry => entry.node.id)) }
    ];
    const ids = rootSelectedIds();
    const node = selectedNodes()[0];
    if (canCreateMaskGroup(state.document, ids)) items.unshift({ label: 'Use selected layers as mask', action: maskSelectedLayers }, { separator: true });
    if (selectedNodes().length === 1 && node?.type === 'group' && node.mask) items.unshift({ label: 'Release selected mask', action: () => releaseSelectedMask(node.id) }, { separator: true });
    showMenu(items, event.clientX, event.clientY);
  });
  $('#place-image-assets').addEventListener('click', chooseImageFiles);
  $('#add-variable-collection').addEventListener('click', () => handleVariableAssetsAction('add-variable-collection'));
  $('#variable-collections-list').addEventListener('click', event => {
    const apply = event.target.closest('[data-variable-apply]');
    if (apply) { applyColorVariableToSelection(apply.dataset.variableApply); return; }
    const action = event.target.closest('[data-action]');
    if (action) handleVariableAssetsAction(action.dataset.action, action.dataset);
  });
  $('#variable-collections-list').addEventListener('input', event => {
    const input = event.target.closest('[data-variable-value]');
    if (!input) return;
    if (input.type === 'number' && (!input.value || !Number.isFinite(Number(input.value)))) return;
    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    if (!state.controlEdit) { checkpoint('Edit variable'); state.controlEdit = true; }
    setVariableValue(state.document, input.dataset.variableValue, value, input.dataset.modeId);
    resizeTextLayers(state.document.pages.flatMap(page => page.children), input.dataset.variableValue);
    renderer.invalidate();
  });
  $('#variable-collections-list').addEventListener('change', event => {
    const alias = event.target.closest('[data-variable-alias]');
    if (alias) {
      const variable = state.document.variables?.find(item => item.id === alias.dataset.variableAlias);
      checkpoint(`Change ${variable?.name || 'variable'} alias`);
      if (!setVariableAlias(state.document, alias.dataset.variableAlias, alias.value || null, alias.dataset.modeId)) showToast('Aliases must target another variable of the same type and cannot create a cycle.');
      resizeTextLayers(state.document.pages.flatMap(page => page.children));
      state.controlEdit = false; renderUI(); queueSave(); renderer.invalidate(); return;
    }
    const mode = event.target.closest('[data-variable-default-mode]');
    if (mode) {
      const collection = state.document.variableCollections?.find(item => item.id === mode.dataset.variableDefaultMode);
      if (!collection || collection.defaultModeId === mode.value) return;
      checkpoint('Change default variable mode'); collection.defaultModeId = mode.value;
      resizeTextLayers(state.document.pages.flatMap(page => page.children));
      renderUI(); queueSave(); renderer.invalidate(); return;
    }
    if (event.target.matches('[data-variable-value]')) {
      state.controlEdit = false; renderUI(); queueSave(); renderer.invalidate();
    }
  });
  $('#assets-list').addEventListener('click', event => { const card = event.target.closest('[data-layer-id]'); if (!card) return; const node = findNode(state.document, card.dataset.layerId)?.node; if (!node) return; const point = { x: canvas.clientWidth / 2 - state.panX / state.zoom + 18, y: canvas.clientHeight / 2 - state.panY / state.zoom + 18 }; checkpoint('Place asset'); const copy = duplicateNode(state.document, node.id); if (copy) { copy.x = point.x; copy.y = point.y; setSelection([copy.id]); queueSave(); } });
  $('#components-list').addEventListener('click', event => {
    const setCard = event.target.closest('[data-component-set-id]');
    if (setCard) { const set = state.document.componentSets?.find(item => item.id === setCard.dataset.componentSetId); if (set) createInstanceAt(set.componentIds[0]); return; }
    const card = event.target.closest('[data-component-id]'); if (card) createInstanceAt(card.dataset.componentId);
  });
  $('#color-styles-list').addEventListener('click', event => { const style = event.target.closest('[data-color-style-id]'); if (style) applyStyleToSelection(style.dataset.colorStyleId); });
  $('#file-menu-button').addEventListener('click', event => openFileMenu(event.clientX || 72, event.clientY || 45));
  $('#main-menu-button').addEventListener('click', event => openFileMenu(event.clientX || 18, event.clientY || 45));
  $('#canvas-menu').addEventListener('click', event => openFileMenu(event.clientX || innerWidth - 36, event.clientY || 50));
  $('#share-button').addEventListener('click', () => showToast('This editor stores files locally. Cloud sharing and live collaboration are not enabled.'));
  $('#mode-button').addEventListener('click', () => { state.inspectorTab = state.inspectorTab === 'prototype' ? 'design' : 'prototype'; state.prototypeSourceId = null; $$('.inspector-tab').forEach(tab => { tab.classList.toggle('is-active', tab.dataset.inspectorTab === state.inspectorTab); tab.setAttribute('aria-selected', String(tab.dataset.inspectorTab === state.inspectorTab)); }); renderInspector(); renderer.invalidate(); });
  $$('.inspector-tab').forEach(tab => tab.addEventListener('click', () => setInspectorTab(tab.dataset.inspectorTab)));
  $('#present-button').addEventListener('click', () => startPresentation());
  $('#present-back').addEventListener('click', backPresentation);
  $('#present-exit').addEventListener('click', () => $('#present-dialog').close());
  $('#present-dialog').addEventListener('close', () => {
    cancelPresentationAnimation();
    presentRenderer?.destroy(); presentRenderer = null; presentRenderState = null; state.presenting = null;
    $('#present-canvas').style.opacity = '1'; $('#present-canvas').style.transform = 'translateX(0)';
  });
  $('#present-canvas').addEventListener('pointerup', event => handlePresentationPointer(event, 'on-click'));
  $('#present-canvas').addEventListener('pointermove', event => { if (event.pointerType !== 'touch') handlePresentationPointer(event, 'while-hovering'); });
  window.addEventListener('resize', () => { if (state.presenting) renderPresentationFrame(); });
  $$('.sidebar-tab').forEach(tab => tab.addEventListener('click', () => { state.sidebarTab = tab.dataset.sidebarTab; $$('.sidebar-tab').forEach(item => { item.classList.toggle('is-active', item === tab); item.setAttribute('aria-selected', String(item === tab)); }); $('#layers-section').hidden = state.sidebarTab !== 'layers'; $('#assets-section').hidden = state.sidebarTab !== 'assets'; }));
  $('#export-selection').addEventListener('click', exportSelectionPng);
  $('#recipe-dialog').addEventListener('close', () => {
    if ($('#recipe-dialog').returnValue !== 'save' || !pendingRecipeNodeId) return;
    const node = findNode(state.document, pendingRecipeNodeId)?.node; if (!node) return;
    checkpoint('Save image recipe');
    const recipe = createImageRecipe(node, $('#recipe-name').value); state.document.recipes.push(recipe); pendingRecipeNodeId = null;
    queueSave(); showToast(`Recipe “${recipe.name}” saved. Right-click selected images to apply it.`);
  });
  $('#recipe-form').addEventListener('submit', event => { if (event.submitter?.value === 'save') $('#recipe-dialog').returnValue = 'save'; });
  $('#variable-dialog').addEventListener('close', commitVariableNameDialog);
  $('#variable-form').addEventListener('submit', event => { if (event.submitter?.value === 'save') $('#variable-dialog').returnValue = 'save'; });
  $('#bulk-speed').max = String(CPU_LIMIT);
  $('#bulk-speed').addEventListener('input', event => { if (!state.bulk) return; state.bulk.concurrency = Number(event.currentTarget.value); imageEngine.setConcurrency(state.bulk.concurrency); renderBulkBar(); scheduleBulk(); });
  $('#bulk-pause').addEventListener('click', () => { if (!state.bulk) return; state.bulk.paused = !state.bulk.paused; renderBulkBar(); if (!state.bulk.paused) scheduleBulk(); });
  $('#bulk-cancel').addEventListener('click', () => { if (!state.bulk) return; state.bulk.cancelled = true; state.bulk.next = state.bulk.targets.length; state.bulk.paused = false; renderBulkBar(); if (!state.bulk.inflight) { state.bulk.done = true; renderBulkBar(); } });
  $('#bulk-done').addEventListener('click', () => { state.bulk = null; renderBulkBar(); });
  $('#toggle-rulers').addEventListener('click', event => { const visible = $('#ruler-horizontal').hidden; $('#ruler-horizontal').hidden = !visible; $('#ruler-vertical').hidden = !visible; event.currentTarget.classList.toggle('is-active', visible); });
  $('#outline-mode').addEventListener('click', toggleOutlineMode);
  $('#local-info').addEventListener('click', () => showToast('Design metadata and source images are stored in this browser only.'));
  $('#sidebar-toggle').addEventListener('click', () => toggleMobilePanel('left'));
  $('#inspector-toggle').addEventListener('click', () => toggleMobilePanel('right'));
  $('#mobile-scrim').addEventListener('click', () => { $('#left-panel').classList.remove('is-open'); $('#right-panel').classList.remove('is-open'); $('#mobile-scrim').classList.remove('is-visible'); });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#context-menu') && !event.target.closest('#file-menu-button') && !event.target.closest('#main-menu-button')) closeMenu(); });
  document.addEventListener('keydown', onKeyDown);
  $('#text-editor-overlay').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); commitTextEdit(); } if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); commitTextEdit(); } });
  $('#text-editor-overlay').addEventListener('blur', commitTextEdit);
}

function onKeyDown(event) {
  const editing = event.target.matches('input, textarea, select, [contenteditable="true"]');
  if (event.code === 'Space' && !editing) { state.spaceDown = true; event.preventDefault(); }
  if (editing) return;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (mod && key === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelectedLayers() : groupSelectedLayers(); return; }
  if (event.shiftKey && key === 'g') { event.preventDefault(); toggleLayoutGuides(); return; }
  if (key === 'escape' && state.presenting?.overlays.length) { event.preventDefault(); backPresentation(); return; }
  if (state.penDraft && key === 'enter') { event.preventDefault(); finishPenPath(false); return; }
  if (state.penDraft && key === 'escape') { event.preventDefault(); cancelPenPath(); showToast('Vector path cancelled.'); return; }
  if (key === 'escape' && state.prototypeSourceId) { state.prototypeSourceId = null; renderInspector(); renderer.invalidate(); event.preventDefault(); return; }
  if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if (mod && key === 'y') { event.preventDefault(); redo(); return; }
  if (mod && key === 'd') { event.preventDefault(); duplicateSelected(); return; }
  if (mod && key === 'a') { event.preventDefault(); setSelection(pageLayerRows().map(entry => entry.node.id)); return; }
  if (mod && key === 's') { event.preventDefault(); event.shiftKey ? exportDesign() : queueSave(); return; }
  if (mod && key === 'n') { event.preventDefault(); newDesign(); return; }
  if ((key === 'delete' || key === 'backspace') && state.selectedVectorPoint) {
    if (deleteSelectedVectorPoint()) event.preventDefault();
    return;
  }
  if (key === 'delete' || key === 'backspace') { event.preventDefault(); deleteSelected(); return; }
  if (key === 'escape') { closeMenu(); if (state.bulk && !state.bulk.done) { state.bulk.cancelled = true; state.bulk.next = state.bulk.targets.length; renderBulkBar(); } setSelection([]); return; }
  const tools = { v: 'select', h: 'hand', f: 'frame', r: 'rectangle', o: 'ellipse', l: 'line', p: 'pen', t: 'text', c: 'comment' };
  if (tools[key] && !event.altKey) { setTool(tools[key]); return; }
  const delta = event.shiftKey ? 10 : 1;
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && selectedNodes().length) {
    checkpoint('Nudge layers');
    const dx = key === 'arrowleft' ? -delta : key === 'arrowright' ? delta : 0;
    const dy = key === 'arrowup' ? -delta : key === 'arrowdown' ? delta : 0;
    for (const node of selectedNodes()) { node.x += dx; node.y += dy; }
    renderer.invalidate(); renderLayers(); renderInspector(); queueSave(); event.preventDefault();
  }
}

function onKeyUp(event) {
  if (event.code === 'Space') { state.spaceDown = false; canvas.classList.remove('is-panning'); }
}

async function boot() {
  try {
    const saved = await loadLatestDocument();
    if (saved) state.document = parseDocument(saved);
  } catch (error) { console.warn('Could not restore local design', error); showToast('A saved design could not be restored. A new file is ready.'); }
  renderer = new SceneRenderer(canvas, () => state);
  state.panX = canvas.clientWidth / 2; state.panY = canvas.clientHeight / 2;
  initEvents(); renderUI(); state.ready = true; document.documentElement.dataset.appReady = 'true';
  try { await restoreImageAssets(); } catch (error) { showToast(error.message); }
  if (!await loadLatestDocument().catch(() => null)) queueSave();
  $('#save-state').lastElementChild.textContent = 'Saved locally';
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', () => renderer.invalidate());
  window.addEventListener('beforeunload', () => { imageEngine.destroy(); for (const item of state.assets.values()) { item.bitmap?.close?.(); if (item.bitmapUrl) URL.revokeObjectURL(item.bitmapUrl); } for (const bitmap of state.previews.values()) bitmap.close?.(); });
}

boot();
