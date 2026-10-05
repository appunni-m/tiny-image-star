import { prepareTextOutlineGeometry } from './text-outline-geometry.js';
import { findNode, getNodeTextPath } from './model.js';
import { gradientTypes } from './fills.js';
import { strokeStackForNode, strokeSideWidths } from './strokes.js';
import { strokeDashArray } from './stroke-style.js';
import { effectiveStrokeAlignment } from './stroke-alignment.js';
import { booleanGeometry as runBooleanGeometry } from './vector-geometry-runtime.js';
import { normalizeVectorBooleanRequest, validateVectorOutlineResult, vectorGeometryAbortError, VECTOR_GEOMETRY_LIMITS } from './vector-geometry-contract.js';
import { outlinedGeometryToPathGeometry } from './vector-outline-conversion.js';
import { nativePathGeometryForNode } from './vector-shape-geometry.js';

export const BOOLEAN_TEXT_GEOMETRY_LIMITS = Object.freeze({ maxEntries: 256, maxBytes: 8 * 1024 * 1024,
  maxPending: 8, maxKeyCharacters: 2 * 1024 * 1024, timeoutMs: 30_000 });
export class BooleanTextGeometryError extends Error {
  constructor(message, code = 'BOOLEAN_TEXT_UNAVAILABLE') { super(message); this.name = 'BooleanTextGeometryError'; this.code = code; }
}
const contexts = new WeakMap(); const caches = new WeakMap(); const preparedPins = new WeakMap(); const providers = new WeakMap();
const authorityIds = new WeakMap(); let nextAuthorityId = 1;
const authorityId = value => { if (typeof value !== 'function') return 0; if (!authorityIds.has(value)) authorityIds.set(value, nextAuthorityId++); return authorityIds.get(value); };
const identity = () => [1, 0, 0, 1, 0, 0];
const empty = () => ({ fillRule: 'nonzero', fillGroups: [], strokeContours: [], alignedStrokeContours: [] });
const failure = (message, code) => { throw new BooleanTextGeometryError(message, code); };
const abort = signal => { if (signal?.aborted) throw vectorGeometryAbortError(); };
const enabledPaint = paint => paint?.visible !== false && (paint?.type === 'solid'
  ? typeof paint.color === 'string' && paint.color !== 'transparent' : gradientTypes.has(paint?.type) || paint?.type === 'image');
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const optionsFor = (document, options = {}) => ({ ...contexts.get(document)?.options, ...options });
const checkOptions = options => {
  for (const key of ['getFontRevision', 'getTextOutline', 'shapeText', 'assertCurrent', 'resolveNode', 'resolveTextGeometry', 'booleanGeometry']) {
    if (options[key] != null && typeof options[key] !== 'function') throw new TypeError(`Boolean text ${key} must be a function.`);
  }
};
function current(document, node, options) {
  abort(options.signal); options.assertCurrent?.();
  if (!document || typeof document !== 'object' || node?.type !== 'text') failure('A design and an editable text source are required.');
  const { x, y, rotation, affineTransform, effects, effectStyleId, opacity, children, ...local } = node;
  if (local.textPath) local.textPath = getNodeTextPath(document, node);
  const fontRevision = options.getFontRevision?.() ?? null;
  const key = JSON.stringify([local, fontRevision]);
  if (key.length > BOOLEAN_TEXT_GEOMETRY_LIMITS.maxKeyCharacters) failure('The editable Boolean text source exceeds the local snapshot budget.', 'BOOLEAN_TEXT_CACHE_LIMIT');
  return { key, node: { ...node, ...(local.textPath ? { textPath: local.textPath } : {}) } };
}

/** Local typography and current retained-font authority; parent placement is excluded. */
export function booleanTextGeometryKey(document, node, options = {}) {
  const settings = optionsFor(document, options); checkOptions(settings); return current(document, node, settings).key;
}

