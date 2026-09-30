import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoredZip, MAX_STORED_ZIP_BYTES } from '../src/store-zip.js';

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    const data = bytes.slice(dataStart, dataStart + size);
    files.set(name, { data, crc, flags, method });
    offset = dataStart + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50, 'the central directory should follow local entries');
  let entries = 0;
  while (view.getUint32(offset, true) === 0x02014b50) {
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
    entries += 1;
  }
  assert.equal(view.getUint32(offset, true), 0x06054b50, 'the archive should finish with EOCD');
  assert.equal(view.getUint16(offset + 8, true), entries);
  assert.equal(view.getUint16(offset + 10, true), entries);
  assert.equal(offset + 22, bytes.byteLength, 'the EOCD should end the archive');
  return files;
}

test('stored ZIP keeps separate image payloads and emits valid UTF-8 store records', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const webp = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  const archive = await createStoredZip([
    { name: 'Portrait.png', data: new Blob([png], { type: 'image/png' }) },
    { name: 'Café.webp', data: webp }
  ]);
  assert.equal(archive.type, 'application/zip');
  const files = readZip(new Uint8Array(await archive.arrayBuffer()));
  assert.deepEqual([...files.keys()], ['Portrait.png', 'Café.webp']);
  assert.deepEqual([...files.get('Portrait.png').data], [...png]);
  assert.deepEqual([...files.get('Café.webp').data], [...webp]);
  for (const file of files.values()) {
    assert.equal(file.method, 0, 'image payloads should use ZIP store mode');
    assert.equal(file.flags & 0x0800, 0x0800, 'UTF-8 filenames should be declared');
  }
  assert.equal(files.get('Portrait.png').crc, 0x7a07_09a4);
});

test('ZIP limit rejects before reading an entry or allocating archive data', async () => {
  class UnreadableBlob extends Blob {
    stream() { throw new Error('oversized entry was read before preflight'); }
  }
  const data = new UnreadableBlob([new Uint8Array(32)]);
  await assert.rejects(createStoredZip([{ name: 'large.png', data }], { maxArchiveBytes: 64 }), {
    name: 'RangeError', message: /local archive limit/
  });
  await assert.rejects(createStoredZip([{ name: 'image.png', data: new Uint8Array([1]) }], { maxArchiveBytes: 20 }), {
    name: 'RangeError', message: /byte limit is invalid/
  });
});

test('ZIP rejects unsafe, duplicate, and unrepresentable names or payloads', async () => {
  const byte = new Uint8Array([1]);
  await assert.rejects(createStoredZip([{ name: '../image.png', data: byte }]), /unsafe file name/);
  await assert.rejects(createStoredZip([{ name: 'a.png', data: byte }, { name: 'a.png', data: byte }]), /duplicate file name/);
  await assert.rejects(createStoredZip([{ name: 'large.png', data: { byteLength: 0x1_0000_0000 } }]), /Blob or byte array/);
  await assert.rejects(createStoredZip([{ name: 'image.png', data: byte }], { maxArchiveBytes: MAX_STORED_ZIP_BYTES, maxEntries: 0 }), /file-count limit/);
});

test('ZIP output is byte-deterministic for identical entries', async () => {
  const entries = [{ name: 'result.jpg', data: new Uint8Array([255, 216, 255, 217]) }];
  const first = new Uint8Array(await (await createStoredZip(entries)).arrayBuffer());
  const second = new Uint8Array(await (await createStoredZip(entries)).arrayBuffer());
  assert.deepEqual(first, second);
});
