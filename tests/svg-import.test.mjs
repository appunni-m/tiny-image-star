import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, bindColorVariable, createDocument, createGradientFill, createNode, createVariable, createVariableCollection, parseDocument, serializeDocument } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { importSvgToLayers, SvgImportError } from '../src/svg-import.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { vectorNetworkGeometryFromAnchors } from '../src/vector-path.js';

function allNodes(nodes, output = []) {
  for (const node of nodes) {
    output.push(node);
    allNodes(node.children || [], output);
  }
  return output;
}

function findWithAccumulatedPosition(nodes, name, parentX = 0, parentY = 0) {
  for (const node of nodes) {
    const x = parentX + Number(node.x || 0);
    const y = parentY + Number(node.y || 0);
    if (node.name === name) return { node, x, y };
    const child = findWithAccumulatedPosition(node.children || [], name, x, y);
    if (child) return child;
  }
  return null;
}

function importFailure(markup, code) {
  assert.throws(() => importSvgToLayers(markup), error => {
    assert.ok(error instanceof SvgImportError);
    assert.equal(error.code, code);
    return true;
  });
}

test('imports safe primitive geometry, editable groups, inherited paint and deterministic IDs', () => {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">
    <g id="card-group" transform="translate(12,8)" fill="#336699" fill-opacity=".5" opacity=".8">
      <rect id="card" x="-2" y="4" width="40" height="24" rx="4" stroke="#112233" stroke-width="2"/>
      <circle id="dot" cx="60" cy="20" r="8" fill="rgb(255, 0, 128)"/>
      <ellipse cx="82" cy="18" rx="12" ry="5" fill="none" stroke="#ff0000"/>
      <line x1="2" y1="50" x2="40" y2="60" stroke="#123456"/>
      <polyline points="50,40 60,50 70,40" fill="none" stroke="#222222"/>
      <polygon points="90,40 110,40 100,58" fill="#abc"/>
    </g>
  </svg>`;
  const first = importSvgToLayers(markup);
  const second = importSvgToLayers(markup);
  assert.deepEqual(first, second);
  assert.equal(first.width, 160);
  assert.equal(first.height, 90);
  const nodes = allNodes(first.nodes);
  assert.ok(nodes.some(node => node.type === 'group' && node.name === 'card-group'));
  const card = nodes.find(node => node.name === 'card fill');
  assert.equal(card.type, 'path');
  assert.equal(card.fill, '#336699');
  assert.equal(card.fillOpacity, 0.5);
  assert.equal(nodes.find(node => node.name === 'card-group').opacity, 0.8);
  assert.equal(nodes.find(node => node.name === 'card stroke').strokeWidth, 2);
  assert.ok(nodes.some(node => node.name === 'dot' && node.fill === '#ff0080'));
  assert.ok(nodes.some(node => node.name === 'ellipse 4' && node.stroke === '#ff0000'));
  assert.ok(nodes.some(node => node.name === 'line 5' && node.stroke === '#123456'));
  assert.ok(nodes.some(node => node.name === 'polyline 6' && node.closed === false));
  assert.ok(nodes.some(node => node.name === 'polygon 7' && node.closed === true));
});

test('resolves inherited SVG currentColor for fill and stroke independently of declaration order', () => {
  const nodes = allNodes(importSvgToLayers(`<svg width="100" height="40">
    <g color="#123456">
      <rect id="inherited-fill" width="10" height="10" fill="currentColor"/>
      <rect id="inline-fill" x="12" width="10" height="10" style="fill: currentColor; color: #abcdef"/>
      <g color="rgba(255, 0, 0, .5)">
        <rect id="alpha-fill" x="24" width="10" height="10" fill="currentColor"/>
        <rect id="alpha-stroke" x="36" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"/>
      </g>
    </g>
    <rect id="default-fill" x="48" width="10" height="10" fill="currentColor"/>
  </svg>`).nodes);

  assert.equal(nodes.find(node => node.name === 'inherited-fill')?.fill, '#123456');
  assert.equal(nodes.find(node => node.name === 'inline-fill')?.fill, '#abcdef',
    'the computed color property applies even when it follows fill in the style declaration');
  const alphaFill = nodes.find(node => node.name === 'alpha-fill');
  assert.equal(alphaFill?.fill, '#ff0000');
  assert.equal(alphaFill?.fillOpacity, 0.5);
  const alphaStroke = nodes.find(node => node.name === 'alpha-stroke');
  assert.equal(alphaStroke?.stroke, '#ff0000');
  assert.equal(alphaStroke?.opacity, 0.5);
  assert.equal(nodes.find(node => node.name === 'default-fill')?.fill, '#000000',
    'SVG currentColor defaults to black when no color property is declared');
});

test('maps viewBox, preserveAspectRatio and transforms into path points, including negative coordinates', () => {
  const result = importSvgToLayers(`<svg width="200" height="100" viewBox="-10 -10 100 100" preserveAspectRatio="xMaxYMin meet" transform="translate(3 4)">
    <path d="M -10 -10 C 0 -10 0 0 10 0 L 10 10 Z" fill="#0f0"/>
  </svg>`);
  const path = allNodes(result.nodes).find(node => node.type === 'path');
  assert.equal(path.x, 103);
  assert.equal(path.y, 4);
  assert.equal(path.width, 20);
  assert.equal(path.height, 20);
  assert.equal(path.closed, true);
  assert.deepEqual(result.viewBox, [-10, -10, 100, 100]);

  const nonUniform = importSvgToLayers(`<svg width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="0" y="0" width="10" height="10" fill="#000"/></svg>`);
  const stretched = allNodes(nonUniform.nodes).find(node => node.type === 'path');
  assert.equal(stretched.width, 20);
  assert.equal(stretched.height, 10);
});

test('imports SVG path line, cubic, smooth, quadratic, and arc commands as editable cubic vectors', () => {
  const path = allNodes(importSvgToLayers(`<svg viewBox="0 0 120 100"><path d="M 5 10 h 20 v 10 l -20 0 C 5 40 20 40 25 30 S 45 20 50 30 Q 60 40 70 30 T 90 30 A 12 8 20 0 1 110 45 Z" fill="#abcdef"/></svg>`).nodes)
    .find(node => node.type === 'path');
  assert.equal(path.closed, true);
  assert.equal(path.fill, '#abcdef');
  assert.equal(path.points.length, 10);
  assert.ok(path.points.some(point => point.out));
  assert.ok(path.points.some(point => point.in));
  assert.ok(path.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));

  const compactArc = allNodes(importSvgToLayers(`<svg><path d="M0 0 A10 10 0 0110 20" fill="#000"/></svg>`).nodes)
    .find(node => node.type === 'path');
  assert.equal(compactArc.points.length, 3, 'adjacent arc flags are tokenized as separate SVG flags');
});

test('Tiny Image Star SVG round-trip preserves network topology, controls, face paint, and wrapper transforms', () => {
  const source = createNetworkForSvgRoundTrip();
  const svg = exportNodeToSvg(source);
  const imported = importSvgToLayers(svg);
  const network = allNodes(imported.nodes).find(node => node.type === 'network');
  assert.ok(network, 'the app-marked wrapper is reconstructed as one graph network');
  assert.equal(network.name, 'Branched badge');
  assert.equal(network.vertices.length, 4);
  assert.equal(network.edges.length, 5);
  assert.equal(network.faces.length, 1);
  assert.deepEqual(network.edges.map(edge => [edge.id, edge.from, edge.to]), [
    ['edge-top', 'junction', 'right'], ['edge-right', 'right', 'bottom'],
    ['edge-bottom', 'bottom', 'left'], ['edge-left', 'left', 'junction'],
    ['edge-branch', 'junction', 'bottom']
  ]);
  const angle = Math.PI / 6;
  const mapLocal = ({ x, y }) => ({
    x: Math.cos(angle) * x - Math.sin(angle) * y + 60 - Math.cos(angle) * 60 + Math.sin(angle) * 40,
    y: Math.sin(angle) * x + Math.cos(angle) * y + 40 - Math.sin(angle) * 60 - Math.cos(angle) * 40
  });
  const box = [[0, 0], [120, 0], [120, 80], [0, 80]].map(([x, y]) => mapLocal({ x, y }));
  const minX = Math.min(...box.map(point => point.x)); const minY = Math.min(...box.map(point => point.y));
  const maxX = Math.max(...box.map(point => point.x)); const maxY = Math.max(...box.map(point => point.y));
  const normalizedControl = point => {
    const transformed = mapLocal(point);
    return { x: (transformed.x - minX) / (maxX - minX), y: (transformed.y - minY) / (maxY - minY) };
  };
  for (const [index, point] of [[0, { x: 36, y: -16 }], [1, { x: 86.4, y: -12 }]]) {
    const expected = normalizedControl(point);
    assert.ok(Math.abs(network.edges[0][index === 0 ? 'control1' : 'control2'].x - expected.x) < 1e-10);
    assert.ok(Math.abs(network.edges[0][index === 0 ? 'control1' : 'control2'].y - expected.y) < 1e-10);
  }
  assert.deepEqual(network.faces[0], {
    id: 'face-main', vertexIds: ['junction', 'right', 'bottom', 'left'], fill: '#fedcba', fillOpacity: 0.37
  });

  // The exported layer matrix rotates the graph around its box center. Imported
  // anchors are flattened into the equivalent transformed graph coordinates.
  const byId = new Map(network.vertices.map(vertex => [vertex.id, vertex]));
  const dx = (byId.get('right').x - byId.get('junction').x) * network.width;
  const dy = (byId.get('right').y - byId.get('junction').y) * network.height;
  assert.ok(Math.abs(dx - Math.cos(Math.PI / 6) * 120) < 1e-8);
  assert.ok(Math.abs(dy - Math.sin(Math.PI / 6) * 120) < 1e-8);
  assert.equal(network.rotation, 0);
});

test('foreign SVG paths stay ordinary editable path layers without app network metadata', () => {
  const imported = importSvgToLayers('<svg viewBox="0 0 20 20"><g><path d="M0 0 L10 0 L10 10 Z" fill="#123456"/></g></svg>');
  assert.equal(allNodes(imported.nodes).filter(node => node.type === 'network').length, 0);
  assert.equal(allNodes(imported.nodes).filter(node => node.type === 'path').length, 1);
});

test('imports simple user-space SVG clip paths as editable vector mask groups', () => {
  const result = importSvgToLayers(`<svg width="100" height="60">
    <defs><clipPath id="round-clip" transform="translate(1 2)">
      <g transform="translate(3 4)" clip-rule="evenodd">
        <circle id="clip-circle" cx="20" cy="18" r="10" transform="translate(2 1)" fill="#000" fill-opacity=".1"/>
      </g>
    </clipPath></defs>
    <g id="poster" transform="translate(10 8)" clip-path="url(#round-clip)">
      <rect id="artwork" width="60" height="40" fill="#ff0000"/>
    </g>
  </svg>`);
  const maskGroup = allNodes(result.nodes).find(node => node.type === 'group' && node.mask);
  assert.ok(maskGroup, 'clip-path becomes an editable mask group instead of a flattened bitmap');
  assert.equal(maskGroup.name, 'poster');
  assert.equal(maskGroup.children.length, 2);
  const source = maskGroup.children.find(node => node.id === maskGroup.maskSourceId);
  assert.ok(source);
  assert.equal(source.type, 'path');
  assert.equal(source.name, 'clip-circle clip source');
  assert.equal(source.fill, '#ffffff');
  assert.equal(source.fillOpacity, 1, 'clip geometry is opaque regardless of source paint opacity');
  assert.equal(source.closed, true);
  assert.equal(source.fillRule, 'evenodd', 'inherited clip-rule is retained by the editable vector source');
  assert.deepEqual([source.x, source.y, source.width, source.height], [16, 15, 20, 20],
    'clip-path, nested group, shape, and target transforms are retained in editable geometry');
  const clippedContent = maskGroup.children.find(node => node.id !== maskGroup.maskSourceId);
  assert.equal(clippedContent.type, 'group');
  assert.equal(allNodes([clippedContent]).some(node => node.name === 'artwork' && node.fill === '#ff0000'), true);
  const svg = exportNodeToSvg(maskGroup);
  assert.match(svg, /<mask id="tis-mask-0"/);
  assert.match(svg, /mask="url\(#tis-mask-0\)"/);
  assert.match(svg, /fill="#ffffff" fill-opacity="1"/);
});

test('rejects multi-shape SVG clip paths instead of flattening their union semantics', () => {
  importFailure(`<svg><defs><clipPath id="clip"><circle cx="5" cy="5" r="4"/><rect width="10" height="10"/></clipPath></defs><rect width="10" height="10" clip-path="url(#clip)"/></svg>`, 'unsupported-clip-path');
  importFailure(`<svg><defs><clipPath id="clip"><g><circle cx="5" cy="5" r="4"/><rect width="10" height="10"/></g></clipPath></defs><rect width="10" height="10" clip-path="url(#clip)"/></svg>`, 'unsupported-clip-path');
});

test('round-trips the editor SVG alpha-mask group as editable vector content and source', () => {
  const original = createNode('group', {
    id: 'poster-mask', name: 'Poster mask', width: 100, height: 80, mask: true, maskSourceId: 'oval-mask',
    children: [
      createNode('rectangle', { id: 'poster-art', name: 'Poster art', width: 100, height: 80, fill: '#e34b2f' }),
      createNode('ellipse', { id: 'oval-mask', name: 'Oval mask', x: 10, y: 10, width: 60, height: 50, fill: '#123456' })
    ]
  });
  const imported = importSvgToLayers(exportNodeToSvg(original));
  const group = allNodes(imported.nodes).find(node => node.type === 'group' && node.mask);
  assert.ok(group, 'the mask URL becomes a native editable mask group');
  assert.equal(group.name, 'Poster mask');
  const source = group.children.find(node => node.id === group.maskSourceId);
  assert.equal(source.type, 'path');
  assert.equal(source.fill, '#ffffff');
  assert.deepEqual([source.x, source.y, source.width, source.height], [10, 10, 60, 50]);
  assert.ok(allNodes([group]).some(node => node.name === 'Poster art'));

  const reopened = importSvgToLayers(exportNodeToSvg(group));
  assert.ok(allNodes(reopened.nodes).some(node => node.type === 'group' && node.mask), 'imported editable mask groups can be exported and reopened');
});

test('imports SVG luminance masks with editable source colors and separate fill/stroke opacity', () => {
  const imported = importSvgToLayers(`<svg width="40" height="30" viewBox="0 0 40 30">
    <defs><mask id="soft-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="40" height="30" mask-type="luminance" color-interpolation="sRGB">
      <g opacity=".5"><path d="M 2 2 L 30 2 L 30 20 Z" fill="#808080" fill-opacity=".4" stroke="#00ff00" stroke-opacity=".25" stroke-width="2"/></g>
    </mask></defs>
    <rect id="art" width="40" height="30" fill="#ff0000" mask="url(#soft-mask)"/>
  </svg>`);
  const group = allNodes(imported.nodes).find(node => node.type === 'group' && node.mask);
  assert.ok(group);
  assert.equal(group.maskMode, 'luminance');
  const source = group.children.find(node => node.id === group.maskSourceId);
  assert.equal(source.type, 'path');
  assert.equal(source.fill, '#808080', 'luminance color is retained instead of normalized to white');
  assert.equal(source.fillOpacity, 0.4);
  assert.equal(source.stroke, '#00ff00');
  assert.equal(source.strokeOpacity, 0.25);
  assert.equal(source.strokeWidth, 2);
  assert.equal(source.opacity, 0.5, 'mask group opacity remains a separate paint alpha');
});

test('imports and round-trips supported editable gradients inside SVG luminance masks', () => {
  const imported = importSvgToLayers(`<svg width="30" height="20">
    <defs>
      <linearGradient id="gray-ramp" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="30" y2="0">
        <stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/>
      </linearGradient>
      <mask id="gradient-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="30" height="20" mask-type="luminance">
        <g><rect width="30" height="20" fill="url(#gray-ramp)"/></g>
      </mask>
    </defs>
    <rect width="30" height="20" fill="#ff0000" mask="url(#gradient-mask)"/>
  </svg>`);
  const group = allNodes(imported.nodes).find(node => node.type === 'group' && node.mask);
  const source = group.children.find(node => node.id === group.maskSourceId);
  assert.equal(group.maskMode, 'luminance');
  assert.equal(source.fill, 'transparent');
  assert.equal(source.fillGradient.type, 'linear');
  assert.equal(source.fillGradient.stops.length, 2);

  const reopened = importSvgToLayers(exportNodeToSvg(group));
  const reopenedGroup = allNodes(reopened.nodes).find(node => node.type === 'group' && node.mask);
  const reopenedSource = reopenedGroup.children.find(node => node.id === reopenedGroup.maskSourceId);
  assert.equal(reopenedGroup.maskMode, 'luminance');
  assert.equal(reopenedSource.fillGradient.type, 'linear');
  assert.deepEqual(reopenedSource.fillGradient.stops.map(stop => stop.color), ['#000000', '#ffffff']);
});

test('imports a colored SVG luminance line as an editable line mask source', () => {
  const imported = importSvgToLayers(`<svg width="30" height="20">
    <defs><mask id="line-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="30" height="20" mask-type="luminance">
      <g><line x1="2" y1="18" x2="28" y2="4" stroke="#808080" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/></g>
    </mask></defs>
    <rect width="30" height="20" fill="#ff0000" mask="url(#line-mask)"/>
  </svg>`);
  const group = allNodes(imported.nodes).find(node => node.type === 'group' && node.mask);
  const source = group.children.find(node => node.id === group.maskSourceId);
  assert.equal(group.maskMode, 'luminance');
  assert.equal(source.type, 'line');
  assert.equal(source.lineReverseY, true);
  assert.equal(source.stroke, '#808080');
  assert.equal(source.strokeOpacity, 0.5);
  assert.equal(source.strokeWidth, 4);
  const reopened = importSvgToLayers(exportNodeToSvg(group));
  const reopenedGroup = allNodes(reopened.nodes).find(node => node.type === 'group' && node.mask);
  assert.equal(reopenedGroup.maskMode, 'luminance');
  assert.equal(reopenedGroup.children.find(node => node.id === reopenedGroup.maskSourceId).type, 'line');
});

test('round-trips the editor SVG luminance mask paint through editable source geometry', () => {
  const source = createNode('ellipse', {
    id: 'gray-source', name: 'Gray source', x: 8, y: 6, width: 48, height: 32,
    fill: '#808080', fillOpacity: 0.6, stroke: '#204080', strokeOpacity: 0.35,
    strokeWidth: 3, opacity: 0.75
  });
  const original = createNode('group', {
    id: 'lum-group', name: 'Luminance artwork', width: 80, height: 60,
    mask: true, maskMode: 'luminance', maskSourceId: source.id,
    children: [createNode('rectangle', { id: 'artwork', width: 80, height: 60, fill: '#e34b2f' }), source]
  });
  const first = importSvgToLayers(exportNodeToSvg(original));
  const firstGroup = allNodes(first.nodes).find(node => node.type === 'group' && node.mask);
  assert.ok(firstGroup);
  assert.equal(firstGroup.maskMode, 'luminance');
  const firstSource = firstGroup.children.find(node => node.id === firstGroup.maskSourceId);
  assert.equal(firstSource.fill, '#808080');
  assert.equal(firstSource.fillOpacity, 0.6);
  assert.equal(firstSource.stroke, '#204080');
  assert.equal(firstSource.strokeOpacity, 0.35);
  assert.equal(firstSource.strokeWidth, 3);
  assert.equal(firstSource.opacity, 0.75);

  const reopened = importSvgToLayers(exportNodeToSvg(firstGroup));
  const reopenedGroup = allNodes(reopened.nodes).find(node => node.type === 'group' && node.mask);
  assert.ok(reopenedGroup);
  assert.equal(reopenedGroup.maskMode, 'luminance');
  const reopenedSource = reopenedGroup.children.find(node => node.id === reopenedGroup.maskSourceId);
  assert.equal(reopenedSource.fill, '#808080');
  assert.equal(reopenedSource.stroke, '#204080');
  assert.equal(reopenedSource.fillOpacity, 0.6);
});

test('rejects SVG luminance masks with unsupported linearRGB color interpolation', () => {
  importFailure(`<svg><defs><mask id="mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="10" height="10" mask-type="luminance" color-interpolation="linearRGB"><g><rect width="10" height="10" fill="#808080"/></g></mask></defs><rect width="10" height="10" mask="url(#mask)"/></svg>`, 'unsupported-mask-color-interpolation');
});

