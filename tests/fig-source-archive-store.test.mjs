import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { createDocument } from '../src/model.js';
import { createWorkspace } from '../src/workspace/workspace-store.js';
import { createDesign } from '../src/workspace/design-store.js';
import {
  deleteFigSourceArchive,
  MAX_FIG_SOURCE_ARCHIVE_BYTES,
  readFigSourceArchive,
  saveFigSourceArchive
} from '../src/workspace/fig-source-archive-store.js';

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
  async removeEntry(name, { recursive = false } = {}) {
    const item = this.children.get(name);
    if (!item) throw notFound();
    if (item.kind === 'directory' && item.children.size && !recursive) {
      const error = new Error('Directory is not empty'); error.name = 'InvalidModificationError'; throw error;
    }
    this.children.delete(name);
  }
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
const options = { crypto: webcrypto, locks };
async function fixture() {
  const root = new MemoryDirectoryHandle();
  const workspace = await createWorkspace(root, { crypto: webcrypto, locks });
  const created = await createDesign(workspace, createDocument(), options);
  return { root, workspace, designId: created.designId };
}
function bytes(...values) { return Uint8Array.from(values); }

test('the optional sidecar is absent without creating storage folders', async () => {
  const { workspace, designId } = await fixture();
  const design = await workspace.getDesignDirectoryHandle(designId);
  assert.equal(design.children.has('fig-source'), false);
  assert.equal(await readFigSourceArchive(workspace, designId, options), null);
  assert.equal(design.children.has('fig-source'), false);
});

test('original .fig bytes round-trip from an isolated folder with SHA-256 metadata', async () => {
  const { workspace, designId } = await fixture();
  const original = bytes(0x50, 0x4b, 0x03, 0x04, 9, 8, 7, 6);
  const source = new Uint8Array([99, ...original, 88]).subarray(1, original.length + 1);
  const saved = await saveFigSourceArchive(workspace, designId, source, { ...options, now: 123 });
  const expectedHash = Buffer.from(await webcrypto.subtle.digest('SHA-256', original)).toString('hex');
  assert.deepEqual(saved, {
    formatVersion: 1, designId, contentHash: expectedHash, byteLength: original.length, createdAt: 123, deduplicated: false
  });

  const loaded = await readFigSourceArchive(workspace, designId, options);
  assert.deepEqual(loaded.bytes, original);
  assert.deepEqual(loaded.metadata, {
    formatVersion: 1, designId, contentHash: expectedHash, byteLength: original.length, createdAt: 123
  });
  assert.ok(Object.isFrozen(loaded.metadata));
  assert.ok(Object.isFrozen(loaded));

  const design = await workspace.getDesignDirectoryHandle(designId);
  const sidecar = await design.getDirectoryHandle('fig-source');
  const blobs = await sidecar.getDirectoryHandle('blobs');
  assert.deepEqual([...blobs.children.keys()], [`${expectedHash}.fig`]);
  assert.ok(sidecar.children.has('archive.json'));
  assert.equal(design.children.has('fig-source'), true, 'sidecar lives beside serialized design data');
});

test('retries are idempotent while a different archive cannot replace the retained original', async () => {
  const { workspace, designId } = await fixture();
  const original = bytes(1, 2, 3, 4);
  const first = await saveFigSourceArchive(workspace, designId, original, { ...options, now: 10 });
  const retry = await saveFigSourceArchive(workspace, designId, original, { ...options, now: 20 });
  assert.equal(retry.contentHash, first.contentHash);
  assert.equal(retry.createdAt, 10);
  assert.equal(retry.deduplicated, true);
  await assert.rejects(saveFigSourceArchive(workspace, designId, bytes(4, 3, 2, 1), options),
    error => error.code === 'FIG_SOURCE_ARCHIVE_CONFLICT');
  assert.deepEqual((await readFigSourceArchive(workspace, designId, options)).bytes, original);
});

test('archive reads reject tampered bytes, incorrect size, and invalid metadata', async () => {
  const { workspace, designId } = await fixture();
  const saved = await saveFigSourceArchive(workspace, designId, bytes(0, 1, 2, 3), options);
  const design = await workspace.getDesignDirectoryHandle(designId);
  const sidecar = await design.getDirectoryHandle('fig-source');
  const blobs = await sidecar.getDirectoryHandle('blobs');
  const blob = await blobs.getFileHandle(`${saved.contentHash}.fig`);
  blob.bytes[0] ^= 0xff;
  await assert.rejects(readFigSourceArchive(workspace, designId, options), error => error.code === 'FIG_SOURCE_ARCHIVE_CORRUPT');
  blob.bytes = bytes(0, 1, 2, 3);

  const metadata = await sidecar.getFileHandle('archive.json');
  metadata.bytes = new TextEncoder().encode(JSON.stringify({
    formatVersion: 1, designId, contentHash: saved.contentHash, byteLength: 3, createdAt: 0
  }));
  await assert.rejects(readFigSourceArchive(workspace, designId, options), error => error.code === 'FIG_SOURCE_ARCHIVE_CORRUPT');
  metadata.bytes = new TextEncoder().encode(JSON.stringify({
    formatVersion: 1, designId, contentHash: '../unsafe', byteLength: 4, createdAt: 0
  }));
  await assert.rejects(readFigSourceArchive(workspace, designId, options), error => error.code === 'FIG_SOURCE_ARCHIVE_METADATA_INVALID');
});

