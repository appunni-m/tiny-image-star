import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, validateDocument } from '../src/model.js';
import { applyHostTypedOperation, createHostOperationEngine } from '../src/collaboration/host-operation-engine.js';

function fixture() {
  const document = createDocument();
  const pageId = document.pages[0].id;
  const frame = createNode('frame', { id: 'frame-a', name: 'Frame', children: [] });
  const text = createNode('text', { id: 'text-a', text: 'Before' });
  const rectangle = createNode('rectangle', { id: 'rectangle-a' });
  addNode(document, frame, { pageId });
  addNode(document, text, { pageId, parentId: frame.id });
  addNode(document, rectangle, { pageId });
  validateDocument(document);
  return { document, pageId };
}

function setup({ snapshot = fixture().document, revision = 0, commit = async () => {}, headHash = 'a'.repeat(64) } = {}) {
  return createHostOperationEngine({
    designId: snapshot.id,
    sessionId: 'session-a',
    hostActorId: 'host-a',
    guestActorIds: ['guest-a', 'guest-b'],
    snapshot,
    revision,
    headHash,
    commit: async input => {
      const result = await commit(input);
      return result?.head || result?.headHash
        ? result
        : { headHash: input.revision.toString(16).padStart(64, '0') };
    }
  });
}

function request(engine, operation, context = {}) {
  const snapshot = engine.getSnapshot();
  const pageId = snapshot.pages[0].id;
  const operationHasPage = ['SetProperty', 'InsertNode', 'DeleteNode', 'MoveNode', 'ReplaceText'].includes(operation.type);
  return engine.apply({
    v: 1,
    kind: 'OPERATION',
    designId: snapshot.id,
    sessionId: 'session-a',
    actorId: 'guest-a',
    ...context,
    operation: {
      baseRevision: engine.getRevision(),
      ...operation,
      ...(operationHasPage ? { pageId: operation.pageId ?? pageId } : {})
    }
  });
}

test('local typed-operation projection uses the exact host reducer without mutating its base', () => {
  const { document, pageId } = fixture();
  const changed = applyHostTypedOperation(document, {
    type: 'SetProperty', opId: 'local-op', baseRevision: 0,
    pageId, targetId: 'rectangle-a', property: 'x', value: 72
  });

  assert.notEqual(changed, document);
  assert.equal(changed.pages[0].children.find(node => node.id === 'rectangle-a').x, 72);
  assert.equal(document.pages[0].children.find(node => node.id === 'rectangle-a').x, 0,
    'planning an expected ACK snapshot must not mutate the guest document');
  assert.throws(() => applyHostTypedOperation(document, {
    type: 'SetProperty', opId: 'local-bad-op', baseRevision: 0,
    pageId, targetId: 'rectangle-a', property: 'children.0.id', value: 'injected'
  }));
  assert.throws(() => applyHostTypedOperation(document, {
    type: 'ReplaceSnapshot', opId: 'local-snapshot-op', baseRevision: 0,
    snapshot: document
  }), /typed collaboration operation/);
  assert.equal(document.pages[0].children.find(node => node.id === 'rectangle-a').x, 0);
});

test('applies all typed node operations on a validated candidate', async () => {
  const { document, pageId } = fixture();
  const engine = setup({ snapshot: document });
  let result = await request(engine, { type: 'SetProperty', opId: 'op-set', targetId: 'rectangle-a', property: 'x', value: 24 });
  assert.equal(result.kind, 'ACK');
  assert.equal(engine.getSnapshot().pages[0].children.find(node => node.id === 'rectangle-a').x, 24);

  const inserted = createNode('ellipse', { id: 'ellipse-a', name: 'Inserted' });
  result = await request(engine, { type: 'InsertNode', opId: 'op-insert', pageId, nodeId: inserted.id, parentId: 'frame-a', index: 1, node: inserted });
  assert.equal(result.kind, 'ACK');
  assert.deepEqual(engine.getSnapshot().pages[0].children[0].children.map(node => node.id), ['text-a', 'ellipse-a']);

  result = await request(engine, { type: 'ReplaceText', opId: 'op-text', nodeId: 'text-a', text: 'After\nparagraph' });
  assert.equal(result.kind, 'ACK');
  assert.equal(engine.getSnapshot().pages[0].children[0].children[0].text, 'After\nparagraph');

  result = await request(engine, { type: 'MoveNode', opId: 'op-move', nodeId: 'ellipse-a', parentId: null, index: 2 });
  assert.equal(result.kind, 'ACK');
  assert.deepEqual(engine.getSnapshot().pages[0].children.map(node => node.id), ['frame-a', 'rectangle-a', 'ellipse-a']);

  result = await request(engine, { type: 'DeleteNode', opId: 'op-delete', nodeId: 'ellipse-a' });
  assert.equal(result.kind, 'ACK');
  assert.equal(engine.getSnapshot().pages[0].children.some(node => node.id === 'ellipse-a'), false);
  assert.equal(engine.getRevision(), 5);
});

