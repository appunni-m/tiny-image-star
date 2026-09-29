import { createBlankPage, createDefaultDocument, createLayer, makeId, resizedBounds, scaleNodesToBounds } from "./model.js";
import { CanvasRenderer } from "./renderer.js";
import { PillowWorkerPool } from "./image-engine.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const app = $("#app");
const canvas = $("#design-canvas");
const stage = $("#canvas-stage");
const layerTree = $("#layer-tree");
const inspector = $("#inspector-content");
const contextMenu = $("#context-menu");
const imageInput = $("#image-input");
const recipeDialog = $("#recipe-dialog");
const recipeNameInput = $("#recipe-name-input");
const recipeSourceName = $("#recipe-source-name");
const saveIndicator = $("#save-indicator");
const engineMax = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
const engine = new PillowWorkerPool({ maxWorkers: engineMax });
const STORAGE_KEY = "tiny-image-star-design-document-v1";
const RECIPE_KEY = "tiny-image-star-design-recipes-v1";
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 50_000_000;

function initialProject() {
  const starter = createDefaultDocument();
  const page = { id: "page-1", name: "Page 1", frame: starter.frame, nodes: starter.nodes, groups: starter.groups };
  return { version: 2, title: starter.title, activePageId: page.id, pages: [page] };
}
function restoreProject() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved?.version === 2 && Array.isArray(saved.pages) && saved.pages.length && saved.pages.length <= 100) {
      const pages = saved.pages.filter((page) => page && Array.isArray(page.nodes) && page.frame?.width && page.frame?.height).map((page, index) => ({
        id: typeof page.id === "string" ? page.id : `page-${index + 1}`,
        name: String(page.name ?? `Page ${index + 1}`).slice(0, 80),
        frame: page.frame,
        nodes: page.nodes.filter((node) => node.type !== "image"),
        groups: Array.isArray(page.groups) ? page.groups : [],
      }));
      if (pages.length) return { version: 2, title: String(saved.title ?? "Untitled design").slice(0, 80), activePageId: saved.activePageId, pages };
    }
    if (saved?.version === 1 && Array.isArray(saved.nodes) && saved.frame?.width) {
      saved.nodes = saved.nodes.filter((node) => node.type !== "image");
      const page = { id: "page-1", name: "Page 1", frame: saved.frame, nodes: saved.nodes, groups: saved.groups ?? [] };
      return { version: 2, title: saved.title ?? "Untitled design", activePageId: page.id, pages: [page] };
    }
  } catch { /* A corrupt local draft is ignored; the starter file remains available. */ }
  return initialProject();
}

