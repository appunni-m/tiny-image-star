import test from 'node:test';
import assert from 'node:assert/strict';
import { clampCornerRadii, containsPointInRoundedRect, roundedRectSvgPath, traceRoundedRectPath } from '../src/corner-radii.js';
import { addNode, createComponent, createComponentInstance, createDocument, createNode, createVariable, createVariableCollection, findNode, parseDocument, serializeDocument, syncComponentInstances, validateDocument } from '../src/model.js';
import { exportNodeToSvg, exportPageToSvg } from '../src/svg-export.js';
import { buildInspectOutput } from '../src/inspect.js';
import { hitTestPage } from '../src/renderer.js';

test('independent radii stay within adjacent edges and hit testing follows each corner', () => {
  const radii = clampCornerRadii(100, 60, { topLeft: 90, topRight: 30, bottomRight: 20, bottomLeft: 80 });
  assert.ok(Math.abs(radii.topLeft - 90 * 60 / 170) < 1e-10);
  assert.ok(Math.abs(radii.topRight - 30 * 60 / 170) < 1e-10);
  assert.ok(Math.abs(radii.bottomRight - 20 * 60 / 170) < 1e-10);
  assert.ok(Math.abs(radii.bottomLeft - 80 * 60 / 170) < 1e-10);
  assert.equal(containsPointInRoundedRect(1, 1, 100, 60, { topLeft: 30, topRight: 0, bottomRight: 0, bottomLeft: 0 }), false);
  assert.equal(containsPointInRoundedRect(15, 15, 100, 60, { topLeft: 30, topRight: 0, bottomRight: 0, bottomLeft: 0 }), true);
  assert.equal(containsPointInRoundedRect(1, 1, 100, 60, { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }), true);
});

test('canvas and SVG paths describe distinct corner curves in top-left clockwise order', () => {
  const calls = [];
  const context = Object.fromEntries(['moveTo', 'lineTo', 'quadraticCurveTo'].map(name => [name, (...values) => calls.push([name, ...values])]));
  const radii = { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 };
  traceRoundedRectPath(context, 0, 0, 100, 60, radii);
  assert.deepEqual(calls[0], ['moveTo', 4, 0]);
  assert.deepEqual(calls[1], ['lineTo', 92, 0]);
  assert.match(roundedRectSvgPath(100, 60, radii), /^M 4 0 L 92 0 Q 100 0 100 8 .* Q 0 60 0 44 .*$/);
});

test('independent corner radii validate, persist, and flow through component instances', () => {
  const document = createDocument();
  const master = createNode('frame');
  const sourceRadii = { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 };
  const rectangle = createNode('rectangle', { cornerRadii: sourceRadii });
  sourceRadii.topLeft = 99;
  assert.equal(rectangle.cornerRadii.topLeft, 4, 'new nodes own their corner-radius values');
  addNode(document, master);
  addNode(document, rectangle, { parentId: master.id });
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  instanceNode.componentOverrides[rectangle.id] = { cornerRadii: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 } };
  syncComponentInstances(document, component.id);
  assert.deepEqual(instanceNode.children[0].cornerRadii, { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 });
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  assert.deepEqual(findNode(reopened, instance.id).node.children[0].cornerRadii, { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 });

  const invalid = structuredClone(reopened);
  findNode(invalid, rectangle.id).node.cornerRadii.bottomLeft = -1;
  assert.throws(() => validateDocument(invalid), /Invalid independent corner radii/);
  const missingCorner = structuredClone(reopened);
  delete findNode(missingCorner, rectangle.id).node.cornerRadii.bottomRight;
  assert.throws(() => validateDocument(missingCorner), /Invalid independent corner radii/);
  const extraCorner = structuredClone(reopened);
  findNode(extraCorner, rectangle.id).node.cornerRadii.center = 4;
  assert.throws(() => validateDocument(extraCorner), /Invalid independent corner radii/);
  const invalidOverride = structuredClone(reopened);
  findNode(invalidOverride, instance.id).node.componentOverrides[rectangle.id].cornerRadii.bottomRight = -1;
  assert.throws(() => validateDocument(invalidOverride), /Invalid component corner-radius override/);
  const wrongType = createDocument();
  addNode(wrongType, createNode('line', { cornerRadii: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 } }));
  assert.throws(() => validateDocument(wrongType), /Invalid independent corner radii/);
});

test('canvas hit testing respects independent corners on clipped frames', () => {
  const document = createDocument();
  const frame = createNode('frame', {
    width: 100, height: 60, clip: true,
    cornerRadii: { topLeft: 30, topRight: 0, bottomRight: 0, bottomLeft: 0 }
  });
  const child = createNode('rectangle', { width: 100, height: 60 });
  addNode(document, frame);
  addNode(document, child, { parentId: frame.id });
  assert.equal(hitTestPage(document.pages[0], { x: 2, y: 2 }, null, document)?.id, frame.id,
    'a clipped corner remains selectable as the frame but excludes the child beneath it');
  assert.equal(hitTestPage(document.pages[0], { x: 20, y: 20 }, null, document)?.id, child.id);
});

test('independent corners cannot retain an ambiguous uniform-radius variable binding', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Corners');
  const radius = createVariable(document, collection.id, 'Radius', 'number', 12);
  const rectangle = createNode('rectangle', {
    cornerRadii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
    variableBindings: { radius: radius.id }
  });
  addNode(document, rectangle);
  assert.throws(() => validateDocument(document), /Independent corner radii cannot use a uniform radius variable binding/);
});

test('independent corners remain editable in exported shape and frame clipping paths', () => {
  const radii = { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 };
  const rectangle = createNode('rectangle', { width: 100, height: 60, fill: '#123456', cornerRadii: radii });
  const svg = exportNodeToSvg(rectangle);
  assert.match(svg, /<path d="M 4 0 L 92 0 Q 100 0 100 8 .*" fill="#123456"/);
  assert.doesNotMatch(svg, /<rect x="0" y="0" width="100" height="60" rx=/);
  const invalid = createNode('rectangle', { cornerRadii: { topLeft: -1, topRight: 0, bottomRight: 0, bottomLeft: 0 } });
  assert.throws(() => exportNodeToSvg(invalid), /requires valid independent corner radii/);

  const frame = createNode('frame', { width: 100, height: 60, clip: true, cornerRadii: radii, children: [createNode('rectangle', { x: 70, y: 40, width: 40, height: 30 })] });
  assert.match(exportPageToSvg({ id: 'page', children: [frame] }), /<clipPath[^>]*><path d="M 4 0 L 92 0 Q 100 0 100 8/);
});

test('Inspect CSS and layer data retain independent border radii', () => {
  const rectangle = createNode('rectangle', {
    width: 100, height: 60, cornerRadii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 }
  });
  const output = buildInspectOutput(createDocument(), [{ node: rectangle, parents: [] }]);
  assert.match(output.css, /border-radius: 4px 8px 12px 16px;/);
  assert.equal(output.layers[0].borderRadius, '4px 8px 12px 16px');
  assert.deepEqual(JSON.parse(output.json).cornerRadii, rectangle.cornerRadii);
});
