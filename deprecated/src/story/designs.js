import { canonicalJSON, clone, createSceneProject, validateData, validateProject } from "../project/model.js";
import { applyProjectCommand } from "../project/history.js";
import { adaptStoryLayoutCommand, validateStoryLayout } from "./layout.js";

const check = (value, message = "This story design contains unsupported settings.") => { if (!value) throw new Error(message); };
const keys = (value, names) => check(value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name)));
const type = (font, size, weight = 400) => ({ builtinFont: font, weight, fontBasis: "width", fontSize: size, minFontSize: .02, lineHeight: 1.15, fit: "shrink" });
const layout = (patch = {}) => ({ margin: .07, gap: .05, border: .014, header: .06, captionMin: .105, captionMax: .24, arrangement: "auto", tilt: -3, fit: "contain", ...patch });
const role = (font, size, border, decoration, options = {}) => ({ caption: type(font, size, font === "system-serif" ? 700 : 400),
  number: type("system-mono", .025), border, decoration, layout: layout(options) });

// These are parameters, not executable presets. Applied revisions are copied
// into the style and project; rendering never looks up a mutable catalog entry.
export function authoredStoryDesigns() {
  return [
    { id: "scrapbook", name: "Scrapbook", description: "Taped prints, generous cover type and warm paper.", lookId: "scrapbook", design: { schema: 1, roles: {
      cover: role("system-serif", .1, "#fffdf7", "tape", { captionMin: .15, captionMax: .28, border: .022 }),
      body: role("system-serif", .04, "#fffdf7", "tape", { captionMin: .075, gap: .06 }),
      closing: role("system-serif", .075, "#fffdf7", "tape", { captionMin: .13, border: .022, tilt: 3 }),
    } } },
    { id: "depth-cover", name: "Depth cover", description: "A bold title behind your cover subject, with quiet straight pages.", lookId: "clean", design: { schema: 1, roles: {
      cover: role("system-sans", .032, "#ffffff", "none", { margin: .045, border: .006, header: .04, captionMin: .06, captionMax: .15, tilt: 0, fit: "cover" }),
      body: role("system-sans", .037, "#ffffff", "none", { margin: .065, border: .006, captionMin: .075, tilt: 0 }),
      closing: role("system-serif", .08, "#ffffff", "none", { border: .006, captionMin: .15, tilt: 0 }),
    } }, depthTitle: { schema: 1, target: "cover", background: "photo", frame: { x: .02, y: .08, width: .96, height: .42 }, color: "#ffffff",
      style: { ...type("system-display", .24, 800), align: "center", lineHeight: .95, shadow: { color: "#00000088", blur: .004, x: 0, y: .002 } } } },
    { id: "film-diary", name: "Film diary", description: "Film-edge frames, straight contact sheets and small diary type.", lookId: "film-diary", design: { schema: 1, roles: {
      cover: role("system-mono", .065, "#10110f", "film", { border: .025, captionMin: .14, tilt: 0 }),
      body: role("system-mono", .032, "#10110f", "film", { border: .025, gap: .055, captionMin: .075, tilt: 0 }),
      closing: role("system-mono", .05, "#10110f", "film", { border: .025, captionMin: .12, tilt: 0 }),
    } } },
  ];
}

