import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, applyColorStyle, createColorStyle, createDocument, createNode, getNodeColor, parseDocument, serializeDocument, validateDocument } from '../src/model.js';

test('shared fill styles update every linked layer and survive local document reload', () => {
  const document = createDocument();
  const source = createNode('rectangle', { fill: '#0d99ff' });
  const target = createNode('ellipse', { fill: '#d9d9d9' });
  addNode(document, source); addNode(document, target);

  const style = createColorStyle(document, source.id, 'Brand blue');
  assert.equal(applyColorStyle(document, target.id, style.id), true);
  assert.equal(getNodeColor(document, target), '#0d99ff');
  style.value = '#8b5cf6';
  assert.equal(getNodeColor(document, source), '#8b5cf6');
  assert.equal(getNodeColor(document, target), '#8b5cf6');

  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(getNodeColor(reloaded, reloaded.pages[0].children[1]), '#8b5cf6');
  assert.equal(validateDocument(reloaded), true);
});

test('text color styles stay compatible with text layers only', () => {
  const document = createDocument();
  const heading = createNode('text', { color: '#242424' });
  const shape = createNode('rectangle');
  addNode(document, heading); addNode(document, shape);
  const style = createColorStyle(document, heading.id, 'Ink');
  assert.equal(style.kind, 'text');
  assert.equal(applyColorStyle(document, shape.id, style.id), false);
  assert.equal(getNodeColor(document, heading, 'text'), '#242424');
});

test('document validation rejects malformed shared styles and dangling references', () => {
  const document = createDocument();
  const shape = createNode('rectangle'); addNode(document, shape);
  document.colorStyles = [{ id: 'color-bad', name: 'Broken', kind: 'fill', value: 'blue' }];
  assert.throws(() => validateDocument(document), /Invalid or duplicate color style/);
  document.colorStyles = [{ id: 'color-good', name: 'Good', kind: 'fill', value: '#112233' }];
  shape.fillStyleId = 'missing';
  assert.throws(() => validateDocument(document), /Missing fill style/);
});
