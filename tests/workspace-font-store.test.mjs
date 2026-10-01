import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { addNode, createDocument, createNode } from '../src/model.js';
import { createWorkspace } from '../src/workspace/workspace-store.js';
import { commitDesign, createDesign, openDesign } from '../src/workspace/design-store.js';
import {
  deleteWorkspaceFontAsset, listWorkspaceFontAssets, readWorkspaceFontAsset, saveWorkspaceFontAsset
} from '../src/workspace/font-store.js';
import { MAX_LOCAL_FONT_BYTES } from '../src/font-assets.js';

function notFound() { const error = new Error('Not found'); error.name = 'NotFoundError'; return error; }

class MemoryFileHandle {
  constructor(name, parent) { this.kind = 'file'; this.name = name; this.parent = parent; this.bytes = new Uint8Array(); }
  async getFile() {
    const bytes = this.bytes.slice();
    return { size: this.reportedSize ?? bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer, text: async () => new TextDecoder().decode(bytes) };
  }
  async createWritable() {
    let bytes = new Uint8Array();
    return {
      write: async value => {
        if (this.parent.root.failWriteFor === this.name) throw new Error(`injected write failure for ${this.name}`);
        bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value).slice();
      },
      close: async () => {
        if (this.parent.root.failCloseFor === this.name) { this.parent.root.failCloseFor = null; throw new Error('injected close failure'); }
        this.bytes = this.parent.root.corruptOnCloseFor === this.name ? Uint8Array.from([...bytes, 255]) : bytes;
      },
      abort: async () => {}
    };
  }
}

class MemoryDirectoryHandle {
  constructor(name = 'root', parent = null, root = null) {
    this.kind = 'directory'; this.name = name; this.parent = parent; this.root = root || this;
    this.children = new Map(); this.permission = 'granted';
  }
  async queryPermission() { return this.permission; }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (typeof name !== 'string' || name === '.' || name === '..' || /[/\\]/.test(name)) throw new TypeError('unsafe path');
    const item = this.children.get(name);
    if (item) { if (item.kind !== 'directory') throw new TypeError('not a directory'); return item; }
    if (!create) throw notFound();
    const directory = new MemoryDirectoryHandle(name, this, this.root); this.children.set(name, directory); return directory;
  }
  async getFileHandle(name, { create = false } = {}) {
    if (typeof name !== 'string' || name === '.' || name === '..' || /[/\\]/.test(name)) throw new TypeError('unsafe path');
    const item = this.children.get(name);
    if (item) { if (item.kind !== 'file') throw new TypeError('not a file'); return item; }
    if (!create) throw notFound();
    const file = new MemoryFileHandle(name, this); this.children.set(name, file); return file;
  }
  async removeEntry(name) { if (!this.children.has(name)) throw notFound(); this.children.delete(name); }
  async *entries() { yield* this.children.entries(); }
  async *values() { yield* this.children.values(); }
}

class Locks {
  constructor() { this.queues = new Map(); }
  request(name, { mode }, callback) {
    assert.equal(mode, 'exclusive');
    const previous = this.queues.get(name) || Promise.resolve();
    const current = previous.then(callback, callback);
    this.queues.set(name, current.then(() => {}, () => {}));
    return current;
  }
}

const locks = new Locks();
async function fixture() {
  const root = new MemoryDirectoryHandle();
  const workspace = await createWorkspace(root, { crypto: webcrypto, locks });
  const design = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  return { root, workspace, designId: design.designId };
}
function font(id, bytes = Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])) {
  return { id, name: 'Example.ttf', type: 'font/ttf', family: 'Example', weight: 400, style: 'normal', bytes };
}
const options = { crypto: webcrypto, locks };

