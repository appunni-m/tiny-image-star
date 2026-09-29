import {
  addNode, addVariableMode, addCommentReply, alignLayers, applyColorStyle, applyTypographyStyle, bindColorVariable, bindVariable, canAlignLayers, canBindVariable, applyImageRecipe, canCombineBoolean, canGroupLayers, canUngroupLayers, canSwapComponentTo, cloneDocument, combineBoolean, createColorStyle, createColorVariable, createTypographyStyle, createVariable, createComponent, createComponentInstance, createComponentSet, createCommentThread,
  createComponentProperty, createDocument, createExportSetting, createGradientFill, createId, createImageRecipe, createLayoutGuide, createLayerEffect, createNode, createVariableCollection, deleteVariable, deleteVariableCollection, detachComponentInstance, duplicateNode, findNode,
  findNodeAcrossPages, getActivePage, getNodeColor, getNodeGeometry, getNodePropertyValue, parseDocument, removeNode, reorderNode, resolveVariableValue, serializeDocument, setColorVariableValue, setVariableAlias, setVariableValue, setComponentVariantProperty, setFrameVariableMode, updateTypographyStyle, deleteTypographyStyle, validateDocument, variableModeForNode,
  canCreateMaskGroup, createMaskGroup, groupLayers, releaseMaskGroup, removeCommentThread, setCommentResolved, separateBoolean, switchComponentInstanceVariant, syncAllComponentInstances, syncComponentInstances, ungroupLayers,
  resetComponentSlotContent, setComponentPropertyValue, setComponentSlotContent, updateNode, walkNodes
} from './model.js';
import { createImageFill } from './image-fills.js';
import { createImageTransforms } from './image-transforms.js';
import { layerBlendModes, layerBlendModeLabels } from './layer-blend.js';
import { History } from './history.js';
import { deepestContainerAtPagePoint, SceneRenderer, hitTestPage, screenToWorld, selectionOverlayGeometry, worldToScreen } from './renderer.js';
import { calculateTextBox, measureTrackedText } from './text-layout.js';
import { LocalImageEngine } from './image-engine.js';
import { collectLiveImagePreviewNodeIds, pruneImagePreviewRuntime } from './image-preview-runtime.js';
import { deleteStoredDocument, downloadLocalPackage, duplicateStoredDocument, importLocalPackage, listSavedDocuments, loadDocumentById, loadImageAsset, loadLatestDocument, renameStoredDocument, saveDocument, saveImageAsset, saveImageAssetBytes, unpackLocalPackage } from './storage.js';
import { icon } from './icons.js';
import { applyAutoLayout as applyAutoLayoutEngine, createAutoLayout } from './layout-engine.js';
import { interpolateSmartFrame } from './smart-animate.js';
import { buildInspectOutput } from './inspect.js';
import { exportNodeToSvg, exportPageToSvg } from './svg-export.js';
import { importSvgToLayers } from './svg-import.js';
import { addPrototypeInteraction, applyPrototypeInteraction, backPrototypeSession, createPrototypeSession, easePrototypeProgress, findClickableInteraction, findFrameAtPoint, getPrototypeStartFrame, listPrototypeFrames, normalizePrototypeLinkUrl, prototypeEasingTimingFunction, removePrototypeInteraction, setPrototypeStartPoint } from './prototype.js';
import { applyFrameConstraints, captureChildGeometry, horizontalConstraints, verticalConstraints } from './constraints.js';
import { createLayerClipboard, pasteLayerClipboard } from './layer-clipboard.js';
import { installLayerReorder, moveLayerOneVisualRow } from './layer-order.js';
import { getTransformHandles, nodeLocalToPage, pageToNodeLocal, pageToNodeParentLocal, pageToParentLocal, resizeOrientedRect } from './transform-geometry.js';
import {
  appendVectorNetworkPathResolved, closestVectorNetworkEdge, closestVectorSegment, insertVectorNetworkPoint, insertVectorNodePoint,
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
  assets: new Map(), previews: new Map(), previewUrls: new Map(), previewAssetIds: new Map(), previewVersions: new Map(), imageStatus: new Map(), renderVersion: new Map(),
  draftNode: null, penDraft: null, penHover: null, marquee: null, interaction: null, pointerMap: new Map(),
  sidebarTab: 'layers', inspectorTab: 'design', clipboard: [], controlEdit: false, layerSelectionMode: false,
  bulk: null, textNodeId: null, textSelection: null, spaceDown: false, ready: false, layerSearch: '', showLayoutGuides: true, outlineMode: false,
  statusTimer: null, saveTimer: null, saveChain: Promise.resolve(), saveRevision: 0, documentTransitioning: false, pendingImageImports: 0, lastLayerSelection: null,
  documentGeneration: 0,
  pendingVariableDialog: null, pendingCommentAnchor: null, activeCommentId: null,
  layoutGuideControlEdit: false,
  prototypeSourceId: null, prototypeAction: 'navigate', prototypeUrl: 'https://', prototypeTrigger: 'on-click', prototypeTransition: 'instant', prototypeEasing: 'ease-in-out', prototypeDuration: 300,
  prototypeVariableCollectionId: null, prototypeVariableModeId: null,
  prototypeConditionVariableId: null, prototypeConditionOperator: 'equals', prototypeConditionValue: null,
  componentPropertyTargetId: null, componentPropertyType: 'BOOLEAN',
  componentSlotDialog: null,
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
let nextImageRenderVersion = 0;
let presentRenderer = null;
let presentRenderState = null;
let textMeasureContext = null;

function activePage() { return getActivePage(state.document); }
function selectedEntries() { return state.selectedIds.map(id => findNode(state.document, id)).filter(Boolean); }
function selectedNodes() { return selectedEntries().map(entry => entry.node); }
function resolvedGeometry(node) { return getNodeGeometry(state.document, node); }
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
  instanceRoot.componentOverrides[node.componentSourceId][key] = node[key] === undefined ? null : structuredClone(node[key]);
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
function orderedRootSelectedEntries() {
  const selected = new Set(rootSelectedIds());
  const order = new Map();
  let nextOrder = 0;
  walkNodes(activePage()?.children || [], ({ node }) => order.set(node.id, nextOrder++));
  return selectedEntries().filter(entry => selected.has(entry.node.id)).sort((left, right) => (order.get(left.node.id) ?? 0) - (order.get(right.node.id) ?? 0));
}
function hasClipboardLayers() { return Boolean(state.clipboard?.schema && state.clipboard.items?.length); }
function setSaveState(kind, text) {
  const element = $('#save-state');
  element.classList.toggle('is-saving', kind === 'saving');
  element.classList.toggle('is-error', kind === 'error');
  element.lastElementChild.textContent = text;
}
function enqueueDocumentSave(snapshot) {
  const next = state.saveChain.catch(() => {}).then(() => saveDocument(snapshot));
  state.saveChain = next.catch(() => {});
  return next;
}
function setDocumentEditingBlocked(blocked) {
  $('.topbar').inert = blocked;
  $('.workspace').inert = blocked;
}
function queueSave() {
  if (!state.ready) return;
  state.saveRevision += 1;
  if (syncAllComponentInstances(state.document)) {
    reconcileImagePreviewRuntime();
    renderLayers();
    renderer?.invalidate();
  }
  setSaveState('saving', 'Saving locally…');
  if (state.documentTransitioning) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      const snapshot = JSON.parse(serializeDocument(state.document));
      await enqueueDocumentSave(snapshot);
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
  const selectMode = $('#layer-select-mode');
  selectMode.textContent = state.layerSelectionMode ? 'Done' : 'Select';
  selectMode.setAttribute('aria-label', state.layerSelectionMode ? 'Finish selecting images' : 'Select images for recipes');
  selectMode.setAttribute('aria-pressed', String(state.layerSelectionMode));
  selectMode.classList.toggle('is-active', state.layerSelectionMode);
  list.setAttribute('aria-multiselectable', 'true');
  const page = activePage();
  latestPageLayerIds = [];
  const search = state.layerSearch.trim().toLowerCase();
  const matchingNode = node => !search || node.name.toLowerCase().includes(search) || (node.children || []).some(matchingNode);
  const addRows = (nodes, depth = 0, lockedParent = false) => {
    for (const { node, index } of nodes.map((node, index) => ({ node, index })).reverse()) {
      if (!matchingNode(node)) continue;
      latestPageLayerIds.push(node.id);
      const row = document.createElement('div');
      row.className = `layer-row${state.selectedIds.includes(node.id) ? ' is-selected' : ''}${getNodePropertyValue(state.document, node, 'visible') ? '' : ' layer-hidden'}${node.locked ? ' layer-locked' : ''}`;
      row.setAttribute('role', 'treeitem'); row.setAttribute('aria-selected', String(state.selectedIds.includes(node.id))); row.dataset.layerId = node.id; row.dataset.layerType = node.type; row.tabIndex = 0; row.draggable = true;
      row.style.paddingLeft = `${7 + depth * 13}px`;
      const siblings = nodes;
      const lockedInChain = node.locked || lockedParent;
      const upNeighbor = siblings[index + 1]; const downNeighbor = siblings[index - 1];
      const iconName = node.type === 'frame' || node.type === 'group' ? 'layerFrame' : node.type === 'text' ? 'layerText' : node.type === 'image' ? 'layerImage' : node.type === 'ellipse' ? 'layerEllipse' : node.type === 'section' ? 'layerSection' : node.type === 'path' || node.type === 'network' || node.type === 'boolean' ? 'layerVector' : 'rectangleSmall';
      const chevron = node.children?.length ? '⌄' : '';
      const componentMarker = node.isComponent ? '◆' : node.isInstance ? '◇' : node.mask ? '◩' : '';
      row.title = node.mask ? 'Mask group · use Layer options or Inspector to release' : '';
      row.innerHTML = `<span class="layer-chevron">${chevron}</span><span class="layer-icon">${componentMarker || icon(iconName, 14)}</span><span class="layer-name">${escapeHtml(node.name)}</span><button type="button" class="layer-order-control" data-action="layer-move-up" aria-label="Move ${escapeHtml(node.name)} up" title="Move up"${state.layerSelectionMode || lockedInChain || !upNeighbor || upNeighbor.locked ? ' disabled' : ''}>↑</button><button type="button" class="layer-order-control" data-action="layer-move-down" aria-label="Move ${escapeHtml(node.name)} down" title="Move down"${state.layerSelectionMode || lockedInChain || !downNeighbor || downNeighbor.locked ? ' disabled' : ''}>↓</button><button type="button" class="layer-visibility" data-action="visibility" aria-label="Toggle visibility" title="Toggle visibility">${icon('eye', 13)}</button>`;
      list.append(row);
      if (node.children?.length) addRows(node.children, depth + 1, lockedInChain);
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
  const type = {
    x: 'number', y: 'number', width: 'number', height: 'number', rotation: 'number', visible: 'boolean', opacity: 'number', radius: 'number',
    text: 'string', fontSize: 'number', lineHeight: 'number', letterSpacing: 'number',
    'autoLayout.axis': 'string', 'autoLayout.align': 'string', 'autoLayout.justify': 'string',
    'autoLayout.mainSizing': 'string', 'autoLayout.crossSizing': 'string', 'autoLayout.wrap': 'boolean',
    'autoLayout.autoPositioning': 'boolean', 'autoLayout.columns': 'number', 'autoLayout.rows': 'number', 'autoLayout.rowGap': 'number',
    'autoLayout.columnGap': 'number', 'autoLayout.padding.top': 'number', 'autoLayout.padding.right': 'number',
    'autoLayout.padding.bottom': 'number', 'autoLayout.padding.left': 'number'
  }[property];
  const selected = node.variableBindings?.[property] || '';
  const matchingVariables = (state.document.variables || []).filter(variable => variable.type === type);
  if (!matchingVariables.length && !selected) return '';
  const options = matchingVariables.map(variable => {
    const collection = state.document.variableCollections?.find(item => item.id === variable.collectionId);
    return `<option value="${escapeHtml(variable.id)}"${selected === variable.id ? ' selected' : ''}>${escapeHtml(variable.name)} · ${escapeHtml(collection?.name || 'Collection')}</option>`;
  }).join('');
  return `<label class="variable-binding-row"><span>${escapeHtml(label)}</span><select class="select-field" data-variable-property-binding="${property}" aria-label="${escapeHtml(label)} variable"><option value="">No variable</option>${options}</select></label>`;
}
function gradientFillControls(node) {
  const gradient = node.fillGradient;
  if (!gradient) return '';
  const stops = gradient.stops.map((stop, index) => `<div class="gradient-stop-row"><label><span>Stop ${index + 1}</span><input type="color" data-gradient-field="color" data-gradient-stop-id="${escapeHtml(stop.id)}" value="${escapeHtml(stop.color)}" aria-label="Gradient stop ${index + 1} color"${node.locked ? ' disabled' : ''}/></label><label><span>${Math.round(stop.position * 100)}%</span><input type="number" min="0" max="100" step="1" data-gradient-field="position" data-gradient-stop-id="${escapeHtml(stop.id)}" value="${Math.round(stop.position * 100)}" aria-label="Gradient stop ${index + 1} position"${node.locked ? ' disabled' : ''}/></label><button class="tiny-icon-button" type="button" data-action="remove-gradient-stop" data-stop-id="${escapeHtml(stop.id)}" aria-label="Remove gradient stop ${index + 1}"${node.locked || gradient.stops.length <= 2 ? ' disabled' : ''}>×</button></div>`).join('');
  const angle = gradient.type === 'linear' ? `<div class="property-grid"><div class="property-field"><label>°</label><input type="number" min="0" max="359" step="1" data-gradient-field="angle" value="${gradient.angle}" aria-label="Gradient angle"${node.locked ? ' disabled' : ''}/></div></div>` : '';
  return `${angle}<div class="gradient-stops">${stops}</div><button class="add-fill" type="button" data-action="add-gradient-stop"${node.locked || gradient.stops.length >= 8 ? ' disabled' : ''}>＋ Add color stop</button><div class="image-properties-note">Drag stop positions by changing percentages. Gradients stay editable in the design.</div>`;
}
function imageFillSources() {
  const sources = new Map();
  for (const reference of imageAssetReferencesAcrossPages()) {
    if (sources.has(reference.assetId)) continue;
    const asset = state.assets.get(reference.assetId);
    sources.set(reference.assetId, { assetId: reference.assetId, name: asset?.name || reference.name || 'Image' });
  }
  return [...sources.values()];
}
function imageFillControls(node) {
  const imageFill = node.imageFill;
  if (!imageFill) return '';
  const sources = imageFillSources();
  const options = sources.map(source => `<option value="${escapeHtml(source.assetId)}"${imageFill.assetId === source.assetId ? ' selected' : ''}>${escapeHtml(source.name)}</option>`).join('');
  const adjustments = imageFill.adjustments;
  const fields = [['brightness', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100], ['saturation', 'Saturation', -100, 100], ['blur', 'Blur', 0, 24]].map(([field, label, min, max]) => `<div class="slider-row"><label>${label}</label><input type="range" min="${min}" max="${max}" step="1" value="${adjustments[field]}" data-image-fill-field="adjustments.${field}" aria-label="Image fill ${label.toLowerCase()}"${node.locked ? ' disabled' : ''}/><output>${adjustments[field]}</output></div>`).join('');
  return `<div class="image-fill-controls"><label class="image-fill-source"><span>Image</span><select class="select-field" data-image-fill-field="assetId" aria-label="Image fill source"${node.locked || sources.length < 2 ? ' disabled' : ''}>${options}</select></label><label class="image-fill-source"><span>Scale</span><select class="select-field" data-image-fill-field="fit" aria-label="Image fill scale"${node.locked ? ' disabled' : ''}><option value="cover"${imageFill.fit === 'cover' ? ' selected' : ''}>Fill</option><option value="contain"${imageFill.fit === 'contain' ? ' selected' : ''}>Fit</option></select></label>${fields}${imageTransformControls(imageFill.transforms, 'fill', node.locked)}<div id="image-fill-engine-status" class="image-engine-status">${escapeHtml(state.imageStatus.get(node.id) || 'Ready · Pillow-RS WebAssembly')}</div><div class="image-properties-note">Edits use the original image through Pillow-RS WASM. The source stays on this device.</div></div>`;
}
function imageTransformControls(transforms, target, disabled = false) {
  const crop = transforms?.crop || { left: 0, top: 0, right: 1, bottom: 1 };
  const edges = [['left', 'Left'], ['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom']].map(([edge, label]) =>
    `<label class="property-field"><span class="field-caption">${label}</span><input type="number" min="0" max="100" step="1" value="${Math.round(crop[edge] * 100)}" data-image-transform-field="${edge}" data-image-transform-target="${target}" aria-label="Crop ${label.toLowerCase()} percent"${disabled ? ' disabled' : ''} /></label>`).join('');
  return `<div class="image-transform-controls"><div class="property-heading">Crop · percent of source</div><div class="property-grid">${edges}</div><div class="property-inline"><button class="add-fill" type="button" data-action="rotate-image" data-direction="left" data-transform-target="${target}" aria-label="Rotate image left 90 degrees"${disabled ? ' disabled' : ''}>↶ Rotate left</button><button class="add-fill" type="button" data-action="rotate-image" data-direction="right" data-transform-target="${target}" aria-label="Rotate image right 90 degrees"${disabled ? ' disabled' : ''}>↷ Rotate right</button></div><button class="add-fill" type="button" data-action="reset-image-transforms" data-transform-target="${target}"${disabled || (!transforms?.crop && !transforms?.rotation) ? ' disabled' : ''}>Reset crop/rotation</button><div class="image-properties-note">Crop and rotation stay editable and are included in saved recipes.</div></div>`;
}
function transformSection(node) {
  const geometry = resolvedGeometry(node);
  const opacity = getNodePropertyValue(state.document, node, 'opacity');
  const body = `<div class="property-grid">${numberField('X', 'x', geometry.x)}${numberField('Y', 'y', geometry.y)}${numberField('W', 'width', geometry.width)}${numberField('H', 'height', geometry.height)}${numberField('↻', 'rotation', geometry.rotation, 1)}${numberField('◐', 'opacity', Math.round((opacity ?? 1) * 100))}</div>${variablePropertyBindingControl(node, 'x', 'X')}${variablePropertyBindingControl(node, 'y', 'Y')}${variablePropertyBindingControl(node, 'width', 'Width')}${variablePropertyBindingControl(node, 'height', 'Height')}${variablePropertyBindingControl(node, 'rotation', 'Rotation')}${variablePropertyBindingControl(node, 'opacity', 'Opacity')}${variablePropertyBindingControl(node, 'visible', 'Visibility')}`;
  return section('Position', body);
}
function blendingSection(node) {
  const selected = node.blendMode || 'normal';
  const options = layerBlendModes.map(mode => `<option value="${mode}"${selected === mode ? ' selected' : ''}>${layerBlendModeLabels[mode]}</option>`).join('');
  return section('Blending', `<select class="prop-input select-field blend-mode-select" data-prop="blendMode" aria-label="Layer blend mode"${node.locked ? ' disabled' : ''}>${options}</select>`);
}
function appearanceSection(node) {
  const hasFill = node.type !== 'network' || (node.faces || []).length > 0;
  const fillType = node.imageFill ? 'image' : node.fillGradient?.type || 'solid';
  const sources = imageFillSources();
  const imageOption = sources.length || node.imageFill ? `<option value="image"${fillType === 'image' ? ' selected' : ''}>Image</option>` : '<option value="image" disabled>Image · place an image first</option>';
  const fillTypeControl = hasFill ? `<label class="fill-type-row"><span>Fill type</span><select class="select-field" data-prop="fillType" aria-label="Fill type"${node.locked ? ' disabled' : ''}><option value="solid"${fillType === 'solid' ? ' selected' : ''}>Solid</option><option value="linear"${fillType === 'linear' ? ' selected' : ''}>Linear gradient</option><option value="radial"${fillType === 'radial' ? ' selected' : ''}>Radial gradient</option>${imageOption}</select></label>` : '';
  const fill = hasFill && !node.fillGradient && !node.imageFill ? colorField('Fill', 'fill', getNodeColor(state.document, node, 'fill'), Math.round((node.fillOpacity ?? 1) * 100)) : '';
  const fillVariable = hasFill && !node.fillGradient && !node.imageFill ? variableBindingControl(node, 'fill') : '';
  const gradient = gradientFillControls(node);
  const image = imageFillControls(node);
  const gradientOpacity = hasFill && (node.fillGradient || node.imageFill) ? `<div class="property-grid">${numberField('Opacity %', 'fillOpacity', Math.round((node.fillOpacity ?? 1) * 100), 1, 0, 100)}</div>` : '';
  const stroke = node.stroke ? `${colorField('Stroke', 'stroke', getNodeColor(state.document, node, 'stroke'), 100)}${variableBindingControl(node, 'stroke')}<button class="add-fill" data-action="create-color-variable" data-kind="stroke">＋ Create stroke variable</button>` : '';
  const radiusValue = getNodePropertyValue(state.document, node, 'radius');
  const radius = ['rectangle', 'frame', 'section', 'image'].includes(node.type) ? `<div class="property-grid" style="margin-top:8px">${numberField('◒', 'radius', radiusValue || 0)}</div>${variablePropertyBindingControl(node, 'radius', 'Corner radius')}` : '';
  const styleActions = node.type === 'path' || (node.type === 'network' && !hasFill) || node.fillGradient || node.imageFill ? '<div class="style-actions"><button class="add-fill" data-action="add-stroke">＋ Add stroke</button></div>' : node.type === 'boolean' ? `<div class="style-actions"><button class="add-fill" data-action="create-color-style">${node.fillStyleId ? '✦ Linked color style' : '＋ Create color style'}</button><button class="add-fill" data-action="create-color-variable" data-kind="fill">＋ Create color variable</button></div>` : `<div class="style-actions"><button class="add-fill" data-action="add-stroke">＋ Add stroke</button><button class="add-fill" data-action="create-color-style">${node.fillStyleId ? '✦ Linked color style' : '＋ Create color style'}</button><button class="add-fill" data-action="create-color-variable" data-kind="fill">＋ Create fill variable</button></div>`;
  const body = `${fillTypeControl}${fill}${fillVariable}${gradient}${image}${gradientOpacity}${stroke}${styleActions}${radius}`;
  return section('Appearance', body);
}
function imageAdjustmentsSection(node) {
  const adjustments = node.adjustments || { brightness: 0, contrast: 0, saturation: 0, blur: 0 };
  const status = state.imageStatus.get(node.id) || 'Ready · Pillow-RS WebAssembly';
  const statusClass = status.startsWith('Updated') || status.startsWith('Ready') ? 'image-engine-status' : '';
  const body = `${imageTransformControls(node.transforms, 'layer', node.locked)}${sliderField('Brightness', 'adjustments.brightness', adjustments.brightness || 0, -100, 100)}${sliderField('Contrast', 'adjustments.contrast', adjustments.contrast || 0, -100, 100)}${sliderField('Saturation', 'adjustments.saturation', adjustments.saturation || 0, -100, 100)}${sliderField('Blur', 'adjustments.blur', adjustments.blur || 0, 0, 24)}<div class="image-engine-status ${statusClass}" id="image-engine-status">${escapeHtml(status)}</div><p class="image-properties-note">Every preview starts from the original image held in memory. Your image never leaves this device.</p>`;
  return section('Image adjustments', body);
}
function imageRecipeOptions(selectedId = '') {
  const recipes = state.document.recipes || [];
  return recipes.length
    ? recipes.map(recipe => `<option value="${escapeHtml(recipe.id)}"${recipe.id === selectedId ? ' selected' : ''}>${escapeHtml(recipe.name)}</option>`).join('')
    : '<option value="">No saved recipes yet</option>';
}
function singleImageRecipesSection(node) {
  const recipes = state.document.recipes || [];
  const apply = recipes.length
    ? `<label class="field-label" for="selection-image-recipe">Apply a saved recipe</label><select class="select-field recipe-picker" id="selection-image-recipe" aria-label="Choose image recipe">${imageRecipeOptions()}</select><button class="add-fill" type="button" data-action="apply-image-recipe" data-node-id="${escapeHtml(node.id)}">Apply to this image</button>`
    : '<div class="image-properties-note">Save a look from an edited image to reuse it here or across a batch.</div>';
  return section('Image recipes', `<button class="add-fill recipe-save-button" type="button" data-action="save-image-recipe" data-node-id="${escapeHtml(node.id)}">＋ Save current look as recipe</button>${apply}`);
}
function selectionImageRecipesSection(imageCount) {
  const recipes = state.document.recipes || [];
  const picker = recipes.length
    ? `<label class="field-label" for="selection-image-recipe">Recipe</label><select class="select-field recipe-picker" id="selection-image-recipe" aria-label="Choose image recipe">${imageRecipeOptions()}</select><button class="primary-button recipe-apply-button" type="button" data-action="apply-selection-image-recipe">Apply to ${imageCount} image${imageCount === 1 ? '' : 's'}</button>`
    : '<div class="image-properties-note">Save a look from one image first, then apply it to selected images here.</div>';
  return section('Image recipes', `<div class="image-properties-note">${imageCount} image${imageCount === 1 ? '' : 's'} selected. Recipe changes are applied to these image layers in place.</div>${picker}`);
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
  const svgExport = '<button class="add-fill" type="button" data-action="export-svg">Download editable SVG</button><div class="image-properties-note">SVG preserves vector shapes and text, embeds local raster images, and includes gradients, shadows, blur, and blend modes. Vector networks become ordinary SVG paths; their graph editing controls are not retained. Adjusted images, masks, Boolean groups, and unsupported gradient placements are not included.</div>';
  return section('Export', `${rows}${message}${add}${svgExport}`);
}
const autoLayoutBindingProperties = [
  ['autoLayout.axis', 'Flow direction'], ['autoLayout.align', 'Alignment'], ['autoLayout.justify', 'Distribution'],
  ['autoLayout.mainSizing', 'Main size'], ['autoLayout.crossSizing', 'Cross size'], ['autoLayout.wrap', 'Wrap'],
  ['autoLayout.autoPositioning', 'Grid auto position'], ['autoLayout.columns', 'Grid columns'], ['autoLayout.rows', 'Grid rows'],
  ['autoLayout.columnGap', 'Horizontal gap'], ['autoLayout.rowGap', 'Vertical gap'],
  ['autoLayout.padding.top', 'Top padding'], ['autoLayout.padding.right', 'Right padding'],
  ['autoLayout.padding.bottom', 'Bottom padding'], ['autoLayout.padding.left', 'Left padding']
];
function resolveAutoLayoutSettings(node) {
  const settings = createAutoLayout(node.autoLayout || {});
  for (const [property] of autoLayoutBindingProperties) {
    if (!node.variableBindings?.[property]) continue;
    const value = getNodePropertyValue(state.document, node, property);
    const keys = property.slice('autoLayout.'.length).split('.');
    let target = settings;
    for (const key of keys.slice(0, -1)) target = target[key];
    target[keys.at(-1)] = value;
  }
  return createAutoLayout(settings);
}
function applyAutoLayout(frame) {
  if (!frame?.autoLayout) return applyAutoLayoutEngine(frame);
  const baseSettings = createAutoLayout(frame.autoLayout);
  const hasBindings = autoLayoutBindingProperties.some(([property]) => frame.variableBindings?.[property]);
  if (!hasBindings) return applyAutoLayoutEngine(frame);
  const resolvedSettings = resolveAutoLayoutSettings(frame);
  const result = applyAutoLayoutEngine(frame, resolvedSettings);
  frame.autoLayout = baseSettings;
  return result;
}
function relayoutVariableBoundFrames() {
  const affected = new Map();
  for (const page of state.document.pages || []) walkNodes(page.children || [], ({ node, parents }) => {
    if (node.type !== 'frame' || !node.autoLayout || !autoLayoutBindingProperties.some(([property]) => node.variableBindings?.[property])) return;
    for (let index = 0; index < parents.length; index += 1) {
      const frame = parents[index];
      if (frame.type === 'frame' && frame.autoLayout) affected.set(frame.id, { node: frame, depth: index + 1 });
    }
    affected.set(node.id, { node, depth: parents.length + 1 });
  });
  for (const { node } of [...affected.values()].sort((left, right) => right.depth - left.depth)) applyAutoLayout(node);
}
function autoLayoutSection(node) {
  if (!node.autoLayout) return section('Layout', `<button class="add-fill" data-action="auto-layout-toggle">＋ Add auto layout</button><div class="image-properties-note">Flow child layers with direction, spacing, alignment, and wrap sizing.</div>`);
  const layout = resolveAutoLayoutSettings(node);
  const select = (prop, value, values) => `<select class="prop-input select-field" data-prop="autoLayout.${prop}" aria-label="${prop}">${values.map(([key, label]) => `<option value="${key}"${String(value) === key ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  const axis = select('axis', layout.axis, [['vertical','Vertical'],['horizontal','Horizontal'],['grid','Grid']]);
  const padding = `<div class="property-grid">${numberField('Top', 'autoLayout.padding.top', layout.padding.top, 1, 0)}${numberField('Right', 'autoLayout.padding.right', layout.padding.right, 1, 0)}${numberField('Bottom', 'autoLayout.padding.bottom', layout.padding.bottom, 1, 0)}${numberField('Left', 'autoLayout.padding.left', layout.padding.left, 1, 0)}</div>`;
  const variableProperties = autoLayoutBindingProperties.map(([property, label]) => variablePropertyBindingControl(node, property, label)).filter(Boolean).join('');
  const variableBindings = variableProperties ? `<details class="auto-layout-variable-bindings"><summary>Bind layout properties</summary>${variableProperties}</details>` : '';
  const body = layout.axis === 'grid'
    ? `<div class="property-grid"><span class="field-caption">Flow</span>${axis}${numberField('Columns', 'autoLayout.columns', layout.columns, 1, 1, 64)}<span class="field-caption">Rows</span>${select('rows', layout.rows, [['auto','Auto'], ...Array.from({ length: 64 }, (_, index) => [String(index + 1), String(index + 1)])])}${numberField('Horizontal gap', 'autoLayout.columnGap', layout.columnGap, 1, 0)}${numberField('Vertical gap', 'autoLayout.rowGap', layout.rowGap, 1, 0)}<label class="field-caption" for="auto-layout-auto-positioning">Auto position</label><input class="prop-input" data-prop="autoLayout.autoPositioning" type="checkbox" id="auto-layout-auto-positioning" ${layout.autoPositioning ? 'checked' : ''}/></div>${padding}<div class="image-properties-note">Grid cells flow in layer order. Turn off Auto position to edit a layer’s row and column.</div>${variableBindings}<button class="add-fill" data-action="auto-layout-toggle">− Remove auto layout</button>`
    : `<div class="property-grid"><span class="field-caption">Flow</span>${axis}${numberField('Horizontal gap', 'autoLayout.columnGap', layout.columnGap, 1, 0)}${numberField('Vertical gap', 'autoLayout.rowGap', layout.rowGap, 1, 0)}<span class="field-caption">Align</span>${select('align', layout.align, [['start','Start'],['center','Center'],['end','End'],['stretch','Stretch']])}<span class="field-caption">Distribute</span>${select('justify', layout.justify, [['start','Packed'],['center','Center'],['end','End'],['space-between','Space between']])}<span class="field-caption">Main size</span>${select('mainSizing', layout.mainSizing, [['fixed','Fixed'],['hug','Hug contents']])}<span class="field-caption">Cross size</span>${select('crossSizing', layout.crossSizing, [['fixed','Fixed'],['hug','Hug contents']])}<label class="field-caption" for="auto-layout-wrap">Wrap</label><input class="prop-input" data-prop="autoLayout.wrap" type="checkbox" id="auto-layout-wrap" ${layout.wrap ? 'checked' : ''}/></div>${padding}${variableBindings}<button class="add-fill" data-action="auto-layout-toggle">− Remove auto layout</button>`;
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
function componentPropertyTargets(root) {
  const targets = [];
  const visit = (node, isRoot = false) => {
    targets.push(node);
    if (!isRoot && node.isInstance) return;
    for (const child of node.children || []) visit(child);
  };
  visit(root, true);
  return targets;
}
function defaultVariableMode(collection) {
  return collection?.modes?.find(mode => mode.id === collection.defaultModeId) || collection?.modes?.[0] || null;
}
function componentInstancePropertyControls(component, instance) {
  const rows = (component?.componentProperties || []).map(property => {
    const current = Object.hasOwn(instance.componentPropertyValues || {}, property.id)
      ? instance.componentPropertyValues[property.id] : property.defaultValue;
    const label = `<span>${escapeHtml(property.name)}</span>`;
    if (property.type === 'BOOLEAN') return `<label class="component-property-value">${label}<input type="checkbox" data-component-property-value="${escapeHtml(property.id)}" data-instance-id="${escapeHtml(instance.id)}"${current ? ' checked' : ''} aria-label="${escapeHtml(property.name)}"/></label>`;
    if (property.type === 'TEXT') return `<label class="component-property-value">${label}<input type="text" maxlength="1000000" data-component-property-value="${escapeHtml(property.id)}" data-instance-id="${escapeHtml(instance.id)}" value="${escapeHtml(current)}" aria-label="${escapeHtml(property.name)}"/></label>`;
    if (property.type === 'SLOT') {
      const count = Array.isArray(current) ? current.length : 0;
      const hasOverride = Object.hasOwn(instance.componentPropertyValues || {}, property.id);
      return `<div class="component-slot-value"><div class="component-slot-copy"><strong>${escapeHtml(property.name)}</strong><small>${hasOverride ? `${count} custom layer${count === 1 ? '' : 's'}` : 'Using default content'}</small></div><button class="secondary-button" type="button" data-action="choose-component-slot-content" data-instance-id="${escapeHtml(instance.id)}" data-property-id="${escapeHtml(property.id)}">${hasOverride ? 'Replace…' : 'Choose content…'}</button>${hasOverride ? `<button class="tiny-icon-button component-slot-reset" type="button" data-action="reset-component-slot" data-instance-id="${escapeHtml(instance.id)}" data-property-id="${escapeHtml(property.id)}" aria-label="Reset ${escapeHtml(property.name)} to component default" title="Reset to component default">↺</button>` : ''}</div>`;
    }
    const validCandidates = (state.document.components || []).filter(candidate => canSwapComponentTo(state.document, component.id, candidate.id));
    const preferredCandidates = property.preferredComponentIds?.length
      ? validCandidates.filter(candidate => property.preferredComponentIds.includes(candidate.id))
      : validCandidates;
    const currentCandidate = state.document.components?.find(item => item.id === current);
    const candidates = currentCandidate && canSwapComponentTo(state.document, component.id, currentCandidate.id)
      && !preferredCandidates.some(item => item.id === currentCandidate.id)
      ? [...preferredCandidates, currentCandidate]
      : preferredCandidates;
    const choices = candidates.map(candidate => `<option value="${escapeHtml(candidate.id)}"${candidate.id === current ? ' selected' : ''}>${escapeHtml(candidate.name)}</option>`).join('');
    return `<label class="component-property-value">${label}<select class="select-field" data-component-property-value="${escapeHtml(property.id)}" data-instance-id="${escapeHtml(instance.id)}" aria-label="${escapeHtml(property.name)} component">${choices}</select></label>`;
  }).join('');
  return rows ? `<div class="component-property-values">${rows}</div>` : '';
}
function componentPropertyDefinitions(component, root) {
  const targets = componentPropertyTargets(root);
  const selectedTarget = targets.find(target => target.id === state.componentPropertyTargetId) || targets[0];
  const supportedTypes = [['BOOLEAN', 'Visibility']];
  if (selectedTarget?.type === 'text') supportedTypes.push(['TEXT', 'Text']);
  if (selectedTarget?.isInstance) supportedTypes.push(['INSTANCE_SWAP', 'Instance swap']);
  if (selectedTarget && selectedTarget.id !== component.rootNodeId && ['frame', 'group', 'section'].includes(selectedTarget.type)) supportedTypes.push(['SLOT', 'Content slot']);
  const selectedType = supportedTypes.some(([type]) => type === state.componentPropertyType) ? state.componentPropertyType : supportedTypes[0]?.[0] || 'BOOLEAN';
  const definitions = (component.componentProperties || []).map(property => {
    const target = targets.find(item => item.id === property.targetSourceId);
    const summary = property.type === 'BOOLEAN' ? 'Visibility' : property.type === 'TEXT' ? 'Text' : property.type === 'SLOT' ? 'Flexible slot' : 'Instance swap';
    return `<div class="component-property-definition"><strong>${escapeHtml(property.name)}</strong><small>${summary}${target ? ` · ${escapeHtml(target.name)}` : ''}</small></div>`;
  }).join('');
  const targetOptions = targets.map(target => `<option value="${escapeHtml(target.id)}"${target.id === selectedTarget?.id ? ' selected' : ''}>${escapeHtml(target.name)}</option>`).join('');
  const typeOptions = supportedTypes.map(([type, label]) => `<option value="${type}"${type === selectedType ? ' selected' : ''}>${label}</option>`).join('');
  const editor = targets.length && (component.componentProperties || []).length < 100
    ? `<div class="component-property-editor"><input class="text-field" id="component-property-name" maxlength="80" value="" placeholder="Property name" aria-label="New component property name"/><select class="select-field" id="component-property-target" aria-label="Component property target">${targetOptions}</select><select class="select-field" id="component-property-type" aria-label="Component property type">${typeOptions}</select><button class="add-fill" data-action="create-component-property" data-component-id="${escapeHtml(component.id)}" data-target-id="${escapeHtml(selectedTarget.id)}" data-property-type="${selectedType}">＋ Add property</button></div>`
    : '';
  return `<div class="component-property-editor-wrap"><div class="component-property-heading">Component properties <span>${(component.componentProperties || []).length}/100</span></div>${definitions || '<div class="image-properties-note">Expose text, visibility, a nested instance, or a content slot as a reusable control.</div>'}${component.componentProperties?.length >= 100 ? '<div class="image-properties-note">This component has reached the 100-property limit.</div>' : editor}</div>`;
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
    const propertyControls = componentInstancePropertyControls(component, linkedInstance);
    return section('Instance', `<div class="component-link-copy"><strong>${escapeHtml(set?.name || component?.name || 'Missing component')}</strong><span>${label}</span></div>${selectors ? `<div class="variant-controls">${selectors}</div>` : ''}${propertyControls}<button class="add-fill" data-action="detach-component-instance" data-instance-id="${escapeHtml(linkedInstance.id)}">Detach instance</button>`);
  }
  if (node.isComponent) {
    const component = state.document.components?.find(item => item.id === node.componentId);
    const set = state.document.componentSets?.find(item => item.id === component?.componentSetId);
    const variantFields = set ? set.properties.map(property => `<label class="variant-control"><span>${escapeHtml(property.name)}</span><input class="prop-input" data-variant-master-property="${escapeHtml(property.name)}" data-component-id="${escapeHtml(component.id)}" value="${escapeHtml(component.variantProperties?.[property.name] || '')}" aria-label="${escapeHtml(property.name)} variant value"/></label>`).join('') : '';
    const variantLabel = set ? `Variant in ${set.name} · changes update linked instances` : 'Main component · changes update linked instances';
    return section('Component', `<div class="component-link-copy"><strong>${escapeHtml(component?.name || node.name)}</strong><span>${escapeHtml(variantLabel)}</span></div>${variantFields ? `<div class="variant-controls">${variantFields}</div>` : ''}${component ? componentPropertyDefinitions(component, node) : ''}<button class="add-fill" data-action="create-component-instance" data-component-id="${escapeHtml(node.componentId)}">＋ Create instance</button>`);
  }
  if (node.isInstance) {
    const component = state.document.components?.find(item => item.id === node.componentId);
    const propertyControls = componentInstancePropertyControls(component, node);
    return section('Instance', `<div class="component-link-copy"><strong>${escapeHtml(component?.name || 'Missing component')}</strong><span>Linked instance · local edits remain as overrides</span></div>${propertyControls}<button class="add-fill" data-action="detach-component-instance">Detach instance</button>`);
  }
  return section('Component', '<button class="add-fill" data-action="create-component">◇ Create component</button><div class="image-properties-note">Create a reusable main component from this layer and its children.</div>');
}
function textSection(node) {
  const fontSize = getNodePropertyValue(state.document, node, 'fontSize');
  const lineHeight = getNodePropertyValue(state.document, node, 'lineHeight');
  const letterSpacing = getNodePropertyValue(state.document, node, 'letterSpacing');
  const textFit = node.textFit || 'auto-height';
  const fontFamilies = ['Inter, Arial, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'monospace', 'system-ui, sans-serif', 'Verdana, sans-serif', 'Trebuchet MS, sans-serif', 'Times New Roman, serif', 'Courier New, monospace'];
  const familyOptions = fontFamilies.map(family => `<option value="${escapeHtml(family)}"></option>`).join('');
  const weightOptions = [[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semi bold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']]
    .map(([weight, label]) => `<option value="${weight}"${Number(node.fontWeight || 400) === weight ? ' selected' : ''}>${label}</option>`).join('');
  const styleOptions = [['normal', 'Regular'], ['italic', 'Italic']]
    .map(([value, label]) => `<option value="${value}"${(node.fontStyle || 'normal') === value ? ' selected' : ''}>${label}</option>`).join('');
  const body = `<div class="property-grid"><input class="prop-input select-field typography-font-family" data-prop="fontFamily" type="text" maxlength="160" list="font-family-options" value="${escapeHtml(node.fontFamily || '')}" placeholder="Font family" aria-label="Font family"/><datalist id="font-family-options">${familyOptions}</datalist><select class="prop-input select-field" data-prop="textFit" aria-label="Text resize mode" style="grid-column:span 2"><option value="fixed"${textFit === 'fixed' ? ' selected' : ''}>Fixed size</option><option value="auto-height"${textFit === 'auto-height' ? ' selected' : ''}>Auto height</option><option value="auto-width"${textFit === 'auto-width' ? ' selected' : ''}>Auto width</option></select>${numberField('Size', 'fontSize', fontSize, 1)}<select class="prop-input select-field" data-prop="fontWeight" aria-label="Font weight">${weightOptions}</select>${numberField('Line', 'lineHeight', lineHeight, .05)}${numberField('↔', 'letterSpacing', letterSpacing || 0, .1)}<select class="prop-input select-field" data-prop="fontStyle" aria-label="Font style">${styleOptions}</select><select class="prop-input select-field" data-prop="align" aria-label="Text align"><option value="left"${node.align === 'left' ? ' selected' : ''}>Left</option><option value="center"${node.align === 'center' ? ' selected' : ''}>Center</option><option value="right"${node.align === 'right' ? ' selected' : ''}>Right</option></select></div><div class="image-properties-note">Use a font installed on this device; type a family name or choose a preset. Auto height wraps to the box width.</div>${variablePropertyBindingControl(node, 'fontSize', 'Font size')}${variablePropertyBindingControl(node, 'lineHeight', 'Line height')}${variablePropertyBindingControl(node, 'letterSpacing', 'Letter spacing')}<div style="margin-top:9px">${colorField('Text color', 'color', getNodeColor(state.document, node, 'text'), 100)}${variableBindingControl(node, 'text')}</div>${variablePropertyBindingControl(node, 'text', 'Text content')}<button class="add-fill" data-action="edit-text">Edit text content</button><button class="add-fill" data-action="create-typography-style">＋ Save text style</button><button class="add-fill" data-action="create-color-style">${node.textStyleId ? '✦ Linked text color' : '＋ Create text color style'}</button><button class="add-fill" data-action="create-color-variable" data-kind="text">＋ Create color variable</button>`;
  const textCase = ['none', 'uppercase', 'lowercase', 'capitalize'].includes(node.textCase) ? node.textCase : 'none';
  const textDecoration = ['none', 'underline', 'line-through'].includes(node.textDecoration) ? node.textDecoration : 'none';
  const verticalAlign = ['top', 'middle', 'bottom'].includes(node.verticalAlign) ? node.verticalAlign : 'top';
  const renderingControls = `<div class="property-grid"><select class="prop-input select-field" data-prop="textCase" aria-label="Text case"><option value="none"${textCase === 'none' ? ' selected' : ''}>As typed</option><option value="uppercase"${textCase === 'uppercase' ? ' selected' : ''}>UPPERCASE</option><option value="lowercase"${textCase === 'lowercase' ? ' selected' : ''}>lowercase</option><option value="capitalize"${textCase === 'capitalize' ? ' selected' : ''}>Capitalize</option></select><select class="prop-input select-field" data-prop="textDecoration" aria-label="Text decoration"><option value="none"${textDecoration === 'none' ? ' selected' : ''}>No decoration</option><option value="underline"${textDecoration === 'underline' ? ' selected' : ''}>Underline</option><option value="line-through"${textDecoration === 'line-through' ? ' selected' : ''}>Strikethrough</option></select><select class="prop-input select-field" data-prop="verticalAlign" aria-label="Vertical align"><option value="top"${verticalAlign === 'top' ? ' selected' : ''}>Top</option><option value="middle"${verticalAlign === 'middle' ? ' selected' : ''}>Middle</option><option value="bottom"${verticalAlign === 'bottom' ? ' selected' : ''}>Bottom</option></select></div>`;
  return section('Typography', body.replace('</div><div class="image-properties-note">', `</div>${renderingControls}<div class="image-properties-note">`));
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
  const html = output.html || '<!-- Select a layer to generate an HTML structure. -->';
  const json = output.json || '[]';
  return `<div class="inspect-panel"><div class="inspect-intro"><span>LOCAL HANDOFF</span><strong>${entries.length === 1 ? 'Layer values' : `${entries.length} selected layers`}</strong><small>Resolved from the current local design · positions are relative to the page</small></div><div class="inspect-layer-list">${cards}</div><section class="inspect-code-card"><header><div><strong>CSS</strong><span>Layout and style starting point</span></div><button class="inspect-copy" type="button" data-inspect-copy="css">Copy CSS</button></header><pre><code>${escapeHtml(css)}</code></pre><p>Vector paths, masks, and Boolean geometry remain exact in the layer JSON below.</p></section><section class="inspect-code-card"><header><div><strong>HTML structure</strong><span>Nested layer markup scaffold</span></div><button class="inspect-copy" type="button" data-inspect-copy="html">Copy HTML</button></header><pre><code>${escapeHtml(html)}</code></pre><p>Local image sources and vector geometry stay in the layer JSON.</p></section><section class="inspect-code-card inspect-json-card"><header><div><strong>Layer JSON</strong><span>Exact selected layer data</span></div><button class="inspect-copy" type="button" data-inspect-copy="json">Copy JSON</button></header><details><summary>View structured data</summary><pre><code>${escapeHtml(json)}</code></pre></details></section></div>`;
}
function buildPrototypeInteractionCondition() {
  const variable = state.document.variables?.find(item => item.id === state.prototypeConditionVariableId);
  if (!variable) return null;
  const rawValue = state.prototypeConditionValue ?? String(resolveVariableValue(state.document, variable.id));
  let value = String(rawValue);
  if (variable.type === 'number') {
    if (!value.trim()) throw new TypeError('Enter a valid number for the prototype condition.');
    value = Number(rawValue);
    if (!Number.isFinite(value)) throw new TypeError('Enter a valid number for the prototype condition.');
  } else if (variable.type === 'boolean') value = rawValue === 'true';
  if (variable.type === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('Choose a valid color for the prototype condition.');
  return { variableId: variable.id, type: variable.type, operator: state.prototypeConditionOperator, value };
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
    const variableCollection = state.document.variableCollections?.find(collection => collection.id === interaction.collectionId);
    const variableMode = variableCollection?.modes.find(mode => mode.id === interaction.modeId);
    const actionLabel = interaction.action === 'open-overlay' ? `Open overlay · ${interaction.overlayPosition || 'center'}` : interaction.action === 'swap-overlay' ? 'Swap overlay' : interaction.action === 'close-overlay' ? 'Close overlay' : interaction.action === 'back' ? 'Back' : interaction.action === 'open-link' ? 'Open link' : interaction.action === 'set-variable-mode' ? `Set ${variableCollection?.name || 'variable mode'}` : 'Navigate to';
    const triggerLabel = interaction.trigger === 'while-hovering' ? 'While hovering' : 'On click / tap';
    const destinationLabel = target ? `${target.name} · ${targetPage?.name || 'Page'}` : interaction.action === 'close-overlay' ? 'Current overlay' : interaction.action === 'back' ? 'Previous screen' : interaction.action === 'open-link' ? interaction.url : interaction.action === 'set-variable-mode' ? `${variableMode?.name || 'Missing mode'} · ${variableCollection?.name || 'Missing collection'}` : 'Missing frame';
    const conditionVariable = interaction.condition && state.document.variables?.find(item => item.id === interaction.condition.variableId);
    const conditionLabel = conditionVariable ? ` · If ${conditionVariable.name} ${interaction.condition.operator === 'equals' ? 'is' : 'is not'} ${String(interaction.condition.value)}` : '';
    return `<div class="prototype-interaction-row"><span class="prototype-interaction-icon">${interaction.action === 'close-overlay' ? '×' : interaction.action === 'back' ? '←' : interaction.action === 'open-overlay' || interaction.action === 'swap-overlay' ? '▱' : '↗'}</span><span class="prototype-interaction-copy"><strong>${escapeHtml(triggerLabel)} · ${escapeHtml(actionLabel)}</strong><small>${escapeHtml(destinationLabel)}${interaction.transition && interaction.transition !== 'instant' ? ` · ${escapeHtml(interaction.easing || 'ease-in-out')}` : ''}${escapeHtml(conditionLabel)}</small></span><button class="tiny-icon-button" data-action="remove-prototype-interaction" data-interaction-id="${escapeHtml(interaction.id)}" aria-label="Remove interaction" title="Remove interaction">×</button></div>`;
  }).join('');
  const needsDestination = ['navigate', 'open-overlay', 'swap-overlay'].includes(state.prototypeAction);
  const connectState = state.prototypeSourceId === node?.id ? `<div class="prototype-connect-hint">${state.prototypeAction === 'open-overlay' ? 'Click the frame to show as an overlay.' : state.prototypeAction === 'swap-overlay' ? 'Click the frame to swap into the overlay.' : 'Click a destination frame on the canvas.'} Press Escape to cancel.</div>` : '';
  const overlayControls = state.prototypeAction === 'open-overlay' ? `<label>Position<select id="prototype-overlay-position" class="select-field">${[['center','Center'],['top-left','Top left'],['top-center','Top center'],['top-right','Top right'],['left-center','Left center'],['right-center','Right center'],['bottom-left','Bottom left'],['bottom-center','Bottom center'],['bottom-right','Bottom right']].map(([value, label]) => `<option value="${value}"${state.prototypeOverlayPosition === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label><span>Dismiss on outside click</span><input id="prototype-overlay-outside" type="checkbox"${state.prototypeOverlayOutsideClick ? ' checked' : ''}/></label><label><span>Show background</span><input id="prototype-overlay-background" type="checkbox"${state.prototypeOverlayBackground ? ' checked' : ''}/></label>${state.prototypeOverlayBackground ? `<label>Background<input id="prototype-overlay-color" type="color" value="${state.prototypeOverlayBackgroundColor}"/><input id="prototype-overlay-opacity" type="range" min="0" max="100" value="${Math.round(state.prototypeOverlayBackgroundOpacity * 100)}" aria-label="Overlay background opacity"/></label>` : ''}` : '';
  const transitionOptions = [['instant', 'Instant'], ['dissolve', 'Dissolve'], ['move-left', 'Move in · left'], ['move-right', 'Move in · right'], ...(state.prototypeAction === 'navigate' ? [['smart-animate', 'Smart animate']] : [])]
    .map(([value, label]) => `<option value="${value}"${state.prototypeTransition === value ? ' selected' : ''}>${label}</option>`).join('');
  const easingOptions = [['ease-in-out', 'Ease in and out'], ['linear', 'Linear'], ['ease-in', 'Ease in'], ['ease-out', 'Ease out']]
    .map(([value, label]) => `<option value="${value}"${state.prototypeEasing === value ? ' selected' : ''}>${label}</option>`).join('');
  const easingControl = state.prototypeTransition === 'instant' ? '' : `<label>Easing<select id="prototype-easing" class="select-field">${easingOptions}</select></label>`;
  const variableCollections = state.document.variableCollections || [];
  const conditionVariables = state.document.variables || [];
  const conditionVariable = conditionVariables.find(variable => variable.id === state.prototypeConditionVariableId) || null;
  const rawConditionValue = conditionVariable
    ? state.prototypeConditionValue ?? String(resolveVariableValue(state.document, conditionVariable.id))
    : '';
  const conditionValueControl = conditionVariable?.type === 'boolean'
    ? `<select id="prototype-condition-value" class="select-field" aria-label="Condition value"><option value="true"${rawConditionValue === 'true' ? ' selected' : ''}>True</option><option value="false"${rawConditionValue === 'false' ? ' selected' : ''}>False</option></select>`
    : conditionVariable?.type === 'color'
      ? `<input id="prototype-condition-value" type="color" value="${/^#[0-9a-f]{6}$/i.test(rawConditionValue) ? escapeHtml(rawConditionValue) : '#000000'}" aria-label="Condition color"/>`
      : conditionVariable?.type === 'number'
        ? `<input id="prototype-condition-value" class="text-input" type="number" step="any" value="${escapeHtml(rawConditionValue)}" aria-label="Condition number"/>`
        : conditionVariable
          ? `<input id="prototype-condition-value" class="text-input" type="text" value="${escapeHtml(rawConditionValue)}" aria-label="Condition text"/>`
          : '';
  const conditionControls = `<label>Only if variable<select id="prototype-condition-variable" class="select-field"><option value=""${conditionVariable ? '' : ' selected'}>Always</option>${conditionVariables.map(variable => `<option value="${escapeHtml(variable.id)}"${variable.id === conditionVariable?.id ? ' selected' : ''}>${escapeHtml(variable.name)} · ${escapeHtml(variable.type)}</option>`).join('')}</select></label>${conditionVariable ? `<label>Condition<select id="prototype-condition-operator" class="select-field"><option value="equals"${state.prototypeConditionOperator === 'equals' ? ' selected' : ''}>Equals</option><option value="not-equals"${state.prototypeConditionOperator === 'not-equals' ? ' selected' : ''}>Does not equal</option></select></label><label>Value${conditionValueControl}</label>` : ''}`;
  const prototypeCollection = variableCollections.find(collection => collection.id === state.prototypeVariableCollectionId) || variableCollections[0] || null;
  const prototypeModes = prototypeCollection?.modes || [];
  const selectedPrototypeMode = prototypeModes.find(mode => mode.id === state.prototypeVariableModeId) || defaultVariableMode(prototypeCollection);
  const variableModeControls = state.prototypeAction === 'set-variable-mode'
    ? prototypeCollection
      ? `<label>Collection<select id="prototype-variable-collection" class="select-field">${variableCollections.map(collection => `<option value="${escapeHtml(collection.id)}"${collection.id === prototypeCollection.id ? ' selected' : ''}>${escapeHtml(collection.name)}</option>`).join('')}</select></label><label>Mode<select id="prototype-variable-mode" class="select-field">${prototypeModes.map(mode => `<option value="${escapeHtml(mode.id)}"${mode.id === selectedPrototypeMode?.id ? ' selected' : ''}>${escapeHtml(mode.name)}</option>`).join('')}</select></label>`
      : '<p class="prototype-hint">Create a variable collection and modes before adding this action.</p>'
    : '';
  const controls = node ? `<div class="prototype-controls"><label>Trigger<select id="prototype-trigger" class="select-field"><option value="on-click"${state.prototypeTrigger === 'on-click' ? ' selected' : ''}>On click / tap</option><option value="while-hovering"${state.prototypeTrigger === 'while-hovering' ? ' selected' : ''}>While hovering</option></select></label><label>Action<select id="prototype-action" class="select-field"><option value="navigate"${state.prototypeAction === 'navigate' ? ' selected' : ''}>Navigate to</option><option value="open-overlay"${state.prototypeAction === 'open-overlay' ? ' selected' : ''}>Open overlay</option><option value="swap-overlay"${state.prototypeAction === 'swap-overlay' ? ' selected' : ''}>Swap overlay</option><option value="close-overlay"${state.prototypeAction === 'close-overlay' ? ' selected' : ''}>Close overlay</option><option value="back"${state.prototypeAction === 'back' ? ' selected' : ''}>Back</option><option value="open-link"${state.prototypeAction === 'open-link' ? ' selected' : ''}>Open link</option><option value="set-variable-mode"${state.prototypeAction === 'set-variable-mode' ? ' selected' : ''}>Set variable mode</option></select></label>${conditionControls}${variableModeControls}${state.prototypeAction === 'open-link' ? `<label>URL<input id="prototype-url" class="text-input" type="url" value="${escapeHtml(state.prototypeUrl)}" placeholder="https://example.com or mailto:hello@example.com" /></label>` : ''}${needsDestination ? `<label>Transition<select id="prototype-transition" class="select-field">${transitionOptions}</select></label>${easingControl}<label>Duration <span id="prototype-duration-value">${(state.prototypeDuration / 1000).toFixed(1)} s</span><input id="prototype-duration" type="range" min="0" max="2000" step="100" value="${state.prototypeDuration}" /></label>${overlayControls}` : ''}<button class="primary-button prototype-add-link" data-action="prototype-connect"${state.prototypeAction === 'set-variable-mode' && !prototypeCollection ? ' disabled' : ''}>＋ Add ${state.prototypeAction === 'navigate' ? 'interaction' : state.prototypeAction.replace('-', ' ')}</button>${connectState}</div>` : '<p class="prototype-hint">Select a layer to add an interaction, or choose a frame above to set the starting point.</p>';
  const sourceLabel = node ? `<div class="prototype-section-label">${escapeHtml(node.name)} interactions</div>${interactions || '<div class="prototype-empty-links">No interactions yet</div>'}` : '';
  return `<div class="prototype-inspector"><section class="prototype-section"><div class="prototype-section-label">Flow starting point</div>${startBody}<button class="primary-button prototype-present-button" data-action="present">▶ Present</button></section>${node ? `<section class="prototype-section">${sourceLabel}${controls}</section>` : ''}<section class="prototype-section prototype-help"><strong>Prototype links</strong><span>Connect a selected layer to a frame, then use Present to try the flow. Variable mode actions update the active flow without changing the saved frame settings.</span></section></div>`;
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
    content.innerHTML = `<div class="multi-selection-card"><strong>${entries.length} layers selected</strong><span>${imageCount ? `${imageCount} image${imageCount === 1 ? '' : 's'} in selection. Use Image recipes below to apply a look without a keyboard or context menu.` : 'Use the Layers panel to change their order.'}</span></div>${imageCount ? selectionImageRecipesSection(imageCount) : ''}${section('Align & distribute', `<div class="multi-align-controls">${controls}</div><div class="image-properties-note">${layoutNote}</div>`)}${section('Selection', `<div class="property-grid">${numberField('X', 'selectionX', 0)}${numberField('Y', 'selectionY', 0)}</div>`)}`;
    return;
  }
  const node = entries[0].node;
  let body = componentSection(node) + transformSection(node) + blendingSection(node);
  if (node.type === 'boolean') {
    const operations = [['union', 'Union'], ['subtract', 'Subtract'], ['intersect', 'Intersect'], ['exclude', 'Exclude']];
    body += section('Boolean', `<select class="prop-input select-field" data-prop="operation" aria-label="Boolean operation">${operations.map(([value, label]) => `<option value="${value}"${node.operation === value ? ' selected' : ''}>${label}</option>`).join('')}</select><button class="add-fill" data-action="separate-boolean" style="margin-top:8px">Separate Boolean</button><div class="image-properties-note">The source shapes stay editable inside this live Boolean group.</div>`);
  }
  if (node.type === 'group' && node.mask) {
    const maskSource = node.children.find(child => child.id === node.maskSourceId);
    body += section('Mask', `<div class="image-properties-note">${escapeHtml(maskSource?.name || 'Vector shape')} masks the editable layers inside this group.</div><button class="add-fill" data-action="release-mask">Release mask</button>`);
  }
  if (node.type === 'text') body += textSection(node);
  if (node.type === 'image') body += imageAdjustmentsSection(node) + singleImageRecipesSection(node);
  if (node.type === 'path') {
    const pointCount = node.points?.length || 0;
    const selectedPoint = state.selectedVectorPoint?.nodeId === node.id;
    body += section('Vector', `<label class="field-caption" style="display:flex;align-items:center;gap:8px"><input class="prop-input" data-prop="closed" type="checkbox" ${node.closed ? 'checked' : ''}/> Closed path</label><div class="image-properties-note">${pointCount} points · double-click a segment to insert; drag anchors and handles to refine it.</div><div class="vector-point-actions"><button class="add-fill" data-action="insert-vector-point">＋ Add point</button><button class="add-fill" data-action="delete-vector-point"${selectedPoint ? '' : ' disabled'}>− Delete point</button></div>`);
    if (node.closed) body += appearanceSection(node);
    else body += section('Stroke', colorField('Stroke', 'stroke', getNodeColor(state.document, node, 'stroke'), 100) + variableBindingControl(node, 'stroke') + `<button class="add-fill" data-action="create-color-variable" data-kind="stroke">＋ Create stroke variable</button><div class="property-grid" style="margin-top:8px">${numberField('W', 'strokeWidth', node.strokeWidth || 1)}</div>`);
  } else if (node.type === 'network') {
    const selectedVertex = state.selectedVectorPoint?.nodeId === node.id && state.selectedVectorPoint.vertexId;
    body += section('Vector network', `<div class="image-properties-note">${node.vertices.length} points · ${node.edges.length} edges · ${node.faces.length} closed regions. Select a point, then use Pen to branch from it.</div><div class="vector-point-actions"><button class="add-fill" data-action="insert-vector-point">＋ Add point</button><button class="add-fill" data-action="delete-vector-point"${selectedVertex ? '' : ' disabled'}>− Delete point</button></div>`);
    if (node.faces.length && !node.imageFill) body += section('Region fills', networkFaceControls(node));
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
  for (const input of content.querySelectorAll('[data-prop="fontFamily"],[data-prop="fontWeight"],[data-prop="align"],[data-prop="verticalAlign"],[data-prop="fit"],[data-prop="textFit"]')) input.value = String(node[input.dataset.prop] ?? input.value);
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
  const textStyles = $('#text-styles-list'); textStyles.replaceChildren();
  const typographyStyles = state.document.typographyStyles || [];
  if (!typographyStyles.length) {
    const empty = document.createElement('div'); empty.className = 'typography-styles-empty'; empty.textContent = 'Save typography from a text layer to reuse it here.'; textStyles.append(empty);
  } else {
    const hint = document.createElement('div'); hint.className = 'typography-styles-hint'; hint.textContent = 'Applying copies settings into selected text. Updates affect future applications.'; textStyles.append(hint);
  }
  for (const style of typographyStyles) {
    const row = document.createElement('div'); row.className = 'typography-style-row';
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'typography-style-apply'; apply.dataset.typographyStyleId = style.id; apply.title = `Apply ${style.name} to selected text`;
    const mark = document.createElement('span'); mark.className = 'typography-style-mark'; mark.textContent = 'Tt'; mark.style.fontFamily = style.fontFamily; mark.style.fontSize = `${Math.max(12, Math.min(22, style.fontSize))}px`; mark.style.fontWeight = String(style.fontWeight); mark.style.fontStyle = style.fontStyle; mark.style.color = style.color; mark.style.textTransform = ['uppercase', 'lowercase', 'capitalize'].includes(style.textCase) ? style.textCase : 'none'; mark.style.textDecoration = ['underline', 'line-through'].includes(style.textDecoration) ? style.textDecoration : 'none';
    const copy = document.createElement('span'); copy.className = 'typography-style-copy';
    const name = document.createElement('span'); name.className = 'typography-style-name'; name.textContent = style.name;
    const detail = document.createElement('small'); detail.textContent = `${style.fontFamily} · ${style.fontSize}px · ${style.fontWeight}`;
    copy.append(name, detail); apply.append(mark, copy);
    const actions = document.createElement('div'); actions.className = 'typography-style-actions';
    const update = document.createElement('button'); update.type = 'button'; update.dataset.textStyleAction = 'update'; update.dataset.textStyleId = style.id; update.textContent = 'Update'; update.title = `Update ${style.name} from selected text`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.textStyleAction = 'delete'; remove.dataset.textStyleId = style.id; remove.textContent = '×'; remove.title = `Delete ${style.name}`; remove.setAttribute('aria-label', `Delete ${style.name}`);
    actions.append(update, remove); row.append(apply, actions); textStyles.append(row);
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
function nodeTransformContext(node) {
  const entry = node ? findNode(state.document, node.id) : null;
  if (!entry) return null;
  const geometry = { ...node, ...resolvedGeometry(node) };
  const ancestors = entry.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
  return { entry, geometry, ancestors, origin: { x: geometry.x, y: geometry.y } };
}
function deepestContainerAt(point) {
  return deepestContainerAtPagePoint(activePage()?.children || [], point, state.document);
}
function parentLocalPenAnchors(anchors, parent, nodeGeometry = null) {
  if (!parent) return anchors.map(point => ({ ...point }));
  const toParent = point => nodeGeometry
    ? pageToNodeParentLocal(nodeGeometry, point, parent.ancestors)
    : pageToParentLocal(point, parent.ancestors);
  return anchors.map(point => ({
    ...point,
    ...toParent(point),
    ...(point.in ? { in: toParent(point.in) } : {}),
    ...(point.out ? { out: toParent(point.out) } : {})
  }));
}
function localizeToParent(node, pageX, pageY, parent, { anchor = 'top-left' } = {}) {
  const local = parent
    ? pageToParentLocal({ x: pageX, y: pageY }, parent.ancestors)
    : { x: pageX, y: pageY };
  const anchorX = anchor === 'center' ? node.width / 2 : 0;
  const anchorY = anchor === 'center' ? node.height / 2 : 0;
  node.x = local.x - anchorX;
  node.y = local.y - anchorY;
  addNode(state.document, node, { parentId: parent?.node.id ?? null });
  if (parent?.node.autoLayout) applyAutoLayout(parent.node);
}

function networkAnchorAt(world, node, pointerType = 'mouse') {
  if (!node || node.type !== 'network' || node.locked) return null;
  const context = nodeTransformContext(node);
  if (!context) return null;
  let best = null;
  for (const vertex of context.geometry.vertices || []) {
    const nodeLocalPoint = vectorNetworkVertexPoint(context.geometry, vertex.id, { x: 0, y: 0 });
    if (!nodeLocalPoint) continue;
    const pagePoint = nodeLocalToPage(context.geometry, nodeLocalPoint, context.ancestors);
    const parentPoint = vectorNetworkVertexPoint(context.geometry, vertex.id, context.origin);
    const distance = checkPointDistance(world, pagePoint);
    const tolerance = (pointerType === 'touch' ? 22 : 12) / Math.max(.08, state.zoom);
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { node, origin: context.origin, ancestors: context.ancestors, vertexId: vertex.id, localPoint: parentPoint, pagePoint, distance };
    }
  }
  return best;
}

function startPenPath(world, pointerType = 'mouse') {
  const selected = selectedNodes();
  const targetNetwork = selected.length === 1 && selected[0].type === 'network' && !selected[0].locked ? selected[0] : null;
  const closeTolerance = 10 / Math.max(.08, state.zoom);
  const draft = state.penDraft;
  if (draft) {
    const targetId = draft.targetNetworkId || draft.networkNodeId;
    const target = targetId ? findNode(state.document, targetId)?.node : targetNetwork;
    const existing = target ? networkAnchorAt(world, target, pointerType) : null;
    const first = draft.anchors[0];
    if (existing && draft.anchors.length >= 2) {
      const closesAtFirst = (first.vertexId && first.vertexId === existing.vertexId)
        || (!first.vertexId && checkPointDistance(world, first) <= closeTolerance);
      if (closesAtFirst) {
        if (draft.anchors.length >= 3) finishPenPath(true);
        else showToast('Add one more point before closing a region.');
        return;
      }
      const point = { ...existing.pagePoint, in: { ...existing.pagePoint }, out: { ...existing.pagePoint }, vertexId: existing.vertexId };
      draft.anchors.push(point);
      finishPenPath(false);
      return;
    }
    if (draft.anchors.length >= 3 && checkPointDistance(world, first) <= closeTolerance) {
      finishPenPath(true);
      return;
    }
    const pointPosition = world;
    const point = { ...pointPosition, in: { ...pointPosition }, out: { ...pointPosition } };
    draft.anchors.push(point);
    const pointIndex = draft.anchors.length - 1;
    state.interaction = { kind: 'pen-anchor', start: world, pointIndex, moved: false };
  } else {
    const existing = targetNetwork ? networkAnchorAt(world, targetNetwork, pointerType) : null;
    const point = existing ? existing.pagePoint : world;
    state.penDraft = {
      ...(targetNetwork ? { targetNetworkId: targetNetwork.id } : {}),
      anchors: [{ ...point, in: { ...point }, out: { ...point }, ...(existing ? { vertexId: existing.vertexId } : {}) }]
    };
    state.interaction = { kind: 'pen-anchor', start: world, pointIndex: 0, moved: false };
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
  const targetNetworkId = draft.targetNetworkId || draft.networkNodeId;
  const existing = targetNetworkId ? findNode(state.document, targetNetworkId)?.node : null;
  let node;
  if (existing?.type === 'network' && !existing.locked) {
    node = existing;
    checkpoint('Extend vector network');
    const context = nodeTransformContext(node);
    if (!context) return false;
    const anchors = parentLocalPenAnchors(draft.anchors, { ancestors: context.ancestors }, context.geometry);
    const geometryProperties = ['x', 'y', 'width', 'height'];
    const result = appendVectorNetworkPathResolved(node, anchors, context.geometry, {
      closed,
      writeGeometry: geometry => geometryProperties.every(property => setNodePropertyValue(node, property, geometry[property]))
    });
    if (!result?.addedEdges) { showToast('Add at least two distinct points to make a vector path.'); renderer.invalidate(); return false; }
    const boundGeometryProperties = geometryProperties.filter(property => node.variableBindings?.[property]);
    if (boundGeometryProperties.length) recordNodeComponentOverrides(node, ['variableBindings']);
    recordNodeComponentOverrides(node, ['vertices', 'edges', 'faces', ...geometryProperties.filter(property => !node.variableBindings?.[property])]);
  } else {
    checkpoint('Create vector network');
    const pageGeometry = vectorNetworkGeometryFromAnchors(draft.anchors, { closed });
    const center = { x: pageGeometry.x + pageGeometry.width / 2, y: pageGeometry.y + pageGeometry.height / 2 };
    const parent = deepestContainerAtPagePoint(activePage()?.children || [], center, state.document);
    const anchors = parentLocalPenAnchors(draft.anchors, parent);
    const geometry = vectorNetworkGeometryFromAnchors(anchors, { closed });
    node = createNode('network', geometry);
    addNode(state.document, node, { parentId: parent?.node.id ?? null });
    if (parent?.node.autoLayout) applyAutoLayout(parent.node);
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
  const entry = findNode(state.document, node.id);
  if (!entry) return null;
  const ancestors = entry.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
  const geometry = { ...node, ...resolvedGeometry(node) };
  const origin = { x: 0, y: 0 };
  const toPage = point => nodeLocalToPage(geometry, point, ancestors);
  const tolerance = (pointerType === 'touch' ? 22 : 9) / Math.max(.08, state.zoom);
  let best = null;
  if (node.type === 'network') {
    for (const edge of node.edges || []) {
      const points = vectorNetworkEdgePoints(geometry, edge.id, origin);
      if (!points) continue;
      for (const [part, handle, anchor] of [['control1', points[1], points[0]], ['control2', points[2], points[3]]]) {
        if (!edge[part]) continue;
        const point = toPage(handle);
        const distance = checkPointDistance(world, point);
        if (distance <= tolerance && (!best || distance < best.distance)) best = { node, origin, ancestors, edgeId: edge.id, part, distance };
      }
    }
    for (const vertex of node.vertices || []) {
      const point = toPage(vectorNetworkVertexPoint(geometry, vertex.id, origin));
      const distance = checkPointDistance(world, point);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { node, origin, ancestors, vertexId: vertex.id, part: 'anchor', distance };
    }
    return best;
  }
  for (let index = 0; index < (node.points || []).length; index += 1) {
    for (const part of ['in', 'out', 'anchor']) {
      if (part !== 'anchor') {
        const handle = node.points[index][part];
        if (!handle || (Number(handle.x) === 0 && Number(handle.y) === 0)) continue;
      }
      const point = toPage(vectorNodePoint(geometry, index, part, origin));
      const distance = checkPointDistance(world, point);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { node, origin, ancestors, index, part, distance };
    }
  }
  return best;
}

function insertPathPoint(node, segmentIndex, t = .5, origin = nodeTransformContext(node)?.origin || { x: node.x, y: node.y }) {
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
  const context = nodeTransformContext(node);
  if (!context) return;
  const segment = node.type === 'network' ? longestVectorNetworkEdge(node, context.origin) : longestVectorSegment(node, context.origin);
  if (!segment) { showToast('This vector shape has no segment to split.'); return; }
  checkpoint('Insert vector point');
  insertPathPoint(node, node.type === 'network' ? segment.edgeId : segment.segmentIndex, segment.t, context.origin);
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
  const context = nodeTransformContext(node);
  if (!context) return false;
  const parentPoint = pageToParentLocal(world, context.ancestors);
  const localWorld = unrotateForPath(parentPoint, context.geometry, context.origin);
  const closest = node.type === 'network'
    ? closestVectorNetworkEdge(context.geometry, localWorld, context.origin)
    : closestVectorSegment(context.geometry, localWorld, context.origin);
  if (!closest || closest.distance > 12 / Math.max(.08, state.zoom)) return false;
  checkpoint('Insert vector point');
  return insertPathPoint(node, node.type === 'network' ? closest.edgeId : closest.segmentIndex, closest.t, context.origin);
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
  const geometry = resolvedGeometry(node);
  const center = { x: origin.x + geometry.width / 2, y: origin.y + geometry.height / 2 };
  return rotatePoint(world, center, -geometry.rotation);
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
  const node = nodes[0];
  const nodeGeometry = { ...node, ...resolvedGeometry(node) };
  const ancestors = entry.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
  const handles = getTransformHandles(nodeGeometry, ancestors, { rotateOffset: 24 / Math.max(.08, state.zoom) });
  const point = screenToWorld(event, canvas, state);
  const tolerance = 8 / state.zoom;
  if (checkPointDistance(point, handles.rotate) <= tolerance) return { kind: 'rotate', node, entry, geometry: nodeGeometry, ancestors, center: nodeLocalToPage(nodeGeometry, { x: nodeGeometry.width / 2, y: nodeGeometry.height / 2 }, ancestors) };
  for (const [name, handle] of Object.entries(handles.resize)) if (checkPointDistance(point, handle) <= tolerance) return { kind: 'resize', name, node, entry, geometry: nodeGeometry, ancestors };
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
  const originals = new Map(nodes.map(item => {
    const entry = findNode(state.document, item.id);
    const geometry = { ...item, ...resolvedGeometry(item) };
    const ancestors = (entry?.parents || []).map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
    return [item.id, { x: geometry.x, y: geometry.y, ancestors }];
  }));
  state.interaction = { kind: 'move', start: world, originals, shiftKey };
}

function onCanvasPointerDown(event) {
  if (state.documentTransitioning) return;
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
    const target = findFrameAtPoint(activePage(), world, state.document);
    if (!target) { showToast('Choose a frame as the interaction destination.'); return; }
    if (target.id === state.prototypeSourceId) { showToast('Choose a different destination frame.'); return; }
    try {
      const condition = buildPrototypeInteractionCondition();
      checkpoint('Add prototype interaction');
      addPrototypeInteraction(state.document, state.prototypeSourceId, target.id, {
        action: state.prototypeAction,
        trigger: state.prototypeTrigger,
        transition: state.prototypeTransition,
        easing: state.prototypeEasing,
        duration: state.prototypeDuration,
        condition,
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
      if (handle.kind === 'rotate') {
        checkpoint('Rotate layer');
        const angle = Math.atan2(world.y - handle.center.y, world.x - handle.center.x);
        state.interaction = { kind: 'rotate', node: handle.node, entry: handle.entry, center: handle.center, startAngle: angle, lastAngle: angle, rotationDelta: 0, rotation: handle.geometry.rotation || 0 };
      } else {
        checkpoint('Resize layer');
        const geometry = handle.geometry;
        state.interaction = { kind: 'resize', handle: handle.name, node: handle.node, entry: handle.entry, ancestors: handle.ancestors, rect: geometry, width: geometry.width, height: geometry.height };
        if (handle.node.type === 'frame') state.interaction.childGeometry = captureChildGeometry(handle.node);
      }
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
    point.out = { ...world };
    point.in = { x: point.x - (world.x - point.x), y: point.y - (world.y - point.y) };
    state.penHover = world; renderer.invalidate(); return;
  }
  if (interaction.kind === 'vector-control') {
    const geometry = { ...interaction.node, ...resolvedGeometry(interaction.node) };
    const local = pageToNodeLocal(geometry, world, interaction.ancestors);
    setVectorNodePoint(interaction.node, interaction.index, interaction.part, local, {
      origin: interaction.origin,
      symmetric: interaction.part !== 'anchor' && !event.altKey
    });
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'network-control') {
    const geometry = { ...interaction.node, ...resolvedGeometry(interaction.node) };
    const local = pageToNodeLocal(geometry, world, interaction.ancestors);
    if (interaction.part === 'anchor') setVectorNetworkVertexPoint(interaction.node, interaction.vertexId, local, interaction.origin);
    else setVectorNetworkEdgeControlPoint(interaction.node, interaction.edgeId, interaction.part, local, interaction.origin);
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'move') {
    const pageDx = world.x - interaction.start.x; const pageDy = world.y - interaction.start.y;
    const grid = state.document.settings.grid || 8;
    for (const [id, original] of interaction.originals) {
      const node = findNode(state.document, id)?.node;
      if (!node) continue;
      const startLocal = pageToParentLocal(interaction.start, original.ancestors);
      const currentLocal = pageToParentLocal(world, original.ancestors);
      let dx = currentLocal.x - startLocal.x; let dy = currentLocal.y - startLocal.y;
      if (state.document.settings.snap && !event.altKey) { dx = Math.round(dx / grid) * grid; dy = Math.round(dy / grid) * grid; }
      setNodePropertyValue(node, 'x', original.x + dx);
      setNodePropertyValue(node, 'y', original.y + dy);
    }
    $('#position-status').textContent = `${Math.round(pageDx)}, ${Math.round(pageDy)} moved`;
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'rotate') {
    const angle = Math.atan2(world.y - interaction.center.y, world.x - interaction.center.x);
    let delta = angle - interaction.lastAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    else if (delta < -Math.PI) delta += Math.PI * 2;
    interaction.rotationDelta += delta * 180 / Math.PI;
    interaction.lastAngle = angle;
    const nextRotation = interaction.rotation + interaction.rotationDelta;
    setNodePropertyValue(interaction.node, 'rotation', event.shiftKey ? Math.round(nextRotation / 15) * 15 : nextRotation);
    $('#position-status').textContent = `${Math.round(resolvedGeometry(interaction.node).rotation)}° rotation`;
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
    const remaining = parent.children.filter(item => item.id !== interaction.node.id);
    const target = targetIndex < 0 ? null : siblings[targetIndex];
    const insertionIndex = target ? remaining.indexOf(target) : remaining.length;
    reorderNode(state.document, interaction.node.id, insertionIndex);
    applyAutoLayout(parent);
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'resize') {
    const aspectRatio = event.shiftKey && interaction.rect.height ? interaction.rect.width / interaction.rect.height : undefined;
    const resized = resizeOrientedRect(interaction.rect, interaction.handle, world, interaction.ancestors, { aspectRatio });
    for (const property of ['x', 'y', 'width', 'height']) setNodePropertyValue(interaction.node, property, resized[property]);
    const geometry = resolvedGeometry(interaction.node);
    if (interaction.node.type === 'frame' && interaction.node.autoLayout) applyAutoLayout(interaction.node);
    else if (interaction.node.type === 'frame') applyFrameConstraints(interaction.node, interaction.width, interaction.height, geometry.width, geometry.height, interaction.childGeometry);
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
  if (interaction.kind === 'move' || interaction.kind === 'resize' || interaction.kind === 'rotate' || interaction.kind === 'reorder') {
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
      } else {
        const properties = interaction.kind === 'resize' ? ['x', 'y', 'width', 'height'] : interaction.kind === 'rotate' ? ['rotation'] : ['x', 'y'];
        if (properties.some(property => node.variableBindings?.[property])) recordNodeComponentOverrides(node, ['variableBindings']);
        recordNodeComponentOverrides(node, properties.filter(property => !node.variableBindings?.[property]));
      }
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
      const geometry = { ...node, ...resolvedGeometry(node) };
      const ancestors = parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
      const corners = selectionOverlayGeometry(geometry, ancestors, { zoom: 1, rotateOffset: 0 }).corners;
      const left = Math.min(...corners.map(point => point.x));
      const top = Math.min(...corners.map(point => point.y));
      const right = Math.max(...corners.map(point => point.x));
      const bottom = Math.max(...corners.map(point => point.y));
      return left <= rect.x + rect.width && right >= rect.x && top <= rect.y + rect.height && bottom >= rect.y;
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
    localizeToParent(node, center.x, center.y, parent, { anchor: 'center' });
    setSelection([node.id]); queueSave(); renderer.invalidate(); return;
  }
}

function resizeTextNode(node) {
  if (node?.type !== 'text') return false;
  textMeasureContext ||= document.createElement('canvas').getContext('2d');
  if (!textMeasureContext) return false;
  const before = resolvedGeometry(node);
  const layoutNode = { ...node, ...before };
  const size = calculateTextBox(textMeasureContext, layoutNode, {
    fontSize: getNodePropertyValue(state.document, node, 'fontSize'),
    lineHeight: getNodePropertyValue(state.document, node, 'lineHeight'),
    letterSpacing: getNodePropertyValue(state.document, node, 'letterSpacing'),
    text: getNodePropertyValue(state.document, node, 'text')
  });
  if (!node.variableBindings?.width) node.width = size.width;
  if (!node.variableBindings?.height) node.height = size.height;
  const after = resolvedGeometry(node);
  return before.width !== after.width || before.height !== after.height;
}

function resizeTextLayers(roots, variableId = null) {
  const layoutParents = new Set();
  walkNodes(roots, ({ node, parent }) => {
    if (node.type !== 'text') return;
    const bindings = node.variableBindings || {};
    const sizeProperties = ['text', 'fontSize', 'lineHeight', 'letterSpacing', 'width', 'height'];
    if (variableId && !sizeProperties.some(property => bindings[property] === variableId)) return;
    if (!variableId && !sizeProperties.some(property => bindings[property])) return;
    if (resizeTextNode(node) && parent?.autoLayout) layoutParents.add(parent);
  });
  for (const parent of layoutParents) applyAutoLayout(parent);
}

const textRunStyleKeys = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'textDecoration'];
const textBlockTags = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE']);
function textRunDataAttribute(property) { return `data-run-${property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`; }
function normalizeTextRunStyle(source = {}) {
  const style = {};
  for (const property of textRunStyleKeys) {
    let value = source[property];
    if (value == null) continue;
    if (property === 'fontFamily') {
      value = String(value).trim();
      if (!value || value.length > 160 || /[\x00-\x1f]/.test(value)) continue;
    } else if (property === 'fontWeight') {
      value = Number(value);
      if (!Number.isInteger(value) || value < 1 || value > 1000) continue;
    } else if (['fontSize', 'lineHeight'].includes(property)) {
      value = Number(value);
      if (!Number.isFinite(value) || value <= 0 || value > (property === 'lineHeight' ? 100 : 100_000)) continue;
    } else if (property === 'letterSpacing') {
      value = Number(value);
      if (!Number.isFinite(value) || Math.abs(value) > 10_000) continue;
    } else if (property === 'fontStyle') {
      value = String(value);
      if (!['normal', 'italic'].includes(value)) continue;
    } else if (property === 'textDecoration') {
      value = String(value);
      if (!['none', 'underline', 'line-through'].includes(value)) continue;
    } else if (property === 'color') {
      value = String(value);
      if (!/^#[0-9a-f]{6}$/i.test(value)) continue;
      value = value.toLowerCase();
    }
    style[property] = value;
  }
  return style;
}
function appendTextRun(runs, text, style) {
  if (!text) return;
  const normalized = normalizeTextRunStyle(style);
  const previous = runs.at(-1);
  const keys = textRunStyleKeys.filter(property => normalized[property] != null);
  if (previous && keys.every(property => previous[property] === normalized[property])
    && Object.keys(previous).every(property => property === 'text' || normalized[property] != null && previous[property] === normalized[property])) previous.text += text;
  else runs.push({ text, ...normalized });
}
function normalizeTextRuns(runs) {
  const normalized = [];
  for (const run of runs || []) appendTextRun(normalized, String(run.text || '').replace(/\r\n?/g, '\n'), run);
  return normalized;
}
function parseTextRunColor(value) {
  const text = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  const match = text.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  if (parts.some(part => part < 0 || part > 255)) return null;
  return `#${parts.map(part => part.toString(16).padStart(2, '0')).join('')}`;
}
function textRunStyleForElement(element, inherited) {
  const style = { ...inherited };
  const tag = element.tagName;
  if (tag === 'B' || tag === 'STRONG') style.fontWeight = 700;
  if (tag === 'I' || tag === 'EM') style.fontStyle = 'italic';
  for (const property of textRunStyleKeys) {
    const encoded = element.getAttribute(textRunDataAttribute(property));
    let value = encoded != null ? encoded : element.style?.[property];
    if (property === 'fontWeight' && value) value = value === 'bold' ? 700 : value === 'normal' ? 400 : Number(value);
    if (property === 'fontStyle' && value) value = value === 'italic' ? 'italic' : 'normal';
    if (property === 'fontSize' || property === 'lineHeight' || property === 'letterSpacing') {
      if (value != null && value !== '') value = Number.parseFloat(value);
    }
    if (property === 'color' && value) value = parseTextRunColor(value);
    if (property === 'textDecoration' && value) {
      const decoration = String(value).split(/\s+/).find(item => ['underline', 'line-through', 'none'].includes(item));
      value = decoration || null;
    }
    if (value != null && value !== '') {
      const normalized = normalizeTextRunStyle({ [property]: value });
      if (normalized[property] != null) style[property] = normalized[property];
    }
  }
  return style;
}
function readTextEditorContent(root) {
  const runs = [];
  let text = '';
  const append = (value, style) => {
    const next = String(value).replace(/\r\n?/g, '\n');
    if (!next) return;
    appendTextRun(runs, next, style);
    text += next;
  };
  const visit = (node, inherited = {}, rootNode = false) => {
    if (node.nodeType === Node.TEXT_NODE) { append(node.nodeValue || '', inherited); return; }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') { append('\n', inherited); return; }
    if (node.nodeType === Node.ELEMENT_NODE && !rootNode && textBlockTags.has(node.tagName) && text && !text.endsWith('\n')) append('\n', inherited);
    const style = node.nodeType === Node.ELEMENT_NODE ? textRunStyleForElement(node, inherited) : inherited;
    for (const child of node.childNodes) visit(child, style, false);
  };
  for (const child of root.childNodes) visit(child, {}, false);
  return { text, runs: normalizeTextRuns(runs) };
}
function renderTextEditorRuns(editor, runs) {
  editor.replaceChildren();
  const text = runs.map(run => run.text).join('');
  if (!runs.some(run => textRunStyleKeys.some(property => run[property] != null))) {
    editor.textContent = text;
    return;
  }
  for (const run of runs) {
    if (!run.text) continue;
    const span = document.createElement('span');
    span.dataset.textRun = 'true';
    for (const property of textRunStyleKeys) {
      const value = run[property];
      if (value == null) continue;
      span.setAttribute(textRunDataAttribute(property), String(value));
      span.style[property] = property === 'fontSize' || property === 'letterSpacing' ? `${value * state.zoom}px` : String(value);
    }
    span.textContent = run.text;
    editor.append(span);
  }
}
function trimTextRuns(runs, length) {
  let remaining = length;
  const result = [];
  for (const run of runs) {
    if (remaining <= 0) break;
    const text = run.text.slice(0, remaining);
    if (text) result.push({ ...run, text });
    remaining -= text.length;
  }
  return normalizeTextRuns(result);
}
function editorPointOffset(editor, node, offset) {
  if (node !== editor && !editor.contains(node)) return null;
  try {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(node, offset);
    return readTextEditorContent(range.cloneContents()).text.length;
  } catch { return null; }
}
function currentTextSelection() {
  const editor = $('#text-editor-overlay');
  const selection = document.getSelection();
  if (!selection?.rangeCount || !state.textNodeId) return null;
  const range = selection.getRangeAt(0);
  const start = editorPointOffset(editor, range.startContainer, range.startOffset);
  const end = editorPointOffset(editor, range.endContainer, range.endOffset);
  return start == null || end == null ? null : { start: Math.min(start, end), end: Math.max(start, end) };
}
function rememberTextSelection() {
  const range = currentTextSelection();
  if (range) state.textSelection = range;
  return range || state.textSelection;
}
function setTextEditorSelection(editor, start, end = start) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  if (!textNodes.length) { const empty = document.createTextNode(''); editor.append(empty); textNodes.push(empty); }
  const pointAt = position => {
    let remaining = Math.max(0, position);
    for (const node of textNodes) {
      if (remaining <= node.length) return { node, offset: remaining };
      remaining -= node.length;
    }
    const last = textNodes.at(-1);
    return { node: last, offset: last.length };
  };
  const from = pointAt(start); const to = pointAt(end);
  const range = document.createRange();
  range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
}
function textBaseStyle(node) {
  return {
    fontFamily: node.fontFamily || 'Arial, sans-serif',
    fontSize: getNodePropertyValue(state.document, node, 'fontSize') || 24,
    fontWeight: Number(node.fontWeight || 400),
    fontStyle: node.fontStyle || 'normal',
    lineHeight: getNodePropertyValue(state.document, node, 'lineHeight') || 1.25,
    letterSpacing: getNodePropertyValue(state.document, node, 'letterSpacing') || 0,
    color: getNodeColor(state.document, node, 'text') || '#1e1e1e',
    textDecoration: ['underline', 'line-through'].includes(node.textDecoration) ? node.textDecoration : 'none'
  };
}
function effectiveTextRunValue(run, property, node) {
  return run[property] ?? textBaseStyle(node)[property];
}
function selectedTextRunValues(runs, start, end, property, node) {
  const values = [];
  let cursor = 0;
  for (const run of runs) {
    const next = cursor + run.text.length;
    if (next > start && cursor < end) values.push(effectiveTextRunValue(run, property, node));
    cursor = next;
  }
  return values;
}
function rangeUsesTextStyle(runs, start, end, property, node, predicate) {
  const values = selectedTextRunValues(runs, start, end, property, node);
  return values.length > 0 && values.every(predicate);
}
function positionTextFormatToolbar() {
  const editor = $('#text-editor-overlay'); const toolbar = $('#text-format-toolbar'); const canvasScroll = $('#canvas-scroll');
  if (!state.textNodeId || editor.hidden || toolbar.hidden) return;
  const editorLeft = Number.parseFloat(editor.style.left) || 8;
  const editorTop = Number.parseFloat(editor.style.top) || 8;
  const toolbarWidth = toolbar.offsetWidth; const toolbarHeight = toolbar.offsetHeight;
  const left = Math.max(8, Math.min(editorLeft, canvasScroll.clientWidth - toolbarWidth - 8));
  const above = editorTop - toolbarHeight - 8;
  const below = editorTop + (Number.parseFloat(editor.style.minHeight) || 32) + 8;
  const top = above >= 8 ? above : Math.min(below, canvasScroll.clientHeight - toolbarHeight - 8);
  toolbar.style.left = `${left}px`; toolbar.style.top = `${Math.max(8, top)}px`;
}
function updateTextFormatToolbar() {
  const toolbar = $('#text-format-toolbar'); const editor = $('#text-editor-overlay');
  if (!state.textNodeId || editor.hidden) { toolbar.hidden = true; return; }
  toolbar.hidden = false;
  const node = findNode(state.document, state.textNodeId)?.node;
  const current = readTextEditorContent(editor);
  const range = rememberTextSelection();
  const selected = Boolean(range && range.end > range.start && range.end <= current.text.length);
  const bold = toolbar.querySelector('[data-text-format="bold"]'); const italic = toolbar.querySelector('[data-text-format="italic"]');
  bold.disabled = !selected; italic.disabled = !selected;
  bold.setAttribute('aria-pressed', String(selected && rangeUsesTextStyle(current.runs, range.start, range.end, 'fontWeight', node, value => Number(value) >= 600)));
  italic.setAttribute('aria-pressed', String(selected && rangeUsesTextStyle(current.runs, range.start, range.end, 'fontStyle', node, value => value === 'italic')));
  const size = $('#text-format-size'); const color = $('#text-format-color');
  const family = $('#text-format-family'); const weight = $('#text-format-weight');
  const spacing = $('#text-format-spacing'); const decoration = $('#text-format-decoration');
  for (const control of [size, color, family, weight, spacing, decoration]) control.disabled = !selected;
  let firstRun = {};
  if (selected) {
    let cursor = 0;
    firstRun = current.runs.find(run => {
      const inRange = cursor + run.text.length > range.start && cursor < range.end;
      cursor += run.text.length;
      return inRange;
    }) || {};
  }
  const base = textBaseStyle(node);
  family.value = String(effectiveTextRunValue(firstRun, 'fontFamily', node) || base.fontFamily);
  weight.value = String(effectiveTextRunValue(firstRun, 'fontWeight', node) || base.fontWeight);
  size.value = String(Math.max(1, Math.min(512, Math.round(effectiveTextRunValue(firstRun, 'fontSize', node) || base.fontSize))));
  spacing.value = String(effectiveTextRunValue(firstRun, 'letterSpacing', node) ?? base.letterSpacing);
  decoration.value = effectiveTextRunValue(firstRun, 'textDecoration', node) || base.textDecoration;
  color.value = parseTextRunColor(effectiveTextRunValue(firstRun, 'color', node)) || '#1e1e1e';
  positionTextFormatToolbar();
}
function transformTextRunsInRange(runs, start, end, property, value) {
  const result = [];
  let cursor = 0;
  for (const run of runs) {
    const runStart = cursor; const runEnd = cursor + run.text.length;
    if (runStart < start) {
      const before = run.text.slice(0, Math.max(0, start - runStart));
      if (before) result.push({ ...run, text: before });
    }
    const overlapStart = Math.max(runStart, start); const overlapEnd = Math.min(runEnd, end);
    if (overlapEnd > overlapStart) {
      const middle = run.text.slice(overlapStart - runStart, overlapEnd - runStart);
      result.push({ ...run, text: middle, [property]: value });
    }
    if (runEnd > end) {
      const after = run.text.slice(Math.max(0, end - runStart));
      if (after) result.push({ ...run, text: after });
    }
    cursor = runEnd;
  }
  return normalizeTextRuns(result);
}
function applyTextFormat(property, value) {
  const editor = $('#text-editor-overlay'); const node = findNode(state.document, state.textNodeId)?.node;
  const current = readTextEditorContent(editor); const range = rememberTextSelection();
  if (!node || !range || range.end <= range.start || range.end > current.text.length) return;
  const nextRuns = transformTextRunsInRange(current.runs, range.start, range.end, property, value);
  if (nextRuns.length > 10_000) { showToast('This text has reached the 10,000 style-run limit.'); return; }
  renderTextEditorRuns(editor, nextRuns);
  state.textSelection = range;
  setTextEditorSelection(editor, range.start, range.end);
  editor.focus({ preventScroll: true });
  updateTextFormatToolbar();
}
function toggleTextFormat(property) {
  const editor = $('#text-editor-overlay'); const node = findNode(state.document, state.textNodeId)?.node;
  const current = readTextEditorContent(editor); const range = rememberTextSelection();
  if (!node || !range || range.end <= range.start) return;
  if (property === 'fontWeight') {
    const bold = rangeUsesTextStyle(current.runs, range.start, range.end, property, node, value => Number(value) >= 600);
    applyTextFormat(property, bold ? 400 : 700);
  } else {
    const italic = rangeUsesTextStyle(current.runs, range.start, range.end, property, node, value => value === 'italic');
    applyTextFormat(property, italic ? 'normal' : 'italic');
  }
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
  state.textSelection = null;
  const editor = $('#text-editor-overlay');
  const absolute = absolutePosition(nodeId);
  const screen = worldToScreen(absolute, canvas, state);
  const canvasRect = canvasScroll.getBoundingClientRect();
  editor.style.left = `${screen.x - canvasRect.left}px`;
  editor.style.top = `${screen.y - canvasRect.top}px`;
  const textGeometry = resolvedGeometry(entry.node);
  editor.style.width = entry.node.textFit === 'auto-width' ? 'max-content' : `${Math.max(64, textGeometry.width * state.zoom)}px`;
  editor.style.minHeight = `${Math.max(28, textGeometry.height * state.zoom)}px`;
  editor.style.whiteSpace = entry.node.textFit === 'auto-width' ? 'pre' : 'pre-wrap';
  editor.style.textTransform = ['uppercase', 'lowercase', 'capitalize'].includes(entry.node.textCase) ? entry.node.textCase : 'none';
  editor.style.textDecoration = ['underline', 'line-through'].includes(entry.node.textDecoration) ? entry.node.textDecoration : 'none';
  editor.style.fontFamily = entry.node.fontFamily;
  editor.style.fontWeight = String(entry.node.fontWeight || 400);
  editor.style.fontSize = `${getNodePropertyValue(state.document, entry.node, 'fontSize') * state.zoom}px`;
  editor.style.lineHeight = String(getNodePropertyValue(state.document, entry.node, 'lineHeight'));
  editor.style.letterSpacing = `${getNodePropertyValue(state.document, entry.node, 'letterSpacing') * state.zoom}px`;
  editor.style.color = getNodeColor(state.document, entry.node, 'text');
  const text = getNodePropertyValue(state.document, entry.node, 'text');
  const existingRuns = Array.isArray(entry.node.textRuns) && entry.node.textRuns.map(run => run.text).join('') === text
    ? entry.node.textRuns : [{ text }];
  renderTextEditorRuns(editor, existingRuns);
  $('#text-format-toolbar').hidden = false;
  $('#canvas-scroll').classList.add('is-text-editing');
  editor.hidden = false; editor.focus();
  if (!text) document.execCommand?.('selectAll', false, null);
  updateTextFormatToolbar();
}

function absolutePosition(nodeId) {
  const entry = findNode(state.document, nodeId);
  if (!entry) return { x: 0, y: 0 };
  const own = resolvedGeometry(entry.node);
  let x = own.x; let y = own.y;
  for (const parent of entry.parents) { const geometry = resolvedGeometry(parent); x += geometry.x; y += geometry.y; }
  return { x, y };
}

function commitTextEdit() {
  const editor = $('#text-editor-overlay');
  if (!state.textNodeId) return;
  const node = findNode(state.document, state.textNodeId)?.node;
  if (node) {
    const oldWidth = node.width; const oldHeight = node.height;
    const oldText = node.text;
    const oldRuns = node.textRuns ? JSON.stringify(node.textRuns) : null;
    const content = readTextEditorContent(editor);
    let text = content.text;
    if (text.endsWith('\n')) text = text.slice(0, -1);
    const normalizedRuns = trimTextRuns(content.runs, text.length);
    const richRuns = normalizedRuns.some(run => textRunStyleKeys.some(property => run[property] != null)) ? normalizedRuns : null;
    const nextTextFit = node.textFit || 'auto-height';
    const nextRuns = richRuns ? JSON.stringify(richRuns) : null;
    const textChanged = oldText !== text || (node.variableBindings?.text && getNodePropertyValue(state.document, node, 'text') !== text);
    const runsChanged = oldRuns !== nextRuns;
    const changed = textChanged || runsChanged || node.textFit !== nextTextFit;
    if (changed) checkpoint('Edit text');
    setNodePropertyValue(node, 'text', text);
    node.text = text;
    if (richRuns) node.textRuns = normalizedRuns;
    else delete node.textRuns;
    node.textFit ||= 'auto-height';
    resizeTextNode(node);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot && textChanged) recordComponentOverride(instanceRoot, node, node.variableBindings?.text ? 'variableBindings' : 'text');
    if (instanceRoot && runsChanged) recordComponentOverride(instanceRoot, node, 'textRuns');
    if (instanceRoot && node.width !== oldWidth) recordComponentOverride(instanceRoot, node, 'width');
    if (instanceRoot && node.height !== oldHeight) recordComponentOverride(instanceRoot, node, 'height');
    const parent = findNode(state.document, node.id)?.parent;
    if (parent?.autoLayout) applyAutoLayout(parent);
  }
  editor.hidden = true; $('#text-format-toolbar').hidden = true; $('#canvas-scroll').classList.remove('is-text-editing'); state.textNodeId = null; state.textSelection = null;
  renderInspector(); renderLayers(); queueSave(); renderer.invalidate();
}

function initRichTextEditorEvents() {
  const editor = $('#text-editor-overlay'); const toolbar = $('#text-format-toolbar');
  const refresh = () => { rememberTextSelection(); updateTextFormatToolbar(); };
  editor.addEventListener('input', refresh);
  editor.addEventListener('keyup', refresh);
  editor.addEventListener('mouseup', refresh);
  editor.addEventListener('pointerup', refresh);
  editor.addEventListener('blur', event => {
    if (event.relatedTarget?.closest?.('#text-format-toolbar')) return;
    commitTextEdit();
  });
  editor.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); commitTextEdit(); }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); commitTextEdit(); }
  });
  toolbar.addEventListener('pointerdown', event => {
    rememberTextSelection();
    if (event.target.closest('button')) event.preventDefault();
  });
  toolbar.addEventListener('click', event => {
    const button = event.target.closest('[data-text-format]');
    if (button?.dataset.textFormat === 'bold') toggleTextFormat('fontWeight');
    else if (button?.dataset.textFormat === 'italic') toggleTextFormat('fontStyle');
    else if (event.target.closest('[data-text-format-done]')) commitTextEdit();
  });
  toolbar.addEventListener('change', event => {
    if (event.target.id === 'text-format-family') {
      const value = event.target.value.trim();
      if (value && value.length <= 160) applyTextFormat('fontFamily', value);
      else updateTextFormatToolbar();
    } else if (event.target.id === 'text-format-weight') {
      const value = Number(event.target.value);
      if (Number.isInteger(value) && value >= 1 && value <= 1000) applyTextFormat('fontWeight', value);
    } else if (event.target.id === 'text-format-spacing') {
      const value = Number(event.target.value);
      if (Number.isFinite(value) && Math.abs(value) <= 10_000) applyTextFormat('letterSpacing', value);
      else updateTextFormatToolbar();
    } else if (event.target.id === 'text-format-decoration') {
      if (['none', 'underline', 'line-through'].includes(event.target.value)) applyTextFormat('textDecoration', event.target.value);
    } else if (event.target.id === 'text-format-size') {
      const value = Number(event.target.value);
      if (Number.isFinite(value) && value > 0 && value <= 512) applyTextFormat('fontSize', value);
      else updateTextFormatToolbar();
    } else if (event.target.id === 'text-format-color') {
      const value = parseTextRunColor(event.target.value);
      if (value) applyTextFormat('color', value);
    }
  });
  document.addEventListener('selectionchange', () => { if (state.textNodeId) refresh(); });
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
  const corners = ids.flatMap(id => {
    const entry = findNode(state.document, id);
    if (!entry) return [];
    const node = { ...entry.node, ...resolvedGeometry(entry.node) };
    const ancestors = entry.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
    return selectionOverlayGeometry(node, ancestors, { zoom: 1, rotateOffset: 0 }).corners;
  });
  if (!corners.length) return;
  const x = Math.min(...corners.map(point => point.x)); const y = Math.min(...corners.map(point => point.y));
  const right = Math.max(...corners.map(point => point.x)); const bottom = Math.max(...corners.map(point => point.y));
  const zoom = Math.min(2, (canvas.clientWidth - 100) / Math.max(1, right - x), (canvas.clientHeight - 100) / Math.max(1, bottom - y));
  state.zoom = Math.max(.08, zoom); state.panX = (canvas.clientWidth - (right - x) * state.zoom) / 2 - x * state.zoom; state.panY = (canvas.clientHeight - (bottom - y) * state.zoom) / 2 - y * state.zoom;
  updateZoomUI(); renderer.invalidate();
}

