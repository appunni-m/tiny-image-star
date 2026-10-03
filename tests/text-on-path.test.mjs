import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, createComponent, createComponentInstance, createDocument, createNode, duplicateNode,
  detachNodeTextPath, getNodeGeometry, getNodeTextPath, moveNode, removeNode, syncComponentInstances, validateDocument
} from '../src/model.js';
import { exportNodeToSvg, exportPageToSvg } from '../src/svg-export.js';
import { createTextPathGeometry, createTextPathSampler, drawTextAlongPath, flattenTextPath, isValidTextPathGeometry, pointAtTextPathDistance, textPathSvgData } from '../src/text-on-path.js';

function pathNode() {
  return createNode('path', {
    x: 10, y: 20, width: 100, height: 40, closed: false,
    points: [
      { x: 0, y: .5, out: { x: .25, y: -.5 } },
      { x: .5, y: .5, in: { x: -.25, y: -.5 }, out: { x: .25, y: .5 } },
      { x: 1, y: .5, in: { x: -.25, y: .5 } }
    ],
    fill: '#123456', effects: []
  });
}

test('text path snapshots validate, flatten cubic geometry, and sample distance with a tangent', () => {
  const geometry = createTextPathGeometry(pathNode());
  assert.ok(isValidTextPathGeometry(geometry));
  const table = flattenTextPath(geometry, .5);
  assert.ok(table.length > 10, 'cubic curves are represented by a usable distance lookup');
  assert.ok(table.at(-1).distance > 100);
  const middle = pointAtTextPathDistance(geometry, table.at(-1).distance / 2, .5);
  assert.ok(Math.abs(middle.x - 50) < 2);
  assert.ok(Number.isFinite(middle.angle));
  const sampler = createTextPathSampler(geometry, .5);
  assert.ok(Object.isFrozen(sampler));
  assert.equal(sampler.length, table.at(-1).distance);
  assert.deepEqual(sampler.at(sampler.length / 2), middle,
    'many glyph queries can share the same precomputed path distance table');
  assert.equal(isValidTextPathGeometry({ ...geometry, flipped: 'yes' }), false);
  assert.equal(isValidTextPathGeometry({ ...geometry, points: [{ x: 0, y: 0 }] }), false);
  const circle = createTextPathGeometry(createNode('ellipse', { width: 100, height: 80 }));
  assert.equal(circle.closed, true);
  assert.equal(circle.points.length, 4);
  const circleLength = flattenTextPath(circle).at(-1).distance;
  assert.ok(circleLength > 250);
  assert.deepEqual(pointAtTextPathDistance(circle, circleLength + 5), pointAtTextPathDistance(circle, 5));
});

test('text path flattening has a fixed sample budget for dense or adversarial paths', () => {
  const points = Array.from({ length: 20_000 }, (_, index) => ({
    x: index / 19_999, y: (index % 2) * .01,
    out: { x: 0, y: .02 }, in: { x: 0, y: -.02 }
  }));
  const geometry = { width: 10_000, height: 10_000, points, closed: false, startOffset: 0, flipped: false };
  const table = flattenTextPath(geometry, .25);
  assert.ok(table.length <= 65_536, 'flattening stays inside the fixed memory budget');
  assert.ok(table.at(-1).distance > 0, 'the bounded table remains usable for text placement');
});

test('text path geometry and orientation round-trip through the saved document model', () => {
  const document = createDocument();
  const node = createNode('text', {
    text: 'Along a curve', width: 100, height: 40,
    textPath: { ...createTextPathGeometry(pathNode()), startOffset: 12, flipped: true }
  });
  addNode(document, node);
  assert.doesNotThrow(() => validateDocument(document));
  const loaded = structuredClone(document);
  assert.deepEqual(loaded.pages[0].children[0].textPath, node.textPath);
  loaded.pages[0].children[0].textPath.flipped = 1;
  assert.throws(() => validateDocument(loaded), /text path/i);
  loaded.pages[0].children[0].textPath.flipped = true;
  loaded.pages[0].children[0].textPath.sourceId = 'missing-source';
  assert.throws(() => validateDocument(loaded), /text path source/i,
    'a linked path must refer to an existing same-page source');
  loaded.pages[0].children[0].textPath.sourceId = 'invalid\nsource';
  assert.throws(() => validateDocument(loaded), /text path/i,
    'source identifiers are bounded printable IDs');
  const invalidType = createDocument();
  addNode(invalidType, createNode('rectangle', { textPath: node.textPath }));
  assert.throws(() => validateDocument(invalidType), /text path/i);
});

