import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

export async function assertStoryExports(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    Object.defineProperty(navigator,"canShare",{configurable:true,value:({files})=>Boolean(files?.length)});
    Object.defineProperty(navigator,"share",{configurable:true,value:async({files})=>{window.sharedExports={active:navigator.userActivation.isActive,names:files.map(file=>file.name)};}});
  });
  const page=await context.newPage(), errors=[], external=[];
  page.on("pageerror",error=>errors.push(error.message));
  context.on("request",request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==new URL(origin).origin)external.push(request.url());});
  const button=name=>page.getByRole("button",{name,exact:true});
  const rows=()=>page.locator(".story-exports li");
  const ready=()=>page.waitForFunction(()=>document.querySelector("#story-preview")?.naturalWidth>0&&!document.querySelector("#story-export").disabled);
  const outputs=()=>page.locator(".story-exports a").evaluateAll(async links=>Promise.all(links.map(async link=>{
    const bytes=await(await fetch(link.href)).arrayBuffer(),image=await createImageBitmap(new Blob([bytes]));
    const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
    const value={key:link.closest("li").dataset.exportKey,url:link.href,name:link.download,hash,bytes:bytes.byteLength,width:image.width,height:image.height};image.close();return value;
  })));
  try {
    await page.goto(origin);await page.waitForFunction(()=>document.querySelector("#engine-status").textContent==="Ready");
    const fixture=await page.evaluate(async()=>{
      const {createPhotoStory}=await import("./src/story/recipes.js"), {planStoryExports,StoryExportBatch}=await import("./src/story/export-plan.js");
      const {createPillowEngine}=await import("./src/engine/pillow.js"), {planScene}=await import("./src/compositor/scene-spec.js");
      const {writeStoryProject}=await import("./src/project/storage.js"), {getProcessingScheduler}=await import("./src/processing/client.js"), {enqueueScene}=await import("./src/processing/scene-client.js");
      const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
      const sources=new Map(),assets=[];
      for(let index=0;index<6;index++){
        const canvas=new OffscreenCanvas(index%2?180:240,index%2?240:180),ctx=canvas.getContext("2d");
        ctx.fillStyle=["#dc8e63","#739cbb","#afbe88","#b78ea7","#cbaa5f","#86aaa0"][index];ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle="#313b51";ctx.fillRect(index*7+12,30,75,110);ctx.fillStyle="#ffe8b3";ctx.beginPath();ctx.arc(canvas.width*.7,canvas.height*.3,27,0,Math.PI*2);ctx.fill();
        const blob=await canvas.convertToBlob(),bytes=await blob.arrayBuffer(),id=`export-photo-${index}`;sources.set(id,blob);
        assets.push({id,kind:"image",name:`${index}.png`,type:"image/png",width:canvas.width,height:canvas.height,byteLength:blob.size,sha256:await hash(bytes),orientation:"upright"});
      }
      const project=createPhotoStory(assets,{title:"Export weekend"}),first=project.slides[0].nodeIds.find(id=>project.nodes[id].kind==="image");
      project.nodes[first].crop={x:.1,y:.1,width:.8,height:.8};project.nodes[first].appearance={brightness:.9};
      project.nodes[`${project.slides[0].id}:caption`].text="Keep these words";
      const engine=await createPillowEngine(),serial=async plan=>{
        const references={};
        for(const item of plan.items){
          const packets=await Promise.all(planScene(plan.project,item.slideId,item.variantId).assets.map(async asset=>({id:asset.id,bytes:await sources.get(asset.id).arrayBuffer()})));
          const result=await engine.renderSlide({project:plan.project,slideId:item.slideId,variantId:item.variantId,format:plan.format,assets:packets});
          references[item.key]=await hash(result.bytes);
        }
        return references;
      };
      const smaller=structuredClone(project);smaller.variants=[{id:"portrait",width:432,height:540},{id:"tall",width:432,height:768}];
      const plan=planStoryExports(smaller,{variants:["portrait","tall"],format:"png"}),reference=await serial(plan),pool=getProcessingScheduler(),runs=[];
      for(const concurrency of [1,2,4,8].filter(value=>value<=pool.budget.cpu)){
        pool.configure({fixedConcurrency:concurrency});let peak=0,violations=0;
        const stop=pool.subscribe(state=>{peak=Math.max(peak,state.active);if(state.active>concurrency||state.estimatedBytes>state.memoryBudget)violations++;});
        const batch=new StoryExportBatch(plan,{render:(item,{signal})=>enqueueScene({project:plan.project,slideId:item.slideId,variantId:item.variantId,format:"png",signal,readAsset:id=>sources.get(id)}).promise});
        await batch.start();stop();const hashes=await Promise.all(batch.records.map(async record=>({key:record.item.key,status:record.status,hash:record.value?await hash(record.value.output):null,error:record.error})));
        runs.push({concurrency,peak,violations,hashes});batch.dispose();
      }
      const expected=await serial(planStoryExports(project,{variants:["portrait","tall"],format:"png"}));
      await writeStoryProject(project,{readAsset:id=>sources.get(id)});pool.close();
      return {expected,reference,runs,project};
    });
    for(const run of fixture.runs){assert.equal(run.peak,run.concurrency);assert.equal(run.violations,0);for(const output of run.hashes){assert.equal(output.status,"ready",output.error);assert.equal(output.hash,fixture.reference[output.key]);}}
    await page.reload();await page.locator("#empty-story-button").click();await button("Export weekend").click();await ready();
    await page.locator("#story-export").click();
    assert.match(await page.locator("[data-export-summary]").innerText(),/^4 files/);
    await page.getByLabel("Story export shapes",{exact:true}).selectOption("both");await page.getByLabel("Story export format",{exact:true}).selectOption("png");
    assert.match(await page.locator("[data-export-summary]").innerText(),/^8 files.*4 slides × 2 shapes/);
    await page.evaluate(async()=>{
      const pool=(await import("./src/processing/client.js")).getProcessingScheduler(),original=pool.enqueue;
      window.exportCalls=[];window.exportPrepared=[];window.restoreExportQueue=()=>{pool.enqueue=original;};
      pool.enqueue=function(request){
        if(!request.workClass?.startsWith("scene:png:export:"))return original.call(this,request);
        exportCalls.push(request.workClass);if(exportCalls.length===2)throw new Error("Injected one-output admission failure");
        const prepare=request.prepare;return original.call(this,{...request,prepare:async()=>{const value=await prepare();exportPrepared.push(`${value.message.request.variantId}:${value.message.request.slideId}`);return value;}});
      };
    });
    await button("Prepare files").click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-export-status="ready"]').length===7&&document.querySelectorAll('[data-export-status="failed"]').length===1);
    await button("Retry 1 failed").waitFor();const partial=await outputs();assert.equal(partial.length,7);
    for(const output of partial)assert.equal(output.hash,fixture.expected[output.key]);
    await page.getByLabel("Only items needing attention",{exact:true}).check();assert.equal(await rows().filter({visible:true}).count(),1);
    await button("Retry 1 failed").click();await page.waitForFunction(()=>document.querySelectorAll('[data-export-status="ready"]').length===8);
    assert.match(await page.locator("[data-export-progress]").innerText(),/8 files ready/);
    assert.equal(await rows().filter({visible:true}).count(),0);await page.getByLabel("Only items needing attention",{exact:true}).uncheck();
    const complete=await outputs();assert.equal(complete.length,8);
    assert.deepEqual(complete.map(item=>item.name),["portrait","tall"].flatMap(shape=>[1,2,3,4].map(index=>`export-weekend-${shape}-0${index}.png`)));
    for(const output of complete){assert.equal(output.hash,fixture.expected[output.key]);assert.deepEqual([output.width,output.height],[1080,output.key.startsWith("portrait:")?1350:1920]);}
    assert.ok(partial.every(item=>complete.find(next=>next.key===item.key).url===item.url),"successful outputs retain their original handles after retry");
    assert.deepEqual(await page.evaluate(()=>({calls:exportCalls.length,prepared:exportPrepared.length,unique:new Set(exportPrepared).size})),{calls:9,prepared:8,unique:8});
    await page.evaluate(()=>restoreExportQueue());
    await button("Share all files").click();assert.deepEqual(await page.evaluate(()=>sharedExports),{active:true,names:complete.map(item=>item.name)});
    const download=page.waitForEvent("download");await page.locator(".story-exports a").first().click();assert.equal((await download).suggestedFilename(),complete[0].name);

    await page.evaluate(()=>{document.documentElement.style.fontSize="32px";});
    assert.equal(await page.locator("#story-sheet").evaluate(element=>element.scrollWidth<=element.clientWidth),true,"200% text fits the phone export sheet");
    assert.ok(await page.getByLabel("Story export shapes",{exact:true}).evaluate(element=>element.getBoundingClientRect().height>=44));
    if(process.env.TINY_IMAGE_STAR_EXPORT_ARTIFACTS){await mkdir(process.env.TINY_IMAGE_STAR_EXPORT_ARTIFACTS,{recursive:true});await page.locator("#story-sheet").evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:`${process.env.TINY_IMAGE_STAR_EXPORT_ARTIFACTS}/exports-phone-200.png`});}
    await page.evaluate(()=>{document.documentElement.style.fontSize="";});
    if(process.env.TINY_IMAGE_STAR_EXPORT_ARTIFACTS){await page.locator("#story-sheet").evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:`${process.env.TINY_IMAGE_STAR_EXPORT_ARTIFACTS}/exports-phone.png`});}

    // Delay real preparation after the first output, then cancel admission.
    // Pausing must retain the first file and continue only the seven unfinished.
    await page.getByLabel("Story export format",{exact:true}).selectOption("jpeg");await page.getByLabel("Story export format",{exact:true}).selectOption("png");
    assert.equal(await page.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},complete[0].url),true,"changing export choices releases earlier files");
    await page.evaluate(async()=>{
      const pool=(await import("./src/processing/client.js")).getProcessingScheduler(),original=pool.enqueue;pool.configure({fixedConcurrency:1});let count=0;
      window.restoreExportQueue=()=>{pool.enqueue=original;};window.delayedExports=0;
      pool.enqueue=function(request){
        if(!request.workClass?.startsWith("scene:png:export:"))return original.call(this,request);
        const order=count++,prepare=request.prepare;
        return original.call(this,{...request,prepare:async()=>{
          if(order>0){delayedExports++;await new Promise((_,reject)=>{const stop=()=>reject(new DOMException("Paused","AbortError"));request.signal.addEventListener("abort",stop,{once:true});if(request.signal.aborted)stop();});}
          return prepare();
        }});
      };
    });
    await button("Prepare files").click();await page.waitForFunction(()=>document.querySelectorAll('[data-export-status="ready"]').length===1&&window.delayedExports>0);
    const kept=(await outputs())[0];await button("Pause").click();await page.waitForFunction(()=>document.querySelectorAll('[data-export-status="pending"]').length===7);
    assert.equal(await page.locator('[data-export-status="failed"]').count(),0);await page.evaluate(()=>restoreExportQueue());
    await button("Continue preparing").click();await page.waitForFunction(()=>document.querySelectorAll('[data-export-status="ready"]').length===8);
    const continued=await outputs();assert.equal(continued.find(item=>item.key===kept.key).url,kept.url);for(const output of continued)assert.equal(output.hash,fixture.expected[output.key]);
    await page.evaluate(async()=>{
      window.sharePool=(await import("./src/processing/client.js")).getProcessingScheduler();const original=navigator.share;
      window.restoreShare=()=>Object.defineProperty(navigator,"share",{configurable:true,value:original});
      Object.defineProperty(navigator,"share",{configurable:true,value:()=>new Promise(resolve=>{window.finishHeldShare=resolve;})});
    });
    await button("Share all files").click();
    const sharedBytes=continued.reduce((sum,item)=>sum+item.bytes,0);
    assert.deepEqual(await page.evaluate(()=>[...sharePool.retained].filter(([key])=>key.startsWith("story-share:")).map(([,bytes])=>bytes)),[sharedBytes]);
    await page.locator("#story-sheet-cancel").click();await page.waitForFunction(()=>document.querySelector("#story-status").textContent==="Saved on this device");
    assert.deepEqual(await page.evaluate(()=>[...sharePool.retained].filter(([key])=>key.startsWith("story-share:")).map(([,bytes])=>bytes)),[sharedBytes],"a pending share retains its own file budget after panel disposal");
    await page.evaluate(()=>{finishHeldShare();restoreShare();});await page.waitForFunction(()=>![...sharePool.retained.keys()].some(key=>key.startsWith("story-share:")));
    const stored=await page.evaluate(async()=>{const store=await import("./src/project/storage.js"),[entry]=await store.listStoryProjects();return(await store.readStoryProject(entry.key)).project;});
    assert.deepEqual(stored.recipe.outputVariants,["portrait","tall"]);assert.equal(stored.recipe.outputVariant,"portrait");
    assert.deepEqual(stored.nodes,fixture.project.nodes);assert.deepEqual(stored.slides,fixture.project.slides);
    assert.equal(await page.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},kept.url),true,"closing releases prepared output URLs");

    await page.locator('[data-story-tool="look"]').click();await button("Save my style").click();await page.getByLabel("Style name",{exact:true}).fill("Both sizes");
    await page.getByLabel("Include Look",{exact:true}).uncheck();await page.getByLabel("Include Text style",{exact:true}).uncheck();await page.getByLabel("Include Output",{exact:true}).check();await button("Save style").click();
    await page.locator("[data-style-key]").filter({hasText:"Both sizes"}).waitFor();await page.locator("#story-sheet-cancel").click();await ready();
    const savedStyle=await page.evaluate(async()=>{const library=await(await import("./src/styles/store.js")).readStyleLibrary();return library.records.find(record=>record.style.name==="Both sizes").style;});
    assert.deepEqual(savedStyle.components.output.variants,["portrait","tall"]);assert.ok(savedStyle.requires.includes("export-variants-v1"));assert.deepEqual(Object.keys(savedStyle.components),["output"]);
    await page.locator("#story-export").click();await page.getByLabel("Story export shapes",{exact:true}).selectOption("tall");await page.locator("#story-sheet-cancel").click();await ready();
    await page.locator('[data-story-tool="look"]').click();await page.getByRole("navigation",{name:"Style library",exact:true}).getByRole("button",{name:"Saved",exact:true}).click();
    await page.locator("[data-style-key]").filter({hasText:"Both sizes"}).click();await page.waitForFunction(()=>!document.querySelector("#story-sheet-apply").disabled);await page.locator("#story-sheet-apply").click();await ready();
    await page.waitForFunction(()=>document.querySelector("#story-status").textContent==="Saved on this device");
    await page.reload();await page.locator("#empty-story-button").click();await button("Export weekend").click();await ready();await page.locator("#story-export").click();
    assert.equal(await page.getByLabel("Story export shapes",{exact:true}).inputValue(),"both");assert.equal(await page.getByLabel("Story export format",{exact:true}).inputValue(),"png");
    assert.match(await page.locator("[data-export-summary]").innerText(),/^8 files/);assert.equal(await page.locator(".story-exports a").count(),0);
    await page.evaluate(async()=>{
      const pool=(await import("./src/processing/client.js")).getProcessingScheduler(),original=pool.enqueue;
      window.exportClosingPool=pool;window.closingPreparation=false;window.restoreExportQueue=()=>{pool.enqueue=original;};
      pool.enqueue=function(request){
        if(!request.workClass?.startsWith("scene:png:export:"))return original.call(this,request);
        return original.call(this,{...request,prepare:()=>{closingPreparation=true;return new Promise((_,reject)=>{const stop=()=>reject(new DOMException("Closed","AbortError"));request.signal.addEventListener("abort",stop,{once:true});if(request.signal.aborted)stop();});}});
      };
    });
    await button("Prepare files").click();await page.waitForFunction(()=>window.closingPreparation);
    await page.goBack();await page.waitForFunction(()=>!document.querySelector("#story-sheet").open);
    await page.waitForFunction(()=>window.exportClosingPool.snapshot().active===0&&window.exportClosingPool.snapshot().queued===0);
    await page.evaluate(()=>restoreExportQueue());assert.equal(await page.locator(".story-exports a").count(),0,"Back cannot resurrect an aborted output");
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log("story export observations: "+JSON.stringify({runs:fixture.runs.map(({concurrency,peak,violations,hashes})=>({concurrency,peak,violations,checked:hashes.length})),fullSizeOutputs:complete.length,retryPreserved:partial.length,pausePreserved:1,savedShapes:stored.recipe.outputVariants,sourceEditsUnchanged:true,reusableOutputStyle:true,activeBackCleanup:true,pendingShareRetained:true}));
    console.log("  story exports: both shapes, frozen ordered outputs, exact 1/4/8 references, partial failure and retry-only-failed, pause/continue, phone 200% text, native decode/download, activated share, saved choices and cleanup");
  } finally {await context.close();}
}
