import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeImageAssetReferences } from '../src/image-asset-restoration.js';

test('lazy source restore keeps every reference to the requested source and excludes unrelated images', () => {
  const references = [
    { assetId: 'page-image', previewKey: 'image-one' },
    { assetId: 'shared-fill', previewKey: 'fill-one' },
    { assetId: 'shared-fill', previewKey: 'fill-two' },
    { assetId: 'other-page-image', previewKey: 'image-other-page' }
  ];
  assert.deepEqual(scopeImageAssetReferences(references, ['shared-fill']), [references[1], references[2]]);
});

test('empty startup restore keeps all references and malformed requests fail explicitly', () => {
  const references = [{ assetId: 'first' }, { assetId: 'second' }];
  assert.equal(scopeImageAssetReferences(references), references);
  assert.equal(scopeImageAssetReferences(references, []).length, 2);
  assert.throws(() => scopeImageAssetReferences(references, 'first'), /must be a list/);
  assert.throws(() => scopeImageAssetReferences(null), /must be a list/);
});
