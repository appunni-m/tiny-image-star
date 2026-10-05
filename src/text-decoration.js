import { TEXT_DECORATION_PROPERTIES, textDecorationDefaults } from './text-decoration-style.js';

export const TEXT_DECORATION_LIMITS = Object.freeze({ maxGlyphs: 4096, maxCommands: 100_000,
  maxPoints: 100_000, maxOutputPoints: 20_000, maxContours: 4096, maxIntersectionTests: 2_000_000,
  maxCoordinate: 10_000_000, curveTolerance: .125 });
export class TextDecorationGeometryError extends RangeError {
  constructor(message) { super(message); this.name = 'TextDecorationGeometryError'; this.code = 'TEXT_DECORATION_BUDGET'; }
}
const fail = message => { throw new TextDecorationGeometryError(message); };
const coordinate = value => {
  if (!Number.isFinite(value) || Math.abs(value) > TEXT_DECORATION_LIMITS.maxCoordinate) fail('Text decoration geometry exceeds its finite coordinate limit.');
  return value;
};
const point = (x, y) => ({ x: coordinate(x), y: coordinate(y) });
const contour = points => ({ start: points[0], closed: true,
  commands: points.slice(1).map((end, index) => ({ type: 'line', start: points[index], end })) });

export function decorationStyleForRun(node, run = {}) {
  return Object.fromEntries(TEXT_DECORATION_PROPERTIES.filter(key => run[key] !== undefined || node?.[key] !== undefined)
    .map(key => [key, run[key] ?? node[key]]));
}

