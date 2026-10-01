import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { zipSync } from 'fflate';
import { convertFigDocument, importFigBytes } from '../src/fig-import.js';
import { parseDocument, serializeDocument } from '../src/model.js';
import { nodeLocalToPageTransform } from '../src/transform-geometry.js';
import { FIG_IMPORT_LIMITS, preflightFigArchive } from '../src/fig-import-preflight.js';
import { applyAutoLayout } from '../src/layout-engine.js';

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
      node('COMPONENT_SET', 2, page, 'a', { guid: set, name: 'Button' }),
      node('COMPONENT', 3, set, 'a', { guid: small, name: 'Button/size=small' }),
      node('RECTANGLE', 4, small, 'a', { name: 'Background', fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }] }),
      node('COMPONENT', 5, set, 'b', { guid: large, name: 'Button/size=large' }),
      node('RECTANGLE', 6, large, 'a', { name: 'Background', fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }] }),
      node('INSTANCE', 7, page, 'b', { guid: instance, name: 'Primary button', componentId: small }),
      node('RECTANGLE', 8, instance, 'a', { name: 'Background', fillPaints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 } }] })
    ],
    images: new Map(), message: { blobs: [] }
  };
  const { document, report } = convertFigDocument(parsed, { fileName: 'components.fig' });
  const componentsByName = new Map(document.components.map(component => [component.name, component]));
  const variantSet = document.componentSets[0];
  const importedInstance = document.pages[0].children.find(child => child.name === 'Primary button');
  const master = document.pages[0].children[0].children[0];
  const masterChild = master.children[0];
  const instanceChild = importedInstance.children[0];

  assert.equal(componentsByName.size, 2);
  assert.equal(variantSet.name, 'Button');
  assert.deepEqual(variantSet.properties, [{ name: 'size', values: ['small', 'large'] }]);
  assert.equal(importedInstance.isInstance, true);
  assert.equal(importedInstance.componentId, componentsByName.get('Button/size=small').id);
  assert.equal(importedInstance.componentSourceId, master.id);
  assert.equal(instanceChild.componentSourceId, masterChild.id);
  assert.deepEqual(importedInstance.componentOverrides[masterChild.id].fills, instanceChild.fills,
    'the imported effective fill remains a local editable instance override');
  assert.equal(report.flattenedTypes.INSTANCE, undefined);
  assert.equal(report.flattenedTypes.COMPONENT_SET, undefined);

  const restored = parseDocument(serializeDocument(document));
  assert.equal(restored.pages[0].children.find(child => child.name === 'Primary button').isInstance, true);
  assert.equal(restored.componentSets[0].properties[0].name, 'size');
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
      node('MYSTERY_CONTAINER', 5, frameGuid, 'c', { name: 'Kept container' }),
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
  assert.equal(frame.children[0].opacity, 0.5);
  assert.equal(Object.hasOwn(frame.children[0], 'fills'), false, 'text colors map to text properties, not an invalid shape fill stack');
  assert.equal(frame.children[1].fills[0].type, 'image');
  assert.deepEqual(imported.assets[0].bytes, png);
  assert.deepEqual(imported.document.imageLibrary.map(({ width, height }) => ({ width, height })), [{ width: 2, height: 3 }]);
  assert.equal(frame.children[2].type, 'group');
  assert.equal(frame.children[2].children[0].type, 'ellipse');
  assert.equal(frame.children[3].type, 'group');
  assert.equal(imported.report.flattenedTypes.MYSTERY_CONTAINER, 1);
  assert.equal(imported.report.flattenedTypes.BOOLEAN_OPERATION, 1);
  assert.equal(imported.report.unsupportedTypes.MYSTERY_LEAF, 1);
  assert.equal(imported.report.unsupportedTypes.__proto__, 1);
  assert.match(imported.report.warnings.find(warning => warning.type === 'MYSTERY_LEAF').detail, /omitted/);
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
