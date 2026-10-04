import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAppearance, snapshotAppearance } from '../src/appearance-clipboard.js';
import { createImageFill } from '../src/image-fills.js';

const ids = () => {
  const counts = new Map();
  return prefix => {
    const index = (counts.get(prefix) || 0) + 1;
    counts.set(prefix, index);
    return `paste-${prefix}-${index}`;
  };
};

const sourceAppearance = overrides => ({
  version: 1,
  sourceType: 'rectangle',
  opacity: 0.6,
  blendMode: 'multiply',
  fills: [],
  strokes: [],
  effects: [],
  ...overrides
});

test('snapshot captures ordered reusable appearance without layer identity, geometry, or mutable aliases', () => {
  const gradient = {
    id: 'fill-gradient', type: 'linear', visible: true, opacity: 0.8,
    gradient: {
      type: 'linear', angle: 90,
      stops: [
        { id: 'stop-a', color: '#112233', position: 0 },
        { id: 'stop-b', color: '#445566', position: 1 }
      ]
    }
  };
  const source = {
    id: 'source-id', type: 'rectangle', name: 'Source card', x: 20, y: 30, width: 120, height: 80,
    rotation: 12, opacity: 0.7, visible: false, blendMode: 'screen',
    fills: [{ id: 'fill-solid', type: 'solid', color: '#abcdef', visible: true, opacity: 0.5 }, gradient],
    strokes: [{ id: 'stroke-a', color: '#123456', width: 4, opacity: 0.75, visible: true,
      cap: 'round', join: 'bevel', pattern: 'solid', miterLimit: 6 }],
    effects: [{ id: 'effect-a', type: 'drop-shadow', visible: true, color: '#000000', opacity: 0.2, offsetX: 2, offsetY: 3, blur: 4 }],
    radius: 7, cornerRadii: { topLeft: 2, topRight: 3, bottomRight: 4, bottomLeft: 5 },
    text: 'source text', children: [{ id: 'child' }], isComponent: true, componentId: 'component-a'
  };

  const snapshot = snapshotAppearance(source);
  assert.equal(snapshot.sourceType, 'rectangle');
  assert.equal(snapshot.opacity, 0.7);
  assert.equal(snapshot.blendMode, 'screen');
  assert.deepEqual(snapshot.fills, source.fills);
  assert.deepEqual(snapshot.strokes, source.strokes);
  assert.deepEqual(snapshot.effects, source.effects);
  assert.deepEqual(snapshot.cornerRadii, source.cornerRadii);
  assert.deepEqual(snapshot.families, ['opacity', 'blendMode', 'fills', 'strokes', 'effects', 'radii']);
  for (const forbidden of ['id', 'name', 'x', 'y', 'width', 'height', 'rotation', 'visible', 'children', 'text', 'isComponent', 'componentId']) {
    assert.equal(Object.hasOwn(snapshot, forbidden), false, `${forbidden} is not an appearance property`);
  }

  snapshot.fills[0].color = '#000000';
  snapshot.effects[0].blur = 80;
  assert.equal(source.fills[0].color, '#abcdef');
  assert.equal(source.effects[0].blur, 4);
});

test('appearance copy preserves independent polygon and star vertex radii', () => {
  const radii = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const source = {
    type: 'star', points: 5, vertexRadii: radii,
    opacity: 1, blendMode: 'normal', fills: [], strokes: [], effects: []
  };
  const snapshot = snapshotAppearance(source);
  assert.deepEqual(snapshot.vertexRadii, radii);
  assert.ok(snapshot.families.includes('radii'));

  const target = {
    type: 'star', points: 5, radius: 24, vertexRadii: Array(10).fill(24),
    opacity: 1, blendMode: 'normal', fills: [], strokes: [], effects: []
  };
  const result = applyAppearance(target, snapshot, { idFactory: ids() });
  assert.deepEqual(result.node.vertexRadii, radii);
  assert.equal(Object.hasOwn(result.node, 'cornerRadii'), false);
  assert.ok(result.changedFamilies.includes('radii'));

  const linked = applyAppearance(target, snapshotAppearance({
    type: 'star', points: 5, radius: 6, opacity: 1, blendMode: 'normal', fills: [], strokes: [], effects: []
  }), { idFactory: ids() });
  assert.equal(linked.node.radius, 6);
  assert.equal(Object.hasOwn(linked.node, 'vertexRadii'), false,
    'pasting a uniform radius returns a target to linked-radius mode');
});

