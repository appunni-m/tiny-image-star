import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createDocument, createNode, parseDocument } from '../src/model.js';
import { collectReferencedAssets, INDEXED_DB_MIGRATION_FILE, migrateIndexedDbToWorkspace } from '../src/workspace/migration.js';

function notFound() { return Object.assign(new Error('Not found'), { name: 'NotFoundError' }); }

class FakeFileHandle {
  constructor(name) { this.name = name; this.kind = 'file'; this.contents = ''; }
  async getFile() {
    const contents = this.contents;
    return { size: new TextEncoder().encode(contents).byteLength, async text() { return contents; } };
  }
  async createWritable() {
    let next = '';
    const thisHandle = this;
    return {
      async write(value) { next = typeof value === 'string' ? value : new TextDecoder().decode(value); },
      async close() { thisHandle.contents = next; },
      async abort() {}
    };
  }
}

class FakeDirectoryHandle {
  constructor(name = '') { this.name = name; this.kind = 'directory'; this.children = new Map(); }
  async getFileHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing) { if (!(existing instanceof FakeFileHandle)) throw new TypeError('not a file'); return existing; }
    if (!create) throw notFound();
    const handle = new FakeFileHandle(name);
    this.children.set(name, handle);
    return handle;
  }
  async getDirectoryHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing) { if (!(existing instanceof FakeDirectoryHandle)) throw new TypeError('not a directory'); return existing; }
    if (!create) throw notFound();
    const handle = new FakeDirectoryHandle(name);
    this.children.set(name, handle);
    return handle;
  }
  async removeEntry(name) { if (!this.children.delete(name)) throw notFound(); }
}

class FakeLocks {
  constructor() { this.tails = new Map(); }
  request(name, { mode }, callback) {
    assert.equal(mode, 'exclusive');
    const prior = this.tails.get(name) || Promise.resolve();
    const next = prior.then(callback, callback);
    this.tails.set(name, next.then(() => {}, () => {}));
    return next;
  }
}

function imageBytes(...values) { return new Uint8Array(values); }

function makeDoc({ images = ['img-1'], family = 'Brand', weight = 400 } = {}) {
  const document = createDocument();
  document.id = 'design-1';
  document.pages[0].id = 'page-1';
  document.activePageId = 'page-1';
  document.pages[0].children = [
    ...images.map((assetId, index) => createNode('image', { id: `layer-image-${index}`, assetId })),
    createNode('text', { id: 'layer-text', text: 'Hello', fontFamily: family, fontWeight: weight })
  ];
  return parseDocument(document);
}