/** Parse geometry-only local font paths; no SVG markup or browser font fallback. */
export function parseLocalGlyphContours(data) {
  if (typeof data !== 'string' || data.length > 131_072) fail('The local glyph path exceeds the decoration geometry limit.');
  const tokens = []; const token = /[MLHVQCZmlhvqcz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/gu;
  let cursor = 0;
  for (const match of data.matchAll(token)) {
    if (!/^[\s,]*$/u.test(data.slice(cursor, match.index))) fail('The local glyph path uses unsupported geometry.');
    tokens.push(match[0]); cursor = match.index + match[0].length;
    if (tokens.length > TEXT_DECORATION_LIMITS.maxCommands * 7) fail('The local glyph path exceeds the decoration command limit.');
  }
  if (!/^[\s,]*$/u.test(data.slice(cursor))) fail('The local glyph path uses unsupported geometry.');
  let index = 0; let command = null; let position = point(0, 0); let current = null; const contours = [];
  const read = () => {
    if (index >= tokens.length || /^[a-z]$/iu.test(tokens[index])) fail('The local glyph path has incomplete geometry.');
    return coordinate(Number(tokens[index++]));
  };
  const readPoint = relative => { const x = read(); const y = read(); return point(x + (relative ? position.x : 0), y + (relative ? position.y : 0)); };
  while (index < tokens.length) {
    if (/^[a-z]$/iu.test(tokens[index])) command = tokens[index++];
    if (!command) fail('The local glyph path has no starting command.');
    const relative = command === command.toLowerCase(); const type = command.toUpperCase();
    if (type === 'Z') { if (!current) fail('The local glyph closes an absent contour.'); current.closed = true; position = current.start; current = null; command = null; continue; }
    if (type === 'M') { if (current && !current.closed) fail('The local glyph has an open filled contour.');
      const start = readPoint(relative); current = { start, closed: false, commands: [] }; contours.push(current); position = start; command = relative ? 'l' : 'L'; continue; }
    if (!current) fail('The local glyph path has no contour.');
    const start = position; let item;
    if (type === 'L') item = { type: 'line', start, end: readPoint(relative) };
    else if (type === 'H') item = { type: 'line', start, end: point(read() + (relative ? position.x : 0), position.y) };
    else if (type === 'V') item = { type: 'line', start, end: point(position.x, read() + (relative ? position.y : 0)) };
    else if (type === 'Q') item = { type: 'quadratic', start, control: readPoint(relative), end: readPoint(relative) };
    else if (type === 'C') item = { type: 'cubic', start, control1: readPoint(relative), control2: readPoint(relative), end: readPoint(relative) };
    else fail('The local glyph uses unsupported curves.');
    current.commands.push(item); position = item.end;
    if (current.commands.length > TEXT_DECORATION_LIMITS.maxCommands) fail('The local glyph exceeds the decoration command limit.');
  }
  if (current && !current.closed) fail('The local glyph has an open filled contour.');
  return contours.filter(item => item.commands.length);
}

/** Placed glyph contours in the same top/baseline coordinates used by Canvas. */
export function nativeInkContoursForShapedText(shaped, { x = 0, y = 0, fontSize = 24, letterSpacing = 0 } = {}) {
  if (!shaped || shaped.missingGlyph || !Array.isArray(shaped.glyphs) || !(shaped.upem > 0)
    || !Number.isFinite(shaped.extents?.ascender)) return null;
  if (shaped.glyphs.length > TEXT_DECORATION_LIMITS.maxGlyphs) fail('The underline exceeds the bounded glyph limit.');
  const scale = fontSize / shaped.upem; let pen = 0; let tracking = 0; let previous = null; let commands = 0;
  const result = []; const paths = new Map();
  for (const [glyphIndex, glyph] of shaped.glyphs.entries()) {
    if (previous !== null && previous !== glyph.cluster) tracking += letterSpacing;
    if (glyph.path) {
      let raw = paths.get(glyph.path); if (!raw) { raw = parseLocalGlyphContours(glyph.path); paths.set(glyph.path, raw); }
      const project = value => point(x + (pen + Number(glyph.xOffset || 0)) * scale + tracking + value.x * scale,
        y + (shaped.extents.ascender - Number(glyph.yOffset || 0) - value.y) * scale);
      for (const item of raw) {
        commands += item.commands.length;
        if (commands > TEXT_DECORATION_LIMITS.maxCommands) fail('The underline exceeds the bounded glyph command limit.');
        result.push({ start: project(item.start), closed: item.closed, group: glyphIndex,
          commands: item.commands.map(command => ({ ...command, start: project(command.start), end: project(command.end),
            ...(command.control ? { control: project(command.control) } : {}),
            ...(command.control1 ? { control1: project(command.control1), control2: project(command.control2) } : {}) })) });
      }
    }
    pen += Number(glyph.xAdvance || 0); previous = glyph.cluster;
  }
  return result;
}

/** Actual per-grapheme Canvas bounds, with measured prefix kerning/tracking. */
export function canvasTextInkBounds(ctx, text, styleOrOptions = {}, options) {
  const { x = 0, y = 0, letterSpacing = 0 } = options ?? styleOrOptions;
  if (typeof ctx.measureText !== 'function') return [];
  const graphemes = globalThis.Intl?.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(String(text))].map(item => item.segment) : [...String(text)];
  if (graphemes.length > TEXT_DECORATION_LIMITS.maxGlyphs) fail('The underline exceeds the bounded fallback glyph limit.');
  const result = []; let prefix = ''; let characters = 0; const alignment = ctx.textAlign; ctx.textAlign = 'left';
  try {
    for (const [index, value] of graphemes.entries()) {
      characters += prefix.length + value.length;
      if (characters > 262_144) fail('The underline exceeds the bounded fallback measurement budget.');
      const metrics = ctx.measureText(value);
      const values = ['actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent'].map(key => metrics[key]);
      if (!values.every(Number.isFinite)) fail('Skip ink requires finite actual Canvas glyph bounds or ready local font contours.');
      if (values.every(Number.isFinite)) {
        const start = x + ctx.measureText(prefix + value).width - metrics.width + index * letterSpacing;
        result.push({ left: start - values[0], right: start + values[1], top: y - values[2], bottom: y + values[3] });
      }
      prefix += value;
    }
  } finally { ctx.textAlign = alignment; }
  return result;
}

