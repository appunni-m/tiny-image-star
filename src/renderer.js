import { findNode, getNodeColor, getNodeGeometry, getNodePropertyValue } from './model.js';
import { layoutGuideGridLines, layoutGuideRegions } from './layout-guides.js';
import { vectorNetworkEdgePoints, vectorNetworkVertexPoint, vectorNodePoint, vectorPathContours } from './vector-path.js';
import { layoutPlainText, layoutTextRuns, measureTrackedText, textGraphemes, transformTextCase } from './text-layout.js';
import { buildLayerEffectFilter, layerEffectPadding } from './layer-effects.js';
import { createGradientPaint, fillStackForNode } from './fills.js';
import { canvasBlendOperation } from './layer-blend.js';
import { applyStrokeStyle } from './stroke-style.js';
import { strokeStackForNode } from './strokes.js';
import { getTransformHandles, nodeLocalToPage, nodeLocalToPageTransform, pageToNodeLocal, transformPoint } from './transform-geometry.js';
import { selectionBounds } from './group-transform.js';
import { drawAlignmentGuides } from './smart-guides.js';
import { imagePreviewKey } from './image-preview-runtime.js';
import { clampCornerRadii, containsPointInRoundedRect, cornerRadiusKeys, traceRoundedRectPath } from './corner-radii.js';
import { booleanSourceTransform } from './boolean-geometry.js';
export { measureTrackedText, wrapText } from './text-layout.js';

function booleanNodeCacheState(document, node) {
  return {
    ...node,
    ...getNodeGeometry(document, node),
    opacity: getNodePropertyValue(document, node, 'opacity'),
    visible: getNodePropertyValue(document, node, 'visible'),
    radius: getNodePropertyValue(document, node, 'radius'),
    children: (node.children || []).map(child => booleanNodeCacheState(document, child))
  };
}

const BLUE = '#0d99ff';
const frameOverflowBehaviors = new Set(['none', 'vertical', 'horizontal', 'both']);

/** Return the selection outline and all transform handles in page coordinates. */
export function selectionOverlayGeometry(node, ancestors = [], { zoom = 1, rotateOffset = 24 } = {}) {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new TypeError('Selection overlay zoom must be a positive finite number.');
  const corners = [
    nodeLocalToPage(node, { x: 0, y: 0 }, ancestors),
    nodeLocalToPage(node, { x: node.width, y: 0 }, ancestors),
    nodeLocalToPage(node, { x: node.width, y: node.height }, ancestors),
    nodeLocalToPage(node, { x: 0, y: node.height }, ancestors)
  ];
  const handles = getTransformHandles(node, ancestors, { rotateOffset: rotateOffset / zoom });
  return { corners, handles };
}

/** Return the shared transform handles for an axis-aligned multi-layer box. */
export function selectionGroupHandles(bounds, { rotateOffset = 24 } = {}) {
  const { x, y, width, height } = bounds;
  const middleX = x + width / 2;
  const middleY = y + height / 2;
  const resize = {};
  if (width > 0 && height > 0) {
    Object.assign(resize, {
      nw: { x, y }, n: { x: middleX, y }, ne: { x: x + width, y },
      e: { x: x + width, y: middleY }, se: { x: x + width, y: y + height },
      s: { x: middleX, y: y + height }, sw: { x, y: y + height }, w: { x, y: middleY }
    });
  } else if (width > 0) {
    // A horizontal selection can be resized along X only. Avoid corner and
    // vertical handles because they would request scaling its zero-height axis.
    resize.e = { x: x + width, y: middleY };
    resize.w = { x, y: middleY };
  } else if (height > 0) {
    // A vertical selection can be resized along Y only.
    resize.n = { x: middleX, y };
    resize.s = { x: middleX, y: y + height };
  }
  return {
    resize,
    rotate: { x: middleX, y: y - rotateOffset }
  };
}

