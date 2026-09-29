import { canonicalJSON, clone, resolveSlide, validateProject } from "../project/model.js";
import { applyProjectCommand } from "../project/history.js";

// Copy the definition into each project. Rendering uses the stored frames, not
// this catalog or the solver, so reopening never upgrades a layout implicitly.
const definition = () => ({ id: "photo-prints", version: 1, margin: .07, gap: .05, border: .014,
  header: .06, captionMin: .105, captionMax: .24, slides: {} });
const arrangements = ["auto", "row", "stack"];
const constraints = [["margin", .04, .1], ["gap", .025, .08], ["border", .005, .025],
  ["header", .04, .08], ["captionMin", .06, .15], ["captionMax", .15, .3]];
const frame = (x, y, width, height) => ({ x, y, width, height });
const plain = (value) => value && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function requireLayout(condition, message = "This saved layout cannot be adapted by this version. Its existing positions are preserved.") {
  if (!condition) throw new Error(message);
}

export function validateStoryLayout(project) {
  const layout = project.recipe?.layout;
  requireLayout(plain(layout) && layout.id === "photo-prints" && layout.version === 1);
  requireLayout(Object.keys(layout).every((key) => ["id", "version", "margin", "gap", "border", "header", "captionMin", "captionMax", "slides"].includes(key)));
  for (const [key, min, max] of constraints) {
    requireLayout(Number.isFinite(layout[key]) && layout[key] >= min && layout[key] <= max);
  }
  requireLayout(plain(layout.slides) && Object.keys(layout.slides).length <= project.slides.length);
  for (const [id, binding] of Object.entries(layout.slides)) {
    const slide = project.slides.find((entry) => entry.id === id);
    requireLayout(slide && plain(binding) && Object.keys(binding).every((key) => ["photos", "captionId", "numberId", "arrangement", "constraints", "fit"].includes(key)));
    requireLayout(binding.fit == null || ["contain", "cover"].includes(binding.fit));
    if (binding.constraints !== undefined) {
      requireLayout(plain(binding.constraints) && Object.keys(binding.constraints).every((key) => constraints.some(([name]) => name === key)));
      for (const [key, min, max] of constraints) if (binding.constraints[key] !== undefined) requireLayout(Number.isFinite(binding.constraints[key]) && binding.constraints[key] >= min && binding.constraints[key] <= max);
    }
    requireLayout(arrangements.includes(binding.arrangement) && Array.isArray(binding.photos) && binding.photos.length >= 1 && binding.photos.length <= 2);
    const entries = [[binding.captionId, "text"], [binding.numberId, "text"]];
    for (const pair of binding.photos) {
      requireLayout(plain(pair) && Object.keys(pair).length === 2 && Object.hasOwn(pair, "imageId") && Object.hasOwn(pair, "borderId"));
      entries.push([pair.imageId, "image"], [pair.borderId, "shape"]);
    }
    requireLayout(new Set(entries.map(([nodeId]) => nodeId)).size === entries.length);
    for (const [nodeId, kind] of entries) requireLayout(slide.nodeIds.includes(nodeId) && project.nodes[nodeId]?.kind === kind
      && project.nodes[nodeId].space === "slide" && project.slides.every((other) => other.id === id || !other.nodeIds.includes(nodeId)));
  }
  return layout;
}

export function hasAdaptiveLayout(project, slideId) {
  const layout = project.recipe?.layout;
  return layout?.id === "photo-prints" && layout.version === 1 && Object.hasOwn(layout.slides ?? {}, slideId);
}

function bindingFor(project, slideId) {
  const slide = project.slides.find((entry) => entry.id === slideId);
  requireLayout(slide, "Choose a slide to arrange.");
  return { photos: slide.nodeIds.filter((id) => /:photo-\d+$/.test(id)).map((imageId) => ({ imageId, borderId: imageId.replace(/:photo-/, ":border-") })),
    captionId: `${slideId}:caption`, numberId: `${slideId}:number`, arrangement: "auto" };
}

