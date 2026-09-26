# HEIC import: dependency review and executable spike scope

Reviewed 17 September 2026 against migration-plan sections 8–9. This is a
source-backed dependency review with a small native capability spike, not a
passed HEIC implementation or phone gate.
No decoder has been added to the application or its package lock.

## Current application boundary

The engine adapter's input list in [pillow.js](../src/engine/pillow.js) does not
include HEIC. [Story import](../src/story/assets.js) accepts PNG, JPEG and WebP
signatures before Pillow inspection. A browser's ability to display HEIC does
not make either path accept it. Adding a filename extension or picker MIME type
alone would leave this gap unresolved.

The existing story import path admits reads through the shared scheduler, hashes
original bytes and records upright dimensions. A new decoder must preserve those
properties and account for its own native/Wasm allocations. It must also work
with ordinary image editing, folder jobs, persistent assets and recovery.

## Evidence that changes the dependency choice

| Finding | Consequence |
| --- | --- |
| WebKit introduced HEIC images in Safari 17 and describes browser photo editing as a use case. [WebKit announcement](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/) | Test native decoding on supported Apple devices first. This announcement does not establish worker decoding, canvas readback, memory bounds or the app's export quality. |
| The inspected `libheif-js` package source declares version 1.23.2 and LGPL-3.0; its install script selects the v1.23.2 Emscripten release. [Package](https://raw.githubusercontent.com/catdad-experiments/libheif-js/master/package.json), [install script](https://raw.githubusercontent.com/catdad-experiments/libheif-js/master/scripts/install.js) | Do not equate an npm package version with the latest upstream library. These moving source links are review observations; no exact package binary has been qualified. |
| That Emscripten release identifies its included libheif as v1.23.2. [Build release](https://github.com/catdad-experiments/libheif-emscripten/releases/tag/v1.23.2) | The wrapper's own build provenance confirms which upstream release it contains. |
| Upstream v1.23.4, released 6 September, documents newer parser, recursion, concurrent tile-decode and Emscripten fixes. [Release](https://github.com/strukturag/libheif/releases/tag/v1.23.4) | Do not qualify the inspected older bundle for production. A fallback needs a pinned build with the applicable fixes, enabled-codec review and current advisory check. This is not a claim that every advisory applies to every build. |
| The upstream library uses LGPL terms; sample applications use MIT. [Pinned COPYING](https://raw.githubusercontent.com/strukturag/libheif/v1.23.4/COPYING) | The sample application's license does not cover the decoder. A distributed decoder needs its own source/build/license inventory and redistribution review before release. |
| WebKit fixed a picker-transcoding issue involving mixed wildcard/explicit accept types in January 2026. [Resolved issue](https://bugs.webkit.org/show_bug.cgi?id=303803) | Test actual Photos and Files results on each supported OS/browser. The commit does not prove the fix shipped in every supported Safari version. |

The inspected [v1.23.4 JavaScript wrapper](https://raw.githubusercontent.com/strukturag/libheif/v1.23.4/post.js)
returns multiple image handles, exposes primary-image identification and image
handle release, and copies decoded RGBA into caller storage. A wrapper around its
sample's first-array-element selection would need a deliberate multi-image policy.
The high-level decoder also owns a context: cleanup must cover handles, context,
decoded arrays and workers, including errors. These observations do not establish
the memory behavior of an untested compiled bundle.

## Proposed integration direction

Use qualified native decode where available and investigate a patched, optional
local Wasm fallback for unsupported browsers. Keep Pillow as the editor/compositor
engine. This is a recommendation to test, not permission to advertise universal
HEIC support or a decision to omit the fallback qualification.

Normalize the selected still image to an explicitly defined upright sRGB working
asset while retaining the original and conversion identity. Persist that asset
so later edits and recovery do not silently use a different browser conversion.
Compare direct RGBA handoff with lossless PNG normalization; include conversion,
storage and later decode costs. Do not insert a lossy JPEG intermediate or silently
reduce export resolution. Treat HDR/gain maps and unsupported multi-image contents
according to a visible, tested policy; never imply they were preserved by an
8-bit working asset.

`createImageBitmap` exposes orientation, alpha, color-conversion and resize
options, but availability of the API does not certify a particular image codec
or a reduced-memory decode. Its default color conversion is implementation
dependent. Test the requested path, including worker/main-thread differences.
[API contract](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap),
[HTML standard](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap)

Do not assume that requesting a small bitmap avoids full source allocation.
Reserve the source/decode/conversion/output overlap before reading; charge native
decoded surfaces separately from Wasm heap. Twelve million RGBA pixels alone
occupy about 45.8 MiB per copy, before decoder state, canvases and encoded bytes.
Oversized or unqualified input must produce a clear local conversion/reimport
path. There is no silent upload fallback.

## Spike execution and completion evidence

1. Generate first-party asymmetric color/alpha fixtures, plus malformed/truncated
   containers and large-dimension metadata cases. Record preparation, dimensions,
   hashes and encoding environment. This Mac reports HEIC encoding through
   `/usr/bin/sips --formats`; that is a fixture-generation capability observation,
   not a browser decode result. The subsequent tiny-fixture execution is recorded
   below; a representative camera corpus remains required.
2. Add attributable real Photos/Files samples: rotations/mirrors, portrait/depth,
   multiple images, 10-bit/HDR, Display-P3 and panorama tails. Do not silently
   treat a JPEG transcoded by the picker as proof of HEIC decoding.
3. Test actual decode, canvas readback, normalized pixels, orientation applied
   once, alpha, color policy, metadata removal, output decode and recovery. Use an
   independent reference with declared lossy/color tolerances; do not generate
   expectations from the implementation under test.
4. Exercise bounded reads, cancellation/timeout, malformed input, quota failures,
   repeated cleanup and shared admission with editing/export. Keep parser limits
   enabled. Check cold-cache networking and ensure only pinned local assets load.
5. Measure full six-photo preview/export and sustained collections on the declared
   physical iOS/Android matrix. Record process/native memory where available and
   keep it distinct from Wasm linear memory. Chromium-only automation cannot
   qualify Safari's native image decoder or real photo pickers.

The [executed native capability spike](research/2026-09-17/heic-native-spike/README.md)
generated two first-party 256 × 192 HEIC inputs and ran them in Chromium and an
installed Playwright WebKit 26.5 build. WebKit decoded both through image elements,
bitmaps and workers with correct dimensions and unchanged alpha; Chromium
rejected all three paths. RGB differences from the original PNGs are recorded,
including a maximum difference of 28 for the alpha fixture. No quality threshold
or independent decoder comparison was established. Both browsers made no
external requests during the probe.

This establishes a candidate worker decode path for further integration work,
not a finished HEIC adapter. Native camera/color/memory tests, the fallback
artifact, license review and physical-device results remain open. The broader
[migration execution ledger](MIGRATION_STATUS.md) retains those release gates.
