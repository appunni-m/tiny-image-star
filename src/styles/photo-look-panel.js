import { curatedStyles, styleKey } from "./model.js";
import { photoLookFromStyle, photoLookProblem } from "./photo-look.js";
import { photoLookLabel, validatePhotoLook } from "../compositor/photo-look.js";
import { putStyle, readStyleLibrary, STYLE_CHANGE_EVENT } from "./store.js";
import { getProcessingScheduler } from "../processing/client.js";
import { inspectPhotoLookSample, renderPhotoLookPreview } from "./photo-look-preview.js";
import { action, field, select, range } from "../story/view.js";

/** Preview is isolated; only Apply invokes the caller's commit transaction. */
export function openPhotoLookPanel({ initial = null, scopes = [["all", "All images"]], scope: initialScope = "all", getSample, commit, report = () => {} }) {
  const returnFocus = document.activeElement, dialog = document.createElement("dialog");
  dialog.className = "story-sheet photo-look-sheet"; dialog.id = "photo-look-sheet"; dialog.setAttribute("aria-labelledby", "photo-look-title");
  const heading = document.createElement("header"), title = document.createElement("h2"); title.id = "photo-look-title"; title.textContent = "Photo look";
  const cancel = action("Cancel", () => dialog.close()); heading.append(title, cancel);
  const content = document.createElement("div"); content.className = "story-sheet-content";
  const footer = document.createElement("footer"), apply = action("Apply photo look", () => { void save(); }, true);
  footer.append(apply); dialog.append(heading, content, footer); document.body.append(dialog);
  const note = document.createElement("p"); note.className = "story-note"; note.textContent = "Apply a style’s photo colors. Crop, text, layout and output settings are controlled separately.";
  const scope = select(scopes, initialScope, "Photo look scope"), scopeField = field("Apply to", scope); scopeField.hidden = scopes.length < 2;
  const preview = document.createElement("img"); preview.className = "photo-look-preview"; preview.alt = "Photo look preview"; preview.hidden = true;
  const status = document.createElement("p"); status.className = "story-note"; status.setAttribute("role", "status"); status.id = "photo-look-status";
  const selection = document.createElement("p"); selection.id = "photo-look-selection"; selection.className = "story-note";
  const nav = document.createElement("nav"); nav.className = "story-style-tabs"; nav.setAttribute("aria-label", "Photo look library");
  const cards = document.createElement("div"); cards.className = "story-looks";
  let binding = structuredClone(initial), selectedStyle = null, tab = "for", records = [], shown = 12, generation = 0, closed = false, saving = false, favoriteFocus = null;
  let activeController, activeResource, ready = false, timer, samplePromise, sampleController, sampleGeneration = 0, readGeneration = 0;
  let initialProblem = "";
  if (binding) { try { validatePhotoLook(binding); } catch (error) { initialProblem = `${error.message} Choose a supported look or No photo look.`; binding = null; } }
  const owner = {}, requests = new Map(), resources = new Map(), tabs = new Map();
  const strength = range("Photo color strength", binding?.strength ?? 1, 0, 1, .05, (value) => {
    if (!binding) return; binding.strength = value; updateSelection(); schedulePreview();
  });
  const retry = action("Retry preview", () => { samplePromise = null; void renderActive(); }); retry.hidden = true;
  const clear = action("No photo look", () => { binding = null; selectedStyle = null; updateSelection(); schedulePreview(); }); clear.id = "photo-look-clear";
  const more = action("Show more styles", () => { shown += 12; renderCards(); });
  content.append(note, scopeField, nav, cards, more, selection, strength, clear, preview);
  footer.prepend(status, retry);
  const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!target.isConnected || target.parentElement !== cards) continue;
      const key = target.dataset.cardKey;
      if (isIntersecting) void thumbnail(target);
      else { requests.get(key)?.abort(); requests.delete(key); resources.get(key)?.release(); resources.delete(key); target.querySelector("img")?.remove(); }
    }
  }, { root: dialog, rootMargin: "60px" }) : null;

  async function sample() {
    if (!samplePromise) {
      const captured = ++sampleGeneration;
      sampleController?.abort(); sampleController = new AbortController(); const controller = sampleController;
      samplePromise = Promise.resolve().then(() => getSample(scope.value)).then((value) => {
        if (closed || captured !== sampleGeneration) throw new DOMException("Preview cancelled.", "AbortError");
        if (!value?.bytes?.byteLength) throw new Error("Choose an available image to preview this look.");
        getProcessingScheduler().setRetainedBytes(owner, value.bytes.byteLength);
        return inspectPhotoLookSample(value, controller.signal);
      });
    }
    return samplePromise;
  }
  function updateSelection() {
    selection.textContent = photoLookLabel(binding); strength.hidden = !binding || !Object.entries(binding.definition.appearance).some(([key, value]) => value !== (key === "grayscaleMix" ? 0 : 1));
    strength.querySelector("input").value = String(binding?.strength ?? 1); strength.querySelector("output").value = `${Math.round((binding?.strength ?? 1) * 100)}%`;
    for (const button of cards.querySelectorAll("[data-photo-look-key]")) button.setAttribute("aria-pressed", String(button.dataset.photoLookKey === (binding ? `${binding.definition.id}@${binding.definition.revision}` : "")));
  }
  function schedulePreview() {
    ready = false; apply.disabled = true; activeController?.abort(); clearTimeout(timer);
    timer = setTimeout(() => { void renderActive(); }, 100);
  }
  async function renderActive() {
    activeController?.abort(); const controller = new AbortController(); activeController = controller;
    ready = false; apply.disabled = true; retry.hidden = true; status.textContent = "Previewing your photo…";
    activeResource?.release(); activeResource = null; preview.hidden = true; preview.removeAttribute("src");
    try {
      const source = await sample(); if (controller.signal.aborted) return;
      const result = await renderPhotoLookPreview(source, binding, { signal: controller.signal, priority: 0 });
      if (closed || controller.signal.aborted || activeController !== controller) { result.release(); return; }
      activeResource = result; preview.src = result.url; preview.hidden = false;
      ready = true; apply.disabled = saving; status.textContent = `Preview ready · ${source.name}`;
    } catch (error) { if (!closed && !controller.signal.aborted) { status.textContent = error.message; retry.hidden = false; } }
  }
  function stopThumbnails() {
    generation++; observer?.disconnect();
    for (const controller of requests.values()) controller.abort(); requests.clear();
    for (const resource of resources.values()) resource.release(); resources.clear();
  }
  async function thumbnail(card) {
    const key = card.dataset.cardKey; if (closed || requests.has(key) || resources.has(key)) return;
    const controller = new AbortController(), captured = generation; requests.set(key, controller);
    try {
      const source = await sample(); if (controller.signal.aborted) return;
      const result = await renderPhotoLookPreview(source, photoLookFromStyle(card.definition), { signal: controller.signal, longEdge: 256 });
      if (closed || controller.signal.aborted || captured !== generation || !card.isConnected) { result.release(); return; }
      resources.set(key, result); const image = new Image(); image.alt = ""; image.src = result.url; card.querySelector("button").prepend(image);
    } catch (error) { if (!closed && !controller.signal.aborted && captured === generation) { const detail = card.querySelector("small"); detail.hidden = false; detail.textContent = "Tap to preview this photo look."; } }
    finally { if (requests.get(key) === controller) requests.delete(key); }
  }
  function renderCards() {
    if (closed || saving) return;
    const focusKey = favoriteFocus ?? document.activeElement?.dataset.photoLookFavorite;
    const focusStyle = document.activeElement?.dataset.photoLookKey;
    stopThumbnails(); cards.replaceChildren();
    for (const [id, button] of tabs) button.setAttribute("aria-pressed", String(tab === id));
    const styles = tab === "for" ? curatedStyles() : records.filter((record) => tab === "recent" ? record.lastUsed > 0 : record.favorite || ["custom", "imported"].includes(record.origin))
      .sort((a, b) => (tab === "recent" ? b.lastUsed - a.lastUsed : b.savedAt - a.savedAt) || a.key.localeCompare(b.key)).map((record) => record.style);
    more.hidden = styles.length <= shown;
    for (const style of styles.slice(0, shown)) {
      const card = document.createElement("article"); card.className = "story-style-card"; card.dataset.cardKey = styleKey(style); card.definition = style;
      const button = action(style.name, () => { selectedStyle = style; binding = photoLookFromStyle(style); updateSelection(); schedulePreview(); }); button.dataset.photoLookKey = styleKey(style);
      const problem = photoLookProblem(style); button.disabled = Boolean(problem);
      const detail = document.createElement("small"); detail.textContent = problem; detail.hidden = !problem; button.append(detail); card.append(button);
      const record = records.find((entry) => entry.key === styleKey(style));
      const favorite = action(record?.favorite ? `Unfavorite ${style.name}` : `Favorite ${style.name}`, async () => {
        favoriteFocus = styleKey(style); favorite.disabled = true;
        try { await putStyle(style, { origin: "recent", favorite: !record?.favorite }); await refresh(); }
        catch (error) { status.textContent = error.message; favorite.disabled = false; favorite.focus({ preventScroll: true }); favoriteFocus = null; }
      }); favorite.setAttribute("aria-label", favorite.textContent); favorite.textContent = record?.favorite ? "★" : "☆"; favorite.setAttribute("aria-pressed", String(Boolean(record?.favorite)));
      favorite.classList.add("story-style-favorite"); favorite.dataset.photoLookFavorite = styleKey(style); card.append(favorite); cards.append(card);
      if (!problem) { if (observer) observer.observe(card); else void thumbnail(card); }
    }
    if (!styles.length) { const empty = document.createElement("p"); empty.className = "story-note"; empty.textContent = "Favorite a look or save a style with photo colors to see it here."; cards.append(empty); }
    updateSelection();
    if (focusKey) { [...cards.querySelectorAll("[data-photo-look-favorite]")].find((button) => button.dataset.photoLookFavorite === focusKey)?.focus({ preventScroll: true }); favoriteFocus = null; }
    else if (focusStyle) [...cards.querySelectorAll("[data-photo-look-key]")].find((button) => button.dataset.photoLookKey === focusStyle)?.focus({ preventScroll: true });
  }
  async function refresh() {
    const sequence = ++readGeneration;
    try {
      const library = await readStyleLibrary(); if (closed || sequence !== readGeneration) return;
      records = library.records.filter((record) => record.style.kind === "tiny-image-star/style"); renderCards();
      if (library.issues.length) status.textContent = library.issues.join(" ");
    } catch (error) { if (!closed) status.textContent = `Saved styles could not be read. ${error.message}`; }
  }
  async function save() {
    if (!ready || saving) return; saving = true; apply.disabled = true;
    const disabled = [...dialog.querySelectorAll("button, input, select")].map((control) => [control, control.disabled]);
    for (const [control] of disabled) control.disabled = true;
    try {
      await commit(structuredClone(binding), scope.value);
      if (selectedStyle) void putStyle(selectedStyle, { origin: "recent", used: true }).catch((error) => report(`Look applied; recent styles could not be saved: ${error.message}`));
      dialog.close();
    } catch (error) { status.textContent = error.message; saving = false; for (const [control, prior] of disabled) control.disabled = prior; apply.disabled = !ready; }
  }
  for (const [id, label] of [["for", "For these photos"], ["saved", "Saved"], ["recent", "Recent"]]) {
    const button = action(label, () => { tab = id; shown = 12; renderCards(); }); tabs.set(id, button); nav.append(button);
  }
  scope.addEventListener("change", () => { sampleGeneration++; sampleController?.abort(); samplePromise = null; renderCards(); schedulePreview(); });
  const changed = () => { void refresh(); }; addEventListener(STYLE_CHANGE_EVENT, changed);
  dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    closed = true; clearTimeout(timer); sampleController?.abort(); activeController?.abort(); activeResource?.release(); stopThumbnails(); sampleGeneration++;
    getProcessingScheduler().setRetainedBytes(owner, 0); removeEventListener(STYLE_CHANGE_EVENT, changed); dialog.remove();
    const focus = returnFocus?.getClientRects().length ? returnFocus : document.querySelector("#mobile-batch-settings"); focus?.focus({ preventScroll: true });
  }, { once: true });
  dialog.showModal(); renderCards(); updateSelection(); void refresh();
  if (initialProblem) { ready = false; apply.disabled = true; status.textContent = initialProblem; } else void renderActive();
  return dialog;
}
