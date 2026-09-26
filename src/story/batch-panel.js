import { mountStagedExportPanel } from "./staged-export-panel.js";
import { action as makeAction, field, select } from "./view.js";
import { listStoryProjects } from "../project/storage.js";
import { createSceneCollection, prepareSceneCollection, runSceneCollection } from "../jobs/scene-client.js";
import { createPhotoSceneCollection, preparePhotoSceneCollection } from "../jobs/photo-import-client.js";
import { PHOTO_ACCEPT } from "./group-plan.js";
import { acquireJobOwnership } from "../jobs/ownership.js";
import { deleteLargeJob, getFailedManifestPage, getLargeJob, getManifestPage, listLargeJobs } from "../jobs/store.js";

export async function openStoryBatchPanel(returnFocus=document.activeElement, { selectedKeys = [], photoGroups = null, photoStyle = null } = {}) {
  const existing=document.getElementById("story-batch-sheet");if(existing)return existing;
  const freshPhotos=Boolean(photoGroups?.length);let sourceFiles=photoGroups?.flatMap(group=>group.files)??[];
  const sheet=document.createElement("dialog");sheet.className="story-sheet";sheet.id="story-batch-sheet";sheet.setAttribute("aria-labelledby","story-batch-title");
  const header=document.createElement("header"),title=document.createElement("h2");title.id="story-batch-title";title.textContent=freshPhotos?"Export photo groups":"Story batches";
  const content=document.createElement("div");content.className="story-sheet-content";
  const note=document.createElement("p");note.className="story-note";note.textContent="Choose saved stories as your photo groups. Each batch keeps its own copy of edits, photos, cutouts and fonts. Completed files survive pause and reload.";
  if(freshPhotos)note.textContent=`${photoGroups.length} reviewed photo groups · ${photoStyle.name}. This batch keeps its own photo and font copies outside the story library. Grouping and edits are fixed; create editable stories if you want to adjust individual crops or captions.`;
  const newBatchNote=note.textContent;
  const message=document.createElement("p");message.className="story-note";message.setAttribute("role","status");message.dataset.batchStatus="";
  const sources=document.createElement("section");sources.className="story-group-options";sources.setAttribute("aria-label","Resume photo import");
  const sourceNote=document.createElement("p");sourceNote.className="story-note";
  const photoInput=document.createElement("input"),folderInput=document.createElement("input");
  for(const input of [photoInput,folderInput]){input.type="file";input.multiple=true;input.accept=PHOTO_ACCEPT;input.hidden=true;}
  const canReadFolder="webkitdirectory" in folderInput;folderInput.setAttribute("webkitdirectory","");
  const jobs=select([["","New batch"]],"","Saved story batches"),choices=document.createElement("fieldset"),legend=document.createElement("legend");legend.textContent="Stories to copy";choices.append(legend);
  const shapes=select([["portrait","Portrait · 4:5"],["tall","Tall · 9:16"],["both","Both shapes"]],"both","Batch export shapes");
  const format=select([["jpeg","JPEG"],["png","PNG"]],"jpeg","Batch export format");
  const summary=document.createElement("p");summary.className="story-note";summary.dataset.batchSummary="";
  const outputs=document.createElement("ol");outputs.className="story-batch-outputs";
  const filter=document.createElement("input");filter.type="checkbox";const filterLabel=document.createElement("label");filterLabel.className="story-check";filterLabel.append(filter,"Only failed outputs");
  let job=null,lock=null,controller=null,active=null,closed=false,closing=false,creating=false,page=0,renderToken=0,selectionToken=0;
  const navigationId=crypto.randomUUID();
  const picker=()=>globalThis.__tinystarDirectoryPicker??globalThis.showDirectoryPicker;
  const canFolder=()=>typeof picker()==="function";
  const destination=select([...(canFolder()?[["folder","Save to a folder"]]:[]),["browser","Keep in browser for download/share"]],canFolder()?"folder":"browser","Batch destination");
  const destinationField=field("Destination",destination);
  const canChoose=()=>typeof navigator.locks?.request==="function" && (!freshPhotos||typeof navigator.storage?.estimate==="function") && (destination.value==="browser" ? typeof navigator.storage?.estimate==="function" : canFolder());
  const setMessage=value=>{if(!closed)message.textContent=value;};
  const action=(label,callback,primary)=>makeAction(label,()=>{try{Promise.resolve(callback()).catch(error=>setMessage(error.message));}catch(error){setMessage(error.message);}},primary);
  const close=async(manageHistory=true)=>{
    if(closing)return;closing=true;controller?.abort();staged.dispose();
    if(manageHistory&&history.state?.tinyStarBatch===navigationId)history.back();
    await active?.catch(()=>{});await lock?.release();lock=null;sourceFiles=[];photoGroups=null;closed=true;renderToken++;removeEventListener("popstate",navigated);
    sheet.close();sheet.remove();if(returnFocus?.isConnected)returnFocus.focus();
  };
  const navigated=()=>{if(history.state?.tinyStarBatch!==navigationId)void close(false);};
  const done=action("Done",()=>close());header.append(title,done);
  function refresh() {
    if(closed)return;const busy=Boolean(active)||creating;
    note.textContent=job?.recipe.photoImport?"This photo batch keeps its own copies outside the story library. Grouping, preset and output choices are fixed. Completed copies and outputs survive reload; reselect original files for any groups still waiting to be copied.":job?"This batch keeps its own copy of saved stories, including edits, photos, cutouts and fonts.":newBatchNote;
    jobs.disabled=busy;choices.hidden=Boolean(job)||freshPhotos;choices.disabled=busy||Boolean(job);shapes.disabled=format.disabled=busy||Boolean(job);
    destinationField.hidden=Boolean(job);destination.disabled=busy;
    create.textContent=freshPhotos?destination.value==="browser"?"Inspect and copy photo groups":"Choose save folder and copy photo groups":destination.value==="browser"?"Copy stories for download or share":"Choose save folder and copy stories";
    staged.update(job,busy);
    create.hidden=Boolean(job);create.disabled=busy||!canChoose();copy.hidden=!job||job.status!=="preparing";copy.disabled=busy||!lock;
    copy.textContent=job?.recipe.photoImport?"Continue importing photo groups":"Continue copying stories";
    sources.hidden=!job?.recipe.photoImport||job.status!=="preparing";
    choosePhotos.disabled=chooseFolder.disabled=busy||!lock;
    sourceNote.textContent=`${sourceFiles.length} source files selected here. Keep this page open during import. After reopening, reselect the original photos or the same folder for groups not yet copied. Photos already inspected must have unchanged contents. Other photos are checked against their original name, folder, size and modification time.`;
    start.hidden=!job||!job.scanComplete||job.completed+job.failed+job.skipped>=job.discovered;start.disabled=busy||!lock;
    start.textContent=job?.status==="paused"?"Resume remaining":job?.outputMode==="browser"?"Prepare batch files":"Start saving";
    retry.hidden=!job?.failed;retry.disabled=busy||!lock;pause.hidden=!busy;pause.disabled=!controller||Boolean(controller.signal.aborted);
    forget.hidden=!job;forget.disabled=busy||!lock;forget.textContent=job?.outputMode==="browser"?"Delete batch and staged files":"Forget batch";
    summary.textContent=job?job.scanComplete?`${job.discovered.toLocaleString()} planned files · ${job.completed} ${job.outputMode==="browser"?"ready in this browser":"saved"} · ${job.failed} failed · ${Math.max(0,job.discovered-job.completed-job.failed-job.skipped)} remaining. ${job.outputMode==="browser"?`Staging allowance: ${(job.staging.totalBytes/1024/1024).toFixed(1)} MiB; prepared files: ${(job.outputBytes/1024/1024).toFixed(1)} MiB. Download or share to save outside this browser.`:`Save folder: ${job.outputFolderName}.`}`
      :job.recipe.photoImport?`Photo groups · ${job.importDigests.length} of ${job.recipe.collection.selection.length} inspected · ${job.preparedGroups} copied. Output count appears before rendering starts.`:`Copying saved stories · ${job.preparedGroups} of ${job.recipe.collection.selection.length}. Output count appears before saving starts.`
      :freshPhotos?"Choose Portrait, Tall, or both. Completed group copies survive pause and reload. Rendering starts after every source is copied.":"Each selected story keeps its existing photo grouping and corrections. Choose Portrait, Tall, or both.";
    filterLabel.hidden=!job?.scanComplete;previous.hidden=next.hidden=!job?.scanComplete;
  }
  async function renderRows() {
    const token=++renderToken;if(!job?.scanComplete){outputs.replaceChildren();return;}
    const total=filter.checked?job.failed:job.discovered;page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(total/20)-1)));
    const rows=await (filter.checked?getFailedManifestPage:getManifestPage)(job.id,page*20,20);
    if(closed||token!==renderToken)return;outputs.replaceChildren();previous.disabled=page===0;next.disabled=(page+1)*20>=total;
    for(const entry of rows){const row=document.createElement("li");row.dataset.batchOutput=String(entry.index);row.textContent=`${entry.sourceName} · ${entry.status==="completed"?`${job.outputMode==="browser"?"Ready in browser":"Saved"}: ${entry.outputPath}`:entry.error||entry.status}`;
      if(entry.warnings?.length){const warning=document.createElement("p");warning.className="story-note";warning.textContent=entry.warnings.some(value=>value.code==="TEXT_OVERFLOW")?"Review this story: some text is clipped.":"Review this story: a cutout effect needs a subject mask. Open Cutout in the original story, then create a new batch.";row.append(warning);}outputs.append(row);}
    if(!rows.length){const row=document.createElement("li");row.textContent="No outputs need attention.";outputs.append(row);}
  }
  const changed=value=>{job=value;refresh();void renderRows().catch(error=>setMessage(error.message));};
  const prepare=signal=>job.recipe.photoImport?preparePhotoSceneCollection(job.id,lock.owner,{files:sourceFiles,signal,changed,
    progress:value=>setMessage(value.phase==="inspect"?`${value.name}: inspecting photo ${value.done} of ${value.total}…`:`${value.name}: photos copied.`)})
    :prepareSceneCollection(job.id,lock.owner,{signal,changed});
  async function execute(work) {
    if(active||!lock)return;controller=new AbortController();setMessage("");active=Promise.resolve().then(()=>work(controller.signal));refresh();
    try{job=await active;setMessage(job.status==="complete"?job.outputMode==="browser"?"All planned files are ready in this browser. Prepare a group below to download or share.":"All planned files are saved.":job.status==="ready"?"Copies are ready. Review the output count, then start saving.":"Completed files are preserved.");}
    catch(error){job=await getLargeJob(job.id);setMessage(controller.signal.aborted?"Paused. Completed copies and files are preserved.":error.message);}
    finally{active=null;controller=null;refresh();await renderRows();}
  }
  async function chooseJob(id) {
    if(active||creating)return;const token=++selectionToken;await lock?.release();lock=null;const loaded=id?await getLargeJob(id):null;if(closing||token!==selectionToken)return;job=loaded;page=0;
    sourceFiles=(!id&&freshPhotos)?photoGroups.flatMap(group=>group.files):[];
    if(job){const collection=job.recipe.collection;format.value=collection.format;shapes.value=collection.variants.length===2?"both":collection.variants[0];const owned=await acquireJobOwnership(id);if(closing||token!==selectionToken){await owned?.release();return;}lock=owned;if(!lock)setMessage("This batch is open in another tab. Close it there, then reopen it here.");else{job=lock.job;setMessage("");}}
    refresh();await renderRows();
  }
  const create=action("Choose save folder and copy stories",async()=>{
    if(active||creating||job)return;const selection=[...choices.querySelectorAll("input:checked")].map(input=>input.storyRecord);
    if(!freshPhotos&&!selection.length){setMessage("Select at least one saved story.");return;}
    creating=true;refresh();
    try{
      const outputMode=destination.value;
      const outputBaseHandle=outputMode==="browser"?null:await picker().call(globalThis,{id:"tiny-image-star-story-batches",mode:"readwrite",startIn:"pictures"});
      if(closing)return;
      const options={variants:shapes.value==="both"?["portrait","tall"]:[shapes.value],format:format.value,outputBaseHandle,outputMode};
      job=freshPhotos?await createPhotoSceneCollection({...options,groups:photoGroups,style:photoStyle}):await createSceneCollection({...options,selection});
      if(closing)return;
      const owned=await acquireJobOwnership(job.id);if(closing){await owned?.release();return;}lock=owned;if(!lock)throw new Error("This batch is open in another tab.");jobs.add(new Option(job.recipe.name,job.id));jobs.value=job.id;
      creating=false;await execute(prepare);
    }catch(error){if(error.name!=="AbortError")setMessage(error.message);}finally{creating=false;refresh();}
  },true);
  const copy=action("Continue copying stories",()=>execute(prepare));
  const choosePhotos=action("Reselect original photos",()=>photoInput.click());
  const chooseFolder=action("Reselect original folder",()=>folderInput.click());chooseFolder.hidden=!canReadFolder;
  sources.append(sourceNote,choosePhotos,chooseFolder,photoInput,folderInput);
  for(const input of [photoInput,folderInput])input.addEventListener("change",()=>{if(active||closing)return;const files=Array.from(input.files);input.value="";if(files.length){sourceFiles=files;setMessage("Sources selected. Continue importing to verify and copy the remaining groups.");refresh();}});
  const start=action("Start saving",()=>execute(signal=>runSceneCollection(job.id,lock.owner,{signal,changed})),true);
  const retry=action("Retry failed outputs",()=>execute(signal=>runSceneCollection(job.id,lock.owner,{signal,changed,retryFailed:true})));
  const pause=action("Pause",()=>{controller?.abort();refresh();});
  const forget=action("Forget batch",async()=>{if(active||!job||!lock)return;try{const id=job.id,wasStaged=job.outputMode==="browser";if(wasStaged&&!confirm("Delete this batch and all files staged in this browser? Download or share files you want to keep first. This cannot be undone."))return;await deleteLargeJob(id,lock.owner);await chooseJob("");jobs.querySelector(`option[value="${CSS.escape(id)}"]`)?.remove();jobs.value="";setMessage(wasStaged?"Batch copies and staged files removed. Files already downloaded or shared are unchanged.":"Batch copies removed. Exported files remain in their save folder.");}catch(error){setMessage(error.message);}});
  const previous=action("Previous 20",()=>{page--;return renderRows();}),next=action("Next 20",()=>{page++;return renderRows();});
  content.append(note,field("Saved batches",jobs),choices,field("Shapes",shapes),field("Format",format),destinationField,create,sources,copy,summary,start,pause,retry,filterLabel,outputs,previous,next,forget,message);
  const staged=mountStagedExportPanel(content,setMessage);
  content.insertBefore(staged.element,filterLabel);
  destination.addEventListener("change",refresh);
  sheet.append(header,content);document.body.append(sheet);sheet.showModal();history.pushState({...history.state,tinyStarBatch:navigationId},"");addEventListener("popstate",navigated);refresh();
  sheet.addEventListener("cancel",event=>{event.preventDefault();void close();});jobs.addEventListener("change",()=>void chooseJob(jobs.value).catch(error=>setMessage(error.message)));
  filter.addEventListener("change",()=>{page=0;void renderRows();});
  try{
    const [stories,batches]=await Promise.all([listStoryProjects(),listLargeJobs()]);if(closed)return;
    const preselected = new Map(selectedKeys.map((key, index) => [key, index]));
    const orderedStories = [...stories].sort((a, b) => (preselected.get(a.key) ?? Infinity) - (preselected.get(b.key) ?? Infinity));
    for(const item of orderedStories){const input=document.createElement("input");input.type="checkbox";input.checked=preselected.has(item.key);input.storyRecord={key:item.key,revision:item.revision,byteLength:item.byteLength};const label=document.createElement("label");label.className="story-check";label.append(input,`${item.name} · revision ${item.revision}`);choices.append(label);}
    for(const batch of batches.filter(value=>value.kind==="scene-collection"))jobs.add(new Option(`${batch.recipe.name} · ${batch.completed}/${batch.discovered} ${batch.outputMode==="browser"?"ready":"saved"}`,batch.id));
    if(!stories.length&&!freshPhotos&&!batches.some(batch=>batch.recipe?.photoImport))setMessage("Save a story first, or use Make several stories to create a photo batch.");
    if(!canChoose())setMessage("This browser does not provide the locks or storage estimates needed for safe batches. Open an individual story’s Export tool to download or share it.");
  }catch(error){setMessage(error.message);}
  return sheet;
}
