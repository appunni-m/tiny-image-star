import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

async function install(page) {
  await page.evaluate(async () => {
    const store = await import("./src/jobs/store.js"), core = await import("./src/jobs/core.js");
    const contract = await import("./src/jobs/render-contract.js"), fonts = await import("./src/editor/fonts.js");
    const { acquireJobOwnership } = await import("./src/jobs/ownership.js");
    const { createProcessingClient, getProcessingScheduler } = await import("./src/processing/client.js");
    const { digestBytes } = await import("./src/jobs/output.js");
    const run = async (job, owner, entry, { outputRoot = job.outputHandle } = {}) => {
      const client = createProcessingClient({ kind: "folder" });
      try {
        const message = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Frozen folder render timed out")), 30000);
          client.addEventListener("message", ({ data }) => {
            if (data.jobId === job.id && data.index === entry.index && ["result", "error"].includes(data.type)) { clearTimeout(timer); resolve(data); }
          });
          client.submit({ message: { type: "process", jobId: job.id, entry, owner, recipe: job.recipe, sourceRoot: job.sourceHandle, outputRoot, diagnostics: true },
            source: { width: 512, height: 320, encodedBytes: entry.sourceBytes } });
        });
        if (message.type === "error") {
          await store.commitManifestEntry(job.id, entry.index, entry.claimId, { status: "failed", error: message.message }, owner);
          return { error: message.message };
        }
        const file = await (await job.outputHandle.getFileHandle(message.outputPath)).getFile();
        const bitmap = await createImageBitmap(file); const dimensions = [bitmap.width, bitmap.height]; bitmap.close();
        return { hash: await digestBytes(await file.arrayBuffer()), dimensions, diagnostics: message.diagnostics };
      } finally { client.terminate(); }
    };
    const raw = async (storeName, operation) => {
      const database = await store.openLargeJobDatabase(), transaction = database.transaction(storeName, "readwrite");
      const done = new Promise((resolve,reject) => { transaction.oncomplete = resolve; transaction.onabort = transaction.onerror = () => reject(transaction.error); });
      operation(transaction.objectStore(storeName)); await done;
    };
    window.h = { store, core, contract, fonts, acquireJobOwnership, pool: getProcessingScheduler(), digestBytes, run, raw };
  });
}

async function assertFolderUpgrade(browser, origin) {
  const context = await browser.newContext();
  await context.route("**/__folder_contract_test__", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Folder upgrade verification</title>" }));
  const a = await context.newPage(), b = await context.newPage(), url = new URL("__folder_contract_test__",origin).href;
  try {
    await a.goto(url); await b.goto(url);
    await a.evaluate(async () => {
      window.oldDatabase = await new Promise((resolve,reject) => {
        const request=indexedDB.open("tiny-image-star.large-jobs",1);
        request.onupgradeneeded=()=>{ const db=request.result; db.createObjectStore("jobs",{ keyPath:"id" }); db.createObjectStore("entries",{ keyPath:["jobId","index"] }).createIndex("by_job_status",["jobId","status"]); };
        request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
      });
      oldDatabase.onversionchange=()=>{}; // An old tab that has not released its connection.
      const transaction=oldDatabase.transaction(["jobs","entries"],"readwrite");
      transaction.objectStore("jobs").put({ id:"old-job", version:1, status:"paused", completed:1, discovered:2, recipe:{name:"Old",operations:{format:"png"}}, updatedAt:1 });
      transaction.objectStore("entries").put({ jobId:"old-job", index:0, status:"completed", outputPath:"keep.png" });
      await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);});
      const root=await navigator.storage.getDirectory(), file=await root.getFileHandle("keep.png",{create:true}), writer=await file.createWritable(); await writer.write("existing output preserved"); await writer.close();
    });
    const blocked = await b.evaluate(async () => {
      window.store=await import("./src/jobs/store.js");
      try {await store.getLargeJob("old-job"); return null;} catch(error){return error.message;}
    });
    assert.match(blocked,/Close older Tiny Image Star tabs/);
    await a.evaluate(()=>oldDatabase.close());
    const upgraded = await b.evaluate(async () => {
      const job=await store.getLargeJob("old-job"), db=await store.openLargeJobDatabase();
      const {acquireJobOwnership}=await import("./src/jobs/ownership.js"), owner=await acquireJobOwnership(job.id);
      let rejected=false;try{await store.claimPendingEntries(job.id,1,owner.owner);}catch(error){rejected=/predates frozen rendering/.test(error.message);}
      const entries=await store.getManifestPage(job.id,0,2);
      await store.deleteLargeJob(job.id,owner.owner);await owner.release();
      const root=await navigator.storage.getDirectory();return { version:db.version, snapshots:db.objectStoreNames.contains("font-snapshots"), oldVersion:job.version, completed:job.completed, outputPath:entries[0].outputPath, rejected,
        existingOutput:await(await(await root.getFileHandle("keep.png")).getFile()).text(), removed:!await store.getLargeJob(job.id) };
    });
    assert.deepEqual(upgraded,{version:5,snapshots:true,oldVersion:1,completed:1,outputPath:"keep.png",rejected:true,existingOutput:"existing output preserved",removed:true});
  } finally {await context.close();}
}

