# Bounded Auto startup experiment

Recorded 17 September 2026. The preceding [startup finding](../idle-gap-fix/calibration-findings.md)
shows that serial calibration consumes more than the small collection's entire
target time. This change removes one serial calibration stage on devices with
adequate reported resources. It does not claim to solve the full cold-start gap.

## Policy

The scheduler initially has one runnable slot. Auto may provisionally increase
that to two when all of the following hold:

- The queue plus admitted work contains at least four substantive tasks. Header
  inspections and engine startup do not count. A two-image edit does not trigger
  extra workers for calibration.
- The reported CPU budget is at least three tokens, and the existing estimated
  memory budget is at least 1 GiB. Under the current budget formula, this requires
  a memory hint of at least 8 GiB. A missing hint receives a 512 MiB budget and
  retains the one-worker start. This is resource-based policy, not desktop or
  phone detection and not proof that a hinted device has spare physical RAM.
- Auto has neither completed a throughput window nor already tried this probe,
  and no pressure observation has disabled it. An unchanged configuration call
  cannot re-enable a probe after pressure. Explicit mode changes reset the
  startup opportunity; the pressure cooldown still applies.

Every individual admission still passes the same memory, CPU, output-credit,
priority and origin-wide checks. Two workers need not actually be admitted when
only one image fits. Increasing the limit does not allocate source bytes for
the entire queue.

Later growth still requires eight comparable completions, at least 250 ms, and
5% completion-rate improvement to retain a larger pool. Backoff still has a
30-second cooldown. No benchmark input, output validation, encoder setting,
comparison threshold, or measurement boundary changed. Existing calibration
tests explicitly exercise the conservative missing-memory-hint path; new tests
exercise the two-worker start and unchanged growth/retreat rules.

This probe does not itself compare two workers against one. Its initial size is
a provisional policy choice, supported for further investigation by the prior
matrix's roughly doubled fixed-two throughput on this host. It must not be
presented as a learned optimum for another device or a production qualification.
Single-worker-optimal devices, changing bottlenecks, thermal slowdown, and the
plan's physical interaction and memory gates still need qualification. The
existing runtime's sustained-throughput behavior also needs broader testing.

## Reproducibility and verification

The [patch](change.patch) is relative to the source archived with the preceding
idle-gap correction. The [source inventory](source-files.json) hashes the 167
source/runtime/test/input-description files in [the source archive](verified-source.tar.gz).
The corpus stays at its existing pinned paths, with original attribution and
unchanged input hashes.

The pre-change scheduler run fails the two new startup behavior assertions.
After the change, all 28 scheduler checks pass. They include conservative starts
for absent/small resource hints, short jobs mixed with header reads, a subsequent
larger batch, eight-sample retention, no-gain backoff, retained camera-sized
memory, terminal-write reservations, and pressure suppression. The deterministic
model/diagnostic suite adds 91 passing checks, for 119 total.

Both source and packaged Chromium regression suites passed, including exact
multi-worker outputs and cross-tab admission. Real IndexedDB/OPFS/Web Locks
recovery and terminated-writer fault checks passed. Adapter parity is 33/33;
managed adapter function coverage is 27/34 and passes its declared 70% gate.
The 179-file packaged artifact, manifest/anti-cheat checks and static audit pass.

On 20 September the source and archive hashes were rechecked and still matched;
the completed browser/recovery logs were recovered from the preceding run.
The full canonical matrix was then started with those unchanged sources.
At that checkpoint timing conclusions remained pending. The run subsequently
completed at 06:17:47 UTC: 100 measured jobs / 3,600 images and 174 jobs / 6,264
outputs including gates/warmups all passed, as did final source/input and
raw-statistic validation. Its budget ledger is 15 pass, 2 fail and 4 unproven.
Warm camera Auto measured 10,101.2 ms against the best fixed median of
9,833.2 ms, within the target. Cold small Auto and tiny PNG remain failing.
See [the complete report, receipt and previous failures](../../../../COLLECTION_BENCHMARKS.md).
This engineering experiment does not close the release gates.

## Interim timing observations, 20 September

Three blocks of `benchmark-1b0bd5c5-2370-4252-bbc3-c4d53ed2e0eb` have completed
their five repetitions per eligible setting. All their output checks passed;
the full run's final identity validation was still pending at this checkpoint.
It subsequently passed, as recorded above; these block statistics were retained
unchanged in the complete run.

| Completed block | Auto median | Best fixed median | Auto / best fixed |
| --- | ---: | ---: | ---: |
| Small, cold | 7,180.9 ms | 4,208.0 ms, eight workers | 1.7065, above 1.10 |
| Small, warm | 3,462.2 ms | 3,935.3 ms, eight workers | 0.8798, within 1.10 |
| Camera, cold | 11,408.1 ms | 10,536.2 ms, eight workers | 1.0828, within 1.10 |

Small/cold Auto ranges from 7,114.0 to 7,200.5 ms. It starts its two-worker
probe at 90.6–100.1 ms, grows to four at 3,244.7–3,285.1 ms, eight at
5,077.5–5,126.8 ms and eleven at 6,208.8–6,279.2 ms. This removes the old
six-second serial startup but still spends much of the batch gathering
intermediate calibration windows. The next performance change needs to address
that remaining cost; this result does not justify relaxing the 10% target.

Camera/cold Auto ranges from 10,568.0 to 12,324.9 ms. Passing the declared
median comparison does not imply every individual batch is within 10%, nor
does it qualify phone latency, thermals or total memory. Prior-run medians
remain useful observations, not a simultaneous controlled A/B trial.
