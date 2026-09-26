# Multiple-shape story exports — 20 September 2026

This advances migration §5B: one story can prepare an ordered set in Portrait,
Tall, or both shapes, with the complete count shown before work starts. The
[behavior and boundaries](../../../STORY_EXPORT_VERIFICATION.md) describe saved
output styles, frozen rendering inputs, independent failures, pause/continue,
retry-only-failed, sharing and cancellation. [The change](change.patch) is relative
to the separately sealed folder-contract milestone.

## Focused evidence

The [real browser run](focused.log) compares eight 432×540/432×768 outputs at
each of 1/4/8 workers with live serial PNG references. Observed worker peaks
match the settings and admission violations are zero. The phone workflow
independently decodes eight 1080×1350/1080×1920 outputs and checks their hashes.
One injected admission failure preserves the other seven files and their URLs;
retry prepares only the missing output. Pause keeps one ready file and continues
the other seven. Browser Back during blocked preparation cancels work without
recreating links.

The actual Save my style → Output flow retains both export shapes and restores
them after applying the style and reloading the project. Source nodes, captions,
crops and corrections stay unchanged. Model tests also preserve older
single-shape style semantics and reject malformed capability declarations.
An outstanding Share promise retains a separate encoded-byte reservation after
the export sheet closes, and releases it when sharing settles.

The [normal phone view](exports-phone.png) and [200% text view](exports-phone-200.png)
were visually inspected. Native image decoding, the browser download event and
an activated Share call were exercised. Viewport emulation and a mocked native
share destination do not qualify physical phones or real destination apps.

## Verification

| Check | Result |
| --- | --- |
| [Deterministic suite](unit.log) | 175 pass: 38 scheduler, 137 model/diagnostic |
| [Full source browser suite](source-browser.log) | Pass |
| [Optimized package browser suite](packaged-browser.log) | Pass |
| [Folder recovery](recovery.log) | Pass |
| [Package validation](package.log) | 214 files |
| [Adapter parity](parity.json) | 33/33 comparisons pass |
| [Declared adapter coverage](coverage.json) | 27/35 functions; unchanged 70% threshold passes |
| [Specification checks](migration-check.log) and [fixture audit](fixture-audit.log) | Pass |
| [Release aggregation](aggregate.log) | Unproven: dirty source and no compatible current benchmark |

`verification.json` is the final hash receipt, written after all final checks.
The [target](target.json) binds 121 processing inputs in
[source-files.json](source-files.json). The [source archive](verified-source.tar.gz)
contains 234 source/test/build files listed in [archive-files.json](archive-files.json).
The [tested site](tested-site.tar.gz) contains 214 files listed in
[packaged-files.json](packaged-files.json). Sealing re-reads the inventories,
both archive contents and the final logs. Documentation snapshots retain their
original paths and are historical text, not another navigable documentation tree.

Reproduce with the archived source, locked dependencies and Chromium:
`npm run verify`, `npm run verify:browser`, `npm run verify:folder-recovery`,
`make package-pages`, then the browser suite with `TINY_IMAGE_STAR_BROWSER_ROOT`
set to the absolute `_site` path. The [focused runner](focused-runner.mjs) records
the original workspace path; adjust it when restoring elsewhere. Canonical
parity and coverage commands remain in `package.json`.

Earlier timing results belong to older source revisions. These tests make no
new throughput claim. Output choices persist; prepared files and queue progress
last only while the export sheet stays open. Durable grouped-collection jobs,
full independent-image/folder composition, complete memory accounting, physical
capacity, comparative user validation and production gates remain open. Nothing
was deployed.
