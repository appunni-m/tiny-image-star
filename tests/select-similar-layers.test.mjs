import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLayersWithSameFont, selectLayersWithSamePaint } from '../src/select-similar-layers.js';
import { addNode, bindVariable, createDocument, createNode, createVariable, createVariableCollection } from '../src/model.js';

const solid = (id, color, overrides = {}) => ({ id, type: 'solid', color, visible: true, opacity: 1, ...overrides });
const rectangle = (id, fills, overrides = {}) => ({ id, type: 'rectangle', fills, children: [], ...overrides });

test('same-fill selection matches visible paint appearance while ignoring paint and gradient-stop IDs', () => {
  const first = rectangle('first', [solid('fill-a', '#1769aa')]);
  const second = rectangle('second', [solid('fill-b', '#1769aa')]);
  const gradientA = rectangle('gradient-a', [{
    id: 'gradient-fill-a', type: 'linear', visible: true, opacity: 0.8,
    gradient: { type: 'linear', angle: 45, stops: [
      { id: 'stop-a', color: '#000000', position: 0 },
      { id: 'stop-b', color: '#ffffff', position: 1 }
    ] }
  }]);
  const gradientB = rectangle('gradient-b', [{
    id: 'gradient-fill-b', type: 'linear', visible: true, opacity: 0.8,
    gradient: { type: 'linear', angle: 45, stops: [
      { id: 'other-stop-a', color: '#000000', position: 0 },
      { id: 'other-stop-b', color: '#ffffff', position: 1 }
    ] }
  }]);

  assert.deepEqual(selectLayersWithSamePaint([first, second, gradientA, gradientB], first, 'fill'), ['first', 'second']);
  assert.deepEqual(selectLayersWithSamePaint([first, second, gradientA, gradientB], gradientA, 'fill'), ['gradient-a', 'gradient-b']);
});

test('same-fill selection distinguishes paint values, compositing, stack order, and fill visibility', () => {
  const reference = rectangle('reference', [solid('a', '#ff0000'), solid('b', '#0000ff', { opacity: 0.4 })]);
  const color = rectangle('color', [solid('a', '#00ff00'), solid('b', '#0000ff', { opacity: 0.4 })]);
  const opacity = rectangle('opacity', [solid('a', '#ff0000'), solid('b', '#0000ff', { opacity: 0.5 })]);
  const reversed = rectangle('reversed', [solid('b', '#0000ff', { opacity: 0.4 }), solid('a', '#ff0000')]);
  const hiddenOnly = rectangle('hidden-only', [solid('hidden', '#ff0000', { visible: false })]);

  assert.deepEqual(selectLayersWithSamePaint([reference, color, opacity, reversed, hiddenOnly], reference, 'fill'), ['reference']);
  assert.deepEqual(selectLayersWithSamePaint([hiddenOnly], hiddenOnly, 'fill'), []);
});

test('same-stroke selection compares stroke appearance without merging different line weights or patterns', () => {
  const reference = { id: 'reference', type: 'rectangle', strokes: [{ id: 'stroke-a', color: '#222222', width: 2, opacity: 1, visible: true, pattern: 'solid' }] };
  const same = { id: 'same', type: 'path', strokes: [{ id: 'stroke-b', color: '#222222', width: 2, opacity: 1, visible: true, pattern: 'solid' }] };
  const thick = { id: 'thick', type: 'ellipse', strokes: [{ id: 'stroke-c', color: '#222222', width: 3, opacity: 1, visible: true, pattern: 'solid' }] };
  const dashed = { id: 'dashed', type: 'rectangle', strokes: [{ id: 'stroke-d', color: '#222222', width: 2, opacity: 1, visible: true, pattern: 'dashed' }] };

  assert.deepEqual(selectLayersWithSamePaint([reference, same, thick, dashed], reference, 'stroke'), ['reference', 'same']);
});

test('same-paint selection skips hidden and locked ancestors and never reaches outside its page tree', () => {
  const reference = rectangle('reference', [solid('a', '#123456')]);
  const hiddenChild = rectangle('hidden-child', [solid('b', '#123456')]);
  const lockedChild = rectangle('locked-child', [solid('c', '#123456')]);
  const visibleChild = rectangle('visible-child', [solid('d', '#123456')]);
  const roots = [
    reference,
    { id: 'hidden-parent', type: 'group', visible: false, children: [hiddenChild] },
    { id: 'locked-parent', type: 'group', locked: true, children: [lockedChild] },
    { id: 'visible-parent', type: 'group', children: [visibleChild] }
  ];

  assert.deepEqual(selectLayersWithSamePaint(roots, reference, 'fill'), ['reference', 'visible-child']);
  assert.deepEqual(selectLayersWithSamePaint([visibleChild], reference, 'fill'), []);
  assert.throws(() => selectLayersWithSamePaint(roots, reference, 'effect'), /Paint kind must be fill or stroke/);
});

