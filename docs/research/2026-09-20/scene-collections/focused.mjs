import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const root='/Users/lazytrot/work/tiny-image-star';
const serve=process.env.TINY_IMAGE_STAR_BROWSER_ROOT ?? root;
const { chromium }=createRequire(`${root}/package.json`)('playwright');
const { assertSceneCollections }=await import(`${root}/tests/scene-collection.browser.mjs`);
const server=http.createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const name=resolve(serve,`.${pathname.endsWith('/')?pathname+'index.html':pathname}`);
    if(!name.startsWith(`${serve}/`)){response.writeHead(403).end();return;}
    response.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.html':'text/html'})[extname(name)]??'application/octet-stream');
    response.end(await readFile(name));
  } catch {response.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true});
try {await assertSceneCollections(browser,`http://127.0.0.1:${server.address().port}/`);console.log('focused scene collections PASS');}
finally{await browser.close();server.close();}
