import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTextDecoration, drawTextRuns, drawTrackedText, hitTestPage, measureTrackedText, wrapText } from '../src/renderer.js';
import { addNode, addVariableMode, bindVariable, createDocument, createNode, createVariable, createVariableCollection, setFrameVariableMode, setVariableValue } from '../src/model.js';

function textContext({ nativeTracking = false } = {}) {
  const calls = [];
  const context = {
    calls,
    measureText(value) {
      const width = [...String(value)].reduce((total, character) => total + (character === ' ' ? 5 : 10), 0);
      return { width: value === 'AV' ? width - 1 : width };
    },
    fillText(...args) { calls.push(args); }
  };
  if (nativeTracking) context.letterSpacing = '';
  return context;
}

test('text tracking affects measured line width and wrapping', () => {
  const context = textContext();
  assert.equal(measureTrackedText(context, 'ab cd', 0), 45);
  assert.equal(measureTrackedText(context, 'ab cd', 2), 53);
  assert.deepEqual(wrapText(context, 'ab cd', 46, 0), ['ab cd']);
  assert.deepEqual(wrapText(context, 'ab cd', 46, 2), ['ab', 'cd']);
});

test('fallback text tracking retains pair kerning and native tracking restores canvas state', () => {
  const fallback = textContext();
  drawTrackedText(fallback, 'AV', 4, 8, 2);
  assert.deepEqual(fallback.calls, [['A', 4, 8], ['V', 15, 8]]);

  const native = textContext({ nativeTracking: true });
  drawTrackedText(native, 'AV', 4, 8, 2, 100);
  assert.deepEqual(native.calls, [['AV', 4, 8, 100]]);
  assert.equal(native.letterSpacing, '');
});

test('text decorations draw a style-colored line below or through the measured text', () => {
  const calls = [];
  const context = {
    fillStyle: '#123456', strokeStyle: '', lineWidth: 0,
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); },
    beginPath() { calls.push(['begin']); }, moveTo(x, y) { calls.push(['move', x, y]); },
    lineTo(x, y) { calls.push(['line', x, y]); }, stroke() { calls.push(['stroke']); }
  };
  assert.equal(drawTextDecoration(context, 12, 8, 40, 20, 'underline'), true);
  assert.deepEqual(calls.slice(0, 4), [['save'], ['begin'], ['move', 12, 28.6], ['line', 52, 28.6]]);
  assert.equal(context.strokeStyle, '#123456');
  assert.equal(context.lineWidth, 1.25);
  calls.length = 0;
  drawTextDecoration(context, 4, 10, 25, 20, 'line-through');
  assert.deepEqual(calls.filter(call => ['move', 'line'].includes(call[0])), [['move', 4, 21], ['line', 29, 21]]);
  assert.equal(drawTextDecoration(context, 0, 0, 0, 20, 'underline'), false);
  assert.equal(drawTextDecoration(context, 0, 0, 20, 20, 'none'), false);
});

function richContext() {
  const calls = [];
  const stack = [];
  const context = {
    calls, font: '400 10px Arial', fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1,
    textAlign: 'left', textBaseline: 'alphabetic',
    save() { stack.push({ font: this.font, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, textAlign: this.textAlign, textBaseline: this.textBaseline }); },
    restore() { Object.assign(this, stack.pop()); },
    translate(x, y) { calls.push({ transform: 'translate', x, y }); },
    scale(x, y) { calls.push({ transform: 'scale', x, y }); },
    beginPath() { calls.push({ path: 'begin' }); },
    moveTo(x, y) { calls.push({ path: 'move', x, y }); },
    lineTo(x, y) { calls.push({ path: 'line', x, y }); },
    stroke() { calls.push({ path: 'stroke', strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }); },
    measureText(text) {
      const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 10);
      return { width: [...String(text)].length * size * .5 };
    },
    fillText(text, x, y) { calls.push({ text, x, y, font: this.font, fillStyle: this.fillStyle }); }
  };
  return context;
}

const defaultRunStyle = {
  fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
  lineHeight: 1.25, letterSpacing: 0, color: '#000000', textDecoration: 'none', align: 'left', fillOpacity: 1
};

