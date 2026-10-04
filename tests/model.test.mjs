import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, absoluteBounds, applyImageRecipe, applyLayoutGuideStyle, bindVariable, canBindVariable, canCreateMaskGroup, copyLayoutGuide, createComponent, createComponentInstance, createComponentProperty, createDocument, createFillLayer, createGradientFill, createImageRecipe, createLayerEffect, createLayoutGuide, createLayoutGuideStyle, createMaskGroup, createNode, createVariable, createVariableCollection, deleteImageRecipe, duplicateNode, findNode, getNodePropertyValue, MAX_DOCUMENT_NODE_COUNT, MAX_DOCUMENT_TREE_DEPTH, MAX_PAGE_RULER_GUIDES, moveNode, parseDocument, pasteLayoutGuide, removeNode, renameImageRecipe, serializeDocument, setComponentSlotContent, syncComponentInstances, updateImageRecipe, updateNode, validateDocument } from '../src/model.js';
import { createPageNodeIndex } from '../src/page-node-index.js';
import { History } from '../src/history.js';
import { createImageFill } from '../src/image-fills.js';

function relativeLuminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16) / 255);
  const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(first, second) {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('new neutral vector objects stay visible on white artboards and the dark canvas', () => {
  for (const type of ['rectangle', 'ellipse', 'polygon', 'boolean']) {
    const fill = createNode(type).fill;
    assert.match(fill, /^#[0-9a-f]{6}$/i, `${type} should have a valid solid default fill`);
    assert.ok(contrastRatio(fill, '#ffffff') >= 3, `${type} default should contrast with white frames`);
    assert.ok(contrastRatio(fill, '#20232a') >= 3, `${type} default should contrast with the dark work surface`);
  }
});

test('new file has an active page and a valid empty layer tree', () => {
  const document = createDocument();
  assert.equal(document.pages.length, 1);
  assert.equal(document.pages[0].id, document.activePageId);
  assert.deepEqual(document.pages[0].guides, []);
  assert.deepEqual(document.motion, { durationMs: 1000, tracks: [] });
  assert.equal(validateDocument(document), true);
});

test('alpha, vector, and luminance mask modes validate and survive save/reload', () => {
  const document = createDocument();
  const content = createNode('rectangle', { name: 'Content' });
  const lineMask = createNode('line', { name: 'Stroke mask', stroke: '#123456', strokeWidth: 4 });
  addNode(document, content);
  addNode(document, lineMask);
  assert.equal(canCreateMaskGroup(document, [content.id, lineMask.id], document.activePageId, 'vector'), true);
  const group = createMaskGroup(document, [content.id, lineMask.id], document.activePageId, 'vector');
  assert.equal(group.maskMode, 'vector');
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(findNode(reopened, group.id).node.maskMode, 'vector');
  assert.equal(validateDocument(reopened), true);

  const luminanceDocument = createDocument();
  const luminanceContent = createNode('rectangle', { name: 'Luminance content' });
  const luminanceSource = createNode('line', { name: 'Colored luminance stroke', stroke: '#808080', strokeWidth: 4 });
  addNode(luminanceDocument, luminanceContent);
  addNode(luminanceDocument, luminanceSource);
  assert.equal(canCreateMaskGroup(luminanceDocument, [luminanceContent.id, luminanceSource.id], luminanceDocument.activePageId, 'luminance'), true);
  const luminanceGroup = createMaskGroup(luminanceDocument, [luminanceContent.id, luminanceSource.id], luminanceDocument.activePageId, 'luminance');
  const reopenedLuminance = parseDocument(serializeDocument(luminanceDocument));
  assert.equal(findNode(reopenedLuminance, luminanceGroup.id).node.maskMode, 'luminance');
  assert.equal(validateDocument(reopenedLuminance), true);

  const legacyDocument = createDocument();
  const legacyContent = createNode('rectangle');
  const alphaSource = createNode('ellipse');
  addNode(legacyDocument, legacyContent); addNode(legacyDocument, alphaSource);
  const legacyGroup = createMaskGroup(legacyDocument, [legacyContent.id, alphaSource.id]);
  delete legacyGroup.maskMode;
  assert.equal(validateDocument(legacyDocument), true, 'older alpha masks remain valid when mode is omitted');
  assert.equal(parseDocument(serializeDocument(legacyDocument)).pages[0].children[0].maskMode, undefined);

  const unsupportedMode = structuredClone(reopened);
  findNode(unsupportedMode, group.id).node.maskMode = 'unsupported';
  assert.throws(() => validateDocument(unsupportedMode), /Invalid mask mode/);

  const unsupportedSource = createDocument();
  const text = createNode('text', { text: 'Not a vector mask source' });
  const painted = createNode('rectangle');
  addNode(unsupportedSource, painted); addNode(unsupportedSource, text);
  const alphaGroup = createMaskGroup(unsupportedSource, [painted.id, text.id]);
  alphaGroup.maskMode = 'vector';
  assert.throws(() => validateDocument(unsupportedSource), /Invalid mask group/);
});

test('motion tracks persist with a design, validate their layer references, and migrate older files', () => {
  const document = createDocument();
  const node = createNode('rectangle');
  addNode(document, node);
  document.motion.tracks.push({
    id: 'motion-x', nodeId: node.id, property: 'x',
    keyframes: [
      { id: 'motion-x-start', timeMs: 0, value: 0, easing: 'ease-in-out' },
      { id: 'motion-x-end', timeMs: 1000, value: 240, easing: 'linear' }
    ]
  });
  document.motion.tracks.push({
    id: 'motion-width', nodeId: node.id, property: 'width',
    keyframes: [{ id: 'motion-width-start', timeMs: 0, value: 120 }, { id: 'motion-width-end', timeMs: 1000, value: 240 }]
  });
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.motion, document.motion);
  assert.equal(validateDocument(reopened), true);

  const legacy = structuredClone(document);
  delete legacy.motion;
  assert.deepEqual(parseDocument(legacy).motion, { durationMs: 1000, tracks: [] });

  const missingTarget = structuredClone(document);
  missingTarget.motion.tracks[0].nodeId = 'deleted-layer';
  assert.throws(() => validateDocument(missingTarget), /motion document: track references missing node/);
  const duplicateTarget = structuredClone(document);
  duplicateTarget.motion.tracks.push({ ...structuredClone(duplicateTarget.motion.tracks[0]), id: 'motion-x-copy' });
  assert.throws(() => validateDocument(duplicateTarget), /node\/property pair can have only one track/);
});

test('removing a layer also removes motion tracks for the layer and its descendants', () => {
  const document = createDocument();
  const group = createNode('group');
  const child = createNode('rectangle');
  group.children.push(child);
  addNode(document, group);
  document.motion.tracks.push(
    { id: 'motion-parent', nodeId: group.id, property: 'x', keyframes: [] },
    { id: 'motion-child', nodeId: child.id, property: 'opacity', keyframes: [] }
  );
  removeNode(document, group.id);
  assert.deepEqual(document.motion.tracks, []);
  assert.equal(validateDocument(document), true);
});

test('page ruler guides validate, persist, and remain optional for legacy pages', () => {
  const document = createDocument();
  document.pages[0].guides = [
    { id: 'guide-x', axis: 'x', position: -1_000_000_000 },
    { id: 'guide-y', axis: 'y', position: 24.5 }
  ];
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].guides, document.pages[0].guides);
  assert.equal(validateDocument(reopened), true);

  const legacy = structuredClone(document);
  delete legacy.pages[0].guides;
  assert.equal(validateDocument(legacy), true, 'older pages without ruler guides remain valid');
  assert.equal(validateDocument(parseDocument(serializeDocument(legacy))), true);
});

test('page ruler guides reject malformed records, duplicate ids, invalid coordinates, and excess entries', () => {
  const invalidCases = [
    ['not a list', null],
    ['empty id', [{ id: ' ', axis: 'x', position: 1 }]],
    ['unsupported field', [{ id: 'guide', axis: 'x', position: 1, color: '#ff0000' }]],
    ['duplicate id', [{ id: 'same', axis: 'x', position: 1 }, { id: 'same', axis: 'y', position: 2 }]],
    ['unsupported axis', [{ id: 'guide', axis: 'z', position: 1 }]],
    ['non-finite coordinate', [{ id: 'guide', axis: 'x', position: Infinity }]],
    ['coordinate beyond the supported bound', [{ id: 'guide', axis: 'y', position: 1_000_000_001 }]],
    ['too many guides', Array.from({ length: MAX_PAGE_RULER_GUIDES + 1 }, (_, index) => ({ id: `guide-${index}`, axis: 'x', position: index }))]
  ];
  for (const [label, guides] of invalidCases) {
    const document = createDocument();
    document.pages[0].guides = guides;
    assert.throws(() => validateDocument(document), /Invalid ruler guides/, label);
  }
});

test('layout guide copy/paste clones one guide, assigns frame-local IDs, and detaches only pasted frames', () => {
  const document = createDocument();
  const sourceGuide = createLayoutGuide('columns', {
    id: 'source-columns', visible: false, color: '#123456', opacity: 0.65,
    count: 3, alignment: 'stretch', gutter: 12.5, margin: 18
  });
  const source = createNode('frame', { name: 'Source', layoutGuides: [sourceGuide] });
  const target = createNode('frame', { name: 'Target' });
  const linkedPeer = createNode('frame', { name: 'Linked peer' });
  addNode(document, source); addNode(document, target); addNode(document, linkedPeer);
  const style = createLayoutGuideStyle(document, source.id, 'Columns');
  assert.equal(applyLayoutGuideStyle(document, target.id, style.id), true);
  assert.equal(applyLayoutGuideStyle(document, linkedPeer.id, style.id), true);

  const clipboard = copyLayoutGuide(document, source.id, sourceGuide.id);
  const original = structuredClone(document);
  const result = pasteLayoutGuide(document, clipboard, [target.id]);
  const updatedTarget = findNode(result.document, target.id).node;
  const pastedGuide = updatedTarget.layoutGuides.at(-1);

  assert.deepEqual(clipboard.guide, sourceGuide);
  assert.equal(pastedGuide.id === sourceGuide.id, false);
  assert.equal(pastedGuide.id === target.layoutGuides[0].id, false);
  assert.deepEqual({ ...pastedGuide, id: sourceGuide.id }, sourceGuide);
  assert.equal(updatedTarget.layoutGuides.length, 2);
  assert.equal(updatedTarget.layoutGuideStyleId, undefined);
  assert.equal(findNode(result.document, linkedPeer.id).node.layoutGuideStyleId, style.id);
  assert.deepEqual(document, original, 'pasting must leave the input document unchanged');
  assert.equal(validateDocument(result.document), true);
});

