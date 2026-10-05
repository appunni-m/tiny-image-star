import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, bindColorVariable, cloneDocument, createColorStyle, createColorVariable, createDocument, createFillLayer, createGradientFill, createLayerEffect, createNode, createVariableCollection, findNode, getNodeColor, updateColorStyle, validateDocument } from '../src/model.js';
import { History } from '../src/history.js';
import { createStroke } from '../src/strokes.js';
import { resolveGradientGeometry } from '../src/fills.js';
import { nodeToParentTransform } from '../src/transform-geometry.js';
import { applyOutlineStroke, outlineStrokeUnavailableReason, prepareOutlineStroke } from '../src/outline-stroke.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { applyAutoLayout, createAutoLayout } from '../src/layout-engine.js';

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

function nativeRect(left, top, right, bottom) {
  const start = { x:left, y:top };
  const line = (x, y, from) => ({ type:'line', start:from, end:{ x, y } });
  return { fillGroups:[{ fillRule:'nonzero', contours:[{ closed:true, start,
    commands:[line(right,top,start),line(right,bottom,{x:right,y:top}),line(left,bottom,{x:right,y:bottom}),line(left,top,{x:left,y:bottom})] }] }] };
}
function textOutlineFixture(node, glyphs, extra = {}) {
  return { width:node.width, height:node.height, geometry:nativeRect(0,0,node.width,node.height),
    glyphGeometry:{fillGroups:glyphs.flatMap(shape=>shape.fillGroups||[]),strokeContours:glyphs.flatMap(shape=>shape.strokeContours||[]),alignedStrokeContours:glyphs.flatMap(shape=>shape.alignedStrokeContours||[])},
    glyphs:glyphs.map((geometry,index) => ({ geometry, paint:{ color:'#112233',opacity:1 }, glyphId:65+index,cluster:index,text:'A' })),
    decorations:[], ...extra };
}

test('text outlines retain separate editable glyph masks while each translucent fill plane is applied once', async () => {
  const node = createNode('text', { name:'Overlap', text:'HH', width:20, height:20, fillOpacity:.7,
    opacity:.6, fills:[createFillLayer('solid',{color:'#ff0000',opacity:.3}),createFillLayer('solid',{color:'#0000ff',opacity:.5})] });
  const document = design(node); const overlapping = nativeRect(2,2,14,18);
  const outline = textOutlineFixture(node,[overlapping,overlapping]);
  const plan = await prepareOutlineStroke(document,[node.id],{getTextOutline:async()=>outline});
  applyOutlineStroke(document,plan);
  assert.equal(node.type,'group'); assert.equal(node.opacity,.6); assert.deepEqual(node.fills,[]);
  assert.equal(node.children.length,2);
  for (const plane of node.children) {
    assert.equal(plane.mask,true); assert.equal(plane.maskMode,'alpha');
    assert.equal(plane.children[0].children.length,2,'both overlapping glyphs remain editable mask paths');
    assert.equal(plane.children[1].fills[0].opacity < 1,true);
  }
  const ids=[]; walkNodesForTest(node,child=>ids.push(child.id));
  assert.equal(new Set(ids).size,ids.length,'duplicated per-fill glyph paths get distinct layer IDs');
  validateDocument(document);
});

test('text aligned stroke geometry preserves its outside ink and an explicit empty fill stack stays empty', async () => {
  const node = createNode('text',{name:'Short box',text:'H',width:12,height:15,fills:[],fill:'transparent',
    strokes:[createStroke({width:8,color:'#0088cc',alignment:'inside'})]});
  const document=design(node); const glyph=nativeRect(1,1,11,14);
  const plan=await prepareOutlineStroke(document,[node.id],{
    getTextOutline:async()=>textOutlineFixture(node,[glyph]),
    outline:async()=>({commands:new Float32Array([0,-4.8,-6,1,16.8,-6,1,16.8,21,1,-4.8,21,5]),fillRule:'nonzero',bounds:{left:-4.8,top:-6,right:16.8,bottom:21}})
  });
  applyOutlineStroke(document,plan);
  assert.equal(node.children.length,2,'fills: [] retains glyph geometry and the authored stroke, but paints no glyph fill');
  const glyphPath=node.children[0]; const path=node.children[1]; assert.equal(path.type,'path');
  assert.deepEqual(glyphPath.fills,[]); assert.equal(glyphPath.effectPaintPhase,undefined);
  assert.ok(Math.min(...path.points.map(point=>point.x))<0);
  assert.ok(Math.max(...path.points.map(point=>point.x))>1,'the editable stroke contour extends beyond the text frame');
  validateDocument(document);
});

