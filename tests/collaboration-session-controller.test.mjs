import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCommentReply, addNode, createCommentThread, createDocument, createNode, findNode,
  parseDocument, removeCommentThread, removeNode, serializeDocument, setCommentResolved
} from '../src/model.js';
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
  return { v: 2, kind, designId: 'design-a', sessionId: 'session-a', actorId: 'guest-a', ...fields };
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

test('multiple host peers share one durable sequencer and receive revisions without closing siblings', async () => {
  const firstChannel = new FakeChannel();
  const secondChannel = new FakeChannel();
  const stored = fakeDesign();
  let durable = stored;
  const commits = [];
  const snapshots = [];
  const first = await hostFixture({
    open: async () => durable,
    revokeGrant: async () => true,
    onSnapshot: (_snapshot, head) => snapshots.push(head.sequence),
    createTransport: async () => ({
      offerCapsule: 'offer-a', dataChannel: firstChannel,
      session: { sessionId: 'session-a', expiresAt: Date.now() + 60_000 },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => firstChannel.close()
    }),
    commit: async (_workspace, _designId, snapshot, options) => {
      commits.push(structuredClone(snapshot));
      durable = {
        ...durable,
        document: structuredClone(snapshot),
        head: { sequence: options.expectedHead.sequence + 1, commitHash: String(options.expectedHead.sequence + 1).padStart(64, '0') }
      };
      return durable;
    }
  });
  await first.controller.acceptAnswer('first-answer');
  const second = await first.controller.addGuestSession({
    createTransport: async () => ({
      offerCapsule: 'offer-b', dataChannel: secondChannel,
      session: { sessionId: 'session-b', expiresAt: Date.now() + 60_000 },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => secondChannel.close()
    })
  });
  await second.acceptAnswer('second-answer');
  firstChannel.receive(context('HELLO', { lastRevision: 0 }));
  secondChannel.receive(context('HELLO', { actorId: 'guest-b', sessionId: 'session-b', lastRevision: 0 }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(first.controller.guestCount, 2);
  assert.deepEqual(firstChannel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }).kind), ['WELCOME', 'SNAPSHOT']);
  assert.deepEqual(secondChannel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }).kind), ['WELCOME', 'SNAPSHOT']);

  const firstEdit = structuredClone(durable.document);
  firstEdit.name = 'First guest commit';
  firstChannel.receive(context('OPERATION', {
    operation: { type: 'ReplaceSnapshot', opId: 'op-first', baseRevision: 2, snapshot: firstEdit }
  }));
  await new Promise(resolve => setTimeout(resolve, 15));
  const firstReplies = firstChannel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }));
  const secondReplies = secondChannel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }));
  assert.equal(firstReplies.at(-1).kind, 'ACK');
  assert.equal(firstReplies.at(-1).sessionId, 'session-a');
  assert.equal(secondReplies.at(-1).kind, 'ROOM_REVISION');
  assert.equal(secondReplies.at(-1).sessionId, 'session-b');
  assert.equal(secondReplies.at(-1).revision, 3);
  assert.equal(secondReplies.at(-1).snapshot.name, 'First guest commit');
  assert.equal(first.controller.head.sequence, 3);
  assert.equal(commits.length, 1);

  firstChannel.close();
  await settle();
  assert.equal(first.controller.guestCount, 1, 'the primary peer can disconnect without ending its sibling session');
  const next = structuredClone(durable.document);
  next.name = 'Second guest remains connected';
  secondChannel.receive(context('OPERATION', {
    actorId: 'guest-b', sessionId: 'session-b',
    operation: { type: 'ReplaceSnapshot', opId: 'op-after-close', baseRevision: 3, snapshot: next }
  }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(decodeCollaborationMessage(secondChannel.sent.at(-1), { direction: 'host-to-guest' }).kind, 'ACK');
  assert.equal(first.controller.head.sequence, 4);
  assert.deepEqual(snapshots, [3, 4], 'the room-owned editor snapshot listener survives the primary peer disconnect');
  await first.controller.revoke();
  assert.equal(secondChannel.closed, true, 'revoking the room closes every active peer');
});

test('an eight-guest room fans one durable revision to every connected session', async () => {
  const durableStart = fakeDesign();
  let durable = durableStart;
  const peers = [];
  let commitCount = 0;
  const { controller } = await hostFixture({
    maxRoomPeers: 8,
    open: async () => durable,
    revokeGrant: async () => true,
    verifyAnswer: async answer => ({
      kind: 'answer', designId: 'design-a', shareId: 'share-a', sessionId: answer
    }),
    createTransport: async () => {
      const channel = new FakeChannel();
      peers.push({ sessionId: 'session-0', channel });
      return {
        offerCapsule: 'offer-0', dataChannel: channel,
        session: { sessionId: 'session-0', expiresAt: Date.now() + 60_000 },
        acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => channel.close()
      };
    },
    commit: async (_workspace, _designId, snapshot, options) => {
      commitCount += 1;
      durable = {
        ...durable,
        document: structuredClone(snapshot),
        head: { sequence: options.expectedHead.sequence + 1, commitHash: String(options.expectedHead.sequence + 1).padStart(64, '0') }
      };
      return durable;
    }
  });
  await controller.acceptAnswer('session-0');
  for (let index = 1; index < 8; index += 1) {
    const sessionId = `session-${index}`;
    const channel = new FakeChannel();
    const peer = await controller.addGuestSession({
      createTransport: async () => ({
        offerCapsule: `offer-${index}`, dataChannel: channel,
        session: { sessionId, expiresAt: Date.now() + 60_000 },
        acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => channel.close()
      })
    });
    peers.push({ sessionId, channel });
    await peer.acceptAnswer(sessionId);
  }

  for (const [index, peer] of peers.entries()) {
    peer.channel.receive(context('HELLO', {
      actorId: `guest-${index}`, sessionId: peer.sessionId, lastRevision: 0
    }));
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(controller.guestCount, 8);
  for (const peer of peers) {
    const kinds = peer.channel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }).kind);
    assert.deepEqual(kinds, ['WELCOME', 'SNAPSHOT']);
  }

  const edited = structuredClone(durable.document);
  edited.name = 'One room-wide revision';
  peers[0].channel.receive(context('OPERATION', {
    actorId: 'guest-0', sessionId: 'session-0',
    operation: { type: 'ReplaceSnapshot', opId: 'op-eight-peer-room', baseRevision: 2, snapshot: edited }
  }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(commitCount, 1);
  assert.equal(controller.head.sequence, 3);
  assert.equal(durable.document.name, 'One room-wide revision');
  for (const [index, peer] of peers.entries()) {
    const messages = peer.channel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }));
    const update = messages.find(message => message.kind === (index === 0 ? 'ACK' : 'ROOM_REVISION'));
    assert.ok(update, `guest ${index} receives its response to the shared commit`);
    assert.equal(update.revision, 3);
    if (index !== 0) assert.equal(update.snapshot.name, 'One room-wide revision');
  }
  await assert.rejects(controller.addGuestSession(), /8-guest limit/);
  await controller.revoke();
  assert.ok(peers.every(peer => peer.channel.closed), 'revoking the room closes all eight sessions');
});

