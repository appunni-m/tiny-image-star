import { fontDigest, loadFontFace, verifyFontRecord } from "./fonts.js";
import { imagePlacement, nodeBounds, planScene, sceneError } from "./scene-spec.js";
import { frameMask, rasterSceneNode } from "./vector.js";
import { deviceBudget, sceneWork } from "../processing/policy.js";
import { isAnimatedImage } from "../input.js";
import { compositeDepthPixels } from "./depth.js";
import { cutoutEffectMetrics } from "./cutout-effects-spec.js";
import { applyLayerOpacity, decorateDepthPixels, renderCutoutDecoration } from "./cutout-effects.js";

const replace = (before, after) => { if (before !== after) before.free(); return after; };

function multiplyAlpha(api, image, mask) {
  let alpha, product;
  try { alpha = image.getchannel(3); product = api.ImageChops.multiply(alpha, mask); image.putalphaImageInput(product); }
  finally { alpha?.free(); product?.free(); }
}

function clipLayerToFrames(api, image, node, plan) {
  for (const clip of node.clipFrames ?? []) {
    const viewport = clip.frame, clipNode = { viewport, canonicalViewport: viewport, rotation: clip.rotation ?? 0, opacity: 1,
      style: { ...(clip.radius == null ? {} : { radius: clip.radius }) }, originX: 0 };
    clipNode.bounds = nodeBounds(clipNode, plan.height);
    let mask;
    try { mask = frameMask(api, clipNode, plan.width, plan.height); multiplyAlpha(api, image, mask); }
    finally { mask?.free(); }
  }
}

function renderImage(api, node, plan, bytes, openImage) {
  let source, mask, layer, subject, clip, decoration;
  const canonical = plan, original = node, padding = cutoutEffectMetrics(node, plan.height).padding;
  if (padding) {
    plan = { ...plan, width: plan.width + padding * 2, height: plan.height + padding * 2 };
    const shifted = (frame) => ({ ...frame, x: frame.x + padding, y: frame.y + padding });
    node = { ...node, opacity: 1, viewport: shifted(node.viewport), canonicalViewport: shifted(node.canonicalViewport), bounds: { ...shifted(node.bounds), padding: 2 } };
  }
  try {
    source = openImage(node.asset, bytes.get(node.assetId));
    source = replace(source, source.convert("RGBA", null));
    if (node.mask) {
      mask = openImage(node.mask, bytes.get(node.maskId));
      if (mask.mode !== "L") throw sceneError("UNSUPPORTED_OPERATION", "Story masks must be 8-bit grayscale images.");
      if (!node.depthText) { multiplyAlpha(api, source, mask); mask.free(); mask = null; }
    }
    const { box, matrix } = imagePlacement(node, source.width, source.height);
    if (box.left || box.top || box.right !== source.width || box.bottom !== source.height) source = replace(source, source.crop(box.left, box.top, box.right, box.bottom));
    if (mask && (box.left || box.top || box.right !== mask.width || box.bottom !== mask.height)) mask = replace(mask, mask.crop(box.left, box.top, box.right, box.bottom));
    const appearance = node.appearance;
    if (appearance.brightness != null && appearance.brightness !== 1) source = replace(source, source.enhanceBrightness(appearance.brightness));
    if (appearance.contrast != null && appearance.contrast !== 1) source = replace(source, source.enhanceContrast(appearance.contrast));
    const saturation = (appearance.saturation ?? 1) * (1 - (appearance.grayscaleMix ?? 0));
    if (saturation !== 1) source = replace(source, source.enhanceColor(saturation));
    // Depth reuses the adjusted photo in two branches. Materialize that prefix
    // once, then detach each viewport from its source-sized lazy pipeline.
    if (node.depthText) source.load();
    layer = source.transformWithInput([plan.width, plan.height], 0, matrix, 3, 1, [0, 0, 0, 0]);
    layer.load();
    if (node.depthText) {
      // Keep the decode and color adjustments in this worker. The second
      // transform uses the same pixels with subject coverage applied once.
      if (mask) { multiplyAlpha(api, source, mask); subject = source.transformWithInput([plan.width, plan.height], 0, matrix, 3, 1, [0, 0, 0, 0]); subject.load(); }
      else subject = new api.Image("RGBA", plan.width, plan.height, 0, 0, 0, 0);
    }
    source.free(); source = null;
    const frame = node.viewport;
    if (node.rotation || (node.opacity ?? 1) !== 1 || frame.x > 0 || frame.y > 0 || frame.x + frame.width < plan.width || frame.y + frame.height < plan.height) {
      clip = frameMask(api, node, plan.width, plan.height); multiplyAlpha(api, layer, clip); if (subject) multiplyAlpha(api, subject, clip);
    }
    if (padding) {
      decoration = renderCutoutDecoration(api, subject ?? layer, node, canonical.height);
      if (subject) {
        const decorated = decorateDepthPixels(layer.toBytes(), subject.toBytes(), decoration.toBytes());
        layer = replace(layer, api.fromBytesFn("RGBA", plan.width, plan.height, decorated.photo, "raw"));
        subject = replace(subject, api.fromBytesFn("RGBA", plan.width, plan.height, decorated.subject, "raw"));
      } else { decoration.alphaComposite(layer); layer = replace(layer, decoration); decoration = null; }
      // Complete the photo/outline/shadow group before multiplying opacity.
      // The existing depth-title mix keeps the title's own independent opacity.
      applyLayerOpacity(layer, original.opacity); if (subject) applyLayerOpacity(subject, original.opacity);
      layer = replace(layer, layer.crop(padding, padding, padding + canonical.width, padding + canonical.height));
      if (subject) subject = replace(subject, subject.crop(padding, padding, padding + canonical.width, padding + canonical.height));
    }
    const result = { image: layer, subject }; layer = subject = null; return result;
  } finally { source?.free(); mask?.free(); layer?.free(); subject?.free(); clip?.free(); decoration?.free(); }
}