test('aligned text strokes outline the aggregate glyph silhouette once; centered strokes remain per-glyph paints', async () => {
  const glyphA=nativeRect(1,1,12,19), glyphB=nativeRect(10,1,19,19);
  const node=createNode('text',{text:'HH',width:20,height:20,fillOpacity:0,
    strokes:[createStroke({width:4,opacity:.35,alignment:'inside'})]});
  const document=design(node); const aggregate=nativeRect(1,1,19,19); const calls=[];
  const result=textOutlineFixture(node,[glyphA,glyphB],{glyphGeometry:aggregate,decorations:[{geometry:nativeRect(0,0,20,1),paint:{color:'#000000',opacity:1}}]});
  const plan=await prepareOutlineStroke(document,[node.id],{getTextOutline:async()=>result,outline:async(shape,stroke)=>{calls.push({shape,alignment:stroke.alignment});return outlineFixture();}});
  applyOutlineStroke(document,plan);
  assert.equal(calls.length,1,JSON.stringify(calls.map(call=>call.alignment))); assert.equal(calls[0].shape,aggregate); assert.equal(calls[0].alignment,'inside');
  assert.equal(node.children.at(-1).fills[0].opacity,.35);

  const centered=createNode('text',{text:'HH',width:20,height:20,fillOpacity:0,
    strokes:[createStroke({width:4,opacity:.35,alignment:'center'})]});
  const centeredDesign=design(centered); const centeredCalls=[];
  const centeredPlan=await prepareOutlineStroke(centeredDesign,[centered.id],{getTextOutline:async()=>textOutlineFixture(centered,[glyphA,glyphB]),
    outline:async(shape,stroke)=>{centeredCalls.push({shape,alignment:stroke.alignment});return outlineFixture();}});
  applyOutlineStroke(centeredDesign,centeredPlan);
  assert.equal(centeredCalls.length,2); assert.deepEqual(centeredCalls.map(call=>call.shape),[glyphA,glyphB]);
  assert.deepEqual(centered.children.slice(-2).map(path=>path.fills[0].opacity),[.35,.35]);
  validateDocument(document); validateDocument(centeredDesign);
});

test('staged text outlines preserve effects and layer blend on the root and mark authored strokes', async () => {
  const node=createNode('text',{text:'H',width:20,height:24,color:'#2468ac',blendMode:'multiply',
    effects:[createLayerEffect('inner-shadow',{offsetX:2}),createLayerEffect('layer-blur',{radius:2})],
    strokes:[createStroke({width:4,color:'#cc2244',alignment:'center'})]});
  const document=design(node); const sourceEffects=structuredClone(node.effects);
  const plan=await prepareOutlineStroke(document,[node.id],{getTextOutline:async()=>textOutlineFixture(node,[nativeRect(1,1,18,22)]),outline:outlineFixture});
  applyOutlineStroke(document,plan);
  assert.equal(node.effectPaintMode,'staged'); assert.equal(node.effectFillMode,'legacy');
  assert.equal(node.blendMode,'multiply'); assert.deepEqual(node.effects,sourceEffects);
  assert.ok(node.children.some(child=>child.effectPaintPhase==='stroke'));
  assert.ok(node.children.some(child=>child.effectPaintPhase===undefined),'unmarked direct children are fill phase');
  validateDocument(JSON.parse(JSON.stringify(document)));
});

