import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import {
  consumeAnswerSessionOnce,
  createShareGrant,
  loadShareGrant,
  revokeShareGrant,
  ShareStoreError
} from '../src/collaboration/share-store.js';
import { decodeStableDesignInvite } from '../src/collaboration/session-capsules.js';

function notFound() { const error = new Error('Not found'); error.name = 'NotFoundError'; return error; }

class MemoryFile {
  constructor(name, parent) { this.kind = 'file'; this.name = name; this.parent = parent; this.contents = ''; }
  async getFile() {
    const contents = this.contents;
    return { size: new TextEncoder().encode(contents).byteLength, text: async () => contents };
  }
  async createWritable() {
    let staged = '';
    return {
      write: async value => { staged = String(value); },
      close: async () => {
        if (this.parent.root.failCloseFor === this.name) {
          this.parent.root.failCloseFor = null;
          throw new Error('injected file close failure');
        }
        this.contents = staged;
      },
      abort: async () => {}
    };
  }
}

class MemoryDirectory {
  constructor(name = 'root', parent = null, root = null) {
    this.kind = 'directory'; this.name = name; this.parent = parent; this.root = root || this; this.children = new Map();
  }
  async queryPermission({ mode } = {}) { assert.equal(mode, 'readwrite'); return 'granted'; }
  async getDirectoryHandle(name, { create = false } = {}) {
    const current = this.children.get(name);
    if (current) { if (current.kind !== 'directory') throw new TypeError('wrong entry kind'); return current; }
    if (!create) throw notFound();
    const next = new MemoryDirectory(name, this, this.root); this.children.set(name, next); return next;
  }
  async getFileHandle(name, { create = false } = {}) {
    const current = this.children.get(name);
    if (current) { if (current.kind !== 'file') throw new TypeError('wrong entry kind'); return current; }
    if (!create) throw notFound();
    const next = new MemoryFile(name, this); this.children.set(name, next); return next;
  }
  async *values() { yield* this.children.values(); }
}

class MemoryLocks {
  constructor() { this.tails = new Map(); }
  request(name, { mode } = {}, callback) {
    assert.equal(mode, 'exclusive');
    const previous = this.tails.get(name) || Promise.resolve();
    const result = previous.then(callback, callback);
    this.tails.set(name, result.then(() => undefined, () => undefined));
    return result;
  }
}

async function fixture() {
  const root = new MemoryDirectory();
  const designs = await root.getDirectoryHandle('designs', { create: true });
  const design = await designs.getDirectoryHandle('design-1', { create: true });
  await design.getDirectoryHandle('.tiny-image-star', { create: true });
  const locks = new MemoryLocks();
  return {
    root,
    design,
    locks,
    workspace: {
    workspaceId: 'workspace-1',
      directoryHandle: root,
      async getDesignDirectoryHandle(id) {
        if (id !== 'design-1') throw notFound();
        return design;
      }
    }
  };
}

const common = { crypto: webcrypto };

test('share grant round-trips a stable invite and a matching persistent design signing key', async () => {
  const { workspace, locks } = await fixture();
  const grant = await createShareGrant(workspace, 'design-1', { ...common, locks, now: 100 });
  const decoded = decodeStableDesignInvite(grant.encodedInvite);
  assert.deepEqual(decoded, grant.invite);
  assert.equal(grant.identityPrivateKey.type, 'private');
  assert.equal(grant.createdAt, 100);
  assert.match(grant.shareId, /^[A-Za-z0-9_-]+$/);

  const loaded = await loadShareGrant(workspace, 'design-1', { ...common, locks });
  assert.equal(loaded.shareId, grant.shareId);
  assert.equal(loaded.encodedInvite, grant.encodedInvite);
  assert.equal(loaded.identityPrivateKey.type, 'private');
  await assert.rejects(createShareGrant(workspace, 'design-1', { ...common, locks }), error => error.code === 'SHARE_ALREADY_ACTIVE');
});

test('a new design without a sharing folder is treated as unshared and can start sharing', async () => {
  const { workspace, locks } = await fixture();
  assert.equal(await loadShareGrant(workspace, 'design-1', { ...common, locks }), null);
  assert.equal(await revokeShareGrant(workspace, 'design-1', { locks }), false);

  const created = await createShareGrant(workspace, 'design-1', { ...common, locks, now: 150 });
  const loaded = await loadShareGrant(workspace, 'design-1', { ...common, locks });
  assert.equal(loaded.shareId, created.shareId);
});

