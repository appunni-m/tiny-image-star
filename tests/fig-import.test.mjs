import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { zipSync } from 'fflate';
import { encodeCommandsBlob, encodeVectorNetwork, encodeVectorNetworkBlob } from 'openfig-core';
import { convertFigDocument, importFigBytes } from '../src/fig-import.js';
import { componentPropertyExposureGroups } from '../src/component-property-exposure.js';
import { parseDocument, serializeDocument, switchComponentInstanceVariant, syncAllComponentInstances } from '../src/model.js';
import { multiplyAffine, nodeLocalToPageTransform, nodeToParentTransform, transformPoint } from '../src/transform-geometry.js';
import { FIG_IMPORT_LIMITS, preflightFigArchive } from '../src/fig-import-preflight.js';
import { applyAutoLayout, gridTrackLayout } from '../src/layout-engine.js';
import { gradientFillToCSS } from '../src/fills.js';

const fixture = name => new URL(`./fixtures/fig-import/${name}`, import.meta.url);
const circlePath = fixture('circle-v101.fig');
const vectorPath = fixture('openfigs-v106.fig');

function node(type, localID, parent, position, properties = {}) {
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

function canvasWithMessage(message) {
  const schema = new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]);
  const bytes = new Uint8Array(12 + 4 + schema.length + 4 + message.length);
  bytes.set(new TextEncoder().encode('fig-kiwi'));
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 101, true);
  let offset = 12;
  view.setUint32(offset, schema.length, true); offset += 4;
  bytes.set(schema, offset); offset += schema.length;
  view.setUint32(offset, message.length, true); offset += 4;
  bytes.set(message, offset);
  return bytes;
}

function zip(entries) {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, [data, { level: 0 }]])), { level: 0 });
}

function canvasDataOffset(bytes, name = 'canvas.fig') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const entryName = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataOffset = offset + 30 + nameLength + extraLength;
    if (entryName === name) return dataOffset;
    offset = dataOffset + view.getUint32(offset + 18, true);
  }
  throw new Error(`Could not find ${name} in the test ZIP archive.`);
}

test('imports pinned .fig sample files from two parser format versions as editable local layers', async () => {
  const circleBytes = new Uint8Array(await readFile(circlePath));
  const vectorBytes = new Uint8Array(await readFile(vectorPath));
  assert.equal(createHash('sha256').update(circleBytes).digest('hex'), '5f8d89ce07c06615323ad5406cacc41e8da78d8fc0439ad0cdb2c2ba7e0d4038');
  assert.equal(createHash('sha256').update(vectorBytes).digest('hex'), 'eecd50d4d4135ab4b146bbbb7079b7b0743ee0325f2b8e6f2b37454b59c79c4b');

  const circle = importFigBytes(circleBytes, { fileName: 'circle-v101.fig' });
  assert.equal(circle.report.formatVersion, 101);
  assert.equal(circle.report.pages, 1);
  assert.deepEqual(circle.report.unsupportedTypes, {});
  assert.equal(circle.document.pages[0].children[0].type, 'frame');
  assert.equal(circle.document.pages[0].children[0].children[0].type, 'ellipse');
  assert.equal(circle.document.pages[0].children[0].children[0].width, 300);

  const vector = importFigBytes(vectorBytes, { fileName: 'openfigs-v106.fig' });
  assert.equal(vector.report.formatVersion, 106);
  assert.equal(vector.report.pages, 1);
  const frame = vector.document.pages[0].children[0];
  assert.equal(frame.type, 'frame');
  assert.equal(frame.children[0].type, 'group');
  assert.ok(frame.children[0].children.length >= 2);
  assert.ok(frame.children[0].children.every(child => child.type === 'path' && child.fills?.length));
});

test('imports a simple Figma vector as an editable network while preserving its cubic geometry and fills', () => {
  const pageGuid = { sessionID: 91, localID: 1 };
  const commands = [
    { type: 'M', x: 10, y: 10 },
    { type: 'C', c1x: 25, c1y: 0, c2x: 60, c2y: 0, x: 80, y: 10 },
    { type: 'L', x: 80, y: 80 },
    { type: 'L', x: 10, y: 80 },
    { type: 'Z' }
  ];
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('VECTOR', 2, pageGuid, 'a', {
        name: 'Editable vector', size: { x: 100, y: 100 },
        vectorData: { vectorNetworkBlob: 0, normalizedSize: { x: 100, y: 100 } },
        fillGeometry: [{ commandsBlob: 1, windingRule: 'NONZERO', styleID: 0 }],
        fillPaints: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 }, opacity: 1, visible: true }],
        strokePaints: []
      })
    ],
    images: new Map(),
    message: { blobs: [encodeVectorNetworkBlob([commands]), encodeCommandsBlob(commands)] }
  };
  const imported = convertFigDocument(parsed);
  const vector = imported.document.pages[0].children[0];
  assert.equal(vector.type, 'network');
  assert.equal(vector.vertices.length, 4);
  assert.equal(vector.edges.length, 4);
  assert.equal(vector.faces.length, 1);
  assert.equal(vector.fills[0].color, '#3366cc');
  assert.equal(vector.edges[0].control1.x, .25);
  assert.equal(vector.edges[0].control1.y, 0);
  assert.equal(vector.edges[0].control2.x, .6);
  assert.equal(vector.edges[0].control2.y, 0);
  const restored = parseDocument(serializeDocument(imported.document)).pages[0].children[0];
  assert.equal(restored.type, 'network');
  assert.deepEqual(restored.edges, vector.edges);
});

test('imports fixed scroll children from their parent frame references', () => {
  const page = { sessionID: 86, localID: 1 };
  const frame = { sessionID: 86, localID: 2 };
  const fixed = { sessionID: 86, localID: 3 };
  const scrolling = { sessionID: 86, localID: 4 };
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('FRAME', 2, page, 'a', {
        guid: frame, name: 'Scrollable frame', clipsContent: true,
        fixedChildren: [fixed]
      }),
      node('RECTANGLE', 3, frame, 'a', { guid: fixed, name: 'Pinned header' }),
      node('RECTANGLE', 4, frame, 'b', { guid: scrolling, name: 'Scrolling content' })
    ],
    images: new Map(), message: { blobs: [] }
  });
  const children = imported.document.pages[0].children[0].children;
  assert.equal(children[0].fixedPositionWhenScrolling, true);
  assert.equal(children[1].fixedPositionWhenScrolling, undefined);
});

test('imports multiple one-loop Figma vector regions as editable network faces', () => {
  const pageGuid = { sessionID: 93, localID: 1 };
  const first = [
    { type: 'M', x: 8, y: 8 }, { type: 'L', x: 42, y: 8 },
    { type: 'L', x: 42, y: 42 }, { type: 'L', x: 8, y: 42 }, { type: 'Z' }
  ];
  const second = [
    { type: 'M', x: 58, y: 58 }, { type: 'L', x: 92, y: 58 },
    { type: 'L', x: 92, y: 92 }, { type: 'L', x: 58, y: 92 }, { type: 'Z' }
  ];
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('VECTOR', 2, pageGuid, 'a', {
        name: 'Disconnected regions', size: { x: 100, y: 100 },
        vectorData: { vectorNetworkBlob: 0, normalizedSize: { x: 100, y: 100 } },
        fillGeometry: [
          { commandsBlob: 1, windingRule: 'NONZERO', styleID: 0 },
          { commandsBlob: 2, windingRule: 'NONZERO', styleID: 0 }
        ],
        fillPaints: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 }, opacity: 1, visible: true }],
        strokePaints: []
      })
    ],
    images: new Map(),
    message: { blobs: [encodeVectorNetworkBlob([first, second]), encodeCommandsBlob(first), encodeCommandsBlob(second)] }
  };
  const imported = convertFigDocument(parsed);
  const vector = imported.document.pages[0].children[0];
  assert.equal(vector.type, 'network');
  assert.equal(vector.vertices.length, 8);
  assert.equal(vector.edges.length, 8);
  assert.equal(vector.faces.length, 2);
  assert.deepEqual(vector.faces.map(face => face.vertexIds.length), [4, 4]);
  const restored = parseDocument(serializeDocument(imported.document)).pages[0].children[0];
  assert.equal(restored.type, 'network');
  assert.deepEqual(restored.faces, vector.faces);
});

test('keeps multi-loop Figma vector regions as compound editable paths instead of flattening holes into faces', () => {
  const pageGuid = { sessionID: 94, localID: 1 };
  const compound = [
    { type: 'M', x: 5, y: 5 }, { type: 'L', x: 95, y: 5 },
    { type: 'L', x: 95, y: 95 }, { type: 'L', x: 5, y: 95 }, { type: 'Z' },
    { type: 'M', x: 30, y: 30 }, { type: 'L', x: 30, y: 70 },
    { type: 'L', x: 70, y: 70 }, { type: 'L', x: 70, y: 30 }, { type: 'Z' }
  ];
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('VECTOR', 2, pageGuid, 'a', {
        name: 'Compound region', size: { x: 100, y: 100 },
        vectorData: { vectorNetworkBlob: 0, normalizedSize: { x: 100, y: 100 } },
        fillGeometry: [{ commandsBlob: 1, windingRule: 'ODD', styleID: 0 }],
        fillPaints: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 }, opacity: 1, visible: true }],
        strokePaints: []
      })
    ],
    images: new Map(),
    message: { blobs: [encodeVectorNetworkBlob([compound]), encodeCommandsBlob(compound)] }
  };
  const imported = convertFigDocument(parsed);
  const vectorGroup = imported.document.pages[0].children[0];
  assert.equal(vectorGroup.type, 'group');
  assert.equal(vectorGroup.children.length, 1);
  assert.equal(vectorGroup.children[0].type, 'path');
  assert.equal(vectorGroup.children[0].subpaths.length, 1,
    'the second loop remains a compound subpath so its hole semantics are retained');
});

test('falls back to editable paths when Figma network faces use parallel edges the local graph cannot disambiguate', () => {
  const pageGuid = { sessionID: 95, localID: 1 };
  const first = [
    { type: 'M', x: 10, y: 10 }, { type: 'L', x: 60, y: 10 },
    { type: 'L', x: 35, y: 55 }, { type: 'Z' }
  ];
  const second = [
    { type: 'M', x: 10, y: 10 }, { type: 'C', c1x: 15, c1y: -10, c2x: 45, c2y: -10, x: 60, y: 10 },
    { type: 'L', x: 85, y: 55 }, { type: 'Z' }
  ];
  const network = encodeVectorNetwork({
    vertices: [
      { x: 10, y: 10, styleID: 0 }, { x: 60, y: 10, styleID: 0 },
      { x: 35, y: 55, styleID: 0 }, { x: 85, y: 55, styleID: 0 }
    ],
    segments: [
      { start: { vertex: 0, dx: 0, dy: 0 }, end: { vertex: 1, dx: 0, dy: 0 }, isStraight: true },
      { start: { vertex: 1, dx: 0, dy: 0 }, end: { vertex: 2, dx: 0, dy: 0 }, isStraight: true },
      { start: { vertex: 2, dx: 0, dy: 0 }, end: { vertex: 0, dx: 0, dy: 0 }, isStraight: true },
      { start: { vertex: 0, dx: 5, dy: -20 }, end: { vertex: 1, dx: -15, dy: -20 }, isStraight: false },
      { start: { vertex: 1, dx: 0, dy: 0 }, end: { vertex: 3, dx: 0, dy: 0 }, isStraight: true },
      { start: { vertex: 3, dx: 0, dy: 0 }, end: { vertex: 0, dx: 0, dy: 0 }, isStraight: true }
    ],
    regions: [
      { windingRule: 'NONZERO', styleID: 0, loops: [[0, 1, 2]] },
      { windingRule: 'NONZERO', styleID: 0, loops: [[3, 4, 5]] }
    ]
  });
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('VECTOR', 2, pageGuid, 'a', {
        name: 'Parallel network edges', size: { x: 100, y: 100 },
        vectorData: { vectorNetworkBlob: 0, normalizedSize: { x: 100, y: 100 } },
        fillGeometry: [
          { commandsBlob: 1, windingRule: 'NONZERO', styleID: 0 },
          { commandsBlob: 2, windingRule: 'NONZERO', styleID: 0 }
        ],
        fillPaints: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 }, opacity: 1, visible: true }],
        strokePaints: []
      })
    ],
    images: new Map(),
    message: { blobs: [network, encodeCommandsBlob(first), encodeCommandsBlob(second)] }
  };
  const imported = convertFigDocument(parsed);
  const vectorGroup = imported.document.pages[0].children[0];
  assert.equal(vectorGroup.type, 'group');
  assert.equal(vectorGroup.children.length, 2);
  assert.ok(vectorGroup.children.every(child => child.type === 'path'));
});

test('preflights Figma VECTOR command blobs stored on the node before resolving paths', () => {
  const pageGuid = { sessionID: 92, localID: 1 };
  const commands = [
    { type: 'M', x: 0, y: 0 }, { type: 'L', x: 100, y: 0 },
    { type: 'L', x: 100, y: 100 }, { type: 'Z' }
  ];
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('VECTOR', 2, pageGuid, 'a', {
        name: 'Oversized vector', size: { x: 100, y: 100 },
        vectorData: { vectorNetworkBlob: 0, normalizedSize: { x: 100, y: 100 } },
        fillGeometry: [{ commandsBlob: 1, windingRule: 'NONZERO', styleID: 0 }]
      })
    ],
    images: new Map(),
    message: { blobs: [encodeVectorNetworkBlob([commands]), new Uint8Array(512 * 1024 + 1)] }
  };
  const imported = convertFigDocument(parsed);
  assert.deepEqual(imported.document.pages[0].children, []);
  assert.equal(imported.report.unsupportedTypes.VECTOR, 1,
    'the oversized node-level fillGeometry blob must be rejected before geometry decoding');
});