test('round-trips an editor Boolean subtract mask into editable operands', () => {
  const original = createNode('boolean', {
    id: 'cutout', name: 'Cutout', operation: 'subtract', width: 100, height: 80, fill: '#4b74c2',
    children: [
      createNode('ellipse', { id: 'base-shape', name: 'Base', x: 5, y: 5, width: 80, height: 70, opacity: 0.6, fillOpacity: 0.5 }),
      createNode('rectangle', { id: 'cutter-shape', name: 'Cutter', x: 35, y: 0, width: 50, height: 80 })
    ]
  });
  const imported = importSvgToLayers(exportNodeToSvg(original));
  const boolean = allNodes(imported.nodes).find(node => node.type === 'boolean');
  assert.ok(boolean, 'the editor result-mask expression is recovered as a live Boolean layer');
  assert.equal(boolean.name, 'Cutout');
  assert.equal(boolean.operation, 'subtract');
  assert.equal(boolean.fill, '#4b74c2');
  assert.equal(boolean.children.length, 2);
  assert.equal(boolean.children[0].fillOpacity * boolean.children[0].opacity, 0.3,
    'the serialized operand preserves the source alpha product');
  const reopened = importSvgToLayers(exportNodeToSvg(boolean));
  const reopenedBoolean = allNodes(reopened.nodes).find(node => node.type === 'boolean');
  assert.equal(reopenedBoolean.operation, 'subtract', 'Boolean cutout remains editable after another SVG round trip');
  assert.equal(reopenedBoolean.children.length, 2);
});

test('reconstructs editor Boolean union and intersection mask graphs', () => {
  for (const operation of ['union', 'intersect']) {
    const original = createNode('boolean', {
      id: `boolean-${operation}`, name: operation, operation, width: 90, height: 60,
      children: [
        createNode('rectangle', { width: 65, height: 55 }),
        createNode('ellipse', { x: 20, y: 5, width: 70, height: 50 })
      ]
    });
    const imported = importSvgToLayers(exportNodeToSvg(original));
    const result = allNodes(imported.nodes).find(node => node.type === 'boolean');
    assert.ok(result);
    assert.equal(result.operation, operation);
    assert.equal(result.children.length, 2);
    const reopened = importSvgToLayers(exportNodeToSvg(result));
    assert.equal(allNodes(reopened.nodes).find(node => node.type === 'boolean').operation, operation);
  }
});

test('rejects external, malformed and unsupported editable mask graphs', () => {
  importFailure(`<svg><rect width="10" height="10" mask="url(https://example.test/mask.svg#mask)"/></svg>`, 'external-reference');
  importFailure(`<svg><rect width="10" height="10" mask="url(#missing-mask)"/></svg>`, 'missing-mask');
  importFailure(`<svg><defs><mask id="mask" maskUnits="objectBoundingBox" maskContentUnits="userSpaceOnUse" x="0" y="0" width="1" height="1"/></defs><rect width="10" height="10" mask="url(#mask)"/></svg>`, 'unsupported-mask-units');
  importFailure(`<svg><defs><mask id="mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="10" height="10"><image href="https://example.test/mask.png"/></mask></defs><rect width="10" height="10" mask="url(#mask)"/></svg>`, 'external-reference');
  importFailure(`<svg><defs>
    <mask id="nested" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="10" height="10"><g><rect x="0" y="0" width="10" height="10" fill="#fff"/></g></mask>
    <mask id="mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="10" height="10"><g><g mask="url(#nested)"><rect x="0" y="0" width="10" height="10" fill="#fff"/></g></g></mask>
  </defs><rect width="10" height="10" mask="url(#mask)"/></svg>`, 'unsupported-mask-graph');

  const boolean = createNode('boolean', {
    operation: 'subtract', width: 40, height: 30,
    children: [createNode('rectangle', { width: 40, height: 30 }), createNode('ellipse', { x: 10, y: 5, width: 20, height: 20 })]
  });
  const unsupportedInverse = exportNodeToSvg(boolean).replace('tableValues="1 0"', 'tableValues="0 1"');
  importFailure(unsupportedInverse, 'unsupported-filter-graph');
});

test('network payload failures reject the complete SVG import', () => {
  const valid = exportNodeToSvg(createNetworkForSvgRoundTrip());
  const malformed = valid.replace(/data-tiny-image-star-network-v1="[^"]*"/, 'data-tiny-image-star-network-v1="{&quot;version&quot;:2}"');
  const withPriorContent = valid.replace('<g transform=', '<path d="M0 0 L4 0"/><g transform=');
  assert.throws(() => importSvgToLayers(withPriorContent.replace(/data-tiny-image-star-network-v1="[^"]*"/, 'data-tiny-image-star-network-v1="{&quot;version&quot;:2}"')), error => {
    assert.ok(error instanceof SvgImportError);
    assert.equal(error.code, 'invalid-network-metadata');
    return true;
  });
  assert.throws(() => importSvgToLayers(malformed), error => error instanceof SvgImportError && error.code === 'invalid-network-metadata');
  const invalidJson = valid.replace(/data-tiny-image-star-network-v1="[^"]*"/, 'data-tiny-image-star-network-v1="not-json"');
  assert.throws(() => importSvgToLayers(invalidJson), error => error instanceof SvgImportError && error.code === 'invalid-network-metadata');

  const oversized = valid.replace(/data-tiny-image-star-network-v1="[^"]*"/, `data-tiny-image-star-network-v1="${'x'.repeat(1024 * 1024 + 1)}"`);
  assert.throws(() => importSvgToLayers(oversized), error => error instanceof SvgImportError && error.code === 'resource-limit');
});

test('rounded network radii survive uniform SVG transforms and reject anisotropic scaling', () => {
  const geometry = vectorNetworkGeometryFromAnchors([
    { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }
  ], { closed: true });
  geometry.vertices[0].cornerRadius = 7;
  const source = createNode('network', { ...geometry, fill: '#123456', stroke: null, strokeWidth: 0 });
  const svg = exportNodeToSvg(source);
  const svgOpenEnd = svg.indexOf('>', svg.indexOf('<svg')) + 1;
  const svgCloseStart = svg.lastIndexOf('</svg>');
  const wrapTransform = transform => `${svg.slice(0, svgOpenEnd)}<g transform="${transform}">${svg.slice(svgOpenEnd, svgCloseStart)}</g>${svg.slice(svgCloseStart)}`;

  const uniformlyScaled = importSvgToLayers(wrapTransform('scale(2)'));
  const imported = allNodes(uniformlyScaled.nodes).find(node => node.type === 'network');
  assert.ok(imported);
  assert.equal(imported.vertices.find(vertex => vertex.id === 'v1').cornerRadius, 14,
    'a uniform SVG transform scales stored corner radii with the graph geometry');

  importFailure(wrapTransform('scale(2,1)'), 'non-uniform-corner-radius-transform');
});

function createNetworkForSvgRoundTrip() {
  return {
    type: 'network', id: 'round-trip-network', name: 'Branched badge', x: 18, y: 24, width: 120, height: 80, rotation: 30,
    fill: '#abcdef', fillOpacity: 0.62, stroke: '#123456', strokeWidth: 3,
    vertices: [
      { id: 'junction', x: 0, y: 0, mode: 'smooth' }, { id: 'right', x: 1, y: 0 },
      { id: 'bottom', x: 0.72, y: 1 }, { id: 'left', x: 0, y: 1 }
    ],
    edges: [
      { id: 'edge-top', from: 'junction', to: 'right', control1: { x: 0.3, y: -0.2 }, control2: { x: 0.72, y: -0.15 } },
      { id: 'edge-right', from: 'right', to: 'bottom' }, { id: 'edge-bottom', from: 'bottom', to: 'left' },
      { id: 'edge-left', from: 'left', to: 'junction' }, { id: 'edge-branch', from: 'junction', to: 'bottom', control1: { x: 0.15, y: 0.2 }, control2: { x: 0.55, y: 0.75 } }
    ],
    faces: [{ id: 'face-main', vertexIds: ['junction', 'right', 'bottom', 'left'], fill: '#fedcba', fillOpacity: 0.37 }]
  };
}

test('preserves fill/stroke opacity, element opacity, inherited styles and uniform stroke scaling', () => {
  const result = importSvgToLayers(`<svg width="400" height="200" viewBox="0 0 100 50">
    <g opacity=".5" fill="#ff000080" fill-opacity=".5" stroke="#0000ff" stroke-opacity=".25" stroke-width="2">
      <path opacity=".5" d="M0 0 L10 0 L10 10 Z"/>
    </g>
  </svg>`);
  const nodes = allNodes(result.nodes);
  const fill = nodes.find(node => node.name === 'path 2 fill');
  const stroke = nodes.find(node => node.name === 'path 2 stroke');
  assert.equal(fill.fillOpacity, 0.25098039215686274);
  assert.equal(fill.opacity, 1);
  assert.equal(nodes.find(node => node.name === 'g 1').opacity, 0.5);
  assert.equal(nodes.find(node => node.name === 'path 2').opacity, 0.5);
  assert.equal(stroke.stroke, '#0000ff');
  assert.equal(stroke.strokeWidth, 8);
  assert.equal(stroke.opacity, 0.25);
  const rootOpacity = importSvgToLayers(`<svg opacity=".4"><g opacity=".5"><rect width="10" height="10" fill="#000"/></g></svg>`);
  assert.equal(rootOpacity.nodes[0].opacity, 0.4);
  assert.equal(rootOpacity.nodes[0].children[0].opacity, 0.5);
});

test('maps affine transforms to editable vector geometry and rejects distorted stroke widths', () => {
  const skewed = importSvgToLayers(`<svg width="100" height="100"><path transform="matrix(1 0 .5 1 5 6)" d="M0 0 L10 0 L10 10 Z" fill="#fff"/></svg>`);
  const skewedPath = allNodes(skewed.nodes).find(node => node.type === 'path');
  assert.equal(skewedPath.x, 5);
  assert.equal(skewedPath.y, 6);
  assert.equal(skewedPath.width, 15);
  assert.equal(skewedPath.height, 10);
  importFailure(`<svg><path transform="scale(2 1)" d="M0 0 L10 10" stroke="#000"/></svg>`, 'non-uniform-stroke-transform');
});

test('requires an explicit viewport for percentage dimensions', () => {
  importFailure(`<svg width="100%" height="100%"><rect width="10" height="10"/></svg>`, 'viewport-required');
  const result = importSvgToLayers(`<svg width="100%" height="50%"><rect width="10" height="10"/></svg>`, { viewportWidth: 300, viewportHeight: 200 });
  assert.equal(result.width, 300);
  assert.equal(result.height, 100);
  const half = importSvgToLayers(`<svg width="50%" height="25%"/>`, { viewportWidth: 300, viewportHeight: 200 });
  assert.equal(half.width, 150);
  assert.equal(half.height, 50);
});

test('fills open subpaths by SVG rules and honors visibility overrides and nested opacity properties', () => {
  const result = importSvgToLayers(`<svg opacity=".4"><g opacity=".5" visibility="hidden" fill="#ff0000">
    <polyline id="hidden-line" points="0,0 10,0 10,10"/>
    <path id="visible-fill" visibility="visible" d="M0 0 L10 0 L10 10"/>
  </g></svg>`);
  const nodes = allNodes(result.nodes);
  assert.equal(result.nodes[0].opacity, 0.4);
  const group = nodes.find(node => node.type === 'group');
  assert.equal(group.opacity, 0.5);
  assert.equal(group.children.length, 1, 'a child can override inherited visibility:hidden');
  const fill = nodes.find(node => node.name === 'visible-fill');
  assert.equal(fill.closed, true, 'an open SVG path is implicitly closed for fill rendering');
  assert.equal(fill.fill, '#ff0000');
});

