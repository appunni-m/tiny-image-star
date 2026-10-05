import { booleanSourceTransform } from './boolean-geometry.js';
import { fillStackForNode, gradientTypes } from './fills.js';
import { strokeStackForNode, strokeSideWidths } from './strokes.js';
import { effectiveStrokeAlignment } from './stroke-alignment.js';
import { multiplyAffine, nodeToParentTransform } from './transform-geometry.js';
import { nativePathGeometryForNode } from './vector-shape-geometry.js';
import { booleanGeometry as runBooleanGeometry } from './vector-geometry-runtime.js';
import { normalizeVectorBooleanRequest, validateVectorOutlineResult, vectorGeometryAbortError, VECTOR_GEOMETRY_LIMITS } from './vector-geometry-contract.js';
import { outlinedGeometryToPathGeometry } from './vector-outline-conversion.js';

export const BOOLEAN_VECTOR_CACHE_LIMITS = Object.freeze({ maxEntries: 256, maxBytes: 8 * 1024 * 1024, maxKeyCharacters: 2 * 1024 * 1024, maxPending: 8 });

export class BooleanVectorGeometryError extends Error {
  constructor(reason, code = 'UNSUPPORTED_BOOLEAN_VECTOR_GEOMETRY') {
    super(reason); this.name = 'BooleanVectorGeometryError'; this.code = code;
  }
}

const vectorTypes = new Set(['rectangle', 'ellipse', 'star', 'polygon', 'path', 'line', 'network', 'text']);
const identity = () => [1, 0, 0, 1, 0, 0];
const matrixValues = matrix => [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
const emptyGeometry = () => ({ fillRule: 'nonzero', fillGroups: [], strokeContours: [], alignedStrokeContours: [] });
const fail = (node, reason) => { throw new BooleanVectorGeometryError(`Cannot construct the Boolean vector geometry: “${node?.name || node?.type || 'Unknown layer'}” ${reason}`); };
const abort = signal => { if (signal?.aborted) throw vectorGeometryAbortError(); };

function resolve(source, resolveNode) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail(source, 'has no readable source node.');
  const node = resolveNode(source);
  if (!node || typeof node !== 'object' || Array.isArray(node)) fail(source, 'could not resolve its current source properties.');
  return node;
}

// Vector Boolean operands are authored coverage, not alpha masks. Even a zero
// opacity paint has geometry. The explicit transparent solid sentinel has no
// paint; gradients and image fills keep their shape regardless of pixel alpha.
function paintEnabled(paint) {
  if (!paint || paint.visible === false) return false;
  if (paint.type === 'solid') return typeof paint.color === 'string' && paint.color !== 'transparent';
  return gradientTypes.has(paint.type) || paint.type === 'image';
}

function fillEnabled(node) { return fillStackForNode(node).some(paintEnabled); }

function faceFillEnabled(node, face) {
  const fills = fillStackForNode(node);
  if (!Array.isArray(node.fills)) {
    if (node.imageFill) return true;
    // Legacy network gradients yield to a face's explicit solid paint.
    if (face.fill != null) return face.fill !== 'transparent';
    return fills.some(paintEnabled);
  }
  return fills.some((paint, index) => paintEnabled(index === 0 && paint.type === 'solid' && face.fill != null
    ? { ...paint, color: face.fill } : paint));
}

