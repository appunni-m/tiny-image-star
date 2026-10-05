import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBooleanVectorRequest, booleanVectorGeometryKey, createBooleanVectorGeometryCache,
  getBooleanVectorPath, prepareBooleanVectorPath, disposeBooleanVectorGeometryCache } from '../src/boolean-vector-geometry.js';
import { nativePathGeometryForNode } from '../src/vector-shape-geometry.js';
import { booleanSourceTransform } from '../src/boolean-geometry.js';
import { multiplyAffine, nodeToParentTransform } from '../src/transform-geometry.js';

const shape = (overrides = {}) => ({ type: 'rectangle', name: 'Source', x: 0, y: 0, width: 100, height: 80,
  rotation: 0, radius: 0, fill: '#abcdef', fillOpacity: 1, visible: true, opacity: 1, ...overrides });
const boolean = (overrides = {}) => ({ type: 'boolean', id: 'result', name: 'Result', x: 8, y: 11,
  width: 100, height: 80, rotation: 0, operation: 'union', fill: '#fedcba', children: [shape()], ...overrides });
const stroke = (overrides = {}) => ({ id: 's', color: '#123456', width: 8, visible: true, opacity: 1,
  cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10, ...overrides });
const result = (left = -4, top = -3, right = 104, bottom = 83) => ({
  commands: new Float32Array([0, left, top, 1, right, top, 1, right, bottom, 1, left, bottom, 5]),
  fillRule: 'nonzero', bounds: { left, top, right, bottom }
});
const deferred = () => { let resolve; let reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const code = value => error => error.code === value;

test('requests use source bounds basis and one local affine transform, independent of root placement', () => {
  const source = shape({ x: -9, y: 4, width: 41, height: 24, rotation: 37, affineTransform: { a: -1, b: .25, c: .4, d: 1 } });
  const node = boolean({ width: 120, height: 95, children: [source, shape({ x: 63, y: 44 })] });
  const request = buildBooleanVectorRequest(node);
  const basis = booleanSourceTransform(node.children, node.width, node.height);
  const transform = multiplyAffine({ a: basis.scaleX, b: 0, c: 0, d: basis.scaleY,
    e: -basis.left * basis.scaleX, f: -basis.top * basis.scaleY }, nodeToParentTransform(source));
  assert.deepEqual(request.root.transform, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(request.root.children[0].transform, [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f]);
  assert.equal(request.root.includeFill, true);
  assert.deepEqual(request.root.strokes, []);
  const key = booleanVectorGeometryKey(node);
  Object.assign(node, { x: 120, y: -20, rotation: 99, affineTransform: { a: 2, b: 0, c: .2, d: 1 }, fill: '#ffffff', strokes: [stroke()] });
  assert.equal(booleanVectorGeometryKey(node), key);
  source.rotation += 1;
  assert.notEqual(booleanVectorGeometryKey(node), key);
});

test('vector coverage respects enabled paints while ignoring all source and paint alpha', () => {
  const sources = [shape({ opacity: 0, fillOpacity: 0 }),
    shape({ x: 100, fill: 'transparent', fills: [{ id: 'g', type: 'linear', visible: true, opacity: 0,
      gradient: { type: 'linear', angle: 0, stops: [{ color: '#abcdef', opacity: 0 }, { color: '#abcdef', opacity: 0 }] } }] }),
    shape({ x: 200, fill: 'transparent', fills: [{ id: 'i', type: 'image', visible: true, opacity: 0, imageFill: { assetId: 'private' } }] }),
    shape({ x: 300, fill: 'transparent', strokes: [stroke({ opacity: 0 })] }),
    shape({ x: 400, fill: '#abcdef', fills: [] }), shape({ x: 500, fill: 'transparent' })];
  const request = buildBooleanVectorRequest(boolean({ children: sources }));
  assert.deepEqual(request.root.children.map(node => node.includeFill), [true, true, true, false, false, false]);
  assert.equal(request.root.children[3].strokes.length, 1);
  const key = booleanVectorGeometryKey(boolean({ children: sources }));
  sources[0].opacity = .2; sources[0].fillOpacity = .9; sources[0].fill = '#00ffff'; sources[3].strokes[0].opacity = .4;
  assert.equal(booleanVectorGeometryKey(boolean({ children: sources })), key);
  sources[3].strokes[0].visible = false;
  assert.notEqual(booleanVectorGeometryKey(boolean({ children: sources })), key);
});

test('hidden operands remain ordered empty regions, including intersection and subtract', () => {
  for (const operation of ['union', 'intersect', 'subtract', 'exclude']) {
    const request = buildBooleanVectorRequest(boolean({ operation, children: [shape(), shape({ visible: false, x: 2 })] }));
    assert.equal(request.root.operation, operation);
    assert.equal(request.root.children.length, 2);
    assert.equal(request.root.children[1].includeFill, false);
    assert.deepEqual(request.root.children[1].geometry.fillGroups, []);
    assert.deepEqual(request.root.children[1].strokes, []);
  }
});

test('nested Booleans retain result source strokes, source alpha is ignored and no own root stroke enters the boundary', () => {
  const nested = boolean({ x: 40, y: 30, width: 60, height: 40, opacity: .3, operation: 'subtract',
    fills: [], strokes: [stroke({ alignment: 'outside', width: 6 })], children: [shape({ width: 60, height: 40 }), shape({ x: 10, y: 10, width: 20, height: 20 })] });
  const node = boolean({ strokes: [stroke({ startDecoration: 'arrow' })], children: [nested, shape()] });
  const request = buildBooleanVectorRequest(node);
  assert.deepEqual(request.root.strokes, []);
  assert.equal(request.root.children[0].kind, 'boolean');
  assert.equal(request.root.children[0].operation, 'subtract');
  assert.equal(request.root.children[0].includeFill, false);
  assert.equal(request.root.children[0].strokes[0].alignment, 'outside');
  assert.equal(request.root.children[0].strokes[0].width, 6);
  assert.equal(request.root.children[0].children.length, 2);
});

test('open paths and lines use centered stroke geometry while closed paths preserve alignment', () => {
  const path = shape({ type: 'path', closed: false, points: [{ x: 0, y: 0, out: { x: .25, y: .1 } }, { x: 1, y: 1, in: { x: -.2, y: .05 } }],
    strokes: [stroke({ alignment: 'outside', cap: 'round' })] });
  const line = shape({ type: 'line', height: 0, fill: 'transparent', strokes: [stroke({ alignment: 'inside', cap: 'square' })] });
  const closed = shape({ type: 'path', closed: true, fillRule: 'evenodd', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: .5, y: 1 }], strokes: [stroke({ alignment: 'inside' })] });
  const request = buildBooleanVectorRequest(boolean({ children: [path, line, closed] }));
  assert.equal(request.root.children[0].geometry.strokeContours[0].commands[0].type, 'cubic');
  assert.equal(request.root.children[0].geometry.fillGroups.length, 0);
  assert.equal(request.root.children[0].strokes[0].alignment, 'center');
  assert.equal(request.root.children[1].strokes[0].alignment, 'center');
  assert.equal(request.root.children[2].strokes[0].alignment, 'inside');
  assert.equal(request.root.children[2].geometry.fillRule, 'evenodd');
});

