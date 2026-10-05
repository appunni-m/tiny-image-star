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

function pdfObjectStream(pdf, objectId) {
  const bytes = Buffer.from(pdf);
  const text = bytes.toString('latin1');
  const objectStart = text.indexOf(`${objectId} 0 obj\n`);
  assert.notEqual(objectStart, -1, `PDF object ${objectId} exists`);
  const streamMarker = text.indexOf('stream\n', objectStart);
  assert.notEqual(streamMarker, -1, `PDF object ${objectId} has a stream`);
  const length = Number(/\/Length (\d+)/.exec(text.slice(objectStart, streamMarker))?.[1]);
  assert.ok(Number.isSafeInteger(length) && length >= 0, `PDF object ${objectId} has a valid stream length`);
  return bytes.subarray(streamMarker + 'stream\n'.length, streamMarker + 'stream\n'.length + length);
}

function pdfPageContent(pdf) {
  const match = /\/Contents (\d+) 0 R/.exec(pdfText(pdf));
  assert.ok(match, 'PDF page has a content stream');
  return pdfObjectStream(pdf, Number(match[1])).toString('latin1');
}

function pdfAlphaMaskSamples(pdf) {
  const text = pdfText(pdf);
  const match = /\/SMask (\d+) 0 R/.exec(text);
  assert.ok(match, 'drop-shadow image has a PDF soft alpha mask');
  return inflateSync(pdfObjectStream(pdf, Number(match[1])));
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

function pdfRichTextMeasurer() {
  const measure = (text, style = {}) => [...String(text)].length * Number(style.fontSize || 16)
    * (Number(style.fontWeight) >= 700 ? 0.6 : 0.5);
  measure.pdfNaturalWidth = (text, style = {}) => [...String(text)].length * Number(style.fontSize || 16)
    * (Number(style.fontWeight) >= 700 ? 0.58 : 0.48);
  measure.pdfBaselineOffset = style => Number(style.fontSize || 16) * 0.72;
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

test('exports WinAnsi Latin text using one-byte Helvetica glyph codes', () => {
  const svg = '<svg width="180px" height="40px" viewBox="0 0 180 40">'
    + '<text x="8" y="24" font-family="Helvetica" font-size="16">Crème — “local” €</text></svg>';
  const pdf = createVectorPdf(svg);
  const text = pdfText(pdf);

  assert.match(text, /\/Encoding \/WinAnsiEncoding/);
  assert.ok(text.includes('BT\n/F1 16 Tf\n1 0 0 1 8 24 Tm\n<4372E86D65209720936C6F63616C942080> Tj\nET'),
    'accented Latin, typographic quotes/dash, and euro sign map to their single WinAnsi character codes');
  assertValidXref(pdf);
});

test('preserves SVG case transforms and trusts the editor’s already-laid-out text case', () => {
  const rawText = (mode, value) => `<svg width="180px" height="30px" viewBox="0 0 180 30">`
    + `<text x="8" y="20" font-family="Arial" font-size="16" text-transform="${mode}">${value}</text></svg>`;
  const expected = [
    ['uppercase', 'hello', '(HELLO) Tj'],
    ['lowercase', 'SOME TEXT', '(some text) Tj'],
    ['capitalize', 'école du tiny', '<C9636F6C652044752054696E79> Tj'],
  ];
  for (const [mode, value, operator] of expected) {
    const pdf = createVectorPdf(rawText(mode, value));
    assert.ok(pdfText(pdf).includes(operator), `${mode} text case should be applied before WinAnsi encoding`);
    assertValidXref(pdf);
  }

  const editorSvg = exportNodeToSvg(createNode('text', {
    text: 'supercalifragilisticexpialidocious', textCase: 'capitalize',
    fontFamily: 'Arial, sans-serif', fontSize: 16, width: 48, height: 80,
  }), { measureText: pdfTextMeasurer() });
  const editorLines = [...editorSvg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(match => match[1]);
  assert.ok(editorLines.length > 1, 'the editor fixture wraps one long word across multiple measured lines');
  assert.ok(editorLines.slice(1).some(line => /^[a-z]/.test(line)),
    'the editor fixture contains a lowercase continuation line inside the same word');
  const editorPdf = pdfText(createVectorPdf(editorSvg));
  for (const line of editorLines) {
    assert.ok(editorPdf.includes(`(${line}) Tj`), `PDF should preserve the editor-laid-out line “${line}” exactly`);
  }
  assertValidXref(createVectorPdf(editorSvg));
});

test('simple text rejects font-dependent or shaped SVG cases instead of substituting silently', () => {
  const svg = body => `<svg width="40px" height="20px" viewBox="0 0 40 20">${body}</svg>`;
  assert.throws(() => createVectorPdf(svg('<text x="0" y="14" font-family="Inter">Hello</text>')),
    error => error instanceof PdfVectorExportError && error.feature === 'custom text fonts');
  assert.throws(() => createVectorPdf(svg('<text x="0" y="14">漢字</text>')),
    error => error instanceof PdfVectorExportError && error.feature === 'text glyph coverage'
      && /raster PDF/.test(error.message));
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

test('editor-generated positioned lines preserve WinAnsi characters and alignment in vector PDF', () => {
  const editorSvg = exportNodeToSvg(createNode('text', {
    text: 'Crème €', fontFamily: 'Arial, sans-serif', align: 'center', fontSize: 16, width: 100, height: 25,
  }), { measureText: pdfTextMeasurer() });
  const pdf = createVectorPdf(editorSvg);
  const text = pdfText(pdf);

  assert.match(editorSvg, /Crème €/, 'SVG keeps the authored Unicode text');
  assert.ok(text.includes('1 0 0 1 22 12 Tm\n<4372E86D652080> Tj'),
    'editor line measurements and centered placement survive encoded vector text output');
  assertValidXref(pdf);
});

test('editor-generated bullet and numbered list markers remain positioned editable PDF text', () => {
  const measureText = pdfTextMeasurer();
  const bullet = createNode('text', {
    text: 'First item\nSecond item', fontFamily: 'Arial, sans-serif', fontSize: 16,
    width: 160, height: 48, lineHeight: 1.25,
    paragraphStyles: [
      { listStyle: 'bulleted', listLevel: 0 },
      { listStyle: 'bulleted', listLevel: 0 },
    ],
  });
  const bulletSvg = exportNodeToSvg(bullet, { measureText });
  assert.match(bulletSvg, /data-tiny-image-star-list-marker="bulleted"[^>]*>•<\/tspan>/,
    'SVG supplies a positioned WinAnsi bullet with a measured text width');
  const bulletPdf = createVectorPdf(bulletSvg);
  const bulletContent = pdfPageContent(bulletPdf);
  assert.match(bulletContent, /BT\n\/F\d+ 16 Tf\n142\.857142857 Tz\n1 0 0 1 0 12 Tm\n<95> Tj\nET/,
    'the PDF uses the WinAnsi bullet glyph and scales it to the editor-measured marker width');
  assertValidXref(bulletPdf);

  const numbered = createNode('text', {
    text: 'Twelfth item\nThirteenth item', fontFamily: 'Arial, sans-serif', fontSize: 16,
    width: 180, height: 48, lineHeight: 1.25,
    paragraphStyles: [
      { listStyle: 'numbered', listLevel: 0, listStart: 12 },
      { listStyle: 'numbered', listLevel: 0 },
    ],
  });
  const numberedSvg = exportNodeToSvg(numbered, { measureText });
  assert.match(numberedSvg, /data-tiny-image-star-list-marker="numbered"[^>]*>12\.<\/tspan>/);
  const numberedPdf = createVectorPdf(numberedSvg);
  const numberedContent = pdfPageContent(numberedPdf);
  assert.match(numberedContent, /BT\n\/F\d+ 16 Tf\n107\.913669065 Tz\n1 0 0 1 0 12 Tm\n\(12\.\) Tj\nET/,
    'the PDF preserves numbered list marker text and aligns it using standard Helvetica widths');
  assert.match(numberedContent, /1 0 0 1 0 32 Tm\n\(13\.\) Tj/,
    'subsequent numbered markers retain their authored line baseline');
  assertValidXref(numberedPdf);
});

test('PDF list markers still fail closed for custom fonts and unsupported glyphs', () => {
  const measureText = pdfRichTextMeasurer();
  const customFont = createNode('text', {
    text: 'Custom marker', fontFamily: 'Arial, sans-serif', fontSize: 16, width: 150, height: 24,
    paragraphStyles: [{ listStyle: 'bulleted', listLevel: 0 }],
    textRuns: [{ text: 'Custom marker', fontFamily: 'Inter' }],
  });
  assert.throws(() => createVectorPdf(exportNodeToSvg(customFont, { measureText })), error =>
    error instanceof PdfVectorExportError && error.feature === 'custom text fonts'
      && /raster PDF/.test(error.message),
  'custom marker fonts are not silently substituted with Helvetica');

  const unsupportedGlyph = '<svg width="80px" height="30px" viewBox="0 0 80 30">'
    + '<text x="0" y="0" font-family="Arial" font-size="16" fill="#000000"'
    + ' dominant-baseline="text-before-edge" data-tiny-image-star-pdf-ascent="12">'
    + '<tspan data-tiny-image-star-list-marker="bulleted" x="8" y="0" text-anchor="end"'
    + ' font-family="Arial" font-size="16" font-weight="400" font-style="normal"'
    + ' letter-spacing="0" fill="#000000" textLength="16" lengthAdjust="spacingAndGlyphs">漢</tspan>'
    + '<tspan x="16" y="0" textLength="32" lengthAdjust="spacingAndGlyphs"'
    + ' data-tiny-image-star-pdf-width="32">Text</tspan></text></svg>';
  assert.throws(() => createVectorPdf(unsupportedGlyph), error =>
    error instanceof PdfVectorExportError && error.feature === 'text glyph coverage'
      && /use raster PDF/.test(error.message),
  'markers outside the built-in PDF font repertoire remain a clear raster-PDF error');
});

test('editor-generated inline rich text preserves measured WinAnsi run positions and standard Helvetica variants', () => {
  const measureText = pdfRichTextMeasurer();
  const node = createNode('text', {
    text: 'Crème €', fontFamily: 'Arial, sans-serif', fontSize: 16, width: 120, height: 24, align: 'center',
    textRuns: [
      { text: 'Crème', color: '#204060' },
      { text: ' ', fontWeight: 700, color: '#e11d48' },
      { text: '€', fontWeight: 700, fontStyle: 'italic', color: '#e11d48' },
    ],
  });
  const svg = exportNodeToSvg(node, { measureText });
  assert.match(svg, /data-tiny-image-star-pdf-ascent="11\.52"/,
    'rich editor text carries the measured standard-font ascent needed by vector PDF');
  assert.match(svg, /data-tiny-image-star-pdf-x="30\.4" data-tiny-image-star-pdf-y="0" data-tiny-image-star-pdf-width="40" data-tiny-image-star-pdf-natural-width="38\.4"/,
    'the first run carries its measured position, rendered width, and Helvetica natural width');
  assert.match(svg, /data-tiny-image-star-pdf-x="70\.4" data-tiny-image-star-pdf-y="0" data-tiny-image-star-pdf-width="9\.6" data-tiny-image-star-pdf-natural-width="9\.28"> <\/tspan>/,
    'whitespace-only styled runs keep their exact position and width in PDF metadata');
  assert.match(svg, /data-tiny-image-star-pdf-x="80" data-tiny-image-star-pdf-y="0" data-tiny-image-star-pdf-width="9\.6" data-tiny-image-star-pdf-natural-width="9\.28"/,
    'the next styled run begins at the measured end of the whitespace run');

  const pdf = createVectorPdf(svg);
  const text = pdfText(pdf);
  assert.match(text, /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
  assert.match(text, /\/BaseFont \/Helvetica-BoldOblique \/Encoding \/WinAnsiEncoding/);
  assert.match(text, /104\.166666667 Tz\n1 0 0 1 30\.4 11\.52 Tm\n<4372E86D65> Tj/,
    'regular WinAnsi text uses its measured x and a width-preserving horizontal scale');
  assert.match(text, /103\.448275862 Tz\n1 0 0 1 70\.4 11\.52 Tm\n\( \) Tj/,
    'a standalone encoded space advances using its measured width');
  assert.match(text, /103\.448275862 Tz\n1 0 0 1 80 11\.52 Tm\n<80> Tj/,
    'the accented currency glyph uses the selected bold-oblique standard face and exact run position');
  assertValidXref(pdf);

  const unsupported = createNode('text', {
    text: 'No substitution', fontFamily: 'Arial, sans-serif', fontSize: 16, width: 160, height: 24,
    textRuns: [{ text: 'No substitution', fontFamily: 'Inter' }],
  });
  assert.throws(() => createVectorPdf(exportNodeToSvg(unsupported, { measureText })), error =>
    error instanceof PdfVectorExportError && error.feature === 'custom text fonts',
  'a measured run with a custom family still fails closed instead of substituting Helvetica');

  const unsupportedGlyph = createNode('text', {
    text: '漢字', fontFamily: 'Arial, sans-serif', fontSize: 16, width: 80, height: 24,
    textRuns: [{ text: '漢字' }],
  });
  assert.throws(() => createVectorPdf(exportNodeToSvg(unsupportedGlyph, { measureText })), error =>
    error instanceof PdfVectorExportError && error.feature === 'text glyph coverage',
  'unsupported glyphs remain a hard error instead of being replaced by standard-font glyphs');

  const missingMetricsSvg = exportNodeToSvg(node, { measureText: text => [...String(text)].length * 8 });
  assert.throws(() => createVectorPdf(missingMetricsSvg), error =>
    error instanceof PdfVectorExportError && error.feature === 'rich text' && /measured PDF baseline/.test(error.message),
  'SVG without PDF-specific run metrics stays fail-closed');

  const largerRun = createNode('text', {
    text: 'Large', fontFamily: 'Arial, sans-serif', fontSize: 16, width: 120, height: 30,
    textRuns: [{ text: 'Large', fontSize: 20 }],
  });
  assert.throws(() => createVectorPdf(exportNodeToSvg(largerRun, { measureText })), error =>
    error instanceof PdfVectorExportError && error.feature === 'rich text font metrics',
  'run-specific sizes fail closed until their baseline positions have separate measurements');

  const justified = createNode('text', {
    text: 'one two three', fontFamily: 'Arial, sans-serif', fontSize: 16, width: 80, height: 48,
    align: 'justify', textRuns: [{ text: 'one ' }, { text: 'two three', fontWeight: 700 }],
  });
  const justifiedSvg = exportNodeToSvg(justified, { measureText });
  assert.match(justifiedSvg, /word-spacing="[1-9]/, 'the fixture contains a genuinely justified rich line');
  assert.throws(() => createVectorPdf(justifiedSvg), error =>
    error instanceof PdfVectorExportError && error.feature === 'rich text justification',
  'justified word gaps remain fail-closed until the PDF writer can preserve per-word spacing');
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
  assert.throws(() => createVectorPdf(svg('<text x="0" y="0" text-transform="uppercase"><tspan><tspan>Styled</tspan></tspan></text>')),
    error => error instanceof PdfVectorExportError && error.feature === 'rich text transformations' && /raster PDF/.test(error.message));
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

test('accepts scientific SVG lengths and writes PDF numbers without exponent notation', () => {
  const pdf = createVectorPdf('<svg width="1e-7px" height="1px" viewBox="0 0 1e-7 1"><rect width="1e-7" height="1" fill="#123456"/></svg>');
  const text = pdfText(pdf);

  assert.match(text, /\/MediaBox \[0 0 0\.0000001 1\]/,
    'the small SVG page size is serialized as a valid PDF real number');
  assert.match(text, /0 0 m 0\.0000001 0 l/,
    'small path coordinates stay in PDF real-number syntax');
  assert.doesNotMatch(text, /\b\d+(?:\.\d+)?[eE][+-]?\d+\b/,
    'PDF numeric operands never use the exponent notation allowed by SVG');
});

test('maps SVG viewBox into the PDF viewport using preserveAspectRatio', () => {
  const source = body => `<svg width="200px" height="100px" viewBox="0 0 100 100">${body}</svg>`;
  const meet = createVectorPdf(source('<rect x="10" y="10" width="20" height="30" fill="#123456"/>'));
  assert.match(pdfText(meet), /\/MediaBox \[0 0 200 100\]/);
  assert.match(pdfPageContent(meet), /1 0 0 -1 50 100 cm/,
    'the default xMidYMid meet scales uniformly and centers letterboxed SVG artwork');

  const none = createVectorPdf(source('<rect x="10" y="10" width="20" height="30" fill="#123456"/>')
    .replace('<svg ', '<svg preserveAspectRatio="none" '));
  assert.match(pdfPageContent(none), /2 0 0 -1 0 100 cm/,
    'explicit none retains nonuniform scaling');

  const slice = createVectorPdf(source('<rect x="10" y="10" width="20" height="30" fill="#123456"/>')
    .replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" '));
  assert.match(pdfPageContent(slice), /2 0 0 -2 0 150 cm/,
    'slice uniformly scales and centers oversized artwork for the PDF page crop');

  const malformed = source('<rect width="10" height="10"/>').replace('<svg ', '<svg preserveAspectRatio="xSpaceYTime" ');
  assert.throws(() => createVectorPdf(malformed), error => error instanceof PdfVectorExportError
    && error.feature === 'SVG preserveAspectRatio');
});

test('exports filled stroke endpoint triangle, inward-triangle, diamond, and circle markers as vectors', () => {
  for (const marker of ['triangle', 'triangle-inward', 'diamond', 'circle']) {
    const line = createNode('line', {
      width: 40,
      height: 0,
      strokes: [{
        id: `marker-${marker}`,
        color: '#123456',
        width: 2,
        opacity: 0.5,
        visible: true,
        cap: 'butt',
        join: 'miter',
        pattern: 'solid',
        miterLimit: 10,
        startDecoration: marker,
        endDecoration: 'none',
      }],
    });
    const svg = exportNodeToSvg(line);
    const pdf = createVectorPdf(svg);
    const text = pdfText(pdf);

    assert.match(svg, new RegExp(`data-tiny-image-star-decoration="${marker}"`));
    assert.match(text, /\bh\s*\nf\b/, `${marker} remains a filled PDF path`);
    assert.match(text, /\/ca 0\.5 \/CA 1/, `${marker} retains stroke opacity`);
    assert.doesNotMatch(text, /\/Subtype \/Image|\/DCTDecode/,
      `${marker} does not rasterize the surrounding line artwork`);
    assertValidXref(pdf);
  }
});

test('fails closed when a filled stroke marker uses unsupported SVG path geometry', () => {
  const unsupported = '<svg width="40px" height="20px" viewBox="0 0 40 20">'
    + '<path data-tiny-image-star-decoration="triangle" d="M 0 0 A 5 5 0 0 1 10 10 Z" fill="#123456"/>'
    + '</svg>';
  assert.throws(() => createVectorPdf(unsupported), error => error instanceof PdfVectorExportError
    && error.feature === 'SVG path command A');
});

test('preserves Figma-like drop-shadow visibility for supported simple SVG shapes', () => {
  const opaque = createNode('rectangle', {
    id: 'opaque-clipped-shadow', width: 40, height: 24, fill: '#ffffff', fillOpacity: 1,
    effects: [createLayerEffect('drop-shadow', {
      id: 'opaque-shadow', showShadowBehindNode: false, color: '#112233', opacity: 0.5,
      offsetX: 3, offsetY: 2, blur: 2,
    })],
  });
  const opaqueSvg = exportNodeToSvg(opaque);
  const opaquePdf = createVectorPdf(opaqueSvg);
  const opaqueText = pdfText(opaquePdf);
  const opaqueContent = pdfPageContent(opaquePdf);
  const opaqueShadow = opaqueContent.indexOf('/Im1 Do');
  const opaqueFill = opaqueContent.indexOf('40 0 l 40 24 l 0 24 l h\nf');

  assert.ok(opaqueShadow >= 0 && opaqueFill > opaqueShadow,
    'the shadow is painted first and the opaque vector geometry covers its interior');
  assert.match(opaqueText, /\/Subtype \/Image[^>]*\/SMask \d+ 0 R/,
    'the Gaussian edge is a bounded transparent shadow raster while the source stays vector');
  assert.match(opaqueText, /\/Subtype \/Image[^>]*\/ColorSpace \/DeviceGray/,
    'the shadow alpha channel is stored as a PDF soft-mask image');
  assert.equal(Math.max(...pdfAlphaMaskSamples(opaquePdf)), 128,
    'an opaque source with 50% shadow opacity retains the full shadow alpha before the vector knockout');

  const translucent = createNode('ellipse', {
    id: 'transparent-behind-shadow', width: 40, height: 24, fill: '#ffffff', fillOpacity: 0.4,
    effects: [createLayerEffect('drop-shadow', {
      id: 'behind-shadow', showShadowBehindNode: true, color: '#112233', opacity: 0.5,
      offsetX: 3, offsetY: 2, blur: 2,
    })],
  });
  const translucentSvg = exportNodeToSvg(translucent);
  const translucentPdf = createVectorPdf(translucentSvg);
  const translucentContent = pdfPageContent(translucentPdf);
  const translucentShadow = translucentContent.indexOf('/Im1 Do');
  const translucentFill = translucentContent.indexOf('c h\nf');
  const translucentAlpha = pdfAlphaMaskSamples(translucentPdf);

  assert.ok(translucentShadow >= 0 && translucentFill > translucentShadow,
    'the shadow stays behind the translucent vector ellipse');
  assert.ok(Math.max(...translucentAlpha) >= 50 && Math.max(...translucentAlpha) <= 52,
    'shadow alpha combines 40% source alpha and 50% effect opacity, so it can show through the source');
  assert.match(pdfText(translucentPdf), /\/Type \/ExtGState \/ca 0\.4/,
    'the original translucent vector fill keeps its own alpha after the shadow is painted');
  assert.doesNotMatch(opaqueText, /\/Subtype \/Image[^>]*\/Width 40 \/Height 24/,
    'the original opaque rectangle remains vector geometry rather than becoming the shadow bitmap');
  assertValidXref(opaquePdf);
  assertValidXref(translucentPdf);

  const multiBlockShadow = createVectorPdf(exportNodeToSvg(createNode('rectangle', {
    width: 200, height: 150, fill: '#ffffff',
    effects: [createLayerEffect('drop-shadow', { color: '#000000', opacity: 0.5, blur: 1 })],
  })));
  const maskReference = /\/SMask (\d+) 0 R/.exec(pdfText(multiBlockShadow));
  assert.ok(maskReference);
  assert.ok(pdfAlphaMaskSamples(multiBlockShadow).length > 65_535,
    'large bounded alpha-mask streams remain valid across stored-DEFLATE block boundaries');
  assertValidXref(multiBlockShadow);
});

test('fails closed for unsupported drop-shadow SVG graphs and clipped translucent shadows', () => {
  const chainedFilter = '<svg width="20px" height="20px" viewBox="0 0 20 20">'
    + '<defs><filter id="fx" filterUnits="userSpaceOnUse" x="-5" y="-5" width="30" height="30">'
    + '<feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur"/>'
    + '<feDropShadow in="SourceGraphic" dx="2" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.5"/>'
    + '</filter></defs><g filter="url(#fx)"><rect width="10" height="10" fill="#ffffff"/></g></svg>';
  assert.throws(() => createVectorPdf(chainedFilter), error => error instanceof PdfVectorExportError
    && error.feature === 'layer-effect filter graphs');

  const clippedTranslucent = createNode('rectangle', {
    id: 'unrepresentable-clipped-shadow', width: 40, height: 24, fill: '#ffffff', fillOpacity: 0.4,
    effects: [createLayerEffect('drop-shadow', {
      id: 'clipped-translucent-shadow', showShadowBehindNode: false, color: '#112233', opacity: 0.5,
      offsetX: 3, offsetY: 2, blur: 2,
    })],
  });
  assert.throws(() => exportNodeToSvg(clippedTranslucent), /drop shadows hidden behind transparent node geometry/,
    'the SVG source exporter refuses a clipped translucent shadow instead of feeding the PDF writer an ambiguous filter');
});
