> Historical note preserved on 20 September 2026. This describes the earlier
> unpinned artifact and local-build investigation, not the currently integrated
> published package. Relative links below retain their original root context.
> Current status: [engine evaluation](../../../ENGINE_EVALUATION.md) and
> [integration issues](../../../PILLOW_RS_ISSUES.md).

# Image engine evaluation

This note records the current app-owned decision boundary. It is intentionally
separate from the public flow: users should experience a private, offline
image tool without needing to know which implementation is underneath.

## Candidates

### pillow-rs JavaScript/WASM package

The generated package already provides the operations needed for the first
vertical slice: open an image, resize, crop, convert, and apply brightness or
contrast adjustments. A generated browser artifact was exercised locally with
WebP input and PNG output.

It is not yet a complete release engine for the product contract. The current
`extra` package accepts the enabled input formats, but its exposed `Image.save`
path produces PNG only. The generic container encoder in the Rust layer is not
exposed through the JavaScript binding, and AVIF is not enabled in the current
WASM feature set. Those limits are tracked in
[`PILLOW_RS_ISSUES.md`](../../../PILLOW_RS_ISSUES.md).

### image-slash-star codec layer

The codec layer is the strongest candidate for a format capability contract:
its source capability table covers JPEG, PNG, GIF, BMP, WebP, TIFF, ICO, and
AVIF. It is not by itself an image-processing/editor API, so it cannot replace
the transform engine without an app-owned wrapper. Its current WASM AVIF
support is also restricted for still decode and unavailable for still encode;
AVIF therefore remains a release gate rather than a UI promise.

### Browser Canvas APIs

Canvas or OffscreenCanvas can provide a useful emergency preview path for
common browser-readable images. It cannot define Tiny Image Star's all-format
export contract because browser support for TIFF, ICO, and AVIF output is not
uniform. It must remain a preview fallback, not the source of truth for saved
files.

## Decision

Keep the frontend behind an app-owned `ImageEngine` adapter with three narrow
responsibilities:

```text
inspect(bytes)
render(bytes, operations, outputSettings)
capabilities()
```

Use the existing pillow-rs generated artifact for the first useful browser
slice, with processing isolated in a worker and output formats disabled until
their encode/download fixture tests pass. If the complete format contract,
especially AVIF, is required for launch, resolve the upstream binding/feature
gates or put a separate app-owned WASM facade behind the adapter. Never patch
the pillow-rs checkout from this application.

## Revisit triggers

Re-evaluate the adapter when one of these becomes true:

- generic output encoding is exposed and reproducibly packaged;
- AVIF still decode and encode pass in a browser fixture matrix;
- a batch benchmark shows the current transform path cannot meet the
  responsiveness target;
- preview and export need separate quality settings or streaming cancellation.
