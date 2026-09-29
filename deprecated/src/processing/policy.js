import { textFontRequirements } from "../compositor/fonts.js";
import { cutoutEffectMetrics } from "../compositor/cutout-effects-spec.js";
import { workingCopySize } from "../project/working-copy.js";

export const MiB = 1024 * 1024;
export const INITIAL_HEAP_BYTES = 32 * MiB;
export const MAX_SOURCE_BYTES = 160 * MiB;

const positive = (value, fallback = 0) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

export function deviceBudget({ hardwareConcurrency = 2, deviceMemory } = {}) {
  const reported = Math.min(128, Math.max(1, Math.floor(positive(hardwareConcurrency, 2))));
  return {
    cpu: Math.max(1, reported - (reported > 2 ? 1 : 0)),
    // A hint, not a measurement of process RAM. Safari's absent hint gets a
    // conservative budget; real-device qualification remains necessary.
    memory: Math.min(2 * 1024 * MiB, Math.max(256 * MiB, positive(deviceMemory, 4) * 1024 * MiB * .125)),
  };
}

export function inspectionWork(encodedBytes) {
  const bytes = positive(encodedBytes);
  if (bytes > MAX_SOURCE_BYTES) throw new Error("This source is too large to process safely. Choose a smaller image.");
  return { heap: INITIAL_HEAP_BYTES + bytes * 3, transient: bytes * 2 + 4 * MiB, output: 0, cpu: 1 };
}

export function imageWork({ width, height, encodedBytes = 0, settings = {}, preview = false, imagePreview = false, journal = false }) {
  const pixels = positive(width) * positive(height);
  if (!pixels || pixels > 80_000_000) throw new Error("This image is too large or its dimensions are unavailable.");
  const bytes = positive(encodedBytes);
  inspectionWork(bytes);
  const requested = positive(settings.resizeWidth) * positive(settings.resizeHeight);
  // Crop/rotation/interpolation and alpha flattening can coexist with input
  // and output buffers. This is a conservative estimate, not observed RSS.
  // The current preview binding still encodes full size. Do not budget it as
  // a thumbnail until the shared compositor implements a reduced decode path.
  const outputPixels = Math.max(pixels, preview ? 0 : requested);
  if (outputPixels > 80_000_000) throw new Error("This output is too large to process safely. Choose smaller dimensions.");
  const output = Math.ceil(outputPixels * 4 * 1.02 + MiB);
  const text = !preview && Boolean(settings.textLayers?.length);
  const fontBytes = text ? textFontRequirements(settings.textLayers).bytes : 0;
  return {
    heap: INITIAL_HEAP_BYTES + pixels * 16 + outputPixels * ((text ? 24 : 8) + (settings.photoLook ? 8 : 0) + (imagePreview ? 8 : 0)) + bytes * 3,
    // Folder recovery may read a saved output while SHA-256 keeps a snapshot.
    // Text reserves canvas backing + readback, shaping overhead, stored font
    // bytes and browser font decoding. Folder jobs also reserve immutable
    // snapshot Blob/hash/storage copies. This is an estimate, not observed RSS.
    transient: bytes * 2 + output * (journal ? 3 : 1) + (text ? outputPixels * 8 + 4 * MiB + fontBytes * (journal ? 8 : 6) : 0),
    output,
    cpu: 1,
  };
}

export function normalizeEstimate(value) {
  for (const key of ["heap", "transient", "output", "cpu"]) {
    if (!Number.isFinite(value?.[key]) || value[key] < 0) throw new Error(`Invalid processing estimate: ${key}`);
  }
  if (value.cpu < 1) throw new Error("A processing task must reserve at least one CPU token.");
  return { ...value, heap: Math.max(INITIAL_HEAP_BYTES, value.heap), cpu: Math.ceil(value.cpu) };
}

export function workingCopyWork({ width, height, encodedBytes, settings, target }) {
  const base = imageWork({ width, height, encodedBytes, settings });
  const copy = target ?? workingCopySize(width, height);
  const encodedCopy = Math.ceil(copy.width * copy.height * 4 * 1.02 + MiB);
  // The worker's encoded output can coexist with the retained Blob and the
  // SHA-256 snapshot before ownership settles. Reserve these before decoding.
  return { ...base, transient: base.transient + encodedCopy * 2 };
}

export function sceneWork(plan) {
  const pixels = plan.width * plan.height;
  if (!pixels || pixels > 80_000_000) throw new Error("This slide is too large to process safely.");
  const inputs = plan.assets.filter((asset) => asset.kind !== "font");
  const encoded = plan.assets.reduce((sum, asset) => sum + asset.byteLength, 0);
  if (encoded > MAX_SOURCE_BYTES) throw new Error("The sources used by this slide exceed the processing memory budget.");
  const largest = Math.max(0, ...inputs.map((asset) => asset.width * asset.height));
  const largestBytes = Math.max(0, ...inputs.map((asset) => asset.byteLength));
  const padding = Math.max(64, ...plan.nodes.flatMap((node) => [node.bounds.padding, node.depthText?.bounds.padding ?? 0]));
  const depth = plan.nodes.some((node) => node.depthText);
  const surface = (256 + padding * 2) ** 2;
  const fonts = plan.assets.filter((asset) => asset.kind === "font").reduce((sum, asset) => sum + asset.byteLength, 0);
  const output = Math.ceil(plan.outputWidth * plan.outputHeight * 4 * 1.02 + MiB);
  const effectPadding = Math.max(0, ...plan.nodes.map((node) => cutoutEffectMetrics(node, plan.height).padding));
  const effectPixels = effectPadding ? (plan.width + effectPadding * 2) * (plan.height + effectPadding * 2) : 0;
  // Sources are decoded one layer at a time. A connected layer is transformed
  // directly into this viewport; there is never a story-width decoded canvas.
  return { heap: INITIAL_HEAP_BYTES + largest * 24 + pixels * (depth ? 56 : 40) + effectPixels * (depth ? 48 : 32) + largestBytes * 3,
    transient: encoded * 2 + surface * 8 + pixels * (depth ? 21 : 5) + effectPixels * (depth ? 24 : 12) + fonts * 6 + output + 4 * MiB, output, cpu: 1 };
}

export function workClass({ width, height, settings = {}, preview = false, imagePreview = false }) {
  const pixels = Math.max(1, positive(width) * positive(height));
  const output = Math.max(1, positive(settings.resizeWidth) * positive(settings.resizeHeight) || pixels);
  const operations = [settings.resizeMode === "crop" ? "fill" : "fit", settings.crop || settings.cropRelative ? "crop" : "whole",
    settings.rotation || settings.flipX || settings.flipY ? "orient" : "still",
    settings.grayscale || settings.brightness !== 1 || settings.contrast !== 1 ? "adjust" : "plain",
    settings.textLayers?.length ? "text" : "image", settings.photoLook ? "photo-look" : "no-look"].join("-");
  return `${imagePreview ? "image-preview" : preview ? "preview" : "render"}:${settings.format ?? "png"}:${Math.floor(Math.log2(pixels))}:${Math.floor(Math.log2(output))}:${operations}`;
}
