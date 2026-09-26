import { clone, validateProject, newId } from "../project/model.js";
import { applyProjectCommand } from "../project/history.js";
import { WORKING_COPY_EDGE, WORKING_COPY_METHOD, workingCopySize } from "../project/working-copy.js";
import { getProcessingScheduler } from "../processing/client.js";
import { workingCopyWork } from "../processing/policy.js";
import { hashAsset } from "../project/storage.js";

const cancelled = () => new DOMException("Source conversion cancelled.", "AbortError");
const dimensionsMatch = (a, b) => a.width === b.width && a.height === b.height;

export function planSourceResolution(project, photoId, direction) {
  validateProject(project);
  const photo = project.nodes[photoId], asset = project.assets[photo?.assetId], mask = project.assets[photo?.maskId];
  if (photo?.kind !== "image" || !["working", "original"].includes(direction)) throw new Error("Choose a story photo and source size.");
  if (mask && !dimensionsMatch(mask, asset)) throw new Error("The cutout must match the current photo before conversion.");
  const existing = Object.values(project.assets);
  const cached = (source, target) => existing.find(a => a.kind === source.kind && a.workingCopy?.sourceAssetId === source.id
    && a.workingCopy.sourceSha256 === source.sha256 && dimensionsMatch(a, target));
  let image;
  if (direction === "working") {
    if (asset.workingCopy || Math.max(asset.width, asset.height) <= WORKING_COPY_EDGE) throw new Error("This photo already uses a small source.");
    const target = workingCopySize(asset.width, asset.height);
    image = { source: asset, target, existing: cached(asset, target) };
  } else {
    if (!asset.workingCopy) throw new Error("This photo already uses its original source.");
    image = { source: asset, target: project.assets[asset.workingCopy.sourceAssetId], existing: project.assets[asset.workingCopy.sourceAssetId] };
  }
  let coverage = null;
  if (mask) {
    const original = project.assets[mask.workingCopy?.sourceAssetId];
    const restored = original && mask.workingCopy.sourceSha256 === original.sha256 && dimensionsMatch(original, image.target);
    coverage = { source: mask, target: image.target,
      existing: dimensionsMatch(mask, image.target) ? mask : restored ? original : cached(mask, image.target),
      restoredOriginal: Boolean(restored), upsampled: image.target.width > mask.width || image.target.height > mask.height };
  }
  return { photoId, direction, image, mask: coverage };
}

/** Prepare all source bytes before a single reversible document command.
 * Existing inputs remain owned by the caller; onRetainedBytes tracks generated
 * Blob/hash/output overlap until the caller adopts the returned sources.
 */
export async function prepareSourceResolution(project, photoId, direction, { readAsset, signal, pool = getProcessingScheduler(), onRetainedBytes = () => {} } = {}) {
  const snapshot = clone(project), plan = planSourceResolution(snapshot, photoId, direction);
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  const retained = new Map(), sources = new Map(), additions = [];
  const report = () => onRetainedBytes([...retained.values()].reduce((sum, n) => sum + n, 0));
  async function prepare(part) {
    if (!part) return null;
    if (controller.signal.aborted) throw cancelled();
    if (part.existing) return part.existing;
    const asset = part.source, { width, height } = part.target, target = { width, height }, id = newId(asset.kind);
    let output, failure;
    const task = pool.enqueue({ kind: "image", priority: 0, signal: controller.signal, workClass: `story-source-copy:${asset.kind}`,
      estimate: workingCopyWork({ width: asset.width, height: asset.height, encodedBytes: asset.byteLength, settings: { resizeWidth: width, resizeHeight: height }, target }),
      prepare: async () => {
        if (controller.signal.aborted) throw cancelled();
        const source = await readAsset(asset.id, { signal: controller.signal });
        if (controller.signal.aborted) throw cancelled();
        const bytes = source instanceof Blob ? await source.arrayBuffer() : source instanceof ArrayBuffer ? source.slice(0)
          : ArrayBuffer.isView(source) ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) : null;
        if (!bytes || bytes.byteLength !== asset.byteLength) throw new Error("The photo or cutout source is missing or changed.");
        if (controller.signal.aborted) throw cancelled();
        return { message: { type: "source-copy", request: { asset, bytes, width, height } }, transfer: [bytes] };
      },
      onMessage: (message) => {
        if (message.type === "source-copy-result") output = message;
        if (message.type === "source-copy-error") failure = new Error(message.message);
        if (message.type === "done" && output?.output instanceof ArrayBuffer) { retained.set(id, output.output.byteLength * 3); report(); }
      },
    });
    try {
      await task.promise;
      if (controller.signal.aborted) throw cancelled();
      if (failure) throw failure;
      if (!(output?.output instanceof ArrayBuffer) || output.format !== "png" || output.mime !== "image/png" || output.width !== width || output.height !== height
        || asset.kind === "mask" && output.mode !== "L") throw new Error("The photo or cutout copy did not match the requested dimensions and format.");
      const sha256 = await hashAsset(output.output);
      if (controller.signal.aborted) throw cancelled();
      const blob = new Blob([output.output], { type: "image/png" });
      const reduced = !asset.workingCopy && Math.max(asset.width, asset.height) > WORKING_COPY_EDGE && dimensionsMatch(workingCopySize(asset.width, asset.height), target);
      const next = { id, kind: asset.kind, name: `${asset.name} · ${asset.kind === "image" ? "editing copy" : "matched cutout"}`,
        type: "image/png", byteLength: blob.size, sha256, width, height, orientation: "upright", lastModified: 0,
        ...(reduced ? { workingCopy: { sourceAssetId: asset.id, sourceSha256: asset.sha256, maxEdge: WORKING_COPY_EDGE, method: WORKING_COPY_METHOD } } : {}) };
      additions.push(next); sources.set(id, blob); output = null; retained.set(id, blob.size); report(); return next;
    } finally { output = null; }
  }
  const pending = [prepare(plan.image), prepare(plan.mask)];
  try {
    const [image, mask] = await Promise.all(pending);
    if (controller.signal.aborted) throw cancelled();
    const sizes = new Map([...Object.values(snapshot.assets), ...additions].map(asset => [asset.sha256, asset.byteLength]));
    if ([...sizes.values()].reduce((sum, n) => sum + n, 0) > 128 * 1024 * 1024) throw new Error("This conversion exceeds the story's 128 MiB asset budget. The current story is unchanged.");
    const photo = { ...snapshot.nodes[photoId], assetId: image.id }; if (mask) photo.maskId = mask.id;
    const command = { type: "group", commands: [...additions.map(value => ({ type: "asset", id: value.id, value })), { type: "node", id: photoId, value: photo }] };
    applyProjectCommand(snapshot, command);
    return { command, sources, restoredMask: Boolean(plan.mask?.restoredOriginal), upsampledMask: Boolean(plan.mask?.upsampled && !plan.mask.existing) };
  } catch (error) {
    controller.abort(); await Promise.allSettled(pending); sources.clear(); retained.clear(); report(); throw error;
  } finally { signal?.removeEventListener("abort", abort); }
}