export function validateStoryDesign(design, assets = {}) {
  validateData(design); keys(design, ["schema", "roles"]); check([1, 2].includes(design.schema)); keys(design.roles, ["cover", "body", "closing"]);
  for (const value of Object.values(design.roles)) {
    keys(value, ["caption", "number", "border", "decoration", "layout"]);
    check(/^#[0-9a-f]{6}$/i.test(value.border) && ["none", "tape", "film"].includes(value.decoration));
    keys(value.layout, ["margin", "gap", "border", "header", "captionMin", "captionMax", "arrangement", "tilt", "fit"]);
    check(["auto", "row", "stack"].includes(value.layout.arrangement) && [-3, 0, 3].includes(value.layout.tilt) && ["contain", "cover"].includes(value.layout.fit));
    const { arrangement, tilt, fit, ...constraints } = value.layout;
    validateStoryLayout({ recipe: { layout: { id: "photo-prints", version: 1, ...constraints, slides: {} } }, slides: [], nodes: {} });
    for (const style of [value.caption, value.number]) {
      check(style?.fontBasis === "width");
      const { fontId, ...type } = style; check(fontId == null || design.schema === 2, "Font assets require story design version two.");
      validateProject(createSceneProject({ assets, nodes: { text: { id: "text", kind: "text", space: "slide", text: "", frame: { x: 0, y: 0, width: 1, height: .2 }, style: type, ...(fontId ? { fontId } : {}) } } }));
    }
  }
  return design;
}

function decorationNodes(photo, kind) {
  const make = (suffix, frame, color, options = {}) => ({ id: `${photo.id}:design:${suffix}`, kind: "shape", space: photo.space,
    ...(photo.anchorSlideId ? { anchorSlideId: photo.anchorSlideId } : {}), attachment: { schema: 1, imageId: photo.id }, frame, color, ...options });
  if (kind === "tape") return [make("tape", { x: .33, y: -.025, width: .34, height: .06 }, "#d3be92", { opacity: .78, rotation: -2 })];
  if (kind === "film") return ["l", "r"].flatMap((side) => Array.from({ length: 4 }, (_, index) => make(`hole-${side}-${index}`,
    { x: side === "l" ? -.023 : 1.005, y: .14 + index * .22, width: .018, height: .026 }, "#d3ba8e", { style: { shape: "rounded", radius: .2 } })));
  return [];
}

export function storyDesignCommand(project, design, { keepPositions = true } = {}) {
  validateProject(project); validateStoryDesign(design, project.assets);
  let next = clone(project);
  const prior = next.recipe.storyDesign?.decorations ?? [];
  check(Array.isArray(prior) && prior.length <= 120, "This saved decoration list needs a different app version.");
  for (const id of prior) {
    const node = next.nodes[id];
    check(node?.kind === "shape" && node.attachment && id.startsWith(`${node.attachment.imageId}:design:`)
      && /:design:(tape|hole-[lr]-[0-3])$/.test(id), "A saved design cannot replace unrelated artwork.");
    delete next.nodes[id]; for (const slide of next.slides) { slide.nodeIds = slide.nodeIds.filter((nodeId) => nodeId !== id); delete slide.overrides[id]; }
  }
  const bindings = {}, decorations = [];
  for (const [index, slide] of next.slides.entries()) {
    const role = index === 0 ? "cover" : index === next.slides.length - 1 ? "closing" : "body", treatment = design.roles[role];
    next = applyProjectCommand(next, adaptStoryLayoutCommand(next, slide.id)).project;
    const binding = next.recipe.layout.slides[slide.id], { arrangement, tilt, fit, ...constraints } = treatment.layout;
    binding.constraints = clone(constraints);
    for (const [i, pair] of binding.photos.entries()) {
      next.nodes[pair.imageId].rotation = next.nodes[pair.borderId].rotation = i % 2 ? -tilt : tilt;
      next.nodes[pair.borderId].color = treatment.border;
    }
    for (const [id, style] of [[binding.captionId, treatment.caption], [binding.numberId, treatment.number]]) {
      const { fontId, ...type } = style;
      next.nodes[id].style = clone(type); delete next.nodes[id].fontId;
      if (fontId) next.nodes[id].fontId = fontId;
    }
    next = applyProjectCommand(next, adaptStoryLayoutCommand(next, slide.id, { arrangement, fit, resetPositions: !keepPositions })).project;
    const current = next.slides.find((entry) => entry.id === slide.id);
    for (const pair of binding.photos) {
      const photo = next.nodes[pair.imageId], nodes = decorationNodes(photo, treatment.decoration);
      // Decorate the print above its image/depth title; captions stay independent.
      const after = photo.depthTextId ?? photo.id, offset = current.nodeIds.indexOf(after) + 1;
      for (const node of nodes) {
        check(!Object.hasOwn(next.nodes, node.id), "This design conflicts with existing artwork. Your project is unchanged.");
        next.nodes[node.id] = node; decorations.push(node.id);
      }
      current.nodeIds.splice(offset, 0, ...nodes.map((node) => node.id));
    }
    bindings[slide.id] = role;
  }
  next.recipe.storyDesign = { schema: 1, definition: clone(design), roles: bindings, decorations };
  validateProject(next);
  const commands = [];
  for (const id of new Set([...Object.keys(project.nodes), ...Object.keys(next.nodes)])) {
    if (canonicalJSON(next.nodes[id]) !== canonicalJSON(project.nodes[id])) commands.push({ type: "node", id, value: next.nodes[id] ?? null });
  }
  for (const type of ["recipe", "slides"]) if (canonicalJSON(next[type]) !== canonicalJSON(project[type])) commands.push({ type, value: next[type] });
  return { type: "group", commands };
}
