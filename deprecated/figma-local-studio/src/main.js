import { activePage, createInitialProject, createNode, descendants, findNode, serializeProject, validateProject } from './model.js';
import { LocalImageEngine } from './image-engine.js';
import { deleteImageAsset, listImageAssetIds, loadImageAsset, saveImageAsset } from './storage.js';
import { packProject, unpackProjectPackage } from './project-package.js';
import { CanvasRenderer } from './renderer.js';

const STORAGE_KEY = 'local-studio-project-v1';
const canvas = document.querySelector('#design-canvas');
const renderer = new CanvasRenderer(canvas);
const imageEngine = new LocalImageEngine();
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let project = loadProject();
let selectedId = activePage(project).nodes[0]?.id ?? null;
let currentTool = 'select';
let pointer = null;
let spaceHeld = false;
let toastTimer = 0;
let undoStack = [];
let redoStack = [];
let imageMemory = new Map();
let imageVersions = new Map();
let imageTimers = new Map();

function loadProject() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (validateProject(value)) return value;
  } catch { /* Start with a clean local document when the saved copy is invalid. */ }
  return createInitialProject();
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, serializeProject(project)); $('#save-state').textContent = 'Saved locally'; }
  catch { $('#save-state').textContent = 'Storage full'; }
}

function snapshot() {
  snapshotFrom(serializeProject(project));
}

function snapshotFrom(serialized) {
  undoStack.push(serialized);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}

function imageIdsFromHistory(history) {
  const ids = new Set();
  for (const serialized of history) {
    try {
      const saved = JSON.parse(serialized);
      for (const page of saved.pages || []) for (const node of page.nodes || []) if (node.type === 'image') ids.add(node.id);
    } catch { /* Bad history entries are not retained as image owners. */ }
  }
  return ids;
}

function pruneImageMemory() {
  const keep = new Set(project.pages.flatMap(page => page.nodes.filter(node => node.type === 'image').map(node => node.id)));
  for (const id of imageIdsFromHistory([...undoStack, ...redoStack])) keep.add(id);
  for (const [id, image] of imageMemory) if (!keep.has(id)) {
    clearTimeout(imageTimers.get(id)); imageVersions.set(id, (imageVersions.get(id) || 0) + 1);
    image.previewBitmap?.close?.(); imageEngine.dispose(id); imageMemory.delete(id);
    void deleteImageAsset(id).catch(() => {});
  }
}

function commit() { persist(); renderAll(); pruneImageMemory(); }

function renderAll() {
  renderer.selectionId = selectedId;
  renderer.setProject(project);
  $('#file-name').value = project.name;
  const page = activePage(project);
  $('#page-name').textContent = page.name;
  renderLayers(page.nodes);
  renderInspector(findNode(project, selectedId));
  $('#zoom-value').textContent = `${Math.round(renderer.zoom * 100)}%`;
  $('#selection-status').textContent = findNode(project, selectedId)?.name ?? 'No selection';
  $('#canvas-hint').classList.toggle('hidden', page.nodes.length > 1 || (page.nodes.length === 1 && page.nodes[0].type !== 'frame'));
}

function renderLayers(nodes) {
  const list = $('#layer-list');
  list.replaceChildren();
  [...nodes].reverse().forEach(node => {
    const row = document.createElement('button');
    row.className = `layer-row${node.id === selectedId ? ' selected' : ''}`;
    row.dataset.nodeId = node.id; row.setAttribute('role', 'treeitem');
    const icon = { frame: '▣', rect: '▱', ellipse: '◯', image: '▧', text: 'T', pen: '⌁' }[node.type] || '◇';
    row.innerHTML = `<span class="layer-icon ${node.type}">${icon}</span><span class="layer-label"></span><span class="layer-visibility">◉</span>`;
    row.querySelector('.layer-label').textContent = node.name;
    row.addEventListener('click', () => { selectedId = node.id; renderAll(); });
    row.addEventListener('dblclick', () => renameNode(node));
    list.append(row);
  });
}

