import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { addNode, cloneDocument, createDocument, createNode, findNode } from '../src/model.js';
import { History } from '../src/history.js';
import { prepareOutlineStroke, validateOutlineStrokePlan, applyOutlineStroke, outlineStrokeUnavailableReason } from '../src/outline-stroke.js';
import { collectTextOutlineGeometry } from '../src/text-outline-geometry.js';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const start = main.indexOf('async function outlineSelectedStrokes() {');
const end = main.indexOf('\nfunction applyVectorOffset()', start);
assert.ok(start >= 0 && end > start);
const handler = main.slice(start, end);

function harness(work = async () => ({ commands: new Float32Array([0,0,-1,1,120,-1,1,120,1,1,0,1,5]), fillRule:'nonzero', bounds:{left:0,top:-1,right:120,bottom:1} }), { type = 'line', properties = {}, textPreparation } = {}) {
  const document = createDocument(); const node = createNode(type, properties); addNode(document, node);
  const before = cloneDocument(document); const history = new History(); const events = [];
  const state = { document, selectedIds:[node.id], documentTransitioning:false, outlineStrokeController:null };
  const context = {
    state, AbortController, DOMException, setTimeout, clearTimeout,
    LocalVectorGeometryClient: class {
      constructor() { events.push('create-client'); }
      outlineStroke(...args) { return work(...args); }
      close() { events.push('close-client'); }
    },
    rootSelectedIds: () => state.selectedIds,
    outlineStrokeReason: () => outlineStrokeUnavailableReason(state.document, state.selectedIds),
    isLiveHostViewOnly: () => false, isImageRecipeBatchActive: () => false,
    prepareOutlineStroke, validateOutlineStrokePlan, applyOutlineStroke, findNode,
    createTextOutlinePreparation: (design, signal) => {
      events.push('create-font-session');
      return textPreparation(design, signal);
    },
    renderInspector: () => events.push('inspector'), showToast: message => events.push(message),
    checkpoint: label => { history.checkpoint(state.document, label); events.push('checkpoint'); },
    clearVectorAnchorSelection: () => {}, setSelection: ids => { state.selectedIds = ids; },
    renderUI: () => events.push('ui'), queueSave: () => events.push('save'), renderer:{ invalidate:() => events.push('render') },
  };
  return { state, node, before, history, events, context, run: () => runInNewContext(`${handler}\noutlineSelectedStrokes();`, context) };
}

test('the production Outline Stroke handler commits and saves once, then releases its own worker', async () => {
  const h = harness(); await h.run();
  assert.equal(h.node.type, 'path'); assert.deepEqual(h.state.selectedIds, [h.node.id]);
  assert.equal(h.events.filter(event => event === 'checkpoint').length, 1);
  assert.equal(h.events.filter(event => event === 'save').length, 1);
  assert.equal(h.events.filter(event => event === 'close-client').length, 1);
  assert.equal(h.state.outlineStrokeController, null);
  assert.deepEqual(h.history.undo(h.state.document), h.before);
});

test('failed or cancelled UI conversion releases the worker and neither saves nor adds undo history', async () => {
  for (const mode of ['error','cancel']) {
    const h = harness(async (_geometry, _stroke, { signal }) => {
      if (mode === 'cancel') { h.state.outlineStrokeController.abort(); assert.equal(signal.aborted, true); }
      throw mode === 'cancel' ? new DOMException('Cancelled', 'AbortError') : new Error('Runtime load failed');
    });
    await h.run();
    assert.deepEqual(h.state.document, h.before);
    assert.equal(h.history.canUndo, false); assert.equal(h.events.includes('save'), false);
    assert.equal(h.events.filter(event => event === 'close-client').length, 1);
    assert.equal(h.state.outlineStrokeController, null);
  }
});

