import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { createDocument, createNode, createFillLayer, createLayerEffect, createEffectStyle, addNode, createComponent, createComponentInstance, findNode, parseDocument, syncComponentInstances } from '../src/model.js';
import { createImageFill } from '../src/image-fills.js';
import { packLocalPackage, unpackLocalPackage } from '../src/storage.js';
import { MAX_IMAGE_SOURCE_PIXELS } from '../src/image-engine.js';
import {
  claimRecipeBatchRecovery, deleteFontAsset, deleteRecipeBatchRecovery, deleteStoredDocument, duplicateStoredDocument, importLocalPackage,
  listDocumentVersions, listFontAssets, listSavedDocuments, loadDocumentById, loadDocumentVersion, loadFontAsset,
  loadImageAsset, loadImageAssetMetadata, loadImageAssetThumbnail, loadLatestDocument, loadRecipeBatchRecovery, renameStoredDocument,
  saveDocument, saveDocumentVersion, saveFontAsset, saveImageAssetBytes, saveImageAssetThumbnail
} from '../src/storage.js';

function createIndexedDbMock({ legacyAssets = [], legacyFonts = [] } = {}) {
  const stores = new Map();
  const clone = value => {
    if (value?.handle?.kind === 'directory' && typeof value.handle.getDirectoryHandle === 'function') return { ...value };
    return structuredClone(value);
  };
  const observations = { cursorRecordsRead: 0, fontCursorRecordsRead: 0, fontBinaryGets: [], fontBinaryGetAllCalls: 0, assetBinaryGets: [], assetKeyChecks: [], openVersion: null };
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
            if (name === 'assets') observations.assetBinaryGets.push(key);
            queueMicrotask(() => {
              request.result = clone(store.records.get(key));
              request.onsuccess?.();
              completeSoon();
            });
            return request;
          },
          getKey(key) {
            const request = {};
            if (name === 'assets') observations.assetKeyChecks.push(key);
            queueMicrotask(() => {
              request.result = store.records.has(key) ? key : undefined;
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
    seed(name, record) { stores.get(name)?.records.set(record[stores.get(name).keyPath], clone(record)); },
    inspect(name, key) { return clone(stores.get(name)?.records.get(key)); }
  };
  return {
    database,
    observations,
    inspect: database.inspect,
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

test('selected workspace handles persist locally and are returned for a fresh permission check', async () => {
  const indexedDb = createIndexedDbMock();
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?workspace-directory-handle-test');
  const handle = { kind: 'directory', name: 'Local workspace', queryPermission() {}, getDirectoryHandle() {} };

  assert.equal(await storage.loadWorkspaceDirectoryHandle(), null);
  assert.equal(await storage.saveWorkspaceDirectoryHandle(handle), true);
  assert.equal(await storage.loadWorkspaceDirectoryHandle(), handle);
  assert.equal(indexedDb.observations.openVersion, 8);
  assert.equal(indexedDb.inspect('workspaceSettings', 'active-workspace-directory-handle').handle, handle);
  await assert.rejects(storage.saveWorkspaceDirectoryHandle({ kind: 'file' }), /supported writable workspace folder handle/i);

  await storage.deleteWorkspaceDirectoryHandle();
  assert.equal(await storage.loadWorkspaceDirectoryHandle(), null);
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

  const recovery = {
    ownerToken: 'run-storage-library-original', recipe: { id: 'recipe-recovery', name: 'Warm', adjustments: {} },
    pageId: original.activePageId, targetIds: [image.id], status: 'running'
  };
  await claimRecipeBatchRecovery({ documentId: original.id, ...recovery });
  await claimRecipeBatchRecovery({ ...recovery, documentId: second.id, ownerToken: 'run-storage-library-second' });
  assert.ok(await loadRecipeBatchRecovery(original.id));

  await assert.rejects(deleteStoredDocument(original.id), /already has an image recipe batch running/,
    'document removal cannot erase a live tab’s recovery journal');
  await deleteRecipeBatchRecovery(original.id, recovery.ownerToken);
  assert.equal(await deleteStoredDocument(original.id), true);
  assert.equal(await deleteStoredDocument(original.id), false);
  assert.equal(await loadRecipeBatchRecovery(original.id), null, 'deleting a design removes its stale recovery journal in the same transaction');
  assert.ok(await loadRecipeBatchRecovery(second.id), 'deleting one design leaves another design recovery journal intact');
  await deleteRecipeBatchRecovery(second.id, 'run-storage-library-second');
  assert.equal(await loadDocumentById(original.id), null);
  assert.ok(await loadDocumentById(duplicate.id));
  assert.deepEqual(new Uint8Array((await loadImageAsset('library-asset')).bytes), bytes,
    'assets remain intact because the v1 asset store has no document ownership metadata');
});

test('original .fig archives persist independently, follow local duplicates, and delete with their design', async () => {
  const indexedDb = createIndexedDbMock();
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?fig-source-archive-storage-test');
  const document = createDocument();
  const source = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

  await storage.saveDocument(document);
  assert.equal(await storage.loadFigSourceArchive(document.id), null);
  assert.equal(await storage.saveFigSourceArchive(document.id, source), true);
  assert.deepEqual(new Uint8Array(await storage.loadFigSourceArchive(document.id)), source);

  const corrupt = indexedDb.inspect('figSourceArchives', document.id);
  new Uint8Array(corrupt.bytes)[0] ^= 0xff;
  indexedDb.database.seed('figSourceArchives', corrupt);
  await assert.rejects(storage.loadFigSourceArchive(document.id), /source archive is damaged/i);
  await storage.saveFigSourceArchive(document.id, source);

  const duplicate = await storage.duplicateStoredDocument(document.id);
  assert.ok(duplicate?.id);
  assert.deepEqual(new Uint8Array(await storage.loadFigSourceArchive(duplicate.id)), source,
    'duplicating a design copies its original archive without embedding it in the document snapshot');
  assert.equal(await storage.deleteStoredDocument(document.id), true);
  assert.equal(await storage.loadFigSourceArchive(document.id), null);
  assert.deepEqual(new Uint8Array(await storage.loadFigSourceArchive(duplicate.id)), source,
    'deleting one design leaves its duplicate archive intact');

  await assert.rejects(storage.saveFigSourceArchive(document.id, new Uint8Array()), /readable bytes/i);
  assert.equal(await storage.deleteFigSourceArchive(duplicate.id), true);
  assert.equal(await storage.loadFigSourceArchive(duplicate.id), null);
});

test('boot recovery selects the newest parseable snapshot and retains corrupt rows for repair', async () => {
  const indexedDb = createIndexedDbMock();
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?newest-valid-boot-recovery-test');
  await storage.loadLatestDocument(); // Initialize the mock schema before seeding snapshots.

  const oldest = createDocument();
  oldest.name = 'Oldest valid design';
  const newestValid = createDocument();
  newestValid.name = 'Newest valid design';
  const corrupt = createDocument();
  corrupt.name = 'Damaged design';
  corrupt.schema = 'broken-local-design';
  const missingIdentity = createDocument();
  delete missingIdentity.id;
  const mismatchedIdentity = createDocument();
  const missingIdentityRowId = 'saved-row-without-document-id';
  const mismatchedIdentityRowId = 'saved-row-with-mismatched-document-id';
  indexedDb.database.seed('documents', { id: oldest.id, savedAt: 10, document: oldest });
  indexedDb.database.seed('documents', { id: newestValid.id, savedAt: 20, document: newestValid });
  indexedDb.database.seed('documents', { id: corrupt.id, savedAt: 30, document: corrupt });
  indexedDb.database.seed('documents', { id: missingIdentityRowId, savedAt: 40, document: missingIdentity });
  indexedDb.database.seed('documents', { id: mismatchedIdentityRowId, savedAt: 50, document: mismatchedIdentity });

  const restoration = await storage.loadLatestValidDocument(parseDocument);
  assert.equal(restoration.document.id, newestValid.id, 'recovery should choose the nearest older valid snapshot');
  assert.equal(restoration.recordId, newestValid.id);
  assert.equal(restoration.revision, 0, 'legacy saved rows without a revision load as revision zero');
  assert.deepEqual(restoration.invalidRecords.map(record => record.id), [mismatchedIdentityRowId, missingIdentityRowId, corrupt.id]);
  assert.throws(() => parseDocument(missingIdentity), /Invalid local design file/,
    'a design without stable identity must fail central validation');
  assert.equal((await storage.loadLatestDocument()).id, mismatchedIdentity.id,
    'the raw latest record remains unchanged and available for manual repair');
  assert.deepEqual(await storage.loadDocumentById(corrupt.id), corrupt);
  assert.ok(await storage.loadDocumentById(missingIdentityRowId), 'the missing-ID row remains available for manual repair');
  assert.ok(await storage.loadDocumentById(mismatchedIdentityRowId), 'the mismatched-ID row remains available for manual repair');
  assert.ok((await storage.listSavedDocuments()).some(record => record.id === mismatchedIdentityRowId),
    'the damaged rows remain discoverable in the local design library');

  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const bootStart = main.indexOf('async function boot()');
  const bootEnd = main.indexOf('\nsyncMobilePanelAccessibility();', bootStart);
  assert.ok(bootStart >= 0 && bootEnd > bootStart, 'boot recovery should have a bounded implementation');
  const boot = main.slice(bootStart, bootEnd);
  assert.match(boot, /loadLatestValidDocument\(parseDocument\)/,
    'startup should validate snapshots and fall back before rendering the editor');
  assert.match(boot, /restoration\.invalidRecords\.length[\s\S]*?damaged design remains in Your designs for manual repair/,
    'startup should clearly preserve and disclose the damaged row');
  assert.match(boot, /state\.documentStorageRevision\s*=\s*restoration\.revision/,
    'startup must carry the restored row revision into the first autosave compare-and-swap');
});

test('document compare-and-swap preserves a newer tab save and fences rename revisions', async () => {
  const indexedDb = createIndexedDbMock();
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?document-save-cas-concurrency-test');
  await storage.loadLatestDocument();

  const initial = createDocument();
  initial.name = 'Shared design';
  indexedDb.database.seed('documents', { id: initial.id, savedAt: 1, revision: 4, document: initial });
  const tabA = await storage.loadDocumentRecordById(initial.id);
  const tabB = await storage.loadDocumentRecordById(initial.id);
  assert.equal(tabA.revision, 4);
  assert.equal(tabB.revision, 4);
  tabA.document.name = 'Saved by tab A';
  tabB.document.name = 'Unsaved tab B edits';

  assert.equal(await storage.saveDocument(tabA.document, { expectedRevision: tabA.revision }), 5);
  await assert.rejects(
    storage.saveDocument(tabB.document, { expectedRevision: tabB.revision }),
    error => error instanceof storage.DocumentSaveConflictError
      && error.documentId === initial.id && error.expectedRevision === 4 && error.actualRevision === 5,
    'a second tab with a stale revision cannot overwrite the first tab'
  );
  assert.equal((await storage.loadDocumentById(initial.id)).name, 'Saved by tab A');

  assert.equal(await storage.saveDocument(tabB.document), 6,
    'direct fixture/API saves remain unconditional when no expected revision is supplied');
  assert.equal(await storage.renameStoredDocument(initial.id, 'Renamed safely', { expectedRevision: 6 }), true);
  const renamed = await storage.loadDocumentRecordById(initial.id);
  assert.equal(renamed.revision, 7, 'document-library rename advances the per-document revision');
  assert.equal(renamed.document.name, 'Renamed safely');
  await assert.rejects(
    storage.saveDocument(tabA.document, { expectedRevision: 6 }),
    error => error instanceof storage.DocumentSaveConflictError && error.actualRevision === 7,
    'an editor opened before a rename must detect the newer row revision'
  );

  const legacy = createDocument();
  legacy.name = 'Legacy row';
  indexedDb.database.seed('documents', { id: legacy.id, savedAt: 2, document: legacy });
  const loadedLegacy = await storage.loadDocumentRecordById(legacy.id);
  assert.equal(loadedLegacy.revision, 0, 'a pre-revision document row is treated as revision zero');
  assert.equal(await storage.saveDocument(loadedLegacy.document, { expectedRevision: loadedLegacy.revision }), 1,
    'the first compare-and-swap upgrades the legacy row into revision one');
});

test('editor conflict recovery keeps this tab on a separate copy and blocks switching if that copy cannot be saved', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const body = (name, nextName) => {
    const start = main.indexOf(`function ${name}(`) >= 0
      ? main.indexOf(`function ${name}(`)
      : main.indexOf(`async function ${name}(`);
    const end = main.indexOf(`\n${nextName}`, start);
    assert.ok(start >= 0 && end > start, `expected to find bounded ${name} implementation`);
    return main.slice(start, end);
  };
  const enqueue = body('enqueueDocumentSave', 'async function preserveDocumentSaveConflict');
  assert.match(enqueue, /conflict\s*\?\s*\{\s*\.\.\.snapshot,\s*id:\s*conflict\.recoveryId,\s*name:\s*conflict\.recoveryName\s*\}/,
    'once conflicted, later editor snapshots are written under the separate recovery ID');
  assert.match(enqueue, /saveDocument\(persistedSnapshot,\s*\{\s*expectedRevision:\s*state\.documentStorageRevision\s*\}\)/,
    'ordinary autosaves use the active design revision compare-and-swap');

  const preserve = body('preserveDocumentSaveConflict', 'function setDocumentEditingBlocked');
  assert.match(preserve, /recoveryId:\s*createId\('recovery'\)/);
  assert.match(preserve, /recoveryName/);
  assert.match(preserve, /serializeDocument\(state\.document\)/,
    'the recovery copy captures the current in-memory edits');
  assert.match(preserve, /enqueueDocumentSave\(latestSnapshot,[\s\S]*?false\)/,
    'the recovery snapshot is saved independently of the conflicted source row');

  const persist = body('persistCurrentDocumentNow', 'function releaseImageRuntimeForDocumentSwitch');
  assert.match(persist, /error instanceof DocumentSaveConflictError[\s\S]*?preserveDocumentSaveConflict/);
  assert.match(persist, /return conflict\.saved/,
    'a design switch can proceed only after the separate recovery copy is durable');

  const switching = body('switchToDocument', 'async function renderDesignLibrary');
  assert.match(switching, /state\.documentStorageRevision\s*=\s*nextStorageRevision/);
  assert.match(switching, /state\.documentSaveConflict\s*=\s*null/,
    'switching designs clears only the previous design’s conflict fence');
  assert.match(switching, /sameDocumentAfterSave[\s\S]*?state\.documentStorageRevision/,
    'restoring a version of the active design fences against the revision advanced by its pre-switch save');
  assert.match(switching, /nextDocument\.id === currentDocumentId && state\.documentSaveConflict/,
    'a restore cannot overwrite a newer cross-tab revision after autosave has moved this tab to a recovery copy');

  const restore = body('restoreDocumentVersion', 'function imageNodesAcrossPages');
  assert.doesNotMatch(restore, /expectedStorageRevision:/,
    'version restore must not reuse the stale revision read before its own pre-switch autosave');

  const namedSave = body('saveNamedDocumentVersion', 'async function restoreDocumentVersion');
  assert.match(namedSave, /persistCurrentDocumentNow\(\)[\s\S]*?state\.documentSaveConflict[\s\S]*?Open[\s\S]*?recoveryName[\s\S]*?return;[\s\S]*?saveDocumentVersion/,
    'a checkpoint from a conflicted editor must not enter the newer source design history');
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
  assert.equal(indexedDb.observations.openVersion, 8, 'the local version history, recipe recovery, workspace, and optional source-archive stores use a forward-only database upgrade');
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
  const originalBytes = pngHeader(3, 2);
  const incomingBytes = pngHeader(5, 4);
  const libraryOriginalBytes = pngHeader(1, 1);
  const libraryIncomingBytes = pngHeader(2, 1);
  await saveImageAssetBytes('shared-asset', 'original.png', 'image/png', originalBytes);
  await saveImageAssetBytes('library-shared', 'library-original.png', 'image/png', libraryOriginalBytes);
  const existingDocument = createDocument();
  existingDocument.name = 'Existing';
  await saveDocument(existingDocument);
  const incomingDocument = createDocument();
  incomingDocument.id = existingDocument.id;
  incomingDocument.name = 'Imported';
  addNode(incomingDocument, createNode('image', { assetId: 'shared-asset' }));
  incomingDocument.imageLibrary = [
    { assetId: 'shared-asset', name: 'imported.png', type: 'image/png', width: 5, height: 4 },
    { assetId: 'library-shared', name: 'library.png', type: 'image/png', width: 2, height: 1 }
  ];

  const imported = await importLocalPackage(incomingDocument, [
    { id: 'shared-asset', name: 'imported.png', type: 'image/png', bytes: incomingBytes },
    { id: 'library-shared', name: 'library.png', type: 'image/png', bytes: libraryIncomingBytes },
    { id: 'new-asset', name: 'new.png', type: 'image/png', bytes: originalBytes }
  ]);
  assert.notEqual(imported.assetIds.get('shared-asset'), 'shared-asset');
  assert.equal(imported.assetIds.get('new-asset'), 'new-asset');
  assert.notEqual(imported.document.id, existingDocument.id);
  assert.equal(imported.document.pages[0].children[0].assetId, imported.assetIds.get('shared-asset'));
  assert.deepEqual(imported.document.imageLibrary, [
    { assetId: imported.assetIds.get('shared-asset'), name: 'imported.png', type: 'image/png', width: 5, height: 4 },
    { assetId: imported.assetIds.get('library-shared'), name: 'library.png', type: 'image/png', width: 2, height: 1 }
  ], 'manifest-only sources follow the same collision mapping as placed sources');
  assert.deepEqual(new Uint8Array((await loadImageAsset('shared-asset')).bytes), originalBytes);
  assert.deepEqual(new Uint8Array((await loadImageAsset(imported.assetIds.get('shared-asset'))).bytes), incomingBytes);
  assert.notEqual(imported.assetIds.get('library-shared'), 'library-shared');
  assert.deepEqual(new Uint8Array((await loadImageAsset('library-shared')).bytes), libraryOriginalBytes);
  assert.deepEqual(new Uint8Array((await loadImageAsset(imported.assetIds.get('library-shared'))).bytes), libraryIncomingBytes);
  assert.equal((await loadDocumentById(existingDocument.id)).name, 'Existing');
  assert.equal((await loadDocumentById(imported.document.id)).name, 'Imported');

  const repeatedDocument = { ...incomingDocument, id: createDocument().id, imageLibrary: [] };
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
  const originalBytes = pngHeader(3, 2);
  const incomingBytes = pngHeader(5, 4);
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
  const originalBytes = pngHeader(3, 2);
  const incomingBytes = pngHeader(5, 4);
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

test('package import rejects empty, unknown, and oversized image bytes before storage opens', async () => {
  let openCalls = 0;
  globalThis.indexedDB = { open() { openCalls += 1; throw new Error('storage must remain untouched'); } };
  const invalidSources = [
    new Uint8Array(),
    new Uint8Array([0, 1, 2, 3, 4]),
    pngHeader(MAX_IMAGE_SOURCE_PIXELS + 1, 1)
  ];

  for (const [index, bytes] of invalidSources.entries()) {
    const document = createDocument();
    addNode(document, createNode('image', { assetId: `unsafe-source-${index}` }));
    await assert.rejects(importLocalPackage(document, [
      { id: `unsafe-source-${index}`, name: `unsafe-${index}.png`, type: 'image/png', bytes }
    ]), /invalid or unsafe/i);
  }
  assert.equal(openCalls, 0, 'invalid package image bytes are rejected before migrations or durable writes can begin');
});

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function thumbnailPng(width = 7, height = 5) {
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const typeBytes = Buffer.from(type, 'ascii');
    const payload = Buffer.from(data);
    const output = Buffer.alloc(12 + payload.length);
    output.writeUInt32BE(payload.length, 0);
    typeBytes.copy(output, 4);
    payload.copy(output, 8);
    output.writeUInt32BE(crc32(output.subarray(4, 8 + payload.length)), 8 + payload.length);
    return output;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rowLength = 1 + width * 4;
  const raw = Buffer.alloc(height * rowLength);
  const idat = deflateSync(raw);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
  ]));
}

function thumbnailJpeg(width = 7, height = 5) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x01, 0xff, 0xd9
  ]);
}