/** Configure only this design object. Candidate documents receive options explicitly. */
export function configureBooleanTextGeometry(document, options = {}) {
  if (!document || typeof document !== 'object') throw new TypeError('A design object is required.');
  checkOptions(options); const entry = { options: { ...options } }; contexts.set(document, entry);
  return () => { if (contexts.get(document) === entry) { contexts.delete(document); disposeBooleanTextGeometryCache(document); } };
}

function recordingNode(node) {
  const { variableBindings, typographyStyleId, textStyleId, textVariableId, fillVariableId, strokeVariableId, fillStyleId, ...copy } = node;
  const explicit = Array.isArray(node.fills);
  const tag = color => color === 'transparent' ? '#ffffff' : '#000000';
  const decoration = style => style.textDecorationColor && style.textDecorationColor !== 'auto'
    ? { ...style, textDecorationColor: { ...style.textDecorationColor, color: '#000000', opacity: 1 } } : style;
  copy.color = explicit ? '#000000' : tag(node.color);
  copy.fillOpacity = 1; copy.opacity = 1; copy.effects = []; copy.blendMode = 'normal';
  copy.textRuns = node.textRuns?.map(run => decoration({ ...run, color: explicit ? '#000000' : tag(run.color ?? node.color) }));
  return decoration(copy);
}
function aggregate(records) {
  const groups = records.flatMap(record => record.geometry.fillGroups);
  const contours = records.flatMap(record => record.geometry.strokeContours);
  return { fillRule: 'nonzero', fillGroups: groups, strokeContours: contours, alignedStrokeContours: contours };
}
const shapeRegion = (geometry, strokes = [], transform = identity(), includeFill = true) => ({ kind: 'shape', geometry, strokes, transform, includeFill });
const combine = (operation, children) => ({ kind: 'boolean', operation, children, transform: identity(), includeFill: true, strokes: [] });
const intersect = (region, clip) => clip ? combine('intersect', [region, shapeRegion(clip)]) : region;
function metricFor(glyph) {
  const matrix = glyph.strokeTransform || identity();
  if (!Array.isArray(matrix) || matrix.length !== 6 || matrix.some(value => !Number.isFinite(value))) failure('The local glyph has an invalid stroke transform.');
  const [a, b, c, d] = matrix;
  return [a * a + c * c, a * b + c * d, b * b + d * d];
}
const metricMatches = (a, b) => {
  const tolerance = 1e-9 * Math.max(1, ...a.map(Math.abs), ...b.map(Math.abs));
  return a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
};
function metricTransform(metric) {
  const [xx, xy, yy] = metric; const root = Math.sqrt(xx * yy - xy * xy);
  const denominator = Math.sqrt(xx + yy + 2 * root);
  const a = (xx + root) / denominator; const b = xy / denominator; const d = (yy + root) / denominator;
  const determinant = a * d - b * b;
  if (!(denominator > 0) || !(determinant > 1e-12) || ![a, b, d].every(Number.isFinite)) failure('The local glyph has a singular stroke transform.');
  return { matrix: [a, b, b, d, 0, 0], inverse: [d / determinant, -b / determinant, -b / determinant, a / determinant, 0, 0] };
}
function mapGeometry(geometry, matrix) {
  const [a, b, c, d, e, f] = matrix; const point = value => ({ x: a * value.x + c * value.y + e, y: b * value.x + d * value.y + f });
  const contours = values => values.map(contour => ({ ...contour, start: point(contour.start), commands: contour.commands.map(command => ({ ...command,
    start: point(command.start), end: point(command.end), ...(command.control ? { control: point(command.control) } : {}),
    ...(command.control1 ? { control1: point(command.control1), control2: point(command.control2) } : {}) })) }));
  return { ...geometry, fillGroups: geometry.fillGroups.map(group => ({ ...group, contours: contours(group.contours) })),
    strokeContours: contours(geometry.strokeContours), alignedStrokeContours: contours(geometry.alignedStrokeContours) };
}

