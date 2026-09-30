import test from 'node:test';
import assert from 'node:assert/strict';
import { createComponentLibrary, publishComponent } from '../src/component-library.js';
import { createDocument } from '../src/model.js';

function createIndexedDbMock({ documentVersion = 1, documents = [], assets = [] } = {}) {
  const databases = new Map();
  const primaryName = 'figma-local-documents';
  const componentName = 'tiny-image-star-component-libraries';
  const createDatabase = name => {
    const stores = new Map();
    const addStore = (storeName, keyPath, records = []) => stores.set(storeName, {
      keyPath,
      records: new Map(records.map(record => [record[keyPath], structuredClone(record)]))
    });
    if (name === primaryName) {
      addStore('documents', 'id', documents);
      addStore('assets', 'id', assets);
      if (documentVersion >= 2) addStore('componentLibraries', 'id');
    }

    const database = {
      name,
      version: name === primaryName ? documentVersion : 0,
      stores,
      objectStoreNames: { contains: storeName => stores.has(storeName) },
      close() { this.closed = true; },
      createObjectStore(storeName, { keyPath }) {
        addStore(storeName, keyPath);
        return { createIndex() { /* The tests need schema-upgrade support, not index queries. */ } };
      },
      transaction(names) {
        const transaction = {};
        let completionScheduled = false;
        const completeSoon = () => {
          if (completionScheduled) return;
          completionScheduled = true;
          queueMicrotask(() => transaction.oncomplete?.());
        };
        transaction.objectStore = storeName => {
          const store = stores.get(storeName);
          assert.ok(store, `Object store ${storeName} exists.`);
          return {
            put(record) { store.records.set(record[store.keyPath], structuredClone(record)); completeSoon(); },
            add(record) {
              if (store.records.has(record[store.keyPath])) throw new Error('ConstraintError');
              store.records.set(record[store.keyPath], structuredClone(record)); completeSoon();
            },
            delete(key) { store.records.delete(key); completeSoon(); },
            get(key) {
              const request = {};
              queueMicrotask(() => {
                request.result = structuredClone(store.records.get(key));
                request.onsuccess?.();
                completeSoon();
              });
              return request;
            },
            getAll() {
              const request = {};
              queueMicrotask(() => {
                request.result = [...store.records.values()].map(record => structuredClone(record));
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
    databases.set(name, database);
    return database;
  };
  const indexedDB = {
    open(name, requestedVersion) {
      const request = {};
      queueMicrotask(() => {
        const database = databases.get(name) || createDatabase(name);
        request.result = database;
        const targetVersion = requestedVersion ?? database.version;
        if (targetVersion > database.version) {
          const oldVersion = database.version;
          database.version = targetVersion;
          request.onupgradeneeded?.({ oldVersion, newVersion: targetVersion });
        }
        request.onsuccess?.();
      });
      return request;
    }
  };
  return {
    indexedDB,
    databaseFor: name => databases.get(name),
    records: (databaseName, storeName) => [...databases.get(databaseName).stores.get(storeName).records.values()].map(record => structuredClone(record)),
    inject: (databaseName, storeName, record) => {
      const store = databases.get(databaseName).stores.get(storeName);
      store.records.set(record[store.keyPath], structuredClone(record));
    }
  };
}

function makeLibrary() {
  const root = { id: 'button-root', type: 'frame', name: 'Button', children: [{ id: 'button-label', type: 'text', text: 'Continue', children: [] }] };
  return publishComponent(createComponentLibrary({ id: 'library-design-system', name: 'Design system' }), {
    componentId: 'component-button', name: 'Button', root
  }).library;
}

async function loadStorageForTest() {
  return import(`../src/storage.js?component-library-storage-${Math.random()}`);
}

test('component libraries use a separate local database and upgrade legacy document storage to v6', async () => {
  const document = createDocument();
  document.name = 'Existing local design';
  const imageBytes = new Uint8Array([3, 1, 4, 1, 5]);
  const mock = createIndexedDbMock({
    documents: [{ id: document.id, savedAt: 123, document }],
    assets: [{ id: 'existing-image', name: 'photo.png', type: 'image/png', bytes: imageBytes.buffer }]
  });
  globalThis.indexedDB = mock.indexedDB;
  const storage = await loadStorageForTest();

  assert.deepEqual(await storage.listComponentLibraries(), []);
  assert.equal((await storage.loadDocumentById(document.id)).name, 'Existing local design');
  assert.equal(mock.databaseFor('figma-local-documents').version, 6);
  assert.equal(mock.databaseFor('figma-local-documents').objectStoreNames.contains('documents'), true);
  assert.equal(mock.databaseFor('figma-local-documents').objectStoreNames.contains('assets'), true);
  assert.equal(mock.databaseFor('figma-local-documents').objectStoreNames.contains('componentLibraries'), false);
  assert.equal(mock.databaseFor('figma-local-documents').objectStoreNames.contains('recipeBatchRecovery'), true);
  assert.equal(mock.databaseFor('figma-local-documents').stores.get('recipeBatchRecovery').keyPath, 'documentId');
  assert.equal(mock.databaseFor('tiny-image-star-component-libraries').version, 1);
  assert.equal(mock.databaseFor('tiny-image-star-component-libraries').objectStoreNames.contains('componentLibraries'), true);
  const loadedAsset = await storage.loadImageAsset('existing-image');
  assert.deepEqual([...new Uint8Array(loadedAsset.bytes)], [...imageBytes]);
  assert.equal(mock.records('figma-local-documents', 'documents').length, 1);
  assert.equal(mock.records('figma-local-documents', 'assets').length, 1);
});

test('opening a legacy v2 document database upgrades without losing designs or legacy stores', async () => {
  const document = createDocument();
  document.name = 'Existing upgraded local design';
  const mock = createIndexedDbMock({ documentVersion: 2, documents: [{ id: document.id, savedAt: 123, document }] });
  globalThis.indexedDB = mock.indexedDB;
  const storage = await loadStorageForTest();

  assert.equal((await storage.loadDocumentById(document.id)).name, 'Existing upgraded local design');
  assert.equal(mock.databaseFor('figma-local-documents').version, 6);
  assert.equal(mock.databaseFor('figma-local-documents').objectStoreNames.contains('componentLibraries'), true);
  assert.equal(mock.databaseFor('figma-local-documents').objectStoreNames.contains('recipeBatchRecovery'), true);
  await storage.saveComponentLibrary(makeLibrary());
  assert.equal(mock.databaseFor('figma-local-documents').version, 6, 'saving a library does not alter the document-schema version');
});

test('recipe batch recovery round-trips defensive copies and is keyed by document ID', async () => {
  const mock = createIndexedDbMock({ documentVersion: 5 });
  globalThis.indexedDB = mock.indexedDB;
  const storage = await loadStorageForTest();
  const input = {
    documentId: 'design-recovery', recipe: { id: 'recipe-1', name: 'Warm', adjustments: { exposure: 0.25 } },
    pageId: 'page-1', targetIds: ['image-a', 'image-b'], status: 'running'
  };

  await storage.saveRecipeBatchRecovery(input);
  input.recipe.adjustments.exposure = 0.9;
  input.targetIds.push('image-c');
  const loaded = await storage.loadRecipeBatchRecovery('design-recovery');
  assert.deepEqual(loaded, {
    documentId: 'design-recovery', recipe: { id: 'recipe-1', name: 'Warm', adjustments: { exposure: 0.25 } },
    pageId: 'page-1', targetIds: ['image-a', 'image-b'], status: 'running', savedAt: loaded.savedAt
  });
  loaded.recipe.adjustments.exposure = -1;
  loaded.targetIds.pop();
  assert.equal((await storage.loadRecipeBatchRecovery('design-recovery')).recipe.adjustments.exposure, 0.25);
  assert.deepEqual((await storage.loadRecipeBatchRecovery('design-recovery')).targetIds, ['image-a', 'image-b']);
  assert.equal(mock.records('figma-local-documents', 'recipeBatchRecovery').length, 1);
});

test('recipe batch recovery rejects malformed input and ignores corrupt stored records without deleting them', async () => {
  const mock = createIndexedDbMock();
  globalThis.indexedDB = mock.indexedDB;
  const storage = await loadStorageForTest();
  const valid = {
    documentId: 'design-recovery', recipe: { id: 'recipe-1' }, pageId: 'page-1',
    targetIds: ['image-a'], status: 'running'
  };
  const invalid = [
    { ...valid, documentId: ' ' }, { ...valid, pageId: '' }, { ...valid, recipe: [] },
    { ...valid, recipe: null }, { ...valid, targetIds: [] }, { ...valid, targetIds: ['image-a', 'image-a'] },
    { ...valid, targetIds: [' '] }, { ...valid, targetIds: ['x'.repeat(257)] }, { ...valid, status: 'unknown' },
    { ...valid, recipe: new Date() }, { ...valid, recipe: { text: 'x'.repeat(256 * 1024 + 1) } },
    { ...valid, targetIds: Array.from({ length: 100_001 }, (_, index) => `image-${index}`) }
  ];
  for (const item of invalid) await assert.rejects(storage.saveRecipeBatchRecovery(item), /Invalid image recipe batch recovery data/);
  const cyclicRecipe = { id: 'cycle' }; cyclicRecipe.self = cyclicRecipe;
  await assert.rejects(storage.saveRecipeBatchRecovery({ ...valid, recipe: cyclicRecipe }), /Invalid image recipe batch recovery data/);
  assert.equal(await storage.loadRecipeBatchRecovery('missing-design'), null);
  assert.equal(mock.records('figma-local-documents', 'recipeBatchRecovery').length, 0);
  assert.equal(await storage.loadRecipeBatchRecovery(' '), null);

  mock.inject('figma-local-documents', 'recipeBatchRecovery', {
    documentId: 'broken-design', recipe: [], pageId: 'page-1', targetIds: ['image-a'], status: 'running', savedAt: 1
  });
  assert.equal(await storage.loadRecipeBatchRecovery('broken-design'), null);
  assert.equal(mock.records('figma-local-documents', 'recipeBatchRecovery').length, 1, 'invalid data stays available for recovery or inspection');
});

test('recipe batch recovery delete reports whether a record existed', async () => {
  const mock = createIndexedDbMock();
  globalThis.indexedDB = mock.indexedDB;
  const storage = await loadStorageForTest();
  assert.equal(await storage.deleteRecipeBatchRecovery('design-recovery'), false);
  await storage.saveRecipeBatchRecovery({
    documentId: 'design-recovery', recipe: { id: 'recipe-1' }, pageId: 'page-1',
    targetIds: ['image-a'], status: 'complete'
  });
  assert.equal(await storage.deleteRecipeBatchRecovery('design-recovery'), true);
  assert.equal(await storage.deleteRecipeBatchRecovery('design-recovery'), false);
  assert.equal(await storage.loadRecipeBatchRecovery('design-recovery'), null);
});

test('libraries persist and reload by stable identity, list as summaries, and delete independently', async () => {
  const mock = createIndexedDbMock();
  globalThis.indexedDB = mock.indexedDB;
  const storage = await loadStorageForTest();
  const library = makeLibrary();
  await storage.saveComponentLibrary(library);

  const loaded = await storage.loadComponentLibrary(library.id);
  assert.deepEqual(loaded, library);
  assert.notEqual(loaded, library, 'load returns a defensive copy');
  loaded.name = 'Changed in caller';
  loaded.components[0].versions[0].root.name = 'Caller edit';
  assert.deepEqual(await storage.loadComponentLibrary(library.id), library, 'caller mutation must not change the persisted library');
  assert.equal(await storage.loadComponentLibrary('missing-library'), null);
  assert.equal(await storage.loadComponentLibrary(' '), null);

  const second = createComponentLibrary({ id: 'library-icons', name: 'Icons' });
  await storage.saveComponentLibrary(second);
  const summaries = await storage.listComponentLibraries();
  assert.equal(summaries.length, 2);
  assert.deepEqual(new Set(summaries.map(item => item.id)), new Set([library.id, second.id]));
  assert.ok(summaries.every(item => Object.keys(item).sort().join(',') === 'id,name,revision,savedAt'));
  assert.equal(summaries.find(item => item.id === library.id).revision, library.revision);

  assert.equal(await storage.deleteComponentLibrary(second.id), true);
  assert.equal(await storage.deleteComponentLibrary(second.id), false);
  assert.equal(await storage.loadComponentLibrary(second.id), null);
  assert.deepEqual(await storage.loadComponentLibrary(library.id), library);
  assert.equal(mock.records('tiny-image-star-component-libraries', 'componentLibraries').length, 1);
});

test('parallel component publications serialize revisions and preserve both library updates', async () => {
  const mock = createIndexedDbMock();
  globalThis.indexedDB = mock.indexedDB;
  const storage = await loadStorageForTest();
  const library = createComponentLibrary({ id: 'library-concurrent', name: 'Concurrent publishes' });
  await storage.saveComponentLibrary(library);

  const publications = await Promise.all([
    storage.publishStoredComponent(library.id, {
      componentId: 'component-card', name: 'Card', root: { id: 'card', type: 'frame', children: [] }
    }),
    storage.publishStoredComponent(library.id, {
      componentId: 'component-button', name: 'Button', root: { id: 'button', type: 'frame', children: [] }
    })
  ]);

  assert.deepEqual(publications.map(result => result.publication.revision).sort(), [1, 2]);
  const stored = await storage.loadComponentLibrary(library.id);
  assert.equal(stored.revision, 2);
  assert.deepEqual(new Set(stored.components.map(component => component.id)), new Set(['component-card', 'component-button']));
  assert.deepEqual(stored.components.flatMap(component => component.versions.map(version => version.revision)).sort(), [1, 2]);
});

test('save rejects malformed snapshots and a corrupt library does not hide healthy library rows', async () => {
  const mock = createIndexedDbMock();
  globalThis.indexedDB = mock.indexedDB;
  const storage = await loadStorageForTest();
  const valid = makeLibrary();
  const invalid = structuredClone(valid);
  invalid.revision = 4;
  await assert.rejects(storage.saveComponentLibrary(invalid), /publication revisions/);
  assert.deepEqual(await storage.listComponentLibraries(), []);
  assert.equal(mock.records('tiny-image-star-component-libraries', 'componentLibraries').length, 0, 'invalid snapshots must not be written');

  mock.inject('tiny-image-star-component-libraries', 'componentLibraries', {
    id: valid.id,
    name: 'Tampered metadata',
    revision: valid.revision,
    savedAt: 456,
    library: valid
  });
  const healthy = createComponentLibrary({ id: 'library-healthy', name: 'Healthy library' });
  await storage.saveComponentLibrary(healthy);
  await assert.rejects(storage.loadComponentLibrary(valid.id), /metadata does not match/);
  assert.deepEqual(await storage.listComponentLibraries(), [{
    id: healthy.id, name: healthy.name, revision: healthy.revision,
    savedAt: mock.records('tiny-image-star-component-libraries', 'componentLibraries').find(record => record.id === healthy.id).savedAt
  }]);
});
