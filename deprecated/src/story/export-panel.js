import { action, field, select } from "./view.js";
import { EXPORT_SHAPES, planStoryExports, StoryExportBatch } from "./export-plan.js";
import { enqueueScene } from "../processing/scene-client.js";
import { getProcessingScheduler } from "../processing/client.js";
import { reviewStoryLayout } from "./layout.js";
import { reviewConnections } from "./connections.js";

export function mountStoryExportPanel({ content, getProject, readAsset, saveSelection, retained, notices }) {
  const initial = getProject(), saved = initial.recipe.outputVariants ?? [initial.recipe.outputVariant];
  const shapeValue = Array.isArray(saved) && saved.length === 2 && new Set(saved).size === 2 && saved.every(id => Object.hasOwn(EXPORT_SHAPES, id)) ? "both"
    : Array.isArray(saved) && saved.length === 1 ? saved[0] : "";
  const shape = select([...Object.entries(EXPORT_SHAPES), ["both", "Both shapes"]], shapeValue, "Story export shapes");
  const format = select([["jpeg", "JPEG"], ["png", "PNG"]], initial.recipe.outputFormat ?? "jpeg", "Story export format");
  const summary = document.createElement("p"); summary.className = "story-note"; summary.dataset.exportSummary = "";
  const progress = document.createElement("p"); progress.setAttribute("role", "status"); progress.dataset.exportProgress = "";
  const list = document.createElement("ol"); list.className = "story-exports";
  const filter = document.createElement("input"); filter.type = "checkbox";
  const filterLabel = document.createElement("label"); filterLabel.className = "story-check"; filterLabel.append(filter, "Only items needing attention"); filterLabel.hidden = true;
  let batch = null, disposed = false, paused = false, planError = "", sharing = false;
  const files = () => batch?.records.filter(record => record.status === "ready").map(record => record.value) ?? [];
  const variants = () => shape.value === "both" ? Object.keys(EXPORT_SHAPES) : [shape.value];
  const release = () => {
    const entries = files(); batch?.dispose(); for (const entry of entries) URL.revokeObjectURL(entry.url);
    batch = null; paused = false; retained([]);
  };
  const warnings = (result, item, plan) => {
    const messages = notices(result.warnings ?? []);
    if (reviewStoryLayout(plan.project, item.slideId, item.variantId).length) messages.push("Some positions overlap or leave the page. Review Layout.");
    if (reviewConnections(plan.project, item.variantId).some(warning => warning.slideIds.includes(item.slideId))) messages.push("A connected cutout no longer crosses its join. Review Across slides in Cutout.");
    return [...new Set(messages)];
  };
  function describePlan() {
    try {
      const plan = planStoryExports(getProject(), { variants: variants(), format: format.value }); planError = "";
      summary.textContent = `${plan.items.length} files · ${plan.project.slides.length} slides × ${plan.variants.length} ${plan.variants.length === 1 ? "shape" : "shapes"} · `
        + plan.variants.map(id => { const { width, height } = plan.project.variants.find(item => item.id === id); return `${width} × ${height}`; }).join(" / ");
      return plan;
    } catch (error) { planError = error.message; summary.textContent = planError; return null; }
  }
  function refresh() {
    if (disposed) return;
    const busy = Boolean(batch?.running), counts = batch?.counts, ready = files();
    shape.disabled = format.disabled = busy || sharing;
    prepare.disabled = busy || sharing || Boolean(planError);
    prepare.hidden = Boolean(counts && !counts.pending); prepare.textContent = batch ? "Continue preparing" : "Prepare files";
    pause.hidden = !busy; pause.disabled = paused; pause.textContent = paused ? "Pausing…" : "Pause";
    retry.hidden = !counts?.failed; retry.disabled = busy || sharing; retry.textContent = `Retry ${counts?.failed ?? 0} failed`;
    list.replaceChildren(); let attention = 0;
    for (const record of batch?.records ?? []) {
      const issues = record.value?.warnings ?? [], needsAttention = record.status === "failed" || issues.length > 0;
      if (needsAttention) attention++;
      const row = document.createElement("li"); row.dataset.exportKey = record.item.key; row.dataset.exportStatus = record.status;
      row.hidden = filter.checked && !needsAttention;
      const label = `Slide ${record.item.slideIndex + 1}${batch.plan.variants.length > 1 ? ` · ${EXPORT_SHAPES[record.item.variantId]}` : ""}`;
      if (record.status === "ready") {
        const link = document.createElement("a"); link.href = record.value.url; link.download = record.value.file.name; link.className = "button secondary";
        link.textContent = `Save ${label.toLowerCase()} · ${(record.value.file.size / 1024).toFixed(0)} KB`; row.append(link);
      } else { const text = document.createElement("span"); text.textContent = `${label} · ${record.status === "failed" ? record.error : record.status === "pending" ? "Waiting" : "Preparing…"}`; row.append(text); }
      if (issues.length) { const note = document.createElement("p"); note.className = "story-note"; note.textContent = issues.join(" "); row.append(note); }
      list.append(row);
    }
    filterLabel.hidden = !attention && !filter.checked;
    let canShare = false; try { canShare = Boolean(ready.length && navigator.share && navigator.canShare?.({ files: ready.map(entry => entry.file) })); } catch { /* Download links remain available. */ }
    share.hidden = !canShare; share.disabled = busy || sharing;
    share.textContent = counts?.ready === counts?.total ? batch?.plan.variants.length === 1 ? "Share all slides" : "Share all files" : `Share ${ready.length} ready files`;
    if (counts) {
      const state = busy ? paused ? "Pausing" : "Preparing files" : counts.pending ? "Paused" : counts.failed ? "Some files need attention" : `${counts.ready} files ready`;
      progress.textContent = `${state} · ${counts.ready} ready, ${counts.failed} failed, ${counts.pending + counts.processing} remaining.`
        + (attention ? ` ${attention} ${attention === 1 ? "item needs" : "items need"} attention.` : "")
        + (filter.checked && !attention ? " No items need attention." : "");
    }
  }
  async function run(retryFailed = false) {
    if (disposed || batch?.running) return;
    if (!batch) {
      const plan = describePlan(); if (!plan) { refresh(); return; }
      const read = readAsset(plan.project);
      batch = new StoryExportBatch(plan, {
        render: (item, { signal }) => enqueueScene({ project: plan.project, slideId: item.slideId, variantId: item.variantId,
          format: plan.format, signal, readAsset: read, priority: 1 }).promise,
        retain: (result, item) => {
          const messages = warnings(result, item, plan);
          const file = new File([result.output], item.name, { type: result.mime });
          return { index: item.index, file, url: URL.createObjectURL(file), warnings: messages };
        },
        changed: () => { retained(files()); refresh(); },
      });
    }
    paused = false;
    try { await batch.start({ retryFailed }); } catch (error) { if (!disposed) progress.textContent = error.message; }
  }
  const prepare = action("Prepare files", () => { void run(); }, true);
  const pause = action("Pause", () => { paused = true; batch?.pause(); refresh(); }); pause.hidden = true;
  const retry = action("Retry failed", () => { void run(true); }); retry.hidden = true;
  const share = action("Share all slides", async () => {
    const ready = files(); if (!ready.length || sharing || batch?.running) return;
    // The share promise owns its File references independently of this panel.
    // Keep them charged if Back/Done disposes the prepared-output list first.
    const pool = getProcessingScheduler(), shareOwner = `story-share:${crypto.randomUUID()}`;
    pool.setRetainedBytes(shareOwner, ready.reduce((bytes, entry) => bytes + entry.file.size, 0));
    sharing = true;
    try { refresh(); await navigator.share({ files: ready.map(entry => entry.file), title: batch.plan.project.name }); if (!disposed) progress.textContent = "Share sheet closed. You can save individual files below."; }
    catch (error) { if (!disposed && error.name !== "AbortError") progress.textContent = "Sharing was unavailable. Save individual files below."; }
    finally {
      pool.setRetainedBytes(shareOwner, 0); sharing = false;
      if (!disposed) { shape.disabled = format.disabled = false; share.disabled = false; retry.disabled = false; prepare.disabled = Boolean(planError); }
    }
  }, true); share.hidden = true;
  function changedSelection() {
    release(); list.replaceChildren(); filter.checked = false; progress.textContent = "Prepare files with your selected shapes and format.";
    const plan = describePlan(); if (plan) saveSelection({ format: plan.format, variants: [...plan.variants] }); refresh();
  }
  shape.addEventListener("change", changedSelection); format.addEventListener("change", changedSelection); filter.addEventListener("change", refresh);
  const note = document.createElement("p"); note.className = "story-note";
  note.textContent = "Each shape keeps its framing and edits. Download or share before closing this sheet."
    + (Object.values(initial.nodes).some(node => initial.assets[node.assetId]?.workingCopy) ? " Some photos use smaller editing copies. Their originals are available in Photos." : "");
  content.append(field("Shapes", shape), field("Format", format), summary, note, prepare, pause, retry, progress, share, filterLabel, list);
  describePlan(); refresh();
  return { dispose() { disposed = true; release(); } };
}
