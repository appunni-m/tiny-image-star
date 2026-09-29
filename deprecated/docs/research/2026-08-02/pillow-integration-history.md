> Historical note preserved on 20 September 2026. This describes the earlier
> unpinned artifact and local-build investigation, not the currently integrated
> published package. Relative links below retain their original root context.
> Current status: [engine evaluation](../../../ENGINE_EVALUATION.md) and
> [integration issues](../../../PILLOW_RS_ISSUES.md).

# pillow-rs integration issues

This file records dependency issues discovered while scoping Tiny Image Star.
The pillow-rs checkout is intentionally not modified here.

Status values describe the app integration state, not a claim about upstream
priority.

## P1 — PNG encoding dominates large-folder throughput

Tiny Image Star profiled the checked-in browser artifact against 64 evenly
distributed samples from an 8,192-file, 1.381 GB PNG folder. The files averaged
168.6 KB and ranged from 119 × 75 to 833 × 615 pixels.

- source reads averaged 0.95 ms per image;
- initial `Image.open` averaged 0.02 ms;
- `Image::save()` PNG encoding averaged 107.96 ms (p95 255.18 ms);
- reopening the output for signature/dimension verification averaged 0.02 ms;
- writing the encoded output averaged 1.92 ms; and
- PNG encoding accounted for 97.4% of the measured direct pipeline time.

The artifact has no `.debug*` custom sections. The upstream workspace release
profile uses `opt-level = 3`, LTO, one codegen unit, and `panic = "abort"`, so
the result does not look like an accidental debug-build slowdown.

The browser binding currently exposes only the zero-argument PNG `save()`
path. A verified PNG speed/compression choice (for example fast, balanced, and
smallest output) would let high-volume browser jobs trade a modest size increase
for materially lower CPU time. This needs an upstream binding/API and benchmark;
Tiny Image Star does not change pillow-rs here.

## Latest local rebuild attempt (2026-08-02)

The user's current checkout is at commit `5fdf6db8` (`Cover merge band-count
and composite mode paths`). It has four pre-existing user modifications at the
time of this check; Tiny Image Star did not edit that checkout. A fresh build
was run from `pillow-rs-js` with its Cargo target and generated output
redirected to isolated temporary directories:

```text
target_dir=$(mktemp -d /private/tmp/tiny-image-star-pillow-target.XXXXXX)
pkg_dir=$(mktemp -d /private/tmp/tiny-image-star-pillow-pkg.XXXXXX)
CARGO_TARGET_DIR="$target_dir" wasm-pack build --target web \
  --out-dir "$pkg_dir" \
  --no-default-features --features wasm-all
```

Compilation reaches the binding crate but is still blocked by existing API
drift between the binding and the core crate. The frontend did not copy or use
a partial artifact, and this app does not edit that checkout. The reported
compile mismatches are:

- pre-existing local changes are present in
  `tests/fixtures/inputs/coverage/pil-image-image.json`,
  `tests/fixtures/inputs/parity/pil-image-image.json`,
  `scripts/build_migration_parity_inputs.py`, and
  `tests/test_migration_parity_evidence.py`;

- `quantize` now requires five arguments, while the binding supplies four;
- `reduce` now requires two arguments, while the binding supplies one;
- `imageops_colorize` now requires seven arguments, while the binding supplies
  three; and
- `getcolor` has a changed signature/type contract.

The checked-in/generated package also still exposes only the zero-argument
PNG `save()` path. The core crate has `Image::encode(format)`, but the JS
binding does not expose that container encoder; its `toBytesEncoded()` method
is raw pixel-byte encoding and cannot be used as JPEG/WebP/TIFF/AVIF output.
Until the binding build is repaired and real container bytes pass the app
fixture checks, the UI keeps PNG as the only output and keeps the lossy toggle
hidden.

## P0 — blocks the complete format contract

### AVIF is not enabled by the published WASM feature set

Evidence:

- `pillow-rs/Cargo.toml` defines `image-avif`.
- `pillow-rs-js/Cargo.toml` enables PNG and the other extra codecs, but its
  `wasm-extra` feature does not enable `pillow-rs/image-avif`.
- The codec capability table marks WASM AVIF still decode as restricted and
  WASM AVIF encode and sequence operations as unavailable.

Impact: the app cannot currently promise AVIF input and output through the
normal WASM package. The codec layer describes WASM AVIF still decode as a
restricted portable subset and marks still encode unavailable on WASM.

### The WASM binding does not expose the core generic encoder

Evidence:

- `pillow-rs/src/image.rs` provides `Image::encode(format)`.
- `pillow-rs-js/src/lib.rs` exposes `Image::save()`, which always calls
  `to_png_bytes()`.
- `Image::toBytesEncoded()` delegates to raw pixel-byte encoding and is not a
  JPEG, WebP, TIFF, ICO, or AVIF container encoder.

Impact: format-selectable output cannot be implemented through the current
binding, even where the core codec supports the target format.

### Realtime full-resolution output has no progress/cancellation binding

Evidence:

- The browser binding exposes synchronous image operations returning JS values.
- The app needs to process revisions from a worker and supersede obsolete
  slider jobs without allowing stale results to win.
- The core codec layer has cancellation-oriented APIs, but the current JS
  binding does not expose a cancellation token or progress callback.

Impact: the app can isolate work in a Worker and discard stale responses, but
it cannot guarantee that an already-running WASM operation stops promptly.
This must be treated as a performance limitation until a cancellable binding
surface is available.

### The browser binding has no incremental decode/encode stream

Evidence:

- `Image.open` accepts a complete `Uint8Array` rather than an incremental
  reader.
- The currently exposed `save()` returns one complete encoded `Uint8Array`.
- There is no binding that accepts a browser `ReadableStream` or writes encoded
  chunks to a callback/stream as they become available.

Impact: Tiny Image Star can keep a 100,000-file collection bounded by reading,
processing, and writing only a few files at a time. It writes each encoded
result to `FileSystemWritableFileStream` in chunks and releases it immediately,
but every active worker still holds one complete source, decoded image, and
encoded result. True incremental codec streaming—and lower peak memory for a
single enormous image—requires a new upstream binding surface. The app does
not claim that file-count scalability removes the per-image memory limit.

## P1 — blocks reproducible app packaging

### Package identity and documentation disagree

The README documents `@pillow-rs/wasm`, while the current
`pillow-rs-js/package.json` identifies the package as `pillow-rs` and exports
core/extra paths under that package. The app needs one stable package name and
import contract.

### The source build depends on an external relative `fontdone` checkout

The core manifest references `fontdone` through a relative path outside the
pillow-rs repository. A clean GitHub Pages build cannot assume that sibling
checkout exists. The release path must either publish a built npm artifact or
make all source dependencies reproducibly available in CI.

### Generated WASM package files are ignored

`pillow-rs-js/.gitignore` ignores `pkg/`, even though the generated package is
what the frontend consumes. This is workable only if CI builds the package or a
registry release contains the generated artifacts.

## P2 — contract/documentation debt

### Initialization and `Image.open` usage are easy to misunderstand

The generated API has an asynchronous default WASM initializer, while
`Image.open(Uint8Array)` itself is synchronous after initialization. The app
adapter should own initialization and expose a single `ready()` boundary.

### Animation and metadata are not complete browser contracts

The binding currently exposes placeholder behavior for child-image iteration
and EXIF/XMP access. The app must not claim animation preservation or metadata
preservation until those paths are verified.