/** Preserve native Q/C result verbs; rational stroke conics use the audited .01px conversion. */
function resultGeometry(result, width, height) {
  validateVectorOutlineResult(result); let cursor = 0; let contour = null; let position = null; const contours = [];
  const point = () => ({ x: result.commands[cursor++], y: result.commands[cursor++] });
  while (cursor < result.commands.length) {
    const verb = result.commands[cursor++];
    if (verb === 3) return nativePathGeometryForNode({ type: 'path', width: width > 0 ? width : 1, height: height > 0 ? height : 1,
      ...outlinedGeometryToPathGeometry(result, width, height) });
    if (verb === 0) { position = point(); contour = { start: position, closed: false, commands: [] }; contours.push(contour); }
    else if (verb === 5) { contour.closed = true; position = contour.start; }
    else {
      const command = { type: verb === 1 ? 'line' : verb === 2 ? 'quadratic' : 'cubic', start: position };
      if (verb === 2) command.control = point();
      if (verb === 4) { command.control1 = point(); command.control2 = point(); }
      command.end = point(); contour.commands.push(command); position = command.end;
    }
  }
  if (contours.some(value => !value.closed)) failure('The local Boolean text coverage unexpectedly contains an open fill contour.');
  return { fillRule: result.fillRule, fillGroups: contours.length ? [{ fillRule: result.fillRule, contours }] : [], strokeContours: contours, alignedStrokeContours: contours };
}
function coverageRequest(node, outline) {
  if (!outline || !Array.isArray(outline.glyphs) || !Array.isArray(outline.decorations)) failure('The local font provider did not return actual glyph contours.');
  const explicit = Array.isArray(node.fills); const hasFill = explicit && node.fills.some(enabledPaint);
  const enabled = record => record.paint?.visible !== false && record.paint?.color !== '#ffffff';
  const fillRecords = [...outline.glyphs.filter(record => explicit ? hasFill : enabled(record)),
    ...outline.decorations.filter(record => !record.paint?.independent && (explicit ? hasFill : enabled(record)))];
  const parts = [];
  if (fillRecords.length) parts.push(intersect(shapeRegion(aggregate(fillRecords)), explicit ? outline.fillClipGeometry : null));
  const independent = outline.decorations.filter(record => record.paint?.independent && enabled(record));
  if (independent.length) parts.push(shapeRegion(aggregate(independent)));
  const strokes = strokeStackForNode(node).filter(stroke => stroke.visible !== false
    && Math.max(...Object.values(strokeSideWidths(stroke))) > 0 && (stroke.gradient || stroke.color && stroke.color !== 'transparent'));
  if (strokes.length > 32) failure('The editable text exceeds the 32-paint Boolean stroke limit.');
  const metrics = [];
  for (const glyph of outline.glyphs) {
    const metric = metricFor(glyph); let group = metrics.find(value => metricMatches(value.metric, metric));
    if (!group) { group = { metric, glyphs: [] }; metrics.push(group); }
    group.glyphs.push(glyph);
  }
  for (const stroke of strokes) {
    const alignment = effectiveStrokeAlignment(node, stroke);
    const strokeParts = [];
    for (const group of metrics) {
      const transform = metricTransform(group.metric);
      const dash = strokeDashArray(stroke);
      const specification = alignment === 'center' ? { ...stroke, alignment } : { ...stroke, width: stroke.width * 2, alignment: 'center',
        ...(dash.length ? { pattern: 'custom', dashArray: dash } : {}) };
      strokeParts.push(shapeRegion(mapGeometry(aggregate(group.glyphs), transform.inverse), [specification], transform.matrix, false));
    }
    const silhouette = combine('union', strokeParts);
    parts.push(alignment === 'center' ? silhouette : combine(alignment === 'inside' ? 'intersect' : 'subtract',
      [silhouette, shapeRegion(aggregate(outline.glyphs))]));
  }
  const root = intersect(combine('union', parts), outline.clipGeometry);
  return normalizeVectorBooleanRequest({ root });
}
function cacheFor(document) {
  let cache = caches.get(document);
  if (!cache) { cache = { entries: new Map(), jobs: new Map(), bytes: 0 }; caches.set(document, cache); }
  return cache;
}
function retain(cache, key, entry) {
  const size = (key.length + JSON.stringify(entry).length) * 2;
  if (size > BOOLEAN_TEXT_GEOMETRY_LIMITS.maxBytes) failure('The text contours exceed the bounded local Boolean cache.', 'BOOLEAN_TEXT_CACHE_LIMIT');
  const replaced = cache.entries.get(key);
  if (replaced) { cache.entries.delete(key); cache.bytes -= replaced.size; }
  while (cache.entries.size >= BOOLEAN_TEXT_GEOMETRY_LIMITS.maxEntries || cache.bytes + size > BOOLEAN_TEXT_GEOMETRY_LIMITS.maxBytes) {
    const oldest = cache.entries.keys().next().value; const previous = cache.entries.get(oldest); cache.entries.delete(oldest); cache.bytes -= previous.size;
  }
  cache.entries.set(key, { value: entry, size }); cache.bytes += size;
}
function lookup(document, node, options) {
  const source = current(document, node, options); const cache = cacheFor(document); const entry = cache.entries.get(source.key);
  if (entry) { cache.entries.delete(source.key); cache.entries.set(source.key, entry); return entry.value; }
  for (const lookup of providers.get(document) || []) { const value = lookup(source.key); if (value) return value; }
  failure('The actual local glyph geometry for this Boolean text is still being prepared.', 'BOOLEAN_TEXT_PENDING');
}

