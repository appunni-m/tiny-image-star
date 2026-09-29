import { createStoryView, action, field, range, select } from "./view.js";
import { createPhotoStory, slidePhotos, storyLayoutCommand, moveStorySlide } from "./recipes.js";
import { importStoryPhotos, STORY_SOURCE_LIMIT } from "./assets.js";
import { prepareSourceResolution } from "./source-resolution.js";
import { WORKING_COPY_EDGE } from "../project/working-copy.js";
import { adaptStoryLayoutCommand, hasAdaptiveLayout, positionStoryPhotoCommand, reviewStoryLayout, withStoryReflow } from "./layout.js";
import { mountStylePanel } from "./style-panel.js";
import { mountMaskPanel } from "./mask-panel.js";
import { mountDepthPanel } from "./depth-panel.js";
import { mountConnectionPanel } from "./connection-panel.js";
import { mountCutoutEffectsPanel } from "./cutout-effects-panel.js";
import { canMoveStorySlide, connectedSlideGroup, reviewConnections } from "./connections.js";
import { storyMaskCommand, pruneStorySources } from "./masks.js";
import { storyStyleCommand, curatedStoryStyles, storyDeviceFontsCommand } from "../styles/model.js";
import { StoryFontLoader } from "./font-loader.js";
import { ProjectHistory, applyProjectCommand } from "../project/history.js";
import { canonicalJSON, clone, newId, resolveSlide } from "../project/model.js";
import { listStoryProjects, readStoryProject, writeStoryProject, readStoredStoryAsset } from "../project/storage.js";
import { getProcessingScheduler } from "../processing/client.js";
import { enqueueScene } from "../processing/scene-client.js";
import { mountStoryExportPanel } from "./export-panel.js";

import { openStoryBatchPanel } from "./batch-panel.js";
import { openStoryGroupPanel } from "./group-panel.js";

