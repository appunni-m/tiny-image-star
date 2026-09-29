// Metadata-only selection: one large file per supported format, plus spread
// across discovery order and the smallest source. Never retain the manifest.
export const MAX_FOLDER_SAMPLES = 12;
export function createFolderSampleSelector(total) {
  if (!Number.isSafeInteger(total) || total < 0 || total > 100000) throw new Error("Invalid folder sample count.");
  const positions = new Set([0, Math.floor((total - 1) / 2), total - 1]);
  const spread = new Map(), formats = new Map(); let smallest = null;
  const formatFor = (entry) => {
    const extension = entry.relativePath.split(".").at(-1).toLowerCase();
    return ({ jpg: "jpeg", tif: "tiff" })[extension] ?? extension;
  };
  return {
    add(entry) {
      if (!Number.isSafeInteger(entry.index) || entry.index < 0 || entry.index >= total || !Number.isFinite(entry.sourceBytes) || entry.sourceBytes < 0) throw new Error("Invalid sample metadata.");
      if (positions.has(entry.index)) spread.set(entry.index, entry);
      const format = formatFor(entry);
      if (["jpeg", "png", "gif", "bmp", "webp", "tiff", "ico"].includes(format)) {
        const previous = formats.get(format);
        if (!previous || entry.sourceBytes > previous.sourceBytes || entry.sourceBytes === previous.sourceBytes && entry.index < previous.index) formats.set(format, entry);
      }
      if (!smallest || entry.sourceBytes < smallest.sourceBytes || entry.sourceBytes === smallest.sourceBytes && entry.index < smallest.index) smallest = entry;
    },
    finish() {
      return [...new Map([...formats.values(), ...spread.values(), ...(smallest ? [smallest] : [])].map(entry => [entry.index, entry])).values()]
        .sort((a, b) => a.index - b.index).slice(0, MAX_FOLDER_SAMPLES).map(entry => structuredClone(entry));
    },
  };
}

export function processingEstimate({ elapsedMs, completed, remaining }) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 1000 || !Number.isInteger(completed) || completed < 2 || !Number.isInteger(remaining) || remaining < 1) return null;
  return Math.ceil(elapsedMs / completed * remaining / 1000);
}

export function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "unavailable";
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} seconds`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} minutes`;
  return `${(seconds / 3600).toFixed(1)} hours`;
}