test('rejects active content, external references, declarations, and unresolved paint features', () => {
  importFailure(`<svg><script>alert(1)</script></svg>`, 'active-content');
  importFailure(`<svg><foreignObject><div/></foreignObject></svg>`, 'active-content');
  importFailure(`<svg><rect onload="alert(1)" width="10" height="10"/></svg>`, 'active-content');
  importFailure(`<svg><text display="none" dominant-baseline="text-before-edge"><script>alert(1)</script></text></svg>`, 'active-content');
  importFailure(`<svg><image href="https://example.test/a.png" width="10" height="10"/></svg>`, 'external-reference');
  importFailure(`<svg><use href="#shape"/></svg>`, 'external-reference');
  importFailure(`<!DOCTYPE svg [<!ENTITY x SYSTEM "https://example.test/x">]><svg>&x;</svg>`, 'unsafe-declaration');
  importFailure(`<svg><rect width="10" height="10" style="fill:url(https://example.test/a.svg#x)"/></svg>`, 'external-reference');
  importFailure(`<svg><rect width="10" height="10" filter="url(#blur)"/></svg>`, 'missing-filter');
  importFailure(`<svg><rect width="10" height="10" clip-path="url(https://example.test/clip.svg#shape)"/></svg>`, 'external-reference');
  importFailure(`<svg><rect width="10" height="10" clip-path="url(#missing-clip)"/></svg>`, 'missing-clip-path');
  importFailure(`<svg><defs><clipPath id="bad-clip"><circle cx="5" cy="5" r="4" onload="run()"/></clipPath></defs><rect width="10" height="10" clip-path="url(#bad-clip)"/></svg>`, 'active-content');
});

test('imports faithful SVG layer-blur and drop-shadow chains as editable layer effects', () => {
  const result = importSvgToLayers(`<svg width="100" height="80">
    <defs>
      <filter id="soft" filterUnits="userSpaceOnUse" x="-12" y="-12" width="124" height="104">
        <feGaussianBlur in="SourceGraphic" stdDeviation="4 4" result="softened"/>
      </filter>
      <filter id="shadow" filterUnits="userSpaceOnUse" x="-11" y="-10" width="122" height="100">
        <feDropShadow in="SourceGraphic" dx="5" dy="-4" stdDeviation="2" flood-color="#33669980" flood-opacity=".5" result="shadowed"/>
      </filter>
    </defs>
    <rect id="blurred" x="0" y="0" width="100" height="80" filter="url(#soft)" fill="#fff"/>
    <rect id="shadowed" x="0" y="0" width="100" height="80" style="filter: url(#shadow)" fill="#fff" fill-opacity=".5"/>
  </svg>`);
  const nodes = allNodes(result.nodes);
  const blur = nodes.find(node => node.name === 'blurred');
  assert.deepEqual(blur.effects.map(({ type, radius }) => ({ type, radius })), [{ type: 'layer-blur', radius: 4 }]);
  const shadow = nodes.find(node => node.name === 'shadowed');
  assert.equal(shadow.effects[0].showShadowBehindNode, true,
    'ordinary SVG shadows remain visible behind translucent geometry');
  assert.deepEqual(shadow.effects.map(({ type, color, opacity, offsetX, offsetY, blur: radius }) =>
    ({ type, color, opacity, offsetX, offsetY, blur: radius })), [{
    type: 'drop-shadow', color: '#336699', opacity: 128 / 255 * 0.5, offsetX: 5, offsetY: -4, blur: 2
  }]);
});

test('maps SVG filter coordinates through uniform transforms and preserves ordered shadows', () => {
  const result = importSvgToLayers(`<svg width="100" height="100">
    <defs><filter id="chain" filterUnits="userSpaceOnUse" x="-8" y="-8" width="116" height="116">
      <feDropShadow in="SourceGraphic" dx="3" dy="0" stdDeviation="1" flood-color="#000" flood-opacity=".5" result="first"/>
      <feDropShadow in="first" dx="-2" dy="0" stdDeviation="0" flood-color="#ff0000" result="second"/>
    </filter></defs>
    <g transform="translate(10 10) rotate(90) scale(2)" filter="url(#chain)">
      <rect width="50" height="50" fill="#fff"/>
    </g>
  </svg>`);
  const group = allNodes(result.nodes).find(node => node.type === 'group' && node.effects?.length);
  assert.ok(group);
  assert.deepEqual(group.effects.map(effect => [effect.type, Math.round(effect.offsetX * 1e9) / 1e9 || 0, effect.offsetY, effect.blur, effect.opacity]), [
    ['drop-shadow', 0, 6, 2, 0.5], ['drop-shadow', 0, -4, 0, 1]
  ]);
});

test('round-trips the importer-supported layer blur and drop-shadow primitives from SVG export', () => {
  const original = createNode('rectangle', {
    id: 'card', name: 'card', width: 100, height: 60, fill: '#fff',
    effects: [
      { id: 'blur', type: 'layer-blur', visible: true, radius: 3 },
      { id: 'shadow', type: 'drop-shadow', visible: true, color: '#112233', opacity: 0.25, offsetX: 5, offsetY: -2, blur: 3 }
    ]
  });
  const source = importSvgToLayers(exportNodeToSvg(original));
  const layer = allNodes(source.nodes).find(node => node.effects?.length);
  assert.deepEqual(layer.effects.map(effect => effect.type), ['layer-blur', 'drop-shadow']);
  assert.equal(layer.effects[0].radius, 3);
  assert.equal(layer.effects[1].color, '#112233');
  assert.equal(layer.effects[1].opacity, 0.25);
  assert.equal(layer.effects[1].offsetX, 5);
  assert.equal(layer.effects[1].offsetY, -2);
  assert.equal(layer.effects[1].blur, 3);
});

test('round-trips unphased native shadows with their local offsets and clipping flags', () => {
  for (const showShadowBehindNode of [false, true]) {
    const original = createNode('rectangle', {
      name: `Unphased shadow ${showShadowBehindNode}`, width: 100, height: 60, rotation: 17,
      fill: '#ffffff', fillOpacity: showShadowBehindNode ? 0.5 : 1,
      effects: [{ id: 'shadow', type: 'drop-shadow', visible: true, showShadowBehindNode,
        color: '#112233', opacity: 0.25, offsetX: 5, offsetY: -2, blur: 3 }]
    });
    const svg = exportNodeToSvg(original);
    const copy = allNodes(importSvgToLayers(svg).nodes).find(node => node.name === original.name);
    assert.equal(copy?.type, 'rectangle');
    assert.ok(Math.abs(copy.rotation - original.rotation) < 1e-8);
    assert.equal(copy.effects[0].showShadowBehindNode, showShadowBehindNode);
    assert.ok(Math.abs(copy.effects[0].offsetX - 5) < 1e-8);
    assert.ok(Math.abs(copy.effects[0].offsetY + 2) < 1e-8);
    assert.doesNotThrow(() => exportNodeToSvg(copy), 'the imported shadow remains exportable');
    const legacy = svg.replace(/ data-tiny-image-star-drop-shadow-behind-v1="[^"]+"/u, '');
    const legacyCopy = allNodes(importSvgToLayers(legacy).nodes).find(node => node.name === original.name);
    assert.equal(legacyCopy.effects[0].showShadowBehindNode, true,
      'older exports retain their actual SVG unclipped-shadow appearance');
  }
});

test('round-trips editor-exported inner-shadow filter chains as editable ordered effects', () => {
  const original = createNode('rectangle', {
    id: 'card', name: 'card', width: 100, height: 60, fill: '#fff',
    effects: [
      { id: 'outer', type: 'drop-shadow', visible: true, color: '#112233', opacity: 0.25, offsetX: 5, offsetY: -2, blur: 3 },
      { id: 'inner-a', type: 'inner-shadow', visible: true, color: '#abcdef', opacity: 0.4, offsetX: 2, offsetY: -3, blur: 5 },
      { id: 'blur', type: 'layer-blur', visible: true, radius: 1 },
      { id: 'inner-b', type: 'inner-shadow', visible: true, color: '#102030', opacity: 0.75, offsetX: -4, offsetY: 6, blur: 2 }
    ]
  });
  const source = importSvgToLayers(exportNodeToSvg(original));
  const layer = allNodes(source.nodes).find(node => node.effects?.length);
  assert.deepEqual(layer.effects.map(({ type, color, opacity, offsetX, offsetY, blur, radius }) =>
    ({ type, color, opacity, offsetX, offsetY, blur, radius })), [
    { type: 'inner-shadow', color: '#abcdef', opacity: 0.4, offsetX: 2, offsetY: -3, blur: 5, radius: undefined },
    { type: 'inner-shadow', color: '#102030', opacity: 0.75, offsetX: -4, offsetY: 6, blur: 2, radius: undefined },
    { type: 'layer-blur', color: undefined, opacity: undefined, offsetX: undefined, offsetY: undefined, blur: undefined, radius: 1 },
    { type: 'drop-shadow', color: '#112233', opacity: 0.25, offsetX: 5, offsetY: -2, blur: 3, radius: undefined }
  ]);
});

test('round-trips simple editor rectangles and ellipses as native editable shapes', () => {
  const rectangle = createNode('rectangle', {
    id: 'native-card', name: 'Native card', x: 24, y: 18, width: 72, height: 48,
    radius: 10, rotation: 13, fill: '#234567', fillOpacity: 0.8,
    stroke: '#abcdef', strokeOpacity: 0.6, strokeWidth: 2
  });
  const rectangleCopy = allNodes(importSvgToLayers(exportNodeToSvg(rectangle)).nodes).find(node => node.name === 'Native card');
  assert.equal(rectangleCopy?.type, 'rectangle');
  assert.ok([rectangleCopy.width, rectangleCopy.height, rectangleCopy.radius, rectangleCopy.fillOpacity,
    rectangleCopy.strokeWidth, rectangleCopy.strokeOpacity].every((value, index) =>
    Math.abs(value - [72, 48, 10, 0.8, 2, 0.6][index]) < 1e-6));
  assert.ok(Math.abs(rectangleCopy.rotation - 13) < 1e-8);
  assert.equal(rectangleCopy.fill, '#234567');
  assert.equal(rectangleCopy.stroke, '#abcdef');

  const ellipse = createNode('ellipse', { id: 'native-dot', name: 'Native dot', width: 42, height: 28, fill: '#778899' });
  const ellipseCopy = allNodes(importSvgToLayers(exportNodeToSvg(ellipse)).nodes).find(node => node.name === 'Native dot');
  assert.equal(ellipseCopy?.type, 'ellipse');
  assert.deepEqual([ellipseCopy.width, ellipseCopy.height, ellipseCopy.fill], [42, 28, '#778899']);
});

test('round-trips editor ellipse arcs as native editable shapes only when the exported path is unchanged', () => {
  const arcCases = [
    { name: 'partial pie', startingAngle: 0, endingAngle: Math.PI * 1.5, innerRadius: 0 },
    { name: 'donut ring', startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: .4 },
    { name: 'full ellipse arc metadata', startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0 },
    { name: 'empty ellipse sweep', startingAngle: Math.PI / 3, endingAngle: Math.PI / 3, innerRadius: .2 }
  ];

  for (const [index, arcData] of arcCases.entries()) {
    const original = createNode('ellipse', {
      id: `arc-${index}`, name: arcData.name, width: 120.25, height: 80.5,
      x: index === 0 ? 24 : 0, y: index === 0 ? 18 : 0, rotation: index === 0 ? 13 : 0,
      fill: '#334455', arcData
    });
    const svg = exportNodeToSvg(original);
    const imported = allNodes(importSvgToLayers(svg).nodes).find(node => node.name === arcData.name);
    assert.equal(imported?.type, 'ellipse', `${arcData.name} should recover its editable ellipse controls`);
    assert.deepEqual(imported.arcData, {
      startingAngle: arcData.startingAngle,
      endingAngle: arcData.endingAngle,
      innerRadius: arcData.innerRadius
    });
    assert.ok(Math.abs(imported.width - original.width) < 1e-8);
    assert.ok(Math.abs(imported.height - original.height) < 1e-8);
  }

  const pie = createNode('ellipse', {
    name: 'edited pie', width: 100, height: 100, fill: '#334455',
    arcData: { startingAngle: 0, endingAngle: Math.PI / 2, innerRadius: 0 }
  });
  const exported = exportNodeToSvg(pie);
  const edited = exported.replace('d="M 100 50', 'd="M 99 50');
  const importedEdited = allNodes(importSvgToLayers(edited).nodes);
  assert.equal(importedEdited.some(node => node.type === 'ellipse'), false,
    'edited path geometry must stay a vector rather than trusting stale arc metadata');
  assert.ok(importedEdited.some(node => node.type === 'path'), 'edited arc geometry should remain available as an editable path');
});

test('round-trips standalone editor frames and their individual-side stroke controls', () => {
  const original = createNode('frame', {
    id: 'native-frame', name: 'Native frame', x: 24, y: 18, width: 96, height: 64,
    radius: 8, rotation: -12, fill: '#234567', fillOpacity: 0.8,
    strokes: [createStroke({
      id: 'frame-border', color: '#abcdef', width: 4, opacity: 0.6,
      cap: 'round', join: 'bevel', sideMode: 'custom',
      sideWidths: { top: 1, right: 6, bottom: 3, left: 0 }
    })]
  });
  const imported = allNodes(importSvgToLayers(exportNodeToSvg(original)).nodes)
    .find(node => node.name === 'Native frame');

  assert.equal(imported?.type, 'frame');
  assert.equal(imported.clip, true);
  assert.ok([imported.width, imported.height, imported.radius].every((value, index) =>
    Math.abs(value - [original.width, original.height, original.radius][index]) < 1e-8));
  assert.ok([imported.x, imported.y].every(Number.isFinite), 'selected-layer SVG maps its local frame position into the exported viewport');
  assert.ok(Math.abs(imported.rotation - original.rotation) < 1e-8);
  assert.equal(imported.fill, original.fill);
  assert.equal(imported.fillOpacity, original.fillOpacity);
  assert.equal(imported.strokes?.length, 1);
  assert.equal(imported.strokes[0].sideMode, 'custom');
  assert.deepEqual(imported.strokes[0].sideWidths, { top: 1, right: 6, bottom: 3, left: 0 });
  assert.equal(imported.strokes[0].color, '#abcdef');
  assert.equal(imported.strokes[0].opacity, 0.6);
  assert.equal(imported.strokes[0].cap, 'round');
  assert.equal(imported.strokes[0].join, 'bevel');
});

test('round-trips tagged rectangle individual-side stroke controls when geometry is unchanged', () => {
  const original = createNode('rectangle', {
    id: 'individual-border', name: 'Individual border', x: 24, y: 18, width: 100, height: 60,
    radius: 8, rotation: 13, fill: '#234567', fillOpacity: 0.8,
    strokes: [createStroke({
      id: 'original-border-stroke', color: '#cc4411', width: 4, opacity: 0.6,
      cap: 'round', join: 'bevel', pattern: 'solid', miterLimit: 7,
      sideMode: 'custom', sideWidths: { top: 2, right: 8, bottom: 0, left: 3 }
    })]
  });
  const svg = exportNodeToSvg(original);
  const imported = allNodes(importSvgToLayers(svg).nodes).find(node => node.name === 'Individual border');
  assert.equal(imported?.type, 'rectangle');
  assert.ok(Math.abs(imported.width - original.width) < 1e-6);
  assert.ok(Math.abs(imported.height - original.height) < 1e-6);
  assert.ok(Math.abs(imported.rotation - original.rotation) < 1e-8);
  assert.equal(imported.fill, original.fill);
  assert.equal(imported.fillOpacity, original.fillOpacity);
  assert.equal(imported.strokes?.length, 1);
  const stroke = imported.strokes[0];
  assert.equal(stroke.sideMode, 'custom');
  assert.deepEqual(stroke.sideWidths, { top: 2, right: 8, bottom: 0, left: 3 });
  assert.equal(stroke.width, 4, 'the base width used when switching away from custom sides is retained');
  assert.equal(stroke.color, '#cc4411');
  assert.equal(stroke.opacity, 0.6);
  assert.equal(stroke.cap, 'round');
  assert.equal(stroke.join, 'bevel');
  assert.equal(stroke.pattern, 'solid');
  assert.equal(stroke.miterLimit, 7);

  const rightStrokePath = svg.match(/<path d="[^"]+"[^>]*data-tiny-image-star-stroke-side="right"[^>]*>/u)?.[0];
  assert.ok(rightStrokePath, 'export should tag the right-side stroke outline');
  const editedRightStrokePath = rightStrokePath.replace('L 100 8', 'L 101 8');
  assert.notEqual(editedRightStrokePath, rightStrokePath);
  const editedSvg = svg.replace(rightStrokePath, editedRightStrokePath);
  const edited = allNodes(importSvgToLayers(editedSvg).nodes);
  assert.equal(edited.some(node => node.type === 'rectangle' && node.name === 'Individual border'), false,
    'edited side geometry must not be promoted to a native rectangle');
  assert.ok(edited.some(node => node.type === 'path'), 'modified stroke outlines remain editable vector paths');
});

