import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { createDocument } from '../src/model.js';
import { createWorkspace } from '../src/workspace/workspace-store.js';
import { commitDesign, createDesign, deleteDesign, openDesign, MAX_DESIGN_COMMITS, MAX_DESIGN_HISTORY_BYTES,
  MAX_DESIGN_SNAPSHOT_BYTES } from '../src/workspace/design-store.js';

function notFound() { const error = new Error('Not found'); error.name = 'NotFoundError'; return error; }
class FileHandle {
  constructor(name, parent) { this.kind = 'file'; this.name = name; this.parent = parent; this.contents = ''; }
  async getFile() {
    const contents = this.contents;
    return { size: this.reportedSize ?? new TextEncoder().encode(contents).byteLength, text: async () => { this.textCalls = (this.textCalls || 0) + 1; return contents; } };
  }
  async createWritable() {
    let contents = '';
    return {
      write: async value => { contents = String(value); },
      close: async () => {
        if (this.parent.root.failCloseFor === this.name) {
          this.parent.root.failCloseFor = null;
          throw new Error(`injected close failure for ${this.name}`);
        }
        this.contents = contents;
      },
      abort: async () => {}
    };
  }
}
class DirectoryHandle {
  constructor(name = 'root', parent = null, root = null) {
    this.kind = 'directory'; this.name = name; this.parent = parent; this.root = root || this; this.children = new Map(); this.permission = 'granted';
  }
  async queryPermission() { return this.permission; }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (name === '.' || name === '..' || name.includes('/')) throw new TypeError('unsafe path');
    const item = this.children.get(name);
    if (item) { if (item.kind !== 'directory') throw new TypeError('not a directory'); return item; }
    if (!create) throw notFound();
    const directory = new DirectoryHandle(name, this, this.root); this.children.set(name, directory); return directory;
  }
  async getFileHandle(name, { create = false } = {}) {
    if (name === '.' || name === '..' || name.includes('/')) throw new TypeError('unsafe path');
    const item = this.children.get(name);
    if (item) { if (item.kind !== 'file') throw new TypeError('not a file'); return item; }
    if (!create) throw notFound();
    const file = new FileHandle(name, this); this.children.set(name, file); return file;
  }
  async *values() { this.root.directoryScans = (this.root.directoryScans || 0) + 1; yield* this.children.values(); }
  async removeEntry(name, { recursive = false } = {}) {
    if (this.root.failRemoveFor === name) {
      this.root.failRemoveFor = null;
      throw new Error(`injected remove failure for ${name}`);
    }
    const entry = this.children.get(name);
    if (!entry) throw notFound();
    if (entry.kind === 'directory' && !recursive && entry.children.size) throw new Error('directory not empty');
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
function fixture() {
  const root = new DirectoryHandle();
  return createWorkspace(root, { crypto: webcrypto, locks }).then(workspace => ({ root, workspace }));
}
function cloneDoc(doc) { return structuredClone(doc); }
function setName(doc, name) { doc.name = name; return doc; }
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
async function sha256(text) {
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

test('safe design/page identity survives validated close-and-reopen snapshot without ID rewriting', async () => {
  const { workspace } = await fixture();
  const source = createDocument();
  const created = await createDesign(workspace, source, { crypto: webcrypto, locks, now: 100 });
  assert.equal(created.designId, source.id);
  assert.equal(created.pageIds.length, 1);
  assert.equal(created.pageIds[0], source.pages[0].id);
  assert.equal(created.document.id, created.designId);
  assert.equal(created.document.activePageId, created.pageIds[0]);
  assert.equal(created.document.pages[0].id, created.pageIds[0]);
  assert.equal(created.document.id, source.id);

  const reopened = await openDesign(workspace, created.designId, { crypto: webcrypto, locks });
  assert.equal(reopened.head.commitHash, created.head.commitHash);
  assert.deepEqual(reopened.document, created.document);
});

test('stale expected head cannot append or advance the recoverable head', async () => {
  const { workspace } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const next = await commitDesign(workspace, created.designId, setName(cloneDoc(created.document), 'second'), {
    expectedHead: created.head, pageId: created.pageIds[0], crypto: webcrypto, locks
  });
  await assert.rejects(commitDesign(workspace, created.designId, setName(cloneDoc(created.document), 'stale'), {
    expectedHead: created.head, pageId: created.pageIds[0], crypto: webcrypto, locks
  }), error => error.code === 'HEAD_CONFLICT');
  const reopened = await openDesign(workspace, created.designId, { crypto: webcrypto, locks });
  assert.deepEqual(reopened.head, next.head);
  assert.equal(reopened.document.name, 'second');
});

test('modified immutable snapshot is detected instead of being opened', async () => {
  const { workspace } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const design = await workspace.getDesignDirectoryHandle(created.designId);
  const commits = await (await design.getDirectoryHandle('.tiny-image-star')).getDirectoryHandle('commits');
  const file = await commits.getFileHandle(`${created.head.commitHash}.json`);
  file.contents = file.contents.replace('Untitled', 'Tampered');
  await assert.rejects(openDesign(workspace, created.designId, { crypto: webcrypto, locks }), error => error.code === 'COMMIT_CORRUPT');
});

test('a crash after durable commit but before HEAD update is recovered by scanning the unique chain', async () => {
  const { workspace, root } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  root.failCloseFor = 'HEAD.json';
  await assert.rejects(commitDesign(workspace, created.designId, setName(cloneDoc(created.document), 'durable'), {
    expectedHead: created.head, pageId: created.pageIds[0], crypto: webcrypto, locks
  }), error => error.code === 'HEAD_WRITE_FAILED');
  const recovered = await openDesign(workspace, created.designId, { crypto: webcrypto, locks });
  assert.equal(recovered.head.sequence, created.head.sequence + 1);
  assert.equal(recovered.document.name, 'durable');
});

test('a write that fails before a commit is closed is never acknowledged and old head remains usable', async () => {
  const { workspace, root } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  root.failCloseFor = `${'f'.repeat(64)}.json`;
  // Inject at the actual commit path after discovering its deterministic name by failing every non-HEAD close.
  const original = DirectoryHandle.prototype.getFileHandle;
  DirectoryHandle.prototype.getFileHandle = async function(name, options) {
    if (name.endsWith('.json') && name !== 'HEAD.json' && this.name === 'commits') root.failCloseFor = name;
    return original.call(this, name, options);
  };
  try {
    await assert.rejects(commitDesign(workspace, created.designId, setName(cloneDoc(created.document), 'not durable'), {
      expectedHead: created.head, pageId: created.pageIds[0], crypto: webcrypto, locks
    }), error => error.code === 'COMMIT_WRITE_FAILED');
  } finally { DirectoryHandle.prototype.getFileHandle = original; }
  const recovered = await openDesign(workspace, created.designId, { crypto: webcrypto, locks });
  assert.equal(recovered.head.commitHash, created.head.commitHash);
  assert.notEqual(recovered.document.name, 'not durable');
});

test('malformed IDs and page traversal are rejected before any path lookup', async () => {
  const { workspace } = await fixture();
  for (const id of ['../escape', 'a/b', '.', '..', '']) {
    await assert.rejects(openDesign(workspace, id, { crypto: webcrypto, locks }), error => error.code === 'INVALID_ID');
  }
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  await assert.rejects(commitDesign(workspace, created.designId, created.document, {
    expectedHead: created.head, pageId: '../escape', crypto: webcrypto, locks
  }), error => error.code === 'INVALID_ID');
});

test('a corrupt HEAD index is rebuilt only from a valid unique immutable commit chain', async () => {
  const { workspace } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const design = await workspace.getDesignDirectoryHandle(created.designId);
  const metadata = await design.getDirectoryHandle('.tiny-image-star');
  (await metadata.getFileHandle('HEAD.json')).contents = '{broken';
  const reopened = await openDesign(workspace, created.designId, { crypto: webcrypto, locks });
  assert.equal(reopened.head.commitHash, created.head.commitHash);
});

test('multiple valid tips fail closed instead of choosing a branch', async () => {
  const { workspace } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const design = await workspace.getDesignDirectoryHandle(created.designId);
  const commits = await (await design.getDirectoryHandle('.tiny-image-star')).getDirectoryHandle('commits');
  for (const name of ['unindexed branch A', 'unindexed branch B']) {
    const body = {
      formatVersion: 1,
      designId: created.designId,
      sequence: 2,
      previousHash: created.head.commitHash,
      pageId: created.pageIds[0],
      snapshot: JSON.stringify(setName(cloneDoc(created.document), name))
    };
    const hash = await sha256(canonical(body));
    const alternate = await commits.getFileHandle(`${hash}.json`, { create: true });
    const writable = await alternate.createWritable();
    await writable.write(canonical({ ...body, hash }));
    await writable.close();
  }
  await assert.rejects(openDesign(workspace, created.designId, { crypto: webcrypto, locks }), error => error.code === 'RECOVERY_AMBIGUOUS');
});

test('unsafe caller IDs are rejected rather than normalized into another path', async () => {
  const { workspace } = await fixture();
  const source = createDocument();
  source.id = '../outside';
  await assert.rejects(createDesign(workspace, source, { crypto: webcrypto, locks }), error => error.code === 'INVALID_ID');
  const badPage = createDocument();
  badPage.pages[0].id = 'pages/escape';
  badPage.activePageId = 'pages/escape';
  await assert.rejects(createDesign(workspace, badPage, { crypto: webcrypto, locks }), error => error.code === 'INVALID_ID');
});

test('deleting a folder design removes its history and assets without changing other designs', async () => {
  const { workspace, root } = await fixture();
  const first = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const second = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const firstFolder = await workspace.getDesignDirectoryHandle(first.designId);
  await firstFolder.getDirectoryHandle('assets', { create: true });
  await firstFolder.getDirectoryHandle('fonts', { create: true });

  assert.deepEqual(await deleteDesign(workspace, first.designId, { locks }), { designId: first.designId, deleted: true });
  assert.equal(root.children.get('designs').children.has(first.designId), false);
  assert.equal(root.children.get('designs').children.has(`${first.designId}.deleted.json`), true);
  await assert.rejects(openDesign(workspace, first.designId, { crypto: webcrypto, locks }), error => error.code === 'DESIGN_DELETED');
  await assert.rejects(createDesign(workspace, first.document, { crypto: webcrypto, locks }), error => error.code === 'DESIGN_DELETED');
  assert.deepEqual(await deleteDesign(workspace, first.designId, { locks }), { designId: first.designId, deleted: true });
  assert.equal((await openDesign(workspace, second.designId, { crypto: webcrypto, locks })).document.id, second.designId);
});

test('interrupted folder deletion stays fenced from stale autosaves and can be retried', async () => {
  const { workspace, root } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  root.failRemoveFor = created.designId;
  await assert.rejects(deleteDesign(workspace, created.designId, { locks }), error => error.code === 'DESIGN_DELETE_PENDING');
  assert.equal(root.children.get('designs').children.has(`${created.designId}.deleted.json`), true);
  await assert.rejects(openDesign(workspace, created.designId, { crypto: webcrypto, locks }), error => error.code === 'DESIGN_DELETED');
  await assert.rejects(createDesign(workspace, created.document, { crypto: webcrypto, locks }), error => error.code === 'DESIGN_DELETED');
  assert.deepEqual(await deleteDesign(workspace, created.designId, { locks }), { designId: created.designId, deleted: true });
  assert.equal(root.children.get('designs').children.has(created.designId), false);
});

test('design deletion requires current folder permission and refuses unowned folders', async () => {
  const { workspace } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const designs = workspace.designsDirectory;
  const owned = await workspace.getDesignDirectoryHandle(created.designId);
  const marker = await owned.getFileHandle('CREATE.json');
  marker.contents = '{broken';
  await assert.rejects(deleteDesign(workspace, created.designId, { locks }), error => error.code === 'CREATE_MARKER_INVALID');
  assert.equal(designs.children.has(created.designId), true, 'an unverified folder must remain untouched');

  marker.contents = JSON.stringify({
    formatVersion: 1, designId: created.designId, createdAt: 1, pageIds: created.pageIds,
    initialCommitHash: '0'.repeat(64)
  });
  workspace.directoryHandle.permission = 'prompt';
  await assert.rejects(deleteDesign(workspace, created.designId, { locks }), error => error.code === 'PERMISSION_REQUIRED');
  assert.equal(designs.children.has(created.designId), true, 'permission denial must not remove the design');
});

test('appending checks history file metadata without reading prior commit contents', async () => {
  const { workspace, root } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const design = await workspace.getDesignDirectoryHandle(created.designId);
  const commits = await (await design.getDirectoryHandle('.tiny-image-star')).getDirectoryHandle('commits');
  const scansBefore = root.directoryScans || 0;
  const first = await commitDesign(workspace, created.designId, setName(cloneDoc(created.document), 'one'), {
    expectedHead: created.head, pageId: created.pageIds[0], crypto: webcrypto, locks
  });
  const scansAfterFirst = root.directoryScans || 0;
  const second = await commitDesign(workspace, created.designId, setName(cloneDoc(first.document), 'two'), {
    expectedHead: first.head, pageId: created.pageIds[0], crypto: webcrypto, locks
  });
  assert.equal(scansAfterFirst, scansBefore + 1);
  assert.equal(root.directoryScans || 0, scansAfterFirst + 1);
  assert.equal(second.head.sequence, 3);
  assert.ok(commits.children.size >= 3);
});

test('aggregate history byte limit is checked before recovery reads commit contents', async () => {
  const { workspace } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const design = await workspace.getDesignDirectoryHandle(created.designId);
  const commits = await (await design.getDirectoryHandle('.tiny-image-star')).getDirectoryHandle('commits');
  for (let index = 0; index < 33; index += 1) {
    const name = `${index.toString(16).padStart(64, '0')}.json`;
    const handle = await commits.getFileHandle(name, { create: true });
    handle.reportedSize = 16 * 1024 * 1024;
    handle.contents = '{}';
  }
  await assert.rejects(openDesign(workspace, created.designId, { crypto: webcrypto, locks }), error => error.code === 'RECOVERY_LIMIT');
});

test('commit preflight rejects a history that would exceed the aggregate byte limit before writes', async () => {
  const { workspace } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const design = await workspace.getDesignDirectoryHandle(created.designId);
  const metadata = await design.getDirectoryHandle('.tiny-image-star');
  const commits = await metadata.getDirectoryHandle('commits');
  const head = (await metadata.getFileHandle('HEAD.json')).contents;
  const existingCommit = await commits.getFileHandle(`${created.head.commitHash}.json`);
  const placeholders = [];
  for (let index = 0; index < 31; index += 1) {
    const name = `${(index + 10_000).toString(16).padStart(64, '0')}.json`;
    const placeholder = await commits.getFileHandle(name, { create: true });
    placeholder.reportedSize = MAX_DESIGN_SNAPSHOT_BYTES;
    placeholders.push(name);
  }
  existingCommit.reportedSize = MAX_DESIGN_HISTORY_BYTES - placeholders.length * MAX_DESIGN_SNAPSHOT_BYTES;

  await assert.rejects(commitDesign(workspace, created.designId, setName(cloneDoc(created.document), 'too large'), {
    expectedHead: created.head, pageId: created.pageIds[0], crypto: webcrypto, locks
  }), error => error.code === 'DESIGN_HISTORY_LIMIT');

  assert.equal((await metadata.getFileHandle('HEAD.json')).contents, head);
  assert.equal(metadata.children.has('PENDING.json'), false);
  assert.equal(commits.children.size, placeholders.length + 1);
  for (const name of placeholders) await commits.removeEntry(name);
  existingCommit.reportedSize = undefined;
  const reopened = await openDesign(workspace, created.designId, { crypto: webcrypto, locks });
  assert.deepEqual(reopened.head, created.head);
});

test('commit preflight rejects the commit-count boundary before writes and leaves HEAD openable', async () => {
  const { workspace } = await fixture();
  const created = await createDesign(workspace, createDocument(), { crypto: webcrypto, locks });
  const design = await workspace.getDesignDirectoryHandle(created.designId);
  const metadata = await design.getDirectoryHandle('.tiny-image-star');
  const commits = await metadata.getDirectoryHandle('commits');
  const head = (await metadata.getFileHandle('HEAD.json')).contents;
  const placeholders = [];
  for (let index = 0; index < MAX_DESIGN_COMMITS - 1; index += 1) {
    const name = `${(index + 1).toString(16).padStart(64, '0')}.json`;
    if (name === `${created.head.commitHash}.json`) continue;
    await commits.getFileHandle(name, { create: true });
    placeholders.push(name);
  }

  await assert.rejects(commitDesign(workspace, created.designId, setName(cloneDoc(created.document), 'too many'), {
    expectedHead: created.head, pageId: created.pageIds[0], crypto: webcrypto, locks
  }), error => error.code === 'DESIGN_HISTORY_LIMIT');

  assert.equal((await metadata.getFileHandle('HEAD.json')).contents, head);
  assert.equal(metadata.children.has('PENDING.json'), false);
  assert.equal(commits.children.size, MAX_DESIGN_COMMITS);
  for (const name of placeholders) await commits.removeEntry(name);
  const reopened = await openDesign(workspace, created.designId, { crypto: webcrypto, locks });
  assert.deepEqual(reopened.head, created.head);
});

test('interrupted initial creation with its ownership marker can be retried safely', async () => {
  const { workspace, root } = await fixture();
  const source = createDocument();
  root.failCloseFor = 'HEAD.json';
  await assert.rejects(createDesign(workspace, source, { crypto: webcrypto, locks, now: 100 }), error => error.code === 'HEAD_WRITE_FAILED');
  const created = await createDesign(workspace, source, { crypto: webcrypto, locks, now: 200 });
  assert.equal(created.designId, source.id);
  assert.equal(created.head.sequence, 1);
  assert.deepEqual((await openDesign(workspace, created.designId, { crypto: webcrypto, locks })).head, created.head);
});

test('oversized immutable-file collision is rejected before allocating its contents', async () => {
  const { workspace, root } = await fixture();
  const source = createDocument();
  root.failCloseFor = 'HEAD.json';
  await assert.rejects(createDesign(workspace, source, { crypto: webcrypto, locks, now: 100 }), error => error.code === 'HEAD_WRITE_FAILED');
  const design = await workspace.getDesignDirectoryHandle(source.id);
  const metadata = await design.getDirectoryHandle('.tiny-image-star');
  const identity = await metadata.getFileHandle('design.json');
  identity.reportedSize = 1024 * 1024;
  const readsBeforeRetry = identity.textCalls || 0;
  await assert.rejects(createDesign(workspace, source, { crypto: webcrypto, locks, now: 200 }), error => error.code === 'IMMUTABLE_RECORD_TOO_LARGE');
  assert.equal(identity.textCalls || 0, readsBeforeRetry);
});