function createFixture({ documents = [makeDoc()], images = {}, fonts = [], saveImageOverride } = {}) {
  const directory = new FakeDirectoryHandle('workspace');
  directory.queryPermission = async () => 'granted';
  const metadataDirectory = new FakeDirectoryHandle('.tiny-image-star');
  const designsDirectory = new FakeDirectoryHandle('designs');
  const workspace = {
    workspaceId: 'workspace-1', directoryHandle: directory, metadataDirectory, designsDirectory,
    async getDesignDirectoryHandle(id, { create = false } = {}) {
      try { return await designsDirectory.getDirectoryHandle(id, { create }); }
      catch (error) { if (error.name === 'NotFoundError') error.code = 'DESIGN_NOT_FOUND'; throw error; }
    }
  };
  const sourceDocs = new Map(documents.map(document => [document.id, structuredClone(document)]));
  const rows = documents.map(document => ({ id: document.id, name: document.name, savedAt: 123 }));
  const sourceImages = new Map(Object.entries(images).map(([id, asset]) => [id, { ...asset, id, bytes: asset.bytes.slice() }]));
  const sourceFonts = new Map(fonts.map(font => [font.id, { ...font, bytes: font.bytes.slice() }]));
  const targetDesigns = new Map();
  const targetImages = new Map();
  const targetFonts = new Map();
  const locks = new FakeLocks();
  let createCount = 0;
  let saveCount = 0;
  const deps = {
    storage: {
      async listSavedDocuments() { return rows.map(row => ({ ...row })); },
      async loadDocumentById(id) { const doc = sourceDocs.get(id); return doc ? structuredClone(doc) : null; },
      async loadImageAsset(id) { const asset = sourceImages.get(id); return asset ? { ...asset, bytes: asset.bytes.slice() } : null; },
      async listFontAssets() { return [...sourceFonts.values()].map(({ bytes, ...metadata }) => ({ ...metadata })); },
      async loadFontAsset(id) { const font = sourceFonts.get(id); return font ? { ...font, bytes: font.bytes.slice() } : null; }
    },
    locks,
    crypto: webcrypto,
    now: 500,
    async createDesign(_workspace, doc) {
      createCount += 1;
      if (targetDesigns.has(doc.id)) throw Object.assign(new Error('exists'), { code: 'DESIGN_EXISTS' });
      await designsDirectory.getDirectoryHandle(doc.id, { create: true });
      const parsed = parseDocument(doc);
      targetDesigns.set(doc.id, { document: parsed, head: { sequence: 1, commitHash: 'a'.repeat(64) }, pageIds: parsed.pages.map(page => page.id) });
      return targetDesigns.get(doc.id);
    },
    async openDesign(_workspace, id) {
      const design = targetDesigns.get(id);
      if (!design) throw Object.assign(new Error('missing'), { code: 'DESIGN_NOT_FOUND' });
      return { ...design, document: structuredClone(design.document) };
    },
    async commitDesign(_workspace, id, document, { expectedHead }) {
      const current = targetDesigns.get(id);
      assert.deepEqual(current.head, expectedHead);
      const imageIds = new Set();
      const visit = value => {
        if (!value || typeof value !== 'object') return;
        if (typeof value.assetId === 'string' && value.assetId) imageIds.add(value.assetId);
        for (const child of Object.values(value)) visit(child);
      };
      visit(document);
      for (const assetId of imageIds) assert.equal(targetImages.has(`${id}:${assetId}`), true, `image ${assetId} is saved before final commit`);
      const next = { ...current, document: parseDocument(document), head: { sequence: current.head.sequence + 1, commitHash: 'c'.repeat(64) } };
      targetDesigns.set(id, next);
      return { acknowledged: true, ...next };
    },
    async saveImageAsset(_workspace, designId, assetId, bytes, options) {
      saveCount += 1;
      if (saveImageOverride) await saveImageOverride({ designId, assetId, bytes, options, saveCount, targetImages });
      const key = `${designId}:${assetId}`;
      const existing = targetImages.get(key);
      if (existing && (existing.mimeType !== options.mimeType || existing.bytes.length !== bytes.length
        || existing.bytes.some((value, index) => value !== bytes[index]))) throw Object.assign(new Error('collision'), { code: 'ASSET_ID_COLLISION' });
      const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
      const contentHash = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
      targetImages.set(key, { assetId, mimeType: options.mimeType, bytes: bytes.slice(), contentHash });
      return { assetId, contentHash, byteLength: bytes.length, mimeType: options.mimeType };
    },
    async readImageAsset(_workspace, designId, assetId) {
      const result = targetImages.get(`${designId}:${assetId}`);
      if (!result) throw Object.assign(new Error('missing'), { code: 'ASSET_NOT_FOUND' });
      return { metadata: { assetId: result.assetId, contentHash: result.contentHash, byteLength: result.bytes.length, mimeType: result.mimeType }, bytes: result.bytes.slice() };
    },
    async saveWorkspaceFontAsset(_workspace, designId, font) {
      const key = `${designId}:${font.id}`;
      const existing = targetFonts.get(key);
      if (existing && (existing.family !== font.family || existing.bytes.length !== font.bytes.length
        || existing.bytes.some((value, index) => value !== font.bytes[index]))) throw Object.assign(new Error('collision'), { code: 'FONT_ID_COLLISION' });
      const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', font.bytes));
      const contentHash = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
      targetFonts.set(key, { ...font, bytes: font.bytes.slice(), contentHash });
      return { fontId: font.id, contentHash, size: font.bytes.length };
    },
    async readWorkspaceFontAsset(_workspace, designId, fontId) {
      const font = targetFonts.get(`${designId}:${fontId}`);
      if (!font) throw Object.assign(new Error('missing'), { code: 'FONT_NOT_FOUND' });
      return { metadata: { fontId, size: font.bytes.length, contentHash: font.contentHash, name: font.name, type: font.type,
        family: font.family, weight: font.weight, style: font.style }, bytes: font.bytes.slice() };
    }
  };
  return { workspace, deps, rows, sourceDocs, sourceImages, sourceFonts, targetDesigns, targetImages, targetFonts,
    get createCount() { return createCount; }, get saveCount() { return saveCount; }, directory };
}

