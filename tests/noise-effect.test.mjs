import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createLayerEffect, createNode, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { isValidLayerEffects, MAX_EFFECTS_PER_LAYER, MAX_NOISE_EFFECTS_PER_LAYER } from '../src/layer-effects.js';
import { createNoisePixelGrid, isValidNoiseEffect, noiseSeedForLayer } from '../src/noise-effect.js';

test('noise effects persist their complete color, pixel-size, density, and opacity settings', () => {
  const effect = createLayerEffect('noise', {
    id: 'film-grain', mode: 'duo', sizeX: 7, sizeY: 3, density: 72,
    color: '#163a5f', color2: '#e0b45c', opacity: 0.63
  });
  const document = createDocument();
  const layer = createNode('rectangle', { effects: [effect] });
  addNode(document, layer);
  assert.equal(isValidNoiseEffect(effect), true);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
  assert.deepEqual(parseDocument(serializeDocument(document)).pages[0].children[0].effects, [effect]);
});

test('noise modes validate the appropriate color settings and bounded controls', () => {
  const defaults = createLayerEffect('noise');
  assert.equal(isValidNoiseEffect(defaults), true);
  assert.equal(isValidNoiseEffect({ ...defaults, mode: 'multi', color: undefined, color2: undefined }), true, 'Multi noise uses random colors with opacity only');
  assert.equal(isValidNoiseEffect({ ...defaults, mode: 'mono', color: 'blue' }), false);
  assert.equal(isValidNoiseEffect({ ...defaults, mode: 'duo', color2: '#fff' }), false);
  assert.equal(isValidNoiseEffect({ ...defaults, mode: 'other' }), false);
  assert.equal(isValidNoiseEffect({ ...defaults, sizeX: 0 }), false);
  assert.equal(isValidNoiseEffect({ ...defaults, sizeY: 101 }), false);
  assert.equal(isValidNoiseEffect({ ...defaults, density: 101 }), false);
  assert.equal(isValidNoiseEffect({ ...defaults, opacity: -0.1 }), false);
});

test('one layer accepts at most two noise effects alongside the supported shadow and blur limits', () => {
  const effects = [
    ...Array.from({ length: 8 }, (_, index) => createLayerEffect('drop-shadow', { id: `drop-${index}` })),
    ...Array.from({ length: 8 }, (_, index) => createLayerEffect('inner-shadow', { id: `inner-${index}` })),
    createLayerEffect('background-blur', { id: 'backdrop' }),
    createLayerEffect('noise', { id: 'grain-a' }), createLayerEffect('noise', { id: 'grain-b' })
  ];
  assert.equal(MAX_NOISE_EFFECTS_PER_LAYER, 2);
  assert.equal(MAX_EFFECTS_PER_LAYER, 21);
  assert.equal(isValidLayerEffects(effects), true);
  assert.equal(isValidLayerEffects([...effects, createLayerEffect('noise', { id: 'grain-c' })]), false);
});

test('noise pixel grids are stable for a layer slot and create distinct Mono, Duo, and Multi grain', () => {
  const seed = noiseSeedForLayer('layer-12', 2);
  assert.equal(noiseSeedForLayer('layer-12', 2), seed, 'rerenders of the same layer slot keep their local grain seed');
  assert.notEqual(noiseSeedForLayer('layer-13', 2), seed);
  assert.notEqual(noiseSeedForLayer('layer-12', 1), seed);

  const duo = createLayerEffect('noise', {
    id: 'duo-grain', mode: 'duo', sizeX: 2, sizeY: 4, density: 100,
    color: '#000000', color2: '#ffffff', opacity: 0.5
  });
  const grid = createNoisePixelGrid(duo, 13, 9, 1, seed);
  assert.deepEqual([grid.width, grid.height, grid.cellWidth, grid.cellHeight], [7, 3, 2, 4]);
  assert.deepEqual(grid, createNoisePixelGrid(duo, 13, 9, 1, seed));
  const activeColors = new Set();
  for (let offset = 0; offset < grid.data.length; offset += 4) {
    assert.equal(grid.data[offset + 3], Math.round(0.5 * 255));
    activeColors.add(`${grid.data[offset]},${grid.data[offset + 1]},${grid.data[offset + 2]}`);
  }
  assert.deepEqual(activeColors, new Set(['0,0,0', '255,255,255']));
  assert.notDeepEqual(grid.data, createNoisePixelGrid(duo, 13, 9, 1, seed + 1).data);

  const multi = createLayerEffect('noise', { id: 'multi-grain', mode: 'multi', sizeX: 1, sizeY: 1, density: 100, opacity: 1 });
  const multiGrid = createNoisePixelGrid(multi, 16, 16, 1, seed);
  assert.ok(new Set(Array.from({ length: multiGrid.width * multiGrid.height }, (_, index) => {
    const offset = index * 4;
    return `${multiGrid.data[offset]},${multiGrid.data[offset + 1]},${multiGrid.data[offset + 2]}`;
  })).size > 200, 'Multi mode spans many independent local RGB colors');
});

test('noise density zero clears grain and preview generation rejects unbounded surfaces', () => {
  const empty = createLayerEffect('noise', { density: 0 });
  assert.ok(createNoisePixelGrid(empty, 20, 12, 2, 1).data.every(value => value === 0));
  assert.throws(() => createNoisePixelGrid(empty, 2001, 2000, 1, 1), /bounded pixel budget/);
  assert.throws(() => createNoisePixelGrid({ ...empty, sizeX: 0 }, 10, 10, 1, 1), /invalid noise effect/);
});