test('round-trips tagged unequal-side rectangle dashed, dotted, and exact custom stroke patterns', () => {
  const cases = [
    {
      pattern: 'dashed', cap: 'square',
      sideWidths: { top: 2, right: 8, bottom: 0, left: 3 },
    },
    {
      pattern: 'dotted', cap: 'round',
      // Thin sides exercise the minimum one-pixel SVG dot gap as well as
      // the per-side width scaling that used to make these look custom.
      sideWidths: { top: 0.25, right: 8, bottom: 0, left: 0.4 },
    },
    {
      pattern: 'custom', cap: 'round', dashArray: [3, 1.5, 0.75, 2],
      sideWidths: { top: 2, right: 8, bottom: 0, left: 3 },
    },
  ];

  for (const { pattern, cap, dashArray, sideWidths } of cases) {
    const original = createNode('rectangle', {
      id: `unequal-${pattern}`, name: `Unequal ${pattern}`, width: 100, height: 60,
      fill: '#234567', strokes: [createStroke({
        color: '#cc4411', width: 4, cap, pattern, sideMode: 'custom', sideWidths,
        ...(dashArray ? { dashArray } : {}),
      })],
    });
    const imported = allNodes(importSvgToLayers(exportNodeToSvg(original)).nodes)
      .find(node => node.name === `Unequal ${pattern}`);

    assert.equal(imported?.type, 'rectangle', `${pattern} side strokes should recover the native rectangle`);
    assert.equal(imported.strokes?.[0]?.pattern, pattern);
    assert.deepEqual(imported.strokes[0].sideWidths, sideWidths);
    assert.equal(imported.strokes[0].width, 4);
    assert.equal(imported.strokes[0].cap, cap);
    if (pattern === 'custom') assert.deepEqual(imported.strokes[0].dashArray, dashArray,
      'custom dash and gap lengths must remain exact across unequal side widths');
    else assert.equal(imported.strokes[0].dashArray, undefined,
      'built-in patterns are reconstructed from their semantic preset, not one side’s encoded dash lengths');
  }
});

test('falls back to editable vectors when tagged unequal-side stroke patterns disagree', () => {
  const makeSvg = (pattern, dashArray = undefined) => exportNodeToSvg(createNode('rectangle', {
    id: `incompatible-${pattern}`, name: `Incompatible ${pattern}`, width: 100, height: 60,
    fill: '#234567', strokes: [createStroke({
      color: '#cc4411', width: 4, cap: pattern === 'dotted' ? 'round' : 'butt', pattern,
      sideMode: 'custom', sideWidths: { top: 2, right: 8, bottom: 0, left: 3 },
      ...(dashArray ? { dashArray } : {}),
    })],
  }));
  const editRightDash = (svg, expected, replacement) => {
    const rightSide = svg.match(/<path\b(?=[^>]*data-tiny-image-star-stroke-side="right")[^>]*>/u)?.[0];
    assert.ok(rightSide, 'the export should tag its right-side stroke path');
    assert.ok(rightSide.includes(`stroke-dasharray="${expected}"`), `expected right-side dash ${expected}`);
    return svg.replace(rightSide, rightSide.replace(`stroke-dasharray="${expected}"`, `stroke-dasharray="${replacement}"`));
  };
  const incompatibleCases = [
    ['dashed', undefined, '32 16', '32 15'],
    ['dotted', undefined, '0 16', '0 15'],
    ['custom', [3, 1.5, 0.75, 2], '3 1.5 0.75 2', '3 1.25 0.75 2'],
  ];

  for (const [pattern, dashArray, originalDash, changedDash] of incompatibleCases) {
    const svg = editRightDash(makeSvg(pattern, dashArray), originalDash, changedDash);
    const imported = allNodes(importSvgToLayers(svg).nodes);
    assert.equal(imported.some(node => node.type === 'rectangle' && node.name === `Incompatible ${pattern}`), false,
      `${pattern} side paths with incompatible dash semantics must not be promoted to an editable rectangle`);
    assert.ok(imported.some(node => node.type === 'path'),
      `${pattern} side paths must remain available as editable vectors when native recovery is unsafe`);
  }
});

test('round-trips unrounded editor stars and polygons with editable point controls', () => {
  const star = createNode('star', {
    id: 'native-star', name: 'Native star', x: 18, y: 26, width: 110, height: 70,
    rotation: -17, points: 8, innerRadius: 0.32, fill: '#345678', fillOpacity: 0.75,
    stroke: '#abcdef', strokeOpacity: 0.6, strokeWidth: 2
  });
  const polygon = createNode('polygon', {
    id: 'native-polygon', name: 'Native polygon', x: 140, y: 30, width: 96, height: 64,
    rotation: 23, points: 7, fill: '#778899'
  });
  const imported = allNodes(importSvgToLayers(exportNodeToSvg(createNode('group', {
    name: 'Native regular shapes', width: 260, height: 120, children: [star, polygon]
  }))).nodes);
  const starCopy = imported.find(node => node.name === 'Native star');
  const polygonCopy = imported.find(node => node.name === 'Native polygon');
  assert.equal(starCopy?.type, 'star');
  assert.equal(polygonCopy?.type, 'polygon');
  assert.equal(starCopy.points, 8);
  assert.ok(Math.abs(starCopy.innerRadius - 0.32) < 1e-6);
  assert.equal(polygonCopy.points, 7);
  for (const [copy, source] of [[starCopy, star], [polygonCopy, polygon]]) {
    for (const property of ['width', 'height', 'rotation']) {
      assert.ok(Math.abs(copy[property] - source[property]) < 1e-5, `${source.name} ${property} should round-trip`);
    }
  }
  assert.equal(starCopy.fill, '#345678');
  assert.equal(starCopy.fillOpacity, 0.75);
  assert.equal(starCopy.stroke, '#abcdef');
  assert.equal(starCopy.strokeOpacity, 0.6);
  assert.ok(Math.abs(starCopy.strokeWidth - 2) < 1e-5);
});

test('round-trips phased editor stars and polygons with native controls and ordered effects', () => {
  for (const type of ['star', 'polygon']) {
    const original = createNode(type, {
      id: `phased-${type}`, name: `Phased ${type}`, width: 82, height: 68,
      points: type === 'star' ? 7 : 9,
      ...(type === 'star' ? { innerRadius: 0.36 } : {}),
      fill: '#345678', fillOpacity: 0.75, stroke: '#abcdef', strokeOpacity: 0.6, strokeWidth: 2.5,
      effects: [
        { id: `${type}-drop`, type: 'drop-shadow', visible: true, showShadowBehindNode: true,
          color: '#112233', opacity: 0.3, offsetX: 4, offsetY: -2, blur: 5 },
        { id: `${type}-inner`, type: 'inner-shadow', visible: true, color: '#abcdef', opacity: 0.45,
          offsetX: -2, offsetY: 3, blur: 4 },
        { id: `${type}-blur`, type: 'layer-blur', visible: true, radius: 2 }
      ]
    });
    const svg = exportNodeToSvg(original);
    const copy = allNodes(importSvgToLayers(svg).nodes).find(node => node.name === original.name);

    assert.equal(copy?.type, type, `${type} effect phases recover the native shape controls`);
    assert.equal(copy.points, original.points);
    if (type === 'star') assert.ok(Math.abs(copy.innerRadius - original.innerRadius) < 1e-6);
    for (const property of ['width', 'height', 'fillOpacity', 'strokeOpacity', 'strokeWidth']) {
      assert.ok(Math.abs(copy[property] - original[property]) < 1e-5, `${type} ${property} should round-trip`);
    }
    assert.equal(copy.fill, original.fill);
    assert.equal(copy.stroke, original.stroke);
    assert.deepEqual(copy.effects.map(effect => effect.type), ['inner-shadow', 'layer-blur', 'drop-shadow'],
      `${type} restores effect order from the tagged paint phases`);
    assert.deepEqual(copy.effects.map(({ type: effectType, color, opacity, offsetX, offsetY, blur, radius }) =>
      ({ type: effectType, color, opacity, offsetX, offsetY, blur, radius })), [
      { type: 'inner-shadow', color: '#abcdef', opacity: 0.45, offsetX: -2, offsetY: 3, blur: 4, radius: undefined },
      { type: 'layer-blur', color: undefined, opacity: undefined, offsetX: undefined, offsetY: undefined, blur: undefined, radius: 2 },
      { type: 'drop-shadow', color: '#112233', opacity: 0.3, offsetX: 4, offsetY: -2, blur: 5, radius: undefined }
    ], `${type} retains the filter values in the restored effect phases`);
  }
});

test('round-trips phased rounded stars and polygons only when every stage matches the tagged geometry', () => {
  const originals = [
    createNode('star', {
      id: 'phased-rounded-star', name: 'Phased rounded star', x: 14, y: 18, width: 86, height: 72,
      rotation: -12, points: 7, innerRadius: 0.34, radius: 4, cornerSmoothing: 0.3,
      fills: [
        { id: 'base', type: 'solid', visible: true, opacity: 0.85, blendMode: 'normal', color: '#345678' },
        { id: 'highlight', type: 'solid', visible: true, opacity: 0.4, blendMode: 'normal', color: '#abcdef' }
      ],
      effects: [
        { id: 'star-inner', type: 'inner-shadow', visible: true, color: '#102030', opacity: 0.5, offsetX: 1, offsetY: 2, blur: 3 },
        { id: 'star-blur', type: 'layer-blur', visible: true, radius: 2 },
        { id: 'star-drop', type: 'drop-shadow', visible: true, showShadowBehindNode: true, color: '#010203', opacity: 0.3, offsetX: 3, offsetY: 4, blur: 5 }
      ]
    }),
    createNode('polygon', {
      id: 'phased-rounded-polygon', name: 'Phased custom polygon', x: 122, y: 18, width: 78, height: 64,
      rotation: 9, points: 6, cornerSmoothing: 0.2, vertexRadii: [2, 3, 4, 5, 6, 7],
      fill: '#778899', stroke: '#abcdef', strokeWidth: 2,
      effects: [{ id: 'polygon-inner', type: 'inner-shadow', visible: true, color: '#123456', opacity: 0.4, offsetX: -1, offsetY: 2, blur: 3 }]
    }),
    createNode('polygon', {
      id: 'phased-opaque-clipped-shadow', name: 'Phased opaque clipped-shadow polygon', width: 70, height: 58,
      points: 5, fill: '#ffffff',
      effects: [
        { id: 'opaque-inner', type: 'inner-shadow', visible: true, color: '#123456', opacity: 0.4, offsetX: 1, offsetY: -2, blur: 3 },
        { id: 'opaque-drop', type: 'drop-shadow', visible: true, showShadowBehindNode: false, color: '#010203', opacity: 0.3, offsetX: 3, offsetY: 4, blur: 5 }
      ]
    }),
    ...['rectangle', 'ellipse'].map(type => createNode(type, {
      id: `phased-opaque-${type}`, name: `Phased opaque ${type}`, width: 70, height: 58, fill: '#ffffff',
      effects: [
        { id: `${type}-inner`, type: 'inner-shadow', visible: true, color: '#123456', opacity: 0.4, offsetX: 1, offsetY: -2, blur: 3 },
        { id: `${type}-drop`, type: 'drop-shadow', visible: true, showShadowBehindNode: false, color: '#010203', opacity: 0.3, offsetX: 3, offsetY: 4, blur: 5 }
      ]
    }))
  ];
  for (const original of originals) {
    const sourceSvg = exportNodeToSvg(original);
    assert.match(sourceSvg, /data-tiny-image-star-paint-phases="layer-v1"/u);
    const copy = allNodes(importSvgToLayers(sourceSvg).nodes).find(node => node.name === original.name);
    assert.equal(copy?.type, original.type);
    assert.equal(copy.points, original.points);
    if (original.type === 'star') assert.equal(copy.innerRadius, original.innerRadius);
    assert.equal(copy.cornerSmoothing, original.cornerSmoothing);
    assert.ok(Math.abs(Number(copy.radius || 0) - Number(original.radius || 0)) < 1e-8);
    if (original.vertexRadii) {
      assert.equal(copy.vertexRadii.length, original.vertexRadii.length);
      original.vertexRadii.forEach((radius, index) => assert.ok(Math.abs(copy.vertexRadii[index] - radius) < 1e-8));
    } else assert.equal(copy.vertexRadii, undefined);
    assert.deepEqual(copy.effects.map(effect => effect.type), original.effects.map(effect => effect.type));
    original.effects.forEach((effect, index) => {
      for (const [property, value] of Object.entries(effect)) {
        if (property === 'id') continue;
        if (typeof value === 'number') {
          assert.ok(Math.abs(copy.effects[index][property] - value) <= 1e-8 * Math.max(1, Math.abs(value)),
            `${original.type}: ${property} survives the staged effect round-trip`);
        } else assert.equal(copy.effects[index][property], value,
          `${original.type}: ${property} survives the staged effect round-trip`);
      }
    });
    if (original.stroke) {
      assert.equal(copy.stroke, original.stroke);
      assert.equal(copy.strokeWidth, original.strokeWidth);
    }
    if (original.fills) {
      assert.equal(copy.fills.length, 2);
      assert.deepEqual(copy.fills.map(fill => [fill.color, fill.opacity]), [['#345678', 0.85], ['#abcdef', 0.4]]);
    }

    if (original.name === 'Phased rounded star') {
      for (const [label, replacement] of [
        ['forged clipped-shadow flag', '[false]'],
        ['malformed drop-shadow metadata', 'invalid'],
        ['drop-shadow count mismatch', '[]'],
        ['drop-shadow value type mismatch', '[1]']
      ]) {
        const tampered = sourceSvg.replace(/data-tiny-image-star-drop-shadow-behind-v1="[^"]+"/u,
          `data-tiny-image-star-drop-shadow-behind-v1="${replacement}"`);
        const recovered = allNodes(importSvgToLayers(tampered).nodes);
        assert.equal(recovered.some(node => node.name === original.name && node.type === original.type), false,
          `${label} must not recover rounded native geometry`);
        assert.ok(recovered.some(node => node.type === 'path'), `${label} remains editable vector geometry`);
      }
      const legacyWithoutFlags = sourceSvg.replace(/ data-tiny-image-star-drop-shadow-behind-v1="[^"]+"/u, '');
      const legacyCopy = allNodes(importSvgToLayers(legacyWithoutFlags).nodes).find(node => node.name === original.name);
      assert.equal(legacyCopy.effects.find(effect => effect.type === 'drop-shadow').showShadowBehindNode, true,
        'older phased exports without drop-shadow metadata retain SVG unclipped-shadow semantics');
    }

    if (sourceSvg.includes('data-tiny-image-star-rounded-shape-v1=')) {
      const firstStageGeometry = sourceSvg.match(/(<g data-tiny-image-star-paint-stage="fill"[^>]*>\s*<path d=")([^"]+)/u);
      assert.ok(firstStageGeometry, 'rounded paint stages use canonical path geometry');
      const altered = sourceSvg.replace(firstStageGeometry[0], `${firstStageGeometry[1]}${firstStageGeometry[2].replace(/^M (-?[\d.]+) (-?[\d.]+)/u, (_m, x, y) => `M ${Number(x) + 0.01} ${y}`)}`);
      const fallback = allNodes(importSvgToLayers(altered).nodes);
      assert.equal(fallback.some(node => node.name === original.name && node.type === original.type), false,
        'edited stage geometry cannot recover native controls');
      assert.ok(fallback.some(node => node.type === 'path'), 'edited stage geometry remains editable vector content');

      const tamperedMetadata = sourceSvg.replace(/data-tiny-image-star-rounded-shape-v1="[^"]+"/u,
        'data-tiny-image-star-rounded-shape-v1="{&quot;version&quot;:99}"');
      const malformed = allNodes(importSvgToLayers(tamperedMetadata).nodes);
      assert.equal(malformed.some(node => node.name === original.name && node.type === original.type), false,
        'tampered rounded metadata cannot recover native controls');
      assert.ok(malformed.some(node => node.type === 'path'), 'tampered geometry remains editable vector content');
    }
  }
});

