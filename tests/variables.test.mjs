import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, addVariableMode, bindColorVariable, bindVariable, canBindVariable, createColorStyle, createColorVariable,
  createComponent, createComponentInstance, createDocument, createNode, createVariable, createVariableCollection, deleteVariable, deleteVariableCollection,
  getNodeColor, getNodePropertyValue, parseDocument, resolveVariableValue, serializeDocument, setColorVariableValue, setVariableAlias, setVariableValue,
  getNodeGeometry, setFrameVariableMode, syncComponentInstances, validateDocument, variableModeForNode
} from '../src/model.js';
import { addPrototypeInteraction } from '../src/prototype.js';

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

test('typed variables bind to compatible layer properties, follow frame modes, and preserve values when unlinked', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Controls');
  const light = collection.defaultModeId;
  const dark = addVariableMode(document, collection.id, 'Dark');
  const opacity = createVariable(document, collection.id, 'Opacity', 'number', 0.8);
  const radius = createVariable(document, collection.id, 'Radius', 'number', 8);
  const visible = createVariable(document, collection.id, 'Visible', 'boolean', true);
  const copy = createVariable(document, collection.id, 'Copy', 'string', 'Light copy');
  const size = createVariable(document, collection.id, 'Text size', 'number', 16);
  const line = createVariable(document, collection.id, 'Line height', 'number', 1.2);
  setVariableValue(document, opacity.id, 0.45, dark.id);
  setVariableValue(document, radius.id, 20, dark.id);
  setVariableValue(document, visible.id, false, dark.id);
  setVariableValue(document, copy.id, 'Dark copy', dark.id);
  setVariableValue(document, size.id, 24, dark.id);
  setVariableValue(document, line.id, 1.4, dark.id);

  const frame = createNode('frame', { variableModes: { [collection.id]: dark.id } });
  const shape = createNode('rectangle', { opacity: 0.6, radius: 3 });
  const text = createNode('text', { text: 'Base copy', fontSize: 12, lineHeight: 1 });
  addNode(document, frame); addNode(document, shape, { parentId: frame.id }); addNode(document, text, { parentId: frame.id });
  assert.equal(bindVariable(document, shape.id, opacity.id, 'opacity'), true);
  assert.equal(bindVariable(document, shape.id, radius.id, 'radius'), true);
  assert.equal(bindVariable(document, shape.id, visible.id, 'visible'), true);
  assert.equal(bindVariable(document, text.id, copy.id, 'text'), true);
  assert.equal(bindVariable(document, text.id, size.id, 'fontSize'), true);
  assert.equal(bindVariable(document, text.id, line.id, 'lineHeight'), true);
  assert.equal(getNodePropertyValue(document, shape, 'opacity'), 0.45);
  assert.equal(getNodePropertyValue(document, shape, 'radius'), 20);
  assert.equal(getNodePropertyValue(document, shape, 'visible'), false);
  assert.equal(getNodePropertyValue(document, text, 'text'), 'Dark copy');
  assert.equal(getNodePropertyValue(document, text, 'fontSize'), 24);
  assert.equal(getNodePropertyValue(document, text, 'lineHeight'), 1.4);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  assert.equal(setFrameVariableMode(document, frame.id, collection.id, light.id), true);
  assert.equal(getNodePropertyValue(document, shape, 'radius'), 8);
  assert.equal(getNodePropertyValue(document, text, 'text'), 'Light copy');
  assert.equal(setFrameVariableMode(document, frame.id, collection.id, dark.id), true);
  assert.equal(bindVariable(document, shape.id, null, 'radius'), true);
  assert.equal(shape.radius, 20);
  assert.equal(deleteVariable(document, copy.id), true);
  assert.equal(text.text, 'Dark copy');
  assert.equal(text.variableBindings?.text, undefined);
  assert.equal(deleteVariableCollection(document, collection.id), true);
  assert.equal(shape.opacity, 0.45);
  assert.equal(shape.visible, false);
  assert.equal(text.fontSize, 24);
  assert.equal(text.lineHeight, 1.4);
  assert.equal(validateDocument(document), true);
});

