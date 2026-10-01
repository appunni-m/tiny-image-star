import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, canCreateMaskGroup, createDocument, createMaskGroup, createNode, findNode,
  parseDocument, releaseMaskGroup, serializeDocument, validateDocument
} from '../src/model.js';

test('mask groups use the frontmost supported layer and preserve layer order on release', () => {
  const document = createDocument();
  const back = createNode('rectangle', { name: 'Back', x: -20, y: 0 });
  const content = createNode('rectangle', { name: 'Content', x: 30, y: 40, width: 100, height: 80 });
  const mask = createNode('ellipse', { name: 'Circle mask', x: 10, y: 20, width: 60, height: 60 });
  const front = createNode('text', { name: 'Front', x: 240, y: 0 });
  for (const node of [back, content, mask, front]) addNode(document, node);

  assert.equal(canCreateMaskGroup(document, [mask.id, content.id]), true);
  const group = createMaskGroup(document, [mask.id, content.id]);
  assert.equal(group.type, 'group');
  assert.equal(group.mask, true);
  assert.equal(group.maskSourceId, mask.id);
  assert.deepEqual(group.children.map(node => node.id), [content.id, mask.id]);
  assert.deepEqual(document.pages[0].children.map(node => node.id), [back.id, group.id, front.id]);
  assert.deepEqual([group.x + content.x, group.y + content.y, group.x + mask.x, group.y + mask.y], [30, 40, 10, 20]);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  const released = releaseMaskGroup(document, group.id);
  assert.deepEqual(released.map(node => node.id), [content.id, mask.id]);
  assert.deepEqual(document.pages[0].children.map(node => node.id), [back.id, content.id, mask.id, front.id]);
  assert.deepEqual([released[0].x, released[0].y, released[1].x, released[1].y], [30, 40, 10, 20]);
  assert.equal(validateDocument(document), true);
});

test('text layers can be saved and reused as editable alpha-mask sources', () => {
  const document = createDocument();
  const content = createNode('rectangle', { name: 'Photo window' });
  const text = createNode('text', { name: 'STAR', text: 'STAR', fontSize: 48, fillOpacity: 0.8 });
  addNode(document, content);
  addNode(document, text);

  assert.equal(canCreateMaskGroup(document, [content.id, text.id]), true);
  const group = createMaskGroup(document, [content.id, text.id]);
  const reloaded = parseDocument(serializeDocument(document));

  assert.equal(group.maskSourceId, text.id);
  assert.equal(findNode(reloaded, group.id).node.maskSourceId, text.id);
  assert.equal(validateDocument(reloaded), true);
});

test('mask creation rejects open paths, image layers, locks, and mixed parents', () => {
  const document = createDocument();
  const frame = createNode('frame');
  const content = createNode('rectangle');
  const openPath = createNode('path', { closed: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  const image = createNode('image');
  addNode(document, frame); addNode(document, content); addNode(document, openPath); addNode(document, image);
  assert.equal(canCreateMaskGroup(document, [content.id, openPath.id]), false);
  assert.equal(canCreateMaskGroup(document, [content.id, image.id]), false);

  const lockedShape = createNode('ellipse', { locked: true });
  const sibling = createNode('rectangle');
  addNode(document, lockedShape); addNode(document, sibling);
  assert.equal(canCreateMaskGroup(document, [lockedShape.id, sibling.id]), false);

  const nested = createNode('rectangle'); addNode(document, nested, { parentId: frame.id });
  assert.equal(canCreateMaskGroup(document, [content.id, nested.id]), false);
});

test('document validation rejects malformed mask source references', () => {
  const document = createDocument();
  const group = createNode('group', {
    mask: true,
    maskSourceId: 'missing-mask',
    children: [createNode('rectangle'), createNode('image')]
  });
  addNode(document, group);
  assert.throws(() => validateDocument(document), /Invalid mask group/);
});

test('releasing a rotated mask group applies its rotation to the editable source layers', () => {
  const document = createDocument();
  const content = createNode('rectangle', { x: 30, y: 40, width: 100, height: 80 });
  const mask = createNode('ellipse', { x: 10, y: 20, width: 60, height: 60 });
  addNode(document, content); addNode(document, mask);
  const group = createMaskGroup(document, [content.id, mask.id]);
  group.rotation = 90;

  const released = releaseMaskGroup(document, group.id);
  assert.deepEqual([released[0].x, released[0].y, released[0].rotation], [10, 40, 90]);
  assert.deepEqual([released[1].x, released[1].y, released[1].rotation], [60, 10, 90]);
  assert.equal(validateDocument(document), true);
});
