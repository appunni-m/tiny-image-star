let api;
let initializationError;
const originals = new Map();

const initialization = (async () => {
  const binding = await import("../wasm/pillow_rs_js.js");
  await binding.default();
  api = binding;
  self.postMessage({ type: "ready" });
})().catch((error) => {
  initializationError = error;
  self.postMessage({ type: "error", message: error?.message ?? String(error) });
});

function replaceImage(current, next) {
  if (current !== next) current.free();
  return next;
}

function applyAdjustments(source, adjustments) {
  let image = source.copy();
  try {
    if (adjustments.brightness !== 0) image = replaceImage(image, image.enhanceBrightness(1 + adjustments.brightness / 100));
    if (adjustments.contrast !== 0) image = replaceImage(image, image.enhanceContrast(1 + adjustments.contrast / 100));
    if (adjustments.saturation !== 0) image = replaceImage(image, image.enhanceColor(1 + adjustments.saturation / 100));
    if (adjustments.blur > 0) image = replaceImage(image, image.gaussianBlur(adjustments.blur));
    const result = image.saveWithInput("PNG", null);
    const output = new Uint8Array(result);
    return { bytes: output, width: image.width, height: image.height };
  } finally { image.free(); }
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    await initialization;
    if (!api) throw initializationError ?? new Error("Local image runtime did not initialize");
    if (message.type === "dispose") {
      originals.get(message.id)?.free(); originals.delete(message.id);
      self.postMessage({ type: "disposed", id: message.id }); return;
    }
    if (message.type !== "render") return;
    let source = originals.get(message.id);
    if (!source) {
      source = api.Image.open(new Uint8Array(message.sourceBytes));
      source.load(); originals.set(message.id, source);
    }
    const result = applyAdjustments(source, message.adjustments);
    self.postMessage({ type: "rendered", requestId: message.requestId, id: message.id, ...result }, [result.bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", requestId: message.requestId, id: message.id, message: error?.message ?? String(error) });
  }
};
