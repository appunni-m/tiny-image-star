import { vectorPathContours } from './vector-path.js';
import { requiresComplexTextShaping, textGraphemes } from './text-layout.js';
import { canvasFontWeight } from './font-variation.js';
import { ellipseArcParameters, isValidEllipseArcData } from './ellipse-arc.js';
import { decorationStyleForRun, canvasTextInkBounds, nativeInkContoursForShapedText, textDecorationGeometry, traceTextDecorationContours } from './text-decoration.js';
import { inheritedTextLetterSpacing, resolvedTextLetterSpacing } from './text-letter-spacing.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const MAX_TEXT_PATH_SAMPLES = 65_536;

/** Keep a live label outside auto-layout flow while preserving safe same-parent links. */
export function textPathParentPlacement(parent) {
  if (parent?.type === 'boolean') {
    return { liveLink: false, layoutPositioning: undefined };
  }
  return {
    liveLink: true,
    layoutPositioning: parent?.autoLayout ? 'absolute' : undefined
  };
}

/** Snapshot editable vector geometry onto a text layer so it survives source deletion. */
export function createTextPathGeometry(source, { startOffset = 0, flipped = false } = {}) {
  if (!source) return null;
  let contour;
  if (source.type === 'path' && Array.isArray(source.points) && source.points.length >= 2) {
    contour = vectorPathContours(source).find(item => Array.isArray(item.points) && item.points.length >= 2);
  } else if (source.type === 'ellipse') {
    const k = 4 * (Math.sqrt(2) - 1) / 3;
    const width = Math.max(1, Number(source.width) || 0);
    const height = Math.max(1, Number(source.height) || 0);
    const arc = isValidEllipseArcData(source.arcData) ? ellipseArcParameters(source) : null;
    if (arc && !arc.full && Math.abs(arc.sweep) > 1e-9) {
      const segments = Math.max(1, Math.ceil(Math.abs(arc.sweep) / (Math.PI / 2)));
      const points = [];
      for (let index = 0; index < segments; index += 1) {
        const startAngle = arc.start + arc.sweep * index / segments;
        const endAngle = arc.start + arc.sweep * (index + 1) / segments;
        const delta = endAngle - startAngle;
        const handle = 4 / 3 * Math.tan(delta / 4);
        const pointAt = angle => ({
          x: width * (.5 + .5 * Math.cos(angle)),
          y: height * (.5 + .5 * Math.sin(angle))
        });
        const tangentAt = angle => ({ x: -width * .5 * Math.sin(angle), y: height * .5 * Math.cos(angle) });
        const start = pointAt(startAngle);
        const end = pointAt(endAngle);
        const startTangent = tangentAt(startAngle);
        const endTangent = tangentAt(endAngle);
        const startHandle = { x: startTangent.x * handle, y: startTangent.y * handle };
        const endHandle = { x: -endTangent.x * handle, y: -endTangent.y * handle };
        const normalizeCoordinate = value => Math.abs(value) < 1e-15 ? 0 : value;
        const normalized = point => ({ x: normalizeCoordinate(point.x / width), y: normalizeCoordinate(point.y / height) });
        const normalizedOffset = point => ({ x: normalizeCoordinate(point.x / width), y: normalizeCoordinate(point.y / height) });
        if (!points.length) points.push({ ...normalized(start), out: normalizedOffset(startHandle) });
        else points.at(-1).out = normalizedOffset(startHandle);
        points.push({ ...normalized(end), in: normalizedOffset(endHandle) });
      }
      contour = { closed: false, points };
    } else {
      contour = { closed: true, points: [
        { x: .5, y: 0, out: { x: k / 2, y: 0 } },
        { x: 1, y: .5, in: { x: 0, y: -k / 2 }, out: { x: 0, y: k / 2 } },
        { x: .5, y: 1, in: { x: k / 2, y: 0 }, out: { x: -k / 2, y: 0 } },
        { x: 0, y: .5, in: { x: 0, y: k / 2 }, out: { x: 0, y: -k / 2 } }
      ] };
    }
  } else if (source.type === 'rectangle') {
    contour = { closed: true, points: [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
    ] };
  } else if (source.type === 'line') {
    contour = { closed: false, points: [
      { x: 0, y: source.lineReverseY ? 1 : 0 }, { x: 1, y: source.lineReverseY ? 0 : 1 }
    ] };
  }
  if (!contour) return null;
  return {
    width: Math.max(1, Number(source.width) || 0), height: Math.max(1, Number(source.height) || 0),
    points: structuredClone(contour.points), closed: Boolean(contour.closed),
    startOffset, flipped: Boolean(flipped)
  };
}

