import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addComponentVariantFromMaster, addNode, createComponent, createComponentInstance,
  createComponentProperty, createComponentSet, createDocument, createNode, findNode,
  parseDocument, removeComponentVariantFromSet, serializeDocument, setComponentSlotContent, setComponentVariantProperty,
  validateDocument
} from '../src/model.js';
import { addPrototypeInteraction } from '../src/prototype.js';
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

test('component set editor safely stores a printable prototype-named axis', () => {
  const { document, components, set } = makeSet(['Chip / State=Rest', 'Chip / State=Hover']);

  addComponentVariantAxis(document, set.id, '__proto__', 'Light');

  assert.equal(components.every(component => Object.hasOwn(component.variantProperties, '__proto__')), true);
  assert.deepEqual(components.map(component => component.variantProperties.__proto__), ['Light', 'Light']);
  assert.equal(validateDocument(document), true);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true,
    'prototype-named axis values survive a serialized document round-trip');
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

test('Assets exposes selected-master variant creation and non-destructive removal with the two-variant floor', () => {
  const { document, components, set } = makeSet();
  const markup = componentSetAssetMarkup(document, set, { selectedComponentId: components[1].id, open: true });

  assert.match(markup, new RegExp(`<option value="${components[1].id}" selected>`), 'the active variant chooser identifies the master to copy');
  assert.match(markup, /data-component-set-add-variant="[^\"]+"/);
  assert.match(markup, /data-action="add-component-variant-from-master" data-set-id="[^"]+" aria-label="Add variant from selected master">Add variant from selected<\/button>/);
  for (const axis of set.properties) {
    assert.match(markup, new RegExp(`data-component-set-new-variant-value="${set.id}"[^>]*data-axis-name="${axis.name}"`));
    assert.match(markup, new RegExp(`aria-label="New ${axis.name} value; leave blank to inherit from selected master"`));
  }

  for (const component of components) {
    assert.match(markup, new RegExp(`data-action="remove-component-variant-from-set" data-set-id="${set.id}" data-component-id="${component.id}"`));
    assert.match(markup, new RegExp(`aria-label="Remove [^"]+ from set"`));
  }
  assert.match(markup, /Remove from set; the master and linked instances stay intact\./);
  assert.doesNotMatch(markup, /data-action="remove-component-variant-from-set"[^>]*disabled/);

  const minimal = makeSet(['Chip / State=Rest', 'Chip / State=Hover']);
  const minimalMarkup = componentSetAssetMarkup(minimal.document, minimal.set, { open: true });
  assert.equal((minimalMarkup.match(/data-action="remove-component-variant-from-set"[^>]*disabled/g) || []).length, 2);
  assert.match(minimalMarkup, /A component set must keep at least two variants\./);
});

test('variant editor controls keep phone-sized targets and visible keyboard focus', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const ruleFor = selector => {
    const start = css.indexOf(selector);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    return start < 0 || open < 0 || close < 0 ? '' : css.slice(start, close + 1);
  };
  for (const selector of ['.component-set-place-selected', '.component-set-remove-axis', '.component-set-place-variant', '.component-set-remove-variant']) {
    assert.match(ruleFor(selector), /min-height:\s*44px/);
  }
  assert.match(ruleFor('.component-set-card button:focus-visible'), /outline:/);
});