/** Page owners may pin exact contours beyond the shared LRU, within their own budget. */
export function registerBooleanTextGeometryProvider(document, lookup) {
  if (!document || typeof document !== 'object' || typeof lookup !== 'function') throw new TypeError('A design and a Boolean text geometry lookup are required.');
  let registered = providers.get(document); if (!registered) { registered = new Set(); providers.set(document, registered); }
  if (registered.size >= 8) failure('Too many Boolean text preview owners are active.', 'BOOLEAN_TEXT_PROVIDER_LIMIT');
  registered.add(lookup); const unregister = () => registered.delete(lookup);
  unregister.isRegistered = () => registered.has(lookup); return unregister;
}

/** Source configuration plus a synchronous geometry-only lookup for the native request. */
export function getBooleanTextGeometryOptions(document, options = {}) {
  const settings = optionsFor(document, options); checkOptions(settings);
  return { ...settings, resolveTextGeometry: settings.resolveTextGeometry || (node => lookup(document, node, settings)) };
}
async function produce(document, source, options, signal) {
  const normalized = recordingNode(source.node); const deadline = Date.now() + BOOLEAN_TEXT_GEOMETRY_LIMITS.timeoutMs;
  const check = () => { abort(signal); options.assertCurrent?.(); if (current(document, source.node, options).key !== source.key) failure('The source text or its retained font changed during Boolean preparation.', 'BOOLEAN_TEXT_STALE'); };
  const read = options.getTextOutline ? options.getTextOutline(document, normalized, { signal, assertCurrent: check })
    : typeof options.shapeText === 'function' ? prepareTextOutlineGeometry(document, normalized, { signal, shapeText: options.shapeText, assertCurrent: check })
      : Promise.reject(new BooleanTextGeometryError('Import a local font covering every displayed character before using editable text in a vector Boolean.'));
  let timer; let onAbort;
  try {
    return await Promise.race([(async () => {
      const outline = await read; check(); const request = coverageRequest(source.node, outline);
      const result = await (options.booleanGeometry || runBooleanGeometry)(request, { signal }); check();
      return freeze({ geometry: resultGeometry(result, outline.width, outline.height), coverage: true });
    })(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new BooleanTextGeometryError('Local Boolean text preparation timed out. Try fewer characters.', 'BOOLEAN_TEXT_TIMEOUT')), Math.max(1, deadline - Date.now()));
      onAbort = () => reject(vectorGeometryAbortError()); signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort();
    })]);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
}
function prepareOne(document, node, options) {
  abort(options.signal); const source = current(document, node, options); const cache = cacheFor(document);
  const existing = cache.entries.get(source.key); if (existing) return Promise.resolve(existing.value);
  for (const lookup of providers.get(document) || []) { const value = lookup(source.key); if (value) return Promise.resolve(value); }
  // An operation-owned font session must never outlive its owning operation.
  // Share only identical producer authorities; separate operations can still
  // reuse the completed semantic contour cache.
  const jobKey = JSON.stringify([source.key, ...['getTextOutline', 'shapeText', 'assertCurrent', 'booleanGeometry'].map(key => authorityId(options[key]))]);
  let job = cache.jobs.get(jobKey); let start = false;
  if (!job) {
    if (cache.jobs.size >= BOOLEAN_TEXT_GEOMETRY_LIMITS.maxPending) failure('The local Boolean text preparation queue is full.', 'BOOLEAN_TEXT_QUEUE_FULL');
    job = { controller: new AbortController(), waiters: new Set() }; cache.jobs.set(jobKey, job); start = true;
  }
  const finish = (waiter, error, value) => {
    if (!job.waiters.delete(waiter)) return; waiter.signal?.removeEventListener('abort', waiter.abort);
    if (error) waiter.reject(error); else { try { if (current(document, waiter.node, waiter.options).key !== source.key) failure('The Boolean text source changed before its contours were ready.', 'BOOLEAN_TEXT_STALE'); waiter.resolve(value); } catch (failure) { waiter.reject(failure); } }
  };
  job.cancel ||= () => {
    if (cache.jobs.get(jobKey) === job) cache.jobs.delete(jobKey);
    job.controller.abort(); for (const waiter of [...job.waiters]) finish(waiter, vectorGeometryAbortError());
  };
  const promise = new Promise((resolve, reject) => {
    const waiter = { resolve, reject, node, options, signal: options.signal };
    waiter.abort = () => { finish(waiter, vectorGeometryAbortError()); if (!job.waiters.size) { if (cache.jobs.get(jobKey) === job) cache.jobs.delete(jobKey); job.controller.abort(); } };
    job.waiters.add(waiter); options.signal?.addEventListener('abort', waiter.abort, { once: true }); if (options.signal?.aborted) waiter.abort();
  });
  if (start && cache.jobs.get(jobKey) === job) void (async () => {
    try {
      const value = await produce(document, source, { ...options, signal: job.controller.signal }, job.controller.signal);
      if (cache.jobs.get(jobKey) !== job || job.controller.signal.aborted) return;
      retain(cache, source.key, value); cache.jobs.delete(jobKey); for (const waiter of [...job.waiters]) finish(waiter, null, value);
    } catch (error) {
      if (cache.jobs.get(jobKey) !== job) return;
      cache.jobs.delete(jobKey); job.controller.abort(); for (const waiter of [...job.waiters]) finish(waiter, error);
    }
  })();
  return promise;
}

