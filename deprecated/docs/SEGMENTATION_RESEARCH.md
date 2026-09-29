# Automatic subject selection research

Recorded 2026-09-17. This is an executed model spike for
[the migration plan](../MIGRATION_PLAN.md), not an automatic-cutout release.
The production app still uses [manual/imported masks](MASK_EDITING_VERIFICATION.md).
No MediaPipe dependency, model, or telemetry was added to the application bundle.

## Decision and product consequence

Continue evaluating the small portrait model for an explicit **Select person**
action. Keep restore/erase and source-pixel inspection in the same workflow.
Do not label it “select anything,” silently run it on every photo, or make it a
required dependency of all presets. On these probes it has the smallest observed
working set and shortest mask calls, but three images cannot establish quality.

Keep general-object selection as a separate model decision. The newer MagicTouch
v2 API fits a mobile **tap the subject** interaction, but the tested CPU case
needed hundreds of MiB of Wasm memory and seconds per mask call. Its exact
artifact licensing also needs resolution. The larger portrait model did not
justify becoming the default on this tiny sample. These are research decisions,
not rankings across representative photography or real phones.

Bulk recipes must declare their required model revision and supported subject
type. Preflight a sample, preserve per-image corrections, and report unavailable
or poor selections as exceptions. A large collection enters a durable queue;
it must not allocate a model per image or per image-export worker. Start model
qualification with one reusable inference worker admitted by the existing shared
scheduler, reserving model bytes, observed linear memory, decoded inputs, output
masks, graphics resources and retained embeddings. Raise inference concurrency
only after measured throughput and device memory justify it. Existing image
export concurrency evidence does not qualify concurrent inference.

## Exact inputs and provenance

[The input manifest](research/2026-09-17/segmentation/inputs.json) pins every used
SDK file and downloaded asset by byte length and SHA-256, plus the npm tarball's
SHA-512 integrity. The research uses `@mediapipe/tasks-vision` **1.0.1**, without
installing it as an application dependency. Its classic JavaScript bundle,
SIMD loader and SIMD Wasm total **12,235,796 bytes**, before model bytes,
compression, or cache effects. A small model does not mean a small total pack.

| Candidate | Weight bytes | Task and licensing evidence |
| --- | ---: | --- |
| Selfie square, float16/1 | 249,537 | Person confidence mask; official 2021 card identifies Apache-2.0 and describes portrait limitations. [Card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf) |
| Selfie multiclass 256, float32/1 | 16,371,837 | Six classes, including background, hair and clothing; official 2023 card identifies Apache-2.0. [Card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf) |
| MagicTouch interactive v2, int8/1 | 30,525,312 | Stateful object selection from points/strokes; the current guide describes 768×768 int8, while its linked 2023 card describes an older 512×512 model. That card does **not** establish the exact new weights' license. [Current guide](https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter), [linked card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf) |

