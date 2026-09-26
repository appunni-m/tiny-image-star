import { action } from "../story/view.js";
import { formatJobBytes } from "./core.js";
import { durationLabel, processingEstimate } from "./sample-plan.js";
import { renderFolderSample, selectFolderSamples } from "./sample-preview.js";

export function openFolderFailurePanel(entry, returnFocus) {
  const dialog = document.createElement("dialog"), header = document.createElement("header"), title = document.createElement("h2"), content = document.createElement("div"), name = document.createElement("strong"), problem = document.createElement("p"), note = document.createElement("p");
  dialog.className = "story-sheet"; dialog.id = "folder-failure-sheet"; dialog.setAttribute("aria-labelledby", "folder-failure-title");
  title.id = "folder-failure-title"; title.textContent = "File needs attention";
  header.append(title, action("Done", () => dialog.close())); content.className = "story-sheet-content folder-failure-content";
  name.textContent = entry.relativePath; problem.textContent = entry.error || "This file could not be processed.";
  note.textContent = "Check this source and the save folder, then use Retry failed images. Files already saved will be kept.";
  content.append(name, problem, note); dialog.append(header, content); document.body.append(dialog);
  dialog.addEventListener("close", () => { dialog.remove(); if (returnFocus?.isConnected) returnFocus.focus(); else document.querySelector("#folder-job-results")?.focus(); }, { once: true });
  dialog.showModal(); return dialog;
}

export function openFolderSamplePanel(job, { measured = () => {}, onClose = () => {}, returnFocus = document.activeElement } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "story-sheet folder-sample-sheet"; dialog.id = "folder-sample-sheet"; dialog.setAttribute("aria-labelledby", "folder-sample-title");
  const header = document.createElement("header"), title = document.createElement("h2"); title.id = "folder-sample-title"; title.textContent = "Preview this folder";
  header.append(title, action("Done", () => dialog.close()));
  const content = document.createElement("div"); content.className = "story-sheet-content";
  const summary = document.createElement("p"); summary.className = "story-note";
  summary.textContent = `${job.discovered.toLocaleString()} planned files · one output per image · ${job.recipe.name}. ${job.outputHandle ? `Save to ${job.outputFolderName}.` : "Choose a save folder after reviewing."}`;
  const explanation = document.createElement("p"); explanation.className = "story-note";
  explanation.textContent = "Check crops and text on these sample photos. This preview saves no files.";
  const selection = document.createElement("details"), selectionTitle = document.createElement("summary"), selectionNote = document.createElement("p");
  selectionTitle.textContent = "How these photos were chosen";
  selectionNote.textContent = "The sample includes the largest file of each format, the smallest source, and photos from the beginning, middle and end. It does not inspect every photo or recognize subjects. Other images may still need attention.";
  selection.append(selectionTitle, selectionNote);
  const status = document.createElement("p"); status.setAttribute("role", "status"); status.id = "folder-sample-status"; status.textContent = "Choosing sample images…";
  const filter = document.createElement("label"), attention = document.createElement("input"); attention.type = "checkbox"; attention.id = "folder-sample-attention"; filter.className = "folder-review-filter"; filter.append(attention, document.createTextNode("Only samples needing attention"));
  const grid = document.createElement("div"); grid.className = "folder-sample-grid";
  const footer = document.createElement("footer"), retry = action("Retry failed samples", () => { void run(true); }); retry.hidden = true;
  footer.append(retry); content.append(summary, explanation, filter, status, grid, selection); dialog.append(header, content, footer); document.body.append(dialog);
  const controller = new AbortController(); let closed = false, records = [], running = false;
  function render() {
    for (const record of records) {
      record.element.hidden = attention.checked && record.status !== "failed" && !record.resource?.framingReview;
      record.element.dataset.state = record.status;
    }
    retry.hidden = !records.some(record => record.status === "failed"); retry.disabled = running;
  }
  attention.addEventListener("change", render);
  async function run(retryOnly = false) {
    if (closed || running) return;
    running = true; const started = performance.now();
    try {
      if (!records.length) {
        const entries = await selectFolderSamples(job, controller.signal); if (closed) return;
        records = entries.map(entry => {
          const element = document.createElement("article"), name = document.createElement("strong"), detail = document.createElement("p");
          element.className = "folder-sample-card"; element.dataset.index = String(entry.index); name.textContent = entry.relativePath; detail.textContent = "Waiting to preview…"; element.append(name, detail); grid.append(element);
          return { entry, element, detail, status: "pending", resource: null };
        });
      }
      const pending = records.filter(record => retryOnly ? record.status === "failed" : record.status === "pending");
      status.textContent = `Previewing ${pending.length} sample images…`; render();
      await Promise.all(pending.map(async record => {
        record.status = "processing"; record.detail.textContent = "Rendering the full recipe…"; render();
        try {
          const resource = await renderFolderSample(job, record.entry, { signal: controller.signal });
          if (closed) { resource.release(); return; }
          record.resource = resource; record.status = "ready";
          const image = new Image(); image.src = resource.url; image.alt = `Recipe preview for ${record.entry.relativePath}`; record.element.prepend(image);
          const full = resource.fullOutput;
          record.detail.textContent = `${full.width} × ${full.height} · ${full.format.toUpperCase()} · ${formatJobBytes(full.bytes)}${resource.framingReview ? " · Check framing: this recipe crops photos." : ""}`;
        } catch (error) { if (!closed) { record.status = "failed"; record.detail.textContent = error.message; } }
        finally { if (!closed) { status.textContent = `${records.filter(item => item.status === "ready").length} previews ready · ${records.filter(item => item.status === "failed").length} need attention`; render(); } }
      }));
      if (closed) return;
      const ready = records.filter(record => record.status === "ready"), failed = records.filter(record => record.status === "failed").length;
      // Sample selection is biased toward larger files. Label this estimate;
      // it includes preview overhead and excludes destination write time.
      if (!retryOnly && !failed && ready.length) {
        const elapsedMs = performance.now() - started, seconds = processingEstimate({ elapsedMs, completed: ready.length, remaining: job.discovered });
        if (seconds !== null) { status.textContent += ` · Estimated processing: about ${durationLabel(seconds)}. Saving and device changes can take longer.`; measured({ jobId: job.id, recipe: job.recipe, elapsedMs, completed: ready.length, seconds }); }
      }
      if (!records.length) status.textContent = "There are no images to preview.";
    } catch (error) { if (!closed) status.textContent = error.message; }
    finally { running = false; if (!closed) render(); }
  }
  dialog.addEventListener("close", () => {
    closed = true; controller.abort();
    for (const record of records) { record.resource?.release(); record.resource = null; }
    dialog.remove(); onClose(); if (returnFocus?.isConnected) returnFocus.focus();
  }, { once: true });
  dialog.showModal(); void run(); return dialog;
}
