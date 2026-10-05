import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, createLayerEffect, createFillLayer } from '../src/model.js';
import { rasterExportBounds } from '../src/raster-export-bounds.js';
import { exportNodeToSvg, getPageContentBounds } from '../src/svg-export.js';
import { createVectorPdf } from '../src/pdf-vector-export.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';
import { importSvgToLayers } from '../src/svg-import.js';
import { localTextInkBounds } from '../src/renderer.js';

function fixture(overrides = {}) {
  const document = createDocument();
  const fill = createNode('rectangle', { name: 'Glyph fill', x: -10, y: 20, width: 100, height: 40, fill: '#ffffff' });
  const stroke = createNode('rectangle', { name: 'Glyph stroke', x: -12, y: 18, width: 104, height: 44, fill: '#0000ff', effectPaintPhase: 'stroke' });
  const node = createNode('group', { name: 'Outlined text', width: 12, height: 15,
    fills: [], strokes: [], fillOpacity: 1, effectPaintMode: 'staged', effectFillMode: 'legacy', children: [fill, stroke], ...overrides });
  delete node.fills;
  node.fillOpacity = overrides.fillOpacity ?? 1;
  document.pages[0].children.push(node);
  return { document, node, fill: node.children[0], stroke: node.children[1] };
}

test('parent blur and shadow aprons enclose overflowing converted glyph ink in raster and SVG bounds', () => {
  const { document, node } = fixture({ x: 50, y: 30, effects: [createLayerEffect('layer-blur', { radius: 2 })] });
  assert.deepEqual(rasterExportBounds(document, node), { x: 32, y: 24, width: 116, height: 74 });
  assert.deepEqual(getPageContentBounds(document.pages[0], { document }), rasterExportBounds(document, node));
  const svg = exportNodeToSvg(node, { document });
  assert.match(svg, /viewBox="-18 -6 116 74"/);
  assert.match(svg, /<filter[^>]*x="-18" y="-6" width="116" height="74"/);
  node.effects = [createLayerEffect('drop-shadow', { offsetX: 18, offsetY: -3, blur: 2, showShadowBehindNode: true })];
  assert.deepEqual(rasterExportBounds(document, node), { x: 14, y: 21, width: 152, height: 80 });
});

test('root affine scaling preserves independent effect offsets and nested ancestor bounds', () => {
  const { document, node } = fixture({ affineTransform: { a: .1, b: 0, c: 0, d: .1 },
    effects: [createLayerEffect('drop-shadow', { offsetX: 100, offsetY: 0, blur: 2, showShadowBehindNode: true })] });
  const bounds = rasterExportBounds(document, node);
  assert.deepEqual(bounds, { x: -107.2, y: -6, width: 222.4, height: 18.2 });
  const svg = exportNodeToSvg(node, { document });
  assert.match(svg, /viewBox="-107\.2 -6 222\.4 18\.2"/);
  assert.match(svg, /<filter[^>]*x="-107\.2" y="-6" width="222\.4" height="18\.2"/);
  assert.match(svg, /<g transform="matrix\(0\.1 0 0 0\.1 0 0\)"/);
  assert.doesNotMatch(svg, /transform="[^"]+"[^>]*filter="url\(#tis-effect-0\)"/);
  const parent = createNode('group', { x: 20, y: 10, width: 200, height: 200, rotation: 17,
    affineTransform: { a: 1, b: .2, c: .3, d: 1 } });
  const nested = rasterExportBounds(document, node, [parent]);
  for (const point of [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y],
    [bounds.x + bounds.width, bounds.y + bounds.height], [bounds.x, bounds.y + bounds.height]]) {
    const mapped = nodeLocalToPage(parent, { x: point[0], y: point[1] });
    assert.ok(mapped.x >= nested.x - 1e-8 && mapped.x <= nested.x + nested.width + 1e-8);
    assert.ok(mapped.y >= nested.y - 1e-8 && mapped.y <= nested.y + nested.height + 1e-8);
  }
});

test('SVG inner shadows use the fixed combined silhouette and keep the authored stroke on top', () => {
  const { document, node } = fixture({ effects: [
    createLayerEffect('inner-shadow', { offsetX: 7, offsetY: 0, blur: 0, color: '#000000' }),
    createLayerEffect('inner-shadow', { offsetX: -4, offsetY: 2, blur: 1, color: '#ff0000', opacity: .5 }),
    createLayerEffect('layer-blur', { radius: 1 })
  ] });
  const svg = exportNodeToSvg(node, { document });
  assert.equal((svg.match(/<feGaussianBlur in="SourceAlpha"/g) || []).length, 2);
  assert.equal((svg.match(/<feComposite in="SourceAlpha"/g) || []).length, 2);
  assert.equal((svg.match(/color-interpolation-filters="sRGB"/g) || []).length, 3);
  assert.doesNotMatch(svg, /<use|<feImage/);
  assert.match(svg, /data-tiny-image-star-paint-phases="group-v1"/);
  assert.ok(svg.lastIndexOf('<title>Glyph stroke</title>') > svg.lastIndexOf('filter="url(#tis-effect-0-inner-1)"'));
  assert.match(svg, /<feGaussianBlur in="SourceGraphic" stdDeviation="1"/);
  assert.throws(() => createVectorPdf(svg), /layer-effect filter graphs/);
});

