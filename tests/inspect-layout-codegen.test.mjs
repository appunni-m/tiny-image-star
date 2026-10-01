import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, createDocument, createNode, findNode } from '../src/model.js';
import { buildInspectOutput } from '../src/inspect.js';

function classNameFor(css, name) {
  const match = css.match(new RegExp(`\\.(${name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}-[a-z0-9_-]+) \\{`));
  assert(match, `missing generated CSS rule for ${name}`);
  return match[1];
}

function declarationsFor(css, className) {
  const match = css.match(new RegExp(`\\.${className} \\{([^}]*)\\}`));
  assert(match, `missing CSS declarations for .${className}`);
  return match[1];
}

test('nested Inspect code uses parent-local coordinates while its root stays page-positioned', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Canvas Root', x: 16, y: 24, width: 240, height: 140 });
  const child = createNode('rectangle', { name: 'Card Child', x: 12, y: 16, width: 80, height: 40 });
  addNode(document, frame);
  addNode(document, child, { parentId: frame.id });

  const output = buildInspectOutput(document, [findNode(document, frame.id)]);
  const frameCss = declarationsFor(output.css, classNameFor(output.css, 'canvas-root'));
  const childCss = declarationsFor(output.css, classNameFor(output.css, 'card-child'));

  assert.match(frameCss, /left: 16px;/);
  assert.match(frameCss, /top: 24px;/);
  assert.match(childCss, /left: 12px;/);
  assert.match(childCss, /top: 16px;/);
  assert.doesNotMatch(childCss, /left: 28px;|top: 40px;/, 'the page offset must not be applied a second time inside the frame');
  assert.match(output.jsx, /<div className=\{"canvas-root-[^\"]+"\}[\s\S]*<div className=\{"card-child-/);
});

test('a selected child of a rotated ancestor is positioned and rotated in page space', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Turned Frame', x: 100, y: 80, width: 200, height: 100, rotation: 90 });
  const child = createNode('rectangle', { name: 'Extracted Child', x: 10, y: 20, width: 30, height: 18, rotation: 5 });
  addNode(document, frame);
  addNode(document, child, { parentId: frame.id });

  const output = buildInspectOutput(document, [findNode(document, child.id)]);
  const childCss = declarationsFor(output.css, classNameFor(output.css, 'extracted-child'));

  // The inspector and generated CSS use the same transformed standalone root.
  assert.ok(Math.abs(output.layers[0].position.x - 206) < 1e-9);
  assert.ok(Math.abs(output.layers[0].position.y - 46) < 1e-9);
  assert.equal(output.layers[0].rotation, 95);
  // The standalone snippet folds the omitted ancestor transform into the root.
  // Its untransformed box is centered on the transformed page-space center
  // (221, 55), then CSS applies the summed 95-degree rotation around that
  // center. Merely transforming the unrotated top-left gives the wrong box.
  assert.match(childCss, /left: 206px;/);
  assert.match(childCss, /top: 46px;/);
  assert.match(childCss, /transform: rotate\(95deg\);/);
  assert.deepEqual({ x: 206 + 30 / 2, y: 46 + 18 / 2 }, { x: 221, y: 55 });
});

test('auto-layout children stay in flow when their parent is included or supplies the layout context', () => {
  const document = createDocument();
  const frame = createNode('frame', {
    name: 'Auto Parent', x: 20, y: 30, width: 240, height: 100,
    autoLayout: { axis: 'horizontal', rowGap: 8, columnGap: 12 }
  });
  const first = createNode('rectangle', { name: 'First Item', x: 10, y: 14, width: 60, height: 30 });
  const second = createNode('rectangle', { name: 'Second Item', x: 72, y: 14, width: 60, height: 30 });
  addNode(document, frame);
  addNode(document, first, { parentId: frame.id });
  addNode(document, second, { parentId: frame.id });

  const nested = buildInspectOutput(document, [findNode(document, frame.id)]);
  const nestedItemCss = declarationsFor(nested.css, classNameFor(nested.css, 'first-item'));
  assert.match(nestedItemCss, /Placement is controlled by the parent auto layout/);
  assert.match(nestedItemCss, /position: relative;/);
  assert.doesNotMatch(nestedItemCss, /left:|top:/);

  const selectedSiblings = buildInspectOutput(document, [findNode(document, first.id), findNode(document, second.id)]);
  assert.match(selectedSiblings.css, /Placement is controlled by the parent auto layout/);
  assert.equal(/position: absolute;/.test(selectedSiblings.css), false);
});