function renderInspector(node) {
  $('#selection-name').textContent = node?.name ?? 'Canvas';
  $('#selection-description').textContent = node ? `${node.type[0].toUpperCase()}${node.type.slice(1)} · ${Math.round(node.w)} × ${Math.round(node.h)}` : 'Select a layer or create a frame to start designing.';
  $('#dimensions-section').classList.toggle('muted', !node);
  $('#appearance-section').hidden = node?.type === 'image';
  $('#text-section').hidden = node?.type !== 'text';
  $('#image-section').hidden = node?.type !== 'image';
  for (const [id, key] of [['x', 'x'], ['y', 'y'], ['w', 'w'], ['h', 'h'], ['radius', 'radius']]) $(`#prop-${id}`).value = node?.[key] ?? 0;
  $('#prop-opacity').value = Math.round((node?.opacity ?? 1) * 100);
  $('#prop-fill').value = colorForInput(node?.fill);
  $('#fill-hex').value = colorForHex(node?.fill);
  $('#prop-stroke').value = colorForInput(node?.stroke);
  $('#stroke-hex').value = colorForHex(node?.stroke);
  $('#prop-text').value = node?.text ?? '';
  $('#prop-font-size').value = node?.fontSize ?? 32;
  $('#prop-font-weight').value = String(node?.fontWeight ?? 400);
  if (node?.type === 'image') {
    $('#image-source-name').textContent = node.sourceName || 'Image';
    $('#image-engine-status').textContent = node.imageStatus || 'Original held in this tab; adjustments run locally.';
    for (const key of ['brightness', 'contrast', 'saturation', 'blur']) {
      const input = $(`[data-adjustment="${key}"]`), value = Number(node.adjustments?.[key] || 0);
      input.value = value;
      $(`#${key}-value`).value = key === 'blur' ? `${value} px` : String(value);
    }
  }
}

