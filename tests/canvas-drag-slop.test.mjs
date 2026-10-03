import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beginCanvasDragAfterSlop, CANVAS_TOUCH_DRAG_THRESHOLD_PX } from '../src/canvas-drag-slop.js';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function touchInteraction(kind = 'move') {
  return {
    kind,
    pointerId: 7,
    pointerType: 'touch',
    startClient: { x: 100, y: 80 },
    dragStarted: false
  };
}

function pointerMove(x, y, pointerId = 7) {
  return { pointerId, pointerType: 'touch', clientX: x, clientY: y };
}

test('touch jitter stays below the drag threshold and an intentional drag starts once', () => {
  assert.equal(CANVAS_TOUCH_DRAG_THRESHOLD_PX, 8);
  const interaction = touchInteraction();

  assert.equal(beginCanvasDragAfterSlop(interaction, pointerMove(104, 84)), false,
    'sub-threshold diagonal finger movement must not move a selected layer');
  assert.equal(beginCanvasDragAfterSlop(interaction, pointerMove(108, 80)), false,
    'movement exactly at the threshold remains a tap');
  assert.equal(beginCanvasDragAfterSlop(interaction, pointerMove(109, 80)), true,
    'crossing the threshold starts a deliberate drag');
  assert.equal(interaction.dragStarted, true);
  assert.equal(beginCanvasDragAfterSlop(interaction, pointerMove(109, 80)), true,
    'once started, the drag remains active even if later events have no delta');
});

test('only the active touch can cross slop; mouse and pen remain immediate', () => {
  const interaction = touchInteraction('reorder');
  assert.equal(beginCanvasDragAfterSlop(interaction, pointerMove(130, 80, 8)), false,
    'a second pointer cannot begin reordering the first pointer\'s layer');
  assert.equal(interaction.dragStarted, false);
  for (const pointerType of ['mouse', 'pen']) {
    const immediate = { ...touchInteraction(), pointerType };
    assert.equal(beginCanvasDragAfterSlop(immediate, { ...pointerMove(100, 80), pointerType }), true,
      `${pointerType} interaction should remain responsive without touch slop`);
  }
});

test('invalid touch coordinates and unrelated interaction kinds cannot start a drag', () => {
  const interaction = touchInteraction();
  assert.equal(beginCanvasDragAfterSlop(interaction, { ...pointerMove(120, 80), clientX: NaN }), false);
  assert.equal(beginCanvasDragAfterSlop({ ...interaction, kind: 'resize' }, pointerMove(120, 80)), false);
  assert.equal(interaction.dragStarted, false);
});

test('canvas move and auto-layout reorder both gate mutations before processing touch movement', () => {
  assert.match(source, /from '\.\/canvas-drag-slop\.js'/);
  const pointerMoveStart = source.indexOf('function onCanvasPointerMove(event) {');
  const pointerMoveEnd = source.indexOf('\nfunction onCanvasPointerUp(event)', pointerMoveStart);
  const pointerMoveHandler = source.slice(pointerMoveStart, pointerMoveEnd);
  for (const kind of ['move', 'reorder']) {
    const branch = pointerMoveHandler.indexOf(`interaction.kind === '${kind}'`);
    assert.ok(branch >= 0, `expected ${kind} gesture handling`);
    const gate = pointerMoveHandler.indexOf('beginCanvasDragAfterSlop(interaction, event)', branch);
    const nextBranch = pointerMoveHandler.indexOf("interaction.kind === '", branch + 1);
    assert.ok(gate > branch && (nextBranch < 0 || gate < nextBranch),
      `${kind} must check touch slop before applying movement/reorder`);
    const gateStatementStart = pointerMoveHandler.lastIndexOf('if (', gate);
    const gateStatementEnd = pointerMoveHandler.indexOf(';', gate);
    assert.match(pointerMoveHandler.slice(gateStatementStart, gateStatementEnd + 1),
      /beginCanvasDragAfterSlop\(interaction, event\).*return;/,
      `${kind} slop check must return before mutating the interaction`);
  }
});
