import { selectionBounds } from "./model.js";

export function roundedRect(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius ?? 0, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawLandscape(ctx, node) {
  const { x, y, w, h } = node;
  ctx.save();
  roundedRect(ctx, x, y, w, h, 13);
  ctx.clip();
  const sky = ctx.createLinearGradient(x, y, x + w * .2, y + h);
  sky.addColorStop(0, "#dce6dc"); sky.addColorStop(.56, "#c9d4c8"); sky.addColorStop(1, "#a8bbb0");
  ctx.fillStyle = sky; ctx.fillRect(x, y, w, h);
  const sun = ctx.createRadialGradient(x + w * .72, y + h * .22, 4, x + w * .72, y + h * .22, w * .24);
  sun.addColorStop(0, "#fff6de"); sun.addColorStop(1, "#f5e9cd00"); ctx.fillStyle = sun; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#f8e5bd"; ctx.beginPath(); ctx.arc(x + w * .72, y + h * .22, Math.min(w, h) * .09, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#a5b5a8"; ctx.beginPath(); ctx.moveTo(x, y + h * .57); ctx.lineTo(x + w * .18, y + h * .32); ctx.lineTo(x + w * .34, y + h * .55); ctx.lineTo(x + w * .52, y + h * .26); ctx.lineTo(x + w * .78, y + h * .57); ctx.lineTo(x + w, y + h * .4); ctx.lineTo(x + w, y + h * .8); ctx.lineTo(x, y + h * .8); ctx.fill();
  ctx.fillStyle = "#657765"; ctx.beginPath(); ctx.moveTo(x, y + h * .67); ctx.lineTo(x + w * .28, y + h * .43); ctx.lineTo(x + w * .45, y + h * .65); ctx.lineTo(x + w * .7, y + h * .38); ctx.lineTo(x + w, y + h * .67); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.fill();
  const lake = ctx.createLinearGradient(x, y + h * .6, x, y + h);
  lake.addColorStop(0, "#8ea7a1"); lake.addColorStop(1, "#d0d2c1"); ctx.fillStyle = lake;
  ctx.beginPath(); ctx.moveTo(x, y + h * .67); ctx.quadraticCurveTo(x + w * .42, y + h * .58, x + w, y + h * .72); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.fill();
  ctx.strokeStyle = "#edf0df88"; ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) { const yy = y + h * (.76 + i * .032); ctx.beginPath(); ctx.moveTo(x + w * (.1 + i * .035), yy); ctx.lineTo(x + w * (.8 + i * .02), yy + 2); ctx.stroke(); }
  ctx.fillStyle = "#566754";
  for (let i = 0; i < 18; i++) { const px = x + w * (.06 + ((i * 37) % 88) / 100); const py = y + h * (.64 + ((i * 19) % 24) / 100); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - 6, py + 18); ctx.lineTo(px + 8, py + 18); ctx.fill(); }
  ctx.restore();
}

export function paintNode(ctx, node) {
  if (node.hidden || node.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = node.opacity ?? 1;
  if (["multiply", "screen"].includes(node.blendMode)) ctx.globalCompositeOperation = node.blendMode;
  if (node.type === "landscape") drawLandscape(ctx, node);
  else if (node.type === "text") {
    const weight = node.fontWeight ?? 400;
    ctx.fillStyle = node.fill ?? "#222";
    ctx.font = `${weight} ${node.fontSize ?? 16}px ${node.fontFamily ?? "Inter, sans-serif"}`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = node.align ?? "left";
    const lines = String(node.text ?? "").split("\n");
    const lineHeight = (node.fontSize ?? 16) * (node.lineHeight ?? 1.2);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], node.x, node.y + (i + 1) * lineHeight - (lineHeight - (node.fontSize ?? 16)) * .72, node.w || undefined);
  } else if (node.type === "image") {
    const bitmap = node.previewBitmap ?? node.sourceBitmap;
    if (bitmap) {
      ctx.save();
      roundedRect(ctx, node.x, node.y, node.w, node.h, node.radius ?? 0);
      ctx.clip();
      ctx.drawImage(bitmap, node.x, node.y, node.w, node.h);
      ctx.restore();
    } else {
      ctx.fillStyle = "#eae8f1"; roundedRect(ctx, node.x, node.y, node.w, node.h, 4); ctx.fill();
    }
  } else if (node.type === "ellipse") {
    ctx.beginPath(); ctx.ellipse(node.x + node.w / 2, node.y + node.h / 2, Math.abs(node.w / 2), Math.abs(node.h / 2), 0, 0, Math.PI * 2);
    ctx.fillStyle = node.fill ?? "transparent"; ctx.fill();
    if (node.stroke && node.strokeWidth) { ctx.strokeStyle = node.stroke; ctx.lineWidth = node.strokeWidth; ctx.stroke(); }
  } else {
    roundedRect(ctx, node.x, node.y, node.w, node.h, node.radius ?? 0);
    ctx.fillStyle = node.fill ?? "transparent"; ctx.fill();
    if (node.stroke && node.strokeWidth) { ctx.strokeStyle = node.stroke; ctx.lineWidth = node.strokeWidth; ctx.stroke(); }
  }
  ctx.restore();
}

