import { fileMatchesFormats, formatLabel, normalizeCapabilities, normalizeFormat } from "../formats.js";
import { createProcessingClient, getProcessingScheduler } from "../processing/client.js";
import { legacyRecipeOperations, legacyRecipeProblem } from "../styles/legacy.js";
import { recipeChoices, recipeKey, recipeLabel } from "../styles/selection.js";
import { openPhotoLookPanel } from "../styles/photo-look-panel.js";
import { recipeWithPhotoLook } from "../styles/photo-look.js";
import { photoLookLabel } from "../compositor/photo-look.js";
import { creatorStampText, hasCreatorStamp, openCreatorStampPanel, recipeWithCreatorStamp } from "../styles/creator-stamp.js";
import { MAX_SOURCE_BYTES } from "../processing/policy.js";
import { isAnimatedImage } from "../input.js";
import {
  DEFAULT_ROW_HEIGHT,
  MANIFEST_WRITE_SIZE,
  MAX_LARGE_FOLDER_FILES,
  createLargeJob,
  createManifestEntry,
  formatJobBytes,
  jobProgress,
  largeJobActionState,
  settingsForLargeJob,
  sourceRelativeParts,
  virtualWindow,
} from "./core.js";
import {
  clearManifestEntries,
  claimPendingEntries,
  commitManifestEntry,
  deleteLargeJob,
  getManifestPage,
  getFailedManifestPage,
  getLargeJob,
  largeJobStorageAvailable,
  listLargeJobs,
  putLargeJob,
  patchLargeJob,
  putManifestEntries,
  resetInterruptedEntries,
  releaseClaimedEntries,
  retryFailedEntries,
} from "./store.js";
import { acquireJobOwnership, jobLocksAvailable } from "./ownership.js";
import { assertFolderContract } from "./render-contract.js";
import { openFolderFailurePanel, openFolderSamplePanel } from "./sample-panel.js";
import { durationLabel, processingEstimate } from "./sample-plan.js";

