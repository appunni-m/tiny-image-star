import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addCommentReply, createCommentThread, createDocument, parseDocument,
  removeCommentThread, serializeDocument, setCommentResolved, validateDocument
} from '../src/model.js';
import { commentSelectionTarget } from '../src/comment-selection.js';

const editorSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('comment-mode canvas selection resolves a child to its nearest frame or component', () => {
  const component = { id: 'component', type: 'frame', isComponent: true };
  const frame = { id: 'frame', type: 'frame' };
  const group = { id: 'group', type: 'group' };
  const child = { id: 'child', type: 'rectangle' };
  assert.equal(commentSelectionTarget({ node: child, parents: [frame, group] }), frame);
  assert.equal(commentSelectionTarget({ node: child, parents: [component, frame] }), frame);
  assert.equal(commentSelectionTarget({ node: component, parents: [] }), component);
  assert.equal(commentSelectionTarget({ node: group, parents: [] }), group);
  assert.equal(commentSelectionTarget({ node: child, parents: [] }), child);
  assert.equal(commentSelectionTarget(null), null);
});

test('Comment mode selects a frame or component on first click and places a comment on the next click', () => {
  const selection = editorSource.indexOf("if (state.tool === 'comment' && event.shiftKey)");
  const pin = editorSource.indexOf('const commentPin = commentPinAt(world);', selection);
  const placement = editorSource.indexOf("if (state.tool === 'comment') {\n    const target = commentTargetAt(world);", pin);
  assert.ok(selection >= 0 && pin > selection && placement > pin,
    'modifier selection and existing comment pins must be handled before the ordinary comment-mode path');
  assert.match(editorSource.slice(placement, editorSource.indexOf('if (clearPrototypeConnectPromptIfSourceMissing())', placement)),
    /target && !state\.selectedIds\.includes\(target\.id\)[\s\S]*?setSelection\(\[target\.id\]\)[\s\S]*?else beginCommentAt\(world\)/,
    'the first click selects an unselected frame/component and a subsequent click places a comment');
  assert.match(editorSource, /function commentTargetAt\(world\)[\s\S]*?commentSelectionTarget\(entry\)/,
    'canvas hits must resolve to the containing frame or component');
  assert.match(editorSource, /function selectCommentTargetAt\(world\)[\s\S]*?setSelection\(\[target\.id\]\)/,
    'Shift-click must remain an explicit selection gesture');
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
