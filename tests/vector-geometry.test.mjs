import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createNode } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { nativePathGeometryForNode } from '../src/vector-shape-geometry.js';
import { outlineStrokeGeometryWithKit } from '../src/vector-geometry-kernel.js';
import { outlinedGeometryToPathGeometry } from '../src/vector-outline-conversion.js';
import { normalizeVectorOutlineRequest, validateVectorOutlineResult, VECTOR_GEOMETRY_LIMITS } from '../src/vector-geometry-contract.js';
import { VECTOR_GEOMETRY_RUNTIME_ARTIFACTS as artifacts } from '../src/vector-geometry-artifacts.js';
const require=createRequire(import.meta.url);
const kit=await require('canvaskit-wasm')({wasmBinary:await readFile(new URL('../node_modules/canvaskit-wasm/bin/canvaskit.wasm',import.meta.url))});
function outline(node,stroke){return outlineStrokeGeometryWithKit(kit,nativePathGeometryForNode(node),createStroke(stroke));}
function contains(result,x,y){const path=kit.Path.MakeFromCmds(result.commands);assert.ok(path);path.setFillType(result.fillRule==='evenodd'?kit.FillType.EvenOdd:kit.FillType.Winding);try{return path.contains(x,y);}finally{path.delete();}}

test('the audited local Skia backend outlines all caps, joins, and miter fallback as actual filled paths',()=>{
  const node=createNode('line',{width:60,height:0});
  for(const cap of ['butt','round','square']){
    const result=outline(node,{width:8,cap});
    assert.deepEqual(result.bounds,cap==='butt'?{left:0,top:-4,right:60,bottom:4}:{left:-4,top:-4,right:64,bottom:4});
    assert.equal(contains(result,-3,-3),cap==='square');
    assert.equal(contains(result,-3,0),cap!=='butt');
  }
  const corner=createNode('path',{width:80,height:70,closed:false,points:[{x:.25,y:1},{x:.625,y:2/7},{x:1,y:1}]});
  const miter=outline(corner,{width:10,join:'miter'});const round=outline(corner,{width:10,join:'round'});const bevel=outline(corner,{width:10,join:'bevel'});
  assert.ok(miter.bounds.top<round.bounds.top);assert.ok(round.bounds.top<bevel.bounds.top);
  assert.deepEqual(outline(corner,{width:10,join:'miter',miterLimit:1}).bounds,bevel.bounds);
});

test('inside, centered, and outside outlines retain their authored weights and fill-rule hole polarity',()=>{
  const rectangle=createNode('rectangle',{width:60,height:40});
  for(const alignment of ['inside','center','outside']){
    const result=outline(rectangle,{width:8,alignment});
    assert.equal(contains(result,-6,20),alignment==='outside');assert.equal(contains(result,-2,20),alignment!=='inside');
    assert.equal(contains(result,2,20),alignment!=='outside');assert.equal(contains(result,6,20),alignment==='inside');
    assert.equal(contains(result,20,20),false);
  }
  const hole=createNode('path',{width:100,height:80,closed:true,fillRule:'evenodd',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],subpaths:[{closed:true,points:[{x:.3,y:.25},{x:.7,y:.25},{x:.7,y:.75},{x:.3,y:.75}]}]});
  assert.equal(contains(outline(hole,{width:6,alignment:'inside'}),28,40),true);
  assert.equal(contains(outline(hole,{width:6,alignment:'outside'}),32,40),true);
  assert.equal(contains(outline(hole,{width:6,alignment:'inside'}),32,40),false);
});

test('pair dashes and zero-length dots preserve rhythm while alignment doubles only geometric width',()=>{
  const node=createNode('rectangle',{width:80,height:50});
  for(const alignment of ['inside','outside']){
    const result=outline(node,{width:2,alignment,pattern:'dashed'});
    const y=alignment==='inside'?1:-1;
    assert.equal(contains(result,4,y),true);assert.equal(contains(result,10,y),false);assert.equal(contains(result,16,y),true);
  }
  const line=createNode('line',{width:60,height:0});
  const dotted=outline(line,{width:4,cap:'round',pattern:'dotted'});
  assert.equal(contains(dotted,0,0),true);assert.equal(contains(dotted,4,0),false);assert.equal(contains(dotted,8,0),true);
  assert.throws(()=>outline(node,{width:8,pattern:'custom',dashArray:[4,0],join:'miter'}),/zero-length dash gap/,
    'zero-gap authored dash seams must not silently become solid miter joins');
  assert.throws(()=>outline(node,{pattern:'custom',dashArray:[3,7,9,2]}),/one dash and one gap/);
});

test('independent rectangle side weights retain their joins and authored empty side',()=>{
  const node=createNode('rectangle',{width:60,height:40});
  const result=outline(node,{width:8,sideMode:'custom',sideWidths:{top:4,right:8,bottom:12,left:0}});
  assert.equal(contains(result,-2,20),false);assert.equal(contains(result,30,-1),true);
  assert.equal(contains(result,63,20),true);assert.equal(contains(result,30,45),true);assert.equal(contains(result,63,45),true);
  const outside=outline(node,{width:8,alignment:'outside',sideMode:'custom',sideWidths:{top:4,right:8,bottom:12,left:0}});
  assert.equal(contains(outside,30,-3),true);assert.equal(contains(outside,30,2),false);assert.equal(contains(outside,67,20),true);
});

