import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addNode, createComponent, createComponentInstance, createComponentSet,
  createDocument, createNode, findNode, setComponentVariantProperty,
  validateDocument
} from '../src/model.js';
import {
  addComponentVariantAxis, componentSetAssetMarkup,
  removeComponentVariantAxis, renameComponentSet, renameComponentVariantAxis
} from '../src/component-set-editor.js';

function makeSet(names = [
  'Button / State=Rest, Size=Small',
  'Button / State=Hover, Size=Small',
  'Button / State=Rest, Size=Large'
]) {
  const document = createDocument();
  const components = names.map(name => {
    const layer = createNode('frame', { name });
    addNode(document, layer);
    return createComponent(document, layer.id, name);
  });
  const set = createComponentSet(document, components.map(component => component.id), 'Button');
  return { document, components, set };
}

test('component set editor adds and renames axes across every variant without losing selections', () => {
  const { document, components, set } = makeSet();
  const instance = createComponentInstance(document, components[1].id);
  const originalComponentId = instance.componentId;

  addComponentVariantAxis(document, set.id, 'Theme', 'Light');
  assert.deepEqual(components.map(component => component.variantProperties.Theme), ['Light', 'Light', 'Light']);
  renameComponentVariantAxis(document, set.id, 'Theme', 'Color scheme');

  assert.deepEqual(set.properties.at(-1), { name: 'Color scheme', values: ['Light'] });
  assert.equal(components.every(component => !Object.hasOwn(component.variantProperties, 'Theme')), true);
  assert.equal(components.every(component => component.variantProperties['Color scheme'] === 'Light'), true);
  assert.equal(findNode(document, instance.id).node.componentId, originalComponentId, 'editing set metadata preserves each instance’s exact component identity');
  assert.equal(validateDocument(document), true);
});

test('component set editor rejects ambiguous axis removal atomically and supports removal after values distinguish variants', () => {
  const { document, components, set } = makeSet();
  const before = structuredClone(document);

  assert.throws(() => removeComponentVariantAxis(document, set.id, 'State'), /make variants indistinguishable/);
  assert.deepEqual(document, before, 'a rejected axis removal must not leave partial metadata changes');

  setComponentVariantProperty(document, components[1].id, 'Size', 'Medium');
  assert.equal(removeComponentVariantAxis(document, set.id, 'State'), true);
  assert.deepEqual(set.properties, [{ name: 'Size', values: ['Small', 'Medium', 'Large'] }]);
  assert.deepEqual(components.map(component => component.variantProperties), [{ Size: 'Small' }, { Size: 'Medium' }, { Size: 'Large' }]);
  assert.equal(validateDocument(document), true);
});

test('component set editor keeps at least one axis and prevents axis-name collisions', () => {
  const { document, set } = makeSet(['Chip / State=Rest', 'Chip / State=Hover']);
  assert.throws(() => addComponentVariantAxis(document, set.id, 'state', 'Light'), /already exists/);
  assert.throws(() => renameComponentVariantAxis(document, set.id, 'State', 'state'), /already exists/);
  assert.throws(() => removeComponentVariantAxis(document, set.id, 'State'), /at least one/);
  assert.throws(() => addComponentVariantAxis(document, set.id, 'Theme', '  '), /printable characters/);
  assert.equal(validateDocument(document), true);
});

test('Assets variant chooser exposes exact variant identities and accessible axis controls', () => {
  const { document, components, set } = makeSet();
  const instance = createComponentInstance(document, components[1].id);
  renameComponentSet(document, set.id, '<Button & Badge>');
  const markup = componentSetAssetMarkup(document, set, { selectedComponentId: instance.componentId, open: true });

  assert.equal(set.name, '<Button & Badge>');
  assert.match(markup, /&lt;Button &amp; Badge&gt;/);
  assert.doesNotMatch(markup, /<Button & Badge>/);
  for (const component of components) {
    assert.match(markup, new RegExp(`<option value="${component.id}"(?: selected)?>`));
    assert.match(markup, new RegExp(`data-place-variant="${component.id}"`));
    assert.match(markup, new RegExp(`data-component-id="${component.id}"`));
  }
  assert.match(markup, /data-component-set-placement=/);
  assert.match(markup, /data-component-set-id=/);
  assert.match(markup, new RegExp(`<option value="${components[1].id}" selected>`), 'the Assets selector must retain the exact selected variant across redraws');
  assert.match(markup, /data-component-set-editor=.* open/);
  assert.match(markup, /data-component-set-axis-name/);
  assert.match(markup, /data-variant-master-property="State"/);
  assert.match(markup, /aria-label="Choose variant from &lt;Button &amp; Badge&gt;"/);
  assert.match(markup, /Place selected/);
  assert.equal(findNode(document, instance.id).node.componentId, components[1].id);
  assert.equal(validateDocument(document), true);
});

test('variant editor controls keep phone-sized targets and visible keyboard focus', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const ruleFor = selector => {
    const start = css.indexOf(selector);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    return start < 0 || open < 0 || close < 0 ? '' : css.slice(start, close + 1);
  };
  for (const selector of ['.component-set-place-selected', '.component-set-remove-axis', '.component-set-place-variant']) {
    assert.match(ruleFor(selector), /min-height:\s*44px/);
  }
  assert.match(ruleFor('.component-set-card button:focus-visible'), /outline:/);
});
