import { canonicalJSON } from "../project/model.js";
import { storageTransactionError } from "../project/storage-errors.js";
import { normalizeFormat } from "../formats.js";
import { outputFormatForJob } from "./core.js";
import { assertFolderContract } from "./render-contract.js";
import { stagingPlan, remainingStagingBytes, assertStagingCapacity, stagedGroupPlan, stagedOutputAllowance } from "./staging-plan.js";
import { bindSourceIdentity } from "./source-contract.js";
import { assertSceneCollection, assertSceneGroup, sceneOutputEntries } from "./scene-plan.js";
import { folderRecipeDigest } from "./render-contract.js";
import { PHOTO_COLLECTION_SCHEMA, assertPhotoInputDigest, photoCachePlan, remainingPhotoCacheBytes } from "./photo-import-plan.js";

const DB_NAME = "tiny-image-star.large-jobs";
const DB_VERSION = 5;
const PHOTO_STORE = "photo-imports";
const OUTPUT_STORE = "scene-outputs";
const JOB_STORE = "jobs";
const ENTRY_STORE = "entries";
const FONT_STORE = "font-snapshots";
const SCENE_STORE = "scene-groups";
const ASSET_STORE = "scene-assets";
let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local job storage failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = event => reject(storageTransactionError(event.target?.error ?? transaction.error, "Local job storage was interrupted."));
    transaction.onerror = event => reject(storageTransactionError(event.target?.error ?? transaction.error, "Local job storage failed."));
  });
}

export function largeJobStorageAvailable() {
  return typeof globalThis.indexedDB !== "undefined" && typeof globalThis.IDBKeyRange !== "undefined";
}

export function openLargeJobDatabase() {
  if (!largeJobStorageAvailable()) return Promise.reject(new Error("Local job recovery is unavailable in this browser."));
  if (!databasePromise) {
    const pending = new Promise((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PHOTO_STORE)) database.createObjectStore(PHOTO_STORE, { keyPath: ["jobId", "index"] });
        if (!database.objectStoreNames.contains(OUTPUT_STORE)) database.createObjectStore(OUTPUT_STORE, { keyPath: ["jobId", "index"] });
        if (!database.objectStoreNames.contains(JOB_STORE)) database.createObjectStore(JOB_STORE, { keyPath: "id" });
        if (!database.objectStoreNames.contains(FONT_STORE)) database.createObjectStore(FONT_STORE, { keyPath: ["jobId", "id"] });
        if (!database.objectStoreNames.contains(SCENE_STORE)) database.createObjectStore(SCENE_STORE, { keyPath: ["jobId", "index"] });
        if (!database.objectStoreNames.contains(ASSET_STORE)) database.createObjectStore(ASSET_STORE, { keyPath: ["jobId", "sha256"] });
        if (!database.objectStoreNames.contains(ENTRY_STORE)) {
          const entries = database.createObjectStore(ENTRY_STORE, { keyPath: ["jobId", "index"] });
          entries.createIndex("by_job_status", ["jobId", "status"], { unique: false });
        }
      };
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); if (databasePromise === pending) databasePromise = undefined; };
        resolve(request.result);
      };
      request.onerror = () => { if (databasePromise === pending) databasePromise = undefined; reject(request.error); };
      request.onblocked = () => { blocked = true; if (databasePromise === pending) databasePromise = undefined; reject(new Error("Close older Tiny Image Star tabs before opening saved folder jobs. Their saved data is preserved.")); };
    });
    databasePromise = pending;
  }
  return databasePromise;
}

// Every mutation reads fresh state in one transaction. Strict durability asks
// the browser to persist the journal before an external file is written.
async function transact(mode, callback) {
  const database = await openLargeJobDatabase();
  const transaction = database.transaction([JOB_STORE, ENTRY_STORE, FONT_STORE, SCENE_STORE, ASSET_STORE, OUTPUT_STORE, PHOTO_STORE], mode, mode === "readwrite" ? { durability: "strict" } : {});
  const done = transactionDone(transaction);
  const jobs = transaction.objectStore(JOB_STORE), entries = transaction.objectStore(ENTRY_STORE), fonts = transaction.objectStore(FONT_STORE);
  try {
    const value = await callback({ jobs, entries, fonts, scenes:transaction.objectStore(SCENE_STORE), assets:transaction.objectStore(ASSET_STORE), outputs:transaction.objectStore(OUTPUT_STORE), photos:transaction.objectStore(PHOTO_STORE) });
    await done;
    return value;
  } catch (error) {
    try { transaction.abort(); } catch { /* Already completed or aborted. */ }
    await done.catch(() => {});
    throw error;
  }
}

