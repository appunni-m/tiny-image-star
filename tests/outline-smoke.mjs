import { addNode, createDocument, createNode } from '../src/model.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 10000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for editor startup and redraws. */ }
      if (performance.now() - start > timeout) { reject(new Error(`Timed out waiting for ${label}.`)); return; }
      setTimeout(poll, 30);
    };
    poll();
  });
}
function packageFile(documentData) {
  const manifest = new TextEncoder().encode(JSON.stringify({ schema: documentData.schema, document: documentData, assets: [] }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.byteLength, true);
  const parts = [new Uint8Array([70, 76, 79, 67, 65, 76, 1]), length, manifest];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
function countColor(canvas, color) {
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] === color[0] && data[index + 1] === color[1] && data[index + 2] === color[2]) count += 1;
  }
  return count;
}

try {
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  assert(app.title === 'Tiny Image Star', 'The editor should use Tiny Image Star as its public name.');
  const design = createDocument();
  const screen = createNode('frame', { name: 'Screen', x: 30, y: 30, width: 340, height: 240, fill: '#ffffff' });
  const red = createNode('rectangle', { name: 'Red shape', x: 20, y: 20, width: 120, height: 90, fill: '#ff0000', radius: 12 });
  const green = createNode('ellipse', { name: 'Green shape', x: 170, y: 20, width: 100, height: 100, fill: '#00ff00' });
  const star = createNode('star', { name: 'Star', x: 185, y: 135, width: 70, height: 70, rotation: 17, fill: '#ffcd29' });
  addNode(design, screen); addNode(design, red, { parentId: screen.id }); addNode(design, green, { parentId: screen.id }); addNode(design, star, { parentId: screen.id });
  const input = app.querySelector('#open-file-input'); const transfer = new DataTransfer();
  transfer.items.add(new File([packageFile(design)], 'outline-smoke.flocal', { type: 'application/octet-stream' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => [...app.querySelectorAll('#toast-region .toast')].some(toast => toast.textContent.includes('Local design opened')), 'design import');
  const canvas = app.querySelector('#scene-canvas');
  await waitFor(() => countColor(canvas, [255, 0, 0]) > 1000 && countColor(canvas, [0, 255, 0]) > 1000, 'filled canvas render');
  const filledRed = countColor(canvas, [255, 0, 0]);
  const filledGreen = countColor(canvas, [0, 255, 0]);

  const toggle = app.querySelector('#outline-mode');
  toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  assert(toggle.getAttribute('aria-pressed') === 'true' && toggle.classList.contains('is-active'), 'Outline control did not expose its active state accessibly.');
  await waitFor(() => countColor(canvas, [255, 0, 0]) === 0 && countColor(canvas, [0, 255, 0]) === 0, 'outline rendering');
  const outlines = countColor(canvas, [98, 107, 120]);
  assert(outlines > 150, `Expected shape and layer outlines, found ${outlines} exact outline pixels.`);

  toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  await waitFor(() => countColor(canvas, [255, 0, 0]) > 1000 && countColor(canvas, [0, 255, 0]) > 1000, 'normal rendering restore');
  assert(toggle.getAttribute('aria-pressed') === 'false', 'Outline control did not return to its inactive state.');
  result.textContent = `PASS\n${JSON.stringify({ productName: 'Tiny Image Star', coloredFillsHidden: true, nestedAndRotatedOutlines: outlines > 150, accessibleToggle: true, normalRenderingRestored: true, originalPixelCounts: { red: filledRed, green: filledGreen }, outlinePixels: outlines })}`;
} catch (error) {
  result.textContent = `FAIL\n${error?.stack || error}`;
}
