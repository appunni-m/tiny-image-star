import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function assertBalancedCssBlocks(source) {
  const opens = [];
  let quote = null;
  let escaped = false;
  let comment = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (comment) {
      if (current === '*' && next === '/') { comment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === '/' && next === '*') { comment = true; index += 1; continue; }
    if (current === '"' || current === "'") { quote = current; continue; }
    if (current === '{') opens.push(index);
    else if (current === '}') {
      if (!opens.length) {
        const line = source.slice(0, index).split('\n').length;
        throw new Error(`Unmatched closing brace in styles.css at line ${line}.`);
      }
      opens.pop();
    }
  }
  if (comment || quote || opens.length) throw new Error('Unclosed comment, string, or block in styles.css.');
}

const index = await readFile(resolve(root, 'index.html'), 'utf8');
assert.match(index, /href="\.\/styles\.css"/, 'the deployed page must load its stylesheet with a relative URL');
assert.match(index, /src="\.\/src\/main\.js"/, 'the deployed page must load its editor module with a relative URL');
assert.match(index, /accept="\.flocal,\.fig,application\/octet-stream"/, 'the open-file picker must accept local .fig files alongside .flocal packages');
assert.match(index, /id="fig-import-dialog"/, 'the local importer must present its loss review before switching designs');
assert.match(index, /id="fig-import-warning-list"/, 'the import review must have a dedicated warning list');
assert.doesNotMatch(index, /(?:src|href)="\/(?!\/)/, 'the deployed page must not use root-absolute assets');
assertBalancedCssBlocks(await readFile(resolve(root, 'styles.css'), 'utf8'));

for (const path of [
  'styles.css', 'src/main.js', 'src/comment-selection.js', 'src/vector-offset.js', 'src/boolean-geometry.js', 'src/shape-builder-edit.js', 'src/design-token-interop.js', 'src/appearance-clipboard.js', 'src/image-fills.js', 'src/image-output.js', 'src/layer-blend.js', 'src/layout-guides.js', 'src/inspect.js', 'src/smart-animate.js', 'src/image-worker.js', 'src/pdf-vector-export.js', 'src/tab-list-keyboard.js', 'src/variable-stroke-geometry.js', 'src/vector-anchor-selection.js', 'src/slice-export-plan.js', 'src/prepared-inpaint-cache.js', 'wasm/pillow_rs_js.js',
  'src/fig-import-worker-client.js', 'src/fig-import-preflight.js', 'src/fig-import.js', 'src/workers/fig-import.worker.js', 'src/workers/fig-import-worker.bundle.js',
  'src/inpaint-mask.js', 'src/workers/inpaint.worker.js', 'src/workers/inpaint-worker.bundle.js',
  'THIRD_PARTY_NOTICES.md',
  'wasm/pillow_rs_js_bg.wasm', 'wasm/runtime.json', 'wasm/PILLOW_RS_LICENSE.txt',
  'wasm/inpaint-runtime.json', 'wasm/models/migan_pipeline_v2.onnx', 'wasm/models/MI-GAN-LICENSE.txt',
  'wasm/onnxruntime/ort-wasm-simd-threaded.mjs', 'wasm/onnxruntime/ort-wasm-simd-threaded.wasm'
]) await access(resolve(root, path));

const worker = await readFile(resolve(root, 'src/image-worker.js'), 'utf8');
assert.match(worker, /\.\.\/wasm\/pillow_rs_js\.js/, 'the worker must load the local Pillow-RS runtime');
const runtime = JSON.parse(await readFile(resolve(root, 'wasm/runtime.json'), 'utf8'));
const runtimeBuilder = await readFile(resolve(root, 'scripts/build-pillow-runtime.mjs'), 'utf8');
const readme = await readFile(resolve(root, 'README.md'), 'utf8');
assert.equal(runtime.package, 'pillow-rs');
assert.equal(runtime.version, '12.2.0-alpha.5');
assert.match(runtime.sourceCommit, /^[a-f0-9]{40}$/);
assert.equal(runtime.sourceRef, 'main');
assert.equal(runtime.sourceRef, runtimeBuilder.match(/const sourceRef = '([^']+)';/)?.[1],
  'the vendored runtime must name the upstream Pillow-RS ref pinned by the build script');
assert.equal(runtime.sourceCommit, runtimeBuilder.match(/const sourceCommit = '([a-f0-9]{40})';/)?.[1],
  'the vendored runtime must be built from the exact Pillow-RS commit pinned by the build script');