function flattenContour(source, budget) {
  const points = [source.start];
  const add = value => { if (++budget.points > TEXT_DECORATION_LIMITS.maxPoints) fail('Skip ink exceeds the bounded curve-point limit.'); points.push(value); };
  const midpoint = (a, b) => point((a.x + b.x) / 2, (a.y + b.y) / 2);
  const flatness = curve => {
    const [a, ...rest] = curve; const b = rest.at(-1); const length = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.max(0, ...rest.slice(0, -1).map(p => {
      const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (length * length))) : 0;
      return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
    }));
  };
  for (const command of source.commands) {
    if (command.type === 'line') { add(command.end); continue; }
    const curve = command.control ? [command.start, command.control, command.end] : [command.start, command.control1, command.control2, command.end];
    if (curve.some(value => !value)) fail('Skip ink requires native line, quadratic or cubic glyph contours.');
    const stack = [{ curve, depth: 0 }];
    while (stack.length) {
      const entry = stack.pop();
      if (flatness(entry.curve) <= TEXT_DECORATION_LIMITS.curveTolerance) { add(entry.curve.at(-1)); continue; }
      if (entry.depth >= 20) fail('Skip ink curve subdivision exceeded its precision limit.');
      const rows = [entry.curve]; while (rows.at(-1).length > 1) rows.push(rows.at(-1).slice(1).map((p, index) => midpoint(rows.at(-1)[index], p)));
      const left = rows.map(row => row[0]); const right = rows.map(row => row.at(-1)).reverse();
      stack.push({ curve: right, depth: entry.depth + 1 }, { curve: left, depth: entry.depth + 1 });
    }
  }
  if (source.closed && points.length && (points[0].x !== points.at(-1).x || points[0].y !== points.at(-1).y)) add(points[0]);
  return points;
}

const mergedIntervals = intervals => {
  const result = [];
  for (const pair of intervals.sort((a, b) => a[0] - b[0])) {
    const prior = result.at(-1);
    if (prior && pair[0] <= prior[1]) prior[1] = Math.max(prior[1], pair[1]); else result.push([...pair]);
  }
  return result;
};
function glyphBandIntervals(contours, top, bottom) {
  const groups = new Map(); const budget = { points: 0, tests: 0 }; const result = [];
  for (const item of contours || []) {
    const group = item.group ?? 0; if (!groups.has(group)) groups.set(group, []);
    const points = flattenContour(item, budget);
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]; const b = points[index];
      if (a.y !== b.y && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom) groups.get(group).push({ a, b });
    }
  }
  for (const edges of groups.values()) {
    const ys = [...new Set([top, bottom, ...edges.flatMap(edge => [edge.a.y, edge.b.y]).filter(y => y > top && y < bottom)])].sort((a, b) => a - b);
    const xAt = (edge, y) => edge.a.x + (edge.b.x - edge.a.x) * (y - edge.a.y) / (edge.b.y - edge.a.y);
    for (let index = 1; index < ys.length; index += 1) {
      const low = ys[index - 1]; const high = ys[index]; const mid = (low + high) / 2; const intersections = [];
      for (const edge of edges) {
        if (++budget.tests > TEXT_DECORATION_LIMITS.maxIntersectionTests) fail('Skip ink exceeded its bounded intersection budget.');
        if (mid >= Math.min(edge.a.y, edge.b.y) && mid < Math.max(edge.a.y, edge.b.y)) intersections.push({ edge, x: xAt(edge, mid), winding: edge.b.y > edge.a.y ? 1 : -1 });
      }
      intersections.sort((a, b) => a.x - b.x); let winding = 0; let start = null;
      for (const crossing of intersections) {
        const previous = winding; winding += crossing.winding;
        if (!previous && winding) start = crossing.edge;
        if (previous && !winding && start) result.push([Math.min(xAt(start, low), xAt(start, high)), Math.max(xAt(crossing.edge, low), xAt(crossing.edge, high))]);
      }
    }
  }
  return mergedIntervals(result);
}