test('imports Figma corner smoothing on editable rectangles and frames', () => {
  const page = { sessionID: 1, localID: 1 };
  const frame = { sessionID: 1, localID: 2 };
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('FRAME', 2, page, 'a', { guid: frame, name: 'Squircle frame', cornerRadius: 20, cornerSmoothing: 0.6 }),
      node('RECTANGLE', 3, frame, 'a', { name: 'Independent squircle', rectangleCornerRadii: [4, 8, 12, 16], cornerSmoothing: 0.35 })
    ], images: new Map(), message: { blobs: [] }
  });
  const [board] = imported.document.pages[0].children;
  assert.equal(board.cornerSmoothing, 0.6);
  assert.equal(board.radius, 20);
  assert.deepEqual(board.children[0].cornerRadii, { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 });
  assert.equal(board.children[0].cornerSmoothing, 0.35);
});

test('imports Figma corner radius and smoothing on editable stars and polygons', () => {
  const page = { sessionID: 1, localID: 1 };
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('STAR', 2, page, 'a', { name: 'Rounded star', pointCount: 7, starInnerRadius: .4, cornerRadius: 8, cornerSmoothing: .3 }),
      node('POLYGON', 3, page, 'a', { name: 'Rounded polygon', pointCount: 8, cornerRadius: 6, cornerSmoothing: .5 }),
      node('STAR', 4, page, 'a', { name: 'Fine star', pointCount: 60 })
    ], images: new Map(), message: { blobs: [] }
  });
  const [star, polygon, fineStar] = imported.document.pages[0].children;
  assert.equal(star.type, 'star');
  assert.equal(star.radius, 8);
  assert.equal(star.cornerSmoothing, .3);
  assert.equal(star.points, 7);
  assert.equal(polygon.type, 'polygon');
  assert.equal(polygon.radius, 6);
  assert.equal(polygon.cornerSmoothing, .5);
  assert.equal(polygon.points, 8);
  assert.equal(fineStar.points, 60, 'the current Figma star point-count limit survives import');
});

test('imports ordered linear, radial, and angular Figma gradient paints with editable geometry and alpha', () => {
  const page = { sessionID: 79, localID: 1 };
  const transform = { m00: 1, m01: 0.2, m02: 0, m10: 0, m11: 1, m12: 0 };
  const gradients = [
    { type: 'GRADIENT_LINEAR', opacity: 0.6, transform, stops: [
      { position: 1, color: { r: 0, g: 0, b: 1, a: 0.25 } },
      { position: 0, color: { r: 1, g: 0, b: 0, a: 0.8 } },
      { position: 0.5, color: { r: 0, g: 1, b: 0, a: 1 } }
    ] },
    { type: 'GRADIENT_RADIAL', opacity: 1, stops: [
      { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 0, a: 0 } }
    ] },
    { type: 'GRADIENT_ANGULAR', opacity: 0.75, stops: [
      { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
    ] }
  ];
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('RECTANGLE', 2, page, 'a', { fillPaints: [
        { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }, ...gradients
      ] })
    ], images: new Map(), message: { blobs: [] }
  });
  const fills = imported.document.pages[0].children[0].fills;
  assert.deepEqual(fills.map(fill => fill.type), ['solid', 'linear', 'radial', 'angular']);
  assert.equal(fills[1].opacity, 0.6);
  assert.deepEqual(fills[1].gradient.stops.map(stop => [stop.position, stop.color, stop.opacity]), [
    [0, '#ff0000', 0.8], [0.5, '#00ff00', 1], [1, '#0000ff', 0.25]
  ]);
  assert.deepEqual(fills[1].gradient.geometry.handles, [
    { x: -0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.3, y: 1 }
  ]);
  assert.match(gradientFillToCSS(fills[1].gradient, fills[1].opacity), /rgba\(255, 0, 0, 0\.48\)/u,
    'paint opacity and color-stop alpha both affect the resulting appearance');
  assert.deepEqual(fills[2].gradient.geometry.handles, [
    { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }
  ]);
  assert.equal(imported.report.unsupportedTypes.GRADIENT, undefined);
  const restored = parseDocument(serializeDocument(imported.document));
  assert.deepEqual(restored.pages[0].children[0].fills, fills);
});

test('omits malformed Figma gradients with import-review warnings without invalidating the document', () => {
  const page = { sessionID: 80, localID: 1 };
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('RECTANGLE', 2, page, 'a', { fillPaints: [
        { type: 'GRADIENT_LINEAR', stops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
        ], transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 0, m12: 0 } },
        { type: 'GRADIENT_RADIAL', stops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1.2, color: { r: 0, g: 0, b: 1, a: 1 } }
        ] }
      ] })
    ], images: new Map(), message: { blobs: [] }
  });
  const restored = parseDocument(serializeDocument(imported.document));
  assert.equal(restored.pages[0].children[0].fills, undefined);
  assert.equal(imported.report.unsupportedTypes.GRADIENT_GEOMETRY, 1);
  assert.equal(imported.report.unsupportedTypes.GRADIENT, 1);
  assert.match(imported.report.warnings.find(item => item.type === 'GRADIENT_GEOMETRY').detail, /degenerate/u);
  assert.match(imported.report.warnings.find(item => item.type === 'GRADIENT').detail, /invalid stop/u);
});

test('imports faithful layer and paint blend modes and reviews unsupported paint blend modes', () => {
  const page = { sessionID: 81, localID: 1 };
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('RECTANGLE', 2, page, 'a', { name: 'Multiply', blendMode: 'MULTIPLY' }),
      node('RECTANGLE', 3, page, 'b', { name: 'Color mode', blendMode: 'COLOR' }),
      node('RECTANGLE', 4, page, 'c', { name: 'Linear burn', blendMode: 'LINEAR_BURN' }),
      node('RECTANGLE', 5, page, 'd', { name: 'Future mode', blendMode: 'FUTURE_BLEND' }),
      node('GROUP', 6, page, 'e', { name: 'Pass through', blendMode: 'PASS_THROUGH' }),
      node('RECTANGLE', 7, page, 'f', {
        name: 'Paint blend',
        fillPaints: [
          { type: 'SOLID', blendMode: 'SCREEN', color: { r: 1, g: 0, b: 0, a: 1 } },
          { type: 'SOLID', blendMode: 'FUTURE_PAINT', color: { r: 0, g: 0, b: 1, a: 1 } },
          { type: 'SOLID', blendMode: 'PASS_THROUGH', color: { r: 0, g: 1, b: 0, a: 1 } }
        ],
        strokePaints: [{ type: 'SOLID', blendMode: 'MULTIPLY', color: { r: 0, g: 0, b: 0, a: 1 } }]
      })
    ], images: new Map(), message: { blobs: [] }
  });
  const layers = imported.document.pages[0].children;
  const paintLayer = layers.find(layer => layer.name === 'Paint blend');
  assert.equal(layers[0].blendMode, 'multiply');
  assert.equal(layers[1].blendMode, 'color');
  assert.equal(layers[2].blendMode, 'normal');
  assert.equal(layers[3].blendMode, 'normal');
  assert.equal(layers[4].blendMode, 'normal');
  assert.equal(layers[5].blendMode, 'normal');
  assert.equal(paintLayer.fills[0].blendMode, 'screen');
  assert.equal(paintLayer.fills[1].blendMode, undefined, 'unknown paint modes reset to the default normal blend');
  assert.equal(paintLayer.fills[2].blendMode, undefined, 'PASS_THROUGH is invalid on an individual paint');
  assert.equal(paintLayer.strokes[0].blendMode, 'multiply');
  assert.equal(imported.report.flattenedTypes.BLEND_MODE, 3,
    'unsupported known, unknown, and pass-through layer modes are visible in import review');
  assert.equal(imported.report.flattenedTypes.PAINT_BLEND, 2,
    'only the unknown and pass-through paint modes are reported');
  assert.ok(imported.report.warnings.some(item => item.type === 'BLEND_MODE' && /LINEAR_BURN/u.test(item.detail)));
  assert.ok(imported.report.warnings.some(item => item.type === 'BLEND_MODE' && /FUTURE_BLEND/u.test(item.detail)));
  assert.ok(imported.report.warnings.some(item => item.type === 'PAINT_BLEND' && /FUTURE_PAINT/u.test(item.detail)));
  assert.ok(imported.report.warnings.some(item => item.type === 'PAINT_BLEND' && /PASS_THROUGH/u.test(item.detail)));
  const restored = parseDocument(serializeDocument(imported.document));
  assert.equal(restored.pages[0].children[0].blendMode, 'multiply');
  assert.equal(restored.pages[0].children[1].blendMode, 'color');
  const restoredPaintLayer = restored.pages[0].children.find(layer => layer.name === 'Paint blend');
  assert.equal(restoredPaintLayer.fills[0].blendMode, 'screen');
  assert.equal(restoredPaintLayer.strokes[0].blendMode, 'multiply');
});

test('all supported Figma Paint blend modes map on both fill and stroke paints without warnings', () => {
  const page = { sessionID: 82, localID: 1 };
  const modes = [
    ['NORMAL', 'normal'], ['DARKEN', 'darken'], ['MULTIPLY', 'multiply'], ['COLOR_BURN', 'color-burn'],
    ['LIGHTEN', 'lighten'], ['SCREEN', 'screen'], ['COLOR_DODGE', 'color-dodge'], ['OVERLAY', 'overlay'],
    ['SOFT_LIGHT', 'soft-light'], ['HARD_LIGHT', 'hard-light'], ['DIFFERENCE', 'difference'],
    ['EXCLUSION', 'exclusion'], ['HUE', 'hue'], ['SATURATION', 'saturation'], ['COLOR', 'color'],
    ['LUMINOSITY', 'luminosity']
  ];
  const nodes = [node('CANVAS', 1, null, '', { guid: page, name: 'Page' }), ...modes.map(([sourceMode], index) => node('RECTANGLE', index + 2, page, String(index), {
    name: sourceMode,
    fillPaints: [{ type: 'SOLID', blendMode: sourceMode, color: { r: 0.3, g: 0.6, b: 0.9, a: 1 } }],
    strokePaints: [{ type: 'SOLID', blendMode: sourceMode, color: { r: 0.9, g: 0.6, b: 0.3, a: 1 } }]
  }))];
  const imported = convertFigDocument({ header: { version: 106 }, nodes, images: new Map(), message: { blobs: [] } });
  const layers = imported.document.pages[0].children;
  for (const [sourceMode, cssMode] of modes) {
    const layer = layers.find(item => item.name === sourceMode);
    assert.equal(layer.fills[0].blendMode || 'normal', cssMode, `fill mode ${cssMode}`);
    assert.equal(layer.strokes[0].blendMode || 'normal', cssMode, `stroke mode ${cssMode}`);
  }
  assert.equal(imported.report.flattenedTypes.PAINT_BLEND || 0, 0);
});

test('imports exact custom Figma stroke dash arrays as editable local stroke settings', () => {
  const page = { sessionID: 831, localID: 1 };
  const imported = convertFigDocument({ header: { version: 106 }, nodes: [
    node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
    node('RECTANGLE', 2, page, 'a', {
      name: 'Custom dashed outline', strokeWeight: 2, strokeCap: 'SQUARE', strokeJoin: 'BEVEL',
      dashPattern: [3, 5, 0, 2],
      strokePaints: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } }]
    })
  ], images: new Map(), message: { blobs: [] } });
  const layer = imported.document.pages[0].children[0];
  assert.deepEqual(imported.report.warnings.filter(item => item.type === 'unsupported'), []);
  assert.equal(layer.strokes[0].pattern, 'custom');
  assert.deepEqual(layer.strokes[0].dashArray, [3, 5, 0, 2]);
  assert.equal(layer.strokes[0].cap, 'square');
  assert.equal(layer.strokes[0].join, 'bevel');
  const restored = parseDocument(serializeDocument(imported.document)).pages[0].children[0];
  assert.deepEqual(restored.strokes[0].dashArray, [3, 5, 0, 2]);
});

test('import review flags paint blends isolated by their layer or any ancestor', () => {
  const page = { sessionID: 83, localID: 1 };
  const opacityParent = { sessionID: 83, localID: 4 };
  const effectParent = { sessionID: 83, localID: 6 };
  const parsed = convertFigDocument({ header: { version: 106 }, nodes: [
    node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
    node('RECTANGLE', 2, page, 'a', {
      name: 'Layer blend combination', blendMode: 'MULTIPLY',
      fillPaints: [{ type: 'SOLID', blendMode: 'SCREEN', color: { r: 0.5, g: 0.2, b: 0.8, a: 1 } }]
    }),
    node('RECTANGLE', 3, page, 'b', {
      name: 'Effect combination',
      fillPaints: [{ type: 'SOLID', blendMode: 'COLOR_DODGE', color: { r: 0.5, g: 0.2, b: 0.8, a: 1 } }],
      effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 3 }]
    }),
    node('FRAME', 4, page, 'c', { guid: opacityParent, name: 'Opacity parent', opacity: 0.5 }),
    node('RECTANGLE', 5, opacityParent, 'a', {
      name: 'Nested opacity paint',
      fillPaints: [{ type: 'SOLID', blendMode: 'SCREEN', color: { r: 0.1, g: 0.7, b: 0.5, a: 1 } }]
    }),
    node('GROUP', 6, page, 'd', {
      guid: effectParent, name: 'Effect parent',
      effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 2 }, radius: 3 }]
    }),
    node('RECTANGLE', 7, effectParent, 'a', {
      name: 'Nested effect paint',
      strokePaints: [{ type: 'SOLID', blendMode: 'SCREEN', color: { r: 0.1, g: 0.7, b: 0.5, a: 1 } }]
    })
  ], images: new Map(), message: { blobs: [] } });
  assert.equal(parsed.report.flattenedTypes.PAINT_BLEND_COMPOSITION, 4);
  assert.ok(parsed.report.warnings.some(item => item.type === 'PAINT_BLEND_COMPOSITION' && item.name === 'Layer blend combination'));
  assert.ok(parsed.report.warnings.some(item => item.type === 'PAINT_BLEND_COMPOSITION' && item.name === 'Effect combination'));
  assert.ok(parsed.report.warnings.some(item => item.type === 'PAINT_BLEND_COMPOSITION' && item.name === 'Nested opacity paint' && /reduced layer opacity/u.test(item.detail)));
  assert.ok(parsed.report.warnings.some(item => item.type === 'PAINT_BLEND_COMPOSITION' && item.name === 'Nested effect paint' && /visible effects/u.test(item.detail)));
});

