# Durable exports of grouped stories

The story library now has **Export saved stories**. Select saved stories as
existing photo groups, choose Portrait, Tall or both, and PNG or JPEG. Choose a
save folder, let the app copy the selected revisions, review the complete output
count, then start saving. Each story keeps its own layout, colors, crops, words,
cutouts, connections and font assets.

This implements the saved-story selection path of migration §5B. It does not yet
automatically split a newly chosen image folder by directory or fixed group size.
The existing story editor creates and corrects each 6–12-photo group first.
The batch does not reinterpret the collection as a single oversized carousel.

## Persistence and output contract

The version-3 folder database adds separate group and asset stores while retaining
older job records, entries and font snapshots. Job format remains version 2.
Ordinary per-image folder jobs and story batches have separate library views.
The existing older-renderer fence remains in place for version-1 jobs.

A preparing batch records the selected story keys and exact revisions, shapes,
format and dedicated destination. One admitted worker copies one story at a time.
Each copy validates the saved revision, complete asset set, byte lengths and
SHA-256. The complete group and its immutable asset Blobs commit in one strict
transaction. A failed transaction publishes neither. Duplicate asset hashes
share one job-owned Blob; clearing the original story library cannot remove it.
Partially copied groups remain available for Continue copying stories.

Only after all groups are copied does one transaction publish the complete output
manifest and frozen recipe. Each output identifies one group, slide and shape.
Its source digest binds the complete group snapshot, including the scene, asset
identities and export plan. Numeric group folders make output names unique even
when story titles match. The plan records every output before saving begins.

Rendering uses the real scene compositor and pinned Pillow encoder. Workers
retrieve current claims, snapshots and the saved destination. Changed scene
metadata, missing/changed assets, stale owners and superseded attempts fail.
The existing write journal records each output's source and renderer digests,
encoded digest, dimensions and destination before writing. Interrupted output
reconciliation and exactly-once counters use the same folder writer as utility
jobs. Batch snapshots cannot adopt repaired source bytes through Retry failed;
editing a source story requires a new batch.

Pause and close cancel admitted/queued work and retain completed files. A reload
can resume pending outputs without the original saved-story library. Retry failed
runs only failed outputs. Review uses 20-row pages and the existing status index
for failure filtering. Full error text and saved renderer warnings appear on
rows; a missing subject effect is not silently presented as a complete cutout.
Forget batch removes its metadata and private asset copies, leaving exported
files alone. Local-data controls explain that these copies are managed separately.

## Admission and capacity boundaries

Snapshot work reserves the bounded group sources plus metadata copies before
expanding assets. Per-output metadata validation also runs in admitted workers;
the coordinator does not eagerly load every group document. The full render
estimate includes scene surfaces, sources/fonts, output-journal reconciliation
and additional bounded scene metadata. Up to 32 consumers hold one claimed
output each, while the shared scheduler controls actual CPU and memory admission.
No complete collection of full-resolution outputs is retained in RAM.

The model bounds a selection to 1,000 groups and an output manifest to 100,000
entries. The per-story export plan still limits a group to 80 outputs; normal
6–12-photo stories have 4–8 slides. These are structural limits, not production
throughput or physical-device qualifications. The saved-story library's existing
128 MiB asset budget still applies; this feature does not raise that budget.
Snapshot estimates and scheduler reservations are not native process-RSS
measurements or evidence that maximum-effect stories fit baseline phones.

Directory read/write permission is requested again when needed to resume. This
path requires a browser with directory saving and Web Locks. Unsupported browsers
retain per-story download/share through Export and receive an explicit message.
Durable phone staging and grouped share/download fallback remain open work; the
phone-sized browser test below does not establish native directory-picker support.

## Verification

Four model tests cover exact bounded selection contracts, frozen revision/asset
validation, output naming/counts, and snapshot tamper rejection. They bring the
deterministic suite to 185 checks (38 scheduler, 147 model/diagnostic).

The focused Chromium workflow uses two differently styled six-photo stories,
crop/color corrections and a copied Noto Sans font. Sixteen outputs per batch
span both shapes. Across worker peaks 1, 4 and 8, all 48 PNG outputs match direct
serial Pillow renders and pass native decoding; no admission violations occur.
It also exercises atomic rollback after asset insertion but before group commit,
successful copy retry, actual batch creation through the 375 × 667 UI, output
failure and failed-only retry, pause/reload after deleting the original library,
unchanged successful output hashes/modification times, immutable recipes and
owner fencing, snapshot cleanup with exported-file preservation, visible missing-
subject warnings, frozen format display, 200% text review and browser Back from
the review sheet. The screenshots show the scrollable phone layout at normal
and enlarged text sizes; they are not physical-device accessibility evidence.

A separate source/package probe omits the format option to exercise default
JPEG output. Each run saves eight slide/shape outputs through the real workers
and journal. All eight have JPEG signatures, `.jpg` names, expected native-decoded
dimensions and exact bytes matching direct serial Pillow rendering. This probe
uses synthetic photos and no custom font; the main PNG workflow covers copied
custom fonts.

The final source and 231-file packaged Chromium suites, separate folder recovery
and eight source/package Chromium/WebKit CSP profiles pass. Canonical adapter
parity is 33/33 in run `parity-afc9d969-d539-4ba4-a899-d6b26776d2eb`; coverage run
`coverage-312ac370-e762-4af7-93d0-44abc2f8fcdc` reports 27/35 functions against the
unchanged 70% threshold. These adapter checks cover their declared slice; the
scene workflow has the separate browser evidence above. The retained record
binds 129 processing inputs and 253 source/test/build files. Release aggregation
continues to report zero compatible lanes and three unproven lanes.

These are synthetic scenes, Chromium viewports, OPFS and a substituted directory
picker. They do not establish representative scene/crop/mask quality, physical
phone accessibility or permissions, filesystem crashes, advertised-scale real
corpora, sustained throughput or all retained/native memory. Automatic grouping
by folder/fixed size, incomplete-group choices, broad bulk scene presets, phone
staging/sharing and the remaining migration/release gates are still open.

[Dated source, package and verification evidence](research/2026-09-20/scene-collections/README.md)
records the final checked revision and explicit boundaries.
