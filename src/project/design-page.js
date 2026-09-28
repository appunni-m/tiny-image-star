import { clone, createSceneProject, newId, resolveLayerFrames } from "./model.js";

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

export function addDesignPageCommand(project) {
  if (project.slides.length >= 40) throw new Error("A design file can contain up to 40 pages.");
  const id = newId("page"), page = { id, name: `Page ${project.slides.length + 1}`, nodeIds: [], overrides: {} };
  return { id, command: { type: "slides", value: [...clone(project.slides), page] } };
}

export function appendDesignImagesCommand(project, pageId, images) {
  const page = project.slides.find((entry) => entry.id === pageId);
  if (!page || !Array.isArray(images) || !images.length || images.length + page.nodeIds.length > MAX_DESIGN_PAGE_LAYERS)
    throw new Error(`Choose images that fit the page limit of ${MAX_DESIGN_PAGE_LAYERS} layers.`);
  const existing = new Set(Object.keys(project.assets));
  const additions = [], ids = new Set(), nodeIds = [...page.nodeIds];
  images.forEach((asset, index) => {
    checkedImage(asset);
    if (existing.has(asset.id) || ids.has(asset.id)) throw new Error("Each page image needs a unique source asset.");
    ids.add(asset.id);
    const id = newId("layer"), offset = index % 4;
    const frame = { x: .29 + offset * .035, y: .27 + offset * .035, width: .42, height: .42 };
    additions.push({ type: "asset", id: asset.id, value: clone(asset) },
      { type: "node", id, value: { id, kind: "image", name: asset.name.slice(0, 120), visible: true, locked: false,
        assetId: asset.id, space: "slide", frame, fit: "contain", focal: { x: .5, y: .5 } } });
    nodeIds.push(id);
  });
  const slides = project.slides.map((entry) => entry.id === pageId ? { ...clone(entry), nodeIds } : clone(entry));
  return { type: "group", commands: [...additions, { type: "slides", value: slides }] };
}

export function addTextLayerCommand(project, pageId, text = "Add text") {
  const page = project.slides.find((entry) => entry.id === pageId);
  if (!page || page.nodeIds.length >= MAX_DESIGN_PAGE_LAYERS || typeof text !== "string" || text.length > 5000)
    throw new Error("This page cannot add another text layer.");
  const id = newId("layer"), node = { id, kind: "text", name: "Text", visible: true, locked: false, space: "slide",
    frame: { x: .2, y: .2, width: .6, height: .2 }, text, color: "#f8f8fb",
    style: { builtinFont: "system-sans", fontSize: .08, minFontSize: .03, weight: 700, fit: "shrink" } };
  return { type: "group", commands: [{ type: "node", id, value: node }, { type: "slides", value: project.slides.map((entry) =>
    entry.id === pageId ? { ...clone(entry), nodeIds: [...entry.nodeIds, id] } : clone(entry)) }] };
}

export function addShapeLayerCommand(project, pageId, shape = "rectangle") {
  const page = project.slides.find((entry) => entry.id === pageId);
  if (!page || page.nodeIds.length >= MAX_DESIGN_PAGE_LAYERS || !["rectangle", "rounded", "ellipse"].includes(shape))
    throw new Error("This page cannot add that shape.");
  const id = newId("layer"), name = ({ rectangle: "Rectangle", rounded: "Rounded rectangle", ellipse: "Ellipse" })[shape];
  const node = { id, kind: "shape", name, visible: true, locked: false,
    space: "slide", frame: { x: .35, y: .35, width: .3, height: .3 }, color: "#5149d5",
    style: { shape, ...(shape === "rounded" ? { radius: .08 } : {}) } };
  return { type: "group", commands: [{ type: "node", id, value: node }, { type: "slides", value: project.slides.map((entry) =>
    entry.id === pageId ? { ...clone(entry), nodeIds: [...entry.nodeIds, id] } : clone(entry)) }] };
}

/** Add a locally editable vector path to a design page. Points and handles are frame-relative. */
export function addVectorLayerCommand(project, pageId, { frame, path, name = "Vector", strokeColor = "#5149d5", strokeWidth = .012 } = {}) {
  const page = project.slides.find((entry) => entry.id === pageId);
  if (!page || page.nodeIds.length >= MAX_DESIGN_PAGE_LAYERS || !frame || !path
    || typeof name !== "string" || !name.trim() || name.length > 120) throw new Error("This page cannot add that vector.");
  const id = newId("layer"), node = { id, kind: "shape", name: name.trim(), visible: true, locked: false,
    space: "slide", frame: clone(frame), color: "#5149d5",
    style: { shape: "path", path: clone(path), ...(!path.closed ? { strokeColor, strokeWidth } : {}) } };
  return { type: "group", commands: [{ type: "node", id, value: node }, { type: "slides", value: project.slides.map((entry) =>
    entry.id === pageId ? { ...clone(entry), nodeIds: [...entry.nodeIds, id] } : clone(entry)) }] };
}

