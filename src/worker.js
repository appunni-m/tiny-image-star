import { createPillowEngine, describeError } from "./engine/pillow.js";

let newestRevision = 0;
let enginePromise;

function loadEngine() {
  if (!enginePromise) enginePromise = createPillowEngine();
  return enginePromise;
}

function yieldToMessages() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function errorText(error) {
  return describeError(error);
}

function friendlyError(error) {
  const detail = errorText(error).toLowerCase();
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

async function renderOne(engine, file, settings) {
  return engine.render(file, settings);
}

async function previewOne(engine, file) {
  return engine.preview(file);
}

async function processPreview(message) {
  const engine = await loadEngine();
  if (message.revision !== newestRevision) return;
  try {
    const result = await previewOne(engine, message.file);
    const transfer = result.bytes.buffer;
    self.postMessage({
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
    self.postMessage({
      type: "preview-error",
      revision: message.revision,
      fileId: message.file.id,
      message: friendlyError(error),
    });
  }
}

async function processBatch(message) {
  const { revision, files, settings } = message;
  const engine = await loadEngine();
  let completed = 0;

  for (const file of files) {
    await yieldToMessages();
    if (revision !== newestRevision) {
      self.postMessage({ type: "cancelled", revision, jobId: message.jobId });
      return;
    }

    try {
      const result = await renderOne(engine, file, file.settings ?? settings);
      const transfer = result.bytes.buffer;
      completed += 1;
      self.postMessage(
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
        },
        [transfer],
      );
    } catch (error) {
      self.postMessage({
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
    self.postMessage({ type: "cancelled", revision, jobId: message.jobId });
    return;
  }

  self.postMessage({ type: "done", revision, completed, total: files.length, jobId: message.jobId });
}

self.onmessage = (event) => {
  const message = event.data;
  if (!["process", "preview"].includes(message.type)) return;
  newestRevision = Math.max(newestRevision, message.revision);
  if (message.type === "preview") {
    processPreview(message).catch((error) => {
      self.postMessage({ type: "preview-error", revision: message.revision, fileId: message.file?.id, message: friendlyError(error) });
    });
  } else {
    processBatch(message).catch((error) => {
      self.postMessage({ type: "fatal-error", revision: message.revision, message: friendlyError(error) });
    });
  }
};

// The UI uses this handshake to distinguish an engine that is still starting
// from one that failed to initialize. The WASM artifact remains local to the
// worker; no image bytes are sent during startup.
self.postMessage({ type: "init-start" });

loadEngine()
  .then((engine) => {
    self.postMessage({
      type: "ready",
      ...engine.capabilities,
    });
  })
  .catch((error) => {
    self.postMessage({ type: "fatal-error", message: friendlyError(error) });
  });
