import { canvasFontWeight } from './font-variation.js';

export const TEXT_LINE_METRIC_LIMITS = Object.freeze({ maxQueries: 32768, maxFallbackRuns: 4096, maxDepth: 16, maxSampleCodeUnits: 32768 });
export class TextLineMetricsPendingError extends Error {
  constructor() { super('The local font line metrics are still being prepared. Wait for the font, then retry export.'); this.name = 'TextLineMetricsPendingError'; this.code = 'TEXT_LINE_METRICS_PENDING'; }
}
const styleKeys = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontAxes', 'fontFeatures'];
const fontStyle = style => Object.fromEntries(styleKeys.filter(key => style?.[key] !== undefined).map(key => [key, style[key]]));
const sorted = value => Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b));
const sizeFor = style => Math.max(.001, Number(style?.fontSize) || 24);
const emojiOnly = text => /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u20e3]/u.test(String(text))
  && !String(text).replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0e\ufe0f\u20e3\s]/gu, '');
const sampleFor = text => {
  const value = String(text ?? '').replace(/[\r\n\t]/gu, ' ');
  return value.slice(0, TEXT_LINE_METRIC_LIMITS.maxSampleCodeUnits) || ' ';
};
const keyFor = (text, style) => JSON.stringify([text, style.fontFamily || 'Arial, sans-serif', sizeFor(style),
  canvasFontWeight(style.fontWeight, style.fontAxes), style.fontStyle || 'normal', sorted(style.fontAxes), sorted(style.fontFeatures)]);
const validPixels = (value, size) => value && ['ascent', 'descent', 'lineGap', 'topBaseline'].every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= size * 16)
  && value.ascent >= 0 && value.descent >= 0 && value.ascent + value.descent > 0;
function nativePixels(value, size) {
  if (!(value?.upem > 0) || !['ascender', 'descender', 'lineGap'].every(key => Number.isFinite(value.extents?.[key]))) return null;
  const scale = size / value.upem;
  const result = { ascent: value.extents.ascender * scale, descent: -value.extents.descender * scale,
    lineGap: value.extents.lineGap * scale, topBaseline: value.extents.ascender * scale, source: 'local' };
  return validPixels(result, size) ? result : null;
}

/** Actual font box and the browser's top-origin-to-alphabetic offset, in pixels.
 * Canvas does not expose an OpenType line gap; native retained fonts supply it.
 */
export function canvasTextLineMetrics(context, style, text = 'Hg') {
  if (typeof context?.measureText !== 'function') return null;
  const saved = { font: context.font, textAlign: context.textAlign, textBaseline: context.textBaseline };
  try {
    context.font = `${style.fontStyle === 'italic' ? 'italic ' : ''}${canvasFontWeight(style.fontWeight, style.fontAxes)} ${sizeFor(style)}px ${style.fontFamily || 'Arial, sans-serif'}`;
    context.textAlign = 'left'; context.textBaseline = 'alphabetic';
    const sample = sampleFor(text).trim() || 'Hg';
    const alphabetic = context.measureText(sample);
    // Fallback emoji glyphs determine paint placement, not the declared font's
    // logical line envelope. Canvas has no primary-font metadata API.
    const fontBox = emojiOnly(sample) ? context.measureText('Hg') : alphabetic;
    context.textBaseline = 'top'; const top = context.measureText(sample);
    const result = { ascent: fontBox.fontBoundingBoxAscent, descent: fontBox.fontBoundingBoxDescent, lineGap: 0,
      topBaseline: alphabetic.actualBoundingBoxAscent - top.actualBoundingBoxAscent, source: 'canvas' };
    return validPixels(result, sizeFor(style)) ? result : null;
  } finally { Object.assign(context, saved); }
}