export async function assertFolderContracts(browser, origin) {
  const fixture = await readFile(new URL("./fixtures/fonts/NotoSans.ttf", import.meta.url));
  const provenance = JSON.parse(await readFile(new URL("./fixtures/fonts/provenance.json", import.meta.url), "utf8"));
  assert.equal(createHash("sha256").update(fixture).digest("hex"), provenance.files[0].sha256);
  const context = await browser.newContext(), errors = [], external = [];
  await context.route("**/__folder_contract_test__", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Folder contract verification</title>" }));
  context.on("request", request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(origin).origin) external.push(request.url()); });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  const url = new URL("__folder_contract_test__", origin).href;
  try {
    await page.goto(url); await install(page);
    const first = await page.evaluate(async encoded => {
      const { store, core, fonts, acquireJobOwnership, pool, run, digestBytes } = h;
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const font = await fonts.registerFontFile(new File([bytes], "NotoSans.ttf"));
      const { createTextLayer } = await import("./src/compositor/text.js"), { createPillowEngine } = await import("./src/engine/pillow.js");
      const canvas = new OffscreenCanvas(512,320), ctx = canvas.getContext("2d");
      ctx.fillStyle = "#293954"; ctx.fillRect(0,0,512,320); ctx.fillStyle = "#d88452"; ctx.fillRect(0,160,512,160);
      const source = await canvas.convertToBlob();
      const recipe = { id: "caption", name: "Saved type", operations: { format: "png", brightness: 1, contrast: 1, textLayers: [
        { ...createTextLayer(), text: "Keep this exact type", fontId: font.id, fontBytes: font.bytes.byteLength, fontSha256: font.sha256, fontSize: .1, y: .5 }
      ] } };
      const engine = await createPillowEngine(), input = await source.arrayBuffer();
      const expected = await engine.render({ name: "sample.png", bytes: input }, core.settingsForLargeJob(recipe));
      const plain = await engine.render({ name: "sample.png", bytes: input }, core.settingsForLargeJob({ ...recipe, operations: { ...recipe.operations, textLayers: [] } }));
      const root = await navigator.storage.getDirectory(), sourceRoot = await root.getDirectoryHandle("frozen-source", { create: true }), outputRoot = await root.getDirectoryHandle("frozen-output", { create: true });
      const id = "frozen-font-folder", entries = [];
      for (let i=0;i<51;i++) {
        const file = await sourceRoot.getFileHandle(`${i}.png`, { create: true }), writer = await file.createWritable(); await writer.write(source); await writer.close();
        entries.push(core.createManifestEntry({ jobId: id, index: i, relativePath: `${i}.png`, file: await file.getFile() }));
      }
      await store.putLargeJob(core.createLargeJob({ id, recipe, sourceHandle: sourceRoot }));
      const ownership = await acquireJobOwnership(id);
      let job = await store.patchLargeJob(id, { status: "running", scanComplete: true, discovered: entries.length, outputHandle: outputRoot }, ownership.owner);
      await store.putManifestEntries(entries, ownership.owner); pool.configure({ fixedConcurrency: 1 });
      const [entry,waitingEntry] = await store.claimPendingEntries(id,2,ownership.owner), beforeFreeze=job;
      const otherOutput = await root.getDirectoryHandle("stale-message-output",{create:true});
      const output = await run(job,ownership.owner,entry,{outputRoot:otherOutput});
      let strayOutputs=0;for await(const _ of otherOutput.entries())strayOutputs++;
      job = await store.getLargeJob(id);
      await fonts.clearStoredFonts();
      const libraryMissing = await fonts.readFontRecord(font.id) === null;
      const snapshot = await store.readLargeJobFont(id,font.id);
      // Snapshot identity binds the bytes, not arbitrary stored CSS metadata.
      // Such fields must never change how an otherwise valid font is loaded.
      await h.raw("font-snapshots",s => s.put({ ...snapshot, fontFace: { weight: "700 700", style: "italic" } }));
      // A second admitted task can hold metadata fetched before another task
      // freezes the job. Clearing the library must not invalidate that task.
      const { folderRenderContext } = await import("./src/jobs/render-context.js");
      const waiting = await folderRenderContext({ jobId:id,recipe,entry:waitingEntry,owner:ownership.owner },beforeFreeze);
      const waitingOutput = await engine.render({ name:"waiting.png",bytes:input,fontRecords:waiting.fontRecords },waiting.settings);
      await store.releaseClaimedEntries(id,[waitingEntry],ownership.owner);
      await store.patchLargeJob(id,{ status: "paused" },ownership.owner); await ownership.release(); pool.close();
      return { id, fontId: font.id, fontSha256: font.sha256, expected: await digestBytes(expected.bytes), plain: await digestBytes(plain.bytes), output, strayOutputs, waitingHash:await digestBytes(waitingOutput.bytes), libraryMissing,
        snapshotBytes: snapshot.bytes.size, fontBytes: font.bytes.byteLength, contract: job.renderContract,
        unboundFontMetadataIgnored: waiting.fontRecords.every(record => !Object.hasOwn(record,"fontFace")) };
    }, fixture.toString("base64"));
    assert.notEqual(first.expected, first.plain); assert.equal(first.output.hash,first.expected); assert.ok(first.libraryMissing);
    assert.equal(first.strayOutputs,0,"the saved destination overrides a stale message's directory handle");
    assert.ok(first.unboundFontMetadataIgnored,"unbound stored font descriptors cannot alter rendering");
    assert.equal(first.waitingHash,first.expected,"a task with pre-freeze metadata uses the committed snapshot after library removal");
    assert.equal(first.snapshotBytes,first.fontBytes); assert.equal(first.contract.fonts[0].sha256,first.fontSha256);
    assert.match(first.contract.recipeSha256,/^[a-f0-9]{64}$/);

    await page.reload(); await install(page);
    const resumed = await page.evaluate(async first => {
      const { store, fonts, acquireJobOwnership, pool, run, raw, contract, core } = h;
      const ownership = await acquireJobOwnership(first.id); let job = ownership.job;
      const libraryMissing = await fonts.readFontRecord(first.fontId) === null;
      job = await store.patchLargeJob(job.id,{ status: "running" },ownership.owner);
      const runs = [];
      for (const concurrency of [1,4,8]) {
        pool.configure({ fixedConcurrency: concurrency }); let peak=0, violations=0;
        const stop = pool.subscribe(s => { peak=Math.max(peak,s.active); if(s.active>concurrency || s.estimatedBytes>s.memoryBudget) violations++; });
        const entries = await store.claimPendingEntries(job.id,16,ownership.owner);
        const outputs = await Promise.all(entries.map(entry => run(job,ownership.owner,entry))); stop(); runs.push({ concurrency,peak,violations,outputs });
      }
      const rejected = [];
      for (const patch of [{ recipe: { ...job.recipe, name: "Changed" } }, { renderContract: job.renderContract }, { outputHandle: job.outputHandle }]) {
        try { await store.patchLargeJob(job.id,patch,ownership.owner); rejected.push(false); } catch { rejected.push(true); }
      }
      job = await store.getLargeJob(job.id);
      const journaled = (await store.getManifestPage(job.id,0,49)).every(entry => entry.status === "completed" && /^[a-f0-9]{64}$/.test(entry.outputIntent.renderDigest));
      const invalidEngine = structuredClone(job); invalidEngine.renderContract.engine.wasmSha256 = "0".repeat(64);
      await raw("jobs", s => s.put(invalidEngine)); let engineRejected=false;
      try { await store.claimPendingEntries(job.id,1,ownership.owner); } catch(error) { engineRejected=/different renderer/.test(error.message); }
      await raw("jobs", s => s.put(job));
      const snapshot = await store.readLargeJobFont(job.id,first.fontId), badBytes = new Uint8Array(await snapshot.bytes.arrayBuffer()); badBytes[badBytes.length-1]^=1;
      await raw("font-snapshots",s => s.put({ ...snapshot, bytes: new Blob([badBytes]) }));
      const [badEntry] = await store.claimPendingEntries(job.id,1,ownership.owner), corrupt = await run(job,ownership.owner,badEntry);
      await fonts.registerFontFile(new File([snapshot.bytes],"NotoSans.ttf"));
      await raw("font-snapshots",s => s.delete([job.id,first.fontId]));
      const [missingEntry] = await store.claimPendingEntries(job.id,1,ownership.owner), missing = await run(job,ownership.owner,missingEntry);
      const counts = await store.getLargeJob(job.id);
      const oldOwner = ownership.owner; await ownership.release(); const next = await acquireJobOwnership(job.id); let staleRejected=false;
      try { await store.freezeLargeJob(job.id,job.recipe,job.renderContract,[],oldOwner); } catch { staleRejected=true; }
      await store.deleteLargeJob(job.id,next.owner); await next.release();
      const forgotten = !await store.getLargeJob(job.id) && !await store.readLargeJobFont(job.id,first.fontId);

      const quotaId="font-snapshot-quota"; await store.putLargeJob(core.createLargeJob({ id: quotaId, recipe: job.recipe }));
      const quotaOwner=await acquireJobOwnership(quotaId), fontRecord={ ...snapshot, bytes: await snapshot.bytes.arrayBuffer() };
      const originalPut=IDBObjectStore.prototype.put; let quotaRejected=false;
      IDBObjectStore.prototype.put=function(value,...rest) { if(this.name==="jobs" && value.id===quotaId && value.renderContract?.recipeSha256) throw new DOMException("snapshot test quota","QuotaExceededError"); return originalPut.call(this,value,...rest); };
      try { await store.freezeLargeJob(quotaId,job.recipe,job.renderContract,[fontRecord],quotaOwner.owner); } catch(error) { quotaRejected=error.name==="QuotaExceededError"; }
      finally { IDBObjectStore.prototype.put=originalPut; }
      const quotaAtomic=(await store.getLargeJob(quotaId)).renderContract.recipeSha256===null && !await store.readLargeJobFont(quotaId,first.fontId);
      await store.freezeLargeJob(quotaId,job.recipe,job.renderContract,[fontRecord],quotaOwner.owner);
      const retrySaved=Boolean(await store.readLargeJobFont(quotaId,first.fontId));
      await store.deleteLargeJob(quotaId,quotaOwner.owner); await quotaOwner.release();

      const parallelId="parallel-font-capture";
      await store.putLargeJob(core.createLargeJob({ id:parallelId,recipe:job.recipe }));
      const parallelOwner=await acquireJobOwnership(parallelId);
      const pendingJob=await store.patchLargeJob(parallelId,{status:"running"},parallelOwner.owner);
      await store.putManifestEntries([0,1].map(index=>core.createManifestEntry({jobId:parallelId,index,relativePath:`${index}.png`,file:new File([],`${index}.png`)})),parallelOwner.owner);
      const claims=await store.claimPendingEntries(parallelId,2,parallelOwner.owner);
      const {folderRenderContext}=await import("./src/jobs/render-context.js"), {writeGateName}=await import("./src/jobs/ownership.js");
      const originalRequest=navigator.locks.request, originalGet=IDBObjectStore.prototype.get;
      let preparing=0, preparationPeak=0, libraryReads=0;
      navigator.locks.request=function(name,...args) {
        if(name!==writeGateName(parallelId)) return originalRequest.call(this,name,...args);
        const callback=args.pop();
        return originalRequest.call(this,name,...args,async lock=>{
          preparing++;preparationPeak=Math.max(preparationPeak,preparing);
          try{return await callback(lock);}finally{preparing--;}
        });
      };
      IDBObjectStore.prototype.get=function(...args){if(this.name==="fonts")libraryReads++;return originalGet.apply(this,args);};
      let preparations;
      try { preparations=await Promise.all(claims.map(entry=>folderRenderContext({jobId:parallelId,recipe:job.recipe,entry,owner:parallelOwner.owner},pendingJob))); }
      finally {navigator.locks.request=originalRequest;IDBObjectStore.prototype.get=originalGet;}
      const sameSnapshot=preparations.length===2 && preparations.every(value=>value.fontRecords[0].sha256===first.fontSha256 && value.renderDigest===preparations[0].renderDigest);
      await store.deleteLargeJob(parallelId,parallelOwner.owner);await parallelOwner.release();pool.close();
      return { libraryMissing,runs,rejected,journaled,engineRejected,corrupt,missing,completed:counts.completed,failed:counts.failed,staleRejected,forgotten,quotaRejected,quotaAtomic,retrySaved,preparationPeak,libraryReads,sameSnapshot };
    }, first);
    assert.ok(resumed.libraryMissing);
    for (const run of resumed.runs) { assert.equal(run.peak,run.concurrency); assert.equal(run.violations,0); assert.equal(run.outputs.length,16); for(const output of run.outputs) {
      assert.equal(output.hash,first.expected); assert.deepEqual(output.dimensions,[512,320]);
      assert.equal(output.diagnostics.schema,"tinystar/folder-timings@1");
      for(const key of ["engineWaitMs","sourceReadMs","sourceDigestMs","renderMs","journalSaveMs"]) assert.ok(Number.isFinite(output.diagnostics[key])&&output.diagnostics[key]>=0,key);
    } }
    assert.ok(resumed.rejected.every(Boolean)); assert.ok(resumed.journaled && resumed.engineRejected);
    assert.match(resumed.corrupt.error,/integrity/); assert.match(resumed.missing.error,/snapshot.*missing|missing.*snapshot/);
    assert.equal(resumed.completed,49); assert.equal(resumed.failed,2);
    for (const key of ["staleRejected","forgotten","quotaRejected","quotaAtomic","retrySaved"]) assert.equal(resumed[key],true,key);
    assert.equal(resumed.preparationPeak,1,"initial snapshot capture is exclusive while ordinary output writes remain shared");
    assert.equal(resumed.libraryReads,1,"simultaneous initial tasks read the live font library only once");assert.ok(resumed.sameSnapshot);
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    await assertFolderUpgrade(browser,origin);
    console.log("folder snapshot observations: " + JSON.stringify({ fontSha256:first.fontSha256, reference:first.expected,
      runs:resumed.runs.map(({concurrency,peak,violations,outputs})=>({concurrency,peak,violations,checked:outputs.length})),
      completed:resumed.completed,expectedFailures:resumed.failed,quotaAtomic:resumed.quotaAtomic,libraryMissingAfterReload:resumed.libraryMissing,upgradeBlockedThenRecovered:true,staleMetadataUsedSnapshot:true,staleDestinationIgnored:first.strayOutputs===0,unboundFontMetadataIgnored:first.unboundFontMetadataIgnored,preparationPeak:resumed.preparationPeak,libraryReads:resumed.libraryReads,sameSnapshot:resumed.sameSnapshot }));
    console.log(`folder snapshots: reload without library fonts; exact 1/4/8 outputs; corrupt/missing assets blocked; quota atomicity, immutable recipe, renderer and owner fencing`);
  } finally { await context.close(); }
}
