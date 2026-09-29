import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createLayoutGuide, createNode, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { layoutGuideGridLines, layoutGuideRegions } from '../src/layout-guides.js';

test('layout guides keep multiple grid, stretch, and fixed guides in a local file', () => {
  const document = createDocument();
  const frame = createNode('frame', { layoutGuides: [
    createLayoutGuide('grid', { id: 'grid-8', size: 8 }),
    createLayoutGuide('columns', { id: 'columns-12', count: 12, margin: 24, gutter: 16 }),
    createLayoutGuide('rows', { id: 'bottom-rows', count: 2, alignment: 'bottom', bandSize: 44, offset: 12, visible: false })
  ] });
  addNode(document, frame);
  const loaded = parseDocument(serializeDocument(document));
  assert.deepEqual(loaded.pages[0].children[0].layoutGuides, frame.layoutGuides);
});

test('stretch columns use even tracks with margins and gutters', () => {
  const columns = layoutGuideRegions(createLayoutGuide('columns', { count: 4, margin: 16, gutter: 20 }), 400, 200);
  assert.deepEqual(columns, [16, 113, 210, 307].map(x => ({ x, y: 0, width: 77, height: 200 })));
});

test('fixed guides honor alignment and offsets from the chosen frame edge', () => {
  const right = layoutGuideRegions(createLayoutGuide('columns', { alignment: 'right', count: 3, bandSize: 80, offset: 16 }), 400, 240);
  assert.deepEqual(right.map(region => region.x), [144, 224, 304]);
  const centered = layoutGuideRegions(createLayoutGuide('rows', { alignment: 'center', count: 3, bandSize: 50 }), 400, 500);
  assert.deepEqual(centered.map(region => region.y), [175, 225, 275]);
  const bottom = layoutGuideRegions(createLayoutGuide('rows', { alignment: 'bottom', count: 2, bandSize: 30, offset: 10 }), 400, 200);
  assert.deepEqual(bottom.map(region => region.y), [130, 160]);
});

test('uniform grid guide lines stay bounded for large frames', () => {
  const lines = layoutGuideGridLines(createLayoutGuide('grid', { size: 8 }), 24, 16);
  assert.deepEqual(lines, { verticals: [8, 16], horizontals: [8] });
  const bounded = layoutGuideGridLines(createLayoutGuide('grid', { size: 1 }), 100_000, 100_000);
  assert(bounded.verticals.length > 0 && bounded.verticals.length <= 1000);
  assert(bounded.horizontals.length > 0 && bounded.horizontals.length <= 1000);
});

test('layout-guide validation rejects invalid owners, duplicates, types, and geometry', () => {
  const makeDoc = guides => {
    const document = createDocument(); addNode(document, createNode('frame', { layoutGuides: structuredClone(guides) })); return document;
  };
  const invalid = [
    [createLayoutGuide('grid', { size: 0 })],
    [createLayoutGuide('columns', { alignment: 'bottom' })],
    [createLayoutGuide('rows', { count: 0 })],
    [createLayoutGuide('grid', { id: 'same' }), createLayoutGuide('rows', { id: 'same' })],
    Array.from({ length: 33 }, (_, index) => createLayoutGuide('grid', { id: `guide-${index}` }))
  ];
  for (const guides of invalid) assert.throws(() => validateDocument(makeDoc(guides)), /Invalid layout guides/);
  const nonFrame = createDocument(); addNode(nonFrame, createNode('rectangle', { layoutGuides: [createLayoutGuide()] }));
  assert.throws(() => validateDocument(nonFrame), /Invalid layout guides/);
});