test('same-font selection compares effective family only and honors rich-text run overrides', () => {
  const document = createDocument();
  const reference = createNode('text', {
    name: 'Reference', text: 'Title', fontFamily: 'Inter, Arial, sans-serif',
    fontWeight: 700, fontAxes: { wght: 700 }, typographyStyleId: 'style-one'
  });
  const differentAppearance = createNode('text', {
    name: 'Same family', text: 'Body', fontFamily: '"INTER", system-ui',
    fontWeight: 300, fontStyle: 'italic', fontAxes: { wght: 300 }, typographyStyleId: 'style-two'
  });
  const richText = createNode('text', {
    name: 'Run family', text: 'Rich title', fontFamily: 'Body Sans',
    textRuns: [{ text: 'Rich ', fontFamily: 'Inter' }, { text: 'title', fontFamily: 'Inter, sans-serif', fontWeight: 800 }]
  });
  const differentFamily = createNode('text', { name: 'Different family', text: 'Other', fontFamily: 'Arial, sans-serif' });
  addNode(document, reference);
  addNode(document, differentAppearance);
  addNode(document, richText);
  addNode(document, differentFamily);

  assert.deepEqual(
    selectLayersWithSameFont(document.pages[0].children, document, reference),
    [reference.id, differentAppearance.id, richText.id],
    'family names compare case-insensitively by primary family while unrelated typography metadata is ignored'
  );
});

test('same-font selection resolves variable-bound families and rejects stale runs', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Typography');
  const family = createVariable(document, collection.id, 'Heading family', 'string', 'Editorial Sans');
  const reference = createNode('text', {
    text: 'Selected', fontFamily: 'Fallback Sans', variableBindings: { fontFamily: family.id }
  });
  const sameByRun = createNode('text', {
    text: 'Matching', fontFamily: 'Fallback Sans',
    textRuns: [{ text: 'Matching', fontFamily: 'Editorial Sans' }]
  });
  const staleRunsUseBase = createNode('text', {
    text: 'Changed text', fontFamily: 'Editorial Sans, Arial',
    textRuns: [{ text: 'Old text', fontFamily: 'Other Sans' }]
  });
  const wrongRunFamily = createNode('text', {
    text: 'Not matching', fontFamily: 'Editorial Sans',
    textRuns: [{ text: 'Not matching', fontFamily: 'Other Sans' }]
  });
  addNode(document, reference);
  addNode(document, sameByRun);
  addNode(document, staleRunsUseBase);
  addNode(document, wrongRunFamily);
  assert.equal(bindVariable(document, reference.id, family.id, 'fontFamily'), true);

  assert.deepEqual(
    selectLayersWithSameFont(document.pages[0].children, document, reference),
    [reference.id, sameByRun.id, staleRunsUseBase.id],
    'node bindings resolve in the active variable mode and stale rich-text runs follow renderer fallback behavior'
  );
});

test('same-font selection skips hidden or locked descendants and is scoped to the supplied page tree', () => {
  const document = createDocument();
  const reference = createNode('text', { text: 'Source', fontFamily: 'Inter' });
  const visible = createNode('text', { text: 'Visible', fontFamily: 'Inter' });
  const ownHidden = createNode('text', { text: 'Hidden', fontFamily: 'Inter', visible: false });
  const ownLocked = createNode('text', { text: 'Locked', fontFamily: 'Inter', locked: true });
  const hiddenAncestor = createNode('frame', {
    visible: false, children: [createNode('text', { text: 'Hidden child', fontFamily: 'Inter' })]
  });
  const lockedAncestor = createNode('frame', {
    locked: true, children: [createNode('text', { text: 'Locked child', fontFamily: 'Inter' })]
  });
  addNode(document, reference);
  addNode(document, visible);
  addNode(document, ownHidden);
  addNode(document, ownLocked);
  addNode(document, hiddenAncestor);
  addNode(document, lockedAncestor);
  const otherPageText = createNode('text', { text: 'Other page', fontFamily: 'Inter' });
  document.pages.push({ id: 'other-page', name: 'Other', children: [otherPageText], guides: [] });

  assert.deepEqual(selectLayersWithSameFont(document.pages[0].children, document, reference), [reference.id, visible.id]);
  assert.deepEqual(selectLayersWithSameFont([visible], document, reference), []);
  assert.deepEqual(selectLayersWithSameFont(document.pages[1].children, document, reference), []);
});
