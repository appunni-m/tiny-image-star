import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, addVariableMode, bindVariable, createDocument, createNode, createVariable, createVariableCollection, setVariableValue } from '../src/model.js';
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

  assert.match(svg, /<mask id="tis-mask-0" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="100" height="80">/);
  assert.match(svg, /<g transform="matrix\([^)]*\)"><ellipse cx="30" cy="25" rx="30" ry="25" fill="#ffffff" fill-opacity="0\.2" stroke="none" stroke-width="0"\/><\/g>/);
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
});

test('reports unsupported alpha-mask source contents precisely', () => {
  const cases = [
    [createNode('text', { id: 'text-mask' }), 'text alpha mask contents'],
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

test('rejects unsupported content explicitly instead of dropping design features', () => {
  const unsupported = [
    [createNode('image'), 'image layers'],
    [createNode('group', { mask: true, maskSourceId: 'mask' }), 'mask groups'],
    [createNode('rectangle', { imageFill: {} }), 'image fills'],
    [createNode('text', { fillGradient: { type: 'linear', angle: 0, stops: [] } }), 'gradient fills'],
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

  const cropped = createNode('image', { assetId: 'local', transforms: { crop: { left: 0.1, top: 0, right: 0.9, bottom: 1 }, rotation: 0 } });
  assert.throws(() => exportNodeToSvg(cropped, { assets }), error => error instanceof SvgExportError && error.feature === 'raster image crop or rotation');
  const rotated = createNode('rectangle', { imageFill: { assetId: 'local', fit: 'cover', transforms: { crop: null, rotation: 90 }, adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 } } });
  assert.throws(() => exportNodeToSvg(rotated, { assets }), error => error instanceof SvgExportError && error.feature === 'raster image crop or rotation');
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