test('flow text keeps its logical layout frame and current linked-path placement when converted', async () => {
  const flowText=createNode('text',{name:'Flow',text:'Flow',width:38,height:22,textFit:'auto-width',layoutSizingMain:'fixed',layoutSizingCross:'fixed'});
  const sibling=createNode('rectangle',{width:12,height:16});
  const frame=createNode('frame',{width:10,height:10,autoLayout:createAutoLayout({axis:'horizontal',mainSizing:'hug',crossSizing:'hug',padding:0}),children:[flowText,sibling]});
  const flow=frame.children[0];
  const linkedPath=createNode('path',{name:'Text baseline',x:70,y:30,width:50,height:24,rotation:17,affineTransform:{a:-1,b:.2,c:.4,d:1.1},closed:true,points:[{x:0,y:.5},{x:1,y:.5}]});
  const linked=createNode('text',{name:'Linked text',text:'Path',width:50,height:24,textPath:{sourceId:linkedPath.id}});
  const document=design(frame,linkedPath,linked); applyAutoLayout(frame);
  const beforeFrame={x:flow.x,y:flow.y,width:flow.width,height:flow.height};
  const beforeSibling={x:frame.children[1].x,y:frame.children[1].y};
  const sourceBefore=cloneDocument(document).pages[0].children[1];
  const getTextOutline=async(_document,node)=>node.id===linked.id
    ? textOutlineFixture(node,[nativeRect(1,2,node.width-1,node.height-2)],{placement:{x:linkedPath.x,y:linkedPath.y,width:linkedPath.width,height:linkedPath.height,rotation:linkedPath.rotation,affineTransform:linkedPath.affineTransform}})
    : textOutlineFixture(node,[nativeRect(1,2,node.width-1,node.height-2)]);
  const plan=await prepareOutlineStroke(document,[flow.id,linked.id],{getTextOutline});
  applyOutlineStroke(document,plan); applyAutoLayout(frame);
  assert.deepEqual({x:flow.x,y:flow.y,width:flow.width,height:flow.height},beforeFrame);
  assert.equal(flow.type,'group'); assert.equal(flow.layoutSizingMain,'fixed');
  assert.equal(flow.layoutSizingCross,'fixed');
  assert.deepEqual({x:frame.children[1].x,y:frame.children[1].y},beforeSibling);
  assert.equal(linked.type,'group'); assert.equal(linked.textPath,undefined);
  assert.deepEqual({x:linked.x,y:linked.y,width:linked.width,height:linked.height,rotation:linked.rotation},
    {x:70,y:30,width:50,height:24,rotation:17});
  assert.deepEqual(linked.affineTransform,linkedPath.affineTransform);
  assert.deepEqual(document.pages[0].children[1],sourceBefore,'the linked baseline remains unchanged');
  validateDocument(document);
});

test('text color variables follow glyphs and decorations; text color styles materialize as editable path paint', async () => {
  const variableNode=createNode('text',{name:'Variable color',text:'A',width:20,height:20,fillOpacity:.4});
  const variableDesign=design(variableNode); const collection=createVariableCollection(variableDesign,'Text colors');
  const colorVariable=createColorVariable(variableDesign,collection.id,'Ink','#cc2244');
  bindColorVariable(variableDesign,variableNode.id,colorVariable.id,'text');
  const glyph=nativeRect(1,2,10,18); const decoration=nativeRect(1,19,10,20);
  const variablePlan=await prepareOutlineStroke(variableDesign,[variableNode.id],{getTextOutline:async()=>textOutlineFixture(variableNode,[glyph],{
    glyphs:[{geometry:glyph,paint:{color:'#cc2244',opacity:1},glyphId:65,cluster:0,text:'A'}],
    decorations:[{geometry:decoration,paint:{color:'#cc2244',opacity:1}}]
  })});
  applyOutlineStroke(variableDesign,variablePlan);
  assert.equal(variableNode.children[0].fillVariableId,colorVariable.id);
  assert.equal(variableNode.children[1].fillVariableId,colorVariable.id);
  assert.equal(variableNode.fillOpacity,.4,'the scalar text opacity remains on the staged root');
  assert.equal(variableNode.children[0].fills[0].opacity,1,'glyph/run alpha remains independent of root scalar opacity');
  validateDocument(variableDesign);

  const styled=createNode('text',{name:'Styled',text:'S',width:20,height:20,color:'#126789'});
  const styledDesign=design(styled); const style=createColorStyle(styledDesign,styled.id,'Text ink');
  const stylePlan=await prepareOutlineStroke(styledDesign,[styled.id],{getTextOutline:async()=>textOutlineFixture(styled,[nativeRect(1,2,10,18)],{
    glyphs:[{geometry:nativeRect(1,2,10,18),paint:{color:style.value,opacity:1},glyphId:83,cluster:0,text:'S'}]
  })});
  applyOutlineStroke(styledDesign,stylePlan);
  assert.equal(styled.textStyleId,undefined); assert.equal(styled.children[0].fills[0].color,style.value);
  validateDocument(styledDesign);
});

