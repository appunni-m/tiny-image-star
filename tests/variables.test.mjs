import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, addVariableMode, bindColorVariable, createColorStyle, createColorVariable,
  createComponent, createComponentInstance, createDocument, createNode, createVariable, createVariableCollection, deleteVariable, deleteVariableCollection,
  getNodeColor, parseDocument, resolveVariableValue, serializeDocument, setColorVariableValue, setVariableAlias, setVariableValue,
  setFrameVariableMode, syncComponentInstances, validateDocument, variableModeForNode
} from '../src/model.js';

test('color variables resolve through nested frame modes and survive a local round trip', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Brand');
  collection.modes[0].name = 'Light';
  const light = collection.modes[0];
  const dark = addVariableMode(document, collection.id, 'Dark');
  const variable = createColorVariable(document, collection.id, 'Surface', '#f7f7f7');
  assert.equal(setColorVariableValue(document, variable.id, '#202124', dark.id), true);

  const frame = createNode('frame', { variableModes: { [collection.id]: dark.id } });
  const nestedFrame = createNode('frame');
  const card = createNode('rectangle', { fill: '#ffffff' });
  addNode(document, frame);
  addNode(document, nestedFrame, { parentId: frame.id });
  addNode(document, card, { parentId: nestedFrame.id });
  assert.equal(bindColorVariable(document, card.id, variable.id, 'fill'), true);
  assert.equal(variableModeForNode(document, collection.id, card), dark.id);
  assert.equal(getNodeColor(document, card), '#202124');

  assert.equal(setFrameVariableMode(document, nestedFrame.id, collection.id, light.id), true);
  assert.equal(getNodeColor(document, card), '#f7f7f7');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('variables replace local color styles and deleting a collection cleanly unbinds layers', () => {
  const document = createDocument();
  const collection = createVariableCollection(document);
  const variable = createColorVariable(document, collection.id, 'Accent', '#0d99ff');
  const shape = createNode('rectangle', { fill: '#111111' });
  addNode(document, shape);
  const style = createColorStyle(document, shape.id, 'Local style');

  assert.equal(bindColorVariable(document, shape.id, variable.id, 'fill'), true);
  assert.equal(shape.fillStyleId, undefined);
  assert.equal(getNodeColor(document, shape), '#0d99ff');
  assert.equal(deleteVariableCollection(document, collection.id), true);
  assert.equal(shape.fillVariableId, undefined);
  assert.equal(getNodeColor(document, shape), style.value);
  assert.equal(validateDocument(document), true);
});

test('invalid variable mode references and incompatible bindings are rejected', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Colors');
  const variable = createColorVariable(document, collection.id, 'Ink', '#202124');
  const frame = createNode('frame', { variableModes: { [collection.id]: 'missing-mode' } });
  const text = createNode('text');
  addNode(document, frame);
  addNode(document, text);

  assert.equal(bindColorVariable(document, text.id, variable.id, 'fill'), false);
  assert.equal(bindColorVariable(document, text.id, variable.id, 'text'), true);
  assert.throws(() => validateDocument(document), /Missing variable mode/);
  frame.variableModes[collection.id] = collection.defaultModeId;
  text.textVariableId = 'missing-variable';
  assert.throws(() => validateDocument(document), /Missing text variable/);
});

test('component instances retain color-variable overrides and deletion removes stale references', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Brand');
  const variable = createColorVariable(document, collection.id, 'Accent', '#7654c8');
  const master = createNode('frame', { name: 'Button' });
  const masterFill = createNode('rectangle', { fill: '#222222' });
  addNode(document, master); addNode(document, masterFill, { parentId: master.id });
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceFill = instance.children[0];
  assert.equal(bindColorVariable(document, instanceFill.id, variable.id, 'fill'), true);
  instance.componentOverrides[instanceFill.componentSourceId] = { fillVariableId: variable.id };
  assert.equal(validateDocument(document), true);

  masterFill.fill = '#334455';
  syncComponentInstances(document, component.id);
  assert.equal(instance.children[0].fillVariableId, variable.id);
  assert.equal(getNodeColor(document, instance.children[0]), '#7654c8');
  deleteVariableCollection(document, collection.id);
  syncComponentInstances(document, component.id);
  assert.equal(instance.children[0].fillVariableId, undefined);
  assert.equal(instance.componentOverrides[instanceFill.componentSourceId], undefined);
  assert.equal(validateDocument(document), true);
});

