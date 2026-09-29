import { formatExtension, normalizeFormat } from "../formats.js";
import { exportFolderName, filenameStem, readableSlug } from "../names.js";
import { legacyRecipeOperations, legacyRecipeProblem } from "../styles/legacy.js";
import { pendingFolderContract } from "./render-contract.js";

export const JOB_DB_VERSION = 2;
export const MAX_LARGE_FOLDER_FILES = 100_000;
export const MANIFEST_WRITE_SIZE = 250;
export const DEFAULT_ROW_HEIGHT = 68;
export const DEFAULT_OVERSCAN_ROWS = 8;

export const ENTRY_STATUSES = Object.freeze(["pending", "processing", "completed", "failed", "skipped"]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

export function stablePathHash(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

export function safeRelativeParts(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part
      .replace(/[\u0000-\u001f\u007f<>:\"|?*]/g, "-")
      .trim()
      .replace(/[. ]+$/g, "") || "folder");
}

// Source paths identify real files. Reject traversal instead of silently
// sanitizing it into a different source; keep valid platform filenames intact.
export function sourceRelativeParts(value) {
  if (typeof value !== "string" || value.includes("\u0000")) throw new Error("Invalid source path.");
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Invalid source path.");
  return parts;
}

export function validateSourceMetadata(entry, file) {
  if (!entry.allowSourceChange && (entry.sourceBytes !== file.size || entry.lastModified !== file.lastModified)) {
    throw new Error("This source changed after discovery. Check the image, then use Retry failed to accept the updated source.");
  }
}

export function largeOutputFileName(relativePath, recipeName, format) {
  const parts = safeRelativeParts(relativePath);
  const sourceName = parts.at(-1) ?? "image";
  const extensionIndex = sourceName.lastIndexOf(".");
  const sourceExtension = readableSlug(extensionIndex > 0 ? sourceName.slice(extensionIndex + 1) : "image", "image");
  const stem = filenameStem(sourceName).slice(0, 68).replace(/[. ]+$/g, "") || "image";
  return `${stem}-${sourceExtension}-${readableSlug(recipeName)}-${stablePathHash(relativePath)}.${formatExtension(format)}`;
}

export function outputRelativePath(relativePath, recipeName, format) {
  const parts = safeRelativeParts(relativePath);
  parts.pop();
  return [...parts, largeOutputFileName(relativePath, recipeName, format)].join("/");
}

export function createLargeJob({ id, sourceHandle, sourceName, recipe, createdAt = Date.now() }) {
  const safeRecipe = clone(recipe) ?? {};
  const sourceFormat = legacyRecipeOperations(safeRecipe)?.format ?? safeRecipe.operations?.format;
  const format = normalizeFormat(sourceFormat) ?? sourceFormat ?? "png";
  if (!safeRecipe.operations) safeRecipe.operations = {};
  safeRecipe.operations.format = format;
  return {
    id: String(id),
    version: JOB_DB_VERSION,
    createdAt,
    updatedAt: createdAt,
    status: "scanning",
    sourceName: String(sourceName ?? "Image folder"),
    sourceHandle,
    outputBaseHandle: null,
    outputHandle: null,
    outputFolderName: exportFolderName(safeRecipe.name ?? "images", new Date(createdAt)),
    recipe: safeRecipe,
    format,
    renderContract: pendingFolderContract(),
    discovered: 0,
    sourceBytes: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    outputBytes: 0,
    scanComplete: false,
    error: null,
  };
}

export function outputFormatForJob(job) {
  const saved = job?.format;
  if (saved != null) return normalizeFormat(saved) ?? saved;
  const recipeFormat = legacyRecipeOperations(job?.recipe)?.format;
  return normalizeFormat(recipeFormat) ?? recipeFormat ?? "png";
}

export function createManifestEntry({ jobId, index, relativePath, file }) {
  return {
    jobId: String(jobId),
    index: safeInteger(index),
    relativePath: sourceRelativeParts(relativePath).join("/"),
    sourceName: String(file?.name ?? safeRelativeParts(relativePath).at(-1) ?? "image"),
    sourceBytes: safeInteger(file?.size),
    lastModified: safeInteger(file?.lastModified),
    type: String(file?.type ?? "application/octet-stream"),
    status: "pending",
    attempts: 0,
    outputPath: null,
    outputBytes: 0,
    width: 0,
    height: 0,
    format: null,
    error: null,
  };
}

export function settingsForLargeJob(recipe, outputFormat = null) {
  if (recipe?.recovery) throw new Error("Recovered edits belong to one image. Save a reusable recipe before processing a folder.");
  if (recipe?.style) {
    const problem = legacyRecipeProblem(recipe, undefined, outputFormat); if (problem) throw new Error(problem);
  }
  const operations = recipe ? legacyRecipeOperations(recipe) ?? {} : {};
  const requestedFormat = outputFormat ?? operations.format;
  if (requestedFormat != null && !normalizeFormat(requestedFormat)) throw new Error(`Saved ${requestedFormat} output is unavailable. Choose a supported replacement.`);
  const format = normalizeFormat(requestedFormat) ?? "png";
  return {
    crop: null,
    cropRelative: operations.cropRelative ?? null,
    rotation: safeInteger(operations.rotation) % 360,
    flipX: Boolean(operations.flipX),
    flipY: Boolean(operations.flipY),
    resizeWidth: safeInteger(operations.resizeWidth),
    resizeHeight: safeInteger(operations.resizeHeight),
    maxWidth: safeInteger(operations.resizeWidth),
    maxHeight: safeInteger(operations.resizeHeight),
    resizeMode: operations.resizeMode === "crop" ? "crop" : "fit",
    aspectLocked: operations.aspectLocked !== false,
    brightness: Number.isFinite(Number(operations.brightness)) ? Number(operations.brightness) : 1,
    contrast: Number.isFinite(Number(operations.contrast)) ? Number(operations.contrast) : 1,
    grayscale: Boolean(operations.grayscale),
    ...(operations.photoLook ? { photoLook: clone(operations.photoLook) } : {}),
    textLayers: operations.textLayers ?? [],
    ...(operations.jpegBackground ? { jpegBackground: operations.jpegBackground } : {}),
    lossy: Boolean(operations.lossy),
    quality: Number.isFinite(Number(operations.quality)) ? Number(operations.quality) : 95,
    format,
    presetId: String(recipe?.id ?? "folder-job"),
    presetName: String(recipe?.name ?? "Folder job"),
  };
}

export function finishedCount(job) {
  return safeInteger(job?.completed) + safeInteger(job?.failed) + safeInteger(job?.skipped);
}

export function jobProgress(job) {
  const discovered = safeInteger(job?.discovered);
  const finished = finishedCount(job);
  return {
    discovered,
    finished,
    remaining: Math.max(0, discovered - finished),
    ratio: discovered ? Math.min(1, finished / discovered) : 0,
    complete: Boolean(job?.scanComplete && discovered === finished),
  };
}

export function largeJobActionState(job) {
  const status = String(job?.status ?? "ready");
  const failed = safeInteger(job?.failed);
  const progress = jobProgress(job);
  const retryOnly = failed > 0
    && (status === "needs-attention" || (status === "paused" && progress.remaining === 0));
  return {
    startHidden: status === "running" || status === "pausing" || retryOnly,
    startLabel: status === "paused" ? "Resume remaining" : status === "needs-attention" ? "Resume" : "Start processing",
    retryHidden: !retryOnly,
    retryLabel: `Retry ${failed.toLocaleString()} failed`,
  };
}

export function virtualWindow({ total, scrollTop, viewportHeight, rowHeight = DEFAULT_ROW_HEIGHT, overscan = DEFAULT_OVERSCAN_ROWS }) {
  const count = safeInteger(total);
  const height = Math.max(1, safeInteger(rowHeight, DEFAULT_ROW_HEIGHT));
  const start = Math.max(0, Math.floor(Math.max(0, Number(scrollTop) || 0) / height) - safeInteger(overscan));
  const visible = Math.ceil(Math.max(height, Number(viewportHeight) || height) / height) + safeInteger(overscan) * 2;
  const end = Math.min(count, start + visible);
  return {
    start,
    end,
    count: Math.max(0, end - start),
    offset: start * height,
    totalHeight: count * height,
  };
}

export function formatJobBytes(value) {
  const bytes = safeInteger(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