test('round-trips phased rounded rectangles as native editable controls only for exact geometry', () => {
  const original = createNode('rectangle', {
    id: 'rounded-phase', name: 'Phased rounded card', x: 18, y: 22, width: 120, height: 80,
    rotation: 11, cornerRadii: { topLeft: 4, topRight: 12, bottomRight: 20, bottomLeft: 8 },
    cornerSmoothing: 0.35, fill: '#345678', stroke: '#abcdef', strokeWidth: 2,
    effects: [
      { id: 'rounded-drop', type: 'drop-shadow', visible: true, showShadowBehindNode: true, color: '#112233', opacity: 0.3,
        offsetX: 4, offsetY: -2, blur: 5 },
      { id: 'rounded-inner', type: 'inner-shadow', visible: true, color: '#abcdef', opacity: 0.45,
        offsetX: -2, offsetY: 3, blur: 4 },
      { id: 'rounded-blur', type: 'layer-blur', visible: true, radius: 2 }
    ]
  });
  const sourceSvg = exportNodeToSvg(original);
  const imported = allNodes(importSvgToLayers(sourceSvg).nodes).find(node => node.name === original.name);

  assert.equal(imported?.type, 'rectangle');
  assert.deepEqual(imported.cornerRadii, original.cornerRadii);
  assert.equal(imported.cornerSmoothing, original.cornerSmoothing);
  for (const property of ['width', 'height', 'rotation', 'strokeWidth']) {
    assert.ok(Math.abs(imported[property] - original[property]) < 1e-5, `${property} is retained`);
  }
  assert.deepEqual(imported.effects.map(effect => effect.type), ['inner-shadow', 'layer-blur', 'drop-shadow']);

  const fillPath = sourceSvg.match(/(<g data-tiny-image-star-paint-stage="fill"[^>]*>\s*<path d=")([^"]+)/u);
  assert.ok(fillPath, 'the editor effect export contains its rounded fill geometry');
  const editedPath = fillPath[2].replace(/^M (-?[\d.]+) (-?[\d.]+)/u,
    (_match, x, y) => `M ${Number(x) + 0.01} ${y}`);
  const editedSvg = sourceSvg.replace(fillPath[0], `${fillPath[1]}${editedPath}`);
  const fallbackNodes = allNodes(importSvgToLayers(editedSvg).nodes);
  assert.equal(fallbackNodes.some(node => node.name === original.name && node.type === 'rectangle'), false,
    'edited rounded paths must not regain rectangle controls from stale metadata');
  assert.ok(fallbackNodes.some(node => node.type === 'path'),
    'edited rounded geometry remains editable as vector paths');

  const malformedMetadataSvg = sourceSvg.replace(
    'data-tiny-image-star-rounded-rectangle-v1="{&quot;version&quot;:1',
    'data-tiny-image-star-rounded-rectangle-v1="{&quot;version&quot;:2'
  );
  assert.notEqual(malformedMetadataSvg, sourceSvg, 'the exporter emits the versioned rectangle metadata');
  const malformedNodes = allNodes(importSvgToLayers(malformedMetadataSvg).nodes);
  assert.equal(malformedNodes.some(node => node.name === original.name && node.type === 'rectangle'), false,
    'unknown rectangle metadata versions cannot restore native controls');
  assert.ok(malformedNodes.some(node => node.type === 'path'),
    'unknown-version rounded geometry remains editable as paths');
});

test('native phased filters map offsets into recovered local coordinates around child transforms', () => {
  const original = createNode('rectangle', {
    name: 'Transformed staged rectangle', width: 70, height: 58, fill: '#ffffff',
    effects: [
      { id: 'child-inner', type: 'inner-shadow', visible: true, color: '#123456', opacity: 0.4, offsetX: 1, offsetY: -2, blur: 3 },
      { id: 'child-drop', type: 'drop-shadow', visible: true, showShadowBehindNode: false, color: '#010203', opacity: 0.3, offsetX: 3, offsetY: 4, blur: 5 }
    ]
  });
  const sourceSvg = exportNodeToSvg(original)
    .replaceAll('x="-18" y="-19" width="106" height="96"', 'x="-50" y="-50" width="170" height="160"')
    .replace('<rect x="0" y="0"', '<rect transform="rotate(23 35 29)" x="0" y="0"');
  const copy = allNodes(importSvgToLayers(sourceSvg).nodes).find(node => node.name === original.name);
  assert.equal(copy?.type, 'rectangle', 'the tagged primitive remains eligible for native recovery');
  assert.ok(Math.abs(copy.rotation - 23) < 1e-8);
  const drop = copy.effects.find(effect => effect.type === 'drop-shadow');
  const radians = copy.rotation * Math.PI / 180;
  const worldX = Math.cos(radians) * drop.offsetX - Math.sin(radians) * drop.offsetY;
  const worldY = Math.sin(radians) * drop.offsetX + Math.cos(radians) * drop.offsetY;
  assert.ok(Math.abs(worldX - 3) < 1e-8, 'layer rotation maps the local offset back to the SVG filter dx');
  assert.ok(Math.abs(worldY - 4) < 1e-8, 'layer rotation maps the local offset back to the SVG filter dy');
  assert.equal(drop.showShadowBehindNode, false, 'opaque clipped shadows retain the authored clipping flag');

  const clippedRegionSvg = exportNodeToSvg(original)
    .replace('<rect x="0" y="0"', '<rect transform="rotate(23 35 29)" x="0" y="0"');
  assert.throws(() => importSvgToLayers(clippedRegionSvg), error => error.code === 'filter-region-clips-output',
    'retained local offsets still reject SVG filters whose original region clips transformed output');
});

test('native phased filters preserve reflected group offsets when the primitive reflection restores orientation', () => {
  const original = createNode('rectangle', {
    name: 'Reflected staged rectangle', width: 70, height: 58, fill: '#ffffff',
    effects: [
      { id: 'reflected-inner', type: 'inner-shadow', visible: true, color: '#123456', opacity: 0.4, offsetX: 1, offsetY: -2, blur: 3 },
      { id: 'reflected-drop', type: 'drop-shadow', visible: true, showShadowBehindNode: false, color: '#010203', opacity: 0.3, offsetX: 3, offsetY: 4, blur: 5 }
    ]
  });
  const sourceSvg = exportNodeToSvg(original)
    .replaceAll('x="-18" y="-19" width="106" height="96"', 'x="-50" y="-50" width="170" height="160"')
    .replace('<g opacity="1"', '<g transform="matrix(-1 0 0 1 70 0)" opacity="1"')
    .replace('<rect x="0" y="0"', '<rect transform="matrix(-1 0 0 1 70 0)" x="0" y="0"');
  const copy = allNodes(importSvgToLayers(sourceSvg).nodes).find(node => node.name === original.name);
  assert.equal(copy?.type, 'rectangle');
  assert.ok(Math.abs(copy.rotation) < 1e-8, 'the two reflections restore the native shape orientation');
  original.effects.forEach((effect, index) => {
    assert.ok(Math.abs(copy.effects[index].offsetX + effect.offsetX) < 1e-8,
      'filter offsets retain the group reflection along X');
    assert.ok(Math.abs(copy.effects[index].offsetY - effect.offsetY) < 1e-8,
      'the group reflection preserves the filter Y direction');
    assert.equal(copy.effects[index].blur, effect.blur);
  });
});

test('edited or malformed phased regular-shape metadata stays editable vector geometry', () => {
  const original = createNode('star', {
    name: 'Phased edited star', width: 80, height: 72, points: 6, innerRadius: 0.4,
    fill: '#345678', stroke: '#abcdef', strokeWidth: 2,
    effects: [{ id: 'edited-inner', type: 'inner-shadow', visible: true, color: '#102030', opacity: 0.5,
      offsetX: 1, offsetY: 2, blur: 3 }]
  });
  const sourceSvg = exportNodeToSvg(original);
  const fillPolygon = sourceSvg.match(/(<g data-tiny-image-star-paint-stage="fill"[^>]*>\s*<polygon points=")([^"]+)/u);
  assert.ok(fillPolygon, 'the phased export contains editable polygon geometry in its fill stage');
  const [firstPoint, ...remainingPoints] = fillPolygon[2].split(' ');
  const [firstX, firstY] = firstPoint.split(',').map(Number);
  const editedGeometrySvg = sourceSvg.replace(fillPolygon[0],
    `${fillPolygon[1]}${[`${firstX + 0.01},${firstY}`, ...remainingPoints].join(' ')}`);
  const malformedMetadataSvg = sourceSvg.replace(
    'data-tiny-image-star-type="star"',
    'data-tiny-image-star-type="star" data-tiny-image-star-rounded-shape-v1="{&quot;version&quot;:99}"'
  );

  for (const [label, svg] of [['edited geometry', editedGeometrySvg], ['malformed source metadata', malformedMetadataSvg]]) {
    const nodes = allNodes(importSvgToLayers(svg).nodes);
    assert.equal(nodes.some(node => node.name === original.name && node.type === 'star'), false,
      `${label} must not be promoted to native star controls`);
    assert.ok(nodes.some(node => node.type === 'path'), `${label} remains available as editable path geometry`);
  }
});

test('round-trips rounded tagged regular-shape geometry with native star and polygon controls', () => {
  const roundedStar = createNode('star', {
    id: 'rounded-star', name: 'Rounded native candidate', x: 12, y: 18, width: 80, height: 64,
    rotation: -17, points: 7, innerRadius: 0.31, radius: 4, cornerSmoothing: 0.35
  });
  const customCorners = createNode('star', {
    id: 'custom-corners', name: 'Custom star corners', x: 110, y: 18, width: 74, height: 64,
    points: 5, innerRadius: 0.42, cornerSmoothing: 0.2,
    vertexRadii: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  });
  const roundedPolygon = createNode('polygon', {
    id: 'rounded-polygon', name: 'Rounded polygon', x: 210, y: 18, width: 66, height: 64,
    points: 7, radius: 3, cornerSmoothing: 0.15
  });
  const source = createNode('group', {
    name: 'Rounded regular shapes', width: 300, height: 100,
    children: [roundedStar, customCorners, roundedPolygon]
  });
  const sourceSvg = exportNodeToSvg(source);
  const importedRoundedDocument = importSvgToLayers(sourceSvg);
  const roundedImport = allNodes(importedRoundedDocument.nodes);
  const starCopy = roundedImport.find(node => node.name === 'Rounded native candidate');
  const customCornersCopy = roundedImport.find(node => node.name === 'Custom star corners');
  const polygonCopy = roundedImport.find(node => node.name === 'Rounded polygon');
  const positionedCopies = [
    findWithAccumulatedPosition(importedRoundedDocument.nodes, roundedStar.name),
    findWithAccumulatedPosition(importedRoundedDocument.nodes, customCorners.name),
    findWithAccumulatedPosition(importedRoundedDocument.nodes, roundedPolygon.name)
  ];
  assert.equal(starCopy?.type, 'star');
  assert.equal(starCopy.points, roundedStar.points);
  assert.equal(starCopy.innerRadius, roundedStar.innerRadius);
  assert.ok(Math.abs(starCopy.radius - roundedStar.radius) < 1e-8);
  assert.equal(starCopy.cornerSmoothing, roundedStar.cornerSmoothing);
  assert.equal(customCornersCopy?.type, 'star');
  assert.deepEqual(customCornersCopy.vertexRadii, customCorners.vertexRadii);
  assert.equal(customCornersCopy.cornerSmoothing, customCorners.cornerSmoothing);
  assert.equal(polygonCopy?.type, 'polygon');
  assert.equal(polygonCopy.points, roundedPolygon.points);
  assert.ok(Math.abs(polygonCopy.radius - roundedPolygon.radius) < 1e-8);
  assert.equal(polygonCopy.cornerSmoothing, roundedPolygon.cornerSmoothing);
  for (const [index, [copy, original]] of [[starCopy, roundedStar], [customCornersCopy, customCorners], [polygonCopy, roundedPolygon]].entries()) {
    assert.ok(positionedCopies[index], `${original.name} should have an imported position`);
    for (const property of ['x', 'y', 'width', 'height', 'rotation']) {
      const actual = property === 'x' ? positionedCopies[index].x
        : property === 'y' ? positionedCopies[index].y : copy[property];
      assert.ok(Math.abs(actual - original[property]) < 1e-5, `${original.name} ${property} should round-trip`);
    }
  }

  const editedRoundedSvg = sourceSvg.replace(/(<path d="M )(-?\d+(?:\.\d+)?)/u,
    (_match, prefix, x) => `${prefix}${Number(x) + 0.01}`);
  const editedImport = allNodes(importSvgToLayers(editedRoundedSvg).nodes);
  assert.equal(editedImport.some(node => node.name === 'Rounded native candidate' && node.type === 'star'), false,
    'a rounded path whose geometry no longer matches its controls must not be promoted');
  const editedGroup = editedImport.find(node => node.name === 'Rounded native candidate');
  assert.ok(editedGroup?.children.some(node => node.type === 'path'),
    'edited rounded-star geometry remains available as an editable vector path');
});

test('invalid rounded-shape metadata falls back to editable vector geometry', () => {
  const roundedStar = createNode('star', { name: 'Metadata candidate', width: 80, height: 80, radius: 4 });
  const malformedSvg = exportNodeToSvg(roundedStar).replace(
    /data-tiny-image-star-rounded-shape-v1="[^"]*"/u,
    'data-tiny-image-star-rounded-shape-v1="{&quot;version&quot;:99}"'
  );
  const roundedImport = allNodes(importSvgToLayers(exportNodeToSvg(roundedStar)).nodes);
  const malformedImport = allNodes(importSvgToLayers(malformedSvg).nodes);
  assert.equal(malformedImport.some(node => node.name === 'Metadata candidate' && node.type === 'star'), false);
  const malformedGroup = malformedImport.find(node => node.name === 'Metadata candidate');
  assert.ok(malformedGroup?.children.some(node => node.type === 'path'));
  assert.ok(roundedImport.some(node => node.type === 'star'), 'valid metadata restores the native star controls');

  const star = createNode('star', { name: 'Edited native candidate', width: 80, height: 80, points: 5 });
  const svg = exportNodeToSvg(star).replace(/(<polygon points=")([^"]+)/u, (_match, prefix, value) => {
    const [first, ...rest] = value.split(' ');
    const [x, y] = first.split(',').map(Number);
    return `${prefix}${x + 2},${y} ${rest.join(' ')}`;
  });
  const editedImport = allNodes(importSvgToLayers(svg).nodes);
  assert.equal(editedImport.some(node => node.type === 'star'), false,
    'a tagged polygon whose coordinates do not match the regular-shape controls stays editable vector geometry');
  assert.ok(editedImport.some(node => node.type === 'path'), 'edited regular-shape geometry remains an editable vector path');
});

test('tagged regular shapes cannot bypass the SVG vector-point import budget', () => {
  const points = Array.from({ length: 20_001 }, (_, index) => `${index},0`).join(' ');
  importFailure(`<svg width="20001" height="2"><g data-tiny-image-star-type="polygon"><polygon points="${points}"/></g></svg>`, 'resource-limit');
});

