import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDocument, createNode, createFillLayer, addNode, MAX_DOCUMENT_TREE_DEPTH, serializeDocument } from '../src/model.js';
import {
  buildLocalPackageBlob, importLocalPackage, localPackageFilename, MAX_FIG_SOURCE_ARCHIVE_BYTES,
  packLocalPackage, unpackLocalPackage
} from '../src/storage.js';

function packageWithManifest(source, mutate) {
  const manifestLength = new DataView(source.buffer, source.byteOffset + 7, 4).getUint32(0, true);
  const manifestStart = 11;
  const manifestEnd = manifestStart + manifestLength;
  const manifest = JSON.parse(new TextDecoder().decode(source.subarray(manifestStart, manifestEnd)));
  mutate(manifest);
  const nextManifest = new TextEncoder().encode(JSON.stringify(manifest));
  const output = new Uint8Array(11 + nextManifest.byteLength + source.byteLength - manifestEnd);
  output.set(source.subarray(0, 7));
  new DataView(output.buffer).setUint32(7, nextManifest.byteLength, true);
  output.set(nextManifest, 11);
  output.set(source.subarray(manifestEnd), 11 + nextManifest.byteLength);
  return output;
}

function legacyPackageWithoutFontManifest(document) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: document.schema, document, assets: [] }));
  const bytes = new Uint8Array(11 + manifest.byteLength);
  bytes.set([70, 76, 79, 67, 65, 76, 1]);
  new DataView(bytes.buffer).setUint32(7, manifest.byteLength, true);
  bytes.set(manifest, 11);
  return bytes;
}

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

test('portable local design includes image-library-only sources and validates their bytes', () => {
  const document = createDocument();
  document.imageLibrary = [{ assetId: 'library-only', name: 'library.png', type: 'image/png', width: 3, height: 2 }];
  const sourceBytes = new Uint8Array([0, 5, 10, 255]);

  assert.throws(() => packLocalPackage(document, []), /library-only.*bytes are missing/i,
    'a saved library source is a portable design reference even before it is placed on a page');
  const decoded = unpackLocalPackage(packLocalPackage(document, [
    { id: 'library-only', name: 'library.png', type: 'image/png', bytes: sourceBytes }
  ]));
  assert.deepEqual(decoded.document.imageLibrary, document.imageLibrary);
  assert.deepEqual(decoded.assets[0].bytes, sourceBytes);
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
  assert.equal(fontless.figSourceArchive, null, 'legacy packages have no preserved .fig source archive');
});

test('portable package v2 preserves an optional original .fig archive byte-for-byte', async () => {
  const source = new Uint8Array(await readFile(new URL('./fixtures/fig-import/circle-v101.fig', import.meta.url)));
  const imageBytes = new Uint8Array([9, 8, 7, 6]);
  const fontBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6, 7, 8]);
  const packed = packLocalPackage(createDocument(), [{
    id: 'source-image', name: 'source.png', type: 'image/png', bytes: imageBytes
  }], [{
    id: 'source-font', name: 'source.woff2', type: 'font/woff2', family: 'Source Sans',
    weight: 400, style: 'normal', bytes: fontBytes
  }], { figSourceArchive: source });
  assert.equal(packed[6], 2, 'the optional source payload is explicitly versioned');
  const manifestLength = new DataView(packed.buffer, packed.byteOffset + 7, 4).getUint32(0, true);
  const manifest = JSON.parse(new TextDecoder().decode(packed.subarray(11, 11 + manifestLength)));
  assert.deepEqual(manifest.figSourceArchive, { length: source.byteLength, checksum32: 1_103_869_895 },
    'the descriptor stores the standard CRC-32 of the pinned fixture');

  const unpacked = unpackLocalPackage(packed);
  assert.deepEqual(unpacked.assets[0].bytes, imageBytes);
  assert.deepEqual(unpacked.fonts[0].bytes, fontBytes);
  assert.deepEqual(unpacked.figSourceArchive, source);
  assert.equal(unpacked.figSourceArchive.buffer, packed.buffer,
    'source bytes remain a zero-copy view into the bounded package buffer');

  const legacy = unpackLocalPackage(legacyPackageWithoutFontManifest(createDocument()));
  assert.deepEqual(legacy.fonts, []);
  assert.equal(legacy.figSourceArchive, null,
    'pre-font FLOCAL v1 packages remain readable without inventing a source payload');
});

test('portable package v2 rejects a truncated, modified, malformed, or oversized .fig source archive', async () => {
  const source = new Uint8Array(await readFile(new URL('./fixtures/fig-import/circle-v101.fig', import.meta.url)));
  const packed = packLocalPackage(createDocument(), [], [], { figSourceArchive: source });
  assert.throws(() => unpackLocalPackage(packed.subarray(0, packed.length - 1)), /source archive data/i);

  const corrupted = packed.slice();
  corrupted[corrupted.length - 1] ^= 0xff;
  assert.throws(() => unpackLocalPackage(corrupted), /source archive.*checksum/i);

  const wrongLength = packageWithManifest(packed, manifest => { manifest.figSourceArchive.length += 1; });
  assert.throws(() => unpackLocalPackage(wrongLength), /source archive data/i);
  const badChecksum = packageWithManifest(packed, manifest => { manifest.figSourceArchive.checksum32 ^= 1; });
  assert.throws(() => unpackLocalPackage(badChecksum), /source archive.*checksum/i);
  const missingDescriptor = packageWithManifest(packed, manifest => { delete manifest.figSourceArchive; });
  assert.throws(() => unpackLocalPackage(missingDescriptor), /source archive metadata/i);
  const zeroLength = packageWithManifest(packed, manifest => { manifest.figSourceArchive.length = 0; });
  assert.throws(() => unpackLocalPackage(zeroLength), /source archive metadata/i);

  assert.throws(() => packLocalPackage(createDocument(), [], [], {
    figSourceArchive: new Uint8Array(MAX_FIG_SOURCE_ARCHIVE_BYTES + 1)
  }), /source archive.*preservation limit/i);
});

test('portable packages without .fig source data keep the legacy FLOCAL v1 representation', () => {
  const packaged = packLocalPackage(createDocument(), []);
  assert.equal(packaged[6], 1);
  assert.equal(unpackLocalPackage(packaged).figSourceArchive, null);
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
