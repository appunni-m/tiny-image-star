import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLiveImagePreviewNodeIds, imagePreviewKey, pruneImagePreviewRuntime } from '../src/image-preview-runtime.js';

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