test('typed variable bindings reject incompatible properties and values that violate property ranges', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Constraints');
  const opacity = createVariable(document, collection.id, 'Opacity', 'number', 0.5);
  const badOpacity = createVariable(document, collection.id, 'Bad opacity', 'number', 1.2);
  const badRadius = createVariable(document, collection.id, 'Bad radius', 'number', -1);
  const textValue = createVariable(document, collection.id, 'Label', 'string', 'Hello');
  const shape = createNode('rectangle');
  const text = createNode('text');
  addNode(document, shape); addNode(document, text);

  assert.equal(canBindVariable(document, shape.id, opacity.id, 'opacity'), true);
  assert.equal(canBindVariable(document, shape.id, badOpacity.id, 'opacity'), false);
  assert.equal(canBindVariable(document, text.id, opacity.id, 'opacity'), true);
  assert.equal(bindVariable(document, shape.id, opacity.id, 'opacity'), true);
  assert.equal(bindVariable(document, shape.id, badOpacity.id, 'opacity'), false);
  assert.equal(bindVariable(document, shape.id, badRadius.id, 'radius'), false);
  assert.equal(bindVariable(document, shape.id, textValue.id, 'opacity'), false);
  assert.equal(bindVariable(document, text.id, opacity.id, 'fontSize'), true);
  assert.equal(setVariableValue(document, opacity.id, 1.4), false);
  assert.equal(opacity.valuesByMode[collection.defaultModeId], 0.5);
  assert.equal(validateDocument(document), true);
});

test('frame mode changes roll back when a cross-collection alias would invalidate a bound property', () => {
  const document = createDocument();
  const bindingCollection = createVariableCollection(document, 'Semantic opacity');
  const bindingDefault = bindingCollection.defaultModeId;
  const bindingAlternate = addVariableMode(document, bindingCollection.id, 'Alternate').id;
  const targetCollection = createVariableCollection(document, 'Palette');
  const targetInvalid = addVariableMode(document, targetCollection.id, 'Invalid opacity');
  const target = createVariable(document, targetCollection.id, 'Opacity target', 'number', 0.5);
  assert.equal(setVariableValue(document, target.id, 1.5, targetInvalid.id), true);
  const semantic = createVariable(document, bindingCollection.id, 'Card opacity', 'number', 0.7);
  assert.equal(setVariableAlias(document, semantic.id, target.id, bindingDefault), true);
  assert.equal(setVariableValue(document, semantic.id, 0.8, bindingAlternate), true);

  const frame = createNode('frame');
  const shape = createNode('rectangle', { opacity: 0.25 });
  addNode(document, frame);
  addNode(document, shape, { parentId: frame.id });
  assert.equal(bindVariable(document, shape.id, semantic.id, 'opacity'), true);
  assert.equal(getNodePropertyValue(document, shape, 'opacity'), 0.5);
  assert.equal(validateDocument(document), true);

  assert.equal(setFrameVariableMode(document, frame.id, targetCollection.id, targetInvalid.id), false);
  assert.equal(frame.variableModes, undefined, 'a rejected frame mode change leaves the prior override untouched');
  assert.equal(getNodePropertyValue(document, shape, 'opacity'), 0.5);
  assert.equal(validateDocument(document), true);
});

