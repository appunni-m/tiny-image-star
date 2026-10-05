import { transformTextCase, textCaseStyleRuns } from './text-layout.js';
import { canvasFontWeight } from './font-variation.js';

export const TEXT_POSITION_LIMITS = Object.freeze({ maxRuns: 1024, maxText: 32768, maxGlyphs: 65536, maxQueries: 2048 });
export const TEXT_POSITION_FALLBACK = Object.freeze({ scale: .65, superscriptOffset: .35, subscriptOffset: .15, ascender: 1 });
export class TextPositionPendingError extends Error {
  constructor(message = 'The local superscript/subscript glyphs are still being prepared. Wait for the font, then retry export.') {
    super(message); this.name = 'TextPositionPendingError'; this.code = 'TEXT_POSITION_PENDING';
  }
}
const positions = new Set(['normal', 'superscript', 'subscript']);
const keys = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontAxes', 'fontFeatures', 'lineHeight', 'lineHeightUnit', 'letterSpacing', 'color', 'baselineShift', 'textPosition'];
const fields = ['fontSize', 'fontFeatures', 'authoredFontSize', 'textPositionScaleX', 'textPositionOffsetX', 'textPositionTopOffset', 'textPositionBaselineOffset'];
const positionFor = value => positions.has(value) ? value : 'normal';
const featuresFor = (style, position, enabled) => ({ ...style.fontFeatures, sups: enabled && position === 'superscript' ? 1 : 0, subs: enabled && position === 'subscript' ? 1 : 0 });
const canonicalMap = value => Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
const styleKey = style => JSON.stringify([positionFor(style.textPosition), style.fontFamily || 'Arial, sans-serif', Number(style.fontSize) || 24,
  canvasFontWeight(style.fontWeight, style.fontAxes), style.fontStyle || 'normal', canonicalMap(style.fontAxes), canonicalMap(style.fontFeatures)]);
function inheritedStyle(node, run = {}) {
  return Object.fromEntries(keys.filter(key => run[key] !== undefined || node[key] !== undefined).map(key => [key, run[key] ?? node[key]]));
}
function leafShape(shaped, depth = 0) {
  if (depth > 16) return null;
  if (shaped?.mixedRuns) return shaped.mixedRuns.map(run => leafShape(run.shaped, depth + 1)).find(Boolean);
  return shaped && !shaped.missingGlyph && shaped.upem > 0 && Array.isArray(shaped.glyphs) ? shaped : null;
}
function clustersFor(shaped, text, offset = 0, budget = { glyphs: 0, runs: 0 }, depth = 0) {
  if (!shaped || shaped.missingGlyph || depth > 16) return null;
  if (Array.isArray(shaped.mixedRuns)) {
    if (shaped.mixedRuns.length > TEXT_POSITION_LIMITS.maxRuns) throw new RangeError('Text position exceeds the bounded glyph-run budget.');
    if (shaped.mixedRuns.map(run => run.text).join('') !== text) return null;
    const result = new Map(); let start = offset;
    for (const run of shaped.mixedRuns) {
      if (++budget.runs > TEXT_POSITION_LIMITS.maxRuns) throw new RangeError('Text position exceeds the bounded glyph-run budget.');
      const clusters = clustersFor(run.shaped, run.text, start, budget, depth + 1);
      if (!clusters) return null;
      for (const [key, ids] of clusters) result.set(key, ids);
      start += run.text.length;
    }
    return result;
  }
  if (!Array.isArray(shaped.glyphs) || !(shaped.upem > 0)) return null;
  const result = new Map();
  for (const glyph of shaped.glyphs) {
    if (++budget.glyphs > TEXT_POSITION_LIMITS.maxGlyphs) throw new RangeError('Text position exceeds the bounded glyph budget.');
    if (!Number.isInteger(glyph.cluster) || glyph.cluster < 0 || glyph.cluster >= text.length || !Number.isInteger(glyph.id) || glyph.id <= 0) return null;
    const key = glyph.cluster + offset;
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(glyph.id);
  }
  return result;
}
/** Feature presence alone is insufficient: every visible cluster must have a real substituted glyph. */
export function hasCompleteTextPositionGlyphs(text, normal, positioned) {
  const base = clustersFor(normal, text); const candidate = clustersFor(positioned, text);
  if (!base || !candidate || base.size !== candidate.size) return false;
  if (!base.size && /[^\s\u200b\u200c\u200d\u2060]/u.test(text)) return false;
  const starts = [...base.keys()].sort((a, b) => a - b);
  return starts.every((start, index) => {
    if (/^[\s\u200b\u200c\u200d\u2060]*$/u.test(text.slice(start, starts[index + 1] ?? text.length))) return true;
    const ids = candidate.get(start);
    return ids && JSON.stringify(ids) !== JSON.stringify(base.get(start));
  });
}

