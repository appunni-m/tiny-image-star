import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createDocument, createNode, addNode } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { createTextPathGeometry } from '../src/text-on-path.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { createMultipageVectorPdf, createVectorPdf, PdfVectorExportError } from '../src/pdf-vector-export.js';
import { withPreparedVectorPdfText } from '../src/vector-pdf-text-preparation.js';
import { TextOutlineFontSession } from '../src/text-outline-font-session.js';
import { LocalFontShapingClient } from '../src/font-shaping.js';
import { LocalWoff2Decoder } from '../src/woff2-decoder.js';
import { resolvedTextLetterSpacing } from '../src/text-letter-spacing.js';
import { TextPositionPendingError } from '../src/text-position.js';
import { inflateSync } from 'node:zlib';

const fixture = new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url);
const axes = [
  { tag: 'wght', min: 100, max: 900, defaultValue: 400 },
  { tag: 'opsz', min: 14, max: 32, defaultValue: 14 }
];
const font = { id: 'vector-pdf-inter', family: 'Inter', name: 'inter-latin-variable.woff2', type: 'font/woff2', weight: 400, style: 'normal', axes };
const deferredDeadline = 10_000;

function workerFactory(bundleName, lifecycle) {
  const url = new URL(`../src/workers/${bundleName}`, import.meta.url).href;
  return () => {
    const worker = new NodeWorker(`
      const {parentPort} = require('node:worker_threads');
      const {readFile} = require('node:fs/promises');
      globalThis.self = { location:{href:${JSON.stringify(url)}}, addEventListener(type, cb) { if(type==='message') parentPort.on('message', data=>cb({data})); }, postMessage:(data, transfers)=>parentPort.postMessage(data, transfers) };
      globalThis.fetch = async value => { const u=new URL(String(value)); if(u.protocol!=='file:') throw new Error('Only local font assets are allowed.'); return new Response(await readFile(u)); };
      import(${JSON.stringify(url)}).catch(error=>{throw error;});
    `, { eval: true });
    const record = { worker, exit: new Promise(resolve => worker.once('exit', resolve)), terminated: 0 };
    lifecycle.push(record);
    return {
      postMessage: (data, transfers) => worker.postMessage(data, transfers),
      terminate() { record.terminated += 1; return worker.terminate(); },
      addEventListener(type, callback) {
        if (type === 'message') worker.on('message', data => callback({ data }));
        else if (type === 'error') worker.on('error', callback);
        else if (type === 'messageerror') worker.on('messageerror', callback);
      }
    };
  };
}

function measurement(shaper) {
  const measure = (text, style) => {
    const shaped = shaper(text, style);
    if (!shaped) throw new TextPositionPendingError();
    const tracking = resolvedTextLetterSpacing(style);
    const advance = shape => Array.isArray(shape?.mixedRuns)
      ? shape.mixedRuns.reduce((sum, run) => sum + advance(run.shaped), 0)
      : (shape.glyphs || []).reduce((sum, glyph) => sum + (glyph.xAdvance || 0), 0) / shape.upem * style.fontSize;
    return advance(shaped) + Math.max(0, [...text].length - 1) * tracking;
  };
  measure.shapeText = shaper;
  measure.textLineMetrics = (style, text) => {
    const value = shaper.fontMetrics(style, text);
    if (!value) throw new TextPositionPendingError();
    const scale = style.fontSize / value.upem;
    return { ascent: value.extents.ascender * scale, descent: -value.extents.descender * scale,
      lineGap: value.extents.lineGap * scale, topBaseline: value.extents.ascender * scale };
  };
  measure.leadingTrimMetrics = (style, text) => {
    const value = shaper.fontMetrics(style, text);
    if (!value) throw new TextPositionPendingError();
    const scale = style.fontSize / value.upem;
    return { capHeight: (value.leadingTrimMetrics?.capHeight ?? value.extents.ascender * .72) * scale,
      ascender: value.extents.ascender * scale };
  };
  return measure;
}