/** Wrap selected sibling layers in a frame while preserving their local placement and stack order. */
export function addFrameAroundSelectionCommand(project, pageId, nodeIds) {
  const page = project.slides.find((entry) => entry.id === pageId);
  if (!page || !Array.isArray(nodeIds) || nodeIds.length < 2 || nodeIds.length > MAX_DESIGN_PAGE_LAYERS)
    throw new Error("Select at least two layers to create a frame.");
  const unique = [...new Set(nodeIds)];
  if (unique.length !== nodeIds.length) throw new Error("A layer can only be selected once.");
  for (const id of unique) getLayer(project, id);
  if (page.nodeIds.length >= MAX_DESIGN_PAGE_LAYERS) throw new Error(`A page can contain up to ${MAX_DESIGN_PAGE_LAYERS} layers.`);
  const parentId = project.nodes[unique[0]].parentId ?? null;
  if (unique.some((id) => (project.nodes[id].parentId ?? null) !== parentId))
    throw new Error("Select layers from the same frame to group them.");
  if (unique.some((id) => project.nodes[id].kind === "legacy-image")) throw new Error("Legacy image layers cannot be nested.");
  const indexes = unique.map((id) => page.nodeIds.indexOf(id)), firstIndex = Math.min(...indexes);
  const frames = unique.map((id) => project.nodes[id].frame);
  const left = Math.min(...frames.map((frame) => frame.x)), top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width)), bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  const frame = { x: left, y: top, width: right - left, height: bottom - top };
  if (![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) || frame.width <= 0 || frame.height <= 0)
    throw new Error("The selected layers need valid geometry to create a frame.");
  const id = newId("frame"), node = { id, kind: "frame", name: "Frame", visible: true, locked: false, space: "slide", frame,
    style: { clipContent: true }, ...(parentId ? { parentId, constraints: { horizontal: "left", vertical: "top" } } : {}) };
  const commands = [{ type: "node", id, value: node }];
  for (const childId of unique) {
    const child = project.nodes[childId];
    commands.push({ type: "node", id: childId, value: { ...clone(child),
      frame: { x: (child.frame.x - left) / frame.width, y: (child.frame.y - top) / frame.height,
        width: child.frame.width / frame.width, height: child.frame.height / frame.height },
      parentId: id, constraints: { horizontal: "left", vertical: "top" } } });
  }
  const selectedSet = new Set(unique), selectedSubtree = page.nodeIds.filter((entry) => {
    let parent = project.nodes[entry]?.parentId;
    while (parent) { if (selectedSet.has(parent)) return true; parent = project.nodes[parent]?.parentId; }
    return selectedSet.has(entry);
  });
  const subtreeSet = new Set(selectedSubtree), nodeIdsOnPage = page.nodeIds.filter((entry) => !subtreeSet.has(entry));
  nodeIdsOnPage.splice(firstIndex, 0, id, ...selectedSubtree);
  const slides = project.slides.map((entry) => entry.id === pageId ? { ...clone(entry), nodeIds: nodeIdsOnPage } : clone(entry));
  commands.push({ type: "slides", value: slides });
  return { id, command: { type: "group", commands } };
}

function constrainedAxis(position, size, oldParentSize, newParentSize, mode) {
  const start = position * oldParentSize, extent = size * oldParentSize;
  const endGap = oldParentSize - start - extent;
  let nextStart = start, nextExtent = extent;
  if (mode === "right" || mode === "bottom") nextStart = newParentSize - endGap - extent;
  else if (mode === "left-right" || mode === "top-bottom") nextExtent = Math.max(.01, newParentSize - start - endGap);
  else if (mode === "center") nextStart = (newParentSize - extent) / 2 + (start + extent / 2 - oldParentSize / 2);
  else if (mode === "scale") { nextStart = position * newParentSize; nextExtent = size * newParentSize; }
  return { position: nextStart / newParentSize, size: nextExtent / newParentSize };
}

/** Return frame and descendant geometry updates for a resized frame using each child's constraints. */
export function resizeFrameChildren(project, pageId, frameId, nextFrame) {
  const page = project.slides.find((entry) => entry.id === pageId), parent = project.nodes[frameId];
  if (!page || !parent || parent.kind !== "frame" || !nextFrame) throw new Error("Choose a frame and a new frame size.");
  const commands = [];
  const resizeChildren = (container, oldFrame, newFrame) => {
    if (container.style?.layout) return;
    for (const id of page.nodeIds) {
      const child = project.nodes[id]; if (child.parentId !== container.id) continue;
      const constraints = child.constraints ?? { horizontal: "left", vertical: "top" };
      const horizontal = constrainedAxis(child.frame.x, child.frame.width, oldFrame.width, newFrame.width, constraints.horizontal);
      const vertical = constrainedAxis(child.frame.y, child.frame.height, oldFrame.height, newFrame.height, constraints.vertical);
      const resized = { ...clone(child), frame: { x: horizontal.position, y: vertical.position, width: horizontal.size, height: vertical.size } };
      commands.push({ type: "node", id, value: resized });
      if (child.kind === "frame") resizeChildren(child, child.frame, resized.frame);
    }
  };
  resizeChildren(parent, parent.frame, nextFrame);
  return commands;
}

