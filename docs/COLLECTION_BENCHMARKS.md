# Browser collection performance evidence

The maintained entry point is `npm run migration:benchmark`. The canonical
[manifest](../tests/fixtures/manifest.yaml) and indexed
[workloads](../tests/fixtures/inputs/benchmark/collections.json) extend the
existing migration evidence system. They measure the normal folder processing
client, shared resource scheduler, published Pillow renderer and output journal.
They do not replace the older PNG regression benchmark or its failed evidence.

## Workloads and boundaries

- Small: 48 inputs, repeating six independently prepared JPEG/PNG stimuli with
  a 1200 px long edge; fit to 768 × 768, fixed PNG encoder.
- Camera: 24 inputs, repeating three original 12 MP/24 MP JPEG photographs;
  fit to 1920 × 1920, fixed JPEG encoder.
- Both run with cold and warm worker state, at fixed 1/2/4/8/16 and Auto.
  Each eligible configuration has five measured repetitions in seeded,
  randomized order. CPU settings above the browser's actual budget are recorded
  as not run. Memory admission can reduce achieved concurrency below the setting.

Settings are randomized within each workload/cache block; block order is fixed.
Cold/warm comparisons therefore do not isolate cache effects from elapsed time
or changing host conditions. The declared Auto comparisons stay within a block.

The [corpus attribution](../tests/fixtures/corpus/collections-v1/ATTRIBUTION.md)
records authors, licenses, original source links and derivative preparation.
All stimuli are hashed. The originals are downloaded development files; the
deployed Pages artifact excludes the corpus and benchmark scripts. Repeated
files exercise a collection queue; this is only three photographic subjects.

Each measured interval starts before job creation and directory metadata scan
and ends after durable completion counters. It includes claims, engine startup
when needed, admitted source reads, header inspection, transforms, normal output
validation, hashing, journal intent, exclusive file writes and close/commit.
The output destination is Chromium's real OPFS with IndexedDB and Web Locks.
It is not a physical Files-picker or external-disk qualification.

Corpus installation, page/browser creation and additional independent output
checks are outside that interval. Cold means a fresh page and workers with HTTP
caching disabled; OS filesystem cache state is uncontrolled. Warm means one
complete untimed job on the same page before each measurement, retaining worker
heaps and Auto calibration. The warmup is recorded and checked too. No browser
CPU or device-memory hints are overridden.

The browser process is reused within a matrix. Its internal compiled-code caches
are not explicitly flushed. The cold label describes worker lifecycle, not a
cold browser-process launch, empty compiler cache or first network download.

## Correctness and diagnostics

A complete live one-worker execution supplies the concurrency reference. Before
timing, every eligible configuration must complete its own checked gate job.
After each warmup and measured job, the runner reopens every output, independently
decodes it with `createImageBitmap`, checks fit dimensions, verifies durable
counts and output bytes, and compares complete encoded bytes with that live
reference. Missing or duplicate results, extra output files, changed bytes,
reservation violations and worker errors fail the gate. The one-worker reference
is an invariance check of the current implementation, not a migration oracle.
The separate 33-case lane still uses the independently executed frozen adapter.

Opt-in production diagnostics report source-read, source-check/hash, render and
journal-save intervals. Rendering separates pipeline setup, materialization plus
encoding, and output validation. Pillow evaluates lazy transforms during save;
the materialization/encoding interval must not be called pure encoder or decoder
time. Ordinary results have no added diagnostic fields. Worker-startup observations
are bounded to the most recent 64 starts and contain no filenames.

Raw samples include per-image completion latency, the scheduler's changing
admission state, worker starts, terminal Wasm heap sizes, output bytes, failures
and 50 ms event-loop timer delays. Wasm linear memory and reserved estimates are
not total browser RSS, JS/GPU memory, native live allocations or thermal data.
Timer delay is a responsiveness signal, not an INP or touch-interaction result.

## Fixed evidence contracts

Collection stimuli use `tinystar/collection-input@1` and
`tinystar/collection-corpus@1`; raw observations use
`tinystar/collection-samples@1`. Unknown fields, missing subjects, unsafe asset
paths and input digest changes are rejected. No expected image output is stored
in an input. The runner records input and asset identities, exact browser binary,
Playwright, OS/CPU, published JS/WASM and application/measurement code identity.
Source, inputs and assets must remain unchanged through a canonical run.

