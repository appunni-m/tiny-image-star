import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, createFillLayer, addNode, MAX_DOCUMENT_TREE_DEPTH, serializeDocument } from '../src/model.js';
import { buildLocalPackageBlob, importLocalPackage, localPackageFilename, packLocalPackage, unpackLocalPackage } from '../src/storage.js';

test('portable local design restores its metadata and byte-exact image assets', () => {
  const document = createDocument();
  addNode(document, createNode('image', { assetId: 'asset-a', fileName: 'photo.png' }));
  const bytes = new Uint8Array([0, 5, 10, 255]);
  const packed = packLocalPackage(JSON.parse(serializeDocument(document)), [{ id: 'asset-a', name: 'photo.png', type: 'image/png', bytes }]);
  const decoded = unpackLocalPackage(packed);
  assert.equal(decoded.document.pages[0].children[0].fileName, 'photo.png');
  assert.deepEqual(decoded.assets[0].bytes, bytes);
  assert.equal(decoded.assets[0].bytes.buffer, packed.buffer, 'image payloads should remain views into the bounded package buffer until import persists them');
});

test('portable package builders enforce a byte limit before allocating a packed payload', () => {
  const document = createDocument();
  const image = { id: 'bounded-image', name: 'large.png', type: 'image/png', bytes: new Uint8Array(64) };
  assert.throws(() => packLocalPackage(document, [image], [], { maxBytes: 32 }), /local package limit/i);
  assert.throws(() => buildLocalPackageBlob(document, [image], [], { maxBytes: 32 }), /local package limit/i);
});

test('portable package Blob is shareable and retains its package MIME type and embedded assets', async () => {
  const document = createDocument();
  addNode(document, createNode('image', { assetId: 'shared-image', fileName: 'source.png' }));
  const imageBytes = new Uint8Array([0, 1, 2, 255]);
  const fontBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6, 7, 8]);
  const blob = buildLocalPackageBlob(document, [{ id: 'shared-image', name: 'source.png', type: 'image/png', bytes: imageBytes }], [{
    id: 'shared-font', name: 'shared.woff2', type: 'font/woff2', family: 'Shared Sans', weight: 400, style: 'normal', bytes: fontBytes
  }]);

  assert.equal(blob.type, 'application/octet-stream');
  const packageData = unpackLocalPackage(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(packageData.document.id, document.id);
  assert.deepEqual(packageData.assets[0].bytes, imageBytes);
  assert.deepEqual(packageData.fonts[0].bytes, fontBytes);
});

test('portable package filename is a bounded safe basename with a stable extension', () => {
  assert.equal(localPackageFilename('../Résumé: Design. '), '-Résumé- Design.flocal');
  assert.equal(localPackageFilename('CON'), '_CON.flocal');
  assert.equal(localPackageFilename('...  '), 'design.flocal');
  assert.equal(localPackageFilename('x'.repeat(500)).length, 120);
  assert.equal(localPackageFilename('Project'), 'Project.flocal');
});

test('portable local design packages byte-exact font faces and remains compatible with fontless files', () => {
  const document = createDocument();
  const text = createNode('text', { fontFamily: 'Display Sans', fontWeight: 600 });
  addNode(document, text);
  const fontBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6, 7, 8]);
  const packaged = packLocalPackage(JSON.parse(serializeDocument(document)), [], [{
    id: 'font-display-semibold', name: 'display-sans-semibold.woff2', type: 'font/woff2',
    family: 'Display Sans', weight: 600, style: 'normal', bytes: fontBytes
  }]);
  const unpacked = unpackLocalPackage(packaged);
  assert.equal(unpacked.document.pages[0].children[0].fontFamily, 'Display Sans');
  assert.equal(unpacked.fonts[0].family, 'Display Sans');
  assert.equal(unpacked.fonts[0].weight, 600);
  assert.deepEqual(unpacked.fonts[0].bytes, fontBytes);
  assert.equal(unpacked.fonts[0].bytes.buffer, packaged.buffer, 'font payloads should remain views until validation or import needs ownership');

  const fontless = unpackLocalPackage(packLocalPackage(createDocument(), []));
  assert.deepEqual(fontless.fonts, [], 'older local packages remain readable without a font manifest');
});

test('portable local design rejects invalid font metadata, duplicate IDs, and truncated font payloads', () => {
  const font = { id: 'font-a', name: 'font.woff2', type: 'font/woff2', family: 'Font A', weight: 400, style: 'normal', bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6, 7, 8]) };
  assert.throws(() => packLocalPackage(createDocument(), [], [{ ...font, weight: 1001 }]), /weight/i);
  assert.throws(() => packLocalPackage(createDocument(), [], [font, { ...font, family: 'Other' }]), /duplicate font asset ID/i);
  const packaged = packLocalPackage(createDocument(), [], [font]);
  assert.throws(() => unpackLocalPackage(packaged.subarray(0, packaged.length - 1)), /invalid local design package font data/i);
});

test('portable local design rejects bad magic, truncation and trailing bytes', () => {
  const document = createDocument();
  const packageBytes = packLocalPackage(JSON.parse(serializeDocument(document)), []);
  assert.throws(() => unpackLocalPackage(new Uint8Array([1, 2, 3])), /invalid/i);
  assert.throws(() => unpackLocalPackage(packageBytes.subarray(0, packageBytes.length - 1)), /invalid/i);
  assert.throws(() => unpackLocalPackage(new Uint8Array([...packageBytes, 1])), /trailing/i);
});

