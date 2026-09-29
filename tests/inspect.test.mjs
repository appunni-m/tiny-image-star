import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, bindColorVariable, createDocument, createGradientFill, createLayerEffect, createNode, createVariable, createVariableCollection, findNode } from '../src/model.js';
import { createImageFill } from '../src/image-fills.js';
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

test('Inspect output includes auto layout size limits in CSS and layer summary', () => {
  const document = createDocument();
  const frame = createNode('frame', { autoLayout: { axis: 'horizontal' } });
  const tile = createNode('rectangle', { minWidth: 72, maxWidth: 180, minHeight: 36 });
  addNode(document, frame); addNode(document, tile, { parentId: frame.id });
  const output = buildInspectOutput(document, [findNode(document, tile.id)]);
  assert.match(output.css, /min-width: 72px;/);
  assert.match(output.css, /max-width: 180px;/);
  assert.match(output.css, /min-height: 36px;/);
  assert.deepEqual(output.layers[0].sizeLimits, { minWidth: 72, maxWidth: 180, minHeight: 36 });
});

test('Inspect output hands off enabled layer effects as CSS filters and structured data', () => {
  const document = createDocument();
  const shape = createNode('rectangle', { effects: [
    createLayerEffect('drop-shadow', { offsetX: 4, offsetY: 8, blur: 6, opacity: 0.3 }),
    createLayerEffect('layer-blur', { radius: 2, visible: false })
  ] });
  addNode(document, shape);
  const output = buildInspectOutput(document, [findNode(document, shape.id)]);
  assert.match(output.css, /filter: drop-shadow\(4px 8px 6px rgba\(0, 0, 0, 0\.3\)\);/);
  assert.deepEqual(output.layers[0].effects, shape.effects);
});

test('Inspect output includes editable gradient fills in CSS and structured layer data', () => {
  const document = createDocument();
  const gradient = createGradientFill('linear', '#ff0000');
  gradient.stops[1].color = '#0000ff';
  gradient.angle = 45;
  const shape = createNode('rectangle', { fillGradient: gradient, fillOpacity: 0.5 });
  addNode(document, shape);
  const output = buildInspectOutput(document, [findNode(document, shape.id)]);
  assert.match(output.css, /background: linear-gradient\(135deg, rgba\(255, 0, 0, 0\.5\) 0%, rgba\(0, 0, 255, 0\.5\) 100%\);/);
  assert.deepEqual(output.layers[0].fillGradient, gradient);
});

test('Inspect output preserves image-fill source and edit settings in layer data', () => {
  const document = createDocument();
  const imageFill = createImageFill('local-image-a', { fit: 'contain', adjustments: { brightness: -10, contrast: 8, saturation: 4, blur: 1 } });
  const node = createNode('ellipse', { imageFill });
  addNode(document, node);
  const output = buildInspectOutput(document, [findNode(document, node.id)]);
  assert.deepEqual(output.layers[0].imageFill, imageFill);
  assert.match(output.css, /Local image fill source and adjustments are retained in layer JSON/);
  assert.doesNotMatch(output.css, /background-color:/);
});

test('Inspect output exposes blend modes in generated CSS and structured layer data', () => {
  const document = createDocument();
  const node = createNode('rectangle', { blendMode: 'soft-light' });
  addNode(document, node);
  const output = buildInspectOutput(document, [findNode(document, node.id)]);
  assert.match(output.css, /mix-blend-mode: soft-light;/);
  assert.equal(output.layers[0].blendMode, 'soft-light');
});