function rgba(hex, alpha = 1) {
  if (!hex || hex === 'transparent') return `rgba(0,0,0,0)`;
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? [...value].map(char => char + char).join('') : value;
  const number = Number.parseInt(normalized, 16);
  return `rgba(${number >> 16}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

function drawFittedImage(ctx, image, x, y, width, height, fit = 'cover') {
  if (!image || width <= 0 || height <= 0 || !image.width || !image.height) return false;
  const scale = fit === 'contain'
    ? Math.min(width / image.width, height / image.height)
    : Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  return true;
}

function imageForNode(node, assets, state, assetId = node.assetId, previewKey = node.id) {
  const cachedAssetId = state.previewAssetIds?.get(previewKey);
  const preview = state.previews?.get(previewKey);
  if (preview && (cachedAssetId == null || cachedAssetId === assetId)) return preview;
  return assets.get(assetId)?.bitmap ?? null;
}

function fillLayerColor(document, node, fill, index) {
  const linkedPrimary = index === 0 && (node.fillStyleId || node.fillVariableId || node.variableBindings?.fill);
  return linkedPrimary || (index === 0 && !Array.isArray(node.fills))
    ? getNodeColor(document, node, 'fill')
    : fill.color;
}

function fillCurrentPath(ctx, node) {
  if (node?.type === 'path') ctx.fill(node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
  else ctx.fill();
}

function drawFillStack(ctx, node, assets, state, x, y, width, height, colorOverride = null) {
  const fills = fillStackForNode(node);
  for (let index = 0; index < fills.length; index += 1) {
    const fill = fills[index];
    if (!fill.visible || fill.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha *= fill.opacity;
    if (fill.type === 'solid') {
      const color = colorOverride != null && index === 0
        ? colorOverride
        : fillLayerColor(state.document, node, fill, index);
      if (color && color !== 'transparent') { ctx.fillStyle = rgba(color, 1); fillCurrentPath(ctx, node); }
    } else if (fill.type === 'linear' || fill.type === 'radial') {
      const paint = createGradientPaint(ctx, fill.gradient, x, y, width, height);
      if (paint) { ctx.fillStyle = paint; fillCurrentPath(ctx, node); }
    } else if (fill.type === 'image') {
      const imageFill = fill.imageFill;
      const image = imageFill && imageForNode(node, assets, state, imageFill.assetId, imagePreviewKey(node.id, fill.id));
      if (image) {
        ctx.save();
        if (node.type === 'path') ctx.clip(node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
        else ctx.clip();
        drawFittedImage(ctx, image, x, y, width, height, imageFill.fit);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

function drawStrokeStack(ctx, node, document, x, y, width, height, tracePath = null) {
  const strokes = strokeStackForNode(node);
  for (let index = 0; index < strokes.length; index += 1) {
    const stroke = strokes[index];
    if (!stroke.visible || stroke.opacity <= 0 || stroke.width <= 0 || !stroke.color || stroke.color === 'transparent') continue;
    ctx.save();
    ctx.globalAlpha *= stroke.opacity;
    ctx.lineWidth = stroke.width;
    const color = index === 0 && node.strokeVariableId
      ? getNodeColor(document, node, 'stroke')
      : stroke.color;
    if (!color || color === 'transparent') { ctx.restore(); continue; }
    ctx.strokeStyle = color;
    applyStrokeStyle(ctx, stroke);
    if (tracePath) { ctx.beginPath(); tracePath(ctx); }
    ctx.stroke();
    ctx.restore();
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  const input = typeof radius === 'number'
    ? Object.fromEntries(cornerRadiusKeys.map(key => [key, radius]))
    : radius;
  const radii = clampCornerRadii(width, height, input);
  if (cornerRadiusKeys.every(key => radii[key] === 0)) { ctx.rect(x, y, width, height); return; }
  traceRoundedRectPath(ctx, x, y, width, height, radii);
}

/** Return a sanitized presentation-only scroll offset for a frame. */
export function getPresentationScrollOffset(state, frame) {
  const behavior = frame?.type === 'frame' && frameOverflowBehaviors.has(frame.overflowBehavior)
    ? frame.overflowBehavior
    : 'none';
  const stored = typeof frame?.id === 'string' && state?.presentationScrollOffsets instanceof Map
    ? state.presentationScrollOffsets.get(frame.id)
    : null;
  const x = behavior === 'horizontal' || behavior === 'both' ? stored?.x : 0;
  const y = behavior === 'vertical' || behavior === 'both' ? stored?.y : 0;
  return {
    x: Number.isFinite(x) ? Math.max(0, x) : 0,
    y: Number.isFinite(y) ? Math.max(0, y) : 0
  };
}

/** Translate only a scrollable frame's contents; call after its viewport clip. */
export function applyPresentationScrollOffset(ctx, state, frame) {
  const offset = getPresentationScrollOffset(state, frame);
  if (offset.x || offset.y) ctx.translate(offset.x ? -offset.x : 0, offset.y ? -offset.y : 0);
  return offset;
}

function isScrollableFrame(node) {
  return node?.type === 'frame' && frameOverflowBehaviors.has(node.overflowBehavior)
    && node.overflowBehavior !== 'none';
}

function clipsNodeContents(node) {
  return Boolean(node?.clip) || isScrollableFrame(node);
}

/** Clip children to their frame viewport when clipping or presentation scrolling is enabled. */
export function clipNodeContents(ctx, node, x, y, radius = node?.cornerRadii ?? node?.radius ?? 0) {
  if (!clipsNodeContents(node)) return false;
  ctx.beginPath();
  roundedRect(ctx, x, y, node.width, node.height, radius || 0);
  ctx.clip();
  return true;
}

function starPath(ctx, cx, cy, radius, points, innerRatio) {
  const count = Math.max(3, Math.min(32, Number(points) || 5));
  for (let index = 0; index < count * 2; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI / count;
    const distance = radius * (index % 2 ? innerRatio : 1);
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function polygonPath(ctx, cx, cy, radiusX, radiusY, points) {
  const count = Math.max(3, Math.min(32, Number(points) || 6));
  for (let index = 0; index < count; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    const x = cx + Math.cos(angle) * radiusX;
    const y = cy + Math.sin(angle) * radiusY;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function hasHandle(point, part) {
  const handle = point?.[part];
  return Boolean(handle && (Number(handle.x) !== 0 || Number(handle.y) !== 0));
}

function traceVectorPath(ctx, node, x, y) {
  for (const [contourIndex, contour] of vectorPathContours(node).entries()) {
    const points = contour.points || [];
    if (!points.length) continue;
    const position = (index, part) => vectorNodePoint(node, index, part, { x, y }, contourIndex);
    const first = position(0, 'anchor');
    ctx.moveTo(first.x, first.y);
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const end = position(index, 'anchor');
      if (hasHandle(previous, 'out') || hasHandle(current, 'in')) {
        const control1 = position(index - 1, 'out');
        const control2 = position(index, 'in');
        ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
      } else ctx.lineTo(end.x, end.y);
    }
    if (contour.closed) {
      const last = points.at(-1);
      if (hasHandle(last, 'out') || hasHandle(points[0], 'in')) {
        const control1 = position(points.length - 1, 'out');
        const control2 = position(0, 'in');
        ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, first.x, first.y);
      }
      ctx.closePath();
    }
  }
}

function pathHasClosedContour(node) {
  return vectorPathContours(node).some(contour => contour.closed && contour.points.length >= 2);
}

function traceVectorNetworkEdges(ctx, node, x, y) {
  for (const edge of node.edges || []) {
    const points = vectorNetworkEdgePoints(node, edge.id, { x, y });
    if (!points) continue;
    const [start, control1, control2, end] = points;
    ctx.moveTo(start.x, start.y);
    if (edge.control1 || edge.control2) ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
    else ctx.lineTo(end.x, end.y);
  }
}

function traceVectorNetworkFace(ctx, node, face, x, y) {
  const ids = face?.vertexIds || [];
  if (ids.length < 3) return false;
  const edgesByPair = new Map();
  for (const edge of node.edges || []) {
    const forward = `${edge.from}\0${edge.to}`; const reverse = `${edge.to}\0${edge.from}`;
    if (!edgesByPair.has(forward)) edgesByPair.set(forward, edge);
    if (!edgesByPair.has(reverse)) edgesByPair.set(reverse, edge);
  }
  const first = vectorNetworkVertexPoint(node, ids[0], { x, y });
  if (!first) return false;
  ctx.moveTo(first.x, first.y);
  for (let index = 0; index < ids.length; index += 1) {
    const fromId = ids[index]; const toId = ids[(index + 1) % ids.length];
    const edge = edgesByPair.get(`${fromId}\0${toId}`);
    const end = vectorNetworkVertexPoint(node, toId, { x, y });
    if (!edge || !end) return false;
    const points = vectorNetworkEdgePoints(node, edge.id, { x, y });
    const reversed = edge.from !== fromId;
    const control1 = points[reversed ? 2 : 1]; const control2 = points[reversed ? 1 : 2];
    if (edge.control1 || edge.control2) ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
    else ctx.lineTo(end.x, end.y);
  }
  ctx.closePath();
  return true;
}

export function drawTrackedText(ctx, text, x, y, letterSpacing = 0, maxWidth = undefined) {
  const value = String(text ?? '');
  const spacing = Number(letterSpacing) || 0;
  if (!spacing) { ctx.fillText(value, x, y, maxWidth); return; }
  if (typeof ctx.letterSpacing === 'string') {
    const previous = ctx.letterSpacing;
    try {
      ctx.letterSpacing = `${spacing}px`;
      ctx.fillText(value, x, y, maxWidth);
      return;
    } finally { ctx.letterSpacing = previous; }
  }
  const glyphs = textGraphemes(value);
  let prefix = '';
  for (let index = 0; index < glyphs.length; index += 1) {
    const glyph = glyphs[index];
    const position = ctx.measureText(prefix + glyph).width - ctx.measureText(glyph).width + index * spacing;
    ctx.fillText(glyph, x + position, y);
    prefix += glyph;
  }
}

function drawJustifiedPlainText(ctx, text, x, y, letterSpacing, extraSpace) {
  const segments = String(text ?? '').match(/\s+|\S+/gu) || [];
  let offset = 0;
  let hasTextBefore = false;
  for (const [index, segment] of segments.entries()) {
    const whitespace = /^\s+$/u.test(segment);
    drawTrackedText(ctx, segment, x + offset, y, letterSpacing);
    offset += measureTrackedText(ctx, segment, letterSpacing);
    // Drawing tokens separately removes the tracking between adjacent tokens.
    // Keep that boundary advance so justified text matches measuring the full line.
    if (index < segments.length - 1) offset += Number(letterSpacing) || 0;
    if (whitespace) {
      const nextText = segments.slice(index + 1).some(part => !/^\s+$/u.test(part));
      if (hasTextBefore && nextText) offset += extraSpace * textGraphemes(segment).length;
    } else hasTextBefore = true;
  }
  return offset;
}

export function drawTextDecoration(ctx, x, y, width, fontSize, decoration) {
  if (!width || !['underline', 'line-through'].includes(decoration)) return false;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = Math.max(1, Number(fontSize) / 16 || 1);
  const lineY = y + Number(fontSize) * (decoration === 'underline' ? 1.03 : 0.55);
  ctx.beginPath(); ctx.moveTo(x, lineY); ctx.lineTo(x + width, lineY); ctx.stroke();
  ctx.restore();
  return true;
}

/** Returns the non-negative vertical free-space offset for a text box. */
export function textVerticalOffset(boxHeight, contentHeight, alignment = 'top') {
  const box = Number(boxHeight);
  const content = Number(contentHeight);
  const freeSpace = Math.max(0, (Number.isFinite(box) ? box : 0) - (Number.isFinite(content) ? content : 0));
  if (alignment === 'middle') return freeSpace / 2;
  if (alignment === 'bottom') return freeSpace;
  return 0;
}

function richFont(style) {
  return `${style.fontStyle === 'italic' ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

function drawParagraphMarker(ctx, marker, x, y, fallbackStyle, fillOpacity = 1) {
  const style = marker.style || fallbackStyle;
  ctx.save();
  ctx.font = richFont(style);
  ctx.fillStyle = rgba(style.color || fallbackStyle.color, fillOpacity);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const markerWidth = measureTrackedText(ctx, marker.text, style.letterSpacing);
  // Right-align within the marker column. Keeping this draw independent from
  // the text-line transform preserves a stable gutter for center/right text.
  drawTrackedText(ctx, marker.text, x + marker.anchorX - markerWidth, y, style.letterSpacing);
  ctx.restore();
}

/** Draws styled text runs using node-wide values as fallbacks for each run. */
export function drawTextRuns(ctx, runs, x, y, width, baseStyle = {}) {
  const previousFont = ctx.font;
  let layout;
  try {
    layout = layoutTextRuns(runs, Math.max(1, width), baseStyle, (text, style) => {
      ctx.font = richFont(style);
      return measureTrackedText(ctx, text, style.letterSpacing);
    });
  } finally {
    ctx.font = previousFont;
  }
  const { lines } = layout;
  const contentHeight = layout.height;
  let top = y + textVerticalOffset(baseStyle.height ?? contentHeight, contentHeight, baseStyle.verticalAlign);
  for (const line of lines) {
    if (line.marker) drawParagraphMarker(ctx, line.marker, x, top + line.y, richTextStyleForMarker(baseStyle), baseStyle.fillOpacity ?? 1);
    const availableWidth = Math.max(1, width - line.indent);
    const lineAlign = line.align || baseStyle.align || 'left';
    const offsetX = line.indent + (lineAlign === 'center' ? (availableWidth - line.width) / 2 : lineAlign === 'right' ? availableWidth - line.width : 0);
    const scaleX = line.naturalWidth > availableWidth && line.naturalWidth > 0 ? availableWidth / line.naturalWidth : 1;

    ctx.save();
    ctx.translate(x + offsetX, top + line.y);
    ctx.scale(scaleX, 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (line.justify) {
      const segments = [];
      for (const part of line.parts) {
        for (const text of part.text.match(/\s+|\S+/gu) || []) segments.push({ text, part });
      }
      let offset = 0;
      const partBounds = new Map();
      let hasTextBefore = false;
      for (const [index, segment] of segments.entries()) {
        const { part, text } = segment;
        const style = part.style;
        ctx.font = richFont(style);
        ctx.fillStyle = rgba(style.color, baseStyle.fillOpacity ?? 1);
        const start = offset;
        drawTrackedText(ctx, text, start, 0, style.letterSpacing);
        offset += measureTrackedText(ctx, text, style.letterSpacing);
        if (segments[index + 1]?.part === part) offset += Number(style.letterSpacing) || 0;
        const bounds = partBounds.get(part) || { start, end: offset };
        bounds.end = offset;
        partBounds.set(part, bounds);
        if (/^\s+$/u.test(text)) {
          const nextText = segments.slice(index + 1).some(next => !/^\s+$/u.test(next.text));
          if (hasTextBefore && nextText) offset += line.justificationExtraSpace * textGraphemes(text).length;
          bounds.end = offset;
        } else hasTextBefore = true;
      }
      for (const part of line.parts) {
        const bounds = partBounds.get(part);
        if (!bounds) continue;
        ctx.font = richFont(part.style);
        ctx.fillStyle = rgba(part.style.color, baseStyle.fillOpacity ?? 1);
        drawTextDecoration(ctx, bounds.start, 0, bounds.end - bounds.start, part.style.fontSize, part.style.textDecoration);
      }
      ctx.restore();
      continue;
    }
    for (const part of line.parts) {
      ctx.font = richFont(part.style);
      ctx.fillStyle = rgba(part.style.color, baseStyle.fillOpacity ?? 1);
      drawTrackedText(ctx, part.text, part.offsetX, 0, part.style.letterSpacing);
      drawTextDecoration(ctx, part.offsetX, 0, part.width, part.style.fontSize, part.style.textDecoration);
    }
    ctx.restore();
  }
  return { lines: lines.map(line => line.parts), height: contentHeight, verticalOffset: textVerticalOffset(baseStyle.height ?? contentHeight, contentHeight, baseStyle.verticalAlign) };
}

function richTextStyleForMarker(baseStyle) {
  return {
    fontFamily: baseStyle.fontFamily || 'Arial, sans-serif',
    fontSize: Number(baseStyle.fontSize) || 24,
    fontWeight: baseStyle.fontWeight || 400,
    fontStyle: baseStyle.fontStyle || 'normal',
    letterSpacing: Number(baseStyle.letterSpacing) || 0,
    color: baseStyle.color || '#000000'
  };
}

export class SceneRenderer {
  constructor(canvas, getState) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.getState = getState;
    this.frame = 0;
    this.booleanCache = new Map();
    this.booleanCachePixels = 0;
    this.resizeObserver = new ResizeObserver(() => this.invalidate());
    this.resizeObserver.observe(canvas.parentElement);
    this.invalidate();
  }

  invalidate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return { width, height, dpr, cssWidth: rect.width, cssHeight: rect.height };
  }

  draw() {
    const state = this.getState();
    const { width, height, dpr, cssWidth, cssHeight } = this.resize();
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#e9e9e9';
    ctx.fillRect(0, 0, width, height);
    const page = state.document.pages.find(item => item.id === state.document.activePageId);
    if (!page) return;
    ctx.setTransform(dpr * state.zoom, 0, 0, dpr * state.zoom, dpr * state.panX, dpr * state.panY);
    for (const node of page.children) this.drawNode(ctx, node, 0, 0, state.assets);
    this.drawSelection(ctx, page.children, state.selectedIds, 0, 0);
    drawAlignmentGuides(ctx, state.smartGuides, state.zoom);
    if (!state.presenting) this.drawCommentPins(ctx, page, state, cssWidth, cssHeight);
    if (state.inspectorTab === 'prototype') this.drawPrototypeConnections(ctx, page, state);
    if (state.draftNode) this.drawNode(ctx, state.draftNode, 0, 0, state.assets, true);
    if (state.penDraft) {
      let transform = null;
      const entry = state.penDraft.networkNodeId ? findNode(state.document, state.penDraft.networkNodeId) : null;
      if (entry) {
        const node = entry.node;
        const origin = entry.parents.reduce((point, parent) => ({ x: point.x + parent.x, y: point.y + parent.y }), { x: node.x, y: node.y });
        const center = { x: origin.x + node.width / 2, y: origin.y + node.height / 2 };
        const angle = (node.rotation || 0) * Math.PI / 180;
        transform = point => {
          const dx = point.x - center.x; const dy = point.y - center.y;
          return { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
        };
      }
      this.drawPenDraft(ctx, state.penDraft, state.penHover, state.zoom, transform);
    }
    if (state.pencilDraft) this.drawPencilDraft(ctx, state.pencilDraft, state.zoom);
    if (state.marquee) {
      const x = Math.min(state.marquee.x1, state.marquee.x2);
      const y = Math.min(state.marquee.y1, state.marquee.y2);
      const w = Math.abs(state.marquee.x2 - state.marquee.x1);
      const h = Math.abs(state.marquee.y2 - state.marquee.y1);
      ctx.save(); ctx.fillStyle = 'rgba(13,153,255,.10)'; ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / state.zoom;
      ctx.setLineDash([4 / state.zoom, 3 / state.zoom]); ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.restore();
    }
    if (!page.children.length) this.drawEmptyHint(cssWidth, cssHeight, dpr, state);
  }

  drawNode(ctx, node, parentX, parentY, assets, draft = false, maskMode = false, renderOptions = {}) {
    const state = this.getState();
    const document = state.document;
    if (!getNodePropertyValue(document, node, 'visible')) return;
    node = { ...node, ...getNodeGeometry(document, node) };
    const effects = (node.effects || []).filter(effect => effect.visible);
    const outline = !state.presenting && (renderOptions.outlineMode ?? state.outlineMode);
    const blendMode = node.blendMode || 'normal';
    const compositeBypassed = renderOptions.compositeBypassNodeId === node.id;
    if ((effects.length && renderOptions.effectBypassNodeId !== node.id || blendMode !== 'normal' && !compositeBypassed)
      && !draft && !maskMode && !outline && typeof ctx.filter === 'string') {
      this.drawNodeWithEffects(ctx, node, parentX, parentY, assets, effects, renderOptions);
      return;
    }
    const opacity = getNodePropertyValue(document, node, 'opacity');
    const radius = node.cornerRadii || getNodePropertyValue(document, node, 'radius');
    const x = parentX + node.x; const y = parentY + node.y;
    const width = node.width; const height = node.height;
    const cx = x + width / 2; const cy = y + height / 2;
    ctx.save();
    if (blendMode !== 'normal' && !compositeBypassed) ctx.globalCompositeOperation = canvasBlendOperation(blendMode);
    ctx.globalAlpha *= opacity ?? 1;
    if (node.rotation) { ctx.translate(cx, cy); ctx.rotate(node.rotation * Math.PI / 180); ctx.translate(-cx, -cy); }
    if (!draft && !state.presenting && (renderOptions.outlineMode ?? state.outlineMode)) {
      this.drawNodeOutline(ctx, node, x, y, assets, renderOptions);
      ctx.restore();
      return;
    }
    if (node.type === 'boolean') {
      this.drawBooleanGroup(ctx, node, x, y, assets, maskMode, renderOptions);
      if (draft) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.setLineDash([4, 3]); ctx.stroke(); }
      ctx.restore();
      return;
    }
    if (node.type === 'group' && node.mask && !maskMode) {
      this.drawMaskGroup(ctx, node, x, y, assets, renderOptions);
      if (draft) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.setLineDash([4, 3]); ctx.stroke(); }
      ctx.restore();
      return;
    }
    ctx.beginPath();
    switch (node.type) {
      case 'frame':
      case 'section':
      case 'group':
      case 'rectangle':
        roundedRect(ctx, x, y, width, height, radius || 0);
        break;
      case 'ellipse':
        ctx.ellipse(cx, cy, Math.abs(width) / 2, Math.abs(height) / 2, 0, 0, Math.PI * 2);
        break;
      case 'line':
        ctx.moveTo(x, y); ctx.lineTo(x + width, y + height);
        break;
      case 'star':
        starPath(ctx, cx, cy, Math.min(Math.abs(width), Math.abs(height)) / 2, node.points, node.innerRadius ?? 0.48);
        break;
      case 'polygon':
        polygonPath(ctx, cx, cy, Math.abs(width) / 2, Math.abs(height) / 2, node.points);
        break;
      case 'path':
        traceVectorPath(ctx, node, x, y);
        break;
      case 'network':
        traceVectorNetworkEdges(ctx, node, x, y);
        break;
      default:
        ctx.rect(x, y, width, height);
    }

    if (maskMode) {
      ctx.globalAlpha *= node.fillOpacity ?? 1;
      ctx.fillStyle = '#fff';
      if (node.type === 'network') {
        for (const face of node.faces || []) {
          ctx.save();
          ctx.globalAlpha *= face.fillOpacity ?? 1;
          ctx.beginPath();
          if (traceVectorNetworkFace(ctx, node, face, x, y)) ctx.fill();
          ctx.restore();
        }
        ctx.restore();
        return;
      }
      if (node.type !== 'line' && (node.type !== 'path' || pathHasClosedContour(node))) fillCurrentPath(ctx, node);
      ctx.restore();
      return;
    }

    if (node.type === 'image') {
      const asset = assets.get(node.assetId);
      const image = imageForNode(node, assets, this.getState());
      if (image) {
        ctx.save();
        ctx.beginPath(); roundedRect(ctx, x, y, width, height, radius || 0); ctx.clip();
        drawFittedImage(ctx, image, x, y, width, height, node.fit);
        ctx.restore();
      } else {
        ctx.fillStyle = '#d9d9d9'; ctx.fill();
        ctx.fillStyle = '#8a8a8a'; ctx.font = '12px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('Loading image…', cx, cy);
      }
      drawStrokeStack(ctx, node, document, x, y, width, height, pathContext => roundedRect(pathContext, x, y, width, height, radius));
    } else if (node.type === 'text') {
      const sourceText = getNodePropertyValue(document, node, 'text');
      if (Array.isArray(node.textRuns) && node.textRuns.map(run => run.text).join('') === sourceText) {
        drawTextRuns(ctx, node.textRuns, x, y, width, {
          fontFamily: node.fontFamily || 'Arial, sans-serif',
          fontSize: getNodePropertyValue(document, node, 'fontSize') || 24,
          fontWeight: node.fontWeight || 400,
          fontStyle: node.fontStyle || 'normal',
          lineHeight: getNodePropertyValue(document, node, 'lineHeight') || 1.25,
          letterSpacing: getNodePropertyValue(document, node, 'letterSpacing') || 0,
          color: getNodeColor(document, node, 'text'),
          textCase: node.textCase || 'none',
          textDecoration: node.textDecoration || 'none',
          paragraphSpacing: node.paragraphSpacing || 0,
          listSpacing: node.listSpacing || 0,
          paragraphStyles: node.paragraphStyles || [],
          firstLineIndent: node.firstLineIndent || 0,
          align: node.align || 'left',
          verticalAlign: node.verticalAlign || 'top',
          height,
          fillOpacity: node.fillOpacity ?? 1
        });
      } else {
        const textColor = getNodeColor(document, node, 'text');
        ctx.fillStyle = rgba(textColor, node.fillOpacity ?? 1);
        const text = transformTextCase(sourceText, node.textCase || 'none');
        const fontSize = getNodePropertyValue(document, node, 'fontSize');
        const lineHeightScale = getNodePropertyValue(document, node, 'lineHeight');
        const letterSpacing = getNodePropertyValue(document, node, 'letterSpacing');
        ctx.font = `${node.fontStyle === 'italic' ? 'italic ' : ''}${node.fontWeight || 400} ${fontSize || 24}px ${node.fontFamily || 'Arial, sans-serif'}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        const lineHeight = (fontSize || 24) * (lineHeightScale || 1.25);
        const layout = layoutPlainText(text, Math.max(1, width), value => measureTrackedText(ctx, value, letterSpacing), {
          lineHeight, paragraphSpacing: node.paragraphSpacing, listSpacing: node.listSpacing,
          paragraphStyles: node.paragraphStyles, markerStyle: {
            fontFamily: node.fontFamily || 'Arial, sans-serif', fontSize: fontSize || 24,
            fontWeight: node.fontWeight || 400, fontStyle: node.fontStyle || 'normal',
            letterSpacing: letterSpacing || 0, color: textColor
          },
          firstLineIndent: node.firstLineIndent, align: node.align
        });
        const textY = y + textVerticalOffset(height, layout.height, node.verticalAlign || 'top');
        layout.lines.forEach(line => {
          if (line.marker) drawParagraphMarker(ctx, line.marker, x, textY + line.y, {
            fontFamily: node.fontFamily || 'Arial, sans-serif', fontSize: fontSize || 24,
            fontWeight: node.fontWeight || 400, fontStyle: node.fontStyle || 'normal',
            letterSpacing: letterSpacing || 0, color: textColor
          }, node.fillOpacity ?? 1);
          const availableWidth = Math.max(1, width - line.indent);
          const lineAlign = line.align || node.align || 'left';
          const offsetX = line.indent + (lineAlign === 'center' ? (availableWidth - line.width) / 2 : lineAlign === 'right' ? availableWidth - line.width : 0);
          if (line.justify) drawJustifiedPlainText(ctx, line.displayText, x + offsetX, textY + line.y, letterSpacing, line.justificationExtraSpace);
          else drawTrackedText(ctx, line.displayText, x + offsetX, textY + line.y, letterSpacing, availableWidth);
          drawTextDecoration(ctx, x + offsetX, textY + line.y, line.width, fontSize || 24, node.textDecoration || 'none');
        });
      }
      drawStrokeStack(ctx, node, document, x, y, width, height, pathContext => pathContext.rect(x, y, width, height));
    } else if (node.type === 'network') {
      const fills = fillStackForNode(node);
      for (const face of node.faces || []) {
        // Keep the original one-fill face behavior for old files: an image fill
        // always wins over a face color, while gradients yield to explicit
        // face colors. New stacks only let face colors override a solid first
        // paint; they must not replace an image or gradient paint.
        if (!Array.isArray(node.fills)) {
          const color = getNodeColor(document, node, 'fill');
          const fillImage = node.imageFill ? imageForNode(node, assets, state, node.imageFill.assetId) : null;
          const faceFill = face.fill ?? color;
          if ((!faceFill || faceFill === 'transparent') && !node.fillGradient && !node.imageFill) continue;
          ctx.beginPath();
          if (traceVectorNetworkFace(ctx, node, face, x, y)) {
            const gradient = !face.fill ? createGradientPaint(ctx, node.fillGradient, x, y, width, height) : null;
            ctx.save();
            ctx.globalAlpha *= (node.fillOpacity ?? 1) * (face.fillOpacity ?? 1);
            if (node.imageFill && fillImage) { ctx.clip(); drawFittedImage(ctx, fillImage, x, y, width, height, node.imageFill.fit); }
            else { ctx.fillStyle = gradient || rgba(faceFill || color || '#000000', 1); ctx.fill(); }
            ctx.restore();
          }
          continue;
        }
        for (let index = 0; index < fills.length; index += 1) {
          const fill = fills[index];
          if (!fill.visible || fill.opacity <= 0) continue;
          ctx.beginPath();
          if (!traceVectorNetworkFace(ctx, node, face, x, y)) continue;
          ctx.save();
          ctx.globalAlpha *= fill.opacity * (face.fillOpacity ?? 1);
          if (face.fill != null && index === 0 && fill.type === 'solid') {
            ctx.fillStyle = rgba(face.fill, 1); ctx.fill();
          } else if (fill.type === 'solid') {
            const color = fillLayerColor(document, node, fill, index);
            if (color && color !== 'transparent') { ctx.fillStyle = rgba(color, 1); ctx.fill(); }
          } else if (fill.type === 'linear' || fill.type === 'radial') {
            const paint = createGradientPaint(ctx, fill.gradient, x, y, width, height);
            if (paint) { ctx.fillStyle = paint; ctx.fill(); }
          } else if (fill.type === 'image') {
            const image = imageForNode(node, assets, state, fill.imageFill.assetId, imagePreviewKey(node.id, fill.id));
            if (image) { ctx.clip(); drawFittedImage(ctx, image, x, y, width, height, fill.imageFill.fit); }
          }
          ctx.restore();
        }
      }
      drawStrokeStack(ctx, node, document, x, y, width, height, pathContext => traceVectorNetworkEdges(pathContext, node, x, y));
    } else {
      if (node.type !== 'line' && (node.type !== 'path' || pathHasClosedContour(node))) drawFillStack(ctx, node, assets, state, x, y, width, height);
      drawStrokeStack(ctx, node, document, x, y, width, height);
    }

    if (draft) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.setLineDash([4, 3]); ctx.stroke(); }
    if (node.children?.length) {
      clipNodeContents(ctx, node, x, y, radius);
      applyPresentationScrollOffset(ctx, state, node);
      for (const child of node.children) this.drawNode(ctx, child, x, y, assets, draft, false, renderOptions);
    }
    if (node.type === 'frame' && !node.children.length && !draft) {
      ctx.strokeStyle = 'rgba(30,30,30,.14)'; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.strokeRect(x, y, width, height);
    }
    if (node.type === 'frame' && !draft && !state.presenting && renderOptions.showLayoutGuides !== false) this.drawLayoutGuides(ctx, node, x, y, state);
    ctx.restore();
  }

  applyInnerShadows(surface, effects, rasterScale, pixelWidth, pixelHeight) {
    const innerShadows = effects.filter(effect => effect?.type === 'inner-shadow' && effect.visible !== false && effect.opacity > 0);
    if (!innerShadows.length) return;
    const overlay = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(pixelWidth, pixelHeight)
      : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
    const overlayContext = overlay.getContext('2d');
    const surfaceContext = surface.getContext('2d');
    if (!overlayContext || !surfaceContext) return;
    for (const effect of innerShadows) {
      overlayContext.save();
      overlayContext.setTransform(1, 0, 0, 1, 0, 0);
      overlayContext.globalAlpha = 1;
      overlayContext.globalCompositeOperation = 'source-over';
      overlayContext.filter = 'none';
      overlayContext.clearRect(0, 0, pixelWidth, pixelHeight);
      overlayContext.fillStyle = effect.color;
      overlayContext.fillRect(0, 0, pixelWidth, pixelHeight);
      overlayContext.globalCompositeOperation = 'destination-out';
      overlayContext.filter = `blur(${Math.max(0, effect.blur) * rasterScale}px)`;
      overlayContext.drawImage(surface, effect.offsetX * rasterScale, effect.offsetY * rasterScale);
      overlayContext.globalCompositeOperation = 'destination-in';
      overlayContext.filter = 'none';
      overlayContext.drawImage(surface, 0, 0);
      overlayContext.restore();

      surfaceContext.save();
      surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
      surfaceContext.globalCompositeOperation = 'source-over';
      surfaceContext.globalAlpha = Math.max(0, Math.min(1, effect.opacity));
      surfaceContext.filter = 'none';
      surfaceContext.drawImage(overlay, 0, 0);
      surfaceContext.restore();
    }
  }

  drawNodeWithEffects(ctx, node, parentX, parentY, assets, effects, renderOptions = {}) {
    const transform = ctx.getTransform?.();
    const displayScale = transform ? Math.hypot(transform.a, transform.b) : Math.max(.1, (window.devicePixelRatio || 1) * (this.getState().zoom || 1));
    const radians = (Number(node.rotation) || 0) * Math.PI / 180;
    const rotatedWidth = Math.abs(node.width * Math.cos(radians)) + Math.abs(node.height * Math.sin(radians));
    const rotatedHeight = Math.abs(node.height * Math.cos(radians)) + Math.abs(node.width * Math.sin(radians));
    const effectPadding = layerEffectPadding(effects);
    const padX = effectPadding.x + Math.max(0, rotatedWidth - node.width) / 2;
    const padY = effectPadding.y + Math.max(0, rotatedHeight - node.height) / 2;
    const logicalWidth = Math.max(1, node.width + padX * 2);
    const logicalHeight = Math.max(1, node.height + padY * 2);
    const pixelBudget = 4_000_000;
    const rasterScale = Math.min(2, Math.max(.05, displayScale), Math.sqrt(pixelBudget / (logicalWidth * logicalHeight)), 4096 / logicalWidth, 4096 / logicalHeight);
    const pixelWidth = Math.max(1, Math.ceil(logicalWidth * rasterScale));
    const pixelHeight = Math.max(1, Math.ceil(logicalHeight * rasterScale));
    const surface = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(pixelWidth, pixelHeight)
      : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
    const effectContext = surface.getContext('2d');
    if (!effectContext) {
      ctx.save();
      ctx.globalCompositeOperation = canvasBlendOperation(node.blendMode || 'normal');
      this.drawNode(ctx, node, parentX, parentY, assets, false, false, { ...renderOptions, effectBypassNodeId: node.id, compositeBypassNodeId: node.id });
      ctx.restore();
      return;
    }
    effectContext.setTransform(rasterScale, 0, 0, rasterScale, padX * rasterScale, padY * rasterScale);
    const copy = { ...node, x: 0, y: 0, opacity: 1, variableBindings: { ...(node.variableBindings || {}) } };
    // SVG applies layer opacity to the filtered group result. Keep the Canvas
    // effect surface at full layer opacity too, then apply the resolved value
    // once when the completed surface is composited back to its parent.
    delete copy.variableBindings.opacity;
    delete copy.variableBindings.x;
    delete copy.variableBindings.y;
    this.drawNode(effectContext, copy, 0, 0, assets, false, false, { ...renderOptions, effectBypassNodeId: node.id, compositeBypassNodeId: node.id });
    this.applyInnerShadows(surface, effects, rasterScale, pixelWidth, pixelHeight);
    const x = parentX + node.x; const y = parentY + node.y;
    ctx.save();
    ctx.globalAlpha *= getNodePropertyValue(this.getState().document, node, 'opacity') ?? 1;
    ctx.filter = buildLayerEffectFilter(effects, displayScale);
    ctx.globalCompositeOperation = canvasBlendOperation(node.blendMode || 'normal');
    ctx.drawImage(surface, x - padX, y - padY, logicalWidth, logicalHeight);
    ctx.restore();
  }

  drawNodeOutline(ctx, node, x, y, assets, renderOptions = {}) {
    const state = this.getState();
    const width = node.width; const height = node.height;
    const cx = x + width / 2; const cy = y + height / 2;
    const radius = node.cornerRadii || getNodePropertyValue(state.document, node, 'radius') || 0;
    ctx.beginPath();
    if (node.type === 'boolean' || (node.type === 'group' && node.mask)) {
      ctx.rect(x, y, width, height);
      ctx.setLineDash(node.type === 'boolean' ? [3 / (state.zoom || 1), 2 / (state.zoom || 1)] : []);
    } else {
      switch (node.type) {
        case 'frame':
        case 'section':
        case 'group':
        case 'rectangle':
          roundedRect(ctx, x, y, width, height, radius);
          break;
        case 'ellipse':
          ctx.ellipse(cx, cy, Math.abs(width) / 2, Math.abs(height) / 2, 0, 0, Math.PI * 2);
          break;
        case 'line':
          ctx.moveTo(x, y); ctx.lineTo(x + width, y + height);
          break;
        case 'star':
          starPath(ctx, cx, cy, Math.min(Math.abs(width), Math.abs(height)) / 2, node.points, node.innerRadius ?? 0.48);
          break;
        case 'polygon':
          polygonPath(ctx, cx, cy, Math.abs(width) / 2, Math.abs(height) / 2, node.points);
          break;
        case 'path':
          traceVectorPath(ctx, node, x, y);
          break;
        case 'network':
          traceVectorNetworkEdges(ctx, node, x, y);
          break;
        case 'image':
          roundedRect(ctx, x, y, width, height, radius);
          break;
        default:
          ctx.rect(x, y, width, height);
      }
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#626b78';
    ctx.lineWidth = 1 / (state.zoom || 1);
    ctx.lineJoin = 'round';
    ctx.stroke();

    if (node.children?.length) {
      ctx.save();
      clipNodeContents(ctx, node, x, y, radius);
      applyPresentationScrollOffset(ctx, state, node);
      for (const child of node.children) this.drawNode(ctx, child, x, y, assets, false, false, renderOptions);
      ctx.restore();
    }
    if (node.type === 'frame' && renderOptions.showLayoutGuides !== false) this.drawLayoutGuides(ctx, node, x, y, state);
  }

  drawLayoutGuides(ctx, frame, x, y, state = this.getState()) {
    if (!state.showLayoutGuides || frame.rotation || !Array.isArray(frame.layoutGuides) || frame.width <= 0 || frame.height <= 0) return;
    const guides = frame.layoutGuides.filter(guide => guide.visible);
    if (!guides.length) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, frame.width, frame.height); ctx.clip();
    for (const guide of guides) {
      ctx.fillStyle = rgba(guide.color, guide.opacity);
      if (guide.type === 'grid') {
        const lines = layoutGuideGridLines(guide, frame.width, frame.height);
        if (!lines.verticals.length && !lines.horizontals.length) continue;
        ctx.beginPath();
        for (const position of lines.verticals) { ctx.moveTo(x + position, y); ctx.lineTo(x + position, y + frame.height); }
        for (const position of lines.horizontals) { ctx.moveTo(x, y + position); ctx.lineTo(x + frame.width, y + position); }
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1 / (state.zoom || 1);
        ctx.stroke();
      } else {
        for (const region of layoutGuideRegions(guide, frame.width, frame.height)) ctx.fillRect(x + region.x, y + region.y, region.width, region.height);
      }
    }
    ctx.restore();
  }

  drawMaskGroup(ctx, node, x, y, assets, renderOptions = {}) {
    if (!Array.isArray(node.children) || node.children.length < 2 || node.width <= 0 || node.height <= 0) return;
    const transform = ctx.getTransform?.();
    const requestedScale = transform ? Math.hypot(transform.a, transform.b) : (window.devicePixelRatio || 1) * Math.max(.08, this.getState().zoom || 1);
    const pixelBudget = 4_000_000;
    const scale = Math.min(2, Math.max(.08, requestedScale), Math.sqrt(pixelBudget / Math.max(1, node.width * node.height)));
    const pixelWidth = Math.max(1, Math.ceil(node.width * scale));
    const pixelHeight = Math.max(1, Math.ceil(node.height * scale));
    const surface = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(pixelWidth, pixelHeight)
      : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
    const maskContext = surface.getContext('2d');
    maskContext.setTransform(pixelWidth / node.width, 0, 0, pixelHeight / node.height, 0, 0);
    const maskNode = node.children.find(child => child.id === node.maskSourceId) || node.children[0];
    for (const child of node.children) if (child !== maskNode) this.drawNode(maskContext, child, 0, 0, assets, false, false, renderOptions);
    maskContext.globalCompositeOperation = 'destination-in';
    this.drawNode(maskContext, maskNode, 0, 0, assets, false, true, renderOptions);
    maskContext.globalCompositeOperation = 'source-over';
    ctx.drawImage(surface, x, y, node.width, node.height);
  }

  drawBooleanGroup(ctx, node, x, y, assets, maskMode = false, renderOptions = {}) {
    const state = this.getState();
    const transform = ctx.getTransform?.();
    const contextScale = transform ? Math.hypot(transform.a, transform.b) : (window.devicePixelRatio || 1) * Math.max(.08, state.zoom || 1);
    const surface = this.getBooleanSurface(node, assets, maskMode, contextScale, renderOptions);
    ctx.save();
    if (!Array.isArray(node.fills)) ctx.globalAlpha *= node.fillOpacity ?? 1;
    ctx.drawImage(surface, x, y, node.width, node.height);
    ctx.restore();
  }

  getBooleanSurface(node, assets, maskMode = false, contextScale = null, renderOptions = {}) {
    const state = this.getState();
    const fill = maskMode ? '#ffffff' : getNodeColor(state.document, node, 'fill');
    const requestedScale = contextScale ?? (window.devicePixelRatio || 1) * Math.max(.08, state.zoom || 1);
    const deviceScale = Math.min(2, Math.max(.08, requestedScale));
    const pixelBudget = 4_000_000;
    const scale = Math.min(deviceScale, Math.sqrt(pixelBudget / Math.max(1, node.width * node.height)));
    const width = Math.max(1, Math.ceil(node.width * scale));
    const height = Math.max(1, Math.ceil(node.height * scale));
    const fillPreviewVersions = (node.fills || []).filter(fillLayer => fillLayer.type === 'image').map(fillLayer => {
      const previewKey = imagePreviewKey(node.id, fillLayer.id);
      return [previewKey, state.previewVersions?.get(previewKey) || 0, state.previewAssetIds?.get(previewKey) || null];
    });
    const legacyPreviewKey = !Array.isArray(node.fills) && node.imageFill ? imagePreviewKey(node.id) : null;
    const imagePreviewVersion = legacyPreviewKey
      ? [legacyPreviewKey, state.previewVersions?.get(legacyPreviewKey) || 0, state.previewAssetIds?.get(legacyPreviewKey) || null]
      : null;
    const resolvedChildren = node.children.map(child => booleanNodeCacheState(state.document, child));
    const key = `${maskMode ? 'mask' : 'paint'}|${JSON.stringify(node)}|${JSON.stringify(resolvedChildren)}|${fill}|${JSON.stringify([imagePreviewVersion, fillPreviewVersions])}|${width}x${height}`;
    let entry = this.booleanCache.get(key);
    if (entry) {
      this.booleanCache.delete(key);
      this.booleanCache.set(key, entry);
    } else {
      const surface = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
      const mask = surface.getContext('2d');
      const pixelScaleX = width / Math.max(1, node.width);
      const pixelScaleY = height / Math.max(1, node.height);
      mask.setTransform(pixelScaleX, 0, 0, pixelScaleY, 0, 0);
      const sourceTransform = booleanSourceTransform(resolvedChildren, node.width, node.height);
      mask.setTransform(
        pixelScaleX * sourceTransform.scaleX, 0, 0, pixelScaleY * sourceTransform.scaleY,
        -pixelScaleX * sourceTransform.left * sourceTransform.scaleX,
        -pixelScaleY * sourceTransform.top * sourceTransform.scaleY
      );
      const operation = node.operation || 'union';
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        const visible = Boolean(resolvedChildren[index].visible);
        if (!visible && operation !== 'intersect') continue;
        mask.save();
        if (index === 0 || operation === 'union') mask.globalCompositeOperation = 'source-over';
        else if (operation === 'subtract') mask.globalCompositeOperation = 'destination-out';
        else if (operation === 'intersect') mask.globalCompositeOperation = 'destination-in';
        else if (operation === 'exclude') mask.globalCompositeOperation = 'xor';
        this.drawNode(mask, child, 0, 0, assets, false, true, renderOptions);
        mask.restore();
        if (!visible && operation === 'intersect') {
          mask.setTransform(pixelScaleX, 0, 0, pixelScaleY, 0, 0);
          mask.clearRect(0, 0, node.width, node.height);
          break;
        }
      }
      // Boolean source geometry is scaled into the current group bounds above.
      // Paint the completed mask and group fills back in the unscaled surface box.
      mask.setTransform(pixelScaleX, 0, 0, pixelScaleY, 0, 0);
      if (!maskMode && Array.isArray(node.fills)) {
        const createSurface = () => typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement('canvas'), { width, height });
        const alphaSurface = createSurface();
        alphaSurface.getContext('2d').drawImage(surface, 0, 0);
        const paintSurface = createSurface();
        const paintContext = paintSurface.getContext('2d');
        paintContext.setTransform(width / Math.max(1, node.width), 0, 0, height / Math.max(1, node.height), 0, 0);
        mask.clearRect(0, 0, node.width, node.height);
        mask.globalCompositeOperation = 'source-over';
        for (let fillIndex = 0; fillIndex < node.fills.length; fillIndex += 1) {
          const fillLayer = node.fills[fillIndex];
          if (!fillLayer.visible || fillLayer.opacity <= 0) continue;
          paintContext.clearRect(0, 0, node.width, node.height);
          paintContext.globalCompositeOperation = 'source-over';
          paintContext.globalAlpha = fillLayer.opacity;
          if (fillLayer.type === 'solid') {
            const color = fillLayerColor(state.document, node, fillLayer, fillIndex);
            if (!color || color === 'transparent') continue;
            paintContext.fillStyle = color; paintContext.fillRect(0, 0, node.width, node.height);
          } else if (fillLayer.type === 'linear' || fillLayer.type === 'radial') {
            const paint = createGradientPaint(paintContext, fillLayer.gradient, 0, 0, node.width, node.height);
            if (!paint) continue;
            paintContext.fillStyle = paint; paintContext.fillRect(0, 0, node.width, node.height);
          } else if (fillLayer.type === 'image') {
            const imageFill = fillLayer.imageFill;
            const image = imageForNode(node, assets, state, imageFill.assetId, imagePreviewKey(node.id, fillLayer.id));
            if (!image) continue;
            drawFittedImage(paintContext, image, 0, 0, node.width, node.height, imageFill.fit);
          }
          paintContext.globalAlpha = 1;
          paintContext.globalCompositeOperation = 'destination-in';
          paintContext.drawImage(alphaSurface, 0, 0, node.width, node.height);
          mask.globalAlpha = 1;
          mask.globalCompositeOperation = 'source-over';
          mask.drawImage(paintSurface, 0, 0, node.width, node.height);
        }
      } else {
        mask.save();
        mask.globalCompositeOperation = 'source-in';
        const fillImage = !maskMode && node.imageFill ? imageForNode(node, assets, state, node.imageFill.assetId) : null;
        if (fillImage) drawFittedImage(mask, fillImage, 0, 0, node.width, node.height, node.imageFill.fit);
        else {
          mask.fillStyle = !maskMode && node.fillGradient ? createGradientPaint(mask, node.fillGradient, 0, 0, node.width, node.height) || fill : fill;
          mask.fillRect(0, 0, node.width, node.height);
        }
        mask.restore();
      }
      entry = { surface, pixels: width * height };
      this.booleanCache.set(key, entry);
      this.booleanCachePixels += entry.pixels;
      while (this.booleanCache.size > 6 || this.booleanCachePixels > 8_000_000) {
        const oldestKey = this.booleanCache.keys().next().value;
        if (oldestKey === key && this.booleanCache.size === 1) break;
        const oldest = this.booleanCache.get(oldestKey);
        this.booleanCache.delete(oldestKey);
        this.booleanCachePixels -= oldest.pixels;
      }
    }
    return entry.surface;
  }

  hitTestBoolean(node, point, originX, originY) {
    if (node.width <= 0 || node.height <= 0) return false;
    const center = { x: originX + node.width / 2, y: originY + node.height / 2 };
    const angle = -(node.rotation || 0) * Math.PI / 180;
    const dx = point.x - center.x; const dy = point.y - center.y;
    const localX = center.x + dx * Math.cos(angle) - dy * Math.sin(angle) - originX;
    const localY = center.y + dx * Math.sin(angle) + dy * Math.cos(angle) - originY;
    if (localX < 0 || localY < 0 || localX > node.width || localY > node.height) return false;
    const surface = this.getBooleanSurface(node, this.getState().assets, true);
    const pixelX = Math.min(surface.width - 1, Math.floor(localX / node.width * surface.width));
    const pixelY = Math.min(surface.height - 1, Math.floor(localY / node.height * surface.height));
    return surface.getContext('2d').getImageData(pixelX, pixelY, 1, 1).data[3] > 8;
  }

  drawPenDraft(ctx, draft, hover, zoom = 1, transform = null) {
    const points = (draft.anchors || []).map(point => transform ? {
      ...point,
      ...transform(point),
      in: transform(point.in), out: transform(point.out)
    } : point);
    if (!points.length) return;
    const scale = 1 / Math.max(.08, zoom || 1);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]; const current = points[index];
      if (previous.out.x !== previous.x || previous.out.y !== previous.y || current.in.x !== current.x || current.in.y !== current.y) ctx.bezierCurveTo(previous.out.x, previous.out.y, current.in.x, current.in.y, current.x, current.y);
      else ctx.lineTo(current.x, current.y);
    }
    if (hover && points.length) {
      const last = points.at(-1);
      if (last.out.x !== last.x || last.out.y !== last.y) ctx.bezierCurveTo(last.out.x, last.out.y, hover.x, hover.y, hover.x, hover.y);
      else ctx.lineTo(hover.x, hover.y);
    }
    ctx.setLineDash([6 * scale, 4 * scale]); ctx.lineWidth = 1.5 * scale; ctx.strokeStyle = BLUE; ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#ffffff'; ctx.strokeStyle = BLUE; ctx.lineWidth = scale;
    for (const point of points) {
      for (const part of ['in', 'out']) {
        const handle = point[part];
        if (handle.x === point.x && handle.y === point.y) continue;
        ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(handle.x, handle.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(handle.x, handle.y, 3.5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.rect(point.x - 4 * scale, point.y - 4 * scale, 8 * scale, 8 * scale); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  drawPencilDraft(ctx, draft, zoom = 1) {
    const points = draft?.points || [];
    if (!points.length) return;
    const scale = 1 / Math.max(.08, zoom || 1);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 2) ctx.lineTo(points[1].x, points[1].y);
    else {
      for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index];
        const next = points[index + 1];
        ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
      }
      const last = points.at(-1);
      ctx.lineTo(last.x, last.y);
    }
    ctx.lineWidth = 2.25 * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = BLUE;
    ctx.stroke();
    ctx.restore();
  }

  drawSelection(ctx, nodes, selectedIds, parentX, parentY) {
    const selected = [];
    const collect = (list, ancestors = []) => {
      for (const node of list) {
        const geometry = getNodeGeometry(this.getState().document, node);
        const resolvedNode = { ...node, ...geometry };
        if (selectedIds.includes(node.id)) selected.push({ node: resolvedNode, ancestors });
        collect(node.children || [], [...ancestors, resolvedNode]);
      }
    };
    collect(nodes, []);
    if (!selected.length) return;
    const zoom = Math.max(.08, this.getState().zoom || 1);
    const size = 6 / zoom;
    ctx.save();
    ctx.strokeStyle = BLUE; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 1 / (this.getState().zoom || 1);
    for (const entry of selected) {
      const { corners } = selectionOverlayGeometry(entry.node, entry.ancestors, { zoom, rotateOffset: 0 });
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let index = 1; index < corners.length; index += 1) ctx.lineTo(corners[index].x, corners[index].y);
      ctx.closePath(); ctx.stroke();
    }
    const selectedIdsSet = new Set(selectedIds);
    const roots = selected.filter(entry => !entry.ancestors.some(parent => selectedIdsSet.has(parent.id)));
    const groupTransformAllowed = roots.length > 1 && roots.every(({ node, ancestors }) =>
      !node.locked && !ancestors.some(parent => parent.locked)
      && !(ancestors.at(-1)?.autoLayout && node.layoutPositioning !== 'absolute')
      && !['x', 'y', 'width', 'height', 'rotation'].some(property => node.variableBindings?.[property]));
    if (roots.length > 1 && groupTransformAllowed) {
      const bounds = selectionBounds(roots);
      const handles = selectionGroupHandles(bounds, { rotateOffset: 24 / zoom });
      const north = handles.resize.n;
      ctx.beginPath(); ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height); ctx.stroke();
      if (north) {
        ctx.beginPath(); ctx.moveTo(north.x, north.y); ctx.lineTo(handles.rotate.x, handles.rotate.y); ctx.stroke();
      }
      for (const point of Object.values(handles.resize)) {
        ctx.beginPath(); ctx.rect(point.x - size / 2, point.y - size / 2, size, size); ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(handles.rotate.x, handles.rotate.y, size * .65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (roots.length === 1) {
      const { node, ancestors } = roots[0];
      const overlay = selectionOverlayGeometry(node, ancestors, { zoom });
      const resizePoints = Object.values(overlay.handles.resize);
      const north = overlay.handles.resize.n;
      const rotate = overlay.handles.rotate;
      ctx.beginPath(); ctx.moveTo(north.x, north.y); ctx.lineTo(rotate.x, rotate.y); ctx.stroke();
      for (const point of resizePoints) {
        ctx.beginPath(); ctx.rect(point.x - size / 2, point.y - size / 2, size, size); ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(rotate.x, rotate.y, size * .65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      const nodeTransform = nodeLocalToPageTransform(node, ancestors);
      const pagePoint = point => transformPoint(nodeTransform, point);
      if (selected.length === 1 && node.type === 'path') {
        const selection = this.getState().selectedVectorPoint;
        const selectedPointIndex = selection?.nodeId === node.id ? selection.index : -1;
        const selectedContourIndex = selection?.nodeId === node.id ? selection.contourIndex || 0 : -1;
        for (const [contourIndex, contour] of vectorPathContours(node).entries()) {
          for (const [index] of contour.points.entries()) {
            const anchor = pagePoint(vectorNodePoint(node, index, 'anchor', { x: 0, y: 0 }, contourIndex));
            for (const part of ['in', 'out']) {
              const control = pagePoint(vectorNodePoint(node, index, part, { x: 0, y: 0 }, contourIndex));
              if (Math.hypot(control.x - anchor.x, control.y - anchor.y) < size) continue;
              ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(control.x, control.y); ctx.stroke();
              ctx.beginPath(); ctx.arc(control.x, control.y, size * .65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }
            ctx.fillStyle = selectedContourIndex === contourIndex && selectedPointIndex === index ? BLUE : '#ffffff';
            ctx.beginPath(); ctx.rect(anchor.x - size * .6, anchor.y - size * .6, size * 1.2, size * 1.2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#ffffff';
          }
        }
      } else if (selected.length === 1 && node.type === 'network') {
        const selectedVertexId = this.getState().selectedVectorPoint?.nodeId === node.id ? this.getState().selectedVectorPoint.vertexId : null;
        for (const edge of node.edges || []) {
          const points = vectorNetworkEdgePoints(node, edge.id, { x: 0, y: 0 });
          if (!points) continue;
          const from = pagePoint(points[0]); const to = pagePoint(points[3]);
          for (const [part, handle, anchor] of [['control1', points[1], from], ['control2', points[2], to]]) {
            if (!edge[part]) continue;
            const pageHandle = pagePoint(handle);
            ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(pageHandle.x, pageHandle.y); ctx.stroke();
            ctx.beginPath(); ctx.arc(pageHandle.x, pageHandle.y, size * .65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        }
        for (const vertex of node.vertices || []) {
          const anchor = pagePoint(vectorNetworkVertexPoint(node, vertex.id, { x: 0, y: 0 }));
          if (!anchor) continue;
          ctx.fillStyle = selectedVertexId === vertex.id ? BLUE : '#ffffff';
          ctx.beginPath(); ctx.rect(anchor.x - size * .6, anchor.y - size * .6, size * 1.2, size * 1.2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#ffffff';
        }
      }
    }
    ctx.restore();
  }

  drawCommentPins(ctx, page, state, width, height) {
    const comments = [...(state.document.comments || [])]
      .filter(comment => comment.pageId === page.id)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (!comments.length) return;
    const zoom = Math.max(.08, state.zoom || 1);
    const minX = -state.panX / zoom - 24 / zoom;
    const minY = -state.panY / zoom - 24 / zoom;
    const maxX = (width - state.panX) / zoom + 24 / zoom;
    const maxY = (height - state.panY) / zoom + 24 / zoom;
    const radius = 10 / zoom;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 ${9 / zoom}px Inter, Arial, sans-serif`;
    for (let index = 0; index < comments.length; index += 1) {
      const comment = comments[index];
      if (comment.x < minX || comment.x > maxX || comment.y < minY || comment.y > maxY) continue;
      ctx.beginPath(); ctx.arc(comment.x, comment.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = comment.resolved ? '#76818c' : '#0d99ff'; ctx.fill();
      ctx.lineWidth = 2 / zoom; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      if (comment.id === state.activeCommentId) {
        ctx.beginPath(); ctx.arc(comment.x, comment.y, 13 / zoom, 0, Math.PI * 2);
        ctx.lineWidth = 2 / zoom; ctx.strokeStyle = '#1e1e1e'; ctx.stroke();
      }
      ctx.fillStyle = '#ffffff'; ctx.fillText(index < 99 ? String(index + 1) : '•', comment.x, comment.y + .5 / zoom);
    }
    ctx.restore();
  }

  drawPrototypeConnections(ctx, page, state) {
    const positions = new Map();
    const collect = (nodes, offsetX = 0, offsetY = 0) => {
      for (const node of nodes) {
        const x = offsetX + node.x;
        const y = offsetY + node.y;
        positions.set(node.id, { x, y, width: node.width, height: node.height, node });
        collect(node.children || [], x, y);
      }
    };
    collect(page.children);
    const destinationIds = new Set();
    for (const source of positions.values()) {
      for (const interaction of source.node.interactions || []) {
        if (!['navigate', 'open-overlay'].includes(interaction.action) || (interaction.destinationPageId && interaction.destinationPageId !== page.id)) continue;
        const destination = positions.get(interaction.destinationId);
        if (!destination) continue;
        destinationIds.add(interaction.destinationId);
        const startX = source.x + source.width / 2;
        const startY = source.y + source.height / 2;
        const endX = destination.x + destination.width / 2;
        const endY = destination.y + destination.height / 2;
        const pull = Math.max(34, Math.abs(endX - startX) * .42);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(startX + pull, startY, endX - pull, endY, endX, endY);
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 2 / (state.zoom || 1);
        ctx.setLineDash(state.prototypeSourceId === source.node.id ? [5 / state.zoom, 3 / state.zoom] : []);
        ctx.stroke();
        const angle = Math.atan2(endY - (endY - startY) * .1, endX - (endX - startX) * .1);
        const size = 7 / (state.zoom || 1);
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - Math.cos(angle - .45) * size, endY - Math.sin(angle - .45) * size);
        ctx.lineTo(endX - Math.cos(angle + .45) * size, endY - Math.sin(angle + .45) * size);
        ctx.closePath();
        ctx.fillStyle = '#8b5cf6';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(startX, startY, 4 / (state.zoom || 1), 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 2 / (state.zoom || 1);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const id of destinationIds) {
      const target = positions.get(id);
      if (!target) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(139,92,246,.75)';
      ctx.lineWidth = 1 / (state.zoom || 1);
      ctx.setLineDash([4 / state.zoom, 3 / state.zoom]);
      ctx.strokeRect(target.x - 4 / state.zoom, target.y - 4 / state.zoom, target.width + 8 / state.zoom, target.height + 8 / state.zoom);
      ctx.restore();
    }
  }

  drawEmptyHint(width, height, dpr, state) {
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save(); ctx.fillStyle = 'rgba(30,30,30,.52)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '500 13px Inter, Arial, sans-serif';
    ctx.fillText('Create a frame, draw a shape, or drop an image to begin', width / 2, height - 34);
    ctx.restore();
  }

  destroy() { cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); }
}

export function screenToWorld(event, canvas, state) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left - state.panX) / state.zoom, y: (event.clientY - rect.top - state.panY) / state.zoom };
}

