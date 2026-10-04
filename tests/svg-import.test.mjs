import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createNode, parseDocument, serializeDocument } from '../src/model.js';
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
    <rect id="shadowed" x="0" y="0" width="100" height="80" style="filter: url(#shadow)" fill="#fff"/>
  </svg>`);
  const nodes = allNodes(result.nodes);
  const blur = nodes.find(node => node.name === 'blurred');
  assert.deepEqual(blur.effects.map(({ type, radius }) => ({ type, radius })), [{ type: 'layer-blur', radius: 4 }]);
  const shadow = nodes.find(node => node.name === 'shadowed');
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
    { type: 'layer-blur', color: undefined, opacity: undefined, offsetX: undefined, offsetY: undefined, blur: undefined, radius: 1 },
    { type: 'inner-shadow', color: '#abcdef', opacity: 0.4, offsetX: 2, offsetY: -3, blur: 5, radius: undefined },
    { type: 'inner-shadow', color: '#102030', opacity: 0.75, offsetX: -4, offsetY: 6, blur: 2, radius: undefined },
    { type: 'drop-shadow', color: '#112233', opacity: 0.25, offsetX: 5, offsetY: -2, blur: 3, radius: undefined }
  ]);
});

test('rejects shadow spread when SVG geometry would import as a layer type that cannot preserve it', () => {
  const original = createNode('rectangle', {
    id: 'spread-card', width: 100, height: 60, fill: '#ffffff',
    effects: [
      { id: 'outer', type: 'drop-shadow', visible: true, color: '#112233', opacity: 0.25, offsetX: 5, offsetY: -2, blur: 3, spread: 4.5 },
      { id: 'inner', type: 'inner-shadow', visible: true, color: '#abcdef', opacity: 0.4, offsetX: 2, offsetY: -3, blur: 5, spread: -2.25 }
    ]
  });
  const svg = exportNodeToSvg(original);
  importFailure(svg, 'unsupported-shadow-spread-target');

  const zeroSpread = createNode('rectangle', {
    id: 'zero-spread-card', width: 100, height: 60, fill: '#ffffff',
    effects: original.effects.map(effect => ({ ...effect, spread: 0 }))
  });
  const importedZeroSpread = importSvgToLayers(exportNodeToSvg(zeroSpread));
  const layer = allNodes(importedZeroSpread.nodes).find(node => node.effects?.length);
  assert.deepEqual(layer.effects.map(effect => effect.type), ['inner-shadow', 'drop-shadow']);
  assert.ok(layer.effects.every(effect => effect.spread == null || effect.spread === 0),
    'ordinary zero-spread shadow filters remain editable on imported paths');

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
