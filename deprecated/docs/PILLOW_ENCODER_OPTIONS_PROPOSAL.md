# Proposed encoder-options contract for deployed Pillow

Prepared 17 September 2026 for migration plan §8A. This is a local proposal;
the deployed package does not implement the proposed API, and no upstream issue
or message has been submitted.

## Problem and verified boundary

Increasing worker count cannot change the cost or compression policy of one
encode. Our [collection measurements](COLLECTION_BENCHMARKS.md) include normal
output validation and durable writes. On the recorded serial small-image run,
PNG output validation alone takes a median 166 ms per image. The separate
materialize/encode interval includes deferred transformations; it cannot identify
how much time an encoder-options feature would save. Output validation stays
enabled in comparative job measurements.

The app deploys `pillow-rs@12.2.0-alpha.1`, with exact JS/WASM hashes and package
integrity in [runtime.json](../wasm/runtime.json). Its attested source revision is
`310788f9fcadc85b02263b383c5a6ea094b000c6`. Inspection of that Git object, rather
than the sibling repository's current checkout, establishes:

- `Image.save()` calls `to_png_bytes()`.
- `Image.saveWithInput(format, extension)` resolves format and calls `encode`.
  The second argument is an extension hint, not JPEG quality.
- PNG and other format encodes call `image_slash_star::encode_default`.
- `toBytesEncoded(encoder_name, args)` is a raw-mode packer. The core rejects
  encoder names other than `raw`; it is not a hidden JPEG/PNG options API.
- The pinned lockfile uses `image-slash-star` 0.1.2, Git revision
  `70190214a0711223302c76ab58e76c097288d80b`. No claim is made here about which
  codec controls a newer version may implement.

Primary source locations: [JS save binding](https://github.com/appunni-m/pillow-rs/blob/310788f9fcadc85b02263b383c5a6ea094b000c6/pillow-rs-js/src/lib.rs#L3830),
[format encoding](https://github.com/appunni-m/pillow-rs/blob/310788f9fcadc85b02263b383c5a6ea094b000c6/pillow-rs/src/image.rs#L3350),
[raw packing](https://github.com/appunni-m/pillow-rs/blob/310788f9fcadc85b02263b383c5a6ea094b000c6/pillow-rs/src/image.rs#L3495),
[PNG encoding](https://github.com/appunni-m/pillow-rs/blob/310788f9fcadc85b02263b383c5a6ea094b000c6/pillow-rs/src/image.rs#L4321),
and [dependency revision](https://github.com/appunni-m/pillow-rs/blob/310788f9fcadc85b02263b383c5a6ea094b000c6/Cargo.lock#L453).

## Requested public behavior

Add a separately named, versioned options entry point to the published browser
binding. Keep existing `save` and `saveWithInput` signatures and default behavior
compatible. A possible API shape, for discussion rather than current usage, is:

```js
image.saveWithOptions({
  schemaVersion: 1,
  format: "PNG",
  png: { effort: "fast" },
});
```

Expose the supported formats, option values/ranges and defaults in an explicit
capability contract. Unsupported options must fail rather than be ignored.
Reject unknown fields, wrong-format options, non-finite numbers, invalid enum
values and unsupported schema versions. Do not guess support from function arity.

| Format | Useful optional controls | Required interpretation |
| --- | --- | --- |
| PNG | Explicit compression-effort presets, and documented filter controls if the codec supports them | Lossless decoded samples and alpha remain unchanged. Effort affects time and bytes; it must not quantize colors, drop alpha or change dimensions. Publish the mapping and its version. |
| JPEG | Quality with documented range/default; chroma subsampling and progressive/optimization controls where implemented | State which settings alter decoded quality, encoding cost or bytes. JPEG quality values are codec-specific and cannot be treated as equivalent to another encoder merely because the numbers match. |

Return a bounded encoded result or a structured error on allocation/format
failure. Preserve deterministic results for the same published engine, inputs
and explicit settings. Document metadata/color handling and alpha requirements;
do not silently flatten transparency to an unspecified color. The application
can continue to supply an explicit background before JPEG encoding.

Do not add an unimplemented quality slider to Tiny Image Star. Presets should
store the selected format/options schema and engine version once this contract
exists. An old recipe retains its original defaults; editing export effort is a
visible user choice. If a restored recipe requires an unsupported option, show a
repairable compatibility error rather than silently changing the export.

## Evidence required before adoption

1. Publish an immutable package with source provenance, codec revision/build
   features, license inventory and option capability data. Upgrade through the
   existing staging/hash checks; do not patch generated WASM locally.
2. Execute input-only cases through the public JS API for every supported option
   and invalid-option family. Include small and photographic RGB/RGBA, text and
   hard edges, transparency, grayscale, difficult dimensions, orientation and
   the declared color/metadata policy. Use independent decoders for file validity
   and decoded comparisons. Preserve existing format/error compatibility cases.
3. For PNG effort variants, compare decoded dimensions, channels and samples
   exactly where the declared mode supports exact preservation. File bytes and
   sizes may differ. For JPEG, compare bytes/latency and predeclared independent
   quality metrics plus representative visual review; equal quality numbers are
   not a quality-matched baseline.
4. Measure a materialized-image encode separately to identify the actual codec
   contribution, then repeat the complete browser job with normal source reads,
   validation, journal commits, output bytes, warm/cold state and resource
   observations. Keep the same source settings and dimensions. Publish both
   latency and file-size/quality changes instead of only a faster wall time.
5. Repeat fixed-concurrency and Auto comparisons through the existing canonical
   manifest and strict result pipeline. Include sustained supported phones,
   cancellation, memory pressure, slow saving, quota failure and retry. Recheck
   reservations when encoder scratch/output requirements change.

This proposal is an additional upstream work item. It does not remove the
cold-start scheduler, heavy-compositor, physical-device, color or release gates
in the [migration plan](../MIGRATION_PLAN.md).
