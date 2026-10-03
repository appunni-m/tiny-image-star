import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, addVariableMode, bindVariable, combineBoolean, createDocument, createFillLayer, createGradientFill, createLayerEffect, createMaskGroup, createNode, createVariable, createVariableCollection, setFrameVariableMode, setVariableValue } from '../src/model.js';
import { createImageFill } from '../src/image-fills.js';
import { isValidGradientFill, moveFillLayer } from '../src/fills.js';
import { imagePreviewKey } from '../src/image-preview-runtime.js';
import { layerBlendModes } from '../src/layer-blend.js';
import { convertFigDocument } from '../src/fig-import.js';
import { exportNodeToSvg, exportPageToSvg, SvgExportError } from '../src/svg-export.js';
import { importSvgToLayers } from '../src/svg-import.js';
import { vectorNetworkGeometryFromAnchors } from '../src/vector-path.js';

function findGradientLayer(nodes) {
  for (const node of nodes || []) {
    if (node.fillGradient) return node;
    const nested = findGradientLayer(node.children);
    if (nested) return nested;
  }
  return null;
}

function findNestedLayer(nodes, predicate) {
  for (const node of nodes || []) {
    if (predicate(node)) return node;
    const nested = findNestedLayer(node.children, predicate);
    if (nested) return nested;
  }
  return null;
}

function figSourceNode(type, localID, parent, position, properties = {}) {
  return {
    guid: { sessionID: 1, localID }, type, name: `Layer ${localID}`,
    ...(parent ? { parentIndex: { guid: parent, position } } : {}),
    size: { x: 120, y: 80 },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    visible: true, opacity: 1, ...properties
  };
}

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

test('page SVG omits slice overlays from artwork bounds and standalone slices require raster export', () => {
  const artwork = createNode('rectangle', { x: 10, y: 20, width: 80, height: 40, fill: '#abcdef', stroke: null, strokeWidth: 0 });
  const slice = createNode('slice', { name: 'UI-only crop overlay', x: -500, y: -500, width: 300, height: 300 });
  const svg = exportPageToSvg({ id: 'page-with-slice', children: [artwork, slice] });
  assert.match(svg, /viewBox="10 20 80 40"/);
  assert.match(svg, /#abcdef/);
  assert.doesNotMatch(svg, /UI-only crop overlay|data-tiny-image-star-type="slice"/);
  assert.throws(() => exportNodeToSvg(slice), error => error instanceof SvgExportError && /raster slice exports/.test(error.message));
});

test('SVG export composes affine residuals with center rotation and layer position', () => {
  const rectangle = createNode('rectangle', {
    name: 'Affine layer', x: 10, y: 20, width: 40, height: 20, rotation: 30,
    affineTransform: { a: 1, b: 0.2, c: 0.5, d: 1 },
    fill: '#abcdef', stroke: null, strokeWidth: 0
  });
  const svg = exportNodeToSvg(rectangle);

  assert.match(svg, /transform="matrix\(1\.11602540378 0\.673205080757 -0\.0669872981078 0\.766025403784 3\.34936490539 -7\.12435565298\)"/);
});

test('SVG text export lays out explicit line-height units in pixels', () => {
  const measureText = text => [...String(text)].length * 5;
  for (const [lineHeight, lineHeightUnit, expectedY] of [
    [18, 'pixels', 18], [150, 'percent', 15], [1.5, 'ratio', 15]
  ]) {
    const text = createNode('text', {
      text: 'a\nb', width: 100, height: 40, fontSize: 10, lineHeight, lineHeightUnit,
      textFit: 'fixed'
    });
    assert.match(exportNodeToSvg(text, { measureText }), new RegExp(`y="${expectedY}"`));
  }
});

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

test('SVG refuses background blur when equivalent editable backdrop sampling is unavailable', () => {
  const node = createNode('rectangle', { effects: [{ id: 'backdrop', type: 'background-blur', visible: true, radius: 12 }] });
  assert.throws(() => exportNodeToSvg(node), error => error instanceof SvgExportError
    && /background blur effects/.test(error.feature)
    && /cannot sample the pixels behind a layer/.test(error.message));
  node.effects[0].visible = false;
  assert.doesNotThrow(() => exportNodeToSvg(node), 'hidden effects do not change the exported appearance');
});

test('SVG refuses visible noise rather than silently dropping its pixel texture', () => {
  const node = createNode('rectangle', { effects: [createLayerEffect('noise')] });
  assert.throws(() => exportNodeToSvg(node), error => error instanceof SvgExportError
    && /noise effects/.test(error.feature)
    && /random pixel grain cannot be represented/.test(error.message));
  node.effects[0].visible = false;
  assert.doesNotThrow(() => exportNodeToSvg(node), 'hidden noise does not change the exported appearance');
});

test('SVG and vector-PDF source export refuse visible texture edge distortion explicitly', () => {
  const node = createNode('rectangle', { effects: [createLayerEffect('texture')] });
  assert.throws(() => exportNodeToSvg(node), error => error instanceof SvgExportError
    && /texture effects/.test(error.feature)
    && /edge distress cannot be represented by editable SVG geometry/.test(error.message)
    && /rasterize the layer/.test(error.message));
  node.effects[0].visible = false;
  assert.doesNotThrow(() => exportNodeToSvg(node), 'hidden texture does not alter exported appearance');
});

test('SVG export refuses visible Glass backdrop sampling explicitly', () => {
  const node = createNode('rectangle', { effects: [createLayerEffect('glass')] });
  assert.throws(() => exportNodeToSvg(node), error => error instanceof SvgExportError
    && /Glass effects/.test(error.feature)
    && /backdrop refraction and transparency/.test(error.message)
    && /rasterize the layer or hide\/remove/.test(error.message));
  node.effects[0].visible = false;
  assert.doesNotThrow(() => exportNodeToSvg(node), 'hidden Glass does not change editable vector output');
});

test('SVG preserves the direction of a negative-slope line', () => {
  const line = createNode('line', { x: 10, y: 20, width: 80, height: 45, stroke: '#123456', strokeWidth: 3, lineReverseY: true });
  const svg = exportNodeToSvg(line);
  assert.match(svg, /d="M 0 45 L 80 0"/);
});

test('SVG endpoint decorations stay editable, independent per stroke, and inside the rotated viewBox', () => {
  const line = createNode('line', {
    width: 100, height: 0, rotation: 90,
    strokes: [
      { id: 'primary', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'dashed', miterLimit: 10,
        startDecoration: 'arrow', endDecoration: 'none' },
      { id: 'accent', color: '#abcdef', width: 4, opacity: .5, visible: true, cap: 'round', join: 'round', pattern: 'solid', miterLimit: 10,
        startDecoration: 'none', endDecoration: 'triangle' }
    ]
  });
  const svg = exportNodeToSvg(line);
  assert.match(svg, /viewBox="40.2 -52 19.6 103"/, 'the arrow and triangle bleed expands the rotated local bounds');
  assert.match(svg, /<g transform="matrix\(0 1 -1 0 50 -50\)"/,
    'markers share the layer transform and therefore scale or rotate with the line');
  assert.match(svg, /data-tiny-image-star-decoration="arrow" data-tiny-image-star-decoration-end="start" d="M 8 -4\.4 L 0 0 L 8 4\.4" fill="none" stroke="#123456" stroke-width="2" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round"/,
    'arrow is an editable vector path and retains its stroke paint while removing dash gaps');
  assert.match(svg, /data-tiny-image-star-decoration="triangle" data-tiny-image-star-decoration-end="end" d="M 100 0 L 84 8\.8 L 84 -8\.8 Z" fill="#abcdef" fill-opacity="0\.5" stroke="none"/,
    'triangle is a separately editable filled path with its own stroke opacity');
  assert.doesNotMatch(svg, /data-tiny-image-star-decoration="none"/);

  const defaultLine = createNode('line', { width: 40, height: 0, strokes: [
    { id: 'plain', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 }
  ] });
  assert.doesNotMatch(exportNodeToSvg(defaultLine), /data-tiny-image-star-decoration=/,
    'legacy stack items with omitted decoration fields continue to mean none');
});

test('SVG exports independent editable linear and radial stroke gradients with local definitions', () => {
  const linear = createGradientFill('linear', '#ff0000');
  linear.angle = 90;
  linear.stops[1].color = '#0000ff';
  const radial = createGradientFill('radial', '#00aa44');
  radial.stops[1].color = '#112233';
  const rectangle = createNode('rectangle', { width: 90, height: 50, strokes: [
    { id: 'linear-outline', color: '#ff0000', width: 3, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10, gradient: linear },
    { id: 'radial-outline', color: '#00aa44', width: 5, opacity: .6, visible: true, cap: 'round', join: 'round', pattern: 'dashed', miterLimit: 10, gradient: radial }
  ] });
  const svg = exportNodeToSvg(rectangle);
  assert.match(svg, /<linearGradient id="tis-gradient-0-stroke-0" gradientUnits="userSpaceOnUse"[^>]*><stop offset="0" stop-color="#ff0000"\/><stop offset="1" stop-color="#0000ff"\/><\/linearGradient>/);
  assert.match(svg, /<radialGradient id="tis-gradient-0-stroke-1" gradientUnits="userSpaceOnUse"[^>]*><stop offset="0" stop-color="#00aa44"\/><stop offset="1" stop-color="#112233"\/><\/radialGradient>/);
  assert.match(svg, /data-tiny-image-star-stroke-id="linear-outline"[^>]*stroke="url\(#tis-gradient-0-stroke-0\)"/);
  assert.match(svg, /data-tiny-image-star-stroke-id="radial-outline"[^>]*stroke="url\(#tis-gradient-0-stroke-1\)" stroke-opacity="0.6"/);
});

test('SVG decorations attach only to open path ends and network terminal vertices', () => {
  const path = createNode('path', {
    width: 100, height: 60, rotation: 15,
    points: [{ x: .1, y: .5 }, { x: .9, y: .5 }],
    subpaths: [{ closed: true, points: [{ x: .2, y: .2 }, { x: .5, y: .2 }, { x: .4, y: .5 }] }],
    strokes: [{ id: 'path-stroke', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'round', join: 'round', pattern: 'solid', miterLimit: 10,
      startDecoration: 'triangle', endDecoration: 'arrow' }]
  });
  const pathSvg = exportNodeToSvg(path);
  assert.equal([...pathSvg.matchAll(/data-tiny-image-star-decoration=/g)].length, 2,
    'closed contours do not receive endpoint decorations');
  assert.match(pathSvg, /data-tiny-image-star-decoration="triangle" data-tiny-image-star-decoration-end="start"/);
  assert.match(pathSvg, /data-tiny-image-star-decoration="arrow" data-tiny-image-star-decoration-end="end"/);

  const network = createNode('network', {
    width: 100, height: 100, rotation: 30,
    vertices: [{ id: 'a', x: 0, y: .5 }, { id: 'b', x: .5, y: .5 }, { id: 'c', x: 1, y: .5 }, { id: 'd', x: .5, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'bd', from: 'b', to: 'd' }],
    strokes: [{ id: 'network-stroke', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10,
      startDecoration: 'arrow', endDecoration: 'triangle' }]
  });
  const networkSvg = exportNodeToSvg(network);
  assert.equal([...networkSvg.matchAll(/data-tiny-image-star-decoration=/g)].length, 3,
    'three terminal vertices receive marks while the shared junction does not');
  assert.deepEqual([...networkSvg.matchAll(/data-tiny-image-star-decoration-end="([^"]+)"/g)].map(match => match[1]), ['start', 'end', 'end']);
  assert.match(networkSvg, /data-tiny-image-star-edge-id="ab"/);
  assert.match(networkSvg, /transform="matrix\(0\.866025\d+ 0\.5 -0\.5 0\.866025\d+ 31\.698729\d+ -18\.301270\d+\)"/,
    'network endpoint geometry follows the enclosing layer rotation');
});

test('SVG export uses the selected variable mode for bound position, size, and rotation', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Responsive geometry');
  const compact = collection.defaultModeId;
  const wide = addVariableMode(document, collection.id, 'Wide');
  const values = {
    x: [12, 48], y: [16, 32], width: [120, 240], height: [60, 120], rotation: [0, 90]
  };
  const variables = Object.fromEntries(Object.entries(values).map(([property, [initial]]) => [
    property, createVariable(document, collection.id, property, 'number', initial)
  ]));
  for (const [property, [, wideValue]] of Object.entries(values)) {
    assert.equal(setVariableValue(document, variables[property].id, wideValue, wide.id), true);
  }
  const rectangle = createNode('rectangle', { fill: '#123456' });
  addNode(document, rectangle);
  for (const [property, variable] of Object.entries(variables)) assert.equal(bindVariable(document, rectangle.id, variable.id, property), true);
  const page = { id: 'page', children: [rectangle] };

  const compactSvg = exportPageToSvg(page, { document });
  assert.match(compactSvg, /viewBox="12 16 120 60"/);
  assert.match(compactSvg, /<rect x="0" y="0" width="120" height="60"/);
  assert.match(compactSvg, /matrix\(1 0 0 1 12 16\)/);

  collection.defaultModeId = wide.id;
  const wideSvg = exportPageToSvg(page, { document });
  assert.match(wideSvg, /viewBox="108 -28 120 240"/);
  assert.match(wideSvg, /<rect x="0" y="0" width="240" height="120"/);
  assert.match(wideSvg, /matrix\(0 1 -1 0 228 -28\)/);
  assert.equal(compact, collection.modes[0].id);
});

test('SVG export resolves bound typography and paragraph layout in the active frame mode', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Typography');
  const editorial = addVariableMode(document, collection.id, 'Editorial');
  const values = {
    fontFamily: ['string', 'Base Sans', 'Editorial Sans'],
    fontSize: ['number', 10, 12],
    fontWeight: ['number', 400, 700],
    fontStyle: ['string', 'normal', 'italic'],
    paragraphSpacing: ['number', 0, 4],
    firstLineIndent: ['number', 0, 6]
  };
  const variables = Object.fromEntries(Object.entries(values).map(([property, [type, initial, alternate]]) => {
    const variable = createVariable(document, collection.id, property, type, initial);
    assert.equal(setVariableValue(document, variable.id, alternate, editorial.id), true);
    return [property, variable];
  }));
  const frame = createNode('frame', { width: 140, height: 80, variableModes: { [collection.id]: editorial.id } });
  const text = createNode('text', {
    text: 'one\ntwo', width: 100, height: 50, textFit: 'fixed', fontFamily: 'Fallback Sans',
    fontSize: 10, lineHeight: 1.25, fontWeight: 400, fontStyle: 'normal'
  });
  addNode(document, frame);
  addNode(document, text, { parentId: frame.id });
  for (const [property, variable] of Object.entries(variables)) assert.equal(bindVariable(document, text.id, variable.id, property), true);

  const measuredFamilies = new Set();
  const svg = exportPageToSvg(document.pages[0], {
    document,
    measureText(value, node) {
      measuredFamilies.add(node.fontFamily);
      return [...String(value)].length * Number(node.fontSize) / 2;
    }
  });
  assert.match(svg, /font-family="Editorial Sans" font-size="12" font-weight="700" font-style="italic"/,
    'the exported text style uses the selected mode values');
  assert.match(svg, /<tspan x="6" y="0"/,
    'the first line begins at the variable-bound paragraph indent');
  assert.match(svg, /<tspan x="6" y="19"/,
    'the following paragraph includes variable-bound paragraph spacing and indent');
  assert.deepEqual([...measuredFamilies], ['Editorial Sans'], 'SVG measurement matches the font family that is exported');
});

