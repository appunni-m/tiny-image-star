import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, applyTidyUpPlan, canTidyUpLayers, createDocument, createNode,
  planTidyUpLayers, tidyUpLayers
} from '../src/model.js';
import { planTidyUp } from '../src/tidy-up.js';

function visualBounds(node) {
  const radians = (Number(node.rotation) || 0) * Math.PI / 180;
  const halfWidth = (Math.abs(node.width * Math.cos(radians)) + Math.abs(node.height * Math.sin(radians))) / 2;
  const halfHeight = (Math.abs(node.width * Math.sin(radians)) + Math.abs(node.height * Math.cos(radians))) / 2;
  const centerX = node.x + node.width / 2;
  const centerY = node.y + node.height / 2;
  return {
    left: centerX - halfWidth,
    right: centerX + halfWidth,
    top: centerY - halfHeight,
    bottom: centerY + halfHeight,
  };
}

function documentWith(nodes) {
  const document = createDocument();
  for (const node of nodes) addNode(document, node);
  return document;
}

test('Tidy up arranges a row using its most common gap and keeps size, rotation, and layer order', () => {
  const layers = [
    createNode('rectangle', { x: 0, y: 12, width: 10, height: 10 }),
    createNode('ellipse', { x: 20, y: 12, width: 10, height: 10, rotation: 15 }),
    createNode('rectangle', { x: 60, y: 12, width: 10, height: 10 }),
    createNode('text', { x: 80, y: 12, width: 10, height: 10 }),
  ];
  const document = documentWith(layers);
  const order = document.pages[0].children.map(node => node.id);
  const dimensions = layers.map(({ width, height, rotation }) => [width, height, rotation]);
  const plan = planTidyUpLayers(document, layers.map(node => node.id));
  assert.equal(plan.layout, 'row');
  assert.equal(plan.gapX, 10);

  const result = applyTidyUpPlan(document, plan);
  assert.deepEqual(result.changedNodes.map(node => node.id), [layers[1].id, layers[2].id, layers[3].id]);
  const bounds = layers.map(visualBounds);
  const gaps = bounds.slice(1).map((item, index) => item.left - bounds[index].right);
  assert.ok(gaps.every(gap => Math.abs(gap - 10) < 1e-7), 'rotated visual bounds should share the selected gap');
  assert.ok(Math.abs(layers[0].x) < 1e-7, 'the first layer anchors the row');
  assert.ok(layers.every(node => Math.abs(node.y - 12) < 1e-7), 'Tidy up must not align or move the cross axis');
  assert.deepEqual(layers.map(({ width, height, rotation }) => [width, height, rotation]), dimensions);
  assert.deepEqual(document.pages[0].children.map(node => node.id), order);
});

test('Tidy up handles a column without changing x positions', () => {
  const layers = [
    createNode('rectangle', { x: 12, y: 0, width: 10, height: 10 }),
    createNode('ellipse', { x: 12, y: 20, width: 10, height: 10 }),
    createNode('rectangle', { x: 12, y: 55, width: 10, height: 10 }),
    createNode('text', { x: 12, y: 75, width: 10, height: 10 }),
  ];
  const document = documentWith(layers);
  const plan = planTidyUpLayers(document, layers.map(node => node.id));
  assert.equal(plan.layout, 'column');
  assert.equal(plan.gapY, 10);

  tidyUpLayers(document, layers.map(node => node.id));
  assert.deepEqual(layers.map(node => node.y), [0, 20, 40, 60]);
  assert.deepEqual(layers.map(node => node.x), [12, 12, 12, 12]);
});

