import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, createFillLayer, addNode, createComponent, createComponentInstance, findNode, syncComponentInstances } from '../src/model.js';
import { createImageFill } from '../src/image-fills.js';
import { packLocalPackage } from '../src/storage.js';
import {
  deleteStoredDocument, duplicateStoredDocument, listSavedDocuments, loadDocumentById,
  deleteFontAsset, importLocalPackage, listDocumentVersions, listFontAssets, loadDocumentVersion, loadFontAsset, loadImageAsset, loadImageAssetMetadata, loadLatestDocument, renameStoredDocument, saveDocument, saveDocumentVersion, saveFontAsset, saveImageAssetBytes
} from '../src/storage.js';

function createIndexedDbMock({ legacyAssets = [], legacyFonts = [] } = {}) {
  const stores = new Map();
  const clone = value => structuredClone(value);
  const observations = { cursorRecordsRead: 0, fontCursorRecordsRead: 0, fontBinaryGets: [], fontBinaryGetAllCalls: 0, openVersion: null };
  const database = {
    objectStoreNames: { contains: name => stores.has(name) },
    close() { this.closed = true; },
    createObjectStore(name, { keyPath }) {
      const store = { keyPath, records: new Map(), indexes: new Map() };
      stores.set(name, store);
      return {
        createIndex(indexName, indexKeyPath) { store.indexes.set(indexName, indexKeyPath); },
        indexNames: { contains: indexName => store.indexes.has(indexName) }
      };
    },
    transaction(names) {
      const transaction = {};
      let completionScheduled = false;
      const completeSoon = () => {
        if (completionScheduled) return;
        completionScheduled = true;
        queueMicrotask(() => transaction.oncomplete?.());
      };
      transaction.objectStore = name => {
        const store = stores.get(name);
        return {
          put(record) { store.records.set(record[store.keyPath], clone(record)); completeSoon(); },
          add(record) {
            if (store.records.has(record[store.keyPath])) throw new Error('ConstraintError');
            store.records.set(record[store.keyPath], clone(record)); completeSoon();
          },
          delete(key) { store.records.delete(key); completeSoon(); },
          get(key) {
            const request = {};
            if (name === 'fontAssets') observations.fontBinaryGets.push(key);
            queueMicrotask(() => {
              request.result = clone(store.records.get(key));
              request.onsuccess?.();
              completeSoon();
            });
            return request;
          },
          getAll() {
            const request = {};
            if (name === 'fontAssets') observations.fontBinaryGetAllCalls += 1;
            queueMicrotask(() => {
              request.result = [...store.records.values()].map(clone);
              request.onsuccess?.();
              completeSoon();
            });
            return request;
          },
          index(indexName) {
            const keyPath = store.indexes.get(indexName);
            if (!keyPath) throw new Error(`Unknown index ${indexName}.`);
            return {
              getAll(query) {
                const request = {};
                queueMicrotask(() => {
                  request.result = [...store.records.values()]
                    .filter(record => query === undefined || record[keyPath] === query)
                    .map(clone);
                  request.onsuccess?.();
                  completeSoon();
                });
                return request;
              }
            };
          },
          openCursor() {
            const request = {};
            const records = [...store.records.values()].map(clone);
            let index = 0;
            const advance = () => queueMicrotask(() => {
              if (index >= records.length) {
                request.result = null;
                request.onsuccess?.();
                completeSoon();
                return;
              }
              if (name === 'fontAssets') observations.fontCursorRecordsRead += 1;
              else if (name === 'assets') observations.cursorRecordsRead += 1;
              const value = records[index];
              request.result = {
                value,
                continue() { index += 1; advance(); }
              };
              request.onsuccess?.();
            });
            advance();
            return request;
          }
        };
      };
      return transaction;
    },
    seed(name, record) { stores.get(name)?.records.set(record[stores.get(name).keyPath], clone(record)); }
  };
  return {
    database,
    observations,
    open(_name, version) {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        observations.openVersion = version;
        if (legacyAssets.length) {
          if (!stores.has('documents')) database.createObjectStore('documents', { keyPath: 'id' });
          if (!stores.has('assets')) database.createObjectStore('assets', { keyPath: 'id' });
          for (const asset of legacyAssets) database.seed('assets', asset);
        }
        if (legacyFonts.length) {
          if (!stores.has('documents')) database.createObjectStore('documents', { keyPath: 'id' });
          if (!stores.has('assets')) database.createObjectStore('assets', { keyPath: 'id' });
          if (!stores.has('fontAssets')) database.createObjectStore('fontAssets', { keyPath: 'id' });
          for (const font of legacyFonts) database.seed('fontAssets', font);
        }
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
}

test('a failed IndexedDB open can be retried instead of poisoning storage for the life of the tab', async () => {
  const successful = createIndexedDbMock();
  let opens = 0;
  globalThis.indexedDB = {
    open(...args) {
      opens += 1;
      if (opens > 1) return successful.open(...args);
      const request = {};
      queueMicrotask(() => {
        request.error = new Error('Temporary storage startup failure.');
        request.onerror?.();
      });
      return request;
    }
  };
  const { loadLatestDocument } = await import('../src/storage.js?retry-open-test');

  await assert.rejects(loadLatestDocument(), /Temporary storage startup failure/);
  assert.equal(await loadLatestDocument(), null);
  assert.equal(opens, 2, 'the retry should make a fresh IndexedDB open request');
});

test('a versionchange closes the cached connection and lets the next operation reopen storage', async () => {
  const indexedDb = createIndexedDbMock();
  let opens = 0;
  globalThis.indexedDB = { open(...args) { opens += 1; return indexedDb.open(...args); } };
  const { loadLatestDocument } = await import('../src/storage.js?versionchange-open-test');

  assert.equal(await loadLatestDocument(), null);
  assert.equal(opens, 1);
  assert.equal(typeof indexedDb.database.onversionchange, 'function');
  indexedDb.database.onversionchange();
  assert.equal(indexedDb.database.closed, true, 'the old connection should be released for schema upgrades');

  assert.equal(await loadLatestDocument(), null);
  assert.equal(opens, 2, 'future operations should create a new connection');
});

test('local library lists, retrieves, renames, duplicates, and deletes documents by stable ID', async () => {
  globalThis.indexedDB = createIndexedDbMock();
  const original = createDocument();
  original.name = 'Source design';
  const image = createNode('image', { assetId: 'library-asset', fileName: 'photo.png' });
  addNode(original, image);
  await saveDocument(original);
  const second = createDocument();
  second.name = 'Another design';
  await saveDocument(second);
  const bytes = new Uint8Array([0, 2, 4, 255]);
  await saveImageAssetBytes('library-asset', 'photo.png', 'image/png', bytes);

  const summaries = await listSavedDocuments();
  assert.deepEqual(new Set(summaries.map(item => item.id)), new Set([original.id, second.id]));
  assert.deepEqual(Object.keys(summaries[0]).sort(), ['id', 'name', 'savedAt']);
  assert.equal(summaries.find(item => item.id === original.id).name, 'Source design');
  assert.deepEqual(await loadDocumentById(original.id), original);
  assert.equal(await loadDocumentById('missing'), null);

  assert.equal(await renameStoredDocument(original.id, 'Renamed design'), true);
  assert.equal(await renameStoredDocument('missing', 'Missing'), false);
  assert.equal((await loadDocumentById(original.id)).name, 'Renamed design');
  await assert.rejects(renameStoredDocument(original.id, '  '), /1–120 characters/);

  const duplicate = await duplicateStoredDocument(original.id);
  assert.ok(duplicate.id && duplicate.id !== original.id);
  assert.equal(duplicate.name, 'Renamed design copy');
  assert.equal(duplicate.pages[0].children[0].assetId, 'library-asset');
  assert.equal((await loadDocumentById(original.id)).name, 'Renamed design');
  duplicate.pages[0].children[0].name = 'Changed only in copy';
  assert.notEqual((await loadDocumentById(original.id)).pages[0].children[0].name, 'Changed only in copy');
  assert.ok([original.id, second.id, duplicate.id].includes((await loadLatestDocument()).id),
    'the existing latest-document API continues to return a saved document');

  assert.equal(await deleteStoredDocument(original.id), true);
  assert.equal(await deleteStoredDocument(original.id), false);
  assert.equal(await loadDocumentById(original.id), null);
  assert.ok(await loadDocumentById(duplicate.id));
  assert.deepEqual(new Uint8Array((await loadImageAsset('library-asset')).bytes), bytes,
    'assets remain intact because the v1 asset store has no document ownership metadata');
});

test('local document versions deduplicate autosaves, retain named checkpoints, fence owners, and prune old snapshots', async () => {
  globalThis.indexedDB = createIndexedDbMock();
  const storage = await import('../src/storage.js?local-document-versions-test');
  const originalNow = Date.now;
  let clock = 10_000;
  Date.now = () => ++clock;
  try {
    const document = createDocument();
    document.name = 'History source';
    const first = await storage.saveDocumentVersion(document, { name: 'Initial canvas', limit: 2 });
    assert.ok(first?.id);
    assert.equal(await storage.saveDocumentVersion(document, { name: 'Autosaved version', limit: 2 }), null,
      'unchanged autosaves should not create duplicate versions');

    document.name = 'Edited canvas';
    const second = await storage.saveDocumentVersion(document, { name: 'Move title', limit: 2 });
    document.name = 'Current canvas';
    const third = await storage.saveDocumentVersion(document, { name: 'Change colors', limit: 2 });
    assert.deepEqual(new Set((await storage.listDocumentVersions(document.id)).map(version => version.id)), new Set([second.id, third.id]),
      'the per-design cap should prune only the oldest snapshot');
    assert.equal(await storage.loadDocumentVersion(first.id, document.id), null, 'a pruned snapshot should not be loadable');
    assert.equal(await storage.loadDocumentVersion(third.id, createDocument().id), null, 'version reads must be fenced to their owning document');
    assert.equal((await storage.loadDocumentVersion(third.id, document.id)).document.name, 'Current canvas');

    const named = await storage.saveDocumentVersion(document, { name: 'Launch review', force: true, limit: 2 });
    assert.equal(named.name, 'Launch review', 'manual versions may preserve the same canvas under a distinct name');
    document.name = 'After launch';
    const newest = await storage.saveDocumentVersion(document, { name: 'Autosaved after launch', limit: 2 });
    assert.deepEqual(new Set((await storage.listDocumentVersions(document.id)).map(version => version.id)), new Set([named.id, newest.id]));

    await storage.saveDocument(document);
    assert.equal(await storage.deleteStoredDocument(document.id), true);
    assert.deepEqual(await storage.listDocumentVersions(document.id), [], 'deleting a local design must remove its snapshots in the same storage operation');
  } finally {
    Date.now = originalNow;
  }
});

test('local font library stores validated bytes, lists metadata, and removes one face', async () => {
  globalThis.indexedDB = createIndexedDbMock();
  const font = {
    id: 'font-library-local', name: 'Local Display.woff2', type: 'font/woff2', family: 'Local Display', weight: 700, style: 'italic',
    bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6, 7, 8])
  };
  await saveFontAsset(font);
  const metadata = await listFontAssets();
  assert.ok(metadata.some(record => record.id === font.id && record.family === font.family && record.weight === 700 && record.style === 'italic'));
  assert.equal(Object.hasOwn(metadata.find(record => record.id === font.id), 'bytes'), false, 'font listings must not pull binaries into the UI catalog');
  assert.deepEqual((await loadFontAsset(font.id)).bytes, font.bytes);
  assert.equal(await deleteFontAsset(font.id), true);
  assert.equal(await loadFontAsset(font.id), null);
  assert.equal((await listFontAssets()).some(record => record.id === font.id), false, 'removal clears both the byte record and visible catalog entry');
  assert.equal(await deleteFontAsset(font.id), false);
});