function textSources(document, roots, settings) {
  abort(settings.signal); settings.assertCurrent?.();
  const stack = (Array.isArray(roots) ? roots : [roots]).map(node => ({ node, depth: 0 })); const seen = new Set(); const text = [];
  while (stack.length) {
    const { node, depth } = stack.pop(); abort(settings.signal);
    if (!node || typeof node !== 'object' || depth > VECTOR_GEOMETRY_LIMITS.maxInputDepth) failure('The Boolean source tree exceeds the bounded text-preparation depth.');
    if (seen.has(node)) failure('The Boolean text source tree contains duplicate or cyclic source objects.');
    seen.add(node); if (seen.size > VECTOR_GEOMETRY_LIMITS.maxInputNodes) failure('The Boolean source tree exceeds the bounded text-preparation limit.');
    const resolved = settings.resolveNode?.(node) ?? node;
    if (resolved.visible === false) continue;
    if (resolved.type === 'text') text.push({ source: node, resolved,
      attached: Boolean(node.id && findNode(document, node.id)), key: current(document, resolved, settings).key });
    else for (const child of resolved.children || []) stack.push({ node: child, depth: depth + 1 });
  }
  return text;
}
function retainPin(pins, key, value, bytes) {
  if (!pins.has(key)) { bytes += (key.length + JSON.stringify(value).length) * 2; pins.set(key, value); }
  if (bytes > BOOLEAN_TEXT_GEOMETRY_LIMITS.maxBytes) failure('These text operands exceed the bounded Boolean contour budget. Combine fewer text sources.', 'BOOLEAN_TEXT_CACHE_LIMIT');
  return bytes;
}
function completePins(document, text, pins, pinBytes, settings) {
  const validateCurrent = () => {
    abort(settings.signal); settings.assertCurrent?.();
    for (const record of text) {
      const found = record.source.id ? findNode(document, record.source.id)?.node : null;
      if (record.attached && !found) failure('The prepared Boolean text source was removed from its design.', 'BOOLEAN_TEXT_STALE');
      const live = found || record.source;
      const resolved = settings.resolveNode?.(live) ?? live;
      if (current(document, resolved, settings).key !== record.key) failure('The text or its retained font changed before the Boolean geometry could be used.', 'BOOLEAN_TEXT_STALE');
    }
  };
  validateCurrent();
  const resolveTextGeometry = node => {
    abort(settings.signal); settings.assertCurrent?.();
    const key = current(document, node, settings).key; const value = pins.get(key);
    if (!value) failure('The pinned Boolean glyph geometry does not match this text source or its current font.', 'BOOLEAN_TEXT_STALE');
    return value;
  };
  const result = Object.freeze({ resolveTextGeometry, validateCurrent, geometryForKey: key => pins.get(key), bytes: pinBytes });
  preparedPins.set(result, { text, pins, settings }); return result;
}

