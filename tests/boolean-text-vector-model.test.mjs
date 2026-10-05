import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import {
  addNode, applyBooleanBake, applyBooleanCombine, bindColorVariable, bindVariable, createColorVariable,
  createDocument, createNode, createTypographyStyle, createVariable, createVariableCollection,
  getBooleanVectorPath, getNodeTextPath, groupLayers, frameSelection, moveNode, prepareBooleanBake, prepareBooleanCombine, resolveBooleanSourceNode, setVariableValue,
  validateBooleanCombinePlan, validateDocument, separateBoolean
} from '../src/model.js';
import { booleanGeometryWithKit } from '../src/vector-geometry-kernel.js';
import { configureBooleanTextGeometry, disposeBooleanTextGeometryCache } from '../src/boolean-text-geometry.js';
import { createTextPathGeometry } from '../src/text-on-path.js';

const require = createRequire(import.meta.url);
const kit = await require('canvaskit-wasm')({ wasmBinary: await readFile(new URL('../node_modules/canvaskit-wasm/bin/canvaskit.wasm', import.meta.url)) });
const nativeBoolean = request => booleanGeometryWithKit(kit, request);
const shaped = [];
const shapeText = (text, style) => {
  shaped.push({ fontSize: style.fontSize, family: style.fontFamily, color: style.color,
    letterSpacing: style.letterSpacing, letterSpacingUnit: style.letterSpacingUnit });
  return { upem: 1000, extents: { ascender: 800, descender: -200, lineGap: 0 },
    glyphs: [...text].map((char, cluster) => ({ id: char.codePointAt(0), cluster, xAdvance: 500, yAdvance: 0, xOffset: 0, yOffset: 0,
      path: /\s/u.test(char) ? '' : 'M0 0L400 0L400 700L0 700Z' })) };
};

test('prepared editable text Boolean retains glyph coverage and source layers, and inherits resolved text color', async () => {
  shaped.length = 0;
  const document = createDocument();
  const text = createNode('text', { name: 'Glyph source', x: 10, y: 10, width: 80, height: 60, text: 'HH', fontFamily: 'Local', fontSize: 30, color: '#111111' });
  const rect = createNode('rectangle', { x: 45, y: 15, width: 20, height: 30, fill: '#ee4455' });
  addNode(document, rect); addNode(document, text);
  const variables = createVariableCollection(document, 'Text source');
  const textColor = createColorVariable(document, variables.id, 'Current text color', '#335577');
  const fontSize = createVariable(document, variables.id, 'Current font size', 'number', 36);
  assert.equal(bindColorVariable(document, text.id, textColor.id, 'text'), true);
  assert.equal(bindVariable(document, text.id, fontSize.id, 'fontSize'), true);
  const before = JSON.stringify(document);
  configureBooleanTextGeometry(document, { shapeText, booleanGeometry: nativeBoolean, getFontRevision: () => 'font-set-1' });
  const plan = await prepareBooleanCombine(document, [rect.id, text.id], 'union', document.activePageId, { booleanGeometry: nativeBoolean });
  assert.equal(JSON.stringify(document), before, 'font and native preparation do not mutate source layers');
  assert.ok(shaped.some(entry => entry.fontSize === 36), 'the retained font shaper receives mode-resolved text geometry');
  validateBooleanCombinePlan(document, plan);
  const group = applyBooleanCombine(document, plan);
  assert.equal(group.booleanGeometry, 'vector');
  assert.equal(group.fill, '#335577', 'text color variables provide Boolean result appearance');
  assert.equal(group.children[0], rect); assert.equal(group.children[1], text, 'the authored source objects remain editable and retain their IDs');
  assert.ok(getBooleanVectorPath(document, group).points.length > 0, 'the prepared glyph contours are available to the live Boolean');
  assert.equal(validateDocument(document), true);
  const separateCopy = structuredClone(document);
  assert.equal(separateBoolean(separateCopy, group.id).some(node => node.type === 'text' && node.id === text.id), true, 'Separate restores the original text node');
  assert.equal(validateDocument(separateCopy), true);
  const baked = applyBooleanBake(document, prepareBooleanBake(document, group.id));
  assert.equal(baked.type, 'path'); assert.ok(baked.points.length > 0, 'the same prepared text geometry supports editable Bake');
  assert.equal(validateDocument(document), true);
  disposeBooleanTextGeometryCache(document);
});

