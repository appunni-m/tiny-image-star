import { clone, newId, resolveSlide, validateProject } from "../project/model.js";

const requireConnection = (condition, message) => { if (!condition) throw new Error(message); };

export function connectedSlideGroup(project, slideId) {
  const index = project.slides.findIndex((slide) => slide.id === slideId);
  requireConnection(index >= 0, "Choose a slide to move.");
  const joins = new Set(Object.values(project.nodes).filter((node) => node.connection).map((node) => node.anchorSlideId));
  let start = index, end = index;
  while (start > 0 && joins.has(project.slides[start - 1].id)) start--;
  while (end < project.slides.length - 1 && joins.has(project.slides[end].id)) end++;
  return { start, end, ids: project.slides.slice(start, end + 1).map((slide) => slide.id) };
}

export function canMoveStorySlide(project, slideId, offset) {
  const group = connectedSlideGroup(project, slideId);
  return offset === -1 ? group.start > 0 : offset === 1 && group.end < project.slides.length - 1;
}

export function createConnectedCutout(project, photoId, slideId) {
  validateProject(project);
  const photo = project.nodes[photoId], index = project.slides.findIndex((slide) => slide.id === slideId);
  requireConnection(photo?.kind === "image" && photo.maskId && project.slides[index]?.nodeIds.includes(photoId), "Choose a photo with a subject mask first.");
  requireConnection(!photo.connection && project.slides.length > 1, "Choose an ordinary photo to add a connected copy.");
  const left = Math.min(index, project.slides.length - 2), slides = clone(project.slides), id = newId("connected-cutout");
  const value = clone(photo), patch = slides[index].overrides[photoId] ?? {};
  Object.assign(value, { ...patch, id, space: "story", anchorSlideId: slides[left].id, rotation: 0, fit: "contain",
    connection: { schema: 1, rightSlideId: slides[left + 1].id } });
  if (patch.appearance) value.appearance = { ...photo.appearance, ...patch.appearance };
  delete value.depthTextId; delete value.depthBackground;
  const asset = project.assets[value.assetId], crop = value.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const aspect = (Math.ceil((crop.x + crop.width) * asset.width) - Math.floor(crop.x * asset.width))
    / (Math.ceil((crop.y + crop.height) * asset.height) - Math.floor(crop.y * asset.height));
  value.variantFrames = Object.fromEntries(project.variants.map((variant) => {
    const width = Math.min(1.3, .72 * variant.height / variant.width * aspect), height = width / aspect * variant.width / variant.height;
    return [variant.id, { x: 1 - width / 2, y: .5 - height / 2, width, height }];
  }));
  value.frame = clone(value.variantFrames[project.variants[0].id]);
  for (const slide of slides.slice(left, left + 2)) slide.nodeIds.push(id);
  return { id, command: { type: "group", commands: [{ type: "node", id, value }, { type: "slides", value: slides }] } };
}

export function positionConnectedCutout(project, id, variantId, { x, y, scale }, reference = null) {
  const node = project.nodes[id];
  requireConnection(node?.connection && project.variants.some((variant) => variant.id === variantId), "Choose a connected cutout and output shape.");
  requireConnection([x, y, scale].every(Number.isFinite) && x >= 0 && x <= 2 && y >= 0 && y <= 1 && scale >= .25 && scale <= 2, "Keep the subject inside the spread and choose a size from 25–200%.");
  const box = reference ?? node.variantFrames?.[variantId] ?? node.frame;
  const frame = { x: x - box.width * scale / 2, y: y - box.height * scale / 2, width: box.width * scale, height: box.height * scale };
  return { type: "node", id, value: { ...node, variantFrames: { ...node.variantFrames, [variantId]: frame } } };
}

export function moveConnectedCutout(project, id, leftSlideId) {
  const node = project.nodes[id], left = project.slides.findIndex((slide) => slide.id === leftSlideId);
  requireConnection(node?.connection && left >= 0 && left < project.slides.length - 1, "Choose two neighboring slides.");
  const slides = clone(project.slides), ids = [id, ...(node.depthTextId ? [node.depthTextId] : [])];
  for (const slide of slides) { slide.nodeIds = slide.nodeIds.filter((id) => !ids.includes(id)); for (const id of ids) delete slide.overrides[id]; }
  for (const slide of slides.slice(left, left + 2)) slide.nodeIds.push(...ids);
  const value = { ...node, anchorSlideId: leftSlideId, connection: { schema: 1, rightSlideId: slides[left + 1].id } };
  const commands = [{ type: "node", id, value }, { type: "slides", value: slides }];
  if (node.depthTextId) commands.push({ type: "node", id: node.depthTextId, value: { ...project.nodes[node.depthTextId], anchorSlideId: leftSlideId } });
  return { type: "group", commands };
}

export function removeConnectedCutout(project, id) {
  const node = project.nodes[id]; requireConnection(node?.connection, "Choose a connected cutout to remove.");
  const ids = [id, ...(node.depthTextId ? [node.depthTextId] : [])], slides = clone(project.slides);
  for (const slide of slides) { slide.nodeIds = slide.nodeIds.filter((id) => !ids.includes(id)); for (const id of ids) delete slide.overrides[id]; }
  const commands = ids.map((id) => ({ type: "node", id, value: null })); commands.push({ type: "slides", value: slides });
  if (node.maskId && !Object.values(project.nodes).some((other) => !ids.includes(other.id) && other.maskId === node.maskId)
    && !Object.values(project.assets).some(asset => asset.workingCopy?.sourceAssetId === node.maskId)) commands.push({ type: "asset", id: node.maskId, value: null });
  return { type: "group", commands };
}

export function reviewConnections(project, variantId) {
  const warnings = [];
  for (const node of Object.values(project.nodes).filter((node) => node.connection)) {
    const resolved = resolveSlide(project, node.anchorSlideId, variantId), photo = resolved.nodes.find((entry) => entry.id === node.id);
    const box = photo.viewport, angle = (photo.rotation ?? 0) * Math.PI / 180;
    const width = Math.abs(Math.cos(angle)) * box.width + Math.abs(Math.sin(angle)) * box.height;
    const center = box.x + box.width / 2, join = resolved.variant.width;
    if (center - width / 2 >= join || center + width / 2 <= join) warnings.push({ code: "CONNECTION_OFF_JOIN", nodeId: node.id, slideIds: [node.anchorSlideId, node.connection.rightSlideId] });
  }
  return warnings;
}
