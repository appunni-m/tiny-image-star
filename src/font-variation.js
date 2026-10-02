/** Maximum number of variable-font axes retained for one text style. */
export const MAX_FONT_VARIATION_AXES = 64;
/** Keep arbitrary imported axis coordinates finite and bounded. */
export const MAX_FONT_VARIATION_VALUE = 1_000_000;

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function tagAt(bytes, offset) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function fvarRecord(bytes) {
  if (!bytes || bytes.byteLength < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = tagAt(bytes, 0);
  if (signature === 'wOFF') {
    if (bytes.byteLength < 44) return null;
    const tableCount = view.getUint16(12, false);
    const directoryEnd = 44 + tableCount * 20;
    if (directoryEnd > bytes.byteLength) return null;
    for (let index = 0; index < tableCount; index += 1) {
      const entry = 44 + index * 20;
      if (tagAt(bytes, entry) !== 'fvar') continue;
      const offset = view.getUint32(entry + 4, false);
      const compressedLength = view.getUint32(entry + 8, false);
      const length = view.getUint32(entry + 12, false);
      if (offset + compressedLength > bytes.byteLength || length < 16) return null;
      return { offset, compressedLength, length };
    }
    return null;
  }
  if (!['\u0000\u0001\u0000\u0000', 'OTTO'].includes(signature)) return null;
  const tableCount = view.getUint16(4, false);
  const directoryEnd = 12 + tableCount * 16;
  if (directoryEnd > bytes.byteLength) return null;
  for (let index = 0; index < tableCount; index += 1) {
    const entry = 12 + index * 16;
    if (tagAt(bytes, entry) !== 'fvar') continue;
    const offset = view.getUint32(entry + 8, false);
    const length = view.getUint32(entry + 12, false);
    if (offset + length > bytes.byteLength || length < 16) return null;
    return { offset, compressedLength: length, length };
  }
  return null;
}

function parseFvar(bytes) {
  if (!bytes || bytes.byteLength < 16) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const axesOffset = view.getUint16(4, false);
  const axisCount = view.getUint16(8, false);
  const axisSize = view.getUint16(10, false);
  if (axisCount < 1 || axisCount > MAX_FONT_VARIATION_AXES || axisSize < 20
    || axesOffset < 16 || axesOffset + axisCount * axisSize > bytes.byteLength) return [];
  const axes = [];
  const seen = new Set();
  for (let index = 0; index < axisCount; index += 1) {
    const offset = axesOffset + index * axisSize;
    const tag = tagAt(bytes, offset);
    const min = view.getInt32(offset + 4, false) / 65_536;
    const defaultValue = view.getInt32(offset + 8, false) / 65_536;
    const max = view.getInt32(offset + 12, false) / 65_536;
    if (!/^[\x20-\x7e]{4}$/u.test(tag) || seen.has(tag)
      || ![min, defaultValue, max].every(Number.isFinite)
      || min > defaultValue || defaultValue > max
      || Math.abs(min) > MAX_FONT_VARIATION_VALUE || Math.abs(max) > MAX_FONT_VARIATION_VALUE) return [];
    seen.add(tag);
    axes.push({ tag, min, defaultValue, max });
  }
  return axes;
}

/**
 * Read variable-axis ranges from sfnt, WOFF, and WOFF2 font data. A WOFF2
 * decoder can be supplied by the caller so decompression stays in a worker.
 */
export async function inspectFontVariationAxes(sourceBytes, {
  DecompressionStreamConstructor = globalThis.DecompressionStream,
  BlobConstructor = globalThis.Blob,
  ResponseConstructor = globalThis.Response,
  decompressWoff2
} = {}) {
  let bytes = bytesOf(sourceBytes);
  if (tagAt(bytes, 0) === 'wOF2') {
    if (typeof decompressWoff2 !== 'function') return [];
    try { bytes = bytesOf(await decompressWoff2(bytes)); }
    catch { return []; }
    if (!bytes) return [];
  }
  const record = fvarRecord(bytes);
  if (!record) return [];
  let table = bytes.subarray(record.offset, record.offset + record.compressedLength);
  if (record.compressedLength !== record.length) {
    if (typeof DecompressionStreamConstructor !== 'function'
      || typeof BlobConstructor !== 'function' || typeof ResponseConstructor !== 'function') return [];
    try {
      const stream = new BlobConstructor([table]).stream().pipeThrough(new DecompressionStreamConstructor('deflate'));
      const inflated = new Uint8Array(await new ResponseConstructor(stream).arrayBuffer());
      if (inflated.byteLength !== record.length) return [];
      table = inflated;
    } catch {
      return [];
    }
  }
  return parseFvar(table);
}

/** Identify the supported-inspection boundary separately from a static font. */
export function fontVariationInspectionStatus(sourceBytes) {
  const bytes = bytesOf(sourceBytes);
  if (!bytes || bytes.byteLength < 4) return 'invalid';
  return 'inspected';
}

/** Map the standard weight axis to the ordinary Canvas/CSS weight property. */
export function canvasFontWeight(fontWeight, fontAxes) {
  const axisValue = fontAxes?.wght;
  return Number.isFinite(axisValue) && axisValue >= 1 && axisValue <= 1000 ? axisValue : (Number(fontWeight) || 400);
}

/** Update one inspected axis without discarding other axis coordinates. */
export function setFontVariationValue(values, tag, value) {
  if (typeof tag !== 'string' || !/^[\x20-\x7e]{4}$/u.test(tag)
    || typeof value !== 'number' || !Number.isFinite(value)
    || Math.abs(value) > MAX_FONT_VARIATION_VALUE) {
    throw new TypeError('A variable font axis needs a four-character tag and a bounded numeric value.');
  }
  const next = { ...(isValidFontVariationValues(values) ? values : {}), [tag]: value };
  if (!isValidFontVariationValues(next)) throw new TypeError('A text style cannot contain more than 64 variable font axes.');
  return next;
}

/** Validate axis-coordinate maps serialized on a text layer, run, or style. */
export function isValidFontVariationValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
  const keys = Object.keys(values);
  if (keys.length < 1 || keys.length > MAX_FONT_VARIATION_AXES) return false;
  return keys.every(tag => /^[\x20-\x7e]{4}$/u.test(tag)
    && typeof values[tag] === 'number' && Number.isFinite(values[tag])
    && Math.abs(values[tag]) <= MAX_FONT_VARIATION_VALUE);
}