test('layout guide paste validates its clipboard and applies atomically at the per-frame guide limit', () => {
  const document = createDocument();
  const source = createNode('frame', { layoutGuides: [createLayoutGuide('grid', { id: 'copy-grid' })] });
  const full = createNode('frame', {
    layoutGuides: Array.from({ length: 32 }, (_, index) => createLayoutGuide('grid', { id: `full-grid-${index}` }))
  });
  const other = createNode('frame');
  addNode(document, source); addNode(document, full); addNode(document, other);
  const clipboard = copyLayoutGuide(document, source.id, 'copy-grid');
  const before = structuredClone(document);

  assert.throws(() => pasteLayoutGuide(document, clipboard, [other.id, full.id]), /up to 32 layout guides/);
  assert.deepEqual(document, before, 'a rejected multi-frame paste must not partially update any target');
  assert.throws(() => pasteLayoutGuide(document, { ...clipboard, version: 2 }, [other.id]), /copied layout guide is invalid/);
  assert.throws(() => pasteLayoutGuide(document, clipboard, [source.id, 'missing-frame']), /only be pasted onto frames/);
});

test('slice export regions stay top-level, positive-size, unrotated, and survive round-trip', () => {
  const document = createDocument();
  const slice = createNode('slice', { name: 'Social crop', x: -20, y: 14, width: 320, height: 180 });
  slice.exportSettings = [{ id: 'slice-export', format: 'webp', scale: 2, suffix: '@2x', quality: 82, padding: 6 }];
  addNode(document, slice);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(findNode(reopened, slice.id).node.exportSettings, slice.exportSettings);
  assert.equal(validateDocument(reopened), true);

  const rotated = structuredClone(reopened);
  findNode(rotated, slice.id).node.rotation = 1;
  assert.throws(() => validateDocument(rotated), /positive-size, unrotated, top-level export regions/);
  const withChildren = structuredClone(reopened);
  findNode(withChildren, slice.id).node.children.push(createNode('rectangle'));
  assert.throws(() => validateDocument(withChildren), /without children or components/);
  const zeroSized = structuredClone(reopened);
  findNode(zeroSized, slice.id).node.width = 0;
  assert.throws(() => validateDocument(zeroSized), /positive-size, unrotated, top-level export regions/);
  const badPadding = structuredClone(reopened);
  findNode(badPadding, slice.id).node.exportSettings[0].padding = 1.5;
  assert.throws(() => validateDocument(badPadding), /Invalid export settings/);

  const frame = createNode('frame');
  addNode(document, frame);
  assert.throws(() => addNode(document, createNode('slice'), { parentId: frame.id }), /top-level export regions/);
  const collection = createVariableCollection(document, 'Slice geometry');
  const variable = createVariable(document, collection.id, 'Slice X', 'number', 24);
  assert.equal(canBindVariable(document, slice.id, variable.id, 'x'), false);
  assert.equal(bindVariable(document, slice.id, variable.id, 'x'), false);
  const boundGeometry = structuredClone(reopened);
  findNode(boundGeometry, slice.id).node.variableBindings = { x: variable.id };
  boundGeometry.variableCollections = structuredClone(document.variableCollections);
  boundGeometry.variables = structuredClone(document.variables);
  assert.throws(() => validateDocument(boundGeometry), /Invalid x variable binding/);
});

test('slice regions stay outside component source and slot trees through model APIs', () => {
  const document = createDocument();
  const frame = createNode('frame');
  const slice = createNode('slice');
  addNode(document, frame);
  addNode(document, slice);
  assert.throws(() => moveNode(document, slice.id, { parentId: frame.id }), /top-level export regions/);
  assert.equal(findNode(document, slice.id).parent, null);
  assert.throws(() => updateNode(document, slice.id, node => { node.rotation = 24; return {}; }), /top-level export regions/);
  assert.equal(findNode(document, slice.id).node.rotation, 0, 'a rejected in-place patch restores the valid slice');
  assert.throws(() => createComponent(document, slice.id), /Slices cannot be used as component sources/);
  assert.equal(document.components.length, 0);
  assert.throws(() => addNode(document, createNode('group', { children: [createNode('slice')] })), /top-level export regions/);
  assert.throws(() => updateNode(document, frame.id, { children: [createNode('slice')] }), /top-level export regions/);

  const componentDocument = createDocument();
  const master = createNode('frame');
  const slotSource = createNode('group');
  addNode(componentDocument, master);
  addNode(componentDocument, slotSource, { parentId: master.id });
  const component = createComponent(componentDocument, master.id);
  const slot = createComponentProperty(componentDocument, component.id, {
    name: 'Content', type: 'SLOT', targetNodeId: slotSource.id
  });
  const instance = createComponentInstance(componentDocument, component.id);
  const slotContentSlice = createNode('slice');
  addNode(componentDocument, slotContentSlice);
  assert.throws(() => setComponentSlotContent(componentDocument, instance.id, slot.id, [slotContentSlice]), /slice cannot be inserted as component slot content/);
  assert.equal(findNode(componentDocument, slotContentSlice.id).parent, null,
    'a rejected slot write leaves the original top-level slice untouched');
  assert.throws(() => updateNode(componentDocument, slotSource.id, { children: [createNode('slice')] }), /top-level export regions/);

  // Guard the property-creation API too when it receives an already-corrupt
  // source tree, such as a document mutated outside the normal model methods.
  slotSource.children.push(createNode('slice'));
  assert.throws(() => createComponentProperty(componentDocument, component.id, {
    name: 'Invalid source', type: 'SLOT', targetNodeId: slotSource.id
  }), /slot source cannot contain slices/);
});

test('auto-layout absolute positioning round-trips and is limited to direct layout children', () => {
  const document = createDocument();
  const layout = createNode('frame', { autoLayout: { axis: 'horizontal' }, width: 320, height: 120 });
  const positioned = createNode('rectangle', { layoutPositioning: 'absolute' });
  const defaultPositioning = createNode('rectangle', { layoutPositioning: 'auto' });
  addNode(document, layout);
  addNode(document, positioned, { parentId: layout.id });
  addNode(document, defaultPositioning);

  const reopened = parseDocument(serializeDocument(document));
  assert.equal(findNode(reopened, positioned.id).node.layoutPositioning, 'absolute');
  assert.equal(findNode(reopened, defaultPositioning.id).node.layoutPositioning, 'auto');
  assert.equal(validateDocument(reopened), true);

  const unsupported = structuredClone(reopened);
  findNode(unsupported, positioned.id).node.layoutPositioning = 'overlay';
  assert.throws(() => validateDocument(unsupported), /Invalid layout positioning/);

  const rootAbsolute = createDocument();
  addNode(rootAbsolute, createNode('rectangle', { layoutPositioning: 'absolute' }));
  assert.throws(() => validateDocument(rootAbsolute), /Invalid layout positioning/);

  const nestedAbsolute = createDocument();
  const outerLayout = createNode('frame', { autoLayout: { axis: 'horizontal' } });
  const innerGroup = createNode('group');
  const nestedChild = createNode('rectangle', { layoutPositioning: 'absolute' });
  addNode(nestedAbsolute, outerLayout);
  addNode(nestedAbsolute, innerGroup, { parentId: outerLayout.id });
  addNode(nestedAbsolute, nestedChild, { parentId: innerGroup.id });
  assert.throws(() => validateDocument(nestedAbsolute), /Invalid layout positioning/,
    'an auto-layout ancestor does not make a deeper descendant an absolute layout child');
});

test('component layout-positioning overrides round-trip and validate supported values', () => {
  const document = createDocument();
  const master = createNode('frame', { autoLayout: { axis: 'vertical' } });
  const child = createNode('rectangle');
  addNode(document, master);
  addNode(document, child, { parentId: master.id });
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  instanceNode.componentOverrides[child.id] = { layoutPositioning: 'absolute' };
  syncComponentInstances(document, component.id);

  assert.equal(findNode(document, instance.id).node.children[0].layoutPositioning, 'absolute');
  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(findNode(reopened, instance.id).node.componentOverrides[child.id], { layoutPositioning: 'absolute' });
  assert.equal(findNode(reopened, instance.id).node.children[0].layoutPositioning, 'absolute');

  const unsupported = structuredClone(reopened);
  findNode(unsupported, instance.id).node.componentOverrides[child.id].layoutPositioning = 'fixed';
  assert.throws(() => validateDocument(unsupported), /Invalid component layout positioning override/);

  const outsideAutoLayout = createDocument();
  const plainMaster = createNode('frame');
  const plainChild = createNode('rectangle');
  addNode(outsideAutoLayout, plainMaster);
  addNode(outsideAutoLayout, plainChild, { parentId: plainMaster.id });
  const plainComponent = createComponent(outsideAutoLayout, plainMaster.id);
  const plainInstance = createComponentInstance(outsideAutoLayout, plainComponent.id);
  const plainInstanceNode = findNode(outsideAutoLayout, plainInstance.id).node;
  const plainSourceId = plainInstanceNode.children[0].componentSourceId;
  plainInstanceNode.componentOverrides[plainSourceId] = { layoutPositioning: 'absolute' };
  assert.throws(() => validateDocument(outsideAutoLayout), /Invalid component layout positioning override/,
    'absolute override is invalid when the source layer is not a direct child of auto layout');
});

