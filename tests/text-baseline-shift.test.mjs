import test from 'node:test';
import assert from 'node:assert/strict';
import { createComponent, createComponentInstance, createDocument, createNode, findNode, parseDocument, serializeDocument, syncComponentInstances, validateDocument } from '../src/model.js';
import { drawTextRuns } from '../src/renderer.js';
import { layoutTextRuns } from '../src/text-layout.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { importSvgToLayers, SvgImportError } from '../src/svg-import.js';
import { MAX_TEXT_RUN_BASELINE_SHIFT, normalizeTextRunBaselineShift, transformTextRunsInRange } from '../src/text-run-editing.js';

const baseStyle = {
  fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 400, fontStyle: 'normal',
  lineHeight: 1.25, letterSpacing: 0, color: '#000000', textDecoration: 'none'
};
const measure = (value, style) => [...String(value)].length * style.fontSize * .5;

test('baseline-shift normalization uses zero as the implicit default and enforces finite bounds', () => {
  assert.equal(normalizeTextRunBaselineShift(0), null);
  assert.equal(normalizeTextRunBaselineShift('2.5'), 2.5);
  assert.equal(normalizeTextRunBaselineShift(-MAX_TEXT_RUN_BASELINE_SHIFT), -MAX_TEXT_RUN_BASELINE_SHIFT);
  assert.equal(normalizeTextRunBaselineShift(MAX_TEXT_RUN_BASELINE_SHIFT + 1), null);
  assert.equal(normalizeTextRunBaselineShift(Infinity), null);
  assert.equal(normalizeTextRunBaselineShift('super'), null);
});

test('a selected inline range receives a baseline shift without changing adjacent run styles', () => {
  const runs = [{ text: 'hello', fontWeight: 700, baselineShift: 2 }, { text: ' world', fontStyle: 'italic' }];
  assert.deepEqual(transformTextRunsInRange(runs, 1, 4, 'baselineShift', 6), [
    { text: 'h', fontWeight: 700, baselineShift: 2 },
    { text: 'ell', fontWeight: 700, baselineShift: 6 },
    { text: 'o', fontWeight: 700, baselineShift: 2 },
    { text: ' world', fontStyle: 'italic' }
  ]);
  assert.deepEqual(transformTextRunsInRange([{ text: 'abc', baselineShift: 6 }], 0, 3, 'baselineShift', 0), [
    { text: 'abc', baselineShift: 0 }
  ], 'resetting a selected run to zero is preserved as the new implicit default at commit time');
});

test('baseline shift changes glyph and decoration paint position but not wrapping or paragraph geometry', () => {
  const plain = [{ text: 'ab cd\nef', textDecoration: 'underline' }];
  const shifted = [{ text: 'ab ', textDecoration: 'underline', baselineShift: 7 }, { text: 'cd\nef', textDecoration: 'underline' }];
  const plainLayout = layoutTextRuns(plain, 32, baseStyle, measure);
  const shiftedLayout = layoutTextRuns(shifted, 32, baseStyle, measure);
  assert.deepEqual(shiftedLayout.lines.map(line => ({
    y: line.y, height: line.lineHeight, width: line.width, naturalWidth: line.naturalWidth, text: line.displayText
  })), plainLayout.lines.map(line => ({
    y: line.y, height: line.lineHeight, width: line.width, naturalWidth: line.naturalWidth, text: line.displayText
  })));
  assert.equal(shiftedLayout.height, plainLayout.height);
  assert.equal(shiftedLayout.lines[0].parts[0].style.baselineShift, 7);

  const fills = []; const strokes = [];
  const context = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    save() {}, restore() {}, translate() {}, scale() {},
    measureText(value) { return { width: String(value).length * 10 }; },
    fillText(text, x, y) { fills.push({ text, x, y }); },
    beginPath() {}, moveTo(x, y) { strokes.push({ x, y }); }, lineTo() {}, stroke() {}
  };
  drawTextRuns(context, [{ text: 'A', baselineShift: 6, textDecoration: 'underline' }, { text: 'B', textDecoration: 'underline' }], 0, 0, 100, baseStyle);
  assert.equal(fills[0].y, -6, 'positive shift raises the first run');
  assert.ok(Math.abs(fills[1].y) < 1e-9, 'the following run keeps its original baseline');
  assert.ok(strokes[0].y < strokes[1].y, 'decoration follows the glyph baseline shift');
});