/** Return deterministic CSS text for an OpenType variation coordinate map. */
export function fontVariationSettings(values) {
  if (!isValidFontVariationValues(values)) return '';
  return Object.keys(values).sort().map(tag => `${JSON.stringify(tag)} ${Number(values[tag])}`).join(', ');
}

/** Parse the deliberately small, standards-compatible variation CSS subset. */
export function parseFontVariationSettings(value) {
  const input = String(value ?? '').trim();
  if (input.toLowerCase() === 'normal') return {};
  const values = {};
  let offset = 0;
  const token = /"((?:\\["\\]|[^"\\]){4})"\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/iy;
  while (offset < input.length) {
    while (/\s/u.test(input[offset] || '')) offset += 1;
    token.lastIndex = offset;
    const match = token.exec(input);
    if (!match) return null;
    const tag = match[1].replace(/\\(["\\])/gu, '$1');
    const axisValue = Number(match[2]);
    if (!/^[\x20-\x7e]{4}$/u.test(tag) || !Number.isFinite(axisValue)
      || Math.abs(axisValue) > MAX_FONT_VARIATION_VALUE || Object.hasOwn(values, tag)) return null;
    values[tag] = axisValue;
    offset = token.lastIndex;
    while (/\s/u.test(input[offset] || '')) offset += 1;
    if (offset >= input.length) break;
    if (input[offset] !== ',') return null;
    offset += 1;
  }
  return Object.keys(values).length > 0 && Object.keys(values).length <= MAX_FONT_VARIATION_AXES ? values : null;
}