let project = restoreProject();
let model = project.pages.find((page) => page.id === project.activePageId) ?? project.pages[0];
project.activePageId = model.id;
$("#doc-title").value = project.title;
const renderer = new CanvasRenderer(canvas, stage, model);
let selectedIds = new Set(model.nodes.some((node) => node.id === "hero-heading") ? ["hero-heading"] : []);
let activeTool = "select";
let activeLeftTab = "layers";
let frameExpanded = true;
let expandedGroups = new Set(model.groups.map((group) => group.id));
let pointerState = null;
let spaceHeld = false;
let editBaseline = null;
let undoStack = [];
let redoStack = [];
let saveTimer = 0;
let toastTimer = 0;
let previewTimers = new Map();
let previewTokens = new Map();
let engineMessage = "Pillow-RS WebAssembly runs here in your browser. Image bytes never leave this device.";
let activeJob = null;
let recipeSourceIds = [];
let outlineMode = false;
let assetsFilter = "";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function serializableNode(node) {
  const { sourceBytes, sourceBitmap, previewBitmap, renderVersion, ...plain } = node;
  return plain;
}
function snapshot() { return { pageId: model.id, model: { ...model, nodes: model.nodes.map(serializableNode) }, selectedIds: [...selectedIds] }; }
function sameSnapshot(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function pushHistory() {
  const current = snapshot();
  if (undoStack.length && sameSnapshot(undoStack.at(-1), current)) return;
  undoStack.push(current); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0;
}
function restoreSnapshot(value) {
  const old = new Map(model.nodes.map((node) => [node.id, node]));
  const restored = { ...value.model, nodes: value.model.nodes.map((node) => {
    const existing = old.get(node.id);
    return existing ? { ...node, sourceBytes: existing.sourceBytes, sourceBitmap: existing.sourceBitmap, previewBitmap: existing.previewBitmap } : node;
  }) };
  const pageIndex = project.pages.findIndex((page) => page.id === value.pageId);
  if (pageIndex < 0) return;
  project.pages[pageIndex] = restored; model = restored;
  renderer.doc = model;
  selectedIds = new Set(value.selectedIds.filter((id) => model.nodes.some((node) => node.id === id)));
  if (!selectedIds.size && model.nodes.length) selectedIds.add(model.nodes.at(-1).id);
  renderAll(); scheduleSave();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restoreSnapshot(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restoreSnapshot(redoStack.pop()); }
function nodeById(id) { return model.nodes.find((node) => node.id === id); }
function selectedNodes() { return [...selectedIds].map(nodeById).filter(Boolean); }
function selectedImageNodes() { return selectedNodes().filter((node) => node.type === "image"); }
function primaryNode() { return selectedNodes().at(-1) ?? null; }

function toast(message, duration = 2200) {
  const el = $("#toast"); el.textContent = message; el.classList.add("visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("visible"), duration);
}
function markSaving() { saveIndicator.className = "save-indicator saving"; saveIndicator.lastChild.textContent = " Saving…"; }
function scheduleSave() {
  markSaving(); clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      project.title = $("#doc-title").value.trim() || "Untitled design";
      const saved = {
        version: 2, title: project.title, activePageId: model.id,
        pages: project.pages.map((page) => ({ ...page, nodes: page.nodes.filter((node) => node.type !== "image").map(serializableNode) })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      saveIndicator.className = "save-indicator"; saveIndicator.lastChild.textContent = " Saved locally";
    } catch {
      saveIndicator.className = "save-indicator error"; saveIndicator.lastChild.textContent = " Could not save";
    }
  }, 250);
}

function colorInput(node, prop, label) {
  const color = /^#[0-9a-f]{6}$/i.test(node[prop] ?? "") ? node[prop] : "#ffffff";
  return `<div class="fill-color-row"><input type="color" data-prop="${prop}" aria-label="${label}" value="${color}"><input type="text" data-prop="${prop}" aria-label="${label} hex" value="${escapeHtml(node[prop] ?? "#ffffff")}" maxlength="9"><select data-prop="blendMode" aria-label="Blend mode"><option value="normal">Normal</option><option value="multiply" ${node.blendMode === "multiply" ? "selected" : ""}>Multiply</option><option value="screen" ${node.blendMode === "screen" ? "selected" : ""}>Screen</option></select></div>`;
}
function propertyField(letter, prop, value, step = 1, min = -10000) {
  return `<div class="prop-field"><label>${letter}</label><input type="number" data-prop="${prop}" value="${Number(value ?? 0)}" step="${step}" min="${min}" aria-label="${prop}"></div>`;
}
function section(title, contents, extra = "") {
  return `<section class="inspector-section"><div class="inspector-section-title"><span>${title}</span><button type="button" aria-label="${title} options">···</button></div>${contents}${extra}</section>`;
}
function renderInspector() {
  const nodes = selectedNodes();
  if (!nodes.length) {
    inspector.innerHTML = `<div class="inspector-empty"><div><strong>Nothing selected</strong>Select a layer on the canvas or in the left panel to edit its design properties.</div></div>`;
    return;
  }
  if (nodes.length > 1) {
    const images = nodes.filter((node) => node.type === "image").length;
    inspector.innerHTML = `${section("Selection", `<div class="inspector-empty multi-selection-message">${nodes.length} layers selected${images ? ` · ${images} images` : ""}<br>Move them together on the canvas, or right-click to save/apply an image recipe.</div><div class="inspector-grid">${propertyField("X", "x", nodes[0].x)}${propertyField("Y", "y", nodes[0].y)}<div class="prop-field full"><label>Op</label><input type="number" data-prop="opacity" value="${Math.round((nodes[0].opacity ?? 1) * 100)}" min="0" max="100" aria-label="Opacity percent"></div></div>`)}${section("Appearance", `<div class="inspector-row"><span>Mixed selection</span><span>${nodes.map((node) => node.type).join(", ")}</span></div>`)}`;
    return;
  }
  const node = nodes[0];
  const kind = node.type === "text" ? "Text" : node.type === "image" ? "Image" : node.type === "landscape" ? "Illustration" : node.type === "ellipse" ? "Ellipse" : node.type === "frame" ? "Frame" : "Rectangle";
  let html = section(kind, `<div class="prop-field full selection-name-field"><label>◩</label><input data-prop="name" value="${escapeHtml(node.name)}" aria-label="Layer name"></div><div class="inspector-grid">${propertyField("X", "x", node.x)}${propertyField("Y", "y", node.y)}${propertyField("W", "w", node.w, 1, 1)}${propertyField("H", "h", node.h, 1, 1)}</div>`);
  if (node.type === "text") {
    html += section("Typography", `<div class="inspector-row"><span>Font</span><select data-prop="fontFamily" aria-label="Font family"><option value="Inter, sans-serif" ${node.fontFamily?.startsWith("Inter") ? "selected" : ""}>Inter</option><option value="Georgia, serif" ${node.fontFamily?.startsWith("Georgia") ? "selected" : ""}>Georgia</option><option value="Arial, sans-serif" ${node.fontFamily?.startsWith("Arial") ? "selected" : ""}>Arial</option><option value="ui-monospace, monospace" ${node.fontFamily?.startsWith("ui-monospace") ? "selected" : ""}>Mono</option></select></div><div class="inspector-row"><span>Weight</span><select data-prop="fontWeight" aria-label="Font weight">${[400,500,600,700,800].map((value) => `<option value="${value}" ${Number(node.fontWeight) === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div class="inspector-grid">${propertyField("T", "fontSize", node.fontSize ?? 16, 1, 1)}${propertyField("↕", "lineHeight", node.lineHeight ?? 1.2, .05, .5)}</div><label class="inspector-row text-content-label"><span>Text content</span><span></span></label><textarea class="text-content-input" data-prop="text" aria-label="Text content" rows="3">${escapeHtml(node.text ?? "")}</textarea>`);
  }
  if (node.type === "image") {
    const adjustments = node.adjustments ?? { brightness: 0, contrast: 0, saturation: 0, blur: 0 };
    const range = (label, key, min, max) => `<div class="inspector-inline"><label>${label}</label><input type="range" data-adjustment="${key}" min="${min}" max="${max}" step="1" value="${adjustments[key] ?? 0}" aria-label="${label}"><output>${adjustments[key] ?? 0}</output></div>`;
    html += section("Image", `<div class="image-engine-status">${escapeHtml(engineMessage)}</div><div class="image-edit-section">${range("Exposure", "brightness", -100, 100)}${range("Contrast", "contrast", -100, 100)}${range("Saturation", "saturation", -100, 100)}${range("Blur", "blur", 0, 20)}</div><button type="button" class="add-fill" data-action="save-recipe">＋ Save these edits as a recipe</button><p class="inspector-note">Edits update this image on the canvas and are calculated with the local Pillow-RS WASM runtime.</p>`);
  } else if (node.type !== "landscape") {
    const fill = colorInput(node, "fill", "Fill color");
    html += section("Fill", `${fill}<p class="inspector-note">Solid fill · local canvas preview</p>`);
    html += section("Stroke", `<div class="fill-color-row"><input type="color" data-prop="stroke" aria-label="Stroke color" value="${/^#[\da-f]{6}$/i.test(node.stroke ?? "") ? node.stroke : "#000000"}"><input class="fill-value" data-prop="stroke" value="${escapeHtml(node.stroke ?? "")}" placeholder="None" aria-label="Stroke hex">${propertyField("W", "strokeWidth", node.strokeWidth ?? 0, .5, 0)}</div>`);
    if (node.type !== "ellipse") html += section("Corner radius", `<div class="inspector-inline"><label>Radius</label><input type="range" data-prop="radius" min="0" max="80" value="${node.radius ?? 0}" aria-label="Corner radius"><output>${node.radius ?? 0}</output></div>`);
  }
  const opacity = Math.round((node.opacity ?? 1) * 100);
  html += section("Layer", `<div class="inspector-inline"><label>Opacity</label><input type="range" data-prop="opacity" min="0" max="100" value="${opacity}" aria-label="Opacity"><output>${opacity}%</output></div><div class="inspector-row"><span>Blend mode</span><select data-prop="blendMode" aria-label="Blend mode"><option value="normal">Normal</option><option value="multiply" ${node.blendMode === "multiply" ? "selected" : ""}>Multiply</option><option value="screen" ${node.blendMode === "screen" ? "selected" : ""}>Screen</option></select></div>`);
  inspector.innerHTML = html;
}

function renderLayers() {
  const filter = $("#layer-filter").value.trim().toLowerCase();
  const imageNodes = model.nodes.filter((node) => node.type === "image");
  if (activeLeftTab === "assets") {
    layerTree.innerHTML = imageNodes.length ? imageNodes.map((node) => `<div class="layer-row ${selectedIds.has(node.id) ? "selected" : ""}" role="treeitem" data-id="${node.id}"><span class="layer-icon">▧</span><span class="layer-name">${escapeHtml(node.name)}</span></div>`).join("") : `<div class="inspector-empty assets-empty">Placed images will appear here.<br>They stay in this tab's memory.</div>`;
    return;
  }
  const frameMatch = model.frame.name.toLowerCase().includes(filter);
  let html = frameMatch ? `<div class="layer-row" data-frame-row="true"><span class="layer-chevron">${frameExpanded ? "▾" : "▸"}</span><span class="layer-icon">▱</span><span class="layer-name">${escapeHtml(model.frame.name)}</span><span class="layer-eye">◉</span></div>` : "";
  const groupIds = new Set(model.groups.map((group) => group.name));
  for (const group of frameExpanded ? model.groups : []) {
    const groupNodes = model.nodes.filter((node) => (node.section ?? "Hero") === group.name).slice().reverse();
    const visibleNodes = groupNodes.filter((node) => !filter || node.name.toLowerCase().includes(filter));
    if (!visibleNodes.length && filter) continue;
    html += `<div class="layer-row" data-group="${group.id}" role="treeitem"><span class="layer-chevron">${expandedGroups.has(group.id) ? "▾" : "▸"}</span><span class="layer-icon">▰</span><span class="layer-name">${escapeHtml(group.name)}</span></div>`;
    if (expandedGroups.has(group.id)) {
      html += visibleNodes.map((node) => `<div class="layer-row ${selectedIds.has(node.id) ? "selected" : ""} ${selectedIds.size > 1 && selectedIds.has(node.id) ? "multi-selected" : ""}" role="treeitem" aria-selected="${selectedIds.has(node.id)}" data-id="${node.id}" data-level="1"><span class="layer-chevron"></span><span class="layer-icon">${node.type === "text" ? "T" : node.type === "image" ? "▧" : node.type === "ellipse" ? "◯" : node.type === "landscape" ? "▧" : "▱"}</span><span class="layer-name">${escapeHtml(node.name)}</span>${node.hidden ? `<span class="layer-warning">◌</span>` : ""}</div>`).join("");
    }
  }
  const ungrouped = model.nodes.filter((node) => !groupIds.has(node.section ?? "Hero"));
  if (ungrouped.length) html += ungrouped.slice().reverse().map((node) => `<div class="layer-row ${selectedIds.has(node.id) ? "selected" : ""}" data-id="${node.id}" data-level="1"><span class="layer-chevron"></span><span class="layer-icon">${node.type === "text" ? "T" : "▱"}</span><span class="layer-name">${escapeHtml(node.name)}</span></div>`).join("");
  layerTree.innerHTML = html;
}

function renderPages() {
  $("#page-list").innerHTML = project.pages.map((page) => `<button type="button" class="page-row ${page.id === model.id ? "active" : ""}" data-page-id="${escapeHtml(page.id)}" aria-current="${page.id === model.id ? "page" : "false"}"><span class="page-glyph">▤</span><span class="page-name">${escapeHtml(page.name)}</span><span class="page-more" aria-hidden="true">···</span></button>`).join("");
  $("#active-page-name").textContent = model.name;
}

function activatePage(pageId) {
  if (activeJob) { toast("Finish or stop the current image recipe before changing pages"); return; }
  const page = project.pages.find((item) => item.id === pageId);
  if (!page || page.id === model.id) return;
  project.activePageId = page.id; model = page; renderer.doc = model;
  selectedIds = new Set(); undoStack = []; redoStack = [];
  expandedGroups = new Set(model.groups.map((group) => group.id)); frameExpanded = true;
  renderer.fit(); renderAll(); scheduleSave();
  for (const node of model.nodes) if (node.type === "image" && Object.values(node.adjustments ?? {}).some((value) => Number(value) !== 0)) scheduleImageRender(node);
}

function addPage() {
  if (activeJob) { toast("Finish or stop the current image recipe before adding a page"); return; }
  const page = createBlankPage(`Page ${project.pages.length + 1}`);
  project.pages.push(page); activatePage(page.id); toast(`${page.name} added`);
}

function deletePage(pageId) {
  if (project.pages.length <= 1) { toast("A design must keep at least one page"); return; }
  if (activeJob) { toast("Finish or stop the current image recipe before deleting a page"); return; }
  const index = project.pages.findIndex((page) => page.id === pageId);
  if (index < 0) return;
  const [removed] = project.pages.splice(index, 1);
  for (const node of removed.nodes) if (node.type === "image") {
    engine.dispose(node.id); node.sourceBitmap?.close?.();
    if (node.previewBitmap !== node.sourceBitmap) node.previewBitmap?.close?.();
  }
  if (removed.id === model.id) {
    project.activePageId = project.pages[Math.min(index, project.pages.length - 1)].id;
    model = project.pages.find((page) => page.id === project.activePageId);
    renderer.doc = model; selectedIds.clear(); undoStack = []; redoStack = [];
    expandedGroups = new Set(model.groups.map((group) => group.id)); renderer.fit();
  }
  renderAll(); scheduleSave(); toast(`${removed.name} deleted`);
}

function renderAll() {
  renderer.doc = model; renderer.draw([...selectedIds]); renderPages(); renderLayers(); renderInspector();
  $("#zoom-value").textContent = `${Math.round(renderer.scale * 100)}%`;
  const node = primaryNode();
  $("#selection-label").textContent = selectedIds.size > 1 ? `${selectedIds.size} layers selected` : node?.name ?? model.frame.name;
  $("#selection-size").textContent = node ? `${Math.round(node.w)} × ${Math.round(node.h)}` : "No selection";
  const p = node ? renderer.toScreen(node.x, node.y) : { x: 0, y: 0 };
  $("#stage-coordinates").textContent = node ? `X ${Math.round(node.x)}   Y ${Math.round(node.y)}` : "X 0   Y 0";
}

function setSelection(ids) {
  selectedIds = new Set(ids.filter((id) => nodeById(id)));
  renderAll();
}
function setTool(name) {
  activeTool = name;
  $$(".tool[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === name));
  canvas.classList.toggle("canvas-hand", name === "hand");
  canvas.classList.toggle("canvas-text-tool", name === "text");
  canvas.classList.toggle("canvas-create-tool", ["frame", "rectangle", "ellipse"].includes(name));
  if (name === "image") imageInput.click();
}
function addNode(type, x, y) {
  pushHistory();
  const position = renderer.toWorld(x, y);
  const nx = Math.round(Math.max(0, Math.min(model.frame.width - 10, position.x)));
  const ny = Math.round(Math.max(0, Math.min(model.frame.height - 10, position.y)));
  const layerType = type === "rectangle" ? "rect" : type;
  const node = createLayer(layerType, nx, ny);
  if (layerType === "frame") { node.section = "Hero"; node.name = "Frame"; }
  model.nodes.push(node); selectedIds = new Set([node.id]);
  if (!model.groups.some((group) => group.name === node.section)) model.groups.unshift({ id: makeId("group"), name: node.section, collapsed: false });
  expandedGroups.add(model.groups.find((group) => group.name === node.section)?.id);
  setTool("select"); renderAll(); scheduleSave();
  return node;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeFilename(value) { return value.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "design"; }
async function exportFrame() {
  try { const blob = await renderer.exportBlob(); downloadBlob(`${safeFilename($("#doc-title").value)}.png`, blob); toast("Frame exported as PNG"); }
  catch (error) { toast(error.message); }
}
function exportProject() {
  project.title = $("#doc-title").value.trim() || "Untitled design";
  const assets = project.pages.flatMap((page) => page.nodes.filter((node) => node.type === "image")
    .map((node) => ({ pageId: page.id, id: node.id, data: bytesToBase64(node.sourceBytes), mime: node.mime ?? "image/png" })));
  const file = {
    version: 2, title: project.title, activePageId: model.id,
    pages: project.pages.map((page) => ({ ...page, nodes: page.nodes.map(serializableNode) })), assets,
  };
  downloadBlob(`${safeFilename(file.title)}.tstar`, new Blob([JSON.stringify(file)], { type: "application/json" }));
  toast("Design and placed images saved to a local project file");
}
function bytesToBase64(bytes = new Uint8Array()) {
  let result = ""; const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) result += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(result);
}
function base64ToBytes(value) {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function openProjectFile(file) {
  const openedBitmaps = [];
  try {
    if (file.size > 512 * 1024 * 1024) throw new Error("Project file exceeds the 512 MB local import limit");
    const data = JSON.parse(await file.text());
    const sourcePages = Array.isArray(data?.pages) ? data.pages : data?.version === 1 && data.frame && Array.isArray(data.nodes)
      ? [{ id: "page-1", name: "Page 1", frame: data.frame, nodes: data.nodes, groups: data.groups }] : null;
    if (!data || ![1, 2].includes(data.version) || !sourcePages?.length || sourcePages.length > 100 || sourcePages.some((page) => !Array.isArray(page.nodes) || page.nodes.length > 20_000)) throw new Error("This is not a supported Tiny Image Star project file");
    const assets = new Map((Array.isArray(data.assets) ? data.assets : []).map((asset) => [`${asset.pageId ?? ""}:${asset.id}`, asset]));
    const restoredPages = [];
    const projectPageIds = new Set(); const projectNodeIds = new Set(); let totalAssetBytes = 0; let totalNodes = 0;
    for (let pageIndex = 0; pageIndex < sourcePages.length; pageIndex++) {
      const sourcePage = sourcePages[pageIndex];
      const pageId = typeof sourcePage.id === "string" && sourcePage.id.length <= 200 ? sourcePage.id : `page-${pageIndex + 1}`;
      if (projectPageIds.has(pageId) || !sourcePage.frame) throw new Error("The project contains an invalid page");
      projectPageIds.add(pageId);
      const restoredNodes = []; const nodeIds = new Set();
      for (const stored of sourcePage.nodes) {
        totalNodes += 1;
        if (totalNodes > 20_000 || !stored || typeof stored.id !== "string" || nodeIds.has(stored.id) || projectNodeIds.has(stored.id) || !["text", "rect", "ellipse", "frame", "image", "landscape"].includes(stored.type)
          || !Number.isFinite(stored.x) || !Number.isFinite(stored.y) || !Number.isFinite(stored.w) || !Number.isFinite(stored.h) || stored.w <= 0 || stored.h <= 0) throw new Error("The project contains an invalid layer");
        nodeIds.add(stored.id); projectNodeIds.add(stored.id);
        const node = { ...stored };
        if (node.type === "image") {
          const asset = assets.get(`${pageId}:${node.id}`) ?? assets.get(`:${node.id}`);
          if (asset?.data) {
            if (typeof asset.data !== "string" || asset.data.length > MAX_SOURCE_BYTES * 1.4) throw new Error(`Image ${node.name} exceeds the local source limit`);
            const sourceBytes = base64ToBytes(asset.data);
            totalAssetBytes += sourceBytes.byteLength;
            if (sourceBytes.byteLength > MAX_SOURCE_BYTES || totalAssetBytes > 500 * 1024 * 1024) throw new Error("Project image data exceeds the local memory limit");
            const sourceBitmap = await createImageBitmap(new Blob([sourceBytes], { type: asset.mime ?? node.mime ?? "image/png" }));
            openedBitmaps.push(sourceBitmap);
            if (sourceBitmap.width * sourceBitmap.height > MAX_SOURCE_PIXELS) throw new Error(`Image ${node.name} exceeds the 50 megapixel safety limit`);
            node.sourceBytes = sourceBytes; node.sourceBitmap = sourceBitmap; node.previewBitmap = sourceBitmap;
          }
        }
        restoredNodes.push(node);
      }
      restoredPages.push({
        id: pageId, name: String(sourcePage.name ?? `Page ${pageIndex + 1}`).slice(0, 80),
        frame: { width: Math.min(16_000, Math.max(1, Number(sourcePage.frame.width) || 1440)), height: Math.min(16_000, Math.max(1, Number(sourcePage.frame.height) || 1000)), name: String(sourcePage.frame.name ?? "Frame").slice(0, 80) },
        nodes: restoredNodes, groups: Array.isArray(sourcePage.groups) ? sourcePage.groups : [],
      });
    }
    for (const oldPage of project.pages) for (const node of oldPage.nodes) if (node.type === "image") {
      engine.dispose(node.id); node.sourceBitmap?.close?.(); if (node.previewBitmap !== node.sourceBitmap) node.previewBitmap?.close?.();
    }
    project = { version: 2, title: String(data.title ?? "Untitled design").slice(0, 80), activePageId: data.activePageId, pages: restoredPages };
    model = restoredPages.find((page) => page.id === project.activePageId) ?? restoredPages[0]; project.activePageId = model.id;
    renderer.doc = model; $("#doc-title").value = project.title; document.title = `${project.title} — Tiny Image Star`;
    expandedGroups = new Set(model.groups.map((group) => group.id)); selectedIds = new Set(model.nodes.length ? [model.nodes.at(-1).id] : []);
    undoStack = []; redoStack = []; renderer.fit(); renderAll(); scheduleSave();
    for (const node of model.nodes) if (node.type === "image" && Object.values(node.adjustments ?? {}).some((value) => Number(value) !== 0)) scheduleImageRender(node);
    toast("Local project opened");
  } catch (error) { for (const bitmap of openedBitmaps) bitmap.close?.(); toast(`Could not open project: ${error.message}`, 4000); }
}

async function placeImageFiles(files) {
  const list = [...files]; if (!list.length) return;
  const center = renderer.toWorld(stage.clientWidth / 2, stage.clientHeight / 2);
  for (let index = 0; index < list.length; index++) {
    const file = list[index];
    if (!file.type.startsWith("image/")) continue;
    try {
      if (file.size > MAX_SOURCE_BYTES) throw new Error("Image is larger than this workspace's 100 MB source limit");
      const [bitmap, bytes] = await Promise.all([createImageBitmap(file), file.arrayBuffer()]);
      if (bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) { bitmap.close(); throw new Error("Image exceeds this workspace's 50 megapixel safety limit"); }
      const limit = Math.min(640, model.frame.width * .46);
      const ratio = Math.min(1, limit / bitmap.width, 500 / bitmap.height);
      const node = {
        id: makeId("image"), name: file.name.replace(/\.[^.]+$/, "") || "Placed image", type: "image",
        x: Math.round(center.x - bitmap.width * ratio / 2 + index * 22), y: Math.round(center.y - bitmap.height * ratio / 2 + index * 22),
        w: Math.round(bitmap.width * ratio), h: Math.round(bitmap.height * ratio), section: "Images", mime: file.type,
        sourceBytes: new Uint8Array(bytes), sourceBitmap: bitmap, previewBitmap: bitmap,
        adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 }, opacity: 1, hidden: false, locked: false,
      };
      model.nodes.push(node); selectedIds = new Set([node.id]);
      if (!model.groups.some((group) => group.name === "Images")) model.groups.unshift({ id: makeId("group"), name: "Images", collapsed: false });
      const imageGroup = model.groups.find((group) => group.name === "Images"); expandedGroups.add(imageGroup.id);
      $("#canvas-message").textContent = "Image is held in this tab's memory; local WASM edits replace its live preview.";
      renderAll();
    } catch (error) { toast(`Could not place ${file.name}: ${error.message}`); }
  }
  setTool("select"); scheduleSave();
}

function scheduleImageRender(node, adjustments = node.adjustments) {
  clearTimeout(previewTimers.get(node.id));
  const token = (previewTokens.get(node.id) ?? 0) + 1; previewTokens.set(node.id, token);
  previewTimers.set(node.id, setTimeout(async () => {
    try {
      engineMessage = "Starting the local Pillow-RS WebAssembly worker…";
      if (selectedIds.has(node.id)) renderInspector();
      const result = await engine.render(node, adjustments);
      const bitmap = await createImageBitmap(new Blob([result.bytes], { type: "image/png" }));
      if (previewTokens.get(node.id) !== token) { bitmap.close(); return; }
      if (node.previewBitmap && node.previewBitmap !== node.sourceBitmap) node.previewBitmap.close?.();
      node.previewBitmap = bitmap;
      engineMessage = `WASM preview ready · ${result.width} × ${result.height} · original held in memory`;
      renderer.draw([...selectedIds]); if (selectedIds.has(node.id)) renderInspector();
    } catch (error) {
      engineMessage = `WASM image edit failed: ${error.message}`;
      if (selectedIds.has(node.id)) renderInspector();
      toast(`Image edit failed: ${error.message}`);
    }
  }, 90));
}

function recipes() {
  try {
    const values = JSON.parse(localStorage.getItem(RECIPE_KEY) ?? "[]");
    return Array.isArray(values) ? values.filter((item) => item && typeof item.name === "string" && item.adjustments) : [];
  } catch { return []; }
}
function openRecipeDialog(nodes = selectedImageNodes()) {
  const images = nodes.filter((node) => node.type === "image");
  if (!images.length) { toast("Select a placed image to save its adjustments"); return; }
  recipeSourceIds = images.map((node) => node.id);
  recipeNameInput.value = images[0].name ? `${images[0].name} look`.slice(0, 48) : "My image look";
  recipeSourceName.textContent = images.length === 1 ? `Save the current edits from “${images[0].name}” for reuse.` : `Save the current edits from ${images.length} selected images as one recipe.`;
  recipeDialog.showModal(); recipeNameInput.select();
}
$("#recipe-save-button").addEventListener("click", (event) => {
  event.preventDefault();
  const name = recipeNameInput.value.trim(); if (!name) { recipeNameInput.focus(); return; }
  const source = nodeById(recipeSourceIds[0]);
  const values = recipes().filter((recipe) => recipe.name.toLowerCase() !== name.toLowerCase());
  values.unshift({ id: makeId("recipe"), name, adjustments: { ...(source?.adjustments ?? { brightness: 0, contrast: 0, saturation: 0, blur: 0 }) }, savedAt: new Date().toISOString() });
  try { localStorage.setItem(RECIPE_KEY, JSON.stringify(values.slice(0, 30))); recipeDialog.close(); toast(`Recipe “${name}” saved on this device`); }
  catch { toast("Could not save this recipe in local storage"); }
});

function workerLimit() {
  const mode = $("#job-speed").value;
  const requested = mode === "low" ? 1 : mode === "fast" ? engineMax : Math.min(2, engineMax);
  const largest = Math.max(1, ...(activeJob?.nodes ?? []).map((node) => (node.sourceBitmap?.width ?? 1) * (node.sourceBitmap?.height ?? 1) * 16));
  const deviceGiB = Number(navigator.deviceMemory) || (matchMedia("(max-width: 700px)").matches ? 2 : 4);
  const memoryBudget = Math.min(1536, Math.max(256, deviceGiB * 256)) * 1024 * 1024;
  return Math.max(1, Math.min(requested, Math.floor(memoryBudget / largest)));
}
function updateJobView() {
  if (!activeJob) return;
  const total = activeJob.nodes.length;
  $("#job-progress").value = total ? activeJob.completed / total : 0;
  $("#job-status").textContent = activeJob.stopped ? "Stopping after active images…" : activeJob.paused ? "Paused" : activeJob.failures ? `${activeJob.failures} failed · continuing` : activeJob.active ? `Processing ${activeJob.active} image${activeJob.active === 1 ? "" : "s"}…` : "Queued";
  const elapsed = Math.max(.25, (performance.now() - activeJob.startedAt) / 1000);
  const workers = workerLimit();
  $("#job-metrics").textContent = `${activeJob.completed} of ${total} · ${(activeJob.completed / elapsed).toFixed(1)} images/s · ${workers} worker${workers === 1 ? "" : "s"}`;
}
function finishJob(job) {
  if (activeJob !== job) return;
  activeJob = null; $("#job-bar").hidden = true;
  const message = job.stopped ? `Stopped · ${job.completed} image${job.completed === 1 ? "" : "s"} updated` : `Recipe applied to ${job.completed} image${job.completed === 1 ? "" : "s"}${job.failures ? ` · ${job.failures} failed` : ""}`;
  $("#canvas-message").textContent = message; toast(message); renderAll(); scheduleSave();
}
function pumpJob(job) {
  if (activeJob !== job) return;
  updateJobView();
  if (!job.paused && !job.stopped) {
    while (job.active < workerLimit() && job.next < job.nodes.length) {
      const node = job.nodes[job.next++]; job.active += 1; updateJobView();
      node.adjustments = { ...job.adjustments };
      engine.render(node, node.adjustments).then(async (result) => {
        const bitmap = await createImageBitmap(new Blob([result.bytes], { type: "image/png" }));
        if (node.previewBitmap && node.previewBitmap !== node.sourceBitmap) node.previewBitmap.close?.();
        node.previewBitmap = bitmap; renderer.draw([...selectedIds]);
      }).catch((error) => { job.failures += 1; job.error = error.message; }).finally(() => {
        job.active -= 1; job.completed += 1; updateJobView();
        if (job.next >= job.nodes.length && job.active === 0) finishJob(job); else pumpJob(job);
      });
    }
  }
  if ((job.stopped || job.paused || job.next >= job.nodes.length) && job.active === 0) {
    if (job.stopped || job.next >= job.nodes.length) finishJob(job);
  }
}
function applyRecipe(recipe) {
  const nodes = selectedImageNodes();
  if (!nodes.length) { toast("Select one or more placed images first"); return; }
  if (activeJob) { toast("A recipe is already processing. Let it finish or stop it first."); return; }
  const job = { nodes: [...nodes], adjustments: { ...recipe.adjustments }, next: 0, active: 0, completed: 0, failures: 0, paused: false, stopped: false, startedAt: performance.now() };
  activeJob = job; $("#job-title").textContent = `Applying ${recipe.name}`; $("#job-progress").value = 0; $("#job-bar").hidden = false;
  $("#canvas-message").textContent = `Applying “${recipe.name}” to ${nodes.length} selected image${nodes.length === 1 ? "" : "s"} in place.`;
  hideContextMenu(); pumpJob(job);
}

function hideContextMenu() { contextMenu.hidden = true; }
function showContextMenu(x, y, targetNode) {
  contextMenu.dataset.pageId = "";
  if (targetNode && !selectedIds.has(targetNode.id)) setSelection([targetNode.id]);
  const selected = selectedNodes(); const images = selected.filter((node) => node.type === "image");
  const list = [];
  if (targetNode) {
    list.push({ label: "Rename layer", action: "rename" }, { label: "Duplicate", action: "duplicate" }, { label: "Bring to front", action: "front" }, { divider: true });
  }
  if (images.length) {
    if (images.length === 1) list.push({ label: "Save edits as a recipe…", action: "save-recipe", icon: "✦" });
    list.push({ label: `Apply a recipe to ${images.length} selected image${images.length === 1 ? "" : "s"}`, action: "recipe-heading", disabled: true });
    for (const recipe of recipes()) list.push({ label: recipe.name, action: "apply-recipe", recipeId: recipe.id, icon: "↗" });
    if (!recipes().length) list.push({ label: "No saved recipes yet", action: "empty-recipes", disabled: true });
    list.push({ divider: true });
  }
  if (targetNode) list.push({ label: "Delete layer", action: "delete", danger: true });
  if (!list.length) list.push({ label: "Paste an image here", action: "paste-image" });
  contextMenu.innerHTML = list.map((item) => item.divider ? `<div class="context-divider"></div>` : `<button role="menuitem" data-action="${item.action}" ${item.recipeId ? `data-recipe-id="${item.recipeId}"` : ""} ${item.disabled ? "disabled" : ""} ${item.danger ? "class=\"danger\"" : ""}><span>${item.icon ?? ""}</span>${escapeHtml(item.label)}</button>`).join("");
  contextMenu.hidden = false;
  void x; void y;
  contextMenu.dataset.targetId = targetNode?.id ?? "";
}
function showPageContextMenu(pageId) {
  const page = project.pages.find((item) => item.id === pageId); if (!page) return;
  const actions = [{ label: "Rename page…", action: "rename-page" }];
  if (project.pages.length > 1) actions.push({ label: "Delete page", action: "delete-page", danger: true });
  contextMenu.innerHTML = actions.map((item) => `<button role="menuitem" data-action="${item.action}" ${item.danger ? 'class="danger"' : ""}>${escapeHtml(item.label)}</button>`).join("");
  contextMenu.dataset.pageId = pageId; contextMenu.dataset.targetId = ""; contextMenu.hidden = false;
}
function removeSelected() {
  if (!selectedIds.size) return;
  pushHistory();
  const removed = model.nodes.filter((node) => selectedIds.has(node.id));
  const remaining = model.nodes.filter((node) => !selectedIds.has(node.id));
  for (const node of removed) {
    engine.dispose(node.id);
    if (node.previewBitmap && node.previewBitmap !== node.sourceBitmap && !remaining.some((other) => other.previewBitmap === node.previewBitmap)) node.previewBitmap.close?.();
    if (node.sourceBitmap && !remaining.some((other) => other.sourceBitmap === node.sourceBitmap)) node.sourceBitmap.close?.();
  }
  model.nodes = model.nodes.filter((node) => !selectedIds.has(node.id)); selectedIds.clear(); renderAll(); scheduleSave();
}
function duplicateSelected() {
  const sources = selectedNodes(); if (!sources.length) return;
  pushHistory(); const copies = sources.map((node) => ({ ...node, id: makeId(node.type), name: `${node.name} copy`, x: node.x + 24, y: node.y + 24, sourceBytes: node.sourceBytes?.slice(), sourceBitmap: node.sourceBitmap, previewBitmap: node.previewBitmap, adjustments: node.adjustments ? { ...node.adjustments } : undefined }));
  model.nodes.push(...copies); selectedIds = new Set(copies.map((node) => node.id)); renderAll(); scheduleSave();
}
function contextAction(event) {
  const button = event.target.closest("button[data-action]"); if (!button) return;
  const action = button.dataset.action; const target = nodeById(contextMenu.dataset.targetId); const pageId = contextMenu.dataset.pageId; hideContextMenu();
  if (pageId && action === "rename-page") {
    const page = project.pages.find((item) => item.id === pageId);
    const name = page && prompt("Rename page", page.name)?.trim();
    if (page && name) { page.name = name.slice(0, 80); renderPages(); scheduleSave(); }
    return;
  }
  if (pageId && action === "delete-page") {
    const page = project.pages.find((item) => item.id === pageId);
    if (page && confirm(`Delete “${page.name}” and all of its layers?`)) deletePage(pageId);
    return;
  }
  if (action === "save-recipe") openRecipeDialog(selectedImageNodes());
  else if (action === "apply-recipe") { const recipe = recipes().find((item) => item.id === button.dataset.recipeId); if (recipe) applyRecipe(recipe); }
  else if (action === "duplicate") duplicateSelected();
  else if (action === "front" && target) { pushHistory(); model.nodes.splice(model.nodes.indexOf(target), 1); model.nodes.push(target); renderAll(); scheduleSave(); }
  else if (action === "delete") removeSelected();
  else if (action === "rename" && target) { const input = inspector.querySelector('[data-prop="name"]'); if (input) { input.focus(); input.select(); } else toast("Edit the layer name in the inspector"); }
  else if (action === "paste-image") imageInput.click();
}

function beginInspectorEdit() { if (!editBaseline) editBaseline = snapshot(); }
function commitInspectorEdit() {
  if (!editBaseline) return;
  const after = snapshot(); if (!sameSnapshot(editBaseline, after)) { undoStack.push(editBaseline); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; }
  editBaseline = null; scheduleSave();
}
function updateProperties(event) {
  const target = event.target;
  const prop = target.dataset.prop;
  const adjustment = target.dataset.adjustment;
  const nodes = selectedNodes(); if (!prop && !adjustment) return;
  beginInspectorEdit();
  if (adjustment) {
    for (const node of nodes.filter((candidate) => candidate.type === "image")) {
      node.adjustments ??= { brightness: 0, contrast: 0, saturation: 0, blur: 0 };
      node.adjustments[adjustment] = Number(target.value);
      const output = target.parentElement.querySelector("output"); if (output) output.textContent = target.value;
      if (!activeJob) scheduleImageRender(node);
    }
    return;
  }
  const value = target.type === "color" ? target.value : target.type === "number" || target.type === "range" ? Number(target.value) : target.value;
  for (const node of nodes) {
    if ((prop === "x" || prop === "y" || prop === "w" || prop === "h") && nodes.length > 1) continue;
    node[prop] = prop === "opacity" ? Number(value) / (target.getAttribute("aria-label") === "Opacity percent" ? 100 : 100) : value;
    if (prop === "text") node.h = Math.max(node.fontSize * 1.2, node.text.split("\n").length * node.fontSize * (node.lineHeight ?? 1.2));
    if (prop === "strokeWidth" && value === 0) node.stroke = "";
  }
  const output = target.parentElement?.querySelector("output"); if (output) output.textContent = prop === "opacity" ? `${value}%` : String(value);
  renderer.draw([...selectedIds]);
  $("#selection-label").textContent = nodes.length === 1 ? nodes[0].name : `${nodes.length} layers selected`;
  $("#selection-size").textContent = nodes.length === 1 ? `${Math.round(nodes[0].w)} × ${Math.round(nodes[0].h)}` : `${nodes.length} layers`;
  if (prop === "name") renderLayers();
}

function selectLayerFromTarget(target, event) {
  const row = target.closest(".layer-row[data-id]");
  if (!row) {
    const group = target.closest(".layer-row[data-group]");
    if (group) { const id = group.dataset.group; if (expandedGroups.has(id)) expandedGroups.delete(id); else expandedGroups.add(id); renderLayers(); }
    else if (target.closest("[data-frame-row]")) { frameExpanded = !frameExpanded; renderLayers(); }
    return;
  }
  const id = row.dataset.id;
  if (event.metaKey || event.ctrlKey || event.shiftKey) {
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    if (!selectedIds.size) selectedIds.add(id);
  } else selectedIds = new Set([id]);
  renderAll();
}

function stagePoint(event) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  const point = stagePoint(event); const hit = renderer.hitTest(point.x, point.y);
  if (spaceHeld || activeTool === "hand" || event.button === 1) {
    pointerState = { kind: "pan", pointerId: event.pointerId, start: point, tx: renderer.tx, ty: renderer.ty };
    canvas.setPointerCapture(event.pointerId); canvas.classList.add("canvas-grabbing"); return;
  }
  if (activeTool === "select" && selectedIds.size) {
    const handle = renderer.selectionHandleAt(point.x, point.y, [...selectedIds], event.pointerType === "touch" ? 18 : 8);
    const nodes = selectedNodes().filter((node) => !node.hidden);
    if (handle && nodes.length && nodes.every((node) => !node.locked)) {
      pushHistory();
      pointerState = {
        kind: "resize", pointerId: event.pointerId, handle,
        start: renderer.toWorld(point.x, point.y), bounds: renderer.getSelectionBounds([...selectedIds]),
        initial: nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, w: node.w, h: node.h, fontSize: node.fontSize })),
      };
      canvas.setPointerCapture(event.pointerId); canvas.classList.add("canvas-resizing"); return;
    }
  }
  if (["rectangle", "ellipse", "text", "frame"].includes(activeTool)) {
    const node = addNode(activeTool, point.x, point.y);
    if (activeTool === "text") { renderInspector(); const input = inspector.querySelector('[data-prop="text"]'); input?.focus(); input?.select(); }
    pointerState = { kind: "create", pointerId: event.pointerId, node, start: renderer.toWorld(point.x, point.y) };
    canvas.setPointerCapture(event.pointerId); return;
  }
  if (activeTool === "image") { imageInput.click(); return; }
  if (hit) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      if (selectedIds.has(hit.id)) selectedIds.delete(hit.id); else selectedIds.add(hit.id);
      if (!selectedIds.size) selectedIds.add(hit.id);
    } else if (!selectedIds.has(hit.id)) selectedIds = new Set([hit.id]);
    pushHistory(); renderAll();
    pointerState = { kind: "move", pointerId: event.pointerId, start: renderer.toWorld(point.x, point.y), initial: selectedNodes().map((node) => ({ id: node.id, x: node.x, y: node.y })) };
    if (!hit.locked) canvas.setPointerCapture(event.pointerId);
  } else {
    if (!event.metaKey && !event.ctrlKey) { selectedIds.clear(); renderAll(); }
  }
});
canvas.addEventListener("pointermove", (event) => {
  const point = stagePoint(event); const world = renderer.toWorld(point.x, point.y);
  $("#cursor-position").textContent = `X ${Math.round(world.x)}   Y ${Math.round(world.y)}`;
  if (!pointerState || pointerState.pointerId !== event.pointerId) return;
  if (pointerState.kind === "pan") { renderer.tx = pointerState.tx + point.x - pointerState.start.x; renderer.ty = pointerState.ty + point.y - pointerState.start.y; renderer.draw([...selectedIds]); }
  else if (pointerState.kind === "move") {
    const dx = world.x - pointerState.start.x, dy = world.y - pointerState.start.y;
    for (const initial of pointerState.initial) { const node = nodeById(initial.id); if (node && !node.locked) { node.x = Math.round(initial.x + dx); node.y = Math.round(initial.y + dy); } }
    renderer.draw([...selectedIds]); const node = primaryNode(); $("#stage-coordinates").textContent = node ? `X ${node.x}   Y ${node.y}` : "";
    $("#selection-size").textContent = node ? `${Math.round(node.w)} × ${Math.round(node.h)}` : "";
    for (const prop of ["x", "y"]) { const input = inspector.querySelector(`[data-prop="${prop}"]`); if (input && node) input.value = node[prop]; }
  } else if (pointerState.kind === "resize") {
    for (const initial of pointerState.initial) {
      const node = nodeById(initial.id);
      if (node) Object.assign(node, { x: initial.x, y: initial.y, w: initial.w, h: initial.h, fontSize: initial.fontSize });
    }
    const bounds = resizedBounds(pointerState.bounds, pointerState.handle, world, { preserveAspect: event.shiftKey });
    scaleNodesToBounds(pointerState.initial.map((initial) => nodeById(initial.id)).filter(Boolean), pointerState.bounds, bounds);
    renderer.draw([...selectedIds]);
  } else if (pointerState.kind === "create") {
    const node = pointerState.node; const start = pointerState.start;
    const w = Math.max(10, Math.abs(world.x - start.x)); const h = Math.max(10, Math.abs(world.y - start.y));
    node.x = Math.round(Math.min(start.x, world.x)); node.y = Math.round(Math.min(start.y, world.y)); node.w = Math.round(w); node.h = Math.round(h);
    renderer.draw([...selectedIds]);
  }
});
canvas.addEventListener("pointerup", (event) => {
  if (!pointerState || pointerState.pointerId !== event.pointerId) return;
  if (pointerState.kind === "pan") canvas.classList.remove("canvas-grabbing");
  if (pointerState.kind === "resize") canvas.classList.remove("canvas-resizing");
  if (["move", "resize", "create"].includes(pointerState.kind)) { renderAll(); scheduleSave(); }
  pointerState = null;
});
canvas.addEventListener("pointercancel", () => {
  if (pointerState?.kind === "resize") {
    for (const initial of pointerState.initial) {
      const node = nodeById(initial.id);
      if (node) Object.assign(node, { x: initial.x, y: initial.y, w: initial.w, h: initial.h, fontSize: initial.fontSize });
    }
    canvas.classList.remove("canvas-resizing"); renderer.draw([...selectedIds]);
  }
  pointerState = null;
});
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault(); const point = stagePoint(event); const hit = renderer.hitTest(point.x, point.y); showContextMenu(event.clientX, event.clientY, hit);
});
canvas.addEventListener("wheel", (event) => {
  if (event.ctrlKey || event.metaKey) { event.preventDefault(); const point = stagePoint(event); renderer.zoomAt(event.deltaY < 0 ? 1.08 : .92, point.x, point.y); $("#zoom-value").textContent = `${Math.round(renderer.scale * 100)}%`; }
}, { passive: false });

