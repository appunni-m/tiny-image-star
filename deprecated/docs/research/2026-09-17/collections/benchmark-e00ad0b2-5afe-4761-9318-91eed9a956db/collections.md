# Collection benchmark observations

Run: benchmark-e00ad0b2-5afe-4761-9318-91eed9a956db.

Environment: darwin 24.6.0; Apple M3 Pro; Node v24.18.0, V8 13.6.233.17-node.50; Chromium 151.0.7922.34. Power/thermal state is unknown.

Worktree dirty: true. These headless desktop observations are not physical-phone or release qualification.

Job timing includes source scan through journaled output commit. Additional independent decoder and exact-byte checks are outside the interval. Stage timings overlap the render interval and do not sum to job wall time. Wasm values below are the largest reported worker heap, not process RAM.

## collection.small-cold

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 24.00 / 23.95–24.15 | 2.00 | 1 | 81.0 | 40.1 |
| browser-2 | 5 | 12.42 / 12.40–12.45 | 3.87 | 2 | 156.6 | 41.0 |
| browser-4 | 5 | 6.53 / 6.48–6.58 | 7.35 | 4 | 310.0 | 42.9 |
| browser-8 | 5 | 4.08 / 4.02–4.09 | 11.77 | 8 | 611.9 | 42.9 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 12.13 / 12.10–12.33 | 3.96 | 8 | 603.3 | 42.5 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 5420.35 / 5687.80 | 0.60 / 1.10 | 0.35 / 0.70 | 0.10 / 0.20 | 302.20 / 645.60 | 165.35 / 249.90 | 5.55 / 6.90 | 31.90 / 40.30 | 0.00 / 1.90 |
| browser-2 | 2735.30 / 3062.20 | 0.75 / 1.10 | 0.45 / 0.80 | 0.10 / 0.20 | 313.45 / 657.30 | 166.45 / 255.00 | 5.60 / 7.00 | 33.80 / 42.20 | 0.00 / 1.70 |
| browser-4 | 1303.25 / 1917.90 | 0.80 / 1.30 | 0.45 / 0.80 | 0.10 / 0.30 | 313.85 / 668.70 | 168.30 / 258.70 | 5.50 / 7.40 | 46.90 / 54.90 | 0.00 / 2.10 |
| browser-8 | 770.70 / 1328.50 | 1.80 / 3.60 | 0.50 / 1.10 | 0.20 / 0.50 | 341.80 / 755.20 | 188.50 / 290.60 | 11.90 / 20.00 | 78.90 / 116.20 | 0.00 / 1.70 |
| browser-auto | 2333.45 / 5304.00 | 0.90 / 2.30 | 0.50 / 0.90 | 0.10 / 0.40 | 302.60 / 673.20 | 168.85 / 258.30 | 5.90 / 12.80 | 39.40 / 84.10 | 0.00 / 1.50 |

Raw samples and correctness checks: [collection.small-cold-samples.json](collection.small-cold-samples.json).

## collection.small-warm

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 23.92 / 23.79–24.02 | 2.01 | 1 | 81.0 | 40.1 |
| browser-2 | 5 | 12.31 / 12.26–12.38 | 3.90 | 2 | 156.6 | 42.9 |
| browser-4 | 5 | 6.40 / 6.38–6.45 | 7.50 | 4 | 309.2 | 42.9 |
| browser-8 | 5 | 3.91 / 3.84–3.94 | 12.27 | 8 | 611.9 | 42.9 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 3.56 / 3.54–3.58 | 13.46 | 11 | 834.8 | 41.7 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 5428.00 / 5704.20 | 0.65 / 1.00 | 0.35 / 0.70 | 0.10 / 0.10 | 270.80 / 644.50 | 163.10 / 248.50 | 7.20 / 9.10 | — | 0.00 / 1.70 |
| browser-2 | 2741.10 / 3053.60 | 0.65 / 1.00 | 0.40 / 0.80 | 0.10 / 0.10 | 273.05 / 656.90 | 165.55 / 255.10 | 7.10 / 10.40 | — | 0.00 / 1.80 |
| browser-4 | 1300.20 / 1915.30 | 0.80 / 1.30 | 0.40 / 0.80 | 0.10 / 0.20 | 277.90 / 667.00 | 166.75 / 258.30 | 6.80 / 10.20 | — | 0.00 / 1.80 |
| browser-8 | 768.60 / 1304.90 | 1.70 / 2.60 | 0.50 / 1.10 | 0.10 / 0.20 | 305.40 / 755.60 | 186.15 / 293.60 | 14.95 / 32.70 | — | 0.00 / 2.00 |
| browser-auto | 689.90 / 1196.20 | 1.50 / 3.30 | 0.50 / 1.10 | 0.10 / 0.40 | 327.60 / 818.00 | 203.20 / 321.80 | 18.25 / 38.10 | 77.90 / 89.80 | 0.00 / 2.00 |

Raw samples and correctness checks: [collection.small-warm-samples.json](collection.small-warm-samples.json).

