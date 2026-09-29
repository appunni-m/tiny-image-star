import { clone, MAX_PROJECT_BYTES } from "../project/model.js";
import { applyProjectCommand } from "../project/history.js";
import { importStoryPhotos } from "../story/assets.js";
import { createPhotoStory } from "../story/recipes.js";
import { storyStyleCommand } from "../styles/model.js";
import { loadStoryFont } from "../styles/font-pack.js";
import { readStoredStoryAsset, hashAsset } from "../project/storage.js";
import { getProcessingScheduler } from "../processing/client.js";
import { assertFolderContract, folderRecipeDigest } from "./render-contract.js";
import { assertSceneCollection, assertSceneGroup, createSceneCollectionJob, createSceneGroup } from "./scene-plan.js";
import { PHOTO_COLLECTION_SCHEMA, photoImportDefinition, assertPhotoInputDigest, indexPhotoFiles, matchPhotoFiles } from "./photo-import-plan.js";
import { stagedGroupPlan } from "./staging-plan.js";
import { withJobWriteGate } from "./ownership.js";
import { getLargeJob, putPhotoImportJob, getPhotoImportRecord, putPhotoImportDraft, reservePhotoCache,
  reserveBrowserStaging, checkBrowserStagingCapacity, putSceneGroup, readSceneAsset, sealSceneCollection, patchLargeJob } from "./store.js";

const aborted = signal => { if (signal?.aborted) throw new DOMException("Photo import paused.", "AbortError"); };

export async function createPhotoSceneCollection({ groups, style, variants, format, name = "Photo story batch", outputMode = "browser", outputBaseHandle }) {
  if (!Array.isArray(groups) || !groups.length || groups.length > 1000) throw new Error("Choose 1–1,000 photo groups.");
  const { inputs, definition } = await photoImportDefinition(groups, style), id = `photos-${crypto.randomUUID()}`;
  const fontBytes = definition.style.assets.reduce((sum, asset) => sum + asset.byteLength, 0);
  const selection = inputs.map((input, index) => ({ key: `story:${id}-${index}`, revision: 0,
    byteLength: input.files.reduce((sum, file) => sum + file.byteLength, 0) + fontBytes }));
  const job = createSceneCollectionJob({ id, name, selection, variants, format, outputMode });
  job.recipe.collection.schema = PHOTO_COLLECTION_SCHEMA; job.recipe.photoImport = definition; job.importDigests = [];
  assertSceneCollection(job); await folderRecipeDigest(job.recipe);
  if (outputMode === "folder") {
    if (!outputBaseHandle) throw new Error("Choose a save folder for the photo batch.");
    job.outputBaseHandle = outputBaseHandle; job.outputFolderName = `story-batch-${crypto.randomUUID()}`;
    job.outputHandle = await outputBaseHandle.getDirectoryHandle(job.outputFolderName, { create: true });
  }
  return putPhotoImportJob(job, inputs);
}

async function readPlan(job, index) {
  const record = await getPhotoImportRecord(job.id, index);
  await assertPhotoInputDigest(record?.input, job.recipe.photoImport.inputDigests[index]);
  if (record.group) {
    await assertSceneGroup(record.group, job);
    if (record.group.sha256 !== job.importDigests[index]) throw new Error("The saved import fingerprint changed. Existing copies are preserved.");
  } else if (job.importDigests[index]) throw new Error("A saved photo group plan is missing. Existing copies are preserved.");
  return record;
}

async function withPhotoMemory(pool, job, index, signal, work) {
  const owner = `photo-batch:${crypto.randomUUID()}`, sourceBytes = job.recipe.collection.selection[index].byteLength;
  // Active File handles, immutable Blob snapshots, sequential digest reads,
  // fonts and project clones are covered before expanding any source bytes.
  await pool.reserveRetainedBytes(owner, sourceBytes * 4 + MAX_PROJECT_BYTES * 8, { signal, reuseWorkers: true });
  try { aborted(signal); return await work(); }
  finally { pool.setRetainedBytes(owner, 0); }
}