/** Render one canonical viewport. The caller owns and must free result.image. */
export async function renderScene(api, request, { openImage }) {
  const plan = planScene(request.project, request.slideId, request.variantId, request);
  const estimate = sceneWork(plan);
  if (request.memoryEstimate && (estimate.heap > request.memoryEstimate.heap || estimate.transient > request.memoryEstimate.transient)) throw sceneError("TOO_LARGE", "The story changed or exceeds its processing memory budget.");
  if (!request.memoryEstimate && estimate.heap + estimate.transient > deviceBudget(globalThis.navigator ?? {}).memory) throw sceneError("TOO_LARGE", "This story exceeds the processing memory budget. Choose smaller sources or output dimensions.");
  const packets = new Map();
  for (const packet of request.assets ?? []) {
    if (packets.has(packet.id)) throw sceneError("INVALID_SCENE", "A story asset was supplied more than once.");
    packets.set(packet.id, packet.bytes);
  }
  if (packets.size !== plan.assets.length) throw sceneError("MISSING_ASSET", "The story asset set does not match this slide.");
  const bytes = new Map(), fonts = new Map(), warnings = [];
  let image;
  try {
    // Check byte identity before any source decode. No rendering fallback is
    // allowed to substitute an unrelated image, mask or font.
    for (const asset of plan.assets) {
      const packet = packets.get(asset.id);
      if (!(packet instanceof ArrayBuffer) && !ArrayBuffer.isView(packet)) throw sceneError("MISSING_ASSET", "A story source is missing. Restore the original file.");
      const data = packet instanceof ArrayBuffer ? new Uint8Array(packet) : new Uint8Array(packet.buffer, packet.byteOffset, packet.byteLength);
      if (data.byteLength !== asset.byteLength || await fontDigest(data) !== asset.sha256) throw sceneError("ASSET_CHANGED", "A story asset failed its integrity check. Restore the original file.");
      if (asset.kind !== "font" && isAnimatedImage(data)) throw sceneError("UNSUPPORTED_OPERATION", "Animated images are not supported in stories yet.");
      bytes.set(asset.id, data);
      if (asset.kind === "font") {
        const record = { id: `font-${asset.sha256.slice(0, 16)}`, sha256: asset.sha256, bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), ...(asset.fontFace ? { fontFace: asset.fontFace } : {}) };
        fonts.set(asset.id, await loadFontFace(await verifyFontRecord(record, { id: record.id, sha256: asset.sha256, bytes: asset.byteLength })));
      }
    }
    image = new api.Image("RGBA", plan.width, plan.height, 0, 0, 0, 0);
    for (const node of plan.nodes) {
      let layer, subject, words;
      try {
        if (node.kind === "image") {
          if (node.connection && !node.mask) warnings.push({ code: "CONNECTION_SUBJECT_NEEDED", nodeId: node.id });
          if (!node.mask && (node.cutoutEffects?.outline?.width > 0 || node.cutoutEffects?.shadow?.opacity > 0)) warnings.push({ code: "CUTOUT_EFFECTS_SUBJECT_NEEDED", nodeId: node.id });
          ({ image: layer, subject } = renderImage(api, node, plan, bytes, openImage));
          if (subject) {
            if (!node.mask) warnings.push({ code: "DEPTH_SUBJECT_NEEDED", nodeId: node.id });
            words = rasterSceneNode(api, node.depthText, plan.width, plan.height, fonts, warnings);
            const pixels = compositeDepthPixels(layer.toBytes(), subject.toBytes(), words.toBytes(), !node.mask || node.depthBackground === "photo");
            layer = replace(layer, api.fromBytesFn("RGBA", plan.width, plan.height, pixels, "raw"));
          }
        } else layer = rasterSceneNode(api, node, plan.width, plan.height, fonts, warnings);
        if (node.clipFrames?.length) {
          clipLayerToFrames(api, layer, node, plan);
          if (subject) clipLayerToFrames(api, subject, node, plan);
        }
        image.alphaComposite(layer);
      } finally { layer?.free(); subject?.free(); words?.free(); }
    }
    // Preview uses the exact canonical composition and a single final
    // downsample. Its estimate still reserves the full source/slide work.
    if (plan.outputWidth !== plan.width || plan.outputHeight !== plan.height) image = replace(image, image.resize(plan.outputWidth, plan.outputHeight, "LANCZOS"));
    const result = { image, plan, warnings }; image = null; return result;
  } finally {
    image?.free();
    const fontSet = globalThis.document?.fonts ?? globalThis.fonts;
    for (const font of fonts.values()) fontSet?.delete(font.face);
  }
}
