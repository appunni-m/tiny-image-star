import { imageCropPixels } from './image-transforms.js';

const MIB = 1024 * 1024;

export class ImageMemoryLimitError extends Error {
  constructor(message, budgetKind = 'retained-image-memory') {
    super(message);
    this.name = 'ImageMemoryLimitError';
    this.budgetKind = budgetKind;
  }
}

/** Release any pending decode/asset reservations and clear their owned tokens. */
export function releaseImageMemoryReservations(memoryBudget, reservations) {
  if (!memoryBudget || typeof memoryBudget.releaseReservation !== 'function'
    || !reservations || typeof reservations !== 'object' || Array.isArray(reservations)) {
    throw new TypeError('Image memory cleanup needs a budget and reservation record.');
  }
  let released = 0;
  for (const key of ['decodeReservation', 'assetReservation']) {
    const token = reservations[key];
    if (!token) continue;
    if (memoryBudget.releaseReservation(token)) released += 1;
    reservations[key] = null;
  }
  return released;
}

/**
 * A cap for decoded image surfaces and the local byte buffers kept by the
 * editor. This is a retained-resource budget, separate from Pillow-RS worker
 * working-set admission.
 */
export function defaultRetainedImageMemoryBudget({ deviceMemory = globalThis.navigator?.deviceMemory } = {}) {
  const memory = Number(deviceMemory);
  if (Number.isFinite(memory) && memory > 0) {
    if (memory <= 2) return 96 * MIB;
    if (memory <= 4) return 160 * MIB;
    if (memory <= 8) return 256 * MIB;
    return 384 * MIB;
  }
  // Safari and some privacy modes do not expose deviceMemory.
  return 160 * MIB;
}

function checkedBytes(bytes, label = 'Image memory') {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError(`${label} must be a nonnegative safe integer.`);
  return bytes;
}

export function estimateBitmapBytes(width, height, bytesPerPixel = 4) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1
    || !Number.isSafeInteger(bytesPerPixel) || bytesPerPixel < 1) {
    throw new RangeError('Bitmap dimensions and bytes per pixel must be positive safe integers.');
  }
  const bytes = width * height * bytesPerPixel;
  return checkedBytes(bytes, 'Bitmap memory estimate');
}

/** Source bytes can coexist with a Blob URL and a bounded fallback bitmap. */
export function estimateAssetMemoryBytes({ sourceByteLength, bitmapWidth, bitmapHeight }) {
  const sourceBytes = checkedBytes(sourceByteLength, 'Source byte length');
  return checkedBytes(sourceBytes * 2 + estimateBitmapBytes(bitmapWidth, bitmapHeight), 'Asset memory estimate');
}

/** Account for the retained decoded preview, its typed bytes, and a Blob URL. */
export function estimatePreviewMemoryBytes({ width, height, encodedByteLength }) {
  const encodedBytes = checkedBytes(encodedByteLength, 'Preview byte length');
  return checkedBytes(estimateBitmapBytes(width, height) + encodedBytes * 2, 'Preview memory estimate');
}

export function transformedImageDimensions(width, height, transforms = {}) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError('Image dimensions must be positive safe integers.');
  }
  const crop = transforms?.crop;
  let outputWidth = width;
  let outputHeight = height;
  if (crop && [crop.left, crop.top, crop.right, crop.bottom].every(Number.isFinite)) {
    const pixels = imageCropPixels(crop, width, height);
    outputWidth = Math.max(1, pixels.right - pixels.left);
    outputHeight = Math.max(1, pixels.bottom - pixels.top);
  }
  if (Math.abs(Number(transforms?.rotation) || 0) % 180 === 90) [outputWidth, outputHeight] = [outputHeight, outputWidth];
  if (!Number.isSafeInteger(outputWidth * outputHeight)) throw new RangeError('The transformed image is too large to estimate safely.');
  return { width: outputWidth, height: outputHeight };
}

