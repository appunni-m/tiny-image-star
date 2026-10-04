// SVG's luminance-to-alpha matrix coefficients for sRGB mask content.
export const SVG_LUMINANCE_COEFFICIENTS = Object.freeze({ red: 0.2125, green: 0.7154, blue: 0.0721 });

let pillow = null;
let wasmReady = false;
let wasmPromise = null;

export function initializeLuminanceMaskWasm(wasmBytes) {
  if (!wasmPromise) {
    wasmPromise = import('../wasm/pillow_rs_js.js').then(async module => {
      await module.default(wasmBytes === undefined ? undefined : { module_or_path: wasmBytes });
      if (typeof module.ImageOps?.luminanceMaskAlpha !== 'function') {
        throw new Error('The local Pillow-RS runtime does not include luminance-mask processing.');
      }
      pillow = module;
      wasmReady = true;
      return module.ImageOps;
    }).catch(error => {
      wasmPromise = null;
      throw error;
    });
  }
  return wasmPromise;
}

export function isLuminanceMaskWasmReady() {
  return wasmReady;
}

/** Convert an RGBA pixel buffer to white pixels whose alpha is luminance × source alpha in Pillow-RS WASM. */
export function applyLuminanceMaskAlpha(imageData, { colorSpace = 'srgb' } = {}) {
  const data = imageData?.data;
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)
    || data.length % 4 !== 0 || !['srgb', 'linearRGB'].includes(colorSpace)) {
    throw new TypeError('A luminance mask requires RGBA ImageData and a supported color space.');
  }
  if (!wasmReady) throw new Error('Pillow-RS luminance-mask processing is still loading.');
  const rgbaBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  pillow.ImageOps.luminanceMaskAlpha(rgbaBytes, colorSpace === 'linearRGB');
  return imageData;
}