test('network face paints select additive native regions without changing edge stroke contours', () => {
  const network = shape({ type: 'network', fill: '#abcdef', vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: .5, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'ca', from: 'c', to: 'a' }],
    faces: [{ id: 'first', vertexIds: ['a', 'b', 'c'], fill: 'transparent', fillOpacity: 0 }, { id: 'second', vertexIds: ['c', 'b', 'a'], fill: '#abcdef', fillOpacity: 0 }],
    strokes: [stroke()] });
  const region = buildBooleanVectorRequest(boolean({ children: [network] })).root.children[0];
  assert.equal(region.geometry.fillGroups.length, 2);
  assert.deepEqual(region.fillGroupIndices, [1]);
  assert.equal(region.includeFill, true);
  assert.equal(region.geometry.strokeContours.length, 3);
  assert.equal(region.geometry.alignedStrokeContours.length, 2);
  network.fills = [{ id: 'i', type: 'image', visible: true, opacity: 0, imageFill: { assetId: 'asset' } }];
  assert.deepEqual(buildBooleanVectorRequest(boolean({ children: [network] })).root.children[0].fillGroupIndices, [0, 1]);
});

test('requests strip identity, effects, assets and paint metadata and do not mutate resolved nodes', () => {
  const source = shape({ id: 'secret-source', fills: [{ id: 'paint', type: 'image', visible: true, opacity: .2, imageFill: { assetId: 'do-not-transfer' } }],
    componentId: 'secret-component', variableBindings: { width: 'secret-binding' }, effects: [{ type: 'dropShadow', color: '#000000' }],
    strokes: [stroke({ gradient: { type: 'linear', stops: [{ color: '#abcdef', opacity: .1 }] }, blendMode: 'multiply', imageFill: { assetId: 'malicious' } })] });
  const node = boolean({ children: [source] }); const before = structuredClone(node);
  const request = buildBooleanVectorRequest(node);
  assert.deepEqual(node, before);
  const encoded = JSON.stringify(request);
  for (const forbidden of ['secret', 'assetId', 'imageFill', 'gradient', 'blendMode', 'effects', 'color', 'opacity', 'component']) assert.equal(encoded.includes(forbidden), false, forbidden);
  request.root.children[0].geometry.strokeContours[0].start.x = 44;
  assert.equal(buildBooleanVectorRequest(node).root.children[0].geometry.strokeContours[0].start.x, 0);
});

