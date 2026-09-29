import { importStoryPhotos } from "./assets.js";
import { createPhotoStory } from "./recipes.js";
import { StoryFontLoader } from "./font-loader.js";
import { applyProjectCommand } from "../project/history.js";
import { clone } from "../project/model.js";
import { readStoredStoryAsset, writeStoryProject } from "../project/storage.js";
import { getProcessingScheduler } from "../processing/client.js";
import { storyStyleCommand, validateStyle } from "../styles/model.js";

const aborted = signal => { if (signal?.aborted) throw new DOMException("Story creation paused.", "AbortError"); };

// The queue keeps file handles and receipts. Only the active group's bytes are
// inspected or expanded; each story and its dependencies commit atomically.
export class GroupedStoryImport {
  constructor(groups, style, { pool = getProcessingScheduler() } = {}) {
    validateStyle(style);
    if (!groups.length || groups.length > 1000 || groups.some(group => group.problem || group.files.length < 6 || group.files.length > 12)) throw new Error("Review the photo groups before creating stories.");
    this.style = clone(style); this.pool = pool;
    this.groups = groups.map(group => ({ ...group, files: [...group.files], name: group.name.trim().slice(0, 80) || "My story", status: "pending", receipt: null, error: null }));
    this.running = false;
  }
  get saved() { return this.groups.filter(group => group.status === "saved").map(group => group.receipt); }
  get pending() { return this.groups.filter(group => !["saved", "skipped"].includes(group.status)); }
  skipFailed() {
    if (this.running) return;
    const group = this.pending[0];
    if (group?.status === "failed") { group.status = "skipped"; group.files = []; }
  }
  async run({ signal, changed = () => {} } = {}) {
    if (this.running) throw new Error("This import is already running.");
    this.running = true;
    try {
      for (const group of this.pending) {
        aborted(signal); group.status = "importing"; group.error = null; changed(group);
        try {
          group.receipt = await this.save(group, signal, (done, total) => changed(group, { done, total }));
        } catch (error) {
          group.status = error.name === "AbortError" ? "pending" : "failed";
          group.error = error.name === "AbortError" ? null : error.message; changed(group); throw error;
        }
        group.status = "saved"; group.files = []; changed(group);
      }
      return this.saved;
    } finally { this.running = false; }
  }
  async save(group, signal, progress) {
    const owner = `story-group-import:${crypto.randomUUID()}`, pool = this.pool;
    const fontBytes = this.style.assets.reduce((sum, asset) => sum + asset.byteLength, 0);
    const sourceBytes = group.files.reduce((sum, file) => sum + file.size, 0);
    // Cover retained Blobs, the largest sequential integrity read/digest, font
    // loading and project metadata in addition to each worker's own admission.
    const largest = Math.max(...group.files.map(file => file.size), ...this.style.assets.map(asset => asset.byteLength), 0);
    await pool.reserveRetainedBytes(owner, sourceBytes + largest * 2 + fontBytes * 3 + 1024 * 1024, { signal });
    try {
      const entries = await importStoryPhotos(group.files, { signal, pool, onProgress: progress });
      aborted(signal);
      const base = createPhotoStory(entries.map(entry => entry.asset), { title: group.name });
      const project = applyProjectCommand(base, storyStyleCommand(base, this.style)).project;
      const sources = new Map(entries.map(entry => [entry.asset.id, entry.source]));
      const fonts = new StoryFontLoader({ sources, readStored: readStoredStoryAsset });
      // Load every dependency before starting an atomic save. Cancellation never
      // leaves a document pointing at only a subset of its photo/font assets.
      for (const asset of Object.values(project.assets)) {
        aborted(signal);
        if (!sources.has(asset.id)) await fonts.read(asset, { signal });
      }
      aborted(signal);
      const saved = await writeStoryProject(project, { readAsset: id => sources.get(id) });
      // A pause arriving during the commit still counts the completed story.
      return { ...saved, name: project.name, byteLength: Object.values(project.assets).reduce((sum, asset) => sum + asset.byteLength, 0) };
    } finally { pool.setRetainedBytes(owner, 0); pool.releaseIdle(); }
  }
}
