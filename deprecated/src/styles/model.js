import { assertEngineCompatibility, canonicalJSON, clone, createSceneProject, ENGINE_IDENTITY, newId, resolveSlide, validateData, validateProject } from "../project/model.js";
import { applyProjectCommand } from "../project/history.js";
import { adaptStoryLayoutCommand, hasAdaptiveLayout, validateStoryLayout } from "../story/layout.js";
import { STORY_LOOKS } from "../story/recipes.js";
import { validateCutoutEffects } from "../compositor/cutout-effects-spec.js";
import { storyDepthCommand } from "../story/depth.js";
import { authoredStoryDesigns, storyDesignCommand, validateStoryDesign } from "../story/designs.js";
import { storyFontForBuiltin, storyFonts, knownStoryFont } from "./font-pack.js";

export const MAX_STYLE_BYTES = 32 * 1024;
export const STYLE_CAPABILITIES = Object.freeze(["scene-v1", "photo-look-v1", "builtin-text-v1", "photo-prints-v1", "photo-fill-v1", "cutout-effects-v1", "depth-title-v1", "story-design-v1", "licensed-fonts-v1", "export-variants-v1", "png-output", "jpeg-output"]);
const layoutKeys = ["id", "version", "margin", "gap", "border", "header", "captionMin", "captionMax"];
const plain = (value) => value && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const color = (value) => typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value);
function check(condition, message = "This style contains unsupported or invalid settings.") { if (!condition) throw new Error(message); }
function keys(value, allowed) { check(plain(value) && Object.keys(value).every((key) => allowed.includes(key))); }
const fontReferences = (components) => [...new Set([components.text?.caption?.fontId, components.text?.number?.fontId, components.depthTitle?.fontId,
  ...Object.values(components.storyDesign?.roles ?? {}).flatMap((role) => [role.caption.fontId, role.number.fontId])].filter((id) => id !== undefined))];
const requiredFor = (components) => ["scene-v1", ...(fontReferences(components).length ? ["licensed-fonts-v1"] : []), ...(components.look ? ["photo-look-v1"] : []), ...(components.text ? ["builtin-text-v1"] : []),
  ...(components.layout ? ["photo-prints-v1", ...(components.layout.fit === "cover" ? ["photo-fill-v1"] : [])] : []), ...(components.cutoutEffects ? ["cutout-effects-v1"] : []),
  ...(components.depthTitle ? ["depth-title-v1"] : []), ...(components.storyDesign ? ["story-design-v1"] : []), ...(components.output ? [`${components.output.format}-output`] : []),
  ...(components.output?.variants ? ["export-variants-v1"] : [])];
export const styleKey = (style) => `${style.id}@${style.revision}`;
export const styleHasStrength = (style) => Object.entries(style.components.look?.appearance ?? {}).some(([key, value]) => value !== (key === "grayscaleMix" ? 0 : 1));

function envelope(id, name, description, components, revision = 1) {
  const fonts = storyFonts(), assets = fontReferences(components).map((id) => { const asset = fonts.find((font) => font.id === id); check(asset, "This font needs a supported licensed asset pack."); return asset; });
  const style = { kind: "tiny-image-star/style", version: 1, id, revision, name, description,
    engine: { name: ENGINE_IDENTITY.name, versions: [ENGINE_IDENTITY.version], compositors: [ENGINE_IDENTITY.compositor] },
    requires: requiredFor(components), supported: { photoCounts: { min: 6, max: 12 }, variants: ["portrait", "tall"] },
    seed: { mode: "project" }, assets, components, controls: [] };
  if (styleHasStrength(style)) style.controls.push("appearance-strength");
  return validateStyle(style);
}

