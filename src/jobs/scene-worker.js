import { readStoryProject } from "../project/storage.js";
import { planScene } from "../compositor/scene-spec.js";
import { sceneWork, inspectionWork } from "../processing/policy.js";
import { assertSceneCollection, assertSceneGroup, createSceneGroup } from "./scene-plan.js";
import { getLargeJob, getSceneGroup, putSceneGroup, readSceneAsset, checkBrowserStagingCapacity, commitStagedSceneOutput } from "./store.js";
import { folderRenderRequest } from "./render-context.js";
import { folderRecipeDigest } from "./render-contract.js";
import { stagedGroupPlan } from "./staging-plan.js";
import { withJobWriteGate } from "./ownership.js";
import { assertFolderRecipe } from "./render-contract.js";
import { digestBytes, saveJournaledOutput } from "./output.js";
import { MAX_PROJECT_BYTES } from "../project/model.js";

export const sceneInspectionWork=()=>inspectionWork(MAX_PROJECT_BYTES*2);
export const sceneSnapshotWork=bytes=>{const estimate=inspectionWork(bytes);return {...estimate,transient:estimate.transient+MAX_PROJECT_BYTES*8};};

export function sceneJournalWork(plan) {
  const estimate=sceneWork(plan);
  // Saved-output reconciliation may overlap encoded output, a file read and
  // its digest snapshot. Assets/fonts remain covered by the scene estimate.
  return {...estimate,transient:estimate.transient+estimate.output*2+MAX_PROJECT_BYTES*8};
}

function checkBudget(expected,actual) {
  if(!actual||expected.heap>actual.heap||expected.transient>actual.transient||expected.output>actual.output)throw new Error("This story exceeds its admitted processing budget.");
}

export async function inspectSceneSnapshot(message) {
  checkBudget(sceneInspectionWork(),message.memoryEstimate);
  const job=await getLargeJob(message.jobId),collection=assertSceneCollection(job),index=message.entry.index;
  if(job.owner?.token!==message.owner?.token||job.owner?.epoch!==message.owner?.epoch)throw new Error("This batch belongs to another tab.");
  const selected=collection.selection[index];if(!selected)throw new Error("Invalid story group index.");
  const opened=await readStoryProject(selected.key);
  if(!opened)throw new Error("A selected story is no longer saved.");
  return {stagingGroup:stagedGroupPlan(await createSceneGroup(opened.project,index,collection))};
}

export async function snapshotSceneGroup(message) {
  const job=await getLargeJob(message.jobId),collection=assertSceneCollection(job),index=message.entry.index;
  if(job.owner?.token!==message.owner?.token||job.owner?.epoch!==message.owner?.epoch)throw new Error("This batch belongs to another tab.");
  if(!Number.isInteger(index)||index<0||index>=collection.selection.length)throw new Error("Invalid story group index.");
  const existing=await getSceneGroup(job.id,index);
  if(existing){await assertSceneGroup(existing,job);return {groupIndex:index,groupDigest:existing.sha256};}
  if(job.status!=="preparing")throw new Error("This batch is no longer copying stories.");
  const selected=collection.selection[index];checkBudget(sceneSnapshotWork(selected.byteLength),message.memoryEstimate);
  if(job.outputMode === "browser")await checkBrowserStagingCapacity();
  const opened=await readStoryProject(selected.key);
  if(!opened)throw new Error("A selected story is no longer saved. Its existing batch snapshots are preserved.");
  const group=await createSceneGroup(opened.project,index,collection),records=[],seen=new Set();
  for(const asset of Object.values(group.project.assets)){
    if(seen.has(asset.sha256))continue;
    // readAsset validates SHA-256 and returns an immutable Blob. Only this
    // admitted worker expands bytes, one asset at a time during the copy.
    const blob=await opened.readAsset(asset.id);records.push({sha256:asset.sha256,blob});seen.add(asset.sha256);
  }
  await putSceneGroup(job.id,group,records,message.owner);
  return {groupIndex:index,groupDigest:group.sha256};
}

async function sceneEntryPlan(message) {
  const {job,entry}=await folderRenderRequest(message),collection=assertSceneCollection(job);
  if(!job.renderContract.recipeSha256||!collection.digests||(job.outputMode!=="browser"&&!job.outputHandle))throw new Error("Finish preparing this story batch before processing.");
  const group=await getSceneGroup(job.id,entry.groupIndex);await assertSceneGroup(group,job);
  if(collection.digests[group.index]!==group.sha256||entry.groupDigest!==group.sha256)throw new Error("The frozen story revision does not match this output.");
  const item=group.items.find(item=>item.slideId===entry.slideId&&item.variantId===entry.variantId);
  if(!item||entry.relativePath!==`${String(group.index+1).padStart(4,"0")}/${item.name}`)throw new Error("The saved story output path changed.");
  const request={project:group.project,slideId:item.slideId,variantId:item.variantId,format:group.format,preview:false,memoryEstimate:message.memoryEstimate};
  const plan=planScene(group.project,item.slideId,item.variantId,request);
  return {job,entry,group,request,plan};
}

export async function inspectSceneEntry(message) {
  checkBudget(sceneInspectionWork(),message.memoryEstimate);
  const {group,plan}=await sceneEntryPlan(message);
  return {estimate:sceneJournalWork(plan),workClass:`scene-folder:${group.format}:${Math.floor(Math.log2(plan.width*plan.height))}:${plan.nodes.length}:${plan.assets.length}`};
}

export async function renderSceneEntry(message,engine) {
  const {job,entry,group,request,plan}=await sceneEntryPlan(message);checkBudget(sceneJournalWork(plan),message.memoryEstimate);
  if(job.outputMode === "browser")await checkBrowserStagingCapacity();
  const assets=[];
  for(const asset of plan.assets){
    const blob=await readSceneAsset(job.id,asset.sha256);
    if(!(blob instanceof Blob)||blob.size!==asset.byteLength)throw new Error("A saved batch asset is missing or changed. Existing outputs are preserved.");
    assets.push({id:asset.id,bytes:await blob.arrayBuffer()});
  }
  const result=await engine.renderSlide({...request,assets});
  const committed=job.outputMode === "browser" ? await withJobWriteGate(job.id,async()=>{
    const fresh=await getLargeJob(job.id);await assertFolderRecipe(fresh);
    if(fresh.renderContract.recipeSha256!==job.renderContract.recipeSha256)throw new Error("The batch rendering contract changed.");
    await checkBrowserStagingCapacity();
    return commitStagedSceneOutput(job.id,entry.index,entry.claimId,{blob:new Blob([result.bytes],{type:result.mime}),
      outputPath:entry.relativePath,outputBytes:result.bytes.byteLength,outputDigest:await digestBytes(result.bytes),
      sourceDigest:group.sha256,recipeSha256:job.renderContract.recipeSha256,width:result.width,height:result.height,
      format:result.format,warnings:result.warnings??[]},message.owner);
  }) : await saveJournaledOutput({jobId:job.id,entry,owner:message.owner,outputRoot:job.outputHandle,outputPath:entry.relativePath,result,
    sourceDigest:group.sha256,renderDigest:await folderRecipeDigest(job.renderContract)});
  return {index:entry.index,claimId:entry.claimId,outputPath:entry.relativePath,outputBytes:result.outputBytes,
    width:result.width,height:result.height,format:result.format,warnings:result.warnings,recovered:committed.recovered};
}
