import * as hb from 'harfbuzzjs';
import { unzlibSync } from 'fflate';

const MAX_FONT_BYTES = 20 * 1024 * 1024;
const MAX_FONTS = 4;
const MAX_TOTAL_FONT_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_CODE_UNITS = 32_768;
const MAX_FEATURES = 64;
const MAX_VARIATIONS = 64;
const MAX_GLYPHS = 65_536;
const MAX_PATH_CHARACTERS = 8 * 1024 * 1024;
const MAX_FONT_COVERAGE_CODEPOINTS = 300_000;
const WOFF_SIGNATURE = 0x774f4646;
const SFNT_SIGNATURES = new Set([0x00010000, 0x4f54544f, 0x74727565, 0x74797031]);
const fonts = new Map();
let totalFontBytes = 0;

function fail(message) { throw new TypeError(message); }

function paddedLength(length) { return (length + 3) & ~3; }

function checkedRange(offset, length, total, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
    || offset > total || length > total - offset) fail(`The WOFF ${label} range is invalid.`);
  return { start: offset, end: offset + length, label };
}

function checksum(bytes, zeroHeadAdjustment = false) {
  let sum = 0;
  for (let offset = 0; offset < paddedLength(bytes.byteLength); offset += 4) {
    let word = 0;
    for (let index = 0; index < 4; index += 1) {
      const position = offset + index;
      let byte = position < bytes.byteLength ? bytes[position] : 0;
      if (zeroHeadAdjustment && position >= 8 && position < 12) byte = 0;
      word = (word * 256 + byte) >>> 0;
    }
    sum = (sum + word) >>> 0;
  }
  return sum;
}

