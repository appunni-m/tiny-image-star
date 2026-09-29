# Pillow integration issues

Updated 20 September 2026 for the pinned `pillow-rs@12.2.0-alpha.1` application
integration. These are application boundaries and requests, not assertions
about upstream priorities or a newer checkout. The runtime's source revision
and file hashes are recorded in [runtime.json](wasm/runtime.json).

## Resolved for this application

| Earlier blocker | Current evidence |
| --- | --- |
| The browser binding exposes PNG-only `save()` | The deployed package exposes `saveWithInput(format, extension)`. The app integrates PNG and fixed-setting JPEG with real output validation and packaged-browser tests. |
| Local binding/core drift prevents a usable build | App packaging stages the immutable npm package. It does not use or modify that local checkout, a relative font checkout, or a partial rebuild. This resolves the app dependency, not every upstream source-build concern. |
| Package name and generated-file availability are unclear | The lockfile pins `pillow-rs` exactly. Staging resolves its exported package metadata and verifies the generated pair from that installed package. |
| Generated artifact provenance was not recorded | Source revision, registry integrity, provenance URL and file hashes are now recorded. Cryptographic registry provenance verification is a separate configured CI gate; stored metadata alone is not proof it passed. |

See [engine decision](ENGINE_EVALUATION.md), [adapter](src/engine/pillow.js),
[runtime staging](scripts/stage-pillow-runtime.mjs) and
[verification matrix](VERIFICATION_MATRIX.md).

## Open: encoder controls and measured cost

`saveWithInput(format, extension)` has no quality/compression argument.
`toBytesEncoded()` packs raw pixels; it is not an alternative container encoder.
The app must retain truthful fixed-setting output controls until a separately
published options API is implemented and verified.

[The encoder-options proposal](docs/PILLOW_ENCODER_OPTIONS_PROPOSAL.md) defines
requested capabilities, option validation, compatibility and speed/quality
evidence. The [canonical collection matrix](docs/COLLECTION_BENCHMARKS.md)
measures real jobs with normal output validation and journaled writes. Its
materialize/encode interval includes deferred transforms; it must not be called
isolated PNG encoding. Do not generalize the earlier unpinned artifact's timing
percentages to this package.

## Open: source memory, streaming and cancellation

The public binding accepts complete encoded input and returns a complete
encoded result. Its current preview path can materialize the full source.
Bounded file queues do not remove that per-image peak. A reduced-decode or
incremental codec API would require an explicit published contract and tests
for limits, color/orientation, cancellation and ownership of returned buffers.

Current application cancellation terminates active workers to interrupt
synchronous WASM, cancels queued intent before preparation, and rejects stale
responses. This implements cancellation without promising resumable execution
inside one encode. The shared scheduler retains output/write reservations and
uncancellable preparation credits until they actually settle.

## Open: format, camera and color qualification

- **AVIF:** unavailable in the executed pinned-package probe. It is not an
  enabled app input/output. A future package needs independent app-level codec
  and device qualification before enabling it.
- **HEIC/HEIF:** no app integration. [Native adapter research](docs/HEIC_IMPORT_RESEARCH.md)
  distinguishes tested WebKit decoding from Chromium rejection and identifies
  fallback, licensing, physical-picker and color/orientation work.
- **Animation and metadata:** no preservation promise. Verify the declared
  still-image, orientation, color and metadata-stripping behavior independently;
  do not infer it from a format being accepted or a method existing.
- **Optional models:** segmentation is a separate dependency with its own
  [quality/license/device gates](docs/SEGMENTATION_RESEARCH.md), not a Pillow
  transformation or a feature enabled by more workers.

## Historical evidence

The [2 August integration investigation](docs/research/2026-08-02/pillow-integration-history.md)
preserves the old rebuild errors and folder profile. It concerns an earlier
artifact without complete provenance. No sibling repository was changed by
the current migration, and those old errors do not justify disabling the
generic encoder now deployed in this application.
