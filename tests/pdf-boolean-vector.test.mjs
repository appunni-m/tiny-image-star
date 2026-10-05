import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import * as model from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { booleanGeometryWithKit } from '../src/vector-geometry-kernel.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { assertVectorPdfEffectsSupported, createVectorPdf, PdfVectorExportError, walkVectorPdfPaintNodes } from '../src/pdf-vector-export.js';
const require=createRequire(import.meta.url);
const kit=await require('canvaskit-wasm')({wasmBinary:await readFile(new URL('../node_modules/canvaskit-wasm/bin/canvaskit.wasm',import.meta.url))});
const run=async request=>booleanGeometryWithKit(kit,request);
const text=bytes=>Buffer.from(bytes).toString('latin1');
function design(node){const document=model.createDocument();document.pages[0].children=[node];return document;}
function boolean(width,height,children,options={}){
  return model.createNode('boolean',{name:'Prepared result',width,height,operation:'subtract',booleanGeometry:'vector',fill:'#123456',children,...options});
}
const prepare=(document,node)=>model.prepareBooleanVectorPath(document,node,{booleanGeometry:run});

test('PDF paint traversal visits a prepared Boolean result with its identity and own paints, without source effects',async()=>{
  const source=model.createNode('rectangle',{width:70,height:50,fill:'#ff0000',effects:[model.createLayerEffect('noise')]});
  const cut=model.createNode('rectangle',{x:20,y:15,width:30,height:20,fill:'#00ff00'});
  const result=boolean(70,50,[source,cut]);const document=design(result);
  await prepare(document,result);
  const visited=[];walkVectorPdfPaintNodes(document,[result],entry=>{visited.push(entry);assertVectorPdfEffectsSupported(entry.node);});
  assert.equal(visited.length,1);assert.equal(visited[0].node.type,'path');assert.equal(visited[0].node.id,result.id);
  assert.equal(visited[0].sourceNode,result);assert.equal(visited[0].node.fill,'#123456');assert.deepEqual(visited[0].node.children,[]);
  assert.equal(source.effects[0].type,'noise','the editable operand is retained rather than rewritten for PDF');
  result.effects=[model.createLayerEffect('noise')];
  assert.throws(()=>walkVectorPdfPaintNodes(document,[result],entry=>assertVectorPdfEffectsSupported(entry.node)),/noise effects/);
});