test('imports consecutive Figma alpha-mask stacks as editable, scoped mask groups', () => {
  const pageGuid = { sessionID: 11, localID: 1 };
  const frameGuid = { sessionID: 11, localID: 2 };
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('FRAME', 2, pageGuid, 'a', { guid: frameGuid, name: 'Board' }),
      node('RECTANGLE', 3, frameGuid, 'a', { name: 'Unmasked backdrop' }),
      node('ELLIPSE', 4, frameGuid, 'b', { name: 'Portrait mask', isMask: true }),
      node('RECTANGLE', 5, frameGuid, 'c', { name: 'Portrait photo' }),
      node('RECTANGLE', 6, frameGuid, 'd', { name: 'Portrait tint' }),
      node('RECTANGLE', 7, frameGuid, 'e', { name: 'Card mask', isMask: true }),
      node('RECTANGLE', 8, frameGuid, 'f', { name: 'Card image' })
    ],
    message: { blobs: [] }, images: new Map()
  };
  const imported = convertFigDocument(parsed, { fileName: 'mask-stacks.fig' });
  const board = imported.document.pages[0].children[0];
  const [backdrop, portraitMask, cardMask] = board.children;

  assert.equal(backdrop.name, 'Unmasked backdrop');
  assert.deepEqual([portraitMask.mask, portraitMask.children.map(child => child.name)], [true, ['Portrait mask', 'Portrait photo', 'Portrait tint']]);
  assert.equal(portraitMask.maskSourceId, portraitMask.children[0].id);
  assert.deepEqual([cardMask.mask, cardMask.children.map(child => child.name)], [true, ['Card mask', 'Card image']]);
  assert.equal(cardMask.maskSourceId, cardMask.children[0].id);
  assert.equal(imported.report.importedNodes, 9,
    'the editable layer count includes the two local mask-group wrappers');
  assert.equal(imported.report.unsupportedTypes.MASK, undefined, 'supported default alpha masks should not be reported as unsupported');

  const restored = parseDocument(serializeDocument(imported.document));
  const [restoredBackdrop, restoredPortrait, restoredCard] = restored.pages[0].children[0].children;
  assert.equal(restoredBackdrop.name, 'Unmasked backdrop');
  assert.equal(restoredPortrait.maskSourceId, restoredPortrait.children[0].id);
  assert.equal(restoredCard.maskSourceId, restoredCard.children[0].id);
});

test('imports supported Figma VECTOR masks as editable local vector-mask groups', () => {
  const pageGuid = { sessionID: 111, localID: 1 };
  const frameGuid = { sessionID: 111, localID: 2 };
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('FRAME', 2, pageGuid, 'a', { guid: frameGuid, name: 'Board' }),
      node('RECTANGLE', 3, frameGuid, 'a', { name: 'Shape mask', isMask: true, maskType: 'VECTOR', opacity: 0.2,
        fillPaints: [{ type: 'SOLID', opacity: 0, color: { r: 1, g: 0, b: 0, a: 0 }, visible: true }],
        strokePaints: [{ type: 'SOLID', opacity: 0, color: { r: 0, g: 0, b: 1, a: 0 }, visible: true, weight: 6 }] }),
      node('RECTANGLE', 4, frameGuid, 'b', { name: 'Masked content' }),
      node('LINE', 5, frameGuid, 'c', { name: 'Stroke-only mask', isMask: true, maskType: 'VECTOR', opacity: 0,
        strokeWeight: 8, strokePaints: [{ type: 'SOLID', opacity: 0, color: { r: 0, g: 0, b: 0, a: 0 }, visible: true }] }),
      node('RECTANGLE', 6, frameGuid, 'd', { name: 'Line-masked content' })
    ],
    message: { blobs: [] }, images: new Map()
  };
  const imported = convertFigDocument(parsed, { fileName: 'vector-masks.fig' });
  const [shapeMask, lineMask] = imported.document.pages[0].children[0].children;
  assert.equal(shapeMask.maskMode, 'vector');
  assert.equal(shapeMask.children.find(child => child.id === shapeMask.maskSourceId).opacity, 0.2,
    'the imported source properties remain editable even though vector rendering ignores their opacity');
  assert.equal(lineMask.maskMode, 'vector');
  assert.equal(lineMask.children.find(child => child.id === lineMask.maskSourceId).type, 'line',
    'a visible stroke-only line remains an editable vector mask source');
  assert.equal(imported.report.unsupportedTypes.MASK, undefined);
  const restored = parseDocument(serializeDocument(imported.document));
  assert.deepEqual(restored.pages[0].children[0].children.map(group => group.maskMode), ['vector', 'vector']);
});

test('mask-stack wrapping preserves rotated and affine child placement', () => {
  const pageGuid = { sessionID: 12, localID: 1 };
  const frameGuid = { sessionID: 12, localID: 2 };
  const maskTransform = { m00: 1.2, m01: 0.35, m02: 17, m10: -0.15, m11: 0.9, m12: 23 };
  const contentAngle = 31 * Math.PI / 180;
  const contentTransform = {
    m00: Math.cos(contentAngle), m01: -Math.sin(contentAngle), m02: 48,
    m10: Math.sin(contentAngle), m11: Math.cos(contentAngle), m12: 36
  };
  const makeParsed = isMask => ({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid }),
      node('FRAME', 2, pageGuid, 'a', { guid: frameGuid, name: 'Board' }),
      node('ELLIPSE', 3, frameGuid, 'a', { name: 'Mask', isMask, transform: maskTransform }),
      node('RECTANGLE', 4, frameGuid, 'b', { name: 'Photo', transform: contentTransform })
    ],
    message: { blobs: [] }, images: new Map()
  });
  const before = convertFigDocument(makeParsed(false)).document.pages[0].children[0].children;
  const afterBoard = convertFigDocument(makeParsed(true)).document.pages[0].children[0];
  const group = afterBoard.children[0];
  assert.equal(group.mask, true);
  const groupTranslation = { a: 1, b: 0, c: 0, d: 1, e: group.x, f: group.y };

  for (const name of ['Mask', 'Photo']) {
    const original = before.find(child => child.name === name);
    const imported = group.children.find(child => child.name === name);
    const importedToParent = multiplyAffine(groupTranslation, nodeToParentTransform(imported));
    const originalToParent = nodeToParentTransform(original);
    for (const point of [{ x: 0, y: 0 }, { x: original.width, y: 0 }, { x: original.width, y: original.height }, { x: 0, y: original.height }]) {
      const expected = transformPoint(originalToParent, point);
      const actual = transformPoint(importedToParent, point);
      assert.ok(Math.abs(actual.x - expected.x) < 1e-8 && Math.abs(actual.y - expected.y) < 1e-8,
        `${name} corner should keep the same parent-space position after wrapping`);
    }
  }
});

test('only active local alpha masks are grouped; unsupported modes and auto-layout stacks stay editable with warnings', () => {
  const pageGuid = { sessionID: 13, localID: 1 };
  const frameGuid = { sessionID: 13, localID: 2 };
  const parsedForMask = (maskProperties, frameProperties = {}) => ({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid }),
      node('FRAME', 2, pageGuid, 'a', { guid: frameGuid, ...frameProperties }),
      node('RECTANGLE', 3, frameGuid, 'a', { name: 'Mask', ...maskProperties }),
      node('RECTANGLE', 4, frameGuid, 'b', { name: 'Content' })
    ],
    message: { blobs: [] }, images: new Map()
  });

  for (const maskType of ['LUMINANCE']) {
    const imported = convertFigDocument(parsedForMask({ isMask: true, maskType }));
    const children = imported.document.pages[0].children[0].children;
    assert.deepEqual(children.map(child => child.name), ['Mask', 'Content']);
    assert.ok(imported.report.warnings.some(warning => warning.type === 'MASK' && warning.detail.includes(maskType)));
  }

  const dormantMode = convertFigDocument(parsedForMask({ isMask: false, maskType: 'VECTOR' }));
  assert.equal(dormantMode.report.unsupportedTypes.MASK, undefined,
    'maskType alone does not activate masking in Figma');
  assert.deepEqual(dormantMode.document.pages[0].children[0].children.map(child => child.name), ['Mask', 'Content']);

  const outline = convertFigDocument(parsedForMask({ isMask: true, isMaskOutline: true }));
  assert.equal(outline.document.pages[0].children[0].children[0].maskMode, 'vector',
    'the deprecated outline flag maps to vector mode when its source is supported');
  assert.equal(outline.report.unsupportedTypes.MASK, undefined);

  const autoLayout = convertFigDocument(parsedForMask({ isMask: true }, { stackMode: 'HORIZONTAL' }));
  assert.deepEqual(autoLayout.document.pages[0].children[0].children.map(child => child.name), ['Mask', 'Content']);
  assert.ok(autoLayout.report.warnings.some(warning => warning.type === 'MASK' && warning.detail.includes('auto-layout')));
});

test('a nested mask stack only captures siblings in its own Figma parent', () => {
  const pageGuid = { sessionID: 14, localID: 1 };
  const groupGuid = { sessionID: 14, localID: 2 };
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid }),
      node('GROUP', 2, pageGuid, 'a', { guid: groupGuid, name: 'Nested group' }),
      node('ELLIPSE', 3, groupGuid, 'a', { name: 'Nested mask', isMask: true }),
      node('RECTANGLE', 4, groupGuid, 'b', { name: 'Nested content' }),
      node('RECTANGLE', 5, pageGuid, 'b', { name: 'Outside sibling' })
    ],
    message: { blobs: [] }, images: new Map()
  };
  const imported = convertFigDocument(parsed);
  const [nested, outside] = imported.document.pages[0].children;

  assert.equal(nested.name, 'Nested group');
  assert.equal(nested.children[0].mask, true);
  assert.deepEqual(nested.children[0].children.map(child => child.name), ['Nested mask', 'Nested content']);
  assert.equal(outside.name, 'Outside sibling');
  assert.equal(outside.mask, undefined);
});

test('an omitted mask source still terminates the preceding mask stack', () => {
  const pageGuid = { sessionID: 15, localID: 1 };
  const frameGuid = { sessionID: 15, localID: 2 };
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid }),
      node('FRAME', 2, pageGuid, 'a', { guid: frameGuid, name: 'Board' }),
      node('ELLIPSE', 3, frameGuid, 'a', { name: 'First mask', isMask: true }),
      node('RECTANGLE', 4, frameGuid, 'b', { name: 'First content' }),
      node('UNSUPPORTED_MASK_SOURCE', 5, frameGuid, 'c', { name: 'Omitted mask', isMask: true }),
      node('RECTANGLE', 6, frameGuid, 'd', { name: 'Unmasked after omission' })
    ],
    message: { blobs: [] }, images: new Map()
  };
  const imported = convertFigDocument(parsed);
  const [group, remaining] = imported.document.pages[0].children[0].children;

  assert.equal(group.mask, true);
  assert.deepEqual(group.children.map(child => child.name), ['First mask', 'First content']);
  assert.equal(remaining.name, 'Unmasked after omission');
  assert.ok(imported.report.warnings.some(warning => warning.name === 'Omitted mask' && warning.type === 'MASK'));
});

test('preserves imported scale, shear, and reflection in the node affine transform', () => {
  const pageGuid = { sessionID: 1, localID: 1 };
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { name: 'Page 1' }),
      node('RECTANGLE', 2, pageGuid, 'a', {
        name: 'Affine rectangle',
        transform: { m00: -1.5, m01: 0.4, m02: 23, m10: 0.25, m11: 2, m12: -8 }
      })
    ],
    message: { blobs: [] }, images: new Map()
  };
  const imported = convertFigDocument(parsed, { fileName: 'affine.fig', formatVersion: 106 });
  const rectangle = imported.document.pages[0].children[0];

  assert.notEqual(rectangle.rotation, 0);
  assert.ok(rectangle.affineTransform.a * rectangle.affineTransform.d
    - rectangle.affineTransform.b * rectangle.affineTransform.c < 0,
  'a reflected transform keeps its negative determinant in the affine residual');
  const composed = nodeLocalToPageTransform(rectangle);
  for (const [key, expected] of Object.entries({ a: -1.5, b: 0.25, c: 0.4, d: 2 })) {
    assert.ok(Math.abs(composed[key] - expected) < 1e-10, `${key} should retain the imported linear transform`);
  }
  assert.deepEqual([rectangle.x, rectangle.y], [23, -8]);
  assert.equal(imported.report.flattenedTypes.TRANSFORM, undefined);
});