function fontAsset(id = 'font-brand', family = 'Brand', weight = 400, style = 'normal') {
  const bytes = imageBytes(0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  return { id, name: `${family}.ttf`, type: 'font/ttf', family, weight, style, bytes };
}

test('generic reference walk includes image IDs and font overrides anywhere in the design graph', () => {
  const result = collectReferencedAssets({
    pages: [{ children: [{ assetId: 'main-image', fontFamily: 'Brand', fontWeight: 400, children: [{ fontWeight: 700 }] }] }],
    components: [{ subtree: [{ imageAssetId: 'component-image', textRuns: [{ fontFamily: 'Display', fontStyle: 'italic' }] }] }],
    overrides: { nested: { assetId: 'override-image', fontFamily: '"Brand, Display", Arial', fontWeight: '700' } }
  });
  assert.deepEqual(result.imageAssetIds, ['component-image', 'main-image', 'override-image']);
  assert.ok(result.fontSpecs.some(spec => spec.family === 'brand' && spec.weight === 700));
  assert.ok(result.fontSpecs.some(spec => spec.family === 'display' && spec.style === 'italic'));
  assert.ok(result.fontSpecs.some(spec => spec.family === 'brand, display' && spec.weight === 700));
});

test('migration preserves design/page IDs and verifies every referenced image and local font byte-for-byte', async () => {
  const doc = makeDoc();
  const image = imageBytes(137, 80, 78, 71, 13, 10, 26, 10);
  const font = fontAsset();
  const fixture = createFixture({ documents: [doc], images: { 'img-1': { name: 'sample.png', type: 'image/png', bytes: image } }, fonts: [font] });
  const progress = [];
  const result = await migrateIndexedDbToWorkspace(fixture.workspace, { ...fixture.deps, onProgress: item => progress.push(item) });
  assert.equal(result.status, 'complete');
  assert.equal(result.migratedDesigns, 1);
  assert.equal(fixture.createCount, 1);
  assert.equal(fixture.targetDesigns.get(doc.id).document.pages[0].id, doc.pages[0].id);
  assert.deepEqual(fixture.targetImages.get(`${doc.id}:img-1`).bytes, image);
  assert.deepEqual(fixture.targetFonts.get(`${doc.id}:${font.id}`).bytes, font.bytes);
  assert.deepEqual(fixture.sourceImages.get('img-1').bytes, image, 'source image bytes remain intact');
  assert.deepEqual(fixture.sourceFonts.get(font.id).bytes, font.bytes, 'source font bytes remain intact');
  assert.deepEqual(fixture.sourceDocs.get(doc.id), doc, 'source design remains intact');
  assert.ok(progress.some(item => item.phase === 'image' && item.status === 'verified'));
  assert.ok(progress.some(item => item.phase === 'font' && item.status === 'verified'));
  const journal = JSON.parse(await (await (await fixture.workspace.metadataDirectory.getFileHandle(INDEXED_DB_MIGRATION_FILE)).getFile()).text());
  assert.equal(journal.complete, true);
  assert.deepEqual(journal.designs[0].completedImageAssetIds, ['img-1']);
  assert.deepEqual(journal.designs[0].completedFontIds, [font.id]);
});

test('interrupted asset copy resumes from the journal without replacing the design or losing source data', async () => {
  const doc = makeDoc({ images: ['img-1', 'img-2'] });
  let shouldFail = true;
  const fixture = createFixture({
    documents: [doc],
    images: {
      'img-1': { name: 'one.png', type: 'image/png', bytes: imageBytes(1, 2, 3) },
      'img-2': { name: 'two.png', type: 'image/png', bytes: imageBytes(4, 5, 6) }
    },
    saveImageOverride: async ({ assetId }) => { if (assetId === 'img-2' && shouldFail) { shouldFail = false; throw new Error('simulated interrupted write'); } }
  });
  const first = await migrateIndexedDbToWorkspace(fixture.workspace, fixture.deps);
  assert.equal(first.status, 'partial');
  assert.equal(first.errors[0].designId, doc.id);
  assert.equal(fixture.targetImages.has(`${doc.id}:img-1`), true);
  assert.equal(fixture.targetImages.has(`${doc.id}:img-2`), false);
  assert.equal(fixture.targetDesigns.get(doc.id).document.pages[0].children.length, 0,
    'the asset-free staging snapshot is not finalized with missing image bytes');
  const second = await migrateIndexedDbToWorkspace(fixture.workspace, fixture.deps);
  assert.equal(second.status, 'complete');
  assert.equal(second.resumed, true);
  assert.equal(fixture.createCount, 1, 'retry reopens the migration-owned design instead of recreating it');
  assert.deepEqual(fixture.targetImages.get(`${doc.id}:img-2`).bytes, fixture.sourceImages.get('img-2').bytes);
  assert.equal(fixture.targetDesigns.get(doc.id).document.pages[0].children.length, doc.pages[0].children.length,
    'the original document is committed only after all image files have been verified');
  assert.equal(fixture.sourceDocs.has(doc.id), true);
});

test('a modified partial destination fails as a conflict and is not overwritten on resume', async () => {
  const doc = makeDoc({ images: ['img-1', 'img-2'] });
  let failSecond = true;
  const fixture = createFixture({
    documents: [doc],
    images: {
      'img-1': { name: 'one.png', type: 'image/png', bytes: imageBytes(1, 2, 3) },
      'img-2': { name: 'two.png', type: 'image/png', bytes: imageBytes(4, 5, 6) }
    },
    saveImageOverride: async ({ assetId }) => { if (assetId === 'img-2' && failSecond) { failSecond = false; throw new Error('pause before final commit'); } }
  });
  await migrateIndexedDbToWorkspace(fixture.workspace, fixture.deps);
  const staged = fixture.targetDesigns.get(doc.id);
  const changed = structuredClone(staged.document);
  changed.name = 'changed outside migration';
  fixture.targetDesigns.set(doc.id, { ...staged, document: changed });
  const result = await migrateIndexedDbToWorkspace(fixture.workspace, fixture.deps);
  assert.equal(result.status, 'partial');
  assert.equal(result.errors[0].code, 'MIGRATION_DESTINATION_CONFLICT');
  assert.equal(fixture.targetDesigns.get(doc.id).document.name, 'changed outside migration');
});

test('resuming refuses changed source bytes after an earlier asset was copied', async () => {
  const doc = makeDoc({ images: ['img-1', 'img-2'] });
  let pause = true;
  const fixture = createFixture({
    documents: [doc],
    images: {
      'img-1': { name: 'one.png', type: 'image/png', bytes: imageBytes(1, 2, 3) },
      'img-2': { name: 'two.png', type: 'image/png', bytes: imageBytes(4, 5, 6) }
    },
    saveImageOverride: async ({ assetId }) => { if (assetId === 'img-2' && pause) { pause = false; throw new Error('pause'); } }
  });
  await migrateIndexedDbToWorkspace(fixture.workspace, fixture.deps);
  fixture.sourceImages.get('img-2').bytes = imageBytes(9, 9, 9);
  const result = await migrateIndexedDbToWorkspace(fixture.workspace, fixture.deps);
  assert.equal(result.status, 'partial');
  assert.equal(result.errors[0].code, 'MIGRATION_SOURCE_CHANGED');
  assert.equal(fixture.targetImages.has(`${doc.id}:img-1`), true);
  assert.equal(fixture.targetImages.has(`${doc.id}:img-2`), false);
  assert.equal(fixture.targetDesigns.get(doc.id).document.pages[0].children.length, 0);
});

test('an unrelated workspace design with the same ID is reported and never overwritten', async () => {
  const source = makeDoc();
  const unrelated = structuredClone(source);
  unrelated.name = 'Unrelated existing design';
  const fixture = createFixture({ documents: [source], images: { 'img-1': { name: 'one.png', type: 'image/png', bytes: imageBytes(1, 2) } } });
  const directory = await fixture.workspace.getDesignDirectoryHandle(source.id, { create: true });
  fixture.targetDesigns.set(source.id, { document: unrelated, head: { sequence: 1, commitHash: 'b'.repeat(64) }, pageIds: unrelated.pages.map(page => page.id) });
  const result = await migrateIndexedDbToWorkspace(fixture.workspace, fixture.deps);
  assert.equal(result.status, 'partial');
  assert.equal(result.errors[0].code, 'MIGRATION_DESTINATION_CONFLICT');
  assert.equal(fixture.targetDesigns.get(source.id).document.name, 'Unrelated existing design');
  assert.equal(fixture.createCount, 0);
  assert.ok(directory);
});

test('missing referenced image data fails before creating a destination design or marking migration complete', async () => {
  const doc = makeDoc();
  const fixture = createFixture({ documents: [doc], images: {} });
  const result = await migrateIndexedDbToWorkspace(fixture.workspace, fixture.deps);
  assert.equal(result.status, 'partial');
  assert.equal(result.errors[0].code, 'MIGRATION_ASSET_MISSING');
  assert.equal(fixture.targetDesigns.has(doc.id), false);
  assert.equal(fixture.workspace.designsDirectory.children.has(doc.id), false);
  const journalHandle = await fixture.workspace.metadataDirectory.getFileHandle(INDEXED_DB_MIGRATION_FILE);
  const journalText = await (await journalHandle.getFile()).text();
  assert.equal(JSON.parse(journalText).complete, false);
});

test('a changed IndexedDB source library cannot resume an older migration journal', async () => {
  const doc = makeDoc();
  const fixture = createFixture({ documents: [doc], images: { 'img-1': { name: 'one.png', type: 'image/png', bytes: imageBytes(1) } } });
  await migrateIndexedDbToWorkspace(fixture.workspace, fixture.deps);
  fixture.rows[0].savedAt += 1;
  await assert.rejects(migrateIndexedDbToWorkspace(fixture.workspace, fixture.deps), error => error.code === 'MIGRATION_SOURCE_CHANGED');
});