test('paragraph spacing and first-line indentation validate and survive local serialization', () => {
  const document = createDocument();
  const text = createNode('text', { text: 'First\nSecond', paragraphSpacing: 8, firstLineIndent: 14 });
  addNode(document, text);

  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.pages[0].children[0].paragraphSpacing, 8);
  assert.equal(restored.pages[0].children[0].firstLineIndent, 14);
  assert.equal(validateDocument(restored), true);

  for (const property of ['paragraphSpacing', 'firstLineIndent']) {
    for (const invalid of [-1, 10_001, Infinity]) {
      const candidate = structuredClone(restored);
      candidate.pages[0].children[0][property] = invalid;
      assert.throws(() => validateDocument(candidate), /Invalid paragraph typography/);
    }
  }

  const wrongLayer = createNode('rectangle', { paragraphSpacing: 1 });
  addNode(document, wrongLayer);
  assert.throws(() => validateDocument(document), /Invalid paragraph typography/);
});

test('text truncation fields validate, persist, and stay independent from generic auto-layout size limits', () => {
  const document = createDocument();
  const layout = createNode('frame', { autoLayout: { axis: 'vertical' } });
  const text = createNode('text', { text: 'One\nTwo\nThree', textTruncation: 'ending', maxLines: 2 });
  const boundedText = createNode('text', { text: 'Bounded by layout', maxHeight: 72 });
  addNode(document, layout);
  addNode(document, text, { parentId: layout.id });
  addNode(document, boundedText, { parentId: layout.id });

  const restored = parseDocument(serializeDocument(document));
  assert.equal(findNode(restored, text.id).node.textTruncation, 'ending');
  assert.equal(findNode(restored, text.id).node.maxLines, 2);
  assert.equal(findNode(restored, boundedText.id).node.maxHeight, 72,
    'the existing generic auto-layout maximum-height behavior remains valid for text');
  assert.equal(validateDocument(restored), true);

  const invalid = [
    ['unknown truncation mode', node => { node.textTruncation = 'middle'; }],
    ['null truncation mode', node => { node.textTruncation = null; }],
    ['zero max lines', node => { node.textTruncation = 'ending'; node.maxLines = 0; }],
    ['fractional max lines', node => { node.textTruncation = 'ending'; node.maxLines = 1.5; }],
    ['max lines without ending truncation', node => { node.textTruncation = 'disabled'; node.maxLines = 2; }],
    ['max lines with maximum height', node => { node.textTruncation = 'ending'; node.maxLines = 2; node.maxHeight = 72; }]
  ];
  for (const [label, mutate] of invalid) {
    const candidate = structuredClone(restored);
    const target = findNode(candidate, text.id).node;
    mutate(target);
    assert.throws(() => validateDocument(candidate), /text (?:maximum|truncation)|geometry or type/i, label);
  }

  const nonTextDocument = createDocument();
  addNode(nonTextDocument, createNode('rectangle', { textTruncation: 'ending' }));
  assert.throws(() => validateDocument(nonTextDocument), /Invalid text truncation mode/);
});

test('component text truncation and max-line overrides are type-checked and round-trip', () => {
  const document = createDocument();
  const master = createNode('frame');
  const sourceText = createNode('text', { text: 'Master text' });
  addNode(document, master);
  addNode(document, sourceText, { parentId: master.id });
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  instanceNode.componentOverrides[sourceText.id] = { textTruncation: 'ending', maxLines: 3 };
  syncComponentInstances(document, component.id);

  assert.equal(instanceNode.children[0].textTruncation, 'ending');
  assert.equal(instanceNode.children[0].maxLines, 3);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const invalidMode = structuredClone(document);
  findNode(invalidMode, instance.id).node.componentOverrides[sourceText.id].textTruncation = 'fade';
  assert.throws(() => validateDocument(invalidMode), /component text truncation override/);

  const invalidType = structuredClone(document);
  const rectangle = createNode('rectangle');
  addNode(invalidType, rectangle);
  const rectangleComponent = createComponent(invalidType, rectangle.id);
  const rectangleInstance = createComponentInstance(invalidType, rectangleComponent.id);
  const rectangleSourceId = findNode(invalidType, rectangleInstance.id).node.componentSourceId;
  findNode(invalidType, rectangleInstance.id).node.componentOverrides[rectangleSourceId] = { maxLines: 2 };
  assert.throws(() => validateDocument(invalidType), /component text maximum line count override/);

  const invalidCombination = structuredClone(document);
  findNode(invalidCombination, instance.id).node.componentOverrides[sourceText.id].maxHeight = 72;
  assert.throws(() => validateDocument(invalidCombination), /component text maximum lines.*maxHeight/i);
});

test('bulleted and numbered paragraph metadata round-trips, stays independent of rich runs, and has bounded validation', () => {
  const document = createDocument();
  const text = createNode('text', {
    text: 'Plan\nBuild\nShip',
    textRuns: [{ text: 'Plan', fontWeight: 700 }, { text: '\nBuild\nShip', fontStyle: 'italic' }],
    paragraphStyles: [
      { listStyle: 'numbered', listLevel: 0, listStart: 4, align: 'center' },
      { listStyle: 'bulleted', listLevel: 1, align: 'right' },
      { listStyle: 'numbered', listLevel: 0, align: 'justify' }
    ],
    paragraphSpacing: 12,
    listSpacing: 5
  });
  addNode(document, text);

  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[0].paragraphStyles, text.paragraphStyles);
  assert.deepEqual(reopened.pages[0].children[0].textRuns, text.textRuns);
  assert.equal(reopened.pages[0].children[0].paragraphSpacing, 12);
  assert.equal(reopened.pages[0].children[0].listSpacing, 5);
  assert.equal(validateDocument(reopened), true);

  const oldDocument = createDocument();
  addNode(oldDocument, createNode('text', { text: 'Legacy\nparagraphs' }));
  assert.equal(validateDocument(parseDocument(serializeDocument(oldDocument))), true,
    'older text layers without paragraph metadata remain valid');

  const nonText = createDocument();
  addNode(nonText, createNode('rectangle', { paragraphStyles: [{ listStyle: 'bulleted', listLevel: 0 }] }));
  assert.throws(() => validateDocument(nonText), /Invalid text paragraph styles/);
  const nonTextSpacing = createDocument();
  addNode(nonTextSpacing, createNode('rectangle', { listSpacing: 1 }));
  assert.throws(() => validateDocument(nonTextSpacing), /Invalid list spacing/);

  for (const [label, mutate] of [
    ['wrong paragraph count', node => { node.paragraphStyles.pop(); }],
    ['unsupported list style', node => { node.paragraphStyles[0].listStyle = 'checklist'; }],
    ['depth beyond five levels', node => { node.paragraphStyles[1].listLevel = 5; }],
    ['fractional depth', node => { node.paragraphStyles[1].listLevel = 1.5; }],
    ['start on a bullet', node => { node.paragraphStyles[1].listStart = 2; }],
    ['zero start', node => { node.paragraphStyles[0].listStart = 0; }],
    ['unsupported paragraph alignment', node => { node.paragraphStyles[1].align = 'middle'; }],
    ['unknown paragraph property', node => { node.paragraphStyles[1].counterFormat = 'roman'; }]
  ]) {
    const invalid = structuredClone(reopened);
    mutate(invalid.pages[0].children[0]);
    assert.throws(() => validateDocument(invalid), /Invalid text paragraph styles/, label);
  }

  for (const invalidSpacing of [-1, 10_001, Infinity]) {
    const invalid = structuredClone(reopened);
    invalid.pages[0].children[0].listSpacing = invalidSpacing;
    assert.throws(() => validateDocument(invalid), /Invalid list spacing/);
  }
});

test('text alignment accepts justified paragraphs, round-trips, and rejects unsupported values', () => {
  const document = createDocument();
  const text = createNode('text', { align: 'justify' });
  addNode(document, text);
  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.pages[0].children[0].align, 'justify');
  assert.equal(validateDocument(restored), true);

  const unsupported = structuredClone(restored);
  unsupported.pages[0].children[0].align = 'distributed';
  assert.throws(() => validateDocument(unsupported), /Invalid text alignment/);
  const wrongLayer = structuredClone(restored);
  wrongLayer.pages[0].children[0] = createNode('rectangle', { align: 'justify' });
  assert.throws(() => validateDocument(wrongLayer), /Invalid text alignment/);
});

test('editable polygon and star geometry persists and rejects invalid shape values', () => {
  const document = createDocument();
  const polygon = createNode('polygon', { points: 9 });
  const star = createNode('star', { points: 8, innerRadius: .23 });
  addNode(document, polygon); addNode(document, star);

  const reopened = parseDocument(serializeDocument(document));
  assert.equal(reopened.pages[0].children[0].points, 9);
  assert.equal(reopened.pages[0].children[1].points, 8);
  assert.equal(reopened.pages[0].children[1].innerRadius, .23);

  const zeroRadius = structuredClone(reopened);
  zeroRadius.pages[0].children[1].innerRadius = 0;
  assert.equal(validateDocument(zeroRadius), true);
  assert.equal(parseDocument(serializeDocument(zeroRadius)).pages[0].children[1].innerRadius, 0);

  const maximumStar = structuredClone(reopened);
  maximumStar.pages[0].children[1].points = 60;
  assert.equal(validateDocument(maximumStar), true, 'stars support the Figma-compatible maximum of 60 outer points');

  for (const [nodeIndex, property, invalid] of [
    [0, 'points', 2], [0, 'points', 33], [1, 'points', 2], [1, 'points', 61], [1, 'points', Infinity],
    [1, 'innerRadius', -0.01], [1, 'innerRadius', 1.01]
  ]) {
    const candidate = structuredClone(reopened);
    candidate.pages[0].children[nodeIndex][property] = invalid;
    assert.throws(() => validateDocument(candidate), property === 'innerRadius' ? /Invalid star inner radius/ : /Invalid shape point count/);
  }

  const wrongShapeProperty = structuredClone(reopened);
  wrongShapeProperty.pages[0].children[0].innerRadius = .5;
  assert.throws(() => validateDocument(wrongShapeProperty), /Star inner radius is only supported on star layers/);
});

