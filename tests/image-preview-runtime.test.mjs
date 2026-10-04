import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { History } from '../src/history.js';
import { canShowPreviousImagePreview, collectEditedImagePreviewRequests, collectLiveImageAssetIds, collectLiveImagePreviewNodeIds, imagePreviewFailureStatus, imagePreviewKey, imagePreviewOutputSettingsForNode, imagePreviewRenderSettingsForNode, imagePreviewRequiresRenderedPixels, imagePreviewSettingsChanged, imagePreviewSettingsForNode, imagePreviewSettingsSignature, imagePreviewSourceMatchesNode, offscreenPreviewEvictionCandidates, parseImagePreviewKey, pruneImageAssetRuntime, pruneImagePreviewRuntime, selectedImagePreviewKeysForNodes, setImagePreviewFailureStatus, shouldRestoreImageAssetSource } from '../src/image-preview-runtime.js';

function runtimeMaps() {
  return {
    timers: new Map(),
    previews: new Map(),
    previewUrls: new Map(),
    previewAssetIds: new Map(),
    previewVersions: new Map(),
    previewSignatures: new Map(),
    imageStatus: new Map(),
    renderVersion: new Map(),
  };
}

test('live preview references include raster and image-fill layers across every page', () => {
  const live = collectLiveImagePreviewNodeIds({ pages: [
    { children: [
      { id: 'source-image', type: 'image', assetId: 'source', children: [] },
      { id: 'image-fill', type: 'rectangle', imageFill: { assetId: 'source' }, children: [] },
      { id: 'nested-group', type: 'group', children: [
        { id: 'nested-image-fill', type: 'path', imageFill: { assetId: 'source' }, children: [] }
      ] },
      { id: 'missing-source', type: 'image', assetId: null, children: [] },
      { id: 'explicit-fill-stack', type: 'rectangle', fills: [
        { id: 'image-fill-paint', type: 'image', imageFill: { assetId: 'source' } },
        { id: 'hidden-fill-paint', type: 'image', visible: false, imageFill: { assetId: 'source' } }
      ], children: [] },
      { id: 'plain-vector', type: 'rectangle', children: [] }
    ] },
    { children: [{ id: 'other-page-image', type: 'image', assetId: 'another-source', children: [] }] }
  ] });

  assert.deepEqual([...live].sort(), [
    'image-fill',
    'image-fill:["explicit-fill-stack","hidden-fill-paint"]',
    'image-fill:["explicit-fill-stack","image-fill-paint"]',
    'nested-image-fill',
    'other-page-image',
    'source-image'
  ]);
  assert.equal(imagePreviewKey('shape', 'fill-1'), 'image-fill:["shape","fill-1"]');
  assert.notEqual(imagePreviewKey('copy-a', 'fill-1'), imagePreviewKey('copy-b', 'fill-1'), 'duplicated layers do not share per-fill preview resources');
});

test('preview signatures include pixel inputs but ignore export-only format and quality', () => {
  const first = imagePreviewSettingsSignature({
    assetId: 'photo', adjustments: { contrast: 12, brightness: 4 },
    transforms: { rotation: 90, crop: { left: .1, top: 0, right: .9, bottom: 1 } },
    inpaintStrokes: [{ radius: 8, points: [{ x: 2, y: 4 }] }], outputFormat: 'jpeg', outputQuality: 82
  });
  const reordered = imagePreviewSettingsSignature({
    outputQuality: 82, outputFormat: 'jpeg',
    inpaintStrokes: [{ points: [{ y: 4, x: 2 }], radius: 8 }],
    transforms: { crop: { bottom: 1, right: .9, top: 0, left: .1 }, rotation: 90 },
    adjustments: { brightness: 4, contrast: 12 }, assetId: 'photo'
  });
  assert.equal(first, reordered, 'object property order cannot invalidate a preview');
  for (const input of [
    { assetId: 'other' },
    { adjustments: { brightness: 5 } },
    { transforms: { rotation: 180 } },
    { inpaintStrokes: [] }
  ]) {
    const changed = imagePreviewSettingsSignature({
      assetId: 'photo', adjustments: { contrast: 12, brightness: 4 },
      transforms: { rotation: 90, crop: { left: .1, top: 0, right: .9, bottom: 1 } },
      inpaintStrokes: [{ radius: 8, points: [{ x: 2, y: 4 }] }], outputFormat: 'jpeg', outputQuality: 82,
      ...input
    });
    assert.notEqual(changed, first, 'asset, adjustments, transforms, and erase strokes invalidate a preview');
  }
  assert.equal(imagePreviewSettingsSignature({ assetId: 'photo', adjustments: {}, transforms: {}, inpaintStrokes: [] }),
    imagePreviewSettingsSignature({ assetId: 'photo', adjustments: {}, transforms: {}, inpaintStrokes: [], outputFormat: 'webp', outputQuality: 22 }),
  'changing the eventual download codec and quality must leave the lossless canvas preview current');
  assert.equal(imagePreviewRequiresRenderedPixels({ outputFormat: 'webp', outputQuality: 22 }), false,
    'export-only settings do not require a new preview render');
  assert.equal(imagePreviewRequiresRenderedPixels({ adjustments: { brightness: 5 }, outputFormat: 'jpeg', outputQuality: 40 }), true,
    'pixel-changing adjustments still require a rendered preview');
});

test('preview worker settings retain a saved image recipe codec and quality', () => {
  assert.deepEqual(imagePreviewOutputSettingsForNode({
    id: 'recipe-target', type: 'image', outputFormat: 'webp', outputQuality: 73,
  }), { format: 'webp', quality: 73 });
  assert.deepEqual(imagePreviewOutputSettingsForNode({ id: 'default-image', type: 'image' }), {
    format: 'png', quality: 90,
  });
  assert.deepEqual(imagePreviewOutputSettingsForNode({ id: 'shape', type: 'rectangle' }), {
    format: 'png', quality: 90,
  }, 'image-fill previews do not inherit image-layer export settings');
});

