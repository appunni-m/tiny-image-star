import { createDesignView } from "./view.js";
import { addDesignPageCommand, addFrameAroundSelectionCommand, addShapeLayerCommand, addTextLayerCommand, addVectorLayerCommand, appendDesignImagesCommand, createDesignPageProject,
  createComponentCommand, createComponentInstanceCommand, detachComponentInstanceCommand, removeComponentDefinitionCommand, resetComponentOverridesCommand,
  addGridTrackCommand, deleteGridTrackCommand, deleteLayersCommand, gridTrackGroupBounds, moveGridTrackCommand, reorderGridTrackCommand, renameLayerCommand, setLayerLockedCommand, setLayerVisibilityCommand, snapshotPageSelection,
  reorderLayerCommand, resizeFrameChildren, resizeGridTrackCountCommand, setFrameLayoutCommand, setGridAlignmentCommand, setGridPlacementCommand,
  setLayoutPositioningCommand, updatePageSelection } from "../project/design-page.js";
import { canonicalJSON, clone, gridPlacementsForChildren, gridTrackDefinitions, newId, resolveGridTrackGeometry, resolveLayerFrames, resolveSlide } from "../project/model.js";
import { imagePlacement } from "../compositor/scene-spec.js";
import { ProjectHistory } from "../project/history.js";
import { listLocalPageProjects, readLocalPageProject, writeLocalPageProject } from "../project/storage.js";
import { getProcessingScheduler } from "../processing/client.js";
import { enqueueScene } from "../processing/scene-client.js";
import { importStoryPhotos } from "../story/assets.js";
import { openContextMenu } from "../context-menu.js";
import { designRecipePatch, designRecipeProblem } from "./recipes.js";
import { resizeSelection, rotateSelection, selectionBounds, zoomAtPoint } from "./geometry.js";
import { createVectorShape, updateVectorPrimitive } from "./vector-shapes.js";
import { deleteVectorPoint, insertVectorPoint, vectorSegmentPoint } from "./vector-path.js";

const DESIGN_IMPORT_LIMIT = 128 * 1024 * 1024;

