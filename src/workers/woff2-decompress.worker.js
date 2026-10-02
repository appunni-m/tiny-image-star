import decompress from 'woff2-encoder/decompress';

const MAX_WOFF2_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_SFNT_OUTPUT_BYTES = 30 * 1024 * 1024;
let queue = Promise.resolve();

async function decode({ id, bytes }) {
  try {
    if (!Number.isSafeInteger(id) || id < 1) throw new TypeError('The WOFF2 request ID is invalid.');
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 48 || bytes.byteLength > MAX_WOFF2_INPUT_BYTES) {
      throw new RangeError('The WOFF2 font is outside the local decoder size limits.');
    }
    const source = new Uint8Array(bytes);
    if (source[0] !== 0x77 || source[1] !== 0x4f || source[2] !== 0x46 || source[3] !== 0x32) {
      throw new TypeError('The local font data is not WOFF2.');
    }
    const decoded = await decompress(source);
    if (!(decoded instanceof Uint8Array) || decoded.byteLength < 12 || decoded.byteLength > MAX_SFNT_OUTPUT_BYTES) {
      throw new RangeError('The decoded local font is outside the supported size limits.');
    }
    const output = decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength);
    self.postMessage({ id, ok: true, bytes: output }, [output]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || 'The local WOFF2 font could not be decoded.' });
  }
}

self.addEventListener('message', event => {
  const message = event.data;
  queue = queue.then(() => decode(message), () => decode(message));
});
