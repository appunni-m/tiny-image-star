import { STORY_FONT_DATA } from "./font-pack-data.js";
import { fontDigest } from "../compositor/fonts.js";

const entries = structuredClone(STORY_FONT_DATA);
const same = (a, b) => a && b && Object.keys(a).length === Object.keys(b).length
  && Object.entries(b).every(([key, value]) => value && typeof value === "object" ? same(a[key], value) : a[key] === value);
export const STORY_TYPE_REVISION = 1;
export function storyFont(role) { return structuredClone(entries.find((entry) => entry.role === role)?.asset ?? null); }
export function storyFonts() { return entries.map((entry) => structuredClone(entry.asset)); }
export function knownStoryFont(asset) { return entries.some((entry) => same(asset, entry.asset)); }
export function storyFontForBuiltin(id) { return storyFont({ "system-serif": "serif", "system-sans": "sans", "system-mono": "mono", "system-display": "display" }[id ?? "system-sans"]); }

export function unsupportedFontCharacters(asset, text) {
  const entry = entries.find((entry) => same(asset, entry.asset));
  if (!entry) return [];
  return [...new Set([...String(text ?? "")].filter((character) => {
    const point = character.codePointAt(0);
    return ![9, 10, 13].includes(point) && !entry.codepoints.some(([start, end]) => point >= start && point <= end);
  }))];
}

/** Bounded, same-origin-only fetch. The caller owns cancellation and retention. */
export async function loadStoryFont(asset, { signal, fetcher = globalThis.fetch } = {}) {
  if (signal?.aborted) throw new DOMException("Font loading cancelled.", "AbortError");
  const entry = entries.find((entry) => same(asset, entry.asset));
  if (!entry) throw new Error("This font pack is unavailable in this app version. Choose a supported style or device fonts.");
  const fail = () => new Error(`${asset.name} could not be loaded. Retry when connected, or choose device fonts in Text.`);
  let response;
  try { response = await fetcher(new URL(`../assets/story-type-v1/${entry.path}`, import.meta.url), { signal, credentials: "omit", mode: "same-origin", redirect: "error" }); }
  catch (error) { if (signal?.aborted) throw error; throw fail(); }
  if (!response.ok || !response.body) throw fail();
  const reader = response.body.getReader(), bytes = new Uint8Array(asset.byteLength);
  let offset = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Font loading cancelled.", "AbortError");
      const { done, value } = await reader.read(); if (done) break;
      if (offset + value.length > bytes.length) throw fail();
      bytes.set(value, offset); offset += value.length;
    }
    if (offset !== bytes.length || await fontDigest(bytes) !== asset.sha256) throw fail();
    return new Blob([bytes], { type: asset.type });
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
