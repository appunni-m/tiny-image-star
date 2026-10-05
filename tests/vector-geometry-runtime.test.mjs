import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createNode } from '../src/model.js';
import { createStroke } from '../src/strokes.js';
import { nativePathGeometryForNode } from '../src/vector-shape-geometry.js';
import { outlinedGeometryToPathGeometry } from '../src/vector-outline-conversion.js';
import { LocalVectorGeometryClient } from '../src/vector-geometry-runtime.js';

const geometry=nativePathGeometryForNode(createNode('rectangle',{width:60,height:40}));
const stroke=createStroke({width:8,alignment:'outside'});
const emptyResult=()=>({commands:new Float32Array(),fillRule:'nonzero',bounds:{left:0,top:0,right:0,bottom:0}});
class FakeWorker{
  constructor(){this.listeners=new Map();this.messages=[];this.terminated=false;}
  addEventListener(type,callback){this.listeners.set(type,callback);}
  postMessage(message){this.messages.push(message);}
  terminate(){this.terminated=true;}
  emit(value){this.listeners.get('message')?.({data:value});}
  complete(value=emptyResult()){this.emit({id:this.messages.at(-1).id,ok:true,value});}
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('the vector client is lazy, serializes queued jobs, copies geometry, and releases its idle worker',async()=>{
  const workers=[];const client=new LocalVectorGeometryClient({workerFactory:()=>{const worker=new FakeWorker();workers.push(worker);return worker;},idleTimeoutMs:5});
  assert.equal(workers.length,0);
  const mutable=structuredClone(geometry);const first=client.outlineStroke(mutable,stroke);const second=client.outlineStroke(geometry,stroke);
  assert.equal(workers.length,1);assert.equal(workers[0].messages.length,1);
  mutable.strokeContours[0].commands[0].end.x=999;
  assert.equal(workers[0].messages[0].geometry.strokeContours[0].commands[0].end.x,60,'queued inputs do not borrow later mutable editor state');
  workers[0].complete();await first;await turn();assert.equal(workers[0].messages.length,2);
  workers[0].complete();await second;await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(workers[0].terminated,true);
  const restarted=client.initialize();assert.equal(workers.length,2);
  workers[1].complete({version:'0.42.0',heapBytes:128*1024*1024});await restarted;client.close();
});

test('queued cancellation preserves the active job and active cancellation terminates before restarting queued work',async()=>{
  const workers=[];const client=new LocalVectorGeometryClient({workerFactory:()=>{const worker=new FakeWorker();workers.push(worker);return worker;}});
  const runningAbort=new AbortController();const queuedAbort=new AbortController();
  const running=client.outlineStroke(geometry,stroke,{signal:runningAbort.signal});
  const queued=client.outlineStroke(geometry,stroke,{signal:queuedAbort.signal});
  queuedAbort.abort();await assert.rejects(queued,{name:'AbortError'});assert.equal(workers[0].terminated,false);
  const preserved=client.outlineStroke(geometry,stroke);runningAbort.abort();await assert.rejects(running,{name:'AbortError'});
  assert.equal(workers[0].terminated,true);await turn();assert.equal(workers.length,2);
  workers[0].emit({id:workers[1].messages[0].id,ok:true,value:{...emptyResult(),fillRule:'bogus'}});
  workers[1].complete();await preserved;client.close();
});

test('timeouts and fatal worker errors release the heap immediately and recover the next queued operation',async()=>{
  const workers=[];const client=new LocalVectorGeometryClient({workerFactory:()=>{const worker=new FakeWorker();workers.push(worker);return worker;},timeoutMs:10});
  const timed=client.outlineStroke(geometry,stroke);await assert.rejects(timed,{code:'VECTOR_GEOMETRY_TIMEOUT'});
  assert.equal(workers[0].terminated,true);
  const failed=client.outlineStroke(geometry,stroke);const next=client.outlineStroke(geometry,stroke);
  workers[1].emit({id:workers[1].messages[0].id,ok:false,fatal:true,error:{message:'Native heap exceeded its limit.',code:'VECTOR_GEOMETRY_LIMIT'}});
  await assert.rejects(failed,{code:'VECTOR_GEOMETRY_LIMIT'});assert.equal(workers[1].terminated,true);await turn();
  workers[2].complete();await next;client.close();
});

test('queue admission, unsupported stroke settings, and malformed output fail without partial geometry',async()=>{
  const worker=new FakeWorker();const client=new LocalVectorGeometryClient({workerFactory:()=>worker,maxQueue:1});
  const running=client.outlineStroke(geometry,stroke);
  await assert.rejects(client.outlineStroke(geometry,stroke),{code:'VECTOR_GEOMETRY_QUEUE_FULL'});
  worker.complete({...emptyResult(),commands:new Float32Array([1,0,0])});await assert.rejects(running,/without a starting point/);
  const count=worker.messages.length;
  await assert.rejects(client.outlineStroke(geometry,createStroke({pattern:'custom',dashArray:[3,7,9,2]})),/one dash and one gap/);
  assert.equal(worker.messages.length,count,'unsupported inputs never enter the worker queue');
  client.close();await assert.rejects(client.initialize(),{code:'VECTOR_GEOMETRY_CLOSED'});
});

function nativeWorkerFactory({tamper=false}={}){
  const workerUrl=new URL('../src/workers/vector-geometry-worker.bundle.js',import.meta.url).href;
  const wasmUrl=new URL('../src/workers/vector-geometry.wasm',import.meta.url).href;
  const worker=new NodeWorker(`
    const {parentPort}=require('node:worker_threads');
    const {readFile}=require('node:fs/promises');
    globalThis.WorkerGlobalScope=class {};
    globalThis.self={location:{href:${JSON.stringify(workerUrl)}},addEventListener(type,callback){if(type==='message')parentPort.on('message',data=>callback({data}));},postMessage:(value,transfers)=>parentPort.postMessage(value,transfers)};
    globalThis.fetch=async url=>{if(String(url)!==${JSON.stringify(wasmUrl)})throw new Error('The geometry worker attempted a non-local fetch.');const bytes=await readFile(new URL(url));if(${tamper})bytes[0]^=1;return new Response(bytes,{headers:{'content-length':String(bytes.length)}});};
    import(${JSON.stringify(workerUrl)}).catch(error=>{throw error;});
  `,{eval:true});
  return{postMessage:message=>worker.postMessage(message),terminate:()=>worker.terminate(),addEventListener:(type,callback)=>{
    if(type==='message')worker.on('message',data=>callback({data}));
    else if(type==='error')worker.on('error',callback);
    else if(type==='messageerror')worker.on('messageerror',callback);
  }};
}

test('the actual bundled worker verifies and runs local WASM and transfers independently bounded native geometry',async()=>{
  const client=new LocalVectorGeometryClient({workerFactory:nativeWorkerFactory,timeoutMs:10_000});
  try{
    const metadata=await client.initialize();assert.equal(metadata.version,'0.42.0');assert.equal(metadata.heapBytes,128*1024*1024);
    const result=await client.outlineStroke(geometry,stroke);
    assert.deepEqual(result.bounds,{left:-8,top:-8,right:68,bottom:48});assert.equal(result.fillRule,'evenodd');
    const path=outlinedGeometryToPathGeometry(result,60,40);assert.ok(path.points.length>=4);assert.equal(path.subpaths.length,1);
  }finally{client.close();}
});

test('the actual bundled worker rejects corrupt local WASM before running geometry',async()=>{
  const client=new LocalVectorGeometryClient({workerFactory:()=>nativeWorkerFactory({tamper:true}),timeoutMs:10_000});
  try{await assert.rejects(client.initialize(),{code:'VECTOR_GEOMETRY_INTEGRITY'});}
  finally{client.close();}
});