function decodeWoff1(source) {
  if (!(source instanceof ArrayBuffer) || source.byteLength < 44 || source.byteLength > MAX_FONT_BYTES) {
    fail('The local WOFF font is outside the supported size limits.');
  }
  const view = new DataView(source);
  if (view.getUint32(0, false) !== WOFF_SIGNATURE || view.getUint32(8, false) !== source.byteLength) {
    fail('The local WOFF header is invalid.');
  }
  const flavor = view.getUint32(4, false);
  const tableCount = view.getUint16(12, false);
  const reserved = view.getUint16(14, false);
  const totalSfntSize = view.getUint32(16, false);
  if (!SFNT_SIGNATURES.has(flavor) || tableCount < 1 || tableCount > 4096 || reserved !== 0
    || totalSfntSize < 12 + 16 * tableCount || totalSfntSize > MAX_FONT_BYTES || totalSfntSize % 4 !== 0) {
    fail('The local WOFF font metadata is invalid.');
  }

  const directoryEnd = 44 + tableCount * 20;
  if (directoryEnd > source.byteLength) fail('The local WOFF table directory is truncated.');
  const ranges = [{ start: 0, end: directoryEnd, label: 'header and table directory' }];
  const metadata = [view.getUint32(24, false), view.getUint32(28, false), view.getUint32(32, false)];
  if (metadata[0] === 0) {
    if (metadata[1] !== 0 || metadata[2] !== 0) fail('The local WOFF metadata header is inconsistent.');
  } else {
    if (metadata[1] === 0 || metadata[2] === 0 || metadata[1] > MAX_FONT_BYTES || metadata[2] > MAX_FONT_BYTES) {
      fail('The local WOFF metadata header is inconsistent.');
    }
    ranges.push(checkedRange(metadata[0], metadata[1], source.byteLength, 'metadata'));
  }
  const privateOffset = view.getUint32(36, false);
  const privateLength = view.getUint32(40, false);
  if ((privateOffset === 0) !== (privateLength === 0)) fail('The local WOFF private-data header is inconsistent.');
  if (privateLength > MAX_FONT_BYTES) fail('The local WOFF private-data block is too large.');
  if (privateOffset) ranges.push(checkedRange(privateOffset, privateLength, source.byteLength, 'private-data'));

  const tables = [];
  const tags = new Set();
  let expectedSfntSize = 12 + 16 * tableCount;
  for (let index = 0; index < tableCount; index += 1) {
    const record = 44 + index * 20;
    const tagBytes = new Uint8Array(source, record, 4);
    const tag = String.fromCharCode(...tagBytes);
    const offset = view.getUint32(record + 4, false);
    const compressedLength = view.getUint32(record + 8, false);
    const originalLength = view.getUint32(record + 12, false);
    const originalChecksum = view.getUint32(record + 16, false);
    if (tags.has(tag) || compressedLength > originalLength || originalLength > MAX_FONT_BYTES) {
      fail('The local WOFF table directory contains invalid entries.');
    }
    tags.add(tag);
    const range = checkedRange(offset, compressedLength, source.byteLength, `table ${tag}`);
    if (offset % 4 !== 0 || offset < directoryEnd) fail(`The local WOFF table ${tag} has an invalid offset.`);
    ranges.push(range);
    expectedSfntSize += paddedLength(originalLength);
    if (expectedSfntSize > MAX_FONT_BYTES) fail('The decoded local font exceeds the supported size limit.');
    tables.push({ tag, tagBytes, offset, compressedLength, originalLength, originalChecksum });
  }
  if (expectedSfntSize !== totalSfntSize) fail('The local WOFF decoded-size field is incorrect.');
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  let previousEnd = directoryEnd;
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) fail(`The local WOFF ${ranges[index].label} overlaps ${ranges[index - 1].label}.`);
    const gap = ranges[index].start - previousEnd;
    if (gap > 3) fail(`The local WOFF contains unexpected data before ${ranges[index].label}.`);
    for (let offset = previousEnd; offset < ranges[index].start; offset += 1) {
      if (new Uint8Array(source, offset, 1)[0] !== 0) fail('The local WOFF alignment padding is invalid.');
    }
    previousEnd = ranges[index].end;
  }
  if (source.byteLength - previousEnd > 3) fail('The local WOFF contains unexpected trailing data.');
  for (let offset = previousEnd; offset < source.byteLength; offset += 1) {
    if (new Uint8Array(source, offset, 1)[0] !== 0) fail('The local WOFF trailing padding is invalid.');
  }

  for (const table of tables) {
    const compressed = new Uint8Array(source, table.offset, table.compressedLength);
    let bytes;
    try { bytes = table.compressedLength === table.originalLength ? compressed.slice() : unzlibSync(compressed); }
    catch { fail(`The local WOFF table ${table.tag} could not be decompressed.`); }
    if (bytes.byteLength !== table.originalLength
      || checksum(bytes, table.tag === 'head') !== table.originalChecksum) {
      fail(`The local WOFF table ${table.tag} has an invalid length or checksum.`);
    }
    table.bytes = bytes;
  }

  tables.sort((left, right) => left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0);
  const output = new Uint8Array(totalSfntSize);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(0, flavor, false);
  outputView.setUint16(4, tableCount, false);
  let searchPower = 1;
  let entrySelector = 0;
  while (searchPower * 2 <= tableCount) { searchPower *= 2; entrySelector += 1; }
  outputView.setUint16(6, searchPower * 16, false);
  outputView.setUint16(8, entrySelector, false);
  outputView.setUint16(10, tableCount * 16 - searchPower * 16, false);

  let dataOffset = 12 + 16 * tableCount;
  let headAdjustmentOffset = -1;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    output.set(table.tagBytes, record);
    outputView.setUint32(record + 4, table.originalChecksum, false);
    outputView.setUint32(record + 8, dataOffset, false);
    outputView.setUint32(record + 12, table.originalLength, false);
    output.set(table.bytes, dataOffset);
    if (table.tag === 'head' && table.originalLength >= 12) headAdjustmentOffset = dataOffset + 8;
    dataOffset += paddedLength(table.originalLength);
  });
  if (dataOffset !== totalSfntSize || headAdjustmentOffset < 0) fail('The local WOFF font is missing required sfnt data.');
  outputView.setUint32(headAdjustmentOffset, (0xb1b0afba - checksum(output)) >>> 0, false);
  return output.buffer;
}