test('round-trips simple editor lines as native line layers with direction and stroke controls', () => {
  const diagonal = createNode('line', {
    id: 'native-diagonal', name: 'Native diagonal', x: 12, y: 18, width: 88, height: 31,
    rotation: 19, lineReverseY: true, stroke: '#225588', strokeWidth: 3.5,
    strokeOpacity: 0.65, strokeCap: 'round', strokeJoin: 'bevel', strokePattern: 'solid'
  });
  const horizontal = createNode('line', {
    id: 'native-horizontal', name: 'Native horizontal', x: 15, y: 70, width: 76, height: 0,
    stroke: '#884422', strokeWidth: 2
  });
  const vertical = createNode('line', {
    id: 'native-vertical', name: 'Native vertical', x: 100, y: 12, width: 0, height: 64,
    lineReverseY: true, stroke: '#448822', strokeWidth: 2
  });
  const imported = allNodes(importSvgToLayers(exportNodeToSvg(createNode('group', {
    name: 'Native lines', width: 130, height: 100, children: [diagonal, horizontal, vertical]
  }))).nodes);
  const diagonalCopy = imported.find(node => node.name === 'Native diagonal');
  const horizontalCopy = imported.find(node => node.name === 'Native horizontal');
  const verticalCopy = imported.find(node => node.name === 'Native vertical');
  assert.equal(diagonalCopy?.type, 'line');
  assert.equal(horizontalCopy?.type, 'line');
  assert.equal(verticalCopy?.type, 'line');
  for (const [copy, source] of [[diagonalCopy, diagonal], [horizontalCopy, horizontal], [verticalCopy, vertical]]) {
    for (const property of ['width', 'height', 'rotation']) {
      assert.ok(Math.abs(copy[property] - source[property]) < 1e-5, `${source.name} ${property} should round-trip`);
    }
  }
  assert.equal(diagonalCopy.lineReverseY, true);
  assert.equal(horizontalCopy.lineReverseY, false);
  assert.equal(verticalCopy.lineReverseY, true);
  assert.deepEqual([verticalCopy.width, verticalCopy.height], [0, 64]);
  assert.equal(diagonalCopy.stroke, '#225588');
  assert.equal(diagonalCopy.strokeOpacity, 0.65);
  assert.equal(diagonalCopy.strokeCap, 'round');
  assert.equal(diagonalCopy.strokeJoin, 'bevel');
  assert.ok(Math.abs(diagonalCopy.strokeWidth - 3.5) < 1e-5);
});

test('does not promote tagged editor paths that are not one simple line segment', () => {
  const line = createNode('line', { name: 'Edited line candidate', width: 80, height: 24 });
  const svg = exportNodeToSvg(line).replace(/(L\s+80\s+24)/u, '$1 L 60 12');
  const imported = allNodes(importSvgToLayers(svg).nodes);
  assert.equal(imported.some(node => node.type === 'line'), false);
  assert.ok(imported.some(node => node.type === 'path'), 'modified endpoint geometry remains editable as a vector path');
});

test('round-trips supported editor shadow spread while still rejecting path layers', () => {
  const original = createNode('rectangle', {
    id: 'spread-card', width: 100, height: 60, fill: '#ffffff', radius: 8, rotation: 30,
    effects: [
      { id: 'outer', type: 'drop-shadow', visible: true, color: '#112233', opacity: 0.25, offsetX: 5, offsetY: -2, blur: 3, spread: 4.5 },
      { id: 'inner', type: 'inner-shadow', visible: true, color: '#abcdef', opacity: 0.4, offsetX: 2, offsetY: -3, blur: 5, spread: -2.25 }
    ]
  });
  const svg = exportNodeToSvg(original);
  const importedSpread = importSvgToLayers(svg);
  const spreadLayer = allNodes(importedSpread.nodes).find(node => node.type === 'rectangle');
  assert.ok(spreadLayer, 'editor SVG metadata should retain the native rectangle layer type needed for editable spread');
  assert.ok([spreadLayer.width, spreadLayer.height, spreadLayer.radius].every((value, index) =>
    Math.abs(value - [100, 60, 8][index]) < 1e-6));
  assert.ok(Math.abs(spreadLayer.rotation - 30) < 1e-8, 'the native shape keeps its uniform rotation');
  const shadowEffects = spreadLayer.effects.filter(effect => effect.type.endsWith('shadow'));
  assert.deepEqual(shadowEffects.map(effect => effect.type), ['inner-shadow', 'drop-shadow']);
  assert.ok(Math.abs(shadowEffects[0].spread + 2.25) < 1e-6 && Math.abs(shadowEffects[1].spread - 4.5) < 1e-6,
    'both signed spread values survive a uniform rotation and SVG viewport mapping');
  importFailure(svg.replace('data-tiny-image-star-type="rectangle"', 'data-tiny-image-star-type="path"'), 'unsupported-shadow-spread-target');

  const ellipse = createNode('ellipse', {
    id: 'spread-ellipse', width: 42, height: 28,
    effects: [{ id: 'outer', type: 'drop-shadow', visible: true, color: '#112233', opacity: 0.5, offsetX: 1, offsetY: 2, blur: 1, spread: 2 }]
  });
  const importedEllipse = allNodes(importSvgToLayers(exportNodeToSvg(ellipse)).nodes).find(node => node.type === 'ellipse');
  assert.ok([importedEllipse?.width, importedEllipse?.height, importedEllipse?.effects[0]?.spread].every((value, index) =>
    Math.abs(value - [42, 28, 2][index]) < 1e-6));

  const zeroSpread = createNode('rectangle', {
    id: 'zero-spread-card', width: 100, height: 60, fill: '#ffffff',
    effects: original.effects.map(effect => ({ ...effect, spread: 0 }))
  });
  const importedZeroSpread = importSvgToLayers(exportNodeToSvg(zeroSpread));
  const layer = allNodes(importedZeroSpread.nodes).find(node => node.effects?.length);
  assert.equal(layer.type, 'rectangle', 'metadata-tagged rectangles keep their native shape when spread is zero');
  assert.deepEqual(layer.effects.map(effect => effect.type), ['inner-shadow', 'drop-shadow']);
  assert.ok(layer.effects.every(effect => effect.spread == null || effect.spread === 0),
    'ordinary zero-spread shadow filters remain editable on imported rectangles');

  const malformed = svg.replace('operator="over" result="tis-effect-0-result-0"', 'operator="xor" result="tis-effect-0-result-0"');
  assert.throws(() => importSvgToLayers(malformed), error =>
    error instanceof SvgImportError && error.code === 'unsupported-filter-graph',
  'near-matching spread chains are rejected before target-layer compatibility is considered');
});

test('rejects near-matching inner-shadow graphs instead of importing them as editable effects', () => {
  const markup = `<svg width="100" height="80"><defs><filter id="inner" filterUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="100">
    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blurred"/>
    <feOffset in="blurred" dx="2" dy="-1" result="offset"/>
    <feComposite in="SourceGraphic" in2="offset" operator="xor" result="shape"/>
    <feFlood flood-color="#123456" flood-opacity=".5" result="paint"/>
    <feComposite in="paint" in2="shape" operator="in" result="shadow"/>
    <feComposite in="shadow" in2="SourceGraphic" operator="over" result="result"/>
  </filter></defs><rect width="100" height="80" filter="url(#inner)" fill="#fff"/></svg>`;
  assert.throws(() => importSvgToLayers(markup), error =>
    error instanceof SvgImportError && error.code === 'unsupported-filter-graph' && /exact.*inner-shadow chain/.test(error.message));
});

test('fails closed with actionable errors for unsupported SVG filter graphs and clipping', () => {
  const filter = body => `<svg width="100" height="100"><defs><filter id="fx" filterUnits="userSpaceOnUse" x="-100" y="-100" width="300" height="300">${body}</filter></defs><rect width="100" height="100" filter="url(#fx)" fill="#fff"/></svg>`;
  assert.throws(() => importSvgToLayers(filter('<feColorMatrix type="saturate" values="0"/>')), error =>
    error instanceof SvgImportError && error.code === 'unsupported-filter' && /feColorMatrix/.test(error.message));
  assert.throws(() => importSvgToLayers(filter('<feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blurred"/><feDropShadow in="SourceGraphic"/>')), error =>
    error instanceof SvgImportError && error.code === 'unsupported-filter-graph' && /single SourceGraphic-to-result chain/.test(error.message));
  assert.throws(() => importSvgToLayers(`<svg><defs><filter id="fx"><feGaussianBlur stdDeviation="6"/></filter></defs><rect width="100" height="100" filter="url(#fx)" fill="#fff"/></svg>`), error =>
    error instanceof SvgImportError && error.code === 'filter-region-clips-output' && /enlarge the filter region/.test(error.message));
  assert.throws(() => importSvgToLayers(`<svg><defs><filter id="fx" filterUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120"><feGaussianBlur stdDeviation="1 2"/></filter></defs><rect width="100" height="100" filter="url(#fx)" fill="#fff"/></svg>`), error =>
    error instanceof SvgImportError && error.code === 'unsupported-filter' && /two equal values/.test(error.message));
  assert.throws(() => importSvgToLayers(`<svg><defs><filter id="fx" filterUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140"><feGaussianBlur stdDeviation="2"/></filter></defs><rect width="100" height="100" transform="scale(2 1)" filter="url(#fx)" fill="#fff"/></svg>`), error =>
    error instanceof SvgImportError && error.code === 'unsupported-filter-transform' && /non-uniform/.test(error.message));
  assert.throws(() => importSvgToLayers(filter('<feGaussianBlur in="SourceGraphic" stdDeviation="2"/><feOffset dx="2" dy="2"/>')), error =>
    error instanceof SvgImportError && error.code === 'unsupported-filter' && /feOffset/.test(error.message));
  importFailure(`<svg><defs><clipPath id="clip" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs><rect width="10" height="10" clip-path="url(#clip)"/></svg>`, 'unsupported-clip-path-units');
  importFailure(`<svg><defs><clipPath id="clip"><use href="#shape"/></clipPath></defs><rect width="10" height="10" clip-path="url(#clip)"/></svg>`, 'external-reference');
});

test('reports model-incompatible geometry and paint explicitly', () => {
  importFailure(`<svg><text x="0" y="0">hello</text></svg>`, 'unsupported-text-baseline');
  importFailure(`<svg><g><marker/></g></svg>`, 'unsupported-element');
});

test('imports compound paths with independent closure and even-odd fill into editable contour data', () => {
  const result = importSvgToLayers(`<svg width="120" height="100">
    <path id="donut" d="M 5 5 L 95 5 L 95 95 L 5 95 Z M 25 25 L 25 75 L 75 75 L 75 25 Z M 105 10 L 115 10 L 110 20" fill="#336699" fill-rule="evenodd" stroke="#102030"/>
  </svg>`);
  const nodes = allNodes(result.nodes);
  const fill = nodes.find(node => node.type === 'path' && node.name === 'donut fill');
  const stroke = nodes.find(node => node.type === 'path' && node.name === 'donut stroke');
  assert.ok(fill);
  assert.ok(stroke);
  assert.equal(fill.fillRule, 'evenodd');
  assert.equal(fill.closed, true);
  assert.deepEqual(fill.subpaths.map(contour => contour.closed), [true, true], 'fill geometry implicitly closes every source contour');
  assert.equal(stroke.closed, true);
  assert.deepEqual(stroke.subpaths.map(contour => contour.closed), [true, false], 'stroke geometry preserves source closure per contour');
  assert.ok(fill.points.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1));
  assert.ok(fill.subpaths.flatMap(contour => contour.points).every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1));
});

test('imports a plain SVG text run as an editable native text layer with inherited supported styles', () => {
  const result = importSvgToLayers(`<svg width="300" height="120">
    <g transform="translate(10 20)" fill="#336699" fill-opacity=".5" font-family="Inter, Arial, sans-serif"
       font-size="20" font-weight="700" font-style="italic" text-anchor="middle" dominant-baseline="text-before-edge">
      <text id="headline" x="100" y="5" letter-spacing="1" text-decoration="underline">Hello &amp; world</text>
    </g>
  </svg>`);
  const headline = allNodes(result.nodes).find(node => node.type === 'text');
  assert.ok(headline, 'SVG text imports as a native text layer');
  assert.equal(headline.name, 'headline');
  assert.equal(headline.text, 'Hello & world');
  assert.equal(headline.fontFamily, 'Inter, Arial, sans-serif');
  assert.equal(headline.fontSize, 20);
  assert.equal(headline.fontWeight, 700);
  assert.equal(headline.fontStyle, 'italic');
  assert.equal(headline.letterSpacing, 1);
  assert.equal(headline.color, '#336699');
  assert.equal(headline.fillOpacity, 0.5);
  assert.equal(headline.align, 'center');
  assert.equal(headline.textDecoration, 'underline');
  assert.equal(headline.textFit, 'auto-width');
  const group = allNodes(result.nodes).find(node => node.type === 'group');
  assert.equal(headline.x + group.x + headline.width / 2, 110, 'text-anchor=middle keeps the transformed SVG anchor centered');
  assert.equal(headline.y + group.y, 25, 'text-before-edge maps to the native text top edge');
});

test('imports ordered SVG tspan styles as editable mixed text runs', () => {
  const result = importSvgToLayers(`<svg width="240" height="80">
    <text x="12" y="8" font-size="16" fill="#123456" dominant-baseline="text-before-edge">Hi <tspan style="font-weight:700;fill:#ff0000;font-size:24px;line-height:36px;letter-spacing:1px;text-decoration:underline">there</tspan>!</text>
  </svg>`);
  const text = allNodes(result.nodes).find(node => node.type === 'text');
  assert.equal(text.text, 'Hi there!');
  assert.equal(text.fontSize, 16);
  assert.equal(text.color, '#123456');
  assert.deepEqual(text.textRuns, [
    { text: 'Hi ' },
    { text: 'there', fontSize: 24, fontWeight: 700, lineHeight: 1.5, letterSpacing: 1, textDecoration: 'underline', color: '#ff0000' },
    { text: '!' }
  ]);
  assert.equal(text.textRuns.map(run => run.text).join(''), text.text);
  assert.ok(text.width > 0 && text.width < 300, 'auto-width bounds account for mixed run sizes');
  const document = createDocument();
  document.pages[0].children = result.nodes;
  const restored = allNodes(parseDocument(serializeDocument(document)).pages[0].children).find(node => node.type === 'text');
  assert.deepEqual(restored.textRuns, text.textRuns, 'imported run order and formatting survive local save/reload');
});

test('SVG whitespace collapses across tspan boundaries and keeps the originating run style', () => {
  const text = allNodes(importSvgToLayers(`<svg><text dominant-baseline="text-before-edge">A <tspan fill="#ff0000"> B </tspan> C</text></svg>`).nodes)
    .find(node => node.type === 'text');
  assert.equal(text.text, 'A B C');
  assert.equal(text.textRuns.map(run => run.text).join(''), 'A B C');
  assert.ok(text.textRuns.some(run => run.color === '#ff0000' && run.text === 'B '), 'the collapsed space after a tspan keeps its source formatting');
});

test('imports positively scaled and rotated text without changing its anchor', () => {
  const result = importSvgToLayers(`<svg width="100" height="100"><text id="rotated" x="10" y="20" transform="translate(5 6) rotate(90) scale(2)"
      font-size="12" dominant-baseline="text-before-edge">Hi</text></svg>`);
  const text = allNodes(result.nodes).find(node => node.type === 'text');
  assert.equal(text.rotation, 90);
  assert.equal(text.fontSize, 24);
  assert.equal(text.width, Math.ceil((2 * 12 * 1.25 + 2) * 2));
  const angle = text.rotation * Math.PI / 180;
  const topLeftAfterRotation = {
    x: text.x + text.width / 2 - Math.cos(angle) * text.width / 2 + Math.sin(angle) * text.height / 2,
    y: text.y + text.height / 2 - Math.sin(angle) * text.width / 2 - Math.cos(angle) * text.height / 2
  };
  assert.ok(Math.abs(topLeftAfterRotation.x - (-35)) < 1e-8);
  assert.ok(Math.abs(topLeftAfterRotation.y - 26) < 1e-8);
});

test('uses SVG default x/y coordinates and preserves valid non-BMP text characters', () => {
  const text = allNodes(importSvgToLayers(`<svg><text dominant-baseline="text-before-edge">&#x1f680;</text></svg>`).nodes)
    .find(node => node.type === 'text');
  assert.equal(text.text, '🚀');
  assert.equal(text.x, 0);
  assert.equal(text.y, 0);
});

test('accepts valid literal Unicode in XML and rejects lone surrogates and forbidden numeric characters', () => {
  const literal = allNodes(importSvgToLayers(`<svg><text dominant-baseline="text-before-edge">🚀 café</text></svg>`).nodes)
    .find(node => node.type === 'text');
  assert.equal(literal.text, '🚀 café');
  importFailure(`<svg><text dominant-baseline="text-before-edge">\ud83d</text></svg>`, 'invalid-xml-character');
  importFailure(`<svg><text dominant-baseline="text-before-edge">&#xFFFE;</text></svg>`, 'invalid-xml-character');
  importFailure(`<svg id="bad\udc80"/>`, 'invalid-xml-character');
});