test('font catalog migration stays metadata-only, writes cannot replace faces, and package checks load only matching binaries', async () => {
  const localBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6, 7, 8]);
  const unrelatedBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 8, 7, 6, 5, 4, 3, 2, 1]);
  const indexedDb = createIndexedDbMock({ legacyFonts: [
    { id: 'old-display', name: 'old.woff2', type: 'font/woff2', family: 'Legacy Display', weight: 400, style: 'normal', bytes: localBytes.buffer },
    { id: 'old-other', name: 'other.woff2', type: 'font/woff2', family: 'Unrelated Face', weight: 400, style: 'normal', bytes: unrelatedBytes.buffer }
  ] });
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?font-metadata-review-test');

  const catalog = await storage.listFontAssets();
  assert.deepEqual(catalog.map(font => [font.id, font.byteLength]), [['old-display', 12], ['old-other', 12]]);
  assert.equal(indexedDb.observations.openVersion, 6, 'the local version history and recipe recovery stores use a forward-only database upgrade');
  assert.equal(indexedDb.observations.fontCursorRecordsRead, 2, 'existing font metadata is backfilled one record at a time');
  assert.equal(indexedDb.observations.fontBinaryGetAllCalls, 0, 'font catalogs never materialize all installed binaries');
  assert.deepEqual(indexedDb.observations.fontBinaryGets, [], 'the migration cursor avoids point reads and duplicate copies');

  await assert.rejects(storage.saveFontAsset({
    id: 'replacement-id', name: 'replacement.woff2', type: 'font/woff2', family: 'Legacy Display', weight: 400, style: 'normal', bytes: unrelatedBytes
  }), /already installed/i, 'a second file cannot create an ambiguous face descriptor');
  await assert.rejects(storage.saveFontAsset({
    id: 'old-display', name: 'replacement.woff2', type: 'font/woff2', family: 'Different Family', weight: 400, style: 'normal', bytes: unrelatedBytes
  }), /ID is already installed/i, 'even a different face cannot overwrite a stable font ID');
  assert.deepEqual((await storage.loadFontAsset('old-display')).bytes, localBytes);

  const imported = await storage.importLocalPackage(createDocument(), [], [{
    id: 'incoming-display', name: 'incoming.woff2', type: 'font/woff2', family: 'Legacy Display', weight: 400, style: 'normal', bytes: unrelatedBytes
  }]);
  const alias = imported.fontFamilies.get('Legacy Display');
  assert.equal(alias, 'Legacy Display Imported');
  assert.deepEqual((await storage.loadFontAsset('old-display')).bytes, localBytes);
  assert.deepEqual((await storage.loadFontAsset(imported.fontIds.get('incoming-display'))).bytes, unrelatedBytes);
  assert.deepEqual(new Set(indexedDb.observations.fontBinaryGets), new Set(['old-display', 'incoming-display']));
  assert.equal(indexedDb.observations.fontBinaryGetAllCalls, 0, 'package import reads only descriptor-matching or ID-colliding font binaries');

  const reused = await storage.importLocalPackage(createDocument(), [], [{
    id: 'same-display', name: 'same.woff2', type: 'font/woff2', family: 'Legacy Display', weight: 400, style: 'normal', bytes: localBytes
  }]);
  assert.equal(reused.fontFamilies.has('Legacy Display'), false, 'byte-identical existing faces do not create needless family aliases');
  assert.equal(reused.fontIds.get('same-display'), 'old-display', 'byte-identical package fonts reuse their existing stable ID');
});