test('vector path anchor modes are restricted to supported persisted values', () => {
  const document = createDocument();
  const path = createNode('path', { points: [
    { x: 0, y: 0, mode: 'smooth' },
    { x: 1, y: 1, mode: 'symmetric' }
  ] });
  addNode(document, path);
  assert.equal(validateDocument(document), true);
  for (const mode of ['automatic', '']) {
    const invalid = structuredClone(document);
    invalid.pages[0].children[0].points[0].mode = mode;
    assert.throws(() => validateDocument(invalid), /Invalid vector path/);
  }
});

test('vector-network vertex corner radii persist, validate, and propagate as component geometry overrides', () => {
  const document = createDocument();
  const network = createNode('network', {
    name: 'Rounded network', width: 100, height: 80,
    vertices: [
      { id: 'a', x: 0, y: 0, cornerRadius: 12.5 },
      { id: 'b', x: 1, y: 0 }, { id: 'c', x: 1, y: 1 }, { id: 'd', x: 0, y: 1 }
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'cd', from: 'c', to: 'd' }, { id: 'da', from: 'd', to: 'a' }],
    faces: [{ id: 'abcd', vertexIds: ['a', 'b', 'c', 'd'] }]
  });
  addNode(document, network);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const component = createComponent(document, network.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[network.id] = { vertices: network.vertices.map(vertex => vertex.id === 'c' ? { ...vertex, cornerRadius: 7 } : { ...vertex }) };
  syncComponentInstances(document, component.id);
  assert.equal(findNode(document, instance.id).node.vertices.find(vertex => vertex.id === 'c').cornerRadius, 7);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  for (const value of [-1, 100_000.01, Infinity, NaN]) {
    const invalid = structuredClone(document);
    findNode(invalid, network.id).node.vertices[0].cornerRadius = value;
    assert.throws(() => validateDocument(invalid), /Invalid vector network/);
  }
  const invalidOverride = structuredClone(document);
  invalidOverride.pages[0].children.find(node => node.id === instance.id).componentOverrides[network.id].vertices[0].cornerRadius = -1;
  assert.throws(() => validateDocument(invalidOverride), /Invalid component vector network geometry override/);
});

test('compound vector paths and fill rules survive local document round trips and reject invalid contours', () => {
  const document = createDocument();
  const path = createNode('path', {
    closed: true,
    fillRule: 'evenodd',
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    subpaths: [{ closed: true, points: [{ x: .25, y: .25 }, { x: .75, y: .25 }, { x: .75, y: .75 }] }]
  });
  addNode(document, path);
  assert.equal(validateDocument(document), true);
  assert.deepEqual(parseDocument(serializeDocument(document)).pages[0].children[0], path);

  const invalidRule = structuredClone(document);
  invalidRule.pages[0].children[0].fillRule = 'inverse';
  assert.throws(() => validateDocument(invalidRule), /Invalid vector path/);
  const invalidContour = structuredClone(document);
  invalidContour.pages[0].children[0].subpaths[0].closed = 'yes';
  assert.throws(() => validateDocument(invalidContour), /Invalid vector path/);
  const tooManyPoints = structuredClone(document);
  tooManyPoints.pages[0].children[0].subpaths[0].points = Array.from({ length: 20_001 }, () => ({ x: 0, y: 0 }));
  assert.throws(() => validateDocument(tooManyPoints), /Invalid vector path/);
});

test('stroke cap, join, and pattern settings persist and reject invalid values', () => {
  const document = createDocument();
  const line = createNode('line', { strokeWidth: 4, strokeCap: 'round', strokeJoin: 'bevel', strokePattern: 'dashed', strokeMiterLimit: 4 });
  addNode(document, line);
  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[0], line);

  for (const [property, invalid] of [['strokeWidth', -1], ['strokeWidth', 100_001], ['strokeCap', 'triangle'], ['strokeJoin', 'chamfer'], ['strokePattern', 'custom'], ['strokeMiterLimit', 0], ['strokeMiterLimit', 1001]]) {
    const candidate = structuredClone(reopened);
    candidate.pages[0].children[0][property] = invalid;
    assert.throws(() => validateDocument(candidate), /Invalid stroke style/);
  }
  const invisibleDots = structuredClone(reopened);
  invisibleDots.pages[0].children[0].strokePattern = 'dotted';
  invisibleDots.pages[0].children[0].strokeCap = 'butt';
  assert.throws(() => validateDocument(invisibleDots), /Invalid stroke style/);
});

test('endpoint decorations persist in stroke stacks and reject unknown decoration values', () => {
  const document = createDocument();
  const line = createNode('line', { strokes: [
    { id: 'decorated-line', color: '#123456', width: 2, opacity: 1, visible: true,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10,
      startDecoration: 'arrow', endDecoration: 'triangle' }
  ] });
  addNode(document, line);
  assert.equal(validateDocument(document), true);
  assert.deepEqual(parseDocument(serializeDocument(document)).pages[0].children[0].strokes, line.strokes);

  for (const [property, invalid] of [['startDecoration', 'circle'], ['endDecoration', 'diamond']]) {
    const candidate = structuredClone(document);
    candidate.pages[0].children[0].strokes[0][property] = invalid;
    assert.throws(() => validateDocument(candidate), /Invalid stroke stack/);
  }

  const oldDocument = structuredClone(document);
  delete oldDocument.pages[0].children[0].strokes[0].startDecoration;
  delete oldDocument.pages[0].children[0].strokes[0].endDecoration;
  assert.equal(validateDocument(oldDocument), true, 'older stroke stacks keep an implicit none state');
});

test('ordered stroke stacks and component overrides persist while legacy scalar strokes remain valid', () => {
  const document = createDocument();
  const master = createNode('frame', { children: [createNode('rectangle', {
    name: 'Outlined card', stroke: '#123456', strokeWidth: 2,
    strokes: [
      { id: 'inner', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 },
      { id: 'outer', color: '#abcdef', width: 8, opacity: .4, visible: true, cap: 'round', join: 'bevel', pattern: 'dashed', miterLimit: 4,
        sideMode: 'custom', sideWidths: { top: 2, right: 0, bottom: 4, left: 1 } }
    ]
  })] });
  addNode(document, master);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  const sourceShape = instanceNode.children[0];
  instanceNode.componentOverrides[sourceShape.componentSourceId] = { strokes: structuredClone(sourceShape.strokes) };
  syncComponentInstances(document, component.id);

  assert.equal(validateDocument(document), true);
  const restored = parseDocument(serializeDocument(document));
  assert.deepEqual(findNode(restored, instance.id).node.children[0].strokes, sourceShape.strokes);
  assert.deepEqual(findNode(restored, instance.id).node.componentOverrides[sourceShape.componentSourceId].strokes, sourceShape.strokes);
  assert.deepEqual(findNode(restored, instance.id).node.children[0].strokes[1].sideWidths,
    { top: 2, right: 0, bottom: 4, left: 1 }, 'individual weights survive component overrides and local save/reload');
  assert.deepEqual(findNode(restored, instance.id).node.children[0].stroke, sourceShape.strokes[0].color,
    'the primary stack entry stays mirrored for old tools');

  const legacy = createDocument();
  const legacyLine = createNode('line', { stroke: '#123456', strokeWidth: 4, strokePattern: 'dotted', strokeCap: 'round' });
  addNode(legacy, legacyLine);
  assert.deepEqual(parseDocument(serializeDocument(legacy)).pages[0].children[0].stroke, '#123456');

  for (const invalid of [
    [{ id: 'duplicate', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 },
      { id: 'duplicate', color: '#abcdef', width: 3, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 }],
    [{ id: 'invalid', color: '#123456', width: -1, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 }],
    [{ id: 'dot', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'dotted', miterLimit: 10 }],
    [{ id: 'bad-sides', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10,
      sideMode: 'custom', sideWidths: { top: 2, right: -1, bottom: 2, left: 2 } }]
  ]) {
    const invalidDocument = createDocument();
    addNode(invalidDocument, createNode('rectangle', { strokes: invalid }));
    assert.throws(() => validateDocument(invalidDocument), /Invalid stroke stack/);
  }
});

test('frames own nested layers and bounds resolve into page coordinates', () => {
  const document = createDocument();
  const frame = createNode('frame', { x: 120, y: 80, width: 400, height: 500 });
  const shape = createNode('rectangle', { x: 24, y: 32, width: 90, height: 60 });
  addNode(document, frame);
  addNode(document, shape, { parentId: frame.id });
  assert.deepEqual(absoluteBounds(document, shape.id), { x: 144, y: 112, width: 90, height: 60 });
  assert.equal(findNode(document, shape.id).parents[0].id, frame.id);
});

test('node edits, duplication and removal preserve independent identities', () => {
  const document = createDocument();
  const shape = createNode('ellipse', { x: 5, y: 6 }); addNode(document, shape);
  updateNode(document, shape.id, { x: 14, opacity: .5 });
  const copy = duplicateNode(document, shape.id);
  assert.notEqual(copy.id, shape.id);
  assert.equal(copy.x, 30);
  assert.equal(copy.opacity, .5);
  removeNode(document, shape.id);
  assert.equal(findNode(document, shape.id), null);
  assert.equal(findNode(document, copy.id).node.id, copy.id);
});