test('exports a selected node in its own rotated local bounds and supports vector basics', () => {
  const ellipse = createNode('ellipse', { name: 'Dot', x: 900, y: -500, width: 40, height: 20, rotation: 90, fill: '#ff0088' });
  const svg = exportNodeToSvg(ellipse);
  assert.match(svg, /viewBox="10 -10 20 40"/);
  assert.match(svg, /<ellipse cx="20" cy="10" rx="20" ry="10" fill="#ff0088"/);

  const line = createNode('line', { width: 31, height: 12, stroke: '#224466', strokeWidth: 4 });
  assert.match(exportNodeToSvg(line), /<path d="M 0 0 L 31 12" fill="none" stroke="#224466" stroke-width="4" stroke-miterlimit="10"\/>/);

  const vector = createNode('path', { width: 100, height: 80, closed: true, fill: '#ccddaa', points: [
    { x: 0, y: 0, out: { x: 0.25, y: 0 } },
    { x: 1, y: 1, in: { x: -0.25, y: 0 } }
  ] });
  assert.match(exportNodeToSvg(vector), /<path d="M 0 0 C 25 0 75 80 100 80 L 0 0 Z" fill="#ccddaa"/);
});

test('exports compound editable contours and preserves the even-odd fill rule', () => {
  const compound = createNode('path', {
    width: 100, height: 80, closed: true, fillRule: 'evenodd', fill: '#123456',
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    subpaths: [{ closed: true, points: [{ x: .25, y: .25 }, { x: .25, y: .75 }, { x: .75, y: .75 }, { x: .75, y: .25 }] }]
  });
  const svg = exportNodeToSvg(compound);
  assert.match(svg, /d="M 0 0 L 100 0 L 100 80 L 0 80 L 0 0 Z M 25 20 L 25 60 L 75 60 L 75 20 L 25 20 Z"/);
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, /fill="#123456"/);
});

test('SVG export preserves non-default stroke cap, join, and pattern styles', () => {
  const dashed = createNode('line', { width: 40, height: 0, stroke: '#123456', strokeWidth: 3, strokeCap: 'square', strokeJoin: 'bevel', strokePattern: 'dashed' });
  const dashedSvg = exportNodeToSvg(dashed);
  assert.match(dashedSvg, /stroke-width="3" stroke-linecap="square" stroke-linejoin="bevel" stroke-dasharray="12 6"/);

  const dotted = createNode('path', { width: 40, height: 20, points: [{ x: 0, y: .5 }, { x: 1, y: .5 }], stroke: '#654321', strokeWidth: 2, strokePattern: 'dotted' });
  assert.match(exportNodeToSvg(dotted), /stroke-width="2" stroke-linecap="round" stroke-miterlimit="10" stroke-dasharray="0 4"/);

  const limited = createNode('line', { width: 20, height: 0, stroke: '#000000', strokeWidth: 2, strokeMiterLimit: 2.5 });
  assert.match(exportNodeToSvg(limited), /stroke-width="2" stroke-miterlimit="2.5"/);
  const svgDefault = createNode('line', { width: 20, height: 0, stroke: '#000000', strokeWidth: 2, strokeMiterLimit: 4 });
  assert.doesNotMatch(exportNodeToSvg(svgDefault), /stroke-miterlimit=/);
});

test('custom dash lengths stay editable and round-trip exactly through SVG', () => {
  const node = createNode('line', {
    id: 'custom-line', width: 40, height: 0, stroke: '#123456', strokeWidth: 2,
    strokeCap: 'square', strokePattern: 'custom', strokeDashArray: [3, 5, 0, 2]
  });
  const svg = exportNodeToSvg(node);
  assert.match(svg, /stroke-width="2" stroke-linecap="square" stroke-miterlimit="10" stroke-dasharray="3 5 0 2"/);
  const imported = importSvgToLayers(svg).nodes;
  const roundTripped = findNestedLayer(imported, layer => layer.strokePattern === 'custom');
  assert.equal(roundTripped.strokePattern, 'custom');
  assert.deepEqual(roundTripped.strokeDashArray, [3, 5, 0, 2]);
  assert.equal(roundTripped.strokeCap, 'square');
});

test('SVG export emits ordered stroke stack records with independent presentation and opacity', () => {
  const node = createNode('rectangle', { width: 40, height: 20, fill: '#ffffff', strokes: [
    { id: 'inner', color: '#123456', width: 12, opacity: .35, visible: true, cap: 'square', join: 'miter', pattern: 'dashed', miterLimit: 8 },
    { id: 'hidden', color: '#ffffff', width: 99, opacity: 1, visible: false, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 },
    { id: 'outer', color: '#abcdef', width: 3, opacity: .7, visible: true, cap: 'round', join: 'bevel', pattern: 'dotted', miterLimit: 5 }
  ] });
  const svg = exportNodeToSvg(node);
  assert.deepEqual([...svg.matchAll(/data-tiny-image-star-stroke-id="([^"]+)"/g)].map(match => match[1]), ['inner', 'outer']);
  assert.match(svg, /stroke="#123456" stroke-opacity="0.35" stroke-width="12" stroke-linecap="square" stroke-miterlimit="8" stroke-dasharray="48 24"/);
  assert.match(svg, /stroke="#abcdef" stroke-opacity="0.7" stroke-width="3" stroke-linecap="round" stroke-linejoin="bevel" stroke-dasharray="0 6"/);
  assert.match(svg, /data-tiny-image-star-stroke-order="0"/);
  assert.match(svg, /data-tiny-image-star-stroke-order="2"/);
});

test('exports graph-backed vector networks as editable face and edge paths', () => {
  const network = createNode('network', {
    id: 'graph', width: 100, height: 80, fill: '#abcdef', fillOpacity: 0.4,
    stroke: '#123456', strokeWidth: 3,
    vertices: [
      { id: 'v1', x: 0, y: 0 }, { id: 'v2', x: 1, y: 0 },
      { id: 'v3', x: 1, y: 1 }, { id: 'v4', x: 0, y: 1 }
    ],
    edges: [
      { id: 'e1', from: 'v1', to: 'v2', control1: { x: 0.25, y: -0.1 }, control2: { x: 0.75, y: -0.1 } },
      { id: 'e2', from: 'v2', to: 'v3' }, { id: 'e3', from: 'v3', to: 'v4' }, { id: 'e4', from: 'v4', to: 'v1' },
      { id: 'e5', from: 'v1', to: 'v3', control1: { x: 0.2, y: 0.2 }, control2: { x: 0.8, y: 0.8 } }
    ],
    faces: [{ id: 'face-a', vertexIds: ['v1', 'v2', 'v3', 'v4'], fill: '#fedcba', fillOpacity: 0.5 }]
  });
  const svg = exportNodeToSvg(network);
  assert.match(svg, /data-tiny-image-star-network-v1="\{&quot;version&quot;:1/);
  assert.match(svg, /data-tiny-image-star-face-id="face-a" d="M 0 0 C 25 -8 75 -8 100 0 L 100 80 L 0 80 L 0 0 Z" fill="#fedcba" fill-opacity="0\.2"/);
  assert.match(svg, /data-tiny-image-star-edge-id="e1" data-tiny-image-star-from="v1" data-tiny-image-star-to="v2" d="M 0 0 C 25 -8 75 -8 100 0" fill="none" stroke="#123456" stroke-width="3"/);
  assert.match(svg, /data-tiny-image-star-edge-id="e5" data-tiny-image-star-from="v1" data-tiny-image-star-to="v3" d="M 0 0 C 20 16 80 64 100 80"/);
  assert.match(svg, /viewBox="-1\.5 -9\.5 103 91"/);

  const container = createNode('frame', { width: 60, height: 50, rotation: 10, clip: true, children: [network] });
  const nested = exportNodeToSvg(container);
  assert.match(nested, /clipPath id="tis-clip-0"/);
  assert.match(nested, /matrix\(/);
  assert.match(nested, /data-tiny-image-star-node-id="graph"/);

  const gradientNetwork = createNode('network', {
    width: 10, height: 10, fill: '#ffffff',
    fillGradient: { type: 'linear', angle: 0, stops: [{ id: 'a', color: '#000000', position: 0 }, { id: 'b', color: '#ffffff', position: 1 }] },
    vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 1, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'ca', from: 'c', to: 'a' }],
    faces: [{ id: 'triangle', vertexIds: ['a', 'b', 'c'] }]
  });
  assert.match(exportNodeToSvg(gradientNetwork), /fill="url\(#tis-gradient-0\)"/);

  const oversizedNetwork = createNode('network', {
    name: 'n'.repeat(1024 * 1024), width: 10, height: 10,
    vertices: [{ id: 'left', x: 0, y: 0 }, { id: 'right', x: 1, y: 1 }],
    edges: [{ id: 'edge', from: 'left', to: 'right' }]
  });
  assert.throws(() => exportNodeToSvg(oversizedNetwork), /network metadata larger than 1048576 characters/);
});

test('SVG export preserves rounded vector-network corners in paint geometry and round-trip metadata', () => {
  const geometry = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }
  ], { closed: true });
  geometry.vertices[0].cornerRadius = 16;
  geometry.vertices[2].cornerRadius = 9;
  const network = createNode('network', {
    id: 'rounded-network', ...geometry, fill: '#123456', stroke: '#000000', strokeWidth: 2
  });
  const svg = exportNodeToSvg(network);

  assert.match(svg, /data-tiny-image-star-face-id="f1" d="M [^"]* A 16 16 0 0 1 15\.999/,
    'the SVG face fill must use the same rounded path as the live network');
  assert.match(svg, /data-tiny-image-star-face-id="f1" data-tiny-image-star-edge-ids="e1 e2 e3 e4"[^>]* d="M [^"]* A 16 16/,
    'the rounded boundary stroke must replace sharp per-edge strokes');
  assert.doesNotMatch(svg, /data-tiny-image-star-edge-id="e1"[^>]* d="M 0 0 L 100 0"/,
    'a consumed raw edge must not paint over the rounded boundary');
  assert.match(svg, /data-tiny-image-star-network-v1="[^"]*&quot;cornerRadius&quot;:16/,
    'the editable graph metadata must retain each independent radius');
});

test('SVG network strokes paint each complete layer before advancing to the next', () => {
  const network = createNode('network', {
    width: 20, height: 10,
    vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 1, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }],
    strokes: [
      { id: 'under', color: '#123456', width: 2, opacity: 1, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 },
      { id: 'over', color: '#abcdef', width: 4, opacity: .5, visible: true, cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 }
    ]
  });
  const svg = exportNodeToSvg(network);
  assert.deepEqual([...svg.matchAll(/data-tiny-image-star-stroke-id="([^"]+)"/g)].map(match => match[1]), ['under', 'under', 'over', 'over']);
});

test('exports simple vector alpha-mask groups with editable mask geometry and source opacity', () => {
  const content = createNode('rectangle', { id: 'masked-content', x: 4, y: 6, width: 96, height: 72, fill: '#123456' });
  const source = createNode('ellipse', {
    id: 'alpha-source', x: 12, y: 8, width: 60, height: 50, rotation: 15,
    fill: '#eeddcc', fillOpacity: 0.5, opacity: 0.4, stroke: '#ff0000', strokeWidth: 8
  });
  const group = createNode('group', {
    id: 'alpha-group', width: 100, height: 80, opacity: 0.7,
    mask: true, maskSourceId: source.id, children: [content, source]
  });
  const svg = exportNodeToSvg(group);

  assert.match(svg, /<mask id="tis-mask-0" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="100" height="80">/);
  assert.match(svg, /<g transform="matrix\([^)]*\)"><ellipse cx="30" cy="25" rx="30" ry="25" fill="#ffffff" fill-opacity="0\.2"\/><\/g>/);
  assert.match(svg, /<g opacity="0\.7" mask="url\(#tis-mask-0\)" data-tiny-image-star-type="group" data-tiny-image-star-node-id="alpha-group">/);
  assert.match(svg, /data-tiny-image-star-node-id="masked-content"/);
  assert.doesNotMatch(svg, /data-tiny-image-star-node-id="alpha-source"/);

  const networkSource = createNode('network', {
    id: 'network-mask', x: 10, y: 5, width: 50, height: 40, fillOpacity: 0.6, opacity: 0.5,
    vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 0.5, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'ca', from: 'c', to: 'a' }],
    faces: [{ id: 'triangle', vertexIds: ['a', 'b', 'c'], fill: '#ff00ff', fillOpacity: 0.5 }]
  });
  const networkGroup = createNode('group', {
    width: 80, height: 60, mask: true, maskSourceId: networkSource.id,
    children: [createNode('rectangle', { width: 80, height: 60 }), networkSource]
  });
  const networkSvg = exportNodeToSvg(networkGroup);
  assert.match(networkSvg, /data-tiny-image-star-face-id="triangle" d="M 0 0 L 50 0 L 25 40 L 0 0 Z" fill="#ffffff" fill-opacity="0\.15"/);
  assert.doesNotMatch(networkSvg, /data-tiny-image-star-edge-id=/);

  const hiddenSource = { ...source, visible: false };
  const unmasked = createNode('group', {
    width: 100, height: 80, mask: true, maskSourceId: hiddenSource.id,
    children: [content, hiddenSource]
  });
  const unmaskedSvg = exportNodeToSvg(unmasked);
  assert.doesNotMatch(unmaskedSvg, /tis-mask-0|mask="url/);
  assert.match(unmaskedSvg, /data-tiny-image-star-node-id="masked-content"/);
  assert.doesNotMatch(unmaskedSvg, /data-tiny-image-star-node-id="alpha-source"/);

  const emptyGroup = createNode('group', {
    id: 'empty-alpha-group', width: 100, height: 80, mask: true,
    maskSourceId: source.id, children: [source]
  });
  const emptySvg = exportNodeToSvg(emptyGroup);
  assert.match(emptySvg, /<mask id="tis-mask-0" mask-type="alpha"/);
  assert.doesNotMatch(emptySvg, /data-tiny-image-star-node-id="masked-content"/);
});

