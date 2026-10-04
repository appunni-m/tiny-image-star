import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, canCreateMaskGroup, canGroupLayers, canUngroupLayers, combineBoolean, createComponent, createComponentInstance, createComponentSet, createDocument, createMaskGroup, createNode, detachComponentInstance,
  canSwapComponentTo, createComponentProperty, duplicateNode, findNode, moveNode, removeNode, reorderNode, recordComponentChildOrder, releaseMaskGroup, separateBoolean, serializeDocument, parseDocument, setComponentPropertyValue, setComponentVariantProperty, switchComponentInstanceVariant, ungroupLayers, groupLayers, updateNode,
  resetComponentSlotContent, setComponentNestedInstanceExposure, setComponentNestedInstanceExposures, setComponentSlotContent, syncAllComponentInstances, syncComponentInstances, validateDocument
} from '../src/model.js';
import { addPrototypeInteraction } from '../src/prototype.js';
import { createAutoLayout } from '../src/layout-engine.js';
import { componentPropertyExposureGroups, componentPropertyTargetInstanceId, componentPropertyTargetInstanceIds } from '../src/component-property-exposure.js';

test('component instances link to a main component and can be placed on another page', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Primary button', x: 24, y: 32, width: 160, height: 48 });
  const label = createNode('text', { text: 'Continue', x: 12, y: 8 });
  addNode(document, main); addNode(document, label, { parentId: main.id });
  const component = createComponent(document, main.id);
  const nextPage = { id: 'page-secondary', name: 'Secondary', children: [] };
  document.pages.push(nextPage);
  const instance = createComponentInstance(document, component.id, { pageId: nextPage.id, x: 300, y: 180 });

  assert.equal(instance.isInstance, true);
  assert.equal(instance.componentId, component.id);
  assert.equal(instance.x, 300);
  assert.equal(instance.y, 180);
  assert.equal(instance.children[0].text, 'Continue');
  assert.notEqual(instance.id, main.id);
  assert.notEqual(instance.children[0].id, label.id);
  assert.equal(validateDocument(document), true);
});

test('deleting an inherited instance layer survives component synchronization and reload', () => {
  const document = createDocument();
  const master = createNode('frame', { name: 'Card' });
  const child = createNode('rectangle', { name: 'Badge' });
  addNode(document, master);
  addNode(document, child, { parentId: master.id });
  const component = createComponent(document, master.id, 'Card');
  const instance = createComponentInstance(document, component.id);
  const instanceChildId = instance.children[0].id;

  assert.equal(removeNode(document, instanceChildId)?.id, instanceChildId);
  assert.deepEqual(instance.children, []);
  syncAllComponentInstances(document);
  assert.deepEqual(instance.children, [], 'saving must not regenerate a child the user deleted from this instance');

  const reloaded = parseDocument(serializeDocument(document));
  syncAllComponentInstances(reloaded);
  assert.deepEqual(findNode(reloaded, instance.id).node.children, [], 'the deletion override must survive reload');
  assert.equal(validateDocument(reloaded), true);
});

test('deleting a layer inside a nested component instance survives nested and owner synchronization', () => {
  const document = createDocument();
  const innerMaster = createNode('frame', { name: 'Inner component' });
  const innerChild = createNode('rectangle', { name: 'Nested badge' });
  addNode(document, innerMaster);
  addNode(document, innerChild, { parentId: innerMaster.id });
  const innerComponent = createComponent(document, innerMaster.id, 'Inner component');

  const outerMaster = createNode('frame', { name: 'Outer component' });
  addNode(document, outerMaster);
  createComponentInstance(document, innerComponent.id, { parentId: outerMaster.id });
  const outerComponent = createComponent(document, outerMaster.id, 'Outer component');
  const outerInstance = createComponentInstance(document, outerComponent.id);
  const nestedInstance = outerInstance.children[0];
  const nestedInstanceChild = nestedInstance.children[0];

  assert.equal(removeNode(document, nestedInstanceChild.id)?.id, nestedInstanceChild.id);
  assert.deepEqual(nestedInstance.children, []);
  syncAllComponentInstances(document);
  assert.deepEqual(outerInstance.children[0].children, [], 'the owner component refresh must keep the deletion override');

  const reloaded = parseDocument(serializeDocument(document));
  syncAllComponentInstances(reloaded);
  assert.deepEqual(findNode(reloaded, outerInstance.id).node.children[0].children, [], 'reload and owner refresh must keep the nested child deleted');
  assert.equal(validateDocument(reloaded), true);
});

test('component child alignment overrides survive auto-layout sync and reload', () => {
  const document = createDocument();
  const master = createNode('frame', {
    name: 'Toolbar', autoLayout: createAutoLayout({ axis: 'horizontal' })
  });
  const action = createNode('rectangle', { name: 'Action', layoutAlignSelf: 'center' });
  addNode(document, master);
  addNode(document, action, { parentId: master.id });
  const component = createComponent(document, master.id, 'Toolbar');
  const instance = createComponentInstance(document, component.id);
  const instanceAction = instance.children[0];
  instanceAction.layoutAlignSelf = 'end';
  instance.componentOverrides[instanceAction.componentSourceId] = { layoutAlignSelf: 'end' };

  assert.equal(validateDocument(document), true);
  syncAllComponentInstances(document);
  assert.equal(instance.children[0].layoutAlignSelf, 'end');

  const reloaded = parseDocument(serializeDocument(document));
  syncAllComponentInstances(reloaded);
  const reloadedInstance = findNode(reloaded, instance.id).node;
  assert.equal(reloadedInstance.children[0].layoutAlignSelf, 'end');
  assert.equal(validateDocument(reloaded), true);
  reloadedInstance.componentOverrides[instanceAction.componentSourceId].layoutAlignSelf = 'baseline';
  assert.throws(() => validateDocument(reloaded), /Invalid component auto layout child alignment override/);
});

test('fixed-position scrolling overrides survive component synchronization and reload', () => {
  const document = createDocument();
  const master = createNode('frame', { name: 'Scrollable card', overflowBehavior: 'vertical' });
  const badge = createNode('rectangle', { name: 'Pinned badge' });
  addNode(document, master);
  addNode(document, badge, { parentId: master.id });
  const component = createComponent(document, master.id, 'Scrollable card');
  const instance = createComponentInstance(document, component.id);
  const instanceBadge = instance.children[0];
  instanceBadge.fixedPositionWhenScrolling = true;
  instance.componentOverrides[instanceBadge.componentSourceId] = { fixedPositionWhenScrolling: true };

  assert.equal(validateDocument(document), true);
  syncAllComponentInstances(document);
  assert.equal(instance.children[0].fixedPositionWhenScrolling, true);

  const reloaded = parseDocument(serializeDocument(document));
  syncAllComponentInstances(reloaded);
  const reloadedInstance = findNode(reloaded, instance.id).node;
  assert.equal(reloadedInstance.children[0].fixedPositionWhenScrolling, true);
  assert.equal(validateDocument(reloaded), true);
});

test('component synchronization remaps internal prototype scroll targets to each instance', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Scrollable card', width: 300, height: 220 });
  const viewport = createNode('frame', { name: 'Viewport', width: 260, height: 120, overflowBehavior: 'vertical' });
  const hotspot = createNode('rectangle', { name: 'Scroll trigger', width: 40, height: 24 });
  const target = createNode('rectangle', { name: 'Target', y: 320, width: 60, height: 32 });
  addNode(document, main);
  addNode(document, viewport, { parentId: main.id });
  addNode(document, hotspot, { parentId: viewport.id });
  addNode(document, target, { parentId: viewport.id });
  const component = createComponent(document, main.id, 'Scrollable card');
  const first = createComponentInstance(document, component.id);
  const second = createComponentInstance(document, component.id);

  addPrototypeInteraction(document, hotspot.id, null, {
    action: 'scroll-to', trigger: 'on-click', transition: 'scroll',
    scrollTargetId: target.id, scrollAlignment: 'start'
  });
  assert.equal(syncComponentInstances(document, component.id), 2);

  for (const instance of [first, second]) {
    const instanceViewport = instance.children[0];
    const instanceHotspot = instanceViewport.children[0];
    const instanceTarget = instanceViewport.children[1];
    assert.equal(instanceHotspot.interactions[0].scrollTargetId, instanceTarget.id);
    assert.notEqual(instanceHotspot.interactions[0].scrollTargetId, target.id);
  }
  assert.equal(validateDocument(document), true);
});

test('switching a component variant remaps its internal prototype scroll targets', () => {
  const document = createDocument();
  const createScrollableVariant = name => {
    const main = createNode('frame', { name, width: 300, height: 220 });
    const viewport = createNode('frame', { name: 'Viewport', width: 260, height: 120, overflowBehavior: 'vertical' });
    const hotspot = createNode('rectangle', { name: 'Scroll trigger', width: 40, height: 24 });
    const target = createNode('rectangle', { name: 'Target', y: 320, width: 60, height: 32 });
    addNode(document, main);
    addNode(document, viewport, { parentId: main.id });
    addNode(document, hotspot, { parentId: viewport.id });
    addNode(document, target, { parentId: viewport.id });
    return { component: createComponent(document, main.id, name), hotspot, target };
  };
  const off = createScrollableVariant('Toggle / State=Off');
  const on = createScrollableVariant('Toggle / State=On');
  createComponentSet(document, [off.component.id, on.component.id]);
  const instance = createComponentInstance(document, off.component.id);
  addPrototypeInteraction(document, on.hotspot.id, null, {
    action: 'scroll-to', trigger: 'on-click', transition: 'scroll',
    scrollTargetId: on.target.id, scrollAlignment: 'center'
  });

  assert.equal(switchComponentInstanceVariant(document, instance.id, on.component.id), true);
  const instanceHotspot = instance.children[0].children[0];
  const instanceTarget = instance.children[0].children[1];
  assert.equal(instanceHotspot.interactions[0].scrollTargetId, instanceTarget.id);
  assert.notEqual(instanceHotspot.interactions[0].scrollTargetId, on.target.id);
  assert.equal(validateDocument(document), true);
});

test('component blend-mode overrides validate with the component property schema', () => {
  const document = createDocument();
  const main = createNode('rectangle', { name: 'Blend card' });
  addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  const sourceId = instanceNode.componentSourceId;
  instanceNode.componentOverrides[sourceId] = { blendMode: 'screen' };
  assert.equal(validateDocument(document), true);
  instanceNode.componentOverrides[sourceId].blendMode = 'vivid-light';
  assert.throws(() => validateDocument(document), /Invalid component blend mode override/);
});

test('component text typography overrides validate with the component property schema', () => {
  const document = createDocument();
  const main = createNode('text', { text: 'Label' });
  addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  const sourceId = instanceNode.componentSourceId;
  instanceNode.componentOverrides[sourceId] = { fontFamily: 'Atkinson Hyperlegible, sans-serif', fontWeight: 800, fontStyle: 'italic', align: 'justify' };
  assert.equal(validateDocument(document), true);
  instanceNode.componentOverrides[sourceId].fontStyle = 'oblique';
  assert.throws(() => validateDocument(document), /Invalid component font style override/);
  instanceNode.componentOverrides[sourceId].fontStyle = 'italic';
  instanceNode.componentOverrides[sourceId].align = 'distributed';
  assert.throws(() => validateDocument(document), /Invalid component text alignment override/);
});