function updateGradientInput(input) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  const gradient = node?.fillGradient;
  if (!gradient || node.locked) return;
  if (!state.controlEdit) { checkpoint('Edit gradient fill'); state.controlEdit = true; }
  if (input.dataset.gradientField === 'angle' && Number.isFinite(Number(input.value))) gradient.angle = Math.max(0, Math.min(359, Number(input.value)));
  else {
    const stop = gradient.stops.find(item => item.id === input.dataset.gradientStopId);
    if (!stop) return;
    if (input.dataset.gradientField === 'color') stop.color = input.value;
    else if (input.dataset.gradientField === 'position' && Number.isFinite(Number(input.value))) {
      stop.position = Math.max(0, Math.min(1, Number(input.value) / 100));
      gradient.stops.sort((a, b) => a.position - b.position);
    } else return;
  }
  recordNodeComponentOverrides(node, ['fillGradient']);
  renderer.invalidate();
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

function updateImageFillInput(input) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  if (!node?.imageFill || node.locked) return;
  if (!state.controlEdit) { checkpoint('Edit image fill'); state.controlEdit = true; }
  const field = input.dataset.imageFillField;
  if (field === 'assetId') {
    if (!imageFillSources().some(source => source.assetId === input.value)) return;
    node.imageFill.assetId = input.value;
    schedulePreview(node, true);
  } else if (field === 'fit') node.imageFill.fit = input.value;
  else if (field.startsWith('adjustments.')) {
    const key = field.slice('adjustments.'.length);
    if (!Object.hasOwn(node.imageFill.adjustments, key)) return;
    node.imageFill.adjustments[key] = Number(input.value);
    if (input.nextElementSibling) input.nextElementSibling.value = input.value;
    schedulePreview(node);
  } else return;
  recordNodeComponentOverrides(node, ['imageFill']);
  renderer.invalidate();
}