test('unsupported decorations, complex dashes, containers and unresolved text fail descriptively', () => {
  for (const value of [stroke({ startDecoration: 'arrow' }), stroke({ pattern: 'custom', dashArray: [2, 3, 4, 5] }), stroke({ pattern: 'custom', dashArray: [2, 0] })]) {
    assert.throws(() => buildBooleanVectorRequest(boolean({ children: [shape({ strokes: [value] })] })), code('UNSUPPORTED_BOOLEAN_VECTOR_GEOMETRY'));
  }
  assert.throws(() => buildBooleanVectorRequest(boolean({ children: [shape({ type: 'group' })] })), /vector shapes/);
  assert.throws(() => buildBooleanVectorRequest(boolean({ children: [shape({ type: 'text', color: '#abcdef', text: 'Hello' })] })), /resolved glyph contours/);
  const textNode = shape({ type: 'text', color: '#abcdef', text: 'Hello' });
  const request = buildBooleanVectorRequest(boolean({ children: [textNode] }), { resolveTextGeometry: () => nativePathGeometryForNode(shape()) });
  assert.equal(request.root.children[0].includeFill, true);
  assert.throws(() => buildBooleanVectorRequest(boolean({ children: [textNode] }), { resolveTextGeometry: () => Promise.resolve({}) }), /synchronous/);
});

test('resolvers provide current geometry and keys invalidate dimensions, operation, source paths and stroke geometry', () => {
  const node = boolean(); const resolveNode = value => value.type === 'rectangle' ? { ...value, width: 47, strokes: [stroke({ width: 5 })] } : value;
  const request = buildBooleanVectorRequest(node, { resolveNode });
  assert.equal(request.root.children[0].geometry.strokeContours[0].commands[0].end.x, 47);
  assert.equal(request.root.children[0].strokes[0].width, 5);
  const key = booleanVectorGeometryKey(node);
  node.width += 1; assert.notEqual(booleanVectorGeometryKey(node), key); node.width -= 1;
  node.operation = 'exclude'; assert.notEqual(booleanVectorGeometryKey(node), key); node.operation = 'union';
  node.children[0].radius = 2; assert.notEqual(booleanVectorGeometryKey(node), key);
});

test('source cycles, node/depth limits and invalid transforms are bounded before processing', () => {
  const cycle = boolean(); cycle.children = [cycle];
  assert.throws(() => buildBooleanVectorRequest(cycle), /cyclic/);
  assert.throws(() => buildBooleanVectorRequest(boolean({ children: Array.from({ length: 256 }, () => shape()) })), /bounded/);
  let deep = shape(); for (let i = 0; i < 34; i++) deep = boolean({ children: [deep] });
  assert.throws(() => buildBooleanVectorRequest(deep), /bounded/);
  assert.throws(() => buildBooleanVectorRequest(boolean({ children: [shape({ affineTransform: { a: 0, b: 0, c: 0, d: 0 } })] })), /invertible/);
  assert.throws(() => buildBooleanVectorRequest(boolean(), { resolveNode: () => null }), /resolve/);
});