/** One immutable, layer-wide decision; synthesized numeric defaults are explicit approximations. */
export function resolveTextPositionPlan(node, { shapeText, transformText = transformTextCase } = {}) {
  const source = Array.isArray(node.textRuns) && node.textRuns.map(run => run.text).join('') === String(node.text ?? '')
    ? node.textRuns : [{ text: String(node.text ?? '') }];
  const active = source.filter(run => positionFor(run.textPosition ?? node.textPosition) !== 'normal');
  if (!active.length) return Object.freeze({ mode: 'normal', resolveStyle: style => ({ ...style }) });
  if (active.length > TEXT_POSITION_LIMITS.maxRuns || active.reduce((size, run) => size + String(run.text ?? '').length, 0) > TEXT_POSITION_LIMITS.maxText) throw new RangeError('Text position exceeds the bounded source budget.');
  const displayed = transformText === transformTextCase
    ? textCaseStyleRuns(node.textCase === 'capitalize' ? source : active, node.textCase || 'none', node).filter(run => positionFor(run.style.textPosition) !== 'normal')
    : active.map(run => ({ text: transformText(String(run.text ?? ''), node.textCase || 'none'), style: inheritedStyle(node, run) }));
  if (displayed.reduce((size, run) => size + run.text.length, 0) > TEXT_POSITION_LIMITS.maxText) throw new RangeError('Text position exceeds the bounded displayed source budget.');
  const records = new Map(); const probes = new Map(); let pending = false; let complete = true; let queries = 0;
  for (const run of displayed) {
    const style = run.style; const position = positionFor(style.textPosition);
    // Block-layout controls have no displayed glyph. A retained font may map
    // them to .notdef; probe equivalent spacing without changing authored text.
    const text = run.text.replace(/[\r\n\t]/gu, ' ');
    const key = styleKey(style); const probeKey = JSON.stringify([key, text]);
    if (probes.has(probeKey)) continue;
    probes.set(probeKey, true);
    const status = typeof shapeText === 'function' ? shapeText.fontStatus?.(style, text) ?? 'ready' : 'none';
    let normal = null; let positioned = null;
    if (status !== 'none' && typeof shapeText === 'function') {
      if ((queries += 2) > TEXT_POSITION_LIMITS.maxQueries) throw new RangeError('Text position exceeds the bounded shaping query budget.');
      normal = shapeText(text, { ...style, fontFeatures: featuresFor(style, position, false) });
      positioned = shapeText(text, { ...style, fontFeatures: featuresFor(style, position, true) });
      if (!normal || !positioned || status === 'pending') pending = true;
    }
    if (!hasCompleteTextPositionGlyphs(text, normal, positioned)) complete = false;
    const leaf = leafShape(normal);
    const record = { normal: leaf ? {
      upem: leaf.upem, extents: leaf.extents, positionMetrics: leaf.positionMetrics
    } : null };
    if (!records.has(key) || !records.get(key).normal) records.set(key, record);
  }
  const mode = pending ? 'pending' : complete ? 'font' : 'synthesized';
  const resolveStyle = style => {
    const position = positionFor(style.textPosition);
    if (position === 'normal' || mode === 'normal') return { ...style };
    const record = records.get(styleKey(style));
    const authored = Math.max(.001, Number(style.fontSize) || Number(node.fontSize) || 24);
    if (mode === 'font') return { ...style, authoredFontSize: authored, fontFeatures: featuresFor(style, position, true),
      textPositionScaleX: 1, textPositionOffsetX: 0, textPositionTopOffset: 0, textPositionBaselineOffset: 0 };
    const shape = record?.normal; const metric = shape?.positionMetrics?.[position]; const upem = shape?.upem;
    const valid = metric && upem > 0 && ['xSize', 'ySize', 'xOffset', 'yOffset'].every(key => Number.isFinite(metric[key]))
      && metric.xSize > 0 && metric.ySize > 0 && metric.xSize <= upem * 2 && metric.ySize <= upem * 2
      && Math.abs(metric.xOffset) <= upem * 4 && Math.abs(metric.yOffset) <= upem * 4;
    const yRatio = valid ? metric.ySize / upem : TEXT_POSITION_FALLBACK.scale;
    const xRatio = valid ? metric.xSize / upem : yRatio;
    const offset = authored * (valid ? metric.yOffset / upem : position === 'superscript' ? TEXT_POSITION_FALLBACK.superscriptOffset : TEXT_POSITION_FALLBACK.subscriptOffset);
    const baselineOffset = position === 'superscript' ? -offset : offset;
    const ascender = shape && Number.isFinite(shape.extents?.ascender) ? shape.extents.ascender / shape.upem : TEXT_POSITION_FALLBACK.ascender;
    return { ...style, fontSize: authored * yRatio, authoredFontSize: authored, fontFeatures: featuresFor(style, position, false),
      textPositionScaleX: xRatio / yRatio, textPositionOffsetX: valid ? authored * metric.xOffset / upem : 0,
      textPositionBaselineOffset: baselineOffset, textPositionTopOffset: authored * ascender * (1 - yRatio) + baselineOffset };
  };
  return Object.freeze({ mode, resolveStyle });
}

/** Runtime rich view only. Never persist its derived style fields into authored runs. */
export function resolveTextPositionView(node, options) {
  const plan = resolveTextPositionPlan(node, options);
  if (options?.strict && plan.mode === 'pending') throw new TextPositionPendingError();
  if (plan.mode === 'normal') return { plan, node };
  const source = Array.isArray(node.textRuns) && node.textRuns.map(run => run.text).join('') === String(node.text ?? '') ? node.textRuns : [{ text: String(node.text ?? '') }];
  return { plan, node: { ...node, __textPositionResolved: true, textRuns: source.map(run => {
    const resolved = plan.resolveStyle(inheritedStyle(node, run));
    return { ...run, ...Object.fromEntries(fields.filter(key => resolved[key] !== undefined).map(key => [key, resolved[key]])) };
  }) } };
}