test('a peer disconnect during asynchronous asset approval releases its aggregate room reservation', async () => {
  const firstChannel = new FakeChannel();
  const secondChannel = new FakeChannel();
  let releaseApproval;
  const pendingApproval = new Promise(resolve => { releaseApproval = resolve; });
  const first = await hostFixture({
    maxSessionAssetBytes: 4,
    approveIncomingAsset: async ({ assetId }) => assetId === 'held-image' ? pendingApproval : true,
    createTransport: async () => ({
      offerCapsule: 'offer-a', dataChannel: firstChannel, session: { sessionId: 'session-a' },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => firstChannel.close()
    })
  });
  await first.controller.acceptAnswer('answer-a');
  firstChannel.receive(context('HELLO', { lastRevision: 0 }));
  await settle();
  firstChannel.receive(context('ASSET_BEGIN', {
    flow: 'guest-to-host', transferId: 'transfer-a', assetId: 'held-image', assetKind: 'image',
    mimeType: 'image/png', fontMetadata: null, byteLength: 4, chunkCount: 1, sha256: 'a'.repeat(64)
  }));
  await settle();

  const second = await first.controller.addGuestSession({
    createTransport: async () => ({
      offerCapsule: 'offer-b', dataChannel: secondChannel, session: { sessionId: 'session-b' },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => secondChannel.close()
    })
  });
  await second.acceptAnswer('answer-b');
  secondChannel.receive(context('HELLO', { actorId: 'guest-b', sessionId: 'session-b', lastRevision: 0 }));
  await settle();

  first.controller.close();
  releaseApproval(true);
  await settle();
  secondChannel.receive(context('ASSET_BEGIN', {
    actorId: 'guest-b', sessionId: 'session-b', flow: 'guest-to-host', transferId: 'transfer-b',
    assetId: 'next-image', assetKind: 'image', mimeType: 'image/png', fontMetadata: null,
    byteLength: 4, chunkCount: 1, sha256: 'b'.repeat(64)
  }));
  await settle();
  assert.equal(secondChannel.closed, false, 'the second peer can reserve the bytes released by the disconnected peer');
  second.close();
});

test('a slow peer asset transfer does not block revision delivery to ready sibling peers', async () => {
  const channelA = new FakeChannel();
  const slowChannel = new FakeChannel();
  const fastChannel = new FakeChannel();
  let releaseSlow;
  let signalSlowStarted;
  const slowStarted = new Promise(resolve => { signalSlowStarted = resolve; });
  const slowTransfer = new Promise(resolve => { releaseSlow = resolve; });
  const source = fakeDesign();
  addNode(source.document, createNode('image', { id: 'image-layer', assetId: 'image-a' }));
  let durable = source;
  const host = await hostFixture({
    open: async () => durable,
    revokeGrant: async () => true,
    createTransport: async () => ({
      offerCapsule: 'offer-a', dataChannel: channelA,
      session: { sessionId: 'session-a', expiresAt: Date.now() + 60_000 },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => channelA.close()
    }),
    readImage: async () => ({ metadata: { mimeType: 'image/png' }, bytes: Uint8Array.of(1, 2, 3) }),
    sendAsset: async (channel, asset) => {
      if (channel === slowChannel) {
        signalSlowStarted();
        await slowTransfer;
      }
      return { transferId: asset.transferId, assetId: asset.assetId, assetKind: asset.assetKind, byteLength: asset.bytes.byteLength };
    },
    commit: async (_workspace, _designId, snapshot, options) => {
      durable = {
        ...durable,
        document: structuredClone(snapshot),
        head: { sequence: options.expectedHead.sequence + 1, commitHash: String(options.expectedHead.sequence + 1).padStart(64, '0') }
      };
      return durable;
    }
  });
  await host.controller.acceptAnswer('answer-a');
  const slowPeer = await host.controller.addGuestSession({
    createTransport: async () => ({
      offerCapsule: 'offer-b', dataChannel: slowChannel,
      session: { sessionId: 'session-b', expiresAt: Date.now() + 60_000 },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => slowChannel.close()
    })
  });
  const fastPeer = await host.controller.addGuestSession({
    createTransport: async () => ({
      offerCapsule: 'offer-c', dataChannel: fastChannel,
      session: { sessionId: 'session-c', expiresAt: Date.now() + 60_000 },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => fastChannel.close()
    })
  });
  await Promise.all([slowPeer.acceptAnswer('answer-b'), fastPeer.acceptAnswer('answer-c')]);
  channelA.receive(context('HELLO', { lastRevision: 0 }));
  slowChannel.receive(context('HELLO', { actorId: 'guest-b', sessionId: 'session-b', lastRevision: 0 }));
  fastChannel.receive(context('HELLO', { actorId: 'guest-c', sessionId: 'session-c', lastRevision: 0 }));
  await slowStarted;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fastChannel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }).kind).includes('SNAPSHOT'), true);

  const edited = structuredClone(durable.document);
  edited.name = 'Committed while another peer is syncing';
  channelA.receive(context('OPERATION', {
    operation: { type: 'ReplaceSnapshot', opId: 'op-fast-fanout', baseRevision: 2, snapshot: edited }
  }));
  await new Promise(resolve => setTimeout(resolve, 20));
  const fastKinds = fastChannel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }).kind);
  const fastUpdate = fastChannel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' })).find(message => message.kind === 'ROOM_REVISION');
  assert.ok(fastKinds.includes('ROOM_REVISION'), 'the ready peer receives the committed update without waiting for the slow channel');
  assert.equal(fastUpdate.revision, 3);
  assert.equal(slowChannel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }).kind).includes('SNAPSHOT'), false);

  releaseSlow();
  await new Promise(resolve => setTimeout(resolve, 20));
  const slowMessages = slowChannel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }));
  assert.equal(slowMessages.find(message => message.kind === 'SNAPSHOT').revision, 2);
  assert.equal(slowMessages.find(message => message.kind === 'ROOM_REVISION').revision, 3);
  await host.controller.revoke();
});

