import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { History } from '../src/history.js';
import { collectLiveImageAssetIds, collectLiveImagePreviewNodeIds, imagePreviewFailureStatus, imagePreviewKey, pruneImageAssetRuntime, pruneImagePreviewRuntime, setImagePreviewFailureStatus } from '../src/image-preview-runtime.js';

function runtimeMaps() {
  return {
    timers: new Map(),
    previews: new Map(),
    previewUrls: new Map(),
    previewAssetIds: new Map(),
    previewVersions: new Map(),
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

test('asset reachability includes current, undo, and redo snapshots before releasing source resources', () => {
  const current = { pages: [{ children: [
    { type: 'image', assetId: 'current-image', children: [] },
    { type: 'rectangle', imageFill: { assetId: 'shared-asset' }, children: [] },
    { type: 'group', children: [{ type: 'rectangle', fills: [
      { type: 'image', imageFill: { assetId: 'current-fill' } },
      { type: 'solid', color: '#fff' }
    ] }] }
  ] }] };
  const undo = { pages: [{ children: [{ type: 'image', assetId: 'undo-only', children: [] }] }] };
  const redo = { pages: [{ children: [{ type: 'rectangle', fills: [
    { type: 'image', imageFill: { assetId: 'redo-only' } }
  ], children: [] }] }] };
  const clipboardNodes = [{ type: 'image', assetId: 'clipboard-only', children: [] }];
  const liveAssetIds = collectLiveImageAssetIds([current, undo, redo], clipboardNodes);
  assert.deepEqual([...liveAssetIds].sort(), ['clipboard-only', 'current-fill', 'current-image', 'redo-only', 'shared-asset', 'undo-only']);

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
  const releaseStart = source.indexOf('function releasePreviewResources(previewKey)');
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
  const firstRender = body.indexOf('const result = await imageEngine.render(');
  const bitmapDecode = body.indexOf('bitmap = await createImageBitmap(previewBlob);');
  const publish = body.indexOf('releasePreviewResources(previewKey);', bitmapDecode);

  assert.ok(firstRender >= 0 && bitmapDecode > firstRender && publish > bitmapDecode, 'the preview render and bitmap decode both happen before publication');
  assert.ok(body.indexOf(fence, firstRender) > firstRender && body.indexOf(fence, firstRender) < bitmapDecode,
    'a newer edit or document replacement fences the WASM result before allocating a bitmap');
  assert.ok(body.indexOf(fence, bitmapDecode) > bitmapDecode && body.indexOf(fence, bitmapDecode) < publish,
    'a newer edit or document replacement fences a late bitmap before replacing the visible preview');
  assert.ok(body.slice(body.indexOf('} catch (error) {')).includes(`if (${fence}) return false;`),
    'stale errors cannot overwrite the newer preview status');
});

test('pruning deleted nodes cancels timers and releases only orphan preview resources', () => {
  const runtime = runtimeMaps();
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
  runtime.imageStatus.set('live-on-another-page', 'Updated');
  runtime.imageStatus.set('deleted-preview', 'Updated');
  runtime.renderVersion.set('live-on-another-page', 40);
  runtime.renderVersion.set('deleted-pending', 41);
  runtime.renderVersion.set('deleted-preview', 42);

  const released = pruneImagePreviewRuntime({
    ...runtime,
    liveNodeIds: new Set(['live-on-another-page']),
    clearTimer: timer => cancelled.push(timer),
    revokeUrl: url => revoked.push(url),
  });

  assert.deepEqual(released, { cancelledTimers: 1, releasedPreviews: 1, revokedUrls: 1 });
  assert.deepEqual(cancelled, [22]);
  assert.deepEqual(revoked, ['blob:deleted']);
  assert.deepEqual(closed, ['deleted']);
  for (const map of Object.values(runtime)) assert.equal(map.has('deleted-preview'), false);
  assert.equal(runtime.timers.has('deleted-pending'), false);
  assert.equal(runtime.renderVersion.has('deleted-pending'), false);
  assert.equal(runtime.previews.has('live-on-another-page'), true);
  assert.equal(runtime.previewUrls.get('live-on-another-page'), 'blob:live');
  assert.equal(runtime.previewAssetIds.get('live-on-another-page'), sharedAsset);
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
