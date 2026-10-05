import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as model from '../src/model.js';
import { History } from '../src/history.js';
import { createStroke } from '../src/strokes.js';
import { booleanGeometryWithKit } from '../src/vector-geometry-kernel.js';
import { disposeBooleanVectorGeometryCache } from '../src/boolean-vector-geometry.js';
import { prepareBooleanVectorExport, projectBooleanVectorPaintTree, walkBooleanPaintInputs } from '../src/boolean-vector-export-preflight.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { rasterExportBounds } from '../src/raster-export-bounds.js';
import { hitTestVisibleGeometry } from '../src/shape-hit-testing.js';
import { firstBackdropEffect, glassEffectOverscan, glassVisibleForNode } from '../src/glass-effect.js';
import { sliceRasterBoundsIntersect } from '../src/slice-export-plan.js';

const require = createRequire(import.meta.url);
const kit = await require('canvaskit-wasm')({});
const run = async request => booleanGeometryWithKit(kit, request);
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const start = main.indexOf('async function combineSelectedBoolean(operation) {');
const end = main.indexOf('\nfunction groupSelectedLayers()', start);
assert.ok(start >= 0 && end > start);
const handler = main.slice(start, end);

function harness(work = run) {
  disposeBooleanVectorGeometryCache();
  const document = model.createDocument();
  const base = model.createNode('rectangle', { width: 70, height: 50 });
  const cut = model.createNode('rectangle', { x: 20, y: 15, width: 30, height: 20 });
  model.addNode(document, base); model.addNode(document, cut);
  const before = model.cloneDocument(document); const history = new History(); const events = [];
  const state = { document, documentGeneration: 1, selectedIds: [base.id, cut.id], documentTransitioning: false };
  const context = {
    state, AbortController, DOMException, isLiveHostViewOnly: () => false, isImageRecipeBatchActive: () => false,
    rootSelectedIds: () => state.selectedIds,
    prepareBooleanCombine: (doc, ids, operation, pageId, options) => model.prepareBooleanCombine(doc, ids, operation, pageId, { ...options, booleanGeometry: work }),
    validateBooleanCombinePlan: model.validateBooleanCombinePlan, applyBooleanCombine: model.applyBooleanCombine,
    checkpoint: label => { history.checkpoint(state.document, label); events.push('checkpoint'); },
    renderInspector: () => {}, showToast: message => events.push(message),
    setSelection: ids => { state.selectedIds = ids; }, renderUI: () => {},
    queueSave: () => events.push('save'), renderer: { invalidate: () => {} }
  };
  return { document, state, base, cut, before, history, events,
    run: () => runInNewContext(`${handler}\ncombineSelectedBoolean('subtract');`, context) };
}

test('the production Boolean command prepares native geometry before one undoable save', async () => {
  const h = harness(); await h.run();
  const result = h.document.pages[0].children[0];
  assert.equal(result.type, 'boolean'); assert.equal(result.booleanGeometry, 'vector');
  assert.equal(result.children[0], h.base); assert.equal(result.children[1], h.cut);
  assert.equal(h.events.filter(event => event === 'checkpoint').length, 1);
  assert.equal(h.events.filter(event => event === 'save').length, 1);
  assert.deepEqual(Array.from(h.state.selectedIds), [result.id]); assert.equal(h.state.booleanController, null);
  assert.deepEqual(h.history.undo(h.document), h.before);
});

test('native failure, cancellation and a design switch cannot mutate sources or create undo history', async () => {
  for (const mode of ['failure', 'cancel', 'switch']) {
    let release;
    const h = harness(mode === 'failure' ? async () => { throw new Error('Native failure'); }
      : request => new Promise(resolve => { release = () => resolve(booleanGeometryWithKit(kit, request)); }));
    const pending = h.run();
    if (mode === 'cancel') h.state.booleanController.abort();
    if (mode === 'switch') { h.state.document = model.createDocument(); h.state.documentGeneration++; }
    release?.(); await pending;
    assert.deepEqual(h.document, h.before); assert.equal(h.history.canUndo, false);
    assert.equal(h.events.includes('save'), false); assert.equal(h.state.booleanController, null);
  }
});

function vectorResult(document, width = 100, overrides = {}) {
  const outer = model.createNode('rectangle', { width, height: 80, fill: '#ff0000', strokes: [createStroke({ width: 100, alignment: 'outside', color: '#ffff00' })] });
  const cut = model.createNode('rectangle', { x: 25, y: 25, width: 40, height: 30 });
  const result = model.createNode('boolean', { width, height: 80, operation: 'subtract', booleanGeometry: 'vector',
    fill: '#123456', children: [outer, cut], ...overrides });
  model.addNode(document, result); return result;
}
const prepare = (document, node, options) => model.prepareBooleanVectorPath(document, node, { ...options, booleanGeometry: run });

