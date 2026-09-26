import {
  BUILTIN_FONTS,
  fontFileSupported,
  fontRecordForLayer,
  registerFontFile,
  restoreStoredFonts,
} from "./fonts.js";

import { cloneTextLayers, normalizeTextLayers, createTextLayer, textLayerMetrics, drawTextLayers, clamp, validColor } from "../compositor/text.js";
import { getProcessingScheduler } from "../processing/client.js";
export { cloneTextLayers, normalizeTextLayers, createTextLayer, textLayerMetrics, drawTextLayers } from "../compositor/text.js";

export function attachEditorText(editor) {
  const { elements, state } = editor;
  state.fonts ??= new Map();
  state.activeTextId ??= null;

  function retainFont(record) {
    const previous = state.fonts.get(record.id);
    if (previous?.face && previous.face !== record.face) document.fonts.delete(previous.face);
    state.fonts.set(record.id, record);
    getProcessingScheduler().setRetainedBytes("editor-fonts", [...state.fonts.values()].reduce((sum, font) => sum + (font.bytes?.byteLength ?? 0) * 6, 0));
  }

  function layers() {
    if (!state.operations) return [];
    state.operations.textLayers = normalizeTextLayers(state.operations.textLayers);
    return state.operations.textLayers;
  }

  function activeTextLayer() {
    const current = layers();
    return current.find((layer) => layer.id === state.activeTextId) ?? current.at(-1) ?? null;
  }

  function syncActiveText() {
    const current = layers();
    if (!current.some((layer) => layer.id === state.activeTextId)) state.activeTextId = current.at(-1)?.id ?? null;
  }

  function addTextLayer() {
    if (!state.image) return;
    const output = editor.estimateOutputDimensions?.() ?? { width: state.image.naturalWidth, height: state.image.naturalHeight };
    const layer = createTextLayer(output.width, output.height);
    editor.editWith((next) => {
      next.textLayers = normalizeTextLayers([...(next.textLayers ?? []), layer]);
    }, "Text added. Drag it on the canvas.");
    state.activeTextId = layer.id;
    state.tool = "text";
    editor.renderAll();
  }

  function removeActiveText() {
    const active = activeTextLayer();
    if (!active) return;
    editor.editWith((next) => {
      next.textLayers = (next.textLayers ?? []).filter((layer) => layer.id !== active.id);
    }, "Text removed.");
    state.activeTextId = state.operations.textLayers.at(-1)?.id ?? null;
    editor.renderAll();
  }

  function selectTextLayer(id) {
    if (!layers().some((layer) => layer.id === id)) return;
    state.activeTextId = id;
    state.tool = "text";
    editor.renderAll();
  }

  function updateActiveText(field, value) {
    const active = activeTextLayer();
    if (!active) return;
    editor.beginControlEdit();
    if (field === "text") active.text = String(value).slice(0, 5000);
    if (field === "fontId") {
      const font = fontRecordForLayer(state.fonts, { fontId: value });
      active.fontId = value;
      active.fontFamily = font.family;
      if (font.bytes) { active.fontBytes = font.bytes.byteLength; active.fontSha256 = font.sha256; }
      else { delete active.fontBytes; delete active.fontSha256; }
    }
    if (field === "fontSize") active.fontSize = clamp(Number(value), 0.015, 0.7, active.fontSize);
    if (field === "color" && validColor(value)) active.color = value;
    if (field === "align" && ["left", "center", "right"].includes(value)) active.align = value;
    if (field === "weight" && ["400", "600", "700", "800"].includes(String(value))) active.weight = String(value);
    if (field === "style") active.style = value === "italic" ? "italic" : "normal";
    editor.renderTextPanel();
    editor.renderCanvas();
    editor.scheduleProcessing();
  }

  function finishTextEdit(message = "Text updated. Updating preview…") {
    editor.finishControlEdit(message);
  }

  async function importFont(file) {
    try {
      const record = await registerFontFile(file);
      retainFont(record);
      const active = activeTextLayer();
      if (active) {
        editor.editWith((next) => {
          const layer = next.textLayers?.find((candidate) => candidate.id === active.id);
          if (!layer) return;
          layer.fontId = record.id;
          layer.fontFamily = record.family;
          layer.fontBytes = record.bytes.byteLength;
          layer.fontSha256 = record.sha256;
        }, `${record.name} added. Updating preview…`);
      }
      editor.renderAll();
      editor.setProcessingStatus(`${record.name} is ready. It stays on this device.`, false);
    } catch (error) {
      editor.setProcessingStatus(error?.userMessage ?? "That font could not be loaded. Try a .ttf, .otf, .woff, or .woff2 file.", false, true);
    }
  }

  function onFontDrop(event) {
    event.preventDefault();
    delete elements.fontDropZone.dataset.dragging;
    const file = Array.from(event.dataTransfer?.files ?? []).find(fontFileSupported);
    if (file) void importFont(file);
    else if (event.dataTransfer?.types?.includes("text/uri-list") || event.dataTransfer?.types?.includes("text/plain")) {
      editor.setProcessingStatus("Download the font file from Google Fonts, then drop the .ttf, .otf, .woff, or .woff2 file here.", false, true);
    } else {
      editor.setProcessingStatus("Drop a .ttf, .otf, .woff, or .woff2 font file here.", false, true);
    }
  }

  function textFrame(layout) {
    const sourceWidth = (layout.rotation % 180 !== 0 ? layout.crop.height : layout.crop.width) * layout.scale;
    const sourceHeight = (layout.rotation % 180 !== 0 ? layout.crop.width : layout.crop.height) * layout.scale;
    return {
      left: layout.centerX - sourceWidth / 2,
      top: layout.centerY - sourceHeight / 2,
      width: sourceWidth,
      height: sourceHeight,
    };
  }

  function textOutputDimensions() {
    return editor.estimateOutputDimensions?.() ?? {
      width: state.image?.naturalWidth ?? 1,
      height: state.image?.naturalHeight ?? 1,
    };
  }

  function textLayerBoxes(layout, ctx = elements.canvas.getContext("2d")) {
    const output = textOutputDimensions();
    const frame = textFrame(layout);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Measuring must not paint a second copy of every layer onto the editor
    // canvas. This function runs during hit-testing and selection rendering.
    const metrics = layers().map((layer) => textLayerMetrics(ctx, layer, output.width, output.height, state.fonts));
    ctx.restore();
    return metrics.map((metric) => ({
      id: metric.layer.id,
      left: frame.left + (metric.box.x / output.width) * frame.width,
      top: frame.top + (metric.box.y / output.height) * frame.height,
      right: frame.left + ((metric.box.x + metric.box.width) / output.width) * frame.width,
      bottom: frame.top + ((metric.box.y + metric.box.height) / output.height) * frame.height,
    }));
  }

  function textLayerAtPoint(point, layout) {
    const boxes = textLayerBoxes(layout);
    return [...boxes].reverse().find((box) => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom) ?? null;
  }

  function textResizeHandleAtPoint(point, layout) {
    const box = textLayerBoxes(layout).find((candidate) => candidate.id === state.activeTextId);
    if (!box) return null;
    return Math.abs(point.x - box.right) < 20 && Math.abs(point.y - box.bottom) < 20 ? box : null;
  }

  function textPointToNormalized(point, layout) {
    const frame = textFrame(layout);
    const output = textOutputDimensions();
    return {
      x: (point.x - frame.left) / Math.max(1, frame.width),
      y: (point.y - frame.top) / Math.max(1, frame.height),
      width: output.width,
      height: output.height,
    };
  }

  function drawTextOnCanvas(ctx, layout, showSelection = state.tool === "text") {
    if (state.preview !== "edited" || state.tool === "crop" || !layers().length) return;
    const output = textOutputDimensions();
    const frame = textFrame(layout);
    // Once the generated result has loaded, it already contains the composed
    // text. Only paint the browser preview overlay while that result is still
    // being produced; otherwise the visible canvas would show the words twice
    // while the downloaded bytes contain them once.
    const hasComposedResult = state.result?.revision === state.revision && state.result.image;
    if (!hasComposedResult) {
      ctx.save();
      ctx.translate(frame.left, frame.top);
      ctx.scale(frame.width / Math.max(1, output.width), frame.height / Math.max(1, output.height));
      drawTextLayers(ctx, layers(), output.width, output.height, state.fonts);
      ctx.restore();
    }
    if (!showSelection) return;
    const boxes = textLayerBoxes(layout, ctx);
    const active = boxes.find((box) => box.id === state.activeTextId);
    if (!active) return;
    ctx.save();
    ctx.strokeStyle = "#a7f36e";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(active.left, active.top, active.right - active.left, active.bottom - active.top);
    ctx.setLineDash([]);
    ctx.fillStyle = "#a7f36e";
    ctx.fillRect(active.right - 7, active.bottom - 7, 14, 14);
    ctx.restore();
  }

  function renderTextPanel() {
    if (!elements.textLayerList) return;
    const current = layers();
    syncActiveText();
    const active = activeTextLayer();
    elements.textLayerList.replaceChildren();
    for (const layer of current) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-layer-item";
      button.setAttribute("aria-pressed", String(layer.id === state.activeTextId));
      button.textContent = layer.text.trim() || "Empty text";
      button.title = layer.text;
      button.addEventListener("click", () => selectTextLayer(layer.id));
      elements.textLayerList.append(button);
    }
    const enabled = Boolean(state.image && active);
    elements.textContent.value = active?.text ?? "";
    elements.textContent.disabled = !enabled;
    elements.textFont.replaceChildren();
    for (const font of [...BUILTIN_FONTS, ...state.fonts.values()]) {
      const option = document.createElement("option");
      option.value = font.id;
      option.textContent = font.name;
      option.style.fontFamily = font.family;
      option.selected = font.id === active?.fontId;
      elements.textFont.append(option);
    }
    elements.textFont.disabled = !enabled;
    elements.textSize.value = String(active?.fontSize ?? 0.12);
    elements.textSize.disabled = !enabled;
    elements.textSizeValue.textContent = active ? `${Math.round(active.fontSize * textOutputDimensions().height)} px` : "—";
    elements.textColor.value = validColor(active?.color) ? active.color : "#ffffff";
    elements.textColor.disabled = !enabled;
    elements.textAlign.value = active?.align ?? "center";
    elements.textAlign.disabled = !enabled;
    elements.textWeight.value = active?.weight ?? "700";
    elements.textWeight.disabled = !enabled;
    elements.textStyle.value = active?.style ?? "normal";
    elements.textStyle.disabled = !enabled;
    elements.removeTextButton.disabled = !enabled;
    elements.textPanelEmpty.hidden = current.length > 0;
    elements.textControls.hidden = !active;
  }

  function restoreFonts() {
    state.fontsReady = restoreStoredFonts().then((records) => {
      for (const record of records) retainFont(record);
      editor.renderTextPanel?.();
      editor.renderCanvas?.();
    });
    return state.fontsReady;
  }

  Object.assign(editor, {
    cloneTextLayers,
    normalizeTextLayers,
    addTextLayer,
    removeActiveText,
    selectTextLayer,
    activeTextLayer,
    syncActiveText,
    updateActiveText,
    finishTextEdit,
    importFont,
    onFontDrop,
    textFrame,
    textLayerBoxes,
    textLayerAtPoint,
    textResizeHandleAtPoint,
    textPointToNormalized,
    drawTextOnCanvas,
    renderTextPanel,
    restoreFonts,
  });
  restoreFonts();
}
