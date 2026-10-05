export const MAX_LOCAL_SHAPING_FONT_BYTES = 20 * 1024 * 1024;
export const MAX_LOCAL_SHAPING_TEXT_CODE_UNITS = 32_768;
export const MAX_LOCAL_SHAPING_CACHE_BYTES = 8 * 1024 * 1024;
export const MAX_LOCAL_SHAPING_CACHE_ENTRIES = 256;

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function stableMap(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)));
}

export function fontShapeCacheKey({ fontId, text, variations, features, script, language, direction } = {}) {
  if (typeof fontId !== 'string' || typeof text !== 'string') throw new TypeError('A font identity and text are required for shaping.');
  return JSON.stringify([fontId, text, stableMap(variations), stableMap(features), script || '', language || '', direction || '']);
}

function copyResult(result) {
  return result && {
    upem: result.upem,
    extents: result.extents ? { ...result.extents } : null,
    ...(result.positionMetrics ? { positionMetrics: structuredClone(result.positionMetrics) } : {}),
    ...(result.leadingTrimMetrics ? { leadingTrimMetrics: { ...result.leadingTrimMetrics } } : {}),
    missingGlyph: result.missingGlyph === true,
    glyphs: Array.isArray(result.glyphs) ? result.glyphs.map(glyph => ({ ...glyph })) : []
  };
}

export class LocalFontShapingClient {
  #workerFactory;
  #onReady;
  #worker = null;
  #nextId = 1;
  #requests = new Map();
  #pendingShapes = new Map();
  #loadedFonts = new Map();
  #fontLoads = new Map();
  #cache = new Map();
  #cacheBytes = 0;
  #fontGenerations = new Map();
  #closed = false;

  constructor({
    workerFactory = () => new Worker(new URL('./workers/font-shaping-worker.bundle.js', import.meta.url), { type: 'module' }),
    onReady = () => {}, maxCacheBytes = MAX_LOCAL_SHAPING_CACHE_BYTES,
    maxCacheEntries = MAX_LOCAL_SHAPING_CACHE_ENTRIES
  } = {}) {
    if (typeof workerFactory !== 'function' || typeof onReady !== 'function'
      || !Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < 0
      || !Number.isSafeInteger(maxCacheEntries) || maxCacheEntries < 0) {
      throw new TypeError('The local font shaping client options are invalid.');
    }
    this.#workerFactory = workerFactory;
    this.#onReady = onReady;
    this.maxCacheBytes = maxCacheBytes;
    this.maxCacheEntries = maxCacheEntries;
  }

  get(fontId, request) {
    const key = fontShapeCacheKey({ ...request, fontId });
    const result = this.#cache.get(key);
    if (!result) return null;
    this.#cache.delete(key);
    this.#cache.set(key, result);
    return copyResult(result.value);
  }