Each input/cache policy declares separate fixed-setting and Auto workloads.
The runner executes their union once in a shared randomized matrix. Auto's
relative budgets resolve the fixed-setting samples from the same input and
measurement policy; baselines from other workloads or cache policies cannot be
substituted. Auto must be within 1.10 of every eligible fixed-setting median to
be within 10% of the fastest. Missing settings remain explicitly unproven.
Statistics are recomputed from raw samples before accepting compatible evidence.

Canonical results are retained under `.migration-results/benchmark-<run-id>/`.
Budget failure remains a failure; it is not replaced with a selected best run.
Dirty-worktree evidence is useful engineering feedback but the aggregate marks
it unproven for release. `npm run migration:status` regenerates that status.

## Remaining qualification

This work adds the first two required collection families. The heaviest shipped
mask/text/story family, complete retained-memory accounting, sustained physical
phone runs, actual picker/output destinations, interaction tests and broad
camera/color coverage remain open. Desktop and phone performance targets in
the [migration plan](../MIGRATION_PLAN.md) still require measured results and
release signoff. Neither this harness nor a high worker count establishes
production readiness.

## Initial matrix: 17 September 2026

Run `benchmark-506853d1-a470-45e8-b41e-6d7abbc77482` completed on an Apple M3 Pro,
Darwin 24.6.0, Chromium 151.0.7922.34. All 100 measured jobs / 3,600 measured
images passed. Including references, gates and warmups, the runner processed and
independently checked 174 jobs / 6,264 outputs with no public or infrastructure
failure. There were five measured repetitions per eligible setting. Fixed 16
was unavailable under the real 11-CPU budget; estimates never exceeded 2 GiB.

| Collection | One worker median | Best fixed median | Auto median | Auto / best fixed |
| --- | ---: | ---: | ---: | ---: |
| 48 small images, cold workers | 24.21 s | 4.11 s, 8 workers | 12.46 s | 3.034, fails 1.10 |
| 48 small images, warm workers | 24.92 s | 3.98 s, 8 workers | 5.77 s | 1.448, fails 1.10 |
| 24 camera photos, cold workers | 19.69 s | 9.97 s, 4 workers | 15.05 s | 1.509, fails 1.10 |
| 24 camera photos, warm workers | 19.13 s | 9.69 s, 8 workers | 9.75 s | 1.006, within 1.10 |

The small workload's measured speedup was 5.90× cold and 6.26× warm. The camera
workload reached 1.97×; do not round that into a passed 2× claim. Its reservations
approached the memory ceiling, and eight workers offered little additional
benefit. These are observations for the declared corpus, output settings and
headless desktop environment, not a general device-speed promise.

The complete canonical budget ledger has **10 pass, 7 fail, 4 not proven**.
The seven failures include the retained tiny PNG regression, now 2.096× against
its 1.5× limit. The earlier failed run remains retained. Warm camera Auto met
every eligible fixed-setting comparison; other Auto gaps remain open. UI/physical
memory/device gates still prevent release qualification even where timing passes.

Full ranges, per-stage median/p95, memory observations and raw records are in the
[generated report](research/2026-09-17/collections/benchmark-506853d1-a470-45e8-b41e-6d7abbc77482/collections.md).
The [verification receipt](research/2026-09-17/collections/benchmark-506853d1-a470-45e8-b41e-6d7abbc77482/verification.json)
binds the logs, source snapshot, packaged files and results. Raw-statistic
recomputation and identity checks passed; the aggregate reports all lanes
unproven for release solely because the worktree is dirty.

The stage evidence also shows why output validation must remain in the timing
boundary: the serial small-image run spends a median 166 ms per image decoding
the generated PNG for validation. That work was not disabled to improve results.
Reading sources and saving journals were much smaller intervals on this host.

After the matrix, a separate
[idle-gap regression probe](research/2026-09-17/collections/auto-idle-regression.test.mjs)
reproduced a remaining scheduler defect: an unchanged workload retreats from
four workers to two after a simulated ten-second idle gap. Partial calibration
windows in that measured source include the gap. Its [failed output](research/2026-09-17/collections/auto-idle-regression.log)
is preserved. This defect is not repaired in that run's archived source.

## Idle-gap correction

The current scheduler clears unfinished measurement windows when the last active
or queued task finishes, including failure and cancellation. It retains completed
measurements and the learned concurrency limit. Idle time therefore cannot count
as slower image processing. The original probe passed on this archived correction;
six maintained tests
cover the collection-to-collection behavior and successful, failed, cancelled and
unreadable-source queue drains. Existing real throughput-retreat and cooldown
tests still pass. That revision had 21 scheduler tests and 91 model/diagnostic tests.