function enabledStrokes(node) {
  if (Array.isArray(node.strokes) && node.strokes.length > 32) fail(node, 'exceeds the 32-paint source stroke limit.');
  return strokeStackForNode(node).filter(stroke => stroke.visible !== false
    && Math.max(...Object.values(strokeSideWidths(stroke))) > 0
    && (stroke.gradient || stroke.color && stroke.color !== 'transparent')).map(stroke => {
    if (![undefined, 'none'].includes(stroke.startDecoration) || ![undefined, 'none'].includes(stroke.endDecoration)) {
      fail(node, 'has stroke endpoint decorations; remove those decorations before using a vector Boolean.');
    }
    if (stroke.pattern === 'custom' && (!Array.isArray(stroke.dashArray) || stroke.dashArray.length !== 2
      || stroke.dashArray[1] === 0)) fail(node, 'uses a custom stroke dash pattern that the local vector engine cannot yet outline. Use one dash and one positive gap.');
    const result = { width: stroke.width, alignment: effectiveStrokeAlignment(node, stroke) };
    for (const property of ['cap', 'join', 'pattern', 'miterLimit', 'sideMode', 'startDecoration', 'endDecoration']) {
      if (Object.hasOwn(stroke, property)) result[property] = stroke[property];
    }
    if (stroke.sideWidths) result.sideWidths = { ...stroke.sideWidths };
    if (stroke.dashArray) result.dashArray = [...stroke.dashArray];
    return result;
  });
}

function countSourceItems(node, state) {
  const count = value => {
    if (value == null) return;
    if (!Array.isArray(value)) fail(node, 'has malformed source geometry arrays.');
    state.items += value.length;
    if (state.items > VECTOR_GEOMETRY_LIMITS.maxInputCommands) fail(node, 'exceeds the bounded aggregate source-geometry limit.');
  };
  // Primitive point counts are scalar settings; explicit path/network arrays
  // must be admitted before allocating native recorder commands for any leaf.
  if (Array.isArray(node.points)) count(node.points);
  if (node.subpaths != null) { count(node.subpaths); for (const contour of node.subpaths) count(contour?.points); }
  count(node.vertices); count(node.edges);
  if (node.faces != null) { count(node.faces); for (const face of node.faces) count(face?.vertexIds); }
}

function snapshot(node, { resolveNode = value => value, resolveTextGeometry } = {}) {
  if (typeof resolveNode !== 'function' || resolveTextGeometry != null && typeof resolveTextGeometry !== 'function') throw new TypeError('Boolean geometry resolvers must be functions.');
  if (node?.type !== 'boolean') fail(node, 'is not a Boolean group.');
  const state = { nodes: 0, items: 0, ancestors: new Set(), resolvedAncestors: new Set() };
  let resolvedRoot;
  const visit = (source, resolved, depth, root = false) => {
    if (depth > VECTOR_GEOMETRY_LIMITS.maxInputDepth || ++state.nodes > VECTOR_GEOMETRY_LIMITS.maxInputNodes) fail(resolved, 'exceeds the bounded source-tree limit.');
    if (state.ancestors.has(source) || state.resolvedAncestors.has(resolved)) fail(resolved, 'contains a cyclic source tree.');
    state.ancestors.add(source); state.resolvedAncestors.add(resolved);
    if (!root && resolved.visible === false) {
      state.ancestors.delete(source); state.resolvedAncestors.delete(resolved);
      return { kind: 'shape', transform: identity(), geometry: emptyGeometry(), includeFill: false, strokes: [] };
    }
    let region;
    if (resolved.type === 'boolean') {
      if (!Array.isArray(resolved.children) || resolved.children.length > VECTOR_GEOMETRY_LIMITS.maxInputNodes - state.nodes) fail(resolved, 'exceeds the bounded Boolean source-array limit.');
      const sources = resolved.children;
      const children = sources.map(child => resolve(child, resolveNode));
      const basis = booleanSourceTransform(children, resolved.width, resolved.height);
      const matrix = { a: basis.scaleX, b: 0, c: 0, d: basis.scaleY, e: -basis.left * basis.scaleX, f: -basis.top * basis.scaleY };
      region = { kind: 'boolean', transform: identity(), operation: resolved.operation || 'union',
        includeFill: root || fillEnabled(resolved), strokes: root ? [] : enabledStrokes(resolved),
        children: children.map((child, index) => {
          const content = visit(sources[index], child, depth + 1);
          content.transform = matrixValues(multiplyAffine(matrix, nodeToParentTransform(child)));
          return content;
        }) };
      if (root) resolvedRoot = resolved;
    } else {
      if (!vectorTypes.has(resolved.type)) fail(resolved, `is a ${resolved.type || 'missing type'} source; vector Booleans require vector shapes, paths, networks, or nested Booleans.`);
      if (resolved.children?.length) fail(resolved, 'contains descendants that cannot be represented by one vector source.');
      countSourceItems(resolved, state);
      let geometry;
      if (resolved.type === 'text') {
        if (!resolveTextGeometry) fail(resolved, 'needs resolved glyph contours before it can participate in a vector Boolean. Existing alpha-mask text Booleans remain available.');
        geometry = resolveTextGeometry(resolved);
        if (!geometry || typeof geometry.then === 'function') fail(resolved, 'needs synchronous, current glyph contours.');
      } else geometry = nativePathGeometryForNode(resolved);
      let fillGroupIndices;
      if (resolved.type === 'network') {
        // Aligned strokes still clip against every geometric face boundary,
        // even when a face has no paint. Select painted faces independently.
        fillGroupIndices = geometry.fillGroups.flatMap((group, index) => faceFillEnabled(resolved, resolved.faces[index]) ? [index] : []);
      }
      const preparedTextCoverage = resolved.type === 'text' && geometry.coverage === true;
      if (preparedTextCoverage) geometry = geometry.geometry;
      region = { kind: 'shape', transform: identity(), geometry, includeFill: preparedTextCoverage || (resolved.type === 'network'
        ? fillGroupIndices.length > 0 : fillEnabled(resolved)), strokes: preparedTextCoverage ? [] : enabledStrokes(resolved),
        ...(fillGroupIndices ? { fillGroupIndices } : {}) };
    }
    state.ancestors.delete(source); state.resolvedAncestors.delete(resolved);
    return region;
  };
  const root = resolve(node, resolveNode);
  if (root.type !== 'boolean') fail(root, 'did not resolve to a Boolean group.');
  if (!Number.isFinite(root.width) || !Number.isFinite(root.height) || root.width < 0 || root.height < 0) fail(root, 'needs finite nonnegative dimensions.');
  const request = normalizeVectorBooleanRequest({ root: visit(node, root, 0, true) });
  const key = JSON.stringify([root.width, root.height, request]);
  if (key.length > BOOLEAN_VECTOR_CACHE_LIMITS.maxKeyCharacters) fail(root, 'exceeds the bounded geometry-key size.');
  return { key, request, resolved: resolvedRoot, width: root.width, height: root.height };
}