test('exports vector masks as opaque white fill and stroke geometry and preserves their mode on SVG round-trip', () => {
  const source = createNode('ellipse', {
    id: 'vector-source', name: 'Vector source', x: 8, y: 6, width: 48, height: 36,
    opacity: 0.2, fillOpacity: 0, strokeOpacity: 0,
    fills: [{ id: 'clear-fill', type: 'solid', visible: true, opacity: 0, color: 'transparent' }],
    strokes: [{ id: 'clear-stroke', color: 'transparent', width: 8, opacity: 0, visible: true,
      cap: 'round', join: 'round', pattern: 'solid', miterLimit: 10 }]
  });
  const content = createNode('rectangle', { id: 'vector-content', width: 64, height: 48 });
  const group = createNode('group', {
    id: 'vector-group', width: 64, height: 48, mask: true, maskMode: 'vector', maskSourceId: source.id,
    children: [content, source]
  });
  const svg = exportNodeToSvg(group);
  assert.match(svg, /<mask id="tis-mask-0" mask-type="alpha"[^>]*data-tiny-image-star-mask-mode="vector">/);
  assert.match(svg, /<ellipse[^>]*fill="#ffffff"[^>]*stroke="#ffffff" stroke-width="8"/,
    'both visible fill and stroke geometry become opaque white mask coverage');
  assert.doesNotMatch(svg.match(/<mask[^>]*>([\s\S]*?)<\/mask>/)?.[1] || '', /opacity="0\.2"|fill-opacity="0"|stroke-opacity="0"/,
    'source, fill, and stroke alpha do not leak into vector coverage');
  const imported = importSvgToLayers(svg);
  const restored = findNestedLayer(imported.nodes, node => node.type === 'group' && node.mask);
  assert.equal(restored?.maskMode, 'vector');
  const restoredSource = restored?.children.find(node => node.id === restored.maskSourceId);
  assert.equal(restoredSource?.type, 'path');
  assert.equal(restoredSource?.stroke, '#ffffff');
  assert.equal(restoredSource?.strokeWidth, 8);
});

test('exports editable text glyphs as white alpha-mask content with layer opacity', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Mask typography');
  const alternate = addVariableMode(document, collection.id, 'Alternate');
  const fontSize = createVariable(document, collection.id, 'Text size', 'number', 24);
  setVariableValue(document, fontSize.id, 48, alternate.id);
  const frame = createNode('frame', { width: 140, height: 70 });
  const content = createNode('rectangle', { id: 'text-mask-content', width: 120, height: 50 });
  const source = createNode('text', {
    id: 'text-mask-source', name: 'Mask typography', x: 3, y: 4, width: 120, height: 50,
    text: 'TYPE', opacity: 0.5, fillOpacity: 0.5,
    textRuns: [{ text: 'TYPE', color: '#ff0000' }]
  });
  addNode(document, frame);
  addNode(document, content, { parentId: frame.id });
  addNode(document, source, { parentId: frame.id });
  bindVariable(document, source.id, fontSize.id, 'fontSize');
  const group = createMaskGroup(document, [content.id, source.id]);
  setFrameVariableMode(document, frame.id, collection.id, alternate.id);
  const measureText = (text, node) => [...text].length * Number(node.fontSize) * 0.6;
  const svg = exportNodeToSvg(group, { document, measureText });
  const mask = svg.match(/<mask id="tis-mask-0"[^>]*>([\s\S]*?)<\/mask>/)?.[1];

  assert.ok(mask, 'the text group should create an SVG alpha mask');
  assert.match(mask, /<text[^>]*fill="#ffffff" fill-opacity="0\.25"/,
    'text source and layer opacity should combine into the glyph alpha');
  assert.match(mask, /<tspan[^>]*fill="#ffffff">TYPE<\/tspan>/,
    'mixed-style glyphs should be recolored white without changing their text');
  assert.match(mask, /font-size="48"/, 'text mask layout should honor the active variable-mode font size');
  assert.doesNotMatch(mask, /#ff0000/, 'source text color must not tint mask alpha');
  assert.match(svg, /mask="url\(#tis-mask-0\)"/);
});

test('exports image and container layers as alpha-mask sources', () => {
  const assets = new Map([['mask-photo', {
    id: 'mask-photo', type: 'image/png', width: 20, height: 12,
    sourceBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  }]]);
  const imageSource = createNode('image', { id: 'image-mask-source', assetId: 'mask-photo', width: 40, height: 30 });
  const imageGroup = createNode('group', {
    width: 60, height: 40, mask: true, maskSourceId: imageSource.id,
    children: [createNode('rectangle', { width: 60, height: 40 }), imageSource]
  });
  const imageSvg = exportNodeToSvg(imageGroup, { assets });
  assert.match(imageSvg, /<mask id="tis-mask-0"[^>]*>[\s\S]*data:image\/png;base64/);
  assert.match(imageSvg, /data-tiny-image-star-node-id="image-mask-source"/);

  for (const type of ['group', 'frame', 'section']) {
    const child = createNode('rectangle', { id: `${type}-mask-paint`, width: 24, height: 18, fill: '#123456' });
    const source = createNode(type, { id: `${type}-mask-source`, width: 32, height: 24, children: [child] });
    const group = createNode('group', {
      width: 48, height: 36, mask: true, maskSourceId: source.id,
      children: [createNode('rectangle', { width: 48, height: 36 }), source]
    });
    const svg = exportNodeToSvg(group);
    assert.match(svg, new RegExp(`data-tiny-image-star-node-id="${type}-mask-paint"`), `${type} contents should be included in its alpha mask`);
    assert.match(svg, /<mask id="tis-mask-0" mask-type="alpha"/);
  }
});

test('reports unsupported alpha-mask source contents precisely', () => {
  const cases = [
    [createNode('path', { id: 'open-path-mask', closed: false }), 'open path alpha mask contents'],
    [createNode('network', { id: 'open-network-mask' }), 'open vector network alpha mask contents'],
    [createNode('boolean', { id: 'boolean-mask' }), 'boolean alpha mask contents']
  ];
  for (const [source, feature] of cases) {
    const group = createNode('group', {
      id: `group-${source.id}`, width: 80, height: 60, mask: true, maskSourceId: source.id,
      children: [createNode('rectangle', { width: 80, height: 60 }), source]
    });
    assert.throws(() => exportNodeToSvg(group), error => {
      assert.ok(error instanceof SvgExportError);
      assert.equal(error.feature, feature);
      assert.equal(error.nodeId, source.id);
      return true;
    });
  }

  const blendedSource = createNode('ellipse', { id: 'blended-mask', blendMode: 'multiply' });
  const blendedGroup = createNode('group', {
    width: 80, height: 60, mask: true, maskSourceId: blendedSource.id,
    children: [createNode('rectangle', { width: 80, height: 60 }), blendedSource]
  });
  assert.throws(() => exportNodeToSvg(blendedGroup), error => error instanceof SvgExportError && error.feature === 'blended alpha mask contents');
});

test('exports user-space gradient fills, layer effects, and CSS blend modes as editable SVG', () => {
  const gradient = createNode('rectangle', {
    id: 'gradient-layer', name: 'Gradient card', x: 8, y: 12, width: 100, height: 50,
    rotation: 90, opacity: 0.6, fillOpacity: 0.4, fill: '#ffffff',
    fillGradient: { type: 'linear', angle: 0, stops: [
      { id: 'stop-a', color: '#123456', position: 0 },
      { id: 'stop-b', color: '#abcdef', position: 1 }
    ] }
  });
  const first = exportNodeToSvg(gradient);
  assert.equal(first, exportNodeToSvg(gradient));
  assert.match(first, /<linearGradient id="tis-gradient-0" gradientUnits="userSpaceOnUse" x1="0" y1="25" x2="100" y2="25"><stop offset="0" stop-color="#123456"\/><stop offset="1" stop-color="#abcdef"\/><\/linearGradient>/);
  assert.match(first, /<g transform="matrix\(0 1 -1 0 75 -25\)" opacity="0\.6" data-tiny-image-star-type="rectangle" data-tiny-image-star-node-id="gradient-layer">/);
  assert.match(first, /fill="url\(#tis-gradient-0\)" fill-opacity="0\.4"/);

  const radial = createNode('ellipse', {
    width: 40, height: 20, fill: '#ffffff', fillOpacity: 0.7,
    fillGradient: { type: 'radial', angle: 0, stops: [
      { id: 'radial-a', color: '#000000', position: 0 },
      { id: 'radial-b', color: '#ffffff', position: 1 }
    ] }
  });
  assert.match(exportNodeToSvg(radial), /<radialGradient id="tis-gradient-0" gradientUnits="userSpaceOnUse" cx="20" cy="10" r="22\.360679775"><stop offset="0" stop-color="#000000"\/><stop offset="1" stop-color="#ffffff"\/><\/radialGradient>/);

  const effected = createNode('rectangle', {
    id: 'shadow-layer', width: 100, height: 50, fill: '#ffffff',
    blendMode: 'multiply',
    effects: [
      { id: 'blur-1', type: 'layer-blur', visible: false, radius: 4 },
      { id: 'shadow-1', type: 'drop-shadow', visible: true, color: '#112233', opacity: 0.25, offsetX: 5, offsetY: -2, blur: 3 }
    ]
  });
  const effectSvg = exportNodeToSvg(effected);
  assert.match(effectSvg, /<filter id="tis-effect-0" filterUnits="userSpaceOnUse" x="-14" y="-11" width="128" height="72"><feDropShadow in="SourceGraphic" dx="5" dy="-2" stdDeviation="3" flood-color="#112233" flood-opacity="0\.25" result="tis-effect-0-result-0"\/><\/filter>/);
  assert.match(effectSvg, /<g opacity="1" filter="url\(#tis-effect-0\)" style="mix-blend-mode:multiply" data-tiny-image-star-type="rectangle" data-tiny-image-star-node-id="shadow-layer">/);
  assert.equal(effectSvg, exportNodeToSvg(effected), 'generated paint and effect IDs remain stable across exports');
});

test('SVG export rejects angular gradients with an explicit raster-export fallback', () => {
  const fill = createNode('rectangle', { name: 'Angular fill', fillGradient: createGradientFill('angular', '#ff0000') });
  assert.throws(() => exportNodeToSvg(fill), error => error instanceof SvgExportError
    && error.feature === 'angular gradients (choose raster export to preserve the appearance)');

  const stroke = createNode('rectangle', { name: 'Angular stroke', strokes: [
    { id: 'angular-stroke', color: '#ff0000', width: 3, opacity: 1, visible: true,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10,
      gradient: createGradientFill('angular', '#ff0000') }
  ] });
  assert.throws(() => exportNodeToSvg(stroke), error => error instanceof SvgExportError
    && error.feature === 'angular gradients (choose raster export to preserve the appearance)');
});

