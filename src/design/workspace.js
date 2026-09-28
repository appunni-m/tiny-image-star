import { createDesignView } from "./view.js";
import { addDesignPageCommand, addShapeLayerCommand, addTextLayerCommand, appendDesignImagesCommand, createDesignPageProject,
  deleteLayersCommand, renameLayerCommand, setLayerLockedCommand, setLayerVisibilityCommand, snapshotPageSelection,
  updatePageSelection } from "../project/design-page.js";
import { canonicalJSON, clone, newId } from "../project/model.js";
import { ProjectHistory } from "../project/history.js";
import { listDesignProjects, readDesignProject, writeDesignProject } from "../project/storage.js";
import { getProcessingScheduler } from "../processing/client.js";
import { enqueueScene } from "../processing/scene-client.js";
import { importStoryPhotos } from "../story/assets.js";
import { openContextMenu } from "../context-menu.js";
import { designRecipePatch, designRecipeProblem } from "./recipes.js";

const DESIGN_IMPORT_LIMIT = 128 * 1024 * 1024;

export function attachDesignWorkspace() {
  const { root, get } = createDesignView(), pool = getProcessingScheduler();
  let history = null, pageId = null, selection = { ids: [], anchorId: null }, sources = new Map(), fileOwner = null;
  let saveTimer = null, openSequence = 0;
  let previewTask = null, previewTimer = null, previewEpoch = 0, previewBitmap = null, exportBusy = false, importing = false, recipeJob = null;
  let geometry = null, zoom = 1, panX = 0, panY = 0, drag = null, marquee = null;
  const renderProject = () => history?.document ?? null;
  const currentPage = () => renderProject()?.slides.find((page) => page.id === pageId) ?? renderProject()?.slides[0] ?? null;
  const currentSelection = () => currentPage() ? snapshotPageSelection(selection, currentPage()) : [];
  const layer = (id) => renderProject()?.nodes[id] ?? null;
  const assets = () => Object.values(renderProject()?.assets ?? {});
  const retainedSourceBytes = () => [...sources.values()].reduce((sum, source) => sum + (source?.size ?? source?.byteLength ?? 0), 0);
  const setStatus = (message) => { get("canvas-status").textContent = message; };
  const setSaveStatus = (message) => { get("save-status").textContent = message; };

  function ledger(extraPreview = 0) {
    const decodedPreview = previewBitmap ? previewBitmap.width * previewBitmap.height * 4 : 0;
    const jobBytes = recipeJob?.retainedBytes ?? 0;
    pool.setRetainedBytes("design-workspace", Math.max(0, retainedSourceBytes() - (recipeJob?.sources === sources ? jobBytes : 0)) + decodedPreview + extraPreview);
    pool.setRetainedBytes("design-recipe-job", jobBytes);
  }

  function imageSource(id) {
    const source = sources.get(id);
    if (!source) throw new Error("An image layer has no retained local source. Reopen or re-add that image.");
    return source;
  }

  function selectionChanged() {
    selection.ids = currentPage()?.nodeIds.filter((id) => selection.ids.includes(id)) ?? [];
    renderLayers(); renderInspector(); drawCanvas();
  }

  function renderPages() {
    const list = get("page-current"), project = renderProject();
    list.replaceChildren();
    if (!project) return;
    project.slides.forEach((page, index) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "design-page-current";
      button.textContent = page.name || `Page ${index + 1}`; button.setAttribute("aria-current", String(page.id === currentPage()?.id));
      button.addEventListener("click", () => { pageId = page.id; selection = { ids: [], anchorId: null }; renderWorkspace(); schedulePreview(0); });
      list.append(button);
    });
    get("page-title").textContent = currentPage()?.name ?? "Page";
  }

  function toggleButton(label, pressed, action, className) {
    const button = document.createElement("button"); button.type = "button"; button.className = className;
    button.textContent = label; button.setAttribute("aria-pressed", String(pressed)); button.addEventListener("click", action); return button;
  }

  function renderLayers() {
    const container = get("layer-list"), page = currentPage(), project = renderProject();
    container.replaceChildren();
    if (!page || !project) { get("layer-count").textContent = "0"; return; }
    const ids = [...page.nodeIds].reverse();
    get("layer-count").textContent = String(ids.length);
    for (const id of ids) {
      const node = layer(id); if (!node) continue;
      const row = document.createElement("div"); row.className = "design-layer-row";
      row.classList.toggle("selected", selection.ids.includes(id)); row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(selection.ids.includes(id))); row.dataset.layerId = id;
      const select = document.createElement("button"); select.type = "button"; select.className = "design-layer-select";
      select.textContent = node.name || (node.kind === "image" ? project.assets[node.assetId]?.name : node.kind[0].toUpperCase() + node.kind.slice(1)) || "Layer";
      select.title = select.textContent; select.addEventListener("click", (event) => {
        selection = updatePageSelection(selection, page.nodeIds, id, { toggle: event.metaKey || event.ctrlKey, extend: event.shiftKey });
        selectionChanged();
      });
      const eye = toggleButton(node.visible === false ? "◌" : "◉", node.visible !== false, () => mutateMany("Visibility", (current) => ({
        ...current, visible: current.visible === false,
      }), [id]), "design-layer-icon"); eye.setAttribute("aria-label", `${node.visible === false ? "Show" : "Hide"} ${select.textContent}`); eye.title = eye.getAttribute("aria-label");
      const lock = toggleButton(node.locked ? "▣" : "□", Boolean(node.locked), () => mutateMany("Lock", (current) => ({
        ...current, locked: !current.locked,
      }), [id]), "design-layer-icon"); lock.setAttribute("aria-label", `${node.locked ? "Unlock" : "Lock"} ${select.textContent}`); lock.title = lock.getAttribute("aria-label");
      row.append(select, eye, lock); row.addEventListener("contextmenu", (event) => { event.preventDefault(); contextMenuForLayer(event, id); });
      container.append(row);
    }
  }

  function setField(name, value) { get(name).value = String(value); }

  function renderInspector() {
    const ids = currentSelection(), project = renderProject(), node = ids.length === 1 ? layer(ids[0]) : null;
    get("selection-count").textContent = `${ids.length} selected`;
    get("selection-summary").textContent = ids.length ? ids.length === 1 ? layer(ids[0])?.name ?? "1 layer selected" : `${ids.length} layers selected` : "Nothing selected";
    get("inspector-empty").hidden = Boolean(ids.length);
    get("inspector-content").hidden = !node;
    if (!node || !project) return;
    const asset = node.assetId ? project.assets[node.assetId] : null;
    setField("layer-name", node.name || asset?.name || node.kind);
    for (const key of ["x", "y", "width", "height"]) setField(key, ((node.frame?.[key] ?? 0) * 100).toFixed(1));
    const textField = get("text-field"), colorField = get("color-field"), fitField = get("fit-field"), adjustments = get("image-adjustments");
    textField.hidden = node.kind !== "text"; colorField.hidden = !["shape", "text"].includes(node.kind);
    fitField.hidden = node.kind !== "image"; adjustments.hidden = node.kind !== "image";
    if (node.kind === "text") get("text").value = node.text ?? "";
    if (["shape", "text"].includes(node.kind)) get("color").value = node.color ?? "#5149d5";
    if (node.kind === "image") {
      get("image-fit").value = node.fit ?? "contain";
      for (const key of ["brightness", "contrast", "saturation"]) {
        const value = node.appearance?.[key] ?? 1;
        get(key).value = String(value); get(`${key}-value`).value = Number(value).toFixed(2);
      }
    }
    const isLocked = Boolean(node.locked);
    for (const control of root.querySelectorAll("#design-inspector-content input, #design-inspector-content textarea, #design-inspector-content select")) control.disabled = isLocked;
    get("toggle-visibility").textContent = node.visible === false ? "Show" : "Hide";
    get("toggle-lock").textContent = isLocked ? "Unlock" : "Lock";
    get("delete").disabled = false;
  }

  function renderWorkspace() {
    const project = renderProject();
    if (!project) {
      if (document.activeElement !== get("document-name")) get("document-name").value = "Untitled design";
      get("add-text").disabled = true;
      get("add-rectangle").disabled = true; get("export").disabled = true; get("undo").disabled = true; get("redo").disabled = true;
      get("fit").disabled = true; get("empty-state").hidden = false; get("page-title").textContent = "Page 1";
      get("layer-list").replaceChildren(); get("layer-count").textContent = "0"; renderInspector(); drawCanvas();
      return;
    }
    if (!project.slides.some((page) => page.id === pageId)) pageId = project.slides[0]?.id ?? null;
    if (document.activeElement !== get("document-name")) get("document-name").value = project.name;
    get("add-text").disabled = !currentPage() || currentPage().nodeIds.length >= 200;
    get("add-rectangle").disabled = get("add-text").disabled;
    get("export").disabled = !currentPage() || exportBusy || importing;
    get("undo").disabled = !history.past.length; get("redo").disabled = !history.future.length;
    get("fit").disabled = !currentPage(); get("empty-state").hidden = Boolean(currentPage()?.nodeIds.length);
    get("page-current").disabled = false;
    renderPages(); renderLayers(); renderInspector(); drawCanvas();
  }

  function mutateMany(label, patchNode, ids = currentSelection()) {
    if (!history || !ids.length) return;
    const commands = ids.map((id) => ({ type: "node", id, value: patchNode(clone(layer(id))) }));
    try { history.apply({ type: "group", commands }, label); edited(label); }
    catch (error) { setStatus(error.message); }
  }

  function previewNode(id, patch) {
    const node = layer(id); if (!node || node.locked) return;
    try {
      history.preview({ type: "node", id, value: { ...clone(node), ...patch } });
      edited("Previewing changes…", { previewOnly: true });
    } catch (error) { setStatus(error.message); }
  }

  function edited(status = "Updating page…", { previewOnly = false } = {}) {
    renderWorkspace(); setStatus(status); schedulePreview();
    if (!previewOnly) saveSoon();
  }

  function commitEdit(label) {
    if (!history?.base) return;
    history.commit(label); renderWorkspace(); schedulePreview(0); saveSoon();
  }

  function runHistory(direction) {
    if (!history || !history[direction]()) return;
    if (!renderProject().slides.some((page) => page.id === pageId)) pageId = renderProject().slides[0]?.id ?? null;
    selectionChanged(); edited(direction === "undo" ? "Undid edit." : "Redid edit.");
  }

  function formatGeometry(node) {
    const variant = renderProject().variants[0], rect = node.frame;
    const scale = geometry?.scale ?? 1, canvas = get("canvas");
    const rectView = { x: geometry?.x + rect.x * variant.width * scale, y: geometry?.y + rect.y * variant.height * scale,
      width: rect.width * variant.width * scale, height: rect.height * variant.height * scale };
    return { ...rectView, right: rectView.x + rectView.width, bottom: rectView.y + rectView.height, canvas };
  }

  function fitGeometry() {
    const canvas = get("canvas"), page = currentPage(), project = renderProject();
    if (!page || !project || !canvas.clientWidth || !canvas.clientHeight) { geometry = null; return; }
    const variant = project.variants[0], margin = 40;
    const scale = Math.min((canvas.clientWidth - margin * 2) / variant.width, (canvas.clientHeight - margin * 2) / variant.height) * zoom;
    const x = (canvas.clientWidth - variant.width * scale) / 2 + panX, y = (canvas.clientHeight - variant.height * scale) / 2 + panY;
    geometry = { x, y, scale, width: variant.width, height: variant.height };
    get("zoom-label").textContent = `${Math.round(scale / Math.min((canvas.clientWidth - margin * 2) / variant.width,
      (canvas.clientHeight - margin * 2) / variant.height) * 100)}%`;
  }

  function drawCanvas() {
    const canvas = get("canvas"), ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height); fitGeometry();
    if (!geometry) return;
    const { x, y, scale } = geometry, { width: pageWidth, height: pageHeight } = geometry;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#fff";
    ctx.shadowColor = "rgba(0,0,0,.22)"; ctx.shadowBlur = 24; ctx.fillRect(x, y, pageWidth * scale, pageHeight * scale); ctx.shadowBlur = 0;
    if (previewBitmap) ctx.drawImage(previewBitmap, x, y, pageWidth * scale, pageHeight * scale);
    ctx.strokeStyle = "rgba(45, 126, 247, .95)"; ctx.lineWidth = 1.5;
    for (const id of currentSelection()) {
      const node = layer(id); if (!node?.frame || node.visible === false) continue;
      const rect = formatGeometry(node); ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      if (currentSelection().length === 1 && rect.width > 14 && rect.height > 14) {
        ctx.fillStyle = "#2d7ef7"; const handles = [[rect.x, rect.y], [rect.right, rect.y], [rect.x, rect.bottom], [rect.right, rect.bottom]];
        for (const [hx, hy] of handles) { ctx.fillRect(hx - 3, hy - 3, 6, 6); }
      }
    }
    if (marquee) { ctx.setLineDash([5, 4]); ctx.strokeStyle = "#2d7ef7"; ctx.fillStyle = "rgba(45,126,247,.12)";
      ctx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height); ctx.strokeRect(marquee.x, marquee.y, marquee.width, marquee.height); ctx.setLineDash([]); }
  }

  function pointerPoint(event) {
    const rect = get("canvas").getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function pagePoint(point) {
    if (!geometry) return null;
    return { x: (point.x - geometry.x) / geometry.scale, y: (point.y - geometry.y) / geometry.scale };
  }
  function hitTest(point) {
    const page = currentPage(); if (!page || !geometry) return null;
    const local = pagePoint(point); if (!local || local.x < 0 || local.y < 0 || local.x > geometry.width || local.y > geometry.height) return null;
    return [...page.nodeIds].reverse().find((id) => {
      const node = layer(id), frame = node?.frame;
      return frame && node.visible !== false && local.x >= frame.x * geometry.width && local.x <= (frame.x + frame.width) * geometry.width
        && local.y >= frame.y * geometry.height && local.y <= (frame.y + frame.height) * geometry.height;
    }) ?? null;
  }

  function canvasPointerDown(event) {
    if (event.button !== 0 || !currentPage()) return;
    const point = pointerPoint(event), id = hitTest(point);
    if (id) {
      if (event.shiftKey || event.metaKey || event.ctrlKey) selection = updatePageSelection(selection, currentPage().nodeIds, id,
        { extend: event.shiftKey, toggle: event.metaKey || event.ctrlKey });
      else if (!selection.ids.includes(id)) selection = updatePageSelection(null, currentPage().nodeIds, id);
      selectionChanged();
      const selected = currentSelection().filter((selectedId) => !layer(selectedId)?.locked);
      const world = pagePoint(point);
      drag = { kind: "layers", pointerId: event.pointerId, start: world, ids: selected,
        frames: Object.fromEntries(selected.map((selectedId) => [selectedId, clone(layer(selectedId).frame)])), moved: false };
    } else {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey) selection = { ids: [], anchorId: null };
      drag = { kind: "marquee", pointerId: event.pointerId, start: point, extend: event.shiftKey || event.metaKey || event.ctrlKey, moved: false };
      selectionChanged();
    }
    get("canvas").setPointerCapture(event.pointerId); event.preventDefault();
  }

  function canvasPointerMove(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointerPoint(event);
    if (drag.kind === "layers") {
      const world = pagePoint(point), dx = world.x - drag.start.x, dy = world.y - drag.start.y;
      if (Math.abs(dx) * geometry.scale + Math.abs(dy) * geometry.scale < 1) return;
      drag.moved = true;
      history.preview({ type: "group", commands: drag.ids.map((id) => ({ type: "node", id, value: { ...clone(layer(id)),
        frame: { ...drag.frames[id], x: drag.frames[id].x + dx / geometry.width, y: drag.frames[id].y + dy / geometry.height } } })) });
      edited("Moving selection…", { previewOnly: true });
    } else {
      drag.moved = true;
      marquee = { x: Math.min(drag.start.x, point.x), y: Math.min(drag.start.y, point.y), width: Math.abs(point.x - drag.start.x), height: Math.abs(point.y - drag.start.y) };
      drawCanvas();
    }
  }

  function canvasPointerUp(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "layers" && drag.moved) commitEdit("Move layers");
    if (drag.kind === "marquee" && drag.moved && geometry) {
      const bounds = marquee, hits = currentPage().nodeIds.filter((id) => {
        const node = layer(id), frame = node?.frame; if (!frame || node.visible === false) return false;
        const rect = formatGeometry(node);
        return rect.x < bounds.x + bounds.width && rect.right > bounds.x && rect.y < bounds.y + bounds.height && rect.bottom > bounds.y;
      });
      if (drag.extend) selection = { ids: [...new Set([...selection.ids, ...hits])].filter((id) => currentPage().nodeIds.includes(id)), anchorId: selection.anchorId };
      else selection = { ids: hits, anchorId: hits[0] ?? null };
    }
    marquee = null; drag = null; selectionChanged();
  }

  function schedulePreview(delay = 90) {
    clearTimeout(previewTimer); previewTask?.cancel(); previewTask = null;
    if (root.hidden || !history || !currentPage()) return;
    const epoch = ++previewEpoch, project = clone(history.document), selectedPage = currentPage().id;
    previewTimer = setTimeout(async () => {
      let nextTask;
      try {
        nextTask = enqueueScene({ project, slideId: selectedPage, variantId: project.variants[0].id, preview: true, previewEdge: 1280,
          readAsset: async (id) => imageSource(id), priority: 0, pool }); previewTask = nextTask;
        setStatus("Updating page preview…");
        const output = await nextTask.promise;
        if (epoch !== previewEpoch || root.hidden) return;
        const bitmap = await createImageBitmap(new Blob([output.output], { type: output.mime || "image/png" }));
        if (epoch !== previewEpoch || root.hidden) { bitmap.close(); return; }
        previewBitmap?.close(); previewBitmap = bitmap; ledger(); drawCanvas();
        setStatus("Preview ready · edits remain attached to their layers.");
      } catch (error) {
        if (error?.name !== "AbortError" && epoch === previewEpoch) setStatus(error?.userMessage ?? error.message ?? "The page preview could not be updated.");
      } finally { if (previewTask === nextTask) previewTask = null; }
    }, delay);
  }

  function layerOrderCommand(nodeId, front) {
    const page = currentPage(), ids = [...page.nodeIds], index = ids.indexOf(nodeId);
    if (index < 0) return;
    ids.splice(index, 1); ids.splice(front ? ids.length : 0, 0, nodeId);
    history.apply({ type: "slides", value: renderProject().slides.map((entry) => entry.id === page.id ? { ...clone(entry), nodeIds: ids } : clone(entry)) },
      front ? "Bring to front" : "Send to back"); edited("Layer order updated.");
  }

  function designRecipeJobStatus(job) {
    if (job.cancelled) return job.active ? `Stopping ${job.active} active image${job.active === 1 ? "" : "s"}…` : "Recipe job cancelled.";
    if (job.paused) return job.active ? `Finishing ${job.active} active image${job.active === 1 ? "" : "s"} before pausing.` : "Paused · no new images will start.";
    return job.active ? `Processing ${job.active} image${job.active === 1 ? "" : "s"}; ${job.queue.length} waiting.` : "Preparing the next image…";
  }

  function renderDesignRecipeJob() {
    const job = recipeJob, bar = get("recipe-job"); bar.hidden = !job;
    if (!job) return;
    const elapsed = Math.max(.001, (performance.now() - job.startedAt) / 1000), rate = job.completed / elapsed;
    get("recipe-job-title").textContent = `Applying ${job.recipe.name}`;
    get("recipe-job-status").textContent = designRecipeJobStatus(job);
    get("recipe-job-progress").max = Math.max(1, job.total); get("recipe-job-progress").value = job.completed;
    get("recipe-job-metrics").textContent = `${job.completed} of ${job.total} · ${rate < 1 ? "<1" : rate.toFixed(1)} images/s`;
    get("recipe-job-pause").textContent = job.paused ? job.active ? "Pausing…" : "Resume" : "Pause";
    get("recipe-job-pause").disabled = job.cancelled || job.active === 0 && job.queue.length === 0;
    get("recipe-job-cancel").disabled = job.cancelled;
  }

  function renderRecipeTarget(job, nodeId) {
    const project = clone(job.project), node = project.nodes[nodeId];
    project.nodes[nodeId] = { ...node, ...job.patches.get(nodeId) };
    for (const other of Object.values(project.nodes)) if (other.id !== nodeId) other.visible = false;
    const task = enqueueScene({ project, slideId: job.pageId, variantId: project.variants[0].id, preview: true, previewEdge: 256,
      readAsset: async (id) => {
        const source = job.sources.get(id);
        if (!source) throw new Error("An original image is no longer available for this recipe job.");
        return source;
      }, priority: 0, pool });
    job.requests.set(nodeId, task);
    return task;
  }

  function finishDesignRecipeJob(job) {
    if (recipeJob !== job || job.finishing) return;
    job.finishing = true; job.unsubscribe?.(); job.unsubscribe = null;
    if (!job.cancelled) {
      const commands = [];
      for (const id of job.succeeded) {
        const current = renderProject()?.nodes[id], before = job.project.nodes[id];
        if (!current || canonicalJSON(current) !== canonicalJSON(before)) { job.failures.push({ id, message: "This layer changed while the recipe was rendering." }); continue; }
        commands.push({ type: "node", id, value: { ...clone(current), ...job.patches.get(id) } });
      }
      job.applied = 0;
      if (commands.length) {
        try {
          history.apply({ type: "group", commands }, `Apply ${job.recipe.name}`);
          job.applied = commands.length;
          selection = { ids: currentPage()?.nodeIds.filter((id) => job.targetIds.includes(id)) ?? [], anchorId: job.targetIds[0] ?? null };
          renderWorkspace(); schedulePreview(0); saveSoon();
        } catch (error) { job.failures.push({ id: "", message: error.message }); }
      }
    }
    recipeJob = null; ledger(); renderDesignRecipeJob();
    if (job.cancelled) setStatus("Recipe job cancelled · the page remains unchanged.");
    else if (job.failures.length) setStatus(`${job.applied} image${job.applied === 1 ? "" : "s"} updated; ${job.failures.length} need attention.`);
    else setStatus(`Applied ${job.recipe.name} to ${job.applied} image layer${job.applied === 1 ? "" : "s"}.`);
  }

  function pumpDesignRecipeJob(job) {
    if (recipeJob !== job || job.cancelled || job.paused) { renderDesignRecipeJob(); return; }
    while (job.active < job.desiredWorkers && job.queue.length) {
      const id = job.queue.shift(); job.active += 1; renderDesignRecipeJob();
      let task;
      try { task = renderRecipeTarget(job, id); }
      catch (error) { task = { promise: Promise.reject(error), cancel: () => {} }; task.promise.catch(() => {}); }
      task.promise.then(() => job.succeeded.push(id)).catch((error) => {
        if (!job.cancelled) job.failures.push({ id, message: error?.userMessage ?? error?.message ?? "This image could not be updated." });
      }).finally(() => {
        job.requests.delete(id); job.active = Math.max(0, job.active - 1); job.completed += 1;
        if (recipeJob !== job) return;
        renderDesignRecipeJob();
        if (job.active === 0 && (job.cancelled || !job.queue.length)) finishDesignRecipeJob(job);
        else if (!job.paused && !job.cancelled) pumpDesignRecipeJob(job);
      });
    }
    if (job.active === 0 && !job.queue.length) finishDesignRecipeJob(job);
  }

  function startDesignRecipeJob(recipe, targetIds) {
    if (recipeJob) { setStatus("Finish or cancel the current recipe job first."); return; }
    if (history.base) history.commit("Edit image");
    const project = clone(history.document), page = project.slides.find((entry) => entry.id === pageId);
    const ids = [...new Set(targetIds)].filter((id) => page?.nodeIds.includes(id) && project.nodes[id]?.kind === "image" && !project.nodes[id].locked);
    if (!ids.length) { setStatus("Select at least one unlocked image layer."); return; }
    const issue = designRecipeProblem(recipe); if (issue) { setStatus(issue); return; }
    const patches = new Map();
    try { for (const id of ids) patches.set(id, designRecipePatch(project.nodes[id], project.assets[project.nodes[id].assetId], recipe)); }
    catch (error) { setStatus(error.message); return; }
    const sourcesForJob = new Map(sources), retainedBytes = ids.reduce((sum, id) => {
      const source = sourcesForJob.get(project.nodes[id].assetId); return sum + (source?.size ?? source?.byteLength ?? 0);
    }, 0);
    recipeJob = { recipe: clone(recipe), targetIds: ids, queue: [...ids], succeeded: [], failures: [], requests: new Map(), active: 0,
      completed: 0, total: ids.length, paused: false, cancelled: false, project, pageId: page.id, patches, sources: sourcesForJob,
      retainedBytes, desiredWorkers: pool.snapshot().limit, startedAt: performance.now(), unsubscribe: null };
    const job = recipeJob;
    get("recipe-job-speed").value = pool.mode; ledger();
    job.unsubscribe = pool.subscribe((snapshot) => { job.desiredWorkers = Math.max(1, snapshot.limit); pumpDesignRecipeJob(job); });
    renderDesignRecipeJob(); setStatus(`Applying ${recipe.name} to ${ids.length} image layers…`); pumpDesignRecipeJob(job);
  }

  function cancelDesignRecipeJob(reason = "") {
    const job = recipeJob; if (!job || job.cancelled) return;
    job.cancelled = true; job.queue.length = 0; job.cancelReason = reason;
    for (const request of job.requests.values()) request.cancel();
    renderDesignRecipeJob(); if (!job.active) finishDesignRecipeJob(job);
  }

  function toggleDesignRecipePause() {
    const job = recipeJob; if (!job || job.cancelled) return;
    job.paused = !job.paused; renderDesignRecipeJob(); if (!job.paused) pumpDesignRecipeJob(job);
  }

  function setDesignRecipeSpeed() {
    const mode = get("recipe-job-speed").value, control = document.querySelector("#processing-mode-select") ?? document.querySelector("#batch-job-speed");
    if (!control) return;
    control.value = mode; control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function contextMenuForLayer(event, id) {
    if (!selection.ids.includes(id)) { selection = updatePageSelection(null, currentPage().nodeIds, id); selectionChanged(); }
    const ids = currentSelection(), node = layer(id);
    const imageIds = ids.filter((selectedId) => layer(selectedId)?.kind === "image" && !layer(selectedId)?.locked);
    const recipes = window.tinyImageStarBatch?.listRecipes?.() ?? [];
    const recipeItems = node?.kind === "image" ? [
      { type: "separator" },
      { type: "heading", label: `${imageIds.length} image layer${imageIds.length === 1 ? "" : "s"} selected` },
      { label: "Save this image as recipe…", disabled: Boolean(recipeJob), action: () => {
        const asset = renderProject().assets[node.assetId], bridge = window.tinyImageStarBatch;
        if (!bridge?.openDesignImageRecipe) { setStatus("The recipe library is still opening. Try again shortly."); return; }
        bridge.openDesignImageRecipe({ name: node.name || asset.name, appearance: clone(node.appearance ?? {}), crop: clone(node.crop ?? null),
          rotation: node.rotation ?? 0, width: asset.width, height: asset.height });
      } },
      { type: "heading", label: "Apply recipe to selected images" },
      ...recipes.map((recipe) => {
        const issue = designRecipeProblem(recipe);
        return { label: recipe.name, disabled: Boolean(recipeJob || issue || !imageIds.length), title: issue || undefined,
          action: () => startDesignRecipeJob(recipe, imageIds) };
      }),
    ] : [];
    openContextMenu({ x: event.clientX, y: event.clientY, anchor: event.currentTarget, focus: event.currentTarget,
      items: [{ label: "Add text", action: () => addText() }, { type: "separator" },
        { label: node?.visible === false ? "Show layer" : "Hide layer", action: () => mutateMany("Visibility", (current) => ({ ...current, visible: current.visible === false }), ids) },
        { label: "Bring to front", action: () => layerOrderCommand(id, true) },
        { label: "Send to back", action: () => layerOrderCommand(id, false) },
        { label: node?.locked ? "Unlock selection" : "Lock selection", action: () => mutateMany("Lock", (current) => ({ ...current, locked: !node?.locked }), ids) },
        { label: `Delete ${ids.length === 1 ? "layer" : `${ids.length} layers`}`, action: () => deleteSelected() }, ...recipeItems],
    });
  }

  function addText() {
    if (!history || !currentPage()) return;
    try {
      const command = addTextLayerCommand(history.document, currentPage().id, "Add text");
      history.apply(command, "Add text"); const id = command.commands[0].id; selection = { ids: [id], anchorId: id }; edited("Text layer added.");
    } catch (error) { setStatus(error.message); }
  }

  function addRectangle() {
    if (!history || !currentPage()) return;
    try {
      const command = addShapeLayerCommand(history.document, currentPage().id, "rectangle");
      history.apply(command, "Add rectangle"); const id = command.commands[0].id; selection = { ids: [id], anchorId: id }; edited("Rectangle added.");
    } catch (error) { setStatus(error.message); }
  }

  function deleteSelected() {
    if (!history || !currentSelection().length) return;
    try { history.apply(deleteLayersCommand(history.document, currentSelection()), "Delete layers"); selection = { ids: [], anchorId: null }; edited("Selection deleted."); }
    catch (error) { setStatus(error.message); }
  }

  async function importImages(files) {
    if (importing || !files.length) return;
    const incoming = [...files], pendingBytes = incoming.reduce((sum, file) => sum + file.size, 0);
    const total = retainedSourceBytes() + pendingBytes;
    if (total > DESIGN_IMPORT_LIMIT) { setStatus("This design is limited to 128 MB of source images in this browser session. Add fewer or smaller files."); return; }
    importing = true; get("export").disabled = true; get("add-images").disabled = true;
    let importController = new AbortController();
    try {
      const imported = await importStoryPhotos(incoming, { signal: importController.signal,
        onProgress: (done, all) => setStatus(`Reading images on this device · ${done} of ${all}`),
        onRetainedBytes: (bytes) => pool.setRetainedBytes("design-import", retainedSourceBytes() + bytes) });
      if (!history) {
        const project = createDesignPageProject({ images: imported.map((item) => item.asset), name: "Untitled design" });
        activateProject(project, { sources: new Map(imported.map((item) => [item.asset.id, item.source])) });
        selection = { ids: [...project.slides[0].nodeIds], anchorId: project.slides[0].nodeIds[0] ?? null };
      } else {
        const command = appendDesignImagesCommand(history.document, currentPage().id, imported.map((item) => item.asset));
        history.apply(command, "Add images");
        for (const item of imported) sources.set(item.asset.id, item.source);
        const newIds = Object.values(history.document.nodes).filter((node) => imported.some((item) => item.asset.id === node.assetId)).map((node) => node.id);
        selection = { ids: newIds, anchorId: newIds[0] ?? null };
      }
      zoom = 1; panX = 0; panY = 0; ledger(); renderWorkspace();
      setStatus(`${imported.length} image${imported.length === 1 ? "" : "s"} added as independent layers.`); schedulePreview(0); saveSoon();
    } catch (error) { setStatus(error?.userMessage ?? error.message ?? "These images could not be added."); }
    finally { pool.setRetainedBytes("design-import", 0); importing = false; get("add-images").disabled = false; renderWorkspace(); }
  }

  async function exportPage() {
    const project = renderProject(), page = currentPage(); if (!project || !page || exportBusy) return;
    exportBusy = true; renderWorkspace(); setStatus("Rendering the full-resolution page…");
    let task;
    try {
      task = enqueueScene({ project: clone(project), slideId: page.id, variantId: project.variants[0].id, format: "png", preview: false,
        readAsset: async (id) => imageSource(id), priority: 1, pool });
      const output = await task.promise;
      const blob = new Blob([output.output], { type: output.mime || "image/png" }), url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"), stem = `${project.name}-${page.name}`.replace(/[^\p{L}\p{N}._ -]+/gu, "-").trim().slice(0, 100) || "design-page";
      anchor.href = url; anchor.download = `${stem}.png`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setStatus("Page exported as a local PNG.");
    } catch (error) { setStatus(error?.userMessage ?? error.message ?? "The page could not be exported."); }
    finally { exportBusy = false; renderWorkspace(); }
  }

  function activateProject(project, { key = null, revision = null, sources: nextSources = new Map() } = {}) {
    cancelDesignRecipeJob("The document changed.");
    clearTimeout(saveTimer); previewTask?.cancel(); previewTask = null; previewEpoch += 1;
    previewBitmap?.close(); previewBitmap = null;
    history = new ProjectHistory(project); pageId = project.slides[0]?.id ?? null;
    selection = { ids: [], anchorId: null }; sources = nextSources;
    fileOwner = { key: key ?? `design:${project.id}`, savedRevision: revision, autoSave: true, saving: Promise.resolve(), saveError: null };
    ledger(); renderWorkspace(); schedulePreview(0);
    setSaveStatus(revision == null ? "New design" : "Saved on this device");
  }

  async function refreshDesignFiles(selectedKey = fileOwner?.key ?? "") {
    const files = await listDesignProjects(), picker = get("open-file"), placeholder = picker.options[0];
    picker.replaceChildren(placeholder);
    for (const file of files) {
      const option = document.createElement("option"); option.value = file.key;
      option.textContent = `${file.name} · ${new Date(file.savedAt).toLocaleString()}`; option.title = `${file.name} · ${file.byteLength} bytes`;
      picker.append(option);
    }
    picker.value = files.some((file) => file.key === selectedKey) ? selectedKey : "";
    return files;
  }

  async function openDesign(key) {
    if (!key) return;
    const ticket = ++openSequence; setStatus("Opening saved design…");
    try {
      const opened = await readDesignProject(key);
      if (!opened) throw new Error("That saved design is no longer available.");
      const retained = new Map();
      for (const asset of Object.values(opened.project.assets)) retained.set(asset.id, await opened.readAsset(asset.id));
      if (ticket !== openSequence) return;
      activateProject(opened.project, { key: opened.key, revision: opened.revision, sources: retained });
      setStatus("Design reopened · original images are available for editing.");
      await refreshDesignFiles(opened.key);
    } catch (error) {
      if (ticket === openSequence) { setStatus(error?.userMessage ?? error.message ?? "The saved design could not be opened."); await refreshDesignFiles(); }
    }
  }

  function newDesign() {
    openSequence += 1;
    const project = createDesignPageProject({ name: "Untitled design", images: [] });
    activateProject(project); get("open-file").value = ""; saveSoon(); setStatus("New local design created.");
  }

  function persist() {
    clearTimeout(saveTimer);
    const owner = fileOwner, project = renderProject();
    if (!owner || !project) return Promise.resolve();
    const snapshot = clone(project), sourceSnapshot = new Map(sources);
    owner.autoSave = true;
    owner.saving = owner.saving.catch(() => {}).then(async () => {
      if (!owner.autoSave || owner.savedRevision === snapshot.revision) return;
      setSaveStatus("Saving…");
      try {
        const saved = await writeDesignProject(snapshot, { key: owner.key, expectedRevision: owner.savedRevision,
          readAsset: async (id) => sourceSnapshot.get(id) });
        owner.key = saved.key; owner.savedRevision = saved.revision; owner.saveError = null;
        if (fileOwner === owner) {
          setSaveStatus(history?.document.revision === snapshot.revision ? "Saved on this device" : "Saving newer changes…");
          void refreshDesignFiles(owner.key);
        }
      } catch (error) {
        owner.saveError = error;
        if (fileOwner === owner) setSaveStatus(`Save failed · ${error.message}`);
        throw error;
      }
    });
    return owner.saving;
  }

  function saveSoon() {
    if (!history || !fileOwner) return;
    fileOwner.autoSave = true; setSaveStatus("Unsaved changes"); clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void persist().catch(() => {}); }, 450);
  }

  function showDesign() { window.dispatchEvent(new CustomEvent("tinystar:show-design")); }
  function requestFiles() { get("file-input").click(); }

  get("canvas").addEventListener("pointerdown", canvasPointerDown);
  get("canvas").addEventListener("pointermove", canvasPointerMove);
  get("canvas").addEventListener("pointerup", canvasPointerUp);
  get("canvas").addEventListener("pointercancel", canvasPointerUp);
  get("canvas").addEventListener("contextmenu", (event) => {
    event.preventDefault(); const id = hitTest(pointerPoint(event));
    if (id) contextMenuForLayer(event, id);
    else openContextMenu({ x: event.clientX, y: event.clientY, anchor: get("canvas"), focus: get("canvas"), items: [
      { label: "Add images", action: requestFiles }, { label: "Add text", action: addText }, { label: "Add rectangle", action: addRectangle },
    ] });
  });
  get("canvas").addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault(); zoom = Math.max(.25, Math.min(4, zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1))); drawCanvas();
  }, { passive: false });
  get("canvas").addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); runHistory(event.shiftKey ? "redo" : "undo"); }
    else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") { event.preventDefault(); runHistory("redo"); }
    else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selection = { ids: currentPage()?.nodeIds.filter((id) => layer(id)?.visible !== false) ?? [], anchorId: currentPage()?.nodeIds[0] ?? null }; selectionChanged(); }
    else if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); deleteSelected(); }
    else if (event.key === "Escape") { selection = { ids: [], anchorId: null }; selectionChanged(); }
  });

  get("add-images").addEventListener("click", requestFiles);
  get("empty-add").addEventListener("click", requestFiles);
  get("new-file").addEventListener("click", newDesign);
  get("open-file").addEventListener("change", () => { if (get("open-file").value) void openDesign(get("open-file").value); });
  get("recipe-job-pause").addEventListener("click", toggleDesignRecipePause);
  get("recipe-job-cancel").addEventListener("click", () => cancelDesignRecipeJob("Cancelled by user."));
  get("recipe-job-speed").addEventListener("change", setDesignRecipeSpeed);
  get("document-name").addEventListener("change", () => {
    if (!history) return;
    const name = get("document-name").value.trim();
    if (!name || name.length > 120) { get("document-name").value = history.document.name; setStatus("Design names must contain 1–120 characters."); return; }
    if (name !== history.document.name) { history.apply({ type: "name", value: name }, "Rename design"); edited("Design renamed."); }
  });
  get("file-input").addEventListener("change", () => { const files = [...(get("file-input").files ?? [])]; get("file-input").value = ""; void importImages(files); });
  get("add-text").addEventListener("click", addText); get("add-rectangle").addEventListener("click", addRectangle);
  get("new-page").addEventListener("click", () => {
    try {
      if (!history) { newDesign(); return; }
      const added = addDesignPageCommand(history.document); history.apply(added.command, "Add page"); pageId = added.id;
      selection = { ids: [], anchorId: null }; edited("Page added.");
    } catch (error) { setStatus(error.message); }
  });
  get("undo").addEventListener("click", () => runHistory("undo")); get("redo").addEventListener("click", () => runHistory("redo"));
  get("export").addEventListener("click", () => void exportPage()); get("fit").addEventListener("click", () => { zoom = 1; panX = 0; panY = 0; drawCanvas(); });
  get("layer-name").addEventListener("change", () => { const id = currentSelection()[0]; if (!id) return; try { history.apply(renameLayerCommand(history.document, id, get("layer-name").value), "Rename layer"); edited("Layer renamed."); } catch (error) { setStatus(error.message); } });
  for (const [field, key] of [["x", "x"], ["y", "y"], ["width", "width"], ["height", "height"]]) {
    get(field).addEventListener("input", () => {
      const id = currentSelection()[0], node = id && layer(id), value = Number(get(field).value);
      if (!node || !Number.isFinite(value)) return;
      const frame = { ...node.frame, [key]: value / 100 };
      previewNode(id, { frame });
    });
    get(field).addEventListener("change", () => commitEdit("Change layer geometry"));
  }
  get("text").addEventListener("input", () => { const id = currentSelection()[0]; if (id) previewNode(id, { text: get("text").value }); });
  get("text").addEventListener("change", () => commitEdit("Edit text"));
  get("color").addEventListener("input", () => { const id = currentSelection()[0]; if (id) previewNode(id, { color: get("color").value }); });
  get("color").addEventListener("change", () => commitEdit("Change fill"));
  get("image-fit").addEventListener("change", () => { const id = currentSelection()[0]; if (id) { history.apply({ type: "node", id, value: { ...clone(layer(id)), fit: get("image-fit").value } }, "Change image fit"); edited(); } });
  for (const key of ["brightness", "contrast", "saturation"]) {
    get(key).addEventListener("input", () => {
      const id = currentSelection()[0], node = id && layer(id); if (!node) return;
      const value = Number(get(key).value); get(`${key}-value`).value = value.toFixed(2);
      previewNode(id, { appearance: { ...node.appearance, [key]: value } });
    });
    get(key).addEventListener("change", () => commitEdit(`Adjust ${key}`));
  }
  get("toggle-visibility").addEventListener("click", () => {
    const visible = layer(currentSelection()[0])?.visible === false; mutateMany("Visibility", (node) => ({ ...node, visible }));
  });
  get("toggle-lock").addEventListener("click", () => {
    const locked = !layer(currentSelection()[0])?.locked; mutateMany("Lock", (node) => ({ ...node, locked }));
  });
  get("delete").addEventListener("click", deleteSelected);
  document.querySelectorAll("#design-button").forEach((button) => button.addEventListener("click", showDesign));
  const resizeObserver = new ResizeObserver(() => drawCanvas()); resizeObserver.observe(get("stage"));
  window.addEventListener("tinystar:design-visibility", (event) => {
    if (event.detail?.visible) { renderWorkspace(); schedulePreview(0); }
    else { clearTimeout(previewTimer); previewEpoch += 1; previewTask?.cancel(); previewTask = null; }
  });
  window.addEventListener("tinystar:show-editor", () => { if (!root.hidden) root.hidden = true; });
  window.addEventListener("tinystar:show-presets", () => { root.hidden = true; });
  window.addEventListener("tinystar:show-results", () => { root.hidden = true; });
  window.addEventListener("tinystar:show-batch", () => { root.hidden = true; });
  window.addEventListener("tinystar:local-data-clearing", () => {
    clearTimeout(saveTimer); if (fileOwner) fileOwner.autoSave = false;
    setSaveStatus("Saved designs cleared · current design remains open");
  });
  window.addEventListener("beforeunload", () => { clearTimeout(previewTimer); previewTask?.cancel(); cancelDesignRecipeJob("Page closed."); previewBitmap?.close(); pool.setRetainedBytes("design-workspace", 0); pool.setRetainedBytes("design-recipe-job", 0); pool.setRetainedBytes("design-import", 0); });
  window.tinyImageStarDesign = {
    getSnapshot: () => {
      const project = renderProject();
      if (!project) return null;
      return { id: project.id, revision: project.revision, name: project.name, key: fileOwner?.key ?? null, savedRevision: fileOwner?.savedRevision ?? null, pageId: currentPage()?.id,
        pages: clone(project.slides), nodes: clone(project.nodes), assets: clone(project.assets), selection: currentSelection(), retainedSourceBytes: retainedSourceBytes(),
        recipeJob: recipeJob ? { total: recipeJob.total, completed: recipeJob.completed, active: recipeJob.active, paused: recipeJob.paused } : null };
    },
  };
  renderWorkspace();
  void refreshDesignFiles().then((files) => { if (!history && files[0]) void openDesign(files[0].key); }).catch(() => setSaveStatus("Local design storage is unavailable"));
}