export function validateStyle(style) {
  validateData(style);
  check(new TextEncoder().encode(JSON.stringify(style)).length <= MAX_STYLE_BYTES, "Style files must be 32 KiB or smaller.");
  check(style?.kind === "tiny-image-star/style" && style.version === 1, "This style file needs a different app version. The file has not been changed.");
  keys(style, ["kind", "version", "id", "revision", "name", "description", "engine", "requires", "supported", "seed", "assets", "components", "controls"]);
  check(typeof style.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(style.id) && !["constructor", "prototype"].includes(style.id));
  check(Number.isSafeInteger(style.revision) && bounded(style.revision, 1, 1_000_000));
  check(typeof style.name === "string" && style.name.trim().length > 0 && style.name.length <= 80, "Give the style a name of 1–80 characters.");
  check(typeof style.description === "string" && style.description.length <= 240);
  keys(style.engine, ["name", "versions", "compositors"]);
  check(typeof style.engine.name === "string" && /^[a-z0-9-]{1,64}$/.test(style.engine.name));
  for (const key of ["versions", "compositors"]) check(Array.isArray(style.engine[key]) && style.engine[key].length > 0 && style.engine[key].length <= 8
    && style.engine[key].every((item) => typeof item === "string" && /^[a-zA-Z0-9.+_-]{1,80}$/.test(item)));
  check(Array.isArray(style.requires) && style.requires.length <= 16 && new Set(style.requires).size === style.requires.length
    && style.requires.every((entry) => typeof entry === "string" && /^[a-z0-9-]{1,64}$/.test(entry)));
  keys(style.supported, ["photoCounts", "variants"]); keys(style.supported.photoCounts, ["min", "max"]);
  check(Number.isInteger(style.supported.photoCounts.min) && Number.isInteger(style.supported.photoCounts.max)
    && bounded(style.supported.photoCounts.min, 6, 12) && bounded(style.supported.photoCounts.max, style.supported.photoCounts.min, 12));
  check(Array.isArray(style.supported.variants) && style.supported.variants.length > 0 && style.supported.variants.length <= 2
    && new Set(style.supported.variants).size === style.supported.variants.length && style.supported.variants.every((id) => ["portrait", "tall"].includes(id)));
  keys(style.seed, ["mode"]); check(style.seed.mode === "project");
  check(Array.isArray(style.assets) && style.assets.length <= 8, "A style supports at most eight licensed font assets.");
  const assets = {};
  for (const asset of style.assets) {
    keys(asset, ["id", "kind", "name", "type", "byteLength", "sha256", "orientation", "license", "fontFace"]);
    check(asset.kind === "font" && asset.type === "font/ttf" && asset.id === `story-font-${asset.sha256}` && /^[a-f0-9]{64}$/.test(asset.sha256)
      && asset.license === "OFL-1.1" && typeof asset.name === "string" && asset.name.length > 0 && asset.name.length <= 80
      && Number.isInteger(asset.byteLength) && bounded(asset.byteLength, 1, 16 * 1024 * 1024) && !Object.hasOwn(assets, asset.id), "Invalid licensed font reference.");
    assets[asset.id] = asset;
  }
  check(style.assets.reduce((sum, asset) => sum + asset.byteLength, 0) <= 32 * 1024 * 1024, "Style fonts exceed 32 MiB.");
  keys(style.components, ["look", "text", "layout", "output", "cutoutEffects", "depthTitle", "storyDesign"]); check(Object.keys(style.components).length > 0, "Choose at least one setting to save.");
  const { look, text, layout, output } = style.components;
  const validation = createSceneProject({ assets, nodes: { caption: { id: "caption", kind: "text", space: "slide", frame: { x: .1, y: .1, width: .8, height: .2 }, text: "" } } });
  if (look !== undefined) {
    keys(look, ["appearance", "paper", "ink", "accent"]); check([look.paper, look.ink, look.accent].every(color));
    validation.shared.appearance = look.appearance;
  }
  if (text !== undefined) {
    keys(text, ["caption", "number"]); check(text.caption && text.number);
    for (const value of [text.caption, text.number]) {
      keys(value, ["style", "color", "fontId"]); check(color(value.color));
      validation.nodes.caption.style = value.style; delete validation.nodes.caption.fontId;
      if (value.fontId !== undefined) validation.nodes.caption.fontId = value.fontId;
      validateProject(validation);
    }
  }
  if (layout !== undefined) {
    keys(layout, [...layoutKeys, "arrangement", "tilt", "fit"]);
    check(["auto", "row", "stack"].includes(layout.arrangement) && [-3, 0, 3].includes(layout.tilt));
    check(layout.fit == null || ["contain", "cover"].includes(layout.fit));
    validateStoryLayout({ recipe: { layout: { ...Object.fromEntries(layoutKeys.map((key) => [key, layout[key]])), slides: {} } }, slides: [], nodes: {} });
  }
  if (output !== undefined) {
    keys(output, ["variant", "variants", "format"]); check(["portrait", "tall"].includes(output.variant) && ["png", "jpeg"].includes(output.format));
    if (output.variants !== undefined) check(Array.isArray(output.variants) && output.variants.length > 0 && output.variants.length <= 2
      && new Set(output.variants).size === output.variants.length && output.variants.every(id => ["portrait", "tall"].includes(id)), "Choose one or both supported export shapes.");
  }
  if (style.components.cutoutEffects !== undefined) validateCutoutEffects(style.components.cutoutEffects);
  if (style.components.depthTitle !== undefined) {
    const depth = style.components.depthTitle;
    keys(depth, ["schema", "background", "frame", "style", "color", "target", "fontId"]);
    check(depth.target == null || depth.target === "cover", "This depth-title target is not supported.");
    check(depth.schema === 1 && ["photo", "page"].includes(depth.background) && color(depth.color), "This style has invalid depth-title settings.");
    keys(depth.frame, ["x", "y", "width", "height"]);
    check(bounded(depth.frame.x, -.5, 1) && bounded(depth.frame.y, -.5, 1) && bounded(depth.frame.width, .2, 1.8)
      && bounded(depth.frame.height, .1, 1), "Depth-title placement must fit the supported photo-relative bounds.");
    check(plain(depth.style) && depth.style.fontBasis === "width", "Depth-title type must be relative to the photo width.");
    validation.nodes.caption.style = depth.style; delete validation.nodes.caption.fontId;
    if (depth.fontId !== undefined) validation.nodes.caption.fontId = depth.fontId;
    validateProject(validation);
  }
  if (style.components.storyDesign !== undefined) {
    validateStoryDesign(style.components.storyDesign, assets);
    check(!layout && !text, "A story design already defines layout and caption type. Save those as a separate style.");
  }
  const references = fontReferences(style.components);
  check(references.length === style.assets.length && references.every((id) => Object.hasOwn(assets, id)), "Style fonts must exactly match its reusable typography references.");
  check(requiredFor(style.components).every((requirement) => style.requires.includes(requirement)), "This style omits a required capability declaration.");
  check(Array.isArray(style.controls) && canonicalJSON(style.controls) === canonicalJSON(styleHasStrength(style) ? ["appearance-strength"] : []));
  validateProject(validation);
  return style;
}