test('text Boolean preparation uses linked typography style values and rejects font or source changes before apply', async () => {
  shaped.length = 0;
  const document = createDocument();
  const text = createNode('text', { text: 'A', width: 40, height: 40, fontFamily: 'Stale', fontSize: 12, letterSpacing: 7, letterSpacingUnit: 'percent' });
  const rect = createNode('rectangle', { x: 20, width: 40, height: 40 });
  addNode(document, text); addNode(document, rect);
  const style = createTypographyStyle(document, text.id, 'Linked', document.activePageId);
  style.fontFamily = 'Linked local face'; style.fontSize = 31; style.letterSpacing = 2; delete style.letterSpacingUnit;
  text.fontFamily = 'Stale'; text.fontSize = 12;
  let revision = 1;
  configureBooleanTextGeometry(document, { shapeText, booleanGeometry: nativeBoolean, getFontRevision: () => revision });
  const plan = await prepareBooleanCombine(document, [text.id, rect.id], 'union', document.activePageId, { booleanGeometry: nativeBoolean });
  assert.ok(shaped.some(entry => entry.family === 'Linked local face' && entry.fontSize === 31), 'linked typography is resolved before native text shaping');
  assert.ok(shaped.some(entry => entry.letterSpacing === 2 && entry.letterSpacingUnit === 'pixels'), 'legacy linked tracking without a unit remains pixels even when the stale node used percent');
  revision += 1;
  assert.throws(() => validateBooleanCombinePlan(document, plan), /font|context changed/i);
  assert.equal(document.pages[0].children.length, 2, 'a stale retained font never partially combines source layers');

  revision = 2;
  const collection = createVariableCollection(document, 'Bound text font');
  const fontSize = createVariable(document, collection.id, 'Resolved size', 'number', 33);
  assert.equal(bindVariable(document, text.id, fontSize.id, 'fontSize'), true);
  const fresh = await prepareBooleanCombine(document, [text.id, rect.id], 'union', document.activePageId, { booleanGeometry: nativeBoolean });
  setVariableValue(document, fontSize.id, 44);
  assert.throws(() => validateBooleanCombinePlan(document, fresh), /selected layers|context changed/i);
  const sourceEdit = await prepareBooleanCombine(document, [text.id, rect.id], 'union', document.activePageId, { booleanGeometry: nativeBoolean });
  text.text = 'B';
  assert.throws(() => validateBooleanCombinePlan(document, sourceEdit), /text|selected layers|context changed/i);
  assert.equal(document.pages[0].children.length, 2);
  disposeBooleanTextGeometryCache(document);
});

test('combining a linked text path and its source freezes the exact nonzero-origin curve before reparenting', async () => {
  const document = createDocument();
  const source = createNode('line', { x: 72, y: 38, width: 150, height: 24, rotation: 9 });
  const text = createNode('text', { text: 'HH', width: 150, height: 40, fontFamily: 'Local', fontSize: 24 });
  const other = createNode('rectangle', { x: 180, y: 40, width: 30, height: 20 });
  addNode(document, source); addNode(document, text); addNode(document, other);
  text.textPath = { ...createTextPathGeometry(source, { startOffset: 18 }), sourceId: source.id };
  const linkedGeometry = getNodeTextPath(document, text);
  configureBooleanTextGeometry(document, { shapeText, booleanGeometry: nativeBoolean, getFontRevision: () => 'linked-font' });
  const plan = await prepareBooleanCombine(document, [source.id, text.id, other.id], 'union', document.activePageId, { booleanGeometry: nativeBoolean });
  const group = applyBooleanCombine(document, plan);
  assert.ok(group.children.includes(source) && group.children.includes(text), 'the path and editable text remain Boolean source children');
  assert.equal(text.textPath.sourceId, undefined, 'the source reference is frozen because same-group cross-child links are unsupported');
  const { sourceId: _linkedSourceId, ...linkedSnapshot } = linkedGeometry;
  assert.deepEqual(getNodeTextPath(document, text), linkedSnapshot, 'the current source curve, including its nonzero origin and rotation, is retained on the text');
  assert.ok(getBooleanVectorPath(document, group).points.length > 0);
  assert.equal(validateDocument(document), true);
  disposeBooleanTextGeometryCache(document);
});

test('ordinary group, frame, and whole-container reparent preserve selected live text-path links', () => {
  for (const operation of ['group', 'frame', 'container-reparent']) {
    const document = createDocument();
    const source = createNode('line', { x: 72, y: 38, width: 150, height: 24, rotation: 9 });
    const text = createNode('text', { text: 'HH', width: 150, height: 40, fontFamily: 'Local', fontSize: 24 });
    addNode(document, source); addNode(document, text);
    text.textPath = { ...createTextPathGeometry(source, { startOffset: 18 }), sourceId: source.id };
    let container;
    if (operation === 'group') container = groupLayers(document, [source.id, text.id]);
    else if (operation === 'frame') container = frameSelection(document, [source.id, text.id]);
    else {
      container = createNode('group', { children: [source, text] });
      document.pages[0].children = [];
      addNode(document, container);
      const frame = createNode('frame', { width: 400, height: 300 }); addNode(document, frame);
      moveNode(document, container.id, { parentId: frame.id });
    }
    const groupedSource = container.children.find(node => node.type === 'line');
    const groupedText = container.children.find(node => node.type === 'text');
    assert.equal(groupedText.textPath.sourceId, groupedSource.id, `${operation} preserves the same-parent source link`);
    const linkedBeforeEdit = getNodeTextPath(document, groupedText);
    groupedSource.width += 24;
    const linkedAfterEdit = getNodeTextPath(document, groupedText);
    assert.equal(linkedAfterEdit.sourceId, groupedSource.id);
    assert.notDeepEqual(linkedAfterEdit, linkedBeforeEdit, `${operation} leaves later path edits live`);
    assert.equal(validateDocument(document), true);
  }
});

test('text with mode-bound typography materializes the resolved font size into the text-geometry key', () => {
  const document = createDocument();
  const text = createNode('text', { text: 'A', fontSize: 12 }); addNode(document, text);
  const collection = createVariableCollection(document, 'Typography');
  const variable = createVariable(document, collection.id, 'Font size', 'number', 27);
  assert.equal(bindVariable(document, text.id, variable.id, 'fontSize'), true);
  assert.equal(resolveBooleanSourceNode(document, text).fontSize, 27);
  disposeBooleanTextGeometryCache(document);
});
