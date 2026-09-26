// Shared font identity and bounds for editor previews and admitted workers.
// Font bytes are local assets, never CSS URLs supplied by a recipe.
export const MAX_FONT_BYTES = 16 * 1024 * 1024;
export const MAX_TEXT_FONT_BYTES = 32 * 1024 * 1024;
export const MAX_TEXT_FONTS = 8;
export const BUILTIN_FONTS = Object.freeze([
  { id: "system-sans", name: "Clean sans", family: "Arial, Helvetica, sans-serif" },
  { id: "system-serif", name: "Classic serif", family: "Georgia, 'Times New Roman', serif" },
  { id: "system-mono", name: "Monospace", family: "'Courier New', Courier, monospace" },
  { id: "system-display", name: "Bold display", family: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif" },
]);

export function textError(message, code = "text-unavailable") {
  const error = new Error(message);
  error.userMessage = message;
  error.code = code;
  return error;
}

export function builtinFontById(id) {
  return BUILTIN_FONTS.find((font) => font.id === id) ?? BUILTIN_FONTS[0];
}

export function fontRecordForLayer(fonts, layer) {
  return fonts?.get(layer?.fontId) ?? builtinFontById(layer?.fontId);
}

export function textFontRequirements(layers = []) {
  if (!Array.isArray(layers) || layers.length > 100) throw textError("An image can contain at most 100 text layers.");
  const required = new Map();
  for (const layer of layers) {
    const id = layer?.fontId ?? "system-sans";
    if (BUILTIN_FONTS.some((font) => font.id === id)) continue;
    if (typeof id !== "string" || !/^font-[a-f0-9]{8,64}$/.test(id)) throw textError("A font used by this edit is missing. Drop the font file again.", "font-missing");
    const bytes = layer.fontBytes ?? MAX_FONT_BYTES;
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_FONT_BYTES) throw textError("A font exceeds the 16 MiB font limit.", "font-limit");
    const sha256 = layer.fontSha256 ?? null;
    if (sha256 !== null && !/^[a-f0-9]{64}$/.test(sha256)) throw textError("A font reference is invalid.", "font-integrity");
    const previous = required.get(id);
    if (previous?.sha256 && sha256 && previous.sha256 !== sha256) throw textError("Two layers reference different versions of the same font.", "font-integrity");
    required.set(id, { id, bytes: Math.max(previous?.bytes ?? 0, bytes), sha256: previous?.sha256 ?? sha256,
      knownSize: (previous?.knownSize ?? true) && layer.fontBytes != null });
  }
  const bytes = [...required.values()].reduce((sum, font) => sum + font.bytes, 0);
  const knownBytes = [...required.values()].reduce((sum, font) => sum + (font.knownSize ? font.bytes : 0), 0);
  if (required.size > MAX_TEXT_FONTS || knownBytes > MAX_TEXT_FONT_BYTES) throw textError("Use at most eight custom fonts totaling 32 MiB in one edit.", "font-limit");
  // Old recipes lack sizes. Reserve the enforced total limit rather than
  // rejecting three small fonts as though all three were 16 MiB files.
  return { required, bytes: Math.min(bytes, MAX_TEXT_FONT_BYTES) };
}

export async function fontDigest(bytes) {
  if (!globalThis.crypto?.subtle) throw textError("Font verification needs a secure browser context.", "font-integrity");
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyFontRecord(record, requirement) {
  const bytes = record?.bytes;
  if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength) throw textError("A font used by this edit is missing. Drop the font file again.", "font-missing");
  if (bytes.byteLength > requirement.bytes || bytes.byteLength > MAX_FONT_BYTES) throw textError("A font changed or exceeds its processing memory budget. Drop the font file again.", "font-limit");
  const sha256 = await fontDigest(bytes);
  // Old local-file sessions used an eight-digit FNV ID; verify those bytes too.
  let legacy = 2166136261;
  for (const byte of new Uint8Array(bytes)) legacy = Math.imul(legacy ^ byte, 16777619);
  const legacyId = `font-${(legacy >>> 0).toString(16).padStart(8, "0")}`;
  if (record.id !== requirement.id || (record.id !== `font-${sha256.slice(0, 16)}` && record.id !== legacyId)
      || requirement.sha256 && sha256 !== requirement.sha256 || record.sha256 && sha256 !== record.sha256) {
    throw textError("A saved font failed its integrity check. Drop the original font file again.", "font-integrity");
  }
  const family = record.id === legacyId ? `TinyStarFont-${legacyId.slice(5)}` : `TinyStarFont-${sha256.slice(0, 10)}`;
  return { ...record, family, sha256, byteLength: bytes.byteLength };
}

export async function loadFontFace(record) {
  const fontSet = globalThis.document?.fonts ?? globalThis.fonts;
  if (typeof FontFace !== "function" || !fontSet) throw textError("Custom fonts are not available in this browser.");
  if (record.fontFace && (!/^[1-9]00 [1-9]00$/.test(record.fontFace.weight) || !["normal", "italic"].includes(record.fontFace.style))) throw textError("Invalid saved typeface settings.", "font-invalid");
  // A variable face and an older default-descriptor face can share the same
  // bytes. Separate CSS families prevent one from taking the other's matches.
  const family = record.fontFace ? `${record.family}-${record.fontFace.weight.replace(" ", "_")}-${record.fontFace.style}` : record.family;
  const face = new FontFace(family, record.bytes, record.fontFace ?? {});
  try {
    await face.load();
    fontSet.add(face);
    return { ...record, family, face };
  } catch {
    fontSet.delete(face);
    throw textError("That font could not be loaded. Drop a valid .ttf, .otf, .woff, or .woff2 file.", "font-invalid");
  }
}