export function worldToScreen(point, canvas, state) {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + state.panX + point.x * state.zoom, y: rect.top + state.panY + point.y * state.zoom };
}

function containsPointInClip(node, point, ancestors, document) {
  const geometry = document
    ? { ...node, ...getNodeGeometry(document, node), x: node.x, y: node.y }
    : node;
  const local = pageToNodeLocal(geometry, point, ancestors);
  const { width, height } = geometry;
  if (local.x < 0 || local.y < 0 || local.x > width || local.y > height) return false;
  const rawRadius = node.cornerRadii || (document ? getNodePropertyValue(document, node, 'radius') : node.radius) || 0;
  const radii = typeof rawRadius === 'number'
    ? Object.fromEntries(cornerRadiusKeys.map(key => [key, rawRadius]))
    : rawRadius;
  return containsPointInRoundedRect(local.x, local.y, width, height, radii);
}

function pointInsideAncestorClips(point, ancestors, document) {
  return ancestors.every((ancestor, index) => !clipsNodeContents(ancestor)
    || containsPointInClip(ancestor, point, ancestors.slice(0, index), document));
}

/** Find the deepest visible frame/group containing a point after ancestor clips. */
export function deepestContainerAtPagePoint(nodes, point, document = null) {
  let result = null;
  const visit = (items, ancestors = []) => {
    for (const node of items || []) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      if (!pointInsideAncestorClips(point, ancestors, document)) continue;
      const geometry = document ? { ...node, ...getNodeGeometry(document, node) } : node;
      if (['frame', 'group'].includes(node.type)) {
        const local = pageToNodeLocal(geometry, point, ancestors);
        if (local.x >= 0 && local.y >= 0 && local.x <= geometry.width && local.y <= geometry.height) {
          result = { node, ancestors: [...ancestors, geometry] };
        }
      }
      visit(node.children || [], [...ancestors, geometry]);
    }
  };
  visit(nodes);
  return result;
}