test('an indexed archive with a missing blob or incomplete directory layout fails closed', async () => {
  const { workspace, designId } = await fixture();
  const saved = await saveFigSourceArchive(workspace, designId, bytes(6, 5, 4, 3), options);
  const design = await workspace.getDesignDirectoryHandle(designId);
  const sidecar = await design.getDirectoryHandle('fig-source');
  const blobs = await sidecar.getDirectoryHandle('blobs');
  await blobs.removeEntry(`${saved.contentHash}.fig`);
  await assert.rejects(readFigSourceArchive(workspace, designId, options), error => error.code === 'FIG_SOURCE_ARCHIVE_CORRUPT');
  await sidecar.removeEntry('blobs', { recursive: true });
  await assert.rejects(readFigSourceArchive(workspace, designId, options), error => error.code === 'FIG_SOURCE_ARCHIVE_LAYOUT_INVALID');
});

test('archive and metadata size limits are enforced before unsafe reads or writes', async () => {
  const { workspace, designId } = await fixture();
  await assert.rejects(saveFigSourceArchive(workspace, designId, new Uint8Array(MAX_FIG_SOURCE_ARCHIVE_BYTES + 1), options),
    error => error.code === 'FIG_SOURCE_ARCHIVE_TOO_LARGE');
  await assert.rejects(saveFigSourceArchive(workspace, designId, new Uint8Array(), options),
    error => error.code === 'FIG_SOURCE_ARCHIVE_TOO_LARGE');
  await assert.rejects(saveFigSourceArchive(workspace, designId, { name: '../../escape.fig' }, options),
    error => error.code === 'INVALID_FIG_SOURCE_ARCHIVE');
});

test('write permission, design locks, and deletion markers protect archive mutations', async () => {
  const { root, workspace, designId } = await fixture();
  root.permission = 'denied';
  await assert.rejects(saveFigSourceArchive(workspace, designId, bytes(1), options), error => error.code === 'PERMISSION_REQUIRED');
  await assert.rejects(deleteFigSourceArchive(workspace, designId, options), error => error.code === 'PERMISSION_REQUIRED');
  root.permission = 'granted';

  const marker = await workspace.designsDirectory.getFileHandle(`${designId}.deleted.json`, { create: true });
  const writable = await marker.createWritable();
  await writable.write(JSON.stringify({ formatVersion: 1, designId, deletedAt: 1 }));
  await writable.close();
  await assert.rejects(saveFigSourceArchive(workspace, designId, bytes(1), options), error => error.code === 'DESIGN_DELETED');
  await assert.rejects(deleteFigSourceArchive(workspace, designId, options), error => error.code === 'DESIGN_DELETED');
});

test('write and close failures never publish metadata for an incomplete archive', async () => {
  const { root, workspace, designId } = await fixture();
  root.failWriteFor = `${Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes(1, 2))).toString('hex')}.fig`;
  await assert.rejects(saveFigSourceArchive(workspace, designId, bytes(1, 2), options), error => error.code === 'FIG_SOURCE_ARCHIVE_WRITE_FAILED');
  root.failWriteFor = null;
  const design = await workspace.getDesignDirectoryHandle(designId);
  const sidecar = await design.getDirectoryHandle('fig-source');
  assert.equal(sidecar.children.has('archive.json'), false);

  root.corruptOnCloseFor = `${Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes(3, 4))).toString('hex')}.fig`;
  await assert.rejects(saveFigSourceArchive(workspace, designId, bytes(3, 4), options), error => error.code === 'FIG_SOURCE_ARCHIVE_VERIFY_FAILED');
  assert.equal(sidecar.children.has('archive.json'), false);

  root.failCloseFor = 'archive.json';
  await assert.rejects(saveFigSourceArchive(workspace, designId, bytes(5, 6), options), error => error.code === 'FIG_SOURCE_ARCHIVE_METADATA_WRITE_FAILED');
  assert.equal(sidecar.children.has('archive.json'), false, 'a failed metadata commit cannot leave an unreadable index');
  const recovered = await saveFigSourceArchive(workspace, designId, bytes(5, 6), options);
  assert.equal(recovered.deduplicated, false);
  assert.deepEqual((await readFigSourceArchive(workspace, designId, options)).bytes, bytes(5, 6));
});

test('explicit deletion removes only the reserved archive folder and is idempotent', async () => {
  const { workspace, designId } = await fixture();
  const design = await workspace.getDesignDirectoryHandle(designId);
  await saveFigSourceArchive(workspace, designId, bytes(7, 8, 9), options);
  assert.equal(await deleteFigSourceArchive(workspace, designId, options), true);
  assert.equal(design.children.has('fig-source'), false);
  assert.equal(await readFigSourceArchive(workspace, designId, options), null);
  assert.equal(await deleteFigSourceArchive(workspace, designId, options), false);
});
