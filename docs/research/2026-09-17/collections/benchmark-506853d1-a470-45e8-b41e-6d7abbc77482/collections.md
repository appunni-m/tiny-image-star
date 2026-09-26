# Collection benchmark observations

Run: benchmark-506853d1-a470-45e8-b41e-6d7abbc77482.

Environment: darwin 24.6.0; Apple M3 Pro; Node v24.18.0, V8 13.6.233.17-node.50; Chromium 151.0.7922.34. Power/thermal state is unknown.

Worktree dirty: true. These headless desktop observations are not physical-phone or release qualification.

Job timing includes source scan through journaled output commit. Additional independent decoder and exact-byte checks are outside the interval. Stage timings overlap the render interval and do not sum to job wall time. Wasm values below are the largest reported worker heap, not process RAM.

## collection.small-cold

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 24.21 / 24.05–25.85 | 1.98 | 1 | 81.0 | 40.1 |
| browser-2 | 5 | 12.70 / 12.43–12.93 | 3.78 | 2 | 156.6 | 42.9 |
| browser-4 | 5 | 6.54 / 6.48–7.28 | 7.34 | 4 | 310.0 | 42.9 |
| browser-8 | 5 | 4.11 / 4.03–4.47 | 11.69 | 8 | 612.6 | 42.9 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 12.46 / 12.13–12.86 | 3.85 | 8 | 603.3 | 40.4 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 5496.70 / 6019.10 | 0.80 / 1.60 | 0.40 / 0.80 | 0.10 / 0.20 | 307.60 / 658.60 | 165.80 / 253.90 | 5.70 / 24.50 | 33.30 / 52.60 | 0.00 / 2.00 |
| browser-2 | 2776.70 / 3183.80 | 0.80 / 1.50 | 0.40 / 0.80 | 0.10 / 0.20 | 308.40 / 671.50 | 169.15 / 260.00 | 5.70 / 11.60 | 36.30 / 39.10 | 0.00 / 2.00 |
| browser-4 | 1379.90 / 1981.40 | 0.90 / 1.70 | 0.50 / 0.80 | 0.10 / 0.20 | 316.20 / 674.20 | 169.70 / 259.50 | 5.80 / 84.10 | 51.30 / 74.10 | 0.00 / 1.90 |
| browser-8 | 792.20 / 1362.90 | 1.60 / 3.90 | 0.55 / 1.10 | 0.10 / 0.50 | 353.70 / 774.30 | 190.35 / 298.80 | 11.60 / 70.80 | 91.20 / 173.40 | 0.00 / 2.00 |
| browser-auto | 2341.55 / 5423.20 | 1.00 / 3.20 | 0.45 / 0.80 | 0.10 / 0.40 | 307.10 / 679.30 | 169.25 / 260.70 | 6.00 / 22.20 | 43.80 / 94.10 | 0.00 / 2.00 |

Raw samples and correctness checks: [collection.small-cold-samples.json](collection.small-cold-samples.json).

## collection.small-warm

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 24.92 / 24.53–24.99 | 1.93 | 1 | 81.0 | 40.1 |
| browser-2 | 5 | 12.59 / 12.55–12.97 | 3.81 | 2 | 156.6 | 42.9 |
| browser-4 | 5 | 6.52 / 6.42–6.60 | 7.36 | 4 | 309.2 | 42.9 |
| browser-8 | 5 | 3.98 / 3.92–4.19 | 12.05 | 8 | 611.9 | 42.9 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 5.77 / 5.71–5.88 | 8.33 | 8 | 607.8 | 42.9 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 5648.25 / 5939.20 | 0.80 / 1.20 | 0.40 / 0.80 | 0.10 / 0.20 | 276.35 / 669.10 | 167.90 / 258.00 | 7.70 / 10.30 | — | 0.00 / 2.00 |
| browser-2 | 2803.30 / 3162.00 | 0.80 / 1.50 | 0.40 / 0.80 | 0.10 / 0.20 | 279.70 / 670.90 | 168.55 / 259.80 | 7.70 / 14.70 | — | 0.00 / 2.00 |
| browser-4 | 1328.45 / 1940.90 | 1.00 / 2.10 | 0.40 / 0.80 | 0.10 / 0.20 | 295.00 / 673.20 | 170.05 / 260.10 | 8.40 / 14.00 | — | 0.00 / 2.00 |
| browser-8 | 784.05 / 1339.60 | 1.60 / 3.60 | 0.60 / 1.10 | 0.10 / 0.30 | 316.90 / 764.20 | 189.65 / 299.20 | 17.55 / 74.10 | — | 0.00 / 1.90 |
| browser-auto | 1172.90 / 1912.80 | 1.10 / 2.60 | 0.50 / 1.00 | 0.10 / 0.20 | 305.15 / 691.40 | 173.70 / 281.30 | 8.60 / 24.40 | — | 0.00 / 2.00 |

Raw samples and correctness checks: [collection.small-warm-samples.json](collection.small-warm-samples.json).