function colorForInput(value) { return /^#[\da-f]{6}$/i.test(value || '') ? value : '#d9d9d9'; }
function colorForHex(value) { return /^#[\da-f]{6}$/i.test(value || '') ? value.toUpperCase() : 'None'; }

function setTool(tool) {
  currentTool = tool;
  $$('.tool-button').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  canvas.dataset.tool = tool;
}

function addNode(type, values = {}) {
  snapshot();
  const node = createNode(type, values);
  activePage(project).nodes.push(node);
  selectedId = node.id;
  commit();
  return node;
}

function updateImageStatus(node, message) {
  node.imageStatus = message;
  if (selectedId === node.id) $('#image-engine-status').textContent = message;
}

function scheduleImageRender(node, immediate = false) {
  const version = (imageVersions.get(node.id) || 0) + 1;
  imageVersions.set(node.id, version);
  clearTimeout(imageTimers.get(node.id));
  updateImageStatus(node, 'Updating preview in local WebAssembly…');
  const run = async () => {
    try {
      const result = await imageEngine.render(node);
      const bitmap = await createImageBitmap(new Blob([result.bytes], { type: 'image/png' }));
      if (imageVersions.get(node.id) !== version || !findNode(project, node.id)) { bitmap.close(); return; }
      const oldBitmap = node.previewBitmap;
      node.previewBitmap = bitmap;
      node.sourceWidth = result.width; node.sourceHeight = result.height;
      if (node.fitSourceOnLoad) {
        const scale = Math.min(1, 580 / result.width, 520 / result.height);
        const width = Math.max(1, Math.round(result.width * scale)), height = Math.max(1, Math.round(result.height * scale));
        const centerX = node.x + node.w / 2, centerY = node.y + node.h / 2;
        node.x = Math.round(centerX - width / 2); node.y = Math.round(centerY - height / 2);
        node.w = width; node.h = height; node.fitSourceOnLoad = false;
      }
      oldBitmap?.close?.();
      imageMemory.set(node.id, { sourceBytes: node.sourceBytes, previewBitmap: bitmap, sourceName: node.sourceName, sourceType: node.sourceType });
      updateImageStatus(node, 'Updated · Pillow-RS WASM');
      renderer.render(project);
      if (selectedId === node.id) {
        $('#selection-description').textContent = `Image · ${result.width} × ${result.height}`;
        $('#prop-x').value = node.x; $('#prop-y').value = node.y; $('#prop-w').value = node.w; $('#prop-h').value = node.h;
      }
      persist();
    } catch (error) {
      updateImageStatus(node, error?.message || 'The local image could not be processed.');
    }
  };
  const timer = setTimeout(run, immediate ? 0 : 70);
  imageTimers.set(node.id, timer);
}

async function importImages(files) {
  const values = [...files];
  if (!values.length) return;
  const previousProject = serializeProject(project);
  const center = renderer.toWorld(renderer.width / 2, renderer.height / 2);
  const added = [];
  for (let index = 0; index < values.length; index++) {
    const file = values[index];
    if (file.size < 1 || file.size > 100 * 1024 * 1024) { showToast(`${file.name}: images must be under 100 MB.`); continue; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const node = createNode('image', {
      name: file.name.replace(/\.[^.]+$/, '') || 'Image',
      x: Math.round(center.x - 160 + index * 24), y: Math.round(center.y - 120 + index * 24),
      sourceName: file.name, sourceType: file.type || 'image/unknown', assetId: null,
      sourceBytes: bytes, fitSourceOnLoad: true,
      adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 }
    });
    node.assetId = node.id;
    activePage(project).nodes.push(node);
    imageMemory.set(node.id, { sourceBytes: bytes, sourceName: file.name, sourceType: node.sourceType });
    added.push(node);
    try { await saveImageAsset(node.id, bytes, file.name, node.sourceType); }
    catch { showToast(`${file.name}: editing works in this tab, but local image storage is unavailable.`); }
  }
  if (!added.length) return;
  snapshotFrom(previousProject);
  selectedId = added.at(-1).id;
  commit();
  for (const node of added) scheduleImageRender(node, true);
}

function restoreImageRuntime() {
  for (const page of project.pages) for (const node of page.nodes) if (node.type === 'image') {
    const memory = imageMemory.get(node.id);
    if (memory) Object.assign(node, memory);
    if (node.sourceBytes && !node.previewBitmap) scheduleImageRender(node, true);
  }
}

async function restoreStoredImages() {
  const imageNodes = project.pages.flatMap(page => page.nodes.filter(node => node.type === 'image'));
  for (const node of imageNodes) {
    if (imageMemory.has(node.id)) continue;
    try {
      const saved = await loadImageAsset(node.assetId || node.id);
      if (!saved) { updateImageStatus(node, 'The local image file is missing. Re-import it to continue.'); continue; }
      node.sourceBytes = saved.bytes; node.sourceName = saved.name; node.sourceType = saved.type;
      imageMemory.set(node.id, { sourceBytes: saved.bytes, sourceName: saved.name, sourceType: saved.type });
      scheduleImageRender(node, true);
    } catch (error) { updateImageStatus(node, error?.message || 'Local image storage is unavailable.'); }
  }
  try {
    const retained = new Set(imageNodes.map(node => node.assetId || node.id));
    for (const id of await listImageAssetIds()) if (!retained.has(id)) await deleteImageAsset(id);
  } catch { /* Editing remains available if local asset cleanup is blocked. */ }
}

function renameNode(node) {
  const label = document.createElement('input'); label.className = 'layer-rename'; label.value = node.name;
  const row = $(`[data-node-id="${CSS.escape(node.id)}"]`); row?.querySelector('.layer-label')?.replaceWith(label);
  label.focus(); label.select();
  const save = () => { const value = label.value.trim(); if (value) { snapshot(); node.name = value; commit(); } else renderAll(); };
  label.addEventListener('keydown', event => { if (event.key === 'Enter') label.blur(); if (event.key === 'Escape') renderAll(); });
  label.addEventListener('blur', save, { once: true });
}

function deleteSelection() {
  const page = activePage(project), node = findNode(project, selectedId);
  if (!node) return;
  snapshot();
  const removeIds = new Set([node.id, ...descendants(page.nodes, node.id).map(item => item.id)]);
  for (const removed of page.nodes) if (removeIds.has(removed.id) && removed.type === 'image') {
    clearTimeout(imageTimers.get(removed.id)); imageVersions.set(removed.id, (imageVersions.get(removed.id) || 0) + 1); imageEngine.dispose(removed.id);
  }
  page.nodes = page.nodes.filter(item => !removeIds.has(item.id));
  selectedId = null; commit();
}

function resizeHandle(node, screenX, screenY) {
  const topLeft = renderer.toScreen(node.x, node.y);
  const right = topLeft.x + node.w * renderer.zoom, bottom = topLeft.y + node.h * renderer.zoom;
  const handles = { nw: [topLeft.x, topLeft.y], ne: [right, topLeft.y], sw: [topLeft.x, bottom], se: [right, bottom] };
  for (const [name, [x, y]] of Object.entries(handles)) if (Math.abs(screenX - x) <= 9 && Math.abs(screenY - y) <= 9) return name;
  return null;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportProject() {
  try {
    const assets = new Map();
    for (const page of project.pages) for (const node of page.nodes) if (node.type === 'image') {
      let bytes = node.sourceBytes ?? imageMemory.get(node.id)?.sourceBytes;
      if (!(bytes instanceof Uint8Array)) bytes = (await loadImageAsset(node.assetId || node.id))?.bytes;
      if (!(bytes instanceof Uint8Array)) throw new Error(`Re-import “${node.sourceName || node.name}” before exporting this file.`);
      assets.set(node.assetId || node.id, bytes);
    }
    const blob = packProject(project, assets);
    downloadBlob(blob, `${project.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'design'}.localdesign`);
  } catch (error) { showToast(error?.message || 'Could not export this design.'); }
}
function exportSelection() {
  const node = findNode(project, selectedId); if (!node) return showToast('Select an object to export.');
  const width = Math.ceil(node.w), height = Math.ceil(node.h), output = document.createElement('canvas'); output.width = width; output.height = height;
  const ctx = output.getContext('2d');
  ctx.fillStyle = node.fill || 'transparent';
  if (node.type === 'image') {
    const bitmap = node.previewBitmap ?? node.sourceBitmap;
    if (!bitmap) return showToast('Wait for the local image preview before exporting.');
    ctx.drawImage(bitmap, 0, 0, width, height);
  }
  else if (node.type === 'ellipse') { ctx.beginPath(); ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2); ctx.fill(); }
  else if (node.type === 'text') { ctx.fillStyle = node.fill; ctx.font = `${node.fontWeight} ${node.fontSize}px system-ui`; ctx.fillText(node.text || '', 0, node.fontSize); }
  else { ctx.beginPath(); ctx.roundRect(0, 0, width, height, node.radius || 0); if (node.fill !== 'none') ctx.fill(); if (node.strokeWidth) { ctx.strokeStyle = node.stroke; ctx.lineWidth = node.strokeWidth; ctx.stroke(); } }
  output.toBlob(blob => blob && downloadBlob(blob, `${node.name.toLowerCase().replace(/[^\w-]+/g, '-')}.png`), 'image/png');
}

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
  if (spaceHeld || currentTool === 'hand') { pointer = { mode: 'pan', x, y, panX: renderer.panX, panY: renderer.panY }; return; }
  if (currentTool === 'select' || currentTool === 'comment') {
    const selected = findNode(project, selectedId), handle = selected ? resizeHandle(selected, x, y) : null;
    const node = handle ? selected : renderer.hitTest(x, y);
    selectedId = node?.id ?? null;
    pointer = node ? { mode: handle ? 'resize' : 'move', handle, node, start: renderer.toWorld(x, y), x: node.x, y: node.y, w: node.w, h: node.h, moved: false } : null;
    renderAll(); return;
  }
  const world = renderer.toWorld(x, y);
  if (currentTool === 'text') { const node = addNode('text', { x: Math.round(world.x), y: Math.round(world.y) }); $('#prop-text').focus(); $('#prop-text').select(); return; }
  if (currentTool === 'pen') { showToast('Pen paths are coming in the vector tools phase.'); return; }
  const type = currentTool === 'frame' ? 'frame' : currentTool;
  pointer = { mode: 'draw', type, start: world, x, y };
  renderer.draft = createNode(type, { x: Math.round(world.x), y: Math.round(world.y), w: 1, h: 1 });
});

