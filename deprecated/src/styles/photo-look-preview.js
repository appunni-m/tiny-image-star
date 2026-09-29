import { createProcessingClient, getProcessingScheduler } from "../processing/client.js";
import { legacyRecipeProblem } from "./legacy.js";
import { inspectionWork } from "../processing/policy.js";

export async function inspectPhotoLookSample(sample, signal) {
  if (sample.width && sample.height) return sample;
  const task = getProcessingScheduler().enqueue({ kind: "image", priority: 0, signal, estimate: inspectionWork(sample.bytes.byteLength), workClass: "inspect",
    prepare: () => {
      const bytes = sample.bytes.slice().buffer;
      return { message: { type: "inspect", revision: 1, file: { id: sample.id, name: sample.name, bytes } }, transfer: [bytes] };
    } });
  const result = await task.promise;
  if (result.type !== "inspect-result") throw new Error(result.message || "This photo could not be inspected.");
  return { ...sample, width: result.width, height: result.height };
}

export function renderPhotoLookPreview(sample, look, { signal, priority = 2, longEdge = 512 } = {}) {
  const settings = { ...structuredClone(sample.operations), photoLook: structuredClone(look) };
  const problem = legacyRecipeProblem({ id: "photo-look-preview", name: "Photo look preview", operations: settings });
  if (problem) return Promise.reject(new Error(problem));
  return new Promise((resolve, reject) => {
    const client = createProcessingClient({ priority }), revision = 1;
    let result, failure, finished = false;
    const stop = (error) => {
      if (finished) return;
      finished = true; signal?.removeEventListener("abort", abort); client.terminate();
      if (error) { reject(error); return; }
      const blob = new Blob([result.output], { type: result.mime }), owner = {};
      const pool = getProcessingScheduler(); pool.setRetainedBytes(owner, blob.size * 2 + result.width * result.height * 4);
      const url = URL.createObjectURL(blob);
      resolve({ url, width: result.width, height: result.height, release() { URL.revokeObjectURL(url); pool.setRetainedBytes(owner, 0); } });
    };
    const abort = () => stop(new DOMException("Preview cancelled.", "AbortError"));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    client.addEventListener("message", ({ data }) => {
      if (data.type === "result") result = data;
      if (["file-error", "fatal-error"].includes(data.type)) failure = new Error(data.message);
    });
    const message = { type: "process", jobId: "photo-look-preview", revision, previewLongEdge: longEdge,
      files: [{ id: sample.id, name: sample.name, settings }] };
    client.submit({ message, source: { width: sample.width, height: sample.height, encodedBytes: sample.bytes.byteLength }, prepare: () => {
      const bytes = sample.bytes.slice().buffer;
      return { message: { ...message, files: [{ ...message.files[0], bytes }] }, transfer: [bytes] };
    } }).then(() => stop(failure ?? (result ? null : new Error("The photo preview could not be created."))), stop);
  });
}
