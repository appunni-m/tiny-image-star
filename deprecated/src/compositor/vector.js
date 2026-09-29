import { builtinFontById } from "./fonts.js";
import { sceneError } from "./scene-spec.js";

function surface(width, height) {
  if (typeof OffscreenCanvas !== "function") throw sceneError("UNSUPPORTED_OPERATION", "This browser cannot render story layers. Use a current browser.");
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
  if (!context) throw sceneError("TOO_LARGE", "The story surface could not be created. Choose smaller output dimensions.");
  return { canvas, context };
}

function atFrame(ctx, node) {
  const frame = node.canonicalViewport;
  ctx.translate(frame.x + frame.width / 2, frame.y + frame.height / 2);
  ctx.rotate((node.rotation ?? 0) * Math.PI / 180);
}

// Canvas path antialiasing can change when a primitive is clipped by a
// differently sized drawing surface. Align the raster grid to the object's
// integer origin, with overlap, then copy each viewport from those same tiles.
// The grid must also translate with the object: shifting an entire spread by
// an odd number of pixels cannot change its clipping/antialiasing phase.
function rasterTiles(node, width, height, paint) {
  const tileSize = 256, pad = Math.max(64, node.bounds.padding);
  const { canvas, context: ctx } = surface(tileSize + pad * 2, tileSize + pad * 2);
  const output = new Uint8Array(width * height * 4), origin = node.originX;
  const bounds = node.bounds;
  const gridX = Math.floor(node.canonicalViewport.x);
  const firstX = gridX + Math.floor((origin + Math.max(0, bounds.x) - gridX) / tileSize) * tileSize;
  const endX = origin + Math.min(width, bounds.x + bounds.width);
  const firstY = Math.floor(Math.max(0, bounds.y) / tileSize) * tileSize;
  const endY = Math.min(height, bounds.y + bounds.height);
  try {
    for (let y = firstY; y < endY; y += tileSize) for (let x = firstX; x < endX; x += tileSize) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save(); ctx.translate(pad - x, pad - y);
      paint(ctx); ctx.restore();
      const left = Math.max(origin, x), top = Math.max(0, y), right = Math.min(origin + width, x + tileSize), bottom = Math.min(height, y + tileSize);
      const data = ctx.getImageData(left - x + pad, top - y + pad, right - left, bottom - top).data;
      for (let row = 0; row < bottom - top; row++) output.set(data.subarray(row * (right - left) * 4, (row + 1) * (right - left) * 4), ((top + row) * width + left - origin) * 4);
    }
    // Layer opacity applies once to the completed fill/stroke/shadow group,
    // not separately to overlapping draw calls within the layer.
    if (node.opacity != null && node.opacity !== 1) for (let index = 3; index < output.length; index += 4) output[index] = Math.round(output[index] * node.opacity);
    return output;
  } finally { canvas.width = canvas.height = 1; }
}

export function frameMask(api, node, width, height) {
  const pixels = rasterTiles(node, width, height, (ctx) => {
    atFrame(ctx, node); ctx.fillStyle = "#ffffff";
    const frame = node.viewport, radius = Math.min(frame.width, frame.height) * (node.style?.radius ?? 0);
    ctx.beginPath();
    if (radius > 0) ctx.roundRect(-frame.width / 2, -frame.height / 2, frame.width, frame.height, radius);
    else ctx.rect(-frame.width / 2, -frame.height / 2, frame.width, frame.height);
    ctx.fill();
  });
  const alpha = new Uint8Array(width * height);
  for (let index = 0; index < alpha.length; index++) alpha[index] = pixels[index * 4 + 3];
  return api.fromBytesFn("L", width, height, alpha, "raw");
}