test('export pins survive cache disposal, ignore hidden regions, and retain fresh result paints', async () => {
  disposeBooleanVectorGeometryCache();
  const document = model.createDocument(); const result = vectorResult(document);
  const hidden = vectorResult(document, 110, { visible: false });
  const plan = await prepareBooleanVectorExport(document, [result.id, hidden.id], { prepare });
  disposeBooleanVectorGeometryCache();
  result.fill = '#abcdef';
  const projected = projectBooleanVectorPaintTree(document, result, plan);
  assert.equal(projected.fill, '#abcdef'); assert.equal(projected.type, 'path');
  assert.equal(projectBooleanVectorPaintTree(document, hidden, plan), hidden);
  assert.match(exportNodeToSvg(projected, { document }), /#abcdef/);
  result.children[0].width++;
  assert.throws(() => projectBooleanVectorPaintTree(document, result, plan), /changed|not prepared/);
});

test('outside source ink is selectable and ordered result strokes and effects extend SVG/raster export bounds', async () => {
  disposeBooleanVectorGeometryCache();
  const document = model.createDocument();
  const result = vectorResult(document, 100, { strokes: [
    createStroke({ width: 2, join: 'round', alignment: 'center' }),
    createStroke({ width: 20, join: 'round', alignment: 'center' })
  ] });
  const plan = await prepareBooleanVectorExport(document, [result.id], { prepare });
  assert.equal(hitTestVisibleGeometry(result, { x: -50, y: 30 }, { document, tolerance: 0 }), true);
  assert.equal(hitTestVisibleGeometry(result, { x: 40, y: 40 }, { document, tolerance: 0 }), false);
  const path = projectBooleanVectorPaintTree(document, result, plan);
  const bounds = rasterExportBounds(document, result, [], { booleanGeometryPlan: plan });
  assert.ok(bounds.x <= result.x - 110 && bounds.width >= 320);
  const viewBox = exportNodeToSvg(path, { document }).match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  assert.ok(viewBox[0] <= -110 && viewBox[2] >= 320);
  result.strokes = []; result.strokeWidth = 0; result.effects = [model.createLayerEffect('layer-blur', { radius: 10 })];
  const blurred = projectBooleanVectorPaintTree(document, result, plan);
  const blurBox = exportNodeToSvg(blurred, { document }).match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  assert.ok(blurBox[0] <= -130 && blurBox[2] >= 360, 'blur apron extends from actual filled ink');
});

test('unused source image paints are geometry inputs rather than export asset dependencies', () => {
  const document = model.createDocument(); const result = vectorResult(document);
  result.children[0].imageFill = { assetId: 'missing-unused-source', fit: 'cover', adjustments: { exposure: 1 } };
  const inputs = []; walkBooleanPaintInputs([result], entry => inputs.push(entry.node));
  assert.deepEqual(inputs, [result]);
  const legacy = { ...result }; delete legacy.booleanGeometry;
  const legacyInputs = []; walkBooleanPaintInputs([legacy], entry => legacyInputs.push(entry.node));
  assert.equal(legacyInputs.length, 3, 'legacy alpha masks still depend on operand image paints');
});

function sliceHelpers(document) {
  const start = main.indexOf('function hasDynamicFrameConstraints(node) {');
  const end = main.indexOf('async function refreshImagesForExport(', start);
  assert.ok(start >= 0 && end > start);
  return runInNewContext(`${main.slice(start, end)}\n({ sliceExportRootMayAffectCrop, sliceExportBackdropWorldBleed, sliceExportImageDependencyNeeded });`, {
    state: { document }, findNode: model.findNode, getNodePropertyValue: model.getNodePropertyValue,
    walkBooleanPaintInputs, firstBackdropEffect, glassEffectOverscan, glassVisibleForNode, sliceRasterBoundsIntersect,
    exportBoundsForNode: (id, booleanGeometryPlan) => {
      const entry = model.findNode(document, id);
      return rasterExportBounds(document, entry.node, entry.parents, { booleanGeometryPlan });
    }
  });
}

test('slice culling and backdrop bounds use export pins after preview cache eviction', async () => {
  disposeBooleanVectorGeometryCache(); const document = model.createDocument();
  for (let index = 0; index < 257; index++) vectorResult(document, 100 + index);
  const first = document.pages[0].children.at(-1);
  first.effects = [model.createLayerEffect('background-blur', { radius: 8 })];
  first.children[0].effects = [model.createLayerEffect('background-blur', { radius: 90 })];
  const plan = await prepareBooleanVectorExport(document, document.pages[0].children.map(node => node.id), { prepare });
  assert.throws(() => model.getBooleanVectorPath(document, first), /still being prepared/, 'the 257th region evicts the first preview');
  const helpers = sliceHelpers(document); const crop = { x: -60, y: 10, width: 20, height: 20 };
  assert.equal(helpers.sliceExportRootMayAffectCrop(first.id, crop, plan), true);
  assert.equal(helpers.sliceExportImageDependencyNeeded(first, crop, plan), true);
  assert.equal(helpers.sliceExportBackdropWorldBleed(document.pages[0], crop, { booleanGeometryPlan: plan }), 24,
    'only the group backdrop contributes; retained operand effects are not paints');
  first.children[0].width++;
  assert.throws(() => helpers.sliceExportRootMayAffectCrop(first.id, crop, plan), /changed|not prepared/);
});

test('a cold Boolean backdrop keeps slice Inspector estimates available without preparing geometry', () => {
  disposeBooleanVectorGeometryCache(); const document = model.createDocument(); const result = vectorResult(document);
  result.effects = [model.createLayerEffect('background-blur', { radius: 8 })];
  const helpers = sliceHelpers(document);
  assert.equal(helpers.sliceExportBackdropWorldBleed(document.pages[0], { x: -60, y: 0, width: 20, height: 20 }), 24);
  assert.throws(() => model.getBooleanVectorPath(document, result), /still being prepared/);
});

test('prepared Boolean alpha-mask SVG retains ordered source paints and applies layer opacity once', async () => {
  disposeBooleanVectorGeometryCache(); const document = model.createDocument();
  const source = model.createNode('boolean', { width: 100, height: 80, booleanGeometry: 'vector', opacity: .65,
    fills: [model.createFillLayer('solid', { color: '#ff0000', opacity: .4 }), model.createFillLayer('solid', { color: '#0000ff', opacity: .6 })],
    strokes: [createStroke({ color: '#00ff00', width: 4, opacity: .5, alignment: 'outside' })],
    children: [model.createNode('rectangle', { width: 100, height: 80 }), model.createNode('rectangle', { x: 30, y: 20, width: 20, height: 20 })] });
  const content = model.createNode('rectangle', { width: 100, height: 80, fill: '#fedcba' });
  const group = model.createNode('group', { width: 100, height: 80, mask: true, maskMode: 'alpha', maskSourceId: source.id, children: [source, content] });
  model.addNode(document, group);
  const plan = await prepareBooleanVectorExport(document, [group.id], { prepare });
  const markup = exportNodeToSvg(projectBooleanVectorPaintTree(document, group, plan), { document });
  const mask = markup.match(/<mask\b[^>]*id="tis-mask-0"[\s\S]*?<\/mask>/)?.[0];
  assert.ok(mask, 'the alpha mask contains the prepared source paint stream');
  assert.match(mask, /fill="#ff0000"[^>]*fill-opacity="0\.4"/);
  assert.match(mask, /fill="#0000ff"[^>]*fill-opacity="0\.6"/);
  assert.match(mask, /stroke="#00ff00"[^>]*stroke-opacity="0\.5"/);
  assert.equal((mask.match(/opacity="0\.65"/g) || []).length, 1);
});

test('selected-child export wrappers retain transforms and effects without duplicating ancestor paint stacks', () => {
  const document = model.createDocument();
  const child = model.createNode('rectangle', { x: 10, y: 20, width: 30, height: 40 });
  const parent = model.createNode('frame', { x: 50, y: 60, width: 100, height: 80, rotation: 15,
    fills: [model.createFillLayer('solid', { color: '#ff0000' })], strokes: [createStroke({ width: 10 })], children: [child] });
  model.addNode(document, parent);
  const start = main.indexOf('function exportRenderTree(nodeId) {');
  const end = main.indexOf('\nfunction orderedRootSelection()', start);
  const projected = runInNewContext(`${main.slice(start, end)}\nexportRenderTree('${child.id}');`, {
    state: { document }, findNode: model.findNode, structuredClone
  });
  assert.equal(projected.x, parent.x); assert.equal(projected.rotation, 15);
  assert.equal(projected.fills, undefined); assert.equal(projected.strokes, undefined);
  assert.equal(projected.fill, 'transparent'); assert.equal(projected.strokeWidth, 0);
  assert.equal(projected.children[0].id, child.id);
});

test('selected and page SVG exports reject concurrent edits before preparing or downloading stale work', async () => {
  for (const [name, next] of [['exportSelectedNodeSvg', 'exportActivePageSvg'], ['exportActivePageSvg', 'exportRasterPdf']]) {
    const document = model.createDocument(); const node = model.createNode('rectangle'); model.addNode(document, node);
    const state = { document, documentGeneration: 1, saveRevision: 1 };
    let preparations = 0; let downloads = 0;
    const start = main.indexOf(`async function ${name}(`); const end = main.indexOf(`async function ${next}(`, start);
    const promise = runInNewContext(`${main.slice(start, end)}\n${name}('${node.id}');`, {
      state, findNode: model.findNode, activePage: () => document.pages[0],
      imagePreviewsForSvgExport: async () => { state.saveRevision++; return new Map(); },
      prepareBooleanVectorExport: async () => { preparations++; return new Map(); },
      downloadSvg: () => { downloads++; }
    });
    await assert.rejects(promise, /design changed while SVG export/);
    assert.equal(preparations, 0); assert.equal(downloads, 0);
  }
});
