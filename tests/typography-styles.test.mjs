import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, addVariableMode, applyTypographyStyle, bindColorVariable, bindVariable,
  createColorVariable, createDocument, createNode, createTypographyStyle, createVariable,
  createVariableCollection, deleteTypographyStyle, getNodeColor, getNodePropertyValue,
  renameTypographyStyle,
  parseDocument, serializeDocument, setColorVariableValue, setVariableValue,
  updateTypographyStyle, validateDocument
} from '../src/model.js';

const styleValues = style => ({
  fontFamily: style.fontFamily,
  fontSize: style.fontSize,
  fontWeight: style.fontWeight,
  fontStyle: style.fontStyle,
  lineHeight: style.lineHeight,
  letterSpacing: style.letterSpacing,
  paragraphSpacing: style.paragraphSpacing,
  firstLineIndent: style.firstLineIndent,
  listSpacing: style.listSpacing,
  textCase: style.textCase,
  textDecoration: style.textDecoration
});

function makeTypographyFixture() {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Typography');
  const dark = addVariableMode(document, collection.id, 'Dark');
  const ink = createColorVariable(document, collection.id, 'Ink', '#233344');
  const size = createVariable(document, collection.id, 'Size', 'number', 18);
  const leading = createVariable(document, collection.id, 'Leading', 'number', 1.2);
  const tracking = createVariable(document, collection.id, 'Tracking', 'number', 0);
  setColorVariableValue(document, ink.id, '#bd623f', dark.id);
  setVariableValue(document, size.id, 34, dark.id);
  setVariableValue(document, leading.id, 1.55, dark.id);
  setVariableValue(document, tracking.id, 0.75, dark.id);

  const frame = createNode('frame', { variableModes: { [collection.id]: dark.id } });
  const source = createNode('text', {
    name: 'Hero heading', text: 'Source copy', x: 16, y: 24, width: 320, height: 72,
    fontFamily: 'Atkinson Hyperlegible, sans-serif', fontWeight: 650, paragraphSpacing: 9, firstLineIndent: 18, listSpacing: 5,
    fontStyle: 'italic', align: 'center', textCase: 'capitalize', textDecoration: 'underline'
  });
  addNode(document, frame);
  addNode(document, source, { parentId: frame.id });
  assert.equal(bindColorVariable(document, source.id, ink.id, 'text'), true);
  assert.equal(bindVariable(document, source.id, size.id, 'fontSize'), true);
  assert.equal(bindVariable(document, source.id, leading.id, 'lineHeight'), true);
  assert.equal(bindVariable(document, source.id, tracking.id, 'letterSpacing'), true);
  return { document, collection, dark, ink, size, leading, tracking, frame, source };
}

test('typography styles snapshot resolved text values and update from a text layer', () => {
  const { document, dark, ink, size, leading, tracking, source } = makeTypographyFixture();
  const style = createTypographyStyle(document, source.id, '  Display heading  ');
  assert.equal(style.name, 'Display heading');
  assert.equal(source.textVariableId, ink.id, 'saving a style does not unbind its source layer');
  assert.equal(source.typographyStyleId, style.id, 'saving a style links its source text layer');
  assert.equal(source.textStyleId, undefined);
  assert.deepEqual(styleValues(style), {
    fontFamily: 'Atkinson Hyperlegible, sans-serif', fontSize: 34, fontWeight: 650,
    fontStyle: 'italic', lineHeight: 1.55, letterSpacing: 0.75, paragraphSpacing: 9, firstLineIndent: 18,
    listSpacing: 5, textCase: 'capitalize', textDecoration: 'underline'
  });

  const id = style.id;
  setColorVariableValue(document, ink.id, '#8b4bc0', dark.id);
  setVariableValue(document, size.id, 42, dark.id);
  setVariableValue(document, leading.id, 1.35, dark.id);
  setVariableValue(document, tracking.id, 1.25, dark.id);
  assert.equal(getNodeColor(document, source, 'text'), '#8b4bc0');
  assert.equal(getNodePropertyValue(document, source, 'fontSize'), 42);
  assert.deepEqual(styleValues(style), {
    fontFamily: 'Atkinson Hyperlegible, sans-serif', fontSize: 34, fontWeight: 650,
    fontStyle: 'italic', lineHeight: 1.55, letterSpacing: 0.75, paragraphSpacing: 9, firstLineIndent: 18,
    listSpacing: 5, textCase: 'capitalize', textDecoration: 'underline'
  }, 'existing style values do not follow later variable edits');

  assert.equal(updateTypographyStyle(document, style.id, source.id), true);
  assert.equal(style.id, id);
  assert.equal(style.name, 'Display heading');
  assert.deepEqual(styleValues(style), {
    fontFamily: 'Atkinson Hyperlegible, sans-serif', fontSize: 42, fontWeight: 650,
    fontStyle: 'italic', lineHeight: 1.35, letterSpacing: 1.25, paragraphSpacing: 9, firstLineIndent: 18,
    listSpacing: 5, textCase: 'capitalize', textDecoration: 'underline'
  });

  setColorVariableValue(document, ink.id, '#1e824c', dark.id);
  setVariableValue(document, size.id, 28, dark.id);
  assert.deepEqual(styleValues(style), {
    fontFamily: 'Atkinson Hyperlegible, sans-serif', fontSize: 42, fontWeight: 650,
    fontStyle: 'italic', lineHeight: 1.35, letterSpacing: 1.25, paragraphSpacing: 9, firstLineIndent: 18,
    listSpacing: 5, textCase: 'capitalize', textDecoration: 'underline'
  }, 'updated values remain a snapshot');
});