export function styleFromLook(look) {
  const known = STORY_LOOKS.find((entry) => entry.id === look.id && entry.revision === look.revision);
  const style = envelope(`builtin:${look.id}`, look.name, look.description ?? known?.description ?? "Saved photo treatment.", {
    look: { appearance: clone(look.appearance), paper: look.paper, ink: look.ink, accent: look.accent },
  });
  style.revision = look.revision; return validateStyle(style);
}
export const curatedStyles = () => STORY_LOOKS.map(styleFromLook);
export const curatedStoryStyles = ({ revision = 2 } = {}) => authoredStoryDesigns().map((entry) => {
  check([1, 2].includes(revision), "Unknown story recipe revision.");
  const look = STORY_LOOKS.find((item) => item.id === entry.lookId);
  if (revision === 2) {
    entry.design.schema = 2;
    for (const role of Object.values(entry.design.roles)) for (const type of [role.caption, role.number]) type.fontId = storyFontForBuiltin(type.builtinFont).id;
    if (entry.depthTitle) { entry.depthTitle.fontId = storyFontForBuiltin(entry.depthTitle.style.builtinFont).id; entry.depthTitle.style.weight = 700; }
  }
  return envelope(`builtin:story-${entry.id}`, entry.name, entry.description, {
    look: { appearance: clone(look.appearance), paper: look.paper, ink: look.ink, accent: look.accent },
    storyDesign: entry.design, ...(entry.depthTitle ? { depthTitle: entry.depthTitle } : {}),
  }, revision);
});

const scopedPhotos = (project, slideId) => [...new Set(project.slides.filter((slide) => !slideId || slide.id === slideId).flatMap((slide) => slide.nodeIds))]
  .map((id) => project.nodes[id]).filter((node) => node.kind === "image");
const depthPhotos = (project, style, slideId) => style.components.depthTitle?.target === "cover"
  ? scopedPhotos(project, project.slides[0].id).filter((node) => !node.connection).slice(0, 1).filter((node) => !slideId || project.slides.find((slide) => slide.id === slideId)?.nodeIds.includes(node.id))
  : scopedPhotos(project, slideId);

