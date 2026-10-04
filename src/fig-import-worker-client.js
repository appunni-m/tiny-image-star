export const MAX_FIG_IMPORT_BYTES = 32 * 1024 * 1024;
const FIG_IMPORT_TIMEOUT_MS = 45_000;

/**
 * Run the local .fig decoder in an isolated worker. The source bytes are
 * transferred into the worker and returned as result.figSourceArchive, so the
 * caller can preserve the original archive without an extra full-size copy.
 */
export async function parseLocalFigFile(file, { timeoutMs = FIG_IMPORT_TIMEOUT_MS } = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('Choose a local .fig file to import.');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FIG_IMPORT_BYTES) {
    throw new RangeError(`Choose a .fig file no larger than ${Math.floor(MAX_FIG_IMPORT_BYTES / (1024 * 1024))} MiB.`);
  }
  if (typeof Worker !== 'function') throw new Error('This browser cannot run the local design importer in an isolated worker.');

  const worker = new Worker(new URL('./workers/fig-import-worker.bundle.js', import.meta.url), {
    type: 'module', name: 'tiny-image-star-fig-import'
  });
  const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  let timer = 0;
  try {
    const source = await file.arrayBuffer();
    return await new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        clearTimeout(timer);
        worker.terminate();
        callback(value);
      };
      worker.onmessage = event => {
        if (event.data?.requestId !== requestId) return;
        if (!event.data.ok) {
          const error = new Error(event.data.error?.message || 'Could not decode this .fig file.');
          error.name = event.data.error?.name || 'FigImportError';
          error.code = event.data.error?.code || 'INVALID_FIG';
          finish(reject, error);
          return;
        }
        finish(resolve, event.data.result);
      };
      worker.onerror = event => finish(reject, new Error(event.message || 'The local .fig importer stopped unexpectedly.'));
      timer = setTimeout(() => finish(reject, new Error('Import timed out before the .fig file could be safely decoded. Try a smaller local copy.')), timeoutMs);
      worker.postMessage({ requestId, fileName: file.name || 'Imported design.fig', bytes: source }, [source]);
    });
  } catch (error) {
    worker.terminate();
    throw error;
  }
}