async function makeFontOwner() {
  const bytes = new Uint8Array(await readFile(fixture)); const lifecycle = [];
  const sessionFactory = options => new TextOutlineFontSession({ ...options,
    shaper: new LocalFontShapingClient({ workerFactory: workerFactory('font-shaping-worker.bundle.js', lifecycle), maxCacheBytes: 0, maxCacheEntries: 0 }),
    decoder: new LocalWoff2Decoder({ workerFactory: workerFactory('woff2-decompress-worker.bundle.js', lifecycle), timeoutMs: deferredDeadline, idleShutdownMs: 0 })
  });
  return { lifecycle, options: { fonts: [font], readFont: async id => ({ ...font, id, bytes: bytes.slice() }), sessionFactory } };
}

function frameWithText(text, index = 0) {
  const document = createDocument();
  const frame = createNode('frame', { name: `Local font ${index}`, width: 360, height: 180 });
  addNode(document, frame);
  addNode(document, text, { parentId: frame.id });
  return { document, frame };
}

function pdfStreams(pdf) {
  const source = Buffer.from(pdf).toString('latin1');
  const streams = [];
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const raw = Buffer.from(match[1], 'latin1');
    try { streams.push(inflateSync(raw).toString('latin1')); } catch { streams.push(raw.toString('latin1')); }
  }
  return streams.join('\n');
}

test('retained variable Inter rich glyph paths produce real vector PDF without mutable source text or browser font dependency', { timeout: 30_000 }, async t => {
  const owner = await makeFontOwner(); t.after(async () => {
    await Promise.all(owner.lifecycle.map(record => record.exit));
    assert.ok(owner.lifecycle.every(record => record.terminated === 1), 'all local font workers close with the export session');
  });
  const text = createNode('text', { x: 14, y: 18, width: 320, height: 90, text: 'To q\u0301 O', fontFamily: 'Inter',
    fontSize: 58, fontWeight: 720, fontAxes: { wght: 720, opsz: 22 }, fontFeatures: { kern: 1 }, letterSpacing: 3,
    letterSpacingUnit: 'pixels', color: '#183b62',
    textRuns: [{ text: 'To ', color: '#bb3150' }, { text: 'q\u0301 O', fontWeight: 500, fontAxes: { wght: 500, opsz: 16 }, letterSpacing: 2, letterSpacingUnit: 'pixels' }] });
  const original = structuredClone(text); const { document, frame } = frameWithText(text);
  const result = await withPreparedVectorPdfText(async shapeText => {
    const svg = exportNodeToSvg(frame, { document, measureText: measurement(shapeText) });
    const pdf = createMultipageVectorPdf([svg]);
    return { svg, pdf };
  }, owner.options);
  assert.match(result.svg, /<path\b/u); assert.doesNotMatch(result.svg, /<text\b|font-family=/u);
  assert.equal(result.svg.includes('fill="#bb3150"'), true, 'rich per-run color stays in the vector paths');
  assert.deepEqual(text, original, 'SVG/PDF shaping never mutates authored text, variables, or font metadata');
  const body = pdfStreams(result.pdf);
  assert.match(Buffer.from(result.pdf).toString('latin1'), /^%PDF-1\.[47]/u);
  assert.match(body, /\s+m\n/u, 'PDF streams contain vector path geometry rather than a raster page');
  assert.doesNotMatch(body, /\bBT\b|\bET\b/u, 'the local font outlines are exported as paths, not PDF text objects');
  assert.doesNotMatch(Buffer.from(result.pdf).toString('latin1'), /\/Type\s*\/Font\b/u, 'no recipient font installation is needed to render the outlines');
});