export function styleSubjectSummary(style, project, slideId = null) {
  if (!style.components.cutoutEffects && !style.components.depthTitle) return "";
  const photos = style.components.depthTitle ? depthPhotos(project, style, slideId) : scopedPhotos(project, slideId), subjects = photos.filter((node) => node.maskId), skipped = photos.length - subjects.length;
  if (style.components.depthTitle?.target === "cover") return "Depth type applies to the cover photo. Existing title words stay; a new title uses this story’s name. Your slide caption stays separate.";
  return `${subjects.length} photo${subjects.length === 1 ? "" : "s"} with a subject selection will receive the effect. ${skipped} without a selection stay unchanged.`
    + (style.components.depthTitle ? " Existing words stay; new titles use this story’s name. Existing title positions stay unless Keep adjusted positions is unchecked." : "")
    + (subjects.some((node) => node.connection) ? " Connected subjects change on both slides." : "");
}

export function styleCompatibility(style, project, variantId, slideId = null) {
  validateStyle(style);
  if (style.engine.name !== ENGINE_IDENTITY.name || !style.engine.versions.includes(ENGINE_IDENTITY.version)
    || !style.engine.compositors.includes(ENGINE_IDENTITY.compositor)) return "This style needs a different renderer version. Choose a built-in look instead.";
  const missing = style.requires.filter((entry) => !STYLE_CAPABILITIES.includes(entry));
  if (missing.length) return `Unavailable requirement: ${missing.join(", ")}. Choose a built-in look instead.`;
  if (style.assets.some((asset) => !knownStoryFont(asset))) return "This style needs a font pack unavailable in this app version. Choose a supported recipe or device fonts.";
  if (project) {
    try { assertEngineCompatibility(project); } catch (error) { return error.message; }
    const count = new Set(project.slides.flatMap((slide) => slide.nodeIds.filter((id) => project.nodes[id].kind === "image" && !project.nodes[id].connection))).size;
    if (count < style.supported.photoCounts.min || count > style.supported.photoCounts.max) return `This style needs ${style.supported.photoCounts.min}–${style.supported.photoCounts.max} photos.`;
    const shape = style.components.output?.variant ?? variantId ?? project.recipe.outputVariant;
    if ([shape, ...(style.components.output?.variants ?? [])].some(id => !style.supported.variants.includes(id) || !project.variants.some(variant => variant.id === id))) return "This style does not support the selected output shape.";
    if (style.components.storyDesign && slideId) return "This story recipe applies to the whole story. Choose Whole story.";
    if (style.components.depthTitle?.target === "cover" && slideId && slideId !== project.slides[0].id) return "This effect targets the cover. Choose the cover slide or Whole story.";
    if (style.components.depthTitle?.target === "cover" && !depthPhotos(project, style, slideId).some((node) => node.maskId)) return "Choose the cover subject in Cutout first, or use Scrapbook or Film diary without a cutout.";
    if ((style.components.cutoutEffects && !scopedPhotos(project, slideId).some((node) => node.maskId))
      || (style.components.depthTitle && !depthPhotos(project, style, slideId).some((node) => node.maskId)))
      return `Choose a subject in Cutout${slideId ? " on this slide" : ""} before applying this effect.`;
  }
  return "";
}