test('font bytes round-trip exactly and metadata has a content hash and byte size', async () => {
  const { workspace, designId } = await fixture();
  const source = font('font_1', Uint8Array.from([0, 1, 0, 0, 8, 7, 6, 5, 4, 3, 2, 1]));
  const saved = await saveWorkspaceFontAsset(workspace, designId, source, { ...options, now: 123 });
  assert.match(saved.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(saved.size, source.bytes.length);
  assert.equal(saved.deduplicated, false);
  const loaded = await readWorkspaceFontAsset(workspace, designId, source.id, { crypto: webcrypto });
  assert.deepEqual(loaded.bytes, source.bytes);
  assert.deepEqual(loaded.metadata, {
    formatVersion: 1, designId, fontId: source.id, contentHash: saved.contentHash,
    size: source.bytes.length, id: source.id, name: source.name, type: source.type,
    family: source.family, weight: source.weight, style: source.style, createdAt: 123
  });
  assert.ok(Object.isFrozen(loaded.metadata));
});

test('font asset writes fail closed after workspace design deletion is marked', async () => {
  const { workspace, designId } = await fixture();
  const handle = await workspace.designsDirectory.getFileHandle(`${designId}.deleted.json`, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify({ formatVersion: 1, designId, deletedAt: 1 }));
  await writable.close();
  await assert.rejects(saveWorkspaceFontAsset(workspace, designId, font('late-font'), options),
    error => error.code === 'DESIGN_DELETED');
});

test('stable font IDs retry idempotently and different IDs deduplicate bytes per design', async () => {
  const { workspace, designId } = await fixture();
  const first = await saveWorkspaceFontAsset(workspace, designId, font('same'), { ...options, now: 10 });
  const retry = await saveWorkspaceFontAsset(workspace, designId, font('same'), { ...options, now: 20 });
  const second = await saveWorkspaceFontAsset(workspace, designId, font('another'), options);
  assert.equal(retry.createdAt, first.createdAt);
  assert.equal(retry.deduplicated, true);
  assert.equal(second.contentHash, first.contentHash);
  assert.equal(second.deduplicated, true);
  const listed = await listWorkspaceFontAssets(workspace, designId, { crypto: webcrypto });
  assert.deepEqual(listed.map(item => item.metadata.id), ['another', 'same']);
  assert.deepEqual(listed[0].bytes, font('same').bytes);
  const design = await workspace.getDesignDirectoryHandle(designId);
  const blobs = await (await design.getDirectoryHandle('fonts')).getDirectoryHandle('blobs');
  assert.equal(blobs.children.size, 1);
});

test('the same font saved to another design gets its own portable blob copy', async () => {
  const { workspace, designId: firstDesignId } = await fixture();
  const secondDesign = await createDesign(workspace, createDocument(), options);
  const source = font('portable');
  const first = await saveWorkspaceFontAsset(workspace, firstDesignId, source, options);
  const second = await saveWorkspaceFontAsset(workspace, secondDesign.designId, source, options);
  assert.equal(second.contentHash, first.contentHash);
  const firstDirectory = await workspace.getDesignDirectoryHandle(firstDesignId);
  const secondDirectory = await workspace.getDesignDirectoryHandle(secondDesign.designId);
  const firstBlobs = await (await (await firstDirectory.getDirectoryHandle('fonts')).getDirectoryHandle('blobs'));
  const secondBlobs = await (await (await secondDirectory.getDirectoryHandle('fonts')).getDirectoryHandle('blobs'));
  assert.notEqual(firstBlobs, secondBlobs);
  assert.ok(firstBlobs.children.has(first.contentHash));
  assert.ok(secondBlobs.children.has(second.contentHash));
  assert.deepEqual((await readWorkspaceFontAsset(workspace, secondDesign.designId, 'portable')).bytes, source.bytes);
});

test('a font ID cannot be reused for changed bytes or immutable metadata', async () => {
  const { workspace, designId } = await fixture();
  await saveWorkspaceFontAsset(workspace, designId, font('stable'), options);
  await assert.rejects(saveWorkspaceFontAsset(workspace, designId, font('stable', Uint8Array.from([0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1])), options), error => error.code === 'FONT_ID_COLLISION');
  await assert.rejects(saveWorkspaceFontAsset(workspace, designId, { ...font('stable'), family: 'Changed' }, options), error => error.code === 'FONT_ID_COLLISION');
  assert.deepEqual((await readWorkspaceFontAsset(workspace, designId, 'stable')).bytes, font('stable').bytes);
});

test('tampered blobs and corrupt metadata fail closed during read and listing', async () => {
  const { workspace, designId } = await fixture();
  const saved = await saveWorkspaceFontAsset(workspace, designId, font('tamp'), options);
  const design = await workspace.getDesignDirectoryHandle(designId);
  const fonts = await design.getDirectoryHandle('fonts');
  const blobs = await fonts.getDirectoryHandle('blobs');
  (await blobs.getFileHandle(saved.contentHash)).bytes[0] ^= 1;
  await assert.rejects(readWorkspaceFontAsset(workspace, designId, 'tamp'), error => error.code === 'FONT_CONTENT_CORRUPT');
  await assert.rejects(listWorkspaceFontAssets(workspace, designId), error => error.code === 'FONT_CONTENT_CORRUPT');
  const metadata = await fonts.getDirectoryHandle('metadata');
  (await metadata.getFileHandle('tamp.json')).bytes = new TextEncoder().encode('{bad');
  await assert.rejects(readWorkspaceFontAsset(workspace, designId, 'tamp'), error => error.code === 'FONT_METADATA_INVALID');
});

test('write permission, lock support, byte verification, and failure injection protect registration', async () => {
  const { root, workspace, designId } = await fixture();
  root.permission = 'denied';
  await assert.rejects(saveWorkspaceFontAsset(workspace, designId, font('nope'), options), error => error.code === 'PERMISSION_REQUIRED');
  root.permission = 'granted';
  root.failWriteFor = 'broken.json';
  await assert.rejects(saveWorkspaceFontAsset(workspace, designId, font('broken'), options), error => error.code === 'FONT_WRITE_FAILED');
  root.failWriteFor = null;
  root.corruptOnCloseFor = 'verify.json';
  await assert.rejects(saveWorkspaceFontAsset(workspace, designId, font('verify'), options), error => error.code === 'FONT_VERIFY_FAILED');
  await assert.rejects(saveWorkspaceFontAsset(workspace, designId, font('unlocked'), { crypto: webcrypto, locks: null }), error => error.code === 'CROSS_TAB_LOCK_UNSUPPORTED');
  const design = await workspace.getDesignDirectoryHandle(designId);
  const metadata = await (await design.getDirectoryHandle('fonts')).getDirectoryHandle('metadata');
  assert.equal(metadata.children.size, 0);
});

test('font validation, safe IDs, and maximum file size are enforced before creating directories', async () => {
  const { workspace, designId } = await fixture();
  for (const id of ['../escape', 'a/b', '.', '..', '']) {
    await assert.rejects(saveWorkspaceFontAsset(workspace, designId, font(id), options), error => ['INVALID_FONT', 'INVALID_ID'].includes(error.code));
  }
  await assert.rejects(saveWorkspaceFontAsset(workspace, '../design', font('ok'), options), error => error.code === 'INVALID_ID');
  await assert.rejects(saveWorkspaceFontAsset(workspace, designId, font('bad', new Uint8Array(12)), options), error => error.code === 'INVALID_FONT');
  await assert.rejects(saveWorkspaceFontAsset(workspace, designId, font('large', new Uint8Array(MAX_LOCAL_FONT_BYTES + 1)), options), error => error.code === 'INVALID_FONT');
  const design = await workspace.getDesignDirectoryHandle(designId);
  assert.equal(design.children.has('fonts'), false);
});

test('deleting metadata keeps a deduplicated blob available for other font records', async () => {
  const { workspace, designId } = await fixture();
  const one = font('one');
  const first = await saveWorkspaceFontAsset(workspace, designId, one, options);
  await saveWorkspaceFontAsset(workspace, designId, { ...one, id: 'two' }, options);
  await deleteWorkspaceFontAsset(workspace, designId, 'one', { locks });
  assert.deepEqual((await readWorkspaceFontAsset(workspace, designId, 'two')).bytes, one.bytes);
  await deleteWorkspaceFontAsset(workspace, designId, 'two', { locks });
  const design = await workspace.getDesignDirectoryHandle(designId);
  const blobs = await (await design.getDirectoryHandle('fonts')).getDirectoryHandle('blobs');
  assert.ok(blobs.children.has(first.contentHash));
});

test('font metadata cannot be removed while any retained snapshot uses that face', async () => {
  const document = createDocument();
  addNode(document, createNode('text', { fontFamily: '"Example", Arial, sans-serif', fontWeight: 400, fontStyle: 'normal' }));
  const root = new MemoryDirectoryHandle();
  const workspace = await createWorkspace(root, { crypto: webcrypto, locks });
  const design = await createDesign(workspace, document, options);
  await saveWorkspaceFontAsset(workspace, design.designId, font('used'), options);
  await assert.rejects(deleteWorkspaceFontAsset(workspace, design.designId, 'used', { locks }), error => error.code === 'FONT_IN_USE');

  const current = await openDesign(workspace, design.designId, options);
  const edited = structuredClone(current.document);
  edited.pages[0].children = [];
  const next = await commitDesign(workspace, design.designId, edited, {
    expectedHead: current.head, pageId: current.pageIds[0], ...options
  });
  await assert.rejects(deleteWorkspaceFontAsset(workspace, design.designId, 'used', { locks }), error => error.code === 'FONT_IN_USE');
  assert.equal((await openDesign(workspace, design.designId, options)).head.commitHash, next.head.commitHash);
});

test('pages can be added and removed in folder-backed designs with per-page immutable revisions', async () => {
  const { workspace, designId } = await fixture();
  const initial = await openDesign(workspace, designId, options);
  const expanded = structuredClone(initial.document);
  expanded.pages.push({ ...structuredClone(expanded.pages[0]), id: 'page_two', name: 'Page 2', children: [] });
  const added = await commitDesign(workspace, designId, expanded, {
    expectedHead: initial.head, pageId: 'page_two', ...options
  });
  const reopened = await openDesign(workspace, designId, options);
  assert.deepEqual(reopened.pageIds, [initial.pageIds[0], 'page_two']);
  const design = await workspace.getDesignDirectoryHandle(designId);
  const pageDirectory = await design.getDirectoryHandle('pages').then(handle => handle.getDirectoryHandle('page_two'));
  const revisions = await pageDirectory.getDirectoryHandle('revisions');
  assert.ok(revisions.children.has(`${added.head.commitHash}.json`));

  const contracted = structuredClone(reopened.document);
  contracted.pages = contracted.pages.filter(page => page.id !== 'page_two');
  const removed = await commitDesign(workspace, designId, contracted, {
    expectedHead: reopened.head, pageId: initial.pageIds[0], ...options
  });
  assert.deepEqual((await openDesign(workspace, designId, options)).pageIds, [initial.pageIds[0]]);
  assert.ok(revisions.children.has(`${added.head.commitHash}.json`), 'removed page history remains recoverable');
  assert.notEqual(removed.head.commitHash, added.head.commitHash);
});
