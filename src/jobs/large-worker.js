import { createPillowEngine, describeError } from "../engine/pillow.js";
import { isAnimatedImage } from "../input.js";
import { outputRelativePath, safeRelativeParts, settingsForLargeJob } from "./core.js";

let enginePromise;
const OUTPUT_WRITE_CHUNK_BYTES = 4 * 1024 * 1024;

function loadEngine() {
  if (!enginePromise) enginePromise = createPillowEngine();
  return enginePromise;
}

async function resolveFile(root, relativePath) {
  const parts = safeRelativeParts(relativePath);
  const name = parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  return directory.getFileHandle(name);
}

async function resolveOutput(root, relativePath) {
  const parts = safeRelativeParts(relativePath);
  const name = parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  return directory.getFileHandle(name, { create: true });
}

async function writeOutput(writable, bytes) {
  for (let offset = 0; offset < bytes.byteLength; offset += OUTPUT_WRITE_CHUNK_BYTES) {
    await writable.write(bytes.subarray(offset, Math.min(bytes.byteLength, offset + OUTPUT_WRITE_CHUNK_BYTES)));
  }
}

async function processEntry(message) {
  const engine = await loadEngine();
  const sourceHandle = await resolveFile(message.sourceRoot, message.entry.relativePath);
  const source = await sourceHandle.getFile();
  const sourceBuffer = await source.arrayBuffer();
  const sourceBytes = new Uint8Array(sourceBuffer);
  if (isAnimatedImage(sourceBytes)) throw new Error("Animated images are not supported yet.");
  const settings = settingsForLargeJob(message.recipe);
  const result = await engine.render({
    id: `${message.jobId}:${message.entry.index}`,
    name: message.entry.sourceName,
    bytes: sourceBuffer,
  }, settings);
  const relativeOutput = outputRelativePath(message.entry.relativePath, message.recipe.name, result.format);
  const outputHandle = await resolveOutput(message.outputRoot, relativeOutput);
  const writable = await outputHandle.createWritable();
  try {
    await writeOutput(writable, result.bytes);
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch?.(() => {});
    throw error;
  }
  self.postMessage({
    type: "result",
    workerId: message.workerId,
    jobId: message.jobId,
    index: message.entry.index,
    outputPath: relativeOutput,
    sourceBytes: source.size,
    outputBytes: result.outputBytes,
    width: result.width,
    height: result.height,
    format: result.format,
  });
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type !== "process") return;
  processEntry(message).catch((error) => {
    self.postMessage({
      type: "error",
      workerId: message.workerId,
      jobId: message.jobId,
      index: message.entry?.index,
      message: describeError(error),
    });
  });
});

self.postMessage({ type: "starting" });
loadEngine()
  .then((engine) => self.postMessage({ type: "ready", capabilities: engine.capabilities }))
  .catch((error) => self.postMessage({ type: "fatal", message: describeError(error) }));