  hasFont(fontId) { return this.#loadedFonts.has(fontId); }
  fontInfo(fontId) { return this.#loadedFonts.get(fontId) || null; }

  async loadFont(fontId, sourceBytes) {
    this.#ensureOpen();
    const bytes = bytesOf(sourceBytes);
    if (typeof fontId !== 'string' || !/^[\w.-]{1,128}$/u.test(fontId)
      || !bytes || bytes.byteLength < 12 || bytes.byteLength > MAX_LOCAL_SHAPING_FONT_BYTES) {
      throw new TypeError('The local font data is outside the supported preview limits.');
    }
    if (this.#loadedFonts.has(fontId)) return this.#loadedFonts.get(fontId);
    if (this.#fontLoads.has(fontId)) return this.#fontLoads.get(fontId);
    const generation = this.#fontGenerations.get(fontId) || 0;
    const promise = this.#request('load-font', {
      fontId, bytes: bytes.slice().buffer
    }, ['bytes']).then(value => {
      if ((this.#fontGenerations.get(fontId) || 0) !== generation) throw new Error('The local font was released during loading.');
      for (const evictedFontId of value.evictedFontIds || []) this.#loadedFonts.delete(evictedFontId);
      this.#loadedFonts.set(fontId, value);
      return value;
    }).finally(() => this.#fontLoads.delete(fontId));
    this.#fontLoads.set(fontId, promise);
    return promise;
  }

  async shape(fontId, request) {
    const text = request?.text;
    if (typeof text !== 'string' || text.length > MAX_LOCAL_SHAPING_TEXT_CODE_UNITS) {
      throw new TypeError('This text is outside the supported local preview limits.');
    }
    const key = fontShapeCacheKey({ ...request, fontId });
    const cached = this.get(fontId, request);
    if (cached) return cached;
    const pendingKey = `shape:${key}`;
    const pending = this.#pendingShapes.get(pendingKey);
    if (pending) return pending;
    this.#ensureOpen();
    const generation = this.#fontGenerations.get(fontId) || 0;
    const promise = this.#request('shape', { fontId, ...request })
      .then(result => {
        if ((this.#fontGenerations.get(fontId) || 0) !== generation) throw new Error('The local font was released during shaping.');
        const value = copyResult(result);
        const size = value.glyphs.reduce((total, glyph) => total + (glyph.path?.length || 0) * 2 + 32, 64);
        if (size <= this.maxCacheBytes && this.maxCacheEntries > 0) {
          while (this.#cache.size >= this.maxCacheEntries || this.#cacheBytes + size > this.maxCacheBytes) {
            const oldest = this.#cache.entries().next().value;
            if (!oldest) break;
            this.#cache.delete(oldest[0]);
            this.#cacheBytes -= oldest[1].size;
          }
          if (this.#cacheBytes + size <= this.maxCacheBytes) {
            this.#cache.set(key, { value, size });
            this.#cacheBytes += size;
          }
        }
        this.#onReady({ fontId, key });
        return copyResult(value);
      }).finally(() => this.#pendingShapes.delete(pendingKey));
    this.#pendingShapes.set(pendingKey, promise);
    return promise;
  }

  async shapeWithFont(fontId, sourceBytes, request) {
    await this.loadFont(fontId, sourceBytes);
    return this.shape(fontId, request);
  }

  releaseFont(fontId) {
    this.#fontGenerations.set(fontId, (this.#fontGenerations.get(fontId) || 0) + 1);
    this.#loadedFonts.delete(fontId);
    this.#fontLoads.delete(fontId);
    for (const [key, item] of this.#cache) {
      if (!key.startsWith(`[${JSON.stringify(fontId)},`)) continue;
      this.#cache.delete(key);
      this.#cacheBytes -= item.size;
    }
    if (!this.#closed && this.#worker) return this.#request('release-font', { fontId }).then(result => result.released);
    return Promise.resolve(false);
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#worker?.terminate?.();
    this.#worker = null;
    for (const pending of this.#requests.values()) pending.reject(new Error('The local font shaping client is closed.'));
    for (const pending of this.#fontLoads.values()) pending.catch(() => {});
    this.#requests.clear();
    this.#pendingShapes.clear();
    this.#fontLoads.clear();
    this.#loadedFonts.clear();
    this.#cache.clear();
    this.#cacheBytes = 0;
    this.#fontGenerations.clear();
  }

  #ensureOpen() {
    if (this.#closed) throw new Error('The local font shaping client is closed.');
  }

  #ensureWorker() {
    this.#ensureOpen();
    if (this.#worker) return this.#worker;
    const worker = this.#workerFactory();
    if (!worker || typeof worker.postMessage !== 'function' || typeof worker.addEventListener !== 'function') {
      throw new TypeError('The local font shaping worker is unavailable.');
    }
    worker.addEventListener('message', event => {
      const message = event.data || {};
      const pending = this.#requests.get(message.id);
      if (!pending) return;
      this.#requests.delete(message.id);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(new Error(message.error || 'Local font shaping failed.'));
    });
    worker.addEventListener('error', event => {
      const error = new Error(event.message || 'The local font shaping worker stopped unexpectedly.');
      for (const pending of this.#requests.values()) pending.reject(error);
      this.#requests.clear();
      this.#worker?.terminate?.();
      this.#worker = null;
      this.#loadedFonts.clear();
    });
    this.#worker = worker;
    return worker;
  }

  #request(type, payload, transferableKeys = []) {
    const worker = this.#ensureWorker();
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#requests.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, type, ...payload }, transferableKeys.map(key => payload[key]));
      } catch (error) {
        this.#requests.delete(id);
        reject(error);
      }
    });
  }
}