export function captureStoryStyle(project, slideId, name, inclusion = { look: true, text: true }) {
  const resolved = resolveSlide(project, slideId, project.recipe.outputVariant), nodes = resolved.nodes;
  const photo = nodes.find((node) => node.kind === "image"), caption = nodes.find((node) => node.id.endsWith(":caption"));
  const number = nodes.find((node) => node.id.endsWith(":number")), paper = nodes.find((node) => node.id.endsWith(":paper"));
  check(photo && caption && number && paper, "This slide does not have reusable photo-story settings.");
  const components = {};
  if (inclusion.look) components.look = { appearance: clone(photo.appearance), paper: paper.color, ink: caption.color, accent: number.color };
  if (inclusion.text) {
    check([caption, number].every((node) => !node.fontId || knownStoryFont(project.assets[node.fontId])), "Custom fonts need a licensed asset pack. Save the other settings without Text style.");
    components.text = Object.fromEntries([["caption", caption], ["number", number]].map(([key, node]) => [key, { style: clone(node.style ?? {}), color: node.color, ...(node.fontId ? { fontId: node.fontId } : {}) }]));
  }
  if (inclusion.layout) {
    const layout = validateStoryLayout(project), binding = layout.slides[slideId]; check(binding, "Adapt this slide to photos before saving its layout.");
    check([-3, 0, 3].includes(photo.rotation ?? 0), "This rotation is not part of a reusable photo-print layout.");
    components.layout = { ...Object.fromEntries(layoutKeys.map((key) => [key, binding.constraints?.[key] ?? layout[key]])), arrangement: binding.arrangement, tilt: photo.rotation ?? 0,
      ...(binding.fit === "cover" ? { fit: binding.fit } : {}) };
  }
  if (inclusion.output) components.output = { variant: project.recipe.outputVariant, format: project.recipe.outputFormat ?? "jpeg",
    ...(project.recipe.outputVariants !== undefined ? { variants: clone(project.recipe.outputVariants) } : {}) };
  if (inclusion.cutoutEffects) {
    const subject = nodes.find((node) => node.id === inclusion.effectPhotoId);
    check(subject?.kind === "image" && subject.cutoutEffects, "Choose a photo with an outline or shadow to save its finish.");
    components.cutoutEffects = clone(subject.cutoutEffects);
  }
  if (inclusion.depthTitle) {
    const subject = nodes.find((node) => node.id === inclusion.depthPhotoId), title = project.nodes[subject?.depthTextId];
    check(title?.kind === "text", "Choose a photo with a depth title to save its settings.");
    check(!title.fontId || knownStoryFont(project.assets[title.fontId]), "Custom fonts need a licensed asset pack. Save the other settings without Depth title.");
    const patch = project.slides.find((slide) => slide.id === slideId).overrides[title.id] ?? {};
    components.depthTitle = { schema: 1, background: subject.depthBackground,
      frame: clone(patch.variantFrames?.[project.recipe.outputVariant] ?? patch.frame ?? title.variantFrames?.[project.recipe.outputVariant] ?? title.frame),
      style: clone(title.style), color: title.color ?? "#202124", ...(title.fontId ? { fontId: title.fontId } : {}) };
  }
  return envelope(newId("style"), name.trim(), "Your reusable story settings.", components);
}

