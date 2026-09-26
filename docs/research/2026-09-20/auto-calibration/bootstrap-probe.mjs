import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '/Users/lazytrot/work/tiny-image-star/node_modules/playwright/index.mjs';
import { collectionInput } from '/Users/lazytrot/work/tiny-image-star/scripts/migration/collection-input.mjs';
const root='/Users/lazytrot/work/tiny-image-star';
const scheduler=await readFile(resolve(root,'src/processing/scheduler.js'),'utf8');
const marker='if (window.completed < 8 || time - window.startedAt < 250) return;';
assert.equal(scheduler.split(marker).length,2);
const variants={baseline:scheduler,half:scheduler.replace('this.limit = 2;\n        this.bootstrapAvailable', 'this.limit = Math.max(2, Math.min(8, Math.floor(this.budget.cpu / 2), Math.floor(demand.length / 2)));\n        this.bootstrapAvailable')};
const inputPath='tests/fixtures/corpus/collections-v1/small.json',input=await collectionInput(inputPath);
let variant='baseline';
const output=resolve(root,'docs/research/2026-09-20/auto-calibration/bootstrap-probe.json');
const result={schema:'tinystar/development-calibration-probe@1',qualification:false,inputPath,variantHashes:Object.fromEntries(Object.entries(variants).map(([k,v])=>[k,createHash('sha256').update(v).digest('hex')])),records:[],errors:[],external:[]};
const checkpoint=()=>writeFile(output,JSON.stringify(result,null,2)+'\n');
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  res.setHeader('Cache-Control','no-store');
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Calibration development probe</title>');return;}
  const path=resolve(root,pathname.slice(1));assert.ok(path.startsWith(root+'/'));
  res.setHeader('Content-Type',({'.js':'text/javascript','.wasm':'application/wasm'})[extname(path)]??'application/octet-stream');
  res.end(pathname==='/src/processing/scheduler.js'?variants[variant]:await readFile(path));
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true}),context=await browser.newContext();
await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){result.external.push(route.request().url());return route.abort();}return route.continue();});
async function page(){const p=await context.newPage();p.on('pageerror',e=>result.errors.push(e.message));await p.goto(origin);await p.evaluate(async()=>{window.bench=await import('/scripts/migration/collection-page.js');});return p;}
async function run(name,concurrency,phase,sample){
 variant=name;const p=await page();const record={variant:name,concurrency,phase,sample,status:'running'};result.records.push(record);await checkpoint();
 try{
  await p.evaluate(async c=>{await bench.reopen();bench.configure(c);const pool=(await import('/src/processing/client.js')).getProcessingScheduler(),original=pool.record.bind(pool);window.calibrationTrace=[];pool.record=task=>{const point={at:performance.now(),workClass:task.workClass,startedAt:task.startedAt,startedLimit:task.startedLimit,limitBefore:pool.limit,queued:pool.queue.length};original(task);point.limitAfter=pool.limit;window.calibrationTrace.push(point);};},concurrency);
  record.job=await p.evaluate(input=>bench.run(input),input);
  record.trace=await p.evaluate(()=>window.calibrationTrace);
  record.verification=await p.evaluate(({input,job,reference})=>bench.verify(input,job,{reference}),{input,job:record.job,reference:phase==='reference'});
  record.status='pass';await p.evaluate(id=>bench.cleanup(id),record.job.jobId);
 }catch(e){record.status='fail';record.error=e.message;throw e;}finally{await p.close();await checkpoint();}
 console.log(`${name}/${concurrency??'Auto'} ${phase} ${sample}: ${record.status} ${record.job.elapsedMs.toFixed(1)} ms`);
}
try{
 const p=await page();result.device=await p.evaluate(()=>bench.device());result.browser=browser.version();await p.evaluate(input=>bench.install(input),input);await p.close();
 await run('baseline',1,'reference',0);
 const orders=[[['baseline',null],['half',null],['baseline',8]],[['baseline',8],['half',null],['baseline',null]],[['half',null],['baseline',null],['baseline',8]]];
 for(let i=0;i<orders.length;i++)for(const [name,c]of orders[i])await run(name,c,'development',i);
}finally{await checkpoint();await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