test('package font ID and family collisions are remapped without replacing local font bytes', async () => {
  globalThis.indexedDB = createIndexedDbMock();
  const localBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 1, 1, 1, 1, 1, 1, 1]);
  const incomingBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 2, 2, 2, 2, 2, 2, 2, 2]);
  await saveFontAsset({ id: 'font-collision', name: 'local.woff2', type: 'font/woff2', family: 'Package Sans', weight: 400, style: 'normal', bytes: localBytes });
  const incomingDocument = createDocument();
  const text = createNode('text', { fontFamily: 'package   sans, Arial, sans-serif', text: 'Portable' });
  addNode(incomingDocument, text);
  incomingDocument.typographyStyles = [{ id: 'text-style', name: 'Portable', fontFamily: '"package sans", serif', fontSize: 20, fontWeight: 400, fontStyle: 'normal', lineHeight: 1.2, letterSpacing: 0, paragraphSpacing: 0, firstLineIndent: 0, listSpacing: 0, align: 'left', verticalAlign: 'top', color: '#111111', textCase: 'none', textDecoration: 'none' }];

  const imported = await importLocalPackage(incomingDocument, [], [{
    id: 'font-collision', name: 'package.woff2', type: 'font/woff2', family: 'Package Sans', weight: 400, style: 'normal', bytes: incomingBytes
  }]);
  const remappedId = imported.fontIds.get('font-collision');
  const alias = imported.fontFamilies.get('Package Sans');
  assert.notEqual(remappedId, 'font-collision');
  assert.equal(alias, 'Package Sans Imported');
  assert.equal(imported.document.pages[0].children[0].fontFamily, `${alias}, Arial, sans-serif`, 'family remapping matches CSS family names case-insensitively');
  assert.equal(imported.document.typographyStyles[0].fontFamily, `"${alias}", serif`, 'quoted family stacks are remapped case-insensitively too');
  assert.deepEqual((await loadFontAsset('font-collision')).bytes, localBytes, 'an existing local font must never be overwritten');
  const importedFont = await loadFontAsset(remappedId);
  assert.equal(importedFont.family, alias);
  assert.deepEqual(importedFont.bytes, incomingBytes);
});

