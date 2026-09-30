import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, parseDocument, removeNode, serializeDocument, validateDocument } from '../src/model.js';
import {
  createPrototypeFlow,
  deletePrototypeFlow,
  getPrototypeStartFrame,
  listPrototypeFlows,
  renamePrototypeFlow,
  setPrototypeFlowStartPoint,
  setPrototypeStartFlow,
  setPrototypeStartPoint
} from '../src/prototype.js';

function documentWithFrames() {
  const document = createDocument();
  const first = createNode('frame', { name: 'Home' });
  const second = createNode('frame', { name: 'Details' });
  addNode(document, first);
  addNode(document, second);
  return { document, first, second };
}

test('named prototype flows can be created, renamed, selected, and deleted safely', () => {
  const { document, first, second } = documentWithFrames();
  const home = createPrototypeFlow(document, first.id, { name: 'Home flow' });
  const details = createPrototypeFlow(document, second.id, { name: 'Details flow' });

  assert.equal(document.prototypeStartFlowId, home.id, 'the first flow becomes the presentation default');
  assert.deepEqual(listPrototypeFlows(document).map(flow => flow.name), ['Home flow', 'Details flow']);
  assert.equal(getPrototypeStartFrame(document).frame.id, first.id);
  assert.equal(getPrototypeStartFrame(document, null, details.id).frame.id, second.id);

  renamePrototypeFlow(document, details.id, 'Account details');
  assert.equal(details.name, 'Account details');
  assert.throws(() => renamePrototypeFlow(document, details.id, ' HOME FLOW '), /already exists/);
  setPrototypeFlowStartPoint(document, details.id, first.id);
  assert.equal(getPrototypeStartFrame(document, null, details.id).frame.id, first.id);
  setPrototypeStartFlow(document, details.id);
  assert.deepEqual(document.prototypeStartPoint, { pageId: document.activePageId, nodeId: first.id });
  assert.equal(deletePrototypeFlow(document, details.id), true);
  assert.equal(document.prototypeStartFlowId, home.id, 'deleting the default chooses the first remaining flow');
  assert.equal(deletePrototypeFlow(document, details.id), false);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('legacy single start points migrate to a named flow without changing their target', () => {
  const { document, first } = documentWithFrames();
  setPrototypeStartPoint(document, first.id);
  const legacy = structuredClone(document);
  delete legacy.prototypeFlows;
  delete legacy.prototypeStartFlowId;

  const restored = parseDocument(legacy);
  assert.deepEqual(restored.prototypeStartPoint, { pageId: document.activePageId, nodeId: first.id });
  assert.equal(restored.prototypeFlows.length, 1);
  assert.equal(restored.prototypeFlows[0].name, 'Flow 1');
  assert.equal(restored.prototypeStartFlowId, restored.prototypeFlows[0].id);
  assert.equal(getPrototypeStartFrame(restored).frame.id, first.id);
  assert.equal(validateDocument(restored), true);
});

test('prototype flow creation and document validation reject invalid frames and duplicate identities', () => {
  const { document, first } = documentWithFrames();
  const nonFrame = createNode('rectangle');
  addNode(document, nonFrame);
  assert.throws(() => createPrototypeFlow(document, nonFrame.id), /starting point/);
  assert.throws(() => createPrototypeFlow(document, 'missing'), /starting point/);
  const flow = createPrototypeFlow(document, first.id, { name: 'Main' });
  assert.throws(() => createPrototypeFlow(document, first.id, { name: ' main ' }), /already exists/);

  const invalidTarget = structuredClone(document);
  invalidTarget.prototypeFlows[0].nodeId = nonFrame.id;
  assert.throws(() => validateDocument(invalidTarget), /Invalid or duplicate prototype flow/);
  const duplicateName = structuredClone(document);
  duplicateName.prototypeFlows.push({ ...flow, id: 'another-flow', name: ' main ' });
  assert.throws(() => validateDocument(duplicateName), /Invalid or duplicate prototype flow/);
  const missingDefault = structuredClone(document);
  missingDefault.prototypeStartFlowId = 'missing';
  assert.throws(() => validateDocument(missingDefault), /prototype start flow/);
});

test('legacy setPrototypeStartPoint continues to update the selected flow target', () => {
  const { document, first, second } = documentWithFrames();
  setPrototypeStartPoint(document, first.id);
  const defaultFlow = document.prototypeFlows[0];
  createPrototypeFlow(document, second.id, { name: 'Secondary' });
  setPrototypeStartPoint(document, second.id);
  assert.equal(document.prototypeStartFlowId, defaultFlow.id);
  assert.equal(getPrototypeStartFrame(document).frame.id, second.id);
});

test('removing a flow start frame prunes its flow and selects a valid survivor', () => {
  const document = createDocument();
  const parent = createNode('frame', { name: 'Parent' });
  const nestedStart = createNode('frame', { name: 'Nested start' });
  const survivor = createNode('frame', { name: 'Survivor' });
  addNode(document, parent);
  addNode(document, nestedStart, { parentId: parent.id });
  addNode(document, survivor);
  const removedFlow = createPrototypeFlow(document, nestedStart.id, { name: 'Nested flow' });
  const survivingFlow = createPrototypeFlow(document, survivor.id, { name: 'Surviving flow' });
  setPrototypeStartFlow(document, removedFlow.id);

  removeNode(document, parent.id);
  assert.deepEqual(document.prototypeFlows.map(flow => flow.id), [survivingFlow.id]);
  assert.equal(document.prototypeStartFlowId, survivingFlow.id);
  assert.deepEqual(document.prototypeStartPoint, { pageId: document.activePageId, nodeId: survivor.id });
  assert.equal(getPrototypeStartFrame(document).frame.id, survivor.id);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  removeNode(document, survivor.id);
  assert.deepEqual(document.prototypeFlows, []);
  assert.equal(document.prototypeStartFlowId, null);
  assert.equal(document.prototypeStartPoint, null);
  assert.equal(validateDocument(document), true);
});
