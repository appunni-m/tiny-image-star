import { formatMime, normalizeCapabilities, normalizeFormat } from "../formats.js";
import { MAX_IMAGE_PIXELS, isAnimatedImage } from "../input.js";
import { outputFileName } from "../names.js";
import { USE_BROTLI_WASM } from "./runtime-assets.js";
import { preservePngPalette } from "./png.js";
import { imageWork, workingCopyWork, deviceBudget } from "../processing/policy.js";
import { fontDigest } from "../compositor/fonts.js";
import { compositeText } from "../compositor/raster.js";
import { renderScene } from "../compositor/scene.js";
import { SCENE_VERSION, sceneError } from "../compositor/scene-spec.js";
import { photoLookAppearance } from "../compositor/photo-look.js";
import { ENGINE_IDENTITY } from "../project/model.js";

const inputFormats = ["jpeg", "png", "gif", "bmp", "webp", "tiff", "ico"];
const outputFormats = ["png"];
// Additional codecs need independent output qualification before exposure.
const QUALIFIED_OUTPUT_FORMATS = ["png", "jpeg"];

export const CAPABILITIES = Object.freeze({
  inputFormats,
  outputFormats,
  avif: { input: false, output: false },
});

let apiPromise;
let wasmExports;

async function fetchBrotliWasm() {
  if (!USE_BROTLI_WASM || typeof DecompressionStream !== "function") return null;
  const wasmUrl = new URL("../../wasm/pillow_rs_js_bg.wasm", import.meta.url);
  const compressedUrl = new URL("pillow_rs_js_bg.wasm.br", wasmUrl);
  try {
    const response = await fetch(compressedUrl);
    if (!response.ok || !response.body?.pipeThrough) return null;
    const decompressed = response.body.pipeThrough(new DecompressionStream("brotli"));
    return new Uint8Array(await new Response(decompressed).arrayBuffer());
  } catch {
    // Development and older browsers may not have the release sidecar or
    // Brotli decompression. The generated binding's normal .wasm path remains
    // the compatibility fallback.
    return null;
  }
}

function loadApi() {
  if (!apiPromise) {
    apiPromise = import("../../wasm/pillow_rs_js.js").then(async (api) => {
      // Passing undefined preserves the generated binding's normal URL-based
      // loader when the release sidecar is unavailable.
      const bytes = await fetchBrotliWasm();
      wasmExports = await api.default(bytes ? { module_or_path: bytes } : undefined);
      return api;
    });
  }
  return apiPromise;
}

function replaceImage(current, next) {
  if (current !== next) current.free();
  return next;
}

function checkMemoryBudget(image, file, settings = {}, preview = false) {
  if (!file.memoryEstimate) return;
  const actual = imageWork({ width: image.width, height: image.height, encodedBytes: file.bytes.byteLength, settings, preview });
  if (actual.heap > file.memoryEstimate.heap || actual.transient > file.memoryEstimate.transient) throw new Error("Source changed or exceeds the processing memory budget");
}

export function exifOrientationFromBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const read16 = (offset, little) => little
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
  const read32 = (offset, little) => little
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    : (((bytes[offset] << 24) >>> 0) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    const dataStart = offset + 2;
    if (marker === 0xe1 && bytes[dataStart] === 0x45 && bytes[dataStart + 1] === 0x78 && bytes[dataStart + 2] === 0x69 && bytes[dataStart + 3] === 0x66 && bytes[dataStart + 4] === 0 && bytes[dataStart + 5] === 0) {
      const tiff = dataStart + 6;
      if (tiff + 8 > bytes.length) return null;
      const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      if ((!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) || read16(tiff + 2, little) !== 42) return null;
      const ifd = tiff + read32(tiff + 4, little);
      if (ifd + 2 > bytes.length) return null;
      const count = read16(ifd, little);
      for (let index = 0; index < count; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (entry + 12 > bytes.length) return null;
        if (read16(entry, little) !== 0x0112) continue;
        const type = read16(entry + 2, little);
        const valueCount = read32(entry + 4, little);
        if (type === 3 && valueCount >= 1) return read16(entry + 8, little);
        return null;
      }
      return null;
    }
    offset += length;
  }
  return null;
}

