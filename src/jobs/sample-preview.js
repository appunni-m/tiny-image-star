import { getProcessingScheduler } from "../processing/client.js";
import { imageWork, inspectionWork, workClass } from "../processing/policy.js";
import { isAnimatedImage } from "../input.js";
import { outputFormatForJob, settingsForLargeJob, sourceRelativeParts, validateSourceMetadata } from "./core.js";
import { getManifestPage } from "./store.js";
import { readFolderFontRecords } from "./render-context.js";
import { createFolderSampleSelector } from "./sample-plan.js";
import { assertSourceDigest } from "./source-contract.js";
import { digestBytes } from "./output.js";

const cancelled = (signal) => { if (signal?.aborted) throw new DOMException("Sample preview cancelled.", "AbortError"); };
export async function selectFolderSamples(job, signal) {
  if (!job.scanComplete) throw new Error("Finish scanning the folder before previewing its recipe.");
  const selector = createFolderSampleSelector(job.discovered);
  for (let start = 0; start < job.discovered; start += 512) {
    cancelled(signal);
    const count = Math.min(512, job.discovered - start);
    const entries = await getManifestPage(job.id, start, count);
    if (entries.length !== count) throw new Error("The saved folder manifest changed. Reopen the job.");
    for (const entry of entries) selector.add(entry);
  }
  cancelled(signal); return selector.finish();
}

export async function renderFolderSample(job, entry, { signal, priority = 1 } = {}) {
  const pool = getProcessingScheduler(), owner = {};
  const settings = settingsForLargeJob(job.recipe, outputFormatForJob(job));
  const parts = sourceRelativeParts(entry.relativePath), name = parts.pop(); let directory = job.sourceHandle;
  for (const part of parts) { cancelled(signal); directory = await directory.getDirectoryHandle(part); }
  const handle = await directory.getFileHandle(name), metadata = await handle.getFile();
  validateSourceMetadata(entry, metadata); cancelled(signal);
  const read = async () => {
    cancelled(signal);
    const file = await handle.getFile();
    if (file.size !== metadata.size || file.lastModified !== metadata.lastModified) throw new Error("This sample changed during preview. Close and preview the folder again.");
    const bytes = await file.arrayBuffer(); cancelled(signal);
    if (entry.sourceIdentity) assertSourceDigest(entry, await digestBytes(bytes));
    if (isAnimatedImage(new Uint8Array(bytes))) throw new Error("Animated images are not supported yet.");
    return bytes;
  };
  const inspected = await pool.enqueue({ priority, signal, workClass: "inspect", estimate: inspectionWork(metadata.size),
    prepare: async () => { const bytes = await read(); return { message: { type: "inspect", revision: 1, file: { id: entry.index, name, bytes } }, transfer: [bytes] }; },
  }).promise;
  if (inspected.type !== "inspect-result") throw new Error(inspected.message || "This sample could not be read.");
  cancelled(signal);
  let result, error, url;
  try {
    await pool.enqueue({ priority, signal, workClass: `folder-sample:${workClass({ width: inspected.width, height: inspected.height, settings, imagePreview: true })}`, estimate: imageWork({ width: inspected.width, height: inspected.height, encodedBytes: metadata.size, settings, imagePreview: true, journal: true }),
      prepare: async () => {
        cancelled(signal);
        const fontRecords = await readFolderFontRecords(job, { allowLibrary: true }), bytes = await read(); cancelled(signal);
        return { message: { type: "process", revision: 1, jobId: "folder-sample", previewLongEdge: 512,
          files: [{ id: entry.index, name, bytes, settings, fontRecords, diagnostics: true }] }, transfer: [bytes, ...fontRecords.map(record => record.bytes)] };
      },
      onMessage: (message) => {
        if (message.type === "result" && !signal?.aborted) {
          result = message;
          // Reserve returned encoded bytes, Blob construction and the visible
          // thumbnail surface before the scheduler releases the render task.
          pool.setRetainedBytes(owner, message.output.byteLength * 2 + message.width * message.height * 4);
        }
        if (["file-error", "fatal-error"].includes(message.type)) error = new Error(message.message);
      },
    }).promise;
    cancelled(signal);
    if (error || !result?.fullOutput) throw error ?? new Error("This sample could not be rendered.");
    const blob = new Blob([result.output], { type: result.mime });
    url = URL.createObjectURL(blob);
    return { url, width: result.width, height: result.height, fullOutput: result.fullOutput,
      source: { width: inspected.width, height: inspected.height, bytes: metadata.size },
      framingReview: Boolean(settings.cropRelative || settings.resizeMode === "crop" && settings.resizeWidth && settings.resizeHeight),
      release() { URL.revokeObjectURL(url); pool.setRetainedBytes(owner, 0); } };
  } catch (failure) { if (url) URL.revokeObjectURL(url); pool.setRetainedBytes(owner, 0); throw failure; }
}
