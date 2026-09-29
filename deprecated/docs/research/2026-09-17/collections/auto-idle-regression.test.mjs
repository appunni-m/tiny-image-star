import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { ResourceScheduler } from '../../../../src/processing/scheduler.js';
const MiB=1048576;
test('an idle interval between collections must not manufacture a throughput regression',async(t)=>{
 let time=0;const workers=[];
 class Worker extends EventTarget{
  constructor(){super();queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{type:'ready',heapBytes:32*MiB}})));}
  postMessage(packet){this.packet=packet;}
  terminate(){this.dead=true;this.packet=null;}
  finish(){const p=this.packet;this.packet=null;this.dispatchEvent(new MessageEvent('message',{data:{type:'done',revision:p.revision,heapBytes:40*MiB}}));}
 }
 const pool=new ResourceScheduler({hints:{hardwareConcurrency:16,deviceMemory:16},now:()=>time,workerFactory:()=>{const w=new Worker();workers.push(w);return w;}});t.after(()=>pool.close());
 const submit=(n)=>Array.from({length:n},(_,i)=>pool.enqueue({kind:'image',estimate:{heap:40*MiB,transient:8*MiB,output:2*MiB,cpu:1},workClass:'same-render',prepare:()=>({message:{type:'process',revision:i}})}));
 const tick=async()=>{await nextTurn();await nextTurn();};
 const first=submit(26);await tick();
 for(let n=0;first.some(j=>j.state!=='finished');n++){
  assert.ok(n<100);time+=100;for(const w of workers.filter(w=>w.packet&&!w.dead))w.finish();await tick();
 }
 await Promise.all(first.map(j=>j.promise));const before=pool.snapshot().limit;assert.equal(before,4);
 time+=10000;const second=submit(64);await tick();time+=100;
 for(const w of workers.filter(w=>w.packet&&!w.dead))w.finish();await tick();
 const after=pool.snapshot().limit;console.log({before,after});
 for(const job of second)job.cancel();await Promise.allSettled(second.map(j=>j.promise));
 assert.ok(after>=before,'idle time was counted as slower processing');
});
