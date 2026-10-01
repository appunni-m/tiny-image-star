import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPONENT_LIBRARY_SCHEMA,
  createComponentLibrary,
  createLinkedInstanceSnapshot,
  publishComponent,
  publishComponentSet,
  updateLinkedInstanceSnapshot,
  validateComponentLibrary,
  validateLinkedInstanceSnapshot
} from '../src/component-library.js';

function cardRoot({ title = 'Default title', fill = '#ffffff', includeIcon = true, iconType = 'ellipse' } = {}) {
  return {
    id: 'card-root', type: 'frame', name: 'Card', width: 240, height: 120,
    children: [
      { id: 'card-title', type: 'text', name: 'Title', text: title, fontSize: 18, children: [] },
      ...(includeIcon ? [{ id: 'card-icon', type: iconType, name: 'Icon', fill, children: [] }] : [])
    ]
  };
}

function publish(library, root = cardRoot(), name = 'Card') {
  return publishComponent(library, { componentId: 'component-card', name, root });
}

test('publishing a component set preserves its variant axes, member definitions, and immutable history', () => {
  const library = createComponentLibrary({ id: 'library-set', name: 'System' });
  const properties = [
    { name: 'State', values: ['Default', 'Hover'] },
    { name: 'Size', values: ['Small'] }
  ];
  const variants = [
    {
      componentId: 'button-default', name: 'Button/Default', root: cardRoot(),
      variantProperties: { State: 'Default', Size: 'Small' },
      componentProperties: [{ id: 'property-label', name: 'Label', type: 'TEXT', targetSourceId: 'card-title', defaultValue: 'Default title' }]
    },
    {
      componentId: 'button-hover', name: 'Button/Hover', root: cardRoot({ fill: '#e5e7eb' }),
      variantProperties: { State: 'Hover', Size: 'Small' },
      componentProperties: [{ id: 'property-icon', name: 'Show icon', type: 'BOOLEAN', targetSourceId: 'card-icon', defaultValue: true }]
    }
  ];
  const published = publishComponentSet(library, { componentSetId: 'set-button', name: 'Button', properties, variants });
  assert.equal(published.library.revision, 2);
  assert.deepEqual(published.publication.componentIds, ['button-default', 'button-hover']);
  assert.deepEqual(published.publication.properties, properties);
  assert.deepEqual(published.publications.map(item => item.variantProperties), variants.map(item => item.variantProperties));
  assert.deepEqual(published.publications[0].componentProperties, variants[0].componentProperties);
  assert.equal(validateComponentLibrary(published.library), true);
  assert.ok(Object.isFrozen(published.library.componentSets[0].versions[0].properties[0].values));
  assert.throws(() => { published.library.componentSets[0].versions[0].properties[0].values.push('Pressed'); }, TypeError);

  const nextVariants = variants.map((variant, index) => ({
    ...variant,
    root: cardRoot({ title: index ? 'Hover label' : 'Default label' })
  }));
  const updated = publishComponentSet(published.library, {
    componentSetId: 'set-button', name: 'Button',
    properties: [{ name: 'State', values: ['Default', 'Hover', 'Pressed'] }, { name: 'Size', values: ['Small'] }],
    variants: [
      ...nextVariants,
      { componentId: 'button-pressed', name: 'Button/Pressed', root: cardRoot(), variantProperties: { State: 'Pressed', Size: 'Small' } }
    ]
  });
  assert.deepEqual(updated.library.componentSets[0].versions.map(item => item.revision), [2, 5]);
  assert.deepEqual(updated.library.componentSets[0].versions[0].properties[0].values, ['Default', 'Hover']);
  assert.deepEqual(updated.library.componentSets[0].versions[1].componentIds, ['button-default', 'button-hover', 'button-pressed']);
  assert.equal(validateComponentLibrary(updated.library), true);
});

