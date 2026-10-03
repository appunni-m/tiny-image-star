import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addCommentReply, addNode, createCommentThread, createComponent, createDocument, createNode, findNode, parseDocument,
  removeCommentThread, serializeDocument, setCommentResolved, validateDocument
} from '../src/model.js';
import { advanceCommentSelection, commentCanvasAction, commentPinCanvasAction, commentPinOverridesCanvasSelection, commentPinSelectionCycle, commentPinSelectionCycleMatches, commentSelectionEntryForHit, commentSelectionTarget, commentSelectionTargets, commentPanelCanvasIsInteractive, nextCommentSelectionTarget, commentPlacementGesturePans, commentPanelNeedsCanvasCaptureRelease, commentPanelOverridesCanvasTool, commentSelectionOverridesCanvasTool } from '../src/comment-selection.js';
import { deepestContainerAtPagePoint, hitTestPage } from '../src/renderer.js';

const editorSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const stylesheetSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('comment-mode canvas selection resolves a child to its component or nearest frame', () => {
  const component = { id: 'component', type: 'frame', isComponent: true };
  const frame = { id: 'frame', type: 'frame' };
  const group = { id: 'group', type: 'group' };
  const child = { id: 'child', type: 'rectangle' };
  assert.equal(commentSelectionTarget({ node: child, parents: [frame, group] }), frame);
  assert.equal(commentSelectionTarget({ node: child, parents: [component, frame] }), component,
    'a component containing a nested frame must remain selectable from the canvas');
  const nestedTargets = commentSelectionTargets({ node: child, parents: [component, frame] });
  assert.deepEqual(nestedTargets.map(node => node.id), ['component', 'frame'],
    'the same touch hit should expose both its component and nested frame in a stable order');
  const frameToolTarget = advanceCommentSelection({ node: child, parents: [component, frame] }, null, {
    pageId: 'page-a', pointerType: 'mouse', x: 12, y: 18, time: 100
  }, { preferHitContainer: true, preferComponent: false });
  assert.equal(frameToolTarget.target.id, 'frame',
    'the Comments panel should select the nearest frame when the Frame tool is active');
  assert.equal(nextCommentSelectionTarget({ node: child, parents: [component, frame] }, 'component')?.id, 'frame',
    'a repeated phone tap should switch from the component to its nested frame');
  assert.equal(nextCommentSelectionTarget({ node: child, parents: [component, frame] }, 'frame')?.id, 'component',
    'the next phone tap should cycle back to the containing component');
  assert.equal(commentSelectionTarget({ node: child, parents: [component, frame] }, { preferComponent: false }), frame,
    'Shift-click should provide an explicit way to select the nearest frame inside a component');
  const activeThreadTarget = advanceCommentSelection({ node: frame, parents: [component] }, null, {
    pageId: 'page-a', pointerType: 'mouse', x: 12, y: 18, time: 100
  }, { preferHitContainer: false, preferComponent: true });
  assert.equal(activeThreadTarget.target.id, 'component',
    'an open comment thread should prioritize the containing component when the hit is a nested frame');
  assert.equal(commentSelectionTarget({ node: component, parents: [] }), component);
  assert.equal(commentSelectionTarget({ node: group, parents: [] }), group);
  assert.equal(commentSelectionTarget({ node: child, parents: [] }), child);
  assert.equal(commentSelectionTarget(null), null);
});

