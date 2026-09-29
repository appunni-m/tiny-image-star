# Collection benchmark observations

Run: benchmark-6a30d31a-8f7b-40c1-8cd8-0c3d63aed3d7.

Environment: darwin 24.6.0; Apple M3 Pro; Node v24.18.0, V8 13.6.233.17-node.50; Chromium 151.0.7922.34. Power/thermal state is unknown.

Worktree dirty: true. These headless desktop observations are not physical-phone or release qualification.

Job timing includes source scan through journaled output commit. Additional independent decoder and exact-byte checks are outside the interval. Stage timings overlap the render interval and do not sum to job wall time. Wasm values below are the largest reported worker heap, not process RAM.

## collection.small-cold

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 24.42 / 24.36–24.65 | 1.97 | 1 | 81.0 | 40.1 |
| browser-2 | 5 | 12.57 / 12.55–12.65 | 3.82 | 2 | 156.6 | 42.9 |
| browser-4 | 5 | 6.63 / 6.58–6.74 | 7.24 | 4 | 310.0 | 42.5 |
| browser-8 | 5 | 4.23 / 4.13–4.28 | 11.34 | 8 | 611.9 | 42.3 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 4.34 / 4.31–4.41 | 11.07 | 11 | 834.4 | 42.2 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 5518.45 / 5815.50 | 0.80 / 1.20 | 0.40 / 0.80 | 0.10 / 0.20 | 308.85 / 656.50 | 166.75 / 254.10 | 6.10 / 7.50 | 37.90 / 43.10 | 0.00 / 1.50 |
| browser-2 | 2764.80 / 3105.00 | 0.80 / 1.20 | 0.45 / 0.80 | 0.10 / 0.20 | 309.55 / 666.10 | 167.85 / 258.70 | 5.90 / 7.60 | 36.80 / 43.90 | 0.00 / 1.50 |
| browser-4 | 1329.80 / 1962.80 | 0.90 / 1.50 | 0.45 / 0.80 | 0.10 / 0.20 | 334.40 / 676.70 | 170.30 / 262.30 | 6.20 / 9.10 | 58.70 / 82.50 | 0.00 / 2.00 |
| browser-8 | 785.45 / 1391.30 | 2.10 / 4.10 | 0.60 / 1.20 | 0.20 / 0.60 | 348.05 / 771.10 | 192.60 / 302.80 | 14.90 / 29.20 | 97.60 / 128.30 | 0.00 / 1.80 |
| browser-auto | 794.55 / 1474.00 | 1.90 / 5.30 | 0.60 / 1.20 | 0.20 / 0.50 | 323.20 / 827.60 | 202.60 / 326.60 | 14.20 / 31.90 | 61.95 / 147.60 | 0.00 / 2.10 |

Raw samples and correctness checks: [collection.small-cold-samples.json](collection.small-cold-samples.json).

## collection.small-warm

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 24.57 / 24.40–24.70 | 1.95 | 1 | 81.0 | 40.1 |
| browser-2 | 5 | 12.57 / 12.50–12.65 | 3.82 | 2 | 156.6 | 41.0 |
| browser-4 | 5 | 6.61 / 6.49–6.69 | 7.26 | 4 | 309.2 | 40.9 |
| browser-8 | 5 | 4.09 / 3.98–4.22 | 11.74 | 8 | 611.9 | 42.9 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 3.51 / 3.45–3.61 | 13.69 | 11 | 834.8 | 42.2 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 5581.20 / 5867.70 | 0.75 / 1.10 | 0.40 / 0.80 | 0.10 / 0.20 | 279.65 / 659.50 | 167.25 / 254.40 | 8.25 / 10.90 | — | 0.00 / 1.00 |
| browser-2 | 2788.00 / 3121.30 | 0.80 / 1.20 | 0.40 / 0.80 | 0.10 / 0.20 | 286.40 / 667.80 | 169.55 / 258.90 | 8.00 / 12.80 | — | 0.00 / 1.10 |
| browser-4 | 1333.50 / 1949.30 | 0.90 / 1.80 | 0.40 / 0.80 | 0.10 / 0.20 | 337.15 / 678.00 | 170.00 / 262.20 | 8.10 / 14.50 | — | 0.00 / 1.50 |
| browser-8 | 798.10 / 1356.60 | 1.90 / 3.20 | 0.55 / 1.20 | 0.10 / 0.40 | 316.90 / 781.90 | 193.65 / 303.80 | 19.65 / 50.10 | — | 0.00 / 1.20 |
| browser-auto | 624.60 / 1227.70 | 2.20 / 4.80 | 0.50 / 1.20 | 0.10 / 0.40 | 340.25 / 873.20 | 215.45 / 338.30 | 25.80 / 64.30 | — | 0.00 / 1.10 |

Raw samples and correctness checks: [collection.small-warm-samples.json](collection.small-warm-samples.json).

