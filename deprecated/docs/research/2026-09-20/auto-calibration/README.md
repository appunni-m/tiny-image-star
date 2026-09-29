# Auto startup calibration — 20 September 2026

This advances migration §8A without changing the image pipeline, output checks,
resource budgets, fixed-worker eligibility, benchmark inputs or timing targets.
The previous turn's source-resolution milestone remains separately sealed.

## Diagnosis and rejected experiments

The preceding canonical small/cold result took 7,180.9 ms in Auto versus
4,208.0 ms with eight fixed workers. It reached four workers after roughly
3.25 seconds and eight after 5.1 seconds. Header inspection and durable claims
deliver substantive tasks asynchronously. Auto consumed its entire initial
startup opportunity as soon as four tasks arrived, even while more work was
arriving before the first render completed. Eight comparable completions then
had to accumulate at each concurrency step; mixed source sizes amplified that
delay.

Three **development** repetitions per setting used the same 48-image input,
real OPFS outputs, IndexedDB journal, Web Locks, full normal output validation,
independent browser decoding and exact live-serial output comparisons. These
are isolated diagnostic experiments, not the five-sample canonical benchmark.
All outputs passed; no corpus names or input IDs affect scheduler behavior.

| Experiment | Auto median | Fixed-eight median | Finding |
| --- | ---: | ---: | --- |
| Existing eight-sample windows | 6,961.7 ms | 4,089.9 ms | Reproduces the cold-start gap. |
| Four-sample windows | 5,580.0 ms | 4,089.9 ms | Faster, still outside the target; not adopted. |
| Two-sample windows | 4,651.6 ms | 4,089.9 ms | One run falsely retreats and takes 6,543.3 ms; rejected as noisy. |
| Larger one-shot initial limit | 6,945.1 ms | 4,070.7 ms | No improvement: the first four arrivals still consume the opportunity at two workers. |
| Initial cohort follows arrivals | 4,236.2 ms | 4,079.9 ms | Reaches five initial workers around 130 ms, then ten after 1.65 seconds; supports further qualification. |

The [window experiment](window-probe.json), [one-shot experiment](bootstrap-probe.json)
and [arrival experiment](arrival-probe.json) retain every job, output verification,
resource trace and bounded calibration trace. Their scripts and terminal logs
are adjacent. They served virtual scheduler variants over the otherwise unchanged
source tree; [baseline-scheduler.js](baseline-scheduler.js) is byte-identical to
the scheduler in the prior source-resolution archive. The recorded scripts name
the original absolute workspace path; restore that archived baseline and its
dependencies when reproducing those original commands. Timing is host-specific.

## Adopted policy

On a backlogged job with at least three reported CPU tokens and a 1 GiB memory
budget, an initial provisional cohort can expand as real tasks arrive, until
the first useful result. It is bounded by two waves of substantive demand,
half the reported CPU budget (with a two-worker minimum) and eight workers.
The normal CPU, memory, retained-source, pending-read, terminal-output and
origin-wide admission checks still govern every actual worker. Metadata reads
do not count as demand. Missing/small hints and two-image edits retain the
conservative start. The eight-worker bound applies only to this initial cohort;
later measured concurrency can exceed it.

Later decisions still require eight comparable completions, at least 250 ms,
and 5% completion-rate improvement to keep a larger pool. When expansion fails
and the initial guess has no measured smaller baseline, Auto also tries fewer
workers. It compares the same work family and keeps the smaller count when the
larger count provides no qualifying gain. A slower lower-count trial restores
the measured good count. Cancellation or idle before a trial finishes cannot
retain an unproved choice. Pressure discards the old trial; cooldown continues
to prevent immediate oscillation. See [the patch](change.patch).

## Verification scope

Ten added scheduler tests cover incremental arrivals, first-result closure,
cancelled startup, pressure, retained memory and write credits, modeled one- and
two-worker saturation, incomplete-trial recovery, growth beyond the initial cap,
and cross-family trial isolation. The full scheduler suite has 38 tests; the
model/diagnostic suite has 124, for 162 total. The original eight-sample test now
uses a budget whose provisional size remains two and verifies restoration when
one worker is slower. No sample-count gate was weakened.

The first regression run against the old scheduler fails the new arrival and
wasteful-initial-count assertions. A later cross-family fixture initially let
aged original tasks run ahead of its injected family; its priority was corrected
so it actually isolates unrelated completions. Both failures and the final
passing runs are retained. A passing policy simulation does not establish
physical-device throughput or thermal behavior.

The complete source and packaged Chromium suites, folder recovery, 33/33 adapter
parity and the declared 27/35 adapter coverage slice passed. The frozen inventories
contain 117 target inputs, 226 archived source/test/build files and 206 assembled
site files. These correctness checks ran before the canonical timing matrix;
the build and image test suites do not overlap its timed measurements.

## Completed canonical matrix

Run `benchmark-6a30d31a-8f7b-40c1-8cd8-0c3d63aed3d7` completed with all 100 measured jobs / 3,600 images passing.
Including references, gates and warmups, all 174 jobs / 6,264 outputs passed.
Normal validation and journaled saves remain inside timing; additional native
decoder and exact serial-output comparisons remain outside. Final source/input
identity checks and recomputation from the raw samples passed. The complete
budget ledger is **16 pass, 1 fail, 4 not proven**.

| Collection | One worker median | Best fixed median | Auto median | Auto / best fixed |
| --- | ---: | ---: | ---: | ---: |
| 48 small images, cold workers | 24.42 s | 4.23 s, 8 workers | 4.34 s | 1.024, within 1.10 |
| 48 small images, warm workers | 24.57 s | 4.09 s, 8 workers | 3.51 s | 0.857, within 1.10 |
| 24 camera photos, cold workers | 20.14 s | 10.12 s, 4 workers | 10.55 s | 1.043, within 1.10 |
| 24 camera photos, warm workers | 19.53 s | 9.58 s, 8 workers | 9.91 s | 1.034, within 1.10 |

All four Auto blocks meet the 1.10 timing comparison against every eligible fixed setting. Fixed 16 is ineligible on this host's reported 11-token CPU budget.
The declared remaining measured failures are:

- `TinyImageStar.Engine.renderWithApi.performance`: 1.7246 versus the 1.50 limit.

The [complete report](benchmark-6a30d31a-8f7b-40c1-8cd8-0c3d63aed3d7/collections.md) retains ranges and stage observations;
the [verification receipt](verification.json) binds raw results, logs, source
inventories and the exact tested source/site archives. The eight-sample gate,
output settings, input corpus, resource budgets and timing targets are unchanged.
During measurement only light file/document inspection and documentation edits
ran alongside the benchmark; no build, image suite or other performance probe
overlapped it. The source and package inventories were rechecked after completion.

The improvement from the preceding cold-small run's 7.18 s Auto median to this
run's 4.34 s is a between-run observation on this desktop, not a simultaneous
controlled A/B estimate or a phone speed claim. Reservations and Wasm heaps are
not process RSS. Heavy scene workloads, sustained physical-device/UI/memory
qualification and the broader migration gates remain open. Nothing was deployed.