layerTree.addEventListener("click", (event) => selectLayerFromTarget(event.target, event));
layerTree.addEventListener("contextmenu", (event) => {
  const row = event.target.closest(".layer-row[data-id]"); if (!row) return;
  event.preventDefault(); const node = nodeById(row.dataset.id); showContextMenu(event.clientX, event.clientY, node);
});
$("#page-list").addEventListener("click", (event) => {
  const button = event.target.closest(".page-row[data-page-id]"); if (button) activatePage(button.dataset.pageId);
});
$("#page-list").addEventListener("contextmenu", (event) => {
  const button = event.target.closest(".page-row[data-page-id]"); if (!button) return;
  event.preventDefault(); showPageContextMenu(button.dataset.pageId);
});
inspector.addEventListener("focusin", beginInspectorEdit);
inspector.addEventListener("input", updateProperties);
inspector.addEventListener("change", (event) => { updateProperties(event); commitInspectorEdit(); });
inspector.addEventListener("focusout", (event) => { if (event.target.matches("input,textarea,select")) setTimeout(commitInspectorEdit, 0); });
contextMenu.addEventListener("click", contextAction);
imageInput.addEventListener("change", () => { placeImageFiles(imageInput.files); imageInput.value = ""; });
$("#doc-title").addEventListener("input", () => { project.title = $("#doc-title").value; scheduleSave(); document.title = `${project.title} — Tiny Image Star`; });

