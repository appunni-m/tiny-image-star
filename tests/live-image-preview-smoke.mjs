import * as pillow from '../wasm/pillow_rs_js.js';
import { decodeOriginal, renderImage } from '../src/image-processing.js';

const result = document.querySelector('#result');
const frame = document.querySelector('#app-frame');
const SOURCE_WIDTH = 64;
const SOURCE_HEIGHT = 32;
const FIRST_BRIGHTNESS = -88;
const INTERMEDIATE_BRIGHTNESS = 28;
const FINAL_BRIGHTNESS = -63;

function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(test, label, timeout = 20000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try { if (test()) { resolve(); return; } } catch { /* Wait for app startup and preview publication. */ }
      if (performance.now() - started > timeout) { reject(new Error('Timed out waiting for ' + label + '.')); return; }
      setTimeout(poll, 25);
    };
    poll();
  });
}
function click(app, element) {
  assert(element, 'Expected an editor control.');
  element.dispatchEvent(new app.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}
function fixtureBmp() {
  const rowBytes = SOURCE_WIDTH * 3;
  const pixelBytes = rowBytes * SOURCE_HEIGHT;
  const bytes = new Uint8Array(54 + pixelBytes);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42; bytes[1] = 0x4d;
  view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, SOURCE_WIDTH, true); view.setInt32(22, SOURCE_HEIGHT, true);
  view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, pixelBytes, true);
  let offset = 54;
  for (let y = 0; y < SOURCE_HEIGHT; y += 1) {
    for (let x = 0; x < SOURCE_WIDTH; x += 1) {
      // BMP stores blue, green, red. The left half is the stable canvas sample.
      const left = x < SOURCE_WIDTH / 2;
      bytes[offset++] = left ? 210 : 40;
      bytes[offset++] = left ? 65 : 145;
      bytes[offset++] = left ? 30 : 230;
    }
  }
  return bytes;
}
function installWorkerGate(app) {
  const prototype = app.defaultView.Worker.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'postMessage');
  const gate = { hold: false, workers: new Set(), submissions: [], held: [], rendered: [], activeSources: [] };
  const workerIndexes = new Map();
  const requests = new Map();
  Object.defineProperty(prototype, 'postMessage', {
    ...descriptor,
    value(message, transfer) {
      if (!workerIndexes.has(this)) {
        workerIndexes.set(this, workerIndexes.size + 1);
        gate.workers.add(this);
        const worker = this;
        worker.addEventListener('message', event => {
          const response = event.data;
          if (response?.type !== 'rendered') return;
          const submission = requests.get(response.requestId);
          gate.rendered.push({ requestId: response.requestId, assetId: response.assetId, worker: workerIndexes.get(worker) });
          if (!gate.hold) return;
          event.stopImmediatePropagation();
          const handler = worker.onmessage;
          let delivered = false;
          gate.held.push({
            ...submission,
            worker: workerIndexes.get(worker),
            deliver() {
              if (delivered) return;
              delivered = true;
              handler.call(worker, { data: response });
            }
          });
        }, true);
      }
      if (message?.type === 'render') {
        const submission = {
          requestId: message.requestId,
          assetId: message.assetId,
          adjustments: { ...message.adjustments },
          worker: workerIndexes.get(this)
        };
        requests.set(message.requestId, submission);
        gate.submissions.push(submission);
      }
      if (message?.type === 'set-active-source') gate.activeSources.push(message.assetId);
      return descriptor.value.call(this, message, transfer);
    }
  });
  gate.restore = () => Object.defineProperty(prototype, 'postMessage', descriptor);
  return gate;
}
function release(gate, predicate) {
  const index = gate.held.findIndex(predicate);
  if (index < 0) return false;
  gate.held.splice(index, 1)[0].deliver();
  return true;
}
function canvasSample(app) {
  const canvas = app.querySelector('#scene-canvas');
  const rect = canvas.getBoundingClientRect();
  const dpr = app.defaultView.devicePixelRatio || 1;
  // The sole imported image is centered on the canvas; sample source pixel 12,8.
  const x = Math.round((rect.width / 2 - SOURCE_WIDTH / 2 + 12) * dpr);
  const y = Math.round((rect.height / 2 - SOURCE_HEIGHT / 2 + 8) * dpr);
  return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3);
}
function assertPixelNear(actual, expected, label) {
  const difference = actual.map((channel, index) => Math.abs(channel - expected[index]));
  assert(difference.every(value => value <= 6), label + ': expected ' + expected.join(',') + ', got ' + actual.join(',') + '.');
}
function pillowSample(sourceBytes, brightness) {
  const original = decodeOriginal(pillow, sourceBytes);
  try {
    const rendered = renderImage(original, { brightness, contrast: 0, saturation: 0, sharpness: 0, blur: 0 });
    const output = decodeOriginal(pillow, rendered.bytes);
    try { return [...output.getpixel(12, 8)].slice(0, 3); }
    finally { output.free(); }
  } finally { original.free(); }
}

