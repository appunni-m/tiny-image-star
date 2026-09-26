import { assertEngineCompatibility, resolveSlide, validateProject } from "../project/model.js";
import { MAX_FONT_BYTES, MAX_TEXT_FONT_BYTES, MAX_TEXT_FONTS } from "./fonts.js";
import { cutoutEffectMetrics } from "./cutout-effects-spec.js";
import { unsupportedFontCharacters } from "../styles/font-pack.js";

export const SCENE_VERSION = 1;
export const PREVIEW_EDGE = 1280;

export function sceneError(code, message) {
  const error = new Error(message); error.code = code; error.userMessage = message; return error;
}

export function nodeBounds(node, height) {
  const frame = node.viewport, radians = (node.rotation ?? 0) * Math.PI / 180;
  const width = Math.abs(Math.cos(radians)) * frame.width + Math.abs(Math.sin(radians)) * frame.height;
  const tall = Math.abs(Math.sin(radians)) * frame.width + Math.abs(Math.cos(radians)) * frame.height;
  const shadow = node.style?.shadow;
  const padding = shadow ? Math.ceil((shadow.blur * 3 + Math.max(Math.abs(shadow.x), Math.abs(shadow.y))) * height) + 2 : 2;
  const extent = padding + cutoutEffectMetrics(node, height).padding + Math.min(frame.width, frame.height) * (node.style?.strokeWidth ?? 0) * .75;
  return { x: frame.x + (frame.width - width) / 2 - extent, y: frame.y + (frame.height - tall) / 2 - extent,
    width: width + extent * 2, height: tall + extent * 2, padding };
}

