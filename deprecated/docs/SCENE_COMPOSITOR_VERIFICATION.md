# Scene rendering and story recovery

Recorded 2026-09-17. This implements the multi-photo rendering boundary in
migration §§5 and 7 and connects it to the shared scheduler in §8A. It is a
developer API now used by the [visible story workspace](STORY_WORKSPACE_VERIFICATION.md). The
[execution ledger](MIGRATION_STATUS.md) retains the full product and release scope.

## Rendering contract

`createSceneProject` creates a versioned document containing stable asset,
layer and slide IDs. `createPillowEngine` exposes `ready`, `capabilities`,
`renderSlide`, `renderPreview` and `dispose` alongside the existing image APIs.
[Scene declarations](../src/compositor/contracts.d.ts) describe the request and
result; runtime schema checks enforce supported styles. These declarations are
documentation, not a TypeScript compilation gate.
`dispose` closes that API handle; terminating its physical worker is what
releases the loaded WASM instance and its high-water heap.

A scene supports ordered photos, text and rectangle/rounded/ellipse shapes.
Photos have cover/contain fitting, focal points, normalized source crops,
clockwise rotation, brightness/contrast/saturation/grayscale, and opacity.
Optional masks are upright, source-sized, 8-bit grayscale images; their values
multiply the source alpha. Scene grayscale preserves alpha. A background photo,
caption and masked foreground photo produce text behind the subject without
requiring another renderer. Segmentation itself is not implemented here.

The published, unchanged Pillow-RS pair decodes photos, normalizes EXIF, applies
photo transforms and masks, composites RGBA layers, resizes and encodes PNG/JPEG.
Worker `OffscreenCanvas` rasterizes vector/text layers. It does not encode the
finished scene. Fill and stroke are rasterized before applying layer opacity,
so overlaps do not become more opaque than the layer's chosen value. JPEG
flattening and encoder verification use the same path as the image editor.

Font assets are local, length/digest verified and explicitly loaded before
rendering. Captions wrap, including long unbroken words by grapheme, and shrink
within declared minimum/preferred sizes. A caption that still overflows returns
`TEXT_OVERFLOW` and clips within its frame for later review. System font choices
remain platform-dependent; the pinned Noto Sans file used by the tests is not
a bundled production font pack or proof of script coverage.

## Connected slides and previews

Slide-local frames resolve in one viewport. Story-space frames use a stable
anchor slide and world coordinates. A render allocates one output viewport,
not an eight-slide stitched bitmap. Photos outside that viewport are culled
before collecting their bytes or fonts. Vector edges use fixed, world-aligned
256-pixel tiles with bounded overlap, at least 64 pixels and expanded for the
declared text shadow. Each tile surface is reused and released afterward.

The first seam experiment found up to 40 channel levels of difference between
two separately rendered slides and a continuous reference. Per-layer probes
isolated the difference to canvas path/frame edges; caption pixels matched.
A smaller canvas-only ellipse probe reproduced it without Pillow. Fixed tile
coordinates and overlap remove that canvas-surface boundary difference. The
regression keeps its original maximum tolerance of two channel levels; the
current two-slide fixture measures zero at the seam and passes the whole-image
comparison. [The synthetic reference](research/2026-09-17/scene-seam.png) is a
test diagnostic, not a finished recipe or design sample.
An additional three-slide case uses odd-sized 257×321 viewports and an anchor
on the middle slide. It crosses multiple raster tiles, compares against one
771×321 reference, and verifies that the empty first viewport loads no assets.

Preview renders the exact canonical viewport and then performs one final
Pillow LANCZOS resize to at most a 1280-pixel long edge. Font metrics, transforms
and mask geometry are identical to the full export. The 1600×2000 fixture's
1024×1280 preview matches the independently downsampled export's PNG bytes
exactly. This path still pays for full source decode and canonical composition;
a small preview is not a claim of a small decode working set or low latency.

Both output variants resolve from the document, including stored variant frames
and optional width-based type sizing. The [story layout solver](ADAPTIVE_LAYOUT_VERIFICATION.md)
now computes photo-print arrangements and preserves manual overrides, with
collision review. The renderer consumes those frozen frames without rerunning
the solver or changing a reopened story.