test('typed variable property overrides survive component synchronization and deletion cleanup', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Copy');
  const variable = createVariable(document, collection.id, 'Button label', 'string', 'Continue');
  const master = createNode('frame', { name: 'Button' });
  const masterText = createNode('text', { text: 'Default' });
  addNode(document, master); addNode(document, masterText, { parentId: master.id });
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceText = instance.children[0];
  assert.equal(bindVariable(document, instanceText.id, variable.id, 'text'), true);
  instance.componentOverrides[instanceText.componentSourceId] = { variableBindings: structuredClone(instanceText.variableBindings) };
  assert.equal(validateDocument(document), true);

  masterText.text = 'Updated default';
  syncComponentInstances(document, component.id);
  assert.equal(instance.children[0].variableBindings.text, variable.id);
  assert.equal(getNodePropertyValue(document, instance.children[0], 'text'), 'Continue');
  assert.equal(deleteVariable(document, variable.id), true);
  syncComponentInstances(document, component.id);
  assert.equal(instance.children[0].variableBindings, undefined);
  assert.equal(instance.componentOverrides[instanceText.componentSourceId], undefined);
  assert.equal(validateDocument(document), true);
});

test('geometry variables resolve per inherited mode, validate every value, and materialize on unlink', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Geometry');
  const compact = collection.defaultModeId;
  const expanded = addVariableMode(document, collection.id, 'Expanded');
  const tokens = Object.fromEntries(['x', 'y', 'width', 'height', 'rotation'].map(property => [
    property, createVariable(document, collection.id, property, 'number', property === 'width' ? 80 : property === 'height' ? 40 : 0)
  ]));
  const expandedValues = { x: 36, y: -12, width: 240, height: 96, rotation: 15 };
  for (const [property, value] of Object.entries(expandedValues)) assert.equal(setVariableValue(document, tokens[property].id, value, expanded.id), true);

  const frame = createNode('frame', { x: 10, y: 20, variableModes: { [collection.id]: compact } });
  const card = createNode('rectangle', { x: 3, y: 4, width: 12, height: 12 });
  addNode(document, frame); addNode(document, card, { parentId: frame.id });
  for (const property of Object.keys(tokens)) assert.equal(bindVariable(document, card.id, tokens[property].id, property), true, `${property} binding`);

  assert.deepEqual(getNodeGeometry(document, card), { x: 0, y: 0, width: 80, height: 40, rotation: 0 });
  assert.equal(setFrameVariableMode(document, frame.id, collection.id, expanded.id), true);
  assert.deepEqual(getNodeGeometry(document, card), expandedValues);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  assert.equal(setVariableValue(document, tokens.width.id, -1, compact), false, 'negative mode values are rejected when bound as width');
  assert.equal(setVariableValue(document, tokens.height.id, -1, expanded.id), false, 'negative mode values are rejected in non-default modes');
  assert.equal(tokens.width.valuesByMode[compact], 80);
  assert.equal(tokens.height.valuesByMode[expanded.id], 96);

  assert.equal(bindVariable(document, card.id, null, 'width'), true);
  assert.equal(card.width, 240, 'unlinking materializes the currently resolved width instead of exposing stale raw width');
  assert.equal(getNodePropertyValue(document, card, 'width'), 240);
  assert.equal(validateDocument(document), true);
  assert.ok(collection.modes.some(mode => mode.id === compact) && collection.modes.some(mode => mode.id === expanded.id));
});

test('geometry bindings reject incompatible values and unknown properties during document validation', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Geometry');
  const width = createVariable(document, collection.id, 'Width', 'number', 120);
  const text = createVariable(document, collection.id, 'Text', 'string', 'bad');
  const rectangle = createNode('rectangle');
  addNode(document, rectangle);
  assert.equal(bindVariable(document, rectangle.id, text.id, 'width'), false);
  assert.equal(bindVariable(document, rectangle.id, width.id, 'width'), true);
  const unknown = structuredClone(document);
  unknown.pages[0].children[0].variableBindings.depth = width.id;
  assert.throws(() => validateDocument(unknown), /Invalid depth variable binding/);
});

