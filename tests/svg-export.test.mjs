import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, bindVariable, createDocument, createNode, createVariable, createVariableCollection } from '../src/model.js';
import { exportNodeToSvg, exportPageToSvg, SvgExportError } from '../src/svg-export.js';

test('exports editable nested geometry, text styling, rotation, opacity, and clipping deterministically', () => {
  const title = createNode('text', {
    name: 'Greeting & title', x: 16, y: 20, width: 180, height: 54, rotation: -4,
    text: 'Hello <world>\nSVG', fontFamily: 'Inter, Arial, sans-serif', fontSize: 22,
    fontWeight: 700, fontStyle: 'italic', lineHeight: 1.2, letterSpacing: 0.5,
    align: 'center', color: '#123456', textCase: 'uppercase', textDecoration: 'underline', opacity: 0.8
  });
  const rect = createNode('rectangle', { name: 'Card', x: 10, y: 12, width: 120, height: 72, radius: 8, fill: '#abcdef', fillOpacity: 0.7, stroke: '#102030', strokeWidth: 3 });
  const frame = createNode('frame', { name: 'Clipped frame', x: 25, y: 40, width: 240, height: 160, fill: '#ffffff', clip: true, children: [rect, title] });
  const page = { id: 'page-one', children: [frame] };
  const measureText = (value, node) => [...value].length * Number(node.fontSize) * .6;
  const first = exportPageToSvg(page, { measureText });

  assert.equal(first, exportPageToSvg(page, { measureText }));
  assert.match(first, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(first, /clipPath id="tis-clip-0"/);
  assert.match(first, /data-tiny-image-star-type="frame"/);
  assert.match(first, /data-tiny-image-star-node-id="/);
  assert.match(first, /fill="#abcdef" fill-opacity="0.7" stroke="#102030" stroke-width="3"/);
  assert.match(first, /font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" font-style="italic" letter-spacing="0.5" text-transform="uppercase"/);
  assert.match(first, /stroke="#123456" stroke-opacity="1" stroke-width="1.375"/);
  assert.match(first, /HELLO &lt;WORLD&gt;/);
  assert.match(first, /data-tiny-image-star-text-wrap="canvas-word-wrap"/);
  assert.match(first, /matrix\(/);
  assert.match(first, /opacity="0.8"/);
});

test('exports a selected node in its own rotated local bounds and supports vector basics', () => {
  const ellipse = createNode('ellipse', { name: 'Dot', x: 900, y: -500, width: 40, height: 20, rotation: 90, fill: '#ff0088' });
  const svg = exportNodeToSvg(ellipse);
  assert.match(svg, /viewBox="10 -10 20 40"/);
  assert.match(svg, /<ellipse cx="20" cy="10" rx="20" ry="10" fill="#ff0088"/);

  const line = createNode('line', { width: 31, height: 12, stroke: '#224466', strokeWidth: 4 });
  assert.match(exportNodeToSvg(line), /<path d="M 0 0 L 31 12" fill="none" stroke="#224466" stroke-width="4"\/>/);

  const vector = createNode('path', { width: 100, height: 80, closed: true, fill: '#ccddaa', points: [
    { x: 0, y: 0, out: { x: 0.25, y: 0 } },
    { x: 1, y: 1, in: { x: -0.25, y: 0 } }
  ] });
  assert.match(exportNodeToSvg(vector), /<path d="M 0 0 C 25 0 75 80 100 80 L 0 0 Z" fill="#ccddaa"/);
});

test('rejects unsupported content explicitly instead of dropping design features', () => {
  const unsupported = [
    [createNode('image'), 'image layers'],
    [createNode('group', { mask: true, maskSourceId: 'mask' }), 'mask groups'],
    [createNode('rectangle', { effects: [{ id: 'effect-1', type: 'layer-blur', visible: true, radius: 4 }] }), 'visible layer effects'],
    [createNode('rectangle', { fillGradient: { type: 'linear', angle: 0, stops: [] } }), 'gradient fills'],
    [createNode('rectangle', { blendMode: 'multiply' }), 'blend mode "multiply"'],
    [createNode('boolean'), 'boolean layers']
  ];
  for (const [node, feature] of unsupported) {
    assert.throws(() => exportNodeToSvg(node), error => {
      assert.ok(error instanceof SvgExportError);
      assert.equal(error.feature, feature);
      assert.equal(error.nodeId, node.id);
      return true;
    });
  }
});

test('does not reject hidden unsupported layers because they are absent from the rendered page', () => {
  const page = { children: [createNode('image', { visible: false }), createNode('rectangle', { fill: '#2468ac' })] };
  const svg = exportPageToSvg(page);
  assert.doesNotMatch(svg, /image layers|data-tiny-image-star-type="image"/);
  assert.match(svg, /fill="#2468ac"/);
});

test('resolves visibility and radius variables using the active layer mode', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Shape');
  const hidden = createVariable(document, collection.id, 'Visible off', 'boolean', false);
  const shown = createVariable(document, collection.id, 'Visible on', 'boolean', true);
  const radius = createVariable(document, collection.id, 'Radius', 'number', 18);
  const hiddenImage = createNode('image', { name: 'Hidden image', visible: true });
  const visible = createNode('rectangle', { name: 'Bound radius', visible: false, width: 80, height: 50, radius: 1, fill: '#123456' });
  const page = document.pages[0];
  addNode(document, hiddenImage);
  addNode(document, visible);
  assert.equal(bindVariable(document, hiddenImage.id, hidden.id, 'visible'), true);
  assert.equal(bindVariable(document, visible.id, shown.id, 'visible'), true);
  assert.equal(bindVariable(document, visible.id, radius.id, 'radius'), true);
  const svg = exportPageToSvg(page, { document });
  assert.doesNotMatch(svg, /Hidden image|image layers/);
  assert.match(svg, /<rect x="0" y="0" width="80" height="50" rx="18" ry="18"/);

  const light = createNode('rectangle', { name: 'Visible in light', visible: true, fill: '#abcdef' });
  addNode(document, light);
  assert.equal(bindVariable(document, light.id, hidden.id, 'visible'), true);
  assert.doesNotMatch(exportPageToSvg(page, { document }), /Visible in light|fill="#abcdef"/);
});

test('viewBox includes stroke bleed, Bézier controls and text overflow but excludes clipped-off children', () => {
  const stroked = createNode('rectangle', { x: 0, y: 0, width: 100, height: 100, fill: '#ffffff', stroke: '#000000', strokeWidth: 10 });
  assert.match(exportNodeToSvg(stroked), /viewBox="-5 -5 110 110"/);

  const curve = createNode('path', { width: 100, height: 80, points: [
    { x: 0, y: 0, out: { x: 3, y: 0 } }, { x: 1, y: 1, in: { x: -3, y: 0 } }
  ] });
  const curveSvg = exportNodeToSvg(curve);
  assert.match(curveSvg, /viewBox="-201 -1 502 82"/);

  const overflowingText = createNode('text', { width: 20, height: 10, fontSize: 10, text: 'WIDE', textDecoration: 'underline', textFit: 'fixed' });
  const textSvg = exportNodeToSvg(overflowingText, { measureText: text => text.length * 10 });
  assert.match(textSvg, /viewBox="0 -1\.5 20 14"/);
  assert.match(textSvg, /textLength="20" lengthAdjust="spacingAndGlyphs"/);
  assert.match(textSvg, /<path d="M 0 10\.3 L 20 10\.3"/);

  const clippedFrame = createNode('frame', { width: 100, height: 100, fill: '#ffffff', clip: true, children: [
    createNode('rectangle', { x: 10_000, y: 0, width: 100, height: 100, fill: '#000000' })
  ] });
  assert.match(exportNodeToSvg(clippedFrame), /viewBox="0 0 100 100"/);
});

test('text wraps into positioned tspans like the canvas editor and requires reliable metrics', () => {
  const text = createNode('text', {
    width: 65, height: 30, fontSize: 10, lineHeight: 1.2, letterSpacing: 0,
    text: 'one two three four five', textFit: 'fixed'
  });
  const svg = exportNodeToSvg(text, { measureText: value => value.length * 6 });
  assert.match(svg, /<tspan x="0" y="0" textLength="42" lengthAdjust="spacingAndGlyphs">one two<\/tspan>/);
  assert.match(svg, /<tspan x="0" y="12" textLength="60" lengthAdjust="spacingAndGlyphs">three four<\/tspan>/);
  assert.match(svg, /<tspan x="0" y="24" textLength="24" lengthAdjust="spacingAndGlyphs">five<\/tspan>/);
  assert.match(svg, /data-tiny-image-star-text-wrap="canvas-word-wrap"/);

  const textWithoutMeasurer = createNode('text', { width: 30, height: 30, fontSize: 10, text: 'WW WW', textFit: 'fixed' });
  assert.throws(() => exportNodeToSvg(textWithoutMeasurer), /requires canvas text measurement to match editor wrapping/);
  assert.throws(() => exportNodeToSvg(createNode('text', {
    width: 0, height: 0, fontSize: 24, text: 'WIDE', textFit: 'fixed'
  }), { measureText: value => value.length * 16 }), /zero-width box/);
});

test('polygon and star point generation matches the editor for fractional counts', () => {
  const polygon = exportNodeToSvg(createNode('polygon', { points: 5.5 }));
  const polygonPoints = polygon.match(/<polygon points="([^"]+)"/)[1].split(' ');
  assert.equal(polygonPoints.length, 6);
  const star = exportNodeToSvg(createNode('star', { points: 5.5 }));
  const starPoints = star.match(/<polygon points="([^"]+)"/)[1].split(' ');
  assert.equal(starPoints.length, 11);
});

test('rejects XML 1.0 forbidden control characters in exported text and names', () => {
  assert.throws(() => exportNodeToSvg(createNode('text', { text: 'Bad\u0001 copy' }), { measureText: value => value.length * 10 }), /characters forbidden by XML 1\.0/);
  assert.throws(() => exportNodeToSvg(createNode('rectangle', { name: 'Bad\u0001 name' })), /characters forbidden by XML 1\.0/);
});
