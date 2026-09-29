import { formatExtension } from "./formats.js";

const MAX_STEM_LENGTH = 96;
const MAX_SLUG_LENGTH = 48;

function lastPathSegment(value) {
  return String(value ?? "image").replaceAll("\\", "/").split("/").pop() ?? "image";
}

function safeText(value, fallback) {
  const cleaned = String(value ?? fallback)
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, MAX_STEM_LENGTH)
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned || fallback;
}

export function filenameStem(name) {
  const basename = safeText(lastPathSegment(name), "image");
  const dot = basename.lastIndexOf(".");
  return safeText(dot > 0 ? basename.slice(0, dot) : basename, "image");
}

export function readableSlug(value, fallback = "edited") {
  const source = safeText(value, fallback);
  const decomposed = source.normalize?.("NFKD") ?? source;
  const slug = decomposed
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function exportTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date(0);
  const part = (number) => String(number).padStart(2, "0");
  return `${safeDate.getUTCFullYear()}${part(safeDate.getUTCMonth() + 1)}${part(safeDate.getUTCDate())}-${part(safeDate.getUTCHours())}${part(safeDate.getUTCMinutes())}${part(safeDate.getUTCSeconds())}`;
}

export function outputFileName(inputName, recipeName, format) {
  return `${filenameStem(inputName)}-${readableSlug(recipeName)}.${formatExtension(format)}`;
}

export function downloadedFileName(inputName, recipeName, format, timestamp = new Date()) {
  const stem = filenameStem(inputName).slice(0, 72).replace(/[. ]+$/g, "") || "image";
  return `${stem}-${exportTimestamp(timestamp)}-${readableSlug(recipeName)}.${formatExtension(format)}`;
}

export function exportFolderName(recipeName, timestamp = new Date()) {
  return `tiny-image-star-${exportTimestamp(timestamp)}-${readableSlug(recipeName, "selected-images")}`;
}
