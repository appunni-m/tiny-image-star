# Collection benchmark observations

Run: benchmark-1b0bd5c5-2370-4252-bbc3-c4d53ed2e0eb.

Environment: darwin 24.6.0; Apple M3 Pro; Node v24.18.0, V8 13.6.233.17-node.50; Chromium 151.0.7922.34. Power/thermal state is unknown.

Worktree dirty: true. These headless desktop observations are not physical-phone or release qualification.

Job timing includes source scan through journaled output commit. Additional independent decoder and exact-byte checks are outside the interval. Stage timings overlap the render interval and do not sum to job wall time. Wasm values below are the largest reported worker heap, not process RAM.

## collection.small-cold

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 24.58 / 24.50–24.69 | 1.95 | 1 | 81.0 | 40.1 |
| browser-2 | 5 | 12.66 / 12.59–12.76 | 3.79 | 2 | 156.6 | 42.9 |
| browser-4 | 5 | 6.66 / 6.61–6.73 | 7.21 | 4 | 310.0 | 42.9 |
| browser-8 | 5 | 4.21 / 4.17–4.26 | 11.41 | 8 | 611.9 | 42.9 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 7.18 / 7.11–7.20 | 6.68 | 10 | 751.3 | 42.2 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 5541.60 / 5814.70 | 0.80 / 1.20 | 0.45 / 0.80 | 0.10 / 0.20 | 308.90 / 658.60 | 168.20 / 254.20 | 6.20 / 7.30 | 35.15 / 43.10 | 0.00 / 1.00 |
| browser-2 | 2786.45 / 3123.40 | 0.80 / 1.20 | 0.55 / 0.80 | 0.10 / 0.20 | 320.05 / 669.10 | 168.35 / 259.50 | 6.10 / 7.50 | 39.40 / 43.20 | 0.00 / 1.00 |
| browser-4 | 1327.90 / 1951.80 | 1.00 / 1.80 | 0.50 / 0.80 | 0.10 / 0.30 | 328.95 / 679.90 | 171.75 / 263.20 | 6.70 / 8.70 | 53.60 / 70.50 | 0.00 / 1.00 |
| browser-8 | 797.20 / 1363.90 | 2.00 / 4.20 | 0.60 / 1.30 | 0.20 / 0.60 | 340.55 / 781.20 | 194.10 / 304.30 | 14.50 / 28.30 | 88.80 / 119.20 | 0.00 / 1.10 |
| browser-auto | 1378.75 / 2753.80 | 1.20 / 3.70 | 0.50 / 1.10 | 0.10 / 0.50 | 312.05 / 750.10 | 179.10 / 297.60 | 7.60 / 23.00 | 76.10 / 100.50 | 0.00 / 1.10 |

Raw samples and correctness checks: [collection.small-cold-samples.json](collection.small-cold-samples.json).

## collection.small-warm

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 24.12 / 23.98–24.54 | 1.99 | 1 | 81.0 | 40.1 |
| browser-2 | 5 | 12.49 / 12.38–12.54 | 3.84 | 2 | 156.6 | 41.0 |
| browser-4 | 5 | 6.49 / 6.47–6.55 | 7.40 | 4 | 309.2 | 42.9 |
| browser-8 | 5 | 3.94 / 3.93–4.06 | 12.20 | 8 | 611.9 | 42.3 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 3.46 / 3.41–3.58 | 13.86 | 11 | 834.4 | 41.2 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 5494.75 / 5798.90 | 0.80 / 1.10 | 0.40 / 0.80 | 0.10 / 0.20 | 285.75 / 654.70 | 165.80 / 252.50 | 7.50 / 9.70 | — | 0.00 / 2.00 |
| browser-2 | 2775.85 / 3100.70 | 0.80 / 1.20 | 0.40 / 0.80 | 0.10 / 0.20 | 277.50 / 665.40 | 168.60 / 258.20 | 8.00 / 11.70 | — | 0.00 / 2.00 |
| browser-4 | 1316.60 / 1939.30 | 0.90 / 1.60 | 0.40 / 0.80 | 0.10 / 0.20 | 279.35 / 675.30 | 169.70 / 261.10 | 8.20 / 10.70 | — | 0.00 / 2.00 |
| browser-8 | 783.70 / 1337.20 | 1.70 / 3.20 | 0.45 / 1.20 | 0.10 / 0.30 | 311.65 / 765.50 | 191.10 / 294.20 | 19.30 / 36.40 | — | 0.00 / 2.00 |
| browser-auto | 617.50 / 1208.10 | 2.00 / 6.10 | 0.45 / 1.20 | 0.10 / 0.40 | 339.00 / 856.10 | 211.55 / 334.10 | 21.20 / 49.30 | 68.60 / 115.30 | 0.00 / 2.10 |

Raw samples and correctness checks: [collection.small-warm-samples.json](collection.small-warm-samples.json).