test('simultaneous same-head guest edits commit once and preserve the losing proposal as its local fork', async () => {
  const hostChannelA = new FakeChannel();
  const hostChannelB = new FakeChannel();
  const guestChannelA = new FakeChannel();
  const guestChannelB = new FakeChannel();
  hostChannelA.peer = guestChannelA;
  guestChannelA.peer = hostChannelA;
  hostChannelB.peer = guestChannelB;
  guestChannelB.peer = hostChannelB;
  let durable = fakeDesign();
  let commits = 0;
  const host = await hostFixture({
    open: async () => durable,
    revokeGrant: async () => true,
    createTransport: async () => ({
      offerCapsule: 'offer-a', dataChannel: hostChannelA,
      session: { sessionId: 'session-a', expiresAt: Date.now() + 60_000 },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => hostChannelA.close()
    }),
    commit: async (_workspace, _designId, snapshot, options) => {
      commits += 1;
      durable = {
        ...durable,
        document: structuredClone(snapshot),
        head: { sequence: options.expectedHead.sequence + 1, commitHash: String(options.expectedHead.sequence + 1).padStart(64, '0') }
      };
      return durable;
    }
  });
  await host.controller.acceptAnswer('answer-a');
  const hostB = await host.controller.addGuestSession({
    createTransport: async () => ({
      offerCapsule: 'offer-b', dataChannel: hostChannelB,
      session: { sessionId: 'session-b', expiresAt: Date.now() + 60_000 },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => hostChannelB.close()
    })
  });
  await hostB.acceptAnswer('answer-b');
  const savedForks = [];
  const guestA = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: guestChannelA, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => guestChannelA.close()
    }),
    persistFork: async fork => { savedForks.push(fork); return true; }
  });
  const guestB = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-b',
    createTransport: async () => ({
      answerCapsule: 'answer-b', dataChannel: guestChannelB, session: { sessionId: 'session-b' },
      waitForOpen: async () => true, close: () => guestChannelB.close()
    }),
    persistFork: async fork => { savedForks.push(fork); return true; }
  });
  await Promise.all([guestA.ready, guestB.ready]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(guestA.state, 'connected');
  assert.equal(guestB.state, 'connected');

  const proposalA = guestA.snapshot;
  proposalA.name = 'First concurrent proposal';
  const proposalB = guestB.snapshot;
  proposalB.name = 'Second concurrent proposal';
  guestA.proposeSnapshot(proposalA);
  guestB.proposeSnapshot(proposalB);
  await new Promise(resolve => setTimeout(resolve, 40));

  assert.equal(commits, 1, 'one revision from the shared base can commit');
  assert.equal(host.controller.head.sequence, 3);
  const outcomes = [guestA, guestB].map(guest => guest.state).sort();
  assert.deepEqual(outcomes, ['connected', 'fork-saved']);
  assert.equal(savedForks.length, 1);
  assert.equal(savedForks[0].pendingOperations.length, 1);
  assert.equal(['First concurrent proposal', 'Second concurrent proposal'].includes(durable.document.name), true);
  assert.equal(host.controller.guestCount, 1, 'the conflicted guest is isolated while the winning peer stays connected');
  host.controller.close();
  guestA.close();
  guestB.close();
});

test('live comment create, reply, resolve, and delete sync through durable full-snapshot ACKs', async () => {
  const initial = fakeDesign();
  let stored = {
    ...initial,
    document: parseDocument(serializeDocument(initial.document))
  };
  let commitCount = 0;
  const { controller, channel } = await hostFixture({
    open: async () => stored,
    commit: async (_workspace, _designId, snapshot, options) => {
      // Model a verified workspace reopen: only a parseable, schema-valid saved
      // snapshot can become the state for which the host returns an ACK.
      const reopened = parseDocument(serializeDocument(snapshot));
      const sequence = options.expectedHead.sequence + 1;
      stored = {
        ...stored,
        document: reopened,
        head: { sequence, commitHash: sequence.toString(16).padStart(64, '0') }
      };
      commitCount += 1;
      return stored;
    }
  });
  await controller.acceptAnswer('answer-capsule');
  channel.receive(context('HELLO', { lastRevision: 0 }));
  await settle();

  let guestCopy = parseDocument(serializeDocument(stored.document));
  const thread = createCommentThread(guestCopy, {
    pageId: guestCopy.activePageId, x: 24.5, y: -12, text: 'Check this spacing.', author: 'Guest'
  });
  const acknowledged = [];
  async function propose(opId) {
    const beforeRevision = controller.head.sequence;
    channel.receive(context('OPERATION', {
      operation: {
        type: 'ReplaceSnapshot', opId, baseRevision: beforeRevision,
        snapshot: JSON.parse(serializeDocument(guestCopy))
      }
    }));
    await settle();
    const ack = decodeCollaborationMessage(channel.sent.at(-1), { direction: 'host-to-guest' });
    assert.equal(ack.kind, 'ACK');
    assert.equal(ack.opId, opId);
    assert.equal(ack.revision, beforeRevision + 1);
    assert.equal(stored.head.sequence, ack.revision, 'the ACK names the reopened durable workspace head');
    assert.deepEqual(stored.document.comments || [], guestCopy.comments || [], 'the host persisted the exact comment snapshot before ACK');
    acknowledged.push(ack);
    guestCopy = parseDocument(serializeDocument(stored.document));
  }

  await propose('comment-create');
  assert.equal(stored.document.comments[0].messages[0].text, 'Check this spacing.');

  addCommentReply(guestCopy, thread.id, 'Adjusted to 16 px.', 'Guest');
  await propose('comment-reply');
  assert.deepEqual(stored.document.comments[0].messages.map(message => message.text), [
    'Check this spacing.', 'Adjusted to 16 px.'
  ]);

  assert.equal(setCommentResolved(guestCopy, thread.id, true), true);
  await propose('comment-resolve');
  assert.equal(stored.document.comments[0].resolved, true);

  assert.equal(removeCommentThread(guestCopy, thread.id), true);
  await propose('comment-delete');
  assert.deepEqual(stored.document.comments, []);
  assert.equal(commitCount, 4);
  assert.deepEqual(acknowledged.map(ack => ack.revision), [3, 4, 5, 6]);

  controller.close();
});

