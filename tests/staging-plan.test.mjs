import test from "node:test";
import assert from "node:assert/strict";
import {stagedOutputAllowance,stagedGroupPlan,stagingPlan,remainingStagingBytes,assertStagingCapacity,STORAGE_HEADROOM,MAX_STAGING_BYTES} from "../src/jobs/staging-plan.js";
const group={sha256:"a".repeat(64),byteLength:1000,project:{assets:{a:{byteLength:100}},variants:[{id:"portrait",width:1080,height:1350},{id:"tall",width:1080,height:1920}]},items:[{variantId:"portrait"},{variantId:"tall"}]};
test("browser storage preflight includes every output shape, copied sources and metadata",()=>{
 const planned=stagedGroupPlan(group),expected=(1080*1350+1080*1920)*8+2*1024*1024;
 assert.equal(planned.outputBytes,expected);assert.equal(planned.metadataBytes,2000+2*4096);assert.equal(planned.sourceBytes,100);
 assert.equal(stagingPlan([planned]).totalBytes,expected+100+2000+8192);
 assert.throws(()=>stagedOutputAllowance(0,1));assert.throws(()=>stagedOutputAllowance(1.5,2));
});
test("browser staging bounds invalid plans and releases committed allowances exactly",()=>{
 const plan=stagingPlan([stagedGroupPlan(group)]);
 assert.equal(remainingStagingBytes({outputMode:"browser",staging:plan,stagingSpent:100}),plan.totalBytes-100);
 assert.equal(remainingStagingBytes({outputMode:"browser",staging:plan,stagingSpent:plan.totalBytes}),0);
 assert.throws(()=>remainingStagingBytes({outputMode:"browser",staging:plan,stagingSpent:plan.totalBytes+1}));
 assert.throws(()=>stagingPlan([{...stagedGroupPlan(group),outputBytes:MAX_STAGING_BYTES}]),/2 GiB/);
 assert.throws(()=>stagingPlan([{...stagedGroupPlan(group),unknown:1}]));
});
test("available storage must cover every outstanding reservation and headroom",()=>{
 const reserved=3000,quota=STORAGE_HEADROOM+4000;
 assert.doesNotThrow(()=>assertStagingCapacity({usage:1000,quota},reserved));
 assert.throws(()=>assertStagingCapacity({usage:1001,quota},reserved),error=>error.code==="STORAGE_FULL");
 for(const estimate of [undefined,{quota:Infinity,usage:0},{quota:1,usage:-1},{quota:0,usage:0}])assert.throws(()=>assertStagingCapacity(estimate,reserved));
});

test("Blob-storage failures remain actionable while quota errors retain their identity",async()=>{
 const {storageTransactionError}=await import("../src/project/storage-errors.js");
 const cause=new DOMException("Error preparing Blob/File data to be stored in object store","UnknownError");
 const message=storageTransactionError(cause,"failed");assert.equal(message.name,"StorageUnavailableError");assert.match(message.message,/regular browser window/);assert.equal(message.cause,cause);
 const quota=new DOMException("quota","QuotaExceededError");assert.equal(storageTransactionError(quota,"failed"),quota);
 assert.equal(storageTransactionError(null,"interrupted").message,"interrupted");
});
