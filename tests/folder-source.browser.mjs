import assert from "node:assert/strict";

export async function assertFolderSources(browser, origin) {
  const context = await browser.newContext();
  const errors = [];
  // Deliberately present a constant timestamp in both realms. Bytes still come
  // from actual OPFS files: this isolates same-size/same-time replacement from
  // the independently tested metadata checks without relying on OS timestamp APIs.
  const metadataShim = `const originalGetFile = FileSystemFileHandle.prototype.getFile;
    FileSystemFileHandle.prototype.getFile = async function () {
      const file = await originalGetFile.call(this);
      return this.name.startsWith('identity-') ? new File([file], file.name, { type: file.type, lastModified: 7 }) : file;
    };`;
  await context.route("**/__folder_source_test__", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Folder source identity verification</title>" }));
  await context.route("**/__folder_source_worker__.js", route => route.fulfill({ contentType: "text/javascript", body: `${metadataShim}\nawait import('./src/jobs/large-worker.js');` }));
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  const install = async () => {
    await page.goto(new URL("__folder_source_test__", origin).href);
    await page.evaluate(metadataShim);
    await page.evaluate(async () => {
      const store = await import("./src/jobs/store.js"), core = await import("./src/jobs/core.js");
      const { acquireJobOwnership } = await import("./src/jobs/ownership.js");
      const { createProcessingClient, getProcessingScheduler } = await import("./src/processing/client.js");
      const { digestBytes, saveJournaledOutput } = await import("./src/jobs/output.js");
      const { FOLDER_SOURCE_SCHEMA } = await import("./src/jobs/source-contract.js");
      const pool = getProcessingScheduler(), factory = pool.workerFactory;
      pool.workerFactory = kind => kind === "folder" ? new Worker("./__folder_source_worker__.js", { type: "module" }) : factory(kind);
      const root = await navigator.storage.getDirectory();
      const bmp = color => {
        const size = 64, stride = size * 3, bytes = new Uint8Array(54 + stride * size), view = new DataView(bytes.buffer);
        bytes.set([66,77]); view.setUint32(2, bytes.length, true); view.setUint32(10,54,true); view.setUint32(14,40,true);
        view.setInt32(18,size,true); view.setInt32(22,size,true); view.setUint16(26,1,true); view.setUint16(28,24,true);
        for (let p=54;p<bytes.length;p+=3) bytes.set(color,p);
        return bytes;
      };
      const bytesA = bmp([30,80,170]), bytesB = bmp([150,110,20]);
      const replace = async (job, index, bytes) => {
        const handle = await job.sourceHandle.getFileHandle(`identity-${index}.bmp`, { create: true });
        const writer = await handle.createWritable(); await writer.write(bytes); await writer.close(); return handle.getFile();
      };
      const setup = async (id, count = 1) => {
        const sourceHandle = await root.getDirectoryHandle(`${id}-source`, { create: true });
        const outputHandle = await root.getDirectoryHandle(`${id}-output`, { create: true });
        const recipe = { name: "Bound source", operations: { format: "png", brightness: 1.1, contrast: 1.05 } };
        let job = core.createLargeJob({ id, sourceHandle, recipe }); await store.putLargeJob(job);
        const lock = await acquireJobOwnership(id), entries = [];
        for (let index=0;index<count;index++) entries.push(core.createManifestEntry({ jobId:id,index,relativePath:`identity-${index}.bmp`,file:await replace(job,index,bytesA) }));
        await store.putManifestEntries(entries,lock.owner);
        job = await store.patchLargeJob(id,{ status:"running",scanComplete:true,discovered:count,outputHandle },lock.owner);
        return { job,lock,entries };
      };
      const start = (job, owner, entry, { forged = false, dimensions = false } = {}) => {
        const client = createProcessingClient({ kind:"folder" });
        const promise = new Promise((resolve,reject) => {
          const timer=setTimeout(()=>reject(new Error("Source identity job timed out")),30000);
          client.addEventListener("message",({data})=>{if(data.jobId===job.id&&data.index===entry.index&&["result","error"].includes(data.type)){clearTimeout(timer);resolve(data);}});
        });
        client.submit({ message:{ type:"process",jobId:job.id,owner,entry:forged?{...entry,relativePath:"identity-other.bmp",allowSourceChange:true,sourceIdentity:null}:entry,
          recipe:job.recipe,sourceRoot:forged?null:job.sourceHandle,outputRoot:job.outputHandle },
          source:{encodedBytes:entry.sourceBytes,...(dimensions?{width:64,height:64}:{})} });
        return { client, promise };
      };
      const run = async (job,owner,entry,options) => {
        const attempt=start(job,owner,entry,options);
        try {
          const message=await attempt.promise;
          if(message.type==="error") await store.commitManifestEntry(job.id,entry.index,entry.claimId,{status:"failed",error:message.message},owner);
          return message;
        } finally {attempt.client.terminate();}
      };
      window.h={store,core,acquireJobOwnership,pool,root,bytesA,bytesB,replace,setup,start,run,digestBytes,saveJournaledOutput,FOLDER_SOURCE_SCHEMA};
    });
  };
  try {
    await install();
    const outputs = await page.evaluate(async () => {
      const { createPillowEngine }=await import("./src/engine/pillow.js"), engine=await createPillowEngine();
      const runs=[];
      for(const workers of [1,4,8]) {
        const {job,lock}=await h.setup(`concurrent-${workers}`,9);h.pool.configure({fixedConcurrency:workers});
        const expected=await engine.render({name:"source.bmp",bytes:h.bytesA.buffer},h.core.settingsForLargeJob(job.recipe));
        const reference=await h.digestBytes(expected.bytes), claims=await h.store.claimPendingEntries(job.id,9,lock.owner);
        let peak=0,violations=0;const unsubscribe=h.pool.subscribe(s=>{peak=Math.max(peak,s.active);if(s.active>workers||s.estimatedBytes>s.memoryBudget)violations++;});
        const messages=await Promise.all(claims.map(entry=>h.run(job,lock.owner,entry))), hashes=[];
        for(const message of messages) {
          if(message.type!=="result") throw new Error(message.message);
          const file=await(await job.outputHandle.getFileHandle(message.outputPath)).getFile();
          const bitmap=await createImageBitmap(file);if(bitmap.width!==64||bitmap.height!==64)throw new Error("Incorrect native decode");bitmap.close();
          hashes.push(await h.digestBytes(await file.arrayBuffer()));
        }
        unsubscribe();const entries=await h.store.getManifestPage(job.id,0,9), digest=await h.digestBytes(h.bytesA);
        runs.push({workers,peak,violations,matched:hashes.every(value=>value===reference),pinned:entries.every(e=>e.sourceIdentity?.sha256===digest&&!e.allowSourceChange),completed:(await h.store.getLargeJob(job.id)).completed});
        await lock.release();
      }
      return runs;
    });
    for(const run of outputs) assert.deepEqual(run,{workers:run.workers,peak:run.workers,violations:0,matched:true,pinned:true,completed:9});

    const stale = await page.evaluate(async () => {
      const {job,lock}=await h.setup("stale-entry"), [entry]=await h.store.claimPendingEntries(job.id,1,lock.owner);
      const other=await job.sourceHandle.getFileHandle("identity-other.bmp",{create:true}), writer=await other.createWritable();await writer.write(h.bytesB);await writer.close();
      const message=await h.run(job,lock.owner,entry,{forged:true,dimensions:true});
      const [saved]=await h.store.getManifestPage(job.id,0,1);await lock.release();
      return {type:message.type,path:saved.relativePath,pinned:saved.sourceIdentity.sha256===await h.digestBytes(h.bytesA)};
    });
    assert.deepEqual(stale,{type:"result",path:"identity-0.bmp",pinned:true});

    // Hold the full task before admission, after real inspection has persisted
    // identity. Replace with a different valid same-length image at the same
    // visible timestamp; releasing the task must not render or save that input.
    await page.evaluate(async () => {
      window.race=await h.setup("source-race");const [entry]=await h.store.claimPendingEntries(race.job.id,1,race.lock.owner);
      const enqueue=h.pool.enqueue.bind(h.pool);window.originalEnqueue=enqueue;
      h.pool.enqueue=spec=>{
        if(spec.kind!=="folder"||spec.workClass==="inspect")return enqueue(spec);
        const prepare=spec.prepare;
        return enqueue({...spec,prepare:async()=>{window.fullHeld=true;await new Promise(done=>window.releaseFull=done);return prepare();}});
      };
      window.racePromise=h.run(race.job,race.lock.owner,entry);
    });
    await page.waitForFunction(()=>window.fullHeld);
    const race = await page.evaluate(async () => {
      const [pinned]=await h.store.getManifestPage(race.job.id,0,1);
      const changed=await h.replace(race.job,0,h.bytesB);releaseFull();h.pool.enqueue=originalEnqueue;
      const result=await racePromise;let files=0;for await(const _ of race.job.outputHandle.entries())files++;
      return {error:result.message,pinned:pinned.sourceIdentity.sha256===await h.digestBytes(h.bytesA),sameMetadata:changed.size===pinned.sourceBytes&&changed.lastModified===pinned.lastModified,files};
    });
    assert.match(race.error,/source changed/);assert.equal(race.pinned,true);assert.equal(race.sameMetadata,true);assert.equal(race.files,0);

    const retry = await page.evaluate(async () => {
      await h.store.retryFailedEntries(race.job.id,race.lock.owner);
      const [entry]=await h.store.claimPendingEntries(race.job.id,1,race.lock.owner);
      const result=await h.run(race.job,race.lock.owner,entry),[saved]=await h.store.getManifestPage(race.job.id,0,1);
      await race.lock.release();return {type:result.type,pinned:saved.sourceIdentity.sha256===await h.digestBytes(h.bytesB),consumed:saved.allowSourceChange===false,completed:(await h.store.getLargeJob(race.job.id)).completed};
    });
    assert.deepEqual(retry,{type:"result",pinned:true,consumed:true,completed:1});

    // A persisted first observation survives a real page/worker teardown.
    await page.evaluate(async () => {
      const {job,lock}=await h.setup("resume-source"),[entry]=await h.store.claimPendingEntries(job.id,1,lock.owner);
      const observed={schema:h.FOLDER_SOURCE_SCHEMA,sha256:await h.digestBytes(h.bytesA),bytes:entry.sourceBytes,lastModified:entry.lastModified};
      await h.store.pinManifestSource(job.id,entry.index,entry.claimId,observed,lock.owner);
      await h.replace(job,0,h.bytesB);await lock.release();h.pool.close();
    });
    await install();
    const resumed = await page.evaluate(async () => {
      const lock=await h.acquireJobOwnership("resume-source");await h.store.resetInterruptedEntries("resume-source",lock.owner);
      const job=await h.store.getLargeJob("resume-source"),[entry]=await h.store.claimPendingEntries(job.id,1,lock.owner);
      const result=await h.run(job,lock.owner,entry);let files=0;for await(const _ of job.outputHandle.entries())files++;
      await lock.release();return {error:result.message,files};
    });
    assert.match(resumed.error,/source changed/);assert.equal(resumed.files,0);

    const fences = await page.evaluate(async () => {
      const {job,lock}=await h.setup("source-fences"),[entry]=await h.store.claimPendingEntries(job.id,1,lock.owner);
      const a={schema:h.FOLDER_SOURCE_SCHEMA,sha256:await h.digestBytes(h.bytesA),bytes:entry.sourceBytes,lastModified:entry.lastModified},b={...a,sha256:await h.digestBytes(h.bytesB)};
      const pin=(value,e=entry,owner=lock.owner)=>h.store.pinManifestSource(job.id,e.index,e.claimId,value,owner);
      const raced=await Promise.allSettled([pin(a),pin(b)]);
      let staleClaim=false,staleOwner=false,journal=false,preview=false,saveFence=false;
      try{await pin(a,{...entry,claimId:"stale"});}catch{staleClaim=true;}
      try{await pin(a,entry,{...lock.owner,epoch:0});}catch{staleOwner=true;}
      try{await h.saveJournaledOutput({jobId:job.id,entry,owner:lock.owner,outputRoot:job.outputHandle,outputPath:"wrong.png",
        result:{bytes:h.bytesB,width:64,height:64,format:"png"},sourceDigest:b.sha256,renderDigest:"invalid"});}
      catch(error){saveFence=/source changed/.test(error.message);}
      await h.store.putOutputIntent(job.id,entry.index,entry.claimId,{sourceDigest:a.sha256},lock.owner);
      await h.store.commitManifestEntry(job.id,entry.index,entry.claimId,{status:"failed",error:"injected"},lock.owner);
      await h.store.retryFailedEntries(job.id,lock.owner);const [retry]=await h.store.claimPendingEntries(job.id,1,lock.owner);
      try{await pin(b,retry);}catch(error){journal=/save began/.test(error.message);}
      await h.replace(job,0,h.bytesB);
      const {renderFolderSample}=await import("./src/jobs/sample-preview.js");
      try{await renderFolderSample(job,retry);}catch(error){preview=/source changed/.test(error.message);}
      let files=0;for await(const _ of job.outputHandle.entries())files++;
      await lock.release();return {oneWinner:raced.filter(r=>r.status==="fulfilled").length===1,staleClaim,staleOwner,journal,preview,saveFence:saveFence&&files===0};
    });
    assert.deepEqual(fences,{oneWinner:true,staleClaim:true,staleOwner:true,journal:true,preview:true,saveFence:true});
    assert.deepEqual(errors,[]);
    console.log(`folder source observations: ${JSON.stringify({runs:outputs,independentOutputs:27,staleEntry:true,sameMetadataReplacement:true,explicitRepair:true,reload:true,...fences})}`);
  } finally {await context.close();}
}