/** Change a frame's Auto Layout flow while preserving each layer's current pixel size. */
export function setFrameLayoutCommand(project, pageId, frameId, direction) {
  const page = project.slides.find((entry) => entry.id === pageId), frame = project.nodes[frameId];
  if (!page || frame?.kind !== "frame" || !["manual", "horizontal", "vertical"].includes(direction))
    throw new Error("Choose a frame and a supported layout flow.");
  const variant = project.variants[0], resolvedByVariant = new Map(project.variants.map((shape) => [shape.id, resolveLayerFrames(project, pageId, shape.id)]));
  const resolved = resolvedByVariant.get(variant.id), world = resolved.get(frameId);
  if (!world) throw new Error("The frame is not on this page.");
  const commands = [], parent = clone(frame), children = page.nodeIds.filter((id) => project.nodes[id]?.parentId === frameId);
  const measuredSize = (id, variantId = variant.id) => {
    const shape = project.variants.find((entry) => entry.id === variantId), bounds = resolvedByVariant.get(variantId)?.get(id)?.frame;
    if (!shape) return null;
    return bounds ? { width: Math.max(.01, bounds.width * shape.width), height: Math.max(.01, bounds.height * shape.height) } : null;
  };
  const localFrame = (id, containerId, variantId) => {
    const shape = project.variants.find((entry) => entry.id === variantId), child = resolvedByVariant.get(variantId)?.get(id), container = resolvedByVariant.get(variantId)?.get(containerId);
    if (!child || !container || !shape || container.frame.width <= 0 || container.frame.height <= 0) return null;
    const width = child.frame.width / container.frame.width, height = child.frame.height / container.frame.height;
    const dx = (child.frame.x + child.frame.width / 2 - container.frame.x - container.frame.width / 2) * shape.width;
    const dy = (child.frame.y + child.frame.height / 2 - container.frame.y - container.frame.height / 2) * shape.height;
    const angle = -container.rotation * Math.PI / 180, xOffset = dx * Math.cos(angle) - dy * Math.sin(angle);
    const yOffset = dx * Math.sin(angle) + dy * Math.cos(angle);
    return { x: .5 + xOffset / (container.frame.width * shape.width) - width / 2,
      y: .5 + yOffset / (container.frame.height * shape.height) - height / 2, width, height };
  };
  const storeManualFrame = (id, node) => {
    if (id === frameId) {
      if (node.parentId) node.frame = localFrame(id, node.parentId, variant.id) ?? node.frame;
      else node.frame = { ...node.frame, width: world.frame.width, height: world.frame.height };
      const variants = {};
      for (const shape of project.variants.slice(1)) {
        if (node.parentId) variants[shape.id] = localFrame(id, node.parentId, shape.id) ?? node.frame;
        else {
          const bounds = resolvedByVariant.get(shape.id)?.get(frameId)?.frame;
          if (bounds) variants[shape.id] = { ...node.frame, width: bounds.width, height: bounds.height };
        }
      }
      if (Object.keys(variants).length) node.variantFrames = variants;
      else delete node.variantFrames;
    } else if (node.parentId === frameId) {
      node.frame = localFrame(id, frameId, variant.id) ?? node.frame;
      const variants = {};
      for (const shape of project.variants.slice(1)) variants[shape.id] = localFrame(id, frameId, shape.id) ?? node.frame;
      if (Object.keys(variants).length) node.variantFrames = variants;
      else delete node.variantFrames;
    }
  };
  parent.layoutSize ??= measuredSize(frameId);
  parent.layoutSizing ??= { width: "fixed", height: "fixed" };
  parent.layoutSizing = { width: "fixed", height: "fixed", ...parent.layoutSizing };
  parent.style = { ...parent.style };
  if (direction === "manual") {
    delete parent.style.layout;
    for (const axis of ["width", "height"]) if (parent.layoutSizing[axis] === "hug") parent.layoutSizing[axis] = "fixed";
    parent.layoutSize = measuredSize(frameId);
    storeManualFrame(frameId, parent);
  } else {
    const previous = parent.style.layout;
    parent.style.layout = { direction, gap: previous?.gap ?? 0, rowGap: previous?.rowGap, columnGap: previous?.columnGap,
      padding: previous?.padding ?? { top: 0, right: 0, bottom: 0, left: 0 }, justify: previous?.justify ?? "start",
      align: previous?.align ?? "center", wrap: previous?.wrap ?? false };
    for (const key of Object.keys(parent.style.layout)) if (parent.style.layout[key] == null) delete parent.style.layout[key];
  }
  commands.push({ type: "node", id: frameId, value: parent });
  for (const id of children) {
    const child = clone(project.nodes[id]), size = measuredSize(id);
    child.layoutSize ??= size;
    child.layoutSizing ??= { width: "fixed", height: "fixed" };
    child.layoutSizing = { width: "fixed", height: "fixed", ...child.layoutSizing };
    if (direction === "manual") {
      child.layoutSize = size;
      for (const axis of ["width", "height"]) if (child.layoutSizing[axis] === "fill") child.layoutSizing[axis] = "fixed";
      storeManualFrame(id, child);
    }
    commands.push({ type: "node", id, value: child });
  }
  return { type: "group", commands };
}