test('host sends ephemeral view state and keeps its selected page through guest snapshot commits', async () => {
  const initial = fakeDesign();
  const firstPageId = initial.document.pages[0].id;
  initial.document.pages.push({ ...structuredClone(initial.document.pages[0]), id: 'page-b', name: 'Page B', children: [] });
  const { controller, channel, persisted } = await hostFixture({
    open: async () => initial,
    getViewState: () => ({ pageId: 'page-b', zoom: 1.5, centerX: 240, centerY: -80 })
  });
  await controller.acceptAnswer('answer-capsule');
  channel.receive(context('HELLO', { lastRevision: 0 }));
  await settle();
  const messages = channel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }));
  assert.deepEqual(messages.map(message => message.kind), ['WELCOME', 'SNAPSHOT', 'VIEW_STATE']);
  assert.deepEqual({
    sequence: messages[2].sequence, pageId: messages[2].pageId, zoom: messages[2].zoom,
    centerX: messages[2].centerX, centerY: messages[2].centerY
  }, { sequence: 1, pageId: 'page-b', zoom: 1.5, centerX: 240, centerY: -80 });
  assert.equal(controller.head.sequence, 2, 'initial view sync does not create a folder commit');

  const guestSnapshot = structuredClone(initial.document);
  guestSnapshot.activePageId = firstPageId;
  guestSnapshot.name = 'Guest edit';
  channel.receive(context('OPERATION', {
    operation: { type: 'ReplaceSnapshot', opId: 'op-page-view', baseRevision: 2, snapshot: guestSnapshot }
  }));
  await settle();
  assert.equal(persisted().document.activePageId, 'page-b', 'guest document proposals cannot change the master-selected page');
  assert.equal(controller.publishViewState({ pageId: firstPageId, zoom: 2, centerX: 12, centerY: 34 }), true);
  const view = decodeCollaborationMessage(channel.sent.at(-1), { direction: 'host-to-guest' });
  assert.equal(view.kind, 'VIEW_STATE');
  assert.equal(view.sequence, 2);
  assert.equal(view.pageId, firstPageId);
  assert.equal(controller.head.sequence, 3, 'only the accepted guest edit advances the folder head');
  controller.close();
});

test('live presence relays cursors and selections without a design revision, and removes a leaving peer', async () => {
  const hostPresence = [];
  const guestPresence = [];
  const { controller: host, channel: hostChannel, persisted } = await hostFixture({
    onPresence: presence => hostPresence.push(presence)
  });
  await host.acceptAnswer('answer-capsule');

  const guestChannel = new FakeChannel();
  guestChannel.peer = hostChannel;
  hostChannel.peer = guestChannel;
  const guest = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: guestChannel, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => guestChannel.close()
    }),
    persistFork: async () => true,
    onPresence: presence => guestPresence.push(presence)
  });
  await guest.ready;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(guest.state, 'connected');

  const pageId = persisted().document.pages[0].id;
  assert.equal(guest.publishPresence({
    pageId, cursorX: 42.5, cursorY: -18, selectedIds: ['node-guest']
  }), true);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(hostPresence.at(-1).peerActorId, guest.actorId);
  assert.deepEqual([hostPresence.at(-1).cursorX, hostPresence.at(-1).cursorY], [42.5, -18]);
  assert.equal(host.publishPresence({ pageId, cursorX: 80, cursorY: 96, selectedIds: ['node-host'] }), true);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(guestPresence.at(-1).active, true);
  assert.notEqual(guestPresence.at(-1).peerActorId, guest.actorId);
  assert.deepEqual(guestPresence.at(-1).selectedIds, ['node-host']);
  assert.deepEqual(hostPresence[0].selectedIds, ['node-guest']);
  assert.equal(host.head.sequence, 2, 'cursor movement never creates a saved design revision');

  guest.close();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(hostPresence.at(-1).active, false, 'leaving guests explicitly clear their transient presence');
  host.close();
});

test('presence for a page still being saved is ignored without rejecting the guest', async () => {
  const received = [];
  const { controller, channel } = await hostFixture({ onPresence: presence => received.push(presence) });
  await controller.acceptAnswer('answer-capsule');
  channel.receive(context('HELLO', { lastRevision: 0 }));
  await settle();
  channel.receive(context('PRESENCE', {
    peerActorId: 'guest-a', sequence: 1, active: true, pageId: 'page-not-yet-saved',
    cursorX: 8, cursorY: 9, selectedIds: []
  }));
  await settle();
  assert.equal(controller.state, 'connected');
  assert.equal(channel.closed, false);
  assert.deepEqual(received, []);
  controller.close();
});

test('host token-bucket rate limits guest presence without disconnecting the session', async () => {
  const received = [];
  const { controller, channel, persisted } = await hostFixture({
    now: () => 1_000,
    onPresence: presence => received.push(presence)
  });
  await controller.acceptAnswer('answer-capsule');
  channel.receive(context('HELLO', { lastRevision: 0 }));
  await settle();
  const pageId = persisted().document.pages[0].id;
  for (let sequence = 1; sequence <= 35; sequence += 1) {
    channel.receive(context('PRESENCE', {
      peerActorId: 'guest-a', sequence, active: true, pageId,
      cursorX: sequence, cursorY: sequence, selectedIds: []
    }));
  }
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(received.length, 30, 'the initial token bucket admits at most thirty immediate updates');
  assert.equal(controller.state, 'connected');
  assert.equal(channel.closed, false);
  controller.close();
});

