import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const modelPath = 'wasm/models/realesr-general-x4v3.onnx';
const modelSha256 = 'a946f7a9397021b9b6b7e71df3d2821b04cc09ff244423b7ca79cb191ce4a00e';
const modelRevision = '042a40bc4c918349ad3e2e607a68ae509a4c27b5';
const sourceRevision = 'a4abfb2979a7bbff3f69f58f58ae324608821e27';
const runtimeVersion = '1.30.0';
const runtimeFiles = {
  'ort-wasm-simd-threaded.mjs': 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b',
  'ort-wasm-simd-threaded.wasm': '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const packageInfo = JSON.parse(await readFile('node_modules/onnxruntime-web/package.json', 'utf8'));
assert.equal(packageInfo.version, runtimeVersion, 'onnxruntime-web must match the tested pinned version');
const modelBytes = await readFile(modelPath);
assert.equal(sha256(modelBytes), modelSha256, 'the local Real-ESRGAN ONNX model must match its pinned artifact');
assert.equal(modelBytes.byteLength, 4_866_428, 'the local Real-ESRGAN model must have its expected size');
const license = await readFile('wasm/models/REAL-ESRGAN-LICENSE.txt', 'utf8');
assert.match(license, /BSD 3-Clause License/, 'the upstream BSD-3-Clause license must ship with the model');
const notice = await readFile('wasm/models/REAL-ESRGAN-NOTICE.md', 'utf8');
assert.match(notice, new RegExp(modelRevision));
assert.match(notice, new RegExp(sourceRevision));
assert.match(notice, new RegExp(modelSha256));

await mkdir('wasm/onnxruntime', { recursive: true });
for (const [file, expectedHash] of Object.entries(runtimeFiles)) {
  const target = `wasm/onnxruntime/${file}`;
  assert.equal(sha256(await readFile(target)), expectedHash, `${file} must match the pinned ONNX Runtime Web files`);
}

await build({
  entryPoints: ['src/workers/resolution-boost.worker.js'],
  outfile: 'src/workers/resolution-boost-worker.bundle.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['onnxruntime-web-use-extern-wasm', 'browser'],
  legalComments: 'eof',
  sourcemap: false,
  minify: true,
  metafile: false,
});

const manifest = {
  schema: 1,
  model: {
    name: 'Real-ESRGAN general x4v3 · converted SRVGGNetCompact ONNX',
    source: `https://huggingface.co/skillsafe-ai/realesr-general-x4v3/tree/${modelRevision}`,
    revision: modelRevision,
    originalSource: `https://github.com/xinntao/Real-ESRGAN/tree/${sourceRevision}`,
    sourceCheckpointSha256: '8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292',
    conversionRecipeSha256: 'bc93d30609e3b981c4c61bec23b2c8df737241e9ed64aa99879b21949579fc4f',
    file: 'models/realesr-general-x4v3.onnx',
    sha256: modelSha256,
    sizeBytes: modelBytes.byteLength,
    license: 'BSD-3-Clause',
    licenseFile: 'models/REAL-ESRGAN-LICENSE.txt',
    noticeFile: 'models/REAL-ESRGAN-NOTICE.md',
    input: { name: 'input', type: 'float32', shape: '[1, 3, height, width]', color: 'RGB', normalization: 'pixel / 255' },
    output: { name: 'output', type: 'float32', shape: '[1, 3, height * 4, width * 4]', color: 'RGB, clipped to [0, 1]; alpha is resampled from the source' },
    convertedOutputErrorMax: 4.5e-6,
  },
  runtime: {
    package: 'onnxruntime-web',
    version: runtimeVersion,
    executionProvider: 'wasm',
    numThreads: { min: 1, max: 4, requirement: 'More than one thread requires cross-origin isolation.' },
    workerBundle: '../src/workers/resolution-boost-worker.bundle.js',
    files: runtimeFiles,
  },
  limits: {
    maxSourcePixels: 524_288,
    maxSourceEdge: 2_048,
    maxSourceBytes: 67_108_864,
    maxOutputPixels: 8_388_608,
    maxOutputBytes: 67_108_864,
    tileSize: 256,
    tileHalo: 32,
    queuedJobs: 'serialized',
    lazyLoadModel: true,
  },
};
await writeFile('wasm/resolution-boost-runtime.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built the pinned local Real-ESRGAN resolution-boost worker (${modelBytes.byteLength} bytes, ONNX Runtime Web ${runtimeVersion}).`);