test('exports explicit gradient geometry through standard SVG affine gradient transforms', () => {
  const linear = createNode('rectangle', {
    width: 100, height: 50,
    fillGradient: {
      type: 'linear', angle: 0,
      stops: [{ id: 'linear-a', color: '#000000', position: 0 }, { id: 'linear-b', color: '#ffffff', position: 1 }],
      geometry: { handles: [{ x: .1, y: .2 }, { x: .8, y: .7 }, { x: -.2, y: .9 }] }
    }
  });
  const linearSvg = exportNodeToSvg(linear);
  assert.match(linearSvg, /<linearGradient id="tis-gradient-0" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0" gradientTransform="matrix\(70 25 -30 35 10 10\)">/);

  const radial = createNode('ellipse', {
    width: 100, height: 50,
    fillGradient: {
      type: 'radial', angle: 0,
      stops: [{ id: 'radial-a', color: '#000000', position: 0 }, { id: 'radial-b', color: '#ffffff', position: 1 }],
      geometry: { handles: [{ x: .5, y: .5 }, { x: .9, y: .5 }, { x: .3, y: 1.1 }] }
    }
  });
  const radialSvg = exportNodeToSvg(radial);
  assert.match(radialSvg, /<radialGradient id="tis-gradient-0" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix\(40 0 -20 30 50 25\)">/);

  const unsupportedGeometry = createNode('rectangle', {
    width: 100, height: 50,
    fillGradient: {
      type: 'radial', angle: 0,
      stops: [{ id: 'bad-a', color: '#000000', position: 0 }, { id: 'bad-b', color: '#ffffff', position: 1 }],
      geometry: { handles: [{ x: .5, y: .5 }, { x: .75, y: .5 }, { x: .5, y: .75 }], customGeometry: true }
    }
  });
  assert.throws(() => exportNodeToSvg(unsupportedGeometry), /exactly three finite object-space gradient handles/);
});

test('near-parallel but well-conditioned gradients survive editable SVG round-trip', () => {
  const node = createNode('rectangle', {
    width: 100, height: 100,
    fillGradient: {
      type: 'linear', angle: 0,
      stops: [{ id: 'near-a', color: '#000000', position: 0 }, { id: 'near-b', color: '#ffffff', position: 1 }],
      geometry: { handles: [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: .5, y: .5 + 1e-14 }] }
    }
  });
  const svg = exportNodeToSvg(node);
  assert.match(svg, /gradientTransform="matrix\(50 50 50 50\.000000000001 0 0\)"/,
    'gradient serialization retains affine precision needed to keep its basis nonsingular');
  const imported = findGradientLayer(importSvgToLayers(svg).nodes);
  assert.ok(imported, 'round-trip imports an editable gradient');
  assert.equal(isValidGradientFill(imported.fillGradient), true);
  assert.ok(Math.abs(imported.fillGradient.geometry.handles[2].y - imported.fillGradient.geometry.handles[1].y) > 3.5e-15);
});

test('horizontal and vertical explicit gradients use one-pixel empty-axis geometry in SVG', () => {
  for (const { width, height, gradient } of [
    { width: 100, height: 0, gradient: { type: 'linear', angle: 0, stops: [
      { id: 'horizontal-a', color: '#000000', position: 0 }, { id: 'horizontal-b', color: '#ffffff', position: 1 }
    ], geometry: { handles: [{ x: .25, y: .5 }, { x: .75, y: .5 }, { x: .25, y: 1.5 }] } } },
    { width: 0, height: 100, gradient: { type: 'radial', angle: 0, stops: [
      { id: 'vertical-a', color: '#000000', position: 0 }, { id: 'vertical-b', color: '#ffffff', position: 1 }
    ], geometry: { handles: [{ x: .5, y: .25 }, { x: 1.5, y: .25 }, { x: .5, y: .75 }] } } }
  ]) {
    const node = createNode('rectangle', { width, height, fillGradient: gradient });
    const svg = exportNodeToSvg(node);
    const imported = findGradientLayer(importSvgToLayers(svg).nodes);
    assert.ok(imported, `${width}x${height} SVG imports its gradient`);
    assert.equal(isValidGradientFill(imported.fillGradient), true);
  }
});

test('exports inner shadows as editable SVG alpha-mask filter primitives', () => {
  const shape = createNode('rectangle', {
    id: 'inset-card', width: 80, height: 40, fill: '#ffffff',
    effects: [{ id: 'inner', type: 'inner-shadow', visible: true, color: '#102030', opacity: 0.35, offsetX: 3, offsetY: -2, blur: 5 }]
  });
  const svg = exportNodeToSvg(shape);
  assert.match(svg, /<feGaussianBlur in="SourceGraphic" stdDeviation="5" result="tis-effect-0-result-0-blur"\/><feOffset in="tis-effect-0-result-0-blur" dx="3" dy="-2" result="tis-effect-0-result-0-offset"\/><feComposite in="SourceGraphic" in2="tis-effect-0-result-0-offset" operator="out" result="tis-effect-0-result-0-shape"\/><feFlood flood-color="#102030" flood-opacity="0\.35" result="tis-effect-0-result-0-paint"\/><feComposite in="tis-effect-0-result-0-paint" in2="tis-effect-0-result-0-shape" operator="in" result="tis-effect-0-result-0-shadow"\/><feComposite in="tis-effect-0-result-0-shadow" in2="SourceGraphic" operator="over" result="tis-effect-0-result-0"\/>/);
  assert.match(svg, /filter="url\(#tis-effect-0\)"/);
});

test('orders SVG inner shadows before authored blur and drop-shadow effects like the canvas renderer', () => {
  const shape = createNode('rectangle', {
    width: 80, height: 40, fill: '#ffffff',
    effects: [
      { id: 'blur-first', type: 'layer-blur', visible: true, radius: 3 },
      { id: 'inner-first', type: 'inner-shadow', visible: true, color: '#102030', opacity: 0.35, offsetX: 3, offsetY: -2, blur: 5 },
      { id: 'drop-shadow', type: 'drop-shadow', visible: true, color: '#304050', opacity: 0.5, offsetX: 4, offsetY: 2, blur: 6 },
      { id: 'inner-second', type: 'inner-shadow', visible: true, color: '#506070', opacity: 0.2, offsetX: -2, offsetY: 1, blur: 2 }
    ]
  });
  const svg = exportNodeToSvg(shape);
  const filter = svg.match(/<filter id="tis-effect-0"[^>]*>([\s\S]*?)<\/filter>/)?.[1];
  assert.ok(filter, 'expected the SVG effect filter');
  const firstShadow = filter.indexOf('<feGaussianBlur in="SourceGraphic" stdDeviation="5"');
  const secondShadow = filter.indexOf('<feGaussianBlur in="tis-effect-0-result-0" stdDeviation="2"');
  const firstBlur = filter.indexOf('<feGaussianBlur in="tis-effect-0-result-1" stdDeviation="3"');
  const dropShadow = filter.indexOf('<feDropShadow in="tis-effect-0-result-2"');
  const positions = [firstShadow, secondShadow, firstBlur, dropShadow];
  assert.ok(positions.every(position => position >= 0), 'all visible effects should be represented');
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right),
    'inner shadows should precede outer effects while outer effects retain authored order');
  assert.match(filter, /<feComposite in="tis-effect-0-result-0" in2="tis-effect-0-result-1-offset" operator="out" result="tis-effect-0-result-1-shape"\/>/,
    'the second inner shadow must use the first shadow result alpha, matching sequential Canvas compositing');
  assert.doesNotMatch(filter, /stdDeviation="9"/, 'hidden effects should remain omitted');
});

test('exports Boolean unions with editable vector operands and an alpha mask', () => {
  const group = createNode('boolean', {
    id: 'union', operation: 'union', x: 5, y: 8, width: 120, height: 80,
    fill: '#123456', fillOpacity: 0.65, radius: 12, stroke: '#000000', strokeWidth: 4,
    children: [
      createNode('ellipse', { id: 'left', x: 0, y: 0, width: 60, height: 60, fill: '#ff0000', opacity: 0.5 }),
      createNode('rectangle', { id: 'right', x: 30, y: 20, width: 90, height: 60, fill: '#00ff00' })
    ]
  });
  const svg = exportNodeToSvg(group);
  assert.match(svg, /<mask id="tis-boolean-0" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="120" height="80">/);
  assert.match(svg, /<ellipse[^>]*fill="#ffffff" fill-opacity="1"[^>]*\/><\/g>/);
  assert.match(svg, /opacity="0\.5"><ellipse/);
  assert.match(svg, /<rect x="0" y="0" width="120" height="80" rx="0" ry="0" fill="#123456" fill-opacity="0\.65"/);
  assert.doesNotMatch(svg, /stroke="#000000"/);
  assert.match(svg, /mask="url\(#tis-boolean-0\)" data-tiny-image-star-type="boolean" data-tiny-image-star-node-id="union"/);
  assert.doesNotMatch(svg, /data-tiny-image-star-node-id="left"/);
  assert.equal(svg, exportNodeToSvg(group));

  const nested = createNode('boolean', {
    id: 'nested-union', width: 100, height: 60,
    children: [createNode('rectangle', { width: 40, height: 40 }), createNode('boolean', {
      operation: 'union', x: 30, width: 70, height: 60,
      children: [createNode('ellipse', { width: 30, height: 30 }), createNode('polygon', { x: 20, width: 40, height: 50 })]
    })]
  });
  assert.match(exportNodeToSvg(nested), /tis-boolean-0/);
  const nestedSubtract = createNode('boolean', {
    operation: 'union', width: 100, height: 60,
    children: [createNode('rectangle', { width: 30, height: 30 }), createNode('boolean', {
      operation: 'subtract', x: 20, width: 70, height: 60,
      children: [createNode('ellipse', { width: 70, height: 60 }), createNode('rectangle', { x: 25, width: 20, height: 60 })]
    })]
  });
  assert.match(exportNodeToSvg(nestedSubtract), /tis-boolean-0-operand-1-result-inverse-0-filter/);
});

test('Boolean SVG masks preserve live text, force white ink, and scale resolved text geometry once', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Boolean text');
  const alternate = addVariableMode(document, collection.id, 'Alternate');
  const textVariable = createVariable(document, collection.id, 'Label', 'string', 'Old');
  const fontSizeVariable = createVariable(document, collection.id, 'Label size', 'number', 24);
  setVariableValue(document, textVariable.id, 'New', alternate.id);
  setVariableValue(document, fontSizeVariable.id, 30, alternate.id);
  const frame = createNode('frame', { width: 180, height: 120 });
  const label = createNode('text', {
    width: 100, height: 70, rotation: 12, fontSize: 24, fontWeight: 700,
    opacity: 0.5, fillOpacity: 0.5, color: 'transparent', textDecoration: 'underline',
    stroke: '#123456', strokeWidth: 4,
    textRuns: [{ text: 'O', color: 'transparent', textDecoration: 'underline' }, { text: 'ld', color: '#abcdef', fontWeight: 700 }]
  });
  const clip = createNode('rectangle', { width: 100, height: 70 });
  addNode(document, frame);
  addNode(document, label, { parentId: frame.id });
  addNode(document, clip, { parentId: frame.id });
  const group = combineBoolean(document, [label.id, clip.id], 'intersect');
  group.width = 150;
  group.height = 100;
  assert.equal(bindVariable(document, label.id, textVariable.id, 'text'), true);
  assert.equal(bindVariable(document, label.id, fontSizeVariable.id, 'fontSize'), true);

  const measureText = (value, node) => [...String(value)].length * Number(node.fontSize || 24) * 0.55;
  const defaultSvg = exportNodeToSvg(group, { document, measureText });
  assert.match(defaultSvg, /<text[^>]*fill="#ffffff" fill-opacity="1"/,
    'Boolean text ink should be opaque white inside the source opacity group');
  assert.match(defaultSvg, /<tspan[^>]*fill="#ffffff">O<\/tspan>/,
    'rich text run color and transparency should not change the glyph alpha mask');
  assert.match(defaultSvg, /<g[^>]*opacity="0\.25"[^>]*><text/,
    'layer and fill opacity should be applied once by the outer source group');
  assert.match(defaultSvg, /transform="matrix\(/,
    'rotated source text should share the Boolean group resize transform');
  assert.doesNotMatch(defaultSvg, /stroke="#123456"/,
    'Boolean operands use text glyph fill, not the text-box stroke');

  assert.equal(setFrameVariableMode(document, frame.id, collection.id, alternate.id), true);
  const alternateSvg = exportNodeToSvg(group, { document, measureText });
  assert.match(alternateSvg, />New<\/tspan>/,
    'SVG Boolean text should resolve mode-bound content instead of stale rich-run text');
  assert.match(alternateSvg, /font-size="30"/,
    'mode-bound text size should be used while laying out the SVG mask');
  assert.equal(alternateSvg, exportNodeToSvg(group, { document, measureText }),
    'mode-bound Boolean text export should remain deterministic');
});

test('exports Boolean subtract and intersect with editable alpha mask composition', () => {
  const subtract = createNode('boolean', {
    id: 'cutout', operation: 'subtract', width: 100, height: 80,
    children: [
      createNode('ellipse', { id: 'base', x: 5, y: 5, width: 80, height: 70, opacity: 0.6, fillOpacity: 0.5 }),
      createNode('rectangle', { id: 'cutter', x: 35, y: 0, width: 50, height: 80 }),
      createNode('ellipse', { id: 'second-cutter', x: 20, y: 30, width: 30, height: 40, opacity: 0.25 })
    ]
  });
  const subtractSvg = exportNodeToSvg(subtract);
  assert.match(subtractSvg, /tis-boolean-0-inverse-0-filter/);
  assert.match(subtractSvg, /<feFuncA type="table" tableValues="1 0"\/>/);
  assert.match(subtractSvg, /mask="url\(#tis-boolean-0-operand-0\)"/);
  assert.match(subtractSvg, /<g[^>]*opacity="0\.3"><ellipse/,
    'base shape opacity and fill opacity multiply before subtraction');
  assert.match(subtractSvg, /opacity="0\.25"><ellipse/,
    'translucent cutters retain their alpha for destination-out composition');

  const intersect = createNode('boolean', {
    id: 'overlap', operation: 'intersect', width: 100, height: 80,
    children: [
      createNode('rectangle', { x: 0, y: 0, width: 75, height: 70, opacity: 0.4 }),
      createNode('ellipse', { x: 25, y: 10, width: 70, height: 60, opacity: 0.5 })
    ]
  });
  const intersectSvg = exportNodeToSvg(intersect);
  assert.match(intersectSvg, /<g><g mask="url\(#tis-boolean-0-operand-0\)"><g mask="url\(#tis-boolean-0-operand-1\)">/);
  assert.match(intersectSvg, /opacity="0\.4"><rect/);
  assert.match(intersectSvg, /opacity="0\.5"><ellipse/);

  const hiddenSubtract = createNode('boolean', {
    operation: 'subtract', width: 60, height: 40,
    children: [createNode('rectangle', { width: 60, height: 40 }), createNode('ellipse', { visible: false, width: 20, height: 20 })]
  });
  const hiddenSubtractSvg = exportNodeToSvg(hiddenSubtract);
  assert.doesNotMatch(hiddenSubtractSvg, /inverse-0|operand-1/);
  const hiddenBaseSubtract = createNode('boolean', {
    operation: 'subtract', width: 60, height: 40,
    children: [
      createNode('rectangle', { id: 'hidden-base', visible: false, width: 60, height: 40 }),
      createNode('ellipse', { id: 'visible-cutter', width: 20, height: 20 })
    ]
  });
  const hiddenBaseSubtractSvg = exportNodeToSvg(hiddenBaseSubtract);
  assert.match(hiddenBaseSubtractSvg, /<mask id="tis-boolean-0"[^>]*><\/mask>/,
    'a hidden original subtract base makes the Boolean result empty');
  assert.doesNotMatch(hiddenBaseSubtractSvg, /tis-boolean-0-operand|inverse-0/,
    'a visible cutter must not be promoted to the subtract base');
  const hiddenIntersect = createNode('boolean', {
    operation: 'intersect', width: 60, height: 40,
    children: [createNode('rectangle', { width: 60, height: 40 }), createNode('ellipse', { visible: false, width: 20, height: 20 })]
  });
  const hiddenIntersectSvg = exportNodeToSvg(hiddenIntersect);
  assert.match(hiddenIntersectSvg, /<mask id="tis-boolean-0"[^>]*><\/mask>/,
    'a hidden intersection operand makes the result empty, matching the editor');
});

