import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { addNode, createDocument, createNode, removeNode } from '../src/model.js';
import { createWorkspace } from '../src/workspace/workspace-store.js';
import { commitDesign, createDesign, openDesign } from '../src/workspace/design-store.js';
import { deleteImageAsset, MAX_IMAGE_ASSET_BYTES, readImageAsset, saveImageAsset } from '../src/workspace/asset-store.js';

function notFound() { const error = new Error('Not found'); error.name = 'NotFoundError'; return error; }

class MemoryFileHandle {
  constructor(name, parent) { this.kind = 'file'; this.name = name; this.parent = parent; this.bytes = new Uint8Array(); }
  async getFile() {
    const bytes = this.bytes.slice();
    return {
      size: this.reportedSize ?? bytes.byteLength,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes)
    };
  }
  async createWritable() {
    let bytes = new Uint8Array();
    return {
      write: async value => {
        if (this.parent.root.failWriteFor === this.name) throw new Error(`injected write failure for ${this.name}`);
        bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value).slice();
      },
      close: async () => {
        if (this.parent.root.failCloseFor === this.name) {
          this.parent.root.failCloseFor = null;
          throw new Error(`injected close failure for ${this.name}`);
        }
        this.bytes = this.parent.root.corruptOnCloseFor === this.name
          ? Uint8Array.from([...bytes, 255]) : bytes;
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
  async *values() { yield* this.children.values(); }
  async removeEntry(name) {
    if (!this.children.has(name)) throw notFound();
    this.children.delete(name);
  }
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
const bytesA = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const bytesB = Uint8Array.from([255, 216, 255, 0, 9, 8, 7]);
const options = { crypto: webcrypto, locks };

test('source image bytes round-trip exactly and are stored at a generated content hash path', async () => {
  const { workspace, designId } = await fixture();
  const saved = await saveImageAsset(workspace, designId, 'photo_1', bytesA, { ...options, mimeType: 'image/png', now: 100 });
  assert.match(saved.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(saved.byteLength, bytesA.byteLength);
  assert.equal(saved.deduplicated, false);
  const loaded = await readImageAsset(workspace, designId, 'photo_1', { crypto: webcrypto });
  assert.deepEqual(loaded.bytes, bytesA);
  assert.deepEqual(loaded.metadata, {
    formatVersion: 1, designId, assetId: 'photo_1', contentHash: saved.contentHash,
    byteLength: bytesA.byteLength, mimeType: 'image/png', createdAt: 100
  });
});

test('saving the same asset ID and bytes is idempotent and preserves original metadata', async () => {
  const { workspace, designId } = await fixture();
  const first = await saveImageAsset(workspace, designId, 'same', bytesA, { ...options, mimeType: 'image/png', now: 10 });
  const again = await saveImageAsset(workspace, designId, 'same', bytesA, { ...options, mimeType: 'image/png', now: 20 });
  assert.equal(again.deduplicated, true);
  assert.equal(again.createdAt, first.createdAt);
  assert.equal(again.contentHash, first.contentHash);
});

test('same asset ID with different bytes or immutable MIME metadata is refused without changing its contents', async () => {
  const { workspace, designId } = await fixture();
  const original = await saveImageAsset(workspace, designId, 'same', bytesA, { ...options, mimeType: 'image/png' });
  await assert.rejects(saveImageAsset(workspace, designId, 'same', bytesB, { ...options, mimeType: 'image/jpeg' }), error => error.code === 'ASSET_ID_COLLISION');
  await assert.rejects(saveImageAsset(workspace, designId, 'same', bytesA, { ...options, mimeType: 'image/jpeg' }), error => error.code === 'ASSET_ID_COLLISION');
  assert.deepEqual((await readImageAsset(workspace, designId, 'same')).bytes, bytesA);
  assert.equal((await readImageAsset(workspace, designId, 'same')).metadata.contentHash, original.contentHash);
});

test('different asset IDs deduplicate identical content, and deleting one reference preserves the shared bytes', async () => {
  const { workspace, designId } = await fixture();
  const first = await saveImageAsset(workspace, designId, 'first', bytesA, { ...options, mimeType: 'image/png' });
  const second = await saveImageAsset(workspace, designId, 'second', bytesA, { ...options, mimeType: 'image/png' });
  assert.equal(second.contentHash, first.contentHash);
  assert.equal(second.deduplicated, true);
  const design = await workspace.getDesignDirectoryHandle(designId);
  const blobs = await (await design.getDirectoryHandle('assets')).getDirectoryHandle('blobs');
  assert.deepEqual([...blobs.children.keys()], [first.contentHash]);
  await deleteImageAsset(workspace, designId, 'first', { locks });
  assert.deepEqual((await readImageAsset(workspace, designId, 'second')).bytes, bytesA);
  await deleteImageAsset(workspace, designId, 'second', { locks });
  assert.ok(blobs.children.has(first.contentHash), 'content is retained for safe future collection');
});

test('image deletion is blocked for any retained snapshot and commits cannot create dangling image references', async () => {
  const root = new MemoryDirectoryHandle();
  const workspace = await createWorkspace(root, { crypto: webcrypto, locks });
  const document = createDocument();
  addNode(document, createNode('image', { assetId: 'historical-photo', fileName: 'photo.png' }));
  const created = await createDesign(workspace, document, { crypto: webcrypto, locks });
  await saveImageAsset(workspace, created.designId, 'historical-photo', bytesA, { ...options, mimeType: 'image/png' });

  await assert.rejects(deleteImageAsset(workspace, created.designId, 'historical-photo', { locks }), error => error.code === 'ASSET_IN_USE');
  const edited = structuredClone((await openDesign(workspace, created.designId, { crypto: webcrypto, locks })).document);
  removeNode(edited, document.pages[0].children[0].id, document.pages[0].id);
  const current = await openDesign(workspace, created.designId, { crypto: webcrypto, locks });
  await commitDesign(workspace, created.designId, edited, {
    expectedHead: current.head, pageId: created.pageIds[0], crypto: webcrypto, locks
  });
  await assert.rejects(deleteImageAsset(workspace, created.designId, 'historical-photo', { locks }), error => error.code === 'ASSET_IN_USE');

  const second = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const dangling = structuredClone(second.document);
  addNode(dangling, createNode('image', { assetId: 'not-written', fileName: 'missing.png' }));
  await assert.rejects(commitDesign(workspace, second.designId, dangling, {
    expectedHead: second.head, pageId: second.pageIds[0], crypto: webcrypto, locks
  }), error => error.code === 'ASSET_MISSING');
});

test('tampered content-addressed bytes are rejected on read and on idempotent save', async () => {
  const { workspace, designId } = await fixture();
  const saved = await saveImageAsset(workspace, designId, 'photo', bytesA, { ...options, mimeType: 'image/png' });
  const design = await workspace.getDesignDirectoryHandle(designId);
  const blobs = await (await design.getDirectoryHandle('assets')).getDirectoryHandle('blobs');
  (await blobs.getFileHandle(saved.contentHash)).bytes[0] ^= 1;
  await assert.rejects(readImageAsset(workspace, designId, 'photo'), error => error.code === 'ASSET_CONTENT_CORRUPT');
  await assert.rejects(saveImageAsset(workspace, designId, 'photo', bytesA, { ...options, mimeType: 'image/png' }), error => error.code === 'ASSET_CONTENT_CORRUPT');
});

test('same-length image corruption cannot be committed as a referenced design asset', async () => {
  const { workspace, designId } = await fixture();
  const saved = await saveImageAsset(workspace, designId, 'verified-photo', bytesA, { ...options, mimeType: 'image/png' });
  const current = await openDesign(workspace, designId, options);
  const withImage = structuredClone(current.document);
  addNode(withImage, createNode('image', { assetId: 'verified-photo', fileName: 'photo.png' }));
  const committed = await commitDesign(workspace, designId, withImage, {
    expectedHead: current.head, pageId: current.pageIds[0], ...options
  });

  const design = await workspace.getDesignDirectoryHandle(designId);
  const blobs = await (await design.getDirectoryHandle('assets')).getDirectoryHandle('blobs');
  (await blobs.getFileHandle(saved.contentHash)).bytes[0] ^= 1;
  const latest = await openDesign(workspace, designId, options);
  const candidate = structuredClone(latest.document);
  candidate.name = 'must not acknowledge corrupt image';
  await assert.rejects(commitDesign(workspace, designId, candidate, {
    expectedHead: committed.head, pageId: latest.pageIds[0], ...options
  }), error => error.code === 'ASSET_CORRUPT');
  assert.deepEqual((await openDesign(workspace, designId, options)).head, committed.head);
});

test('folder permission and injected write failures do not report success or replace existing data', async () => {
  const { root, workspace, designId } = await fixture();
  root.permission = 'denied';
  await assert.rejects(saveImageAsset(workspace, designId, 'photo', bytesA, { ...options, mimeType: 'image/png' }), error => error.code === 'PERMISSION_REQUIRED');
  root.permission = 'granted';
  root.failWriteFor = 'photo.json';
  await assert.rejects(saveImageAsset(workspace, designId, 'photo', bytesA, { ...options, mimeType: 'image/png' }), error => error.code === 'ASSET_WRITE_FAILED');
  const design = await workspace.getDesignDirectoryHandle(designId);
  const assets = await design.getDirectoryHandle('assets');
  const metadata = await assets.getDirectoryHandle('metadata');
  assert.equal(metadata.children.size, 0);
  root.failWriteFor = null;
  await saveImageAsset(workspace, designId, 'photo', bytesA, { ...options, mimeType: 'image/png' });
  root.failWriteFor = 'other.json';
  await assert.rejects(saveImageAsset(workspace, designId, 'other', bytesB, { ...options, mimeType: 'image/jpeg' }), error => error.code === 'ASSET_WRITE_FAILED');
  assert.deepEqual((await readImageAsset(workspace, designId, 'photo')).bytes, bytesA);
});

test('close-and-reopen byte verification rejects altered writes before registration', async () => {
  const { root, workspace, designId } = await fixture();
  root.corruptOnCloseFor = 'bad-photo.json';
  await assert.rejects(saveImageAsset(workspace, designId, 'bad-photo', bytesA, { ...options, mimeType: 'image/png' }), error => error.code === 'ASSET_VERIFY_FAILED');
  const design = await workspace.getDesignDirectoryHandle(designId);
  const metadata = await (await design.getDirectoryHandle('assets')).getDirectoryHandle('metadata');
  assert.equal(metadata.children.size, 0);
});

test('traversal IDs, empty bytes, invalid MIME, and oversize input are rejected before asset paths are created', async () => {
  const { workspace, designId } = await fixture();
  for (const id of ['../escape', 'a/b', '.', '..', '']) {
    await assert.rejects(saveImageAsset(workspace, designId, id, bytesA, { ...options, mimeType: 'image/png' }), error => error.code === 'INVALID_ID');
  }
  await assert.rejects(saveImageAsset(workspace, '../design', 'ok', bytesA, { ...options, mimeType: 'image/png' }), error => error.code === 'INVALID_ID');
  await assert.rejects(saveImageAsset(workspace, designId, 'empty', new Uint8Array(), { ...options, mimeType: 'image/png' }), error => error.code === 'INVALID_ASSET_BYTES');
  await assert.rejects(saveImageAsset(workspace, designId, 'mime', bytesA, { ...options, mimeType: 'text/plain' }), error => error.code === 'INVALID_ASSET_MIME');
  const tooLarge = new Uint8Array(MAX_IMAGE_ASSET_BYTES + 1);
  await assert.rejects(saveImageAsset(workspace, designId, 'large', tooLarge, { ...options, mimeType: 'image/png' }), error => error.code === 'ASSET_TOO_LARGE');
  const design = await workspace.getDesignDirectoryHandle(designId);
  assert.equal(design.children.has('assets'), false);
});

test('content hash path collision with bytes that do not match the hash fails closed', async () => {
  const { workspace, designId } = await fixture();
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytesA));
  const hash = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const design = await workspace.getDesignDirectoryHandle(designId);
  const blobs = await (await (await design.getDirectoryHandle('assets', { create: true })).getDirectoryHandle('blobs', { create: true }));
  const collision = await blobs.getFileHandle(hash, { create: true });
  collision.bytes = bytesB;
  await assert.rejects(saveImageAsset(workspace, designId, 'new-id', bytesA, { ...options, mimeType: 'image/png' }), error => error.code === 'ASSET_CONTENT_COLLISION');
  const metadata = await (await design.getDirectoryHandle('assets')).getDirectoryHandle('metadata', { create: true });
  assert.equal(metadata.children.size, 0);
  assert.deepEqual(collision.bytes, bytesB);
});
