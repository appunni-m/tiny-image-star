# Image engine decision

Updated 20 September 2026. Tiny Image Star currently integrates the published
`pillow-rs@12.2.0-alpha.1` JavaScript/WASM package. The app pins its version,
lockfile integrity, source revision and paired file hashes; it does not build
from a sibling Rust checkout. See [runtime identity](wasm/runtime.json) and
[staging implementation](scripts/stage-pillow-runtime.mjs).

## Verified application boundary

The [app-owned adapter](src/engine/pillow.js) initializes Pillow inside admitted
workers, discovers qualified capabilities and renders actual output bytes. It
uses `saveWithInput(format, null)` for PNG and fixed-setting JPEG. The second
argument is an extension hint. JPEG alpha handling uses an explicit background;
an unavailable output format or adjustable-quality request fails rather than
silently becoming PNG.

Source and packaged Chromium suites exercise real decodes, edits, text and
scene composition, output signatures/dimensions, independent browser decoding,
multi-worker equality and recovery. The separate [migration slice](docs/ENGINE_PARITY_SCOPE.md)
compares 33 workflows with an independently executed frozen adapter. This is
evidence for the declared application slice, not all upstream Pillow APIs or
all input files and browser/device combinations.

The adapter advertises JPEG, PNG, GIF, BMP, WebP, TIFF and ICO inputs. Tiny input
fixtures do not establish every variant, animation, profile or metadata case.
Release outputs remain PNG and JPEG. Other encoders observed in the package
probe are not thereby qualified app features. AVIF is unavailable in the pinned
package's executed codec probe; HEIC is not in the app's input list.

Browser Canvas/OffscreenCanvas handles text rasterization, masks and shared
composition where implemented. Pillow remains the final output encoder.
Preview and export use the same app-owned scene/operation contracts and explicit
scale rules; a screen capture is not the export implementation.

## Constraints that still affect the product

- The published save contract has no quality or compression-effort options.
  [The options proposal](docs/PILLOW_ENCODER_OPTIONS_PROPOSAL.md) requests a
  separately versioned API and paired performance/quality evidence.
- Full source buffers and decoded images can coexist with output buffers.
  Reducing preview dimensions does not make the current source decode bounded
  to thumbnail memory. Admission limits and working-copy work remain necessary.
- Synchronous WASM cannot receive an in-operation cancellation message. The
  scheduler terminates an active worker for cancellation, then recreates it as
  needed; queued work is cancellable before reading source bytes.
- [HEIC native decoding research](docs/HEIC_IMPORT_RESEARCH.md) has separate
  Chromium/WebKit observations. No HEIC decoder or fallback has been integrated.
- sRGB/profile conversion, HDR exclusions, EXIF normalization, physical phone
  behavior, complete memory accounting and advertised-scale performance remain
  release gates. Current concurrency evidence is in
  [Collection benchmarks](docs/COLLECTION_BENCHMARKS.md).

The architecture still uses a static local-processing app. Pillow does not
provide an automatic segmentation or generative-image model. Optional inference
needs its own qualified assets, licenses, resource admission and quality tests.

## Upgrade decision

Keep the published package behind the existing adapter. Adopt a new immutable
package only after verifying its provenance, paired bytes, public capabilities,
error behavior, independent decode checks, parity, packaged browser behavior
and representative benchmark results. [Release instructions](RELEASING.md)
describe the repository commands and open operational gates.

Revisit the engine boundary for qualified encoder controls, reduced source
decoding, streaming, AVIF/HEIC support or a measured operation bottleneck. Never
infer a browser capability from the Rust core alone, patch generated WASM, or
edit the upstream checkout as part of an application upgrade.

The [earlier evaluation](docs/research/2026-08-02/engine-evaluation-history.md)
is preserved as history. Its missing-generic-encoder conclusion does not apply
to the package now integrated here.
