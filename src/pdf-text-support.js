import { getNodePropertyValue } from './model.js';
import { PdfVectorExportError } from './pdf-vector-export.js';
import { TEXT_DECORATION_PROPERTIES, isValidTextDecorationProperty } from './text-decoration-style.js';
import { vectorPdfTextAlignmentIssue } from './pdf-text-alignment.js';
import { isValidTextPosition } from './text-position-style.js';
import { isValidLeadingTrim } from './text-leading-trim-style.js';
import { inheritedTextLetterSpacing, resolvedTextLetterSpacing } from './text-letter-spacing.js';
import { assertLocalTextGlyphExportReady } from './svg-export.js';

const standardFontFamilies = new Set(['arial', 'helvetica', 'sans-serif']);
const supportedWeights = new Set([400, 700, '400', '700']);
const supportedStyles = new Set(['normal', 'italic']);
const supportedListStyles = new Set(['none', 'bulleted', 'numbered']);
const supportedTextCases = new Set(['none', 'uppercase', 'lowercase', 'capitalize']);

function hasSettings(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function fontFamilySupported(value) {
  const families = String(value || 'Arial, sans-serif').split(',')
    .map(family => family.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
  return families.length > 0 && families.every(family => standardFontFamilies.has(family));
}

function unsupportedTextFillStack(node) {
  const activeFills = Array.isArray(node.fills)
    ? node.fills.filter(fill => fill?.visible !== false && Number(fill?.opacity ?? 1) > 0)
    : [];
  if (activeFills.some(fill => fill.type !== 'solid'
    || String(fill.blendMode || 'normal').toLowerCase() !== 'normal')) return true;
  if (!Array.isArray(node.fills) && (node.fillGradient || node.imageFill)) return true;
  return false;
}

function hasActiveTextStroke(node) {
  if (Array.isArray(node.strokes)) {
    return node.strokes.some(stroke => stroke?.visible !== false && Number(stroke?.opacity ?? 1) > 0
      && Number(stroke?.width) > 0);
  }
  return Boolean(node.stroke && Number(node.strokeWidth) > 0 && Number(node.strokeOpacity ?? 1) > 0);
}

/** Check source settings before export; the PDF writer validates emitted glyphs and layout metrics. */
export function assertVectorPdfTextSupported(documentSnapshot, node, { measureText } = {}) {
  const label = node?.name || 'Text';
  const reject = (feature, detail) => {
    throw new PdfVectorExportError(feature, `layer “${label}”: ${detail} Use raster PDF to preserve this text exactly`);
  };
  if (!node || node.type !== 'text') return true;

  const text = String(getNodePropertyValue(documentSnapshot, node, 'text') ?? '');
  const fontSize = Number(getNodePropertyValue(documentSnapshot, node, 'fontSize') ?? 16);
  const fontFamily = getNodePropertyValue(documentSnapshot, node, 'fontFamily') || 'Arial, sans-serif';
  const fontWeight = getNodePropertyValue(documentSnapshot, node, 'fontWeight') || 400;
  const fontStyle = getNodePropertyValue(documentSnapshot, node, 'fontStyle') || 'normal';
  const letterSpacing = Number(getNodePropertyValue(documentSnapshot, node, 'letterSpacing') ?? 0);
  const fontAxes = getNodePropertyValue(documentSnapshot, node, 'fontAxes') || node.fontAxes;
  const fontFeatures = getNodePropertyValue(documentSnapshot, node, 'fontFeatures') || node.fontFeatures;

  const activeRuns = Array.isArray(node.textRuns)
    && node.textRuns.map(run => run?.text ?? '').join('') === text
    ? node.textRuns : [];
  if ([node, ...activeRuns].some(style => style.letterSpacingUnit !== undefined && !['pixels', 'percent'].includes(style.letterSpacingUnit))) {
    reject('letter spacing units', 'letter spacing must use pixels or a percentage of the font size.');
  }
  if ([node, ...activeRuns].some(style => style.textPosition !== undefined && !isValidTextPosition(style.textPosition))) {
    reject('text position', 'superscript/subscript settings must use the supported semantic enum.');
  }

  if ([node, ...activeRuns].some(style => style.leadingTrim !== undefined && !isValidLeadingTrim(style.leadingTrim))) {
    reject('leading trim', 'trim settings must use NONE or CAP_HEIGHT.');
  }

  let nativeGlyphs = false;
  if (typeof measureText?.shapeText === 'function') {
    try { nativeGlyphs = assertLocalTextGlyphExportReady(documentSnapshot, node, measureText); }
    catch (error) {
      if (String(error?.code || '').endsWith('_PENDING')) throw error;
      reject('local text glyph coverage', error.message || 'complete retained glyph contours are unavailable.');
    }
  }
  if (!nativeGlyphs && node.textPath) reject('text on a path', 'the vector writer cannot preserve shaped path placement.');
  if (!nativeGlyphs && !fontFamilySupported(fontFamily)) {
    reject('custom text fonts', 'only Arial, Helvetica, or sans-serif can use the built-in PDF fonts.');
  }
  if (!nativeGlyphs && (!supportedWeights.has(fontWeight) || !supportedStyles.has(fontStyle))) {
    reject('text font variants', 'only regular, bold, italic, and bold italic standard fonts are supported.');
  }
  if (!Number.isFinite(letterSpacing) || !nativeGlyphs && letterSpacing !== 0) reject('letter spacing', 'the vector text writer requires zero resolved letter spacing.');
  if (!nativeGlyphs && (hasSettings(fontAxes) || hasSettings(fontFeatures))) {
    reject('variable-font axes or OpenType features', 'the built-in PDF fonts cannot reproduce these font settings.');
  }
  if (!Number.isFinite(fontSize) || fontSize <= 0) reject('text font metrics', 'the font size must be positive and finite.');

  // Underlines are serialized as real filled paths by the shared decoration
  // geometry helper. Validate their sparse settings here before any PDF text
  // conversion; the writer keeps their color/alpha independent of glyph fills.
  for (const style of [node, ...activeRuns]) for (const property of TEXT_DECORATION_PROPERTIES) {
    if (style[property] !== undefined && !isValidTextDecorationProperty(property, style[property])) {
      reject('custom underline settings', `invalid ${property}.`);
    }
  }

  if (activeRuns.length) {
    for (const run of activeRuns) {
      const runFamily = run.fontFamily ?? fontFamily;
      const runWeight = run.fontWeight ?? fontWeight;
      const runStyle = run.fontStyle ?? fontStyle;
      const runSize = run.fontSize ?? fontSize;
      const runSpacing = resolvedTextLetterSpacing({ fontSize: runSize, ...inheritedTextLetterSpacing({ ...node, letterSpacing }, run) });
      const runAxes = run.fontAxes ?? fontAxes;
      const runFeatures = run.fontFeatures ?? fontFeatures;
      const baselineShift = Number(run.baselineShift ?? 0);
      if (!nativeGlyphs && !fontFamilySupported(runFamily)) {
        reject('custom text fonts', 'each active rich-text run must use Arial, Helvetica, or sans-serif.');
      }
      if (!nativeGlyphs && (!supportedWeights.has(runWeight) || !supportedStyles.has(runStyle))) {
        reject('text font variants', 'each active rich-text run must use a supported standard font variant.');
      }
      if (!Number.isFinite(Number(runSize)) || Number(runSize) <= 0 || Number(runSize) > 100_000) {
        reject('rich text font metrics', 'inline run sizes must be positive, finite, and within the supported font range.');
      }
      if (!Number.isFinite(runSpacing) || !nativeGlyphs && runSpacing !== 0) reject('letter spacing', 'every active rich-text run must use zero letter spacing.');
      if (!Number.isFinite(baselineShift) || Math.abs(baselineShift) > 100_000) reject('rich text baseline shifts', 'per-run baseline shifts need font-specific metrics.');
      if (!nativeGlyphs && (hasSettings(runAxes) || hasSettings(runFeatures))) {
        reject('variable-font axes or OpenType features', 'the built-in PDF fonts cannot reproduce rich-text font settings.');
      }
    }
  }

  if (node.textCase != null && !supportedTextCases.has(node.textCase)) {
    reject('text case transforms', 'the vector writer supports none, uppercase, lowercase, and capitalize.');
  }
  const alignmentIssue = vectorPdfTextAlignmentIssue(node);
  if (!nativeGlyphs && alignmentIssue) reject('text alignment', alignmentIssue);

  for (const paragraph of node.paragraphStyles || []) {
    if (paragraph?.listStyle != null && !supportedListStyles.has(paragraph.listStyle)) {
      reject('paragraph lists', 'only bullet and numbered markers are supported by the vector writer.');
    }
  }

  if (unsupportedTextFillStack(node)) {
    reject('text paint stacks', 'only visible normal solid text fills are supported.');
  }
  if (!nativeGlyphs && hasActiveTextStroke(node)) {
    reject('text outlines', 'text strokes require glyph outlines, which the vector PDF text writer does not create.');
  }
  if (node.blendMode && String(node.blendMode).toLowerCase() !== 'normal') {
    reject('text layer blend modes', 'the vector PDF writer cannot preserve non-normal layer blending.');
  }
  return true;
}
