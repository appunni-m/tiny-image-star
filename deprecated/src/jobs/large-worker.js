import { createPillowEngine, describeError } from "../engine/pillow.js";
import { isAnimatedImage } from "../input.js";
import { outputFormatForJob, outputRelativePath, sourceRelativeParts, settingsForLargeJob, validateSourceMetadata } from "./core.js";
import { MAX_SOURCE_BYTES } from "../processing/policy.js";
import { digestBytes, saveJournaledOutput } from "./output.js";
import { folderRenderRequest, folderRenderContext } from "./render-context.js";
import { pinManifestSource } from "./store.js";
import { FOLDER_SOURCE_SCHEMA } from "./source-contract.js";
import { inspectSceneSnapshot, inspectSceneEntry, renderSceneEntry, snapshotSceneGroup } from "./scene-worker.js";

let enginePromise;
let loadedEngine;

function loadEngine() {
  if (!enginePromise) enginePromise = createPillowEngine().then((engine) => { loadedEngine = engine; return engine; });
  return enginePromise;
}

async function resolveFile(root, relativePath) {
  const parts = sourceRelativeParts(relativePath);
  const name = parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  return directory.getFileHandle(name);
}

async function processEntry(message) {
  const started = message.diagnostics === true ? performance.now() : 0;
  const engine = await loadEngine();
  const engineReady = message.diagnostics === true ? performance.now() : 0;
  if(["scene-plan","scene-snapshot","scene-inspect","scene-process"].includes(message.type)){
    const result=message.type==="scene-plan"?await inspectSceneSnapshot(message):message.type==="scene-snapshot"?await snapshotSceneGroup(message):message.type==="scene-inspect"?await inspectSceneEntry(message):await renderSceneEntry(message,engine);
    self.postMessage({type:"result",jobId:message.jobId,index:message.entry.index,...result,heapBytes:engine.heapBytes()});return;
  }
  if (message.type !== "inspect" && !message.memoryEstimate) throw new Error("Missing processing memory budget");
  const { job, entry } = await folderRenderRequest(message);
  if(job.kind==="scene-collection")throw new Error("This batch requires the story compositor.");
  message = { ...message, entry };
  if (!job.sourceHandle || !job.outputHandle) throw new Error("The saved source or output folder is missing. Choose folders in a new job.");
  const context = message.type === "inspect" ? null : await folderRenderContext(message, job);
  const readStarted = message.diagnostics === true ? performance.now() : 0;
  const sourceHandle = await resolveFile(job.sourceHandle, message.entry.relativePath);
  const source = await sourceHandle.getFile();
  validateSourceMetadata(message.entry, source);
  if (source.size > MAX_SOURCE_BYTES || source.size !== message.expectedSource?.size || source.lastModified !== message.expectedSource?.lastModified) throw new Error("The source changed or is too large. Retry it after the source has finished saving.");
  const sourceBuffer = await source.arrayBuffer();
  const sourceBytes = new Uint8Array(sourceBuffer);
  const readFinished = message.diagnostics === true ? performance.now() : 0;
  const sourceDigest = await digestBytes(sourceBuffer);
  if (message.expectedSource?.sha256 && sourceDigest !== message.expectedSource.sha256) throw new Error("This source changed between inspection and rendering. Check it, then use Retry failed.");
  const boundEntry = await pinManifestSource(message.jobId, entry.index, entry.claimId,
    { schema: FOLDER_SOURCE_SCHEMA, sha256: sourceDigest, bytes: source.size, lastModified: source.lastModified }, message.owner);
  message = { ...message, entry: boundEntry };
  if (isAnimatedImage(sourceBytes)) throw new Error("Animated images are not supported yet.");
  const settings = context?.settings ?? settingsForLargeJob(job.recipe, outputFormatForJob(job));
  if (message.type === "inspect") {
    const metadata = engine.inspect({ bytes: sourceBuffer });
    self.postMessage({ type: "inspect-result", jobId: message.jobId, index: message.entry.index, ...metadata, sourceDigest, heapBytes: engine.heapBytes() });
    return;
  }
  const renderStarted = message.diagnostics === true ? performance.now() : 0;
  const result = await engine.render({
    id: `${message.jobId}:${message.entry.index}`,
    name: message.entry.sourceName,
    bytes: sourceBuffer,
    memoryEstimate: message.memoryEstimate,
    diagnostics: message.diagnostics === true,
    fontRecords: context.fontRecords,
  }, settings);
  const saveStarted = message.diagnostics === true ? performance.now() : 0;
  const relativeOutput = outputRelativePath(message.entry.relativePath, message.recipe.name, result.format);
  const committed = await saveJournaledOutput({ jobId: message.jobId, entry: message.entry, owner: message.owner,
    outputRoot: job.outputHandle, outputPath: relativeOutput, result, sourceDigest, renderDigest: context.renderDigest });
  self.postMessage({
    type: "result",
    workerId: message.workerId,
    jobId: message.jobId,
    index: message.entry.index,
    claimId: message.entry.claimId,
    recovered: committed.recovered,
    outputPath: relativeOutput,
    sourceBytes: source.size,
    outputBytes: result.outputBytes,
    width: result.width,
    height: result.height,
    format: result.format,
    heapBytes: engine.heapBytes(),
    ...(message.diagnostics === true ? { diagnostics: {
      schema: "tinystar/folder-timings@1", engineWaitMs: engineReady - started,
      // Source checks include job/asset preparation plus the image digest;
      // keep that work out of the engine-wait and image-read measurements.
      sourceReadMs: readFinished - readStarted, sourceDigestMs: renderStarted - readFinished + readStarted - engineReady,
      renderMs: saveStarted - renderStarted, journalSaveMs: performance.now() - saveStarted,
      render: result.diagnostics,
    } } : {}),
  });
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!["process", "inspect", "scene-plan", "scene-snapshot", "scene-inspect", "scene-process"].includes(message?.type)) return;
  processEntry(message).catch((error) => {
    self.postMessage({
      type: "error",
      workerId: message.workerId,
      jobId: message.jobId,
      index: message.entry?.index,
      claimId: message.entry?.claimId,
      code: error?.name === "QuotaExceededError" ? "STORAGE_FULL" : error?.code,
      message: error?.userMessage ?? describeError(error),
      heapBytes: loadedEngine?.heapBytes() ?? 0,
    });
  });
});

self.postMessage({ type: "starting" });
loadEngine()
  .then((engine) => self.postMessage({ type: "ready", capabilities: engine.capabilities, heapBytes: engine.heapBytes() }))
  .catch((error) => self.postMessage({ type: "fatal", message: describeError(error) }));
