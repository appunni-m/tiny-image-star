import { importFigBytes } from '../fig-import.js';

self.addEventListener('message', event => {
  const { requestId, bytes, fileName } = event.data || {};
  if (typeof requestId !== 'string' || !(bytes instanceof ArrayBuffer)) return;
  const startedAt = performance.now();
  try {
    const result = importFigBytes(new Uint8Array(bytes), { fileName });
    result.report.parseMilliseconds = Math.max(0, Math.round(performance.now() - startedAt));
    // The input archive was transferred into this worker. Transfer that same
    // buffer back as an opaque source sidecar so callers can preserve fields
    // the editable local model does not represent, without making a 32 MiB copy.
    result.figSourceArchive = bytes;
    const transfers = [...new Set([bytes, ...result.assets.map(asset => asset.bytes.buffer)])];
    self.postMessage({ requestId, ok: true, result }, transfers);
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: { name: error?.name || 'FigImportError', code: error?.code || 'INVALID_FIG', message: error?.message || 'Could not decode this .fig file.' }
    });
  }
});
