import { knownStoryFont, loadStoryFont } from "../styles/font-pack.js";

const aborted = () => new DOMException("Font loading cancelled.", "AbortError");

// One bounded request per pinned font. Consumers share a fetch, but cancel
// independently; the last departing consumer aborts it. The workspace owns
// cached Blobs and includes both them and this temporary allowance in its ledger.
export class StoryFontLoader {
  constructor({ sources, onChange = () => {}, readStored = async () => null, load = loadStoryFont }) {
    this.sources = sources; this.onChange = onChange; this.readStored = readStored; this.load = load; this.pending = new Map();
  }
  get pendingBytes() { return [...this.pending.values()].reduce((sum, request) => sum + request.asset.byteLength * 3, 0); }
  async read(asset, { signal } = {}) {
    if (signal?.aborted) throw aborted();
    if (this.sources.has(asset?.id)) return this.sources.get(asset.id);
    if (!knownStoryFont(asset)) return undefined;
    let request = this.pending.get(asset.id);
    if (request?.controller.signal.aborted) { await request.promise.catch(() => {}); return this.read(asset, { signal }); }
    if (!request) {
      request = { asset, controller: new AbortController(), users: 0 }; this.pending.set(asset.id, request);
      request.promise = Promise.resolve().then(async () => {
        const stored = await this.readStored(asset);
        if (request.controller.signal.aborted) throw aborted();
        const blob = stored ?? await this.load(asset, { signal: request.controller.signal });
        if (request.controller.signal.aborted || !request.users) throw aborted();
        this.sources.set(asset.id, blob); return blob;
      }).finally(() => { if (this.pending.get(asset.id) === request) this.pending.delete(asset.id); this.onChange(); });
      void request.promise.catch(() => {}); this.onChange();
    }
    request.users++;
    let cancel;
    try {
      return await Promise.race([request.promise, new Promise((_, reject) => {
        cancel = () => reject(aborted()); signal?.addEventListener("abort", cancel, { once: true });
      })]);
    } finally {
      signal?.removeEventListener("abort", cancel);
      if (--request.users === 0 && this.pending.get(asset.id) === request) request.controller.abort();
    }
  }
}