let gate = null;
try {
  await pillow.default();
  await waitFor(() => frame.contentDocument?.documentElement.dataset.appReady === 'true', 'editor startup');
  const app = frame.contentDocument;
  gate = installWorkerGate(app);

  click(app, app.querySelector('#file-menu-button'));
  const newDesign = [...app.querySelectorAll('#context-menu button')].find(button => button.textContent.includes('New design'));
  assert(newDesign, 'The file menu did not offer a fresh local design.');
  click(app, newDesign);
  await waitFor(() => app.querySelector('#toast-region')?.textContent.includes('New local design created.'), 'fresh design switch');
  await waitFor(() => app.querySelectorAll('#layers-list .layer-row[data-layer-id]').length === 0, 'empty design');

  const sourceBytes = fixtureBmp();
  const input = app.querySelector('#image-input');
  const transfer = new app.defaultView.DataTransfer();
  transfer.items.add(new app.defaultView.File([sourceBytes], 'rapid-preview.bmp', { type: 'image/bmp' }));
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new app.defaultView.Event('change', { bubbles: true }));
  await waitFor(() => app.querySelectorAll('#layers-list .layer-row[data-layer-type="image"]').length === 1, 'image import');
  await waitFor(() => gate.rendered.length === 1 && app.querySelector('#image-engine-status')?.textContent.includes('Updated · Pillow-RS WASM'), 'initial local WASM preview');
  assert(gate.activeSources.includes(gate.rendered[0].assetId), 'the selected image source was not marked active before its first worker render.');

  const brightness = app.querySelector('[data-prop="adjustments.brightness"]');
  assert(brightness, 'The selected image did not expose its brightness control.');
  const initialPixel = canvasSample(app);
  const expectedFirstPixel = pillowSample(sourceBytes, FIRST_BRIGHTNESS);
  const expectedFinalPixel = pillowSample(sourceBytes, FINAL_BRIGHTNESS);
  assert(expectedFirstPixel.some((channel, index) => Math.abs(channel - expectedFinalPixel[index]) > 10),
    'The chosen brightness values do not produce distinguishable fixture pixels.');

  // Hold an actual Pillow-RS worker result so later inputs supersede an in-flight
  // preview. Deliver the older render only after the final render is visible.
  gate.hold = true;
  brightness.value = String(FIRST_BRIGHTNESS);
  brightness.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  await waitFor(() => gate.held.some(item => item.adjustments.brightness === FIRST_BRIGHTNESS), 'first in-flight adjustment render');

  brightness.value = String(INTERMEDIATE_BRIGHTNESS);
  brightness.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  brightness.value = String(FINAL_BRIGHTNESS);
  brightness.dispatchEvent(new app.defaultView.Event('input', { bubbles: true }));
  await waitFor(() => gate.held.some(item => item.adjustments.brightness === FINAL_BRIGHTNESS), 'final adjustment render');

  const submittedBrightness = gate.submissions.map(item => item.adjustments.brightness);
  assert(submittedBrightness.includes(FIRST_BRIGHTNESS) && submittedBrightness.includes(FINAL_BRIGHTNESS),
    'Expected held WASM renders for the first and final settings; saw ' + submittedBrightness.join(', ') + '.');
  assert(!submittedBrightness.includes(INTERMEDIATE_BRIGHTNESS),
    'A superseded queued preview reached the WASM worker instead of being replaced by the final setting.');

  assert(release(gate, item => item.adjustments.brightness === FINAL_BRIGHTNESS), 'The final WASM result was not held.');
  await waitFor(() => {
    try { assertPixelNear(canvasSample(app), expectedFinalPixel, 'final rendered preview'); return true; }
    catch { return false; }
  }, 'final setting to appear on canvas');
  assert(release(gate, item => item.adjustments.brightness === FIRST_BRIGHTNESS), 'The older WASM result was not held.');
  await new Promise(resolve => setTimeout(resolve, 100));
  assertPixelNear(canvasSample(app), expectedFinalPixel, 'canvas after late stale result');
  assert(initialPixel.some((channel, index) => Math.abs(channel - expectedFinalPixel[index]) > 10),
    'The final setting did not visibly change the original preview.');

  result.textContent = 'PASS\n' + JSON.stringify({
    pipeline: 'local Pillow-RS WebAssembly worker',
    successiveBrightnessInputs: [FIRST_BRIGHTNESS, INTERMEDIATE_BRIGHTNESS, FINAL_BRIGHTNESS],
    renderedSettings: submittedBrightness,
    finalPixel: canvasSample(app),
    expectedFinalPixel,
    staleResultDeliveredAfterFinal: true,
    activeImageSourcePinned: true,
    finalPreviewWins: true
  });
} catch (error) {
  result.textContent = 'FAIL\n' + (error?.stack || error);
} finally {
  if (gate) {
    gate.hold = false;
    for (const held of [...gate.held]) held.deliver();
    gate.restore();
  }
}