test('an async preview restore cannot render a source that no longer belongs to its live layer', async () => {
  const image = { id: 'image', type: 'image', assetId: 'original-a', adjustments: { brightness: 12 } };
  const fillShape = { id: 'shape', type: 'rectangle', fills: [
    { id: 'photo-fill', type: 'image', imageFill: { assetId: 'fill-a' } },
  ] };
  const fillKey = imagePreviewKey(fillShape.id, 'photo-fill');
  const capturedAssetId = image.assetId;
  let continueRestore;
  const restore = new Promise(resolve => { continueRestore = resolve; }).then(() =>
    imagePreviewSourceMatchesNode(image, imagePreviewKey(image.id), capturedAssetId));

  image.assetId = 'original-b';
  continueRestore();

  assert.equal(await restore, false, 'a source captured before async storage work is rejected after the live layer switches assets');
  assert.equal(imagePreviewSourceMatchesNode(image, imagePreviewKey(image.id), image.assetId), true);
  assert.equal(imagePreviewSourceMatchesNode(fillShape, fillKey, 'fill-a'), true);
  fillShape.fills[0].imageFill.assetId = 'fill-b';
  assert.equal(imagePreviewSourceMatchesNode(fillShape, fillKey, 'fill-a'), false,
    'image-fill previews are fenced against the current paint source too');
  assert.equal(imagePreviewSourceMatchesNode(fillShape, fillKey, 'missing'), false);
});

test('previous previews are temporary fallbacks only for same-source adjustment changes', () => {
  const original = {
    assetId: 'photo', adjustments: { brightness: 8 },
    transforms: { rotation: 90, crop: { left: .1, top: 0, right: .9, bottom: 1 } },
    inpaintStrokes: []
  };
  const signature = imagePreviewSettingsSignature(original);
  const current = { ...original, adjustments: { brightness: -24 } };

  assert.equal(canShowPreviousImagePreview(current, 'photo', signature), true,
    'the old color frame can stay visible while the matching source and crop rerender');
  assert.equal(canShowPreviousImagePreview({ ...current, assetId: 'other' }, 'photo', signature), false,
    'a previous source must never stand in for a different image');
  assert.equal(canShowPreviousImagePreview({ ...current, transforms: { ...current.transforms, rotation: 180 } }, 'photo', signature), false,
    'a previous geometry transform must not be shown against new crop or rotation settings');
  assert.equal(canShowPreviousImagePreview({ ...current, inpaintStrokes: [{ radius: 3, points: [{ x: 4, y: 5 }] }] }, 'photo', signature), false,
    'a changed erase mask has different pixels and must fail closed');
  assert.equal(canShowPreviousImagePreview({ ...original, adjustments: { brightness: 8 } }, 'photo', signature), false,
    'the helper is only for a genuinely changed adjustment while its new render is pending');
  assert.equal(canShowPreviousImagePreview({
    assetId: 'photo', adjustments: {}, transforms: {}, inpaintStrokes: []
  }, 'photo', imagePreviewSettingsSignature({
    assetId: 'photo', adjustments: { brightness: 8 }, transforms: {}, inpaintStrokes: []
  })), false, 'an unedited source should render directly instead of showing an obsolete adjusted frame');
  assert.equal(canShowPreviousImagePreview(current, 'other', signature), false,
    'the retained bitmap asset identity must match the live image');
});

