import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrototypeKeyboardKey, normalizePrototypeKeyModifiers, prototypeKeyboardEventMatches } from '../src/prototype-keyboard.js';

test('keyboard key normalization accepts standard named, function, and single-character keys', () => {
  for (const [input, expected] of [['enter', 'Enter'], [' ', 'Space'], ['Esc', 'Escape'], ['arrowleft', 'ArrowLeft'], ['f12', 'F12'], ['A', 'a'], ['7', '7']]) {
    assert.equal(normalizePrototypeKeyboardKey(input), expected);
  }
  for (const input of ['', 'NotAKey', 'F13', 'ab', 4, null]) assert.equal(normalizePrototypeKeyboardKey(input), null);
});

test('keyboard modifiers are strict booleans and shortcuts require an exact modifier match', () => {
  assert.deepEqual(normalizePrototypeKeyModifiers({ shift: true }), { shift: true, control: false, alt: false, meta: false });
  assert.equal(normalizePrototypeKeyModifiers({ shift: 1 }), null);
  assert.equal(normalizePrototypeKeyModifiers({ command: true }), null);
  const expected = { control: true };
  const event = { key: 'A', shiftKey: false, ctrlKey: true, altKey: false, metaKey: false };
  assert.equal(prototypeKeyboardEventMatches('a', expected, event), true);
  assert.equal(prototypeKeyboardEventMatches('a', expected, { ...event, altKey: true }), false);
  assert.equal(prototypeKeyboardEventMatches('b', expected, event), false);
});
