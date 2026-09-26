# Collection benchmark development evidence

`development-before.json` and its log preserve the first complete development
matrix, before the Auto calibration repair. Five eligible settings each ran five
measured 48-image jobs, plus a serial reference and five gate jobs: 31 jobs and
1,488 independently decoded outputs. Complete bytes were compared with the
live serial execution; no output expectations were added to the corpus.

The browser reported 12 logical CPUs and 16 GiB device memory. The normal
budget admitted up to 11 CPUs and 2 GiB estimated memory. Fixed 16 was skipped.
Median job times were 24.86 s (1), 12.64 s (2), 6.69 s (4), 4.17 s (8), and
25.03 s (Auto). Auto never grew above one in this matrix.

These are **development observations**, not the canonical release evidence:
the measurement harness was still being developed, other verification activity
occurred on the host, and this run did not capture an immutable initial target
identity. Its browser used Playwright's default headless executable; subsequent
canonical runs explicitly launch the exact Chromium executable whose digest is
recorded. Do not substitute this run for the final matrix or use it to certify
a device or a speed promise.

`calibration-regression-before.log` preserves two failing regression tests.
They reproduce loss of comparable render samples when header reads or another
image size interleave, and inappropriate calibration from header-only work.
The repaired scheduler retains bounded class-specific windows, excludes header
inspection from render calibration, and ignores samples started under another
concurrency setting. CPU/memory admission, eight-completion/250 ms thresholds,
the 5% improvement criterion, and pressure/cooldown safeguards remain in place.

The canonical method, limitations and maintained commands are described in
[Collection benchmarks](../../../COLLECTION_BENCHMARKS.md). Canonical runs retain
their normative result, raw matrix, generated timing tables, budgets, input and
asset digests under `.migration-results/benchmark-<run-id>/`.

The complete canonical run is also retained in
[benchmark-506853d1-a470-45e8-b41e-6d7abbc77482](benchmark-506853d1-a470-45e8-b41e-6d7abbc77482/collections.md),
including its raw records, normative result, verification logs, hashed receipt
and measured-source archive. It has 10 passing, 7 failing and 4 unproven budgets.
All 100 measured collection jobs pass correctness; timing failures are retained.

After that run, [auto-idle-regression.test.mjs](auto-idle-regression.test.mjs)
reproduces another calibration defect with a controlled clock and unchanged
render service time in the source archived with the initial matrix.
The [original failed log](auto-idle-regression.log) shows four workers dropping
to two after an idle gap in the archived measured source. The idle-gap correction
clears partial measurement windows when work drains, and the unchanged probe
passed on that archived correction. Its hardcoded four-worker starting assertion
predates the subsequent startup policy; use `npm run verify:scheduler` for the
current implementation. Six maintained regressions in `tests/processing.test.mjs` cover this
behavior and success/error/cancellation drains. This repair requires new timing
evidence; it does not change the earlier run or its failed budget ledger.

The [completed corrected matrix](benchmark-e00ad0b2-5afe-4761-9318-91eed9a956db/collections.md)
now supplies that timing evidence. All 100 measured jobs / 3,600 outputs pass;
the budget ledger is 11 pass, 6 fail and 4 unproven. Both warm Auto families meet
the 10% timing target, while cold startup and tiny PNG remain failing. Its
[receipt](benchmark-e00ad0b2-5afe-4761-9318-91eed9a956db/verification.json)
binds raw results, source snapshot, verification logs and package hashes.

The subsequent [bounded startup experiment](bounded-startup/README.md) adds a
two-worker initial probe for substantive batches with sufficient reported
resources. Its preserved patch, source snapshot and verification logs are
separate from both historical matrices. The full new timing run started on
20 September and has now completed: all 100 measured jobs / 3,600 images pass,
with 15 passing, 2 failing and 4 unproven budgets. The complete
[new report](../../2026-09-20/collections/benchmark-1b0bd5c5-2370-4252-bbc3-c4d53ed2e0eb/collections.md)
and [receipt](../../2026-09-20/collections/benchmark-1b0bd5c5-2370-4252-bbc3-c4d53ed2e0eb/verification.json)
retain the verified source, raw records and exact tested site. Cold small Auto
and tiny PNG still fail; physical-device and wider release gates remain open.