function checkOwner(job, owner) {
  if (!job) throw new Error("The saved folder job is incomplete.");
  if (!owner || owner.token !== job.owner?.token || owner.epoch !== job.owner?.epoch) {
    throw new Error("This folder job belongs to another tab. Reopen it to continue.");
  }
}

function touch(job, patch = {}) {
  return { ...job, ...patch, revision: Number(job.revision ?? 0) + 1, updatedAt: Date.now() };
}

async function mutate(jobId, owner, callback) {
  return transact("readwrite", async (stores) => {
    const job = await requestResult(stores.jobs.get(jobId));
    checkOwner(job, owner);
    return callback(stores, job);
  });
}

// Creation is insert-only; a stale tab cannot replace an existing job record.
export function putLargeJob(job) {
  assertFolderContract(job);
  if(job.kind==="scene-collection")assertSceneCollection(job);
  if (job.recipe?.photoImport) throw new Error("Photo import jobs must be created together with their source manifests.");
  return transact("readwrite", async ({ jobs }) => {
    await requestResult(jobs.add({ ...job, owner: null, revision: 0 }));
    return job;
  });
}

// Called only while ownership.js holds the owner lock AND exclusive write gate.
export function beginJobOwnership(jobId, token) {
  return transact("readwrite", async ({ jobs }) => {
    const job = await requestResult(jobs.get(jobId));
    if (!job) throw new Error("The saved folder job no longer exists.");
    const owner = { token, epoch: Number(job.owner?.epoch ?? 0) + 1 };
    const next = touch(job, { owner });
    jobs.put(next);
    return { owner, job: next };
  });
}

export function patchLargeJob(jobId, patch, owner) {
  return mutate(jobId, owner, ({ jobs }, job) => {
    if ("version" in patch || "renderContract" in patch || "kind" in patch) throw new Error("A folder job's rendering contract cannot be replaced.");
    if(job.kind==="scene-collection" && ["recipe","format","sourceHandle","outputHandle","outputBaseHandle","outputFolderName","outputMode","staging","stagingSpent","importDigests","photoCache","photoCacheSpent"].some(key=>key in patch)) throw new Error("A story batch's inputs and destination are frozen. Start a new batch to change them.");
    if ("format" in patch) {
      const format = normalizeFormat(patch.format);
      if (!format) throw new Error("Choose a supported output format.");
      patch = { ...patch, format };
      if (format !== outputFormatForJob(job)
        && (job.outputHandle || job.renderContract?.recipeSha256 || job.completed || job.failed || ["running", "pausing", "paused"].includes(job.status))) {
        throw new Error("This folder job's output format is frozen. Start a new job to choose a different format.");
      }
    }
    if ("recipe" in patch && canonicalJSON(patch.recipe) !== canonicalJSON(job.recipe)
      && (job.renderContract?.recipeSha256 || job.completed || job.failed || ["running", "pausing", "paused"].includes(job.status))) {
      throw new Error("This folder recipe is frozen. Start a new job to use different edits.");
    }
    if ((job.renderContract?.recipeSha256 || job.completed || job.failed || ["running", "pausing", "paused"].includes(job.status))
      && ["sourceHandle", "outputBaseHandle", "outputHandle", "outputFolderName"].some(key => key in patch)) {
      throw new Error("This folder job's source and destination are frozen. Start a new job to change folders.");
    }
    // Counters are maintained by entry transitions; discovery may reset them
    // only after its manifest has been cleared under the same owner.
    const { id, owner: ignoredOwner, revision, ...values } = patch;
    const next = touch(job, values);
    jobs.put(next);
    return next;
  });
}

export function getLargeJob(jobId) {
  return transact("readonly", async ({ jobs }) => await requestResult(jobs.get(jobId)) ?? null);
}

export function listLargeJobs() {
  return transact("readonly", async ({ jobs }) => (await requestResult(jobs.getAll())).sort((a, b) => b.updatedAt - a.updatedAt));
}

export function putManifestEntries(values, owner) {
  if (!values.length) return Promise.resolve();
  return mutate(values[0].jobId, owner, ({ entries }, job) => {
    for (const entry of values) {
      if (entry.jobId !== job.id) throw new Error("Manifest entries must belong to one job.");
      entries.add(entry);
    }
  });
}

