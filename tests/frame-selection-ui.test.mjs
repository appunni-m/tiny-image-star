import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, readme] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
]);

test('Frame selection is available from natural-language help and explains what it changes', () => {
  assert.match(main, /id: 'frame-selection', label: 'Frame selection'[\s\S]*?Wrap selected sibling layers in a transparent, clipping frame\. Auto-layout may reposition the wrapper and reflow siblings\.[\s\S]*?keywords: \['frame selection', 'wrap in frame'/);
  assert.match(main, /frameSelectionUnavailableReason = batchReason[\s\S]*?Select one or more layers first\.[\s\S]*?Choose unlocked layers that share a parent container\./);
});

test('Frame selection is available from layer context menus and the platform shortcut', () => {
  assert.match(main, /canFrameSelection\(state\.document, rootSelectedIds\(\)\)[\s\S]*?label: 'Frame selection', shortcut: propertyClipboardShortcut\('g'\), action: frameSelectedLayers/);
  assert.match(main, /mod && event\.altKey && !event\.shiftKey && key === 'g'[\s\S]*?frameSelectedLayers\(\)/,
    'Option/Alt+Command/Ctrl+G should wrap the selection before plain Command/Ctrl+G is considered');
  assert.match(readme, /Frame selection[\s\S]*?⌥⌘G[\s\S]*?Ctrl\+Alt\+G/);
});
