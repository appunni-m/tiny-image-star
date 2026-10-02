import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addCommentReply, addNode, createCommentThread, createComponent, createDocument, createNode, findNode, parseDocument,
  removeCommentThread, serializeDocument, setCommentResolved, validateDocument
} from '../src/model.js';
import { commentCanvasAction, commentSelectionTarget } from '../src/comment-selection.js';
import { hitTestPage } from '../src/renderer.js';

const editorSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('comment-mode canvas selection resolves a child to its component or nearest frame', () => {
  const component = { id: 'component', type: 'frame', isComponent: true };
  const frame = { id: 'frame', type: 'frame' };
  const group = { id: 'group', type: 'group' };
  const child = { id: 'child', type: 'rectangle' };
  assert.equal(commentSelectionTarget({ node: child, parents: [frame, group] }), frame);
  assert.equal(commentSelectionTarget({ node: child, parents: [component, frame] }), component,
    'a component containing a nested frame must remain selectable from the canvas');
  assert.equal(commentSelectionTarget({ node: child, parents: [component, frame] }, { preferComponent: false }), frame,
    'Shift-click should provide an explicit way to select the nearest frame inside a component');
  assert.equal(commentSelectionTarget({ node: component, parents: [] }), component);
  assert.equal(commentSelectionTarget({ node: group, parents: [] }), group);
  assert.equal(commentSelectionTarget({ node: child, parents: [] }), child);
  assert.equal(commentSelectionTarget(null), null);
});

test('Comment-mode hit testing can select both a component and a nested frame', () => {
  const document = createDocument();
  const component = createNode('frame', { name: 'Component', x: 0, y: 0, width: 300, height: 200, fill: 'transparent' });
  addNode(document, component);
  createComponent(document, component.id, component.name);
  const frame = createNode('frame', { name: 'Nested frame', x: 10, y: 10, width: 260, height: 160, fill: 'transparent' });
  addNode(document, frame, { parentId: component.id });
  const child = createNode('rectangle', { name: 'Nested content', x: 5, y: 5, width: 230, height: 130, fill: '#ff0000' });
  addNode(document, child, { parentId: frame.id });

  const hit = hitTestPage(document.pages[0], { x: 60, y: 60 }, null, document, null, 1, { allowAnyClippedNodes: true });
  assert.equal(hit?.id, child.id, 'the hit should be the visible nested content before container resolution');
  const entry = findNode(document, hit.id, document.activePageId);
  assert.equal(commentSelectionTarget(entry)?.id, component.id, 'ordinary Comment-mode click should select the component');
  assert.equal(commentSelectionTarget(entry, { preferComponent: false })?.id, frame.id,
    'Shift-click should select the nearest frame');
});

test('Comment mode keeps object clicks for selection and uses explicit gestures to place comments', () => {
  const selection = editorSource.indexOf("if (state.tool === 'comment' && event.shiftKey)");
  const pin = editorSource.indexOf('const commentPin = state.commentPlacementArmed ? null : commentPinAt(world);', selection);
  const placement = editorSource.indexOf("if (state.tool === 'comment') {\n    const target = commentTargetAt(world);", pin);
  assert.ok(selection >= 0 && pin > selection && placement > pin,
    'modifier selection and existing comment pins must be handled before the ordinary comment-mode path');
  assert.match(editorSource.slice(placement, editorSource.indexOf('if (clearPrototypeConnectPromptIfSourceMissing())', placement)),
    /commentCanvasAction\(target,[\s\S]*?addCommentShortcut: event\.altKey[\s\S]*?if \(action === 'select'\)[\s\S]*?setSelection\(\[target\.id\]\)[\s\S]*?else beginCommentAt\(world\)/,
    'object clicks must select even an already-selected frame/component; explicit placement gestures add comments');
  assert.equal(commentCanvasAction({ id: 'frame' }), 'select');
  assert.equal(commentCanvasAction({ id: 'component' }), 'select');
  assert.equal(commentCanvasAction({ id: 'frame' }, { addCommentShortcut: true }), 'place-comment');
  assert.equal(commentCanvasAction({ id: 'frame' }, { placementArmed: true }), 'place-comment');
  assert.equal(commentCanvasAction(null), 'place-comment');
  assert.match(editorSource, /function commentTargetAt\(world, options\)[\s\S]*?commentSelectionTarget\(entry, options\)/,
    'canvas hits must resolve to an eligible frame or component');
  assert.match(editorSource, /state\.tool === 'comment' && event\.shiftKey\)[\s\S]*?selectCommentTargetAt\(world, \{ preferComponent: false \}\)/,
    'Shift-click must allow selecting a nested frame inside a component');
});

test('local review threads support replies, resolution, deletion, and package round trips', () => {
  const document = createDocument();
  const thread = createCommentThread(document, { x: 24.5, y: -12, text: 'Check this spacing.' });
  assert.equal(thread.pageId, document.activePageId);
  assert.equal(thread.messages[0].text, 'Check this spacing.');
  const reply = addCommentReply(document, thread.id, 'Adjusted to 16 px.');
  assert.equal(reply.author, 'You');
  assert.equal(thread.messages.length, 2);
  assert.equal(setCommentResolved(document, thread.id, true), true);
  assert.equal(thread.resolved, true);

  const reloaded = parseDocument(serializeDocument(document));
  assert.equal(reloaded.comments[0].messages[1].text, 'Adjusted to 16 px.');
  assert.equal(reloaded.comments[0].resolved, true);
  addCommentReply(reloaded, thread.id, 'One more small detail.');
  assert.equal(reloaded.comments[0].resolved, false, 'Replying should reopen a resolved thread.');
  assert.equal(reloaded.comments[0].messages.length, 3);
  assert.equal(removeCommentThread(reloaded, thread.id), true);
  assert.equal(removeCommentThread(reloaded, thread.id), false);
  assert.deepEqual(reloaded.comments, []);
});

test('comment validation rejects invalid pages, coordinates, oversized content, and malformed threads', () => {
  const document = createDocument();
  assert.throws(() => createCommentThread(document, { pageId: 'missing', x: 0, y: 0, text: 'Note' }), /page does not exist/i);
  assert.throws(() => createCommentThread(document, { x: Infinity, y: 0, text: 'Note' }), /valid canvas position/i);
  assert.throws(() => createCommentThread(document, { x: 0, y: 0, text: '   ' }), /1–4000 characters/i);
  const thread = createCommentThread(document, { x: 0, y: 0, text: 'Note' });
  thread.messages[0].text = 'x'.repeat(4001);
  assert.throws(() => validateDocument(document), /Invalid comment message/i);
  thread.messages[0].text = 'Note';
  thread.pageId = 'missing';
  assert.throws(() => validateDocument(document), /Invalid comment thread/i);
});

test('older local design documents remain readable without a comments field', () => {
  const document = createDocument();
  delete document.comments;
  const parsed = parseDocument(JSON.stringify(document));
  assert.equal(parsed.comments, undefined);
  assert.equal(validateDocument(parsed), true);
});