test('appearance copy transfers independent radii by vertex order between vector networks', () => {
  const source = {
    id: 'source-network', type: 'network', opacity: 1, blendMode: 'normal',
    vertices: [{ id: 'a', x: 0, y: 0, cornerRadius: 8 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: .5, y: 1, cornerRadius: 3 }],
    edges: [], faces: [], strokes: [], effects: []
  };
  const target = {
    id: 'target-network', type: 'network', opacity: 1, blendMode: 'normal',
    vertices: [{ id: 'x', x: 0, y: 0 }, { id: 'y', x: 1, y: 0, cornerRadius: 9 }, { id: 'z', x: .5, y: 1 }],
    edges: [], faces: [], strokes: [], effects: []
  };
  const snapshot = snapshotAppearance(source);
  assert.deepEqual(snapshot.networkVertexRadii, [8, 0, 3]);
  const result = applyAppearance(target, snapshot);
  assert.deepEqual(result.node.vertices.map(vertex => Number(vertex.cornerRadius) || 0), [8, 0, 3]);
  assert.ok(result.appliedFamilies.includes('radii'));
  assert.equal(target.vertices[1].cornerRadius, 9, 'applying appearance does not mutate the source target');

  const incompatible = applyAppearance({ ...target, vertices: target.vertices.slice(0, 2) }, snapshot);
  assert.ok(incompatible.skipped.some(item => item.startsWith('radii:')),
    'network radius arrays are skipped when the target has a different vertex count');
});