test('revocation is durable, old capability is no longer active, and replacement keeps design identity', async () => {
  const { workspace, locks } = await fixture();
  const original = await createShareGrant(workspace, 'design-1', { ...common, locks, now: 200 });
  assert.equal(await revokeShareGrant(workspace, 'design-1', { locks, now: 300 }), true);
  assert.equal(await loadShareGrant(workspace, 'design-1', { ...common, locks }), null);
  assert.equal(await revokeShareGrant(workspace, 'design-1', { locks, now: 301 }), false);

  const replacement = await createShareGrant(workspace, 'design-1', { ...common, locks, now: 400 });
  assert.notEqual(replacement.shareId, original.shareId);
  assert.deepEqual(replacement.invite.identityPublicKey, original.invite.identityPublicKey);
  assert.notDeepEqual(replacement.invite.capabilityPublicKey, original.invite.capabilityPublicKey);
  assert.equal((await loadShareGrant(workspace, 'design-1', { ...common, locks })).shareId, replacement.shareId);
});

test('one verified answer session can be consumed once, including simultaneous cross-tab attempts', async () => {
  const { workspace, locks } = await fixture();
  const grant = await createShareGrant(workspace, 'design-1', { ...common, locks, now: 10 });
  const answer = {
    v: 1, kind: 'answer', designId: 'design-1', shareId: grant.shareId, sessionId: 'session-one',
    nonce: 'n'.repeat(43), issuedAt: 20, expiresAt: 100_000,
    sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'
  };
  const results = await Promise.allSettled([
    consumeAnswerSessionOnce(workspace, answer, { locks, now: 30 }),
    consumeAnswerSessionOnce(workspace, answer, { locks, now: 30 })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected.reason instanceof ShareStoreError);
  assert.equal(rejected.reason.code, 'SESSION_REPLAYED');
  assert.equal(await revokeShareGrant(workspace, 'design-1', { locks, now: 40 }), true);
  await assert.rejects(consumeAnswerSessionOnce(workspace, { ...answer, sessionId: 'session-two' }, { locks, now: 50 }),
    error => error.code === 'SHARE_REVOKED');
});

test('corrupt identity, unsafe IDs, and failed durable writes fail closed', async () => {
  const state = await fixture();
  await assert.rejects(createShareGrant(state.workspace, '../escape', { ...common, locks: state.locks }), error => error.code === 'INVALID_ID');
  await assert.rejects(loadShareGrant(state.workspace, '../escape', { ...common, locks: state.locks }), error => error.code === 'INVALID_ID');

  state.root.failCloseFor = 'identity.json';
  await assert.rejects(createShareGrant(state.workspace, 'design-1', { ...common, locks: state.locks }), error => error.code === 'RECORD_WRITE_FAILED');
  const sharing = await (await state.design.getDirectoryHandle('.tiny-image-star')).getDirectoryHandle('sharing');
  const identity = await sharing.getFileHandle('identity.json');
  identity.contents = '{corrupt';
  await assert.rejects(createShareGrant(state.workspace, 'design-1', { ...common, locks: state.locks }), error => error.code === 'IDENTITY_KEY_INVALID');

  const active = await fixture();
  await createShareGrant(active.workspace, 'design-1', { ...common, locks: active.locks });
  const activeSharing = await (await active.design.getDirectoryHandle('.tiny-image-star')).getDirectoryHandle('sharing');
  (await activeSharing.getFileHandle('identity.json')).contents = '{corrupt';
  await assert.rejects(loadShareGrant(active.workspace, 'design-1', { ...common, locks: active.locks }), error => error.code === 'IDENTITY_KEY_INVALID');
});

test('session records require the active share and unexpired, bounded answer metadata', async () => {
  const { workspace, locks } = await fixture();
  const grant = await createShareGrant(workspace, 'design-1', { ...common, locks, now: 0 });
  const base = {
    v: 1, kind: 'answer', designId: 'design-1', shareId: grant.shareId, sessionId: 'session-valid',
    nonce: 'x'.repeat(43), issuedAt: 1_000, expiresAt: 61_000, sdp: 'valid'
  };
  await assert.rejects(consumeAnswerSessionOnce(workspace, { ...base, expiresAt: 900_000 }, { locks, now: 2_000 }),
    error => error.code === 'SESSION_INVALID');
  await assert.rejects(consumeAnswerSessionOnce(workspace, { ...base, sessionId: '../escape' }, { locks, now: 2_000 }),
    error => error.code === 'INVALID_ID');
  await assert.rejects(consumeAnswerSessionOnce(workspace, { ...base, shareId: 'different-grant' }, { locks, now: 2_000 }),
    error => error.code === 'SHARE_REVOKED');
});