export function hitTestPage(page, point, containsBoolean = null, document = null, presentationScrollOffsets = null) {
  const hits = [];
  const scrollState = { presentationScrollOffsets };
  const visit = (nodes, ancestors = [], parentScrollOffset = { x: 0, y: 0 }) => {
    for (const node of nodes) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      if (!pointInsideAncestorClips(point, ancestors, document)) continue;
      const geometry = document ? getNodeGeometry(document, node) : node;
      let resolvedNode = document ? { ...node, ...geometry } : node;
      if (parentScrollOffset.x || parentScrollOffset.y) {
        resolvedNode = {
          ...resolvedNode,
          x: resolvedNode.x - parentScrollOffset.x,
          y: resolvedNode.y - parentScrollOffset.y
        };
      }
      const localPoint = pageToNodeLocal(resolvedNode, point, ancestors);
      const inBounds = localPoint.x >= 0 && localPoint.y >= 0
        && localPoint.x <= geometry.width && localPoint.y <= geometry.height;
      if (inBounds) {
        let contained = true;
        if (node.type === 'boolean' && containsBoolean) {
          // The boolean raster is queried in page coordinates by existing callers.
          // Fold ancestor rotations into the node rotation and use its true page
          // center so that the callback sees the same rigid transform as drawing.
          const center = nodeLocalToPage(resolvedNode, { x: geometry.width / 2, y: geometry.height / 2 }, ancestors);
          const rotation = ancestors.reduce((sum, ancestor) => sum + Number(ancestor.rotation || 0), Number(geometry.rotation || 0));
          const booleanNode = { ...resolvedNode, rotation };
          contained = containsBoolean(booleanNode, point, center.x - geometry.width / 2, center.y - geometry.height / 2);
        }
        if (contained) hits.push(resolvedNode);
      }
      if (node.type !== 'boolean') {
        const childScrollOffset = getPresentationScrollOffset(scrollState, resolvedNode);
        visit(node.children || [], [...ancestors, resolvedNode], childScrollOffset);
      }
    }
  };
  visit(page.children || []);
  return hits.at(-1) ?? null;
}

