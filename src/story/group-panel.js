import { action, field, select } from "./view.js";
import { planPhotoGroups, PHOTO_ACCEPT } from "./group-plan.js";
import { GroupedStoryImport } from "./group-import.js";
import { curatedStoryStyles } from "../styles/model.js";
import { projectStorageBudget } from "../project/storage.js";
import { openStoryBatchPanel } from "./batch-panel.js";

const text = (tag, value, className) => {
  const element = document.createElement(tag); element.textContent = value;
  if (className) element.className = className;
  return element;
};
const mib = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const pageSize = 20;

export async function openStoryGroupPanel(returnFocus = document.activeElement, { onSaved = () => {} } = {}) {
  const existing = document.getElementById("story-group-sheet");
  if (existing) return existing;
  const sheet = document.createElement("dialog"); sheet.id = "story-group-sheet"; sheet.className = "story-sheet";
  sheet.setAttribute("aria-labelledby", "story-group-title");
  const header = document.createElement("header"), heading = text("h2", "Make several stories"); heading.id = "story-group-title";
  const content = document.createElement("div"); content.className = "story-sheet-content";
  const note = text("p", "Choose photos, review the groups, then create editable stories with one look. You can adjust each story before exporting them together.", "story-note");
  const status = text("p", "", "story-note"); status.setAttribute("role", "status");
  const summary = text("p", "Choose PNG, JPEG or WebP photos to begin.", "story-note"); summary.setAttribute("aria-live", "polite");
  const budgetNote = text("p", "The story library shares a 128 MiB asset budget with recovery copies. Each story can use up to 96 MiB of source photos.", "story-note");
  const lifetime = text("p", "Keep this page open while creating stories. Pause lets you continue here. Closing or reloading keeps saved stories but discards the unfinished selection.", "story-note");
  const inputs = document.createElement("fieldset"); inputs.className = "story-group-options";
  inputs.append(text("legend", "Choose and group photos"));
  const filesInput = document.createElement("input"), folderInput = document.createElement("input");
  for (const input of [filesInput, folderInput]) { input.type = "file"; input.multiple = true; input.accept = PHOTO_ACCEPT; input.hidden = true; }
  const folderSupported = "webkitdirectory" in folderInput; folderInput.setAttribute("webkitdirectory", "");
  const choose = action("Choose photos", () => filesInput.click());
  const folder = action("Choose a folder", () => folderInput.click()); folder.hidden = !folderSupported;
  const mode = select([["fixed", "All photos · fixed-size groups"], ["folder", "Keep each folder separate"]], "fixed", "Group photos by");
  const size = select(Array.from({ length: 7 }, (_, i) => [String(i + 6), `${i + 6} photos`]), "8", "Photos per story");
  const order = select([["selection", "Picker order"], ["name", "File name A–Z (within folders)"]], "selection", "Photo order");
  const leftovers = select([["review", "Decide before creating"], ["rebalance", "Rebalance to keep all · 6–12 per story"],
    ["include", "Include a smaller last group · at least 6"], ["skip", "Leave leftover photos out"]], "review", "Leftover photos");
  const name = document.createElement("input"); name.value = "My stories"; name.maxLength = 65;
  const styles = curatedStoryStyles(), deviceStyles = curatedStoryStyles({ revision: 1 });
  const look = select(styles.map(style => [style.id, style.name]), styles[0].id, "Story preset");
  const deviceFonts = document.createElement("input"); deviceFonts.type = "checkbox";
  const fontLabel = text("label", ""); fontLabel.className = "story-check"; fontLabel.append(deviceFonts, "Use device fonts · appearance can vary");
  const lookNote = text("p", "", "story-note");
  inputs.append(choose, folder, filesInput, folderInput, field("Grouping", mode), field("Photos per story", size), field("Order", order),
    field("Leftovers", leftovers), field("Collection title", name), field("Preset", look), fontLabel, lookNote);
  const rows = document.createElement("ol"); rows.className = "story-group-list"; rows.setAttribute("aria-label", "Photo group preview");
  const exceptions = document.createElement("details"); exceptions.className = "story-import-options";
  const exceptionSummary = text("summary", "Photos outside the planned stories"), exceptionList = document.createElement("ul");
  exceptions.append(exceptionSummary, exceptionList);
  const paging = document.createElement("nav"); paging.className = "story-group-paging"; paging.setAttribute("aria-label", "Photo group pages");
  const pageLabel = text("span", "");
  let files = [], plan = null, selection = new Map(), queue = null, page = 0, active = null, controller = null;
  let budget = null, closed = false, closing = false, failure = "";
  const navigationId = crypto.randomUUID();
  const message = value => { if (!closed) status.textContent = value; };
  const selectedGroups = () => plan?.groups.filter(group => selection.get(group.id)?.include).map(group => ({ ...group, name: selection.get(group.id).name })) ?? [];
  const preset = () => (deviceFonts.checked ? deviceStyles : styles).find(style => style.id === look.value);

  async function updateBudget() {
    try { budget = await projectStorageBudget(); }
    catch (error) { message(`Storage could not be inspected: ${error.message}`); }
    if (!closed) refresh();
  }
  function refresh() {
    if (closed) return;
    const busy = Boolean(active), selected = selectedGroups(), sourceBytes = (queue?.pending ?? selected).reduce((sum, group) => sum + group.byteLength, 0);
    const fonts = preset().assets.reduce((sum, asset) => sum + asset.byteLength, 0);
    const plannedFonts = queue && !queue.pending.length ? 0 : fonts;
    inputs.disabled = busy || Boolean(queue);
    for (const control of rows.querySelectorAll("input")) control.disabled = busy || Boolean(queue);
    start.disabled = busy || (queue ? !queue.pending.length : !selected.length || Boolean(plan?.blocked) || selected.some(group => group.problem));
    start.textContent = queue ? queue.pending.length ? "Continue creating stories" : "Stories created" : `Create ${selected.length || ""} stories`.replace("  ", " ");
    directBatch.hidden = Boolean(queue);
    directBatch.disabled = start.disabled || Boolean(preset().components.depthTitle || preset().components.cutoutEffects);
    pause.hidden = !busy; pause.disabled = Boolean(controller?.signal.aborted);
    skip.hidden = busy || queue?.pending[0]?.status !== "failed";
    reset.hidden = !queue; reset.disabled = busy;
    exportStories.hidden = !queue?.saved.length; exportStories.disabled = busy;
    const omitted = (plan?.remainder.reduce((sum, item) => sum + item.files.length, 0) ?? 0) + (plan?.unsupported.length ?? 0)
      + (plan?.groups.filter(group => !selection.get(group.id)?.include).reduce((sum, group) => sum + group.files.length, 0) ?? 0);
    summary.textContent = queue
      ? `${queue.saved.length} saved · ${queue.pending.length} remaining · ${queue.groups.filter(group => group.status === "skipped").length} skipped. Saved stories are available in your library.`
      : failure || (files.length ? `${selected.length} stories · ${selected.reduce((sum, group) => sum + group.files.length, 0)} photos included · ${omitted} outside these stories.${plan?.blocked ? " Choose how to handle leftovers before creating." : ""}` : "Choose PNG, JPEG or WebP photos to begin.");
    budgetNote.textContent = `Library budget: ${budget ? `${mib(budget.availableBytes)} available of ${mib(budget.limitBytes)}` : "128 MiB shared with recovery copies"}. ${queue ? "Remaining" : "Selected"} originals: ${mib(sourceBytes)}; bundled fonts: ${mib(plannedFonts)}. Each story allows 96 MiB of photos.`
      + (budget && sourceBytes + plannedFonts > budget.availableBytes ? " This selection may exceed available space; identical saved assets are reused. Creation stops safely if the budget is reached." : "")
      + " Browser storage may have a lower limit.";
    lookNote.textContent = `${preset().description} ${look.value === "builtin:story-depth-cover" ? "After creating each story, open Cutout and select the cover subject to put it in front of the title. " : ""}`
      + (deviceFonts.checked ? "Device fonts need no download." : `Bundled fonts download up to ${mib(fonts)} and stay with saved stories.`);
  }
  function renderRows() {
    const groups = queue?.groups ?? plan?.groups ?? [];
    page = Math.max(0, Math.min(page, Math.max(0, Math.ceil(groups.length / pageSize) - 1)));
    rows.replaceChildren(); rows.start = page * pageSize + 1;
    for (const group of groups.slice(page * pageSize, (page + 1) * pageSize)) {
      const row = document.createElement("li"); row.dataset.photoGroup = group.id;
      const choice = selection.get(group.id), include = document.createElement("input"); include.type = "checkbox"; include.checked = choice?.include ?? true;
      const label = text("label", ""); label.className = "story-check"; label.append(include, "Include this story");
      const title = document.createElement("input"); title.maxLength = 80; title.value = group.name; title.setAttribute("aria-label", "Story title");
      if (choice && !queue) title.value = choice.name;
      include.addEventListener("change", () => { choice.include = include.checked; refresh(); });
      title.addEventListener("input", () => { choice.name = title.value; });
      const info = text("p", `${queue ? group.status : `${group.files.length} photos`} · ${mib(group.byteLength)}${group.problem ? ` · ${group.problem}` : ""}${group.error ? ` · ${group.error}` : ""}`, "story-note");
      const details = document.createElement("details"); details.append(text("summary", "Photo order"));
      const names = document.createElement("ol");
      for (const file of group.files) names.append(text("li", file.webkitRelativePath || file.name));
      details.append(names); details.hidden = !group.files.length;
      row.append(label, field("Story title", title), info, details); rows.append(row);
    }
    paging.hidden = groups.length <= pageSize; previous.disabled = page === 0; next.disabled = (page + 1) * pageSize >= groups.length;
    pageLabel.textContent = `Page ${page + 1} of ${Math.max(1, Math.ceil(groups.length / pageSize))}`;
    refresh();
  }
  function rebuild() {
    if (queue || active) return;
    failure = ""; page = 0;
    try {
      plan = planPhotoGroups(files, { mode: mode.value, size: Number(size.value), order: order.value, leftovers: leftovers.value, title: name.value });
      selection = new Map(plan.groups.map(group => [group.id, { include: true, name: group.name }]));
    } catch (error) { plan = null; selection.clear(); failure = error.message; }
    exceptionList.replaceChildren();
    for (const item of (plan?.remainder ?? []).slice(0, 20)) exceptionList.append(text("li", `${item.folder || "Selected photos"}: ${item.files.length} leftover photos (${item.skipped ? "left out" : "needs a choice"}) — ${item.files.map(file => file.name).join(", ")}`));
    if ((plan?.remainder.length ?? 0) > 20) exceptionList.append(text("li", `${plan.remainder.length - 20} more folders have leftovers. Choose a policy above for all folders.`));
    if (plan?.unsupported.length) exceptionList.append(text("li", `${plan.unsupported.length} unsupported files left out: ${plan.unsupported.slice(0, 20).map(file => file.name).join(", ")}${plan.unsupported.length > 20 ? ", …" : ""}. Convert HEIC photos before importing. Animated photos are rejected during inspection.`));
    exceptions.hidden = !exceptionList.childElementCount; exceptions.open = Boolean(plan?.blocked);
    renderRows();
  }
  async function run() {
    if (active || closing) return;
    try {
      if (!queue) {
        if (!plan || plan.blocked) throw new Error("Review the leftover photos first.");
        queue = new GroupedStoryImport(selectedGroups(), preset());
      }
      controller = new AbortController();
      active = Promise.resolve().then(() => queue.run({ signal: controller.signal, changed: (group, progress) => {
        message(progress ? `${group.name}: inspecting photo ${progress.done} of ${progress.total}…` : `${group.name}: ${group.error || group.status}`);
        if (!progress) renderRows();
      } }));
      refresh(); await active;
      message("Stories saved. Open them in your library to review crops and text, or export the saved stories together.");
    } catch (error) {
      message(error.name === "AbortError" ? "Paused. Saved stories are kept. Continue here to create the remaining stories." : error.message);
    } finally {
      active = null; controller = null; renderRows();
      if (queue?.saved.length) Promise.resolve().then(onSaved).catch(error => message(`Stories saved; library refresh failed: ${error.message}`));
      await updateBudget();
    }
  }
  async function close(manageHistory = true) {
    if (closing) return; closing = true; controller?.abort();
    const navigation = manageHistory && history.state?.tinyStarGrouping === navigationId
      ? new Promise(resolve => { addEventListener("popstate", resolve, { once: true }); history.back(); }) : Promise.resolve();
    await active?.catch(() => {}); await navigation;
    closed = true; removeEventListener("popstate", navigated); files = []; plan = null;
    sheet.close(); sheet.remove(); if (returnFocus?.isConnected) returnFocus.focus();
  }
  const navigated = () => { if (history.state?.tinyStarGrouping !== navigationId) void close(false); };
  const done = action("Done", () => void close()); header.append(heading, done);
  const start = action("Create stories", () => void run(), true);
  const directBatch = action("Create a durable export batch", async () => {
    if (closing || active || queue || !plan || plan.blocked) return;
    const photoGroups = selectedGroups(), photoStyle = preset();
    if (!photoGroups.length || photoGroups.some(group => group.problem)) return;
    await close();
    await openStoryBatchPanel(returnFocus, { photoGroups, photoStyle });
  });
  const directNote = text("p", "For larger collections, a durable export batch stores its own photo copies outside the 128 MiB story library. It keeps grouping and preset choices fixed. Depth cover needs editable stories for subject selection. Browser storage limits still apply.", "story-note");
  const pause = action("Pause", () => { controller?.abort(); refresh(); });
  const skip = action("Skip failed story", () => { queue?.skipFailed(); message("Story skipped. Continue when ready."); renderRows(); });
  const reset = action("Choose another selection", () => { queue = null; files = []; message("Saved stories remain in your library."); rebuild(); });
  const exportStories = action("Export created stories", async () => {
    if (closing || active) return;
    const selectedKeys = queue.saved.map(item => item.key); await close();
    await openStoryBatchPanel(returnFocus, { selectedKeys });
  });
  const previous = action("Previous groups", () => { page--; renderRows(); });
  const next = action("Next groups", () => { page++; renderRows(); });
  paging.append(previous, pageLabel, next);
  for (const input of [mode, size, order, leftovers, name]) input.addEventListener("change", rebuild);
  for (const input of [look, deviceFonts]) input.addEventListener("change", refresh);
  for (const input of [filesInput, folderInput]) input.addEventListener("change", () => {
    if (closing || queue || active) return;
    const chosen = Array.from(input.files); input.value = ""; if (!chosen.length) return;
    files = chosen; mode.value = input === folderInput ? "folder" : "fixed"; order.value = input === folderInput ? "name" : "selection";
    message(""); rebuild();
  });
  content.append(note, inputs, summary, exceptions, rows, paging, budgetNote, lifetime, start, directBatch, directNote, pause, skip, exportStories, reset, status);
  sheet.append(header, content); document.body.append(sheet); sheet.showModal();
  history.pushState({ ...history.state, tinyStarGrouping: navigationId }, ""); addEventListener("popstate", navigated);
  sheet.addEventListener("cancel", event => { event.preventDefault(); void close(); });
  rebuild(); await updateBudget(); return sheet;
}