function imageTransformTarget(node, target) {
  if (target === 'fill') return node?.imageFill || null;
  return node?.type === 'image' ? node : null;
}

function updateImageTransformInput(input) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  const target = imageTransformTarget(node, input.dataset.imageTransformTarget);
  if (!node || !target || node.locked || input.value.trim() === '') return;
  const edge = input.dataset.imageTransformField;
  if (!['left', 'top', 'right', 'bottom'].includes(edge)) return;
  const percent = Number(input.value);
  if (!Number.isFinite(percent)) return;
  const value = Math.max(0, Math.min(100, percent)) / 100;
  const current = createImageTransforms(target.transforms || {});
  const crop = { ...(current.crop || { left: 0, top: 0, right: 1, bottom: 1 }) };
  const start = edge === 'left' ? 'left' : edge === 'top' ? 'top' : null;
  const end = edge === 'right' ? 'right' : edge === 'bottom' ? 'bottom' : null;
  const counterpart = start ? (edge === 'left' ? 'right' : 'bottom') : (edge === 'right' ? 'left' : 'top');
  crop[edge] = value;
  if (start && crop[edge] >= crop[counterpart]) {
    if (value >= 1) { crop[edge] = 0.99; crop[counterpart] = 1; }
    else crop[counterpart] = Math.min(1, value + 0.01);
  } else if (end && crop[edge] <= crop[counterpart]) {
    if (value <= 0) { crop[edge] = 0.01; crop[counterpart] = 0; }
    else crop[counterpart] = Math.max(0, value - 0.01);
  }
  const transforms = createImageTransforms({ ...current, crop });
  if (!state.controlEdit) { checkpoint('Crop image'); state.controlEdit = true; }
  target.transforms = transforms;
  if (input.nextElementSibling?.tagName === 'OUTPUT') input.nextElementSibling.value = `${Math.round(crop[edge] * 100)}%`;
  recordNodeComponentOverrides(node, input.dataset.imageTransformTarget === 'fill' ? ['imageFill'] : ['transforms']);
  schedulePreview(node);
  renderer.invalidate();
}