/** Geometry-only bounded worker request; identities, assets and paints are not transferred. */
export function buildBooleanVectorRequest(node, options) { return snapshot(node, options).request; }

/** Content key intentionally excludes root paints and root-to-parent placement. */
export function booleanVectorGeometryKey(node, options) { return snapshot(node, options).key; }

function freezeGeometry(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freezeGeometry(item); Object.freeze(value); }
  return value;
}

function paintPath(resolved, entry) {
  // Root source children are deliberately omitted before cloning: they are
  // neither result geometry nor paint authority and may contain large graphs.
  const { children, ...own } = resolved;
  return { ...structuredClone(own), ...structuredClone(entry.geometry), type: 'path', children: [],
    __booleanGeometryBounds: { ...entry.bounds } };
}

const pendingError = () => new BooleanVectorGeometryError('The local Boolean vector geometry is still being prepared.', 'BOOLEAN_VECTOR_PENDING');
const closedError = () => new BooleanVectorGeometryError('The Boolean vector geometry cache is closed.', 'BOOLEAN_VECTOR_CLOSED');
const staleError = () => new BooleanVectorGeometryError('A Boolean source changed while its geometry was being prepared. Prepare its current sources again.', 'BOOLEAN_VECTOR_STALE');

/**
 * Bounded geometry-only cache with independent cancellation for every waiter.
 * A renderer and export can share a request: aborting one cannot cancel the
 * other's work. Cancelled jobs never leave a failed entry. Failed worker jobs
 * require explicit retry:true; source edits naturally create a different key.
 */