test('actual glyph outlines carry counters, path placement, custom underline, truncation clips and authored strokes into vector PDF', { timeout: 30_000 }, async t => {
  const owner = await makeFontOwner(); t.after(async () => {
    await Promise.all(owner.lifecycle.map(record => record.exit));
    assert.ok(owner.lifecycle.every(record => record.terminated === 1));
  });
  const pathText = createNode('text', { x: 10, y: 8, width: 260, height: 70, text: 'O q', fontFamily: 'Inter', fontSize: 48, color: '#26384a',
    textPath: createTextPathGeometry(createNode('line', { width: 260, height: 32 }), { startOffset: 3 }),
    textDecoration: 'underline', textDecorationStyle: 'wavy', textDecorationThickness: { unit: 'pixels', value: 2 },
    textDecorationColor: { type: 'solid', color: '#d84555', opacity: .8 },
    strokes: [createStroke({ width: 2, color: '#357ca5', alignment: 'outside' })] });
  const truncated = createNode('text', { x: 10, y: 95, width: 74, height: 42, text: 'To q O', fontFamily: 'Inter', fontSize: 34,
    textTruncation: 'ending', maxLines: 1, strokes: [createStroke({ width: 1.5, color: '#543a8a', alignment: 'outside' })] });
  const document = createDocument(); const frame = createNode('frame', { width: 300, height: 160 }); addNode(document, frame);
  addNode(document, pathText, { parentId: frame.id }); addNode(document, truncated, { parentId: frame.id });
  const originals = [structuredClone(pathText), structuredClone(truncated)];
  const result = await withPreparedVectorPdfText(async shapeText => {
    const svg = exportNodeToSvg(frame, { document, measureText: measurement(shapeText) });
    return { svg, pdf: createMultipageVectorPdf([svg]) };
  }, owner.options);
  assert.doesNotMatch(result.svg, /<text\b/u);
  assert.match(result.svg, /clipPath/u, 'ending truncation remains a vector clip around the completed glyph/stroke contours');
  assert.match(result.svg, /#d84555/u, 'custom underline geometry keeps its independent paint');
  const body = pdfStreams(result.pdf);
  assert.match(body, /\nf\n/u, 'PDF paints actual vector glyph contours, including counters');
  assert.doesNotMatch(body, /\bBT\b|\bET\b/u);
  assert.deepEqual([pathText, truncated], originals, 'path placement, decorations, stroke and clipping conversion leave the model editable');
});

test('PDF accepts only bounded local clipping inside opaque black/white glyph masks', () => {
  const maskSvg = content => '<svg width="20px" height="20px" viewBox="0 0 20 20"><defs>'
    + '<mask id="m" mask-type="luminance" color-interpolation="sRGB" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">'
    + `${content || '<g><rect width="20" height="20" fill="#fff"/><defs data-owner="glyph"><clipPath id="local-clip" clipPathUnits="userSpaceOnUse"><rect x="1" y="1" width="18" height="18"/></clipPath></defs><g clip-path="url(#local-clip)"><path d="M 2 2 L 18 2 L 10 18 Z" fill="#000"/></g></g>'}</mask></defs>`
    + '<rect width="20" height="20" fill="#123456" mask="url(#m)"/></svg>';
  const pdf = createVectorPdf(maskSvg(''));
  const body = pdfStreams(pdf);
  assert.match(body, /W\s+n/u, 'the nested clip remains a vector PDF clipping path within the luminosity mask');
  assert.match(Buffer.from(pdf).toString('latin1'), /\/S \/Luminosity/u);

  for (const content of [
    '<defs><clipPath id="bad"><rect width="20" height="20"/></clipPath></defs><g clip-path="https://example.test/#bad"><rect width="20" height="20" fill="#fff"/></g>',
    '<defs><clipPath id="bad"><rect width="20" height="20"/></clipPath><clipPath id="bad"><rect width="10" height="10"/></clipPath></defs><g clip-path="url(#bad)"><rect width="20" height="20" fill="#fff"/></g>',
    '<defs><filter id="f"/></defs><g filter="url(#f)"><rect width="20" height="20" fill="#fff"/></g>',
    '<defs><clipPath id="bad"><rect width="20" height="20"/></clipPath></defs><g clip-path="url(#bad)"><rect width="20" height="20" fill="#f00"/></g>',
  ]) {
    assert.throws(() => createVectorPdf(maskSvg(content)), error => error instanceof PdfVectorExportError && error.feature === 'luminance masks'
      || /unique IDs/.test(error.message));
  }
});