test('image recipes snapshot adjustments and apply to another source layer', () => {
  const document = createDocument();
  const opacityCollection = createVariableCollection(document, 'Image opacity');
  const sourceOpacity = createVariable(document, opacityCollection.id, 'Source opacity', 'number', 0.37);
  const targetOpacity = createVariable(document, opacityCollection.id, 'Target opacity', 'number', 0.82);
  const targetX = createVariable(document, opacityCollection.id, 'Target position', 'number', 24);
  const source = createNode('image', {
    assetId: 'asset-a', adjustments: { exposure: 28, temperature: -20, tint: 15, brightness: -12, contrast: 25, highlights: 42, shadows: -18, saturation: 7, sharpness: 41, blur: 2, autoContrast: true, posterizeBits: 4, solarize: true, solarizeThreshold: 96, invert: true },
    transforms: { crop: { left: 0.1, top: 0.2, right: 0.85, bottom: 0.9 }, rotation: 270, flipHorizontal: true },
    opacity: 0.91, outputFormat: 'webp', outputQuality: 74, blendMode: 'multiply',
    effects: [createLayerEffect('drop-shadow', { blendMode: 'screen', color: '#336699', opacity: 0.4, offsetX: 5, blur: 12 })],
  });
  const target = createNode('image', {
    assetId: 'asset-b', opacity: 0.61, blendMode: 'screen',
    effects: [createLayerEffect('layer-blur', { radius: 8 })]
  });
  addNode(document, source); addNode(document, target);
  assert.equal(bindVariable(document, source.id, sourceOpacity.id, 'opacity'), true);
  assert.equal(bindVariable(document, target.id, targetOpacity.id, 'opacity'), true);
  assert.equal(bindVariable(document, target.id, targetX.id, 'x'), true);
  const recipe = createImageRecipe(source, 'Warm dusk', {}, document);
  document.recipes.push(recipe);
  source.adjustments.brightness = 0;
  source.transforms.crop.left = 0.4;
  target.transforms = { crop: { left: 0, top: 0, right: 0.5, bottom: 0.5 }, rotation: 90 };
  const indexedTarget = createPageNodeIndex(document, document.activePageId).find(target.id);
  assert.equal(applyImageRecipe(document, target.id, recipe, document.activePageId, { targetEntry: indexedTarget }), true,
    'bulk callers can apply the already-indexed current target without a full tree lookup');
  assert.deepEqual(target.adjustments, { exposure: 28, temperature: -20, tint: 15, brightness: -12, contrast: 25, highlights: 42, shadows: -18, saturation: 7, sharpness: 41, blur: 2, autoContrast: true, posterizeBits: 4, solarize: true, solarizeThreshold: 96, invert: true });
  assert.deepEqual(recipe.transforms, { crop: { left: 0.1, top: 0.2, right: 0.85, bottom: 0.9 }, rotation: 270, flipHorizontal: true, flipVertical: false });
  assert.deepEqual([recipe.format, recipe.quality], ['webp', 74]);
  assert.equal(recipe.opacity, 0.37, 'bound opacity snapshots the source node’s visible, mode-resolved value');
  assert.equal(recipe.blendMode, 'multiply');
  assert.deepEqual(recipe.effects, source.effects, 'recipes retain the full ordered editable effect stack');
  assert.equal(recipe.effects[0].blendMode, 'screen', 'image recipes retain the individual effect blend mode');
  assert.deepEqual(target.transforms, recipe.transforms, 'applying a recipe restores its crop, rotation, and flip');
  assert.deepEqual([target.outputFormat, target.outputQuality], ['webp', 74], 'recipe output format and quality follow the image layer');
  assert.equal(target.opacity, 0.37);
  assert.equal(target.variableBindings?.opacity, undefined, 'applying the saved visible opacity detaches only the target opacity binding');
  assert.equal(target.variableBindings?.x, targetX.id, 'unrelated variable bindings remain intact');
  assert.equal(getNodePropertyValue(document, target, 'opacity'), 0.37, 'the copied opacity stays visually stable if its former variable changes');
  assert.equal(target.blendMode, 'multiply');
  assert.deepEqual(target.effects.map(({ id, ...effect }) => effect), recipe.effects.map(({ id, ...effect }) => effect));
  assert.notEqual(target.effects[0].id, recipe.effects[0].id, 'each application receives fresh per-layer effect identities');
  assert.equal(target.assetId, 'asset-b');
  assert.equal(target.backgroundRemoved, false, 'the saved operation state is applied without replacing the target source asset');

  const reopened = parseDocument(serializeDocument(document));
  const savedRecipe = reopened.recipes[0];
  assert.deepEqual(savedRecipe.adjustments, { exposure: 28, temperature: -20, tint: 15, brightness: -12, contrast: 25, highlights: 42, shadows: -18, saturation: 7, sharpness: 41, blur: 2, autoContrast: true, posterizeBits: 4, solarize: true, solarizeThreshold: 96, invert: true });
  assert.deepEqual([savedRecipe.format, savedRecipe.quality], ['webp', 74], 'output settings persist with the recipe');
  assert.deepEqual(savedRecipe.effects, recipe.effects, 'layer effects persist with a serialized recipe');
  assert.equal(savedRecipe.blendMode, 'multiply');
  assert.equal(savedRecipe.opacity, 0.37);
  const reopenedTarget = findNode(reopened, target.id).node;
  assert.equal(applyImageRecipe(reopened, reopenedTarget.id, savedRecipe), true);
  assert.deepEqual(reopenedTarget.adjustments, savedRecipe.adjustments, 'creative tone controls round-trip and apply to another source');
});

test('image recipes persist and apply Tile scale without changing their target source pixels', () => {
  const document = createDocument();
  const source = createNode('image', {
    assetId: 'tile-source', fit: 'tile', scalingFactor: 0.375,
    transforms: { crop: { left: 0.2, top: 0.1, right: 0.9, bottom: 0.95 }, rotation: 90, flipVertical: true }
  });
  const target = createNode('image', { assetId: 'tile-target', fit: 'cover', scalingFactor: 1.25 });
  addNode(document, source);
  addNode(document, target);
  const recipe = createImageRecipe(source, 'Repeating texture');
  document.recipes.push(recipe);

  assert.equal(recipe.fit, 'tile');
  assert.equal(recipe.scalingFactor, 0.375);
  assert.equal(applyImageRecipe(document, target.id, recipe), true);
  assert.deepEqual([target.assetId, target.fit, target.scalingFactor], ['tile-target', 'tile', 0.375]);
  assert.deepEqual(target.transforms, source.transforms, 'the recipe keeps rotation and flips while preserving source-relative crop metadata');

  const reopened = parseDocument(serializeDocument(document));
  assert.equal(reopened.recipes[0].scalingFactor, 0.375);
  assert.deepEqual([findNode(reopened, target.id).node.fit, findNode(reopened, target.id).node.scalingFactor], ['tile', 0.375]);
  for (const scalingFactor of [0, 16.01, Number.NaN]) {
    assert.throws(() => applyImageRecipe(reopened, target.id, { ...recipe, scalingFactor }), /tile scale/);
  }
});

test('an indexed recipe target from another document is rejected even when page and layer ids match', () => {
  const document = createDocument();
  const foreignDocument = createDocument();
  const pageId = 'shared-page-id';
  const nodeId = 'shared-image-id';
  for (const candidate of [document, foreignDocument]) {
    candidate.pages[0].id = pageId;
    candidate.activePageId = pageId;
    const image = createNode('image', { assetId: `asset-${candidate.id}`, x: 10 });
    image.id = nodeId;
    addNode(candidate, image, { pageId });
  }
  const foreignImage = findNode(foreignDocument, nodeId, pageId).node;
  const recipe = createImageRecipe(foreignImage, 'Foreign recipe');
  const foreignEntry = createPageNodeIndex(foreignDocument, pageId, { nodeIds: [nodeId] }).find(nodeId);
  const originalX = findNode(document, nodeId, pageId).node.x;

  assert.equal(applyImageRecipe(document, nodeId, recipe, pageId, { targetEntry: foreignEntry }), false,
    'matching IDs and a valid foreign location must not authorize a mutation');
  assert.equal(findNode(document, nodeId, pageId).node.x, originalX, 'the receiving document remains unchanged');
});

test('background-removal recipe snapshots an operation and lets batch code defer its asynchronous asset switch', () => {
  const document = createDocument();
  const source = createNode('image', {
    assetId: 'transparent-source', backgroundRemoved: true,
    backgroundRemovalSourceAssetId: 'source-original', backgroundRemovalAssetId: 'transparent-source',
  });
  const target = createNode('image', { assetId: 'target-original' });
  addNode(document, source); addNode(document, target);
  const recipe = createImageRecipe(source, 'Subject cutout');
  assert.equal(recipe.backgroundRemoved, true);
  document.recipes.push(recipe);
  const reopened = parseDocument(serializeDocument(document));
  const savedRecipe = reopened.recipes[0];
  assert.equal(savedRecipe.backgroundRemoved, true, 'the recipe persists the requested operation');
  const reopenedTarget = findNode(reopened, target.id).node;
  assert.equal(applyImageRecipe(reopened, reopenedTarget.id, savedRecipe, reopened.activePageId, { deferBackgroundRemoval: true }), true);
  assert.equal(reopenedTarget.assetId, 'target-original', 'applying ordinary recipe settings never copies the recipe source pixels');
  assert.equal(reopenedTarget.backgroundRemoved, undefined, 'the batch can await target-specific local inference before marking success');
  assert.equal(applyImageRecipe(reopened, reopenedTarget.id, savedRecipe), true);
  assert.equal(reopenedTarget.backgroundRemoved, true, 'non-batch callers can still apply the operation state directly');
});

test('resolution-boost recipes persist the operation and defer target-local 4× asset generation', () => {
  const document = createDocument();
  const source = createNode('image', {
    assetId: 'boost-source-4x', resolutionBoosted: true,
    resolutionBoostSourceAssetId: 'boost-source', resolutionBoostAssetId: 'boost-source-4x',
    sourceWidth: 2048, sourceHeight: 1024,
  });
  const target = createNode('image', { assetId: 'target-original', sourceWidth: 100, sourceHeight: 80 });
  addNode(document, source); addNode(document, target);

  const recipe = createImageRecipe(source, 'Sharper export');
  assert.equal(recipe.resolutionBoosted, true);
  document.recipes.push(recipe);
  const reopened = parseDocument(serializeDocument(document));
  const savedRecipe = reopened.recipes[0];
  assert.equal(savedRecipe.resolutionBoosted, true);
  assert.equal(validateDocument(reopened), true);

  const reopenedTarget = findNode(reopened, target.id).node;
  assert.equal(applyImageRecipe(reopened, reopenedTarget.id, savedRecipe, reopened.activePageId, {
    deferResolutionBoost: true,
  }), true);
  assert.equal(reopenedTarget.assetId, 'target-original', 'the recipe never copies the source image pixels');
  assert.equal(reopenedTarget.resolutionBoosted, undefined, 'bulk code awaits target-specific model inference');
  assert.equal(applyImageRecipe(reopened, reopenedTarget.id, savedRecipe), true);
  assert.equal(reopenedTarget.resolutionBoosted, true, 'non-batch callers can apply the operation flag directly');

  for (const invalid of [null, 'yes', 1]) {
    assert.throws(() => applyImageRecipe(reopened, target.id, { ...savedRecipe, resolutionBoosted: invalid }), /resolution boost/);
  }
  const corrupted = structuredClone(reopened);
  findNode(corrupted, target.id).node.resolutionBoosted = 'yes';
  assert.throws(() => validateDocument(corrupted), /resolution-boost setting/);
});