export function getManifestPage(jobId, start, count) {
  if (count <= 0) return Promise.resolve([]);
  return transact("readonly", ({ entries }) => requestResult(entries.getAll(IDBKeyRange.bound([jobId, Math.max(0, start)], [jobId, Math.max(0, start + count - 1)]))));
}

export function getFailedManifestPage(jobId, start, count) {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 0 || count > 512) throw new Error("Invalid failure review window.");
  if (!count) return Promise.resolve([]);
  return transact("readonly", ({ entries }) => new Promise((resolve, reject) => {
    const request = entries.index("by_job_status").openCursor(IDBKeyRange.only([jobId, "failed"]));
    const rows = []; let skipped = false;
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || rows.length === count) { resolve(rows); return; }
      if (!skipped && start) { skipped = true; cursor.advance(start); return; }
      rows.push(cursor.value); cursor.continue();
    };
  }));
}

function visitStatus(entries, jobId, status, callback) {
  return new Promise((resolve, reject) => {
    const request = entries.index("by_job_status").openCursor(IDBKeyRange.only([jobId, status]));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || callback(cursor) === false) { resolve(); return; }
      cursor.continue();
    };
  });
}

export function claimPendingEntries(jobId, count, owner) {
  if (count <= 0) return Promise.resolve([]);
  return mutate(jobId, owner, async ({ entries }, job) => {
    assertFolderContract(job);
    if (job.status !== "running") return [];
    const claimed = [];
    await visitStatus(entries, jobId, "pending", (cursor) => {
      if (claimed.length >= count) return false;
      const entry = { ...cursor.value, status: "processing", attempts: Number(cursor.value.attempts ?? 0) + 1,
        claimId: crypto.randomUUID(), ownerEpoch: owner.epoch, error: null };
      cursor.update(entry);
      claimed.push(entry);
    });
    return claimed;
  });
}

function checkClaim(entry, claimId, owner) {
  if (!entry || entry.claimId !== claimId || entry.ownerEpoch !== owner.epoch) throw new Error("This image attempt is no longer current.");
}

export function getClaimedEntry(jobId, index, claimId, owner) {
  return transact("readonly", async ({ entries, jobs }) => {
    checkOwner(await requestResult(jobs.get(jobId)), owner);
    const entry = await requestResult(entries.get([jobId, index]));
    checkClaim(entry, claimId, owner);
    return entry;
  });
}

export function releaseClaimedEntries(jobId, claimed, owner) {
  return mutate(jobId, owner, async ({ entries }) => {
    for (const item of claimed) {
      const current = await requestResult(entries.get([jobId, item.index]));
      if (current?.status === "processing" && current.claimId === item.claimId && current.ownerEpoch === owner.epoch) {
        entries.put({ ...current, status: "pending", claimId: null, error: null });
      }
    }
  });
}

// Hashing happens only inside admitted work. Commit the small identity before
// decoding/rendering, with the same durable owner and attempt fences as writes.
export function pinManifestSource(jobId, index, claimId, observed, owner) {
  return mutate(jobId, owner, async ({ entries }) => {
    const entry = await requestResult(entries.get([jobId, index]));
    checkClaim(entry, claimId, owner);
    if (entry.status !== "processing") throw new Error("This image is no longer processing.");
    const next = bindSourceIdentity(entry, observed);
    entries.put(next);
    return next;
  });
}

export function putOutputIntent(jobId, index, claimId, intent, owner) {
  return mutate(jobId, owner, async ({ entries }) => {
    const entry = await requestResult(entries.get([jobId, index]));
    checkClaim(entry, claimId, owner);
    if (entry.status !== "processing") throw new Error("This image is no longer processing.");
    entries.put({ ...entry, outputIntent: intent });
  });
}