test('component-set history validates each snapshot against the latest member revision at that point', () => {
  const library = createComponentLibrary({ id: 'library-axis-history', name: 'System' });
  const root = id => ({ id, type: 'frame', children: [] });
  const first = publishComponentSet(library, {
    componentSetId: 'set-button', name: 'Button',
    properties: [{ name: 'State', values: ['Default', 'Hover'] }],
    variants: [
      { componentId: 'button-default', name: 'Button/Default', root: root('default-v1'), variantProperties: { State: 'Default' } },
      { componentId: 'button-hover', name: 'Button/Hover', root: root('hover-v1'), variantProperties: { State: 'Hover' } }
    ]
  });

  const updated = publishComponentSet(first.library, {
    componentSetId: 'set-button', name: 'Button',
    properties: [{ name: 'State', values: ['Base', 'Hover'] }],
    variants: [
      { componentId: 'button-default', name: 'Button/Base', root: root('default-v2'), variantProperties: { State: 'Base' } },
      { componentId: 'button-hover', name: 'Button/Hover', root: root('hover-v2'), variantProperties: { State: 'Hover' } }
    ]
  });

  assert.equal(validateComponentLibrary(updated.library), true);
  assert.deepEqual(updated.library.componentSets[0].versions.map(version => version.properties[0].values), [
    ['Default', 'Hover'], ['Base', 'Hover']
  ]);
  assert.deepEqual(updated.library.components.find(component => component.id === 'button-default').versions.map(version => version.variantProperties.State), ['Default', 'Base']);
});

test('republishing a set member with the regular component payload preserves its set and property metadata', () => {
  const library = createComponentLibrary({ id: 'library-preserved-member', name: 'System' });
  const root = (id, label) => ({
    id, type: 'frame', children: [{ id: `${id}-label`, type: 'text', text: label, children: [] }]
  });
  const published = publishComponentSet(library, {
    componentSetId: 'set-button', name: 'Button',
    properties: [{ name: 'State', values: ['Default', 'Hover'] }],
    variants: [
      {
        componentId: 'button-default', name: 'Button/Default', root: root('default-root', 'Go'),
        variantProperties: { State: 'Default' },
        componentProperties: [{ id: 'label', name: 'Label', type: 'TEXT', targetSourceId: 'default-root-label', defaultValue: 'Go' }]
      },
      { componentId: 'button-hover', name: 'Button/Hover', root: root('hover-root', 'Go'), variantProperties: { State: 'Hover' } }
    ]
  });

  // This is the shape sent by the normal editor republish path.
  const revised = publishComponent(published.library, {
    componentId: 'button-default', name: 'Button/Default', root: root('default-root', 'Continue')
  });
  const latest = revised.library.components.find(component => component.id === 'button-default').versions.at(-1);
  assert.equal(latest.componentSetId, 'set-button');
  assert.deepEqual(latest.variantProperties, { State: 'Default' });
  assert.deepEqual(latest.componentProperties, [{
    id: 'label', name: 'Label', type: 'TEXT', targetSourceId: 'default-root-label', defaultValue: 'Go'
  }]);
  assert.equal(validateComponentLibrary(revised.library), true);
});

test('component-set publishing rejects incomplete axes, duplicate combinations, and dangling property targets', () => {
  const library = createComponentLibrary({ id: 'library-invalid-set', name: 'System' });
  const variants = [
    { componentId: 'one', name: 'One', root: cardRoot(), variantProperties: { State: 'Default' } },
    { componentId: 'two', name: 'Two', root: cardRoot(), variantProperties: { State: 'Hover' } }
  ];
  assert.throws(() => publishComponentSet(library, { componentSetId: 'set', name: 'Set', properties: [], variants }), /at least one variant axis/);
  assert.throws(() => publishComponentSet(library, {
    componentSetId: 'set', name: 'Set', properties: [{ name: 'State', values: ['Default', 'Hover'] }],
    variants: variants.map(item => ({ ...item, variantProperties: { State: 'Default' } }))
  }), /unique axis combinations/);
  assert.throws(() => publishComponentSet(library, {
    componentSetId: 'set', name: 'Set', properties: [{ name: 'State', values: ['Default', 'Hover'] }],
    variants: variants.map(item => ({ ...item, componentProperties: [{ id: 'bad', name: 'Label', type: 'TEXT', targetSourceId: 'missing', defaultValue: '' }] }))
  }), /missing source layer/);
});