test('applying a typography style preserves text, geometry, color links, and layer-local alignment', () => {
  const { document, collection, frame, source } = makeTypographyFixture();
  const style = createTypographyStyle(document, source.id, 'Display');
  const oldInk = createColorVariable(document, collection.id, 'Old ink', '#123456');
  const oldSize = createVariable(document, collection.id, 'Old size', 'number', 12);
  const oldLeading = createVariable(document, collection.id, 'Old leading', 'number', 1);
  const oldTracking = createVariable(document, collection.id, 'Old tracking', 'number', -0.25);
  document.colorStyles.push({ id: 'old-text-style', name: 'Old text color', kind: 'text', value: '#654321' });
  const target = createNode('text', {
    name: 'Keep this layer', text: 'Keep this exact copy', x: 41, y: 58, width: 287, height: 63,
    rotation: 7, fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 300,
    fontStyle: 'normal', lineHeight: 1, letterSpacing: -0.25, paragraphSpacing: 2, firstLineIndent: 3, align: 'right', color: '#aabbcc',
    textVariableId: oldInk.id, textStyleId: 'old-text-style', textCase: 'lowercase', textDecoration: 'line-through'
  });
  addNode(document, target, { parentId: frame.id });
  assert.equal(bindVariable(document, target.id, oldSize.id, 'fontSize'), true);
  assert.equal(bindVariable(document, target.id, oldLeading.id, 'lineHeight'), true);
  assert.equal(bindVariable(document, target.id, oldTracking.id, 'letterSpacing'), true);
  const original = {
    text: target.text,
    geometry: { x: target.x, y: target.y, width: target.width, height: target.height, rotation: target.rotation }
  };

  assert.equal(applyTypographyStyle(document, target.id, style.id), true);
  assert.equal(target.paragraphSpacing, 9);
  assert.equal(target.firstLineIndent, 18);
  assert.deepEqual(styleValues(target), styleValues(style));
  assert.equal(target.text, original.text);
  assert.deepEqual(
    { x: target.x, y: target.y, width: target.width, height: target.height, rotation: target.rotation },
    original.geometry
  );
  assert.equal(target.textVariableId, oldInk.id, 'text color variables stay independent from typography styles');
  assert.equal(target.textStyleId, 'old-text-style', 'text color styles stay independent from typography styles');
  assert.equal(target.typographyStyleId, style.id);
  assert.equal(target.variableBindings, undefined, 'font-size, line-height, and tracking bindings are cleared');
  assert.equal(getNodeColor(document, target, 'text'), '#123456', 'the target color variable remains linked');
  assert.equal(target.align, 'right', 'alignment remains local to the text layer');
  assert.equal(getNodePropertyValue(document, target, 'fontSize'), style.fontSize);
  assert.equal(target.listSpacing, 5, 'applying a text style copies its list spacing setting');

  const shape = createNode('rectangle');
  addNode(document, shape);
  assert.equal(applyTypographyStyle(document, shape.id, style.id), false);
  assert.equal(applyTypographyStyle(document, target.id, 'missing-style'), false);
  assert.equal(applyTypographyStyle(document, 'missing-node', style.id), false);
  assert.equal(updateTypographyStyle(document, 'missing-style', source.id), false);
  assert.equal(updateTypographyStyle(document, style.id, shape.id), false);
});