test('number, string, and Boolean variables keep typed values for every mode', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Tokens');
  const light = collection.defaultModeId;
  const dark = addVariableMode(document, collection.id, 'Dark');
  const spacing = createVariable(document, collection.id, 'Spacing', 'number', 8);
  const label = createVariable(document, collection.id, 'Button label', 'string', 'Continue');
  const enabled = createVariable(document, collection.id, 'Enabled', 'boolean', true);

  assert.equal(setVariableValue(document, spacing.id, 12.5, dark.id), true);
  assert.equal(setVariableValue(document, label.id, 'Save changes', dark.id), true);
  assert.equal(setVariableValue(document, enabled.id, false, dark.id), true);
  assert.equal(setVariableValue(document, spacing.id, '12', dark.id), false);
  assert.equal(setVariableValue(document, enabled.id, 0, dark.id), false);
  assert.equal(resolveVariableValue(document, spacing.id), 8);
  assert.equal(resolveVariableValue(document, label.id), 'Continue');
  assert.equal(resolveVariableValue(document, enabled.id), true);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
  assert.deepEqual([light, dark.id].map(modeId => spacing.valuesByMode[modeId]), [8, 12.5]);
});

test('same-type variable aliases resolve per mode, reject cycles, and materialize on source deletion', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Spacing');
  const compact = collection.defaultModeId;
  const spacious = addVariableMode(document, collection.id, 'Spacious');
  const base = createVariable(document, collection.id, 'Base', 'number', 8);
  const component = createVariable(document, collection.id, 'Component', 'number', 16);
  const wrongType = createVariable(document, collection.id, 'Label', 'string', 'Large');

  assert.equal(setVariableAlias(document, component.id, base.id, compact), true);
  assert.equal(setVariableValue(document, base.id, 24, spacious.id), true);
  assert.equal(setVariableAlias(document, component.id, base.id, spacious.id), true);
  assert.equal(setVariableAlias(document, base.id, component.id, compact), false);
  assert.equal(setVariableAlias(document, component.id, wrongType.id, compact), false);
  assert.equal(resolveVariableValue(document, component.id), 8);
  assert.equal(validateDocument(document), true);

  assert.equal(deleteVariable(document, base.id), true);
  assert.equal(component.aliasesByMode, undefined);
  assert.equal(component.valuesByMode[compact], 8);
  assert.equal(component.valuesByMode[spacious.id], 24);
  assert.equal(validateDocument(document), true);
});

test('variable validation rejects wrong primitive values, missing alias targets, and alias cycles', () => {
  const document = createDocument();
  const collection = createVariableCollection(document);
  const first = createVariable(document, collection.id, 'First', 'string', 'one');
  const second = createVariable(document, collection.id, 'Second', 'string', 'two');
  assert.equal(setVariableAlias(document, first.id, second.id), true);
  assert.equal(validateDocument(document), true);

  const cycle = structuredClone(document);
  cycle.variables.find(item => item.id === second.id).aliasesByMode = { [collection.defaultModeId]: first.id };
  assert.throws(() => validateDocument(cycle), /Variable aliases cannot contain a cycle/);
  const missing = structuredClone(document);
  missing.variables.find(item => item.id === first.id).aliasesByMode[collection.defaultModeId] = 'deleted';
  assert.throws(() => validateDocument(missing), /Invalid alias/);
  const invalid = structuredClone(document);
  invalid.variables.find(item => item.id === first.id).valuesByMode[collection.defaultModeId] = 5;
  assert.throws(() => validateDocument(invalid), /Invalid mode values/);
});