test('exports Boolean exclude as editable vector operands with alpha-correct XOR composition', () => {
  const overlapping = createNode('boolean', {
    id: 'translucent-exclude', operation: 'exclude', width: 100, height: 50,
    children: [
      createNode('rectangle', { id: 'base', x: 0, y: 0, width: 45, height: 45, opacity: 0.5 }),
      createNode('ellipse', { id: 'overlap', x: 25, y: 5, width: 45, height: 40, opacity: 0.25 })
    ]
  });
  const overlappingSvg = exportNodeToSvg(overlapping);
  assert.match(overlappingSvg, /<rect[^>]*fill="#ffffff" fill-opacity="1"[^>]*\/><\/g>/,
    'the first vector operand remains an editable alpha-mask source');
  assert.match(overlappingSvg, /opacity="0\.5"><rect/);
  assert.match(overlappingSvg, /opacity="0\.25"><ellipse/);
  assert.match(overlappingSvg, /<feImage href="#tis-boolean-0-operand-0-surface"[^>]*result="tis-boolean-0-exclude-1-filter-previous"\/><feImage href="#tis-boolean-0-operand-1-surface"[^>]*result="tis-boolean-0-exclude-1-filter-operand"\/><feComposite in="tis-boolean-0-exclude-1-filter-previous" in2="tis-boolean-0-exclude-1-filter-operand" operator="xor" result="tis-boolean-0-exclude-1-filter-result"\/>/,
    'overlap is combined with Porter-Duff XOR, preserving partial alpha instead of making a binary cut');
  assert.match(overlappingSvg, /mask="url\(#tis-boolean-0\)" data-tiny-image-star-type="boolean" data-tiny-image-star-node-id="translucent-exclude"/);

  const disjoint = createNode('boolean', {
    operation: 'exclude', width: 100, height: 50,
    children: [
      createNode('rectangle', { x: 0, y: 0, width: 20, height: 20 }),
      createNode('polygon', { x: 65, y: 20, width: 25, height: 25 })
    ]
  });
  const disjointSvg = exportNodeToSvg(disjoint);
  assert.match(disjointSvg, /<rect[^>]*mask="url\(#tis-boolean-0-operand-0\)"/);
  assert.match(disjointSvg, /<polygon[^>]*fill="#ffffff"/);
  assert.match(disjointSvg, /operator="xor"/,
    'disjoint operands still pass through the same vector-preserving XOR operation');
  assert.equal(disjointSvg, exportNodeToSvg(disjoint), 'generated filter and surface IDs remain deterministic');

  const hidden = createNode('boolean', {
    operation: 'exclude', width: 60, height: 40,
    children: [
      createNode('rectangle', { visible: false, width: 60, height: 40 }),
      createNode('ellipse', { width: 20, height: 20 }),
      createNode('polygon', { visible: false, width: 30, height: 30 })
    ]
  });
  const hiddenSvg = exportNodeToSvg(hidden);
  assert.match(hiddenSvg, /<use href="#tis-boolean-0-operand-1-surface"\/>/,
    'a lone visible operand is unchanged when XORed with the empty surface');
  assert.doesNotMatch(hiddenSvg, /operand-0|operand-2|exclude-1-filter/,
    'hidden operands are omitted from the visible XOR chain');
});

test('rejects Boolean operations and structures that cannot be represented faithfully', () => {
  for (const operation of ['unsupported-operation']) {
    const node = createNode('boolean', {
      id: `${operation}-union`, operation,
      children: [createNode('rectangle'), createNode('ellipse')]
    });
    assert.throws(() => exportNodeToSvg(node), error => error instanceof SvgExportError && error.feature === `Boolean ${operation} operations`);
  }
  const malformed = createNode('boolean', { id: 'empty-boolean', children: [createNode('rectangle')] });
  assert.throws(() => exportNodeToSvg(malformed), error => error instanceof SvgExportError && error.feature === 'invalid Boolean group structures');
  const openOperand = createNode('boolean', {
    id: 'open-operand', children: [createNode('path', { closed: false }), createNode('ellipse')]
  });
  assert.throws(() => exportNodeToSvg(openOperand), error => error instanceof SvgExportError && error.feature === 'unsupported Boolean operands');
  const blendedOperand = createNode('boolean', {
    id: 'blended-operand', children: [createNode('rectangle', { blendMode: 'multiply' }), createNode('ellipse')]
  });
  assert.throws(() => exportNodeToSvg(blendedOperand), error => error instanceof SvgExportError && error.feature === 'blended Boolean operands');
});

test('rejects unsupported content explicitly instead of dropping design features', () => {
  const unsupported = [
    [createNode('image'), 'image layers'],
    [createNode('group', { mask: true, maskSourceId: 'mask' }), 'mask groups'],
    [createNode('rectangle', { imageFill: {} }), 'image fills'],
    [createNode('text', { fillGradient: { type: 'linear', angle: 0, stops: [] } }), 'gradient fills'],
    [createNode('boolean'), 'invalid Boolean group structures']
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

test('embeds local raster layers and image fills as data URIs with fit, clipping, transforms, and opacity', () => {
  const assets = new Map([['local-photo', {
    id: 'local-photo', type: 'image/png', width: 400, height: 200,
    sourceBytes: new Uint8Array([0, 1, 2, 255])
  }]]);
  const image = createNode('image', {
    assetId: 'local-photo', x: 12, y: 20, width: 80, height: 50, fit: 'cover',
    radius: 8, rotation: 15, opacity: 0.7, stroke: '#123456', strokeWidth: 2
  });
  const imageSvg = exportNodeToSvg(image, { assets });
  assert.match(imageSvg, /href="data:image\/png;base64,AAEC\/w=="/);
  assert.match(imageSvg, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(imageSvg, /clip-path="url\(#tis-image-clip-0\)"/);
  assert.match(imageSvg, /opacity="0\.7" data-tiny-image-star-type="image"/);
  assert.match(imageSvg, /<clipPath id="tis-image-clip-0"/);
  assert.match(imageSvg, /stroke="#123456" stroke-width="2"/);

  const fill = createNode('ellipse', {
    width: 100, height: 60, fillOpacity: 0.35,
    imageFill: { assetId: 'local-photo', fit: 'contain', adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 } }
  });
  const fillSvg = exportNodeToSvg(fill, { assets });
  assert.match(fillSvg, /href="data:image\/png;base64,AAEC\/w=="/);
  assert.match(fillSvg, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(fillSvg, /opacity="0\.35" clip-path="url\(#tis-image-clip-0\)"/);
  assert.match(fillSvg, /<clipPath id="tis-image-clip-0"[^>]*><ellipse/);
  assert.throws(() => exportNodeToSvg({ ...fill, fillOpacity: 1.1 }, { assets }), /requires valid fill opacity/);
  assert.throws(() => exportNodeToSvg({ ...fill, fillOpacity: -0.1 }, { assets }), /requires valid fill opacity/);
});

test('exports imported Figma TILE fills as SVG patterns with the imported scale and rotation', () => {
  const pageGuid = { sessionID: 1, localID: 1 };
  const imageHash = 'c'.repeat(40);
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      figSourceNode('CANVAS', 1, null, '', { guid: pageGuid, name: 'Tile import' }),
      figSourceNode('RECTANGLE', 2, pageGuid, 'a', {
        name: 'Tiled photo', fillPaints: [{
          type: 'IMAGE', image: { hash: imageHash }, scaleMode: 'TILE', scalingFactor: 0.5,
          rotation: 90, visible: true
        }]
      })
    ],
    images: new Map([[imageHash, pngHeader(2, 3)]]), message: { blobs: [] }
  });
  const shape = imported.document.pages[0].children[0];
  const importedFill = shape.fills[0].imageFill;
  assert.equal(importedFill.fit, 'tile');
  assert.equal(importedFill.scalingFactor, 0.5);
  assert.equal(importedFill.transforms.rotation, 90);

  const source = {
    ...imported.assets[0],
    width: imported.document.imageLibrary[0].width,
    height: imported.document.imageLibrary[0].height
  };
  const svg = exportNodeToSvg(shape, { assets: new Map([[source.id, source]]) });
  assert.match(svg, /<pattern id="tis-image-tile-0-fill-0" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" x="0" y="0" width="1\.5" height="1"><image x="0" y="0" width="2" height="3" preserveAspectRatio="none" transform="matrix\(0 0\.5 -0\.5 0 1\.5 0\)" href="data:image\/png;base64,[^"]+"\/><\/pattern>/);
  assert.match(svg, /<rect x="0" y="0" width="120" height="80" fill="url\(#tis-image-tile-0-fill-0\)" opacity="1" clip-path="url\(#tis-fill-clip-0\)" data-tiny-image-star-fill-id="[^"]+" data-tiny-image-star-fill-type="image"\/>/);
});

test('exports image layers as tiled SVG patterns while preserving scale, crop-independent rotation, and flips', () => {
  const image = createNode('image', {
    id: 'tiled-image-layer', assetId: 'tile-source', width: 120, height: 80,
    fit: 'tile', scalingFactor: 1.5,
    transforms: {
      crop: { left: 0.2, top: 0.1, right: 0.9, bottom: 0.95 },
      rotation: 90, flipHorizontal: true, flipVertical: true
    }
  });
  const svg = exportNodeToSvg(image, { assets: new Map([['tile-source', {
    id: 'tile-source', type: 'image/png', width: 40, height: 20,
    sourceBytes: new Uint8Array([1, 2, 3])
  }]]) });

  assert.match(svg, /<pattern id="tis-image-tile-0" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" x="0" y="0" width="30" height="60"><image x="0" y="0" width="40" height="20" preserveAspectRatio="none" transform="matrix\(0 -1\.5 1\.5 0 0 60\)" href="data:image\/png;base64,AQID"\/><\/pattern>/);
  assert.match(svg, /<rect x="0" y="0" width="120" height="80" fill="url\(#tis-image-tile-0\)" clip-path="url\(#tis-image-clip-0\)"\/>/);
  assert.match(svg, /<clipPath id="tis-image-clip-0"[^>]*><rect/);
});

test('embeds edited previews by layer identity while preserving untouched shared-source bytes', () => {
  const assets = new Map([['shared-photo', {
    id: 'shared-photo', type: 'image/jpeg', width: 400, height: 200,
    sourceBytes: new Uint8Array([1, 2, 3])
  }]]);
  const adjusted = createNode('image', {
    id: 'photo-adjusted', assetId: 'shared-photo',
    adjustments: { brightness: 25, contrast: 0, saturation: 0, sharpness: 0, blur: 0 }
  });
  const croppedAndRotated = createNode('image', {
    id: 'photo-cropped', assetId: 'shared-photo',
    transforms: { crop: { left: 0.25, top: 0, right: 1, bottom: 1 }, rotation: 90 }
  });
  const filled = createNode('rectangle', {
    id: 'photo-fill',
    imageFill: {
      assetId: 'shared-photo', fit: 'contain',
      adjustments: { brightness: 0, contrast: 18, saturation: 0, sharpness: 0, blur: 0 },
      transforms: { crop: { left: 0, top: 0, right: 0.75, bottom: 1 }, rotation: 0 }
    }
  });
  const untouched = createNode('image', { id: 'photo-untouched', assetId: 'shared-photo' });
  const imagePreviews = new Map([
    [adjusted.id, { type: 'image/png', sourceBytes: new Uint8Array([10, 11]), width: 400, height: 200 }],
    [croppedAndRotated.id, { type: 'image/png', sourceBytes: new Uint8Array([20, 21]), width: 200, height: 300 }],
    [filled.id, { type: 'image/png', sourceBytes: new Uint8Array([30, 31]), width: 300, height: 200 }],
  ]);

  const svg = exportPageToSvg({ children: [adjusted, croppedAndRotated, filled, untouched] }, { assets, imagePreviews });
  const hrefFor = nodeId => {
    const escapedId = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = svg.match(new RegExp(`<g[^>]*data-tiny-image-star-node-id="${escapedId}"[^>]*>([\\s\\S]*?)</g>`));
    assert.ok(match, `expected SVG group for ${nodeId}`);
    return match[1].match(/href="([^"]+)"/)?.[1];
  };

  assert.equal(hrefFor(adjusted.id), 'data:image/png;base64,Cgs=');
  assert.equal(hrefFor(croppedAndRotated.id), 'data:image/png;base64,FBU=');
  assert.equal(hrefFor(filled.id), 'data:image/png;base64,Hh8=');
  assert.equal(hrefFor(untouched.id), 'data:image/jpeg;base64,AQID');
});

test('serializes visible explicit fill stacks in paint order with per-fill opacity', () => {
  const assets = new Map([['shared-pattern', {
    id: 'shared-pattern', type: 'image/png', width: 4, height: 3,
    sourceBytes: new Uint8Array([1, 2, 3, 4])
  }]]);
  const gradient = createGradientFill('linear', '#112233');
  gradient.stops[1].color = '#aabbcc';
  const node = createNode('rectangle', {
    id: 'explicit-fill-stack', width: 90, height: 60, fill: '#d9d9d9',
    fills: [
      createFillLayer('solid', { id: 'stack-solid', color: '#13579b', opacity: 0.8 }),
      createFillLayer('solid', { id: 'stack-hidden', color: '#deadbe', visible: false, opacity: 0.95 }),
      createFillLayer('linear', { id: 'stack-gradient', gradient, opacity: 0.35 }),
      createFillLayer('image', {
        id: 'stack-image',
        imageFill: createImageFill('shared-pattern', { fit: 'contain' }),
        opacity: 0.6
      })
    ]
  });

  const svg = exportNodeToSvg(node, { assets });
  const solidPaint = svg.indexOf('fill="#13579b"');
  const gradientPaint = svg.indexOf('fill="url(#tis-gradient-');
  const imagePaint = svg.indexOf('href="data:image/png;base64,AQIDBA=="');
  assert.ok(solidPaint >= 0, 'SVG should contain the explicit solid fill');
  assert.ok(gradientPaint > solidPaint, 'gradient should paint after the base solid');
  assert.ok(imagePaint > gradientPaint, 'image fill should paint after the gradient');
  assert.match(svg, /fill="#13579b" fill-opacity="0\.8"/);
  assert.match(svg, /fill="url\(#tis-gradient-[^)]+\)" fill-opacity="0\.35"/);
  assert.match(svg, /href="data:image\/png;base64,AQIDBA=="[^>]*opacity="0\.6"/);
  assert.doesNotMatch(svg, /#deadbe/, 'hidden explicit fills should not be emitted');
});

test('serializes every fill and stroke Paint blend against the ordered SVG scene backdrop', () => {
  for (const blendMode of layerBlendModes) {
    const node = createNode('rectangle', {
      id: `paint-mode-${blendMode}`, width: 60, height: 40,
      fills: [
        createFillLayer('solid', { id: 'base-paint', color: '#123456' }),
        createFillLayer('solid', { id: 'blended-paint', color: '#abcdef', blendMode })
      ],
      strokes: [{
        id: 'blended-stroke', color: '#fedcba', width: 3, opacity: 1, visible: true,
        cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10, blendMode
      }]
    });
    const background = createNode('rectangle', { id: 'page-backdrop', width: 60, height: 40, fill: '#778899' });
    const svg = exportPageToSvg({ id: 'paint-blend-page', children: [background, node] });
    assert.ok(svg.indexOf('data-tiny-image-star-node-id="page-backdrop"') < svg.indexOf(`data-tiny-image-star-node-id="paint-mode-${blendMode}"`),
      'earlier page content remains before the blended node as its SVG backdrop');
    assert.match(svg, new RegExp(`<g opacity="1" data-tiny-image-star-type="rectangle" data-tiny-image-star-node-id="paint-mode-${blendMode}"`),
      'the layer remains a normal SVG group so its paint elements can see the scene backdrop');
    assert.doesNotMatch(svg, /isolation:\s*isolate/, 'paint serialization must not isolate the backdrop');
    assert.ok(svg.indexOf('data-tiny-image-star-fill-id="base-paint"') < svg.indexOf('data-tiny-image-star-fill-id="blended-paint"'));
    assert.ok(svg.indexOf('data-tiny-image-star-fill-id="blended-paint"') < svg.indexOf('data-tiny-image-star-stroke-id="blended-stroke"'),
      'fills retain their order and strokes remain above the fill stack');
    if (blendMode === 'normal') {
      assert.doesNotMatch(svg, /data-tiny-image-star-fill-id="blended-paint"[^>]*style="mix-blend-mode:normal"/);
      assert.doesNotMatch(svg, /data-tiny-image-star-stroke-id="blended-stroke"[^>]*style="mix-blend-mode:normal"/);
    } else {
      assert.match(svg, new RegExp(`data-tiny-image-star-fill-id="blended-paint"[^>]*style="mix-blend-mode:${blendMode}"`));
      assert.match(svg, new RegExp(`data-tiny-image-star-stroke-id="blended-stroke"[^>]*style="mix-blend-mode:${blendMode}"`));
    }
  }
});

test('vector network fill and stroke Paint blend modes remain editable and ordered', () => {
  const network = createNode('network', {
    id: 'network-paint-blends', width: 30, height: 20,
    vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: .5, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'ca', from: 'c', to: 'a' }],
    faces: [{ id: 'face', vertexIds: ['a', 'b', 'c'] }],
    fills: [
      createFillLayer('solid', { id: 'network-base', color: '#123456' }),
      createFillLayer('solid', { id: 'network-overlay', color: '#abcdef', blendMode: 'screen' })
    ],
    strokes: [{
      id: 'network-outline', color: '#fedcba', width: 2, opacity: 1, visible: true,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10, blendMode: 'overlay'
    }]
  });
  const svg = exportNodeToSvg(network);
  assert.match(svg, /data-tiny-image-star-fill-id="network-base"[\s\S]*data-tiny-image-star-fill-id="network-overlay"[^>]*style="mix-blend-mode:screen"[\s\S]*data-tiny-image-star-stroke-id="network-outline"[^>]*style="mix-blend-mode:overlay"/);
  assert.doesNotMatch(svg, /isolation:\s*isolate/);
});

test('SVG paint blends fail closed when node or ancestor effects would isolate their backdrop', () => {
  const paint = createFillLayer('solid', { id: 'screen-paint', color: '#abcdef', blendMode: 'screen' });
  const isolatedCases = [
    createNode('rectangle', { id: 'opacity-parent', opacity: .5, fills: [paint] }),
    createNode('rectangle', { id: 'blend-parent', blendMode: 'multiply', fills: [paint] }),
    createNode('rectangle', { id: 'filter-parent', effects: [createLayerEffect('layer-blur')], fills: [paint] }),
    createNode('frame', { id: 'ancestor-opacity', opacity: .5, children: [createNode('rectangle', { fills: [paint] })] })
  ];
  for (const node of isolatedCases) {
    assert.throws(() => exportNodeToSvg(node), error => error instanceof SvgExportError
      && error.feature.includes('isolated SVG layer boundary'), `must reject ${node.id} rather than silently changing the paint backdrop`);
  }
});

test('SVG export rejects unsupported per-fill and per-stroke blend modes instead of silently normalizing them', () => {
  const invalidFill = createNode('rectangle', {
    name: 'invalid paint', fills: [createFillLayer('solid', { id: 'bad-fill', color: '#123456', blendMode: 'pass-through' })]
  });
  assert.throws(() => exportNodeToSvg(invalidFill), /supported fill blend mode/);

  const invalidStroke = createNode('rectangle', {
    name: 'invalid outline', strokes: [{
      id: 'bad-stroke', color: '#123456', width: 2, opacity: 1, visible: true,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10, blendMode: 'vivid-light'
    }]
  });
  assert.throws(() => exportNodeToSvg(invalidStroke), /supported stroke blend mode/);
});

test('serializes vector network fill stacks per face and emits network edges once', () => {
  const gradient = createGradientFill('radial', '#0033ff');
  const network = createNode('network', {
    id: 'stacked-network', width: 80, height: 60, stroke: '#123456', strokeWidth: 2,
    vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: .5, y: 1 }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'ca', from: 'c', to: 'a' }],
    faces: [{ id: 'triangle', vertexIds: ['a', 'b', 'c'], fill: '#00ff00', fillOpacity: .5 }],
    fills: [
      createFillLayer('solid', { id: 'base-solid', color: '#ff0000', opacity: .4 }),
      createFillLayer('radial', { id: 'gradient-overlay', gradient, opacity: .2 }),
      createFillLayer('image', {
        id: 'image-overlay', opacity: .3,
        imageFill: {
          assetId: 'network-photo', fit: 'cover',
          transforms: { crop: { left: .1, top: .25, right: .9, bottom: .75 }, rotation: 90 },
          adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0, blur: 0 }
        }
      }),
    ]
  });
  const assets = new Map([['network-photo', {
    id: 'network-photo', type: 'image/png', width: 400, height: 200,
    sourceBytes: new Uint8Array([0, 1])
  }]]);
  const svg = exportNodeToSvg(network, { assets });

  assert.match(svg, /data-tiny-image-star-face-id="triangle"[^>]*fill="#00ff00" fill-opacity="0\.2" data-tiny-image-star-fill-id="base-solid"/);
  assert.match(svg, /fill="url\(#tis-gradient-0-fill-1\)" fill-opacity="0\.1" data-tiny-image-star-fill-id="gradient-overlay"/);
  assert.match(svg, /<g data-tiny-image-star-fill-id="image-overlay" data-tiny-image-star-fill-type="image" opacity="0\.15" clip-path="url\(#tis-fill-clip-0-2-0\)" data-tiny-image-star-face-id="triangle"><image x="0" y="0" width="400" height="200" preserveAspectRatio="none" transform="matrix\(0 0\.8 -0\.8 0 120 -130\)" href="data:image\/png;base64,AAE="\/><\/g>/);
  assert.equal((svg.match(/data-tiny-image-star-edge-id=/g) || []).length, 3, 'network edges should be serialized once after all face fills');
});

