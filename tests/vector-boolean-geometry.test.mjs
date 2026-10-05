import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createNode } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { nativePathGeometryForNode } from '../src/vector-shape-geometry.js';
import { booleanGeometryWithKit } from '../src/vector-geometry-kernel.js';
import { normalizeVectorBooleanRequest, VECTOR_GEOMETRY_LIMITS } from '../src/vector-geometry-contract.js';
const require=createRequire(import.meta.url);
const kit=await require('canvaskit-wasm')({wasmBinary:await readFile(new URL('../node_modules/canvaskit-wasm/bin/canvaskit.wasm',import.meta.url))});
const identity=()=>[1,0,0,1,0,0];
const shape=(node,{transform=identity(),includeFill=true,strokes=[]}={})=>({kind:'shape',geometry:nativePathGeometryForNode(node),transform,includeFill,strokes:strokes.map(createStroke)});
const rectangle=(x,y,width,height,options={})=>shape(createNode('rectangle',{width,height}),{transform:[1,0,0,1,x,y],...options});
const group=(operation,children,options={})=>({kind:'boolean',operation,children,transform:identity(),includeFill:true,strokes:[],...options});
const execute=root=>booleanGeometryWithKit(kit,{root});
const nativePath=result=>{const path=kit.Path.MakeFromCmds(result.commands);assert.ok(path);path.setFillType(result.fillRule==='evenodd'?kit.FillType.EvenOdd:kit.FillType.Winding);return path;};
const contains=(result,x,y)=>{const path=nativePath(result);try{return path.contains(x,y);}finally{path.delete();}};

test('native Boolean union, subtract, intersect, and exclude match binary region truth tables',()=>{
  const a=rectangle(0,0,40,30);const b=rectangle(20,10,40,30);
  for(const operation of ['union','subtract','intersect','exclude']){
    const result=execute(group(operation,[a,b]));const path=nativePath(result);
    try{for(let y=-4.5;y<46;y+=5)for(let x=-4.5;x<66;x+=5){
      const first=x>0&&x<40&&y>0&&y<30;const second=x>20&&x<60&&y>10&&y<40;
      const expected=operation==='union'?first||second:operation==='subtract'?first&&!second:operation==='intersect'?first&&second:first!==second;
      assert.equal(path.contains(x,y),expected,`${operation} at ${x},${y}`);
    }}finally{path.delete();}
    assert.deepEqual(result.bounds,operation==='union'||operation==='exclude'?{left:0,top:0,right:60,bottom:40}
      :operation==='subtract'?{left:0,top:0,right:40,bottom:30}:{left:20,top:10,right:40,bottom:30});
  }
});

test('ordered subtraction, evenodd holes, additive fill groups, and empty results retain actual coverage',()=>{
  const ring=execute(group('subtract',[rectangle(0,0,80,60),rectangle(20,10,40,40)]));
  assert.equal(contains(ring,10,30),true);assert.equal(contains(ring,40,30),false);
  const split=execute(group('subtract',[rectangle(0,0,80,60),rectangle(20,0,10,60),rectangle(50,0,10,60)]));
  assert.equal(contains(split,40,30),true);assert.equal(contains(split,25,30),false);assert.equal(contains(split,55,30),false);
  const hole=createNode('path',{width:80,height:60,closed:true,fillRule:'evenodd',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],subpaths:[{closed:true,points:[{x:.25,y:1/6},{x:.75,y:1/6},{x:.75,y:5/6},{x:.25,y:5/6}]}]});
  const additive=shape(hole);additive.geometry.fillGroups.push(nativePathGeometryForNode(createNode('rectangle',{width:30,height:30})).fillGroups[0]);
  const added=execute(group('union',[additive]));assert.equal(contains(added,25,20),true);assert.equal(contains(added,40,30),false);
  for(const root of [group('intersect',[rectangle(0,0,10,10),rectangle(20,20,10,10)]),group('subtract',[rectangle(0,0,10,10),rectangle(-1,-1,12,12)]),group('union',[])]){
    const result=execute(root);assert.equal(result.commands.length,0);assert.deepEqual(result.bounds,{left:0,top:0,right:0,bottom:0});
  }
});