test('the active Comments panel prioritizes object selection over other canvas tools', () => {
  for (const tool of ['frame', 'rectangle', 'ellipse', 'pen', 'lasso']) {
    assert.equal(commentPanelOverridesCanvasTool({ inspectorTab: 'comments', tool }), true,
      `${tool} should yield an object hit to the active Comments panel`);
  }
  assert.equal(commentPanelOverridesCanvasTool({ inspectorTab: 'comments', tool: 'frame' }), true,
    'the Comments list should select an object even when no thread is open');
  assert.equal(commentPanelOverridesCanvasTool({ inspectorTab: 'design', tool: 'frame' }), false,
    'the Design panel does not take over drawing tools');
  assert.equal(commentPanelOverridesCanvasTool({ inspectorTab: 'comments', tool: 'comment' }), true,
    'Comment mode should share the early object-selection route while the Comments panel is active');
  assert.equal(commentPanelOverridesCanvasTool({ inspectorTab: 'comments', tool: 'select' }), true,
    'Select mode should resolve a review target to its component or containing frame while the Comments panel is active');
  assert.equal(commentPanelOverridesCanvasTool({ inspectorTab: 'comments', tool: 'hand' }), true,
    'the Comments panel should allow a click on an object to select it while Hand is active');
  assert.equal(commentSelectionOverridesCanvasTool({ inspectorTab: 'design', tool: 'comment' }), true,
    'Comment mode must prioritize object selection even when the Design inspector is open');
  assert.equal(commentSelectionOverridesCanvasTool({ inspectorTab: 'comments', tool: 'frame' }), true,
    'the Comments inspector must prioritize selection over drawing tools');
  assert.equal(commentSelectionOverridesCanvasTool({ inspectorTab: 'design', tool: 'frame', activeCommentId: 'thread' }), true,
    'an active thread should let a canvas hit select its component or frame after switching inspector tabs');
  assert.equal(commentSelectionOverridesCanvasTool({ inspectorTab: 'design', tool: 'frame', pendingCommentAnchor: { x: 1, y: 2 } }), true,
    'an anchored draft should let a canvas hit select its component or frame before placing the comment');
  assert.equal(commentSelectionOverridesCanvasTool({ inspectorTab: 'comments', tool: 'hand' }), true,
    'the Comments panel should let a canvas click select while Hand is active');
  assert.equal(commentSelectionOverridesCanvasTool({ inspectorTab: 'design', tool: 'hand', activeCommentId: 'thread' }), true,
    'an active thread should let a Hand-tool click select while preserving drag-to-pan');
  assert.equal(commentPanelNeedsCanvasCaptureRelease({ inspectorTab: 'comments', tool: 'select' }), true,
    'Select must release a stale crop or erase capture before object hits are routed');
  assert.equal(commentPanelNeedsCanvasCaptureRelease({ inspectorTab: 'comments', tool: 'frame' }), true,
    'drawing tools must release canvas captures before the Comments panel can select an object');
  assert.equal(commentPanelNeedsCanvasCaptureRelease({ inspectorTab: 'design', tool: 'select' }), false,
    'the Comments panel must not change ordinary Design-panel canvas capture');
  assert.equal(commentPanelNeedsCanvasCaptureRelease({ inspectorTab: 'comments', tool: 'hand' }), true,
    'the Comments panel should release stale captures before routing Hand-tool clicks');
  assert.equal(commentPanelNeedsCanvasCaptureRelease({ inspectorTab: 'design', tool: 'frame', activeCommentId: 'thread' }), true,
    'an active thread must release stale tool captures before its canvas target can be selected');

  const pointerStart = editorSource.indexOf('function onCanvasPointerDown(event)');
  const pointerEnd = editorSource.indexOf('\nfunction updateDraftShapeGeometry', pointerStart);
  const pointerHandler = editorSource.slice(pointerStart, pointerEnd);
  const override = pointerHandler.indexOf('if (commentSelectionOverridesTool) {');
  assert.ok(override >= 0, 'the pointer router should prioritize Comment-mode and Comments-panel object selection');
  for (const editOnlyGuard of [
    "if (state.inspectorTab === 'motion' && state.motionPreview",
    'if (isImageRecipeBatchActive(state.bulk))'
  ]) {
    assert.ok(pointerHandler.indexOf(editOnlyGuard) > override,
      `${editOnlyGuard} must not block read-only component/frame selection during comment review`);
  }
  for (const competingTool of ['if (state.shapeBuilder && event.button === 0)', 'if (state.imageCropMode)', "if (state.tool === 'lasso')"]) {
    assert.ok(pointerHandler.indexOf(competingTool) > override,
      `${competingTool} should run after open-thread selection has had a chance to consume an object hit`);
  }
  const commentsPanelRoute = pointerHandler.slice(override, pointerHandler.indexOf('if (state.shapeBuilder && event.button === 0)', override));
  assert.match(commentsPanelRoute,
    /event\.shiftKey\s*\?\s*\{ target: commentTargetAt\(world, \{ preferComponent: false \}\), cycled: false \}[\s\S]*?finishCommentCanvasSelection\(target, \{ cycled: selection\.cycled \}\)/,
    'a Comments-panel object hit should select a component or containing frame and preserve the Shift-click target');
  assert.match(editorSource,
    /function finishCommentCanvasSelection\(target,[\s\S]*?state\.activeCommentId = null;[\s\S]*?if \(!state\.pendingCommentAnchor\) state\.pendingCommentText = '';[\s\S]*?state\.commentPlacementArmed = false;[\s\S]*?if \(leavesCommentContext\) closeMobilePanels\(\{ restoreFocus: false \}\);[\s\S]*?setSelection\(\[target\.id\], \{ source: 'canvas' \}\);[\s\S]*?if \(state\.inspectorTab === 'comments'\) setInspectorTab\('design'\)/,
    'selecting an object should reveal Design properties without discarding an open new-comment draft');
  assert.match(editorSource, /function cycleCommentSelectionAt\(world, event[^)]*\)[\s\S]*?const commentReviewPrefersComponent = Boolean\(state\.pendingCommentAnchor[\s\S]*?state\.activeCommentId && state\.tool !== 'comment'[\s\S]*?preferHitContainer: !commentReviewPrefersComponent,[\s\S]*?preferComponent: commentReviewPrefersComponent[\s\S]*?\|\| !\(state\.inspectorTab === 'comments' && state\.tool === 'frame'\)/,
    'another active tool should select the containing component during review, while Comment and Frame modes preserve directly hit targets');
  assert.match(pointerHandler,
    /commentSelectionOverridesCanvasTool\(\{[\s\S]*?activeCommentId: state\.activeCommentId,[\s\S]*?pendingCommentAnchor: state\.pendingCommentAnchor[\s\S]*?\}\)/,
    'the canvas selection route should consider a thread or anchored draft that outlives its current inspector tab');
  assert.doesNotMatch(commentsPanelRoute, /if \(!commentTool\) state\.commentSelectionCycle = null/,
    'changing to the Design inspector must preserve the repeated-click cycle for choosing a nested frame or component');
  assert.match(commentsPanelRoute, /if \(event\.shiftKey\) state\.commentSelectionCycle = null/,
    'an explicit Shift-click should choose one container directly and reset any prior cycle');
  assert.match(commentsPanelRoute,
    /const commentAction = commentTool && commentPinOverridesCanvasSelection\([\s\S]*?activeCommentId: state\.activeCommentId,[\s\S]*?commentPin,[\s\S]*?addCommentShortcut: event\.altKey[\s\S]*?\);[\s\S]*?if \(!commentAction\)[\s\S]*?cycleCommentSelectionAt\(world, event, \{[\s\S]*?\}\)/,
    'an open thread should let Comment-mode object selection pass through another pin while preserving explicit comment actions');
  const handPan = pointerHandler.indexOf("if (event.button === 1 || state.spaceDown || (state.tool === 'hand'");
  assert.ok(handPan > 0, 'the ordinary Hand-tool navigation route should remain present');
  const beforeHandPan = pointerHandler.slice(0, handPan);
  assert.match(beforeHandPan,
    /state\.tool === 'hand' && commentSelectionOverridesTool[\s\S]*?kind: 'comment-selection-tap'[\s\S]*?event\.preventDefault\(\);\s*return;/,
    'Hand-tool clicks in comment review should defer selection until release before the pan fallback');
  const moveStart = editorSource.indexOf('function onCanvasPointerMove(event)');
  const moveEnd = editorSource.indexOf('\nfunction onCanvasPointerUp(event)', moveStart);
  assert.match(editorSource.slice(moveStart, moveEnd),
    /interaction\.kind === 'comment-selection-tap'[\s\S]*?state\.commentSelectionCycle = null[\s\S]*?interaction\.kind = 'pan'/,
    'moving past the click threshold should convert a pending Hand selection into a pan');
  const upStart = editorSource.indexOf('function onCanvasPointerUp(event)');
  const upEnd = editorSource.indexOf('\nfunction cancelCanvasInteraction', upStart);
  assert.match(editorSource.slice(upStart, upEnd),
    /interaction\.kind === 'comment-selection-tap'[\s\S]*?finishCommentCanvasSelection\(target, \{ cycled: interaction\.selectionCycled \}\)/,
    'a stationary Hand-tool release should select the hit component or frame');
});

test('repeated Comment-mode mouse, pen, and touch input cycles nested containers at the same point', () => {
  const component = { id: 'component', type: 'frame', isComponent: true };
  const frame = { id: 'frame', type: 'frame' };
  const child = { id: 'child', type: 'rectangle' };
  const entry = { node: child, parents: [component, frame] };
  const options = { preferHitContainer: true };
  const first = advanceCommentSelection(entry, null, {
    pageId: 'page-a', pointerType: 'mouse', x: 100, y: 80, time: 100
  }, options);
  assert.equal(first.target.id, 'component');
  assert.equal(first.cycled, false);
  const second = advanceCommentSelection(entry, first.cycle, {
    // The mobile Comments pane may close and recenter the canvas after the
    // first selection. The same artwork still resolves to the same document
    // point even though its screen coordinates have changed.
    pageId: 'page-a', pointerType: 'mouse', x: 100, y: 80, time: 1800
  }, options);
  assert.equal(second.target.id, 'frame', 'a second mouse click should expose the containing frame');
  assert.equal(second.cycled, true);
  const third = advanceCommentSelection(entry, second.cycle, {
    pageId: 'page-a', pointerType: 'mouse', x: 100, y: 80, time: 1900
  }, options);
  assert.equal(third.target.id, 'component', 'the container cycle should wrap back to the component');
  const newPointer = advanceCommentSelection(entry, third.cycle, {
    pageId: 'page-a', pointerType: 'touch', x: 100, y: 80, time: 1950
  }, options);
  assert.equal(newPointer.target.id, 'component', 'a different input device should start a fresh selection');
  const newPage = advanceCommentSelection(entry, newPointer.cycle, {
    pageId: 'page-b', pointerType: 'touch', x: 100, y: 80, time: 1960
  }, options);
  assert.equal(newPage.target.id, 'component', 'a different page should start a fresh selection');
  const expired = advanceCommentSelection(entry, first.cycle, {
    pageId: 'page-a', pointerType: 'mouse', x: 100, y: 80, time: 5101
  }, options);
  assert.equal(expired.target.id, 'component', 'a later click should start a fresh selection');
});

test('comment selection keeps the component/frame cycle when the comment panel recenters the canvas', () => {
  const component = { id: 'component', type: 'frame', isComponent: true };
  const frame = { id: 'frame', type: 'frame' };
  const child = { id: 'child', type: 'rectangle' };
  const entry = { node: child, parents: [component, frame] };
  const first = advanceCommentSelection(entry, null, {
    pageId: 'page-a', pointerType: 'touch', x: 100, y: 80, time: 100
  }, { preferHitContainer: true });
  assert.equal(first.target.id, 'component');

  const afterPanelClose = advanceCommentSelection(entry, first.cycle, {
    // Closing the comment sheet changes the canvas height, so the same
    // artwork no longer maps to the same world coordinate.
    pageId: 'page-a', pointerType: 'touch', x: 100, y: 240, time: 3600
  }, { preferHitContainer: true });
  assert.equal(afterPanelClose.target.id, 'frame',
    'the stable hit hierarchy should advance to the nested frame despite viewport recentering');
  assert.equal(afterPanelClose.cycled, true);
});

test('a selected component or frame can switch to its containing peer with one Comment-mode hit', () => {
  const component = { id: 'component', type: 'frame', isComponent: true };
  const frame = { id: 'frame', type: 'frame' };
  const child = { id: 'child', type: 'rectangle' };
  const entry = { node: child, parents: [component, frame] };
  const componentHit = advanceCommentSelection(entry, null, {
    pageId: 'page-a', pointerType: 'mouse', x: 20, y: 30, time: 100, selectedTargetId: 'component'
  });
  assert.equal(componentHit.target.id, 'frame',
    'a component already selected from Layers should expose its nested frame on the first canvas hit');
  assert.equal(componentHit.cycled, true);
  const frameHit = advanceCommentSelection(entry, null, {
    pageId: 'page-a', pointerType: 'mouse', x: 20, y: 30, time: 200, selectedTargetId: 'frame'
  });
  assert.equal(frameHit.target.id, 'component',
    'a nested frame already selected from Layers should expose its containing component on the first canvas hit');
  assert.equal(frameHit.cycled, true);
  const layerSelectionChanged = advanceCommentSelection(entry, componentHit.cycle, {
    pageId: 'page-a', pointerType: 'mouse', x: 20, y: 30, time: 300, selectedTargetId: 'component'
  });
  assert.equal(layerSelectionChanged.target.id, 'frame',
    'a Layers-panel selection change should not leave a stale canvas cycle pointing at the wrong container');

  const canvasFrameHit = advanceCommentSelection(entry, null, {
    pageId: 'page-a', pointerType: 'mouse', x: 20, y: 30, time: 400
  }, { preferHitContainer: true, preferComponent: false });
  assert.equal(canvasFrameHit.target.id, 'frame',
    'a frame selected on canvas must remain the first hit when the Comments panel or Frame tool is opened');
  assert.equal(canvasFrameHit.cycled, false,
    'a canvas hit must not be mistaken for an immediate layer-list cycle');

  assert.match(editorSource,
    /function setSelection\(ids, \{[^}]*source = 'programmatic'[\s\S]*?state\.selectionSource = source/,
    'selection state should remember whether its latest explicit source was the Layers list or canvas');
  assert.match(editorSource,
    /function onCanvasPointerDown\(event\)[\s\S]*?const selectedFromLayerList = state\.selectionSource === 'layers';[\s\S]*?state\.selectionSource = 'canvas'/,
    'canvas clicks should consume the Layers-list origin once instead of inheriting it from an earlier canvas selection');
  assert.match(editorSource,
    /function cycleCommentSelectionAt\(world, event, \{[^}]*layerSelectedTargetId = null[\s\S]*?selectedTargetId: !preservePinThreadAction \? layerSelectedTargetId : null/,
    'only an explicitly recorded Layers-list selection should advance immediately to a peer container');
  assert.match(editorSource,
    /setSelection\(\[node\.id\], \{ refreshLayers: false, source: 'layers' \}\)/,
    'selecting a row in the Layers list should be recorded as a layer-originated selection');
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

test('Comment mode can select transparent or empty frames from their blank interior', () => {
  const document = createDocument();
  const component = createNode('frame', {
    name: 'Transparent component', x: 0, y: 0, width: 300, height: 220, fill: 'transparent'
  });
  addNode(document, component);
  createComponent(document, component.id, component.name);
  const frame = createNode('frame', {
    name: 'Empty frame', x: 24, y: 32, width: 180, height: 120, fill: 'transparent'
  });
  addNode(document, frame, { parentId: component.id });
  const point = { x: 80, y: 90 };

  const hit = hitTestPage(document.pages[0], point, null, document, null, 1, { allowAnyClippedNodes: true });
  assert.equal(hit?.id, frame.id,
    'container geometry remains selectable even when the frame has no visible fill or children');
  const entry = findNode(document, hit.id);
  assert.equal(commentSelectionTarget(entry, { preferHitContainer: true })?.id, frame.id,
    'Comment mode should select an empty frame directly, with its component still available through repeated selection');
  const geometricFallback = deepestContainerAtPagePoint(document.pages[0].children, point, document);
  assert.equal(geometricFallback?.node.id, frame.id,
    'geometric comment hit fallback should find a blank frame even without painted content');

  const entryPoint = editorSource.indexOf('function commentSelectionEntryAt(world');
  const entryEnd = editorSource.indexOf('\nfunction commentTargetAt', entryPoint);
  assert.match(editorSource.slice(entryPoint, entryEnd), /hitTestPage\([\s\S]*?deepestContainerAtPagePoint\(page\.children, world, state\.document\)[\s\S]*?findNode\(state\.document, container\.node\.id, page\.id\)[\s\S]*?commentSelectionEntryForHit\(hitEntry, containerEntry\)/,
    'canvas review selection should combine paint hits with visible container geometry');
});

test('Comment mode selects a transparent component or frame beneath unrelated painted overlaps', () => {
  const document = createDocument();
  const component = createNode('frame', { name: 'Component', x: 0, y: 0, width: 300, height: 200, fill: 'transparent' });
  addNode(document, component);
  createComponent(document, component.id, component.name);
  const frame = createNode('frame', { name: 'Nested frame', x: 10, y: 10, width: 100, height: 100, fill: 'transparent' });
  addNode(document, frame, { parentId: component.id });
  const frameCover = createNode('rectangle', { name: 'Frame overlap', x: 24, y: 24, width: 40, height: 40, fill: '#ff0000' });
  addNode(document, frameCover);
  const componentCover = createNode('rectangle', { name: 'Component overlap', x: 220, y: 130, width: 40, height: 40, fill: '#00ff00' });
  addNode(document, componentCover);

  for (const [point, expected] of [
    [{ x: 40, y: 40 }, frame],
    [{ x: 240, y: 150 }, component]
  ]) {
    const hit = hitTestPage(document.pages[0], point, null, document, null, 1, { allowAnyClippedNodes: true });
    assert.ok(hit && hit.id !== expected.id, 'paint hit should be an unrelated overlapping layer');
    const hitEntry = findNode(document, hit.id);
    const geometric = deepestContainerAtPagePoint(document.pages[0].children, point, document);
    const geometricEntry = findNode(document, geometric.node.id);
    const selectionEntry = commentSelectionEntryForHit(hitEntry, geometricEntry);
    assert.equal(commentSelectionTarget(selectionEntry, { preferHitContainer: true })?.id, expected.id,
      `Comment mode should select the ${expected.name} under the overlapping artwork`);
  }
});

test('Comment-mode clicks keep directly hit nested frames selectable', () => {
  const document = createDocument();
  const component = createNode('frame', { name: 'Component', x: 0, y: 0, width: 300, height: 200, fill: 'transparent' });
  addNode(document, component);
  createComponent(document, component.id, component.name);
  const frame = createNode('frame', { name: 'Nested frame', x: 20, y: 20, width: 180, height: 150, fill: 'transparent' });
  addNode(document, frame, { parentId: component.id });
  const child = createNode('rectangle', { name: 'Nested content', x: 10, y: 10, width: 30, height: 30, fill: '#ff0000' });
  addNode(document, child, { parentId: frame.id });

  const hitAt = point => hitTestPage(document.pages[0], point, null, document, null, 1, { allowAnyClippedNodes: true });
  const frameHit = hitAt({ x: 100, y: 100 });
  assert.equal(frameHit?.id, frame.id, 'an empty point inside the nested frame should hit the frame itself');
  assert.equal(commentSelectionTarget(findNode(document, frameHit.id), { preferHitContainer: true })?.id, frame.id,
    'ordinary Comment-mode selection should preserve a directly hit nested frame');

  const componentHit = hitAt({ x: 270, y: 170 });
  assert.equal(componentHit?.id, component.id, 'an empty point inside the outer component should hit that component');
  assert.equal(commentSelectionTarget(findNode(document, componentHit.id), { preferHitContainer: true })?.id, component.id);

  const childHit = hitAt({ x: 50, y: 50 });
  assert.equal(childHit?.id, child.id);
  assert.equal(commentSelectionTarget(findNode(document, childHit.id), { preferHitContainer: true })?.id, component.id,
    'clicking child artwork should continue to select its containing component');
  assert.equal(commentSelectionTarget(findNode(document, frameHit.id), { preferComponent: false })?.id, frame.id,
    'Shift-click frame targeting remains available');
});

test('the mobile Comments panel keeps canvas selection available while a new comment draft is open', () => {
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, inspectorOpen: true, inspectorTab: 'comments', activeCommentId: 'thread' }), true);
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, hostViewOnly: true, inspectorOpen: true, inspectorTab: 'comments', activeCommentId: 'thread' }), false,
    'shared read-only canvases must keep their existing interaction policy');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, inspectorOpen: true, inspectorTab: 'comments', commentToolActive: true }), true,
    'Comment mode must keep the canvas interactive even when the Comments panel has no saved thread open');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, inspectorOpen: true, inspectorTab: 'design', commentToolActive: true }), true,
    'switching the mobile inspector to Design must not block canvas selection while Comment mode remains active');
  assert.equal(commentPanelCanvasIsInteractive({
    mobile: true, inspectorOpen: true, inspectorTab: 'comments', commentToolActive: true,
    commentPlacementArmed: true
  }), true, 'an armed new-comment action needs canvas taps to select an object or place a pin');
  assert.equal(commentPanelCanvasIsInteractive({
    mobile: true, inspectorOpen: true, inspectorTab: 'comments', commentToolActive: true,
    pendingCommentAnchor: { pageId: 'page', x: 10, y: 20 }
  }), true, 'an anchored draft must not trap the user in the composer when they need to select a component or frame');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, inspectorOpen: true, inspectorTab: 'comments', activeCommentId: null }), true,
    'the ordinary comments list must leave the visible canvas available for selecting a component or frame');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, inspectorOpen: true, inspectorTab: 'design', activeCommentId: 'thread' }), true,
    'an open thread should preserve canvas access if the inspector tab changes on mobile');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, layersOpen: true, inspectorTab: 'design', commentToolActive: true }), true,
    'Comment mode must keep the exposed canvas interactive when the mobile Layers drawer is open');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, layersOpen: true, inspectorTab: 'comments' }), true,
    'an open Comments context must keep the exposed canvas interactive when the Layers drawer is open');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, layersOpen: true, inspectorTab: 'design' }), false,
    'the Layers drawer alone should keep its ordinary modal behavior outside comment review');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, hostViewOnly: true, layersOpen: true, inspectorTab: 'design', commentToolActive: true }), false,
    'view-only hosts must remain non-interactive while the Layers drawer is open');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: true, inspectorOpen: true, inspectorTab: 'design', pendingCommentAnchor: { pageId: 'page', x: 10, y: 20 } }), true,
    'the draft must preserve canvas access after selecting an object returns the inspector to Design');
  assert.equal(commentPanelCanvasIsInteractive({ mobile: false, inspectorOpen: false, inspectorTab: 'comments', activeCommentId: 'thread' }), false);
  assert.match(editorSource, /function syncMobilePanelAccessibility\(\)[\s\S]*?const layersOpen = mobile && panels\[0\]\.panel\.classList\.contains\('is-open'\);[\s\S]*?commentPanelCanvasIsInteractive\([\s\S]*?layersOpen,[\s\S]*?commentToolActive: state\.tool === 'comment',[\s\S]*?activeCommentId: state\.activeCommentId,[\s\S]*?pendingCommentAnchor: state\.pendingCommentAnchor[\s\S]*?canvasRegion\.inert = hostViewOnly \? false : anyOpen && !commentPanelCanvasAccess[\s\S]*?mobile-comment-canvas-interactive[\s\S]*?mobile-comment-canvas-open/,
    'the mobile accessibility state must expose the canvas while Comment mode, a draft, or a thread is active');
  assert.match(editorSource, /function finishCommentCanvasSelection\(target,[\s\S]*?if \(!state\.pendingCommentAnchor\) state\.pendingCommentText = ''[\s\S]*?setSelection\(\[target\.id\], \{ source: 'canvas' \}\)/,
    'selecting through an open draft must preserve the anchor and the unsent text');
  assert.match(editorSource, /state\.pendingCommentText = event\.target\.value/,
    'typing a new comment must keep its text when the inspector redraws after canvas selection');
  assert.match(editorSource, /required>\$\{replyTo \? '' : escapeHtml\(state\.pendingCommentText\)\}<\/textarea>/,
    'reopening the Comments tab must restore the retained draft text');
  assert.match(editorSource, /if \(state\.activeCommentId \|\| state\.inspectorTab === 'comments'\) \{[\s\S]*?state\.activeCommentId = null;[\s\S]*?closeMobilePanels\(\{ restoreFocus: false \}\)[\s\S]*?setInspectorTab\('design'\)/,
    'ordinary selection outside the Comments-panel route should still return the inspector to Design');
});

test('saved mobile comment review reserves a real canvas hit area above the panel', () => {
  const start = stylesheetSource.indexOf('/* Keep saved-comment review beside the canvas instead of over its hit area.');
  assert.ok(start >= 0, 'mobile saved-comment layout should have an explicit rule');
  const reviewLayout = stylesheetSource.slice(start);
  assert.match(reviewLayout, /\.app-shell\.mobile-comment-canvas-open > \.workspace\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/,
    'saved comment review should split the workspace into a canvas row and a comment row');
  assert.match(reviewLayout, /\.app-shell\.mobile-comment-canvas-open > \.workspace > \.canvas-region\s*\{[^}]*position:\s*relative;[^}]*grid-row:\s*1;/,
    'the canvas must occupy only its unobstructed grid row');
  assert.match(reviewLayout, /\.app-shell\.mobile-comment-canvas-open > \.workspace > \.left-panel\.is-open,[\s\S]*?\.app-shell\.mobile-comment-canvas-open > \.workspace > \.right-panel\.is-open\s*\{[\s\S]*?position:\s*relative;[\s\S]*?grid-row:\s*2;[\s\S]*?transform:\s*none;/,
    'either open mobile drawer must flow beside the canvas instead of intercepting its pointer events');
  assert.match(stylesheetSource, /\.app-shell\.mobile-comment-canvas-interactive > \.mobile-scrim\.is-visible\s*\{\s*display:\s*none;/,
    'comment review should not leave a scrim blocking the exposed canvas behind either mobile drawer');
  assert.match(reviewLayout, /@media \(max-width: 820px\) and \(max-height: 560px\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+min\(400px,\s*max\(280px,\s*42vw\)\)[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)/,
    'landscape phones should reserve a side inspector beside the canvas');
});

test('canvas hit testing reconciles panel-driven resizes before mapping the pointer to the document', () => {
  const pointerStart = editorSource.indexOf('function onCanvasPointerDown(event)');
  const pointerEnd = editorSource.indexOf('\nfunction updateDraftShapeGeometry', pointerStart);
  const pointerHandler = editorSource.slice(pointerStart, pointerEnd);
  const cameraSync = pointerHandler.indexOf('updateCanvasViewportCamera()');
  const hitMapping = pointerHandler.indexOf('const world = screenToWorld(event, canvas, state)');
  assert.ok(cameraSync >= 0 && hitMapping > cameraSync,
    'a tap after a mobile panel changes canvas size must use the current camera center before hit testing');
  assert.match(editorSource, /canvasViewportObserver\.observe\(canvas\)/,
    'canvas-only layout changes should also keep the artwork centered between pointer events');
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
  assert.match(submit, /createCommentThread\(state\.document, \{ \.\.\.anchor, text \}\);[\s\S]*?state\.commentSelectionCycle = null/,
    'posting a new pin must not inherit the component/frame cycle used while its draft was open');
});

test('Comment mode keeps object clicks for selection and uses explicit gestures to place comments', () => {
  const selection = editorSource.indexOf("if (state.tool === 'comment' && event.shiftKey)");
  const pin = editorSource.indexOf('const commentPin = state.commentPlacementArmed || state.pendingCommentAnchor ? null : commentPinAt(world);', selection);
  const placement = editorSource.indexOf("if (state.tool === 'comment') {\n    if (event.altKey", pin);
  assert.ok(selection >= 0 && pin > selection && placement > pin,
    'modifier selection and existing comment pins must be handled before the ordinary comment-mode path');
  assert.match(editorSource.slice(placement, editorSource.indexOf('if (clearPrototypeConnectPromptIfSourceMissing())', placement)),
    /commentCanvasAction\(target,[\s\S]*?addCommentShortcut: event\.altKey[\s\S]*?if \(action === 'select'\)[\s\S]*?setSelection\(\[target\.id\], \{ source: 'canvas' \}\)[\s\S]*?else if \(event\.altKey\) beginCommentAt\(world\)[\s\S]*?kind: 'comment-place'/,
    'object clicks select, Alt-click places directly, and an empty-canvas tap is deferred so a drag can pan');
  assert.match(editorSource.slice(placement, editorSource.indexOf('if (clearPrototypeConnectPromptIfSourceMissing())', placement)),
    /if \(action === 'select'\) \{[\s\S]*?state\.commentPlacementArmed = false;[\s\S]*?setSelection\(\[target\.id\], \{ source: 'canvas' \}\)/,
    'selecting an object must exit pending comment placement so later taps can select normally');
  assert.equal(commentCanvasAction({ id: 'frame' }), 'select');
  assert.equal(commentCanvasAction({ id: 'component' }), 'select');
  assert.equal(commentCanvasAction({ id: 'frame' }, { addCommentShortcut: true }), 'place-comment');
  assert.equal(commentCanvasAction({ id: 'frame' }, { addCommentShortcut: false }), 'select',
    'an object hit remains a selection target unless the explicit placement shortcut is used');
  assert.equal(commentCanvasAction(null), 'place-comment');
  assert.equal(commentPinOverridesCanvasSelection({ commentPin: { id: 'other-thread' }, activeCommentId: 'open-thread' }), false,
    'an open thread must let a canvas hit select the object beneath a different overlapping pin');
  assert.equal(commentPinOverridesCanvasSelection({ commentPin: { id: 'open-thread' }, activeCommentId: 'open-thread' }), true,
    'the active pin must reach its pin-specific component/frame cycle instead of the generic review route');
  assert.equal(commentPinOverridesCanvasSelection({ commentPin: { id: 'thread' }, activeCommentId: null }), true,
    'without an open thread, an existing pin retains its normal thread action');
  assert.equal(commentPinOverridesCanvasSelection({ commentPin: { id: 'thread' }, activeCommentId: 'thread', addCommentShortcut: true }), true,
    'the explicit comment shortcut keeps priority over selection even during thread review');
  assert.equal(commentPlacementGesturePans({ x: 12, y: 18 }, { x: 20, y: 18 }), false,
    'movement within the touch slop remains a comment-placement tap');
  assert.equal(commentPlacementGesturePans({ x: 12, y: 18 }, { x: 20.01, y: 18 }), true,
    'movement beyond the touch slop pans the canvas instead of opening the composer');
  assert.equal(commentPlacementGesturePans({ x: 12, y: 18 }, { x: Number.NaN, y: 18 }), false,
    'invalid pointer coordinates cannot turn a tap into a pan');
  assert.match(editorSource, /function commentTargetAt\(world, options\)[\s\S]*?commentSelectionTarget\(entry, \{[\s\S]*?preferHitContainer: state\.tool === 'comment' && options\?\.preferComponent !== false/,
    'canvas hits must resolve to an eligible frame or component');
  assert.match(editorSource, /state\.tool === 'comment' && event\.shiftKey\)[\s\S]*?selectCommentTargetAt\(world, \{ preferComponent: false \}\)/,
    'Shift-click must allow selecting a nested frame inside a component');
  assert.match(editorSource, /function cycleCommentSelectionAt\(world, event[^)]*\)[\s\S]*?advanceCommentSelection\(entry, state\.commentSelectionCycle,[\s\S]*?pointerType: event\.pointerType,[\s\S]*?x: world\.x,[\s\S]*?y: world\.y,[\s\S]*?tolerance: 24 \/ Math\.max\(\.08, state\.zoom\)/,
    'component/frame cycling should use a zoom-scaled document point so mobile canvas recentering cannot break the second click');
  assert.match(editorSource, /commentPinCanvasAction\(commentPin, target,[\s\S]*?state\.activeCommentId = null;[\s\S]*?setSelection\(\[target\.id\], \{ source: 'canvas' \}\)/,
    'clicking an already-active pin must let the object beneath it be selected');
  assert.match(editorSource, /if \(action === 'select'\) \{[\s\S]*?state\.activeCommentId = null;[\s\S]*?setSelection\(\[target\.id\], \{ source: 'canvas' \}\)/,
    'leaving comment mode selection should clear the active thread so its pin can be reopened');
  const pinHandlerStart = editorSource.indexOf('  if (commentPin) {');
  const pinHandlerEnd = editorSource.indexOf("  if (state.tool === 'comment') {", pinHandlerStart);
  const pinHandler = editorSource.slice(pinHandlerStart, pinHandlerEnd);
  assert.match(pinHandler, /const canSelectFromPin = state\.tool === 'comment' \|\| state\.tool === 'select';[\s\S]*?state\.tool === 'comment'[\s\S]*?cycleCommentSelectionAt\(world, event(?:, \{[\s\S]*?preservePinThreadAction: [^}]*\})?\)[\s\S]*?\{ target: commentTargetAt\(world\), cycled: false \}/,
    'Comment mode should cycle the component/frame beneath a pin while Select mode resolves the direct target');
  assert.match(pinHandler, /selectionCycled: pinSelection\.cycled/,
    'a repeated Comment-mode hit beneath a pin should be allowed to select the next container');
  assert.match(pinHandler, /forceCommentPinSelection = state\.tool === 'comment' && event\.shiftKey[\s\S]*?commentTargetAt\(world, \{ preferComponent: false \}\)[\s\S]*?forceSelect: forceCommentPinSelection/,
    'Shift-clicking an overlapping comment pin should resolve and select the nearest frame before opening its thread');
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
  assert.equal(commentPinCanvasAction({ id: 'thread' }, { id: 'frame' }, { tool: 'comment', activeCommentId: null, targetSelected: true, selectionCycled: true }), 'select',
    'a repeated hit that cycles to a nested frame should select it instead of reopening the pin thread');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, { id: 'frame' }, {
    tool: 'comment', activeCommentId: null, targetSelected: true, forceSelect: true
  }), 'select', 'Shift-click should select the frame beneath an overlapping pin even when its component is already selected');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, null, { tool: 'comment', activeCommentId: 'thread' }), 'open-thread');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, { id: 'frame' }, { tool: 'select', activeCommentId: 'thread' }), 'select',
    'an open thread pin should let Select mode escape to the object beneath it');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, { id: 'frame' }, { tool: 'select', activeCommentId: null }), 'select',
    'an unselected object under an inactive pin should get the first Select-mode click');
  assert.equal(commentPinCanvasAction({ id: 'thread' }, { id: 'frame' }, { tool: 'select', activeCommentId: null, targetSelected: true }), 'open-thread',
    'a second click can still open the inactive pin thread after selecting its target');
});