test('adding a variant copies a master into a fresh valid tree and maintains axis domains', () => {
  const document = createDocument();
  const maskShape = createNode('rectangle', { name: 'Mask shape', width: 80, height: 40 });
  const maskedContent = createNode('rectangle', { name: 'Masked content', width: 80, height: 40, fill: '#aabbcc' });
  const mask = createNode('group', { name: 'Artwork mask', mask: true, maskSourceId: maskShape.id, children: [maskShape, maskedContent] });
  const defaultRoot = createNode('frame', { name: 'Card / State=Default, Size=Small', children: [mask] });
  const hoverRoot = createNode('frame', { name: 'Card / State=Hover, Size=Small' });
  const largeRoot = createNode('frame', { name: 'Card / State=Default, Size=Large' });
  addNode(document, defaultRoot); addNode(document, hoverRoot); addNode(document, largeRoot);
  const defaults = createComponent(document, defaultRoot.id, defaultRoot.name);
  const hover = createComponent(document, hoverRoot.id, hoverRoot.name);
  const large = createComponent(document, largeRoot.id, largeRoot.name);
  const set = createComponentSet(document, [defaults.id, hover.id, large.id], 'Card');
  const property = createComponentProperty(document, defaults.id, {
    name: 'Show content', type: 'BOOLEAN', targetNodeId: maskedContent.id
  });
  const existingInstance = createComponentInstance(document, defaults.id);
  const originalIds = new Set();
  const collect = node => { originalIds.add(node.id); for (const child of node.children || []) collect(child); };
  for (const page of document.pages) for (const node of page.children) collect(node);

  const added = addComponentVariantFromMaster(document, set.id, defaults.id, { State: 'Disabled' });
  const newRoot = findNode(document, added.rootNodeId).node;
  const newMask = newRoot.children[0];
  const newContent = newMask.children[1];
  const allIds = [];
  for (const page of document.pages) {
    const collectIds = node => { allIds.push(node.id); for (const child of node.children || []) collectIds(child); };
    for (const node of page.children) collectIds(node);
  }

  assert.equal(added.componentSetId, set.id);
  assert.deepEqual(added.variantProperties, { State: 'Disabled', Size: 'Small' });
  assert.equal(set.componentIds.length, 4);
  assert.deepEqual(set.properties.map(axis => axis.values), [['Default', 'Hover', 'Disabled'], ['Small', 'Large']]);
  assert.equal(newRoot.isComponent, true);
  assert.notEqual(newRoot.id, defaultRoot.id);
  assert.equal(originalIds.has(newRoot.id), false);
  assert.equal(originalIds.has(newMask.id), false);
  assert.equal(newMask.maskSourceId, newMask.children[0].id, 'internal mask references must target the copied child');
  assert.equal(added.componentProperties[0].id === property.id, false, 'component property IDs must remain globally unique');
  assert.equal(added.componentProperties[0].targetSourceId, newContent.id, 'component property targets must follow the copied layer IDs');
  assert.equal(findNode(document, existingInstance.id).node.componentId, defaults.id, 'existing linked instances must not be reassigned');
  assert.equal(new Set(allIds).size, allIds.length, 'the copied variant must not reuse any layer IDs');
  assert.equal(validateDocument(document), true);
  assert.equal(validateDocument(JSON.parse(JSON.stringify(document))), true, 'the new set must survive a serialized document round-trip');
});

test('adding a duplicate or malformed variant combination rejects without mutating the document', () => {
  const { document, components, set } = makeSet();
  const before = structuredClone(document);
  assert.throws(() => addComponentVariantFromMaster(document, set.id, components[0].id, { State: 'Hover', Size: 'Small' }), /already exists/);
  assert.deepEqual(document, before, 'a duplicate combination must not leave a copied component or layer behind');
  assert.throws(() => addComponentVariantFromMaster(document, set.id, components[0].id, { Missing: 'Value' }), /does not exist/);
  assert.deepEqual(document, before, 'unknown axes must be rejected before inserting a copy');
  assert.throws(() => addComponentVariantFromMaster(document, set.id, components[0].id, { State: '  ' }), /printable characters/);
  assert.deepEqual(document, before);
});

test('copied linked-component trees remap nested prototype instance references', () => {
  const document = createDocument();
  const defaultLayer = createNode('rectangle', { name: 'Icon / State=Default' });
  const hoverLayer = createNode('rectangle', { name: 'Icon / State=Hover' });
  addNode(document, defaultLayer); addNode(document, hoverLayer);
  const defaultComponent = createComponent(document, defaultLayer.id, defaultLayer.name);
  const hoverComponent = createComponent(document, hoverLayer.id, hoverLayer.name);
  createComponentSet(document, [defaultComponent.id, hoverComponent.id], 'Icon');

  const outerRoot = createNode('frame', { name: 'Outer' });
  addNode(document, outerRoot);
  const nested = createComponentInstance(document, defaultComponent.id, { parentId: outerRoot.id });
  createComponent(document, outerRoot.id, 'Outer');
  const switchAction = addPrototypeInteraction(document, nested.id, null, {
    action: 'change-variant', targetVariantId: hoverComponent.id
  });

  const copiedOuter = createComponentInstance(document, outerRoot.componentId);
  const copiedNested = copiedOuter.children[0];
  assert.notEqual(copiedNested.id, nested.id);
  assert.equal(copiedNested.interactions[0].instanceId, copiedNested.id);
  assert.equal(copiedNested.interactions[0].id, switchAction.id);
  assert.equal(nested.interactions[0].instanceId, nested.id, 'the source interaction remains attached to its original instance');
  assert.equal(validateDocument(document), true);
});

