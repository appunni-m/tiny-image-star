# Engine migration regression boundary

This slice covers every app-owned public function in `src/engine/pillow.js`
whose first two parameters are `api, file`: `renderWithApi` and `previewWithApi`.
Inventory discovery reads those declarations from the preserved adapter at app
revision `89cc88c` and checks a bijection with the manifest. This denominator
does not claim parity for the entire upstream Pillow API or the whole product.

The oracle is the preserved old adapter, its dependency closure, and its
generated JS/WASM pair. The upstream build identity was not recorded; hashes
pin the actual app artifact without inventing a source revision. Its integrity
file lives outside the immutable closure. The target is the current app adapter
and the exactly staged published runtime. Both run independently in Node
processes with the same input-only workflows. PNG output bytes and every other
returned field are compared exactly. Errors compare class, kind, message,
stage and code. No output expectations or hashes are stored in inputs.

The new text-composition behavior requires browser shaping and is qualified
separately by [real-worker tests](TEXT_COMPOSITOR_VERIFICATION.md). The frozen
legacy image-only cases do not claim parity for text or the full story renderer.

The file argument is a literal `{ name, bytes }` record; transport converts the
numeric byte sequence to Uint8Array. The API namespace record is serialized as
`{ module: "PillowBrowserApi" }` and resolved to each independently initialized
runtime. These are type conversions, not image algorithms. The input-file
digest binds the complete stimulus, including all literal bytes.

The small warm benchmark measures the complete public call, including ordinary
output validation. It is a regression signal, not the production concurrency
or physical-device performance qualification required by the migration plan.
Coverage measures V8 functions in the entire app-owned adapter, without
exclusions. Browser interactions and independent decoding remain separate gates.

Browser collection profiles now exercise `renderWithApi` through the normal
folder client, scheduler and journaled OPFS output path. Fixed settings and Auto
use the same pinned corpus, with separate cold/warm policies and five randomized
repetitions. The `successful_execution` gate independently decodes saved outputs
and compares full bytes across live settings. This is operational and concurrency
evidence, not a new migration oracle or added parity coverage. The preview
endpoint remains outside this browser benchmark slice. See the
[collection method](COLLECTION_BENCHMARKS.md); heavy scene workflows remain a
separate unqualified family and are not mislabeled as image-adapter benchmarks.

Generated evidence is not release proof while the target worktree is dirty.
After an approved commit, rerun the lanes against that exact revision; stale,
missing, invalid, cancelled or incompatible results remain unproven.
