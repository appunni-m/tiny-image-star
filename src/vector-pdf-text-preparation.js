import { TextOutlineFontSession, TEXT_OUTLINE_FONT_LIMITS } from './text-outline-font-session.js';
import { withPreparedTextPositionShapes, TEXT_POSITION_EXPORT_LIMITS } from './text-position-export-preparation.js';
import { localFontsForStyle } from './local-font-style.js';
import { canvasFontWeight, MAX_FONT_VARIATION_AXES, MAX_FONT_VARIATION_VALUE, isValidFontVariationValues } from './font-variation.js';
import { isValidFontFeatureValues } from './font-features.js';

export const VECTOR_PDF_TEXT_LIMITS = Object.freeze({
  maxQueries: TEXT_POSITION_EXPORT_LIMITS.maxQueries, maxBytes: TEXT_POSITION_EXPORT_LIMITS.maxBytes,
  maxPending: TEXT_OUTLINE_FONT_LIMITS.maxPending, maxFontRecords: 2048, maxFontMetadataBytes: 1024 * 1024,
  deadlineMs: TEXT_POSITION_EXPORT_LIMITS.deadlineMs, maxDeadlineMs: 60_000, cleanupGraceMs: 50
});
const sorted = value => Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b));
const keyFor = (text, style, metrics) => JSON.stringify([metrics ? 'metrics' : 'glyphs', text,
  style?.fontFamily || 'Arial, sans-serif', Number(style?.fontSize) || 24,
  canvasFontWeight(style?.fontWeight, style?.fontAxes), style?.fontStyle || 'normal', sorted(style?.fontAxes),
  ...(metrics ? [] : [sorted(style?.fontFeatures)])]);
const abortError = signal => signal?.reason instanceof Error ? signal.reason : new DOMException('Vector PDF text export cancelled.', 'AbortError');
const timeoutError = () => Object.assign(new Error('Local vector PDF text preparation timed out. Export fewer text layers or retry with smaller fonts.'),
  { code: 'VECTOR_PDF_TEXT_TIMEOUT' });
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

function shapingStyleSnapshot(style) {
  const fontFamily = style?.fontFamily || 'Arial, sans-serif';
  const fontSize = Number(style?.fontSize) || 24;
  const fontStyle = style?.fontStyle || 'normal';
  if (typeof fontFamily !== 'string' || fontFamily.length > 160 || /[\x00-\x1f]/u.test(fontFamily)
    || !Number.isFinite(fontSize) || fontSize <= 0 || !['normal', 'italic'].includes(fontStyle)) {
    throw new TypeError('Vector PDF text has invalid shaping style fields.');
  }
  const map = (value, valid) => {
    if (value == null) return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Vector PDF text has invalid shaping style maps.');
    if (Object.keys(value).length && !valid(value)) throw new TypeError('Vector PDF text has invalid shaping style maps.');
    return { ...value };
  };
  const fontAxes = map(style?.fontAxes, isValidFontVariationValues);
  const fontFeatures = map(style?.fontFeatures, isValidFontFeatureValues);
  const fontWeight = canvasFontWeight(style?.fontWeight, fontAxes);
  if (!Number.isFinite(fontWeight)) throw new TypeError('Vector PDF text has invalid shaping style fields.');
  return freeze({ fontFamily, fontSize, fontWeight, fontStyle,
    ...(fontAxes ? { fontAxes } : {}), ...(fontFeatures ? { fontFeatures } : {}) });
}

