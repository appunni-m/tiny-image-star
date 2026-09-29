import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, bindColorVariable, createDocument, createNode, createVariable, createVariableCollection, findNode } from '../src/model.js';
import { buildInspectOutput } from '../src/inspect.js';

test('Inspect output reports page-space geometry, resolved styles, text metrics and exact layer JSON', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Outer frame', x: 25, y: 35, width: 300, height: 220 });
  const label = createNode('text', {
    name: 'Hero title', x: 12, y: 18, width: 180, height: 40, text: 'Hello',
    fontFamily: 'Arial, sans-serif', fontSize: 24, fontWeight: 600, lineHeight: 1.5, letterSpacing: 0.5,
    rotation: -4, color: '#112233'
  });
  addNode(document, frame);
  addNode(document, label, { parentId: frame.id });
  const collection = createVariableCollection(document, 'Theme');
  const color = createVariable(document, collection.id, 'Text color', 'color', '#445566');
  assert.equal(bindColorVariable(document, label.id, color.id, 'text'), true);

  const entry = findNode(document, label.id);
  const output = buildInspectOutput(document, [entry]);
  assert.deepEqual(output.layers[0].position, { x: 37, y: 53 });
  assert.equal(output.layers[0].color, '#445566');
  assert.equal(output.layers[0].typography.fontSize, 24);
  assert.match(output.css, /\.hero-title-[a-z0-9_-]+ \{/);
  assert.match(output.css, /left: 37px;/);
  assert.match(output.css, /top: 53px;/);
  assert.match(output.css, /color: #445566;/);
  assert.match(output.css, /font-size: 24px;/);
  assert.match(output.css, /line-height: 36px;/);
  assert.match(output.css, /transform: rotate\(-4deg\);/);
  assert.equal(JSON.parse(output.json).id, label.id);
});

test('Inspect output describes responsive grid layout and multiple selected layers', () => {
  const document = createDocument();
  const grid = createNode('frame', {
    name: 'Cards', x: 10, y: 20, width: 500, height: 300,
    autoLayout: { axis: 'grid', columns: 3, rowGap: 12, columnGap: 16 }
  });
  const card = createNode('rectangle', { name: 'Card / Primary', x: 0, y: 0, width: 140, height: 90, fill: '#abcdef' });
  const badge = createNode('ellipse', { name: 'Badge', x: 150, y: 0, width: 24, height: 24, fill: '#ff0000' });
  addNode(document, grid); addNode(document, card, { parentId: grid.id }); addNode(document, badge, { parentId: grid.id });

  const entries = document.pages[0].children[0].children.map(node => findNode(document, node.id));
  const output = buildInspectOutput(document, entries);
  const gridOutput = buildInspectOutput(document, [findNode(document, grid.id)]);
  assert.equal(output.layers.length, 2);
  assert.match(gridOutput.css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(gridOutput.css, /row-gap: 12px;/);
  assert.match(gridOutput.css, /column-gap: 16px;/);
  assert.match(output.css, /\.card-primary-[a-z0-9_-]+/);
  assert.match(output.css, /\.badge-[a-z0-9_-]+/);
  assert.match(output.css, /Placement is controlled by the parent auto layout/);
  assert.equal(/position: absolute;/.test(output.css), false, 'Auto-layout children should remain in flow instead of receiving page-space positioning.');
  assert.deepEqual(JSON.parse(output.json).map(node => node.id), [card.id, badge.id]);
});

test('Inspect output safely encodes arbitrary font family names', () => {
  const document = createDocument();
  const label = createNode('text', { fontFamily: 'Font"; color: red;/*', text: 'Safe output' });
  addNode(document, label);
  const output = buildInspectOutput(document, [{ node: label, parents: [] }]);
  assert.match(output.css, /font-family: "Font\\"; color: red;\/\*";/);
});