test('serializes transformed image fills in explicit fill stacks against the original source', () => {
  const source = new Map([['photo', {
    type: 'image/jpeg', sourceWidth: 400, sourceHeight: 200,
    bitmap: { width: 1200, height: 600 }, sourceBytes: new Uint8Array([4, 5])
  }]]);
  const shape = createNode('rectangle', {
    width: 90, height: 60,
    fills: [createFillLayer('image', {
      id: 'cropped-fill', opacity: .7,
      imageFill: {
        assetId: 'photo', fit: 'contain',
        transforms: { crop: { left: 0, top: 0, right: .5, bottom: 1 }, rotation: 0 },
        adjustments: { brightness: 0, contrast: 0, saturation: 0, sharpness: 0, blur: 0 }
      }
    })]
  });
  const svg = exportNodeToSvg(shape, { assets: source });
  assert.match(svg, /<g data-tiny-image-star-fill-id="cropped-fill" data-tiny-image-star-fill-type="image" opacity="0\.7" clip-path="url\(#tis-fill-clip-0\)"><image x="0" y="0" width="400" height="200" preserveAspectRatio="none" transform="matrix\(0\.3 0 0 0\.3 15 0\)" href="data:image\/jpeg;base64,BAU="\/><\/g>/);
});

test('explicit image fills sharing a source keep per-layer previews isolated and untouched bytes intact', () => {
  const assets = new Map([['same-source', {
    id: 'same-source', type: 'image/jpeg', width: 20, height: 10,
    sourceBytes: new Uint8Array([9, 8, 7])
  }]]);
  const edited = createNode('rectangle', {
    id: 'shared-fill-edited', width: 80, height: 50,
    fills: [createFillLayer('image', {
      id: 'edited-image-fill', imageFill: createImageFill('same-source'), opacity: 0.7
    })]
  });
  const untouched = createNode('rectangle', {
    id: 'shared-fill-untouched', x: 100, width: 80, height: 50,
    fills: [createFillLayer('image', {
      id: 'untouched-image-fill', imageFill: createImageFill('same-source'), opacity: 0.45
    })]
  });
  const svg = exportPageToSvg({ children: [edited, untouched] }, {
    assets,
    imagePreviews: new Map([[imagePreviewKey(edited.id, edited.fills[0].id), {
      type: 'image/png', sourceBytes: new Uint8Array([31, 32, 33]), width: 20, height: 10
    }]])
  });
  const bodyFor = nodeId => {
    const escapedId = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = svg.match(new RegExp(`<g[^>]*data-tiny-image-star-node-id="${escapedId}"[^>]*>([\\s\\S]*?)<\\/g>`));
    assert.ok(match, `expected SVG group for ${nodeId}`);
    return match[1];
  };

  assert.match(bodyFor(edited.id), /href="data:image\/png;base64,HyAh"[^>]*opacity="0\.7"/);
  assert.match(bodyFor(untouched.id), /href="data:image\/jpeg;base64,CQgH"[^>]*opacity="0\.45"/);
});

test('SVG uses a fill-id preview for an edited image fill after it is reordered below another fill', () => {
  const sourceAssetId = 'edited-shared-source';
  const editedFill = createFillLayer('image', {
    id: 'edited-fill-secondary',
    imageFill: createImageFill(sourceAssetId, {
      fit: 'contain',
      adjustments: { brightness: 24, contrast: -12, saturation: 5, sharpness: 8, blur: 0 },
      transforms: { crop: { left: 0.2, top: 0.1, right: 0.9, bottom: 0.95 }, rotation: 90 }
    }),
    opacity: 0.65
  });
  const node = createNode('rectangle', {
    id: 'edited-fill-stack', width: 120, height: 80,
    fills: [
      editedFill,
      createFillLayer('solid', { id: 'solid-primary', color: '#13579b', opacity: 0.8 })
    ]
  });
  assert.equal(moveFillLayer(node, editedFill.id, 'down'), true);
  assert.deepEqual(node.fills.map(fill => fill.id), ['solid-primary', editedFill.id]);

  const svg = exportNodeToSvg(node, {
    assets: new Map([[sourceAssetId, {
      id: sourceAssetId, type: 'image/jpeg', width: 40, height: 30,
      sourceBytes: new Uint8Array([1, 2, 3])
    }]]),
    // Explicit image-fill previews are keyed by fill identity so multiple
    // independently edited fills can share one source asset.
    imagePreviews: new Map([[imagePreviewKey(node.id, editedFill.id), {
      type: 'image/png', sourceBytes: new Uint8Array([0xaa, 0xbb, 0xcc]), width: 18, height: 28
    }]])
  });

  assert.match(svg, /href="data:image\/png;base64,qrvM"[^>]*opacity="0\.65"[^>]*data-tiny-image-star-fill-id="edited-fill-secondary"/);
  assert.doesNotMatch(svg, /data:image\/jpeg;base64,AQID/, 'the edited fill should not silently fall back to shared source bytes');
});

test('SVG export ignores hidden invalid image fills when another fill remains visible', () => {
  const node = createNode('rectangle', {
    id: 'hidden-missing-image-fill', width: 100, height: 60,
    fills: [
      createFillLayer('image', {
        id: 'hidden-missing-fill',
        imageFill: createImageFill('missing-local-source'),
        visible: false
      }),
      createFillLayer('solid', { id: 'visible-solid-fill', color: '#2468ac', opacity: 0.75 })
    ]
  });

  const svg = exportNodeToSvg(node, { assets: new Map() });
  assert.match(svg, /fill="#2468ac" fill-opacity="0\.75"/);
  assert.doesNotMatch(svg, /hidden-missing-fill|image fills|<image\b/);
});

