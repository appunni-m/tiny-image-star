import { canvasFontWeight } from './font-variation.js';

export const TEXT_LEADING_TRIM_LIMITS = Object.freeze({ maxMetricQueries: 2048, maxTextPerQuery: 32768, maxMetricDepth: 16, maxMetricRuns: 4096 });
export class TextLeadingTrimPendingError extends Error {
  constructor() { super('The local font cap-height metrics are still being prepared. Wait for the font, then retry export.'); this.name = 'TextLeadingTrimPendingError'; this.code = 'TEXT_LEADING_TRIM_PENDING'; }
}
export function hasTextLeadingTrim(node) {
  return node?.leadingTrim?.type === 'CAP_HEIGHT' || (node?.textRuns || []).some(run => run?.leadingTrim?.type === 'CAP_HEIGHT');
}
const sorted = value => Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b));
const metricStyleProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontAxes', 'fontFeatures',
  'leadingTrim', 'baselineShift', 'authoredFontSize', 'textPositionTopOffset'];
const metricStyle = (base, part) => Object.fromEntries(metricStyleProperties.filter(key => part?.[key] !== undefined || base?.[key] !== undefined)
  .map(key => [key, part?.[key] ?? base?.[key]]));
const metricKey = (style, text) => JSON.stringify([text, style.fontFamily || 'Arial, sans-serif', Number(style.fontSize) || 24,
  canvasFontWeight(style.fontWeight, style.fontAxes), style.fontStyle || 'normal', sorted(style.fontAxes), sorted(style.fontFeatures)]);
const validMetrics = (value, size) => value && ['capHeight', 'ascender'].every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= size * 8) && value.capHeight > 0;

/** Actual Canvas cap height and the baseline offset used by top-origin drawing, in pixels. */
export function canvasLeadingTrimMetrics(context, style) {
  if (typeof context?.measureText !== 'function') return null;
  const saved = { font: context.font, textAlign: context.textAlign, textBaseline: context.textBaseline };
  try {
    context.font = `${style.fontStyle === 'italic' ? 'italic ' : ''}${canvasFontWeight(style.fontWeight, style.fontAxes)} ${Number(style.fontSize) || 24}px ${style.fontFamily || 'Arial, sans-serif'}`;
    context.textAlign = 'left'; context.textBaseline = 'alphabetic';
    const alphabetic = context.measureText('H');
    context.textBaseline = 'top'; const top = context.measureText('H');
    const result = { capHeight: alphabetic.actualBoundingBoxAscent, ascender: alphabetic.actualBoundingBoxAscent - top.actualBoundingBoxAscent, source: 'canvas' };
    return validMetrics(result, Number(style.fontSize) || 24) ? result : null;
  } finally { Object.assign(context, saved); }
}