test('appearance apply preserves target state and order while regenerating all destination-owned IDs', () => {
  const source = {
    type: 'rectangle', opacity: 0.45, blendMode: 'overlay',
    fills: [
      { id: 'src-fill-image', type: 'image', visible: true, opacity: 0.7,
        imageFill: createImageFill('asset-shared', { fit: 'contain', adjustments: { brightness: 14 } }) },
      { id: 'src-fill-gradient', type: 'linear', visible: false, opacity: 0.9,
        gradient: { type: 'linear', angle: 15, stops: [
          { id: 'src-stop-a', color: '#112233', position: 0 },
          { id: 'src-stop-b', color: '#abcdef', position: 1 }
        ] } }
    ],
    strokes: [{ id: 'src-stroke', color: '#123456', width: 6, opacity: 0.8, visible: true,
      cap: 'round', join: 'round', pattern: 'dashed', miterLimit: 5,
      sideMode: 'custom', sideWidths: { top: 1.5, right: 0, bottom: 3.25, left: 2 },
      gradient: { type: 'linear', angle: 0, stops: [
        { id: 'src-stroke-stop-a', color: '#000000', position: 0 },
        { id: 'src-stroke-stop-b', color: '#ffffff', position: 1 }
      ] } }],
    effects: [{ id: 'src-effect', type: 'inner-shadow', visible: true, blendMode: 'multiply', color: '#000000', opacity: 0.3, offsetX: 2, offsetY: 3, blur: 5 }],
    radius: 8
  };
  const target = {
    id: 'target-id', type: 'rectangle', name: 'Keep this name', x: 91, y: 73, width: 24, height: 50,
    rotation: -5, opacity: 1, visible: false, blendMode: 'normal',
    fill: '#fefefe', stroke: null, strokeWidth: 0, radius: 0,
    children: [{ id: 'keep-child', type: 'text', text: 'child content' }],
    isInstance: true, componentId: 'linked-component', componentSourceId: 'source-node',
    fills: [{ id: 'target-fill-id', type: 'solid', color: '#ffffff', visible: true, opacity: 1 }],
    strokes: [{ id: 'target-stroke-id', color: '#000000', width: 1, opacity: 1, visible: true,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 }],
    effects: []
  };
  const clipboard = snapshotAppearance(source);
  const result = applyAppearance(target, clipboard, { idFactory: ids() });

  assert.deepEqual(result.applied, ['opacity', 'blendMode', 'fills', 'strokes', 'effects', 'radius']);
  assert.deepEqual({
    id: result.node.id, name: result.node.name, x: result.node.x, y: result.node.y,
    width: result.node.width, height: result.node.height, rotation: result.node.rotation,
    visible: result.node.visible, children: result.node.children,
    isInstance: result.node.isInstance, componentId: result.node.componentId,
    componentSourceId: result.node.componentSourceId
  }, {
    id: target.id, name: target.name, x: target.x, y: target.y, width: target.width, height: target.height,
    rotation: target.rotation, visible: target.visible, children: target.children,
    isInstance: target.isInstance, componentId: target.componentId, componentSourceId: target.componentSourceId
  });
  assert.equal(result.node.opacity, 0.45);
  assert.equal(result.node.blendMode, 'overlay');
  assert.deepEqual(result.node.fills.map(fill => fill.type), ['image', 'linear']);
  assert.equal(result.node.fills[0].imageFill.assetId, 'asset-shared', 'image asset references are shared rather than remapped');
  assert.equal(result.node.fills[0].imageFill.fit, 'contain');
  assert.deepEqual(result.node.fills[0].imageFill.adjustments, source.fills[0].imageFill.adjustments);
  assert.deepEqual(result.node.strokes.map(stroke => stroke.width), [6]);
  assert.deepEqual(result.node.strokes[0].sideWidths, { top: 1.5, right: 0, bottom: 3.25, left: 2 },
    'appearance copy carries independent rectangle edge widths');
  assert.deepEqual(result.node.effects.map(effect => effect.type), ['inner-shadow']);
  assert.equal(result.node.effects[0].blendMode, 'multiply', 'copy/paste appearance preserves the individual effect blend mode');
  assert.equal(result.node.radius, 8);

  const sourceInnerIds = new Set([
    ...source.fills.map(fill => fill.id),
    ...source.fills.flatMap(fill => fill.gradient?.stops.map(stop => stop.id) || []),
    ...source.strokes.map(stroke => stroke.id),
    ...source.strokes.flatMap(stroke => stroke.gradient?.stops.map(stop => stop.id) || []),
    ...source.effects.map(effect => effect.id)
  ]);
  const targetInnerIds = [
    ...result.node.fills.map(fill => fill.id),
    ...result.node.fills.flatMap(fill => fill.gradient?.stops.map(stop => stop.id) || []),
    ...result.node.strokes.map(stroke => stroke.id),
    ...result.node.strokes.flatMap(stroke => stroke.gradient?.stops.map(stop => stop.id) || []),
    ...result.node.effects.map(effect => effect.id)
  ];
  assert.equal(new Set(targetInnerIds).size, targetInnerIds.length, 'all destination IDs are unique');
  assert.equal(targetInnerIds.some(id => sourceInnerIds.has(id)), false, 'destination appearance owns independent inner IDs');
  assert.equal(result.node.fills[0].id, 'paste-fill-1', 'the injected factory makes IDs deterministic');
  assert.equal(result.node.fills[1].gradient.stops[1].id, 'paste-stop-2');
  assert.equal(target.fills[0].id, 'target-fill-id', 'the original target object is not mutated');
  assert.equal(result.hasChanges, true);
  assert.equal(result.noOp, false);
  assert.deepEqual(result.appliedFamilies, ['opacity', 'blendMode', 'fills', 'strokes', 'effects', 'radii']);
});