test('a new guest receives active peer presence and host relay updates without exposing guest channels', async () => {
  const hostPresence = [];
  const { controller: host, channel: hostChannel } = await hostFixture({
    onPresence: presence => hostPresence.push(presence)
  });
  await host.acceptAnswer('answer-a');
  const guestChannelA = new FakeChannel();
  hostChannel.peer = guestChannelA;
  guestChannelA.peer = hostChannel;
  const guestA = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: guestChannelA, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => guestChannelA.close()
    }),
    persistFork: async () => true
  });
  await guestA.ready;
  await new Promise(resolve => setTimeout(resolve, 15));
  const pageId = guestA.snapshot.pages[0].id;
  guestA.publishPresence({ pageId, cursorX: 25, cursorY: 35, selectedIds: [] });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(hostPresence.at(-1).peerActorId, guestA.actorId);

  const hostChannelB = new FakeChannel();
  const hostB = await host.addGuestSession({
    createTransport: async () => ({
      offerCapsule: 'offer-b', dataChannel: hostChannelB,
      session: { sessionId: 'session-b', expiresAt: Date.now() + 60_000 },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => hostChannelB.close()
    })
  });
  await hostB.acceptAnswer('answer-b');
  const guestChannelB = new FakeChannel();
  const receivedByB = [];
  hostChannelB.peer = guestChannelB;
  guestChannelB.peer = hostChannelB;
  const guestB = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-b',
    createTransport: async () => ({
      answerCapsule: 'answer-b', dataChannel: guestChannelB, session: { sessionId: 'session-b' },
      waitForOpen: async () => true, close: () => guestChannelB.close()
    }),
    persistFork: async () => true,
    onPresence: presence => receivedByB.push(presence)
  });
  await guestB.ready;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(receivedByB[0].peerActorId, guestA.actorId, 'the host shares the current roster state with a later guest');

  guestA.publishPresence({ pageId, cursorX: 88, cursorY: 99, selectedIds: [] });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual([receivedByB.at(-1).cursorX, receivedByB.at(-1).cursorY], [88, 99]);
  assert.equal(guestB.state, 'connected');
  assert.equal(host.guestCount, 2);
  guestA.close();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(receivedByB.at(-1).active, false);
  guestB.close();
  await new Promise(resolve => setTimeout(resolve, 15));
  host.close();
  hostB.close();
});