// Completion is idempotent for one claim, including an error arriving after a
// durable success. Counts derive from status transitions, never caller deltas.
export function commitManifestEntry(jobId, index, claimId, patch, owner) {
  return mutate(jobId, owner, async ({ entries, jobs }, job) => {
    const entry = await requestResult(entries.get([jobId, index]));
    checkClaim(entry, claimId, owner);
    if (entry.status === "completed" || entry.status === "failed") return { entry, job };
    if (entry.status !== "processing" || !["completed", "failed"].includes(patch.status)) throw new Error("Invalid image completion.");
    if (patch.status === "completed" && (!entry.outputIntent || patch.outputDigest !== entry.outputIntent.digest)) throw new Error("Missing saved-output journal.");
    const nextEntry = { ...entry, ...patch };
    const nextJob = touch(job, {
      completed: Number(job.completed ?? 0) + Number(patch.status === "completed"),
      failed: Number(job.failed ?? 0) + Number(patch.status === "failed"),
      outputBytes: Number(job.outputBytes ?? 0) + (patch.status === "completed" ? Number(patch.outputBytes) : 0),
    });
    entries.put(nextEntry);
    jobs.put(nextJob);
    return { entry: nextEntry, job: nextJob };
  });
}

function resetStatus(jobId, fromStatus, owner) {
  return mutate(jobId, owner, async ({ entries, jobs }, job) => {
    let changed = 0;
    await visitStatus(entries, jobId, fromStatus, (cursor) => {
      cursor.update({ ...cursor.value, status: "pending", claimId: null, error: null,
        allowSourceChange: job.kind!=="scene-collection" && (fromStatus === "failed" || Boolean(cursor.value.allowSourceChange)) });
      changed += 1;
    });
    const next = touch(job, fromStatus === "failed" ? { failed: Math.max(0, Number(job.failed ?? 0) - changed) } : {});
    jobs.put(next);
    return next;
  });
}

export function resetInterruptedEntries(jobId, owner) { return resetStatus(jobId, "processing", owner); }
export function retryFailedEntries(jobId, owner) { return resetStatus(jobId, "failed", owner); }

export function clearManifestEntries(jobId, owner) {
  return mutate(jobId, owner, ({ entries }) => {
    entries.delete(IDBKeyRange.bound([jobId, 0], [jobId, Number.MAX_SAFE_INTEGER]));
  });
}

export function deleteLargeJob(jobId, owner) {
  return mutate(jobId, owner, ({ entries, jobs, fonts, scenes, assets, outputs, photos }) => {
    jobs.delete(jobId);
    photos.delete(IDBKeyRange.bound([jobId,0],[jobId,Number.MAX_SAFE_INTEGER]));
    outputs.delete(IDBKeyRange.bound([jobId,0],[jobId,Number.MAX_SAFE_INTEGER]));
    entries.delete(IDBKeyRange.bound([jobId, 0], [jobId, Number.MAX_SAFE_INTEGER]));
    fonts.delete(IDBKeyRange.bound([jobId, ""], [jobId, "\uffff"]));
    scenes.delete(IDBKeyRange.bound([jobId,0],[jobId,Number.MAX_SAFE_INTEGER]));
    assets.delete(IDBKeyRange.bound([jobId,""],[jobId,"\uffff"]));
  });
}

export function getSceneGroup(jobId,index) {
  if(!Number.isSafeInteger(index)||index<0)throw new Error("Invalid story group index.");
  return transact("readonly",async({scenes})=>{
    const value=await requestResult(scenes.get([jobId,index]));if(!value)return null;
    const {jobId:ignored,...group}=value;return group;
  });
}

export function readSceneAsset(jobId,sha256) {
  if(!/^[a-f0-9]{64}$/.test(sha256))throw new Error("Invalid story asset identity.");
  return transact("readonly",async({assets})=>(await requestResult(assets.get([jobId,sha256])))?.blob??null);
}