test('switching designs while the worker runs cannot apply old geometry to either design', async () => {
  let release;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  const original = h.state.document;
  const running = h.run();
  const next = createDocument(); h.state.document = next;
  release({ commands: new Float32Array([0,0,-1,1,120,-1,1,120,1,1,0,1,5]), fillRule:'nonzero', bounds:{left:0,top:-1,right:120,bottom:1} });
  await running;
  assert.deepEqual(original, h.before); assert.equal(next.pages[0].children.length, 0);
  assert.equal(h.history.canUndo, false); assert.equal(h.events.includes('save'), false);
  assert.equal(h.events.includes('close-client'), true);
});

test('the whole conversion has one deadline and keeps originals when that deadline expires', async () => {
  let expire; let cleared = false;
  const h = harness((_geometry, _stroke, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  h.context.setTimeout = (callback, delay) => { assert.equal(delay, 60_000); expire = callback; return 1; };
  h.context.clearTimeout = handle => { assert.equal(handle, 1); cleared = true; };
  const running = h.run(); expire(); await running;
  assert.equal(cleared, true); assert.deepEqual(h.state.document, h.before);
  assert.equal(h.history.canUndo, false); assert.equal(h.events.includes('save'), false);
  assert.ok(h.events.some(event => typeof event === 'string' && event.includes('took too long')));
  assert.equal(h.events.filter(event => event === 'close-client').length, 1);
});

function localGlyphs(text) {
  return { upem: 1000, extents: { ascender: 800 }, missingGlyph: false,
    glyphs: [...text].map((character, cluster) => ({ id: 1, cluster, xAdvance: 600,
      yAdvance: 0, xOffset: 0, yOffset: 0,
      path: character === ' ' ? '' : 'M0 0L600 0L600 700L0 700Z' })) };
}

test('the production text command uses local glyph geometry without a stroke and saves one undoable edit', async () => {
  let h;
  h = harness(async () => { throw new Error('Unstroked text must not request stroke geometry'); }, {
    type: 'text', properties: { text: 'AB', width: 200, height: 80, fontSize: 20, fills: undefined, strokes: [], strokeWidth: 0 },
    textPreparation: (design, signal) => ({
      getTextOutline: (source, node) => {
        assert.equal(source, design); assert.equal(signal.aborted, false);
        return collectTextOutlineGeometry(source, node, { shapeText: localGlyphs, signal });
      },
      validateCurrent: () => h.events.push('validate-font-session'),
      close: () => h.events.push('close-font-session')
    })
  });
  await h.run();
  assert.equal(h.node.type, 'group'); assert.equal(h.node.children.length, 2);
  assert.ok(h.node.children.every(node => node.type === 'path' && node.closed));
  assert.deepEqual(h.state.selectedIds, [h.node.id]);
  assert.ok(h.events.indexOf('validate-font-session') < h.events.indexOf('checkpoint'));
  for (const event of ['checkpoint', 'save', 'close-font-session', 'close-client']) assert.equal(h.events.filter(value => value === event).length, 1);
  assert.deepEqual(h.history.undo(h.state.document), h.before);
});

test('font preparation failure or a stale font snapshot keeps all originals and releases both sessions', async () => {
  for (const mode of ['missing-font', 'stale-font']) {
    let h;
    h = harness(undefined, {
      type: 'text', properties: { text: 'A', width: 200, height: 80, fills: undefined, strokes: [], strokeWidth: 0 },
      textPreparation: (_design, signal) => ({
        getTextOutline: (design, node) => {
          if (mode === 'missing-font') throw new Error('Load a local font with complete glyph coverage.');
          return collectTextOutlineGeometry(design, node, { shapeText: localGlyphs, signal });
        },
        validateCurrent: () => { throw new DOMException('Fonts changed', 'AbortError'); },
        close: () => h.events.push('close-font-session')
      })
    });
    await h.run();
    assert.deepEqual(h.state.document, h.before); assert.equal(h.history.canUndo, false);
    assert.equal(h.events.includes('checkpoint'), false); assert.equal(h.events.includes('save'), false);
    assert.equal(h.state.outlineStrokeController, null);
    for (const event of ['close-font-session', 'close-client']) assert.equal(h.events.filter(value => value === event).length, 1);
  }
});
