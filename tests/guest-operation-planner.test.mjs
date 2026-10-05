import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addNode, createDocument, createMaskGroup, createNode, findNode, moveNode, parseDocument, removeNode, updateNode, validateDocument } from '../src/model.js';
import { createHostOperationEngine } from '../src/collaboration/host-operation-engine.js';
import { planGuestOperationSnapshots } from '../src/collaboration/guest-operation-planner.js';
import { isCollaborationSetPropertyRoot } from '../src/collaboration/set-property-roots.js';
import { validateCollaborationMessage } from '../src/collaboration/protocol.js';
import { addStroke, createStroke, updateStroke } from '../src/strokes.js';

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

test('every literal inspector property root can be planned for a shared design', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const roots = new Set([...source.matchAll(/data-prop="([a-z][A-Za-z0-9]*)"/g)].map(match => match[1]));
  assert.deepEqual([...roots].filter(property => !isCollaborationSetPropertyRoot(property)), []);
  assert.equal(isCollaborationSetPropertyRoot('arcData'), true, 'ellipse geometry remains editable in host-authoritative sessions');
  assert.equal(isCollaborationSetPropertyRoot('textPosition'), true, 'semantic text position is an editable property root');
});

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

test('plans a text color edit through the same validated host property surface as Inspector controls', async () => {
  const { document, pageId } = fixture();
  const after = structuredClone(document);
  updateNode(after, 'text-a', { color: '#336699' }, pageId);
  const plan = await assertPlanMatchesHost(document, after, ['SetProperty']);
  assert.equal(plan[0].operation.property, 'color');
  assert.equal(plan[0].operation.value, '#336699');
});

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

test('plans optional inspector fields and newer editor properties through the host whitelist', async () => {
  const { document, pageId } = fixture();
  const maskGroup = createMaskGroup(document, ['rectangle-a', 'ellipse-a'], pageId, 'alpha');
  const image = createNode('image', {
    id: 'image-a', assetId: 'asset-image-a', width: 80, height: 60,
    sourceWidth: 640, sourceHeight: 480, fit: 'cover'
  });
  const star = createNode('star', { id: 'star-a', width: 100, height: 100 });
  addNode(document, image, { pageId });
  addNode(document, star, { pageId });
  validateDocument(document);

  const after = structuredClone(document);
  findNode(after, 'frame-a', pageId).node.overflowBehavior = 'vertical';
  findNode(after, 'text-a', pageId).node.lineHeight = 24;
  findNode(after, 'text-a', pageId).node.lineHeightUnit = 'pixels';
  findNode(after, 'rectangle-a', pageId).node.cornerSmoothing = 0.6;
  findNode(after, maskGroup.id, pageId).node.maskMode = 'vector';
  findNode(after, image.id, pageId).node.fit = 'tile';
  findNode(after, image.id, pageId).node.scalingFactor = 1.25;
  findNode(after, star.id, pageId).node.vertexRadii = Array(10).fill(4);
  validateDocument(after);

  const plan = await assertPlanMatchesHost(document, after, Array(8).fill('SetProperty'));
  const properties = plan.map(entry => entry.operation.property);
  for (const property of ['overflowBehavior', 'lineHeight', 'lineHeightUnit', 'cornerSmoothing', 'maskMode', 'fit', 'scalingFactor', 'vertexRadii']) {
    assert.ok(properties.includes(property), `the guest planner should emit ${property}`);
  }
});

test('plans custom stroke dash edits through the same host-validated property path', async () => {
  const { document, pageId } = fixture();
  const rectangle = findNode(document, 'rectangle-a', pageId).node;
  assert.equal(addStroke(rectangle, createStroke({ id: 'stroke-custom', width: 2, pattern: 'custom', dashArray: [3, 5] })), true);
  validateDocument(document);

  const after = structuredClone(document);
  assert.ok(updateStroke(findNode(after, 'rectangle-a', pageId).node, 'stroke-custom', { dashArray: [4, 6, 2, 3] }));
  validateDocument(after);

  const plan = await assertPlanMatchesHost(document, after, ['SetProperty', 'SetProperty']);
  assert.deepEqual(plan.map(entry => entry.operation.property), ['strokeDashArray', 'strokes']);
  assert.deepEqual(findNode(plan.at(-1).snapshot, 'rectangle-a', pageId).node.strokeDashArray, [4, 6, 2, 3]);
});

test('plans custom per-side rectangle stroke weights through host validation', async () => {
  const { document, pageId } = fixture();
  const rectangle = findNode(document, 'rectangle-a', pageId).node;
  assert.equal(addStroke(rectangle, createStroke({ id: 'stroke-sides', width: 4, sideWidths: {
    top: 1.5, right: 0, bottom: 3.25, left: 2
  } })), true);
  validateDocument(document);

  const after = structuredClone(document);
  assert.ok(updateStroke(findNode(after, 'rectangle-a', pageId).node, 'stroke-sides', {
    sideWidths: { top: 1.5, right: 2.25, bottom: 3.25, left: 2 }
  }));
  validateDocument(after);

  const plan = await assertPlanMatchesHost(document, after, ['SetProperty']);
  assert.equal(plan[0].operation.property, 'strokes');
  assert.deepEqual(findNode(plan[0].snapshot, 'rectangle-a', pageId).node.strokes[0].sideWidths,
    { top: 1.5, right: 2.25, bottom: 3.25, left: 2 });
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
