import { action, field, range, select } from "./view.js";
import { captureStoryStyle, curatedStyles, curatedStoryStyles, MAX_STYLE_BYTES, parseStyle, serializeStyle, styleCompatibility, styleFromLook, styleHasStrength, styleKey, styleSubjectSummary } from "../styles/model.js";
import { putStyle, readStyleLibrary, removeStyle, STYLE_CHANGE_EVENT } from "../styles/store.js";
import { readableSlug } from "../names.js";

export function mountStylePanel({ content, sheet, project, getProject, slideId, onPreview, renderThumbnail, releaseThumbnail, onError, onBusy = () => {} }) {
  let tab = "for", savedFilter = "all", records = [], libraryIssues = [], generation = 0, disposed = false, shown = 12;
  let selected = project.recipe.style?.definition ?? styleFromLook(project.recipe.definition);
  let strength = project.recipe.style?.strength ?? project.recipe.strength ?? 1, applied = null;
  const initial = { style: selected, strength, slideId: null, keepPositions: true };
  const resources = new Map(), requests = new Map();
  let previewRequest, previewSequence = 0;
  const scope = select([["all", "Whole story"], ["this", "This slide"]], "all", "Look scope");
  const scopeField = field("Apply to", scope);
  const navigation = document.createElement("nav"); navigation.className = "story-style-tabs"; navigation.setAttribute("aria-label", "Style library");
  const filters = select([["all", "All saved"], ["favorites", "Favorites"], ["custom", "My styles"]], "all", "Saved style filter");
  const filterField = field("Show", filters); filterField.hidden = true;
  const cards = document.createElement("div"); cards.className = "story-looks";
  const message = document.createElement("p"); message.className = "story-note"; message.setAttribute("role", "status");
  const selection = document.createElement("p"); selection.className = "story-note";
  const keep = document.createElement("input"); keep.type = "checkbox"; keep.checked = true; keep.setAttribute("aria-label", "Keep adjusted positions");
  const keepField = field("Keep adjusted positions", keep); keepField.classList.add("story-check");
  const fontOptions = document.createElement("details"), fontSummary = document.createElement("summary"); fontOptions.className = "story-font-options"; fontSummary.textContent = "Font options · up to 2.24 MB";
  const deviceFonts = document.createElement("input"); deviceFonts.type = "checkbox"; deviceFonts.setAttribute("aria-label", "Use device fonts for recipes");
  const fontField = field("Use device fonts", deviceFonts); fontField.classList.add("story-check");
  const fontNote = document.createElement("p"); fontNote.className = "story-note";
  fontNote.textContent = "Story fonts load from this site (up to 2.24 MB) and stay with saved stories. Device fonts need no download, but their appearance can vary.";
  const fontLicenses = document.createElement("a"); fontLicenses.href = new URL("../assets/story-type-v1/README.md", import.meta.url); fontLicenses.target = "_blank"; fontLicenses.rel = "noopener"; fontLicenses.textContent = "Font licenses and source";
  fontOptions.append(fontSummary, fontField, fontNote, fontLicenses);
  const strengthControl = range("Photo color strength", strength, 0, 1, .05, (value) => { strength = value; preview(); });
  const more = action("Show more styles", () => { shown += 12; renderCards(); }); more.hidden = true;
  const actions = document.createElement("div"); actions.className = "story-style-actions";
  const saveForm = document.createElement("form"); saveForm.className = "story-style-form"; saveForm.hidden = true;
  const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.accept = ".tstyle,.json,application/json"; fileInput.hidden = true; fileInput.setAttribute("aria-label", "Import style file");
  content.append(scopeField, navigation, filterField, cards, more, selection, strengthControl, keepField, fontOptions, message, actions, saveForm, fileInput);
  const say = (text) => { if (!disposed) message.textContent = text; };
  const tabs = new Map();
  for (const [id, label] of [["for", "For this story"], ["looks", "Photo looks"], ["saved", "Saved"], ["recent", "Recent"]]) {
    const button = action(label, () => { tab = id; shown = 12; renderCards(); }); tabs.set(id, button); navigation.append(button);
  }
  filters.addEventListener("change", () => { savedFilter = filters.value; shown = 12; renderCards(); });
  deviceFonts.addEventListener("change", () => {
    if (selected.id.startsWith("builtin:story-") && (applied || previewRequest)) {
      selected = curatedStoryStyles({ revision: deviceFonts.checked ? 1 : 2 }).find((style) => style.id === selected.id);
      void preview();
    }
    renderCards();
  });

  function stopPreviews() {
    for (const request of requests.values()) request.abort(); requests.clear();
    for (const entry of resources.values()) releaseThumbnail(entry); resources.clear(); observer?.disconnect();
  }
  function selectionState() {
    for (const button of cards.querySelectorAll("[data-style-key]")) button.setAttribute("aria-pressed", String(button.dataset.styleKey === styleKey(selected)));
    strengthControl.hidden = !applied || !styleHasStrength(selected); keepField.hidden = !applied || (!selected.components.layout && !selected.components.depthTitle && !selected.components.storyDesign);
    scope.disabled = Boolean(applied?.style.components.storyDesign);
    scopeField.hidden = tab === "for" || scope.disabled;
    const input = strengthControl.querySelector("input"); input.value = strength; strengthControl.querySelector("output").value = strength;
    selection.textContent = `${selected.name} · revision ${selected.revision}. ${selected.components.storyDesign ? "This recipe changes framing and type across the whole story. Your captions, crops and masks stay." : "Local photo corrections stay in place."}${selected.components.output ? " Output settings apply to the whole story." : ""} ${styleSubjectSummary(selected, project, scope.value === "this" ? slideId : null)}`;
  }
  async function preview() {
    previewRequest?.abort(); const controller = new AbortController(), sequence = ++previewSequence; previewRequest = controller;
    const chosen = selected; onBusy(true); if (chosen.assets.length) say("Loading the recipe’s licensed fonts…");
    const options = { strength, slideId: scope.value === "this" ? slideId : null, keepPositions: keep.checked };
    try {
      const problem = styleCompatibility(chosen, project, null, options.slideId); if (problem) throw new Error(problem);
      const result = onPreview(chosen, { ...options, signal: controller.signal });
      // Preserve synchronous consumers while allowing asset preparation to be
      // cancelled before an asynchronous preview changes the document.
      if (!(typeof result?.then === "function" ? await result : result)) throw new Error("This style could not be previewed. The previous choice is kept.");
      if (disposed || controller.signal.aborted || sequence !== previewSequence) return;
      applied = { style: chosen, ...options };
      say(selected.components.layout || selected.components.depthTitle || selected.components.storyDesign ? "Review the new arrangement before applying. Adjusted positions follow the choice above." : "Previewing this style. Apply to keep it.");
    } catch (error) {
      if (disposed || controller.signal.aborted || sequence !== previewSequence) return;
      const previous = applied ?? initial; selected = previous.style; strength = previous.strength;
      scope.value = previous.slideId ? "this" : "all"; keep.checked = previous.keepPositions; say(error.message);
    } finally { if (!disposed && sequence === previewSequence) onBusy(false); }
    selectionState();
  }
  scope.addEventListener("change", () => { if (applied) preview(); renderCards(); }); keep.addEventListener("change", preview);

  async function thumbnail(card, style) {
    const key = styleKey(style); if (requests.has(key) || resources.has(key) || disposed) return;
    const controller = new AbortController(), currentGeneration = generation; requests.set(key, controller);
    try {
      const entry = await renderThumbnail(style, { signal: controller.signal, slideId: scope.value === "this" && !style.components.storyDesign ? slideId : null });
      if (disposed || controller.signal.aborted || currentGeneration !== generation || !card.isConnected) { releaseThumbnail(entry); return; }
      resources.set(key, entry); const image = new Image(); image.alt = ""; image.src = entry.url; card.querySelector("[data-style-key]").prepend(image);
    } catch (error) {
      if (!controller.signal.aborted && !disposed && currentGeneration === generation) {
        const detail = card.querySelector("small"); detail.textContent = "Preview unavailable. Tap to review the full result.";
      }
    } finally { if (requests.get(key) === controller) requests.delete(key); }
  }
  const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!target.isConnected || target.parentElement !== cards) continue;
      const key = target.dataset.cardKey, style = target.styleDefinition;
      if (isIntersecting) void thumbnail(target, style);
      else {
        requests.get(key)?.abort(); requests.delete(key);
        const entry = resources.get(key); if (entry) { releaseThumbnail(entry); resources.delete(key); target.querySelector("img")?.remove(); }
      }
    }
  }, { root: sheet, rootMargin: "80px" }) : null;

  function renderCards() {
    if (disposed) return;
    generation++; stopPreviews();
    const focusKey = document.activeElement?.dataset.favoriteKey;
    cards.replaceChildren(); filterField.hidden = tab !== "saved";
    fontOptions.hidden = tab !== "for";
    for (const [id, button] of tabs) button.setAttribute("aria-pressed", String(tab === id));
    let styles = tab === "for" ? curatedStoryStyles({ revision: deviceFonts.checked ? 1 : 2 }) : curatedStyles();
    if (tab === "saved") styles = records.filter((record) => savedFilter === "favorites" ? record.favorite
      : savedFilter === "custom" ? record.origin === "custom" : record.favorite || ["custom", "imported"].includes(record.origin))
      .sort((a, b) => b.savedAt - a.savedAt || a.key.localeCompare(b.key)).map((record) => record.style);
    if (tab === "recent") styles = records.filter((record) => record.lastUsed > 0).sort((a, b) => b.lastUsed - a.lastUsed || a.key.localeCompare(b.key)).slice(0, 12).map((record) => record.style);
    more.hidden = styles.length <= shown;
    for (const style of styles.slice(0, shown)) {
      const key = styleKey(style), record = records.find((entry) => entry.key === key), problem = styleCompatibility(style, project, null, scope.value === "this" && !style.components.storyDesign ? slideId : null);
      const card = document.createElement("article"); card.className = "story-style-card"; card.dataset.cardKey = key; card.styleDefinition = style;
      const button = action(style.name, () => { selected = style; strength = 1; if (style.components.storyDesign) scope.value = "all"; preview(); });
      button.dataset.styleKey = key; button.dataset.look = style.id.replace(/^builtin:/, ""); button.disabled = Boolean(problem);
      const detail = document.createElement("small"); detail.textContent = problem || style.description; button.append(detail); card.append(button);
      const favorite = action(record?.favorite ? `Unfavorite ${style.name}` : `Favorite ${style.name}`, async () => {
        favorite.disabled = true;
        try { await putStyle(style, { origin: "recent", favorite: !record?.favorite }); await refreshLibrary(); say(record?.favorite ? "Removed from favorites." : "Saved to favorites."); }
        catch (error) { say(error.message); favorite.disabled = false; }
      });
      favorite.classList.add("story-style-favorite"); favorite.dataset.favoriteKey = key; favorite.setAttribute("aria-pressed", String(Boolean(record?.favorite))); card.append(favorite);
      if (record && ["custom", "imported"].includes(record.origin)) card.append(action(`Remove ${style.name}`, async () => {
        try { await removeStyle(key); await refreshLibrary(); say("Style removed from the library. Applied copies in projects are kept."); } catch (error) { say(error.message); }
      }));
      cards.append(card);
      if (!problem) { if (observer) observer.observe(card); else void thumbnail(card, style); }
    }
    if (!styles.length) { const empty = document.createElement("p"); empty.className = "story-note"; empty.textContent = tab === "recent" ? "Styles appear here after you apply them." : "Favorite a look or save your own style to see it here."; cards.append(empty); }
    if (focusKey) [...cards.querySelectorAll("[data-favorite-key]")].find((button) => button.dataset.favoriteKey === focusKey)?.focus({ preventScroll: true });
    selectionState();
  }

  let readSequence = 0;
  async function refreshLibrary() {
    const sequence = ++readSequence;
    try {
      const library = await readStyleLibrary(); if (disposed || sequence !== readSequence) return;
      records = library.records.filter((record) => record.style.kind === "tiny-image-star/style");
      libraryIssues = library.issues; renderCards(); if (libraryIssues.length) say(libraryIssues.join(" "));
    } catch (error) { say(`Style library unavailable: ${error.message}. Built-in looks remain available.`); }
  }

  function showSaveForm() {
    saveForm.hidden = false; saveForm.replaceChildren();
    const name = document.createElement("input"); name.value = "My style"; name.maxLength = 80; name.required = true; name.setAttribute("aria-label", "Style name");
    saveForm.append(field("Name", name)); const inclusions = new Map();
    for (const [key, label, checked] of [["look", "Look", true], ["text", "Text style", true], ["layout", "Layout", false], ["output", "Output", false], ["cutoutEffects", "Cutout finish", false], ["depthTitle", "Depth title", false]]) {
      const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked; input.setAttribute("aria-label", `Include ${label}`);
      const wrapper = field(label, input); wrapper.classList.add("story-check"); saveForm.append(wrapper); inclusions.set(key, input);
    }
    const current = getProject(), subjects = current.slides.find((slide) => slide.id === slideId).nodeIds.map((id) => current.nodes[id]).filter((node) => node.kind === "image" && node.cutoutEffects);
    const effectSource = select(subjects.map((node, index) => [node.id, `${node.connection ? "Connected subject" : `Photo ${index + 1}`}: ${current.assets[node.assetId].name}`]), subjects[0]?.id ?? "", "Cutout finish source");
    const effectField = field("Cutout finish source", effectSource); effectField.hidden = true; saveForm.append(effectField);
    inclusions.get("cutoutEffects").disabled = !subjects.length;
    inclusions.get("cutoutEffects").addEventListener("change", () => { effectField.hidden = !inclusions.get("cutoutEffects").checked; });
    const depthPhotos = current.slides.find((slide) => slide.id === slideId).nodeIds.map((id) => current.nodes[id]).filter((node) => node.kind === "image" && node.depthTextId);
    const depthSource = select(depthPhotos.map((node, index) => [node.id, `${node.connection ? "Connected subject" : `Photo ${index + 1}`}: ${current.assets[node.assetId].name}`]), depthPhotos[0]?.id ?? "", "Depth title source");
    const depthField = field("Depth title source", depthSource); depthField.hidden = true; saveForm.append(depthField);
    inclusions.get("depthTitle").disabled = !depthPhotos.length;
    inclusions.get("depthTitle").addEventListener("change", () => { depthField.hidden = !inclusions.get("depthTitle").checked; });
    const note = document.createElement("p"); note.className = "story-note";
    note.textContent = "Uses this slide’s first photo for color settings. Choose a finished subject for its outline and shadow, or a depth title for its type, placement and background choice. Photos, masks, captions and depth-title words stay out of the style. Output saves your selected export shapes and format.";
    const save = action("Save style", () => {}); save.type = "submit";
    saveForm.append(note, save, action("Close save form", () => { saveForm.hidden = true; }));
    saveForm.onsubmit = async (event) => {
      event.preventDefault(); save.disabled = true;
      try {
        const style = captureStoryStyle(getProject(), slideId, name.value, { ...Object.fromEntries([...inclusions].map(([key, input]) => [key, input.checked])), effectPhotoId: effectSource.value, depthPhotoId: depthSource.value });
        await putStyle(style); tab = "saved"; savedFilter = "custom"; filters.value = savedFilter; await refreshLibrary(); saveForm.hidden = true; say(`Saved ${style.name}. Tap it to preview or apply it.`);
      } catch (error) { say(error.message); } finally { save.disabled = false; }
    };
    name.focus(); name.select();
  }
  actions.append(action("Save my style", showSaveForm), action("Import style", () => fileInput.click()), action("Export style", () => {
    try {
      const bytes = serializeStyle(selected), url = URL.createObjectURL(new Blob([bytes], { type: "application/json" })), link = document.createElement("a");
      link.href = url; link.download = `${readableSlug(selected.name)}.tstyle`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      say("Style download started. It contains reusable settings, without photos, masks, captions or exact crops.");
    } catch (error) { say(error.message); }
  }));
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0]; fileInput.value = ""; if (!file) return;
    try {
      if (file.size > MAX_STYLE_BYTES) throw new Error("Style files must be 32 KiB or smaller.");
      const style = parseStyle(await file.text()); await putStyle(style, { origin: "imported" });
      tab = "saved"; savedFilter = "all"; filters.value = savedFilter; await refreshLibrary(); say(`Imported ${style.name}. ${styleCompatibility(style, project) || "Tap it to preview before applying."}`);
    } catch (error) { say(`Import stopped: ${error.message}`); }
  });
  const changed = () => { void refreshLibrary(); };
  addEventListener(STYLE_CHANGE_EVENT, changed); renderCards(); void refreshLibrary();
  return {
    commit() { if (applied) void putStyle(applied.style, { origin: "recent", used: true }).catch((error) => onError(`Edits applied, but recent styles could not be saved: ${error.message}`)); },
    dispose() { disposed = true; previewRequest?.abort(); generation++; stopPreviews(); removeEventListener(STYLE_CHANGE_EVENT, changed); },
  };
}
