import { findNode, getNodeColor, getNodePropertyValue } from './model.js';
import { layoutGuideGridLines, layoutGuideRegions } from './layout-guides.js';
import { vectorNetworkEdgePoints, vectorNetworkVertexPoint, vectorNodePoint } from './vector-path.js';

const BLUE = '#0d99ff';
const graphemeSegmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function rgba(hex, alpha = 1) {
  if (!hex || hex === 'transparent') return `rgba(0,0,0,0)`;
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? [...value].map(char => char + char).join('') : value;
  const number = Number.parseInt(normalized, 16);
  return `rgba(${number >> 16}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(Math.max(0, radius), Math.abs(width) / 2, Math.abs(height) / 2);
  if (!r) { ctx.rect(x, y, width, height); return; }
  const signX = Math.sign(width) || 1;
  const signY = Math.sign(height) || 1;
  const w = Math.abs(width); const h = Math.abs(height);
  ctx.moveTo(x + signX * r, y);
  ctx.lineTo(x + width - signX * r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + signY * r);
  ctx.lineTo(x + width, y + height - signY * r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - signX * r, y + height);
  ctx.lineTo(x + signX * r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - signY * r);
  ctx.lineTo(x, y + signY * r);
  ctx.quadraticCurveTo(x, y, x + signX * r, y);
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
  const points = node.points || [];
  if (!points.length) return;
  const position = (point, part) => vectorNodePoint(node, points.indexOf(point), part, { x, y });
  const first = position(points[0], 'anchor');
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const end = position(current, 'anchor');
    if (hasHandle(previous, 'out') || hasHandle(current, 'in')) {
      const control1 = position(previous, 'out');
      const control2 = position(current, 'in');
      ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
    } else ctx.lineTo(end.x, end.y);
  }
  if (node.closed) {
    const last = points.at(-1);
    if (hasHandle(last, 'out') || hasHandle(points[0], 'in')) {
      const control1 = position(last, 'out');
      const control2 = position(points[0], 'in');
      ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, first.x, first.y);
    }
    ctx.closePath();
  }
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

function textGraphemes(text) {
  const value = String(text ?? '');
  if (graphemeSegmenter) return [...graphemeSegmenter.segment(value)].map(part => part.segment);
  return Array.from(value);
}

export function measureTrackedText(ctx, text, letterSpacing = 0) {
  const value = String(text ?? '');
  const count = textGraphemes(value).length;
  return ctx.measureText(value).width + Math.max(0, count - 1) * (Number(letterSpacing) || 0);
}

export function wrapText(ctx, text, maxWidth, letterSpacing = 0) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measureTrackedText(ctx, candidate, letterSpacing) > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    lines.push(line);
  }
  return lines;
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
    const opacity = getNodePropertyValue(document, node, 'opacity');
    const radius = getNodePropertyValue(document, node, 'radius');
    const x = parentX + node.x; const y = parentY + node.y;
    const width = node.width; const height = node.height;
    const cx = x + width / 2; const cy = y + height / 2;
    ctx.save();
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
        starPath(ctx, cx, cy, Math.min(Math.abs(width), Math.abs(height)) / 2, node.points, node.innerRadius || 0.48);
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
        for (const face of node.faces || []) { ctx.beginPath(); if (traceVectorNetworkFace(ctx, node, face, x, y)) ctx.fill(); }
        ctx.restore();
        return;
      }
      if (node.type !== 'line' && (node.type !== 'path' || node.closed)) ctx.fill();
      ctx.restore();
      return;
    }

    if (node.type === 'image') {
      const asset = assets.get(node.assetId);
      const image = this.getState().previews.get(node.id) ?? asset?.bitmap;
      if (image) {
        ctx.save();
        ctx.beginPath(); roundedRect(ctx, x, y, width, height, radius || 0); ctx.clip();
        if (node.fit === 'contain') {
          const ratio = Math.min(width / image.width, height / image.height);
          const drawWidth = image.width * ratio; const drawHeight = image.height * ratio;
          ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
        } else ctx.drawImage(image, x, y, width, height);
        ctx.restore();
      } else {
        ctx.fillStyle = '#d9d9d9'; ctx.fill();
        ctx.fillStyle = '#8a8a8a'; ctx.font = '12px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('Loading image…', cx, cy);
      }
      if (node.stroke && node.strokeWidth) { ctx.beginPath(); roundedRect(ctx, x, y, width, height, radius); ctx.strokeStyle = getNodeColor(document, node, 'stroke'); ctx.lineWidth = node.strokeWidth; ctx.stroke(); }
    } else if (node.type === 'text') {
      ctx.fillStyle = rgba(getNodeColor(document, node, 'text'), node.fillOpacity ?? 1);
      const text = getNodePropertyValue(document, node, 'text');
      const fontSize = getNodePropertyValue(document, node, 'fontSize');
      const lineHeightScale = getNodePropertyValue(document, node, 'lineHeight');
      const letterSpacing = getNodePropertyValue(document, node, 'letterSpacing');
      ctx.font = `${node.fontStyle === 'italic' ? 'italic ' : ''}${node.fontWeight || 400} ${fontSize || 24}px ${node.fontFamily || 'Arial, sans-serif'}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const lines = wrapText(ctx, text, Math.max(1, width), letterSpacing);
      const lineHeight = (fontSize || 24) * (lineHeightScale || 1.25);
      lines.forEach((line, index) => {
        const measuredWidth = Math.min(width, measureTrackedText(ctx, line, letterSpacing));
        const offsetX = node.align === 'center' ? (width - measuredWidth) / 2 : node.align === 'right' ? width - measuredWidth : 0;
        drawTrackedText(ctx, line, x + offsetX, y + index * lineHeight, letterSpacing, width);
      });
      if (node.stroke && node.strokeWidth) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.strokeStyle = getNodeColor(document, node, 'stroke'); ctx.lineWidth = node.strokeWidth; ctx.stroke(); }
    } else if (node.type === 'network') {
      const fill = getNodeColor(document, node, 'fill');
      if (fill && fill !== 'transparent') {
        for (const face of node.faces || []) {
          ctx.beginPath();
          if (traceVectorNetworkFace(ctx, node, face, x, y)) { ctx.fillStyle = rgba(face.fill || fill, (node.fillOpacity ?? 1) * (face.fillOpacity ?? 1)); ctx.fill(); }
        }
      }
      if (node.stroke && node.strokeWidth) { ctx.beginPath(); traceVectorNetworkEdges(ctx, node, x, y); ctx.strokeStyle = getNodeColor(document, node, 'stroke'); ctx.lineWidth = node.strokeWidth; ctx.stroke(); }
    } else {
      const fill = getNodeColor(document, node, 'fill');
      if (fill && fill !== 'transparent' && node.type !== 'line' && (node.type !== 'path' || node.closed)) { ctx.fillStyle = rgba(fill, node.fillOpacity ?? 1); ctx.fill(); }
      if (node.stroke && node.strokeWidth) { ctx.strokeStyle = getNodeColor(document, node, 'stroke'); ctx.lineWidth = node.strokeWidth; ctx.stroke(); }
    }

    if (draft) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.setLineDash([4, 3]); ctx.stroke(); }
    if (node.children?.length) {
      if (node.clip) { ctx.beginPath(); roundedRect(ctx, x, y, width, height, radius || 0); ctx.clip(); }
      for (const child of node.children) this.drawNode(ctx, child, x, y, assets, draft, false, renderOptions);
    }
    if (node.type === 'frame' && !node.children.length && !draft) {
      ctx.strokeStyle = 'rgba(30,30,30,.14)'; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.strokeRect(x, y, width, height);
    }
    if (node.type === 'frame' && !draft && !state.presenting && renderOptions.showLayoutGuides !== false) this.drawLayoutGuides(ctx, node, x, y, state);
    ctx.restore();
  }

  drawNodeOutline(ctx, node, x, y, assets, renderOptions = {}) {
    const state = this.getState();
    const width = node.width; const height = node.height;
    const cx = x + width / 2; const cy = y + height / 2;
    const radius = getNodePropertyValue(state.document, node, 'radius') || 0;
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
          starPath(ctx, cx, cy, Math.min(Math.abs(width), Math.abs(height)) / 2, node.points, node.innerRadius || 0.48);
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
      if (node.clip) {
        ctx.beginPath(); roundedRect(ctx, x, y, width, height, radius); ctx.clip();
      }
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
    ctx.globalAlpha *= node.fillOpacity ?? 1;
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
    const key = `${JSON.stringify(node)}|${fill}|${width}x${height}`;
    let entry = this.booleanCache.get(key);
    if (entry) {
      this.booleanCache.delete(key);
      this.booleanCache.set(key, entry);
    } else {
      const surface = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
      const mask = surface.getContext('2d');
      mask.setTransform(width / Math.max(1, node.width), 0, 0, height / Math.max(1, node.height), 0, 0);
      const operation = node.operation || 'union';
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (!child.visible && operation !== 'intersect') continue;
        mask.save();
        if (index === 0 || operation === 'union') mask.globalCompositeOperation = 'source-over';
        else if (operation === 'subtract') mask.globalCompositeOperation = 'destination-out';
        else if (operation === 'intersect') mask.globalCompositeOperation = 'destination-in';
        else if (operation === 'exclude') mask.globalCompositeOperation = 'xor';
        this.drawNode(mask, child, 0, 0, assets, false, true, renderOptions);
        mask.restore();
        if (!child.visible && operation === 'intersect') {
          mask.clearRect(0, 0, node.width, node.height);
          break;
        }
      }
      mask.save();
      mask.globalCompositeOperation = 'source-in';
      mask.fillStyle = fill;
      mask.fillRect(0, 0, node.width, node.height);
      mask.restore();
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

  drawSelection(ctx, nodes, selectedIds, parentX, parentY) {
    const selected = [];
    const collect = (list, offsetX, offsetY) => {
      for (const node of list) {
        if (selectedIds.includes(node.id)) selected.push({ node, x: offsetX + node.x, y: offsetY + node.y });
        collect(node.children || [], offsetX + node.x, offsetY + node.y);
      }
    };
    collect(nodes, parentX, parentY);
    if (!selected.length) return;
    ctx.save();
    ctx.strokeStyle = BLUE; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 1 / (this.getState().zoom || 1);
    for (const entry of selected) {
      ctx.save();
      const { node, x, y } = entry;
      const cx = x + node.width / 2; const cy = y + node.height / 2;
      if (node.rotation) { ctx.translate(cx, cy); ctx.rotate(node.rotation * Math.PI / 180); ctx.translate(-cx, -cy); }
      ctx.strokeRect(x - 1 / (this.getState().zoom || 1), y - 1 / (this.getState().zoom || 1), node.width + 2 / (this.getState().zoom || 1), node.height + 2 / (this.getState().zoom || 1));
      ctx.restore();
    }
    if (selected.length === 1) {
      const { node, x, y } = selected[0];
      if (node.rotation) { const cx = x + node.width / 2; const cy = y + node.height / 2; ctx.translate(cx, cy); ctx.rotate(node.rotation * Math.PI / 180); ctx.translate(-cx, -cy); }
      const size = 6 / (this.getState().zoom || 1);
      for (const [hx, hy] of [[x, y], [x + node.width / 2, y], [x + node.width, y], [x + node.width, y + node.height / 2], [x + node.width, y + node.height], [x + node.width / 2, y + node.height], [x, y + node.height], [x, y + node.height / 2]]) {
        ctx.beginPath(); ctx.rect(hx - size / 2, hy - size / 2, size, size); ctx.fill(); ctx.stroke();
      }
      if (node.type === 'path') {
        const selectedPointIndex = this.getState().selectedVectorPoint?.nodeId === node.id ? this.getState().selectedVectorPoint.index : -1;
        for (const [index, point] of (node.points || []).entries()) {
          const anchor = vectorNodePoint(node, index, 'anchor', { x, y });
          for (const part of ['in', 'out']) {
            const control = vectorNodePoint(node, index, part, { x, y });
            if (Math.hypot(control.x - anchor.x, control.y - anchor.y) < size) continue;
            ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(control.x, control.y); ctx.stroke();
            ctx.beginPath(); ctx.arc(control.x, control.y, size * .65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
          ctx.fillStyle = selectedPointIndex === index ? BLUE : '#ffffff';
          ctx.beginPath(); ctx.rect(anchor.x - size * .6, anchor.y - size * .6, size * 1.2, size * 1.2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#ffffff';
        }
      } else if (node.type === 'network') {
        const selectedVertexId = this.getState().selectedVectorPoint?.nodeId === node.id ? this.getState().selectedVectorPoint.vertexId : null;
        for (const edge of node.edges || []) {
          const points = vectorNetworkEdgePoints(node, edge.id, { x, y });
          if (!points) continue;
          const from = points[0]; const to = points[3];
          for (const [part, handle, anchor] of [['control1', points[1], from], ['control2', points[2], to]]) {
            if (!edge[part]) continue;
            ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(handle.x, handle.y); ctx.stroke();
            ctx.beginPath(); ctx.arc(handle.x, handle.y, size * .65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        }
        for (const vertex of node.vertices || []) {
          const anchor = vectorNetworkVertexPoint(node, vertex.id, { x, y });
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

export function hitTestPage(page, point, containsBoolean = null, document = null) {
  const hits = [];
  const visit = (nodes, parentX = 0, parentY = 0) => {
    for (const node of nodes) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      const x = parentX + node.x; const y = parentY + node.y;
      const inBounds = point.x >= x && point.y >= y && point.x <= x + node.width && point.y <= y + node.height;
      if (inBounds && (node.type !== 'boolean' || !containsBoolean || containsBoolean(node, point, x, y))) hits.push(node);
      if (node.type !== 'boolean') visit(node.children || [], x, y);
    }
  };
  visit(page.children);
  return hits.at(-1) ?? null;
}
