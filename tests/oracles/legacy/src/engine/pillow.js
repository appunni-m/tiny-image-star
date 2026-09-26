import { formatMime, normalizeCapabilities, normalizeFormat } from "../formats.js";
import { MAX_IMAGE_PIXELS } from "../input.js";
import { outputFileName } from "../names.js";
import { DEFAULT_QUALITY } from "../quality.js";

const inputFormats = ["jpeg", "png", "gif", "bmp", "webp", "tiff", "ico"];
const outputFormats = ["png"];
const KNOWN_OUTPUT_FORMATS = ["png", "jpeg", "gif", "bmp", "webp", "tiff", "ico", "avif"];

export const CAPABILITIES = Object.freeze({
  inputFormats,
  outputFormats,
  avif: { input: false, output: false },
});

let apiPromise;

async function fetchBrotliWasm() {
  if (typeof DecompressionStream !== "function") return null;
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
      await api.default((await fetchBrotliWasm()) ?? undefined);
      return api;
    });
  }
  return apiPromise;
}

function replaceImage(current, next) {
  if (current !== next) current.free();
  return next;
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

const ENCODER_METHODS = Object.freeze({
  jpeg: ["saveJpeg", "saveJPEG", "encodeJpeg", "encodeJPEG", "toJpeg", "toJPEG", "save_jpeg", "encode_jpeg"],
  gif: ["saveGif", "encodeGif", "toGif", "save_gif", "encode_gif"],
  bmp: ["saveBmp", "encodeBmp", "toBmp", "save_bmp", "encode_bmp"],
  webp: ["saveWebp", "encodeWebp", "toWebp", "save_webp", "encode_webp"],
  tiff: ["saveTiff", "encodeTiff", "toTiff", "save_tiff", "encode_tiff"],
  ico: ["saveIco", "encodeIco", "toIco", "save_ico", "encode_ico"],
  avif: ["saveAvif", "encodeAvif", "toAvif", "save_avif", "encode_avif"],
});

function findEncoder(image, format, options = {}) {
  if (format === "png" && typeof image.save === "function") return () => image.save();
  const quality = Number.isFinite(options.quality) ? Math.max(1, Math.min(100, Math.round(options.quality))) : null;
  for (const method of ENCODER_METHODS[format] ?? []) {
    if (typeof image[method] === "function") {
      return () => (quality != null && image[method].length > 0 ? image[method](quality) : image[method]());
    }
  }
  // A future binding may expose a single parameterized encoder. Do not call
  // the current zero-argument save() with a format: that method always emits
  // PNG and would make a JPEG/WebP label lie about the bytes.
  if (typeof image.encode === "function" && image.encode.length > 0) {
    return () => image.encode(format, ...(quality != null && image.encode.length > 1 ? [quality] : []));
  }
  if (typeof image.save === "function" && image.save.length > 0) {
    return () => image.save(format, ...(quality != null && image.save.length > 1 ? [quality] : []));
  }
  return null;
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

function verifyEncodedOutput(api, bytes, format, width, height) {
  if (!hasSignature(bytes, format) || typeof api?.Image?.open !== "function") return false;
  let decoded;
  try {
    decoded = api.Image.open(bytes);
    return decoded?.width === width && decoded?.height === height;
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
    image = new api.Image("RGBA", 2, 2, 255, 0, 0, 255);
    const encoder = findEncoder(image, format, { quality: DEFAULT_QUALITY });
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

function encoderSupportsQuality(api, format) {
  if (typeof api?.Image !== "function") return false;
  let image;
  try {
    image = new api.Image("RGBA", 2, 2, 255, 0, 0, 255);
    if ((ENCODER_METHODS[format] ?? []).some((method) => typeof image[method] === "function" && image[method].length > 0)) return true;
    if (typeof image.encode === "function" && image.encode.length > 1) return true;
    return typeof image.save === "function" && image.save.length > 1;
  } catch {
    return false;
  } finally {
    image?.free?.();
  }
}

function bindingCapabilities(api) {
  const declared = api?.capabilities ?? api?.CAPABILITIES;
  return declared && typeof declared === "object" ? declared : {};
}

export function runtimeCapabilities(api) {
  const declared = normalizeCapabilities({
    ...CAPABILITIES,
    ...bindingCapabilities(api),
    outputFormats: KNOWN_OUTPUT_FORMATS,
  });
  const outputFormats = declared.outputFormats.filter((format) => probeOutputFormat(api, format));
  if (!outputFormats.length) throw new Error("No verified output format is available.");
  const lossyFormats = outputFormats.filter((format) => ["jpeg", "webp", "avif"].includes(format));
  const quality = Boolean(declared.compression?.quality)
    || lossyFormats.some((format) => encoderSupportsQuality(api, format));
  return normalizeCapabilities({
    ...declared,
    outputFormats,
    avif: { input: declared.avif.input, output: outputFormats.includes("avif") },
    compression: { lossy: lossyFormats.length > 0, lossyFormats, quality },
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
  const format = normalizeFormat(settings.format) ?? "png";
  if (!capabilities.outputFormats.includes(format)) throw new Error("format unavailable");

  const rawBytes = new Uint8Array(file.bytes);
  let image = api.Image.open(rawBytes);
  try {
    image = applyExifOrientation(api, image, rawBytes);
    if (image.width * image.height > MAX_IMAGE_PIXELS) throw new Error("input too large");
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
    if (settings.grayscale) image = replaceImage(image, image.convert("L", null));
    if (settings.brightness !== 1) image = replaceImage(image, image.enhanceBrightness(settings.brightness));
    if (settings.contrast !== 1) image = replaceImage(image, image.enhanceContrast(settings.contrast));

    const encoder = findEncoder(image, format, { quality: settings.lossy ? settings.quality : null });
    if (!encoder) throw new Error("format unavailable");
    const encoded = encoder();
    const bytes = encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
    if (!verifyEncodedOutput(api, bytes, format, image.width, image.height)) throw new Error("format unavailable");
    return {
      bytes,
      width: image.width,
      height: image.height,
      mode: image.mode,
      inputBytes: file.bytes.byteLength,
      outputBytes: bytes.byteLength,
      name: outputFileName(file.name, settings.presetName ?? settings.presetId, format),
      mime: formatMime(format),
      format,
    };
  } finally {
    image.free();
  }
}

export function previewWithApi(api, file) {
  const rawBytes = new Uint8Array(file.bytes);
  let image = api.Image.open(rawBytes);
  try {
    image = applyExifOrientation(api, image, rawBytes);
    const encoder = findEncoder(image, "png");
    if (!encoder) throw new Error("format unavailable");
    const encoded = encoder();
    const bytes = encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
    if (!verifyEncodedOutput(api, bytes, "png", image.width, image.height)) throw new Error("format unavailable");
    return {
      bytes,
      width: image.width,
      height: image.height,
      mime: "image/png",
      format: "png",
    };
  } finally {
    image.free();
  }
}

export async function createPillowEngine() {
  const api = await loadApi();
  const capabilities = runtimeCapabilities(api);
  return {
    capabilities,
    render: (file, settings) => renderWithApi(api, file, settings, capabilities),
    preview: (file) => previewWithApi(api, file),
  };
}

export function describeError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
