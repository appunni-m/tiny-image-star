// DOM event wiring. Keeping this file declarative makes the editor entry point
// easy to scan and keeps interaction behavior beside its implementation.

function isTextEntry(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable;
}

function isRendered(element) {
  if (!element || element.hidden) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function editorOwnsShortcuts() {
  if (document.querySelector("dialog[open]")) return false;
  if (isRendered(document.querySelector("#batch-view"))) return false;
  if (isRendered(document.querySelector("#presets-view"))) return false;
  return isRendered(document.querySelector("#editor-view"));
}

function hasCommandModifier(event) {
  return (event.ctrlKey || event.metaKey) && !event.altKey;
}

function hasNoCommandModifiers(event) {
  return !event.ctrlKey && !event.metaKey && !event.altKey;
}

function clipboardImageFiles(event) {
  const itemFiles = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
  const directFiles = Array.from(event.clipboardData?.files ?? []);
  const files = [...itemFiles, ...directFiles];
  return [...new Set(files)].filter((file) => (
    /^image\//i.test(file.type)
    || /\.(avif|bmp|gif|ico|jpe?g|png|tiff?|webp)$/i.test(file.name ?? "")
  ));
}

export function bindEditorEvents(editor) {
  const { elements, state } = editor;

  elements.openButton.addEventListener("click", () => elements.fileInput.click());
  elements.emptyOpenButton.addEventListener("click", () => elements.fileInput.click());
  elements.emptyFolderButton.addEventListener("click", () => window.dispatchEvent(new CustomEvent("tinystar:choose-folder")));
  elements.fileInput.addEventListener("change", () => {
    const files = Array.from(elements.fileInput.files ?? []);
    if (files.length) {
      window.tinyImageStarPendingFiles = files;
      window.dispatchEvent(new CustomEvent("tinystar:open-batch", { detail: { files } }));
    }
    elements.fileInput.value = "";
  });
  window.addEventListener("paste", (event) => {
    if (isTextEntry(event.target)) return;
    const files = clipboardImageFiles(event);
    if (!files.length) return;
    event.preventDefault();
    window.tinyImageStarPendingFiles = files;
    window.dispatchEvent(new CustomEvent("tinystar:paste-images", { detail: { files } }));
  });
  elements.presetsButton.addEventListener("click", () => window.dispatchEvent(new CustomEvent("tinystar:show-presets")));
  elements.batchButton.addEventListener("click", () => window.dispatchEvent(new CustomEvent("tinystar:show-results")));
  elements.savePresetButton.addEventListener("click", () => window.dispatchEvent(new CustomEvent("tinystar:save-preset")));

  elements.canvasShell.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.canvasShell.dataset.dragging = "true";
  });
  elements.canvasShell.addEventListener("dragleave", () => delete elements.canvasShell.dataset.dragging);
  elements.canvasShell.addEventListener("drop", editor.onDrop);
  elements.canvas.addEventListener("pointerdown", editor.pointerDown);
  elements.canvas.addEventListener("pointermove", editor.pointerMove);
  elements.canvas.addEventListener("pointerup", editor.pointerUp);
  elements.canvas.addEventListener("pointercancel", editor.pointerUp);
  elements.canvas.addEventListener("wheel", (event) => {
    if (!state.image) return;
    event.preventDefault();
    editor.zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  elements.moveTool.addEventListener("click", () => editor.setTool("move"));
  elements.cropTool.addEventListener("click", () => editor.setTool("crop"));
  elements.sizeTool.addEventListener("click", () => editor.setTool("size"));
  elements.adjustTool.addEventListener("click", () => editor.setTool("adjust"));
  elements.formatTool.addEventListener("click", () => editor.setTool("format"));
  elements.exportTool.addEventListener("click", () => {
    editor.setTool("export");
    editor.saveOrOpenExport();
  });
  elements.cancelCrop.addEventListener("click", editor.cancelCrop);
  elements.applyCrop.addEventListener("click", editor.applyCrop);
  elements.rotateLeft.addEventListener("click", () => editor.adjustRotation(270));
  elements.rotateRight.addEventListener("click", () => editor.adjustRotation(90));
  elements.flipHorizontal.addEventListener("click", () => editor.toggleFlip("flipX"));
  elements.flipVertical.addEventListener("click", () => editor.toggleFlip("flipY"));
  elements.zoomOut.addEventListener("click", () => editor.zoomBy(1 / 1.25));
  elements.zoomIn.addEventListener("click", () => editor.zoomBy(1.25));
  elements.fitView.addEventListener("click", editor.fitView);
  elements.mobileRotateLeft.addEventListener("click", () => editor.adjustRotation(270));
  elements.mobileRotateRight.addEventListener("click", () => editor.adjustRotation(90));
  elements.mobileFlipHorizontal.addEventListener("click", () => editor.toggleFlip("flipX"));
  elements.mobileFlipVertical.addEventListener("click", () => editor.toggleFlip("flipY"));
  elements.mobileZoomOut.addEventListener("click", () => editor.zoomBy(1 / 1.25));
  elements.mobileFitView.addEventListener("click", editor.fitView);
  elements.mobileZoomIn.addEventListener("click", () => editor.zoomBy(1.25));
  elements.showOriginal.addEventListener("click", () => editor.setPreview("original"));
  elements.showEdited.addEventListener("click", () => editor.setPreview("edited"));
  const showHeldOriginal = () => editor.setPreview("original");
  const showHeldEdited = () => editor.setPreview("edited");
  elements.compareHoldButton.addEventListener("pointerdown", showHeldOriginal);
  elements.compareHoldButton.addEventListener("pointerup", showHeldEdited);
  elements.compareHoldButton.addEventListener("pointercancel", showHeldEdited);
  elements.compareHoldButton.addEventListener("pointerleave", showHeldEdited);
  elements.compareHoldButton.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") showHeldOriginal();
  });
  elements.compareHoldButton.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") showHeldEdited();
  });
  for (const [control, field] of [[elements.cropX, "x"], [elements.cropY, "y"], [elements.cropWidth, "width"], [elements.cropHeight, "height"]]) {
    control.addEventListener("input", () => editor.updateCropDraftField(field, control.value));
  }
  elements.resizeFit.addEventListener("click", () => editor.setResizeMode("fit"));
  elements.resizeCrop.addEventListener("click", () => editor.setResizeMode("crop"));
  elements.width.addEventListener("input", () => editor.updateSize("width"));
  elements.height.addEventListener("input", () => editor.updateSize("height"));
  elements.width.addEventListener("change", () => editor.finishControlEdit("Resize updated. Updating preview…"));
  elements.height.addEventListener("change", () => editor.finishControlEdit("Resize updated. Updating preview…"));
  elements.aspectLock.addEventListener("change", () => {
    const before = editor.cloneOperations();
    state.operations.aspectLocked = elements.aspectLock.checked;
    if (state.operations.aspectLocked) state.operations.resizeHeight = Math.max(1, Math.round(state.operations.resizeWidth / editor.currentAspect()));
    editor.rememberChange(before);
    editor.updateInspector();
    editor.renderCanvas();
    editor.scheduleProcessing();
  });
  elements.brightness.addEventListener("input", () => editor.updateSlider("brightness", elements.brightness.value));
  elements.contrast.addEventListener("input", () => editor.updateSlider("contrast", elements.contrast.value));
  elements.brightnessReset.addEventListener("click", () => editor.resetAdjustment("brightness"));
  elements.contrastReset.addEventListener("click", () => editor.resetAdjustment("contrast"));
  elements.brightness.addEventListener("change", () => editor.finishControlEdit("Brightness updated. Updating preview…"));
  elements.contrast.addEventListener("change", () => editor.finishControlEdit("Contrast updated. Updating preview…"));
  elements.grayscale.addEventListener("change", () => {
    const before = editor.cloneOperations();
    state.operations.grayscale = elements.grayscale.checked;
    editor.rememberChange(before);
    editor.renderCanvas();
    editor.scheduleProcessing();
  });
  elements.outputFormatSelect.addEventListener("change", () => editor.setFormat(elements.outputFormatSelect.value));
  elements.lossyToggle.addEventListener("change", () => editor.setLossy(elements.lossyToggle.checked));
  elements.quality.addEventListener("input", () => editor.updateQuality(elements.quality.value));
  elements.quality.addEventListener("change", () => editor.finishQualityEdit("Quality updated. Updating preview…"));
  for (const button of elements.qualityPresets) {
    button.addEventListener("click", () => editor.setQualityPreset(button.dataset.qualityPreset));
  }
  elements.undo.addEventListener("click", editor.undo);
  elements.redo.addEventListener("click", editor.redo);
  elements.reset.addEventListener("click", editor.resetOperations);
  elements.mobileInspectorToggle.addEventListener("click", () => editor.setInspectorOpen(!state.inspectorOpen));
  elements.saveButton.addEventListener("click", editor.saveOrOpenExport);
  elements.inspectorSaveButton.addEventListener("click", editor.downloadResult);
  elements.exportForm.addEventListener("submit", (event) => {
    if (event.submitter !== elements.exportDownloadButton) return;
    event.preventDefault();
    editor.downloadResult();
  });

  window.addEventListener("resize", editor.renderCanvas);
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || !editorOwnsShortcuts()) return;
    const typing = isTextEntry(event.target);
    const command = hasCommandModifier(event);
    const key = event.key.toLowerCase();
    if (event.code === "Space" && hasNoCommandModifiers(event) && !typing && state.image) {
      event.preventDefault();
      state.spacePressed = true;
      editor.renderCanvas();
      return;
    }
    if (command && !event.shiftKey && key === "s" && !typing && state.image) {
      event.preventDefault();
      if (!elements.saveButton.disabled) editor.saveOrOpenExport();
      else editor.setProcessingStatus("Your preview is still updating. Download will be ready in a moment.", true);
      return;
    }
    if (command && !typing && (key === "z" || (!event.metaKey && key === "y"))) {
      event.preventDefault();
      if ((key === "z" && event.shiftKey) || key === "y") editor.redo();
      else editor.undo();
      return;
    }
    if (typing || !state.image) return;
    if (hasNoCommandModifiers(event) && key === "f") {
      event.preventDefault();
      editor.fitView();
    } else if (hasNoCommandModifiers(event) && key === "c") {
      event.preventDefault();
      editor.setTool("crop");
    } else if (event.key === "Escape" && state.tool === "crop") {
      event.preventDefault();
      editor.cancelCrop();
    } else if (event.key === "Enter" && state.tool === "crop") {
      event.preventDefault();
      editor.applyCrop();
    } else if (state.tool === "crop" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      editor.nudgeCrop(event.key, event.shiftKey ? 10 : 1);
    } else if (hasNoCommandModifiers(event) && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      editor.zoomBy(1.25);
    } else if (hasNoCommandModifiers(event) && event.key === "-") {
      event.preventDefault();
      editor.zoomBy(1 / 1.25);
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code !== "Space" || !state.spacePressed) return;
    state.spacePressed = false;
    editor.renderCanvas();
  });
  window.addEventListener("blur", () => {
    if (!state.spacePressed) return;
    state.spacePressed = false;
    editor.renderCanvas();
  });
}
