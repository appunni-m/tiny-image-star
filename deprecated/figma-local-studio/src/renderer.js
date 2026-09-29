import { activePage } from './model.js';

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.zoom = 0.6;
    this.panX = 0;
    this.panY = 0;
    this.selectionId = null;
    this.draft = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const oldWidth = this.width || rect.width, oldHeight = this.height || rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this.panX += (this.width - oldWidth) / 2;
    this.panY += (this.height - oldHeight) / 2;
    this.render(this.project);
  }

  setProject(project) { this.project = project; this.render(project); }
  setZoom(value, anchor = null) {
    const next = Math.max(0.1, Math.min(4, value));
    if (anchor) {
      const world = this.toWorld(anchor.x, anchor.y);
      this.zoom = next;
      this.panX = anchor.x - this.originX() - world.x * next;
      this.panY = anchor.y - this.originY() - world.y * next;
    } else this.zoom = next;
    this.render(this.project);
  }
  fitTo(node) {
    if (!node || !this.width || !this.height) return;
    const padding = 56;
    this.zoom = Math.max(0.1, Math.min(1, (this.width - padding * 2) / node.w, (this.height - padding * 2) / node.h));
    this.panX = -node.x * this.zoom - node.w * this.zoom / 2;
    this.panY = -node.y * this.zoom - node.h * this.zoom / 2;
    this.render(this.project);
  }
  originX() { return this.width / 2 + this.panX; }
  originY() { return this.height / 2 + this.panY; }
  toWorld(x, y) { return { x: (x - this.originX()) / this.zoom, y: (y - this.originY()) / this.zoom }; }
  toScreen(x, y) { return { x: this.originX() + x * this.zoom, y: this.originY() + y * this.zoom }; }

  render(project = this.project) {
    if (!this.ctx || !this.width || !this.height) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#e9e9ed';
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGrid(ctx);
    if (!project) return;
    const page = activePage(project);
    const ordered = [...page.nodes].sort((a, b) => (a.type === 'frame' ? -1 : 0) - (b.type === 'frame' ? -1 : 0));
    for (const node of ordered) this.drawNode(ctx, node);
    if (this.draft) this.drawNode(ctx, this.draft, true);
    const selected = page.nodes.find(node => node.id === this.selectionId);
    if (selected) this.drawSelection(ctx, selected);
  }

  drawGrid(ctx) {
    const gap = Math.max(12, 24 * this.zoom);
    ctx.fillStyle = 'rgba(75, 78, 92, .13)';
    const startX = ((this.originX() % gap) + gap) % gap;
    const startY = ((this.originY() % gap) + gap) % gap;
    for (let x = startX; x < this.width; x += gap) for (let y = startY; y < this.height; y += gap) ctx.fillRect(x, y, 1, 1);
  }

  drawNode(ctx, node, draft = false) {
    const { x, y } = this.toScreen(node.x, node.y);
    const w = node.w * this.zoom, h = node.h * this.zoom;
    ctx.save();
    ctx.globalAlpha = node.opacity ?? 1;
    ctx.lineWidth = Math.max(1, (node.strokeWidth || 1) * this.zoom);
    ctx.strokeStyle = node.stroke || 'transparent';
    ctx.fillStyle = node.fill || 'transparent';
    if (node.type === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
      if (node.fill !== 'none') ctx.fill(); if (node.strokeWidth > 0) ctx.stroke();
    } else if (node.type === 'image') {
      const bitmap = node.previewBitmap ?? node.sourceBitmap;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min((node.radius || 0) * this.zoom, Math.abs(w) / 2, Math.abs(h) / 2)); ctx.clip();
      if (bitmap) ctx.drawImage(bitmap, x, y, w, h);
      else { ctx.fillStyle = '#efedf5'; ctx.fillRect(x, y, w, h); }
    } else if (node.type === 'text') {
      ctx.font = `${node.fontWeight || 400} ${Math.max(1, (node.fontSize || 32) * this.zoom)}px Inter, ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = 'top'; ctx.fillStyle = node.fill || '#1e1e1e';
      const lines = String(node.text || '').split('\n');
      lines.forEach((line, index) => ctx.fillText(line, x, y + index * (node.fontSize || 32) * this.zoom * 1.25, w || undefined));
    } else {
      const radius = Math.min((node.radius || 0) * this.zoom, Math.abs(w) / 2, Math.abs(h) / 2);
      ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
      if (node.fill !== 'none') ctx.fill(); if (node.strokeWidth > 0) ctx.stroke();
      if (node.type === 'frame' && !draft) {
        ctx.save();
        ctx.fillStyle = '#555764'; ctx.font = '11px Inter, ui-sans-serif, system-ui, sans-serif'; ctx.textBaseline = 'bottom';
        ctx.fillText(`${node.name}   ${Math.round(node.w)} × ${Math.round(node.h)}`, x, y - 7);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawSelection(ctx, node) {
    const p = this.toScreen(node.x, node.y), w = node.w * this.zoom, h = node.h * this.zoom;
    ctx.save(); ctx.strokeStyle = '#0d99ff'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.strokeRect(p.x - .5, p.y - .5, w + 1, h + 1);
    const size = 6, points = [[p.x, p.y], [p.x + w, p.y], [p.x, p.y + h], [p.x + w, p.y + h]];
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0d99ff';
    for (const [x, y] of points) { ctx.fillRect(x - size / 2, y - size / 2, size, size); ctx.strokeRect(x - size / 2, y - size / 2, size, size); }
    ctx.restore();
  }

  hitTest(x, y) {
    const { x: wx, y: wy } = this.toWorld(x, y);
    const nodes = [...activePage(this.project).nodes].sort((a, b) => (a.type === 'frame' ? -1 : 0) - (b.type === 'frame' ? -1 : 0));
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (wx >= node.x && wx <= node.x + node.w && wy >= node.y && wy <= node.y + node.h) return node;
    }
    return null;
  }
}