test('baseline shift is bounded, serialized locally, and retained by component text overrides', () => {
  const document = createDocument();
  const master = createNode('frame', { children: [createNode('text', {
    text: 'abc', textRuns: [{ text: 'a', baselineShift: 0 }, { text: 'bc', baselineShift: 12.5 }]
  })] });
  const textSourceId = master.children[0].id;
  document.pages[0].children.push(master);
  const component = createComponent(document, master.id);
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  const instanceTextId = instanceNode.children[0].componentSourceId;
  instanceNode.componentOverrides[instanceTextId] = {
    text: 'xyz', textRuns: [{ text: 'x', baselineShift: -4 }, { text: 'yz', baselineShift: 8 }]
  };
  syncComponentInstances(document, component.id);
  assert.equal(validateDocument(document), true);
  const restored = parseDocument(serializeDocument(document));
  assert.deepEqual(findNode(restored, textSourceId).node.textRuns, master.children[0].textRuns);
  assert.deepEqual(findNode(restored, instance.id).node.componentOverrides[instanceTextId].textRuns, [
    { text: 'x', baselineShift: -4 }, { text: 'yz', baselineShift: 8 }
  ]);

  for (const invalid of [MAX_TEXT_RUN_BASELINE_SHIFT + .1, -MAX_TEXT_RUN_BASELINE_SHIFT - .1, Infinity, '4']) {
    const candidate = structuredClone(restored);
    findNode(candidate, textSourceId).node.textRuns[1].baselineShift = invalid;
    assert.throws(() => validateDocument(candidate), /Invalid rich text runs/);
  }
});

test('editable SVG exports baseline shifts, imports supported lengths, and rejects unsupported values', () => {
  const node = createNode('text', {
    name: 'Raised title', width: 180, height: 48, text: 'AB', fontSize: 20,
    textRuns: [{ text: 'A', baselineShift: 6, textDecoration: 'underline' }, { text: 'B', baselineShift: -2 }]
  });
  const svg = exportNodeToSvg(node, { measureText: (value, style) => measure(value, style) });
  assert.match(svg, /baseline-shift="6px"/);
  assert.match(svg, /baseline-shift="-2px"/);
  const allNodes = nodes => nodes.flatMap(layer => [layer, ...allNodes(layer.children || [])]);
  const imported = allNodes(importSvgToLayers(svg).nodes).find(layer => layer.type === 'text');
  assert.deepEqual(imported.textRuns.map(run => [run.text, run.baselineShift]), [['A', 6], ['B', -2]]);
  const document = createDocument();
  document.pages[0].children = [imported];
  const locallyRestored = parseDocument(serializeDocument(document));
  const restoredText = findNode(locallyRestored, imported.id).node;
  const exportedAgain = exportNodeToSvg(restoredText, { measureText: (value, style) => measure(value, style) });
  const reimported = allNodes(importSvgToLayers(exportedAgain).nodes).find(layer => layer.type === 'text');
  assert.deepEqual(reimported.textRuns.map(run => [run.text, run.baselineShift]), [['A', 6], ['B', -2]],
    'baseline shifts survive SVG export, local persistence, and import of the editor-wrapped SVG');

  for (const value of ['super', '10%', 'calc(2px + 1px)']) {
    assert.throws(() => importSvgToLayers(`<svg><text dominant-baseline="text-before-edge" baseline-shift="${value}">A</text></svg>`), error => {
      assert.ok(error instanceof SvgImportError);
      assert.equal(error.code, 'unsupported-text-baseline-shift');
      return true;
    });
  }
});