## collection.camera-cold

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 20.14 / 20.02–20.16 | 1.19 | 1 | 914.3 | 236.0 |
| browser-2 | 5 | 10.58 / 10.52–10.60 | 2.27 | 2 | 1826.6 | 242.1 |
| browser-4 | 5 | 10.12 / 9.58–10.34 | 2.37 | 4 | 2030.6 | 239.9 |
| browser-8 | 5 | 10.13 / 9.91–10.41 | 2.37 | 8 | 2045.0 | 242.1 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 10.55 / 10.22–10.59 | 2.27 | 6 | 2045.1 | 241.9 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 8778.70 / 9297.00 | 2.50 / 3.90 | 2.50 / 4.70 | 0.50 / 0.90 | 876.45 / 929.80 | 50.00 / 50.80 | 4.60 / 6.50 | 36.85 / 45.60 | 0.00 / 1.10 |
| browser-2 | 4422.15 / 4986.40 | 2.45 / 4.10 | 2.65 / 5.00 | 0.50 / 0.90 | 890.15 / 956.90 | 50.70 / 52.00 | 4.55 / 7.40 | 41.30 / 43.40 | 0.00 / 1.10 |
| browser-4 | 4183.20 / 5150.80 | 2.70 / 4.50 | 2.70 / 5.00 | 0.55 / 1.20 | 892.10 / 1127.20 | 50.70 / 52.00 | 4.70 / 7.70 | 56.00 / 61.70 | 0.00 / 1.10 |
| browser-8 | 4179.60 / 4973.60 | 3.50 / 7.60 | 2.70 / 5.40 | 0.60 / 1.20 | 890.90 / 1049.20 | 50.80 / 52.10 | 4.60 / 7.00 | 95.05 / 128.90 | 0.00 / 1.10 |
| browser-auto | 4254.35 / 5229.80 | 2.80 / 6.10 | 2.70 / 6.30 | 0.60 / 1.30 | 894.85 / 963.50 | 50.80 / 52.00 | 4.70 / 6.60 | 47.90 / 63.90 | 0.00 / 1.10 |

Raw samples and correctness checks: [collection.camera-cold-samples.json](collection.camera-cold-samples.json).

## collection.camera-warm

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 19.53 / 19.51–19.60 | 1.23 | 1 | 914.3 | 236.0 |
| browser-2 | 5 | 9.97 / 9.92–9.99 | 2.41 | 2 | 1806.0 | 240.6 |
| browser-4 | 5 | 9.79 / 9.46–10.42 | 2.45 | 4 | 2041.1 | 240.6 |
| browser-8 | 5 | 9.58 / 9.41–9.89 | 2.50 | 8 | 2046.4 | 242.1 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 9.91 / 9.60–10.08 | 2.42 | 10 | 2045.3 | 241.9 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 8780.55 / 9262.10 | 2.40 / 4.00 | 2.60 / 5.20 | 0.40 / 0.90 | 875.15 / 927.20 | 49.90 / 50.60 | 5.60 / 7.90 | — | 0.00 / 1.20 |
| browser-2 | 4385.20 / 4953.20 | 2.50 / 4.00 | 2.60 / 4.70 | 0.40 / 0.90 | 888.85 / 936.00 | 50.70 / 51.90 | 5.30 / 8.10 | — | 0.00 / 1.10 |
| browser-4 | 4003.45 / 4968.40 | 3.05 / 6.30 | 2.80 / 5.20 | 0.50 / 1.10 | 889.65 / 942.00 | 50.70 / 52.20 | 5.70 / 8.60 | 37.40 / 70.80 | 0.00 / 1.20 |
| browser-8 | 3928.35 / 5445.50 | 3.10 / 8.20 | 2.70 / 5.30 | 0.50 / 1.00 | 889.15 / 941.00 | 50.75 / 51.90 | 5.50 / 9.30 | 73.75 / 95.20 | 0.00 / 1.30 |
| browser-auto | 4004.35 / 4979.30 | 2.70 / 7.50 | 2.70 / 5.20 | 0.50 / 1.10 | 889.80 / 944.90 | 50.80 / 52.10 | 5.50 / 8.10 | 81.30 / 109.00 | 0.00 / 1.30 |

Raw samples and correctness checks: [collection.camera-warm-samples.json](collection.camera-warm-samples.json).

## Declared budget outcomes

| Requirement | Observed ratio | Limit | Outcome |
| --- | ---: | ---: | --- |
| TinyImageStar.Engine.renderWithApi.performance | 1.725 | 1.5 | fail |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-1 | 0.178 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-2 | 0.345 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-4 | 0.653 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-8 | 1.024 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-1 | 0.143 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-2 | 0.279 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-4 | 0.531 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-8 | 0.857 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-1 | 0.524 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-2 | 0.997 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-4 | 1.043 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-8 | 1.041 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-1 | 0.507 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-2 | 0.994 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-4 | 1.012 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-8 | 1.034 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-16 | — | 1.1 | not_proven |