test('undo and redo detect object-erase changes even when image transforms and adjustments match', async () => {
  const before = {
    assetId: 'photo', adjustments: { brightness: 12 }, transforms: { rotation: 90 },
    inpaintStrokes: [{ radius: 8, points: [{ x: 2, y: 4 }] }],
  };
  const afterUndo = { ...before, inpaintStrokes: [] };
  const afterRedo = { ...before, inpaintStrokes: [{ radius: 8, points: [{ x: 2, y: 4 }, { x: 5, y: 7 }] }] };

  assert.equal(imagePreviewSettingsChanged(before, afterUndo), true,
    'undoing object erase changes the preview pixels even when the source, color edits, and crop are unchanged');
  assert.equal(imagePreviewSettingsChanged(afterUndo, afterRedo), true,
    'redoing or extending object erase must refresh the preview too');
  assert.equal(imagePreviewSettingsChanged(before, { ...before, outputFormat: 'jpeg', outputQuality: 40 }), false,
    'download-only settings do not invalidate a canvas preview');

  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = mainSource.indexOf('function refreshHistoryImagePreviews(');
  const end = mainSource.indexOf('\nfunction undo()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = mainSource.slice(start, end);
  assert.match(body, /inpaintStrokes = \[\]/);
  assert.match(body, /inpaintStrokes: previousSource\.inpaintStrokes/);
  assert.match(body, /imagePreviewSettingsChanged\(previousSettings, \{ assetId, adjustments, transforms, inpaintStrokes \}\)/);
});

test('async preview work resolves edit values from the current layer, not a captured stale snapshot', async () => {
  const node = {
    id: 'photo', type: 'image', assetId: 'source',
    adjustments: { brightness: 12 },
    transforms: { rotation: 90 },
    outputFormat: 'jpeg', outputQuality: 76,
    inpaintStrokes: [{ radius: 4, points: [{ x: 8, y: 9 }] }],
  };
  // A restore caller can capture these before yielding to storage or decoding.
  const capturedAdjustments = node.adjustments;
  const capturedTransforms = node.transforms;
  node.adjustments = { brightness: -35, contrast: 22 };
  node.transforms = { rotation: 270, flipHorizontal: true };
  node.outputFormat = 'webp';
  node.outputQuality = 63;

  const current = imagePreviewRenderSettingsForNode(node, imagePreviewKey(node.id), 'source');
  assert.notEqual(current.adjustments, capturedAdjustments);
  assert.notEqual(current.transforms, capturedTransforms);
  assert.deepEqual(current, {
    assetId: 'source', adjustments: { brightness: -35, contrast: 22 },
    transforms: { rotation: 270, flipHorizontal: true },
    inpaintStrokes: [{ radius: 4, points: [{ x: 8, y: 9 }] }],
  });
  assert.equal(imagePreviewSettingsSignature(current), imagePreviewSettingsSignature({
    assetId: 'source', adjustments: node.adjustments, transforms: node.transforms,
    inpaintStrokes: node.inpaintStrokes,
  }));
  assert.equal(imagePreviewSettingsSignature(current), imagePreviewSettingsSignature({
    assetId: 'source', adjustments: node.adjustments, transforms: node.transforms, inpaintStrokes: node.inpaintStrokes,
  }), 'live output settings remain available for exports without invalidating the preview pixels');
  assert.equal(node.outputFormat, 'webp');
  assert.equal(node.outputQuality, 63);

  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const renderStart = mainSource.indexOf('async function renderImagePreview(');
  const renderEnd = mainSource.indexOf('function reconcileImagePreviewRuntime', renderStart);
  const renderBody = mainSource.slice(renderStart, renderEnd);
  assert.match(renderBody, /imagePreviewSourceMatchesNode\(previewLayer, previewKey, assetId\)/,
    'a source captured before an async restore must still belong to the live layer before worker dispatch');
  assert.match(renderBody, /imagePreviewRenderSettingsForNode\(previewLayer, previewKey\)/,
    'the render signature uses the current layer source instead of reapplying the captured asset ID');
  assert.ok(renderBody.indexOf('imagePreviewSourceMatchesNode(previewLayer, previewKey, assetId)')
    < renderBody.indexOf('const asset = state.assets.get(liveAssetId)'),
  'stale restore results are rejected before obtaining the source bytes or mutating the active preview token');
  assert.match(renderBody, /\.\.\.imagePreviewOutputSettingsForNode\(imageNode\)/,
    'Pillow jobs carry per-image output settings while the worker still encodes previews as lossless PNG');
  const signatureSnapshot = renderBody.indexOf('const previewSignature = imagePreviewSettingsSignature(previewSettings);');
  const renderDispatch = renderBody.indexOf('await renderImageWithEdits(');
  assert.ok(signatureSnapshot >= 0 && signatureSnapshot < renderDispatch,
    'settings identity is snapshotted before an async worker can overlap later edits');
  assert.match(renderBody, /renderImageWithEdits\(imageNode, \{ assetId: liveAssetId, sourceBytes: asset\.sourceBytes \}, previewSettings\.adjustments, previewTransforms/,
    'Pillow receives the same current edit values that are later written into the preview signature');
  assert.match(renderBody, /state\.previewSignatures\.set\(previewKey, previewSignature\)/,
    'a successfully rendered bitmap is only marked current for its actual model settings');
  assert.match(renderBody, /state\.renderVersion\.get\(previewKey\) !== version \|\| !previewSourceIsCurrent\(\)/,
    'source changes during Pillow rendering or bitmap decoding fence publication even if no newer edit scheduled a render');
});

test('preview keys round-trip node and image-fill identity', () => {
  assert.deepEqual(parseImagePreviewKey(imagePreviewKey('image-node')), { nodeId: 'image-node', fillId: null });
  assert.deepEqual(parseImagePreviewKey(imagePreviewKey('shape-node', 'fill-1')), { nodeId: 'shape-node', fillId: 'fill-1' });
  assert.throws(() => parseImagePreviewKey('image-fill:bad-json'), /malformed/);
  assert.throws(() => parseImagePreviewKey(''), /nonempty string/);
});

test('offscreen selected recipe targets can be evicted while other selected previews stay protected', async () => {
  const nodes = [
    { id: 'batch-complete', type: 'image', assetId: 'a' },
    { id: 'batch-inflight', type: 'image', assetId: 'b' },
    { id: 'selected-other', type: 'image', assetId: 'c' },
    { id: 'selected-shape', type: 'rectangle', fills: [
      { id: 'image-paint', type: 'image', imageFill: { assetId: 'd' } },
    ] },
  ];
  const protectedKeys = selectedImagePreviewKeysForNodes(nodes, {
    excludedNodeIds: new Set(['batch-complete', 'batch-inflight']),
  });
  assert.deepEqual([...protectedKeys].sort(), [
    'image-fill:["selected-shape","image-paint"]',
    'selected-other',
  ]);
  const candidates = offscreenPreviewEvictionCandidates({
    previews: new Map(nodes.filter(node => node.type === 'image').map(node => [node.id, {}])),
    protectedPreviewKeys: protectedKeys,
  });
  assert.deepEqual(candidates.sort(), ['batch-complete', 'batch-inflight']);

  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const selectedStart = source.indexOf('function selectedImagePreviewKeys()');
  const busyStart = source.indexOf('function busyImagePreviewKeys()', selectedStart);
  const protectedSourceStart = source.indexOf('function protectedImageSourceAssetIds', busyStart);
  assert.ok(selectedStart >= 0 && busyStart > selectedStart && protectedSourceStart > busyStart);
  assert.match(source.slice(selectedStart, busyStart), /canSkipSelectedImagePreviewLookup\(bulk, state\.selectedIds\)[\s\S]*?selectedImagePreviewKeysForNodes\(selectedNodes\(\), \{ excludedNodeIds: batchTargetIds \}\)/,
    'selected recipe targets must be excluded from permanent selection pins, with an exact-selection fast path');
  assert.match(source.slice(busyStart, protectedSourceStart), /Processing recipe/,
    'the currently admitted recipe target stays protected while it hydrates or renders');
});

test('Tile previews ignore crop while retaining rotation and flips for source-sized repeats', () => {
  const transforms = { crop: { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 }, rotation: 270, flipHorizontal: true };
  const image = { id: 'image', type: 'image', assetId: 'photo', fit: 'tile', transforms };
  const fill = { id: 'paint', type: 'image', imageFill: { assetId: 'photo', fit: 'tile', transforms } };
  const shape = { id: 'shape', type: 'rectangle', fills: [fill] };
  assert.deepEqual(imagePreviewSettingsForNode(image, 'image').transforms, {
    crop: null, rotation: 270, flipHorizontal: true
  });
  assert.deepEqual(imagePreviewSettingsForNode(shape, imagePreviewKey('shape', 'paint')).transforms, {
    crop: null, rotation: 270, flipHorizontal: true
  });
  assert.deepEqual(transforms.crop, { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 },
    'switching to Tile is non-destructive and keeps the prior crop available when Fill/Fit is restored');
});

test('cloning schedules only image and image-fill previews whose edited pixels need rendering', async () => {
  const nodes = [{
    id: 'edited-image', type: 'image', assetId: 'photo', adjustments: { brightness: 12 }, children: []
  }, {
    id: 'image-fill-shape', type: 'rectangle', imageFill: {
      assetId: 'legacy-fill-photo', adjustments: { contrast: 8 }
    }, children: []
  }, {
    id: 'stacked-fills', type: 'rectangle', fills: [
      { id: 'edited-paint', type: 'image', imageFill: { assetId: 'paint-photo', adjustments: { saturation: 4 } } },
      { id: 'unchanged-paint', type: 'image', imageFill: { assetId: 'unchanged-photo' } }
    ], children: [{ id: 'nested-image', type: 'image', assetId: 'nested-photo', transforms: { rotation: 90 }, children: [] }]
  }];

  const requests = collectEditedImagePreviewRequests(nodes);
  assert.deepEqual(requests.map(({ node, fillId }) => [node.id, fillId]), [
    ['edited-image', null],
    ['image-fill-shape', 'legacy-fill:image-fill-shape'],
    ['stacked-fills', 'edited-paint'],
    ['nested-image', null]
  ]);

  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const [start, end] of [
    ['function duplicateSelectionForCanvasDrag(', '\nfunction '],
    ['function pasteSelectedLayers(', '\nfunction ']
  ]) {
    const bodyStart = source.indexOf(start);
    const body = source.slice(bodyStart, source.indexOf(end, bodyStart + 10));
    assert.match(body, /scheduleEditedImagePreviews\(/, `${start} must rebuild a clone's newly keyed raster previews`);
  }
  const pageStart = source.indexOf("if (action === 'duplicate') {", source.indexOf('function managePageAction('));
  const pageBody = source.slice(pageStart, source.indexOf("if (action === 'delete')", pageStart));
  assert.match(pageBody, /scheduleEditedImagePreviews\(copy\.children\)/,
    'duplicated pages also receive fresh previews for their renewed layer IDs');
});

test('offscreen preview candidates preserve visible, selected, in-flight, and current previews in LRU order', () => {
  const previews = new Map([
    ['least-recent', {}], ['visible', {}], ['selected', {}], ['in-flight', {}], ['current', {}], ['recent-offscreen', {}]
  ]);
  const candidates = offscreenPreviewEvictionCandidates({
    previews,
    visiblePreviewKeys: new Set(['visible']),
    protectedPreviewKeys: new Set(['selected', 'in-flight']),
    excludedPreviewKeys: new Set(['current'])
  });
  assert.deepEqual(candidates, ['least-recent', 'recent-offscreen']);
});

test('presentation crossfades only current Pillow preview settings and receives the live preview maps', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const renderStart = source.indexOf('async function renderImagePreview(');
  const renderEnd = source.indexOf('function reconcileImagePreviewRuntime', renderStart);
  const renderBody = source.slice(renderStart, renderEnd);
  assert.ok(renderBody.indexOf('state.previewSignatures.set(previewKey, previewSignature)')
    > renderBody.indexOf('state.previewAssetIds.set(previewKey, assetId)'),
  'a signature is committed with the decoded preview after the matching asset ID');

  const endpointStart = source.indexOf('function smartAnimateImageTransitionEndpoint(');
  const endpointEnd = source.indexOf('\nfunction resolveSmartAnimateImageTransition', endpointStart);
  const endpointBody = source.slice(endpointStart, endpointEnd);
  assert.match(endpointBody, /state\.previewSignatures\.get\(previewKey\) === signature/,
    'settings edits invalidate a prior preview even when its asset ID still matches');
  assert.match(endpointBody, /status\.startsWith\('Ready'\) \|\| status\.startsWith\('Updated'\)/,
    'processing and failed previews cannot become transition endpoints');
  assert.match(endpointBody, /if \(!previewIsCurrent && !sourceRenderable\) return null/,
    'edited images require their exact endpoint preview, while unedited images can render from source bytes');
  assert.doesNotMatch(endpointBody, /outputFormat === 'png' && outputQuality === 90/,
    'download encoding choices must not make unchanged source pixels unavailable in Smart Animate');

  const frameStart = source.indexOf('function renderPresentationFrame(');
  const frameEnd = source.indexOf('\nfunction ', frameStart + 10);
  const frameBody = source.slice(frameStart, frameEnd);
  assert.match(frameBody, /resolveImageTransition: resolveSmartAnimateImageTransition/,
    'presentation gives Smart Animate the verified-preview resolver');
  assert.match(frameBody, /presentRenderState\.previewSignatures = state\.previewSignatures/,
    'the presentation renderer gets the same freshness metadata as the editor');
});

test('visible deferred previews are connected to the live editor and presentation render states', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const rendererSource = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');
  assert.match(mainSource, /previewDeferredKeys: new Set\(\), requestDeferredPreview: requestDeferredImagePreview/,
    'the main renderer receives the deferred-preview loader');
  assert.match(mainSource, /previewDeferredKeys: state\.previewDeferredKeys,\s*requestDeferredPreview: requestDeferredImagePreview/,
    'presentation rendering shares the same deferred-preview loader');
  assert.match(rendererSource, /state\.requestDeferredPreview\?\.\(previewKey\)/,
    'a preview is scheduled when its image enters the viewport');
  assert.match(mainSource, /state\.previewVersions\.clear\(\); state\.previewDeferredKeys\.clear\(\)/,
    'document teardown clears deferred work for the previous design');
});

