import { getProcessingScheduler } from "./client.js";
import { sceneWork } from "./policy.js";
import { planScene, sceneError } from "../compositor/scene-spec.js";

/**
 * Queue an immutable scene revision. readAsset(id) returns a Blob or bytes;
 * it is not called until the shared scheduler admits the full scene estimate.
 * Source owners must keep their own retained-memory ledger up to date, as the
 * editor and batch coordinators do. Returned output ownership passes to them.
 */
export function enqueueScene({ project, slideId, variantId, readAsset, preview = false, previewEdge = 1280, format = "png", jpegBackground,
  priority = preview ? 0 : 1, signal, pool = getProcessingScheduler() }) {
  // Copy metadata now: subsequent edits must not alter the admitted revision.
  const request = { project: structuredClone(project), slideId, variantId, preview, previewEdge, format, jpegBackground };
  const plan = planScene(request.project, slideId, variantId, request);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  let output, failure;
  const task = pool.enqueue({ kind: "image", priority, signal: controller.signal, estimate: sceneWork(plan),
    workClass: `scene:${format}:${preview ? "preview" : "export"}:${Math.floor(Math.log2(plan.width * plan.height))}:${plan.nodes.length}:${plan.assets.length}:${plan.nodes.some((node) => node.depthText) ? "depth" : "flat"}:${plan.nodes.some((node) => node.maskId && node.cutoutEffects) ? "cutout-effects" : "plain"}`,
    prepare: async () => {
      const assets = [], transfer = [];
      for (const asset of plan.assets) {
        if (controller.signal.aborted) throw new DOMException("Processing cancelled.", "AbortError");
        const source = await readAsset(asset.id, { signal: controller.signal });
        if (controller.signal.aborted) throw new DOMException("Processing cancelled.", "AbortError");
        const size = source instanceof Blob ? source.size : source?.byteLength;
        if (size !== asset.byteLength) throw sceneError("ASSET_CHANGED", "A story asset changed before rendering.");
        const bytes = source instanceof Blob ? await source.arrayBuffer() : source instanceof ArrayBuffer ? source.slice(0)
          : ArrayBuffer.isView(source) ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) : null;
        if (!bytes) throw sceneError("MISSING_ASSET", "A story asset is unavailable.");
        assets.push({ id: asset.id, bytes }); transfer.push(bytes);
      }
      return { message: { type: "scene", revision: request.project.revision, request: { ...request, assets } }, transfer };
    },
    onMessage: (message) => {
      if (message.type === "scene-result") output = message;
      if (message.type === "scene-error") failure = sceneError(message.code, message.message);
    },
  });
  return { cancel: abort, promise: task.promise.then(() => {
    if (failure) throw failure;
    if (!output) throw sceneError("RENDER_FAILED", "The story worker returned no output.");
    return output;
  }).finally(() => signal?.removeEventListener("abort", abort)) };
}
