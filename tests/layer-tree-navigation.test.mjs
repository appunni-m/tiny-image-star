import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addNode, createDocument, createNode } from '../src/model.js';
import { layerTreeNavigationTarget } from '../src/layer-tree-navigation.js';

test('structural layer navigation follows the visible Layers order for siblings and children', () => {
  const document = createDocument();
  const parent = createNode('frame');
  const back = createNode('rectangle', { id: 'back' });
  const front = createNode('ellipse', { id: 'front' });
  const topLevelFront = createNode('rectangle', { id: 'top-level-front' });
  addNode(document, parent);
  addNode(document, back, { parentId: parent.id });
  addNode(document, front, { parentId: parent.id });
  addNode(document, topLevelFront);

  assert.equal(layerTreeNavigationTarget(document, [parent.id], 'child'), front.id,
    'Enter should descend to the first visible child, which is the topmost layer');
  assert.equal(layerTreeNavigationTarget(document, [front.id], 'next-sibling'), back.id);
  assert.equal(layerTreeNavigationTarget(document, [back.id], 'previous-sibling'), front.id);
  assert.equal(layerTreeNavigationTarget(document, [topLevelFront.id], 'next-sibling'), parent.id);
  assert.equal(layerTreeNavigationTarget(document, [parent.id], 'previous-sibling'), topLevelFront.id);
  assert.equal(layerTreeNavigationTarget(document, [front.id], 'parent'), parent.id);
  assert.equal(layerTreeNavigationTarget(document, [topLevelFront.id], 'parent'), null,
    'top-level objects do not navigate to a synthetic page layer');
});

test('structural navigation respects Fixed and Scrolls layer sections and stops at sibling boundaries', () => {
  const document = createDocument();
  const parent = createNode('frame', {
    width: 200, height: 200, overflowBehavior: 'vertical'
  });
  const fixed = createNode('rectangle', { id: 'fixed', scrollPosition: 'fixed' });
  const scrollingBack = createNode('rectangle', { id: 'scroll-back' });
  const scrollingFront = createNode('rectangle', { id: 'scroll-front' });
  addNode(document, parent);
  addNode(document, fixed, { parentId: parent.id });
  addNode(document, scrollingBack, { parentId: parent.id });
  addNode(document, scrollingFront, { parentId: parent.id });

  assert.equal(layerTreeNavigationTarget(document, [fixed.id], 'next-sibling'), scrollingFront.id);
  assert.equal(layerTreeNavigationTarget(document, [scrollingFront.id], 'previous-sibling'), fixed.id);
  assert.equal(layerTreeNavigationTarget(document, [scrollingBack.id], 'next-sibling'), null);
  assert.equal(layerTreeNavigationTarget(document, [fixed.id], 'previous-sibling'), null);
});

test('structural navigation rejects missing, multiple, and malformed requests', () => {
  const document = createDocument();
  const layer = createNode('rectangle');
  addNode(document, layer);
  assert.equal(layerTreeNavigationTarget(document, [], 'child'), null);
  assert.equal(layerTreeNavigationTarget(document, [layer.id, layer.id], 'child'), null);
  assert.equal(layerTreeNavigationTarget(document, ['missing'], 'child'), null);
  assert.equal(layerTreeNavigationTarget(document, [layer.id], 'left'), null);
  assert.equal(layerTreeNavigationTarget(document, null, 'parent'), null);
});

test('the canvas exposes and dispatches the layer navigation shortcuts', async () => {
  const [source, html] = await Promise.all([
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8')
  ]);
  assert.match(source, /function navigateCanvasLayerSelection\(direction\)[\s\S]*?const pageId = activePage\(\)\?\.id;[\s\S]*?layerTreeNavigationTarget\(state\.document, state\.selectedIds, direction, pageId\)/);
  assert.match(source, /event\.target === canvas && !navigationModifiers[\s\S]*?key === 'tab'[\s\S]*?previous-sibling[\s\S]*?next-sibling/);
  assert.match(source, /event\.target === canvas && !navigationModifiers[\s\S]*?key === 'enter'[\s\S]*?parent[\s\S]*?child/);
  assert.match(html, /<canvas id="scene-canvas"[^>]*aria-keyshortcuts="Enter Shift\+Enter Tab Shift\+Tab"/);
});
