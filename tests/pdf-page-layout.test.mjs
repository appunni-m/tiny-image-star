import test from 'node:test';
import assert from 'node:assert/strict';
import { fitPdfContent, PDF_PAGE_LAYOUT_LIMITS, PDF_PAGE_PRESETS, pdfContentRenderScale, planPdfPage } from '../src/pdf-page-layout.js';

test('resolves standard sizes and orientations to correct physical and raster dimensions', () => {
  const a4 = planPdfPage({ preset: 'a4', orientation: 'portrait' });
  assert.equal(a4.widthMm, 210);
  assert.equal(a4.heightMm, 297);
  assert.ok(Math.abs(a4.widthPt - 595.276) < 0.01);
  assert.deepEqual([a4.widthPx, a4.heightPx], [1191, 1684]);
  assert.equal(a4.marginPx, 68);
  const letter = planPdfPage({ preset: 'letter', orientation: 'landscape' });
  assert.ok(letter.widthMm > letter.heightMm);
  assert.equal(letter.widthPt, letter.widthMm / 25.4 * 72);
  assert.equal(Object.keys(PDF_PAGE_PRESETS).length, 4);
});

test('fits artwork inside print margins without cropping and centers spare space', () => {
  const page = planPdfPage({ preset: 'a4', orientation: 'portrait' });
  const portrait = fitPdfContent(600, 900, page);
  assert.equal(portrait.scale, Math.min((page.widthPx - 2 * page.marginPx) / 600, (page.heightPx - 2 * page.marginPx) / 900));
  assert.ok(portrait.x >= page.marginPx && portrait.y >= page.marginPx);
  assert.ok(portrait.x + portrait.width <= page.widthPx - page.marginPx + 1e-9);
  assert.ok(portrait.y + portrait.height <= page.heightPx - page.marginPx + 1e-9);
  const landscape = fitPdfContent(1200, 600, page);
  assert.equal(landscape.y, (page.heightPx - landscape.height) / 2);
});

test('bounds custom page size and render work before allocating raster surfaces', () => {
  assert.throws(() => planPdfPage({ preset: 'custom', widthMm: 0, heightMm: 100 }), /between 25 and 2,000 mm/);
  assert.throws(() => planPdfPage({ preset: 'custom', widthMm: 1000, heightMm: 1000 }), /too large to rasterize/);
  assert.throws(() => planPdfPage({ preset: 'custom', widthMm: 25, heightMm: 60, marginMm: 13 }), /margins must be smaller/);
  assert.equal(PDF_PAGE_LAYOUT_LIMITS.maxRasterPixels, 16_000_000);
  assert.equal(pdfContentRenderScale({ width: 10_000, height: 10_000 }), 0.4);
  assert.throws(() => pdfContentRenderScale({ width: -1, height: 1 }), /valid page bound/);
});