test('linked text follows live path geometry and exports the current source shape', () => {
  const document = createDocument();
  const source = pathNode();
  const text = createNode('text', {
    name: 'Live curve label', text: 'Along the curve', x: source.x, y: source.y,
    width: source.width, height: source.height, rotation: source.rotation,
    textPath: { ...createTextPathGeometry(source), sourceId: source.id }
  });
  addNode(document, source);
  addNode(document, text);
  assert.doesNotThrow(() => validateDocument(document));

  const initialLength = flattenTextPath(getNodeTextPath(document, text)).at(-1).distance;
  source.x = 42;
  source.y = 61;
  source.width = 240;
  source.height = 70;
  source.rotation = 27;
  source.points[1].out.y = 1;

  assert.deepEqual(getNodeGeometry(document, text), {
    x: source.x, y: source.y, width: source.width, height: source.height,
    rotation: source.rotation, affineTransform: null
  });
  const currentPath = getNodeTextPath(document, text);
  assert.equal(currentPath.sourceId, source.id);
  assert.equal(currentPath.width, source.width);
  assert.equal(currentPath.height, source.height);
  assert.notEqual(flattenTextPath(currentPath).at(-1).distance, initialLength,
    'anchor and source-size edits change the path used by the label');
  const svg = exportPageToSvg(document.pages[0], { document, measureText: value => [...String(value)].length * 8 });
  assert.ok(svg.includes(`d="${textPathSvgData(currentPath)}"`), 'SVG export uses the current source path rather than the saved snapshot');
});

test('deleting or reparenting a linked path detaches the label at its latest geometry', () => {
  const removedDocument = createDocument();
  const removedSource = pathNode();
  const removedText = createNode('text', {
    text: 'Keep appearance', x: removedSource.x, y: removedSource.y,
    width: removedSource.width, height: removedSource.height,
    textPath: { ...createTextPathGeometry(removedSource), sourceId: removedSource.id }
  });
  addNode(removedDocument, removedSource);
  addNode(removedDocument, removedText);
  removedSource.width = 260;
  removedSource.points[1].in.y = -1;
  const expectedPath = getNodeTextPath(removedDocument, removedText);
  removeNode(removedDocument, removedSource.id);
  assert.equal(removedText.textPath.sourceId, undefined);
  const { sourceId: _removedSourceId, ...expectedDetachedPath } = expectedPath;
  assert.deepEqual(removedText.textPath, expectedDetachedPath);
  assert.doesNotThrow(() => validateDocument(removedDocument));

  const movedDocument = createDocument();
  const frame = createNode('frame', { x: 180, y: 120, width: 400, height: 300 });
  const movedSource = pathNode();
  const movedText = createNode('text', {
    text: 'Keep position', x: movedSource.x, y: movedSource.y,
    width: movedSource.width, height: movedSource.height,
    textPath: { ...createTextPathGeometry(movedSource), sourceId: movedSource.id }
  });
  addNode(movedDocument, frame);
  addNode(movedDocument, movedSource);
  addNode(movedDocument, movedText);
  movedSource.width = 220;
  movedSource.y = 34;
  const movedSnapshot = getNodeTextPath(movedDocument, movedText);
  assert.equal(moveNode(movedDocument, movedSource.id, { parentId: frame.id }), true);
  assert.equal(movedText.textPath.sourceId, undefined);
  assert.equal(movedText.textPath.width, movedSnapshot.width);
  assert.equal(movedText.y, 34);
  assert.equal(movedText.width, 220);
  assert.doesNotThrow(() => validateDocument(movedDocument));
});