test('ReplaceSnapshot carries any schema-valid editor mutation while preserving design identity', async () => {
  const { document } = fixture();
  let persisted = null;
  const engine = setup({ snapshot: document, commit: async value => { persisted = value; } });
  const replacement = JSON.parse(JSON.stringify(engine.getSnapshot()));
  replacement.name = 'Remote page rename';
  const result = await request(engine, { type: 'ReplaceSnapshot', opId: 'op-snapshot', snapshot: replacement });
  assert.equal(result.kind, 'ACK');
  assert.equal(engine.getRevision(), 1);
  assert.equal(engine.getSnapshot().name, 'Remote page rename');
  assert.deepEqual(persisted.snapshot, engine.getSnapshot());

  const foreign = JSON.parse(JSON.stringify(engine.getSnapshot()));
  foreign.id = 'another-design';
  const rejected = await request(engine, { type: 'ReplaceSnapshot', opId: 'op-foreign', snapshot: foreign });
  assert.equal(rejected.kind, 'REJECT');
  assert.equal(rejected.code, 'PERMISSION_DENIED');
  assert.equal(engine.getSnapshot().id, document.id);
});

test('a remote snapshot cannot erase the owner copy’s local fork provenance', async () => {
  const { document } = fixture();
  document.settings.collaborationSource = {
    designId: 'source-design', sessionId: 'source-session', sequence: 12,
    commitHash: 'b'.repeat(64), pendingOperationIds: []
  };
  const engine = setup({ snapshot: document });
  const replacement = JSON.parse(JSON.stringify(document));
  replacement.name = 'Edited by guest';
  delete replacement.settings.collaborationSource;
  const result = await request(engine, { type: 'ReplaceSnapshot', opId: 'preserve-source', snapshot: replacement });
  assert.equal(result.kind, 'ACK', JSON.stringify(result));
  assert.deepEqual(engine.getSnapshot().settings.collaborationSource, document.settings.collaborationSource);
});

test('asset operations edit only the manifest and refuse to remove referenced assets', async () => {
  const { document } = fixture();
  const engine = setup({ snapshot: document });
  const meta = { assetId: 'asset-a', mimeType: 'image/png', byteLength: 4, sha256: 'a'.repeat(64) };
  const added = await request(engine, { type: 'AddAsset', opId: 'op-add', ...meta });
  assert.equal(added.kind, 'ACK');
  assert.deepEqual(engine.getSnapshot().collaborationAssets, [meta]);

  const referencedSnapshot = engine.getSnapshot();
  referencedSnapshot.pages[0].children[0].assetId = meta.assetId;
  const referencedEngine = setup({ snapshot: referencedSnapshot, revision: 1 });
  const reject = await request(referencedEngine, { type: 'RemoveAsset', opId: 'op-remove', assetId: meta.assetId });
  assert.equal(reject.kind, 'REJECT');
  assert.equal(reject.code, 'CONFLICT');
  assert.deepEqual(referencedEngine.getSnapshot().collaborationAssets, [meta]);

  const removed = await request(engine, { type: 'RemoveAsset', opId: 'op-remove-free', assetId: meta.assetId });
  assert.equal(removed.kind, 'ACK');
  assert.deepEqual(engine.getSnapshot().collaborationAssets, []);
});

test('checks context, optimistic base revision, targeting, and field allowlist', async () => {
  const engine = setup();
  const contextReject = await request(engine, { type: 'DeleteNode', opId: 'wrong-context', nodeId: 'rectangle-a' }, { sessionId: 'another-session' });
  assert.equal(contextReject.kind, 'REJECT');
  assert.equal(contextReject.code, 'PERMISSION_DENIED');

  const stale = await engine.apply({
    v: 1, kind: 'OPERATION', designId: engine.getSnapshot().id, sessionId: 'session-a', actorId: 'guest-a',
    operation: { type: 'DeleteNode', opId: 'stale-op', baseRevision: 4, pageId: engine.getSnapshot().pages[0].id, nodeId: 'rectangle-a' }
  });
  assert.equal(stale.code, 'STALE_REVISION');

  const denied = await request(engine, { type: 'SetProperty', opId: 'denied-field', targetId: 'rectangle-a', property: 'children.0.id', value: 'owned' });
  assert.equal(denied.kind, 'REJECT');
  assert.equal(denied.code, 'UNSUPPORTED_OPERATION');
  assert.equal(engine.getSnapshot().pages[0].children.at(-1).id, 'rectangle-a');

  const missingPage = await request(engine, { type: 'DeleteNode', opId: 'wrong-page', pageId: 'page-other', nodeId: 'rectangle-a' });
  assert.equal(missingPage.kind, 'REJECT');
  assert.equal(engine.getRevision(), 0);
});

