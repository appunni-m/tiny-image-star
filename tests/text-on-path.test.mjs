import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, validateDocument } from '../src/model.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { createTextPathGeometry, createTextPathSampler, drawTextAlongPath, flattenTextPath, isValidTextPathGeometry, pointAtTextPathDistance } from '../src/text-on-path.js';

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
  const invalidType = createDocument();
  addNode(invalidType, createNode('rectangle', { textPath: node.textPath }));
  assert.throws(() => validateDocument(invalidType), /text path/i);
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
  assert.deepEqual(calls.filter(call => call[0] === 'text').map(call => call[1]), ['A', '🙂']);
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