test('offscreen sources restore on demand and bulk targets hydrate before their Pillow render', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const restoreStart = source.indexOf('async function restoreImageAssets(');
  const restoreEnd = source.indexOf('\nfunction syncBulkBarTicker()', restoreStart);
  const restoreBody = source.slice(restoreStart, restoreEnd);
  assert.match(restoreBody, /shouldRestoreImageAssetSource\(\{[\s\S]*?alreadyResident: Boolean\(state\.assets\.get\(assetId\)\?\.sourceBytes\)[\s\S]*?visible: visiblePreviewKeys\.has\(previewKey\)[\s\S]*?\}\)\) continue;[\s\S]*?await loadActiveImageAssetMetadata\(assetId\)/,
    'offscreen assets avoid metadata reads and bitmap decoding until a view or edit needs them');
  assert.match(source, /function ensureImageAssetResident\(assetId, previewKey[\s\S]*?imageAssetRestoreTasks\.get\(taskKey\)[\s\S]*?restoreImageAssets\(generation, \{ assetIds: \[assetId\], previewKeys: \[previewKey\], skipPreview: true \}\)/,
    'concurrent requests for one asset share an on-demand restore');
  const batchStart = source.indexOf('function scheduleBulk()');
  const batchEnd = source.indexOf('\nfunction restoreImageRecipeBatchConcurrency', batchStart);
  const batchBody = source.slice(batchStart, batchEnd);
  assert.match(batchBody, /hydrateAndAdmitImageRecipeTarget\(\{[\s\S]*?ensureResident: ensureImageAssetResident[\s\S]*?isGenerationCurrent:[\s\S]*?isBatchCurrent:[\s\S]*?resolveTarget:[\s\S]*?expectedNode: node[\s\S]*?onAdmit: currentEntry => \{[\s\S]*?applyImageRecipe\([\s\S]*?deferBackgroundRemoval: true[\s\S]*?applyBackgroundRemovalRecipeToTarget\(currentNode, bulk\.recipe\.backgroundRemoved[\s\S]*?queueSave\([\s\S]*?renderImagePreview\(id, currentNode\.assetId/,
    'bulk jobs hydrate first, then revalidate generation, batch, node, and asset before applying or saving a recipe');
  assert.match(batchBody, /const recipeRenderVersion = state\.renderVersion\.get\(id\);[\s\S]*?bulk\.renderVersions\.set\(id, recipeRenderVersion\)/,
    'the job records its render fence only after the hydrated target passes admission and dispatches');
});

test('only visible or explicitly used originals are restored into memory', () => {
  assert.equal(shouldRestoreImageAssetSource(), false, 'offscreen cold sources are not decoded at startup');
  assert.equal(shouldRestoreImageAssetSource({ visible: true }), true, 'viewport images hydrate for display');
  assert.equal(shouldRestoreImageAssetSource({ explicitlyRequested: true }), true, 'edits and batch targets can hydrate offscreen sources');
  assert.equal(shouldRestoreImageAssetSource({ requestedLibrarySource: true }), true, 'placing a library source hydrates its original');
  assert.equal(shouldRestoreImageAssetSource({ alreadyResident: true }), true, 'resident sources remain reusable across visible references');
});

test('editing and export entry points rehydrate cold originals before consuming bytes', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const eraseStart = source.indexOf('async function toggleImageEraseMode(node)');
  const eraseEnd = source.indexOf('\nfunction updateImageEraseStrokes', eraseStart);
  assert.match(source.slice(eraseStart, eraseEnd), /await ensureImageAssetResident\(node\.assetId, imagePreviewKey\(node\.id\)/,
    'object erase restores a cold selected original before opening the brush');
  const exportStart = source.indexOf('async function refreshImagesForExport(');
  const exportEnd = source.indexOf('\nfunction safeExportName', exportStart);
  assert.match(source.slice(exportStart, exportEnd), /await ensureImageAssetResident\(assetId, previewKey\)[\s\S]*?const asset = state\.assets\.get\(assetId\)/,
    'PNG, SVG, slice, and selection exports hydrate source assets before preflight');
  const imageExportStart = source.indexOf('async function exportEditedImageSource(');
  assert.match(source.slice(imageExportStart), /await ensureImageAssetResident\(node\.assetId, imagePreviewKey\(node\.id\)\)[\s\S]*?const asset = state\.assets\.get\(node\.assetId\)/,
    'full-resolution edited-original download restores its source before dimensions are inspected');
  const pdfStart = source.indexOf('async function vectorPdfImagePreviews(');
  assert.match(source.slice(pdfStart), /await restoreImageAssets\(state\.documentGeneration,[\s\S]*?previewKeys: requestedReferences\.map\(reference => reference\.previewKey\)[\s\S]*?const references = vectorPdfRasterReferences/,
    'vector PDF preflight hydrates the complete selected image set before choosing source or preview bytes');
});

test('asset reachability includes current, undo, and redo snapshots before releasing source resources', () => {
  const current = { pages: [{ children: [
    { type: 'image', assetId: 'current-image', backgroundRemoved: true, backgroundRemovalSourceAssetId: 'current-original', backgroundRemovalAssetId: 'current-transparent', resolutionBoosted: true, resolutionBoostSourceAssetId: 'current-resolution-source', resolutionBoostAssetId: 'current-4x', children: [] },
    { type: 'rectangle', imageFill: { assetId: 'shared-asset' }, children: [] },
    { type: 'group', children: [{ type: 'rectangle', fills: [
      { type: 'image', imageFill: { assetId: 'current-fill' } },
      { type: 'solid', color: '#fff' }
    ] }] }
  ] }], imageLibrary: [{ assetId: 'library-only-source' }] };
  const undo = { pages: [{ children: [{ type: 'image', assetId: 'undo-only', children: [] }] }] };
  const redo = { pages: [{ children: [{ type: 'rectangle', fills: [
    { type: 'image', imageFill: { assetId: 'redo-only' } }
  ], children: [] }] }] };
  const clipboardNodes = [{ type: 'image', assetId: 'clipboard-only', children: [] }];
  const liveAssetIds = collectLiveImageAssetIds([current, undo, redo], clipboardNodes);
  assert.deepEqual([...liveAssetIds].sort(), ['clipboard-only', 'current-4x', 'current-fill', 'current-image', 'current-original', 'current-resolution-source', 'current-transparent', 'library-only-source', 'redo-only', 'shared-asset', 'undo-only']);

  const closed = [];
  const revoked = [];
  const disposed = [];
  const released = [];
  const assets = new Map([...liveAssetIds, 'orphan'].map(assetId => [assetId, {
    sourceBytes: new Uint8Array([1, 2, 3]),
    bitmap: { close: () => closed.push(assetId) },
    bitmapUrl: `blob:${assetId}`
  }]));
  const orphan = assets.get('orphan');
  const result = pruneImageAssetRuntime({
    liveAssetIds,
    assets,
    disposeSource: assetId => disposed.push(assetId),
    releaseMemory: assetId => released.push(assetId),
    revokeUrl: url => revoked.push(url)
  });

  assert.deepEqual(result, { releasedAssets: 1, closedBitmaps: 1, revokedUrls: 1 });
  assert.deepEqual(closed, ['orphan']);
  assert.deepEqual(revoked, ['blob:orphan']);
  assert.deepEqual(disposed, ['orphan']);
  assert.deepEqual(released, ['orphan']);
  assert.deepEqual([...assets.keys()].sort(), [...liveAssetIds].sort());
  assert.equal(orphan.sourceBytes, null, 'the pruned source buffer is detached from its old runtime record');
  assert.ok(assets.get('undo-only').sourceBytes instanceof Uint8Array, 'undo can restore a retained source without reloading it');
});

test('an image asset is reclaimed only after undo and redo history can no longer restore it', () => {
  const history = new History(1);
  const imageDocument = { pages: [{ children: [{ id: 'image', type: 'image', assetId: 'history-image', children: [] }] }] };
  let current = imageDocument;
  history.checkpoint(current, 'Delete image');
  current = { pages: [{ children: [] }] };
  const clipboardNodes = [{ id: 'image', type: 'image', assetId: 'history-image', children: [] }];
  const closed = [];
  const revoked = [];
  const disposed = [];
  const released = [];
  const assets = new Map([['history-image', {
    sourceBytes: new Uint8Array([1]),
    bitmap: { close: () => closed.push('history-image') },
    bitmapUrl: 'blob:history-image'
  }]]);
  const prune = () => pruneImageAssetRuntime({
    liveAssetIds: collectLiveImageAssetIds([
      current,
      ...history.undoStack.map(step => step.document),
      ...history.redoStack.map(step => step.document)
    ], clipboardNodes),
    assets,
    disposeSource: assetId => disposed.push(assetId),
    releaseMemory: assetId => released.push(assetId),
    revokeUrl: url => revoked.push(url)
  });

  assert.equal(prune().releasedAssets, 0, 'the undo snapshot can restore the deleted image');
  current = history.undo(current);
  assert.equal(collectLiveImageAssetIds([current, ...history.undoStack.map(step => step.document), ...history.redoStack.map(step => step.document)]).has('history-image'), true);
  assert.equal(prune().releasedAssets, 0, 'the current document can still restore and use the image');
  current = history.redo(current);
  assert.equal(prune().releasedAssets, 0, 'the undo snapshot still makes the image recoverable after redo');

  history.checkpoint(current, 'Later edit');
  assert.equal(prune().releasedAssets, 0, 'the clipboard still needs the source for paste after the last history snapshot is evicted');
  clipboardNodes.length = 0;
  assert.equal(prune().releasedAssets, 1, 'once history and clipboard can no longer restore the image, the source can be reclaimed');
  assert.deepEqual(closed, ['history-image']);
  assert.deepEqual(revoked, ['blob:history-image']);
  assert.deepEqual(disposed, ['history-image']);
  assert.deepEqual(released, ['history-image']);
  assert.equal(assets.has('history-image'), false);
});

test('preview failure replaces the processing status with a stable recoverable state', () => {
  const statuses = new Map([['shared-image-node', 'Processing locally…']]);
  assert.equal(setImagePreviewFailureStatus(statuses, 'shared-image-node', new Error('worker failed')), 'Preview failed');
  assert.equal(statuses.get('shared-image-node'), 'Preview failed');
  assert.equal(imagePreviewFailureStatus({ previewFallbackShown: true }), 'Preview unavailable · showing original');
});

test('restoring a preview from an already-loaded shared asset records its failure status', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('if (existing?.sourceBytes)');
  assert.notEqual(start, -1, 'restore path should reuse an already-loaded shared source');
  const end = source.indexOf('continue;', start);
  assert.notEqual(end, -1, 'shared-source branch should continue without loading duplicate bytes');
  const branch = source.slice(start, end);
  assert.match(branch, /setImagePreviewFailureStatus\(state\.imageStatus, previewKey, error\)/);
  assert.match(branch, /updateSelectedImageStatus\(node\.id, previewKey, fillId\)/);
});

test('editor preview disposal cannot strand references or skip cleanup when browser disposers throw', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const releaseStart = source.indexOf('function releasePreviewResources(previewKey,');
  const renderStart = source.indexOf('async function renderImagePreview(', releaseStart);
  assert.notEqual(releaseStart, -1);
  assert.notEqual(renderStart, -1);
  const releaseBody = source.slice(releaseStart, renderStart);
  assert.match(releaseBody, /state\.previews\.delete\(previewKey\);\s*try \{ preview\?\.close\?\.\(\); \} catch/);
  assert.match(releaseBody, /state\.previewUrls\.delete\(previewKey\);\s*try \{ if \(url\) URL\.revokeObjectURL\(url\); \} catch/);
  assert.match(releaseBody, /imageMemoryBudget\.release\(previewMemoryKey\(previewKey\)\)/);
  const renderBody = source.slice(renderStart, source.indexOf('function reconcileImagePreviewRuntime', renderStart));
  assert.match(renderBody, /finally \{[\s\S]*?try \{ bitmap\?\.close\?\.\(\); \} catch/);
  assert.match(renderBody, /try \{ if \(previewUrl\) URL\.revokeObjectURL\(previewUrl\); \} catch/);
});

test('late editor renders are fenced after both async boundaries before publishing a preview', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const renderStart = source.indexOf('async function renderImagePreview(');
  const renderEnd = source.indexOf('function reconcileImagePreviewRuntime', renderStart);
  assert.notEqual(renderStart, -1);
  assert.notEqual(renderEnd, -1);
  const body = source.slice(renderStart, renderEnd);
  const fence = 'generation !== state.documentGeneration || state.renderVersion.get(previewKey) !== version';
  const firstRender = body.indexOf('const result = await renderImageWithEdits(');
  const bitmapDecode = body.indexOf('bitmap = await createImageBitmap(previewBlob);');
  const publish = body.indexOf('releasePreviewResources(previewKey);', bitmapDecode);

  assert.ok(firstRender >= 0 && bitmapDecode > firstRender && publish > bitmapDecode, 'the preview render and bitmap decode both happen before publication');
  assert.ok(body.indexOf(fence, firstRender) > firstRender && body.indexOf(fence, firstRender) < bitmapDecode,
    'a newer edit or document replacement fences the WASM result before allocating a bitmap');
  assert.ok(body.indexOf(fence, bitmapDecode) > bitmapDecode && body.indexOf(fence, bitmapDecode) < publish,
    'a newer edit or document replacement fences a late bitmap before replacing the visible preview');
  assert.ok(body.slice(body.indexOf('} catch (error) {')).includes(`if (${fence} || !previewSourceIsCurrent()) return false;`),
    'stale errors cannot overwrite the newer preview status');
});

test('preview memory is reserved before worker dispatch and held through decode and publication', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const renderStart = source.indexOf('async function renderImagePreview(');
  const renderEnd = source.indexOf('function reconcileImagePreviewRuntime', renderStart);
  assert.notEqual(renderStart, -1);
  assert.notEqual(renderEnd, -1);
  const body = source.slice(renderStart, renderEnd);
  const dimensions = body.indexOf('const transformedDimensions = transformedImageDimensions(sourceDimensions.width, sourceDimensions.height, previewTransforms);');
  const cappedDimensions = body.indexOf('const outputDimensions = imagePreviewDimensions(transformedDimensions.width, transformedDimensions.height, previewMaxDimension);');
  const estimate = body.indexOf('estimatePreviewMemoryReservationBytes(outputDimensions)');
  const reserve = body.indexOf('reserveImagePreviewMemory(previewAdmission.retainedBytes, previewKey)');
  const reservationScope = body.indexOf('withImageMemoryReservation(imageMemoryBudget, reservation, async () => {');
  const dispatch = body.indexOf('await renderImageWithEdits(');
  const decode = body.indexOf('bitmap = await createImageBitmap(previewBlob);');
  const commit = body.indexOf('imageMemoryBudget.commit(reservation, currentMemoryKey, { bytes: retainedBytes');
  const publish = body.indexOf('state.previews.set(previewKey, bitmap);');

  assert.ok(dimensions >= 0 && cappedDimensions > dimensions && estimate > cappedDimensions && reserve > estimate && reservationScope > reserve && dispatch > reservationScope,
    'the bounded crop/rotation preview dimensions must reserve the conservative preview budget before worker dispatch');
  const reserveStart = source.indexOf('function reserveImageMemory(bytes, { kind =');
  const reserveEnd = source.indexOf('function reserveImagePreviewMemory', reserveStart);
  assert.ok(reserveStart >= 0 && reserveEnd > reserveStart);
  assert.match(source.slice(reserveStart, reserveEnd), /offscreenPreviewEvictionCandidates[\s\S]*?releasePreviewResources\(previewKey, \{ defer: true \}\)[\s\S]*?imageMemoryBudget\.reserve\(bytes[\s\S]*?imageSourceResidency\.evictionCandidates[\s\S]*?releaseResidentImageAsset\(assetId(?:, sourceReferences)?\)/,
    'memory admission defers offscreen previews, then releases least-recent unprotected image sources before rejecting a worker request');
  assert.match(source.slice(reserveEnd, source.indexOf('function requestDeferredImagePreview', reserveEnd)), /reserveImageMemory\(bytes, \{ kind: 'preview-pending', excludePreviewKeys: \[currentPreviewKey\] \}\)/,
    'preview reservations use the shared safe-memory eviction policy');
  assert.ok(decode > dispatch && commit > decode && publish > commit,
    'the reservation stays in force through bitmap decoding and is committed before preview publication');
  assert.ok(body.indexOf('result.bytes.byteLength > previewAdmission.encodedByteLength') > dispatch
    && body.indexOf('result.bytes.byteLength > previewAdmission.encodedByteLength') < decode,
  'the returned PNG must fit the conservative encoded-output reservation before bitmap allocation');
});

test('resident image sources stay pinned while renders use them and memory admission evicts only unprotected LRU sources', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const renderStart = source.indexOf('async function renderImagePreview(');
  const renderEnd = source.indexOf('function reconcileImagePreviewRuntime', renderStart);
  const render = source.slice(renderStart, renderEnd);
  assert.match(render, /sourceLease = imageSourceResidency\.acquire\(liveAssetId\)/);
  assert.match(render, /sourceLease\?\.release\(\)/);

  const reserveStart = source.indexOf('function reserveImageMemory(bytes, { kind =');
  const reserveEnd = source.indexOf('function reserveImagePreviewMemory', reserveStart);
  const reserve = source.slice(reserveStart, reserveEnd);
  assert.match(reserve, /imageSourceResidency\.evictionCandidates\(\{ exclude: excludedAssets \}\)/);
  assert.match(reserve, /protectedImageSourceAssetIds\(\{ excludeAssetIds, references: sourceReferences \}\)/);
  assert.match(reserve, /releaseResidentImageAsset\(assetId, sourceReferences\)/);
  assert.match(source, /state\.documentTransitioning \|\| state\.imageExportAbortController \|\| state\.localPackageBuilding/,
    'document replacement, exports, and package creation must keep source bytes stable');
});

test('interactive preview resolution follows image display size within phone and desktop caps', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const renderStart = source.indexOf('async function renderImagePreview(');
  const renderEnd = source.indexOf('function reconcileImagePreviewRuntime', renderStart);
  const body = source.slice(renderStart, renderEnd);
  assert.match(body, /imagePreviewMaxDimensionForNode\(previewLayer, state\.document, pageId, \{[\s\S]*?zoom: Math\.max\(\.5, state\.zoom\)[\s\S]*?pixelRatio[\s\S]*?maximumDimension: previewDimensionCeiling/,
    'preview size should follow the actual transformed image layer and account for device pixels, zoom, and device caps');
  assert.match(body, /const previewDimensionCeiling = innerWidth <= 820 \|\| Number\(navigator\.deviceMemory\) > 0 && navigator\.deviceMemory <= 4 \? 2048 : 4096/,
    'phone and low-memory devices should use a lower hard ceiling than desktop');
  assert.match(body, /queueGroup, previewMaxDimension/,
    'each interactive render should pass its bound through the local worker queue');
});

test('pruning deleted nodes cancels timers and releases only orphan preview resources', () => {
  const runtime = runtimeMaps();
  const deferredPreviewKeys = new Set(['live-on-another-page', 'deleted-preview']);
  const cancelled = [];
  const revoked = [];
  const closed = [];
  const sharedAsset = 'shared-image-source';

  runtime.timers.set('live-on-another-page', 11);
  runtime.timers.set('deleted-pending', 22);
  runtime.previews.set('live-on-another-page', { close: () => closed.push('live') });
  runtime.previews.set('deleted-preview', { close: () => closed.push('deleted') });
  runtime.previewUrls.set('live-on-another-page', 'blob:live');
  runtime.previewUrls.set('deleted-preview', 'blob:deleted');
  runtime.previewAssetIds.set('live-on-another-page', sharedAsset);
  runtime.previewAssetIds.set('deleted-preview', sharedAsset);
  runtime.previewVersions.set('live-on-another-page', 4);
  runtime.previewVersions.set('deleted-preview', 5);
  runtime.previewSignatures.set('live-on-another-page', 'live-settings');
  runtime.previewSignatures.set('deleted-preview', 'deleted-settings');
  runtime.imageStatus.set('live-on-another-page', 'Updated');
  runtime.imageStatus.set('deleted-preview', 'Updated');
  runtime.renderVersion.set('live-on-another-page', 40);
  runtime.renderVersion.set('deleted-pending', 41);
  runtime.renderVersion.set('deleted-preview', 42);

  const released = pruneImagePreviewRuntime({
    ...runtime,
    liveNodeIds: new Set(['live-on-another-page']),
    deferredPreviewKeys,
    clearTimer: timer => cancelled.push(timer),
    revokeUrl: url => revoked.push(url),
  });

  assert.deepEqual(released, { cancelledTimers: 1, releasedPreviews: 1, revokedUrls: 1 });
  assert.deepEqual(cancelled, [22]);
  assert.deepEqual(revoked, ['blob:deleted']);
  assert.deepEqual(closed, ['deleted']);
  for (const map of Object.values(runtime)) assert.equal(map.has('deleted-preview'), false);
  assert.deepEqual([...deferredPreviewKeys], ['live-on-another-page'], 'deferred markers survive for live references and are pruned with deleted nodes');
  assert.equal(runtime.timers.has('deleted-pending'), false);
  assert.equal(runtime.renderVersion.has('deleted-pending'), false);
  assert.equal(runtime.previews.has('live-on-another-page'), true);
  assert.equal(runtime.previewUrls.get('live-on-another-page'), 'blob:live');
  assert.equal(runtime.previewAssetIds.get('live-on-another-page'), sharedAsset);
  assert.equal(runtime.previewSignatures.get('live-on-another-page'), 'live-settings');
  assert.equal(runtime.renderVersion.get('live-on-another-page'), 40);
});

test('preview pruning continues cleaning later resources when browser disposers throw', () => {
  const runtime = runtimeMaps();
  runtime.timers.set('broken-preview', 1);
  runtime.timers.set('healthy-preview', 2);
  runtime.previews.set('broken-preview', { close() { throw new Error('bitmap already detached'); } });
  runtime.previews.set('healthy-preview', { close() {} });
  runtime.previewUrls.set('broken-preview', 'blob:broken');
  runtime.previewUrls.set('healthy-preview', 'blob:healthy');
  runtime.previewAssetIds.set('broken-preview', 'asset');
  runtime.previewVersions.set('broken-preview', 1);
  runtime.imageStatus.set('broken-preview', 'Updated');
  runtime.renderVersion.set('broken-preview', 1);

  const result = pruneImagePreviewRuntime({
    ...runtime,
    liveNodeIds: new Set(),
    clearTimer(timer) { if (timer === 1) throw new Error('timer already cleared'); },
    revokeUrl(url) { if (url === 'blob:broken') throw new Error('URL already revoked'); },
  });

  assert.deepEqual(result, { cancelledTimers: 2, releasedPreviews: 1, revokedUrls: 1 });
  for (const map of Object.values(runtime)) {
    assert.equal(map.has('broken-preview'), false);
    assert.equal(map.has('healthy-preview'), false);
  }
});

test('removing a node render token fences an in-flight preview from publishing', async () => {
  const runtime = runtimeMaps();
  runtime.renderVersion.set('removed-while-rendering', 101);
  let completeRender;
  let published = false;
  const render = new Promise(resolve => { completeRender = resolve; }).then(() => {
    if (runtime.renderVersion.get('removed-while-rendering') === 101) published = true;
  });

  pruneImagePreviewRuntime({ ...runtime, liveNodeIds: new Set() });
  completeRender();
  await render;

  assert.equal(published, false);
  assert.equal(runtime.renderVersion.has('removed-while-rendering'), false);
});
