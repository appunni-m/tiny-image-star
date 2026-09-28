// Project geometry: slide-local frames are fractions of the selected viewport.
// Story-space frames use slide widths horizontally and one slide height
// vertically, anchored to a stable slide ID. Legacy operations retain their
// original upright-source pixel coordinates and explicit transform order.
import { validatePhotoLook } from "../compositor/photo-look.js";
import { validateCutoutEffects } from "../compositor/cutout-effects-spec.js";
import { WORKING_COPY_EDGE, WORKING_COPY_METHOD, workingCopySize } from "./working-copy.js";
export const PROJECT_VERSION = 1;
export const PROJECT_KIND = "tiny-image-star/project";
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
export const LEGACY_ORDER = Object.freeze(["exif", "crop", "rotate", "flip", "resize", "adjust", "text", "encode"]);
export const LEGACY_ENGINE_IDENTITY = Object.freeze({ name: "pillow-rs", version: "12.2.0-alpha.1", adapter: "legacy-v1",
  javascriptSha256: "3d4251ad14e3731e680286d3ea9d8f25af932448596eaa2af09474ebcfd1b5ed",
  wasmSha256: "08dfff0b10424b6ece937574aefd4c07d1d4f8ac95643e7c4d5138ab720d5a96" });
export const ENGINE_IDENTITY = Object.freeze({ ...LEGACY_ENGINE_IDENTITY, compositor: "canvas-rgba-pillow-v1" });
export const clone = (value) => structuredClone(value);
export const newId = (kind) => `${kind}-${crypto.randomUUID()}`;