function webpExifHeader(width, height, orientation) {
  const chunk = (type, payload) => {
    const bytes = Buffer.alloc(8 + payload.length + (payload.length & 1));
    bytes.write(type, 0, 'ascii'); bytes.writeUInt32LE(payload.length, 4); Buffer.from(payload).copy(bytes, 8);
    return bytes;
  };
  const extended = Buffer.alloc(10); extended[0] = 0x08;
  extended.writeUIntLE(width - 1, 4, 3); extended.writeUIntLE(height - 1, 7, 3);
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(orientation, 18);
  const body = Buffer.concat([Buffer.from('WEBP'), chunk('VP8X', extended), chunk('EXIF', Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]))]);
  const bytes = Buffer.alloc(8 + body.length); bytes.write('RIFF', 0, 'ascii'); bytes.writeUInt32LE(body.length, 4); body.copy(bytes, 8);
  return new Uint8Array(bytes);
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
  assert.equal(indexedDb.observations.openVersion, 8, 'opening the store upgrades the legacy schema for local fonts, metadata, versions, recipe recovery, workspace handles, and optional source archives');
});

test('small image-library PNG and JPEG thumbnails share compact metadata without reading source bytes', async () => {
  const indexedDb = createIndexedDbMock();
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?image-library-thumbnail-roundtrip-test');
  const source = pngHeader(7, 5);
  const png = thumbnailPng(7, 5);
  const jpeg = thumbnailJpeg(9, 4);
  await storage.saveImageAssetBytes('thumb-png', 'source.png', 'image/png', source);
  await storage.saveImageAssetBytes('thumb-jpeg', 'source.jpg', 'image/jpeg', source);
  indexedDb.observations.assetBinaryGets.length = 0;

  assert.equal(await storage.saveImageAssetThumbnail('thumb-png', png), true);
  assert.equal(await storage.saveImageAssetThumbnail('thumb-jpeg', jpeg), true);
  const storedPng = indexedDb.inspect('assetMetadata', 'thumb-png');
  const storedJpeg = indexedDb.inspect('assetMetadata', 'thumb-jpeg');
  assert.ok(storedPng.thumbnail instanceof ArrayBuffer);
  assert.ok(storedJpeg.thumbnail instanceof ArrayBuffer);
  assert.ok(storedPng.thumbnail.byteLength <= 48 * 1024);
  assert.ok(storedJpeg.thumbnail.byteLength <= 48 * 1024);
  assert.deepEqual(await storage.loadImageAssetThumbnail('thumb-png'), png);
  assert.deepEqual(await storage.loadImageAssetThumbnail('thumb-jpeg'), jpeg);
  assert.deepEqual(indexedDb.observations.assetBinaryGets, [], 'thumbnail save and load only check the source key; they never retrieve source bytes');
  assert.deepEqual(indexedDb.observations.assetKeyChecks, ['thumb-png', 'thumb-jpeg', 'thumb-png', 'thumb-jpeg']);
  assert.equal(indexedDb.observations.openVersion, 8, 'thumbnail persistence reuses assetMetadata and the current local-storage schema');

  const detached = await storage.loadImageAssetThumbnail('thumb-png');
  detached[0] = 0;
  assert.deepEqual(await storage.loadImageAssetThumbnail('thumb-png'), png, 'callers receive detached thumbnail bytes');
  assert.equal(indexedDb.observations.assetBinaryGets.length, 0);
});