test('package import reuses identical sources and remaps asset and document collisions without replacement', async () => {
  globalThis.indexedDB = createIndexedDbMock();
  const originalBytes = new Uint8Array([1, 2, 3]);
  const incomingBytes = new Uint8Array([9, 8, 7]);
  await saveImageAssetBytes('shared-asset', 'original.png', 'image/png', originalBytes);
  const existingDocument = createDocument();
  existingDocument.name = 'Existing';
  await saveDocument(existingDocument);
  const incomingDocument = createDocument();
  incomingDocument.id = existingDocument.id;
  incomingDocument.name = 'Imported';
  addNode(incomingDocument, createNode('image', { assetId: 'shared-asset' }));

  const imported = await importLocalPackage(incomingDocument, [
    { id: 'shared-asset', name: 'imported.png', type: 'image/png', bytes: incomingBytes },
    { id: 'new-asset', name: 'new.png', type: 'image/png', bytes: originalBytes }
  ]);
  assert.notEqual(imported.assetIds.get('shared-asset'), 'shared-asset');
  assert.equal(imported.assetIds.get('new-asset'), 'new-asset');
  assert.notEqual(imported.document.id, existingDocument.id);
  assert.equal(imported.document.pages[0].children[0].assetId, imported.assetIds.get('shared-asset'));
  assert.deepEqual(new Uint8Array((await loadImageAsset('shared-asset')).bytes), originalBytes);
  assert.deepEqual(new Uint8Array((await loadImageAsset(imported.assetIds.get('shared-asset'))).bytes), incomingBytes);
  assert.equal((await loadDocumentById(existingDocument.id)).name, 'Existing');
  assert.equal((await loadDocumentById(imported.document.id)).name, 'Imported');

  const repeatedDocument = { ...incomingDocument, id: createDocument().id };
  const identical = await importLocalPackage(repeatedDocument, [
    { id: 'shared-asset', name: 'same-source.png', type: 'image/png', bytes: originalBytes }
  ]);
  assert.equal(identical.assetIds.get('shared-asset'), 'shared-asset');
  await assert.rejects(importLocalPackage(createDocument(), [
    { id: 'duplicate', name: 'a.png', type: 'image/png', bytes: originalBytes },
    { id: 'duplicate', name: 'b.png', type: 'image/png', bytes: incomingBytes }
  ]), /invalid or duplicate/i);
});