export function assertImagePayloadMatchesPreflight({ expectedDimensions, expectedByteLength, actualDimensions, actualByteLength }) {
  const validDimensions = value => value
    && Number.isSafeInteger(value.width) && value.width > 0
    && Number.isSafeInteger(value.height) && value.height > 0;
  if (!validDimensions(expectedDimensions) || !validDimensions(actualDimensions)
    || !Number.isSafeInteger(expectedByteLength) || expectedByteLength < 0
    || !Number.isSafeInteger(actualByteLength) || actualByteLength < 0) {
    throw new TypeError('Image preflight and payload measurements are invalid.');
  }
  if (actualByteLength !== expectedByteLength
    || actualDimensions.width !== expectedDimensions.width
    || actualDimensions.height !== expectedDimensions.height) {
    throw new Error('This image changed or was incomplete while it was being imported. Choose it again.');
  }
  return true;
}

/**
 * Admit and account resources by stable key. Reservations count immediately,
 * so overlapping asynchronous imports/renders cannot both spend the same
 * available bytes. Callers own disposal and must release after closing a
 * bitmap/revoking its URL.
 */
export class RetainedImageMemoryBudget {
  constructor({ limitBytes = defaultRetainedImageMemoryBudget() } = {}) {
    if (!Number.isSafeInteger(limitBytes) || limitBytes < 1) throw new RangeError('The retained image memory limit must be a positive safe integer.');
    this.limitBytes = limitBytes;
    this.entries = new Map();
    this.reservations = new Map();
    this.usedBytes = 0;
    this.nextReservationId = 0;
  }

  canFit(bytes, { excluding = [] } = {}) {
    checkedBytes(bytes);
    const excluded = new Set(excluding);
    let reclaimable = 0;
    for (const key of excluded) reclaimable += this.entries.get(key)?.bytes || 0;
    return this.usedBytes - reclaimable + bytes <= this.limitBytes;
  }

  retain(key, bytes, { kind = 'other' } = {}) {
    if (typeof key !== 'string' || !key) throw new TypeError('Image memory entries need a nonempty string key.');
    checkedBytes(bytes);
    const previous = this.entries.get(key);
    const nextUsedBytes = this.usedBytes - (previous?.bytes || 0) + bytes;
    if (nextUsedBytes > this.limitBytes) return false;
    this.entries.set(key, { bytes, kind });
    this.usedBytes = nextUsedBytes;
    return true;
  }

  reserve(bytes, { kind = 'pending' } = {}) {
    checkedBytes(bytes);
    if (this.usedBytes + bytes > this.limitBytes) return null;
    const id = ++this.nextReservationId;
    const token = Object.freeze({ id, bytes });
    this.reservations.set(id, { token, kind });
    this.usedBytes += bytes;
    return token;
  }

  commit(token, key, { bytes = token?.bytes, kind = 'other' } = {}) {
    const reservation = this.reservations.get(token?.id);
    if (!reservation || reservation.token !== token) throw new Error('This image memory reservation is no longer active.');
    if (typeof key !== 'string' || !key) throw new TypeError('Image memory entries need a nonempty string key.');
    checkedBytes(bytes);
    const previous = this.entries.get(key);
    const nextUsedBytes = this.usedBytes - token.bytes - (previous?.bytes || 0) + bytes;
    if (nextUsedBytes > this.limitBytes) throw new RangeError('The retained image memory limit would be exceeded.');
    this.reservations.delete(token.id);
    this.entries.set(key, { bytes, kind });
    this.usedBytes = nextUsedBytes;
    return true;
  }

  releaseReservation(token) {
    const reservation = this.reservations.get(token?.id);
    if (!reservation || reservation.token !== token) return false;
    this.reservations.delete(token.id);
    this.usedBytes -= token.bytes;
    return true;
  }

  release(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.usedBytes -= entry.bytes;
    return true;
  }

  clear() {
    this.entries.clear();
    this.reservations.clear();
    this.usedBytes = 0;
  }

  /** Release committed resources while keeping in-flight admission reserved. */
  releaseEntries() {
    for (const entry of this.entries.values()) this.usedBytes -= entry.bytes;
    this.entries.clear();
  }

  metrics() {
    const byKind = {};
    for (const entry of this.entries.values()) byKind[entry.kind] = (byKind[entry.kind] || 0) + entry.bytes;
    for (const entry of this.reservations.values()) byKind[entry.kind] = (byKind[entry.kind] || 0) + entry.token.bytes;
    return { usedBytes: this.usedBytes, limitBytes: this.limitBytes, availableBytes: this.limitBytes - this.usedBytes, entries: this.entries.size, reservations: this.reservations.size, byKind };
  }
}