test('truncation that removes an earlier glyph does not shift later glyph paint assignments', async () => {
  const node=createNode('text',{text:'AB',width:20,height:20,textTruncation:'ending'}); const document=design(node);
  const first=nativeRect(1,1,8,18), second=nativeRect(9,1,19,18); let intersections=0;
  const plan=await prepareOutlineStroke(document,[node.id],{
    getTextOutline:async()=>textOutlineFixture(node,[first,second],{
      glyphs:[{geometry:first,paint:{color:'#ff0000',opacity:1},glyphId:65,cluster:0,text:'A'},
        {geometry:second,paint:{color:'#0000ff',opacity:1},glyphId:66,cluster:1,text:'B'}],
      clipGeometry:nativeRect(0,0,20,20)
    }),
    booleanGeometry:async()=>++intersections===1
      ? {commands:new Float32Array(),fillRule:'nonzero',bounds:{left:0,top:0,right:0,bottom:0}}
      : outlineFixture()
  });
  applyOutlineStroke(document,plan);
  const glyph=node.children.find(child=>child.name==='Text glyph 2');
  assert.ok(glyph); assert.equal(glyph.fills[0].color,'#0000ff');
});

test('an explicit text fill retains its primary fill style on the paint plane and leaves glyph masks unstyled', async () => {
  const source=createNode('rectangle',{fill:'#226699',fills:[createFillLayer('solid',{color:'#226699'})]});
  const text=createNode('text',{text:'A',width:20,height:20,fills:[createFillLayer('solid',{color:'#aa0000'})]});
  const document=design(source,text); const style=createColorStyle(document,source.id,'Shared fill');
  text.fillStyleId=style.id;
  validateDocument(document);
  const plan=await prepareOutlineStroke(document,[text.id],{getTextOutline:async()=>textOutlineFixture(text,[nativeRect(1,1,18,18)])});
  applyOutlineStroke(document,plan);
  const [maskSource,paint]=text.children[0].children;
  assert.equal(paint.fillStyleId,style.id); assert.equal(getNodeColor(document,paint,'fill'),'#226699');
  assert.ok(maskSource.children.every(path=>!path.fillStyleId));
  source.fill='#55aa77'; source.fills[0].color='#55aa77'; delete source.fillStyleId;
  assert.equal(updateColorStyle(document,style.id,source.id),true);
  assert.equal(getNodeColor(document,paint,'fill'),'#55aa77');
  validateDocument(document);
});

test('text-outline selection failure, cancellation, stale variables and multiplicative fill budgets are atomic', async () => {
  const first=createNode('text',{text:'A',width:20,height:20,fills:[createFillLayer('solid',{color:'#123456'}),createFillLayer('solid',{color:'#654321'})]});
  const second=createNode('text',{text:'B',width:20,height:20}); const document=design(first,second); const before=cloneDocument(document);
  let calls=0;
  await assert.rejects(prepareOutlineStroke(document,[first.id,second.id],{getTextOutline:async(_doc,node)=>{calls++;if(node.id===second.id)throw new Error('font missing');return textOutlineFixture(node,[nativeRect(1,1,18,18)]);}}),/font missing/);
  assert.deepEqual(document,before);
  const stalePlan=await prepareOutlineStroke(document,[first.id],{getTextOutline:async(_doc,node)=>{document.variables.push({id:'changed',name:'Changed',type:'color',value:'#000000'});return textOutlineFixture(node,[nativeRect(1,1,18,18)]);}}).catch(error=>error);
  assert.match(stalePlan.message,/changed while outlining/); assert.deepEqual(first.fills,before.pages[0].children[0].fills);
  assert.ok(calls>=2);
  const big=createNode('text',{text:'A',width:20,height:20,fills:Array.from({length:32},(_,i)=>createFillLayer('solid',{color:i%2?'#112233':'#445566'}))});
  const many=design(big); const hugeOutline=textOutlineFixture(big,Array.from({length:640},()=>nativeRect(1,1,18,18)));
  await assert.rejects(prepareOutlineStroke(many,[big.id],{getTextOutline:async()=>hugeOutline}),/4,096-glyph|100,000-point|20,000 editable-outline/);
  assert.equal(big.type,'text');
  await assert.rejects(prepareOutlineStroke(document,[first.id],{getTextOutline:async()=>{throw new DOMException('cancel','AbortError');}}),{name:'AbortError'});
});

function walkNodesForTest(node,visit) { visit(node); for(const child of node.children||[]) walkNodesForTest(child,visit); }
