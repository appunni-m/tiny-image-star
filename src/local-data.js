import {
  clearEditorSession,
  clearSession,
  readEditorSession,
  readSession,
  readLegacySessionBackups,
} from "./session.js";
import { clearStoredFonts, countStoredFonts, readFontRecords } from "./editor/fonts.js";
import { exportRecoveryBackup, listStoryProjects, clearStoryProjects } from "./project/storage.js";
import { assertStyleStorageWritable, clearStyleLibrary, readStyleCatalogBackup } from "./styles/store.js";
import { LEGACY_RECIPES_KEY } from "./styles/catalog-model.js";

export const PRESETS_STORAGE_KEY = LEGACY_RECIPES_KEY;

function safePresetCount(styles = [], catalog = []) {
  if (catalog.length) return 0; // The retained legacy source is an archive now.
  try {
    const value = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) ?? "[]");
    const migrated = new Set(styles.filter((record) => record.style?.kind === "tiny-image-star/legacy-style").map((record) => record.style.id));
    return Array.isArray(value) ? value.filter((preset) => preset?.id && preset?.operations && !migrated.has(preset.id)).length : 0;
  } catch {
    return 0;
  }
}

function recoveryBytes(record) {
  if (!record) return 0;
  if (record.kind === "editor") return record.editor?.bytes?.byteLength ?? 0;
  return (record.batch?.files ?? []).reduce((total, item) => total + (item.bytes?.byteLength ?? 0), 0);
}

export async function readLocalDataSummary() {
  const [active, editor, fontCount, stories, { styleLibrary: styles, recipeCatalog: catalog }] = await Promise.all([readSession(), readEditorSession(), countStoredFonts(), listStoryProjects(), readStyleCatalogBackup()]);
  const records = [active, editor].filter(Boolean);
  return {
    presetCount: safePresetCount(styles, catalog) + styles.length,
    fontCount,
    recoveryCount: records.length + stories.length,
    recoveryBytes: records.reduce((total, record) => total + recoveryBytes(record), 0) + stories.reduce((sum, story) => sum + story.byteLength, 0),
  };
}

export async function clearStoredLocalData() {
  await assertStyleStorageWritable();
  globalThis.dispatchEvent?.(new CustomEvent("tinystar:local-data-clearing"));
  try {
    localStorage.removeItem(PRESETS_STORAGE_KEY);
  } catch {
    // Private browsing can deny localStorage writes. The IndexedDB cleanup
    // still runs and the summary reports what remains available.
  }
  await Promise.all([clearSession(), clearEditorSession(), clearStoredFonts(), clearStoryProjects(), clearStyleLibrary()]);
  const summary = await readLocalDataSummary();
  globalThis.dispatchEvent?.(new CustomEvent("tinystar:local-data-cleared"));
  return summary;
}

export function formatLocalBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function attachLocalDataControls() {
  const dialog = document.querySelector("#local-data-dialog");
  const openButton = document.querySelector("#local-data-button");
  const closeButton = document.querySelector("#local-data-close-button");
  const clearButton = document.querySelector("#local-data-clear-button");
  const backupButton = document.querySelector("#local-data-backup-button");
  const presetCount = document.querySelector("#local-data-preset-count");
  const fontCount = document.querySelector("#local-data-font-count");
  const recoveryCount = document.querySelector("#local-data-recovery-count");
  const recoverySize = document.querySelector("#local-data-recovery-size");
  const status = document.querySelector("#local-data-status");
  if (!dialog || !openButton || !clearButton) return;

  async function renderSummary(message = "") {
    const summary = await readLocalDataSummary();
    if (presetCount) presetCount.textContent = `${summary.presetCount} saved styles and recipes`;
    if (fontCount) fontCount.textContent = `${summary.fontCount} saved font${summary.fontCount === 1 ? "" : "s"}`;
    if (recoveryCount) recoveryCount.textContent = `${summary.recoveryCount} recovery cop${summary.recoveryCount === 1 ? "y" : "ies"}`;
    if (recoverySize) recoverySize.textContent = formatLocalBytes(summary.recoveryBytes);
    if (status) status.textContent = message || "Saved stories, styles, recipes, custom fonts, and recovery copies stay in this browser. Open images and stories remain in memory. Folder jobs and story batches keep separate asset copies. Use Forget job or Forget batch to remove those copies. Forget batch also removes files staged in this browser; downloads and external saved files remain.";
    return summary;
  }

  openButton.addEventListener("click", () => {
    void renderSummary().then(() => {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    });
  });
  closeButton?.addEventListener("click", () => dialog.close());
  backupButton?.addEventListener("click", async () => {
    backupButton.disabled = true;
    try {
      const fonts = await readFontRecords({ strict: true });
      const legacy = await readLegacySessionBackups();
      const recipes = localStorage.getItem(PRESETS_STORAGE_KEY), { styleLibrary, recipeCatalog } = await readStyleCatalogBackup();
      const blob = await exportRecoveryBackup({ fonts, legacy, recipes, styleLibrary, recipeCatalog });
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `tiny-image-star-backup-${new Date().toISOString().slice(0, 10)}.tstar`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "Backup download started. It includes saved projects, original images, styles, recipes and custom fonts.";
    } catch (error) { status.textContent = `The backup could not be created: ${error.message}`; }
    finally { backupButton.disabled = false; }
  });
  clearButton.addEventListener("click", async () => {
    if (!window.confirm("Clear saved stories, styles, recipes, custom fonts, and recovery copies from this browser? Open images and stories will stay available until you close them.")) return;
    clearButton.disabled = true;
    try {
      const summary = await clearStoredLocalData();
      await renderSummary(`Cleared saved data. ${summary.presetCount} styles and recipes, ${summary.fontCount} fonts, and ${summary.recoveryCount} recovery copies remain.`);
    } catch (error) { status.textContent = `Saved data could not be cleared: ${error.message}`; }
    finally { clearButton.disabled = false; }
  });
}
