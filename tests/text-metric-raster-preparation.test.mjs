import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDocument, createNode, addNode, findNode } from '../src/model.js';
import { rasterExportBounds } from '../src/raster-export-bounds.js';
import { walkBooleanPaintInputs } from '../src/boolean-vector-export-preflight.js';
import { withPreparedTextPositionShapes } from '../src/text-position-export-preparation.js';

// Execute the production raster orchestration with controlled surfaces/font work.
// Pixel fidelity is separate; these controls prove font pinning, fencing and cleanup.
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const extract = (start, end) => {
  const index = source.indexOf(start); const stop = source.indexOf(end, index);
  assert.ok(index >= 0 && stop > index); return source.slice(index, stop);
};
const production = extract('let exportInkMeasureContext = null;', 'function exportDimensions(')
  + extract('function hasTextMetricEdits(', 'async function preparePositionedSvg(')
  + extract('async function renderExportBlob(', 'function downloadBlob(');
function harness({ cold = false, trim = true, onWait = () => {} } = {}) {
  const doc = createDocument(); const node = createNode('text', { text: 'H', fontSize: 20,
    width: 20, height: 5, ...(trim ? { leadingTrim: { type: 'CAP_HEIGHT' } } : {}), stroke: null }); addNode(doc, node);
  const ready = new Map(); const queued = new Set(); const surfaces = []; const renderShapers = [];
  const shaper = text => {
    if (!cold || ready.has(text)) return { upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 }, leadingTrimMetrics: { capHeight: 700 },
      glyphs: [{ id: 1, cluster: 0, xAdvance: 600, path: 'M0 0L500 700Z' }] };
    if (!queued.has(text)) { queued.add(text); setTimeout(() => { onWait(state); ready.set(text, true); }, 1); }
    return null;
  }; shaper.fontStatus = () => 'ready';
  const state = { document: doc, documentGeneration: 1, saveRevision: 0, fontAssetEpoch: 1, assets: new Map() };
  const renderer = { getState: () => state, drawNode(context, tree) {
    const pinned = this.getState().shapeLocalTextRun;
    renderShapers.push(pinned);
    const shape = pinned('paint', tree);
    if (!shape) throw new Error('Unprepared text paint must not publish.');
    context.paint = shape.leadingTrimMetrics.capHeight;
  } };
  const browserDocument = { fonts: { ready: Promise.resolve() }, createElement() {
    const context = { scale() {}, translate() {}, fillRect() {} };
    const canvas = { width: 1, height: 1, getContext: () => context, toBlob: cb =>
      cb(new Blob([String(context.paint)], { type: 'image/png' })) };
    surfaces.push(canvas); return canvas;
  } };
  const names = ['state', 'findNode', 'document', 'rasterExportBounds', 'localTextInkBounds', 'shapeLocalTextRun',
    'withPreparedTextPositionShapes', 'walkBooleanPaintInputs', 'exportRenderTree', 'renderer', 'abortIfExportCanceled',
    'prepareEditorBooleanVectorExport', 'refreshImagesForExport', 'prepareRasterExportMasks', 'safeExportName'];
  const render = new Function(...names, production + 'return renderExportBlob;')(state, findNode, browserDocument,
    rasterExportBounds, (_doc, text, shapeText) => {
      const shape = shapeText('bounds', text);
      if (!shape) throw new Error('Unprepared text bounds must not publish.');
      return { left: 0, top: 0, right: text.width, bottom: shape.leadingTrimMetrics.capHeight / shape.upem * text.fontSize };
    }, shaper, withPreparedTextPositionShapes, walkBooleanPaintInputs, id => structuredClone(findNode(doc, id).node),
    renderer, signal => { if (signal?.aborted) throw new DOMException('Canceled', 'AbortError'); },
    async () => null, async () => {}, async () => {}, value => value);
  return { state, node, renderer, surfaces, renderShapers, shaper,
    run: options => render([node.id], { format: 'png', scale: 1 }, 'trim', { rawPng: true, ...options }) };
}

test('cold raster exports pin metric queries through bounds and asynchronous paint, preserving source and renderer state', async () => {
  const warm = harness(); const cold = harness({ cold: true }); const source = structuredClone(cold.state.document);
  const reference = await warm.run(); const output = await cold.run();
  assert.deepEqual([output.width, output.height], [reference.width, reference.height]);
  assert.equal(await output.blob.text(), await reference.blob.text());
  assert.ok(cold.renderShapers.length > 1, 'the cold paint query must cause a whole-pipeline retry');
  assert.ok(cold.renderShapers.every(shaper => shaper !== cold.shaper));
  assert.equal(cold.renderer.getState().shapeLocalTextRun, undefined, 'export cannot replace the live renderer callback');
  assert.deepEqual(cold.state.document, source);
  assert.ok(cold.surfaces.slice(1).every(surface => surface.width === 0 && surface.height === 0));
});

test('font epoch changes and cancellation stop cold raster export before download', async () => {
  const changed = harness({ cold: true, onWait: state => { state.fontAssetEpoch++; } });
  await assert.rejects(changed.run(), /design changed/u);
  const controller = new AbortController(); const canceled = harness({ cold: true, onWait: () => controller.abort() });
  await assert.rejects(canceled.run({ signal: controller.signal }), error => error.name === 'AbortError');
  assert.ok(canceled.surfaces.slice(1).every(surface => surface.width === 0 && surface.height === 0));
});

test('ordinary text raster exports prepare cold local font queries before publishing', async () => {
  const warm = harness({ trim: false }); const cold = harness({ trim: false, cold: true });
  const source = structuredClone(cold.state.document);
  const reference = await warm.run(); const output = await cold.run();
  assert.deepEqual([output.width, output.height], [reference.width, reference.height]);
  assert.equal(await output.blob.text(), await reference.blob.text());
  assert.ok(cold.renderShapers.every(shaper => shaper.isPreparedTextExport));
  assert.deepEqual(cold.state.document, source);
});