function fontSignature(bytes) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 12 || bytes.byteLength > MAX_FONT_BYTES) {
    fail('Local font data is outside the supported size limits.');
  }
  const signature = new DataView(bytes).getUint32(0, false);
  if (!SFNT_SIGNATURES.has(signature)) {
    fail('Local glyph preview requires a decoded TrueType or OpenType font.');
  }
  return signature;
}

function checkedVariations(value) {
  if (value == null) return [];
  const entries = Object.entries(value);
  if (entries.length > MAX_VARIATIONS || entries.some(([tag, amount]) =>
    !/^[\x20-\x7e]{4}$/u.test(tag) || !Number.isFinite(amount) || Math.abs(amount) > 1_000_000)) {
    fail('The font variation settings are invalid.');
  }
  return entries.map(([tag, amount]) => new hb.Variation(tag, amount));
}

function checkedFeatures(value) {
  if (value == null) return [];
  const entries = Object.entries(value);
  if (entries.length > MAX_FEATURES || entries.some(([tag, setting]) =>
    !/^[\x20-\x7e]{4}$/u.test(tag) || !Number.isSafeInteger(setting) || setting < 0 || setting > 65_535)) {
    fail('The OpenType feature settings are invalid.');
  }
  return entries.map(([tag, setting]) => new hb.Feature(tag, setting));
}

function touchFont(fontId) {
  const font = fonts.get(fontId);
  if (!font) fail('The local font is no longer available to the preview worker.');
  fonts.delete(fontId);
  fonts.set(fontId, font);
  return font;
}

function loadFont({ fontId, bytes }) {
  if (typeof fontId !== 'string' || !/^[\w.-]{1,128}$/u.test(fontId)) fail('The local font identity is invalid.');
  if (bytes instanceof ArrayBuffer && bytes.byteLength >= 4 && new DataView(bytes).getUint32(0, false) === WOFF_SIGNATURE) {
    bytes = decodeWoff1(bytes);
  }
  fontSignature(bytes);
  const previous = fonts.get(fontId);
  if (previous) { totalFontBytes -= previous.byteLength; fonts.delete(fontId); }
  const evictedFontIds = [];
  while (fonts.size >= MAX_FONTS || totalFontBytes + bytes.byteLength > MAX_TOTAL_FONT_BYTES) {
    const [oldestId, oldest] = fonts.entries().next().value || [];
    if (!oldestId) fail('The local font preview cache is full.');
    fonts.delete(oldestId);
    totalFontBytes -= oldest.byteLength;
    evictedFontIds.push(oldestId);
  }
  const binary = new hb.Blob(bytes);
  const face = new hb.Face(binary);
  if (!Number.isSafeInteger(face.upem) || face.upem <= 0 || face.upem > 16_384) fail('The local font has invalid glyph units.');
  const coverage = face.collectUnicodes().sort();
  if (coverage.length > MAX_FONT_COVERAGE_CODEPOINTS) fail('The local font has too many mapped Unicode code points for preview.');
  const record = { binary, face, byteLength: bytes.byteLength };
  fonts.set(fontId, record);
  totalFontBytes += bytes.byteLength;
  const metricFont = new hb.Font(face); metricFont.setScale(face.upem, face.upem);
  return {
    axes: face.getAxisInfos(),
    gsubFeatures: face.getTableFeatureTags('GSUB'),
    gposFeatures: face.getTableFeatureTags('GPOS'),
    upem: face.upem,
    fontMetrics: { upem: face.upem, extents: metricFont.hExtents(), leadingTrimMetrics: leadingTrimMetricsForFont(metricFont) },
    coverage,
    evictedFontIds
  };
}

