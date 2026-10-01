import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clipboardImageFilename, getClipboardImageFiles, routeClipboardPaste } from '../src/image-clipboard.js';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const paritySmoke = await readFile(new URL('./editor-parity-smoke.mjs', import.meta.url), 'utf8');

function makeFile(type, name = 'source-image.png') {
  return { type, name, size: 4 };
}

function makePasteEvent(clipboardData) {
  return {
    clipboardData,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

test('clipboard image extraction keeps raster files ordered and ignores text items', () => {
  const first = makeFile('image/png');
  const second = makeFile('image/jpeg', 'photo.jpg');
  const clipboardData = {
    items: [
      { kind: 'string', getAsFile: () => makeFile('image/png') },
      { kind: 'file', getAsFile: () => first },
      { kind: 'file', getAsFile: () => second },
      { kind: 'file', getAsFile: () => null },
    ],
    files: [first, second],
  };
  assert.deepEqual(getClipboardImageFiles(clipboardData), [first, second]);
});

test('clipboard image extraction falls back to files and deduplicates repeated objects', () => {
  const image = makeFile('image/webp');
  const clipboardData = {
    items: [
      { kind: 'file', getAsFile: () => image },
      { kind: 'file', getAsFile: () => image },
    ],
    files: [image],
  };
  assert.deepEqual(getClipboardImageFiles(clipboardData), [image]);
  assert.deepEqual(getClipboardImageFiles({ items: [], files: [image] }), [image]);
  assert.deepEqual(getClipboardImageFiles({ items: [], files: [makeFile('text/plain')] }), []);
});

test('pasting an external image prefers it over stale layer clipboard and imports locally', () => {
  const image = makeFile('image/jpeg');
  const event = makePasteEvent({ items: [{ kind: 'file', getAsFile: () => image }] });
  let imported = null;
  let pastedLayers = 0;
  const result = routeClipboardPaste(event, {
    hasLayerClipboard: true,
    importImages: files => { imported = files; },
    pasteLayers: () => { pastedLayers += 1; },
  });
  assert.equal(result, 'images');
  assert.equal(event.prevented, true);
  assert.deepEqual(imported, [image]);
  assert.equal(pastedLayers, 0);
});

test('clipboard routing preserves editable text and native text paste', () => {
  const image = makeFile('image/png');
  const imageEvent = makePasteEvent({ items: [{ kind: 'file', getAsFile: () => image }] });
  assert.equal(routeClipboardPaste(imageEvent, { isEditingText: true }), 'ignored');
  assert.equal(imageEvent.prevented, false);
  const textEvent = makePasteEvent({ items: [{ kind: 'string', getAsFile: () => null }] });
  assert.equal(routeClipboardPaste(textEvent), 'unhandled');
  assert.equal(textEvent.prevented, false);
});

test('internal layer paste remains available and disabled editor states are untouched', () => {
  let pastedLayers = 0;
  const event = makePasteEvent({ items: [] });
  assert.equal(routeClipboardPaste(event, { hasLayerClipboard: true, pasteLayers: () => { pastedLayers += 1; } }), 'layers');
  assert.equal(event.prevented, true);
  assert.equal(pastedLayers, 1);
  const blocked = makePasteEvent({ items: [] });
  assert.equal(routeClipboardPaste(blocked, { canEdit: false, hasLayerClipboard: true }), 'ignored');
  assert.equal(blocked.prevented, false);
  assert.equal(clipboardImageFilename('image/jpeg', 2), 'pasted-image-2.jpg');
  assert.equal(clipboardImageFilename('image/unknown', 0), 'pasted-image-1.png');
});

test('editor routes the native paste event through local image placement and defers shortcut routing', () => {
  assert.match(mainSource, /document\.addEventListener\('paste', onDocumentPaste\)/);
  assert.match(mainSource, /routeClipboardPaste\(event,\s*\{[\s\S]*?hasLayerClipboard: hasClipboardLayers\(\)[\s\S]*?importImages: files => \{ void importImageFiles\(files\); \}/);
  assert.match(mainSource, /if \(mod && key === 'v'\) return;/,
    'Ctrl/Cmd+V must reach the browser paste event so external image bytes are available');
  assert.match(paritySmoke, /clipboard image bytes should be retained in local image storage/,
    'the eventual browser parity batch should verify real clipboard event storage and source bytes');
});
