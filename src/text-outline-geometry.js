import { drawTextLayerContent } from './renderer.js';
import { findNode, getNodeGeometry, getNodeTextPath } from './model.js';
import { resolveTextPositionView, TextPositionPendingError } from './text-position.js';
import { hasTextLeadingTrim, TextLeadingTrimPendingError } from './text-leading-trim.js';
import { TextLineMetricsPendingError } from './text-line-metrics.js';

export const TEXT_OUTLINE_LIMITS = Object.freeze({
  maxTextCodeUnits: 32_768, maxGlyphs: 1_024, maxContours: 4_096, maxCommands: 20_000,
  maxGlyphPathCharacters: 131_072, maxCoordinate: 10_000_000,
  maxShapeQueries: 2_048, maxShapeCacheBytes: 16 * 1024 * 1024,
  maxSourceCharacters: 2 * 1024 * 1024, timeoutMs: 30_000
});
export const TEXT_OUTLINE_SVG_LIMITS = Object.freeze({ ...TEXT_OUTLINE_LIMITS,
  maxGlyphs: 65_536, maxContours: 262_144, maxCommands: 1_000_000,
  maxShapeQueries: 32_768, maxShapeCacheBytes: 64 * 1024 * 1024 });

export class TextOutlineGeometryError extends Error {
  constructor(message, code = 'TEXT_OUTLINE_UNAVAILABLE') {
    super(message); this.name = 'TextOutlineGeometryError'; this.code = code;
  }
}
const fail = message => { throw new TextOutlineGeometryError(message); };
const abort = signal => { if (signal?.aborted) throw new DOMException('Text outlining cancelled.', 'AbortError'); };
function positionShapeValue(node, shapeText, text, style) {
  const value = shapeText?.(text, style);
  if (value == null && node.__textPositionResolved && typeof shapeText === 'function' && shapeText.fontStatus?.(style, text) !== 'none') {
    throw new TextPositionPendingError();
  }
  if (value == null && hasTextLeadingTrim(node) && !node.textPath && typeof shapeText === 'function' && shapeText.fontStatus?.(style, text) !== 'none') {
    throw new TextLeadingTrimPendingError();
  }
  if (value == null && typeof shapeText?.fontStatus === 'function' && shapeText.fontStatus(style, text) !== 'none') throw new TextLineMetricsPendingError();
  return value;
}
const coordinate = value => {
  if (!Number.isFinite(value) || Math.abs(value) > TEXT_OUTLINE_LIMITS.maxCoordinate) fail('A local font outline exceeds the supported coordinate range.');
  return Object.is(value, -0) ? 0 : value;
};
const point = (x, y) => ({ x: coordinate(x), y: coordinate(y) });
const identity = () => [1, 0, 0, 1, 0, 0];
const transformPoint = (matrix, value) => point(matrix[0] * value.x + matrix[2] * value.y + matrix[4], matrix[1] * value.x + matrix[3] * value.y + matrix[5]);
const multiply = (left, right) => [
  left[0] * right[0] + left[2] * right[1], left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3], left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4], left[1] * right[4] + left[3] * right[5] + left[5]
].map(coordinate);

