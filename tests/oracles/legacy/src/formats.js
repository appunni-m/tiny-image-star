// One small format vocabulary shared by the editor, batch view, and worker
// handshake. The engine remains the source of truth; this file only keeps the
// UI labels, file-picker filters, and filenames consistent.

export const FORMAT_INFO = Object.freeze({
  png: { label: "PNG", extensions: [".png"], mimeTypes: ["image/png"] },
  jpeg: { label: "JPEG", extensions: [".jpg", ".jpeg"], mimeTypes: ["image/jpeg"] },
  gif: { label: "GIF", extensions: [".gif"], mimeTypes: ["image/gif"] },
  bmp: { label: "BMP", extensions: [".bmp"], mimeTypes: ["image/bmp", "image/x-ms-bmp"] },
  webp: { label: "WebP", extensions: [".webp"], mimeTypes: ["image/webp"] },
  tiff: { label: "TIFF", extensions: [".tif", ".tiff"], mimeTypes: ["image/tiff"] },
  ico: { label: "ICO", extensions: [".ico"], mimeTypes: ["image/x-icon", "image/vnd.microsoft.icon"] },
  avif: { label: "AVIF", extensions: [".avif"], mimeTypes: ["image/avif"] },
});

const FORMAT_ALIASES = Object.freeze({
  jpg: "jpeg",
  jpe: "jpeg",
  tif: "tiff",
  icon: "ico",
});

export const DEFAULT_CAPABILITIES = Object.freeze({
  inputFormats: ["jpeg", "png", "gif", "bmp", "webp", "tiff", "ico"],
  outputFormats: ["png"],
  avif: { input: false, output: false },
  compression: { lossy: false, lossyFormats: [], quality: false },
});

export function normalizeFormat(value) {
  const format = String(value ?? "").trim().toLowerCase().replace(/^\./, "");
  const normalized = FORMAT_ALIASES[format] ?? format;
  return FORMAT_INFO[normalized] ? normalized : null;
}

function normalizeList(values, fallback) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map(normalizeFormat).filter(Boolean))];
}

export function normalizeCapabilities(raw = {}) {
  const inputFormats = normalizeList(raw.inputFormats, DEFAULT_CAPABILITIES.inputFormats);
  const outputFormats = normalizeList(raw.outputFormats, DEFAULT_CAPABILITIES.outputFormats);
  const lossyFormats = normalizeList(raw.compression?.lossyFormats, [])
    .filter((format) => outputFormats.includes(format));
  return {
    inputFormats: inputFormats.length ? inputFormats : ["png"],
    outputFormats: outputFormats.length ? outputFormats : ["png"],
    avif: {
      input: Boolean(raw.avif?.input && inputFormats.includes("avif")),
      output: Boolean(raw.avif?.output && outputFormats.includes("avif")),
    },
    compression: {
      lossy: Boolean(raw.compression?.lossy && lossyFormats.length),
      lossyFormats,
      quality: Boolean(raw.compression?.quality && lossyFormats.length),
    },
  };
}

export function formatInfo(format) {
  return FORMAT_INFO[normalizeFormat(format) ?? "png"];
}

export function formatLabel(format) {
  return formatInfo(format).label;
}

export function formatMime(format) {
  return formatInfo(format).mimeTypes[0];
}

export function formatExtension(format) {
  return formatInfo(format).extensions[0].slice(1);
}

export function formatListLabel(formats) {
  return formats.map(formatLabel).join(", ");
}

export function formatAccept(formats) {
  const values = [];
  for (const format of formats) {
    const info = FORMAT_INFO[normalizeFormat(format) ?? ""];
    if (!info) continue;
    values.push(...info.mimeTypes, ...info.extensions);
  }
  return [...new Set(values)].join(",");
}

export function fileMatchesFormats(file, formats) {
  if (!file) return false;
  const normalizedFormats = formats.map(normalizeFormat).filter(Boolean);
  if (file.type && normalizedFormats.some((format) => FORMAT_INFO[format].mimeTypes.includes(file.type.toLowerCase()))) return true;
  const name = String(file.name ?? "").toLowerCase();
  return normalizedFormats.some((format) => FORMAT_INFO[format].extensions.some((extension) => name.endsWith(extension)));
}