test('prepared native curved and stroked Boolean results become PDF paths with holes and their result paint stack',async()=>{
  const outer=model.createNode('ellipse',{width:100,height:80,fill:'#ff0000',strokes:[createStroke({color:'#00ff00',width:8,alignment:'outside'})]});
  const cut=model.createNode('rectangle',{x:35,y:25,width:30,height:30,fill:'#ffff00'});
  const result=boolean(100,80,[outer,cut],{strokes:[createStroke({color:'#abcdef',width:2})]});const document=design(result);
  const path=await prepare(document,result);
  assert.deepEqual(path.__booleanGeometryBounds,{left:-8,top:-8,right:108,bottom:88});
  assert.ok(path.points.some(point=>point.out?.x||point.out?.y));assert.equal(path.subpaths.length,1);
  const svg=exportNodeToSvg(result,{document});const pdf=text(createVectorPdf(svg));
  assert.match(svg,/data-tiny-image-star-source-type="boolean"/);assert.match(svg,/<path\b[^>]*fill-rule="evenodd"/);
  assert.doesNotMatch(svg,/tis-boolean-[^"\s]*-operand/,'the result is not an alpha rectangle with operand masks');
  assert.match(pdf,/\bc\n/,'native curves remain cubic PDF path segments');assert.match(pdf,/\bf\*\n/,'the hole fill rule survives into PDF');
  assert.match(pdf,/\bS\n/,'the Boolean result stroke is retained');
  assert.match(pdf,/0\.0705882352941 0\.203921568627 0\.337254901961 rg/);
  assert.doesNotMatch(pdf,/1 0 0 rg|0 1 0 rg|1 1 0 rg/,'source operand colors are not independent PDF paints');
  assert.doesNotMatch(pdf,/\/Subtype \/Image|\/SMask/,'the simple Boolean remains actual PDF geometry');
  const viewBox=/viewBox="([^" ]+) ([^" ]+) ([^" ]+) ([^" ]+)"/.exec(svg)?.slice(1).map(Number);
  assert.ok(viewBox&&viewBox[0]<=-9&&viewBox[1]<=-9&&viewBox[0]+viewBox[2]>=109&&viewBox[1]+viewBox[3]>=89,'negative and out-of-box source ink is included in the export bounds');
});

test('empty prepared Boolean PDF results remain empty and never resurrect operand paints',async()=>{
  const result=boolean(31,23,[model.createNode('rectangle',{width:31,height:23,fill:'#ff0000'}),model.createNode('rectangle',{width:31,height:23,fill:'#00ff00'})]);
  const document=design(result);const path=await prepare(document,result);assert.deepEqual(path.points,[]);
  const pdf=text(createVectorPdf(exportNodeToSvg(result,{document})));
  assert.doesNotMatch(pdf,/\b(?:f\*?|S|B\*?)\n|\/Subtype \/Image|\/SMask/);
});

test('prepared Boolean PDF paints follow inherited variable modes without reusing stale colors or rerunning geometry',async()=>{
  const authored=boolean(61,43,[model.createNode('rectangle',{width:61,height:43}),model.createNode('rectangle',{x:20,y:10,width:20,height:20})],{strokes:[createStroke({width:2,color:'#112233'})]});
  const frame=model.createNode('frame',{width:120,height:90,fill:'transparent',clip:false,children:[authored]});const result=frame.children[0];const document=design(frame);
  const collection=model.createVariableCollection(document,'Result paints');const alternate=model.addVariableMode(document,collection.id,'Alternate');
  const fill=model.createVariable(document,collection.id,'Fill','color','#123456');const stroke=model.createVariable(document,collection.id,'Stroke','color','#112233');
  model.setVariableValue(document,fill.id,'#fedcba',alternate.id);model.setVariableValue(document,stroke.id,'#654321',alternate.id);
  assert.equal(model.bindColorVariable(document,result.id,fill.id),true);assert.equal(model.bindColorVariable(document,result.id,stroke.id,'stroke'),true);
  let calls=0;const options={booleanGeometry:async request=>{calls++;return run(request);}};
  await model.prepareBooleanVectorPath(document,result,options);const initialCalls=calls;
  model.setFrameVariableMode(document,frame.id,collection.id,alternate.id);await model.prepareBooleanVectorPath(document,result,options);
  assert.equal(calls,initialCalls,'result paints are resolved fresh around the unchanged cached geometry');
  const entries=[];walkVectorPdfPaintNodes(document,[frame],entry=>entries.push(entry));
  const path=entries.find(entry=>entry.sourceNode===result).node;assert.equal(path.id,result.id);assert.equal(path.fill,'#fedcba');assert.equal(path.strokes[0].color,'#654321');
  const svg=exportNodeToSvg(frame,{document});assert.match(svg,/fill="#fedcba"/);assert.match(svg,/stroke="#654321"/);assert.doesNotMatch(svg,/fill="#123456"|stroke="#112233"/);
  const pdf=text(createVectorPdf(svg));assert.match(pdf,/0\.996078431373 0\.862745098039 0\.729411764706 rg/);assert.match(pdf,/0\.396078431373 0\.262745098039 0\.129411764706 RG/);
});

test('synchronous PDF traversal rejects pending and failed geometry and preserves legacy source traversal',async()=>{
  const first=model.createNode('rectangle',{width:47,height:37});const second=model.createNode('rectangle',{x:10,y:10,width:20,height:10});
  const pending=boolean(47,37,[first,second]);const document=design(pending);
  assert.throws(()=>walkVectorPdfPaintNodes(document,[pending],()=>{}),error=>error instanceof PdfVectorExportError&&/still being prepared/.test(error.message));
  await assert.rejects(model.prepareBooleanVectorPath(document,pending,{booleanGeometry:async()=>{throw new Error('Native Boolean operation failed safely.');}}),/failed safely/);
  assert.throws(()=>walkVectorPdfPaintNodes(document,[pending],()=>{}),/Native Boolean operation failed safely/);
  const visited=[];delete pending.booleanGeometry;walkVectorPdfPaintNodes(document,[pending],entry=>visited.push(entry.node));
  assert.deepEqual(visited,[pending,first,second]);
  pending.visible=false;walkVectorPdfPaintNodes(document,[pending],()=>assert.fail('a hidden result is not painted'));
});

test('PDF paint traversal rejects a partial synthetic result without changing the source tree',()=>{
  const node=boolean(11,13,[]);const document=design(node);
  assert.throws(()=>walkVectorPdfPaintNodes(document,[node],()=>{},{resolveBoolean:()=>({...node,type:'path',id:'wrong',children:[]})}),/no complete prepared result/);
  assert.equal(node.type,'boolean');assert.equal(node.booleanGeometry,'vector');
});