test('libraries require stable identities and validate globally monotonic publication revisions', () => {
  assert.throws(() => createComponentLibrary({ id: '', name: 'Design system' }), /Library ID/);
  assert.throws(() => createComponentLibrary({ id: 'library-1', name: '   ' }), /Library name/);
  assert.throws(() => createComponentLibrary({ id: ' library-1', name: 'Design system' }), /Library ID/);

  const empty = createComponentLibrary({ id: 'library-brand', name: 'Brand system' });
  assert.equal(empty.schema, COMPONENT_LIBRARY_SCHEMA);
  assert.equal(empty.revision, 0);
  assert.equal(validateComponentLibrary(empty), true);
  assert.throws(() => publishComponent(empty, { componentId: ' ', name: 'Card', root: cardRoot() }), /Component ID/);
  const duplicateLayerRoot = cardRoot();
  duplicateLayerRoot.children.push({ ...duplicateLayerRoot.children[0] });
  assert.throws(() => publishComponent(empty, { componentId: 'component-card', name: 'Card', root: duplicateLayerRoot }), /duplicate source layer ID/);

  const first = publish(empty).library;
  const second = publishComponent(first, { componentId: 'component-button', name: 'Button', root: { id: 'button-root', type: 'frame', children: [] } }).library;
  const third = publish(second, cardRoot({ title: 'Updated' })).library;
  assert.deepEqual([first.revision, second.revision, third.revision], [1, 2, 3]);
  assert.deepEqual(third.components.find(item => item.id === 'component-card').versions.map(item => item.revision), [1, 3]);
  assert.equal(validateComponentLibrary(third), true);

  const duplicateGlobalRevision = structuredClone(third);
  duplicateGlobalRevision.components.find(item => item.id === 'component-button').versions[0].revision = 1;
  assert.throws(() => validateComponentLibrary(duplicateGlobalRevision), /assigned to more than one publication/);
  const missingRevision = structuredClone(third);
  missingRevision.revision = 4;
  assert.throws(() => validateComponentLibrary(missingRevision), /cover every revision/);
  const invalidComponentIdentity = structuredClone(third);
  invalidComponentIdentity.components[1].versions[0].componentId = 'other-id';
  assert.throws(() => validateComponentLibrary(invalidComponentIdentity), /identity does not match/);
});

test('publishing is immutable, snapshots remain unchanged, and a component keeps its identity across revisions', () => {
  const library = createComponentLibrary({ id: 'library-ui', name: 'UI kit' });
  const inputRoot = cardRoot();
  const firstResult = publish(library, inputRoot);
  inputRoot.children[0].text = 'Mutated caller input';
  assert.equal(firstResult.publication.root.children[0].text, 'Default title', 'publish must own a defensive snapshot');
  assert.equal(firstResult.library.components[0].id, 'component-card');
  assert.ok(Object.isFrozen(firstResult.library));
  assert.ok(Object.isFrozen(firstResult.library.components[0].versions[0].root.children[0]));
  assert.throws(() => { firstResult.publication.root.children[0].text = 'Mutation'; }, TypeError);

  const secondResult = publish(firstResult.library, cardRoot({ title: 'Current title' }), 'Card');
  assert.equal(secondResult.library.components[0].id, firstResult.library.components[0].id);
  assert.deepEqual(secondResult.library.components[0].versions.map(version => version.revision), [1, 2]);
  assert.equal(firstResult.library.revision, 1, 'publishing a later version must not mutate the prior library value');
  assert.equal(firstResult.library.components[0].versions[0].root.children[0].text, 'Default title');
  assert.equal(secondResult.publication.root.children[0].text, 'Current title');
});

