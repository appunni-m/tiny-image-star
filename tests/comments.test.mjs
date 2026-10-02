import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addCommentReply, addNode, createCommentThread, createComponent, createDocument, createNode, findNode, parseDocument,
  removeCommentThread, serializeDocument, setCommentResolved, validateDocument
} from '../src/model.js';
import { commentCanvasAction, commentPinCanvasAction, commentSelectionTarget, commentPanelCanvasIsInteractive } from '../src/comment-selection.js';
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

test('the mobile Comments panel keeps canvas selection available except while writing a new draft', () => {
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, inspectorOpen: true, inspectorTab: 'comments', activeCommentId: 'thread' }), true);
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, hostViewOnly: true, inspectorOpen: true, inspectorTab: 'comments', activeCommentId: 'thread' }), false,
    'shared read-only canvases must keep their existing interaction policy');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, inspectorOpen: true, inspectorTab: 'comments', commentToolActive: true }), true,
    'Comment mode must keep the canvas interactive even when the Comments panel has no saved thread open');
  assert.equal(commentPanelCanvasIsInteractive({
    mobile: true, inspectorOpen: true, inspectorTab: 'comments', commentToolActive: true,
    commentPlacementArmed: true
  }), true, 'an armed new-comment action needs canvas taps to select an object or place a pin');
  assert.equal(commentPanelCanvasIsInteractive({
    mobile: true, inspectorOpen: true, inspectorTab: 'comments', commentToolActive: true,
    pendingCommentAnchor: { pageId: 'page', x: 10, y: 20 }
  }), false, 'the anchored comment draft remains modal while the user writes');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, inspectorOpen: true, inspectorTab: 'comments', activeCommentId: null }), true,
    'the ordinary comments list must leave the visible canvas available for selecting a component or frame');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, inspectorOpen: true, inspectorTab: 'design', activeCommentId: 'thread' }), false);
  assert.equal(commentPanelCanvasIsInteractive({ mobile: false, inspectorOpen: false, inspectorTab: 'comments', activeCommentId: 'thread' }), false);
  assert.match(editorSource, /function syncMobilePanelAccessibility\(\)[\s\S]*?commentPanelCanvasIsInteractive\([\s\S]*?pendingCommentAnchor: state\.pendingCommentAnchor[\s\S]*?canvasRegion\.inert = hostViewOnly \? false : anyOpen && !commentPanelCanvasAccess/,
    'the mobile accessibility state must expose the canvas from the Comments panel unless a new comment draft is open');
  assert.match(editorSource, /if \(state\.activeCommentId \|\| state\.inspectorTab === 'comments'\) \{[\s\S]*?state\.activeCommentId = null;[\s\S]*?closeMobilePanels\(\{ restoreFocus: false \}\)[\s\S]*?setInspectorTab\('design'\)/,
    'canvas selection should dismiss the mobile Comments panel and show the selected layer properties');
});

