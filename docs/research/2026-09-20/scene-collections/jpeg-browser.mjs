import assert from 'node:assert/strict';
export async function assertSceneJPEG(browser,origin){
 const context=await browser.newContext(),page=await context.newPage();
 try{
  await page.goto(origin);
  const result=await page.evaluate(async()=>{
   const {createPhotoStory}=await import('./src/story/recipes.js'),{writeStoryProject}=await import('./src/project/storage.js');
   const {createSceneCollection,prepareSceneCollection,runSceneCollection}=await import('./src/jobs/scene-client.js');
   const {acquireJobOwnership}=await import('./src/jobs/ownership.js'),{getManifestPage}=await import('./src/jobs/store.js');
   const {createPillowEngine}=await import('./src/engine/pillow.js'),{planScene}=await import('./src/compositor/scene-spec.js');
   const {digestBytes}=await import('./src/jobs/output.js'),sources=new Map(),assets=[];
   for(let i=0;i<6;i++){
    const canvas=new OffscreenCanvas(96,64),ctx=canvas.getContext('2d');ctx.fillStyle=`hsl(${i*57},60%,55%)`;ctx.fillRect(0,0,96,64);ctx.fillStyle='#ffd7ac';ctx.fillRect(10,10+i,40,30);
    const blob=await canvas.convertToBlob(),id=`photo-${i}`;sources.set(id,blob);assets.push({id,kind:'image',name:`${i}.png`,type:'image/png',width:96,height:64,orientation:'upright',byteLength:blob.size,sha256:await digestBytes(await blob.arrayBuffer())});
   }
   const project=createPhotoStory(assets,{title:'Default JPEG'});project.variants=[{id:'portrait',width:216,height:270},{id:'tall',width:216,height:384}];
   await writeStoryProject(project,{readAsset:id=>sources.get(id)});
   const job=await createSceneCollection({id:'default-jpeg',selection:[{key:`story:${project.id}`,revision:project.revision,byteLength:assets.reduce((sum,a)=>sum+a.byteLength,0)}],variants:['portrait','tall'],outputBaseHandle:await navigator.storage.getDirectory()});
   const lock=await acquireJobOwnership(job.id);await prepareSceneCollection(job.id,lock.owner);const saved=await runSceneCollection(job.id,lock.owner),entries=await getManifestPage(job.id,0,8),engine=await createPillowEngine(),outputs=[];
   for(const entry of entries){
    const packets=[];for(const asset of planScene(project,entry.slideId,entry.variantId,{format:'jpeg'}).assets)packets.push({id:asset.id,bytes:await sources.get(asset.id).arrayBuffer()});
    const reference=await engine.renderSlide({project,slideId:entry.slideId,variantId:entry.variantId,format:'jpeg',assets:packets});
    const parts=entry.outputPath.split('/'),name=parts.pop();let folder=job.outputHandle;for(const part of parts)folder=await folder.getDirectoryHandle(part);
    const bytes=await(await(await folder.getFileHandle(name)).getFile()).arrayBuffer(),view=new Uint8Array(bytes),image=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
    outputs.push({format:entry.format,jpeg:view[0]===255&&view[1]===216&&view[2]===255,extension:name.endsWith('.jpg'),match:await digestBytes(bytes)===await digestBytes(reference.bytes),dimensions:image.width===reference.width&&image.height===reference.height});image.close();
   }
   await lock.release();return {defaultFormat:job.recipe.collection.format,completed:saved.completed,outputs};
  });
  assert.equal(result.defaultFormat,'jpeg');assert.equal(result.completed,8);assert.equal(result.outputs.length,8);assert.ok(result.outputs.every(v=>v.format==='jpeg'&&v.jpeg&&v.extension&&v.match&&v.dimensions));
  console.log(`scene JPEG observations: ${JSON.stringify(result)}`);
 }finally{await context.close();}
}