$("#file-menu-button").addEventListener("click", () => { const menu = $("#file-menu"); menu.hidden = !menu.hidden; $("#file-menu-button").setAttribute("aria-expanded", String(!menu.hidden)); });
$("#main-menu-button").addEventListener("click", () => { $("#file-menu").hidden = false; $("#file-menu-button").setAttribute("aria-expanded", "true"); });
$("#file-menu").addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action; if (!action) return;
  $("#file-menu").hidden = true; $("#file-menu-button").setAttribute("aria-expanded", "false");
  if (action === "open-image") imageInput.click();
  if (action === "open-project") $("#project-input").click();
  if (action === "save-file") exportProject();
  if (action === "export-file") exportFrame();
  if (action === "new-file") {
    if (confirm("Start a new local design? Export the current project first if you want to keep it.")) {
      for (const page of project.pages) for (const node of page.nodes) if (node.type === "image") {
        engine.dispose(node.id); node.sourceBitmap?.close?.(); if (node.previewBitmap !== node.sourceBitmap) node.previewBitmap?.close?.();
      }
      project = initialProject(); model = project.pages[0]; renderer.doc = model; $("#doc-title").value = project.title;
      document.title = `${project.title} — Tiny Image Star`; selectedIds = new Set(["hero-heading"]);
      expandedGroups = new Set(model.groups.map((group) => group.id)); undoStack = []; redoStack = []; renderer.fit(); renderAll(); scheduleSave();
    }
  }
});
$("#project-input").addEventListener("change", () => { const file = $("#project-input").files?.[0]; if (file) openProjectFile(file); $("#project-input").value = ""; });
$("#export-button").addEventListener("click", exportFrame);
$("#present-button").addEventListener("click", () => { app.classList.toggle("presenting"); renderer.fit(); renderer.draw([...selectedIds]); });
$("#zoom-in").addEventListener("click", () => { renderer.zoomAt(1.2); renderAll(); });
$("#zoom-out").addEventListener("click", () => { renderer.zoomAt(.83); renderAll(); });
$("#fit-canvas").addEventListener("click", () => { renderer.fit(); renderAll(); });
$("#outline-toggle").addEventListener("click", (event) => { outlineMode = !outlineMode; app.classList.toggle("outline-mode", outlineMode); event.currentTarget.classList.toggle("active", outlineMode); renderer.draw([...selectedIds]); });
$("#ruler-toggle").addEventListener("click", (event) => { event.currentTarget.classList.toggle("active"); toast("Canvas rulers are on the next build slice"); });
$("#add-page").addEventListener("click", addPage);
$("#assets-tab").addEventListener("click", () => { activeLeftTab = "assets"; $(".left-tab.active")?.classList.remove("active"); $("#assets-tab").classList.add("active"); renderLayers(); });
$(".left-tab:first-child").addEventListener("click", () => { activeLeftTab = "layers"; $(".left-tab.active")?.classList.remove("active"); $(".left-tab:first-child").classList.add("active"); renderLayers(); });
$("#layer-search").addEventListener("click", () => { const box = $("#layer-search-box"); box.hidden = !box.hidden; if (!box.hidden) $("#layer-filter").focus(); else { $("#layer-filter").value = ""; renderLayers(); } });
$("#layer-filter").addEventListener("input", renderLayers);
$("#mobile-layers").addEventListener("click", () => { app.classList.toggle("show-layers"); app.classList.remove("show-inspector"); });
function syncMobilePanels() {
  $("#mobile-backdrop").hidden = !app.classList.contains("show-layers") && !app.classList.contains("show-inspector");
}
$("#mobile-layers").addEventListener("click", syncMobilePanels);
$("#mobile-inspector").addEventListener("click", () => { app.classList.toggle("show-inspector"); app.classList.remove("show-layers"); syncMobilePanels(); });
$("#mobile-backdrop").addEventListener("click", () => { app.classList.remove("show-layers", "show-inspector"); syncMobilePanels(); });
$$(".tool[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
$("#job-speed").addEventListener("change", () => { if (activeJob) pumpJob(activeJob); });
$("#job-pause").addEventListener("click", () => {
  if (!activeJob) return; activeJob.paused = !activeJob.paused; $("#job-pause").textContent = activeJob.paused ? "Resume" : "Pause"; updateJobView(); if (!activeJob.paused) pumpJob(activeJob);
});
$("#job-stop").addEventListener("click", () => { if (activeJob) { activeJob.stopped = true; pumpJob(activeJob); } });
$("#inspector-content").addEventListener("click", (event) => { if (event.target.closest('[data-action="save-recipe"]')) openRecipeDialog(selectedImageNodes()); });
$(".inspector-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-inspector-tab]"); if (!button || button.dataset.inspectorTab === "design") return;
  toast("Prototype connections need a local interaction model; they are part of the next implementation slice.");
});
$("#search-button").addEventListener("click", () => { $("#layer-search-box").hidden = false; $("#layer-filter").focus(); });
$("#local-status").addEventListener("click", () => toast("This workspace stores the design locally. Image decoding and adjustment run in local WebAssembly."));
$("#add-export-setting").addEventListener("click", exportFrame);