test('component text list overrides preserve paragraph structure and validate depth and spacing', () => {
  const document = createDocument();
  const main = createNode('text', { text: 'One\nTwo' });
  addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  const sourceId = instanceNode.componentSourceId;
  const paragraphStyles = [
    { listStyle: 'numbered', listLevel: 0, listStart: 6 },
    { listStyle: 'bulleted', listLevel: 1 }
  ];
  instanceNode.componentOverrides[sourceId] = { paragraphStyles, listSpacing: 4 };
  syncComponentInstances(document, component.id);
  const syncedInstance = findNode(document, instance.id).node;
  assert.deepEqual(syncedInstance.paragraphStyles, paragraphStyles);
  assert.equal(syncedInstance.listSpacing, 4);
  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[1].componentOverrides[sourceId], { paragraphStyles, listSpacing: 4 });

  instanceNode.componentOverrides[sourceId].paragraphStyles[1].listLevel = 5;
  assert.throws(() => validateDocument(document), /Invalid component text paragraph styles override/);
  instanceNode.componentOverrides[sourceId] = { paragraphStyles, listSpacing: 10_001 };
  assert.throws(() => validateDocument(document), /Invalid component list spacing override/);
});

test('component shape geometry overrides persist and validate against the source shape', () => {
  const document = createDocument();
  const master = createNode('star', { name: 'Badge', points: 5, innerRadius: .48 });
  addNode(document, master);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[master.id] = { points: 8, innerRadius: 0 };

  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[1].componentOverrides[master.id], { points: 8, innerRadius: 0 });

  instance.componentOverrides[master.id].points = 60;
  assert.equal(validateDocument(document), true, 'star component overrides retain the full 60-point range');
  instance.componentOverrides[master.id].points = 61;
  assert.throws(() => validateDocument(document), /Invalid component shape point-count override/);
  instance.componentOverrides[master.id] = { points: 8, innerRadius: 1.01 };
  assert.throws(() => validateDocument(document), /Invalid component star inner-radius override/);
});

test('ellipse arc component overrides persist and validate against the source ellipse', () => {
  const document = createDocument();
  const master = createNode('ellipse', { name: 'Pie', arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 } });
  addNode(document, master);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[master.id] = { arcData: { startingAngle: Math.PI / 2, endingAngle: Math.PI * 2, innerRadius: .35 } };

  assert.equal(validateDocument(document), true);
  assert.deepEqual(parseDocument(serializeDocument(document)).pages[0].children[1].componentOverrides[master.id].arcData,
    { startingAngle: Math.PI / 2, endingAngle: Math.PI * 2, innerRadius: .35 });

  instance.componentOverrides[master.id].arcData.innerRadius = 1.1;
  assert.throws(() => validateDocument(document), /Invalid component ellipse arc override/);
});

test('component vector-path point overrides validate and survive document reload', () => {
  const document = createDocument();
  const main = createNode('path', { name: 'Badge outline', points: [
    { x: 0, y: 0, out: { x: .2, y: 0 }, mode: 'smooth' },
    { x: 1, y: 1, in: { x: -.2, y: 0 }, mode: 'symmetric' }
  ] });
  addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const editedPoints = structuredClone(main.points);
  editedPoints[0].out = { x: .35, y: .15 };
  instance.componentOverrides[main.id] = { points: editedPoints };

  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[1].componentOverrides[main.id].points, editedPoints);

  instance.componentOverrides[main.id].points[0].mode = 'invalid';
  assert.throws(() => validateDocument(document), /Invalid component vector path points override/);
  instance.componentOverrides[main.id].points = null;
  assert.throws(() => validateDocument(document), /Invalid component vector path points override/);
});

test('compound vector path component overrides validate closure, contours, and fill rule', () => {
  const document = createDocument();
  const main = createNode('path', {
    name: 'Compound badge', closed: false, fillRule: 'nonzero',
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: .5, y: 1 }]
  });
  addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const subpaths = [{ closed: true, points: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .5, y: .8 }] }];
  instance.componentOverrides[main.id] = { closed: true, fillRule: 'evenodd', subpaths };

  assert.equal(validateDocument(document), true);
  syncComponentInstances(document, component.id);
  const synced = findNode(document, instance.id).node;
  assert.equal(synced.closed, true);
  assert.equal(synced.fillRule, 'evenodd');
  assert.deepEqual(synced.subpaths, subpaths);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[1].componentOverrides[main.id], { closed: true, fillRule: 'evenodd', subpaths });

  for (const malformed of [
    { subpaths: [{ closed: 'yes', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] },
    { subpaths: [{ closed: true, points: [{ x: 0, y: 0 }] }] },
    { closed: 'yes' },
    { fillRule: 'inverse' }
  ]) {
    const invalid = structuredClone(document);
    const invalidInstance = findNode(invalid, instance.id).node;
    invalidInstance.componentOverrides[main.id] = malformed;
    assert.throws(() => validateDocument(invalid), /Invalid component vector path geometry override/);
    assert.throws(() => parseDocument(JSON.stringify(invalid)), /Invalid component vector path geometry override/);
  }
});

test('main component edits synchronize while preserving instance placement and stable layer identities', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card', width: 220, height: 120 });
  const title = createNode('text', { text: 'Old title', x: 12, y: 10 });
  const subtitle = createNode('text', { text: 'Before', x: 12, y: 48 });
  addNode(document, main); addNode(document, title, { parentId: main.id }); addNode(document, subtitle, { parentId: main.id });
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id, { x: 360, y: 240 });
  const instanceId = instance.id;
  const instanceTitleId = instance.children[0].id;

  main.width = 280;
  title.text = 'Updated title';
  subtitle.text = 'After';
  const added = createNode('ellipse', { x: 180, y: 16, fill: '#00aa88' });
  addNode(document, added, { parentId: main.id });
  main.children.reverse();
  assert.equal(syncComponentInstances(document, component.id), 1);

  const synced = findNode(document, instanceId).node;
  assert.equal(synced.width, 280);
  assert.equal(synced.x, 360);
  assert.equal(synced.y, 240);
  const syncedTitle = synced.children.find(child => child.componentSourceId === title.id);
  const syncedSubtitle = synced.children.find(child => child.componentSourceId === subtitle.id);
  const syncedAdded = synced.children.find(child => child.componentSourceId === added.id);
  assert.equal(syncedTitle.id, instanceTitleId);
  assert.equal(syncedTitle.text, 'Updated title');
  assert.equal(syncedSubtitle.text, 'After');
  assert.equal(syncedAdded.fill, '#00aa88');
  assert.notEqual(syncedAdded.id, added.id);
  assert.equal(validateDocument(document), true);
});

test('prototype interactions authored on an instance survive component sync and local reload', () => {
  const document = createDocument();
  const defaultMaster = createNode('rectangle', { name: 'Button/State=Default' });
  const hoverMaster = createNode('rectangle', { name: 'Button/State=Hover' });
  addNode(document, defaultMaster); addNode(document, hoverMaster);
  const defaultComponent = createComponent(document, defaultMaster.id);
  const hoverComponent = createComponent(document, hoverMaster.id);
  createComponentSet(document, [defaultComponent.id, hoverComponent.id]);
  const destinations = ['First', 'Second', 'Third'].map(name => createNode('frame', { name }));
  for (const destination of destinations) {
    addNode(document, destination);
    addPrototypeInteraction(document, defaultMaster.id, destination.id);
  }
  const instance = createComponentInstance(document, defaultComponent.id);
  assert.equal(instance.interactions.length, 3, 'the instance starts with the three interactions inherited from its master');

  addPrototypeInteraction(document, instance.id, null, {
    action: 'change-variant', trigger: 'on-press', targetVariantId: hoverComponent.id
  });
  instance.componentOverrides[defaultMaster.id] ||= {};
  instance.componentOverrides[defaultMaster.id].interactions = structuredClone(instance.interactions);

  assert.equal(syncAllComponentInstances(document), 1);
  assert.equal(findNode(document, instance.id).node.interactions.length, 4,
    'sync must reapply the instance interaction override after copying the master');
  assert.equal(findNode(document, instance.id).node.interactions.at(-1).targetVariantId, hoverComponent.id);

  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(syncAllComponentInstances(reloaded), 1);
  const restored = findNode(reloaded, instance.id).node;
  assert.equal(restored.interactions.length, 4, 'the variant interaction must survive serialization and a subsequent sync');
  assert.equal(restored.componentOverrides[defaultMaster.id].interactions.length, 4);
  assert.equal(validateDocument(reloaded), true);
});

test('local instance overrides survive main edits and synchronization', () => {
  const document = createDocument();
  const main = createNode('frame', { width: 200, height: 80 });
  const label = createNode('text', { text: 'Default label' });
  addNode(document, main); addNode(document, label, { parentId: main.id });
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const instanceLabel = instance.children[0];
  instanceLabel.text = 'Special label';
  instance.componentOverrides[instanceLabel.componentSourceId] = { text: 'Special label' };
  instance.width = 240;
  instance.componentOverrides[instance.componentSourceId] = { width: 240 };
  label.text = 'Master label changed';
  main.width = 260;
  syncComponentInstances(document, component.id);

  const synced = findNode(document, instance.id).node;
  assert.equal(synced.width, 240);
  assert.equal(synced.children[0].text, 'Special label');
  assert.equal(validateDocument(document), true);
});

test('instance size-limit overrides survive main edits and local design reload', () => {
  const document = createDocument();
  const main = createNode('frame', { width: 220, height: 120, autoLayout: { axis: 'horizontal' } });
  const tile = createNode('rectangle', { maxWidth: 220 });
  addNode(document, main); addNode(document, tile, { parentId: main.id });
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  const instanceTile = instance.children[0];
  instanceTile.maxWidth = 180;
  instance.componentOverrides[instanceTile.componentSourceId] = { maxWidth: 180 };

  tile.maxWidth = 260;
  assert.equal(syncComponentInstances(document, component.id), 1);
  const synchronizedTile = findNode(document, instanceTile.id).node;
  assert.equal(synchronizedTile.maxWidth, 180);
  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(findNode(reloaded, instanceTile.id).node.maxWidth, 180);
  assert.equal(validateDocument(reloaded), true);
});

