import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, bindColorVariable, cloneDocument, createColorStyle, createColorVariable, createDocument, createFillLayer, createGradientFill, createNode, createVariableCollection, findNode, validateDocument } from '../src/model.js';
import { History } from '../src/history.js';
import { createStroke } from '../src/strokes.js';
import { resolveGradientGeometry } from '../src/fills.js';
import { nodeToParentTransform } from '../src/transform-geometry.js';
import { applyOutlineStroke, outlineStrokeUnavailableReason, prepareOutlineStroke } from '../src/outline-stroke.js';
import { exportNodeToSvg } from '../src/svg-export.js';

function design(...nodes) {
  const document = createDocument(); document.pages[0].children = [];
  for (const node of nodes) addNode(document, node);
  return document;
}
const strokeOnly = overrides => createNode('rectangle', { width: 80, height: 40, fill: 'transparent', strokes: [createStroke({ width: 6, color: '#336699' })], ...overrides });

// Deterministic worker boundary stub. Native WASM stroke fidelity is exercised
// separately; these cases verify atomic editing, identity and paint transfer.
async function outlineFixture() {
  return { commands: new Float32Array([0,-3,-3,1,83,-3,1,83,43,1,-3,43,5]), fillRule: 'nonzero', bounds: { left:-3,top:-3,right:83,bottom:43 } };
}

