import test from 'node:test';
import assert from 'node:assert/strict';
import { drawTextDecoration, drawTrackedText, measureTrackedText, wrapText } from '../src/renderer.js';

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