test('linked snapshots preserve compatible overrides while reporting changed and added source layers', () => {
  const library = publish(createComponentLibrary({ id: 'library-components', name: 'Components' })).library;
  const linked = createLinkedInstanceSnapshot(library, 'component-card', {
    instanceId: 'instance-home-card',
    overrides: { 'card-title': { text: 'Welcome', color: '#202124' }, 'card-icon': { fill: '#ff0088' } }
  });
  assert.equal(validateLinkedInstanceSnapshot(linked), true);
  assert.equal(linked.root.children[0].text, 'Welcome');
  assert.equal(linked.root.children[1].fill, '#ff0088');

  const newer = publishComponent(library, {
    componentId: 'component-card', name: 'Card',
    root: {
      ...cardRoot({ title: 'New source title', fill: '#00aaff' }),
      children: [
        { ...cardRoot().children[0], text: 'New source title', fontSize: 20 },
        { ...cardRoot().children[1], fill: '#00aaff' },
        { id: 'card-badge', type: 'rectangle', name: 'Badge', fill: '#ffaa00', children: [] }
      ]
    }
  }).library;

  const result = updateLinkedInstanceSnapshot(linked, newer);
  assert.equal(result.instance.sourceRevision, 2);
  assert.equal(result.instance.root.children[0].text, 'Welcome', 'local text override should win over the updated source');
  assert.equal(result.instance.root.children[0].fontSize, 20, 'unoverridden source fields should update');
  assert.equal(result.instance.root.children[1].fill, '#ff0088', 'compatible fill override should remain');
  assert.equal(result.instance.root.children[2].id, 'card-badge', 'new source layers should appear in the resolved snapshot');
  assert.deepEqual(result.report.changedSourceLayers.map(item => item.sourceLayerId).sort(), ['card-icon', 'card-title']);
  assert.ok(result.report.changedSourceLayers.find(item => item.sourceLayerId === 'card-title').changedProperties.includes('fontSize'));
  assert.deepEqual(result.report.addedSourceLayers, [{ sourceLayerId: 'card-badge', name: 'Badge', type: 'rectangle' }]);
  assert.deepEqual(result.report.preservedOverrides.map(item => item.sourceLayerId).sort(), ['card-icon', 'card-title']);
  assert.deepEqual(result.report.droppedOverrides, []);
  assert.deepEqual(result.report.conflictingOverrides, [
    {
      sourceLayerId: 'card-icon',
      name: 'Icon',
      properties: [{
        property: 'fill',
        base: { present: true, value: '#ffffff' },
        source: { present: true, value: '#00aaff' },
        instance: { present: true, value: '#ff0088' }
      }]
    },
    {
      sourceLayerId: 'card-title',
      name: 'Title',
      properties: [{
        property: 'text',
        base: { present: true, value: 'Default title' },
        source: { present: true, value: 'New source title' },
        instance: { present: true, value: 'Welcome' }
      }]
    }
  ], 'the update report identifies concurrent source and instance edits with their three compared values');
  assert.equal(linked.sourceRevision, 1, 'updating must leave the original linked snapshot untouched');
  assert.equal(linked.root.children[0].text, 'Welcome');
  assert.ok(Object.isFrozen(result.instance.root.children[0]));
  assert.ok(Object.isFrozen(result.report.changedSourceLayers[0]));
});

test('linked updates distinguish concurrent override conflicts from unchanged or converged values', () => {
  let library = publish(createComponentLibrary({ id: 'library-conflicts', name: 'Conflicts' })).library;
  const linked = createLinkedInstanceSnapshot(library, 'component-card', {
    instanceId: 'instance-conflicts',
    overrides: {
      'card-title': { text: 'Default title', color: '#112233' },
      'card-icon': { fill: '#ff0088' }
    }
  });
  library = publishComponent(library, {
    componentId: 'component-card', name: 'Card',
    root: {
      ...cardRoot({ title: 'Default title', fill: '#ff0088' }),
      children: [
        { ...cardRoot().children[0], color: '#112233' },
        { ...cardRoot().children[1], fill: '#ff0000' }
      ]
    }
  }).library;

  const result = updateLinkedInstanceSnapshot(linked, library);
  assert.deepEqual(result.report.conflictingOverrides, [{
    sourceLayerId: 'card-icon',
    name: 'Icon',
    properties: [{
      property: 'fill',
      base: { present: true, value: '#ffffff' },
      source: { present: true, value: '#ff0000' },
      instance: { present: true, value: '#ff0088' }
    }]
  }], 'an override equal to the base is unchanged, and one matching the new source is already converged');
  assert.equal(result.instance.root.children[0].text, 'Default title');
  assert.equal(result.instance.root.children[0].color, '#112233');
  assert.equal(result.instance.root.children[1].fill, '#ff0088', 'the existing snapshot policy still preserves the local side of conflicts');
});