test('decomposes pure rotation and positive-determinant matrices without losing their full affine', () => {
  const pageGuid = { sessionID: 1, localID: 1 };
  const angle = 37 * Math.PI / 180;
  const pureRotation = { m00: Math.cos(angle), m01: -Math.sin(angle), m10: Math.sin(angle), m11: Math.cos(angle) };
  const positiveDeterminant = { m00: 2, m01: 0.6, m10: 0.4, m11: 1.5 };
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { name: 'Page 1' }),
      node('RECTANGLE', 2, pageGuid, 'a', { name: 'Rotated', transform: { ...pureRotation, m02: 0, m12: 0 } }),
      node('RECTANGLE', 3, pageGuid, 'b', { name: 'Positive affine', transform: { ...positiveDeterminant, m02: 0, m12: 0 } })
    ],
    message: { blobs: [] }, images: new Map()
  };
  const imported = convertFigDocument(parsed, { fileName: 'decomposed.fig', formatVersion: 106 });
  const [rotated, positive] = imported.document.pages[0].children;
  assert.ok(Math.abs(rotated.rotation - 37) < 1e-10);
  assert.equal(rotated.affineTransform, undefined, 'a pure rotation needs no residual transform');

  const reconstructed = nodeLocalToPageTransform(positive);
  for (const [key, expected] of Object.entries({
    a: positiveDeterminant.m00, b: positiveDeterminant.m10,
    c: positiveDeterminant.m01, d: positiveDeterminant.m11
  })) assert.ok(Math.abs(reconstructed[key] - expected) < 1e-10, `${key} should recompose exactly`);
  assert.ok(Math.abs(positive.affineTransform.b - positive.affineTransform.c) < 1e-10,
    'the positive-determinant polar residual is symmetric');
});

test('retains affine transforms on imported component children through serialization and validation', () => {
  const pageGuid = { sessionID: 1, localID: 1 };
  const componentGuid = { sessionID: 1, localID: 2 };
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { name: 'Page 1' }),
      node('COMPONENT', 2, pageGuid, 'a', {
        name: 'Card component', transform: { m00: 1.2, m01: 0.2, m02: 10, m10: 0.1, m11: 1, m12: 12 }
      }),
      node('RECTANGLE', 3, componentGuid, 'a', {
        name: 'Reflected child', transform: { m00: -1, m01: 0.3, m02: 8, m10: 0, m11: 1, m12: 4 }
      })
    ],
    message: { blobs: [] }, images: new Map()
  };
  const imported = convertFigDocument(parsed, { fileName: 'component-affine.fig', formatVersion: 106 });
  const restored = parseDocument(serializeDocument(imported.document));
  const component = restored.pages[0].children[0];
  const child = component.children[0];

  assert.equal(component.name, 'Card component');
  assert.ok(component.affineTransform);
  assert.ok(child.affineTransform);
  assert.equal(child.affineTransform.a * child.affineTransform.d
    - child.affineTransform.b * child.affineTransform.c < 0, true);
});

test('preserves resolvable local component instances, property overrides, and named variants from .fig trees', () => {
  const page = { sessionID: 52, localID: 1 };
  const set = { sessionID: 52, localID: 2 };
  const small = { sessionID: 52, localID: 3 };
  const large = { sessionID: 52, localID: 5 };
  const instance = { sessionID: 52, localID: 7 };
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('COMPONENT_SET', 2, page, 'a', { guid: set, name: 'Button', componentPropertyDefinitions: {
        Size: { type: 'VARIANT', defaultValue: 'Small', variantOptions: ['Small', 'Large'] }
      } }),
      node('COMPONENT', 3, set, 'a', { guid: small, name: 'Button/size=small', variantProperties: { Size: 'Small' } }),
      node('RECTANGLE', 4, small, 'a', { name: 'Background', fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }] }),
      node('TEXT', 9, small, 'b', { name: 'Caption', textData: { characters: 'Master caption' }, textAutoResize: 'NONE', textTruncation: 'DISABLED' }),
      node('COMPONENT', 5, set, 'b', { guid: large, name: 'Button/size=large', variantProperties: { Size: 'Large' } }),
      node('RECTANGLE', 6, large, 'a', { name: 'Background', fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }] }),
      node('TEXT', 10, large, 'b', { name: 'Caption', textData: { characters: 'Master caption' }, textAutoResize: 'NONE', textTruncation: 'DISABLED' }),
      node('INSTANCE', 7, page, 'b', { guid: instance, name: 'Primary button', componentId: small, componentProperties: {
        Size: { type: 'VARIANT', value: 'Large' }
      } }),
      node('RECTANGLE', 8, instance, 'a', { name: 'Background', fillPaints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 } }] }),
      node('TEXT', 11, instance, 'b', { name: 'Caption', textData: { characters: 'Short caption' }, textAutoResize: 'NONE', textTruncation: 'ENDING', maxLines: 2 })
    ],
    images: new Map(), message: { blobs: [] }
  };
  const { document, report } = convertFigDocument(parsed, { fileName: 'components.fig' });
  const componentsByName = new Map(document.components.map(component => [component.name, component]));
  const variantSet = document.componentSets[0];
  const importedInstance = document.pages[0].children.find(child => child.name === 'Primary button');
  const master = document.pages[0].children[0].children.find(candidate => candidate.componentId === importedInstance.componentId);
  const masterChild = master.children[0];
  const instanceChild = importedInstance.children[0];
  const masterText = master.children.find(child => child.type === 'text');
  const instanceText = importedInstance.children.find(child => child.type === 'text');

  assert.equal(componentsByName.size, 2);
  assert.equal(variantSet.name, 'Button');
  assert.deepEqual(variantSet.properties, [{ name: 'Size', values: ['Small', 'Large'] }]);
  assert.equal(importedInstance.isInstance, true);
  assert.equal(importedInstance.componentId, componentsByName.get('Button/size=large').id,
    'the instance variant selection uses the explicit component-property value');
  assert.equal(importedInstance.componentSourceId, master.id);
  assert.equal(instanceChild.componentSourceId, masterChild.id);
  assert.deepEqual(importedInstance.componentOverrides[masterChild.id].fills, instanceChild.fills,
    'the imported effective fill remains a local editable instance override');
  assert.deepEqual(importedInstance.componentOverrides[masterText.id], {
    text: 'Short caption', textTruncation: 'ending', maxLines: 2
  }, 'Figma text truncation properties survive as editable component overrides');
  assert.equal(instanceText.maxLines, 2);
  assert.equal(report.flattenedTypes.INSTANCE, undefined);
  assert.equal(report.flattenedTypes.COMPONENT_SET, undefined);

  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.pages[0].children.find(child => child.name === 'Primary button').isInstance, true);
  assert.equal(restored.componentSets[0].properties[0].name, 'Size');
});

test('imports exposed Boolean, text, and instance-swap component properties and instance values', () => {
  const sessionID = 77;
  const page = { sessionID, localID: 1 };
  const iconPrimary = { sessionID, localID: 10 };
  const iconAlternate = { sessionID, localID: 12 };
  const card = { sessionID, localID: 20 };
  const cardIcon = { sessionID, localID: 23 };
  const placedCard = { sessionID, localID: 30 };
  const placedIcon = { sessionID, localID: 33 };
  const definitions = {
    'Show icon#0:0': { type: 'BOOLEAN', defaultValue: false },
    'Button label#0:1': { type: 'TEXT', defaultValue: 'Continue' },
    'Icon#0:2': {
      type: 'INSTANCE_SWAP', defaultValue: `${sessionID}:${iconPrimary.localID}`,
      preferredValues: [{ type: 'COMPONENT', key: 'icon-alternate-key' }]
    }
  };
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('COMPONENT', 10, page, 'a', { guid: iconPrimary, name: 'Icon/Primary' }),
      node('ELLIPSE', 11, iconPrimary, 'a', { name: 'Artwork' }),
      node('COMPONENT', 12, page, 'b', { guid: iconAlternate, name: 'Icon/Alternate', key: 'icon-alternate-key' }),
      node('ELLIPSE', 13, iconAlternate, 'a', { name: 'Artwork' }),
      node('COMPONENT', 20, page, 'c', { guid: card, name: 'Card', componentPropertyDefinitions: definitions }),
      node('RECTANGLE', 21, card, 'a', { name: 'Icon visibility', visible: false, componentPropertyReferences: { visible: 'Show icon#0:0' } }),
      node('TEXT', 22, card, 'b', { name: 'Button label', textData: { characters: 'Continue' }, componentPropertyReferences: { characters: 'Button label#0:1' } }),
      node('INSTANCE', 23, card, 'c', { guid: cardIcon, name: 'Icon', componentId: iconPrimary, componentPropertyReferences: { mainComponent: 'Icon#0:2' } }),
      node('ELLIPSE', 24, cardIcon, 'a', { name: 'Artwork' }),
      node('INSTANCE', 30, page, 'd', {
        guid: placedCard, name: 'Card use', componentId: card,
        componentProperties: {
          'Show icon#0:0': { type: 'BOOLEAN', value: true },
          'Button label#0:1': { type: 'TEXT', value: 'Go now' },
          'Icon#0:2': { type: 'INSTANCE_SWAP', value: `${sessionID}:${iconAlternate.localID}` }
        }
      }),
      node('RECTANGLE', 31, placedCard, 'a', { name: 'Icon visibility', visible: true, componentPropertyReferences: { visible: 'Show icon#0:0' } }),
      node('TEXT', 32, placedCard, 'b', { name: 'Button label', textData: { characters: 'Go now' }, componentPropertyReferences: { characters: 'Button label#0:1' } }),
      node('INSTANCE', 33, placedCard, 'c', { guid: placedIcon, name: 'Icon', componentId: iconAlternate }),
      node('ELLIPSE', 34, placedIcon, 'a', { name: 'Artwork' })
    ],
    images: new Map(), message: { blobs: [] }
  });
  const cardComponent = imported.document.components.find(item => item.id === imported.document.pages[0].children
    .find(candidate => candidate.name === 'Card')?.componentId);
  const cardUse = imported.document.pages[0].children.find(candidate => candidate.name === 'Card use');
  const propertiesByName = new Map(cardComponent.componentProperties.map(property => [property.name, property]));
  assert.deepEqual([...propertiesByName.keys()].sort(), ['Button label', 'Icon', 'Show icon']);
  assert.equal(propertiesByName.get('Show icon').type, 'BOOLEAN');
  assert.equal(propertiesByName.get('Show icon').defaultValue, false);
  assert.equal(propertiesByName.get('Button label').type, 'TEXT');
  assert.equal(propertiesByName.get('Button label').defaultValue, 'Continue');
  assert.equal(propertiesByName.get('Icon').type, 'INSTANCE_SWAP');
  const alternate = imported.document.components.find(item => item.name === 'Icon/Alternate');
  assert.deepEqual(propertiesByName.get('Icon').preferredComponentIds, [alternate.id]);
  assert.equal(cardUse.componentPropertyValues[propertiesByName.get('Show icon').id], true);
  assert.equal(cardUse.componentPropertyValues[propertiesByName.get('Button label').id], 'Go now');
  assert.equal(cardUse.children.find(child => child.isInstance).componentId, alternate.id);
  assert.equal(cardUse.children.find(child => child.name === 'Icon visibility').visible, true);
  assert.equal(cardUse.children.find(child => child.type === 'text').text, 'Go now');
  assert.equal(imported.report.flattenedTypes.COMPONENT_PROPERTY, undefined);
  const restored = parseDocument(serializeDocument(imported.document));
  const restoredCard = restored.components.find(item => item.id === cardComponent.id);
  assert.equal(restoredCard.componentProperties.length, 3);
  assert.equal(restored.pages[0].children.find(candidate => candidate.id === cardUse.id).componentPropertyValues[propertiesByName.get('Button label').id], 'Go now');
});

test('imports component slots as editable frames and preserves instance-authored slot content', () => {
  const sessionID = 78;
  const page = { sessionID, localID: 1 };
  const component = { sessionID, localID: 2 };
  const masterSlot = { sessionID, localID: 3 };
  const instance = { sessionID, localID: 5 };
  const instanceSlot = { sessionID, localID: 6 };
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('COMPONENT', 2, page, 'a', { guid: component, name: 'Card', componentPropertyDefinitions: {
        'Content#0:0': { type: 'SLOT', description: 'Card content', slotSettings: { minChildren: 1 } }
      } }),
      node('FRAME', 3, component, 'a', { guid: masterSlot, name: 'Content', componentPropertyReferences: { slotContentId: 'Content#0:0' } }),
      node('TEXT', 4, masterSlot, 'a', { name: 'Placeholder', textData: { characters: 'Default content' } }),
      node('INSTANCE', 5, page, 'b', { guid: instance, name: 'Card use', componentId: component }),
      node('FRAME', 6, instance, 'a', { guid: instanceSlot, name: 'Content' }),
      node('RECTANGLE', 7, instanceSlot, 'a', { name: 'Custom card body' }),
      node('TEXT', 8, instanceSlot, 'b', { name: 'Body label', textData: { characters: 'Custom content' } })
    ],
    images: new Map(), message: { blobs: [] }
  });
  const localComponent = imported.document.components.find(item => item.name === 'Card');
  const property = localComponent.componentProperties[0];
  const instanceNode = imported.document.pages[0].children.find(item => item.name === 'Card use');
  const localSlot = instanceNode.children[0];
  assert.equal(property.type, 'SLOT');
  assert.deepEqual(property.defaultValue, []);
  assert.deepEqual(localSlot.children.map(child => child.name), ['Custom card body', 'Body label']);
  assert.deepEqual(instanceNode.componentPropertyValues[property.id], localSlot.children.map(child => child.id));
  assert.match(imported.report.warnings.find(warning => warning.type === 'COMPONENT_SLOT_SETTINGS').detail, /constraints/u);
  const restored = parseDocument(serializeDocument(imported.document));
  syncAllComponentInstances(restored);
  assert.deepEqual(restored.pages[0].children.find(item => item.isInstance).children[0].children.map(child => child.name), ['Custom card body', 'Body label']);
});

