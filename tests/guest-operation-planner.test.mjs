import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, findNode, moveNode, parseDocument, removeNode, updateNode, validateDocument } from '../src/model.js';
import { createHostOperationEngine } from '../src/collaboration/host-operation-engine.js';
import { planGuestOperationSnapshots } from '../src/collaboration/guest-operation-planner.js';
import { validateCollaborationMessage } from '../src/collaboration/protocol.js';

function fixture() {
  const document = createDocument();
  const pageId = document.pages[0].id;
  const frame = createNode('frame', { id: 'frame-a', children: [] });
  const text = createNode('text', { id: 'text-a', text: 'Before' });
  const rectangle = createNode('rectangle', { id: 'rectangle-a', x: 12 });
  const sibling = createNode('ellipse', { id: 'ellipse-a' });
  addNode(document, frame, { pageId });
  addNode(document, text, { pageId, parentId: frame.id });
  addNode(document, rectangle, { pageId });
  addNode(document, sibling, { pageId });
  validateDocument(document);
  return { document, pageId };
}

async function assertPlanMatchesHost(before, after, expectedTypes) {
  const plan = planGuestOperationSnapshots(before, after);
  assert.ok(Array.isArray(plan) && plan.length > 0, 'a supported edit should produce an operation plan');
  assert.deepEqual(plan.map(entry => entry.operation.type), expectedTypes);

  const committed = [];
  const canonicalBefore = parseDocument(JSON.parse(JSON.stringify(before)));
  const engine = createHostOperationEngine({
    designId: canonicalBefore.id,
    sessionId: 'session-a',
    hostActorId: 'host-a',
    guestActorIds: ['guest-a'],
    snapshot: canonicalBefore,
    revision: 0,
    headHash: 'a'.repeat(64),
    commit: async input => {
      committed.push(structuredClone(input));
      return { headHash: input.revision.toString(16).padStart(64, '0') };
    }
  });

  for (let index = 0; index < plan.length; index += 1) {
    const { operation, snapshot } = plan[index];
    const message = {
      v: 2, kind: 'OPERATION', designId: canonicalBefore.id,
      sessionId: 'session-a', actorId: 'guest-a',
      operation: { ...operation, opId: `guest-op-${index + 1}`, baseRevision: index }
    };
    assert.deepEqual(validateCollaborationMessage(message, { direction: 'guest-to-host' }), message);
    const result = await engine.apply(message);
    assert.equal(result.kind, 'ACK', JSON.stringify(result));
    assert.deepEqual(engine.getSnapshot(), snapshot, `planner snapshot after operation ${index + 1}`);
    assert.deepEqual(committed[index].snapshot, snapshot, `durable host snapshot after operation ${index + 1}`);
  }

  const canonicalAfter = parseDocument(JSON.parse(JSON.stringify(after)));
  assert.deepEqual(engine.getSnapshot(), canonicalAfter);
  assert.deepEqual(plan.at(-1).snapshot, canonicalAfter);
  return plan;
}

test('plans a subtree deletion as one host DeleteNode with an exact ACK snapshot', async () => {
  const { document, pageId } = fixture();
  const after = structuredClone(document);
  assert.ok(removeNode(after, 'frame-a', pageId));
  validateDocument(after);

  const plan = await assertPlanMatchesHost(document, after, ['DeleteNode']);
  assert.equal(plan[0].operation.nodeId, 'frame-a');
});

test('plans insertion of a complete new subtree atomically', async () => {
  const { document, pageId } = fixture();
  const after = structuredClone(document);
  const frame = createNode('frame', {
    id: 'frame-new',
    children: [createNode('text', { id: 'text-new', text: 'Added' })]
  });
  addNode(after, frame, { pageId, index: 1 });
  validateDocument(after);

  const plan = await assertPlanMatchesHost(document, after, ['InsertNode']);
  assert.equal(plan[0].operation.nodeId, 'frame-new');
  assert.deepEqual(plan[0].operation.node.children.map(node => node.id), ['text-new']);
});

test('plans a cross-container move and preserves the target hierarchy and order', async () => {
  const { document, pageId } = fixture();
  const after = structuredClone(document);
  assert.equal(moveNode(after, 'rectangle-a', { pageId, parentId: 'frame-a', index: 1 }), true);
  validateDocument(after);

  await assertPlanMatchesHost(document, after, ['MoveNode']);
});

test('moves surviving descendants out before deleting their old ancestor', async () => {
  const { document, pageId } = fixture();
  const destination = createNode('frame', { id: 'frame-b', children: [] });
  addNode(document, destination, { pageId });
  const after = structuredClone(document);
  assert.equal(moveNode(after, 'text-a', { pageId, parentId: 'frame-b', index: 0 }), true);
  assert.ok(removeNode(after, 'frame-a', pageId));
  validateDocument(after);

  const plan = await assertPlanMatchesHost(document, after, ['MoveNode', 'DeleteNode', 'MoveNode']);
  assert.equal(plan[0].operation.nodeId, 'text-a');
  assert.equal(plan[0].operation.parentId, null, 'lift the child out of the doomed subtree first');
  assert.equal(plan[1].operation.nodeId, 'frame-a');
  assert.equal(plan[2].operation.parentId, 'frame-b');
});