## collection.camera-cold

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 20.66 / 20.10–21.73 | 1.16 | 1 | 914.3 | 236.0 |
| browser-2 | 5 | 10.88 / 10.61–11.26 | 2.21 | 2 | 1826.6 | 242.1 |
| browser-4 | 5 | 10.64 / 10.14–10.83 | 2.26 | 4 | 2047.1 | 239.9 |
| browser-8 | 5 | 10.54 / 10.05–10.71 | 2.28 | 8 | 2046.0 | 242.1 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 11.41 / 10.57–12.32 | 2.10 | 4 | 1951.0 | 235.1 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 8803.60 / 9724.50 | 3.00 / 8.10 | 2.60 / 4.90 | 0.50 / 1.00 | 897.80 / 953.00 | 50.20 / 51.90 | 5.30 / 40.70 | 38.55 / 57.40 | 0.00 / 1.00 |
| browser-2 | 4571.20 / 5176.60 | 3.70 / 8.70 | 2.70 / 5.40 | 0.50 / 1.20 | 906.40 / 1007.00 | 51.50 / 52.50 | 8.30 / 66.40 | 43.60 / 61.80 | 0.00 / 0.90 |
| browser-4 | 4414.00 / 5468.40 | 3.80 / 11.70 | 2.80 / 5.50 | 0.60 / 1.10 | 905.95 / 1118.40 | 51.40 / 53.30 | 9.30 / 83.30 | 57.10 / 132.20 | 0.00 / 1.00 |
| browser-8 | 4181.75 / 5585.40 | 3.90 / 16.20 | 2.70 / 5.30 | 0.60 / 1.10 | 906.80 / 1104.50 | 51.10 / 55.00 | 5.35 / 33.00 | 90.60 / 216.30 | 0.00 / 1.10 |
| browser-auto | 4644.85 / 5427.00 | 4.15 / 11.60 | 2.70 / 5.40 | 0.60 / 1.20 | 918.65 / 1112.20 | 51.55 / 55.00 | 10.80 / 111.40 | 53.00 / 117.60 | 0.00 / 1.00 |

Raw samples and correctness checks: [collection.camera-cold-samples.json](collection.camera-cold-samples.json).

## collection.camera-warm

Browser hints: 12 logical CPUs, 16 GiB memory. Destination: Chromium OPFS with IndexedDB journal and Web Locks.

| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| browser-1 | 5 | 19.75 / 19.11–20.87 | 1.22 | 1 | 914.3 | 236.0 |
| browser-2 | 5 | 10.19 / 9.77–10.29 | 2.35 | 2 | 1806.0 | 242.1 |
| browser-4 | 5 | 10.06 / 9.66–10.39 | 2.39 | 4 | 2041.1 | 239.9 |
| browser-8 | 5 | 9.83 / 9.50–10.54 | 2.44 | 8 | 2045.6 | 242.1 |
| browser-16 | 0 | Requested 16 exceeds real CPU budget 11 | — | — | — | — |
| browser-auto | 5 | 10.10 / 9.70–10.76 | 2.38 | 7 | 2047.1 | 235.1 |

Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.

| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser-1 | 8776.65 / 9490.30 | 2.40 / 7.40 | 2.50 / 4.90 | 0.40 / 0.90 | 882.25 / 941.00 | 49.70 / 51.70 | 5.55 / 50.40 | — | 0.00 / 1.40 |
| browser-2 | 4361.80 / 5039.60 | 2.50 / 7.20 | 2.50 / 4.90 | 0.40 / 0.90 | 894.70 / 943.20 | 50.75 / 52.40 | 5.90 / 32.10 | — | 0.00 / 1.90 |
| browser-4 | 3929.55 / 5058.20 | 3.65 / 7.70 | 2.60 / 4.80 | 0.40 / 0.80 | 897.50 / 957.60 | 50.90 / 52.10 | 6.10 / 68.50 | 36.75 / 52.60 | 0.00 / 1.70 |
| browser-8 | 4025.30 / 5209.40 | 3.50 / 8.90 | 2.60 / 5.00 | 0.40 / 0.90 | 893.55 / 952.00 | 51.00 / 52.60 | 5.70 / 75.70 | 70.40 / 128.40 | 0.00 / 1.80 |
| browser-auto | 3995.80 / 5257.90 | 3.50 / 7.30 | 2.60 / 5.10 | 0.40 / 1.10 | 898.65 / 948.70 | 50.95 / 52.50 | 6.00 / 100.70 | 35.40 / 71.30 | 0.00 / 2.00 |

Raw samples and correctness checks: [collection.camera-warm-samples.json](collection.camera-warm-samples.json).

## Declared budget outcomes

| Requirement | Observed ratio | Limit | Outcome |
| --- | ---: | ---: | --- |
| TinyImageStar.Engine.renderWithApi.performance | 1.850 | 1.5 | fail |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-1 | 0.292 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-2 | 0.567 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-4 | 1.078 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-8 | 1.706 | 1.1 | fail |
| TinyImageStar.Engine.renderWithApi.collection-small-cold-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-1 | 0.144 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-2 | 0.277 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-4 | 0.534 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-8 | 0.880 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-small-warm-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-1 | 0.552 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-2 | 1.049 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-4 | 1.072 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-8 | 1.083 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-cold-auto-vs-16 | — | 1.1 | not_proven |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-1 | 0.512 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-2 | 0.991 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-4 | 1.004 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-8 | 1.027 | 1.1 | pass |
| TinyImageStar.Engine.renderWithApi.collection-camera-warm-auto-vs-16 | — | 1.1 | not_proven |