test('package import remaps secondary image-fill assets when an existing source ID collides', async () => {
  globalThis.indexedDB = createIndexedDbMock();
  const originalBytes = new Uint8Array([1, 2, 3]);
  const incomingBytes = new Uint8Array([9, 8, 7]);
  await saveImageAssetBytes('shared-texture', 'original.png', 'image/png', originalBytes);
  const incomingDocument = createDocument();
  const shape = createNode('rectangle', {
    fills: [
      { id: 'base-fill', type: 'solid', visible: true, opacity: 1, color: '#ffffff' },
      createFillLayer('image', { assetId: 'shared-texture' })
    ]
  });
  addNode(incomingDocument, shape);

  const imported = await importLocalPackage(incomingDocument, [
    { id: 'shared-texture', name: 'incoming.png', type: 'image/png', bytes: incomingBytes }
  ]);
  const importedShape = imported.document.pages[0].children[0];
  const imageFill = importedShape.fills.find(fill => fill.type === 'image').imageFill;
  const remappedId = imported.assetIds.get('shared-texture');

  assert.notEqual(remappedId, 'shared-texture');
  assert.equal(imageFill.assetId, remappedId, 'all active stacked image fills must follow the imported source remapping');
  assert.deepEqual(new Uint8Array((await loadImageAsset('shared-texture')).bytes), originalBytes,
    'the source design image remains intact');
  assert.deepEqual(new Uint8Array((await loadImageAsset(remappedId)).bytes), incomingBytes,
    'the imported image fill points at its own imported bytes');
});

