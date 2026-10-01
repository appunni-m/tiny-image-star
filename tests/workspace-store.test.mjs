import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { createDocument } from '../src/model.js';
import { createDesign } from '../src/workspace/design-store.js';
import {
  createWorkspace,
  listWorkspaceDesignIds,
  openWorkspace,
  pickWorkspaceDirectory,
  requestWorkspacePermission,
  WorkspaceStoreError,
  WORKSPACE_DESIGNS_DIRECTORY,
  WORKSPACE_METADATA_DIRECTORY,
  WORKSPACE_MANIFEST_FILE,
  WORKSPACE_TRANSACTIONS_DIRECTORY
} from '../src/workspace/workspace-store.js';

function notFound() {
  const error = new Error('Not found');
  error.name = 'NotFoundError';
  return error;
}

class MemoryFileHandle {
  constructor(name, parent) { this.kind = 'file'; this.name = name; this.parent = parent; this.contents = ''; }
  async getFile() {
    const contents = this.contents;
    return { size: new TextEncoder().encode(contents).byteLength, text: async () => contents };
  }
  async createWritable() {
    let contents = '';
    return {
      write: async value => { contents = typeof value === 'string' ? value : String(value); },
      close: async () => { this.contents = contents; },
      abort: async () => {}
    };
  }
}

class MemoryDirectoryHandle {
  constructor(name = 'workspace', parent = null) {
    this.kind = 'directory';
    this.name = name;
    this.parent = parent;
    this.children = new Map();
    this.permission = 'granted';
    this.requestedNames = [];
  }
  async queryPermission({ mode } = {}) { assert.equal(mode, 'readwrite'); return this.permission; }
  async requestPermission({ mode } = {}) { assert.equal(mode, 'readwrite'); this.permission = 'granted'; return this.permission; }
  async getDirectoryHandle(name, { create = false } = {}) {
    this.requestedNames.push(name);
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'directory') throw new TypeError('A file already uses this name.');
      return existing;
    }
    if (!create) throw notFound();
    const child = new MemoryDirectoryHandle(name, this);
    this.children.set(name, child);
    return child;
  }
  async getFileHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'file') throw new TypeError('A directory already uses this name.');
      return existing;
    }
    if (!create) throw notFound();
    const child = new MemoryFileHandle(name, this);
    this.children.set(name, child);
    return child;
  }
  async removeEntry(name, { recursive = false } = {}) {
    const existing = this.children.get(name);
    if (!existing) throw notFound();
    if (existing.kind === 'directory' && existing.children.size && !recursive) throw new Error('Directory is not empty.');
    this.children.delete(name);
  }
  async *entries() { yield* this.children.entries(); }
}

class MemoryLockManager {
  constructor() { this.queues = new Map(); }
  request(name, { mode } = {}, callback) {
    assert.equal(mode, 'exclusive');
    const previous = this.queues.get(name) ?? Promise.resolve();
    const result = previous.then(callback, callback);
    this.queues.set(name, result.then(() => undefined, () => undefined));
    return result;
  }
}

const locks = new MemoryLockManager();

async function manifestHandle(root) {
  return root.getDirectoryHandle(WORKSPACE_METADATA_DIRECTORY).then(metadata => metadata.getFileHandle(WORKSPACE_MANIFEST_FILE));
}

test('new workspace creates a versioned manifest and both required roots without replacing data', async () => {
  const root = new MemoryDirectoryHandle();
  const created = await createWorkspace(root, { crypto: webcrypto, now: 1234, locks });
  assert.match(created.workspaceId, /^[a-f0-9]{36}$/);
  assert.equal(created.manifest.formatVersion, 1);
  assert.equal(created.manifest.createdAt, 1234);
  assert.equal(created.manifest.updatedAt, 1234);
  assert.ok(root.children.has(WORKSPACE_DESIGNS_DIRECTORY));
  assert.ok(created.metadataDirectory.children.has(WORKSPACE_TRANSACTIONS_DIRECTORY));

  const before = await (await (await manifestHandle(root)).getFile()).text();
  await assert.rejects(createWorkspace(root, { crypto: webcrypto, now: 5678, locks }), error => error.code === 'WORKSPACE_EXISTS');
  assert.equal(await (await (await manifestHandle(root)).getFile()).text(), before, 'existing workspace metadata must remain byte-identical');

  const reopened = await openWorkspace(root);
  assert.equal(reopened.workspaceId, created.workspaceId);
  assert.equal(reopened.manifest.updatedAt, 1234);
});

test('reopening rechecks write permission and an explicit user action can restore it', async () => {
  const root = new MemoryDirectoryHandle();
  const created = await createWorkspace(root, { crypto: webcrypto, now: 10, locks });
  root.permission = 'prompt';
  await assert.rejects(openWorkspace(root), error => error.code === 'PERMISSION_REQUIRED');
  assert.equal(await requestWorkspacePermission(root), 'granted');
  assert.equal((await openWorkspace(root)).workspaceId, created.workspaceId);
});