test('expanded-image recipes store source-relative settings and defer target-specific pixel generation', () => {
  const document = createDocument();
  const source = createNode('image', {
    assetId: 'expanded-source-output', sourceWidth: 125, sourceHeight: 66,
    x: -12.5, y: 8.25, width: 250, height: 132,
    inpaintStrokes: [{ radius: 0.02, points: [{ x: 0.4, y: 0.5 }] }],
    imageExpansion: {
      sourceImageAssetId: 'expanded-source-original', sourceWidth: 100, sourceHeight: 60,
      originalGeometry: { x: 0, y: 0, width: 200, height: 120 },
      paddingRatio: { top: 0.1, right: 0.2, bottom: 0, left: 0.05 },
      originalInpaintStrokes: [{ radius: 0.03, points: [{ x: 0.3, y: 0.4 }] }],
    },
  });
  const target = createNode('image', {
    assetId: 'target-original', sourceWidth: 40, sourceHeight: 30,
    x: 18.5, y: -2.25, width: 80, height: 60,
  });
  addNode(document, source);
  addNode(document, target);

  const recipe = createImageRecipe(source, 'Expanded frame');
  assert.deepEqual(recipe.imageExpansionPaddingRatio, { top: 0.1, right: 0.2, bottom: 0, left: 0.05 });
  assert.deepEqual(recipe.inpaintStrokes, source.imageExpansion.originalInpaintStrokes,
    'saved erase marks stay relative to the retained unexpanded source');
  document.recipes.push(recipe);
  const reopened = parseDocument(serializeDocument(document));
  const reopenedRecipe = reopened.recipes[0];
  assert.deepEqual(reopenedRecipe.imageExpansionPaddingRatio, recipe.imageExpansionPaddingRatio);
  assert.deepEqual(reopenedRecipe.inpaintStrokes, recipe.inpaintStrokes);

  const reopenedTarget = findNode(reopened, target.id).node;
  const targetBefore = structuredClone(reopenedTarget);
  assert.equal(applyImageRecipe(reopened, reopenedTarget.id, reopenedRecipe, reopened.activePageId, { deferBackgroundRemoval: true }), true);
  assert.equal(reopenedTarget.assetId, targetBefore.assetId, 'the recipe never copies its source image pixels to a target');
  assert.equal(reopenedTarget.imageExpansion, undefined, 'the batch awaits expansion using this target’s own source');
  assert.deepEqual(
    { x: reopenedTarget.x, y: reopenedTarget.y, width: reopenedTarget.width, height: reopenedTarget.height, sourceWidth: reopenedTarget.sourceWidth, sourceHeight: reopenedTarget.sourceHeight },
    { x: targetBefore.x, y: targetBefore.y, width: targetBefore.width, height: targetBefore.height, sourceWidth: targetBefore.sourceWidth, sourceHeight: targetBefore.sourceHeight },
    'the async batch operation, not synchronous recipe styling, changes target-specific dimensions and geometry'
  );

  const legacy = { ...reopenedRecipe };
  delete legacy.imageExpansionPaddingRatio;
  const targetExpansion = {
    sourceImageAssetId: 'target-prior-source', sourceWidth: 40, sourceHeight: 30,
    originalGeometry: { x: 1, y: 2, width: 80, height: 60 },
    paddingRatio: { top: 0, right: 0.1, bottom: 0, left: 0 },
    originalInpaintStrokes: [],
  };
  reopenedTarget.imageExpansion = structuredClone(targetExpansion);
  applyImageRecipe(reopened, reopenedTarget.id, legacy);
  assert.deepEqual(reopenedTarget.imageExpansion, targetExpansion,
    'legacy recipes without the field leave the target’s existing expansion alone');
  assert.throws(() => applyImageRecipe(reopened, reopenedTarget.id, {
    ...reopenedRecipe, imageExpansionPaddingRatio: { top: 1.1, right: 0, bottom: 0, left: 0 },
  }), /expansion padding/);
});

test('saved image recipes can be renamed, refreshed from a layer, and deleted without changing applied images', () => {
  const document = createDocument();
  const source = createNode('image', { assetId: 'asset-source', adjustments: { brightness: 12 }, outputFormat: 'png' });
  const target = createNode('image', { assetId: 'asset-target', adjustments: { contrast: 7 }, outputFormat: 'jpeg', outputQuality: 83 });
  addNode(document, source); addNode(document, target);
  const recipe = createImageRecipe(source, 'Soft light');
  recipe.catalogNote = 'preserved extension data';
  document.recipes.push(recipe);
  const stableId = recipe.id;
  const stableCreatedAt = recipe.createdAt;

  assert.equal(renameImageRecipe(document, recipe.id, '  Warm\nportrait  '), true);
  assert.equal(recipe.name, 'Warm portrait', 'control characters are normalized and surrounding spaces are trimmed');
  const renamedSnapshot = structuredClone(recipe);
  assert.equal(renameImageRecipe(document, recipe.id, ''), false);
  assert.equal(renameImageRecipe(document, recipe.id, 'x'.repeat(61)), false);
  assert.deepEqual(recipe, renamedSnapshot, 'invalid names leave the saved recipe unchanged');

  source.adjustments = { brightness: -31, highlights: 18, invert: true };
  source.transforms = { crop: { left: 0.12, top: 0.08, right: 0.9, bottom: 0.94 }, rotation: 270, flipHorizontal: true };
  source.outputFormat = 'webp'; source.outputQuality = 68;
  source.opacity = 0.43; source.blendMode = 'multiply'; source.fit = 'contain';
  source.effects = [createLayerEffect('drop-shadow', { color: '#123456', opacity: 0.5, offsetX: 3, blur: 8 })];
  const targetBefore = structuredClone(target);
  assert.equal(updateImageRecipe(document, recipe.id, source.id), true);
  assert.equal(recipe.id, stableId, 'updating keeps a recipe’s stable ID');
  assert.equal(recipe.createdAt, stableCreatedAt, 'updating keeps its creation date');
  assert.equal(recipe.name, 'Warm portrait', 'updating keeps the catalog name');
  assert.equal(recipe.catalogNote, 'preserved extension data', 'updating keeps unrelated metadata');
  assert.deepEqual(recipe.adjustments, createImageRecipe(source, recipe.name, {}, document).adjustments);
  assert.deepEqual(recipe.transforms, { crop: source.transforms.crop, rotation: 270, flipHorizontal: true, flipVertical: false });
  assert.deepEqual([recipe.format, recipe.quality], ['webp', 68]);
  assert.deepEqual([recipe.fit, recipe.opacity, recipe.blendMode], ['contain', 0.43, 'multiply']);
  assert.deepEqual(recipe.effects, source.effects);
  assert.deepEqual(target, targetBefore, 'refreshing a recipe never changes images that already exist');
  assert.equal(applyImageRecipe(document, target.id, recipe), true);
  assert.deepEqual(target.adjustments, recipe.adjustments, 'future applications use the refreshed snapshot');
  assert.deepEqual([target.outputFormat, target.outputQuality], ['webp', 68]);

  const beforeRejectedUpdate = structuredClone(recipe);
  assert.equal(updateImageRecipe(document, 'missing-recipe', source.id), false);
  assert.equal(updateImageRecipe(document, recipe.id, 'missing-layer'), false);
  assert.throws(() => updateImageRecipe(document, recipe.id, source.id, { format: 'gif' }), /PNG, JPEG, or WebP/);
  assert.deepEqual(recipe, beforeRejectedUpdate, 'an invalid refresh is atomic');

  const reopened = parseDocument(serializeDocument(document));
  assert.equal(reopened.recipes[0].name, 'Warm portrait');
  assert.equal(reopened.recipes[0].id, stableId);
  assert.deepEqual(reopened.recipes[0].effects, recipe.effects);
  assert.equal(deleteImageRecipe(reopened, stableId), true);
  assert.deepEqual(reopened.recipes, []);
  assert.equal(deleteImageRecipe(reopened, stableId), false, 'deleting an unknown recipe is a harmless no-op');
  assert.equal(findNode(reopened, target.id).node.assetId, 'asset-target', 'recipe deletion does not remove or replace image assets');
  assert.equal(validateDocument(reopened), true);
});

test('image recipe names are bounded and an empty name uses a safe layer-derived default', () => {
  const image = createNode('image', { name: 'x'.repeat(90), assetId: 'asset-name' });
  const recipe = createImageRecipe(image, '   ');
  assert.equal(recipe.name.length, 60);
  assert.throws(() => createImageRecipe(image, 'x'.repeat(61)), /up to 60 characters/);
});

