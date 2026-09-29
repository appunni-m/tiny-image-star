# Startup calibration finding

Observed 17 September 2026 from the completed small/cold block of canonical
run `benchmark-e00ad0b2-5afe-4761-9318-91eed9a956db`. The rest of that run was
still executing when this note was written. The final result and identity checks
must complete before treating the run as compatible evidence.

All five repetitions of each eligible setting passed the output checks.
The 48-image job medians were 23,999.9 ms at one worker, 12,417.1 ms at two,
6,530.3 ms at four, 4,076.6 ms at eight and 12,128.5 ms at Auto.
Fixed 16 exceeded this host's real CPU budget and was not run.

The Auto scheduler traces show the first increase from one to two workers at
6.11–6.13 seconds; four arrives at 9.32–9.35 seconds and eight at
11.03–11.07 seconds. The first increase alone occurs after 1.10 times the best
fixed median (4,484.26 ms). Consequently, preserving this startup behavior cannot
meet the declared cold-job target for this workload, even if all later work
became instantaneous. The idle-gap fix addresses a different defect.

The current scheduler requires eight comparable completions and at least 250 ms
before changing concurrency. Mixed image-size classes accumulate separately;
the eight samples can therefore require more than eight total rendered images.
This preserves comparable observations but imposes a measurable cost on an
unprofiled collection. The timing trace, not the worker-count hint alone,
justifies investigating startup behavior.

## Next experiment boundaries

- Compare a bounded initial probe and faster staged exploration with the current
  policy. Keep the same CPU/memory ledger, output-write credits, foreground
  priority, cancellation and pressure response. A probe is not a qualified
  default merely because it starts more workers.
- Measure short and long collections, heterogeneous image costs, genuine
  oversubscription, slow writes, noisy timing and memory-limited camera jobs.
  Require meaningful throughput-retreat tests rather than tuning solely to this
  corpus, its IDs, filenames, ordering or this one desktop's CPU count.
- If completed calibration is cached, key and expire it by engine, operation,
  device budget and relevant capability changes. Test stale/incorrect profiles.
  Report fresh-profile and reused-profile results separately; do not relabel
  learned-profile results as a first-use cold start.
- Preserve conservative behavior on unqualified phones. A missing memory hint
  is not evidence that the device has spare RAM. Physical responsiveness and
  sustained memory qualification remain required before retaining higher counts.
- Run the same canonical randomized matrix after any candidate change. Retain
  failed results, normal validation and durable writes. Do not weaken the 10%
  target, remove slow cases or suppress initialization to make a report pass.

No startup-policy change is implemented by this note. The ongoing run's source,
manifest, inputs and measurement code remain unchanged. The complete method and
evidence status are in [Collection benchmarks](../../../../COLLECTION_BENCHMARKS.md).

## Completed warm block

The warm small-image block subsequently completed all five repetitions at each
eligible setting, with no output-check failures. Auto's median is 3,564.9 ms
(3,541.9–3,580.5 ms), compared with the fastest fixed median of 3,911.5 ms at
eight workers. Auto / best fixed is 0.9114, within the declared 1.10 timing bound.
Camera measurements and the full run's final identity validation were still
pending at this checkpoint. This observation supports the idle-gap repair;
it does not close cold-start, physical-memory or phone-responsiveness gates.

The full run subsequently completed at 07:55:31 UTC. Camera Auto measured
15,049.5 ms cold against the fastest fixed median of 9,951.9 ms, and 9,819.5 ms
warm against 9,693.7 ms. Both warm families meet timing; both cold families
remain outside the target. All 100 measured jobs pass, and final identity/raw
validation passed. See the [archived complete result](../benchmark-e00ad0b2-5afe-4761-9318-91eed9a956db/collections.md).
