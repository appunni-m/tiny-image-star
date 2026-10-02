import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shouldCancelShapeBuilderOnPinch, shouldRecoverCanvasInteractionForDelete, shouldRouteCanvasPointerCompletion } from '../src/canvas-pointer-lifecycle.js';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('an uncaptured pointer release is routed only for the active canvas pointer', () => {
  const canvas = { contains: target => target === 'canvas' };
  const pointers = new Map([[8, {}]]);

  assert.equal(shouldRouteCanvasPointerCompletion({ type: 'pointerup', target: 'panel', pointerId: 8 }, canvas, pointers), true);
  assert.equal(shouldRouteCanvasPointerCompletion({ type: 'pointercancel', target: 'body', pointerId: 8 }, canvas, pointers), true);
  assert.equal(shouldRouteCanvasPointerCompletion({ type: 'pointerup', target: 'canvas', pointerId: 8 }, canvas, pointers), false,
    'canvas-targeted releases stay on the original canvas event path');
  assert.equal(shouldRouteCanvasPointerCompletion({ type: 'pointerup', target: 'panel', pointerId: 9 }, canvas, pointers), false,
    'unrelated pointers cannot finish the active gesture');
  assert.equal(shouldRouteCanvasPointerCompletion({ type: 'click', target: 'panel', pointerId: 8 }, canvas, pointers), false);
});

test('outside-canvas pointer completion and window blur both clear unfinished gestures', () => {
  assert.match(source, /document\.addEventListener\('pointerup', event => \{[\s\S]*?shouldRouteCanvasPointerCompletion\(event, canvas, state\.pointerMap\)[\s\S]*?onCanvasPointerUp\(event\);[\s\S]*?\}, true\);/,
    'a release outside the captured canvas must finish its pending interaction');
  assert.match(source, /document\.addEventListener\('pointercancel', event => \{[\s\S]*?shouldRouteCanvasPointerCompletion\(event, canvas, state\.pointerMap\)[\s\S]*?cancelCanvasInteraction\(event\);[\s\S]*?\}, true\);/,
    'a cancel outside the captured canvas must roll back its pending interaction');
  assert.match(source, /window\.addEventListener\('blur', \(\) => \{[\s\S]*?if \(state\.interaction\) cancelCanvasInteraction\([\s\S]*?else state\.pointerMap\.clear\(\);[\s\S]*?\}\);/,
    'losing the browser window must not leave keyboard shortcuts blocked by a stale gesture');
});

test('Delete and Backspace recover a stale canvas interaction even when pointer tracking is stale', () => {
  assert.equal(shouldRecoverCanvasInteractionForDelete('Delete', { kind: 'move' }, false), true);
  assert.equal(shouldRecoverCanvasInteractionForDelete('Backspace', { kind: 'move' }, false), true);
  assert.equal(shouldRecoverCanvasInteractionForDelete('Delete', { kind: 'move' }, true), false);
  assert.equal(shouldRecoverCanvasInteractionForDelete('Escape', { kind: 'move' }, false), false);
  assert.equal(shouldRecoverCanvasInteractionForDelete('Delete', null, false), false);

  const keyHandler = source.slice(source.indexOf('function onKeyDown(event) {'));
  const recovery = keyHandler.indexOf('shouldRecoverCanvasInteractionForDelete(event.key, state.interaction, editing)');
  const interactionGate = keyHandler.indexOf('if (state.interaction) { event.preventDefault(); return; }');
  assert.ok(recovery >= 0 && interactionGate > recovery,
    'a stale gesture must be cancelled before the global key handler suppresses Delete/Backspace');
  assert.match(keyHandler, /shouldRecoverCanvasInteractionForDelete\(event\.key, state\.interaction, editing\)[\s\S]*?cancelCanvasInteraction\(\{ pointerId: state\.interaction\.pointerId \}\)/);
});

test('a second touch cancels an unfinished Shape Builder sample without committing it', () => {
  assert.equal(shouldCancelShapeBuilderOnPinch({ kind: 'shape-builder', pointerId: 4 }), true);
  assert.equal(shouldCancelShapeBuilderOnPinch({ kind: 'move', pointerId: 4 }), false);
  assert.equal(shouldCancelShapeBuilderOnPinch(null), false);

  const pointerDownStart = source.indexOf('function onCanvasPointerDown(event) {');
  const pointerDownEnd = source.indexOf('\nfunction updateDraftShapeGeometry', pointerDownStart);
  const pointerDown = source.slice(pointerDownStart, pointerDownEnd);
  const takeover = pointerDown.indexOf('shouldCancelShapeBuilderOnPinch(interruptedInteraction)');
  const genericFinish = pointerDown.indexOf('onCanvasPointerUp({ pointerId, type: \'pointerup\' })', takeover);
  assert.ok(takeover >= 0 && genericFinish > takeover,
    'pinch takeover must discard Shape Builder before the generic gesture-finish path');
  assert.match(pointerDown.slice(takeover, genericFinish), /state\.interaction = null;[\s\S]*?state\.shapeBuilder\.previewContours = \[\]/,
    'the in-progress region samples and preview must be cleared without calling the commit handler');
});