test('cache returns fresh result paints and immutable retained geometry with exact native ink bounds', async () => {
  const node = boolean({ fills: [{ id: 'fill', type: 'solid', visible: true, opacity: .6, color: '#123456' }], strokes: [stroke()] });
  let calls = 0;
  const cache = createBooleanVectorGeometryCache({ booleanGeometry: async () => { calls++; return result(); } });
  assert.throws(() => cache.get(node), code('BOOLEAN_VECTOR_PENDING'));
  const path = await cache.prepare(node);
  assert.equal(path.type, 'path'); assert.deepEqual(path.children, []);
  assert.deepEqual(path.__booleanGeometryBounds, { left: -4, top: -3, right: 104, bottom: 83 });
  assert.equal(path.points[0].x, -.04); assert.equal(path.points[0].y, -.0375);
  assert.equal(path.fills[0].opacity, .6);
  path.points[0].x = 999; path.strokes[0].width = 99; path.fills[0].color = '#ffffff'; path.__booleanGeometryBounds.left = -99;
  node.fills[0].color = '#ff0000'; node.strokes[0].width = 12;
  const fresh = cache.get(node);
  assert.equal(fresh.points[0].x, -.04); assert.equal(fresh.strokes[0].width, 12); assert.equal(fresh.fills[0].color, '#ff0000');
  assert.equal(fresh.__booleanGeometryBounds.left, -4);
  await cache.prepare(node); assert.equal(calls, 1);
  assert.equal(cache.stats().entries, 1); cache.dispose(); assert.equal(cache.stats().closed, true);
});

test('stale completions cannot install a path for changed sources', async () => {
  const job = deferred(); const node = boolean(); const cache = createBooleanVectorGeometryCache({ booleanGeometry: () => job.promise });
  const promise = cache.prepare(node);
  node.children[0].radius = 5;
  job.resolve(result());
  await assert.rejects(promise, code('BOOLEAN_VECTOR_STALE'));
  assert.equal(cache.stats().entries, 0);
  assert.throws(() => cache.get(node), code('BOOLEAN_VECTOR_PENDING'));
  cache.dispose();
});

test('deduplicated waiters cancel independently and shared completion refreshes live paints', async () => {
  const job = deferred(); const controller = new AbortController(); const node = boolean(); let workerSignal; let calls = 0;
  const cache = createBooleanVectorGeometryCache({ booleanGeometry: (request, { signal }) => { calls++; workerSignal = signal; return job.promise; } });
  const cancelled = cache.prepare(node, { signal: controller.signal });
  const exportPromise = cache.prepare(node);
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(workerSignal.aborted, false); assert.equal(calls, 1);
  node.fill = '#00ffff'; job.resolve(result());
  assert.equal((await exportPromise).fill, '#00ffff');
  assert.equal(cache.stats().entries, 1); cache.dispose();
});

test('last waiter cancellation aborts resources, ignores late completion and allows retry of the same content', async () => {
  const old = deferred(); const controller = new AbortController(); let workerSignal; let calls = 0;
  const cache = createBooleanVectorGeometryCache({ booleanGeometry: (request, { signal }) => { calls++; workerSignal = signal; return calls === 1 ? old.promise : Promise.resolve(result()); } });
  const node = boolean(); const promise = cache.prepare(node, { signal: controller.signal });
  controller.abort(); await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(workerSignal.aborted, true); assert.equal(cache.stats().pending, 0);
  await cache.prepare(node); old.resolve(result(0, 0, 1, 1)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2); assert.equal(cache.get(node).__booleanGeometryBounds.right, 104); cache.dispose();
});

test('worker failures have explicit retry and malformed responses cannot enter retained cache', async () => {
  let calls = 0; const error = new Error('native failure'); const node = boolean();
  const cache = createBooleanVectorGeometryCache({ booleanGeometry: async () => { if (++calls === 1) throw error; return result(); } });
  await assert.rejects(cache.prepare(node), /native failure/);
  assert.throws(() => cache.get(node), /native failure/);
  await assert.rejects(cache.prepare(node), /native failure/); assert.equal(calls, 1);
  await cache.prepare(node, { retry: true }); assert.equal(calls, 2);
  const invalid = createBooleanVectorGeometryCache({ booleanGeometry: async () => ({ ...result(), commands: new Float32Array([0, NaN, 0]) }) });
  await assert.rejects(invalid.prepare(node), /coordinates/);
  assert.throws(() => invalid.get(node), /coordinates/);
  cache.dispose(); invalid.dispose();
});

