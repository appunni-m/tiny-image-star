import assert from "node:assert/strict";
import {readFile,mkdir} from "node:fs/promises";

export async function assertSceneCollections(browser,origin){
  const context=await browser.newContext({viewport:{width:375,height:667},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  const install=async()=>page.evaluate(async()=>{
    const store=await import("./src/jobs/store.js"),client=await import("./src/jobs/scene-client.js"),storage=await import("./src/project/storage.js");
    const {acquireJobOwnership}=await import("./src/jobs/ownership.js"),{getProcessingScheduler}=await import("./src/processing/client.js");
    const {digestBytes}=await import("./src/jobs/output.js");
    window.h={store,client,storage,acquireJobOwnership,pool:getProcessingScheduler(),digestBytes};
    h.readOutputs=async(job,supplied)=>{
      const entries=supplied??await store.getManifestPage(job.id,0,100),rows=[];
      for(const entry of entries.filter(e=>e.status==="completed")){
        const parts=entry.outputPath.split("/"),name=parts.pop();let dir=job.outputHandle;for(const part of parts)dir=await dir.getDirectoryHandle(part);
        const file=await(await dir.getFileHandle(name)).getFile(),bytes=await file.arrayBuffer(),image=await createImageBitmap(file);
        rows.push({index:entry.index,hash:await digestBytes(bytes),lastModified:file.lastModified,dimensions:[image.width,image.height]});image.close();
      }return rows;
    };
  });
  try{
    await page.goto(origin);await page.waitForFunction(()=>document.querySelector("#engine-status").textContent==="Ready");await install();
    const font=Array.from(await readFile(new URL("fixtures/fonts/NotoSans.ttf",import.meta.url)));
    const fixture=await page.evaluate(async(font)=>{
      const {createPhotoStory}=await import("./src/story/recipes.js"),{createPillowEngine}=await import("./src/engine/pillow.js"),{planStoryExports}=await import("./src/story/export-plan.js"),{planScene}=await import("./src/compositor/scene-spec.js");
      const sources=new Map(),assets=[];
      for(let i=0;i<6;i++){
        const canvas=new OffscreenCanvas(i%2?90:120,i%2?120:90),ctx=canvas.getContext("2d");ctx.fillStyle=`hsl(${i*53},55%,60%)`;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle="#352640";ctx.fillRect(10+i*3,15,40,45);
        const blob=await canvas.convertToBlob(),id=`source-${i}`;sources.set(id,blob);assets.push({id,kind:"image",name:`${i}.png`,type:"image/png",width:canvas.width,height:canvas.height,byteLength:blob.size,sha256:await h.digestBytes(await blob.arrayBuffer()),orientation:"upright"});
      }
      const fontBlob=new Blob([new Uint8Array(font)],{type:"font/ttf"}),fontHash=await h.digestBytes(await fontBlob.arrayBuffer());sources.set("saved-font",fontBlob);
      const projects=[],references=[];const engine=await createPillowEngine();
      for(let i=0;i<2;i++){
        const project=createPhotoStory(assets,{title:"Same story name",lookId:i?"film-diary":"scrapbook"});project.variants=[{id:"portrait",width:216,height:270},{id:"tall",width:216,height:384}];
        project.assets["saved-font"]={id:"saved-font",kind:"font",name:"Noto Sans",type:"font/ttf",byteLength:fontBlob.size,sha256:fontHash,orientation:"upright"};
        for(const node of Object.values(project.nodes))if(node.kind==="text")node.fontId="saved-font";
        const first=Object.values(project.nodes).find(node=>node.kind==="image");first.crop={x:.1,y:.1,width:.8,height:.8};first.appearance={brightness:.9};if(i)first.cutoutEffects={schema:1,outline:{color:"#ffffff",width:.01}};
        await h.storage.writeStoryProject(project,{readAsset:id=>sources.get(id)});projects.push(project);
        const plan=planStoryExports(project,{variants:["portrait","tall"],format:"png"});
        for(const item of plan.items){const packets=[];for(const asset of planScene(project,item.slideId,item.variantId).assets)packets.push({id:asset.id,bytes:await sources.get(asset.id).arrayBuffer()});
          const result=await engine.renderSlide({project,slideId:item.slideId,variantId:item.variantId,format:"png",assets:packets});references.push({index:references.length,hash:await h.digestBytes(result.bytes),dimensions:[result.width,result.height]});}
      }
      h.selection=projects.map(project=>({key:`story:${project.id}`,revision:project.revision,byteLength:Object.values(project.assets).reduce((sum,asset)=>sum+asset.byteLength,0)}));
      h.setup=async id=>{
        const root=await navigator.storage.getDirectory(),job=await h.client.createSceneCollection({id,selection:h.selection,variants:["portrait","tall"],format:"png",outputBaseHandle:root});
        const lock=await h.acquireJobOwnership(id);return {job:await h.client.prepareSceneCollection(id,lock.owner),lock};
      };
      return {references,uniqueBytes:[...sources.values()].reduce((sum,blob)=>sum+blob.size,0)};
    },font);
    const quota=await page.evaluate(async()=>{
      const root=await navigator.storage.getDirectory(),job=await h.client.createSceneCollection({id:"atomic-copy",selection:h.selection,variants:["portrait","tall"],format:"png",outputBaseHandle:root}),lock=await h.acquireJobOwnership(job.id);
      const opened=await h.storage.readStoryProject(h.selection[0].key),{createSceneGroup}=await import("./src/jobs/scene-plan.js"),group=await createSceneGroup(opened.project,0,job.recipe.collection),records=[],seen=new Set();
      for(const asset of Object.values(group.project.assets))if(!seen.has(asset.sha256)){records.push({sha256:asset.sha256,blob:await opened.readAsset(asset.id)});seen.add(asset.sha256);}
      const original=IDBObjectStore.prototype.add;let failed=false;
      IDBObjectStore.prototype.add=function(...args){if(this.name==="scene-groups")throw new DOMException("Injected quota failure","QuotaExceededError");return original.apply(this,args);};
      try{await h.store.putSceneGroup(job.id,group,records,lock.owner);}catch{failed=true;}finally{IDBObjectStore.prototype.add=original;}
      const rolledBack=await h.store.getSceneGroup(job.id,0)===null&&await h.store.readSceneAsset(job.id,records[0].sha256)===null&&(await h.store.getLargeJob(job.id)).preparedGroups===0;
      const prepared=await h.client.prepareSceneCollection(job.id,lock.owner);await lock.release();return {failed,rolledBack,retried:prepared.discovered===16};
    });assert.deepEqual(quota,{failed:true,rolledBack:true,retried:true});
    await page.evaluate(async()=>{window.__tinystarDirectoryPicker=()=>navigator.storage.getDirectory();const {openStoryBatchPanel}=await import("./src/story/batch-panel.js");await openStoryBatchPanel();});
    const createSheet=page.locator("#story-batch-sheet");
    await createSheet.locator("fieldset input").first().check();await createSheet.locator("fieldset input").nth(1).check();
    await createSheet.getByLabel("Batch export format").selectOption("png");await createSheet.getByRole("button",{name:"Choose save folder and copy stories",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector("[data-batch-summary]")?.textContent.includes("16 planned files"));
    await createSheet.getByRole("button",{name:"Start saving",exact:true}).click();await page.waitForFunction(()=>document.querySelector("[data-batch-summary]")?.textContent.includes("16 saved"));
    await createSheet.getByRole("button",{name:"Done",exact:true}).click();await page.waitForFunction(()=>!document.querySelector("#story-batch-sheet"));
    const workerBudget=await page.evaluate(()=>h.pool.budget.cpu),runs=[];
    for(const workers of [1,2,4,8].filter(value=>value<=workerBudget)){
      const result=await page.evaluate(async workers=>{
        const {job,lock}=await h.setup(`concurrency-${workers}`);h.pool.configure({fixedConcurrency:workers});let peak=0,violations=0;
        const unsubscribe=h.pool.subscribe(s=>{peak=Math.max(peak,s.active);if(s.active>workers||s.estimatedBytes>s.memoryBudget)violations++;});
        const finished=await h.client.runSceneCollection(job.id,lock.owner);unsubscribe();const outputs=await h.readOutputs(finished);await lock.release();return {workers,peak,violations,completed:finished.completed,snapshotBytes:finished.snapshotBytes,outputs};
      },workers);
      assert.equal(result.peak,workers);assert.equal(result.violations,0);assert.equal(result.completed,16);assert.equal(result.snapshotBytes,fixture.uniqueBytes);
      assert.deepEqual(result.outputs.map(({lastModified,...row})=>row),fixture.references);runs.push({workers,peak:result.peak,violations:result.violations,checked:16});
    }
    const retry=await page.evaluate(async()=>{
      const {job,lock}=await h.setup("retry-collection"),enqueue=h.pool.enqueue.bind(h.pool);let failed=false;
      h.pool.enqueue=spec=>spec.kind==="folder"&&spec.workClass.startsWith("scene-folder")&&!failed?(failed=true,{promise:Promise.resolve({type:"error",message:"Injected output failure"})}):enqueue(spec);
      let saved=await h.client.runSceneCollection(job.id,lock.owner);h.pool.enqueue=enqueue;
      const before=await h.readOutputs(saved),failedCount=saved.failed;saved=await h.client.runSceneCollection(job.id,lock.owner,{retryFailed:true});const after=await h.readOutputs(saved);await lock.release();
      return {failedCount,completed:saved.completed,preserved:before.every(row=>after.some(item=>item.index===row.index&&item.hash===row.hash&&item.lastModified===row.lastModified))};
    });assert.deepEqual(retry,{failedCount:1,completed:16,preserved:true});

    await page.evaluate(async()=>{
      window.paused=await h.setup("resume-collection");h.pool.configure({fixedConcurrency:1});const controller=new AbortController();
      window.partial=await h.client.runSceneCollection(paused.job.id,paused.lock.owner,{signal:controller.signal,changed:job=>{if(job.completed>=1)controller.abort();}});
      window.keep=await h.readOutputs(partial);await h.storage.clearStoryProjects();await paused.lock.release();h.pool.releaseIdle();
    });
    const before=await page.evaluate(()=>({job:partial.id,completed:partial.completed,remaining:partial.discovered-partial.completed,kept:keep}));assert.ok(before.completed>=1&&before.remaining>0);
    await page.reload();await page.waitForFunction(()=>document.querySelector("#engine-status").textContent==="Ready");await install();
    const resumed=await page.evaluate(async()=>{
      const lock=await h.acquireJobOwnership("resume-collection"),saved=await h.client.runSceneCollection("resume-collection",lock.owner),outputs=await h.readOutputs(saved);await lock.release();
      return {completed:saved.completed,outputs,library:(await h.storage.listStoryProjects()).length};
    });assert.equal(resumed.library,0);assert.equal(resumed.completed,16);assert.deepEqual(resumed.outputs.map(({lastModified,...row})=>row),fixture.references);
    assert.ok(before.kept.every(row=>resumed.outputs.some(item=>item.index===row.index&&item.hash===row.hash&&item.lastModified===row.lastModified)));

    const isolation=await page.evaluate(async()=>{
      const id="concurrency-1",job=await h.store.getLargeJob(id),lock=await h.acquireJobOwnership(id),group=await h.store.getSceneGroup(id,0),asset=Object.values(group.project.assets)[0];
      let recipe=false,claim=false;try{await h.store.patchLargeJob(id,{recipe:{...job.recipe,name:"Changed"}},lock.owner);}catch{recipe=true;}
      try{await h.store.claimPendingEntries(id,1,{...lock.owner,epoch:0});}catch{claim=true;}
      const originalEntries=await h.store.getManifestPage(id,0,100);
      await h.store.deleteLargeJob(id,lock.owner);await lock.release();
      return {recipe,claim,groupRemoved:await h.store.getSceneGroup(id,0)===null,assetRemoved:await h.store.readSceneAsset(id,asset.sha256)===null,outputsKept:(await h.readOutputs(job,originalEntries)).length===16};
    });assert.deepEqual(isolation,{recipe:true,claim:true,groupRemoved:true,assetRemoved:true,outputsKept:true});

    await page.evaluate(async()=>{window.__tinystarDirectoryPicker=()=>navigator.storage.getDirectory();const {openStoryBatchPanel}=await import("./src/story/batch-panel.js");await openStoryBatchPanel();});
    const sheet=page.locator("#story-batch-sheet");await sheet.getByLabel("Saved story batches").selectOption("resume-collection");
    await page.waitForFunction(()=>document.querySelector("[data-batch-summary]")?.textContent.includes("16 saved"));
    await page.waitForFunction(()=>document.querySelectorAll("[data-batch-output]").length===16);
    const batchOutputs=sheet.locator(":scope > .story-sheet-content > .story-batch-outputs");
    assert.match(await batchOutputs.textContent(),/cutout effect needs a subject mask/);
    assert.equal(await sheet.getByLabel("Batch export format").inputValue(),"png");
    await sheet.getByLabel("Only failed outputs").check();await page.waitForFunction(()=>document.querySelector("#story-batch-sheet > .story-sheet-content > .story-batch-outputs")?.textContent.includes("No outputs need attention"));
    const screenshotRoot=process.env.TINY_IMAGE_STAR_SCENE_ARTIFACTS;
    if(screenshotRoot){await mkdir(screenshotRoot,{recursive:true});await page.screenshot({path:`${screenshotRoot}/scene-batch-phone.png`});}
    await page.evaluate(()=>{document.documentElement.style.fontSize="200%";});
    assert.equal(await sheet.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
    if(screenshotRoot)await page.screenshot({path:`${screenshotRoot}/scene-batch-phone-200.png`});
    await page.goBack();await page.waitForFunction(()=>!document.querySelector("#story-batch-sheet"));
    assert.deepEqual(errors,[]);
    console.log(`scene collection observations: ${JSON.stringify({runs,independentOutputs:48,retryPreserved:true,reloadWithoutLibrary:true,pausePreserved:before.completed,immutable:true,phoneReview:true,phoneCreate:true,quotaAtomic:true,renderWarningsVisible:true,browserBack:true})}`);
  }finally{await context.close();}
}