test('updates report removed layers and drop their overrides; a layer type change is incompatible', () => {
  let library = publish(createComponentLibrary({ id: 'library-removal', name: 'Removal test' })).library;
  const linked = createLinkedInstanceSnapshot(library, 'component-card', {
    instanceId: 'instance-removal',
    overrides: { 'card-title': { text: 'Local title' }, 'card-icon': { fill: '#ff00ff' } }
  });
  library = publishComponent(library, {
    componentId: 'component-card', name: 'Card',
    root: {
      id: 'card-root', type: 'frame', name: 'Card', width: 260, height: 130,
      children: [
        { id: 'card-title', type: 'text', name: 'Title', text: 'Remote title', children: [] },
        { id: 'card-icon', type: 'path', name: 'Icon', fill: '#000000', children: [] }
      ]
    }
  }).library;

  const result = updateLinkedInstanceSnapshot(linked, library);
  assert.deepEqual(result.report.removedSourceLayers.map(item => item.sourceLayerId), []);
  assert.deepEqual(result.report.changedSourceLayers.find(item => item.sourceLayerId === 'card-icon').beforeType, 'ellipse');
  assert.deepEqual(result.report.changedSourceLayers.find(item => item.sourceLayerId === 'card-icon').afterType, 'path');
  assert.deepEqual(result.report.droppedOverrides, [{
    sourceLayerId: 'card-icon', reason: 'incompatible-source-layer-type', beforeType: 'ellipse', afterType: 'path', properties: ['fill']
  }]);
  assert.deepEqual(result.instance.overrides, { 'card-title': { text: 'Local title' } });
  assert.equal(result.instance.root.children[1].fill, '#000000');

  const next = publishComponent(library, {
    componentId: 'component-card', name: 'Card', root: cardRoot({ includeIcon: false })
  }).library;
  const removed = updateLinkedInstanceSnapshot(result.instance, next);
  assert.deepEqual(removed.report.removedSourceLayers, [{ sourceLayerId: 'card-icon', name: 'Icon', type: 'path' }]);
  assert.deepEqual(removed.report.droppedOverrides, [], 'the incompatible override was already dropped by the prior update');
  assert.equal(removed.instance.root.children.some(node => node.id === 'card-icon'), false);
});

test('linked updates reject stale, mismatched, or forged library histories', () => {
  const library = publish(createComponentLibrary({ id: 'library-update', name: 'Update test' })).library;
  const linked = createLinkedInstanceSnapshot(library, 'component-card', { instanceId: 'instance-update' });
  assert.throws(() => updateLinkedInstanceSnapshot(linked, library), /no newer component revision/);
  const otherLibrary = publish(createComponentLibrary({ id: 'other-library', name: 'Other' })).library;
  assert.throws(() => updateLinkedInstanceSnapshot(linked, otherLibrary), /different library/);
  const newer = publishComponent(library, { componentId: 'component-card', name: 'Card', root: cardRoot({ title: 'New' }) }).library;
  const forged = structuredClone(linked);
  forged.sourceSnapshot.root.children[0].text = 'Forged history';
  forged.root.children[0].text = 'Forged history';
  assert.throws(() => updateLinkedInstanceSnapshot(forged, newer), /does not match this library history/);
  assert.throws(() => createLinkedInstanceSnapshot(library, 'missing-component', { instanceId: 'instance-missing' }), /does not exist/);
  assert.throws(() => createLinkedInstanceSnapshot(library, 'component-card', { instanceId: 'instance-bad', overrides: { missing: { fill: '#ffffff' } } }), /missing source layer/);
});