test('native ellipses retain rational conics and repeated native path cleanup leaves the heap stable',()=>{
  const node=createNode('ellipse',{width:60,height:40});
  const result=outline(node,{width:5,alignment:'outside'});
  let cursor=0;let conics=0;const sizes={0:2,1:2,2:4,3:5,4:6,5:0};
  while(cursor<result.commands.length){const verb=result.commands[cursor++];if(verb===3)conics++;cursor+=sizes[verb];}
  assert.ok(conics>0);assert.equal(contains(result,30,-2),true);assert.equal(contains(result,30,2),false);
  const before=kit.HEAPU8.byteLength;
  for(let index=0;index<2000;index++)outline(node,{width:5,alignment:'outside'});
  assert.equal(kit.HEAPU8.byteLength,before);assert.equal(before,128*1024*1024);
});

function rational(a,b,c,w,t){const u=1-t;const divisor=u*u+2*w*u*t+t*t;return{x:(u*u*a.x+2*w*u*t*b.x+t*t*c.x)/divisor,y:(u*u*a.y+2*w*u*t*b.y+t*t*c.y)/divisor};}
function cubic(a,b,c,d,t){const u=1-t;return{x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y};}
test('conic conversion has a bounded dense-sample error for positive rational weights and exact cubic handles',()=>{
  for(const authoredWeight of [.2,Math.SQRT1_2,1,2.7]){
    const commands=new Float32Array([0,0,0,3,100,200,200,0,authoredWeight,1,0,0,5]);
    const result={commands,fillRule:'nonzero',bounds:{left:0,top:0,right:200,bottom:200}};
    const geometry=outlinedGeometryToPathGeometry(result,200,200);const anchors=geometry.points;const weight=commands[8];
    const a={x:0,y:0},b={x:100,y:200},c={x:200,y:0};
    const parameterAt=x=>{let low=0,high=1;for(let i=0;i<50;i++){const middle=(low+high)/2;if(rational(a,b,c,weight,middle).x<x)low=middle;else high=middle;}return(low+high)/2;};
    for(let index=0;index<anchors.length-1;index++){
      const start=anchors[index];const end=anchors[index+1];
      const startPoint={x:start.x*200,y:start.y*200};const endPoint={x:end.x*200,y:end.y*200};
      const c1={x:(start.x+start.out.x)*200,y:(start.y+start.out.y)*200};const c2={x:(end.x+end.in.x)*200,y:(end.y+end.in.y)*200};
      const first=parameterAt(startPoint.x),last=parameterAt(endPoint.x);
      for(let sample=0;sample<=100;sample++){
        const amount=sample/100;const reference=rational(a,b,c,weight,first+(last-first)*amount);
        const converted=cubic(startPoint,c1,c2,endPoint,amount);
        assert.ok(Math.hypot(reference.x-converted.x,reference.y-converted.y)<=VECTOR_GEOMETRY_LIMITS.conicTolerance+1e-8);
      }
    }
  }
  const exact={commands:new Float32Array([0,0,0,4,2,3,8,3,10,0,1,0,0,5]),fillRule:'nonzero',bounds:{left:0,top:0,right:10,bottom:3}};
  const geometry=outlinedGeometryToPathGeometry(exact,10,10);assert.deepEqual(geometry.points[0].out,{x:.2,y:.3});assert.deepEqual(geometry.points[1].in,{x:-.2,y:.3});
});

test('tiny positive dimensions and negative outside points retain their actual local coordinates',()=>{
  const result={commands:new Float32Array([0,-.005,0,1,.015,0,1,.015,.01,1,-.005,.01,5]),fillRule:'nonzero',bounds:{left:-.005,top:0,right:.015,bottom:.01}};
  const geometry=outlinedGeometryToPathGeometry(result,.01,.01);
  assert.ok(Math.abs(geometry.points[0].x+.5)<1e-6);assert.ok(Math.abs(geometry.points[1].x-1.5)<1e-6);
  assert.ok(Math.abs(geometry.points[2].y-1)<1e-6);
  assert.equal(outlinedGeometryToPathGeometry(result,0,0).points[0].x,result.commands[1]);
});

test('malformed geometry and excessive requests fail before entering native allocations or retaining partial output',()=>{
  const geometry=nativePathGeometryForNode(createNode('rectangle'));
  assert.throws(()=>normalizeVectorOutlineRequest({...geometry,strokeContours:[{start:{x:0,y:0},closed:false,commands:Array.from({length:20_001},()=>({type:'line',start:{x:0,y:0},end:{x:1,y:1}}))}]},createStroke()),/input command limit/);
  assert.throws(()=>outlineStrokeGeometryWithKit({},geometry,createStroke({startDecoration:'arrow'})),/endpoint decorations/);
  assert.throws(()=>validateVectorOutlineResult({commands:new Float32Array([0,0,0,3,1,1,2,2,0,5]),fillRule:'nonzero',bounds:{left:0,top:0,right:2,bottom:2}}),/rational weight/);
  assert.throws(()=>outlinedGeometryToPathGeometry({commands:new Float32Array([0,0,0,1,1,1]),fillRule:'nonzero',bounds:{left:0,top:0,right:1,bottom:1}},1,1),/unexpectedly open/);
  assert.equal(artifacts.version,'0.42.0');
});