test('local child ordering and geometry overrides are restored after a master edit', () => {
  const document = createDocument();
  const main = createNode('frame');
  const first = createNode('rectangle', { name: 'First', x: 0 });
  const second = createNode('rectangle', { name: 'Second', x: 40 });
  addNode(document, main); addNode(document, first, { parentId: main.id }); addNode(document, second, { parentId: main.id });
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  instance.children.reverse();
  instance.children[0].x = 72;
  assert.equal(recordComponentChildOrder(document, instance.id), true);
  instance.componentOverrides[first.id] = { x: 72 };
  first.width = 150;
  syncComponentInstances(document, component.id);

  const synced = findNode(document, instance.id).node;
  assert.deepEqual(synced.children.map(child => child.componentSourceId), [second.id, first.id]);
  assert.equal(synced.children.find(child => child.componentSourceId === first.id).x, 72);
  assert.equal(synced.children.find(child => child.componentSourceId === first.id).width, 150);
  assert.equal(validateDocument(document), true);
});

test('reordering custom component SLOT contents never writes missing source IDs to component overrides', () => {
  const document = createDocument();
  const main = createNode('frame', { name: '003-ChatGPT Image... image' });
  const slot = createNode('frame', { name: 'Artwork' });
  addNode(document, main);
  addNode(document, slot, { parentId: main.id });
  const component = createComponent(document, main.id);
  const property = createComponentProperty(document, component.id, {
    name: 'Artwork', type: 'SLOT', targetNodeId: slot.id
  });
  const instance = createComponentInstance(document, component.id);
  setComponentSlotContent(document, instance.id, property.id, [
    createNode('image', { name: '003-ChatGPT Image...' }),
    createNode('rectangle', { name: 'Overlay' })
  ]);
  const target = instance.children.find(child => child.componentSourceId === slot.id);
  const [image, overlay] = target.children;

  assert.equal(reorderNode(document, overlay.id, 0), true);
  assert.equal(recordComponentChildOrder(document, target.id), false);
  assert.deepEqual(instance.componentPropertyValues[property.id], [overlay.id, image.id]);
  assert.equal(Object.hasOwn(instance.componentOverrides || {}, slot.id), false);
  assert.equal(validateDocument(document), true);
});

test('detached instances stop following the main component and still validate after reload', () => {
  const document = createDocument();
  const main = createNode('rectangle', { fill: '#112233' }); addNode(document, main);
  const component = createComponent(document, main.id, 'Accent');
  const instance = createComponentInstance(document, component.id);
  assert.equal(detachComponentInstance(document, instance.id), true);
  instance.fill = '#445566';
  main.fill = '#aabbcc';
  assert.equal(syncComponentInstances(document, component.id), 0);
  assert.equal(instance.fill, '#445566');
  const restored = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(restored), true);
  assert.equal(findNode(restored, instance.id).node.isInstance, undefined);
});

test('deleting a main component removes its definition and detaches surviving instances', () => {
  const document = createDocument();
  const main = createNode('rectangle'); addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  removeNode(document, main.id);
  assert.equal(document.components.length, 0);
  assert.equal(instance.isInstance, undefined);
  assert.equal(instance.componentId, undefined);
  assert.equal(validateDocument(document), true);
});

test('document validation rejects dangling component references', () => {
  const document = createDocument();
  const layer = createNode('rectangle', { isInstance: true, componentId: 'missing' }); addNode(document, layer);
  assert.throws(() => validateDocument(document), /Missing component source/);
});

test('document validation rejects identity and prototype-field component overrides', () => {
  const document = createDocument();
  const main = createNode('rectangle'); addNode(document, main);
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[main.id] = { id: 'replace-layer-identity' };
  assert.throws(() => validateDocument(document), /Invalid component override.*unsupported field “id”/);
});

test('long-named image card instances persist frame overflow and image recipe overrides', () => {
  const document = createDocument();
  const master = createNode('frame', { name: 'Image card', width: 320, height: 240 });
  const image = createNode('image', {
    name: '003-ChatGPT Image', fileName: '003-ChatGPT Image.png', assetId: 'image-source',
    width: 280, height: 200, sourceWidth: 1400, sourceHeight: 1000
  });
  addNode(document, master);
  addNode(document, image, { parentId: master.id });
  const component = createComponent(document, master.id, 'Image card');
  const instance = createComponentInstance(document, component.id);
  instance.name = '003-ChatGPT Image 2026-10-03 image instance';
  instance.overflowBehavior = 'vertical';
  instance.componentOverrides[master.id] = { overflowBehavior: 'vertical' };

  const imageInstance = instance.children[0];
  imageInstance.fit = 'tile';
  imageInstance.scalingFactor = 1.25;
  imageInstance.outputFormat = 'webp';
  imageInstance.outputQuality = 84;
  imageInstance.adjustments = { ...imageInstance.adjustments, brightness: 12 };
  imageInstance.transforms = { ...imageInstance.transforms, rotation: 90 };
  instance.componentOverrides[image.id] = {
    fit: 'tile', scalingFactor: 1.25, outputFormat: 'webp', outputQuality: 84,
    adjustments: imageInstance.adjustments, transforms: imageInstance.transforms
  };

  assert.equal(validateDocument(document), true);
  syncAllComponentInstances(document);
  assert.equal(instance.overflowBehavior, 'vertical', 'frame overflow remains an editable component override');
  assert.deepEqual([instance.children[0].fit, instance.children[0].scalingFactor,
    instance.children[0].outputFormat, instance.children[0].outputQuality], ['tile', 1.25, 'webp', 84]);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  assert.equal(findNode(reopened, instance.id).node.overflowBehavior, 'vertical');
  assert.deepEqual([findNode(reopened, imageInstance.id).node.fit, findNode(reopened, imageInstance.id).node.outputFormat], ['tile', 'webp']);
});

test('luminance mask mode can be overridden on a component instance and rejects invalid mode targets', () => {
  const document = createDocument();
  const content = createNode('rectangle', { name: 'Content' });
  const mask = createNode('rectangle', { name: 'Mask' });
  addNode(document, content); addNode(document, mask);
  const group = createMaskGroup(document, [content.id, mask.id]);
  const component = createComponent(document, group.id, 'Masked artwork');
  const instance = createComponentInstance(document, component.id);
  instance.maskMode = 'luminance';
  instance.componentOverrides[group.id] = { maskMode: 'luminance' };

  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(findNode(reopened, instance.id).node.maskMode, 'luminance');
  const invalid = structuredClone(reopened);
  findNode(invalid, instance.id).node.componentOverrides[group.id].maskMode = 'unsupported';
  assert.throws(() => validateDocument(invalid), /Invalid component mask mode override/);
});

test('image recipe and processing metadata survives component override save and reload', () => {
  const document = createDocument();
  const master = createNode('frame', { name: 'Photo card' });
  const image = createNode('image', {
    name: 'Photo', assetId: 'asset-source', sourceWidth: 640, sourceHeight: 480,
    fit: 'cover', width: 160, height: 120
  });
  addNode(document, master);
  addNode(document, image, { parentId: master.id });
  const component = createComponent(document, master.id, 'Photo card');
  const instance = createComponentInstance(document, component.id);
  const expansion = {
    sourceImageAssetId: 'asset-source', sourceWidth: 640, sourceHeight: 480,
    paddingRatio: { top: 0.1, right: 0, bottom: 0, left: 0 },
    originalGeometry: { x: 0, y: 0, width: 160, height: 120 },
    originalInpaintStrokes: []
  };
  const overrides = {
    assetId: 'asset-derived', sourceWidth: 1280, sourceHeight: 960,
    fit: 'tile', scalingFactor: 1.25, outputFormat: 'jpeg', outputQuality: 84,
    inpaintStrokes: [], imageExpansion: expansion,
    backgroundRemoved: true, backgroundRemovalSourceAssetId: 'asset-source', backgroundRemovalAssetId: 'asset-bg',
    resolutionBoosted: true, resolutionBoostSourceAssetId: 'asset-source', resolutionBoostAssetId: 'asset-upscaled'
  };
  Object.assign(instance.children[0], overrides);
  instance.componentOverrides[image.id] = structuredClone(overrides);

  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[1].componentOverrides[image.id], overrides);
  assert.equal(reopened.pages[0].children[1].children[0].scalingFactor, 1.25);
  assert.deepEqual(reopened.pages[0].children[1].children[0].imageExpansion, expansion);

  const malformed = structuredClone(reopened);
  malformed.pages[0].children[1].componentOverrides[image.id].imageExpansion = {};
  assert.throws(() => validateDocument(malformed), /Invalid component image expansion override/);
  malformed.pages[0].children[1].componentOverrides[image.id].imageExpansion = expansion;
  malformed.pages[0].children[1].componentOverrides[image.id] = { assetId: 'asset-other' };
  const rectangle = createNode('rectangle', { name: 'Not an image' });
  addNode(malformed, rectangle);
  malformed.pages[0].children[1].componentOverrides[rectangle.id] = { assetId: 'asset-other' };
  assert.throws(() => validateDocument(malformed), /Invalid component image override/);
});

test('components cannot be declared from an instance subtree', () => {
  const document = createDocument();
  const main = createNode('frame'); const child = createNode('rectangle');
  addNode(document, main); addNode(document, child, { parentId: main.id });
  const component = createComponent(document, main.id);
  const instance = createComponentInstance(document, component.id);
  assert.throws(() => createComponent(document, instance.children[0].id), /Detach an instance/);
});