test('source stroke regions include open, zero-height lines and extend beyond logical boxes',()=>{
  const line=shape(createNode('line',{width:60,height:0}),{includeFill:false,strokes:[{width:8,cap:'round'}]});
  const result=execute(group('union',[line]));assert.deepEqual(result.bounds,{left:-4,top:-4,right:64,bottom:4});
  assert.equal(contains(result,-3,0),true);assert.equal(contains(result,30,3),true);assert.equal(contains(result,30,5),false);
  const outside=execute(group('union',[rectangle(0,0,20,10,{strokes:[{width:4,alignment:'outside'}]})]));
  assert.deepEqual(outside.bounds,{left:-4,top:-4,right:24,bottom:14});assert.equal(contains(outside,10,5),true);
  const perimeter=execute(group('union',[rectangle(0,0,20,10,{includeFill:false,strokes:[{width:2,alignment:'inside'}]})]));
  assert.equal(contains(perimeter,1,5),true);assert.equal(contains(perimeter,10,5),false);
});

test('curved source paths, network strokes, side weights, and pair dashes reuse native outline geometry',()=>{
  const cubic=createNode('path',{width:60,height:40,closed:false,points:[{x:0,y:.5,out:{x:.3,y:-.5}},{x:1,y:.5,in:{x:-.3,y:.5}}]});
  const curve=execute(group('union',[shape(cubic,{includeFill:false,strokes:[{width:6,cap:'round'}]})]));assert.equal(contains(curve,30,20),true);
  const network=createNode('network',{width:60,height:40,vertices:[{id:'a',x:0,y:.5},{id:'b',x:.5,y:.5},{id:'c',x:1,y:.5},{id:'d',x:.5,y:0}],edges:[{id:'ab',from:'a',to:'b'},{id:'bc',from:'b',to:'c'},{id:'bd',from:'b',to:'d'}],faces:[]});
  const branch=execute(group('union',[shape(network,{includeFill:false,strokes:[{width:6}]})]));assert.equal(contains(branch,30,1),true);assert.equal(contains(branch,1,20),true);assert.equal(contains(branch,15,10),false);
  const sides=execute(group('union',[rectangle(0,0,60,40,{includeFill:false,strokes:[{width:8,sideMode:'custom',sideWidths:{top:4,right:8,bottom:12,left:0}}]})]));
  assert.equal(contains(sides,-2,20),false);assert.equal(contains(sides,63,45),true);
  const dashed=execute(group('union',[shape(createNode('line',{width:60,height:0}),{includeFill:false,strokes:[{width:2,pattern:'custom',dashArray:[8,4]}]})]));
  assert.equal(contains(dashed,4,0),true);assert.equal(contains(dashed,10,0),false);assert.equal(contains(dashed,16,0),true);
});

test('nested Boolean result strokes use the result boundary and their own enabled fill setting',()=>{
  const nested=group('union',[rectangle(0,0,10,10),rectangle(10,0,10,10)],{includeFill:false,strokes:[createStroke({width:3,alignment:'outside'})],transform:[2,0,0,1,10,0]});
  const result=execute(group('union',[nested]));
  assert.deepEqual(result.bounds,{left:4,top:-3,right:56,bottom:13});
  assert.equal(contains(result,30,5),false,'there is no seam from the union operand outlines');
  assert.equal(contains(result,8,5),true);assert.equal(contains(result,30,-2),true);
  nested.includeFill=true;assert.equal(contains(execute(group('union',[nested])),30,5),true);
});

test('selected network face fills do not remove the geometric clip for unfilled inside strokes',()=>{
  const network=createNode('network',{width:60,height:40,vertices:[{id:'a',x:0,y:0},{id:'b',x:.5,y:0},{id:'c',x:.5,y:1},{id:'d',x:0,y:1},{id:'e',x:1,y:0},{id:'f',x:1,y:1}],edges:[{id:'ab',from:'a',to:'b'},{id:'bc',from:'b',to:'c'},{id:'cd',from:'c',to:'d'},{id:'da',from:'d',to:'a'},{id:'be',from:'b',to:'e'},{id:'ef',from:'e',to:'f'},{id:'fc',from:'f',to:'c'}],faces:[{id:'left',vertexIds:['a','b','c','d'],fill:'#ff0000'},{id:'right',vertexIds:['b','e','f','c'],fill:'transparent'}]});
  const region=shape(network,{strokes:[{width:4,alignment:'inside'}]});region.fillGroupIndices=[0];
  const result=execute(group('union',[region]));
  assert.equal(contains(result,15,20),true,'enabled left face contributes fill');
  assert.equal(contains(result,45,20),false,'disabled right face has no base fill');
  assert.equal(contains(result,58,20),true,'right face still clips its authored inside stroke');
  region.includeFill=false;region.fillGroupIndices=[];
  assert.equal(contains(execute(group('union',[region])),58,20),true,'stroke-only networks retain closed geometric coverage');
  for(const indices of [[2],[0,0],[-1],[.5]])assert.throws(()=>normalizeVectorBooleanRequest({root:{...region,fillGroupIndices:indices}}),/unique valid native face indices/);
});