// The caller verifies bytes inside admitted preparation. This transaction
// publishes a complete group and its job-owned Blobs together, or neither.
export async function putSceneGroup(jobId,group,records,owner) {
  group=structuredClone(group);records=records.map(record=>({...record}));
  await assertSceneGroup(group,await getLargeJob(jobId));
  const expected=new Map(Object.values(group.project.assets).map(asset=>[asset.sha256,asset.byteLength]));
  if(records.length!==expected.size||new Set(records.map(record=>record.sha256)).size!==expected.size
    ||records.some(record=>!(record.blob instanceof Blob)||record.blob.size!==expected.get(record.sha256)))throw new Error("A story snapshot is incomplete.");
  return mutate(jobId,owner,async({jobs,scenes,assets},job)=>{
    assertSceneCollection(job);
    if (job.recipe.photoImport && job.importDigests?.[group.index] !== group.sha256) throw new Error("This photo group no longer matches its saved import plan.");
    if(job.outputMode === "browser" && canonicalJSON(job.staging?.groups[group.index]) !== canonicalJSON(stagedGroupPlan(group))) throw new Error("This story changed after storage planning. Start a new batch.");
    if (job.recipe.photoImport && job.outputMode !== "browser") {
      const { sha256, sourceBytes, metadataBytes } = stagedGroupPlan(group);
      if (canonicalJSON(job.photoCache?.groups[group.index]) !== canonicalJSON({ sha256, sourceBytes, metadataBytes })) throw new Error("Finish reserving storage for the photo snapshots first.");
    }
    const existing=await requestResult(scenes.get([jobId,group.index]));
    if(existing){if(existing.sha256!==group.sha256)throw new Error("This story group is already frozen.");return job;}
    if(job.status!=="preparing"||job.renderContract.recipeSha256||group.index!==job.preparedGroups)throw new Error("This story batch is no longer accepting snapshots.");
    let added=0;
    for(const record of records)if(!await requestResult(assets.getKey([jobId,record.sha256]))){assets.add({jobId,sha256:record.sha256,blob:record.blob});added+=record.blob.size;}
    scenes.add({jobId,...group});
    const next=touch(job,{preparedGroups:job.preparedGroups+1,snapshotBytes:job.snapshotBytes+added,...(job.outputMode === "browser" ? {stagingSpent:(job.stagingSpent??0)+job.staging.groups[group.index].sourceBytes+job.staging.groups[group.index].metadataBytes} : {}),
      ...(job.photoCache ? { photoCacheSpent: (job.photoCacheSpent ?? 0) + job.photoCache.groups[group.index].sourceBytes + job.photoCache.groups[group.index].metadataBytes } : {})});
    jobs.put(next);return next;
  });
}

export async function sealSceneCollection(jobId,owner) {
  const saved=await getLargeJob(jobId),collection=assertSceneCollection(saved),digests=[];
  if(saved.renderContract.recipeSha256)return saved;
  for(let index=0;index<collection.selection.length;index++){
    const group=await getSceneGroup(jobId,index);if(!group)throw new Error("Finish copying every selected story before starting.");
    await assertSceneGroup(group,saved);digests.push(group.sha256);
  }
  const recipe={...saved.recipe,collection:{...collection,digests}},recipeSha256=await folderRecipeDigest(recipe);
  return mutate(jobId,owner,async({jobs,entries,scenes},job)=>{
    if(job.renderContract.recipeSha256)return job;
    if(job.status!=="preparing"||canonicalJSON(job.recipe)!==canonicalJSON(saved.recipe)||job.preparedGroups!==digests.length)throw new Error("The story batch changed while it was being prepared.");
    let count=0;
    for(let index=0;index<digests.length;index++){
      const group=await requestResult(scenes.get([jobId,index]));if(group?.sha256!==digests[index])throw new Error("A story snapshot changed before the plan was frozen.");
      const rows=sceneOutputEntries(jobId,group,count);for(const entry of rows)entries.add(entry);count+=rows.length;
    }
    const next=touch(job,{recipe,renderContract:{...job.renderContract,recipeSha256},status:"ready",scanComplete:true,discovered:count,sourceBytes:job.snapshotBytes,error:null});
    jobs.put(next);return next;
  });
}

// The contract and its private font bytes commit together. Concurrent admitted
// workers keep the first complete snapshot; none can replace it mid-job.
export function freezeLargeJob(jobId, expectedRecipe, contract, records, owner, expectedFormat = null) {
  return mutate(jobId, owner, async ({ jobs, fonts }, job) => {
    assertFolderContract(job);
    if (canonicalJSON(job.recipe) !== canonicalJSON(expectedRecipe)) throw new Error("The folder recipe changed before its fonts were saved. Start it again.");
    if (expectedFormat !== null && outputFormatForJob(job) !== expectedFormat) throw new Error("The folder output format changed before its fonts were saved. Start it again.");
    if (job.renderContract.recipeSha256 !== null) return job;
    assertFolderContract({ ...job, renderContract: contract });
    if (!contract.recipeSha256 || records.length !== contract.fonts.length) throw new Error("Incomplete folder font snapshot.");
    for (const reference of contract.fonts) {
      const record = records.find(record => record.id === reference.id);
      if (!(record?.bytes instanceof ArrayBuffer) || record.bytes.byteLength !== reference.byteLength || record.sha256 !== reference.sha256) throw new Error("Incomplete folder font snapshot.");
      fonts.put({ jobId, id: record.id, family: record.family, sha256: record.sha256, byteLength: reference.byteLength, bytes: new Blob([record.bytes]) });
    }
    const next = touch(job, { format: expectedFormat ?? outputFormatForJob(job), renderContract: contract }); jobs.put(next); return next;
  });
}

