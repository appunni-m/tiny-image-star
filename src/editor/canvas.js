// Canvas stage, crop framing, pan/zoom, and direct-manipulation interactions.
export function attachEditorCanvas(editor) {
  const { elements, state } = editor;
  const pointers = new Map();
  let lastTapAt = 0;

  function currentSourceCrop() {
    return state.operations?.crop ?? editor.fullRect();
  }

  function previewModel() {
    const original = state.preview === "original";
    const useFullSource = state.tool === "crop";
    const generatedImage = !original && !useFullSource && state.result?.revision === state.revision
      ? state.result.image
      : null;
    if (generatedImage) {
      return {
        image: generatedImage,
        crop: { x: 0, y: 0, width: generatedImage.naturalWidth, height: generatedImage.naturalHeight },
        rotation: 0,
        flipX: false,
        flipY: false,
        brightness: 1,
        contrast: 1,
        grayscale: false,
      };
    }
    let crop = original || useFullSource ? editor.fullRect() : currentSourceCrop();
    const operations = state.operations;
    // The export engine rotates before it performs an automatic Fill frame
    // crop. Mirror that order here so the canvas shows the same framing that
    // will be downloaded, even when the user rotates a destination preset.
    if (!original && !useFullSource && !operations?.crop && operations?.resizeMode === "crop" && operations.resizeWidth > 0 && operations.resizeHeight > 0) {
      const rotated = (operations.rotation ?? 0) % 180 !== 0;
      const aspect = rotated
        ? operations.resizeHeight / operations.resizeWidth
        : operations.resizeWidth / operations.resizeHeight;
      crop = rectForAspect(aspect);
    }
    return {
      crop,
      rotation: original ? 0 : state.operations?.rotation ?? 0,
      flipX: original ? false : Boolean(state.operations?.flipX),
      flipY: original ? false : Boolean(state.operations?.flipY),
      brightness: original ? 1 : state.operations?.brightness ?? 1,
      contrast: original ? 1 : state.operations?.contrast ?? 1,
      grayscale: original ? false : Boolean(state.operations?.grayscale),
      image: state.image,
    };
  }

  function getLayout() {
    const rect = elements.canvasShell.getBoundingClientRect();
    const model = previewModel();
    const rotated = model.rotation % 180 !== 0;
    const displayWidth = rotated ? model.crop.height : model.crop.width;
    const displayHeight = rotated ? model.crop.width : model.crop.height;
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const fitScale = Math.min((width - 56) / displayWidth, (height - 56) / displayHeight);
    return {
      ...model,
      width,
      height,
      fitScale: Math.max(0.01, fitScale),
      scale: Math.max(0.01, fitScale * state.zoom),
      centerX: width / 2 + state.panX,
      centerY: height / 2 + state.panY,
    };
  }

  function sourceToCanvas(point, layout) {
    let x = point.x - layout.crop.width / 2;
    let y = point.y - layout.crop.height / 2;
    if (layout.flipX) x = -x;
    if (layout.flipY) y = -y;
    if (layout.rotation === 90) [x, y] = [-y, x];
    else if (layout.rotation === 180) [x, y] = [-x, -y];
    else if (layout.rotation === 270) [x, y] = [y, -x];
    return { x: layout.centerX + x * layout.scale, y: layout.centerY + y * layout.scale };
  }

  function canvasToSource(point, layout) {
    let x = (point.x - layout.centerX) / layout.scale;
    let y = (point.y - layout.centerY) / layout.scale;
    if (layout.rotation === 90) [x, y] = [y, -x];
    else if (layout.rotation === 180) [x, y] = [-x, -y];
    else if (layout.rotation === 270) [x, y] = [-y, x];
    if (layout.flipX) x = -x;
    if (layout.flipY) y = -y;
    return { x: x + layout.crop.width / 2, y: y + layout.crop.height / 2 };
  }

  function selectionBox(rect, layout) {
    const points = [
      sourceToCanvas({ x: rect.x, y: rect.y }, layout),
      sourceToCanvas({ x: rect.x + rect.width, y: rect.y }, layout),
      sourceToCanvas({ x: rect.x + rect.width, y: rect.y + rect.height }, layout),
      sourceToCanvas({ x: rect.x, y: rect.y + rect.height }, layout),
    ];
    return {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      bottom: Math.max(...points.map((point) => point.y)),
    };
  }

  function drawCropOverlay(ctx, layout) {
    const rect = state.cropDraft ?? editor.fullRect();
    const box = selectionBox(rect, layout);
    ctx.save();
    ctx.fillStyle = "rgba(4, 8, 18, .64)";
    ctx.fillRect(0, 0, layout.width, box.top);
    ctx.fillRect(0, box.bottom, layout.width, layout.height - box.bottom);
    ctx.fillRect(0, box.top, box.left, box.bottom - box.top);
    ctx.fillRect(box.right, box.top, layout.width - box.right, box.bottom - box.top);
    ctx.strokeStyle = "#a7f36e";
    ctx.lineWidth = 2;
    ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    ctx.strokeStyle = "rgba(167, 243, 110, .52)";
    ctx.lineWidth = 1;
    for (const fraction of [1 / 3, 2 / 3]) {
      const x = box.left + (box.right - box.left) * fraction;
      const y = box.top + (box.bottom - box.top) * fraction;
      ctx.beginPath();
      ctx.moveTo(x, box.top);
      ctx.lineTo(x, box.bottom);
      ctx.moveTo(box.left, y);
      ctx.lineTo(box.right, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#a7f36e";
    const handles = [
      [box.left, box.top],
      [(box.left + box.right) / 2, box.top],
      [box.right, box.top],
      [box.left, (box.top + box.bottom) / 2],
      [box.right, (box.top + box.bottom) / 2],
      [box.left, box.bottom],
      [(box.left + box.right) / 2, box.bottom],
      [box.right, box.bottom],
    ];
    for (const [x, y] of handles) {
      ctx.fillRect(x - 7, y - 7, 14, 14);
    }
    ctx.restore();
  }

  function updateCanvasLabel() {
    if (!state.image) {
      elements.canvas.setAttribute("aria-label", "Image canvas. Open an image to begin.");
      return;
    }
    const operations = state.operations ?? {};
    const result = state.result?.revision === state.revision ? state.result : null;
    const estimated = result
      ? { width: result.width, height: result.height }
      : editor.estimateOutputDimensions?.() ?? { width: state.image.naturalWidth, height: state.image.naturalHeight };
    const format = operations.format ? ` ${String(operations.format).toUpperCase()}` : "";
    const preview = state.preview === "original"
      ? "Original preview"
      : result ? "Edited preview" : "Edited preview is updating";
    const resizeMode = operations.resizeMode === "crop" ? "Fill frame" : "Keep whole image";
    const changes = [];
    const rotation = ((Number(operations.rotation) || 0) + 360) % 360;
    if (rotation) changes.push(`rotated ${rotation} degrees`);
    if (operations.flipX) changes.push("flipped horizontally");
    if (operations.flipY) changes.push("flipped vertically");
    if (operations.grayscale) changes.push("grayscale on");
    const brightness = Math.round(((Number(operations.brightness) || 1) - 1) * 100);
    const contrast = Math.round(((Number(operations.contrast) || 1) - 1) * 100);
    if (brightness) changes.push(`brightness ${brightness > 0 ? "+" : ""}${brightness}%`);
    if (contrast) changes.push(`contrast ${contrast > 0 ? "+" : ""}${contrast}%`);
    const crop = state.tool === "crop" ? state.cropDraft : operations.crop;
    if (crop) changes.push(`crop frame ${Math.round(crop.width)} × ${Math.round(crop.height)} pixels`);
    const changeText = changes.length ? ` ${changes.join(", ")}.` : " No manual transforms.";
    const frameText = `${resizeMode}${format ? `, ${format.trim()} output` : ""}, ${Math.round(estimated.width)} × ${Math.round(estimated.height)} pixels.`;
    elements.canvas.setAttribute(
      "aria-label",
      `Image canvas for ${state.file?.name ?? "the current image"}. ${preview}. ${frameText}${changeText} In Crop, use arrow keys to move the frame; press Enter to apply or Escape to cancel.`,
    );
  }

  function renderCanvas() {
    if (!state.image) {
      elements.zoomValue.textContent = "No image";
      updateCanvasLabel();
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = elements.canvasShell.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (elements.canvas.width !== Math.floor(width * dpr) || elements.canvas.height !== Math.floor(height * dpr)) {
      elements.canvas.width = Math.floor(width * dpr);
      elements.canvas.height = Math.floor(height * dpr);
    }
    const layout = getLayout();
    const ctx = elements.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.save();
    ctx.translate(layout.centerX, layout.centerY);
    ctx.rotate((layout.rotation * Math.PI) / 180);
    ctx.scale(layout.flipX ? -1 : 1, layout.flipY ? -1 : 1);
    ctx.filter = `brightness(${layout.brightness}) contrast(${layout.contrast})${layout.grayscale ? " grayscale(1)" : ""}`;
    ctx.drawImage(
      layout.image ?? state.image,
      layout.crop.x,
      layout.crop.y,
      layout.crop.width,
      layout.crop.height,
      -(layout.crop.width * layout.scale) / 2,
      -(layout.crop.height * layout.scale) / 2,
      layout.crop.width * layout.scale,
      layout.crop.height * layout.scale,
    );
    ctx.restore();
    ctx.filter = "none";
    if (state.tool === "crop" && state.preview === "edited") drawCropOverlay(ctx, layout);
    elements.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    updateCanvasLabel();
  }

  function rectForAspect(aspect) {
    const full = editor.fullRect();
    if (!aspect || !full.width || !full.height) return full;
    let width = full.width;
    let height = width / aspect;
    if (height > full.height) {
      height = full.height;
      width = height * aspect;
    }
    return { x: (full.width - width) / 2, y: (full.height - height) / 2, width, height };
  }

  function clampPoint(point) {
    return {
      x: Math.max(0, Math.min(editor.fullRect().width, point.x)),
      y: Math.max(0, Math.min(editor.fullRect().height, point.y)),
    };
  }

  function rectFromPoints(a, b, aspect = null) {
    const start = clampPoint(a);
    const end = clampPoint(b);
    let width = Math.abs(end.x - start.x);
    let height = Math.abs(end.y - start.y);
    if (aspect && width > 0 && height > 0) {
      if (width / height > aspect) width = height * aspect;
      else height = width / aspect;
    }
    const x = end.x >= start.x ? start.x : start.x - width;
    const y = end.y >= start.y ? start.y : start.y - height;
    const full = editor.fullRect();
    return {
      x: Math.max(0, Math.min(full.width - width, x)),
      y: Math.max(0, Math.min(full.height - height, y)),
      width: Math.max(1, Math.min(full.width, width)),
      height: Math.max(1, Math.min(full.height, height)),
    };
  }

  function canvasPoint(event) {
    const rect = elements.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointerDistance() {
    const points = [...pointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function handleForPoint(point, box) {
    // A generous hit area keeps crop handles usable on touch screens without
    // making the visual frame itself look heavy.
    const handleHitRadius = 20;
    const handles = [
      ["tl", box.left, box.top],
      ["tm", (box.left + box.right) / 2, box.top],
      ["tr", box.right, box.top],
      ["ml", box.left, (box.top + box.bottom) / 2],
      ["mr", box.right, (box.top + box.bottom) / 2],
      ["bl", box.left, box.bottom],
      ["bm", (box.left + box.right) / 2, box.bottom],
      ["br", box.right, box.bottom],
    ];
    return handles.find(([, x, y]) => Math.abs(point.x - x) < handleHitRadius && Math.abs(point.y - y) < handleHitRadius)?.[0] ?? null;
  }

  function rectFromHandle(selection, handle, point, aspect = null) {
    const full = editor.fullRect();
    let left = selection.x;
    let right = selection.x + selection.width;
    let top = selection.y;
    let bottom = selection.y + selection.height;
    if (handle.includes("l")) left = point.x;
    if (handle.includes("r")) right = point.x;
    if (handle.includes("t")) top = point.y;
    if (handle.includes("b")) bottom = point.y;

    if (aspect && aspect > 0) {
      const horizontalEdge = handle === "tm" || handle === "bm";
      const verticalEdge = handle === "ml" || handle === "mr";
      if (horizontalEdge) {
        const height = Math.max(1, selection.width / aspect);
        if (handle === "tm") top = bottom - height;
        else bottom = top + height;
      } else if (verticalEdge) {
        const width = Math.max(1, selection.height * aspect);
        if (handle === "ml") left = right - width;
        else right = left + width;
      } else {
        const width = Math.max(1, right - left);
        const height = Math.max(1, bottom - top);
        if (width / height > aspect) {
          const nextHeight = width / aspect;
          if (handle.includes("t")) top = bottom - nextHeight;
          else bottom = top + nextHeight;
        } else {
          const nextWidth = height * aspect;
          if (handle.includes("l")) left = right - nextWidth;
          else right = left + nextWidth;
        }
      }
    }

    const minSize = 1;
    if (right - left < minSize) {
      if (handle.includes("l")) left = right - minSize;
      else right = left + minSize;
    }
    if (bottom - top < minSize) {
      if (handle.includes("t")) top = bottom - minSize;
      else bottom = top + minSize;
    }
    left = Math.max(0, Math.min(full.width - minSize, left));
    top = Math.max(0, Math.min(full.height - minSize, top));
    right = Math.max(left + minSize, Math.min(full.width, right));
    bottom = Math.max(top + minSize, Math.min(full.height, bottom));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function sourceInside(point, rect) {
    return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
  }

  function pointerDown(event) {
    if (!state.image) return;
    const layout = getLayout();
    const point = canvasPoint(event);
    pointers.set(event.pointerId, point);
    if (state.tool !== "crop" && pointers.size === 2) {
      state.drag = { kind: "pinch", startDistance: Math.max(1, pointerDistance()), startZoom: state.zoom };
      elements.canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    if (state.tool === "crop" && state.preview === "edited" && !state.spacePressed) {
      const selection = state.cropDraft ?? editor.fullRect();
      const box = selectionBox(selection, layout);
      const source = canvasToSource(point, layout);
      const handle = handleForPoint(point, box);
      if (handle) {
        const anchor = {
          x: handle.includes("l") ? selection.x + selection.width : handle.includes("r") ? selection.x : (selection.x + selection.width) / 2,
          y: handle.includes("t") ? selection.y + selection.height : handle.includes("b") ? selection.y : (selection.y + selection.height) / 2,
        };
        state.drag = { kind: "crop-handle", handle, anchor, selection: editor.cloneRect(selection) };
      } else if (sourceInside(source, selection)) {
        state.drag = { kind: "crop-move", offset: { x: source.x - selection.x, y: source.y - selection.y } };
      } else {
        state.drag = { kind: "crop-new", start: source };
      }
    } else {
      state.drag = { kind: "pan", start: point, panX: state.panX, panY: state.panY, moved: false, startedAt: Date.now() };
    }
    elements.canvas.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    if (!state.drag || !state.image) return;
    const layout = getLayout();
    const point = canvasPoint(event);
    pointers.set(event.pointerId, point);
    if (state.drag.kind === "pinch") {
      const distance = pointerDistance();
      if (distance > 0) state.zoom = Math.max(0.25, Math.min(4, state.drag.startZoom * distance / state.drag.startDistance));
      renderCanvas();
      return;
    }
    if (state.drag.kind === "pan") {
      state.panX = state.drag.panX + point.x - state.drag.start.x;
      state.panY = state.drag.panY + point.y - state.drag.start.y;
      state.drag.moved = state.drag.moved || Math.hypot(point.x - state.drag.start.x, point.y - state.drag.start.y) > 6;
    } else {
      const source = canvasToSource(point, layout);
      if (state.drag.kind === "crop-new") state.cropDraft = rectFromPoints(state.drag.start, source, state.cropAspect);
      if (state.drag.kind === "crop-handle") state.cropDraft = rectFromHandle(state.drag.selection, state.drag.handle, source, state.cropAspect);
      if (state.drag.kind === "crop-move") {
        const full = editor.fullRect();
        const selection = state.cropDraft ?? full;
        state.cropDraft = {
          ...selection,
          x: Math.max(0, Math.min(full.width - selection.width, source.x - state.drag.offset.x)),
          y: Math.max(0, Math.min(full.height - selection.height, source.y - state.drag.offset.y)),
        };
      }
    }
    renderCanvas();
  }

  function pointerUp(event) {
    const drag = state.drag;
    pointers.delete(event.pointerId);
    if (!drag) return;
    if (drag.kind === "pan" && !drag.moved && Date.now() - drag.startedAt < 320) {
      const now = Date.now();
      if (now - lastTapAt < 320) fitView();
      lastTapAt = now;
    }
    if (drag.kind === "pinch" && pointers.size > 0) return;
    state.drag = null;
    elements.canvas.releasePointerCapture?.(event.pointerId);
  }

  function setTool(tool) {
    if (!state.image) return;
    state.tool = tool;
    if (["crop", "adjust", "format", "export"].includes(tool)) state.preview = "edited";
    if (tool === "crop") {
      state.preview = "edited";
      state.cropDraft = editor.cloneRect(state.operations.crop ?? editor.fullRect());
      state.cropAspect = null;
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
    } else {
      state.cropDraft = null;
    }
    editor.renderAll();
  }

  function applyCrop() {
    if (!state.image || !state.cropDraft) return;
    const full = editor.fullRect();
    const isFull = Math.abs(state.cropDraft.x) < 1 && Math.abs(state.cropDraft.y) < 1 && Math.abs(state.cropDraft.width - full.width) < 1 && Math.abs(state.cropDraft.height - full.height) < 1;
    const next = editor.cloneOperations();
    next.crop = isFull ? null : editor.cloneRect(state.cropDraft);
    editor.commitOperations(next, "Crop applied. Updating preview…");
    state.tool = "move";
    state.cropDraft = null;
    editor.renderAll();
  }

  function cancelCrop() {
    state.tool = "move";
    state.cropDraft = null;
    editor.renderAll();
  }

  function nudgeCrop(key, amount = 1) {
    if (state.tool !== "crop" || !state.image) return false;
    const full = editor.fullRect();
    const current = state.cropDraft ?? full;
    const delta = Math.max(1, Number(amount) || 1);
    const movement = {
      ArrowLeft: { x: -delta, y: 0 },
      ArrowRight: { x: delta, y: 0 },
      ArrowUp: { x: 0, y: -delta },
      ArrowDown: { x: 0, y: delta },
    }[key];
    if (!movement) return false;
    state.cropDraft = {
      ...current,
      x: Math.max(0, Math.min(full.width - current.width, current.x + movement.x)),
      y: Math.max(0, Math.min(full.height - current.height, current.y + movement.y)),
    };
    state.cropAspect = null;
    editor.updateCropFields();
    editor.renderCanvas();
    return true;
  }

  function updateCropDraftField(field, value) {
    if (state.tool !== "crop" || !state.image) return;
    const full = editor.fullRect();
    const current = state.cropDraft ?? full;
    const next = { ...current, [field]: Math.max(0, Number(value) || 0) };
    next.width = Math.max(1, Math.min(full.width, next.width));
    next.height = Math.max(1, Math.min(full.height, next.height));
    next.x = Math.max(0, Math.min(full.width - next.width, next.x));
    next.y = Math.max(0, Math.min(full.height - next.height, next.y));
    state.cropDraft = next;
    state.cropAspect = null;
    editor.updateCropFields();
    editor.renderCanvas();
  }

  function setPreview(preview) {
    state.preview = preview;
    elements.showOriginal.setAttribute("aria-pressed", String(preview === "original"));
    elements.showEdited.setAttribute("aria-pressed", String(preview === "edited"));
    renderCanvas();
  }

  function zoomBy(factor) {
    if (!state.image) return;
    state.zoom = Math.max(0.25, Math.min(4, state.zoom * factor));
    renderCanvas();
  }

  function fitView() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    renderCanvas();
  }

  function onDrop(event) {
    event.preventDefault();
    delete elements.canvasShell.dataset.dragging;
    const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
    const file = droppedFiles.find((candidate) => editor.isSupportedInput(candidate));
    if (file) editor.importImage(file);
    else if (droppedFiles.length) editor.setProcessingStatus(`That image format is not supported yet. Try ${editor.supportedInputLabel()}.`, false, true);
  }

  Object.assign(editor, {
    currentSourceCrop,
    previewModel,
    getLayout,
    sourceToCanvas,
    canvasToSource,
    selectionBox,
    renderCanvas,
    rectForAspect,
    pointerDown,
    pointerMove,
    pointerUp,
    setTool,
    applyCrop,
    cancelCrop,
    nudgeCrop,
    updateCropDraftField,
    setPreview,
    zoomBy,
    fitView,
    onDrop,
  });
}