function wrap(ctx, text, width) {
  const lines = [];
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      const combined = line ? `${line} ${word}` : word;
      if (ctx.measureText(combined).width <= width) { line = combined; continue; }
      if (line) { lines.push(line); line = ""; }
      if (ctx.measureText(word).width <= width) { line = word; continue; }
      const glyphs = segmenter ? [...segmenter.segment(word)].map((entry) => entry.segment) : Array.from(word);
      // Long unbroken captions wrap by grapheme, never Canvas maxWidth scaling.
      for (const glyph of glyphs) {
        if (line && ctx.measureText(line + glyph).width > width) { lines.push(line); line = ""; }
        line += glyph;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

export function layoutSceneText(ctx, node, height, fonts, width = height) {
  const style = node.style ?? {}, frame = node.viewport;
  const family = node.fontId ? fonts.get(node.fontId)?.family : builtinFontById(style.builtinFont).family;
  if (!family) throw sceneError("MISSING_ASSET", "A story font is missing.");
  const basis = style.fontBasis === "width" ? width : height;
  const preferred = (style.fontSize ?? .05) * basis;
  const minimum = Math.min(preferred, (style.minFontSize ?? .012) * basis);
  const measure = (size) => {
    ctx.font = `${style.italic ? "italic " : ""}${style.weight ?? 700} ${size}px ${family}`;
    const lines = wrap(ctx, node.text, frame.width);
    const lineHeight = size * (style.lineHeight ?? 1.2);
    return { size, font: ctx.font, lines, lineHeight, overflow: lines.length * lineHeight > frame.height + .001 || lines.some((line) => ctx.measureText(line).width > frame.width + .001) };
  };
  let layout = measure(preferred);
  if (layout.overflow && style.fit !== "clip") {
    let low = minimum, high = preferred; layout = measure(low);
    if (!layout.overflow) for (let step = 0; step < 10; step++) {
      const size = (low + high) / 2, candidate = measure(size);
      if (candidate.overflow) high = size; else { low = size; layout = candidate; }
    }
  }
  ctx.font = layout.font;
  return layout;
}

function pathCommands(ctx, path, frame) {
  const point = (entry) => ({ x: (entry.x - .5) * frame.width, y: (entry.y - .5) * frame.height });
  const points = path.points;
  const first = point(points[0]); ctx.moveTo(first.x, first.y);
  const segment = (from, to) => {
    const start = point(from), end = point(to);
    if (from.handleOut || to.handleIn) {
      const control1 = from.handleOut ? point(from.handleOut) : start;
      const control2 = to.handleIn ? point(to.handleIn) : end;
      ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
    } else ctx.lineTo(end.x, end.y);
  };
  for (let index = 1; index < points.length; index++) segment(points[index - 1], points[index]);
  if (path.closed) { segment(points.at(-1), points[0]); ctx.closePath(); }
}

export function rasterSceneNode(api, node, width, height, fonts, warnings) {
  let layout;
  const pixels = rasterTiles(node, width, height, (ctx) => {
    atFrame(ctx, node);
    const frame = node.viewport, style = node.style ?? {};
    ctx.fillStyle = node.color ?? (node.kind === "text" ? "#202124" : "#ffffff");
    if (node.kind === "shape" && style.shape === "path") {
      ctx.beginPath(); pathCommands(ctx, style.path, frame);
      if (style.path.closed) { ctx.fillStyle = node.color ?? "#5149d5"; ctx.fill(); }
      if (style.strokeColor && style.strokeWidth) {
        ctx.strokeStyle = style.strokeColor; ctx.lineWidth = Math.min(frame.width, frame.height) * style.strokeWidth; ctx.stroke();
      }
    } else if (node.kind === "shape" || node.kind === "frame") {
      ctx.beginPath();
      if (node.kind === "shape" && style.shape === "ellipse") ctx.ellipse(0, 0, frame.width / 2, frame.height / 2, 0, 0, Math.PI * 2);
      else if ((node.kind === "shape" && style.shape === "rounded") || (node.kind === "frame" && style.radius)) ctx.roundRect(-frame.width / 2, -frame.height / 2, frame.width, frame.height,
        Math.min(frame.width, frame.height) * (style.radius ?? .08));
      else ctx.rect(-frame.width / 2, -frame.height / 2, frame.width, frame.height);
      ctx.fill();
      if (style.strokeColor && style.strokeWidth) {
        ctx.strokeStyle = style.strokeColor; ctx.lineWidth = Math.min(frame.width, frame.height) * style.strokeWidth; ctx.stroke();
      }
    } else {
      if (!layout) {
        layout = layoutSceneText(ctx, node, height, fonts, width);
        if (layout.overflow) warnings.push({ code: "TEXT_OVERFLOW", nodeId: node.id });
      }
      ctx.font = layout.font;
      if (layout.overflow) {
        ctx.beginPath(); ctx.rect(-frame.width / 2, -frame.height / 2, frame.width, frame.height); ctx.clip();
      }
      if (style.shadow) {
        ctx.shadowColor = style.shadow.color; ctx.shadowBlur = style.shadow.blur * height;
        ctx.shadowOffsetX = style.shadow.x * height; ctx.shadowOffsetY = style.shadow.y * height;
      }
      ctx.textAlign = style.align ?? "center"; ctx.textBaseline = "middle";
      const x = ctx.textAlign === "left" ? -frame.width / 2 : ctx.textAlign === "right" ? frame.width / 2 : 0;
      const blockHeight = layout.lines.length * layout.lineHeight;
      const top = style.verticalAlign === "top" ? -frame.height / 2 : style.verticalAlign === "bottom" ? frame.height / 2 - blockHeight : -blockHeight / 2;
      for (const [index, line] of layout.lines.entries()) ctx.fillText(line, x, top + (index + .5) * layout.lineHeight);
    }
  });
  return api.fromBytesFn("RGBA", width, height, pixels, "raw");
}