test('reports component properties whose one source value controls several local layers', () => {
  const page = { sessionID: 79, localID: 1 };
  const component = { sessionID: 79, localID: 2 };
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('COMPONENT', 2, page, 'a', { guid: component, name: 'Icon', componentPropertyDefinitions: {
        'Visible#0:0': { type: 'BOOLEAN', defaultValue: true }
      } }),
      node('ELLIPSE', 3, component, 'a', { name: 'Outer', componentPropertyReferences: { visible: 'Visible#0:0' } }),
      node('ELLIPSE', 4, component, 'b', { name: 'Inner', componentPropertyReferences: { visible: 'Visible#0:0' } })
    ],
    images: new Map(), message: { blobs: [] }
  });
  const localComponent = imported.document.components.find(item => item.name === 'Icon');
  assert.equal(localComponent.componentProperties, undefined);
  assert.match(imported.report.warnings.find(warning => warning.type === 'COMPONENT_PROPERTY').detail, /multiple layers/u);
});

test('imports exposed nested component instances and reveals their controls on the outer instance', () => {
  const sessionID = 81;
  const page = { sessionID, localID: 1 };
  const icon = { sessionID, localID: 10 };
  const owner = { sessionID, localID: 20 };
  const nestedInMaster = { sessionID, localID: 21 };
  const ownerUse = { sessionID, localID: 30 };
  const nestedInUse = { sessionID, localID: 31 };
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('COMPONENT', 10, page, 'a', { guid: icon, name: 'Icon', componentPropertyDefinitions: {
        'Visible#0:0': { type: 'BOOLEAN', defaultValue: true }
      } }),
      node('ELLIPSE', 11, icon, 'a', { name: 'Mark', componentPropertyReferences: { visible: 'Visible#0:0' } }),
      node('COMPONENT', 20, page, 'b', { guid: owner, name: 'Owner' }),
      node('INSTANCE', 21, owner, 'a', { guid: nestedInMaster, name: 'Nested icon', componentId: icon, isExposedInstance: true }),
      node('ELLIPSE', 22, nestedInMaster, 'a', { name: 'Mark' }),
      node('INSTANCE', 30, page, 'c', { guid: ownerUse, name: 'Owner use', componentId: owner }),
      node('INSTANCE', 31, ownerUse, 'a', { guid: nestedInUse, name: 'Nested icon', componentId: icon }),
      node('ELLIPSE', 32, nestedInUse, 'a', { name: 'Mark' })
    ],
    images: new Map(), message: { blobs: [] }
  });
  const localOwner = imported.document.components.find(item => item.name === 'Owner');
  const localIcon = imported.document.components.find(item => item.name === 'Icon');
  const ownerMaster = imported.document.pages[0].children.find(item => item.name === 'Owner');
  const ownerInstance = imported.document.pages[0].children.find(item => item.name === 'Owner use');
  assert.deepEqual(localOwner.exposedNestedInstances, [ownerMaster.children[0].id]);
  const groups = componentPropertyExposureGroups(imported.document, localOwner, ownerInstance);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].component.id, localIcon.id);
  assert.equal(groups[0].properties[0].name, 'Visible');
  const restored = parseDocument(serializeDocument(imported.document));
  const restoredOwner = restored.components.find(item => item.id === localOwner.id);
  const restoredInstance = restored.pages[0].children.find(item => item.id === ownerInstance.id);
  assert.equal(componentPropertyExposureGroups(restored, restoredOwner, restoredInstance).length, 1);
});

test('imports an exposed nested variant axis into the owning component instance controls', () => {
  const sessionID = 82;
  const page = { sessionID, localID: 1 };
  const badgeSet = { sessionID, localID: 10 };
  const badgeSmall = { sessionID, localID: 11 };
  const badgeLarge = { sessionID, localID: 13 };
  const owner = { sessionID, localID: 20 };
  const nestedInOwner = { sessionID, localID: 21 };
  const ownerUse = { sessionID, localID: 30 };
  const nestedInUse = { sessionID, localID: 31 };
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('COMPONENT_SET', 10, page, 'a', { guid: badgeSet, name: 'Badge', componentPropertyDefinitions: {
        Size: { type: 'VARIANT', defaultValue: 'Small', variantOptions: ['Small', 'Large'] }
      } }),
      node('COMPONENT', 11, badgeSet, 'a', { guid: badgeSmall, name: 'Badge/size=small', variantProperties: { Size: 'Small' } }),
      node('ELLIPSE', 12, badgeSmall, 'a', { name: 'Small artwork' }),
      node('COMPONENT', 13, badgeSet, 'b', { guid: badgeLarge, name: 'Badge/size=large', variantProperties: { Size: 'Large' } }),
      node('ELLIPSE', 14, badgeLarge, 'a', { name: 'Large artwork' }),
      node('COMPONENT', 20, page, 'b', { guid: owner, name: 'Card' }),
      node('INSTANCE', 21, owner, 'a', { guid: nestedInOwner, name: 'Badge', componentId: badgeSmall, isExposedInstance: true }),
      node('ELLIPSE', 22, nestedInOwner, 'a', { name: 'Small artwork' }),
      node('INSTANCE', 30, page, 'c', { guid: ownerUse, name: 'Card use', componentId: owner }),
      node('INSTANCE', 31, ownerUse, 'a', { guid: nestedInUse, name: 'Badge', componentId: badgeSmall }),
      node('ELLIPSE', 32, nestedInUse, 'a', { name: 'Small artwork' })
    ],
    images: new Map(), message: { blobs: [] }
  });
  const localOwner = imported.document.components.find(component => component.name === 'Card');
  const localSmall = imported.document.components.find(component => component.name === 'Badge/size=small');
  const localLarge = imported.document.components.find(component => component.name === 'Badge/size=large');
  const ownerUseNode = imported.document.pages[0].children.find(item => item.name === 'Card use');
  const actualNestedInstance = ownerUseNode.children.find(item => item.isInstance);
  assert.equal(actualNestedInstance?.componentId, localSmall.id);
  const groups = componentPropertyExposureGroups(imported.document, localOwner, ownerUseNode);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].properties, []);
  assert.deepEqual(groups[0].variantProperties.map(property => ({ name: property.name, values: property.values })), [
    { name: 'Size', values: ['Small', 'Large'] }
  ]);
  assert.equal(switchComponentInstanceVariant(imported.document, actualNestedInstance.id, localLarge.id), true);
  assert.equal(componentPropertyExposureGroups(imported.document, localOwner, ownerUseNode)[0].component.id, localLarge.id);
  const restored = parseDocument(serializeDocument(imported.document));
  const restoredOwner = restored.components.find(component => component.id === localOwner.id);
  const restoredUse = restored.pages[0].children.find(item => item.id === ownerUseNode.id);
  assert.deepEqual(componentPropertyExposureGroups(restored, restoredOwner, restoredUse)[0].variantProperties[0].values, ['Small', 'Large']);
});

test('preserves nested local component ownership and overrides through import, save, and synchronization', () => {
  const page = { sessionID: 80, localID: 1 };
  const inner = { sessionID: 80, localID: 10 };
  const innerLeaf = { sessionID: 80, localID: 11 };
  const outer = { sessionID: 80, localID: 20 };
  const innerInMaster = { sessionID: 80, localID: 21 };
  const masterLeaf = { sessionID: 80, localID: 22 };
  const outerInstance = { sessionID: 80, localID: 30 };
  const innerInInstance = { sessionID: 80, localID: 31 };
  const instanceLeaf = { sessionID: 80, localID: 32 };
  const paint = color => [{ type: 'SOLID', color: { ...color, a: 1 } }];
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('COMPONENT', 10, page, 'a', { guid: inner, name: 'Inner icon' }),
      node('RECTANGLE', 11, inner, 'a', { guid: innerLeaf, name: 'Artwork', fillPaints: paint({ r: 1, g: 0, b: 0 }) }),
      node('COMPONENT', 20, page, 'b', { guid: outer, name: 'Outer card' }),
      node('INSTANCE', 21, outer, 'a', { guid: innerInMaster, name: 'Nested icon', componentId: inner }),
      node('RECTANGLE', 22, innerInMaster, 'a', { guid: masterLeaf, name: 'Artwork', fillPaints: paint({ r: 0, g: 0, b: 1 }) }),
      node('INSTANCE', 30, page, 'c', { guid: outerInstance, name: 'Outer card use', componentId: outer }),
      node('INSTANCE', 31, outerInstance, 'a', { guid: innerInInstance, name: 'Nested icon', componentId: inner }),
      node('RECTANGLE', 32, innerInInstance, 'a', { guid: instanceLeaf, name: 'Artwork', fillPaints: paint({ r: 0, g: 1, b: 0 }) })
    ],
    images: new Map(), message: { blobs: [] }
  }, { fileName: 'nested-components.fig' });

  const { document, report } = imported;
  const pageNodes = document.pages[0].children;
  const innerMaster = pageNodes.find(candidate => candidate.name === 'Inner icon');
  const outerMaster = pageNodes.find(candidate => candidate.name === 'Outer card');
  const outerUse = pageNodes.find(candidate => candidate.name === 'Outer card use');
  const masterNested = outerMaster.children[0];
  const placedNested = outerUse.children[0];
  const masterNestedLeaf = masterNested.children[0];
  const placedNestedLeaf = placedNested.children[0];

  assert.equal(outerUse.isInstance, true);
  assert.equal(outerUse.componentId, document.components.find(component => component.name === 'Outer card').id);
  assert.equal(masterNested.isInstance, true);
  assert.equal(masterNested.componentId, document.components.find(component => component.name === 'Inner icon').id);
  assert.equal(placedNested.isInstance, true);
  assert.equal(placedNested.componentId, masterNested.componentId, 'the nested component target survives import');
  assert.equal(placedNested.componentSourceId, masterNested.id, 'the outer owner maps the nested root into its own source tree');
  assert.equal(placedNested.nestedComponentSourceId, innerMaster.id, 'the nested root retains its inner component identity');
  assert.equal(placedNestedLeaf.componentSourceId, masterNestedLeaf.id, 'the outer owner maps nested descendants into its source tree');
  assert.equal(placedNestedLeaf.nestedComponentSourceId, innerMaster.children[0].id, 'nested descendants retain their inner source identity');
  assert.deepEqual(masterNested.componentOverrides[innerMaster.children[0].id].fills, masterNestedLeaf.fills,
    'the nested master override remains owned by the inner instance');
  assert.deepEqual(placedNested.componentOverrides[innerMaster.children[0].id].fills, placedNestedLeaf.fills,
    'the placed nested instance override remains owned by the inner instance');
  assert.deepEqual(outerUse.componentOverrides[masterNestedLeaf.id].fills, placedNestedLeaf.fills,
    'the containing instance also records the effective nested leaf override');
  assert.equal(placedNestedLeaf.fills[0].color, '#00ff00');
  assert.equal(report.flattenedTypes.INSTANCE, undefined, 'local nested instances are not detached during import');

  const outerUseId = outerUse.id;
  const restored = parseDocument(serializeDocument(document));
  const restoredInnerMaster = restored.pages[0].children.find(candidate => candidate.id === innerMaster.id);
  restoredInnerMaster.children[0].fills[0].color = '#ffff00';
  assert.equal(syncAllComponentInstances(restored), 3, 'both nested instances and the outer instance synchronize');
  const restoredOuterMaster = restored.pages[0].children.find(candidate => candidate.id === outerMaster.id);
  const restoredOuter = restored.pages[0].children.find(candidate => candidate.id === outerUseId);
  const restoredNested = restoredOuter.children[0];
  assert.equal(restoredNested.componentId, masterNested.componentId);
  assert.equal(restoredNested.componentSourceId, masterNested.id);
  assert.equal(restoredNested.nestedComponentSourceId, innerMaster.id);
  assert.equal(restoredNested.children[0].componentSourceId, masterNestedLeaf.id);
  assert.equal(restoredNested.children[0].nestedComponentSourceId, innerMaster.children[0].id);
  assert.equal(restoredOuterMaster.children[0].children[0].fills[0].color, '#0000ff',
    'the nested-instance override keeps the outer component artwork independent of later inner-master edits');
  assert.equal(restoredNested.children[0].fills[0].color, '#00ff00', 'both ownership levels preserve the visible override after reload/sync');
});

test('unresolvable external component references are kept visually editable and reported as detached', () => {
  const page = { sessionID: 53, localID: 1 };
  const imported = convertFigDocument({
    nodes: [
      node('CANVAS', 1, null, '', { guid: page, name: 'Page' }),
      node('INSTANCE', 2, page, 'a', { guid: { sessionID: 53, localID: 2 }, name: 'Remote component', componentKey: 'remote-library-key' }),
      node('RECTANGLE', 3, { sessionID: 53, localID: 2 }, 'a', { name: 'Visible child' })
    ], images: new Map(), message: { blobs: [] }
  });
  const instance = imported.document.pages[0].children[0];
  assert.equal(instance.isInstance, undefined);
  assert.equal(instance.children[0].name, 'Visible child');
  assert.equal(imported.report.flattenedTypes.INSTANCE, 1);
  assert.match(imported.report.warnings.find(warning => warning.type === 'INSTANCE').detail, /external library component/u);
});

