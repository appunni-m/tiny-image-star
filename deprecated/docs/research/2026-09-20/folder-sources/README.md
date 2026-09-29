# Folder source binding — 20 September 2026

This advances the immutable-input and concurrent recovery requirements in
migration §5B. [Behavior and limits](../../../FOLDER_SOURCE_VERIFICATION.md)
explain first-inspection binding, explicit repair and the remaining gap before
untouched sources receive their initial content identity.

The [focused log](focused.log) records 27 real BMP-to-PNG outputs through the
production workers and journal writer. Worker peaks are 1, 4 and 8; every output
matches a live serial Pillow reference and independently decodes at 64 × 64.
Every completed entry has its expected source hash and no admission violation.

Further checks cover stale request paths/handles, same-size/time replacement
between real inspection and full processing, explicit failed-source repair,
identity persistence through page/worker teardown, racing first bindings,
stale owner/claim rejection, save-time validation, journal-protected repair and
read-only sample rejection. Real OPFS files provide bytes; a constant timestamp
shim isolates the digest check in the page and worker. The reload fixture
explicitly commits its initial identity; the separate race fixture proves the
inspection worker's actual durable commit. No physical filesystem claim is made.

| Check | Retained record |
| --- | --- |
| Deterministic suite | [unit.log](unit.log): 181 checks (38 scheduler, 143 model/diagnostic) |
| Full source and package Chromium | [Source](source-browser.log), [package](packaged-browser.log) |
| Independent folder recovery | [recovery.log](recovery.log) |
| Two-engine CSP enforcement | [Source](source-security.json), [package](packaged-security.json) |
| Artifact validation | [package.log](package.log): 223 files |
| Adapter parity | [parity.json](parity.json): 33/33 comparisons |
| Declared adapter coverage | [coverage.json](coverage.json): 27/35, unchanged 70% threshold |
| Specification and fixture audit | [Check](migration-check.log), [audit](fixture-audit.log) |
| Release aggregation | [aggregate.log](aggregate.log): unproven |

The receipt `verification.json` is produced after all required terminal results
and archive/hash checks. [Processing inputs](source-files.json) bind the
[canonical target](target.json). [Source inventory](archive-files.json) and
[source archive](verified-source.tar.gz) retain source, tests, scripts, runtime,
build metadata and CI; [artifact inventory](packaged-files.json) and
[tested package](tested-site.tar.gz) retain the exact optimized files. Final
documentation is retained separately as `.snapshot` files. The focused runner
records the original local workspace path; adjust it when restoring elsewhere.

No deployment, current throughput, physical-device or whole-collection snapshot
qualification is implied. Grouped/multiple-output folder composition, full
application identity, remaining performance/security/device/quality and pilot
gates remain open. Prior sealed records are retained unchanged.