export function isValidTextPathGeometry(path) {
  if (!path || typeof path !== 'object' || Array.isArray(path)
    || Object.keys(path).some(key => !['width', 'height', 'points', 'closed', 'startOffset', 'flipped', 'sourceId'].includes(key))) return false;
  if (!Number.isFinite(path.width) || path.width <= 0 || path.width > 100_000
    || !Number.isFinite(path.height) || path.height <= 0 || path.height > 100_000
    || !Array.isArray(path.points) || path.points.length < 2 || path.points.length > 20_000
    || typeof path.closed !== 'boolean'
    || (path.startOffset != null && (!Number.isFinite(path.startOffset) || Math.abs(path.startOffset) > 100_000))
    || (path.flipped != null && typeof path.flipped !== 'boolean')
    || (path.sourceId != null && (typeof path.sourceId !== 'string' || !path.sourceId.trim()
      || path.sourceId.trim() !== path.sourceId || path.sourceId.length > 160 || /[\x00-\x1f\x7f]/u.test(path.sourceId)))) return false;
  const coordinate = value => Number.isFinite(value) && Math.abs(value) <= 1_000_000;
  return path.points.every(point => point && coordinate(point.x) && coordinate(point.y)
    && ['in', 'out'].every(part => point[part] == null || coordinate(point[part].x) && coordinate(point[part].y)));
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - start.x - projection * dx, point.y - start.y - projection * dy);
}

function cubicFlatness({ p0, p1, p2, p3 }) {
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const controlPolygon = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    + Math.hypot(p2.x - p1.x, p2.y - p1.y)
    + Math.hypot(p3.x - p2.x, p3.y - p2.y);
  return Math.max(
    pointSegmentDistance(p1, p0, p3),
    pointSegmentDistance(p2, p0, p3),
    controlPolygon - chord
  );
}