test('variant sets capture property values and switch instances without losing compatible overrides', () => {
  const document = createDocument();
  const small = createNode('frame', { name: 'Small button', width: 120, height: 40 });
  const smallLabel = createNode('text', { name: 'Label', text: 'Continue' });
  const large = createNode('frame', { name: 'Large button', width: 220, height: 64 });
  const largeLabel = createNode('text', { name: 'Label', text: 'Continue' });
  addNode(document, small); addNode(document, smallLabel, { parentId: small.id });
  addNode(document, large); addNode(document, largeLabel, { parentId: large.id });
  const smallComponent = createComponent(document, small.id, 'Button / Size=Small');
  const largeComponent = createComponent(document, large.id, 'Button / Size=Large');
  const instance = createComponentInstance(document, smallComponent.id, { x: 180, y: 90 });
  instance.children[0].fill = '#12abef';
  instance.componentOverrides[smallLabel.id] = { fill: '#12abef' };

  const set = createComponentSet(document, [smallComponent.id, largeComponent.id], 'Button');
  assert.deepEqual(set.properties, [{ name: 'Size', values: ['Small', 'Large'] }]);
  assert.equal(instance.children[0].componentSourceKey, 'root/0');
  assert.equal(switchComponentInstanceVariant(document, instance.id, largeComponent.id), true);
  assert.equal(instance.componentId, largeComponent.id);
  assert.equal(instance.x, 180);
  assert.equal(instance.y, 90);
  assert.equal(instance.width, 220);
  assert.equal(instance.children[0].text, 'Continue');
  assert.equal(instance.children[0].fill, '#12abef');
  assert.equal(instance.children[0].componentSourceId, largeLabel.id);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('deleted instance children map to their matching layer when switching component variants', () => {
  const document = createDocument();
  const small = createNode('frame', { name: 'Small card' });
  const smallChild = createNode('rectangle', { name: 'Badge' });
  const large = createNode('frame', { name: 'Large card' });
  const largeChild = createNode('rectangle', { name: 'Badge' });
  addNode(document, small); addNode(document, smallChild, { parentId: small.id });
  addNode(document, large); addNode(document, largeChild, { parentId: large.id });
  const smallComponent = createComponent(document, small.id, 'Card / Size=Small');
  const largeComponent = createComponent(document, large.id, 'Card / Size=Large');
  const instance = createComponentInstance(document, smallComponent.id);
  createComponentSet(document, [smallComponent.id, largeComponent.id], 'Card');

  removeNode(document, instance.children[0].id);
  assert.equal(switchComponentInstanceVariant(document, instance.id, largeComponent.id), true);
  assert.deepEqual(instance.children, [], 'the deleted Badge stays deleted when the corresponding variant is selected');
  assert.equal(validateDocument(document), true);
});

test('variant value changes reject duplicate combinations and deleting a variant dissolves a degenerate set', () => {
  const document = createDocument();
  const first = createNode('rectangle'); const second = createNode('rectangle');
  addNode(document, first); addNode(document, second);
  const a = createComponent(document, first.id, 'Chip / Tone=Blue');
  const b = createComponent(document, second.id, 'Chip / Tone=Green');
  const set = createComponentSet(document, [a.id, b.id], 'Chip');
  assert.throws(() => setComponentVariantProperty(document, b.id, 'Tone', 'Blue'), /combination already exists/);
  setComponentVariantProperty(document, b.id, 'Tone', 'Mint');
  assert.deepEqual(set.properties[0].values, ['Blue', 'Mint']);
  removeNode(document, second.id);
  assert.deepEqual(document.componentSets, []);
  assert.equal(a.componentSetId, undefined);
  assert.equal(a.variantProperties, undefined);
  assert.equal(validateDocument(document), true);
});

test('variant value changes enforce the shared printable 80-character policy atomically', () => {
  const document = createDocument();
  const first = createNode('rectangle'); const second = createNode('rectangle');
  addNode(document, first); addNode(document, second);
  const a = createComponent(document, first.id, 'Chip / Tone=Blue');
  const b = createComponent(document, second.id, 'Chip / Tone=Green');
  const set = createComponentSet(document, [a.id, b.id], 'Chip');

  const maximumLengthValue = 'x'.repeat(80);
  assert.equal(setComponentVariantProperty(document, b.id, 'Tone', ` ${maximumLengthValue} `).Tone, maximumLengthValue);
  assert.deepEqual(set.properties[0].values, ['Blue', maximumLengthValue]);
  assert.equal(validateDocument(document), true, 'the maximum supported printable value remains a valid design');

  for (const invalidValue of [
    'x'.repeat(81),
    'two\nlines',
    'nul\u0000character',
    'delete\u007fcharacter'
  ]) {
    const before = structuredClone(document);
    assert.throws(
      () => setComponentVariantProperty(document, b.id, 'Tone', invalidValue),
      /Variant value for “Tone” must contain 1–80 printable characters/
    );
    assert.deepEqual(document, before, 'invalid input must not mutate variant values or the set value domain');
  }
});

test('typed component properties project defaults and instance values through sync and reload', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card' });
  const label = createNode('text', { text: 'Default label' });
  const badge = createNode('ellipse', { name: 'Badge', visible: true });
  const icon = createNode('rectangle', { name: 'Icon', fill: '#112233' });
  addNode(document, main); addNode(document, label, { parentId: main.id });
  addNode(document, badge, { parentId: main.id }); addNode(document, icon, { parentId: main.id });
  const component = createComponent(document, main.id, 'Card');
  const visibleProperty = createComponentProperty(document, component.id, { name: 'Show badge', type: 'BOOLEAN', targetNodeId: badge.id });
  const textProperty = createComponentProperty(document, component.id, { name: 'Label', type: 'TEXT', targetNodeId: label.id });
  const instance = createComponentInstance(document, component.id);
  assert.equal(instance.children.find(node => node.componentSourceId === badge.id).visible, true);
  assert.equal(instance.children.find(node => node.componentSourceId === label.id).text, 'Default label');

  instance.componentOverrides[icon.id] = { fill: '#445566' };
  assert.equal(setComponentPropertyValue(document, instance.id, visibleProperty.id, false), true);
  assert.equal(setComponentPropertyValue(document, instance.id, textProperty.id, 'Special label'), true);
  assert.equal(instance.componentPropertyValues[visibleProperty.id], false);
  assert.equal(instance.componentPropertyValues[textProperty.id], 'Special label');
  assert.equal(instance.children.find(node => node.componentSourceId === badge.id).visible, false);
  assert.equal(instance.children.find(node => node.componentSourceId === label.id).text, 'Special label');

  label.text = 'Updated default';
  badge.visible = false;
  icon.fill = '#abcdef';
  assert.equal(syncComponentInstances(document, component.id), 1);
  const synced = findNode(document, instance.id).node;
  assert.equal(synced.children.find(node => node.componentSourceId === badge.id).visible, false);
  assert.equal(synced.children.find(node => node.componentSourceId === label.id).text, 'Special label');
  assert.equal(synced.children.find(node => node.componentSourceId === icon.id).fill, '#445566');

  assert.equal(setComponentPropertyValue(document, instance.id, visibleProperty.id, undefined), true);
  assert.equal(setComponentPropertyValue(document, instance.id, textProperty.id, undefined), true);
  assert.equal(synced.children.find(node => node.componentSourceId === badge.id).visible, true);
  assert.equal(synced.children.find(node => node.componentSourceId === label.id).text, 'Default label');
  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reloaded), true);
  assert.deepEqual(reloaded.components[0].componentProperties, [visibleProperty, textProperty]);
});

test('multi-target component properties update every linked layer and contract safely when a target is removed', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Shared labels' });
  const first = createNode('text', { name: 'Primary label', text: 'Default' });
  const second = createNode('text', { name: 'Secondary label', text: 'Default' });
  addNode(document, main);
  addNode(document, first, { parentId: main.id });
  addNode(document, second, { parentId: main.id });
  const component = createComponent(document, main.id, 'Shared labels');
  const property = createComponentProperty(document, component.id, { name: 'Label', type: 'TEXT', targetNodeId: first.id });
  property.targetSourceIds = [first.id, second.id];
  const instance = createComponentInstance(document, component.id);
  assert.deepEqual(instance.children.filter(node => node.type === 'text').map(node => node.text), ['Default', 'Default']);

  setComponentPropertyValue(document, instance.id, property.id, 'One value');
  assert.deepEqual(instance.children.filter(node => node.type === 'text').map(node => node.text), ['One value', 'One value']);
  assert.equal(validateDocument(document), true);

  removeNode(document, second.id);
  assert.equal(property.targetSourceId, first.id);
  assert.equal(property.targetSourceIds, undefined, 'a one-target property returns to the legacy representation');
  syncAllComponentInstances(document);
  const remainingInstance = findNode(document, instance.id).node;
  assert.deepEqual(remainingInstance.children.filter(node => node.type === 'text').map(node => node.text), ['One value']);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('nested component instances expose all properties on an owner and remain source-scoped', () => {
  const document = createDocument();
  const innerMain = createNode('frame', { name: 'Label and icon' });
  const innerText = createNode('text', { name: 'Label', text: 'Default label' });
  const innerBadge = createNode('ellipse', { name: 'Badge', visible: true });
  addNode(document, innerMain);
  addNode(document, innerText, { parentId: innerMain.id });
  addNode(document, innerBadge, { parentId: innerMain.id });
  const innerComponent = createComponent(document, innerMain.id, 'Label and icon');
  const textProperty = createComponentProperty(document, innerComponent.id, {
    name: 'Label', type: 'TEXT', targetNodeId: innerText.id
  });
  const badgeProperty = createComponentProperty(document, innerComponent.id, {
    name: 'Show badge', type: 'BOOLEAN', targetNodeId: innerBadge.id
  });

  const outerMain = createNode('frame', { name: 'Navigation item' });
  addNode(document, outerMain);
  const firstNested = createComponentInstance(document, innerComponent.id, { parentId: outerMain.id });
  firstNested.name = 'Primary label';
  const secondNested = createComponentInstance(document, innerComponent.id, { parentId: outerMain.id });
  secondNested.name = 'Secondary label';
  const outerComponent = createComponent(document, outerMain.id, 'Navigation item');
  assert.equal(setComponentNestedInstanceExposure(document, outerComponent.id, firstNested.id), true);
  assert.equal(setComponentNestedInstanceExposure(document, outerComponent.id, firstNested.id), false,
    'a repeated request for the same nested instance should be idempotent');
  assert.deepEqual(outerComponent.exposedNestedInstances, [firstNested.id]);
  assert.equal(validateDocument(document), true);

  const outerInstance = createComponentInstance(document, outerComponent.id);
  const nestedA = outerInstance.children.find(node => node.componentSourceId === firstNested.id);
  const nestedB = outerInstance.children.find(node => node.componentSourceId === secondNested.id);
  assert.equal(componentPropertyTargetInstanceId(outerInstance, firstNested.id), nestedA.id,
    'a parent property can highlight the selected nested instance itself');
  assert.deepEqual(componentPropertyTargetInstanceIds(outerInstance, [firstNested.id, secondNested.id]), [nestedA.id, nestedB.id],
    'a multi-target component property maps every source layer to its corresponding visible layer');
  assert.equal(componentPropertyTargetInstanceId(nestedA, innerText.id), nestedA.children[0].id,
    'an exposed nested property maps to its source layer inside that instance');
  assert.equal(componentPropertyTargetInstanceId(nestedB, innerText.id), nestedB.children[0].id,
    'the same source property maps to the corresponding layer in each separate instance');
  assert.equal(componentPropertyTargetInstanceId(outerInstance, innerText.id), null,
    'a parent property lookup does not cross a nested component boundary');
  assert.equal(nestedA.isInstance, true);
  assert.equal(nestedB.isInstance, true);
  assert.deepEqual(componentPropertyExposureGroups(document, outerComponent, outerInstance).map(group => ({
    instanceId: group.instance.id,
    properties: group.properties.map(property => property.id)
  })), [{ instanceId: nestedA.id, properties: [textProperty.id, badgeProperty.id] }],
  'exposing one nested instance reveals all of its properties and leaves its sibling out');
  assert.equal(setComponentPropertyValue(document, nestedA.id, textProperty.id, 'Primary override'), true,
    'the exposed nested instance retains its own property editing behavior');
  assert.equal(nestedA.children.find(node => node.nestedComponentSourceId === innerText.id).text, 'Primary override');
  assert.equal(nestedB.children.find(node => node.nestedComponentSourceId === innerText.id).text, 'Default label',
    'exposing one nested instance must not expose or edit its sibling');
  assert.equal(setComponentPropertyValue(document, nestedA.id, badgeProperty.id, false), true,
    'all properties on the exposed nested instance remain independently editable');

  innerText.text = 'Updated master label';
  textProperty.defaultValue = innerText.text;
  innerBadge.visible = false;
  badgeProperty.defaultValue = false;
  syncAllComponentInstances(document);
  assert.equal(nestedA.children.find(node => node.nestedComponentSourceId === innerText.id).text, 'Primary override',
    'nested property overrides survive owner and nested component synchronization');
  assert.equal(nestedB.children.find(node => node.nestedComponentSourceId === innerText.id).text, 'Updated master label');
  assert.equal(nestedA.children.find(node => node.nestedComponentSourceId === innerBadge.id).visible, false);

  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reloaded), true);
  syncAllComponentInstances(reloaded);
  const restoredOuter = findNode(reloaded, outerInstance.id).node;
  const restoredNestedA = restoredOuter.children.find(node => node.componentSourceId === firstNested.id);
  assert.equal(restoredNestedA.children.find(node => node.nestedComponentSourceId === innerText.id).text, 'Primary override');
  assert.deepEqual(reloaded.components.find(component => component.id === outerComponent.id).exposedNestedInstances,
    outerComponent.exposedNestedInstances,
    'owner definitions preserve nested instance exposure through serialize and parse');

  assert.equal(setComponentNestedInstanceExposure(reloaded, outerComponent.id, firstNested.id, false), true);
  assert.deepEqual(restoredNestedA.componentPropertyValues[textProperty.id], 'Primary override',
    'hiding the nested controls does not erase the actual nested instance override');
  assert.equal(validateDocument(reloaded), true);

  const danglingTarget = parseDocument(serializeDocument(document));
  danglingTarget.components.find(component => component.id === outerComponent.id).exposedNestedInstances[0] = 'missing-nested-layer';
  assert.throws(() => validateDocument(danglingTarget), /Invalid exposed nested instance/);

  const legacy = structuredClone(document);
  const legacyOwner = legacy.components.find(component => component.id === outerComponent.id);
  delete legacyOwner.exposedNestedInstances;
  legacyOwner.exposedNestedComponentProperties = [
    { nestedInstanceSourceId: firstNested.id, nestedComponentId: innerComponent.id, propertyId: textProperty.id },
    { nestedInstanceSourceId: firstNested.id, nestedComponentId: innerComponent.id, propertyId: badgeProperty.id }
  ];
  const migrated = parseDocument(JSON.stringify(legacy));
  const migratedOwner = migrated.components.find(component => component.id === outerComponent.id);
  assert.deepEqual(migratedOwner.exposedNestedInstances, [firstNested.id]);
  assert.equal(migratedOwner.exposedNestedComponentProperties, undefined,
    'older per-property records migrate to one instance-level exposure');

  const removedNestedInstance = parseDocument(serializeDocument(document));
  removeNode(removedNestedInstance, firstNested.id);
  const cleanedOwner = removedNestedInstance.components.find(component => component.id === outerComponent.id);
  assert.equal(cleanedOwner.exposedNestedInstances, undefined,
    'removing a nested component source also removes its exposure');
  assert.equal(validateDocument(removedNestedInstance), true);

  const removedPropertyTarget = parseDocument(serializeDocument(document));
  removeNode(removedPropertyTarget, innerText.id);
  const cleanedExposureList = removedPropertyTarget.components.find(component => component.id === outerComponent.id).exposedNestedInstances;
  assert.deepEqual(cleanedExposureList, [firstNested.id],
    'the exposed instance remains selected when one of its properties is deleted');
  assert.deepEqual(removedPropertyTarget.components.find(component => component.id === innerComponent.id).componentProperties,
    [badgeProperty], 'the remaining properties on the nested instance remain available');
  assert.equal(validateDocument(removedPropertyTarget), true);
});