export function readLargeJobFont(jobId, id) {
  return transact("readonly", ({ fonts }) => requestResult(fonts.get([jobId, id])));
}


const reservedStorage = jobs => jobs.reduce((sum, job) => sum + remainingStagingBytes(job) + remainingPhotoCacheBytes(job), 0);

export async function checkBrowserStagingCapacity() {
  const estimate = await navigator.storage?.estimate?.();
  const jobs = await listLargeJobs();
  assertStagingCapacity(estimate, reservedStorage(jobs));
}

// The plan and the reservation for every other batch are checked together.
// This is an application budget; browser quota may still change or be revoked.
export async function reserveBrowserStaging(jobId, groups, owner) {
  const plan = stagingPlan(groups), estimate = await navigator.storage?.estimate?.();
  return mutate(jobId, owner, async ({jobs}, job) => {
    assertSceneCollection(job);
    if(job.outputMode !== "browser" || job.preparedGroups || job.renderContract.recipeSha256) throw new Error("This batch cannot change its storage plan.");
    if(job.staging) {
      if(canonicalJSON(job.staging) !== canonicalJSON(plan)) throw new Error("This batch already has a different storage plan.");
      return job;
    }
    if(plan.groups.length !== job.recipe.collection.selection.length) throw new Error("Incomplete browser storage plan.");
    if(job.recipe.photoImport && plan.groups.some((group,index)=>group.sha256!==job.importDigests[index])) throw new Error("Finish inspecting each photo group before reserving output storage.");
    const all = await requestResult(jobs.getAll());
    assertStagingCapacity(estimate, plan.totalBytes + reservedStorage(all));
    const next = touch(job,{staging:plan,stagingSpent:0}); jobs.put(next); return next;
  });
}

// Initial source metadata and the job are inserted together. Pixel/hash plans
// arrive one group at a time; a crash can never leave a job missing its inputs.
export async function putPhotoImportJob(job, inputs) {
  assertFolderContract(job); assertSceneCollection(job);
  if (job.recipe.collection.schema !== PHOTO_COLLECTION_SCHEMA || inputs.length !== job.recipe.collection.selection.length) throw new Error("Incomplete photo import selection.");
  for (let index = 0; index < inputs.length; index++) await assertPhotoInputDigest(inputs[index], job.recipe.photoImport.inputDigests[index]);
  const metadataBytes = new TextEncoder().encode(canonicalJSON({ recipe: job.recipe, inputs })).byteLength;
  const estimate = await navigator.storage?.estimate?.();
  return transact("readwrite", async ({ jobs, photos }) => {
    assertStagingCapacity(estimate, reservedStorage(await requestResult(jobs.getAll())) + metadataBytes * 2);
    const value = { ...job, importDigests: [], owner: null, revision: 0 };
    jobs.add(value);
    inputs.forEach((input, index) => photos.add({ jobId: job.id, index, input, group: null }));
    return value;
  });
}

export function getPhotoImportRecord(jobId, index) {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("Invalid photo group index.");
  return transact("readonly", ({ photos }) => requestResult(photos.get([jobId, index])));
}

export async function putPhotoImportDraft(jobId, group, owner) {
  const saved = await getLargeJob(jobId); await assertSceneGroup(group, saved);
  const record = await getPhotoImportRecord(jobId, group.index);
  await assertPhotoInputDigest(record?.input, saved.recipe.photoImport?.inputDigests[group.index]);
  const order = group.project.recipe.photoOrder;
  if (group.project.name !== record.input.name || group.project.id !== saved.recipe.collection.selection[group.index].key.slice(6)
    || !Array.isArray(order) || order.length !== record.input.files.length || order.some((id, index) => {
      const asset = group.project.assets[id], file = record.input.files[index];
      return !asset || asset.name !== file.name || asset.byteLength !== file.byteLength || asset.lastModified !== file.lastModified;
    })) throw new Error("The prepared story does not match its selected photos.");
  const estimate = await navigator.storage?.estimate?.();
  return mutate(jobId, owner, async ({ jobs, photos }, job) => {
    if (canonicalJSON(job.recipe) !== canonicalJSON(saved.recipe) || job.status !== "preparing" || job.renderContract.recipeSha256) throw new Error("This photo batch is no longer accepting plans.");
    const existing = await requestResult(photos.get([jobId, group.index]));
    if (existing?.group) {
      if (existing.group.sha256 !== group.sha256 || job.importDigests[group.index] !== group.sha256) throw new Error("This photo group's plan is already frozen.");
      return job;
    }
    if (!existing || canonicalJSON(existing.input) !== canonicalJSON(record.input) || group.index !== job.importDigests.length) throw new Error("Prepare the photo groups in order.");
    assertStagingCapacity(estimate, reservedStorage(await requestResult(jobs.getAll())) + group.byteLength * 2);
    photos.put({ ...existing, group });
    const next = touch(job, { importDigests: [...job.importDigests, group.sha256] }); jobs.put(next); return next;
  });
}

