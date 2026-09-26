import { createPillowEngine, describeError } from "./engine/pillow.js";

let newestRevision = 0;
let enginePromise;
let loadedEngine;

function post(message, transfer = []) {
  self.postMessage({ ...message, heapBytes: loadedEngine?.heapBytes() ?? 0 }, transfer);
}

function loadEngine() {
  if (!enginePromise) enginePromise = createPillowEngine().then((engine) => { loadedEngine = engine; return engine; });
  return enginePromise;
}

function yieldToMessages() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function errorText(error) {
  return describeError(error);
}

function friendlyError(error) {
  if (error?.userMessage) return error.userMessage;
  const detail = errorText(error).toLowerCase();
  if (detail.includes("memory budget")) return "This image exceeds the processing memory budget. Choose a smaller image.";
  if (detail.includes("memory") || detail.includes("allocation")) return "There was not enough memory to update this image. Close other images or choose a smaller source.";
  if (detail.includes("too large")) {
    return "This output is too large to process safely. Choose smaller dimensions.";
  }
  if (detail.includes("format") || detail.includes("encode")) {
    return "That output format is not available yet.";
  }
  if (detail.includes("decode") || detail.includes("open") || detail.includes("invalid")) {
    return "This image could not be read. Try another file.";
  }
  return "This image could not be updated. Try another file.";
}

async function renderOne(engine, file, settings, estimate, previewLongEdge) {
  if (!estimate) throw new Error("Missing processing memory budget");
  return previewLongEdge == null ? engine.render({ ...file, memoryEstimate: estimate }, settings)
    : engine.renderImagePreview({ ...file, memoryEstimate: estimate }, settings, previewLongEdge);
}

async function previewOne(engine, file, estimate) {
  if (!estimate) throw new Error("Missing processing memory budget");
  return engine.preview({ ...file, memoryEstimate: estimate });
}

async function processPreview(message) {
  const engine = await loadEngine();
  if (message.revision !== newestRevision) return;
  try {
    const result = await previewOne(engine, message.file, message.memoryEstimate);
    const transfer = result.bytes.buffer;
    post({
      type: "preview-result",
      revision: message.revision,
      fileId: message.file.id,
      output: transfer,
      width: result.width,
      height: result.height,
      mime: result.mime,
      format: result.format,
    }, [transfer]);
  } catch (error) {
    post({
      type: "preview-error",
      revision: message.revision,
      fileId: message.file.id,
      message: friendlyError(error),
    });
  }
}

async function processScene(message) {
  try {
    const engine = await loadEngine();
    if (message.revision !== newestRevision) return;
    if (!message.memoryEstimate) throw new Error("Missing processing memory budget");
    const request = { ...message.request, memoryEstimate: message.memoryEstimate };
    const result = await (request.preview ? engine.renderPreview(request) : engine.renderSlide(request));
    if (message.revision !== newestRevision) return;
    const { bytes, ...metadata } = result;
    post({ ...metadata, type: "scene-result", revision: message.revision, projectRevision: result.revision, output: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    post({ type: "scene-error", revision: message.revision, code: error?.code ?? "RENDER_FAILED", message: friendlyError(error) });
  }
  post({ type: "done", revision: message.revision });
}

async function processMask(message) {
  try {
    const engine = await loadEngine();
    if (message.revision !== newestRevision) return;
    if (!message.memoryEstimate) throw new Error("Missing processing memory budget");
    const result = await engine.editMask({ ...message.request, memoryEstimate: message.memoryEstimate });
    const transfer = ["mask", "preview", "sourcePreview", "maskPreview"].filter((key) => result[key]).map((key) => { result[key] = result[key].buffer; return result[key]; });
    if (message.revision !== newestRevision) return;
    post({ ...result, type: "mask-result", revision: message.revision }, transfer);
  } catch (error) { post({ type: "mask-error", revision: message.revision, message: error.userMessage || "This cutout could not be updated. Try another mask or a smaller photo." }); }
  post({ type: "done", revision: message.revision });
}

async function processSourceCopy(message) {
  try {
    const engine = await loadEngine();
    if (message.revision !== newestRevision) return;
    if (!message.memoryEstimate) throw new Error("Missing processing memory budget");
    const { bytes, ...metadata } = await engine.resampleSource({ ...message.request, memoryEstimate: message.memoryEstimate });
    if (message.revision !== newestRevision) return;
    post({ ...metadata, type: "source-copy-result", revision: message.revision, output: bytes.buffer }, [bytes.buffer]);
  } catch (error) { post({ type: "source-copy-error", revision: message.revision, message: friendlyError(error) }); }
  post({ type: "done", revision: message.revision });
}

async function processBatch(message) {
  const { revision, files, settings } = message;
  const engine = await loadEngine();
  let completed = 0;

  for (const file of files) {
    await yieldToMessages();
    if (revision !== newestRevision) {
      post({ type: "cancelled", revision, jobId: message.jobId });
      return;
    }

    try {
      const result = await renderOne(engine, file, file.settings ?? settings, message.memoryEstimate, message.previewLongEdge);
      const transfer = result.bytes.buffer;
      completed += 1;
      post(
        {
          type: "result",
          revision,
          fileId: file.id,
          completed,
          total: files.length,
          name: file.name,
          outputName: result.name,
          mime: result.mime,
          width: result.width,
          height: result.height,
          mode: result.mode,
          inputBytes: result.inputBytes,
          outputBytes: result.outputBytes,
          format: result.format,
          output: transfer,
          jobId: message.jobId,
          ...(result.fullOutput ? { fullOutput: result.fullOutput } : {}),
        },
        [transfer],
      );
    } catch (error) {
      post({
        type: "file-error",
        revision,
        fileId: file.id,
        name: file.name,
        jobId: message.jobId,
        message: friendlyError(error),
      });
    }
  }

  if (revision !== newestRevision) {
    post({ type: "cancelled", revision, jobId: message.jobId });
    return;
  }

  post({ type: "done", revision, completed, total: files.length, jobId: message.jobId });
}

self.onmessage = (event) => {
  const message = event.data;
  if (!["process", "preview", "inspect", "scene", "mask", "source-copy"].includes(message.type)) return;
  newestRevision = Math.max(newestRevision, message.revision);
  if (message.type === "scene") { void processScene(message); return; }
  if (message.type === "mask") { void processMask(message); return; }
  if (message.type === "source-copy") { void processSourceCopy(message); return; }
  if (message.type === "inspect") {
    loadEngine().then((engine) => post({ type: "inspect-result", revision: message.revision, ...engine.inspect(message.file) }))
      .catch((error) => post({ type: "inspect-error", revision: message.revision, message: friendlyError(error) }));
    return;
  }
  if (message.type === "preview") {
    processPreview(message).catch((error) => {
      post({ type: "preview-error", revision: message.revision, fileId: message.file?.id, message: friendlyError(error) });
    });
  } else {
    processBatch(message).catch((error) => {
      post({ type: "fatal-error", revision: message.revision, message: friendlyError(error) });
    });
  }
};

// The UI uses this handshake to distinguish an engine that is still starting
// from one that failed to initialize. The WASM artifact remains local to the
// worker; no image bytes are sent during startup.
post({ type: "init-start" });

loadEngine()
  .then((engine) => {
    post({
      type: "ready",
      ...engine.capabilities,
    });
  })
  .catch((error) => {
    post({ type: "fatal-error", message: friendlyError(error) });
  });