test('manual text-path detachment freezes current source geometry and transform', () => {
  const document = createDocument();
  const source = pathNode();
  const text = createNode('text', {
    text: 'Independent label',
    textPath: { ...createTextPathGeometry(source), sourceId: source.id }
  });
  addNode(document, source);
  addNode(document, text);
  source.x = 80;
  source.y = 40;
  source.width = 240;
  source.rotation = 18;
  const expectedPath = getNodeTextPath(document, text);
  const { sourceId: _sourceId, ...expectedSnapshot } = expectedPath;

  assert.equal(detachNodeTextPath(document, text.id), true);
  assert.deepEqual(text.textPath, expectedSnapshot);
  assert.deepEqual([text.x, text.y, text.width, text.height, text.rotation], [80, 40, 240, source.height, 18]);
  source.width = 400;
  assert.deepEqual(getNodeTextPath(document, text), expectedSnapshot,
    'later source edits no longer move detached text');
  assert.doesNotThrow(() => validateDocument(document));
});

test('linked source IDs remap with duplicated subtrees and component instances', () => {
  const document = createDocument();
  const source = pathNode();
  const text = createNode('text', {
    text: 'Reusable curve', x: source.x, y: source.y,
    width: source.width, height: source.height,
    textPath: { ...createTextPathGeometry(source), sourceId: source.id }
  });
  const componentRoot = createNode('frame', {
    name: 'Linked text component', width: 240, height: 100, children: [source, text]
  });
  const masterSource = componentRoot.children.find(node => node.type === 'path');
  addNode(document, componentRoot);
  const duplicate = duplicateNode(document, componentRoot.id);
  const duplicateSource = duplicate.children.find(node => node.type === 'path');
  const duplicateText = duplicate.children.find(node => node.type === 'text');
  assert.equal(duplicateText.textPath.sourceId, duplicateSource.id);

  const component = createComponent(document, componentRoot.id);
  const instance = createComponentInstance(document, component.id);
  const instanceSource = instance.children.find(node => node.type === 'path');
  const instanceText = instance.children.find(node => node.type === 'text');
  assert.equal(instanceText.textPath.sourceId, instanceSource.id);
  instanceSource.width = 300;
  assert.equal(getNodeTextPath(document, instanceText).width, 300);

  masterSource.width = 350;
  syncComponentInstances(document, component.id);
  assert.equal(instanceText.textPath.sourceId, instanceSource.id);
  assert.equal(getNodeTextPath(document, instanceText).width, masterSource.width);
  assert.doesNotThrow(() => validateDocument(document));
});

test('canvas rendering positions editable graphemes on the path and reverses orientation when flipped', () => {
  const calls = [];
  const ctx = {
    font: '', textBaseline: '', textAlign: '',
    save() {}, restore() {}, translate(x, y) { calls.push(['translate', x, y]); },
    rotate(angle) { calls.push(['rotate', angle]); }, scale(x, y) { calls.push(['scale', x, y]); },
    fillText(text) { calls.push(['text', text]); }
  };
  const node = createNode('text', {
    fontSize: 12, textPath: {
      width: 80, height: 20, points: [{ x: 0, y: .5 }, { x: 1, y: .5 }], closed: false,
      startOffset: 0, flipped: false
    }
  });
  assert.equal(drawTextAlongPath(ctx, 'A🙂', node, 5, 8, value => value === 'A' ? 8 : 12), true);
  assert.deepEqual(calls.filter(call => call[0] === 'text').map(call => call[1]), ['A🙂'],
    'unsupported emoji sequences stay in a browser-shaped text run instead of being split into individual graphemes');
  const forwardAngle = calls.find(call => call[0] === 'rotate')[1];
  calls.length = 0;
  node.textPath.flipped = true;
  drawTextAlongPath(ctx, 'A', node, 5, 8, () => 8);
  assert.ok(Math.abs(Math.abs(calls.find(call => call[0] === 'rotate')[1] - forwardAngle) - Math.PI) < 1e-9);
  assert.ok(calls.some(call => call[0] === 'scale' && call[2] === -1));
  calls.length = 0;
  node.textPath.flipped = false;
  drawTextAlongPath(ctx, 'ABCDEFGHIJK', node, 5, 8, () => 10);
  assert.equal(calls.filter(call => call[0] === 'text').length, 8, 'open paths stop at their endpoint instead of piling glyphs there');
});

