import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode } from '../src/model.js';
import { decodeCollaborationMessage, encodeCollaborationMessage } from '../src/collaboration/protocol.js';
import { createGuestSessionController, createHostSessionController } from '../src/collaboration/session-controller.js';

class FakeChannel {
  constructor() { this.readyState = 'open'; this.listeners = new Map(); this.sent = []; this.closed = false; this.bufferedAmount = 0; this.bufferedAmountLowThreshold = 0; this.peer = null; }
  addEventListener(type, callback) { const group = this.listeners.get(type) || new Set(); group.add(callback); this.listeners.set(type, group); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  send(data) { if (this.closed) throw new Error('closed'); this.sent.push(data); if (this.peer) queueMicrotask(() => this.peer.emit('message', { data })); }
  emit(type, event = {}) { for (const callback of [...(this.listeners.get(type) || [])]) callback(event); }
  receive(message) { this.emit('message', { data: encodeCollaborationMessage(message) }); }
  close() { if (this.closed) return; this.closed = true; this.readyState = 'closed'; this.emit('close'); }
}

const locks = { request: async (_name, _options, callback) => callback() };
const workspace = { workspaceId: 'workspace-a', getDesignDirectoryHandle: async () => ({}) };
function context(kind, fields = {}) {
  return { v: 1, kind, designId: 'design-a', sessionId: 'session-a', actorId: 'guest-a', ...fields };
}
async function settle() { await new Promise(resolve => setTimeout(resolve, 0)); }
function fakeTimers() {
  let id = 0;
  const tasks = new Map();
  return {
    tasks,
    schedule(callback, delay) { const task = { id: ++id, callback, delay, cancelled: false }; tasks.set(task.id, task); return task.id; },
    cancel(timerId) { const task = tasks.get(timerId); if (task) task.cancelled = true; }
  };
}

function fakeDesign() {
  const document = createDocument();
  document.id = 'design-a';
  return { designId: document.id, document, pageIds: document.pages.map(page => page.id), head: { sequence: 2, commitHash: 'a'.repeat(64) } };
}

async function hostFixture(overrides = {}) {
  const channel = new FakeChannel();
  const events = [];
  let persisted = fakeDesign();
  let releaseCommit = null;
  const controller = await createHostSessionController({
    workspace, designId: 'design-a', locks, crypto: globalThis.crypto,
    loadGrant: async () => ({ shareId: 'share-a', encodedInvite: 'invite-a', invite: { designId: 'design-a' }, identityPrivateKey: {} }),
    createGrant: async () => { throw new Error('unexpected grant creation'); },
    verifyAnswer: async () => { events.push('verified'); return { kind: 'answer', designId: 'design-a', shareId: 'share-a', sessionId: 'session-a' }; },
    consumeAnswer: async () => { events.push('consumed'); },
    open: async () => persisted,
    commit: async (_workspace, _designId, snapshot, options) => {
      events.push('commit-start');
      if (releaseCommit) await releaseCommit;
      persisted = { ...persisted, document: structuredClone(snapshot), head: { sequence: options.expectedHead.sequence + 1, commitHash: 'b'.repeat(64) } };
      events.push('commit-finished');
      return persisted;
    },
    createTransport: async () => ({
      offerCapsule: 'offer-a', dataChannel: channel,
      session: { sessionId: 'session-a', expiresAt: overrides.offerExpiresAt },
      acceptAnswer: async () => { events.push('answer-applied'); },
      waitForOpen: async () => true,
      close: () => channel.close()
    }),
    ...overrides
  });
  return { controller, channel, events, persisted: () => persisted, holdCommit: () => { releaseCommit = new Promise(resolve => { releaseCommit = resolve; }); return releaseCommit; }, release: () => releaseCommit?.() };
}

test('host verifies and durably consumes an answer before accepting the peer', async () => {
  const { controller, events } = await hostFixture();
  assert.equal(controller.state, 'waiting-answer');
  await controller.acceptAnswer('answer-capsule');
  assert.deepEqual(events, ['verified', 'consumed', 'answer-applied']);
  controller.close();
});

test('manual offer relay remains available until capsule expiry, then starts the HELLO timeout', async () => {
  let clock = 1_000;
  const timers = fakeTimers();
  const { controller } = await hostFixture({
    now: () => clock,
    offerExpiresAt: clock + 5 * 60_000,
    handshakeTimeoutMs: 20_000,
    scheduleTimeout: timers.schedule,
    cancelTimeout: timers.cancel
  });
  const offerTimer = [...timers.tasks.values()][0];
  assert.equal(offerTimer.delay, 5 * 60_000);

  clock += 30_000;
  await controller.acceptAnswer('answer-capsule');
  assert.equal(controller.state, 'waiting-guest');
  assert.equal(offerTimer.cancelled, true);
  assert.equal([...timers.tasks.values()].at(-1).delay, 20_000);
  controller.close();

  const expiredTimers = fakeTimers();
  const expired = await hostFixture({
    now: () => 1_000,
    offerExpiresAt: 6 * 60_000,
    scheduleTimeout: expiredTimers.schedule,
    cancelTimeout: expiredTimers.cancel
  });
  [...expiredTimers.tasks.values()][0].callback();
  assert.equal(expired.controller.state, 'timeout');
  assert.equal(expired.channel.closed, true);
});

test('host sends a snapshot only after HELLO and persists guest snapshot before ACK', async () => {
  let release;
  const { controller, channel, events, persisted } = await hostFixture({
    commit: async (_workspace, _designId, snapshot, options) => {
      events.push('commit-start');
      await new Promise(resolve => { release = resolve; });
      const result = { ...persisted(), document: structuredClone(snapshot), head: { sequence: options.expectedHead.sequence + 1, commitHash: 'b'.repeat(64) } };
      events.push('commit-finished');
      return result;
    }
  });
  await controller.acceptAnswer('answer-capsule');
  assert.equal(channel.sent.length, 0);
  channel.receive(context('HELLO', { lastRevision: 0 }));
  await settle();
  assert.deepEqual(channel.sent.map(raw => decodeCollaborationMessage(raw).kind), ['WELCOME', 'SNAPSHOT']);

  const snapshot = JSON.parse(JSON.stringify(persisted().document));
  snapshot.name = 'Guest change';
  const operation = { type: 'ReplaceSnapshot', opId: 'op-a', baseRevision: 2, snapshot };
  channel.receive(context('OPERATION', { operation }));
  await settle();
  assert.deepEqual(events.slice(-1), ['commit-start']);
  assert.equal(channel.sent.length, 2, 'no ACK is sent while folder persistence is pending');
  release();
  await settle();
  assert.deepEqual(events.slice(-2), ['commit-start', 'commit-finished']);
  const reply = decodeCollaborationMessage(channel.sent.at(-1), { direction: 'host-to-guest' });
  assert.equal(reply.kind, 'ACK');
  assert.equal(reply.revision, 3);
  controller.close();
});

test('host rejects the wrong peer identity and revocation closes the connected channel', async () => {
  let active = true;
  const { controller, channel } = await hostFixture({
    loadGrant: async () => active ? ({ shareId: 'share-a', encodedInvite: 'invite-a', invite: { designId: 'design-a' }, identityPrivateKey: {} }) : null,
    revokeGrant: async () => { active = false; return true; }
  });
  await controller.acceptAnswer('answer-capsule');
  channel.receive(context('HELLO', { actorId: 'guest-a', lastRevision: 0 }));
  await settle();
  channel.receive(context('OPERATION', { actorId: 'guest-b', operation: { type: 'ReplaceSnapshot', opId: 'op-wrong', baseRevision: 2, snapshot: fakeDesign().document } }));
  await settle();
  assert.equal(controller.state, 'rejected');
  assert.equal(channel.closed, true);

  const next = await hostFixture({ revokeGrant: async () => true });
  await next.controller.acceptAnswer('answer-capsule');
  next.channel.receive(context('HELLO', { lastRevision: 0 }));
  await settle();
  assert.equal(await next.controller.revoke(), true);
  assert.equal(next.controller.state, 'revoked');
  assert.equal(next.channel.closed, true);
});

test('host closes a message burst when a durable operation stalls instead of retaining an unbounded queue', async () => {
  let release;
  const { controller, channel } = await hostFixture({
    commit: async (_workspace, _designId, snapshot, options) => {
      await new Promise(resolve => { release = resolve; });
      return { ...fakeDesign(), document: structuredClone(snapshot), head: { sequence: options.expectedHead.sequence + 1, commitHash: 'c'.repeat(64) } };
    }
  });
  await controller.acceptAnswer('answer-capsule');
  channel.receive(context('HELLO', { lastRevision: 0 }));
  await settle();
  const snapshot = fakeDesign().document;
  channel.receive(context('OPERATION', { operation: { type: 'ReplaceSnapshot', opId: 'op-held', baseRevision: 2, snapshot } }));
  await settle();
  assert.equal(typeof release, 'function', 'the first commit is deliberately stalled');
  for (let index = 0; index < 140; index += 1) channel.receive(context('HELLO', { lastRevision: index }));
  assert.equal(controller.state, 'overloaded');
  assert.equal(channel.closed, true);
  release();
  await settle();
});

test('guest sends edits with a revision fence, advances only on ACK, and saves a fork on disconnect', async () => {
  const channel = new FakeChannel();
  const initial = fakeDesign().document;
  const forks = [];
  let closed = 0;
  const controller = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: channel, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => channel.close()
    }),
    persistFork: async fork => { forks.push(fork); return true; },
    closeSession: () => { closed += 1; }
  });
  await controller.ready;
  assert.equal(decodeCollaborationMessage(channel.sent[0], { direction: 'guest-to-host' }).kind, 'HELLO');
  channel.receive(context('WELCOME', { actorId: 'host-a', hostActorId: 'host-a', revision: 2, headHash: 'a'.repeat(64) }));
  channel.receive({ v: 1, kind: 'SNAPSHOT', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', revision: 2, headHash: 'a'.repeat(64), snapshot: initial });
  await settle();
  assert.equal(controller.state, 'connected');

  const changed = JSON.parse(JSON.stringify(initial));
  changed.name = 'Optimistic edit';
  const opId = controller.proposeSnapshot(changed);
  assert.equal(controller.revision, 2);
  assert.equal(decodeCollaborationMessage(channel.sent.at(-1), { direction: 'guest-to-host' }).operation.opId, opId);
  channel.receive({ v: 1, kind: 'ACK', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', opId, revision: 3, headHash: 'b'.repeat(64) });
  await settle();
  assert.equal(controller.revision, 3);
  assert.equal(controller.snapshot.name, 'Optimistic edit');

  channel.close();
  await settle();
  assert.equal(controller.state, 'fork-saved');
  assert.equal(forks.length, 1);
  assert.equal(forks[0].snapshot.name, 'Optimistic edit');
  assert.equal(closed, 1);
});

test('guest controller exposes a retry after the automatic local fork save initially fails', async () => {
  const channel = new FakeChannel();
  let attempts = 0;
  const controller = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({ answerCapsule: 'answer-a', dataChannel: channel, session: { sessionId: 'session-a' }, waitForOpen: async () => true, close: () => channel.close() }),
    persistFork: async () => { attempts += 1; return attempts > 1; }
  });
  await controller.ready;
  channel.receive({ v: 1, kind: 'WELCOME', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', hostActorId: 'host-a', revision: 2, headHash: 'a'.repeat(64) });
  channel.receive({ v: 1, kind: 'SNAPSHOT', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', revision: 2, headHash: 'a'.repeat(64), snapshot: fakeDesign().document });
  await settle();
  channel.close();
  await settle();
  await settle();
  assert.equal(controller.state, 'fork-unsaved');
  assert.equal(controller.fork.saveAttempts, 1);
  const retry = await controller.retryForkSave();
  assert.equal(retry.status, 'fork-saved');
  assert.equal(attempts, 2);
  assert.equal(controller.state, 'fork-saved');
});

test('guest rejects a snapshot whose hash differs from the welcome at the same sequence', async () => {
  const channel = new FakeChannel();
  const controller = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({ answerCapsule: 'answer-a', dataChannel: channel, session: { sessionId: 'session-a' }, waitForOpen: async () => true, close: () => channel.close() }),
    persistFork: async () => true
  });
  await controller.ready;
  channel.receive({ v: 1, kind: 'WELCOME', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', hostActorId: 'host-a', revision: 7, headHash: 'a'.repeat(64) });
  channel.receive({ v: 1, kind: 'SNAPSHOT', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', revision: 7, headHash: 'b'.repeat(64), snapshot: fakeDesign().document });
  await settle();
  assert.equal(controller.state, 'disconnected-before-snapshot');
  assert.equal(controller.snapshot, null);
});

test('live sessions transfer referenced images before the snapshot and persist guest assets before accepting edits', async () => {
  const hostChannel = new FakeChannel();
  const guestChannel = new FakeChannel();
  hostChannel.peer = guestChannel;
  guestChannel.peer = hostChannel;
  const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const uploadedBytes = Uint8Array.from([0, 1, 0, 0, 4, 3, 2, 1, 8, 7, 6, 5]);
  const source = fakeDesign();
  addNode(source.document, createNode('image', { assetId: 'host-image', fileName: 'source.png' }));
  const transfers = [];
  const commits = [];
  const host = await hostFixture({
    open: async () => source,
    createTransport: async () => ({
      offerCapsule: 'offer-a', dataChannel: hostChannel, session: { sessionId: 'session-a' },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => hostChannel.close()
    }),
    readImage: async () => ({ metadata: { mimeType: 'image/png' }, bytes: imageBytes.slice() }),
    approveIncomingAsset: async () => true,
    acceptImage: async (_workspace, _designId, assetId, bytes, options) => {
      transfers.push({ direction: 'guest-to-host', assetId, bytes: bytes.slice(), mimeType: options.mimeType });
    },
    commit: async (_workspace, _designId, snapshot, options) => {
      commits.push(structuredClone(snapshot));
      const saved = { ...source, document: structuredClone(snapshot), head: { sequence: options.expectedHead.sequence + 1, commitHash: 'c'.repeat(64) } };
      return saved;
    }
  });
  const received = [];
  const guest = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: guestChannel, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => guestChannel.close()
    }),
    onAsset: async asset => received.push({ assetId: asset.assetId, assetKind: asset.assetKind, bytes: asset.bytes.slice() }),
    approveIncomingAsset: async () => true,
    persistFork: async () => true
  });
  await guest.ready;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(guest.state, 'connected');
  assert.deepEqual(received.map(asset => asset.assetId), ['host-image']);
  assert.deepEqual(received[0].bytes, imageBytes);

  await guest.sendAsset({ assetId: 'guest-image', assetKind: 'image', mimeType: 'image/png', bytes: uploadedBytes });
  const changed = guest.snapshot;
  addNode(changed, createNode('image', { assetId: 'guest-image', fileName: 'guest.png' }));
  guest.proposeSnapshot(changed);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(transfers, [{ direction: 'guest-to-host', assetId: 'guest-image', bytes: uploadedBytes, mimeType: 'image/png' }]);
  assert.equal(commits.length, 1, 'the design operation follows durable host asset registration on the ordered channel');
  assert.equal(guest.revision, 3);
  host.controller.close();
  guest.close();
});