/** One bounded metric cache shared by candidate truncation heights and final block placement. */
export function createTextLeadingTrimResolver(node, { shapeText, fontMetrics, measureMetrics, strict = false } = {}) {
  if (!hasTextLeadingTrim(node) || node.textPath) return Object.freeze({ active: false,
    heightForLines: (lines, count = lines.length) => count ? Number(lines[count - 1].y || 0) + Number(lines[count - 1].lineHeight || 0) : 0,
    resolve: layout => layout });
  const cache = new Map(); let queries = 0; let pending = false;
  const metricsFor = (text, style) => {
    const size = Math.max(.001, Number(style.fontSize) || Number(node.fontSize) || 24);
    const key = metricKey(style, text);
    if (cache.has(key)) return cache.get(key);
    if (++queries > TEXT_LEADING_TRIM_LIMITS.maxMetricQueries || text.length > TEXT_LEADING_TRIM_LIMITS.maxTextPerQuery) throw new RangeError('Vertical text trim exceeds the bounded font-metric query budget.');
    const result = []; let localPending = false; let missingLocalMetric = false; let visits = 0;
    const collect = (shape, depth = 0) => {
      if (++visits > TEXT_LEADING_TRIM_LIMITS.maxMetricRuns) throw new RangeError('Vertical text trim exceeds the bounded font fallback run budget.');
      if (depth > TEXT_LEADING_TRIM_LIMITS.maxMetricDepth) throw new RangeError('Vertical text trim exceeds the bounded font fallback depth.');
      if (Array.isArray(shape?.mixedRuns)) { for (const run of shape.mixedRuns) collect(run.shaped, depth + 1); return; }
      if (shape?.upem > 0 && Number.isFinite(shape.extents?.ascender) && Number(shape.leadingTrimMetrics?.capHeight) > 0) {
        const value = { capHeight: shape.leadingTrimMetrics.capHeight * size / shape.upem, ascender: shape.extents.ascender * size / shape.upem, source: 'local' };
        if (validMetrics(value, size)) { result.push(value); return; }
      }
      missingLocalMetric = true;
    };
    const status = typeof shapeText === 'function' ? shapeText.fontStatus?.(style, text) ?? 'ready' : 'none';
    const supplied = fontMetrics?.(style, text);
    if (validMetrics(supplied, size)) result.push(supplied);
    if (!result.length && status !== 'none' && typeof shapeText === 'function') {
      const shape = shapeText(text || ' ', style); collect(shape);
      localPending = !shape || status === 'pending';
    }
    if (localPending) { pending = true; if (strict) throw new TextLeadingTrimPendingError(); }
    if (!result.length || missingLocalMetric) {
      const fallback = measureMetrics?.(style, text);
      if (validMetrics(fallback, size)) { result.push(fallback); missingLocalMetric = false; }
    }
    if ((!result.length || missingLocalMetric) && strict) {
      const error = new Error('Vertical text trim requires actual cap-height and baseline metrics from the retained font or Canvas.');
      error.code = 'TEXT_LEADING_TRIM_UNAVAILABLE'; throw error;
    }
    cache.set(key, result); return result;
  };
  const edge = (line, side) => {
    const parts = line.parts?.length ? line.parts : [{ text: line.displayText ?? '', style: node }];
    const sources = line.marker?.text ? [...parts, { text: line.marker.text, style: line.marker.style || node }] : parts;
    let value = side === 'top' ? Infinity : -Infinity;
    const include = edge => { value = side === 'top' ? Math.min(value, edge) : Math.max(value, edge); };
    for (const part of sources) {
      // Renderer layout options include live callbacks. Only send actual font
      // style fields into shaping, never the layout object or its functions.
      const style = metricStyle(node, part.style);
      if (style.leadingTrim?.type !== 'CAP_HEIGHT') { include(side === 'top' ? 0 : line.lineHeight); continue; }
      const metrics = metricsFor(String(part.text ?? ''), style);
      if (!metrics.length) { include(side === 'top' ? 0 : line.lineHeight); continue; }
      const offset = (Number(style.textPositionTopOffset) || 0) - (Number(style.baselineShift) || 0);
      for (const metric of metrics) include(metric.ascender + offset - (side === 'top' ? metric.capHeight : 0));
    }
    return value;
  };
  const insets = (lines, count) => {
    if (!count) return { topInset: 0, bottomBaseline: 0 };
    return { topInset: Number(lines[0].y || 0) + edge(lines[0], 'top'),
      bottomBaseline: Number(lines[count - 1].y || 0) + edge(lines[count - 1], 'bottom') };
  };
  return Object.freeze({ active: true,
    heightForLines(lines, count = lines.length) { const { topInset, bottomBaseline } = insets(lines, count); return Math.max(0, bottomBaseline - topInset); },
    resolve(layout) {
      if (!layout.lines?.length) return layout;
      const { topInset, bottomBaseline } = insets(layout.lines, layout.lines.length);
      if (![topInset, bottomBaseline, layout.height].every(Number.isFinite)) throw new RangeError('Vertical text trim requires finite block metrics.');
      return { ...layout, lines: layout.lines.map(line => ({ ...line, y: line.y - topInset })), height: Math.max(0, bottomBaseline - topInset),
        leadingTrim: Object.freeze({ topInset, bottomInset: layout.height - bottomBaseline, metricSource: pending ? 'provisional' : 'actual' }) };
    }
  });
}
export function resolveTextLeadingTrim(layout, options) {
  return createTextLeadingTrimResolver(options?.node || {}, options).resolve(layout);
}
