import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode, applyLayoutGuideStyle, createDocument, createLayoutGuide, createLayoutGuideStyle,
  createNode, deleteLayoutGuideStyle, detachLayoutGuideStyle, parseDocument,
  renameLayoutGuideStyle, serializeDocument, updateLayoutGuideStyle, validateDocument
} from '../src/model.js';
import { packLocalPackage, unpackLocalPackage } from '../src/storage.js';

function makeGuideStyleFixture() {
  const document = createDocument();
  const source = createNode('frame', {
    name: 'Mobile frame',
    layoutGuides: [
      createLayoutGuide('columns', { id: 'source-columns', count: 4, margin: 16, gutter: 12 }),
      createLayoutGuide('grid', { id: 'source-grid', size: 8, color: '#00aa77', opacity: 0.2 })
    ]
  });
  const target = createNode('frame', {
    name: 'Desktop frame',
    layoutGuides: [createLayoutGuide('grid', { id: 'target-grid', size: 10 })]
  });
  const freshTarget = createNode('frame', { name: 'Fresh frame' });
  addNode(document, source);
  addNode(document, target);
  addNode(document, freshTarget);
  return { document, source, target, freshTarget };
}

test('layout guide styles link multiple frames, update live and preserve frame-local guide IDs', () => {
  const { document, source, target, freshTarget } = makeGuideStyleFixture();
  const style = createLayoutGuideStyle(document, source.id, 'Responsive columns');
  assert.equal(source.layoutGuideStyleId, style.id);
  assert.deepEqual(style.guides, source.layoutGuides);

  const oldTargetIds = target.layoutGuides.map(guide => guide.id);
  assert.equal(applyLayoutGuideStyle(document, target.id, style.id), true);
  assert.equal(applyLayoutGuideStyle(document, freshTarget.id, style.id), true);
  assert.equal(target.layoutGuideStyleId, style.id);
  assert.equal(target.layoutGuides.length, 2);
  assert.equal(target.layoutGuides[0].id, oldTargetIds[0], 'updates keep a target frame’s guide identities stable');
  assert.notEqual(freshTarget.layoutGuides[0].id, source.layoutGuides[0].id, 'each frame owns separate guide identities');

  source.layoutGuides[0].count = 8;
  source.layoutGuides[0].gutter = 20;
  source.layoutGuides[1].color = '#2244cc';
  assert.equal(updateLayoutGuideStyle(document, style.id, source.id), true);
  for (const frame of [source, target, freshTarget]) {
    assert.equal(frame.layoutGuides[0].count, 8);
    assert.equal(frame.layoutGuides[0].gutter, 20);
    assert.equal(frame.layoutGuides[1].color, '#2244cc');
  }
  assert.equal(target.layoutGuides[0].id, oldTargetIds[0]);
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);
});

test('detaching a frame isolates its guides; deleting a style retains all applied values', () => {
  const { document, source, target, freshTarget } = makeGuideStyleFixture();
  const style = createLayoutGuideStyle(document, source.id, 'Baseline');
  applyLayoutGuideStyle(document, target.id, style.id);
  applyLayoutGuideStyle(document, freshTarget.id, style.id);

  assert.equal(detachLayoutGuideStyle(document, target.id), true);
  target.layoutGuides[0].size = 24;
  source.layoutGuides[0].size = 18;
  assert.equal(updateLayoutGuideStyle(document, style.id, source.id), true);
  assert.equal(target.layoutGuides[0].size, 24);
  assert.equal(freshTarget.layoutGuides[0].size, 18);
  assert.equal(target.layoutGuideStyleId, undefined);

  const retained = structuredClone([source.layoutGuides, target.layoutGuides, freshTarget.layoutGuides]);
  assert.equal(deleteLayoutGuideStyle(document, style.id), true);
  assert.equal(document.layoutGuideStyles.length, 0);
  assert.deepEqual([source.layoutGuides, target.layoutGuides, freshTarget.layoutGuides], retained);
  assert.equal(source.layoutGuideStyleId, undefined);
  assert.equal(freshTarget.layoutGuideStyleId, undefined);
  assert.equal(deleteLayoutGuideStyle(document, style.id), false);
});

test('layout guide styles can be renamed and survive local and portable document saves', () => {
  const { document, source, target } = makeGuideStyleFixture();
  const style = createLayoutGuideStyle(document, source.id, 'Old name');
  applyLayoutGuideStyle(document, target.id, style.id);
  assert.equal(renameLayoutGuideStyle(document, style.id, '  Design system / Phone  '), true);
  assert.equal(style.name, 'Design system / Phone');
  assert.equal(renameLayoutGuideStyle(document, 'missing', 'No style'), false);

  const loaded = parseDocument(serializeDocument(document));
  assert.deepEqual(loaded.layoutGuideStyles, document.layoutGuideStyles);
  assert.equal(loaded.pages[0].children[0].layoutGuideStyleId, style.id);
  const packaged = unpackLocalPackage(packLocalPackage(loaded, []));
  assert.deepEqual(packaged.document.layoutGuideStyles, document.layoutGuideStyles);
  assert.equal(packaged.document.pages[0].children[1].layoutGuideStyleId, style.id);
  assert.equal(validateDocument(packaged.document), true);
});

test('layout guide style validation rejects invalid catalogs and missing frame references', () => {
  const { document, source } = makeGuideStyleFixture();
  const style = createLayoutGuideStyle(document, source.id, 'Valid');
  assert.equal(validateDocument(parseDocument(serializeDocument(document))), true);

  document.layoutGuideStyles = [{ ...style, guides: [] }];
  assert.throws(() => validateDocument(document), /Invalid or duplicate layout guide style/);
  document.layoutGuideStyles = [style, { ...style, id: style.id, name: 'Duplicate' }];
  assert.throws(() => validateDocument(document), /Invalid or duplicate layout guide style/);
  document.layoutGuideStyles = [style];
  source.layoutGuideStyleId = 'missing-style';
  assert.throws(() => validateDocument(document), /Missing layout guide style/);
  source.layoutGuideStyleId = style.id;
  source.layoutGuides[0].count = 0;
  assert.throws(() => validateDocument(document), /Invalid layout guides/);
});
