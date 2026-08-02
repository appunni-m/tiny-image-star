import { formatMime, formatLabel } from "../formats.js";
import {
  BUILTIN_FONTS,
  fontFileSupported,
  fontRecordForLayer,
  registerFontFile,
  restoreStoredFonts,
} from "./fonts.js";

const MIN_TEXT_SIZE = 8;
const MAX_TEXT_SIZE = 2048;

function nextId() {
  if (globalThis.crypto?.randomUUID) return `text-${globalThis.crypto.randomUUID()}`;
  return `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function cloneLayer(layer) {
  return layer && typeof layer === "object" ? { ...layer } : null;
}

export function cloneTextLayers(layers) {
  return Array.isArray(layers) ? layers.map(cloneLayer).filter(Boolean) : [];
}

export function normalizeTextLayers(layers) {
  return cloneTextLayers(layers).map((layer) => ({
    id: String(layer.id ?? nextId()),
    text: String(layer.text ?? "Your text").slice(0, 5000),
    x: clamp(Number(layer.x), 0, 1, 0.5),
    y: clamp(Number(layer.y), 0, 1, 0.5),
    width: clamp(Number(layer.width), 0.08, 1.5, 0.72),
    fontSize: clamp(Number(layer.fontSize), 0.015, 0.7, 0.12),
    fontId: String(layer.fontId ?? "system-sans"),
    fontFamily: String(layer.fontFamily ?? "Arial, Helvetica, sans-serif"),
    color: validColor(layer.color) ? layer.color : "#ffffff",
    align: ["left", "center", "right"].includes(layer.align) ? layer.align : "center",
    weight: ["400", "600", "700", "800"].includes(String(layer.weight)) ? String(layer.weight) : "700",
    style: layer.style === "italic" ? "italic" : "normal",
    opacity: clamp(Number(layer.opacity), 0, 1, 1),
    rotation: normalizeRotation(layer.rotation),
    shadow: layer.shadow !== false,
  }));
}

export function createTextLayer(width = 1000, height = 1000) {
  return {
    id: nextId(),
    text: "Your text",
    x: 0.5,
    y: 0.5,
    width: 0.72,
    fontSize: clamp(96 / Math.max(1, height), 0.015, 0.7, 0.12),
    fontId: "system-sans",
    fontFamily: BUILTIN_FONTS[0].family,
    color: "#ffffff",
    align: "center",
    weight: "700",
    style: "normal",
    opacity: 1,
    rotation: 0,
    shadow: true,
  };
}

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function normalizeRotation(value) {
  const rotation = Number(value);
  if (!Number.isFinite(rotation)) return 0;
  return ((rotation % 360) + 360) % 360;
}

function validColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function fontSizeForLayer(layer, height) {
  return clamp(Number(layer.fontSize) * height, MIN_TEXT_SIZE, MAX_TEXT_SIZE, 48);
}

function wrapLine(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function layerFont(ctx, layer, width, height, fonts) {
  const font = fontRecordForLayer(fonts, layer);
  const size = fontSizeForLayer(layer, height);
  ctx.font = `${layer.style === "italic" ? "italic " : ""}${layer.weight ?? "700"} ${size}px ${font.family}`;
  return { font, size };
}

export function textLayerMetrics(ctx, layer, width, height, fonts) {
  const safeLayer = normalizeTextLayers([layer])[0] ?? createTextLayer(width, height);
  const { font, size } = layerFont(ctx, safeLayer, width, height, fonts);
  const boxWidth = clamp(safeLayer.width * width, 24, Math.max(24, width * 1.5), Math.max(24, width * 0.72));
  const lineHeight = size * 1.2;
  const lines = String(safeLayer.text).split("\n").flatMap((line) => wrapLine(ctx, line, boxWidth));
  const textHeight = Math.max(lineHeight, lines.length * lineHeight);
  return {
    layer: safeLayer,
    font,
    size,
    lines,
    lineHeight,
    box: {
      x: safeLayer.x * width - boxWidth / 2,
      y: safeLayer.y * height - textHeight / 2,
      width: boxWidth,
      height: textHeight,
    },
  };
}

export function drawTextLayers(ctx, layers, width, height, fonts, { selectionId = null } = {}) {
  const metrics = [];
  for (const sourceLayer of normalizeTextLayers(layers)) {
    const metric = textLayerMetrics(ctx, sourceLayer, width, height, fonts);
    metrics.push(metric);
    const { layer, box, lines, lineHeight } = metric;
    ctx.save();
    ctx.translate(layer.x * width, layer.y * height);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.globalAlpha = layer.opacity;
    ctx.textAlign = layer.align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = layer.color;
    if (layer.shadow) {
      ctx.shadowColor = "rgba(0, 0, 0, .48)";
      ctx.shadowBlur = Math.max(2, metric.size * 0.08);
      ctx.shadowOffsetX = Math.max(1, metric.size * 0.03);
      ctx.shadowOffsetY = Math.max(1, metric.size * 0.03);
    }
    const x = layer.align === "left" ? -box.width / 2 : layer.align === "right" ? box.width / 2 : 0;
    const top = -box.height / 2 + lineHeight / 2;
    for (let index = 0; index < lines.length; index += 1) {
      ctx.fillText(lines[index], x, top + index * lineHeight, box.width);
    }
    ctx.restore();
  }
  return metrics;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The text layer could not be encoded.")), type, quality);
  });
}

function signatureMatches(bytes, format) {
  if (format === "png") return bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  if (format === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (format === "webp") {
    const header = new TextDecoder().decode(bytes.slice(0, 12));
    return header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
  }
  return false;
}

function textExportError(format) {
  const error = new Error(`Text export is not available for ${formatLabel(format)} in this browser. Choose PNG, or remove the text layer.`);
  error.userMessage = error.message;
  error.code = "text-format-unavailable";
  return error;
}

export async function composeTextOutput(editor, result, operations) {
  const layers = normalizeTextLayers(operations?.textLayers);
  if (!layers.length) return result;
  await editor.state.fontsReady;
  const format = String(result.format ?? operations?.format ?? "png").toLowerCase();
  if (! ["png", "jpeg", "webp"].includes(format)) throw textExportError(format);
  for (const layer of layers) {
    if (layer.fontId && !BUILTIN_FONTS.some((font) => font.id === layer.fontId) && !editor.state.fonts?.has(layer.fontId)) {
      const error = new Error(`The font for “${layer.text.slice(0, 24)}” is not loaded. Drop the font file again before downloading.`);
      error.userMessage = error.message;
      error.code = "font-missing";
      throw error;
    }
  }
  const inputBytes = result.output instanceof Uint8Array ? result.output : new Uint8Array(result.output);
  const inputUrl = URL.createObjectURL(new Blob([inputBytes], { type: result.mime ?? formatMime(format) }));
  try {
    const image = await editor.loadImage(inputUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(result.width));
    canvas.height = Math.max(1, Math.round(result.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The text layer could not be drawn.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    drawTextLayers(ctx, layers, canvas.width, canvas.height, editor.state.fonts);
    const mime = formatMime(format);
    const quality = format === "png" ? undefined : Math.max(0.01, Math.min(1, Number(operations?.quality ?? 95) / 100));
    const blob = await canvasBlob(canvas, mime, quality);
    const output = new Uint8Array(await blob.arrayBuffer());
    if (blob.type !== mime || !signatureMatches(output, format)) throw textExportError(format);
    return {
      ...result,
      output,
      outputBytes: output.byteLength,
      mime,
      format,
    };
  } finally {
    URL.revokeObjectURL(inputUrl);
  }
}

export function attachEditorText(editor) {
  const { elements, state } = editor;
  state.fonts ??= new Map();
  state.activeTextId ??= null;

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
      state.fonts.set(record.id, record);
      const active = activeTextLayer();
      if (active) {
        editor.editWith((next) => {
          const layer = next.textLayers?.find((candidate) => candidate.id === active.id);
          if (!layer) return;
          layer.fontId = record.id;
          layer.fontFamily = record.family;
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
      for (const record of records) state.fonts.set(record.id, record);
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
    composeTextOutput: (result, operations) => composeTextOutput(editor, result, operations),
    restoreFonts,
  });
  restoreFonts();
}
