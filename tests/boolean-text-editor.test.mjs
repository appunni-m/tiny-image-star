import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import * as hb from 'harfbuzzjs';
import decompress from 'woff2-encoder/decompress';
import * as model from '../src/model.js';
import { History } from '../src/history.js';
import { configureBooleanTextGeometry } from '../src/boolean-text-geometry.js';
import { prepareTextOutlineGeometry } from '../src/text-outline-geometry.js';
import { prepareBooleanVectorExport } from '../src/boolean-vector-export-preflight.js';
import { booleanGeometryWithKit } from '../src/vector-geometry-kernel.js';

const kit = await createRequire(import.meta.url)('canvaskit-wasm')({});
const bytes = await decompress(new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url))));
const face = new hb.Face(new hb.Blob(bytes));
const shape = (text, style) => {
  const font = new hb.Font(face); font.setScale(face.upem, face.upem);
  const buffer = new hb.Buffer(); buffer.addText(text); buffer.guessSegmentProperties(); hb.shape(font, buffer);
  return { upem: face.upem, extents: font.hExtents(),
    glyphs: buffer.getGlyphInfosAndPositions().map(g => ({ ...g, id: g.codepoint, path: font.glyphToPath(g.codepoint) })) };
};
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const extract = (start, end) => {
  const first = source.indexOf(start); const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first); return source.slice(first, last);
};
const production = 'let editorBooleanTextScope = null;\n'
  + extract('function currentBooleanFontRevision()', 'function documentUsesFontFamily(')
  + extract('async function combineSelectedBoolean(operation)', 'function groupSelectedLayers(');

function harness({ wait = () => {}, fail = false } = {}) {
  const document = model.createDocument(); const history = new History();
  const first = model.createNode('text', { text: 'O', fontFamily: 'Local Inter', fontSize: 60, width: 80, height: 80 });
  const second = model.createNode('text', { text: 'B', x: 40, fontFamily: 'Local Inter', fontSize: 60, width: 80, height: 80 });
  model.addNode(document, first); model.addNode(document, second);
  const state = { document, documentGeneration: 1, fontAssetEpoch: 1, fontAssets: new Map(), workspace: null,
    documentTransitioning: false, selectedIds: [first.id, second.id] };
  const calls = { opens: 0, closes: 0, glyphs: 0, saves: 0, checkpoints: 0, messages: [] };
  const context = {
    state, AbortController, DOMException, configureBooleanTextGeometry,
    prepareBooleanCombine: (doc, ids, op, pageId, options) => model.prepareBooleanCombine(doc, ids, op, pageId,
      { ...options, booleanGeometry: request => booleanGeometryWithKit(kit, request) }),
    prepareBooleanVectorPath: (doc, node, options) => model.prepareBooleanVectorPath(doc, node,
      { ...options, booleanGeometry: request => booleanGeometryWithKit(kit, request) }),
    prepareBooleanVectorExport,
    validateBooleanCombinePlan: model.validateBooleanCombinePlan, applyBooleanCombine: model.applyBooleanCombine,
    createTextOutlinePreparation: sourceDocument => {
      calls.opens++; let closed = false;
      return { close() { assert.equal(closed, false); closed = true; calls.closes++; },
        async getTextOutline(candidate, node, options) {
          assert.equal(closed, false); assert.equal(sourceDocument, document); assert.equal(candidate.id, document.id);
          assert.equal(options.allowDocumentSnapshot, true); calls.glyphs++; await wait(state);
          if (fail) throw new Error('Add the retained font in Assets → Fonts.');
          return prepareTextOutlineGeometry(candidate, node, { ...options, shapeText: shape });
        } };
    },
    isLiveHostViewOnly: () => false, isImageRecipeBatchActive: () => false,
    rootSelectedIds: () => state.selectedIds, renderInspector: () => {}, renderUI: () => {},
    checkpoint: label => { history.checkpoint(state.document, label); calls.checkpoints++; },
    setSelection: ids => { state.selectedIds = ids; }, queueSave: () => { calls.saves++; },
    renderer: { invalidate() {} }, showToast: message => calls.messages.push(message)
  };
  const vm = runInNewContext(`${production}\n({run:()=>combineSelectedBoolean('union'),
    configure:()=>configureEditorBooleanTextGeometry(),revision:()=>currentBooleanFontRevision()})`, context);
  return { document, first, second, state, history, calls, ...vm };
}

test('production text Boolean command owns one font session and commits one undoable editable group', async () => {
  const h = harness(); const before = model.cloneDocument(h.document);
  await h.run();
  assert.equal(h.calls.opens, 1, h.calls.messages.join("; ")); assert.equal(h.calls.closes, 1); assert.equal(h.calls.glyphs, 2);
  assert.equal(h.calls.checkpoints, 1); assert.equal(h.calls.saves, 1);
  const group = h.document.pages[0].children[0];
  assert.equal(group.type, 'boolean'); assert.equal(group.booleanGeometry, 'vector');
  assert.equal(group.children[0], h.first); assert.equal(group.children[1], h.second);
  assert.ok(model.getBooleanVectorPath(h.document, group).points.length, 'completed geometry outlives its closed font session');
  assert.deepEqual(h.history.undo(h.document), before);
});

test('production text Boolean failures, cancellation and workspace changes never create history or partial groups', async () => {
  for (const mode of ['font', 'cancel', 'workspace']) {
    const h = harness({ fail: mode === 'font', wait: state => {
      if (mode === 'cancel') state.booleanController.abort();
      if (mode === 'workspace') state.workspace = {};
    } });
    const before = model.cloneDocument(h.document); await h.run();
    assert.deepEqual(h.document, before, mode); assert.equal(h.history.canUndo, false, mode);
    assert.equal(h.calls.saves, 0); assert.equal(h.calls.checkpoints, 0);
    assert.equal(h.calls.opens, h.calls.closes); assert.equal(h.state.booleanController, null);
  }
});

test('font catalog and generation revisions invalidate production Boolean text pins while stable configuration retains them', async () => {
  const h = harness(); await h.run(); const group = h.document.pages[0].children[0];
  const key = model.getBooleanVectorGeometryKey(h.document, group); h.configure(); h.configure();
  assert.equal(model.getBooleanVectorGeometryKey(h.document, group), key, 'redraws do not discard ready glyph geometry');
  h.state.fontAssets.set('font-new', { id: 'font-new', family: 'Replacement', weight: 400 });
  assert.throws(() => model.getBooleanVectorGeometryKey(h.document, group), /prepar|font|changed|stale/iu);
  const revision = h.revision(); h.state.documentGeneration++;
  assert.notEqual(h.revision(), revision);
  assert.throws(() => model.getBooleanVectorGeometryKey(h.document, group), /design|changed|stale/iu);
});
