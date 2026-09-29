import { ResourceScheduler } from "./scheduler.js";
import { createOriginAdmission } from "./origin-admission.js";
import { imageWork, inspectionWork, workClass } from "./policy.js";
import { sourceRelativeParts, settingsForLargeJob, validateSourceMetadata } from "../jobs/core.js";
import { copyLoadedFonts } from "../editor/fonts.js";
import { folderRenderRequest } from "../jobs/render-context.js";

let scheduler;
export function getProcessingScheduler() {
  if (!scheduler) {
    scheduler = new ResourceScheduler({
      hints: globalThis.navigator ?? {},
      admissionFactory: createOriginAdmission,
      workerFactory: (kind) => new Worker(kind === "folder"
        ? new URL("../jobs/large-worker.js", import.meta.url)
        : new URL("../worker.js", import.meta.url), { type: "module" }),
    });
  }
  return scheduler;
}

// A logical client preserves the UI's message contract without owning a
// physical worker. Input preparation runs only after resource admission.
export function createProcessingClient({ kind = "image", priority = 1, latestOnly = false } = {}) {
  const pool = getProcessingScheduler();
  const client = new EventTarget();
  const operations = new Set();
  let closed = false;
  const emit = (data) => { if (!closed) client.dispatchEvent(new MessageEvent("message", { data })); };
  client.cancelPending = () => { for (const controller of operations) controller.abort(); operations.clear(); };
  client.cancelIfQueued = () => {
    if ([...operations].some((controller) => ["starting", "running"].includes(controller.task?.state))) return false;
    client.cancelPending();
    return true;
  };
  client.terminate = () => { closed = true; client.cancelPending(); };

  client.submit = ({ message, source = {}, prepare = () => ({ message }) }) => {
    if (closed) return;
    if (latestOnly) client.cancelPending();
    const controller = new AbortController();
    operations.add(controller);
    const base = { kind, priority, signal: controller.signal };
    const settings = kind === "folder" ? settingsForLargeJob(message.recipe, message.format) : message.files?.[0]?.settings ?? message.settings ?? {};
    const run = async () => {
      let metadata = source;
      if (kind === "folder") {
        const current = await folderRenderRequest(message);
        message = { ...message, entry: current.entry, sourceRoot: current.job.sourceHandle, outputRoot: current.job.outputHandle };
        // Read metadata only before admission. A user may repair a failed
        // source before Retry; pin this attempt's actual size and timestamp.
        const parts = sourceRelativeParts(message.entry.relativePath);
        const name = parts.pop();
        let directory = message.sourceRoot;
        for (const part of parts) directory = await directory.getDirectoryHandle(part);
        const handle = await directory.getFileHandle(name);
        const file = await handle.getFile();
        validateSourceMetadata(message.entry, file);
        metadata = { ...source, encodedBytes: file.size, lastModified: file.lastModified };
      }
      if (controller.signal.aborted) return;
      const prepareCurrent = async () => {
        const packet = await prepare();
        return kind === "folder" ? { ...packet, message: { ...packet.message, expectedSource: { size: metadata.encodedBytes, lastModified: metadata.lastModified, sha256: metadata.sourceDigest } } } : packet;
      };
      if (!metadata.width || !metadata.height) {
        const inspection = pool.enqueue({ ...base, estimate: inspectionWork(metadata.encodedBytes), workClass: "inspect",
          prepare: async () => {
            const packet = await prepareCurrent();
            return { ...packet, message: { ...packet.message, type: "inspect", file: packet.message.file ?? packet.message.files?.[0] } };
          },
        });
        controller.task = inspection;
        const result = await inspection.promise;
        if (result.type !== "inspect-result") throw new Error(result.message || "This image could not be inspected.");
        metadata = { ...metadata, width: result.width, height: result.height, encodedBytes: result.inputBytes, sourceDigest: result.sourceDigest };
      }
      if (controller.signal.aborted) return;
      const estimate = imageWork({ ...metadata, settings, preview: message.type === "preview", imagePreview: message.previewLongEdge != null, journal: kind === "folder" });
      const job = pool.enqueue({ ...base, estimate, prepare: async () => {
        const packet = await prepareCurrent();
        if (kind === "folder" || message.type !== "process" || !settings.textLayers?.length) return packet;
        const fonts = copyLoadedFonts(settings.textLayers);
        return { message: { ...packet.message, files: packet.message.files.map((file) => ({ ...file, fontRecords: fonts.records })) }, transfer: [...(packet.transfer ?? []), ...fonts.transfer] };
      }, workClass: workClass({ ...metadata, settings, preview: message.type === "preview", imagePreview: message.previewLongEdge != null }), onMessage: emit });
      controller.task = job;
      await job.promise;
    };
    return run().catch((error) => {
      if (controller.signal.aborted || closed) return;
      const common = { revision: message.revision, jobId: message.jobId, claimId: message.entry?.claimId, fileId: message.file?.id ?? message.files?.[0]?.id, index: message.entry?.index, message: error.message };
      if (kind === "folder") emit({ ...common, type: "error" });
      else if (message.type === "preview") emit({ ...common, type: "preview-error" });
      else {
        emit({ ...common, type: "file-error" });
        emit({ ...common, type: "done", completed: 0 });
      }
    }).finally(() => operations.delete(controller));
  };
  queueMicrotask(() => {
    emit({ type: kind === "folder" ? "starting" : "init-start" });
    pool.ready().then((capabilities) => emit(kind === "folder" ? { type: "ready", capabilities } : capabilities))
      .catch((error) => emit({ type: kind === "folder" ? "fatal" : "fatal-error", message: error.message }));
  });
  return client;
}