test('preflight rejects truncated, corrupt, path-traversal, and over-budget archives before parser execution', async () => {
  const original = new Uint8Array(await readFile(circlePath));
  const canvas = preflightFigArchive(original).entries.get('canvas.fig');
  assert.throws(() => preflightFigArchive(original.subarray(0, original.length - 4)), /complete .fig ZIP archive/);

  const corrupt = zip({ 'canvas.fig': canvas });
  corrupt[canvasDataOffset(corrupt)] ^= 0xff;
  assert.throws(() => preflightFigArchive(corrupt), /integrity check/);

  assert.throws(() => preflightFigArchive(zip({ 'canvas.fig': canvas, '../escape': new Uint8Array([1]) })), /unsafe file path/);
  assert.throws(() => preflightFigArchive(zip({
    'canvas.fig': canvas,
    'meta.json': new Uint8Array(FIG_IMPORT_LIMITS.metadataBytes + 1)
  })), /metadata exceeds the safe import size limit/);

  const zstdHeader = new Uint8Array(9);
  zstdHeader.set([0x28, 0xb5, 0x2f, 0xfd, 0xa0]);
  new DataView(zstdHeader.buffer).setUint32(5, FIG_IMPORT_LIMITS.messageBytes + 1, true);
  assert.throws(() => preflightFigArchive(zip({ 'canvas.fig': canvasWithMessage(zstdHeader) })), /design data exceeds the safe import size limit/);
});

test('converts editable text, fills, constraints, and embedded images while reporting flattening and omissions', () => {
  const pageGuid = { sessionID: 1, localID: 1 };
  const frameGuid = { sessionID: 1, localID: 2 };
  const imageHash = 'a'.repeat(40);
  const png = pngHeader(2, 3);
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { name: 'Page 1' }),
      node('FRAME', 2, pageGuid, '!', { name: 'Main frame', frameMaskDisabled: false, fillPaints: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] }),
      node('RECTANGLE', 3, frameGuid, 'a', { name: 'Photo', fillPaints: [{ type: 'IMAGE', image: { hash: imageHash }, scaleMode: 'FIT', visible: true }] }),
      node('TEXT', 4, frameGuid, 'B', { name: 'Headline', textData: { characters: 'Hello mobile' }, fontName: { family: 'Inter', style: 'Semi Bold Italic' }, fontSize: 32, textAlignHorizontal: 'RIGHT', textAlignVertical: 'CENTER', textAutoResize: 'HEIGHT', paragraphSpacing: 2, fillPaints: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3, a: 1 }, opacity: 0.5, visible: true }] }),
      node('MYSTERY_CONTAINER', 5, frameGuid, 'c', {
        name: 'Kept container',
        effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 2 }, radius: 3 }]
      }),
      node('ELLIPSE', 6, { sessionID: 1, localID: 5 }, '!', { name: 'Kept child', fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }] }),
      node('MYSTERY_LEAF', 7, frameGuid, 'z', { name: 'Omitted visible layer' }),
      node('BOOLEAN_OPERATION', 8, frameGuid, 'zz', { name: 'Invalid boolean', booleanOperation: 'UNION' }),
      node('__proto__', 9, frameGuid, 'zzz', { name: 'Unsafe warning key' })
    ],
    message: { blobs: [] },
    images: new Map([[imageHash, png]])
  };
  const imported = convertFigDocument(parsed, { fileName: 'mobile.fig', formatVersion: 106 });
  const frame = imported.document.pages[0].children[0];
  assert.equal(frame.clip, true);
  assert.deepEqual(frame.children.map(child => child.name), ['Headline', 'Photo', 'Kept container', 'Invalid boolean']);
  assert.equal(frame.children[0].fontFamily, 'Inter');
  assert.equal(frame.children[0].fontWeight, 600);
  assert.equal(frame.children[0].fontStyle, 'italic');
  assert.equal(frame.children[0].align, 'right');
  assert.equal(frame.children[0].verticalAlign, 'middle');
  assert.equal(frame.children[0].textFit, 'auto-height');
  assert.equal(frame.children[0].color, '#1a334d');
  assert.equal(frame.children[0].opacity, 1, 'base paint opacity stays on its own paint instead of changing layer opacity');
  assert.equal(frame.children[0].fills[0].type, 'solid');
  assert.equal(frame.children[0].fills[0].opacity, 0.5);
  assert.equal(frame.children[0].color, '#1a334d', 'the legacy text color remains a compatibility fallback');
  assert.equal(frame.children[1].fills[0].type, 'image');
  assert.deepEqual(imported.assets[0].bytes, png);
  assert.deepEqual(imported.document.imageLibrary.map(({ width, height }) => ({ width, height })), [{ width: 2, height: 3 }]);
  assert.equal(frame.children[2].type, 'group');
  assert.equal(frame.children[2].children[0].type, 'ellipse');
  assert.equal(frame.children[2].effects[0].type, 'drop-shadow', 'supported effects survive editable-container fallback');
  assert.equal(frame.children[3].type, 'group');
  assert.equal(imported.report.flattenedTypes.MYSTERY_CONTAINER, 1);
  assert.equal(imported.report.flattenedTypes.BOOLEAN_OPERATION, 1);
  assert.equal(imported.report.unsupportedTypes.MYSTERY_LEAF, 1);
  assert.equal(imported.report.unsupportedTypes.__proto__, 1);
  assert.match(imported.report.warnings.find(warning => warning.type === 'MYSTERY_LEAF').detail, /omitted/);
});

test('preserves Figma image-fill filters as editable local adjustments and reviews invalid filter values', () => {
  const pageGuid = { sessionID: 90, localID: 1 };
  const imageHash = 'c'.repeat(40);
  const png = pngHeader(2, 3);
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Image filters' }),
      node('RECTANGLE', 2, pageGuid, 'a', {
        name: 'Edited photo', fillPaints: [{
          type: 'IMAGE', image: { hash: imageHash }, scaleMode: 'FIT', filters: {
            exposure: -1, contrast: 0.25, saturation: 0, temperature: 0.5,
            tint: -0.25, highlights: 0.75, shadows: 1
          }
        }]
      }),
      node('RECTANGLE', 3, pageGuid, 'b', {
        name: 'Partially valid photo', fillPaints: [{
          type: 'IMAGE', image: { hash: imageHash }, scaleMode: 'FIT',
          filters: { exposure: 1.1, contrast: -0.4, futureFilter: 0.5 }
        }]
      })
    ],
    images: new Map([[imageHash, png]]), message: { blobs: [] }
  }, { fileName: 'image-filters.fig' });
  const [edited, partial] = imported.document.pages[0].children;
  const adjustments = edited.fills[0].imageFill.adjustments;

  assert.deepEqual({
    exposure: adjustments.exposure, contrast: adjustments.contrast, saturation: adjustments.saturation,
    temperature: adjustments.temperature, tint: adjustments.tint, highlights: adjustments.highlights, shadows: adjustments.shadows
  }, {
    exposure: -100, contrast: 25, saturation: 0,
    temperature: 50, tint: -25, highlights: 75, shadows: 100
  }, 'Figma filter slider values map from [-1, 1] to the local percentage scale');
  assert.equal(partial.fills[0].imageFill.adjustments.exposure, 0, 'out-of-range filters use the local default');
  assert.equal(partial.fills[0].imageFill.adjustments.contrast, -40, 'valid filters survive alongside invalid ones');
  assert.equal(imported.report.flattenedTypes.IMAGE_FILTER, 1, 'invalid and unknown settings are disclosed once per paint');
  assert.equal(imported.report.flattenedTypes.IMAGE_TRANSFORM, undefined, 'supported filters no longer trigger crop-transform warnings');
  const restored = parseDocument(serializeDocument(imported.document));
  assert.deepEqual(restored.pages[0].children[0].fills, edited.fills, 'adjustments survive local document serialization');
});

test('imports explicit Figma text truncation and max lines, including legacy TRUNCATE', () => {
  const pageGuid = { sessionID: 1, localID: 1 };
  const parsed = {
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { name: 'Truncation page' }),
      node('TEXT', 2, pageGuid, '!', {
        name: 'Ending text', textData: { characters: 'One\nTwo\nThree' },
        textAutoResize: 'NONE', textTruncation: 'ENDING', maxLines: 2
      }),
      node('TEXT', 3, pageGuid, 'a', {
        name: 'Disabled text', textData: { characters: 'No truncation' },
        textAutoResize: 'HEIGHT', textTruncation: 'DISABLED', maxLines: null
      }),
      node('TEXT', 4, pageGuid, 'b', {
        name: 'Legacy truncate', textData: { characters: 'Old export' },
        textAutoResize: 'TRUNCATE'
      })
    ],
    message: { blobs: [] },
    images: new Map()
  };
  const imported = convertFigDocument(parsed, { fileName: 'truncation.fig', formatVersion: 106 });
  const [ending, disabled, legacy] = imported.document.pages[0].children;
  assert.deepEqual(
    [ending.textFit, ending.textTruncation, ending.maxLines],
    ['fixed', 'ending', 2]
  );
  assert.deepEqual(
    [disabled.textFit, disabled.textTruncation, disabled.maxLines],
    ['auto-height', 'disabled', null]
  );
  assert.deepEqual(
    [legacy.textFit, legacy.textTruncation, Object.hasOwn(legacy, 'maxLines')],
    ['fixed', 'ending', false],
    'deprecated textAutoResize=TRUNCATE stays fixed-size and gains ending truncation'
  );
});

test('imports text-node solid, gradient, image fills and solid/gradient strokes as editable paint stacks', () => {
  const pageGuid = { sessionID: 91, localID: 1 };
  const imageHash = 'b'.repeat(40);
  const png = pngHeader(2, 3);
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('TEXT', 2, pageGuid, 'a', {
        name: 'Painted heading', strokeWeight: 3,
        textData: { characters: 'Brand' },
        fillPaints: [
          { type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3, a: 1 }, opacity: 0.8 },
          { type: 'GRADIENT_LINEAR', opacity: 0.7, stops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
          ] },
          { type: 'IMAGE', image: { hash: imageHash }, scaleMode: 'FIT', opacity: 0.6 }
        ],
        strokePaints: [
          { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 0.9 },
          { type: 'GRADIENT_RADIAL', opacity: 0.75, stops: [
            { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } }
          ] },
          { type: 'IMAGE', image: { hash: imageHash }, scaleMode: 'FIT' }
        ]
      })
    ],
    images: new Map([[imageHash, png]]), message: { blobs: [] }
  });

  const text = imported.document.pages[0].children[0];
  assert.deepEqual(text.fills.map(fill => fill.type), ['solid', 'linear', 'image']);
  assert.deepEqual(text.fills.map(fill => fill.opacity), [0.8, 0.7, 0.6]);
  assert.deepEqual(text.strokes.map(stroke => Boolean(stroke.gradient)), [false, true]);
  assert.deepEqual(text.strokes.map(stroke => stroke.opacity), [0.9, 0.75]);
  assert.equal(text.strokes[0].width, 3);
  assert.equal(text.color, '#1a334d', 'the compatibility color stays available alongside the new layer paints');
  assert.equal(imported.assets.length, 1);
  const restored = parseDocument(serializeDocument(imported.document));
  assert.deepEqual(restored.pages[0].children[0].fills, text.fills);
  assert.deepEqual(restored.pages[0].children[0].strokes, text.strokes);
  assert.equal(imported.report.unsupportedTypes.IMAGE, 1, 'image strokes stay explicitly reported as unsupported');
});

test('text run solid fills stay editable without node paint stacks and unsupported non-solid run paints are reported', () => {
  const pageGuid = { sessionID: 92, localID: 1 };
  const imported = convertFigDocument({
    header: { version: 106 },
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('TEXT', 2, pageGuid, 'a', {
        name: 'Run paints', textData: {
          characters: 'AB', characterStyleOverrides: [1, 2],
          styleOverrideTable: {
            1: { fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }] },
            2: { fills: [{ type: 'GRADIENT_LINEAR', stops: [
              { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
              { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }
            ] }] }
          }
        }
      })
    ], images: new Map(), message: { blobs: [] }
  });

  const text = imported.document.pages[0].children[0];
  assert.equal(text.fills, undefined, 'no empty node paint stack is invented');
  assert.deepEqual(text.textRuns, [{ text: 'A', color: '#ff0000' }, { text: 'B' }]);
  assert.equal(imported.report.unsupportedTypes.TEXT_STYLE_PAINT, 1);
  assert.match(imported.report.warnings.find(warning => warning.type === 'TEXT_STYLE_PAINT').detail, /Per-range gradient/);
});

test('imports common Figma shadows and foreground/background blurs as editable local effects', () => {
  const pageGuid = { sessionID: 71, localID: 1 };
  const frameGuid = { sessionID: 71, localID: 3 };
  const imported = convertFigDocument({
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('RECTANGLE', 2, pageGuid, 'a', {
        name: 'Card',
        effects: [
          { type: 'DROP_SHADOW', color: { r: 0.1, g: 0.2, b: 0.3, a: 0.5 }, opacity: 0.5, offset: { x: 3.5, y: 7 }, radius: 12 },
          { type: 'INNER_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: -2, y: 1 }, radius: 4 },
          { type: 'FOREGROUND_BLUR', radius: 6 }
        ]
      }),
      node('FRAME', 3, pageGuid, 'b', {
        guid: frameGuid, name: 'Frosted panel',
        effects: [{ type: 'BACKGROUND_BLUR', radius: 14 }]
      })
    ], images: new Map(), message: { blobs: [] }
  });
  const [card, panel] = imported.document.pages[0].children;

  assert.deepEqual(card.effects.map(({ type, color, opacity, offsetX, offsetY, blur, radius }) => ({ type, color, opacity, offsetX, offsetY, blur, radius })), [
    { type: 'drop-shadow', color: '#1a334d', opacity: 0.25, offsetX: 3.5, offsetY: 7, blur: 12, radius: undefined },
    { type: 'inner-shadow', color: '#000000', opacity: 1, offsetX: -2, offsetY: 1, blur: 4, radius: undefined },
    { type: 'layer-blur', color: undefined, opacity: undefined, offsetX: undefined, offsetY: undefined, blur: undefined, radius: 6 }
  ]);
  assert.deepEqual(panel.effects.map(({ type, radius }) => [type, radius]), [['background-blur', 14]]);
  assert.equal(imported.report.unsupportedTypes.EFFECT, undefined);
  const restored = parseDocument(serializeDocument(imported.document));
  assert.deepEqual(restored.pages[0].children[0].effects.map(effect => effect.type), ['drop-shadow', 'inner-shadow', 'layer-blur']);
  assert.deepEqual(restored.pages[0].children[1].effects.map(effect => effect.type), ['background-blur']);
});

