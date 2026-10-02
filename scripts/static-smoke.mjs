import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

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
const pagesWorkflow = await readFile(resolve(root, '.github/workflows/pages.yml'), 'utf8');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
assert.match(index, /href="\.\/styles\.css"/, 'the deployed page must load its stylesheet with a relative URL');
assert.match(index, /src="\.\/src\/main\.js"/, 'the deployed page must load its editor module with a relative URL');
assert.match(index, /accept="\.flocal,\.fig,application\/octet-stream"/, 'the open-file picker must accept local .fig files alongside .flocal packages');
assert.match(index, /id="fig-import-dialog"/, 'the local importer must present its loss review before switching designs');
assert.match(index, /id="fig-import-warning-list"/, 'the import review must have a dedicated warning list');
assert.doesNotMatch(index, /(?:src|href)="\/(?!\/)/, 'the deployed page must not use root-absolute assets');
assert.equal((pagesWorkflow.match(/npm run build:object-isolation-worker/g) || []).length, 2,
  'both verification and GitHub Pages deployment must build the bundled local object-isolation worker');
assert.equal((pagesWorkflow.match(/npm run build:woff2-worker/g) || []).length, 2,
  'both verification and GitHub Pages deployment must build the local WOFF2 decoder worker');
assert.equal((pagesWorkflow.match(/npm run build:font-shaping-worker/g) || []).length, 2,
  'both verification and GitHub Pages deployment must build the local font-shaping worker');
assert.match(packageJson.scripts.predev, /build:woff2-worker/);
assert.match(packageJson.scripts.pretest, /build:woff2-worker/);
assert.match(packageJson.scripts['preverify:static'], /build:woff2-worker/);
assert.match(packageJson.scripts.predev, /build:font-shaping-worker/);
assert.match(packageJson.scripts.pretest, /build:font-shaping-worker/);
assert.match(packageJson.scripts['preverify:static'], /build:font-shaping-worker/);
assertBalancedCssBlocks(await readFile(resolve(root, 'styles.css'), 'utf8'));

for (const path of [
  'styles.css', 'src/main.js', 'src/comment-selection.js', 'src/vector-offset.js', 'src/boolean-geometry.js', 'src/shape-builder-edit.js', 'src/design-token-interop.js', 'src/appearance-clipboard.js', 'src/image-fills.js', 'src/image-output.js', 'src/layer-blend.js', 'src/layout-guides.js', 'src/inspect.js', 'src/smart-animate.js', 'src/image-worker.js', 'src/pdf-vector-export.js', 'src/tab-list-keyboard.js', 'src/variable-stroke-geometry.js', 'src/vector-anchor-selection.js', 'src/slice-export-plan.js', 'src/prepared-inpaint-cache.js', 'wasm/pillow_rs_js.js',
  'src/fig-import-worker-client.js', 'src/fig-import-preflight.js', 'src/fig-import.js', 'src/workers/fig-import.worker.js', 'src/workers/fig-import-worker.bundle.js',
  'src/inpaint-mask.js', 'src/workers/inpaint.worker.js', 'src/workers/inpaint-worker.bundle.js',
  'src/object-isolation-mask.js', 'src/object-isolation-engine.js',
  'src/workers/object-isolation.worker.js', 'src/workers/object-isolation-worker.bundle.js',
  'scripts/build-object-isolation-worker.mjs',
  'src/woff2-decoder.js', 'src/workers/woff2-decompress.worker.js', 'src/workers/woff2-decompress-worker.bundle.js', 'scripts/build-woff2-worker.mjs',
  'wasm/woff2-runtime.json', 'wasm/woff2/LICENSE.txt', 'wasm/woff2/GOOGLE-WOFF2-LICENSE.txt', 'wasm/woff2/GOOGLE-BROTLI-LICENSE.txt',
  'src/font-shaping.js', 'src/workers/font-shaping.worker.js', 'src/workers/font-shaping-worker.bundle.js', 'src/workers/harfbuzz.wasm', 'scripts/build-font-shaping-worker.mjs',
  'wasm/harfbuzz-runtime.json', 'wasm/harfbuzz/LICENSE.txt',
  'tests/fixtures/fonts/inter-latin-variable.woff2', 'tests/fixtures/fonts/OFL.txt', 'tests/fixtures/fonts/README.md',
  'THIRD_PARTY_NOTICES.md',
  'wasm/pillow_rs_js_bg.wasm', 'wasm/runtime.json', 'wasm/PILLOW_RS_LICENSE.txt',
  'wasm/inpaint-runtime.json', 'wasm/models/migan_pipeline_v2.onnx', 'wasm/models/MI-GAN-LICENSE.txt',
  'wasm/onnxruntime/ort-wasm-simd-threaded.mjs', 'wasm/onnxruntime/ort-wasm-simd-threaded.wasm',
  'wasm/object-isolation-runtime.json', 'wasm/models/interactive_segmentation.task', 'wasm/models/MAGICTOUCH-NOTICE.txt',
  'wasm/mediapipe/APACHE-2.0.txt', 'wasm/mediapipe/vision_wasm_internal.js', 'wasm/mediapipe/vision_wasm_internal.wasm',
  'wasm/mediapipe/vision_wasm_nosimd_internal.js', 'wasm/mediapipe/vision_wasm_nosimd_internal.wasm'
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

const objectIsolationManifest = JSON.parse(await readFile(resolve(root, 'wasm/object-isolation-runtime.json'), 'utf8'));
assert.equal(objectIsolationManifest.model.name, 'MediaPipe Interactive Segmenter v2 · MagicTouch int8');
assert.equal(objectIsolationManifest.model.license, 'Apache-2.0');
assert.equal(objectIsolationManifest.model.gcsGeneration, '1781216247171888');
assert.equal(objectIsolationManifest.runtime.package, '@mediapipe/tasks-vision');
assert.equal(objectIsolationManifest.runtime.version, '1.0.1');
assert.equal(objectIsolationManifest.runtime.packageIntegrity,
  'sha512-rvRE2FmAZ6ZxKSw7wq+e+jQDpN3t1B/tD2mJz9SmAzb1msoDkd4dMoE4wAh8Z30Um0PQwLiHr9QtomhmXk3aUQ==');
assert.equal(objectIsolationManifest.runtime.concurrency, 1);
assert.equal(objectIsolationManifest.runtime.executionProvider, 'CPU');
const isolationModelBytes = await readFile(resolve(root, `wasm/${objectIsolationManifest.model.file}`));
assert.equal(isolationModelBytes.byteLength, objectIsolationManifest.model.sizeBytes);
assert.equal(createHash('sha256').update(isolationModelBytes).digest('hex'), objectIsolationManifest.model.sha256,
  'the deployed MagicTouch model must match its pinned official artifact');
const isolationArchive = unzipSync(isolationModelBytes);
assert.ok(isolationArchive['interactive_segmentation_encoder.int8.tflite']);
assert.ok(isolationArchive['interactive_segmentation_decoder.int8.tflite']);
const taskManifest = new TextDecoder().decode(isolationArchive['manifest.pb']);
assert.match(taskManifest, /Google LLC/);
assert.match(taskManifest, /interactive_segmenter_v2/);
assert.match(taskManifest, /Apache 2\.0/);
for (const [name, expected] of Object.entries(objectIsolationManifest.runtime.wasmFiles)) {
  const bytes = await readFile(resolve(root, 'wasm/mediapipe', name));
  assert.equal(bytes.byteLength, expected.sizeBytes, `${name} must match its pinned package size`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256,
    `${name} must match its pinned @mediapipe/tasks-vision artifact`);
}
const mediaPipeLicense = await readFile(resolve(root, `wasm/${objectIsolationManifest.model.licenseFile}`), 'utf8');
assert.match(mediaPipeLicense, /Apache License\s+Version 2\.0/);
const isolationWorker = await readFile(resolve(root, 'src/workers/object-isolation.worker.js'), 'utf8');
assert.match(isolationWorker, /@mediapipe\/tasks-vision/);
assert.match(isolationWorker, /wasm\/mediapipe\//);
assert.match(isolationWorker, /models\/interactive_segmentation\.task/);
assert.match(isolationWorker, /delegate: 'CPU'/);
assert.doesNotMatch(isolationWorker, /https?:\/\//, 'object isolation must not use remote inference, model, or runtime fallbacks');
const isolationWorkerBundle = await readFile(resolve(root, 'src/workers/object-isolation-worker.bundle.js'), 'utf8');
assert.match(isolationWorkerBundle, /createFromOptions/);
assert.doesNotMatch(isolationWorkerBundle, /(?:^|[;\n])\s*import\s+[^;]*from\s+["']https?:\/\//m,
  'the local object-isolation worker must not load remote code');
const woff2Manifest = JSON.parse(await readFile(resolve(root, 'wasm/woff2-runtime.json'), 'utf8'));
assert.equal(woff2Manifest.decoder.package, 'woff2-encoder');
assert.equal(woff2Manifest.decoder.version, '2.0.0');
assert.equal(woff2Manifest.decoder.entryPoint, 'woff2-encoder/decompress');
assert.equal(woff2Manifest.decoder.license, 'MIT');
assert.equal(woff2Manifest.decoder.wasmEmbeddedInWorker, true);
assert.equal(woff2Manifest.decoder.maxInputBytes, 20 * 1024 * 1024);
assert.equal(woff2Manifest.decoder.maxDecodedBytes, 30 * 1024 * 1024);
const woff2Worker = await readFile(resolve(root, 'src/workers/woff2-decompress-worker.bundle.js'));
assert.equal(woff2Worker.byteLength, woff2Manifest.worker.sizeBytes);
assert.equal(createHash('sha256').update(woff2Worker).digest('hex'), woff2Manifest.worker.sha256,
  'the deployed WOFF2 worker must match its runtime manifest');
assert.match(woff2Worker.toString(), /data:application\/octet-stream;base64,/,
  'the WOFF2 decoder WASM must be embedded in the local worker bundle');
assert.doesNotMatch(woff2Worker.toString(), /(?:^|[;\n])\s*import\s+[^;]*from\s+["']https?:\/\//m,
  'the local WOFF2 worker must not load remote code');
const woff2License = await readFile(resolve(root, 'wasm/woff2/LICENSE.txt'));
assert.equal(woff2License.byteLength, woff2Manifest.license.sizeBytes);
assert.equal(createHash('sha256').update(woff2License).digest('hex'), woff2Manifest.license.sha256);
assert.match(woff2License.toString(), /MIT License/);
for (const [name, license] of Object.entries(woff2Manifest.upstreamLicenses)) {
  const bytes = await readFile(resolve(root, 'wasm', license.file));
  assert.equal(bytes.byteLength, license.sizeBytes, `${name} license must match the WOFF2 runtime manifest`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), license.sha256, `${name} license must match its pinned hash`);
  assert.match(bytes.toString(), /Permission is hereby granted/, `${name} license text must be complete`);
}
const harfbuzzManifest = JSON.parse(await readFile(resolve(root, 'wasm/harfbuzz-runtime.json'), 'utf8'));
assert.equal(harfbuzzManifest.runtime.package, 'harfbuzzjs');
assert.equal(harfbuzzManifest.runtime.version, '1.6.2');
assert.equal(harfbuzzManifest.runtime.packageIntegrity, 'sha512-95c1vWuzoHjM19d5fQgPbz1wcv1pTa0UM9dZrdPgSMUEVuSwuzeVPkq6UhHHw3jLOkE9AYzzTP8XQkRBpPYpEg==');
assert.equal(harfbuzzManifest.runtime.license, 'MIT');
const harfbuzzWorker = await readFile(resolve(root, 'src/workers/font-shaping-worker.bundle.js'));
assert.equal(harfbuzzWorker.byteLength, harfbuzzManifest.runtime.worker.sizeBytes);
assert.equal(createHash('sha256').update(harfbuzzWorker).digest('hex'), harfbuzzManifest.runtime.worker.sha256,
  'the deployed HarfBuzz worker bundle must match its runtime manifest');
assert.doesNotMatch(harfbuzzWorker.toString(), /(?:^|[;\n])\s*import\s+[^;]*from\s+["']https?:\/\//m,
  'the local HarfBuzz worker must not load remote code');
const harfbuzzWasm = await readFile(resolve(root, 'src/workers/harfbuzz.wasm'));
assert.equal(harfbuzzWasm.byteLength, harfbuzzManifest.runtime.wasm.sizeBytes);
assert.equal(createHash('sha256').update(harfbuzzWasm).digest('hex'), harfbuzzManifest.runtime.wasm.sha256,
  'the local HarfBuzz WASM must match its runtime manifest');
const harfbuzzLicense = await readFile(resolve(root, 'wasm/harfbuzz/LICENSE.txt'));
assert.match(harfbuzzLicense.toString(), /Permission is hereby granted/);
assert.match(harfbuzzLicense.toString(), /THE SOFTWARE IS PROVIDED "AS IS"/);
const interFixtureLicense = await readFile(resolve(root, 'tests/fixtures/fonts/OFL.txt'), 'utf8');
assert.match(interFixtureLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
console.log('Static deployment inputs, local Pillow-RS/ONNX/MediaPipe/WOFF2 runtimes, models, and workers: PASS');
