import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const root=process.cwd(),require=createRequire(resolve('package.json')),{chromium}=require('playwright');
const evidence='docs/research/2026-09-17/segmentation/runs/segmentation-ed8c59ef-16a8-465e-855f-fda444ebc375';
const output=resolve('docs/research/2026-09-17/cutout-finishes');await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;const file=resolve(root,pathname==='/'?'index.html':pathname.slice(1));if(!file.startsWith(root+'/'))throw Error('path');res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm','.png':'image/png'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
const report=await page.evaluate(async ({evidence})=>{
const {createPillowEngine}=await import('/src/engine/pillow.js'),engine=await createPillowEngine();const {createSceneProject}=await import('/src/project/model.js');const {fontDigest}=await import('/src/compositor/fonts.js');
const photo=new Uint8Array(await(await fetch(`/${evidence}/astronaut.png`)).arrayBuffer()),mask=new Uint8Array(await(await fetch(`/${evidence}/selfie-CPU-astronaut-mask.png`)).arrayBuffer());
const asset={id:'photo',kind:'image',name:'NASA Eileen Collins portrait',width:512,height:512,type:'image/png',orientation:'upright',byteLength:photo.length,sha256:await fontDigest(photo)};
const subject={...asset,id:'mask',kind:'mask',name:'Research portrait mask',byteLength:mask.length,sha256:await fontDigest(mask)};
const frame={x:.1,y:.25,width:.8,height:.66},nodes={
paper:{id:'paper',kind:'shape',space:'slide',frame:{x:0,y:0,width:1,height:1},color:'#eadbcd'},
heading:{id:'heading',kind:'text',space:'slide',frame:{x:.07,y:.06,width:.86,height:.15},text:'GO BEYOND',color:'#183d49',style:{builtinFont:'system-sans',fontBasis:'width',fontSize:.12,minFontSize:.1,weight:800,fit:'shrink'}},
subject:{id:'subject',kind:'image',space:'slide',frame,assetId:'photo',maskId:'mask',fit:'contain',rotation:-3},
caption:{id:'caption',kind:'text',space:'slide',frame:{x:.07,y:.955,width:.86,height:.03},text:'NASA · Eileen Collins · Public-domain photo',color:'#183d49',style:{builtinFont:'system-sans',fontBasis:'width',fontSize:.02,minFontSize:.02,weight:400,fit:'shrink'}}};
const project=createSceneProject({id:'cutout-finish-photo-proof',assets:{photo:asset,mask:subject},nodes,variants:[{id:'portrait',width:1080,height:1350}]});
const outputs=[];for(const [name,finish] of [['plain',null],['outline',{schema:1,outline:{color:'#fff9f2',width:.006}}],['shadow',{schema:1,shadow:{color:'#273443',opacity:.45,blur:.01,x:.01,y:.015}}],['combined',{schema:1,outline:{color:'#fff9f2',width:.006},shadow:{color:'#273443',opacity:.45,blur:.01,x:.01,y:.015}}]]){
if(finish)project.nodes.subject.cutoutEffects=finish;else delete project.nodes.subject.cutoutEffects;
const result=await engine.renderSlide({project,slideId:project.slides[0].id,variantId:'portrait',assets:[{id:'photo',bytes:photo},{id:'mask',bytes:mask}]});
outputs.push({name,sha256:await fontDigest(result.bytes),width:result.width,height:result.height,bytes:[...result.bytes]});}
return {sourceSha256:asset.sha256,maskSha256:subject.sha256,project,outputs};},{evidence});
for(const result of report.outputs){await writeFile(`${output}/${result.name}.png`,new Uint8Array(result.bytes));delete result.bytes;}
await writeFile(`${output}/evidence.json`,JSON.stringify({recordedAt:new Date().toISOString(),note:'One public-domain portrait with a pre-existing research mask. Visual effect example, not a representative quality gate or automatic selection feature.',...report},null,2)+'\n');
console.log(`Saved ${report.outputs.length} real-photo finish examples to ${output}`);
}finally{await browser.close();await new Promise(done=>server.close(done));}
