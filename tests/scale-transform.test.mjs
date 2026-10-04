import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ANCHOR_COORDINATES, planScaleTransform } from '../src/scale-transform.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';
import { selectionBounds } from '../src/group-transform.js';

function close(actual, expected, epsilon = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test('all nine scale anchors preserve their page-space point through rotation and nesting', () => {
  const parent = { id: 'parent', x: 80, y: 35, width: 200, height: 120, rotation: 27 };
  const node = { id: 'root', x: 12, y: 18, width: 80, height: 40, rotation: -19, children: [] };
  const entries = [{ node, ancestors: [parent] }];
  const before = selectionBounds([{ node, ancestors: [parent] }]);
  for (const anchorName of Object.keys(ANCHOR_COORDINATES)) {
    const plan = planScaleTransform(entries, 1.75, anchorName);
    const patch = plan.patches.find(item => item.id === node.id);
    const after = selectionBounds([{ node: { ...node, ...patch }, ancestors: [parent] }]);
    const [anchorX, anchorY] = ANCHOR_COORDINATES[anchorName];
    close(after.x + after.width * anchorX, before.x + before.width * anchorX);
    close(after.y + after.height * anchorY, before.y + before.height * anchorY);
    close(patch.width, 140);
    close(patch.height, 70);
  }
});

test('scale plan propagates frame children and appearance including text, strokes, effects and corners', () => {
  const text = {
    id: 'text', type: 'text', x: 8, y: 12, width: 60, height: 20, rotation: 0,
    fontSize: 14, letterSpacing: 1.5, lineHeight: 18, lineHeightUnit: 'pixels',
    textRuns: [{ text: 'hello', fontSize: 12, letterSpacing: 1, baselineShift: 2 }],
    paragraphStyles: [{ paragraphSpacing: 4, firstLineIndent: 2 }], children: []
  };
  const shape = {
    id: 'shape', type: 'rectangle', x: 30, y: 15, width: 40, height: 30, rotation: 0,
    strokeWidth: 3, strokeDashArray: [2, 4],
    strokes: [{ id: 'stroke', width: 3, sideWidths: { top: 2, right: 3, bottom: 4, left: 5 } }],
    effects: [{ id: 'shadow', type: 'drop-shadow', offsetX: 2, offsetY: 4, blur: 6 }, { id: 'blur', type: 'layer-blur', radius: 3 }],
    radius: 8, cornerRadii: { topLeft: 2, topRight: 4, bottomRight: 6, bottomLeft: 8 }, children: []
  };
  const frame = { id: 'frame', type: 'frame', x: 10, y: 20, width: 100, height: 80, rotation: 0,
    autoLayout: { axis: 'vertical' }, children: [text, shape] };
  const plan = planScaleTransform([{ node: frame, ancestors: [] }], 2, 'center');
  const patches = new Map(plan.patches.map(patch => [patch.id, patch]));

  assert.equal(patches.get('frame').width, 200);
  assert.equal(patches.get('text').x, 16);
  assert.equal(patches.get('text').width, 120);
  assert.equal(patches.get('text').fontSize, 28);
  assert.equal(patches.get('text').lineHeight, 36);
  assert.equal(patches.get('text').textRuns[0].fontSize, 24);
  assert.equal(patches.get('text').textRuns[0].baselineShift, 4);
  assert.equal(patches.get('text').paragraphStyles[0].paragraphSpacing, 8);
  assert.equal(patches.get('shape').strokes[0].sideWidths.left, 10);
  assert.deepEqual(patches.get('shape').strokeDashArray, [4, 8]);
  assert.deepEqual(patches.get('shape').effects.map(effect => [effect.offsetX, effect.offsetY, effect.blur, effect.radius]), [
    [4, 8, 12, undefined], [undefined, undefined, undefined, 6]
  ]);
  assert.equal(patches.get('shape').cornerRadii.topLeft, 4);
  assert.equal(patches.get('text').layoutPositioning, 'absolute');
  assert.equal(patches.get('shape').layoutPositioning, 'absolute');
});

test('locked nodes and descendants inside component instances are excluded without mutating input', () => {
  const nested = { id: 'nested', x: 1, y: 2, width: 10, height: 10, rotation: 0, children: [] };
  const locked = { id: 'locked', x: 20, y: 2, width: 10, height: 10, rotation: 0, locked: true, children: [] };
  const ordinary = { id: 'ordinary', x: 40, y: 2, width: 10, height: 10, rotation: 0, children: [] };
  const instance = { id: 'instance', x: 60, y: 2, width: 20, height: 20, rotation: 0, isInstance: true, children: [nested] };
  const root = { id: 'root', x: 0, y: 0, width: 100, height: 40, rotation: 0, children: [locked, ordinary, instance] };
  const before = structuredClone(root);
  const plan = planScaleTransform([{ node: root, ancestors: [] }, { node: nested, ancestors: [root, instance] }], 2, 'center');
  const ids = new Set(plan.patches.map(patch => patch.id));

  assert.deepEqual([...ids], ['root', 'ordinary']);
  assert.ok(plan.excludedIds.includes('locked'));
  assert.ok(plan.excludedIds.includes('instance'));
  assert.deepEqual(root, before, 'planning must be atomic and leave the design untouched');
  const nestedOnly = planScaleTransform([{ node: nested, ancestors: [root, instance] }], 2, 'center');
  assert.deepEqual(nestedOnly.patches, []);
  assert.ok(nestedOnly.excludedIds.includes('nested'));
});

test('scale rejects invalid or overflowing plans before returning any mutations', () => {
  const root = { id: 'root', x: 0, y: 0, width: 60_000, height: 20, rotation: 0, children: [] };
  assert.throws(() => planScaleTransform([{ node: root, ancestors: [] }], 2), /100,000-unit/);
  assert.throws(() => planScaleTransform([{ node: root, ancestors: [] }], 0), /positive finite/);
  assert.equal(root.width, 60_000);
});

test('scale refuses shared variable-bound geometry without editing the selection', () => {
  const variableId = 'variable-shared-width';
  const left = {
    id: 'left', x: 0, y: 0, width: 40, height: 20, rotation: 0,
    variableBindings: { width: variableId }, children: []
  };
  const right = {
    id: 'right', x: 60, y: 0, width: 40, height: 20, rotation: 0,
    variableBindings: { width: variableId }, children: []
  };
  const before = structuredClone([left, right]);

  assert.throws(
    () => planScaleTransform([{ node: left }, { node: right }], 1.5),
    error => error instanceof TypeError
      && /width is bound to a variable/.test(error.message)
      && /could change other layers or modes/.test(error.message)
      && /cannot inspect all variable consumers/.test(error.message)
  );
  assert.deepEqual([left, right], before, 'a rejected plan must leave all selected layers and bindings untouched');
});

test('toolbar, shortcut, scale multiplier, and nine-point anchor are exposed accessibly', async () => {
  const [html, main, scaleModule] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/scale-transform.js', import.meta.url), 'utf8')
  ]);
  assert.match(html, /data-tool="scale"[^>]*title="Scale \(K\)/);
  assert.match(main, /k:\s*'scale'/);
  assert.match(main, /data-scale-field="factor"/);
  assert.match(main, /data-scale-field="width"/);
  assert.match(main, /data-scale-field="height"/);
  assert.match(main, /class="scale-anchor-point/);
  assert.match(main, /role="group" aria-label="Scale anchor"/);
  assert.match(main, /Object\.entries\(ANCHOR_COORDINATES\)/);
  assert.equal(Object.keys(ANCHOR_COORDINATES).length, 9);
  assert.match(scaleModule, /export \{ ANCHOR_COORDINATES \}/);
});