function splitCubicHalf(curve) {
  const midpoint = (left, right) => ({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
  const p01 = midpoint(curve.p0, curve.p1);
  const p12 = midpoint(curve.p1, curve.p2);
  const p23 = midpoint(curve.p2, curve.p3);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const p0123 = midpoint(p012, p123);
  return [
    { p0: curve.p0, p1: p01, p2: p012, p3: p0123, depth: curve.depth + 1 },
    { p0: p0123, p1: p123, p2: p23, p3: curve.p3, depth: curve.depth + 1 }
  ];
}

function flattenCubic(p0, p1, p2, p3, tolerance, maxSegments) {
  const first = { p0, p1, p2, p3, depth: 0 };
  const stack = [first];
  const output = [p0];
  while (stack.length) {
    const curve = stack.pop();
    const accepted = output.length - 1;
    const canSplit = curve.depth < 24
      && cubicFlatness(curve) > tolerance
      && accepted + stack.length + 2 <= maxSegments;
    if (canSplit) {
      const [left, right] = splitCubicHalf(curve);
      stack.push(right, left);
    } else output.push(curve.p3);
  }
  return output;
}

/** Flatten the stored cubic path into a bounded-distance lookup table. */
export function flattenTextPath(path, tolerance = 1) {
  if (!isValidTextPathGeometry(path)) return [];
  const flatnessTolerance = Number.isFinite(tolerance) ? Math.max(0.25, tolerance) : 1;
  const points = path.points;
  const segments = path.closed ? points.length : points.length - 1;
  const output = [];
  for (let index = 0; index < segments; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const p0 = { x: start.x * path.width, y: start.y * path.height };
    const p3 = { x: end.x * path.width, y: end.y * path.height };
    const c1 = start.out ? { x: p0.x + start.out.x * path.width, y: p0.y + start.out.y * path.height } : p0;
    const c2 = end.in ? { x: p3.x + end.in.x * path.width, y: p3.y + end.in.y * path.height } : p3;
    const curved = start.out || end.in;
    const remainingSegments = segments - index;
    const availableSamples = MAX_TEXT_PATH_SAMPLES - output.length;
    const segmentBudget = Math.max(1, Math.floor((availableSamples - (index === 0 ? 1 : 0)) / remainingSegments));
    const segmentPoints = curved
      ? flattenCubic(p0, c1, c2, p3, flatnessTolerance, segmentBudget)
      : [p0, p3];
    for (let pointIndex = index === 0 ? 0 : 1; pointIndex < segmentPoints.length; pointIndex += 1) {
      output.push(segmentPoints[pointIndex]);
    }
  }
  let length = 0;
  return output.map((point, index) => {
    if (index) length += Math.hypot(point.x - output[index - 1].x, point.y - output[index - 1].y);
    return { ...point, distance: length };
  });
}

function sampleTextPathTable(path, table, distance) {
  if (table.length < 2) return null;
  const length = table.at(-1).distance;
  if (!(length > 0)) return null;
  const rawDistance = Number(distance) || 0;
  const requested = path.closed && length > 0
    ? (rawDistance % length + length) % length
    : clamp(rawDistance, 0, length);
  let low = 1;
  let high = table.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (table[middle].distance < requested) low = middle + 1;
    else high = middle;
  }
  const before = table[low - 1];
  const after = table[low];
  const span = after.distance - before.distance;
  const ratio = span > 0 ? (requested - before.distance) / span : 0;
  return {
    x: before.x + (after.x - before.x) * ratio,
    y: before.y + (after.y - before.y) * ratio,
    angle: Math.atan2(after.y - before.y, after.x - before.x),
    length
  };
}

/** Build one bounded distance index and reuse its logarithmic sampler for every glyph. */
export function createTextPathSampler(path, tolerance = 1) {
  const table = flattenTextPath(path, tolerance);
  if (table.length < 2 || !(table.at(-1).distance > 0)) return null;
  const length = table.at(-1).distance;
  return Object.freeze({
    length,
    at: distance => sampleTextPathTable(path, table, distance)
  });
}

export function pointAtTextPathDistance(path, distance, tolerance = 1) {
  return createTextPathSampler(path, tolerance)?.at(distance) || null;
}

function pathRunStyle(node, run, baseColor) {
  const fontAxes = run?.fontAxes || node.fontAxes;
  return {
    fontFamily: run?.fontFamily || node.fontFamily || 'Arial, sans-serif',
    fontSize: Math.max(run?.authoredFontSize ? .001 : 1, Number(run?.fontSize ?? node.fontSize) || 24),
    fontWeight: canvasFontWeight(run?.fontWeight ?? node.fontWeight, fontAxes),
    fontStyle: (run?.fontStyle ?? node.fontStyle) === 'italic' ? 'italic' : 'normal',
    fontAxes,
    fontFeatures: run?.fontFeatures || node.fontFeatures,
    ...inheritedTextLetterSpacing(node, run),
    color: run?.color || baseColor || node.color || '#1e1e1e',
    textDecoration: run?.textDecoration || node.textDecoration || 'none',
    ...decorationStyleForRun(node, run),
    baselineShift: Number(run?.baselineShift ?? node.baselineShift) || 0,
    leadingTrim: run?.leadingTrim ?? node.leadingTrim,
    ...Object.fromEntries(['authoredFontSize', 'textPositionScaleX', 'textPositionOffsetX', 'textPositionTopOffset', 'textPositionBaselineOffset']
      .filter(key => run?.[key] !== undefined || node[key] !== undefined).map(key => [key, run?.[key] ?? node[key]]))
  };
}

export function textPathCharacters(text, node, {
  color = node.color || '#1e1e1e', overrideRunColors = false
} = {}) {
  const value = String(text ?? '');
  const currentRuns = Array.isArray(node.textRuns)
    && node.textRuns.map(run => run.text).join('') === value;
  const runs = currentRuns ? node.textRuns : [{ text: value }];
  const characters = [];
  for (const run of runs) {
    const style = pathRunStyle(node, run, color);
    const runText = String(run.text).replace(/[\r\n]+/gu, ' ');
    const effectiveStyle = overrideRunColors ? { ...style, color } : style;
    for (const grapheme of textGraphemes(runText)) {
      characters.push({ text: grapheme, style: effectiveStyle });
    }
  }
  if (node.textCase === 'uppercase' || node.textCase === 'lowercase') {
    return characters.flatMap(item => textGraphemes(node.textCase === 'uppercase' ? item.text.toUpperCase() : item.text.toLowerCase())
      .map(character => ({ text: character, style: item.style })));
  }
  if (node.textCase !== 'capitalize') return characters;
  let inWord = false;
  for (const item of characters) {
    if (/^[\p{L}\p{N}]/u.test(item.text)) {
      if (!inWord) item.text = item.text.toUpperCase();
      inWord = true;
    } else if (!/^['’]$/u.test(item.text)) inWord = false;
  }
  return characters;
}

function samePathRunStyle(left, right) {
  const sameMap = (leftMap = {}, rightMap = {}) => {
    const leftKeys = Object.keys(leftMap || {}).sort(); const rightKeys = Object.keys(rightMap || {}).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
      key === rightKeys[index] && Object.is(leftMap[key], rightMap[key]));
  };
  if (!left || !right) return false;
  const leftKeys = Object.keys(left); const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.hasOwn(right, key)
    && (['fontAxes', 'fontFeatures', 'textDecorationThickness', 'textDecorationOffset', 'textDecorationColor'].includes(key)
      ? sameMap(left[key], right[key])
      : Object.is(left[key], right[key])));
}

/** Group adjacent path characters with the same style for shaping and measurement. */
export function textPathSpans(text, node, options) {
  const spans = [];
  for (const character of textPathCharacters(text, node, options)) {
    const previous = spans.at(-1);
    if (previous && samePathRunStyle(previous.style, character.style)) {
      previous.text += character.text;
      previous.graphemeCount += 1;
    } else spans.push({ text: character.text, style: character.style, graphemeCount: 1 });
  }
  return spans;
}

export function textPathSvgData(path) {
  if (!isValidTextPathGeometry(path)) return '';
  const n = value => Number(Number(value).toFixed(6));
  const point = (item, part) => {
    const x = item.x * path.width; const y = item.y * path.height;
    const handle = item[part];
    return handle ? { x: x + handle.x * path.width, y: y + handle.y * path.height } : { x, y };
  };
  let data = '';
  const segments = path.closed ? path.points.length : path.points.length - 1;
  for (let index = 0; index < segments; index += 1) {
    const start = path.points[index]; const end = path.points[(index + 1) % path.points.length];
    const p0 = point(start, 'anchor'); const p3 = point(end, 'anchor');
    const c1 = point(start, 'out'); const c2 = point(end, 'in');
    data += index === 0 ? `M ${n(p0.x)} ${n(p0.y)}` : '';
    data += start.out || end.in ? ` C ${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(p3.x)} ${n(p3.y)}` : ` L ${n(p3.x)} ${n(p3.y)}`;
  }
  return data + (path.closed ? ' Z' : '');
}

/** Draw editable graphemes along the vector path using the active canvas text style. */
export function drawTextAlongPath(ctx, text, node, x, y, measure, {
  fillOpacity = 1, paintMode = 'fill', fontSize: fontSizeOverride,
  letterSpacing: letterSpacingOverride, letterSpacingUnit, fontWeight, fontStyle, fontFamily,
  color, overrideRunColors = false, includeDecorations = true, shapeText = null, drawShaped = null,
  decorationsOnly = false, decorate = null
} = {}) {
  const path = node.textPath;
  const sampler = createTextPathSampler(path, 0.5);
  if (!sampler) return false;
  const baseStyle = {
    fontSize: fontSizeOverride ?? node.fontSize,
    fontWeight: fontWeight ?? node.fontWeight,
    fontStyle: fontStyle ?? node.fontStyle,
    fontAxes: node.fontAxes,
    fontFeatures: node.fontFeatures,
    fontFamily: fontFamily ?? node.fontFamily,
    letterSpacing: letterSpacingOverride ?? node.letterSpacing,
    letterSpacingUnit: letterSpacingUnit ?? (letterSpacingOverride !== undefined ? 'pixels' : node.letterSpacingUnit),
    color: color ?? node.color
  };
  const spans = textPathSpans(text, { ...node, ...baseStyle }, { color, overrideRunColors });
  const segments = [];
  const appendCanvasFallback = span => {
    if (requiresComplexTextShaping(span.text)) {
      const advance = Math.max(0, Number(measure(span.text, span.style)) || 0);
      segments.push({ text: span.text, style: span.style, advance, letterSpacing: resolvedTextLetterSpacing(span.style), shaped: null });
      return;
    }
    for (const grapheme of textGraphemes(span.text)) {
      const advance = Math.max(0, Number(measure(grapheme, span.style)) || 0);
      segments.push({ text: grapheme, style: span.style, advance, letterSpacing: resolvedTextLetterSpacing(span.style), shaped: null });
    }
  };
  const appendShapedRun = (textValue, style, shaped) => {
    if (!shaped || shaped.missingGlyph || !Array.isArray(shaped.glyphs) || !shaped.glyphs.length
      || !(shaped.upem > 0) || !Number.isFinite(Number(shaped.extents?.ascender))) {
      appendCanvasFallback({ text: textValue, style });
      return;
    }
    const groups = [];
    for (const glyph of shaped.glyphs) {
      if (!Number.isInteger(glyph.cluster) || glyph.cluster < 0 || glyph.cluster >= textValue.length) {
        groups.length = 0;
        break;
      }
      const previous = groups.at(-1);
      if (previous?.cluster === glyph.cluster) previous.glyphs.push(glyph);
      else groups.push({ cluster: glyph.cluster, glyphs: [glyph] });
    }
    if (!groups.length) {
      appendCanvasFallback({ text: textValue, style });
      return;
    }
    const starts = [...new Set(groups.map(group => group.cluster))].sort((left, right) => left - right);
    const clusterText = new Map(starts.map((start, index) => [start, textValue.slice(start, starts[index + 1] ?? textValue.length)]));
    if (groups.some(group => !clusterText.get(group.cluster))) {
      appendCanvasFallback({ text: textValue, style });
      return;
    }
    const scale = Math.max(.001, Number(style.fontSize) || 24) / shaped.upem * (style.textPositionScaleX || 1);
    for (const group of groups) {
      const advanceUnits = group.glyphs.reduce((sum, glyph) => sum + (Number(glyph.xAdvance) || 0), 0);
      const advance = Math.abs(advanceUnits * scale);
      const groupText = clusterText.get(group.cluster) || '';
      segments.push({
        text: groupText, style, advance, letterSpacing: resolvedTextLetterSpacing(style),
        shaped: { ...shaped, glyphs: group.glyphs },
        shapedStartX: advanceUnits < 0 ? advance / 2 : -advance / 2
      });
    }
  };
  for (const span of spans) {
    const shaped = shapeText?.(span.text, span.style);
    if (Array.isArray(shaped?.mixedRuns)) {
      for (const run of shaped.mixedRuns) appendShapedRun(run.text, span.style, run.shaped);
      continue;
    }
    appendShapedRun(span.text, span.style, shaped);
  }
  ctx.textBaseline = 'alphabetic';
  const advances = segments.map(segment => segment.advance + (Number(segment.letterSpacing) || 0));
  let cursor = Number(path.startOffset) || 0;
  if (node.align === 'center' || node.align === 'right') {
    const total = advances.reduce((sum, value) => sum + value, 0);
    cursor += node.align === 'center' ? (sampler.length - total) / 2 : sampler.length - total;
  }
  for (let index = 0; index < segments.length; index += 1) {
    const advance = advances[index];
    if (!path.closed && cursor + advance / 2 < 0) {
      cursor += advance;
      continue;
    }
    if (!path.closed && cursor + advance / 2 > sampler.length) break;
    const sample = sampler.at(cursor + advance / 2);
    if (!sample) break;
    const angle = sample.angle + (path.flipped ? Math.PI : 0);
    const segment = segments[index];
    const { style } = segment;
    ctx.font = `${style.fontStyle === 'italic' ? 'italic ' : ''}${canvasFontWeight(style.fontWeight, style.fontAxes)} ${style.fontSize}px ${style.fontFamily}`;
    ctx.save();
    ctx.translate(x + sample.x, y + sample.y);
    ctx.rotate(angle);
    if (path.flipped) ctx.scale(1, -1);
    ctx.textAlign = 'center';
    const baseline = (style.textPositionBaselineOffset || 0) - style.baselineShift;
    ctx.fillStyle = style.color;
    if (paintMode !== 'stroke') ctx.strokeStyle = style.color;
    const parentAlpha = ctx.globalAlpha;
    if (paintMode !== 'stroke') ctx.globalAlpha *= fillOpacity;
    const shapedTop = segment.shaped
      ? baseline - Number(segment.shaped.extents.ascender) / segment.shaped.upem * style.fontSize
      : baseline;
    const paintedByShaper = !decorationsOnly && segment.shaped && typeof drawShaped === 'function'
      ? drawShaped(ctx, segment.shaped, segment.text, segment.shapedStartX ?? -segment.advance / 2,
        shapedTop, style.fontSize, 0, paintMode, segment.text, style)
      : false;
    if (!decorationsOnly && !paintedByShaper) {
      const transformed = style.textPositionOffsetX || style.textPositionScaleX && style.textPositionScaleX !== 1;
      if (transformed) { ctx.save(); ctx.translate(style.textPositionOffsetX || 0, 0); ctx.scale(style.textPositionScaleX || 1, 1); }
      if (paintMode === 'stroke') ctx.strokeText(segment.text, 0, baseline);
      else ctx.fillText(segment.text, 0, baseline);
      if (transformed) ctx.restore();
    }
    if (includeDecorations && paintMode !== 'stroke') {
      ctx.fillStyle = style.color;
      if (typeof decorate === 'function') decorate({ ctx, style, segment, baseline, shapedTop, parentAlpha });
      else if (['underline', 'line-through'].includes(style.textDecoration)) {
        const custom = style.textDecoration === 'underline' && (style.textDecorationStyle && style.textDecorationStyle !== 'solid'
          || style.textDecorationThickness?.unit && style.textDecorationThickness.unit !== 'auto'
          || style.textDecorationOffset?.unit && style.textDecorationOffset.unit !== 'auto'
          || style.textDecorationColor && style.textDecorationColor !== 'auto' || style.textDecorationSkipInk);
        if (custom) {
          const inkContours = style.textDecorationSkipInk ? nativeInkContoursForShapedText(segment.shaped,
            { x: (segment.shapedStartX ?? -segment.advance / 2) + (style.textPositionOffsetX || 0), y: shapedTop, fontSize: style.fontSize,
              scaleX: style.textPositionScaleX || 1 }) : null;
          const geometry = textDecorationGeometry({ x: -segment.advance / 2, y: baseline, width: segment.advance, fontSize: style.fontSize,
            decoration: style.textDecoration, style, baseline: true, inkContours,
            fallbackInkBounds: style.textDecorationSkipInk && !inkContours ? canvasTextInkBounds(ctx, segment.text, {
              x: -segment.advance / 2 + (style.textPositionOffsetX || 0), y: baseline, scaleX: style.textPositionScaleX || 1 }) : [] });
          if (geometry.paint === 'auto' || geometry.paint.visible !== false) {
            if (geometry.paint !== 'auto') { ctx.fillStyle = geometry.paint.color; ctx.globalAlpha = parentAlpha * geometry.paint.opacity; }
            ctx.beginPath(); traceTextDecorationContours(ctx, geometry.contours); ctx.fill('nonzero');
          }
        } else {
        const decorationY = baseline + style.fontSize * (style.textDecoration === 'underline' ? 0.08 : -0.3);
        const textWidth = Math.max(0, segment.advance);
        const decorationWidth = Math.max(1, style.fontSize / 16);
        ctx.strokeStyle = style.color;
        ctx.lineWidth = decorationWidth;
        ctx.beginPath();
        ctx.moveTo(-textWidth / 2, decorationY);
        ctx.lineTo(textWidth / 2, decorationY);
        ctx.stroke();
        }
      }
    }
    ctx.restore();
    cursor += advance;
  }
  return true;
}
