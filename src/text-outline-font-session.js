import { LocalFontShapingClient, MAX_LOCAL_SHAPING_TEXT_CODE_UNITS } from './font-shaping.js';
import { LocalWoff2Decoder } from './woff2-decoder.js';
import { validateLocalFontAsset } from './font-assets.js';
import { itemizeLocalFontRuns } from './font-fallback.js';
import { localFontsForStyle, localFontAxisValues } from './local-font-style.js';

export const TEXT_OUTLINE_FONT_LIMITS = Object.freeze({ maxBytes: 64 * 1024 * 1024, maxFonts: 32, maxPending: 8, requestTimeoutMs: 15_000 });

const abortError = () => new DOMException('Text conversion cancelled. Original layers kept.', 'AbortError');
const staleError = () => new Error('The design or its fonts changed while outlining. Try Outline Stroke again.');
const copyMetrics = value => value?.upem > 0 && ['ascender', 'descender', 'lineGap'].every(key => Number.isFinite(value.extents?.[key]))
  ? { upem: value.upem, extents: { ...value.extents }, ...(value.leadingTrimMetrics ? { leadingTrimMetrics: { ...value.leadingTrimMetrics } } : {}) } : null;

/** One conversion owns its font workers and immutable decoded font snapshots. */
export class TextOutlineFontSession {
  #fonts; #readFont; #shaper; #decoder; #signal; #assertCurrent; #timeoutMs;
  #records = new Map(); #bytes = 0; #closed = false; #abort; #tail = Promise.resolve(); #pending = 0;
  #closing = new AbortController();