## collection.camera-cold

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 19.69 / 19.64–19.78 | 1.22 | 1 | 914.3 | 236.0 |
| browser-2 | 5 | 10.40 / 10.39–10.41 | 2.31 | 2 | 1826.6 | 240.6 |
| browser-4 | 5 | 9.97 / 9.93–10.13 | 2.41 | 4 | 2032.1 | 242.1 |
| browser-8 | 5 | 10.15 / 9.77–10.32 | 2.36 | 8 | 2046.4 | 242.1 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 15.05 / 15.04–15.07 | 1.59 | 2 | 1806.0 | 240.6 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 8595.20 / 9091.30 | 2.30 / 3.70 | 2.30 / 4.30 | 0.30 / 0.70 | 860.55 / 915.70 | 49.10 / 50.10 | 4.10 / 6.30 | 32.00 / 37.90 | 0.00 / 1.70 |
| browser-2 | 4345.85 / 4904.90 | 2.30 / 3.80 | 2.50 / 4.40 | 0.40 / 0.80 | 876.65 / 955.00 | 49.90 / 51.30 | 4.10 / 6.60 | 34.30 / 38.60 | 0.00 / 1.90 |
| browser-4 | 4147.40 / 5418.30 | 2.40 / 3.80 | 2.60 / 4.60 | 0.50 / 0.80 | 878.35 / 1140.40 | 49.90 / 51.70 | 4.20 / 5.80 | 45.50 / 53.30 | 0.00 / 1.60 |
| browser-8 | 4263.10 / 5299.40 | 2.90 / 7.50 | 2.50 / 5.10 | 0.40 / 0.90 | 878.55 / 1301.00 | 50.00 / 51.80 | 4.20 / 6.20 | 77.20 / 95.60 | 0.00 / 1.90 |
| browser-auto | 6071.85 / 9081.00 | 2.35 / 3.70 | 2.40 / 4.50 | 0.35 / 0.80 | 872.55 / 930.20 | 49.15 / 50.80 | 4.10 / 6.10 | 26.50 / 38.20 | 0.00 / 2.00 |

Raw samples and correctness checks: [collection.camera-cold-samples.json](collection.camera-cold-samples.json).

## collection.camera-warm

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 19.13 / 19.09–19.16 | 1.25 | 1 | 914.3 | 236.0 |
| browser-2 | 5 | 9.82 / 9.77–9.84 | 2.44 | 2 | 1806.0 | 240.6 |
| browser-4 | 5 | 9.69 / 9.63–9.87 | 2.48 | 4 | 2041.1 | 239.9 |
| browser-8 | 5 | 9.69 / 9.27–9.71 | 2.48 | 8 | 2047.1 | 242.1 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 9.75 / 9.66–9.86 | 2.46 | 5 | 2024.2 | 240.6 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 8602.15 / 9064.40 | 2.40 / 3.80 | 2.30 / 4.10 | 0.30 / 0.60 | 860.10 / 902.80 | 49.00 / 49.60 | 5.00 / 6.80 | — | 0.00 / 1.80 |
| browser-2 | 4231.40 / 4877.20 | 2.40 / 3.80 | 2.50 / 4.40 | 0.30 / 0.70 | 875.30 / 921.40 | 49.90 / 51.20 | 4.90 / 7.40 | — | 0.00 / 2.00 |
| browser-4 | 3858.95 / 4908.00 | 2.60 / 5.70 | 2.50 / 4.90 | 0.40 / 0.70 | 876.40 / 938.90 | 50.00 / 51.40 | 5.00 / 7.20 | 31.85 / 34.80 | 0.00 / 2.00 |
| browser-8 | 3912.25 / 4758.10 | 2.75 / 5.90 | 2.50 / 4.80 | 0.40 / 0.80 | 875.00 / 924.60 | 50.00 / 51.40 | 4.80 / 7.00 | 56.90 / 71.70 | 0.00 / 1.90 |
| browser-auto | 3940.10 / 4867.30 | 2.50 / 4.90 | 2.60 / 5.20 | 0.40 / 0.70 | 874.90 / 921.20 | 49.90 / 51.20 | 5.10 / 7.00 | 27.10 / 41.20 | 0.00 / 1.80 |

Raw samples and correctness checks: [collection.camera-warm-samples.json](collection.camera-warm-samples.json).

## Declared budget outcomes

| Requirement | Observed ratio | Limit | Outcome |
| --- | ---: | ---: | --- |
| TinyImageStar.Engine.renderWithApi.performance | 2.096 | 1.5 | fail |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-1 | 0.515 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-2 | 0.981 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-4 | 1.905 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-8 | 3.034 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-1 | 0.231 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-2 | 0.458 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-4 | 0.884 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-8 | 1.448 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-1 | 0.765 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-2 | 1.447 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-4 | 1.509 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-8 | 1.483 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-1 | 0.509 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-2 | 0.993 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-4 | 1.006 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-8 | 1.006 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-16 | — | 1.1 | not_proven |