test('text on a path keeps rich-run type, color, tracking, baseline, and text-case styles', () => {
  const draws = [];
  const measured = [];
  let decorationStrokes = 0;
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1, textBaseline: '', textAlign: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { decorationStrokes += 1; },
    fillText(text, _x, y) { draws.push({ text, font: this.font, fillStyle: this.fillStyle, y }); }
  };
  const node = createNode('text', {
    text: 'Bold italic', textCase: 'uppercase', width: 160, height: 32,
    textRuns: [
      { text: 'Bold', fontFamily: 'Alpha', fontSize: 18, fontWeight: 700, color: '#ff0000', letterSpacing: 2, baselineShift: 3, textDecoration: 'underline' },
      { text: ' italic', fontFamily: 'Beta', fontSize: 12, fontStyle: 'italic', color: '#0000ff' }
    ],
    textPath: { width: 300, height: 20, points: [{ x: 0, y: .5 }, { x: 1, y: .5 }], closed: false, startOffset: 0, flipped: false }
  });
  assert.equal(drawTextAlongPath(ctx, node.text, node, 0, 0, (value, style) => {
    measured.push({ value, family: style.fontFamily, tracking: style.letterSpacing });
    return 8;
  }, { fillOpacity: .5, color: '#111111' }), true);

  assert.equal(draws.map(item => item.text).join(''), 'BOLD ITALIC');
  assert.ok(draws.slice(0, 4).every(item => item.font === '700 18px Alpha' && item.fillStyle === '#ff0000' && item.y === -3));
  assert.ok(draws.slice(4).every(item => item.font === 'italic 400 12px Beta' && item.fillStyle === '#0000ff'));
  assert.equal(measured[0].tracking, 2);
  assert.equal(measured[0].family, 'Alpha');
  assert.equal(decorationStrokes, 4, 'the underline follows each styled grapheme on its local path tangent');
});

test('text on a path shapes complete styled runs locally and places glyph clusters by their advances', () => {
  const shapeRequests = [];
  const painted = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', globalAlpha: 1, textBaseline: '', textAlign: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, fillText() {}, strokeText() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}
  };
  const node = createNode('text', {
    text: 'ab', fontSize: 10,
    textRuns: [
      { text: 'a', fontFeatures: { liga: 0 } },
      { text: 'b', fontFeatures: { liga: 1 } }
    ],
    textPath: { width: 100, height: 20, points: [{ x: 0, y: .5 }, { x: 1, y: .5 }], closed: false, startOffset: 0, flipped: false }
  });
  const result = (text, feature) => ({
    upem: 1000, extents: { ascender: 800 },
    glyphs: [{ cluster: 0, xAdvance: feature === 0 ? 1000 : 2000, xOffset: 0, yOffset: 0, path: 'M0 0' }]
  });
  assert.equal(drawTextAlongPath(ctx, node.text, node, 0, 0, () => 99, {
    shapeText(text, style) {
      shapeRequests.push({ text, features: style.fontFeatures });
      return result(text, style.fontFeatures?.liga);
    },
    drawShaped(context, shaped, text, x, topY, fontSize, letterSpacing, paintMode) {
      painted.push({ text, glyphCount: shaped.glyphs.length, x, topY, fontSize, letterSpacing, paintMode });
      return true;
    }
  }), true);
  assert.deepEqual(shapeRequests, [
    { text: 'a', features: { liga: 0 } },
    { text: 'b', features: { liga: 1 } }
  ], 'runs with distinct features are shaped independently while preserving their full run text');
  assert.deepEqual(painted.map(item => item.text), ['a', 'b']);
  assert.equal(painted[0].x, -5);
  assert.equal(painted[1].x, -10);
  assert.equal(painted[0].topY, -8, 'shaped outlines align their font ascender to the path baseline');
  assert.ok(painted.every(item => item.fontSize === 10 && item.letterSpacing === 0 && item.paintMode === 'fill'));

  const clusterPaints = [];
  const ligature = createNode('text', {
    text: 'fi', fontSize: 10,
    textPath: { width: 100, height: 20, points: [{ x: 0, y: .5 }, { x: 1, y: .5 }], closed: false, startOffset: 0, flipped: false }
  });
  drawTextAlongPath(ctx, 'fi', ligature, 0, 0, () => 99, {
    shapeText: text => ({ upem: 1000, extents: { ascender: 800 }, glyphs: [{ cluster: 0, xAdvance: 1200, path: 'M0 0' }] }),
    drawShaped(_context, shaped, text, x, topY) { clusterPaints.push({ text, glyphs: shaped.glyphs.length, x, topY }); return true; }
  });
  assert.deepEqual(clusterPaints, [{ text: 'fi', glyphs: 1, x: -6, topY: -8 }],
    'a ligature is placed and painted as one HarfBuzz cluster rather than as two independent letters');
});

