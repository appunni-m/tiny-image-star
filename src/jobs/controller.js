import { fileMatchesFormats, formatLabel, normalizeCapabilities, normalizeFormat } from "../formats.js";
import {
  DEFAULT_ROW_HEIGHT,
  MANIFEST_WRITE_SIZE,
  MAX_LARGE_FOLDER_FILES,
  createLargeJob,
  createManifestEntry,
  formatJobBytes,
  jobProgress,
  largeJobActionState,
  largeWorkerCount,
  virtualWindow,
} from "./core.js";
import {
  clearManifestEntries,
  claimPendingEntries,
  commitManifestEntry,
  deleteLargeJob,
  getManifestPage,
  largeJobStorageAvailable,
  listLargeJobs,
  putLargeJob,
  putManifestEntries,
  resetInterruptedEntries,
  retryFailedEntries,
} from "./store.js";

const elements = {
  panel: document.querySelector("#folder-job-panel"),
  source: document.querySelector("#folder-job-source-button"),
  output: document.querySelector("#folder-job-output-button"),
  sourceName: document.querySelector("#folder-job-source-name"),
  outputName: document.querySelector("#folder-job-output-name"),
  recipe: document.querySelector("#folder-job-recipe"),
  recipeSummary: document.querySelector("#folder-job-recipe-summary"),
  performance: document.querySelector("#folder-job-performance"),
  start: document.querySelector("#folder-job-start-button"),
  pause: document.querySelector("#folder-job-pause-button"),
  retry: document.querySelector("#folder-job-retry-button"),
  forget: document.querySelector("#folder-job-forget-button"),
  status: document.querySelector("#folder-job-status"),
  progress: document.querySelector("#folder-job-progress"),
  progressText: document.querySelector("#folder-job-progress-text"),
  discovered: document.querySelector("#folder-job-discovered"),
  completed: document.querySelector("#folder-job-completed"),
  failed: document.querySelector("#folder-job-failed"),
  sourceBytes: document.querySelector("#folder-job-source-bytes"),
  outputBytes: document.querySelector("#folder-job-output-bytes"),
  viewport: document.querySelector("#folder-job-results"),
  layer: document.querySelector("#folder-job-results-layer"),
  empty: document.querySelector("#folder-job-results-empty"),
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function picker() {
  return globalThis.__tinystarDirectoryPicker ?? globalThis.showDirectoryPicker;
}

export function supportsLargeFolderJobs() {
  return !globalThis.__tinystarDisableLargeFolderJobs
    && largeJobStorageAvailable()
    && typeof picker() === "function"
    && typeof Worker === "function";
}

async function ensurePermission(handle, mode) {
  if (!handle) return false;
  if (typeof handle.queryPermission !== "function") return true;
  const options = { mode };
  if (await handle.queryPermission(options) === "granted") return true;
  return typeof handle.requestPermission === "function" && await handle.requestPermission(options) === "granted";
}

async function* walkDirectory(directory, prefix = [], cancelled = () => false) {
  for await (const [name, handle] of directory.entries()) {
    if (cancelled()) return;
    if (handle.kind === "directory") {
      yield* walkDirectory(handle, [...prefix, name], cancelled);
      continue;
    }
    if (handle.kind !== "file") continue;
    const file = await handle.getFile();
    yield { relativePath: [...prefix, name].join("/"), file };
  }
}

function friendlyError(error) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  if (/permission|allowed/i.test(detail)) return "Folder permission is needed before this job can continue.";
  if (/quota|space|disk/i.test(detail)) return "The destination may be out of space. Free space or choose another folder.";
  return detail || "The folder job could not continue.";
}

function statusLabel(status) {
  return {
    pending: "Waiting",
    processing: "Updating",
    completed: "Saved",
    failed: "Needs attention",
    skipped: "Skipped",
  }[status] ?? status;
}