## Shared worker admission

Use `enqueueScene` for application work. It freezes document metadata when
queued and reads/copies assets only after the shared scheduler admits the task.
Interactive previews have priority over exports. Image, text, folder and scene
work use the same CPU and memory policy. Cancellation aborts queued/preparing
work or terminates a busy synchronous-WASM worker. Results carry the frozen
project revision independently of the worker transport sequence.

`sceneWork` reserves the largest live source working set, canonical RGBA
surfaces, masks, fixed vector tile surface, encoded asset copies, font overhead
and output. Slide count does not multiply the canvas allocation. Direct engine
calls also check the default device budget unless supplied an admitted estimate.
The policy rejects work above its limits before source reads/decode. These are
conservative estimates, not measured process memory; callers must account for
their retained inputs, output previews and caches in the shared ledger.

## Story persistence

`writeStoryProject(project, {readAsset, expectedRevision})` saves a frozen
document and content-addressed Blob dependencies in one strict-durability
IndexedDB transaction. The default location is `story:<project id>`.
`expectedRevision: null` creates a new record; updating requires the revision
last opened or saved. The check runs inside the transaction, so two independent
tabs cannot overwrite each other even if a stale tab increments its own revision
by a larger amount. A mismatch returns `PROJECT_CONFLICT` and preserves storage.

Every asset in the document, including unused imported photos retained for
editing, must have its hash, length and appropriate dimensions. Images, masks
and fonts remain separate Blob records and deduplicate by SHA-256 across projects.
Writes verify bytes sequentially and honor the shared 128 MiB recovery asset
budget. Existing verified content can be reused without a new source provider.
Hashing currently expands one encoded asset at a time; storage hashing and
retained Blob handles still need integration with the future workspace's full
memory accounting.

`readStoryProject` opens metadata and immutable Blob handles without expanding
them into image/font buffers. Its `readAsset(id)` verifies length and digest
on access, suitable for the admitted scene queue. An already-open revision
retains its Blob handles if a later save removes those assets from IndexedDB.
Removing a document collects only assets no remaining record references.
Unknown versions remain blocked and included in the existing lossless backup.
An archive importer, history/source lifetime policy, explicit story project
library and storage eviction UI remain future work.

## Automated evidence

[Scene browser checks](../tests/scene-compositor.browser.mjs) execute the real
published WASM, native FontFace and shared workers. They cover:

- Analytic pixels for layer ordering, masks, alpha, cover focal points, crop,
  contain letterboxing, rotation and EXIF normalization.
- Actual text occlusion/reveal by an imported mask, connected-slide seams,
  alternate viewport geometry, preview/downsample parity, JPEG and overflow.
- Twelve outputs at each of 1, 4 and 8 workers, identical PNG hashes and frozen
  revisions, with no CPU/memory admission violations.
- Corrupt/missing assets, changed dimensions, wrong mask mode, rejected memory
  estimates before reads, queued/preparing cancellation and disposed handles.

[Story storage checks](../tests/story-storage.browser.mjs) use actual IndexedDB
and two separate browser pages. They compare rendered bytes after reload,
test immutable submission and offset typed-array inputs, deferred Blob reads,
deduplication, simultaneous save conflicts, stale revision jumps, quota rollback,
asset retention/collection, corruption and unknown-version preservation. They
independently parse and hash the backup's binary sections.

Both adaptive output shapes also produce identical PNG bytes to plain graphs
with their selected frames and physical type sizes baked in. Equal-width output
variants retain the same page-number font size.

The source and assembled Pages suites run these checks. The Node gate also has
forty project/model/layout/style/migration tests and eleven scheduler tests. The 33-case legacy PNG
parity inventory remains unchanged: it protects the old two image endpoints,
not the new scene API. Scene checks are explicitly separate evidence. V8 adapter
coverage is function coverage; it is not browser compositor branch coverage.

These small fixtures do not establish throughput or advertised bulk capacity.
The [initial mobile story workspace](STORY_WORKSPACE_VERIFICATION.md) is now
implemented. The finished recipe catalog, segmentation/repair tools,
large corpora, physical Safari/Android, typography/a11y review and all pilot and
release gates remain required. No production-readiness percentage is claimed.