test('image-library thumbnails reject missing sources and malformed, oversized, or oversized-dimension inputs', async () => {
  const indexedDb = createIndexedDbMock();
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?image-library-thumbnail-validation-test');
  await storage.saveImageAssetBytes('thumbnail-source', 'source.png', 'image/png', pngHeader(2, 2));

  await assert.rejects(storage.saveImageAssetThumbnail('missing-thumbnail-source', thumbnailPng()), /original image source is no longer saved/i);
  assert.equal(await storage.loadImageAssetThumbnail('missing-thumbnail-source'), null);
  await assert.rejects(storage.saveImageAssetThumbnail('thumbnail-source', new Uint8Array(48 * 1024 + 1)), /48 KiB/i);
  await assert.rejects(storage.saveImageAssetThumbnail('thumbnail-source', thumbnailPng(129, 1)), /128 × 128/i);
  await assert.rejects(storage.saveImageAssetThumbnail('thumbnail-source', new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), /complete, valid PNG or JPEG/i);
  const damagedPng = thumbnailPng();
  damagedPng[29] ^= 0xff;
  await assert.rejects(storage.saveImageAssetThumbnail('thumbnail-source', damagedPng), /complete, valid PNG or JPEG/i);
  const truncatedJpeg = thumbnailJpeg().slice(0, -1);
  await assert.rejects(storage.saveImageAssetThumbnail('thumbnail-source', truncatedJpeg), /complete, valid PNG or JPEG/i);
  assert.equal(await storage.loadImageAssetThumbnail('thumbnail-source'), null, 'failed saves do not leave partial thumbnail metadata');
});