test('portable packages require bytes for every live image and image-fill source but allow unused assets', () => {
  const document = createDocument();
  addNode(document, createNode('image', { assetId: 'photo-source' }));
  addNode(document, createNode('rectangle', {
    fills: [createFillLayer('image', { assetId: 'texture-source' })]
  }));
  const image = id => ({ id, name: `${id}.png`, type: 'image/png', bytes: new Uint8Array([1, 2, 3]) });

  assert.throws(() => packLocalPackage(document, []), /photo-source.*bytes are missing/i);
  assert.throws(() => packLocalPackage(document, [image('photo-source')]), /texture-source.*bytes are missing/i);
  assert.throws(() => packLocalPackage(document, [
    image('photo-source'), { id: 'texture-source', name: 'texture.png', type: 'image/png' }
  ]), /texture-source.*no readable bytes/i);
  const packaged = packLocalPackage(document, [image('photo-source'), image('texture-source'), image('unused-source')]);
  const unpacked = unpackLocalPackage(packaged);
  assert.deepEqual(unpacked.assets.map(asset => asset.id), ['photo-source', 'texture-source', 'unused-source']);
});

test('package decoder rejects missing sources and duplicate asset IDs in untrusted manifests', () => {
  const document = createDocument();
  addNode(document, createNode('image', { assetId: 'missing-source' }));
  const encodePackage = assets => {
    const manifest = new TextEncoder().encode(JSON.stringify({ schema: document.schema, document, assets }));
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, manifest.length, true);
    return new Uint8Array([...new Uint8Array([70, 76, 79, 67, 65, 76, 1]), ...length, ...manifest]);
  };

  assert.throws(() => unpackLocalPackage(encodePackage([])), /missing-source.*bytes are missing/i);
  assert.throws(() => unpackLocalPackage(encodePackage([
    { id: 'missing-source', name: 'a.png', type: 'image/png', length: 0 },
    { id: 'missing-source', name: 'b.png', type: 'image/png', length: 0 }
  ])), /duplicate image asset/i);
});

test('package decoder rejects deeply nested documents before recursive source-reference traversal', () => {
  const marker = '__deep_layer_tree__';
  const shallowDocument = createDocument();
  shallowDocument.pages[0].children = marker;
  let nestedLayer = '{"id":"deep-layer-5999","type":"group","children":[]}';
  for (let depth = 5_998; depth >= 0; depth -= 1) {
    nestedLayer = `{"id":"deep-layer-${depth}","type":"group","children":[${nestedLayer}]}`;
  }
  const manifestText = JSON.stringify({ schema: shallowDocument.schema, document: shallowDocument, assets: [] })
    .replace(JSON.stringify(marker), `[${nestedLayer}]`);
  const manifest = new TextEncoder().encode(manifestText);
  const bytes = new Uint8Array(11 + manifest.length);
  bytes.set([70, 76, 79, 67, 65, 76, 1]);
  new DataView(bytes.buffer).setUint32(7, manifest.length, true);
  bytes.set(manifest, 11);

  assert.throws(() => unpackLocalPackage(bytes), error => error instanceof TypeError
    && error.message.includes(`maximum depth of ${MAX_DOCUMENT_TREE_DEPTH}`),
  'the package boundary should reject excessive nesting with a controlled TypeError');
});

test('linked component roots share the document depth budget before package and import walks', async () => {
  const marker = '__deep_linked_roots__';
  const shallowDocument = createDocument();
  shallowDocument.pages[0].children = marker;
  let linkedRoot = '{"id":"linked-root-5999","type":"group","children":[]}';
  for (let depth = 5_998; depth >= 0; depth -= 1) {
    linkedRoot = `{"id":"linked-root-${depth}","type":"group","children":[],"linkedComponent":{"root":${linkedRoot}}}`;
  }
  const outerRoot = `{"id":"linked-outer","type":"group","children":[],"linkedComponent":{"root":${linkedRoot}}}`;
  const manifestText = JSON.stringify({ schema: shallowDocument.schema, document: shallowDocument, assets: [] })
    .replace(JSON.stringify(marker), `[${outerRoot}]`);
  const manifest = new TextEncoder().encode(manifestText);
  const bytes = new Uint8Array(11 + manifest.length);
  bytes.set([70, 76, 79, 67, 65, 76, 1]);
  new DataView(bytes.buffer).setUint32(7, manifest.length, true);
  bytes.set(manifest, 11);

  assert.throws(() => unpackLocalPackage(bytes), error => error instanceof TypeError
    && error.message.includes(`maximum depth of ${MAX_DOCUMENT_TREE_DEPTH}`),
  'linked roots must not reset nesting before the package reference walk');

  let linked = { id: 'linked-root-leaf', type: 'group', children: [] };
  for (let depth = 0; depth < MAX_DOCUMENT_TREE_DEPTH + 10; depth += 1) {
    linked = { id: `linked-root-import-${depth}`, type: 'group', children: [], linkedComponent: { root: linked } };
  }
  const directImport = createDocument();
  directImport.pages[0].children = [linked];
  await assert.rejects(importLocalPackage(directImport, []), error => error instanceof TypeError
    && error.message.includes(`maximum depth of ${MAX_DOCUMENT_TREE_DEPTH}`),
  'direct package imports must preflight linked trees before their recursive asset-reference scan');
});
