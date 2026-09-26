import assert from "node:assert/strict";

// A real Blob round trip distinguishes window capability without user-agent
// sniffing. A rejected app save must be atomic and explain how to recover.
export async function assertStorageWindow(browser,origin){
 const context=await browser.newContext(),page=await context.newPage();
 try{
  await page.goto(origin);
  const observed=await page.evaluate(async()=>{
   const canvas=new OffscreenCanvas(8,8);canvas.getContext("2d").fillRect(0,0,8,8);const blob=await canvas.convertToBlob();
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("tinystar-blob-capability-test",1);r.onupgradeneeded=()=>r.result.createObjectStore("probe");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const tx=db.transaction("probe","readwrite"),request=tx.objectStore("probe").put(blob,"blob");let nativeError;
   request.onerror=()=>{nativeError={name:request.error.name,message:request.error.message};};
   const native=await new Promise(resolve=>{tx.oncomplete=()=>resolve(true);tx.onabort=()=>resolve(false);});db.close();
   const {createPhotoStory}=await import("./src/story/recipes.js"),{writeStoryProject,listStoryProjects,hashAsset}=await import("./src/project/storage.js");
   const sha256=await hashAsset(await blob.arrayBuffer()),assets=Array.from({length:6},(_,index)=>({id:`probe-${index}`,kind:"image",name:`${index}.png`,type:"image/png",width:8,height:8,byteLength:blob.size,sha256,orientation:"upright"}));
   let saved=false,error;
   try{await writeStoryProject(createPhotoStory(assets),{readAsset:()=>blob});saved=true;}catch(value){error={name:value.name,message:value.message};}
   return {native,nativeError,saved,error,records:(await listStoryProjects()).length};
  });
  if(observed.native){assert.equal(observed.saved,true);assert.equal(observed.records,1);}
  else {assert.equal(observed.nativeError?.name,"UnknownError");assert.equal(observed.saved,false);assert.equal(observed.records,0);assert.equal(observed.error?.name,"StorageUnavailableError");assert.match(observed.error.message,/regular browser window/);}
  console.log(`storage window observations: ${JSON.stringify(observed)}`);return observed;
 }finally{await context.close();}
}
