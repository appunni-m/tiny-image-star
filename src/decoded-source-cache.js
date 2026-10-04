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
    this.pinnedAssetIds = new Set();
    this.activeAssetId = null;
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

  /**
   * Protect a resident source from ordinary LRU eviction. Returns false when
   * it is absent or cannot fit the current budget. Pins are idempotent; use
   * unpin when the caller no longer needs the source protected.
   */
  pin(assetId) {
    const entry = this.entries.get(assetId);
    if (!entry || entry.pixels > this.pixelBudget) return false;
    let pinnedPixels = 0;
    for (const pinnedId of this.pinnedAssetIds) {
      if (pinnedId === assetId || pinnedId === this.activeAssetId) continue;
      pinnedPixels += this.entries.get(pinnedId)?.pixels || 0;
    }
    if (assetId !== this.activeAssetId) pinnedPixels += entry.pixels;
    if (pinnedPixels > this.pixelBudget) return false;
    this.pinnedAssetIds.add(assetId);
    this.get(assetId); // A newly protected source should also be the newest LRU entry.
    return true;
  }

  /** Remove an explicit pin; an asset declared active remains protected. */
  unpin(assetId) { return this.pinnedAssetIds.delete(assetId); }

  /**
   * Declare the one source currently being edited. The intent is recorded
   * even before decoding; a later set() will protect it if it fits the budget.
   * Returns true only when that source is already resident.
   */
  setActive(assetId) {
    if (assetId !== null && (typeof assetId !== 'string' || !assetId)) {
      throw new TypeError('An active decoded image needs an asset ID or null.');
    }
    this.activeAssetId = assetId;
    if (assetId == null) return false;
    if (!this.entries.has(assetId)) return false;
    this.get(assetId);
    return true;
  }

  /** Change the retained-pixel ceiling and report every source evicted. */
  setBudget(pixelBudget) {
    if (!Number.isSafeInteger(pixelBudget) || pixelBudget < 0) {
      throw new RangeError('The decoded image cache budget must be a nonnegative safe integer.');
    }
    this.pixelBudget = pixelBudget;
    const evictedAssetIds = [];
    while (this.pixels > this.pixelBudget) {
      // Keep the active source through normal cache pressure. An explicit
      // budget reduction is different: evict ordinary entries first, then
      // explicit pins, and finally the active source if it cannot fit.
      const oldestAssetId = this.#oldestUnprotectedAssetId()
        ?? this.#oldestExplicitlyPinnedAssetId()
        ?? this.activeAssetId;
      if (oldestAssetId == null || !this.entries.has(oldestAssetId)) break;
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
    if (previous?.source === source && previous.pixels === pixelCount) {
      this.get(assetId);
      return { retained: true, evictedAssetIds: [] };
    }
    const wasExplicitlyPinned = this.pinnedAssetIds.has(assetId);
    if (previous) this.#remove(assetId, previous.source !== source);
    if (previous && wasExplicitlyPinned) this.pinnedAssetIds.add(assetId);

    if (pixelCount > this.pixelBudget) {
      this.pinnedAssetIds.delete(assetId);
      return { retained: false, evictedAssetIds: [] };
    }

    const evictedAssetIds = [];
    // The image the user is editing takes priority over explicit warm-cache
    // pins. Match setBudget(): ordinary entries are evicted first, explicit
    // pins next, and the active image last. Without this, a newly selected
    // image could be refused even though dropping a lower-priority pin would
    // keep the active original resident for rapid successive edits.
    let protectedPixels = this.#protectedPixels();
    if (assetId === this.activeAssetId && protectedPixels + pixelCount > this.pixelBudget) {
      // Count protected pixels once, then walk LRU order once. Recomputing the
      // total and rescanning for the oldest pin after every eviction makes
      // admission quadratic when a selection replaces many warm-cache pins.
      for (const pinnedAssetId of this.entries.keys()) {
        if (pinnedAssetId === this.activeAssetId || !this.pinnedAssetIds.has(pinnedAssetId)) continue;
        const pinnedPixels = this.entries.get(pinnedAssetId)?.pixels || 0;
        if (!pinnedPixels) continue;
        this.#remove(pinnedAssetId, true);
        protectedPixels -= pinnedPixels;
        evictedAssetIds.push(pinnedAssetId);
        if (protectedPixels + pixelCount <= this.pixelBudget) break;
      }
    }

    // The incoming source must fit beside every currently protected source,
    // even when it will itself remain ordinarily evictable after insertion.
    protectedPixels += pixelCount;
    if (protectedPixels > this.pixelBudget) {
      this.pinnedAssetIds.delete(assetId);
      return { retained: false, evictedAssetIds };
    }

    while (this.pixels + pixelCount > this.pixelBudget) {
      const oldestAssetId = this.#oldestUnprotectedAssetId(assetId);
      // If all remaining capacity belongs to pinned assets, leave ownership
      // of the new source with the caller; withSource() will free it.
      if (oldestAssetId == null) {
        this.pinnedAssetIds.delete(assetId);
        return { retained: false, evictedAssetIds };
      }
      this.#remove(oldestAssetId, true);
      evictedAssetIds.push(oldestAssetId);
    }
    this.entries.set(assetId, { source, pixels: pixelCount });
    this.pixels += pixelCount;
    return { retained: true, evictedAssetIds };
  }

  /** Remove one cached source, matching the worker's explicit dispose message. */
  delete(assetId) {
    const existed = this.entries.has(assetId);
    this.#remove(assetId, true);
    if (this.activeAssetId === assetId) this.activeAssetId = null;
    this.pinnedAssetIds.delete(assetId);
    return existed;
  }

  /** Free every retained WASM image; called when its worker is closed. */
  clear() {
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.pixels = 0;
    this.pinnedAssetIds.clear();
    this.activeAssetId = null;
    let firstError = null;
    for (const { source } of entries) {
      try { source.free(); }
      catch (error) { firstError ??= error; }
    }
    if (firstError) throw firstError;
  }

  /**
   * Reuse a cached source or create one for a single render. Oversized images
   * are intentionally ephemeral, but still pass through the normal decoder's
   * independent 80M-pixel safety limit.
   */
  withSource(assetId, createSource, render, { retain = true } = {}) {
    const cached = retain ? this.get(assetId) : undefined;
    if (cached) {
      const state = { retained: true, evictedAssetIds: [] };
      try {
        return { result: render(cached), ...state };
      } catch (error) {
        throw this.#cacheError(error, state);
      }
    }

    // A worker may finish loading WASM after the main thread has disposed an
    // asset. Such a render can still complete for orderly promise settlement,
    // but it must not repopulate the worker cache with an orphaned source.
    // Drop only a resident entry here: dispose owns clearing active selection
    // state. A newer setActive() for the same ID can arrive while this render
    // waits for WASM, and this stale render must not clear that newer intent.
    if (!retain) this.#remove(assetId, true);

    const source = createSource();
    let pixels;
    try {
      pixels = imagePixels(source);
    } catch (error) {
      source.free();
      throw error;
    }
    const state = retain && pixels <= this.pixelBudget
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
    this.pinnedAssetIds.delete(assetId);
    if (freeSource) entry.source.free();
  }

  #isProtected(assetId) {
    return assetId === this.activeAssetId || this.pinnedAssetIds.has(assetId);
  }

  #protectedPixels() {
    let pixels = 0;
    for (const [assetId, entry] of this.entries) {
      if (this.#isProtected(assetId)) pixels += entry.pixels;
    }
    return pixels;
  }

  #oldestUnprotectedAssetId(excludingAssetId = null) {
    for (const assetId of this.entries.keys()) {
      if (assetId !== excludingAssetId && !this.#isProtected(assetId)) return assetId;
    }
    return null;
  }

  #oldestExplicitlyPinnedAssetId() {
    for (const assetId of this.entries.keys()) {
      if (assetId !== this.activeAssetId && this.pinnedAssetIds.has(assetId)) return assetId;
    }
    return null;
  }
}

export { DEFAULT_PIXEL_BUDGET as DEFAULT_DECODED_SOURCE_PIXEL_BUDGET };