function applyExifOrientation(api, image, bytes) {
  const bindingOrientation = typeof api?.exifOrientation === "function" ? api.exifOrientation(bytes) : null;
  const candidate = Number(bindingOrientation);
  const orientation = candidate >= 1 && candidate <= 8
    ? candidate
    : Number(exifOrientationFromBytes(bytes) ?? 1);
  const operations = {
    2: "FLIP_LEFT_RIGHT",
    3: "ROTATE_180",
    4: "FLIP_TOP_BOTTOM",
    5: "TRANSPOSE",
    6: "ROTATE_270",
    7: "TRANSVERSE",
    8: "ROTATE_90",
  };
  const operation = operations[orientation];
  return operation ? replaceImage(image, image.transpose(operation)) : image;
}

function findEncoder(image, format) {
  if (!QUALIFIED_OUTPUT_FORMATS.includes(format)) return null;
  // Pinned API: the second argument is an extension hint, never quality.
  if (typeof image.saveWithInput === "function") return () => {
    const bytes = image.saveWithInput(format.toUpperCase(), null);
    return format === "png" && image.mode === "P"
      ? preservePngPalette(bytes, image.getpalette("RGB")?.length)
      : bytes;
  };
  if (format === "png" && typeof image.save === "function") return () => image.save();
  return null;
}

function flattenForJpeg(api, image, background = [255, 255, 255]) {
  if (!Array.isArray(background) || background.length !== 3
      || background.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error("invalid JPEG background");
  }
  if (image.mode === "RGB") return image;
  let rgba;
  let canvas;
  try {
    rgba = image.convert("RGBA", null);
    canvas = new api.Image("RGBA", image.width, image.height, ...background, 255);
    canvas.alphaComposite(rgba);
    return canvas.convert("RGB", null);
  } finally {
    rgba?.free();
    canvas?.free();
  }
}

function hasSignature(bytes, format) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return false;
  const text = new TextDecoder().decode(bytes.slice(0, 12));
  if (format === "png") return bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  if (format === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (format === "gif") return text.startsWith("GIF8");
  if (format === "bmp") return text.startsWith("BM");
  if (format === "webp") return text.startsWith("RIFF") && text.slice(8, 12) === "WEBP";
  if (format === "tiff") return text.startsWith("II*\u0000") || text.startsWith("MM\u0000*");
  if (format === "ico") return bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
  if (format === "avif") return text.slice(4, 12).includes("avif") || text.slice(4, 12).includes("avis");
  return false;
}

