# Scene materialization and source lifetime

Recorded 2026-09-17. This advances the scene/concurrency work in migration §7,
§8 and §8A. It does not close the camera-import, memory or throughput gates.

## Finding and change

The published Pillow binding represents many transforms as lazy pipelines.
The scene renderer previously reused a transformed image through channel
extraction, alpha multiplication, alpha replacement and composition without
explicitly loading it. Native traces showed the expensive transform chain
executing again at these boundaries. Freeing its earlier JavaScript handle
did not detach a viewport pipeline from its source-sized dependencies.

The renderer now uses the pinned binding's `load()` at three reuse points:

- The adjusted source before a depth photo branches into original/subject views.
- The transformed photo viewport before clipping and alpha operations.
- The transformed subject viewport before depth/finish composition.

These calls materialize the same operations in the same order. There is no
source downsampling, changed crop/mask coordinate system, altered appearance,
new runtime, or relaxed admission budget. The native objects still follow the
existing success/error cleanup paths. The production renderer matches the
measured candidate after comments and whitespace are normalized with esbuild.

An earlier hypothesis about unsafe full decoding during inspection was rejected.
At the pinned source revision
`310788f9fcadc85b02263b383c5a6ea094b000c6`, `Image::open_bytes` creates a lazy
`Image::Bytes`, and `size()` returns its encoded metadata. The probe observed
zero inspection heap growth for the PNG and 3 MP JPEG cases, and 0.5 MiB for the
12 MP JPEG cases, consistent with encoded-byte storage rather than full pixels.
The import inspection path was left unchanged.

## Reproducible experiment

[Probe runner](../scripts/research/scene-memory-probe.mjs) and
[worker instrumentation](../scripts/research/scene-memory-worker.js) use
deterministically generated 2000×1500 and 4000×3000 inputs. Each size has an
RGBA PNG, RGB JPEG and soft grayscale subject mask. The scene is 1080×1920 with
color adjustments, rotation, frame clipping and, where selected, a default
outline/shadow or depth title. Sources, masks, served renderer variants and
output PNGs are retained with hashes.

Each case runs sequentially in a fresh Chromium worker. The probe records
published binding calls, elapsed times and Wasm linear-memory growth. A 1 GiB
research admission envelope and a 120-second per-case timeout bound execution.
This desktop diagnostic envelope is separate from the app's 512 MiB fallback.
External requests are blocked and recorded; neither successful run observed
any. The environment was Darwin arm64 24.6.0, Node 24.18.0 and Chromium
151.0.7922.34.

The [initial probe](research/2026-09-17/scene-memory/scene-memory-11081b33-51c9-4803-8f9b-18634db54a38/result.json)
retains eight successful cases and four rejected depth fixtures. Those fixtures
omitted the required width-relative text sizing field. Correcting the fixture
produced the complete comparisons below; no product validation was weakened.

### Viewport materialization

The [24-case paired run](research/2026-09-17/scene-memory/scene-memory-823c59a2-377a-410b-a80b-f0c162876736/result.json)
compares the original renderer with loaded photo/subject viewports. All twelve
pairs have identical encoded PNG SHA-256 values.

| Input / scene | Traced ms: original → viewport | Wasm MiB: original → viewport |
| --- | ---: | ---: |
| 3 MP PNG, cutout | 5,358 → 2,273 | 126.7 → 104.4 |
| 3 MP PNG, finish | 7,285 → 2,776 | 111.1 → 114.9 |
| 3 MP PNG, depth + finish | 12,918 → 4,364 | 128.6 → 109.5 |
| 3 MP JPEG, cutout | 4,901 → 2,224 | 118.7 → 111.6 |
| 3 MP JPEG, finish | 6,710 → 2,654 | 102.1 → 110.3 |
| 3 MP JPEG, depth + finish | 11,721 → 3,987 | 118.3 → 117.0 |
| 12 MP PNG, cutout | 6,575 → 3,123 | 275.9 → 275.9 |
| 12 MP PNG, finish | 8,708 → 3,663 | 321.8 → 275.9 |
| 12 MP PNG, depth + finish | 14,951 → 5,617 | 367.6 → 367.6 |
| 12 MP JPEG, cutout | 5,972 → 2,957 | 262.8 → 239.8 |
| 12 MP JPEG, finish | 7,963 → 3,423 | 297.1 → 239.8 |
| 12 MP JPEG, depth + finish | 13,347 → 5,160 | 365.8 → 319.9 |