test('keeps supported effects editable while explicitly reporting effect features that cannot be represented', () => {
  const pageGuid = { sessionID: 72, localID: 1 };
  const shadows = Array.from({ length: 9 }, (_, index) => ({
    type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 2 }, radius: 3,
    ...(index === 0 ? { spread: 5, blendMode: 'MULTIPLY', showShadowBehindNode: false } : {})
  }));
  const imported = convertFigDocument({
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('RECTANGLE', 2, pageGuid, 'a', {
        name: 'Unsupported effects', effects: [
          ...shadows,
          { type: 'FOREGROUND_BLUR', radius: 4 },
          { type: 'BACKGROUND_BLUR', radius: 8 },
          { type: 'REPEAT', visible: true }
        ]
      })
    ], images: new Map(), message: { blobs: [] }
  });
  const layer = imported.document.pages[0].children[0];

  assert.equal(layer.effects.length, 9, 'eight shadows and one blur fit the local stack');
  assert.equal(layer.effects.filter(effect => effect.type === 'drop-shadow').length, 8);
  assert.equal(layer.effects.filter(effect => effect.type === 'layer-blur').length, 1);
  assert.equal(layer.effects.some(effect => effect.type === 'background-blur'), false,
    'the local model permits only one foreground or background blur');
  assert.equal(imported.report.unsupportedTypes.EFFECT_STACK, 2, 'the ninth shadow and competing blur are reported');
  assert.equal(imported.report.unsupportedTypes.REPEAT, 1, 'unsupported effect types are omitted and identified');
  for (const warningType of ['EFFECT_SPREAD', 'EFFECT_BLEND', 'EFFECT_ORDER']) {
    assert.equal(imported.report.flattenedTypes[warningType], 1, `${warningType} loss is reported`);
  }
  assert.equal(parseDocument(serializeDocument(imported.document)).pages[0].children[0].effects.length, 9);
});

test('imports supported mixed character styles as editable rich-text runs', () => {
  const pageGuid = { sessionID: 21, localID: 1 };
  const textGuid = { sessionID: 21, localID: 2 };
  const characters = 'A🚀B';
  const imported = convertFigDocument({
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('TEXT', 2, pageGuid, '!', {
        guid: textGuid,
        name: 'Styled headline',
        textData: {
          characters,
          style: {
            fontFamily: 'Inter', fontSize: 24, fontWeight: 400,
            lineHeight: { unit: 'PIXELS', value: 30 }, letterSpacing: { unit: 'PIXELS', value: 0 }
          },
          // The rocket occupies two UTF-16 positions; both reference one style.
          characterStyleOverrides: [0, 1, 1, 2],
          styleOverrideTable: {
            1: {
              fontName: { family: 'Inter', style: 'Bold Italic' }, fontSize: 32,
              lineHeight: { unit: 'PIXELS', value: 48 }, letterSpacing: { unit: 'PERCENT', value: 10 },
              fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }]
            },
            2: { fontWeight: 500, textDecoration: 'UNDERLINE' }
          }
        },
        fillPaints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, visible: true }]
      })
    ],
    images: new Map(), message: { blobs: [] }
  }, { fileName: 'mixed-text.fig' });

  const text = imported.document.pages[0].children[0];
  assert.equal(text.textRuns.map(run => run.text).join(''), characters);
  assert.deepEqual(text.textRuns, [
    { text: 'A' },
    { text: '🚀', fontSize: 32, fontWeight: 700, fontStyle: 'italic', lineHeight: 48, lineHeightUnit: 'pixels', letterSpacing: 3.2, color: '#ff0000' },
    { text: 'B', fontWeight: 500, textDecoration: 'underline' }
  ]);
  assert.equal(text.lineHeight, 30);
  assert.equal(text.lineHeightUnit, 'pixels');
  assert.equal(imported.report.flattenedTypes.TEXT_STYLE, undefined);
});

test('preserves imported Auto and Percent line-height units while legacy numbers remain ratios', () => {
  const pageGuid = { sessionID: 121, localID: 1 };
  const nodes = [
    node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
    node('TEXT', 2, pageGuid, 'a', { textData: { characters: 'Auto', style: { fontSize: 20, lineHeight: { unit: 'AUTO', value: 0 } } } }),
    node('TEXT', 3, pageGuid, 'b', { textData: { characters: 'Percent', style: { fontSize: 20, lineHeight: { unit: 'PERCENT', value: 135 } } } }),
    node('TEXT', 4, pageGuid, 'c', { textData: { characters: 'Legacy', style: { fontSize: 20, lineHeight: 1.4 } } })
  ];
  const { document } = convertFigDocument({ nodes, images: new Map(), message: { blobs: [] } });
  assert.deepEqual(document.pages[0].children.map(({ lineHeight, lineHeightUnit }) => [lineHeight, lineHeightUnit]), [
    [1, 'auto'], [135, 'percent'], [1.4, 'ratio']
  ]);
});

test('short mixed-style maps default trailing text safely and reject a split surrogate boundary', () => {
  const pageGuid = { sessionID: 22, localID: 1 };
  const textGuid = { sessionID: 22, localID: 2 };
  const makeDocument = (characters, characterStyleOverrides) => convertFigDocument({
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('TEXT', 2, pageGuid, '!', {
        guid: textGuid, name: 'Text',
        textData: { characters, characterStyleOverrides, styleOverrideTable: { 1: { fontWeight: 700 } } }
      })
    ], images: new Map(), message: { blobs: [] }
  });

  const trailingDefault = makeDocument('ABCD', [1]).document.pages[0].children[0];
  assert.deepEqual(trailingDefault.textRuns, [{ text: 'A', fontWeight: 700 }, { text: 'BCD' }]);

  const splitPair = makeDocument('😀x', [1, 0, 0]);
  assert.equal(splitPair.document.pages[0].children[0].textRuns, undefined);
  assert.equal(splitPair.report.flattenedTypes.TEXT_STYLE_SURROGATE, 1);
});

test('imports horizontal and vertical auto layout as editable local layout instead of fixed positions', () => {
  const pageGuid = { sessionID: 3, localID: 1 };
  const horizontalGuid = { sessionID: 3, localID: 2 };
  const verticalGuid = { sessionID: 3, localID: 5 };
  const parsed = {
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
      node('FRAME', 2, pageGuid, '!', {
        guid: horizontalGuid, name: 'Toolbar', size: { x: 360, y: 120 }, stackMode: 'HORIZONTAL',
        stackPrimarySizing: 'FIXED', stackCounterSizing: 'FIXED',
        stackPrimaryAlignItems: 4, stackCounterAlignItems: 1,
        stackSpacing: 16, stackCounterSpacing: 12, stackHorizontalPadding: 20,
        stackVerticalPadding: 10, stackPaddingRight: 24, stackPaddingBottom: 8, stackWrap: 'WRAP'
      }),
      node('RECTANGLE', 3, horizontalGuid, 'a', {
        name: 'Flexible action', size: { x: 64, y: 30 }, stackChildPrimaryGrow: 1,
        stackChildAlignSelf: 3, minSize: { x: 40, y: 20 }, maxSize: { x: 200, y: 90 }
      }),
      node('RECTANGLE', 4, horizontalGuid, 'b', {
        name: 'Floating action', size: { x: 24, y: 24 }, stackPositioning: 'ABSOLUTE',
        transform: { m00: 1, m01: 0, m02: 310, m10: 0, m11: 1, m12: 12 }
      }),
      node('FRAME', 5, pageGuid, 'z', {
        guid: verticalGuid, name: 'Vertical card', size: { x: 220, y: 160 }, stackMode: 2,
        stackPrimarySizing: 2, stackCounterSizing: 0, stackSpacing: 14,
        stackPadding: 8, stackPrimaryAlignItems: 0, stackCounterAlignItems: 1
      }),
      node('TEXT', 6, verticalGuid, 'a', { name: 'Title', size: { x: 120, y: 36 } })
    ],
    images: new Map(), message: { blobs: [] }
  };
  const imported = convertFigDocument(parsed, { fileName: 'auto-layout.fig' });
  const [toolbar, card] = imported.document.pages[0].children;

  assert.deepEqual(toolbar.autoLayout, {
    axis: 'horizontal', gap: 16, padding: { top: 10, right: 24, bottom: 8, left: 20 },
    rowGap: 12, columnGap: 16, columns: 2, rows: 'auto', autoPositioning: true,
    align: 'center', justify: 'space-between', wrap: true, wrapDistribution: 'start', mainSizing: 'fixed', crossSizing: 'fixed'
  });
  assert.equal(toolbar.children[0].layoutSizingMain, 'fill');
  assert.equal(toolbar.children[0].layoutAlignSelf, 'stretch');
  assert.deepEqual([toolbar.children[0].minWidth, toolbar.children[0].minHeight, toolbar.children[0].maxWidth, toolbar.children[0].maxHeight], [40, 20, 200, 90]);
  assert.equal(toolbar.children[1].layoutPositioning, 'absolute');
  assert.deepEqual([toolbar.children[1].x, toolbar.children[1].y], [310, 12]);
  assert.equal(card.autoLayout.axis, 'vertical');
  assert.equal(card.autoLayout.mainSizing, 'hug');
  assert.equal(card.autoLayout.crossSizing, 'fixed');
  assert.equal(card.autoLayout.align, 'center');
  assert.deepEqual(card.autoLayout.padding, { top: 8, right: 8, bottom: 8, left: 8 });
  assert.equal(imported.report.flattenedTypes.AUTO_LAYOUT, undefined);

  applyAutoLayout(toolbar);
  assert.equal(toolbar.children[0].width, 200, 'fill sizing honors the imported maximum width');
  assert.equal(toolbar.children[0].height, 90, 'child stretch honors the imported cross-axis alignment, padding, and maximum size');
  assert.deepEqual([toolbar.children[1].x, toolbar.children[1].y], [310, 12], 'absolute children keep their imported local position');
});

test('imports wrapped track space-between distribution from string and numeric Figma enums', () => {
  for (const [index, contentAlignment] of ['SPACE_BETWEEN', 1].entries()) {
    const pageGuid = { sessionID: 6 + index, localID: 1 };
    const frameGuid = { sessionID: 6 + index, localID: 2 };
    const parsed = {
      nodes: [
        node('CANVAS', 1, null, '', { guid: pageGuid, name: 'Page' }),
        node('FRAME', 2, pageGuid, '!', {
          guid: frameGuid, name: 'Wrapped toolbar', size: { x: 200, y: 140 }, stackMode: 'HORIZONTAL',
          stackPrimarySizing: 'FIXED', stackCounterSizing: 'FIXED', stackSpacing: 10,
          stackCounterSpacing: 10, stackWrap: 'WRAP', stackCounterAlignContent: contentAlignment
        }),
        node('RECTANGLE', 3, frameGuid, 'a', { name: 'First', size: { x: 70, y: 20 } }),
        node('RECTANGLE', 4, frameGuid, 'b', { name: 'Second', size: { x: 70, y: 20 } }),
        node('RECTANGLE', 5, frameGuid, 'c', { name: 'Third', size: { x: 70, y: 20 } })
      ],
      images: new Map(), message: { blobs: [] }
    };
    const imported = convertFigDocument(parsed, { fileName: 'wrapped-space-between.fig' });
    const frame = imported.document.pages[0].children[0];

    assert.equal(frame.autoLayout.wrapDistribution, 'space-between');
    assert.equal(imported.report.flattenedTypes.AUTO_LAYOUT_WRAP_ALIGNMENT, undefined,
      'supported track distribution must not be reported as flattened');
    applyAutoLayout(frame);
    assert.deepEqual(frame.children.map(child => child.y), [0, 0, 120],
      'the last wrapped row should be distributed against the opposite frame edge');
  }
});

test('unknown wrapped track distribution still warns and safely falls back to start', () => {
  const pageGuid = { sessionID: 8, localID: 1 };
  const frameGuid = { sessionID: 8, localID: 2 };
  const imported = convertFigDocument({
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid }),
      node('FRAME', 2, pageGuid, '!', {
        guid: frameGuid, size: { x: 200, y: 140 }, stackMode: 'HORIZONTAL', stackWrap: 'WRAP',
        stackCounterAlignContent: 'SPACE_AROUND'
      }),
      node('RECTANGLE', 3, frameGuid, 'a', { size: { x: 70, y: 20 } })
    ],
    images: new Map(), message: { blobs: [] }
  }, { fileName: 'unknown-wrap-alignment.fig' });
  const frame = imported.document.pages[0].children[0];

  assert.equal(frame.autoLayout.wrapDistribution, 'start');
  assert.equal(imported.report.flattenedTypes.AUTO_LAYOUT_WRAP_ALIGNMENT, 1);
});

