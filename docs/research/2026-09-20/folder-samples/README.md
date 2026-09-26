# Folder recipe sample and failure review — 20 September 2026

This advances migration §5B with full-recipe preview sampling, planned output
counts, measured estimates and indexed failure review. The
[behavior and limits](../../../FOLDER_SAMPLE_VERIFICATION.md) distinguish
metadata sampling from exhaustive aspect/subject analysis and real collection
processing from the large-manifest test.

## Focused behavior

The [focused browser log](focused.log) records 27 custom-font/crop/color/JPEG
previews at fixed worker peaks 1, 4 and 8. Every returned PNG thumbnail matches
a live serial reference, and its reported full-output dimensions, format and
byte length also match. Deliberately invalid, unbound library FontFace metadata
is ignored, matching the eventual byte-only job snapshot. Admission violations
are zero. The five selected
samples in the ten-entry fixture include a deliberately corrupt source.

The 375 × 667 Chromium workflow injects one additional admission failure, retries only
failed previews while retaining successful thumbnail URLs, and independently
decodes the resulting images. Previewing leaves job counters, attempt counts,
the output handle and the pending font contract unchanged. The
[normal phone view](folder-sample-phone.png) and
[200% text view](folder-sample-phone-200.png) were visually inspected.

Actual folder processing into browser-managed OPFS (with a substituted picker)
saves nine files and exposes the corrupt source in
the failure-only view. Keyboard activation opens full error details. Repair and
failed-only retry reach ten completed entries without repeating the successful
outputs. After clearing the font library and reloading, previews still use the
job-owned font snapshots. Closing during deliberately delayed preparation
leaves no sample sheet, queued/active task or extra retained-byte reservation.

A separate real IndexedDB fixture contains 100,000 metadata entries, including
50,000 failures. Reading the last ten failures uses the status index while
entry-store `getAll` is disabled. This is metadata review evidence; only the
small synthetic collection above is actually processed into output files.

## Verification records

| Check | Retained evidence |
| --- | --- |
| Deterministic suite | [unit.log](unit.log): 178 checks (38 scheduler, 140 model/diagnostic) |
| Full source browser | [source-browser.log](source-browser.log) |
| Full optimized package browser | [packaged-browser.log](packaged-browser.log) |
| Separate folder recovery | [recovery.log](recovery.log) |
| CSP profiles, two engines × two policies | [Source](source-security.json), [packaged](packaged-security.json) |
| Package validation | [package.log](package.log): 221 files |
| Adapter parity | [parity.json](parity.json): 33/33 comparisons |
| Declared adapter coverage | [coverage.json](coverage.json): 27/35, unchanged 70% threshold |
| Specification/fixture audit | [Check](migration-check.log), [audit](fixture-audit.log) |
| Release aggregation | [aggregate.log](aggregate.log): unproven |

`verification.json` is written only after terminal checks and archive/hash
verification. [Source inventory](archive-files.json) and
[source archive](verified-source.tar.gz) capture app, tests, scripts, runtime,
package metadata and CI. [Processing inputs](source-files.json) bind the
[canonical target](target.json). [Packaged inventory](packaged-files.json) binds
the [tested artifact](tested-site.tar.gz). Documentation snapshots retain the
final historical text as `.snapshot` files. The source and package suites each
repeat the focused workflow; the focused runner records the original local
workspace path and needs adjustment when restored elsewhere.

No deployment or current-throughput qualification was performed. Timing
estimates are user guidance, not benchmark results. Physical phones/native
filesystem crashes, full retained memory, exhaustive aspect/subject review,
immutable source/application identity, scene-style/grouped-folder/multiple-
variant queues, production headers and the other migration gates remain open.