test('legacy image recipes default to PNG output and reject invalid format or quality', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Legacy image opacity');
  const opacity = createVariable(document, collection.id, 'Opacity', 'number', 0.4);
  const image = createNode('image', {
    assetId: 'asset-legacy', opacity: 0.8, blendMode: 'multiply',
    effects: [createLayerEffect('drop-shadow', { color: '#123456' })]
  }); addNode(document, image);
  assert.equal(bindVariable(document, image.id, opacity.id, 'opacity'), true);
  const priorEffects = structuredClone(image.effects);
  const legacy = { id: 'recipe-legacy', name: 'Legacy', adjustments: {}, transforms: { crop: null, rotation: 0 } };
  document.recipes.push(legacy);
  assert.equal(validateDocument(document), true, 'older saved recipes remain valid without output settings');
  assert.equal(applyImageRecipe(document, image.id, legacy), true);
  assert.deepEqual([image.outputFormat, image.outputQuality], ['png', 90]);
  assert.equal(image.blendMode, 'multiply', 'legacy recipes without blend settings preserve the target blend mode');
  assert.deepEqual(image.effects, priorEffects, 'legacy recipes without effects preserve the target effect stack');
  assert.equal(image.variableBindings.opacity, opacity.id, 'legacy recipes without opacity preserve target variable bindings');
  assert.equal(getNodePropertyValue(document, image, 'opacity'), 0.4);
  assert.equal(applyImageRecipe(document, image.id, { ...legacy, opacity: null }), true);
  assert.equal(image.variableBindings.opacity, opacity.id, 'null legacy opacity is treated as omitted and does not detach its binding');
  assert.throws(() => createImageRecipe(image, 'Bad format', { format: 'gif' }, document), /PNG, JPEG, or WebP/);
  assert.throws(() => createImageRecipe(image, 'Bad quality', { quality: 101 }, document), /1 to 100/);
  assert.throws(() => createImageRecipe(image, 'Bound opacity without design'), /design is required/);
  const boundRecipe = createImageRecipe(image, 'Bound opacity with design', {}, document);
  assert.equal(boundRecipe.opacity, 0.4);
  legacy.format = 'gif';
  assert.throws(() => validateDocument(document), /Invalid image output format in image recipe/);
  legacy.format = 'jpeg'; legacy.quality = 0;
  assert.throws(() => validateDocument(document), /Invalid image output quality in image recipe/);
});

test('image recipes validate complete fill/output settings before changing an image', () => {
  const document = createDocument();
  const image = createNode('image', {
    assetId: 'asset-safe', adjustments: { brightness: 12 },
    transforms: { crop: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 }, rotation: 90 },
    fit: 'contain', opacity: 0.6, outputFormat: 'webp', outputQuality: 71
  });
  addNode(document, image);
  const before = structuredClone(image);
  for (const invalid of [
    { adjustments: { brightness: -20 }, transforms: { rotation: 45 }, format: 'jpeg', quality: 40 },
    { adjustments: { brightness: -20 }, transforms: { rotation: 90 }, format: 'jpeg', quality: 40, fit: 'stretch' },
    { adjustments: { brightness: -20 }, transforms: { rotation: 90 }, format: 'jpeg', quality: 40, opacity: 1.1 },
    { adjustments: { brightness: -20 }, transforms: { rotation: 90 }, format: 'jpeg', quality: 40, effects: [{ id: 'bad', type: 'unsupported', visible: true }] },
    { adjustments: { brightness: -20 }, transforms: { rotation: 90 }, format: 'jpeg', quality: 40, blendMode: 'unsupported' },
  ]) {
    assert.throws(() => applyImageRecipe(document, image.id, invalid));
    assert.deepEqual(image, before, 'a rejected recipe leaves every layer field unchanged');
  }
  const recipe = createImageRecipe(image, 'Complete look');
  assert.deepEqual([recipe.fit, recipe.opacity, recipe.format, recipe.quality], ['contain', 0.6, 'webp', 71]);
  document.recipes.push(recipe);
  assert.equal(validateDocument(document), true);
  for (const recipes of [[null], [{ id: 'x', name: '' }], [{ id: 'x', name: 'One' }, { id: 'x', name: 'Two' }]]) {
    const corrupted = structuredClone(document);
    corrupted.recipes = recipes;
    assert.throws(() => validateDocument(corrupted), /recipe identity/);
  }
  for (const invalid of [{ fit: 'stretch' }, { opacity: -0.1 }, { opacity: Infinity }]) {
    const corrupted = structuredClone(document);
    Object.assign(corrupted.recipes[0], invalid);
    assert.throws(() => validateDocument(corrupted), /Invalid image (fit mode|opacity)/);
  }
  for (const invalid of [
    { effects: [{ id: 'bad', type: 'unsupported', visible: true }] },
    { blendMode: 'unsupported' }
  ]) {
    const corrupted = structuredClone(document);
    Object.assign(corrupted.recipes[0], invalid);
    assert.throws(() => validateDocument(corrupted), /Invalid image (effects|blend mode) in image recipe/);
  }
  image.fit = 'stretch';
  assert.throws(() => createImageRecipe(image, 'Invalid source'), /fit must be Fill, Fit, or Tile/);
});

test('image object-erase edits round-trip, save into recipes, scale across targets, and reject malformed strokes', () => {
  const document = createDocument();
  const source = createNode('image', {
    assetId: 'asset-erase-source',
    inpaintStrokes: [{ radius: 0.04, points: [{ x: 0.3, y: 0.6 }, { x: 0.35, y: 0.62 }] }],
  });
  const target = createNode('image', { assetId: 'asset-erase-target', inpaintStrokes: [{ radius: 0.02, points: [{ x: 0.8, y: 0.2 }] }] });
  addNode(document, source);
  addNode(document, target);

  const recipe = createImageRecipe(source, 'Erase background sign');
  assert.deepEqual(recipe.inpaintStrokes, source.inpaintStrokes);
  document.recipes.push(recipe);
  assert.equal(applyImageRecipe(document, target.id, recipe), true);
  assert.deepEqual(findNode(document, target.id).node.inpaintStrokes, recipe.inpaintStrokes,
    'the saved recipe replaces prior target strokes with source-relative erase points');

  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.recipes[0].inpaintStrokes, source.inpaintStrokes);
  assert.deepEqual(findNode(reopened, target.id).node.inpaintStrokes, source.inpaintStrokes);
  assert.equal(validateDocument(reopened), true);

  const legacyRecipe = { id: 'legacy-erase', name: 'Legacy', adjustments: {}, transforms: { crop: null, rotation: 0 } };
  const beforeLegacyStrokes = structuredClone(findNode(reopened, target.id).node.inpaintStrokes);
  applyImageRecipe(reopened, target.id, legacyRecipe);
  assert.deepEqual(findNode(reopened, target.id).node.inpaintStrokes, beforeLegacyStrokes,
    'recipes saved before object erase do not clear an existing target edit');

  const invalid = structuredClone(reopened);
  findNode(invalid, target.id).node.inpaintStrokes[0].points[0].x = 1.01;
  assert.throws(() => validateDocument(invalid), /Invalid object-erase strokes/);
  assert.throws(() => applyImageRecipe(reopened, target.id, { ...recipe, inpaintStrokes: [{ radius: 0, points: [{ x: 0.5, y: 0.5 }] }] }), /saved object-erase stroke is malformed/);
});

test('image adjustment validation rejects invalid creative tone settings', () => {
  const document = createDocument();
  const image = createNode('image'); addNode(document, image);
  image.adjustments.posterizeBits = 9;
  assert.throws(() => validateDocument(document), /Invalid image adjustments/);
  image.adjustments.posterizeBits = 3;
  image.adjustments.invert = 'true';
  assert.throws(() => validateDocument(document), /Invalid image adjustments/);
  image.adjustments = { brightness: 0, solarizeThreshold: 256 };
  assert.throws(() => validateDocument(document), /Invalid image adjustments/);
});

test('image layers default to no crop, zero rotation and no flips, and persist normalized transforms', () => {
  const document = createDocument();
  const image = createNode('image', { transforms: { crop: { left: 0.05, top: 0.15, right: 0.95, bottom: 0.8 }, rotation: 180, flipHorizontal: true, flipVertical: true } });
  const untouched = createNode('image');
  addNode(document, image); addNode(document, untouched);
  assert.deepEqual(untouched.transforms, { crop: null, rotation: 0, flipHorizontal: false, flipVertical: false });
  const restored = parseDocument(serializeDocument(document));
  assert.deepEqual(restored.pages[0].children[0].transforms, image.transforms);
  assert.deepEqual(restored.pages[0].children[1].transforms, { crop: null, rotation: 0, flipHorizontal: false, flipVertical: false });
});

test('image layer validation rejects invalid normalized crop bounds and non-quarter-turn rotation', () => {
  const document = createDocument();
  const image = createNode('image'); addNode(document, image);
  image.transforms.crop = { left: -0.1, top: 0, right: 0.8, bottom: 1 };
  assert.throws(() => validateDocument(document), /Invalid image transforms/);
  image.transforms = { crop: { left: 0.5, top: 0.2, right: 0.5, bottom: 0.9 }, rotation: 0 };
  assert.throws(() => validateDocument(document), /Invalid image transforms/);
  image.transforms = { crop: null, rotation: 45 };
  assert.throws(() => validateDocument(document), /Invalid image transforms/);
  image.transforms = { crop: null, rotation: 0, flipHorizontal: 1 };
  assert.throws(() => validateDocument(document), /Invalid image transforms/);
});

test('import validation rejects malformed image recipe transforms and accepts legacy recipes', () => {
  const document = createDocument();
  const malformedTransforms = [
    { crop: { left: -0.1, top: 0, right: 0.8, bottom: 1 }, rotation: 0 },
    { crop: { left: 0.2, top: 0, right: 0.2, bottom: 1 }, rotation: 0 },
    { crop: null, rotation: 45 },
    { crop: null, rotation: 90.5 },
    { crop: null, rotation: 0, scale: 2 }
  ];

  for (const transforms of malformedTransforms) {
    const imported = structuredClone(document);
    imported.recipes.push({ id: 'recipe-imported', name: 'Imported look', transforms });
    assert.throws(() => parseDocument(imported), /Invalid image transforms in image recipe/);
  }

  const legacy = structuredClone(document);
  legacy.recipes.push({ id: 'recipe-legacy', name: 'Legacy look', adjustments: { brightness: 10 } });
  assert.equal(validateDocument(legacy), true, 'recipes saved before crop/rotation remain loadable');
});