assert.equal(runtime.artifactSource, `Release-profile WASM compiled from upstream ${runtime.sourceRef} at commit ${runtime.sourceCommit} with the local JPEG/WebP quality patch and fixed build toolchain.`);
assert.ok(readme.includes(`https://github.com/appunni-m/pillow-rs/commit/${runtime.sourceCommit}`),
  'README provenance must match the pinned Pillow-RS runtime commit');
assert.equal(runtime.sourcePatch.path, 'patches/pillow-rs/encode-quality.patch');
assert.deepEqual(runtime.buildToolchain, { rust: '1.96.1', wasmPack: '0.15.0', wasmOpt: false });
assert.equal(runtime.buildToolchain.rust, runtimeBuilder.match(/const expectedRustVersion = '([^']+)';/)?.[1]);
assert.equal(runtime.buildToolchain.wasmPack, runtimeBuilder.match(/const expectedWasmPackVersion = '([^']+)';/)?.[1]);
const runtimePatch = await readFile(resolve(root, runtime.sourcePatch.path));
assert.equal(createHash('sha256').update(runtimePatch).digest('hex'), runtime.sourcePatch.sha256);
const runtimeIntegrity = createHash('sha512');
for (const name of Object.keys(runtime.files).sort()) {
  const bytes = await readFile(resolve(root, 'wasm', name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), runtime.files[name], `${name} must match its pinned checksum`);
  runtimeIntegrity.update(name).update('\0').update(bytes).update('\0');
}
assert.equal(runtime.integrityAlgorithm, 'sha512 over each sorted filename, NUL, file bytes, NUL');
assert.equal(runtime.integrity, `sha512-${runtimeIntegrity.digest('base64')}`);
const pillowRuntime = await readFile(resolve(root, 'wasm/pillow_rs_js.js'), 'utf8');
assert.match(pillowRuntime, /saveWithQuality\(/, 'the vendored WASM binding must expose local JPEG/WebP quality controls');
const figWorker = await readFile(resolve(root, 'src/workers/fig-import-worker.bundle.js'), 'utf8');
assert.match(figWorker, /fig-kiwi/, 'the deployed local import worker must contain the .fig binary decoder');
assert.doesNotMatch(figWorker, /(?:^|[;\n])\s*import\s+[^;]*from\s+["']https?:\/\//m, 'the local import worker must not load remote code');
const inpaintWorker = await readFile(resolve(root, 'src/workers/inpaint-worker.bundle.js'), 'utf8');
assert.match(inpaintWorker, /InferenceSession/, 'the deployed object-erase worker must bundle ONNX Runtime');
assert.match(inpaintWorker, /ort-wasm-simd-threaded\.wasm/, 'object erase must select the locally pinned WASM binary');
assert.match(inpaintWorker, /migan_pipeline_v2\.onnx/, 'object erase must load the local model artifact');
const inpaintManifest = JSON.parse(await readFile(resolve(root, 'wasm/inpaint-runtime.json'), 'utf8'));
assert.equal(inpaintManifest.runtime.package, 'onnxruntime-web');
assert.equal(inpaintManifest.runtime.version, '1.30.0');
assert.equal(inpaintManifest.model.license, 'MIT');
assert.equal(inpaintManifest.model.inputs.image.type, 'uint8');
assert.equal(inpaintManifest.model.inputs.mask.values.erase, 0);
assert.equal(inpaintManifest.model.inputs.mask.values.known, 255);
assert.equal(inpaintManifest.model.output.name, 'result');
const inpaintModelBytes = await readFile(resolve(root, `wasm/${inpaintManifest.model.file}`));
assert.equal(inpaintModelBytes.byteLength, inpaintManifest.model.sizeBytes);
assert.equal(createHash('sha256').update(inpaintModelBytes).digest('hex'), inpaintManifest.model.sha256,
  'the deployed MI-GAN artifact must match its pinned upstream checksum');
for (const [name, expectedHash] of Object.entries(inpaintManifest.runtime.files)) {
  const bytes = await readFile(resolve(root, 'wasm/onnxruntime', name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash,
    `${name} must match the pinned ONNX Runtime Web package`);
}
const inpaintLicense = await readFile(resolve(root, `wasm/${inpaintManifest.model.licenseFile}`), 'utf8');
assert.match(inpaintLicense, /MIT License/);
console.log('Static deployment inputs, Pillow-RS WASM, local ONNX inference runtime, and both workers: PASS');