canvas.addEventListener('pointermove', event => {
  if (!pointer) return;
  const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
  if (pointer.mode === 'pan') { renderer.panX = pointer.panX + x - pointer.x; renderer.panY = pointer.panY + y - pointer.y; renderer.render(project); return; }
  const world = renderer.toWorld(x, y);
  if (pointer.mode === 'move') {
    const dx = Math.round(world.x - pointer.start.x), dy = Math.round(world.y - pointer.start.y);
    if ((dx || dy) && !pointer.moved) { snapshot(); pointer.moved = true; }
    pointer.node.x = pointer.x + dx; pointer.node.y = pointer.y + dy;
    renderer.render(project); return;
  }
  if (pointer.mode === 'resize') {
    const dx = world.x - pointer.start.x, dy = world.y - pointer.start.y;
    if ((Math.round(dx) || Math.round(dy)) && !pointer.moved) { snapshot(); pointer.moved = true; }
    const west = pointer.handle.includes('w'), north = pointer.handle.includes('n');
    const rawW = pointer.w + (west ? -dx : dx), rawH = pointer.h + (north ? -dy : dy);
    pointer.node.w = Math.max(1, Math.round(rawW)); pointer.node.h = Math.max(1, Math.round(rawH));
    pointer.node.x = west ? pointer.x + pointer.w - pointer.node.w : pointer.x;
    pointer.node.y = north ? pointer.y + pointer.h - pointer.node.h : pointer.y;
    renderer.render(project); return;
  }
  if (pointer.mode === 'draw') {
    renderer.draft.x = Math.min(pointer.start.x, world.x); renderer.draft.y = Math.min(pointer.start.y, world.y);
    renderer.draft.w = Math.max(1, Math.abs(world.x - pointer.start.x)); renderer.draft.h = Math.max(1, Math.abs(world.y - pointer.start.y)); renderer.render(project);
  }
});