function fail(message, code = "INVALID_PROJECT") { const error = new Error(message); error.code = code; throw error; }
function check(condition, message) { if (!condition) fail(message); }
function number(value, min, max) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
function identifier(value) { return typeof value === "string" && value.length > 0 && value.length <= 512 && !["__proto__", "prototype", "constructor"].includes(value); }
function object(value) { return value && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function keys(value, allowed) { check(Object.keys(value).every((key) => allowed.includes(key)), "Unsupported project property."); }
function appearance(value) {
  check(object(value), "Invalid appearance settings.");
  keys(value, ["brightness", "contrast", "saturation", "grayscaleMix"]);
  for (const [key, amount] of Object.entries(value)) check(number(amount, 0, key === "grayscaleMix" ? 1 : 4), "Invalid appearance strength.");
}

export function validateData(value) {
  let count = 0;
  const visit = (item, depth) => {
    if (++count > 100_000 || depth > 20) fail("Project data is too complex.");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") { check(item.length <= 50_000, "Project text is too long."); return; }
    if (typeof item === "number") { check(Number.isFinite(item), "Project numbers must be finite."); return; }
    check(Array.isArray(item) || object(item), "Projects contain parameters and asset references, not executable code or image buffers.");
    for (const [key, child] of Object.entries(item)) {
      check(!["__proto__", "constructor", "prototype"].includes(key), "Unsafe project property.");
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  check(new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_PROJECT_BYTES, "Project metadata is too large.");
  return value;
}

export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function validateLegacyOperations(operations) {
  check(object(operations), "Missing legacy operations.");
  keys(operations, ["crop", "cropRelative", "rotation", "flipX", "flipY", "resizeWidth", "resizeHeight", "maxWidth", "maxHeight",
    "resizeMode", "aspectLocked", "brightness", "contrast", "grayscale", "photoLook", "textLayers", "lossy", "quality", "format", "jpegBackground", "presetId", "presetName"]);
  if (operations.photoLook != null) validatePhotoLook(operations.photoLook);
  for (const key of ["brightness", "contrast"]) if (operations[key] != null) check(number(operations[key], 0, 4), `Invalid ${key}.`);
  for (const key of ["resizeWidth", "resizeHeight", "maxWidth", "maxHeight"]) if (operations[key] != null) check(number(operations[key], 0, 80_000_000), `Invalid ${key}.`);
  // Preserve an overlarge edit intent for correction/undo. Render admission
  // separately enforces the actual pixel/memory limits before allocation.
  if (operations.rotation != null) check([0, 90, 180, 270].includes(operations.rotation), "Invalid legacy rotation.");
  if (operations.crop) for (const key of ["x", "y", "width", "height"]) check(number(operations.crop[key], 0, 80_000_000), "Invalid legacy crop.");
  check(!operations.textLayers || Array.isArray(operations.textLayers) && operations.textLayers.length <= 100, "Too many text layers.");
}

function validateFrame(frame) {
  check(object(frame) && number(frame.x, -40, 40) && number(frame.y, -4, 4)
    && number(frame.width, .000001, 40) && number(frame.height, .000001, 8), "Invalid normalized frame.");
  keys(frame, ["x", "y", "width", "height"]);
}
function validateVariantFrames(frames, variants) {
  check(object(frames) && Object.keys(frames).length <= variants.length, "Invalid output-specific frames.");
  for (const [id, frame] of Object.entries(frames)) {
    check(variants.some((variant) => variant.id === id), "A frame references an unknown output shape.");
    validateFrame(frame);
  }
}
function validateCrop(crop) {
  check(object(crop) && ["x", "y", "width", "height"].every((key) => number(crop[key], 0, 1))
    && crop.width > 0 && crop.height > 0 && crop.x + crop.width <= 1 && crop.y + crop.height <= 1, "Invalid normalized source crop.");
  keys(crop, ["x", "y", "width", "height"]);
}

function color(value) { return typeof value === "string" && /^#[a-f0-9]{6}([a-f0-9]{2})?$/i.test(value); }

function validateNodeStyle(node) {
  check(node.order == null && node.operations == null, "Scene layers cannot carry legacy operations.");
  if (node.color != null) check(color(node.color), "Invalid layer color.");
  if (node.fit != null) check(node.kind === "image" && ["cover", "contain"].includes(node.fit), "Invalid image fit.");
  if (node.focal != null) {
    check(node.kind === "image" && object(node.focal), "Invalid focal point.");
    keys(node.focal, ["x", "y"]);
    check(number(node.focal.x, 0, 1) && number(node.focal.y, 0, 1), "Invalid focal point.");
  }
  if (node.kind === "image") { check(node.style == null && node.fontId == null && node.text == null && node.color == null, "Unsupported image style."); return; }
  check(node.assetId == null, "Only image layers can reference a source image.");
  check(node.crop == null && node.maskId == null && node.appearance == null, "Only image layers support crop, masks and image adjustments.");
  const style = node.style ?? {};
  check(object(style), "Invalid layer style.");
  if (node.kind === "shape") {
    check(node.text == null, "Shapes cannot contain caption text.");
    keys(style, ["shape", "radius", "strokeColor", "strokeWidth"]);
    check(style.shape == null || ["rectangle", "rounded", "ellipse"].includes(style.shape), "Unsupported shape.");
    if (style.radius != null) check(number(style.radius, 0, .5), "Invalid corner radius.");
    if (style.strokeColor != null) check(color(style.strokeColor), "Invalid stroke color.");
    if (style.strokeWidth != null) check(number(style.strokeWidth, 0, .2), "Invalid stroke width.");
    check((style.strokeColor != null) === (style.strokeWidth != null), "A stroke needs both color and width.");
    check(node.fontId == null, "Shapes cannot reference a font.");
  } else if (node.kind === "text") {
    keys(style, ["builtinFont", "fontSize", "minFontSize", "fontBasis", "weight", "italic", "align", "verticalAlign", "lineHeight", "fit", "shadow"]);
    if (style.fontBasis != null) check(["width", "height"].includes(style.fontBasis), "Invalid font sizing basis.");
    if (style.builtinFont != null) check(["system-sans", "system-serif", "system-mono", "system-display"].includes(style.builtinFont), "Unknown built-in font.");
    if (style.fontSize != null) check(number(style.fontSize, .005, 1), "Invalid text size.");
    if (style.minFontSize != null) check(number(style.minFontSize, .005, style.fontSize ?? .05), "Invalid minimum text size.");
    if (style.weight != null) check([400, 600, 700, 800].includes(style.weight), "Invalid text weight.");
    if (style.italic != null) check(typeof style.italic === "boolean", "Invalid text style.");
    if (style.align != null) check(["left", "center", "right"].includes(style.align), "Invalid text alignment.");
    if (style.verticalAlign != null) check(["top", "middle", "bottom"].includes(style.verticalAlign), "Invalid vertical text alignment.");
    if (style.lineHeight != null) check(number(style.lineHeight, .8, 2.5), "Invalid line spacing.");
    if (style.fit != null) check(["shrink", "clip"].includes(style.fit), "Invalid text fit.");
    if (style.shadow != null) {
      check(object(style.shadow), "Invalid text shadow."); keys(style.shadow, ["color", "blur", "x", "y"]);
      check(color(style.shadow.color) && number(style.shadow.blur, 0, .05) && number(style.shadow.x, -.05, .05) && number(style.shadow.y, -.05, .05), "Invalid text shadow.");
    }
  }
}

export function assertEngineCompatibility(project, { allowLegacy = false } = {}) {
  const identity = canonicalJSON(project.engine);
  if (identity !== canonicalJSON(ENGINE_IDENTITY) && !(allowLegacy && identity === canonicalJSON(LEGACY_ENGINE_IDENTITY))) fail("This project needs a different renderer version. Its saved data has been preserved.", "UNSUPPORTED_PROJECT_RENDERER");
}

// Geometry/operations stay intact; the new identity records the change from
// browser final text encoding to the shared Pillow final-encode path.
export function upgradeProjectRenderer(project) {
  validateProject(project);
  assertEngineCompatibility(project, { allowLegacy: true });
  const upgraded = clone(project);
  if (canonicalJSON(project.engine) !== canonicalJSON(ENGINE_IDENTITY)) {
    upgraded.engine = clone(ENGINE_IDENTITY);
    upgraded.revision += 1;
  }
  return upgraded;
}

export function validateProject(project) {
  validateData(project);
  if (project?.kind !== PROJECT_KIND || project.version !== PROJECT_VERSION) fail("This project version is not supported. Its original data has been preserved.", "UNSUPPORTED_PROJECT_VERSION");
  keys(project, ["kind", "version", "id", "revision", "name", "createdAt", "seed", "engine", "models", "recipe", "assets", "nodes", "slides", "shared", "variants"]);
  check(identifier(project.id) && Number.isSafeInteger(project.revision) && project.revision >= 0, "Invalid project identity or revision.");
  check(Number.isInteger(project.seed) && number(project.seed, 0, 0xffffffff), "Invalid deterministic seed.");
  check(object(project.engine) && identifier(project.engine.name) && identifier(project.engine.version), "Missing engine identity.");
  check(Array.isArray(project.models) && project.models.length <= 16, "Invalid model dependencies.");
  check(object(project.assets) && Object.keys(project.assets).length <= 1000, "Invalid asset map.");
  for (const [id, asset] of Object.entries(project.assets)) {
    keys(asset, ["id", "kind", "name", "type", "byteLength", "sha256", "width", "height", "orientation", "lastModified", "license", "fontFace", "workingCopy"]);
    check(identifier(id) && asset.id === id && ["image", "mask", "font", "texture"].includes(asset.kind), "Invalid asset identity.");
    check(asset.sha256 === null || /^[a-f0-9]{64}$/.test(asset.sha256), "Invalid asset digest.");
    check(number(asset.byteLength, 0, 160 * 1024 * 1024), "Invalid asset size.");
    check(asset.orientation === "exif-to-upright" || asset.orientation === "upright", "Missing orientation policy.");
    check(!("url" in asset) && !("bytes" in asset), "Project assets must be local references.");
    if (asset.fontFace != null) {
      check(asset.kind === "font", "Only fonts can declare typeface settings."); keys(asset.fontFace, ["weight", "style"]);
      check(/^[1-9]00 [1-9]00$/.test(asset.fontFace.weight) && ["normal", "italic"].includes(asset.fontFace.style), "Invalid typeface settings.");
      const [minimum, maximum] = asset.fontFace.weight.split(" ").map(Number); check(minimum <= maximum, "Invalid font weight range.");
    }
    if (asset.width != null || asset.height != null) check(number(asset.width, 1, 80_000_000) && number(asset.height, 1, 80_000_000) && asset.width * asset.height <= 80_000_000, "Invalid source dimensions.");
    if (asset.workingCopy != null) {
      keys(asset.workingCopy, ["sourceAssetId", "sourceSha256", "maxEdge", "method"]);
      const { sourceAssetId, maxEdge, method } = asset.workingCopy, original = project.assets[sourceAssetId];
      check(["image", "mask"].includes(asset.kind) && asset.type === "image/png" && asset.orientation === "upright"
        && sourceAssetId !== id && original?.kind === asset.kind && !original.workingCopy
        && original.sha256 && asset.sha256 && maxEdge === WORKING_COPY_EDGE && method === WORKING_COPY_METHOD,
      "Invalid editing copy or missing original source.");
      if (asset.workingCopy.sourceSha256 != null) check(asset.workingCopy.sourceSha256 === original.sha256, "An editing copy's original source changed.");
      if (asset.kind === "mask") check(original.orientation === "upright", "A cutout copy needs an upright original.");
      const size = workingCopySize(original.width, original.height, maxEdge);
      check(Math.max(original.width, original.height) > maxEdge && asset.width === size.width && asset.height === size.height,
        "Editing copy dimensions do not match its original source.");
    }
  }
  check(Array.isArray(project.slides) && project.slides.length > 0 && project.slides.length <= 40, "A project needs 1–40 slides.");
  check(new Set(project.slides.map((slide) => slide.id)).size === project.slides.length, "Slide IDs must be unique.");
  check(object(project.nodes) && Object.keys(project.nodes).length <= 1000, "Invalid layer graph.");
  check(object(project.shared) && Array.isArray(project.variants) && project.variants.length > 0 && project.variants.length <= 8, "Missing shared settings or output variants.");
  keys(project.shared, ["appearance", "layout"]);
  appearance(project.shared.appearance);
  check(new Set(project.variants.map((variant) => variant.id)).size === project.variants.length, "Variant IDs must be unique.");
  for (const variant of project.variants) check(identifier(variant.id) && number(variant.width, 1, 16384) && number(variant.height, 1, 16384) && variant.width * variant.height <= 80_000_000, "Invalid output variant.");
  for (const slide of project.slides) {
    check(identifier(slide.id) && Array.isArray(slide.nodeIds) && slide.nodeIds.length <= 200 && new Set(slide.nodeIds).size === slide.nodeIds.length, "Invalid slide layers.");
    check(object(slide.overrides), "Missing slide overrides.");
    for (const id of slide.nodeIds) check(Object.hasOwn(project.nodes, id), "A slide references a missing layer.");
    for (const [id, patch] of Object.entries(slide.overrides)) {
      check(slide.nodeIds.includes(id) && object(patch), "Invalid local override.");
      check(Object.keys(patch).every((key) => ["frame", "variantFrames", "appearance", "crop", "text", "opacity"].includes(key)), "A local override cannot replace layer identity.");
      const kind = project.nodes[id].kind;
      check(kind !== "legacy-image" || Object.keys(patch).length === 0, "Legacy overrides belong in their operation record.");
      check(patch.text == null || kind === "text", "Only captions support text overrides.");
      check((patch.crop == null && patch.appearance == null) || kind === "image", "Only photos support crop and appearance overrides.");
      if (patch.frame) validateFrame(patch.frame);
      if (patch.variantFrames != null) validateVariantFrames(patch.variantFrames, project.variants);
      if (patch.appearance) appearance(patch.appearance);
      if (patch.crop) validateCrop(patch.crop);
      if (patch.opacity != null) check(number(patch.opacity, 0, 1), "Invalid local opacity.");
      if (patch.text != null) check(typeof patch.text === "string" && patch.text.length <= 5000, "Invalid local caption.");
    }
  }
  for (const [id, node] of Object.entries(project.nodes)) {
    keys(node, ["id", "kind", "name", "visible", "locked", "assetId", "maskId", "fontId", "order", "operations", "frame", "variantFrames", "space", "anchorSlideId", "opacity", "rotation", "appearance", "appearanceBase", "crop", "text", "style", "color", "fit", "focal", "depthTextId", "depthBackground", "connection", "cutoutEffects", "attachment"]);
    check(identifier(id) && node.id === id && ["legacy-image", "image", "text", "shape"].includes(node.kind), "Unsupported layer kind.");
    if (node.name != null) check(typeof node.name === "string" && node.name.trim().length > 0 && node.name.length <= 120, "Invalid layer name.");
    if (node.visible != null) check(typeof node.visible === "boolean", "Invalid layer visibility.");
    if (node.locked != null) check(typeof node.locked === "boolean", "Invalid layer lock state.");
    if (["legacy-image", "image"].includes(node.kind)) check(project.assets[node.assetId]?.kind === "image", "An image layer needs a source asset.");
    if (node.maskId != null) check(project.assets[node.maskId]?.kind === "mask", "A layer mask is missing.");
    if (node.fontId != null) check(project.assets[node.fontId]?.kind === "font", "A layer font is missing.");
    if (node.cutoutEffects != null) { check(node.kind === "image", "Only scene photos support cutout effects."); validateCutoutEffects(node.cutoutEffects); }
    if (node.attachment != null) {
      check(object(node.attachment), "Invalid photo decoration."); keys(node.attachment, ["schema", "imageId"]);
      const photo = project.nodes[node.attachment.imageId];
      check(node.kind === "shape" && node.attachment.schema === 1 && photo?.kind === "image", "A decoration must follow a scene photo.");
      check(node.space === photo.space && node.anchorSlideId === photo.anchorSlideId, "A decoration must share its photo's coordinate space.");
      for (const slide of project.slides) check(slide.nodeIds.includes(id) === slide.nodeIds.includes(photo.id), "A decoration must share its photo's slides.");
    }
    if (node.connection != null) {
      const connection = node.connection, left = project.slides.findIndex((slide) => slide.id === node.anchorSlideId);
      check(object(connection), "Invalid connected cutout."); keys(connection, ["schema", "rightSlideId"]);
      check(node.kind === "image" && node.space === "story" && connection.schema === 1 && left >= 0
        && project.slides[left + 1]?.id === connection.rightSlideId, "A connected cutout needs two neighboring slides.");
      for (const slide of project.slides) {
        check(slide.nodeIds.includes(id) === [node.anchorSlideId, connection.rightSlideId].includes(slide.id), "Both connected slides must share the same cutout.");
        for (const linked of [id, node.depthTextId].filter(Boolean)) check(!Object.keys(slide.overrides[linked] ?? {}).length, "Connected cutout edits must apply to both slides.");
      }
    }
    if (node.depthTextId != null || node.depthBackground != null) {
      const title = project.nodes[node.depthTextId];
      check(node.kind === "image" && title?.kind === "text" && ["photo", "page"].includes(node.depthBackground), "A depth title needs a photo, text layer and background choice.");
      check(title.style?.fontBasis === "width", "Depth title text size is relative to the photo width.");
      check(title.space === node.space && title.anchorSlideId === node.anchorSlideId, "A depth title must follow its photo's coordinate space.");
      check(Object.values(project.nodes).filter((other) => other.depthTextId === title.id).length === 1, "A depth title belongs to one photo.");
      for (const slide of project.slides) {
        const photoIndex = slide.nodeIds.indexOf(id), titleIndex = slide.nodeIds.indexOf(title.id);
        check(photoIndex < 0 ? titleIndex < 0 : titleIndex === photoIndex + 1, "A depth title must immediately follow its photo on each shared slide.");
      }
    }
    if (node.appearance) appearance(node.appearance);
    if (node.appearanceBase != null) { check(node.kind === "image", "Only scene photos support a scoped look."); appearance(node.appearanceBase); }
    if (node.kind === "legacy-image") {
      check(node.variantFrames == null, "Legacy image dimensions belong in their operation record.");
      check(canonicalJSON(node.order) === canonicalJSON(LEGACY_ORDER), "Unknown legacy transform order.");
      validateLegacyOperations(node.operations);
    } else {
      validateFrame(node.frame);
      if (node.variantFrames != null) validateVariantFrames(node.variantFrames, project.variants);
      check(["slide", "story"].includes(node.space), "Unknown coordinate space.");
      if (node.space === "story") check(project.slides.some((slide) => slide.id === node.anchorSlideId), "A connected layer needs its anchor slide.");
      if (node.opacity != null) check(number(node.opacity, 0, 1), "Invalid opacity.");
      if (node.rotation != null) check(number(node.rotation, -360, 360), "Invalid rotation.");
      if (node.kind === "text") check(typeof node.text === "string" && node.text.length <= 5000, "Invalid caption.");
      if (node.crop) validateCrop(node.crop);
      validateNodeStyle(node);
    }
  }
  return project;
}

export function createLegacyProject({ id = newId("project"), files, operations, name = "Untitled edit", seed = 1, createdAt = Date.now() }) {
  const project = { kind: PROJECT_KIND, version: PROJECT_VERSION, id, revision: 0, name, createdAt, seed,
    engine: { ...ENGINE_IDENTITY }, models: [], recipe: null, assets: {}, nodes: {}, slides: [], shared: { appearance: {} },
    variants: [{ id: "original", width: 1, height: 1, policy: "legacy-operation-dimensions" }] };
  files.forEach((file, index) => {
    const assetId = file.assetId ?? newId("asset"), nodeId = file.nodeId ?? newId("layer"), slideId = file.slideId ?? newId("slide");
    project.assets[assetId] = { id: assetId, kind: "image", name: file.name, type: file.type || "application/octet-stream",
      byteLength: file.size ?? file.bytes?.byteLength ?? 0, sha256: file.sha256 ?? null, width: file.width ?? null, height: file.height ?? null,
      orientation: "exif-to-upright", lastModified: file.lastModified ?? 0 };
    project.nodes[nodeId] = { id: nodeId, kind: "legacy-image", assetId, order: [...LEGACY_ORDER], operations: clone(operations[index]) };
    project.slides.push({ id: slideId, name: file.name, nodeIds: [nodeId], overrides: {} });
  });
  return validateProject(project);
}

export function createSceneProject({ id = newId("project"), name = "Untitled story", assets = {}, nodes = {}, slides,
  variants = [{ id: "portrait", width: 1080, height: 1350 }, { id: "tall", width: 1080, height: 1920 }], seed = 1, createdAt = Date.now() }) {
  return validateProject({ kind: PROJECT_KIND, version: PROJECT_VERSION, id, revision: 0, name, createdAt, seed,
    engine: clone(ENGINE_IDENTITY), models: [], recipe: null, assets: clone(assets), nodes: clone(nodes),
    slides: clone(slides ?? [{ id: newId("slide"), nodeIds: Object.keys(nodes), overrides: {} }]), shared: { appearance: {} }, variants: clone(variants) });
}

export function resolveSlide(project, slideId, variantId = project.variants[0].id) {
  validateProject(project);
  const slideIndex = project.slides.findIndex((slide) => slide.id === slideId), slide = project.slides[slideIndex];
  const variant = project.variants.find((entry) => entry.id === variantId);
  check(slide && variant, "Missing slide or output variant.");
  const nodes = slide.nodeIds.map((id) => {
    const source = project.nodes[id], patch = slide.overrides[id] ?? {};
    const node = { ...clone(source), ...clone(patch), appearance: { ...project.shared.appearance, ...source.appearanceBase, ...source.appearance, ...patch.appearance } };
    delete node.appearanceBase;
    if (node.assetId) node.asset = clone(project.assets[node.assetId]);
    if (node.maskId) node.mask = clone(project.assets[node.maskId]);
    if (node.fontId) node.font = clone(project.assets[node.fontId]);
    if (node.kind !== "legacy-image") {
      node.frame = clone(patch.variantFrames?.[variant.id] ?? patch.frame ?? source.variantFrames?.[variant.id] ?? source.frame);
      // Resolved render descriptions contain only this output's geometry.
      // Editing a different output shape must not invalidate this preview.
      delete node.variantFrames;
      const anchor = node.space === "story" ? project.slides.findIndex((item) => item.id === node.anchorSlideId) - slideIndex : 0;
      node.viewport = { x: (anchor + node.frame.x) * variant.width, y: node.frame.y * variant.height,
        width: node.frame.width * variant.width, height: node.frame.height * variant.height };
    }
    return node;
  });
  // Photo-relative titles and decorations follow the resolved frame, including
  // local/output-specific placement and rotation. Stored coordinates stay local.
  const followPhoto = (title, photo, text = false) => {
    const local = title.frame, box = photo.viewport;
    const angle = (photo.rotation ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const dx = (local.x + local.width / 2 - .5) * box.width, dy = (local.y + local.height / 2 - .5) * box.height;
    const w = local.width * box.width, h = local.height * box.height;
    title.viewport = { x: box.x + box.width / 2 + dx * cos - dy * sin - w / 2,
      y: box.y + box.height / 2 + dx * sin + dy * cos - h / 2, width: w, height: h };
    const anchor = title.space === "story" ? project.slides.findIndex((entry) => entry.id === title.anchorSlideId) - slideIndex : 0;
    title.frame = { x: title.viewport.x / variant.width - anchor, y: title.viewport.y / variant.height, width: w / variant.width, height: h / variant.height };
    title.rotation = (photo.rotation ?? 0) + (title.rotation ?? 0);
    if (text) title.style = { ...title.style, fontSize: (title.style?.fontSize ?? .05) * photo.frame.width,
      minFontSize: (title.style?.minFontSize ?? .012) * photo.frame.width, fontBasis: "width" };
  };
  for (const photo of nodes.filter((node) => node.depthTextId)) followPhoto(nodes.find((node) => node.id === photo.depthTextId), photo, true);
  for (const node of nodes.filter((node) => node.attachment)) followPhoto(node, nodes.find((photo) => photo.id === node.attachment.imageId));
  return { slideId, variant: clone(variant), nodes, seed: project.seed, engine: clone(project.engine), models: clone(project.models) };
}

export function affectedSlides(before, after) {
  const ids = new Set([...before.slides, ...after.slides].map((slide) => slide.id));
  const key = (project, id) => project.slides.some((slide) => slide.id === id)
    ? canonicalJSON(project.variants.map((variant) => resolveSlide(project, id, variant.id))) : null;
  return [...ids].filter((id) => key(before, id) !== key(after, id));
}