test('legacy scalar fills and strokes are captured, applied, and mirrored to the compatibility fields', () => {
  const source = {
    type: 'rectangle', opacity: 0.8, blendMode: 'normal',
    fill: '#123456', fillOpacity: 0.35,
    stroke: '#abcdef', strokeWidth: 5, strokeOpacity: 0.6,
    strokeCap: 'round', strokeJoin: 'bevel', strokePattern: 'solid', strokeMiterLimit: 4
  };
  const snapshot = snapshotAppearance(source);
  assert.equal(snapshot.fills[0].type, 'solid');
  assert.equal(snapshot.fills[0].color, '#123456');
  assert.equal(snapshot.fills[0].opacity, 0.35);
  assert.equal(snapshot.strokes.length, 1);
  assert.equal(snapshot.strokes[0].color, '#abcdef');
  assert.equal(snapshot.strokes[0].width, 5);
  assert.equal(snapshot.strokes[0].opacity, 0.6);

  const pasted = applyAppearance({
    type: 'rectangle', id: 'legacy-target', opacity: 1, blendMode: 'normal', fill: '#ffffff', stroke: null, strokeWidth: 0
  }, snapshot, { idFactory: ids() }).node;
  assert.equal(pasted.fills[0].color, '#123456');
  assert.equal(pasted.fill, '#123456');
  assert.equal(pasted.fillOpacity, 0.35);
  assert.equal(pasted.stroke, '#abcdef');
  assert.equal(pasted.strokeWidth, 5);
  assert.equal(pasted.strokeOpacity, 0.6);
  assert.equal(pasted.strokeCap, 'round');
  assert.equal(pasted.strokeJoin, 'bevel');
});

test('text appearance copies typography but preserves target rich text, paragraphs, and content', () => {
  const source = {
    type: 'text', opacity: 0.9, blendMode: 'normal',
    text: 'Source heading', fontFamily: 'Inter', fontSize: 32, fontWeight: 700,
    fontStyle: 'italic', lineHeight: 1.4, letterSpacing: 1.2,
    paragraphSpacing: 12, firstLineIndent: 4, listSpacing: 6,
    color: '#224466', align: 'center', verticalAlign: 'bottom', textCase: 'uppercase', textDecoration: 'underline', textWrapStyle: 'pretty',
    textRuns: [{ text: 'Source ', fontWeight: 700 }, { text: 'heading', fontStyle: 'italic' }],
    paragraphStyles: [{ listStyle: 'numbered', listLevel: 0, listStart: 3 }]
  };
  const target = {
    type: 'text', id: 'target-text', name: 'Target text', opacity: 1, blendMode: 'normal',
    text: 'Keep this rich text\nexactly', fontFamily: 'Arial', fontSize: 14, fontWeight: 400,
    color: '#000000', textRuns: [{ text: 'Keep this ', color: '#b02030' }, { text: 'rich text\nexactly', fontWeight: 500 }],
    paragraphStyles: [{ listStyle: 'bulleted', listLevel: 1 }, { align: 'right' }],
    width: 180, height: 50, visible: false, children: []
  };
  const beforeText = target.text;
  const beforeRuns = structuredClone(target.textRuns);
  const beforeParagraphs = structuredClone(target.paragraphStyles);
  const snapshot = snapshotAppearance(source);
  assert.equal(snapshot.text, undefined);
  assert.equal(snapshot.textRuns, undefined);
  assert.equal(snapshot.paragraphStyles, undefined);
  assert.ok(snapshot.families.includes('textStyle'));
  const pasted = applyAppearance(target, snapshot, { idFactory: ids() }).node;

  assert.equal(pasted.text, beforeText);
  assert.deepEqual(pasted.textRuns, beforeRuns, 'rich text content and per-range styling stay attached to the target text');
  assert.deepEqual(pasted.paragraphStyles, beforeParagraphs);
  assert.equal(pasted.fontFamily, 'Inter');
  assert.equal(pasted.fontSize, 32);
  assert.equal(pasted.fontWeight, 700);
  assert.equal(pasted.fontStyle, 'italic');
  assert.equal(pasted.lineHeight, 1.4);
  assert.equal(pasted.letterSpacing, 1.2);
  assert.equal(pasted.textWrapStyle, 'pretty');
  assert.equal(pasted.color, '#224466');
  assert.equal(pasted.align, 'center');
  assert.equal(pasted.name, 'Target text');
  assert.equal(pasted.width, 180);
  assert.equal(pasted.visible, false);
});

