import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CLICK_FRAME_SIZE, frameSizeForCanvasClick } from '../src/frame-creation-size.js';

test('a first top-level Frame-tool click creates a 100 by 100 frame', () => {
  assert.deepEqual(DEFAULT_CLICK_FRAME_SIZE, { width: 100, height: 100 });
  assert.deepEqual(frameSizeForCanvasClick(), { width: 100, height: 100 });
});

test('top-level Frame-tool clicks repeat the last top-level frame size', () => {
  assert.deepEqual(frameSizeForCanvasClick({ width: 393, height: 852 }), { width: 393, height: 852 });
  assert.deepEqual(frameSizeForCanvasClick({ width: 1440, height: 900 }), { width: 1440, height: 900 });
});

test('a click inside a container creates a default 100 by 100 nested frame', () => {
  assert.deepEqual(frameSizeForCanvasClick({ width: 1440, height: 900 }, { nested: true }), { width: 100, height: 100 });
});

test('invalid remembered dimensions fall back to the safe default', () => {
  assert.deepEqual(frameSizeForCanvasClick({ width: Infinity, height: 900 }), { width: 100, height: 100 });
  assert.deepEqual(frameSizeForCanvasClick({ width: 1440, height: 0 }), { width: 100, height: 100 });
});

test('the editor remembers top-level Frame-tool click dimensions per open design and accepts both Figma shortcuts', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /const topLevelFrameSizesByDocument = new Map\(\)/);
  assert.match(source, /frameSizeForCanvasClick\(topLevelFrameSizesByDocument\.get\(state\.document\.id\),\s*\{\s*nested: Boolean\(clickParent\)\s*\}\)/);
  assert.match(source, /if \(node\.type === 'frame' && !parent\)\s*\{\s*topLevelFrameSizesByDocument\.set\(state\.document\.id, \{ width: node\.width, height: node\.height \}\)/);
  assert.match(source, /topLevelFrameSizesByDocument\.set\(state\.document\.id, \{ width: preset\.width, height: preset\.height \}\)/);
  assert.match(source, /a: 'frame', f: 'frame'/);
  assert.match(source, /key === 'a' && event\.shiftKey/,
    'Shift+A must remain available for Figma’s auto-layout shortcut');
});