function fontSnapshot(fonts) {
  if (!Array.isArray(fonts) || fonts.length > VECTOR_PDF_TEXT_LIMITS.maxFontRecords) throw new TypeError('Vector PDF text needs a bounded local font catalog.');
  const ids = new Set();
  const records = fonts.map(font => {
    if (!font || typeof font !== 'object' || typeof font.id !== 'string' || !font.id || font.id.length > 180
      || ids.has(font.id) || typeof font.family !== 'string' || !font.family.trim() || font.family.length > 120
      || typeof font.name !== 'string' || !font.name || font.name.length > 255
      || !Number.isInteger(font.weight) || font.weight < 1 || font.weight > 1000
      || !['normal', 'italic'].includes(font.style)) throw new TypeError('Vector PDF text has invalid or duplicate local font metadata.');
    ids.add(font.id);
    const axes = font.axes || [];
    if (!Array.isArray(axes) || axes.length > MAX_FONT_VARIATION_AXES) throw new TypeError('Vector PDF text has invalid local font variation axes.');
    const tags = new Set();
    for (const axis of axes) {
      if (!axis || !/^[\x20-\x7e]{4}$/u.test(axis.tag) || tags.has(axis.tag)
        || ![axis.min, axis.defaultValue, axis.max].every(Number.isFinite)
        || axis.min > axis.defaultValue || axis.defaultValue > axis.max
        || Math.abs(axis.min) > MAX_FONT_VARIATION_VALUE || Math.abs(axis.max) > MAX_FONT_VARIATION_VALUE) {
        throw new TypeError('Vector PDF text has invalid local font variation axes.');
      }
      tags.add(axis.tag);
    }
    return { id: font.id, name: font.name, family: font.family, weight: font.weight, style: font.style, type: font.type,
      ...(font.axes ? { axes: axes.map(({ tag, min, defaultValue, max }) => ({ tag, min, defaultValue, max })) } : {}) };
  });
  if (JSON.stringify(records).length * 2 > VECTOR_PDF_TEXT_LIMITS.maxFontMetadataBytes) throw new RangeError('Vector PDF text exceeds the local font metadata budget.');
  return freeze(records);
}

function shapeBytes(value, maxBytes) {
  let glyphs = 0; let runs = 0; let strings = 0;
  const visit = (shape, depth) => {
    if (!shape || depth > 16) throw new RangeError('Vector PDF text exceeds the bounded glyph snapshot budget.');
    if (Array.isArray(shape.mixedRuns)) {
      for (const run of shape.mixedRuns) {
        if (++runs > 2048) throw new RangeError('Vector PDF text exceeds the bounded glyph snapshot budget.');
        strings += String(run.text || '').length * 2; visit(run.shaped, depth + 1);
      }
    } else for (const glyph of shape.glyphs || []) {
      if (++glyphs > 65536) throw new RangeError('Vector PDF text exceeds the bounded glyph snapshot budget.');
      strings += (glyph.path?.length || 0) * 2;
      if (strings > maxBytes) throw new RangeError('Vector PDF text exceeds the bounded glyph snapshot budget.');
    }
    if (strings > maxBytes) throw new RangeError('Vector PDF text exceeds the bounded glyph snapshot budget.');
  };
  visit(value, 0);
  const bytes = JSON.stringify(value).length * 2;
  if (bytes > maxBytes) throw new RangeError('Vector PDF text exceeds the bounded glyph snapshot budget.');
  return bytes;
}
function primaryMetrics(shape) {
  const value = shape?.primaryFontMetrics || shape;
  if (!(value?.upem > 0) || !['ascender', 'descender', 'lineGap'].every(key => Number.isFinite(value.extents?.[key]))) {
    throw new Error('The retained local font cannot supply actual vector PDF line metrics.');
  }
  return { upem: value.upem, extents: { ...value.extents },
    ...(value.leadingTrimMetrics ? { leadingTrimMetrics: { ...value.leadingTrimMetrics } } : {}) };
}

/**
 * Own local font workers for one PDF operation. The existing export preparer
 * owns the only retained glyph snapshot cache; this adapter only hands off
 * completed asynchronous answers and releases them as soon as they are read.
 * Limits: eight pending handoffs, 2,048 pinned queries / 8 MiB, and the font
 * session's 32 files / 64 MiB. The operation expires after 15 seconds by
 * default (at most 60 seconds), with at most 50 ms for cancellation cleanup.
 * The caller supplies a live source/font/workspace guard via assertCurrent;
 * font metadata and the session's decoded file snapshots are immutable.
 */