export function createBooleanVectorGeometryCache({ maxEntries = BOOLEAN_VECTOR_CACHE_LIMITS.maxEntries,
  maxBytes = BOOLEAN_VECTOR_CACHE_LIMITS.maxBytes, maxPending = BOOLEAN_VECTOR_CACHE_LIMITS.maxPending,
  booleanGeometry = runBooleanGeometry } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > BOOLEAN_VECTOR_CACHE_LIMITS.maxEntries
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > BOOLEAN_VECTOR_CACHE_LIMITS.maxBytes
    || !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > BOOLEAN_VECTOR_CACHE_LIMITS.maxPending
    || typeof booleanGeometry !== 'function') throw new TypeError('The Boolean vector cache options are invalid.');
  const entries = new Map(); const jobs = new Map(); let bytes = 0; let closed = false;
  const admitKey = current => {
    if (current.key.length * 2 + 512 > maxBytes) throw new BooleanVectorGeometryError('These Boolean sources exceed the local geometry cache budget. Simplify the sources or use a larger cache before retrying.', 'BOOLEAN_VECTOR_CACHE_LIMIT');
    return current;
  };
  const touch = key => { const entry = entries.get(key); if (entry) { entries.delete(key); entries.set(key, entry); } return entry; };
  const remove = key => { const entry = entries.get(key); if (entry) { entries.delete(key); bytes -= entry.size; } };
  const retain = (key, entry) => {
    remove(key);
    entry.size = (key.length + JSON.stringify(entry.geometry || entry.error?.message || '').length) * 2;
    if (entry.size > maxBytes) return false;
    while (entries.size >= maxEntries || bytes + entry.size > maxBytes) remove(entries.keys().next().value);
    entries.set(key, entry); bytes += entry.size; return true;
  };
  const settle = (job, waiter, error, entry) => {
    if (!job.waiters.delete(waiter)) return;
    waiter.signal?.removeEventListener('abort', waiter.abort);
    if (error) waiter.reject(error);
    else {
      try {
        const current = snapshot(waiter.node, waiter.options);
        if (current.key !== job.key) throw staleError();
        waiter.resolve(paintPath(current.resolved, entry));
      } catch (failure) { waiter.reject(failure); }
    }
  };
  const stopEmpty = job => {
    if (!job.waiters.size && jobs.get(job.key) === job) { jobs.delete(job.key); job.controller.abort(); }
  };
  const execute = async job => {
    try {
      const output = await job.run(job.request, { signal: job.controller.signal });
      if (closed || jobs.get(job.key) !== job || job.controller.signal.aborted) return;
      validateVectorOutlineResult(output);
      const entry = { geometry: freezeGeometry(outlinedGeometryToPathGeometry(output, job.width, job.height)),
        bounds: Object.freeze(Object.fromEntries(['left', 'top', 'right', 'bottom'].map(property => [property, output.bounds[property]]))) };
      // A stale source cannot install a result merely because its old worker
      // finished. Other waiters with the same still-current content can retain it.
      const hasCurrentWaiter = [...job.waiters].some(waiter => { try { return snapshot(waiter.node, waiter.options).key === job.key; } catch { return false; } });
      if (hasCurrentWaiter && !retain(job.key, entry)) throw new BooleanVectorGeometryError('This Boolean result exceeds the local geometry cache budget. Simplify its sources before retrying.', 'BOOLEAN_VECTOR_CACHE_LIMIT');
      jobs.delete(job.key);
      for (const waiter of [...job.waiters]) settle(job, waiter, null, entry);
    } catch (error) {
      if (closed || jobs.get(job.key) !== job) return;
      jobs.delete(job.key);
      const hasCurrentWaiter = [...job.waiters].some(waiter => { try { return snapshot(waiter.node, waiter.options).key === job.key; } catch { return false; } });
      if (error?.name !== 'AbortError' && !['BOOLEAN_VECTOR_QUEUE_FULL', 'VECTOR_GEOMETRY_QUEUE_FULL'].includes(error?.code)
        && hasCurrentWaiter) retain(job.key, { error });
      for (const waiter of [...job.waiters]) settle(job, waiter, error);
    }
  };
  const clear = () => {
    entries.clear(); bytes = 0;
    for (const job of jobs.values()) {
      job.controller.abort(); for (const waiter of [...job.waiters]) settle(job, waiter, vectorGeometryAbortError());
    }
    jobs.clear();
  };
  return Object.freeze({
    key: booleanVectorGeometryKey,
    get(node, options) {
      if (closed) throw closedError();
      const current = admitKey(snapshot(node, options)); const entry = touch(current.key);
      if (!entry) throw pendingError();
      if (entry.error) throw entry.error;
      return paintPath(current.resolved, entry);
    },
    prepare(node, options = {}) {
      try {
        if (closed) throw closedError();
        abort(options.signal);
        const current = admitKey(snapshot(node, options)); const entry = touch(current.key);
        if (entry && !entry.error) return Promise.resolve(paintPath(current.resolved, entry));
        if (entry?.error && !options.retry) return Promise.reject(entry.error);
        if (entry?.error) remove(current.key);
        let job = jobs.get(current.key); let start = false;
        if (!job) {
          if (jobs.size >= maxPending) throw new BooleanVectorGeometryError('The Boolean geometry queue is full. Finish or cancel a current operation first.', 'BOOLEAN_VECTOR_QUEUE_FULL');
          const run = options.booleanGeometry || booleanGeometry;
          if (typeof run !== 'function') throw new TypeError('The Boolean geometry processor must be a function.');
          job = { ...current, run, controller: new AbortController(), waiters: new Set() }; jobs.set(current.key, job); start = true;
        }
        const promise = new Promise((resolve, reject) => {
          const waiter = { node, options, signal: options.signal, resolve, reject };
          waiter.abort = () => { settle(job, waiter, vectorGeometryAbortError()); stopEmpty(job); };
          job.waiters.add(waiter); options.signal?.addEventListener('abort', waiter.abort, { once: true });
          // An abort during an application resolver must not be lost.
          if (options.signal?.aborted) waiter.abort();
        });
        if (start && jobs.get(current.key) === job) void execute(job);
        return promise;
      } catch (error) { return Promise.reject(error); }
    },
    clear,
    dispose() { if (closed) return; closed = true; clear(); },
    stats() { return Object.freeze({ entries: entries.size, bytes, pending: jobs.size, closed }); }
  });
}

