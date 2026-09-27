import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";

export async function assertStagedScenes(browser,origin){
 const context=await browser.newContext({viewport:{width:375,height:667},isMobile:true,hasTouch:true});
 // These cases control quota by replacing estimate() below. Some WebKit
 // persistent contexts omit StorageManager entirely, so supply the estimate
 // capability for this staged-workflow test; the native storage probe runs
 // separately, and the app still feature-gates browser output on this API.
 await context.addInitScript(()=>{
  if(typeof navigator.storage?.estimate==="function")return;
  Object.defineProperty(navigator,"storage",{configurable:true,value:{estimate:async()=>({quota:512*1024*1024,usage:0})}});
 });
 const page=await context.newPage(),errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 const install=()=>page.evaluate(async()=>{
  const client=await import("./src/jobs/scene-client.js"),store=await import("./src/jobs/store.js"),storage=await import("./src/project/storage.js");
  const {acquireJobOwnership}=await import("./src/jobs/ownership.js"),{getProcessingScheduler}=await import("./src/processing/client.js"),{prepareStagedFiles}=await import("./src/jobs/staged-export.js"),{digestBytes}=await import("./src/jobs/output.js");
  window.h={client,store,storage,acquireJobOwnership,pool:getProcessingScheduler(),prepareStagedFiles,digestBytes};
  h.outputs=async id=>{
   const entries=await store.getManifestPage(id,0,32),rows=[];
   for(const entry of entries.filter(value=>value.status==="completed")){
    const {record}=await store.readStagedSceneOutput(id,entry.index),bytes=await record.blob.arrayBuffer(),image=await createImageBitmap(record.blob);
    rows.push({index:entry.index,hash:await digestBytes(bytes),dimensions:[image.width,image.height]});image.close();
   }return rows;
  };
 });
 try{
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector("#engine-status").textContent==="Ready");await install();
  const references=await page.evaluate(async()=>{
   const {createPhotoStory}=await import("./src/story/recipes.js"),{createPillowEngine}=await import("./src/engine/pillow.js"),{planStoryExports}=await import("./src/story/export-plan.js"),{planScene}=await import("./src/compositor/scene-spec.js");
   const sources=new Map(),assets=[],projects=[],refs={png:[],jpeg:[]},engine=await createPillowEngine();
   for(let i=0;i<6;i++){
    const canvas=new OffscreenCanvas(96,64),ctx=canvas.getContext("2d");ctx.fillStyle=`hsl(${i*51},60%,55%)`;ctx.fillRect(0,0,96,64);ctx.fillStyle="#372547";ctx.fillRect(i*6,12,35,40);
    const blob=await canvas.convertToBlob(),id=`photo-${i}`;sources.set(id,blob);assets.push({id,kind:"image",name:`${i}.png`,type:"image/png",width:96,height:64,orientation:"upright",byteLength:blob.size,sha256:await h.digestBytes(await blob.arrayBuffer())});
   }
   for(let n=0;n<2;n++){
    const project=createPhotoStory(assets,{title:`Staged story ${n}`,lookId:n?"film-diary":"scrapbook"});project.variants=[{id:"portrait",width:216,height:270},{id:"tall",width:216,height:384}];
    await h.storage.writeStoryProject(project,{readAsset:id=>sources.get(id)});projects.push(project);
    for(const format of ["png","jpeg"])for(const item of planStoryExports(project,{variants:["portrait","tall"],format}).items){
     const packets=[];for(const asset of planScene(project,item.slideId,item.variantId).assets)packets.push({id:asset.id,bytes:await sources.get(asset.id).arrayBuffer()});
     const output=await engine.renderSlide({project,slideId:item.slideId,variantId:item.variantId,format,assets:packets});refs[format].push({index:refs[format].length,hash:await h.digestBytes(output.bytes),dimensions:[output.width,output.height]});
    }
   }
   h.selection=projects.map(project=>({key:`story:${project.id}`,revision:project.revision,byteLength:Object.values(project.assets).reduce((sum,a)=>sum+a.byteLength,0)}));
   h.setup=async(id,format="png")=>{const job=await h.client.createSceneCollection({id,selection:h.selection,variants:["portrait","tall"],format,outputMode:"browser"}),lock=await h.acquireJobOwnership(id);return {job,lock};};
   return refs;
  });
  const low=await page.evaluate(async()=>{
   const {job,lock}=await h.setup("low-storage"),original=navigator.storage.estimate.bind(navigator.storage);let stopped=false;
   navigator.storage.estimate=async()=>({quota:1024,usage:0});
   try{await h.client.prepareSceneCollection(job.id,lock.owner);}catch(error){stopped=error.code==="STORAGE_FULL";}finally{navigator.storage.estimate=original;}
   const saved=await h.store.getLargeJob(job.id);await h.store.deleteLargeJob(job.id,lock.owner);await lock.release();
   return {stopped,groups:saved.preparedGroups,bytes:saved.snapshotBytes,reserved:Boolean(saved.staging)};
  });assert.deepEqual(low,{stopped:true,groups:0,bytes:0,reserved:false});
  const runs=[];
  const cpuBudget=await page.evaluate(()=>h.pool.budget.cpu);
  for(const [requested,format] of [[1,"png"],[4,"jpeg"],[8,"png"]]){
   const workers=Math.min(requested,cpuBudget);
   const result=await page.evaluate(async({workers,requested,format})=>{
    const {job,lock}=await h.setup(`staged-${requested}`,format);await h.client.prepareSceneCollection(job.id,lock.owner);h.pool.configure({fixedConcurrency:workers});
    let peak=0,violations=0;const off=h.pool.subscribe(s=>{peak=Math.max(peak,s.active);if(s.active>workers||s.estimatedBytes>s.memoryBudget)violations++;});
    const saved=await h.client.runSceneCollection(job.id,lock.owner);off();const outputs=await h.outputs(job.id);await lock.release();
    return {peak,violations,completed:saved.completed,remainingReservation:saved.staging.totalBytes-saved.stagingSpent,outputs};
   },{workers,requested,format});
   assert.equal(result.peak,workers);assert.equal(result.violations,0);assert.equal(result.completed,16);assert.equal(result.remainingReservation,0);assert.deepEqual(result.outputs,references[format]);runs.push({requested,workers,format,peak:result.peak,checked:16});
  }
  const reservations=await page.evaluate(async()=>{
   const source=await h.store.getLargeJob("staged-1"),a=await h.setup("reserve-a"),b=await h.setup("reserve-b"),original=navigator.storage.estimate.bind(navigator.storage);
   navigator.storage.estimate=async()=>({usage:0,quota:source.staging.totalBytes+16*1024*1024+1});
   let result;try{result=await Promise.allSettled([a,b].map(value=>h.store.reserveBrowserStaging(value.job.id,source.staging.groups,value.lock.owner)));}finally{navigator.storage.estimate=original;}
   for(const item of [a,b]){await h.store.deleteLargeJob(item.job.id,item.lock.owner);await item.lock.release();}
   return result.map(value=>value.status).sort();
  });assert.deepEqual(reservations,["fulfilled","rejected"]);
  const atomic=await page.evaluate(async()=>{
   const {job,lock}=await h.setup("quota-atomic");await h.client.prepareSceneCollection(job.id,lock.owner);await h.store.patchLargeJob(job.id,{status:"running"},lock.owner);
   const [entry]=await h.store.claimPendingEntries(job.id,1,lock.owner),source=await h.store.readStagedSceneOutput("staged-1",0),saved=await h.store.getLargeJob(job.id);
   const original=IDBObjectStore.prototype.put;let failed=false;
   IDBObjectStore.prototype.put=function(value,...rest){if(this.name==="entries"&&value.status==="completed")throw new DOMException("Injected quota failure","QuotaExceededError");return original.call(this,value,...rest);};
   try{await h.store.commitStagedSceneOutput(job.id,entry.index,entry.claimId,{blob:source.record.blob,outputBytes:source.record.blob.size,outputDigest:source.record.digest,outputPath:entry.relativePath,sourceDigest:entry.groupDigest,recipeSha256:saved.renderContract.recipeSha256,width:216,height:270,format:"png"},lock.owner);}catch(error){failed=error.name==="QuotaExceededError";}finally{IDBObjectStore.prototype.put=original;}
   const db=await h.store.openLargeJobDatabase(),tx=db.transaction(["scene-outputs"]),orphan=await new Promise((resolve,reject)=>{const r=tx.objectStore("scene-outputs").get([job.id,entry.index]);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const rolledBack=!(await h.store.getLargeJob(job.id)).completed&&!orphan;
   const completed=await h.client.runSceneCollection(job.id,lock.owner);await lock.release();return {failed,rolledBack,retried:completed.completed===16};
  });assert.deepEqual(atomic,{failed:true,rolledBack:true,retried:true});
  const pressure=await page.evaluate(async()=>{
   const {job,lock}=await h.setup("storage-stop");await h.client.prepareSceneCollection(job.id,lock.owner);h.pool.configure({fixedConcurrency:1});
   const original=navigator.storage.estimate.bind(navigator.storage);let stopped=false;
   try{await h.client.runSceneCollection(job.id,lock.owner,{changed:job=>{if(job.completed>=1)navigator.storage.estimate=async()=>({quota:1024,usage:0});}});}catch(error){stopped=error.code==="STORAGE_FULL";}finally{navigator.storage.estimate=original;}
   const saved=await h.store.getLargeJob(job.id);await lock.release();return {stopped,completed:saved.completed,failed:saved.failed,status:saved.status};
  });assert.equal(pressure.stopped,true);assert.ok(pressure.completed>=1&&pressure.completed<16);assert.equal(pressure.failed,0);assert.equal(pressure.status,"paused");
  const windowed=await page.evaluate(async()=>{
   const first=await h.prepareStagedFiles("staged-1"),a={count:first.files.length,next:first.next,indices:first.indices};first.dispose();
   const second=await h.prepareStagedFiles("staged-1",a.next),b={count:second.files.length,more:second.hasMore,indices:second.indices};second.dispose();return {a,b};
  });assert.deepEqual(windowed,{a:{count:8,next:8,indices:[0,1,2,3,4,5,6,7]},b:{count:8,more:false,indices:[8,9,10,11,12,13,14,15]}});
  const corrupted=await page.evaluate(async()=>{
   const {record}=await h.store.readStagedSceneOutput("staged-8",0),data=new Uint8Array(await record.blob.arrayBuffer());data[0]^=1;
   const write=async value=>{const db=await h.store.openLargeJobDatabase(),tx=db.transaction("scene-outputs","readwrite");tx.objectStore("scene-outputs").put(value);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});};
   await write({...record,blob:new Blob([data],{type:record.blob.type})});let rejected=false;
   try{await h.prepareStagedFiles("staged-8");}catch(error){rejected=error.message.includes("missing or changed");}finally{data[0]^=1;await write({...record,blob:new Blob([data],{type:record.blob.type})});}
   return {rejected,retained:h.pool.retainedBytes()};
  });assert.deepEqual(corrupted,{rejected:true,retained:0});
  // Retained-byte admission must defer the first Blob read while another tab
  // owns the origin budget. This is ledger evidence, not an RSS measurement.
  const other=await context.newPage();await other.goto(origin);await other.waitForFunction(()=>document.querySelector("#engine-status").textContent==="Ready");
  await other.evaluate(async()=>{const {getProcessingScheduler}=await import("./src/processing/client.js");window.pool=getProcessingScheduler();pool.releaseIdle();pool.budget.memory=128*1024*1024;pool.setRetainedBytes("other-tab",pool.budget.memory);await pool.admission.publish();});
  await page.evaluate(()=>{
   h.pool.releaseIdle();h.pool.budget.memory=128*1024*1024;h.reads=0;h.get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(...args){if(this.name==="scene-outputs")h.reads++;return h.get.apply(this,args);};
   h.waiting=h.prepareStagedFiles("staged-1").then(group=>{h.prepared=group;return true;});
  });
  await page.waitForFunction(()=>h.pool.admission.snapshot().waiting);assert.equal(await page.evaluate(()=>h.reads),0);
  await other.evaluate(async()=>{pool.setRetainedBytes("other-tab",0);await pool.admission.publish();});
  await page.evaluate(async()=>{await h.waiting;h.prepared.dispose();IDBObjectStore.prototype.get=h.get;h.pool.budget.memory=512*1024*1024;});await other.close();
  // Actual fallback UI, prepared download event and gesture-bound sharing.
  await page.evaluate(async()=>{Object.defineProperty(globalThis,"showDirectoryPicker",{value:undefined,configurable:true});window.__tinystarDirectoryPicker=undefined;const {openStoryBatchPanel}=await import("./src/story/batch-panel.js");await openStoryBatchPanel();});
  const sheet=page.locator("#story-batch-sheet");await sheet.locator("fieldset input").first().check();await sheet.locator("fieldset input").nth(1).check();
  assert.equal(await sheet.getByLabel("Batch destination").inputValue(),"browser");
  await sheet.getByRole("button",{name:"Copy stories for download or share",exact:true}).click();await page.waitForFunction(()=>document.querySelector("[data-batch-summary]")?.textContent.includes("16 planned files"));
  await sheet.getByRole("button",{name:"Prepare batch files",exact:true}).click();await page.waitForFunction(()=>document.querySelector("[data-batch-summary]")?.textContent.includes("16 ready in this browser"));
  await page.evaluate(()=>{Object.defineProperty(navigator,"canShare",{configurable:true,value:()=>true});Object.defineProperty(navigator,"share",{configurable:true,value:({files})=>{h.shared={active:navigator.userActivation.isActive,count:files.length};return new Promise(resolve=>{h.finishShare=resolve;});}});});
  await sheet.getByRole("button",{name:"Prepare from beginning",exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll(".story-staged-exports a[download]").length===8);
  const screenshots=process.env.TINYSTAR_STAGING_SCREENSHOTS;
  await sheet.locator(".story-staged-exports h3").scrollIntoViewIfNeeded();
  if(screenshots){await mkdir(screenshots,{recursive:true});await page.screenshot({path:`${screenshots}/staged-files-phone.png`});}
  await page.evaluate(()=>{document.documentElement.style.fontSize="200%";});
  assert.equal(await sheet.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
  await sheet.locator(".story-staged-exports h3").scrollIntoViewIfNeeded();
  if(screenshots)await page.screenshot({path:`${screenshots}/staged-files-phone-200.png`});
  await page.evaluate(()=>{document.documentElement.style.fontSize="";});
  const download=page.waitForEvent("download");await sheet.locator(".story-staged-exports a[download]").first().click();await download;
  await sheet.getByRole("button",{name:"Share 8 ready files",exact:true}).click();assert.deepEqual(await page.evaluate(()=>h.shared),{active:true,count:8});
  await page.goBack();await page.waitForFunction(()=>!document.querySelector("#story-batch-sheet"));
  assert.ok(await page.evaluate(()=>h.pool.retainedBytes())>0);await page.evaluate(()=>h.finishShare());await page.waitForFunction(()=>h.pool.retainedBytes()===0);
  await page.evaluate(async()=>{await h.storage.clearStoryProjects();h.pool.releaseIdle();});
  await page.reload();await page.waitForFunction(()=>document.querySelector("#engine-status").textContent==="Ready");await install();
  const resumed=await page.evaluate(async()=>{const lock=await h.acquireJobOwnership("storage-stop"),saved=await h.client.runSceneCollection("storage-stop",lock.owner),outputs=await h.outputs(saved.id);await lock.release();return {completed:saved.completed,outputs,library:(await h.storage.listStoryProjects()).length};});
  assert.equal(resumed.completed,16);assert.equal(resumed.library,0);assert.deepEqual(resumed.outputs,references.png);
  const cleanup=await page.evaluate(async()=>{const lock=await h.acquireJobOwnership("staged-1"),group=await h.prepareStagedFiles("staged-1");await h.store.deleteLargeJob("staged-1",lock.owner);await lock.release();let missing=false;try{await h.store.readStagedSceneOutput("staged-1",0);}catch{missing=true;}const usable=await createImageBitmap(group.files[0]);usable.close();group.dispose();return {missing,retained:h.pool.retainedBytes()};});assert.deepEqual(cleanup,{missing:true,retained:0});
  assert.deepEqual(errors,[]);console.log(`staged scene observations: ${JSON.stringify({cpuBudget,runs,outputs:48,lowStorage:true,atomicQuota:true,storagePause:true,preservedOnStoragePause:pressure.completed,reservations:true,corruptOutput:true,windowed:true,crossTabAdmission:true,phoneCreate:true,download:true,shareActivation:true,shareLifetime:true,browserBack:true,text200:true,reloadWithoutLibrary:true,cleanup:true})}`);
 }finally{await context.close();}
}
