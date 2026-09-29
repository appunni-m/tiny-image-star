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