export async function reservePhotoCache(jobId, groups, owner) {
  const plan = photoCachePlan(groups), estimate = await navigator.storage?.estimate?.();
  return mutate(jobId, owner, async ({ jobs }, job) => {
    assertSceneCollection(job);
    if (!job.recipe.photoImport || job.outputMode !== "folder" || job.preparedGroups || job.renderContract.recipeSha256
      || groups.length !== job.recipe.collection.selection.length || groups.some((group, index) => group.sha256 !== job.importDigests[index])) throw new Error("Finish inspecting each photo group before copying it.");
    if (job.photoCache) {
      if (canonicalJSON(job.photoCache) !== canonicalJSON(plan)) throw new Error("This batch already reserved a different photo cache.");
      return job;
    }
    assertStagingCapacity(estimate, reservedStorage(await requestResult(jobs.getAll())) + plan.totalBytes);
    const next = touch(job, { photoCache: plan, photoCacheSpent: 0 }); jobs.put(next); return next;
  });
}

// Blob, output receipt and counters commit atomically. Killing the worker or a
// quota abort leaves either a complete output or the original processing claim.
export function commitStagedSceneOutput(jobId, index, claimId, record, owner) {
  return mutate(jobId, owner, async ({jobs,entries,outputs,scenes},job) => {
    assertSceneCollection(job); assertFolderContract(job);
    if(job.outputMode !== "browser" || !job.staging || record.recipeSha256 !== job.renderContract.recipeSha256) throw new Error("The staged rendering contract changed.");
    const entry = await requestResult(entries.get([jobId,index])); checkClaim(entry,claimId,owner);
    if(entry.status === "completed") return {entry,job,recovered:true};
    if(entry.status !== "processing" || record.sourceDigest !== entry.groupDigest || record.outputPath !== entry.relativePath
      || !(record.blob instanceof Blob) || !record.blob.size || record.blob.size !== record.outputBytes || !/^[a-f0-9]{64}$/.test(record.outputDigest)) throw new Error("Invalid staged output receipt.");
    if(job.outputBytes + record.outputBytes > job.staging.groups.reduce((sum,group)=>sum+group.outputBytes,0)) throw new Error("The batch exceeded its staged output allowance. Completed files are preserved.");
    const group=await requestResult(scenes.get([jobId,entry.groupIndex])),shape=group?.project.variants.find(shape=>shape.id===entry.variantId);
    const allowance=stagedOutputAllowance(shape?.width,shape?.height);
    if(record.width!==shape.width || record.height!==shape.height || record.format!==group.format || record.outputBytes>allowance) throw new Error("The staged output exceeds its frozen plan.");
    const {blob,recipeSha256,sourceDigest,...patch}=record;
    outputs.add({jobId,index,blob,digest:record.outputDigest});
    const nextEntry={...entry,...patch,status:"completed",error:null};
    const nextJob=touch(job,{completed:job.completed+1,outputBytes:job.outputBytes+blob.size,stagingSpent:job.stagingSpent+allowance});
    entries.put(nextEntry);jobs.put(nextJob);return {entry:nextEntry,job:nextJob,recovered:false};
  });
}

export function readStagedSceneOutput(jobId,index) {
  return transact("readonly",async({outputs,entries,jobs})=>{
    const job=await requestResult(jobs.get(jobId)),entry=await requestResult(entries.get([jobId,index]));
    if(job?.outputMode!=="browser"||entry?.status!=="completed") throw new Error("This staged output is no longer available.");
    return {entry,record:await requestResult(outputs.get([jobId,index]))};
  });
}