export function deleteLayersCommand(project, nodeIds) {
  if (!Array.isArray(nodeIds) || !nodeIds.length || nodeIds.length > MAX_DESIGN_PAGE_LAYERS) throw new Error("Choose up to 200 layers to delete.");
  const unique = [...new Set(nodeIds)];
  if (unique.length !== nodeIds.length) throw new Error("A layer can only be selected once.");
  for (const id of unique) getLayer(project, id);
  const removing = new Set(unique);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of Object.values(project.nodes)) if (node.parentId && removing.has(node.parentId) && !removing.has(node.id)) {
      removing.add(node.id); changed = true;
    }
  }
  if (removing.size > MAX_DESIGN_PAGE_LAYERS) throw new Error("A page can contain up to 200 layers.");
  const commands = [...removing].map((id) => ({ type: "node", id, value: null }));
  const removedAssets = new Set([...removing].map((id) => project.nodes[id]?.assetId).filter(Boolean));
  for (const assetId of removedAssets) {
    if (!Object.values(project.nodes).some((node) => !removing.has(node.id) && node.assetId === assetId))
      commands.push({ type: "asset", id: assetId, value: null });
  }
  commands.push({ type: "slides", value: project.slides.map((page) => {
    const nodeIds = page.nodeIds.filter((id) => !removing.has(id));
    return nodeIds.length === page.nodeIds.length ? clone(page) : { ...clone(page), nodeIds };
  }) });
  return { type: "group", commands };
}

export function deleteLayerCommand(project, nodeId) {
  return deleteLayersCommand(project, [nodeId]);
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
  const descendants = new Set([nodeId]);
  for (const id of page.nodeIds) {
    let parentId = project.nodes[id]?.parentId;
    while (parentId) { if (descendants.has(parentId)) { descendants.add(id); break; } parentId = project.nodes[parentId]?.parentId; }
  }
  const block = page.nodeIds.filter((id) => descendants.has(id)), peers = page.nodeIds.filter((id) =>
    project.nodes[id]?.parentId === (project.nodes[nodeId].parentId ?? null) && !descendants.has(id));
  const nodeIds = page.nodeIds.filter((id) => !descendants.has(id));
  const parentId = project.nodes[nodeId].parentId;
  let insertion;
  if (parentId) {
    const parentIndex = nodeIds.indexOf(parentId);
    const peerSubtrees = new Set(peers);
    for (const id of nodeIds) {
      let ancestor = project.nodes[id]?.parentId;
      while (ancestor) { if (peers.includes(ancestor)) { peerSubtrees.add(id); break; } ancestor = project.nodes[ancestor]?.parentId; }
    }
    const lastPeer = Math.max(-1, ...nodeIds.map((id, index) => peerSubtrees.has(id) ? index : -1));
    insertion = targetIndex >= page.nodeIds.indexOf(nodeId) ? Math.max(parentIndex + 1, lastPeer + 1) : parentIndex + 1;
  } else {
    const rootIds = nodeIds.filter((id) => project.nodes[id]?.parentId == null);
    const rootSubtrees = new Set(rootIds);
    for (const id of nodeIds) {
      let ancestor = project.nodes[id]?.parentId;
      while (ancestor) { if (rootIds.includes(ancestor)) { rootSubtrees.add(id); break; } ancestor = project.nodes[ancestor]?.parentId; }
    }
    insertion = targetIndex >= page.nodeIds.indexOf(nodeId) ? nodeIds.length : 0;
    if (!rootIds.length) insertion = 0;
    else if (insertion >= nodeIds.length) insertion = Math.max(0, ...nodeIds.map((id, index) => rootSubtrees.has(id) ? index + 1 : 0));
  }
  nodeIds.splice(Math.max(0, Math.min(insertion, nodeIds.length)), 0, ...block);
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