The shared browser verifier also requires every durable manifest row, in input
order, for reference, gate, warmup and measured jobs. The prior matrix remains
evidence for its archived source; new timing measurements are required for this
correction. No performance budget or admission ceiling has been relaxed.

The [idle-gap verification receipt](research/2026-09-17/collections/idle-gap-fix/verification.json)
binds the before/after regression logs, exact change, 167-file source snapshot,
179-file package and completed source/packaged browser and folder-recovery checks.
The corrected source passes 33/33 adapter comparisons in
`parity-6fd5ed96-8c97-4496-91ad-c7343012618e`.

## Corrected matrix: 17 September 2026

Canonical run `benchmark-e00ad0b2-5afe-4761-9318-91eed9a956db` completed at
07:55:31 UTC after 36 minutes 40 seconds. It used the same corpus, manifest,
output settings, real 11-CPU/2 GiB admission budget and declared methodology.
All 100 measured jobs / 3,600 images passed. Including references, gates and
warmups, 174 jobs / 6,264 outputs passed with no public or infrastructure failure.
Final source/input identity checks and raw-statistic recomputation passed.

| Collection | One worker median | Best fixed median | Auto median | Auto / best fixed |
| --- | ---: | ---: | ---: | ---: |
| 48 small images, cold workers | 24.00 s | 4.08 s, 8 workers | 12.13 s | 2.975, fails 1.10 |
| 48 small images, warm workers | 23.92 s | 3.91 s, 8 workers | 3.56 s | 0.911, within 1.10 |
| 24 camera photos, cold workers | 19.66 s | 9.95 s, 8 workers | 15.05 s | 1.512, fails 1.10 |
| 24 camera photos, warm workers | 19.11 s | 9.69 s, 8 workers | 9.82 s | 1.013, within 1.10 |

Both warm Auto blocks meet every eligible fixed-setting comparison. Warm small
Auto ranges from 3,541.9 to 3,580.5 ms and grows from eight to eleven admitted CPU
slots. This is a within-run timing result, not physical phone qualification.
Between-run timings are observations, not a controlled simultaneous A/B trial.

The complete budget ledger is **11 pass, 6 fail, 4 not proven**. Five failures
are cold Auto comparisons; the sixth is the tiny PNG regression at 1.680× its
legacy baseline against a 1.5× limit. Fixed 16 again exceeds this host's CPU
budget. The previous failed run remains intact. The aggregate marks all three
lanes unproven for release solely because the target worktree is dirty; the
timing failures and broader product/device gates also remain open.

The [complete generated report](research/2026-09-17/collections/benchmark-e00ad0b2-5afe-4761-9318-91eed9a956db/collections.md)
and [hashed receipt](research/2026-09-17/collections/benchmark-e00ad0b2-5afe-4761-9318-91eed9a956db/verification.json)
retain raw observations, 167 source/runtime/test files and all 179 packaged-file
hashes. The source snapshot matches the verified idle-gap correction.
The [startup calibration finding](research/2026-09-17/collections/idle-gap-fix/calibration-findings.md)
shows why the cold gap needs a different change from the idle-gap repair.

## Bounded startup matrix: 20 September 2026

The [bounded startup policy](research/2026-09-17/collections/bounded-startup/README.md)
can begin a larger batch with two workers when the reported CPU/memory budgets
allow. It preserves the conservative missing-memory-hint path and all later
calibration/admission thresholds. There are 28 scheduler tests and 91
model/diagnostic tests; source and packaged Chromium, recovery, adapter parity,
coverage and artifact checks passed before measurement.

Canonical run `benchmark-1b0bd5c5-2370-4252-bbc3-c4d53ed2e0eb` completed at
06:17:47 UTC after 35 minutes 56 seconds. All 100 measured jobs / 3,600 images
passed. Including references, gates and warmups, all 174 jobs / 6,264 outputs
passed, with no public or infrastructure failure. Final source/input identity
checks and raw-statistic recomputation passed. The corpus, output settings,
11-CPU/2 GiB admission budget, eight-sample calibration gate and timing targets
were unchanged.

