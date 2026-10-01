import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, applyEffectStyle, createDocument, createEffectStyle, createLayerEffect, createNode, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { isValidLayerEffects, layerEffectPadding, MAX_EFFECTS_PER_LAYER, MAX_TEXTURE_EFFECTS_PER_LAYER } from '../src/layer-effects.js';
import { packLocalPackage, unpackLocalPackage } from '../src/storage.js';
import { createTextureEdgeAlphas, isValidTextureEffect, MAX_TEXTURE_MASK_PIXELS, textureSeedForLayer } from '../src/texture-effect.js';

const alphaImage = (width, height, alphaForPixel) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[(y * width + x) * 4 + 3] = alphaForPixel(x, y);
  }
  return { width, height, data };
};

test('texture effects validate positive anisotropic size, spread radius, and clip mode', () => {
  const effect = createLayerEffect('texture');
  assert.equal(effect.sizeX, 0.7);
  assert.equal(effect.sizeY, 0.7);
  assert.equal(effect.radius, 20);
  assert.equal(effect.clipToShape, true);
  assert.equal(isValidTextureEffect(effect), true);
  for (const invalid of [
    { ...effect, sizeX: 0 }, { ...effect, sizeY: Infinity }, { ...effect, radius: -1 },
    { ...effect, radius: 101 }, { ...effect, clipToShape: 'yes' }
  ]) assert.equal(isValidTextureEffect(invalid), false);
  assert.equal(isValidLayerEffects([effect]), true);
  assert.equal(isValidLayerEffects([effect, { ...effect, id: 'second-texture' }]), false, 'one layer supports at most one texture effect');
  assert.equal(MAX_TEXTURE_EFFECTS_PER_LAYER, 1);
  assert.equal(MAX_EFFECTS_PER_LAYER, 21, 'per-type limits cover eight each of both shadows, one blur slot, two noise, one texture, and one Glass');
  assert.deepEqual(layerEffectPadding([effect]), { x: 0, y: 0 }, 'clipped texture does not grow its layer bounds');
  assert.deepEqual(layerEffectPadding([{ ...effect, clipToShape: false, radius: 8 }]), { x: 9, y: 9 }, 'unclipped texture reserves spread plus a raster edge pixel');
});

test('texture edge masks are deterministic, perturb only the contour, and distinguish layers', () => {
  const width = 9;
  const height = 9;
  const base = alphaImage(width, height, (x, y) => x >= 3 && x <= 5 && y >= 3 && y <= 5 ? 255 : 0);
  const blurred = alphaImage(width, height, (x, y) => {
    const distance = Math.max(Math.abs(x - 4), Math.abs(y - 4));
    if (distance === 0) return 255;
    if (distance === 1) return 180;
    return distance === 2 ? 80 : distance === 3 ? 8 : 0;
  });
  const effect = createLayerEffect('texture', { id: 'paper-edge', sizeX: 1.4, sizeY: 2.2, radius: 4, clipToShape: false });
  const seed = textureSeedForLayer('hero-image', 2);
  const first = createTextureEdgeAlphas(base, blurred, width, height, effect, 1, seed);
  const repeat = createTextureEdgeAlphas(base, blurred, width, height, effect, 1, seed);
  const other = createTextureEdgeAlphas(base, blurred, width, height, effect, 1, textureSeedForLayer('other-image', 2));
  assert.deepEqual(first, repeat, 'same layer, effect slot, and inputs generate identical edges on redraw');
  assert.notDeepEqual(first.inside, other.inside, 'different layers get independent distress patterns');
  assert.equal(first.inside[(4 * width + 4)], 255, 'opaque interior stays fully filled');
  assert.equal(first.outside[(4 * width + 4)], 0, 'interior never becomes an outside fringe');
  assert.ok(first.inside.some((alpha, index) => alpha < 255 && base.data[index * 4 + 3] > 0), 'the original edge is irregularly cut');
  assert.ok(first.outside.some(alpha => alpha > 0), 'unclipped texture can extend beyond the original silhouette');

  const clipped = createTextureEdgeAlphas(base, blurred, width, height, { ...effect, clipToShape: true }, 1, seed);
  assert.ok(clipped.outside.every(alpha => alpha === 0), 'clip-to-shape removes all outside texture pixels');
});

test('texture mask generation rejects malformed buffers and work beyond its memory budget', () => {
  const effect = createLayerEffect('texture');
  const tiny = alphaImage(2, 2, () => 255);
  assert.throws(() => createTextureEdgeAlphas(tiny, tiny, 2, 2, { ...effect, radius: -1 }), /invalid texture/);
  assert.throws(() => createTextureEdgeAlphas(tiny, tiny, 3, 2, effect, 1, 0), /bounded pixel budget/, 'dimension mismatch fails before allocation');
  assert.ok(MAX_TEXTURE_MASK_PIXELS <= 1_000_000, 'edge scratch buffers stay capped at one megapixel');
});

test('texture effect settings persist through local saves, .flocal packages, and reusable effect styles', () => {
  const document = createDocument();
  const texture = createLayerEffect('texture', { sizeX: 0.7, sizeY: 1.4, radius: 12.5, clipToShape: false });
  const source = createNode('rectangle', { name: 'Source', effects: [texture, createLayerEffect('noise', { mode: 'duo', sizeX: 3, sizeY: 4 })] });
  const target = createNode('ellipse', { name: 'Target' });
  addNode(document, source);
  addNode(document, target);
  const style = createEffectStyle(document, source.id, 'Rough grain');
  assert.deepEqual(style.effects, source.effects, 'saving records the full ordered texture/noise stack');

  const locallySaved = parseDocument(serializeDocument(document));
  assert.equal(validateDocument(locallySaved), true);
  assert.deepEqual(locallySaved.effectStyles[0].effects, source.effects);
  const packaged = unpackLocalPackage(packLocalPackage(locallySaved, []));
  assert.deepEqual(packaged.document.effectStyles[0].effects, source.effects);
  assert.equal(applyEffectStyle(packaged.document, target.id, style.id), true);
  const applied = packaged.document.pages[0].children.find(node => node.id === target.id);
  assert.deepEqual(applied.effects.map(effect => effect.type), ['texture', 'noise']);
  assert.deepEqual(applied.effects.map(({ id, ...effect }) => effect), style.effects.map(({ id, ...effect }) => effect));
});
