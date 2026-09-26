// Serializable edit operations, history, and inspector control mutations.
import { formatLabel } from "../formats.js";
import { normalizeQuality } from "../quality.js";

export function attachEditorOperations(editor) {
  const { elements, state } = editor;

  function rememberChange(before) {
    if (!before) return;
    editor.commitProjectEdit();
    editor.renderDirtyAndHistory();
  }

  function commitOperations(next, message = "Preview updated.") {
    const before = editor.cloneOperations();
    state.operations = editor.cloneOperations(next);
    rememberChange(before);
    editor.updateInspector();
    editor.renderCanvas();
    editor.setProcessingStatus(message);
    editor.scheduleProcessing();
  }

  function undo() {
    if (!editor.projectUndo()) return;
    state.controlEditBefore = null;
    editor.updateInspector();
    editor.renderDirtyAndHistory();
    editor.renderCanvas();
    editor.setProcessingStatus("Undoing the last change…", true);
    editor.scheduleProcessing();
  }

  function redo() {
    if (!editor.projectRedo()) return;
    state.controlEditBefore = null;
    editor.updateInspector();
    editor.renderDirtyAndHistory();
    editor.renderCanvas();
    editor.setProcessingStatus("Restoring the next change…", true);
    editor.scheduleProcessing();
  }

  function resetOperations() {
    if (!state.image) return;
    const activeTool = state.tool;
    // In a set, the clean starting point already includes the shared recipe
    // and any saved correction for this image. Reset only the changes made in
    // the current canvas session; it must not silently discard that context.
    commitOperations(state.savedOperations ?? editor.defaultOperations(), "Current image changes reset.");
    state.cropDraft = null;
    state.cropAspect = null;
    state.tool = activeTool === "crop" ? "size" : activeTool;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    editor.renderAll();
  }

  function editWith(mutator, message) {
    const next = editor.cloneOperations();
    mutator(next);
    commitOperations(next, message);
  }

  function adjustRotation(amount) {
    editWith((next) => { next.rotation = (next.rotation + amount + 360) % 360; }, "Rotation updated. Updating preview…");
  }

  function toggleFlip(axis) {
    editWith((next) => { next[axis] = !next[axis]; }, "Flip updated. Updating preview…");
  }

  function setResizeMode(mode) {
    editWith((next) => { next.resizeMode = mode; }, `${mode === "crop" ? "Fill frame" : "Keep whole image"} selected. Updating preview…`);
  }

  function applyDestination(destination) {
    if (!destination || !state.image) return;
    editWith((next) => {
      next.presetId = destination.id;
      next.presetName = destination.name;
      next.resizeMode = destination.mode;
      next.resizeWidth = destination.width ?? state.image.naturalWidth;
      next.resizeHeight = destination.height ?? state.image.naturalHeight;
      next.aspectLocked = true;
      // Choosing a named destination starts a fresh automatic frame. A manual
      // crop remains available through Crop and can then be saved as an item
      // override or recipe.
      next.crop = null;
    }, `${destination.name} selected. Updating preview…`);
  }

  function setFormat(format) {
    if (!state.capabilities.outputFormats.includes(format)) return;
    editWith((next) => {
      next.format = format;
      // Format choice and compression choice are separate user decisions.
      // Preserve an explicit lossy choice only when the new format can honor
      // it; selecting JPEG/WebP must not silently turn compression on.
      next.lossy = Boolean(next.lossy && state.capabilities.compression.lossyFormats.includes(format));
    }, `${formatLabel(format)} selected. Updating preview…`);
  }

  function setLossy(enabled) {
    const lossyFormats = state.capabilities.compression.lossyFormats;
    if (!lossyFormats.length) return;
    editWith((next) => {
      next.lossy = Boolean(enabled);
      if (enabled && !lossyFormats.includes(next.format)) next.format = lossyFormats[0];
    }, enabled ? "Smaller file selected. Updating preview…" : "Full-quality output selected. Updating preview…");
  }

  function updateQuality(value) {
    if (!state.operations || !state.capabilities.compression.quality) return;
    beginControlEdit();
    state.operations.quality = normalizeQuality(value);
    editor.updateInspector();
    editor.renderCanvas();
    editor.scheduleProcessing();
  }

  function finishQualityEdit(message) {
    finishControlEdit(message);
  }

  function setQualityPreset(value) {
    if (!state.operations || !state.capabilities.compression.quality) return;
    editWith((next) => {
      next.quality = normalizeQuality(value);
      next.lossy = true;
    }, `Quality set to ${normalizeQuality(value)}. Updating preview…`);
  }

  function currentAspect() {
    const crop = state.operations?.crop ?? editor.fullRect();
    const rotated = (state.operations?.rotation ?? 0) % 180 !== 0;
    return rotated ? crop.height / crop.width : crop.width / crop.height;
  }

  function beginControlEdit() {
    if (!state.controlEditBefore) state.controlEditBefore = editor.cloneOperations();
  }

  function updateSize(which) {
    if (!state.operations) return;
    beginControlEdit();
    const value = Math.max(1, Number(elements[which].value) || 1);
    state.operations[which === "width" ? "resizeWidth" : "resizeHeight"] = value;
    if (state.operations.aspectLocked) {
      const aspect = currentAspect();
      if (which === "width") state.operations.resizeHeight = Math.max(1, Math.round(value / aspect));
      else state.operations.resizeWidth = Math.max(1, Math.round(value * aspect));
    }
    editor.updateInspector();
    editor.renderCanvas();
    editor.scheduleProcessing();
  }

  function finishControlEdit(message) {
    if (!state.controlEditBefore) return;
    const before = state.controlEditBefore;
    state.controlEditBefore = null;
    rememberChange(before);
    editor.setProcessingStatus(message);
  }

  function updateSlider(which, value) {
    if (!state.operations) return;
    beginControlEdit();
    state.operations[which] = Number(value);
    editor.updateInspector();
    editor.renderCanvas();
    editor.scheduleProcessing();
  }

  function resetAdjustment(which) {
    if (!state.operations || !["brightness", "contrast"].includes(which)) return;
    const label = which === "brightness" ? "Brightness" : "Contrast";
    editWith((next) => { next[which] = 1; }, `${label} reset. Updating preview…`);
  }

  function estimateOutputDimensions() {
    if (!state.image || !state.operations) return null;
    const crop = state.operations.crop ?? editor.fullRect();
    let width = crop.width;
    let height = crop.height;
    if (state.operations.rotation % 180 !== 0) [width, height] = [height, width];
    if (state.operations.resizeMode === "crop") return { width: state.operations.resizeWidth, height: state.operations.resizeHeight };
    const scale = Math.min(1, state.operations.resizeWidth / width, state.operations.resizeHeight / height);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  Object.assign(editor, {
    rememberChange,
    commitOperations,
    undo,
    redo,
    resetOperations,
    editWith,
    adjustRotation,
    toggleFlip,
    setResizeMode,
    applyDestination,
    setFormat,
    setLossy,
    updateQuality,
    finishQualityEdit,
    setQualityPreset,
    currentAspect,
    beginControlEdit,
    updateSize,
    finishControlEdit,
    updateSlider,
    resetAdjustment,
    estimateOutputDimensions,
  });
}
