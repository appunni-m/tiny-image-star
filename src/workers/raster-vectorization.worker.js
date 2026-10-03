const MAX_PIXELS = 1_048_576;
let wasmPromise;

function loadWasm() {
  if (!wasmPromise) {
    const url = new URL('../../wasm/raster-vectorizer.wasm', import.meta.url);
    wasmPromise = fetch(url).then(async response => {
      if (!response.ok) throw new Error(`The local vectorizer WASM could not be loaded (${response.status}).`);
      const bytes = await response.arrayBuffer();
      const result = await WebAssembly.instantiate(bytes, {});
      const exports = result.instance.exports;
      if (!(exports.memory instanceof WebAssembly.Memory)
        || typeof exports.raster_vectorize_alloc !== 'function'
        || typeof exports.raster_vectorize_run !== 'function'
        || typeof exports.raster_vectorize_result_length !== 'function') {
        throw new Error('The local vectorizer WASM is missing required exports.');
      }
      return exports;
    });
  }
  return wasmPromise;
}

const errorText = code => ({
  1: 'The vectorization settings are invalid.',
  2: 'This image is too large to vectorize in this browser. Resize or crop it to at most 1,048,576 pixels.',
  3: 'This image contains too much fine detail for the editable path limits. Reduce detail or color count and try again.'
}[code] || 'The local vectorizer could not process this image.');

self.onmessage = async event => {
  const message = event.data;
  if (message?.type !== 'vectorize') return;
  const { requestId, pixels, width, height, options } = message;
  let inputPointer = 0;
  let inputLength = 0;
  let resultPointer = 0;
  let resultLength = 0;
  try {
    if (!(pixels instanceof ArrayBuffer) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 1 || height < 1 || width * height > MAX_PIXELS || pixels.byteLength !== width * height * 4) {
      throw new Error(errorText(2));
    }
    if (!options || ![0, 1, 2].includes(options.mode) || !Number.isInteger(options.colorCount)
      || options.colorCount < 2 || options.colorCount > 16 || !Number.isInteger(options.threshold)
      || options.threshold < 0 || options.threshold > 255 || !Number.isInteger(options.toleranceMilliPixels)
      || options.toleranceMilliPixels < 0 || options.toleranceMilliPixels > 4000) {
      throw new Error(errorText(1));
    }
    const wasm = await loadWasm();
    inputLength = pixels.byteLength;
    inputPointer = wasm.raster_vectorize_alloc(inputLength);
    if (!inputPointer) throw new Error('The local vectorizer could not reserve enough WebAssembly memory.');
    new Uint8Array(wasm.memory.buffer, inputPointer, inputLength).set(new Uint8Array(pixels));
    resultPointer = wasm.raster_vectorize_run(
      inputPointer, width, height, options.mode, options.colorCount, options.threshold, options.toleranceMilliPixels
    );
    resultLength = wasm.raster_vectorize_result_length();
    if (!resultPointer) throw new Error(errorText(wasm.raster_vectorize_last_error()));
    if (!resultLength || resultLength > 32 * 1024 * 1024) throw new Error('The local vectorizer returned an invalid path buffer.');
    const result = new Uint8Array(wasm.memory.buffer, resultPointer, resultLength).slice();
    wasm.raster_vectorize_free_result(resultPointer, resultLength);
    resultPointer = 0;
    resultLength = 0;
    self.postMessage({ type: 'result', requestId, buffer: result.buffer }, [result.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', requestId, message: error?.message || 'The local vectorizer could not process this image.' });
  } finally {
    if (inputPointer) {
      try { (await loadWasm()).raster_vectorize_free(inputPointer, inputLength); } catch { /* worker is being discarded */ }
    }
    if (resultPointer) {
      try { (await loadWasm()).raster_vectorize_free_result(resultPointer, resultLength); } catch { /* worker is being discarded */ }
    }
  }
};