export function attachLargeFolderJobs({
  listRecipes,
  getDefaultRecipeId,
  getCapabilities,
  onActiveChange,
  onJobChange,
} = {}) {
  const state = {
    active: false,
    job: null,
    scanToken: 0,
    workers: [],
    pumpLocked: false,
    pumpAgain: false,
    schedulerTimer: null,
    renderToken: 0,
    rowsFrame: null,
    ready: false,
  };

  function recipes() {
    const capabilities = normalizeCapabilities(getCapabilities?.());
    return (listRecipes?.() ?? []).map((recipe) => {
      const next = clone(recipe);
      const requested = normalizeFormat(next.operations?.format);
      if (!next.operations) next.operations = {};
      next.operations.format = capabilities.outputFormats.includes(requested)
        ? requested
        : capabilities.outputFormats[0] ?? "png";
      next.operations.lossy = Boolean(next.operations.lossy && capabilities.compression.lossyFormats.includes(next.operations.format));
      return next;
    });
  }

  function selectedRecipe() {
    const options = recipes();
    return options.find((recipe) => recipe.id === elements.recipe?.value)
      ?? options.find((recipe) => recipe.id === getDefaultRecipeId?.())
      ?? options[0];
  }

  function refreshRecipeOptions() {
    if (!elements.recipe) return;
    const selected = state.job?.recipe?.id ?? elements.recipe.value ?? getDefaultRecipeId?.();
    elements.recipe.replaceChildren();
    for (const recipe of recipes()) {
      const option = document.createElement("option");
      option.value = recipe.id;
      option.textContent = recipe.name;
      elements.recipe.append(option);
    }
    if ([...elements.recipe.options].some((option) => option.value === selected)) elements.recipe.value = selected;
    renderRecipeSummary();
  }

  function renderRecipeSummary() {
    if (!elements.recipeSummary) return;
    const recipe = state.job?.recipe ?? selectedRecipe();
    if (!recipe) {
      elements.recipeSummary.textContent = "Choose a recipe.";
      return;
    }
    const operations = recipe.operations ?? {};
    const dimensions = operations.resizeWidth && operations.resizeHeight
      ? `${operations.resizeWidth} × ${operations.resizeHeight}`
      : "original dimensions";
    const fit = operations.resizeMode === "crop" ? "Fill frame" : "Keep whole image";
    const textNote = operations.textLayers?.length ? " · Text is available in regular editing" : "";
    elements.recipeSummary.textContent = `${fit} · ${dimensions} · ${formatLabel(operations.format)}${textNote}`;
  }

  function setStatus(message, { error = false } = {}) {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.state = error ? "error" : "";
  }

  function workersActive() {
    return state.workers.filter((worker) => worker.current).length;
  }

  function notifyChanged() {
    onJobChange?.(state.job);
  }

  function render() {
    const job = state.job;
    const supported = supportsLargeFolderJobs();
    if (elements.panel) elements.panel.dataset.supported = String(supported);
    if (!supported) {
      setStatus("This browser cannot save a very large folder directly. Use a current desktop browser with folder access, or add smaller sets of images.", { error: true });
    } else if (!job) {
      setStatus("Choose a source folder. Its image bytes will be read only when each file is processed.");
    } else if (job.error) {
      setStatus(job.error, { error: true });
    } else if (job.status === "scanning") {
      setStatus(`Finding images in ${job.sourceName}… You can choose the save folder while this continues.`);
    } else if (job.status === "running") {
      setStatus(`Saving results directly to ${job.outputFolderName}. You can pause after the active images finish.`);
    } else if (job.status === "pausing") {
      const active = workersActive();
      setStatus(`Pausing after ${active.toLocaleString()} active image${active === 1 ? "" : "s"} finish…`);
    } else if (job.status === "paused") {
      setStatus("Paused. Completed files are already saved; resume continues with the next waiting image.");
    } else if (job.status === "complete") {
      setStatus(`Complete. ${job.completed.toLocaleString()} images were saved in ${job.outputFolderName}.`);
    } else if (job.status === "needs-attention") {
      setStatus(job.failed ? `${job.failed.toLocaleString()} images need attention. Retry them after checking the destination.` : "This job needs attention before it can continue.", { error: true });
    } else {
      setStatus("Choose a save folder, then start processing.");
    }

    const progress = jobProgress(job);
    const actions = largeJobActionState(job);
    const selected = job?.recipe ?? selectedRecipe();
    const textUnsupported = Boolean(selected?.operations?.textLayers?.length);
    if (elements.sourceName) elements.sourceName.textContent = job?.sourceName ?? "No folder chosen";
    if (elements.outputName) elements.outputName.textContent = job?.outputFolderName ?? "No save folder chosen";
    if (elements.discovered) elements.discovered.textContent = (job?.discovered ?? 0).toLocaleString();
    if (elements.completed) elements.completed.textContent = (job?.completed ?? 0).toLocaleString();
    if (elements.failed) elements.failed.textContent = (job?.failed ?? 0).toLocaleString();
    if (elements.sourceBytes) elements.sourceBytes.textContent = formatJobBytes(job?.sourceBytes ?? 0);
    if (elements.outputBytes) elements.outputBytes.textContent = formatJobBytes(job?.outputBytes ?? 0);
    if (elements.progress) {
      elements.progress.max = Math.max(1, progress.discovered);
      elements.progress.value = progress.finished;
    }
    if (elements.progressText) {
      const total = job?.scanComplete ? progress.discovered.toLocaleString() : `${progress.discovered.toLocaleString()} found`;
      elements.progressText.textContent = `${progress.finished.toLocaleString()} of ${total}`;
    }
    if (elements.source) elements.source.disabled = !supported || ["running", "pausing", "paused"].includes(job?.status);
    if (elements.output) elements.output.disabled = !supported || !job?.sourceHandle || ["running", "pausing"].includes(job?.status);
    if (elements.recipe) elements.recipe.disabled = Boolean(job && (job.outputHandle || job.completed || ["running", "pausing", "paused"].includes(job.status)));
    if (elements.performance) elements.performance.disabled = ["running", "pausing"].includes(job?.status);
    if (elements.start) {
      elements.start.hidden = actions.startHidden;
      elements.start.disabled = textUnsupported || !supported || !job?.sourceHandle || !job?.outputHandle || !job?.scanComplete || job?.status === "complete";
      elements.start.title = textUnsupported ? "Text layers are not supported in large-folder save yet. Use the regular editor or remove the text layer." : "";
      elements.start.textContent = actions.startLabel;
    }
    if (elements.pause) elements.pause.hidden = job?.status !== "running";
    if (elements.retry) {
      elements.retry.hidden = actions.retryHidden;
      elements.retry.textContent = actions.retryLabel;
    }
    if (elements.forget) elements.forget.disabled = !job || ["running", "pausing"].includes(job.status);
    renderRecipeSummary();
    scheduleRows();
    notifyChanged();
  }

  async function persistJob(patch = {}) {
    if (!state.job) return null;
    state.job = { ...state.job, ...patch, updatedAt: Date.now() };
    await putLargeJob(state.job);
    render();
    return state.job;
  }

  function activate() {
    state.active = true;
    if (elements.panel) elements.panel.hidden = false;
    refreshRecipeOptions();
    render();
    onActiveChange?.(true);
  }

  function deactivate() {
    state.active = false;
    if (elements.panel) elements.panel.hidden = true;
    onActiveChange?.(false);
  }

  async function chooseSource() {
    activate();
    if (!supportsLargeFolderJobs()) return false;
    try {
      const sourceHandle = await picker().call(globalThis, { id: "tiny-image-star-source", mode: "read", startIn: "pictures" });
      const recipe = selectedRecipe();
      const createdAt = Date.now();
      state.scanToken += 1;
      terminateWorkers();
      if (state.job) await deleteLargeJob(state.job.id);
      state.job = createLargeJob({
        id: `folder-${createdAt}-${Math.random().toString(36).slice(2, 9)}`,
        sourceHandle,
        sourceName: sourceHandle.name,
        recipe,
        createdAt,
      });
      await putLargeJob(state.job);
      render();
      void discover(state.job.id, state.scanToken);
      return true;
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(friendlyError(error), { error: true });
      return false;
    }
  }

  async function chooseOutput() {
    if (!state.job || !supportsLargeFolderJobs()) return;
    try {
      const outputBaseHandle = await picker().call(globalThis, { id: "tiny-image-star-output", mode: "readwrite", startIn: "pictures" });
      const outputHandle = await outputBaseHandle.getDirectoryHandle(state.job.outputFolderName, { create: true });
      await persistJob({ outputBaseHandle, outputHandle, error: null });
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(friendlyError(error), { error: true });
    }
  }

  async function discover(jobId, token) {
    const job = state.job;
    if (!job || job.id !== jobId) return;
    const capabilities = normalizeCapabilities(getCapabilities?.());
    const buffer = [];
    let discovered = Number(job.discovered) || 0;
    let sourceBytes = Number(job.sourceBytes) || 0;
    try {
      for await (const candidate of walkDirectory(job.sourceHandle, [], () => token !== state.scanToken)) {
        if (token !== state.scanToken || state.job?.id !== jobId) return;
        if (!fileMatchesFormats(candidate.file, capabilities.inputFormats)) continue;
        if (discovered >= MAX_LARGE_FOLDER_FILES) {
          await persistJob({
            scanComplete: true,
            status: "needs-attention",
            error: `This folder contains more than ${MAX_LARGE_FOLDER_FILES.toLocaleString()} supported images. Choose a narrower source folder.`,
          });
          return;
        }
        buffer.push(createManifestEntry({ jobId, index: discovered, relativePath: candidate.relativePath, file: candidate.file }));
        discovered += 1;
        sourceBytes += candidate.file.size;
        if (buffer.length >= MANIFEST_WRITE_SIZE) {
          await putManifestEntries(buffer.splice(0));
          state.job = { ...state.job, discovered, sourceBytes, updatedAt: Date.now() };
          await putLargeJob(state.job);
          render();
          schedulePump();
        }
      }
      if (buffer.length) await putManifestEntries(buffer);
      if (token !== state.scanToken || state.job?.id !== jobId) return;
      const status = state.job.status === "scanning" ? "ready" : state.job.status;
      await persistJob({ discovered, sourceBytes, scanComplete: true, status, error: discovered ? null : "No supported still images were found in this folder." });
      schedulePump();
    } catch (error) {
      if (token !== state.scanToken) return;
      await persistJob({ status: "needs-attention", error: friendlyError(error) });
    }
  }

  function terminateWorkers() {
    for (const slot of state.workers) slot.worker.terminate();
    state.workers = [];
  }

  function createWorkerSlot(id) {
    const worker = new Worker(new URL("./large-worker.js", import.meta.url), { type: "module" });
    const slot = { id, worker, ready: false, current: null };
    worker.addEventListener("message", (event) => void handleWorkerMessage(slot, event.data));
    worker.addEventListener("error", () => void handleWorkerFailure(slot, "The image worker stopped unexpectedly."));
    return slot;
  }

  function ensureWorkers() {
    if (state.workers.length) return;
    const count = largeWorkerCount({
      preference: elements.performance?.value ?? "balanced",
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
    });
    state.workers = Array.from({ length: count }, (_, index) => createWorkerSlot(index));
  }

  async function finishPauseIfIdle() {
    if (state.job?.status !== "pausing" || workersActive() > 0) return false;
    await persistJob({ status: "paused" });
    return true;
  }

  async function handleWorkerFailure(slot, message) {
    const entry = slot.current;
    slot.current = null;
    slot.ready = false;
    slot.worker.terminate();
    if (entry && state.job) {
      const committed = await commitManifestEntry(state.job.id, entry.index, { status: "failed", error: message }, { failedDelta: 1 });
      state.job = committed.job;
    }
    state.workers = state.workers.filter((candidate) => candidate !== slot);
    if (state.job?.status === "running") state.workers.push(createWorkerSlot(slot.id));
    if (await finishPauseIfIdle()) return;
    render();
    schedulePump();
  }

  async function handleWorkerMessage(slot, message) {
    if (!message || message.jobId && message.jobId !== state.job?.id) return;
    if (message.type === "ready") {
      slot.ready = true;
      schedulePump();
      return;
    }
    if (message.type === "fatal") {
      await handleWorkerFailure(slot, message.message || "The image engine could not start.");
      return;
    }
    const entry = slot.current;
    if (!entry || message.index !== entry.index || !state.job) return;
    slot.current = null;
    if (message.type === "result") {
      const committed = await commitManifestEntry(state.job.id, entry.index, {
        status: "completed",
        outputPath: message.outputPath,
        outputBytes: message.outputBytes,
        width: message.width,
        height: message.height,
        format: message.format,
        error: null,
      }, { completedDelta: 1, outputBytesDelta: Number(message.outputBytes || 0) });
      state.job = committed.job;
    } else if (message.type === "error") {
      const committed = await commitManifestEntry(state.job.id, entry.index, {
        status: "failed",
        error: message.message || "This image could not be processed.",
      }, { failedDelta: 1 });
      state.job = committed.job;
    }
    if (await finishPauseIfIdle()) return;
    render();
    schedulePump();
  }

  function schedulePump(delay = 0) {
    clearTimeout(state.schedulerTimer);
    state.schedulerTimer = setTimeout(() => void pump(), delay);
  }

  async function pump() {
    if (state.pumpLocked) {
      state.pumpAgain = true;
      return;
    }
    if (!state.job || state.job.status !== "running") return;
    state.pumpLocked = true;
    try {
      ensureWorkers();
      const available = state.workers.filter((slot) => slot.ready && !slot.current);
      const entries = await claimPendingEntries(state.job.id, available.length);
      for (let index = 0; index < entries.length; index += 1) {
        const slot = available[index];
        const entry = entries[index];
        slot.current = entry;
        slot.worker.postMessage({
          type: "process",
          workerId: slot.id,
          jobId: state.job.id,
          sourceRoot: state.job.sourceHandle,
          outputRoot: state.job.outputHandle,
          recipe: state.job.recipe,
          entry,
        });
      }
      if (!entries.length && workersActive() === 0) {
        const progress = jobProgress(state.job);
        if (state.job.scanComplete && progress.finished >= progress.discovered) {
          const status = state.job.failed ? "needs-attention" : "complete";
          await persistJob({ status });
          terminateWorkers();
        } else {
          schedulePump(200);
        }
      }
    } catch (error) {
      await persistJob({ status: "needs-attention", error: friendlyError(error) });
    } finally {
      state.pumpLocked = false;
      if (state.pumpAgain) {
        state.pumpAgain = false;
        schedulePump();
      }
    }
  }

  async function continueJob({ retryFailed = false } = {}) {
    if (!state.job?.sourceHandle || !state.job?.outputHandle || !state.job?.scanComplete) return;
    try {
      if (workersActive() > 0) {
        await persistJob({ status: "pausing" });
        return;
      }
      const canRead = await ensurePermission(state.job.sourceHandle, "read");
      const canWrite = await ensurePermission(state.job.outputBaseHandle ?? state.job.outputHandle, "readwrite");
      if (!canRead || !canWrite) throw new Error("Folder permission was not granted.");
      await resetInterruptedEntries(state.job.id);
      let failed = Number(state.job.failed ?? 0);
      if (retryFailed && failed > 0) {
        const retried = await retryFailedEntries(state.job.id);
        failed = Math.max(0, failed - retried);
      }
      await persistJob({ failed, status: "running", error: null });
      ensureWorkers();
      schedulePump();
    } catch (error) {
      await persistJob({ status: "needs-attention", error: friendlyError(error) });
    }
  }

  async function startOrResume() {
    await continueJob();
  }

  async function pause() {
    if (state.job?.status !== "running") return;
    await persistJob({ status: workersActive() > 0 ? "pausing" : "paused" });
  }

  async function retryFailed() {
    if (!state.job?.failed) return;
    await continueJob({ retryFailed: true });
  }

  async function forget() {
    if (!state.job || ["running", "pausing"].includes(state.job.status)) return;
    const confirmed = window.confirm("Forget this job? Files already saved in the output folder will not be deleted.");
    if (!confirmed) return;
    state.scanToken += 1;
    terminateWorkers();
    await deleteLargeJob(state.job.id);
    state.job = null;
    render();
  }

  function scheduleRows() {
    if (!elements.viewport || !elements.layer) return;
    cancelAnimationFrame(state.rowsFrame);
    state.rowsFrame = requestAnimationFrame(() => void renderRows());
  }

  async function renderRows() {
    const job = state.job;
    const total = Number(job?.discovered ?? 0);
    const token = ++state.renderToken;
    elements.layer.style.height = `${total * DEFAULT_ROW_HEIGHT}px`;
    elements.empty.hidden = total > 0;
    if (!job || !total) {
      elements.layer.replaceChildren();
      return;
    }
    const windowed = virtualWindow({
      total,
      scrollTop: elements.viewport.scrollTop,
      viewportHeight: elements.viewport.clientHeight,
    });
    const entries = await getManifestPage(job.id, windowed.start, windowed.count);
    if (token !== state.renderToken || state.job?.id !== job.id) return;
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const row = document.createElement("article");
      row.className = "folder-result-row";
      row.dataset.state = entry.status;
      row.style.transform = `translateY(${entry.index * DEFAULT_ROW_HEIGHT}px)`;
      const marker = document.createElement("span");
      marker.className = "folder-result-marker";
      marker.setAttribute("aria-hidden", "true");
      const name = document.createElement("div");
      name.className = "folder-result-name";
      const strong = document.createElement("strong");
      strong.textContent = entry.relativePath;
      strong.title = entry.relativePath;
      const detail = document.createElement("span");
      detail.textContent = entry.status === "completed"
        ? `${entry.width} × ${entry.height} · ${formatJobBytes(entry.sourceBytes)} → ${formatJobBytes(entry.outputBytes)} · ${entry.outputPath}`
        : entry.error || `${formatJobBytes(entry.sourceBytes)} source`;
      name.append(strong, detail);
      const status = document.createElement("span");
      status.className = "folder-result-status";
      status.textContent = statusLabel(entry.status);
      row.append(marker, name, status);
      fragment.append(row);
    }
    elements.layer.replaceChildren(fragment);
  }

  async function restoreLatestJob() {
    if (!largeJobStorageAvailable()) {
      state.ready = true;
      render();
      return;
    }
    try {
      const jobs = await listLargeJobs();
      state.job = jobs[0] ?? null;
      if (state.job && !state.job.scanComplete && state.job.sourceHandle) {
        await clearManifestEntries(state.job.id);
        state.job = {
          ...state.job,
          status: "scanning",
          discovered: 0,
          completed: 0,
          failed: 0,
          sourceBytes: 0,
          outputBytes: 0,
          error: null,
          updatedAt: Date.now(),
        };
        await putLargeJob(state.job);
      } else if (["running", "pausing"].includes(state.job?.status)) {
        await resetInterruptedEntries(state.job.id);
        state.job = { ...state.job, status: "paused", error: null, updatedAt: Date.now() };
        await putLargeJob(state.job);
      }
    } catch (error) {
      setStatus(friendlyError(error), { error: true });
    } finally {
      state.ready = true;
      refreshRecipeOptions();
      render();
      if (state.job?.status === "scanning" && !state.job.scanComplete && state.job.sourceHandle) {
        state.scanToken += 1;
        void discover(state.job.id, state.scanToken);
      }
    }
  }

  elements.source?.addEventListener("click", () => void chooseSource());
  elements.output?.addEventListener("click", () => void chooseOutput());
  elements.start?.addEventListener("click", () => void startOrResume());
  elements.pause?.addEventListener("click", () => void pause());
  elements.retry?.addEventListener("click", () => void retryFailed());
  elements.forget?.addEventListener("click", () => void forget());
  elements.viewport?.addEventListener("scroll", scheduleRows, { passive: true });
  elements.recipe?.addEventListener("change", async () => {
    renderRecipeSummary();
    if (!state.job || state.job.completed || ["running", "pausing", "paused"].includes(state.job.status)) return;
    const recipe = selectedRecipe();
    state.job = { ...state.job, recipe, outputFolderName: createLargeJob({ id: state.job.id, sourceHandle: state.job.sourceHandle, sourceName: state.job.sourceName, recipe, createdAt: state.job.createdAt }).outputFolderName };
    await putLargeJob(state.job);
    render();
  });
  window.addEventListener("tinystar:capabilities", refreshRecipeOptions);
  window.addEventListener("tinystar:local-data-cleared", refreshRecipeOptions);

  void restoreLatestJob();

  return {
    activate,
    deactivate,
    chooseSource,
    openAndChooseSource: chooseSource,
    refreshRecipes: refreshRecipeOptions,
    hasJob: () => Boolean(state.job),
    isActive: () => state.active,
    job: () => state.job,
    ready: () => state.ready,
  };
}
