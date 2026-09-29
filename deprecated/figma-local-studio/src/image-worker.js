import { openSourceImage, renderAdjustedImage } from './image-processing.js';

let binding;
const originals = new Map();
const ready = (async () => {
  const module = await import('../wasm/pillow_rs_js.js');
  await module.default();
  binding = module;
})();

self.onmessage = async event => {
  const message = event.data;
  try {
    await ready;
    if (message.type === 'dispose') {
      originals.get(message.id)?.free();
      originals.delete(message.id);
      self.postMessage({ type: 'disposed', id: message.id });
      return;
    }
    if (message.type !== 'render') return;
    let source = originals.get(message.id);
    if (!source) {
      if (!message.sourceBytes) throw new Error('The image source is no longer available in memory.');
      source = openSourceImage(binding, message.sourceBytes);
      originals.set(message.id, source);
    }
    const rendered = renderAdjustedImage(source, message.adjustments);
    self.postMessage({ type: 'rendered', requestId: message.requestId, id: message.id, ...rendered }, [rendered.bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', requestId: message.requestId, id: message.id, message: error?.message || 'The local image could not be processed.' });
  }
};

ready.then(() => self.postMessage({ type: 'ready' }), error => self.postMessage({ type: 'init-error', message: error?.message || 'Pillow-RS WebAssembly failed to initialize.' }));

self.addEventListener('close', () => {
  for (const source of originals.values()) source.free();
  originals.clear();
});