/** Shared bounded underline contours. Auto geometry retains the existing defaults. */
export function textDecorationGeometry({ x = 0, y = 0, width, fontSize = 24, decoration = 'underline', style = {}, baseline = false, inkContours, fallbackInkBounds = [] } = {}) {
  const settings = textDecorationDefaults(style); const autoThickness = Math.max(1, fontSize / 16);
  const value = (field, automatic) => field.unit === 'auto' ? automatic : field.value * (field.unit === 'percent' ? fontSize / 100 : 1);
  const thickness = decoration === 'underline' ? value(settings.textDecorationThickness, autoThickness) : autoThickness;
  const offset = decoration === 'underline' ? value(settings.textDecorationOffset, 0) : 0;
  const lineY = coordinate(y + fontSize * (decoration === 'underline' ? baseline ? .08 : 1.03 : baseline ? -.3 : .55) + offset);
  const paint = decoration === 'underline' ? settings.textDecorationColor : 'auto';
  if (!['underline', 'line-through'].includes(decoration) || !(width > 0) || !(thickness > 0)) return { contours: [], bounds: null, paint, thickness, lineY, segments: [] };
  coordinate(x); coordinate(x + width); coordinate(thickness);
  const mode = decoration === 'underline' ? settings.textDecorationStyle : 'solid'; const extent = thickness * (mode === 'wavy' ? 1.5 : .5);
  const blocked = settings.textDecorationSkipInk && decoration === 'underline'
    ? [...(inkContours ? glyphBandIntervals(inkContours, lineY - extent, lineY + extent) : []),
      ...fallbackInkBounds.filter(bounds => bounds.bottom > lineY - extent && bounds.top < lineY + extent).map(bounds => [bounds.left, bounds.right])] : [];
  const clearance = Math.max(.5, thickness / 2); const gaps = mergedIntervals(blocked.map(([a, b]) => [Math.max(x, a - clearance), Math.min(x + width, b + clearance)]).filter(([a, b]) => b > a));
  const segments = []; let cursor = x;
  for (const [a, b] of gaps) { if (a > cursor) segments.push([cursor, a]); cursor = Math.max(cursor, b); }
  if (cursor < x + width) segments.push([cursor, x + width]);
  const contours = []; let outputPoints = 0;
  const add = item => {
    outputPoints += item.commands.length + 1;
    if (outputPoints > TEXT_DECORATION_LIMITS.maxOutputPoints || contours.length >= TEXT_DECORATION_LIMITS.maxContours) fail('Text decoration exceeds its bounded output geometry limit.');
    contours.push(item);
  };
  for (const [left, right] of segments) {
    if (mode === 'dotted') {
      const r = thickness / 2; const k = .5522847498307936; const step = 2 * thickness;
      for (let index = Math.max(0, Math.ceil((left - x - r) / step)); x + r + index * step + r <= right; index += 1) {
        const cx = x + r + index * step; if (cx - r < left) continue;
        const p = [point(cx + r, lineY), point(cx, lineY + r), point(cx - r, lineY), point(cx, lineY - r), point(cx + r, lineY)];
        const controls = [[cx + r, lineY + k*r, cx + k*r, lineY + r], [cx - k*r, lineY + r, cx - r, lineY + k*r],
          [cx - r, lineY - k*r, cx - k*r, lineY - r], [cx + k*r, lineY - r, cx + r, lineY - k*r]];
        add({ start: p[0], closed: true, commands: controls.map((c, i) => ({ type: 'cubic', start: p[i], end: p[i + 1], control1: point(c[0], c[1]), control2: point(c[2], c[3]) })) });
      }
    } else if (mode === 'wavy') {
      const count = Math.max(1, Math.ceil((right - left) / Math.max(.125, thickness / 4)));
      if (count * 2 > TEXT_DECORATION_LIMITS.maxOutputPoints) fail('The wavy underline exceeds its bounded output geometry limit.');
      const upper = []; const lower = []; const frequency = Math.PI / (2 * thickness);
      for (let index = 0; index <= count; index += 1) {
        const px = left + (right - left) * index / count; const phase = (px - x) * frequency;
        const cy = lineY + Math.sin(phase) * thickness; const slope = Math.cos(phase) * thickness * frequency;
        const normal = thickness / (2 * Math.hypot(1, slope));
        upper.push(point(px - slope * normal, cy + normal)); lower.push(point(px + slope * normal, cy - normal));
      }
      add(contour([...upper, ...lower.reverse()]));
    } else add(contour([point(left, lineY - thickness / 2), point(right, lineY - thickness / 2), point(right, lineY + thickness / 2), point(left, lineY + thickness / 2)]));
  }
  const points = contours.flatMap(item => [item.start, ...item.commands.flatMap(command => [command.end, command.control1, command.control2].filter(Boolean))]);
  const bounds = points.length ? { left: Math.min(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), right: Math.max(...points.map(p => p.x)), bottom: Math.max(...points.map(p => p.y)) } : null;
  return { contours, bounds, paint, thickness, lineY, segments };
}

export function traceTextDecorationContours(ctx, contours) {
  for (const item of contours) {
    ctx.moveTo(item.start.x, item.start.y);
    for (const command of item.commands) {
      if (command.type === 'cubic') ctx.bezierCurveTo(command.control1.x, command.control1.y, command.control2.x, command.control2.y, command.end.x, command.end.y);
      else if (command.type === 'quadratic') ctx.quadraticCurveTo(command.control.x, command.control.y, command.end.x, command.end.y);
      else ctx.lineTo(command.end.x, command.end.y);
    }
    if (item.closed) ctx.closePath();
  }
}
