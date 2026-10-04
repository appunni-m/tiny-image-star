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
    effects: [{ id: 'shadow', type: 'drop-shadow', offsetX: 2, offsetY: 4, blur: 6, spread: -3 }, { id: 'blur', type: 'layer-blur', radius: 3 }],
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
  assert.deepEqual(patches.get('shape').effects.map(effect => [effect.offsetX, effect.offsetY, effect.blur, effect.spread, effect.radius]), [
    [4, 8, 12, -6, undefined], [undefined, undefined, undefined, undefined, 6]
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

test('scale materializes shared bound geometry per selected layer without editing variables', () => {
  const variableId = 'variable-shared-width';
  const left = {
    id: 'left', x: 0, y: 0, width: 10, height: 20, rotation: 0,
    variableBindings: { width: variableId }, children: []
  };
  const right = {
    id: 'right', x: 60, y: 0, width: 10, height: 20, rotation: 0,
    variableBindings: { width: variableId }, children: []
  };
  const unselected = {
    id: 'unselected', x: 130, y: 0, width: 10, height: 20, rotation: 0,
    variableBindings: { width: variableId }, children: []
  };
  const before = structuredClone([left, right, unselected]);
  const variableValues = { [variableId]: 40 };
  const variableValuesBefore = structuredClone(variableValues);

  assert.throws(() => planScaleTransform([{ node: left }, { node: right }], 1.5), /without a variable resolver/);
  const plan = planScaleTransform([{ node: left }, { node: right }], 1.5, 'center', {
    resolveBoundProperty: (node, property) => node.variableBindings?.[property]
      ? variableValues[node.variableBindings[property]] : node[property]
  });
  const patches = new Map(plan.patches.map(patch => [patch.id, patch]));

  assert.equal(patches.get('left').width, 60);
  assert.equal(patches.get('right').width, 60);
  assert.equal(plan.bounds.width, 100, 'selection bounds use variable-resolved root dimensions');
  assert.equal(patches.get('left').variableBindings, null);
  assert.equal(patches.get('right').variableBindings, null);
  assert.deepEqual([left, right, unselected], before, 'planning leaves selected and unselected layers untouched');
  assert.deepEqual(variableValues, variableValuesBefore, 'scaling never changes the shared variable value');
});

test('scale uses resolved bound geometry on the root and its ancestors for page-space bounds', () => {
  const root = {
    id: 'root', x: 5, y: 0, width: 10, height: 10, rotation: 0,
    variableBindings: { width: 'root-width' }, children: []
  };
  const parent = {
    id: 'parent', x: 2, y: 0, width: 80, height: 60, rotation: 0,
    variableBindings: { x: 'parent-x' }
  };
  const plan = planScaleTransform([{ node: root, ancestors: [parent] }], 2, 'center', {
    resolveBoundProperty: (node, property) => {
      if (node.id === 'root' && property === 'width') return 20;
      if (node.id === 'parent' && property === 'x') return 30;
      return node[property];
    }
  });

  assert.equal(plan.bounds.x, 35, 'the page bounds include the resolved parent x and child x');
  assert.equal(plan.patches.find(patch => patch.id === 'root').width, 40);
  assert.equal(plan.patches.find(patch => patch.id === 'root').variableBindings, null);
  assert.deepEqual(parent.variableBindings, { x: 'parent-x' }, 'unscaled ancestors remain bound');
});

test('scale resolves nested geometry from each node mode and detaches only scaled numeric bindings', () => {
  const variableId = 'variable-responsive-width';
  const collectionId = 'collection-responsive';
  const child = {
    id: 'child', x: 10, y: 5, width: 20, height: 12, rotation: 0,
    strokeWidth: 2, listSpacing: 4,
    variableBindings: { width: variableId, strokeWidth: 'variable-stroke', listSpacing: 'variable-list-spacing', lineHeight: 'variable-leading' },
    variableModes: { [collectionId]: 'compact' }, lineHeightUnit: 'ratio', lineHeight: 1.2,
    children: []
  };
  const wideChild = {
    id: 'wide-child', x: 45, y: 5, width: 20, height: 12, rotation: 0,
    variableBindings: { width: variableId, lineHeight: 'variable-leading' },
    variableModes: { [collectionId]: 'wide' }, lineHeightUnit: 'ratio', lineHeight: 1.5,
    children: []
  };
  const root = { id: 'root', x: 0, y: 0, width: 100, height: 60, rotation: 0, children: [child, wideChild] };
  const documentVariables = {
    width: { valuesByMode: { compact: 20, wide: 40 } },
    leading: { valuesByMode: { compact: 1.2, wide: 1.5 } }
  };
  const before = structuredClone({ root, documentVariables });
  const plan = planScaleTransform([{ node: root, ancestors: [] }], 2, 'center', {
    resolveBoundProperty: (node, property) => {
      if (property === 'width' && node.variableBindings?.width) {
        return documentVariables.width.valuesByMode[node.variableModes?.[collectionId] || 'wide'];
      }
      if (property === 'lineHeight' && node.variableBindings?.lineHeight) {
        return documentVariables.leading.valuesByMode[node.variableModes?.[collectionId] || 'wide'];
      }
      return node[property];
    }
  });
  const patches = new Map(plan.patches.map(patch => [patch.id, patch]));

  assert.equal(patches.get('child').width, 40, 'compact mode width is materialized and scaled');
  assert.equal(patches.get('child').strokeWidth, 4);
  assert.equal(patches.get('child').listSpacing, 8);
  assert.equal(patches.get('wide-child').width, 80, 'the sibling uses its own wide mode value');
  assert.deepEqual(patches.get('child').variableBindings, { lineHeight: 'variable-leading' });
  assert.deepEqual(patches.get('wide-child').variableBindings, { lineHeight: 'variable-leading' });
  assert.equal(patches.get('child').lineHeight, undefined, 'ratio line height is not scaled or detached');
  assert.deepEqual({ root, documentVariables }, before, 'planning leaves source geometry and all variable modes unchanged');
});

test('scale fails closed for bound properties that do not resolve to finite numbers', () => {
  const root = {
    id: 'root', x: 0, y: 0, width: 60, height: 20, rotation: 0,
    variableBindings: { width: 'broken-width' }, children: []
  };
  assert.throws(
    () => planScaleTransform([{ node: root }], 2, 'center', { resolveBoundProperty: () => 'wide' }),
    /bound width does not resolve to a finite number/
  );
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
  assert.match(main, /resolveBoundProperty: resolveScaleBoundProperty/);
  assert.match(main, /if \(property === 'variableBindings' && patch\[property\] == null\) delete node\.variableBindings;/);
  assert.match(main, /recordNodeComponentOverrides\(node, properties\)/);
  assert.match(main, /Bound numeric values detach on scaled layers/);
  assert.equal(Object.keys(ANCHOR_COORDINATES).length, 9);
  assert.match(scaleModule, /export \{ ANCHOR_COORDINATES \}/);
});
