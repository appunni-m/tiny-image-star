import { canvasFontWeight } from './font-variation.js';
import { TextPositionPendingError } from './text-position.js';

export const TEXT_POSITION_EXPORT_LIMITS = Object.freeze({ maxQueries: 2048, maxBytes: 8 * 1024 * 1024, deadlineMs: 15000 });
const sorted = value => Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b));
const keyFor = (text, style, features = true) => JSON.stringify([text, style.fontFamily || 'Arial, sans-serif',
  Number(style.fontSize) || 24, canvasFontWeight(style.fontWeight, style.fontAxes), style.fontStyle || 'normal', sorted(style.fontAxes),
  ...(features ? [sorted(style.fontFeatures)] : [])]);
const abort = signal => { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Text export cancelled.', 'AbortError'); };

function boundedShapeBytes(shape, maxBytes) {
  let glyphs = 0; let runs = 0; let stringBytes = 0;
  const visit = (value, depth = 0) => {
    if (!value || depth > 16) throw new RangeError('Text export exceeds the bounded glyph snapshot budget.');
    if (Array.isArray(value.mixedRuns)) {
      for (const run of value.mixedRuns) {
        if (++runs > 2048) throw new RangeError('Text export exceeds the bounded glyph snapshot budget.');
        stringBytes += String(run.text || '').length * 2;
        if (run.shaped) visit(run.shaped, depth + 1);
      }
    } else {
      for (const glyph of value.glyphs || []) {
        if (++glyphs > 65536) throw new RangeError('Text export exceeds the bounded glyph snapshot budget.');
        stringBytes += (glyph.path?.length || 0) * 2;
        if (stringBytes > maxBytes) throw new RangeError('Text export exceeds the bounded glyph snapshot budget.');
      }
    }
    if (stringBytes > maxBytes) throw new RangeError('Text export exceeds the bounded glyph snapshot budget.');
  };
  visit(shape);
  const bytes = JSON.stringify(shape).length * 2;
  if (bytes > maxBytes) throw new RangeError('Text export exceeds the bounded glyph snapshot budget.');
  return bytes;
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); try { abort(signal); } catch (error) { reject(error); } };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}

/** Retry the actual export, pinning glyph answers independently of preview LRU eviction. */
export async function withPreparedTextPositionShapes(generate, {
  shapeText, enabled = true, assertCurrent = () => {}, signal,
  maxQueries = TEXT_POSITION_EXPORT_LIMITS.maxQueries, maxBytes = TEXT_POSITION_EXPORT_LIMITS.maxBytes,
  deadlineMs = TEXT_POSITION_EXPORT_LIMITS.deadlineMs, pollMs = 20
} = {}) {
  if (typeof generate !== 'function' || typeof assertCurrent !== 'function'
    || ![maxQueries, maxBytes, deadlineMs, pollMs].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError('The text export preparation options are invalid.');
  }
  abort(signal); assertCurrent();
  if (!enabled || typeof shapeText !== 'function') return generate(shapeText);
  const queries = new Map(); const statuses = new Map(); let bytes = 0;
  const reserve = (map, key, value) => {
    if (map.has(key)) return;
    if (map.size >= maxQueries || bytes + key.length * 2 > maxBytes) {
      throw new RangeError('Text export exceeds the bounded shaping snapshot budget.');
    }
    bytes += key.length * 2; map.set(key, value);
  };
  const fontStatus = (style, text) => {
    const key = keyFor(text, style, false);
    if (statuses.get(key) === 'ready') return 'ready';
    const status = shapeText.fontStatus?.(style, text) ?? 'ready';
    if (status === 'none' && statuses.get(key) === 'pending') throw new Error('The local font became unavailable while preparing this export. Check its font file and retry.');
    if (status !== 'none') { reserve(statuses, key, status); statuses.set(key, status); }
    return status;
  };
  const pinned = (text, style) => {
    abort(signal);
    const key = keyFor(text, style);
    reserve(queries, key, null);
    const cached = queries.get(key);
    if (cached) return structuredClone(cached);
    const result = shapeText(text, style);
    if (!result) {
      if (fontStatus(style, text) !== 'none') throw new TextPositionPendingError();
      return null;
    }
    const size = boundedShapeBytes(result, maxBytes - bytes);
    bytes += size; queries.set(key, structuredClone(result));
    const statusKey = keyFor(text, style, false);
    reserve(statuses, statusKey, 'ready'); statuses.set(statusKey, 'ready');
    return structuredClone(result);
  };
  pinned.fontStatus = fontStatus;
  Object.defineProperty(pinned, 'isPreparedTextExport', { value: true });
  const expires = Date.now() + deadlineMs;
  try {
    for (;;) {
      abort(signal); assertCurrent();
      try {
        const result = await generate(pinned);
        abort(signal); assertCurrent();
        return result;
      } catch (error) {
        if (!['TEXT_POSITION_PENDING', 'TEXT_LEADING_TRIM_PENDING'].includes(error?.code)) throw error;
        if (Date.now() >= expires) throw new Error('The local font could not finish preparing this export. Check its font file and retry.');
        await pause(Math.min(pollMs, Math.max(1, expires - Date.now())), signal);
      }
    }
  } finally { queries.clear(); statuses.clear(); }
}