test('mixed local and browser-shaped script runs stay connected on editable text paths', () => {
  const painted = [];
  const fallback = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', globalAlpha: 1, textBaseline: '', textAlign: '',
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    fillText(text) { fallback.push(text); }, strokeText(text) { fallback.push(text); }
  };
  const node = createNode('text', {
    text: 'Aمرحبا', fontSize: 10, letterSpacing: 1,
    textPath: { width: 120, height: 20, points: [{ x: 0, y: .5 }, { x: 1, y: .5 }], closed: false, startOffset: 0, flipped: false }
  });
  assert.equal(drawTextAlongPath(ctx, node.text, node, 0, 0, value => [...value].length * 5, {
    shapeText: () => ({ mixedRuns: [
      { text: 'A', shaped: { upem: 1000, extents: { ascender: 800 }, glyphs: [{ cluster: 0, xAdvance: 1000, path: 'M0 0' }] } },
      { text: 'مرحبا', shaped: null }
    ] }),
    drawShaped(_context, shaped, text) { painted.push({ text, count: shaped.glyphs.length }); return true; }
  }), true);
  assert.deepEqual(painted, [{ text: 'A', count: 1 }], 'the locally covered run still uses its HarfBuzz outline');
  assert.deepEqual(fallback, ['مرحبا'], 'the browser shapes the complete unsupported RTL run without breaking joining');
});

test('SVG exports editable textPath markup with a stable geometry reference and flip control', () => {
  const text = createNode('text', {
    id: 'curve-label', text: 'A & B', width: 100, height: 40, fontSize: 16,
    textPath: { ...createTextPathGeometry(pathNode()), startOffset: 14, flipped: true }
  });
  const svg = exportNodeToSvg(text, { measureText: value => [...String(value)].length * 8 });
  assert.match(svg, /<textPath href="#tis-text-path-curve-label-/);
  assert.match(svg, /side="right"/);
  assert.match(svg, /startOffset="14"/);
  assert.match(svg, /A &amp; B/);
  assert.match(svg, /d="M 0 20 C 25 -?0 25 -?0 50 20/);
});

test('SVG textPath exports preserve rich spans and measure their independent styles', () => {
  const text = createNode('text', {
    id: 'rich-curve-label', text: 'Bold & light', width: 160, height: 40,
    textRuns: [
      { text: 'Bold & ', fontFamily: 'Alpha', fontSize: 18, fontWeight: 700, color: '#ff0000', textDecoration: 'underline' },
      { text: 'light', fontFamily: 'Beta', fontSize: 12, fontStyle: 'italic', color: '#0000ff', baselineShift: 2 }
    ],
    textPath: { ...createTextPathGeometry(pathNode()), startOffset: 4 }
  });
  const measuredFamilies = [];
  const svg = exportNodeToSvg(text, {
    measureText: (value, node) => {
      measuredFamilies.push(node.textPathRunStyle?.fontFamily || 'base');
      return [...String(value)].length * (node.textPathRunStyle?.fontSize || 8);
    }
  });
  assert.match(svg, /<textPath[^>]*><tspan font-family="Alpha" font-size="18" font-weight="700"[^>]*fill="#ff0000" text-decoration="underline">Bold &amp; <\/tspan>/);
  assert.match(svg, /<tspan font-family="Beta" font-size="12"[^>]*fill="#0000ff" baseline-shift="2px">light<\/tspan>/);
  assert.deepEqual([...new Set(measuredFamilies.filter(family => family !== 'base'))], ['Alpha', 'Beta']);
});