test('editable SVG import accepts explicit sRGB effects and rejects unsupported interpolation', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="blur" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="80"><feGaussianBlur stdDeviation="2"/></filter></defs><g filter="url(#blur)"><rect width="100" height="60" fill="#ffffff"/></g></svg>';
  assert.doesNotThrow(() => importSvgToLayers(svg));
  assert.throws(() => importSvgToLayers(svg.replace('"sRGB"', '"linearRGB"')), /explicit sRGB/);
});

test('legacy scalar opacity applies to each glyph fill and leaves stroke alpha independent', () => {
  const { document, node, fill, stroke } = fixture({ fillOpacity: .3 });
  fill.opacity = .5;
  const svg = exportNodeToSvg(node, { document });
  assert.match(svg, /<g[^>]*opacity="0\.15"[^>]*><title>Glyph fill<\/title>/);
  assert.match(svg, /<g[^>]*opacity="1"[^>]*><title>Glyph stroke<\/title>/);
  assert.equal(fill.opacity, .5); assert.equal(stroke.opacity, 1);
});

test('invisible authored or edited stroke paints cannot force a fixed inner-shadow alpha snapshot', () => {
  for (const paint of [{ opacity: 0 }, { visible: false }, { color: 'transparent' }]) {
    const { document, node, stroke } = fixture({ fillOpacity: .4, effects: [
      createLayerEffect('inner-shadow', { offsetX: 4, offsetY: 4, blur: 2, color: '#00ff00', opacity: .8 }),
      createLayerEffect('inner-shadow', { offsetX: -4, offsetY: 3, blur: 1, color: '#0000ff', opacity: .7 })
    ] });
    stroke.fills = [createFillLayer('solid', { color: '#ff0000', ...paint })];
    const svg = exportNodeToSvg(node, { document });
    assert.doesNotMatch(svg, /<feGaussianBlur in="SourceAlpha"/, JSON.stringify(paint));
    assert.match(svg, /<feGaussianBlur in="tis-effect-0-inner-result-0"/, 'later inner shadow uses the evolving fill alpha');
  }
});

test('unfiltered converted vectors remain vector PDF compatible; unsupported shaders retain explicit export errors', () => {
  const { document, node } = fixture();
  const pdf = createVectorPdf(exportNodeToSvg(node, { document }));
  assert.match(new TextDecoder('latin1').decode(pdf), /^%PDF-/);
  for (const type of ['noise', 'texture', 'background-blur', 'glass']) {
    node.effects = [createLayerEffect(type)];
    assert.throws(() => exportNodeToSvg(node, { document }), /SVG export does not support/);
  }
  node.effects = [createLayerEffect('drop-shadow', { showShadowBehindNode: false })];
  assert.throws(() => exportNodeToSvg(node, { document }), /hidden behind transparent/);
});

test('hidden descendants and slices cannot inflate raster bounds, and viewport clips constrain overflow', () => {
  const { document, node } = fixture();
  node.children.push(createNode('rectangle', { x: -5000, y: -5000, width: 20, height: 20, visible: false }),
    createNode('slice', { x: 5000, y: 5000, width: 20, height: 20 }));
  assert.deepEqual(rasterExportBounds(document, node), { x: -12, y: 0, width: 104, height: 62 });
  node.clip = true;
  assert.deepEqual(rasterExportBounds(document, node), { x: 0, y: 0, width: 12, height: 15 });
});

test('ordinary groups also expand their parent effects around transformed child ink', () => {
  const document = createDocument();
  const child = createNode('rectangle', { x: 50, y: 20, width: 30, height: 20,
    effects: [createLayerEffect('layer-blur', { radius: 1 })] });
  const root = createNode('group', { width: 10, height: 10, children: [child],
    effects: [createLayerEffect('layer-blur', { radius: 2 })] });
  assert.deepEqual(rasterExportBounds(document, root), { x: -6, y: -6, width: 95, height: 55 });
  document.pages[0].children.push(root);
  assert.deepEqual(getPageContentBounds(document.pages[0], { document }), rasterExportBounds(document, root));
  assert.match(exportNodeToSvg(root, { document }), /<filter id="tis-effect-0"[^>]*x="-6" y="-6" width="95" height="55"/);
});

test('available local glyph contours also prevent original text raster exports from cropping to their logical box', () => {
  const document = createDocument();
  const node = createNode('text', { text: 'H', width: 12, height: 15, fontSize: 80 });
  const shapeText = () => ({ upem: 1000, extents: { ascender: 1000, descender: 0, lineGap: 0 },
    glyphs: [{ id: 1, cluster: 0, xAdvance: 800, yAdvance: 0, xOffset: 0, yOffset: 0, path: 'M0 0L800 0L800 1000L0 1000Z' }] });
  const options = { textBounds: source => localTextInkBounds(document, source, shapeText) };
  const bounds = rasterExportBounds(document, node, [], options);
  assert.ok(bounds.width >= 64 && bounds.height >= 80);
  const parent = createNode('group', { width: 10, height: 10, children: [node], effects: [createLayerEffect('layer-blur', { radius: 2 })] });
  const parentBounds = rasterExportBounds(document, parent, [], options);
  assert.ok(parentBounds.x <= -6 && parentBounds.y <= -6);
  assert.ok(parentBounds.width >= bounds.width + 12 && parentBounds.height >= bounds.height + 12);
});
