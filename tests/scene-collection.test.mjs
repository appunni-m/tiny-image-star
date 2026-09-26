import test from "node:test";
import assert from "node:assert/strict";
import {createPhotoStory} from "../src/story/recipes.js";
import {assertSceneCollection,createSceneCollectionJob,createSceneGroup,assertSceneGroup,sceneOutputEntries} from "../src/jobs/scene-plan.js";
const project=()=>createPhotoStory(Array.from({length:6},(_,i)=>({id:`photo-${i}`,kind:"image",name:`${i}.png`,type:"image/png",width:300,height:200,byteLength:100,sha256:i.toString(16).padStart(64,"0"),orientation:"upright"})),{title:"Same name"});
const selection=()=>[{key:"story:first",revision:0,byteLength:600},{key:"story:second",revision:0,byteLength:600}];
const job=()=>createSceneCollectionJob({id:"batch",selection:selection(),variants:["portrait","tall"],format:"png"});

test("story collections validate exact bounded selections, formats and shapes",()=>{
  const value=job();assert.equal(assertSceneCollection(value).selection.length,2);
  for(const patch of [{selection:[]},{selection:Array(1001).fill(selection()[0])},{selection:[selection()[0],selection()[0]]},
    {selection:[{...selection()[0],revision:-1}]},{selection:[{...selection()[0],byteLength:129*1024*1024}]},
    {variants:["portrait","portrait"]},{variants:["square"]},{format:"webp"},{digests:["bad"]},{extra:true}]){
    const invalid=job();Object.assign(invalid.recipe.collection,patch);assert.throws(()=>assertSceneCollection(invalid));
  }
});
test("group snapshots bind copied edits, order, format and variants before outputs are claimed",async()=>{
  const value=job(),source=project(),group=await createSceneGroup(source,0,value.recipe.collection);
  await assertSceneGroup(group,value);source.name="Changed";source.slides.reverse();
  assert.equal(group.project.name,"Same name");assert.equal(group.items.length,8);
  const changed=structuredClone(group);changed.project.name="Changed";await assert.rejects(()=>assertSceneGroup(changed,value),/snapshot changed/);
  const wrong=project();wrong.revision=1;await assert.rejects(()=>createSceneGroup(wrong,0,value.recipe.collection),/story changed/);
});
test("equal story names still produce unique group paths, source identities and complete output counts",async()=>{
  const value=job(),a=await createSceneGroup(project(),0,value.recipe.collection),b=await createSceneGroup(project(),1,value.recipe.collection);
  const entries=[...sceneOutputEntries(value.id,a,0),...sceneOutputEntries(value.id,b,8)];
  assert.equal(new Set(entries.map(row=>row.relativePath)).size,16);assert.deepEqual(entries.map(row=>row.index),Array.from({length:16},(_,i)=>i));
  assert.ok(entries.every(row=>row.sourceIdentity.sha256===row.groupDigest&&row.sourceIdentity.bytes===row.sourceBytes));
  assert.throws(()=>sceneOutputEntries(value.id,a,99999),/100,000/);
});
test("group preparation rejects changed asset sizes and malformed saved asset identities",async()=>{
  const value=job(),source=project();source.assets[Object.keys(source.assets)[0]].byteLength++;
  await assert.rejects(()=>createSceneGroup(source,0,value.recipe.collection),/asset size changed/);
  const missing=project();delete missing.assets[Object.keys(missing.assets)[0]].sha256;
  await assert.rejects(()=>createSceneGroup(missing,0,value.recipe.collection));
});