test('variant copies remap populated nested slot values to the renewed layer IDs', () => {
  const document = createDocument();
  const contentRoot = createNode('frame', { name: 'Content' });
  const slot = createNode('group', { name: 'Slot' });
  slot.children.push(createNode('rectangle', { name: 'Default content' }));
  contentRoot.children.push(slot);
  addNode(document, contentRoot);
  const contentComponent = createComponent(document, contentRoot.id, contentRoot.name);
  const slotProperty = createComponentProperty(document, contentComponent.id, {
    name: 'Items', type: 'SLOT', targetNodeId: slot.id
  });

  const defaultRoot = createNode('frame', { name: 'Card / State=Default' });
  addNode(document, defaultRoot);
  const nestedInstance = createComponentInstance(document, contentComponent.id, { parentId: defaultRoot.id });
  const [originalSlotContent] = setComponentSlotContent(document, nestedInstance.id, slotProperty.id, [
    createNode('text', { name: 'Custom content', text: 'Custom slot content' })
  ]);
  const defaultComponent = createComponent(document, defaultRoot.id, defaultRoot.name);
  const hoverRoot = createNode('frame', { name: 'Card / State=Hover' });
  addNode(document, hoverRoot);
  const hoverComponent = createComponent(document, hoverRoot.id, hoverRoot.name);
  const set = createComponentSet(document, [defaultComponent.id, hoverComponent.id], 'Card');

  const added = addComponentVariantFromMaster(document, set.id, defaultComponent.id, { State: 'Disabled' });
  const copiedNested = findNode(document, added.rootNodeId).node.children[0];
  const copiedSlot = copiedNested.children.find(child => child.nestedComponentSourceId === slot.id);

  assert.notEqual(copiedSlot.children[0].id, originalSlotContent.id);
  assert.deepEqual(copiedNested.componentPropertyValues[slotProperty.id], copiedSlot.children.map(child => child.id));
  assert.equal(validateDocument(document), true, 'the copied variant keeps populated nested slots valid after IDs are renewed');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true, 'nested component target mappings survive a local document round-trip');
});

