import { canonicalJSON, clone } from "../project/model.js";
import { planStoryExports } from "../story/export-plan.js";
import { createLargeJob } from "./core.js";
import { folderRecipeDigest } from "./render-contract.js";
import { FOLDER_SOURCE_SCHEMA } from "./source-contract.js";
import { PHOTO_COLLECTION_SCHEMA, assertPhotoImportDefinition } from "./photo-import-plan.js";

export const SCENE_COLLECTION_SCHEMA = "tinystar/scene-collection@1";
export const SCENE_GROUP_SCHEMA = "tinystar/scene-group@1";
export const MAX_SCENE_GROUPS = 1000;
export const MAX_SCENE_OUTPUTS = 100000;
export const MAX_SCENE_ASSET_BYTES = 128 * 1024 * 1024;
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(" ") === [...keys].sort().join(" ");

export function assertSceneCollection(job) {
  const value = job?.recipe?.collection;
  if (job?.outputMode !== undefined && !["folder", "browser"].includes(job.outputMode)) throw new Error("Unsupported batch destination.");
  if (job?.kind !== "scene-collection" || !exact(value,["schema","selection","variants","format","digests"])
    || ![SCENE_COLLECTION_SCHEMA, PHOTO_COLLECTION_SCHEMA].includes(value.schema) || !["png","jpeg"].includes(value.format)
    || !Array.isArray(value.variants) || !value.variants.length || value.variants.length > 2
    || new Set(value.variants).size !== value.variants.length || value.variants.some(id=>!["portrait","tall"].includes(id))
    || !Array.isArray(value.selection) || !value.selection.length || value.selection.length > MAX_SCENE_GROUPS) {
    throw new Error("This saved story batch has an unsupported plan. Its outputs are preserved.");
  }
  if (value.schema === PHOTO_COLLECTION_SCHEMA) {
    assertPhotoImportDefinition(job.recipe.photoImport, value.selection.length);
    if (!Array.isArray(job.importDigests) || job.importDigests.length > value.selection.length
      || job.importDigests.some(hash => !/^[a-f0-9]{64}$/.test(hash))
      || !Number.isSafeInteger(job.preparedGroups) || job.preparedGroups < 0 || job.preparedGroups > job.importDigests.length
      || value.digests !== null && canonicalJSON(value.digests) !== canonicalJSON(job.importDigests)) throw new Error("The saved photo inspection receipts are invalid.");
  }
  else if (job.recipe.photoImport !== undefined) throw new Error("Photo imports require the current batch schema.");
  const seen = new Set();
  if(value.digests!==null&&(!Array.isArray(value.digests)||value.digests.length!==value.selection.length||value.digests.some(hash=>!/^[a-f0-9]{64}$/.test(hash))))throw new Error("The story batch's snapshot list is invalid.");
  for (const item of value.selection) {
    if (!exact(item,["key","revision","byteLength"]) || typeof item.key !== "string" || !item.key.startsWith("story:") || item.key.length > 200
      || seen.has(item.key) || !Number.isSafeInteger(item.revision) || item.revision < 0
      || !Number.isSafeInteger(item.byteLength) || item.byteLength < 0 || item.byteLength > MAX_SCENE_ASSET_BYTES) {
      throw new Error("Choose supported saved story revisions for this batch.");
    }
    seen.add(item.key);
  }
  return value;
}

export function createSceneCollectionJob({ id, name = "Story batch", selection, variants = ["portrait"], format = "jpeg", createdAt, outputMode = "folder" }) {
  const collection = { schema:SCENE_COLLECTION_SCHEMA,selection:clone(selection),variants:clone(variants),format,digests:null };
  const job = { ...createLargeJob({id,createdAt,recipe:{id:"story-batch",name,operations:{format},collection}}),
    kind:"scene-collection",outputMode,status:"preparing",preparedGroups:0,snapshotBytes:0 };
  assertSceneCollection(job); return job;
}

export async function createSceneGroup(project, index, collection) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= collection.selection.length) throw new Error("Invalid story group index.");
  const selected = collection.selection[index];
  if (project.revision !== selected.revision) throw new Error("A selected story changed before it was copied. Start a new batch with the current revision.");
  const plan = planStoryExports(project,{variants:collection.variants,format:collection.format});
  const assets = Object.values(plan.project.assets), bytes = assets.reduce((sum,asset)=>sum+asset.byteLength,0);
  if (bytes !== selected.byteLength || bytes > MAX_SCENE_ASSET_BYTES) throw new Error("The selected story's asset size changed before copying.");
  const unique = new Map();
  for (const asset of assets) {
    if (!/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1
      || unique.has(asset.sha256) && unique.get(asset.sha256) !== asset.byteLength) throw new Error("A story asset has an invalid identity.");
    unique.set(asset.sha256,asset.byteLength);
  }
  const snapshot = {schema:SCENE_GROUP_SCHEMA,index,project:plan.project,variants:plan.variants,format:plan.format,items:plan.items};
  return { ...snapshot,sha256:await folderRecipeDigest(snapshot),byteLength:new TextEncoder().encode(canonicalJSON(snapshot)).byteLength };
}

export async function assertSceneGroup(group, job) {
  const collection=assertSceneCollection(job);
  if (!exact(group,["schema","index","project","variants","format","items","sha256","byteLength"]) || group.schema!==SCENE_GROUP_SCHEMA) throw new Error("The saved story snapshot is invalid.");
  const expected=await createSceneGroup(group.project,group.index,collection);
  if(canonicalJSON(expected)!==canonicalJSON(group))throw new Error("The saved story snapshot changed. Its outputs are preserved.");
  if (job.recipe.photoImport && job.importDigests[group.index] && job.importDigests[group.index] !== group.sha256) throw new Error("This story no longer matches its inspected photo group.");
  return group;
}

export function sceneOutputEntries(jobId, group, firstIndex) {
  if (!Number.isSafeInteger(firstIndex) || firstIndex < 0 || firstIndex + group.items.length > MAX_SCENE_OUTPUTS) throw new Error("This story batch exceeds the 100,000-output planning limit.");
  return group.items.map((item,offset)=>({jobId,index:firstIndex+offset,groupIndex:group.index,groupDigest:group.sha256,
    slideId:item.slideId,variantId:item.variantId,sourceName:`${group.project.name} · ${item.variantId} · slide ${item.slideIndex+1}`,
    relativePath:`${String(group.index+1).padStart(4,"0")}/${item.name}`,sourceBytes:group.byteLength,lastModified:0,
    sourceIdentity:{schema:FOLDER_SOURCE_SCHEMA,sha256:group.sha256,bytes:group.byteLength,lastModified:0},
    status:"pending",attempts:0,outputPath:null,outputBytes:0,width:0,height:0,format:null,error:null}));
}
