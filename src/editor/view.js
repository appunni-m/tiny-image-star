import { CROP_PRESETS } from "./state.js";
import { formatAccept, formatLabel, formatListLabel, normalizeCapabilities } from "../formats.js";
import { DESTINATION_PRESETS } from "../presets.js";
import { DEFAULT_QUALITY, qualityLevelForValue } from "../quality.js";

// Status, inspector, and lightweight DOM rendering. Canvas drawing lives in
// canvas.js so the editor's visual and state plumbing can be found separately.
export function attachEditorView(editor) {
  const { elements, state } = editor;

  function adjustmentLabel(value) {
    const percent = Math.round((Number(value) - 1) * 100);
    return percent === 0 ? "0" : `${percent > 0 ? "+" : ""}${percent}%`;
  }

  function sizeChange(originalBytes, outputBytes) {
    if (!Number.isFinite(originalBytes) || !Number.isFinite(outputBytes)) return "—";
    const change = outputBytes - originalBytes;
    if (change === 0) return "same size";
    return `${change < 0 ? "smaller" : "larger"} by ${editor.formatBytes(Math.abs(change))}`;
  }

  function setEngineStatus(message, phase) {
    elements.engineStatus.textContent = message;
    elements.engineStatus.dataset.state = phase;
  }

  function setProcessingStatus(message, active = false, error = false) {
    elements.processingStatus.textContent = message;
    elements.canvasStatus.textContent = message;
    // The empty editor is a calm starting point. Only show activity once a
    // real file is being read or processed; engine startup is represented by
    // the status message when it actually affects the user's image.
    elements.processingIndicator.hidden = !active || !state.file;
    if (error) elements.canvasStatus.dataset.state = "error";
    else delete elements.canvasStatus.dataset.state;
  }

  function updateDirtyState() {
    const dirty = Boolean(state.operations && !editor.sameOperations(state.operations, state.savedOperations));
    elements.dirtyStateSlot.hidden = !state.file;
    elements.dirtyState.hidden = !dirty;
    elements.reset.disabled = !state.file || !dirty;
  }

  function updateHistoryButtons() {
    elements.undo.disabled = state.history.length === 0;
    elements.redo.disabled = state.future.length === 0;
  }

  function updateEditorAvailability() {
    const enabled = Boolean(state.file && state.image);
    elements.workspace.dataset.empty = String(!enabled);
    elements.openButton.hidden = !enabled;
    elements.savePresetButton.hidden = !enabled;
    elements.saveButton.hidden = !enabled;
    elements.historyActions.hidden = !enabled;
    elements.mobileInspectorToggle.hidden = !enabled;
    for (const control of [
      elements.moveTool,
      elements.textTool,
      elements.cropTool,
      elements.sizeTool,
      elements.adjustTool,
      elements.formatTool,
      elements.exportTool,
      elements.rotateLeft,
      elements.rotateRight,
      elements.flipHorizontal,
      elements.flipVertical,
      elements.zoomOut,
      elements.fitView,
      elements.zoomIn,
      elements.mobileRotateLeft,
      elements.mobileRotateRight,
      elements.mobileFlipHorizontal,
      elements.mobileFlipVertical,
      elements.mobileZoomOut,
      elements.mobileFitView,
      elements.mobileZoomIn,
      elements.width,
      elements.height,
      elements.aspectLock,
      elements.brightness,
      elements.brightnessReset,
      elements.contrast,
      elements.contrastReset,
      elements.grayscale,
      elements.showOriginal,
      elements.showEdited,
      elements.compareHoldButton,
      elements.cropX,
      elements.cropY,
      elements.cropWidth,
      elements.cropHeight,
    ]) control.disabled = !enabled;
    if (elements.outputFormatSelect) elements.outputFormatSelect.disabled = !enabled || state.capabilities.outputFormats.length < 2;
    elements.saveButton.disabled = !state.result || state.result.revision !== state.revision;
    elements.inspectorSaveButton.disabled = elements.saveButton.disabled;
    elements.savePresetButton.disabled = !enabled;
  }

  function renderFormatOptions() {
    const formats = state.capabilities.outputFormats;
    const selected = state.operations?.format ?? formats[0] ?? "png";
    elements.outputFormatLabel.textContent = formatLabel(selected);
    elements.exportFormat.textContent = formatLabel(selected);
    elements.saveButton.setAttribute("aria-label", `Download current ${formatLabel(selected)}`);
    elements.saveButton.title = `Download current ${formatLabel(selected)} (Cmd/Ctrl+S)`;
    elements.saveButton.textContent = "Download current";
    elements.inspectorSaveButton.textContent = `Download ${formatLabel(selected)}`;
    elements.exportDownloadButton.textContent = `Download ${formatLabel(selected)}`;
    const compression = state.capabilities.compression;
    const formatCanBeLossy = compression.lossy && compression.lossyFormats.includes(selected);
    elements.formatTool.hidden = !state.image;
    elements.outputFormatDetails.hidden = false;
    elements.compressionOptions.hidden = !formatCanBeLossy;
    elements.lossyToggle.checked = Boolean(state.operations?.lossy);
    elements.lossyToggle.disabled = !state.image || !formatCanBeLossy;
    elements.qualityDetails.hidden = !formatCanBeLossy || !compression.quality;
    const quality = state.operations?.quality ?? DEFAULT_QUALITY;
    elements.quality.value = String(quality);
    elements.qualityValue.textContent = String(quality);
    elements.quality.disabled = !state.image || !formatCanBeLossy || !compression.quality;
    const activeQuality = qualityLevelForValue(quality)?.value ?? null;
    for (const button of elements.qualityPresets) {
      button.hidden = !formatCanBeLossy || !compression.quality;
      button.disabled = !state.image || !formatCanBeLossy || !compression.quality;
      button.setAttribute("aria-pressed", String(Number(button.dataset.qualityPreset) === activeQuality));
    }
    elements.formatHelp.textContent = formatCanBeLossy
      ? `Available here: ${formatListLabel(formats)}. Choose Low, Medium, or High quality below.`
      : `Available here: ${formatListLabel(formats)}. ${formatLabel(selected)} is saved at full quality; Low, Medium, and High appear only for verified compressed formats.`;
    elements.outputFormatSelect.replaceChildren();
    for (const format of formats) {
      const option = document.createElement("option");
      option.value = format;
      option.textContent = formatLabel(format);
      option.selected = format === selected;
      elements.outputFormatSelect.append(option);
    }
  }

  function setCapabilities(raw) {
    const next = normalizeCapabilities(raw);
    const previousFormat = state.operations?.format;
    state.capabilities = next;
    const accept = formatAccept(next.inputFormats);
    elements.fileInput.accept = accept;
    window.tinyImageStarCapabilities = next;
    if (state.operations && !next.outputFormats.includes(state.operations.format)) {
      state.operations.format = next.outputFormats[0];
      if (state.savedOperations) state.savedOperations.format = next.outputFormats[0];
    }
    const activeFormat = state.operations?.format;
    if (state.operations && !next.compression.lossyFormats.includes(activeFormat)) {
      // A capability downgrade must not leave a stale compression choice in
      // memory. If a lossy encoder returns later, it should still require an
      // explicit user choice rather than silently changing the saved output.
      state.operations.lossy = false;
      if (state.savedOperations) state.savedOperations.lossy = false;
    }
    renderFormatOptions();
    updateEditorAvailability();
    if (previousFormat !== state.operations?.format && state.file) editor.scheduleProcessing();
    window.dispatchEvent(new CustomEvent("tinystar:capabilities", { detail: next }));
  }

  function updateInspector() {
    const operations = state.operations;
    const enabled = Boolean(operations);
    if (!operations) {
      elements.width.value = "";
      elements.height.value = "";
      elements.brightness.value = "1";
      elements.contrast.value = "1";
      elements.brightnessValue.textContent = "0";
      elements.contrastValue.textContent = "0";
      elements.aspectLock.checked = true;
      elements.grayscale.checked = false;
      elements.resizeModeLabel.textContent = "Keep whole image";
    renderDestinationPicker();
    editor.renderTextPanel?.();
    updateCropFields();
    return;
    }
    elements.width.value = String(Math.max(1, Math.round(operations.resizeWidth)));
    elements.height.value = String(Math.max(1, Math.round(operations.resizeHeight)));
    elements.aspectLock.checked = operations.aspectLocked;
    elements.brightness.value = String(operations.brightness);
    elements.brightnessValue.textContent = adjustmentLabel(operations.brightness);
    elements.contrast.value = String(operations.contrast);
    elements.contrastValue.textContent = adjustmentLabel(operations.contrast);
    elements.grayscale.checked = operations.grayscale;
    elements.resizeModeLabel.textContent = operations.resizeMode === "crop" ? "Fill frame" : "Keep whole image";
    elements.resizeFit.setAttribute("aria-pressed", String(operations.resizeMode === "fit"));
    elements.resizeCrop.setAttribute("aria-pressed", String(operations.resizeMode === "crop"));
    for (const control of [elements.width, elements.height, elements.aspectLock, elements.brightness, elements.brightnessReset, elements.contrast, elements.contrastReset, elements.grayscale]) {
      control.disabled = !enabled;
    }
    updateCropFields();
    renderDestinationPicker();
    editor.renderTextPanel?.();
  }

  function renderDestinationPicker() {
    elements.destinationPicker.replaceChildren();
    const quickIds = ["instagram-square", "profile-photo", "website-banner"];
    const quickDestinations = quickIds
      .map((id) => DESTINATION_PRESETS.find((preset) => preset.id === id))
      .filter(Boolean);
    const appendDestination = (parent, destination) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "destination-button";
      button.textContent = destination.name;
      const active = state.operations?.presetId === destination.id
        || (destination.id === "keep-original" && state.operations && state.operations.resizeMode === "fit" && state.operations.resizeWidth === state.image?.naturalWidth && state.operations.resizeHeight === state.image?.naturalHeight);
      button.setAttribute("aria-pressed", String(Boolean(active)));
      button.addEventListener("click", () => editor.applyDestination(destination));
      parent.append(button);
    };
    for (const destination of quickDestinations) appendDestination(elements.destinationPicker, destination);

    const moreDestinations = DESTINATION_PRESETS.filter((destination) => !quickIds.includes(destination.id));
    if (!moreDestinations.length) return;
    const more = document.createElement("details");
    more.id = "destination-more";
    more.className = "destination-more";
    const summary = document.createElement("summary");
    summary.textContent = "More destinations";
    const grid = document.createElement("div");
    grid.className = "destination-more-grid";
    for (const destination of moreDestinations) appendDestination(grid, destination);
    more.open = moreDestinations.some((destination) => destination.id === state.operations?.presetId);
    more.append(summary, grid);
    elements.destinationPicker.append(more);
  }

  function updateCropFields() {
    const crop = state.cropDraft ?? (state.image ? editor.fullRect() : null);
    const enabled = Boolean(state.image && crop && state.tool === "crop");
    const values = [
      [elements.cropX, crop?.x],
      [elements.cropY, crop?.y],
      [elements.cropWidth, crop?.width],
      [elements.cropHeight, crop?.height],
    ];
    for (const [control, value] of values) {
      control.value = value == null ? "" : String(Math.max(0, Math.round(value)));
      control.disabled = !enabled;
    }
  }

  function renderOutputSummary() {
    const result = state.result && state.result.revision === state.revision ? state.result : null;
    elements.outputSummary.replaceChildren();
    for (const [label, value] of [
      ["Result", result ? "Ready" : "Not ready"],
      ["Size", result ? `${result.width} × ${result.height}` : "—"],
      ["File", result ? editor.formatBytes(result.outputBytes) : "—"],
      ["Change", result && state.file?.bytes ? sizeChange(state.file.bytes.byteLength, result.outputBytes) : "—"],
    ]) {
      const term = document.createElement("dt");
      term.textContent = label;
      const definition = document.createElement("dd");
      definition.textContent = value;
      elements.outputSummary.append(term, definition);
    }
    elements.exportDimensions.textContent = result ? `${result.width} × ${result.height}` : "—";
    elements.exportFilesize.textContent = result ? editor.formatBytes(result.outputBytes) : "—";
    elements.exportDownloadButton.disabled = !result;
    renderFormatOptions();
    updateEditorAvailability();
  }

  function renderCropPresets() {
    elements.cropPresets.replaceChildren();
    for (const preset of CROP_PRESETS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button";
      button.textContent = preset.label;
      button.setAttribute("aria-pressed", String((preset.aspect === null && state.cropAspect === null) || preset.aspect === state.cropAspect));
      button.addEventListener("click", () => {
        state.cropAspect = preset.aspect;
        state.cropDraft = preset.aspect === null ? editor.fullRect() : editor.rectForAspect(preset.aspect);
        editor.renderCanvas();
        updateCropFields();
        renderCropPresets();
      });
      elements.cropPresets.append(button);
    }
  }

  function renderToolState() {
    for (const [button, tool] of [[elements.moveTool, "move"], [elements.textTool, "text"], [elements.cropTool, "crop"], [elements.sizeTool, "size"], [elements.adjustTool, "adjust"], [elements.formatTool, "format"], [elements.exportTool, "export"]]) {
      const active = state.tool === tool;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    elements.cropPanel.hidden = state.tool !== "crop" || !state.image;
    elements.resizePanel.hidden = state.tool !== "size" || !state.image;
    elements.adjustPanel.hidden = state.tool !== "adjust" || !state.image;
    elements.textPanel.hidden = state.tool !== "text" || !state.image;
    elements.outputSection.hidden = !state.image || !["move", "text", "size", "adjust", "format", "export"].includes(state.tool);
    if (state.tool === "format") elements.outputFormatDetails.open = true;
    elements.cropHint.hidden = elements.cropPanel.hidden;
    elements.canvas.style.cursor = state.tool === "crop" && !state.spacePressed ? "crosshair" : "grab";
    if (state.tool === "crop") renderCropPresets();
  }

  function renderDirtyAndHistory() {
    updateDirtyState();
    updateHistoryButtons();
  }

  function renderAll() {
    const hasImage = Boolean(state.image);
    elements.emptyEditor.hidden = hasImage;
    elements.canvas.hidden = !hasImage;
    elements.canvasShell.dataset.empty = String(!hasImage);
    elements.fileName.textContent = state.file?.name ?? "Open an image to begin";
    renderToolState();
    updateInspector();
    editor.renderTextPanel?.();
    renderOutputSummary();
    renderDirtyAndHistory();
    setInspectorOpen(state.inspectorOpen);
    editor.renderCanvas();
  }

  function setInspectorOpen(open) {
    state.inspectorOpen = Boolean(open);
    elements.workspace.dataset.inspectorOpen = String(state.inspectorOpen);
    elements.mobileInspectorToggle.setAttribute("aria-expanded", String(state.inspectorOpen));
    elements.mobileInspectorToggle.textContent = state.inspectorOpen ? "Hide controls" : "Controls";
  }

  Object.assign(editor, {
    setEngineStatus,
    setProcessingStatus,
    setCapabilities,
    renderFormatOptions,
    updateDirtyState,
    updateHistoryButtons,
    updateEditorAvailability,
    updateInspector,
    renderOutputSummary,
    renderCropPresets,
    renderDestinationPicker,
    updateCropFields,
    renderToolState,
    renderDirtyAndHistory,
    setInspectorOpen,
    renderAll,
  });
}
