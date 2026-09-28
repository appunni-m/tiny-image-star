import { diffOperationConfig, mergeOperationConfig, mergeOverridePatch } from "./config.js";
import { attachLargeFolderJobs, supportsLargeFolderJobs } from "./jobs/controller.js";
import { createProcessingClient, getProcessingScheduler } from "./processing/client.js";
import {
  DEFAULT_CAPABILITIES,
  fileMatchesFormats,
  formatAccept,
  formatLabel,
  formatListLabel,
  normalizeCapabilities,
  normalizeFormat,
} from "./formats.js";
import {
  MAX_BATCH_BYTES,
  MAX_BATCH_PIXELS,
  batchBytesExceedLimit,
  duplicateKey,
  fingerprintBytes,
  inputProblem,
} from "./input.js";
import { DESTINATION_PRESETS, PRESETS } from "./presets.js";
import { canonicalJSON } from "./project/model.js";
import { legacyRecipeOperations, legacyRecipeProblem, legacyStyleFromRecipe, originalRecipe, withLegacyStyle } from "./styles/legacy.js";
import { mutateRecipeCatalog, readRecipeCatalog } from "./styles/catalog.js";
import { catalogError, LEGACY_RECIPES_KEY, recipeCommand } from "./styles/catalog-model.js";
import { STYLE_CHANGE_EVENT } from "./styles/store.js";
import { recipeByReference, recipeChoices, recipeKey, recipeLabel, restoreRecipeReferences } from "./styles/selection.js";
import { RecipeRecoveryChoice } from "./styles/session-recovery.js";
import { openPhotoLookPanel } from "./styles/photo-look-panel.js";
import { photoLookLabel } from "./compositor/photo-look.js";
import { creatorStampLayers, openCreatorStampPanel } from "./styles/creator-stamp.js";
import { applyPhotoLookEdit, photoLookTargets, undoPhotoLookEdit } from "./styles/photo-look-edits.js";
import { framingReviewForItems } from "./framing.js";
import {
  downloadedFileName,
  exportFolderName,
} from "./names.js";
import { DEFAULT_QUALITY, QUALITY_LEVELS, normalizeQuality, qualityLabel } from "./quality.js";
import {
  applyRelativeEditPatch,
  mergeRelativeSharedEdit,
  relativeEditPatch,
  removeAppliedKeys,
} from "./scoped-edits.js";
import {
  buildSessionSnapshot,
  clearEditorSession,
  clearSession,
  readEditorSession,
  readSession,
  sessionFile,
  writeSession,
} from "./session.js";
import { openContextMenu } from "./context-menu.js?v=20260928-figma-slice-2";

const MAX_BATCH_FILES = 40;
let batchJobMetricsTimer = null;
const elements = {
  sessionRecovery: document.querySelector("#session-recovery"),
  sessionRecoveryMessage: document.querySelector("#session-recovery-message"),
  sessionRestore: document.querySelector("#session-restore-button"),
  sessionCurrentRecipes: document.querySelector("#session-current-recipes-button"),
  sessionOriginals: document.querySelector("#session-originals-button"),
  sessionBackup: document.querySelector("#session-backup-button"),
  sessionClear: document.querySelector("#session-clear-button"),
  sessionLater: document.querySelector("#session-later-button"),
  editorView: document.querySelector("#editor-view"),
  presetsView: document.querySelector("#presets-view"),
  batchView: document.querySelector("#batch-view"),
  batchHeading: document.querySelector("#batch-heading"),
  batchLede: document.querySelector("#batch-view .view-lede"),
  batchClose: document.querySelector("#batch-close-button"),
  presetsButton: document.querySelector("#presets-button"),
  batchButton: document.querySelector("#batch-button"),
  folderJobButton: document.querySelector("#folder-job-button"),
  fileName: document.querySelector("#file-name"),
  presetList: document.querySelector("#preset-list"),
  presetStart: document.querySelector("#preset-start-button"),
  closePresets: document.querySelector("#close-presets-button"),
  batchOpen: document.querySelector("#batch-open-button"),
  batchFolder: document.querySelector("#batch-folder-button"),
  batchFileInput: document.querySelector("#batch-file-input"),
  batchFolderInput: document.querySelector("#batch-folder-input"),
  batchCancel: document.querySelector("#batch-cancel-button"),
  batchJobBar: document.querySelector("#batch-job-bar"),
  batchJobTitle: document.querySelector("#batch-job-title"),
  batchJobStatus: document.querySelector("#batch-job-status"),
  batchJobProgress: document.querySelector("#batch-job-progress"),
  batchJobMetrics: document.querySelector("#batch-job-metrics"),
  batchJobSpeed: document.querySelector("#batch-job-speed"),
  batchJobPause: document.querySelector("#batch-job-pause"),
  batchClearCompleted: document.querySelector("#batch-clear-completed-button"),
  batchSave: document.querySelector("#batch-save-button"),
  batchDropZone: document.querySelector("#batch-drop-zone"),
  batchDropTitle: document.querySelector("#batch-drop-title"),
  batchDropDescription: document.querySelector("#batch-drop-description"),
  batchPresetPicker: document.querySelector("#batch-preset-picker"),
  batchPresetName: document.querySelector("#batch-preset-name"),
  batchTextStamp: document.querySelector("#batch-text-stamp"),
  batchScope: document.querySelector("#batch-scope-select"),
  batchScopeControl: document.querySelector("#batch-scope-control"),
  batchFormatControl: document.querySelector("#batch-format-control"),
  batchStatus: document.querySelector("#batch-status"),
  batchSelectAll: document.querySelector("#batch-select-all"),
  batchClear: document.querySelector("#batch-clear-button"),
  batchSelectionCount: document.querySelector("#batch-selection-count"),
  batchFormat: document.querySelector("#batch-format-select"),
  batchLossyControl: document.querySelector("#batch-lossy-control"),
  batchLossy: document.querySelector("#batch-lossy-toggle"),
  batchQualityControl: document.querySelector("#batch-quality-control"),
  batchQuality: document.querySelector("#batch-quality-select"),
  batchFormatReset: document.querySelector("#batch-format-reset"),
  batchFramingNotice: document.querySelector("#batch-framing-notice"),
  batchGrid: document.querySelector("#batch-grid"),
  imageTray: document.querySelector("#image-tray"),
  trayCount: document.querySelector("#tray-count"),
  trayPresetPicker: document.querySelector("#tray-preset-picker"),
  trayScope: document.querySelector("#tray-scope-select"),
  trayScopeControl: document.querySelector("#tray-scope-control"),
  trayTextStamp: document.querySelector("#tray-text-stamp"),
  trayApplyEdits: document.querySelector("#tray-apply-edits-button"),
  trayFormatControl: document.querySelector("#tray-format-control"),
  trayFormat: document.querySelector("#tray-format-select"),
  trayLossyControl: document.querySelector("#tray-lossy-control"),
  trayLossy: document.querySelector("#tray-lossy-toggle"),
  trayQualityControl: document.querySelector("#tray-quality-control"),
  trayQuality: document.querySelector("#tray-quality-select"),
  trayList: document.querySelector("#tray-list"),
  traySelection: document.querySelector("#tray-selection"),
  traySelectAllButton: document.querySelector("#tray-select-all-button"),
  trayAddButton: document.querySelector("#tray-add-button"),
  trayCancelButton: document.querySelector("#tray-cancel-button"),
  traySaveButton: document.querySelector("#tray-save-button"),
  presetDialog: document.querySelector("#preset-dialog"),
  presetForm: document.querySelector("#preset-form"),
  presetDialogHeading: document.querySelector("#preset-dialog-heading"),
  presetName: document.querySelector("#preset-name-input"),
  presetDestination: document.querySelector("#preset-destination-input"),
  presetWidth: document.querySelector("#preset-width-input"),
  presetHeight: document.querySelector("#preset-height-input"),
  presetResizeMode: document.querySelector("#preset-resize-mode-input"),
  presetFormat: document.querySelector("#preset-format-input"),
  presetCompression: document.querySelector("#preset-compression-options"),
  presetLossy: document.querySelector("#preset-lossy-input"),
  presetQualityControl: document.querySelector("#preset-quality-control"),
  presetQuality: document.querySelector("#preset-quality-input"),
  presetAdvancedSummary: document.querySelector("#preset-advanced-summary"),
  individualSaveDialog: document.querySelector("#individual-save-dialog"),
  individualSaveProgress: document.querySelector("#individual-save-progress"),
  individualSaveMeter: document.querySelector("#individual-save-meter"),
  individualSaveName: document.querySelector("#individual-save-name"),
  individualSaveStatus: document.querySelector("#individual-save-status"),
  individualSaveNext: document.querySelector("#individual-save-next"),
  individualSaveClose: document.querySelector("#individual-save-close"),
};

