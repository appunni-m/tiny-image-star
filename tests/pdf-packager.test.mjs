import test from 'node:test';
import assert from 'node:assert/strict';
import { createMultipagePdf, PDF_PACKAGER_LIMITS } from '../src/pdf-packager.js';

const jpegA = Uint8Array.of(0xff, 0xd8, 0x00, 0x80, 0xff, 0xd9);
const jpegBStorage = Uint8Array.of(0xaa, 0xff, 0xd8, 0x01, 0xfe, 0x00, 0xff, 0xd9, 0xbb);
const jpegB = jpegBStorage.subarray(1, -1);

function parseXref(pdf) {
  const latin1 = Buffer.from(pdf).toString('latin1');
  const startMarker = 'startxref\n';
  const markerIndex = latin1.lastIndexOf(startMarker);
  assert.notEqual(markerIndex, -1, 'startxref is present');
  const xrefOffset = Number(latin1.slice(markerIndex + startMarker.length).split('\n', 1)[0]);
  assert.equal(latin1.slice(xrefOffset, xrefOffset + 5), 'xref\n');
  const lines = latin1.slice(xrefOffset).split('\n');
  assert.equal(lines[1], '0 9');
  const entries = lines.slice(3, 11).map((line) => line.slice(0, 10));
  return { latin1, xrefOffset, entries };
}

test('writes valid byte-accurate multipage PDF objects and xref for binary JPEG streams', () => {
  const pdf = createMultipagePdf([
    { jpeg: jpegA, width: 640, height: 480 },
    { jpeg: jpegB, width: 321, height: 123 },
  ]);
  const { latin1, xrefOffset, entries } = parseXref(pdf);

  assert.deepEqual([...pdf.subarray(0, 15)], [
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25,
    0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
  ]);
  assert.match(latin1, /<< \/Type \/Pages \/Count 2 \/Kids \[3 0 R 6 0 R\] >>/);
  assert.match(latin1, /\/MediaBox \[0 0 640 480\]/);
  assert.match(latin1, /\/MediaBox \[0 0 321 123\]/);
  assert.match(latin1, /\/Length 6 >>\nstream\n/);
  assert.match(latin1, /\/Length 7 >>\nstream\n/);
  assert.ok(latin1.includes('/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode'));
  assert.ok(latin1.includes('q\n640 0 0 480 0 0 cm\n/Im1 Do\nQ\n'));
  assert.ok(latin1.includes('q\n321 0 0 123 0 0 cm\n/Im2 Do\nQ\n'));

  for (let id = 1; id <= 8; id += 1) {
    const offset = Number(entries[id - 1]);
    assert.equal(latin1.slice(offset, offset + `${id} 0 obj\n`.length), `${id} 0 obj\n`);
  }
  assert.equal(Number(latin1.slice(latin1.lastIndexOf('startxref\n') + 10).split('\n', 1)[0]), xrefOffset);
  assert.ok(Buffer.from(pdf).includes(Buffer.from(jpegA)));
  assert.ok(Buffer.from(pdf).includes(Buffer.from(jpegB)));
  assert.equal(jpegBStorage[0], 0xaa, 'input view backing bytes are left untouched');
  assert.equal(jpegBStorage.at(-1), 0xbb, 'input view backing bytes are left untouched');
});

test('accepts ArrayBuffer and maps pixel size directly to 72 dpi page points', () => {
  const backing = jpegA.buffer.slice(jpegA.byteOffset, jpegA.byteOffset + jpegA.byteLength);
  const pdf = createMultipagePdf([{ jpeg: backing, width: 1, height: 2 }]);
  const text = Buffer.from(pdf).toString('latin1');
  assert.match(text, /\/MediaBox \[0 0 1 2\]/);
  assert.match(text, /1 0 0 2 0 0 cm/);
});

test('supports a correctly sized print page with a centered raster inset', () => {
  const pdf = createMultipagePdf([{
    jpeg: jpegA, width: 1191, height: 1684,
    pdfWidth: 595.276, pdfHeight: 841.89,
    imageRect: { x: 8, y: 16, width: 579.276, height: 809.89 },
  }]);
  const text = Buffer.from(pdf).toString('latin1');
  assert.match(text, /\/MediaBox \[0 0 595\.276 841\.89\]/);
  assert.ok(text.includes('q\n579.276 0 0 809.89 8 16 cm\n/Im1 Do\nQ\n'));
  assert.throws(() => createMultipagePdf([{
    jpeg: jpegA, width: 10, height: 10, pdfWidth: 10, pdfHeight: 10,
    imageRect: { x: 8, y: 0, width: 3, height: 10 },
  }]), /must fit inside its PDF page/);
});

test('rejects empty or excessive page lists and malformed page records', () => {
  assert.throws(() => createMultipagePdf([]), /between 1 and/);
  assert.throws(() => createMultipagePdf(new Array(PDF_PACKAGER_LIMITS.maxPages + 1).fill({
    jpeg: jpegA, width: 1, height: 1,
  })), /between 1 and/);
  assert.throws(() => createMultipagePdf([null]), /must be an object/);
  assert.throws(() => createMultipagePdf([{ jpeg: new Uint8Array([1, 2, 3, 4]), width: 1, height: 1 }]), /complete JPEG/);
  assert.throws(() => createMultipagePdf([{ jpeg: jpegA, width: 1, height: 1.5 }]), /positive safe integers/);
  assert.throws(() => createMultipagePdf([{ jpeg: jpegA, width: 0, height: 1 }]), /positive safe integers/);
  assert.throws(() => createMultipagePdf([{ jpeg: [], width: 1, height: 1 }]), /Uint8Array or ArrayBuffer/);
});

test('enforces dimension and aggregate JPEG byte bounds before packaging', () => {
  assert.throws(() => createMultipagePdf([{
    jpeg: jpegA, width: PDF_PACKAGER_LIMITS.maxPageDimension + 1, height: 1,
  }]), /exceeds the supported PDF page dimensions/);
  assert.throws(() => createMultipagePdf([
    { jpeg: jpegA, width: 1, height: 1 },
    { jpeg: jpegB, width: 1, height: 1 },
  ], { maxAggregateJpegBytes: 10 }), /JPEG payloads exceed 10 bytes/);
  assert.throws(() => createMultipagePdf([{ jpeg: jpegA, width: 1, height: 1 }], {
    maxAggregateJpegBytes: PDF_PACKAGER_LIMITS.maxAggregateJpegBytes + 1,
  }), /maxAggregateJpegBytes must be between/);
});