test('variant copies remap internal prototype frame destinations and preserve external routes', () => {
  const document = createDocument();
  const externalPage = { id: 'page-external', name: 'External page', children: [] };
  const clonePage = { id: 'page-clone', name: 'Clone page', children: [] };
  document.pages.push(externalPage, clonePage);
  const defaultRoot = createNode('frame', { name: 'Card / State=Default' });
  const trigger = createNode('rectangle', { name: 'Open details' });
  const internalFrame = createNode('frame', { name: 'Details' });
  defaultRoot.children.push(trigger, internalFrame);
  addNode(document, defaultRoot);
  const externalFrame = createNode('frame', { name: 'Help' });
  addNode(document, externalFrame, { pageId: externalPage.id });
  const defaultComponent = createComponent(document, defaultRoot.id, defaultRoot.name);
  const internalInteraction = addPrototypeInteraction(document, trigger.id, internalFrame.id);
  const externalInteraction = addPrototypeInteraction(document, trigger.id, externalFrame.id);
  const hoverRoot = createNode('frame', { name: 'Card / State=Hover' });
  addNode(document, hoverRoot);
  const hoverComponent = createComponent(document, hoverRoot.id, hoverRoot.name);
  const set = createComponentSet(document, [defaultComponent.id, hoverComponent.id], 'Card');

  const added = addComponentVariantFromMaster(document, set.id, defaultComponent.id, { State: 'Disabled' });
  const copiedRoot = findNode(document, added.rootNodeId).node;
  const copiedTrigger = copiedRoot.children[0];
  const copiedInternalFrame = copiedRoot.children[1];
  const copiedInternalRoute = copiedTrigger.interactions.find(item => item.id === internalInteraction.id);
  const copiedExternalRoute = copiedTrigger.interactions.find(item => item.id === externalInteraction.id);

  assert.equal(copiedInternalRoute.destinationId, copiedInternalFrame.id);
  assert.equal(copiedInternalRoute.destinationPageId, document.activePageId);
  assert.equal(copiedExternalRoute.destinationId, externalFrame.id, 'external destinations remain linked to their original frame');
  assert.equal(copiedExternalRoute.destinationPageId, externalPage.id, 'external destination pages remain unchanged');

  const placedInstance = createComponentInstance(document, defaultComponent.id, { pageId: clonePage.id });
  const placedTrigger = placedInstance.children[0];
  const placedInternalFrame = placedInstance.children[1];
  const placedInternalRoute = placedTrigger.interactions.find(item => item.id === internalInteraction.id);
  const placedExternalRoute = placedTrigger.interactions.find(item => item.id === externalInteraction.id);
  assert.equal(placedInternalRoute.destinationId, placedInternalFrame.id);
  assert.equal(placedInternalRoute.destinationPageId, clonePage.id, 'internal destinations follow the page receiving the copied tree');
  assert.equal(placedExternalRoute.destinationId, externalFrame.id);
  assert.equal(placedExternalRoute.destinationPageId, externalPage.id);
  assert.equal(validateDocument(document), true);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('removing a variant keeps its master and linked instances, prunes axis values, and clears stale prototype actions', () => {
  const { document, components, set } = makeSet();
  const removedComponent = components[2];
  const removedInstance = createComponentInstance(document, removedComponent.id);
  const retainedInstance = createComponentInstance(document, components[0].id);
  addPrototypeInteraction(document, removedInstance.id, null, {
    action: 'change-variant', targetVariantId: components[0].id
  });
  addPrototypeInteraction(document, retainedInstance.id, null, {
    action: 'change-variant', targetVariantId: removedComponent.id
  });
  addPrototypeInteraction(document, retainedInstance.id, null, { action: 'back' });
  const removedInstanceNode = findNode(document, removedInstance.id).node;
  const retainedInstanceNode = findNode(document, retainedInstance.id).node;
  removedInstanceNode.componentOverrides[removedInstanceNode.componentSourceId] = {
    interactions: structuredClone(removedInstanceNode.interactions)
  };
  retainedInstanceNode.componentOverrides[retainedInstanceNode.componentSourceId] = {
    interactions: structuredClone(retainedInstanceNode.interactions)
  };

  const removed = removeComponentVariantFromSet(document, set.id, removedComponent.id);
  assert.equal(removed, removedComponent);
  assert.deepEqual(set.componentIds, [components[0].id, components[1].id]);
  assert.deepEqual(set.properties.map(axis => ({ name: axis.name, values: axis.values })), [
    { name: 'State', values: ['Rest', 'Hover'] },
    { name: 'Size', values: ['Small'] }
  ]);
  assert.equal(findNode(document, removedComponent.rootNodeId).node.isComponent, true, 'the removed variant remains a standalone main component');
  assert.equal(removedComponent.componentSetId, undefined);
  assert.equal(removedComponent.variantProperties, undefined);
  assert.equal(findNode(document, removedInstance.id).node.componentId, removedComponent.id, 'linked instances remain linked to the preserved standalone component');
  assert.equal(findNode(document, removedInstance.id).node.interactions, undefined, 'an instance outside a set cannot retain a change-variant action');
  assert.deepEqual(removedInstanceNode.componentOverrides[removedInstanceNode.componentSourceId].interactions, [],
    'the instance override is pruned to the same empty route list as its layer');
  assert.deepEqual(findNode(document, retainedInstance.id).node.interactions.map(item => item.action), ['back'], 'incoming actions to the removed variant are cleared while unrelated prototype actions survive');
  assert.deepEqual(retainedInstanceNode.componentOverrides[retainedInstanceNode.componentSourceId].interactions.map(item => item.action), ['back'],
    'the retained instance override keeps its unrelated route and drops the removed destination');
  assert.equal(validateDocument(document), true);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true, 'the pruned interaction overrides survive a local document round-trip');
});

test('removing from a two-variant set is rejected without changing the design', () => {
  const { document, components, set } = makeSet(['Chip / State=Rest', 'Chip / State=Hover']);
  const before = structuredClone(document);
  assert.throws(() => removeComponentVariantFromSet(document, set.id, components[0].id), /at least two variants/);
  assert.deepEqual(document, before);
});
