import { getProcessingScheduler } from "../processing/client.js";
import { sceneInspectionWork, sceneSnapshotWork } from "./scene-worker.js";
import { assertSceneCollection, createSceneCollectionJob } from "./scene-plan.js";
import { getLargeJob, putLargeJob, sealSceneCollection, patchLargeJob, claimPendingEntries,
  commitManifestEntry, releaseClaimedEntries, resetInterruptedEntries, retryFailedEntries, reserveBrowserStaging, checkBrowserStagingCapacity } from "./store.js";

const aborted=signal=>{if(signal?.aborted)throw new DOMException("Story batch paused.","AbortError");};

export async function createSceneCollection({selection,variants,format,name,outputBaseHandle,outputMode="folder",id=`stories-${crypto.randomUUID()}`}) {
  const job=createSceneCollectionJob({id,name,selection,variants,format,outputMode});
  if(outputMode === "browser"){await putLargeJob(job);return job;}
  if(!outputBaseHandle)throw new Error("Choose a save folder for this story batch.");
  job.outputBaseHandle=outputBaseHandle;job.outputFolderName=`story-batch-${crypto.randomUUID()}`;
  job.outputHandle=await outputBaseHandle.getDirectoryHandle(job.outputFolderName,{create:true});
  await putLargeJob(job);return job;
}

export async function prepareSceneCollection(jobId,owner,{signal,changed=()=>{},pool=getProcessingScheduler()}={}) {
  let job=await getLargeJob(jobId);const collection=assertSceneCollection(job);
  if(job.recipe.photoImport)throw new Error("Use the photo import controls to reselect and copy this batch's original photos.");
  if(job.renderContract.recipeSha256)return job;
  if(job.outputMode === "browser" && !job.staging){
    const groups=[];
    for(let index=0;index<collection.selection.length;index++){
      aborted(signal);
      const result=await pool.enqueue({kind:"folder",priority:1,signal,workClass:"inspect",estimate:sceneInspectionWork(),
        prepare:()=>({message:{type:"scene-plan",jobId,entry:{index},owner}})}).promise;
      if(result.type!=="result")throw new Error(result.message||"The storage plan could not be prepared.");
      groups.push(result.stagingGroup);
    }
    aborted(signal);job=await reserveBrowserStaging(jobId,groups,owner);changed(job);
  }
  for(let index=job.preparedGroups;index<collection.selection.length;index++){
    aborted(signal);
    const result=await pool.enqueue({kind:"folder",priority:1,signal,workClass:"inspect",estimate:sceneSnapshotWork(collection.selection[index].byteLength),
      prepare:()=>({message:{type:"scene-snapshot",jobId,entry:{index},owner}})}).promise;
    if(result.type!=="result")throw new Error(result.message||"A story could not be copied.");
    job=await getLargeJob(jobId);changed(job);
  }
  aborted(signal);job=await sealSceneCollection(jobId,owner);changed(job);return job;
}

export async function enqueueSceneEntry(job,entry,owner,{signal,pool=getProcessingScheduler()}={}) {
  aborted(signal);
  if(job.outputMode === "browser")await checkBrowserStagingCapacity();
  const message={jobId:job.id,entry,owner,recipe:job.recipe};
  const inspected=await pool.enqueue({kind:"folder",priority:1,signal,workClass:"inspect",estimate:sceneInspectionWork(),prepare:()=>({message:{...message,type:"scene-inspect"}})}).promise;
  if(inspected.type!=="result")throw new Error(inspected.message||"This story output could not be inspected.");
  aborted(signal);
  return pool.enqueue({kind:"folder",priority:1,signal,workClass:inspected.workClass,
    estimate:inspected.estimate,prepare:async()=>{if(job.outputMode === "browser")await checkBrowserStagingCapacity();return {message:{...message,type:"scene-process"}};}}).promise;
}

// A bounded set of consumers claims one output each. No full collection of
// scene bytes or rendered results is retained by this coordinator.
export async function runSceneCollection(jobId,owner,{signal,retryFailed=false,changed=()=>{},pool=getProcessingScheduler()}={}) {
  let job=await getLargeJob(jobId);assertSceneCollection(job);
  if(!job.scanComplete||!job.renderContract.recipeSha256)throw new Error("Finish copying every story before starting this batch.");
  if(job.outputMode !== "browser" && !job.outputHandle)throw new Error("The story batch's saved destination is missing.");
  const handle=job.outputBaseHandle??job.outputHandle;
  if(job.outputMode !== "browser" && typeof handle.queryPermission==="function"&&await handle.queryPermission({mode:"readwrite"})!=="granted"
    &&await handle.requestPermission({mode:"readwrite"})!=="granted")throw new Error("Save-folder permission is needed to resume this batch.");
  aborted(signal);
  await resetInterruptedEntries(jobId,owner);
  if(retryFailed)await retryFailedEntries(jobId,owner);
  job=await patchLargeJob(jobId,{status:"running",error:null},owner);changed(job);
  const externalSignal=signal,runController=new AbortController(),cancel=()=>runController.abort();
  externalSignal?.addEventListener("abort",cancel,{once:true});if(externalSignal?.aborted)cancel();signal=runController.signal;
  let failure;
  const consumers=Array.from({length:Math.max(1,Math.min(32,pool.budget.cpu))},async()=>{
    try {
    while(!signal?.aborted&&!failure){
      const [entry]=await claimPendingEntries(jobId,1,owner);if(!entry)return;
      try{
        aborted(signal);const result=await enqueueSceneEntry(job,entry,owner,{signal,pool});
        if(result.type!=="result")throw Object.assign(new Error(result.message||"This story output could not be saved."),{code:result.code});
      }catch(error){
        if(error.code === "STORAGE_FULL" || error.name === "QuotaExceededError"){failure??=error;runController.abort();}
        if(signal?.aborted || failure)await releaseClaimedEntries(jobId,[entry],owner);
        else await commitManifestEntry(jobId,entry.index,entry.claimId,{status:"failed",error:error.message},owner);
      }
      changed(await getLargeJob(jobId));
    }
    } catch(error) { failure??=error; }
  });
  const results=await Promise.allSettled(consumers);externalSignal?.removeEventListener("abort",cancel);
  failure??=results.find(result=>result.status==="rejected")?.reason;
  if(failure){await patchLargeJob(jobId,{status:"paused",error:failure.message},owner);throw failure;}
  job=await getLargeJob(jobId);
  const remaining=job.discovered-job.completed-job.failed-job.skipped;
  job=await patchLargeJob(jobId,{status:remaining?"paused":job.failed?"needs-attention":"complete"},owner);changed(job);return job;
}