export function paintSelection(ctx, node) {
  const x = node.x, y = node.y, w = node.w, h = node.h;
  ctx.save(); ctx.strokeStyle = "#0d99ff"; ctx.lineWidth = 1;
  ctx.setLineDash([]); ctx.strokeRect(x, y, w, h);
  const size = 7;
  for (const [hx, hy] of [[x,y],[x+w/2,y],[x+w,y],[x+w,y+h/2],[x+w,y+h],[x+w/2,y+h],[x,y+h],[x,y+h/2]]) {
    ctx.fillStyle = "#fff"; ctx.fillRect(hx-size/2,hy-size/2,size,size);
    ctx.strokeStyle = "#0d99ff"; ctx.strokeRect(hx-size/2,hy-size/2,size,size);
  }
  ctx.restore();
}

export class CanvasRenderer {
  constructor(canvas, stage, documentModel) {
    this.canvas = canvas; this.stage = stage; this.doc = documentModel;
    this.ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    this.scale = .5; this.tx = 0; this.ty = 0; this.dpr = 1;
    this.onResize = () => { this.resize(); this.fit(); this.draw(); };
    this.observer = new ResizeObserver(this.onResize); this.observer.observe(stage);
    this.resize(); this.fit();
  }
  resize() {
    const box = this.stage.getBoundingClientRect(); this.width = Math.max(1, box.width); this.height = Math.max(1, box.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
  }
  fit() {
    const inset = Math.min(136, Math.max(44, this.width * .11));
    this.scale = Math.max(.12, Math.min(.9, (this.width - inset) / this.doc.frame.width, (this.height - 76) / this.doc.frame.height));
    this.tx = (this.width - this.doc.frame.width * this.scale) / 2;
    this.ty = (this.height - this.doc.frame.height * this.scale) / 2;
  }
  zoomAt(factor, sx = this.width / 2, sy = this.height / 2) {
    const point = this.toWorld(sx, sy); this.scale = Math.max(.12, Math.min(2.2, this.scale * factor));
    this.tx = sx - point.x * this.scale; this.ty = sy - point.y * this.scale; this.draw();
  }
  toWorld(sx, sy) { return { x: (sx - this.tx) / this.scale, y: (sy - this.ty) / this.scale }; }
  toScreen(x, y) { return { x: x * this.scale + this.tx, y: y * this.scale + this.ty }; }
  getSelectionBounds(ids) {
    const nodes = ids.map((id) => this.doc.nodes.find((node) => node.id === id)).filter(Boolean);
    return selectionBounds(nodes);
  }
  selectionHandleAt(sx, sy, ids, tolerance = 8) {
    const bounds = this.getSelectionBounds(ids);
    if (!bounds) return null;
    const { x, y, w, h } = bounds;
    const handles = [
      ["nw", x, y], ["n", x + w / 2, y], ["ne", x + w, y], ["e", x + w, y + h / 2],
      ["se", x + w, y + h], ["s", x + w / 2, y + h], ["sw", x, y + h], ["w", x, y + h / 2],
    ];
    for (const [name, hx, hy] of handles) {
      const point = this.toScreen(hx, hy);
      if (Math.abs(sx - point.x) <= tolerance && Math.abs(sy - point.y) <= tolerance) return name;
    }
    return null;
  }
  draw(selectedIds = []) {
    const { ctx, width, height, dpr } = this; if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const { frame } = this.doc;
    ctx.save(); ctx.shadowColor = "#1b1b2424"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 6; ctx.fillStyle = "#fff"; ctx.fillRect(this.tx, this.ty, frame.width * this.scale, frame.height * this.scale); ctx.restore();
    ctx.save(); ctx.translate(this.tx, this.ty); ctx.scale(this.scale, this.scale);
    ctx.fillStyle = "#fbfaf6"; ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, frame.width, frame.height); ctx.clip();
    for (const node of this.doc.nodes) paintNode(ctx, node);
    if (this.outlineMode) {
      ctx.save(); ctx.strokeStyle = "#ff4c8b"; ctx.lineWidth = 1 / this.scale; ctx.setLineDash([5 / this.scale, 4 / this.scale]);
      for (const node of this.doc.nodes) if (!node.hidden) ctx.strokeRect(node.x, node.y, node.w, node.h);
      ctx.restore();
    }
    const selected = selectedIds.map((id) => this.doc.nodes.find((node) => node.id === id)).filter(Boolean);
    const bounds = selectionBounds(selected);
    if (bounds) paintSelection(ctx, bounds);
    ctx.restore(); ctx.restore();
  }
  hitTest(sx, sy) {
    const { x, y } = this.toWorld(sx, sy);
    for (let i = this.doc.nodes.length - 1; i >= 0; i--) {
      const node = this.doc.nodes[i]; if (node.hidden || node.locked) continue;
      if (x >= node.x && x <= node.x + node.w && y >= node.y && y <= node.y + node.h) return node;
    }
    return null;
  }
  exportBlob() {
    const output = document.createElement("canvas"); output.width = this.doc.frame.width; output.height = this.doc.frame.height;
    const ctx = output.getContext("2d"); ctx.fillStyle = "#fbfaf6"; ctx.fillRect(0, 0, output.width, output.height);
    for (const node of this.doc.nodes) paintNode(ctx, node);
    return new Promise((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed")), "image/png"));
  }
}