test('nested instance exposure follows swap choices and automatically reveals new component properties', () => {
  const document = createDocument();
  const makeTextComponent = (name, text) => {
    const root = createNode('frame', { name });
    const label = createNode('text', { name: `${name} label`, text });
    addNode(document, root);
    addNode(document, label, { parentId: root.id });
    const component = createComponent(document, root.id, name);
    const property = createComponentProperty(document, component.id, {
      name: `${name} text`, type: 'TEXT', targetNodeId: label.id
    });
    return { root, label, component, property };
  };
  const base = makeTextComponent('Base label', 'Base');
  const swapOption = makeTextComponent('Badge label', 'Badge');
  const unrelated = makeTextComponent('Unrelated label', 'Other');
  const outerRoot = createNode('frame', { name: 'Card' });
  addNode(document, outerRoot);
  const nestedSource = createComponentInstance(document, base.component.id, { parentId: outerRoot.id });
  const owner = createComponent(document, outerRoot.id, 'Card');
  const swapProperty = createComponentProperty(document, owner.id, {
    name: 'Label style', type: 'INSTANCE_SWAP', targetNodeId: nestedSource.id,
    preferredComponentIds: [swapOption.component.id]
  });

  assert.throws(() => setComponentNestedInstanceExposure(
    document, owner.id, nestedSource.id, 0
  ), /must be enabled or disabled/,
  'a non-boolean exposure value is rejected');
  assert.throws(() => setComponentNestedInstanceExposure(
    document, owner.id, unrelated.root.id
  ), /nested component instance/,
  'an unrelated component cannot be exposed through this owner');
  assert.equal(setComponentNestedInstanceExposure(document, owner.id, nestedSource.id), true);
  assert.equal(validateDocument(document), true);

  const ownerInstance = createComponentInstance(document, owner.id);
  const nestedInstance = ownerInstance.children.find(node => node.componentSourceId === nestedSource.id);
  assert.deepEqual(componentPropertyExposureGroups(document, owner, ownerInstance).map(group => ({
    componentId: group.component.id,
    propertyIds: group.properties.map(property => property.id)
  })), [{ componentId: base.component.id, propertyIds: [base.property.id] }]);
  assert.equal(setComponentPropertyValue(document, ownerInstance.id, swapProperty.id, swapOption.component.id), true);
  assert.equal(nestedInstance.componentId, swapOption.component.id);
  assert.deepEqual(componentPropertyExposureGroups(document, owner, ownerInstance).map(group => ({
    componentId: group.component.id,
    propertyIds: group.properties.map(property => property.id)
  })), [{ componentId: swapOption.component.id, propertyIds: [swapOption.property.id] }],
  'the exposed controls follow the active nested instance swap');
  assert.equal(setComponentPropertyValue(document, nestedInstance.id, swapOption.property.id, 'Styled override'), true);
  assert.equal(nestedInstance.children.find(node => node.componentSourceId === swapOption.label.id).text, 'Styled override');

  const laterBadge = createNode('ellipse', { name: 'Badge', visible: true });
  addNode(document, laterBadge, { parentId: swapOption.root.id });
  const laterProperty = createComponentProperty(document, swapOption.component.id, {
    name: 'Show badge', type: 'BOOLEAN', targetNodeId: laterBadge.id
  });
  syncAllComponentInstances(document);
  assert.equal(setComponentPropertyValue(document, nestedInstance.id, laterProperty.id, false), true,
    'an exposed nested instance automatically reveals properties added later');
  assert.deepEqual(componentPropertyExposureGroups(document, owner, ownerInstance)[0].properties.map(property => property.id),
    [swapOption.property.id, laterProperty.id]);
  nestedInstance.visible = false;
  assert.deepEqual(componentPropertyExposureGroups(document, owner, ownerInstance), [],
    'a hidden nested instance hides its exposed component controls');
  assert.equal(validateDocument(document), true);
});

test('nested exposure surfaces variant-only controls and follows nested variant swaps', () => {
  const document = createDocument();
  const makeVariant = (name, axis, value) => {
    const root = createNode('frame', { name: `${name}/${axis}=${value}` });
    addNode(document, root);
    return { root, component: createComponent(document, root.id, root.name) };
  };
  const small = makeVariant('Badge', 'Size', 'Small');
  const large = makeVariant('Badge', 'Size', 'Large');
  const badgeSet = createComponentSet(document, [small.component.id, large.component.id], 'Badge');
  const ownerRoot = createNode('frame', { name: 'Card' });
  addNode(document, ownerRoot);
  const nestedSource = createComponentInstance(document, small.component.id, { parentId: ownerRoot.id });
  const owner = createComponent(document, ownerRoot.id, 'Card');
  setComponentNestedInstanceExposure(document, owner.id, nestedSource.id);
  const instance = createComponentInstance(document, owner.id);
  const nested = instance.children.find(node => node.componentSourceId === nestedSource.id);

  const readGroup = () => componentPropertyExposureGroups(document, owner, instance)[0];
  assert.deepEqual(readGroup().properties, [], 'this nested component has no non-variant properties');
  assert.deepEqual(readGroup().variantProperties, badgeSet.properties,
    'variant axes are exposed even when the nested component has no regular property definitions');
  assert.equal(switchComponentInstanceVariant(document, nested.id, large.component.id), true);
  assert.equal(readGroup().component.id, large.component.id,
    'the exposed control group follows the nested instance when its current component changes');
  assert.equal(readGroup().variantProperties[0].name, 'Size');
  assert.equal(readGroup().component.variantProperties.Size, 'Large');

  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reloaded), true);
  const restoredOwner = reloaded.components.find(item => item.id === owner.id);
  const restoredInstance = findNode(reloaded, instance.id).node;
  const restoredGroup = componentPropertyExposureGroups(reloaded, restoredOwner, restoredInstance)[0];
  assert.equal(restoredGroup.component.id, large.component.id);
  assert.equal(restoredGroup.variantProperties[0].name, 'Size',
    'variant-only exposure survives serialization and reload');
});

test('nested variant exposure maps by stable source key across owner component variants', () => {
  const document = createDocument();
  const childA = createNode('frame', { name: 'Badge/Size=Small' });
  const childB = createNode('frame', { name: 'Badge/Size=Large' });
  addNode(document, childA); addNode(document, childB);
  const childComponentA = createComponent(document, childA.id, childA.name);
  const childComponentB = createComponent(document, childB.id, childB.name);
  createComponentSet(document, [childComponentA.id, childComponentB.id], 'Badge');

  const makeOwner = value => {
    const root = createNode('frame', { name: `Card/State=${value}` });
    addNode(document, root);
    const nested = createComponentInstance(document, childComponentA.id, { parentId: root.id });
    return { root, nested, component: createComponent(document, root.id, root.name) };
  };
  const first = makeOwner('Default');
  const second = makeOwner('Active');
  const ownerSet = createComponentSet(document, [first.component.id, second.component.id], 'Card');
  assert.equal(setComponentNestedInstanceExposure(document, first.component.id, first.nested.id), true);
  assert.deepEqual(second.component.exposedNestedInstances, [second.nested.id],
    'an exposure is mapped onto equivalent source layers in other owner variants');

  const ownerInstance = createComponentInstance(document, first.component.id);
  const firstGroup = componentPropertyExposureGroups(document, first.component, ownerInstance)[0];
  assert.equal(firstGroup.instance.componentSourceId, first.nested.id);
  assert.equal(firstGroup.variantProperties[0].name, 'Size');
  switchComponentInstanceVariant(document, ownerInstance.id, second.component.id);
  const activeComponent = document.components.find(item => item.id === ownerSet.componentIds[1]);
  const activeGroup = componentPropertyExposureGroups(document, activeComponent, ownerInstance)[0];
  assert.equal(activeGroup.instance.componentSourceId, second.nested.id,
    'the active controls bind to the matching nested instance in the selected owner variant');
  assert.equal(activeGroup.variantProperties[0].name, 'Size');
  assert.equal(validateDocument(document), true);
});

