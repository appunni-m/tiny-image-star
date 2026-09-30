import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { applyAutoLayoutSuggestion, suggestAutoLayout } from '../src/layout-inference.js';

test('suggested horizontal rows infer exact spacing and preserve geometry when applied', () => {
  const frame = createNode('frame', { width: 220, height: 90 });
  frame.children.push(
    createNode('rectangle', { x: 12, y: 10, width: 30, height: 10 }),
    createNode('text', { x: 52, y: 10, width: 40, height: 20 }),
    createNode('image', { x: 102, y: 10, width: 26, height: 16 })
  );
  const before = frame.children.map(({ x, y, width, height }) => ({ x, y, width, height }));
  const suggestion = suggestAutoLayout(frame);
  assert.equal(suggestion.supported, true);
  assert.equal(suggestion.pattern, 'horizontal');
  assert.equal(suggestion.settings.columnGap, 10);
  assert.deepEqual(suggestion.settings.padding, { top: 10, right: 92, bottom: 60, left: 12 });
  const applied = applyAutoLayoutSuggestion(frame, suggestion);
  assert.deepEqual(frame.children.map(({ x, y, width, height }) => ({ x, y, width, height })), before);
  assert.deepEqual(applied.movedIds, []);
  assert.equal(frame.autoLayout.axis, 'horizontal');
});

test('suggested vertical columns infer spacing and frame padding', () => {
  const frame = createNode('frame', { width: 100, height: 220 });
  frame.children.push(
    createNode('rectangle', { x: 8, y: 12, width: 40, height: 25 }),
    createNode('rectangle', { x: 8, y: 47, width: 50, height: 30 }),
    createNode('rectangle', { x: 8, y: 87, width: 36, height: 10 })
  );
  const suggestion = suggestAutoLayout(frame);
  assert.equal(suggestion.supported, true);
  assert.equal(suggestion.pattern, 'vertical');
  assert.equal(suggestion.settings.rowGap, 10);
  assert.deepEqual(suggestion.settings.padding, { top: 12, right: 42, bottom: 123, left: 8 });
  applyAutoLayoutSuggestion(frame, suggestion);
  assert.deepEqual(frame.children.map(({ x, y }) => [x, y]), [[8, 12], [8, 47], [8, 87]]);
});

