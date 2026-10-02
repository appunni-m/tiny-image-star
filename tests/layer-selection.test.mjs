import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isLayerSelectionTap, toggleLayerSelection } from '../src/layer-selection.js';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('layer selection toggles IDs without mutating or reordering the prior selection', () => {
  const selected = ['first', 'second'];
  const added = toggleLayerSelection(selected, 'third');
  assert.deepEqual(added, ['first', 'second', 'third']);
  assert.deepEqual(selected, ['first', 'second']);
  assert.deepEqual(toggleLayerSelection(added, 'second'), ['first', 'third']);
  assert.deepEqual(toggleLayerSelection(['first', 'first'], 'second'), ['first', 'second']);
});

test('layer selection rejects malformed input before returning a changed selection', () => {
  assert.throws(() => toggleLayerSelection(null, 'layer'), /must be an array/);
  assert.throws(() => toggleLayerSelection([], ''), /layer ID is required/);
  assert.throws(() => toggleLayerSelection([], null), /layer ID is required/);
});

test('canvas selection uses the final pointer-up position as well as observed movement', () => {
  const startClient = { x: 10, y: 10 };
  assert.equal(isLayerSelectionTap({ startClient, endClient: { x: 15, y: 15 } }), true);
  assert.equal(isLayerSelectionTap({ startClient, endClient: { x: 18, y: 10 } }), true,
    'movement exactly at touch slop remains a tap');
  assert.equal(isLayerSelectionTap({ startClient, endClient: { x: 19, y: 10 } }), false,
    'a distant pointer-up cancels tap selection even if no pointermove event was delivered');
  assert.equal(isLayerSelectionTap({ moved: true, startClient, endClient: startClient }), false);
  assert.equal(isLayerSelectionTap({ startClient, endClient: null }), false);
});

test('canvas Select mode toggles layers by tap before handles, anchor editing, dragging, or marquee', () => {
  const start = source.indexOf('function onCanvasPointerDown(event) {');
  const end = source.indexOf('\nfunction updateDraftShapeGeometry', start);
  assert.ok(start >= 0 && end > start, 'canvas pointer handling should have a bounded function body');
  const handler = source.slice(start, end);
  const modeStart = handler.indexOf('if (state.layerSelectionMode) {');
  const modeEnd = handler.indexOf('if (state.showRulers && !state.presenting)', modeStart);
  assert.ok(modeStart >= 0 && modeEnd > modeStart, 'tap selection mode should run before canvas editing handles');
  const mode = handler.slice(modeStart, modeEnd);
  assert.match(mode, /hitTestPage\(activePage\(\), world,[\s\S]*?\{ allowAnyClippedNodes: true \}\)/,
    'canvas selection mode should include clipped overflow layers');
  assert.match(mode, /kind: 'layer-selection-tap',[\s\S]*?nodeId: hit\.id/,
    'the hit target should be held as a tap candidate until pointer-up');
  assert.match(mode, /event\.preventDefault\(\);\s*return;/,
    'a selection tap must never fall through to transform, draw, drag, or marquee handling');

  const pinchTakeover = handler.indexOf("interruptedInteraction?.kind === 'layer-selection-tap'");
  assert.ok(pinchTakeover >= 0 && pinchTakeover < handler.indexOf('state.interaction = { kind: \'pinch\''),
    'a second finger should discard a pending layer tap before pinch navigation');
  const pointerMoveStart = source.indexOf('function onCanvasPointerMove(event) {');
  const pointerMoveEnd = source.indexOf('\nfunction onCanvasPointerUp(event)', pointerMoveStart);
  const pointerMove = source.slice(pointerMoveStart, pointerMoveEnd);
  assert.match(pointerMove, /interaction\.kind === 'layer-selection-tap'[\s\S]*?interaction\.moved = true;[\s\S]*?return;/,
    'finger movement should cancel tap selection rather than drag the layer');
  const pointerUpStart = pointerMoveEnd + 1;
  const pointerUpEnd = source.indexOf('\nfunction cancelCanvasInteraction', pointerUpStart);
  const pointerUp = source.slice(pointerUpStart, pointerUpEnd);
  assert.match(pointerUp, /interaction\.kind === 'layer-selection-tap'[\s\S]*?setSelection\(toggleLayerSelection\(state\.selectedIds, interaction\.nodeId\)\)/,
    'only a completed tap should toggle the canvas layer selection');
  assert.match(pointerUp, /isLayerSelectionTap\(\{[\s\S]*?endClient: \{ x: event\.clientX, y: event\.clientY \}[\s\S]*?\}, 8\)/,
    'pointer-up coordinates must enforce touch slop even when no pointer-move event was observed');
});

test('mobile Select mode tells people how canvas selection behaves and exposes it accessibly', () => {
  assert.match(source, /Tap canvas objects or layer rows to add or remove them from the selection\./);
  assert.match(source, /Design canvas\. Select mode is active\. Tap layers to add or remove them from the selection\./);
  assert.match(source, /selected · tap to add\/remove/);
});

test('enabling Select mode switches to the Select tool and exits image crop and erase modes', () => {
  const start = source.indexOf("$('#layer-select-mode').addEventListener('click', () => {");
  const end = source.indexOf("$('#layers-list').addEventListener('focusin'", start);
  assert.ok(start >= 0 && end > start, 'the mobile selection control should have a bounded handler');
  const handler = source.slice(start, end);
  assert.match(handler, /if \(enabled\)[\s\S]*?state\.imageEraseMode = false;[\s\S]*?state\.imageCropMode = false;[\s\S]*?setTool\('select'\);[\s\S]*?state\.layerSelectionMode = enabled;/,
    'Select mode must own canvas taps even when a drawing or image-edit tool was active');
});
