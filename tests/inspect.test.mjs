import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, addVariableMode, bindColorVariable, bindVariable, createDocument, createGradientFill, createLayerEffect, createNode, createVariable, createVariableCollection, findNode, getNodeGeometry, setVariableValue } from '../src/model.js';
import { createAutoLayout } from '../src/layout-engine.js';
import { createImageFill } from '../src/image-fills.js';
import { buildInspectOutput } from '../src/inspect.js';
import { nodeLocalToPage } from '../src/transform-geometry.js';

test('Inspect reports independent vector-network vertex corner radii', () => {
  const document = createDocument();
  const network = createNode('network', {
    name: 'Rounded graph', width: 100, height: 80,
    vertices: [{ id: 'a', x: 0, y: 0, cornerRadius: 7.5 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 0, y: 1, cornerRadius: 2 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'ca', from: 'c', to: 'a' }],
    faces: [{ id: 'abc', vertexIds: ['a', 'b', 'c'] }]
  });
  addNode(document, network);
  assert.deepEqual(buildInspectOutput(document, [findNode(document, network.id)]).layers[0].vertexCornerRadii, [
    { id: 'a', index: 0, radius: '7.5px' }, { id: 'c', index: 2, radius: '2px' }
  ]);
});

test('Inspect output reports page-space geometry, resolved styles, text metrics and exact layer JSON', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Outer frame', x: 25, y: 35, width: 300, height: 220 });
  const label = createNode('text', {
    name: 'Hero title', x: 12, y: 18, width: 180, height: 40, text: 'Hello',
    fontFamily: 'Arial, sans-serif', fontSize: 24, fontWeight: 600, lineHeight: 1.5, letterSpacing: 0.5,
    rotation: -4, color: '#112233', textCase: 'capitalize', textDecoration: 'underline'
  });
  addNode(document, frame);
  addNode(document, label, { parentId: frame.id });
  const collection = createVariableCollection(document, 'Theme');
  const color = createVariable(document, collection.id, 'Text color', 'color', '#445566');
  assert.equal(bindColorVariable(document, label.id, color.id, 'text'), true);

  const entry = findNode(document, label.id);
  const output = buildInspectOutput(document, [entry]);
  assert.deepEqual(output.layers[0].position, { x: 37, y: 53 });
  assert.equal(output.layers[0].color, '#445566');
  assert.equal(output.layers[0].typography.fontSize, 24);
  assert.equal(output.layers[0].typography.textCase, 'capitalize');
  assert.equal(output.layers[0].typography.textDecoration, 'underline');
  assert.equal(output.layers[0].typography.verticalAlign, 'top');
  assert.match(output.css, /\.hero-title-[a-z0-9_-]+ \{/);
  assert.match(output.css, /left: 37px;/);
  assert.match(output.css, /top: 53px;/);
  assert.match(output.css, /color: var\(--tis-[a-z0-9_-]+, #445566\);/);
  assert.match(output.css, /font-size: 24px;/);
  assert.match(output.css, /line-height: 36px;/);
  assert.match(output.css, /text-transform: capitalize;/);
  assert.match(output.css, /text-decoration: underline;/);
  assert.match(output.css, /transform: rotate\(-4deg\);/);
  assert.equal(JSON.parse(output.json).id, label.id);
});

test('Inspect output preserves text truncation settings in JSON and generated CSS', () => {
  const document = createDocument();
  const label = createNode('text', {
    name: 'Clamped title', text: 'A title that has a maximum line count', width: 100, height: 30,
    textTruncation: 'ending', maxLines: 2
  });
  addNode(document, label);
  const output = buildInspectOutput(document, [findNode(document, label.id)]);
  assert.equal(output.layers[0].typography.textTruncation, 'ending');
  assert.equal(output.layers[0].typography.maxLines, 2);
  assert.match(output.css, /overflow: hidden;/);
  assert.match(output.css, /-webkit-box-orient: vertical;/);
  assert.match(output.css, /-webkit-line-clamp: 2;/);
  assert.equal(JSON.parse(output.json).maxLines, 2);
});

test('Inspect page position follows nested rotated transforms and matches generated CSS', () => {
  const document = createDocument();
  const outer = createNode('frame', { name: 'Outer', x: 80, y: 30, width: 200, height: 160, rotation: 27 });
  const inner = createNode('frame', { name: 'Inner', x: 40, y: 25, width: 120, height: 90, rotation: -13 });
  const card = createNode('rectangle', { name: 'Rotated card', x: 15, y: 12, width: 50, height: 30, rotation: 8 });
  addNode(document, outer);
  addNode(document, inner, { parentId: outer.id });
  addNode(document, card, { parentId: inner.id });

  const ancestors = [outer, inner].map(node => ({ ...node, ...getNodeGeometry(document, node) }));
  const cardGeometry = getNodeGeometry(document, card);
  const center = nodeLocalToPage(card, { x: cardGeometry.width / 2, y: cardGeometry.height / 2 }, ancestors);
  const expected = { x: center.x - cardGeometry.width / 2, y: center.y - cardGeometry.height / 2 };
  const output = buildInspectOutput(document, [findNode(document, card.id)]);

  assert.ok(Math.abs(output.layers[0].position.x - expected.x) < 1e-9);
  assert.ok(Math.abs(output.layers[0].position.y - expected.y) < 1e-9);
  assert.ok(output.css.includes(`left: ${Number(expected.x.toFixed(4))}px;`));
});

test('Inspect reports resize constraints alongside resolved page-space placement', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Resizable frame', x: 30, y: 40, width: 240, height: 160 });
  const card = createNode('rectangle', {
    name: 'Pinned card', x: 16, y: 18, width: 80, height: 48,
    constraints: { horizontal: 'right', vertical: 'bottom' }
  });
  addNode(document, frame);
  addNode(document, card, { parentId: frame.id });
  const output = buildInspectOutput(document, [findNode(document, card.id)]);

  assert.deepEqual(output.layers[0].constraints, { horizontal: 'right', vertical: 'bottom' });
  assert.deepEqual(output.layers[0].position, { x: 46, y: 58 });
});

test('Inspect output provides nested HTML and CSS scaffolding for a selected layer tree', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Card', x: 16, y: 24, width: 240, height: 120 });
  const title = createNode('text', { name: 'Title', text: 'Save <changes> & keep', x: 12, y: 16, width: 180, height: 28 });
  const badge = createNode('ellipse', { name: 'Badge', x: 190, y: 12, width: 24, height: 24 });
  addNode(document, frame);
  addNode(document, title, { parentId: frame.id });
  addNode(document, badge, { parentId: frame.id });

  const frameEntry = findNode(document, frame.id);
  const titleEntry = findNode(document, title.id);
  const output = buildInspectOutput(document, [frameEntry, titleEntry]);
  assert.match(output.html, /data-layer-type="frame"/);
  assert.match(output.html, /Save &lt;changes&gt; &amp; keep/);
  assert.match(output.html, /data-layer-type="ellipse"/);
  assert.equal((output.html.match(/data-layer-type="text"/g) || []).length, 1, 'selected descendants should not be emitted twice');
  assert.match(output.css, /\.card-[a-z0-9_-]+ \{/);
  assert.match(output.css, /\.title-[a-z0-9_-]+ \{/);
  assert.match(output.css, /\.badge-[a-z0-9_-]+ \{/);
});

test('Inspect output generates a deterministic React component with the selected tree and local CSS', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Card', width: 240, height: 120, fill: '#f0f0f0' });
  const title = createNode('text', { name: 'Title', text: 'Save <changes> & keep', x: 12, y: 16, width: 180, height: 28, fontSize: 18 });
  const badge = createNode('ellipse', { name: 'Badge', x: 190, y: 12, width: 24, height: 24, fill: '#abcdef' });
  addNode(document, frame); addNode(document, title, { parentId: frame.id }); addNode(document, badge, { parentId: frame.id });

  const entries = [findNode(document, frame.id), findNode(document, title.id)];
  const output = buildInspectOutput(document, entries);
  assert.equal(output.jsx, buildInspectOutput(document, entries).jsx, 'the handoff source is deterministic');
  assert.match(output.jsx, /import React from 'react';/);
  assert.match(output.jsx, /export default function TinyImageStarHandoff\(\)/);
  assert.match(output.jsx, /<style>\{styles\}<\/style>/);
  assert.match(output.jsx, /\.card-[a-z0-9_-]+ \{/);
  assert.match(output.jsx, /className=\{"card-[a-z0-9_-]+"\} data-layer-type=\{"frame"\}/);
  assert.match(output.jsx, /className=\{"title-[a-z0-9_-]+"\} data-layer-type=\{"text"\}>\n\s+<span className=\{"title-[a-z0-9_-]+__paragraph"\}>\{"Save <changes> & keep"\}<\/span>/);
  assert.match(output.jsx, /className=\{"badge-[a-z0-9_-]+"\} data-layer-type=\{"ellipse"\}/);
  assert.equal((output.jsx.match(/data-layer-type=\{"text"\}/g) || []).length, 1, 'selected descendant layers should not be emitted twice');
  assert.match(output.jsx, /<>[\s\S]*<div className=\{"card-[^\n]+[\s\S]*<\/div>[\s\S]*<\/>/);
});

test('Inspect React JSX safely serializes hostile text, image labels, and JavaScript line separators', () => {
  const document = createDocument();
  const payload = '</span><script>alert("x")</script>{value} \\ \u2028end';
  const text = createNode('text', { name: 'Untrusted </script>', text: payload });
  const image = createNode('image', { name: 'Photo " onerror={alert(1)}', fileName: 'local " image.png' });
  addNode(document, text); addNode(document, image);
  const entries = [findNode(document, text.id), findNode(document, image.id)];
  const jsx = buildInspectOutput(document, entries).jsx;
  const encodedPayload = JSON.stringify(payload).replace(/[\u2028\u2029]/g, character => character === '\u2028' ? '\\u2028' : '\\u2029');
  assert.ok(jsx.includes(`>{${encodedPayload}}</span>`), 'text is emitted as a JavaScript string expression instead of JSX syntax');
  assert.ok(jsx.includes(`aria-label={${JSON.stringify('local " image.png')}}`), 'image labels are serialized as string expressions');
  assert.doesNotMatch(jsx, /aria-label="local " image\.png"/);
  assert.match(jsx, /const styles = "[\s\S]*";/, 'CSS is embedded as a quoted JavaScript string');
});

test('Inspect Vue SFC handoff is deterministic and preserves nested, multi-paragraph content', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Card', width: 240, height: 120, fill: '#f0f0f0' });
  const title = createNode('text', {
    name: 'Title', text: 'First {{ user }}\nSecond <strong> & keep', x: 12, y: 16, width: 180, height: 42,
    paragraphStyles: [{ listStyle: 'numbered', listLevel: 1, listStart: 3 }, { listStyle: 'bulleted', listLevel: 0 }]
  });
  const image = createNode('image', { name: 'Photo', fileName: 'local " image.png' });
  addNode(document, frame); addNode(document, title, { parentId: frame.id }); addNode(document, image, { parentId: frame.id });

  const entries = [findNode(document, frame.id), findNode(document, title.id)];
  const output = buildInspectOutput(document, entries);
  assert.equal(output.vue, buildInspectOutput(document, entries).vue, 'the SFC output is deterministic');
  assert.match(output.vue, /^<template>\n[\s\S]*<\/template>\n\n<style>\n[\s\S]*\n<\/style>\n$/);
  assert.match(output.vue, /class="card-[a-z0-9_-]+" data-layer-type="frame"/);
  assert.match(output.vue, /data-layer-type="text"/);
  assert.match(output.vue, /data-list-style="numbered" data-list-level="1" data-list-marker="c\." v-text="&quot;First \{\{ user \}\}&quot;"/);
  assert.match(output.vue, /v-text="&quot;Second &lt;strong&gt; &amp; keep&quot;"/);
  assert.match(output.vue, /<div class="photo-[a-z0-9_-]+" data-layer-type="image" role="img" aria-label="local &quot; image\.png"><!-- Replace with an app asset or bind an image source\. --><\/div>/);
  assert.match(output.vue, /\.card-[a-z0-9_-]+ \{/);
  assert.equal((output.vue.match(/data-layer-type="text"/g) || []).length, 1, 'selecting a root and its descendant should not duplicate the root tree');
});

test('Inspect Vue SFC handoff safely contains hostile text and CSS raw-text delimiters', () => {
  const document = createDocument();
  const payload = '</span><script>alert("x")</script>{{ value }} \\ \u2028end';
  const text = createNode('text', { name: 'Untrusted </template>', text: payload, fontFamily: '</style><script>alert("x")</script>' });
  const sibling = createNode('rectangle', { name: 'Second root' });
  addNode(document, text); addNode(document, sibling);
  const entries = [findNode(document, text.id), findNode(document, sibling.id)];
  const vue = buildInspectOutput(document, entries).vue;

  assert.match(vue, /<template>\n  <span class="untrusted-template-[a-z0-9_-]+"/);
  assert.equal((vue.match(/data-layer-type="rectangle"/g) || []).length, 1, 'all independently selected roots should be present');
  assert.match(vue, /v-text="&quot;\\u003c\/span&gt;|v-text="&quot;&lt;\/span&gt;/, 'untrusted text is represented as a bound string, not template markup');
  assert.match(vue, /v-text="[^"]*\\u2028end&quot;"/, 'JavaScript line separators are escaped inside the expression');
  assert.ok(vue.includes('font-family: "\\3c /style>\\3c script>'), 'unsafe style delimiters are escaped as CSS code points');
  assert.equal((vue.match(/<\/style>/g) || []).length, 1, 'user font names cannot terminate the SFC style block');
  assert.doesNotMatch(vue, /<script>alert\("x"\)<\/script>/);
});

test('Inspect HTML, JSX, CSS, and typography data preserve paragraph spacing and indentation', () => {
  const document = createDocument();
  const text = createNode('text', {
    name: 'Paragraph sample', text: 'First paragraph\nSecond paragraph\n\nLast paragraph',
    paragraphSpacing: 8, firstLineIndent: 12, fontSize: 20, lineHeight: 1.4
  });
  addNode(document, text);
  const output = buildInspectOutput(document, [findNode(document, text.id)]);

  assert.match(output.html, /<span class="paragraph-sample-[a-z0-9_-]+" data-layer-type="text"><span class="paragraph-sample-[a-z0-9_-]+__paragraph">First paragraph<\/span><span class="paragraph-sample-[a-z0-9_-]+__paragraph">Second paragraph<\/span><span class="paragraph-sample-[a-z0-9_-]+__paragraph"><\/span><span class="paragraph-sample-[a-z0-9_-]+__paragraph">Last paragraph<\/span><\/span>/);
  assert.match(output.jsx, /<span className=\{"paragraph-sample-[a-z0-9_-]+__paragraph"\}>\{"First paragraph"\}<\/span>[\s\S]*<span className=\{"paragraph-sample-[a-z0-9_-]+__paragraph"\}>\{"Second paragraph"\}<\/span>[\s\S]*<span className=\{"paragraph-sample-[a-z0-9_-]+__paragraph"\}>\{\""\}<\/span>[\s\S]*<span className=\{"paragraph-sample-[a-z0-9_-]+__paragraph"\}>\{"Last paragraph"\}<\/span>/);
  assert.match(output.css, /\.paragraph-sample-[a-z0-9_-]+__paragraph \{[\s\S]*margin: 0;[\s\S]*min-height: 28px;[\s\S]*text-indent: 12px;[\s\S]*white-space: pre-wrap;/);
  assert.match(output.css, /\.paragraph-sample-[a-z0-9_-]+ > \.paragraph-sample-[a-z0-9_-]+__paragraph \+ \.paragraph-sample-[a-z0-9_-]+__paragraph \{\n  margin-block-start: 8px;/);
  assert.equal(output.layers[0].typography.paragraphSpacing, 8);
  assert.equal(output.layers[0].typography.firstLineIndent, 12);
});

test('Inspect handoff clamps first-line indentation to leave room in narrow text boxes', () => {
  const document = createDocument();
  const text = createNode('text', {
    name: 'Narrow paragraph', text: 'A short line', width: 8, height: 30,
    firstLineIndent: 12
  });
  addNode(document, text);

  const output = buildInspectOutput(document, [findNode(document, text.id)]);

  assert.match(output.css, /text-indent: 7px;/);
  assert.doesNotMatch(output.css, /text-indent: 12px;/);
  assert.match(output.html, /<span class="narrow-paragraph-[a-z0-9_-]+__paragraph">A short line<\/span>/);
  assert.match(output.jsx, /text-indent: 7px;/);
  assert.equal(output.layers[0].typography.firstLineIndent, 12, 'layer data retains the authored indent');
});

test('Inspect output describes responsive grid layout and multiple selected layers', () => {
  const document = createDocument();
  const grid = createNode('frame', {
    name: 'Cards', x: 10, y: 20, width: 500, height: 300,
    autoLayout: { axis: 'grid', columns: 3, rowGap: 12, columnGap: 16 }
  });
  const card = createNode('rectangle', { name: 'Card / Primary', x: 0, y: 0, width: 140, height: 90, fill: '#abcdef' });
  const badge = createNode('ellipse', { name: 'Badge', x: 150, y: 0, width: 24, height: 24, fill: '#ff0000' });
  addNode(document, grid); addNode(document, card, { parentId: grid.id }); addNode(document, badge, { parentId: grid.id });

  const entries = document.pages[0].children[0].children.map(node => findNode(document, node.id));
  const output = buildInspectOutput(document, entries);
  const gridOutput = buildInspectOutput(document, [findNode(document, grid.id)]);
  assert.equal(output.layers.length, 2);
  assert.match(gridOutput.css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(gridOutput.css, /row-gap: 12px;/);
  assert.match(gridOutput.css, /column-gap: 16px;/);
  assert.match(output.css, /\.card-primary-[a-z0-9_-]+/);
  assert.match(output.css, /\.badge-[a-z0-9_-]+/);
  assert.match(output.css, /Placement is controlled by the parent auto layout/);
  assert.deepEqual(output.layers[0].layout, {
    axis: 'grid', positioning: 'flow', sizing: { width: 'fixed', height: 'fixed' }, gridCell: {}
  });
  assert.equal(/position: absolute;/.test(output.css), false, 'Auto-layout children should remain in flow instead of receiving page-space positioning.');
  assert.deepEqual(JSON.parse(output.json).map(node => node.id), [card.id, badge.id]);
});

test('Inspect preserves per-child cross-axis alignment in CSS and handoff data', () => {
  const document = createDocument();
  const frame = createNode('frame', {
    name: 'Aligned actions', width: 240, height: 100,
    autoLayout: createAutoLayout({ axis: 'horizontal', align: 'stretch' })
  });
  const alignments = ['start', 'center', 'end', 'stretch'];
  const children = alignments.map(layoutAlignSelf => createNode('rectangle', {
    name: `Action ${layoutAlignSelf}`, width: 40, height: 24, layoutAlignSelf
  }));
  addNode(document, frame);
  for (const child of children) addNode(document, child, { parentId: frame.id });

  const output = buildInspectOutput(document, children.map(child => findNode(document, child.id)));
  const layers = new Map(output.layers.map(layer => [layer.id, layer]));

  assert.match(output.css, /align-self: flex-start;/);
  assert.match(output.css, /align-self: center;/);
  assert.match(output.css, /align-self: flex-end;/);
  assert.match(output.css, /align-self: stretch;/);
  for (const [child, alignment] of children.map((node, index) => [node, alignments[index]])) {
    assert.deepEqual(layers.get(child.id).layout.sizing, { main: 'fixed', cross: 'fixed', alignSelf: alignment });
  }
});

test('Inspect output preserves authored fixed, hug, and weighted grid tracks and cell fill sizing', () => {
  const document = createDocument();
  const grid = createNode('frame', {
    name: 'Weighted Grid', width: 420, height: 260,
    autoLayout: {
      axis: 'grid', columns: 3, rows: 2, rowGap: 12, columnGap: 8,
      padding: { top: 10, right: 14, bottom: 12, left: 8 },
      columnTracks: [{ mode: 'fixed', value: 80 }, { mode: 'hug' }, { mode: 'fill', weight: 2 }],
      rowTracks: [{ mode: 'fixed', value: 50 }, { mode: 'fill', weight: 3 }]
    }
  });
  const card = createNode('rectangle', {
    name: 'Flexible Card', width: 80, height: 50, layoutSizingX: 'fill', layoutSizingY: 'fill',
    minWidth: 72, maxWidth: 320, gridCell: { row: 2, column: 3, columnSpan: 1, alignX: 'center', alignY: 'end' }
  });
  addNode(document, grid); addNode(document, card, { parentId: grid.id });

  const output = buildInspectOutput(document, [findNode(document, grid.id)]);
  const cardOutput = buildInspectOutput(document, [findNode(document, card.id)]);
  assert.deepEqual(cardOutput.layers[0].layout, {
    axis: 'grid', positioning: 'flow', sizing: { width: 'fill', height: 'fill' },
    gridCell: { row: 2, column: 3, columnSpan: 1, alignX: 'center', alignY: 'end' }
  });
  assert.match(output.css, /grid-template-columns: 80px max-content minmax\(0, 2fr\);/);
  assert.match(output.css, /grid-template-rows: 50px minmax\(0, 3fr\);/);
  assert.match(output.css, /padding: 10px 14px 12px 8px;/);
  assert.match(output.css, /grid-column: 3 \/ span 1;/);
  assert.match(output.css, /grid-row: 2 \/ span 1;/);
  assert.match(output.css, /justify-self: center;/);
  assert.match(output.css, /align-self: end;/);
  assert.match(output.css, /width: 100%;/);
  assert.match(output.css, /height: 100%;/);
  assert.match(output.css, /min-width: 72px;/);
  assert.match(output.css, /max-width: 320px;/);
});

test('Inspect output preserves fixed and content-based grid track minimum bounds', () => {
  const document = createDocument();
  const grid = createNode('frame', {
    name: 'Bounded grid', width: 600, height: 200,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 3, rows: 1, padding: 0,
      columnTracks: [
        { mode: 'fill', weight: 1, minSize: 120 },
        { mode: 'fill', weight: 2, minContent: true },
        { mode: 'fixed', value: 200, minSize: 80 }
      ] })
  });
  addNode(document, grid);

  const output = buildInspectOutput(document, [findNode(document, grid.id)]);

  assert.match(output.css, /grid-template-columns: minmax\(120px, 1fr\) minmax\(max-content, 2fr\) minmax\(80px, 200px\);/);
});

test('Inspect output discloses fractional grid minimums that CSS Grid cannot express directly', () => {
  const document = createDocument();
  const grid = createNode('frame', {
    name: 'Fraction-bounded grid', width: 300, height: 100,
    autoLayout: createAutoLayout({ axis: 'grid', columns: 2, rows: 1, padding: 0,
      columnTracks: [{ mode: 'fill', weight: 2, minWeight: 0.5 }, { mode: 'fill', weight: 1 }] })
  });
  addNode(document, grid);

  const output = buildInspectOutput(document, [findNode(document, grid.id)]);

  assert.match(output.css, /grid-template-columns: minmax/);
  assert.match(output.css, /Fractional track minimums are preserved in layer JSON and Tiny Image Star local layout/);
});

test('Inspect auto rows ignore hidden and absolute children when choosing explicit CSS tracks', () => {
  const document = createDocument();
  const grid = createNode('frame', { width: 300, height: 200, autoLayout: { axis: 'grid', columns: 2, rows: 'auto', rowTracks: [{ mode: 'hug' }] } });
  const visible = createNode('rectangle', { gridCell: { row: 1, column: 1 } });
  const hidden = createNode('rectangle', { visible: false, gridCell: { row: 8, column: 1 } });
  const absolute = createNode('rectangle', { layoutPositioning: 'absolute', gridCell: { row: 12, column: 1 } });
  addNode(document, grid);
  addNode(document, visible, { parentId: grid.id });
  addNode(document, hidden, { parentId: grid.id });
  addNode(document, absolute, { parentId: grid.id });

  const { css } = buildInspectOutput(document, [findNode(document, grid.id)]);
  assert.match(css, /grid-template-rows: max-content;/);
  assert.doesNotMatch(css, /grid-template-rows:[^;]*max-content\s+max-content/);
});

test('Inspect output safely encodes arbitrary font family names', () => {
  const document = createDocument();
  const label = createNode('text', { fontFamily: 'Font"; color: red;/*', text: 'Safe output' });
  addNode(document, label);
  const output = buildInspectOutput(document, [{ node: label, parents: [] }]);
  assert.match(output.css, /font-family: "Font\\"; color: red;\/\*";/);
});

test('Inspect output includes auto layout size limits in CSS and layer summary', () => {
  const document = createDocument();
  const frame = createNode('frame', { autoLayout: { axis: 'horizontal' } });
  const tile = createNode('rectangle', { minWidth: 72, maxWidth: 180, minHeight: 36 });
  addNode(document, frame); addNode(document, tile, { parentId: frame.id });
  const output = buildInspectOutput(document, [findNode(document, tile.id)]);
  assert.match(output.css, /min-width: 72px;/);
  assert.match(output.css, /max-width: 180px;/);
  assert.match(output.css, /min-height: 36px;/);
  assert.deepEqual(output.layers[0].sizeLimits, { minWidth: 72, maxWidth: 180, minHeight: 36 });
});

test('Inspect handoff describes vector stroke pattern, cap, join, and miter limit', () => {
  const document = createDocument();
  const line = createNode('line', { stroke: '#123456', strokeWidth: 3, strokePattern: 'dashed', strokeCap: 'round', strokeJoin: 'bevel', strokeMiterLimit: 4 });
  addNode(document, line);
  const output = buildInspectOutput(document, [findNode(document, line.id)]);
  assert.match(output.css, /border-top: 3px dashed #123456;/);
  assert.match(output.css, /Vector stroke cap\/join\/miter limit \(round\/bevel\/4\) remain exact in layer JSON/);
  assert.deepEqual(output.layers[0].stroke, { color: '#123456', width: 3, opacity: 1, visible: true, cap: 'round', join: 'bevel', miterLimit: 4, pattern: 'dashed' });
});

test('Inspect exposes ordered stroke records while CSS reports the primary stroke only', () => {
  const document = createDocument();
  const card = createNode('rectangle', { name: 'Double outline', strokes: [
    { id: 'inner', color: '#123456', width: 2, opacity: .5, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 },
    { id: 'outer', color: '#abcdef', width: 8, opacity: .75, visible: false, cap: 'round', join: 'bevel', pattern: 'dashed', miterLimit: 4 }
  ] });
  addNode(document, card);
  const output = buildInspectOutput(document, [findNode(document, card.id)]);
  assert.deepEqual(output.layers[0].strokes.map(stroke => [stroke.color, stroke.width, stroke.opacity, stroke.visible]), [
    ['#123456', 2, .5, true], ['#abcdef', 8, .75, false]
  ]);
  assert.match(output.css, /border: 2px solid rgba\(18, 52, 86, 0\.5\);/);
  assert.match(output.css, /2 ordered strokes are preserved in layer JSON/);
});

test('Inspect reports individual edge weights in structured output and generated CSS', () => {
  const document = createDocument();
  const card = createNode('rectangle', { name: 'Individual border', strokes: [
    { id: 'individual', color: '#123456', width: 4, opacity: 1, visible: true,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10,
      sideMode: 'custom', sideWidths: { top: 1.5, right: 0, bottom: 3.25, left: 2 } }
  ] });
  addNode(document, card);
  const output = buildInspectOutput(document, [findNode(document, card.id)]);
  assert.deepEqual(output.layers[0].stroke.sideWidths, { top: 1.5, right: 0, bottom: 3.25, left: 2 });
  assert.deepEqual(JSON.parse(output.json).strokes[0].sideWidths, { top: 1.5, right: 0, bottom: 3.25, left: 2 });
  assert.match(output.css, /border-width: 1\.5px 0px 3\.25px 2px;/);
});

test('Inspect preserves stroke gradient stops and identifies the CSS color approximation', () => {
  const document = createDocument();
  const gradient = createGradientFill('radial', '#ff8800');
  gradient.stops[1].color = '#2200ff';
  const shape = createNode('rectangle', { name: 'Gradient outline', strokes: [
    { id: 'gradient-outline', color: '#ff8800', width: 4, opacity: 1, visible: true,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10, gradient }
  ] });
  addNode(document, shape);
  const output = buildInspectOutput(document, [findNode(document, shape.id)]);
  assert.deepEqual(output.layers[0].stroke.gradient, gradient);
  assert.deepEqual(output.layers[0].strokes[0].gradient, gradient);
  assert.deepEqual(JSON.parse(output.json).strokes[0].gradient, gradient);
  assert.match(output.css, /Linear\/radial stroke gradient is preserved in layer JSON/);
});

test('Inspect output hands off enabled layer effects as CSS filters and structured data', () => {
  const document = createDocument();
  const shape = createNode('rectangle', { effects: [
    createLayerEffect('drop-shadow', { offsetX: 4, offsetY: 8, blur: 6, opacity: 0.3 }),
    createLayerEffect('inner-shadow', { offsetX: -1, offsetY: 2, blur: 3, opacity: 0.4, color: '#123456' }),
    createLayerEffect('layer-blur', { radius: 2, visible: false }),
    createLayerEffect('background-blur', { radius: 12 })
  ] });
  addNode(document, shape);
  const output = buildInspectOutput(document, [findNode(document, shape.id)]);
  assert.match(output.css, /filter: drop-shadow\(4px 8px 6px rgba\(0, 0, 0, 0\.3\)\);/);
  assert.match(output.css, /box-shadow: inset -1px 2px 3px rgba\(18, 52, 86, 0\.4\);/);
  assert.match(output.css, /backdrop-filter: blur\(12px\);/);
  assert.deepEqual(output.layers[0].effects, shape.effects);
});

test('Inspect warns in every generated handoff when Glass, Noise, or Texture have no CSS equivalent', () => {
  const document = createDocument();
  const shape = createNode('rectangle', { name: 'Styled card', effects: [
    createLayerEffect('glass'),
    createLayerEffect('noise', { mode: 'duo' }),
    createLayerEffect('texture'),
    createLayerEffect('noise', { visible: false })
  ] });
  addNode(document, shape);

  const output = buildInspectOutput(document, [findNode(document, shape.id)]);
  const warning = 'Visible Glass, Noise, Texture effects are preserved in layer data but not reproduced by generated CSS.';
  assert.match(output.css, new RegExp(`/\\* ${warning} \\*/`));
  assert.match(output.html, new RegExp(`<!-- ${warning} -->`));
  assert.match(output.jsx, new RegExp(`\\{/\\* ${warning} \\*/\\}`));
  assert.match(output.vue, new RegExp(`<!-- ${warning} -->`));
  assert.deepEqual(output.layers[0].effects, shape.effects, 'the full editable effect stack remains available as structured data');
});

test('Inspect omits unsupported-effect warnings when Glass, Noise, and Texture are hidden', () => {
  const document = createDocument();
  const shape = createNode('rectangle', { effects: [
    createLayerEffect('glass', { visible: false }),
    createLayerEffect('noise', { visible: false }),
    createLayerEffect('texture', { visible: false })
  ] });
  addNode(document, shape);

  const output = buildInspectOutput(document, [findNode(document, shape.id)]);
  assert.doesNotMatch(output.css, /not reproduced by generated CSS/);
  assert.doesNotMatch(output.html, /not reproduced by generated CSS/);
  assert.doesNotMatch(output.jsx, /not reproduced by generated CSS/);
  assert.doesNotMatch(output.vue, /not reproduced by generated CSS/);
});

test('Inspect output includes editable gradient fills in CSS and structured layer data', () => {
  const document = createDocument();
  const gradient = createGradientFill('linear', '#ff0000');
  gradient.stops[1].color = '#0000ff';
  gradient.angle = 45;
  const shape = createNode('rectangle', { fillGradient: gradient, fillOpacity: 0.5 });
  addNode(document, shape);
  const output = buildInspectOutput(document, [findNode(document, shape.id)]);
  assert.match(output.css, /background: linear-gradient\(135deg, rgba\(255, 0, 0, 0\.5\) 0%, rgba\(0, 0, 255, 0\.5\) 100%\);/);
  assert.deepEqual(output.layers[0].fillGradient, gradient);
});

test('Inspect exports geometry gradients against the selected layer dimensions', () => {
  const document = createDocument();
  const gradient = createGradientFill('linear', '#ff0000');
  gradient.stops[1].color = '#0000ff';
  gradient.geometry = { handles: [
    { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.4 }, { x: 0.1, y: 0.9 }
  ] };
  const shape = createNode('rectangle', { width: 200, height: 100, fillGradient: gradient });
  addNode(document, shape);

  const output = buildInspectOutput(document, [findNode(document, shape.id)]);
  assert.match(output.css, /background: linear-gradient\(105\.945396deg, rgba\(255, 0, 0, 1\) 20%, rgba\(0, 0, 255, 1\) 75%\);/);
  assert.deepEqual(output.layers[0].fillGradient, gradient);
});

test('Inspect output preserves image-fill source and edit settings in layer data', () => {
  const document = createDocument();
  const imageFill = createImageFill('local-image-a', { fit: 'contain', adjustments: { brightness: -10, contrast: 8, saturation: 4, blur: 1 } });
  const node = createNode('ellipse', { imageFill });
  addNode(document, node);
  const output = buildInspectOutput(document, [findNode(document, node.id)]);
  assert.deepEqual(output.layers[0].imageFill, imageFill);
  assert.match(output.css, /Local image fill source and adjustments are retained in layer JSON/);
  assert.doesNotMatch(output.css, /background-color:/);
});

test('Inspect output exposes blend modes in generated CSS and structured layer data', () => {
  const document = createDocument();
  const node = createNode('rectangle', { blendMode: 'soft-light' });
  addNode(document, node);
  const output = buildInspectOutput(document, [findNode(document, node.id)]);
  assert.match(output.css, /mix-blend-mode: soft-light;/);
  assert.equal(output.layers[0].blendMode, 'soft-light');
});

test('Inspect output exports custom font fallbacks, weights, and italic text style', () => {
  const document = createDocument();
  const node = createNode('text', { text: 'Readable', fontFamily: 'Atkinson Hyperlegible, sans-serif', fontWeight: 800, fontStyle: 'italic' });
  addNode(document, node);
  const output = buildInspectOutput(document, [findNode(document, node.id)]);
  assert.match(output.css, /font-family: "Atkinson Hyperlegible", sans-serif;/);
  assert.match(output.css, /font-weight: 800;/);
  assert.match(output.css, /font-style: italic;/);
  assert.deepEqual(output.layers[0].typography, {
    fontFamily: 'Atkinson Hyperlegible, sans-serif', fontSize: 24, fontWeight: 800, fontStyle: 'italic', lineHeight: 1.25, letterSpacing: 0, paragraphSpacing: 0, firstLineIndent: 0, listSpacing: 0, paragraphStyles: [], align: 'left', verticalAlign: 'top', textCase: 'none', textDecoration: 'none', textWrapStyle: 'auto'
  });
});

test('Inspect preserves per-paragraph list markers, levels, spacing, and numbering in HTML, JSX, CSS, and typography data', () => {
  const document = createDocument();
  const text = createNode('text', {
    name: 'Recipe list',
    text: 'Top\nNested one\nNested two\nBack to top\nBullet\nNested bullet\nRestart',
    textCase: 'uppercase', firstLineIndent: 5, paragraphSpacing: 10, listSpacing: 6,
    paragraphStyles: [
      { listStyle: 'numbered', listLevel: 0 },
      { listStyle: 'numbered', listLevel: 1 },
      { listStyle: 'numbered', listLevel: 1 },
      { listStyle: 'numbered', listLevel: 0 },
      { listStyle: 'bulleted', listLevel: 0 },
      { listStyle: 'bulleted', listLevel: 1 },
      { listStyle: 'numbered', listLevel: 0, listStart: 8 }
    ]
  });
  addNode(document, text);

  const output = buildInspectOutput(document, [findNode(document, text.id)]);
  const layer = output.layers[0];
  assert.equal(layer.typography.listSpacing, 6);
  assert.deepEqual(layer.typography.paragraphStyles, text.paragraphStyles);

  for (const [style, level, marker, content] of [
    ['numbered', 0, '1.', 'Top'],
    ['numbered', 1, 'a.', 'Nested one'],
    ['numbered', 1, 'b.', 'Nested two'],
    ['numbered', 0, '2.', 'Back to top'],
    ['bulleted', 0, '•', 'Bullet'],
    ['bulleted', 1, '•', 'Nested bullet'],
    ['numbered', 0, '8.', 'Restart']
  ]) {
    assert.match(output.html, new RegExp(`data-list-style="${style}" data-list-level="${level}" data-list-marker="${marker.replace('.', '\\.')}"[^>]*>${content}<`));
    assert.ok(output.jsx.includes(`data-list-style={"${style}"} data-list-level={${level}} data-list-marker={"${marker}"}>{"${content}"}</span>`));
  }
  assert.match(output.css, /content: attr\(data-list-marker\);/);
  assert.match(output.css, /text-transform: none;/, 'generated markers remain unchanged by text-case styling');
  assert.match(output.css, /data-list-level="1"/);
  assert.match(output.css, /padding-inline-start: 56px;/, 'level one content is indented by one list step');
  assert.match(output.css, /left: 24px;/, 'level one markers share the matching marker gutter');
  assert.match(output.css, /\[data-list-style\] \+ \.recipe-list-[a-z0-9_-]+__paragraph\[data-list-style\] \{\n  margin-block-start: 6px;/);
  assert.match(output.css, /\[data-list-style\] \{\n  position: relative;\n\}/);
  assert.match(output.css, /\.recipe-list-[a-z0-9_-]+__paragraph\[data-list-style\] \{\n  position: relative;/);
  assert.match(output.css, /text-transform: uppercase;/);
});

test('Inspect keeps generated text markup and CSS stable for non-list paragraphs', () => {
  const document = createDocument();
  const text = createNode('text', { name: 'Plain', text: 'First\nSecond', paragraphSpacing: 4 });
  addNode(document, text);

  const output = buildInspectOutput(document, [findNode(document, text.id)]);
  assert.match(output.html, /<span class="plain-[a-z0-9_-]+__paragraph">First<\/span><span class="plain-[a-z0-9_-]+__paragraph">Second<\/span>/);
  assert.match(output.jsx, /<span className=\{"plain-[a-z0-9_-]+__paragraph"\}>\{"First"\}<\/span>[\s\S]*<span className=\{"plain-[a-z0-9_-]+__paragraph"\}>\{"Second"\}<\/span>/);
  assert.doesNotMatch(output.html, /data-list-(?:style|level|marker)/);
  assert.doesNotMatch(output.jsx, /data-list-(?:style|level|marker)/);
  assert.doesNotMatch(output.css, /content: attr\(data-list-marker\)/);
  assert.equal(output.layers[0].typography.listSpacing, 0);
  assert.deepEqual(output.layers[0].typography.paragraphStyles, []);
});

test('Inspect exports layer and paragraph text wrap styles to HTML, JSX, Vue, CSS, and typography data', () => {
  const document = createDocument();
  const text = createNode('text', {
    name: 'Balanced heading', text: 'First line\nSecond line', textWrapStyle: 'balance',
    paragraphStyles: [{ textWrapStyle: 'pretty' }, { textWrapStyle: 'balance' }]
  });
  addNode(document, text);
  const output = buildInspectOutput(document, [findNode(document, text.id)]);
  assert.match(output.html, /data-text-wrap-style="pretty"/);
  assert.match(output.jsx, /data-text-wrap-style=\{"pretty"\}/);
  assert.match(output.vue, /data-text-wrap-style="pretty"/);
  assert.match(output.css, /text-wrap: balance;/);
  assert.match(output.css, /data-text-wrap-style="pretty"\] \{\n  text-wrap: pretty;/);
  assert.equal(output.layers[0].typography.textWrapStyle, 'balance');
});

test('Inspect preserves vertical alignment in copyable CSS and typography data', () => {
  const document = createDocument();
  const node = createNode('text', { text: 'Centered label', height: 80, verticalAlign: 'middle' });
  addNode(document, node);
  const output = buildInspectOutput(document, [findNode(document, node.id)]);
  assert.match(output.css, /display: flex;/);
  assert.match(output.css, /flex-direction: column;/);
  assert.match(output.css, /justify-content: center;/);
  assert.equal(output.layers[0].typography.verticalAlign, 'middle');
  assert.equal(JSON.parse(output.json).verticalAlign, 'middle');
});

test('Inspect emits valid CSS for expanded auto-layout spacing modes and overlap gaps', () => {
  const document = createDocument();
  const frame = createNode('frame', { name: 'Overlap row', autoLayout: createAutoLayout({ axis: 'horizontal', justify: 'space-evenly', columnGap: -12 }) });
  addNode(document, frame);
  const output = buildInspectOutput(document, [findNode(document, frame.id)]);
  assert.match(output.css, /justify-content: space-evenly;/);
  assert.match(output.css, /column-gap: 0px;/);
  assert.match(output.css, /Negative overlap spacing/);
});

test('Inspect preserves justified paragraph alignment in copyable CSS and layer data', () => {
  const document = createDocument();
  const node = createNode('text', { text: 'A paragraph with aligned lines', align: 'justify' });
  addNode(document, node);
  const output = buildInspectOutput(document, [findNode(document, node.id)]);
  assert.match(output.css, /text-align: justify;/);
  assert.equal(output.layers[0].typography.align, 'justify');
  assert.equal(JSON.parse(output.json).align, 'justify');
});

test('Inspect handoff reports mode-resolved geometry instead of stale raw layer fields', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Responsive layout');
  const compact = collection.defaultModeId;
  const wide = addVariableMode(document, collection.id, 'Wide');
  const frameX = createVariable(document, collection.id, 'Frame X', 'number', 20);
  const x = createVariable(document, collection.id, 'Card X', 'number', 10);
  const width = createVariable(document, collection.id, 'Card width', 'number', 100);
  const height = createVariable(document, collection.id, 'Card height', 'number', 50);
  const rotation = createVariable(document, collection.id, 'Card rotation', 'number', 0);
  for (const [variable, value] of [[frameX, 50], [x, 20], [width, 120], [height, 60], [rotation, 15]]) {
    assert.equal(setVariableValue(document, variable.id, value, wide.id), true);
  }
  const frame = createNode('frame', { name: 'Frame', x: 0, y: 30, variableModes: { [collection.id]: wide.id } });
  const card = createNode('rectangle', { name: 'Card', x: 0, y: 10, width: 5, height: 5 });
  addNode(document, frame); addNode(document, card, { parentId: frame.id });
  assert.equal(bindVariable(document, frame.id, frameX.id, 'x'), true);
  for (const [property, variable] of Object.entries({ x, width, height, rotation })) assert.equal(bindVariable(document, card.id, variable.id, property), true);

  const output = buildInspectOutput(document, [findNode(document, card.id)]);
  assert.deepEqual(output.layers[0].position, { x: 70, y: 40 });
  assert.deepEqual(output.layers[0].size, { width: 120, height: 60 });
  assert.equal(output.layers[0].rotation, 15);
  assert.match(output.css, /left: 70px;/);
  assert.match(output.css, /top: 40px;/);
  assert.match(output.css, /width: 120px;/);
  assert.match(output.css, /height: 60px;/);
  assert.match(output.css, /transform: rotate\(15deg\);/);
  assert.equal(compact, collection.modes[0].id);
});

test('Inspect CSS preserves color-variable names with resolved, overridable custom properties', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Brand / Theme');
  const accent = createVariable(document, collection.id, 'Primary Accent', 'color', '#445566');
  const label = createNode('text', { name: 'Label', text: 'Hello', color: '#000000' });
  const tile = createNode('rectangle', { name: 'Tile', fill: '#ffffff' });
  addNode(document, label); addNode(document, tile);
  assert.equal(bindColorVariable(document, label.id, accent.id, 'text'), true);
  assert.equal(bindColorVariable(document, tile.id, accent.id, 'fill'), true);

  const output = buildInspectOutput(document, [findNode(document, label.id), findNode(document, tile.id)]);
  const tokenNames = [...output.css.matchAll(/(--tis-[a-z0-9_-]+)/g)].map(match => match[1]);
  assert.equal(new Set(tokenNames).size, 1, 'two layers using one token share one custom property');
  const [tokenName] = tokenNames;
  assert.match(output.css, new RegExp(`${tokenName}: #445566;`));
  assert.match(output.css, new RegExp(`color: var\\(${tokenName}, #445566\\);`));
  assert.match(output.css, new RegExp(`background-color: var\\(${tokenName}, #445566\\);`));
});

test('Inspect CSS emits distinct token properties for layers in different collection modes', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Surface');
  const day = collection.defaultModeId;
  const night = addVariableMode(document, collection.id, 'Night');
  const color = createVariable(document, collection.id, 'Card', 'color', '#fafafa');
  assert.equal(setVariableValue(document, color.id, '#181818', night.id), true);
  const dayFrame = createNode('frame', { name: 'Day', variableModes: { [collection.id]: day } });
  const nightFrame = createNode('frame', { name: 'Night', variableModes: { [collection.id]: night.id } });
  const dayCard = createNode('rectangle', { name: 'Card' });
  const nightCard = createNode('rectangle', { name: 'Card' });
  addNode(document, dayFrame); addNode(document, nightFrame);
  addNode(document, dayCard, { parentId: dayFrame.id });
  addNode(document, nightCard, { parentId: nightFrame.id });
  assert.equal(bindColorVariable(document, dayCard.id, color.id, 'fill'), true);
  assert.equal(bindColorVariable(document, nightCard.id, color.id, 'fill'), true);

  const output = buildInspectOutput(document, [findNode(document, dayCard.id), findNode(document, nightCard.id)]);
  const definitions = [...output.css.matchAll(/(--tis-[a-z0-9_-]+): (#[0-9a-f]{6});/g)];
  assert.equal(definitions.length, 2);
  assert.deepEqual(new Set(definitions.map(([, , value]) => value)), new Set(['#fafafa', '#181818']));
  assert.notEqual(definitions[0][1], definitions[1][1], 'mode IDs keep root properties collision-free');
  assert.match(output.css, new RegExp(`background-color: var\\(${definitions[0][1]}, #(?:fafafa|181818)\\);`));
  assert.match(output.css, new RegExp(`background-color: var\\(${definitions[1][1]}, #(?:fafafa|181818)\\);`));
});
