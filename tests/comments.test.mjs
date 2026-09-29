import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCommentReply, createCommentThread, createDocument, parseDocument,
  removeCommentThread, serializeDocument, setCommentResolved, validateDocument
} from '../src/model.js';

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
