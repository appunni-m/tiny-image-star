import { clone, createSceneProject, newId } from "./model.js";

export const DESIGN_PAGE_SIZE = Object.freeze({ width: 1920, height: 1080 });
export const MAX_DESIGN_PAGE_LAYERS = 200;

function checkedPageSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 16384 || height > 16384 || width * height > 80_000_000) {
    throw new Error("Choose a page size within the supported pixel limit.");
  }
  return { width, height };
}

function checkedImage(asset) {
  if (!asset || asset.kind !== "image" || typeof asset.id !== "string" || !asset.id || asset.id.length > 512
    || ["__proto__", "prototype", "constructor"].includes(asset.id)
    || typeof asset.name !== "string" || !asset.name.trim() || asset.name.length > 50_000
    || typeof asset.type !== "string" || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1
    || asset.byteLength > 160 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "")
    || !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width < 1 || asset.height < 1
    || asset.width * asset.height > 80_000_000 || !["upright", "exif-to-upright"].includes(asset.orientation)) {
    throw new Error("An image layer needs verified local source metadata.");
  }
}

function layoutImages(images, { width, height }) {
  const count = images.length;
  if (!count) return [];
  const edge = Math.min(width, height), padding = Math.round(edge * 0.035), gap = Math.round(edge * 0.02);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count * width / height)));
  const rows = Math.ceil(count / columns);
  const cellWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
  const cellHeight = (height - padding * 2 - gap * (rows - 1)) / rows;
  return images.map((asset, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    return { x: (padding + column * (cellWidth + gap)) / width, y: (padding + row * (cellHeight + gap)) / height,
      width: cellWidth / width, height: cellHeight / height };
  });
}

/** Create a single editable page whose image nodes are independent selectable layers. */
export function createDesignPageProject({ images = [], name = "Untitled design", pageName = "Page 1", width = DESIGN_PAGE_SIZE.width,
  height = DESIGN_PAGE_SIZE.height, id = newId("project"), slideId = newId("page"), createdAt = Date.now() } = {}) {
  const size = checkedPageSize(width, height);
  if (!Array.isArray(images) || images.length > MAX_DESIGN_PAGE_LAYERS) throw new Error(`A page can contain up to ${MAX_DESIGN_PAGE_LAYERS} image layers.`);
  if (typeof name !== "string" || !name.trim() || name.length > 120 || typeof pageName !== "string" || !pageName.trim() || pageName.length > 120)
    throw new Error("Give the design and page a name.");
  const ids = new Set();
  for (const asset of images) {
    checkedImage(asset);
    if (ids.has(asset.id)) throw new Error("Each page image needs a unique source asset.");
    ids.add(asset.id);
  }
  const frames = layoutImages(images, size), nodes = {}, assets = {};
  images.forEach((asset, index) => {
    const nodeId = newId("layer");
    assets[asset.id] = clone(asset);
    nodes[nodeId] = { id: nodeId, kind: "image", name: asset.name.slice(0, 120), visible: true, locked: false,
      assetId: asset.id, space: "slide", frame: frames[index], fit: "contain", focal: { x: 0.5, y: 0.5 } };
  });
  return createSceneProject({ id, name: name.trim(), createdAt, assets, nodes,
    slides: [{ id: slideId, name: pageName.trim(), nodeIds: Object.keys(nodes), overrides: {} }],
    variants: [{ id: "page", ...size }] });
}

function getLayer(project, nodeId) {
  const layer = project.nodes[nodeId];
  if (!layer || !project.slides.some((page) => page.nodeIds.includes(nodeId))) throw new Error("Choose a layer on this page.");
  return layer;
}

export function renameLayerCommand(project, nodeId, name) {
  const current = getLayer(project, nodeId);
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) throw new Error("Layer names must contain 1–120 characters.");
  return { type: "node", id: nodeId, value: { ...clone(current), name: name.trim() } };
}

export function setLayerVisibilityCommand(project, nodeId, visible) {
  const current = getLayer(project, nodeId);
  if (typeof visible !== "boolean") throw new Error("Choose whether the layer is visible.");
  return { type: "node", id: nodeId, value: { ...clone(current), visible } };
}

export function setLayerLockedCommand(project, nodeId, locked) {
  const current = getLayer(project, nodeId);
  if (typeof locked !== "boolean") throw new Error("Choose whether the layer is locked.");
  return { type: "node", id: nodeId, value: { ...clone(current), locked } };
}

export function reorderLayerCommand(project, pageId, nodeId, targetIndex) {
  const page = project.slides.find((entry) => entry.id === pageId);
  if (!page || !page.nodeIds.includes(nodeId) || !Number.isInteger(targetIndex)) throw new Error("Choose a layer position on this page.");
  const nodeIds = [...page.nodeIds], [layerId] = nodeIds.splice(nodeIds.indexOf(nodeId), 1);
  nodeIds.splice(Math.max(0, Math.min(targetIndex, nodeIds.length)), 0, layerId);
  return { type: "slides", value: project.slides.map((entry) => entry.id === pageId ? { ...clone(entry), nodeIds } : clone(entry)) };
}

/** Selection is transient UI state, kept out of the saved document and history. */
export function updatePageSelection(current, layerIds, targetId, { toggle = false, extend = false } = {}) {
  if (!layerIds.includes(targetId)) return { ids: [...(current?.ids ?? [])], anchorId: current?.anchorId ?? null };
  const prior = new Set((current?.ids ?? []).filter((id) => layerIds.includes(id)));
  let next = new Set([targetId]), anchorId = targetId;
  if (extend) {
    const anchor = layerIds.includes(current?.anchorId) ? current.anchorId : targetId;
    const first = layerIds.indexOf(anchor), last = layerIds.indexOf(targetId);
    const range = layerIds.slice(Math.min(first, last), Math.max(first, last) + 1);
    next = toggle ? prior : new Set();
    for (const id of range) next.add(id);
    anchorId = anchor;
  } else if (toggle) {
    next = prior;
    if (next.has(targetId)) next.delete(targetId); else next.add(targetId);
    anchorId = targetId;
  }
  return { ids: layerIds.filter((id) => next.has(id)), anchorId };
}

export function snapshotPageSelection(selection, page) {
  const selected = new Set(selection?.ids ?? []);
  return page.nodeIds.filter((id) => selected.has(id));
}