document.addEventListener("click", (event) => {
  if (!event.target.closest("#context-menu")) hideContextMenu();
  if (!event.target.closest(".file-menu-wrap")) { $("#file-menu").hidden = true; $("#file-menu-button").setAttribute("aria-expanded", "false"); }
});
document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !event.target.matches("input,textarea,select")) { spaceHeld = true; event.preventDefault(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelected(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); exportProject(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#layer-search-box").hidden = false; $("#layer-filter").focus(); return; }
  if (event.key === "Escape") { hideContextMenu(); app.classList.remove("presenting", "show-layers", "show-inspector"); recipeDialog.open && recipeDialog.close(); }
  if ((event.key === "Delete" || event.key === "Backspace") && !event.target.matches("input,textarea,select")) { event.preventDefault(); removeSelected(); }
  if (event.target.matches("input,textarea,select") || event.metaKey || event.ctrlKey || event.altKey) return;
  const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (nudge && selectedIds.size) {
    event.preventDefault();
    if (!event.repeat) pushHistory();
    const distance = event.shiftKey ? 10 : 1;
    for (const node of selectedNodes()) if (!node.locked) { node.x += nudge[0] * distance; node.y += nudge[1] * distance; }
    renderAll(); scheduleSave(); return;
  }
  const keys = { v: "select", h: "hand", r: "rectangle", o: "ellipse", t: "text", f: "frame" };
  if (keys[event.key.toLowerCase()]) setTool(keys[event.key.toLowerCase()]);
});
document.addEventListener("keyup", (event) => { if (event.code === "Space") spaceHeld = false; });
window.addEventListener("beforeunload", () => engine.destroy());

renderAll(); scheduleSave();
