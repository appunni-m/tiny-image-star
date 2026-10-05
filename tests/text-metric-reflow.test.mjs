import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDocument, createNode, addNode, findNode, getNodePropertyValue, getNodeGeometry } from '../src/model.js';
import { calculateTextBox, preserveAutoWidthTextAnchor } from '../src/text-layout.js';

// Exercise the production font-ready queue and real layout, without browser gestures.
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('const pendingTextMetricReflows =');
const end = source.indexOf('function resizeTextLayers(', start);
assert.ok(start >= 0 && end > start);
function harness() {
  const document = createDocument(); const frames = []; const timers = []; let warm = false; let saves = 0;
  const context = { font: '20px Arial', textBaseline: 'top', textAlign: 'left', measureText: text => ({
    width: text.length * 10, actualBoundingBoxAscent: context.textBaseline === 'top' ? -5 : 12,
    actualBoundingBoxDescent: context.textBaseline === 'top' ? 21 : 4
  }) };
  const shaper = text => warm ? { upem: 1000, extents: { ascender: 800 }, leadingTrimMetrics: { capHeight: 700 },
    glyphs: [...text].map((_, index) => ({ cluster: index, xAdvance: 600 })) } : null;
  shaper.fontStatus = () => 'ready';
  const state = { document, ready: true, documentGeneration: 1, fontAssetEpoch: 1, shapeLocalTextRun: shaper };
  const api = new Function('state', 'requestAnimationFrame', 'setTimeout', 'findNode', 'applyAutoLayout', 'renderInspector',
    'renderer', 'queueSave', 'resolvedGeometry', 'calculateTextBox', 'getNodePropertyValue', 'preserveAutoWidthTextAnchor', 'hasTextMetricEdits',
    `let textMeasureContext = arguments[13];\n${source.slice(start, end)}\nreturn { resizeTextNode, queueTextMetricReflow, pending: pendingTextMetricReflows };`
  )(state, fn => { frames.push(fn); return frames.length; }, fn => timers.push(fn), findNode, () => {}, () => {},
    { invalidate() {} }, () => saves++, node => getNodeGeometry(state.document, node), calculateTextBox, getNodePropertyValue,
    preserveAutoWidthTextAnchor, roots => roots.some(node => node.leadingTrim?.type === 'CAP_HEIGHT'), context);
  const node = createNode('text', { text: 'Hg', textFit: 'auto-height', fontSize: 20, width: 100,
    leadingTrim: { type: 'CAP_HEIGHT' } }); addNode(document, node);
  return { api, node, state, frames, timers, warm: () => { warm = true; }, saves: () => saves,
    flush: () => { assert.ok(frames.length); frames.shift()(); } };
}

test('font-ready trim reflow waits for actual metrics and saves settled auto-height geometry once', () => {
  const h = harness(); h.api.resizeTextNode(h.node); const provisional = h.node.height;
  assert.equal(h.api.pending.size, 1);
  h.api.queueTextMetricReflow(); h.api.queueTextMetricReflow(); assert.equal(h.frames.length, 1);
  h.flush(); assert.equal(h.node.height, provisional); assert.equal(h.saves(), 0);
  h.warm(); h.api.queueTextMetricReflow(); h.flush();
  assert.equal(h.node.height, 14); assert.notEqual(h.node.height, provisional);
  assert.equal(h.node.fontSize, 20); assert.equal(h.api.pending.size, 0); assert.equal(h.saves(), 1);
  h.api.queueTextMetricReflow(); assert.equal(h.frames.length, 0);
});

test('font-ready callbacks cannot overwrite a changed layer or a different design head', () => {
  for (const change of [h => { h.node.text = 'new'; }, h => { h.state.documentGeneration++; },
    h => { h.state.fontAssetEpoch++; }, h => { h.state.document = createDocument(); }]) {
    const h = harness(); h.api.resizeTextNode(h.node); const height = h.node.height; change(h); h.warm();
    h.api.queueTextMetricReflow(); h.flush();
    assert.equal(h.node.height, height); assert.equal(h.api.pending.size, 0); assert.equal(h.saves(), 0);
  }
});

test('fixed text and connected guest copies are not changed by automatic metric reconciliation', () => {
  const fixed = harness(); fixed.node.textFit = 'fixed'; fixed.api.resizeTextNode(fixed.node);
  assert.equal(fixed.api.pending.size, 0); fixed.api.queueTextMetricReflow(); assert.equal(fixed.frames.length, 0);
  const guest = harness(); guest.api.resizeTextNode(guest.node); const height = guest.node.height;
  guest.state.liveCollaboration = { role: 'guest' }; guest.warm(); guest.api.queueTextMetricReflow(); guest.flush();
  assert.equal(guest.node.height, height); assert.equal(guest.saves(), 0);
});

test('metric reconciliation defers through an active editing gesture', () => {
  const h = harness(); h.api.resizeTextNode(h.node); h.warm(); h.state.interaction = { kind: 'move' };
  h.api.queueTextMetricReflow(); h.flush(); assert.equal(h.saves(), 0); assert.equal(h.timers.length, 1);
  h.state.interaction = null; h.timers.shift()(); h.flush(); assert.equal(h.node.height, 14); assert.equal(h.saves(), 1);
});
