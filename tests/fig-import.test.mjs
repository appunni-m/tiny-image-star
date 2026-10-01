import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { zipSync } from 'fflate';
import { convertFigDocument, importFigBytes } from '../src/fig-import.js';
import { FIG_IMPORT_LIMITS, preflightFigArchive } from '../src/fig-import-preflight.js';

const fixture = name => new URL(`./fixtures/fig-import/${name}`, import.meta.url);
const circlePath = fixture('circle-v101.fig');
const vectorPath = fixture('openfigs-v106.fig');

function node(type, localID, parent, position, properties = {}) {
  return {
    guid: { sessionID: 1, localID }, type, name: `Layer ${localID}`,
    ...(parent ? { parentIndex: { guid: parent, position } } : {}),
    size: { x: 120, y: 80 },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    visible: true, opacity: 1, ...properties
  };
}

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function canvasWithMessage(message) {
  const schema = new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]);
  const bytes = new Uint8Array(12 + 4 + schema.length + 4 + message.length);
  bytes.set(new TextEncoder().encode('fig-kiwi'));
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 101, true);
  let offset = 12;
  view.setUint32(offset, schema.length, true); offset += 4;
  bytes.set(schema, offset); offset += schema.length;
  view.setUint32(offset, message.length, true); offset += 4;
  bytes.set(message, offset);
  return bytes;
}

function zip(entries) {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, [data, { level: 0 }]])), { level: 0 });
}

function canvasDataOffset(bytes, name = 'canvas.fig') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const entryName = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataOffset = offset + 30 + nameLength + extraLength;
    if (entryName === name) return dataOffset;
    offset = dataOffset + view.getUint32(offset + 18, true);
  }
  throw new Error(`Could not find ${name} in the test ZIP archive.`);
}

test('imports pinned .fig sample files from two parser format versions as editable local layers', async () => {
  const circleBytes = new Uint8Array(await readFile(circlePath));
  const vectorBytes = new Uint8Array(await readFile(vectorPath));
  assert.equal(createHash('sha256').update(circleBytes).digest('hex'), '5f8d89ce07c06615323ad5406cacc41e8da78d8fc0439ad0cdb2c2ba7e0d4038');
  assert.equal(createHash('sha256').update(vectorBytes).digest('hex'), 'eecd50d4d4135ab4b146bbbb7079b7b0743ee0325f2b8e6f2b37454b59c79c4b');

  const circle = importFigBytes(circleBytes, { fileName: 'circle-v101.fig' });
  assert.equal(circle.report.formatVersion, 101);
  assert.equal(circle.report.pages, 1);
  assert.deepEqual(circle.report.unsupportedTypes, {});
  assert.equal(circle.document.pages[0].children[0].type, 'frame');
  assert.equal(circle.document.pages[0].children[0].children[0].type, 'ellipse');
  assert.equal(circle.document.pages[0].children[0].children[0].width, 300);

  const vector = importFigBytes(vectorBytes, { fileName: 'openfigs-v106.fig' });
  assert.equal(vector.report.formatVersion, 106);
  assert.equal(vector.report.pages, 1);
  const frame = vector.document.pages[0].children[0];
  assert.equal(frame.type, 'frame');
  assert.equal(frame.children[0].type, 'group');
  assert.ok(frame.children[0].children.length >= 2);
  assert.ok(frame.children[0].children.every(child => child.type === 'path' && child.fills?.length));
});

test('preflight rejects truncated, corrupt, path-traversal, and over-budget archives before parser execution', async () => {
  const original = new Uint8Array(await readFile(circlePath));
  const canvas = preflightFigArchive(original).entries.get('canvas.fig');
  assert.throws(() => preflightFigArchive(original.subarray(0, original.length - 4)), /complete .fig ZIP archive/);

  const corrupt = zip({ 'canvas.fig': canvas });
  corrupt[canvasDataOffset(corrupt)] ^= 0xff;
  assert.throws(() => preflightFigArchive(corrupt), /integrity check/);

  assert.throws(() => preflightFigArchive(zip({ 'canvas.fig': canvas, '../escape': new Uint8Array([1]) })), /unsafe file path/);
  assert.throws(() => preflightFigArchive(zip({
    'canvas.fig': canvas,
    'meta.json': new Uint8Array(FIG_IMPORT_LIMITS.metadataBytes + 1)
  })), /metadata exceeds the safe import size limit/);

  const zstdHeader = new Uint8Array(9);
  zstdHeader.set([0x28, 0xb5, 0x2f, 0xfd, 0xa0]);
  new DataView(zstdHeader.buffer).setUint32(5, FIG_IMPORT_LIMITS.messageBytes + 1, true);
  assert.throws(() => preflightFigArchive(zip({ 'canvas.fig': canvasWithMessage(zstdHeader) })), /design data exceeds the safe import size limit/);
});