The SDK package metadata declares Apache-2.0. A fetched upstream v0.10.33 LICENSE
is retained as research reference; it does not establish all notices for SDK
1.0.1 or resolve the v2 weights' identity. Redistribution/license review remains
open. Candidate research also identified the author's
[BiRefNet lite card](https://huggingface.co/ZhengPeng7/BiRefNet_lite), which declares
MIT; it was not downloaded or benchmarked here. The official
[BRIA RMBG-1.4 card](https://huggingface.co/briaai/RMBG-1.4) requires a commercial
agreement for commercial use, so a community conversion's license tag would
not settle that model's suitability.

The three source images are exact scikit-image v0.25.2 assets:

- `astronaut.png`: NASA portrait of Eileen Collins; public domain.
- `chelsea.png`: Chelsea the cat, Stefan van der Walt; CC0.
- `coffee.png`: Rachel Michetti, courtesy Pikolo Espresso Bar; CC0.

[scikit-image's data documentation](https://scikit-image.org/docs/stable/api/skimage.data.html)
and [versioned source documentation](https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/_fetchers.py)
provide these credits. The original bytes, locally generated masks and cutouts
are research fixtures, with no endorsement implied. No private user photos were
used. They have **no ground-truth mattes** and do not represent the required
quality, demographic, lighting or device corpus.

## What the executable probe measures

[The browser harness](../scripts/research/segmentation-bakeoff.mjs) runs one classic
worker at a time, locally serves only pinned assets and blocks external network
requests. Each model/delegate case uses a fresh browser context and five calls
per image. CPU, GPU, explicit non-SIMD and unavailable-WebGL paths are exercised.
The recorded GPU renderer is **SwiftShader**, so these are software-renderer
observations, not hardware acceleration results. Host: macOS arm64; Chromium
151.0.7922.34; Node 24.18.0. The reported browser hardware hints are not a phone
profile or a measured available-memory budget.

The worker validates finite probability ranges and expected channel counts.
Selfie returns one foreground channel. Multiclass returns the observed labels
`background, hair, body-skin, face-skin, clothes, others`; the probe uses
`1 − background`. Interactive inputs use one documented positive point per
image. SDK 1.0.1's declaration file defines `BrushMode.POSITIVE = 1`, but its
classic bundle does not export `BrushMode`. The harness uses the declared
numeric value. Initial failures from the missing enum are retained.

Mask call times include synchronous inference, probability readback, validation
and conversion to an 8-bit mask. `setImageMs` measures the public method call,
not isolated encoder execution; older runs named this field `encodeMs`.
Wasm sizes are observed linear-memory allocations, excluding JS, decoded images,
GPU resources and native process overhead. An observer retains memory references
until the case worker is terminated. `close()` does not shrink those recorded
buffers. Neither metric proves total memory or sustained throughput.

The real pinned Pillow-RS engine converts masks into transparent PNGs after the
timed worker completes. Source alpha is multiplied once by the selected mask.
PNG output is provided for visual inspection, not compared to a nonexistent
ground-truth mask. Main-thread 25 ms timer intervals are recorded separately;
they are a responsiveness probe, not a substitute for interaction or thermal
testing. Localhost model reads do not measure internet download latency.

## Observed output quality

The final run used a separately downloaded minimal cache and the final ten-case
harness. [Raw results](research/2026-09-17/segmentation/runs/segmentation-ed8c59ef-16a8-465e-855f-fda444ebc375/results.json),
[summary](research/2026-09-17/segmentation/runs/segmentation-ed8c59ef-16a8-465e-855f-fda444ebc375/summary.json),
[visual report](research/2026-09-17/segmentation/runs/segmentation-ed8c59ef-16a8-465e-855f-fda444ebc375/review.html)
and [checks](research/2026-09-17/segmentation/runs/segmentation-ed8c59ef-16a8-465e-855f-fda444ebc375/checks.json)
are retained. Nine cases returned three masks each; the forced-no-WebGL CPU case
failed with `activeTexture` unavailable. That is a compatibility failure, not a
passed fallback. Both CSP cases generated masks byte-identical to plain CPU.

| Case | Median mask call, ms | Observed maximum Wasm, MiB |
| --- | ---: | ---: |
| Selfie CPU | 6.5 | 18.2 |
| Selfie CPU, non-SIMD | 14.5 | 18.2 |
| Selfie GPU/SwiftShader | 26.0 | 18.2 |
| Multiclass CPU | 160.2 | 116.1 |
| Multiclass GPU/SwiftShader | 484.1 | 96.8 |
| Interactive v2 CPU | 3,250.1 | 440.8 |
| Interactive v2 GPU/SwiftShader | 426.0 | 377.1 |

Each median pools 15 calls across three small images, including first calls.
Whole-case wall times are separately recorded; for example the interactive GPU
case took 31.0 seconds despite its lower median, so multiplying medians is not a
valid batch estimate. Maximum observed 25 ms main-thread timer intervals were
26.1–27.6 ms. There are no five independent randomized repetitions, hardware-GPU
runs, real-phone runs or representative large images in this qualification.

[The first corrected full comparison](research/2026-09-17/segmentation/runs/segmentation-4f08186c-208d-4aa9-b368-88efd2db1c4a/review.html)
and its [contact sheet](research/2026-09-17/segmentation/runs/segmentation-4f08186c-208d-4aa9-b368-88efd2db1c4a/review.png)
were visually inspected. Selfie keeps the astronaut and helmet together but
leaves some background at the arm. Multiclass leaves background residue near the
upper left and excludes much of the helmet. Interactive selection isolates the
person more selectively. The desired treatment of a held helmet requires user
intent, not an invented quality score.

On the out-of-task cat, Selfie retains substantial background; multiclass erases
part of the head. Interactive selection is closer to the intended subject but
needs edge review. On the coffee, portrait results remove or retain unrelated
parts; the interactive result selects the cup but makes part of its contents
transparent. These visible defects rule out claiming flawless one-tap results.
No fairness, hair-detail or product-edge release gate was passed.

## Network behavior and static hosting

Without CSP, each successful model case attempted a POST to
`https://odml.pa.googleapis.com/v1/log`; the harness aborted it. This is consistent
with the SDK's [June 2026 privacy notice](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md):
input processing stays on device, but performance/utilization metrics are sent.
The research did not audit the full payload or establish a public opt-out API.

Two additional CPU probes succeeded while **enforced** `connect-src 'self'`
blocked that endpoint and the external route saw zero requests:

- [A CSP response header on the worker](research/2026-09-17/segmentation/runs/segmentation-d2768cae-2aeb-470f-8abb-4674a5d4575f/results.json).
- [An early document CSP meta tag inherited by a blob worker](research/2026-09-17/segmentation/runs/segmentation-678fa5b7-fd43-4fb1-8f17-12765d864430/results.json), importing the local worker and SDK.

The second approach is relevant to this repository's static Pages artifact,
whose current build does not configure worker response headers. This is a
Chromium feasibility result only. Production adoption must verify the exact
packaged app, subpath URLs, fonts, saves, Safari/Firefox behavior, offline/cache
updates, worker lifecycle and all network destinations. Blocking a metric does
not by itself complete the privacy or license review. A document meta CSP alone
must not be assumed to constrain an ordinary externally loaded worker.

## Reproduce and inspect

```sh
node scripts/research/segmentation-fetch.mjs
node scripts/research/segmentation-fetch.mjs --check
node scripts/research/segmentation-bakeoff.mjs
node scripts/research/segmentation-report.mjs docs/research/2026-09-17/segmentation/runs/RUN_ID --screenshot
```

The downloader uses bounded HTTPS responses with no redirects, validates hashes
before saving, validates SDK tarball integrity, and reads only explicit archive
members to stdout. It runs no npm lifecycle scripts and fails instead of
overwriting mismatched cached data. `--check` is offline. An independent fetch
into `/tmp/tinystar-segmentation-reproduced` verified all **8 SDK files and 10
assets**. `--cache=PATH` chooses the download/check directory;
`TINY_IMAGE_STAR_SEGMENT_CACHE=PATH` chooses the harness cache.
A separate deliberately modified SDK file was rejected by the offline checker
before download; the valid caches were unaffected.

Use `TINY_IMAGE_STAR_SEGMENT_CASES=selfie-CPU` for a named subset. The default
matrix contains ten cases, including the two CSP modes. A case failure is
recorded in JSON and does not make the process exit nonzero; inspect every case.
An intentional unavailable-WebGL case currently fails. Report generation rejects
unfinished runs. Later runs retain input manifests and exact harness/worker
source copies with hashes; the first exploratory runs predate source snapshots.

## Before an automatic-selection release

1. Resolve exact weight/SDK notices and model identity; complete app licensing.
2. Select a task-specific candidate against rights-cleared representative photos
   and human-reviewed masks: hair, skin tones, glasses, fingers, dark/light
   backgrounds, low light, multiple people, pets and products as applicable.
3. Define acceptance and exception thresholds from that review; preserve manual
   repair, cancel/undo and a normal-layout fallback. Do not equate confidence with
   a clean edge.
4. Integrate explicit pack download/eviction/version pinning and shared resource
   admission. Test stale selection results, worker termination, mask history,
   storage failures and cross-tab competition.
5. Qualify real iOS/Android devices, supported browsers, GPU loss, no-WebGL
   fallback, full retained-memory accounting and sustained mixed export/inference.
6. Prove production network policy and offline behavior on the hosted artifact;
   rerun the preset, bulk, quality and complete release gates in the migration plan.

The user study, physical-device matrix, pilot and release-owner signoff remain
required. This spike does not narrow or complete the full migration objective.