/** Capture complete ready pins; getters never depend on later shared-cache retention. */
export async function prepareBooleanTextGeometry(document, roots, options = {}) {
  const settings = optionsFor(document, options); checkOptions(settings);
  const text = textSources(document, roots, settings); const pins = new Map(); let pinBytes = 0;
  for (const record of text) pinBytes = retainPin(pins, record.key, await prepareOne(document, record.resolved, settings), pinBytes);
  return completePins(document, text, pins, pinBytes, settings);
}

/** Pin already-ready text without opening a font session or starting native work. */
export function captureBooleanTextGeometry(document, roots, options = {}) {
  const settings = optionsFor(document, options); checkOptions(settings);
  const text = textSources(document, roots, settings); const pins = new Map(); let pinBytes = 0;
  for (const record of text) {
    const value = settings.resolveTextGeometry ? settings.resolveTextGeometry(record.resolved) : lookup(document, record.resolved, settings);
    pinBytes = retainPin(pins, record.key, value, pinBytes);
  }
  return completePins(document, text, pins, pinBytes, settings);
}

/** Adopt prepared contours into a current candidate/live design after semantic revalidation. */
export function adoptBooleanTextGeometry(document, prepared, options = {}) {
  const record = preparedPins.get(prepared);
  if (!record) failure('Only verified prepared Boolean text pins can be adopted.');
  prepared.validateCurrent(); const settings = optionsFor(document, options); checkOptions(settings);
  const pending = [];
  for (const text of record.text) {
    const live = text.source.id ? findNode(document, text.source.id)?.node : text.source;
    if (!live) failure('A prepared Boolean text source no longer exists.', 'BOOLEAN_TEXT_STALE');
    const resolved = settings.resolveNode?.(live) ?? live;
    if (current(document, resolved, settings).key !== text.key) failure('The prepared Boolean text does not match the destination design or its font authority.', 'BOOLEAN_TEXT_STALE');
    pending.push([text.key, record.pins.get(text.key)]);
  }
  const cache = cacheFor(document); for (const [key, value] of pending) retain(cache, key, value);
}

/** Release shared contours/jobs without invalidating independent prepared pins. */
export function disposeBooleanTextGeometryCache(document) {
  const cache = caches.get(document); if (!cache) return;
  caches.delete(document); cache.entries.clear(); cache.bytes = 0;
  for (const job of [...cache.jobs.values()]) job.cancel(); cache.jobs.clear();
}

export function booleanTextGeometryCacheStats(document) {
  const cache = caches.get(document); return Object.freeze({ entries: cache?.entries.size || 0, bytes: cache?.bytes || 0, pending: cache?.jobs.size || 0 });
}
