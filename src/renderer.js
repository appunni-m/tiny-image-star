import { getNodeColor } from './model.js';
import { vectorNodePoint } from './vector-path.js';

const BLUE = '#0d99ff';

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

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    lines.push(line);
  }
  return lines;
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
    if (state.inspectorTab === 'prototype') this.drawPrototypeConnections(ctx, page, state);
    if (state.draftNode) this.drawNode(ctx, state.draftNode, 0, 0, state.assets, true);
    if (state.penDraft) this.drawPenDraft(ctx, state.penDraft, state.penHover, state.zoom);
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

  drawNode(ctx, node, parentX, parentY, assets, draft = false, maskMode = false) {
    if (!node.visible) return;
    const document = this.getState().document;
    const x = parentX + node.x; const y = parentY + node.y;
    const width = node.width; const height = node.height;
    const cx = x + width / 2; const cy = y + height / 2;
    ctx.save();
    if (!maskMode) ctx.globalAlpha *= node.opacity ?? 1;
    if (node.rotation) { ctx.translate(cx, cy); ctx.rotate(node.rotation * Math.PI / 180); ctx.translate(-cx, -cy); }
    if (node.type === 'boolean') {
      this.drawBooleanGroup(ctx, node, x, y, assets, maskMode);
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
        roundedRect(ctx, x, y, width, height, node.radius || 0);
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
      default:
        ctx.rect(x, y, width, height);
    }

    if (maskMode) {
      ctx.fillStyle = '#fff';
      if (node.type !== 'line' && (node.type !== 'path' || node.closed)) ctx.fill();
      ctx.restore();
      return;
    }

    if (node.type === 'image') {
      const asset = assets.get(node.assetId);
      const image = this.getState().previews.get(node.id) ?? asset?.bitmap;
      if (image) {
        if (node.fit === 'contain') {
          const ratio = Math.min(width / image.width, height / image.height);
          const drawWidth = image.width * ratio; const drawHeight = image.height * ratio;
          ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
        } else ctx.drawImage(image, x, y, width, height);
      } else {
        ctx.fillStyle = '#d9d9d9'; ctx.fill();
        ctx.fillStyle = '#8a8a8a'; ctx.font = '12px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('Loading image…', cx, cy);
      }
      if (node.stroke && node.strokeWidth) { ctx.beginPath(); roundedRect(ctx, x, y, width, height, node.radius); ctx.strokeStyle = getNodeColor(document, node, 'stroke'); ctx.lineWidth = node.strokeWidth; ctx.stroke(); }
    } else if (node.type === 'text') {
      ctx.fillStyle = rgba(getNodeColor(document, node, 'text'), node.fillOpacity ?? 1);
      ctx.font = `${node.fontStyle === 'italic' ? 'italic ' : ''}${node.fontWeight || 400} ${node.fontSize || 24}px ${node.fontFamily || 'Arial, sans-serif'}`;
      ctx.textAlign = node.align || 'left'; ctx.textBaseline = 'top';
      const lines = wrapText(ctx, node.text, Math.max(1, width));
      const lineHeight = (node.fontSize || 24) * (node.lineHeight || 1.25);
      const offsetX = node.align === 'center' ? width / 2 : node.align === 'right' ? width : 0;
      lines.forEach((line, index) => ctx.fillText(line, x + offsetX, y + index * lineHeight, width));
      if (node.stroke && node.strokeWidth) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.strokeStyle = getNodeColor(document, node, 'stroke'); ctx.lineWidth = node.strokeWidth; ctx.stroke(); }
    } else {
      const fill = getNodeColor(document, node, 'fill');
      if (fill && fill !== 'transparent' && node.type !== 'line' && (node.type !== 'path' || node.closed)) { ctx.fillStyle = rgba(fill, node.fillOpacity ?? 1); ctx.fill(); }
      if (node.stroke && node.strokeWidth) { ctx.strokeStyle = getNodeColor(document, node, 'stroke'); ctx.lineWidth = node.strokeWidth; ctx.stroke(); }
    }

    if (draft) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.setLineDash([4, 3]); ctx.stroke(); }
    if (node.children?.length) {
      if (node.clip) { ctx.beginPath(); roundedRect(ctx, x, y, width, height, node.radius || 0); ctx.clip(); }
      for (const child of node.children) this.drawNode(ctx, child, x, y, assets, draft);
    }
    if (node.type === 'frame' && !node.children.length && !draft) {
      ctx.strokeStyle = 'rgba(30,30,30,.14)'; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.strokeRect(x, y, width, height);
    }
    ctx.restore();
  }

  drawBooleanGroup(ctx, node, x, y, assets, maskMode = false) {
    const state = this.getState();
    const transform = ctx.getTransform?.();
    const contextScale = transform ? Math.hypot(transform.a, transform.b) : (window.devicePixelRatio || 1) * Math.max(.08, state.zoom || 1);
    const surface = this.getBooleanSurface(node, assets, maskMode, contextScale);
    ctx.save();
    if (!maskMode) ctx.globalAlpha *= node.fillOpacity ?? 1;
    ctx.drawImage(surface, x, y, node.width, node.height);
    ctx.restore();
  }

  getBooleanSurface(node, assets, maskMode = false, contextScale = null) {
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
        this.drawNode(mask, child, 0, 0, assets, false, true);
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

  drawPenDraft(ctx, draft, hover, zoom = 1) {
    const points = draft.anchors || [];
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
      }
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

export function hitTestPage(page, point, containsBoolean = null) {
  const hits = [];
  const visit = (nodes, parentX = 0, parentY = 0) => {
    for (const node of nodes) {
      if (!node.visible) continue;
      const x = parentX + node.x; const y = parentY + node.y;
      const inBounds = point.x >= x && point.y >= y && point.x <= x + node.width && point.y <= y + node.height;
      if (inBounds && (node.type !== 'boolean' || !containsBoolean || containsBoolean(node, point, x, y))) hits.push(node);
      if (node.type !== 'boolean') visit(node.children || [], x, y);
    }
  };
  visit(page.children);
  return hits.at(-1) ?? null;
}
