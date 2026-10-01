import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const modelPath = 'wasm/models/migan_pipeline_v2.onnx';
const modelSha256 = '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b';
const modelRevision = '1538c135034b8cfe7a8472f34d09c8a5a45b17a7';
const runtimeVersion = '1.30.0';
const runtimeFiles = {
  'ort-wasm-simd-threaded.mjs': 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b',
  'ort-wasm-simd-threaded.wasm': '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
};

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const packageInfo = JSON.parse(await readFile('node_modules/onnxruntime-web/package.json', 'utf8'));
assert.equal(packageInfo.version, runtimeVersion, 'onnxruntime-web must match its pinned tested version');
const modelBytes = await readFile(modelPath);
assert.equal(hash(modelBytes), modelSha256, 'the local MI-GAN model must match the pinned upstream artifact');
assert.equal(modelBytes.byteLength, 28_079_181, 'the local MI-GAN model has the expected artifact size');
const weightLicense = await readFile('wasm/models/MI-GAN-LICENSE.txt', 'utf8');
assert.match(weightLicense, /MIT License/, 'the model weights must ship their upstream license');

await mkdir('wasm/onnxruntime', { recursive: true });
for (const [file, expectedHash] of Object.entries(runtimeFiles)) {
  const source = `node_modules/onnxruntime-web/dist/${file}`;
  const target = `wasm/onnxruntime/${file}`;
  await copyFile(source, target);
  assert.equal(hash(await readFile(target)), expectedHash, `${file} must match the pinned ONNX Runtime Web distribution`);
}

await build({
  entryPoints: ['src/workers/inpaint.worker.js'],
  outfile: 'src/workers/inpaint-worker.bundle.js',
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
    name: 'MI-GAN 512 Places2 inpainting pipeline',
    source: 'https://huggingface.co/andraniksargsyan/migan/tree/1538c135034b8cfe7a8472f34d09c8a5a45b17a7',
    revision: modelRevision,
    file: 'models/migan_pipeline_v2.onnx',
    sha256: modelSha256,
    sizeBytes: modelBytes.byteLength,
    license: 'MIT',
    licenseFile: 'models/MI-GAN-LICENSE.txt',
    inputs: {
      image: { type: 'uint8', shape: '[1, 3, height, width]', color: 'RGB' },
      mask: { type: 'uint8', shape: '[1, 1, height, width]', values: { known: 255, erase: 0 } },
    },
    output: { name: 'result', type: 'uint8', shape: '[1, 3, height, width]' },
  },
  runtime: {
    package: 'onnxruntime-web',
    version: runtimeVersion,
    executionProvider: 'wasm',
    numThreads: 1,
    workerBundle: '../src/workers/inpaint-worker.bundle.js',
    files: runtimeFiles,
  },
};
await writeFile('wasm/inpaint-runtime.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built local MI-GAN worker and verified model/runtime assets (${runtimeVersion}).`);