test('missing picker and permission APIs fail with explicit capability errors', async () => {
  await assert.rejects(pickWorkspaceDirectory(null), error => error.code === 'FOLDER_PICKER_UNSUPPORTED');
  const root = new MemoryDirectoryHandle();
  root.queryPermission = undefined;
  root.requestPermission = undefined;
  await assert.rejects(createWorkspace(root), error => error.code === 'UNSUPPORTED_PERMISSION_API');
  await assert.rejects(requestWorkspacePermission(root), error => error.code === 'UNSUPPORTED_PERMISSION_API');
});

test('malformed, oversized, and unsupported manifests never reopen as a workspace', async () => {
  const root = new MemoryDirectoryHandle();
  await createWorkspace(root, { crypto: webcrypto, now: 20, locks });
  const handle = await manifestHandle(root);

  handle.contents = '{broken';
  await assert.rejects(openWorkspace(root), error => error.code === 'MANIFEST_INVALID');

  handle.contents = JSON.stringify({ formatVersion: 99, appId: 'tiny-image-star', workspaceId: 'valid', createdAt: 1, updatedAt: 1 });
  await assert.rejects(openWorkspace(root), error => error.code === 'WORKSPACE_VERSION_UNSUPPORTED');

  handle.contents = 'x'.repeat(20 * 1024);
  await assert.rejects(openWorkspace(root), error => error.code === 'MANIFEST_TOO_LARGE');
});

test('design lookup rejects traversal and malformed IDs before touching the folder API', async () => {
  const root = new MemoryDirectoryHandle();
  const workspace = await createWorkspace(root, { crypto: webcrypto, now: 30, locks });
  const requestedBefore = workspace.designsDirectory.requestedNames.length;
  for (const designId of ['../escape', 'a/b', '.', '']) {
    await assert.rejects(workspace.getDesignDirectoryHandle(designId), error => error.code === 'INVALID_ID');
  }
  assert.equal(workspace.designsDirectory.requestedNames.length, requestedBefore);
  await assert.rejects(workspace.getDesignDirectoryHandle('well-formed'), error => error.code === 'DESIGN_NOT_FOUND');

  const design = await workspace.designsDirectory.getDirectoryHandle('design-1', { create: true });
  const pages = await design.getDirectoryHandle('pages', { create: true });
  await pages.getDirectoryHandle('page-1', { create: true });
  assert.equal((await workspace.getPageDirectoryHandle('design-1', 'page-1')).name, 'page-1');
  const beforeUnsafePageLookups = workspace.designsDirectory.requestedNames.length;
  await assert.rejects(workspace.getPageDirectoryHandle('design-1', '../escape'), error => error.code === 'INVALID_ID');
  assert.equal(workspace.designsDirectory.requestedNames.length, beforeUnsafePageLookups);
});

test('workspace design listing includes only folders with a valid creation marker', async () => {
  const root = new MemoryDirectoryHandle();
  const workspace = await createWorkspace(root, { crypto: webcrypto, now: 31, locks });
  assert.deepEqual(await listWorkspaceDesignIds(workspace), []);
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks, now: 32 });
  await workspace.designsDirectory.getDirectoryHandle('stray', { create: true });
  const incomplete = await workspace.designsDirectory.getDirectoryHandle('incomplete', { create: true });
  await incomplete.getFileHandle('CREATE.json', { create: true }).then(async handle => {
    const writable = await handle.createWritable(); await writable.write('{broken'); await writable.close();
  });
  assert.deepEqual(await listWorkspaceDesignIds(workspace), [created.designId]);
});

test('an incomplete workspace is reported without silently recreating missing folders', async () => {
  const root = new MemoryDirectoryHandle();
  await createWorkspace(root, { crypto: webcrypto, now: 40, locks });
  await root.removeEntry(WORKSPACE_DESIGNS_DIRECTORY, { recursive: true });
  await assert.rejects(openWorkspace(root), error => error instanceof WorkspaceStoreError && error.code === 'WORKSPACE_INCOMPLETE');
  assert.equal(root.children.has(WORKSPACE_DESIGNS_DIRECTORY), false);
});

test('concurrent tab initialization is serialized and only one workspace identity wins', async () => {
  const root = new MemoryDirectoryHandle();
  const simultaneous = await Promise.allSettled([
    createWorkspace(root, { crypto: webcrypto, now: 50, locks }),
    createWorkspace(root, { crypto: webcrypto, now: 51, locks })
  ]);
  const winners = simultaneous.filter(result => result.status === 'fulfilled');
  const losers = simultaneous.filter(result => result.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.code, 'WORKSPACE_EXISTS');
  assert.equal((await openWorkspace(root)).workspaceId, winners[0].value.workspaceId);
});

test('workspace creation fails closed when cross-tab locking is unavailable', async () => {
  const root = new MemoryDirectoryHandle();
  await assert.rejects(createWorkspace(root, { crypto: webcrypto, locks: null }), error => error.code === 'CROSS_TAB_LOCK_UNSUPPORTED');
  assert.equal(root.children.has(WORKSPACE_METADATA_DIRECTORY), false);
});
