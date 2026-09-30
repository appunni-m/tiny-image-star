import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeLocalToPage } from '../src/transform-geometry.js';
import { resizeSelection, rotateSelection, selectionAspectRatio, selectionBounds, selectionMoveBlockReason, translateSelection } from '../src/group-transform.js';

function close(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function pageCenter(node, ancestors = []) {
  return nodeLocalToPage(node, { x: node.width / 2, y: node.height / 2 }, ancestors);
}

test('selection bounds enclose rotated layers in page space and include their center', () => {
  const node = { id: 'rotated', x: 10, y: 20, width: 40, height: 20, rotation: 90 };
  assert.deepEqual(selectionBounds([{ node, ancestors: [] }]), {
    x: 20,
    y: 10,
    width: 20,
    height: 40,
    center: { x: 30, y: 30 }
  });
});

test('axis resize scales multiple layers and preserves the opposite AABB edge', () => {
  const entries = [
    { node: { id: 'a', x: 0, y: 0, width: 10, height: 10, rotation: 0 }, ancestors: [] },
    { node: { id: 'b', x: 20, y: 0, width: 10, height: 10, rotation: 0 }, ancestors: [] }
  ];
  const bounds = selectionBounds(entries);
  const patches = resizeSelection(entries, bounds, 'e', { x: 40, y: 5 });
  const byId = new Map(patches.map(patch => [patch.id, patch]));

  close(byId.get('a').x, 0);
  close(byId.get('a').width, 40 / 3);
  close(byId.get('b').x, 80 / 3);
  close(byId.get('b').width, 40 / 3);
  close(Math.min(...patches.map(patch => patch.x)), bounds.x);
  close(Math.max(...patches.map(patch => patch.x + patch.width)), 40);
});

test('vertical line selections omit Shift aspect locking when their bounds have zero width', () => {
  const entries = [
    { node: { id: 'line-a', x: 10, y: 0, width: 0, height: 20, rotation: 0 }, ancestors: [] },
    { node: { id: 'line-b', x: 10, y: 30, width: 0, height: 20, rotation: 0 }, ancestors: [] }
  ];
  const bounds = selectionBounds(entries);
  assert.equal(bounds.width, 0);
  assert.ok(bounds.height > 0);
  assert.equal(selectionAspectRatio(bounds), undefined);
  assert.doesNotThrow(() => resizeSelection(entries, bounds, 'n', { x: 10, y: -10 }, {
    aspectRatio: selectionAspectRatio(bounds)
  }));
});

test('corner resize honors aspect ratio and fixes the opposite AABB corner', () => {
  const entries = [{ node: { id: 'card', x: 10, y: 20, width: 20, height: 10, rotation: 0 }, ancestors: [] }];
  const bounds = selectionBounds(entries);
  const patch = resizeSelection(entries, bounds, 'se', { x: 50, y: 40 }, { aspectRatio: 2 })[0];

  close(patch.x, 10);
  close(patch.y, 20);
  close(patch.width, 40);
  close(patch.height, 20);
  close(patch.width / patch.height, 2);
});

test('resize preserves centers through nested rotated ancestor snapshots', () => {
  const ancestors = [
    { id: 'outer', x: 100, y: 50, width: 300, height: 200, rotation: 35 },
    { id: 'inner', x: 30, y: 20, width: 100, height: 80, rotation: -20 }
  ];
  const node = { id: 'child', x: 10, y: 15, width: 40, height: 20, rotation: 75 };
  const entries = [{ node, ancestors }];
  const bounds = selectionBounds(entries);
  const originalCenter = pageCenter(node, ancestors);
  const pointerPage = { x: bounds.x + bounds.width + 15, y: bounds.y + bounds.height + 10 };
  const [patch] = resizeSelection(entries, bounds, 'se', pointerPage);
  const nextNode = { ...node, ...patch };
  const nextCenter = pageCenter(nextNode, ancestors);
  const scaleX = (bounds.width + 15) / bounds.width;
  const scaleY = (bounds.height + 10) / bounds.height;

  close(nextCenter.x, bounds.x + (originalCenter.x - bounds.x) * scaleX);
  close(nextCenter.y, bounds.y + (originalCenter.y - bounds.y) * scaleY);
  close(patch.width, node.width * scaleY);
  close(patch.height, node.height * scaleX);
  assert.equal(patch.rotation, undefined);
});

test('rotated layer resize keeps the opposite AABB handle fixed without changing node rotation', () => {
  const ancestors = [{ id: 'frame', x: 25, y: -12, width: 160, height: 100, rotation: 18 }];
  const node = { id: 'rotated-child', x: 8, y: 14, width: 30, height: 20, rotation: 19 };
  const entries = [{ node, ancestors }];
  const bounds = selectionBounds(entries);
  const [patch] = resizeSelection(entries, bounds, 'e', { x: bounds.x + bounds.width * 1.5, y: bounds.center.y });
  const nextBounds = selectionBounds([{ node: { ...node, ...patch }, ancestors }]);

  close(nextBounds.x, bounds.x);
  close(nextBounds.center.y, bounds.center.y);
  close(patch.rotation ?? node.rotation, node.rotation);
});

test('resize clamps each changed dimension to minSize', () => {
  const entries = [{ node: { id: 'small', x: 0, y: 0, width: 10, height: 10, rotation: 0 }, ancestors: [] }];
  const bounds = selectionBounds(entries);
  const [patch] = resizeSelection(entries, bounds, 'se', { x: 0.1, y: 0.1 }, { minSize: 2 });
  assert.ok(patch.width >= 2);
  assert.ok(patch.height >= 2);
  close(patch.x, bounds.x);
  close(patch.y, bounds.y);
});

test('group rotation moves centers around the shared page pivot and adds the same rotation', () => {
  const entries = [
    { node: { id: 'left', x: 0, y: 0, width: 10, height: 10, rotation: 5 }, ancestors: [] },
    { node: { id: 'right', x: 30, y: 0, width: 10, height: 10, rotation: -10 }, ancestors: [] }
  ];
  const pivot = selectionBounds(entries).center;
  const initialCenters = entries.map(({ node, ancestors }) => pageCenter(node, ancestors));
  const patches = new Map(rotateSelection(entries, pivot, 90).map(patch => [patch.id, patch]));

  const left = { ...entries[0].node, ...patches.get('left') };
  const right = { ...entries[1].node, ...patches.get('right') };
  const expectedCenters = initialCenters.map(center => ({ x: pivot.x - (center.y - pivot.y), y: pivot.y + (center.x - pivot.x) }));
  close(pageCenter(left).x, expectedCenters[0].x);
  close(pageCenter(left).y, expectedCenters[0].y);
  close(pageCenter(right).x, expectedCenters[1].x);
  close(pageCenter(right).y, expectedCenters[1].y);
  close(patches.get('left').rotation, 95);
  close(patches.get('right').rotation, 80);
});

test('rotating a nested selected parent and child does not double the world rotation', () => {
  const parent = { id: 'parent', x: 40, y: 20, width: 100, height: 60, rotation: 10 };
  const child = { id: 'child', x: 15, y: 12, width: 20, height: 10, rotation: 5 };
  const entries = [
    { node: parent, ancestors: [] },
    { node: child, ancestors: [parent] }
  ];
  const pivot = selectionBounds(entries).center;
  const oldChildCenter = pageCenter(child, [parent]);
  const patches = new Map(rotateSelection(entries, pivot, 30).map(patch => [patch.id, patch]));
  const updatedParent = { ...parent, ...patches.get('parent') };
  const updatedChild = { ...child, ...patches.get('child') };

  close(patches.get('parent').rotation, 40);
  close(patches.get('child').rotation, 5);
  const dx = oldChildCenter.x - pivot.x;
  const dy = oldChildCenter.y - pivot.y;
  const nextChildCenter = pageCenter(updatedChild, [updatedParent]);
  close(nextChildCenter.x, pivot.x + dx * Math.cos(Math.PI / 6) - dy * Math.sin(Math.PI / 6));
  close(nextChildCenter.y, pivot.y + dx * Math.sin(Math.PI / 6) + dy * Math.cos(Math.PI / 6));
  const oldWorldRotation = parent.rotation + child.rotation;
  const newWorldRotation = updatedParent.rotation + updatedChild.rotation;
  close(newWorldRotation - oldWorldRotation, 30);
});

test('translation moves sibling layers by the same page-space delta', () => {
  const entries = [
    { node: { id: 'left', x: 0, y: 5, width: 20, height: 10, rotation: 0 }, ancestors: [] },
    { node: { id: 'right', x: 35, y: -10, width: 12, height: 16, rotation: 20 }, ancestors: [] }
  ];
  const patches = new Map(translateSelection(entries, { x: 14, y: -7 }).map(patch => [patch.id, patch]));

  for (const { node, ancestors } of entries) {
    const original = pageCenter(node, ancestors);
    const moved = pageCenter({ ...node, ...patches.get(node.id) }, ancestors);
    close(moved.x - original.x, 14);
    close(moved.y - original.y, -7);
  }
  assert.deepEqual(patches.get('left'), { id: 'left', x: 14, y: -2 });
  assert.deepEqual(patches.get('right'), { id: 'right', x: 49, y: -17 });
});

test('translation preserves page-space movement through nested rotated ancestors', () => {
  const ancestors = [
    { id: 'outer', x: 100, y: 50, width: 300, height: 200, rotation: 35 },
    { id: 'inner', x: 30, y: 20, width: 100, height: 80, rotation: -20 }
  ];
  const node = { id: 'child', x: 10, y: 15, width: 40, height: 20, rotation: 75 };
  const originalCenter = pageCenter(node, ancestors);
  const [patch] = translateSelection([{ node, ancestors }], { x: 23.5, y: -11.25 });
  const movedCenter = pageCenter({ ...node, ...patch }, ancestors);

  close(movedCenter.x - originalCenter.x, 23.5);
  close(movedCenter.y - originalCenter.y, -11.25);
});

test('translation of a selected parent and child does not move the child twice', () => {
  const outer = { id: 'outer', x: 100, y: 60, width: 260, height: 180, rotation: 24 };
  const parent = { id: 'parent', x: 40, y: 20, width: 100, height: 60, rotation: 10 };
  const child = { id: 'child', x: 15, y: 12, width: 20, height: 10, rotation: 5 };
  const entries = [
    { node: child, ancestors: [outer, parent] },
    { node: parent, ancestors: [outer] }
  ];
  const originalCenters = new Map(entries.map(({ node, ancestors }) => [node.id, pageCenter(node, ancestors)]));
  const patches = new Map(translateSelection(entries, { x: -18, y: 31 }).map(patch => [patch.id, patch]));
  const movedOuter = outer;
  const movedParent = { ...parent, ...patches.get(parent.id) };
  const movedChild = { ...child, ...patches.get(child.id) };
  const movedCenters = new Map([
    ['parent', pageCenter(movedParent, [movedOuter])],
    ['child', pageCenter(movedChild, [movedOuter, movedParent])]
  ]);

  for (const id of ['parent', 'child']) {
    close(movedCenters.get(id).x - originalCenters.get(id).x, -18);
    close(movedCenters.get(id).y - originalCenters.get(id).y, 31);
  }
});

test('resize and rotation reject invalid entries, handles, bounds, and coordinates', () => {
  assert.throws(() => selectionBounds([]), /at least one selected entry/);
  assert.throws(() => selectionBounds([{ node: { id: 'bad', x: NaN, y: 0, width: 1, height: 1 } }]), /finite/);

  const entries = [{ node: { id: 'ok', x: 0, y: 0, width: 10, height: 10, rotation: 0 }, ancestors: [] }];
  const bounds = selectionBounds(entries);
  assert.throws(() => resizeSelection(entries, bounds, 'center', { x: 1, y: 1 }), /Unknown resize handle/);
  assert.throws(() => resizeSelection(entries, { x: 0, y: 0, width: -1, height: 1 }, 'e', { x: 2, y: 0 }), /non-negative/);
  assert.throws(() => resizeSelection(entries, bounds, 'e', { x: Infinity, y: 0 }), /finite page-space/);
  assert.throws(() => resizeSelection(entries, bounds, 'se', { x: 2, y: 2 }, { aspectRatio: 0 }), /Aspect ratio/);
  assert.throws(() => rotateSelection(entries, { x: 0, y: NaN }, 10), /finite page-space/);
  assert.throws(() => rotateSelection(entries, { x: 0, y: 0 }, Infinity), /finite degrees/);
});

test('translation rejects invalid deltas and entries without unique stable IDs', () => {
  const entries = [{ node: { id: 'ok', x: 0, y: 0, width: 10, height: 10, rotation: 0 }, ancestors: [] }];
  for (const delta of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, null]) {
    assert.throws(() => translateSelection(entries, delta), /finite page-space/);
  }
  assert.throws(() => translateSelection([{ node: { x: 0, y: 0, width: 10, height: 10 } }], { x: 1, y: 1 }), /stable ID/);
  assert.throws(() => translateSelection([
    entries[0],
    { node: { ...entries[0].node }, ancestors: [] }
  ], { x: 1, y: 1 }), /duplicated/);
});