export function storyStyleCommand(project, style, { strength = 1, slideId = null, keepPositions = true } = {}) {
  validateProject(project); const problem = styleCompatibility(style, project, null, slideId);
  check(!problem, problem); check(bounded(strength, 0, 1), "Choose a style strength from 0–100%.");
  const selected = project.slides.filter((slide) => !slideId || slide.id === slideId); check(selected.length, "Choose a slide for this style.");
  let next = clone(project); const { look, text, layout, output } = style.components;
  for (const asset of style.assets) {
    check(!next.assets[asset.id] || canonicalJSON(next.assets[asset.id]) === canonicalJSON(asset), "This font identity conflicts with a saved asset. Your project is unchanged.");
    next.assets[asset.id] = clone(asset);
  }
  if (style.components.depthTitle) {
    const depth = style.components.depthTitle;
    // Shared connected photos appear on two slides; change their single title once.
    for (const photo of depthPhotos(project, style, slideId).filter((node) => node.maskId)) {
      next = applyProjectCommand(next, storyDepthCommand(next, photo.id, { background: depth.background })).project;
      const title = next.nodes[next.nodes[photo.id].depthTextId];
      title.style = clone(depth.style); title.color = depth.color; delete title.fontId;
      if (depth.fontId) title.fontId = depth.fontId;
      if (!photo.depthTextId || !keepPositions) {
        title.frame = clone(depth.frame); delete title.variantFrames;
        for (const slide of next.slides.filter((entry) => !slideId || entry.id === slideId)) {
          const patch = slide.overrides[title.id];
          if (patch) { delete patch.frame; delete patch.variantFrames; if (!Object.keys(patch).length) delete slide.overrides[title.id]; }
        }
      }
    }
  }
  if (look && !slideId) next.shared.appearance = Object.fromEntries(Object.entries(look.appearance).map(([key, value]) => [key, (key === "grayscaleMix" ? 0 : 1) + (value - (key === "grayscaleMix" ? 0 : 1)) * strength]));
  for (const slide of selected) {
    for (const id of slide.nodeIds) {
      const node = next.nodes[id];
      if (node.kind === "image" && node.maskId && style.components.cutoutEffects) node.cutoutEffects = clone(style.components.cutoutEffects);
      if (look) {
        if (node.kind === "image" && slideId) node.appearanceBase = Object.fromEntries(Object.entries(look.appearance).map(([key, value]) => [key, (key === "grayscaleMix" ? 0 : 1) + (value - (key === "grayscaleMix" ? 0 : 1)) * strength]));
        if (id.endsWith(":paper")) node.color = look.paper;
        if (id.endsWith(":caption")) node.color = look.ink;
        if (id.endsWith(":number")) node.color = look.accent;
      }
      const typography = text && (id.endsWith(":caption") ? text.caption : id.endsWith(":number") ? text.number : null);
      if (typography) { node.style = clone(typography.style); node.color = typography.color; delete node.fontId; if (typography.fontId) node.fontId = typography.fontId; }
    }
    if (layout) {
      // Adopt or validate this slide, then replace only reusable constraints.
      next = applyProjectCommand(next, adaptStoryLayoutCommand(next, slide.id)).project;
      next.recipe.layout.slides[slide.id].constraints = Object.fromEntries(layoutKeys.filter((key) => !["id", "version"].includes(key)).map((key) => [key, layout[key]]));
      const pairs = next.recipe.layout.slides[slide.id].photos;
      pairs.forEach((pair, index) => { for (const id of [pair.imageId, pair.borderId]) next.nodes[id].rotation = index % 2 ? -layout.tilt : layout.tilt; });
      next = applyProjectCommand(next, adaptStoryLayoutCommand(next, slide.id, { arrangement: layout.arrangement, fit: layout.fit ?? "contain", resetPositions: !keepPositions })).project;
    } else if (text && hasAdaptiveLayout(next, slide.id)) next = applyProjectCommand(next, adaptStoryLayoutCommand(next, slide.id)).project;
  }
  if (style.components.storyDesign) next = applyProjectCommand(next, storyDesignCommand(next, style.components.storyDesign, { keepPositions })).project;
  if (output) {
    next.recipe.outputVariant = output.variant; next.recipe.outputFormat = output.format;
    if (output.variants) next.recipe.outputVariants = clone(output.variants);
    else delete next.recipe.outputVariants; // Older output styles explicitly select their one shape.
  }
  const applied = { definition: clone(style), strength };
  if (slideId) next.recipe.slideStyles = { ...next.recipe.slideStyles, [slideId]: applied };
  else next.recipe.style = applied;
  validateProject(next);
  const commands = [];
  for (const [id, asset] of Object.entries(next.assets)) if (canonicalJSON(asset) !== canonicalJSON(project.assets[id])) commands.push({ type: "asset", id, value: asset });
  for (const id of new Set([...Object.keys(project.nodes), ...Object.keys(next.nodes)])) if (canonicalJSON(next.nodes[id]) !== canonicalJSON(project.nodes[id])) commands.push({ type: "node", id, value: next.nodes[id] ?? null });
  for (const type of ["shared", "slides", "recipe"]) if (canonicalJSON(next[type]) !== canonicalJSON(project[type])) commands.push({ type, value: next[type] });
  return { type: "group", commands };
}

export function serializeStyle(style) { validateStyle(style); return `${JSON.stringify(style, null, 2)}\n`; }
/** Explicit fallback, kept as one reversible edit; it never runs automatically. */
export function storyDeviceFontsCommand(project) {
  validateProject(project); const commands = [], replaced = new Set();
  for (const node of Object.values(project.nodes).filter((node) => node.kind === "text" && node.fontId)) {
    const next = clone(node); replaced.add(next.fontId); delete next.fontId;
    commands.push({ type: "node", id: node.id, value: next });
  }
  for (const id of replaced) commands.push({ type: "asset", id, value: null });
  return { type: "group", commands };
}
export function parseStyle(text) {
  check(typeof text === "string" && new TextEncoder().encode(text).length <= MAX_STYLE_BYTES, "Style files must be 32 KiB or smaller.");
  let value; try { value = JSON.parse(text); } catch { throw new Error("This file is not valid style JSON."); }
  return clone(validateStyle(value));
}
