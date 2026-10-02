import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const packageVersion = '1.0.1';
const packageIntegrity = 'sha512-rvRE2FmAZ6ZxKSw7wq+e+jQDpN3t1B/tD2mJz9SmAzb1msoDkd4dMoE4wAh8Z30Um0PQwLiHr9QtomhmXk3aUQ==';
const packageWasmFiles = {
  'vision_wasm_internal.js': { sha256: 'e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73', sizeBytes: 323377 },
  'vision_wasm_internal.wasm': { sha256: '8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886', sizeBytes: 11756954 },
  'vision_wasm_nosimd_internal.js': { sha256: 'e81d715a3d42cc3373602eb2f7aff795d164934db680e32496b65dab537f9658', sizeBytes: 323180 },
  'vision_wasm_nosimd_internal.wasm': { sha256: 'a28483cd42e74e855bf5ebdb6b40d9b66a5b49e35e95020bc97669e6822a3192', sizeBytes: 10960242 },
};
const model = {
  source: 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task',
  gcsGeneration: '1781216247171888',
  sha256: '38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03',
  sizeBytes: 30_525_312,
  license: 'Apache-2.0',
  licenseFile: 'mediapipe/APACHE-2.0.txt',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const packageInfo = JSON.parse(await readFile('node_modules/@mediapipe/tasks-vision/package.json', 'utf8'));
const lockfile = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(packageInfo.version, packageVersion, 'MediaPipe Tasks Vision must match the audited package release');
assert.equal(packageInfo.license, 'Apache-2.0', 'MediaPipe Tasks Vision must retain its upstream license');
assert.equal(lockfile.packages['node_modules/@mediapipe/tasks-vision']?.integrity, packageIntegrity,
  'the MediaPipe Tasks Vision package must match its audited npm registry integrity');
assert.equal(lockfile.packages['node_modules/@mediapipe/tasks-vision']?.version, packageVersion);
assert.equal(packageInfo.exports['.'].import, './vision_bundle.mjs');

await mkdir('wasm/mediapipe', { recursive: true });
for (const [name, expected] of Object.entries(packageWasmFiles)) {
  const sourcePath = `node_modules/@mediapipe/tasks-vision/wasm/${name}`;
  const targetPath = `wasm/mediapipe/${name}`;
  await copyFile(sourcePath, targetPath);
  const bytes = await readFile(targetPath);
  assert.equal(bytes.byteLength, expected.sizeBytes, `${name} must match the audited npm package artifact size`);
  assert.equal(hash(bytes), expected.sha256, `${name} must match the audited npm package artifact checksum`);
}

const modelBytes = await readFile('wasm/models/interactive_segmentation.task');
assert.equal(modelBytes.byteLength, model.sizeBytes, 'MagicTouch must match the pinned official model artifact size');
assert.equal(hash(modelBytes), model.sha256, 'MagicTouch must match the pinned official model artifact checksum');
const apacheLicense = await readFile(`wasm/${model.licenseFile}`, 'utf8');
assert.match(apacheLicense, /Apache License\s+Version 2\.0/);

await build({
  entryPoints: ['src/workers/object-isolation.worker.js'],
  outfile: 'src/workers/object-isolation-worker.bundle.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'eof',
  sourcemap: false,
  minify: true,
});

const manifest = {
  schema: 1,
  model: {
    name: 'MediaPipe Interactive Segmenter v2 · MagicTouch int8',
    source: model.source,
    gcsGeneration: model.gcsGeneration,
    file: 'models/interactive_segmentation.task',
    sha256: model.sha256,
    sizeBytes: model.sizeBytes,
    license: model.license,
    licenseFile: model.licenseFile,
    input: { shape: '[1, 768, 768, 3]', type: 'int8', color: 'RGB' },
    output: { type: 'float32', meaning: 'per-pixel foreground confidence in [0, 1]' },
  },
  runtime: {
    package: '@mediapipe/tasks-vision',
    version: packageVersion,
    packageIntegrity,
    license: 'Apache-2.0',
    wasmFiles: packageWasmFiles,
    workerBundle: '../src/workers/object-isolation-worker.bundle.js',
    executionProvider: 'CPU',
    concurrency: 1,
  },
};
await writeFile('wasm/object-isolation-runtime.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built local MagicTouch object-isolation worker and verified its model/runtime assets (${packageVersion}).`);