test('rejects SVG text features the native text model cannot represent', () => {
  importFailure(`<svg><text x="0 10" y="0" dominant-baseline="text-before-edge">A</text></svg>`, 'unsupported-text-positioning');
  importFailure(`<svg><text x="0" y="0" dx="2" dominant-baseline="text-before-edge">A</text></svg>`, 'unsupported-text-positioning');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="alphabetic">A</text></svg>`, 'unsupported-text-baseline');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="text-before-edge" stroke="#000">A</text></svg>`, 'unsupported-text-paint');
  importFailure(`<svg><defs><linearGradient id="g"><stop/><stop offset="1"/></linearGradient></defs><text x="0" y="0" dominant-baseline="text-before-edge" fill="url(#g)">A</text></svg>`, 'unsupported-text-paint');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="text-before-edge" textLength="100">A</text></svg>`, 'unsupported-text-feature');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<tspan x="10">B</tspan></text></svg>`, 'unsupported-text-positioning');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<tspan opacity=".5">B</tspan></text></svg>`, 'unsupported-text-opacity');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<tspan fill="#ff000080">B</tspan></text></svg>`, 'unsupported-text-paint');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<tspan text-transform="uppercase">B</tspan></text></svg>`, 'unsupported-text-feature');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<tspan transform="translate(4 0)">B</tspan></text></svg>`, 'unsupported-text-transform');
  importFailure(`<svg><text dominant-baseline="text-before-edge">A<g>B</g></text></svg>`, 'unsupported-text-feature');
  importFailure(`<svg><text x="0" y="0" transform="scale(2 1)" dominant-baseline="text-before-edge">A</text></svg>`, 'unsupported-text-transform');
  importFailure(`<svg><text x="0" y="0" transform="scale(10000)" font-size="100" dominant-baseline="text-before-edge">A</text></svg>`, 'resource-limit');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="text-before-edge" xml:space="preserve">A  B</text></svg>`, 'unsupported-text-whitespace');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="text-before-edge"><script/></text></svg>`, 'active-content');
  importFailure(`<svg><text x="0" y="0" dominant-baseline="text-before-edge">A\u0001B</text></svg>`, 'invalid-xml-character');
  importFailure(`<svg>stray</svg>`, 'unsupported-text');
  importFailure(`<svg><text><![CDATA[A&B]]></text></svg>`, 'unsupported-text-feature');
});

test('imports editable SVG stroke caps, joins, and exact custom dash patterns', () => {
  const result = importSvgToLayers(`<svg><g stroke="#123456" stroke-width="2" stroke-linecap="round" stroke-linejoin="bevel" stroke-dasharray="8 4">
    <path id="dashed" d="M0 0L20 0" fill="none"/>
    <path id="dotted" d="M0 10L20 10" fill="none" stroke-dasharray="0 4"/>
  </g></svg>`);
  const nodes = allNodes(result.nodes);
  const dashed = nodes.find(node => node.name === 'dashed');
  assert.equal(dashed.strokeCap, 'round');
  assert.equal(dashed.strokeJoin, 'bevel');
  assert.equal(dashed.strokePattern, 'dashed');
  const dotted = nodes.find(node => node.name === 'dotted');
  assert.equal(dotted.strokePattern, 'dotted');
  assert.equal(dotted.strokeCap, 'round');
  const custom = allNodes(importSvgToLayers(`<svg>
    <path id="uneven" d="M0 20L20 20" fill="none" stroke="#000" stroke-width="2" stroke-dasharray="3 5"/>
    <path id="invisible-dots" d="M0 30L20 30" fill="none" stroke="#000" stroke-width="2" stroke-dasharray="0 4"/>
  </svg>`).nodes);
  assert.equal(custom.find(node => node.name === 'uneven').strokePattern, 'custom');
  assert.deepEqual(custom.find(node => node.name === 'uneven').strokeDashArray, [3, 5]);
  assert.equal(custom.find(node => node.name === 'invisible-dots').strokePattern, 'custom');
  assert.deepEqual(custom.find(node => node.name === 'invisible-dots').strokeDashArray, [0, 4]);
  importFailure(`<svg><path d="M0 0L20 0" stroke="#000" stroke-width="2" stroke-dasharray="0 0"/></svg>`, 'invalid-stroke');
  importFailure(`<svg><path d="M0 0L20 0" stroke="#000" stroke-width="2" stroke-dasharray="1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17"/></svg>`, 'invalid-stroke');
});

test('preserves inherited SVG dash lengths across child width changes and lets none clear them', () => {
  const inherited = allNodes(importSvgToLayers(`<svg><g stroke="#123456" stroke-width="1" stroke-dasharray="4 2"><path id="child" d="M0 0L20 0" stroke-width="2"/></g></svg>`).nodes);
  const inheritedStroke = inherited.find(node => node.name === 'child stroke');
  assert.equal(inheritedStroke.strokePattern, 'custom');
  assert.deepEqual(inheritedStroke.strokeDashArray, [4, 2]);
  const result = importSvgToLayers(`<svg><g stroke="#123456" stroke-width="1" stroke-dasharray="4 2">
    <path id="cleared" d="M0 0L20 0" stroke-width="2" stroke-dasharray="none"/>
    <path id="redeclared" d="M0 10L20 10" stroke-width="2" stroke-dasharray="8 4"/>
  </g></svg>`);
  const nodes = allNodes(result.nodes);
  assert.equal(nodes.find(node => node.name === 'cleared stroke').strokePattern, 'solid');
  assert.equal(nodes.find(node => node.name === 'redeclared stroke').strokePattern, 'dashed');
});

test('preserves the SVG default, explicit, and inherited miter limits on editable strokes', () => {
  const result = importSvgToLayers(`<svg>
    <path id="default-limit" d="M0 0L20 0L10 1Z" fill="none" stroke="#000000"/>
    <path id="custom-limit" d="M0 10L20 10L10 11Z" fill="none" stroke="#000000" stroke-miterlimit="7"/>
    <g stroke-miterlimit="6"><path id="inherited-limit" d="M0 20L20 20L10 21Z" fill="none" stroke="#000000"/></g>
  </svg>`);
  const nodes = allNodes(result.nodes);
  assert.equal(nodes.find(node => node.name === 'default-limit').strokeMiterLimit, 4);
  assert.equal(nodes.find(node => node.name === 'custom-limit').strokeMiterLimit, 7);
  assert.equal(nodes.find(node => node.name === 'inherited-limit').strokeMiterLimit, 6);
});

test('imports gradients that map faithfully to editable linear and radial fills', () => {
  const result = importSvgToLayers(`<svg width="100" height="100">
    <defs>
      <linearGradient id="horizontal"><stop offset="0" stop-color="#ff0000"/><stop offset="100%" style="stop-color:#0000ff"/></linearGradient>
      <linearGradient id="vertical" gradientTransform="rotate(90 .5 .5)"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>
      <linearGradient id="shifted" x1="25%" x2="75%"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
      <radialGradient id="radial" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ff0000" stop-opacity=".5"/><stop offset="1" stop-color="#0000ff" stop-opacity=".5"/></radialGradient>
    </defs>
    <rect id="wide" width="100" height="40" fill="url(#horizontal)"/>
    <rect id="tall" y="45" width="20" height="40" fill="url(#vertical)"/>
    <rect id="square" x="50" y="50" width="40" height="40" fill="url(#radial)"/>
    <rect id="shifted-fill" y="90" width="20" height="10" fill="url(#shifted)"/>
  </svg>`);
  const nodes = allNodes(result.nodes);
  const wide = nodes.find(node => node.name === 'wide');
  assert.equal(wide.fillGradient.type, 'linear');
  assert.equal(wide.fillGradient.angle, 0);
  assert.deepEqual(wide.fillGradient.stops.map(({ color, position }) => [color, position]), [['#ff0000', 0], ['#0000ff', 1]]);
  assert.deepEqual(wide.fillGradient.geometry.handles, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  assert.equal(new Set(wide.fillGradient.stops.map(stop => stop.id)).size, 2);
  const tall = nodes.find(node => node.name === 'tall');
  assert.equal(tall.fillGradient.type, 'linear');
  assert.ok(Math.abs(tall.fillGradient.angle - 90) < 1e-6);
  const square = nodes.find(node => node.name === 'square');
  assert.equal(square.fillGradient.type, 'radial');
  assert.equal(square.fillOpacity, 0.5);
  assert.deepEqual(square.fillGradient.geometry.handles, [{ x: .5, y: .5 }, { x: 1, y: .5 }, { x: .5, y: 1 }]);
  assert.equal(square.fillGradient.stops[1].position, 1, 'radial stop positions stay attached to the explicit radius handles');
  const shifted = nodes.find(node => node.name === 'shifted-fill');
  assert.deepEqual(shifted.fillGradient.geometry.handles, [{ x: .25, y: 0 }, { x: .75, y: 0 }, { x: .25, y: .5 }]);
  assert.deepEqual(shifted.fillGradient.stops.map(stop => stop.position), [0, 1]);
});

test('imports and round-trips skewed linear and elliptical radial gradient geometry', () => {
  const imported = importSvgToLayers(`<svg width="180" height="100">
    <defs>
      <linearGradient id="skewed" x1="10%" y1="20%" x2="90%" y2="70%" gradientTransform="matrix(1 .2 .35 1 .05 -.1)">
        <stop offset="0" stop-color="#112233"/><stop offset=".4" stop-color="#44aa88"/><stop offset="1" stop-color="#ddeeff"/>
      </linearGradient>
      <radialGradient id="ellipse" cx="40%" cy="55%" r="35%" gradientTransform="matrix(1 .2 .4 .75 .1 .15)">
        <stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>
      </radialGradient>
    </defs>
    <rect id="skewed-layer" x="10" y="10" width="100" height="50" fill="url(#skewed)"/>
    <rect id="elliptical-layer" x="20" y="20" width="80" height="40" fill="url(#ellipse)"/>
  </svg>`);
  const nodes = allNodes(imported.nodes);
  const cases = [
    ['skewed-layer', 'linear'], ['elliptical-layer', 'radial']
  ];
  const close = (left, right) => Math.abs(left - right) < 1e-9;
  for (const [name, type] of cases) {
    const original = nodes.find(node => node.name === name);
    assert.equal(original.fillGradient.type, type);
    assert.equal(original.fillGradient.geometry.handles.length, 3);
    const svg = exportNodeToSvg(original);
    assert.match(svg, type === 'linear' ? /<linearGradient[^>]*gradientTransform="matrix\(/ : /<radialGradient[^>]*gradientTransform="matrix\(/);
    const roundTripped = allNodes(importSvgToLayers(svg).nodes).find(node => node.fillGradient?.type === type);
    assert.deepEqual(roundTripped.fillGradient.stops.map(({ color, position }) => [color, position]),
      original.fillGradient.stops.map(({ color, position }) => [color, position]));
    original.fillGradient.geometry.handles.forEach((handle, index) => {
      assert.ok(close(roundTripped.fillGradient.geometry.handles[index].x, handle.x), `${name} handle ${index} x`);
      assert.ok(close(roundTripped.fillGradient.geometry.handles[index].y, handle.y), `${name} handle ${index} y`);
    });
  }
});

test('rejects SVG gradients the editable fill model would render differently', () => {
  importFailure(`<svg><rect width="10" height="10" fill="url(#missing)"/></svg>`, 'missing-gradient');
  importFailure(`<svg><rect width="20" height="10" fill="url(#repeat)"/><defs><linearGradient id="repeat" spreadMethod="repeat"><stop/><stop offset="1"/></linearGradient></defs></svg>`, 'unsupported-gradient');
  importFailure(`<svg><rect width="20" height="10" fill="url(#alpha)"/><defs><linearGradient id="alpha"><stop stop-opacity=".2"/><stop offset="1" stop-opacity=".8"/></linearGradient></defs></svg>`, 'unsupported-gradient');
  importFailure(`<svg><rect width="20" height="10" fill="url(#focus)"/><defs><radialGradient id="focus" fx="20%"><stop/><stop offset="1"/></radialGradient></defs></svg>`, 'unsupported-gradient');
  importFailure(`<svg><rect width="20" height="10" fill="url(#singular)"/><defs><linearGradient id="singular" gradientTransform="scale(1 0)"><stop/><stop offset="1"/></linearGradient></defs></svg>`, 'unsupported-gradient');
  importFailure(`<svg><rect width="20" height="10" fill="url(#near-singular)"/><defs><linearGradient id="near-singular" gradientTransform="matrix(1 1 1 1.000000000000001 0 0)"><stop/><stop offset="1"/></linearGradient></defs></svg>`, 'unsupported-gradient');
  importFailure(`<svg><rect width="20" height="10" fill="url(#inner)"/><defs><radialGradient id="inner" fr="10%"><stop/><stop offset="1"/></radialGradient></defs></svg>`, 'unsupported-gradient');
  importFailure(`<svg><rect width="20" height="10" fill="url(#bad)"/><defs><linearGradient id="bad" href="#other"><stop/><stop offset="1"/></linearGradient></defs></svg>`, 'external-reference');
});

test('rejects oversized path point counts during bounded preflight before building point arrays', () => {
  const repeatedSegments = 'L1 1'.repeat(240_000);
  const oversized = `<svg><path d="M0 0${repeatedSegments}" fill="#000" stroke="#f00"/></svg>`;
  assert.ok(oversized.length < 1_000_000, 'regression input is the review-sized ~960 KB path');
  assert.throws(() => importSvgToLayers(oversized), error => {
    assert.ok(error instanceof SvgImportError);
    assert.equal(error.code, 'resource-limit');
    assert.match(error.message, /20000 points/);
    return true;
  });
});

test('applies a cumulative point budget across paths, not only a per-path cap', () => {
  const path = `M0 0${'L1 1'.repeat(10_000)}`;
  const markup = `<svg><path d="${path}" fill="#000"/><path d="${path}" fill="#000"/></svg>`;
  assert.throws(() => importSvgToLayers(markup), error => error instanceof SvgImportError
    && error.code === 'resource-limit' && /20000 points/.test(error.message));
});

function alterAlignmentMetadata(svg, change) {
  return svg.replace(/data-tiny-image-star-aligned-strokes-v1="([^"]+)"/, (_match, value) => {
    const decoded = value.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
    const payload = JSON.parse(decoded);
    change(payload);
    return `data-tiny-image-star-aligned-strokes-v1="${JSON.stringify(payload).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}"`;
  });
}

test('aligned native SVG round-trip retains rounded primitive and compound path controls and every stroke paint', () => {
  const shapes = [
    ['rectangle', { cornerRadii: { topLeft: 12, topRight: 5, bottomRight: 18, bottomLeft: 0 }, cornerSmoothing: .5 }],
    ['ellipse', { arcData: { startingAngle: 0, endingAngle: Math.PI * 1.75, innerRadius: .35 } }],
    ['star', { points: 6, innerRadius: .4, vertexRadii: [2, 0, 4, 0, 3, 0, 5, 0, 6, 0, 7, 0], cornerSmoothing: .3 }],
    ['polygon', { points: 5, radius: 6, cornerSmoothing: .4 }],
    ['path', { closed: true, fillRule: 'evenodd', points: [{ x: 0, y: 0 }, { x: 1, y: 0, out: { x: 0, y: .3 } }, { x: 1, y: 1 }, { x: 0, y: 1 }], subpaths: [{ closed: true, points: [{ x: .3, y: .3 }, { x: .7, y: .3 }, { x: .7, y: .7 }, { x: .3, y: .7 }] }] }]
  ];
  for (const [type, geometry] of shapes) {
    const original = createNode(type, { name: `Aligned native ${type}`, width: 120, height: 90, rotation: 17,
      fill: '#abcdef', fillOpacity: .45, ...geometry, strokes: [
        createStroke({ id: 'inside-paint', alignment: 'inside', color: '#123456', width: 7, opacity: .4,
          pattern: 'custom', dashArray: [8, 2, 3, 2], cap: 'round', join: 'bevel' }),
        createStroke({ id: 'outside-paint', alignment: 'outside', color: '#654321', width: 3, opacity: .7,
          gradient: createGradientFill('radial') })
      ] });
    const copy = allNodes(importSvgToLayers(exportNodeToSvg(original)).nodes).find(node => node.name === original.name);
    assert.equal(copy?.type, type);
    for (const [key, value] of Object.entries(geometry)) assert.deepEqual(copy[key], value, `${type} preserves ${key}`);
    assert.ok(Math.abs(copy.rotation - 17) < 1e-8);
    assert.equal(copy.fillOpacity, .45);
    assert.deepEqual(copy.strokes.map(stroke => [stroke.alignment, stroke.width, stroke.opacity]), [['inside', 7, .4], ['outside', 3, .7]]);
    assert.deepEqual(copy.strokes[0].dashArray, [8, 2, 3, 2]);
    assert.deepEqual(copy.strokes[1].gradient, original.strokes[1].gradient);
    const saved = createDocument(); saved.pages[0].children = [copy];
    assert.deepEqual(parseDocument(serializeDocument(saved)).pages[0].children[0].strokes, copy.strokes,
      'native alignment survives saved design validation');
  }
});

