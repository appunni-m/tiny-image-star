import http from "node:http";
import {readFile,mkdtemp,rm} from "node:fs/promises";
import {resolve,extname,join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {chromium,webkit} from "playwright";
import {assertStagedScenes} from "../tests/staged-scene.browser.mjs";
import {assertStorageWindow} from "../tests/storage-window.browser.mjs";
const projectRoot=dirname(dirname(fileURLToPath(import.meta.url))),root=resolve(process.env.TINY_IMAGE_STAR_BROWSER_ROOT??projectRoot);
const names=(process.env.TINY_IMAGE_STAR_STAGED_BROWSERS??"webkit").split(",");
if(names.some(name=>!["chromium","webkit"].includes(name)))throw new Error("Unsupported staged-browser profile.");
const server=http.createServer(async(request,response)=>{
 try{
  const pathname=decodeURIComponent(new URL(request.url,"http://localhost").pathname),path=resolve(root,`.${pathname.endsWith("/")?pathname+"index.html":pathname}`);
  if(!path.startsWith(`${root}/`)){response.writeHead(403).end();return;}
  response.setHeader("Content-Type",({".js":"text/javascript",".mjs":"text/javascript",".wasm":"application/wasm",".css":"text/css",".html":"text/html"})[extname(path)]??"application/octet-stream");response.end(await readFile(path));
 }catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}/`;
try{
 for(const name of names){
  const type={chromium,webkit}[name],browser=await type.launch({headless:true});
  try {await assertStorageWindow(browser,origin);if(name==="chromium")await assertStagedScenes(browser,origin);} finally{await browser.close();}
  if(name==="webkit"){
   const directory=await mkdtemp(join(tmpdir(),"tinystar-staged-webkit-"));let context;
   try {await assertStagedScenes({newContext:async options=>{context=await type.launchPersistentContext(directory,{headless:true,...options});return context;}},origin);}
   finally{await context?.close();await rm(directory,{recursive:true,force:true});}
  }
  console.log(`verify:staged-browser ${name} PASS (${name==="webkit"?"regular-profile workflow; separate private-window storage capability":"workflow and storage capability"})`);
 }
} finally {await new Promise(resolve=>server.close(resolve));}