test('one sequencer admits independent guest sessions and rejects stale same-base edits without overwriting', async () => {
  const { document, pageId } = fixture();
  const commits = [];
  const engine = createHostOperationEngine({
    designId: document.id,
    sessionId: 'session-a',
    hostActorId: 'host-a',
    guestActorIds: ['guest-a'],
    snapshot: document,
    revision: 12,
    headHash: 'a'.repeat(64),
    commit: async input => {
      commits.push(input);
      return { headHash: String(input.revision).padStart(64, '0') };
    }
  });
  engine.registerGuestSession('guest-b', 'session-b');
  assert.equal(engine.getGuestSessionCount(), 2);

  const operation = (actorId, sessionId, opId, baseRevision, name) => engine.apply({
    v: 1, kind: 'OPERATION', designId: document.id, sessionId, actorId,
    operation: { type: 'SetProperty', opId, baseRevision, pageId, targetId: 'rectangle-a', property: 'name', value: name }
  });
  const simultaneous = await Promise.all([
    operation('guest-a', 'session-a', 'op-a', 12, 'First edit'),
    operation('guest-b', 'session-b', 'op-b', 12, 'Stale edit')
  ]);
  assert.deepEqual(simultaneous.map(result => result.kind), ['ACK', 'REJECT']);
  assert.equal(simultaneous[0].sessionId, 'session-a');
  assert.equal(simultaneous[1].sessionId, 'session-b');
  assert.equal(simultaneous[1].code, 'STALE_REVISION');
  assert.equal(engine.getSnapshot().pages[0].children.find(node => node.id === 'rectangle-a').name, 'First edit');
  assert.equal(engine.getRevision(), 13);
  assert.equal(commits.length, 1);

  const next = await operation('guest-b', 'session-b', 'op-c', 13, 'Second revision');
  assert.equal(next.kind, 'ACK');
  assert.equal(next.sessionId, 'session-b');
  assert.equal(engine.getRevision(), 14);
  assert.equal(commits.length, 2);
  assert.equal(engine.removeGuestSession('guest-b', 'session-b'), true);
  assert.equal(engine.getGuestSessionCount(), 1);
  const afterRemoval = await operation('guest-b', 'session-b', 'op-d', 14, 'Revoked guest');
  assert.equal(afterRemoval.kind, 'REJECT');
  assert.equal(afterRemoval.code, 'PERMISSION_DENIED');
});

test('rejects prototype paths and leaves the document unchanged', async () => {
  const engine = setup();
  const before = engine.getSnapshot();
  const operation = {
    type: 'SetProperty', opId: 'proto-op', baseRevision: 0, pageId: before.pages[0].id,
    targetId: 'rectangle-a', property: '__proto__.polluted', value: true
  };
  const result = await engine.apply({ v: 1, kind: 'OPERATION', designId: before.id, sessionId: 'session-a', actorId: 'guest-a', operation });
  assert.equal(result.kind, 'REJECT');
  assert.equal(Object.hasOwn({}, 'polluted'), false);
  assert.deepEqual(engine.getSnapshot(), before);
  assert.equal(engine.getRevision(), 0);
});

test('deduplicates exact operation IDs and rejects op ID reuse with another payload', async () => {
  let commits = 0;
  const engine = setup({ commit: async () => { commits += 1; } });
  const op = { type: 'SetProperty', opId: 'same-op', targetId: 'rectangle-a', property: 'x', value: 8 };
  const before = engine.getSnapshot();
  const exactMessage = {
    v: 1, kind: 'OPERATION', designId: before.id, sessionId: 'session-a', actorId: 'guest-a',
    operation: { ...op, baseRevision: 0, pageId: before.pages[0].id }
  };
  const first = await engine.apply(exactMessage);
  const replay = await engine.apply(exactMessage);
  assert.deepEqual(replay, first);
  assert.equal(commits, 1);
  assert.equal(engine.getRevision(), 1);

  const changed = await request(engine, { ...op, value: 9 });
  assert.equal(changed.kind, 'REJECT');
  assert.equal(changed.code, 'CONFLICT');
  assert.equal(engine.getSnapshot().pages[0].children.at(-1).x, 8);
  assert.equal(commits, 1);
});