canvas.addEventListener('pointerup', () => {
  if (!pointer) return;
  if ((pointer.mode === 'move' || pointer.mode === 'resize') && pointer.moved) commit();
  if (pointer.mode === 'draw') {
    const draft = renderer.draft; renderer.draft = null;
    if (draft.w > 3 && draft.h > 3) addNode(pointer.type, { x: Math.round(draft.x), y: Math.round(draft.y), w: Math.round(draft.w), h: Math.round(draft.h), name: pointer.type === 'frame' ? `Frame ${activePage(project).nodes.filter(node => node.type === 'frame').length + 1}` : undefined });
    else renderer.render(project);
  }
  pointer = null;
});

canvas.addEventListener('wheel', event => {
  if (event.ctrlKey || event.metaKey) { event.preventDefault(); const rect = canvas.getBoundingClientRect(); renderer.setZoom(renderer.zoom * (event.deltaY < 0 ? 1.1 : 0.9), { x: event.clientX - rect.left, y: event.clientY - rect.top }); renderAll(); }
}, { passive: false });

$$('.tool-button').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.tool === 'image') { setTool('select'); $('#image-input').click(); }
  else setTool(button.dataset.tool);
}));
$('#zoom-in').addEventListener('click', () => { renderer.setZoom(renderer.zoom * 1.2); renderAll(); });
$('#zoom-out').addEventListener('click', () => { renderer.setZoom(renderer.zoom / 1.2); renderAll(); });
$('#zoom-value').addEventListener('click', () => { renderer.fitTo(activePage(project).nodes.find(node => node.type === 'frame')); renderAll(); });
$('#undo').addEventListener('click', () => { if (!undoStack.length) return; redoStack.push(serializeProject(project)); project = JSON.parse(undoStack.pop()); if (selectedId && !findNode(project, selectedId)) selectedId = null; restoreImageRuntime(); commit(); });
$('#redo').addEventListener('click', () => { if (!redoStack.length) return; undoStack.push(serializeProject(project)); project = JSON.parse(redoStack.pop()); if (selectedId && !findNode(project, selectedId)) selectedId = null; restoreImageRuntime(); commit(); });
$('#file-name').addEventListener('change', event => { snapshot(); project.name = event.target.value.trim() || 'Untitled'; commit(); });
$('#add-page').addEventListener('click', () => { snapshot(); const page = { id: `page-${Date.now()}`, name: `Page ${project.pages.length + 1}`, nodes: [] }; project.pages.push(page); project.activePageId = page.id; selectedId = null; commit(); });
$('#share').addEventListener('click', () => showToast('This file is local to this device. Sharing is not connected yet.'));
$('#present').addEventListener('click', () => showToast('Presentation mode is coming in the prototype phase.'));
$('#toggle-left').addEventListener('click', () => $('.left-panel').classList.toggle('collapsed'));
$('#export-selection').addEventListener('click', exportSelection);
$('#export-add').addEventListener('click', exportProject);
$('#help-button').addEventListener('click', () => showToast('Local Studio · Keyboard shortcuts: V, F, R, O, T, H'));
$('#search-layers').addEventListener('click', () => showToast('Layer search is coming soon.'));
$('#layer-options').addEventListener('click', exportProject);

