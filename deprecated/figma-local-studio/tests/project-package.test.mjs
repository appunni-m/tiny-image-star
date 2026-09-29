import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialProject, createNode, validateProject } from '../src/model.js';
import { packProject, unpackProjectPackage } from '../src/project-package.js';

test('design package round-trips local image bytes alongside document metadata', async () => {
  const project = createInitialProject();
  const image = createNode('image', { sourceName: 'sample.bmp', sourceType: 'image/bmp', assetId: 'asset-1', adjustments: { brightness: 10, contrast: 0, saturation: 0, blur: 0 } });
  project.pages[0].nodes.push(image);
  const source = new Uint8Array([66, 77, 1, 2, 3, 4]);
  const packed = packProject(project, new Map([['asset-1', source]]));
  const unpacked = unpackProjectPackage(new Uint8Array(await packed.arrayBuffer()));
  assert.equal(validateProject(unpacked.project), true);
  assert.equal(unpacked.project.pages[0].nodes[1].sourceBytes, undefined);
  assert.deepEqual(unpacked.assets.get('asset-1').bytes, source);
  assert.equal(unpacked.assets.get('asset-1').name, 'sample.bmp');
});

test('design package rejects a truncated asset payload', async () => {
  const project = createInitialProject();
  const image = createNode('image', { assetId: 'asset-1' });
  project.pages[0].nodes.push(image);
  const bytes = new Uint8Array(await packProject(project, new Map([['asset-1', new Uint8Array([1, 2, 3])]])).arrayBuffer());
  assert.throws(() => unpackProjectPackage(bytes.subarray(0, bytes.length - 1)), /invalid/);
});