test('bounds replay memory for large accepted snapshots and preserves retries until full', async () => {
  const { document, pageId } = fixture();
  for (let index = 0; index < 3; index += 1) {
    addNode(document, createNode('text', { id: `large-text-${index}`, text: 'x'.repeat(180_000) }), { pageId });
  }
  validateDocument(document);

  const engine = setup({ snapshot: document });
  const firstSnapshot = JSON.parse(JSON.stringify(document));
  firstSnapshot.name = 'large snapshot 0';
  const firstMessage = {
    v: 1,
    kind: 'OPERATION',
    designId: document.id,
    sessionId: 'session-a',
    actorId: 'guest-a',
    operation: {
      type: 'ReplaceSnapshot',
      opId: 'large-op-0',
      baseRevision: 0,
      snapshot: firstSnapshot
    }
  };
  const firstResult = await engine.apply(firstMessage);
  assert.equal(firstResult.kind, 'ACK', JSON.stringify(firstResult));

  let acceptedCount = 1;
  let fullResult;
  while (!fullResult) {
    const revision = engine.getRevision();
    const replacement = JSON.parse(JSON.stringify(document));
    replacement.name = `large snapshot ${acceptedCount}`;
    const result = await request(engine, {
      type: 'ReplaceSnapshot',
      opId: `large-op-${acceptedCount}`,
      snapshot: replacement
    });
    if (result.kind === 'REJECT') {
      fullResult = result;
    } else {
      acceptedCount += 1;
      assert.equal(result.revision, revision + 1);
    }
  }

  assert.equal(fullResult.code, 'LIMIT_EXCEEDED');
  assert.ok(acceptedCount > 1, 'the cache should accept multiple large operations');
  assert.ok(acceptedCount < 352, 'the byte cap should be reached before the count cap');
  const stats = engine.getReplayCacheStats();
  assert.equal(stats.entryCount, acceptedCount);
  assert.ok(stats.accountedBytes <= stats.maxBytes);
  assert.equal(stats.maxEntries, 352);

  assert.deepEqual(await engine.apply(firstMessage), firstResult);
  const reused = structuredClone(firstMessage);
  reused.operation.snapshot.name = 'changed payload';
  const conflict = await engine.apply(reused);
  assert.equal(conflict.kind, 'REJECT');
  assert.equal(conflict.code, 'CONFLICT');
  assert.equal(engine.getRevision(), acceptedCount);
});

test('serializes concurrent operations against one revision and accepts only one', async () => {
  let releaseCommit;
  const waiting = new Promise(resolve => { releaseCommit = resolve; });
  let commits = 0;
  const engine = setup({ commit: async () => { commits += 1; await waiting; } });
  const base = engine.getSnapshot();
  const makeMessage = (opId, x) => ({
    v: 1, kind: 'OPERATION', designId: base.id, sessionId: 'session-a', actorId: 'guest-a',
    operation: { type: 'SetProperty', opId, baseRevision: 0, pageId: base.pages[0].id, targetId: 'rectangle-a', property: 'x', value: x }
  });
  const first = engine.apply(makeMessage('parallel-a', 1));
  const second = engine.apply(makeMessage('parallel-b', 2));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commits, 1);
  releaseCommit();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.kind), ['ACK', 'REJECT']);
  assert.equal(results[1].code, 'STALE_REVISION');
  assert.equal(engine.getSnapshot().pages[0].children.at(-1).x, 1);
  assert.equal(engine.getRevision(), 1);
});

test('does not advance snapshot or revision and never ACKs if durable commit fails', async () => {
  const engine = setup({ commit: async () => { throw new Error('disk full'); } });
  const before = engine.getSnapshot();
  const response = await request(engine, { type: 'SetProperty', opId: 'write-failure', targetId: 'rectangle-a', property: 'x', value: 99 });
  assert.equal(response.kind, 'REJECT');
  assert.equal(response.code, 'CONFLICT');
  assert.equal(engine.getRevision(), 0);
  assert.deepEqual(engine.getSnapshot(), before);
});

test('durable commit finishes before engine returns ACK and advances head', async () => {
  const events = [];
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const engine = setup({ commit: async input => {
    events.push(['persist-start', input.revision, input.snapshot.pages[0].children.at(-1).x]);
    await wait;
    events.push(['persist-done', input.revision]);
  } });
  const pending = request(engine, { type: 'SetProperty', opId: 'write-before-ack', targetId: 'rectangle-a', property: 'x', value: 42 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [['persist-start', 1, 42]]);
  assert.equal(engine.getRevision(), 0);
  assert.equal(engine.getSnapshot().pages[0].children.at(-1).x, 0);
  release();
  const response = await pending;
  assert.deepEqual(events, [['persist-start', 1, 42], ['persist-done', 1]]);
  assert.equal(response.kind, 'ACK');
  assert.equal(engine.getRevision(), 1);
  assert.equal(engine.getSnapshot().pages[0].children.at(-1).x, 42);
});
