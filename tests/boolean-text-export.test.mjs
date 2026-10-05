import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import { addNode, createDocument, createNode, createVariable, createVariableCollection, bindVariable, validateDocument, resolveBooleanSourceNode } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { prepareTextOutlineGeometry } from '../src/text-outline-geometry.js';
import { booleanGeometryWithKit } from '../src/vector-geometry-kernel.js';
import { disposeBooleanVectorGeometryCache } from '../src/boolean-vector-geometry.js';
import { disposeBooleanTextGeometryCache } from '../src/boolean-text-geometry.js';
import { prepareBooleanVectorExport, projectBooleanVectorPaintTree } from '../src/boolean-vector-export-preflight.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { importSvgToLayers } from '../src/svg-import.js';
import { createVectorPdf } from '../src/pdf-vector-export.js';

const kit = await createRequire(import.meta.url)('canvaskit-wasm')({});
const bytes = await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))));
const face = new hb.Face(new hb.Blob(bytes));
function shapeText(value, style) {
  const font = new hb.Font(face); font.setScale(face.upem, face.upem);
  font.setVariations(Object.entries(style.fontAxes || {}).map(([tag, value]) => new hb.Variation(tag, value)));
  const buffer = new hb.Buffer(); buffer.addText(value); buffer.guessSegmentProperties();
  hb.shape(font, buffer, Object.entries(style.fontFeatures || {}).map(([tag, value]) => new hb.Feature(tag, value)));
  return { upem: face.upem, extents: font.hExtents(),
    leadingTrimMetrics: { capHeight: font.getMetricPosition(hb.MetricsTag.CAP_HEIGHT) },
    glyphs: buffer.getGlyphInfosAndPositions().map(glyph => ({ ...glyph, id: glyph.codepoint, path: font.glyphToPath(glyph.codepoint) })) };
}
const nativeBoolean = async request => booleanGeometryWithKit(kit, request);
const getTextOutline = (document, node, options) => prepareTextOutlineGeometry(document, node, { ...options, shapeText });
const all = nodes => nodes.flatMap(node => [node, ...all(node.children || [])]);
const pdfText = value => new TextDecoder('latin1').decode(value);

function fixture(properties = {}) {
  disposeBooleanVectorGeometryCache();
  const document = createDocument();
  const text = createNode('text', { text: 'O', fontFamily: 'Retained Local Inter', fontSize: 64,
    width: 80, height: 80, textFit: 'fixed', ...properties });
  const extra = createNode('rectangle', { x: 70, y: 0, width: 10, height: 80 });
  const root = createNode('boolean', { booleanGeometry: 'vector', width: 80, height: 80,
    operation: 'union', fill: '#ff6600', children: [text, extra] });
  addNode(document, root);
  return { document, text: root.children[0], extra: root.children[1], root };
}
const options = extra => ({ booleanGeometry: nativeBoolean, getTextOutline, getFontRevision: () => 'Inter fixture v1', ...extra });
function projectedNativePath(document, root, plan) {
  const projected = projectBooleanVectorPaintTree(document, root, plan);
  const markup = exportNodeToSvg(projected, { document });
  const data = /<path\b[^>]*\bd="([^"]+)"/u.exec(markup)?.[1];
  assert.ok(data, 'the export has self-contained native vector contours');
  const path = kit.Path.MakeFromSVGString(data); assert.ok(path);
  path.setFillType(projected.fillRule === 'evenodd' ? kit.FillType.EvenOdd : kit.FillType.Winding);
  return { path, projected, markup };
}