test('text targets accept complete fill stacks while still skipping incompatible radius and text groups', () => {
  const shapeAppearance = snapshotAppearance({
    type: 'rectangle', opacity: 0.5, blendMode: 'screen',
    fills: [{ id: 'source-image-fill', type: 'image', visible: true, opacity: 1, imageFill: createImageFill('asset-photo') }],
    strokes: [], effects: [], radius: 9
  });
  const textTarget = {
    type: 'text', id: 'text-target', name: 'My text', x: 7, y: 8, width: 99, height: 26,
    opacity: 1, visible: true, blendMode: 'normal', fill: '#eeeeee', text: 'Do not replace',
    fontFamily: 'Arial', fontSize: 15, textRuns: [{ text: 'Do not replace', color: '#008800' }]
  };
  const textResult = applyAppearance(textTarget, shapeAppearance, { idFactory: ids() });
  assert.ok(textResult.applied.includes('fills'));
  assert.deepEqual(textResult.node.fills.map(fill => fill.type), ['image']);
  assert.equal(textResult.node.fills[0].imageFill.assetId, 'asset-photo');
  assert.ok(textResult.skipped.some(item => item.startsWith('radii:')));
  assert.ok(textResult.skipped.some(item => item.startsWith('textStyle:')));
  assert.equal(Object.hasOwn(textResult.node, 'fills'), true);
  assert.equal(textResult.node.fill, '#eeeeee');
  assert.equal(textResult.node.text, 'Do not replace');
  assert.equal(textResult.node.fontSize, 15);
  assert.deepEqual(textResult.node.textRuns, textTarget.textRuns);
  assert.equal(textResult.node.opacity, 0.5, 'properties common to both types still apply');

  const textAppearance = snapshotAppearance({
    type: 'text', opacity: 0.8, blendMode: 'normal', fontSize: 28, color: '#112233',
    text: 'Source words', strokes: [], effects: []
  });
  const shapeTarget = {
    type: 'path', id: 'open-path', opacity: 1, blendMode: 'normal',
    points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], closed: false,
    fill: '#445566', stroke: '#778899', strokeWidth: 2
  };
  const shapeResult = applyAppearance(shapeTarget, textAppearance, { idFactory: ids() });
  assert.ok(shapeResult.skipped.some(item => item.startsWith('fills:')));
  assert.ok(shapeResult.skipped.some(item => item.startsWith('textStyle:')));
  assert.equal(shapeResult.node.fill, '#445566');
  assert.equal(shapeResult.node.stroke, null, 'the copied empty stroke family clears the target stroke');
  assert.equal(shapeResult.node.strokeWidth, 0);
  assert.equal(shapeResult.node.fontSize, undefined);
  assert.equal(shapeResult.node.opacity, 0.8);
});

test('boolean targets keep their stroke state when a non-empty source stroke stack is incompatible', () => {
  const appearance = sourceAppearance({
    strokes: [{ id: 'source-stroke', color: '#112233', width: 2, opacity: 1, visible: true,
      cap: 'butt', join: 'miter', pattern: 'solid', miterLimit: 10 }]
  });
  const target = { type: 'boolean', id: 'boolean-target', opacity: 1, blendMode: 'normal', stroke: null, strokeWidth: 0, children: [] };
  const result = applyAppearance(target, appearance, { idFactory: ids() });
  assert.ok(result.skipped.some(item => item.startsWith('strokes:')));
  assert.equal(Object.hasOwn(result.node, 'strokes'), false);
  assert.equal(result.node.stroke, null);
  assert.equal(result.node.strokeWidth, 0);
});