/** Share one bounded native/Canvas metric cache across rich lines and struts. */
export function createTextLineMetricResolver({ shapeText, measureMetrics, strict = false } = {}) {
  const available = typeof shapeText === 'function' || typeof measureMetrics === 'function';
  const cache = new Map(); let queries = 0; let provisional = false;
  const metricsFor = (text, sourceStyle) => {
    if (!available) return null;
    const style = fontStyle(sourceStyle); const size = sizeFor(style); const sample = sampleFor(text); const key = keyFor(sample, style);
    if (cache.has(key)) return cache.get(key);
    if (++queries > TEXT_LINE_METRIC_LIMITS.maxQueries) throw new RangeError('Text layout exceeds the bounded font line-metric query budget.');
    const supplied = shapeText?.fontMetrics?.(style, sample);
    let primary = nativePixels(supplied, size); let metrics = primary; let shape = null; let missing = false;
    const metricStatus = shapeText?.fontMetricsStatus?.(style) ?? 'none';
    if (!metrics && metricStatus === 'pending') { provisional = true; if (strict) throw new TextLineMetricsPendingError(); }
    const status = typeof shapeText === 'function' ? shapeText.fontStatus?.(style, sample) ?? 'ready' : 'none';
    if (status !== 'none' && typeof shapeText === 'function') {
      shape = shapeText(sample, style);
      primary ||= nativePixels(shape?.primaryFontMetrics, size);
      const values = []; let visits = 0; let paintMetrics = null;
      const collect = (value, text, depth = 0) => {
        if (++visits > TEXT_LINE_METRIC_LIMITS.maxFallbackRuns || depth > TEXT_LINE_METRIC_LIMITS.maxDepth) throw new RangeError('Text layout exceeds the bounded font fallback metric budget.');
        if (value?.mixedRuns) { for (const run of value.mixedRuns) collect(run.shaped, run.text, depth + 1); return; }
        const result = nativePixels(value, size);
        if (result) { paintMetrics ||= result; if (!emojiOnly(text)) values.push(result); }
        else if (!emojiOnly(text)) missing = true;
      };
      collect(shape, sample);
      if (values.length) metrics = primary ? { ...primary, topBaseline: (paintMetrics || values[0]).topBaseline } : {
        ascent: Math.max(...values.map(value => value.ascent)), descent: Math.max(...values.map(value => value.descent)),
        lineGap: Math.max(...values.map(value => value.lineGap)), topBaseline: values[0].topBaseline, source: 'local' };
      else metrics = primary && paintMetrics ? { ...primary, topBaseline: paintMetrics.topBaseline } : metrics || primary;
    }
    const glyphPending = shape == null && status !== 'none' && typeof shapeText === 'function';
    if (status === 'pending' || glyphPending) {
      provisional = true; if (strict) throw new TextLineMetricsPendingError();
    }
    if (!metrics || missing || glyphPending || status === 'none') {
      const fallback = measureMetrics?.(style, sample);
      if (validPixels(fallback, size)) {
        metrics = metrics ? { ...metrics,
          ...(missing && !primary ? { ascent: Math.max(metrics.ascent, fallback.ascent), descent: Math.max(metrics.descent, fallback.descent), lineGap: Math.max(metrics.lineGap, fallback.lineGap) } : {}),
          ...(!shape || status === 'none' ? { topBaseline: fallback.topBaseline, topBaselineSource: 'canvas' } : {}) } : fallback;
        missing = false;
      }
    }
    if ((!metrics || missing) && strict) {
      const error = new Error('Text layout requires actual font ascent, descent and baseline metrics. Try a retained local font or export a raster image.');
      error.code = 'TEXT_LINE_METRICS_UNAVAILABLE'; throw error;
    }
    cache.set(key, metrics); return metrics;
  };
  return Object.freeze({ available, metricsFor, get provisional() { return provisional; } });
}

function requestedHeight(style, metrics, fallback) {
  const size = Math.max(.001, Number(style.authoredFontSize) || sizeFor(style));
  const value = Number(style.lineHeight);
  if (style.lineHeightUnit === 'auto') return Math.max(.001, metrics.ascent + metrics.descent + metrics.lineGap);
  if (!(value > 0) || !Number.isFinite(value)) return fallback;
  if (style.lineHeightUnit === 'pixels') return value;
  if (style.lineHeightUnit === 'percent') return size * value / 100;
  return size * value;
}