test('converts editable text, fills, constraints, and embedded images while reporting flattening and omissions', () => {
  const pageGuid = { sessionID: 1, localID: 1 };
  const frameGuid = { sessionID: 1, localID: 2 };
  const imageHash = 'a'.repeat(40);
  const png = pngHeader(2, 3);
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { name: 'Page 1' }),
      node('FRAME', 2, pageGuid, '!', { name: 'Main frame', frameMaskDisabled: false, fillPaints: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] }),
      node('RECTANGLE', 3, frameGuid, 'a', { name: 'Photo', fillPaints: [{ type: 'IMAGE', image: { hash: imageHash }, scaleMode: 'FIT', visible: true }] }),
      node('TEXT', 4, frameGuid, 'B', { name: 'Headline', textData: { characters: 'Hello mobile' }, fontName: { family: 'Inter', style: 'Semi Bold Italic' }, fontSize: 32, textAlignHorizontal: 'RIGHT', textAlignVertical: 'CENTER', textAutoResize: 'HEIGHT', paragraphSpacing: 2, fillPaints: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3, a: 1 }, opacity: 0.5, visible: true }] }),
      node('MYSTERY_CONTAINER', 5, frameGuid, 'c', { name: 'Kept container' }),
      node('ELLIPSE', 6, { sessionID: 1, localID: 5 }, '!', { name: 'Kept child', fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }] }),
      node('MYSTERY_LEAF', 7, frameGuid, 'z', { name: 'Omitted visible layer' }),
      node('BOOLEAN_OPERATION', 8, frameGuid, 'zz', { name: 'Invalid boolean', booleanOperation: 'UNION' }),
      node('__proto__', 9, frameGuid, 'zzz', { name: 'Unsafe warning key' })
    ],
    message: { blobs: [] },
    images: new Map([[imageHash, png]])
  };
  const imported = convertFigDocument(parsed, { fileName: 'mobile.fig', formatVersion: 106 });
  const frame = imported.document.pages[0].children[0];
  assert.equal(frame.clip, true);
  assert.deepEqual(frame.children.map(child => child.name), ['Headline', 'Photo', 'Kept container', 'Invalid boolean']);
  assert.equal(frame.children[0].fontFamily, 'Inter');
  assert.equal(frame.children[0].fontWeight, 600);
  assert.equal(frame.children[0].fontStyle, 'italic');
  assert.equal(frame.children[0].align, 'right');
  assert.equal(frame.children[0].verticalAlign, 'middle');
  assert.equal(frame.children[0].textFit, 'auto-height');
  assert.equal(frame.children[0].color, '#1a334d');
  assert.equal(frame.children[0].opacity, 0.5);
  assert.equal(Object.hasOwn(frame.children[0], 'fills'), false, 'text colors map to text properties, not an invalid shape fill stack');
  assert.equal(frame.children[1].fills[0].type, 'image');
  assert.deepEqual(imported.assets[0].bytes, png);
  assert.deepEqual(imported.document.imageLibrary.map(({ width, height }) => ({ width, height })), [{ width: 2, height: 3 }]);
  assert.equal(frame.children[2].type, 'group');
  assert.equal(frame.children[2].children[0].type, 'ellipse');
  assert.equal(frame.children[3].type, 'group');
  assert.equal(imported.report.flattenedTypes.MYSTERY_CONTAINER, 1);
  assert.equal(imported.report.flattenedTypes.BOOLEAN_OPERATION, 1);
  assert.equal(imported.report.unsupportedTypes.MYSTERY_LEAF, 1);
  assert.equal(imported.report.unsupportedTypes.__proto__, 1);
  assert.match(imported.report.warnings.find(warning => warning.type === 'MYSTERY_LEAF').detail, /omitted/);
});

test('bounds cyclic and deeply nested decoded parent graphs and reports detached visible nodes', () => {
  const page = { sessionID: 2, localID: 1 };
  const root = node('GROUP', 2, page, '!', { name: 'Root group' });
  const cycle = node('GROUP', 2, { sessionID: 2, localID: 2 }, '!', { name: 'Cycle edge' });
  const detached = node('ELLIPSE', 99, { sessionID: 2, localID: 100 }, '!', { name: 'Detached visible node' });
  const cyclic = convertFigDocument({ nodes: [node('CANVAS', 1, null, '', { guid: page }), root, cycle, detached], images: new Map(), message: { blobs: [] } });
  assert.ok(cyclic.report.unsupportedTypes.GROUP >= 1);
  assert.ok(cyclic.report.unsupportedTypes.ELLIPSE >= 1);

  const nodes = [node('CANVAS', 1, null, '', { guid: page })];
  let parent = page;
  for (let localID = 2; localID < 302; localID += 1) {
    nodes.push(node('GROUP', localID, parent, '!', { name: `Depth ${localID}` }));
    parent = { sessionID: 1, localID };
  }
  const bounded = convertFigDocument({ nodes, images: new Map(), message: { blobs: [] } });
  assert.equal(bounded.document.pages[0].children[0].type, 'group');
  assert.ok(bounded.report.unsupportedTypes.GROUP > 0);
  assert.ok(bounded.report.warnings.some(warning => warning.detail.includes('nesting limit')));
});