test('rejects unavailable, unsafe, or adjusted raster sources explicitly', () => {
  const missing = createNode('image', { assetId: 'not-local' });
  assert.throws(() => exportNodeToSvg(missing, { assets: new Map() }), error => error instanceof SvgExportError && error.feature === 'image layers');

  const svgSource = new Map([['unsafe', { type: 'image/svg+xml', sourceBytes: new TextEncoder().encode('<svg/>'), width: 1, height: 1 }]]);
  assert.throws(() => exportNodeToSvg(createNode('rectangle', {
    imageFill: { assetId: 'unsafe', fit: 'cover', adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 } }
  }), { assets: svgSource }), error => error instanceof SvgExportError && error.feature === 'image fills');

  const adjusted = createNode('image', {
    assetId: 'local', adjustments: { brightness: 12, contrast: 0, saturation: 0, blur: 0 }
  });
  const assets = new Map([['local', { type: 'image/png', sourceBytes: new Uint8Array([1]), width: 1, height: 1 }]]);
  assert.throws(() => exportNodeToSvg(adjusted, { assets }), error => error instanceof SvgExportError && error.feature === 'raster image adjustments');
  assert.match(exportNodeToSvg(adjusted, {
    assets,
    imagePreviews: new Map([[adjusted.id, { type: 'image/png', sourceBytes: new Uint8Array([2]), width: 1, height: 1 }]])
  }), /href="data:image\/png;base64,Ag=="/);

  const dimensionedAssets = new Map([['local', {
    type: 'image/png', sourceBytes: new Uint8Array([1]), sourceWidth: 400, sourceHeight: 200,
    bitmap: { width: 1200, height: 600 }
  }]]);
  const cropped = createNode('image', {
    assetId: 'local', width: 120, height: 80,
    transforms: { crop: { left: 0.1, top: 0.25, right: 0.9, bottom: 0.75 }, rotation: 90 }
  });
  const croppedSvg = exportNodeToSvg(cropped, { assets: dimensionedAssets });
  assert.match(croppedSvg, /<g clip-path="url\(#tis-image-clip-0\)"><image x="0" y="0" width="400" height="200" preserveAspectRatio="none" transform="matrix\(0 1\.2 -1\.2 0 180 -200\)" href="data:image\/png;base64,AQ=="\/><\/g>/,
    'crop and rotation transform the source image while keeping the target clip stationary');
  const rotated = createNode('rectangle', { imageFill: { assetId: 'local', fit: 'cover', transforms: { crop: null, rotation: 90 }, adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 } } });
  const rotatedSvg = exportNodeToSvg(rotated, { assets: dimensionedAssets });
  assert.match(rotatedSvg, /transform="matrix\(0 0\.6 -0\.6 0 120 -80\)"/);
  for (const [rotation, matrix] of [
    [180, 'matrix(-0.2 0 0 -0.2 80 80)'],
    [270, 'matrix(0 -0.3 0.3 0 10 120)']
  ]) {
    const quarterTurn = createNode('image', {
      assetId: 'local', width: 80, height: 120, fit: 'contain',
      transforms: { crop: null, rotation }
    });
    assert.ok(exportNodeToSvg(quarterTurn, { assets: dimensionedAssets }).includes(`transform="${matrix}"`), `rotation ${rotation} should use the expected fitted matrix`);
  }
  assert.match(exportNodeToSvg(rotated, {
    assets,
    imagePreviews: new Map([[rotated.id, { type: 'image/png', sourceBytes: new Uint8Array([3]), width: 1, height: 1 }]])
  }), /href="data:image\/png;base64,Aw=="/);

  const mirrored = createNode('image', {
    assetId: 'local', width: 100, height: 100, fit: 'contain',
    transforms: { crop: null, rotation: 0, flipHorizontal: true },
  });
  assert.match(exportNodeToSvg(mirrored, { assets: dimensionedAssets }), /transform="matrix\(-0\.25 0 0 0\.25 100 25\)"/,
    'horizontal mirroring reflects the fitted image inside the fixed target clip');
  mirrored.transforms = { crop: null, rotation: 90, flipVertical: true };
  assert.match(exportNodeToSvg(mirrored, { assets: dimensionedAssets }), /transform="matrix\(0 -0\.25 -0\.25 0 75 100\)"/,
    'vertical mirroring composes with the clockwise rotation matrix');
  const previewSvg = exportNodeToSvg(mirrored, {
    assets: dimensionedAssets,
    imagePreviews: new Map([[mirrored.id, { type: 'image/png', sourceBytes: new Uint8Array([9]), width: 200, height: 400 }]]),
  });
  assert.match(previewSvg, /href="data:image\/png;base64,CQ=="/);
  assert.doesNotMatch(previewSvg, /<image[^>]*transform="matrix\(/,
    'an already mirrored Pillow-RS preview is not flipped twice during SVG export');
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
  assert.match(textSvg, /viewBox="0 -1\.5 20 26\.5"/);
  assert.match(textSvg, /<tspan x="0" y="0" textLength="20" lengthAdjust="spacingAndGlyphs">WI<\/tspan><tspan x="0" y="12\.5" textLength="20" lengthAdjust="spacingAndGlyphs">DE<\/tspan>/,
    'long unbroken text wraps at grapheme-safe boundaries instead of compressing to one line');
  assert.match(textSvg, /<path d="M 0 10\.3 L 20 10\.3"/);
  assert.match(textSvg, /<path d="M 0 22\.8 L 20 22\.8"/);

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