test('empty Boolean results remain valid editable paths without bounding rectangle ink', async () => {
  const cache = createBooleanVectorGeometryCache({ booleanGeometry: async () => ({ commands: new Float32Array(), fillRule: 'nonzero', bounds: { left: 0, top: 0, right: 0, bottom: 0 } }) });
  const node = boolean({ strokes: [stroke()] }); const path = await cache.prepare(node);
  assert.deepEqual(path.points, []); assert.equal(path.strokes[0].width, 8); assert.deepEqual(cache.get(node).points, []); cache.dispose();
});

test('bounded LRU, queue admission, clear and dispose release retained and pending work', async () => {
  const cache = createBooleanVectorGeometryCache({ maxEntries: 2, booleanGeometry: async () => result() });
  const a = boolean(); const b = boolean({ width: 101 }); const c = boolean({ width: 102 });
  await cache.prepare(a); await cache.prepare(b); cache.get(a); await cache.prepare(c);
  assert.equal(cache.stats().entries, 2); assert.throws(() => cache.get(b), code('BOOLEAN_VECTOR_PENDING'));
  cache.clear(); assert.equal(cache.stats().bytes, 0); cache.dispose();
  assert.throws(() => cache.get(a), code('BOOLEAN_VECTOR_CLOSED')); await assert.rejects(cache.prepare(a), code('BOOLEAN_VECTOR_CLOSED'));
  const job = deferred(); let workerSignal;
  const limited = createBooleanVectorGeometryCache({ maxPending: 1, booleanGeometry: (request, { signal }) => { workerSignal = signal; return job.promise; } });
  const waiting = limited.prepare(a); await assert.rejects(limited.prepare(b), code('BOOLEAN_VECTOR_QUEUE_FULL'));
  limited.dispose(); await assert.rejects(waiting, { name: 'AbortError' }); assert.equal(workerSignal.aborted, true);
  job.resolve(result()); await new Promise(resolve => setImmediate(resolve)); assert.equal(limited.stats().entries, 0);
});

test('shared generic APIs accept an injected native processor and release lifecycle state', async () => {
  disposeBooleanVectorGeometryCache(); const node = boolean();
  const path = await prepareBooleanVectorPath(node, { booleanGeometry: async () => result() });
  assert.equal(path.type, 'path'); assert.deepEqual(getBooleanVectorPath(node).__booleanGeometryBounds, result().bounds);
  disposeBooleanVectorGeometryCache(); assert.throws(() => getBooleanVectorPath(node), code('BOOLEAN_VECTOR_PENDING')); disposeBooleanVectorGeometryCache();
});

test('default cache retains more than 32 distinct visible results without repeat worker preparation', async () => {
  let calls = 0; const cache = createBooleanVectorGeometryCache({ booleanGeometry: async () => { calls++; return result(); } });
  const nodes = Array.from({ length: 40 }, (_, index) => boolean({ width: 100 + index }));
  for (const node of nodes) await cache.prepare(node);
  for (const node of nodes) { assert.equal(cache.get(node).type, 'path'); await cache.prepare(node); }
  assert.equal(calls, 40); assert.equal(cache.stats().entries, 40); cache.dispose();
});

test('oversized ready geometry fails actionably and cannot resolve into a permanently pending path', async () => {
  const node = boolean(); const keyBytes = booleanVectorGeometryKey(node).length * 2;
  const commands = [0, 0, 0]; for (let index = 0; index < 100; index++) commands.push(1, index, index % 2); commands.push(5);
  const cache = createBooleanVectorGeometryCache({ maxBytes: keyBytes + 1_000,
    booleanGeometry: async () => ({ commands: new Float32Array(commands), fillRule: 'nonzero', bounds: { left: 0, top: 0, right: 99, bottom: 1 } }) });
  await assert.rejects(cache.prepare(node), code('BOOLEAN_VECTOR_CACHE_LIMIT'));
  assert.throws(() => cache.get(node), code('BOOLEAN_VECTOR_CACHE_LIMIT'));
  await assert.rejects(cache.prepare(node), code('BOOLEAN_VECTOR_CACHE_LIMIT'));
  assert.equal(cache.stats().entries, 1); cache.dispose();
});

