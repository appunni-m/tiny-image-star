import { action, field, range, select } from "./view.js";
import { enqueueMask } from "../processing/mask-client.js";
import { getProcessingScheduler } from "../processing/client.js";
import { hashAsset } from "../project/storage.js";
import { newId } from "../project/model.js";
import { maskDetailRegion, maskSourcePoint, maskViewPoint } from "./mask-view.js";

export function mountMaskPanel({ content, source, mask, onChange, onBusy, onError }) {
  const pool = getProcessingScheduler(), owner = newId("mask-editor"), controller = new AbortController();
  let disposed = false, busy = false, task, view, index = -1, pointer = null, pendingBytes = 0, retryOptions = null, strokeOverflow = false, pan = null, resizeTimer;
  const width = source.asset.width, height = source.asset.height, shortEdge = Math.min(width, height);
  const history = [], strokes = [], cursor = [.5, .5];
  const initialDiameter = Math.max(Math.min(1, shortEdge / 2), Math.round(shortEdge * .08));
  const brush = { mode: "erase", radius: initialDiameter / (2 * shortEdge), hardness: .7, opacity: 1 };
  const wrapper = document.createElement("section"); wrapper.className = "mask-editor";
  const note = document.createElement("p"); note.className = "story-note";
  note.textContent = "Restore keeps the photo; Erase hides it. Work on the full original photo. Your story’s framing and colors stay separate.";
  const viewport = document.createElement("div"); viewport.className = "mask-editor-viewport";
  const plane = document.createElement("div"); plane.className = "mask-editor-plane";
  let image = new Image(); image.alt = "Cutout preview"; image.draggable = false;
  const canvas = document.createElement("canvas"); canvas.tabIndex = 0; canvas.setAttribute("role", "group");
  canvas.setAttribute("aria-label", "Cutout brush. Arrow keys move the brush; Space paints one spot.");
  plane.append(image, canvas); viewport.append(plane);
  const message = document.createElement("p"); message.className = "story-note"; message.setAttribute("role", "status");
  const retry = action("Retry cutout", () => void render(retryOptions ?? {})); retry.hidden = true;
  const mode = select([["erase", "Erase"], ["restore", "Restore"], ["pan", "Move view"]], "erase", "Cutout tool");
  const display = select([["preview", "Cutout"], ["maskPreview", "Mask: white shows, black hides"], ["sourcePreview", "Original"]], "preview", "Cutout preview mode");
  const detail = select([["0", "Whole photo"], ["1", "100% · source pixels"], ["2", "200% · source pixels"], ["4", "400% · source pixels"]], "0", "Cutout detail");
  const position = document.createElement("p"); position.className = "story-note";
  const navigation = document.createElement("div"); navigation.className = "mask-editor-controls"; navigation.hidden = true;
  for (const [label, x, y] of [["View left", -1, 0], ["View right", 1, 0], ["View up", 0, -1], ["View down", 0, 1]]) navigation.append(action(label, () => shiftView(x, y)));
  const controls = document.createElement("div"); controls.className = "mask-editor-controls";
  const undo = action("Undo brush", () => void render({ target: index - 1 }));
  const redo = action("Redo brush", () => void render({ target: index + 1 }));
  controls.append(field("Tool", mode), field("View", display));
  const historyControls = document.createElement("div"); historyControls.className = "mask-editor-controls"; historyControls.append(undo, redo);
  const picker = document.createElement("input"); picker.type = "file"; picker.accept = "image/png,.png"; picker.hidden = true; picker.dataset.maskImport = "";
  const maskMode = select([["luminance", "White subject on black"], ["alpha", "PNG transparency"]], "luminance", "Imported mask meaning");
  const imports = document.createElement("details"), summary = document.createElement("summary"); summary.textContent = "Import a mask";
  const sizeNote = document.createElement("p"); sizeNote.className = "story-note"; sizeNote.textContent = `Choose an 8-bit PNG, ${source.asset.width} × ${source.asset.height} pixels, under 16 MB.`;
  const importButton = action("Choose PNG mask", () => picker.click());
  imports.append(summary, sizeNote, field("Mask meaning", maskMode), importButton, picker);
  const precise = document.createElement("details"), preciseTitle = document.createElement("summary"); preciseTitle.textContent = "Place a brush spot without dragging";
  const paintSpot = action("Paint this spot", () => paint([cursor.slice()]));
  const inspectSpot = action("Show brush area", () => navigate(view?.zoom || 1, cursor));
  precise.append(preciseTitle, range("Brush left / right", .5, 0, 1, .001, (value) => { cursor[0] = value; draw(); }),
    range("Brush up / down", .5, 0, 1, .001, (value) => { cursor[1] = value; draw(); }), inspectSpot, paintSpot);
  const reset = document.createElement("div"); reset.className = "mask-editor-controls";
  reset.append(action("Hide entire photo", () => void render({ reset: "hide" })), action("Remove cutout", () => void render({ reset: "show", remove: true })));
  wrapper.append(controls, field("Detail", detail), viewport, historyControls, message, retry, position, navigation,
    range("Brush size (source pixels)", initialDiameter, Math.min(1, shortEdge / 2), Math.max(.5, Math.floor(shortEdge / 2)), 1, (value) => { brush.radius = value / (2 * shortEdge); draw(); }),
    range("Soft edge", .3, 0, 1, .05, (value) => { brush.hardness = 1 - value; }),
    range("Brush opacity", 1, .05, 1, .05, (value) => { brush.opacity = value; }),
    precise, imports, reset, note);
  content.append(wrapper);

  function ledger() {
    const retained = new Set(history.map((entry) => entry.blob));
    if (mask && !disposed) retained.add(mask.blob);
    pool.setRetainedBytes(owner, [...retained].reduce((sum, blob) => sum + blob.size, 0) + pendingBytes + (retryOptions?.imported?.size ?? 0)
      + (view ? view.bytes + view.width * view.height * 16 : 0));
  }
  function buttons() {
    for (const control of wrapper.querySelectorAll("button, select, input")) control.disabled = busy;
    undo.disabled = busy || index < 1; redo.disabled = busy || index >= history.length - 1;
    detail.disabled = inspectSpot.disabled = busy || !view;
    paintSpot.disabled = busy || !cursorVisible() || brush.mode === "pan";
    canvas.setAttribute("aria-disabled", String(busy));
  }
  function setBusy(value) { busy = value; buttons(); onBusy(value); }
  function releaseView() { if (view) for (const url of Object.values(view.urls)) URL.revokeObjectURL(url); view = null; }
  function cursorVisible() { return view && maskViewPoint(view.region, width, height, cursor).every((v) => v >= 0 && v <= 1); }
  function brushPoint(point) {
    // A one-pixel tap targets that pixel's center, including taps near its
    // corners where a subpixel circle would otherwise miss every sample.
    return brush.radius * shortEdge <= .5 ? point.map((v, i) => { const edge = i ? height : width; return (Math.min(edge - 1, Math.floor(v * edge)) + .5) / edge; }) : point;
  }
  function center() { return view ? [(view.region.x + view.region.width / 2) / width, (view.region.y + view.region.height / 2) / height] : [.5, .5]; }
  function navigate(zoom, location = center()) { if (!busy && view) void render({ previewOnly: true, zoom, center: location.slice() }); }
  function shiftView(x, y) {
    if (!view?.zoom) return;
    const location = center(); location[0] += x * view.region.width / width * .75; location[1] += y * view.region.height / height * .75;
    navigate(view.zoom, location);
  }
  function draw() {
    const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!view) return;
    [...precise.querySelectorAll("input")].forEach((input, i) => { input.value = cursor[i]; input.parentElement.querySelector("output").value = String(Math.round(cursor[i] * 100) / 100); });
    paintSpot.disabled = busy || !cursorVisible() || brush.mode === "pan";
    if (brush.mode === "pan") return;
    const radius = brush.radius * shortEdge * canvas.width / view.region.width;
    const mapped = (point) => maskViewPoint(view.region, width, height, brushPoint(point)).map((v, i) => v * (i ? canvas.height : canvas.width));
    ctx.strokeStyle = brush.mode === "restore" ? "#00d6d0" : "#ff5478"; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (strokes.length) {
      ctx.globalAlpha = .5; ctx.lineWidth = radius * 2; ctx.beginPath();
      strokes.forEach((point, i) => i ? ctx.lineTo(...mapped(point)) : ctx.moveTo(...mapped(point)));
      if (strokes.length === 1) { const [x, y] = mapped(strokes[0]); ctx.lineTo(x + .01, y); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.lineWidth = Math.max(.25, canvas.width / Math.max(1, canvas.getBoundingClientRect().width)); ctx.beginPath(); ctx.arc(...mapped(cursor), radius, 0, Math.PI * 2); ctx.stroke();
  }
  function show() {
    if (!view) return;
    image.src = view.urls[display.value]; image.alt = display.value === "maskPreview" ? "Mask: white shows the photo and black hides it" : display.value === "sourcePreview" ? "Original source photo" : "Cutout preview";
    plane.style.width = view.zoom ? `${view.width * view.zoom}px` : "100%";
    image.style.imageRendering = view.zoom ? "pixelated" : "auto";
    detail.value = String(view.zoom); navigation.hidden = !view.zoom;
    position.textContent = view.zoom ? `${view.zoom * 100}% source detail. Area ${view.region.x + 1}–${view.region.x + view.region.width}, ${view.region.y + 1}–${view.region.y + view.region.height}. Move view or use the direction buttons to inspect another area.` : "Whole photo preview. Choose a source-pixel detail level to repair small edges.";
    canvas.style.touchAction = brush.mode === "pan" && !view.zoom ? "auto" : "none";
    canvas.setAttribute("aria-label", view.zoom ? "Cutout detail brush. Arrow keys move one source pixel; Shift moves ten. Space paints one spot. Move view pans the detail area." : "Cutout brush. Arrow keys move the brush; Space paints one spot.");
    draw();
  }
  async function render(options = {}) {
    if (busy || disposed) return;
    setBusy(true); retry.hidden = true; message.textContent = "Updating cutout…"; onError("");
    const target = options.target == null ? null : history[options.target];
    const base = target ?? history[index];
    let pendingView;
    try {
      const zoom = options.zoom ?? view?.zoom ?? 0;
      const previewRegion = zoom ? maskDetailRegion(width, height, options.center ?? center(), { width: viewport.clientWidth, height: viewport.clientHeight }, zoom) : undefined;
      const inputMask = base ? { asset: base.asset, blob: base.blob } : mask;
      pendingBytes = options.imported?.size ?? 0; ledger();
      task = enqueueMask({ source, mask: options.imported || options.reset ? undefined : inputMask, imported: options.imported,
        mode: maskMode.value, stroke: options.stroke, reset: options.reset, previewOnly: Boolean(options.previewOnly), previewRegion, signal: controller.signal });
      const result = await task.promise;
      if (disposed) return;
      pendingBytes += (result.mask?.byteLength ?? 0) * 3 + [result.preview, result.sourcePreview, result.maskPreview].reduce((sum, bytes) => sum + bytes.byteLength * 2, 0) + result.previewWidth * result.previewHeight * 4; ledger();
      const urls = {}, blobs = ["preview", "maskPreview", "sourcePreview"].map((key) => {
        const blob = new Blob([result[key]], { type: "image/png" }); urls[key] = URL.createObjectURL(blob); return blob;
      });
      pendingView = { urls, width: result.previewWidth, height: result.previewHeight, region: result.region, zoom, bytes: blobs.reduce((sum, blob) => sum + blob.size, 0) };
      // Decode before committing the mask/history or replacing the old view.
      // A browser decode failure must not cause Retry to paint the stroke twice.
      const nextImage = new Image(); nextImage.alt = image.alt; nextImage.draggable = false;
      const abortDecode = () => nextImage.removeAttribute("src");
      controller.signal.addEventListener("abort", abortDecode, { once: true });
      try { nextImage.src = urls[display.value]; await nextImage.decode(); }
      finally { controller.signal.removeEventListener("abort", abortDecode); }
      if (disposed) return;
      if (!options.previewOnly) {
        const blob = new Blob([result.mask], { type: "image/png" });
        const asset = { id: "mask-preview", kind: "mask", name: "Cutout mask", type: "image/png", byteLength: blob.size,
          sha256: await hashAsset(result.mask), width: result.width, height: result.height, orientation: "upright" };
        if (disposed) return;
        const changes = Boolean(options.imported || options.reset || options.stroke || target);
        const entry = { blob, asset, original: target ? target.original : !changes && index < 0, remove: target ? target.remove : Boolean(options.remove) };
        if (index >= 0 || changes) await onChange(entry);
        if (disposed) return;
        if (target) index = options.target;
        else { history.splice(index + 1); history.push(entry); index++; }
      }
      let trimmed = false;
      while (history.length > 1 && (history.length > 16 || history.reduce((sum, entry) => sum + entry.blob.size, 0) > 24 * 1024 * 1024)) { history.shift(); index--; trimmed = true; }
      releaseView();
      view = pendingView; pendingView = null; image.replaceWith(nextImage); image = nextImage;
      if (!cursorVisible()) cursor.splice(0, 2, ...center());
      viewport.scrollTo(0, 0);
      canvas.width = view.width; canvas.height = view.height; strokes.length = 0; show();
      message.textContent = trimmed ? "Cutout ready. Earlier brush steps were cleared to save memory." : "Cutout ready. Apply keeps this change in your story.";
      retryOptions = null;
    } catch (error) { if (!disposed && error.name !== "AbortError") { retryOptions = options; retry.hidden = false; message.textContent = error.message; onError(error.message); } }
    finally {
      if (pendingView) for (const url of Object.values(pendingView.urls)) URL.revokeObjectURL(url);
      task = null; pendingBytes = 0;
      if (!disposed) { strokes.length = 0; if (view) detail.value = String(view.zoom); draw(); setBusy(false); }
      ledger();
    }
  }
  function paint(points) {
    if (busy || !view || !cursorVisible() || brush.mode === "pan") return;
    void render({ stroke: { ...brush, points: points.map((point) => brushPoint(point).slice()) } });
  }
  function point(event) {
    const box = canvas.getBoundingClientRect();
    return maskSourcePoint(view.region, width, height, (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (busy || !view || brush.mode === "pan" && !view.zoom || pointer != null || event.button !== 0) return;
    pointer = event.pointerId; canvas.setPointerCapture(pointer); strokes.length = 0; strokeOverflow = false;
    if (brush.mode === "pan") pan = { x: event.clientX, y: event.clientY, center: center() };
    else { strokes.push(point(event)); cursor.splice(0, 2, ...strokes[0]); }
    draw(); event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointer) return;
    if (pan) { plane.style.transform = `translate(${event.clientX - pan.x}px, ${event.clientY - pan.y}px)`; return; }
    const value = point(event), previous = strokes.at(-1);
    if (Math.hypot((value[0] - previous[0]) * width, (value[1] - previous[1]) * height) >= (view.zoom ? .5 / view.zoom : shortEdge * .002)) { if (strokes.length < 512) strokes.push(value); else strokeOverflow = true; }
    cursor.splice(0, 2, ...value); draw();
  });
  const end = (event, cancelled) => {
    if (event.pointerId !== pointer) return; pointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (pan) {
      const start = pan; pan = null; plane.style.transform = "";
      if (!cancelled) navigate(view.zoom, [start.center[0] - (event.clientX - start.x) / (view.zoom * width), start.center[1] - (event.clientY - start.y) / (view.zoom * height)]);
      return;
    }
    if (cancelled) { strokes.length = 0; draw(); return; }
    if (strokeOverflow) { strokes.length = 0; draw(); message.textContent = "Use a shorter brush stroke. This stroke was not applied."; return; }
    paint(strokes);
  };
  canvas.addEventListener("pointerup", (event) => end(event, false)); canvas.addEventListener("pointercancel", (event) => end(event, true));
  canvas.addEventListener("lostpointercapture", (event) => end(event, true));
  canvas.addEventListener("keydown", (event) => {
    if (busy || !view) return;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[event.key]) {
      event.preventDefault();
      if (brush.mode === "pan" && view.zoom) { shiftView(...moves[event.key]); return; }
      moves[event.key].forEach((value, i) => { const step = view.zoom ? (event.shiftKey ? 10 : 1) / (i ? height : width) : event.shiftKey ? .05 : .01; cursor[i] = Math.max(0, Math.min(1, cursor[i] + value * step)); });
      if (view.zoom && !cursorVisible()) navigate(view.zoom, cursor); else draw();
    }
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); paint([cursor.slice()]); }
  });
  mode.addEventListener("change", () => { brush.mode = mode.value; show(); buttons(); });
  display.addEventListener("change", show);
  detail.addEventListener("change", () => navigate(Number(detail.value), cursor));
  picker.addEventListener("change", () => { const imported = picker.files[0]; picker.value = ""; if (imported) void render({ imported }); });
  const observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    const refresh = () => { if (disposed || !view?.zoom) return; if (busy || pointer != null) { resizeTimer = setTimeout(refresh, 150); return; } navigate(view.zoom); };
    resizeTimer = setTimeout(refresh, 150);
  });
  observer.observe(viewport);
  void render();
  return { dispose() { disposed = true; observer.disconnect(); clearTimeout(resizeTimer); controller.abort(); task?.cancel(); releaseView(); history.length = 0; retryOptions = null; ledger(); wrapper.remove(); onBusy(false); } };
}
