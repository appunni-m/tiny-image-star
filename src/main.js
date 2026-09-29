import { activePage, createInitialProject, createNode, descendants, findNode, serializeProject, validateProject } from './model.js';
import { CanvasRenderer } from './renderer.js';

const STORAGE_KEY = 'local-studio-project-v1';
const canvas = document.querySelector('#design-canvas');
const renderer = new CanvasRenderer(canvas);
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

function commit() { persist(); renderAll(); }

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
    const icon = { frame: '▣', rect: '▱', ellipse: '◯', text: 'T', pen: '⌁' }[node.type] || '◇';
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
  $('#appearance-section').classList.toggle('muted', !node);
  $('#text-section').hidden = node?.type !== 'text';
  for (const [id, key] of [['x', 'x'], ['y', 'y'], ['w', 'w'], ['h', 'h'], ['radius', 'radius']]) $(`#prop-${id}`).value = node?.[key] ?? 0;
  $('#prop-opacity').value = Math.round((node?.opacity ?? 1) * 100);
  $('#prop-fill').value = colorForInput(node?.fill);
  $('#fill-hex').value = colorForHex(node?.fill);
  $('#prop-stroke').value = colorForInput(node?.stroke);
  $('#stroke-hex').value = colorForHex(node?.stroke);
  $('#prop-text').value = node?.text ?? '';
  $('#prop-font-size').value = node?.fontSize ?? 32;
  $('#prop-font-weight').value = String(node?.fontWeight ?? 400);
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

function exportProject() { downloadBlob(new Blob([serializeProject(project)], { type: 'application/json' }), `${project.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'design'}.localdesign`); }
function exportSelection() {
  const node = findNode(project, selectedId); if (!node) return showToast('Select an object to export.');
  const width = Math.ceil(node.w), height = Math.ceil(node.h), output = document.createElement('canvas'); output.width = width; output.height = height;
  const ctx = output.getContext('2d');
  ctx.fillStyle = node.fill || 'transparent';
  if (node.type === 'ellipse') { ctx.beginPath(); ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2); ctx.fill(); }
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

$$('.tool-button').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
$('#zoom-in').addEventListener('click', () => { renderer.setZoom(renderer.zoom * 1.2); renderAll(); });
$('#zoom-out').addEventListener('click', () => { renderer.setZoom(renderer.zoom / 1.2); renderAll(); });
$('#zoom-value').addEventListener('click', () => { renderer.fitTo(activePage(project).nodes.find(node => node.type === 'frame')); renderAll(); });
$('#undo').addEventListener('click', () => { if (!undoStack.length) return; redoStack.push(serializeProject(project)); project = JSON.parse(undoStack.pop()); if (selectedId && !findNode(project, selectedId)) selectedId = null; commit(); });
$('#redo').addEventListener('click', () => { if (!redoStack.length) return; undoStack.push(serializeProject(project)); project = JSON.parse(redoStack.pop()); if (selectedId && !findNode(project, selectedId)) selectedId = null; commit(); });
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
  try { const parsed = JSON.parse(await file.text()); if (!validateProject(parsed)) throw new Error('Invalid project file'); snapshot(); project = parsed; selectedId = null; commit(); showToast('Project opened.'); }
  catch { showToast('Could not open this project file.'); }
  event.target.value = '';
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
