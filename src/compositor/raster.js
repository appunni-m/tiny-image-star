import { drawTextLayers, normalizeTextLayers } from "./text.js";
import { MAX_TEXT_FONT_BYTES, loadFontFace, textError, textFontRequirements, verifyFontRecord } from "./fonts.js";
import { readFontRecord } from "../editor/fonts.js";

// Canvas supplies the browser's shaping/rasterization only. It never encodes
// the photo. Pillow composites these straight-alpha RGBA pixels and performs
// the one final PNG/JPEG encode after all image and text operations.
export async function compositeText(api, image, layers, fontRecords = []) {
  if (!layers?.length) return image;
  const safe = normalizeTextLayers(layers);
  const { required } = textFontRequirements(safe);
  const fonts = new Map();
  let canvas, overlay, composed;
  const fontSet = globalThis.document?.fonts ?? globalThis.fonts;
  let fontBytes = 0;
  try {
    if (typeof OffscreenCanvas !== "function") throw textError("This browser cannot render text in a worker. Use a current browser or remove the text layers.");
    for (const requirement of required.values()) {
      const supplied = fontRecords.find((record) => record.id === requirement.id);
      const record = await verifyFontRecord(supplied ?? await readFontRecord(requirement.id), requirement);
      fontBytes += record.bytes.byteLength;
      if (fontBytes > MAX_TEXT_FONT_BYTES) throw textError("The fonts in this edit exceed the 32 MiB font limit.", "font-limit");
      fonts.set(record.id, await loadFontFace(record));
    }
    canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!ctx) throw textError("The text surface could not be created. Try smaller output dimensions.");
    drawTextLayers(ctx, safe, image.width, image.height, fonts);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    overlay = api.fromBytesFn("RGBA", image.width, image.height, new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), "raw");
    composed = image.convert("RGBA", null);
    composed.alphaComposite(overlay);
    return composed;
  } catch (error) {
    composed?.free();
    throw error;
  } finally {
    overlay?.free();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
    // No growing per-worker font cache: the scheduler reserves these assets
    // for this task. Worker retirement also releases browser-internal caches.
    for (const record of fonts.values()) fontSet?.delete(record.face);
  }
}