test('worker bounds must be finite ordered and retained bounds discard unrelated fields', async () => {
  for (const bounds of [undefined, { left: NaN, top: 0, right: 1, bottom: 1 }, { left: 3, top: 0, right: 1, bottom: 1 }, { left: 0, top: 2, right: 1, bottom: 1 }]) {
    const cache = createBooleanVectorGeometryCache({ booleanGeometry: async () => ({ ...result(), bounds }) });
    await assert.rejects(cache.prepare(boolean()), /bounds/); cache.dispose();
  }
  const cache = createBooleanVectorGeometryCache({ booleanGeometry: async () => ({ ...result(), bounds: { ...result().bounds, assetId: 'cannot-smuggle' } }) });
  assert.deepEqual((await cache.prepare(boolean())).__booleanGeometryBounds, result().bounds); cache.dispose();
});

test('pre-aborted preparation does not start work and detached dispose method cancels safely', async () => {
  let calls = 0; const cache = createBooleanVectorGeometryCache({ booleanGeometry: async () => { calls++; return result(); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(cache.prepare(boolean(), { signal: controller.signal }), { name: 'AbortError' }); assert.equal(calls, 0);
  const { dispose } = cache; dispose(); assert.equal(cache.stats().closed, true);
});

test('a key larger than a custom cache budget fails synchronously instead of reporting endless pending', async () => {
  let calls = 0; const cache = createBooleanVectorGeometryCache({ maxBytes: 100, booleanGeometry: async () => { calls++; return result(); } });
  assert.throws(() => cache.get(boolean()), code('BOOLEAN_VECTOR_CACHE_LIMIT'));
  await assert.rejects(cache.prepare(boolean()), code('BOOLEAN_VECTOR_CACHE_LIMIT'));
  assert.equal(calls, 0); cache.dispose();
});

test('aggregate raw source geometry is admitted before constructing all native contours', () => {
  const points = Array.from({ length: 6_000 }, (_, index) => ({ x: index / 6_000, y: index % 2 }));
  const sources = Array.from({ length: 4 }, () => shape({ type: 'path', closed: true, points }));
  assert.throws(() => buildBooleanVectorRequest(boolean({ children: sources })), /aggregate source-geometry/);
});

test('unfilled closed network keeps all alignment boundaries while selecting no face fill regions', () => {
  const network = shape({ type: 'network', fill: 'transparent', vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: .5, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'ca', from: 'c', to: 'a' }],
    faces: [{ id: 'face', vertexIds: ['a', 'b', 'c'], fill: 'transparent' }], strokes: [stroke({ alignment: 'inside' })] });
  const region = buildBooleanVectorRequest(boolean({ children: [network] })).root.children[0];
  assert.equal(region.includeFill, false); assert.deepEqual(region.fillGroupIndices, []);
  assert.equal(region.geometry.fillGroups.length, 1); assert.equal(region.geometry.alignedStrokeContours.length, 1);
  assert.equal(region.strokes[0].alignment, 'inside');
});

test('transient shared worker queue contention does not poison geometry and can retry without an explicit error reset', async () => {
  let calls = 0; const node = boolean(); const cache = createBooleanVectorGeometryCache({ booleanGeometry: async () => {
    if (++calls === 1) throw Object.assign(new Error('The native worker queue is full.'), { code: 'VECTOR_GEOMETRY_QUEUE_FULL' });
    return result();
  } });
  await assert.rejects(cache.prepare(node), code('VECTOR_GEOMETRY_QUEUE_FULL'));
  assert.equal(cache.stats().entries, 0); assert.throws(() => cache.get(node), code('BOOLEAN_VECTOR_PENDING'));
  await cache.prepare(node); assert.equal(calls, 2); assert.equal(cache.get(node).type, 'path'); cache.dispose();
});
