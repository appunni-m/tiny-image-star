import test from 'node:test';
import assert from 'node:assert/strict';
import * as ort from 'onnxruntime-web/wasm';
import { readFile } from 'node:fs/promises';

test('pinned ISNet runs a finite foreground pass on local ONNX Runtime WebAssembly', async () => {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = {
    mjs: new URL('../wasm/onnxruntime/ort-wasm-simd-threaded.mjs', import.meta.url).href,
    wasm: new URL('../wasm/onnxruntime/ort-wasm-simd-threaded.wasm', import.meta.url).href,
  };
  ort.env.logLevel = 'error';
  const modelBytes = await readFile(new URL('../wasm/models/isnet-general-use-q8.onnx', import.meta.url));
  const session = await ort.InferenceSession.create(new Uint8Array(modelBytes), {
    executionProviders: ['wasm'], graphOptimizationLevel: 'all', executionMode: 'sequential',
  });
  let input;
  let output;
  try {
    assert.deepEqual(session.inputNames, ['input_image']);
    assert.deepEqual(session.outputNames, ['output_image']);
    const width = 512;
    const height = 256;
    const planeSize = width * height;
    const inputData = new Float32Array(planeSize * 3);
    // A synthetic two-tone image exercises both sides of the input range while
    // keeping the fixture independent of third-party photo licensing.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const foreground = x >= width / 4 && x < width * 3 / 4 && y >= height / 8 && y < height * 7 / 8;
        const value = foreground ? 0.4 : -0.5;
        inputData[index] = value;
        inputData[planeSize + index] = value;
        inputData[planeSize * 2 + index] = value;
      }
    }
    input = new ort.Tensor('float32', inputData, [1, 3, height, width]);
    output = await session.run({ input_image: input });
    const mask = output.output_image;
    assert.deepEqual(mask.dims, [1, 1, height, width]);
    assert.equal(mask.type, 'float32');
    assert.equal(mask.data.length, planeSize);
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const value of mask.data) {
      assert.ok(Number.isFinite(value));
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    assert.ok(maximum > minimum, 'the local model must produce a usable confidence range');
  } finally {
    input?.dispose?.();
    if (output) for (const tensor of Object.values(output)) tensor?.dispose?.();
    session.release();
  }
});
