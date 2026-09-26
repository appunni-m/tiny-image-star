import { BUILTIN_FONTS, fontRecordForLayer } from "./fonts.js";

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
    ...(layer.fontBytes != null ? { fontBytes: layer.fontBytes } : {}),
    ...(layer.fontSha256 != null ? { fontSha256: layer.fontSha256 } : {}),
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

export function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function normalizeRotation(value) {
  const rotation = Number(value);
  if (!Number.isFinite(rotation)) return 0;
  return ((rotation % 360) + 360) % 360;
}

export function validColor(value) {
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