### Shared depth-source materialization

The [eight-case follow-up](research/2026-09-17/scene-memory/scene-memory-3d1c2922-94c5-400b-8d42-10beaec9651f/result.json)
adds loading the adjusted source before the two depth branches. All four pairs
retain identical PNG hashes. This is the complete candidate applied to the app.

| Input | Traced ms: viewport only → complete change | Wasm MiB: viewport only → complete change |
| --- | ---: | ---: |
| 3 MP PNG | 4,388 → 4,215 | 109.5 → 117.1 |
| 3 MP JPEG | 4,005 → 3,880 | 117.0 → 106.8 |
| 12 MP PNG | 5,775 → 5,258 | 367.6 → 275.9 |
| 12 MP JPEG | 5,388 → 4,840 | 319.9 → 228.3 |

The memory result is mixed: some 3 MP cases increase. The larger depth cases
benefit from releasing the shared source pipeline. No global memory-reduction
percentage is claimed.

Reproduce either experiment from the repository root using the retained
pre-change source (the current renderer already contains the optimization):

```sh
node scripts/research/scene-memory-probe.mjs --baseline docs/research/2026-09-17/scene-memory/scene-memory-823c59a2-377a-410b-a80b-f0c162876736/scene-baseline.js
node scripts/research/scene-memory-probe.mjs --depth-fork --baseline docs/research/2026-09-17/scene-memory/scene-memory-823c59a2-377a-410b-a80b-f0c162876736/scene-baseline.js
```

Each invocation creates a new run directory, preserves failures, checks source
hashes for changes during execution, and rejects unequal output bytes. Research
scripts and artifacts are excluded from the allowlisted Pages build.

## Regression and remaining gates

The deterministic checks pass (13 scheduler plus 90 model/style/recovery tests).
Adapter comparisons remain 33/33 in run
`parity-88c7f519-c6d4-4eeb-819a-36bb0934b036`. The 179-file Pages artifact builds
with the published WASM unchanged. The complete source and packaged Chromium
suites both exited successfully. They retain connected-seam and depth pixel
checks, 1/2/4/8-worker correctness in the relevant workflows, mobile editing,
styles, recovery, undo/cancel and actual exports. The folder-recovery suite also
passes real IndexedDB/OPFS/Web Locks checks, 24 concurrent claims and journaled
writes, owner-tab closure, terminated writers, changed-source/output protection
and retry fencing.

The [final verification record](research/2026-09-17/scene-memory/verification/result.json)
retains nine hashed logs, 157 source/test input hashes, 179 packaged file hashes
and references to all three research runs. The recorder verified the retained
fixture/output bytes, paired PNG equality and the production/candidate match.
App JavaScript totals 462,287 minified bytes (150,873 Brotli); CSS totals
62,679/9,837 bytes. Published WASM remains 4,548,741/1,170,855 bytes. These are
artifact sizes, not measured transfer times. Documentation checks cover 42
Markdown files; `git diff --check` and research-script syntax checks pass.

These are instrumented, sequential, synthetic diagnostics on one desktop,
with a fixed comparison order and one sample per case. Wasm linear-memory size
is not live allocations, process RSS, JavaScript/GPU memory or physical-phone
capacity. The timing ratios do not satisfy the plan's randomized, five-run,
representative-corpus throughput gate or the desktop 2× target. The earlier
failed small-fixture latency budget remains recorded separately.

The [calculated 12 MP camera-source admission limit](CUTOUT_EFFECTS_VERIFICATION.md)
also remains: policy coefficients have not been reduced to fit these samples.
Bounded working copies/decode, complete retained-memory accounting, real camera
imports, sustained physical-phone processing and full bulk recipe qualification
are still required. No production-readiness percentage or deployment is claimed.