test('an active comment pin preserves component-to-frame selection cycling', () => {
  const component = { id: 'component', type: 'frame', isComponent: true };
  const frame = { id: 'frame', type: 'frame' };
  const child = { id: 'child', type: 'rectangle' };
  const entry = { node: child, parents: [component, frame] };
  const comment = { id: 'thread' };
  const first = advanceCommentSelection(entry, null, {
    pageId: 'page-a', pointerType: 'mouse', x: 42, y: 31, time: 100
  }, { preferHitContainer: true });
  assert.equal(first.target.id, component.id);
  assert.equal(commentPinCanvasAction(comment, first.target, {
    tool: 'comment', activeCommentId: comment.id, selectionCycled: first.cycled
  }), 'select', 'the active pin should release selection to its component');

  // Selecting through an active pin clears the thread ID, but the click-cycle
  // remains attached to this spot so the next hit can choose the nested frame.
  const second = advanceCommentSelection(entry, first.cycle, {
    pageId: 'page-a', pointerType: 'mouse', x: 42, y: 31, time: 220
  }, { preferHitContainer: true });
  assert.equal(second.target.id, frame.id);
  assert.equal(second.cycled, true);
  assert.equal(commentPinCanvasAction(comment, second.target, {
    tool: 'comment', activeCommentId: null, targetSelected: true, selectionCycled: second.cycled
  }), 'select', 'the repeated hit should select the nested frame rather than reopening its pin');

  const pinHandlerStart = editorSource.indexOf('  if (commentPin) {');
  const pinHandlerEnd = editorSource.indexOf("  if (state.tool === 'comment') {", pinHandlerStart);
  const pinHandler = editorSource.slice(pinHandlerStart, pinHandlerEnd);
  assert.match(pinHandler, /if \(forceCommentPinSelection\) state\.commentSelectionCycle = null/,
    'only an explicit Shift-click should reset the nested-frame cycle while a pin is active');
});