const BUILTIN_OUTPUT_RECIPES = PRESETS.map((preset) => withLegacyStyle(legacyStyleFromRecipe({ ...preset, builtIn: true }, 1, "output")));
const photoLookHistory = [];
const state = {
  capabilities: normalizeCapabilities(window.tinyImageStarCapabilities ?? DEFAULT_CAPABILITIES),
  customPresets: [],
  recipeCatalog: null,
  catalogRead: 0,
  catalogMutation: null,
  catalogBusy: false,
  failedCatalogCommand: null,
  presetMigrationMessage: "",
  activePresetId: "keep-original",
  activeRecipeKey: null,
  view: "editor",
  pendingPresetId: null,
  pendingSave: null,
  folderImportFromEditor: false,
  batchWorker: null,
  batchWorkers: [],
    batchPreviewWorkers: new Set(),
    saveInFlight: false,
    individualSave: null,
  batch: {
    projectId: `project-${crypto.randomUUID()}`,
    projectRevision: 0,
    projectCreatedAt: Date.now(),
    frozenRecipes: [],
    revision: 0,
    presetId: null,
    recipeKey: null,
    recipeScope: "all",
    sharedOverride: null,
    formatOverride: null,
    lossyOverride: null,
    qualityOverride: null,
    activeId: null,
    files: [],
    results: new Map(),
    selected: new Set(),
    selectionTouched: false,
    importToken: 0,
    importNotice: "",
    processing: false,
    job: null,
  },
  presetsOpen: false,
  folderJobActive: false,
  folderJobs: null,
  session: {
    pending: null,
    saveTimer: null,
    saveInFlight: false,
    tooLarge: false,
    suppress: false,
  },
  editorSyncTimer: null,
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function acceptRecipeCatalog(snapshot, preserveExpanded = true) {
  state.recipeCatalog = snapshot; state.customPresets = snapshot.recipes;
  // Library refreshes never rebind a previously applied revision, including
  // an older unversioned copy retained by recovery.
  renderPresetList({ preserveExpanded }); renderBatchPresetPicker(); renderWorkspaceTray(); state.folderJobs?.refreshRecipes?.();
}
async function refreshRecipeCatalog() {
  const sequence = ++state.catalogRead, snapshot = await readRecipeCatalog();
  if (sequence !== state.catalogRead || state.session.suppress) return;
  acceptRecipeCatalog(snapshot);
}
function catalogSelection(preset) {
  const catalog = state.recipeCatalog, entry = catalog?.entries.find((entry) => entry.id === preset.id);
  if (!entry || !preset.style || entry.styleKey !== `${preset.style.id}@${preset.style.revision}`) throw catalogError("This recipe changed in another tab. Reopen the current recipe or save a new copy.", "CATALOG_CONFLICT");
  return { base: { generation: catalog.generation, revision: catalog.revision }, token: entry.token };
}
function presetEditContext(preset) {
  return { kind: "preset-edit", presetId: preset.id, ...(preset.style ? { style: clone(preset.style) } : {}),
    ...(!preset.builtIn ? { catalog: catalogSelection(preset), originalRecipe: originalRecipe(preset) } : {}) };
}
function catalogFailure(error, inDialog = false) {
  if (error.name === "AbortError") return;
  state.presetMigrationMessage = error.message;
  if (inDialog) {
    let notice = elements.presetForm.querySelector("[data-preset-save-error]");
    if (!notice) { notice = document.createElement("div"); notice.dataset.presetSaveError = ""; notice.setAttribute("role", "alert"); elements.presetForm.querySelector(".dialog-actions").before(notice); }
    notice.replaceChildren(document.createTextNode(error.message));
    if (error.code === "CATALOG_CONFLICT") addButton(notice, "Save as new recipe", "button secondary", () => { void savePresetFromDialog({ asCopy: true }); });
  }
  renderPresetList({ preserveExpanded: true });
}
async function commitCatalog(command, { inDialog = false } = {}) {
  if (state.catalogBusy) return null;
  if (state.recipeCatalog?.readOnly) { catalogFailure(catalogError(state.recipeCatalog.issue), inDialog); return null; }
  const controller = new AbortController(); state.catalogMutation = controller; state.catalogBusy = true;
  const controls = inDialog ? [...elements.presetForm.querySelectorAll("input, select, #preset-save-button, [data-preset-save-error] button")].map((element) => [element, element.disabled]) : [];
  for (const [element] of controls) element.disabled = true;
  renderPresetList({ preserveExpanded: true });
  try {
    const outcome = await mutateRecipeCatalog(command, { signal: controller.signal });
    if (controller.signal.aborted) return null;
    state.catalogRead++; state.presetMigrationMessage = ""; state.failedCatalogCommand = null;
    elements.presetForm.querySelector("[data-preset-save-error]")?.remove();
    acceptRecipeCatalog(outcome.snapshot, false); return outcome;
  } catch (error) {
    if (error.name !== "AbortError") state.failedCatalogCommand = error.code === "CATALOG_CONFLICT" ? null : clone(command);
    catalogFailure(error, inDialog); await refreshRecipeCatalog(); return null;
  } finally {
    state.catalogBusy = false; if (state.catalogMutation === controller) state.catalogMutation = null;
    for (const [element, disabled] of controls) element.disabled = disabled;
    renderPresetList({ preserveExpanded: true });
  }
}

function setSessionRecoveryVisible(visible) {
  if (elements.sessionRecovery) elements.sessionRecovery.hidden = !visible;
}

function scheduleSessionSave(delay = 120) {
  if (state.session.suppress) return;
  clearTimeout(state.session.saveTimer);
  state.session.saveTimer = setTimeout(() => {
    state.session.saveTimer = null;
    void saveActiveSession();
  }, delay);
}

async function saveActiveSession() {
  if (state.session.saveInFlight) {
    scheduleSessionSave();
    return;
  }
  state.batch.projectRevision += 1;
  const active = presetById(state.activePresetId, state.activeRecipeKey), shared = batchPreset();
  const usedRecipes = recipeChoices([active, shared, ...state.batch.files.map((item) => recipeForItem(item))]);
  const built = buildSessionSnapshot({ batch: state.batch, activePresetId: state.activePresetId,
    recipes: usedRecipes, recipeReferences: { version: 1, active: recipeKey(active), shared: recipeKey(shared),
      items: Object.fromEntries(state.batch.files.map((item) => [item.id, item.presetOverride ? recipeKey(recipeForItem(item)) : null])) },
    operationsForItem: effectiveOperationsForItem });
  if (built.reason === "empty") {
    state.session.tooLarge = false;
    await clearSession();
    return;
  }
  if (built.reason === "too-large") {
    state.session.tooLarge = true;
    return;
  }
  state.session.tooLarge = false;
  state.session.saveInFlight = true;
  try {
    await writeSession(built.snapshot);
  } finally {
    state.session.saveInFlight = false;
  }
}

async function offerSessionRecovery() {
  if (state.batch.files.length) return;
  const record = await readSession() ?? await readEditorSession();
  if (!record || (!record.batch?.files?.length && !record.editor?.bytes)) return;
  state.session.pending = record;
  if (elements.sessionRestore) { elements.sessionRestore.disabled = false; elements.sessionRestore.hidden = false; }
  if (elements.sessionRecoveryMessage) {
    if (record.kind === "editor") {
      elements.sessionRecoveryMessage.textContent = `Restore ${record.editor.name} from your last edit? Your file stays on this device.`;
    } else {
      const count = record.batch.files.length;
      elements.sessionRecoveryMessage.textContent = `Restore ${count} image${count === 1 ? "" : "s"} from your last session? Your files stay on this device.`;
    }
  }
  setSessionRecoveryVisible(true);
}

function forgetPendingSession() {
  state.session.pending = null;
  for (const button of [elements.sessionCurrentRecipes, elements.sessionOriginals, elements.sessionBackup]) button.hidden = true;
  setSessionRecoveryVisible(false);
}

async function restoreSession(options) {
  let record = state.session.pending;
  if (record?.kind === "editor") {
    const file = sessionFile(record.editor);
    if (!file) {
      forgetPendingSession();
      await clearEditorSession();
      elements.batchStatus.textContent = "The saved image could not be restored. Choose the image again.";
      return;
    }
    forgetPendingSession();
    showView("editor");
    await window.tinyImageStarEditor?.loadFile(file, record.editor.operations, null, record.project);
    return;
  }
  if (!record?.batch?.files?.length) return;
  try { record = restoreRecipeReferences(record, libraryPresets(), options); }
  catch (error) {
    elements.sessionRecoveryMessage.textContent = error.message;
    const choice = error instanceof RecipeRecoveryChoice;
    elements.sessionRestore.hidden = choice;
    elements.sessionCurrentRecipes.hidden = !choice;
    elements.sessionCurrentRecipes.disabled = !error.currentAvailable;
    elements.sessionCurrentRecipes.title = error.currentAvailable ? "The result may differ from the original edits." : "At least one original recipe is no longer in your library.";
    elements.sessionOriginals.hidden = !choice;
    elements.sessionBackup.hidden = false;
    elements.sessionRestore.disabled = true; return;
  }
  forgetPendingSession();
  state.session.suppress = true;
  clearBatchFiles({ skipSession: true });
  state.session.suppress = false;
  state.batch.projectId = record.project?.id ?? `project-${crypto.randomUUID()}`;
  state.batch.projectRevision = record.project?.revision ?? 0;
  state.batch.projectCreatedAt = record.project?.createdAt ?? Date.now();
  state.batch.revision = Math.max(state.batch.revision, Number(record.project?.revision) || 0);
  state.batch.frozenRecipes = clone(record.frozenRecipes ?? []);
  const restored = [];
  for (const saved of record.batch.files) {
    const file = sessionFile(saved);
    if (!file) continue;
    restored.push({
      id: saved.id,
      file,
      name: saved.name,
      sourceUrl: URL.createObjectURL(file),
      bytes: new Uint8Array(saved.bytes),
      fingerprint: saved.fingerprint ?? null,
      duplicateKey: saved.duplicateKey ?? null,
      presetOverride: saved.presetOverride ?? null,
      recipeKeyOverride: record.recipeReferences.items[saved.id],
      image: null,
      width: 0,
      height: 0,
      status: "reading",
      override: clone(saved.override),
      retryable: false,
    });
  }
  if (!restored.length) {
    await clearSession();
    elements.batchStatus.textContent = "The saved session could not be restored. Choose the images again.";
    return;
  }
  state.activePresetId = record.activePresetId;
  state.activeRecipeKey = record.recipeReferences.active;
  state.batch.presetId = record.batch.presetId;
  state.batch.recipeKey = record.recipeReferences.shared;
  state.batch.recipeScope = ["all", "selected", "this"].includes(record.batch.recipeScope)
    ? record.batch.recipeScope
    : "all";
  state.batch.sharedOverride = clone(record.batch.sharedOverride);
  state.batch.formatOverride = record.batch.formatOverride ?? null;
  state.batch.lossyOverride = typeof record.batch.lossyOverride === "boolean"
    ? record.batch.lossyOverride
    : null;
  state.batch.qualityOverride = record.batch.qualityOverride != null && Number.isFinite(Number(record.batch.qualityOverride))
    ? normalizeQuality(record.batch.qualityOverride)
    : null;
  state.batch.activeId = restored.some((item) => item.id === record.batch.activeId) ? record.batch.activeId : restored[0].id;
  state.batch.selected = new Set(record.batch.selected.filter((id) => restored.some((item) => item.id === id)));
  state.batch.selectionTouched = Boolean(record.batch.selectionTouched);
  state.batch.files = restored;
  state.batch.results.clear();
  state.batch.importNotice = (options?.missingRecipe === "current" ? "Restored using current recipes where original settings were missing; the older appearance may differ."
    : options?.missingRecipe === "originals" ? "Restored originals and saved corrections. Missing recipe settings could not be recovered."
    : "Restored from your last session.") + (record.frozenRecipes.some((recipe) => recipe.recovery)
      ? " Complete saved edits were recovered for their original images. Choose a new recipe to replace them while keeping manual corrections." : "");
  state.batch.importToken += 1;
  state.batch.revision += 1;
  // Restored items start without decoded dimensions. Keep the calm editor
  // surface visible until preparation has established each source size;
  // opening the active item earlier would turn a no-resize recipe into 1 × 1.
  showView("editor");
  renderBatchPresetPicker();
  renderBatchGrid();
  const importToken = state.batch.importToken;
  for (const item of restored) {
    if (importToken !== state.batch.importToken || !state.batch.files.some((entry) => entry.id === item.id)) return;
    await prepareBatchItem(item, importToken);
  }
  await runBatch(restored);
  openActiveBatchItemIfNeeded();
  showView("batch");
  scheduleSessionSave(0);
}

function libraryPresets() {
  return [...state.customPresets, ...BUILTIN_OUTPUT_RECIPES];
}
function allPresets() {
  return recipeChoices(state.batch.frozenRecipes, libraryPresets());
}

function presetById(id, key = null) {
  return recipeByReference(allPresets(), id ?? "keep-original", key);
}
function presetByChoice(value) {
  const preset = allPresets().find((entry) => recipeKey(entry) === value);
  if (!preset) throw new Error("That recipe revision is no longer available.");
  return preset;
}
function pinRecipe(preset) {
  state.batch.frozenRecipes = recipeChoices(state.batch.frozenRecipes, [clone(preset)]);
  return recipeKey(preset);
}
function retainAppliedRecipes() {
  state.batch.frozenRecipes = recipeChoices([presetById(state.activePresetId, state.activeRecipeKey), batchPreset(),
    ...state.batch.files.map((item) => recipeForItem(item))]).map(clone);
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function formatSizeChange(originalBytes, outputBytes) {
  if (!Number.isFinite(originalBytes) || !Number.isFinite(outputBytes)) return "size unavailable";
  const change = outputBytes - originalBytes;
  if (change === 0) return "same size";
  return `${change < 0 ? "smaller" : "larger"} by ${formatBytes(Math.abs(change))}`;
}

function normalizePresetOperations(operations, width, height) {
  const next = clone(operations) ?? {};
  if (next.cropRelative) {
    next.crop = {
      x: next.cropRelative.x * width,
      y: next.cropRelative.y * height,
      width: next.cropRelative.width * width,
      height: next.cropRelative.height * height,
    };
  } else {
    next.crop = null;
  }
  delete next.cropRelative;
  next.resizeWidth = next.resizeWidth || width;
  next.resizeHeight = next.resizeHeight || height;
  next.maxWidth = next.resizeWidth;
  next.maxHeight = next.resizeHeight;
  next.lossy = Boolean(next.lossy);
  next.quality = normalizeQuality(next.quality);
  next.format = normalizeFormat(next.format) ?? next.format ?? "png";
  next.textLayers = Array.isArray(next.textLayers) ? next.textLayers : [];
  return next;
}

function relativePresetOperations(operations, width, height) {
  const next = clone(operations) ?? {};
  if (next.crop) {
    next.cropRelative = {
      x: next.crop.x / width,
      y: next.crop.y / height,
      width: next.crop.width / width,
      height: next.crop.height / height,
    };
  } else {
    next.cropRelative = null;
  }
  delete next.crop;
  next.lossy = Boolean(next.lossy);
  next.quality = normalizeQuality(next.quality);
  next.format = state.capabilities.outputFormats.includes(normalizeFormat(next.format))
    ? normalizeFormat(next.format)
    : state.capabilities.outputFormats[0] ?? "png";
  next.textLayers = Array.isArray(next.textLayers) ? next.textLayers : [];
  return next;
}

function settingsForItem(preset, item) {
  if (preset.recovery && preset.recovery.fileId !== item.id) throw new Error("Recovered edits belong to a different image.");
  // An old complete image state has an absolute crop. Reusable presets use
  // relative crops; sending recovered state through that conversion loses it.
  const operations = preset.recovery ? legacyRecipeOperations(preset) : normalizePresetOperations(legacyRecipeOperations(preset), item.width || 1, item.height || 1);
  if (!operations.resizeWidth) operations.resizeWidth = item.width;
  if (!operations.resizeHeight) operations.resizeHeight = item.height;
  operations.maxWidth = operations.resizeWidth;
  operations.maxHeight = operations.resizeHeight;
  operations.presetId = preset.id;
  operations.presetName = preset.name;
  return operations;
}

function batchPreset() {
  return presetById(state.batch.presetId ?? state.activePresetId, state.batch.presetId ? state.batch.recipeKey : state.activeRecipeKey);
}

function recipeForItem(item, fallback = batchPreset()) {
  const scopedId = item?.presetOverride;
  if (!scopedId) return fallback;
  return presetById(scopedId, item.recipeKeyOverride);
}

function batchOutputFormat(preset = batchPreset()) {
  return state.batch.formatOverride ?? normalizeFormat(preset.operations.format) ?? preset.operations.format ?? "png";
}

function baseOperationsForItem(item, preset = null) {
  const recipe = preset ?? recipeForItem(item);
  const operations = settingsForItem(recipe, item);
  operations.format = batchOutputFormat(recipe);
  if (state.batch.lossyOverride !== null && state.capabilities.compression.lossyFormats.includes(operations.format)) {
    operations.lossy = state.batch.lossyOverride;
  } else if (!state.capabilities.compression.lossyFormats.includes(operations.format)) {
    operations.lossy = false;
  }
  if (state.batch.qualityOverride !== null && state.capabilities.compression.quality) {
    operations.quality = normalizeQuality(state.batch.qualityOverride);
  }
  return operations;
}

function sharedOperationsForItem(item, preset = null) {
  const base = baseOperationsForItem(item, preset);
  return applyRelativeEditPatch(base, state.batch.sharedOverride, item.width || 1, item.height || 1);
}

// item.override is a patch, not a second complete recipe. Keeping the patch
// separate from the shared recipe is what lets a later batch change retain a
// manual correction such as a crop, rotation, or output format.
function effectiveOperationsForItem(item, preset = null) {
  const recipe = preset ?? recipeForItem(item);
  return mergeOperationConfig(sharedOperationsForItem(item, recipe), item.override);
}

function batchFramingReview() {
  return framingReviewForItems(state.batch.files, (item) => effectiveOperationsForItem(item));
}

function renderPhotoLookControls() {
  const looks = recipeScopeTargets().map((item) => effectiveOperationsForItem(item).photoLook ?? null);
  const same = looks.every((look) => canonicalJSON(look) === canonicalJSON(looks[0]));
  document.querySelector("#photo-look-summary").textContent = same ? photoLookLabel(looks[0]) : "Different photo looks";
  for (const id of ["photo-look-open", "batch-photo-look"]) document.getElementById(id).disabled = !state.batch.files.length;
  if (elements.batchTextStamp) elements.batchTextStamp.disabled = !state.batch.files.length;
  if (elements.trayTextStamp) elements.trayTextStamp.disabled = !state.batch.files.length;
  for (const id of ["photo-look-undo", "batch-photo-look-undo"]) document.getElementById(id).hidden = !photoLookHistory.length;
}

function choosePhotoLook() {
  captureCurrentBatchEditorOverride();
  const openingProject = state.batch.projectId;
  const scope = state.batch.files.length > 1 ? normalizedRecipeScope(state.batch.recipeScope) : "all";
  const initial = photoLookTargets(state.batch, scope)[0];
  openPhotoLookPanel({ initial: initial ? effectiveOperationsForItem(initial).photoLook ?? null : null, scope,
    scopes: state.batch.files.length > 1 ? [["all", "All images"], ["selected", "Selected images"], ["this", "This image"]] : [["all", "This image"]],
    getSample: (chosenScope) => {
      const targets = photoLookTargets(state.batch, chosenScope), item = targets.find((entry) => entry.id === state.batch.activeId) ?? targets[0];
      if (!item?.bytes || !item.width || !item.height) throw new Error("Choose a ready image to preview this photo look.");
      return { id: item.id, name: item.name, bytes: item.bytes, width: item.width, height: item.height, operations: effectiveOperationsForItem(item) };
    },
    commit: (look, chosenScope) => {
      if (state.batch.projectId !== openingProject) throw new Error("This image set changed. Reopen Photo look for the current set.");
      captureCurrentBatchEditorOverride();
      const change = applyPhotoLookEdit(state.batch, look, chosenScope); photoLookHistory.push(change); if (photoLookHistory.length > 20) photoLookHistory.shift();
      state.batch.recipeScope = chosenScope;
      renderBatchPresetPicker(); renderBatchGrid(); refreshActiveBatchEditor();
      void runBatch(state.batch.files.filter((item) => change.ids.includes(item.id))); scheduleSessionSave(0);
    }, report: (message) => { elements.batchStatus.textContent = message; },
  });
}

function chooseCreatorStamp() {
  if (!state.batch.files.length) return;
  captureCurrentBatchEditorOverride();
  const scope = state.batch.files.length < 2 ? "this" : normalizedRecipeScope(state.batch.recipeScope);
  const targets = scope === "all" ? [...state.batch.files] : recipeScopeTargets();
  if (!targets.length) { elements.batchStatus.textContent = "Select at least one image first."; return; }
  const current = targets.find(item => item.id === state.batch.activeId) ?? targets[0];
  openCreatorStampPanel({ layers: effectiveOperationsForItem(current).textLayers, returnFocus: elements.batchTextStamp,
    onApply: async choice => {
      const liveTargets = targets.map(target => state.batch.files.find(item => item.id === target.id)).filter(Boolean);
      if (!liveTargets.length) throw new Error("Those images are no longer in this batch.");
      for (const target of liveTargets) {
        const shared = sharedOperationsForItem(target), currentOperations = effectiveOperationsForItem(target);
        target.override = diffOperationConfig(shared, { ...currentOperations,
          textLayers: creatorStampLayers(currentOperations.textLayers, choice) });
      }
      state.batch.activeId = current.id;
      renderBatchGrid(); refreshActiveBatchEditor(); renderWorkspaceTray();
      void runBatch(liveTargets); scheduleSessionSave(0);
      const label = scope === "all" ? "all images" : scope === "selected" ? `${liveTargets.length} selected images` : "this image";
      elements.batchStatus.textContent = choice.text.trim() ? `Text overlay applied to ${label}.` : `Text overlay removed from ${label}.`;
    },
    onSavePreset: (_choice, layers) => {
      const target = state.batch.files.find(item => item.id === current.id);
      if (!target) { elements.batchStatus.textContent = "The image set changed, so the recipe could not be saved."; return; }
      try {
        const operations = { ...effectiveOperationsForItem(target), textLayers: layers };
        openPresetDialog(operations, target.width || 1, target.height || 1, "My text overlay recipe");
      } catch (error) { elements.batchStatus.textContent = error.message; }
    },
  });
}

function undoPhotoLook() {
  const change = photoLookHistory.at(-1); if (!change) return;
  captureCurrentBatchEditorOverride();
  try {
    undoPhotoLookEdit(state.batch, change); photoLookHistory.pop();
    renderBatchPresetPicker(); renderBatchGrid(); refreshActiveBatchEditor(); void runBatch(); scheduleSessionSave(0);
  } catch (error) { photoLookHistory.length = 0; renderPhotoLookControls(); elements.batchStatus.textContent = error.message; }
}

function normalizedRecipeScope(scope) {
  return ["all", "selected", "this"].includes(scope) ? scope : "all";
}

function recipeScopeTargets() {
  if (state.batch.files.length < 2 || state.batch.recipeScope === "all") return [...state.batch.files];
  if (state.batch.recipeScope === "selected") {
    return state.batch.files.filter((item) => state.batch.selected.has(item.id));
  }
  const active = state.batch.files.find((item) => item.id === state.batch.activeId);
  return active ? [active] : state.batch.files.filter((item) => state.batch.selected.has(item.id)).slice(0, 1);
}

function renderRecipeScopeControls() {
  const hasMultiple = state.batch.files.length > 1;
  const scope = normalizedRecipeScope(state.batch.recipeScope);
  state.batch.recipeScope = scope;
  for (const [control, select] of [
    [elements.batchScopeControl, elements.batchScope],
    [elements.trayScopeControl, elements.trayScope],
  ]) {
    if (control) control.hidden = !hasMultiple;
    if (select) select.value = scope;
  }
  renderApplyCurrentEdits();
}

function setRecipeScope(scope) {
  state.batch.recipeScope = normalizedRecipeScope(scope);
  renderBatchPresetPicker();
  renderWorkspaceTray();
  renderBatchGrid();
  scheduleSessionSave(0);
}

function currentCanvasEdit() {
  const snapshot = window.tinyImageStarEditor?.getSnapshot?.();
  const context = snapshot?.context;
  if (!snapshot?.operations || context?.kind !== "batch") return null;
  const item = state.batch.files.find((candidate) => candidate.id === context.fileId);
  if (!item) return null;
  const initial = context.effectiveOperations ?? mergeOperationConfig(context.sharedOperations, context.overridePatch);
  const relativePatch = relativeEditPatch(initial, snapshot.operations, snapshot.imageWidth || item.width || 1, snapshot.imageHeight || item.height || 1);
  return { snapshot, context, item, initial, relativePatch };
}

function renderApplyCurrentEdits() {
  if (!elements.trayApplyEdits) return;
  const hasMultiple = state.batch.files.length > 1;
  const edit = currentCanvasEdit();
  const scope = normalizedRecipeScope(state.batch.recipeScope);
  elements.trayApplyEdits.hidden = !hasMultiple;
  elements.trayApplyEdits.disabled = !hasMultiple || !edit?.relativePatch || (scope === "selected" && !recipeScopeTargets().length);
  elements.trayApplyEdits.textContent = scope === "all"
    ? "Apply current edits to all images"
    : scope === "selected"
      ? "Apply current edits to selected images"
      : "Keep edits on this image";
}

function selectedPresetFromOperations(operations, context) {
  const id = operations?.presetId;
  if (context?.style?.id === id) return withLegacyStyle(context.style);
  if (context?.presetId === id && context.recipeKey) return presetById(id, context.recipeKey);
  return id ? allPresets().find((preset) => preset.id === id) ?? null : null;
}

function applyCurrentEditsToScope() {
  const edit = currentCanvasEdit();
  if (!edit?.relativePatch) {
    elements.batchStatus.textContent = "Make a change on the canvas first.";
    renderApplyCurrentEdits();
    return;
  }
  const { snapshot, context, item, initial, relativePatch } = edit;
  const scope = state.batch.files.length < 2 ? "this" : normalizedRecipeScope(state.batch.recipeScope);
  const selected = selectedPresetFromOperations(snapshot.operations, context);
  const selectedPreset = selected?.recovery ? null : selected;
  const selectedKey = selectedPreset ? pinRecipe(selectedPreset) : null;
  let targets = scope === "all" ? [...state.batch.files] : scope === "selected" ? recipeScopeTargets() : [item];
  if (!targets.length) {
    elements.batchStatus.textContent = "Select at least one image first.";
    return;
  }

  if (scope === "all") {
    if (selectedPreset) {
      state.batch.presetId = selectedPreset.id;
      state.activePresetId = selectedPreset.id;
      state.activeRecipeKey = state.batch.recipeKey = selectedKey;
      for (const target of state.batch.files) { target.presetOverride = null; target.recipeKeyOverride = null; }
    }
    if (state.capabilities.outputFormats.includes(snapshot.operations.format)) {
      state.batch.formatOverride = snapshot.operations.format;
    }
    const canCompress = state.capabilities.compression.lossyFormats.includes(snapshot.operations.format);
    state.batch.lossyOverride = canCompress ? Boolean(snapshot.operations.lossy) : null;
    state.batch.qualityOverride = state.capabilities.compression.quality
      ? normalizeQuality(snapshot.operations.quality)
      : null;
    const base = baseOperationsForItem(item, selectedPreset ?? batchPreset());
    state.batch.sharedOverride = mergeRelativeSharedEdit({
      baseOperations: base,
      currentRelativePatch: state.batch.sharedOverride,
      initialOperations: initial,
      editedOperations: snapshot.operations,
      width: snapshot.imageWidth || item.width || 1,
      height: snapshot.imageHeight || item.height || 1,
    });
    if (state.batch.sharedOverride) {
      for (const key of ["format", "lossy", "quality"]) delete state.batch.sharedOverride[key];
      if (!Object.keys(state.batch.sharedOverride).length) state.batch.sharedOverride = null;
    }
    item.override = removeAppliedKeys(item.override, relativePatch);
  } else if (scope === "selected") {
    for (const target of targets) {
      if (selectedPreset) {
        target.presetOverride = selectedKey === recipeKey(batchPreset()) ? null : selectedPreset.id;
        target.recipeKeyOverride = target.presetOverride ? selectedKey : null;
      }
      const targetCurrent = effectiveOperationsForItem(target);
      const targetEdited = applyRelativeEditPatch(targetCurrent, relativePatch, target.width || 1, target.height || 1);
      target.override = diffOperationConfig(sharedOperationsForItem(target), targetEdited);
    }
  } else {
    captureCurrentBatchEditorOverride();
  }

  state.batch.activeId = item.id;
  retainAppliedRecipes();
  renderBatchPresetPicker();
  renderWorkspaceTray();
  renderBatchGrid();
  refreshActiveBatchEditor();
  void runBatch(targets);
  const scopeLabel = scope === "all" ? "all images" : scope === "selected" ? `${targets.length} selected image${targets.length === 1 ? "" : "s"}` : "this image";
  elements.batchStatus.textContent = `Applied the current canvas changes to ${scopeLabel}.`;
  scheduleSessionSave(0);
}

function applyPresetToScope(presetId) {
  captureCurrentBatchEditorOverride();
  const preset = presetByChoice(presetId);
  if (preset.recovery) { elements.batchStatus.textContent = "These recovered edits belong to their original image. Save a reusable recipe to apply them elsewhere."; return; }
  const problem = legacyRecipeProblem(preset, state.capabilities);
  if (problem) { elements.batchStatus.textContent = problem; return; }
  const key = pinRecipe(preset);
  const scope = state.batch.files.length < 2 ? "all" : normalizedRecipeScope(state.batch.recipeScope);
  const targets = scope === "all" ? [...state.batch.files] : recipeScopeTargets();
  if (scope !== "all" && !targets.length) {
    elements.batchStatus.textContent = scope === "selected"
      ? "Select an image before choosing a recipe for selected images."
      : "Open an image before choosing a recipe for this image.";
    return;
  }
  state.activePresetId = scope === "all" ? preset.id : state.activePresetId;
  if (scope === "all") state.activeRecipeKey = key;
  if (scope === "all") {
    const photoLook = state.batch.sharedOverride && Object.hasOwn(state.batch.sharedOverride, "photoLook")
      ? state.batch.sharedOverride.photoLook : batchPreset().operations.photoLook;
    state.batch.presetId = preset.id;
    state.batch.recipeKey = key;
    // A destination recipe owns its complete output contract. If the user
    // chooses a new recipe, discard an older explicit batch format/compression
    // override so the recipe's final format is actually applied. They can
    // still choose a different format afterward through the visible output
    // controls.
    state.batch.formatOverride = null;
    state.batch.lossyOverride = null;
    state.batch.qualityOverride = null;
    state.batch.sharedOverride = preset.builtIn && photoLook !== undefined ? { photoLook: clone(photoLook) } : null;
    // Applying to all intentionally removes only scoped recipe choices. Manual
    // canvas corrections remain in `override` and continue to merge on top.
    for (const item of state.batch.files) { item.presetOverride = null; item.recipeKeyOverride = null; }
  } else {
    for (const item of targets) {
      item.presetOverride = key === recipeKey(batchPreset()) ? null : preset.id;
      item.recipeKeyOverride = item.presetOverride ? key : null;
    }
  }
  retainAppliedRecipes();
  renderBatchPresetPicker();
  renderBatchGrid();
  if (targets.some((item) => item.id === state.batch.activeId)) refreshActiveBatchEditor();
  if (targets.length) void runBatch(targets, `Applying ${preset.name} in place`);
  scheduleSessionSave(0);
}

function scopedRecipeSelection() {
  if (state.batch.files.length === 1) return recipeKey(recipeForItem(state.batch.files[0]));
  if (state.batch.files.length === 0 || state.batch.recipeScope === "all") return recipeKey(batchPreset());
  const ids = [...new Set(recipeScopeTargets().map((item) => recipeKey(recipeForItem(item))))];
  return ids.length === 1 ? ids[0] : null;
}

function isSupportedInput(file) {
  return fileMatchesFormats(file, state.capabilities.inputFormats);
}

function unsupportedInputMessage() {
  return `Use ${formatListLabel(state.capabilities.inputFormats)} images here.`;
}

function closePresets() {
  state.presetsOpen = false;
  elements.presetsView.hidden = true;
  elements.presetsButton.setAttribute("aria-expanded", "false");
}

function openPresets() {
  state.presetsOpen = true;
  elements.presetsView.hidden = false;
  elements.presetsButton.setAttribute("aria-expanded", "true");
  renderPresetList();
}

function syncReviewOffset() {
  if (!elements.batchView || elements.batchView.dataset.review !== "true") return;
  const topbar = document.querySelector(".topbar");
  const bottom = topbar?.getBoundingClientRect().bottom ?? 0;
  elements.batchView.style.setProperty("--review-top", `${Math.max(0, Math.ceil(bottom))}px`);
}

function renderWorkspaceNavigation(snapshot = window.tinyImageStarEditor?.getSnapshot?.()) {
  const hasActiveSetItem = state.batch.files.length > 0;
  const imageCount = state.batch.files.length;
  const countLabel = `${imageCount} image${imageCount === 1 ? "" : "s"}`;
  if (elements.batchButton) {
    elements.batchButton.hidden = !hasActiveSetItem;
    elements.batchButton.textContent = `Results (${imageCount})`;
    elements.batchButton.setAttribute("aria-label", `View results for ${countLabel}`);
    elements.batchButton.title = `View ${countLabel}`;
    elements.batchButton.dataset.workspaceAction = "results";
  }
  if (elements.folderJobButton) {
    const folderJob = state.folderJobs?.job?.();
    elements.folderJobButton.hidden = !folderJob;
    elements.folderJobButton.textContent = folderJob?.status === "running" ? "Folder running" : "Folder progress";
    elements.folderJobButton.setAttribute("aria-label", folderJob ? `View folder job for ${folderJob.sourceName}` : "View folder job");
  }
}

function showView(view) {
  if (view === "presets") {
    // The review drawer sits above the preset drawer. Return to the canvas
    // surface first so Presets is always reachable without stacking two
    // modal-looking collection surfaces on top of each other. The active
    // image set remains in memory and the tray stays available underneath.
    if (elements.batchView?.dataset.review === "true") showView("editor");
    openPresets();
    return;
  }
  closePresets();
  if (view === "batch" && state.batch.files.length === 0 && !state.folderJobActive) {
    // An empty collection belongs to the same calm editor start screen. The
    // visible Add images action opens the native chooser; the detailed review
    // surface remains available only once there is a collection to review.
    showView("editor");
    return;
  }
  state.view = view;
  const snapshot = window.tinyImageStarEditor?.getSnapshot?.();
  if (view === "batch" && state.batch.files.length > 0 && !snapshot?.file && !state.folderJobActive) {
    // An active collection should not turn into a separate mode just because
    // its canvas item has not been restored yet. Open the current item first,
    // then re-enter Review so the tray, canvas, and result drawer stay one
    // workspace. An empty collection stays on the editor start and enters
    // through the shared Add images chooser instead.
    if (openActiveBatchItemIfNeeded()) {
      showView("batch");
      return;
    }
  }
  const largeMode = view === "batch" && state.folderJobActive;
  const reviewMode = view === "batch" && !largeMode && state.batch.files.length > 0 && Boolean(snapshot?.file);
  renderWorkspaceNavigation(snapshot);
  const editorSurfaceVisible = view === "editor" || reviewMode;
  const editorChromeVisible = editorSurfaceVisible;
  const editorOnly = ["#save-preset-button", "#save-button", "#open-button"];
  for (const selector of editorOnly) {
    const control = document.querySelector(selector);
    if (control) control.hidden = !editorChromeVisible;
  }
  for (const [button, active] of [[elements.presetsButton, view === "presets"], [elements.batchButton, reviewMode], [elements.folderJobButton, largeMode]]) {
    if (!button) continue;
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const openButton = document.querySelector("#open-button");
  if (openButton) openButton.hidden = !editorChromeVisible || !snapshot?.file;
  const savePresetButton = document.querySelector("#save-preset-button");
  if (savePresetButton) savePresetButton.hidden = !editorChromeVisible || !snapshot?.file;
  const saveButton = document.querySelector("#save-button");
  if (saveButton) saveButton.hidden = !editorChromeVisible || !snapshot?.file;
  const historyActions = document.querySelector("#history-actions");
  if (historyActions) historyActions.hidden = !editorChromeVisible || !snapshot?.file;
  if (elements.batchClose) elements.batchClose.hidden = !(reviewMode || largeMode);
  if (elements.batchHeading) elements.batchHeading.textContent = largeMode ? "Process a folder" : reviewMode ? "Results" : "Edit one image or many.";
  if (elements.batchLede) elements.batchLede.textContent = largeMode
    ? "Apply one recipe and save every completed image directly into a new local folder."
    : reviewMode
    ? "Compare results, adjust one image, or download the selected files."
    : "Use the same visual recipe for one image or a whole set. Each result stays on this device until you download it.";
  elements.fileName.textContent = largeMode
    ? state.folderJobs?.job?.()?.sourceName ?? "Large folder"
    : view === "editor" || reviewMode
    ? snapshot?.file?.name ?? "Open an image to begin"
    : view === "presets" ? "Presets" : "Images";
  elements.editorView.hidden = !editorSurfaceVisible;
  elements.batchView.hidden = view !== "batch";
  elements.batchView.dataset.review = String(reviewMode);
  elements.batchView.dataset.largeJob = String(largeMode);
  if (reviewMode) syncReviewOffset();
  else elements.batchView.style.removeProperty("--review-top");
  if (view === "batch" && !largeMode) {
    renderBatchPresetPicker();
    renderBatchGrid();
  }
}

function addButton(parent, label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  parent.append(button);
  return button;
}

function usePreset(preset) {
  const problem = legacyRecipeProblem(preset, state.capabilities);
  if (problem) { state.presetMigrationMessage = problem; renderPresetList(); return; }
  closePresets();
  state.batch.recipeScope = "all";
  showView("batch");
  applyPresetToScope(recipeKey(preset));
}

function renderPresetList({ preserveExpanded = false } = {}) {
  const expanded = new Set(preserveExpanded ? [...elements.presetList.querySelectorAll(".preset-card details[open]")].map((details) => `${details.closest(".preset-card").dataset.presetId}:${details.className}`) : []);
  elements.presetList.replaceChildren();
  const messages = [...new Set([state.recipeCatalog?.issue, state.presetMigrationMessage].filter(Boolean))];
  if (messages.length) {
    const notice = document.createElement("p"); notice.id = "preset-migration-status"; notice.setAttribute("role", "status");
    notice.textContent = messages.join(" "); elements.presetList.append(notice);
    if (state.failedCatalogCommand && !state.recipeCatalog?.readOnly) addButton(notice, "Retry recipe update", "button secondary", () => { void commitCatalog(state.failedCatalogCommand); }).disabled = state.catalogBusy;
    if (state.recipeCatalog?.readOnly) addButton(notice, "Open local data", "button secondary", () => document.querySelector("#local-data-button")?.click());
  }
  let group = null;
  for (const preset of libraryPresets()) {
    const nextGroup = preset.builtIn ? "Popular" : "My presets";
    if (nextGroup !== group) {
      group = nextGroup;
      const groupHeading = document.createElement("h2");
      groupHeading.className = "preset-group-heading";
      groupHeading.textContent = group;
      elements.presetList.append(groupHeading);
    }
    const card = document.createElement("article");
    const problem = preset.recovery ? "Saved settings for the original image. Save a reusable recipe to apply elsewhere." : legacyRecipeProblem(preset, state.capabilities);
    card.className = "preset-card";
    card.dataset.presetId = preset.id;
    if (preset.style) card.dataset.styleRevision = String(preset.style.revision);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Use ${preset.name}`);
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, details, summary, input, select")) return;
      usePreset(preset);
    });
    card.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target === card) {
        event.preventDefault();
        usePreset(preset);
      }
    });
    const visual = document.createElement("div");
    visual.className = "preset-visual";
    const shape = document.createElement("span");
    shape.className = "preset-shape";
    const width = preset.operations.resizeWidth;
    const height = preset.operations.resizeHeight;
    shape.style.aspectRatio = width && height ? `${width} / ${height}` : "4 / 3";
    visual.append(shape);
    const heading = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = preset.name;
    heading.append(title);
    const description = document.createElement("p");
    description.textContent = preset.description ?? "A reusable private image recipe.";
    const meta = document.createElement("div");
    meta.className = "preset-card-meta";
    const destination = document.createElement("span");
    destination.className = "preset-chip";
    destination.textContent = preset.destination ?? preset.name;
    meta.append(destination);
    const details = document.createElement("details");
    details.className = "preset-card-details";
    const detailsSummary = document.createElement("summary");
    detailsSummary.textContent = "Details";
    const detailsCopy = document.createElement("p");
    const dimensions = preset.operations.resizeWidth && preset.operations.resizeHeight
      ? `${preset.operations.resizeWidth} × ${preset.operations.resizeHeight}`
      : "same size as the original";
    detailsCopy.textContent = `${dimensions} · ${normalizeFormat(preset.operations.format) ? formatLabel(preset.operations.format) : preset.operations.format ?? "PNG"} output${preset.style ? ` · Revision ${preset.style.revision}` : ""}`;
    details.append(detailsSummary, detailsCopy);
    const more = document.createElement("details");
    more.className = "preset-more";
    const moreSummary = document.createElement("summary");
    moreSummary.textContent = "More actions";
    const moreActions = document.createElement("div");
    moreActions.className = "preset-card-actions";
    addButton(moreActions, "Edit on canvas", "button secondary", () => editPresetOnCanvas(preset)).disabled = Boolean(problem);
    addButton(moreActions, "Duplicate", "button secondary", () => { void duplicatePreset(preset); }).disabled = state.catalogBusy || !state.recipeCatalog || state.recipeCatalog.readOnly;
    if (!preset.builtIn) addButton(moreActions, "Delete", "button secondary", () => { void deletePreset(preset); }).disabled = state.catalogBusy || !state.recipeCatalog || state.recipeCatalog.readOnly;
    more.append(moreSummary, moreActions);
    card.append(visual, heading, description, meta, details, more);
    if (problem) {
      // aria-disabled on the card would also disable its recovery actions.
      card.dataset.unavailable = "true"; card.tabIndex = -1; card.setAttribute("role", "group");
      card.setAttribute("aria-label", `${preset.name}: unavailable`);
      const notice = document.createElement("p"); notice.className = "preset-note"; notice.textContent = problem; card.append(notice);
      for (const format of state.capabilities.outputFormats) addButton(card, `Keep edits · use ${formatLabel(format)}`, "button secondary", () => { void replacePresetOutput(preset, format); }).disabled = state.catalogBusy || !state.recipeCatalog || state.recipeCatalog.readOnly;
    }
    for (const details of card.querySelectorAll("details")) details.open = expanded.has(`${preset.id}:${details.className}`);
    elements.presetList.append(card);
  }
}

async function replacePresetOutput(preset, format) {
  if (!state.capabilities.outputFormats.includes(format) || !state.customPresets.some((entry) => entry.id === preset.id)) return;
  try {
    const original = originalRecipe(preset), selection = catalogSelection(preset);
    const replacement = { ...original, operations: { ...original.operations, format, lossy: false, quality: DEFAULT_QUALITY } };
    await commitCatalog(recipeCommand(selection.base, "put", replacement, selection.token));
  } catch (error) { catalogFailure(error); }
}

async function duplicatePreset(preset) {
  const copy = {
    ...originalRecipe(preset),
    id: `custom-${crypto.randomUUID()}`,
    name: `${preset.name} copy`,
    builtIn: false,
  };
  delete copy.builtIn;
  delete copy.style;
  try { await commitCatalog(recipeCommand(state.recipeCatalog, "put", copy)); }
  catch (error) { catalogFailure(error); }
}

async function deletePreset(preset) {
  try {
    const selection = catalogSelection(preset);
    if (!window.confirm(`Delete “${preset.name}” from saved recipes? Applied copies in your open work are kept.`)) return;
    await commitCatalog(recipeCommand(selection.base, "delete", preset.id, selection.token));
  } catch (error) { catalogFailure(error); }
}

function editPresetOnCanvas(preset) {
  const problem = legacyRecipeProblem(preset, state.capabilities);
  if (problem) { state.presetMigrationMessage = problem; renderPresetList(); return; }
  let context; try { context = presetEditContext(preset); } catch (error) { catalogFailure(error); return; }
  const snapshot = window.tinyImageStarEditor?.getSnapshot();
  if (snapshot?.file && snapshot.imageWidth && snapshot.imageHeight) {
    const operations = normalizePresetOperations(legacyRecipeOperations(preset), snapshot.imageWidth, snapshot.imageHeight);
    window.tinyImageStarEditor.replaceOperations(operations, context);
    showView("editor");
    return;
  }
  state.pendingPresetId = preset.id;
  state.pendingPresetSelection = { preset: clone(preset), context };
  showView("editor");
  document.querySelector("#empty-open-button")?.click();
}

function renderBatchPresetPicker() {
  elements.batchPresetPicker.replaceChildren();
  renderRecipeScopeControls();
  const scopedSelection = scopedRecipeSelection();
  const hasScopedTargets = state.batch.files.length > 1 && state.batch.recipeScope !== "all";
  const selectedPresetId = scopedSelection ?? (hasScopedTargets ? null : recipeKey(batchPreset()));
  const quickIds = ["instagram-square", "profile-photo", "website-banner"];
  const appendPreset = (parent, preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = recipeLabel(preset, allPresets());
    button.dataset.recipeKey = recipeKey(preset);
    const problem = preset.recovery ? "Saved settings for the original image. Save a reusable recipe to apply elsewhere." : legacyRecipeProblem(preset, state.capabilities);
    button.disabled = Boolean(problem); if (problem) button.title = problem;
    button.setAttribute("aria-pressed", String(recipeKey(preset) === selectedPresetId));
    button.addEventListener("click", () => applyPresetToScope(recipeKey(preset)));
    parent.append(button);
  };
  const presets = allPresets();
  for (const preset of presets.filter((candidate) => quickIds.includes(candidate.id))) appendPreset(elements.batchPresetPicker, preset);
  const morePresets = presets.filter((candidate) => !quickIds.includes(candidate.id));
  if (morePresets.length) {
    const more = document.createElement("details");
    more.id = "batch-preset-more";
    more.className = "preset-picker-more";
    const summary = document.createElement("summary");
    summary.textContent = "More destinations";
    const grid = document.createElement("div");
    grid.className = "preset-picker-more-grid";
    for (const preset of morePresets) appendPreset(grid, preset);
    more.append(summary, grid);
    elements.batchPresetPicker.append(more);
  }
  const activePreset = selectedPresetId ? presetByChoice(selectedPresetId) : batchPreset();
  const scopeLabel = state.batch.files.length > 1 && state.batch.recipeScope !== "all"
    ? state.batch.recipeScope === "selected" ? "Selected images" : "This image"
    : null;
  const selectedName = selectedPresetId ? recipeLabel(activePreset, allPresets()) : "Different recipes or versions";
  const selectedFormat = batchOutputFormat(activePreset);
  const qualityText = state.capabilities.compression.lossyFormats.includes(selectedFormat)
    ? state.capabilities.compression.quality
      ? `${qualityLabel(state.batch.qualityOverride ?? activePreset.operations.quality)} quality`
      : "Fixed encoder settings · white background"
    : "Full quality";
  const sharedText = state.batch.sharedOverride ? " · Shared canvas edits" : "";
  elements.batchPresetName.textContent = `${scopeLabel ? `${scopeLabel}: ` : "Using: "}${selectedName} · ${formatLabel(selectedFormat)} · ${qualityText}${sharedText}`;
  renderBatchFormatOptions();
}

function renderBatchFormatOptions() {
  if (!elements.batchFormat || !elements.batchFormatControl) return;
  const formats = state.capabilities.outputFormats;
  const unavailable = state.batch.formatOverride && !formats.includes(state.batch.formatOverride);
  elements.batchFormatControl.hidden = formats.length < 2 && !unavailable;
  elements.batchFormat.disabled = formats.length < 2 && !unavailable;
  elements.batchFormat.replaceChildren();
  const preset = batchPreset();
  if (formats.length > 1) {
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = `Use recipe format (${formatLabel(preset.operations.format)})`;
    defaultOption.selected = !state.batch.formatOverride;
    elements.batchFormat.append(defaultOption);
  }
  for (const format of formats) {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = formatLabel(format);
    option.selected = format === state.batch.formatOverride;
    elements.batchFormat.append(option);
  }
  appendUnavailableFormat(elements.batchFormat, formats);
  elements.batchFormatReset.hidden = !state.batch.formatOverride;
  elements.batchFormatReset.disabled = !state.batch.formatOverride;
  renderBatchCompressionOptions();
}

function appendUnavailableFormat(select, formats) {
  if (!state.batch.formatOverride || formats.includes(state.batch.formatOverride)) return;
  const option = document.createElement("option");
  option.value = state.batch.formatOverride;
  option.textContent = `Saved ${String(state.batch.formatOverride).toUpperCase()} — unavailable`;
  option.disabled = true; option.selected = true;
  select.append(option);
}

function renderBatchCompressionOptions() {
  const format = batchOutputFormat();
  const canBeLossy = state.capabilities.compression.lossy
    && state.capabilities.compression.lossyFormats.includes(format);
  for (const [control, input] of [
    [elements.batchLossyControl, elements.batchLossy],
    [elements.trayLossyControl, elements.trayLossy],
  ]) {
    if (!control || !input) continue;
    control.hidden = !canBeLossy || !state.capabilities.compression.quality;
    input.checked = canBeLossy && state.batch.lossyOverride === true;
    input.disabled = !canBeLossy || !state.capabilities.compression.quality;
  }
  const quality = normalizeQuality(state.batch.qualityOverride ?? batchPreset().operations.quality ?? DEFAULT_QUALITY);
  for (const [control, input] of [
    [elements.batchQualityControl, elements.batchQuality],
    [elements.trayQualityControl, elements.trayQuality],
  ]) {
    if (!control || !input) continue;
    control.hidden = !canBeLossy || !state.capabilities.compression.quality;
    input.disabled = !canBeLossy || !state.capabilities.compression.quality;
    input.value = String(QUALITY_LEVELS.some((level) => level.value === quality) ? quality : DEFAULT_QUALITY);
    input.title = `${qualityLabel(input.value)} quality. Choosing a quality enables smaller-file compression.`;
  }
}

function renderTrayOutputOptions() {
  if (!elements.trayFormat || !elements.trayFormatControl) return;
  const formats = state.capabilities.outputFormats;
  elements.trayFormatControl.hidden = false;
  elements.trayFormat.disabled = formats.length < 2 && (!state.batch.formatOverride || formats.includes(state.batch.formatOverride));
  elements.trayFormat.replaceChildren();
  const preset = batchPreset();
  if (formats.length > 1) {
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = `Use recipe format (${formatLabel(preset.operations.format)})`;
    defaultOption.selected = !state.batch.formatOverride;
    elements.trayFormat.append(defaultOption);
  }
  for (const format of formats) {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = formatLabel(format);
    option.selected = format === state.batch.formatOverride;
    elements.trayFormat.append(option);
  }
  appendUnavailableFormat(elements.trayFormat, formats);
  renderBatchCompressionOptions();
}

function setBatchFormat(format) {
  captureCurrentBatchEditorOverride();
  const normalized = normalizeFormat(format);
  state.batch.formatOverride = normalized && state.capabilities.outputFormats.includes(normalized) ? normalized : null;
  if (!state.capabilities.compression.quality || !state.capabilities.compression.lossyFormats.includes(batchOutputFormat())) {
    state.batch.lossyOverride = null;
    state.batch.qualityOverride = null;
  }
  renderBatchPresetPicker();
  renderWorkspaceTray();
  refreshActiveBatchEditor();
  if (state.batch.files.length) runBatch();
}

function setBatchLossy(enabled) {
  captureCurrentBatchEditorOverride();
  if (!state.capabilities.compression.lossyFormats.includes(batchOutputFormat())) {
    state.batch.lossyOverride = null;
    state.batch.qualityOverride = null;
    renderBatchCompressionOptions();
    return;
  }
  state.batch.lossyOverride = Boolean(enabled);
  renderBatchPresetPicker();
  renderWorkspaceTray();
  refreshActiveBatchEditor();
  if (state.batch.files.length) runBatch();
}

function setBatchQuality(value) {
  if (!state.capabilities.compression.quality || !state.capabilities.compression.lossyFormats.includes(batchOutputFormat())) return;
  captureCurrentBatchEditorOverride();
  state.batch.qualityOverride = normalizeQuality(value);
  state.batch.lossyOverride = true;
  renderBatchPresetPicker();
  renderWorkspaceTray();
  refreshActiveBatchEditor();
  if (state.batch.files.length) runBatch();
}

function openPresetDialog(operations, width, height, suggestedName = "My image recipe", context = null) {
  state.pendingSave = { operations: clone(operations), width, height, context: clone(context) };
  elements.presetForm.querySelector("[data-preset-save-error]")?.remove();
  elements.presetDialogHeading.textContent = context?.kind === "batch-override"
    ? "Save override as preset"
    : context?.kind === "batch-image" ? "Save image recipe" : "Save as preset";
  elements.presetName.value = suggestedName;
  elements.presetDestination.replaceChildren();
  for (const destination of [...DESTINATION_PRESETS, { id: "custom", name: "Custom recipe" }]) {
    const option = document.createElement("option");
    option.value = destination.id;
    option.textContent = destination.name;
    elements.presetDestination.append(option);
  }
  const matchingDestination = DESTINATION_PRESETS.find((destination) => destination.id === operations?.presetId)
    ?? DESTINATION_PRESETS.find((destination) => (
      destination.width === operations?.resizeWidth
      && destination.height === operations?.resizeHeight
      && destination.mode === operations?.resizeMode
    ));
  elements.presetDestination.value = matchingDestination?.id ?? "custom";
  elements.presetResizeMode.value = operations?.resizeMode === "crop" ? "crop" : "fit";
  const outputWidth = operations?.resizeWidth ?? width;
  const outputHeight = operations?.resizeHeight ?? height;
  elements.presetWidth.value = String(Math.max(1, Math.round(outputWidth || width || 1)));
  elements.presetHeight.value = String(Math.max(1, Math.round(outputHeight || height || 1)));
  elements.presetFormat.replaceChildren();
  for (const format of state.capabilities.outputFormats) {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = formatLabel(format);
    option.selected = format === (operations?.format ?? state.capabilities.outputFormats[0]);
    elements.presetFormat.append(option);
  }
  elements.presetCompression.hidden = !state.capabilities.compression.lossy || !state.capabilities.compression.quality;
  elements.presetLossy.checked = Boolean(operations?.lossy);
  elements.presetLossy.disabled = !state.capabilities.compression.lossy;
  elements.presetQuality.value = String(QUALITY_LEVELS.some((level) => level.value === normalizeQuality(operations?.quality))
    ? normalizeQuality(operations?.quality)
    : DEFAULT_QUALITY);
  syncPresetCompression();
  elements.presetAdvancedSummary.textContent = operations?.crop
    ? "Your crop frame will be remembered relative to the source image, so it can adapt to a new image."
    : "No crop frame is saved; the whole image remains visible.";
  if (typeof elements.presetDialog.showModal === "function") elements.presetDialog.showModal();
  else elements.presetDialog.setAttribute("open", "");
}

function applyPresetDestinationToDialog() {
  if (!state.pendingSave) return;
  const destination = DESTINATION_PRESETS.find((item) => item.id === elements.presetDestination.value);
  if (!destination) return;
  const operations = state.pendingSave.operations ?? {};
  operations.resizeWidth = destination.width ?? state.pendingSave.width;
  operations.resizeHeight = destination.height ?? state.pendingSave.height;
  operations.resizeMode = destination.mode;
  operations.aspectLocked = true;
  operations.presetId = destination.id;
  operations.presetName = destination.name;
  state.pendingSave.operations = operations;
  elements.presetWidth.value = String(Math.max(1, Math.round(operations.resizeWidth || 1)));
  elements.presetHeight.value = String(Math.max(1, Math.round(operations.resizeHeight || 1)));
  elements.presetResizeMode.value = destination.mode === "crop" ? "crop" : "fit";
}

function syncPresetCompression() {
  const format = normalizeFormat(elements.presetFormat.value);
  const lossy = state.capabilities.compression.lossy && state.capabilities.compression.lossyFormats.includes(format);
  elements.presetCompression.hidden = !lossy || !state.capabilities.compression.quality;
  elements.presetLossy.disabled = !lossy;
  elements.presetQualityControl.hidden = !lossy || !state.capabilities.compression.quality;
  elements.presetQuality.disabled = !lossy || !state.capabilities.compression.quality || !elements.presetLossy.checked;
  if (!lossy) elements.presetLossy.checked = false;
}

async function savePresetFromDialog({ asCopy = false } = {}) {
  if (!state.pendingSave || state.catalogBusy) return;
  if (!state.recipeCatalog || state.recipeCatalog.readOnly) {
    catalogFailure(catalogError(state.recipeCatalog?.issue ?? "Saved recipes are still opening. Try saving again in a moment."), true); return;
  }
  const pending = state.pendingSave;
  if (asCopy) { pending.forceCopy = true; pending.createId = `custom-${crypto.randomUUID()}`; pending.command = null; }
  const name = elements.presetName.value.trim();
  if (!name) return;
  const destination = [...DESTINATION_PRESETS, { id: "custom", name: "Custom recipe" }].find((item) => item.id === elements.presetDestination.value);
  const operations = clone(state.pendingSave.operations) ?? {};
  operations.resizeWidth = Number(elements.presetWidth.value) || state.pendingSave.width;
  operations.resizeHeight = Number(elements.presetHeight.value) || state.pendingSave.height;
  operations.resizeMode = elements.presetResizeMode.value === "crop" ? "crop" : "fit";
  operations.format = state.capabilities.outputFormats.includes(elements.presetFormat.value)
    ? elements.presetFormat.value
    : state.capabilities.outputFormats[0];
  operations.lossy = Boolean(elements.presetLossy.checked && state.capabilities.compression.quality && state.capabilities.compression.lossyFormats.includes(operations.format));
  operations.quality = normalizeQuality(elements.presetQuality.value);
  if (destination?.id && destination.id !== "custom") {
    operations.presetId = destination.id;
    operations.presetName = destination.name;
  } else {
    delete operations.presetId;
    delete operations.presetName;
  }
  const editing = !pending.forceCopy && pending.context?.catalog;
  const preset = {
    ...(editing ? pending.context.originalRecipe : {}),
    id: editing ? pending.context.presetId : pending.createId ??= `custom-${crypto.randomUUID()}`,
    name,
    destination: destination?.id === "custom" ? name : destination.name,
    description: "A local recipe saved from the canvas.",
    builtIn: false,
    operations: relativePresetOperations(operations, state.pendingSave.width || 1, state.pendingSave.height || 1),
  };
  const selection = editing ? pending.context.catalog : { base: state.recipeCatalog, token: null };
  try {
    if (!pending.command || canonicalJSON(pending.command.recipe) !== canonicalJSON(preset)) pending.command = recipeCommand(selection.base, "put", preset, selection.token);
    const saved = await commitCatalog(pending.command, { inDialog: true });
    if (!saved || state.pendingSave !== pending) return;
  } catch (error) { catalogFailure(error, true); return; }
  state.pendingSave = null;
  elements.presetDialog.close();
  renderPresetList();
  renderBatchPresetPicker();
  renderWorkspaceTray();
  elements.batchStatus.textContent = `Saved “${name}” locally in this browser.`;
}

function clearBatchFiles({ resetRecipe = false, skipSession = false } = {}) {
  photoLookHistory.length = 0;
  state.batch.projectId = `project-${crypto.randomUUID()}`;
  state.batch.projectRevision = 0;
  state.batch.projectCreatedAt = Date.now();
  state.batch.frozenRecipes = [clone(presetById(state.activePresetId, state.activeRecipeKey))];
  cancelBatchWorkers();
  state.batch.revision += 1;
  for (const item of state.batch.files) {
    if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
    const result = state.batch.results.get(item.id);
    if (result?.url) URL.revokeObjectURL(result.url);
  }
  state.batch.files = [];
  state.batch.results.clear();
  state.batch.selected.clear();
  state.batch.selectionTouched = false;
  state.batch.activeId = null;
  if (resetRecipe) {
    state.batch.presetId = null;
    state.batch.recipeKey = null;
    state.batch.recipeScope = "all";
    state.batch.sharedOverride = null;
    state.batch.formatOverride = null;
    state.batch.lossyOverride = null;
    state.batch.qualityOverride = null;
  }
  renderBatchGrid();
  if (!skipSession) scheduleSessionSave(0);
}

function startNewBatch() {
  if (state.batch.files.length && !window.confirm("Start a new image set? Current previews will be cleared.")) return;
  const reviewWasOpen = state.view === "batch" && elements.batchView?.dataset.review === "true";
  clearBatchFiles({ resetRecipe: true });
  window.tinyImageStarEditor?.clearFile?.();
  state.batch.importNotice = "";
  state.batch.presetId = state.activePresetId;
  state.batch.recipeKey = state.activeRecipeKey;
  elements.batchStatus.textContent = "New image set ready. Choose or drop images here.";
  renderBatchPresetPicker();
  if (reviewWasOpen) showView("editor");
  scheduleSessionSave(0);
}

function removeBatchItem(item) {
  const wasProcessing = state.batch.processing;
  if (wasProcessing) cancelBatchWorkers();
  if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
  const result = state.batch.results.get(item.id);
  if (result?.url) URL.revokeObjectURL(result.url);
  state.batch.files = state.batch.files.filter((candidate) => candidate.id !== item.id);
  state.batch.results.delete(item.id);
  state.batch.selected.delete(item.id);
  if (state.batch.files.length < 2) state.batch.recipeScope = "all";
  if (state.batch.activeId === item.id) state.batch.activeId = state.batch.files[0]?.id ?? null;
  if (!state.batch.files.length) {
    state.batch.selectionTouched = false;
    elements.batchStatus.textContent = "Image removed. Choose or drop images here.";
    renderBatchGrid();
    if (state.view === "batch" && elements.batchView?.dataset.review === "true") showView("editor");
    scheduleSessionSave(0);
    return;
  }
  const ready = batchItemsReady(state.batch.files);
  if (wasProcessing || ready.length) runBatch(ready);
  else renderBatchGrid();
  scheduleSessionSave(0);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("preview unavailable"));
    image.src = url;
  });
}

function batchPixelTotal(excludeId = null) {
  return state.batch.files.reduce((total, item) => {
    if (item.id === excludeId || item.status === "error") return total;
    return total + (Number(item.width) || 0) * (Number(item.height) || 0);
  }, 0);
}

async function prepareBatchItem(item, importToken) {
  try {
    const byteProblem = inputProblem(item.bytes);
    if (byteProblem) {
      item.status = "error";
      item.error = byteProblem.message;
      item.retryable = false;
      renderBatchGrid();
      return false;
    }
    item.image = await loadImage(item.sourceUrl);
    item.width = item.image.naturalWidth;
    item.height = item.image.naturalHeight;
    const dimensionProblem = inputProblem(item.bytes, { width: item.width, height: item.height });
    if (dimensionProblem || batchPixelTotal(item.id) + item.width * item.height > MAX_BATCH_PIXELS) {
      const problem = dimensionProblem ?? {
        message: "This image would make the set too large to process safely. Remove an image or choose smaller files.",
      };
      item.status = "error";
      item.error = problem.message;
      item.retryable = false;
      renderBatchGrid();
      return false;
    }
    item.status = "waiting";
    item.error = null;
    item.retryable = false;
    renderBatchGrid();
    return true;
  } catch {
    try {
      const proxy = await requestBatchPreview(item);
      if (importToken !== state.batch.importToken || !state.batch.files.includes(item)) {
        URL.revokeObjectURL(proxy.url);
        return false;
      }
      URL.revokeObjectURL(item.sourceUrl);
      item.sourceUrl = proxy.url;
      item.image = proxy.image;
      item.width = proxy.width;
      item.height = proxy.height;
      const proxyProblem = inputProblem(item.bytes, { width: item.width, height: item.height });
      if (proxyProblem || batchPixelTotal(item.id) + item.width * item.height > MAX_BATCH_PIXELS) {
        item.status = "error";
        item.error = (proxyProblem ?? { message: "This image would make the set too large to process safely. Remove an image or choose smaller files." }).message;
        item.retryable = false;
        renderBatchGrid();
        return false;
      }
      item.status = "waiting";
      item.error = null;
      item.retryable = false;
      renderBatchGrid();
      return true;
    } catch {
      item.status = "error";
      item.error = "This image could not be previewed.";
      item.retryable = false;
      renderBatchGrid();
      return false;
    }
  }
}

function importNotice() {
  return state.batch.importNotice ? ` ${state.batch.importNotice}` : "";
}

function setBatchStatus(message, { error = false } = {}) {
  elements.batchStatus.textContent = message;
  const snapshot = window.tinyImageStarEditor?.getSnapshot?.();
  // When the collection is still empty, the detailed review surface is
  // intentionally hidden. Mirror import validation into the editor's visible
  // stage status so a rejected selection is never silent.
  if (state.view !== "batch" && !snapshot?.file) {
    const canvasStatus = document.querySelector("#canvas-status");
    if (canvasStatus) {
      canvasStatus.textContent = message;
      if (error) canvasStatus.dataset.state = "error";
      else delete canvasStatus.dataset.state;
    }
  }
}

function interactiveBatchLimitMessage(existingCount = 0) {
  const remaining = Math.max(0, MAX_BATCH_FILES - existingCount);
  const allowance = existingCount
    ? `${remaining} more image${remaining === 1 ? "" : "s"}`
    : `up to ${MAX_BATCH_FILES} images`;
  const reason = `Interactive editing can hold ${allowance} at once so previews, undo, and downloads stay responsive.`;
  return supportsLargeFolderJobs()
    ? `${reason} For a larger collection, use Process large folder so each result is saved as it finishes.`
    : `${reason} For a larger collection, open this page in desktop Chrome or Edge and choose a folder so each result can be saved as it finishes.`;
}

function renderImportCapacity() {
  const largeFolder = supportsLargeFolderJobs();
  const emptyFolder = document.querySelector("#empty-folder-button");
  const label = largeFolder ? "Process large folder" : `Choose folder (up to ${MAX_BATCH_FILES})`;
  const title = largeFolder
    ? "Process and save a large folder one image at a time"
    : `This browser can interactively edit up to ${MAX_BATCH_FILES} images at once`;
  for (const button of [emptyFolder, elements.batchFolder]) {
    if (!button) continue;
    button.textContent = label;
    button.title = title;
  }
}

async function importBatchFiles(fileList, { focusFirst = false } = {}) {
  const incoming = Array.from(fileList ?? []).filter((file) => file.size > 0);
  const candidates = incoming.filter(isSupportedInput);
  const skipped = incoming.length - candidates.length;
  if (skipped && !candidates.length) {
    state.batch.importNotice = unsupportedInputMessage();
    setBatchStatus(state.batch.importNotice, { error: true });
    return;
  }
  if (!candidates.length) return;
  if (candidates.length > MAX_BATCH_FILES) {
    setBatchStatus(interactiveBatchLimitMessage(), { error: true });
    return;
  }

  const importToken = ++state.batch.importToken;
  const existingCount = state.batch.files.length;
  const existingBytes = state.batch.files.reduce((total, item) => total + (item.file?.size ?? 0), 0);
  const incomingBytes = candidates.reduce((total, file) => total + file.size, 0);
  if (batchBytesExceedLimit(existingBytes, incomingBytes, MAX_BATCH_BYTES)) {
    setBatchStatus("That set is too large to keep responsive. Try fewer or smaller images.", { error: true });
    return;
  }
  const existingKeys = new Set(state.batch.files.map((item) => item.duplicateKey).filter(Boolean));
  const prepared = [];
  let duplicateSkipped = 0;
  setBatchStatus("Reading images locally…");

  for (const file of candidates) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (importToken !== state.batch.importToken) return;
    const fingerprint = await fingerprintBytes(bytes);
    const key = duplicateKey(file, fingerprint);
    if (existingKeys.has(key)) {
      const addDuplicate = window.confirm(`“${file.name}” is already in this image set. Add another copy?`);
      if (!addDuplicate) {
        duplicateSkipped += 1;
        continue;
      }
    }
    existingKeys.add(key);
    prepared.push({ file, bytes, fingerprint, duplicateKey: key });
  }

  if (importToken !== state.batch.importToken) return;
  if (!prepared.length) {
    state.batch.importNotice = duplicateSkipped ? "Duplicate images were not added." : "No new images were added.";
    setBatchStatus(state.batch.importNotice);
    return;
  }
  if (existingCount + prepared.length > MAX_BATCH_FILES) {
    setBatchStatus(interactiveBatchLimitMessage(existingCount), { error: true });
    return;
  }
  const totalBytes = existingBytes + prepared.reduce((total, entry) => total + entry.file.size, 0);
  if (batchBytesExceedLimit(existingBytes, totalBytes - existingBytes, MAX_BATCH_BYTES)) {
    setBatchStatus("That set is too large to keep responsive. Try fewer or smaller images.", { error: true });
    return;
  }

  state.batch.importNotice = [
    skipped ? `Skipped ${skipped} unsupported file${skipped === 1 ? "" : "s"}.` : "",
    duplicateSkipped ? `Skipped ${duplicateSkipped} duplicate${duplicateSkipped === 1 ? "" : "s"}.` : "",
  ].filter(Boolean).join(" ");
  state.batch.revision += 1;
  const newItems = prepared.map(({ file, bytes, fingerprint, duplicateKey: key }, index) => ({
    id: `${file.name}-${file.lastModified}-${state.batch.revision}-${index}`,
    file,
    name: file.name,
    sourceUrl: URL.createObjectURL(file),
    bytes,
    fingerprint,
    duplicateKey: key,
    image: null,
    width: 0,
    height: 0,
    status: "reading",
    presetOverride: null,
    recipeKeyOverride: null,
    override: null,
    retryable: false,
  }));
  // A fresh selection starts a new batch; later selections add to the active
  // batch so the compact drop area keeps its promise.
  if (existingCount === 0) {
    clearBatchFiles();
    state.batch.selectionTouched = false;
    state.batch.presetId = state.activePresetId;
    state.batch.recipeKey = state.activeRecipeKey;
  }
  state.batch.files.push(...newItems);
  setBatchStatus(`${existingCount ? "Added " : "Reading "}${newItems.length} image${newItems.length === 1 ? "" : "s"} locally…${importNotice()}`);
  renderBatchGrid();
  for (const item of newItems) {
    if (importToken !== state.batch.importToken || !state.batch.files.includes(item)) return;
    await prepareBatchItem(item, importToken);
  }
  await runBatch(newItems);
  scheduleSessionSave(0);
  if (focusFirst) {
    const first = newItems.find((item) => batchItemsReady([item]).length) ?? newItems[0];
    if (first) editBatchItem(first);
  }
}

function batchItemsReady(items) {
  return items.filter((item) => item.bytes && item.width && item.height && (item.status !== "error" || item.retryable));
}

async function runBatch(items = state.batch.files, label = "Updating image previews in place") {
  let readyItems = batchItemsReady(items);
  if (!readyItems.length) {
    elements.batchStatus.textContent = state.batch.files.some((item) => item.status === "error")
      ? `No images are ready to update. Retry a failed image or choose another file.${importNotice()}`
      : "Add an image to see a preview.";
    return;
  }
  cancelBatchWorkers({ previews: false });
  const blocked = readyItems.filter((item) => {
    const recipe = recipeForItem(item);
    const problem = legacyRecipeProblem(recipe, state.capabilities)
      || (state.batch.lossyOverride === true && !state.capabilities.compression.quality ? "The saved session requests adjustable compression. Choose a supported fixed-setting output." : "")
      || legacyRecipeProblem({ id: recipe.id, name: recipe.name, operations: effectiveOperationsForItem(item) }, state.capabilities);
    if (!problem) return false;
    item.status = "error"; item.error = problem; item.retryable = true;
    const prior = state.batch.results.get(item.id); if (prior?.url) URL.revokeObjectURL(prior.url);
    state.batch.results.delete(item.id); return true;
  });
  readyItems = readyItems.filter((item) => !blocked.includes(item));
  if (!readyItems.length) {
    state.batch.processing = false; renderBatchGrid();
    elements.batchStatus.textContent = `${blocked.length} image(s) need a supported recipe. Open Presets to choose a replacement. ${blocked[0]?.error ?? ""}`;
    return;
  }
  state.batch.revision += 1;
  state.batch.processing = true;
  for (const item of readyItems) {
    const previous = state.batch.results.get(item.id);
    if (previous?.url) URL.revokeObjectURL(previous.url);
    state.batch.results.delete(item.id);
    item.status = "waiting";
  }
  renderBatchGrid();
  const queue = readyItems.map((item) => {
    const settings = effectiveOperationsForItem(item);
    // Queue intent only. Copying every source here doubles the set's encoded
    // memory before even the first worker can start. Copies belong to dispatch.
    return { id: item.id, name: item.name, settings };
  });
  state.batch.job = { revision: state.batch.revision, total: queue.length, queue, active: 0, completed: 0, pendingCompositions: 0, startedAt: performance.now(), paused: false, label };
  elements.batchStatus.textContent = `Updating ${readyItems.length} preview${readyItems.length === 1 ? "" : "s"}…`;
  elements.batchCancel.hidden = false;
  renderBatchJobBar();
  // Logical clients bound metadata dispatch; the shared scheduler decides
  // how many physical workers can actually run across all surfaces.
  const workerCount = Math.min(readyItems.length, getProcessingScheduler().budget.cpu);
  state.batchWorkers = Array.from({ length: workerCount }, () => createBatchWorker(state.batch.job));
  state.batchWorker = state.batchWorkers[0] ?? null;
  for (const worker of state.batchWorkers) dispatchBatchWork(worker);
}

function cancelBatchWorkers({ previews = true } = {}) {
  if (previews) cancelBatchPreviewWorkers();
  for (const worker of state.batchWorkers) worker.terminate();
  state.batchWorkers = [];
  state.batchWorker = null;
  state.batch.job = null;
  state.batch.processing = false;
}

function cancelBatchPreviewWorkers() {
  for (const worker of state.batchPreviewWorkers) worker.cancel?.();
  state.batchPreviewWorkers.clear();
}

function requestBatchPreview(item) {
  const revision = state.batch.revision;
  return new Promise((resolve, reject) => {
    const worker = createProcessingClient({ priority: 2 });
    let settled = false;
    let proxyUrl = null;
    const cleanup = () => {
      state.batchPreviewWorkers.delete(worker);
      worker.terminate();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (proxyUrl) URL.revokeObjectURL(proxyUrl);
      cleanup();
      reject(error);
    };
    worker.cancel = () => fail(new Error("Preview cancelled."));
    state.batchPreviewWorkers.add(worker);
    worker.addEventListener("message", (event) => {
      const message = event.data;
      if (message.type === "ready") {
        const message = {
          type: "preview",
          revision,
          file: { id: item.id, name: item.name },
        };
        worker.submit({ message, source: { encodedBytes: item.bytes.byteLength }, prepare: () => {
          const bytes = item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength);
          return { message: { ...message, file: { ...message.file, bytes } }, transfer: [bytes] };
        } });
        return;
      }
      if (message.type === "preview-error") {
        fail(new Error(message.message || "The image preview could not be created."));
        return;
      }
      if (message.type !== "preview-result" || message.revision !== revision) return;
      if (!state.batch.files.includes(item)) {
        fail(new Error("Preview cancelled."));
        return;
      }
      proxyUrl = URL.createObjectURL(new Blob([message.output], { type: message.mime }));
      loadImage(proxyUrl).then((image) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ url: proxyUrl, image, width: message.width, height: message.height });
      }).catch(fail);
    });
    worker.addEventListener("error", () => fail(new Error("The image preview could not be created.")));
  });
}

function cancelActiveBatch() {
  if (!state.batch.job) return;
  state.batch.revision += 1;
  cancelBatchWorkers();
  for (const item of state.batch.files) {
    if (item.status === "waiting") {
      item.status = "cancelled";
      item.error = "Update cancelled.";
      item.retryable = true;
    }
  }
  elements.batchStatus.textContent = "Updates cancelled. Completed previews remain ready to download.";
  renderBatchGrid();
  scheduleSessionSave(0);
}

async function retryBatchItem(item) {
  if (state.batch.processing) return;
  item.error = null;
  if (!item.bytes || !item.width || !item.height) {
    item.status = "reading";
    renderBatchGrid();
    try {
      item.bytes = new Uint8Array(await item.file.arrayBuffer());
      item.image = await loadImage(item.sourceUrl);
      item.width = item.image.naturalWidth;
      item.height = item.image.naturalHeight;
    } catch {
      item.status = "error";
      item.error = "This image could not be previewed. Choose another file.";
      item.retryable = false;
      elements.batchStatus.textContent = item.error;
      renderBatchGrid();
      return;
    }
  }
  item.status = "waiting";
  item.retryable = true;
  renderBatchGrid();
  await runBatch([item]);
  scheduleSessionSave(0);
}

function clearCompletedBatchItems() {
  if (state.batch.processing) return;
  const completed = state.batch.files.filter((item) => state.batch.results.has(item.id));
  if (!completed.length) return;
  const completedIds = new Set(completed.map((item) => item.id));
  for (const item of completed) {
    if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
    const result = state.batch.results.get(item.id);
    if (result?.url) URL.revokeObjectURL(result.url);
    state.batch.results.delete(item.id);
    state.batch.selected.delete(item.id);
  }
  state.batch.files = state.batch.files.filter((item) => !completedIds.has(item.id));
  if (!state.batch.files.length) state.batch.selectionTouched = false;
  if (state.batch.files.length < 2) state.batch.recipeScope = "all";
  const remaining = state.batch.files.length;
  elements.batchStatus.textContent = remaining
    ? `Cleared ${completed.length} completed preview${completed.length === 1 ? "" : "s"}. ${remaining} image${remaining === 1 ? "" : "s"} still needs attention.`
    : `Cleared ${completed.length} completed preview${completed.length === 1 ? "" : "s"}. Choose or drop more images.`;
  renderBatchGrid();
  if (!remaining && state.view === "batch" && elements.batchView?.dataset.review === "true") showView("editor");
  scheduleSessionSave(0);
}

function createBatchWorker(job) {
  const worker = createProcessingClient({ priority: 1 });
  worker.currentFile = null;
  worker.addEventListener("message", (event) => handleBatchWorkerMessage(worker, event.data, job));
  worker.addEventListener("error", () => retireBatchWorker(worker, job, "This image could not be processed."));
  return worker;
}

function retireBatchWorker(worker, job, message) {
  if (!job || job.revision !== state.batch.revision) return;
  const current = worker.currentFile;
  if (current) {
    current.item.status = "error";
    current.item.error = message;
    current.item.retryable = true;
    job.completed += 1;
    job.active = Math.max(0, job.active - 1);
  }
  worker.currentFile = null;
  worker.terminate();
  state.batchWorkers = state.batchWorkers.filter((candidate) => candidate !== worker);
  state.batchWorker = state.batchWorkers[0] ?? null;
  if (!state.batchWorkers.length && job.queue.length && !job.paused) {
    while (job.queue.length) {
      const file = job.queue.shift();
      const item = state.batch.files.find((candidate) => candidate.id === file.id);
      if (!item) continue;
      item.status = "error";
      item.error = "The image workers stopped before this image was updated.";
      item.retryable = true;
      job.completed += 1;
    }
  }
  renderBatchGrid();
  for (const candidate of state.batchWorkers) dispatchBatchWork(candidate);
  finishBatchJobIfReady();
}

function dispatchBatchWork(worker) {
  const job = state.batch.job;
  if (!job || job.revision !== state.batch.revision || job.paused || worker.currentFile) return;
  const queued = job.queue.shift();
  if (!queued) {
    finishBatchJobIfReady();
    return;
  }
  const item = state.batch.files.find((candidate) => candidate.id === queued.id);
  if (!item) {
    dispatchBatchWork(worker);
    return;
  }
  const file = { ...queued };
  worker.currentFile = { item, file };
  job.active += 1;
  const message = { type: "process", jobId: "batch", revision: job.revision, files: [file], settings: null };
  worker.submit({ message, source: { width: item.width, height: item.height, encodedBytes: item.bytes.byteLength }, prepare: () => {
    const bytes = item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength);
    return { message: { ...message, files: [{ ...file, bytes }] }, transfer: [bytes] };
  } });
}

async function commitBatchResult(item, message, bytes, settings, job) {
  if (job.revision !== state.batch.revision || !state.batch.files.includes(item)) return;
  const result = { ...message, output: bytes };
  const previous = state.batch.results.get(item.id);
  if (previous?.url) URL.revokeObjectURL(previous.url);
  state.batch.results.set(item.id, {
    ...result,
    output: result.output instanceof Uint8Array ? result.output : new Uint8Array(result.output),
    outputBytes: result.outputBytes ?? result.output.byteLength,
    url: URL.createObjectURL(new Blob([result.output], { type: result.mime })),
  });
  item.status = "ready";
  item.retryable = false;
  if (!state.batch.selectionTouched) state.batch.selected.add(item.id);
  renderBatchGrid();
}

function handleBatchWorkerMessage(worker, message, job) {
  if (!message || job.revision !== state.batch.revision) return;
  if (message.type === "fatal-error") {
    if (message.revision != null && message.revision !== state.batch.revision) return;
    retireBatchWorker(worker, job, message.message || "The image worker stopped unexpectedly.");
    return;
  }
  if (message.jobId !== "batch" || message.revision !== state.batch.revision) return;
  const current = worker.currentFile;
  if (message.type === "result") {
    const item = state.batch.files.find((candidate) => candidate.id === message.fileId) ?? current?.item;
    if (!item) return;
    const bytes = new Uint8Array(message.output);
    const settings = current?.file?.settings ?? effectiveOperationsForItem(item);
    job.pendingCompositions = (job.pendingCompositions ?? 0) + 1;
    void commitBatchResult(item, message, bytes, settings, job).finally(() => {
      job.pendingCompositions = Math.max(0, (job.pendingCompositions ?? 1) - 1);
      finishBatchJobIfReady();
    });
    return;
  }
  if (message.type === "file-error") {
    const item = state.batch.files.find((candidate) => candidate.id === message.fileId) ?? current?.item;
    if (item) {
      item.status = "error";
      item.error = message.message;
      item.retryable = true;
    }
    renderBatchGrid();
    return;
  }
  if (message.type !== "done" && message.type !== "cancelled") return;
  if (current) {
    job.active = Math.max(0, job.active - 1);
    job.completed += 1;
  }
  worker.currentFile = null;
  elements.batchStatus.textContent = `Updating ${job.completed} of ${job.total} previews…`;
  dispatchBatchWork(worker);
  finishBatchJobIfReady();
}

function finishBatchJobIfReady() {
  const job = state.batch.job;
  if (!job || job.active || job.pendingCompositions) return;
  if (job.paused && job.queue.length) {
    elements.batchStatus.textContent = `Paused — ${job.completed} of ${job.total} images processed.`;
    renderBatchGrid();
    return;
  }
  job.paused = false;
  if (job.queue.length) return;
  state.batch.processing = false;
  const ready = state.batch.files.filter((item) => state.batch.results.has(item.id)).length;
  const errors = state.batch.files.filter((item) => item.status === "error").length;
  elements.batchStatus.textContent = ready
    ? `Ready — ${ready} preview${ready === 1 ? "" : "s"}. ${state.batch.selected.size} selected to download${errors ? `; ${errors} could not be updated.` : "."}${importNotice()}`
    : "The images could not be updated. Try again or choose different files.";
  renderBatchGrid();
  for (const worker of state.batchWorkers) worker.terminate();
  state.batchWorkers = [];
  state.batchWorker = null;
  state.batch.job = null;
  renderBatchJobBar();
  scheduleSessionSave(0);
}

function toggleBatchPause() {
  const job = state.batch.job;
  if (!job) return;
  job.paused = !job.paused;
  if (!job.paused) {
    if (!state.batchWorkers.length && job.queue.length) {
      const workerCount = Math.min(job.queue.length, getProcessingScheduler().budget.cpu);
      state.batchWorkers = Array.from({ length: workerCount }, () => createBatchWorker(job));
      state.batchWorker = state.batchWorkers[0] ?? null;
    }
    for (const worker of state.batchWorkers) dispatchBatchWork(worker);
    elements.batchStatus.textContent = `Resumed — updating ${job.total - job.completed} remaining images…`;
  } else {
    elements.batchStatus.textContent = `Pausing after ${job.active} active image${job.active === 1 ? "" : "s"}…`;
  }
  renderBatchGrid();
}

function trayStatus(item, result) {
  if (item.status === "error") return "Needs attention";
  if (item.status === "cancelled") return "Cancelled";
  if (item.status === "reading" || item.status === "waiting") return "Updating";
  if (item.override) return "Adjusted";
  return result ? "Ready" : "Updating";
}

function renderTrayPresetPicker() {
  if (!elements.trayPresetPicker) return;
  const selectedPresetId = scopedRecipeSelection();
  elements.trayPresetPicker.replaceChildren();
  if (!selectedPresetId) {
    const mixed = document.createElement("option");
    mixed.value = "";
    mixed.textContent = "Different recipes or versions";
    mixed.selected = true;
    mixed.disabled = true;
    elements.trayPresetPicker.append(mixed);
  }
  for (const preset of allPresets()) {
    const option = document.createElement("option");
    option.value = recipeKey(preset);
    option.dataset.recipeId = preset.id;
    option.dataset.recipeRevision = String(preset.style?.revision ?? "legacy");
    option.textContent = recipeLabel(preset, allPresets());
    const problem = preset.recovery ? "Saved settings for the original image. Save a reusable recipe to apply elsewhere." : legacyRecipeProblem(preset, state.capabilities); option.disabled = Boolean(problem); if (problem) option.title = problem;
    option.selected = recipeKey(preset) === selectedPresetId;
    elements.trayPresetPicker.append(option);
  }
}

function renderWorkspaceTray() {
  if (!elements.imageTray) return;
  renderPhotoLookControls();
  renderWorkspaceNavigation();
  renderRecipeScopeControls();
  renderTrayPresetPicker();
  renderTrayOutputOptions();
  const hasFiles = state.batch.files.length > 0;
  elements.imageTray.hidden = !hasFiles;
  const workspace = document.querySelector("#editor-workspace");
  workspace?.setAttribute("data-has-tray", String(hasFiles));
  if (!hasFiles) {
    elements.trayList.replaceChildren();
    elements.trayCount.textContent = "0 images";
    elements.traySelection.textContent = "Select images to download";
    elements.traySelectAllButton.disabled = true;
    elements.traySelectAllButton.textContent = "Select all";
    elements.trayCancelButton.hidden = true;
    elements.traySaveButton.disabled = true;
    return;
  }
  elements.trayCount.textContent = `${state.batch.files.length} image${state.batch.files.length === 1 ? "" : "s"}`;
  elements.trayList.replaceChildren();
  const framing = batchFramingReview();
  for (const item of state.batch.files) {
    const result = state.batch.results.get(item.id);
    const row = document.createElement("div");
    row.className = `tray-item ${item.id === state.batch.activeId ? "active" : ""}`;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "tray-item-open";
    open.setAttribute("aria-label", `Edit ${item.name}`);
    open.title = item.name;
    open.disabled = !item.width || !item.height;
    const image = document.createElement("img");
    image.src = result?.url ?? item.sourceUrl;
    image.alt = `${result ? "Result" : "Original"} ${item.name}`;
    image.loading = "lazy";
    open.append(image);
    open.addEventListener("click", () => editBatchItem(item));
    const details = document.createElement("span");
    details.className = "tray-item-details";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const status = document.createElement("span");
    status.textContent = trayStatus(item, result);
    details.append(name, status);
    if (item.presetOverride) {
      const recipe = document.createElement("span");
      recipe.className = "tray-item-recipe";
      recipe.textContent = `Recipe: ${recipeLabel(recipeForItem(item), allPresets())}`;
      details.append(recipe);
    }
    if (framing.flaggedIds.has(String(item.id))) {
      open.title = `${item.name} — review framing`;
      open.setAttribute("aria-label", `Edit ${item.name}, review framing`);
      const review = document.createElement("span");
      review.className = "tray-item-framing";
      review.textContent = "Review framing";
      details.append(review);
    }
    const selectLabel = document.createElement("label");
    selectLabel.className = "tray-select";
    const select = document.createElement("input");
    select.type = "checkbox";
    select.checked = state.batch.selected.has(item.id);
    select.disabled = !result;
    select.setAttribute("aria-label", `Select ${item.name}`);
    select.addEventListener("click", (event) => event.stopPropagation());
    select.addEventListener("change", () => {
      state.batch.selectionTouched = true;
      if (select.checked) state.batch.selected.add(item.id);
      else state.batch.selected.delete(item.id);
      renderBatchGrid();
    });
    selectLabel.append(select);
    row.append(open, details, selectLabel);
    row.addEventListener("contextmenu", (event) => openBatchImageContextMenu(event, item));
    elements.trayList.append(row);
  }
  const selectedReadyCount = selectedItems().length;
  const readyCount = state.batch.files.filter((item) => state.batch.results.has(item.id)).length;
  elements.traySelection.textContent = selectedReadyCount
    ? `${selectedReadyCount} selected to download`
    : "Select completed images to download";
  elements.trayCancelButton.hidden = true;
  elements.traySelectAllButton.disabled = readyCount === 0;
  elements.traySelectAllButton.textContent = selectedReadyCount === readyCount && readyCount > 0 ? "Clear selection" : "Select all";
  elements.traySaveButton.disabled = selectedReadyCount === 0 || state.saveInFlight || Boolean(state.individualSave);
  elements.traySaveButton.textContent = state.saveInFlight || state.individualSave ? "Saving…" : `Save selected${selectedReadyCount ? ` (${selectedReadyCount})` : ""}`;
}

function renderBatchGrid() {
  getProcessingScheduler().setRetainedBytes("batch", state.batch.files.reduce((sum, item) => sum + (item.bytes?.byteLength ?? 0), 0)
    + [...state.batch.results.values()].reduce((sum, result) => sum + (result.output?.byteLength ?? 0) * 2, 0));
  const hasFiles = state.batch.files.length > 0;
  elements.batchView.dataset.hasFiles = String(hasFiles);
  renderWorkspaceTray();
  elements.batchDropTitle.textContent = hasFiles ? "Drop more images here" : "Drop images here";
  elements.batchDropDescription.textContent = hasFiles
    ? "Add more images without losing the previews already here."
    : "See each original and result as they update.";
  elements.batchGrid.replaceChildren();
  const framing = batchFramingReview();
  if (elements.batchFramingNotice) {
    const showNotice = framing.mixedShapes && framing.flaggedIds.size > 0;
    elements.batchFramingNotice.hidden = !showNotice;
    elements.batchFramingNotice.textContent = showNotice
      ? "Some images have a different shape. Check the marked previews before downloading; you can adjust one image on the canvas."
      : "";
  }
  if (!state.batch.files.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = '<span class="empty-star" aria-hidden="true">✦</span><p>Your image previews will appear here.</p>';
    elements.batchGrid.append(empty);
  }
  for (const item of state.batch.files) {
    const result = state.batch.results.get(item.id);
    const card = document.createElement("article");
    card.className = `batch-card ${state.batch.selected.has(item.id) ? "selected" : ""}`;
    card.dataset.reviewFraming = String(framing.flaggedIds.has(String(item.id)));
    const header = document.createElement("div");
    header.className = "batch-card-header";
    const title = document.createElement("strong");
    title.className = "batch-card-title";
    title.textContent = item.name;
    title.title = item.name;
    const check = document.createElement("label");
    check.className = "batch-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.batch.selected.has(item.id);
    input.disabled = !result;
    input.addEventListener("change", () => {
      state.batch.selectionTouched = true;
      if (input.checked) state.batch.selected.add(item.id);
      else state.batch.selected.delete(item.id);
      renderBatchGrid();
    });
    check.append(input, document.createTextNode("Select"));
    header.append(title, check);
    const compare = document.createElement("div");
    compare.className = "batch-card-compare";
    compare.append(batchPane("Before", item.sourceUrl, item.name, item.status === "reading" ? "Reading…" : item.error));
    compare.append(batchPane("After", result?.url, item.name, result ? null : ["error", "cancelled"].includes(item.status) ? item.error : "Updating…"));
    const compareButton = document.createElement("button");
    compareButton.type = "button";
    compareButton.className = "batch-compare-button";
    compareButton.textContent = "Hold to compare original";
    compareButton.setAttribute("aria-label", `Compare original for ${item.name}`);
    const showOriginal = () => { card.dataset.showOriginal = "true"; };
    const showResult = () => { delete card.dataset.showOriginal; };
    compareButton.addEventListener("pointerdown", showOriginal);
    compareButton.addEventListener("pointerup", showResult);
    compareButton.addEventListener("pointercancel", showResult);
    compareButton.addEventListener("pointerleave", showResult);
    compareButton.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") showOriginal();
    });
    compareButton.addEventListener("keyup", (event) => {
      if (event.key === " " || event.key === "Enter") showResult();
    });
    const meta = document.createElement("div");
    meta.className = "batch-card-meta";
    const destination = document.createElement("span");
    const activePreset = recipeForItem(item);
    const effectiveFormat = effectiveOperationsForItem(item, activePreset).format;
    destination.textContent = `${recipeLabel(activePreset, allPresets())} · ${formatLabel(result?.format ?? effectiveFormat)}`;
    card.dataset.recipeKey = recipeKey(activePreset);
    meta.append(destination);
    if (result) {
      const size = document.createElement("span");
      size.textContent = `${result.width} × ${result.height} · ${formatBytes(result.outputBytes)} · ${formatSizeChange(item.file.size, result.outputBytes)}`;
      size.title = `Original file: ${formatBytes(item.file.size)}. Output file: ${formatBytes(result.outputBytes)}.`;
      meta.append(size);
    }
    if (framing.flaggedIds.has(String(item.id))) {
      const review = document.createElement("span");
      review.className = "framing-chip";
      review.textContent = "Review framing";
      review.title = "This source has a different shape from another image in the set; check the crop on the canvas.";
      meta.append(review);
    }
    if (item.override) {
      const override = document.createElement("span");
      override.className = "override-chip";
      override.textContent = "Edited for this image";
      meta.append(override);
    }
    if (item.presetOverride) {
      const recipeOverride = document.createElement("span");
      recipeOverride.className = "override-chip recipe-override-chip";
      recipeOverride.textContent = activePreset.recovery ? "Recovered image settings" : "Different destination";
      meta.append(recipeOverride);
    }
    const more = document.createElement("details");
    more.className = "batch-card-more";
    const moreSummary = document.createElement("summary");
    moreSummary.setAttribute("aria-label", `More actions for ${item.name}`);
    moreSummary.textContent = "…";
    const actions = document.createElement("div");
    actions.className = "batch-card-actions";
    addButton(actions, "Edit on canvas", "button secondary", () => editBatchItem(item));
    if (["error", "cancelled"].includes(item.status)) addButton(actions, "Retry", "button secondary", () => retryBatchItem(item));
    addButton(actions, "Remove image", "button secondary", () => removeBatchItem(item));
    if (item.override) {
      addButton(actions, activePreset.recovery ? "Reset to recovered edits" : "Reset to preset", "button secondary", () => resetBatchOverride(item));
    }
    if (item.presetOverride) {
      addButton(actions, "Use shared destination", "button secondary", () => resetBatchRecipe(item));
    }
    addButton(actions, item.override ? "Save adjustment as recipe" : "Save image as recipe", "button secondary", () => saveBatchImageRecipe(item));
    addButton(actions, "Apply recipe to selected", "button secondary", () => focusSelectedRecipePicker(item));
    if (result) addButton(actions, `Download ${formatLabel(result.format)}`, "button secondary", () => saveSingleBatchItem(item));
    more.append(moreSummary, actions);
    card.append(header, compare, compareButton, meta, more);
    card.addEventListener("contextmenu", (event) => openBatchImageContextMenu(event, item));
    elements.batchGrid.append(card);
  }
  const readyCount = state.batch.files.filter((item) => state.batch.results.has(item.id)).length;
  const selectedReadyCount = state.batch.files.filter((item) => state.batch.selected.has(item.id) && state.batch.results.has(item.id)).length;
  elements.batchSelectAll.disabled = readyCount === 0;
  elements.batchClear.disabled = !hasFiles;
  elements.batchClearCompleted.disabled = readyCount === 0 || state.batch.processing;
  elements.batchCancel.hidden = !state.batch.processing;
  renderBatchJobBar();
  elements.batchSave.disabled = selectedReadyCount === 0 || state.saveInFlight || Boolean(state.individualSave);
  elements.batchSelectAll.textContent = selectedReadyCount === readyCount && readyCount > 0 ? "Clear selection" : "Select all";
  elements.batchSave.textContent = state.saveInFlight || state.individualSave
    ? "Saving…"
    : selectedReadyCount === 1 ? "Save image" : `Save ${selectedReadyCount || "selected"} images`;
  elements.batchSelectionCount.textContent = selectedReadyCount
    ? `${selectedReadyCount} selected to download`
    : state.batch.selected.size
      ? `${state.batch.selected.size} selected · waiting for results`
      : "Select completed images to download";
  scheduleSessionSave();
}

function batchPane(label, url, name, placeholder) {
  const pane = document.createElement("div");
  pane.className = `batch-pane batch-pane-${label.toLowerCase()}`;
  const paneLabel = document.createElement("span");
  paneLabel.className = "batch-pane-label";
  paneLabel.textContent = label;
  pane.append(paneLabel);
  if (url) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = `${label} ${name}`;
    image.loading = "lazy";
    pane.append(image);
  } else {
    const empty = document.createElement("span");
    empty.className = "batch-placeholder";
    empty.textContent = placeholder ?? "Waiting…";
    pane.append(empty);
  }
  return pane;
}

function saveBatchImageRecipe(item) {
  if (!item?.bytes || !item.width || !item.height) {
    elements.batchStatus.textContent = "Wait until this image is ready before saving its recipe.";
    return;
  }
  const preset = recipeForItem(item);
  const isOverride = Boolean(item.override);
  openPresetDialog(
    effectiveOperationsForItem(item, preset),
    item.width,
    item.height,
    `${item.name.replace(/\.[^.]+$/, "")} ${isOverride ? "adjustment" : "recipe"}`,
    {
      kind: isOverride ? "batch-override" : "batch-image",
      fileId: item.id,
      presetId: preset.id,
      recipeKey: recipeKey(preset),
      ...(isOverride ? {
        sharedOperations: sharedOperationsForItem(item, preset),
        overridePatch: clone(item.override),
      } : {}),
    },
  );
}

function focusSelectedRecipePicker(item) {
  if (!state.batch.selected.has(item.id)) {
    state.batch.selected.clear();
    state.batch.selected.add(item.id);
  }
  state.batch.selectionTouched = true;
  state.batch.activeId = item.id;
  state.batch.recipeScope = "selected";
  renderBatchPresetPicker();
  renderWorkspaceTray();
  renderBatchGrid();
  (elements.batchPresetPicker.querySelector("button:not(:disabled)") ?? elements.batchPresetPicker).focus?.({ preventScroll: true });
}

function applyContextRecipe(preset, projectId, selectedIds) {
  if (state.batch.projectId !== projectId) {
    elements.batchStatus.textContent = "The image page changed. Open its context menu again to choose targets.";
    return;
  }
  const currentIds = selectedIds.filter((id) => state.batch.files.some((item) => item.id === id));
  if (!currentIds.length) {
    elements.batchStatus.textContent = "Those images are no longer on this page.";
    return;
  }
  state.batch.selected.clear();
  for (const id of currentIds) state.batch.selected.add(id);
  state.batch.selectionTouched = true;
  state.batch.activeId = currentIds.includes(state.batch.activeId) ? state.batch.activeId : currentIds[0];
  state.batch.recipeScope = "selected";
  renderBatchPresetPicker();
  renderWorkspaceTray();
  try {
    applyPresetToScope(recipeKey(preset));
  } catch (error) {
    elements.batchStatus.textContent = error.message || "This recipe could not be applied.";
  }
}

function openBatchImageContextMenu(event, item) {
  event.preventDefault();
  if (!state.batch.selected.has(item.id)) {
    state.batch.selected.clear();
    state.batch.selected.add(item.id);
    state.batch.selectionTouched = true;
    state.batch.activeId = item.id;
    renderBatchGrid();
  }
  const projectId = state.batch.projectId;
  const selectedIds = [...state.batch.selected];
  const recipes = allPresets().filter((preset) => !preset.recovery);
  const items = [
    { type: "heading", label: `${selectedIds.length} image${selectedIds.length === 1 ? "" : "s"} selected` },
    { label: item.override ? "Save this adjustment as recipe…" : "Save this image as recipe…", disabled: !item.bytes || !item.width || !item.height, action: () => saveBatchImageRecipe(item) },
    { type: "separator" },
    { type: "heading", label: "Apply recipe to selection" },
    ...recipes.map((preset) => {
      const problem = legacyRecipeProblem(preset, state.capabilities);
      return {
        label: recipeLabel(preset, allPresets()),
        disabled: Boolean(problem),
        title: problem || undefined,
        action: () => applyContextRecipe(preset, projectId, selectedIds),
      };
    }),
  ];
  openContextMenu({ x: event.clientX, y: event.clientY, anchor: event.currentTarget, items });
}

function renderBatchJobBar() {
  const job = state.batch.job;
  elements.batchJobBar.hidden = !job;
  if (!job) {
    if (batchJobMetricsTimer != null) window.clearInterval(batchJobMetricsTimer);
    batchJobMetricsTimer = null;
    return;
  }
  if (batchJobMetricsTimer == null) {
    batchJobMetricsTimer = window.setInterval(() => {
      if (state.batch.job !== job) {
        window.clearInterval(batchJobMetricsTimer);
        batchJobMetricsTimer = null;
        return;
      }
      renderBatchJobBar();
    }, 1000);
  }
  const elapsed = Math.max(.001, (performance.now() - job.startedAt) / 1000);
  const rate = job.completed / elapsed;
  const remaining = Math.max(0, job.total - job.completed);
  const eta = rate > 0 && remaining ? Math.ceil(remaining / rate) : null;
  const etaLabel = eta == null ? "estimating time" : eta < 60 ? `${eta}s left` : `${Math.floor(eta / 60)}m ${eta % 60}s left`;
  elements.batchJobTitle.textContent = job.paused
    ? job.active ? "Pausing recipe job" : "Recipe job paused"
    : job.label;
  elements.batchJobStatus.textContent = job.paused && job.active
    ? `Finishing ${job.active} active image${job.active === 1 ? "" : "s"} before pausing.`
    : job.paused ? "No new images will start until you resume."
      : job.active ? `Processing ${job.active} image${job.active === 1 ? "" : "s"}; ${job.queue.length} waiting.`
        : "Preparing the next image…";
  elements.batchJobProgress.max = Math.max(1, job.total);
  elements.batchJobProgress.value = Math.min(job.completed, job.total);
  elements.batchJobMetrics.textContent = `${job.completed} of ${job.total} · ${rate < 1 ? "<1" : rate.toFixed(1)} images/s · ${etaLabel}`;
  elements.batchJobPause.textContent = job.paused ? job.active ? "Pausing…" : "Resume" : "Pause";
  elements.batchJobPause.disabled = Boolean(job.paused && job.active);
  elements.batchJobSpeed.value = getProcessingScheduler().mode;
}

function downloadBytes(bytes, mime, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function selectedItems() {
  return state.batch.files.filter((item) => state.batch.selected.has(item.id) && state.batch.results.has(item.id));
}

function saveSingleBatchItem(item) {
  const result = state.batch.results.get(item.id);
  if (!result) return;
  downloadBytes(result.output, result.mime, downloadedFileName(item.name, recipeForItem(item).name, result.format));
  elements.batchStatus.textContent = `Download started for the selected ${formatLabel(result.format)} image.`;
}

function directFolderPicker() {
  if (globalThis.__tinystarDisableDirectorySave === true) return null;
  return globalThis.__tinystarDirectoryPicker ?? globalThis.showDirectoryPicker;
}

async function createUniqueOutputFolder(base, preferredName) {
  for (let index = 0; index < 1000; index += 1) {
    const name = index === 0 ? preferredName : `${preferredName}-${index + 1}`;
    try {
      await base.getDirectoryHandle(name);
    } catch (error) {
      if (error?.name !== "NotFoundError") throw error;
      return { name, handle: await base.getDirectoryHandle(name, { create: true }) };
    }
  }
  throw new Error("A unique output folder could not be created.");
}

async function saveResultsToFolder(items, destination, timestamp) {
  const chooseDirectory = directFolderPicker();
  if (typeof chooseDirectory !== "function") return false;
  const base = await chooseDirectory.call(globalThis, { id: "tiny-image-star-selected-output", mode: "readwrite", startIn: "pictures" });
  const { name: folderName, handle: folder } = await createUniqueOutputFolder(base, exportFolderName(destination, timestamp));
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const result = state.batch.results.get(item.id);
    if (!result) throw new Error(`The result for ${item.name} is no longer available.`);
    const name = `${String(index + 1).padStart(3, "0")}-${downloadedFileName(item.name, recipeForItem(item).name, result.format, timestamp)}`;
    const handle = await folder.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(result.output);
      await writable.close();
    } catch (error) {
      await writable.abort?.().catch?.(() => {});
      throw error;
    }
    elements.batchStatus.textContent = `Saved ${index + 1} of ${items.length} images into ${folderName}…`;
  }
  return { folderName, savedCount: items.length };
}

function renderIndividualSaveQueue() {
  const queue = state.individualSave;
  if (!queue) return;
  const completed = queue.index;
  const total = queue.itemIds.length;
  const item = state.batch.files.find((candidate) => candidate.id === queue.itemIds[completed]);
  const result = item ? state.batch.results.get(item.id) : null;
  const nextName = item && result
    ? `${String(completed + 1).padStart(3, "0")}-${downloadedFileName(item.name, recipeForItem(item).name, result.format, queue.timestamp)}`
    : "";
  elements.individualSaveProgress.textContent = `${completed} of ${total} downloads started`;
  elements.individualSaveMeter.max = total;
  elements.individualSaveMeter.value = completed;
  elements.individualSaveName.textContent = completed === total ? "All selected images" : nextName;
  elements.individualSaveNext.hidden = completed === total;
  elements.individualSaveNext.disabled = !item || !result || queue.revision !== state.batch.revision;
  elements.individualSaveNext.textContent = `Save next image (${Math.min(completed + 1, total)} of ${total})`;
  elements.individualSaveClose.textContent = completed === total ? "Done" : "Close";
  if (completed === total) {
    elements.individualSaveStatus.textContent = `All ${total} downloads started. Your browser chooses their Downloads location.`;
  } else if (queue.revision !== state.batch.revision || !item || !result) {
    elements.individualSaveStatus.textContent = "The image set changed, so this save queue has stopped. Close it and select the images again.";
  }
}

function openIndividualSaveQueue(items, timestamp, revision) {
  state.individualSave = {
    itemIds: items.map((item) => item.id),
    index: 0,
    timestamp,
    revision,
  };
  elements.individualSaveStatus.textContent = "Each click starts one download, so your browser will not block the rest.";
  renderIndividualSaveQueue();
  elements.individualSaveDialog.showModal();
}

function saveNextIndividualResult() {
  const queue = state.individualSave;
  if (!queue || queue.revision !== state.batch.revision) {
    renderIndividualSaveQueue();
    return;
  }
  const item = state.batch.files.find((candidate) => candidate.id === queue.itemIds[queue.index]);
  const result = item ? state.batch.results.get(item.id) : null;
  if (!item || !result) {
    renderIndividualSaveQueue();
    return;
  }
  const name = `${String(queue.index + 1).padStart(3, "0")}-${downloadedFileName(item.name, recipeForItem(item).name, result.format, queue.timestamp)}`;
  downloadBytes(result.output, result.mime, name);
  queue.index += 1;
  elements.individualSaveStatus.textContent = `Download started for ${name}.`;
  elements.batchStatus.textContent = `Started ${queue.index} of ${queue.itemIds.length} selected downloads.`;
  renderIndividualSaveQueue();
}

async function saveSelected() {
  const items = selectedItems();
  if (!items.length) {
    elements.batchStatus.textContent = "Select a completed preview first.";
    return;
  }
  if (items.length === 1) {
    saveSingleBatchItem(items[0]);
    return;
  }
  if (state.saveInFlight) {
    elements.batchStatus.textContent = "The selected images are already being saved.";
    return;
  }
  const destinationNames = [...new Set(items.map((item) => recipeForItem(item).name))];
  const destination = destinationNames.length === 1 ? destinationNames[0] : "selected-images";
  const timestamp = new Date();
  const revision = state.batch.revision;
  state.saveInFlight = true;
  elements.batchStatus.textContent = `Choose where to save ${items.length} images…`;
  renderBatchGrid();
  try {
    const savedToFolder = await saveResultsToFolder(items, destination, timestamp);
    if (revision !== state.batch.revision) {
      elements.batchStatus.textContent = "Saving stopped because the image set changed.";
      return;
    }
    if (savedToFolder) {
      elements.batchStatus.textContent = `Saved ${savedToFolder.savedCount} images directly into ${savedToFolder.folderName}.`;
    } else {
      openIndividualSaveQueue(items, timestamp, revision);
      elements.batchStatus.textContent = `This browser cannot create an output folder. Save the ${items.length} selected images one by one.`;
    }
  } catch (error) {
    if (revision === state.batch.revision && error?.name !== "AbortError") elements.batchStatus.textContent = "The selected images could not be saved. Check folder permission and available space, then try again.";
  } finally {
    state.saveInFlight = false;
    renderBatchGrid();
  }
}

function batchEditorContext(item, preset = null) {
  const recipe = preset ?? recipeForItem(item);
  const sharedOperations = sharedOperationsForItem(item, recipe);
  return {
    kind: "batch",
    fileId: item.id,
    presetId: recipe.id,
    recipeKey: recipeKey(recipe),
    ...(recipe.style ? { style: clone(recipe.style) } : {}),
    batchPresetId: state.batch.presetId,
    sharedOperations,
    overridePatch: clone(item.override),
    effectiveOperations: clone(effectiveOperationsForItem(item, recipe)),
  };
}

function captureCurrentBatchEditorOverride() {
  const snapshot = window.tinyImageStarEditor?.getSnapshot?.();
  const context = snapshot?.context;
  if (!context || context.kind !== "batch") return;
  const item = state.batch.files.find((candidate) => candidate.id === context.fileId);
  if (!item || !snapshot.operations) return;
  const shared = context.sharedOperations ?? sharedOperationsForItem(item, presetById(context.presetId, context.recipeKey));
  const initialEffective = context.effectiveOperations
    ?? mergeOperationConfig(shared, context.overridePatch ?? item.override);
  item.override = mergeOverridePatch(
    shared,
    context.overridePatch ?? item.override,
    initialEffective,
    snapshot.operations,
  );
}

function refreshActiveBatchEditor() {
  const snapshot = window.tinyImageStarEditor?.getSnapshot?.();
  const context = snapshot?.context;
  if (!context || context.kind !== "batch") return;
  const item = state.batch.files.find((candidate) => candidate.id === context.fileId);
  if (!item) return;
  const preset = recipeForItem(item);
  const operations = effectiveOperationsForItem(item, preset);
  window.tinyImageStarEditor.loadFile(item.file, operations, batchEditorContext(item, preset));
}

function editBatchItem(item) {
  if (!item?.width || !item?.height) {
    elements.batchStatus.textContent = "That image is still getting ready.";
    return;
  }
  state.batch.activeId = item.id;
  renderWorkspaceTray();
  const preset = recipeForItem(item);
  const sharedOperations = sharedOperationsForItem(item, preset);
  const operations = effectiveOperationsForItem(item, preset);
  window.tinyImageStarEditor.loadFile(item.file, operations, {
    ...batchEditorContext(item, preset),
    sharedOperations,
  });
  showView("editor");
}

function openActiveBatchItemIfNeeded() {
  const snapshot = window.tinyImageStarEditor?.getSnapshot?.();
  if (snapshot?.file || !state.batch.files.length) return false;
  const usable = state.batch.files.filter((item) => item.status !== "error");
  const active = usable.find((item) => item.id === state.batch.activeId)
    ?? usable.find((item) => state.batch.selected.has(item.id))
    ?? usable[0];
  if (!active) return false;
  editBatchItem(active);
  return true;
}

function resetBatchOverride(item) {
  item.override = clone(recipeForItem(item).recovery?.originalOverride ?? null);
  if (state.batch.activeId === item.id) refreshActiveBatchEditor();
  runBatch([item]);
}

function resetBatchRecipe(item) {
  item.presetOverride = null;
  item.recipeKeyOverride = null;
  if (state.batch.activeId === item.id) refreshActiveBatchEditor();
  runBatch([item]);
}

function returnFromEditor(event) {
  const detail = event.detail;
  if (!detail?.context) return;
  if (detail.context.kind !== "batch") return;
  const item = state.batch.files.find((candidate) => candidate.id === detail.context.fileId);
  if (!item) return;
  const shared = detail.context.sharedOperations
    ?? detail.context.baseOperations
    ?? sharedOperationsForItem(item, recipeForItem(item));
  const initialEffective = detail.context.effectiveOperations
    ?? mergeOperationConfig(shared, detail.context.overridePatch ?? item.override);
  // Merge only changes made during this canvas session into the existing
  // per-image patch. Untouched values continue to come from the current
  // shared recipe if the batch destination changed while the canvas was open.
  item.override = mergeOverridePatch(
    shared,
    detail.context.overridePatch ?? item.override,
    initialEffective,
    detail.operations,
  );
  state.batch.activeId = item.id;
  window.tinyImageStarEditor.loadFile(item.file, effectiveOperationsForItem(item), batchEditorContext(item));
  showView("batch");
  renderWorkspaceTray();
  runBatch([item]);
}

function onEditorLoaded() {
  if (!state.pendingPresetId) return;
  const pending = state.pendingPresetSelection, preset = pending?.preset ?? presetById(state.pendingPresetId);
  state.pendingPresetId = null;
  state.pendingPresetSelection = null;
  const problem = legacyRecipeProblem(preset, state.capabilities);
  if (problem) { state.presetMigrationMessage = problem; renderPresetList(); return; }
  const snapshot = window.tinyImageStarEditor.getSnapshot();
  const operations = normalizePresetOperations(legacyRecipeOperations(preset), snapshot.imageWidth, snapshot.imageHeight);
  try { window.tinyImageStarEditor.replaceOperations(operations, pending?.context ?? presetEditContext(preset)); }
  catch (error) { catalogFailure(error); }
}

function applyCapabilities(raw) {
  state.capabilities = normalizeCapabilities(raw);
  // A capability handshake describes what can run; it cannot change saved
  // output intent. Unsupported settings stay visible until explicitly replaced.
  const accept = formatAccept(state.capabilities.inputFormats);
  elements.batchFileInput.accept = accept;
  elements.batchFolderInput.accept = accept;
  renderPresetList();
  renderBatchPresetPicker();
  renderImportCapacity();
  if (state.batch.files.length) runBatch();
}

elements.presetStart.addEventListener("click", () => {
  closePresets();
  showView("editor");
  const snapshot = window.tinyImageStarEditor?.getSnapshot?.();
  document.querySelector(snapshot?.file ? "#open-button" : "#empty-open-button")?.click();
});
elements.closePresets.addEventListener("click", closePresets);
elements.presetsView.addEventListener("click", (event) => {
  if (event.target === elements.presetsView) closePresets();
});
elements.batchOpen.addEventListener("click", () => elements.batchFileInput.click());
elements.batchFolder.addEventListener("click", () => {
  if (supportsLargeFolderJobs()) {
    void state.folderJobs?.openAndChooseSource?.();
    return;
  }
  state.folderImportFromEditor = false;
  elements.batchFolderInput.click();
});
elements.batchClose?.addEventListener("click", () => {
  state.folderJobActive = false;
  state.folderJobs?.deactivate?.();
  showView("editor");
});
window.addEventListener("resize", syncReviewOffset);
elements.batchFileInput.addEventListener("change", () => {
  const files = Array.from(elements.batchFileInput.files ?? []);
  elements.batchFileInput.value = "";
  importBatchFiles(files, { focusFirst: state.batch.files.length === 0 });
});
elements.batchFolderInput.addEventListener("change", () => {
  const files = Array.from(elements.batchFolderInput.files ?? []);
  elements.batchFolderInput.value = "";
  const focusFirst = state.folderImportFromEditor || state.batch.files.length === 0;
  state.folderImportFromEditor = false;
  importBatchFiles(files, { focusFirst });
});
elements.batchCancel.addEventListener("click", cancelActiveBatch);
elements.batchJobPause.addEventListener("click", toggleBatchPause);
elements.batchClearCompleted.addEventListener("click", clearCompletedBatchItems);
elements.batchClear.addEventListener("click", startNewBatch);
elements.batchFormat.addEventListener("change", () => setBatchFormat(elements.batchFormat.value));
elements.batchLossy?.addEventListener("change", () => setBatchLossy(elements.batchLossy.checked));
elements.batchQuality?.addEventListener("change", () => setBatchQuality(elements.batchQuality.value));
elements.batchFormatReset.addEventListener("click", () => setBatchFormat(""));
elements.trayFormat?.addEventListener("change", () => setBatchFormat(elements.trayFormat.value));
elements.trayLossy?.addEventListener("change", () => setBatchLossy(elements.trayLossy.checked));
elements.trayQuality?.addEventListener("change", () => setBatchQuality(elements.trayQuality.value));
elements.batchScope?.addEventListener("change", () => setRecipeScope(elements.batchScope.value));
elements.trayScope?.addEventListener("change", () => setRecipeScope(elements.trayScope.value));
elements.trayApplyEdits?.addEventListener("click", applyCurrentEditsToScope);
elements.presetFormat.addEventListener("change", syncPresetCompression);
elements.presetLossy.addEventListener("change", syncPresetCompression);
elements.presetDestination.addEventListener("change", applyPresetDestinationToDialog);
for (const field of [elements.presetWidth, elements.presetHeight]) {
  field.addEventListener("input", () => {
    if (state.pendingSave) elements.presetDestination.value = "custom";
  });
}
elements.batchDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.batchDropZone.dataset.dragging = "true";
});
elements.batchDropZone.addEventListener("dragleave", () => delete elements.batchDropZone.dataset.dragging);
elements.batchDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  delete elements.batchDropZone.dataset.dragging;
  importBatchFiles(event.dataTransfer?.files);
});
elements.batchDropZone.addEventListener("click", () => elements.batchFileInput.click());
elements.batchDropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.batchFileInput.click();
  }
});
elements.batchSelectAll.addEventListener("click", () => {
  const ready = state.batch.files.filter((item) => state.batch.results.has(item.id));
  if (state.batch.selected.size === ready.length) state.batch.selected.clear();
  else for (const item of ready) state.batch.selected.add(item.id);
  state.batch.selectionTouched = true;
  renderBatchGrid();
});
elements.batchSave.addEventListener("click", saveSelected);
elements.trayAddButton?.addEventListener("click", () => elements.batchFileInput.click());
elements.trayPresetPicker?.addEventListener("change", () => {
  if (elements.trayPresetPicker.value) applyPresetToScope(elements.trayPresetPicker.value);
});
elements.traySelectAllButton?.addEventListener("click", () => {
  const readyItems = state.batch.files.filter((item) => state.batch.results.has(item.id));
  state.batch.selectionTouched = true;
  if (readyItems.length && readyItems.every((item) => state.batch.selected.has(item.id))) {
    for (const item of readyItems) state.batch.selected.delete(item.id);
  } else {
    for (const item of readyItems) state.batch.selected.add(item.id);
  }
  renderBatchGrid();
});
elements.trayCancelButton?.addEventListener("click", cancelActiveBatch);
elements.traySaveButton?.addEventListener("click", saveSelected);
elements.individualSaveNext?.addEventListener("click", saveNextIndividualResult);
elements.individualSaveDialog?.addEventListener("close", () => {
  const queue = state.individualSave;
  if (queue && queue.index < queue.itemIds.length) {
    elements.batchStatus.textContent = `Stopped after ${queue.index} of ${queue.itemIds.length} selected downloads were started.`;
  }
  state.individualSave = null;
  renderBatchGrid();
});
elements.sessionRestore?.addEventListener("click", () => {
  void restoreSession();
});
for (const id of ["photo-look-open", "batch-photo-look"]) document.getElementById(id).addEventListener("click", choosePhotoLook);
elements.batchTextStamp?.addEventListener("click", chooseCreatorStamp);
elements.trayTextStamp?.addEventListener("click", chooseCreatorStamp);
for (const id of ["photo-look-undo", "batch-photo-look-undo"]) document.getElementById(id).addEventListener("click", undoPhotoLook);
elements.sessionCurrentRecipes.addEventListener("click", () => { void restoreSession({ missingRecipe: "current" }); });
elements.sessionOriginals.addEventListener("click", () => { void restoreSession({ missingRecipe: "originals" }); });
elements.sessionBackup.addEventListener("click", () => { document.querySelector("#local-data-button").click(); });
elements.sessionClear?.addEventListener("click", () => {
  const pending = state.session.pending;
  forgetPendingSession();
  void (pending?.kind === "editor" ? clearEditorSession() : clearSession());
});
elements.sessionLater?.addEventListener("click", forgetPendingSession);
elements.presetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    state.catalogMutation?.abort();
    elements.presetDialog.close();
    state.pendingSave = null;
    return;
  }
  void savePresetFromDialog();
});
window.addEventListener("tinystar:show-presets", () => showView("presets"));
window.addEventListener("tinystar:show-batch", () => showView("batch"));
window.addEventListener("tinystar:show-results", () => {
  captureCurrentBatchEditorOverride();
  state.folderJobs?.deactivate?.();
  state.folderJobActive = false;
  showView("batch");
});
window.addEventListener("tinystar:add-images", () => {
  showView("editor");
  elements.batchFileInput?.click();
});
window.addEventListener("tinystar:choose-folder", () => {
  if (supportsLargeFolderJobs()) {
    void state.folderJobs?.openAndChooseSource?.();
    return;
  }
  state.folderImportFromEditor = true;
  elements.batchFolderInput?.click();
});
window.addEventListener("tinystar:open-batch", (event) => {
  showView("editor");
  importBatchFiles(event.detail?.files ?? [], { focusFirst: true });
  window.tinyImageStarPendingFiles = null;
});
window.addEventListener("tinystar:paste-images", (event) => {
  const files = event.detail?.files ?? window.tinyImageStarPendingFiles ?? [];
  window.tinyImageStarPendingFiles = null;
  showView("editor");
  importBatchFiles(files, { focusFirst: state.batch.files.length === 0 });
});
window.addEventListener("tinystar:show-editor", () => {
  showView("editor");
  openActiveBatchItemIfNeeded();
});
window.addEventListener("tinystar:save-preset", () => {
  const snapshot = window.tinyImageStarEditor?.getSnapshot();
  if (!snapshot?.operations || !snapshot.imageWidth) return;
  openPresetDialog(snapshot.operations, snapshot.imageWidth, snapshot.imageHeight, "My image recipe", snapshot.context);
});
window.addEventListener("tinystar:editor-return", returnFromEditor);
window.addEventListener("tinystar:editor-loaded", onEditorLoaded);
window.addEventListener("tinystar:editor-loaded", renderApplyCurrentEdits);
window.addEventListener("tinystar:editor-changed", () => {
  clearTimeout(state.editorSyncTimer);
    state.editorSyncTimer = setTimeout(() => {
      state.editorSyncTimer = null;
      const edit = currentCanvasEdit();
      if (!edit?.relativePatch) {
        renderApplyCurrentEdits();
        return;
      }
    captureCurrentBatchEditorOverride();
    renderWorkspaceTray();
    renderBatchGrid();
    void runBatch([edit.item]);
    if (edit.relativePatch && state.batch.files.length > 1) {
      elements.batchStatus.textContent = `Updated ${edit.item.name}. Apply the current edits to all or selected images when ready.`;
    }
    scheduleSessionSave(0);
  }, 180);
});
window.addEventListener("tinystar:local-data-clearing", () => {
  state.catalogMutation?.abort(); state.catalogRead++; state.failedCatalogCommand = null; state.presetMigrationMessage = "";
  clearTimeout(state.session.saveTimer);
  state.session.suppress = true;
});
window.addEventListener("tinystar:local-data-cleared", () => {
  state.session.suppress = false;
  state.customPresets = [];
  // Clearing saved data does not change recipes or corrections in open work.
  if (!state.batch.files.length) {
    state.batch.frozenRecipes = [];
    state.activePresetId = state.batch.presetId = "keep-original";
    state.activeRecipeKey = state.batch.recipeKey = null;
  }
  state.session.pending = null;
  setSessionRecoveryVisible(false);
  renderPresetList();
  renderBatchPresetPicker();
  void refreshRecipeCatalog();
});
window.addEventListener(STYLE_CHANGE_EVENT, () => { if (!state.session.suppress) void refreshRecipeCatalog(); });
window.addEventListener("storage", (event) => { if (event.key === LEGACY_RECIPES_KEY || event.key === null) void refreshRecipeCatalog(); });
window.addEventListener("tinystar:capabilities", (event) => applyCapabilities(event.detail));
window.addEventListener("tinystar:recovery-read-error", (event) => {
  if (elements.sessionRecoveryMessage) elements.sessionRecoveryMessage.textContent = `${event.detail.message} Use Local data to back up the saved work before clearing it.`;
  if (elements.sessionRestore) elements.sessionRestore.disabled = true;
  setSessionRecoveryVisible(true);
});
window.addEventListener("tinystar:recovery-write-error", () => {
  elements.batchStatus.textContent = "Recovery could not be saved. Your open images are still available; use Local data to back up saved work.";
});
window.addEventListener("keydown", (event) => {
  if (state.presetsOpen && event.key === "Escape") {
    event.preventDefault();
    closePresets();
    return;
  }
  const typing = event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement
    || event.target?.isContentEditable;
  const dialogOpen = Boolean(document.querySelector("dialog[open]"));
  const commandSave = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
  if (event.defaultPrevented || typing || dialogOpen || state.view !== "batch" || elements.batchView.hidden || !commandSave) return;
  event.preventDefault();
  if (elements.batchSave.disabled) {
    elements.batchStatus.textContent = "Select a finished image to download.";
    return;
  }
  saveSelected();
});

void refreshRecipeCatalog();
state.folderJobs = attachLargeFolderJobs({
  listRecipes: () => allPresets().filter((recipe) => !recipe.recovery),
  getDefaultRecipeId: () => state.batch.presetId ?? state.activePresetId,
  getDefaultRecipeKey: () => recipeKey(batchPreset()),
  getCapabilities: () => state.capabilities,
  onActiveChange: (active) => {
    state.folderJobActive = active;
    if (active) showView("batch");
  },
  onJobChange: () => renderWorkspaceNavigation(),
});
elements.folderJobButton?.addEventListener("click", () => state.folderJobs?.activate?.());
applyCapabilities(state.capabilities);

renderPresetList();
renderBatchPresetPicker();
void offerSessionRecovery();
if (window.tinyImageStarPendingFiles?.length) {
  const pendingFiles = window.tinyImageStarPendingFiles;
  window.tinyImageStarPendingFiles = null;
  showView("editor");
  importBatchFiles(pendingFiles, { focusFirst: true });
}
