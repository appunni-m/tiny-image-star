# Shared text composition verification

Date: **17 September 2026**. This is implementation and automated browser
evidence for the text portion of the [migration plan](../MIGRATION_PLAN.md),
not a completed story compositor or production qualification.

## Implemented path

Editor, interactive image sets and large-folder workers now use one pipeline:
Pillow image transforms → browser text shaping into a transparent RGBA surface
→ Pillow alpha composition → Pillow PNG/JPEG encoding → output validation.
There is no browser photo re-encode or main-thread final text composition.
The editor's provisional overlay and hit-testing import the same geometry,
wrapping and styling functions used to rasterize the exported text.

The worker uses [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/getContext)
and the [worker FontFaceSet](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/fonts).
If those required facilities are unavailable, an explicit error prevents an
uncaptioned result from being published. Browser compatibility documentation
does not replace testing on the physical release devices.

Custom fonts use local binary files. New references include the full SHA-256
and byte length; existing content-derived font IDs are also verified. Workers
load only referenced fonts, validate their bytes and remove their FontFace
objects after rendering. Corrupt, missing or oversized fonts fail the task.
Imported fonts must save successfully before the UI reports success. The
active editor retains its in-memory font snapshot after saved-data cleanup;
late copies are transferred only when a processing slot is admitted. Folder
jobs resolve their frozen references from local storage and report a missing
font if it has been removed.

Limits are 100 text layers, 5,000 characters per layer, eight custom fonts per
edit, 16 MiB per font and 32 MiB total referenced font bytes. Old recipes with
unknown font sizes reserve the total limit and are checked when loaded.
These limits bound work; they do not establish acceptable latency for every
allowed input. System fonts remain device-dependent.

Text admission adds the canvas/readback surfaces and Pillow composition
buffers to the shared memory estimate. Font decoding uses a conservative
six-times-byte-size estimate; loaded editor fonts are included in retained
memory. Worker font objects are not kept in a growing cache. Full browser RSS,
font restoration peak memory, DOM previews, future masks and models still
need qualification. More concurrency is admitted only within the shared CPU
and estimated-memory limits.

## Renderer migration

New projects identify `canvas-rgba-pillow-v1` alongside the exact published
runtime hashes. The known previous renderer is upgraded in memory while IDs,
operations, crops, text and source references are preserved. The revision is
advanced once. On the first save, the exact prior recovery record is archived
in the same transaction before its slot is replaced; its assets remain live.
Backup downloads include that archive. Explicit cleanup of the recovery slot
also clears its renderer archives. Unknown renderer versions remain blocked
and preserved.

This is an intentional change to text output: PNG compression and JPEG
encoding now use Pillow consistently. Text pixels can differ from the old
browser composite, especially along translucent edges. There is no claim of
byte parity with the previous text pipeline. The original image-only
regression surface still passes all 33 exact comparisons.

## Executed checks

[The browser test](../tests/text-compositor.browser.mjs) uses the unchanged
published WASM, real FontFace decoding, worker transfers, IndexedDB, OPFS and
the actual large-folder output journal. It runs in an isolated browser context
and makes no external requests.

- Twelve text images at each of 1, 4 and 8 workers produce the same PNG/JPEG
  bytes as the direct engine path, with no admission violations.
- Real journaled folder files match those bytes and count each completion once.
- An independent browser decoder verifies dimensions, transparent PNG,
  opaque JPEG and colored text after a grayscale image treatment.
- JPEG bytes exactly match Pillow encoding of the final composed PNG pixels
  flattened onto white, detecting an accidental second or browser encode.
- A pinned 2,049,096-byte Noto Sans file exercises successful font decoding,
  mixed-script text, rotation, opacity, wrapping, shadow and synthetic italic.
  Missing fonts, changed bytes and an understated memory reference fail.
- Clearing saved fonts keeps the active image's exported pixels unchanged.
  Direct composition leaves no additional registered document FontFace objects.
- Project storage tests verify raw renderer-record preservation on read,
  archival on save, revision advancement and explicit archive cleanup.

The Noto fixture is test-only and is not shipped in the Pages artifact. Its
[provenance](../tests/fixtures/fonts/provenance.json) pins Google Fonts commit
`8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`, the exact bytes and SHA-256.
The original [OFL license](../tests/fixtures/fonts/OFL.txt) accompanies it.

Commands: `npm run verify`, `npm run verify:browser`,
`npm run verify:folder-recovery`, and `npm run migration:parity`.
The browser checks are also run against the assembled Pages artifact.

## Still required

The multi-photo scene renderer now has [separate evidence](SCENE_COMPOSITOR_VERIFICATION.md)
for image/shape/mask nodes, connected slides, caption layout and preview/export
parity. Story assembly, the three authored presets, bundled licensed production
fonts, missing-glyph detection, language/script typography review and
representative performance benchmarks remain required. Mixed-script
byte equality is not proof of correct Arabic/Indic/emoji typography. Legacy
grayscale still converts to opaque L-mode; that alpha behavior is preserved by
the existing regression contract and needs a separately versioned color change.
Physical Safari/Android, 100/1,000/10,000-image jobs and sustained memory/thermal
tests remain open. No throughput improvement or production-readiness percentage
is inferred from these small automated workloads.