test('typography styles are deleted by identity and survive document serialization', () => {
  const { document, source } = makeTypographyFixture();
  const first = createTypographyStyle(document, source.id, 'Title');
  const second = createTypographyStyle(document, source.id, 'Caption');
  const restored = parseDocument(serializeDocument(document));
  assert.deepEqual(restored.typographyStyles, [first, second]);
  assert.equal(validateDocument(restored), true);

  assert.equal(deleteTypographyStyle(document, first.id), true);
  assert.deepEqual(document.typographyStyles, [second]);
  assert.equal(deleteTypographyStyle(document, first.id), false);
  assert.equal(deleteTypographyStyle(document, 'missing-style'), false);
});

test('updating a text style updates linked layers across pages while local color, alignment, and resize stay local', () => {
  const document = createDocument();
  const source = createNode('text', { text: 'Heading', fontFamily: 'Inter', fontSize: 28, fontWeight: 600, align: 'left' });
  addNode(document, source);
  const style = createTypographyStyle(document, source.id, 'Heading');
  const first = createNode('text', { text: 'First', color: '#ab4521', align: 'right', textFit: 'fixed' });
  addNode(document, first);
  assert.equal(applyTypographyStyle(document, first.id, style.id), true);

  const secondPage = { id: 'page-second', name: 'Page 2', children: [], guides: [] };
  document.pages.push(secondPage);
  const second = createNode('text', { text: 'Second', color: '#3277bb', align: 'center', textFit: 'auto-width' });
  addNode(document, second, { pageId: secondPage.id });
  assert.equal(applyTypographyStyle(document, second.id, style.id, secondPage.id), true);
  const unrelated = createNode('text', { text: 'Unlinked', fontSize: 14 });
  addNode(document, unrelated, { pageId: secondPage.id });

  source.fontSize = 44;
  source.fontWeight = 700;
  source.letterSpacing = 1.5;
  assert.equal(updateTypographyStyle(document, style.id, source.id), true);

  for (const linked of [source, first, second]) {
    assert.equal(linked.typographyStyleId, style.id);
    assert.equal(linked.fontSize, 44);
    assert.equal(linked.fontWeight, 700);
    assert.equal(linked.letterSpacing, 1.5);
  }
  assert.equal(first.color, '#ab4521');
  assert.equal(first.align, 'right');
  assert.equal(first.textFit, 'fixed');
  assert.equal(second.color, '#3277bb');
  assert.equal(second.align, 'center');
  assert.equal(second.textFit, 'auto-width');
  assert.equal(unrelated.fontSize, 14);
  assert.equal(unrelated.typographyStyleId, undefined);

  assert.equal(renameTypographyStyle(document, style.id, '  Display / Hero  '), true);
  assert.equal(style.name, 'Display / Hero');
  assert.equal(renameTypographyStyle(document, style.id, 'x'.repeat(121)), false);
  assert.equal(renameTypographyStyle(document, style.id, '   '), false);
  assert.equal(validateDocument(document), true);
});

test('deleting a text style detaches linked text and clears only stale component style overrides', () => {
  const document = createDocument();
  const source = createNode('text', { text: 'Heading', fontSize: 32, color: '#804020' });
  addNode(document, source);
  const style = createTypographyStyle(document, source.id, 'Heading');
  const instance = createNode('frame', {
    isInstance: true,
    componentOverrides: { 'source-text': { typographyStyleId: style.id, fontSize: 24, color: '#123456' } }
  });
  const instanceText = createNode('text', { text: 'Instance', componentSourceId: 'source-text', typographyStyleId: style.id, fontSize: 24 });
  addNode(document, instance);
  addNode(document, instanceText, { parentId: instance.id });

  assert.equal(deleteTypographyStyle(document, style.id), true);
  assert.equal(source.typographyStyleId, undefined);
  assert.equal(instanceText.typographyStyleId, undefined);
  assert.deepEqual(instance.componentOverrides['source-text'], { fontSize: 24, color: '#123456' });
  assert.equal(source.fontSize, 32);
  assert.equal(source.color, '#804020');
  assert.equal(document.typographyStyles.length, 0);
});