test('auto layout variables resolve by mode and preserve their resolved value when unbound', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Layout');
  const compact = collection.defaultModeId;
  const roomy = addVariableMode(document, collection.id, 'Roomy');
  const columnGap = createVariable(document, collection.id, 'Column gap', 'number', 8);
  const leftPadding = createVariable(document, collection.id, 'Left padding', 'number', 12);
  const gridRows = createVariable(document, collection.id, 'Grid rows', 'number', 2);
  const wrap = createVariable(document, collection.id, 'Wrap', 'boolean', false);
  assert.equal(setVariableValue(document, columnGap.id, 24, roomy.id), true);
  assert.equal(setVariableValue(document, leftPadding.id, 28, roomy.id), true);
  assert.equal(setVariableValue(document, gridRows.id, 4, roomy.id), true);
  assert.equal(setVariableValue(document, wrap.id, true, roomy.id), true);

  const frame = createNode('frame', {
    autoLayout: { axis: 'horizontal', columnGap: 4, padding: { left: 5, right: 5, top: 5, bottom: 5 } },
    variableModes: { [collection.id]: compact }
  });
  addNode(document, frame);
  assert.equal(bindVariable(document, frame.id, columnGap.id, 'autoLayout.columnGap'), true);
  assert.equal(bindVariable(document, frame.id, leftPadding.id, 'autoLayout.padding.left'), true);
  assert.equal(bindVariable(document, frame.id, gridRows.id, 'autoLayout.rows'), true);
  assert.equal(bindVariable(document, frame.id, wrap.id, 'autoLayout.wrap'), true);
  assert.deepEqual([
    getNodePropertyValue(document, frame, 'autoLayout.columnGap'),
    getNodePropertyValue(document, frame, 'autoLayout.padding.left'),
    getNodePropertyValue(document, frame, 'autoLayout.rows'),
    getNodePropertyValue(document, frame, 'autoLayout.wrap')
  ], [8, 12, 2, false]);
  assert.equal(setFrameVariableMode(document, frame.id, collection.id, roomy.id), true);
  assert.deepEqual([
    getNodePropertyValue(document, frame, 'autoLayout.columnGap'),
    getNodePropertyValue(document, frame, 'autoLayout.padding.left'),
    getNodePropertyValue(document, frame, 'autoLayout.rows'),
    getNodePropertyValue(document, frame, 'autoLayout.wrap')
  ], [24, 28, 4, true]);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  assert.equal(setVariableValue(document, columnGap.id, -1, compact), false, 'negative gaps cannot be applied in any variable mode');
  assert.equal(setVariableValue(document, gridRows.id, 0, compact), false, 'grid row counts must remain in the supported 1–64 range');
  assert.equal(bindVariable(document, frame.id, null, 'autoLayout.padding.left'), true);
  assert.equal(frame.autoLayout.padding.left, 28, 'unbinding stores the active mode’s resolved padding');
  assert.equal(getNodePropertyValue(document, frame, 'autoLayout.padding.left'), 28);
  assert.equal(validateDocument(document), true);
});

test('deleting a variable or its collection removes prototype routes that depend on the deleted condition', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Prototype state');
  const variable = createVariable(document, collection.id, 'Route', 'string', 'home');
  const home = createNode('frame', { name: 'Home' });
  const destination = createNode('frame', { name: 'Destination', x: 500 });
  const source = createNode('rectangle', { name: 'Conditional route' });
  home.children.push(source);
  addNode(document, home); addNode(document, destination);
  addPrototypeInteraction(document, source.id, destination.id, {
    condition: { variableId: variable.id, type: 'string', operator: 'equals', value: 'home' }
  });

  assert.equal(deleteVariable(document, variable.id), true);
  assert.equal(source.interactions, undefined, 'a route with an unavailable condition variable must not become unconditional');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const collectionVariable = createVariable(document, collection.id, 'Second route', 'boolean', true);
  addPrototypeInteraction(document, source.id, destination.id, {
    condition: { variableId: collectionVariable.id, type: 'boolean', operator: 'equals', value: true }
  });
  assert.equal(deleteVariableCollection(document, collection.id), true);
  assert.equal(source.interactions, undefined, 'deleting a collection must remove routes that depend on its variables');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});