test('aligned SVG native recovery preserves per-side widths and fill/inner-shadow/stroke effect phases', () => {
  const original = createNode('rectangle', { name: 'Independent aligned sides', width: 100, height: 80,
    radius: 8, fill: '#abcdef', strokes: [createStroke({ alignment: 'outside', width: 3, color: '#123456',
      opacity: .6, sideMode: 'custom', sideWidths: { top: 2, right: 3, bottom: 0, left: 5 } })] });
  const copy = allNodes(importSvgToLayers(exportNodeToSvg(original)).nodes).find(node => node.name === original.name);
  assert.equal(copy?.type, 'rectangle');
  assert.deepEqual(copy.strokes[0].sideWidths, original.strokes[0].sideWidths);
  assert.equal(copy.strokes[0].alignment, 'outside');
  assert.equal(copy.strokes[0].width, 3);
  const star = createNode('star', { name: 'Aligned phased star', width: 90, height: 80, points: 6, radius: 3,
    fill: '#aabbcc', strokes: [createStroke({ alignment: 'inside', width: 5, color: '#123456' })], effects: [
      { id: 'inner', type: 'inner-shadow', visible: true, color: '#123456', opacity: .5, offsetX: 1, offsetY: 2, blur: 3 },
      { id: 'drop', type: 'drop-shadow', visible: true, color: '#000000', opacity: .4, offsetX: -2, offsetY: 4, blur: 5, showShadowBehindNode: true }
    ] });
  const svg = exportNodeToSvg(star);
  assert.match(svg, /data-tiny-image-star-paint-phases="layer-v1"/);
  const phasedCopy = allNodes(importSvgToLayers(svg).nodes).find(node => node.name === star.name);
  assert.equal(phasedCopy?.type, 'star');
  assert.equal(phasedCopy.strokes[0].alignment, 'inside');
  assert.equal(phasedCopy.strokes[0].width, 5);
  star.effects.forEach((effect, index) => {
    for (const key of Object.keys(effect).filter(key => key !== 'id')) assert.equal(phasedCopy.effects[index][key], effect[key]);
  });
});

test('closed aligned SVG networks preserve native graph identities and never trust stale recovery metadata', () => {
  const geometry = vectorNetworkGeometryFromAnchors([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }], { closed: true });
  const original = createNode('network', { name: 'Aligned graph', width: 100, height: 80, ...geometry,
    fill: '#abcdef', strokes: [createStroke({ alignment: 'outside', width: 5, color: '#123456' })] });
  const source = exportNodeToSvg(original);
  const copy = allNodes(importSvgToLayers(source).nodes).find(node => node.type === 'network');
  assert.ok(copy);
  assert.deepEqual(copy.vertices, original.vertices);
  assert.deepEqual(copy.edges, original.edges);
  assert.deepEqual(copy.faces, original.faces);
  assert.equal(copy.strokes[0].alignment, 'outside');
  for (const changed of [source.replace(/ data-tiny-image-star-aligned-strokes-v1="[^"]+"/, ''),
    source.replace('stroke-width="10"', 'stroke-width="14"')]) {
    const nodes = allNodes(importSvgToLayers(changed).nodes);
    assert.equal(nodes.some(node => node.type === 'network'), false,
      'old graph metadata cannot override the actual masked SVG after an alignment graph edit');
    assert.ok(nodes.some(node => node.maskMode === 'luminance'));
    assert.ok(nodes.some(node => node.type === 'path'));
  }
});

test('aligned SVG recovery rejects altered metadata, geometry, paint, masks and unrepresented children without overwriting live SVG', () => {
  const original = createNode('rectangle', { name: 'Untrusted alignment metadata', width: 100, height: 80,
    fill: '#abcdef', strokes: [createStroke({ alignment: 'outside', width: 6, color: '#123456' })] });
  const source = exportNodeToSvg(original);
  const changes = [
    alterAlignmentMetadata(source, payload => { payload.node.strokes[0].alignment = 'inside'; }),
    alterAlignmentMetadata(source, payload => { payload.node.strokes[0].width = 3; }),
    alterAlignmentMetadata(source, payload => { payload.node.componentId = 'untrusted-source'; }),
    alterAlignmentMetadata(source, payload => { payload.node.strokes[0].assetId = 'untrusted-image'; }),
    alterAlignmentMetadata(source, payload => { payload.node.strokes[0].variableBindings = { color: 'untrusted-variable' }; }),
    alterAlignmentMetadata(source, payload => { (payload.node.effects ||= []).push({ id: 'ignored', type: 'layer-blur', visible: false, radius: 3, imageFill: { assetId: 'untrusted-image' } }); }),
    source.replace('stroke-width="12"', 'stroke-width="18"'),
    source.replace('stroke="#123456"', 'stroke="#fedcba"'),
    source.replace('fill="#000000" fill-opacity="1"', 'fill="#ffffff" fill-opacity="1"'),
    source.replace('fill="#abcdef"', 'fill="#fedcba"'),
    source.replace('</title>', '</title><rect width="10" height="10" fill="#ff0000"/>')
  ];
  for (const changed of changes) {
    const nodes = allNodes(importSvgToLayers(changed).nodes);
    assert.equal(nodes.some(node => node.type === 'rectangle' && node.name === original.name), false,
      'source and referenced definitions must exactly match the regenerated aligned graph');
    assert.ok(nodes.some(node => node.maskMode === 'luminance'));
    assert.ok(nodes.some(node => node.type === 'path'));
  }
  const editedPaintNodes = allNodes(importSvgToLayers(changes[7]).nodes);
  assert.ok(editedPaintNodes.some(node => node.stroke === '#fedcba' && node.strokeWidth === 12),
    'generic fallback retains the edited doubled SVG stroke rather than stale native paint');
  const whiteMaskNodes = allNodes(importSvgToLayers(changes[8]).nodes);
  assert.equal(whiteMaskNodes.some(node => node.fill === '#000000'), false,
    'the generic fallback honors the actual edited mask paint');
});

test('ordinary compound luminance mask import retains white/black source groups across SVG and design save', () => {
  const markup = '<svg width="120" height="90"><defs><mask id="cutout" mask-type="luminance" color-interpolation="sRGB" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="120" height="90"><g><rect width="120" height="90" fill="#ffffff"/><g transform="translate(15 10)"><rect width="30" height="25" fill="#000000"/><ellipse cx="55" cy="35" rx="18" ry="15" fill="#000000"/></g></g></mask></defs><rect width="120" height="90" fill="#123456" mask="url(#cutout)"/></svg>';
  const imported = importSvgToLayers(markup);
  const wrapper = allNodes(imported.nodes).find(node => node.maskMode === 'luminance');
  const source = wrapper.children.find(node => node.id === wrapper.maskSourceId);
  assert.equal(source.type, 'group');
  assert.equal(allNodes([source]).filter(node => node.fill === '#000000').length, 2);
  const saved = createDocument(); saved.pages[0].children = imported.nodes;
  assert.equal(allNodes(parseDocument(serializeDocument(saved)).pages[0].children).filter(node => node.maskMode === 'luminance').length, 1);
  const roundTrip = importSvgToLayers(exportNodeToSvg(imported.nodes[0]));
  assert.equal(allNodes(roundTrip.nodes).filter(node => node.fill === '#000000').length, 2);
  assert.ok(allNodes(roundTrip.nodes).some(node => node.maskMode === 'luminance'));
});

test('aligned native SVG recovery resolves bound transparent primary stroke and fill colors without retaining variable authority', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Export colors');
  const color = createVariable(document, collection.id, 'Resolved paint', 'color', '#fedcba');
  for (const type of ['rectangle', 'network']) {
    const original = createNode(type, { name: `Bound aligned ${type}`, width: 100, height: 80,
      ...(type === 'network' ? vectorNetworkGeometryFromAnchors([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }], { closed: true }) : {}),
      fill: 'transparent', strokes: [createStroke({ alignment: 'outside', width: 4, color: 'transparent' })] });
    addNode(document, original);
    assert.equal(bindColorVariable(document, original.id, color.id, 'fill'), true);
    assert.equal(bindColorVariable(document, original.id, color.id, 'stroke'), true);
    const svg = exportNodeToSvg(original, { document });
    assert.match(svg, /stroke="#fedcba"[^>]*stroke-width="8"/);
    const copy = allNodes(importSvgToLayers(svg).nodes).find(node => node.name === original.name);
    assert.equal(copy?.type, type);
    assert.equal(copy.fill, '#fedcba');
    assert.equal(copy.strokes[0].color, '#fedcba');
    assert.equal(copy.strokes[0].alignment, 'outside');
    assert.equal(copy.fillVariableId, undefined);
    assert.equal(copy.strokeVariableId, undefined);
    assert.equal(copy.variableBindings, undefined);
    assert.equal(original.strokes[0].color, 'transparent', 'SVG snapshot resolution never mutates the live design');
  }
});

test('aligned native SVG recovery scales authored local widths, dashes, rounded controls and effects exactly once', () => {
  const original = createNode('rectangle', { name: 'Scaled aligned controls', width: 100, height: 80,
    radius: 6, fill: '#abcdef', strokes: [createStroke({ alignment: 'inside', width: 4, color: '#123456', pattern: 'custom', dashArray: [8, 3] })],
    effects: [{ id: 'drop', type: 'drop-shadow', visible: true, color: '#000000', opacity: .4,
      offsetX: 2, offsetY: -3, blur: 5, showShadowBehindNode: true }] });
  const svg = exportNodeToSvg(original).replace('<g opacity="1"', '<g transform="matrix(0 2 -2 0 200 0)" opacity="1"');
  const copy = allNodes(importSvgToLayers(svg).nodes).find(node => node.name === original.name);
  assert.equal(copy?.type, 'rectangle');
  assert.equal(copy.width, 200); assert.equal(copy.height, 160);
  assert.equal(copy.rotation, 90); assert.equal(copy.radius, 12);
  assert.equal(copy.strokes[0].width, 8);
  assert.deepEqual(copy.strokes[0].dashArray, [16, 6]);
  assert.equal(copy.effects[0].offsetX, 4); assert.equal(copy.effects[0].offsetY, -6); assert.equal(copy.effects[0].blur, 10);
});

test('aligned native SVG recovery honors edited root and ancestor inherited stroke defaults', () => {
  const original = createNode('rectangle', { name: 'Inherited aligned paint', width: 100, height: 80,
    fill: '#abcdef', strokes: [createStroke({ alignment: 'outside', width: 6, color: '#123456' })] });
  const source = exportNodeToSvg(original);
  const cases = [
    ['stroke-opacity=".5"', stroke => assert.equal(stroke.opacity, .5)],
    ['stroke-linecap="round"', stroke => assert.equal(stroke.strokeCap, 'round')],
    ['stroke-linejoin="bevel"', stroke => assert.equal(stroke.strokeJoin, 'bevel')],
    ['stroke-dasharray="3 1"', stroke => assert.deepEqual(stroke.strokeDashArray, [3, 1])]
  ];
  for (const [attributes, verify] of cases) {
    for (const changed of [source.replace('<svg ', `<svg ${attributes} `),
      source.replace('<g opacity="1"', `<g ${attributes}><g opacity="1"`).replace('</svg>', '</g></svg>')]) {
      const nodes = allNodes(importSvgToLayers(changed).nodes);
      assert.equal(nodes.some(node => node.type === 'rectangle' && node.name === original.name), false,
        `${attributes} prevents stale native paint from replacing computed SVG style`);
      const stroke = nodes.find(node => node.stroke === '#123456' && node.strokeWidth === 12);
      assert.ok(stroke);
      verify(stroke);
      assert.ok(nodes.some(node => node.maskMode === 'luminance'));
    }
  }
});

test('aligned masks retain fill-rule inherited from root and defs independently of referring ancestors', () => {
  const original = createNode('path', { name: 'Inherited compound coverage', width: 100, height: 80,
    closed: true, fill: '#abcdef', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    subpaths: [{ closed: true, points: [{ x: .3, y: .3 }, { x: .7, y: .3 }, { x: .7, y: .7 }, { x: .3, y: .7 }] }],
    strokes: [createStroke({ alignment: 'outside', width: 6, color: '#123456' })] });
  const source = exportNodeToSvg(original);
  for (const changed of [source.replace('<svg ', '<svg fill-rule="evenodd" '), source.replace('<defs>', '<defs fill-rule="evenodd">')]) {
    const nodes = allNodes(importSvgToLayers(changed).nodes);
    assert.equal(nodes.some(node => node.id.includes('-aligned-')), false,
      'both body and referenced-definition inherited defaults must match before native promotion');
    const blackCutout = nodes.find(node => node.fill === '#000000' && node.subpaths?.length);
    assert.ok(blackCutout);
    assert.equal(blackCutout.fillRule, 'evenodd', 'actual definition inheritance controls the compound hole');
  }
  const ancestorOnly = source.replace('<g opacity="1"', '<g fill-rule="evenodd"><g opacity="1"').replace('</svg>', '</g></svg>');
  const nodes = allNodes(importSvgToLayers(ancestorOnly).nodes);
  const paintedFill = nodes.find(node => node.fill === '#abcdef' && node.subpaths?.length);
  const blackCutout = nodes.find(node => node.fill === '#000000' && node.subpaths?.length);
  assert.equal(paintedFill.fillRule, 'evenodd');
  assert.equal(blackCutout.fillRule, 'nonzero', 'mask definitions inherit their own SVG ancestor context, not the referring layer');
});

test('aligned native SVG recovery never resurrects inherited hidden geometry and preserves translation/opacity-only wrappers', () => {
  const original = createNode('rectangle', { name: 'Visibility guarded alignment', width: 100, height: 80,
    fill: '#abcdef', strokes: [createStroke({ alignment: 'inside', width: 6, color: '#123456' })] });
  const source = exportNodeToSvg(original);
  for (const hidden of [source.replace('<svg ', '<svg visibility="hidden" '),
    source.replace('<g opacity="1"', '<g visibility="hidden"><g opacity="1"').replace('</svg>', '</g></svg>')]) {
    const nodes = allNodes(importSvgToLayers(hidden).nodes);
    assert.equal(nodes.some(node => node.name === original.name), false);
    assert.equal(nodes.some(node => node.stroke === '#123456'), false);
  }
  const wrapped = source.replace('<g opacity="1"', '<g opacity=".6" transform="translate(20 10)"><g opacity="1"').replace('</svg>', '</g></svg>');
  const nodes = allNodes(importSvgToLayers(wrapped).nodes);
  const copy = nodes.find(node => node.name === original.name);
  assert.equal(copy?.type, 'rectangle');
  assert.equal(copy.strokes[0].alignment, 'inside');
  assert.equal(copy.strokes[0].width, 6);
  const parent = nodes.find(node => node.type === 'group' && node.children.some(child => child.id === copy.id));
  assert.equal(parent.opacity, .6);
  const positioned = findWithAccumulatedPosition(importSvgToLayers(wrapped).nodes, original.name);
  assert.equal(positioned.x, 20); assert.equal(positioned.y, 10);
});

test('aligned generic masks explicitly reject inherited visible mask strokes instead of silently dropping their coverage', () => {
  const original = createNode('rectangle', { width: 100, height: 80, fill: '#abcdef',
    strokes: [createStroke({ alignment: 'outside', width: 6, color: '#123456' })] });
  const source = exportNodeToSvg(original);
  for (const changed of [source.replace('<svg ', '<svg stroke="#ff0000" '),
    source.replace('<defs>', '<defs stroke="#ff0000">')]) {
    assert.throws(() => importSvgToLayers(changed), error => error instanceof SvgImportError
      && error.code === 'unsupported-mask-graph' && /strokes/.test(error.message));
  }
});