/** Return the visible scroll-frame ancestry of the topmost hit, innermost first. */
export function scrollableFramePathAtPagePoint(page, point, containsBoolean = null, document = null, presentationScrollOffsets = null) {
  const hit = hitTestPage(page, point, containsBoolean, document, presentationScrollOffsets);
  if (!hit) return [];
  const scrollState = { presentationScrollOffsets };
  const visit = (nodes, ancestors = [], parentScrollOffset = { x: 0, y: 0 }) => {
    for (const node of nodes || []) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      if (!pointInsideAncestorClips(point, ancestors, document)) continue;
      const geometry = document ? getNodeGeometry(document, node) : node;
      let frame = document ? { ...node, ...geometry } : node;
      if (parentScrollOffset.x || parentScrollOffset.y) {
        frame = {
          ...frame,
          x: frame.x - parentScrollOffset.x,
          y: frame.y - parentScrollOffset.y
        };
      }

      let path = null;
      if (node.id === hit.id) path = [];
      else if (node.type !== 'boolean') {
        path = visit(node.children || [], [...ancestors, frame], getPresentationScrollOffset(scrollState, frame));
      }
      if (path) {
        if (isScrollableFrame(frame) && containsPointInClip(frame, point, ancestors, document)) {
          path.push({
            frame,
            ancestors,
            local: pageToNodeLocal(frame, point, ancestors)
          });
        }
        return path;
      }
    }
    return null;
  };
  return visit(page?.children || []) || [];
}