  constructor({ fonts, readFont, signal, assertCurrent = () => {},
    shaper = new LocalFontShapingClient({ maxCacheBytes: 0, maxCacheEntries: 0 }),
    decoder = new LocalWoff2Decoder({ timeoutMs: TEXT_OUTLINE_FONT_LIMITS.requestTimeoutMs }),
    requestTimeoutMs = TEXT_OUTLINE_FONT_LIMITS.requestTimeoutMs } = {}) {
    if (!Array.isArray(fonts) || typeof readFont !== 'function' || typeof assertCurrent !== 'function'
      || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60_000) {
      shaper.close(); decoder.close();
      throw new TypeError('Text conversion needs local font records and a bounded font reader.');
    }
    this.#fonts = structuredClone(fonts); this.#readFont = readFont; this.#signal = signal;
    this.#assertCurrent = assertCurrent; this.#shaper = shaper; this.#decoder = decoder; this.#timeoutMs = requestTimeoutMs;
    this.#abort = () => this.close();
    signal?.addEventListener('abort', this.#abort, { once: true });
    if (signal?.aborted) this.close();
  }

  #check() {
    if (this.#signal?.aborted) throw abortError();
    if (this.#closed) throw new Error('The text conversion font session is closed.');
    if (this.#assertCurrent() === false) throw staleError();
  }

  async #wait(operation, label) {
    // A stale check can reject before observing a worker promise; always drain it.
    Promise.resolve(operation).catch(() => {});
    this.#check();
    let timer; let rejectAbort;
    const onAbort = () => rejectAbort(this.#signal?.aborted ? abortError() : new Error('The text conversion font session is closed.'));
    try {
      const result = await Promise.race([
        operation,
        new Promise((_, reject) => { rejectAbort = reject; this.#closing.signal.addEventListener('abort', onAbort, { once: true }); }),
        new Promise((_, reject) => { timer = setTimeout(() => {
          reject(new Error(`Local ${label} took too long. Original layers kept.`)); this.close();
        }, this.#timeoutMs); })
      ]);
      this.#check();
      return result;
    } catch (error) {
      if (this.#signal?.aborted) throw abortError();
      throw error;
    } finally {
      clearTimeout(timer); this.#closing.signal.removeEventListener('abort', onAbort);
    }
  }

  async #font(font) {
    this.#check();
    let record = this.#records.get(font.id);
    if (!record) {
      if (this.#records.size >= TEXT_OUTLINE_FONT_LIMITS.maxFonts) throw new Error('This text selection uses more than 32 local font files. Outline fewer layers at a time.');
      const saved = await this.#wait(Promise.resolve().then(() => this.#readFont(font.id)), 'font loading');
      if (!saved?.bytes) throw new Error(`Add the font file for “${font.family}” in Assets → Fonts before outlining this text.`);
      for (const key of ['id', 'name', 'family', 'weight', 'style', 'type']) {
        if (saved[key] !== font[key]) throw staleError();
      }
      const source = validateLocalFontAsset(saved, { copyBytes: false }).bytes;
      if (this.#bytes + source.byteLength > TEXT_OUTLINE_FONT_LIMITS.maxBytes) throw new Error('This selection exceeds the 64 MiB local outline font budget. Outline fewer fonts at a time.');
      const woff2 = source[0] === 0x77 && source[1] === 0x4f && source[2] === 0x46 && source[3] === 0x32;
      const decoded = woff2 ? await this.#wait(this.#decoder.decode(source), 'font decoding') : source;
      const bytes = decoded instanceof Uint8Array ? decoded.slice() : new Uint8Array(decoded).slice();
      if (this.#bytes + bytes.byteLength > TEXT_OUTLINE_FONT_LIMITS.maxBytes) throw new Error('This selection exceeds the 64 MiB decoded outline font budget. Outline fewer fonts at a time.');
      const info = await this.#wait(this.#shaper.loadFont(font.id, bytes), 'font parsing');
      const footprint = bytes.byteLength + (info.coverage?.length || 0) * 8;
      if (this.#bytes + footprint > TEXT_OUTLINE_FONT_LIMITS.maxBytes) throw new Error('This selection exceeds the 64 MiB outline font and coverage budget. Outline fewer fonts at a time.');
      record = { bytes, info }; this.#records.set(font.id, record); this.#bytes += footprint;
    } else if (!this.#shaper.hasFont(font.id)) {
      // The worker keeps four fonts at a time. Reload this immutable snapshot,
      // rather than reading a possibly changed file during the same conversion.
      await this.#wait(this.#shaper.loadFont(font.id, record.bytes), 'font parsing');
    }
    return record;
  }

  shapeText(text, style) {
    if (this.#pending >= TEXT_OUTLINE_FONT_LIMITS.maxPending) return Promise.reject(new Error('The local outline font queue is full. Wait for shaping to finish, then retry.'));
    // Font residency changes must not race another request on this worker.
    this.#pending += 1;
    const request = this.#tail.then(() => this.#shapeText(text, style)).finally(() => { this.#pending -= 1; });
    this.#tail = request.catch(() => {});
    return request;
  }

  async #shapeText(text, style) {
    this.#check();
    if (typeof text !== 'string' || text.length > MAX_LOCAL_SHAPING_TEXT_CODE_UNITS) throw new Error('This text exceeds the local outline shaping limit. Outline a smaller text layer.');
    const candidates = localFontsForStyle(style, this.#fonts);
    if (!candidates.length) throw new Error(`Add the font file for “${style?.fontFamily || 'this text'}” in Assets → Fonts, then choose that font before outlining.`);
    const coverage = [];
    for (const font of candidates) {
      const record = await this.#font(font);
      coverage.push({ id: font.id, coverage: record.info.coverage });
    }
    const runs = itemizeLocalFontRuns(text, coverage);
    if (runs.some(run => !run.fontId)) throw new Error('Some characters need a browser fallback font. Add a local font covering those characters before outlining. Original layers kept.');
    const byId = new Map(candidates.map(font => [font.id, font]));
    const mixedRuns = []; let primaryFontMetrics = null;
    for (const run of runs) {
      const font = byId.get(run.fontId);
      await this.#font(font);
      const shaped = await this.#wait(this.#shaper.shape(font.id, {
        text: run.text, variations: localFontAxisValues(font, style), features: style?.fontFeatures || undefined, script: run.script
      }), 'glyph shaping');
      if (shaped.missingGlyph) throw new Error(`The local font “${font.family}” cannot outline every character in this text. Original layers kept.`);
      if (font.id === candidates[0].id) primaryFontMetrics ||= copyMetrics(shaped);
      mixedRuns.push({ text: run.text, shaped });
    }
    // The declared font controls the logical line box, including text whose
    // actual glyphs all come from a different retained fallback font.
    if (!primaryFontMetrics) {
      const primary = candidates[0]; await this.#font(primary);
      const variations = localFontAxisValues(primary, style);
      primaryFontMetrics = copyMetrics(this.#shaper.getFontMetrics?.(primary.id, { variations }));
      if (!primaryFontMetrics) primaryFontMetrics = copyMetrics(await this.#wait(this.#shaper.shape(primary.id, {
        text: ' ', variations
      }), 'font line metrics'));
      if (!primaryFontMetrics) throw new Error('The declared local font cannot provide actual line metrics. Original layers kept.');
    }
    this.#check();
    if (!mixedRuns.length) return { ...primaryFontMetrics, primaryFontMetrics, glyphs: [] };
    return { ...(mixedRuns.length === 1 ? mixedRuns[0].shaped : { mixedRuns }), primaryFontMetrics };
  }

  validateCurrent() { this.#check(); }

  close() {
    if (this.#closed) return;
    this.#closed = true; this.#signal?.removeEventListener('abort', this.#abort); this.#closing.abort();
    this.#shaper.close(); this.#decoder.close(); this.#records.clear(); this.#bytes = 0;
  }
}