let sharedCache = null;
const shared = () => sharedCache ||= createBooleanVectorGeometryCache();
const geometryProviders = new Set();

/** Register a bounded owner of geometry-only page pins; source keys remain authoritative. */
export function registerBooleanVectorGeometryProvider(lookup) {
  if (typeof lookup !== 'function') throw new TypeError('A Boolean geometry provider must be a function.');
  if (geometryProviders.size >= 8) throw new BooleanVectorGeometryError('Too many local Boolean preview owners are active. Close an unused preview before retrying.', 'BOOLEAN_VECTOR_PROVIDER_LIMIT');
  geometryProviders.add(lookup);
  const unregister = () => geometryProviders.delete(lookup);
  unregister.isRegistered = () => geometryProviders.has(lookup);
  return unregister;
}

function pinnedPath(node, options) {
  if (!geometryProviders.size) return null;
  const current = snapshot(node, options);
  for (const lookup of geometryProviders) {
    const entry = lookup(current.key);
    if (entry) return paintPath(current.resolved, entry);
  }
  return null;
}

export const getBooleanVectorPath = (node, options) => pinnedPath(node, options) || shared().get(node, options);
export const prepareBooleanVectorPath = (node, options = {}) => {
  try { abort(options.signal); return Promise.resolve(pinnedPath(node, options) || shared().prepare(node, options)); }
  catch (error) { return Promise.reject(error); }
};
/** Release retained paths and pending requests, without closing a borrowed worker client. */
export function disposeBooleanVectorGeometryCache() { sharedCache?.dispose(); sharedCache = null; geometryProviders.clear(); }
