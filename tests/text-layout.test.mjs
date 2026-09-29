import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, validateDocument } from '../src/model.js';
import { calculateTextBox, transformTextCase } from '../src/text-layout.js';

function context() {
  return {
    font: '',
    measureText(text) {
      return { width: [...String(text)].reduce((width, character) => width + (character === ' ' ? 5 : 10), 0) };
    }
  };
}

function fontAwareContext() {
  return {
    font: '',
    measureText(text) {
      const size = Number(/([\d.]+)px/.exec(this.font)?.[1] || 10);
      return { width: [...String(text)].length * size / 2 };
    }
  };
}

test('auto-width fits the widest explicit line and keeps newline height', () => {
  const node = createNode('text', { text: 'one\ntwo words', fontSize: 20, lineHeight: 1.25, letterSpacing: 2, textFit: 'auto-width' });
  assert.deepEqual(calculateTextBox(context(), node), { width: 103, height: 54 });
});

test('auto-height wraps to the fixed width while fixed text keeps its explicit box', () => {
  const ctx = context();
  const node = createNode('text', { text: 'one two three', width: 50, height: 22, fontSize: 10, lineHeight: 1.2, textFit: 'auto-height' });
  assert.deepEqual(calculateTextBox(ctx, node), { width: 50, height: 40 });
  node.textFit = 'fixed';
  assert.deepEqual(calculateTextBox(ctx, node), { width: 50, height: 22 });
});

test('rich text auto-sizing uses each run font, wrapping, and maximum line metrics', () => {
  const node = createNode('text', {
    text: 'one two', width: 70, height: 20, fontSize: 10, lineHeight: 1,
    textFit: 'auto-height',
    textRuns: [
      { text: 'one ', fontSize: 20 },
      { text: 'two', fontSize: 30, lineHeight: 1.5, fontWeight: 700 }
    ]
  });
  const ctx = fontAwareContext();
  assert.deepEqual(calculateTextBox(ctx, node), { width: 70, height: 69 });
  assert.equal(ctx.font, '400 10px Inter, Arial, sans-serif', 'rich measurement restores the node-wide font after measuring overrides');

  node.textFit = 'auto-width';
  assert.deepEqual(calculateTextBox(fontAwareContext(), node), { width: 87, height: 49 });
});

test('rich text sizing falls back to the legacy uniform path when runs do not match text', () => {
  const plain = createNode('text', { text: 'one two', width: 30, fontSize: 10, textFit: 'auto-height' });
  const mismatched = createNode('text', { ...plain, textRuns: [{ text: 'other text' }] });
  assert.deepEqual(calculateTextBox(context(), mismatched), calculateTextBox(context(), plain));
});

test('text case transformation is Unicode aware and feeds auto sizing', () => {
  assert.equal(transformTextCase('hello world', 'uppercase'), 'HELLO WORLD');
  assert.equal(transformTextCase('HELLO WORLD', 'lowercase'), 'hello world');
  assert.equal(transformTextCase("élan café don't", 'capitalize'), "Élan Café Don't");
  assert.equal(transformTextCase('hello world', 'none'), 'hello world');

  const node = createNode('text', { text: 'straße', textCase: 'uppercase', textFit: 'auto-width', fontSize: 10, lineHeight: 1 });
  assert.equal(calculateTextBox(context(), node).width, 72, 'expanded uppercase glyphs are included in the measured text width');
});

test('text resize modes are valid only on text layers and persist in design documents', () => {
  const document = createDocument();
  const text = createNode('text', { textFit: 'auto-width' });
  addNode(document, text);
  assert.equal(validateDocument(document), true);
  const invalid = structuredClone(document);
  invalid.pages[0].children[0].textFit = 'content-fit';
  assert.throws(() => validateDocument(invalid), /Invalid text resize mode/);
  const nonText = createNode('rectangle', { textFit: 'fixed' });
  addNode(document, nonText);
  assert.throws(() => validateDocument(document), /Invalid text resize mode/);
});

test('text case and decoration accept only supported values on text layers', () => {
  const document = createDocument();
  const text = createNode('text', { textCase: 'uppercase', textDecoration: 'underline' });
  addNode(document, text);
  assert.equal(validateDocument(document), true);
  for (const [property, invalidValue] of [['textCase', 'title-case'], ['textDecoration', 'overline']]) {
    const invalid = structuredClone(document);
    invalid.pages[0].children[0][property] = invalidValue;
    assert.throws(() => validateDocument(invalid), property === 'textCase' ? /Invalid text case/ : /Invalid text decoration/);
  }
  const nonText = createNode('rectangle', { textDecoration: 'underline' });
  addNode(document, nonText);
  assert.throws(() => validateDocument(document), /Invalid text decoration/);
});