test('actual local glyph holes survive Boolean SVG and vector PDF while editable text sources remain unchanged', async () => {
  const h = fixture(); const original = structuredClone(h.document);
  const plan = await prepareBooleanVectorExport(h.document, [h.root.id], options());
  const { path, projected, markup } = projectedNativePath(h.document, h.root, plan);
  try {
    const bounds = projected.__booleanGeometryBounds;
    assert.ok(bounds.right >= 80 && bounds.bottom >= 80);
    assert.equal(path.contains(75, 40), true, 'the geometric rectangle is included');
    assert.equal(path.contains(24, 40), false, 'the O counter remains a hole');
    assert.equal(path.contains(5, 40), true, 'the left glyph stem remains filled');
  } finally { path.delete(); }
  assert.doesNotMatch(markup, /<text\b|font-family|Retained Local/u);
  const imported = all(importSvgToLayers(markup).nodes);
  assert.ok(imported.some(node => node.type === 'path')); assert.ok(imported.every(node => node.type !== 'text'));
  const pdf = pdfText(createVectorPdf(markup)); assert.doesNotMatch(pdf, /\/BaseFont|\/Subtype \/Image/u);
  assert.deepEqual(h.document, original); assert.equal(validateDocument(h.document), true);
});

test('text and native region export pins survive both cache disposals and retain fresh result paints', async () => {
  const h = fixture(); let outlines = 0; let revision = 'font1';
  const plan = await prepareBooleanVectorExport(h.document, [h.root.id], options({
    getFontRevision: () => revision, getTextOutline: (...args) => { outlines++; return getTextOutline(...args); }
  }));
  const preparedOutlines = outlines;
  const path = plan.get(h.root.id).path;
  const textPlan = path.__booleanTextGeometryPlan;
  assert.ok(textPlan, 'prepared export paths carry the same ready text pins for preview handoff');
  assert.equal(Object.getOwnPropertyDescriptor(path, '__booleanTextGeometryPlan').enumerable, false);
  const readyText = textPlan.resolveTextGeometry(resolveBooleanSourceNode(h.document, h.text));
  disposeBooleanVectorGeometryCache(); disposeBooleanTextGeometryCache(h.document);
  assert.equal(textPlan.resolveTextGeometry(resolveBooleanSourceNode(h.document, h.text)), readyText,
    'the attached page pins remain ready after shared text and region cache disposal');
  h.root.fill = '#123456';
  const projected = projectBooleanVectorPaintTree(h.document, h.root, plan);
  assert.equal(projected.fill, '#123456'); assert.ok(projected.points.length);
  assert.equal(outlines, preparedOutlines, 'projection does not reopen a font session');
  const anotherDesign = structuredClone(h.document);
  assert.throws(() => projectBooleanVectorPaintTree(anotherDesign, anotherDesign.pages[0].children[0], plan), /another design/u);
  revision = 'font2';
  assert.throws(() => projectBooleanVectorPaintTree(h.document, h.root, plan), /font|changed|stale/iu);
});

test('empty Boolean exports still charge all captured text pins against the aggregate budget', async () => {
  const document = createDocument(); const ids = [];
  for (let index = 0; index < 5; index++) {
    const root = createNode('boolean', { booleanGeometry: 'vector', operation: 'intersect', width: 80, height: 80,
      children: [createNode('text', { text: 'O', width: 80, height: 80 }),
        createNode('rectangle', { x: 70, width: 10, height: 80 })] });
    addNode(document, root); ids.push(root.id);
  }
  const original = structuredClone(document); let preparations = 0; let nativeCalls = 0;
  const emptyCoverage = { coverage: true, geometry: { fillRule: 'nonzero', fillGroups: [], strokeContours: [], alignedStrokeContours: [] } };
  await assert.rejects(prepareBooleanVectorExport(document, ids, {
    // Simulate maximum-sized, operation-owned pins without allocating large
    // font graphs. Empty results cannot erase their retained input cost.
    prepareTextGeometry: async () => { preparations++; return { bytes: 8 * 1024 * 1024,
      resolveTextGeometry: () => emptyCoverage, validateCurrent() {} }; },
    prepare: async () => { nativeCalls++; return { points: [], closed: true, fillRule: 'nonzero' }; }
  }), /exceeds the local vector geometry budget/u);
  assert.equal(preparations, 4, 'the accumulated text pins reach the limit before another region is admitted');
  assert.equal(nativeCalls, 3, 'the over-budget region never starts its native operation');
  assert.deepEqual(document, original, 'budget rejection leaves editable text sources intact');
});