export function attachStoryWorkspace() {
  const { root, sheet, get } = createStoryView(), pool = getProcessingScheduler();
  // Browser entries survive a reload; modal state does not. Only this page
  // instance may reopen its entries, so stale story/tool entries act as closed.
  const navigationId = newId("story-navigation");
  let session = null, slideId, variantId = "portrait", tool = null, visible = false;
  let previewTask, previewTimer, previewKey = "", preview = null, importing, saveTimer, error = "";
  const thumbnails = new Map(), thumbnailTasks = new Map(), outputs = [];
  const lookTasks = new Set(), lookPreviews = []; let toolEpoch = 0;
  let stylePanel = null, maskPanel = null, effectPanel = null, toolBusy = false, toolError = "", preferredPhotoId = null;
  let sourceConversion = null;
  const pendingSources = new Set();
  const importReservations = new Set();
  const fontLoaders = new Set();
  let exportPanelController = null;
  const documentNow = () => session?.history.document;
  const keyFor = (project, id, variant = variantId) => canonicalJSON(resolveSlide(project, id, variant));
  const bytesOf = (entry) => entry ? entry.blob.size + entry.width * entry.height * 4 : 0;

  function ledger(extra = 0) {
    const retained = new Set([...(session?.sources.values() ?? []), ...[...pendingSources].flatMap((sources) => [...sources.values()])].filter(Boolean));
    const assets = [...retained].reduce((sum, blob) => sum + blob.size, 0);
    // The spread reuses cached thumbnail URLs; conservatively reserve separate
    // decoded surfaces for its additional image elements (160px maximum edge).
    const connectionSurfaces = tool === "cutout" ? sheet.querySelectorAll("[data-connection-slide]").length * 160 * 160 * 4 : 0;
    const effectSurface = tool === "cutout" && sheet.querySelector("[data-cutout-effect-preview]") && preview ? preview.width * preview.height * 4 : 0;
    pool.setRetainedBytes("story-workspace", assets + bytesOf(preview) + [...thumbnails.values()].reduce((sum, item) => sum + bytesOf(item), 0) + connectionSurfaces + effectSurface
      + outputs.reduce((sum, item) => sum + item.file.size, 0) + lookPreviews.reduce((sum, item) => sum + bytesOf(item), 0)
      + [...fontLoaders].reduce((sum, loader) => sum + loader.pendingBytes, 0)
      + [...importReservations].reduce((sum, reservation) => sum + reservation.bytes, 0) + extra);
  }
  function fontsFor(owner) {
    if (!owner.fontLoader) owner.fontLoader = new StoryFontLoader({ sources: owner.sources, readStored: readStoredStoryAsset,
      onChange: () => { if (owner.fontLoader?.pending.size) fontLoaders.add(owner.fontLoader); else fontLoaders.delete(owner.fontLoader); ledger(); } });
    return owner.fontLoader;
  }
  const readSource = (owner, project) => (id, options) => owner.sources.get(id) ?? fontsFor(owner).read(project.assets[id], options);
  function release(entry) { if (entry?.url) URL.revokeObjectURL(entry.url); }
  function clearOutputs() {
    exportPanelController?.dispose(); exportPanelController = null;
    for (const entry of outputs) release(entry); outputs.length = 0; ledger();
  }
  function clearRenders() {
    clearTimeout(previewTimer); previewTask?.cancel(); previewTask = null; previewKey = "";
    for (const task of thumbnailTasks.values()) task.cancel(); thumbnailTasks.clear();
    release(preview); preview = null; for (const entry of thumbnails.values()) release(entry); thumbnails.clear();
    for (const image of sheet.querySelectorAll("[data-connection-slide], [data-cutout-effect-preview]")) image.removeAttribute("src");
    get("preview").removeAttribute("src"); get("preview").hidden = true; ledger();
  }
  function status(message) {
    if (message !== undefined) get("status").textContent = message;
    else get("status").textContent = toolError || error || session?.saveError?.message || (previewTask ? "Updating preview…" : session
      ? session.history.base ? "Previewing changes · Apply to keep them" : session.savedRevision === documentNow().revision ? "Saved on this device" : session.autoSave ? "Saving on this device…" : "Saved copies cleared. Your open story is still here."
      : "Your photos stay on this device.");
    get("retry-save").hidden = !session?.saveError || session.saveError.code === "PROJECT_CONFLICT";
    get("save-copy").hidden = session?.saveError?.code !== "PROJECT_CONFLICT";
    get("undo").disabled = !session?.history.past.length || Boolean(tool);
    get("redo").disabled = !session?.history.future.length || Boolean(tool);
    const unreviewed = Boolean(session && (previewTask || !preview || preview.key !== keyFor(documentNow(), slideId)));
    get("export").disabled = !visible || !session || Boolean(importing) || unreviewed;
    get("sheet-apply").disabled = Boolean(tool && tool !== "export" && (unreviewed || toolBusy || toolError));
    for (const button of sheet.querySelectorAll("[data-apply-and-open]")) button.disabled = get("sheet-apply").disabled;
    for (const input of sheet.querySelectorAll("[data-connection-control]")) input.disabled = toolBusy || Boolean(toolError)
      || Boolean(input.dataset.connectionMask && !documentNow()?.nodes[input.dataset.connectionMask]?.maskId);
    effectPanel?.sync();
    for (const input of sheet.querySelectorAll("[data-cutout-effect-control]")) input.disabled ||= toolBusy || Boolean(toolError);
    for (const image of sheet.querySelectorAll("[data-cutout-effect-preview]")) {
      if (tool === "cutout" && session && preview?.key === keyFor(documentNow(), slideId)) { if (image.src !== preview.url) image.src = preview.url; image.hidden = false; }
      else { image.removeAttribute("src"); image.hidden = true; }
    }
    const reviewMessage = tool && tool !== "export" ? toolError || error || (toolBusy ? tool === "look" ? "Loading story fonts…" : tool === "photos" ? "Matching photo and cutout sizes…" : "Updating cutout…" : unreviewed ? "Updating preview…" : "") : "";
    get("sheet-preview-status").hidden = !reviewMessage; get("sheet-preview-status").textContent = reviewMessage;
    get("retry-preview").hidden = !tool || tool === "export" || !unreviewed || !error;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    if (!session || !session.autoSave || session.saveError?.code === "PROJECT_CONFLICT") return;
    saveTimer = setTimeout(() => { void persist().catch(() => {}); }, 450);
  }
  function persist() {
    clearTimeout(saveTimer);
    const owner = session;
    if (!owner || !owner.autoSave || owner.history.base) return Promise.resolve();
    const project = clone(owner.history.document);
    const sources = new Map(Object.keys(project.assets).map((id) => [id, owner.sources.get(id)]));
    pendingSources.add(sources); ledger();
    owner.saving = (owner.saving ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (!owner.autoSave || owner.savedRevision === project.revision) return;
      if (owner.saveError?.code === "PROJECT_CONFLICT") throw owner.saveError;
      try {
        const saved = await writeStoryProject(project, { key: owner.key, expectedRevision: owner.savedRevision, readAsset: async (id) => {
          if (!sources.get(id)) { sources.set(id, await readSource(owner, project)(id)); ledger(); } return sources.get(id);
        } });
        owner.key = saved.key; owner.savedRevision = saved.revision; owner.saveError = null;
      } catch (failure) { owner.saveError = failure; throw failure; }
      finally { if (session === owner) status(); }
    }).finally(() => { pendingSources.delete(sources); ledger(); });
    return owner.saving;
  }
  function edited() { error = ""; clearOutputs(); renderFilmstrip(); schedulePreview(); scheduleSave(); status(); }
  function previewEdit(command) {
    try { session.autoSave = true; session.history.preview(typeof command === "function" ? command() : command); if (tool === "photos") toolError = ""; edited(); return true; }
    catch (failure) { error = failure.message; status(); const notice = get("sheet-content").querySelector("[data-layout-note]"); if (notice) notice.textContent = error; return false; }
  }
  function nodeEdit(id, patch) { previewEdit(() => withStoryReflow(documentNow(), { type: "node", id, value: { ...documentNow().nodes[id], ...patch } }, slideId)); }
  function runHistory(command) { if (session.history[command]()) { session.autoSave = true; variantId = documentNow().recipe.outputVariant ?? "portrait"; pruneStorySources(session); edited(); } }
  function makeEntry(result, key) {
    const blob = new Blob([result.output], { type: result.mime });
    return { key, blob, url: URL.createObjectURL(blob), width: result.width, height: result.height, warnings: result.warnings };
  }
  function renderNotices(warnings) {
    const notices = [];
    if (warnings.some((warning) => warning.code === "TEXT_OVERFLOW")) notices.push("Some text is clipped. Open Text to shorten it.");
    if (warnings.some((warning) => warning.code === "DEPTH_SUBJECT_NEEDED")) notices.push("A depth title needs a new subject mask. Words are shown in front of the original photo. Open Cutout to choose the subject.");
    if (warnings.some((warning) => warning.code === "CONNECTION_SUBJECT_NEEDED")) notices.push("A connected cutout needs a new subject mask. Its original photo is shown across both slides. Open Cutout to choose the subject.");
    if (warnings.some((warning) => warning.code === "CUTOUT_EFFECTS_SUBJECT_NEEDED")) notices.push("Outline and shadow need a new subject mask. Their settings are saved. Open Cutout to choose the subject.");
    return notices;
  }
  function refreshConnectionPreview() {
    if (!session) return;
    for (const image of sheet.querySelectorAll("[data-connection-slide]")) {
      const id = image.dataset.connectionSlide, entry = thumbnails.get(id);
      if (tool === "cutout" && entry?.key === keyFor(documentNow(), id)) { if (image.src !== entry.url) image.src = entry.url; image.style.visibility = "visible"; }
      else { image.removeAttribute("src"); image.style.visibility = "hidden"; }
    }
  }
  function renderFilmstrip() {
    const project = documentNow(), strip = get("filmstrip"); strip.replaceChildren(); if (!project) return;
    project.slides.forEach((slide, index) => {
      const button = document.createElement("button"); button.type = "button"; button.dataset.slideId = slide.id;
      button.setAttribute("aria-label", `Slide ${index + 1} of ${project.slides.length}`); button.setAttribute("aria-current", String(slide.id === slideId));
      const entry = thumbnails.get(slide.id);
      if (entry && entry.key === keyFor(project, slide.id)) { const image = new Image(); image.src = entry.url; image.alt = ""; button.append(image); }
      const number = document.createElement("span"); number.textContent = String(index + 1); button.append(number);
      button.addEventListener("click", () => { if (slideId === slide.id) return; slideId = slide.id; renderFilmstrip(); schedulePreview(0); }); strip.append(button);
    });
    refreshConnectionPreview();
  }
  function schedulePreview(delay = 120) {
    clearTimeout(previewTimer); previewTask?.cancel(); previewTask = null;
    if (!visible || !session) return;
    for (const [id, task] of thumbnailTasks) if (task.key !== keyFor(documentNow(), id)) { task.cancel(); thumbnailTasks.delete(id); }
    get("export").disabled = true;
    previewTimer = setTimeout(() => { void updatePreview(); }, delay);
  }
  async function updatePreview() {
    const owner = session, project = documentNow(), selected = slideId, key = keyFor(project, selected);
    previewKey = key; error = "";
    if (preview?.key === key) { status(); queueThumbnails(); return; }
    let task;
    try {
      task = enqueueScene({ project, slideId: selected, variantId, preview: true, readAsset: readSource(owner, project) });
      previewTask = task; status(); get("preview-message").textContent = "Updating preview…";
      const result = await task.promise;
      if (session !== owner || !visible || previewKey !== key || slideId !== selected || task !== previewTask) return;
      release(preview); preview = makeEntry(result, key); get("preview").src = preview.url; get("preview").hidden = false;
      get("preview").alt = `${project.name}, slide ${project.slides.findIndex((slide) => slide.id === selected) + 1} of ${project.slides.length}`;
      const notices = renderNotices(result.warnings);
      if (reviewStoryLayout(project, selected, variantId).length) notices.push("Some positions overlap or leave the page. Review Layout.");
      if (reviewConnections(project, variantId).some((warning) => warning.slideIds.includes(selected))) notices.push("A connected cutout no longer crosses its join. Review Across slides in Cutout.");
      get("preview-message").textContent = notices.join(" ");
      ledger(); queueThumbnails();
    } catch (failure) {
      if (failure.name !== "AbortError" && session === owner && (!task || task === previewTask)) {
        error = failure.message; get("preview-message").replaceChildren(document.createTextNode(failure.message), action("Try again", () => schedulePreview(0)));
      }
    } finally {
      // Planning/admission can throw before a task exists. Surface that failure
      // in the sheet as well, while ignoring a superseded preview's completion.
      if (session === owner && previewKey === key && slideId === selected && (!task || task === previewTask)) {
        previewTask = null; status();
      }
    }
  }
  function queueThumbnails() {
    const owner = session, project = documentNow();
    for (const [id, task] of thumbnailTasks) if (task.key !== keyFor(project, id)) { task.cancel(); thumbnailTasks.delete(id); }
    for (const slide of project.slides) {
      const key = keyFor(project, slide.id);
      if (thumbnails.get(slide.id)?.key === key || thumbnailTasks.get(slide.id)?.key === key) continue;
      const task = enqueueScene({ project, slideId: slide.id, variantId, preview: true, previewEdge: 160, priority: 3, readAsset: readSource(owner, project) });
      task.key = key; thumbnailTasks.set(slide.id, task);
      void task.promise.then((result) => {
        if (session !== owner || !visible || thumbnailTasks.get(slide.id) !== task || keyFor(documentNow(), slide.id) !== key) return;
        release(thumbnails.get(slide.id)); thumbnails.set(slide.id, makeEntry(result, key)); ledger(); renderFilmstrip();
      }).catch(() => { /* The selected viewport reports its render failures. */ }).finally(() => { if (thumbnailTasks.get(slide.id) === task) thumbnailTasks.delete(slide.id); });
    }
  }
  function showSession(next) {
    clearRenders(); clearOutputs(); session = next; slideId = documentNow().slides[0].id; variantId = documentNow().recipe.outputVariant ?? documentNow().variants[0].id;
    get("intro").hidden = true; get("body").hidden = false; visible = true; get("name").textContent = documentNow().name;
    ledger(); renderFilmstrip(); schedulePreview(0); status();
  }
  async function library() {
    const container = get("library"); container.replaceChildren();
    try {
      const projects = await listStoryProjects();
      if (!projects.length) { const text = document.createElement("p"); text.textContent = "Your saved stories will appear here."; container.append(text); }
      for (const item of projects) container.append(action(item.name, () => { void restore(item.key); }));
    } catch (failure) { container.textContent = failure.message; }
  }
  async function restore(key) {
    try {
      await persist(); const opened = await readStoryProject(key); if (!opened) throw new Error("That story is no longer saved on this device.");
      if (opened.project.recipe?.kind !== "story-recipe" || opened.project.recipe.schema !== 1) throw new Error("This saved project needs a different story workspace. Its data is preserved for backup.");
      const sources = new Map();
      for (const asset of Object.values(opened.project.assets)) sources.set(asset.id, await opened.readAsset(asset.id));
      showSession({ key, sources, history: new ProjectHistory(opened.project), savedRevision: opened.revision, autoSave: true });
    } catch (failure) { status(failure.message); }
  }
  function open(manageHistory = true) {
    if (root.open) return;
    root.showModal(); visible = !get("body").hidden;
    if (manageHistory) history.pushState({ ...history.state, tinyStarStory: navigationId, tinyStarTool: null }, "");
    void library(); if (session && visible) schedulePreview(0); status();
  }
  function close(manageHistory = true) {
    const hadTool = Boolean(history.state?.tinyStarTool);
    closeTool(false, false); importing?.abort(); importing = null; visible = false;
    clearRenders(); root.close(); void persist().catch(() => {});
    if (manageHistory && history.state?.tinyStarStory === navigationId) history.go(hadTool ? -2 : -1);
  }
  function closeTool(commit, manageHistory = true) {
    if (!tool) return;
    const kind = tool; tool = null;
    sourceConversion?.controller.abort(); sourceConversion = null;
    for (const image of sheet.querySelectorAll("[data-connection-slide], [data-cutout-effect-preview]")) image.removeAttribute("src");
    toolError = "";
    sheet.classList.remove("story-cutout-sheet");
    if (commit) stylePanel?.commit(); stylePanel?.dispose(); stylePanel = null;
    maskPanel?.dispose(); maskPanel = null; effectPanel = null; toolBusy = false;
    toolEpoch++; for (const task of lookTasks) task.cancel(); lookTasks.clear();
    for (const entry of lookPreviews) release(entry); lookPreviews.length = 0;
    if (session?.history.base) { if (commit) session.history.commit(`Change ${kind}`); else session.history.cancel();
      variantId = documentNow().recipe.outputVariant ?? documentNow().variants[0].id; edited(); }
    if (session) pruneStorySources(session);
    clearOutputs(); sheet.close(); status();
    if (manageHistory && history.state?.tinyStarTool) history.back();
  }
  function choosePhoto(content, changed, filter = () => true) {
    const options = () => slidePhotos(documentNow(), slideId).filter(filter);
    const photos = options(), picker = select([], "", "Photo to edit");
    content.append(field("Photo", picker)); const controls = document.createElement("div"); content.append(controls);
    const update = (selected = picker.value, nextSlideId = null) => {
      if (nextSlideId && nextSlideId !== slideId) { slideId = nextSlideId; renderFilmstrip(); schedulePreview(0); }
      picker.replaceChildren();
      for (const [index, photo] of options().entries()) { const option = document.createElement("option"); option.value = photo.id;
        option.textContent = `${photo.connection ? "Connected cutout" : `Photo ${index + 1}`}: ${documentNow().assets[photo.assetId].name}`; picker.append(option); }
      if (options().some((photo) => photo.id === selected)) picker.value = selected;
      controls.replaceChildren(); changed(documentNow().nodes[picker.value], controls, update); ledger(); refreshConnectionPreview(); status();
    };
    picker.addEventListener("change", () => update()); update(photos.some((photo) => photo.id === preferredPhotoId) ? preferredPhotoId : photos[0]?.id);
  }
  function openTool(kind, manageHistory = true, photoId = null) {
    if (!session) return;
    const prior = Boolean(tool); if (tool) closeTool(false, false);
    preferredPhotoId = photoId;
    tool = kind; const content = get("sheet-content"); content.replaceChildren(); get("sheet-title").textContent = { look: "Choose a look", layout: "Layout", photos: "Frame your photos", text: "Your words", adjust: "Adjust this photo", cutout: "Cut out a subject", export: "Export your story" }[kind];
    sheet.classList.toggle("story-cutout-sheet", kind === "cutout");
    get("sheet-apply").hidden = kind === "export"; get("sheet-cancel").textContent = kind === "export" ? "Done" : "Cancel";
    if (kind === "look") {
      const baseProject = clone(documentNow()), owner = session, selectedSlide = slideId, epoch = toolEpoch;
      stylePanel = mountStylePanel({ content, sheet, project: baseProject, getProject: documentNow, slideId,
        onBusy: (value) => { if (session === owner && tool === "look" && toolEpoch === epoch) { toolBusy = value; status(); } },
        onPreview: async (style, { signal, ...options }) => {
          const command = storyStyleCommand(baseProject, style, options);
          await Promise.all(style.assets.map((asset) => fontsFor(owner).read(asset, { signal })));
          if (signal.aborted || tool !== "look" || toolEpoch !== epoch || session !== owner) throw new DOMException("Preview closed", "AbortError");
          const accepted = previewEdit(() => {
            session.history.cancel();
            const nextVariant = style.components.output?.variant ?? baseProject.recipe.outputVariant;
            if (variantId !== nextVariant) { variantId = nextVariant; clearRenders(); }
            return command;
          });
          if (!accepted) throw new Error(error); return true;
        },
        renderThumbnail: async (style, { signal, ...options }) => {
          const project = applyProjectCommand(baseProject, storyStyleCommand(baseProject, style, options)).project;
          const task = enqueueScene({ project, slideId: selectedSlide, variantId: project.recipe.outputVariant, preview: true, previewEdge: 160,
            priority: 3, signal, readAsset: readSource(owner, project) }); lookTasks.add(task);
          try {
            const result = await task.promise;
            if (signal.aborted || tool !== "look" || toolEpoch !== epoch || session !== owner) throw new DOMException("Preview closed", "AbortError");
            const entry = makeEntry(result, style.id); lookPreviews.push(entry); ledger(); return entry;
          } finally { lookTasks.delete(task); }
        },
        releaseThumbnail: (entry) => { release(entry); const index = lookPreviews.indexOf(entry); if (index >= 0) lookPreviews.splice(index, 1); ledger(); },
        onError: (message) => { if (session === owner) { error = message; status(); } },
      });
    } else if (kind === "cutout") {
      choosePhoto(content, (photo, controls, refresh) => {
        maskPanel?.dispose();
        mountConnectionPanel(controls, { photoId: photo.id, slideId, variantId, getProject: documentNow,
          onCommand: (command) => !toolBusy && !toolError && previewEdit(command), onSelectPhoto: refresh });
        effectPanel = mountCutoutEffectsPanel(controls, { photoId: photo.id, getProject: documentNow,
          onCommand: (command) => !toolBusy && !toolError && previewEdit(command) });
        let maskControls = controls;
        if (photo.connection) { maskControls = document.createElement("details"); maskControls.className = "story-connection-refine";
          const title = document.createElement("summary"); title.textContent = "Refine this subject"; maskControls.append(title); controls.append(maskControls); }
        const owner = session, selected = photo.id, asset = clone(documentNow().assets[photo.assetId]), original = clone(documentNow().assets[photo.maskId] ?? null);
        const originalBlob = original ? owner.sources.get(original.id) : null, draftId = newId("mask");
        maskPanel = mountMaskPanel({ content: maskControls, source: { asset, blob: owner.sources.get(asset.id) },
          mask: original ? { asset: original, blob: originalBlob } : undefined,
          onBusy: (value) => { toolBusy = value; status(); }, onError: (message) => { toolError = message; status(); },
          onChange: (entry) => {
            if (session !== owner || documentNow().nodes[selected]?.assetId !== asset.id) throw new Error("This photo changed. Open Cutout again.");
            const next = entry.original ? original : entry.remove ? null : { ...entry.asset, id: draftId };
            const blob = entry.original ? originalBlob : entry.blob;
            const previous = next ? owner.sources.get(next.id) : null;
            if (next) owner.sources.set(next.id, blob);
            if (!previewEdit(() => storyMaskCommand(documentNow(), selected, next))) {
              if (next) { if (previous) owner.sources.set(next.id, previous); else owner.sources.delete(next.id); }
              throw new Error(error);
            }
            ledger();
          },
        });
        if (photo.depthTextId) { const note = document.createElement("p"); note.className = "story-note"; note.textContent = "This mask also controls a depth title. Removing the mask keeps your words in front until you choose a subject again."; controls.append(note); }
      });
    } else if (kind === "text") {
      preferredPhotoId ??= slidePhotos(documentNow(), slideId).find((photo) => photo.depthTextId)?.id ?? null;
      const tabs = document.createElement("div"); tabs.className = "story-style-tabs"; tabs.setAttribute("aria-label", "Text editing mode");
      const captionPane = document.createElement("section"), depthPane = document.createElement("section");
      const show = (depth) => { captionPane.hidden = depth; depthPane.hidden = !depth; captionTab.setAttribute("aria-pressed", String(!depth)); depthTab.setAttribute("aria-pressed", String(depth)); };
      const captionTab = action("Caption", () => show(false)), depthTab = action("Depth title", () => show(true));
      tabs.append(captionTab, depthTab); content.append(tabs, captionPane, depthPane);
      if (Object.values(documentNow().nodes).some((node) => node.kind === "text" && node.fontId)) {
        const note = document.createElement("p"); note.className = "story-note";
        note.textContent = "This story uses saved font files. If a font cannot load or lacks a character, choose device fonts. Their appearance can vary between devices.";
        content.append(note, action("Use device fonts for this story", () => {
          if (previewEdit(() => storyDeviceFontsCommand(documentNow()))) { note.textContent = "Previewing device fonts. Apply to keep them, or Cancel to restore the saved fonts."; }
        }));
      }
      const id = documentNow().slides.find((slide) => slide.id === slideId).nodeIds.find((id) => id.endsWith(":caption"));
      const input = document.createElement("textarea"); input.rows = 4; input.maxLength = 500; input.value = documentNow().nodes[id].text; input.setAttribute("aria-label", "Slide caption");
      input.addEventListener("input", () => nodeEdit(id, { text: input.value })); captionPane.append(field("Slide caption", input));
      captionPane.append(range("Text size", documentNow().nodes[id].style.fontSize, .02, .12, .002, (value) => nodeEdit(id, { style: { ...documentNow().nodes[id].style, fontSize: value } })));
      choosePhoto(depthPane, (photo, controls) => mountDepthPanel(controls, { photoId: photo.id, getProject: documentNow,
        onCommand: (command) => previewEdit(command), onEditSubject: () => {
          if (get("sheet-apply").disabled) return;
          closeTool(true, false); void persist().catch(() => {}); openTool("cutout", false, photo.id);
          history.replaceState({ ...history.state, tinyStarTool: "cutout" }, "");
        } }));
      show(slidePhotos(documentNow(), slideId).some((photo) => photo.depthTextId));
    } else if (kind === "photos") {
      choosePhoto(content, (photo, controls, refresh) => {
        sourceConversion?.controller.abort(); sourceConversion = null; toolBusy = false; toolError = "";
        const source = documentNow().assets[photo.assetId];
        const picker = select(Object.values(documentNow().assets).filter((asset) => asset.kind === "image").map((asset) => [asset.id, `${asset.name} · ${asset.width} × ${asset.height}`]), photo.assetId, "Source photo");
        if (source.workingCopy || Math.max(source.width, source.height) > WORKING_COPY_EDGE) {
          const note = document.createElement("p"); note.className = "story-note"; note.dataset.sourceResolutionNote = ""; note.setAttribute("role", "status");
          note.textContent = source.workingCopy
            ? "This smaller editing copy is also used for exports. Restore the original photo with your current cutout and framing. If you changed the smaller cutout, resizing it cannot recover its original edge detail."
            : "A 2,048px editing copy can reduce processing memory. Exports will use its reduced detail. Your original photo and cutout are kept, with framing and text unchanged.";
          const convert = action(source.workingCopy ? "Use original with current cutout" : "Make smaller editing copy", async () => {
            const owner = session, project = documentNow(), revision = project.revision, epoch = toolEpoch;
            const current = { controller: new AbortController() }, reservation = { bytes: 0 };
            sourceConversion = current; importReservations.add(reservation); toolBusy = true; toolError = "";
            const inputs = [...controls.querySelectorAll("input, select, button")]; inputs.forEach(input => { input.disabled = true; }); status();
            const active = () => sourceConversion === current && session === owner && tool === "photos" && toolEpoch === epoch && controls.isConnected;
            try {
              const result = await prepareSourceResolution(project, photo.id, source.workingCopy ? "original" : "working", {
                readAsset: readSource(owner, project), signal: current.controller.signal, pool,
                onRetainedBytes: bytes => { reservation.bytes = bytes; ledger(); },
              });
              if (!active() || current.controller.signal.aborted) return;
              if (documentNow().revision !== revision) throw new Error("The story changed during conversion. Try again to keep the latest edits.");
              for (const [id, blob] of result.sources) owner.sources.set(id, blob);
              reservation.bytes = 0; ledger();
              if (!previewEdit(result.command)) { for (const id of result.sources.keys()) owner.sources.delete(id); throw new Error(error); }
              sourceConversion = null; toolBusy = false; refresh(photo.id);
              const notice = controls.querySelector("[data-source-resolution-note]");
              if (notice) notice.textContent = result.upsampledMask
                ? "Original photo restored. Your edited cutout was resized to match; resizing cannot recover finer edge detail. Apply to keep this, or Cancel."
                : result.restoredMask ? "Original photo and original cutout restored. Framing and text are unchanged. Apply to keep this, or Cancel."
                : "Photo size updated with framing, text and cutout preserved. Exports use the selected source. Apply to keep this, or Cancel.";
              controls.querySelector("[data-source-resolution]")?.focus({ preventScroll: true });
            } catch (failure) {
              if (active() && failure.name !== "AbortError") { toolError = failure.message; status(); }
            } finally {
              importReservations.delete(reservation); ledger();
              if (active()) { sourceConversion = null; toolBusy = false; inputs.forEach(input => { input.disabled = false; }); status(); }
            }
          });
          convert.dataset.sourceResolution = "";
          controls.append(note, convert);
        }
        controls.append(field("Use photo", picker)); picker.addEventListener("change", () => {
          if (documentNow().nodes[photo.id].assetId === picker.value) return;
          const command = storyMaskCommand(documentNow(), photo.id, null);
          const change = command.commands.find((entry) => entry.type === "node" && entry.id === photo.id);
          change.value.assetId = picker.value;
          if (previewEdit(() => withStoryReflow(documentNow(), command, slideId))) refresh(); });
        const crop = photo.crop ?? { x: 0, y: 0, width: 1, height: 1 };
        const baseZoom = 1 / Math.max(crop.width, crop.height), cropRatio = crop.width / crop.height;
        controls.append(range("Crop zoom", baseZoom, 1, Math.max(3, baseZoom), .05, (zoom) => {
          const current = documentNow().nodes[photo.id], focal = current.focal ?? { x: .5, y: .5 };
          const width = Math.min(1, cropRatio) / zoom, height = Math.min(1, 1 / cropRatio) / zoom;
          nodeEdit(photo.id, { crop: { x: (1 - width) * focal.x, y: (1 - height) * focal.y, width, height } });
        }));
        for (const [axis, label] of [["x", "Frame left / right"], ["y", "Frame up / down"]]) controls.append(range(label, photo.focal?.[axis] ?? .5, 0, 1, .01,
          (value) => { const current = documentNow().nodes[photo.id], focal = { x: .5, y: .5, ...current.focal, [axis]: value }, patch = { focal };
            if (current.crop) patch.crop = { ...current.crop, [axis]: (1 - current.crop[axis === "x" ? "width" : "height"]) * value };
            nodeEdit(photo.id, patch); }));
        const hint = document.createElement("p"); hint.className = "story-note"; hint.textContent = "Zoom in to crop, then move the framing. Layout keeps the photo’s proportions."; controls.append(hint);
        controls.append(action("Use the full photo", () => { const value = { ...documentNow().nodes[photo.id], focal: { x: .5, y: .5 } }; delete value.crop;
          if (previewEdit(() => withStoryReflow(documentNow(), { type: "node", id: photo.id, value }, slideId))) refresh(); }));
        const fit = select([["cover", "Fill the frame"], ["contain", "Fit inside the frame"]], photo.fit ?? "cover", "Photo fitting");
        controls.append(field("Fitting", fit)); fit.addEventListener("change", () => nodeEdit(photo.id, { fit: fit.value }));
      });
      content.append(action("Start another story", () => { closeTool(false); void persist().then(() => {
        visible = false; clearRenders(); get("body").hidden = true; get("intro").hidden = false; get("name").textContent = "Photo stories"; void library(); status();
      }).catch((failure) => status(failure.message)); }));
    } else if (kind === "adjust") {
      choosePhoto(content, (photo, controls, refresh) => {
        const resolved = resolveSlide(documentNow(), slideId, variantId).nodes.find((node) => node.id === photo.id);
        for (const [key, label] of [["brightness", "Brightness"], ["contrast", "Contrast"], ["saturation", "Color"]]) controls.append(range(label,
          resolved.appearance[key] ?? 1, 0, 2, .02, (value) => {
            const current = documentNow(), slides = clone(current.slides), patch = slides.find((slide) => slide.id === slideId).overrides[photo.id];
            if (patch?.appearance) delete patch.appearance[key];
            previewEdit({ type: "group", commands: [{ type: "node", id: photo.id, value: { ...current.nodes[photo.id], appearance: { ...current.nodes[photo.id].appearance, [key]: value } } }, { type: "slides", value: slides }] });
          }));
        controls.append(action("Use the story look", () => {
          const node = { ...documentNow().nodes[photo.id] }, slides = clone(documentNow().slides), slide = slides.find((entry) => entry.id === slideId);
          delete node.appearance; delete node.appearanceBase;
          if (slide.overrides[photo.id]) { delete slide.overrides[photo.id].appearance; if (!Object.keys(slide.overrides[photo.id]).length) delete slide.overrides[photo.id]; }
          if (previewEdit({ type: "group", commands: [{ type: "node", id: photo.id, value: node }, { type: "slides", value: slides }] })) refresh();
        }));
      });
    } else if (kind === "layout") {
      const ratio = select(documentNow().variants.map((variant) => [variant.id, variant.id === "portrait" ? "Portrait · 4:5" : "Tall · 9:16"]), variantId, "Story shape");
      content.append(field("Preview and export shape", ratio)); ratio.addEventListener("change", () => {
        variantId = ratio.value; clearRenders(); previewEdit({ type: "recipe", value: { ...documentNow().recipe, outputVariant: variantId } });
      });
      const note = document.createElement("p"); note.className = "story-note"; note.dataset.layoutNote = ""; note.setAttribute("role", "status");
      const layoutControls = document.createElement("div"); content.append(note, layoutControls);
      const updateLayout = () => {
        const adaptive = hasAdaptiveLayout(documentNow(), slideId);
        note.textContent = adaptive ? reviewStoryLayout(documentNow(), slideId, variantId).length
          ? "Some adjusted positions overlap or leave the page. Keep them, or reset positions below."
          : "Photos adapt to each shape. Adjusted positions stay where you put them."
          : "This saved slide keeps its original positions. Choose Adapt to photos to rearrange it.";
        layoutControls.replaceChildren();
        if (!adaptive) { layoutControls.append(action("Adapt to photos", () => { if (previewEdit(() => adaptStoryLayoutCommand(documentNow(), slideId))) updateLayout(); })); return; }
        const arrangement = select([["auto", "Auto"], ["row", "Side by side"], ["stack", "Stacked"]], documentNow().recipe.layout.slides[slideId].arrangement, "Photo arrangement");
        layoutControls.append(field("Arrange this slide", arrangement));
        arrangement.addEventListener("change", () => { if (previewEdit(() => adaptStoryLayoutCommand(documentNow(), slideId, { arrangement: arrangement.value }))) updateLayout(); });
        const fit = select([["contain", "Keep whole crop"], ["cover", "Fill the frame"]], documentNow().recipe.layout.slides[slideId].fit ?? "contain", "Photo fit");
        layoutControls.append(field("Photo fit", fit));
        fit.addEventListener("change", () => { if (previewEdit(() => adaptStoryLayoutCommand(documentNow(), slideId, { fit: fit.value }))) updateLayout(); });
        if (fit.value === "cover") { const hint = document.createElement("p"); hint.className = "story-note";
          hint.textContent = "Photos fill their frames. Open Photos to adjust the crop if your subject is cut off."; layoutControls.append(hint); }
        layoutControls.append(action("Reset adjusted positions", () => { if (previewEdit(() => adaptStoryLayoutCommand(documentNow(), slideId, { resetPositions: true }))) updateLayout(); }));
        const resetNote = document.createElement("p"); resetNote.className = "story-note"; resetNote.textContent = "Reset applies to both shapes on this slide. Crops and colors are kept."; layoutControls.append(resetNote);
        choosePhoto(layoutControls, (photo, controls) => {
          const pair = documentNow().recipe.layout.slides[slideId].photos.find((entry) => entry.imageId === photo.id);
          const resolved = resolveSlide(documentNow(), slideId, variantId);
          const reference = Object.fromEntries(resolved.nodes.filter((node) => [pair.imageId, pair.borderId].includes(node.id)).map((node) => [node.id, node.frame]));
          const current = reference[photo.id], position = { x: current.x + current.width / 2, y: current.y + current.height / 2, scale: 1 };
          for (const [key, label, min, max] of [["x", "Position left / right", 0, 1], ["y", "Position up / down", 0, 1], ["scale", "Print size", .5, 1.5]]) {
            controls.append(range(label, position[key], min, max, .01, (value) => {
              position[key] = value; if (previewEdit(() => positionStoryPhotoCommand(documentNow(), slideId, variantId, photo.id, position, reference))) {
                note.textContent = reviewStoryLayout(documentNow(), slideId, variantId).length ? "Some adjusted positions overlap or leave the page. Keep them, or reset positions below." : "Position adjusted for this shape. The other shape is unchanged.";
              }
            }));
          }
        }, (photo) => !photo.connection);
      };
      updateLayout(); ratio.addEventListener("change", updateLayout);
      content.append(action("Tilted prints", () => { if (previewEdit(() => storyLayoutCommand(documentNow(), slideId, "prints"))) updateLayout(); }),
        action("Straight frames", () => { if (previewEdit(() => storyLayoutCommand(documentNow(), slideId, "straight"))) updateLayout(); }));
      const moveNote = document.createElement("p"); moveNote.className = "story-note";
      const group = connectedSlideGroup(documentNow(), slideId);
      moveNote.textContent = group.ids.length > 1 ? `${group.ids.length} slides share connected cutouts and move together. Remove or move a connected copy in Cutout to separate them.` : "Move this slide in the story."; content.append(moveNote);
      for (const [offset, label] of [[-1, "Move slide earlier"], [1, "Move slide later"]]) {
        const button = action(label, () => {
          previewEdit(moveStorySlide(documentNow(), slideId, offset));
          for (const control of content.querySelectorAll("[data-shift]")) control.disabled = !canMoveStorySlide(documentNow(), slideId, Number(control.dataset.shift));
        });
        button.dataset.shift = String(offset);
        button.disabled = !canMoveStorySlide(documentNow(), slideId, offset); content.append(button);
      }
    } else if (kind === "export") exportPanel(content);
    sheet.showModal(); status();
    if (manageHistory) history[prior ? "replaceState" : "pushState"]({ ...history.state, tinyStarStory: navigationId, tinyStarTool: kind }, "");
  }
  function exportPanel(content) {
    const owner = session;
    exportPanelController = mountStoryExportPanel({ content, getProject: documentNow,
      readAsset: project => readSource(owner, project), notices: renderNotices,
      retained: entries => { outputs.splice(0, outputs.length, ...entries); ledger(); },
      saveSelection: ({ format, variants }) => {
        owner.history.apply({ type: "recipe", value: { ...documentNow().recipe, outputFormat: format, outputVariants: variants } }, "Change export choices");
        owner.autoSave = true; scheduleSave(); status();
      },
    });
  }

  document.querySelectorAll("[data-open-story]").forEach((button) => button.addEventListener("click", () => open()));
  get("batches").addEventListener("click",()=>void openStoryBatchPanel(get("batches")));
  get("groups").addEventListener("click", () => {
    void persist().then(() => openStoryGroupPanel(get("groups"), { onSaved: library })).catch(error => status(error.message));
  });
  get("choose").addEventListener("click", () => get("files").click());
  get("files").addEventListener("change", async () => {
    const files = Array.from(get("files").files); get("files").value = ""; if (!files.length) return;
    if (files.length < 6 || files.length > 12) { status("Choose 6–12 photos to build a story."); return; }
    if (files.reduce((sum, file) => sum + file.size, 0) > STORY_SOURCE_LIMIT) { status("These photos exceed 96 MB. Choose smaller copies."); return; }
    importing?.abort(); const controller = new AbortController(); importing = controller; get("choose").disabled = true;
    const reservation = { bytes: [...new Set(files)].reduce((sum, file) => sum + file.size, 0) }; importReservations.add(reservation); ledger();
    const smallerCopies = get("small-copies").checked;
    try {
      await persist();
      const entries = await importStoryPhotos(files, { signal: controller.signal, smallerCopies,
        onRetainedBytes: (bytes) => { reservation.bytes = bytes; ledger(); },
        onProgress: (count, total) => status(`Preparing photo ${count} of ${total}…`) });
      if (controller.signal.aborted || !root.open) return;
      const base = createPhotoStory(entries.map((entry) => entry.asset), { title: get("title").value, originals: entries.flatMap((entry) => entry.original ? [entry.original.asset] : []) });
      const project = applyProjectCommand(base, storyStyleCommand(base, curatedStoryStyles({ revision: get("device-fonts").checked ? 1 : 2 })[0])).project;
      const sources = new Map(entries.flatMap((entry) => [entry, entry.original].filter(Boolean).map(({ asset, source }) => [asset.id, source])));
      importReservations.delete(reservation);
      showSession({ sources, history: new ProjectHistory(project), savedRevision: null, autoSave: true });
      scheduleSave();
    } catch (failure) { if (failure.name !== "AbortError") status(failure.message); }
    finally { importReservations.delete(reservation); if (importing === controller) importing = null; get("choose").disabled = false; ledger(); }
  });
  get("back").addEventListener("click", () => close());
  root.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  sheet.addEventListener("cancel", (event) => { event.preventDefault(); closeTool(false); });
  get("sheet-cancel").addEventListener("click", () => closeTool(false)); get("sheet-apply").addEventListener("click", () => closeTool(true));
  get("retry-preview").addEventListener("click", () => schedulePreview(0));
  root.querySelectorAll("[data-story-tool]").forEach((button) => button.addEventListener("click", () => openTool(button.dataset.storyTool)));
  get("export").addEventListener("click", () => openTool("export"));
  for (const command of ["undo", "redo"]) get(command).addEventListener("click", () => runHistory(command));
  get("retry-save").addEventListener("click", () => { session.saveError = null; void persist().catch(() => {}); });
  get("save-copy").addEventListener("click", () => {
    const project = clone(documentNow()); project.id = newId("project"); project.revision = 0; project.name = `${project.name.slice(0, 70)} (copy)`;
    showSession({ sources: new Map(session.sources), history: new ProjectHistory(project), savedRevision: null, autoSave: true }); scheduleSave();
  });
  addEventListener("popstate", (event) => {
    if (event.state?.tinyStarStory !== navigationId) { if (root.open) close(false); return; }
    if (!root.open) open(false);
    if (!event.state.tinyStarTool && tool) closeTool(false, false);
    else if (event.state.tinyStarTool && !tool && session) openTool(event.state.tinyStarTool, false);
  });
  addEventListener("tinystar:local-data-clearing", () => { clearTimeout(saveTimer); if (session) session.autoSave = false; });
  addEventListener("tinystar:local-data-cleared", () => { if (session) { session.savedRevision = null; session.saveError = null; } void library(); status(); });
  root.addEventListener("keydown", (event) => {
    if (!session || tool || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); runHistory(event.shiftKey ? "redo" : "undo"); }
  });
  return { open };
}