test('serialized design validates after reload and rejects duplicate layer identities', () => {
  const document = createDocument();
  addNode(document, createNode('frame', { name: 'Mobile frame' }));
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  const duplicate = createNode('rectangle');
  reopened.pages[0].children.push(duplicate, structuredClone(duplicate));
  assert.throws(() => validateDocument(reopened), /duplicate layer/);
});

test('parseDocument rejects hostile layer nesting before cloning or recursive validation', () => {
  const document = createDocument();
  const root = createNode('group');
  document.pages[0].children.push(root);
  let parent = root;
  for (let depth = 1; depth < 6_000; depth += 1) {
    const child = createNode('group');
    parent.children.push(child);
    parent = child;
  }

  assert.throws(() => parseDocument(document), error => error instanceof TypeError
    && error.message.includes(`maximum depth of ${MAX_DOCUMENT_TREE_DEPTH}`));
});

test('document validation caps total layer count and still accepts large flat designs', () => {
  const oversized = createDocument();
  oversized.pages[0].children = Array.from({ length: MAX_DOCUMENT_NODE_COUNT + 1 }, (_, index) => ({
    id: `oversized-layer-${index}`, children: []
  }));
  assert.throws(() => parseDocument(oversized), error => error instanceof TypeError
    && error.message.includes(`more than ${MAX_DOCUMENT_NODE_COUNT.toLocaleString()} layer nodes`));

  const large = createDocument();
  large.pages[0].children = Array.from({ length: 20_000 }, () => createNode('rectangle'));
  assert.equal(parseDocument(large).pages[0].children.length, 20_000,
    'large ordinary documents under the published safety ceiling remain loadable');
});

test('image fills validate and survive a portable design round trip', () => {
  const document = createDocument();
  const fill = createImageFill('asset-local-photo', { fit: 'contain', adjustments: { brightness: -18, contrast: 12, saturation: 8, sharpness: 35, blur: 2, autoContrast: true, posterizeBits: 3, solarize: true, solarizeThreshold: 110, invert: true } });
  const rectangle = createNode('rectangle', { imageFill: fill });
  addNode(document, rectangle);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  assert.deepEqual(reopened.pages[0].children[0].imageFill, fill);

  const legacyFill = structuredClone(fill);
  delete legacyFill.adjustments.sharpness;
  const legacyDocument = structuredClone(reopened);
  legacyDocument.pages[0].children[0].imageFill = legacyFill;
  const loadedLegacyDocument = parseDocument(JSON.stringify(legacyDocument));
  assert.equal(validateDocument(loadedLegacyDocument), true, 'older image fills without sharpness stay loadable with a neutral default.');
  assert.deepEqual(loadedLegacyDocument.pages[0].children[0].imageFill, legacyFill);

  reopened.pages[0].children[0].imageFill.fit = 'stretch';
  assert.throws(() => validateDocument(reopened), /Invalid image fill/);
  reopened.pages[0].children[0].imageFill = fill;
  reopened.pages[0].children[0].imageFill.adjustments.blur = 25;
  assert.throws(() => validateDocument(reopened), /Invalid image fill/);
  reopened.pages[0].children[0].imageFill = fill;
  reopened.pages[0].children[0].imageFill.adjustments.solarizeThreshold = 300;
  assert.throws(() => validateDocument(reopened), /Invalid image fill/);
  reopened.pages[0].children[0] = createNode('text', { imageFill: createImageFill('asset-local-text') });
  assert.equal(validateDocument(reopened), true, 'text layers accept local image paints while preserving the original image fill contract');
});

test('text paint stacks serialize while legacy text colors and their variable/style bindings remain intact', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Text paints');
  const textVariable = createVariable(document, collection.id, 'Text ink', 'color', '#a12b3c');
  document.colorStyles.push({ id: 'text-color-style', name: 'Legacy text ink', kind: 'text', value: '#a12b3c' });
  const legacyText = createNode('text', {
    id: 'legacy-text-color', color: '#a12b3c', textVariableId: textVariable.id, textStyleId: 'text-color-style'
  });
  const stackText = createNode('text', {
    id: 'stacked-text-paints', color: '#124578',
    fills: [
      createFillLayer('solid', { id: 'text-base', color: '#224466' }),
      createFillLayer('linear', { id: 'text-gradient', gradient: createGradientFill('linear', '#ff0000') }),
      createFillLayer('image', { id: 'text-image', imageFill: createImageFill('asset-local') })
    ],
    strokes: [{ id: 'text-stroke', color: '#000000', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 }]
  });
  addNode(document, legacyText); addNode(document, stackText);

  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  const [legacy, stacked] = reopened.pages[0].children;
  assert.equal(legacy.color, '#a12b3c');
  assert.equal(legacy.textVariableId, textVariable.id);
  assert.equal(legacy.textStyleId, 'text-color-style');
  assert.equal(Object.hasOwn(legacy, 'fills'), false, 'old text nodes do not gain a paint stack during load');
  assert.deepEqual(stacked.fills.map(fill => [fill.id, fill.type]), [
    ['text-base', 'solid'], ['text-gradient', 'linear'], ['text-image', 'image']
  ]);
  assert.equal(stacked.color, '#124578', 'the compatibility text color remains unchanged beside the paint stack');
  assert.deepEqual(stacked.strokes.map(stroke => stroke.id), ['text-stroke']);
});

test('layer blend modes validate and survive local design serialization', () => {
  const document = createDocument();
  const rectangle = createNode('rectangle', { blendMode: 'multiply' });
  addNode(document, rectangle);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(reopened.pages[0].children[0].blendMode, 'multiply');
  assert.equal(validateDocument(reopened), true);
  reopened.pages[0].children[0].blendMode = 'vivid-light';
  assert.throws(() => validateDocument(reopened), /Invalid blend mode/);
});

test('text typography supports system font names, the full weight range, and italic style', () => {
  const document = createDocument();
  const text = createNode('text', { text: 'Readable design', fontFamily: 'Atkinson Hyperlegible, sans-serif', fontWeight: 800, fontStyle: 'italic' });
  addNode(document, text);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(reopened), true);
  assert.deepEqual(
    (({ fontFamily, fontWeight, fontStyle }) => ({ fontFamily, fontWeight, fontStyle }))(reopened.pages[0].children[0]),
    { fontFamily: 'Atkinson Hyperlegible, sans-serif', fontWeight: 800, fontStyle: 'italic' }
  );
  reopened.pages[0].children[0].fontWeight = 1001;
  assert.throws(() => validateDocument(reopened), /Invalid font weight/);
  reopened.pages[0].children[0].fontWeight = 800;
  reopened.pages[0].children[0].fontStyle = 'oblique';
  assert.throws(() => validateDocument(reopened), /Invalid font style/);
  reopened.pages[0].children[0].fontStyle = 'italic';
  reopened.pages[0].children[0].fontFamily = '   ';
  assert.throws(() => validateDocument(reopened), /Invalid font family/);
  const legacy = createDocument();
  addNode(legacy, createNode('text', { fontWeight: '600' }));
  assert.equal(validateDocument(legacy), true, 'previous saves stored select values as numeric strings');
});

test('rich text runs are optional, validated, and preserved in local design serialization', () => {
  const document = createDocument();
  const text = createNode('text', {
    text: 'Hello bold world',
    textRuns: [
      { text: 'Hello ' },
      { text: 'bold', fontWeight: 700, lineHeight: 1.6, color: '#ff2200', textDecoration: 'underline' },
      { text: ' world', fontStyle: 'italic', fontSize: 18 }
    ]
  });
  addNode(document, text);
  assert.equal(validateDocument(document), true);
  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.pages[0].children[0].textRuns, text.textRuns);
  assert.equal(reopened.pages[0].children[0].text, 'Hello bold world');

  const legacy = createDocument();
  addNode(legacy, createNode('text', { text: 'Uniform text' }));
  assert.equal(validateDocument(legacy), true, 'legacy uniform text remains valid without a textRuns property');
  assert.equal(Object.hasOwn(legacy.pages[0].children[0], 'textRuns'), false);

  const invalidCases = [
    ['text mismatch', runs => { runs.pages[0].children[0].text = 'Different'; }],
    ['unsupported style', runs => { runs.pages[0].children[0].textRuns[1].fontStyle = 'oblique'; }],
    ['invalid line height', runs => { runs.pages[0].children[0].textRuns[1].lineHeight = 0; }],
    ['invalid color', runs => { runs.pages[0].children[0].textRuns[1].color = 'red'; }],
    ['unknown field', runs => { runs.pages[0].children[0].textRuns[1].opacity = .5; }],
    ['empty run', runs => { runs.pages[0].children[0].textRuns[1].text = ''; }]
  ];
  for (const [label, mutate] of invalidCases) {
    const invalid = structuredClone(document);
    mutate(invalid);
    assert.throws(() => validateDocument(invalid), /Invalid rich text runs/, label);
  }

  const nonText = createDocument();
  addNode(nonText, createNode('rectangle', { textRuns: [{ text: 'Text' }] }));
  assert.throws(() => validateDocument(nonText), /Invalid rich text runs/);
});

test('history restores both document direction and redo state', () => {
  const document = createDocument();
  const history = new History();
  history.checkpoint(document, 'Create layer');
  addNode(document, createNode('rectangle'));
  const undone = history.undo(document);
  assert.equal(undone.pages[0].children.length, 0);
  const redone = history.redo(undone);
  assert.equal(redone.pages[0].children.length, 1);
});

test('negative-slope line direction round-trips and is restricted to line layers', () => {
  const document = createDocument();
  const line = createNode('line', { width: 80, height: 45, lineReverseY: true });
  addNode(document, line);
  const reopened = parseDocument(serializeDocument(document));
  assert.equal(findNode(reopened, line.id).node.lineReverseY, true);
  assert.equal(validateDocument(reopened), true);

  const invalidLine = structuredClone(reopened);
  findNode(invalidLine, line.id).node.lineReverseY = 'yes';
  assert.throws(() => validateDocument(invalidLine), /Invalid line direction/);

  const invalidShape = createDocument();
  addNode(invalidShape, createNode('rectangle', { lineReverseY: true }));
  assert.throws(() => validateDocument(invalidShape), /Invalid line direction/);
});