test('the first selection through an inactive comment pin keeps the nested-frame cycle', () => {
  const component = { id: 'component', type: 'frame', isComponent: true };
  const frame = { id: 'frame', type: 'frame' };
  const child = { id: 'child', type: 'rectangle' };
  const entry = { node: child, parents: [component, frame] };
  const comment = { id: 'thread' };
  const first = advanceCommentSelection(entry, null, {
    pageId: 'page-a', pointerType: 'mouse', x: 42, y: 31, time: 100
  }, { preferHitContainer: true });
  assert.equal(first.target.id, component.id);
  assert.equal(commentPinCanvasAction(comment, first.target, {
    tool: 'comment', activeCommentId: null, targetSelected: false, selectionCycled: first.cycled
  }), 'select', 'the first click on an inactive pin selects its underlying component');

  const firstPinCycle = commentPinSelectionCycle(first.cycle, comment.id);
  assert.equal(commentPinSelectionCycleMatches(firstPinCycle, comment.id), true,
    'the first selection must bind its hit path to the pin so the next click is not mistaken for a thread-open request');
  const second = advanceCommentSelection(entry, firstPinCycle, {
    pageId: 'page-a', pointerType: 'mouse', x: 42, y: 31, time: 220
  }, { preferHitContainer: true });
  assert.equal(second.target.id, frame.id);
  assert.equal(second.cycled, true);
  assert.equal(commentPinCanvasAction(comment, second.target, {
    tool: 'comment', activeCommentId: null, targetSelected: true, selectionCycled: second.cycled
  }), 'select', 'the next click selects the nested frame instead of opening the inactive pin thread');

  const pinHandlerStart = editorSource.indexOf('  if (commentPin) {');
  const pinHandlerEnd = editorSource.indexOf("  if (state.tool === 'comment') {", pinHandlerStart);
  const pinHandler = editorSource.slice(pinHandlerStart, pinHandlerEnd);
  assert.match(pinHandler, /if \(state\.tool === 'comment' && !forceCommentPinSelection\) \{[\s\S]*?state\.commentSelectionCycle = commentPinSelectionCycle\(state\.commentSelectionCycle, commentPin\.id\)/,
    'the initial non-Shift selection through an inactive pin must bind the selection cycle');
});

test('an inactive comment pin ignores stale tool-selection cycles but retains its own active-pin cycle', () => {
  const staleCycle = { targetId: 'component', targetPath: ['component', 'frame'], commentPinId: undefined };
  assert.equal(commentPinSelectionCycleMatches(staleCycle, 'thread'), false,
    'an ordinary component/frame selection cycle must not be mistaken for a pin cycle');
  const pinCycle = commentPinSelectionCycle(staleCycle, 'thread');
  assert.equal(commentPinSelectionCycleMatches(pinCycle, 'thread'), true,
    'a selection started beneath an active pin should remain bound to that pin');
  assert.equal(commentPinSelectionCycleMatches(pinCycle, 'other-thread'), false,
    'a pin cycle must never leak to another comment thread');

  const pinHandlerStart = editorSource.indexOf('  if (commentPin) {');
  const pinHandlerEnd = editorSource.indexOf("  if (state.tool === 'comment') {", pinHandlerStart);
  const pinHandler = editorSource.slice(pinHandlerStart, pinHandlerEnd);
  assert.match(pinHandler, /const activeCommentPin = commentPin\.id === state\.activeCommentId;[\s\S]*?const continuesPinCycle = commentPinSelectionCycleMatches\(state\.commentSelectionCycle, commentPin\.id\);[\s\S]*?else if \(state\.tool === 'comment' && !activeCommentPin && !continuesPinCycle\)[\s\S]*?state\.commentSelectionCycle = null/,
    'opening an inactive pin should discard a stale component/frame cycle left by another tool');
  assert.match(pinHandler, /state\.commentSelectionCycle = commentPinSelectionCycle\(state\.commentSelectionCycle, commentPin\.id\)/,
    'selecting through an active pin should explicitly preserve its own component/frame cycle');
});

test('empty-canvas Comment taps place on release while drags pan', () => {
  const moveStart = editorSource.indexOf('function onCanvasPointerMove(event)');
  const moveEnd = editorSource.indexOf('\nfunction updateDraftShapeGeometry', moveStart);
  const move = editorSource.slice(moveStart, moveEnd);
  assert.match(move, /interaction\.kind === 'comment-place'[\s\S]*?commentPlacementGesturePans\([\s\S]*?interaction\.kind = 'pan'[\s\S]*?state\.panX = interaction\.panX[\s\S]*?state\.panY = interaction\.panY/,
    'an empty-canvas drag in Comment mode becomes a view pan');
  const upStart = editorSource.indexOf('function onCanvasPointerUp(event)');
  const upEnd = editorSource.indexOf('\nfunction cancelCanvasInteraction', upStart);
  assert.match(editorSource.slice(upStart, upEnd), /interaction\.kind === 'comment-place'[\s\S]*?beginCommentAt\(interaction\.anchor\)/,
    'an unmoved empty-canvas tap adds a comment at its original canvas point');
  assert.match(editorSource, /interruptedInteraction\?\.kind === 'comment-place'[\s\S]*?state\.interaction = null/,
    'a second finger cancels the pending comment tap so pinch navigation cannot create a stray comment');
});

test('entering Comment mode releases image-edit modes that otherwise capture canvas taps', () => {
  const start = editorSource.indexOf('function setTool(tool) {');
  const end = editorSource.indexOf('\nfunction applyEyedropperColor', start);
  assert.ok(start >= 0 && end > start, 'the tool transition should be available for interaction');
  const transition = editorSource.slice(start, end);
  const commentEntry = transition.slice(transition.indexOf("if (tool === 'comment') {"), transition.indexOf("if (tool !== 'comment') {"));
  assert.match(commentEntry, /releaseCanvasCapturesForComment\(\)/,
    'entering Comment should release any canvas mode that intercepts selection taps');
  assert.ok(commentEntry.length && transition.indexOf('state.tool = tool;') > transition.indexOf("if (tool === 'comment') {"),
    'Comment should take ownership only after conflicting canvas modes have been released');
});

test('Comment mode reclaims canvas input when another tool is activated after Comment', () => {
  const captureStart = editorSource.indexOf('function releaseCanvasCapturesForComment()');
  const captureEnd = editorSource.indexOf('\nfunction setTool(tool)', captureStart);
  const captureRelease = editorSource.slice(captureStart, captureEnd);
  assert.match(captureRelease, /\['image-crop', 'image-fill-crop', 'image-erase', 'object-isolation', 'shape-builder'\][\s\S]*?cancelCanvasInteraction/,
    'Comment must cancel any in-flight image or vector gesture before hit testing');
  assert.match(captureRelease, /state\.imageCropMode = false;[\s\S]*?state\.imageFillCropTarget = null;[\s\S]*?syncImageCropOverlay\(\)[\s\S]*?state\.imageEraseMode = false;[\s\S]*?state\.imageEraseDraft = null/,
    'crop and erase capture flags must be released along with their gesture');
  assert.match(captureRelease, /state\.objectIsolationMode \|\| state\.objectIsolationController \|\| state\.objectIsolationSourceId[\s\S]*?resetObjectIsolationSession\(\)/,
    'Object isolation must not retain canvas ownership under Comment mode');

  const pointerStart = editorSource.indexOf('function onCanvasPointerDown(event)');
  const pointerEnd = editorSource.indexOf('\nfunction updateDraftShapeGeometry', pointerStart);
  const pointerHandler = editorSource.slice(pointerStart, pointerEnd);
  const reclaim = pointerHandler.indexOf("if ((state.tool === 'comment' || commentPanelNeedsCaptureRelease) && !isLiveHostViewOnly()) releaseCanvasCapturesForComment();");
  assert.ok(reclaim >= 0, 'Comment mode and an open comment thread should reclaim canvas input');
  for (const intercept of ['if (state.imageCropMode)', 'if (state.imageEraseMode', 'if (state.objectIsolationMode', 'if (state.shapeBuilder']) {
    const position = pointerHandler.indexOf(intercept);
    assert.ok(position > reclaim, `${intercept} must run after Comment reclaims canvas input`);
  }
});

test('the Comments panel keeps component/frame cycling when the canvas tool changes', () => {
  const start = editorSource.indexOf('function setTool(tool) {');
  const end = editorSource.indexOf('\nfunction applyEyedropperColor', start);
  const transition = editorSource.slice(start, end);
  assert.doesNotMatch(transition, /state\.commentSelectionCycle\s*=\s*null/,
    'toolbar changes must not reset the component/frame hit cycle before the same-point gesture can continue');
  assert.match(editorSource, /advanceCommentSelection\(entry, state\.commentSelectionCycle,[\s\S]*?time: performance\.now\(\),[\s\S]*?tolerance:/,
    'the hit cycle expires from its page, point, pointer type, and time bounds instead of toolbar state');
  const pointerStart = editorSource.indexOf('function onCanvasPointerDown(event)');
  const pointerEnd = editorSource.indexOf('\nfunction updateDraftShapeGeometry', pointerStart);
  const pointerHandler = editorSource.slice(pointerStart, pointerEnd);
  const continuedCycle = pointerHandler.indexOf('if (!commentSelectionOverridesTool && state.commentSelectionCycle)');
  const handPan = pointerHandler.indexOf("if (state.tool === 'hand' && commentSelectionOverridesTool");
  assert.ok(continuedCycle >= 0 && continuedCycle < handPan,
    'a repeated same-point hit should be offered to the saved comment cycle before the newly active tool consumes it');
  assert.match(pointerHandler.slice(continuedCycle, handPan), /cycleCommentSelectionAt\(world, event, \{[\s\S]*?\}\)[\s\S]*?state\.commentSelectionCycle = null;[\s\S]*?if \(selection\.cycled && selection\.target\)[\s\S]*?finishCommentCanvasSelection\(selection\.target, \{ cycled: true \}\)/,
    'the repeated hit should select its next component/frame target once, then return control to the active tool');
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