test('nested affine transforms apply after local strokes and return tight transformed ink bounds',()=>{
  const operand=rectangle(0,0,20,10,{transform:[1,.5,.2,1,4,7]});
  const nested=group('union',[operand],{transform:[-1,0,0,1,60,12]});
  const result=execute(group('union',[nested],{transform:[1,0,0,1,3,-5]}));
  assert.deepEqual(result.bounds,{left:37,top:14,right:59,bottom:34});
  assert.equal(contains(result,48,24),true);assert.equal(contains(result,59,33),false);
  const ellipse=execute(group('union',[shape(createNode('ellipse',{width:40,height:20}),{transform:[1,0,1,1,0,0]})]));
  const expected=Math.hypot(20,10);assert.ok(Math.abs(ellipse.bounds.left-(30-expected))<1e-4);assert.ok(Math.abs(ellipse.bounds.right-(30+expected))<1e-4);
});

test('repeated requests observe source mutations and return independently retained native commands',()=>{
  const operand=rectangle(0,0,20,10);const request=group('union',[operand]);
  const original=execute(request);operand.transform[4]=40;const moved=execute(request);
  assert.equal(contains(original,10,5),true);assert.equal(contains(moved,10,5),false);assert.equal(contains(moved,50,5),true);
  original.commands.fill(0);assert.equal(contains(execute(request),50,5),true);
  const before=kit.HEAPU8.byteLength;
  for(let index=0;index<2000;index++)execute(group(['union','subtract','intersect','exclude'][index%4],[rectangle(0,0,20,10),rectangle(10,5,20,10)]));
  assert.equal(kit.HEAPU8.byteLength,before);assert.equal(before,128*1024*1024);
});

test('invalid and excessive region trees reject before native work, and native work failures release the heap',()=>{
  const cycle=group('union',[]);cycle.children.push(cycle);
  assert.throws(()=>booleanGeometryWithKit({}, {root:cycle}),/cyclic/);
  let deep=rectangle(0,0,10,10);for(let index=0;index<=VECTOR_GEOMETRY_LIMITS.maxInputDepth;index++)deep=group('union',[deep]);
  assert.throws(()=>normalizeVectorBooleanRequest({root:deep}),/source-tree limit/);
  assert.throws(()=>normalizeVectorBooleanRequest({root:group('union',Array.from({length:257},()=>rectangle(0,0,10,10)))}),/source-tree limit/);
  assert.throws(()=>normalizeVectorBooleanRequest({root:rectangle(0,0,10,10,{transform:[1,0,0,1,Infinity,0]})}),/finite/);
  assert.throws(()=>normalizeVectorBooleanRequest({root:group('union',[],{strokes:[createStroke({sideMode:'top'})]})}),/Individual side weights/);
  assert.throws(()=>normalizeVectorBooleanRequest({root:rectangle(0,0,10,10,{strokes:[{pattern:'custom',dashArray:[4,0]}]})}),/zero-length dash gap/);
  const commands=Array.from({length:19_000},(_,index)=>({type:'line',start:{x:index,y:0},end:{x:index+1,y:0}}));
  const dense={kind:'shape',includeFill:false,transform:identity(),strokes:Array.from({length:32},()=>createStroke({width:1})),geometry:{fillRule:'nonzero',fillGroups:[],alignedStrokeContours:[],strokeContours:[{start:{x:0,y:0},closed:false,commands}]}};
  const before=kit.HEAPU8.byteLength;assert.throws(()=>execute(dense),/bounded output point limit|source-stroke work limit/);assert.equal(kit.HEAPU8.byteLength,before);
  assert.equal(contains(execute(rectangle(0,0,10,10)),5,5),true,'native failure leaves the runtime usable');
});