test('document validation rejects dangling text style references when the style catalog is missing', () => {
  const document = createDocument();
  const node = createNode('text', { text: 'Styled' });
  addNode(document, node);
  node.typographyStyleId = 'missing-style';
  delete document.typographyStyles;
  assert.throws(() => validateDocument(document), /Text styles must be a list/);
});

test('text style save, apply, and update leave alignment local to each text layer', () => {
  const { document, source } = makeTypographyFixture();
  source.align = 'justify';
  const style = createTypographyStyle(document, source.id, 'Justified body');
  assert.equal(style.align, undefined);
  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.typographyStyles[0].align, undefined);
  const target = createNode('text', { align: 'center' });
  addNode(restored, target);
  assert.equal(applyTypographyStyle(restored, target.id, style.id), true);
  assert.equal(target.align, 'center');
  target.align = 'left';
  assert.equal(updateTypographyStyle(restored, style.id, target.id), true);
  assert.equal(restored.typographyStyles[0].align, undefined);
});

test('legacy typography styles without case or decoration remain valid and apply with defaults', () => {
  const { document, source } = makeTypographyFixture();
  const style = createTypographyStyle(document, source.id, 'Legacy style');
  delete style.textCase;
  delete style.textDecoration;
  delete style.paragraphSpacing;
  delete style.firstLineIndent;
  delete style.listSpacing;
  const target = createNode('text', { textCase: 'uppercase', textDecoration: 'line-through' });
  addNode(document, target);

  assert.equal(validateDocument(document), true);
  assert.equal(applyTypographyStyle(document, target.id, style.id), true);
  assert.equal(target.textCase, 'none');
  assert.equal(target.textDecoration, 'none');
  assert.equal(target.paragraphSpacing, 0);
  assert.equal(target.firstLineIndent, 0);
  assert.equal(target.listSpacing, 0);
});

test('document validation and serialization reject malformed and duplicate typography styles', () => {
  const { document, source } = makeTypographyFixture();
  const style = createTypographyStyle(document, source.id, 'Valid style');
  const invalidValues = [
    ['empty name', value => { value.name = '   '; }],
    ['long font family', value => { value.fontFamily = 'x'.repeat(161); }],
    ['non-positive font size', value => { value.fontSize = 0; }],
    ['out-of-range font weight', value => { value.fontWeight = 1001; }],
    ['unsupported font style', value => { value.fontStyle = 'oblique'; }],
    ['non-positive line height', value => { value.lineHeight = 0; }],
    ['non-finite tracking', value => { value.letterSpacing = Infinity; }],
    ['negative paragraph spacing', value => { value.paragraphSpacing = -1; }],
    ['oversized first-line indent', value => { value.firstLineIndent = 10_001; }],
    ['oversized list spacing', value => { value.listSpacing = 10_001; }],
    ['unsupported alignment', value => { value.align = 'distributed'; }],
    ['unsupported text case', value => { value.textCase = 'title-case'; }],
    ['unsupported text decoration', value => { value.textDecoration = 'overline'; }],
    ['invalid color', value => { value.color = 'blue'; }]
  ];
  for (const [label, mutate] of invalidValues) {
    const invalid = structuredClone(document);
    mutate(invalid.typographyStyles[0]);
    assert.throws(() => validateDocument(invalid), /Invalid or duplicate text style/, label);
    assert.throws(() => serializeDocument(invalid), /Invalid or duplicate text style/, `${label} during serialization`);
  }

  const duplicate = structuredClone(document);
  duplicate.typographyStyles.push({ ...structuredClone(style), name: 'Duplicate identity' });
  assert.throws(() => validateDocument(duplicate), /Invalid or duplicate text style/);
  assert.throws(() => serializeDocument(duplicate), /Invalid or duplicate text style/);
  assert.throws(() => parseDocument(JSON.stringify(duplicate)), /Invalid or duplicate text style/);
});
