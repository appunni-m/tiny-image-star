import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, applyTypographyStyle, createComponent, createComponentInstance, createDocument, createNode, createTypographyStyle, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { layoutTextRuns } from '../src/text-layout.js';
import { summarizeTextRunRange } from '../src/text-run-selection.js';
import { transformTextRunsInRange } from '../src/text-run-editing.js';
import { isValidTextDecorationProperty, normalizeTextDecorationStyle, textDecorationDefaults } from '../src/text-decoration-style.js';

const settings = {
  textDecorationStyle: 'wavy',
  textDecorationThickness: { unit: 'percent', value: 12.5 },
  textDecorationOffset: { unit: 'pixels', value: -2 },
  textDecorationColor: { type: 'solid', color: '#aabbcc', opacity: 0.7, visible: true },
  textDecorationSkipInk: true
};

test('decoration schema normalizes sparse values and rejects malformed or oversized records', () => {
  assert.deepEqual(normalizeTextDecorationStyle({ textDecorationStyle: 'dotted' }), { textDecorationStyle: 'dotted' });
  assert.deepEqual(textDecorationDefaults({}), {
    textDecorationStyle: 'solid', textDecorationThickness: { unit: 'auto' },
    textDecorationOffset: { unit: 'auto' }, textDecorationColor: 'auto', textDecorationSkipInk: false
  });
  assert.equal(isValidTextDecorationProperty('textDecorationOffset', { unit: 'percent', value: -100_000 }), true);
  assert.equal(isValidTextDecorationProperty('textDecorationThickness', { unit: 'pixels', value: -0.1 }), false);
  assert.equal(isValidTextDecorationProperty('textDecorationColor', { type: 'linear', color: '#ffffff', opacity: 1 }), false);
  assert.equal(normalizeTextDecorationStyle({ textDecorationSkipInk: false, extra: true }), null);
  assert.equal(normalizeTextDecorationStyle({ textDecorationOffset: { unit: 'pixels', value: 100_001 } }), null);
});

test('decoration properties persist on layers, rich runs, component overrides, and typography styles', () => {
  const document = createDocument();
  const text = createNode('text', { text: 'ab', textRuns: [{ text: 'a', ...settings }, { text: 'b' }], ...settings });
  addNode(document, text);
  const style = createTypographyStyle(document, text.id, 'Underline');
  assert.deepEqual(Object.fromEntries(Object.keys(settings).map(key => [key, style[key]])), settings);
  const copy = createNode('text', { text: 'copy' });
  addNode(document, copy);
  assert.equal(applyTypographyStyle(document, copy.id, style.id), true);
  assert.deepEqual(Object.fromEntries(Object.keys(settings).map(key => [key, copy[key]])), settings);
  const component = createComponent(document, text.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[text.id] = { ...settings };
  validateDocument(document);
  const restored = parseDocument(serializeDocument(document));
  assert.deepEqual(Object.fromEntries(Object.keys(settings).map(key => [key, restored.pages[0].children[0][key]])), settings);
  for (const invalid of [
    { textDecorationStyle: 'double' },
    { textDecorationThickness: { unit: 'em', value: 2 } },
    { textDecorationColor: { type: 'solid', color: '#fff', opacity: 1 } },
    { textDecorationSkipInk: 1 }
  ]) assert.throws(() => validateDocument({ ...structuredClone(document), pages: [{ ...document.pages[0], children: [{ ...text, ...invalid }, copy] }] }), /decoration|text run|component/iu);
});

test('rich text resolution inherits custom underline properties and uses defaults for unspecified runs', () => {
  const layout = layoutTextRuns([{ text: 'A', textDecorationStyle: 'dotted' }, { text: 'B' }], 100, {
    fontFamily: 'Arial', fontSize: 12, fontWeight: 400, fontStyle: 'normal', lineHeight: 1.2,
    textDecoration: 'underline', ...settings
  }, text => text.length * 6);
  const chars = layout.lines[0].parts;
  assert.equal(chars[0].style.textDecorationStyle, 'dotted');
  assert.deepEqual(chars[0].style.textDecorationThickness, settings.textDecorationThickness);
  assert.equal(chars[0].style.textDecorationSkipInk, true);
  assert.equal(chars[1].style.textDecorationStyle, 'wavy');
  assert.deepEqual(textDecorationDefaults({ textDecorationStyle: chars[1].style.textDecorationStyle }), {
    textDecorationStyle: 'wavy', textDecorationThickness: { unit: 'auto' }, textDecorationOffset: { unit: 'auto' }, textDecorationColor: 'auto', textDecorationSkipInk: false
  });
});

test('rich-run editing and selection compare object-valued decoration styles structurally', () => {
  const runs = [{ text: 'ab', textDecorationThickness: { unit: 'pixels', value: 2 } }, { text: 'cd', textDecorationThickness: { unit: 'pixels', value: 2 } }];
  assert.deepEqual(transformTextRunsInRange(runs, 0, 4, 'textDecorationOffset', { unit: 'pixels', value: -1 }), [
    { text: 'abcd', textDecorationThickness: { unit: 'pixels', value: 2 }, textDecorationOffset: { unit: 'pixels', value: -1 } }
  ]);
  assert.equal(summarizeTextRunRange(runs, 0, 4, run => run.textDecorationThickness).mixed, false);
});
