import {
  clearEditorSession,
  clearSession,
  readEditorSession,
  readSession,
} from "./session.js";
import { clearStoredFonts, countStoredFonts } from "./editor/fonts.js";

export const PRESETS_STORAGE_KEY = "tiny-image-star.presets.v1";

function safePresetCount() {
  try {
    const value = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((preset) => preset?.id && preset?.operations).length : 0;
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
  const [active, editor, fontCount] = await Promise.all([readSession(), readEditorSession(), countStoredFonts()]);
  const records = [active, editor].filter(Boolean);
  return {
    presetCount: safePresetCount(),
    fontCount,
    recoveryCount: records.length,
    recoveryBytes: records.reduce((total, record) => total + recoveryBytes(record), 0),
  };
}

export async function clearStoredLocalData() {
  try {
    localStorage.removeItem(PRESETS_STORAGE_KEY);
  } catch {
    // Private browsing can deny localStorage writes. The IndexedDB cleanup
    // still runs and the summary reports what remains available.
  }
  await Promise.all([clearSession(), clearEditorSession(), clearStoredFonts()]);
  return readLocalDataSummary();
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
  const presetCount = document.querySelector("#local-data-preset-count");
  const fontCount = document.querySelector("#local-data-font-count");
  const recoveryCount = document.querySelector("#local-data-recovery-count");
  const recoverySize = document.querySelector("#local-data-recovery-size");
  const status = document.querySelector("#local-data-status");
  if (!dialog || !openButton || !clearButton) return;

  async function renderSummary(message = "") {
    const summary = await readLocalDataSummary();
    if (presetCount) presetCount.textContent = `${summary.presetCount} saved recipe${summary.presetCount === 1 ? "" : "s"}`;
    if (fontCount) fontCount.textContent = `${summary.fontCount} saved font${summary.fontCount === 1 ? "" : "s"}`;
    if (recoveryCount) recoveryCount.textContent = `${summary.recoveryCount} recovery cop${summary.recoveryCount === 1 ? "y" : "ies"}`;
    if (recoverySize) recoverySize.textContent = formatLocalBytes(summary.recoveryBytes);
    if (status) status.textContent = message || "Recipes, custom fonts, and recovery copies stay in this browser. Open images and generated results remain in memory.";
    return summary;
  }

  openButton.addEventListener("click", () => {
    void renderSummary().then(() => {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    });
  });
  closeButton?.addEventListener("click", () => dialog.close());
  clearButton.addEventListener("click", async () => {
    if (!window.confirm("Clear saved recipes, custom fonts, and recovery copies from this browser? The image currently open will stay available.")) return;
    clearButton.disabled = true;
    const summary = await clearStoredLocalData();
    clearButton.disabled = false;
    await renderSummary(`Cleared saved data. ${summary.presetCount} recipes, ${summary.fontCount} fonts, and ${summary.recoveryCount} recovery copies remain.`);
    window.dispatchEvent(new CustomEvent("tinystar:local-data-cleared"));
  });
}