function cropAspect(project, slide, node) {
  const asset = project.assets[node.assetId], crop = slide.overrides[node.id]?.crop ?? node.crop ?? frame(0, 0, 1, 1);
  const width = Math.ceil((crop.x + crop.width) * asset.width) - Math.floor(crop.x * asset.width);
  const height = Math.ceil((crop.y + crop.height) * asset.height) - Math.floor(crop.y * asset.height);
  requireLayout(width >= 1 && height >= 1, "This photo needs valid upright dimensions before arranging it.");
  return width / height;
}

function fitPrint(aspect, rotation, width, height, border) {
  const angle = rotation * Math.PI / 180, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const scale = Math.min((width - 2 * border * (c + s)) / (c * aspect + s), (height - 2 * border * (c + s)) / (s * aspect + c));
  const w = aspect * scale, h = scale;
  if (w < 1 || h < 1) return null;
  return { w, h, outerW: c * (w + 2 * border) + s * (h + 2 * border), outerH: s * (w + 2 * border) + c * (h + 2 * border) };
}

export function solveStoryLayout(project, slideId, variantId) {
  const definition = validateStoryLayout(project), binding = definition.slides[slideId], layout = { ...definition, ...binding?.constraints };
  const slide = project.slides.find((entry) => entry.id === slideId), variant = project.variants.find((entry) => entry.id === variantId);
  requireLayout(binding && variant, "This slide has no adaptive layout for that output.");
  const { width: w, height: h } = variant, gap = layout.gap * w, border = layout.border * w, margin = layout.margin * w;
  const caption = project.nodes[binding.captionId], text = slide.overrides[caption.id]?.text ?? caption.text;
  const preferred = (caption.style?.fontSize ?? .06) * (caption.style?.fontBasis === "width" ? w : h);
  // This bounded estimate reserves space; the renderer still measures actual
  // glyphs, wraps/shrinks the text and reports overflow independently.
  const columns = Math.max(1, Math.floor((w - margin * 2) / (preferred * .56)));
  const lines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / columns)), 0);
  const captionHeight = Math.max(layout.captionMin * w, Math.min(layout.captionMax * h, lines * preferred * (caption.style?.lineHeight ?? 1.2) + .022 * w));
  const top = margin + layout.header * w, availableW = w - margin * 2, availableH = h - top - margin;
  const photosH = availableH - gap - captionHeight;
  const candidates = binding.photos.length === 1 ? ["row"] : binding.arrangement === "auto" ? ["row", "stack"] : [binding.arrangement];
  let best;
  for (const arrangement of candidates) {
    const slotW = arrangement === "row" ? (availableW - gap * (binding.photos.length - 1)) / binding.photos.length : availableW;
    const slotH = arrangement === "stack" ? (photosH - gap * (binding.photos.length - 1)) / binding.photos.length : photosH;
    const prints = binding.photos.map(({ imageId }) => {
      const node = project.nodes[imageId];
      const aspect = binding.fit === "cover" ? (slotW - 2 * border) / (slotH - 2 * border) : cropAspect(project, slide, node);
      if (!Number.isFinite(aspect) || aspect <= 0) return null;
      return fitPrint(aspect, node.rotation ?? 0, slotW, slotH, border);
    });
    if (prints.some((print) => !print)) continue;
    const score = prints.reduce((sum, print) => sum + print.w * print.h, 0);
    if (!best || score > best.score + .001) best = { arrangement, prints, score };
  }
  requireLayout(best, "This photo is too narrow for this layout. Choose a less extreme crop.");
  const { prints, arrangement } = best;
  const groupW = arrangement === "row" ? prints.reduce((sum, item) => sum + item.outerW, 0) + gap * (prints.length - 1) : Math.max(...prints.map((item) => item.outerW));
  const groupH = arrangement === "stack" ? prints.reduce((sum, item) => sum + item.outerH, 0) + gap * (prints.length - 1) : Math.max(...prints.map((item) => item.outerH));
  const startY = top + (availableH - groupH - gap - captionHeight) / 2, frames = {};
  let offset = 0;
  const normalized = (x, y, width, height) => frame(x / w, y / h, width / w, height / h);
  prints.forEach((print, index) => {
    const cx = arrangement === "row" ? (w - groupW) / 2 + offset + print.outerW / 2 : w / 2;
    const cy = arrangement === "stack" ? startY + offset + print.outerH / 2 : startY + groupH / 2;
    frames[binding.photos[index].imageId] = normalized(cx - print.w / 2, cy - print.h / 2, print.w, print.h);
    frames[binding.photos[index].borderId] = normalized(cx - print.w / 2 - border, cy - print.h / 2 - border, print.w + 2 * border, print.h + 2 * border);
    offset += (arrangement === "row" ? print.outerW : print.outerH) + gap;
  });
  frames[binding.captionId] = normalized(margin, startY + groupH + gap, availableW, captionHeight);
  frames[binding.numberId] = normalized(w - margin - .13 * w, margin * .55, .13 * w, .045 * w);
  return { arrangement, frames };
}

