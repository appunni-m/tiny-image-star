import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDocument, createNode, addNode, findNode, getNodePropertyValue } from '../src/model.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { assertVectorPdfTextSupported } from '../src/pdf-text-support.js';
import { createMultipageVectorPdf, PdfVectorExportError } from '../src/pdf-vector-export.js';
import { withPreparedVectorPdfText } from '../src/vector-pdf-text-preparation.js';
import { canvasFontWeight } from '../src/font-variation.js';
import { canvasLeadingTrimMetrics } from '../src/text-leading-trim.js';
import { canvasTextLineMetrics } from '../src/text-line-metrics.js';
import { canvasTextInkBounds } from '../src/text-decoration.js';
import { measureTrackedText } from '../src/text-layout.js';
import { resolvedTextLetterSpacing } from '../src/text-letter-spacing.js';
import { validateLocalFontAsset } from '../src/font-assets.js';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const extract = (start, end) => {
  const first = main.indexOf(start); const last = main.indexOf(end, first);
  assert.ok(first >= 0 && last > first); return main.slice(first, last);
};
const production = extract('function createSvgTextMeasurer(', 'function hasImageAdjustmentEdits(')
  + extract('async function exportVectorPdf(', 'async function exportSelectedFrameVectorPdf(');
const record = { id: 'pdf-font', family: 'PDF Inter', name: 'inter.woff2', type: 'font/woff2', weight: 400, style: 'normal' };
const bytes = new Uint8Array(await readFile(new URL('./fixtures/fonts/inter-latin-variable.woff2', import.meta.url)));

// Native font geometry is covered separately. This harness executes the
// production editor export and its real preparation/preflight/SVG/PDF pipeline,
// controlling only the asynchronous font boundary and Canvas metrics.
function harness({ local = true, workspace = null, onRead = () => {}, onShape = () => {}, onPdf = () => {} } = {}) {
  const doc = createDocument(); const frame = createNode('frame', { name: 'Typography', width: 240, height: 120 });
  addNode(doc, frame);
  const node = createNode('text', { name: 'Retained text', text: 'Oq', x: 15, y: 15, width: 180, height: 64,
    fontFamily: local ? record.family : 'Arial, sans-serif', fontSize: 24,
    fontWeight: local ? 650 : 400, letterSpacing: local ? 1.5 : 0, stroke: null });
  addNode(doc, node, { parentId: frame.id });
  const state = { document: doc, documentGeneration: 1, saveRevision: 1, fontAssetEpoch: 1, workspace,
    fontAssets: new Map(local ? [[record.id, { ...record }]] : []), assets: new Map() };
  const reads = []; const shapes = []; const downloads = []; const svgs = []; const preflights = [];
  const liveShapes = []; const metricFonts = []; let sessions = 0; let closed = 0; let previews = 0;
  const context = { font: '', textBaseline: 'alphabetic', textAlign: 'left', measureText(text) {
    metricFonts.push(this.font);
    return { width: String(text).length * 12, fontBoundingBoxAscent: 19, fontBoundingBoxDescent: 5,
      actualBoundingBoxAscent: this.textBaseline === 'top' ? 0 : 18, actualBoundingBoxDescent: 4,
      actualBoundingBoxLeft: 0, actualBoundingBoxRight: String(text).length * 12 };
  } };
  const browserDocument = { createElement: () => ({ getContext: () => context }) };
  const abort = signal => { if (signal?.aborted) throw signal.reason || new DOMException('Canceled', 'AbortError'); };
  const activePage = () => doc.pages.find(page => page.id === doc.activePageId);
  const loadFont = async id => { reads.push(id); onRead(state); return { ...record, bytes: bytes.slice() }; };
  const prepare = (generate, options) => withPreparedVectorPdfText(generate, { ...options,
    sessionFactory(settings) {
      sessions++;
      let saved = null;
      return { async shapeText(text, style) {
        settings.assertCurrent(); saved ||= await settings.readFont(record.id);
        assert.equal(saved.family, record.family);
        await new Promise(resolve => setTimeout(resolve, 1)); onShape(state); settings.assertCurrent();
        shapes.push({ text, style });
        return { upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 },
          leadingTrimMetrics: { capHeight: 700 }, glyphs: [...text].map((character, index) => ({
            id: index + 1, cluster: index, xAdvance: 600, yAdvance: 0, xOffset: 0, yOffset: 0,
            path: character === ' ' ? '' : 'M0 0L500 0L500 700L0 700ZM100 100L100 600L400 600L400 100Z'
          })) };
      }, close() { closed++; } };
    }
  });
  const deps = { state, findNode, activePage, document: browserDocument, AbortController, Blob,
    abortIfExportCanceled: abort, showToast() {}, prepareEditorBooleanVectorExport: async () => null,
    assertVectorPdfTreeSupported(snapshot, root, _plan, options) {
      preflights.push(options.skipText ? 'images' : 'text');
      if (!options.skipText) assertVectorPdfTextSupported(snapshot, root.children[0], options);
    },
    vectorPdfImagePreviews: async () => { previews++; return new Map(); },
    projectBooleanVectorPaintTree: (_snapshot, root) => root, withPreparedVectorPdfText: prepare,
    getNodePropertyValue, canvasFontWeight, canvasLeadingTrimMetrics, canvasTextLineMetrics, canvasTextInkBounds,
    measureTrackedText, resolvedTextLetterSpacing, PdfVectorExportError,
    shapeLocalTextRun() { liveShapes.push(true); throw new Error('The preview font cache cannot own a PDF export.'); },
    exportNodeToSvg(root, options) { const svg = exportNodeToSvg(root, options); svgs.push(svg); return svg; },
    createMultipageVectorPdf(pages) { const pdf = createMultipageVectorPdf(pages); onPdf(state); return pdf; },
    readWorkspaceFontAssetOrRestore: async (selected, designId, id) => {
      assert.equal(selected, workspace); assert.equal(designId, doc.id);
      const saved = await loadFont(id); return { metadata: saved, bytes: saved.bytes };
    },
    loadFontAsset: loadFont, validateLocalFontAsset,
    downloadBlob(blob, name) { downloads.push({ blob, name }); }, safeExportName: value => value,
    imageEngine: { cancelQueuedByKey() {} }
  };
  const run = new Function(...Object.keys(deps), production + 'return exportVectorPdf;')(...Object.values(deps));
  return { state, frame, node, downloads, reads, shapes, svgs, preflights, liveShapes, metricFonts,
    get sessions() { return sessions; }, get closed() { return closed; }, get previews() { return previews; },
    run: () => run([frame.id]) };
}

