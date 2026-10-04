import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { createGradientFill, createLayerEffect, createNode } from '../src/model.js';
import { createImageFill } from '../src/image-fills.js';
import { exportNodeToSvg, exportPageToSvg } from '../src/svg-export.js';
import { assertVectorPdfEffectsSupported, createMultipageVectorPdf, createVectorPdf, PDF_VECTOR_EXPORT_LIMITS, PdfVectorExportError } from '../src/pdf-vector-export.js';
import { decodePdfImageDataUri } from '../src/pdf-image.js';

const pngCrcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = pngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function rgbaPng(width = 2, height = 2) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  // Transparent red, opaque green, half-transparent blue, opaque yellow.
  const rows = Buffer.from([
    0, 255, 0, 0, 0, 0, 255, 0, 255,
    0, 0, 0, 255, 128, 255, 255, 0, 255,
  ]);
  assert.equal(width, 2);
  assert.equal(height, 2);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function baselineJpeg(width = 3, height = 2) {
  // A small baseline RGB JPEG marker stream. The exporter preserves the DCT
  // payload as-is; it only needs to parse SOF dimensions/components.
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00,
    0x00, 0xff, 0xd9,
  ]);
}

function jpegApp1(payload) {
  const header = Buffer.alloc(4);
  header[0] = 0xff; header[1] = 0xe1;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function exifOrientationPayload(orientation) {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt16LE(0, 20); tiff.writeUInt32LE(0, 22);
  return Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
}

function pdfText(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

function assertValidXref(bytes) {
  const text = pdfText(bytes);
  const offset = Number(text.slice(text.lastIndexOf('startxref\n') + 10).split('\n', 1)[0]);
  assert.equal(text.slice(offset, offset + 5), 'xref\n');
  const [_, countLine, ...entries] = text.slice(offset).split('\n');
  const [, count] = countLine.split(' ').map(Number);
  for (let id = 1; id < count; id += 1) {
    const objectOffset = Number(entries[id].slice(0, 10));
    assert.ok(text.startsWith(`${id} 0 obj\n`, objectOffset), `xref entry ${id} points to its object`);
  }
}

function pdfTextMeasurer() {
  const measure = text => [...String(text)].length * 8;
  measure.pdfNaturalWidth = text => [...String(text)].length * 8;
  measure.pdfBaselineOffset = () => 12;
  return measure;
}

test('exports editor SVG paths as vector PDF while retaining geometry, transforms, opacity, and clipping', () => {
  const svg = '<!-- generated --><svg xmlns="http://www.w3.org/2000/svg" width="100px" height="60px" viewBox="10 20 200 120">'
    + '<defs><clipPath id="clip" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="50" height="30" rx="4" ry="4"/></clipPath></defs>'
    + '<g transform="matrix(1 0 0 1 3 4)" opacity="0.5" data-tiny-image-star-type="group">'
    + '<g clip-path="url(#clip)"><path d="M 1 2 C 3 4 5 6 7 8 L 9 10 Z" fill="#abc" fill-opacity="0.8" fill-rule="evenodd"/></g>'
    + '</g></svg>';
  const pdf = createVectorPdf(svg);
  const text = pdfText(pdf);

  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/MediaBox \[0 0 100 60\]/);
  assert.match(text, /0\.5 0 0 -0\.5 -5 70 cm/, 'viewBox maps to the requested PDF viewport');
  assert.match(text, /1 0 0 1 3 4 cm/);
  assert.match(text, /W\nn/, 'clip remains a vector clipping path');
  assert.match(text, /\/GS1 gs/, 'the supported transparency state is applied to the paint');
  assert.match(text, /\/ca 0\.5 \/CA 0\.5/, 'group opacity is applied once to the isolated group');
  assert.match(text, /\/ca 0\.8 \/CA 1/, 'shape fill opacity remains inside the isolated group');
  assert.match(text, /\/Subtype \/Form .*\/Group << \/S \/Transparency \/CS \/DeviceRGB \/I true \/K false >>/,
    'the opacity group remains a vector transparency Form XObject');
  assert.match(text, /0\.666666666667 0\.733333333333 0\.8 rg/);
  assert.match(text, / c\n/);
  assert.match(text, /f\*/);
  assert.doesNotMatch(text, /\/Subtype \/Image|\/DCTDecode|\/Im\d+ Do\n/,
    'the page was not flattened to a raster image');
  assertValidXref(pdf);
});

test('preserves opacity on overlapping and compound vector groups with isolated PDF transparency forms', () => {
  const overlapping = '<svg width="10px" height="10px" viewBox="0 0 10 10"><g opacity="0.5">'
    + '<rect width="6" height="6" fill="#ff0000"/><rect x="3" y="3" width="6" height="6" fill="#0000ff"/>'
    + '</g></svg>';
  const pdf = createVectorPdf(overlapping);
  const text = pdfText(pdf);
  assert.match(text, /\/Group << \/S \/Transparency \/CS \/DeviceRGB \/I true \/K false >>/);
  assert.match(text, /\/ca 0\.5 \/CA 0\.5/);
  assert.match(text, /\/Fm1 Do/);
  assert.match(text, /\/Subtype \/Form/);
  assertValidXref(pdf);

  const compound = '<svg width="10px" height="10px" viewBox="0 0 10 10"><g opacity="0.4">'
    + '<path d="M 1 1 L 9 1 L 5 9 Z" fill="#fff" stroke="#000" stroke-width="2"/>'
    + '</g></svg>';
  const compoundPdf = createVectorPdf(compound);
  const compoundText = pdfText(compoundPdf);
  assert.match(compoundText, /\/Group << \/S \/Transparency \/CS \/DeviceRGB \/I true \/K false >>/);
  assert.match(compoundText, /\/ca 0\.4 \/CA 0\.4/);
  assert.match(compoundText, /f\n/);
  assert.match(compoundText, /S\n/);
  assert.doesNotMatch(compoundText, /\/Subtype \/Image/);
  assertValidXref(compoundPdf);

  const nested = '<svg width="10px" height="10px" viewBox="0 0 10 10"><g opacity="0.5">'
    + '<g opacity="0.25"><rect width="10" height="10" fill="#123456"/></g></g></svg>';
  const nestedPdf = createVectorPdf(nested);
  const nestedText = pdfText(nestedPdf);
  assert.match(nestedText, /\/ca 0\.5 \/CA 0\.5/);
  assert.match(nestedText, /\/ca 0\.25 \/CA 0\.25/);
  assert.match(nestedText, /\/Fm2 Do/);
  assert.match(nestedText, /\/XObject << \/Fm2 \d+ 0 R >>/,
    'the outer transparency form only references the nested form it paints');
  assertValidXref(nestedPdf);
});

test('converts actual editor export with solid shapes, curves, strokes, and rounded rectangles', () => {
  const rectangle = createNode('rectangle', {
    id: 'rect', x: 8, y: 12, width: 90, height: 60, radius: 10,
    fill: '#ffcc00', stroke: '#123456', strokeWidth: 3,
  });
  const ellipse = createNode('ellipse', { id: 'ellipse', x: 120, y: 20, width: 45, height: 30, fill: '#bb22dd' });
  const curve = createNode('path', {
    id: 'curve', x: 180, y: 15, width: 80, height: 70, closed: true, fillRule: 'evenodd', fill: '#44aa66',
    points: [{ x: 0, y: 0, out: { x: .25, y: 0 } }, { x: 1, y: 1, in: { x: -.25, y: 0 } }],
  });
  const polygon = createNode('polygon', { id: 'polygon', x: 280, y: 20, width: 60, height: 50, points: 5, fill: '#abcdef' });
  const svg = exportPageToSvg({ children: [rectangle, ellipse, curve, polygon] });
  const pdf = createVectorPdf(svg);
  const text = pdfText(pdf);

  assert.match(text, /\/MediaBox \[0 0 /);
  assert.match(text, / h\n/);
  assert.match(text, / c\n/);
  assert.match(text, /f\n/);
  assert.match(text, /f\*\n/);
  assert.match(text, /S\n/);
  assert.match(text, /3 w/);
  assert.doesNotMatch(text, /\/Subtype \/Image/, 'no image object is expected');
  assertValidXref(pdf);
});

test('converts independent-corner rectangle quadratics into equivalent vector PDF cubics', () => {
  const rectangle = createNode('rectangle', {
    id: 'unequal-corners', width: 40, height: 30,
    cornerRadii: { topLeft: 2, topRight: 8, bottomRight: 12, bottomLeft: 4 },
    fill: '#ff0000',
  });
  const svg = exportNodeToSvg(rectangle);
  assert.match(svg, /\bQ\b/, 'the editor serializes its independent corners as SVG quadratic segments');

  const pdf = createVectorPdf(svg);
  const text = pdfText(pdf);
  assert.match(text, /37\.3333333333 0 40 2\.66666666667 40 8 c/,
    'the first quadratic is represented by the mathematically equivalent cubic controls');
  assert.match(text, /40 26 36 30 28 30 c/,
    'the bottom-right quadratic is converted from the current point and endpoint');
  assert.match(text, /1\.33333333333 30 0 28\.6666666667 0 26 c/,
    'the bottom-left quadratic is also converted without changing its endpoint');
  assert.match(text, /0 0\.666666666667 0\.666666666667 0 2 0 c/,
    'the final top-left quadratic closes at its SVG endpoint');
  assert.equal(text.split('\n').filter(line => line === 'Q').length, 2,
    'only the two PDF graphics-state restore operators use uppercase Q');
  assert.doesNotMatch(text, /\/Subtype \/Image/, 'independent corner geometry remains vector');
  assertValidXref(pdf);
});

test('keeps editor alpha and vector masks as bounded PDF soft-mask forms', () => {
  for (const maskMode of ['alpha', 'vector']) {
    const source = createNode('ellipse', {
      id: `${maskMode}-source`, x: 8, y: 6, width: 52, height: 34,
      fill: '#cc3300', fillOpacity: maskMode === 'alpha' ? .5 : 0,
      stroke: '#00aa00', strokeWidth: 6, strokeOpacity: 0, opacity: .4,
    });
    const content = createNode('rectangle', {
      id: `${maskMode}-content`, width: 80, height: 60, fill: '#3366cc',
    });
    const group = createNode('group', {
      id: `${maskMode}-mask`, width: 80, height: 60, mask: true, maskMode,
      maskSourceId: source.id, children: [content, source],
    });
    const svg = exportNodeToSvg(group);
    const pdf = createVectorPdf(svg);
    const text = pdfText(pdf);

    assert.match(text, /\/SMask << \/S \/Alpha \/G \d+ 0 R >>/,
      `${maskMode} masks map to an alpha soft mask without flattening the page`);
    assert.match(text, /\/BBox \[0 0 80 60\]/,
      'the PDF mask form is clipped to the exported mask region');
    assert.match(text, /\/Subtype \/Form .*\/Group << \/S \/Transparency \/CS \/DeviceRGB \/I true \/K false >>/);
    assert.match(text, /\/Fm\d+ Do/);
    assert.doesNotMatch(text, /\/Subtype \/Image/,
      'mask and content geometry remain vector PDF objects');
    if (maskMode === 'vector') {
      assert.match(text, /1 1 1 rg/, 'vector-mask fill and stroke colors are canonical opaque white');
      assert.doesNotMatch(text, /\/ca 0\.2 \/CA 0\.2/, 'source layer alpha is ignored by vector-mask coverage');
    } else {
      assert.match(text, /\/ca 0\.2 \/CA 1/, 'alpha-mask source opacity remains part of fill coverage');
    }
    assertValidXref(pdf);
  }

  const directMaskSvg = '<svg width="10px" height="10px" viewBox="0 0 10 10">'
    + '<defs><mask id="m" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="10" height="10">'
    + '<ellipse cx="5" cy="5" rx="3" ry="3" fill="#ffffff"/></mask></defs>'
    + '<rect width="10" height="10" fill="#cc3300" mask="url(#m)"/></svg>';
  const directPdf = createVectorPdf(directMaskSvg);
  assert.match(pdfText(directPdf), /\/SMask << \/S \/Alpha \/G \d+ 0 R >>/,
    'PDF preserves an alpha mask attached directly to a vector shape');
  assertValidXref(directPdf);

  const nestedMaskSvg = '<svg width="10px" height="10px" viewBox="0 0 10 10"><defs>'
    + '<mask id="inner" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="10" height="10"><ellipse cx="5" cy="5" rx="3" ry="3" fill="#fff"/></mask>'
    + '<mask id="outer" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="10" height="10"><g mask="url(#inner)"><rect width="10" height="10" fill="#fff"/></g></mask>'
    + '</defs><g mask="url(#outer)"><rect width="10" height="10" fill="#3366cc"/></g></svg>';
  const nestedPdf = createVectorPdf(nestedMaskSvg);
  assert.equal((pdfText(nestedPdf).match(/\/SMask << \/S \/Alpha \/G \d+ 0 R >>/g) || []).length, 2,
    'nested acyclic alpha masks each retain their own soft-mask form');
  assertValidXref(nestedPdf);
});

test('preserves editor PNG image layers as PDF image XObjects with a soft alpha mask and vector neighbors', () => {
  const png = rgbaPng();
  const decoded = decodePdfImageDataUri(`data:image/png;base64,${png.toString('base64')}`);
  assert.deepEqual([...inflateSync(decoded.data)], [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  assert.deepEqual([...inflateSync(decoded.alpha.data)], [0, 255, 128, 255],
    'split alpha samples exactly preserve fully transparent, opaque, and partial-alpha pixels');
  assert.equal(decoded.decodeParms, '', 'split, unpacked color samples do not claim PNG row predictors');
  const assets = new Map([['portrait', {
    id: 'portrait', type: 'image/png', width: 2, height: 2, sourceBytes: png,
  }]]);
  const photo = createNode('image', {
    id: 'photo', name: 'Transparent portrait', assetId: 'portrait',
    width: 48, height: 36, fit: 'cover', opacity: .75,
  });
  const label = createNode('rectangle', { id: 'label', x: 52, width: 18, height: 12, fill: '#112233' });
  const svg = exportPageToSvg({ children: [photo, label] }, { assets });
  const pdf = createVectorPdf(svg);
  const text = pdfText(pdf);

  assert.match(text, /\/Subtype \/Image \/Width 2 \/Height 2 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8/);
  assert.match(text, /\/Filter \/FlateDecode[^>]*\/SMask \d+ 0 R/,
    'PNG alpha is preserved as a dedicated PDF soft-mask image');
  assert.match(text, /\/ColorSpace \/DeviceGray \/BitsPerComponent 8 \/Filter \/FlateDecode/);
  assert.match(text, /\/XObject << \/Fm1 \d+ 0 R >>/, 'the page paints the isolated image layer as a Form XObject');
  assert.match(text, /\/Resources << \/XObject << \/Im1 \d+ 0 R >> >> .*\/Group << \/S \/Transparency/,
    'the form owns the embedded image resource it paints');
  assert.match(text, /\/Im1 Do/);
  assert.match(text, /\/ExtGState << \/GS1 \d+ 0 R >>/);
  assert.match(text, /\/ca 0\.75 \/CA 0\.75/, 'image layer opacity is applied to the isolated group');
  assert.match(text, /0\.0666666666667 0\.133333333333 0\.2 rg/,
    'a neighboring shape stays a vector-filled PDF path');
  assert.match(text, /h\nf\n/);
  assert.match(text, /\/MediaBox \[0 0 70 36\]/);
  assert.doesNotMatch(text, /\/Subtype \/Image[^>]*\/Width 70 \/Height 36/,
    'the page is not flattened into one screenshot image');
  assertValidXref(pdf);
});

test('preserves embedded JPEG bytes in a DCTDecode image XObject', () => {
  const jpeg = baselineJpeg();
  const assets = new Map([['jpeg-photo', {
    id: 'jpeg-photo', type: 'image/jpeg', width: 3, height: 2, sourceBytes: jpeg,
  }]]);
  const svg = exportNodeToSvg(createNode('image', {
    id: 'jpeg-layer', assetId: 'jpeg-photo', width: 30, height: 20, fit: 'contain',
  }), { assets });
  const pdf = createVectorPdf(svg);
  const text = pdfText(pdf);

  assert.match(text, /\/Subtype \/Image \/Width 3 \/Height 2 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode/);
  assert.ok(Buffer.from(pdf).includes(jpeg), 'the original JPEG stream is embedded byte-for-byte');
  assert.match(text, /\/Im1 Do/);
  assertValidXref(pdf);
});

test('preserves JPEG EXIF orientation when XMP and EXIF share APP1 markers', () => {
  const jpeg = baselineJpeg();
  const exif = jpegApp1(exifOrientationPayload(6));
  const xmp = jpegApp1(Buffer.from('http://ns.adobe.com/xap/1.0/\0metadata', 'binary'));
  for (const metadata of [[exif, xmp], [xmp, exif]]) {
    const bytes = Buffer.concat([jpeg.subarray(0, 2), ...metadata, jpeg.subarray(2)]);
    const image = decodePdfImageDataUri(`data:image/jpeg;base64,${bytes.toString('base64')}`);
    assert.equal(image.orientation, 6);
    assert.equal(image.displayWidth, 2);
    assert.equal(image.displayHeight, 3);
  }
});

test('preserves image fills as clipped PDF image objects with per-fill opacity', () => {
  const png = rgbaPng();
  const assets = new Map([['fill-photo', {
    id: 'fill-photo', type: 'image/png', width: 2, height: 2, sourceBytes: png,
  }]]);
  const shape = createNode('ellipse', {
    width: 40, height: 24, fillOpacity: .6,
    imageFill: createImageFill('fill-photo', { fit: 'contain' }),
  });
  const pdf = createVectorPdf(exportNodeToSvg(shape, { assets }));
  const text = pdfText(pdf);
  assert.match(text, /\/Subtype \/Image \/Width 2 \/Height 2/);
  assert.match(text, /\/Im1 Do/);
  assert.match(text, /W\nn/, 'the image fill remains clipped to its vector ellipse');
  assert.match(text, /\/ca 0\.6 \/CA 1/);
  assertValidXref(pdf);
});

test('exports an actual frame subtree from the editor as a vector PDF page', () => {
  const gradient = createGradientFill('linear', '#f04422');
  gradient.stops[1].color = '#2255dd';
  const frame = createNode('frame', {
    name: 'Product frame', width: 180, height: 120,
    children: [createNode('rectangle', { name: 'Gradient card', x: 12, y: 16, width: 96, height: 72, fillGradient: gradient })],
  });
  const pdf = createVectorPdf(exportNodeToSvg(frame));
  const text = pdfText(pdf);

  assert.match(text, /\/MediaBox \[0 0 180 120\]/);
  assert.match(text, /\/ShadingType 2/);
  assert.match(text, /\/Type \/Page /);
  assert.doesNotMatch(text, /\/Subtype \/Image|\/DCTDecode/,
    'frame artwork remains vector geometry in the application export path');
  assertValidXref(pdf);
});

test('creates multiple vector pages in stable input order with valid cross-reference entries', () => {
  const first = exportNodeToSvg(createNode('rectangle', { width: 20, height: 10, fill: '#ff0000' }));
  const second = exportNodeToSvg(createNode('ellipse', { width: 12, height: 8, fill: '#0000ff' }));
  const pdf = createMultipageVectorPdf([first, second]);
  const text = pdfText(pdf);

  assert.match(text, /\/Type \/Pages \/Count 2 \/Kids \[3 0 R 5 0 R\]/);
  assert.match(text, /\/MediaBox \[0 0 20 10\]/);
  assert.match(text, /\/MediaBox \[0 0 12 8\]/);
  assertValidXref(pdf);
});

test('encodes an editor linear gradient as a vector shading with ordered stop offsets and layer transform', () => {
  const gradient = createGradientFill('linear', '#ff0000');
  gradient.angle = 90;
  gradient.stops = [
    { id: 'before', color: '#ff0000', position: .1 },
    { id: 'middle', color: '#00ff00', position: .4 },
    { id: 'after', color: '#0000ff', position: .85 },
  ];
  const layer = createNode('rectangle', {
    x: 25, y: 15, width: 100, height: 50, rotation: 90, opacity: .75,
    fillOpacity: .4, fill: '#ffffff', fillGradient: gradient,
  });
  const svg = exportNodeToSvg(layer);
  const pdf = createVectorPdf(svg);
  const text = pdfText(pdf);

  assert.match(text, /\/ShadingType 2 \/ColorSpace \/DeviceRGB \/Coords \[50 0 50 50\]/,
    'the linear shading keeps the SVG user-space gradient endpoints');
  assert.match(text, /\/FunctionType 3 \/Domain \[0 1\] \/Functions \[[^\]]+\] \/Bounds \[0\.1 0\.4 0\.85\] \/Encode \[0 1 0 1 0 1 0 1\]/,
    'stitching function preserves all stop offsets and the constant endpoint padding');
  assert.match(text, /\/C0 \[1 0 0\] \/C1 \[0 1 0\]/);
  assert.match(text, /\/C0 \[0 1 0\] \/C1 \[0 0 1\]/);
  assert.match(text, /\/Sh1 sh/);
  assert.match(text, /\/ca 0\.4 \/CA 1/, 'fill opacity remains on the painted fill');
  assert.match(text, /\/ca 0\.75 \/CA 0\.75/, 'layer opacity is applied once to the isolated group');
  assert.match(text, /\n0 1 -1 0 [-\d.]+ [-\d.]+ cm\n/, 'the transformed layer remains vector-transformed');
  assert.doesNotMatch(text, /\/Subtype \/Image|\/DCTDecode/);
  assertValidXref(pdf);
});

test('encodes editor radial gradients with PDF radial shadings and accepts opaque fill stacks', () => {
  const radial = createGradientFill('radial', '#112233');
  radial.stops = [
    { id: 'inside', color: '#112233', position: 0 },
    { id: 'outside', color: '#eeeeee', position: 1 },
  ];
  const ellipse = createNode('ellipse', { width: 40, height: 20, fillGradient: radial, fillOpacity: .7 });
  const pdf = createMultipageVectorPdf([
    exportNodeToSvg(ellipse),
    exportNodeToSvg(createNode('rectangle', {
      width: 30, height: 20,
      fills: [
        { id: 'radial', type: 'radial', visible: true, opacity: .5, gradient: radial },
        { id: 'solid', type: 'solid', visible: true, opacity: .8, color: '#aabbcc' },
      ],
    })),
  ]);
  const text = pdfText(pdf);

  assert.match(text, /\/ShadingType 3 \/ColorSpace \/DeviceRGB \/Coords \[20 10 0 20 10 22\.360679775\]/);
  assert.match(text, /\/Type \/Pages \/Count 2/);
  assert.match(text, /\/Sh1 sh/);
  assert.equal([...text.matchAll(/\/Sh1 sh/g)].length, 2, 'shading resource names are local to each page');
  assert.equal([...text.matchAll(/\/ShadingType 3/g)].length, 2);
  assertValidXref(pdf);
});

test('preserves affine linear and elliptical radial gradient geometry in PDF shadings', () => {
  const cases = [
    {
      type: 'linearGradient',
      attributes: 'x1="0" y1="0" x2="1" y2="0"',
      coords: '/ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1 0]',
      matrix: '20 4 -3 8 30 10',
    },
    {
      type: 'radialGradient',
      attributes: 'cx="0" cy="0" r="1"',
      coords: '/ShadingType 3 /ColorSpace /DeviceRGB /Coords [0 0 0 0 0 1]',
      matrix: '20 4 -3 8 30 10',
    },
  ];
  for (const { type, attributes, coords, matrix } of cases) {
    const svg = `<svg width="10px" height="10px" viewBox="0 0 10 10"><defs><${type} id="g" gradientUnits="userSpaceOnUse" ${attributes} gradientTransform="matrix(${matrix})"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></${type}></defs><rect width="10" height="10" fill="url(#g)"/></svg>`;
    const text = pdfText(createVectorPdf(svg));
    assert.match(text, new RegExp(coords.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(text, new RegExp(`\\nW\\nn\\nq\\n${matrix.replaceAll(' ', '\\s+')} cm\\n/Sh1 sh\\nQ\\nQ`),
      'the gradient matrix is applied after clipping and scoped to the shading paint');
  }
});

test('exports simple single-line ASCII text with editable standard PDF fonts', () => {
  const svg = '<svg width="120px" height="40px" viewBox="0 0 120 40">'
    + '<text x="8" y="24" font-family="Arial, sans-serif" font-size="16" font-weight="700" font-style="italic"'
    + ' fill="#204060" fill-opacity="0.5">PDF (local) \\ text</text></svg>';
  const pdf = createVectorPdf(svg);
  const text = pdfText(pdf);

  assert.match(text, /\/F1 \d+ 0 R/);
  assert.match(text, /\/Type \/Font \/Subtype \/Type1 \/BaseFont \/Helvetica-BoldOblique \/Encoding \/WinAnsiEncoding/);
  assert.match(text, /1 0 0 -1 0 48 cm/);
  assert.match(text, /0\.125490196078 0\.250980392157 0\.376470588235 rg/);
  assert.match(text, /\/ca 0\.5 \/CA 1/);
  assert.ok(text.includes(`BT\n/F1 16 Tf\n1 0 0 1 8 24 Tm\n${String.raw`(PDF \(local\) \\ text) Tj`}\nET`),
    'PDF string delimiters and backslashes are escaped without changing the text');
  assertValidXref(pdf);
});

test('simple text rejects font-dependent or shaped SVG cases instead of substituting silently', () => {
  const svg = body => `<svg width="40px" height="20px" viewBox="0 0 40 20">${body}</svg>`;
  assert.throws(() => createVectorPdf(svg('<text x="0" y="14" font-family="Inter">Hello</text>')),
    error => error instanceof PdfVectorExportError && error.feature === 'custom text fonts');
  assert.throws(() => createVectorPdf(svg('<text x="0" y="14">café</text>')),
    error => error instanceof PdfVectorExportError && error.feature === 'non-ASCII text');
  assert.throws(() => createVectorPdf(svg('<text x="0" y="14" text-anchor="middle">Hello</text>')),
    error => error instanceof PdfVectorExportError && error.feature === 'text alignment');
  assert.throws(() => createVectorPdf(svg('<text x="0" y="14"><tspan>Rich</tspan></text>')),
    error => error instanceof PdfVectorExportError && error.feature === 'rich text');
});

test('exports editor-generated simple ASCII text with measured line placement and standard font styling', () => {
  const editorTextSvg = exportNodeToSvg(createNode('text', {
    text: 'Hello\nPDF', fontFamily: 'Arial, sans-serif', fontWeight: 700, fontStyle: 'italic',
    fontSize: 16, lineHeight: 1.25, width: 100, height: 50,
  }), { measureText: pdfTextMeasurer() });
  assert.match(editorTextSvg, /dominant-baseline="text-before-edge"/);
  assert.match(editorTextSvg, /data-tiny-image-star-pdf-ascent="12"/,
    'the app records the browser-measured standard-font ascent used to preserve editor top placement');
  assert.match(editorTextSvg, /<tspan x="0" y="20" textLength="24" lengthAdjust="spacingAndGlyphs" data-tiny-image-star-pdf-width="24">PDF<\/tspan>/,
    'wrapped lines carry their measured positions and standard-font width');
  const pdf = createVectorPdf(editorTextSvg);
  const text = pdfText(pdf);
  assert.match(text, /\/BaseFont \/Helvetica-BoldOblique/);
  assert.match(text, /100 Tz\n1 0 0 1 0 12 Tm\n\(Hello\) Tj/);
  assert.match(text, /100 Tz\n1 0 0 1 0 32 Tm\n\(PDF\) Tj/);
  assertValidXref(pdf);
});

test('editor-generated text rejects custom fonts and preserves centered and right-aligned PDF line placement', () => {
  const measureText = pdfTextMeasurer();
  const customFont = exportNodeToSvg(createNode('text', {
    text: 'Hello', fontFamily: 'Inter, Arial, sans-serif', fontSize: 16, width: 100, height: 25,
  }), { measureText });
  assert.throws(() => createVectorPdf(customFont), error => error instanceof PdfVectorExportError
    && error.feature === 'custom text fonts' && /raster PDF/.test(error.message));

  const centered = exportNodeToSvg(createNode('text', {
    text: 'Hello', fontFamily: 'Arial, sans-serif', align: 'center', fontSize: 16, width: 100, height: 25,
  }), { measureText });
  const centeredPdf = pdfText(createVectorPdf(centered));
  assert.match(centered, /<tspan x="50" y="0" textLength="40" lengthAdjust="spacingAndGlyphs" data-tiny-image-star-pdf-width="40">Hello<\/tspan>/);
  assert.ok(centeredPdf.includes('1 0 0 1 30 12 Tm'), 'the PDF text origin is shifted left by half of the measured line width');
  assertValidXref(createVectorPdf(centered));

  const rightAligned = exportNodeToSvg(createNode('text', {
    text: 'Hello', fontFamily: 'Arial, sans-serif', align: 'right', fontSize: 16, width: 100, height: 25,
  }), { measureText });
  const rightPdf = pdfText(createVectorPdf(rightAligned));
  assert.match(rightAligned, /<tspan x="100" y="0" textLength="40" lengthAdjust="spacingAndGlyphs" data-tiny-image-star-pdf-width="40">Hello<\/tspan>/);
  assert.ok(rightPdf.includes('1 0 0 1 60 12 Tm'), 'the PDF text origin is shifted left by the full measured line width');
  assertValidXref(createVectorPdf(rightAligned));
});

test('positioned PDF text fails closed when transforms or font metrics cannot be preserved', () => {
  const svg = body => `<svg width="40px" height="20px" viewBox="0 0 40 20">${body}</svg>`;
  assert.throws(() => createVectorPdf(svg('<text x="0" y="14" text-transform="uppercase">hello</text>')),
    error => error instanceof PdfVectorExportError && error.feature === 'text transformations' && /raster PDF/.test(error.message));
  assert.throws(() => createVectorPdf(svg('<text x="0" y="0" dominant-baseline="text-before-edge" data-tiny-image-star-pdf-ascent="12" font-family="Arial" font-size="16"><tspan x="0" y="0" textLength="24" lengthAdjust="spacingAndGlyphs">PDF</tspan></text>')),
    error => error instanceof PdfVectorExportError && error.feature === 'text line metrics' && /built-in Helvetica width/.test(error.message));
  const spacedText = exportNodeToSvg(createNode('text', {
    text: 'Hello', fontFamily: 'Arial, sans-serif', letterSpacing: 1, fontSize: 16, width: 100, height: 25,
  }), { measureText: pdfTextMeasurer() });
  assert.throws(() => createVectorPdf(spacedText), error => error instanceof PdfVectorExportError
    && error.feature === 'letter spacing');
});

test('fails closed with specific errors for unsupported rendered SVG features', () => {
  const textSvg = '<svg width="10px" height="10px" viewBox="0 0 10 10"><text x="0" y="0"><tspan>Hi</tspan></text></svg>';
  const gradientSvg = '<svg width="10px" height="10px" viewBox="0 0 10 10"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="10"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>';
  const effectSvg = '<svg width="10px" height="10px" viewBox="0 0 10 10"><defs><filter id="f"/></defs><g filter="url(#f)"><rect width="10" height="10"/></g></svg>';
  const maskSvg = '<svg width="10px" height="10px" viewBox="0 0 10 10"><defs><mask id="m" mask-type="luminance"/></defs><g mask="url(#m)"><rect width="10" height="10"/></g></svg>';
  for (const [svg, feature] of [
    [textSvg, /rich text/],
    [effectSvg, /layer effects/],
    [maskSvg, /luminance masks/],
  ]) {
    assert.throws(() => createVectorPdf(svg), error => error instanceof PdfVectorExportError && feature.test(error.message));
  }
  const missingMask = '<svg width="10px" height="10px" viewBox="0 0 10 10"><g mask="url(#missing)"><rect width="10" height="10"/></g></svg>';
  assert.throws(() => createVectorPdf(missingMask), /references missing mask/);
  const cyclicMask = '<svg width="10px" height="10px" viewBox="0 0 10 10"><defs>'
    + '<mask id="m" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="10" height="10"><g mask="url(#m)"><rect width="10" height="10" fill="#fff"/></g></mask>'
    + '</defs><g mask="url(#m)"><rect width="10" height="10"/></g></svg>';
  assert.throws(() => createVectorPdf(cyclicMask), error => error instanceof PdfVectorExportError && /cyclic alpha masks/.test(error.message));
  const objectBoundingBoxMask = '<svg width="10px" height="10px" viewBox="0 0 10 10"><defs>'
    + '<mask id="m" mask-type="alpha" maskUnits="objectBoundingBox" x="0" y="0" width="1" height="1"/>'
    + '</defs><g mask="url(#m)"><rect width="10" height="10"/></g></svg>';
  assert.throws(() => createVectorPdf(objectBoundingBoxMask), error => error instanceof PdfVectorExportError && /object-bounding-box masks/.test(error.message));
  const unsupportedImageSvg = '<svg width="10px" height="10px" viewBox="0 0 10 10"><image x="0" y="0" width="10" height="10" href="data:image/webp;base64,AA=="/></svg>';
  const malformedImageSvg = '<svg width="10px" height="10px" viewBox="0 0 10 10"><image x="0" y="0" width="10" height="10" href="data:image/png;base64,AA=="/></svg>';
  assert.throws(() => createVectorPdf(unsupportedImageSvg), error => error instanceof PdfVectorExportError
    && error.feature === 'embedded raster image' && /image\/webp/.test(error.message) && /PNG or JPEG/.test(error.message));
  assert.throws(() => createVectorPdf(malformedImageSvg), error => error instanceof PdfVectorExportError
    && error.feature === 'embedded raster image' && /PNG header is invalid/.test(error.message));
  const tileLayer = createNode('image', { assetId: 'tile-photo', width: 10, height: 10, fit: 'tile', scalingFactor: 0.5 });
  const tileSvg = exportNodeToSvg(tileLayer, { assets: new Map([['tile-photo', {
    id: 'tile-photo', type: 'image/png', width: 2, height: 2, sourceBytes: new Uint8Array([1, 2, 3])
  }]]) });
  assert.throws(() => createVectorPdf(tileSvg), error => error instanceof PdfVectorExportError
    && error.feature === 'SVG definition <pattern>', 'vector PDF must fail closed on Tile patterns instead of dropping the repeated image');
  assert.throws(() => createVectorPdf('<svg width="10px" height="10px" viewBox="0 0 10 10"><image width="10" height="10"/></svg>'),
    error => error instanceof PdfVectorExportError && /external raster images/.test(error.message));
  const invisibleUnsupportedImage = createVectorPdf('<svg width="10px" height="10px" viewBox="0 0 10 10"><g opacity="0"><image width="10" height="10" href="data:image/webp;base64,AA=="/></g></svg>');
  assert.doesNotMatch(pdfText(invisibleUnsupportedImage), /\/Subtype \/Image/,
    'fully transparent image layers do not require an export codec');
  assert.throws(() => createVectorPdf(gradientSvg.replace('gradientUnits="userSpaceOnUse"', 'gradientUnits="objectBoundingBox"')),
    error => error instanceof PdfVectorExportError && /object-bounding-box gradients/.test(error.message));
  for (const transform of ['translate(2 3)', 'matrix(1 2 2 4 0 0)', 'matrix(1 0 0 1 Infinity 0)']) {
    assert.throws(() => createVectorPdf(gradientSvg.replace('gradientUnits="userSpaceOnUse"',
      `gradientUnits="userSpaceOnUse" gradientTransform="${transform}"`)),
    error => error instanceof PdfVectorExportError && /gradientTransform/.test(error.message));
  }
  assert.throws(() => createVectorPdf(gradientSvg.replace('<linearGradient id="g"', '<linearGradient id="g" spreadMethod="reflect"')),
    error => error instanceof PdfVectorExportError && /reflect gradient spread/.test(error.message));
  assert.throws(() => createVectorPdf(gradientSvg.replace('stop-color="#000000"', 'stop-color="#000000" stop-opacity="0.5"')),
    error => error instanceof PdfVectorExportError && /gradient stop alpha/.test(error.message));
  assert.throws(() => createVectorPdf(gradientSvg.replace('offset="1"', 'offset="0"')),
    error => error instanceof PdfVectorExportError && /duplicate gradient stop offsets/.test(error.message));
  const gradientStrokeSvg = gradientSvg.replace('<rect width="10" height="10" fill="url(#g)"/>',
    '<rect width="10" height="10" fill="none" stroke="url(#g)" stroke-width="2"/>');
  assert.throws(() => createVectorPdf(gradientStrokeSvg),
    error => error instanceof PdfVectorExportError && /gradient strokes/.test(error.message));
});

test('vector PDF rejects visible Noise and Texture before starting SVG conversion', () => {
  const noise = createLayerEffect('noise');
  const noisy = createNode('rectangle', { name: 'Grain sample', effects: [noise] });
  assert.throws(() => assertVectorPdfEffectsSupported(noisy), error => error instanceof PdfVectorExportError
    && error.feature === 'noise effects' && /Grain sample/.test(error.message) && /use raster PDF/.test(error.message));
  noise.visible = false;
  assert.doesNotThrow(() => assertVectorPdfEffectsSupported(noisy), 'hidden Noise does not change the appearance');

  const texture = createLayerEffect('texture');
  const node = createNode('rectangle', { name: 'Rough label', effects: [texture] });
  assert.throws(() => assertVectorPdfEffectsSupported(node), error => error instanceof PdfVectorExportError
    && error.feature === 'texture effects'
    && /Rough label/.test(error.message)
    && /use raster PDF or hide\/remove/.test(error.message));
  texture.visible = false;
  assert.doesNotThrow(() => assertVectorPdfEffectsSupported(node), 'hidden texture has no appearance to preserve');
});

test('rejects unsupported SVG commands, malformed documents, and excessive page counts', () => {
  assert.throws(() => createVectorPdf('<svg width="10px" height="10px" viewBox="0 0 10 10"><path d="M0 0 A5 5 0 0 0 10 10"/></svg>'),
    error => error instanceof PdfVectorExportError && /path command A/.test(error.message));
  assert.throws(() => createVectorPdf('<svg width="10px" height="10px" viewBox="0 0 10 10"><rect></svg>'), /not properly nested/);
  assert.throws(() => createMultipageVectorPdf([]), /between 1 and/);
  assert.throws(() => createMultipageVectorPdf(new Array(PDF_VECTOR_EXPORT_LIMITS.maxPages + 1).fill('')),
    /between 1 and/);
  assert.throws(() => createVectorPdf('<!DOCTYPE svg><svg/>'), /document types and custom entities/);
  assert.throws(() => createVectorPdf('<svg width="10pt" height="10pt" viewBox="0 0 10 10"/>'), /in pixels/);
  assert.throws(() => createVectorPdf('<svg width="10px" height="10px" viewBox="0 0 10 10"><path transform="matrix(1 0 0 1 2 3)" d="M0 0L1 1"/></svg>'),
    error => error instanceof PdfVectorExportError && /attribute transform/.test(error.message));
  assert.throws(() => createVectorPdf('<svg width="10px" height="10px" viewBox="0 0 10 10"><title>&bad;</title></svg>'), /unsupported XML entity/);
  assert.doesNotThrow(() => createVectorPdf('<svg width="10px" height="10px" viewBox="0 0 10 10"><g><title>&amp;bad;</title><rect width="10" height="10"/></g></svg>'));
});