export async function withPreparedVectorPdfText(generate, {
  fonts = [], readFont, signal, assertCurrent = () => {},
  sessionFactory = options => new TextOutlineFontSession(options),
  maxQueries = VECTOR_PDF_TEXT_LIMITS.maxQueries, maxBytes = VECTOR_PDF_TEXT_LIMITS.maxBytes,
  deadlineMs = VECTOR_PDF_TEXT_LIMITS.deadlineMs, pollMs = 1
} = {}) {
  if (typeof generate !== 'function' || typeof assertCurrent !== 'function' || typeof sessionFactory !== 'function'
    || readFont != null && typeof readFont !== 'function'
    || !Number.isSafeInteger(maxQueries) || maxQueries < 1 || maxQueries > VECTOR_PDF_TEXT_LIMITS.maxQueries
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > VECTOR_PDF_TEXT_LIMITS.maxBytes
    || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > VECTOR_PDF_TEXT_LIMITS.maxDeadlineMs
    || !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 1000) throw new TypeError('The vector PDF text preparation options are invalid.');
  const expires = Date.now() + deadlineMs;
  const capturedFonts = fontSnapshot(fonts); const controller = new AbortController();
  const cancel = () => controller.abort(abortError(signal));
  signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
  let session = null; let closed = false; let bytes = 0; let failure = null;
  const handoffs = new Map(); const jobs = new Set();
  const check = () => {
    if (controller.signal.aborted) throw abortError(controller.signal);
    if (closed) throw new Error('The vector PDF text operation is closed.');
    if (failure) throw failure;
    if (assertCurrent() === false) throw new Error('The design or its fonts changed while preparing vector PDF text. Retry the export.');
    // Synchronous layout/serialization can postpone timer callbacks. Fence
    // resumed queries and publication against elapsed wall time as well.
    if (Date.now() >= expires) throw timeoutError();
  };
  const status = style => { check(); return localFontsForStyle(style, capturedFonts).length ? 'ready' : 'none'; };
  const read = (text, style, metrics = false) => {
    check(); if (status(style) === 'none') return null;
    const queryStyle = shapingStyleSnapshot(style);
    const key = keyFor(text, queryStyle, metrics); const existing = handoffs.get(key);
    if (existing?.value) {
      handoffs.delete(key); bytes -= existing.bytes; return existing.value;
    }
    if (existing) return null;
    if (handoffs.size >= VECTOR_PDF_TEXT_LIMITS.maxPending) throw new Error('The local vector PDF font queue is full. Wait for shaping to finish, then retry.');
    if (bytes + key.length * 2 > maxBytes) throw new RangeError('Vector PDF text exceeds the bounded shaping handoff budget.');
    if (!session) {
      if (typeof readFont !== 'function') throw new Error('Vector PDF text needs a reader for its retained local font files.');
      session = sessionFactory({ fonts: capturedFonts, readFont, signal: controller.signal, assertCurrent: check });
      if (typeof session?.shapeText !== 'function' || typeof session?.close !== 'function') throw new TypeError('The vector PDF font session is invalid.');
    }
    const entry = { bytes: key.length * 2 }; handoffs.set(key, entry); bytes += entry.bytes;
    // Observe every rejection even if cancellation closes the export before
    // the native worker settles. A failed retained font never falls back.
    const job = Promise.resolve().then(() => { check(); return session.shapeText(metrics ? '' : text, queryStyle); }).then(result => {
      check(); const value = metrics ? primaryMetrics(result) : result;
      const size = shapeBytes(value, maxBytes - bytes);
      entry.value = freeze(value); entry.bytes += size; bytes += size;
    }).catch(error => { if (!closed && !controller.signal.aborted) failure = error; }).finally(() => jobs.delete(job));
    jobs.add(job);
    return null;
  };
  const shaper = (text, style) => read(text, style);
  shaper.fontStatus = status; shaper.fontMetricsStatus = status;
  shaper.fontMetrics = style => read('', style, true);
  let rejectDeadline; let timer; const stop = new Promise((_, reject) => { rejectDeadline = reject; });
  const onAbort = () => rejectDeadline(abortError(controller.signal));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  try {
    check(); timer = setTimeout(() => {
      controller.abort(timeoutError());
    }, Math.max(1, expires - Date.now()));
    // Reject an unresponsive asynchronous generator inside the shared pin
    // owner too, so its snapshot maps drain when the operation is cancelled.
    const work = withPreparedTextPositionShapes(pinned => Promise.race([
      Promise.resolve().then(() => { check(); return generate(pinned); }), stop
    ]), {
      shapeText: shaper, assertCurrent: check, signal: controller.signal, maxQueries, maxBytes,
      deadlineMs: deadlineMs + pollMs + 1, pollMs
    });
    const result = await Promise.race([work, stop]); check(); return result;
  } finally {
    closed = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort); controller.abort();
    session?.close?.(); handoffs.clear(); bytes = 0;
    // Production sessions reject pending reads/shapes immediately on close.
    // A bounded grace also permits those queued promise continuations to drain
    // before returning, without trusting an injected reader to cooperate.
    if (jobs.size) {
      let cleanupTimer;
      try { await Promise.race([Promise.allSettled([...jobs]), new Promise(resolve => {
        cleanupTimer = setTimeout(resolve, VECTOR_PDF_TEXT_LIMITS.cleanupGraceMs);
      })]); } finally { clearTimeout(cleanupTimer); jobs.clear(); }
    }
  }
}