test('inserts a destination parent before moving an existing layer into it', async () => {
  const { document, pageId } = fixture();
  const after = structuredClone(document);
  addNode(after, createNode('frame', { id: 'frame-new', children: [] }), { pageId, index: 1 });
  assert.equal(moveNode(after, 'rectangle-a', { pageId, parentId: 'frame-new', index: 0 }), true);
  validateDocument(after);

  const plan = await assertPlanMatchesHost(document, after, ['InsertNode', 'MoveNode']);
  assert.equal(plan[0].operation.nodeId, 'frame-new');
  assert.equal(plan[1].operation.nodeId, 'rectangle-a');
  assert.equal(plan[1].operation.parentId, 'frame-new');
});

test('plans supported text replacement and property changes in deterministic order', async () => {
  const { document, pageId } = fixture();
  const after = structuredClone(document);
  updateNode(after, 'text-a', { text: 'After', fontSize: 23 }, pageId);
  findNode(after, 'rectangle-a', pageId).node.opacity = 0.5;
  validateDocument(after);

  const plan = await assertPlanMatchesHost(document, after, ['SetProperty', 'ReplaceText', 'SetProperty']);
  assert.deepEqual(plan.map(entry => entry.operation.property), ['opacity', undefined, 'fontSize']);
});

test('plans fixed-position scroll behavior as a validated collaborative property edit', async () => {
  const { document, pageId } = fixture();
  const after = structuredClone(document);
  findNode(after, 'rectangle-a', pageId).node.fixedPositionWhenScrolling = true;
  validateDocument(after);

  const plan = await assertPlanMatchesHost(document, after, ['SetProperty']);
  assert.equal(plan[0].operation.targetId, 'rectangle-a');
  assert.equal(plan[0].operation.property, 'fixedPositionWhenScrolling');
  assert.equal(plan[0].operation.value, true);
});

test('plans text truncation properties in host-valid order and supports clearing the line limit', async () => {
  const { document, pageId } = fixture();
  const ending = structuredClone(document);
  updateNode(ending, 'text-a', { textTruncation: 'ending', maxLines: 2 }, pageId);
  validateDocument(ending);
  const activate = await assertPlanMatchesHost(document, ending, ['SetProperty', 'SetProperty']);
  assert.deepEqual(activate.map(entry => entry.operation.property), ['textTruncation', 'maxLines'],
    'ending mode must become durable before the positive maxLines value is sent');

  const disabled = structuredClone(ending);
  updateNode(disabled, 'text-a', { maxLines: null, textTruncation: 'disabled' }, pageId);
  validateDocument(disabled);
  const clear = await assertPlanMatchesHost(ending, disabled, ['SetProperty', 'SetProperty']);
  assert.deepEqual(clear.map(entry => entry.operation.property), ['maxLines', 'textTruncation'],
    'the line limit must be cleared before disabling ending truncation');
});

test('plans multiple independent deletions in a stable order and records each intermediate snapshot', async () => {
  const { document, pageId } = fixture();
  const after = structuredClone(document);
  removeNode(after, 'rectangle-a', pageId);
  removeNode(after, 'ellipse-a', pageId);
  validateDocument(after);

  const plan = await assertPlanMatchesHost(document, after, ['DeleteNode', 'DeleteNode']);
  assert.notDeepEqual(plan[0].snapshot, plan[1].snapshot);
  assert.deepEqual(plan.map(entry => entry.operation.nodeId), ['ellipse-a', 'rectangle-a']);
});

test('an unchanged design returns an empty plan without creating a fake edit', () => {
  const { document } = fixture();
  assert.deepEqual(planGuestOperationSnapshots(document, structuredClone(document)), []);
});

test('returns null for document-level changes, property removals, and mixed page relocation', () => {
  const { document, pageId } = fixture();

  const rename = structuredClone(document);
  rename.name = 'Another title';
  assert.equal(planGuestOperationSnapshots(document, rename), null);

  const removeUnsupported = structuredClone(document);
  findNode(removeUnsupported, 'rectangle-a', pageId).node.unmodeledExtension = 'before';
  const withExtension = structuredClone(removeUnsupported);
  delete findNode(withExtension, 'rectangle-a', pageId).node.unmodeledExtension;
  assert.equal(planGuestOperationSnapshots(removeUnsupported, withExtension), null);

  const anotherPage = structuredClone(document);
  const pageB = structuredClone(document.pages[0]);
  pageB.id = 'page-b';
  pageB.name = 'Page 2';
  anotherPage.pages.push(pageB);
  const movedAcrossPages = structuredClone(anotherPage);
  const rectangle = removeNode(movedAcrossPages, 'rectangle-a', pageId);
  addNode(movedAcrossPages, rectangle, { pageId: 'page-b' });
  assert.equal(planGuestOperationSnapshots(anotherPage, movedAcrossPages), null);
});

test('returns null for edits that need unsupported property deletion or schema-invalid intermediate states', () => {
  const { document, pageId } = fixture();
  const after = structuredClone(document);
  delete findNode(after, 'rectangle-a', pageId).node.name;
  assert.equal(planGuestOperationSnapshots(document, after), null);

  const invalidTransition = structuredClone(document);
  findNode(invalidTransition, 'rectangle-a', pageId).node.opacity = 4;
  assert.equal(planGuestOperationSnapshots(document, invalidTransition), null);
});
