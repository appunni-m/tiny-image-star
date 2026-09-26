# Auto concurrency follow-up — 26 September 2026

## Full-matrix finding

The clean committed baseline was `dcafdf5a2aaaae0a94626671c54439355b971757`.
Canonical run `benchmark-a4bf24e1-d314-4475-8e23-998207832388` completed on
Chromium 151, macOS 24.6, an Apple M3 Pro with 11 scheduler CPU tokens and a
2 GiB scheduler memory budget. All eligible executions passed the live serial
output-byte and journal checks; there were no infrastructure errors. Four
fixed-16 rows were ineligible on this host.

| Collection | Fixed 8 median | Auto median | Auto / fixed 8 |
| --- | ---: | ---: | ---: |
| 48 small images, cold | 4.66 s | 5.33 s | 1.144 |
| 48 small images, warm | 4.54 s | 5.78 s | 1.272 |
| 24 camera photos, cold | 10.54 s | 10.47 s | 0.994 |
| 24 camera photos, warm | 10.80 s | 10.69 s | 0.989 |

The full ledger had 14 passing, 3 failing and 4 unproven timing budgets. The
failures were Auto versus eight workers for small collections in both cache
states, plus the existing engine PNG microbenchmark at 1.726× against a 1.50×
limit. Camera collection budgets passed. Auto reached 11 active workers on the
small workload, reserving up to 834 MiB, although the eight-worker profile was
faster and reserved about 612 MiB.

## Scheduler change and focused confirmation

Auto now uses an initial pool of up to eight only when its reported CPU budget
is at least eight tokens and its scheduler memory budget is at least 2 GiB.
Demand still has to fill two waves. Smaller devices keep the previous
half-CPU start. Auto may expand above eight only when at least eight queued
tasks of the same worker kind and work class remain; this avoids opening a
larger pool for the tail of a short image class. Every worker still goes
through the existing CPU, memory and cross-tab admission checks. Explicit
Max-speed remains eligible for the full CPU budget.

A five-sample focused cold run used the same 48-image corpus, Chromium 151,
OPFS, IndexedDB and Web Locks. It included a live serial reference, a correctness
gate for each profile and five measured runs each for 1, 8 and Auto (19 jobs
total). Every output matched the serial reference byte-for-byte, and every
journal completed without failures.

| Profile | Samples (seconds) | Median | Peak active workers |
| --- | --- | ---: | ---: |
| 1 worker | 26.789, 25.991, 26.262, 26.253, 26.282 | 26.262 s | 1 |
| 8 workers | 6.027, 5.573, 5.537, 5.506, 5.487 | 5.537 s | 8 |
| Auto | 5.982, 5.807, 5.818, 6.087, 5.743 | 5.818 s | 8 |

Auto was 1.051× the fixed-eight median, within the declared 1.10 comparison
for this cold-small slice. At the time, warm small collections, camera photos
on the changed scheduler, physical phones, sustained thermal behavior and the
engine PNG budget remained unqualified. The full canonical result below
supersedes the open scheduler-matrix item; the device and engine gates remain.

## Canonical full matrix on the tuned revision

The clean tuned code revision `bfa94390ca93fcd802820d51845ccc399ac8b8c7`
completed canonical run `benchmark-c5234be6-994b-4535-94d1-251b1e93106c` on
the same M3 Pro / Chromium 151 host. All nine workloads ran, their outputs
matched the live serial reference byte-for-byte, journals completed, and there
were no infrastructure errors. Auto met its 1.10 comparison against every
eligible fixed setting:

| Collection | Fixed 8 median | Auto median | Auto / fixed 8 |
| --- | ---: | ---: | ---: |
| 48 small images, cold | 4.70 s | 5.06 s | 1.077 |
| 48 small images, warm | 4.45 s | 4.34 s | 0.975 |
| 24 camera photos, cold | 10.45 s | 10.42 s | 0.997 |
| 24 camera photos, warm | 9.97 s | 9.91 s | 0.994 |

The canonical ledger is **16 pass, 1 fail, 4 not proven**. The only failure is
the separate `TinyImageStar.Engine.renderWithApi.performance` PNG measurement:
1.807× against its 1.50× limit. Fixed-16 was not eligible because this host
reports 11 scheduler CPU tokens, so its four comparisons remain unproven. Auto
peaked at eight active workers for small images and six/eight for cold/warm
camera photos. This closes the scheduler matrix; the PNG budget and all
physical-device and release qualification remain open.

The full raw report and per-job records remain in the local ignored
`.migration-results` directory. The versioned result is summarized here without
adding multi-megabyte raw jobs to the deployed application artifact.
