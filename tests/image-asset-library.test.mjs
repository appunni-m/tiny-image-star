import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addImageLibraryEntries,
  addImageLibraryEntry,
  isValidImageLibraryEntry,
  isValidImageLibraryManifest,
  listImageLibraryEntries,
  migrateImageLibraryEntry,
  MAX_IMAGE_LIBRARY_ENTRIES,
  MAX_IMAGE_LIBRARY_SOURCE_PIXELS,
  removeImageLibraryEntry
} from '../src/image-asset-library.js';
import { createDocument, parseDocument, serializeDocument, validateDocument } from '../src/model.js';

function source(overrides = {}) {
  return { assetId: 'asset-one', name: 'portrait.png', type: 'image/png', width: 1200, height: 800, ...overrides };
}

test('image library entries add idempotently, deduplicate by stable asset ID, and list detached metadata', () => {
  const document = createDocument();
  const first = addImageLibraryEntry(document, source());
  assert.deepEqual(first, source());

  const duplicate = addImageLibraryEntry(document, source());
  assert.deepEqual(duplicate, first);
  assert.equal(document.imageLibrary.length, 1);

  const additions = addImageLibraryEntries(document, [
    source(),
    source({ assetId: 'asset-two', name: 'mark.webp', type: 'image/webp', width: 320, height: 240 })
  ]);
  assert.deepEqual(additions.map(item => item.assetId), ['asset-two']);
  assert.deepEqual(listImageLibraryEntries(document).map(item => item.assetId), ['asset-one', 'asset-two']);

  const listed = listImageLibraryEntries(document);
  listed[0].name = 'mutated outside document.png';
  assert.equal(document.imageLibrary[0].name, 'portrait.png');
});

test('image library add is atomic and rejects conflicting metadata for an existing source ID', () => {
  const document = createDocument();
  addImageLibraryEntry(document, source());
  const before = structuredClone(document.imageLibrary);

  assert.throws(() => addImageLibraryEntries(document, [
    source({ assetId: 'asset-two' }),
    source({ name: 'different-source-name.png' })
  ]), /already exists with different metadata/);
  assert.deepEqual(document.imageLibrary, before, 'a failed batch must not partially append new sources');
});

test('image library removal removes only the manifest entry and reports missing IDs', () => {
  const document = createDocument();
  addImageLibraryEntries(document, [source(), source({ assetId: 'asset-two', name: 'two.jpg', type: 'image/jpeg' })]);

  assert.equal(removeImageLibraryEntry(document, 'asset-one'), true);
  assert.deepEqual(listImageLibraryEntries(document).map(item => item.assetId), ['asset-two']);
  assert.equal(removeImageLibraryEntry(document, 'asset-one'), false);
  assert.equal(removeImageLibraryEntry(document, '  '), false);
});

test('image library metadata rejects unsafe identities, names, types, dimensions, and extra fields', () => {
  const invalidEntries = [
    source({ assetId: '' }),
    source({ assetId: 'asset one' }),
    source({ name: '../portrait.png' }),
    source({ name: 'bad\u0000name.png' }),
    source({ type: 'text/plain' }),
    source({ type: 'image/png; charset=utf-8' }),
    source({ width: 0 }),
    source({ height: 1.5 }),
    source({ width: MAX_IMAGE_LIBRARY_SOURCE_PIXELS + 1, height: 1 }),
    { ...source(), storagePath: '../private-folder/portrait.png' }
  ];
  for (const entry of invalidEntries) {
    assert.equal(isValidImageLibraryEntry(entry), false, JSON.stringify(entry));
    const document = createDocument();
    assert.throws(() => addImageLibraryEntry(document, entry), /Invalid image library entry/);
    assert.deepEqual(document.imageLibrary, [], 'invalid metadata must not mutate the document');
  }
  assert.equal(isValidImageLibraryEntry(source({ type: '' })), true, 'an empty browser MIME hint is allowed');
});

test('image library manifest rejects duplicate IDs, malformed entries, and excessive size', () => {
  assert.equal(isValidImageLibraryManifest([source()]), true);
  assert.equal(isValidImageLibraryManifest([source(), source()]), false);
  assert.equal(isValidImageLibraryManifest([source({ width: 0 })]), false);
  assert.equal(isValidImageLibraryManifest(new Array(MAX_IMAGE_LIBRARY_ENTRIES + 1)), false);
  assert.equal(isValidImageLibraryManifest(null), false);
});

test('legacy documents without an image library remain valid and gain an empty default when parsed', () => {
  const legacy = createDocument();
  delete legacy.imageLibrary;

  assert.equal(validateDocument(legacy), true);
  const serializedLegacy = serializeDocument(legacy);
  assert.equal(Object.hasOwn(JSON.parse(serializedLegacy), 'imageLibrary'), false,
    'serialization preserves the original legacy shape until it is loaded');
  assert.deepEqual(parseDocument(serializedLegacy).imageLibrary, []);
});

test('image library manifest is validated and round-trips in local documents', () => {
  const document = createDocument();
  addImageLibraryEntries(document, [source(), source({
    assetId: 'asset-two', name: 'photo-without-mime', type: '', width: 640, height: 480
  })]);

  const reopened = parseDocument(serializeDocument(document));
  assert.deepEqual(reopened.imageLibrary, document.imageLibrary);
  assert.equal(validateDocument(reopened), true);

  const duplicate = structuredClone(document);
  duplicate.imageLibrary.push(source());
  assert.throws(() => validateDocument(duplicate), /Invalid image library manifest/);

  const malformed = structuredClone(document);
  malformed.imageLibrary[0].type = 'text/plain';
  assert.throws(() => validateDocument(malformed), /Invalid image library manifest/);

  const nullManifest = structuredClone(document);
  nullManifest.imageLibrary = null;
  assert.throws(() => validateDocument(nullManifest), /Invalid image library manifest/);
});

test('legacy image migration sanitizes metadata and skips individually invalid or oversized sources', () => {
  const valid = migrateImageLibraryEntry({
    assetId: 'legacy-photo', name: 'folder\\Portrait.png', node: { sourceWidth: 20, sourceHeight: 10 }
  }, { name: 'folder\\Portrait.png', type: 'image/png', dimensions: { width: 40, height: 30 } });
  assert.deepEqual(valid, {
    assetId: 'legacy-photo', name: 'Portrait.png', type: 'image/png', width: 40, height: 30
  });
  assert.equal(migrateImageLibraryEntry({
    assetId: 'oversized-photo', name: 'large.png', node: { sourceWidth: 10_000, sourceHeight: 10_000 }
  }, { dimensions: { width: 10_000, height: 10_000 } }), null,
  'one oversized legacy source is skipped instead of invalidating the entire migration batch');
  assert.equal(migrateImageLibraryEntry({ assetId: 'no-dimensions' }, null), null);
});