test('imports editable manual grid tracks, placements, spans, gaps, padding, and cell alignment', () => {
  const pageGuid = { sessionID: 4, localID: 1 };
  const frameGuid = { sessionID: 4, localID: 2 };
  const column1 = { sessionID: 4, localID: 10 };
  const column2 = { sessionID: 4, localID: 11 };
  const row1 = { sessionID: 4, localID: 12 };
  const row2 = { sessionID: 4, localID: 13 };
  const parsed = {
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid }),
      node('FRAME', 2, pageGuid, '!', {
        guid: frameGuid, name: 'Manual grid', size: { x: 400, y: 300 }, stackMode: 3,
        stackHorizontalPadding: 10, stackVerticalPadding: 12, stackPaddingRight: 20, stackPaddingBottom: 8,
        gridRowGap: 10, gridColumnGap: 10, gridAutoTracks: 0, gridReflowEnabled: false,
        gridColumns: { entries: [{ id: column2, position: 'b' }, { id: column1, position: 'a' }] },
        gridRows: { entries: [{ id: row2, position: 'b' }, { id: row1, position: 'a' }] },
        gridColumnsSizing: { entries: [
          { id: column2, trackSize: { minSizing: { type: 0, value: 2 }, maxSizing: { type: 0, value: 2 } } },
          { id: column1, trackSize: { minSizing: { type: 1, value: 80 }, maxSizing: { type: 1, value: 80 } } }
        ] },
        gridRowsSizing: { entries: [
          { id: row2, trackSize: { minSizing: { type: 0, value: 1 }, maxSizing: { type: 0, value: 1 } } },
          { id: row1, trackSize: { minSizing: { type: 1, value: 80 }, maxSizing: { type: 1, value: 80 } } }
        ] }
      }),
      node('RECTANGLE', 3, frameGuid, 'a', {
        name: 'Spanning cell', size: { x: 100, y: 30 }, gridRowAnchor: row1, gridColumnAnchor: column1,
        gridColumnSpan: 2, gridRowSpan: 1, gridChildHorizontalAlign: 2, gridChildVerticalAlign: 1
      }),
      node('RECTANGLE', 4, frameGuid, 'b', {
        name: 'Anchored cell', size: { x: 40, y: 20 }, gridRowAnchor: row2, gridColumnAnchor: column2,
        gridChildHorizontalAlign: 3, gridChildVerticalAlign: 2
      })
    ],
    images: new Map(), message: { blobs: [] }
  };
  const imported = convertFigDocument(parsed, { fileName: 'grid.fig' });
  const frame = imported.document.pages[0].children[0];
  assert.deepEqual(frame.autoLayout, {
    axis: 'grid', gap: 10, padding: { top: 12, right: 20, bottom: 8, left: 10 },
    rowGap: 10, columnGap: 10, columns: 2, rows: 2, autoPositioning: false,
    align: 'start', justify: 'start', wrap: false, wrapDistribution: 'start', mainSizing: 'fixed', crossSizing: 'fixed',
    columnTracks: [{ mode: 'fixed', value: 80 }, { mode: 'fill', weight: 2 }],
    rowTracks: [{ mode: 'fixed', value: 80 }, { mode: 'fill', weight: 1 }]
  });
  assert.deepEqual(frame.children[0].gridCell, { row: 1, column: 1, rowSpan: 1, columnSpan: 2, alignX: 'center', alignY: 'start' });
  assert.deepEqual(frame.children[1].gridCell, { row: 2, column: 2, alignX: 'end', alignY: 'center' });
  assert.equal(imported.report.flattenedTypes.AUTO_LAYOUT_GRID, undefined);

  applyAutoLayout(frame);
  assert.deepEqual([frame.children[0].x, frame.children[0].y], [145, 12], 'a spanning child aligns to its full two-column area');
  assert.deepEqual([frame.children[1].x, frame.children[1].y], [340, 187], 'manual anchors use ordered track IDs and fill track weights');
});

test('imports fixed and hug grid track minimum bounds and applies them during reflow', () => {
  const pageGuid = { sessionID: 8, localID: 1 };
  const frameGuid = { sessionID: 8, localID: 2 };
  const column1 = { sessionID: 8, localID: 10 };
  const column2 = { sessionID: 8, localID: 11 };
  const row1 = { sessionID: 8, localID: 12 };
  const parsed = {
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid }),
      node('FRAME', 2, pageGuid, '!', {
        guid: frameGuid, name: 'Bounded grid', size: { x: 600, y: 100 }, stackMode: 'GRID',
        gridRowGap: 0, gridColumnGap: 0, gridAutoTracks: 0, gridReflowEnabled: false,
        gridColumns: { entries: [{ id: column1, position: 'a' }, { id: column2, position: 'b' }] },
        gridRows: { entries: [{ id: row1, position: 'a' }] },
        gridColumnsSizing: { entries: [
          { id: column1, trackSize: { minSizing: { type: 'FIXED', value: 240 }, maxSizing: { type: 'FLEX', value: 1 } } },
          { id: column2, trackSize: { minSizing: { type: 'HUG' }, maxSizing: { type: 'FLEX', value: 1 } } }
        ] },
        gridRowsSizing: { entries: [{ id: row1, trackSize: { minSizing: { type: 'HUG' }, maxSizing: { type: 'HUG' } } }] }
      }),
      node('RECTANGLE', 3, frameGuid, 'a', {
        name: 'Fixed minimum cell', size: { x: 20, y: 20 }, gridRowAnchor: row1, gridColumnAnchor: column1
      }),
      node('RECTANGLE', 4, frameGuid, 'b', {
        name: 'Content minimum cell', size: { x: 350, y: 20 }, gridRowAnchor: row1, gridColumnAnchor: column2
      })
    ],
    images: new Map(), message: { blobs: [] }
  };
  const imported = convertFigDocument(parsed, { fileName: 'bounded-grid.fig' });
  const frame = imported.document.pages[0].children[0];

  assert.deepEqual(frame.autoLayout.columnTracks, [
    { mode: 'fill', weight: 1, minSize: 240 },
    { mode: 'fill', weight: 1, minContent: true }
  ]);
  assert.equal(imported.report.flattenedTypes.AUTO_LAYOUT_GRID_TRACK_BOUNDS, undefined,
    'supported fixed-pixel and intrinsic-content bounds should not be reported as approximations');

  applyAutoLayout(frame);
  assert.deepEqual(frame.children.map(child => [child.x, child.width]), [[0, 20], [250, 350]],
    'the minimum-constrained track freezes at its content floor and the other fill track receives the remainder');
});

test('imports flexible grid track minimum bounds and rejects contradictory fractional bounds', () => {
  const pageGuid = { sessionID: 18, localID: 1 };
  const frameGuid = { sessionID: 18, localID: 2 };
  const column1 = { sessionID: 18, localID: 10 };
  const column2 = { sessionID: 18, localID: 11 };
  const row1 = { sessionID: 18, localID: 12 };
  const parsed = {
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid }),
      node('FRAME', 2, pageGuid, '!', {
        guid: frameGuid, name: 'Flexible bounds', size: { x: 300, y: 100 }, stackMode: 'GRID',
        gridRowGap: 0, gridColumnGap: 0, gridAutoTracks: 0, gridReflowEnabled: false,
        gridColumns: { entries: [{ id: column1, position: 'a' }, { id: column2, position: 'b' }] },
        gridRows: { entries: [{ id: row1, position: 'a' }] },
        gridColumnsSizing: { entries: [
          { id: column1, trackSize: { minSizing: { type: 'FLEX', value: 0.5 }, maxSizing: { type: 'FLEX', value: 1 } } },
          { id: column2, trackSize: { minSizing: { type: 'FIXED', value: 250 }, maxSizing: { type: 'FLEX', value: 1 } } }
        ] }
      }),
      node('RECTANGLE', 3, frameGuid, 'a', {
        name: 'Fraction floor', size: { x: 10, y: 10 }, layoutSizingHorizontal: 'FILL',
        gridRowAnchor: row1, gridColumnAnchor: column1
      }),
      node('RECTANGLE', 4, frameGuid, 'b', {
        name: 'Pixel floor', size: { x: 10, y: 10 }, layoutSizingHorizontal: 'FILL',
        gridRowAnchor: row1, gridColumnAnchor: column2
      })
    ],
    images: new Map(), message: { blobs: [] }
  };
  const imported = convertFigDocument(parsed, { fileName: 'flexible-bounds.fig' });
  const frame = imported.document.pages[0].children[0];

  assert.deepEqual(frame.autoLayout.columnTracks, [
    { mode: 'fill', weight: 1, minWeight: 0.5 },
    { mode: 'fill', weight: 1, minSize: 250 }
  ]);
  assert.equal(imported.report.flattenedTypes.AUTO_LAYOUT_GRID_TRACK_BOUNDS, undefined);
  applyAutoLayout(frame);
  assert.deepEqual(gridTrackLayout(frame).columns.map(track => track.size), [75, 250]);

  const contradictory = structuredClone(parsed);
  contradictory.nodes[1].gridColumnsSizing.entries[0].trackSize.minSizing.value = 2;
  const invalid = convertFigDocument(contradictory, { fileName: 'contradictory-bounds.fig' });
  assert.deepEqual(invalid.document.pages[0].children[0].autoLayout.columnTracks[0], { mode: 'fill', weight: 1 });
  assert.ok(invalid.report.warnings.some(warning => warning.type === 'AUTO_LAYOUT_GRID_TRACK_BOUNDS'));
});

test('imports row-major grid flow and automatic hug rows', () => {
  const pageGuid = { sessionID: 5, localID: 1 };
  const frameGuid = { sessionID: 5, localID: 2 };
  const column1 = { sessionID: 5, localID: 10 };
  const column2 = { sessionID: 5, localID: 11 };
  const row1 = { sessionID: 5, localID: 12 };
  const parsed = {
    nodes: [
      node('CANVAS', 1, null, '', { guid: pageGuid }),
      node('FRAME', 2, pageGuid, '!', {
        guid: frameGuid, name: 'Flow grid', size: { x: 220, y: 160 }, stackMode: 'GRID',
        gridRowGap: 5, gridColumnGap: 20, gridAutoTracks: 1, gridReflowEnabled: true,
        gridColumns: { entries: [{ id: column1, position: 'a' }, { id: column2, position: 'b' }] },
        gridRows: { entries: [{ id: row1, position: 'a' }] },
        gridColumnsSizing: { entries: [
          { id: column1, trackSize: { minSizing: { type: 'FLEX', value: 1 }, maxSizing: { type: 'FLEX', value: 1 } } },
          { id: column2, trackSize: { minSizing: { type: 'FLEX', value: 1 }, maxSizing: { type: 'FLEX', value: 1 } } }
        ] },
        gridRowsSizing: { entries: [{ id: row1, trackSize: { minSizing: { type: 'HUG' }, maxSizing: { type: 'HUG' } } }] }
      }),
      node('RECTANGLE', 5, frameGuid, 'c', { name: 'Third', size: { x: 70, y: 25 } }),
      node('RECTANGLE', 3, frameGuid, 'a', { name: 'First', size: { x: 50, y: 20 } }),
      node('RECTANGLE', 4, frameGuid, 'b', { name: 'Second', size: { x: 60, y: 30 } })
    ],
    images: new Map(), message: { blobs: [] }
  };
  const imported = convertFigDocument(parsed, { fileName: 'flow-grid.fig' });
  const frame = imported.document.pages[0].children[0];
  assert.deepEqual([frame.autoLayout.rows, frame.autoLayout.autoPositioning], ['auto', true]);
  assert.deepEqual(frame.children.map(child => child.name), ['First', 'Second', 'Third']);
  assert.equal(imported.report.flattenedTypes.AUTO_LAYOUT_GRID, undefined);

  applyAutoLayout(frame);
  assert.deepEqual(frame.children.map(child => [child.gridCell.row, child.gridCell.column]), [[1, 1], [1, 2], [2, 1]]);
  assert.deepEqual(frame.children.map(child => [child.x, child.y]), [[0, 0], [120, 0], [0, 35]]);
});

test('bounds cyclic and deeply nested decoded parent graphs and reports detached visible nodes', () => {
  const page = { sessionID: 2, localID: 1 };
  const root = node('GROUP', 2, page, '!', { name: 'Root group' });
  const cycle = node('GROUP', 2, { sessionID: 2, localID: 2 }, '!', { name: 'Cycle edge' });
  const detached = node('ELLIPSE', 99, { sessionID: 2, localID: 100 }, '!', { name: 'Detached visible node' });
  const cyclic = convertFigDocument({ nodes: [node('CANVAS', 1, null, '', { guid: page }), root, cycle, detached], images: new Map(), message: { blobs: [] } });
  assert.ok(cyclic.report.unsupportedTypes.GROUP >= 1);
  assert.ok(cyclic.report.unsupportedTypes.ELLIPSE >= 1);

  const nodes = [node('CANVAS', 1, null, '', { guid: page })];
  let parent = page;
  for (let localID = 2; localID < 302; localID += 1) {
    nodes.push(node('GROUP', localID, parent, '!', { name: `Depth ${localID}` }));
    parent = { sessionID: 1, localID };
  }
  const bounded = convertFigDocument({ nodes, images: new Map(), message: { blobs: [] } });
  assert.equal(bounded.document.pages[0].children[0].type, 'group');
  assert.ok(bounded.report.unsupportedTypes.GROUP > 0);
  assert.ok(bounded.report.warnings.some(warning => warning.detail.includes('nesting limit')));
});