function reflow(project, slideId) {
  for (const variant of project.variants) for (const [id, box] of Object.entries(solveStoryLayout(project, slideId, variant.id).frames)) {
    project.nodes[id].variantFrames = { ...project.nodes[id].variantFrames, [variant.id]: box };
  }
}

function differences(before, after) {
  const commands = [];
  for (const [id, value] of Object.entries(after.nodes)) if (canonicalJSON(value) !== canonicalJSON(before.nodes[id])) commands.push({ type: "node", id, value });
  for (const key of ["recipe", "slides"]) if (canonicalJSON(before[key]) !== canonicalJSON(after[key])) commands.push({ type: key, value: after[key] });
  return { type: "group", commands };
}

export function adaptStoryLayoutCommand(project, slideId, { arrangement, fit, resetPositions = false } = {}) {
  const next = clone(project);
  if (next.recipe?.layout === "paper-prints-v1") next.recipe.layout = definition();
  const layout = validateStoryLayout(next);
  if (!Object.hasOwn(layout.slides, slideId)) {
    layout.slides[slideId] = bindingFor(next, slideId);
    for (const id of [layout.slides[slideId].captionId, layout.slides[slideId].numberId]) {
      const node = next.nodes[id]; requireLayout(node?.kind === "text");
      const basis = project.variants.find((variant) => variant.id === project.recipe.outputVariant) ?? project.variants[0];
      node.style = { ...node.style, fontSize: (node.style?.fontSize ?? .05) * (node.style?.fontBasis === "width" ? 1 : basis.height / basis.width),
        minFontSize: .02, fontBasis: "width" };
    }
  }
  if (arrangement != null) { requireLayout(arrangements.includes(arrangement), "Choose Auto, Side by side, or Stacked."); layout.slides[slideId].arrangement = arrangement; }
  if (fit != null) { requireLayout(["contain", "cover"].includes(fit), "Choose Keep whole crop or Fill the frame."); layout.slides[slideId].fit = fit; }
  validateStoryLayout(next);
  if (resetPositions) {
    const slide = next.slides.find((entry) => entry.id === slideId), binding = layout.slides[slideId];
    for (const id of [binding.captionId, binding.numberId, ...binding.photos.flatMap((pair) => [pair.imageId, pair.borderId])]) {
      const patch = slide.overrides[id];
      if (patch) { delete patch.frame; delete patch.variantFrames; if (!Object.keys(patch).length) delete slide.overrides[id]; }
    }
  }
  reflow(next, slideId); validateProject(next);
  return differences(project, next);
}

