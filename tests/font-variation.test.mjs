import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { loadLocalFontFace } from '../src/font-assets.js';
import { calculateTextBox } from '../src/text-layout.js';
import {
  canvasFontWeight, fontVariationInspectionStatus, fontVariationSettings, setFontVariationValue,
  inspectFontVariationAxes, isValidFontVariationValues, parseFontVariationSettings
} from '../src/font-variation.js';

const axes = [
  { tag: 'wght', min: 100, defaultValue: 400, max: 900 },
  { tag: 'opsz', min: 8, defaultValue: 14, max: 72 }
];

function fvarTable(axisRecords = axes) {
  const bytes = new Uint8Array(16 + axisRecords.length * 20);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, false);
  view.setUint16(2, 0, false);
  view.setUint16(4, 16, false);
  view.setUint16(6, 2, false);
  view.setUint16(8, axisRecords.length, false);
  view.setUint16(10, 20, false);
  view.setUint16(12, 0, false);
  view.setUint16(14, 4 + axisRecords.length * 4, false);
  axisRecords.forEach((axis, index) => {
    const offset = 16 + index * 20;
    bytes.set([...axis.tag].map(character => character.charCodeAt(0)), offset);
    view.setInt32(offset + 4, Math.round(axis.min * 65_536), false);
    view.setInt32(offset + 8, Math.round(axis.defaultValue * 65_536), false);
    view.setInt32(offset + 12, Math.round(axis.max * 65_536), false);
    view.setUint16(offset + 16, 0, false);
    view.setUint16(offset + 18, 256 + index, false);
  });
  return bytes;
}

function sfntFont(table = fvarTable()) {
  const offset = 28;
  const bytes = new Uint8Array(offset + table.length);
  bytes.set([0, 1, 0, 0], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 1, false);
  bytes.set([... 'fvar'].map(character => character.charCodeAt(0)), 12);
  view.setUint32(20, offset, false);
  view.setUint32(24, table.length, false);
  bytes.set(table, offset);
  return bytes;
}

function woffFont(table, compressed = false) {
  const stored = compressed ? deflateSync(table) : table;
  const offset = 64;
  const bytes = new Uint8Array(offset + stored.length);
  bytes.set([... 'wOFF'].map(character => character.charCodeAt(0)), 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(12, 1, false);
  bytes.set([... 'fvar'].map(character => character.charCodeAt(0)), 44);
  view.setUint32(48, offset, false);
  view.setUint32(52, stored.length, false);
  view.setUint32(56, table.length, false);
  bytes.set(stored, offset);
  return bytes;
}

test('variable-font inspection reads bounded axis metadata from sfnt and compressed WOFF tables', async () => {
  assert.deepEqual(await inspectFontVariationAxes(sfntFont()), axes);
  assert.deepEqual(await inspectFontVariationAxes(woffFont(fvarTable())), axes);
  assert.deepEqual(await inspectFontVariationAxes(woffFont(fvarTable(), true)), axes);
  assert.deepEqual(await inspectFontVariationAxes(sfntFont(new Uint8Array(16))), []);
});

test('malformed variable axis records and failed WOFF2 decoding fail closed', async () => {
  assert.deepEqual(await inspectFontVariationAxes(sfntFont(fvarTable([
    { tag: 'wght', min: 900, defaultValue: 400, max: 100 }
  ]))), []);
  const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]);
  assert.equal(fontVariationInspectionStatus(woff2), 'inspected');
  assert.deepEqual(await inspectFontVariationAxes(woff2), []);
  assert.deepEqual(await inspectFontVariationAxes(woff2, { decompressWoff2: async () => sfntFont() }), axes);
  assert.deepEqual(await inspectFontVariationAxes(woff2, { decompressWoff2: async () => { throw new Error('corrupt WOFF2'); } }), []);
});

test('font variation CSS coordinates serialize deterministically and parse back exactly', () => {
  const source = { opsz: 12.5, wght: 625, wdth: 88.25 };
  const css = fontVariationSettings(source);
  assert.equal(css, '"opsz" 12.5, "wdth" 88.25, "wght" 625');
  assert.deepEqual(parseFontVariationSettings(css), { opsz: 12.5, wdth: 88.25, wght: 625 });
  assert.deepEqual(parseFontVariationSettings('normal'), {});
  assert.equal(parseFontVariationSettings('"wght" 400, "wght" 500'), null);
  assert.equal(isValidFontVariationValues(source), true);
  assert.equal(isValidFontVariationValues({ wght: Infinity }), false);
  assert.equal(canvasFontWeight(400, { wght: 625 }), 625);
  assert.equal(canvasFontWeight(700, { opsz: 12 }), 700);
});

test('changing an axis retains the other coordinates and remeasures auto-width text with its weight axis', () => {
  const changedAxes = setFontVariationValue({ opsz: 14, wdth: 100, wght: 400 }, 'wght', 700);
  assert.deepEqual(changedAxes, { opsz: 14, wdth: 100, wght: 700 });
  const observedFonts = [];
  const context = {
    font: '',
    measureText(value) {
      observedFonts.push(this.font);
      const width = this.font.startsWith('700 ') ? 16 : 10;
      return { width: String(value).length * width };
    }
  };
  const measured = calculateTextBox(context, {
    type: 'text', text: 'abc', width: 30, height: 20, textFit: 'auto-width',
    fontFamily: 'Local Variable', fontSize: 10, fontWeight: 400, fontAxes: changedAxes
  });
  assert.ok(observedFonts.some(font => font.startsWith('700 10px Local Variable')));
  assert.equal(measured.width, 50, 'weight-axis measurement flows into auto-width sizing');
});

test('a local variable weight axis expands the FontFace weight matching range', async () => {
  let descriptors;
  class FakeFontFace {
    constructor(_family, _source, value) { descriptors = value; this.status = 'unloaded'; }
    async load() { this.status = 'loaded'; return this; }
  }
  const asset = {
    id: 'variable-font', name: 'Variable.ttf', type: 'font/ttf', family: 'Variable', weight: 400,
    style: 'normal', bytes: sfntFont()
  };
  await loadLocalFontFace(asset, { FontFaceConstructor: FakeFontFace, fontSet: { add() {}, delete() {} } });
  assert.deepEqual(descriptors, { weight: '100 900', style: 'normal', display: 'swap' });
});