export function planScene(project, slideId, variantId, { preview = false, previewEdge = PREVIEW_EDGE, format = "png" } = {}) {
  validateProject(project); assertEngineCompatibility(project);
  const resolved = resolveSlide(project, slideId, variantId);
  const { width, height } = resolved.variant;
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw sceneError("INVALID_SCENE", "Slide dimensions must be whole pixels.");
  if (!["png", "jpeg"].includes(format)) throw sceneError("UNSUPPORTED_OPERATION", "Choose PNG or JPEG for this story.");
  if (!Number.isInteger(previewEdge) || previewEdge < 1 || previewEdge > PREVIEW_EDGE) throw sceneError("INVALID_SCENE", "The preview size is outside its supported range.");
  const nodes = [], assets = new Map();
  const slideIndex = project.slides.findIndex((slide) => slide.id === slideId);
  const linkedTitles = new Set(resolved.nodes.map((node) => node.depthTextId).filter(Boolean));
  const prepare = (node) => {
    if (node.kind === "legacy-image") throw sceneError("UNSUPPORTED_OPERATION", "Use the image editor to render a legacy image document.");
    const anchorIndex = node.space === "story" ? project.slides.findIndex((slide) => slide.id === node.anchorSlideId) : 0;
    // Rasterize in coordinates relative to this object's anchor. Absolute
    // story offsets change canvas sampling/rounding when a connected pair is
    // reordered, even though its physical composition is unchanged.
    const originX = node.space === "story" ? (slideIndex - anchorIndex) * width : 0;
    const canonicalViewport = { ...node.viewport, x: node.frame.x * width };
    node.viewport = { ...canonicalViewport, x: canonicalViewport.x - originX };
    const bounds = nodeBounds(node, height);
    return { ...node, bounds, canonicalViewport, originX };
  };
  for (const raw of resolved.nodes) {
    if (linkedTitles.has(raw.id)) continue;
    const node = prepare(raw);
    if (node.depthTextId) node.depthText = prepare(resolved.nodes.find((entry) => entry.id === node.depthTextId));
    const visible = (layer) => layer.opacity !== 0 && layer.bounds.x < width && layer.bounds.y < height && layer.bounds.x + layer.bounds.width > 0 && layer.bounds.y + layer.bounds.height > 0;
    if (!visible(node) && (!node.depthText || !visible(node.depthText))) continue;
    nodes.push(node);
    for (const text of [node, node.depthText].filter((entry) => entry?.kind === "text" && visible(entry))) {
      if (text.font && unsupportedFontCharacters(text.font, text.text).length) throw sceneError("FONT_CHARACTERS_UNAVAILABLE", `${text.font.name} does not include every character in this text. Open Text to choose device fonts or edit the words.`);
      if (text.font?.fontFace) {
        const [minimum, maximum] = text.font.fontFace.weight.split(" ").map(Number), weight = text.style?.weight ?? 700;
        if (weight < minimum || weight > maximum || (text.style?.italic ? "italic" : "normal") !== text.font.fontFace.style)
          throw sceneError("FONT_STYLE_UNAVAILABLE", `${text.font.name} does not include this weight or italic style. Open Text to choose device fonts or a supported style.`);
      }
    }
    for (const asset of [node.asset, node.mask, node.font, node.depthText?.font].filter(Boolean)) {
      if (!asset.sha256 || !asset.byteLength) throw sceneError("MISSING_ASSET", "A story asset needs verified local bytes before rendering.");
      if (asset.kind !== "font" && (!asset.width || !asset.height)) throw sceneError("MISSING_ASSET", "A story source is missing its verified dimensions.");
      if (asset.kind === "mask" && asset.orientation !== "upright") throw sceneError("INVALID_SCENE", "Masks must use upright source coordinates.");
      assets.set(asset.id, asset);
    }
    if (node.mask && (node.mask.width !== node.asset.width || node.mask.height !== node.asset.height)) throw sceneError("INVALID_SCENE", "A mask must match its upright source dimensions.");
  }
  const fonts = [...assets.values()].filter((asset) => asset.kind === "font");
  if (fonts.length > MAX_TEXT_FONTS || fonts.some((asset) => asset.byteLength > MAX_FONT_BYTES)
    || fonts.reduce((sum, asset) => sum + asset.byteLength, 0) > MAX_TEXT_FONT_BYTES) throw sceneError("TOO_LARGE", "The story fonts exceed the per-slide font limits.");
  const scale = preview ? Math.min(1, previewEdge / Math.max(width, height)) : 1;
  return { version: SCENE_VERSION, projectId: project.id, revision: project.revision, slideId, variantId: resolved.variant.id,
    width, height, outputWidth: Math.max(1, Math.round(width * scale)), outputHeight: Math.max(1, Math.round(height * scale)),
    preview, format: preview ? "png" : format, nodes, assets: [...assets.values()], seed: resolved.seed };
}

// Crop in upright source pixels; fit then rotates clockwise around the frame.
// The inverse affine maps viewport pixel centers to cropped source pixels.
export function imagePlacement(node, width, height) {
  const crop = node.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const box = { left: Math.max(0, Math.floor(crop.x * width)), top: Math.max(0, Math.floor(crop.y * height)),
    right: Math.min(width, Math.ceil((crop.x + crop.width) * width)), bottom: Math.min(height, Math.ceil((crop.y + crop.height) * height)) };
  const sourceWidth = box.right - box.left, sourceHeight = box.bottom - box.top;
  if (sourceWidth < 1 || sourceHeight < 1) throw sceneError("INVALID_SCENE", "This crop has no source pixels.");
  const frame = node.viewport;
  const scale = (node.fit === "contain" ? Math.min : Math.max)(frame.width / sourceWidth, frame.height / sourceHeight);
  const focal = node.focal ?? { x: .5, y: .5 };
  const left = frame.x + (frame.width - sourceWidth * scale) * focal.x;
  const top = frame.y + (frame.height - sourceHeight * scale) * focal.y;
  const cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2;
  const angle = (node.rotation ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return { box, matrix: [cos / scale, sin / scale, (cx - cos * cx - sin * cy - left) / scale,
    -sin / scale, cos / scale, (cy + sin * cx - cos * cy - top) / scale] };
}