test('style and variable references are never copied across layers; replaced target bindings are detached selectively', () => {
  const source = {
    type: 'rectangle', opacity: 0.75, blendMode: 'normal',
    fill: '#123456', fillStyleId: 'source-fill-style', fillVariableId: 'source-fill-variable',
    variableBindings: { fill: 'source-fill-mode', x: 'source-x-mode' },
    strokes: [], effects: []
  };
  const target = {
    type: 'rectangle', id: 'target', opacity: 1, blendMode: 'normal', fill: '#ffffff',
    fillStyleId: 'target-fill-style', fillVariableId: 'target-fill-variable',
    variableBindings: { fill: 'target-fill-mode', opacity: 'target-opacity-mode', x: 'keep-x-mode' }
  };
  const snapshot = snapshotAppearance(source);
  for (const reference of ['fillStyleId', 'fillVariableId', 'variableBindings']) {
    assert.equal(Object.hasOwn(snapshot, reference), false, `${reference} is not copied as an external reference`);
  }
  const pasted = applyAppearance(target, snapshot, { idFactory: ids() }).node;
  assert.equal(pasted.fillStyleId, undefined);
  assert.equal(pasted.fillVariableId, undefined);
  assert.deepEqual(pasted.variableBindings, { x: 'keep-x-mode' }, 'bindings for untouched geometry remain intact');
  assert.deepEqual(target.variableBindings, { fill: 'target-fill-mode', opacity: 'target-opacity-mode', x: 'keep-x-mode' });

  const textSource = {
    type: 'text', opacity: 1, blendMode: 'normal', fontSize: 28,
    text: 'Source', textStyleId: 'source-text-style', textVariableId: 'source-text-variable'
  };
  const textTarget = {
    type: 'text', opacity: 1, blendMode: 'normal', fontSize: 12,
    text: 'Target', textStyleId: 'target-text-style', textVariableId: 'target-text-variable',
    variableBindings: { fontSize: 'target-font-size-mode', text: 'target-content-variable', x: 'keep-x-mode' }
  };
  const pastedText = applyAppearance(textTarget, snapshotAppearance(textSource), { idFactory: ids() }).node;
  assert.equal(pastedText.text, 'Target');
  assert.equal(pastedText.textStyleId, undefined);
  assert.equal(pastedText.textVariableId, undefined);
  assert.deepEqual(pastedText.variableBindings, { text: 'target-content-variable', x: 'keep-x-mode' },
    'content and unrelated bindings remain while overridden typography bindings are removed');
});

test('no-op detection includes binding changes even when the stored appearance value is equal', () => {
  const appearance = snapshotAppearance({ type: 'image', opacity: 0.5, blendMode: 'normal' });
  const target = {
    type: 'image', id: 'same-opacity', opacity: 0.5, blendMode: 'normal',
    variableBindings: { opacity: 'opacity-mode', x: 'keep-x-mode' }
  };
  const result = applyAppearance(target, appearance, { idFactory: ids() });
  assert.equal(result.node.opacity, target.opacity, 'the scalar itself stays equal');
  assert.equal(result.node.variableBindings.opacity, undefined, 'the overridden target binding is detached');
  assert.deepEqual(result.node.variableBindings, { x: 'keep-x-mode' });
  assert.equal(result.changedFamilies.includes('opacity'), true);
  assert.equal(result.hasChanges, true);
  assert.equal(result.noOp, false);
});

test('invalid snapshots and duplicate-producing ID factories fail explicitly without mutating targets', () => {
  const target = { type: 'rectangle', id: 'target', opacity: 1, blendMode: 'normal', fill: '#ffffff' };
  const before = structuredClone(target);
  assert.throws(() => applyAppearance(target, null), /appearance is invalid/i);
  assert.throws(() => applyAppearance(target, sourceAppearance({ opacity: 2 })), /opacity is invalid/i);
  assert.deepEqual(target, before);

  const textTarget = { type: 'text', id: 'text-target', opacity: 1, blendMode: 'normal', text: 'Keep' };
  const invalidWrap = snapshotAppearance({ type: 'text', opacity: 1, blendMode: 'normal', text: 'Copy', textWrapStyle: 'loose' });
  assert.equal(invalidWrap.textStyle?.textWrapStyle, undefined, 'unsupported source values are omitted from snapshots');
  const invalidClipboard = snapshotAppearance({ type: 'text', opacity: 1, blendMode: 'normal', text: 'Copy', textWrapStyle: 'balance' });
  invalidClipboard.textStyle.textWrapStyle = 'loose';
  assert.throws(() => applyAppearance(textTarget, invalidClipboard), /text wrap style is invalid/i);

  const appearance = sourceAppearance({ fills: [{ id: 'fill-source', type: 'solid', color: '#112233', visible: true, opacity: 1 }] });
  assert.throws(() => applyAppearance(target, appearance, { idFactory: () => 'fill-source' }), /did not produce a unique/i);
  assert.deepEqual(target, before);
});