test('SVG ending truncation emits fitting ellipses and clips every paint stack to the text box', () => {
  const text = createNode('text', {
    id: 'truncated-label', width: 20, height: 10, fontSize: 10, lineHeight: 1,
    text: 'abcdef', textFit: 'fixed', textTruncation: 'ending', maxLines: 1,
    fills: [
      { id: 'first-fill', type: 'solid', color: '#123456', opacity: 1, visible: true },
      { id: 'second-fill', type: 'solid', color: '#abcdef', opacity: 1, visible: true }
    ],
    textRuns: [{ text: 'abc' }, { text: 'def', fontWeight: 700 }]
  });
  const svg = exportNodeToSvg(text, { measureText: value => [...String(value)].length * 10 });
  assert.match(svg, /<tspan[^>]*>a…<\/tspan>/);
  assert.match(svg, /clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="20" height="10"\//);
  assert.match(svg, /clip-path="url\(#tis-text-clip-truncated-label-fill-0\)"/);
  assert.match(svg, /clip-path="url\(#tis-text-clip-truncated-label-fill-1\)"/);
  assert.match(svg, /clip-path="url\(#tis-text-clip-truncated-label-outline\)"/);
  assert.equal(new Set([...svg.matchAll(/id="(tis-text-clip-[^"]+)"/gu)].map(match => match[1])).size, 3,
    'each stacked fill and outline gets an unambiguous local clip path');
});

test('SVG preserves justified spacing on soft-wrapped plain and rich text lines', () => {
  const measureText = value => value.length * 5;
  const plain = createNode('text', { width: 35, height: 40, fontSize: 10, lineHeight: 1.25, text: 'aa bb cc', align: 'justify', textFit: 'fixed' });
  const plainSvg = exportNodeToSvg(plain, { measureText });
  assert.match(plainSvg, /<tspan x="0" y="0" word-spacing="10">aa bb<\/tspan>/);
  assert.match(plainSvg, /<tspan x="0" y="12\.5" textLength="10" lengthAdjust="spacingAndGlyphs">cc<\/tspan>/,
    'the final paragraph line remains natural instead of being stretched');

  const rich = createNode('text', {
    width: 35, height: 40, fontSize: 10, lineHeight: 1.25, text: 'aa bb cc', align: 'justify', textFit: 'fixed',
    textRuns: [{ text: 'aa ' }, { text: 'bb cc', fontWeight: 700 }]
  });
  const richSvg = exportNodeToSvg(rich, { measureText });
  assert.match(richSvg, /<tspan x="0" y="0" word-spacing="10"><tspan font-family=/);
  assert.doesNotMatch(richSvg, /<tspan x="0" y="0"[^>]*textLength=/,
    'word spacing supplies the justified width without glyph scaling');

  const repeatedSpaces = createNode('text', {
    width: 45, height: 40, fontSize: 10, lineHeight: 1.25, text: 'aa   bb cc', align: 'justify', textFit: 'fixed'
  });
  assert.match(exportNodeToSvg(repeatedSpaces, { measureText }), /word-spacing="3\.33333333333"/,
    'SVG word spacing accounts for each preserved space in a multi-space gap');
});

test('SVG text export preserves leading, repeated, and trailing spaces for plain and rich text', () => {
  const source = '  spaced   words  ';
  const plain = createNode('text', {
    width: 200, height: 30, fontSize: 10, lineHeight: 1, text: source, textFit: 'fixed'
  });
  const plainSvg = exportNodeToSvg(plain, { measureText: value => [...value].length * 5 });
  assert.match(plainSvg, /xml:space="preserve"/);
  assert.match(plainSvg, /<tspan x="0" y="0" textLength="90" lengthAdjust="spacingAndGlyphs">  spaced   words  <\/tspan>/);

  const rich = createNode('text', {
    width: 200, height: 30, fontSize: 10, lineHeight: 1, text: source, textFit: 'fixed',
    textRuns: [{ text: '  spaced   ', fontWeight: 700 }, { text: 'words  ' }]
  });
  const richSvg = exportNodeToSvg(rich, { measureText: value => [...value].length * 5 });
  assert.match(richSvg, /xml:space="preserve"/);
  assert.match(richSvg, />  spaced   <\/tspan>/);
  assert.match(richSvg, />words  <\/tspan>/);
});

test('SVG output applies vertical text alignment to plain and rich runs, including decoration geometry', () => {
  const plain = createNode('text', {
    width: 100, height: 100, fontSize: 10, lineHeight: 1, text: 'one\ntwo',
    textFit: 'fixed', verticalAlign: 'bottom', textDecoration: 'underline'
  });
  const plainSvg = exportNodeToSvg(plain, { measureText: value => [...value].length * 5 });
  assert.match(plainSvg, /<tspan x="0" y="80" textLength="15" lengthAdjust="spacingAndGlyphs">one<\/tspan>/);
  assert.match(plainSvg, /<tspan x="0" y="90" textLength="15" lengthAdjust="spacingAndGlyphs">two<\/tspan>/);
  assert.match(plainSvg, /<path d="M 0 100\.3 L 15 100\.3"/);
  assert.match(plainSvg, /viewBox="0 0 100 102\.5"/, 'export bounds should include the bottom-aligned text glyphs');

  const rich = createNode('text', {
    width: 100, height: 100, fontSize: 10, lineHeight: 1.25, text: 'one\ntwo',
    textFit: 'fixed', verticalAlign: 'middle',
    textRuns: [{ text: 'one\ntwo' }]
  });
  const richSvg = exportNodeToSvg(rich, { measureText: (value, node) => [...value].length * Number(node.fontSize) * .5 });
  assert.match(richSvg, /<tspan x="0" y="37\.5" textLength="15" lengthAdjust="spacingAndGlyphs">/);
  assert.match(richSvg, /<tspan x="0" y="50" textLength="15" lengthAdjust="spacingAndGlyphs">/);
});

test('exports mixed text runs with matching font metrics, wrapping, colors, and per-run decoration', () => {
  const text = createNode('text', {
    width: 35, height: 45, fontSize: 10, lineHeight: 1.25, align: 'center',
    color: '#123456', text: 'ab cd', textFit: 'fixed',
    textRuns: [
      { text: 'ab ' },
      { text: 'cd', fontSize: 20, fontWeight: 700, lineHeight: 1.5, color: '#ff2200', textDecoration: 'underline' }
    ]
  });
  const measureText = (value, node) => [...value].length * Number(node.fontSize) * .6;
  const svg = exportNodeToSvg(text, { measureText });

  assert.match(svg, /<tspan x="17\.5" y="0" textLength="12" lengthAdjust="spacingAndGlyphs"><tspan font-family="Inter, Arial, sans-serif" font-size="10" font-weight="400" font-style="normal" letter-spacing="0" fill="#123456">ab<\/tspan><\/tspan>/);
  assert.match(svg, /<tspan x="17\.5" y="12\.5" textLength="24" lengthAdjust="spacingAndGlyphs"><tspan font-family="Inter, Arial, sans-serif" font-size="20" font-weight="700" font-style="normal" letter-spacing="0" fill="#ff2200">cd<\/tspan><\/tspan>/);
  assert.match(svg, /<path d="M 5\.5 33\.1 L 29\.5 33\.1" fill="none" stroke="#ff2200" stroke-opacity="1" stroke-width="1\.25"\/>/);
  assert.match(svg, /viewBox="0 -1\.5 35 46\.5"/);
});

test('SVG text fill stacks retain rich typography and paint order for solid, gradient, and image glyph paints', () => {
  const text = createNode('text', {
    id: 'stacked-text', name: 'Stacked text', width: 90, height: 32, fontSize: 12,
    text: 'Brand title', textFit: 'fixed',
    textRuns: [
      { text: 'Brand ', fontFamily: 'Display Sans', fontWeight: 600, fontStyle: 'italic', color: '#112233' },
      { text: 'title', fontFamily: 'Body Sans', fontWeight: 400, letterSpacing: 0.5, color: '#445566' }
    ],
    fills: [
      createFillLayer('solid', { id: 'text-solid', color: '#123456', opacity: 0.9 }),
      createFillLayer('linear', {
        id: 'text-gradient', opacity: 0.7, blendMode: 'screen',
        gradient: createGradientFill('linear', '#ff0000')
      }),
      createFillLayer('image', {
        id: 'text-image', opacity: 0.5, blendMode: 'multiply',
        imageFill: createImageFill('text-photo', { fit: 'cover' })
      })
    ]
  });
  const assets = new Map([['text-photo', {
    id: 'text-photo', type: 'image/png', width: 120, height: 80, sourceBytes: new Uint8Array([1, 2, 3])
  }]]);
  const svg = exportNodeToSvg(text, { assets, measureText: value => [...value].length * 6 });
  const solidIndex = svg.indexOf('data-tiny-image-star-fill-id="text-solid"');
  const gradientIndex = svg.indexOf('data-tiny-image-star-fill-id="text-gradient"');
  const imageIndex = svg.indexOf('data-tiny-image-star-fill-id="text-image"');
  assert.ok(solidIndex >= 0 && solidIndex < gradientIndex && gradientIndex < imageIndex,
    'text fill paints remain ordered as authored');
  assert.match(svg, /<g data-tiny-image-star-fill-id="text-gradient" data-tiny-image-star-fill-type="linear" style="mix-blend-mode:screen"><text[^>]*fill="url\(#tis-gradient-0-fill-1\)" fill-opacity="0\.7"/);
  assert.match(svg, /<pattern id="tis-text-image-fill-0-2" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" x="0" y="0" width="90" height="32"><image[^>]*href="data:image\/png;base64,AQID"/);
  assert.match(svg, /<g data-tiny-image-star-fill-id="text-image" data-tiny-image-star-fill-type="image" style="mix-blend-mode:multiply"><text[^>]*fill="url\(#tis-text-image-fill-0-2\)" fill-opacity="0\.5"/);
  for (const [family, weight, content] of [['Display Sans', '600', 'Brand '], ['Body Sans', '400', 'title']]) {
    assert.ok((svg.match(new RegExp(`font-family="${family}" font-size="12" font-weight="${weight}"`, 'gu')) || []).length >= 3,
      `${family} typography remains on each repeated paint run`);
    assert.ok((svg.match(new RegExp(`>${content.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}<\\/tspan>`, 'gu')) || []).length >= 3,
      `${family} text content remains editable in each paint run`);
  }
});

test('SVG text stroke stacks outline glyphs above all fill paints, including gradients', () => {
  const text = createNode('text', {
    id: 'outlined-text', width: 100, height: 30, fontSize: 14, text: 'Outlined', textFit: 'fixed',
    fills: [createFillLayer('solid', { id: 'text-fill', color: '#123456' })],
    strokes: [
      { id: 'text-outline', color: '#ff0000', width: 1, opacity: 0.8, visible: true, cap: 'round', join: 'round', pattern: 'solid', miterLimit: 10 },
      { id: 'text-gradient-outline', color: '#00ff00', width: 2, opacity: 0.6, visible: true, cap: 'butt', join: 'miter', pattern: 'dashed', miterLimit: 10, gradient: createGradientFill('linear', '#00ff00') }
    ]
  });
  const svg = exportNodeToSvg(text, { measureText: value => [...value].length * 7 });
  const fillIndex = svg.indexOf('data-tiny-image-star-fill-id="text-fill"');
  const firstStrokeIndex = svg.indexOf('data-tiny-image-star-stroke-id="text-outline"');
  const gradientStrokeIndex = svg.indexOf('data-tiny-image-star-stroke-id="text-gradient-outline"');
  assert.ok(fillIndex >= 0 && fillIndex < firstStrokeIndex && firstStrokeIndex < gradientStrokeIndex,
    'glyph strokes are emitted in order after all fill paints');
  assert.match(svg, /<text[^>]*data-tiny-image-star-stroke-id="text-outline"[^>]*fill="none" fill-opacity="0" stroke="#ff0000" stroke-opacity="0\.8" stroke-width="1"[^>]*>[^<]*<tspan[^>]*>Outlined<\/tspan><\/text>/);
  assert.match(svg, /<text[^>]*data-tiny-image-star-stroke-id="text-gradient-outline"[^>]*stroke="url\(#tis-gradient-0-stroke-1\)" stroke-opacity="0\.6" stroke-width="2"[^>]*stroke-dasharray="8 4"/);
  assert.doesNotMatch(svg, /<rect[^>]*stroke="(?:#ff0000|url\(#tis-gradient-0-stroke-1\))/,
    'text stroke paints outline the glyphs instead of the text box');

  const scalarStroke = createNode('text', {
    id: 'legacy-text-outline', width: 100, height: 30, fontSize: 14, text: 'Legacy',
    stroke: '#abcdef', strokeWidth: 3
  });
  const legacySvg = exportNodeToSvg(scalarStroke, { measureText: value => [...value].length * 7 });
  assert.match(legacySvg, /<text[^>]*stroke="#abcdef"[^>]*stroke-width="3"/);
  assert.doesNotMatch(legacySvg, /<rect[^>]*stroke="#abcdef"/);
});

test('SVG text paint stacks fail closed for invalid or unrenderable paints', () => {
  const invalid = createNode('text', {
    id: 'invalid-text-stack', fills: [createFillLayer('solid', { id: 'bad-text-paint', color: '#123456', blendMode: 'pass-through' })]
  });
  assert.throws(() => exportNodeToSvg(invalid), /supported fill blend mode/);

  const angular = createNode('text', {
    id: 'angular-text-stack', width: 40, height: 20, text: 'Angle',
    fills: [createFillLayer('angular', { id: 'angular-text-paint', gradient: createGradientFill('angular', '#123456') })]
  });
  assert.throws(() => exportNodeToSvg(angular, { measureText: value => value.length * 5 }), error =>
    error instanceof SvgExportError && /angular gradients/.test(error.feature));

  const malformedStroke = createNode('text', {
    id: 'malformed-text-stroke', text: 'No outline', strokes: [{ id: 'bad-stroke' }]
  });
  assert.throws(() => exportNodeToSvg(malformedStroke), error =>
    error instanceof SvgExportError && error.feature === 'invalid text stroke stacks');
});

test('paragraph spacing and first-line indentation match plain and rich SVG text geometry', () => {
  const wrappedPlain = createNode('text', {
    width: 50, height: 20, fontSize: 10, lineHeight: 1, text: 'one two',
    textFit: 'fixed', firstLineIndent: 20
  });
  const wrappedPlainSvg = exportNodeToSvg(wrappedPlain, { measureText: value => value.length * 5 });
  assert.match(wrappedPlainSvg, /<tspan x="20" y="0" textLength="15" lengthAdjust="spacingAndGlyphs">one<\/tspan>/);
  assert.match(wrappedPlainSvg, /<tspan x="0" y="10" textLength="15" lengthAdjust="spacingAndGlyphs">two<\/tspan>/);

  const plain = createNode('text', {
    width: 50, height: 20, fontSize: 10, lineHeight: 1, text: 'a\n\nb',
    textFit: 'fixed', paragraphSpacing: 15, firstLineIndent: 10, textDecoration: 'underline'
  });
  const plainSvg = exportNodeToSvg(plain, { measureText: value => value.length * 5 });
  assert.match(plainSvg, /<tspan x="10" y="0" textLength="5" lengthAdjust="spacingAndGlyphs">a<\/tspan>/);
  assert.match(plainSvg, /<tspan x="0" y="25"><\/tspan>/, 'the empty paragraph keeps its vertical position without inheriting indentation');
  assert.match(plainSvg, /<tspan x="10" y="50" textLength="5" lengthAdjust="spacingAndGlyphs">b<\/tspan>/);
  assert.match(plainSvg, /<path d="M 10 10\.3 L 15 10\.3"/);
  assert.match(plainSvg, /<path d="M 10 60\.3 L 15 60\.3"/);
  assert.doesNotMatch(plainSvg, /<path d="M 0 35\.3 L 0 35\.3"/, 'an empty paragraph has no underline');
  assert.match(plainSvg, /viewBox="0 -1\.5 50 64"/, 'bounds include the final paragraph glyphs outside the text box');

  const rich = createNode('text', {
    width: 50, height: 20, fontSize: 10, lineHeight: 1, text: 'a\n\nb',
    textFit: 'fixed', paragraphSpacing: 15, firstLineIndent: 10,
    textRuns: [{ text: 'a\n\nb', textDecoration: 'underline' }]
  });
  const richSvg = exportNodeToSvg(rich, { measureText: (value, node) => value.length * Number(node.fontSize) * .5 });
  assert.match(richSvg, /<tspan x="10" y="0" textLength="5" lengthAdjust="spacingAndGlyphs"><tspan/);
  assert.match(richSvg, /<tspan x="0" y="25"><\/tspan>/);
  assert.match(richSvg, /<tspan x="10" y="50" textLength="5" lengthAdjust="spacingAndGlyphs"><tspan/);
  assert.match(richSvg, /<path d="M 10 10\.3 L 15 10\.3"/);
  assert.match(richSvg, /<path d="M 10 60\.3 L 15 60\.3"/);
  assert.match(richSvg, /viewBox="0 -1\.5 50 64"/);

  const wrappedRich = createNode('text', {
    width: 50, height: 20, fontSize: 10, lineHeight: 1, text: 'one two',
    textFit: 'fixed', firstLineIndent: 20, textRuns: [{ text: 'one two' }]
  });
  const wrappedRichSvg = exportNodeToSvg(wrappedRich, { measureText: (value, node) => value.length * Number(node.fontSize) * .5 });
  assert.match(wrappedRichSvg, /<tspan x="20" y="0" textLength="15" lengthAdjust="spacingAndGlyphs"><tspan/);
  assert.match(wrappedRichSvg, /<tspan x="0" y="10" textLength="15" lengthAdjust="spacingAndGlyphs"><tspan/);

  const trailingEmptyParagraphs = createNode('text', {
    width: 50, height: 20, fontSize: 10, lineHeight: 1, text: 'a\n\n',
    textFit: 'fixed', paragraphSpacing: 15, textDecoration: 'underline'
  });
  const trailingSvg = exportNodeToSvg(trailingEmptyParagraphs, { measureText: value => value.length * 5 });
  assert.match(trailingSvg, /<tspan x="0" y="50"><\/tspan>/);
  assert.match(trailingSvg, /viewBox="0 -1\.5 50 21\.5"/, 'empty trailing paragraphs advance layout but add no painted bounds');
});

test('SVG exports nested list markers as editable positioned text and preserves rich marker styling', () => {
  const plain = createNode('text', {
    text: 'First item\nNested item\nSecond item', width: 150, height: 60,
    fontSize: 10, lineHeight: 1.25, listSpacing: 3,
    paragraphStyles: [
      { listStyle: 'numbered', listLevel: 0, listStart: 4 },
      { listStyle: 'bulleted', listLevel: 1 },
      { listStyle: 'numbered', listLevel: 0 }
    ]
  });
  const svg = exportNodeToSvg(plain, { measureText: value => [...String(value)].length * 5 });
  assert.match(svg, /data-tiny-image-star-list-marker="numbered" data-list-level="0" x="10" y="0" text-anchor="end"[^>]*>4\.<\/tspan>/);
  assert.match(svg, /data-tiny-image-star-list-marker="bulleted" data-list-level="1" x="29" y="15\.5" text-anchor="end"[^>]*>•<\/tspan>/);
  assert.match(svg, /data-tiny-image-star-list-marker="numbered" data-list-level="0" x="10" y="31" text-anchor="end"[^>]*>5\.<\/tspan>/);
  assert.match(svg, /<tspan x="18" y="0"[^>]*>First item<\/tspan>/, 'text content starts after the marker column');

  const rich = createNode('text', {
    text: 'Bold item\nNormal item', width: 150, height: 60, fontSize: 10,
    paragraphStyles: [{ listStyle: 'bulleted', listLevel: 0 }, { listStyle: 'bulleted', listLevel: 0 }],
    textRuns: [{ text: 'Bold', fontWeight: 700, color: '#aa2211' }, { text: ' item\nNormal item' }]
  });
  const richSvg = exportNodeToSvg(rich, { measureText: (value, node) => [...String(value)].length * (Number(node.fontWeight) === 700 ? 6 : 5) });
  assert.match(richSvg, /data-tiny-image-star-list-marker="bulleted" data-list-level="0"[^>]*font-weight="700"[^>]*fill="#aa2211"[^>]*>•<\/tspan>/,
    'rich list markers inherit the paragraph’s first text run style');
  assert.match(richSvg, /<tspan font-family="Inter, Arial, sans-serif" font-size="10" font-weight="700"[^>]*>Bold<\/tspan>/);

  const emptyItem = createNode('text', {
    text: '', width: 80, height: 16, fontSize: 10,
    paragraphStyles: [{ listStyle: 'bulleted', listLevel: 0 }]
  });
  assert.match(exportNodeToSvg(emptyItem, { measureText: value => [...String(value)].length * 5 }),
    /data-tiny-image-star-list-marker="bulleted"[^>]*>•<\/tspan>/,
    'an empty list item still exports its marker');
});

test('SVG exports per-paragraph alignment for plain and rich text', () => {
  const measureText = (value, node) => [...String(value)].length * Number(node.fontSize) * .5;
  const plain = createNode('text', {
    text: 'left\ncentered\nright', width: 100, height: 40, fontSize: 10, lineHeight: 1,
    paragraphStyles: [
      { listStyle: 'none', listLevel: 0, align: 'left' },
      { listStyle: 'none', listLevel: 0, align: 'center' },
      { listStyle: 'none', listLevel: 0, align: 'right' }
    ]
  });
  const plainSvg = exportNodeToSvg(plain, { measureText });
  assert.match(plainSvg, /<tspan x="0" y="0"[^>]*>left<\/tspan>/);
  assert.match(plainSvg, /<tspan x="50" y="10" text-anchor="middle"[^>]*>centered<\/tspan>/);
  assert.match(plainSvg, /<tspan x="100" y="20" text-anchor="end"[^>]*>right<\/tspan>/);

  const rich = createNode('text', {
    text: 'First\nCentered\nLast', width: 100, height: 40, fontSize: 10, lineHeight: 1, align: 'right',
    paragraphStyles: [
      { listStyle: 'none', listLevel: 0, align: 'left' },
      { listStyle: 'none', listLevel: 0, align: 'center' },
      { listStyle: 'none', listLevel: 0 }
    ],
    textRuns: [{ text: 'First\nCentered\nLast', fontWeight: 700 }]
  });
  const richSvg = exportNodeToSvg(rich, { measureText });
  assert.match(richSvg, /<tspan x="0" y="0" text-anchor="start"[^>]*><tspan/);
  assert.match(richSvg, /<tspan x="50" y="10" text-anchor="middle"[^>]*><tspan/);
  assert.match(richSvg, /<tspan x="100" y="20"[^>]*><tspan/,
    'an omitted paragraph alignment inherits the layer alignment');
});

test('polygon and star point generation matches the editor for fractional counts', () => {
  const polygon = exportNodeToSvg(createNode('polygon', { points: 5.5 }));
  const polygonPoints = polygon.match(/<polygon points="([^"]+)"/)[1].split(' ');
  assert.equal(polygonPoints.length, 6);
  const star = exportNodeToSvg(createNode('star', { points: 5.5 }));
  const starPoints = star.match(/<polygon points="([^"]+)"/)[1].split(' ');
  assert.equal(starPoints.length, 11);
});

test('SVG export honors editable polygon side count and star point depth', () => {
  const polygon = exportNodeToSvg(createNode('polygon', { width: 120, height: 80, points: 7 }));
  const polygonCoordinates = polygon.match(/<polygon points="([^"]+)"/)[1].split(' ');
  assert.equal(polygonCoordinates.length, 7, 'polygon export should use its editable side count');

  const star = exportNodeToSvg(createNode('star', { width: 100, height: 100, points: 8, innerRadius: .25 }));
  const starCoordinates = star.match(/<polygon points="([^"]+)"/)[1].split(' ');
  assert.equal(starCoordinates.length, 16, 'star export should create an inner and outer vertex for each editable point');
  const [innerX, innerY] = starCoordinates[1].split(',').map(Number);
  const innerAngle = -Math.PI / 2 + Math.PI / 8;
  assert.ok(Math.abs(innerX - (50 + Math.cos(innerAngle) * 12.5)) < 1e-8
    && Math.abs(innerY - (50 + Math.sin(innerAngle) * 12.5)) < 1e-8,
  'the inner-radius ratio should affect exported geometry');

  const zeroRadiusStar = exportNodeToSvg(createNode('star', { width: 100, height: 100, points: 3, innerRadius: 0 }));
  assert.equal(zeroRadiusStar.match(/<polygon points="([^"]+)"/)[1].split(' ')[1], '50,50',
    'a zero inner radius should export as an actual center point instead of falling back to the default ratio');

  const maximumStar = exportNodeToSvg(createNode('star', { width: 100, height: 100, points: 60 }));
  assert.equal(maximumStar.match(/<polygon points="([^"]+)"/)[1].split(' ').length, 120,
    'SVG keeps all alternating vertices at the 60-point star limit');
});

test('rejects XML 1.0 forbidden control characters in exported text and names', () => {
  assert.throws(() => exportNodeToSvg(createNode('text', { text: 'Bad\u0001 copy' }), { measureText: value => value.length * 10 }), /characters forbidden by XML 1\.0/);
  assert.throws(() => exportNodeToSvg(createNode('rectangle', { name: 'Bad\u0001 name' })), /characters forbidden by XML 1\.0/);
});
