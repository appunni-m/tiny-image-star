import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuestForkRecovery, GuestForkRecoveryError } from '../src/collaboration/guest-fork-recovery.js';

const designId = 'design-1';
const sessionId = 'session-1';
const initialSnapshot = { pages: [{ id: 'page-1', nodes: [{ id: 'node-1', text: 'start' }] }] };
const initialHead = { commitHash: 'a'.repeat(64), sequence: 4 };

function operation(opId = 'op-1', baseRevision = 4, text = 'pending') {
  return { type: 'ReplaceText', opId, baseRevision, pageId: 'page-1', nodeId: 'node-1', text };
}

function ack(opId, revision) {
  return { v: 2, kind: 'ACK', designId, sessionId, actorId: 'host', opId, revision, headHash: 'b'.repeat(64) };
}

function reject(opId = 'op-1', code = 'STALE_REVISION', revision = 5) {
  return { v: 2, kind: 'REJECT', designId, sessionId, actorId: 'host', opId, revision, code, headHash: 'c'.repeat(64) };
}

function createHarness({ persistFork = async payload => ({ persisted: true, id: payload.forkId }), closeSession = async () => {} } = {}) {
  return createGuestForkRecovery({
    designId,
    sessionId,
    hostHead: initialHead,
    hostRevision: 4,
    initialReplicaSnapshot: initialSnapshot,
    persistFork,
    closeSession
  });
}

test('ACK requires a verified result, then advances snapshot/revision and removes exactly the oldest op', () => {
  const recovery = createHarness();
  recovery.propose(operation('op-1', 4));
  recovery.propose(operation('op-2', 5, 'next'));

  const withoutResult = recovery.acknowledge(ack('op-1', 5));
  assert.equal(withoutResult.accepted, false);
  assert.equal(withoutResult.reason, 'RESULT_REQUIRED');
  assert.equal(recovery.state.acknowledgedRevision, 4);
  assert.equal(recovery.state.pendingOperations.length, 2);

  const confirmed = { pages: [{ id: 'page-1', nodes: [{ id: 'node-1', text: 'confirmed' }] }] };
  const result = recovery.acknowledge(ack('op-1', 5), {
    result: { snapshot: confirmed, revision: 5, head: { commitHash: 'b'.repeat(64), sequence: 5 } }
  });
  assert.equal(result.accepted, true);
  assert.equal(recovery.state.acknowledgedRevision, 5);
  assert.equal(recovery.state.hostHead.commitHash, 'b'.repeat(64));
  assert.deepEqual(recovery.state.acknowledgedSnapshot, confirmed);
  assert.deepEqual(recovery.state.pendingOperations.map(item => item.opId), ['op-2']);
  assert.equal(recovery.state.canPropose, true);
});

test('room revisions advance an idle replica and refuse to overwrite any pending guest work', () => {
  const recovery = createHarness();
  const nextSnapshot = { pages: [{ id: 'page-1', nodes: [{ id: 'node-1', text: 'from another guest' }] }] };
  const update = {
    v: 2, kind: 'ROOM_REVISION', designId, sessionId, actorId: 'host',
    revision: 5, headHash: 'b'.repeat(64), snapshot: nextSnapshot
  };
  const adopted = recovery.adoptRoomRevision(update);
  assert.equal(adopted.accepted, true);
  assert.equal(adopted.state.acknowledgedRevision, 5);
  assert.deepEqual(adopted.state.acknowledgedSnapshot, nextSnapshot);
  assert.deepEqual(adopted.state.hostHead, { sequence: 5, commitHash: 'b'.repeat(64) });
  assert.throws(() => recovery.adoptRoomRevision({ ...update, revision: 7 }), { code: 'ROOM_REVISION_ORDER' });

  recovery.propose(operation('op-local', 5));
  const pendingUpdate = {
    ...update, revision: 6, headHash: 'c'.repeat(64),
    snapshot: { pages: [{ id: 'page-1', nodes: [{ id: 'node-1', text: 'another host edit' }] }] }
  };
  const refused = recovery.adoptRoomRevision(pendingUpdate);
  assert.equal(refused.accepted, false);
  assert.equal(refused.reason, 'PENDING_OPERATIONS');
  assert.equal(recovery.state.acknowledgedRevision, 5);
  assert.equal(recovery.state.pendingOperations[0].opId, 'op-local');
});

