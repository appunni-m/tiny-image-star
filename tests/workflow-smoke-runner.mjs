const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const workflows = new Set([
  'touch-canvas-smoke.mjs',
  'image-fill-crop-smoke.mjs',
  'object-isolation.browser.mjs',
  'selection-inspector-smoke.mjs',
  'canvas-interaction-smoke.mjs',
  'bulk-recipe-context-smoke.mjs',
  'export-smoke.mjs',
  'local-fonts-smoke.mjs',
  'rich-text-editing-smoke.mjs'
]);

function waitFor(test, label, timeout = 45_000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } }
      catch { /* Let the isolated editor finish initializing. */ }
      if (performance.now() - started > timeout) {
        reject(new Error(`Timed out waiting for ${label}.`));
        return;
      }
      setTimeout(poll, 35);
    };
    poll();
  });
}

try {
  const params = new URLSearchParams(location.search);
  const workflow = params.get('module');
  if (!workflows.has(workflow)) throw new TypeError('Choose a supported workflow module.');
  const width = Number(params.get('width') || 1280);
  const height = Number(params.get('height') || 720);
  if (!Number.isInteger(width) || width < 320 || width > 2560
    || !Number.isInteger(height) || height < 320 || height > 1800) {
    throw new RangeError('The workflow viewport must be between 320 and 2560 pixels wide and 320 and 1800 pixels high.');
  }
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  result.textContent = `RUNNING: ${workflow} at ${width}×${height}`;
  await import(`./${workflow}?run=${Date.now()}`);
  if (!result.textContent.startsWith('PASS\n') && !result.textContent.startsWith('FAIL\n')) {
    throw new Error('The workflow module completed without reporting a result.');
  }
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
