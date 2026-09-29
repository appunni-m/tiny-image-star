import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, addNode } from '../src/model.js';
import {
  deleteStoredDocument, duplicateStoredDocument, listSavedDocuments, loadDocumentById,
  importLocalPackage, loadImageAsset, loadLatestDocument, renameStoredDocument, saveDocument, saveImageAssetBytes
} from '../src/storage.js';

function createIndexedDbMock() {
  const stores = new Map();
  const clone = value => structuredClone(value);
  const database = {
    objectStoreNames: { contains: name => stores.has(name) },
    close() { this.closed = true; },
    createObjectStore(name, { keyPath }) { stores.set(name, { keyPath, records: new Map() }); },
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
            queueMicrotask(() => {
              request.result = clone(store.records.get(key));
              request.onsuccess?.();
              completeSoon();
            });
            return request;
          },
          getAll() {
            const request = {};
            queueMicrotask(() => {
              request.result = [...store.records.values()].map(clone);
              request.onsuccess?.();
              completeSoon();
            });
            return request;
          }
        };
      };
      return transaction;
    }
  };
  return {
    database,
    open(_name, _version) {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
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