test('room revisions refuse dirty local edits and ACKs clear only the edit generation they cover', () => {
  const recovery = createHarness();
  const update = {
    v: 2, kind: 'ROOM_REVISION', designId, sessionId, actorId: 'host',
    revision: 5, headHash: 'b'.repeat(64), snapshot: initialSnapshot
  };
  assert.equal(recovery.markLocalEditsPending(), true);
  assert.equal(recovery.state.localChangesPending, true);
  const refused = recovery.adoptRoomRevision(update);
  assert.equal(refused.accepted, false);
  assert.equal(refused.reason, 'LOCAL_EDITS_PENDING');
  assert.equal(recovery.state.acknowledgedRevision, 4);

  recovery.propose(operation('op-local', 4));
  recovery.markLocalEditsPending();
  assert.equal(recovery.acknowledge(ack('op-local', 5), {
    snapshot: initialSnapshot, revision: 5, head: { sequence: 5, commitHash: 'b'.repeat(64) }
  }).accepted, true);
  assert.equal(recovery.state.localChangesPending, true, 'an edit after the proposal remains pending after its older ACK');
  recovery.propose(operation('op-newer', 5));
  assert.equal(recovery.acknowledge({ ...ack('op-newer', 6), headHash: 'c'.repeat(64) }, {
    snapshot: initialSnapshot, revision: 6, head: { sequence: 6, commitHash: 'c'.repeat(64) }
  }).accepted, true);
  assert.equal(recovery.state.localChangesPending, false);
});

test('disconnect freezes proposals and persists a fork from the last verified snapshot plus pending ops', async () => {
  const order = [];
  let saved;
  const recovery = createHarness({
    closeSession: async () => { order.push('closed'); },
    persistFork: async payload => { order.push('persisted'); saved = payload; }
  });
  recovery.propose(operation());
  const statePromise = recovery.disconnect('detached');
  assert.equal(recovery.state.canPropose, false, 'freeze is synchronous');
  assert.throws(() => recovery.propose(operation('op-2', 5)), { code: 'SESSION_FROZEN' });
  const result = await statePromise;

  assert.deepEqual(order, ['closed', 'persisted']);
  assert.equal(result.status, 'fork-saved');
  assert.equal(result.saved, true);
  assert.equal(saved.source.designId, designId);
  assert.equal(saved.source.sessionId, sessionId);
  assert.equal(saved.source.hostRevision, 4);
  assert.deepEqual(saved.source.hostHead, initialHead);
  assert.deepEqual(saved.snapshot, initialSnapshot);
  assert.deepEqual(saved.pendingOperationIds, ['op-1']);
  assert.deepEqual(saved.pendingOperations, [operation()]);
  assert.equal(saved.reason.reason, 'detached');
});

test('stale rejection freezes and forks; duplicate disconnect/reject events share one persistence attempt', async () => {
  let resolveSave;
  const payloads = [];
  const closed = [];
  const recovery = createHarness({
    closeSession: async event => closed.push(event),
    persistFork: payload => {
      payloads.push(payload);
      return new Promise(resolve => { resolveSave = resolve; });
    }
  });
  recovery.propose(operation());
  const saving = recovery.reject(reject());
  assert.equal(recovery.state.status, 'saving-fork');
  assert.equal(recovery.state.canPropose, false);
  const duplicateReject = recovery.reject(reject('other-op', 'CONFLICT', 4));
  const duplicateDisconnect = recovery.disconnect('transport-lost');
  assert.equal(payloads.length, 0, 'save waits for close callback');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(payloads.length, 1);
  resolveSave({ ok: true });
  const [first, second, third] = await Promise.all([saving, duplicateReject, duplicateDisconnect]);
  assert.equal(first.status, 'fork-saved');
  assert.equal(second.status, 'fork-saved');
  assert.equal(third.status, 'fork-saved');
  assert.equal(closed.length, 1);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].reason.code, 'STALE_REVISION');
});

