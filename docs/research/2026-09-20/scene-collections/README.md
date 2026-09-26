# Durable grouped-story exports — 20 September 2026

[Behavior and boundaries](../../../SCENE_COLLECTION_VERIFICATION.md) describe the
saved-story selection workflow, immutable job-owned assets, independent output
journals, pause/retry/reload and supported-browser limits.

The [focused browser record](focused.log) checks two six-photo groups with
different looks, custom fonts, local crop/color corrections and both export
ratios. All 48 PNG outputs at observed worker peaks 1/4/8 match serial references
and independently decode. Snapshot quota rollback, explicit retry, completed-file
preservation, reload after library deletion, cleanup, actual mobile-sized UI
creation/review, 200% text, missing-subject review notes and browser Back from
review are covered. The asynchronous number of outputs completed before pause
may vary; the assertion requires at least one completed and one pending output.
OPFS and a substituted picker do not qualify native filesystem or physical-phone
behavior.

Separate [source](source-jpeg.log) and [package](packaged-jpeg.log) probes each
verify eight default-JPEG outputs. They check signatures, names, native dimensions
and exact bytes against direct serial rendering. Those probes use synthetic
photos without a custom font; the main PNG workflow covers copied custom fonts.
[Normal text](scene-batch-phone.png) and [200% text](scene-batch-phone-200.png)
screenshots show the scrollable review sheet. Both were visually inspected;
physical accessibility and native picker/share behavior remain unqualified.

| Check | Retained record |
| --- | --- |
| Deterministic suite | [unit.log](unit.log): 185 checks (38 scheduler, 147 model/diagnostic) |
| Full source and package Chromium | [Source](source-browser.log), [package](packaged-browser.log) |
| Independent folder recovery | [recovery.log](recovery.log) |
| Two-engine CSP enforcement | [Source](source-security.json), [package](packaged-security.json) |
| Artifact validation | [package.log](package.log): 231 files |
| Adapter parity | [parity.json](parity.json): 33/33 comparisons |
| Declared adapter coverage | [coverage.json](coverage.json): 27/35, unchanged 70% threshold |
| Specification and fixture audit | [Check](migration-check.log), [audit](fixture-audit.log) |
| Release aggregation | [aggregate.log](aggregate.log): unproven |

The receipt `verification.json` is produced only after terminal results and
archive/hash checks. [Processing inputs](source-files.json) bind 129 inputs to the
[canonical target](target.json). [Source inventory](archive-files.json) and
[source archive](verified-source.tar.gz) retain 253 implementation, test, script,
runtime and build/CI files. [Artifact inventory](packaged-files.json) and
[tested package](tested-site.tar.gz) retain 231 exact optimized files. Final
documentation is retained separately as `.snapshot` files. Earlier sealed
milestone records remain unchanged.

The retained [focused runner](focused.mjs) uses the original workspace path.
The supplemental [JPEG runner](jpeg-focused.mjs) originally imports
`/tmp/tinystar-scene-jpeg-browser.mjs`; the exact module is retained as
[jpeg-browser.mjs](jpeg-browser.mjs). Adjust those local paths when restoring.
`TINY_IMAGE_STAR_BROWSER_ROOT` selects the source or extracted package to serve.

Automatic folder/fixed-size photo grouping, incomplete-group choices, phone
staging/share fallback, advertised-scale and current-throughput qualification,
full retained memory and the other migration/release gates remain unfinished.
The saved-story library's existing 128 MiB budget still applies. Structural
1,000-group/100,000-output bounds are not tested production capacity. No
deployment or complete-production-readiness claim is made.
