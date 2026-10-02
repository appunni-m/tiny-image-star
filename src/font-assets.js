import { inspectFontVariationAxes } from './font-variation.js';

export const MAX_LOCAL_FONT_BYTES = 20 * 1024 * 1024;
export const LOCAL_FONT_FAMILY_LIMIT = 120;

const fontFormats = [
  { signature: [0x77, 0x4f, 0x46, 0x32], extension: '.woff2', type: 'font/woff2' },
  { signature: [0x77, 0x4f, 0x46, 0x46], extension: '.woff', type: 'font/woff' },
  { signature: [0x4f, 0x54, 0x54, 0x4f], extension: '.otf', type: 'font/otf' },
  { signature: [0x00, 0x01, 0x00, 0x00], extension: '.ttf', type: 'font/ttf' }
];

function byteView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export function inspectLocalFontFormat(name, sourceBytes) {
  const bytes = byteView(sourceBytes);
  if (!bytes || bytes.byteLength < 12) throw new TypeError('Font files must contain a valid OpenType or Web Open Font header.');
  if (bytes.byteLength > MAX_LOCAL_FONT_BYTES) throw new TypeError(`Font files must be ${MAX_LOCAL_FONT_BYTES / 1024 / 1024} MB or smaller.`);
  const extension = String(name || '').match(/\.[^.]+$/u)?.[0]?.toLowerCase() || '';
  const format = fontFormats.find(candidate => candidate.signature.every((value, index) => bytes[index] === value));
  if (!format) throw new TypeError('Choose a TrueType, OpenType, WOFF, or WOFF2 font file.');
  if (extension && extension !== format.extension) {
    throw new TypeError(`The font file extension does not match its ${format.extension.slice(1).toUpperCase()} data.`);
  }
  return { ...format };
}

export function defaultLocalFontFamily(name) {
  const stem = String(name || '').replace(/\.(?:woff2?|ttf|otf)$/iu, '').trim();
  const family = stem.replace(/[._-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return family.slice(0, LOCAL_FONT_FAMILY_LIMIT) || 'Imported Font';
}

export function validateLocalFontAsset(asset, { copyBytes = true } = {}) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw new TypeError('A local font needs valid metadata and bytes.');
  const { id, name, family, weight, style } = asset;
  if (typeof id !== 'string' || !id.trim() || id.length > 180 || /[\x00-\x1f]/u.test(id)) throw new TypeError('A local font needs a valid ID.');
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || /[\x00-\x1f]/u.test(name)) throw new TypeError('A local font needs a valid filename.');
  if (typeof family !== 'string' || !family.trim() || family.trim().length > LOCAL_FONT_FAMILY_LIMIT || /[\x00-\x1f]/u.test(family)) {
    throw new TypeError(`A font family name must contain 1–${LOCAL_FONT_FAMILY_LIMIT} characters.`);
  }
  if (!Number.isInteger(weight) || weight < 1 || weight > 1000) throw new TypeError('Font weight must be between 1 and 1000.');
  if (!['normal', 'italic'].includes(style)) throw new TypeError('Font style must be normal or italic.');
  const bytes = byteView(asset.bytes);
  const format = inspectLocalFontFormat(name, bytes);
  if (asset.type != null && asset.type !== '' && asset.type !== format.type && asset.type !== 'application/octet-stream') {
    throw new TypeError('The font MIME type does not match its file data.');
  }
  return {
    id: id.trim(),
    name: name.trim(),
    type: format.type,
    family: family.trim(),
    weight,
    style,
    bytes: copyBytes ? bytes.slice() : bytes
  };
}

export async function loadLocalFontFace(asset, {
  FontFaceConstructor = globalThis.FontFace,
  fontSet = globalThis.document?.fonts,
  register = true,
  variationAxes = undefined
} = {}) {
  const font = validateLocalFontAsset(asset, { copyBytes: false });
  if (typeof FontFaceConstructor !== 'function' || (register && !fontSet?.add)) {
    throw new Error('This browser does not support locally installed fonts.');
  }
  const buffer = font.bytes.buffer.slice(font.bytes.byteOffset, font.bytes.byteOffset + font.bytes.byteLength);
  let face;
  try {
    const axes = variationAxes ?? await inspectFontVariationAxes(font.bytes);
    const weightAxis = axes.find(axis => axis.tag === 'wght');
    const weight = weightAxis && weightAxis.min >= 1 && weightAxis.max <= 1000
      ? `${weightAxis.min} ${weightAxis.max}` : String(font.weight);
    face = new FontFaceConstructor(font.family, buffer, { weight, style: font.style, display: 'swap' });
    await face.load();
    if (face.status && face.status !== 'loaded') throw new Error('The browser could not decode this font file.');
    if (register) fontSet.add(face);
    return face;
  } catch (error) {
    if (face) fontSet.delete?.(face);
    throw new TypeError(`Could not load “${font.name}” as ${font.family}: ${error?.message || 'invalid font data'}`);
  }
}

export function unloadLocalFontFace(face, fontSet = globalThis.document?.fonts) {
  if (face && fontSet?.delete) fontSet.delete(face);
}

/** Map font records with bounded parallelism to limit simultaneous local binary reads and parsing. */
export async function mapLocalFontAssets(fonts, visit, concurrency = 2) {
  if (!Array.isArray(fonts) || typeof visit !== 'function') throw new TypeError('Local font loading needs a font list and visitor.');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('Local font loading concurrency must be a positive integer.');
  const results = new Array(fonts.length);
  let next = 0;
  const worker = async () => {
    while (next < fonts.length) {
      const index = next++;
      results[index] = await visit(fonts[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, fonts.length) }, worker));
  return results;
}