test('pinned text exports reject raw text, resolved variable and source-identity changes', async () => {
  for (const change of ['text', 'variable', 'replacement']) {
    const h = fixture();
    const collection = createVariableCollection(h.document, 'Type');
    const variable = createVariable(h.document, collection.id, 'Size', 'number', 64);
    assert.equal(bindVariable(h.document, h.text.id, variable.id, 'fontSize'), true);
    const plan = await prepareBooleanVectorExport(h.document, [h.root.id], options());
    if (change === 'text') h.text.text = 'B';
    if (change === 'variable') variable.valuesByMode[collection.defaultModeId] = 48;
    if (change === 'replacement') h.document.pages[0].children[0] = structuredClone(h.root);
    assert.throws(() => projectBooleanVectorPaintTree(h.document, h.root, plan), /changed|stale|current/iu, change);
  }
});

test('font or text mutation during actual asynchronous glyph preparation cannot produce an export plan', async () => {
  for (const mutation of ['font', 'text']) {
    const h = fixture(); let revision = 1; let release; let started;
    const wait = new Promise(resolve => { started = resolve; });
    const pending = prepareBooleanVectorExport(h.document, [h.root.id], options({
      getFontRevision: () => revision,
      getTextOutline: async (...args) => {
        started(); await new Promise(resolve => { release = resolve; });
        return getTextOutline(...args);
      }
    }));
    await wait;
    if (mutation === 'font') revision++;
    else h.text.text = 'B';
    release(); await assert.rejects(pending, /changed|stale|current|text|font/iu);
  }
});

test('cancelled or missing-glyph Boolean text export leaves original source text and paints intact', async () => {
  for (const failure of ['cancel', 'missing']) {
    const h = fixture(); const original = structuredClone(h.document); const controller = new AbortController();
    const pending = prepareBooleanVectorExport(h.document, [h.root.id], options({ signal: controller.signal,
      getTextOutline: async (...args) => {
        if (failure === 'missing') throw new Error('A retained font covering this glyph is required.');
        controller.abort(); return getTextOutline(...args);
      }
    }));
    await assert.rejects(pending, failure === 'cancel' ? { name: 'AbortError' } : /retained font/u);
    assert.deepEqual(h.document, original);
  }
});

test('source glyph strokes become geometry once while independent result strokes remain vector export paints', async () => {
  const plain = fixture(); const plainPlan = await prepareBooleanVectorExport(plain.document, [plain.root.id], options());
  const plainPath = projectBooleanVectorPaintTree(plain.document, plain.root, plainPlan);
  const h = fixture({ color: '#ff0000', opacity: .2, fillOpacity: .3,
    strokes: [createStroke({ color: '#0000ff', width: 8, alignment: 'outside', opacity: .2 })] });
  h.root.strokes = [createStroke({ color: '#00ff00', width: 2, alignment: 'inside' }),
    createStroke({ color: '#ff00ff', width: 4, alignment: 'outside' })];
  const plan = await prepareBooleanVectorExport(h.document, [h.root.id], options());
  const projected = projectBooleanVectorPaintTree(h.document, h.root, plan);
  assert.ok(projected.__booleanGeometryBounds.left < plainPath.__booleanGeometryBounds.left - 7.9,
    'authored source outside ink is part of the resulting region');
  const markup = exportNodeToSvg(projected, { document: h.document });
  assert.match(markup, /stroke="#00ff00"/u); assert.match(markup, /stroke="#ff00ff"/u);
  assert.doesNotMatch(markup, /stroke="#0000ff"|<text\b/u, 'the source stroke is not painted twice');
  const pdf = pdfText(createVectorPdf(markup)); assert.doesNotMatch(pdf, /\/BaseFont|\/Subtype \/Image/u);
});

