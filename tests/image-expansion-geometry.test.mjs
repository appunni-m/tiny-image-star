import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandedImageLayerGeometry,
  imageExpansionPaddingFromRatio,
  normalizeImageExpansionRatio,
  remapImageEraseStrokesForExpansion,
} from '../src/image-expansion-geometry.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';

test('expansion ratios become bounded source-relative integer padding', () => {
  assert.deepEqual(imageExpansionPaddingFromRatio(80, 40, { top: .25, right: .1, bottom: 0, left: .5 }), {
    top: 10, right: 8, bottom: 0, left: 40,
  });
  assert.deepEqual(imageExpansionPaddingFromRatio(3, 2, { top: .01, right: 0, bottom: 0, left: 0 }), {
    top: 1, right: 0, bottom: 0, left: 0,
  });
  assert.throws(() => normalizeImageExpansionRatio({ top: 0, right: 0, bottom: 0, left: 0 }), /at least one side/i);
  assert.throws(() => normalizeImageExpansionRatio({ top: 1.01 }), /between 0 and 100 percent/i);
  assert.throws(() => imageExpansionPaddingFromRatio(0, 20, { right: .5 }), /valid source dimensions/i);
});

test('growing a transformed image preserves every original source point in page space', () => {
  const ancestors = [
    { id: 'outer', type: 'frame', x: 130, y: -80, width: 900, height: 600, rotation: 17, affineTransform: { a: 1.2, b: .1, c: -.2, d: .9 } },
    { id: 'inner', type: 'frame', x: 36, y: 51, width: 410, height: 300, rotation: -21 },
  ];
  const image = { id: 'photo', type: 'image', x: 42, y: 27, width: 240, height: 150, rotation: 31, affineTransform: { a: .93, b: .12, c: -.08, d: 1.07 } };
  const sourceWidth = 1200;
  const sourceHeight = 600;
  const padding = { top: 150, right: 240, bottom: 60, left: 120 };
  const oldPixel = { x: 321, y: 211 };
  const oldLocal = { x: oldPixel.x * image.width / sourceWidth, y: oldPixel.y * image.height / sourceHeight };
  const oldPage = nodeLocalToPage(image, oldLocal, ancestors);
  const geometry = expandedImageLayerGeometry(image, ancestors, sourceWidth, sourceHeight, padding);
  const expanded = { ...image, ...geometry };
  const expandedLocal = {
    x: (oldPixel.x + padding.left) * image.width / sourceWidth,
    y: (oldPixel.y + padding.top) * image.height / sourceHeight,
  };
  const expandedPage = nodeLocalToPage(expanded, expandedLocal, ancestors);
  assert.ok(Math.abs(expandedPage.x - oldPage.x) < 1e-8);
  assert.ok(Math.abs(expandedPage.y - oldPage.y) < 1e-8);
  assert.equal(geometry.width, 312);
  assert.equal(geometry.height, 202.5);
});

test('saved erase marks follow the same source pixels into the expanded image', () => {
  const strokes = [{ radius: .02, points: [{ x: .25, y: .75 }] }];
  const padding = { top: 20, right: 40, bottom: 10, left: 10 };
  const mapped = remapImageEraseStrokesForExpansion(strokes, 200, 100, padding);
  assert.deepEqual(mapped[0].points[0], { x: 60 / 250, y: 95 / 130 });
  assert.equal(mapped[0].radius, .02 * 100 / 130);
  const originalPixel = { x: strokes[0].points[0].x * 200, y: strokes[0].points[0].y * 100 };
  const mappedPixel = { x: mapped[0].points[0].x * 250, y: mapped[0].points[0].y * 130 };
  assert.deepEqual(mappedPixel, { x: originalPixel.x + padding.left, y: originalPixel.y + padding.top });
});