test('Outline Stroke keeps a stroke-only root identity, becomes editable geometry, saves/exports and undoes as one edit', async () => {
  const node = strokeOnly({ x: 30, y: 40, rotation: 24, opacity: .6 });
  const document = design(node); const before = cloneDocument(document); const history = new History();
  const plan = await prepareOutlineStroke(document, [node.id], { outline: outlineFixture });
  assert.deepEqual(document, before, 'preparation changes no document state');
  history.checkpoint(document, 'Outline Stroke');
  assert.equal(applyOutlineStroke(document, plan)[0], node, 'root object and ID remain stable');
  assert.equal(node.type, 'path'); assert.equal(node.fillRule, 'nonzero'); assert.equal(node.closed, true);
  assert.equal(node.points[0].x, -3 / 80); assert.equal(node.points[0].y, -3 / 40);
  assert.deepEqual(node.strokes, []); assert.equal(node.strokeWidth, 0);
  assert.equal(node.fills[0].color, '#336699'); assert.equal(node.opacity, .6);
  assert.equal(node.rotation, 24); assert.equal(node.x, 30); assert.equal(node.y, 40);
  assert.ok(exportNodeToSvg(node, { document }).includes('<path'));
  validateDocument(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(history.undo(document), before);
  assert.equal(history.canUndo, false);
  assert.equal(history.redo(before).pages[0].children[0].type, 'path');
});

test('fill and ordered stroke paints keep their coordinate basis, hidden paints, style and color variable bindings', async () => {
  const gradient = createGradientFill('linear', '#112233'); gradient.angle = 33;
  const node = strokeOnly({ name: 'Painted shape', width: .25, height: .5,
    fills: [createFillLayer('solid', { color: '#445566' })],
    strokes: [createStroke({ width: 2, color: '#ff1100', opacity: .3 }), createStroke({ width: 4, gradient, visible: false, opacity: .7 })],
    affineTransform: { a: -1, b: .2, c: .4, d: 1.3 }, rotation: -28,
  });
  const document = design(node); const collection = createVariableCollection(document, 'Colors');
  const fillVariable = createColorVariable(document, collection.id, 'Fill', '#445566');
  const strokeVariable = createColorVariable(document, collection.id, 'Stroke', '#ff1100');
  bindColorVariable(document, node.id, fillVariable.id, 'fill');
  bindColorVariable(document, node.id, strokeVariable.id, 'stroke');
  const style = createColorStyle(document, node.id, 'Fill style');
  bindColorVariable(document, node.id, fillVariable.id, 'fill');
  node.fillStyleId = style.id;
  const original = cloneDocument(document).pages[0].children[0];
  const plan = await prepareOutlineStroke(document, [node.id], { outline: outlineFixture });
  applyOutlineStroke(document, plan);
  assert.equal(node.type, 'group'); assert.equal(node.width, .25); assert.equal(node.height, .5);
  assert.deepEqual(nodeToParentTransform(node), nodeToParentTransform(original));
  const [fill, first, second] = node.children;
  assert.equal(fill.type, 'rectangle'); assert.equal(fill.fillVariableId, fillVariable.id); assert.equal(fill.fillStyleId, style.id);
  assert.equal(fill.x, 0); assert.equal(fill.y, 0); assert.equal(fill.rotation, 0); assert.equal(fill.affineTransform, undefined);
  assert.equal(first.fillVariableId, strokeVariable.id); assert.equal(first.fills[0].opacity, .3);
  assert.equal(second.fills[0].visible, false); assert.equal(second.fills[0].opacity, .7);
  assert.deepEqual(second.fills[0].gradient, gradient);
  assert.deepEqual(resolveGradientGeometry(second.fills[0].gradient, second), resolveGradientGeometry(gradient, original));
  assert.equal(node.fillVariableId, undefined); assert.equal(node.strokeVariableId, undefined);
  for (const child of node.children) { assert.equal(child.opacity, 1); assert.equal(child.rotation, 0); assert.deepEqual(child.strokes, []); }
  validateDocument(document);
});

test('zero-height lines retain their physical transform under rotation, reflection and shear', async () => {
  for (const rotation of [0, 90, -37]) {
    const node = createNode('line', { x: 40, y: -20, rotation, affineTransform: { a: -1.2, b: .3, c: .6, d: 1.5 } });
    const document = design(node); const original = nodeToParentTransform(node);
    const plan = await prepareOutlineStroke(document, [node.id], { outline: outlineFixture });
    applyOutlineStroke(document, plan);
    assert.equal(node.height, 1); const after = nodeToParentTransform(node);
    for (const key of ['a','b','c','d','e','f']) assert.ok(Math.abs(after[key] - original[key]) < 1e-12, `${rotation}/${key}`);
    validateDocument(document);
  }
});

test('multi-selection failures, empty worker output and cancellation leave every original intact', async () => {
  for (const mode of ['failure', 'empty', 'cancel']) {
    const nodes = [strokeOnly(), strokeOnly({ x: 100 })]; const document = design(...nodes); const before = cloneDocument(document);
    const controller = new AbortController(); let count = 0;
    const outline = async () => {
      if (++count === 2) {
        if (mode === 'failure') throw new Error('Native geometry failed');
        if (mode === 'cancel') controller.abort();
        if (mode === 'empty') return { commands: new Float32Array(), fillRule:'nonzero', bounds:{left:0,top:0,right:0,bottom:0} };
      }
      return outlineFixture();
    };
    await assert.rejects(prepareOutlineStroke(document, nodes.map(node => node.id), { outline, signal: controller.signal }), /failed|no outline|cancelled/);
    assert.deepEqual(document, before, mode);
  }
});

test('changes to a target or its ancestor during async preparation reject the entire result', async () => {
  for (const change of ['target', 'ancestor']) {
    const node = strokeOnly(); const frame = createNode('frame', { children: [node] }); const document = design(frame);
    const target = frame.children[0];
    const outline = async () => { if (change === 'target') target.rotation = 15; else frame.variableModes = { changed: 'mode' }; return outlineFixture(); };
    await assert.rejects(prepareOutlineStroke(document, [target.id], { outline }), /changed while outlining/);
    assert.equal(target.type, 'rectangle'); assert.equal(target.strokes.length, 1);
  }
});

test('prepared plans reject target edits, replay and use in a copied design, while preserving independent new edits', async () => {
  const first = strokeOnly(); const second = strokeOnly({ x:100 }); const document = design(first, second);
  const plan = await prepareOutlineStroke(document, [first.id], { outline: outlineFixture });
  assert.throws(() => applyOutlineStroke(cloneDocument(document), plan), /in this design/);
  first.name = 'Changed';
  assert.throws(() => applyOutlineStroke(document, plan), /changed while outlining/);
  assert.equal(first.type, 'rectangle');
  const next = await prepareOutlineStroke(document, [first.id], { outline: outlineFixture });
  second.name = 'Independent edit'; applyOutlineStroke(document, next);
  assert.equal(second.name, 'Independent edit');
  assert.throws(() => applyOutlineStroke(document, next), /Prepare Outline Stroke/);
});

test('unsupported outline contexts explain the required action before invoking a worker', async () => {
  const mutations = [
    [node => { node.locked = true; }, /Unlock/],
    [node => { node.isComponent = true; }, /Detach/],
    [node => { node.effects = [{ id:'blur',type:'layer-blur',visible:true,radius:3 }]; }, /Remove effects/],
    [node => { node.variableBindings = { width:'bound' }; }, /Detach position/],
    [node => { node.strokes[0].blendMode = 'multiply'; }, /Normal/],
    [node => { node.strokes[0].startDecoration = 'arrow'; }, /endpoint decorations/],
    [node => { node.strokes[0].pattern = 'custom'; node.strokes[0].dashArray = [2,3,4,5]; }, /dash-and-gap/],
    [node => { node.strokes[0].pattern = 'custom'; node.strokes[0].dashArray = [4,0]; }, /positive dash gap/],
    [node => { node.strokes = []; node.stroke = null; node.strokeWidth = 0; }, /visible stroke/],
  ];
  for (const [mutate, message] of mutations) {
    const node = strokeOnly(); mutate(node); const document = design(node); let calls = 0;
    assert.match(outlineStrokeUnavailableReason(document, [node.id]), message);
    await assert.rejects(prepareOutlineStroke(document, [node.id], { outline: async () => { calls++; return outlineFixture(); } }), message);
    assert.equal(calls, 0);
  }
  const node = strokeOnly(); const parent = createNode('frame', { autoLayout: { axis:'horizontal' }, children:[node] }); const document = design(parent);
  assert.match(outlineStrokeUnavailableReason(document, [parent.children[0].id]), /absolute positioning/);
  assert.match(outlineStrokeUnavailableReason(document, []), /Select/);
  assert.match(outlineStrokeUnavailableReason(document, [node.id, node.id]), /duplicate|no longer/);
});

test('a cancelled signal and excessive selection never start native geometry', async () => {
  const document = design(strokeOnly()); const id = document.pages[0].children[0].id; let calls = 0;
  const outline = async () => { calls++; return outlineFixture(); };
  await assert.rejects(prepareOutlineStroke(document, [id], { outline, signal: AbortSignal.abort() }), { name:'AbortError' });
  await assert.rejects(prepareOutlineStroke(document, Array(65).fill(id), { outline }), /64/);
  assert.equal(calls, 0);
});

test('motion and linked text refuse destructive geometry changes, including links added during preparation', async () => {
  const node = strokeOnly(); const document = design(node);
  document.motion.tracks.push({ id:'track', nodeId:node.id, property:'width', keyframes:[] });
  assert.match(outlineStrokeUnavailableReason(document, [node.id]), /Remove motion tracks/);
  document.motion.tracks = [];
  const text = createNode('text', { text:'Linked', textPath:{ sourceId:node.id } }); addNode(document, text);
  assert.match(outlineStrokeUnavailableReason(document, [node.id]), /Detach linked text/);
  delete text.textPath;
  await assert.rejects(prepareOutlineStroke(document, [node.id], { outline: async () => {
    document.motion.tracks.push({ id:'new-track',nodeId:node.id,property:'fillColor',keyframes:[] });
    return outlineFixture();
  } }), /Remove motion tracks/);
  assert.equal(node.type, 'rectangle');
});

test('translucent independent centered runs refuse outlining while aligned coverage keeps its paint', async () => {
  const node = strokeOnly({ opacity:.5, strokes:[createStroke({ width:6, sideMode:'custom', sideWidths:{top:2,right:4,bottom:6,left:8} })] });
  const document = design(node);
  assert.match(outlineStrokeUnavailableReason(document, [node.id]), /Overlapping translucent runs/);
  node.strokes[0].alignment = 'outside';
  assert.equal(outlineStrokeUnavailableReason(document, [node.id]), '');
  const plan = await prepareOutlineStroke(document, [node.id], { outline: outlineFixture });
  applyOutlineStroke(document, plan); assert.equal(node.opacity, .5);
});

test('aggregate selection input and output budgets prevent oversized undoable edits atomically', async () => {
  const many = Array.from({length:8}, () => createNode('path', { closed:true, fill:'transparent', points:Array.from({length:6000}, (_, i) => ({ x:(i%100)/100,y:Math.floor(i/100)/100 })) }));
  const document = design(...many); let calls = 0;
  await assert.rejects(prepareOutlineStroke(document, many.map(node => node.id), { outline: async () => { calls++; return outlineFixture(); } }), /100,000-command/);
  assert.equal(calls, 0);
  const node = strokeOnly({ strokes:Array.from({length:6}, () => createStroke()) }); const outputDesign = design(node); const before = cloneDocument(outputDesign);
  const commands = new Float32Array(3 + 18_000 * 3 + 1); commands.set([0,0,0]);
  for (let i=0;i<18_000;i++) commands.set([1,(i%80),Math.floor(i/80)],3+i*3);
  commands[commands.length-1] = 5;
  await assert.rejects(prepareOutlineStroke(outputDesign, [node.id], { outline: async () => ({ commands,fillRule:'nonzero',bounds:{left:0,top:0,right:79,bottom:224} }) }), /100,000-point/);
  assert.deepEqual(outputDesign, before);
});