const elements = {
  panel: document.querySelector("#folder-job-panel"),
  source: document.querySelector("#folder-job-source-button"),
  output: document.querySelector("#folder-job-output-button"),
  sourceName: document.querySelector("#folder-job-source-name"),
  outputName: document.querySelector("#folder-job-output-name"),
  recipe: document.querySelector("#folder-job-recipe"),
  recipeSummary: document.querySelector("#folder-job-recipe-summary"),
  photoLook: document.querySelector("#folder-job-look-button"),
  photoLookSummary: document.querySelector("#folder-job-look-summary"),
  textStamp: document.querySelector("#folder-job-text-stamp"),
  textStampSummary: document.querySelector("#folder-job-text-stamp-summary"),
  sample: document.querySelector("#folder-job-sample-button"),
  estimate: document.querySelector("#folder-job-estimate"),
  reviewFailures: document.querySelector("#folder-job-review-failures"),
  reviewSummary: document.querySelector("#folder-job-review-summary"),
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
    && jobLocksAvailable()
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
  if (/quota|space|disk/i.test(detail)) return "The destination may be out of space. Free space and retry, or start a new job in another folder.";
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
  getDefaultRecipeKey,
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
    ownership: null,
    restoring: false,
    recipeSaving: false,
    lookEditing: false,
    stampEditing: false,
    sampleEditing: false,
    sampleEstimate: null,
    runMeasure: null,
  };

  function recipes() {
    return recipeChoices(state.job?.recipe ? [state.job.recipe] : [], listRecipes?.() ?? []).map(clone);
  }

  function selectedRecipe() {
    const options = recipes();
    return options.find((recipe) => recipeKey(recipe) === elements.recipe?.value)
      ?? options.find((recipe) => recipeKey(recipe) === getDefaultRecipeKey?.())
      ?? options.find((recipe) => recipe.id === getDefaultRecipeId?.())
      ?? options[0];
  }

  function refreshRecipeOptions() {
    if (!elements.recipe) return;
    const selected = state.recipeSaving ? elements.recipe.value : state.job?.recipe ? recipeKey(state.job.recipe) : elements.recipe.value || getDefaultRecipeKey?.();
    elements.recipe.replaceChildren();
    const choices = recipes();
    for (const recipe of choices) {
      const option = document.createElement("option");
      option.value = recipeKey(recipe);
      option.dataset.recipeId = recipe.id;
      option.dataset.recipeRevision = String(recipe.style?.revision ?? "legacy");
      option.textContent = recipeLabel(recipe, choices);
      const problem = legacyRecipeProblem(recipe, normalizeCapabilities(getCapabilities?.()));
      option.disabled = Boolean(problem); if (problem) option.title = problem;
      elements.recipe.append(option);
    }
    if ([...elements.recipe.options].some((option) => option.value === selected)) elements.recipe.value = selected;
    renderRecipeSummary();
  }

  function renderRecipeSummary() {
    if (!elements.recipeSummary) return;
    const recipe = state.job?.recipe ?? selectedRecipe();
    try { elements.photoLookSummary.textContent = photoLookLabel(recipe?.operations?.photoLook); }
    catch { elements.photoLookSummary.textContent = "Unavailable saved photo look"; }
    if (!recipe) {
      elements.recipeSummary.textContent = "Choose a recipe.";
      return;
    }
    const operations = recipe.operations ?? {};
    const problem = legacyRecipeProblem(recipe, normalizeCapabilities(getCapabilities?.()));
    if (problem) { elements.recipeSummary.textContent = problem; return; }
    const dimensions = operations.resizeWidth && operations.resizeHeight
      ? `${operations.resizeWidth} × ${operations.resizeHeight}`
      : "original dimensions";
    const fit = operations.resizeMode === "crop" ? "Fill frame" : "Keep whole image";
    const textNote = operations.textLayers?.length ? " · Includes text" : "";
    const fontNote = state.job?.renderContract?.fonts?.length ? " · Text fonts kept with this job" : "";
    elements.recipeSummary.textContent = `${fit} · ${dimensions} · ${formatLabel(operations.format)}${textNote}${fontNote}`;
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
    } else if (!state.ownership) {
      setStatus("This job is open in another tab. Close that tab, then return here to continue.");
    } else if (state.recipeSaving) {
      setStatus("Saving your recipe choice…");
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
    if (state.sampleEstimate && (state.sampleEstimate.jobId !== job?.id || JSON.stringify(state.sampleEstimate.recipe) !== JSON.stringify(job?.recipe))) state.sampleEstimate = null;
    const runningEstimate = job?.status === "running" && state.runMeasure?.jobId === job.id
      ? processingEstimate({ elapsedMs: performance.now() - state.runMeasure.started, completed: progress.finished - state.runMeasure.finished, remaining: progress.remaining }) : null;
    elements.estimate.textContent = runningEstimate !== null
      ? `Estimated remaining: about ${durationLabel(runningEstimate)} · updated from this run, including saves.`
      : state.sampleEstimate && !["running", "complete", "pausing"].includes(job?.status)
        ? `Sample estimate: about ${durationLabel(state.sampleEstimate.seconds)} for the full folder. Saving and device changes can take longer.`
        : job?.scanComplete ? `${progress.discovered.toLocaleString()} planned files · one output per image. Failed files can be retried separately.` : "Output count will appear after scanning.";
    const actions = largeJobActionState(job);
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
    if (elements.output) elements.output.disabled = !supported || !job?.sourceHandle || job.completed > 0 || job.failed > 0 || ["running", "pausing", "paused"].includes(job?.status);
    if (elements.recipe) elements.recipe.disabled = Boolean(job && (job.outputHandle || job.completed || ["running", "pausing", "paused"].includes(job.status)));
    elements.photoLook.disabled = !job?.scanComplete || !state.ownership || Boolean(job.outputHandle || job.completed || job.failed || ["running", "pausing", "paused"].includes(job.status));
    if (elements.textStamp) elements.textStamp.disabled = !job?.scanComplete || !state.ownership || Boolean(job.outputHandle || job.completed || job.failed || ["running", "pausing", "paused"].includes(job.status));
    if (elements.textStampSummary) {
      let text = "";
      try { text = creatorStampText(legacyRecipeOperations(job.recipe).textLayers); } catch { /* Invalid saved recipe details are shown separately. */ }
      elements.textStampSummary.textContent = text ? `“${text}”` : "No text overlay";
    }
    elements.sample.disabled = !job?.scanComplete || !job.discovered || !state.ownership || ["running", "pausing"].includes(job.status) || state.sampleEditing;
    if (elements.performance) elements.performance.disabled = ["running", "pausing"].includes(job?.status);
    if (elements.start) {
      elements.start.hidden = actions.startHidden;
      elements.start.disabled = !supported || !job?.sourceHandle || !job?.outputHandle || !job?.scanComplete || job?.status === "complete";
      elements.start.textContent = actions.startLabel;
    }
    if (elements.pause) elements.pause.hidden = job?.status !== "running";
    if (elements.retry) {
      elements.retry.hidden = actions.retryHidden;
      elements.retry.textContent = actions.retryLabel;
    }
    if (elements.forget) elements.forget.disabled = !job || ["running", "pausing"].includes(job.status);
    if (job && !state.ownership) {
      for (const control of [elements.source, elements.output, elements.recipe, elements.start, elements.pause, elements.retry, elements.forget]) {
        if (control) control.disabled = true;
      }
    } else {
      if (elements.pause) elements.pause.disabled = false;
      if (elements.retry) elements.retry.disabled = false;
    }
    if (state.recipeSaving || state.lookEditing || state.stampEditing || state.sampleEditing) {
      for (const control of [elements.source, elements.output, elements.recipe, elements.photoLook, elements.textStamp, elements.sample, elements.start, elements.retry, elements.forget]) {
        if (control) control.disabled = true;
      }
    }
    renderRecipeSummary();
    scheduleRows();
    notifyChanged();
  }

  async function persistJob(patch = {}) {
    if (!state.job) return null;
    acceptJob(await patchLargeJob(state.job.id, patch, owner()));
    render();
    return state.job;
  }

  function owner() {
    if (!state.ownership || state.ownership.jobId !== state.job?.id) throw new Error("This job is open in another tab.");
    return state.ownership.owner;
  }

  function acceptJob(job) {
    if (job?.id === state.job?.id && Number(job.revision ?? 0) >= Number(state.job.revision ?? 0)) state.job = job;
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
    if (state.recipeSaving || state.lookEditing || state.stampEditing || state.sampleEditing) return false;
    activate();
    if (!supportsLargeFolderJobs()) return false;
    if (state.job && !state.ownership) return false;
    try {
      const recipe = selectedRecipe(), problem = legacyRecipeProblem(recipe, normalizeCapabilities(getCapabilities?.()));
      if (problem) throw new Error(problem);
      const sourceHandle = await picker().call(globalThis, { id: "tiny-image-star-source", mode: "read", startIn: "pictures" });
      const createdAt = Date.now();
      state.scanToken += 1;
      terminateWorkers();
      if (state.job) await deleteLargeJob(state.job.id, owner());
      await state.ownership?.release();
      state.ownership = null;
      state.job = createLargeJob({
        id: `folder-${createdAt}-${Math.random().toString(36).slice(2, 9)}`,
        sourceHandle,
        sourceName: sourceHandle.name,
        recipe,
        createdAt,
      });
      await putLargeJob(state.job);
      state.ownership = await acquireJobOwnership(state.job.id);
      if (!state.ownership) throw new Error("This job is open in another tab.");
      acceptJob(state.ownership.job);
      render();
      void discover(state.job.id, state.scanToken);
      return true;
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(friendlyError(error), { error: true });
      return false;
    }
  }

  async function chooseOutput() {
    if (state.recipeSaving || state.lookEditing || state.stampEditing || state.sampleEditing || !state.job || !state.ownership || !supportsLargeFolderJobs()) return;
    if (state.job.completed || state.job.failed || ["running", "pausing", "paused"].includes(state.job.status)) return;
    try {
      const outputBaseHandle = await picker().call(globalThis, { id: "tiny-image-star-output", mode: "readwrite", startIn: "pictures" });
      const outputFolderName = `${createLargeJob({ id: state.job.id, recipe: state.job.recipe, createdAt: state.job.createdAt }).outputFolderName}-${crypto.randomUUID().slice(0, 8)}`;
      const outputHandle = await outputBaseHandle.getDirectoryHandle(outputFolderName, { create: true });
      await persistJob({ outputBaseHandle, outputHandle, outputFolderName, error: null });
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
          await putManifestEntries(buffer.splice(0), owner());
          await persistJob({ discovered, sourceBytes });
          schedulePump();
        }
      }
      if (buffer.length) await putManifestEntries(buffer, owner());
      if (token !== state.scanToken || state.job?.id !== jobId) return;
      const status = state.job.status === "scanning" ? "ready" : state.job.status;
      await persistJob({ discovered, sourceBytes, scanComplete: true, status, error: discovered ? null : "No supported still images were found in this folder." });
      schedulePump();
    } catch (error) {
      if (token !== state.scanToken) return;
      await stopForStorageError(error);
    }
  }

  function terminateWorkers() {
    for (const slot of state.workers) slot.worker.terminate();
    state.workers = [];
  }

  function createWorkerSlot(id) {
    const worker = createProcessingClient({ kind: "folder", priority: 2 });
    const slot = { id, worker, ready: false, current: null };
    worker.addEventListener("message", (event) => void handleWorkerMessage(slot, event.data).catch(stopForStorageError));
    worker.addEventListener("error", () => void handleWorkerFailure(slot, "The image worker stopped unexpectedly.").catch(stopForStorageError));
    return slot;
  }

  async function stopForStorageError(error) {
    clearTimeout(state.schedulerTimer);
    terminateWorkers();
    try { await persistJob({ status: "needs-attention", error: friendlyError(error) }); }
    catch {
      // Storage itself may be full/unavailable. Preserve a usable local retry
      // state even when writing that state to IndexedDB is impossible.
      if (state.job) state.job = { ...state.job, status: "needs-attention", error: friendlyError(error) };
      render();
    }
  }

  function ensureWorkers() {
    if (state.workers.length) return;
    const pool = getProcessingScheduler();
    pool.configure({ mode: elements.performance?.value ?? "auto" });
    const count = pool.budget.cpu;
    state.workers = Array.from({ length: count }, (_, index) => createWorkerSlot(index));
  }

  async function finishPauseIfIdle() {
    if (state.pauseDrain || state.job?.status !== "pausing" || workersActive() > 0) return false;
    await persistJob({ status: "paused" });
    return true;
  }

  async function handleWorkerFailure(slot, message) {
    const entry = slot.current;
    slot.current = null;
    slot.ready = false;
    slot.worker.terminate();
    if (entry && state.job) {
      const committed = await commitManifestEntry(state.job.id, entry.index, entry.claimId, { status: "failed", error: message }, owner());
      acceptJob(committed.job);
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
    if (!entry || message.index !== entry.index || message.claimId !== entry.claimId || !state.job) return;
    slot.current = null;
    if (message.type === "result") {
      // The worker has already closed the file and committed its journal.
      acceptJob(await getLargeJob(state.job.id));
    } else if (message.type === "error") {
      const committed = await commitManifestEntry(state.job.id, entry.index, entry.claimId, {
        status: "failed",
        error: message.message || "This image could not be processed.",
      }, owner());
      acceptJob(committed.job);
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
      const claimedJobId = state.job.id;
      const claimedOwner = owner();
      const entries = await claimPendingEntries(claimedJobId, available.length, claimedOwner);
      if (state.job?.id !== claimedJobId || state.job.status !== "running") {
        await releaseClaimedEntries(claimedJobId, entries, claimedOwner);
        await finishPauseIfIdle();
        return;
      }
      for (let index = 0; index < entries.length; index += 1) {
        const slot = available[index];
        const entry = entries[index];
        slot.current = entry;
        slot.worker.submit({ message: {
          type: "process",
          workerId: slot.id,
          jobId: state.job.id,
          owner: claimedOwner,
          sourceRoot: state.job.sourceHandle,
          outputRoot: state.job.outputHandle,
          recipe: state.job.recipe,
          entry,
        }, source: { encodedBytes: entry.sourceBytes } });
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
      await stopForStorageError(error);
    } finally {
      state.pumpLocked = false;
      if (state.pumpAgain) {
        state.pumpAgain = false;
        schedulePump();
      }
    }
  }

  async function continueJob({ retryFailed = false } = {}) {
    if (state.sampleEditing || state.stampEditing) return;
    if (!state.job?.sourceHandle || !state.job?.outputHandle || !state.job?.scanComplete) return;
    if (!state.ownership) return;
    try {
      assertFolderContract(state.job);
      const problem = legacyRecipeProblem(state.job.recipe, normalizeCapabilities(getCapabilities?.()));
      if (problem) throw new Error(problem);
      if (workersActive() > 0) {
        await persistJob({ status: "pausing" });
        return;
      }
      const canRead = await ensurePermission(state.job.sourceHandle, "read");
      const canWrite = await ensurePermission(state.job.outputBaseHandle ?? state.job.outputHandle, "readwrite");
      if (!canRead || !canWrite) throw new Error("Folder permission was not granted.");
      acceptJob(await resetInterruptedEntries(state.job.id, owner()));
      if (retryFailed && state.job.failed > 0) acceptJob(await retryFailedEntries(state.job.id, owner()));
      await persistJob({ status: "running", error: null });
      state.runMeasure = { jobId: state.job.id, started: performance.now(), finished: jobProgress(state.job).finished };
      ensureWorkers();
      schedulePump();
    } catch (error) {
      await stopForStorageError(error);
    }
  }

  async function startOrResume() {
    await continueJob();
  }

  async function pause() {
    if (!state.ownership || state.job?.status !== "running") return;
    state.pauseDrain = true;
    try {
      await persistJob({ status: "pausing" });
      const released = [];
      for (const slot of state.workers) {
        if (slot.current && slot.worker.cancelIfQueued()) {
          released.push(slot.current);
          slot.current = null;
        }
      }
      await releaseClaimedEntries(state.job.id, released, owner());
    } finally { state.pauseDrain = false; }
    await finishPauseIfIdle();
  }

  async function retryFailed() {
    if (!state.job?.failed) return;
    await continueJob({ retryFailed: true });
  }

  async function forget() {
    if (!state.job || !state.ownership || ["running", "pausing"].includes(state.job.status)) return;
    const confirmed = window.confirm("Forget this job? Files already saved in the output folder will not be deleted.");
    if (!confirmed) return;
    state.scanToken += 1;
    terminateWorkers();
    await deleteLargeJob(state.job.id, owner());
    await state.ownership.release();
    state.ownership = null;
    state.job = null;
    render();
  }

  function scheduleRows() {
    if (!elements.viewport || !elements.layer) return;
    cancelAnimationFrame(state.rowsFrame);
    state.rowsFrame = requestAnimationFrame(() => void renderRows().catch((error) => setStatus(friendlyError(error), { error: true })));
  }

  async function renderRows() {
    const job = state.job;
    const failuresOnly = elements.reviewFailures.checked;
    const total = Number((failuresOnly ? job?.failed : job?.discovered) ?? 0);
    const token = ++state.renderToken;
    elements.layer.style.height = `${total * DEFAULT_ROW_HEIGHT}px`;
    elements.reviewSummary.textContent = `${total.toLocaleString()} ${failuresOnly ? "need attention" : "files"} · only visible rows are loaded`;
    elements.empty.textContent = failuresOnly ? "No files need attention." : "Files appear here as the folder is scanned.";
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
    const entries = await (failuresOnly ? getFailedManifestPage : getManifestPage)(job.id, windowed.start, windowed.count);
    if (token !== state.renderToken || state.job?.id !== job.id || failuresOnly !== elements.reviewFailures.checked) return;
    const fragment = document.createDocumentFragment();
    for (const [offset, entry] of entries.entries()) {
      const row = document.createElement("article");
      row.className = "folder-result-row";
      row.dataset.state = entry.status;
      row.dataset.index = String(entry.index);
      if (entry.status === "failed") {
        row.setAttribute("role", "button"); row.tabIndex = 0; row.setAttribute("aria-label", `Review problem with ${entry.relativePath}`);
        row.addEventListener("click", () => openFolderFailurePanel(entry, row));
        row.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openFolderFailurePanel(entry, row); } });
      }
      row.style.transform = `translateY(${(windowed.start + offset) * DEFAULT_ROW_HEIGHT}px)`;
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
      detail.title = detail.textContent;
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
    if (state.restoring || state.ownership) return;
    state.restoring = true;
    if (!largeJobStorageAvailable()) {
      state.ready = true;
      state.restoring = false;
      render();
      return;
    }
    try {
      const jobs = (await listLargeJobs()).filter(job=>job.kind!=="scene-collection");
      state.job = jobs[0] ?? null;
      if (!state.job || !jobLocksAvailable()) return;
      state.ownership = await acquireJobOwnership(state.job.id);
      if (!state.ownership) return;
      acceptJob(state.ownership.job);
      if (state.job && !state.job.scanComplete && state.job.sourceHandle) {
        await clearManifestEntries(state.job.id, owner());
        await persistJob({
          status: "scanning",
          discovered: 0,
          completed: 0,
          failed: 0,
          sourceBytes: 0,
          outputBytes: 0,
          error: null,
        });
      } else if (["running", "pausing"].includes(state.job?.status)) {
        acceptJob(await resetInterruptedEntries(state.job.id, owner()));
        await persistJob({ status: "paused", error: null });
      }
    } catch (error) {
      setStatus(friendlyError(error), { error: true });
    } finally {
      state.ready = true;
      state.restoring = false;
      refreshRecipeOptions();
      render();
      if (state.ownership && state.job?.status === "scanning" && !state.job.scanComplete && state.job.sourceHandle) {
        state.scanToken += 1;
        void discover(state.job.id, state.scanToken);
      }
    }
  }

  elements.source?.addEventListener("click", () => void chooseSource());
  elements.output?.addEventListener("click", () => void chooseOutput());
  elements.start?.addEventListener("click", () => void startOrResume());
  elements.pause?.addEventListener("click", () => void pause().catch(stopForStorageError));
  elements.retry?.addEventListener("click", () => void retryFailed());
  elements.forget?.addEventListener("click", () => void forget().catch(stopForStorageError));
  elements.viewport?.addEventListener("scroll", scheduleRows, { passive: true });
  elements.reviewFailures.addEventListener("change", () => { state.renderToken++; elements.viewport.scrollTop = 0; scheduleRows(); });
  elements.sample.addEventListener("click", () => {
    if (elements.sample.disabled || !state.job) return;
    try {
      assertFolderContract(state.job);
      state.sampleEditing = true; state.sampleEstimate = null; render();
      openFolderSamplePanel(structuredClone(state.job), { returnFocus: elements.sample,
        measured(value) { state.sampleEstimate = value; }, onClose() { state.sampleEditing = false; render(); } });
    } catch (error) { state.sampleEditing = false; render(); setStatus(friendlyError(error), { error: true }); }
  });
  elements.recipe?.addEventListener("change", async () => {
    renderRecipeSummary();
    if (state.recipeSaving || state.lookEditing || state.stampEditing || state.sampleEditing || !state.job || !state.ownership || state.job.outputHandle || state.job.completed || ["running", "pausing", "paused"].includes(state.job.status)) return;
    const selected = selectedRecipe();
    const currentOperations = legacyRecipeOperations(state.job.recipe);
    let recipe = selected.builtIn && currentOperations.photoLook
      ? recipeWithPhotoLook(selected, currentOperations.photoLook) : selected;
    if (hasCreatorStamp(currentOperations.textLayers)) recipe = recipeWithCreatorStamp(recipe, currentOperations.textLayers);
    // Choosing a destination must use the committed recipe, including when
    // another database transaction delays this update.
    state.recipeSaving = true; render();
    try { await persistJob({ recipe, outputFolderName: createLargeJob({ id: state.job.id, recipe, createdAt: state.job.createdAt }).outputFolderName }); }
    catch (error) { await stopForStorageError(error); }
    finally { state.recipeSaving = false; refreshRecipeOptions(); render(); }
  });
  elements.photoLook.addEventListener("click", () => {
    if (elements.photoLook.disabled || !state.job || state.lookEditing || state.stampEditing) return;
    const jobId = state.job.id, originalRecipe = clone(state.job.recipe);
    state.lookEditing = true; render();
    const dialog = openPhotoLookPanel({ initial: originalRecipe.operations.photoLook ?? null, scopes: [["all", "Every image in this folder"]],
      getSample: async () => {
        if (state.job?.id !== jobId) throw new Error("The folder job changed. Reopen Photo look.");
        const entries = await getManifestPage(jobId, 0, 1), entry = entries[0];
        if (!entry) throw new Error("Choose a folder containing a supported image.");
        const parts = sourceRelativeParts(entry.relativePath), name = parts.pop(); let directory = state.job.sourceHandle;
        for (const part of parts) directory = await directory.getDirectoryHandle(part);
        const file = await (await directory.getFileHandle(name)).getFile();
        if (file.size > MAX_SOURCE_BYTES) throw new Error("The sample image is too large to preview. Choose a smaller source image.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (isAnimatedImage(bytes)) throw new Error("The first image is animated and cannot be previewed. Use a supported still image.");
        return { id: String(entry.index), name: file.name, bytes, operations: settingsForLargeJob(originalRecipe) };
      },
      commit: async (look) => {
        if (state.job?.id !== jobId || state.job.outputHandle || !state.ownership || recipeKey(state.job.recipe) !== recipeKey(originalRecipe)) throw new Error("The folder job changed. Reopen Photo look before applying.");
        let recipe = recipeWithPhotoLook(originalRecipe, look);
        const originalOperations = legacyRecipeOperations(originalRecipe);
        if (hasCreatorStamp(originalOperations.textLayers)) recipe = recipeWithCreatorStamp(recipe, originalOperations.textLayers);
        state.recipeSaving = true; render();
        try { await persistJob({ recipe, outputFolderName: createLargeJob({ id: jobId, recipe, createdAt: state.job.createdAt }).outputFolderName }); }
        finally { state.recipeSaving = false; refreshRecipeOptions(); render(); }
      }, report: (message) => setStatus(message, { error: true }),
    });
    dialog.addEventListener("close", () => { state.lookEditing = false; render(); }, { once: true });
  });
  elements.textStamp?.addEventListener("click", () => {
    if (elements.textStamp.disabled || !state.job || state.stampEditing) return;
    const jobId = state.job.id, originalRecipe = clone(state.job.recipe);
    const originalOperations = legacyRecipeOperations(originalRecipe);
    state.stampEditing = true; render();
    try {
      const dialog = openCreatorStampPanel({ layers: originalOperations.textLayers, returnFocus: elements.textStamp,
        onApply: async (_choice, layers) => {
          if (state.job?.id !== jobId || state.job.outputHandle || !state.ownership || recipeKey(state.job.recipe) !== recipeKey(originalRecipe)) {
            throw new Error("The folder job changed. Reopen Text overlay before applying.");
          }
          const recipe = recipeWithCreatorStamp(originalRecipe, layers);
          state.recipeSaving = true; render();
          try { await persistJob({ recipe, outputFolderName: createLargeJob({ id: jobId, recipe, createdAt: state.job.createdAt }).outputFolderName }); }
          finally { state.recipeSaving = false; refreshRecipeOptions(); render(); }
        },
      });
      dialog.addEventListener("close", () => { state.stampEditing = false; render(); }, { once: true });
    } catch (error) { state.stampEditing = false; render(); setStatus(friendlyError(error), { error: true }); }
  });
  window.addEventListener("tinystar:capabilities", refreshRecipeOptions);
  window.addEventListener("tinystar:local-data-cleared", refreshRecipeOptions);
  window.addEventListener("focus", () => { if (state.job && !state.ownership) void restoreLatestJob(); });
  // Browsers release Web Locks on destruction. Do not release the owner on
  // visibilitychange: a background tab may still have admitted writes.
  window.addEventListener("pagehide", () => {
    state.scanToken += 1;
    terminateWorkers();
    const ownership = state.ownership;
    state.ownership = null;
    void ownership?.release();
  });
  window.addEventListener("pageshow", (event) => { if (event.persisted) void restoreLatestJob(); });

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