test('all four native operations export glyph counters with the same binary region membership', async () => {
  const reference = fixture(); reference.extra.visible = false;
  const referencePlan = await prepareBooleanVectorExport(reference.document, [reference.root.id], options());
  const glyph = projectedNativePath(reference.document, reference.root, referencePlan).path;
  try {
    for (const operation of ['union', 'subtract', 'intersect', 'exclude']) {
      const h = fixture(); h.root.operation = operation;
      Object.assign(h.extra, { x: 0, y: 0, width: 25, height: 80 });
      const plan = await prepareBooleanVectorExport(h.document, [h.root.id], options());
      const { path, markup } = projectedNativePath(h.document, h.root, plan);
      try {
        for (let y = 3; y < 80; y += 8) for (let x = 3; x < 80; x += 8) {
          const a = glyph.contains(x, y); const b = x < 25;
          const expected = operation === 'union' ? a || b : operation === 'subtract' ? a && !b
            : operation === 'intersect' ? a && b : a !== b;
          assert.equal(path.contains(x, y), expected, `${operation} at ${x},${y}`);
        }
      } finally { path.delete(); }
      const pdf = pdfText(createVectorPdf(markup)); assert.doesNotMatch(pdf, /\/BaseFont|\/Subtype \/Image/u);
    }
  } finally { glyph.delete(); }
});

test('selected-child export also pins editable text geometry in an ancestor mask source', async () => {
  const h = fixture(); h.document.pages[0].children = [];
  const content = createNode('rectangle', { width: 80, height: 80, fill: '#abcdef' });
  const group = createNode('group', { width: 80, height: 80, mask: true, maskMode: 'vector',
    maskSourceId: h.root.id, children: [h.root, content] });
  addNode(h.document, group);
  const plan = await prepareBooleanVectorExport(h.document, [content.id], options());
  assert.ok(plan.has(h.root.id), 'the retained masking source was prepared although it was not selected');
  disposeBooleanVectorGeometryCache(); disposeBooleanTextGeometryCache(h.document);
  const markup = exportNodeToSvg(projectBooleanVectorPaintTree(h.document, group, plan), { document: h.document });
  assert.match(markup, /<mask\b[^>]*data-tiny-image-star-mask-mode="vector"/u);
  assert.doesNotMatch(markup, /<text\b|font-family/u);
  assert.doesNotThrow(() => createVectorPdf(markup));
});

test('ending truncation clips completed source strokes without adding a stroke along the text box edge', async () => {
  const h = fixture({ height: 30, lineHeight: 30, lineHeightUnit: 'pixels', textTruncation: 'ending',
    strokes: [createStroke({ color: '#0000ff', width: 8, alignment: 'outside' })] });
  h.extra.visible = false;
  const plan = await prepareBooleanVectorExport(h.document, [h.root.id], options());
  const { path, projected, markup } = projectedNativePath(h.document, h.root, plan);
  try {
    assert.ok(projected.__booleanGeometryBounds.bottom <= 30.001, 'the complete fill and outline are clipped at the ending boundary');
    assert.equal(path.contains(60, 29), false, 'clipping did not invent a wide horizontal box-border stroke');
    assert.equal(path.contains(5, 28), true, 'the visible glyph and its authored stroke remain');
  } finally { path.delete(); }
  assert.doesNotThrow(() => createVectorPdf(markup));
});

test('source text rotation is applied once after glyph geometry preparation', async () => {
  const reference = fixture(); reference.extra.visible = false;
  const referencePlan = await prepareBooleanVectorExport(reference.document, [reference.root.id], options());
  const plain = projectedNativePath(reference.document, reference.root, referencePlan).path;
  const h = fixture({ rotation: 90 }); h.extra.visible = false;
  const plan = await prepareBooleanVectorExport(h.document, [h.root.id], options());
  const { path, markup } = projectedNativePath(h.document, h.root, plan);
  try {
    for (let y = 3; y < 80; y += 8) for (let x = 3; x < 80; x += 8) {
      assert.equal(path.contains(x, y), plain.contains(y, 80 - x), `rotated glyph at ${x},${y}`);
    }
  } finally { plain.delete(); path.delete(); }
  assert.doesNotThrow(() => createVectorPdf(markup));
});