test('save failure keeps the full frozen fork in memory and explicit retry uses the same fork ID', async () => {
  const calls = [];
  const recovery = createHarness({
    persistFork: async payload => {
      calls.push(payload);
      if (calls.length === 1) throw new Error('quota full');
      return { saved: true };
    }
  });
  recovery.propose(operation());
  const failed = await recovery.disconnect('network gone');
  assert.equal(failed.status, 'fork-unsaved');
  assert.equal(failed.blocked, true);
  assert.equal(failed.saved, false);
  assert.equal(failed.saveError, 'quota full');
  assert.equal(failed.canPropose, false);
  assert.deepEqual(failed.pendingOperations, [operation()]);
  assert.throws(() => recovery.propose(operation('later', 5)), { code: 'SESSION_FROZEN' });

  const repeatedEvent = await recovery.disconnect('network gone again');
  assert.equal(repeatedEvent.status, 'fork-unsaved');
  assert.equal(calls.length, 1, 'events do not silently trigger repeated saves');
  const retried = await recovery.retrySave();
  assert.equal(retried.status, 'fork-saved');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].forkId, calls[1].forkId);
  assert.deepEqual(calls[0], calls[1]);
});

test('a close callback failure does not prevent the local fork save and is surfaced', async () => {
  let persisted = 0;
  const recovery = createHarness({
    closeSession: async () => { throw new Error('transport already gone'); },
    persistFork: async () => { persisted += 1; }
  });
  const result = await recovery.disconnect();
  assert.equal(result.status, 'fork-saved');
  assert.equal(result.closeError, 'transport already gone');
  assert.equal(persisted, 1);
});

test('pending operation count and bytes are bounded before accepting new work', () => {
  const recovery = createGuestForkRecovery({
    designId, sessionId, hostHead: initialHead, hostRevision: 4,
    initialReplicaSnapshot: initialSnapshot,
    maxPendingOperations: 1,
    maxPendingBytes: 300,
    persistFork: async () => {}, closeSession: async () => {}
  });
  recovery.propose(operation());
  assert.throws(() => recovery.propose(operation('op-2', 5)), { code: 'PENDING_LIMIT' });
  assert.throws(() => recovery.propose(operation('op-1', 5)), { code: 'DUPLICATE_OPERATION' });

  const byteLimited = createGuestForkRecovery({
    designId, sessionId: 'session-2', hostHead: initialHead, hostRevision: 4,
    initialReplicaSnapshot: initialSnapshot,
    maxPendingOperations: 5,
    maxPendingBytes: 1,
    persistFork: async () => {}, closeSession: async () => {}
  });
  assert.throws(() => byteLimited.propose(operation()), { code: 'PENDING_LIMIT' });
  assert.equal(byteLimited.state.pendingOperations.length, 0);
});

test('snapshot and operation inputs, returned state, and callback payload are defensively copied', async () => {
  const source = structuredClone(initialSnapshot);
  let persisted;
  const recovery = createGuestForkRecovery({
    designId, sessionId: 'session-3', hostHead: initialHead, hostRevision: 4,
    initialReplicaSnapshot: source,
    persistFork: async payload => { persisted = payload; payload.snapshot.pages[0].nodes[0].text = 'mutated by callback'; },
    closeSession: async () => {}
  });
  source.pages[0].nodes[0].text = 'mutated by caller';
  const input = operation();
  recovery.propose(input);
  input.text = 'caller changed pending op';
  const exposed = recovery.state;
  exposed.acknowledgedSnapshot.pages[0].nodes[0].text = 'state mutated';
  exposed.pendingOperations[0].text = 'state mutated op';
  await recovery.disconnect('offline');

  assert.equal(recovery.state.acknowledgedSnapshot.pages[0].nodes[0].text, 'start');
  assert.equal(recovery.state.pendingOperations[0].text, 'pending');
  // The persistence callback receives its own payload copy; its mutation cannot
  // alter the retained in-memory fork used for state reporting or retry.
  assert.equal(recovery.state.status, 'fork-saved');
  assert.equal(persisted.snapshot.pages[0].nodes[0].text, 'mutated by callback');
});

test('invalid protocol operations and malformed host messages are rejected without losing pending work', () => {
  const recovery = createHarness();
  assert.throws(() => recovery.propose({ ...operation(), pageId: 'bad id' }), /Page ID is invalid/);
  recovery.propose(operation());
  assert.throws(() => recovery.acknowledge({ ...ack('op-1', 5), extra: true }, { snapshot: initialSnapshot }), /missing or unknown fields/);
  assert.equal(recovery.state.pendingOperations.length, 1);
  assert.equal(recovery.state.acknowledgedRevision, 4);
});