function leadingTrimMetricsForFont(font) {
  let capHeight = font.getMetricPosition(hb.MetricsTag.CAP_HEIGHT);
  let source = 'font-metric';
  if (!(Number.isFinite(capHeight) && capHeight > 0)) {
    const glyph = font.nominalGlyph(0x48);
    capHeight = glyph ? font.glyphExtents(glyph)?.yBearing : undefined; source = 'glyph-H';
  }
  return Number.isFinite(capHeight) && capHeight > 0 ? { capHeight, source } : {};
}

function shapeText({ fontId, text, variations, features, script, language, direction }) {
  if (typeof text !== 'string' || text.length > MAX_TEXT_CODE_UNITS) fail('This text is too long for local glyph preview.');
  if (script != null && (typeof script !== 'string' || !/^[A-Za-z0-9 ]{4}$/u.test(script))) fail('The text script is invalid.');
  if (language != null && (typeof language !== 'string' || language.length > 64)) fail('The text language is invalid.');
  if (direction != null && !['ltr', 'rtl', 'ttb', 'btt'].includes(direction)) fail('The text direction is invalid.');
  const { face } = touchFont(fontId);
  const font = new hb.Font(face);
  font.setScale(face.upem, face.upem);
  font.setVariations(checkedVariations(variations));
  const positionMetrics = Object.fromEntries(['superscript', 'subscript'].map(position => {
    const prefix = position.toUpperCase();
    return [position, Object.fromEntries([['xSize', 'X_SIZE'], ['ySize', 'Y_SIZE'], ['xOffset', 'X_OFFSET'], ['yOffset', 'Y_OFFSET']]
      .map(([key, suffix]) => [key, font.getMetricPosition(hb.MetricsTag[`${prefix}_EM_${suffix}`])])
      .filter(([, value]) => Number.isFinite(value)))];
  }));
  const leadingTrimMetrics = leadingTrimMetricsForFont(font);
  const buffer = new hb.Buffer();
  buffer.addText(text);
  // Guess complete Unicode segment properties first, then apply explicit
  // overrides. This keeps direction overrides from skipping script detection.
  buffer.guessSegmentProperties();
  if (script) buffer.setScript(script);
  if (language) buffer.setLanguage(language);
  if (direction) buffer.setDirection(direction);
  hb.shape(font, buffer, checkedFeatures(features));
  const infos = buffer.getGlyphInfosAndPositions();
  if (infos.length > MAX_GLYPHS) fail('The shaped text exceeds the local glyph preview limit.');
  if (infos.some(glyph => glyph.codepoint === 0)) {
    return { upem: face.upem, extents: font.hExtents(), positionMetrics, leadingTrimMetrics, missingGlyph: true, glyphs: [] };
  }
  let pathCharacters = 0;
  const glyphs = infos.map(glyph => {
    const path = font.glyphToPath(glyph.codepoint);
    pathCharacters += path.length;
    if (pathCharacters > MAX_PATH_CHARACTERS) fail('The font outlines exceed the local preview memory limit.');
    return {
      id: glyph.codepoint,
      cluster: glyph.cluster,
      xAdvance: glyph.xAdvance || 0,
      yAdvance: glyph.yAdvance || 0,
      xOffset: glyph.xOffset || 0,
      yOffset: glyph.yOffset || 0,
      path
    };
  });
  return { upem: face.upem, extents: font.hExtents(), positionMetrics, leadingTrimMetrics, glyphs };
}

function releaseFont(fontId) {
  const font = fonts.get(fontId);
  if (!font) return false;
  fonts.delete(fontId);
  totalFontBytes -= font.byteLength;
  return true;
}

self.addEventListener('message', event => {
  const { id, type } = event.data || {};
  try {
    if (!Number.isSafeInteger(id) || id < 1) fail('The font preview request identity is invalid.');
    let value;
    if (type === 'load-font') value = loadFont(event.data);
    else if (type === 'shape') value = shapeText(event.data);
    else if (type === 'release-font') value = { released: releaseFont(event.data.fontId) };
    else fail('The font preview request type is invalid.');
    self.postMessage({ id, ok: true, value });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || 'Local font shaping failed.' });
  }
});
