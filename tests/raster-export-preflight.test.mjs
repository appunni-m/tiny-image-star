import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode } from '../src/model.js';
import { prepareRasterExportMasks } from '../src/raster-export-preflight.js';

function fixture() {
  const source = createNode('rectangle');
  const content = createNode('rectangle');
  const group = createNode('group', { mask: true, maskMode: 'luminance', maskSourceId: source.id });
  group.children = [content, source];
  const document = createDocument(); document.pages[0].children = [group];
  return { document, group, content, source };
}

test('raster mask preflight waits for a cold luminance runtime before resolving', async () => {
  const { document, group } = fixture();
  let release; let calls = 0; let complete = false;
  const loading = new Promise(resolve => { release = resolve; });
  const work = prepareRasterExportMasks(document, [group.id], { initialize: () => { calls++; return loading; } });
  work.then(() => { complete = true; });
  await Promise.resolve();
  assert.equal(calls, 1); assert.equal(complete, false);
  release(); await work;
  assert.equal(complete, true);
});

test('selecting content inside a luminance mask still initializes its clipping ancestor', async () => {
  const { document, content, source } = fixture();
  let calls = 0;
  await prepareRasterExportMasks(document, [content.id], { initialize: async () => { calls++; } });
  assert.equal(calls, 1);
  await prepareRasterExportMasks(document, [source.id], { initialize: async () => { calls++; } });
  assert.equal(calls, 1, 'exporting the source by itself bypasses its own masking parent');
});

test('alpha masks, hidden subtrees, and ordinary shapes do not initialize unused luminance code', async () => {
  const { document, group } = fixture();
  group.maskMode = 'alpha';
  const hidden = fixture().group; hidden.visible = false;
  const unrelated = createNode('rectangle');
  document.pages[0].children.push(hidden, unrelated);
  let calls = 0;
  await prepareRasterExportMasks(document, [group.id, hidden.id, unrelated.id], { initialize: async () => { calls++; } });
  assert.equal(calls, 0);
});

test('runtime load failures reject raster export before any composition or download', async () => {
  const { document, group } = fixture();
  const fault = new Error('Local mask WASM could not load');
  await assert.rejects(prepareRasterExportMasks(document, [group.id], { initialize: async () => { throw fault; } }), error => error === fault);
  await assert.rejects(prepareRasterExportMasks(document, ['removed-layer'], { initialize: async () => {} }), /no longer available/);
});

test('content that cannot paint through a hidden ancestor or mask source does not require the runtime', async () => {
  const { document, group, content, source } = fixture();
  const unused = () => { throw new Error('Unused runtime must not be initialized'); };
  group.visible = false;
  await prepareRasterExportMasks(document, [content.id], { initialize: unused });
  group.visible = true; source.visible = false;
  await prepareRasterExportMasks(document, [group.id, content.id], { initialize: unused });
});