function applyImageTransformAction(node, targetName, action, direction) {
  const target = imageTransformTarget(node, targetName);
  if (!target || node.locked) return;
  const current = createImageTransforms(target.transforms || {});
  let transforms;
  if (action === 'rotate-image') transforms = createImageTransforms({ ...current, rotation: current.rotation + (direction === 'left' ? -90 : 90) });
  else if (action === 'reset-image-transforms') transforms = createImageTransforms();
  else return;
  if (JSON.stringify(transforms) === JSON.stringify(current)) return;
  checkpoint(action === 'rotate-image' ? 'Rotate image' : 'Reset image crop and rotation');
  target.transforms = transforms;
  recordNodeComponentOverrides(node, targetName === 'fill' ? ['imageFill'] : ['transforms']);
  schedulePreview(node, true);
  renderInspector(); queueSave(); renderer.invalidate();
}

function updateInspectorInput(event) {
  const input = event.target.closest('[data-prop]');
  if (!input || !selectedNodes().length) return;
  const prop = input.dataset.prop;
  if (prop === 'fontFamily' && !input.value.trim()) {
    if (event.type === 'change') input.value = selectedNodes()[0]?.fontFamily || 'Inter, Arial, sans-serif';
    return;
  }
  if (!state.controlEdit) { checkpoint('Edit properties'); state.controlEdit = true; }
  const value = input.dataset.optionalNumber !== undefined && !input.value.trim() ? null : input.type === 'checkbox' ? input.checked : input.type === 'number' || input.type === 'range' || prop === 'fontWeight' ? Number(input.value) : input.value;
  const propertyValue = prop === 'opacity' ? value / 100 : value;
  if (input.type === 'range' && input.nextElementSibling) input.nextElementSibling.value = `${Math.round(value)}${prop === 'opacity' ? '%' : ''}`;
  const adjustments = prop.startsWith('adjustments.');
  const layoutSetting = prop.startsWith('autoLayout.');
  const constraintSetting = prop.startsWith('constraints.');
  const gridCellSetting = prop.startsWith('gridCell.');
  const key = adjustments ? prop.slice('adjustments.'.length) : layoutSetting ? prop.slice('autoLayout.'.length) : constraintSetting ? prop.slice('constraints.'.length) : prop;
  for (const node of selectedNodes()) {
    const instanceRoot = componentInstanceRoot(node.id);
    const oldRawWidth = node.width; const oldRawHeight = node.height;
    const oldWidth = resolvedGeometry(node).width; const oldHeight = resolvedGeometry(node).height;
    let adjustedSizeLimit = null;
    const variableProperty = prop === 'fill' ? 'fillVariableId' : prop === 'color' ? 'textVariableId' : prop === 'stroke' ? 'strokeVariableId' : null;
    const boundVariableId = node.variableBindings?.[prop];
    if (prop === 'fillType') {
      if (value === 'solid') {
        if (instanceRoot) { node.fillGradient = null; node.imageFill = null; }
        else { delete node.fillGradient; delete node.imageFill; }
      } else if (value === 'image') {
        const source = imageFillSources()[0];
        if (!source) { showToast('Place an image on the canvas before using it as a fill.'); input.value = node.fillGradient?.type || 'solid'; return; }
        node.imageFill = createImageFill(source.assetId);
        if (instanceRoot) node.fillGradient = null; else delete node.fillGradient;
        if (instanceRoot) { node.fillVariableId = null; node.fillStyleId = null; }
        else { delete node.fillVariableId; delete node.fillStyleId; }
        schedulePreview(node, true);
      } else {
        const baseColor = getNodeColor(state.document, node, 'fill');
        if (instanceRoot) node.imageFill = null; else delete node.imageFill;
        if (!node.fillGradient) node.fillGradient = createGradientFill(value, /^#[0-9a-f]{6}$/i.test(baseColor || '') ? baseColor : '#d9d9d9');
        else node.fillGradient.type = value;
        if (instanceRoot) { node.fillVariableId = null; node.fillStyleId = null; }
        else { delete node.fillVariableId; delete node.fillStyleId; }
      }
    }
    else if (boundVariableId) setNodePropertyValue(node, prop, propertyValue);
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
    if (node.type === 'text' && ['fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'lineHeight', 'letterSpacing', 'textFit', 'textCase', 'text', 'width'].includes(prop)) {
      const resized = resizeTextNode(node);
      const parent = findNode(state.document, node.id)?.parent;
      if (boundVariableId && ['text', 'fontSize', 'lineHeight', 'letterSpacing'].includes(prop)) resizeTextLayers(state.document.pages.flatMap(page => page.children), boundVariableId);
      else if (resized && parent?.autoLayout) applyAutoLayout(parent);
    }
    const geometry = resolvedGeometry(node);
    if ((prop === 'width' || prop === 'height') && node.type === 'frame' && !node.autoLayout) applyFrameConstraints(node, oldWidth, oldHeight, geometry.width, geometry.height);
    if (node.type === 'image' && adjustments) schedulePreview(node);
    if (prop === 'width' || prop === 'height' || prop === 'layoutSizingMain' || prop === 'layoutSizingCross' || prop === 'layoutSizingX' || prop === 'layoutSizingY') {
      if (node.type === 'frame' && node.autoLayout) applyAutoLayout(node);
      const parent = findNode(state.document, node.id)?.parent;
      if (parent?.autoLayout) applyAutoLayout(parent);
    }
    if (layoutSetting && node.type === 'frame' && node.autoLayout) {
      applyAutoLayout(node);
      const parent = findNode(state.document, node.id)?.parent;
      if (parent?.autoLayout) applyAutoLayout(parent);
    }
    if (instanceRoot) {
      recordComponentOverride(instanceRoot, node, boundVariableId ? 'variableBindings' : layoutSetting ? 'autoLayout' : gridCellSetting ? 'gridCell' : prop === 'fillType' ? 'fillGradient' : prop);
      if (prop === 'fillType' && value !== 'solid') {
        recordComponentOverride(instanceRoot, node, 'fillVariableId');
        recordComponentOverride(instanceRoot, node, 'fillStyleId');
      }
      if (prop === 'fillType') recordComponentOverride(instanceRoot, node, 'imageFill');
      if (node.width !== oldRawWidth) recordComponentOverride(instanceRoot, node, 'width');
      if (node.height !== oldRawHeight) recordComponentOverride(instanceRoot, node, 'height');
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
  const replacementKey = `preview:${node.id}`;
  state.renderVersion.set(node.id, ++nextImageRenderVersion);
  imageEngine.cancelQueuedByKey(replacementKey);
  state.imageStatus.set(node.id, 'Updating preview…');
  const assetId = node.imageFill?.assetId || node.assetId;
  const adjustments = node.imageFill?.adjustments || node.adjustments;
  const transforms = node.imageFill?.transforms || node.transforms;
  const run = () => renderImagePreview(node.id, assetId, adjustments, transforms).catch(error => { state.imageStatus.set(node.id, 'Preview failed'); showToast(error.message); renderInspector(); });
  let timer;
  timer = setTimeout(() => {
    if (previewTimers.get(node.id) !== timer) return;
    previewTimers.delete(node.id);
    run();
  }, immediate ? 0 : 110);
  previewTimers.set(node.id, timer);
  if (state.selectedIds.includes(node.id)) {
    for (const status of [$('#image-engine-status'), $('#image-fill-engine-status')].filter(Boolean)) { status.textContent = 'Updating preview…'; status.classList.remove('image-engine-status'); }
  }
}
async function renderImagePreview(nodeId, assetId, adjustments, transforms = {}) {
  const generation = state.documentGeneration;
  const asset = state.assets.get(assetId);
  if (!asset?.sourceBytes) throw new Error('The original image could not be found on this device.');
  const version = ++nextImageRenderVersion;
  state.renderVersion.set(nodeId, version);
  state.imageStatus.set(nodeId, 'Processing locally…');
  try {
    const result = await imageEngine.render(assetId, asset.sourceBytes, adjustments, transforms, { replaceKey: `preview:${nodeId}` });
    if (generation !== state.documentGeneration || state.renderVersion.get(nodeId) !== version) return false;
    const bitmap = await createImageBitmap(new Blob([result.bytes], { type: 'image/png' }));
    if (generation !== state.documentGeneration || state.renderVersion.get(nodeId) !== version) { bitmap.close?.(); return false; }
    state.previews.get(nodeId)?.close?.();
    const previousUrl = state.previewUrls.get(nodeId); if (previousUrl) URL.revokeObjectURL(previousUrl);
    state.previewUrls.set(nodeId, URL.createObjectURL(new Blob([result.bytes], { type: 'image/png' })));
    state.previews.set(nodeId, bitmap);
    state.previewAssetIds.set(nodeId, assetId);
    state.previewVersions.set(nodeId, (state.previewVersions.get(nodeId) || 0) + 1);
    state.imageStatus.set(nodeId, 'Updated · Pillow-RS WASM');
    renderer.invalidate(); renderAssetsTab();
    if (state.selectedIds.includes(nodeId)) for (const status of [$('#image-engine-status'), $('#image-fill-engine-status')].filter(Boolean)) { status.textContent = 'Updated · Pillow-RS WASM'; status.classList.add('image-engine-status'); }
    return true;
  } catch (error) {
    if (generation !== state.documentGeneration || state.renderVersion.get(nodeId) !== version) return false;
    throw error;
  }
}

function reconcileImagePreviewRuntime() {
  const liveNodeIds = collectLiveImagePreviewNodeIds(state.document);
  for (const nodeId of state.renderVersion.keys()) {
    if (!liveNodeIds.has(nodeId)) imageEngine.cancelQueuedByKey(`preview:${nodeId}`);
  }
  return pruneImagePreviewRuntime({
    liveNodeIds,
    timers: previewTimers,
    previews: state.previews,
    previewUrls: state.previewUrls,
    previewAssetIds: state.previewAssetIds,
    previewVersions: state.previewVersions,
    imageStatus: state.imageStatus,
    renderVersion: state.renderVersion,
  });
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
  if (state.documentTransitioning) {
    showToast('Wait for the current design switch to finish before importing images.');
    return;
  }
  const generation = state.documentGeneration;
  const inputs = [...files].filter(file => file.type.startsWith('image/'));
  if (!inputs.length) { showToast('Choose an image file to place it on the canvas.'); return; }
  state.pendingImageImports += 1;
  try {
  checkpoint(`Place ${inputs.length} image${inputs.length === 1 ? '' : 's'}`);
  const defaultWorld = point || { x: (canvas.clientWidth / 2 - state.panX) / state.zoom, y: (canvas.clientHeight / 2 - state.panY) / state.zoom };
  let imported = 0;
  for (const [index, file] of inputs.entries()) {
    try {
      const assetId = createId('asset');
      const sourceBytes = new Uint8Array(await file.arrayBuffer());
      const bitmap = await createImageBitmap(file);
      if (generation !== state.documentGeneration) { bitmap.close?.(); continue; }
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale)); const height = Math.max(1, Math.round(bitmap.height * scale));
      const asset = { id: assetId, name: file.name, type: file.type, sourceBytes, bitmap, bitmapUrl: URL.createObjectURL(file) };
      state.assets.set(assetId, asset);
      await saveImageAsset(assetId, file);
      if (generation !== state.documentGeneration) continue;
      const node = createNode('image', { id: createId('image'), name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, assetId, width, height, sourceWidth: bitmap.width, sourceHeight: bitmap.height, x: defaultWorld.x - width / 2 + index * 24, y: defaultWorld.y - height / 2 + index * 24, fit: 'cover' });
      const center = { x: node.x + width / 2, y: node.y + height / 2 };
      const parent = deepestContainerAt(center);
      localizeToParent(node, center.x, center.y, parent, { anchor: 'center' });
      state.imageStatus.set(node.id, 'Processing locally…');
      renderImagePreview(node.id, assetId, node.adjustments, node.transforms).catch(error => { state.imageStatus.set(node.id, 'Preview failed'); showToast(error.message); });
      state.selectedIds = [node.id]; imported += 1;
    } catch (error) { showToast(`${file.name}: ${error.message || 'Could not load image.'}`); }
  }
  if (imported) { renderUI(); queueSave(); showToast(`${imported} image${imported === 1 ? '' : 's'} placed. Source images stay on this device.`); }
  } finally {
    state.pendingImageImports -= 1;
    $('#image-input').value = '';
  }
}

async function restoreImageAssets(generation = state.documentGeneration) {
  const references = imageAssetReferencesAcrossPages();
  for (const reference of references) {
    if (generation !== state.documentGeneration) return;
    const { node, assetId, name, adjustments, transforms } = reference;
    try {
      const existing = state.assets.get(assetId);
      if (existing?.sourceBytes) { renderImagePreview(node.id, assetId, adjustments, transforms).catch(error => showToast(error.message)); continue; }
      const saved = await loadImageAsset(assetId);
      if (generation !== state.documentGeneration) return;
      if (!saved) { state.imageStatus.set(node.id, 'Original image missing'); continue; }
      const sourceBytes = new Uint8Array(saved.bytes);
      const bitmap = await createImageBitmap(new Blob([sourceBytes], { type: saved.type || 'image/png' }));
      if (generation !== state.documentGeneration) { bitmap.close?.(); return; }
      state.assets.set(assetId, { id: assetId, name: saved.name || name, type: saved.type, sourceBytes, bitmap, bitmapUrl: URL.createObjectURL(new Blob([sourceBytes], { type: saved.type || 'image/png' })) });
      state.imageStatus.set(node.id, 'Restoring local preview…');
      renderImagePreview(node.id, assetId, adjustments, transforms).catch(error => { state.imageStatus.set(node.id, 'Preview failed'); showToast(error.message); });
    } catch (error) { if (generation !== state.documentGeneration) return; state.imageStatus.set(node.id, 'Could not restore image'); showToast(error.message); }
  }
  if (generation === state.documentGeneration) renderAssetsTab();
}

function renderBulkBar() {
  const bar = $('#bulk-bar'); const bulk = state.bulk;
  bar.hidden = !bulk;
  if (!bulk) return;
  const engineMetrics = imageEngine.metrics();
  const total = bulk.targets.length;
  $('#bulk-title').textContent = bulk.cancelled ? 'Recipe stopped' : bulk.done ? (bulk.failed ? 'Recipe finished with errors' : 'Recipe applied') : bulk.paused ? 'Processing paused' : `Applying ${bulk.recipe.name}`;
  $('#bulk-subtitle').textContent = bulk.cancelled ? `${bulk.completed} completed · ${bulk.targets.length - bulk.completed} left untouched` : bulk.done ? `${bulk.completed} updated${bulk.failed ? ` · ${bulk.failed} failed` : ''} in place` : bulk.paused ? `${bulk.inflight} image${bulk.inflight === 1 ? '' : 's'} queued or finishing before pause` : `Editing original layers · ${bulk.inflight} queued or processing`;
  $('#bulk-progress-fill').style.width = `${total ? Math.min(100, (bulk.completed / total) * 100) : 0}%`;
  $('#bulk-progress-label').textContent = `${bulk.completed} / ${total}`;
  $('#bulk-speed').value = bulk.concurrency;
  $('#bulk-speed-value').textContent = `${bulk.concurrency} max worker${bulk.concurrency === 1 ? '' : 's'} · ${engineMetrics.active} active`;
  $('#bulk-speed-value').title = `Estimated WASM working set: ${Math.round(engineMetrics.activeRenderBytes / 1048576)} of ${Math.round(engineMetrics.maxActiveRenderBytes / 1048576)} MiB; memory admission can lower actual parallelism.`;
  $('#bulk-spinner').classList.toggle('is-done', bulk.done || bulk.cancelled);
  $('#bulk-spinner').classList.toggle('is-paused', bulk.paused);
  $('#bulk-pause').hidden = bulk.done || bulk.cancelled;
  $('#bulk-pause').textContent = bulk.paused ? 'Resume' : 'Pause';
  $('#bulk-cancel').hidden = bulk.done || bulk.cancelled;
  $('#bulk-done').hidden = !(bulk.done || bulk.cancelled);
}

function snapshotRecipeField(object, key) {
  return { present: Object.hasOwn(object, key), value: object[key] };
}

function snapshotRecipeState(node) {
  return {
    adjustments: { ...(node.adjustments || {}) },
    transforms: snapshotRecipeField(node, 'transforms'),
    fit: snapshotRecipeField(node, 'fit'),
    opacity: snapshotRecipeField(node, 'opacity')
  };
}

function rollbackRecipeStateIfUnchanged(node, before, applied) {
  let changed = false;
  const currentAdjustments = { ...(node.adjustments || {}) };
  const adjustmentKeys = new Set([
    ...Object.keys(before.adjustments),
    ...Object.keys(applied.adjustments),
    ...Object.keys(currentAdjustments)
  ]);
  for (const key of adjustmentKeys) {
    const stillApplied = Object.hasOwn(currentAdjustments, key) === Object.hasOwn(applied.adjustments, key)
      && (!Object.hasOwn(applied.adjustments, key) || Object.is(currentAdjustments[key], applied.adjustments[key]));
    if (!stillApplied) continue;
    if (Object.hasOwn(before.adjustments, key)) currentAdjustments[key] = before.adjustments[key];
    else delete currentAdjustments[key];
    changed = true;
  }
  if (changed) node.adjustments = currentAdjustments;

  const currentTransforms = snapshotRecipeField(node, 'transforms');
  const recipeTransforms = applied.transforms;
  if (currentTransforms.present === recipeTransforms.present && currentTransforms.present
    && JSON.stringify(currentTransforms.value) === JSON.stringify(recipeTransforms.value)) {
    if (before.transforms.present) node.transforms = structuredClone(before.transforms.value);
    else delete node.transforms;
    changed = true;
  }

  for (const key of ['fit', 'opacity']) {
    const current = snapshotRecipeField(node, key);
    const recipeValue = applied[key];
    if (current.present !== recipeValue.present || (current.present && !Object.is(current.value, recipeValue.value))) continue;
    const previous = before[key];
    if (previous.present) node[key] = previous.value;
    else delete node[key];
    changed = true;
  }
  return changed;
}

function scheduleBulk() {
  const bulk = state.bulk;
  if (!bulk || bulk.paused || bulk.cancelled || bulk.done) return;
  while (bulk.inflight < bulk.concurrency && bulk.next < bulk.targets.length) {
    const id = bulk.targets[bulk.next++];
    const entry = findNode(state.document, id);
    if (!entry || entry.node.type !== 'image') { bulk.failed += 1; bulk.completed += 1; continue; }
    const node = entry.node; const before = snapshotRecipeState(node);
    applyImageRecipe(state.document, id, bulk.recipe);
    const applied = snapshotRecipeState(node);
    bulk.inflight += 1; state.imageStatus.set(id, 'Processing recipe…');
    renderImagePreview(id, node.assetId, node.adjustments, node.transforms).then(rendered => {
      if (state.bulk !== bulk) return;
      if (!rendered) throw new DOMException('A newer image edit replaced this recipe preview before it could be displayed.', 'AbortError');
      bulk.completed += 1;
    }).catch(error => {
      if (state.bulk !== bulk) return;
      rollbackRecipeStateIfUnchanged(node, before, applied);
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
  if (state.bulk && (!state.bulk.done || state.bulk.inflight > 0)) {
    showToast('A recipe batch is active. Finish or stop it before starting another.');
    renderBulkBar();
    return false;
  }
  const unique = [...new Set(targets)].filter(id => findNode(state.document, id)?.node.type === 'image');
  if (!unique.length) { showToast('Select one or more image layers first.'); return; }
  checkpoint(`Apply ${recipe.name} to ${unique.length} image${unique.length === 1 ? '' : 's'}`);
  const concurrency = Math.min(2, CPU_LIMIT);
  state.bulk = { recipe, targets: unique, next: 0, completed: 0, failed: 0, inflight: 0, concurrency, paused: false, cancelled: false, done: false };
  imageEngine.setConcurrency(concurrency);
  renderBulkBar(); scheduleBulk();
  return true;
}

function saveRecipeFor(nodeId) {
  const node = findNode(state.document, nodeId)?.node;
  if (!node || node.type !== 'image') return;
  pendingRecipeNodeId = nodeId;
  const adjustments = node.adjustments || {};
  const active = ['brightness', 'contrast', 'saturation', 'blur'].filter(key => Number(adjustments[key]) !== 0)
    .map(key => `${key[0].toUpperCase()}${key.slice(1)} ${adjustments[key]}`);
  const transforms = createImageTransforms(node.transforms || {});
  if (transforms.crop) active.push(`Crop ${Math.round(transforms.crop.left * 100)}%/${Math.round(transforms.crop.top * 100)}% to ${Math.round(transforms.crop.right * 100)}%/${Math.round(transforms.crop.bottom * 100)}%`);
  if (transforms.rotation) active.push(`Rotate ${transforms.rotation}°`);
  $('#recipe-name').value = `${node.name} look`;
  $('#recipe-preview-summary').textContent = active.length ? active.join(' · ') : 'Original image look · No adjustments';
  $('#recipe-dialog').showModal(); $('#recipe-name').focus(); $('#recipe-name').select();
}

function saveTypographyStyleFor(nodeId) {
  const node = findNode(state.document, nodeId)?.node;
  if (node?.type !== 'text') { showToast('Select a text layer to save its typography.'); return; }
  const name = prompt('Text style name', `${node.name} text`);
  if (name == null) return;
  try {
    checkpoint('Create text style');
    const style = createTypographyStyle(state.document, node.id, name);
    renderUI(); queueSave(); showToast(`Text style “${style.name}” saved.`);
  } catch (error) { showToast(error.message); }
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

function applyTypographyStyleToSelection(styleId) {
  const style = state.document.typographyStyles?.find(item => item.id === styleId);
  const compatible = selectedNodes().filter(node => node.type === 'text');
  if (!style || !compatible.length) { showToast('Select one or more text layers to apply this style.'); return; }
  checkpoint(`Apply ${style.name}`);
  const overriddenProperties = ['width', 'height', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'align', 'verticalAlign', 'color', 'textCase', 'textDecoration', 'textVariableId', 'textStyleId', 'variableBindings'];
  const layoutParents = new Set();
  for (const node of compatible) {
    applyTypographyStyle(state.document, node.id, style.id);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) for (const property of overriddenProperties) recordComponentOverride(instanceRoot, node, property);
    if (resizeTextNode(node)) {
      const parent = findNode(state.document, node.id)?.parent;
      if (parent?.autoLayout) layoutParents.add(parent);
    }
  }
  for (const parent of layoutParents) applyAutoLayout(parent);
  renderUI(); queueSave(); renderer.invalidate();
  showToast(`Applied “${style.name}” to ${compatible.length} text layer${compatible.length === 1 ? '' : 's'}.`);
}

function updateTypographyStyleFromSelection(styleId) {
  const style = state.document.typographyStyles?.find(item => item.id === styleId);
  const nodes = selectedNodes().filter(node => node.type === 'text');
  if (!style) { showToast('This text style no longer exists.'); return; }
  if (nodes.length !== 1) { showToast('Select one text layer to update a style.'); return; }
  checkpoint(`Update ${style.name}`);
  if (!updateTypographyStyle(state.document, style.id, nodes[0].id)) { showToast('Could not update this text style.'); return; }
  renderUI(); queueSave(); showToast(`Updated “${style.name}” for future applications.`);
}

function removeTypographyStyleFromAssets(styleId) {
  const style = state.document.typographyStyles?.find(item => item.id === styleId);
  if (!style) return;
  checkpoint(`Delete ${style.name}`);
  deleteTypographyStyle(state.document, style.id);
  renderUI(); queueSave(); showToast(`Deleted “${style.name}”.`);
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
  if (property.startsWith('autoLayout.')) relayoutVariableBoundFrames();
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
    { label: 'Copy layers', shortcut: '⌘C', action: copySelected },
    { label: 'Cut layers', shortcut: '⌘X', action: cutSelected },
    { label: 'Paste layers', shortcut: '⌘V', action: () => pasteSelectedLayers(), disabled: !hasClipboardLayers() },
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
  if (node?.type === 'text') {
    items.splice(0, 0, { label: 'Save text style…', action: () => saveTypographyStyleFor(nodeId) }, { separator: true });
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
  const textTargets = selectedNodes().filter(item => item.type === 'text');
  const typographyStyles = state.document.typographyStyles || [];
  if (textTargets.length && typographyStyles.length) items.push({ separator: true }, { label: 'Apply text style', labelOnly: true }, ...typographyStyles.map(style => ({ label: style.name, action: () => applyTypographyStyleToSelection(style.id) })));
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
    { label: 'Your designs…', action: openDesignLibrary },
    { label: 'New design', shortcut: '⌘N', action: newDesign },
    { label: 'Open local design…', action: () => $('#open-file-input').click() },
    { label: 'Import SVG as editable layers…', action: () => $('#svg-input').click() },
    { separator: true },
    { label: 'Save local copy…', shortcut: '⌘⇧S', action: exportDesign },
    { label: 'Copy selected layers', shortcut: '⌘C', action: copySelected, disabled: !rootSelectedIds().length },
    { label: 'Cut selected layers', shortcut: '⌘X', action: cutSelected, disabled: !rootSelectedIds().length },
    { label: 'Paste layers', shortcut: '⌘V', action: () => pasteSelectedLayers(), disabled: !hasClipboardLayers() },
    { label: 'Duplicate selected layers', shortcut: '⌘D', action: duplicateSelected, disabled: !rootSelectedIds().length },
    { label: 'Export selected layer as PNG', action: exportSelectionPng, disabled: state.selectedIds.length === 0 },
    { label: 'Export selected layer as SVG', action: () => { try { exportSelectedNodeSvg(rootSelectedIds()[0]); } catch (error) { showToast(error.message || 'Could not export this layer as SVG.'); } }, disabled: rootSelectedIds().length !== 1 },
    { label: 'Export current page as SVG', action: () => { try { exportActivePageSvg(); } catch (error) { showToast(error.message || 'Could not export this page as SVG.'); } } },
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
  reconcileImagePreviewRuntime();
  state.selectedIds = []; state.selectedVectorPoint = null; renderUI(); queueSave();
}
function copySelected() {
  const entries = orderedRootSelectedEntries();
  if (!entries.length) { showToast('Select one or more layers to copy.'); return; }
  try {
    state.clipboard = createLayerClipboard(state.document, entries, { mode: 'copy', pageId: activePage().id });
    showToast(`Copied ${entries.length} layer${entries.length === 1 ? '' : 's'}.`);
  } catch (error) { showToast(error.message || 'Could not copy these layers.'); }
}
function cutSelected() {
  const entries = orderedRootSelectedEntries();
  if (!entries.length) { showToast('Select one or more layers to cut.'); return; }
  let containsMainComponent = false;
  for (const entry of entries) walkNodes([entry.node], ({ node }) => { if (node.isComponent) containsMainComponent = true; });
  if (containsMainComponent || entries.some(entry => entry.parents.some(parent => parent.isInstance))) {
    showToast('Cut the whole component instance, or duplicate a main component before moving it.');
    return;
  }
  try {
    const clipboard = createLayerClipboard(state.document, entries, { mode: 'cut', pageId: activePage().id });
    const nextDocument = cloneDocument(state.document);
    for (const entry of entries) if (!removeNode(nextDocument, entry.node.id, activePage().id)) throw new Error('One of the selected layers no longer exists.');
    validateDocument(nextDocument);
    checkpoint('Cut layers');
    state.document = nextDocument;
    reconcileImagePreviewRuntime();
    state.clipboard = clipboard;
    state.selectedIds = []; state.selectedVectorPoint = null;
    renderUI(); queueSave();
    showToast(`Cut ${entries.length} layer${entries.length === 1 ? '' : 's'}. Paste to move them back into this design.`);
  } catch (error) { showToast(error.message || 'Could not cut these layers.'); }
}
function pasteSelectedLayers({ duplicate = false } = {}) {
  try {
    const clipboard = duplicate
      ? (() => { const entries = orderedRootSelectedEntries(); return entries.length ? createLayerClipboard(state.document, entries, { mode: 'copy', pageId: activePage().id }) : null; })()
      : state.clipboard;
    if (!clipboard) { showToast(duplicate ? 'Select one or more layers to duplicate.' : 'Copy or cut layers before pasting.'); return; }
    const result = pasteLayerClipboard(state.document, clipboard, { pageId: activePage().id });
    if (!result.nodes.length) return;
    checkpoint(duplicate ? 'Duplicate layers' : clipboard.mode === 'cut' ? 'Move cut layers' : 'Paste layers');
    state.document = result.document;
    if (!duplicate && state.clipboard === clipboard) {
      if (clipboard.mode === 'cut') state.clipboard = [];
      else clipboard.pasteCount = result.pasteCount;
    }
    setSelection(result.nodes.map(node => node.id));
    renderUI(); queueSave();
    showToast(duplicate ? `Duplicated ${result.nodes.length} layer${result.nodes.length === 1 ? '' : 's'}.` : `Pasted ${result.nodes.length} layer${result.nodes.length === 1 ? '' : 's'}.`);
  } catch (error) { showToast(error.message || 'Could not paste these layers.'); }
}
function duplicateSelected() {
  pasteSelectedLayers({ duplicate: true });
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
function changeInstanceComponentProperty(instanceId, propertyId, value) {
  const instance = findNode(state.document, instanceId)?.node;
  const property = instance?.isInstance
    ? state.document.components?.find(item => item.id === instance.componentId)?.componentProperties?.find(item => item.id === propertyId)
    : null;
  if (!instance || !property) return;
  try {
    checkpoint(`Change component property ${property.name}`);
    setComponentPropertyValue(state.document, instanceId, propertyId, value);
    renderUI(); queueSave(); renderer.invalidate();
  } catch (error) {
    showToast(error.message || `Could not update ${property.name}.`);
    renderInspector();
  }
}
function addComponentProperty(componentId, targetNodeId, type) {
  const name = $('#component-property-name')?.value.trim();
  if (!name) { showToast('Enter a name for this component property.'); $('#component-property-name')?.focus(); return; }
  try {
    checkpoint(`Add component property ${name}`);
    const property = createComponentProperty(state.document, componentId, { name, type, targetNodeId });
    syncComponentInstances(state.document, componentId);
    state.componentPropertyTargetId = targetNodeId;
    state.componentPropertyType = type;
    renderUI(); queueSave(); renderer.invalidate(); showToast(`${property.name} is ready on component instances.`);
  } catch (error) {
    showToast(error.message || 'Could not add this component property.');
  }
}
function componentSlotCandidateEntries(instanceId, pageId = state.document.activePageId) {
  const page = state.document.pages?.find(item => item.id === pageId);
  const instanceEntry = findNode(state.document, instanceId, pageId);
  if (!page || !instanceEntry) return [];
  const excludedIds = new Set([instanceId, ...instanceEntry.parents.map(parent => parent.id)]);
  const containingMainComponent = new Set();
  walkNodes(page.children || [], ({ node, parents }) => {
    if (!node.isComponent) return;
    containingMainComponent.add(node.id);
    for (const parent of parents) containingMainComponent.add(parent.id);
  });
  const rows = [];
  walkNodes(page.children || [], entry => {
    const { node, parents } = entry;
    if (excludedIds.has(node.id) || containingMainComponent.has(node.id) || parents.some(parent => parent.id === instanceId)) return;
    rows.push(entry);
  });
  return rows;
}
function renderComponentSlotCandidateList() {
  const dialogState = state.componentSlotDialog;
  if (!dialogState) return;
  const list = $('#component-slot-candidates');
  const query = dialogState.query.trim().toLocaleLowerCase();
  const matches = dialogState.entries.filter(({ node, parents }) => {
    const label = `${node.name || ''} ${node.type} ${parents.map(parent => parent.name || '').join(' ')}`.toLocaleLowerCase();
    return !query || label.includes(query);
  });
  const visible = matches.slice(0, 250);
  $('#component-slot-count').textContent = matches.length > visible.length
    ? `${matches.length.toLocaleString()} matches · showing the first ${visible.length}. Search to narrow the list.`
    : `${matches.length.toLocaleString()} layer${matches.length === 1 ? '' : 's'} available`;
  if (!visible.length) {
    list.innerHTML = '<div class="slot-picker-empty">No matching layers on this page.</div>';
    return;
  }
  list.innerHTML = visible.map(({ node, parents }) => {
    const checked = dialogState.selectedIds.has(node.id);
    const trail = [...parents.map(parent => parent.name), node.name].filter(Boolean).join(' / ');
    return `<label class="slot-picker-row" title="${escapeHtml(trail)}"><input type="checkbox" data-slot-candidate="${escapeHtml(node.id)}"${checked ? ' checked' : ''}/><span class="slot-picker-name">${escapeHtml(node.name || node.type)}</span><small>${escapeHtml(node.type)}</small></label>`;
  }).join('');
}
function openComponentSlotDialog(instanceId, propertyId) {
  const instance = findNode(state.document, instanceId)?.node;
  const component = instance?.isInstance && state.document.components?.find(item => item.id === instance.componentId);
  const property = component?.componentProperties?.find(item => item.id === propertyId && item.type === 'SLOT');
  if (!instance || !property) { showToast('This component slot is no longer available.'); return; }
  const entry = findNode(state.document, instanceId);
  const excludedIds = new Set([instanceId, ...(entry?.parents || []).map(parent => parent.id)]);
  const selectedIds = new Set(state.selectedIds.filter(id => {
    const selected = findNode(state.document, id);
    return selected && !excludedIds.has(id) && !selected.parents.some(parent => parent.id === instanceId);
  }));
  state.componentSlotDialog = {
    instanceId, propertyId, pageId: state.document.activePageId,
    selectedIds, query: '', entries: componentSlotCandidateEntries(instanceId)
  };
  $('#component-slot-dialog-title').textContent = `Choose ${property.name} content`;
  $('#component-slot-search').value = '';
  renderComponentSlotCandidateList();
  $('#component-slot-dialog').showModal();
  $('#component-slot-search').focus();
}
function applyComponentSlotDialog(dialogState = state.componentSlotDialog) {
  if (!dialogState) return;
  const selectedSet = dialogState.selectedIds;
  const selectedEntries = dialogState.entries.filter(entry => selectedSet.has(entry.node.id));
  const selectedRootEntries = selectedEntries.filter(entry => !entry.parents.some(parent => selectedSet.has(parent.id)));
  const nodes = selectedRootEntries.map(entry => entry.node);
  try {
    checkpoint('Set component slot content');
    const installed = setComponentSlotContent(state.document, dialogState.instanceId, dialogState.propertyId, nodes, dialogState.pageId);
    if (installed === false) throw new Error('This component slot is no longer available.');
    setSelection(installed.map(node => node.id));
    queueSave(); renderUI();
    showToast(nodes.length ? `Added ${nodes.length} layer${nodes.length === 1 ? '' : 's'} to the component slot.` : 'Component slot content cleared.');
  } catch (error) {
    showToast(error.message || 'Could not update this component slot.');
    renderInspector();
  }
}
function resetComponentSlot(instanceId, propertyId) {
  try {
    checkpoint('Reset component slot');
    if (!resetComponentSlotContent(state.document, instanceId, propertyId)) throw new Error('This component slot is no longer available.');
    setSelection([instanceId]);
    queueSave(); renderUI(); renderer.invalidate();
    showToast('Component slot restored to its default content.');
  } catch (error) { showToast(error.message || 'Could not reset this component slot.'); }
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

function refreshHistoryImagePreviews(previousDocument) {
  for (const reference of imageAssetReferencesAcrossPages()) {
    const { node, assetId, adjustments, transforms } = reference;
    const previousNode = findNode(previousDocument, node.id)?.node;
    const previousSource = previousNode?.type === 'image' ? previousNode : previousNode?.imageFill;
    const previousSettings = previousSource
      ? JSON.stringify([previousSource.assetId, previousSource.adjustments || {}, previousSource.transforms || {}])
      : null;
    const currentSettings = JSON.stringify([assetId, adjustments || {}, transforms || {}]);
    if (previousSettings === currentSettings) continue;

    const timer = previewTimers.get(node.id);
    if (timer) clearTimeout(timer);
    previewTimers.delete(node.id);
    const asset = state.assets.get(assetId);
    if (!asset?.sourceBytes) {
      state.previews.get(node.id)?.close?.();
      state.previews.delete(node.id);
      state.previewAssetIds.delete(node.id);
      const url = state.previewUrls.get(node.id);
      if (url) URL.revokeObjectURL(url);
      state.previewUrls.delete(node.id);
      state.imageStatus.set(node.id, 'Original image missing');
      continue;
    }
    state.imageStatus.set(node.id, 'Updating preview…');
    renderImagePreview(node.id, assetId, adjustments, transforms).catch(error => {
      state.imageStatus.set(node.id, 'Preview failed');
      showToast(`${node.name}: ${error.message || 'Could not restore the image preview.'}`);
      if (state.selectedIds.includes(node.id)) renderInspector();
    });
  }
}
function undo() {
  const previousDocument = state.document;
  const next = history.undo(previousDocument);
  if (!next) return;
  state.document = next;
  reconcileImagePreviewRuntime();
  refreshHistoryImagePreviews(previousDocument);
  state.selectedIds = state.selectedIds.filter(id => findNode(state.document, id));
  state.selectedVectorPoint = null; renderUI(); queueSave();
}
function redo() {
  const previousDocument = state.document;
  const next = history.redo(previousDocument);
  if (!next) return;
  state.document = next;
  reconcileImagePreviewRuntime();
  refreshHistoryImagePreviews(previousDocument);
  state.selectedIds = state.selectedIds.filter(id => findNode(state.document, id));
  state.selectedVectorPoint = null; renderUI(); queueSave();
}
function newDesign() {
  return switchToDocument(createDocument(), { message: 'New local design created.' });
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
  const applySessionVariableModes = frame => {
    const modes = state.presenting.variableModes || {};
    if (!Object.keys(modes).length) return frame;
    frame.variableModes = { ...(frame.variableModes || {}), ...modes };
    return frame;
  };
  const displayFrame = applySessionVariableModes(previousFrame && Number.isFinite(progress)
    ? interpolateSmartFrame(previousFrame, target.node, progress)
    : structuredClone(target.node));
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
    const displayOverlay = applySessionVariableModes(structuredClone(overlayTarget.node));
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
  const linkUrl = interaction.action === 'open-link' ? normalizePrototypeLinkUrl(interaction.url) : null;
  const source = interaction.action === 'navigate' && interaction.transition === 'smart-animate'
    ? findNode(state.document, state.presenting.frameId, state.presenting.pageId)?.node
    : null;
  const previousFrame = source ? structuredClone(source) : null;
  cancelPresentationAnimation();
  const result = applyPrototypeInteraction(state.document, state.presenting, interaction);
  if (!result) { showToast(interaction.action === 'close-overlay' ? 'There is no open overlay to close.' : 'This prototype destination no longer exists.'); return; }
  if (result === 'link-opened' && linkUrl) {
    window.open(linkUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  if (result === 'navigated' && previousFrame) animateSmartTransition(previousFrame, interaction);
  else renderPresentationFrame(interaction);
}

function handlePresentationPointer(event, trigger) {
  if (!state.presenting || !presentRenderState?.document) return;
  if ($('#present-dialog').dataset.smartAnimating === 'true') return;
  const page = presentRenderState.document.pages[0];
  const hit = hitTestPage(page, screenToWorld(event, $('#present-canvas'), presentRenderState), (node, point, x, y) => presentRenderer?.hitTestBoolean(node, point, x, y) ?? true, presentRenderState.document);
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
  const found = findClickableInteraction(state.document, state.presenting.pageId, hit.id, trigger, state.presenting);
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
    for (const reference of imageAssetReferencesAcrossPages()) {
      if (assets.some(asset => asset.id === reference.assetId)) continue;
      const saved = await loadImageAsset(reference.assetId);
      if (saved) assets.push({ id: saved.id, name: saved.name, type: saved.type, bytes: saved.bytes });
    }
    await downloadLocalPackage(JSON.parse(serializeDocument(state.document)), assets);
    showToast('Local design copy downloaded.');
  } catch (error) { showToast(error.message || 'Could not export this local design.'); }
}
async function persistCurrentDocumentNow() {
  if (!state.ready) return true;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  setSaveState('saving', 'Saving locally…');
  try {
    while (true) {
      const revision = state.saveRevision;
      const snapshot = JSON.parse(serializeDocument(state.document));
      await enqueueDocumentSave(snapshot);
      if (revision === state.saveRevision) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
        setSaveState('saved', 'Saved locally');
        return true;
      }
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
  } catch (error) {
    setSaveState('error', 'Could not save');
    showToast(error.message || 'Could not save this design before switching files.');
    return false;
  }
}

function releaseImageRuntimeForDocumentSwitch() {
  for (const timer of previewTimers.values()) clearTimeout(timer);
  previewTimers.clear();
  for (const nodeId of state.renderVersion.keys()) imageEngine.cancelQueuedByKey(`preview:${nodeId}`);
  for (const assetId of state.assets.keys()) imageEngine.dispose(assetId);
  for (const asset of state.assets.values()) {
    asset.bitmap?.close?.();
    if (asset.bitmapUrl) URL.revokeObjectURL(asset.bitmapUrl);
  }
  for (const bitmap of state.previews.values()) bitmap.close?.();
  for (const url of state.previewUrls.values()) URL.revokeObjectURL(url);
  state.assets.clear(); state.previews.clear(); state.previewUrls.clear(); state.previewAssetIds.clear();
  state.previewVersions.clear(); state.imageStatus.clear(); state.renderVersion.clear();
}

async function switchToDocument(nextDocument, { saveCurrent = true, message = 'Local design opened on this device.', beforeSwitch = null } = {}) {
  if (state.bulk && (!state.bulk.done || state.bulk.inflight > 0)) {
    showToast('Finish or stop the active image recipe before switching designs.');
    return false;
  }
  if (state.documentTransitioning) { showToast('A design switch is already in progress.'); return false; }
  if (state.interaction) { showToast('Finish the current canvas action before switching designs.'); return false; }
  if (state.pendingImageImports) { showToast('Wait for the current image import to finish before switching designs.'); return false; }
  state.documentTransitioning = true;
  setDocumentEditingBlocked(true);
  try {
    if (saveCurrent && !(await persistCurrentDocumentNow())) return false;
    if (beforeSwitch) await beforeSwitch(nextDocument);
    const generation = ++state.documentGeneration;
    releaseImageRuntimeForDocumentSwitch();
    state.document = nextDocument;
    state.prototypeConditionVariableId = null;
    state.prototypeConditionOperator = 'equals';
    state.prototypeConditionValue = null;
    state.selectedIds = []; state.selectedVectorPoint = null; state.pendingCommentAnchor = null; state.activeCommentId = null;
    state.draftNode = null; state.penDraft = null; state.penHover = null; state.marquee = null; state.interaction = null;
    state.pointerMap.clear(); state.prototypeSourceId = null; state.textNodeId = null; state.textSelection = null;
    state.bulk = null; state.inspectorTab = 'design';
    state.zoom = 1; state.panX = canvas.clientWidth / 2; state.panY = canvas.clientHeight / 2;
    history.undoStack.length = 0; history.redoStack.length = 0;
    renderBulkBar(); renderUI();
    await restoreImageAssets(generation);
    showToast(message);
    return true;
  } catch (error) {
    showToast(error.message || 'Could not switch designs.');
    return false;
  } finally {
    state.documentTransitioning = false;
    setDocumentEditingBlocked(false);
    if (state.document === nextDocument) queueSave();
  }
}

async function renderDesignLibrary() {
  const list = $('#design-library-list');
  list.setAttribute('aria-busy', 'true');
  list.replaceChildren();
  try {
    const documents = await listSavedDocuments();
    if (!documents.length) {
      list.innerHTML = '<div class="design-library-empty">Your local designs will appear here as you work. They are stored in this browser profile.</div>';
      return;
    }
    list.innerHTML = documents.map(item => {
      const current = item.id === state.document.id;
      let date = 'Saved on this device';
      if (item.savedAt) {
        try { date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.savedAt)); } catch { /* Keep the local fallback label. */ }
      }
      return `<article class="design-file-row${current ? ' is-current' : ''}"><div class="design-file-details"><span class="design-file-name">${escapeHtml(item.name)}${current ? ' · Current' : ''}</span><span class="design-file-date">${escapeHtml(date)} · This device</span></div><div class="design-file-actions"><button type="button" data-design-action="open" data-design-id="${escapeHtml(item.id)}"${current ? ' disabled aria-current="true"' : ''}>${current ? 'Open' : 'Open'}</button><button type="button" data-design-action="rename" data-design-id="${escapeHtml(item.id)}">Rename</button><button type="button" data-design-action="duplicate" data-design-id="${escapeHtml(item.id)}">Duplicate</button><button type="button" data-design-action="delete" data-design-id="${escapeHtml(item.id)}">Delete</button></div></article>`;
    }).join('');
  } finally {
    list.setAttribute('aria-busy', 'false');
  }
}

async function openDesignLibrary() {
  const dialog = $('#design-library-dialog');
  const list = $('#design-library-list');
  if (!dialog.open) dialog.showModal();
  list.setAttribute('aria-busy', 'true');
  list.innerHTML = '<div class="design-library-empty">Loading your local designs…</div>';
  setDocumentEditingBlocked(true);
  try {
    if (!(await persistCurrentDocumentNow())) return;
    await renderDesignLibrary();
  } catch (error) { showToast(error.message || 'Could not read the local design library.'); }
  finally {
    list.setAttribute('aria-busy', 'false');
    if (!state.documentTransitioning) setDocumentEditingBlocked(false);
  }
}

async function handleDesignLibraryAction(action, id) {
  try {
    if (action === 'open') {
      const saved = await loadDocumentById(id);
      if (!saved) { showToast('That saved design is no longer available.'); await renderDesignLibrary(); return; }
      const opened = await switchToDocument(parseDocument(saved));
      if (opened) { $('#design-library-dialog').close(); await renderDesignLibrary(); }
      return;
    }
    if (action === 'rename') {
      const saved = await loadDocumentById(id);
      if (!saved) { showToast('That saved design is no longer available.'); await renderDesignLibrary(); return; }
      const name = prompt('Rename local design', saved.name || 'Untitled');
      if (name == null) return;
      const nextName = String(name).trim();
      if (!nextName || nextName.length > 120) { showToast('A design name must contain 1–120 characters.'); return; }
      if (!(await renameStoredDocument(id, nextName))) { showToast('That saved design is no longer available.'); return; }
      if (id === state.document.id) { state.document.name = nextName; renderUI(); await persistCurrentDocumentNow(); }
      await renderDesignLibrary();
      return;
    }
    if (action === 'duplicate') {
      if (id === state.document.id && !(await persistCurrentDocumentNow())) return;
      const duplicate = await duplicateStoredDocument(id);
      if (!duplicate) { showToast('That saved design is no longer available.'); return; }
      await renderDesignLibrary();
      showToast(`“${duplicate.name}” was added to your local designs.`);
      return;
    }
    if (action === 'delete') {
      if (state.bulk && (!state.bulk.done || state.bulk.inflight > 0)) { showToast('Finish or stop the active image recipe before deleting a design.'); return; }
      const saved = await loadDocumentById(id);
      if (!saved) { showToast('That saved design is no longer available.'); await renderDesignLibrary(); return; }
      if (!confirm(`Delete “${saved.name || 'Untitled'}” from this device? This cannot be undone.`)) return;
      if (id === state.document.id) {
        const switched = await switchToDocument(createDocument(), {
          message: 'Design deleted. A new local design is ready.',
          beforeSwitch: async () => {
            if (!await deleteStoredDocument(id)) throw new Error('That saved design is no longer available.');
          }
        });
        if (!switched) return;
      } else {
        await deleteStoredDocument(id);
      }
      await renderDesignLibrary();
    }
  } catch (error) { showToast(error.message || 'Could not update the local design library.'); }
}

function imageNodesAcrossPages() { const result = []; for (const page of state.document.pages) walkNodes(page.children, ({ node }) => { if (node.type === 'image') result.push(node); }); return result; }
function imageAssetReferencesAcrossPages() {
  const result = [];
  for (const page of state.document.pages) walkNodes(page.children, ({ node }) => {
    if (node.type === 'image' && node.assetId) result.push({ node, assetId: node.assetId, name: node.fileName || node.name, adjustments: node.adjustments, transforms: node.transforms });
    if (node.imageFill?.assetId) result.push({ node, assetId: node.imageFill.assetId, name: node.name, adjustments: node.imageFill.adjustments, transforms: node.imageFill.transforms });
  });
  return result;
}

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
    if (node) walkNodes([node], ({ node: child }) => {
      if (child.type === 'image' && child.assetId) {
        images.set(child.id, { node: child, assetId: child.assetId, adjustments: child.adjustments, transforms: child.transforms });
      }
      if (child.imageFill?.assetId) {
        images.set(child.id, {
          node: child,
          assetId: child.imageFill.assetId,
          adjustments: child.imageFill.adjustments,
          transforms: child.imageFill.transforms
        });
      }
    });
  }
  await Promise.all([...images.values()].map(async ({ node, assetId, adjustments, transforms }) => {
    const asset = state.assets.get(assetId);
    if (!asset?.sourceBytes) throw new Error(`The original image for “${node.name}” is unavailable on this device.`);
    const status = state.imageStatus.get(node.id) || '';
    const timer = previewTimers.get(node.id);
    if (timer) { clearTimeout(timer); previewTimers.delete(node.id); }
    if (timer || status === 'Updating preview…' || status === 'Processing locally…') {
      await renderImagePreview(node.id, assetId, adjustments, transforms);
    }
    const hasEdits = Object.values(adjustments || {}).some(value => Number(value) !== 0)
      || Boolean(transforms?.crop || transforms?.rotation);
    const previewMatchesAsset = state.previews.has(node.id)
      && (state.previewAssetIds.get(node.id) == null || state.previewAssetIds.get(node.id) === assetId);
    if (!previewMatchesAsset && hasEdits) await renderImagePreview(node.id, assetId, adjustments, transforms);
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

function downloadSvg(markup, filename) {
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function createSvgTextMeasurer() {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return undefined;
  return (text, node) => {
    const fontSize = getNodePropertyValue(state.document, node, 'fontSize') || 24;
    const fontWeight = getNodePropertyValue(state.document, node, 'fontWeight') || 400;
    const letterSpacing = getNodePropertyValue(state.document, node, 'letterSpacing') ?? 0;
    context.font = `${node.fontStyle === 'italic' ? 'italic ' : ''}${fontWeight} ${fontSize}px ${node.fontFamily || 'Arial, sans-serif'}`;
    return measureTrackedText(context, text, letterSpacing);
  };
}

function exportSelectedNodeSvg(nodeId) {
  const node = findNode(state.document, nodeId)?.node;
  if (!node) throw new Error('The selected layer is no longer available.');
  const markup = exportNodeToSvg(node, { document: state.document, assets: state.assets, measureText: createSvgTextMeasurer() });
  const filename = `${safeExportName(node.name)}.svg`;
  downloadSvg(markup, filename);
  showToast(`Downloaded editable SVG · ${filename}.`);
}

function exportActivePageSvg() {
  const page = activePage();
  if (!page) throw new Error('There is no active page to export.');
  const markup = exportPageToSvg(page, { document: state.document, assets: state.assets, measureText: createSvgTextMeasurer() });
  const filename = `${safeExportName(page.name || 'Page')}.svg`;
  downloadSvg(markup, filename);
  showToast(`Downloaded editable page SVG · ${filename}.`);
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
    showToast(`${kind === 'css' ? 'CSS' : kind === 'html' ? 'HTML' : 'Layer JSON'} copied.`);
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
  if (action === 'save-image-recipe') { saveRecipeFor(details.nodeId || node?.id); return; }
  if (action === 'rotate-image' || action === 'reset-image-transforms') {
    applyImageTransformAction(node, details.transformTarget, action, details.direction);
    return;
  }
  if (action === 'apply-image-recipe' || action === 'apply-selection-image-recipe') {
    const recipeId = $('#selection-image-recipe')?.value;
    const recipe = state.document.recipes.find(item => item.id === recipeId);
    if (!recipe) { showToast('Choose a saved image recipe first.'); return; }
    const targets = action === 'apply-image-recipe'
      ? [details.nodeId || node?.id].filter(Boolean)
      : selectedNodes().filter(item => item.type === 'image').map(item => item.id);
    if (!targets.length) { showToast('Select one or more image layers first.'); return; }
    if (action === 'apply-selection-image-recipe') { state.layerSelectionMode = false; renderLayers(); }
    closeMobilePanels();
    startRecipe(recipe, targets);
    return;
  }
  if (action === 'align-selection') alignSelectedLayers(details.alignMode);
  else if (action === 'add-gradient-stop' && node?.fillGradient && !node.locked) {
    const stops = [...node.fillGradient.stops].sort((a, b) => a.position - b.position);
    if (stops.length >= 8) { showToast('A gradient can have up to 8 color stops.'); return; }
    let left = stops[0]; let right = stops[1];
    for (let index = 1; index < stops.length - 1; index += 1) {
      if (stops[index + 1].position - stops[index].position > right.position - left.position) { left = stops[index]; right = stops[index + 1]; }
    }
    checkpoint('Add gradient stop');
    node.fillGradient.stops.push({ id: createId('stop'), color: left.color, position: (left.position + right.position) / 2 });
    node.fillGradient.stops.sort((a, b) => a.position - b.position);
    recordNodeComponentOverrides(node, ['fillGradient']);
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'remove-gradient-stop' && node?.fillGradient && !node.locked) {
    if (node.fillGradient.stops.length <= 2 || !node.fillGradient.stops.some(stop => stop.id === details.stopId)) return;
    checkpoint('Remove gradient stop');
    node.fillGradient.stops = node.fillGradient.stops.filter(stop => stop.id !== details.stopId);
    recordNodeComponentOverrides(node, ['fillGradient']);
    renderInspector(); queueSave(); renderer.invalidate();
  }
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
  } else if (action === 'export-svg' && node) {
    try { exportSelectedNodeSvg(node.id); } catch (error) { showToast(error.message || 'Could not export this layer as SVG.'); }
  } else if (action === 'create-component') makeComponent(node?.id);
  else if (action === 'combine-components') combineSelectedComponents();
  else if (action === 'create-component-property') addComponentProperty(details.componentId, details.targetId, details.propertyType);
  else if (action === 'choose-component-slot-content') openComponentSlotDialog(details.instanceId, details.propertyId);
  else if (action === 'reset-component-slot') resetComponentSlot(details.instanceId, details.propertyId);
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
    if (['close-overlay', 'back', 'open-link', 'set-variable-mode'].includes(state.prototypeAction)) {
      try {
        const selectedCollection = state.document.variableCollections?.find(item => item.id === state.prototypeVariableCollectionId) || state.document.variableCollections?.[0];
        const selectedMode = selectedCollection?.modes.find(mode => mode.id === state.prototypeVariableModeId) || defaultVariableMode(selectedCollection);
        const condition = buildPrototypeInteractionCondition();
        checkpoint(`Add ${state.prototypeAction} prototype interaction`);
        addPrototypeInteraction(state.document, node.id, null, {
          action: state.prototypeAction, trigger: state.prototypeTrigger,
          transition: state.prototypeTransition, easing: state.prototypeEasing, duration: state.prototypeDuration,
          condition,
          url: state.prototypeUrl,
          collectionId: selectedCollection?.id,
          modeId: selectedMode?.id
        });
        const label = state.prototypeAction === 'open-link' ? 'Open link' : state.prototypeAction === 'back' ? 'Back' : state.prototypeAction === 'set-variable-mode' ? 'Set variable mode' : 'Close overlay';
        renderInspector(); queueSave(); renderer.invalidate(); showToast(`${label} interaction added.`);
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
  else if (action === 'create-typography-style') {
    saveTypographyStyleFor(node?.id);
  }
  else if (action === 'edit-text' && node?.type === 'text') { closeMobilePanels(); editTextNode(node.id); }
  else if (action === 'reset-image' && node?.type === 'image') {
    checkpoint('Reset image'); node.adjustments = { brightness: 0, contrast: 0, saturation: 0, blur: 0 }; node.transforms = createImageTransforms(); node.fit = 'cover';
    recordNodeComponentOverrides(node, ['adjustments', 'transforms', 'fit']);
    schedulePreview(node, true); renderInspector(); queueSave();
  } else if (action === 'create-frame') { setTool('frame'); showToast('Drag on the canvas to create a frame.'); }
  else if (action === 'add-stroke') {
    if (!node) return; checkpoint('Add stroke'); node.stroke ||= '#1e1e1e'; node.strokeWidth ||= 1; renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'auto-layout-toggle') {
    if (!node || node.type !== 'frame') return;
    checkpoint(node.autoLayout ? 'Remove auto layout' : 'Add auto layout');
    if (node.autoLayout) {
      delete node.autoLayout;
      for (const property of Object.keys(node.variableBindings || {})) if (property.startsWith('autoLayout.')) delete node.variableBindings[property];
      if (!Object.keys(node.variableBindings || {}).length) delete node.variableBindings;
      recordNodeComponentOverrides(node, ['autoLayout', 'variableBindings']);
    }
    else { node.autoLayout = createAutoLayout(); applyAutoLayout(node); }
    renderInspector(); renderLayers(); renderer.invalidate(); queueSave();
  }
}

function updateImageEngineState(metrics) {
  const output = $('#bulk-speed-value');
  if (output && state.bulk) {
    output.textContent = `${state.bulk.concurrency} max worker${state.bulk.concurrency === 1 ? '' : 's'} · ${metrics.active} active`;
    output.title = `Estimated WASM working set: ${Math.round(metrics.activeRenderBytes / 1048576)} of ${Math.round(metrics.maxActiveRenderBytes / 1048576)} MiB; memory admission can lower actual parallelism.`;
  }
}

function toggleMobilePanel(panel) {
  if (innerWidth > 820) return;
  const left = $('#left-panel'); const right = $('#right-panel');
  const target = panel === 'left' ? left : right;
  const other = panel === 'left' ? right : left;
  const wasOpen = target.classList.contains('is-open');
  target.classList.toggle('is-open', !wasOpen);
  other.classList.remove('is-open');
  syncMobilePanelAccessibility();
  if (wasOpen) {
    (panel === 'left' ? $('#sidebar-toggle') : $('#inspector-toggle')).focus({ preventScroll: true });
    return;
  }
  const firstControl = target.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
  firstControl?.focus({ preventScroll: true });
}
function syncMobilePanelAccessibility() {
  const mobile = innerWidth <= 820;
  const scrim = $('#mobile-scrim');
  const panels = [
    { panel: $('#left-panel'), toggle: $('#sidebar-toggle'), name: 'layers' },
    { panel: $('#right-panel'), toggle: $('#inspector-toggle'), name: 'properties' }
  ];
  let anyOpen = false;
  for (const { panel, toggle, name } of panels) {
    const open = mobile && panel.classList.contains('is-open');
    const closed = mobile && !open;
    anyOpen ||= open;
    panel.inert = closed;
    panel.setAttribute('aria-hidden', String(closed));
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', `${open ? 'Close' : 'Open'} ${name}`);
    toggle.title = `${open ? 'Close' : 'Open'} ${name}`;
  }
  scrim.classList.toggle('is-visible', anyOpen);
}
function closeMobilePanels({ restoreFocus = true } = {}) {
  if (innerWidth > 820) return;
  const left = $('#left-panel'); const right = $('#right-panel');
  const wasLeftOpen = left.classList.contains('is-open');
  const wasRightOpen = right.classList.contains('is-open');
  left.classList.remove('is-open');
  right.classList.remove('is-open');
  syncMobilePanelAccessibility();
  if (restoreFocus && wasLeftOpen) $('#sidebar-toggle').focus({ preventScroll: true });
  else if (restoreFocus && wasRightOpen) $('#inspector-toggle').focus({ preventScroll: true });
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
      await switchToDocument(importedDocument, {
        message: 'Local design opened on this device.',
        beforeSwitch: async nextDocument => Object.assign(nextDocument, (await importLocalPackage(nextDocument, packageData.assets)).document)
      });
    } catch (error) { showToast(error.message || 'This file is not a valid local design package.'); }
    input.value = '';
  });
  $('#svg-input').addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    state.pendingImageImports += 1;
    try {
      if (state.documentTransitioning) throw new Error('Wait for the current design switch to finish before importing an SVG.');
      const { nodes, width, height } = importSvgToLayers(await file.text());
      if (!nodes.length) throw new Error('This SVG contains no editable vector layers.');
      const imported = nodes;
      const bounds = canvas.getBoundingClientRect();
      const center = screenToWorld({ clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }, canvas, state);
      checkpoint(`Import ${file.name}`);
      for (const node of imported) {
        walkNodes([node], entry => { entry.node.id = createId(entry.node.type); });
        const name = file.name.replace(/\.svg$/i, '').trim().slice(0, 120);
        if (name) node.name = name;
        node.x = center.x - width / 2;
        node.y = center.y - height / 2;
        addNode(state.document, node, { pageId: state.document.activePageId });
      }
      setSelection(imported.map(node => node.id));
      renderUI(); queueSave(); renderer.invalidate();
      showToast(`${file.name} imported as editable layers.`);
    } catch (error) {
      showToast(error.message || 'Could not import this SVG.');
    } finally {
      state.pendingImageImports -= 1;
      input.value = '';
    }
  });
  setZoomButtonHandlers();
  $('#document-name').addEventListener('change', event => { if (state.documentTransitioning) return; const name = event.currentTarget.value.trim() || 'Untitled'; checkpoint('Rename design'); state.document.name = name; renderUI(); queueSave(); });
  $('#add-page').addEventListener('click', addPage);
  $('#pages-list').addEventListener('click', event => { const row = event.target.closest('[data-page-id]'); if (!row) return; state.document.activePageId = row.dataset.pageId; state.selectedIds = []; state.selectedVectorPoint = null; state.pendingCommentAnchor = null; state.activeCommentId = null; renderUI(); });
  $('#pages-list').addEventListener('dblclick', event => { const row = event.target.closest('[data-page-id]'); if (row) renamePage(row.dataset.pageId); });
  $('#layer-select-mode').addEventListener('click', () => {
    state.layerSelectionMode = !state.layerSelectionMode;
    if (state.layerSelectionMode) setSelection(selectedNodes().filter(node => node.type === 'image').map(node => node.id));
    else renderLayers();
  });
  $('#layers-list').addEventListener('click', event => {
    const row = event.target.closest('[data-layer-id]'); if (!row) return;
    const node = findNode(state.document, row.dataset.layerId)?.node; if (!node) return;
    const moveControl = event.target.closest('[data-action="layer-move-up"], [data-action="layer-move-down"]');
    if (moveControl) {
      if (moveControl.disabled || state.layerSelectionMode) return;
      const direction = moveControl.dataset.action === 'layer-move-up' ? 'up' : 'down';
      checkpoint(`Move layer ${direction}`);
      if (moveLayerOneVisualRow(state.document, node.id, direction)) {
        setSelection([node.id]); renderUI(); queueSave(); renderer.invalidate();
      }
      return;
    }
    if (event.target.closest('[data-action="visibility"]')) { checkpoint('Toggle visibility'); setNodePropertyValue(node, 'visible', !getNodePropertyValue(state.document, node, 'visible')); renderUI(); queueSave(); return; }
    if (state.layerSelectionMode) {
      if (node.type !== 'image') { showToast('Image selection mode only selects image layers.'); return; }
      const selectedImages = selectedNodes().filter(item => item.type === 'image').map(item => item.id);
      setSelection(selectedImages.includes(node.id) ? selectedImages.filter(id => id !== node.id) : [...selectedImages, node.id]);
      state.lastLayerSelection = node.id;
      return;
    }
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
    if (state.documentTransitioning) return;
    const imageTransformField = event.target.closest('[data-image-transform-field]');
    if (imageTransformField) { updateImageTransformInput(imageTransformField); return; }
    const imageFillField = event.target.closest('[data-image-fill-field]');
    if (imageFillField) { updateImageFillInput(imageFillField); return; }
    const gradientField = event.target.closest('[data-gradient-field]');
    if (gradientField) { updateGradientInput(gradientField); return; }
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
    if (event.target.id === 'prototype-condition-value') state.prototypeConditionValue = event.target.value;
    if (event.target.id === 'prototype-overlay-opacity') state.prototypeOverlayBackgroundOpacity = Number(event.target.value) / 100;
  });
  $('#inspector-content').addEventListener('change', event => {
    if (state.documentTransitioning) return;
    if (event.target.id === 'prototype-condition-value') { state.prototypeConditionValue = event.target.value; return; }
    if (event.target.id === 'prototype-condition-operator') { state.prototypeConditionOperator = event.target.value; return; }
    if (event.target.id === 'prototype-condition-variable') {
      state.prototypeConditionVariableId = event.target.value || null;
      const variable = state.document.variables?.find(item => item.id === state.prototypeConditionVariableId);
      state.prototypeConditionValue = variable ? String(resolveVariableValue(state.document, variable.id)) : null;
      renderInspector();
      return;
    }
    if (event.target.matches('[data-image-transform-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-image-fill-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-gradient-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-effect-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-network-face-fill], [data-network-face-opacity]')) { finishInspectorInput(); return; }
    const guideField = event.target.closest('[data-guide-field]');
    if (guideField) { updateLayoutGuide(guideField, true); return; }
    const exportField = event.target.closest('[data-export-field]');
    if (exportField) { updateExportSetting(exportField); return; }
    if (event.target.matches('[data-prop="fontFamily"]') && !event.target.value.trim()) {
      event.target.value = selectedNodes()[0]?.fontFamily || 'Inter, Arial, sans-serif';
      finishInspectorInput();
      return;
    }
    if (event.target.matches('[data-prop]')) finishInspectorInput();
    if (event.target.matches('[data-variable-binding]')) applyColorVariableToSelection(event.target.value, event.target.dataset.variableBinding);
    if (event.target.matches('[data-variable-property-binding]')) applyVariablePropertyToSelection(event.target.dataset.variablePropertyBinding, event.target.value);
    if (event.target.matches('[data-frame-variable-mode]')) {
      const frame = selectedNodes()[0];
      if (frame?.type === 'frame') {
        checkpoint('Set frame variable mode');
        setFrameVariableMode(state.document, frame.id, event.target.dataset.frameVariableMode, event.target.value || null);
        resizeTextLayers([frame]);
        relayoutVariableBoundFrames();
        const instanceRoot = componentInstanceRoot(frame.id);
        if (instanceRoot) recordComponentOverride(instanceRoot, frame, 'variableModes');
        renderUI(); queueSave(); renderer.invalidate();
      }
    }
    if (event.target.id === 'component-property-target') {
      state.componentPropertyTargetId = event.target.value;
      renderInspector();
    }
    if (event.target.id === 'component-property-type') {
      state.componentPropertyType = event.target.value;
      renderInspector();
    }
    if (event.target.matches('[data-component-property-value]')) {
      const instanceId = event.target.dataset.instanceId;
      const propertyId = event.target.dataset.componentPropertyValue;
      const instance = findNode(state.document, instanceId)?.node;
      const property = state.document.components?.find(item => item.id === instance?.componentId)?.componentProperties?.find(item => item.id === propertyId);
      const value = property?.type === 'BOOLEAN' ? event.target.checked : event.target.value;
      changeInstanceComponentProperty(instanceId, propertyId, value);
    }
    if (event.target.matches('[data-variant-property]')) changeInstanceVariant(event.target.dataset.instanceId, event.target.dataset.variantProperty, event.target.value);
    if (event.target.matches('[data-variant-master-property]')) changeMainVariantProperty(event.target.dataset.componentId, event.target.dataset.variantMasterProperty, event.target.value);
    if (event.target.id === 'prototype-action') {
      state.prototypeAction = event.target.value;
      if (state.prototypeAction !== 'navigate' && state.prototypeTransition === 'smart-animate') state.prototypeTransition = 'dissolve';
      if (state.prototypeAction === 'set-variable-mode') {
        const collection = state.document.variableCollections?.find(item => item.id === state.prototypeVariableCollectionId) || state.document.variableCollections?.[0];
        state.prototypeVariableCollectionId = collection?.id || null;
        state.prototypeVariableModeId = defaultVariableMode(collection)?.id || null;
      }
      renderInspector();
    }
    if (event.target.id === 'prototype-variable-collection') {
      state.prototypeVariableCollectionId = event.target.value;
      state.prototypeVariableModeId = defaultVariableMode(state.document.variableCollections?.find(item => item.id === event.target.value))?.id || null;
      renderInspector();
    }
    if (event.target.id === 'prototype-variable-mode') state.prototypeVariableModeId = event.target.value;
    if (event.target.id === 'prototype-trigger') state.prototypeTrigger = event.target.value;
    if (event.target.id === 'prototype-url') state.prototypeUrl = event.target.value;
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
    relayoutVariableBoundFrames();
    renderer.invalidate();
  });
  $('#variable-collections-list').addEventListener('change', event => {
    const alias = event.target.closest('[data-variable-alias]');
    if (alias) {
      const variable = state.document.variables?.find(item => item.id === alias.dataset.variableAlias);
      checkpoint(`Change ${variable?.name || 'variable'} alias`);
      if (!setVariableAlias(state.document, alias.dataset.variableAlias, alias.value || null, alias.dataset.modeId)) showToast('Aliases must target another variable of the same type and cannot create a cycle.');
      resizeTextLayers(state.document.pages.flatMap(page => page.children));
      relayoutVariableBoundFrames();
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
  $('#text-styles-list').addEventListener('click', event => {
    const action = event.target.closest('[data-text-style-action]');
    if (action) {
      if (action.dataset.textStyleAction === 'update') updateTypographyStyleFromSelection(action.dataset.textStyleId);
      else if (action.dataset.textStyleAction === 'delete') removeTypographyStyleFromAssets(action.dataset.textStyleId);
      return;
    }
    const style = event.target.closest('[data-typography-style-id]');
    if (style) applyTypographyStyleToSelection(style.dataset.typographyStyleId);
  });
  $('#file-menu-button').addEventListener('click', event => openFileMenu(event.clientX || 72, event.clientY || 45));
  $('#main-menu-button').addEventListener('click', event => openFileMenu(event.clientX || 18, event.clientY || 45));
  $('#canvas-menu').addEventListener('click', event => openFileMenu(event.clientX || innerWidth - 36, event.clientY || 50));
  $('#design-library-close').addEventListener('click', () => $('#design-library-dialog').close());
  $('#design-library-export').addEventListener('click', exportDesign);
  $('#design-library-new').addEventListener('click', async () => {
    $('#design-library-dialog').close();
    await newDesign();
  });
  $('#design-library-list').addEventListener('click', event => {
    const button = event.target.closest('[data-design-action]');
    if (button) void handleDesignLibraryAction(button.dataset.designAction, button.dataset.designId);
  });
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
    queueSave(); renderInspector(); showToast(`Recipe “${recipe.name}” saved. Use Image recipes to apply it.`);
  });
  $('#recipe-form').addEventListener('submit', event => { if (event.submitter?.value === 'save') $('#recipe-dialog').returnValue = 'save'; });
  $('#component-slot-search').addEventListener('input', event => {
    if (!state.componentSlotDialog) return;
    state.componentSlotDialog.query = event.currentTarget.value;
    renderComponentSlotCandidateList();
  });
  $('#component-slot-candidates').addEventListener('change', event => {
    const checkbox = event.target.closest('[data-slot-candidate]');
    if (!checkbox || !state.componentSlotDialog) return;
    if (checkbox.checked) state.componentSlotDialog.selectedIds.add(checkbox.dataset.slotCandidate);
    else state.componentSlotDialog.selectedIds.delete(checkbox.dataset.slotCandidate);
  });
  $('#component-slot-form').addEventListener('submit', event => {
    if (!['apply', 'cancel'].includes(event.submitter?.value)) event.preventDefault();
  });
  $('#component-slot-dialog').addEventListener('close', () => {
    const dialogState = state.componentSlotDialog;
    state.componentSlotDialog = null;
    if ($('#component-slot-dialog').returnValue === 'apply') applyComponentSlotDialog(dialogState);
  });
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
  $('#mobile-scrim').addEventListener('click', () => closeMobilePanels());
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#context-menu') && !event.target.closest('#file-menu-button') && !event.target.closest('#main-menu-button')) closeMenu(); });
  document.addEventListener('keydown', onKeyDown);
  initRichTextEditorEvents();
  installLayerReorder($('#layers-list'), {
    getDocument: () => state.document,
    getPageId: () => state.document.activePageId,
    canStart: () => !state.layerSelectionMode && !state.layerSearch.trim(),
    beforeChange: () => checkpoint('Reorder layers'),
    onChange: () => { renderUI(); queueSave(); renderer.invalidate(); }
  });
}

function onKeyDown(event) {
  if (state.documentTransitioning) return;
  if (event.key.toLowerCase() === 'escape' && innerWidth <= 820
    && ($('#left-panel').classList.contains('is-open') || $('#right-panel').classList.contains('is-open'))
    && !document.querySelector('dialog[open]')) {
    closeMobilePanels();
    event.preventDefault();
    return;
  }
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
  if (mod && key === 'c') { event.preventDefault(); copySelected(); return; }
  if (mod && key === 'x') { event.preventDefault(); cutSelected(); return; }
  if (mod && key === 'v') { event.preventDefault(); pasteSelectedLayers(); return; }
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
    for (const node of selectedNodes()) {
      const geometry = resolvedGeometry(node);
      setNodePropertyValue(node, 'x', geometry.x + dx);
      setNodePropertyValue(node, 'y', geometry.y + dy);
    }
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
  initEvents(); renderUI(); state.ready = true;
  try { await restoreImageAssets(); } catch (error) { showToast(error.message); }
  if (!await loadLatestDocument().catch(() => null)) await persistCurrentDocumentNow();
  else setSaveState('saved', 'Saved locally');
  document.documentElement.dataset.appReady = 'true';
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', () => { syncMobilePanelAccessibility(); renderer.invalidate(); });
  window.addEventListener('beforeunload', () => { imageEngine.destroy(); for (const item of state.assets.values()) { item.bitmap?.close?.(); if (item.bitmapUrl) URL.revokeObjectURL(item.bitmapUrl); } for (const bitmap of state.previews.values()) bitmap.close?.(); });
}

syncMobilePanelAccessibility();
boot();
