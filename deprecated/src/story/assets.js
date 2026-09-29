import { getProcessingScheduler } from "../processing/client.js";
import { workingCopyWork, inspectionWork } from "../processing/policy.js";
import { exifOrientationFromBytes } from "../engine/pillow.js";
import { inputProblem } from "../input.js";
import { hashAsset } from "../project/storage.js";
import { newId } from "../project/model.js";
import { WORKING_COPY_EDGE, WORKING_COPY_METHOD, workingCopySize } from "../project/working-copy.js";

export const STORY_SOURCE_LIMIT = 96 * 1024 * 1024;
// Leave room for the bundled fonts inside the existing 128 MiB story store.
export const STORY_IMPORT_ASSET_LIMIT = 120 * 1024 * 1024;

export async function importStoryPhotos(files, { signal, smallerCopies = false, onProgress = () => {}, onRetainedBytes = () => {}, pool = getProcessingScheduler() } = {}) {
  if (!files.length || files.length > 12 || files.reduce((sum, file) => sum + file.size, 0) > STORY_SOURCE_LIMIT) throw new Error("Choose up to 12 photos totaling at most 96 MB.");
  if (typeof smallerCopies !== "boolean") throw new Error("Choose whether to use smaller editing copies.");
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  const originalBytes = [...new Set(files)].reduce((sum, file) => sum + file.size, 0), retained = new Map(), copies = new Map();
  const report = () => onRetainedBytes(originalBytes + [...retained.values()].reduce((sum, size) => sum + size, 0));
  report();
  let completed = 0;

  async function reduce(entry) {
    const { asset, source } = entry, size = workingCopySize(asset.width, asset.height);
    if (!smallerCopies || size.width === asset.width && size.height === asset.height) return entry;
    const settings = { format: "png", maxWidth: WORKING_COPY_EDGE, maxHeight: WORKING_COPY_EDGE, brightness: 1, contrast: 1 };
    let output, failure;
    const task = pool.enqueue({ kind: "image", priority: 0, signal: controller.signal,
      // This is a full Pillow decode. Never estimate it as a 2048px input.
      estimate: workingCopyWork({ width: asset.width, height: asset.height, encodedBytes: asset.byteLength, settings }), workClass: "story-working-copy",
      prepare: async () => {
        const bytes = await source.arrayBuffer();
        if (controller.signal.aborted) throw new DOMException("Import cancelled.", "AbortError");
        if (bytes.byteLength !== asset.byteLength || await hashAsset(bytes) !== asset.sha256) throw new Error("An original photo changed before its editing copy was prepared.");
        return { message: { type: "process", files: [{ id: asset.id, name: asset.name, bytes }], settings }, transfer: [bytes] };
      },
      onMessage: (message) => {
        if (message.type === "result") output = message;
        if (message.type === "file-error") failure = new Error(message.message);
        // The scheduler holds the render reservation through 'done'. Transfer
        // ownership synchronously before it can admit another task. Three
        // copies cover output bytes, Blob construction and the hash snapshot.
        if (message.type === "done" && output?.output instanceof ArrayBuffer) {
          retained.set(asset.id, output.output.byteLength * 3); copies.set(asset.id, output.output.byteLength); report();
        }
      },
    });
    try {
      await task.promise;
      if (controller.signal.aborted) throw new DOMException("Import cancelled.", "AbortError");
      if (failure) throw failure;
      if (!(output?.output instanceof ArrayBuffer) || output.format !== "png" || output.mime !== "image/png"
        || output.width !== size.width || output.height !== size.height) throw new Error("The editing copy did not match the requested size and format.");
      if (originalBytes + [...copies.values()].reduce((sum, bytes) => sum + bytes, 0) > STORY_IMPORT_ASSET_LIMIT)
        throw new Error("The originals and editing copies exceed 120 MB. Choose smaller photos or fewer photos.");
      const sha256 = await hashAsset(output.output);
      if (controller.signal.aborted) throw new DOMException("Import cancelled.", "AbortError");
      const blob = new Blob([output.output], { type: "image/png" });
      retained.set(asset.id, blob.size); output = null; report();
      return { source: blob, original: entry, asset: { id: newId("asset"), kind: "image", name: `${asset.name} · editing copy`,
        type: "image/png", byteLength: blob.size, sha256, ...size, orientation: "upright", lastModified: 0,
        workingCopy: { sourceAssetId: asset.id, sourceSha256: asset.sha256, maxEdge: WORKING_COPY_EDGE, method: WORKING_COPY_METHOD } } };
    } finally { output = null; }
  }

  const pending = files.map(async (file) => {
      let sha256, orientation;
      const task = pool.enqueue({ kind: "image", priority: 0, signal: controller.signal, estimate: inspectionWork(file.size), workClass: "story-import",
        prepare: async () => {
          const bytes = await file.arrayBuffer();
          if (controller.signal.aborted) throw new DOMException("Import cancelled.", "AbortError");
          const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
          const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => head[index] === value);
          const jpeg = head[0] === 255 && head[1] === 216 && head[2] === 255;
          const webp = String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP";
          if (!png && !jpeg && !webp) throw new Error(`${file.name}: Choose a PNG, JPEG or WebP photo.`);
          const problem = inputProblem(bytes); if (problem) throw new Error(`${file.name}: ${problem.message}`);
          sha256 = await hashAsset(bytes); orientation = Number(exifOrientationFromBytes(new Uint8Array(bytes)) ?? 1);
          return { message: { type: "inspect", file: { bytes } }, transfer: [bytes] };
        },
      });
      const result = await task.promise;
      if (result.type !== "inspect-result") throw new Error(`${file.name}: ${result.message ?? "This photo could not be read."}`);
      const swap = orientation >= 5 && orientation <= 8;
      const entry = await reduce({ source: file, asset: { id: newId("asset"), kind: "image", name: file.name, type: file.type || "application/octet-stream", byteLength: file.size,
        sha256, width: swap ? result.height : result.width, height: swap ? result.width : result.height, orientation: "exif-to-upright", lastModified: file.lastModified || 0 } });
      if (controller.signal.aborted) throw new DOMException("Import cancelled.", "AbortError");
      onProgress(++completed, files.length); return entry;
  });
  try { return await Promise.all(pending); }
  catch (error) { controller.abort(); await Promise.allSettled(pending); retained.clear(); copies.clear(); onRetainedBytes(0); throw error; }
  finally { signal?.removeEventListener("abort", abort); }
}
