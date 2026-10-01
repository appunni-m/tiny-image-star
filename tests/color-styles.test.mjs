import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, applyColorStyle, createColorStyle, createComponent, createComponentInstance, createDocument, createNode, deleteColorStyle, getNodeColor, parseDocument, renameColorStyle, serializeDocument, syncComponentInstances, updateColorStyle, validateDocument } from '../src/model.js';
import { addFillLayer } from '../src/fills.js';

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

test('color style updates and renames propagate through linked fills and persist locally', () => {
  const document = createDocument();
  const source = createNode('rectangle', { fill: '#0d99ff' });
  const target = createNode('ellipse', { fill: '#d9d9d9' });
  addNode(document, source); addNode(document, target);
  const style = createColorStyle(document, source.id, 'Brand blue');
  assert.equal(applyColorStyle(document, target.id, style.id), true);

  source.fill = '#8b5cf6';
  delete source.fillStyleId;
  assert.equal(updateColorStyle(document, style.id, source.id), true);
  assert.equal(getNodeColor(document, source), '#8b5cf6');
  assert.equal(getNodeColor(document, target), '#8b5cf6');
  assert.equal(renameColorStyle(document, style.id, '  Accent\nViolet  '), true);
  assert.equal(style.name, 'Accent Violet');
  assert.equal(renameColorStyle(document, style.id, '  '), false);
  assert.equal(renameColorStyle(document, style.id, 'x'.repeat(161)), false);

  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(reloaded.colorStyles[0].name, 'Accent Violet');
  assert.equal(getNodeColor(reloaded, reloaded.pages[0].children[1]), '#8b5cf6');
  assert.equal(validateDocument(reloaded), true);
});

test('applying a color style replaces an incompatible primary paint and preserves later fills', () => {
  const document = createDocument();
  const source = createNode('rectangle', { fill: '#ff6600' });
  const target = createNode('rectangle', { fillGradient: {
    type: 'linear', angle: 0,
    stops: [{ id: 'red', color: '#ff0000', position: 0 }, { id: 'blue', color: '#0000ff', position: 1 }]
  } });
  addNode(document, source); addNode(document, target);
  addFillLayer(target, { id: 'overlay', type: 'solid', color: '#ffffff', opacity: .4, visible: true });
  const style = createColorStyle(document, source.id, 'Orange');

  assert.equal(applyColorStyle(document, target.id, style.id), true);
  assert.equal(target.fills[0].type, 'solid');
  assert.equal(target.fills[0].color, '#ff6600');
  assert.equal(target.fills[1].id, 'overlay');
  assert.equal(target.fills[1].opacity, .4);
  assert.equal(getNodeColor(document, target), '#ff6600');
  assert.equal(deleteColorStyle(document, style.id), true);
  assert.equal(target.fillStyleId, undefined);
  assert.equal(target.fills[0].color, '#ff6600');
  assert.equal(target.fills[1].id, 'overlay', 'deleting the style must preserve secondary fill layers');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('deleting color styles detaches every linked fill and text layer without changing its visible color', () => {
  const document = createDocument();
  const source = createNode('rectangle', { fill: '#2255aa' });
  const linked = createNode('rectangle', { fill: '#ffffff' });
  const heading = createNode('text', { color: '#333333' });
  const linkedHeading = createNode('text', { color: '#000000' });
  for (const node of [source, linked, heading, linkedHeading]) addNode(document, node);
  const fillStyle = createColorStyle(document, source.id, 'Blue');
  const textStyle = createColorStyle(document, heading.id, 'Ink');
  assert.equal(applyColorStyle(document, linked.id, fillStyle.id), true);
  assert.equal(applyColorStyle(document, linkedHeading.id, textStyle.id), true);

  assert.equal(deleteColorStyle(document, fillStyle.id), true);
  assert.equal(deleteColorStyle(document, textStyle.id), true);
  assert.equal(deleteColorStyle(document, textStyle.id), false);
  assert.equal(linked.fillStyleId, undefined);
  assert.equal(linked.fill, '#2255aa');
  assert.equal(getNodeColor(document, linked), '#2255aa');
  assert.equal(linkedHeading.textStyleId, undefined);
  assert.equal(linkedHeading.color, '#333333');
  assert.equal(getNodeColor(document, linkedHeading, 'text'), '#333333');
  assert.equal(document.colorStyles.length, 0);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('deleting a style materializes legacy component-instance style overrides before sync', () => {
  const document = createDocument();
  const source = createNode('rectangle', { fill: '#ff5533' });
  const master = createNode('rectangle', { fill: '#335577' });
  addNode(document, source); addNode(document, master);
  const style = createColorStyle(document, source.id, 'Coral');
  const component = createComponent(document, master.id, 'Styled component');
  const instance = createComponentInstance(document, component.id);
  assert.equal(applyColorStyle(document, instance.id, style.id), true);
  // Persisted releases recorded only this reference, without the normalized fill stack.
  instance.componentOverrides[master.id] = { fillStyleId: style.id };

  assert.equal(deleteColorStyle(document, style.id), true);
  assert.equal(syncComponentInstances(document, component.id), 1);
  assert.equal(getNodeColor(document, instance), '#ff5533');
  assert.notEqual(instance.fillStyleId, style.id);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('color style creation rejects unsupported paint and overlong names before linking', () => {
  const document = createDocument();
  const gradient = createNode('rectangle', { fillGradient: {
    type: 'linear', angle: 0,
    stops: [{ id: 'start', color: '#000000', position: 0 }, { id: 'end', color: '#ffffff', position: 1 }]
  } });
  addNode(document, gradient);
  assert.throws(() => createColorStyle(document, gradient.id, 'Gradient'), /solid primary fill/);
  gradient.fillGradient = null;
  gradient.fill = '#123456';
  assert.throws(() => createColorStyle(document, gradient.id, 'x'.repeat(161)), /up to 160 characters/);
  assert.equal(gradient.fillStyleId, undefined);
  assert.equal(document.colorStyles.length, 0);
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