test('presence sequence remains fresh when a disconnected guest actor ID is reused', async () => {
  const hostChannelA = new FakeChannel();
  const hostChannelB = new FakeChannel();
  const host = await hostFixture({
    createTransport: async () => ({
      offerCapsule: 'offer-a', dataChannel: hostChannelA,
      session: { sessionId: 'session-a', expiresAt: Date.now() + 60_000 },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => hostChannelA.close()
    })
  });
  await host.controller.acceptAnswer('answer-a');
  const observerHost = await host.controller.addGuestSession({
    createTransport: async () => ({
      offerCapsule: 'offer-b', dataChannel: hostChannelB,
      session: { sessionId: 'session-b', expiresAt: Date.now() + 60_000 },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => hostChannelB.close()
    })
  });
  await observerHost.acceptAnswer('answer-b');

  const reusedActorId = 'guest-reused';
  hostChannelA.receive(context('HELLO', { actorId: reusedActorId, lastRevision: 0 }));
  hostChannelB.receive(context('HELLO', { actorId: 'guest-observer', sessionId: 'session-b', lastRevision: 0 }));
  await settle();
  const pageId = host.persisted().document.pages[0].id;
  const observerChannel = new FakeChannel();
  hostChannelB.peer = observerChannel;
  observerChannel.peer = hostChannelB;
  const received = [];
  observerChannel.addEventListener('message', event => {
    const message = decodeCollaborationMessage(event.data, { direction: 'host-to-guest' });
    if (message.kind === 'PRESENCE' && message.peerActorId === reusedActorId) received.push(message);
  });

  hostChannelA.receive(context('PRESENCE', {
    actorId: reusedActorId, peerActorId: reusedActorId, sequence: 40, active: true,
    pageId, cursorX: 1, cursorY: 2, selectedIds: []
  }));
  await settle();
  hostChannelA.close();
  await settle();
  const inactive = received.at(-1);
  assert.equal(inactive.active, false);

  const hostChannelC = new FakeChannel();
  const reconnectedHost = await host.controller.addGuestSession({
    createTransport: async () => ({
      offerCapsule: 'offer-c', dataChannel: hostChannelC,
      session: { sessionId: 'session-c', expiresAt: Date.now() + 60_000 },
      acceptAnswer: async () => {}, waitForOpen: async () => true, close: () => hostChannelC.close()
    })
  });
  await reconnectedHost.acceptAnswer('answer-c');
  hostChannelC.receive(context('HELLO', { actorId: reusedActorId, sessionId: 'session-c', lastRevision: 0 }));
  await settle();
  hostChannelC.receive(context('PRESENCE', {
    actorId: reusedActorId, sessionId: 'session-c', peerActorId: reusedActorId, sequence: 1,
    active: true, pageId, cursorX: 8, cursorY: 9, selectedIds: []
  }));
  await settle();

  const active = received.at(-1);
  assert.equal(active.active, true);
  assert.ok(active.sequence > inactive.sequence, 'room relays sequence numbers that survive actor ID reuse');
  assert.deepEqual([active.cursorX, active.cursorY], [8, 9]);
  host.controller.close();
  observerHost.close();
  reconnectedHost.close();
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
  const viewStates = [];
  const controller = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: channel, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => channel.close()
    }),
    persistFork: async fork => { forks.push(fork); return true; },
    onViewState: view => viewStates.push(view),
    closeSession: () => { closed += 1; }
  });
  await controller.ready;
  assert.equal(decodeCollaborationMessage(channel.sent[0], { direction: 'guest-to-host' }).kind, 'HELLO');
  channel.receive(context('WELCOME', { actorId: 'host-a', hostActorId: 'host-a', revision: 2, headHash: 'a'.repeat(64) }));
  channel.receive({ v: 2, kind: 'SNAPSHOT', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', revision: 2, headHash: 'a'.repeat(64), snapshot: initial });
  await settle();
  assert.equal(controller.state, 'connected');
  const pageId = initial.pages[0].id;
  channel.receive({ v: 2, kind: 'VIEW_STATE', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', sequence: 1, pageId, zoom: 1.75, centerX: 480, centerY: 360 });
  channel.receive({ v: 2, kind: 'VIEW_STATE', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', sequence: 1, pageId, zoom: 3, centerX: 0, centerY: 0 });
  await settle();
  assert.equal(viewStates.length, 1, 'duplicate view sequence is ignored');
  assert.equal(controller.viewState.zoom, 1.75);

  const changed = JSON.parse(JSON.stringify(initial));
  changed.name = 'Optimistic edit';
  const opId = controller.proposeSnapshot(changed);
  assert.equal(controller.revision, 2);
  assert.equal(decodeCollaborationMessage(channel.sent.at(-1), { direction: 'guest-to-host' }).operation.opId, opId);
  channel.receive({ v: 2, kind: 'ACK', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', opId, revision: 3, headHash: 'b'.repeat(64) });
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

test('guest layer deletion uses a typed DeleteNode and adopts its exact durable ACK snapshot', async () => {
  const channel = new FakeChannel();
  const initial = fakeDesign().document;
  const layer = createNode('rectangle', { id: 'layer-delete-a', name: 'Remove me' });
  addNode(initial, layer);
  const controller = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: channel, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => channel.close()
    }),
    persistFork: async () => true
  });
  await controller.ready;
  channel.receive(context('WELCOME', { actorId: 'host-a', hostActorId: 'host-a', revision: 2, headHash: 'a'.repeat(64) }));
  channel.receive({ v: 2, kind: 'SNAPSHOT', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', revision: 2, headHash: 'a'.repeat(64), snapshot: initial });
  await settle();

  const changed = controller.snapshot;
  assert.ok(removeNode(changed, layer.id));
  const opId = controller.proposeSnapshot(changed);
  const message = decodeCollaborationMessage(channel.sent.at(-1), { direction: 'guest-to-host' });
  assert.equal(message.kind, 'OPERATION');
  assert.equal(message.operation.type, 'DeleteNode');
  assert.equal(message.operation.nodeId, layer.id);
  assert.equal(message.operation.baseRevision, 2);

  channel.receive({ v: 2, kind: 'ACK', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', opId, revision: 3, headHash: 'b'.repeat(64) });
  await settle();
  assert.equal(controller.revision, 3);
  assert.equal(findNode(controller.snapshot, layer.id), null);
  controller.close();
});

test('guest stages and sends every operation in a multi-property edit with ordered revision fences', async () => {
  const channel = new FakeChannel();
  const initial = fakeDesign().document;
  const layer = createNode('rectangle', { id: 'layer-props-a', name: 'Before' });
  addNode(initial, layer);
  const controller = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: channel, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => channel.close()
    }),
    persistFork: async () => true
  });
  await controller.ready;
  channel.receive(context('WELCOME', { actorId: 'host-a', hostActorId: 'host-a', revision: 2, headHash: 'a'.repeat(64) }));
  channel.receive({ v: 2, kind: 'SNAPSHOT', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', revision: 2, headHash: 'a'.repeat(64), snapshot: initial });
  await settle();

  const changed = controller.snapshot;
  findNode(changed, layer.id).node.name = 'After';
  findNode(changed, layer.id).node.x = 18;
  const opId = controller.proposeSnapshot(changed);
  const operations = channel.sent
    .map(raw => decodeCollaborationMessage(raw, { direction: 'guest-to-host' }))
    .filter(message => message.kind === 'OPERATION');
  assert.equal(operations.length, 2);
  assert.deepEqual(operations.map(message => message.operation.type), ['SetProperty', 'SetProperty']);
  assert.deepEqual(operations.map(message => message.operation.baseRevision), [2, 3]);

  channel.receive({ v: 2, kind: 'ACK', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', opId: operations[0].operation.opId, revision: 3, headHash: 'b'.repeat(64) });
  await settle();
  assert.equal(controller.revision, 3);
  assert.equal(controller.snapshot.name, initial.name);
  assert.equal(findNode(controller.snapshot, layer.id).node.name, 'After');
  assert.equal(findNode(controller.snapshot, layer.id).node.x, layer.x);

  channel.receive({ v: 2, kind: 'ACK', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', opId: operations[1].operation.opId, revision: 4, headHash: 'c'.repeat(64) });
  await settle();
  assert.equal(controller.revision, 4);
  assert.equal(findNode(controller.snapshot, layer.id).node.x, 18);
  controller.close();
});

test('guest freezes and saves the full local checkpoint when sending a multi-operation edit fails partway through', async () => {
  const channel = new FakeChannel();
  const initial = fakeDesign().document;
  const layer = createNode('rectangle', { id: 'layer-send-failure', name: 'Before' });
  addNode(initial, layer);
  const savedForks = [];
  let operationSends = 0;
  const send = channel.send.bind(channel);
  channel.send = data => {
    if (typeof data === 'string') {
      let message;
      try { message = JSON.parse(data); } catch { /* Let the protocol encoder own malformed data errors. */ }
      if (message?.kind === 'OPERATION' && ++operationSends === 2) {
        throw new Error('DataChannel send queue is full.');
      }
    }
    send(data);
  };

  const controller = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: channel, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => channel.close()
    }),
    persistFork: async fork => { savedForks.push(fork); return true; }
  });
  await controller.ready;
  channel.receive(context('WELCOME', { actorId: 'host-a', hostActorId: 'host-a', revision: 2, headHash: 'a'.repeat(64) }));
  channel.receive({
    v: 2, kind: 'SNAPSHOT', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a',
    revision: 2, headHash: 'a'.repeat(64), snapshot: initial
  });
  await settle();

  const changed = controller.snapshot;
  findNode(changed, layer.id).node.name = 'After';
  findNode(changed, layer.id).node.x = 24;
  assert.throws(() => controller.proposeSnapshot(changed), /DataChannel send queue is full/);
  await settle();

  assert.equal(operationSends, 2);
  assert.equal(channel.sent.map(raw => {
    try { return JSON.parse(raw).kind; } catch { return null; }
  }).filter(kind => kind === 'OPERATION').length, 1, 'the first operation may have been sent before backpressure surfaced');
  assert.equal(controller.state, 'fork-saved');
  assert.equal(savedForks.length, 1, 'the ambiguous partial send is preserved as one local recovery point');
  assert.equal(savedForks[0].pendingOperations.length, 2, 'the recovery point retains the complete staged edit, including unsent operations');
  assert.deepEqual(savedForks[0].pendingOperations.map(operation => operation.baseRevision), [2, 3]);
  assert.deepEqual(savedForks[0].pendingOperations.map(operation => operation.value), ['After', 24]);
  controller.close();
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
  channel.receive({ v: 2, kind: 'WELCOME', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', hostActorId: 'host-a', revision: 2, headHash: 'a'.repeat(64) });
  channel.receive({ v: 2, kind: 'SNAPSHOT', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', revision: 2, headHash: 'a'.repeat(64), snapshot: fakeDesign().document });
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
  channel.receive({ v: 2, kind: 'WELCOME', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', hostActorId: 'host-a', revision: 7, headHash: 'a'.repeat(64) });
  channel.receive({ v: 2, kind: 'SNAPSHOT', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a', revision: 7, headHash: 'b'.repeat(64), snapshot: fakeDesign().document });
  await settle();
  assert.equal(controller.state, 'disconnected-before-snapshot');
  assert.equal(controller.snapshot, null);
});

test('guest adopts a committed room revision from another peer and persists the new master snapshot', async () => {
  const channel = new FakeChannel();
  const saved = [];
  const snapshots = [];
  const initial = fakeDesign().document;
  const controller = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: channel, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => channel.close()
    }),
    persistFork: async fork => { saved.push(fork); return true; },
    onSnapshot: (snapshot, revision, head, metadata) => snapshots.push({ snapshot, revision, head, source: metadata?.source })
  });
  await controller.ready;
  channel.receive(context('WELCOME', { actorId: 'host-a', hostActorId: 'host-a', revision: 2, headHash: 'a'.repeat(64) }));
  channel.receive({
    v: 2, kind: 'SNAPSHOT', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a',
    revision: 2, headHash: 'a'.repeat(64), snapshot: initial
  });
  await settle();

  const next = structuredClone(initial);
  next.name = 'Accepted from another collaborator';
  channel.receive({
    v: 2, kind: 'ROOM_REVISION', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a',
    revision: 3, headHash: 'b'.repeat(64), snapshot: next
  });
  await settle();
  assert.equal(controller.state, 'connected');
  assert.equal(controller.revision, 3);
  assert.equal(controller.snapshot.name, next.name);
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots.map(item => item.source), ['initial', 'room-revision']);
  assert.equal(snapshots[1].revision, 3);
  assert.equal(saved.length, 0);
  controller.close();
});

test('guest serializes room-revision installation and forks instead of overwriting a dirty local edit', async () => {
  const channel = new FakeChannel();
  const snapshots = [];
  let releaseInstall;
  let fork;
  const initial = fakeDesign().document;
  const controller = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: channel, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => channel.close()
    }),
    persistFork: async value => { fork = value; return true; },
    onSnapshot: async (snapshot, revision, _head, metadata) => {
      snapshots.push({ snapshot, revision, source: metadata?.source });
      if (metadata?.source === 'room-revision' && revision === 3) await new Promise(resolve => { releaseInstall = resolve; });
    }
  });
  await controller.ready;
  channel.receive(context('WELCOME', { actorId: 'host-a', hostActorId: 'host-a', revision: 2, headHash: 'a'.repeat(64) }));
  channel.receive({ ...context('SNAPSHOT', { actorId: 'host-a' }), revision: 2, headHash: 'a'.repeat(64), snapshot: initial });
  await settle();

  const revisionThree = structuredClone(initial);
  revisionThree.name = 'Revision three';
  channel.receive({ ...context('ROOM_REVISION', { actorId: 'host-a' }), revision: 3, headHash: 'b'.repeat(64), snapshot: revisionThree });
  await settle();
  assert.equal(typeof releaseInstall, 'function');
  const revisionFour = structuredClone(revisionThree);
  revisionFour.name = 'Revision four';
  channel.receive({ ...context('ROOM_REVISION', { actorId: 'host-a' }), revision: 4, headHash: 'c'.repeat(64), snapshot: revisionFour });
  await settle();
  assert.equal(controller.revision, 3, 'the next room revision waits for durable installation of the previous one');
  assert.deepEqual(snapshots.map(item => item.revision), [2, 3]);
  releaseInstall();
  await settle();
  assert.equal(controller.revision, 4);
  assert.deepEqual(snapshots.map(item => item.revision), [2, 3, 4]);

  controller.markLocalEditsPending();
  const revisionFive = structuredClone(revisionFour);
  revisionFive.name = 'Revision five';
  channel.receive({ ...context('ROOM_REVISION', { actorId: 'host-a' }), revision: 5, headHash: 'd'.repeat(64), snapshot: revisionFive });
  await settle();
  assert.equal(controller.state, 'fork-saved');
  assert.equal(controller.revision, 4);
  assert.equal(fork.reason.detail.reason, 'LOCAL_EDITS_PENDING');
});

test('guest refuses a room revision that references an image the host has not transferred', async () => {
  const channel = new FakeChannel();
  const initial = fakeDesign().document;
  let fork;
  const controller = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: channel, session: { sessionId: 'session-a' },
      waitForOpen: async () => true, close: () => channel.close()
    }),
    persistFork: async value => { fork = value; return true; }
  });
  await controller.ready;
  channel.receive(context('WELCOME', { actorId: 'host-a', hostActorId: 'host-a', revision: 2, headHash: 'a'.repeat(64) }));
  channel.receive({
    v: 2, kind: 'SNAPSHOT', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a',
    revision: 2, headHash: 'a'.repeat(64), snapshot: initial
  });
  await settle();
  const invalid = structuredClone(initial);
  addNode(invalid, createNode('image', { id: 'missing-image-node', assetId: 'missing-image' }));
  channel.receive({
    v: 2, kind: 'ROOM_REVISION', designId: 'design-a', sessionId: 'session-a', actorId: 'host-a',
    revision: 3, headHash: 'b'.repeat(64), snapshot: invalid
  });
  await settle();
  assert.equal(controller.state, 'fork-saved');
  assert.equal(controller.revision, 2);
  assert.equal(fork.snapshot.pages[0].children.length, initial.pages[0].children.length);
  controller.close();
});

test('live sessions transfer referenced images before the snapshot and persist guest assets before accepting edits', { timeout: 15_000 }, async t => {
  function sessionEvent(label) {
    let signal;
    const promise = new Promise(resolve => { signal = resolve; });
    return {
      signal,
      async wait() {
        let timer;
        try {
          return await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 5_000);
            })
          ]);
        } finally { clearTimeout(timer); }
      }
    };
  }
  const guestAssetSaveStarted = sessionEvent('guest image persistence to start');
  const initialSnapshotAccepted = sessionEvent('the initial guest snapshot');
  const hostAssetStoreStarted = sessionEvent('host image persistence to start');
  const liveViewStateReceived = sessionEvent('the host view update during image persistence');
  const editAcknowledged = sessionEvent('the persisted edit acknowledgement');
  const hostChannel = new FakeChannel();
  const hostAssetChannel = new FakeChannel();
  const guestChannel = new FakeChannel();
  const guestAssetChannel = new FakeChannel();
  hostChannel.peer = guestChannel;
  guestChannel.peer = hostChannel;
  hostAssetChannel.peer = guestAssetChannel;
  guestAssetChannel.peer = hostAssetChannel;
  const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const uploadedBytes = Uint8Array.from([0, 1, 0, 0, 4, 3, 2, 1, 8, 7, 6, 5]);
  const source = fakeDesign();
  addNode(source.document, createNode('image', { assetId: 'host-image', fileName: 'source.png' }));
  const transfers = [];
  const commits = [];
  let finishHostAssetStore;
  const hostAssetStore = new Promise(resolve => { finishHostAssetStore = resolve; });
  let finishGuestAssetSave;
  const guestAssetSave = new Promise(resolve => { finishGuestAssetSave = resolve; });
  let host;
  let guest;
  let upload;
  t.after(async () => {
    finishGuestAssetSave();
    finishHostAssetStore();
    host?.controller.close();
    guest?.close();
    for (const channel of [hostChannel, hostAssetChannel, guestChannel, guestAssetChannel]) channel.close();
    await upload?.catch(() => {});
  }, { timeout: 5_000 });
  host = await hostFixture({
    open: async () => source,
    createTransport: async () => ({
      offerCapsule: 'offer-a', dataChannel: hostChannel, assetDataChannel: hostAssetChannel, session: { sessionId: 'session-a' },
      acceptAnswer: async () => {}, waitForOpen: async () => true,
      close: () => { hostChannel.close(); hostAssetChannel.close(); }
    }),
    readImage: async () => ({ metadata: { mimeType: 'image/png' }, bytes: imageBytes.slice() }),
    approveIncomingAsset: async () => true,
    acceptImage: async (_workspace, _designId, assetId, bytes, options) => {
      hostAssetStoreStarted.signal();
      await hostAssetStore;
      transfers.push({ direction: 'guest-to-host', assetId, bytes: bytes.slice(), mimeType: options.mimeType });
    },
    commit: async (_workspace, _designId, snapshot, options) => {
      commits.push(structuredClone(snapshot));
      const saved = { ...source, document: structuredClone(snapshot), head: { sequence: options.expectedHead.sequence + 1, commitHash: 'c'.repeat(64) } };
      return saved;
    }
  });
  const received = [];
  const liveViewStates = [];
  guest = await createGuestSessionController({
    expectedInvite: { designId: 'design-a' }, offerCapsule: 'offer-a',
    createTransport: async () => ({
      answerCapsule: 'answer-a', dataChannel: guestChannel, assetDataChannel: guestAssetChannel, session: { sessionId: 'session-a' },
      waitForOpen: async () => true,
      close: () => { guestChannel.close(); guestAssetChannel.close(); }
    }),
    onAsset: async asset => {
      received.push({ assetId: asset.assetId, assetKind: asset.assetKind, bytes: asset.bytes.slice() });
      guestAssetSaveStarted.signal();
      await guestAssetSave;
    },
    approveIncomingAsset: async () => true,
    onSnapshot: (_snapshot, revision, _head, metadata) => {
      if (metadata?.source === 'initial') initialSnapshotAccepted.signal();
      if (metadata?.source === 'ack' && revision === 3) editAcknowledged.signal();
    },
    onViewState: view => {
      liveViewStates.push(view);
      if (view.zoom === 1.5) liveViewStateReceived.signal();
    },
    persistFork: async () => true
  });
  await guest.ready;
  await guestAssetSaveStarted.wait();
  assert.deepEqual(received.map(asset => asset.assetId), ['host-image']);
  assert.equal(guest.snapshot, null, 'the initial control snapshot waits for durable asset storage acknowledgement');
  finishGuestAssetSave();
  await initialSnapshotAccepted.wait();
  assert.equal(guest.state, 'connected');
  assert.deepEqual(received.map(asset => asset.assetId), ['host-image']);
  assert.deepEqual(received[0].bytes, imageBytes);

  upload = guest.sendAsset({ assetId: 'guest-image', assetKind: 'image', mimeType: 'image/png', bytes: uploadedBytes });
  // Keep a failure handled while the persistence-start event is still pending.
  // The awaited upload below still propagates that failure to this test.
  upload.catch(() => {});
  await hostAssetStoreStarted.wait();
  assert.equal(host.controller.publishViewState({ pageId: source.document.pages[0].id, zoom: 1.5, centerX: 80, centerY: 60 }), true);
  await liveViewStateReceived.wait();
  assert.equal(liveViewStates.at(-1)?.zoom, 1.5, 'control updates remain responsive while asset persistence is pending');
  assert.equal(transfers.length, 0, 'the view update arrives while host asset persistence is still blocked');
  assert.equal(commits.length, 0, 'no design edit is persisted before the incoming image');
  finishHostAssetStore();
  await upload;
  const changed = guest.snapshot;
  addNode(changed, createNode('image', { assetId: 'guest-image', fileName: 'guest.png' }));
  guest.proposeSnapshot(changed);
  await editAcknowledged.wait();
  assert.deepEqual(transfers, [{ direction: 'guest-to-host', assetId: 'guest-image', bytes: uploadedBytes, mimeType: 'image/png' }]);
  assert.equal(commits.length, 1, 'the design operation follows durable host asset registration acknowledged across channels');
  assert.equal(guest.revision, 3);
  assert.deepEqual(
    guestAssetChannel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'guest-to-host' }).kind).filter(kind => kind === 'ASSET_BARRIER'),
    ['ASSET_BARRIER']
  );
  assert.ok(hostChannel.sent.map(raw => decodeCollaborationMessage(raw, { direction: 'host-to-guest' }))
    .some(message => message.kind === 'ASSET_BARRIER_ACK'));
});