function colorPaint(value, opacity = 1) {
  if (value === 'transparent') return { color: '#000000', opacity: 0 };
  if (typeof value !== 'string') fail('The text paint cannot be represented as an editable solid color.');
  if (/^#[\da-f]{3}$/iu.test(value)) return { color: `#${[...value.slice(1)].map(item => item.repeat(2)).join('').toLowerCase()}`, opacity };
  if (/^#[\da-f]{6}$/iu.test(value)) return { color: value.toLowerCase(), opacity };
  const rgba = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/u);
  if (!rgba) fail('The text paint cannot be represented as an editable solid color.');
  const channels = rgba.slice(1, 4).map(Number); const alpha = rgba[4] == null ? 1 : Number(rgba[4]);
  if (channels.some(value => value < 0 || value > 255) || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) fail('The local text paint is invalid.');
  return { color: `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`, opacity: alpha * opacity };
}

/** Font paths are geometry only: no SVG elements, attributes, assets or metadata. */
function fontContours(data, limits = TEXT_OUTLINE_LIMITS) {
  if (typeof data !== 'string' || data.length > TEXT_OUTLINE_LIMITS.maxGlyphPathCharacters) fail('A local glyph path exceeds the supported outline limit.');
  const tokens = []; const token = /[MLHVQCZmlhvqcz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/gu;
  let cursor = 0;
  for (const match of data.matchAll(token)) {
    if (!/^[\s,]*$/u.test(data.slice(cursor, match.index))) fail('The local glyph path contains an unsupported command.');
    tokens.push(match[0]); cursor = match.index + match[0].length;
    if (tokens.length > limits.maxCommands * 7) fail('The local glyph path exceeds the bounded command limit.');
  }
  if (!/^[\s,]*$/u.test(data.slice(cursor))) fail('The local glyph path contains malformed geometry.');
  const contours = []; let current = null; let position = point(0, 0); let index = 0; let command = null;
  const read = () => {
    if (index >= tokens.length || /^[a-z]$/iu.test(tokens[index])) fail('The local glyph path has incomplete coordinates.');
    return coordinate(Number(tokens[index++]));
  };
  const readPoint = relative => {
    const x = read(); const y = read();
    return point(x + (relative ? position.x : 0), y + (relative ? position.y : 0));
  };
  while (index < tokens.length) {
    if (/^[a-z]$/iu.test(tokens[index])) command = tokens[index++];
    if (!command) fail('The local glyph path has no starting command.');
    const relative = command === command.toLowerCase(); const type = command.toUpperCase();
    if (type === 'Z') {
      if (!current) fail('The local glyph path closes an absent contour.');
      current.closed = true; position = current.start; current = null; command = null; continue;
    }
    if (type === 'M') {
      if (current && !current.closed) fail('The local glyph path contains an open filled contour.');
      const start = readPoint(relative); current = { start, commands: [], closed: false }; contours.push(current); position = start;
      command = relative ? 'l' : 'L'; continue;
    }
    if (!current) fail('The local glyph path has no open contour.');
    const start = position; let item;
    if (type === 'L') item = { type: 'line', start, end: readPoint(relative) };
    else if (type === 'H') item = { type: 'line', start, end: point(read() + (relative ? position.x : 0), position.y) };
    else if (type === 'V') item = { type: 'line', start, end: point(position.x, read() + (relative ? position.y : 0)) };
    else if (type === 'Q') item = { type: 'quadratic', start, control: readPoint(relative), end: readPoint(relative) };
    else if (type === 'C') item = { type: 'cubic', start, control1: readPoint(relative), control2: readPoint(relative), end: readPoint(relative) };
    else fail('The local glyph path uses an unsupported curve command.');
    current.commands.push(item); position = item.end;
    if (current.commands.length > limits.maxCommands) fail('The local glyph path exceeds the bounded command limit.');
  }
  if (current && !current.closed) fail('The local glyph path contains an open filled contour.');
  return contours.filter(contour => contour.commands.length);
}

function transformedContours(contours, matrix) {
  return contours.map(contour => ({ start: transformPoint(matrix, contour.start), closed: contour.closed,
    commands: contour.commands.map(command => ({ ...command, start: transformPoint(matrix, command.start), end: transformPoint(matrix, command.end),
      ...(command.control ? { control: transformPoint(matrix, command.control) } : {}),
      ...(command.control1 ? { control1: transformPoint(matrix, command.control1), control2: transformPoint(matrix, command.control2) } : {}) })) }));
}

const shapeFor = contours => ({ fillRule: 'nonzero', fillGroups: contours.length ? [{ fillRule: 'nonzero', contours }] : [],
  strokeContours: contours, alignedStrokeContours: contours });
const rectangleContours = (x, y, width, height, matrix) => {
  const points = [point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)];
  return transformedContours([{ start: points[0], closed: true,
    commands: points.slice(1).map((end, index) => ({ type: 'line', start: points[index], end })) }], matrix);
};

function checkShaped(shaped, text, state = { depth: 0, pathCharacters: 0, glyphs: 0 }, limits = TEXT_OUTLINE_LIMITS) {
  if (state.depth > 16) fail('The local font fallback structure is too deep.');
  if (Array.isArray(shaped?.mixedRuns)) {
    if (shaped.mixedRuns.map(run => run.text).join('') !== text) fail('The local fallback runs do not match the requested text.');
    if (shaped.mixedRuns.length > limits.maxShapeQueries) fail('The local font fallback structure exceeds the supported run limit.');
    state.depth++;
    for (const run of shaped.mixedRuns) checkShaped(run.shaped, run.text, state, limits);
    state.depth--;
    return shaped;
  }
  if (!shaped || shaped.missingGlyph || !Array.isArray(shaped.glyphs) || !Number.isFinite(shaped.upem) || shaped.upem <= 0
    || !Number.isFinite(shaped.extents?.ascender)) fail('Every displayed character needs a retained local font with an actual glyph outline. Import a font covering this text before outlining.');
  state.glyphs += shaped.glyphs.length;
  if (state.glyphs > 65_536) fail('The local shaped run exceeds the bounded glyph limit.');
  for (const glyph of shaped.glyphs) {
    if (!Number.isSafeInteger(glyph.id) || glyph.id <= 0 || !Number.isSafeInteger(glyph.cluster) || glyph.cluster < 0 || glyph.cluster >= text.length
      || ['xAdvance', 'yAdvance', 'xOffset', 'yOffset'].some(key => !Number.isFinite(glyph[key])) || typeof glyph.path !== 'string') {
      fail('The local font shaper returned incomplete glyph geometry.');
    }
    state.pathCharacters += glyph.path.length;
    if (state.pathCharacters * 2 > limits.maxShapeCacheBytes) fail('The local shaped run exceeds the outline memory budget.');
  }
  return shaped;
}

class TextGeometryContext {
  constructor(signal, limits = TEXT_OUTLINE_LIMITS) {
    this.signal = signal; this.limits = limits; this.isTextGeometryContext = true; this.matrix = identity(); this.stack = []; this.path = null;
    this.fillStyle = '#000000'; this.strokeStyle = '#000000'; this.globalAlpha = 1; this.lineWidth = 1;
    this.font = ''; this.textAlign = 'left'; this.textBaseline = 'top';
    this.glyphs = []; this.decorations = []; this.clipGeometry = null; this.commands = 0; this.contours = 0;
    this.paths = new Map();
  }
  save() { this.stack.push({ matrix: [...this.matrix], fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
    globalAlpha: this.globalAlpha, lineWidth: this.lineWidth, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline }); }
  restore() { const previous = this.stack.pop(); if (!previous) fail('The text layout restored an absent geometry state.'); Object.assign(this, previous); }
  translate(x, y) { this.matrix = multiply(this.matrix, [1, 0, 0, 1, coordinate(x), coordinate(y)]); }
  scale(x, y) { this.matrix = multiply(this.matrix, [coordinate(x), 0, 0, coordinate(y), 0, 0]); }
  captureTextStrokeTransform() { return [...this.matrix]; }
  rotate(value) { if (!Number.isFinite(value)) fail('The text path has an invalid angle.'); this.matrix = multiply(this.matrix, [Math.cos(value), Math.sin(value), -Math.sin(value), Math.cos(value), 0, 0]); }
  beginPath() { this.path = { points: [], matrix: [...this.matrix], rectangle: null }; }
  moveTo(x, y) { if (!this.path) this.beginPath(); this.path.points = [point(x, y)]; this.path.matrix = [...this.matrix]; }
  lineTo(x, y) { if (!this.path || this.path.points.length !== 1 || JSON.stringify(this.path.matrix) !== JSON.stringify(this.matrix)) fail('The text decoration is not a supported straight line.'); this.path.points.push(point(x, y)); }
  rect(x, y, width, height) { if (!this.path) this.beginPath(); this.path.rectangle = shapeFor(rectangleContours(x, y, width, height, this.matrix)); }
  clip() { if (!this.path?.rectangle) fail('The text layout uses an unsupported clipping region.'); this.clipGeometry = this.path.rectangle; }
  measureText() { fail('Browser font measurements cannot be converted into exact editable glyph outlines.'); }
  fillText() { fail('This text uses browser fallback glyphs. Import a local font covering every displayed character before outlining.'); }
  strokeText() { this.fillText(); }
  fill() { fail('The text layout contains an unsupported vector fill.'); }
  addContours(contours) {
    abort(this.signal); this.contours += contours.length; this.commands += contours.reduce((sum, contour) => sum + contour.commands.length + 1, 0);
    if (this.contours > this.limits.maxContours || this.commands > this.limits.maxCommands) fail('This text exceeds the bounded outline complexity budget. Export fewer characters at a time.');
  }
  drawLocalGlyphPath(data, metadata) {
    if (metadata.paintMode !== 'fill') fail('Glyph collection requires a fill geometry pass.');
    let contours = this.paths.get(data);
    if (!contours) { contours = fontContours(data, this.limits); this.paths.set(data, contours); }
    if (!contours.length) return;
    if (this.glyphs.length >= this.limits.maxGlyphs) fail(`This text exceeds the ${this.limits.maxGlyphs.toLocaleString('en-US')}-glyph outline limit. Export fewer characters at a time.`);
    const geometry = shapeFor(transformedContours(contours, this.matrix)); this.addContours(geometry.strokeContours);
    this.glyphs.push({ geometry, paint: colorPaint(this.fillStyle, this.globalAlpha), glyphId: metadata.glyphId,
      cluster: metadata.cluster, text: metadata.text, font: this.font,
      ...(metadata.strokeTransform ? { strokeTransform: [...metadata.strokeTransform] } : {}) });
  }
  drawLocalDecorationGeometry(contours, metadata) {
    const transformed = transformedContours(contours, this.matrix); this.addContours(transformed);
    const paint = metadata.paint === 'auto' ? colorPaint(this.fillStyle, this.globalAlpha)
      : { color: metadata.paint.color, opacity: metadata.paint.opacity * this.globalAlpha,
        visible: metadata.paint.visible !== false, ...(metadata.independent ? { independent: true } : {}) };
    this.decorations.push({ geometry: shapeFor(transformed), paint });
  }
  stroke() {
    if (!this.path || this.path.points.length !== 2) fail('The text decoration has unsupported geometry.');
    const [start, end] = this.path.points; const width = coordinate(this.lineWidth);
    if (!(width > 0)) return;
    const dx = end.x - start.x; const dy = end.y - start.y; const length = Math.hypot(dx, dy);
    if (!(length > 0)) return;
    const nx = -dy / length * width / 2; const ny = dx / length * width / 2;
    const points = [point(start.x + nx, start.y + ny), point(end.x + nx, end.y + ny), point(end.x - nx, end.y - ny), point(start.x - nx, start.y - ny)];
    const contours = transformedContours([{ start: points[0], closed: true,
      commands: points.slice(1).map((end, index) => ({ type: 'line', start: points[index], end })) }], this.path.matrix);
    this.addContours(contours); this.decorations.push({ geometry: shapeFor(contours), paint: colorPaint(this.strokeStyle, this.globalAlpha) });
  }
}

/** Record decorations through the editor layout without pretending fallback text is editable glyph geometry. */
export function collectTextDecorationGeometry(document, source, {
  measureText, shapeText = measureText?.shapeText, textInkBounds = measureText?.textInkBounds,
  leadingTrimMetrics = measureText?.leadingTrimMetrics, textLineMetrics = measureText?.textLineMetrics,
  colorOverride, fillOpacity = source?.fillOpacity ?? 1, decorationMode = 'all', forceDecorationGeometry = false, signal
} = {}) {
  abort(signal);
  if (source?.type !== 'text' || typeof measureText !== 'function') fail('A text layer and an actual text measurement resolver are required for decorations.');
  let node = { ...source, ...getNodeGeometry(document, source), ...(source.textPath ? { textPath: getNodeTextPath(document, source) } : {}) };
  if (!node.__textPositionResolved) node = resolveTextPositionView(node, { shapeText, strict: true }).node;
  const context = new TextGeometryContext(signal); context.skipInvisibleDecorations = true; let measurements = 0;
  context.measureText = text => {
    abort(signal); if (++measurements > 16_384) fail('Text decorations exceed the bounded measurement limit.');
    const match = context.font.match(/^(?:(italic)\s+)?([\d.]+)\s+([\d.]+)px\s+(.+)$/u);
    if (!match) fail('Text decorations require a valid active font measurement style.');
    const style = { fontStyle: match[1] || 'normal', fontWeight: Number(match[2]), fontSize: Number(match[3]), fontFamily: match[4] };
    const width = measureText(text, style); if (!Number.isFinite(width) || width < 0) fail('Text decorations require finite actual font measurements.');
    if (typeof textInkBounds !== 'function') return { width };
    const bounds = textInkBounds(text, style, { x: 0, y: 0, letterSpacing: 0, baseline: context.textBaseline === 'alphabetic' });
    if (!Array.isArray(bounds) || bounds.length > 4096 || bounds.some(item => !item || !['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(item[key])))) fail('Skip ink requires finite actual glyph bounds.');
    if (!bounds.length) return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 };
    return { width, actualBoundingBoxLeft: -Math.min(...bounds.map(item => item.left)), actualBoundingBoxRight: Math.max(...bounds.map(item => item.right)),
      actualBoundingBoxAscent: -Math.min(...bounds.map(item => item.top)), actualBoundingBoxDescent: Math.max(...bounds.map(item => item.bottom)) };
  };
  const decorationShape = typeof shapeText === 'function' ? (text, style) => positionShapeValue(node, shapeText, text, style) : null;
  if (decorationShape && shapeText.fontStatus) decorationShape.fontStatus = (...args) => shapeText.fontStatus(...args);
  for (const key of ['fontMetrics', 'fontMetricsStatus']) if (decorationShape && typeof shapeText[key] === 'function') decorationShape[key] = (...args) => shapeText[key](...args);
  const layout = drawTextLayerContent(context, node, document, 0, 0, node.width, node.height, {
    shapeText: decorationShape,
    colorOverride, fillOpacity, decorationMode, forceDecorationGeometry, decorationsOnly: true,
    leadingTrimMetrics, strictLeadingTrim: true, textLineMetrics, strictTextLineMetrics: typeof textLineMetrics === 'function'
  });
  abort(signal); return { decorations: context.decorations, ...(context.clipGeometry ? { clipGeometry: context.clipGeometry } : {}), layout };
}

/**
 * Replay the editor's rich/plain/path layout with real local glyph geometry.
 * Curves stay native Q/C in the resolved text-box coordinate system. Placement
 * is separate and must be applied once to an eventual replacement root.
 * clipGeometry clips completed fills AND outlined strokes for truncation;
 * fillClipGeometry only bounds explicit fill-paint planes. Neither should be
 * used to clip a glyph before stroking, which would invent box-edge strokes.
 */
export function collectTextOutlineGeometry(document, source, {
  shapeText, signal, includeDecorations = true, measureContext: _measureContext, leadingTrimMetrics, textLineMetrics, exportMode
} = {}) {
  abort(signal);
  if (source?.type !== 'text' || typeof shapeText !== 'function') fail('A text layer and a local font shaping resolver are required.');
  let node = { ...source, ...getNodeGeometry(document, source), ...(source.textPath ? { textPath: getNodeTextPath(document, source) } : {}) };
  if (!node.__textPositionResolved) node = resolveTextPositionView(node, { shapeText, strict: true }).node;
  if (![node.width, node.height].every(value => Number.isFinite(value) && value >= 0 && value <= TEXT_OUTLINE_LIMITS.maxCoordinate)) fail('The text box dimensions exceed the supported outline range.');
  const limits = exportMode === 'svg' ? TEXT_OUTLINE_SVG_LIMITS : TEXT_OUTLINE_LIMITS;
  const context = new TextGeometryContext(signal, limits); const shapeCache = new Map(); let shapeBytes = 0;
  const checkedShape = (text, style) => {
    abort(signal); if (typeof text !== 'string' || text.length > TEXT_OUTLINE_LIMITS.maxTextCodeUnits) fail('This text exceeds the local font shaping limit.');
    const key = JSON.stringify([text, style]);
    if (shapeCache.has(key)) return shapeCache.get(key);
    if (shapeCache.size >= limits.maxShapeQueries) fail('This text exceeds the bounded shaping-query limit.');
    const shaped = checkShaped(positionShapeValue(node, shapeText, text, style), text, undefined, limits);
    shapeBytes += (key.length + JSON.stringify(shaped).length) * 2;
    if (shapeBytes > limits.maxShapeCacheBytes) fail('This text exceeds the bounded shaping memory limit.');
    shapeCache.set(key, shaped); return shaped;
  };
  if (shapeText.fontStatus) checkedShape.fontStatus = (...args) => shapeText.fontStatus(...args);
  for (const key of ['fontMetrics', 'fontMetricsStatus']) if (typeof shapeText[key] === 'function') checkedShape[key] = (...args) => shapeText[key](...args);
  const layout = drawTextLayerContent(context, node, document, 0, 0, node.width, node.height, {
    shapeText: checkedShape, fillOpacity: 1, includeDecorations, leadingTrimMetrics, strictLeadingTrim: true, textLineMetrics, strictTextLineMetrics: true
  });
  abort(signal);
  const glyphFillGroups = context.glyphs.flatMap(record => record.geometry.fillGroups);
  const fillGroups = [...glyphFillGroups, ...context.decorations.flatMap(record => record.geometry.fillGroups)];
  if (fillGroups.length > limits.maxGlyphs + limits.maxContours) fail('This text exceeds the bounded vector fill-region limit.');
  const glyphContours = context.glyphs.flatMap(record => record.geometry.strokeContours);
  return { width: node.width, height: node.height,
    placement: { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation,
      ...(node.affineTransform ? { affineTransform: structuredClone(node.affineTransform) } : {}) },
    geometry: { fillRule: 'nonzero', fillGroups, strokeContours: glyphContours, alignedStrokeContours: glyphContours },
    glyphGeometry: { fillRule: 'nonzero', fillGroups: glyphFillGroups, strokeContours: glyphContours, alignedStrokeContours: glyphContours },
    glyphs: context.glyphs, decorations: context.decorations,
    ...(context.clipGeometry ? { clipGeometry: context.clipGeometry } : {}),
    ...(Array.isArray(node.fills) && node.width > 0 && node.height > 0
      ? { fillClipGeometry: context.clipGeometry || shapeFor(rectangleContours(0, 0, node.width, node.height, identity())) } : {}), layout };
}

class PendingShape extends Error { constructor(text, style, key) { super('Local glyphs are being prepared.'); this.text = text; this.style = style; this.key = key; } }

function sourceSignature(document, node) {
  const live = node?.id ? findNode(document, node.id) : null;
  const value = JSON.stringify([node, live?.node || null, document?.variables, document?.variableCollections, document?.colorStyles,
    document?.activePageId, live?.parents.map(parent => parent.variableModes), getNodeGeometry(document, node),
    node.textPath ? getNodeTextPath(document, node) : null]);
  if (value.length > TEXT_OUTLINE_LIMITS.maxSourceCharacters) fail('This text source is too large to snapshot for local outlining.');
  return value;
}

async function awaitShape(value, signal, deadline) {
  abort(signal);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new TextOutlineGeometryError('Local text outlining timed out. Try fewer characters or retry after the fonts finish loading.', 'TEXT_OUTLINE_TIMEOUT');
  let timer; let onAbort;
  try {
    return await Promise.race([Promise.resolve(value), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new TextOutlineGeometryError('Local text outlining timed out. Try fewer characters or retry after the fonts finish loading.', 'TEXT_OUTLINE_TIMEOUT')), remaining);
      onAbort = () => reject(new DOMException('Text outlining cancelled.', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}

/** Resolve only real shaping queries, then retry the same layout with immutable results. */
export async function prepareTextOutlineGeometry(document, node, {
  shapeText, signal, includeDecorations = true, measureContext, leadingTrimMetrics, textLineMetrics, assertCurrent = () => {}, timeoutMs = TEXT_OUTLINE_LIMITS.timeoutMs
} = {}) {
  if (typeof shapeText !== 'function' || typeof assertCurrent !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > TEXT_OUTLINE_LIMITS.timeoutMs) fail('The text outline preparation options are invalid.');
  abort(signal); assertCurrent(); const signature = sourceSignature(document, node);
  const cache = new Map(); let bytes = 0; const deadline = Date.now() + timeoutMs;
  const current = () => {
    abort(signal); assertCurrent();
    if (sourceSignature(document, node) !== signature) throw new TextOutlineGeometryError('The text or its variable modes changed while glyphs were being prepared. Retry outlining.', 'TEXT_OUTLINE_STALE');
    if (Date.now() >= deadline) throw new TextOutlineGeometryError('Local text outlining timed out. Try fewer characters or retry after the fonts finish loading.', 'TEXT_OUTLINE_TIMEOUT');
  };
  const readyShape = (text, style) => {
    const key = JSON.stringify([text, style]);
    if (key.length > TEXT_OUTLINE_LIMITS.maxSourceCharacters) fail('A local font shaping query exceeds the text outline budget.');
    if (cache.has(key)) return cache.get(key);
    if (cache.size >= TEXT_OUTLINE_LIMITS.maxShapeQueries) fail('This text needs too many distinct shaping queries. Outline fewer paragraphs at a time.');
    throw new PendingShape(text, structuredClone(style), key);
  };
  while (true) {
    current();
    try { return collectTextOutlineGeometry(document, node, { shapeText: readyShape, signal, includeDecorations, measureContext, leadingTrimMetrics, textLineMetrics }); }
    catch (pending) {
      if (!(pending instanceof PendingShape)) throw pending;
      const value = await awaitShape(shapeText(pending.text, pending.style, { signal }), signal, deadline);
      current(); checkShaped(value, pending.text);
      const retained = structuredClone(value); const size = (pending.key.length + JSON.stringify(retained).length) * 2;
      if (bytes + size > TEXT_OUTLINE_LIMITS.maxShapeCacheBytes) fail('The local glyph outlines exceed the preparation memory budget. Outline fewer paragraphs at a time.');
      cache.set(pending.key, retained); bytes += size;
    }
  }
}