export function attachDesignWorkspace() {
  const { root, get } = createDesignView(), pool = getProcessingScheduler();
  let history = null, pageId = null, selection = { ids: [], anchorId: null }, sources = new Map(), fileOwner = null;
  let saveTimer = null, openSequence = 0;
  let previewTask = null, previewTimer = null, previewEpoch = 0, previewBitmap = null, exportBusy = false, importing = false, recipeJob = null;
  let geometry = null, zoom = 1, panX = 0, panY = 0, drag = null, marquee = null, spaceDown = false, pinch = null, cropModeId = null;
  let penActive = false, pathDraft = null, vectorEditId = null, vectorPointSelection = null, vectorInsertMode = false;
  const touchPoints = new Map();
  let frameMapProject = null, frameMapPage = null, frameMap = null;
  let gridGeometryProject = null, gridGeometryPage = null, gridGeometryCache = new Map();
  const renderProject = () => history?.document ?? null;
  const currentPage = () => renderProject()?.slides.find((page) => page.id === pageId) ?? renderProject()?.slides[0] ?? null;
  const currentSelection = () => currentPage() ? snapshotPageSelection(selection, currentPage()) : [];
  const layer = (id) => renderProject()?.nodes[id] ?? null;
  function effectiveCrop(id) {
    const project = renderProject(), page = currentPage();
    return page?.overrides?.[id]?.crop ?? project?.nodes[id]?.crop ?? null;
  }
  function resolvedLayerMap() {
    const project = renderProject(), page = currentPage();
    if (!project || !page) return new Map();
    if (frameMapProject !== project || frameMapPage !== page.id) {
      frameMapProject = project; frameMapPage = page.id;
      frameMap = resolveLayerFrames(project, page.id, project.variants[0].id);
    }
    return frameMap;
  }
  function worldLayer(id) {
    const node = layer(id), resolved = resolvedLayerMap().get(id), project = renderProject();
    return node && resolved ? { ...clone(node), frame: clone(resolved.frame), rotation: resolved.rotation,
      visible: resolved.visible, locked: resolved.locked,
      layoutManaged: Boolean(node.parentId && node.layoutPositioning !== "absolute" && project.nodes[node.parentId]?.style?.layout) } : node ? clone(node) : null;
  }
  function storeWorldGeometry(id, world) {
    const node = layer(id), resolved = resolvedLayerMap().get(id), project = renderProject();
    if (!node || !resolved || !world?.frame) return null;
    const next = { ...clone(node), frame: clone(world.frame) };
    if (world.rotation != null) next.rotation = world.rotation;
    const variant = project.variants[0];
    const changedWidth = Math.abs(world.frame.width - resolved?.frame.width) > 1e-9;
    const changedHeight = Math.abs(world.frame.height - resolved?.frame.height) > 1e-9;
    if (node.layoutSizing || node.layoutSize) {
      next.layoutSizing = { width: "fixed", height: "fixed", ...node.layoutSizing };
      next.layoutSize = { width: node.layoutSize?.width ?? resolved.frame.width * variant.width,
        height: node.layoutSize?.height ?? resolved.frame.height * variant.height };
      if (changedWidth) { next.layoutSizing.width = "fixed"; next.layoutSize.width = world.frame.width * variant.width; }
      if (changedHeight) { next.layoutSizing.height = "fixed"; next.layoutSize.height = world.frame.height * variant.height; }
    }
    if (!node.parentId) return next;
    const parent = resolvedLayerMap().get(node.parentId);
    if (!resolved || !parent || parent.frame.width <= 0 || parent.frame.height <= 0) return null;
    const localWidth = world.frame.width / parent.frame.width, localHeight = world.frame.height / parent.frame.height;
    if (project.nodes[node.parentId]?.style?.layout && node.layoutPositioning !== "absolute") {
      next.frame = { ...clone(node.frame), width: localWidth, height: localHeight };
      next.rotation = (world.rotation ?? resolved.rotation) - parent.rotation;
      return next;
    }
    const centerX = (world.frame.x + world.frame.width / 2 - parent.frame.x - parent.frame.width / 2) * variant.width;
    const centerY = (world.frame.y + world.frame.height / 2 - parent.frame.y - parent.frame.height / 2) * variant.height;
    const angle = -parent.rotation * Math.PI / 180, localX = centerX * Math.cos(angle) - centerY * Math.sin(angle);
    const localY = centerX * Math.sin(angle) + centerY * Math.cos(angle);
    next.frame = { x: .5 + localX / (parent.frame.width * variant.width) - localWidth / 2,
      y: .5 + localY / (parent.frame.height * variant.height) - localHeight / 2, width: localWidth, height: localHeight };
    next.rotation = (world.rotation ?? resolved.rotation) - parent.rotation;
    if (!Number.isFinite(next.rotation)) next.rotation = 0;
    return next;
  }
  function topLevelSelection() {
    const ids = currentSelection(), selected = new Set(ids);
    return ids.filter((id) => {
      let parentId = layer(id)?.parentId;
      while (parentId) { if (selected.has(parentId)) return false; parentId = layer(parentId)?.parentId; }
      return true;
    });
  }
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

  function retainedSource(read, size) {
    let value = null, pending = null;
    return { size, load() {
      if (value) return Promise.resolve(value);
      if (!pending) pending = Promise.resolve().then(read).then((loaded) => {
        value = loaded; pending = null; return loaded;
      }, (error) => { pending = null; throw error; });
      return pending;
    } };
  }

  async function imageSource(id, sourceMap = sources) {
    const source = sourceMap.get(id);
    if (!source) throw new Error("An image layer has no retained local source. Reopen or re-add that image.");
    return typeof source.load === "function" ? source.load() : source;
  }

  function selectionChanged() {
    selection.ids = currentPage()?.nodeIds.filter((id) => selection.ids.includes(id)) ?? [];
    const exitedCropMode = Boolean(cropModeId && !selection.ids.includes(cropModeId));
    if (exitedCropMode) cropModeId = null;
    if (vectorEditId && (selection.ids.length !== 1 || !selection.ids.includes(vectorEditId))) {
      vectorEditId = null; vectorPointSelection = null; vectorInsertMode = false;
    }
    get("frame-selection").disabled = selection.ids.length < 2;
    renderLayers(); renderInspector(); drawCanvas();
    if (exitedCropMode) schedulePreview(0);
  }

  function renderPages() {
    const list = get("page-current"), project = renderProject();
    list.replaceChildren();
    if (!project) return;
    project.slides.forEach((page, index) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "design-page-current";
      button.textContent = page.name || `Page ${index + 1}`; button.setAttribute("aria-current", String(page.id === currentPage()?.id));
      button.addEventListener("click", () => { cropModeId = null; pathDraft = null; drag = null; vectorEditId = null; pageId = page.id; selection = { ids: [], anchorId: null }; renderWorkspace(); schedulePreview(0); });
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
      let depth = 0, parentId = node.parentId;
      while (parentId) { depth += 1; parentId = layer(parentId)?.parentId ?? null; }
      row.style.paddingInlineStart = `${8 + Math.min(depth, 12) * 14}px`;
      row.classList.toggle("selected", selection.ids.includes(id)); row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(selection.ids.includes(id))); row.dataset.layerId = id;
      const select = document.createElement("button"); select.type = "button"; select.className = "design-layer-select";
      const label = node.name || (node.kind === "image" ? project.assets[node.assetId]?.name : node.kind[0].toUpperCase() + node.kind.slice(1)) || "Layer";
      const componentMark = node.componentDefinition ? "◆ " : node.componentInstanceOf != null ? "◇ " : "";
      select.textContent = `${componentMark}${label}`;
      select.setAttribute("aria-label", `${node.componentDefinition ? "Component" : node.componentInstanceOf != null ? "Component instance" : node.kind}, ${label}`);
      select.title = select.textContent; select.addEventListener("click", (event) => {
        selection = updatePageSelection(selection, page.nodeIds, id, { toggle: event.metaKey || event.ctrlKey, extend: event.shiftKey });
        selectionChanged();
      });
      const eye = toggleButton(node.visible === false ? "◌" : "◉", node.visible !== false, () => mutateMany("Visibility", (current) => ({
        ...current, visible: current.visible === false,
      }), [id]), "design-layer-icon"); eye.setAttribute("aria-label", `${node.visible === false ? "Show" : "Hide"} ${select.textContent}`); eye.title = eye.getAttribute("aria-label");
      const parentLocked = Boolean(node.parentId && worldLayer(node.parentId)?.locked), effectiveLocked = Boolean(node.locked || parentLocked);
      const lock = toggleButton(effectiveLocked ? "▣" : "□", effectiveLocked, () => mutateMany("Lock", (current) => ({
        ...current, locked: !current.locked,
      }), [id]), "design-layer-icon"); lock.setAttribute("aria-label", `${node.locked ? "Unlock" : "Lock"} ${select.textContent}`); lock.title = lock.getAttribute("aria-label");
      lock.disabled = parentLocked;
      row.append(select, eye, lock);
      row.addEventListener("contextmenu", (event) => { event.preventDefault(); contextMenuForLayer(event, id); });
      select.addEventListener("keydown", (event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault(); const bounds = select.getBoundingClientRect();
        contextMenuForLayer({ clientX: bounds.left + bounds.width / 2, clientY: bounds.bottom, currentTarget: select }, id);
      });
      let longPressTimer = 0, longPressConsumed = false, longPressPoint = null;
      row.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch" || event.button !== 0) return;
        clearTimeout(longPressTimer); longPressConsumed = false;
        longPressPoint = { x: event.clientX, y: event.clientY };
        longPressTimer = setTimeout(() => {
          longPressTimer = 0; longPressConsumed = true;
          contextMenuForLayer({ clientX: longPressPoint.x, clientY: longPressPoint.y, currentTarget: row }, id);
          setTimeout(() => { longPressConsumed = false; }, 1000);
        }, 550);
      });
      row.addEventListener("pointermove", (event) => {
        if (!longPressTimer || !longPressPoint || Math.hypot(event.clientX - longPressPoint.x, event.clientY - longPressPoint.y) < 12) return;
        clearTimeout(longPressTimer); longPressTimer = 0;
      });
      for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) row.addEventListener(eventName, () => {
        clearTimeout(longPressTimer); longPressTimer = 0;
      });
      row.addEventListener("click", (event) => {
        if (!longPressConsumed) return;
        longPressConsumed = false; event.preventDefault(); event.stopPropagation();
      }, true);
      container.append(row);
    }
  }

  function setField(name, value) { get(name).value = String(value); }

  function renderGridTrackControls(axis, count, layout, locked) {
    const list = get(axis === "columns" ? "grid-column-tracks" : "grid-row-tracks");
    list.replaceChildren();
    const name = axis === "columns" ? "Column" : "Row", tracks = gridTrackDefinitions(layout, axis, count);
    tracks.forEach((track, index) => {
      const row = document.createElement("div"); row.className = "design-grid-track-row";
      const label = document.createElement("span"); label.textContent = `${name} ${index + 1}`; row.append(label);
      const modeField = document.createElement("label"); modeField.className = "design-field";
      const modeCaption = document.createElement("span"); modeCaption.textContent = "Sizing"; modeField.append(modeCaption);
      const mode = document.createElement("select"); mode.dataset.gridTrackAxis = axis; mode.dataset.gridTrackIndex = String(index);
      mode.dataset.gridTrackControl = "mode"; mode.setAttribute("aria-label", `${name} ${index + 1} sizing`);
      for (const [value, caption] of [["fill", "Fill"], ["fixed", "Fixed"], ["hug", "Hug"]]) {
        const option = document.createElement("option"); option.value = value; option.textContent = caption; mode.append(option);
      }
      mode.value = track.mode; modeField.append(mode); row.append(modeField);
      const valueField = document.createElement("label"); valueField.className = "design-field"; valueField.hidden = track.mode === "hug";
      const valueCaption = document.createElement("span"); valueCaption.textContent = track.mode === "fixed" ? "Size (px)" : "Fraction (fr)";
      valueField.append(valueCaption);
      const value = document.createElement("input"); value.type = "number"; value.inputMode = "decimal";
      value.min = track.mode === "fixed" ? "1" : "0.1"; value.max = track.mode === "fixed" ? "16384" : "1000";
      value.step = track.mode === "fixed" ? "1" : "0.1"; value.value = String(track.value ?? (track.mode === "fixed" ? 100 : 1));
      value.dataset.gridTrackAxis = axis; value.dataset.gridTrackIndex = String(index); value.dataset.gridTrackControl = "value";
      value.setAttribute("aria-label", `${name} ${index + 1} ${track.mode === "fixed" ? "size in pixels" : "fill fraction"}`);
      valueField.append(value); row.append(valueField);
      const unit = document.createElement("span"); unit.className = "design-grid-track-unit";
      unit.textContent = track.mode === "fixed" ? "px" : track.mode === "fill" ? "fr" : ""; row.append(unit);
      const actions = document.createElement("div"); actions.className = "design-grid-track-actions";
      for (const [action, glyph, label] of [["move-before", axis === "columns" ? "←" : "↑", "Move before"],
        ["move-after", axis === "columns" ? "→" : "↓", "Move after"], ["delete", "×", "Delete track and its contents"]]) {
        const button = document.createElement("button"); button.type = "button"; button.className = "button secondary design-grid-track-action";
        button.textContent = glyph; button.disabled = locked; button.dataset.gridTrackAction = action;
        button.dataset.gridTrackAxis = axis; button.dataset.gridTrackIndex = String(index);
        button.setAttribute("aria-label", `${name} ${index + 1}: ${label}`); button.title = `${name} ${index + 1}: ${label}`;
        actions.append(button);
      }
      row.append(actions);
      list.append(row);
    });
  }

  function syncVectorPointControls(node) {
    const path = node?.style?.path, editing = Boolean(path && vectorEditId === node.id);
    if (!editing || vectorPointSelection == null || vectorPointSelection >= (path?.points.length ?? 0)) vectorPointSelection = null;
    if (!editing) vectorInsertMode = false;
    const selectedPoint = vectorPointSelection == null ? null : path?.points[vectorPointSelection];
    const locked = !node || Boolean(worldLayer(node.id)?.locked), minimum = path?.closed ? 3 : 2;
    const add = get("vector-add-point"), remove = get("vector-delete-point");
    add.hidden = !editing; remove.hidden = !editing;
    add.disabled = locked || (path?.points.length ?? 0) >= 512;
    add.setAttribute("aria-pressed", String(vectorInsertMode));
    add.textContent = vectorInsertMode ? "Tap a segment…" : "Add point";
    remove.disabled = locked || vectorPointSelection == null || (path?.points.length ?? 0) <= minimum;
    const modeField = get("vector-handle-mode-field"), mode = get("vector-handle-mode");
    modeField.hidden = !editing || !selectedPoint || !(selectedPoint.handleIn || selectedPoint.handleOut);
    mode.disabled = locked; mode.value = selectedPoint?.handleMode ?? "corner";
    get("vector-point-status").textContent = !editing ? "" : vectorInsertMode ? "Tap close to a path segment to split it." : vectorPointSelection == null
      ? "Drag anchors or handles; select an anchor to remove it." : `Point ${vectorPointSelection + 1} selected.`;
  }

  function renderInspector() {
    const ids = currentSelection(), project = renderProject(), node = ids.length === 1 ? layer(ids[0]) : null;
    const multi = ids.length > 1;
    const vectorNode = node?.kind === "shape" && node.style?.shape === "path" ? node : null;
    get("vector-actions").hidden = !vectorNode;
    syncVectorPointControls(vectorNode);
    get("selection-count").textContent = `${ids.length} selected`;
    get("selection-summary").textContent = ids.length ? ids.length === 1 ? layer(ids[0])?.name ?? "1 layer selected" : `${ids.length} layers selected` : "Nothing selected";
    get("inspector-empty").hidden = Boolean(ids.length);
    get("inspector-content").hidden = !node;
    get("multi-inspector").hidden = !multi;
    if (!project) return;
    if (multi) {
      const nodes = ids.map((id) => layer(id)), values = nodes.map((entry) => entry ? Math.round((entry.opacity ?? 1) * 100) : null);
      const mixed = values.some((value) => value !== values[0]);
      const control = get("multi-opacity");
      get("multi-summary").textContent = `${ids.length} layers selected`;
      control.value = String(values[0] ?? 100);
      get("multi-opacity-value").value = mixed ? "Mixed" : `${values[0]}%`;
      control.setAttribute("aria-valuetext", mixed ? "Mixed opacity" : `${values[0]}%`);
      const editable = nodes.every((entry, index) => entry && ["image", "text", "shape", "frame"].includes(entry.kind)
        && !worldLayer(ids[index])?.locked);
      control.disabled = !editable;
      control.title = editable ? "" : "Unlock selected layers to change their opacity.";
      const size = pageSize(), geometryIds = topLevelSelection(), geometryNodes = geometryIds.map(worldLayer);
      const bounds = size && selectionBounds(geometryNodes, size);
      const geometryEditable = Boolean(bounds) && geometryNodes.every((entry) => entry && !entry.locked);
      const layoutManaged = geometryNodes.some((entry) => entry?.layoutManaged);
      for (const [field, key] of [["x", "x"], ["y", "y"], ["width", "width"], ["height", "height"]]) {
        const input = get(`multi-${field}`);
        if (bounds) input.value = bounds[key].toFixed(1);
        input.disabled = !geometryEditable || (layoutManaged && ["x", "y"].includes(key));
        input.title = layoutManaged && ["x", "y"].includes(key)
          ? "Auto Layout controls the selected layers' position." : geometryEditable ? "" : "Unlock selected layers to edit their geometry.";
      }
      return;
    }
    if (!node) return;
    const asset = node.assetId ? project.assets[node.assetId] : null;
    setField("layer-name", node.name || asset?.name || node.kind);
    const world = worldLayer(node.id) ?? node;
    const size = pageSize();
    for (const key of ["x", "y", "width", "height"]) {
      const dimension = ["x", "width"].includes(key) ? size?.width : size?.height;
      setField(key, ((world.frame?.[key] ?? 0) * (dimension ?? 100)).toFixed(1));
    }
    const textField = get("text-field"), colorField = get("color-field"), fitField = get("fit-field"), adjustments = get("image-adjustments");
    textField.hidden = node.kind !== "text"; colorField.hidden = !["shape", "text", "frame"].includes(node.kind);
    get("edit-vector").textContent = vectorEditId === node.id ? "Done editing path" : "Edit path points";
    get("edit-vector").setAttribute("aria-pressed", String(vectorEditId === node.id));
    get("edit-vector").disabled = Boolean(world.locked);
    const primitive = node.kind === "shape" ? node.style?.primitive : null;
    get("vector-primitive").hidden = !primitive;
    if (primitive) {
      get("vector-count-label").textContent = primitive.type === "star" ? "Points" : "Sides";
      get("vector-count").value = String(primitive.sides);
      get("vector-inner-radius-field").hidden = primitive.type !== "star";
      if (primitive.type === "star") {
        get("vector-inner-radius").value = String(primitive.innerRadius);
        get("vector-inner-radius-value").value = `${Math.round(primitive.innerRadius * 100)}%`;
      }
    }
    fitField.hidden = node.kind !== "image"; adjustments.hidden = node.kind !== "image";
    get("frame-clip-field").hidden = node.kind !== "frame";
    get("frame-radius-field").hidden = node.kind !== "frame";
    get("frame-layout-field").hidden = node.kind !== "frame";
    get("frame-layout-options").hidden = node.kind !== "frame" || !node.style?.layout;
    const parentLayout = node.parentId ? project.nodes[node.parentId]?.style?.layout : null;
    const parentHasLayout = Boolean(parentLayout), parentHasGrid = parentLayout?.direction === "grid";
    get("layout-positioning-field").hidden = !parentHasLayout;
    get("layout-positioning").value = node.layoutPositioning ?? "auto";
    const canHug = node.kind === "frame" && Boolean(node.style?.layout);
    get("resizing-options").hidden = !parentHasLayout && !canHug;
    get("layout-min-max").hidden = !parentHasLayout;
    for (const axis of ["width", "height"]) {
      const control = get(`layout-sizing-${axis}`);
      control.value = node.layoutSizing?.[axis] ?? "fixed";
      control.querySelector('option[value="hug"]').disabled = !canHug;
      control.querySelector('option[value="fill"]').disabled = !parentHasLayout;
    }
    for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"]) {
      const control = get(`layout-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
      control.value = node.layoutMinMax?.[key] ?? "";
      control.disabled = Boolean(world.locked);
    }
    get("constraints-field").hidden = !node.parentId || world.layoutManaged;
    get("grid-placement").hidden = !parentHasGrid || node.layoutPositioning === "absolute";
    get("grid-alignment").hidden = !parentHasGrid || node.layoutPositioning === "absolute";
    if (parentHasGrid && node.layoutPositioning !== "absolute") {
      const parent = project.nodes[node.parentId], parentChildren = currentPage().nodeIds.filter((id) => project.nodes[id]?.parentId === parent.id
        && project.nodes[id]?.visible !== false);
      const placement = gridPlacementsForChildren(parentChildren, project.nodes, parent.style.layout).placements.get(node.id);
      for (const [field, key] of [["grid-row", "row"], ["grid-column", "column"], ["grid-row-span", "rowSpan"], ["grid-column-span", "columnSpan"]])
        get(field).value = String(placement[key]);
      get("grid-column").max = String(parent.style.layout.columns);
      get("grid-column-span").max = String(parent.style.layout.columns);
      get("grid-row").max = String(parent.style.layout.rows || 200);
      get("grid-row-span").max = String(parent.style.layout.rows || 200);
      get("grid-align-horizontal").value = node.gridAlignment?.horizontal ?? "auto";
      get("grid-align-vertical").value = node.gridAlignment?.vertical ?? "auto";
    }
    get("x").title = world.layoutManaged ? "Auto Layout controls this child's X position." : "";
    get("y").title = world.layoutManaged ? "Auto Layout controls this child's Y position." : "";
    const opacity = Math.round((node.opacity ?? 1) * 100);
    get("opacity").value = String(opacity); get("opacity-value").value = `${opacity}%`;
    if (node.kind === "text") get("text").value = node.text ?? "";
    if (["shape", "text", "frame"].includes(node.kind)) get("color").value = node.color ?? (node.kind === "frame" ? "#ffffff" : "#5149d5");
    if (node.kind === "frame") {
      get("frame-clip").checked = node.style?.clipContent !== false;
      const radius = node.style?.radius ?? 0; get("frame-radius").value = String(radius);
      get("frame-radius-value").value = `${Math.round(radius * 100)}%`;
      const layout = node.style?.layout; get("frame-layout").value = layout?.direction ?? "manual";
      get("frame-layout-options").hidden = !layout;
      get("grid-tracks").hidden = layout?.direction !== "grid";
      get("layout-gap-field").hidden = layout?.direction === "grid";
      get("layout-wrap-field").hidden = layout?.direction === "grid";
      get("layout-gap").value = String(layout?.gap ?? 0);
      get("layout-row-gap").value = String(layout?.rowGap ?? layout?.gap ?? 0);
      get("layout-column-gap").value = String(layout?.columnGap ?? layout?.gap ?? 0);
      get("layout-wrap").checked = Boolean(layout?.wrap);
      get("layout-columns").value = String(layout?.columns ?? 2);
      get("layout-rows").value = String(layout?.rows ?? 0);
      for (const edge of ["left", "right", "top", "bottom"]) get(`layout-padding-${edge}`).value = String(layout?.padding?.[edge] ?? 0);
      get("layout-justify").value = layout?.justify ?? "start"; get("layout-align").value = layout?.align ?? "center";
      get("layout-justify").querySelector('option[value="space-between"]').disabled = layout?.direction === "grid";
      for (const value of ["space-around", "space-evenly"])
        get("layout-justify").querySelector(`option[value="${value}"]`).disabled = layout?.direction === "grid";
      get("layout-justify").querySelector('option[value="stretch"]').disabled = layout?.direction !== "grid";
      if (layout?.direction === "grid") {
        const children = currentPage().nodeIds.filter((id) => project.nodes[id]?.parentId === node.id && project.nodes[id]?.visible !== false);
        const { rows } = gridPlacementsForChildren(children, project.nodes, layout);
        const locked = Boolean(worldLayer(node.id)?.locked);
        renderGridTrackControls("columns", layout.columns, layout, locked);
        renderGridTrackControls("rows", rows, layout, locked);
        get("grid-add-column").disabled = locked || layout.columns >= 24;
        get("grid-add-row").disabled = locked || (layout.rows || rows) >= 24;
      } else {
        get("grid-column-tracks").replaceChildren(); get("grid-row-tracks").replaceChildren();
        get("grid-add-column").disabled = true; get("grid-add-row").disabled = true;
      }
    }
    if (node.parentId) {
      get("constraint-horizontal").value = node.constraints?.horizontal ?? "left";
      get("constraint-vertical").value = node.constraints?.vertical ?? "top";
    }
    if (node.kind === "image") {
      get("image-fit").value = node.fit ?? "contain";
      get("crop-tool").setAttribute("aria-pressed", String(cropModeId === node.id));
      get("crop-tool").textContent = cropModeId === node.id ? "Done cropping" : "Crop image";
      get("crop-reset").disabled = !effectiveCrop(node.id);
      get("flip-x").setAttribute("aria-pressed", String(Boolean(node.flipX)));
      get("flip-y").setAttribute("aria-pressed", String(Boolean(node.flipY)));
      for (const key of ["brightness", "contrast", "saturation"]) {
        const value = node.appearance?.[key] ?? 1;
        get(key).value = String(value); get(`${key}-value`).value = Number(value).toFixed(2);
      }
    }
    const isLocked = Boolean(world.locked);
    get("crop-tool").disabled = node.kind !== "image" || isLocked;
    get("crop-reset").disabled = node.kind !== "image" || isLocked || !effectiveCrop(node.id);
    for (const control of root.querySelectorAll("#design-inspector-content input, #design-inspector-content textarea, #design-inspector-content select")) control.disabled = isLocked;
    if (world.layoutManaged) { get("x").disabled = true; get("y").disabled = true; }
    get("toggle-visibility").textContent = node.visible === false ? "Show" : "Hide";
    get("toggle-lock").textContent = isLocked ? "Unlock" : "Lock";
    get("delete").disabled = false;
  }

  function renderWorkspace() {
    const project = renderProject();
    get("add-pen").disabled = !currentPage() || (currentPage()?.nodeIds.length ?? 0) >= 200;
    get("add-pen").setAttribute("aria-pressed", String(penActive));
    if (!project) {
      if (document.activeElement !== get("document-name")) get("document-name").value = "Untitled design";
      get("add-text").disabled = true;
      get("shape-type").disabled = true; get("add-shape").disabled = true; get("add-pen").disabled = true; get("export").disabled = true; get("undo").disabled = true; get("redo").disabled = true;
      get("fit").disabled = true; get("zoom-in").disabled = true; get("zoom-out").disabled = true; get("zoom-label").textContent = "100%";
      get("empty-state").hidden = false; get("page-title").textContent = "Page 1";
      get("layer-list").replaceChildren(); get("layer-count").textContent = "0"; renderInspector(); drawCanvas();
      return;
    }
    if (!project.slides.some((page) => page.id === pageId)) pageId = project.slides[0]?.id ?? null;
    if (document.activeElement !== get("document-name")) get("document-name").value = project.name;
    get("add-text").disabled = !currentPage() || currentPage().nodeIds.length >= 200;
    get("shape-type").disabled = get("add-text").disabled;
    get("add-shape").disabled = get("add-text").disabled;
    get("add-pen").disabled = get("add-text").disabled;
    get("frame-selection").disabled = currentSelection().length < 2 || currentSelection().length > 200;
    get("export").disabled = !currentPage() || exportBusy || importing;
    get("undo").disabled = !history.past.length; get("redo").disabled = !history.future.length;
    get("fit").disabled = !currentPage(); get("zoom-in").disabled = !currentPage(); get("zoom-out").disabled = !currentPage();
    get("empty-state").hidden = Boolean(currentPage()?.nodeIds.length);
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
    vectorPointSelection = null; vectorInsertMode = false;
    if (!renderProject().slides.some((page) => page.id === pageId)) pageId = renderProject().slides[0]?.id ?? null;
    selectionChanged(); edited(direction === "undo" ? "Undid edit." : "Redid edit.");
  }

  function formatGeometry(node) {
    const variant = renderProject().variants[0], rect = resolvedLayerMap().get(node.id)?.frame ?? node.frame;
    const scale = geometry?.scale ?? 1, canvas = get("canvas");
    const rectView = { x: geometry?.x + rect.x * variant.width * scale, y: geometry?.y + rect.y * variant.height * scale,
      width: rect.width * variant.width * scale, height: rect.height * variant.height * scale };
    return { ...rectView, right: rectView.x + rectView.width, bottom: rectView.y + rectView.height, canvas };
  }

  function pageSize() {
    const variant = renderProject()?.variants[0];
    return variant ? { width: variant.width, height: variant.height } : null;
  }

  function editableSelection() {
    return topLevelSelection().map((id) => worldLayer(id)).filter((node) => node && node.locked !== true && node.visible !== false && !node.layoutManaged && node.frame);
  }

  function selectionViewBounds(nodes = editableSelection()) {
    const size = pageSize(), bounds = size && selectionBounds(nodes, size);
    if (!bounds || !geometry) return null;
    const x = geometry.x + bounds.x * geometry.scale, y = geometry.y + bounds.y * geometry.scale;
    const width = bounds.width * geometry.scale, height = bounds.height * geometry.scale;
    return { x, y, width, height, right: x + width, bottom: y + height, centerX: x + width / 2, centerY: y + height / 2, bounds, size };
  }

  function transformHandleAt(point) {
    const bounds = selectionViewBounds();
    if (!bounds || bounds.width < 10 || bounds.height < 10) return null;
    const centerX = bounds.centerX, centerY = bounds.centerY;
    const candidates = [
      ["nw", bounds.x, bounds.y], ["n", centerX, bounds.y], ["ne", bounds.right, bounds.y],
      ["e", bounds.right, centerY], ["se", bounds.right, bounds.bottom], ["s", centerX, bounds.bottom],
      ["sw", bounds.x, bounds.bottom], ["w", bounds.x, centerY],
    ];
    const hitRadius = Math.max(8, Math.min(14, 10 / Math.max(.5, window.devicePixelRatio || 1)));
    const hit = candidates.find(([, x, y]) => Math.hypot(point.x - x, point.y - y) <= hitRadius);
    if (hit) return hit[0];
    if (Math.hypot(point.x - centerX, point.y - (bounds.y - 24)) <= hitRadius + 2) return "rotate";
    return null;
  }

  function setCanvasZoom(nextZoom, point = { x: get("canvas").clientWidth / 2, y: get("canvas").clientHeight / 2 }) {
    if (!geometry || !Number.isFinite(nextZoom)) return;
    const boundedZoom = Math.max(.1, Math.min(8, nextZoom));
    const next = zoomAtPoint({ zoom, nextZoom: boundedZoom, panX, panY, point, geometry });
    zoom = next.zoom; panX = next.panX; panY = next.panY; drawCanvas();
  }

  function fitCanvas() { zoom = 1; panX = 0; panY = 0; drawCanvas(); }

  function captureCanvasPointer(event) {
    try { get("canvas").setPointerCapture(event.pointerId); }
    catch (error) { if (event.isTrusted) throw error; }
  }

  function fitGeometry() {
    const canvas = get("canvas"), page = currentPage(), project = renderProject();
    if (!page || !project || !canvas.clientWidth || !canvas.clientHeight) { geometry = null; return; }
    const variant = project.variants[0], margin = 40;
    const scale = Math.min((canvas.clientWidth - margin * 2) / variant.width, (canvas.clientHeight - margin * 2) / variant.height) * zoom;
    const x = (canvas.clientWidth - variant.width * scale) / 2 + panX, y = (canvas.clientHeight - variant.height * scale) / 2 + panY;
    geometry = { x, y, scale, width: variant.width, height: variant.height, viewportWidth: canvas.clientWidth, viewportHeight: canvas.clientHeight };
    get("zoom-label").textContent = `${Math.round(scale / Math.min((canvas.clientWidth - margin * 2) / variant.width,
      (canvas.clientHeight - margin * 2) / variant.height) * 100)}%`;
  }

  function screenForPage(point) {
    return geometry ? { x: geometry.x + point.x * geometry.scale, y: geometry.y + point.y * geometry.scale } : null;
  }

  function selectedGridFrameId() {
    if (cropModeId || penActive || vectorEditId) return null;
    const ids = currentSelection();
    if (ids.length !== 1) return null;
    const node = layer(ids[0]);
    return node?.kind === "frame" && node.style?.layout?.direction === "grid" ? node.id : null;
  }

  function gridGeometryFor(frameId = selectedGridFrameId()) {
    const project = renderProject(), page = currentPage();
    if (!project || !page || !frameId) return null;
    if (gridGeometryProject !== project || gridGeometryPage !== page.id) {
      gridGeometryProject = project; gridGeometryPage = page.id; gridGeometryCache = new Map();
    }
    if (!gridGeometryCache.has(frameId)) gridGeometryCache.set(frameId,
      resolveGridTrackGeometry(project, page.id, frameId, project.variants[0].id));
    return gridGeometryCache.get(frameId);
  }

  function framePointOnCanvas(frameId, x, y) {
    const node = worldLayer(frameId), frame = node?.frame, size = pageSize();
    if (!frame || !size || !geometry) return null;
    const centerX = (frame.x + frame.width / 2) * size.width, centerY = (frame.y + frame.height / 2) * size.height;
    const localX = x - frame.width * size.width / 2, localY = y - frame.height * size.height / 2;
    const angle = (node.rotation ?? 0) * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
    return screenForPage({ x: centerX + localX * cosine - localY * sine, y: centerY + localX * sine + localY * cosine });
  }

  function gridLocalPoint(frameId, point) {
    const node = worldLayer(frameId), frame = node?.frame, size = pageSize(), world = pagePoint(point);
    if (!frame || !size || !world) return null;
    const centerX = (frame.x + frame.width / 2) * size.width, centerY = (frame.y + frame.height / 2) * size.height;
    const dx = world.x - centerX, dy = world.y - centerY, angle = -(node.rotation ?? 0) * Math.PI / 180;
    return { x: centerX + dx * Math.cos(angle) - dy * Math.sin(angle) - frame.x * size.width,
      y: centerY + dx * Math.sin(angle) + dy * Math.cos(angle) - frame.y * size.height };
  }

  function gridTrackHit(point) {
    const frameId = selectedGridFrameId(), canvasGeometry = gridGeometryFor(frameId), node = frameId && worldLayer(frameId);
    if (!canvasGeometry || node?.locked || !geometry) return null;
    const local = gridLocalPoint(frameId, point), threshold = 15 / geometry.scale;
    if (!local) return null;
    let nearest = null;
    for (const [axis, tracks] of [["columns", canvasGeometry.columns], ["rows", canvasGeometry.rows]]) {
      for (const track of tracks.slice(0, -1)) {
        const boundary = track.end;
        const along = axis === "columns" ? local.y : local.x;
        const crossStart = axis === "columns" ? canvasGeometry.padding.top : canvasGeometry.padding.left;
        const crossEnd = axis === "columns" ? canvasGeometry.height - canvasGeometry.padding.bottom : canvasGeometry.width - canvasGeometry.padding.right;
        const distance = Math.abs((axis === "columns" ? local.x : local.y) - boundary) * geometry.scale;
        if (along < crossStart - threshold || along > crossEnd + threshold || distance > 15) continue;
        if (!nearest || distance < nearest.distance) nearest = { frameId, axis, index: track.index, distance };
      }
    }
    return nearest;
  }

  function gridTrackGripPosition(metrics, axis, track) {
    return axis === "columns"
      ? { x: track.start + track.size / 2, y: Math.min(metrics.height / 2, Math.max(8, metrics.padding.top / 2)) }
      : { x: Math.min(metrics.width / 2, Math.max(8, metrics.padding.left / 2)), y: track.start + track.size / 2 };
  }

  function gridTrackReorderHit(point) {
    const frameId = selectedGridFrameId(), metrics = gridGeometryFor(frameId), node = frameId && worldLayer(frameId);
    if (!metrics || node?.locked || !geometry) return null;
    const local = gridLocalPoint(frameId, point);
    if (!local) return null;
    let nearest = null;
    for (const [axis, tracks] of [["columns", metrics.columns], ["rows", metrics.rows]]) {
      if (tracks.length < 2) continue;
      for (const track of tracks) {
        const grip = gridTrackGripPosition(metrics, axis, track);
        const dx = Math.abs(local.x - grip.x) * geometry.scale, dy = Math.abs(local.y - grip.y) * geometry.scale;
        if (dx > 20 || dy > 18) continue;
        const distance = Math.hypot(dx, dy);
        if (!nearest || distance < nearest.distance) nearest = { frameId, axis, index: track.index, distance };
      }
    }
    return nearest;
  }

  function gridTrackInsertionIndex(metrics, axis, coordinate) {
    const tracks = metrics[axis];
    for (const track of tracks) if (coordinate < track.start + track.size / 2) return track.index;
    return tracks.length;
  }

  function drawGridTrackOverlay(ctx) {
    const frameId = selectedGridFrameId(), metrics = gridGeometryFor(frameId);
    if (!frameId || !metrics) return;
    const node = worldLayer(frameId), angle = (node?.rotation ?? 0) * Math.PI / 180;
    ctx.save(); ctx.lineWidth = 1;
    for (const [axis, tracks] of [["columns", metrics.columns], ["rows", metrics.rows]]) {
      for (const track of tracks.slice(0, -1)) {
        const start = axis === "columns" ? framePointOnCanvas(frameId, track.end, metrics.padding.top)
          : framePointOnCanvas(frameId, metrics.padding.left, track.end);
        const end = axis === "columns" ? framePointOnCanvas(frameId, track.end, metrics.height - metrics.padding.bottom)
          : framePointOnCanvas(frameId, metrics.width - metrics.padding.right, track.end);
        if (!start || !end) continue;
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = "rgba(45, 126, 247, .65)"; ctx.stroke();
        const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        ctx.save(); ctx.translate(center.x, center.y); ctx.rotate(angle);
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#2d7ef7"; ctx.lineWidth = 1.5;
        const width = axis === "columns" ? 8 : 28, height = axis === "columns" ? 28 : 8;
        ctx.beginPath(); ctx.roundRect(-width / 2, -height / 2, width, height, 4); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      if (tracks.length > 1) for (const track of tracks) {
        const point = gridTrackGripPosition(metrics, axis, track), screen = framePointOnCanvas(frameId, point.x, point.y);
        if (!screen) continue;
        ctx.save(); ctx.translate(screen.x, screen.y); ctx.rotate(angle);
        const width = axis === "columns" ? 28 : 12, height = axis === "columns" ? 12 : 28;
        ctx.fillStyle = "#fff"; ctx.strokeStyle = "#2d7ef7"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(-width / 2, -height / 2, width, height, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#2d7ef7";
        for (const offset of [-3, 0, 3]) {
          ctx.beginPath();
          if (axis === "columns") ctx.arc(offset, 0, 1, 0, Math.PI * 2);
          else ctx.arc(0, offset, 1, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function beginGridTrackResize(hit, point, pointerId) {
    const node = hit && layer(hit.frameId), metrics = hit && gridGeometryFor(hit.frameId), track = metrics?.[hit.axis]?.[hit.index];
    if (!node || !track || worldLayer(hit.frameId)?.locked) return false;
    drag = { kind: "grid-track", pointerId, frameId: hit.frameId, axis: hit.axis, index: hit.index,
      node: clone(node), metrics, track: clone(track), start: gridLocalPoint(hit.frameId, point), moved: false };
    return true;
  }

  function beginGridTrackReorder(hit, point, pointerId) {
    const project = renderProject(), page = currentPage(), metrics = hit && gridGeometryFor(hit.frameId);
    if (!project || !page || !metrics || worldLayer(hit.frameId)?.locked) return false;
    const group = gridTrackGroupBounds(project, page.id, hit.frameId, hit.axis, hit.index), start = gridLocalPoint(hit.frameId, point);
    if (!start) return false;
    drag = { kind: "grid-reorder", pointerId, frameId: hit.frameId, axis: hit.axis, index: hit.index, group,
      project, metrics, start, moved: false, previewActive: false };
    return true;
  }

  function cancelGridTrackReorder(current, message) {
    history.cancel(); current.previewActive = false; current.moved = false;
    renderWorkspace(); schedulePreview(0); setStatus(message);
  }

  function previewGridTrackReorder(current, point) {
    const local = gridLocalPoint(current.frameId, point);
    if (!local || !current.start) return;
    const coordinate = current.axis === "columns" ? local.x : local.y;
    const startCoordinate = current.axis === "columns" ? current.start.x : current.start.y;
    if (Math.abs(coordinate - startCoordinate) * geometry.scale < 8) return;
    const insertionIndex = gridTrackInsertionIndex(current.metrics, current.axis, coordinate);
    if (insertionIndex >= current.group.first && insertionIndex <= current.group.last + 1) {
      if (current.previewActive) cancelGridTrackReorder(current, "Grid track order restored.");
      return;
    }
    try {
      const command = reorderGridTrackCommand(current.project, currentPage().id, current.frameId, current.axis, current.index, insertionIndex);
      const before = history.document;
      history.preview(command);
      if (history.document !== before) {
        current.previewActive = true; current.moved = true;
        edited(`Reordering ${current.axis === "columns" ? "column" : "row"} track…`, { previewOnly: true });
      }
    } catch (error) {
      cancelGridTrackReorder(current, error.message);
    }
  }

  function previewGridTrackResize(current, point) {
    const local = gridLocalPoint(current.frameId, point);
    if (!local || !current.start) return;
    const coordinate = current.axis === "columns" ? local.x : local.y;
    const startCoordinate = current.axis === "columns" ? current.start.x : current.start.y;
    if (Math.abs(coordinate - startCoordinate) * geometry.scale < 1) return;
    const rawSize = coordinate - current.track.start;
    const value = Math.max(.01, Math.min(16384, Math.round(rawSize * 100) / 100));
    const layout = clone(current.node.style.layout), key = current.axis === "columns" ? "columnTracks" : "rowTracks";
    const count = current.axis === "columns" ? layout.columns : current.metrics.rows.length;
    const tracks = gridTrackDefinitions(layout, current.axis, count).map(clone);
    tracks[current.index] = { mode: "fixed", value };
    layout[key] = tracks;
    history.preview({ type: "node", id: current.frameId, value: { ...clone(current.node), style: { ...current.node.style, layout } } });
    current.moved = true;
    edited(`Resizing ${current.axis === "columns" ? "column" : "row"} track…`, { previewOnly: true });
  }

  function vectorPointOnCanvas(node, point) {
    const frame = worldLayer(node.id)?.frame, size = pageSize();
    if (!frame || !size || !geometry) return null;
    const center = { x: (frame.x + frame.width / 2) * size.width, y: (frame.y + frame.height / 2) * size.height };
    const local = { x: (point.x - .5) * frame.width * size.width, y: (point.y - .5) * frame.height * size.height };
    const angle = (worldLayer(node.id)?.rotation ?? node.rotation ?? 0) * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
    return screenForPage({ x: center.x + local.x * cosine - local.y * sine, y: center.y + local.x * sine + local.y * cosine });
  }

  function drawVectorEditOverlay(ctx) {
    const node = vectorEditId && layer(vectorEditId), path = node?.style?.path;
    if (!node || !path || node.visible === false) return;
    ctx.save(); ctx.lineWidth = 1.25;
    for (const [index, point] of path.points.entries()) {
      const anchor = vectorPointOnCanvas(node, point);
      if (!anchor) continue;
      for (const key of ["handleIn", "handleOut"]) if (point[key]) {
        const handle = vectorPointOnCanvas(node, point[key]);
        ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(handle.x, handle.y); ctx.strokeStyle = "#3182ce"; ctx.stroke();
        ctx.beginPath(); ctx.arc(handle.x, handle.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 5.5, 0, Math.PI * 2);
      const selected = vectorEditId === node.id && vectorPointSelection === index;
      ctx.fillStyle = selected ? "#ffd36b" : "#fff"; ctx.fill();
      ctx.strokeStyle = selected ? "#7a4b00" : "#e04f5f"; ctx.stroke();
    }
    ctx.restore();
  }

  function drawPathDraftOverlay(ctx) {
    if (!pathDraft?.points.length) return;
    const points = pathDraft.points.map(screenForPage).filter(Boolean);
    const screenHandle = (point) => point && screenForPage(point);
    const segment = (from, to, start, end) => {
      const control1 = screenHandle(from.handleOut), control2 = screenHandle(to?.handleIn);
      if (control1 || control2) ctx.bezierCurveTo(control1?.x ?? start.x, control1?.y ?? start.y, control2?.x ?? end.x, control2?.y ?? end.y, end.x, end.y);
      else ctx.lineTo(end.x, end.y);
    };
    ctx.save(); ctx.beginPath(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "#5149d5"; ctx.lineWidth = 2;
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) segment(pathDraft.points[index - 1], pathDraft.points[index], points[index - 1], points[index]);
    const cursor = pathDraft.cursor && screenForPage(pathDraft.cursor);
    if (cursor) segment(pathDraft.points.at(-1), null, points.at(-1), cursor);
    if (cursor && points.length >= 3 && Math.hypot(points[0].x - cursor.x, points[0].y - cursor.y) < 12) {
      ctx.lineTo(points[0].x, points[0].y);
    }
    ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#5149d5"; ctx.lineWidth = 2;
    for (const point of points) { ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
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
      if (id === cropModeId) continue;
      const world = worldLayer(id); if (!world?.frame || world.visible === false) continue;
      const rect = formatGeometry(layer(id));
      if (world.rotation) {
        ctx.save(); ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
        ctx.rotate(world.rotation * Math.PI / 180); ctx.strokeRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height); ctx.restore();
      } else ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }
    const selectedBounds = cropModeId ? null : selectionViewBounds();
    if (selectedBounds && selectedBounds.width > 14 && selectedBounds.height > 14) {
      const { x, y, width: boxWidth, height: boxHeight, right, bottom, centerX } = selectedBounds;
      ctx.save(); ctx.strokeStyle = "#2d7ef7"; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, boxWidth, boxHeight);
      ctx.beginPath(); ctx.moveTo(centerX, y - 5); ctx.lineTo(centerX, y - 19); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#2d7ef7"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(centerX, y - 24, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#2d7ef7"; ctx.lineWidth = 1.5;
      const handles = [[x, y], [centerX, y], [right, y], [right, y + boxHeight / 2], [right, bottom], [centerX, bottom],
        [x, bottom], [x, y + boxHeight / 2]];
      for (const [hx, hy] of handles) { ctx.fillRect(hx - 4, hy - 4, 8, 8); ctx.strokeRect(hx - 4, hy - 4, 8, 8); }
      ctx.restore();
    }
    drawGridTrackOverlay(ctx);
    if (cropModeId) drawCropOverlay(ctx, cropGeometryFor(cropModeId));
    drawVectorEditOverlay(ctx); drawPathDraftOverlay(ctx);
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

  function finishPathDraft(closed = false) {
    const draft = pathDraft, size = pageSize();
    if (!draft || !size) return false;
    const points = draft.points;
    if (points.length < (closed ? 3 : 2)) { pathDraft = null; drag = null; drawCanvas(); setStatus("Add at least two points before finishing a path."); return false; }
    const extents = points.flatMap((point) => [point, point.handleIn, point.handleOut].filter(Boolean));
    const margin = 8, left = Math.min(...extents.map((point) => point.x)) - margin, top = Math.min(...extents.map((point) => point.y)) - margin;
    const width = Math.max(1, Math.max(...extents.map((point) => point.x)) - left + margin);
    const height = Math.max(1, Math.max(...extents.map((point) => point.y)) - top + margin);
    const frame = { x: left / size.width, y: top / size.height, width: width / size.width, height: height / size.height };
    const local = (point) => ({ x: (point.x - left) / width, y: (point.y - top) / height });
    const path = { closed, points: points.map((point) => ({ ...local(point),
      ...(point.handleIn ? { handleIn: local(point.handleIn) } : {}), ...(point.handleOut ? { handleOut: local(point.handleOut) } : {}) })) };
    pathDraft = null; drag = null;
    try {
      const command = addVectorLayerCommand(history.document, currentPage().id, { frame, path, name: closed ? "Vector" : "Path" });
      history.apply(command, closed ? "Draw vector" : "Draw path");
      const id = command.commands[0].id; selection = { ids: [id], anchorId: id };
      edited(closed ? "Vector added. Select it and edit its points." : "Path added. Select it and edit its points.");
      return true;
    } catch (error) { drawCanvas(); setStatus(error.message); return false; }
  }

  function togglePen() {
    if (!currentPage()) return;
    if (penActive) {
      if (pathDraft) finishPathDraft(false);
      penActive = false; renderWorkspace(); setStatus("Pen tool off."); return;
    }
    const leftCropMode = Boolean(cropModeId);
    cropModeId = null; vectorEditId = null; penActive = true;
    renderWorkspace(); if (leftCropMode) schedulePreview(0); get("canvas").focus();
    setStatus("Pen active · tap or click to add points, drag an anchor for a curve, then close the path or press Enter.");
    drawCanvas();
  }

  function addPenAnchor(point, event) {
    const position = pagePoint(point), size = pageSize();
    if (!position || !size || position.x < 0 || position.y < 0 || position.x > size.width || position.y > size.height) return;
    if (!pathDraft) pathDraft = { points: [], cursor: position };
    const first = pathDraft.points[0], firstScreen = first && screenForPage(first);
    if (pathDraft.points.length >= 3 && firstScreen && Math.hypot(firstScreen.x - point.x, firstScreen.y - point.y) <= 12) {
      finishPathDraft(true); event.preventDefault(); return;
    }
    if (pathDraft.points.length >= 512) { setStatus("A vector path can contain up to 512 points."); return; }
    const index = pathDraft.points.push({ x: position.x, y: position.y }) - 1;
    pathDraft.cursor = position;
    drag = { kind: "path-anchor", pointerId: event.pointerId, start: position, index, moved: false };
    captureCanvasPointer(event); drawCanvas(); event.preventDefault();
  }

  function localVectorPoint(node, point) {
    const frame = worldLayer(node.id)?.frame, size = pageSize(), world = pagePoint(point);
    if (!frame || !size || !world) return null;
    const center = { x: (frame.x + frame.width / 2) * size.width, y: (frame.y + frame.height / 2) * size.height };
    const dx = world.x - center.x, dy = world.y - center.y, angle = (worldLayer(node.id)?.rotation ?? node.rotation ?? 0) * Math.PI / 180;
    const localX = center.x + dx * Math.cos(angle) + dy * Math.sin(angle);
    const localY = center.y - dx * Math.sin(angle) + dy * Math.cos(angle);
    return { x: (localX / size.width - frame.x) / frame.width, y: (localY / size.height - frame.y) / frame.height };
  }

  function vectorEditTarget(point) {
    const node = vectorEditId && layer(vectorEditId), path = node?.style?.path;
    if (!node || !path) return null;
    let nearest = null;
    const consider = (index, key, position) => {
      if (!position) return;
      const distance = Math.hypot(position.x - point.x, position.y - point.y);
      const radius = key === "anchor" ? 14 : 12;
      if (distance > radius) return;
      if (!nearest || distance < nearest.distance - .01
        || Math.abs(distance - nearest.distance) <= .01 && key === "anchor" && nearest.key !== "anchor") nearest = { index, key, distance };
    };
    for (const [index, entry] of path.points.entries()) {
      for (const key of ["handleIn", "handleOut"]) if (entry[key]) {
        consider(index, key, vectorPointOnCanvas(node, entry[key]));
      }
      consider(index, "anchor", vectorPointOnCanvas(node, entry));
    }
    return nearest && { index: nearest.index, key: nearest.key };
  }

  function vectorSegmentTarget(node, point) {
    const path = node?.style?.path;
    if (!path || path.points.length < 2) return null;
    const segmentCount = path.closed ? path.points.length : path.points.length - 1;
    let nearest = null;
    for (let index = 0; index < segmentCount; index++) {
      const distanceAt = (t) => {
        const screen = vectorPointOnCanvas(node, vectorSegmentPoint(path, index, t));
        return screen ? (screen.x - point.x) ** 2 + (screen.y - point.y) ** 2 : Infinity;
      };
      const samples = 40;
      let bestT = 0, bestDistance = distanceAt(0);
      for (let sample = 1; sample <= samples; sample++) {
        const t = sample / samples, distance = distanceAt(t);
        if (distance < bestDistance) { bestT = t; bestDistance = distance; }
      }
      let left = Math.max(0, bestT - 1 / samples), right = Math.min(1, bestT + 1 / samples);
      for (let iteration = 0; iteration < 12; iteration++) {
        const first = left + (right - left) / 3, second = right - (right - left) / 3;
        if (distanceAt(first) <= distanceAt(second)) right = second; else left = first;
      }
      const t = (left + right) / 2, distance = Math.min(bestDistance, distanceAt(t));
      if (!nearest || distance < nearest.distance) nearest = { index, t, distance };
    }
    return nearest && nearest.distance <= 26 ** 2
      ? { index: nearest.index, t: Math.max(.02, Math.min(.98, nearest.t)) } : null;
  }

  function addVectorPoint(node, segment) {
    if (!node || !segment || worldLayer(node.id)?.locked) return false;
    try {
      const style = clone(node.style); style.path = insertVectorPoint(style.path, segment.index, segment.t); delete style.primitive;
      history.apply({ type: "node", id: node.id, value: { ...clone(node), style } }, "Insert vector point");
      vectorPointSelection = segment.index + 1; vectorInsertMode = false;
      edited("Vector point added."); return true;
    } catch (error) { setStatus(error.message); return false; }
  }

  function removeSelectedVectorPoint() {
    const node = vectorEditId && layer(vectorEditId), index = vectorPointSelection;
    if (!node?.style?.path || index == null || worldLayer(node.id)?.locked) return false;
    try {
      const style = clone(node.style); style.path = deleteVectorPoint(style.path, index); delete style.primitive;
      history.apply({ type: "node", id: node.id, value: { ...clone(node), style } }, "Delete vector point");
      vectorPointSelection = Math.min(index, style.path.points.length - 1); vectorInsertMode = false;
      edited("Vector point deleted."); return true;
    } catch (error) { setStatus(error.message); return false; }
  }

  function updateVectorPoint(point) {
    const node = layer(drag?.id), local = node && localVectorPoint(node, point);
    if (!node || !local || !drag?.path) return;
    if (Math.hypot(point.x - drag.startScreen.x, point.y - drag.startScreen.y) < 1) return;
    const path = clone(drag.path), target = path.points[drag.index];
    if (drag.key === "anchor") {
      const x = Math.max(0, Math.min(1, local.x)), y = Math.max(0, Math.min(1, local.y)), dx = x - target.x, dy = y - target.y;
      target.x = x; target.y = y;
      for (const key of ["handleIn", "handleOut"]) if (target[key]) target[key] = {
        x: Math.max(-4, Math.min(5, target[key].x + dx)), y: Math.max(-4, Math.min(5, target[key].y + dy)),
      };
    } else {
      const next = { x: Math.max(-4, Math.min(5, local.x)), y: Math.max(-4, Math.min(5, local.y)) };
      target[drag.key] = next;
      if (target.handleMode === "smooth" || target.handleMode === "mirrored") {
        const oppositeKey = drag.key === "handleIn" ? "handleOut" : "handleIn", opposite = target[oppositeKey];
        const dx = next.x - target.x, dy = next.y - target.y, length = Math.hypot(dx, dy);
        if (length > 1e-8) {
          const oppositeLength = target.handleMode === "mirrored" || !opposite ? length : Math.hypot(opposite.x - target.x, opposite.y - target.y);
          target[oppositeKey] = { x: Math.max(-4, Math.min(5, target.x - dx / length * oppositeLength)),
            y: Math.max(-4, Math.min(5, target.y - dy / length * oppositeLength)) };
        }
      }
    }
    drag.moved = true;
    try {
      const style = { ...clone(node.style), path }; delete style.primitive;
      history.preview({ type: "node", id: node.id, value: { ...clone(node), style } }); edited("Editing vector points…", { previewOnly: true });
    }
    catch (error) { setStatus(error.message); }
  }

  function previewVectorPrimitive(patch) {
    const id = currentSelection()[0], node = id && layer(id);
    if (!node?.style?.primitive || worldLayer(id)?.locked) return;
    try {
      const value = updateVectorPrimitive(node, patch);
      history.preview({ type: "node", id, value }); edited("Adjusting vector geometry…", { previewOnly: true });
    } catch (error) { setStatus(error.message); }
  }

  function cropIsFull(crop) {
    return !crop || Math.abs(crop.x) < 1e-9 && Math.abs(crop.y) < 1e-9
      && Math.abs(crop.width - 1) < 1e-9 && Math.abs(crop.height - 1) < 1e-9;
  }

  function cropGeometryFor(id) {
    const project = renderProject(), page = currentPage(), node = project?.nodes[id], asset = node && project.assets[node.assetId];
    if (!project || !page || node?.kind !== "image" || !asset || !geometry) return null;
    const variant = project.variants[0];
    const resolved = resolveSlide(project, page.id, variant.id).nodes.find((entry) => entry.id === id);
    if (!resolved?.viewport) return null;
    const fullSource = { ...resolved, crop: null, fit: "contain" };
    const placement = imagePlacement(fullSource, asset.width, asset.height), [a, b, c, d, e, f] = placement.matrix;
    const determinant = a * e - b * d;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
    const sourceToCanvas = (source) => {
      const dx = source.x - c, dy = source.y - f;
      const viewportX = (e * dx - b * dy) / determinant, viewportY = (-d * dx + a * dy) / determinant;
      return { x: geometry.x + viewportX * geometry.scale, y: geometry.y + viewportY * geometry.scale };
    };
    const canvasToSource = (point) => {
      const pagePointValue = pagePoint(point);
      if (!pagePointValue) return null;
      const viewportX = pagePointValue.x;
      const viewportY = pagePointValue.y;
      return { x: a * viewportX + b * viewportY + c, y: d * viewportX + e * viewportY + f };
    };
    const crop = resolved.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const polygon = (value) => [
      { x: value.x * asset.width, y: value.y * asset.height },
      { x: (value.x + value.width) * asset.width, y: value.y * asset.height },
      { x: (value.x + value.width) * asset.width, y: (value.y + value.height) * asset.height },
      { x: value.x * asset.width, y: (value.y + value.height) * asset.height },
    ].map(sourceToCanvas);
    return { asset, crop, fullPolygon: polygon({ x: 0, y: 0, width: 1, height: 1 }), cropPolygon: polygon(crop),
      sourceToCanvas, canvasToSource, normalizePoint: (point) => {
        const source = canvasToSource(point);
        return source ? { x: Math.max(0, Math.min(1, source.x / asset.width)), y: Math.max(0, Math.min(1, source.y / asset.height)) } : null;
      } };
  }

  function cropHandlePoints(cropGeometry) {
    const crop = cropGeometry.crop, left = crop.x, right = crop.x + crop.width, top = crop.y, bottom = crop.y + crop.height;
    return [
      ["nw", left, top], ["n", (left + right) / 2, top], ["ne", right, top], ["e", right, (top + bottom) / 2],
      ["se", right, bottom], ["s", (left + right) / 2, bottom], ["sw", left, bottom], ["w", left, (top + bottom) / 2],
    ].map(([handle, x, y]) => ({ handle, ...cropGeometry.sourceToCanvas({ x: x * cropGeometry.asset.width, y: y * cropGeometry.asset.height }) }));
  }

  function drawCropOverlay(ctx, cropGeometry) {
    if (!cropGeometry) return;
    const { fullPolygon, cropPolygon } = cropGeometry;
    const path = (points) => { ctx.moveTo(points[0].x, points[0].y); for (const point of points.slice(1)) ctx.lineTo(point.x, point.y); ctx.closePath(); };
    ctx.save();
    ctx.beginPath(); path(fullPolygon); path(cropPolygon);
    ctx.fillStyle = "rgba(7, 13, 24, .52)"; ctx.fill("evenodd");
    ctx.beginPath(); path(cropPolygon); ctx.strokeStyle = "#b7f36d"; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = "rgba(183, 243, 109, .62)"; ctx.lineWidth = 1;
    for (const fraction of [1 / 3, 2 / 3]) {
      const mix = (from, to) => ({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction });
      const top = mix(cropPolygon[0], cropPolygon[1]), bottom = mix(cropPolygon[3], cropPolygon[2]);
      const left = mix(cropPolygon[0], cropPolygon[3]), right = mix(cropPolygon[1], cropPolygon[2]);
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bottom.x, bottom.y); ctx.moveTo(left.x, left.y); ctx.lineTo(right.x, right.y); ctx.stroke();
    }
    for (const handle of cropHandlePoints(cropGeometry)) {
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#26333f"; ctx.lineWidth = 1.5;
      ctx.fillRect(handle.x - 5, handle.y - 5, 10, 10); ctx.strokeRect(handle.x - 5, handle.y - 5, 10, 10);
    }
    ctx.restore();
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function cropHandleAt(point, cropGeometry) {
    if (!cropGeometry) return null;
    const hit = cropHandlePoints(cropGeometry).find((handle) => Math.hypot(point.x - handle.x, point.y - handle.y) <= 22);
    return hit?.handle ?? null;
  }

  function cropCommand(id, crop) {
    const project = renderProject(), node = layer(id);
    if (!project || node?.kind !== "image") throw new Error("Choose an image layer to crop.");
    const value = { ...clone(node) };
    if (cropIsFull(crop)) delete value.crop;
    else value.crop = clone(crop);
    const slides = project.slides.map((slide) => {
      if (!slide.overrides?.[id] || !Object.hasOwn(slide.overrides[id], "crop")) return clone(slide);
      const overrides = clone(slide.overrides), override = { ...overrides[id] };
      delete override.crop;
      if (Object.keys(override).length) overrides[id] = override; else delete overrides[id];
      return { ...clone(slide), overrides };
    });
    return { type: "group", commands: [{ type: "node", id, value }, { type: "slides", value: slides }] };
  }

  function cropForPointerDrag(current, point) {
    const next = current.mapping.normalizePoint(point);
    if (!next) return current.baseCrop;
    const base = current.baseCrop, minimumWidth = 1 / current.mapping.asset.width, minimumHeight = 1 / current.mapping.asset.height;
    if (current.cropKind === "create") {
      const left = Math.min(current.start.x, next.x), top = Math.min(current.start.y, next.y);
      return { x: Math.min(1 - minimumWidth, left), y: Math.min(1 - minimumHeight, top),
        width: Math.max(minimumWidth, Math.min(1 - left, Math.abs(next.x - current.start.x))),
        height: Math.max(minimumHeight, Math.min(1 - top, Math.abs(next.y - current.start.y))) };
    }
    if (current.cropKind === "move") {
      const x = Math.max(0, Math.min(1 - base.width, base.x + next.x - current.start.x));
      const y = Math.max(0, Math.min(1 - base.height, base.y + next.y - current.start.y));
      return { ...base, x, y };
    }
    let left = base.x, right = base.x + base.width, top = base.y, bottom = base.y + base.height;
    if (current.handle.includes("w")) left = Math.max(0, Math.min(right - minimumWidth, next.x));
    if (current.handle.includes("e")) right = Math.min(1, Math.max(left + minimumWidth, next.x));
    if (current.handle.includes("n")) top = Math.max(0, Math.min(bottom - minimumHeight, next.y));
    if (current.handle.includes("s")) bottom = Math.min(1, Math.max(top + minimumHeight, next.y));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function startCropInteraction(point, pointerId) {
    const cropGeometry = cropGeometryFor(cropModeId), node = layer(cropModeId);
    if (!cropGeometry || !node || worldLayer(cropModeId)?.locked) return false;
    const handle = cropHandleAt(point, cropGeometry);
    if (!handle && !pointInPolygon(point, cropGeometry.fullPolygon)) return false;
    const crop = { ...cropGeometry.crop };
    const existing = !cropIsFull(node.crop ?? cropGeometry.crop), insideCrop = pointInPolygon(point, cropGeometry.cropPolygon);
    const cropKind = handle ? "resize" : existing && insideCrop ? "move" : "create";
    const start = cropGeometry.normalizePoint(point);
    if (!start) return false;
    drag = { kind: "crop", cropKind, handle, pointerId, mapping: cropGeometry, baseCrop: crop, start, moved: false };
    return true;
  }

  function toggleCropMode() {
    const id = currentSelection()[0], node = id && layer(id);
    if (cropModeId === id) {
      if (history?.base) commitEdit("Crop image");
      cropModeId = null; renderWorkspace(); schedulePreview(0); setStatus("Crop mode closed."); return;
    }
    if (node?.kind !== "image" || worldLayer(id)?.locked) return;
    if (history?.base) commitEdit("Edit image");
    penActive = false; pathDraft = null; vectorEditId = null;
    cropModeId = id; selection = { ids: [id], anchorId: id };
    renderWorkspace(); schedulePreview(0);
    setStatus(!cropIsFull(effectiveCrop(id)) ? "Crop mode · drag a handle to resize, or drag inside the crop to move it."
      : "Crop mode · drag over the image to create a crop, then drag inside it to move it.");
  }

  function resetImageCrop() {
    const id = currentSelection()[0], node = id && layer(id);
    if (!node || node.kind !== "image" || !effectiveCrop(id)) return;
    try { history.apply(cropCommand(id, null), "Reset image crop"); edited("Image crop reset."); }
    catch (error) { setStatus(error.message); }
  }

  function hitTest(point) {
    const page = currentPage(); if (!page || !geometry) return null;
    const local = pagePoint(point); if (!local || local.x < 0 || local.y < 0 || local.x > geometry.width || local.y > geometry.height) return null;
    const insideFrame = (x, y, frame, rotation = 0) => {
      const centerX = frame.x + frame.width / 2, centerY = frame.y + frame.height / 2;
      const angle = -rotation * Math.PI / 180, dx = x - centerX, dy = y - centerY;
      const localX = centerX + dx * Math.cos(angle) - dy * Math.sin(angle), localY = centerY + dx * Math.sin(angle) + dy * Math.cos(angle);
      return localX >= frame.x && localX <= frame.x + frame.width && localY >= frame.y && localY <= frame.y + frame.height;
    };
    return [...page.nodeIds].reverse().find((id) => {
      const resolved = resolvedLayerMap().get(id), frame = resolved?.frame;
      if (!frame || resolved.visible === false) return false;
      const x = local.x, y = local.y;
      if (!insideFrame(x, y, { x: frame.x * geometry.width, y: frame.y * geometry.height,
        width: frame.width * geometry.width, height: frame.height * geometry.height }, resolved?.rotation ?? 0)) return false;
      return (resolved?.clipFrames ?? []).every((clip) => insideFrame(x, y, clip.frame, clip.rotation));
    }) ?? null;
  }

  function beginResizeOrRotate(kind, handle, point, pointerId) {
    const nodes = editableSelection().map((node) => clone(node)), size = pageSize(), bounds = selectionBounds(nodes, size);
    if (!nodes.length || !bounds || bounds.width < 1 || bounds.height < 1) return false;
    const start = pagePoint(point), center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    drag = { kind, handle, pointerId, nodes, ids: nodes.map((node) => node.id), size, bounds, start, center,
      startAngle: Math.atan2(start.y - center.y, start.x - center.x), moved: false };
    return true;
  }

  function resizeBoundsForPointer(current, point, preserveRatio) {
    const { bounds, handle, start } = current;
    const hx = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
    const hy = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
    const minWidth = Math.min(bounds.width, 4), minHeight = Math.min(bounds.height, 4);
    let left = bounds.x, top = bounds.y, right = bounds.x + bounds.width, bottom = bounds.y + bounds.height;
    if (hx < 0) left = Math.min(right - minWidth, Math.max(bounds.x - bounds.width * 99, bounds.x + point.x - start.x));
    if (hx > 0) right = Math.max(left + minWidth, Math.min(bounds.x + bounds.width * 100, bounds.x + bounds.width + point.x - start.x));
    if (hy < 0) top = Math.min(bottom - minHeight, Math.max(bounds.y - bounds.height * 99, bounds.y + point.y - start.y));
    if (hy > 0) bottom = Math.max(top + minHeight, Math.min(bounds.y + bounds.height * 100, bounds.y + bounds.height + point.y - start.y));
    if (preserveRatio) {
      const widthRatio = (right - left) / bounds.width, heightRatio = (bottom - top) / bounds.height;
      const ratio = hx && hy ? (Math.abs(widthRatio - 1) >= Math.abs(heightRatio - 1) ? widthRatio : heightRatio)
        : hx ? widthRatio : heightRatio;
      const width = Math.max(minWidth, bounds.width * ratio), height = Math.max(minHeight, bounds.height * ratio);
      left = hx > 0 ? bounds.x : hx < 0 ? bounds.x + bounds.width - width : bounds.x + (bounds.width - width) / 2;
      right = left + width; top = hy > 0 ? bounds.y : hy < 0 ? bounds.y + bounds.height - height : bounds.y + (bounds.height - height) / 2;
      bottom = top + height;
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function previewCanvasTransform(current, point, event) {
    const page = currentPage();
    if (current.kind === "resize") {
      const world = pagePoint(point), nextBounds = resizeBoundsForPointer(current, world, event.shiftKey);
      const updates = resizeSelection(current.nodes, current.bounds, nextBounds, current.size), commands = [];
      for (const updated of updates) {
        const stored = storeWorldGeometry(updated.id, updated); if (!stored) continue;
        commands.push({ type: "node", id: stored.id, value: stored });
        const original = layer(stored.id);
        if (stored.kind === "frame" && (Math.abs(stored.frame.width - original.frame.width) > 1e-8 || Math.abs(stored.frame.height - original.frame.height) > 1e-8))
          commands.push(...resizeFrameChildren(renderProject(), page.id, stored.id, stored.frame));
      }
      history.preview({ type: "group", commands });
      edited("Resizing selection…", { previewOnly: true }); return;
    }
    const world = pagePoint(point), angle = Math.atan2(world.y - current.center.y, world.x - current.center.x);
    let delta = (angle - current.startAngle) * 180 / Math.PI;
    if (event.shiftKey) delta = Math.round(delta / 15) * 15;
    const updates = rotateSelection(current.nodes, current.center, delta, current.size), commands = updates.map((node) => {
      const stored = storeWorldGeometry(node.id, node); return stored ? { type: "node", id: stored.id, value: stored } : null;
    }).filter(Boolean);
    history.preview({ type: "group", commands });
    edited("Rotating selection…", { previewOnly: true });
  }

  function startPinch() {
    const points = [...touchPoints.values()];
    if (points.length < 2) return;
    if (drag?.moved && ["layers", "resize", "rotate", "crop", "grid-track", "grid-reorder"].includes(drag.kind)) {
      commitEdit(drag.kind === "layers" ? "Move layers" : drag.kind === "resize" ? "Resize selection" : drag.kind === "rotate" ? "Rotate selection"
        : drag.kind === "grid-track" ? "Resize grid track" : drag.kind === "grid-reorder" ? "Reorder grid track" : "Crop image");
    }
    drag = null; marquee = null;
    const first = points[0], second = points[1], center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const world = pagePoint(center);
    pinch = { distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)), zoom, center, world,
      baseScale: geometry?.scale / zoom, pageWidth: geometry?.width, pageHeight: geometry?.height,
      viewportWidth: geometry?.viewportWidth, viewportHeight: geometry?.viewportHeight };
  }

  function updatePinch() {
    const points = [...touchPoints.values()];
    if (!pinch || points.length < 2 || !pinch.world || !pinch.baseScale) return;
    const [first, second] = points, center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
    const nextZoom = Math.max(.1, Math.min(8, pinch.zoom * distance / pinch.distance));
    const scale = pinch.baseScale * nextZoom;
    const baseX = (pinch.viewportWidth - pinch.pageWidth * scale) / 2, baseY = (pinch.viewportHeight - pinch.pageHeight * scale) / 2;
    zoom = nextZoom; panX = center.x - baseX - pinch.world.x * scale; panY = center.y - baseY - pinch.world.y * scale;
    drawCanvas();
  }

  function canvasPointerDown(event) {
    if (!currentPage()) return;
    const point = pointerPoint(event), id = hitTest(point);
    if (event.pointerType === "touch") {
      touchPoints.set(event.pointerId, point); captureCanvasPointer(event);
      if (touchPoints.size >= 2) { startPinch(); event.preventDefault(); return; }
    }
    if (event.button === 1 || (event.button === 0 && spaceDown && event.pointerType !== "touch")) {
      drag = { kind: "pan", pointerId: event.pointerId, start: point, panX, panY, moved: false };
      captureCanvasPointer(event); event.preventDefault(); return;
    }
    if (event.button !== 0) return;
    if (vectorEditId) {
      const target = vectorEditTarget(point), node = layer(vectorEditId);
      if (target && node && !worldLayer(node.id)?.locked) {
        vectorPointSelection = target.index;
        vectorInsertMode = false; syncVectorPointControls(node); drawCanvas();
        drag = { kind: "vector-point", pointerId: event.pointerId, id: node.id, index: target.index, key: target.key,
          path: clone(node.style.path), startScreen: point, moved: false };
        captureCanvasPointer(event); event.preventDefault(); return;
      }
      if (vectorInsertMode && node && !worldLayer(node.id)?.locked) {
        const segment = vectorSegmentTarget(node, point);
        if (segment) addVectorPoint(node, segment);
        else setStatus("Tap close to a path segment to add a point.");
        event.preventDefault(); return;
      }
    }
    if (penActive) {
      if (event.detail > 1 && pathDraft?.points.length >= 2) { finishPathDraft(false); event.preventDefault(); return; }
      addPenAnchor(point, event); return;
    }
    if (cropModeId) {
      if (startCropInteraction(point, event.pointerId)) {
        captureCanvasPointer(event); event.preventDefault();
      }
      return;
    }
    const gridReorder = gridTrackReorderHit(point);
    if (gridReorder && beginGridTrackReorder(gridReorder, point, event.pointerId)) {
      captureCanvasPointer(event); event.preventDefault(); return;
    }
    const gridTrack = gridTrackHit(point);
    if (gridTrack && beginGridTrackResize(gridTrack, point, event.pointerId)) {
      captureCanvasPointer(event); event.preventDefault(); return;
    }
    const handle = transformHandleAt(point);
    if (handle && beginResizeOrRotate(handle === "rotate" ? "rotate" : "resize", handle, point, event.pointerId)) {
      captureCanvasPointer(event); event.preventDefault(); return;
    }
    if (id) {
      if (event.shiftKey || event.metaKey || event.ctrlKey) selection = updatePageSelection(selection, currentPage().nodeIds, id,
        { extend: event.shiftKey, toggle: event.metaKey || event.ctrlKey });
      else if (!selection.ids.includes(id)) selection = updatePageSelection(null, currentPage().nodeIds, id);
      selectionChanged();
      const selected = topLevelSelection().filter((selectedId) => !worldLayer(selectedId)?.locked && !worldLayer(selectedId)?.layoutManaged);
      const world = pagePoint(point);
      drag = { kind: "layers", pointerId: event.pointerId, start: world, ids: selected,
        frames: Object.fromEntries(selected.map((selectedId) => [selectedId, clone(worldLayer(selectedId).frame)])), moved: false };
    } else {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey) selection = { ids: [], anchorId: null };
      drag = { kind: "marquee", pointerId: event.pointerId, start: point, extend: event.shiftKey || event.metaKey || event.ctrlKey, moved: false };
      selectionChanged();
    }
    captureCanvasPointer(event); event.preventDefault();
  }

  function canvasPointerMove(event) {
    const point = pointerPoint(event);
    if (touchPoints.has(event.pointerId)) { touchPoints.set(event.pointerId, point); if (pinch) { updatePinch(); return; } }
    if (!drag || drag.pointerId !== event.pointerId) {
      if (penActive && pathDraft) { pathDraft.cursor = pagePoint(point); drawCanvas(); }
      if (event.pointerType !== "touch" && event.buttons === 0) {
        const reorderHandle = !cropModeId && gridTrackReorderHit(point), gridHandle = !cropModeId && gridTrackHit(point);
        const handle = cropModeId ? cropHandleAt(point, cropGeometryFor(cropModeId)) : transformHandleAt(point), canvas = get("canvas");
        canvas.style.cursor = reorderHandle ? "grab" : gridHandle ? gridHandle.axis === "columns" ? "col-resize" : "row-resize" : penActive ? "crosshair" : cropModeId ? handle ? ({ n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
          ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" })[handle] : "crosshair" : handle === "rotate" ? "grab" : handle ? ({ n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
          ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" })[handle] : hitTest(point) ? "move" : "default";
      }
      return;
    }
    if (drag.kind === "path-anchor") {
      const world = pagePoint(point), anchor = pathDraft?.points[drag.index];
      if (!world || !anchor) return;
      const dx = world.x - drag.start.x, dy = world.y - drag.start.y;
      if (Math.hypot(dx, dy) * geometry.scale < 2) return;
      anchor.handleOut = { x: anchor.x + dx, y: anchor.y + dy };
      anchor.handleIn = { x: anchor.x - dx, y: anchor.y - dy };
      pathDraft.cursor = world; drag.moved = true; drawCanvas();
    } else if (drag.kind === "vector-point") updateVectorPoint(point);
    else if (drag.kind === "crop") {
      const sourceStart = drag.mapping.sourceToCanvas({ x: drag.start.x * drag.mapping.asset.width, y: drag.start.y * drag.mapping.asset.height });
      if (Math.hypot(point.x - sourceStart.x, point.y - sourceStart.y) < 1) return;
      drag.moved = true;
      try { history.preview(cropCommand(cropModeId, cropForPointerDrag(drag, point))); edited("Cropping image…", { previewOnly: true }); }
      catch (error) { setStatus(error.message); }
    } else if (drag.kind === "layers") {
      const world = pagePoint(point), dx = world.x - drag.start.x, dy = world.y - drag.start.y;
      if (Math.abs(dx) * geometry.scale + Math.abs(dy) * geometry.scale < 1) return;
      drag.moved = true;
      history.preview({ type: "group", commands: drag.ids.map((id) => {
        const world = { ...worldLayer(id), frame: { ...drag.frames[id], x: drag.frames[id].x + dx / geometry.width, y: drag.frames[id].y + dy / geometry.height } };
        const stored = storeWorldGeometry(id, world); return { type: "node", id, value: stored };
      }) });
      edited("Moving selection…", { previewOnly: true });
    } else if (drag.kind === "resize" || drag.kind === "rotate") {
      const world = pagePoint(point);
      if (Math.hypot(world.x - drag.start.x, world.y - drag.start.y) * geometry.scale < 1) return;
      drag.moved = true; previewCanvasTransform(drag, point, event);
    } else if (drag.kind === "grid-track") {
      previewGridTrackResize(drag, point);
    } else if (drag.kind === "grid-reorder") {
      previewGridTrackReorder(drag, point);
    } else if (drag.kind === "pan") {
      const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
      if (Math.hypot(dx, dy) < 1) return;
      drag.moved = true; panX = drag.panX + dx; panY = drag.panY + dy; drawCanvas();
    } else {
      drag.moved = true;
      marquee = { x: Math.min(drag.start.x, point.x), y: Math.min(drag.start.y, point.y), width: Math.abs(point.x - drag.start.x), height: Math.abs(point.y - drag.start.y) };
      drawCanvas();
    }
  }

  function canvasPointerUp(event) {
    const wasPinching = Boolean(pinch);
    if (touchPoints.has(event.pointerId)) {
      touchPoints.delete(event.pointerId);
      if (wasPinching) { if (touchPoints.size < 2) { pinch = null; drag = null; } return; }
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "path-anchor") { drag = null; drawCanvas(); return; }
    if (drag.kind === "crop" && drag.moved) commitEdit("Crop image");
    if (drag.kind === "grid-track" && drag.moved) commitEdit("Resize grid track");
    if (drag.kind === "grid-reorder" && drag.moved) commitEdit("Reorder grid track");
    if (drag.kind === "layers" && drag.moved) commitEdit("Move layers");
    if (drag.kind === "resize" && drag.moved) commitEdit("Resize selection");
    if (drag.kind === "rotate" && drag.moved) commitEdit("Rotate selection");
    if (drag.kind === "vector-point" && drag.moved) commitEdit("Edit vector point");
    if (drag.kind === "marquee" && drag.moved && geometry) {
      const bounds = marquee, hits = currentPage().nodeIds.filter((id) => {
        const resolved = resolvedLayerMap().get(id), frame = resolved?.frame; if (!frame || resolved.visible === false) return false;
        const rect = formatGeometry(layer(id));
        return rect.x < bounds.x + bounds.width && rect.right > bounds.x && rect.y < bounds.y + bounds.height && rect.bottom > bounds.y;
      });
      if (drag.extend) selection = { ids: [...new Set([...selection.ids, ...hits])].filter((id) => currentPage().nodeIds.includes(id)), anchorId: selection.anchorId };
      else selection = { ids: hits, anchorId: hits[0] ?? null };
    }
    marquee = null; drag = null; selectionChanged();
  }

  function canvasPointerCancel(event) {
    if (drag?.pointerId === event.pointerId && drag.kind === "path-anchor") {
      touchPoints.delete(event.pointerId);
      pathDraft?.points.splice(drag.index, 1); drag = null; drawCanvas(); setStatus("Pen point cancelled."); return;
    }
    if (drag?.pointerId === event.pointerId && ["layers", "resize", "rotate", "crop", "grid-track", "grid-reorder", "vector-point"].includes(drag.kind) && drag.moved) {
      touchPoints.delete(event.pointerId);
      if (touchPoints.size < 2) pinch = null;
      history.cancel(); drag = null; marquee = null; selectionChanged(); edited("Edit cancelled."); return;
    }
    canvasPointerUp(event);
  }

  function schedulePreview(delay = 90) {
    clearTimeout(previewTimer); previewTask?.cancel(); previewTask = null;
    if (root.hidden || !history || !currentPage()) return;
    const epoch = ++previewEpoch, project = clone(history.document), selectedPage = currentPage().id, sourceSnapshot = sources;
    if (cropModeId && project.nodes[cropModeId]?.kind === "image") {
      project.nodes[cropModeId] = { ...project.nodes[cropModeId], crop: null, fit: "contain" };
      for (const page of project.slides) {
        if (!page.overrides?.[cropModeId] || !Object.hasOwn(page.overrides[cropModeId], "crop")) continue;
        const overrides = clone(page.overrides), patch = { ...overrides[cropModeId] };
        delete patch.crop;
        if (Object.keys(patch).length) overrides[cropModeId] = patch; else delete overrides[cropModeId];
        page.overrides = overrides;
      }
    }
    previewTimer = setTimeout(async () => {
      let nextTask;
      try {
        nextTask = enqueueScene({ project, slideId: selectedPage, variantId: project.variants[0].id, preview: true, previewEdge: 1280,
          readAsset: async (id) => imageSource(id, sourceSnapshot), priority: 0, pool }); previewTask = nextTask;
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
    history.apply(reorderLayerCommand(renderProject(), page.id, nodeId, front ? ids.length : 0),
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
        if (!job.sources.has(id)) throw new Error("An original image is no longer available for this recipe job.");
        return imageSource(id, job.sources);
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
    const frameItems = ids.length > 1 ? [{ type: "separator" }, { label: "Frame selection", disabled: Boolean(recipeJob), action: frameSelection }] : [];
    const instanceRootId = componentInstanceRootId(id), instanceRoot = instanceRootId && layer(instanceRootId);
    const instanceMembers = instanceRootId && currentPage()?.nodeIds.filter((nodeId) => componentInstanceRootId(nodeId) === instanceRootId) || [];
    const hasInstanceOverrides = instanceMembers.some((nodeId) => (layer(nodeId)?.componentOverrides ?? [])
      .some((path) => !(nodeId === instanceRootId && ["frame.x", "frame.y"].includes(path))));
    const componentItems = node?.componentDefinition ? [
      { type: "separator" }, { type: "heading", label: "Component" },
      { label: "Create instance", disabled: Boolean(recipeJob), action: () => createComponentInstance(id) },
      { label: "Remove component status", disabled: componentHasInstances(id), action: () => removeComponentStatus(id) },
    ] : instanceRoot ? [
      { type: "separator" }, { type: "heading", label: "Component instance" },
      { label: "Reset overrides", disabled: !hasInstanceOverrides || Boolean(recipeJob), action: () => resetComponentInstance(instanceRootId) },
      { label: "Detach instance", disabled: Boolean(recipeJob), action: () => detachComponentInstance(instanceRootId) },
    ] : !ids.some((selectedId) => layer(selectedId)?.componentDefinition || layer(selectedId)?.componentInstanceOf != null
      || layer(selectedId)?.componentSourceNodeId != null || componentDefinitionRootId(selectedId)) ? [
      { type: "separator" }, { label: ids.length === 1 ? "Create component" : "Create component from selection", disabled: Boolean(recipeJob), action: createComponent },
    ] : [];
    const recipeItems = node?.kind === "image" ? [
      { type: "separator" },
      { type: "heading", label: `${imageIds.length} image layer${imageIds.length === 1 ? "" : "s"} selected` },
      { label: "Save this image as recipe…", disabled: Boolean(recipeJob), action: () => {
        const asset = renderProject().assets[node.assetId], bridge = window.tinyImageStarBatch;
        if (!bridge?.openDesignImageRecipe) { setStatus("The recipe library is still opening. Try again shortly."); return; }
        bridge.openDesignImageRecipe({ name: node.name || asset.name, appearance: clone(node.appearance ?? {}), crop: clone(node.crop ?? null),
          flipX: Boolean(node.flipX), flipY: Boolean(node.flipY), width: asset.width, height: asset.height });
      } },
      { type: "heading", label: "Apply recipe to selected images" },
      ...recipes.map((recipe) => {
        const issue = designRecipeProblem(recipe);
        return { label: recipe.name, disabled: Boolean(recipeJob || issue || !imageIds.length), title: issue || undefined,
          action: () => startDesignRecipeJob(recipe, imageIds) };
      }),
    ] : [];
    const anchor = [...get("layer-list").querySelectorAll(".design-layer-row")].find((row) => row.dataset.layerId === id)
      ?.querySelector(".design-layer-select") ?? event.currentTarget;
    openContextMenu({ x: event.clientX, y: event.clientY, anchor, focus: anchor,
      items: [{ label: "Add text", action: () => addText() }, { type: "separator" },
        { label: node?.visible === false ? "Show layer" : "Hide layer", action: () => mutateMany("Visibility", (current) => ({ ...current, visible: current.visible === false }), ids) },
        { label: "Bring to front", action: () => layerOrderCommand(id, true) },
        { label: "Send to back", action: () => layerOrderCommand(id, false) },
        { label: node?.locked ? "Unlock selection" : "Lock selection", action: () => mutateMany("Lock", (current) => ({ ...current, locked: !node?.locked }), ids) },
        { label: `Delete ${ids.length === 1 ? "layer" : `${ids.length} layers`}`, action: () => deleteSelected() }, ...frameItems, ...componentItems, ...recipeItems],
    });
  }

  function componentInstanceRootId(id) {
    let node = layer(id);
    while (node) {
      if (node.componentInstanceOf != null) return node.id;
      node = node.parentId ? layer(node.parentId) : null;
    }
    return null;
  }

  function componentDefinitionRootId(id) {
    let node = layer(id);
    while (node) {
      if (node.componentDefinition) return node.id;
      node = node.parentId ? layer(node.parentId) : null;
    }
    return null;
  }

  function componentHasInstances(id) {
    return Object.values(renderProject()?.nodes ?? {}).some((node) => node.componentInstanceOf === id);
  }

  function createComponent() {
    if (!history || !currentPage()) return;
    try {
      const created = createComponentCommand(history.document, currentPage().id, topLevelSelection());
      history.apply(created.command, "Create component"); selection = { ids: [created.id], anchorId: created.id };
      edited("Component created.");
    } catch (error) { setStatus(error.message); }
  }

  function createComponentInstance(definitionId) {
    if (!history || !currentPage()) return;
    try {
      const created = createComponentInstanceCommand(history.document, currentPage().id, definitionId);
      history.apply(created.command, "Create component instance"); selection = { ids: [created.id], anchorId: created.id };
      edited("Component instance created.");
    } catch (error) { setStatus(error.message); }
  }

  function resetComponentInstance(instanceId) {
    if (!history || !currentPage()) return;
    try {
      history.apply(resetComponentOverridesCommand(history.document, currentPage().id, instanceId), "Reset component overrides");
      selection = { ids: [instanceId], anchorId: instanceId }; edited("Component overrides reset.");
    } catch (error) { setStatus(error.message); }
  }

  function detachComponentInstance(instanceId) {
    if (!history || !currentPage()) return;
    try {
      history.apply(detachComponentInstanceCommand(history.document, currentPage().id, instanceId), "Detach component instance");
      selection = { ids: [instanceId], anchorId: instanceId }; edited("Instance detached from its component.");
    } catch (error) { setStatus(error.message); }
  }

  function removeComponentStatus(definitionId) {
    if (!history) return;
    try {
      history.apply(removeComponentDefinitionCommand(history.document, definitionId), "Remove component status");
      edited("Component status removed.");
    } catch (error) { setStatus(error.message); }
  }

  function addText() {
    if (!history || !currentPage()) return;
    try {
      const command = addTextLayerCommand(history.document, currentPage().id, "Add text");
      history.apply(command, "Add text"); const id = command.commands[0].id; selection = { ids: [id], anchorId: id }; edited("Text layer added.");
    } catch (error) { setStatus(error.message); }
  }

  function addShape() {
    if (!history || !currentPage()) return;
    try {
      const shape = get("shape-type").value;
      const command = ["rectangle", "rounded", "ellipse"].includes(shape)
        ? addShapeLayerCommand(history.document, currentPage().id, shape)
        : addVectorLayerCommand(history.document, currentPage().id, createVectorShape(shape));
      const name = shape === "rounded" ? "Rounded rectangle" : shape[0].toUpperCase() + shape.slice(1);
      history.apply(command, `Add ${name.toLowerCase()}`);
      const id = command.commands[0].id; selection = { ids: [id], anchorId: id }; edited(`${name} added.`);
    } catch (error) { setStatus(error.message); }
  }

  function frameSelection() {
    if (!history || !currentPage()) return;
    try {
      const wrapped = addFrameAroundSelectionCommand(history.document, currentPage().id, currentSelection());
      history.apply(wrapped.command, "Frame selection"); selection = { ids: [wrapped.id], anchorId: wrapped.id };
      edited("Frame created around selection.");
    } catch (error) { setStatus(error.message); }
  }

  function deleteSelected() {
    if (!history || !currentSelection().length) return;
    try { history.apply(deleteLayersCommand(history.document, currentSelection()), "Delete layers"); selection = { ids: [], anchorId: null }; edited("Selection deleted."); }
    catch (error) { setStatus(error.message); }
  }

  function nudgeSelectionBy(dx, dy) {
    const size = pageSize();
    if (!history || !size) return;
    const commands = [];
    for (const id of topLevelSelection()) {
      const world = worldLayer(id);
      if (!world?.frame || world.visible === false || world.locked || world.layoutManaged) continue;
      const stored = storeWorldGeometry(id, { ...world, frame: { ...world.frame,
        x: world.frame.x + dx / size.width, y: world.frame.y + dy / size.height } });
      if (stored) commands.push({ type: "node", id, value: stored });
    }
    if (!commands.length) { setStatus("Auto Layout controls the selected layers' position, or the selection is locked."); return; }
    try {
      history.apply({ type: "group", commands }, "Nudge layers");
      edited(`Moved selection ${dx}px horizontally and ${dy}px vertically.`);
    } catch (error) { setStatus(error.message); }
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

  function activateProject(project, { key = null, kind = "design", revision = null, sources: nextSources = new Map() } = {}) {
    cancelDesignRecipeJob("The document changed.");
    cropModeId = null; penActive = false; pathDraft = null; vectorEditId = null; vectorPointSelection = null; vectorInsertMode = false;
    clearTimeout(saveTimer); previewTask?.cancel(); previewTask = null; previewEpoch += 1;
    previewBitmap?.close(); previewBitmap = null;
    history = new ProjectHistory(project); pageId = project.slides[0]?.id ?? null;
    selection = { ids: [], anchorId: null }; sources = nextSources;
    fileOwner = { key: key ?? `${kind}:${project.id}`, kind, savedRevision: revision, autoSave: true, saving: Promise.resolve(), saveError: null };
    ledger(); renderWorkspace(); schedulePreview(0);
    setSaveStatus(revision == null ? "New design" : "Saved on this device");
  }

  async function refreshDesignFiles(selectedKey = fileOwner?.key ?? "") {
    const files = await listLocalPageProjects(), picker = get("open-file"), placeholder = picker.options[0];
    picker.replaceChildren(placeholder);
    for (const file of files) {
      const option = document.createElement("option"); option.value = file.key;
      const kind = file.kind === "story" ? "Story" : "Design";
      option.textContent = `${kind} · ${file.name} · ${new Date(file.savedAt).toLocaleString()}`;
      option.title = `${kind} · ${file.name} · ${file.byteLength} bytes`;
      picker.append(option);
    }
    picker.value = files.some((file) => file.key === selectedKey) ? selectedKey : "";
    return files;
  }

  async function openLocalPageProject(key) {
    if (!key) return;
    const ticket = ++openSequence; setStatus("Opening local document…");
    try {
      const opened = await readLocalPageProject(key);
      if (!opened) throw new Error("That saved document is no longer available.");
      const retained = new Map();
      for (const asset of Object.values(opened.project.assets)) {
        retained.set(asset.id, retainedSource(() => opened.readAsset(asset.id), asset.byteLength));
      }
      if (ticket !== openSequence) return;
      activateProject(opened.project, { key: opened.key, kind: opened.kind, revision: opened.revision, sources: retained });
      setStatus(`${opened.kind === "story" ? "Story" : "Design"} reopened · local sources are available for editing.`);
      await refreshDesignFiles(opened.key);
    } catch (error) {
      if (ticket === openSequence) { setStatus(error?.userMessage ?? error.message ?? "The saved document could not be opened."); await refreshDesignFiles(); }
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
        const saved = await writeLocalPageProject(snapshot, { kind: owner.kind, key: owner.key, expectedRevision: owner.savedRevision,
          readAsset: async (id) => imageSource(id, sourceSnapshot) });
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
  get("canvas").addEventListener("pointercancel", canvasPointerCancel);
  get("canvas").addEventListener("dblclick", (event) => {
    if (penActive && pathDraft?.points.length >= 2) { event.preventDefault(); finishPathDraft(false); }
    else if (vectorEditId && !vectorInsertMode) {
      const node = layer(vectorEditId), point = pointerPoint(event);
      if (node && !vectorEditTarget(point) && addVectorPoint(node, vectorSegmentTarget(node, point))) event.preventDefault();
    }
  });
  get("canvas").addEventListener("contextmenu", (event) => {
    if (penActive && pathDraft) { event.preventDefault(); return; }
    event.preventDefault(); const id = hitTest(pointerPoint(event));
    if (id) contextMenuForLayer(event, id);
    else openContextMenu({ x: event.clientX, y: event.clientY, anchor: get("canvas"), focus: get("canvas"), items: [
      { label: "Add images", action: requestFiles }, { label: "Add text", action: addText }, { label: "Add shape", action: addShape },
      { label: "Draw vector path", action: togglePen },
    ] });
  });
  get("canvas").addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const point = pointerPoint(event), factor = Math.exp(-event.deltaY * .002);
      setCanvasZoom(zoom * factor, point);
    } else {
      panX -= event.deltaX; panY -= event.deltaY; drawCanvas();
    }
  }, { passive: false });
  get("canvas").addEventListener("keydown", (event) => {
    if (penActive && event.key === "Escape") { event.preventDefault(); pathDraft = null; drag = null; drawCanvas(); setStatus("Path discarded."); }
    else if (penActive && event.key === "Enter") { event.preventDefault(); finishPathDraft(false); }
    else if (event.key === "Escape" && vectorEditId && vectorInsertMode) { event.preventDefault(); vectorInsertMode = false; renderWorkspace(); setStatus("Point insertion cancelled."); }
    else if (event.key === "Escape" && vectorEditId) { vectorEditId = null; vectorPointSelection = null; vectorInsertMode = false; renderWorkspace(); setStatus("Path point editing closed."); }
    else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); runHistory(event.shiftKey ? "redo" : "undo"); }
    else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") { event.preventDefault(); runHistory("redo"); }
    else if ((event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=")) { event.preventDefault(); setCanvasZoom(zoom * 1.25); }
    else if ((event.metaKey || event.ctrlKey) && event.key === "-") { event.preventDefault(); setCanvasZoom(zoom / 1.25); }
    else if (event.key === "0") { event.preventDefault(); fitCanvas(); }
    else if (!event.metaKey && !event.ctrlKey && !event.altKey && !vectorEditId
      && ({ ArrowLeft: true, ArrowRight: true, ArrowUp: true, ArrowDown: true })[event.key]) {
      event.preventDefault();
      const amount = event.shiftKey ? 10 : 1;
      nudgeSelectionBy(event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0,
        event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0);
    }
    else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selection = { ids: currentPage()?.nodeIds.filter((id) => layer(id)?.visible !== false) ?? [], anchorId: currentPage()?.nodeIds[0] ?? null }; selectionChanged(); }
    else if (["Delete", "Backspace"].includes(event.key) && vectorEditId && vectorPointSelection != null) { event.preventDefault(); removeSelectedVectorPoint(); }
    else if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); deleteSelected(); }
    else if (event.key === "Escape" && cropModeId) {
      if (history?.base) history.cancel(); drag = null; marquee = null; cropModeId = null;
      selectionChanged(); schedulePreview(0); setStatus("Crop mode cancelled.");
    }
    else if (event.key === "Escape") { selection = { ids: [], anchorId: null }; selectionChanged(); }
  });

  get("add-images").addEventListener("click", requestFiles);
  get("empty-add").addEventListener("click", requestFiles);
  get("new-file").addEventListener("click", newDesign);
  get("open-file").addEventListener("change", () => { if (get("open-file").value) void openLocalPageProject(get("open-file").value); });
  get("recipe-job-pause").addEventListener("click", toggleDesignRecipePause);
  get("recipe-job-cancel").addEventListener("click", () => cancelDesignRecipeJob("Cancelled by user."));
  get("recipe-job-speed").addEventListener("change", setDesignRecipeSpeed);
  get("crop-tool").addEventListener("click", toggleCropMode);
  get("crop-reset").addEventListener("click", resetImageCrop);
  get("document-name").addEventListener("change", () => {
    if (!history) return;
    const name = get("document-name").value.trim();
    if (!name || name.length > 120) { get("document-name").value = history.document.name; setStatus("Design names must contain 1–120 characters."); return; }
    if (name !== history.document.name) { history.apply({ type: "name", value: name }, "Rename design"); edited("Design renamed."); }
  });
  get("file-input").addEventListener("change", () => { const files = [...(get("file-input").files ?? [])]; get("file-input").value = ""; void importImages(files); });
  get("add-text").addEventListener("click", addText); get("add-shape").addEventListener("click", addShape);
  get("add-pen").addEventListener("click", togglePen);
  get("edit-vector").addEventListener("click", () => {
    const id = currentSelection()[0], node = id && layer(id);
    if (node?.kind !== "shape" || node.style?.shape !== "path") return;
    vectorEditId = vectorEditId === id ? null : id; vectorPointSelection = null; vectorInsertMode = false;
    renderWorkspace(); setStatus(vectorEditId ? "Path points · drag anchors or handles, add a point on a segment, or select one to delete." : "Path point editing closed.");
  });
  get("vector-add-point").addEventListener("click", () => {
    const node = vectorEditId && layer(vectorEditId);
    if (!node || worldLayer(node.id)?.locked || node.style.path.points.length >= 512) return;
    vectorInsertMode = !vectorInsertMode; vectorPointSelection = null;
    syncVectorPointControls(node); drawCanvas();
    if (vectorInsertMode) { get("canvas").focus(); setStatus("Add point · tap close to a path segment."); }
    else setStatus("Point insertion cancelled.");
  });
  get("vector-delete-point").addEventListener("click", removeSelectedVectorPoint);
  get("vector-handle-mode").addEventListener("change", () => {
    const node = vectorEditId && layer(vectorEditId), point = node?.style?.path?.points[vectorPointSelection];
    const mode = get("vector-handle-mode").value;
    if (!node || !point || !(point.handleIn || point.handleOut) || !["corner", "smooth", "mirrored"].includes(mode)
      || worldLayer(node.id)?.locked || point.handleMode === mode) return;
    try {
      const value = clone(node), target = value.style.path.points[vectorPointSelection]; target.handleMode = mode;
      history.apply({ type: "node", id: node.id, value }, "Change vector handle behavior");
      edited(`${mode[0].toUpperCase()}${mode.slice(1)} handles selected.`);
    } catch (error) { setStatus(error.message); }
  });
  get("vector-count").addEventListener("input", () => {
    const sides = Number(get("vector-count").value);
    if (Number.isInteger(sides) && sides >= 3 && sides <= 24) previewVectorPrimitive({ sides });
  });
  get("vector-count").addEventListener("change", () => commitEdit("Change polygon sides or star points"));
  get("vector-inner-radius").addEventListener("input", () => {
    const innerRadius = Number(get("vector-inner-radius").value);
    if (Number.isFinite(innerRadius)) {
      get("vector-inner-radius-value").value = `${Math.round(innerRadius * 100)}%`;
      previewVectorPrimitive({ innerRadius });
    }
  });
  get("vector-inner-radius").addEventListener("change", () => commitEdit("Change star inner radius"));
  get("frame-selection").addEventListener("click", frameSelection);
  get("new-page").addEventListener("click", () => {
    try {
      if (!history) { newDesign(); return; }
      cropModeId = null; pathDraft = null; drag = null; vectorEditId = null;
      const added = addDesignPageCommand(history.document); history.apply(added.command, "Add page"); pageId = added.id;
      selection = { ids: [], anchorId: null }; edited("Page added.");
    } catch (error) { setStatus(error.message); }
  });
  get("undo").addEventListener("click", () => runHistory("undo")); get("redo").addEventListener("click", () => runHistory("redo"));
  get("export").addEventListener("click", () => void exportPage()); get("fit").addEventListener("click", fitCanvas);
  get("zoom-in").addEventListener("click", () => setCanvasZoom(zoom * 1.25));
  get("zoom-out").addEventListener("click", () => setCanvasZoom(zoom / 1.25));
  get("zoom-label").addEventListener("click", fitCanvas);
  window.addEventListener("keydown", (event) => {
    if (penActive && event.code === "Escape") {
      event.preventDefault(); pathDraft = null; drag = null; drawCanvas(); setStatus("Path discarded."); return;
    }
    if (penActive && event.code === "Enter") {
      event.preventDefault(); finishPathDraft(false); return;
    }
    if (event.code === "Space" && document.activeElement === get("canvas")) { spaceDown = true; event.preventDefault(); }
  });
  window.addEventListener("keyup", (event) => { if (event.code === "Space") spaceDown = false; });
  window.addEventListener("blur", () => { spaceDown = false; touchPoints.clear(); pinch = null; });
  get("layer-name").addEventListener("change", () => { const id = currentSelection()[0]; if (!id) return; try { history.apply(renameLayerCommand(history.document, id, get("layer-name").value), "Rename layer"); edited("Layer renamed."); } catch (error) { setStatus(error.message); } });
  for (const [field, key] of [["x", "x"], ["y", "y"], ["width", "width"], ["height", "height"]]) {
    get(field).addEventListener("input", () => {
      const id = currentSelection()[0], node = id && layer(id), value = Number(get(field).value), size = pageSize();
      if (!node || !size || !Number.isFinite(value)) return;
      const dimension = ["x", "width"].includes(key) ? size.width : size.height;
      const world = worldLayer(id), transformed = { ...world, frame: { ...world.frame, [key]: value / dimension } };
      const stored = storeWorldGeometry(id, transformed); if (!stored) return;
      const commands = [{ type: "node", id, value: stored }];
      if (node.kind === "frame" && ["width", "height"].includes(key)) commands.push(...resizeFrameChildren(renderProject(), currentPage().id, id, stored.frame));
      try { history.preview({ type: "group", commands }); edited("Previewing changes…", { previewOnly: true }); }
      catch (error) { setStatus(error.message); }
    });
    get(field).addEventListener("change", () => commitEdit("Change layer geometry"));
  }
  for (const [field, key] of [["x", "x"], ["y", "y"], ["width", "width"], ["height", "height"]]) {
    get(`multi-${field}`).addEventListener("input", () => {
      const ids = topLevelSelection(), size = pageSize(), value = Number(get(`multi-${field}`).value);
      if (!history || !size || !Number.isFinite(value)) return;
      const nodes = ids.map(worldLayer), bounds = selectionBounds(nodes, size);
      if (!bounds || nodes.some((node) => !node || node.locked) || (nodes.some((node) => node.layoutManaged) && ["x", "y"].includes(key))) return;
      const nextBounds = { ...bounds, [key]: value };
      if (nextBounds.width <= 0 || nextBounds.height <= 0) return;
      try {
        const updates = resizeSelection(nodes, bounds, nextBounds, size), commands = [];
        for (const updated of updates) {
          const stored = storeWorldGeometry(updated.id, updated);
          if (!stored) continue;
          commands.push({ type: "node", id: stored.id, value: stored });
          const original = layer(stored.id);
          if (stored.kind === "frame" && (["width", "height"].includes(key)
            && Math.abs(stored.frame[key] - original.frame[key]) > 1e-8)) {
            commands.push(...resizeFrameChildren(renderProject(), currentPage().id, stored.id, stored.frame));
          }
        }
        if (!commands.length) return;
        history.preview({ type: "group", commands }); edited("Previewing selection geometry…", { previewOnly: true });
      } catch (error) { setStatus(error.message); }
    });
    get(`multi-${field}`).addEventListener("change", () => commitEdit("Change selected layer geometry"));
  }
  get("text").addEventListener("input", () => { const id = currentSelection()[0]; if (id) previewNode(id, { text: get("text").value }); });
  get("text").addEventListener("change", () => commitEdit("Edit text"));
  get("color").addEventListener("input", () => { const id = currentSelection()[0]; if (id) previewNode(id, { color: get("color").value }); });
  get("color").addEventListener("change", () => commitEdit("Change fill"));
  get("opacity").addEventListener("input", () => {
    const id = currentSelection()[0], value = Number(get("opacity").value) / 100;
    get("opacity-value").value = `${Math.round(value * 100)}%`;
    if (id) previewNode(id, { opacity: value });
  });
  get("opacity").addEventListener("change", () => commitEdit("Change layer opacity"));
  get("multi-opacity").addEventListener("input", () => {
    const ids = currentSelection(), value = Number(get("multi-opacity").value) / 100;
    get("multi-opacity-value").value = `${Math.round(value * 100)}%`;
    const nodes = ids.map((id) => layer(id));
    if (nodes.length < 2 || nodes.some((node, index) => !node || !["image", "text", "shape", "frame"].includes(node.kind)
      || worldLayer(ids[index])?.locked)) return;
    try {
      history.preview({ type: "group", commands: ids.map((id) => ({ type: "node", id, value: { ...clone(layer(id)), opacity: value } })) });
      edited("Previewing layer opacity…", { previewOnly: true });
    } catch (error) { setStatus(error.message); }
  });
  get("multi-opacity").addEventListener("change", () => commitEdit("Change selected layer opacity"));
  get("frame-clip").addEventListener("change", () => {
    const id = currentSelection()[0], node = id && layer(id); if (!node || node.kind !== "frame") return;
    history.apply({ type: "node", id, value: { ...clone(node), style: { ...node.style, clipContent: get("frame-clip").checked } } }, "Change frame clipping"); edited("Frame clipping updated.");
  });
  get("frame-radius").addEventListener("input", () => {
    const id = currentSelection()[0], node = id && layer(id); if (!node || node.kind !== "frame") return;
    const radius = Number(get("frame-radius").value); get("frame-radius-value").value = `${Math.round(radius * 100)}%`;
    previewNode(id, { style: { ...node.style, radius } });
  });
  get("frame-radius").addEventListener("change", () => commitEdit("Change frame corner radius"));
  get("frame-layout").addEventListener("change", () => {
    const id = currentSelection()[0], node = id && layer(id); if (!node || node.kind !== "frame") return;
    try { history.apply(setFrameLayoutCommand(history.document, currentPage().id, id, get("frame-layout").value), "Change frame layout"); edited("Auto Layout updated."); }
    catch (error) { setStatus(error.message); }
  });
  get("layout-positioning").addEventListener("change", () => {
    const id = currentSelection()[0], node = id && layer(id);
    if (!node || !node.parentId) return;
    try {
      history.apply(setLayoutPositioningCommand(history.document, currentPage().id, id, get("layout-positioning").value), "Change Auto Layout positioning");
      edited("Layer positioning updated.");
    } catch (error) { setStatus(error.message); renderWorkspace(); }
  });
  function updateFrameLayout(key, value) {
    const id = currentSelection()[0], node = id && layer(id); if (!node || node.kind !== "frame" || !node.style?.layout) return;
    if (node.style.layout.direction === "grid" && ["columns", "rows"].includes(key)) {
      try {
        history.preview(resizeGridTrackCountCommand(history.document, currentPage().id, id, key, value));
        edited("Previewing grid track count…", { previewOnly: true });
      } catch (error) { setStatus(error.message); renderWorkspace(); }
      return;
    }
    const layout = clone(node.style.layout);
    if (key.startsWith("padding.")) layout.padding = { top: 0, right: 0, bottom: 0, left: 0, ...layout.padding,
      [key.slice("padding.".length)]: value };
    else {
      layout[key] = value;
      if (layout.direction === "grid" && key === "columns") layout.columnTracks = gridTrackDefinitions(layout, "columns", value);
      if (layout.direction === "grid" && key === "rows" && value > 0) layout.rowTracks = gridTrackDefinitions(layout, "rows", value);
    }
    previewNode(id, { style: { ...node.style, layout } });
  }
  for (const [field, key] of [["layout-gap", "gap"], ["layout-row-gap", "rowGap"], ["layout-column-gap", "columnGap"],
    ["layout-padding-left", "padding.left"], ["layout-padding-right", "padding.right"],
    ["layout-padding-top", "padding.top"], ["layout-padding-bottom", "padding.bottom"]]) {
    get(field).addEventListener("input", () => { const value = Number(get(field).value); if (Number.isFinite(value) && value >= 0) updateFrameLayout(key, value); });
    get(field).addEventListener("change", () => commitEdit("Change Auto Layout spacing"));
  }
  for (const [field, key] of [["layout-columns", "columns"], ["layout-rows", "rows"]]) {
    get(field).addEventListener("input", () => {
      const value = Number(get(field).value);
      if (Number.isInteger(value) && value >= (key === "columns" ? 1 : 0) && value <= 24) updateFrameLayout(key, value);
    });
    get(field).addEventListener("change", () => commitEdit("Change grid tracks"));
  }
  for (const [field, key] of [["layout-justify", "justify"], ["layout-align", "align"]]) {
    get(field).addEventListener("change", () => {
      updateFrameLayout(key, get(field).value); commitEdit("Change Auto Layout alignment");
    });
  }
  get("layout-wrap").addEventListener("change", () => {
    updateFrameLayout("wrap", get("layout-wrap").checked); commitEdit("Change Auto Layout wrapping");
  });
  get("grid-tracks").addEventListener("change", (event) => {
    const control = event.target.closest("[data-grid-track-control]"); if (!control) return;
    const row = control.closest(".design-grid-track-row"), id = currentSelection()[0], node = id && layer(id);
    if (!row || node?.kind !== "frame" || node.style?.layout?.direction !== "grid") return;
    const axis = control.dataset.gridTrackAxis, index = Number(control.dataset.gridTrackIndex), layout = clone(node.style.layout);
    const count = axis === "columns" ? layout.columns : gridPlacementsForChildren(
      currentPage().nodeIds.filter((childId) => project.nodes[childId]?.parentId === id && project.nodes[childId]?.visible !== false),
      project.nodes, layout).rows;
    if (!Number.isInteger(index) || index < 0 || index >= count) return;
    const tracks = gridTrackDefinitions(layout, axis, count), previous = tracks[index];
    const mode = row.querySelector('[data-grid-track-control="mode"]').value;
    let track = { mode };
    if (mode !== "hug") {
      const input = row.querySelector('[data-grid-track-control="value"]');
      const defaultValue = mode === previous.mode ? previous.value : mode === "fixed" ? 100 : 1;
      const value = control.dataset.gridTrackControl === "value" ? Number(input.value) : defaultValue;
      if (!Number.isFinite(value)) return;
      track.value = value;
    }
    tracks[index] = track;
    layout[axis === "columns" ? "columnTracks" : "rowTracks"] = tracks;
    try {
      history.apply({ type: "node", id, value: { ...clone(node), style: { ...node.style, layout } } }, "Change grid track");
      edited("Grid track updated.");
    } catch (error) { setStatus(error.message); renderWorkspace(); }
  });
  for (const [buttonId, axis] of [["grid-add-column", "columns"], ["grid-add-row", "rows"]]) get(buttonId).addEventListener("click", () => {
    const id = currentSelection()[0], node = id && layer(id);
    if (node?.kind !== "frame" || node.style?.layout?.direction !== "grid" || worldLayer(id)?.locked) return;
    try { history.apply(addGridTrackCommand(history.document, currentPage().id, id, axis), `Add grid ${axis.slice(0, -1)}`); edited(`Grid ${axis} updated.`); }
    catch (error) { setStatus(error.message); renderWorkspace(); }
  });
  get("grid-tracks").addEventListener("click", (event) => {
    const control = event.target.closest("[data-grid-track-action]"); if (!control || control.disabled) return;
    const id = currentSelection()[0], node = id && layer(id), axis = control.dataset.gridTrackAxis, index = Number(control.dataset.gridTrackIndex);
    if (node?.kind !== "frame" || node.style?.layout?.direction !== "grid" || worldLayer(id)?.locked) return;
    try {
      const command = control.dataset.gridTrackAction === "delete"
        ? deleteGridTrackCommand(history.document, currentPage().id, id, axis, index)
        : moveGridTrackCommand(history.document, currentPage().id, id, axis, index, control.dataset.gridTrackAction === "move-before" ? -1 : 1);
      history.apply(command, control.dataset.gridTrackAction === "delete" ? "Delete grid track" : "Reorder grid track");
      edited(control.dataset.gridTrackAction === "delete" ? "Grid track deleted." : "Grid track reordered.");
    } catch (error) { setStatus(error.message); renderWorkspace(); }
  });
  for (const field of ["grid-row", "grid-column", "grid-row-span", "grid-column-span"]) get(field).addEventListener("change", () => {
    const id = currentSelection()[0], node = id && layer(id); if (!node || !node.parentId) return;
    const placement = { row: Number(get("grid-row").value), column: Number(get("grid-column").value),
      rowSpan: Number(get("grid-row-span").value), columnSpan: Number(get("grid-column-span").value) };
    try {
      history.apply(setGridPlacementCommand(history.document, currentPage().id, id, placement), "Change grid cell");
      edited("Grid cell updated.");
    } catch (error) { setStatus(error.message); renderWorkspace(); }
  });
  for (const axis of ["horizontal", "vertical"]) get(`grid-align-${axis}`).addEventListener("change", () => {
    const id = currentSelection()[0], node = id && layer(id); if (!node?.parentId) return;
    const selected = get(`grid-align-${axis}`).value;
    try {
      history.apply(setGridAlignmentCommand(history.document, currentPage().id, id, axis, selected === "auto" ? null : selected), "Change grid cell alignment");
      edited("Grid cell alignment updated.");
    } catch (error) { setStatus(error.message); renderWorkspace(); }
  });
  for (const axis of ["width", "height"]) get(`layout-sizing-${axis}`).addEventListener("change", () => {
    const id = currentSelection()[0], node = id && layer(id), mode = get(`layout-sizing-${axis}`).value;
    const parentHasLayout = Boolean(node?.parentId && layer(node.parentId)?.style?.layout);
    if (!node || mode === "fill" && !parentHasLayout || mode === "hug" && (node.kind !== "frame" || !node.style?.layout)) return;
    const world = worldLayer(id), variant = renderProject().variants[0];
    const layoutSize = { width: node.layoutSize?.width ?? world.frame.width * variant.width,
      height: node.layoutSize?.height ?? world.frame.height * variant.height };
    layoutSize[axis] = world.frame[axis] * variant[axis];
    const layoutSizing = { width: "fixed", height: "fixed", ...node.layoutSizing, [axis]: mode };
    const value = { ...clone(node), layoutSizing, layoutSize };
    if (value.flowSizing) value.flowSizing = { ...value.flowSizing, [axis]: mode };
    history.apply({ type: "node", id, value }, "Change layer resizing");
    edited("Layer resizing updated.");
  });
  for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"]) {
    const controlId = `layout-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    get(controlId).addEventListener("change", () => {
      const id = currentSelection()[0], node = id && layer(id), world = node && worldLayer(id);
      if (!node || !node.parentId || !layer(node.parentId)?.style?.layout || world?.locked) return;
      const raw = get(controlId).value.trim(), bounds = { ...node.layoutMinMax };
      if (raw === "") delete bounds[key];
      else {
        const value = Number(raw);
        if (!Number.isFinite(value)) { renderWorkspace(); return; }
        bounds[key] = value;
      }
      const updated = clone(node);
      if (Object.keys(bounds).length) updated.layoutMinMax = bounds;
      else delete updated.layoutMinMax;
      try {
        history.apply({ type: "node", id, value: updated }, "Change Auto Layout size limits");
        edited("Auto Layout size limits updated.");
      } catch (error) { setStatus(error.message); renderWorkspace(); }
    });
  }
  for (const [field, axis] of [["constraint-horizontal", "horizontal"], ["constraint-vertical", "vertical"]]) {
    get(field).addEventListener("change", () => {
      const id = currentSelection()[0], node = id && layer(id); if (!node?.parentId) return;
      history.apply({ type: "node", id, value: { ...clone(node), constraints: { ...node.constraints, [axis]: get(field).value } } }, "Change frame constraints");
      edited("Frame constraints updated.");
    });
  }
  get("image-fit").addEventListener("change", () => { const id = currentSelection()[0]; if (id) { history.apply({ type: "node", id, value: { ...clone(layer(id)), fit: get("image-fit").value } }, "Change image fit"); edited(); } });
  for (const [field, key, label] of [["flip-x", "flipX", "horizontal"], ["flip-y", "flipY", "vertical"]]) get(field).addEventListener("click", () => {
    const id = currentSelection()[0], node = id && layer(id); if (!node || node.kind !== "image" || node.locked) return;
    history.apply({ type: "node", id, value: { ...clone(node), [key]: !node[key] } }, `Flip image ${label}`);
    edited(`Image flipped ${label}.`);
  });
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
  window.addEventListener("resize", () => {
    if (window.matchMedia("(max-width: 620px)").matches) root.querySelector(".design-toolbar-actions").scrollLeft = 0;
  });
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
      const vectorNode = vectorEditId ? layer(vectorEditId) : null;
      return { id: project.id, revision: project.revision, name: project.name, key: fileOwner?.key ?? null, savedRevision: fileOwner?.savedRevision ?? null, pageId: currentPage()?.id,
        variant: clone(project.variants[0]),
        pages: clone(project.slides), nodes: clone(project.nodes), assets: clone(project.assets), selection: currentSelection(), retainedSourceBytes: retainedSourceBytes(),
        resolvedFrames: Object.fromEntries([...resolvedLayerMap()].map(([id, frame]) => [id, clone(frame)])),
        canvas: { zoom, panX, panY, geometry: clone(geometry) }, cropModeId,
        vectorEditing: vectorNode ? { layerId: vectorNode.id, selectedPoint: vectorPointSelection, insertMode: vectorInsertMode,
          points: (vectorNode.style?.path?.points ?? []).map((point) => vectorPointOnCanvas(vectorNode, point)),
          handles: (vectorNode.style?.path?.points ?? []).map((point) => ({
            handleIn: point.handleIn ? vectorPointOnCanvas(vectorNode, point.handleIn) : null,
            handleOut: point.handleOut ? vectorPointOnCanvas(vectorNode, point.handleOut) : null,
          })) } : null,
        gridTracks: selectedGridFrameId() ? clone(gridGeometryFor()) : null,
        recipeJob: recipeJob ? { total: recipeJob.total, completed: recipeJob.completed, active: recipeJob.active, paused: recipeJob.paused } : null };
    },
  };
  renderWorkspace();
  void refreshDesignFiles().then((files) => { if (!history && files[0]) void openLocalPageProject(files[0].key); }).catch(() => setSaveStatus("Local project storage is unavailable"));
}
