import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultLocalFontFamily, inspectLocalFontFormat, loadLocalFontFace, mapLocalFontAssets, validateLocalFontAsset
} from '../src/font-assets.js';

const fontBytes = (signature = [0x77, 0x4f, 0x46, 0x32]) => new Uint8Array([...signature, 0, 0, 0, 0, 0, 0, 0, 0]);
const font = (overrides = {}) => ({
  id: 'font-1', name: 'DisplaySans.woff2', type: 'font/woff2', family: 'Display Sans', weight: 400, style: 'normal', bytes: fontBytes(),
  ...overrides
});

test('local font validation accepts supported signatures and infers a useful family name', () => {
  assert.equal(inspectLocalFontFormat('regular.woff2', fontBytes()).type, 'font/woff2');
  assert.equal(inspectLocalFontFormat('regular.woff', fontBytes([0x77, 0x4f, 0x46, 0x46])).type, 'font/woff');
  assert.equal(inspectLocalFontFormat('regular.otf', fontBytes([0x4f, 0x54, 0x54, 0x4f])).type, 'font/otf');
  assert.equal(inspectLocalFontFormat('regular.ttf', fontBytes([0, 1, 0, 0])).type, 'font/ttf');
  assert.equal(defaultLocalFontFamily('display-sans.woff2'), 'display sans');
  assert.deepEqual(validateLocalFontAsset(font()), font());
});

test('local font validation rejects unsupported, mislabeled, oversized, and malformed metadata', () => {
  assert.throws(() => inspectLocalFontFormat('font.otf', fontBytes()), /extension does not match/i);
  assert.throws(() => inspectLocalFontFormat('font.svg', fontBytes([1, 2, 3, 4])), /choose a TrueType/i);
  assert.throws(() => inspectLocalFontFormat('font.woff2', new Uint8Array([1, 2, 3])), /header/i);
  assert.throws(() => validateLocalFontAsset(font({ family: '   ' })), /family name/i);
  assert.throws(() => validateLocalFontAsset(font({ weight: 1001 })), /weight/i);
  assert.throws(() => validateLocalFontAsset(font({ style: 'oblique' })), /style/i);
  assert.throws(() => validateLocalFontAsset(font({ type: 'font/ttf' })), /MIME type/i);
});

test('FontFace loads from an isolated byte copy and registers with local document fonts', async () => {
  const observed = { registrations: [], removed: [] };
  class FakeFontFace {
    constructor(family, source, descriptors) {
      observed.family = family; observed.source = source; observed.descriptors = descriptors; this.status = 'unloaded';
    }
    async load() { this.status = 'loaded'; return this; }
  }
  const fontSet = {
    add(face) { observed.registrations.push(face); },
    delete(face) { observed.removed.push(face); }
  };
  const source = font();
  const face = await loadLocalFontFace(source, { FontFaceConstructor: FakeFontFace, fontSet });
  assert.equal(face.status, 'loaded');
  assert.equal(observed.family, source.family);
  assert.deepEqual(observed.descriptors, { weight: '400', style: 'normal', display: 'swap' });
  assert.equal(observed.source instanceof ArrayBuffer, true);
  assert.notEqual(observed.source, source.bytes.buffer, 'FontFace receives its own transferable copy.');
  assert.deepEqual(observed.registrations, [face]);
});

test('invalid font data is rejected by browser FontFace parsing before it is registered', async () => {
  class RejectingFontFace {
    constructor() { this.status = 'unloaded'; }
    async load() { throw new Error('unsupported sfnt table'); }
  }
  const fontSet = { added: 0, deleted: 0, add() { this.added += 1; }, delete() { this.deleted += 1; } };
  await assert.rejects(loadLocalFontFace(font(), { FontFaceConstructor: RejectingFontFace, fontSet }), /unsupported sfnt table/i);
  assert.equal(fontSet.added, 0);
  assert.equal(fontSet.deleted, 1);
});

test('local font catalog loading preserves order while bounding simultaneous binary work', async () => {
  const records = Array.from({ length: 7 }, (_, index) => ({ id: `font-${index}`, index }));
  let active = 0;
  let peak = 0;
  const results = await mapLocalFontAssets(records, async record => {
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    return record.index * 2;
  }, 2);

  assert.deepEqual(results, [0, 2, 4, 6, 8, 10, 12]);
  assert.equal(peak, 2, 'font file reads and FontFace parsing should stay within the configured worker bound');
  await assert.rejects(mapLocalFontAssets(records, async () => null, 0), /positive integer/i);
});
