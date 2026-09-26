import { STORY_SOURCE_LIMIT } from "./assets.js";

export const MAX_GROUPED_PHOTOS = 12000;
export const MAX_GROUPED_STORIES = 1000;
export const PHOTO_ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
const supported = file => /\.(png|jpe?g|webp)$/i.test(file.name) || /^image\/(png|jpeg|webp)$/i.test(file.type);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Metadata only. Pixel inspection and hashing happen after scheduler admission.
// Folder paths are labels, never output paths or instructions to read a file.
export function planPhotoGroups(files, { mode = "fixed", size = 8, order = "selection", leftovers = "review", title = "My stories" } = {}) {
  if (!Array.isArray(files) || files.length > MAX_GROUPED_PHOTOS) throw new Error(`Choose at most ${MAX_GROUPED_PHOTOS.toLocaleString()} files at a time.`);
  if (!["fixed", "folder"].includes(mode) || !Number.isInteger(size) || size < 6 || size > 12
    || !["selection", "name"].includes(order) || !["review", "include", "rebalance", "skip"].includes(leftovers)) throw new Error("Choose supported grouping options.");
  const buckets = new Map(), unsupported = [], groups = [], remainder = [];
  files.forEach((file, index) => {
    if (!file || typeof file.name !== "string" || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error("A selected file has invalid metadata. Choose the photos again.");
    if (!supported(file)) { unsupported.push(file); return; }
    const path = file.webkitRelativePath || file.name, folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const bucket = mode === "folder" ? folder : "";
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push({ file, path, index });
  });
  for (const [folder, entries] of [...buckets].sort(([a], [b]) => compare(a, b))) {
    if (order === "name") entries.sort((a, b) => compare(a.path, b.path) || a.index - b.index);
    let counts = Array(Math.floor(entries.length / size)).fill(size), tail = entries.length % size;
    if (leftovers === "rebalance" && entries.length >= 6) {
      const count = Math.min(Math.floor(entries.length / 6), Math.max(Math.ceil(entries.length / 12), Math.ceil(entries.length / size)));
      counts = Array.from({ length: count }, (_, i) => Math.floor(entries.length / count) + (i < entries.length % count ? 1 : 0));
      tail = 0;
    } else if (leftovers === "include" && tail >= 6) { counts.push(tail); tail = 0; }
    let offset = 0;
    for (const [index, count] of counts.entries()) {
      const photos = entries.slice(offset, offset + count).map(entry => entry.file); offset += count;
      const byteLength = photos.reduce((sum, file) => sum + file.size, 0);
      const base = (folder || String(title).trim() || "My stories").slice(0, 65);
      groups.push({ id: `group-${groups.length}`, name: `${base} · ${index + 1}`, folder, files: photos, byteLength,
        problem: photos.some(file => !file.size) ? "This group contains an empty file." : byteLength > STORY_SOURCE_LIMIT ? "This group exceeds 96 MiB. Use fewer or smaller photos." : null });
    }
    if (tail) remainder.push({ folder, files: entries.slice(offset).map(entry => entry.file), skipped: leftovers === "skip" });
  }
  if (groups.length > MAX_GROUPED_STORIES) throw new Error(`Choose a larger group size or fewer files. One import can create at most ${MAX_GROUPED_STORIES.toLocaleString()} stories.`);
  return { groups, remainder, unsupported, blocked: remainder.some(item => !item.skipped), photoCount: files.length - unsupported.length };
}
