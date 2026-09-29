import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, addVariableMode, bindColorVariable, bindVariable, createDocument, createGradientFill, createLayerEffect, createNode, createVariable, createVariableCollection, findNode, setVariableValue } from '../src/model.js';
import { createImageFill } from '../src/image-fills.js';
import { buildInspectOutput } from '../src/inspect.js';

test('Inspect output reports page-space geometry, resolved styles, text metrics and exact layer JSON', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Outer frame', x: 25, y: 35, width: 300, height: 220 });
  const label = createNode('text', {
    name: 'Hero title', x: 12, y: 18, width: 180, height: 40, text: 'Hello',
    fontFamily: 'Arial, sans-serif', fontSize: 24, fontWeight: 600, lineHeight: 1.5, letterSpacing: 0.5,
    rotation: -4, color: '#112233', textCase: 'capitalize', textDecoration: 'underline'
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
  assert.equal(output.layers[0].typography.textCase, 'capitalize');
  assert.equal(output.layers[0].typography.textDecoration, 'underline');
  assert.match(output.css, /\.hero-title-[a-z0-9_-]+ \{/);
  assert.match(output.css, /left: 37px;/);
  assert.match(output.css, /top: 53px;/);
  assert.match(output.css, /color: #445566;/);
  assert.match(output.css, /font-size: 24px;/);
  assert.match(output.css, /line-height: 36px;/);
  assert.match(output.css, /text-transform: capitalize;/);
  assert.match(output.css, /text-decoration: underline;/);
  assert.match(output.css, /transform: rotate\(-4deg\);/);
  assert.equal(JSON.parse(output.json).id, label.id);
});

test('Inspect output provides nested HTML and CSS scaffolding for a selected layer tree', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Card', x: 16, y: 24, width: 240, height: 120 });
  const title = createNode('text', { name: 'Title', text: 'Save <changes> & keep', x: 12, y: 16, width: 180, height: 28 });
  const badge = createNode('ellipse', { name: 'Badge', x: 190, y: 12, width: 24, height: 24 });
  addNode(document, frame);
  addNode(document, title, { parentId: frame.id });
  addNode(document, badge, { parentId: frame.id });

  const frameEntry = findNode(document, frame.id);
  const titleEntry = findNode(document, title.id);
  const output = buildInspectOutput(document, [frameEntry, titleEntry]);
  assert.match(output.html, /data-layer-type="frame"/);
  assert.match(output.html, /Save &lt;changes&gt; &amp; keep/);
  assert.match(output.html, /data-layer-type="ellipse"/);
  assert.equal((output.html.match(/data-layer-type="text"/g) || []).length, 1, 'selected descendants should not be emitted twice');
  assert.match(output.css, /\.card-[a-z0-9_-]+ \{/);
  assert.match(output.css, /\.title-[a-z0-9_-]+ \{/);
  assert.match(output.css, /\.badge-[a-z0-9_-]+ \{/);
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

test('Inspect output exports custom font fallbacks, weights, and italic text style', () => {
  const document = createDocument();
  const node = createNode('text', { text: 'Readable', fontFamily: 'Atkinson Hyperlegible, sans-serif', fontWeight: 800, fontStyle: 'italic' });
  addNode(document, node);
  const output = buildInspectOutput(document, [findNode(document, node.id)]);
  assert.match(output.css, /font-family: "Atkinson Hyperlegible", sans-serif;/);
  assert.match(output.css, /font-weight: 800;/);
  assert.match(output.css, /font-style: italic;/);
  assert.deepEqual(output.layers[0].typography, {
    fontFamily: 'Atkinson Hyperlegible, sans-serif', fontSize: 24, fontWeight: 800, fontStyle: 'italic', lineHeight: 1.25, letterSpacing: 0, align: 'left', textCase: 'none', textDecoration: 'none'
  });
});

test('Inspect handoff reports mode-resolved geometry instead of stale raw layer fields', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Responsive layout');
  const compact = collection.defaultModeId;
  const wide = addVariableMode(document, collection.id, 'Wide');
  const frameX = createVariable(document, collection.id, 'Frame X', 'number', 20);
  const x = createVariable(document, collection.id, 'Card X', 'number', 10);
  const width = createVariable(document, collection.id, 'Card width', 'number', 100);
  const height = createVariable(document, collection.id, 'Card height', 'number', 50);
  const rotation = createVariable(document, collection.id, 'Card rotation', 'number', 0);
  for (const [variable, value] of [[frameX, 50], [x, 20], [width, 120], [height, 60], [rotation, 15]]) {
    assert.equal(setVariableValue(document, variable.id, value, wide.id), true);
  }
  const frame = createNode('frame', { name: 'Frame', x: 0, y: 30, variableModes: { [collection.id]: wide.id } });
  const card = createNode('rectangle', { name: 'Card', x: 0, y: 10, width: 5, height: 5 });
  addNode(document, frame); addNode(document, card, { parentId: frame.id });
  assert.equal(bindVariable(document, frame.id, frameX.id, 'x'), true);
  for (const [property, variable] of Object.entries({ x, width, height, rotation })) assert.equal(bindVariable(document, card.id, variable.id, property), true);

  const output = buildInspectOutput(document, [findNode(document, card.id)]);
  assert.deepEqual(output.layers[0].position, { x: 70, y: 40 });
  assert.deepEqual(output.layers[0].size, { width: 120, height: 60 });
  assert.equal(output.layers[0].rotation, 15);
  assert.match(output.css, /left: 70px;/);
  assert.match(output.css, /top: 40px;/);
  assert.match(output.css, /width: 120px;/);
  assert.match(output.css, /height: 60px;/);
  assert.match(output.css, /transform: rotate\(15deg\);/);
  assert.equal(compact, collection.modes[0].id);
});
