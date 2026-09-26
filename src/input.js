// Browser-side input safety checks shared by the single-image and image-set
// workflows. These checks are intentionally format-light: the engine remains
// responsible for decoding, while this module prevents known unsafe or
// lossy-to-the-user cases from being silently accepted.

export const MAX_IMAGE_PIXELS = 80_000_000;
export const MAX_BATCH_PIXELS = 160_000_000;
export const MAX_BATCH_BYTES = 160 * 1024 * 1024;

function safeByteCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

export function batchBytesExceedLimit(existingBytes, incomingBytes, maxBytes = MAX_BATCH_BYTES) {
  const limit = Number.isFinite(Number(maxBytes)) ? Math.max(0, Number(maxBytes)) : MAX_BATCH_BYTES;
  return safeByteCount(existingBytes) + safeByteCount(incomingBytes) > limit;
}

function bytesView(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return new Uint8Array(bytes ?? []);
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function isGif(bytes) {
  return bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a");
}

function isWebp(bytes) {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

function hasAnimatedGifFrames(bytes) {
  if (bytes.length < 13) return false;
  const globalTable = bytes[10] & 0x80;
  let offset = 13 + (globalTable ? 3 * (2 ** ((bytes[10] & 0x07) + 1)) : 0);
  let frames = 0;

  const skipSubBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++];
      if (size === 0) return true;
      offset += size;
      if (offset > bytes.length) return false;
    }
    return false;
  };

  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) return false;
    if (marker === 0x2c) {
      frames += 1;
      if (frames > 1) return true;
      if (offset + 9 > bytes.length) return false;
      const packed = bytes[offset + 8];
      offset += 9;
      if (packed & 0x80) offset += 3 * (2 ** ((packed & 0x07) + 1));
      if (offset >= bytes.length) return false;
      offset += 1; // LZW minimum code size.
      if (!skipSubBlocks()) return false;
      continue;
    }
    if (marker === 0x21) {
      if (offset >= bytes.length) return false;
      const label = bytes[offset++];
      if (label === 0x01 || label === 0xf9 || label === 0xff) {
        if (offset >= bytes.length) return false;
        const fixedSize = bytes[offset++];
        offset += fixedSize;
        if (offset > bytes.length) return false;
      }
      if (!skipSubBlocks()) return false;
      continue;
    }
    return false;
  }
  return false;
}

function hasAnimatedWebpFrames(bytes) {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = ascii(bytes, offset, 4);
    const size = (bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24)) >>> 0;
    if (chunk === "ANIM" || chunk === "ANMF") return true;
    if (chunk === "VP8X" && offset + 9 <= bytes.length && (bytes[offset + 8] & 0x02)) return true;
    offset += 8 + size + (size % 2);
  }
  return false;
}

export function isAnimatedImage(bytes) {
  const view = bytesView(bytes);
  return (isGif(view) && hasAnimatedGifFrames(view)) || (isWebp(view) && hasAnimatedWebpFrames(view));
}

export function imagePixelCount(width, height) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (!Number.isFinite(safeWidth) || !Number.isFinite(safeHeight) || safeWidth <= 0 || safeHeight <= 0) return 0;
  return safeWidth * safeHeight;
}

export function inputProblem(bytes, { width = 0, height = 0, maxPixels = MAX_IMAGE_PIXELS } = {}) {
  if (isAnimatedImage(bytes)) {
    return {
      code: "animated",
      message: "Animated images are not supported yet. Choose a still image.",
    };
  }
  const pixels = imagePixelCount(width, height);
  if (pixels > maxPixels) {
    return {
      code: "too-large",
      message: "This image is too large to process safely. Try a smaller image.",
      pixels,
      maxPixels,
    };
  }
  return null;
}

function fallbackHash(bytes) {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16)}-${bytes.length}`;
}

export async function fingerprintBytes(bytes) {
  const view = bytesView(bytes);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", view);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return fallbackHash(view);
}

export function duplicateKey(file, fingerprint) {
  return `${String(file?.name ?? "").toLowerCase()}|${Number(file?.size) || 0}|${fingerprint}`;
}