test('posting or cancelling a mobile comment draft restores canvas interaction', () => {
  const commentActionStart = editorSource.indexOf('function handleCommentAction(button)');
  const commentActionEnd = editorSource.indexOf('function submitCommentForm(form)', commentActionStart);
  const commentActions = editorSource.slice(commentActionStart, commentActionEnd);
  assert.match(commentActions, /action === 'back'[\s\S]*?state\.pendingCommentAnchor = null;[\s\S]*?syncMobilePanelAccessibility\(\)/,
    'leaving the comment composer must release the mobile canvas inert state');
  assert.match(commentActions, /action === 'cancel'[\s\S]*?state\.pendingCommentAnchor = null;[\s\S]*?syncMobilePanelAccessibility\(\)/,
    'cancelling a new comment must restore canvas selection');

  const submitStart = editorSource.indexOf('function submitCommentForm(form)');
  const submitEnd = editorSource.indexOf('function renderInspector()', submitStart);
  const submit = editorSource.slice(submitStart, submitEnd);
  assert.match(submit, /state\.pendingCommentAnchor = null;[\s\S]*?syncMobilePanelAccessibility\(\)[\s\S]*?renderInspector\(\)/,
    'posting a new thread must restore canvas interaction before rendering the active thread');
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
  assert.match(editorSource.slice(placement, editorSource.indexOf('if (clearPrototypeConnectPromptIfSourceMissing())', placement)),
    /if \(action === 'select'\) \{[\s\S]*?state\.commentPlacementArmed = false;[\s\S]*?setSelection\(\[target\.id\]\)/,
    'selecting an object must exit pending comment placement so later taps can select normally');
  assert.equal(commentCanvasAction({ id: 'frame' }), 'select');
  assert.equal(commentCanvasAction({ id: 'component' }), 'select');
  assert.equal(commentCanvasAction({ id: 'frame' }, { addCommentShortcut: true }), 'place-comment');
  assert.equal(commentCanvasAction({ id: 'frame' }, { addCommentShortcut: false }), 'select',
    'an object hit remains a selection target unless the explicit placement shortcut is used');
  assert.equal(commentCanvasAction(null), 'place-comment');
  assert.match(editorSource, /function commentTargetAt\(world, options\)[\s\S]*?commentSelectionTarget\(entry, options\)/,
    'canvas hits must resolve to an eligible frame or component');
  assert.match(editorSource, /state\.tool === 'comment' && event\.shiftKey\)[\s\S]*?selectCommentTargetAt\(world, \{ preferComponent: false \}\)/,
    'Shift-click must allow selecting a nested frame inside a component');
  assert.match(editorSource, /commentPinCanvasAction\(commentPin, target,[\s\S]*?state\.activeCommentId = null;[\s\S]*?setSelection\(\[target\.id\]\)/,
    'clicking an already-active pin must let the object beneath it be selected');
  assert.match(editorSource, /if \(action === 'select'\) \{[\s\S]*?state\.activeCommentId = null;[\s\S]*?setSelection\(\[target\.id\]\)/,
    'leaving comment mode selection should clear the active thread so its pin can be reopened');
  const pinHandlerStart = editorSource.indexOf('  if (commentPin) {');
  const pinHandlerEnd = editorSource.indexOf("  if (state.tool === 'comment') {", pinHandlerStart);
  const pinHandler = editorSource.slice(pinHandlerStart, pinHandlerEnd);
  assert.match(pinHandler, /const canSelectFromPin = state\.tool === 'comment' \|\| state\.tool === 'select';[\s\S]*?const target = canSelectFromPin \? commentTargetAt\(world\) : null;/,
    'Comment and Select modes should resolve the object beneath a pin so it can be selected');
  assert.match(pinHandler, /targetSelected: target \? state\.selectedIds\.includes\(target\.id\) : false/,
    'a repeat click on an already selected object can open its thread');
  const selectStart = editorSource.indexOf("if (state.tool === 'select') {", pinHandlerEnd);
  const selectEnd = editorSource.indexOf("if (state.tool === 'image')", selectStart);
  assert.match(editorSource.slice(selectStart, selectEnd), /if \(state\.activeCommentId \|\| state\.inspectorTab === 'comments'\) \{[\s\S]*?state\.activeCommentId = null;[\s\S]*?setInspectorTab\('design'\)/,
    'canvas selection should dismiss the Comments panel and return the inspector to Design');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, { id: 'frame' }, { tool: 'comment', activeCommentId: 'thread' }), 'select');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, { id: 'frame' }, { tool: 'comment', activeCommentId: null }), 'select',
    'an unselected target beneath a pin should remain selectable on the first click');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, { id: 'frame' }, { tool: 'comment', activeCommentId: null, targetSelected: true }), 'open-thread',
    'the next click on a selected target can open its thread');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, null, { tool: 'comment', activeCommentId: 'thread' }), 'open-thread');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, { id: 'frame' }, { tool: 'select', activeCommentId: 'thread' }), 'select',
    'an open thread pin should let Select mode escape to the object beneath it');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, { id: 'frame' }, { tool: 'select', activeCommentId: null }), 'select',
    'an unselected object under an inactive pin should get the first Select-mode click');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, { id: 'frame' }, { tool: 'select', activeCommentId: null, targetSelected: true }), 'open-thread',
    'a second click can still open the inactive pin thread after selecting its target');
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