test('rich text draws each run with inherited or overridden font, color, and decoration', () => {
  const context = richContext();
  const result = drawTextRuns(context, [
    { text: 'Tiny ' },
    { text: 'Star', fontWeight: 700, color: '#ff0000', textDecoration: 'underline' }
  ], 4, 8, 100, defaultRunStyle);

  assert.equal(result.lines.length, 1);
  const draws = context.calls.filter(call => call.text);
  assert.deepEqual(draws.map(({ text }) => text), ['Tiny ', 'Star']);
  assert.equal(draws[0].font, '400 10px Arial, sans-serif');
  assert.equal(draws[0].fillStyle, 'rgba(0, 0, 0, 1)');
  assert.equal(draws[1].font, '700 10px Arial, sans-serif');
  assert.equal(draws[1].fillStyle, 'rgba(255, 0, 0, 1)');
  assert.ok(context.calls.some(call => call.transform === 'translate' && call.x === 4 && call.y === 8));
  assert.ok(context.calls.some(call => call.path === 'stroke' && call.strokeStyle === 'rgba(255, 0, 0, 1)'), 'run decoration should inherit its run color');
});

test('rich text wraps using each run font and advances lines for larger styles', () => {
  const context = richContext();
  const result = drawTextRuns(context, [
    { text: 'red words ' },
    { text: 'split', fontSize: 20, fontWeight: 700 }
  ], 0, 2, 55, defaultRunStyle);

  assert.deepEqual(result.lines.map(line => line.map(part => part.text).join('')), ['red words', 'split']);
  assert.ok(context.calls.some(call => call.transform === 'translate' && call.y === 2 + 12.5), 'second line should follow the first line’s 10px font metrics');
  assert.equal(result.height, 37.5, 'the second line contributes its 20px font metrics');
});

test('rich text case changes preserve run boundaries even when Unicode casing expands', () => {
  const context = richContext();
  const result = drawTextRuns(context, [
    { text: 'straße' },
    { text: ' mix', fontWeight: 700 }
  ], 0, 0, 200, { ...defaultRunStyle, textCase: 'uppercase' });

  assert.equal(result.lines.map(line => line.map(part => part.text).join('')).join(''), 'STRASSE MIX');
  assert.deepEqual(context.calls.filter(call => call.text).map(call => call.text), ['straße'.toUpperCase(), ' MIX']);
  assert.equal(context.calls.filter(call => call.text)[1].font, '700 10px Arial, sans-serif');
});

test('hit testing follows mode-resolved geometry and rotation', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Layout');
  const compact = collection.defaultModeId;
  const expanded = addVariableMode(document, collection.id, 'Expanded');
  const x = createVariable(document, collection.id, 'X', 'number', 0);
  const y = createVariable(document, collection.id, 'Y', 'number', 0);
  const width = createVariable(document, collection.id, 'Width', 'number', 20);
  const height = createVariable(document, collection.id, 'Height', 'number', 10);
  const rotation = createVariable(document, collection.id, 'Rotation', 'number', 0);
  for (const [variable, value] of [[x, 40], [y, 20], [width, 40], [height, 20], [rotation, 90]]) assert.equal(setVariableValue(document, variable.id, value, expanded.id), true);
  const frame = createNode('frame');
  const card = createNode('rectangle', { x: 5, y: 5, width: 5, height: 5 });
  addNode(document, frame); addNode(document, card, { parentId: frame.id });
  for (const [property, variable] of Object.entries({ x, y, width, height, rotation })) assert.equal(bindVariable(document, card.id, variable.id, property), true);
  assert.equal(hitTestPage(document.pages[0], { x: 10, y: 10 }, null, document)?.id, card.id);
  assert.equal(hitTestPage(document.pages[0], { x: 50, y: 10 }, null, document)?.id, frame.id);
  assert.equal(setFrameVariableMode(document, frame.id, collection.id, expanded.id), true);
  assert.equal(hitTestPage(document.pages[0], { x: 10, y: 10 }, null, document)?.id, frame.id);
  assert.equal(hitTestPage(document.pages[0], { x: 60, y: 45 }, null, document)?.id, card.id);
  assert.equal(hitTestPage(document.pages[0], { x: 45, y: 15 }, null, document)?.id, frame.id, 'rotated resolved bounds should reject an unrotated-only hit');
  assert.equal(compact, collection.defaultModeId);
});
