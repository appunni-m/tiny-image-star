import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, renderer, html, css, browserSmoke, browserWorkflow] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('./browser-smoke.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./shape-builder-smoke.mjs', import.meta.url), 'utf8')
]);

test('Shape Builder has a mobile-accessible Inspector entry and a canvas mode bar', () => {
  assert.match(main, /data-action="shape-builder-start"/,
    'the Inspector exposes Shape Builder without requiring a context-menu gesture');
  assert.match(main, /label: 'Shape Builder',[\s\S]*?enterShapeBuilder\(/,
    'vector context menus expose the same tool');
  assert.match(html, /id="shape-builder-bar"[\s\S]*?data-shape-builder-mode="extract"[\s\S]*?data-shape-builder-mode="subtract"[\s\S]*?data-action="shape-builder-done"/,
    'the in-canvas bar offers explicit extract, subtract, and done controls');
  assert.match(css, /\.shape-builder-actions button \{[^}]*min-height: 34px/);
  assert.match(css, /\.shape-builder-actions button \{ min-height: 44px; \}/,
    'touch controls grow to a mobile-friendly height');
});

test('canvas taps and drags preview regions and commit one atomic Shape Builder edit', () => {
  const pointerDownStart = main.indexOf('function onCanvasPointerDown(event) {');
  const pointerDownEnd = main.indexOf('\nfunction updateDraftShapeGeometry', pointerDownStart);
  const pointerDown = main.slice(pointerDownStart, pointerDownEnd);
  assert.match(pointerDown, /if \(state\.shapeBuilder && event\.button === 0\)[\s\S]*?kind: 'shape-builder'[\s\S]*?previewShapeBuilderPoint/);

  const pointerMoveStart = main.indexOf('function onCanvasPointerMove(event) {');
  const pointerMoveEnd = main.indexOf('\nfunction onCanvasPointerUp', pointerMoveStart);
  const pointerMove = main.slice(pointerMoveStart, pointerMoveEnd);
  assert.match(pointerMove, /if \(state\.shapeBuilder\)[\s\S]*?previewShapeBuilderPoint/,
    'hovering previews the current region');
  assert.match(pointerMove, /interaction\.kind === 'shape-builder'[\s\S]*?interaction\.regions\.set|previewShapeBuilderPoint\(world, interaction\)/,
    'drag sampling collects unique faces for a merge');

  const pointerUpStart = main.indexOf('function onCanvasPointerUp(event) {');
  const pointerUpEnd = main.indexOf('\nfunction cancelCanvasInteraction', pointerUpStart);
  const pointerUp = main.slice(pointerUpStart, pointerUpEnd);
  assert.match(pointerUp, /interaction\.kind === 'shape-builder'[\s\S]*?applyShapeBuilderEdit\(state\.document, builder\.sourceIds, interaction\.points/,
    'pointer-up commits the sampled operation through the atomic document editor');
  assert.match(pointerUp, /sourceSignatures[\s\S]*?selected vector changed while Shape Builder was open/,
    'stale geometry is rejected instead of applying a preview to different source layers');
});

test('renderer highlights the exact region preview and hides ordinary transform handles in Shape Builder mode', () => {
  assert.match(renderer, /function drawShapeBuilderRegions\([\s\S]*?ctx\.fill\('evenodd'\)/);
  assert.match(renderer, /if \(state\.shapeBuilder\) drawShapeBuilderRegions\(ctx, state\.shapeBuilder\.previewContours, state\.zoom\);/);
  assert.match(renderer, /state\.shapeBuilder \? \[\] : state\.selectedIds/);
});

test('Escape and Done leave Shape Builder without modifying source layers', () => {
  assert.match(main, /event\.key === 'Escape' && state\.shapeBuilder[\s\S]*?exitShapeBuilderMode\(\{ focusCanvas: true \}\)/);
  assert.match(main, /data-action="shape-builder-done"[\s\S]*?exitShapeBuilderMode\(\{ focusCanvas: true \}\)/);
});

test('desktop and phone browser workflows cover edit modes, pinch cancellation, and durable history', () => {
  assert.match(browserSmoke, /shape-builder-smoke\.mjs\?run=phone[\s\S]*?390, 844/);
  assert.match(browserSmoke, /shape-builder-smoke\.mjs\?run=desktop[\s\S]*?1280, 720/);
  assert.match(browserSmoke, /shapeBuilderPhoneRun, shapeBuilderDesktopRun/,
    'both viewport workflows must be part of the final browser smoke gate');
  assert.match(browserWorkflow, /Shape Builder undo[\s\S]*?Shape Builder redo/);
  assert.match(browserWorkflow, /Subtract should become the active mode/);
  assert.match(browserWorkflow, /drag-merged islands/);
  assert.match(browserWorkflow, /second touch should transfer to pinch navigation without committing/);
});