test('package import remaps image sources in component overrides before later component sync', async () => {
  globalThis.indexedDB = createIndexedDbMock();
  const originalBytes = new Uint8Array([1, 2, 3]);
  const incomingBytes = new Uint8Array([9, 8, 7]);
  await saveImageAssetBytes('component-texture', 'original.png', 'image/png', originalBytes);
  const incomingDocument = createDocument();
  const root = createNode('frame', { name: 'Image component' });
  const legacyFill = createNode('rectangle', { name: 'Legacy image fill', imageFill: createImageFill('component-texture') });
  const stackedFill = createNode('rectangle', {
    name: 'Stacked image fill', fills: [createFillLayer('image', { assetId: 'component-texture' })]
  });
  addNode(incomingDocument, root);
  addNode(incomingDocument, legacyFill, { parentId: root.id });
  addNode(incomingDocument, stackedFill, { parentId: root.id });
  const component = createComponent(incomingDocument, root.id);
  const instance = createComponentInstance(incomingDocument, component.id);
  const instanceRoot = findNode(incomingDocument, instance.id).node;
  const legacyInstance = instanceRoot.children.find(node => node.componentSourceId === legacyFill.id);
  const stackedInstance = instanceRoot.children.find(node => node.componentSourceId === stackedFill.id);
  instanceRoot.componentOverrides[legacyFill.id] = { imageFill: structuredClone(legacyInstance.imageFill) };
  instanceRoot.componentOverrides[stackedFill.id] = { fills: structuredClone(stackedInstance.fills) };

  const imported = await importLocalPackage(incomingDocument, [
    { id: 'component-texture', name: 'incoming.png', type: 'image/png', bytes: incomingBytes }
  ]);
  const remappedId = imported.assetIds.get('component-texture');
  assert.notEqual(remappedId, 'component-texture');
  const importedInstance = findNode(imported.document, instance.id).node;
  assert.equal(importedInstance.componentOverrides[legacyFill.id].imageFill.assetId, remappedId);
  assert.equal(importedInstance.componentOverrides[stackedFill.id].fills[0].imageFill.assetId, remappedId);

  assert.equal(syncComponentInstances(imported.document, component.id), 1);
  const syncedInstance = findNode(imported.document, instance.id).node;
  assert.equal(syncedInstance.children.find(node => node.componentSourceId === legacyFill.id).imageFill.assetId, remappedId);
  assert.equal(syncedInstance.children.find(node => node.componentSourceId === stackedFill.id).fills[0].imageFill.assetId, remappedId,
    'a later component sync must retain the imported bytes rather than restore the colliding local asset ID');
});

test('package import rejects missing referenced source bytes before opening a write transaction', async () => {
  let openCalls = 0;
  globalThis.indexedDB = { open() { openCalls += 1; throw new Error('must not open'); } };
  const document = createDocument();
  addNode(document, createNode('image', { assetId: 'missing-package-source' }));

  await assert.rejects(importLocalPackage(document, []), /missing-package-source.*bytes are missing/i);
  assert.equal(openCalls, 0, 'incomplete package input is rejected before any storage writes begin');
});

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

test('image metadata is persisted atomically and can be read without source bytes', async () => {
  const indexedDb = createIndexedDbMock();
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?asset-metadata-save-test');
  const bytes = pngHeader(7, 5);

  await storage.saveImageAssetBytes('photo-7', 'photo.png', 'image/png', bytes);
  const metadata = await storage.loadImageAssetMetadata('photo-7');
  assert.deepEqual(metadata, {
    id: 'photo-7', name: 'photo.png', type: 'image/png', byteLength: bytes.byteLength,
    dimensions: { width: 7, height: 5, pixels: 35 }
  });
  assert.equal(Object.hasOwn(metadata, 'bytes'), false, 'catalog reads never return source image bytes');
  assert.deepEqual(new Uint8Array((await storage.loadImageAsset('photo-7')).bytes), bytes);
  assert.equal(await storage.loadImageAssetMetadata('missing'), null);
  assert.equal(indexedDb.observations.openVersion, 6, 'opening the store upgrades the legacy database schema for local fonts, metadata, versions, and recipe recovery');
});

