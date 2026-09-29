import { assertEngineCompatibility, clone, validateProject } from "../project/model.js";
import { readableSlug } from "../names.js";

export const EXPORT_SHAPES = Object.freeze({ portrait: "Portrait · 4:5", tall: "Tall · 9:16" });
export const MAX_STORY_EXPORT_OUTPUTS = 80;
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

// A plan is copied before work enters the scheduler. Changes to the live story
// or export controls cannot change an in-flight output or a failed-item retry.
export function planStoryExports(project, { variants = project?.recipe?.outputVariants ?? [project?.recipe?.outputVariant], format = project?.recipe?.outputFormat ?? "jpeg" } = {}) {
  validateProject(project); assertEngineCompatibility(project);
  if (!["png", "jpeg"].includes(format)) throw new Error("Choose PNG or JPEG for these exports.");
  if (!Array.isArray(variants) || variants.length < 1 || variants.length > 2 || new Set(variants).size !== variants.length
    || variants.some(id => !Object.hasOwn(EXPORT_SHAPES, id) || !project.variants.some(variant => variant.id === id))) {
    throw new Error("Choose Portrait, Tall, or both export shapes.");
  }
  const selected = Object.keys(EXPORT_SHAPES).filter(id => variants.includes(id));
  if (project.slides.length * selected.length > MAX_STORY_EXPORT_OUTPUTS) throw new Error("This export exceeds the 80-file limit.");
  const snapshot = clone(project), items = [];
  for (const variantId of selected) {
    const variant = snapshot.variants.find(item => item.id === variantId);
    snapshot.slides.forEach((slide, slideIndex) => {
      const stem = `${readableSlug(snapshot.name)}${selected.length > 1 ? `-${variantId}` : ""}-${String(slideIndex + 1).padStart(2, "0")}`;
      items.push({ key: `${variantId}:${slide.id}`, index: items.length, slideId: slide.id, slideIndex, variantId,
        width: variant.width, height: variant.height, name: `${stem}.${format === "jpeg" ? "jpg" : "png"}` });
    });
  }
  return freeze({ project: snapshot, variants: selected, format, items });
}

// This coordinator retains metadata and caller-owned output handles only.
// Actual reads, CPU/memory admission and cancellation belong to enqueueScene.
export class StoryExportBatch {
  constructor(plan, { render, retain = value => value, changed = () => {} }) {
    this.plan = plan; this.render = render; this.retain = retain; this.changed = changed;
    this.records = plan.items.map(item => ({ item, status: "pending", value: null, error: "" }));
    this.running = false; this.disposed = false; this.controller = null;
  }
  get counts() {
    const counts = { total: this.records.length, ready: 0, failed: 0, pending: 0, processing: 0 };
    for (const record of this.records) counts[record.status]++;
    return counts;
  }
  async start({ retryFailed = false } = {}) {
    if (this.disposed) throw new Error("This export has been closed.");
    if (this.running) throw new Error("These files are already being prepared.");
    const records = this.records.filter(record => record.status === (retryFailed ? "failed" : "pending"));
    if (!records.length) return;
    const controller = new AbortController(); this.controller = controller; this.running = true;
    records.forEach(record => { record.status = "processing"; record.error = ""; }); this.changed();
    try {
      await Promise.all(records.map(async record => {
        try {
          const result = await this.render(record.item, { plan: this.plan, signal: controller.signal });
          if (this.disposed) return;
          if (controller.signal.aborted) { record.status = "pending"; return; }
          record.value = this.retain(result, record.item); record.status = "ready";
        } catch (error) {
          if (this.disposed) return;
          record.status = controller.signal.aborted ? "pending" : "failed";
          record.error = record.status === "failed" ? error?.userMessage ?? error?.message ?? "This file could not be prepared." : "";
        } finally { if (!this.disposed) this.changed(); }
      }));
    } finally {
      this.running = false; this.controller = null;
      if (!this.disposed) this.changed();
    }
  }
  pause() { this.controller?.abort(); }
  dispose() {
    this.disposed = true; this.pause();
    // An aborted renderer can settle later. Its promise must not keep already
    // released output files alive after their owner's memory ledger is cleared.
    for (const record of this.records) record.value = null;
  }
}