for (const id of ['x', 'y', 'w', 'h', 'radius', 'opacity', 'font-size', 'font-weight']) {
  $(`#prop-${id}`).addEventListener('change', event => {
    const node = findNode(project, selectedId); if (!node) return;
    snapshot(); const key = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = Number(event.target.value); node[key] = key === 'opacity' ? value / 100 : value; commit();
  });
}
const colorEditBefore = new Map();
for (const [inputId, field, hexId] of [['prop-fill', 'fill', 'fill-hex'], ['prop-stroke', 'stroke', 'stroke-hex']]) {
  $(`#${inputId}`).addEventListener('input', event => { const node = findNode(project, selectedId); if (!node) return; if (!colorEditBefore.has(field)) colorEditBefore.set(field, serializeProject(project)); node[field] = event.target.value; $(`#${hexId}`).value = event.target.value.toUpperCase(); renderer.render(project); });
  $(`#${inputId}`).addEventListener('change', () => { if (colorEditBefore.has(field)) snapshotFrom(colorEditBefore.get(field)); colorEditBefore.delete(field); persist(); renderAll(); });
  $(`#${hexId}`).addEventListener('change', event => { const value = event.target.value.trim(); if (!/^#[\da-f]{6}$/i.test(value)) return showToast('Enter a six-digit hex color.'); const node = findNode(project, selectedId); if (!node) return; snapshot(); node[field] = value; commit(); });
}
let textEditBefore = null;
$('#prop-text').addEventListener('input', event => { const node = findNode(project, selectedId); if (node?.type === 'text') { if (textEditBefore === null) textEditBefore = serializeProject(project); node.text = event.target.value; renderer.render(project); } });
$('#prop-text').addEventListener('change', () => { if (textEditBefore !== null) snapshotFrom(textEditBefore); textEditBefore = null; persist(); renderAll(); });

const adjustmentBefore = new Map();
$$('[data-adjustment]').forEach(input => {
  input.addEventListener('input', () => {
  const node = findNode(project, selectedId);
  if (node?.type !== 'image') return;
  const key = input.dataset.adjustment, value = Number(input.value);
  if (node.adjustments[key] === value) return;
  if (!adjustmentBefore.has(key)) adjustmentBefore.set(key, serializeProject(project));
  node.adjustments[key] = value;
  $(`#${key}-value`).value = key === 'blur' ? `${value} px` : String(value);
  scheduleImageRender(node);
  });
  input.addEventListener('change', () => {
    const key = input.dataset.adjustment, before = adjustmentBefore.get(key);
    if (before) snapshotFrom(before);
    adjustmentBefore.delete(key); persist(); pruneImageMemory();
  });
});
$('#reset-image-adjustments').addEventListener('click', () => {
  const node = findNode(project, selectedId); if (node?.type !== 'image') return;
  snapshot(); node.adjustments = { brightness: 0, contrast: 0, saturation: 0, blur: 0 };
  renderInspector(node); scheduleImageRender(node); persist();
});

window.addEventListener('keydown', event => {
  if (event.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { spaceHeld = true; canvas.classList.add('panning'); event.preventDefault(); }
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); (event.shiftKey ? $('#redo') : $('#undo')).click(); return; }
  if (command && event.key.toLowerCase() === 's') { event.preventDefault(); persist(); showToast('Saved on this device.'); return; }
  if (command && event.key.toLowerCase() === 'o') { event.preventDefault(); $('#import-file').click(); return; }
  if (command && event.key.toLowerCase() === 'e') { event.preventDefault(); exportProject(); return; }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (event.key === 'Delete' || event.key === 'Backspace') deleteSelection();
  if (event.key === 'Escape') { selectedId = null; setTool('select'); renderAll(); }
  const shortcuts = { v: 'select', f: 'frame', r: 'rect', o: 'ellipse', t: 'text', p: 'pen', h: 'hand' };
  if (!command && shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]);
});
window.addEventListener('keyup', event => { if (event.code === 'Space') { spaceHeld = false; canvas.classList.remove('panning'); } });
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const raw = new Uint8Array(await file.arrayBuffer());
    let parsed, assets = new Map();
    if (new TextDecoder().decode(raw.subarray(0, 21)) === 'LOCALSTUDIO-DESIGN/1\n') {
      const unpacked = unpackProjectPackage(raw); parsed = unpacked.project; assets = unpacked.assets;
    } else parsed = JSON.parse(new TextDecoder().decode(raw));
    if (!validateProject(parsed)) throw new Error('This design file is invalid.');
    for (const page of parsed.pages) for (const node of page.nodes) if (node.type === 'image') {
      const id = node.assetId || node.id;
      let saved = assets.get(id);
      if (!saved) {
        const existing = await loadImageAsset(id);
        if (existing) saved = { ...existing, name: node.sourceName || existing.name, type: node.sourceType || existing.type };
      }
      if (!saved) throw new Error(`Image “${node.sourceName || node.name}” is missing from this design file.`);
      node.sourceBytes = saved.bytes; node.sourceName = saved.name; node.sourceType = saved.type; node.assetId = id;
      imageMemory.set(node.id, { sourceBytes: saved.bytes, sourceName: saved.name, sourceType: saved.type });
      try { await saveImageAsset(id, saved.bytes, saved.name, saved.type); } catch { /* The imported image still works in this editing session. */ }
    }
    snapshot(); project = parsed; selectedId = null; restoreImageRuntime(); commit();
    for (const page of project.pages) for (const node of page.nodes) if (node.type === 'image') scheduleImageRender(node, true);
    showToast('Project opened locally.');
  } catch (error) { showToast(error?.message || 'Could not open this project file.'); }
  event.target.value = '';
});