test('variant-only nested controls follow allowed instance-swap components and count toward the 100-property cap', () => {
  const document = createDocument();
  const makeVariantSet = (name, axis, values) => {
    const variants = values.map(value => {
      const root = createNode('frame', { name: `${name}/${axis}=${value}` });
      addNode(document, root);
      const component = createComponent(document, root.id, root.name);
      return { root, component };
    });
    createComponentSet(document, variants.map(item => item.component.id), name);
    return variants;
  };
  const sizeVariants = makeVariantSet('Badge', 'Size', ['Small', 'Large']);
  const toneVariants = makeVariantSet('Icon', 'Tone', ['Light', 'Dark']);
  const ownerRoot = createNode('frame', { name: 'Owner' });
  addNode(document, ownerRoot);
  const nested = createComponentInstance(document, sizeVariants[0].component.id, { parentId: ownerRoot.id });
  const owner = createComponent(document, ownerRoot.id, 'Owner');
  const swap = createComponentProperty(document, owner.id, {
    name: 'Nested component', type: 'INSTANCE_SWAP', targetNodeId: nested.id,
    preferredComponentIds: [toneVariants[0].component.id]
  });
  setComponentNestedInstanceExposure(document, owner.id, nested.id);
  const instance = createComponentInstance(document, owner.id);
  const nestedInstance = instance.children.find(node => node.componentSourceId === nested.id);
  assert.equal(componentPropertyExposureGroups(document, owner, instance)[0].variantProperties[0].name, 'Size');
  setComponentPropertyValue(document, instance.id, swap.id, toneVariants[0].component.id);
  const swappedGroup = componentPropertyExposureGroups(document, owner, instance)[0];
  assert.equal(swappedGroup.component.id, toneVariants[0].component.id);
  assert.equal(swappedGroup.variantProperties[0].name, 'Tone',
    'variant controls refresh for the nested component selected by its parent swap property');
  switchComponentInstanceVariant(document, nestedInstance.id, toneVariants[1].component.id);
  assert.equal(componentPropertyExposureGroups(document, owner, instance)[0].component.id, toneVariants[1].component.id);
  assert.equal(validateDocument(document), true);

  const limited = createDocument();
  const limitedVariants = [];
  for (const value of ['Small', 'Large']) {
    const root = createNode('frame', { name: `Nested/Size=${value}` });
    addNode(limited, root);
    limitedVariants.push(createComponent(limited, root.id, root.name));
  }
  createComponentSet(limited, limitedVariants.map(component => component.id), 'Nested');
  const limitRoot = createNode('frame', { name: 'Limit owner' });
  addNode(limited, limitRoot);
  const limitNested = createComponentInstance(limited, limitedVariants[0].id, { parentId: limitRoot.id });
  const targets = [];
  for (let index = 0; index < 100; index += 1) {
    const target = createNode('ellipse', { name: `Property ${index}`, visible: true });
    addNode(limited, target, { parentId: limitRoot.id });
    targets.push(target);
  }
  const limitOwner = createComponent(limited, limitRoot.id, 'Limit owner');
  targets.forEach((target, index) => createComponentProperty(limited, limitOwner.id, {
    name: `Property ${index}`, type: 'BOOLEAN', targetNodeId: target.id
  }));
  assert.throws(() => setComponentNestedInstanceExposure(limited, limitOwner.id, limitNested.id), /at most 100 properties/,
    'nested variant axes consume property slots even without regular properties on the nested component');
  assert.equal(limitOwner.exposedNestedInstances, undefined,
    'rejecting an over-limit variant exposure leaves the owner unchanged');
});

test('nested instance exposure counts the largest swap candidate against the property limit', () => {
  const document = createDocument();
  const nestedRoot = createNode('frame', { name: 'Nested controls' });
  addNode(document, nestedRoot);
  const nestedTargets = [];
  for (let index = 0; index < 2; index += 1) {
    const target = createNode('ellipse', { name: `Nested flag ${index}`, visible: true });
    addNode(document, target, { parentId: nestedRoot.id });
    nestedTargets.push(target);
  }
  const nestedComponent = createComponent(document, nestedRoot.id, 'Nested controls');
  nestedTargets.forEach((target, index) => createComponentProperty(document, nestedComponent.id, {
    name: `Nested flag ${index}`, type: 'BOOLEAN', targetNodeId: target.id
  }));
  const swapRoot = createNode('frame', { name: 'Nested controls with more options' });
  addNode(document, swapRoot);
  const swapTargets = [];
  for (let index = 0; index < 3; index += 1) {
    const target = createNode('ellipse', { name: `Swap flag ${index}`, visible: true });
    addNode(document, target, { parentId: swapRoot.id });
    swapTargets.push(target);
  }
  const swapComponent = createComponent(document, swapRoot.id, 'Nested controls with more options');
  swapTargets.forEach((target, index) => createComponentProperty(document, swapComponent.id, {
    name: `Swap flag ${index}`, type: 'BOOLEAN', targetNodeId: target.id
  }));

  const ownerRoot = createNode('frame', { name: 'Owner controls' });
  addNode(document, ownerRoot);
  const nestedSource = createComponentInstance(document, nestedComponent.id, { parentId: ownerRoot.id });
  const ownerTargets = [];
  for (let index = 0; index < 97; index += 1) {
    const target = createNode('ellipse', { name: `Owner flag ${index}`, visible: true });
    addNode(document, target, { parentId: ownerRoot.id });
    ownerTargets.push(target);
  }
  const owner = createComponent(document, ownerRoot.id, 'Owner controls');
  const swapProperty = createComponentProperty(document, owner.id, {
    name: 'Nested choice', type: 'INSTANCE_SWAP', targetNodeId: nestedSource.id,
    preferredComponentIds: [swapComponent.id]
  });
  for (let index = 0; index < ownerTargets.length; index += 1) {
    createComponentProperty(document, owner.id, {
      name: `Owner flag ${index}`, type: 'BOOLEAN', targetNodeId: ownerTargets[index].id
    });
  }
  assert.throws(() => setComponentNestedInstanceExposure(document, owner.id, nestedSource.id), /at most 100 properties/,
    'revealing the three-property swap candidate beside 98 owner properties would exceed the limit');
  assert.equal(owner.exposedNestedInstances, undefined, 'a rejected exposure must not partially mutate the component');

  removeNode(document, ownerTargets[0].id);
  assert.equal(setComponentNestedInstanceExposure(document, owner.id, nestedSource.id), true,
    'the exposure fits when one owner property is removed');
  assert.equal(owner.componentProperties.length + 3, 100);
  assert.equal(validateDocument(document), true);

  const duplicate = parseDocument(serializeDocument(document));
  const duplicateOwner = duplicate.components.find(component => component.id === owner.id);
  duplicateOwner.componentProperties = duplicateOwner.componentProperties.slice(0, 1);
  duplicateOwner.exposedNestedInstances.push(nestedSource.id);
  assert.throws(() => validateDocument(duplicate), /Invalid exposed nested instance/,
    'an instance cannot be exposed twice');
});

test('nested property exposure dialog applies selections atomically', () => {
  const document = createDocument();
  const innerRoot = createNode('frame', { name: 'Inner' });
  addNode(document, innerRoot);
  const innerText = createNode('text', { name: 'Label', text: 'Default' });
  addNode(document, innerText, { parentId: innerRoot.id });
  const inner = createComponent(document, innerRoot.id, 'Inner');
  createComponentProperty(document, inner.id, { name: 'Label', type: 'TEXT', targetNodeId: innerText.id });

  const outerRoot = createNode('frame', { name: 'Outer' });
  addNode(document, outerRoot);
  const nestedA = createComponentInstance(document, inner.id, { parentId: outerRoot.id });
  const nestedB = createComponentInstance(document, inner.id, { parentId: outerRoot.id });
  const owner = createComponent(document, outerRoot.id, 'Outer');

  assert.equal(setComponentNestedInstanceExposures(document, owner.id, [nestedA.id, nestedB.id]), true);
  assert.deepEqual(owner.exposedNestedInstances, [nestedA.id, nestedB.id]);
  assert.equal(setComponentNestedInstanceExposures(document, owner.id, [nestedA.id, nestedB.id]), false,
    'reapplying the same selection creates no document change');
  assert.throws(() => setComponentNestedInstanceExposures(document, owner.id, [nestedB.id, 'missing-instance']), /nested component instance/);
  assert.deepEqual(owner.exposedNestedInstances, [nestedA.id, nestedB.id],
    'an invalid item rejects the entire staged selection without partial changes');
  assert.equal(setComponentNestedInstanceExposures(document, owner.id, []), true);
  assert.equal(owner.exposedNestedInstances, undefined);
  assert.equal(validateDocument(document), true);
});

test('batch nested exposure checks the combined property cap before mutation', () => {
  const document = createDocument();
  const nestedComponents = [];
  for (let componentIndex = 0; componentIndex < 2; componentIndex += 1) {
    const root = createNode('frame', { name: `Nested ${componentIndex}` });
    addNode(document, root);
    const component = createComponent(document, root.id, root.name);
    for (let propertyIndex = 0; propertyIndex < 51; propertyIndex += 1) {
      const target = createNode('rectangle', { name: `Nested ${componentIndex} flag ${propertyIndex}`, visible: true });
      addNode(document, target, { parentId: root.id });
      createComponentProperty(document, component.id, {
        name: `Flag ${propertyIndex}`, type: 'BOOLEAN', targetNodeId: target.id
      });
    }
    nestedComponents.push(component);
  }
  const ownerRoot = createNode('frame', { name: 'Owner' });
  addNode(document, ownerRoot);
  const nestedSources = nestedComponents.map(component => createComponentInstance(document, component.id, { parentId: ownerRoot.id }));
  const owner = createComponent(document, ownerRoot.id, 'Owner');

  assert.throws(() => setComponentNestedInstanceExposures(document, owner.id, nestedSources.map(instance => instance.id)), /at most 100 properties/);
  assert.equal(owner.exposedNestedInstances, undefined, 'over-limit batch selection leaves the component unchanged');
  assert.equal(setComponentNestedInstanceExposure(document, owner.id, nestedSources[0].id), true,
    'one 51-property nested instance fits by itself');
  assert.throws(() => setComponentNestedInstanceExposures(document, owner.id, nestedSources.map(instance => instance.id)), /at most 100 properties/);
  assert.deepEqual(owner.exposedNestedInstances, [nestedSources[0].id],
    'a later over-limit batch retains the previously saved exposure without partially adding another');
  assert.equal(validateDocument(document), true);
});