test('Tidy up aligns a rectangular grid at its top-left and preserves common row and column gaps', () => {
  const layers = [
    createNode('rectangle', { x: 0, y: 0, width: 10, height: 10 }),
    createNode('rectangle', { x: 30, y: 0, width: 10, height: 10 }),
    createNode('rectangle', { x: 4, y: 40, width: 10, height: 10 }),
    createNode('rectangle', { x: 42, y: 40, width: 10, height: 10 }),
  ];
  const document = documentWith(layers);
  const plan = planTidyUpLayers(document, layers.map(node => node.id));
  assert.equal(plan.layout, 'grid');
  assert.equal(plan.gapX, 20);
  assert.equal(plan.gapY, 30);

  tidyUpLayers(document, layers.map(node => node.id));
  assert.deepEqual(layers.map(node => [node.x, node.y]), [[0, 0], [30, 0], [0, 40], [30, 40]]);
});

test('Tidy up refuses ambiguous clusters, ragged grids, and malformed geometry without mutating input', () => {
  const ambiguous = [0, 1, 2].map(offset => ({
    id: 'overlap-' + offset, x: offset, y: offset, width: 10, height: 10, rotation: 0,
  }));
  const before = structuredClone(ambiguous);
  assert.equal(planTidyUp(ambiguous), null);
  assert.deepEqual(ambiguous, before);

  const ragged = [
    { id: 'a', x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    { id: 'b', x: 30, y: 0, width: 10, height: 10, rotation: 0 },
    { id: 'c', x: 0, y: 40, width: 10, height: 10, rotation: 0 },
    { id: 'd', x: 30, y: 40, width: 10, height: 10, rotation: 0 },
    { id: 'e', x: 60, y: 40, width: 10, height: 10, rotation: 0 },
  ];
  assert.equal(planTidyUp(ragged), null);
  assert.equal(planTidyUp([{ id: 'bad' }, ...ambiguous.slice(1)]), null);
  assert.equal(planTidyUp([...ambiguous, ambiguous[0]]), null);
});

test('Tidy up is limited to editable sibling layers outside Auto layout and bound movement', () => {
  const document = createDocument();
  const frame = createNode('frame');
  addNode(document, frame);
  const layers = [
    createNode('rectangle', { x: 0, y: 0, width: 10, height: 10 }),
    createNode('rectangle', { x: 20, y: 0, width: 10, height: 10 }),
    createNode('rectangle', { x: 60, y: 0, width: 10, height: 10 }),
  ];
  for (const node of layers) addNode(document, node, { parentId: frame.id });
  const ids = layers.map(node => node.id);
  assert.equal(canTidyUpLayers(document, ids), true);

  layers[2].locked = true;
  assert.equal(canTidyUpLayers(document, ids), false);
  layers[2].locked = false;
  frame.autoLayout = { axis: 'horizontal', gap: 8 };
  assert.equal(canTidyUpLayers(document, ids), false);
  delete frame.autoLayout;

  layers[2].variableBindings = { x: 'shared-x' };
  assert.equal(canTidyUpLayers(document, ids), false);
  assert.throws(() => tidyUpLayers(document, ids), /clear row, column, or rectangular grid/);
});

test('Tidy up rejects a stale placement plan and leaves a selection unchanged when already tidy', () => {
  const layers = [
    createNode('rectangle', { x: 0, y: 0, width: 10, height: 10 }),
    createNode('rectangle', { x: 20, y: 0, width: 10, height: 10 }),
    createNode('rectangle', { x: 60, y: 0, width: 10, height: 10 }),
  ];
  const document = documentWith(layers);
  const plan = planTidyUpLayers(document, layers.map(node => node.id));
  layers[2].x += 1;
  const staleState = layers.map(node => [node.x, node.y]);
  assert.throws(() => applyTidyUpPlan(document, plan), /selection changed/);
  assert.deepEqual(layers.map(node => [node.x, node.y]), staleState);

  const freshPlan = planTidyUpLayers(document, layers.map(node => node.id));
  applyTidyUpPlan(document, freshPlan);
  const tidyPlan = planTidyUpLayers(document, layers.map(node => node.id));
  assert.ok(tidyPlan, 'an already tidy row remains a valid selection');
  const unchanged = layers.map(node => [node.x, node.y]);
  assert.deepEqual(applyTidyUpPlan(document, tidyPlan).changedNodes, []);
  assert.deepEqual(layers.map(node => [node.x, node.y]), unchanged);
});