test('editor vector PDF export owns cold retained glyphs, reads captured folder fonts once and leaves editable sources intact', async () => {
  const h = harness({ workspace: { name: 'Chosen folder' } }); const before = structuredClone(h.state.document);
  await h.run();
  assert.equal(h.downloads.length, 1); assert.equal(h.downloads[0].blob.type, 'application/pdf');
  assert.match(await h.downloads[0].blob.text(), /%PDF-1\.4/);
  assert.equal(h.sessions, 1); assert.equal(h.closed, 1); assert.deepEqual(h.reads, [record.id]);
  assert.equal(h.previews, 1, 'glyph-query retries cannot repeat Pillow image work');
  assert.ok(h.shapes.length > 0); assert.equal(h.liveShapes.length, 0);
  assert.ok(h.svgs.every(svg => !svg.includes('<text')), 'local glyphs remain vector contours');
  assert.deepEqual(h.state.document, before); assert.equal(h.state.imageExportAbortController, null);
});

test('editor vector PDF preserves standard text fallback without allocating local font workers', async () => {
  const h = harness({ local: false }); await h.run();
  assert.equal(h.downloads.length, 1); assert.equal(h.sessions, 0); assert.equal(h.closed, 0);
  assert.equal(h.reads.length, 0); assert.ok(h.svgs.some(svg => svg.includes('<text')));
  assert.match(await h.downloads[0].blob.text(), /\/BaseFont \/Helvetica/);
  assert.ok(h.metricFonts.some(font => font.endsWith('Helvetica')));
});

test('font, source, folder and cancellation changes stop editor vector PDF before publication', async () => {
  for (const mutate of [
    state => { state.fontAssetEpoch++; }, state => { state.saveRevision++; },
    state => { state.workspace = { name: 'Other folder' }; },
    state => { state.fontAssets.get(record.id).family = 'Replaced font'; },
    state => { state.document.pages[0].children[0].children[0].text = 'Replaced text'; },
    state => { state.document.typographyStyles.push({ id: 'changed' }); },
    state => { state.imageExportAbortController.abort(); }
  ]) {
    const h = harness({ onShape: mutate });
    await h.run().then(() => {
      assert.equal(h.downloads.length, 0, 'cancellation may be handled by the editor but cannot publish');
    }, error => assert.match(error.message, /changed|abort/iu));
    assert.equal(h.downloads.length, 0); assert.equal(h.closed, 1);
    assert.equal(h.state.imageExportAbortController, null);
  }
});

test('last-moment font catalog replacement rejects generated PDF before downloading', async () => {
  const h = harness({ onPdf: state => { state.fontAssets.get(record.id).name = 'other.woff2'; } });
  await assert.rejects(h.run(), /fonts changed/u);
  assert.equal(h.downloads.length, 0); assert.equal(h.closed, 1);
  assert.equal(h.state.imageExportAbortController, null);
});