function sameBytes(left, right) {
  if (!(right instanceof Uint8Array) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function verifyEncodedOutput(api, bytes, format, width, height) {
  if (!hasSignature(bytes, format) || typeof api?.Image?.open !== "function") return false;
  let decoded;
  try {
    decoded = api.Image.open(bytes);
    if (decoded?.width !== width || decoded?.height !== height || width <= 0 || height <= 0) return false;
    decoded.load();
    // load() decodes the complete container; matching positive dimensions
    // make a separate pixel read unnecessary.
    return true;
  } catch {
    return false;
  } finally {
    decoded?.free?.();
  }
}

function probeOutputFormat(api, format) {
  if (typeof api?.Image !== "function") return false;
  let image;
  try {
    image = new api.Image(format === "jpeg" ? "RGB" : "RGBA", 2, 2, 255, 0, 0, 255);
    const encoder = findEncoder(image, format);
    if (!encoder) return false;
    const encoded = encoder();
    const bytes = encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
    return verifyEncodedOutput(api, bytes, format, 2, 2);
  } catch {
    return false;
  } finally {
    image?.free();
  }
}

// Consumes the image on success or failure. All render paths use this final
// encoder; unchanged PNG bytes are validated by fully loading their source,
// while rewritten bytes are reopened and fully decoded before they escape.
function encodeImage(api, image, format, background, diagnostics, sourceBytes = null) {
  const started = diagnostics ? performance.now() : 0;
  try {
    if (!findEncoder(image, format)) throw new Error("format unavailable");
    if (format === "jpeg") image = replaceImage(image, flattenForJpeg(api, image, background));
    const encoder = findEncoder(image, format);
    if (!encoder) throw new Error("format unavailable");
    const encoded = encoder();
    const bytes = encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
    const rendered = { width: image.width, height: image.height, mode: image.mode };
    const validationStarted = diagnostics ? performance.now() : 0;
    const unchangedSource = format === "png" && sameBytes(bytes, sourceBytes);
    if (unchangedSource) {
      try { image.load(); }
      catch { throw new Error("format unavailable"); }
    }
    image.free(); image = null;
    if (!unchangedSource && !verifyEncodedOutput(api, bytes, format, rendered.width, rendered.height)) throw new Error("format unavailable");
    if (diagnostics) {
      // Pillow evaluates lazy transforms inside save. This interval includes
      // materialization and encoding; it is not a decoder-only measurement.
      diagnostics.materializeEncodeMs = validationStarted - started;
      diagnostics.outputValidationMs = performance.now() - validationStarted;
    }
    return { bytes, ...rendered, outputBytes: bytes.byteLength, mime: formatMime(format), format };
  } finally { image?.free(); }
}

function openSceneImage(api, asset, bytes) {
  let image;
  try {
    image = api.Image.open(bytes);
    if (image.width * image.height !== asset.width * asset.height || image.width * image.height > MAX_IMAGE_PIXELS) throw sceneError("ASSET_CHANGED", "A story source no longer matches its declared dimensions.");
    if (asset.orientation === "exif-to-upright") image = applyExifOrientation(api, image, bytes);
    if (image.width !== asset.width || image.height !== asset.height) throw sceneError("ASSET_CHANGED", "A story source does not match its upright dimensions.");
    const result = image; image = null; return result;
  } catch (error) {
    if (error?.code) throw error;
    throw sceneError("DECODE_FAILED", "A story source could not be decoded.");
  } finally { image?.free(); }
}

/** Resize an immutable upright image/mask source, without applying its edits. */
export async function resampleSourceWithApi(api, { asset, bytes, width, height, memoryEstimate }) {
  if (!asset || !["image", "mask"].includes(asset.kind) || !["upright", "exif-to-upright"].includes(asset.orientation)
    || ![asset.width, asset.height, width, height].every(n => Number.isInteger(n) && n > 0)
    || asset.width * asset.height > MAX_IMAGE_PIXELS || width * height > MAX_IMAGE_PIXELS
    || !(bytes instanceof ArrayBuffer) || !/^[a-f0-9]{64}$/.test(asset.sha256) || bytes.byteLength !== asset.byteLength
    || asset.kind === "mask" && asset.orientation !== "upright") throw sceneError("INVALID_SOURCE_COPY", "Invalid photo or cutout copy request.");
  const settings = { resizeWidth: width, resizeHeight: height }, target = { width, height };
  const estimate = workingCopyWork({ width: asset.width, height: asset.height, encodedBytes: asset.byteLength, settings, target });
  if (memoryEstimate && ![memoryEstimate.heap, memoryEstimate.transient].every(n => Number.isFinite(n) && n >= 0))
    throw sceneError("TOO_LARGE", "Invalid source-copy memory reservation.");
  if (memoryEstimate ? estimate.heap > memoryEstimate.heap || estimate.transient > memoryEstimate.transient
    : estimate.heap + estimate.transient > deviceBudget(globalThis.navigator ?? {}).memory)
    throw sceneError("TOO_LARGE", "This source copy exceeds the processing memory budget. Choose a smaller photo.");
  if (await fontDigest(bytes) !== asset.sha256) throw sceneError("ASSET_CHANGED", "A photo or cutout changed before conversion.");
  const data = new Uint8Array(bytes);
  if (isAnimatedImage(data)) throw sceneError("UNSUPPORTED_OPERATION", "Choose a still photo for this copy.");
  if (asset.kind === "mask" && (![137,80,78,71,13,10,26,10].every((v,i) => data[i] === v) || data[24] !== 8 || data[25] !== 0))
    throw sceneError("INVALID_MASK", "A saved cutout must be an 8-bit grayscale PNG.");
  let image;
  try {
    image = openSceneImage(api, asset, data);
    if (asset.kind === "mask" && image.mode !== "L") throw sceneError("INVALID_MASK", "A saved cutout must be grayscale.");
    if (image.width !== width || image.height !== height) image = replaceImage(image, image.resize(width, height, "LANCZOS"));
    const completed = image; image = null; return encodeImage(api, completed, "png");
  } finally { image?.free(); }
}

/** @param {import('../compositor/contracts').SceneRequest} request
 * @returns {Promise<import('../compositor/contracts').SceneResult>} */
export async function renderSlideWithApi(api, request, capabilities = CAPABILITIES) {
  const format = request.preview ? "png" : request.format ?? "png";
  if (!capabilities.outputFormats.includes(format)) throw sceneError("UNSUPPORTED_OPERATION", "That story output format is unavailable.");
  const result = await renderScene(api, request, { openImage: (asset, bytes) => openSceneImage(api, asset, bytes) });
  return { ...encodeImage(api, result.image, format, request.jpegBackground),
    projectId: result.plan.projectId, revision: result.plan.revision, slideId: result.plan.slideId, variantId: result.plan.variantId,
    canonicalWidth: result.plan.width, canonicalHeight: result.plan.height, warnings: result.warnings, preview: result.plan.preview };
}

function bindingCapabilities(api) {
  const declared = api?.capabilities ?? api?.CAPABILITIES;
  return declared && typeof declared === "object" ? declared : {};
}

export function runtimeCapabilities(api) {
  const declared = normalizeCapabilities({
    ...CAPABILITIES,
    ...bindingCapabilities(api),
    outputFormats: QUALIFIED_OUTPUT_FORMATS,
  });
  const outputFormats = declared.outputFormats.filter((format) => probeOutputFormat(api, format));
  if (!outputFormats.length) throw new Error("No verified output format is available.");
  const lossyFormats = outputFormats.filter((format) => ["jpeg", "webp", "avif"].includes(format));
  return normalizeCapabilities({
    ...declared,
    outputFormats,
    avif: { input: declared.avif.input, output: outputFormats.includes("avif") },
    compression: { lossy: lossyFormats.length > 0, lossyFormats, quality: false },
  });
}

function centerCropToAspect(image, aspect) {
  if (!aspect || image.width / image.height === aspect) return image;
  let width = image.width;
  let height = width / aspect;
  if (height > image.height) {
    height = image.height;
    width = height * aspect;
  }
  const left = Math.floor((image.width - width) / 2);
  const top = Math.floor((image.height - height) / 2);
  return image.crop(left, top, left + Math.floor(width), top + Math.floor(height));
}

export async function renderWithApi(api, file, settings, capabilities = CAPABILITIES) {
  const started = file.diagnostics === true ? performance.now() : 0;
  const diagnostics = file.diagnostics === true ? {} : null;
  const look = settings.photoLook ? photoLookAppearance(settings.photoLook, ENGINE_IDENTITY) : null;
  const format = normalizeFormat(settings.format) ?? "png";
  if (!capabilities.outputFormats.includes(format)) throw new Error("format unavailable");

  const rawBytes = new Uint8Array(file.bytes);
  let image = api.Image.open(rawBytes);
  try {
    if (image.width * image.height > MAX_IMAGE_PIXELS) throw new Error("input too large");
    checkMemoryBudget(image, file, settings);
    image = applyExifOrientation(api, image, rawBytes);
    if (!settings.crop && settings.cropRelative) {
      settings = {
        ...settings,
        crop: {
          x: Number(settings.cropRelative.x) * image.width,
          y: Number(settings.cropRelative.y) * image.height,
          width: Number(settings.cropRelative.width) * image.width,
          height: Number(settings.cropRelative.height) * image.height,
        },
      };
    }
    if (settings.crop) {
      const left = Math.max(0, Math.floor(settings.crop.x));
      const top = Math.max(0, Math.floor(settings.crop.y));
      const right = Math.min(image.width, Math.ceil(settings.crop.x + settings.crop.width));
      const bottom = Math.min(image.height, Math.ceil(settings.crop.y + settings.crop.height));
      if (right - left > 0 && bottom - top > 0) {
        image = replaceImage(image, image.crop(left, top, right, bottom));
      }
    }

    const transpose = {
      90: "ROTATE_90",
      180: "ROTATE_180",
      270: "ROTATE_270",
    }[Number(settings.rotation) % 360];
    if (transpose) image = replaceImage(image, image.transpose(transpose));
    if (settings.flipX) image = replaceImage(image, image.transpose("FLIP_LEFT_RIGHT"));
    if (settings.flipY) image = replaceImage(image, image.transpose("FLIP_TOP_BOTTOM"));

    if (!settings.crop && settings.resizeMode === "crop" && settings.resizeWidth > 0 && settings.resizeHeight > 0) {
      image = replaceImage(image, centerCropToAspect(image, settings.resizeWidth / settings.resizeHeight));
    }

    const width = image.width;
    const height = image.height;
    const cropResize = settings.resizeMode === "crop" && settings.resizeWidth > 0 && settings.resizeHeight > 0;
    const scale = Math.min(
      1,
      (settings.maxWidth ?? settings.resizeWidth) > 0 ? (settings.maxWidth ?? settings.resizeWidth) / width : 1,
      (settings.maxHeight ?? settings.resizeHeight) > 0 ? (settings.maxHeight ?? settings.resizeHeight) / height : 1,
    );
    const outputWidth = cropResize ? Math.max(1, Math.round(settings.resizeWidth)) : Math.max(1, Math.round(width * scale));
    const outputHeight = cropResize ? Math.max(1, Math.round(settings.resizeHeight)) : Math.max(1, Math.round(height * scale));
    if (outputWidth * outputHeight > MAX_IMAGE_PIXELS) throw new Error("output too large");
    if (cropResize) {
      image = replaceImage(image, image.resize(outputWidth, outputHeight, "LANCZOS"));
    }
    if (!cropResize && scale < 1) {
      image = replaceImage(
        image,
        image.resize(outputWidth, outputHeight, "LANCZOS"),
      );
    }
    if (look) {
      if (look.brightness != null && look.brightness !== 1) image = replaceImage(image, image.enhanceBrightness(look.brightness));
      if (look.contrast != null && look.contrast !== 1) image = replaceImage(image, image.enhanceContrast(look.contrast));
      const saturation = (look.saturation ?? 1) * (1 - (look.grayscaleMix ?? 0));
      if (saturation !== 1) image = replaceImage(image, image.enhanceColor(saturation));
    }
    if (settings.grayscale) image = replaceImage(image, image.convert("L", null));
    if (settings.brightness !== 1) image = replaceImage(image, image.enhanceBrightness(settings.brightness));
    if (settings.contrast !== 1) image = replaceImage(image, image.enhanceContrast(settings.contrast));

    if (settings.textLayers?.length) image = replaceImage(image, await compositeText(api, image, settings.textLayers, file.fontRecords));

    const unchangedPngCandidate = format === "png"
      && rawBytes.length <= 64 * 1024
      && rawBytes.length >= 8
      && rawBytes[0] === 137 && rawBytes[1] === 80 && rawBytes[2] === 78 && rawBytes[3] === 71
      && rawBytes[4] === 13 && rawBytes[5] === 10 && rawBytes[6] === 26 && rawBytes[7] === 10
      && !settings.crop && !settings.cropRelative && !transpose && !settings.flipX && !settings.flipY
      && !settings.photoLook && !settings.grayscale && settings.brightness === 1 && settings.contrast === 1
      && !settings.textLayers?.length && settings.resizeMode !== "crop" && scale === 1
      && outputWidth === width && outputHeight === height;
    const completed = image; image = null;
    if (diagnostics) diagnostics.pipelineSetupMs = performance.now() - started;
    return { ...encodeImage(api, completed, format, settings.jpegBackground, diagnostics, unchangedPngCandidate ? rawBytes : null),
      ...(diagnostics ? { diagnostics: { schema: "tinystar/render-timings@1", ...diagnostics } } : {}), inputBytes: file.bytes.byteLength,
      name: outputFileName(file.name, settings.presetName ?? settings.presetId, format) };
  } finally {
    image?.free();
  }
}

export function previewWithApi(api, file) {
  const rawBytes = new Uint8Array(file.bytes);
  let image = api.Image.open(rawBytes);
  try {
    if (image.width * image.height > MAX_IMAGE_PIXELS) throw new Error("input too large");
    checkMemoryBudget(image, file, {}, true);
    image = applyExifOrientation(api, image, rawBytes);
    const completed = image; image = null;
    const { bytes, width, height, mime, format } = encodeImage(api, completed, "png");
    return { bytes, width, height, mime, format };
  } finally {
    image?.free();
  }
}

export async function createPillowEngine() {
  const api = await loadApi();
  const capabilities = { ...runtimeCapabilities(api), scene: {
    version: SCENE_VERSION, available: typeof OffscreenCanvas === "function",
    nodeKinds: ["image", "shape", "text"], masks: "upright-8-bit-grayscale", depthTitles: "photo-relative-v1", connectedCutouts: "adjacent-pair-v1", cutoutEffects: "disk-outline-shadow-v1", previewLongEdge: 1280,
  } };
  let disposed = false;
  const guard = () => { if (disposed) throw sceneError("DISPOSED", "This rendering handle has been closed."); };
  return {
    capabilities,
    ready: async () => { guard(); return capabilities; },
    dispose: () => { disposed = true; },
    heapBytes: () => wasmExports?.memory?.buffer?.byteLength ?? 0,
    inspect: (file) => {
      guard();
      const image = api.Image.open(new Uint8Array(file.bytes));
      try {
        if (image.width * image.height > MAX_IMAGE_PIXELS) throw new Error("input too large");
        return { width: image.width, height: image.height, inputBytes: file.bytes.byteLength };
      } finally { image.free(); }
    },
    render: (file, settings) => { guard(); return renderWithApi(api, file, settings, capabilities); },
    renderImagePreview: async (file, settings, longEdge = 512) => {
      guard();
      if (!Number.isInteger(longEdge) || longEdge < 64 || longEdge > 1024) throw new Error("Invalid image preview size.");
      const started = file.diagnostics === true ? performance.now() : 0;
      const result = await renderWithApi(api, file, settings, capabilities);
      const fullOutput = file.diagnostics === true ? { width: result.width, height: result.height, format: result.format, bytes: result.outputBytes, renderMs: performance.now() - started } : null;
      let image = api.Image.open(result.bytes);
      try {
        const scale = Math.min(1, longEdge / Math.max(image.width, image.height));
        if (scale < 1) image = replaceImage(image, image.resize(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)), "LANCZOS"));
        const completed = image; image = null;
        return { ...encodeImage(api, completed, "png"), inputBytes: file.bytes.byteLength, name: result.name, ...(fullOutput ? { fullOutput } : {}) };
      } finally { image?.free(); }
    },
    preview: (file) => { guard(); return previewWithApi(api, file); },
    renderSlide: (request) => { guard(); return renderSlideWithApi(api, { ...request, preview: false }, capabilities); },
    renderPreview: (request) => { guard(); return renderSlideWithApi(api, { ...request, preview: true }, capabilities); },
    resampleSource: (request) => { guard(); return resampleSourceWithApi(api, request); },
    editMask: async (request) => { guard(); const { editMask } = await import("../compositor/mask.js"); return editMask(api, request, { openImage: (asset, bytes) => openSceneImage(api, asset, bytes) }); },
  };
}

export function describeError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