test('group movement blocks locked layers, flow-managed children, and shared position variables', () => {
  const sibling = { id: 'sibling', x: 0, y: 0, width: 10, height: 10 };
  assert.equal(selectionMoveBlockReason([{ node: sibling, ancestors: [] }, { node: { ...sibling, id: 'locked', locked: true }, ancestors: [] }]), 'locked');
  assert.equal(selectionMoveBlockReason([{ node: sibling, ancestors: [{ id: 'locked-parent', locked: true }] }]), 'locked');
  assert.equal(selectionMoveBlockReason([
    { node: sibling, ancestors: [{ id: 'flow', autoLayout: { axis: 'vertical' } }] },
    { node: { ...sibling, id: 'other' }, ancestors: [] }
  ]), 'auto-layout');
  assert.equal(selectionMoveBlockReason([
    { node: sibling, ancestors: [{ id: 'flow', autoLayout: { axis: 'vertical' } }] }
  ]), 'auto-layout', 'a single flow-managed child cannot be nudged out of its assigned position.');
  assert.equal(selectionMoveBlockReason([
    { node: { ...sibling, variableBindings: { x: 'shared-x' } }, ancestors: [] },
    { node: { ...sibling, id: 'other' }, ancestors: [] }
  ]), 'shared-position-variable');
  assert.equal(selectionMoveBlockReason([
    { node: { ...sibling, layoutPositioning: 'absolute' }, ancestors: [{ id: 'flow', autoLayout: { axis: 'vertical' } }] },
    { node: { ...sibling, id: 'other', layoutPositioning: 'absolute' }, ancestors: [{ id: 'flow', autoLayout: { axis: 'vertical' } }] }
  ]), null, 'absolute-positioned layers can move together under auto layout frames.');
  assert.equal(selectionMoveBlockReason([{ node: sibling, ancestors: [] }]), null, 'single-layer variable editing remains available.');
});