export function initializeStoryLayout(project) {
  // Used only for a newly created document; old documents opt in via a command.
  project.recipe.layout = definition();
  for (const slide of project.slides) project.recipe.layout.slides[slide.id] = bindingFor(project, slide.id);
  for (const slide of project.slides) reflow(project, slide.id);
  return validateProject(project);
}

export function withStoryReflow(project, command, slideId) {
  if (!hasAdaptiveLayout(project, slideId)) return command;
  const edited = applyProjectCommand(project, command).project, next = clone(edited);
  reflow(next, slideId); validateProject(next);
  // All user edits and resulting geometry are a single history transaction.
  return { type: "group", commands: [...(command.type === "group" ? command.commands : [command]), ...differences(edited, next).commands] };
}

export function positionStoryPhotoCommand(project, slideId, variantId, imageId, { x, y, scale }, referenceFrames = null) {
  const layout = validateStoryLayout(project), pair = layout.slides[slideId]?.photos.find((entry) => entry.imageId === imageId);
  requireLayout(pair && [x, y, scale].every(Number.isFinite) && x >= 0 && x <= 1 && y >= 0 && y <= 1 && scale >= .5 && scale <= 1.5, "Choose a position inside the page and a size from 50–150%.");
  const base = referenceFrames?.[pair.imageId] ?? project.nodes[imageId].variantFrames?.[variantId]; requireLayout(base);
  const slides = clone(project.slides), slide = slides.find((entry) => entry.id === slideId);
  for (const id of [pair.imageId, pair.borderId]) {
    // UI gestures retain their opening frames as the reference. Repeated slider
    // events never compound, and moving a kept override does not reshape it.
    const box = referenceFrames?.[id] ?? project.nodes[id].variantFrames[variantId];
    const moved = frame(x + (box.x - base.x - base.width / 2) * scale, y + (box.y - base.y - base.height / 2) * scale, box.width * scale, box.height * scale);
    const patch = slide.overrides[id] ?? {};
    slide.overrides[id] = { ...patch, variantFrames: { ...patch.variantFrames, [variantId]: moved } };
  }
  return { type: "slides", value: slides };
}

function corners(node) {
  const { x, y, width, height } = node.viewport, angle = (node.rotation ?? 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([dx, dy]) => ({ x: x + width / 2 + dx * width * c - dy * height * s, y: y + height / 2 + dx * width * s + dy * height * c }));
}

function intersects(a, b) {
  // Separating-axis test avoids warning for empty corners of rotated prints.
  for (const polygon of [a, b]) for (let index = 0; index < 2; index++) {
    const p = polygon[index], q = polygon[index + 1], axis = { x: -(q.y - p.y), y: q.x - p.x };
    const project = (points) => points.map((point) => point.x * axis.x + point.y * axis.y);
    const pa = project(a), pb = project(b);
    if (Math.max(...pa) <= Math.min(...pb) + .001 || Math.max(...pb) <= Math.min(...pa) + .001) return false;
  }
  return true;
}

export function reviewStoryLayout(project, slideId, variantId) {
  if (!hasAdaptiveLayout(project, slideId)) return [];
  const binding = validateStoryLayout(project).slides[slideId], resolved = resolveSlide(project, slideId, variantId);
  const ids = [binding.captionId, binding.numberId, ...binding.photos.map((pair) => pair.borderId)];
  const nodes = resolved.nodes.filter((node) => ids.includes(node.id) && (node.kind !== "text" || node.text.trim()));
  const boxes = nodes.map(corners), warnings = [];
  boxes.forEach((points, index) => {
    if (points.some(({ x, y }) => x < -.001 || y < -.001 || x > resolved.variant.width + .001 || y > resolved.variant.height + .001)) warnings.push({ code: "LAYOUT_CLIPPED", nodeIds: [nodes[index].id] });
    for (let other = index + 1; other < boxes.length; other++) if (intersects(points, boxes[other])) warnings.push({ code: "LAYOUT_OVERLAP", nodeIds: [nodes[index].id, nodes[other].id] });
  });
  return warnings;
}
