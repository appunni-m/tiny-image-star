import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { VECTOR_GEOMETRY_RUNTIME_ARTIFACTS as artifacts } from '../src/vector-geometry-artifacts.js';
import { VECTOR_GEOMETRY_LIMITS } from '../src/vector-geometry-contract.js';

const packageInfo=JSON.parse(await readFile('node_modules/canvaskit-wasm/package.json','utf8'));
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
assert.equal(packageInfo.version,artifacts.version,'CanvasKit must match the audited package release');
assert.equal(packageInfo.license,'BSD-3-Clause');
assert.equal(lock.packages['node_modules/canvaskit-wasm']?.version,artifacts.version);
assert.equal(lock.packages['node_modules/canvaskit-wasm']?.integrity,artifacts.packageIntegrity);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const wasm=await readFile('node_modules/canvaskit-wasm/bin/canvaskit.wasm');
const loader=await readFile('node_modules/canvaskit-wasm/bin/canvaskit.js');
const license=await readFile('node_modules/canvaskit-wasm/LICENSE');
for(const [name,bytes] of [['wasm',wasm],['loader',loader],['license',license]]){
  assert.equal(bytes.byteLength,artifacts[`${name}SizeBytes`],`${name} must match its audited size`);
  assert.equal(hash(bytes),artifacts[`${name}Sha256`],`${name} must match its audited checksum`);
}
await mkdir('wasm/canvaskit',{recursive:true});await mkdir('src/workers',{recursive:true});
await copyFile('node_modules/canvaskit-wasm/bin/canvaskit.wasm','src/workers/vector-geometry.wasm');
await writeFile('wasm/canvaskit/LICENSE.txt',license);
await build({entryPoints:['src/workers/vector-geometry.worker.js'],outfile:'src/workers/vector-geometry-worker.bundle.js',
  bundle:true,format:'esm',platform:'browser',target:'es2022',legalComments:'eof',minify:true,sourcemap:false,
  define:{process:'undefined'},plugins:[{name:'local-vector-browser-builtins',setup(build){
    build.onResolve({filter:/^(fs|path)$/},args=>({path:args.path,namespace:'browser-builtins'}));
    build.onLoad({filter:/.*/,namespace:'browser-builtins'},()=>({contents:'export default {};',loader:'js'}));
  }}]});
const worker=await readFile('src/workers/vector-geometry-worker.bundle.js');
const manifest={schema:1,runtime:{package:artifacts.package,version:artifacts.version,packageIntegrity:artifacts.packageIntegrity,
  license:'BSD-3-Clause',licenseFile:'canvaskit/LICENSE.txt',
  wasm:{file:'../src/workers/vector-geometry.wasm',sizeBytes:wasm.byteLength,sha256:hash(wasm)},
  upstreamLoader:{sizeBytes:loader.byteLength,sha256:hash(loader)},
  worker:{bundle:'../src/workers/vector-geometry-worker.bundle.js',sizeBytes:worker.byteLength,sha256:hash(worker)},
  licenseArtifact:{sizeBytes:license.byteLength,sha256:hash(license)},
  execution:'lazy dedicated worker; one active job; bounded queue; timeout/cancel termination; idle heap release',
  initialHeapBytes:128*1024*1024,limits:VECTOR_GEOMETRY_LIMITS,
  patterns:['solid','dashed','dotted','custom one dash/one positive gap'],
  conversion:'Native rational conics preserved until bounded editable conversion at0.01 local pixels; native Skia float32/offset precision is separate.'}};
await writeFile('wasm/vector-geometry-runtime.json',`${JSON.stringify(manifest,null,2)}\n`);
console.log(`Built the audited local CanvasKit geometry worker (${worker.byteLength} bytes JS, ${wasm.byteLength} bytes WASM).`);