test('image catalog metadata preserves non-default WebP EXIF orientation for restore validation', async () => {
  const indexedDb = createIndexedDbMock();
  globalThis.indexedDB = indexedDb;
  const storage = await import('../src/storage.js?asset-orientation-metadata-test');
  const bytes = webpExifHeader(3, 2, 6);
  await storage.saveImageAssetBytes('oriented-webp', 'portrait.webp', 'image/webp', bytes);
  assert.deepEqual((await storage.loadImageAssetMetadata('oriented-webp')).dimensions, {
    width: 2, height: 3, pixels: 6, orientation: 6,
  });
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

test('effect style catalogs persist in local IndexedDB documents and .flocal exports', async () => {
  globalThis.indexedDB = createIndexedDbMock();
  const document = createDocument();
  const source = createNode('rectangle', {
    effects: [
      createLayerEffect('inner-shadow', { id: 'saved-inner', offsetX: 2 }),
      createLayerEffect('drop-shadow', { id: 'saved-drop', offsetY: 6, blur: 9 })
    ]
  });
  addNode(document, source);
  const style = createEffectStyle(document, source.id, 'Reusable depth');

  await saveDocument(document);
  const localCopy = await loadDocumentById(document.id);
  assert.deepEqual(localCopy.effectStyles, [style], 'local document snapshots retain the style catalog');
  const portable = unpackLocalPackage(packLocalPackage(localCopy, []));
  assert.deepEqual(portable.document.effectStyles, [style], '.flocal export retains ordered effect values and style identity');
});
