import { importFigBytes } from '../fig-import.js';

self.addEventListener('message', event => {
  const { requestId, bytes, fileName } = event.data || {};
  if (typeof requestId !== 'string' || !(bytes instanceof ArrayBuffer)) return;
  const startedAt = performance.now();
  try {
    const result = importFigBytes(new Uint8Array(bytes), { fileName });
    result.report.parseMilliseconds = Math.max(0, Math.round(performance.now() - startedAt));
    const transfers = result.assets.map(asset => asset.bytes.buffer);
    self.postMessage({ requestId, ok: true, result }, transfers);
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: { name: error?.name || 'FigImportError', code: error?.code || 'INVALID_FIG', message: error?.message || 'Could not decode this .fig file.' }
    });
  }
});