test('instance-swap properties accept compatible components outside variant sets and keep ordinary overrides', () => {
  const document = createDocument();
  const baseNode = createNode('frame', { name: 'Original', width: 80, height: 40 });
  addNode(document, baseNode);
  const baseComponent = createComponent(document, baseNode.id, 'Original');

  const replacementNode = createNode('text', { name: 'Replacement', text: 'Swapped content' });
  addNode(document, replacementNode);
  const replacementComponent = createComponent(document, replacementNode.id, 'Replacement');

  const card = createNode('frame', { name: 'Card' });
  addNode(document, card);
  const slotGroup = createNode('group', { name: 'Slot group' });
  addNode(document, slotGroup, { parentId: card.id });
  const nested = createComponentInstance(document, baseComponent.id);
  document.pages[0].children.splice(document.pages[0].children.indexOf(nested), 1);
  slotGroup.children.push(nested);
  nested.x = 12; nested.y = 8;
  const accent = createNode('rectangle', { name: 'Accent' });
  addNode(document, accent, { parentId: card.id });
  const cardComponent = createComponent(document, card.id, 'Card');
  const swapProperty = createComponentProperty(document, cardComponent.id, { name: 'Content', type: 'INSTANCE_SWAP', targetNodeId: nested.id });
  assert.equal(canSwapComponentTo(document, cardComponent.id, replacementComponent.id), true);
  assert.equal(canSwapComponentTo(document, cardComponent.id, cardComponent.id), false);
  const instance = createComponentInstance(document, cardComponent.id);
  instance.componentOverrides[nested.id] = { opacity: 0.65, name: 'Custom content name' };
  const instanceNodeBySource = sourceId => {
    let found = null;
    const visit = node => {
      if (node.componentSourceId === sourceId) { found = node; return; }
      for (const child of node.children || []) visit(child);
    };
    visit(instance);
    return found;
  };
  instance.children.find(node => node.componentSourceId === accent.id).fill = '#00aa88';
  instance.componentOverrides[accent.id] = { fill: '#00aa88' };

  assert.equal(setComponentPropertyValue(document, instance.id, swapProperty.id, replacementComponent.id), true);
  let instanceNested = instanceNodeBySource(nested.id);
  assert.equal(instanceNested.type, 'text');
  assert.equal(instanceNested.componentId, replacementComponent.id);
  assert.equal(instanceNested.componentSourceId, nested.id);
  assert.equal(instanceNested.text, 'Swapped content');
  assert.equal(instanceNested.opacity, 0.65);
  assert.equal(instanceNested.name, 'Custom content name');
  assert.equal(instance.children.find(node => node.componentSourceId === accent.id).fill, '#00aa88');

  card.width = 280;
  assert.equal(syncComponentInstances(document, cardComponent.id), 1);
  instanceNested = instanceNodeBySource(nested.id);
  assert.equal(instanceNested.componentId, replacementComponent.id);
  assert.equal(instanceNested.type, 'text');
  assert.equal(instanceNested.opacity, 0.65);
  assert.equal(instanceNested.name, 'Custom content name');
  assert.equal(instance.width, 280);
  assert.throws(() => setComponentPropertyValue(document, instance.id, swapProperty.id, cardComponent.id), /Invalid value/);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('component-property validation rejects duplicate IDs, unsupported targets, and invalid instance values', () => {
  const document = createDocument();
  const main = createNode('frame'); const label = createNode('text', { text: 'Hello' });
  addNode(document, main); addNode(document, label, { parentId: main.id });
  const component = createComponent(document, main.id);
  const property = createComponentProperty(document, component.id, { name: 'Label', type: 'TEXT', targetNodeId: label.id });
  const instance = createComponentInstance(document, component.id);
  assert.equal(validateDocument(document), true);

  const duplicateId = parseDocument(serializeDocument(document));
  duplicateId.components[0].componentProperties.push({ ...duplicateId.components[0].componentProperties[0], name: 'Other' });
  assert.throws(() => validateDocument(duplicateId), /Invalid component property/);

  const missingTarget = parseDocument(serializeDocument(document));
  missingTarget.components[0].componentProperties[0].targetSourceId = 'missing-layer';
  assert.throws(() => validateDocument(missingTarget), /Invalid component property/);

  const wrongTarget = parseDocument(serializeDocument(document));
  wrongTarget.components[0].componentProperties[0].targetSourceId = main.id;
  assert.throws(() => validateDocument(wrongTarget), /Invalid TEXT default/);

  instance.componentPropertyValues = { [property.id]: false };
  assert.throws(() => validateDocument(document), /Invalid component property value/);
});

test('slot content is real cloned layer content that survives master sync, reload, detach, and reset', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card' });
  const slot = createNode('section', { name: 'Content', x: 12, y: 20, width: 180, height: 90 });
  const inherited = createNode('text', { name: 'Default content', text: 'Master copy' });
  addNode(document, main);
  addNode(document, slot, { parentId: main.id });
  addNode(document, inherited, { parentId: slot.id });
  const component = createComponent(document, main.id, 'Card');
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  assert.deepEqual(property.defaultValue, []);
  const instance = createComponentInstance(document, component.id);
  const replacement = createNode('group', { name: 'Supplied artwork', x: 3, y: 4, width: 80, height: 50 });
  const replacementChild = createNode('rectangle', { name: 'Badge', fill: '#12abef', x: 2, y: 3 });
  replacement.children.push(replacementChild);
  const [installed] = setComponentSlotContent(document, instance.id, property.id, [replacement]);
  assert.notEqual(installed.id, replacement.id, 'slot content gets new IDs instead of stealing IDs from its source');
  assert.notEqual(installed.children[0].id, replacementChild.id);
  assert.equal(installed.children[0].fill, '#12abef');
  const instanceSlot = findNode(document, instance.id).node.children.find(node => node.componentSourceId === slot.id);
  assert.deepEqual(instanceSlot.children.map(node => node.id), [installed.id]);
  assert.deepEqual(instance.componentPropertyValues[property.id], [installed.id]);
  assert.equal(validateDocument(document), true);
  assert.throws(() => setComponentPropertyValue(document, instance.id, property.id, ['not-a-layer-tree']), /setComponentSlotContent/);
  assert.equal(setComponentSlotContent(document, instance.id, 'missing-property', []), false);
  const duplicateTree = createNode('group');
  duplicateTree.children.push(createNode('rectangle', { id: duplicateTree.id }));
  assert.throws(() => setComponentSlotContent(document, instance.id, property.id, [duplicateTree]), /unique IDs/);
  const forbiddenMain = createNode('frame', { name: 'Unlinked main' });
  addNode(document, forbiddenMain);
  createComponent(document, forbiddenMain.id, 'Unlinked main');
  assert.throws(() => setComponentSlotContent(document, instance.id, property.id, [forbiddenMain]), /main component/);

  slot.width = 240;
  inherited.text = 'Master changed';
  assert.equal(syncComponentInstances(document, component.id), 1);
  const synced = findNode(document, instance.id).node;
  const syncedSlot = synced.children.find(node => node.componentSourceId === slot.id);
  assert.equal(syncedSlot.width, 240);
  assert.equal(syncedSlot.children[0].id, installed.id);
  assert.equal(syncedSlot.children[0].children[0].fill, '#12abef');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  assert.equal(detachComponentInstance(document, instance.id), true);
  assert.equal(synced.children.find(node => node.name === 'Content').children[0].id, installed.id);
  assert.equal(synced.isInstance, undefined);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const second = createComponentInstance(document, component.id);
  const [secondSlot] = findNode(document, second.id).node.children.filter(node => node.componentSourceId === slot.id);
  assert.equal(secondSlot.children[0].text, 'Master changed');
  const custom = createNode('text', { text: 'Replace again' });
  setComponentSlotContent(document, second.id, property.id, [custom]);
  setComponentSlotContent(document, second.id, property.id, []);
  const emptySlotInstance = findNode(document, second.id).node;
  assert.deepEqual(emptySlotInstance.componentPropertyValues[property.id], []);
  assert.deepEqual(emptySlotInstance.children.find(node => node.componentSourceId === slot.id).children, []);
  assert.equal(syncComponentInstances(document, component.id), 1);
  assert.deepEqual(findNode(document, second.id).node.children.find(node => node.componentSourceId === slot.id).children, []);
  assert.equal(resetComponentSlotContent(document, second.id, property.id), true);
  const resetSlot = findNode(document, second.id).node.children.find(node => node.componentSourceId === slot.id);
  assert.equal(resetSlot.children[0].text, 'Master changed');
  assert.equal(Object.hasOwn(findNode(document, second.id).node.componentPropertyValues || {}, property.id), false);
  assert.equal(validateDocument(document), true);
});

test('slot values remain isolated per instance and follow direct child order', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card' });
  const slot = createNode('group', { name: 'Content' });
  const inherited = createNode('text', { text: 'Master' });
  addNode(document, main); addNode(document, slot, { parentId: main.id });
  addNode(document, inherited, { parentId: slot.id });
  const component = createComponent(document, main.id, 'Card');
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const first = createComponentInstance(document, component.id);
  const second = createComponentInstance(document, component.id);
  setComponentSlotContent(document, first.id, property.id, [createNode('text', { text: 'First' }), createNode('text', { text: 'First extra' })]);
  setComponentSlotContent(document, second.id, property.id, [createNode('text', { text: 'Second' })]);

  inherited.text = 'Master updated';
  assert.equal(syncComponentInstances(document, component.id), 2);
  const firstSlot = findNode(document, first.id).node.children.find(node => node.componentSourceId === slot.id);
  const secondSlot = findNode(document, second.id).node.children.find(node => node.componentSourceId === slot.id);
  assert.deepEqual(firstSlot.children.map(node => node.text), ['First', 'First extra']);
  assert.deepEqual(secondSlot.children.map(node => node.text), ['Second']);
  assert.deepEqual(first.componentPropertyValues[property.id], firstSlot.children.map(node => node.id));
  assert.deepEqual(second.componentPropertyValues[property.id], secondSlot.children.map(node => node.id));
  assert.equal(validateDocument(document), true);
});

