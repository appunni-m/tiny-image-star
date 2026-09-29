import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createComponent, createComponentInstance, createDocument, createGradientFill, createNode, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { createGradientPaint, gradientFillToCSS, isValidGradientFill } from '../src/fills.js';

test('linear and radial gradients survive local design serialization', () => {
  const document = createDocument();
  const linear = createNode('rectangle', { fillGradient: createGradientFill('linear', '#ff0000') });
  linear.fillGradient.stops[1].color = '#0000ff';
  linear.fillGradient.angle = 135;
  const radial = createNode('ellipse', { fillGradient: createGradientFill('radial', '#00ff00') });
  addNode(document, linear); addNode(document, radial);
  const restored = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(restored), true);
  assert.deepEqual(restored.pages[0].children.map(node => node.fillGradient), [linear.fillGradient, radial.fillGradient]);
});

test('gradient validation rejects invalid types, unsupported layers, and unordered stops', () => {
  const valid = createGradientFill('linear');
  assert.equal(isValidGradientFill(valid), true);
  const document = createDocument();
  addNode(document, createNode('text', { fillGradient: valid }));
  assert.throws(() => validateDocument(document), /Gradient fill is not supported/);
  const invalid = createDocument();
  const shape = createNode('rectangle', { fillGradient: valid });
  shape.fillGradient.stops.reverse();
  addNode(invalid, shape);
  assert.throws(() => validateDocument(invalid), /Invalid gradient fill/);
  assert.throws(() => createGradientFill('conic'), /Unsupported gradient fill/);
});

test('component gradient overrides validate before they can be synchronized into instances', () => {
  const document = createDocument();
  const master = createNode('rectangle'); addNode(document, master);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[master.id] = { fillGradient: { type: 'linear', angle: 0, stops: [] } };
  assert.throws(() => validateDocument(document), /Invalid component gradient override/);
});

test('canvas gradient geometry follows angle and radial center while CSS includes fill opacity', () => {
  const calls = [];
  const context = {
    createLinearGradient(...args) { calls.push(['linear', ...args]); return { addColorStop: (...stop) => calls.push(['stop', ...stop]) }; },
    createRadialGradient(...args) { calls.push(['radial', ...args]); return { addColorStop: (...stop) => calls.push(['stop', ...stop]) }; }
  };
  const linear = createGradientFill('linear', '#ff0000');
  linear.stops[1].color = '#0000ff';
  createGradientPaint(context, linear, 10, 20, 100, 50);
  assert.deepEqual(calls[0], ['linear', 10, 45, 110, 45]);
  const radial = createGradientFill('radial', '#123456');
  calls.length = 0;
  createGradientPaint(context, radial, 10, 20, 100, 50);
  assert.deepEqual(calls[0], ['radial', 60, 45, 0, 60, 45, Math.hypot(100, 50) / 2]);
  assert.equal(gradientFillToCSS(linear, 0.5), 'linear-gradient(90deg, rgba(255, 0, 0, 0.5) 0%, rgba(0, 0, 255, 0.5) 100%)');
});