test('complete regular grids infer manual cells independent of layer order', () => {
  const frame = createNode('frame', { width: 320, height: 160 });
  const nodes = [
    createNode('rectangle', { x: 210, y: 65, width: 80, height: 40 }),
    createNode('rectangle', { x: 10, y: 10, width: 80, height: 35 }),
    createNode('rectangle', { x: 110, y: 65, width: 60, height: 32 }),
    createNode('rectangle', { x: 210, y: 10, width: 70, height: 30 }),
    createNode('rectangle', { x: 10, y: 65, width: 75, height: 28 }),
    createNode('rectangle', { x: 110, y: 10, width: 80, height: 24 })
  ];
  frame.children.push(...nodes);
  const before = new Map(nodes.map(node => [node.id, [node.x, node.y, node.width, node.height]]));
  const suggestion = suggestAutoLayout(frame);
  assert.equal(suggestion.supported, true);
  assert.equal(suggestion.pattern, 'grid');
  assert.equal(suggestion.settings.columns, 3);
  assert.deepEqual([suggestion.settings.columnGap, suggestion.settings.rowGap], [20, 20]);
  assert.deepEqual(suggestion.settings.padding, { top: 10, right: 30, bottom: 55, left: 10 });
  const cells = new Map(suggestion.cells.map(cell => [cell.id, [cell.row, cell.column]]));
  assert.deepEqual(cells.get(nodes[0].id), [2, 3]);
  assert.deepEqual(cells.get(nodes[1].id), [1, 1]);
  applyAutoLayoutSuggestion(frame, suggestion);
  assert.deepEqual(nodes.map(node => [node.x, node.y, node.width, node.height]), nodes.map(node => before.get(node.id)));
  assert.deepEqual(nodes.map(node => [node.gridCell.row, node.gridCell.column]), [[2, 3], [1, 1], [2, 2], [1, 3], [2, 1], [1, 2]]);

  const document = createDocument();
  addNode(document, frame);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('uncertain visible children stay at their coordinates as absolute layers', () => {
  const frame = createNode('frame', { width: 260, height: 120 });
  const first = createNode('rectangle', { x: 12, y: 10, width: 30, height: 20 });
  const second = createNode('rectangle', { x: 52, y: 10, width: 30, height: 20 });
  const third = createNode('rectangle', { x: 92, y: 10, width: 30, height: 20 });
  const rotated = createNode('rectangle', { x: 210, y: 72, width: 24, height: 16, rotation: 18 });
  const bound = createNode('rectangle', { x: 168, y: 76, width: 24, height: 16, variableBindings: { x: 'mode-x' } });
  const visibilityBound = createNode('rectangle', { x: 136, y: 78, width: 20, height: 14, visible: false, variableBindings: { visible: 'mode-visible' } });
  frame.children.push(first, second, third, rotated, bound, visibilityBound);
  const fixedGeometry = [rotated, bound, visibilityBound].map(({ x, y, width, height }) => [x, y, width, height]);
  const suggestion = suggestAutoLayout(frame);
  assert.equal(suggestion.supported, true);
  assert.equal(suggestion.pattern, 'horizontal');
  assert.deepEqual(suggestion.absoluteIds.map(item => item.id), [rotated.id, bound.id, visibilityBound.id]);
  applyAutoLayoutSuggestion(frame, suggestion);
  assert.deepEqual([rotated, bound, visibilityBound].map(({ x, y, width, height }) => [x, y, width, height]), fixedGeometry);
  assert.deepEqual([rotated.layoutPositioning, bound.layoutPositioning, visibilityBound.layoutPositioning], ['absolute', 'absolute', 'absolute']);
  assert.deepEqual([first.x, second.x, third.x], [12, 52, 92]);
});

test('irregular, overlapping, incomplete, and stale layouts fail closed without mutation', () => {
  const irregular = createNode('frame', { width: 240, height: 180 });
  irregular.children.push(
    createNode('rectangle', { x: 10, y: 10, width: 20, height: 20 }),
    createNode('rectangle', { x: 70, y: 40, width: 20, height: 20 }),
    createNode('rectangle', { x: 150, y: 95, width: 20, height: 20 })
  );
  const irregularBefore = structuredClone(irregular);
  assert.equal(suggestAutoLayout(irregular).supported, false);
  assert.deepEqual(irregular, irregularBefore);

  const overlap = createNode('frame', { width: 140, height: 80 });
  overlap.children.push(
    createNode('rectangle', { x: 10, y: 10, width: 40, height: 20 }),
    createNode('rectangle', { x: 42, y: 10, width: 40, height: 20 })
  );
  assert.equal(suggestAutoLayout(overlap).supported, false, 'overlapping siblings should not be forced into a flow');

  const incomplete = createNode('frame', { width: 220, height: 140 });
  incomplete.children.push(
    createNode('rectangle', { x: 10, y: 10, width: 40, height: 30 }),
    createNode('rectangle', { x: 80, y: 10, width: 40, height: 30 }),
    createNode('rectangle', { x: 10, y: 80, width: 40, height: 30 }),
    createNode('rectangle', { x: 160, y: 80, width: 40, height: 30 })
  );
  assert.equal(suggestAutoLayout(incomplete).supported, false, 'an incomplete grid is too ambiguous to infer');

  const reversedLayerOrder = createNode('frame', { width: 160, height: 80 });
  reversedLayerOrder.children.push(
    createNode('rectangle', { x: 50, y: 10, width: 30, height: 20 }),
    createNode('rectangle', { x: 10, y: 10, width: 30, height: 20 })
  );
  assert.equal(suggestAutoLayout(reversedLayerOrder).supported, false, 'linear flow must not silently reorder layers spatially');

  const stale = createNode('frame', { width: 160, height: 80 });
  stale.children.push(createNode('rectangle', { x: 10, y: 10, width: 30, height: 20 }), createNode('rectangle', { x: 50, y: 10, width: 30, height: 20 }));
  const suggestion = suggestAutoLayout(stale);
  const before = structuredClone(stale);
  stale.children[1].x += 2;
  const changed = structuredClone(stale);
  assert.throws(() => applyAutoLayoutSuggestion(stale, suggestion), /geometry changed/);
  assert.deepEqual(stale, changed, 'a stale suggestion must not partially mutate the frame');
  assert.notDeepEqual(stale, before);
});

test('fill-sized children are preserved as absolute instead of being resized by a suggestion', () => {
  const frame = createNode('frame', { width: 220, height: 90 });
  const first = createNode('rectangle', { x: 10, y: 10, width: 30, height: 20 });
  const fill = createNode('rectangle', { x: 50, y: 10, width: 60, height: 20, layoutSizingMain: 'fill' });
  const third = createNode('rectangle', { x: 120, y: 10, width: 30, height: 20 });
  frame.children.push(first, fill, third);
  const suggestion = suggestAutoLayout(frame);
  assert.equal(suggestion.supported, true);
  assert.deepEqual(suggestion.absoluteIds.map(item => item.id), [fill.id]);
  const before = [fill.x, fill.y, fill.width, fill.height];
  applyAutoLayoutSuggestion(frame, suggestion);
  assert.deepEqual([fill.x, fill.y, fill.width, fill.height], before);
  assert.equal(fill.layoutPositioning, 'absolute');
});

test('small cumulative spacing drift that would move a child too far is refused atomically', () => {
  const children = [];
  let x = 10;
  for (let index = 0; index < 20; index += 1) {
    children.push(createNode('rectangle', { x, y: 10, width: 10, height: 12 }));
    x += 20 + (index / 18) * 0.5;
  }
  const frame = createNode('frame', { width: x + 10, height: 80, children });
  const suggestion = suggestAutoLayout(frame);
  assert.equal(suggestion.supported, true, 'the spacing spread is within the measured tolerance');
  const before = structuredClone(frame);
  assert.throws(() => applyAutoLayoutSuggestion(frame, suggestion), /move a layer too far/);
  assert.deepEqual(frame, before, 'a near-match is rejected without changing geometry');
});

test('large child sets fail closed at the documented inference bound', () => {
  const frame = createNode('frame', { width: 100, height: 100 });
  frame.children.push(...Array.from({ length: 2049 }, (_, index) => createNode('rectangle', {
    x: index % 10, y: Math.floor(index / 10), width: 2, height: 2
  })));
  const suggestion = suggestAutoLayout(frame);
  assert.equal(suggestion.supported, false);
  assert.match(suggestion.reason, /limited to 2048/);
});