| Collection | One worker median | Best fixed median | Auto median | Auto / best fixed |
| --- | ---: | ---: | ---: | ---: |
| 48 small images, cold workers | 24.58 s | 4.21 s, 8 workers | 7.18 s | 1.706, fails 1.10 |
| 48 small images, warm workers | 24.12 s | 3.94 s, 8 workers | 3.46 s | 0.880, within 1.10 |
| 24 camera photos, cold workers | 20.66 s | 10.54 s, 8 workers | 11.41 s | 1.083, within 1.10 |
| 24 camera photos, warm workers | 19.75 s | 9.83 s, 8 workers | 10.10 s | 1.027, within 1.10 |

Both camera blocks and warm small images now meet every eligible fixed-setting
median comparison. Cold small Auto improved from the preceding run's 12.13 s
to 7.18 s, but still misses the best fixed setting by a substantial margin.
Between-run observations are not a simultaneous controlled A/B trial. The
remaining intermediate startup windows are visible in the linked traces; the
timing target has not been relaxed to accept them.

The complete budget ledger is **15 pass, 2 fail, 4 not proven**. Failures are
cold small Auto versus eight workers (1.7065 against 1.10) and the tiny PNG
regression (1.8498 against 1.50). Fixed 16 exceeds this host's reported budget
in all four blocks. The aggregate remains unproven solely because the target
is dirty; passing timing rows also need the plan's device, UI and physical
memory qualification before release claims.

The [complete generated report](research/2026-09-20/collections/benchmark-1b0bd5c5-2370-4252-bbc3-c4d53ed2e0eb/collections.md)
contains ranges and stage observations. Its
[receipt](research/2026-09-20/collections/benchmark-1b0bd5c5-2370-4252-bbc3-c4d53ed2e0eb/verification.json)
binds the result, raw records, verified 167-file source snapshot, build-only
staging helper and all 179 packaged-file hashes. The exact tested site is
retained as a tar archive, including its subsequently repaired documentation
link. Runtime bytes were unchanged by that later notice repair. Light file/doc
inspection and a public registry metadata GET occurred during measurement;
no build or image regression suite overlapped it. Earlier matrices and failures
remain intact.

## Auto startup calibration matrix: 20 September 2026

The [Auto startup correction](research/2026-09-20/auto-calibration/README.md)
lets a bounded initial cohort follow useful arrivals until its first result.
It retains eight-completion throughput windows and all resource/output checks.
A subsequent downward trial can challenge an unmeasured initial guess. Ten
additional policy tests bring the deterministic total to 162: 38 scheduler and
124 model/diagnostic checks. Complete source and 206-file packaged Chromium
suites, folder recovery, 33/33 parity and the declared coverage slice passed
before timing.

Canonical run `benchmark-6a30d31a-8f7b-40c1-8cd8-0c3d63aed3d7` finished with 100 measured jobs / 3,600 images and,
including references, gates and warmups, 174 jobs / 6,264 checked outputs. All
passed; there were no infrastructure errors. The final source/input and raw
statistic validations passed. Earlier runs and failures remain intact.

| Collection | One worker median | Best fixed median | Auto median | Auto / best fixed |
| --- | ---: | ---: | ---: | ---: |
| 48 small images, cold workers | 24.42 s | 4.23 s, 8 workers | 4.34 s | 1.024, within 1.10 |
| 48 small images, warm workers | 24.57 s | 4.09 s, 8 workers | 3.51 s | 0.857, within 1.10 |
| 24 camera photos, cold workers | 20.14 s | 10.12 s, 4 workers | 10.55 s | 1.043, within 1.10 |
| 24 camera photos, warm workers | 19.53 s | 9.58 s, 8 workers | 9.91 s | 1.034, within 1.10 |

All four Auto blocks meet the 1.10 timing comparison against every eligible fixed setting. The full ledger is **16 pass, 1 fail, 4 not proven**. Fixed 16 remains ineligible in all four
blocks. The measured remaining failures are:

- `TinyImageStar.Engine.renderWithApi.performance`: 1.7246 versus the 1.50 limit.

The [full generated report](research/2026-09-20/auto-calibration/benchmark-6a30d31a-8f7b-40c1-8cd8-0c3d63aed3d7/collections.md)
contains ranges, stage timings and resource observations. Its
[verification receipt](research/2026-09-20/auto-calibration/verification.json)
binds 117 target inputs, 226 archived source/runtime/test/build files and 206
assembled site files. Source and package hashes were checked again after the
run. Only light file/document work overlapped the timing interval. This is one
headless desktop host with unknown power/thermal state, not physical-phone
qualification. Complete memory accounting, UI/thermal limits and the heaviest
scene family remain open; the target is dirty and nothing was deployed.