async function inspectGroup(job, index, record, files, owner, { signal, pool, progress }) {
  const sources = matchPhotoFiles(record.input, files);
  return withPhotoMemory(pool, job, index, signal, async () => {
    const entries = await importStoryPhotos(sources, { signal, pool,
      onProgress: (done, total) => progress({ phase: "inspect", index, name: record.input.name, done, total }) });
    aborted(signal);
    const base = createPhotoStory(entries.map(entry => entry.asset), { title: record.input.name });
    const project = applyProjectCommand(base, storyStyleCommand(base, clone(job.recipe.photoImport.style))).project;
    project.id = job.recipe.collection.selection[index].key.slice(6); project.revision = 0; project.createdAt = job.createdAt;
    const group = await createSceneGroup(project, index, job.recipe.collection);
    aborted(signal);
    return withJobWriteGate(job.id, () => putPhotoImportDraft(job.id, group, owner));
  });
}

async function copyGroup(job, index, record, files, owner, { signal, pool, progress }) {
  const group = record.group;
  if (!group) throw new Error("Inspect every photo group before copying sources.");
  const sources = matchPhotoFiles(record.input, files);
  return withPhotoMemory(pool, job, index, signal, async () => {
    await checkBrowserStagingCapacity();
    const photoSources = new Map(group.project.recipe.photoOrder.map((id, slot) => [id, sources[slot]]));
    const records = [], seen = new Set();
    for (const asset of Object.values(group.project.assets)) {
      aborted(signal); if (seen.has(asset.sha256)) continue;
      let source = photoSources.get(asset.id);
      if (!source) source = await readSceneAsset(job.id, asset.sha256) ?? await readStoredStoryAsset(asset) ?? await loadStoryFont(asset, { signal });
      aborted(signal);
      if (!(source instanceof Blob) || source.size !== asset.byteLength) throw new Error(`Reselect the unchanged original: ${asset.name}.`);
      const bytes = await source.arrayBuffer();
      if (await hashAsset(bytes) !== asset.sha256) throw new Error(`${asset.name} changed after inspection. Reselect the unchanged original or create a new batch. Completed groups are preserved.`);
      aborted(signal);
      // Own the verified bytes, including for a File whose disk backing might
      // change, or an IDB Blob whose originating library is later cleared.
      records.push({ sha256: asset.sha256, blob: new Blob([bytes], { type: asset.type }) }); seen.add(asset.sha256);
    }
    aborted(signal);
    return withJobWriteGate(job.id, async () => {
      await checkBrowserStagingCapacity(); aborted(signal);
      const saved = await putSceneGroup(job.id, group, records, owner);
      progress({ phase: "copy", index, name: record.input.name }); return saved;
    });
  });
}

export async function preparePhotoSceneCollection(jobId, owner, { files = [], signal, changed = () => {}, progress = () => {}, pool = getProcessingScheduler() } = {}) {
  let job = await getLargeJob(jobId); assertFolderContract(job); const collection = assertSceneCollection(job);
  if (collection.schema !== PHOTO_COLLECTION_SCHEMA) throw new Error("Choose a fresh-photo batch to import.");
  if (job.owner?.token !== owner?.token || job.owner?.epoch !== owner?.epoch) throw new Error("This batch is open in another tab.");
  if (job.renderContract.recipeSha256) return job;
  const sources = indexPhotoFiles(files);
  try {
    // First freeze complete geometry and source hashes in durable metadata.
    // Later passes reuse these exact plans instead of regenerating layouts.
    for (let index = job.importDigests.length; index < collection.selection.length; index++) {
      aborted(signal);
      const record = await readPlan(job, index);
      job = await inspectGroup(job, index, record, sources, owner, { signal, pool, progress }); changed(job);
    }
    if (job.outputMode === "browser" ? !job.staging : !job.photoCache) {
      const groups = [];
      for (let index = 0; index < collection.selection.length; index++) {
        aborted(signal);
        const { group } = await readPlan(job, index); groups.push(stagedGroupPlan(group));
      }
      aborted(signal);
      job = job.outputMode === "browser" ? await reserveBrowserStaging(jobId, groups, owner)
        : await reservePhotoCache(jobId, groups.map(({ sha256, sourceBytes, metadataBytes }) => ({ sha256, sourceBytes, metadataBytes })), owner);
      changed(job);
    }
    for (let index = job.preparedGroups; index < collection.selection.length; index++) {
      aborted(signal);
      const record = await readPlan(job, index);
      job = await copyGroup(job, index, record, sources, owner, { signal, pool, progress }); changed(job);
    }
    aborted(signal); job = await sealSceneCollection(jobId, owner); changed(job); return job;
  } catch (error) {
    await patchLargeJob(jobId, { error: error.name === "AbortError" ? null : error.message }, owner).catch(() => {});
    throw error;
  }
}