test('layer mutations keep explicit slot child IDs aligned through add, remove, duplicate, move, reorder, and group', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card' });
  const slot = createNode('frame', { name: 'Content' });
  addNode(document, main); addNode(document, slot, { parentId: main.id });
  const component = createComponent(document, main.id, 'Card');
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const target = instance.children.find(node => node.componentSourceId === slot.id);
  const first = createNode('rectangle', { name: 'First' });
  const second = createNode('ellipse', { name: 'Second' });
  const third = createNode('text', { name: 'Third', text: 'Third' });
  setComponentSlotContent(document, instance.id, property.id, [first, second]);
  const [firstId, secondId] = target.children.map(node => node.id);
  updateNode(document, target.id, { children: [...target.children, createNode('rectangle', { name: 'Patch-added' })] });
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  addNode(document, third, { parentId: target.id });
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.equal(reorderNode(document, secondId, 0), true);
  assert.deepEqual(instance.componentPropertyValues[property.id], [secondId, firstId, ...target.children.slice(2).map(node => node.id)]);

  const duplicate = duplicateNode(document, firstId);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.equal(removeNode(document, firstId)?.id, firstId);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  const movedId = target.children.at(-1).id;
  assert.equal(moveNode(document, movedId, { parentId: null }), true);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.equal(moveNode(document, movedId, { parentId: target.id, index: 1 }), true);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));

  const groupInputs = target.children.slice(0, 2).map(node => node.id);
  assert.equal(canGroupLayers(document, groupInputs), true);
  const group = groupLayers(document, groupInputs);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.equal(target.children[0].id, group.id);
  assert.equal(canUngroupLayers(document, group.id), true);
  ungroupLayers(document, group.id);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.notEqual(duplicate.id, firstId);
  assert.equal(validateDocument(document), true);
});

test('default slot content allows child-order overrides and blocks structural mutations', () => {
  const document = createDocument();
  const main = createNode('frame', { name: 'Card' });
  const slot = createNode('frame', { name: 'Content' });
  const inherited = createNode('text', { name: 'Inherited', text: 'Keep me' });
  const inheritedSecond = createNode('rectangle', { name: 'Inherited second' });
  addNode(document, main); addNode(document, slot, { parentId: main.id });
  addNode(document, inherited, { parentId: slot.id }); addNode(document, inheritedSecond, { parentId: slot.id });
  const component = createComponent(document, main.id, 'Card');
  createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const target = instance.children.find(node => node.componentSourceId === slot.id);
  const inheritedInstanceChild = target.children[0];
  const inheritedInstanceSecond = target.children[1];

  assert.throws(() => addNode(document, createNode('rectangle'), { parentId: target.id }), /Set a slot override before editing it/);
  assert.throws(() => removeNode(document, inheritedInstanceChild.id), /Set a slot override before editing it/);
  assert.throws(() => duplicateNode(document, inheritedInstanceChild.id), /Set a slot override before editing it/);
  assert.throws(() => moveNode(document, inheritedInstanceChild.id, { parentId: null }), /Set a slot override before editing it/);
  assert.throws(() => updateNode(document, target.id, { children: [] }), /Set a slot override before editing it/);
  assert.equal(reorderNode(document, inheritedInstanceSecond.id, 0), true);
  assert.deepEqual(target.children.map(node => node.componentSourceId), [inheritedInstanceSecond.componentSourceId, inheritedInstanceChild.componentSourceId]);
  instance.componentOverrides ||= {};
  instance.componentOverrides[slot.id] = { __childOrder: target.children.map(node => node.componentSourceId) };
  assert.equal(syncComponentInstances(document, component.id), 1);
  assert.deepEqual(target.children.map(node => node.componentSourceId), [inheritedInstanceSecond.componentSourceId, inheritedInstanceChild.componentSourceId]);
  assert.equal(target.children.length, 2);
  assert.equal(target.children[1].text, 'Keep me');
  assert.equal(validateDocument(document), true);
});

test('Boolean and mask grouping mutations keep overridden slot roots synchronized', () => {
  const document = createDocument();
  const main = createNode('frame'); const slot = createNode('frame');
  addNode(document, main); addNode(document, slot, { parentId: main.id });
  const component = createComponent(document, main.id);
  const property = createComponentProperty(document, component.id, { name: 'Artwork', type: 'SLOT', targetNodeId: slot.id });
  const instance = createComponentInstance(document, component.id);
  const target = instance.children.find(node => node.componentSourceId === slot.id);

  setComponentSlotContent(document, instance.id, property.id, [createNode('rectangle'), createNode('ellipse')]);
  const booleanIds = target.children.map(node => node.id);
  const booleanGroup = combineBoolean(document, booleanIds, 'union');
  assert.deepEqual(instance.componentPropertyValues[property.id], [booleanGroup.id]);
  assert.equal(validateDocument(document), true);
  separateBoolean(document, booleanGroup.id);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));

  const text = createNode('text', { text: 'Masked' });
  const mask = createNode('rectangle');
  setComponentSlotContent(document, instance.id, property.id, [text, mask]);
  const [textId, maskId] = target.children.map(node => node.id);
  assert.equal(canCreateMaskGroup(document, [textId, maskId]), true);
  const maskGroup = createMaskGroup(document, [textId, maskId]);
  assert.deepEqual(instance.componentPropertyValues[property.id], [maskGroup.id]);
  releaseMaskGroup(document, maskGroup.id);
  assert.deepEqual(instance.componentPropertyValues[property.id], target.children.map(node => node.id));
  assert.equal(validateDocument(document), true);
});

test('named slot content migrates between variants with different slot source IDs', () => {
  const document = createDocument();
  const compact = createNode('frame', { name: 'Compact card', width: 180, height: 100 });
  const compactSlot = createNode('group', { name: 'Compact content' });
  const wide = createNode('frame', { name: 'Wide card', width: 320, height: 140 });
  const wideSlot = createNode('frame', { name: 'Wide content' });
  addNode(document, compact); addNode(document, compactSlot, { parentId: compact.id });
  addNode(document, wide); addNode(document, wideSlot, { parentId: wide.id });
  const compactComponent = createComponent(document, compact.id, 'Card / Size=Compact');
  const wideComponent = createComponent(document, wide.id, 'Card / Size=Wide');
  const compactProperty = createComponentProperty(document, compactComponent.id, { name: 'Content', type: 'SLOT', targetNodeId: compactSlot.id });
  const wideProperty = createComponentProperty(document, wideComponent.id, { name: 'Content', type: 'SLOT', targetNodeId: wideSlot.id });
  createComponentSet(document, [compactComponent.id, wideComponent.id], 'Card');
  const instance = createComponentInstance(document, compactComponent.id);
  const artwork = createNode('rectangle', { name: 'Photo placeholder', fill: '#aabbcc', width: 64, height: 48 });
  const [installed] = setComponentSlotContent(document, instance.id, compactProperty.id, [artwork]);

  assert.equal(switchComponentInstanceVariant(document, instance.id, wideComponent.id), true);
  assert.equal(instance.componentId, wideComponent.id);
  assert.deepEqual(instance.componentPropertyValues[wideProperty.id], [installed.id]);
  assert.equal(Object.hasOwn(instance.componentPropertyValues, compactProperty.id), false);
  const targetSlot = instance.children.find(node => node.componentSourceId === wideSlot.id);
  assert.equal(targetSlot.children[0].id, installed.id);
  assert.equal(targetSlot.children[0].fill, '#aabbcc');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  assert.equal(switchComponentInstanceVariant(document, instance.id, compactComponent.id), true);
  assert.equal(instance.children.find(node => node.componentSourceId === compactSlot.id).children[0].id, installed.id);
  assert.equal(validateDocument(document), true);
});

test('slot validation rejects invalid targets, malformed content, and property-value mismatches', () => {
  const document = createDocument();
  const main = createNode('frame'); const slot = createNode('frame'); const label = createNode('text', { text: 'Label' });
  addNode(document, main); addNode(document, slot, { parentId: main.id }); addNode(document, label, { parentId: main.id });
  const component = createComponent(document, main.id);
  const property = createComponentProperty(document, component.id, { name: 'Content', type: 'SLOT', targetNodeId: slot.id });
  assert.throws(() => createComponentProperty(document, component.id, { name: 'Root slot', type: 'SLOT', targetNodeId: main.id }), /nested frame, group, or section/);
  const instance = createComponentInstance(document, component.id);
  const supplied = createNode('section');
  supplied.children.push(createNode('rectangle'));
  const secondSupplied = createNode('text', { text: 'Also custom' });
  const [installed, secondInstalled] = setComponentSlotContent(document, instance.id, property.id, [supplied, secondSupplied]);
  assert.equal(validateDocument(document), true);

  const missingId = parseDocument(serializeDocument(document));
  const missingInstance = findNode(missingId, instance.id).node;
  missingInstance.componentPropertyValues[property.id] = ['not-a-child'];
  assert.throws(() => validateDocument(missingId), /Invalid component property value/);

  const duplicateValues = parseDocument(serializeDocument(document));
  const duplicateInstance = findNode(duplicateValues, instance.id).node;
  duplicateInstance.componentPropertyValues[property.id] = [installed.id, installed.id];
  assert.throws(() => validateDocument(duplicateValues), /Invalid component property value/);

  const wrongOrder = parseDocument(serializeDocument(document));
  const reorderedInstance = findNode(wrongOrder, instance.id).node;
  reorderedInstance.componentPropertyValues[property.id] = [secondInstalled.id, installed.id];
  assert.throws(() => validateDocument(wrongOrder), /Invalid component property value/);

  const badTarget = parseDocument(serializeDocument(document));
  badTarget.components[0].componentProperties[0].targetSourceId = label.id;
  assert.throws(() => validateDocument(badTarget), /Invalid component property/);

  const rootTarget = parseDocument(serializeDocument(document));
  rootTarget.components[0].componentProperties[0].targetSourceId = main.id;
  assert.throws(() => validateDocument(rootTarget), /Invalid component property/);

  const badDefault = parseDocument(serializeDocument(document));
  badDefault.components[0].componentProperties[0].defaultValue = ['content-is-not-a-default'];
  assert.throws(() => validateDocument(badDefault), /Invalid SLOT default/);
});

test('variant switching preserves populated slots only when a same-named target slot exists', () => {
  const document = createDocument();
  const first = createNode('frame', { name: 'First / Size=One' }); const firstSlot = createNode('frame', { name: 'Content' });
  const second = createNode('frame', { name: 'Second / Size=Two' }); const secondSlot = createNode('frame', { name: 'Other content' });
  addNode(document, first); addNode(document, firstSlot, { parentId: first.id });
  addNode(document, second); addNode(document, secondSlot, { parentId: second.id });
  const firstComponent = createComponent(document, first.id);
  const secondComponent = createComponent(document, second.id);
  const firstProperty = createComponentProperty(document, firstComponent.id, { name: 'Content', type: 'SLOT', targetNodeId: firstSlot.id });
  createComponentProperty(document, secondComponent.id, { name: 'Other content', type: 'SLOT', targetNodeId: secondSlot.id });
  createComponentSet(document, [firstComponent.id, secondComponent.id], 'Card');
  const instance = createComponentInstance(document, firstComponent.id);
  setComponentSlotContent(document, instance.id, firstProperty.id, [createNode('rectangle')]);
  const before = serializeDocument(document);
  assert.throws(() => switchComponentInstanceVariant(document, instance.id, secondComponent.id), /no matching target slot/);
  assert.equal(serializeDocument(document), before, 'a rejected variant switch must not discard custom slot content');
  assert.equal(validateDocument(document), true);
});
