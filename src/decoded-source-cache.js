const DEFAULT_PIXEL_BUDGET = 16_000_000;

function imagePixels(source) {
  const { width, height } = source ?? {};
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || !Number.isSafeInteger(pixels)) {
    throw new RangeError('A decoded image must have positive, safe dimensions.');
  }
  return pixels;
}

/**
 * A worker-local LRU for decoded WASM images. The default retains at most 16M
 * pixels (about 64 MiB for an RGBA working image) per worker. This avoids
 * repeatedly decoding sources while bounding retained memory; the budget is
 * per worker, so deployments that enable more workers trade throughput for a
 * proportionally larger possible cache footprint. A source above the budget
 * remains renderable, but is kept only for the duration of its render.
 */
export class DecodedSourceCache {
  constructor({ pixelBudget = DEFAULT_PIXEL_BUDGET } = {}) {
    if (!Number.isSafeInteger(pixelBudget) || pixelBudget < 0) {
      throw new RangeError('The decoded image cache budget must be a nonnegative safe integer.');
    }
    this.pixelBudget = pixelBudget;
    this.pixels = 0;
    this.entries = new Map();
  }

  get size() { return this.entries.size; }

  has(assetId) { return this.entries.has(assetId); }

  get(assetId) {
    const entry = this.entries.get(assetId);
    if (!entry) return undefined;
    // Map insertion order is the LRU order, oldest first.
    this.entries.delete(assetId);
    this.entries.set(assetId, entry);
    return entry.source;
  }

  /** Change the retained-pixel ceiling and report every source evicted. */
  setBudget(pixelBudget) {
    if (!Number.isSafeInteger(pixelBudget) || pixelBudget < 0) {
      throw new RangeError('The decoded image cache budget must be a nonnegative safe integer.');
    }
    this.pixelBudget = pixelBudget;
    const evictedAssetIds = [];
    while (this.pixels > this.pixelBudget) {
      const oldestAssetId = this.entries.keys().next().value;
      this.#remove(oldestAssetId, true);
      evictedAssetIds.push(oldestAssetId);
    }
    return { pixelBudget, evictedAssetIds };
  }

  /** Insert a source, taking ownership only when it fits the cache budget. */
  set(assetId, source, pixelCount = imagePixels(source)) {
    if (!Number.isSafeInteger(pixelCount) || pixelCount < 1) {
      throw new RangeError('A cached image must have a positive safe pixel count.');
    }

    const previous = this.entries.get(assetId);
    if (previous) this.#remove(assetId, previous.source !== source);

    if (pixelCount > this.pixelBudget) return { retained: false, evictedAssetIds: [] };

    this.entries.set(assetId, { source, pixels: pixelCount });
    this.pixels += pixelCount;
    const evictedAssetIds = [];
    while (this.pixels > this.pixelBudget) {
      const oldestAssetId = this.entries.keys().next().value;
      this.#remove(oldestAssetId, true);
      evictedAssetIds.push(oldestAssetId);
    }
    return { retained: true, evictedAssetIds };
  }

  /** Remove one cached source, matching the worker's explicit dispose message. */
  delete(assetId) {
    if (!this.entries.has(assetId)) return false;
    this.#remove(assetId, true);
    return true;
  }

  /** Free every retained WASM image; called when its worker is closed. */
  clear() {
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.pixels = 0;
    for (const { source } of entries) source.free();
  }

  /**
   * Reuse a cached source or create one for a single render. Oversized images
   * are intentionally ephemeral, but still pass through the normal decoder's
   * independent 80M-pixel safety limit.
   */
  withSource(assetId, createSource, render) {
    const cached = this.get(assetId);
    if (cached) {
      const state = { retained: true, evictedAssetIds: [] };
      try {
        return { result: render(cached), ...state };
      } catch (error) {
        throw this.#cacheError(error, state);
      }
    }

    const source = createSource();
    let pixels;
    try {
      pixels = imagePixels(source);
    } catch (error) {
      source.free();
      throw error;
    }
    const state = pixels <= this.pixelBudget
      ? this.set(assetId, source, pixels)
      : { retained: false, evictedAssetIds: [] };
    try {
      return { result: render(source), ...state };
    } catch (error) {
      throw this.#cacheError(error, state);
    } finally {
      if (!state.retained) source.free();
    }
  }

  #cacheError(error, state) {
    if (error && (typeof error === 'object' || typeof error === 'function')) {
      try { error.decodedSourceCache = state; } catch { /* Preserve the original render error. */ }
    }
    return error;
  }

  #remove(assetId, freeSource) {
    const entry = this.entries.get(assetId);
    if (!entry) return;
    this.entries.delete(assetId);
    this.pixels -= entry.pixels;
    if (freeSource) entry.source.free();
  }
}

export { DEFAULT_PIXEL_BUDGET as DEFAULT_DECODED_SOURCE_PIXEL_BUDGET };
