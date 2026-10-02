/**
 * Track resident image-source IDs in least-recently-used order and protect
 * sources while callers hold leases. The manager does not own image bytes or
 * dispose sources; callers ask for eviction candidates, dispose them, then
 * remove them with evict().
 */
export class ImageSourceResidencyManager {
  #entries = new Map();

  get size() { return this.#entries.size; }

  /** Forget tracked residency at a document/runtime lifecycle boundary. */
  clear() {
    const size = this.#entries.size;
    this.#entries.clear();
    return size;
  }

  has(assetId) { return this.#entries.has(assetId); }

  /** Mark a source resident; return true only when it was newly added. */
  markResident(assetId) {
    this.#validateAssetId(assetId);
    const existing = this.#entries.get(assetId);
    if (existing) {
      this.#touchEntry(assetId, existing);
      return false;
    }
    this.#entries.set(assetId, { pinCount: 0 });
    return true;
  }

  /** Make a resident source most recent; return false when it is not resident. */
  touch(assetId) {
    const entry = this.#entries.get(assetId);
    if (!entry) return false;
    this.#touchEntry(assetId, entry);
    return true;
  }

  /** Return the number of active leases for a resident source, or zero. */
  pinCount(assetId) { return this.#entries.get(assetId)?.pinCount ?? 0; }

  /**
   * Acquire a pin lease for a resident source. Every successful call creates
   * one independent pin; release() is idempotent. Missing sources return null.
   */
  acquire(assetId) {
    const entry = this.#entries.get(assetId);
    if (!entry) return null;
    entry.pinCount += 1;
    this.#touchEntry(assetId, entry);
    let released = false;
    return {
      assetId,
      release: () => {
        if (released) return false;
        released = true;
        // A resident entry cannot be evicted while this lease is outstanding.
        // The guard keeps a stale lease harmless if a caller discards manager
        // state through an external lifecycle boundary.
        if (this.#entries.get(assetId) === entry) entry.pinCount -= 1;
        return true;
      }
    };
  }

  /** Return the oldest unpinned source ID, or null if none can be evicted. */
  oldestUnpinned({ exclude = [] } = {}) {
    const excluded = this.#excludedIds(exclude);
    for (const [assetId, entry] of this.#entries) {
      if (!entry.pinCount && !excluded.has(assetId)) return assetId;
    }
    return null;
  }

  /**
   * Return eviction candidates from oldest to newest without changing their
   * recency. A finite limit truncates the list; exclusions are left resident.
   */
  evictionCandidates({ limit = Infinity, exclude = [] } = {}) {
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw new RangeError('The eviction candidate limit must be a nonnegative safe integer or Infinity.');
    }
    if (limit === 0) return [];
    const excluded = this.#excludedIds(exclude);
    const candidates = [];
    for (const [assetId, entry] of this.#entries) {
      if (entry.pinCount || excluded.has(assetId)) continue;
      candidates.push(assetId);
      if (candidates.length >= limit) break;
    }
    return candidates;
  }

  /**
   * Remove an unpinned resident source after its owner has disposed it.
   * Returns false for a missing or currently leased source.
   */
  evict(assetId) {
    const entry = this.#entries.get(assetId);
    if (!entry || entry.pinCount) return false;
    return this.#entries.delete(assetId);
  }

  #touchEntry(assetId, entry) {
    this.#entries.delete(assetId);
    this.#entries.set(assetId, entry);
  }

  #validateAssetId(assetId) {
    if (typeof assetId !== 'string' || !assetId.trim()) {
      throw new TypeError('An image source needs a nonempty asset ID.');
    }
  }

  #excludedIds(exclude) {
    if (exclude == null || typeof exclude[Symbol.iterator] !== 'function') {
      throw new TypeError('Eviction exclusions must be iterable asset IDs.');
    }
    return new Set(exclude);
  }
}