## collection.camera-cold

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 19.66 / 19.63–19.69 | 1.22 | 1 | 914.3 | 236.0 |
| browser-2 | 5 | 10.39 / 10.36–10.41 | 2.31 | 2 | 1826.6 | 242.1 |
| browser-4 | 5 | 10.08 / 9.97–10.29 | 2.38 | 4 | 2045.0 | 236.6 |
| browser-8 | 5 | 9.95 / 9.64–10.05 | 2.41 | 8 | 2047.2 | 242.1 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 15.05 / 15.04–15.10 | 1.59 | 2 | 1806.0 | 240.6 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 8588.60 / 9077.90 | 2.30 / 3.70 | 2.30 / 4.20 | 0.30 / 0.70 | 859.75 / 907.60 | 49.00 / 49.90 | 4.10 / 6.30 | 31.70 / 38.40 | 0.00 / 1.20 |
| browser-2 | 4342.75 / 4906.20 | 2.35 / 3.80 | 2.50 / 4.60 | 0.40 / 0.80 | 876.50 / 951.30 | 49.90 / 51.30 | 4.20 / 6.90 | 33.20 / 40.80 | 0.00 / 1.90 |
| browser-4 | 4143.30 / 5235.60 | 2.40 / 4.00 | 2.60 / 5.00 | 0.40 / 0.80 | 879.00 / 1126.10 | 49.90 / 51.30 | 4.30 / 6.00 | 44.75 / 50.00 | 0.00 / 2.00 |
| browser-8 | 3958.90 / 5311.40 | 2.70 / 6.60 | 2.50 / 5.10 | 0.40 / 0.90 | 876.45 / 1091.80 | 50.00 / 51.40 | 4.20 / 5.70 | 73.45 / 110.20 | 0.00 / 1.70 |
| browser-auto | 6074.55 / 9092.30 | 2.40 / 3.80 | 2.40 / 4.50 | 0.40 / 0.80 | 872.50 / 926.60 | 49.10 / 50.90 | 4.10 / 6.30 | 27.40 / 37.80 | 0.00 / 1.80 |

Raw samples and correctness checks: [collection.camera-cold-samples.json](collection.camera-cold-samples.json).

## collection.camera-warm

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 19.11 / 19.09–19.17 | 1.26 | 1 | 914.3 | 236.0 |
| browser-2 | 5 | 9.83 / 9.77–9.84 | 2.44 | 2 | 1826.6 | 240.6 |
| browser-4 | 5 | 9.71 / 9.37–9.87 | 2.47 | 4 | 2045.0 | 236.0 |
| browser-8 | 5 | 9.69 / 9.67–9.75 | 2.48 | 8 | 2045.0 | 242.1 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 9.82 / 9.76–9.90 | 2.44 | 4 | 2045.6 | 240.6 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 8593.20 / 9053.90 | 2.30 / 3.80 | 2.30 / 4.10 | 0.30 / 0.60 | 858.45 / 903.10 | 49.00 / 49.50 | 4.95 / 6.80 | — | 0.00 / 1.60 |
| browser-2 | 4234.90 / 4895.90 | 2.40 / 3.90 | 2.50 / 4.50 | 0.30 / 0.70 | 875.00 / 923.40 | 49.90 / 51.20 | 4.95 / 7.60 | — | 0.00 / 1.90 |
| browser-4 | 3920.75 / 4837.40 | 3.15 / 4.80 | 2.50 / 4.80 | 0.40 / 0.70 | 875.15 / 925.30 | 49.90 / 51.30 | 4.80 / 7.60 | 29.40 / 33.80 | 0.00 / 2.00 |
| browser-8 | 3823.75 / 5387.60 | 3.05 / 6.60 | 2.60 / 4.60 | 0.40 / 0.70 | 874.55 / 923.70 | 50.00 / 51.60 | 5.35 / 7.40 | 61.90 / 76.60 | 0.00 / 1.80 |
| browser-auto | 4266.15 / 4865.50 | 2.40 / 4.40 | 2.50 / 4.70 | 0.30 / 0.80 | 873.20 / 922.40 | 49.80 / 51.20 | 5.10 / 7.50 | 27.60 / 32.00 | 0.00 / 2.00 |

Raw samples and correctness checks: [collection.camera-warm-samples.json](collection.camera-warm-samples.json).

## Declared budget outcomes

| Requirement | Observed ratio | Limit | Outcome |
| --- | ---: | ---: | --- |
| TinyImageStar.Engine.renderWithApi.performance | 1.680 | 1.5 | fail |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-1 | 0.505 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-2 | 0.977 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-4 | 1.857 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-8 | 2.975 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-1 | 0.149 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-2 | 0.289 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-4 | 0.557 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-8 | 0.911 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-1 | 0.766 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-2 | 1.448 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-4 | 1.493 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-8 | 1.512 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-1 | 0.514 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-2 | 0.999 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-4 | 1.011 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-8 | 1.013 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-16 | — | 1.1 | not_proven |