/** Metric-based shared alphabetic baselines. Authored styles remain unchanged. */
export function resolveTextLineLayout(layout, { baseStyle = {}, resolver, shapeText, measureMetrics, strict = false, preserveLineBoxes = false } = {}) {
  const metricResolver = resolver || createTextLineMetricResolver({ shapeText, measureMetrics, strict });
  if (!metricResolver.available || !layout.lines?.length || baseStyle.textPath) return layout;
  const records = [];
  for (const line of layout.lines) {
    const parts = line.parts?.length ? line.parts : [{ text: line.displayText ?? '', style: baseStyle }];
    const recordsForLine = [];
    for (const part of parts) {
      const style = { ...baseStyle, ...part.style };
      const effective = metricResolver.metricsFor(part.text, style);
      const authoredStyle = style.authoredFontSize ? { ...style, fontSize: style.authoredFontSize } : style;
      const envelope = style.authoredFontSize ? metricResolver.metricsFor(part.text, authoredStyle) : effective;
      if (!effective || !envelope) return layout;
      recordsForLine.push({ part, style, effective, envelope });
    }
    let marker = null;
    if (line.marker?.text) {
      const style = { ...baseStyle, ...line.marker.style };
      const effective = metricResolver.metricsFor(line.marker.text, style);
      const envelope = style.authoredFontSize ? metricResolver.metricsFor(line.marker.text, { ...style, fontSize: style.authoredFontSize }) : effective;
      if (!effective || !envelope) return layout;
      marker = { part: line.marker, style, effective, envelope };
    }
    const envelopes = [...recordsForLine, ...(marker ? [marker] : [])];
    const preserve = preserveLineBoxes && Number.isFinite(line.baselineY) && Number.isFinite(line.ascent) && Number.isFinite(line.descent);
    const ascent = preserve ? line.ascent : Math.max(...envelopes.map(record => record.envelope.ascent));
    const descent = preserve ? line.descent : Math.max(...envelopes.map(record => record.envelope.descent));
    const lineGap = Math.max(...envelopes.map(record => record.envelope.lineGap));
    let lineHeight = Math.max(...envelopes.map(record => requestedHeight(record.style, record.envelope, line.lineHeight)));
    if (preserve) lineHeight = line.lineHeight;
    else if (envelopes.every(record => record.style.lineHeightUnit === 'auto')) lineHeight = ascent + descent + lineGap;
    records.push({ line, parts: recordsForLine, marker, ascent, descent, lineHeight, leading: lineHeight - ascent - descent });
  }
  const firstHalfLeading = records[0].leading / 2; let previous = null; let y = 0;
  const lines = records.map(record => {
    const gap = previous ? Number(record.line.y || 0) - Number(previous.line.y || 0) - Number(previous.line.lineHeight || 0) : Number(record.line.y || 0);
    y += gap;
    const baselineY = previous ? previous.baselineY + previous.descent + gap + record.leading + record.ascent : y + record.ascent + firstHalfLeading;
    const place = source => {
      const baselineOffset = (Number(source.style.textPositionBaselineOffset) || 0) - (Number(source.style.baselineShift) || 0);
      return { ...source.part, baselineOffset, topOffset: baselineY - y + baselineOffset - source.effective.topBaseline,
        textLineMetrics: source.effective };
    };
    const line = { ...record.line, y, lineHeight: record.lineHeight, baselineY,
      ascent: record.ascent, descent: record.descent, leading: record.leading,
      ...(record.line.parts ? { parts: record.parts.map(place) } : { ...place(record.parts[0]), displayText: record.line.displayText }),
      ...(record.marker ? { marker: place(record.marker) } : {}) };
    // The logical line box remains the authored requested height. Negative
    // leading is permitted; large glyph ink is not clipped to that box.
    y += record.lineHeight; previous = { ...record, baselineY }; return line;
  });
  return { ...layout, lines, height: y, textLineMetrics: Object.freeze({ source: metricResolver.provisional ? 'provisional' : 'actual', firstHalfLeading }) };
}
