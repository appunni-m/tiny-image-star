import { maskWork, paintMask } from "./mask-spec.js";
import { fontDigest } from "./fonts.js";
import { sceneError } from "./scene-spec.js";
import { deviceBudget } from "../processing/policy.js";
import { isAnimatedImage } from "../input.js";

const replace = (old, next) => { if (old !== next) old.free(); return next; };
const data = (bytes) => bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export async function editMask(api, request, { openImage }) {
  const { source, mask, importMask, reset, stroke, previewEdge = 1024, previewRegion, previewOnly = false } = request;
  if (source?.asset?.kind !== "image" || !["upright", "exif-to-upright"].includes(source.asset.orientation) || !source.bytes
    || mask && (mask.asset?.kind !== "mask" || mask.asset.orientation !== "upright")
    || mask && importMask || reset != null && !["show", "hide"].includes(reset)
    || typeof previewOnly !== "boolean" || previewOnly && (importMask || reset || stroke)) throw sceneError("INVALID_MASK", "Invalid cutout request.");
  const width = source.asset.width, height = source.asset.height;
  const encodedBytes = [source, mask, importMask].reduce((sum, entry) => sum + (entry?.bytes?.byteLength ?? 0), 0);
  const estimate = maskWork({ width, height, encodedBytes, previewEdge, previewRegion });
  if (request.memoryEstimate ? estimate.heap > request.memoryEstimate.heap || estimate.transient > request.memoryEstimate.transient
    : estimate.heap + estimate.transient > deviceBudget(globalThis.navigator ?? {}).memory) throw sceneError("TOO_LARGE", "This cutout exceeds the processing memory budget. Choose a smaller photo.");
  for (const entry of [source, mask].filter(Boolean)) {
    if (!entry.asset?.sha256 || entry.bytes.byteLength !== entry.asset.byteLength || await fontDigest(data(entry.bytes)) !== entry.asset.sha256) throw sceneError("ASSET_CHANGED", "A cutout source failed its integrity check.");
    if (isAnimatedImage(data(entry.bytes))) throw sceneError("INVALID_MASK", "Choose a still image for this cutout.");
  }
  let photo, image, preview, channel, product, small;
  try {
    photo = openImage(source.asset, data(source.bytes));
    photo = replace(photo, photo.convert("RGBA", null));
    if (reset) { const value = reset === "show" ? 255 : 0; image = new api.Image("L", width, height, value, value, value, 255); }
    else if (importMask) {
      const bytes = data(importMask.bytes);
      if (bytes.length > 16 * 1024 * 1024 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
        || isAnimatedImage(bytes) || !["luminance", "alpha"].includes(importMask.mode)) throw sceneError("INVALID_MASK", "Choose a still PNG mask under 16 MB.");
      if (bytes[24] === 16) throw sceneError("INVALID_MASK", "16-bit masks are not supported. Export an 8-bit PNG mask first.");
      image = api.Image.open(bytes);
      if (image.width !== width || image.height !== height) throw sceneError("INVALID_MASK", `The mask must be ${width} × ${height} pixels, matching the upright photo.`);
      if (importMask.mode === "alpha") { image = replace(image, image.convert("RGBA", null)); image = replace(image, image.getchannel(3)); }
      else image = replace(image, image.convert("L", null));
    } else if (mask) {
      image = openImage(mask.asset, data(mask.bytes));
      if (image.mode !== "L" || image.width !== width || image.height !== height) throw sceneError("INVALID_MASK", "The saved mask does not match the upright photo.");
    } else image = new api.Image("L", width, height, 255, 255, 255, 255);
    if (stroke) {
      const pixels = paintMask(image.toBytes(), width, height, stroke);
      image = replace(image, api.fromBytesFn("L", width, height, pixels, "raw"));
    }
    const png = (value) => value.saveWithInput("PNG", null);
    const maskBytes = previewOnly ? {} : { mask: png(image) };
    const region = previewRegion ?? { x: 0, y: 0, width, height };
    if (previewRegion) {
      const { x, y, width: w, height: h } = region;
      photo = replace(photo, photo.crop(x, y, x + w, y + h));
      image = replace(image, image.crop(x, y, x + w, y + h));
    }
    const scale = previewRegion ? 1 : Math.min(1, previewEdge / Math.max(width, height));
    const previewWidth = Math.max(1, Math.round(region.width * scale)), previewHeight = Math.max(1, Math.round(region.height * scale));
    let sourcePreview;
    if (previewRegion) sourcePreview = png(photo);
    else { small = photo.resize(previewWidth, previewHeight, "LANCZOS"); sourcePreview = png(small); small.free(); small = null; }
    channel = photo.getchannel(3); product = api.ImageChops.multiply(channel, image); photo.putalphaImageInput(product);
    channel.free(); channel = null; product.free(); product = null;
    // Detail crops never pass through resize: each returned pixel is exactly
    // one upright source pixel. The UI may enlarge it with nearest sampling.
    if (!previewRegion) { preview = photo.resize(previewWidth, previewHeight, "LANCZOS"); small = image.resize(previewWidth, previewHeight, "LANCZOS"); }
    return { ...maskBytes, preview: png(preview ?? photo), sourcePreview, maskPreview: png(small ?? image), width, height, previewWidth, previewHeight, region, detail: Boolean(previewRegion) };
  } finally { photo?.free(); image?.free(); preview?.free(); channel?.free(); product?.free(); small?.free(); }
}