test('legacy asset metadata is backfilled once, one source record at a time', async () => {
  const bytes = pngHeader(11, 3);
  const indexedDb = createIndexedDbMock({ legacyAssets: [{
    id: 'legacy-photo', name: 'legacy.png', type: 'image/png', bytes: bytes.buffer
  }] });
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?asset-metadata-legacy-test');

  const expected = {
    id: 'legacy-photo', name: 'legacy.png', type: 'image/png', byteLength: bytes.byteLength,
    dimensions: { width: 11, height: 3, pixels: 33 }
  };
  assert.deepEqual(await storage.loadImageAssetMetadata('legacy-photo'), expected);
  assert.deepEqual(await storage.loadImageAssetMetadata('legacy-photo'), expected);
  assert.equal(indexedDb.observations.cursorRecordsRead, 1, 'a durable migration marker prevents a second full scan');
});

test('asset metadata uses null dimensions for legacy bytes with an unrecognized image header', async () => {
  const indexedDb = createIndexedDbMock();
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?asset-metadata-unknown-test');
  await storage.saveImageAssetBytes('unknown', 'unknown.bin', 'application/octet-stream', new Uint8Array([1, 2, 3]));
  assert.deepEqual(await storage.loadImageAssetMetadata('unknown'), {
    id: 'unknown', name: 'unknown.bin', type: 'application/octet-stream', byteLength: 3, dimensions: null
  });
});

test('package import discovers and remaps both linked-component snapshots and resolved roots', async () => {
  const indexedDb = createIndexedDbMock();
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?linked-package-assets-test');
  const original = new Uint8Array([1, 2, 3]);
  const incoming = pngHeader(4, 6);
  await storage.saveImageAssetBytes('snapshot-photo', 'old.png', 'image/png', original);
  await storage.saveImageAssetBytes('resolved-photo', 'old-resolved.png', 'image/png', original);
  const document = createDocument();
  addNode(document, createNode('frame', {
    linkedComponent: {
      sourceSnapshot: { root: { id: 'source-root', type: 'frame', children: [createNode('image', { assetId: 'snapshot-photo' })] } },
      root: { id: 'resolved-root', type: 'frame', children: [createNode('image', { assetId: 'resolved-photo' })] }
    }
  }));
  const imported = await storage.importLocalPackage(document, [
    { id: 'snapshot-photo', name: 'new-snapshot.png', type: 'image/png', bytes: incoming },
    { id: 'resolved-photo', name: 'new-resolved.png', type: 'image/png', bytes: incoming }
  ]);
  const linked = imported.document.pages[0].children[0].linkedComponent;
  const snapshotAssetId = linked.sourceSnapshot.root.children[0].assetId;
  const resolvedAssetId = linked.root.children[0].assetId;

  assert.equal(snapshotAssetId, imported.assetIds.get('snapshot-photo'));
  assert.equal(resolvedAssetId, imported.assetIds.get('resolved-photo'));
  assert.notEqual(snapshotAssetId, 'snapshot-photo');
  assert.notEqual(resolvedAssetId, 'resolved-photo');
  assert.deepEqual((await storage.loadImageAssetMetadata(snapshotAssetId)).dimensions, { width: 4, height: 6, pixels: 24 });
  assert.deepEqual((await storage.loadImageAssetMetadata(resolvedAssetId)).dimensions, { width: 4, height: 6, pixels: 24 });
});

test('package completeness includes image bytes reachable only from linked-component roots', () => {
  const document = createDocument();
  addNode(document, createNode('frame', {
    linkedComponent: {
      sourceSnapshot: { root: { id: 'source-root', type: 'image', assetId: 'snapshot-only' } },
      root: { id: 'resolved-root', type: 'image', assetId: 'resolved-only' }
    }
  }));
  const available = id => [{ id, name: `${id}.png`, type: 'image/png', bytes: new Uint8Array([1]) }];

  assert.throws(() => packLocalPackage(document, available('snapshot-only')), /resolved-only.*bytes are missing/i);
  assert.throws(() => packLocalPackage(document, available('resolved-only')), /snapshot-only.*bytes are missing/i);
});
