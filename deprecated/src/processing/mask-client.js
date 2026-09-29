import { getProcessingScheduler } from "./client.js";
import { maskWork, validateMaskStroke } from "../compositor/mask-spec.js";

export function enqueueMask({ source, mask, imported, mode = "luminance", stroke, reset, previewOnly = false, previewRegion, signal, pool = getProcessingScheduler() }) {
  if (stroke) validateMaskStroke(stroke);
  const request = { source: { asset: structuredClone(source.asset) }, ...(mask ? { mask: { asset: structuredClone(mask.asset) } } : {}),
    ...(imported ? { importMask: { mode } } : {}), stroke: stroke ? structuredClone(stroke) : undefined, reset, previewEdge: 1024,
    previewOnly, previewRegion: previewRegion ? structuredClone(previewRegion) : undefined };
  const entries = [["source", source.blob], ...(mask ? [["mask", mask.blob]] : []), ...(imported ? [["importMask", imported]] : [])];
  if (entries.some(([, blob]) => !(blob instanceof Blob))) throw new Error("The cutout source is unavailable.");
  if (mask && imported || imported && imported.size > 16 * 1024 * 1024) throw new Error("Choose one PNG mask under 16 MB.");
  if (typeof previewOnly !== "boolean" || previewOnly && (imported || reset || stroke)) throw new Error("A cutout detail preview cannot change the mask.");
  const estimate = maskWork({ width: source.asset.width, height: source.asset.height, encodedBytes: entries.reduce((sum, [, blob]) => sum + blob.size, 0), previewRegion: request.previewRegion });
  let result, error;
  const task = pool.enqueue({ estimate, priority: 0, signal, workClass: `mask:${source.asset.width}x${source.asset.height}`,
    prepare: async () => {
      const transfer = [];
      for (const [key, blob] of entries) {
        if (signal?.aborted) throw new DOMException("Cutout cancelled", "AbortError");
        const bytes = await blob.arrayBuffer(); request[key].bytes = bytes; transfer.push(bytes);
      }
      return { message: { type: "mask", revision: 1, request }, transfer };
    },
    onMessage: (message) => { if (message.type === "mask-result") result = message; if (message.type === "mask-error") error = new Error(message.message); },
  });
  return { cancel: task.cancel, promise: task.promise.then(() => { if (error) throw error; if (!result) throw new Error("The cutout worker returned no result."); return result; }) };
}
