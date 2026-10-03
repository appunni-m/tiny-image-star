import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const modelPath = 'wasm/models/isnet-general-use-q8.onnx';
const modelSha256 = '5039225b9a4ac3df55f185d24b7a92d640c86cc4747002d7f23351e394de03a6';
const modelRevision = '5349b617911fd60c619b52f32e2b593517b78df3';
const sourceRevision = 'b6764e20381f6f42a70f83fa3324181529ed1403';
const runtimeVersion = '1.30.0';
const runtimeFiles = {
  'ort-wasm-simd-threaded.mjs': 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b',
  'ort-wasm-simd-threaded.wasm': '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const packageInfo = JSON.parse(await readFile('node_modules/onnxruntime-web/package.json', 'utf8'));
assert.equal(packageInfo.version, runtimeVersion, 'onnxruntime-web must match the tested pinned version');
const modelBytes = await readFile(modelPath);
assert.equal(sha256(modelBytes), modelSha256, 'the local ISNet ONNX model must match its pinned upstream artifact');
assert.equal(modelBytes.byteLength, 45_902_969, 'the local ISNet ONNX model must have its expected size');
const modelLicense = await readFile('wasm/models/ISNET-DIS-LICENSE.txt', 'utf8');
assert.match(modelLicense, /Apache License[\s\S]*Version 2\.0/, 'the source model Apache license must ship with the model');
const notice = await readFile('wasm/models/ISNET-ONNX-NOTICE.md', 'utf8');
assert.match(notice, new RegExp(modelRevision));
assert.match(notice, new RegExp(sourceRevision));

await mkdir('wasm/onnxruntime', { recursive: true });
for (const [file, expectedHash] of Object.entries(runtimeFiles)) {
  const target = `wasm/onnxruntime/${file}`;
  assert.equal(sha256(await readFile(target)), expectedHash, `${file} must match the pinned ONNX Runtime Web files`);
}

await build({
  entryPoints: ['src/workers/background-removal.worker.js'],
  outfile: 'src/workers/background-removal-worker.bundle.js',
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
    name: 'ISNet general-use dichotomous image segmentation · dynamic int8 ONNX',
    source: 'https://huggingface.co/Ko033/isnet-general-use-onnx/tree/5349b617911fd60c619b52f32e2b593517b78df3',
    revision: modelRevision,
    originalSource: 'https://github.com/xuebinqin/DIS/tree/b6764e20381f6f42a70f83fa3324181529ed1403',
    file: 'models/isnet-general-use-q8.onnx',
    sha256: modelSha256,
    sizeBytes: modelBytes.byteLength,
    license: 'Apache-2.0',
    licenseFile: 'models/ISNET-DIS-LICENSE.txt',
    noticeFile: 'models/ISNET-ONNX-NOTICE.md',
    input: { name: 'input_image', type: 'float32', shape: '[1, 3, height, width]', color: 'RGB', normalization: 'pixel / 255 - 0.5' },
    output: { name: 'output_image', type: 'float32', shape: '[1, 1, height, width]', meaning: 'foreground confidence; min-max normalized before applying alpha' },
    modelInputLongEdge: 512,
  },
  runtime: {
    package: 'onnxruntime-web',
    version: runtimeVersion,
    executionProvider: 'wasm',
    numThreads: 1,
    workerBundle: '../src/workers/background-removal-worker.bundle.js',
    files: runtimeFiles,
  },
  limits: { maxSourcePixels: 4_194_304, maxSourceBytes: 67_108_864, queuedJobs: 'serialized' },
};
await writeFile('wasm/background-removal-runtime.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built the pinned local ISNet background-removal worker (${modelBytes.byteLength} bytes, ONNX Runtime Web ${runtimeVersion}).`);
