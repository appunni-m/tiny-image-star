import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canvasPixelFromClientPoint, resizeCanvasSurface, sampleColorAt } from '../src/eyedropper.js';

test('repeated samples reuse one offscreen canvas and resize it only when the viewport changes', () => {
  let creations = 0;
  const createSurface = () => { creations += 1; return { width: 0, height: 0 }; };
  const first = resizeCanvasSurface(null, 1920, 1080, createSurface);
  assert.equal(resizeCanvasSurface(first, 1920, 1080, createSurface), first);
  assert.deepEqual([first.width, first.height], [1920, 1080]);
  assert.equal(creations, 1, 'a click-to-sample interaction must not allocate another full-size surface');
  assert.equal(resizeCanvasSurface(first, 1280, 720, createSurface), first);
  assert.deepEqual([first.width, first.height], [1280, 720]);
  assert.equal(creations, 1, 'resizing can reuse the same backing surface');
  assert.throws(() => resizeCanvasSurface(first, 0, 720, createSurface), /positive integer dimensions/);
});

test('maps client coordinates into device pixels with right and bottom edges exclusive', () => {
  const rect = { left: 100, top: 50, width: 120, height: 80 };
  assert.deepEqual(canvasPixelFromClientPoint({ clientX: 100, clientY: 50, rect, pixelWidth: 240, pixelHeight: 160 }), { x: 0, y: 0 });
  assert.deepEqual(canvasPixelFromClientPoint({ clientX: 219.9, clientY: 129.9, rect, pixelWidth: 240, pixelHeight: 160 }), { x: 239, y: 159 });
  assert.equal(canvasPixelFromClientPoint({ clientX: 220, clientY: 90, rect, pixelWidth: 240, pixelHeight: 160 }), null);
  assert.equal(canvasPixelFromClientPoint({ clientX: 150, clientY: 130, rect, pixelWidth: 240, pixelHeight: 160 }), null);
  assert.equal(canvasPixelFromClientPoint({ clientX: 100, clientY: 50, rect: { ...rect, width: 0 }, pixelWidth: 240, pixelHeight: 160 }), null);
});

test('samples the requested pixel as an opaque hex color', () => {
  const imageData = { width: 2, height: 2, data: new Uint8ClampedArray([
    12, 34, 56, 255, 255, 0, 127, 255,
    0, 255, 32, 255, 90, 80, 70, 255
  ]) };
  assert.equal(sampleColorAt(imageData, 0, 0), '#0c2238');
  assert.equal(sampleColorAt(imageData, 1, 0), '#ff007f');
  assert.equal(sampleColorAt(imageData, 0, 1), '#00ff20');
  assert.equal(sampleColorAt(imageData, 1, 1), '#5a5046');
  assert.equal(sampleColorAt(imageData, 2, 1), null);
  assert.equal(sampleColorAt(imageData, -1, 0), null);
});

test('composites transparent samples over the rendered editor backdrop', () => {
  const imageData = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 128]) };
  assert.equal(sampleColorAt(imageData, 0, 0), '#f47474');
  assert.equal(sampleColorAt(imageData, 0, 0, { background: '#ffffff' }), '#ff7f7f');
});

test('eyedropper is wired to an accessible toolbar control, keyboard shortcut and overlay-free scene render', async () => {
  const [main, renderer, index, styles] = await Promise.all([
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8')
  ]);
  assert.match(index, /data-tool="eyedropper"[^>]*title="Eyedropper \(I\)[^"]*"[^>]*aria-label="Eyedropper · sample a color"/);
  assert.match(main, /i:\s*'eyedropper'/);
  assert.match(main, /renderer\?\.sampleColor\(event\.clientX, event\.clientY\)/);
  assert.match(main, /function applyEyedropperColor\(color\)/);
  assert.match(main, /detachPrimaryFillBinding\(node, primary/);
  assert.match(renderer, /import \{ canvasPixelFromClientPoint, resizeCanvasSurface, sampleColorAt \} from '\.\/eyedropper\.js'/);
  const samplingMethod = renderer.split('  sampleColor(clientX, clientY) {')[1]?.split('\n  draw() {')[0];
  assert.ok(samplingMethod, 'renderer exposes a dedicated local scene sampler');
  assert.match(samplingMethod, /this\.drawNode\(context, node/);
  assert.match(samplingMethod, /resizeCanvasSurface\(this\.samplingSurface, width, height/,
    'the scene sampler should reuse its private backing surface across samples');
  assert.match(samplingMethod, /outlineMode: false, showLayoutGuides: false, showEmptyFrameHint: false, showImageLoadingPlaceholder: false/);
  assert.doesNotMatch(samplingMethod, /drawSelection|drawCommentPins|drawPrototypeConnections/);
  assert.match(styles, /#scene-canvas\.tool-eyedropper\s*\{\s*cursor:\s*crosshair;/);
});
