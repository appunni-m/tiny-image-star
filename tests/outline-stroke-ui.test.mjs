import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { addNode, cloneDocument, createDocument, createNode } from '../src/model.js';
import { History } from '../src/history.js';
import { prepareOutlineStroke, validateOutlineStrokePlan, applyOutlineStroke, outlineStrokeUnavailableReason } from '../src/outline-stroke.js';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const start = main.indexOf('async function outlineSelectedStrokes() {');
const end = main.indexOf('\nfunction applyVectorOffset()', start);
assert.ok(start >= 0 && end > start);
const handler = main.slice(start, end);

function harness(work = async () => ({ commands: new Float32Array([0,0,-1,1,120,-1,1,120,1,1,0,1,5]), fillRule:'nonzero', bounds:{left:0,top:-1,right:120,bottom:1} })) {
  const document = createDocument(); const node = createNode('line'); addNode(document, node);
  const before = cloneDocument(document); const history = new History(); const events = [];
  const state = { document, selectedIds:[node.id], documentTransitioning:false, outlineStrokeController:null };
  const context = {
    state, AbortController, DOMException,
    LocalVectorGeometryClient: class {
      constructor() { events.push('create-client'); }
      outlineStroke(...args) { return work(...args); }
      close() { events.push('close-client'); }
    },
    rootSelectedIds: () => state.selectedIds,
    outlineStrokeReason: () => outlineStrokeUnavailableReason(state.document, state.selectedIds),
    isLiveHostViewOnly: () => false, isImageRecipeBatchActive: () => false,
    prepareOutlineStroke, validateOutlineStrokePlan, applyOutlineStroke,
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