$('#image-input').addEventListener('change', async event => {
  try { await importImages(event.target.files); }
  catch (error) { showToast(error?.message || 'Could not read the selected image.'); }
  event.target.value = '';
});

for (const type of ['dragenter', 'dragover']) canvas.parentElement.addEventListener(type, event => { event.preventDefault(); });
canvas.parentElement.addEventListener('drop', async event => {
  event.preventDefault();
  try { await importImages(event.dataTransfer?.files || []); }
  catch (error) { showToast(error?.message || 'Could not read the dropped image.'); }
});

$('.menu-row').addEventListener('click', event => {
  const menu = event.target.closest('[data-menu]')?.dataset.menu; if (!menu) return;
  if (menu === 'File') { exportProject(); return; }
  showToast(`${menu} commands are being added in the next editor phase.`);
});

renderer.setProject(project);
renderer.fitTo(activePage(project).nodes.find(node => node.type === 'frame'));
persist();
renderAll();
setTool('select');
void restoreStoredImages();
imageEngine.initialization.then(() => {
  const node = findNode(project, selectedId);
  if (node?.type === 'image') updateImageStatus(node, 'Pillow-RS WASM ready · images stay on this device.');
}).catch(error => {
  const node = findNode(project, selectedId);
  if (node?.type === 'image') updateImageStatus(node, error.message || 'Pillow-RS WASM did not start.');
});
