import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, addNode, serializeDocument } from '../src/model.js';
import { packLocalPackage, unpackLocalPackage } from '../src/storage.js';

test('portable local design restores its metadata and byte-exact image assets', () => {
  const document = createDocument();
  addNode(document, createNode('image', { assetId: 'asset-a', fileName: 'photo.png' }));
  const bytes = new Uint8Array([0, 5, 10, 255]);
  const packed = packLocalPackage(JSON.parse(serializeDocument(document)), [{ id: 'asset-a', name: 'photo.png', type: 'image/png', bytes }]);
  const decoded = unpackLocalPackage(packed);
  assert.equal(decoded.document.pages[0].children[0].fileName, 'photo.png');
  assert.deepEqual(decoded.assets[0].bytes, bytes);
});

test('portable local design rejects bad magic, truncation and trailing bytes', () => {
  const document = createDocument();
  const packageBytes = packLocalPackage(JSON.parse(serializeDocument(document)), []);
  assert.throws(() => unpackLocalPackage(new Uint8Array([1, 2, 3])), /invalid/i);
  assert.throws(() => unpackLocalPackage(packageBytes.subarray(0, packageBytes.length - 1)), /invalid/i);
  assert.throws(() => unpackLocalPackage(new Uint8Array([...packageBytes, 1])), /trailing/i);
});
