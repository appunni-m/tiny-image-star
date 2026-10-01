/**
 * Retain one verified object-erase result so later image edits can skip MI-GAN.
 * Entries are accounted by the editor's retained-image budget and remain
 * pinned until every render using them has drained.
 */
export class PreparedInpaintCache {
  constructor({ memoryBudget, onDispose = () => {} } = {}) {
    if (!memoryBudget || typeof memoryBudget.reserve !== 'function'
      || typeof memoryBudget.releaseReservation !== 'function') {
      throw new TypeError('Prepared object-erase caching needs an image memory budget.');
    }
    if (typeof onDispose !== 'function') throw new TypeError('Prepared object-erase cleanup needs a callback.');
    this.memoryBudget = memoryBudget;
    this.onDispose = onDispose;
    this.sourceIds = new WeakMap();
    this.nextSourceId = 0;
    this.nextEntryId = 0;
    this.current = null;
    this.retired = new Set();
  }

  #signature(sourceBytes, assetId, strokes, dimensions) {
    if (!sourceBytes || typeof sourceBytes !== 'object'
      || typeof assetId !== 'string' || !assetId
      || !Array.isArray(strokes)
      || !dimensions || !Number.isSafeInteger(dimensions.width) || dimensions.width < 1
      || !Number.isSafeInteger(dimensions.height) || dimensions.height < 1
      || !Number.isSafeInteger(dimensions.width * dimensions.height)) {
      throw new TypeError('Prepared object-erase cache keys need a source, asset, strokes, and valid dimensions.');
    }
    const sourceId = this.#sourceId(sourceBytes);
    return JSON.stringify({
      sourceId,
      assetId,
      width: dimensions.width,
      height: dimensions.height,
      strokes
    });
  }

  #sourceId(sourceBytes) {
    let sourceId = this.sourceIds.get(sourceBytes);
    if (!sourceId) {
      sourceId = ++this.nextSourceId;
      this.sourceIds.set(sourceBytes, sourceId);
    }
    return sourceId;
  }

  /** Acquire a pinned source for rendering; the returned lease must be released. */
  acquire(sourceBytes, assetId, strokes, dimensions) {
    const signature = this.#signature(sourceBytes, assetId, strokes, dimensions);
    if (!this.current) return null;
    if (this.current.signature !== signature) {
      this.clear();
      return null;
    }
    return this.#lease(this.current);
  }

  /** Drop an entry when the image no longer carries object-erase strokes. */
  invalidateSource(sourceBytes, assetId) {
    if (!sourceBytes || typeof sourceBytes !== 'object' || typeof assetId !== 'string') return false;
    const sourceId = this.sourceIds.get(sourceBytes);
    if (!sourceId || this.current?.sourceId !== sourceId || this.current.sourceAssetId !== assetId) return false;
    return this.clear();
  }

  /** Drop an entry when its original asset becomes unreachable and is disposed. */
  invalidateAsset(assetId) {
    if (typeof assetId !== 'string' || this.current?.sourceAssetId !== assetId) return false;
    return this.clear();
  }

  /** Store a verified worker result and return a pinned lease, or null if over budget. */
  store(sourceBytes, assetId, strokes, dimensions, preparedBytes) {
    const signature = this.#signature(sourceBytes, assetId, strokes, dimensions);
    if (!(preparedBytes instanceof Uint8Array) || preparedBytes.byteLength < 1) {
      throw new TypeError('Prepared object-erase results must contain image bytes.');
    }
    this.clear();
    const entryId = ++this.nextEntryId;
    const reservation = this.memoryBudget.reserve(preparedBytes.byteLength, { kind: 'prepared-object-erase' });
    if (!reservation) return null;

    let bytes = null;
    try {
      bytes = preparedBytes.slice();
      const entry = {
        signature,
        bytes,
        assetId: `inpaint-prepared:${entryId}`,
        sourceId: this.#sourceId(sourceBytes),
        sourceAssetId: assetId,
        reservation,
        references: 0,
        retired: false
      };
      this.current = entry;
      return this.#lease(entry);
    } catch (error) {
      bytes?.fill(0);
      this.memoryBudget.releaseReservation(reservation);
      throw error;
    }
  }

  /** Invalidate the current key; leased entries are released after their renders drain. */
  clear() {
    const entry = this.current;
    if (!entry) return false;
    this.current = null;
    entry.retired = true;
    this.retired.add(entry);
    if (entry.references === 0) this.#finalize(entry);
    return true;
  }

  #lease(entry) {
    entry.references += 1;
    let released = false;
    return {
      bytes: entry.bytes,
      assetId: entry.assetId,
      release: () => {
        if (released) return false;
        released = true;
        entry.references -= 1;
        if (entry.retired && entry.references === 0) this.#finalize(entry);
        return true;
      }
    };
  }

  #finalize(entry) {
    if (!this.retired.has(entry)) return false;
    this.retired.delete(entry);
    entry.bytes.fill(0);
    this.memoryBudget.releaseReservation(entry.reservation);
    try { this.onDispose(entry.assetId); } catch { /* cleanup cannot strand the retained bytes */ }
    return true;
  }
}
