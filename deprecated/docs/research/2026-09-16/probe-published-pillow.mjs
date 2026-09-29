import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const [artifactDirectory, outputPath] = process.argv.slice(2);
if (!artifactDirectory || !outputPath) throw new Error('Usage: node docs/research/2026-09-16/probe-published-pillow.mjs <artifact-directory> <output.json> (run from repository root)');
const root=process.cwd();
const report={date:new Date().toISOString(),scope:'Node execution of published WASM, small fixture capability probes only; not mobile certification',versions:[]};
for(const version of ['0.1.3','12.2.0-alpha.1']){
 const base=resolve(artifactDirectory, `v${version}/package`);
 const api=await import(pathToFileURL(`${base}/node.js`)); await api.default();
 const entry={version,wasmBytes:fs.statSync(`${base}/pkg/core/pillow_rs_js_bg.wasm`).size,wasmSha256:crypto.createHash('sha256').update(fs.readFileSync(`${base}/pkg/core/pillow_rs_js_bg.wasm`)).digest('hex'),decoders:{},encoders:{},operations:{}};
 for(const name of fs.readdirSync(`${root}/tests/fixtures`).filter(n=>n.endsWith('.base64'))){
  let im; try{im=api.Image.open(new Uint8Array(Buffer.from(fs.readFileSync(`${root}/tests/fixtures/${name}`,'utf8').trim(),'base64')));im.load();const raw=im.toBytes();entry.decoders[name]={ok:true,width:im.width,height:im.height,mode:im.mode,rawBytes:raw.length};}catch(e){entry.decoders[name]={ok:false,error:String(e)};}finally{im?.free();}
 }
 const im=new api.Image('RGB',8,8,200,60,20,255);
 entry.encoderMethods={save:typeof im.save,saveWithInput:typeof im.saveWithInput,encode:typeof im.encode,saveArity:im.save.length,saveWithInputArity:im.saveWithInput?.length};
 for(const format of ['PNG','JPEG','WEBP','GIF','BMP','TIFF','ICO','AVIF']){
  let re; try{const bytes=im.saveWithInput(format,null); re=api.Image.open(bytes);re.load();entry.encoders[format]={ok:true,bytes:bytes.length,signatureHex:Buffer.from(bytes.subarray(0,16)).toString('hex'),reopenedFormat:re.format,width:re.width,height:re.height,rawBytes:re.toBytes().length};}catch(e){entry.encoders[format]={ok:false,error:String(e)};}finally{re?.free();}
 }
 for(const [name,call] of Object.entries({resize:()=>im.resize(4,4,'LANCZOS'),blur:()=>im.gaussianBlur(2),color:()=>im.enhanceColor(0.8),rotate:()=>im.rotate(90),crop:()=>im.crop(0,0,4,4)})){
  let o;try{o=call();entry.operations[name]={ok:true,width:o.width,height:o.height,rawBytes:o.toBytes().length};}catch(e){entry.operations[name]={ok:false,error:String(e)};}finally{o?.free();}
 }
 const a=new api.Image('RGBA',2,2,255,0,0,255),b=new api.Image('RGBA',2,2,0,0,255,255),mask=new api.Image('L',2,2,255,255,255,255);
 let out;try{out=api.composite(a,b,mask);entry.operations.composite={ok:true,pixel:Array.from(out.getpixel(0,0))};}catch(e){entry.operations.composite={ok:false,error:String(e)};}finally{out?.free();a.free();b.free();mask.free();im.free();}
 report.versions.push(entry);
}
fs.writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
