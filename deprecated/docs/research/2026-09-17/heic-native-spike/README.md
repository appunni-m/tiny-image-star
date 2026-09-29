# Native HEIC capability spike

Executed 17 September 2026 on macOS 15.7.7 arm64, with Playwright 1.62.1,
Chromium 151.0.7922.34 and Playwright WebKit 26.5 (build 2336). This is a small
capability observation, not an application integration or supported-phone gate.

## Inputs and reproduction

[prepare.py](prepare.py) creates two asymmetric 256 × 192 RGBA patterns with
CPython Pillow 11.3.0 and encodes them through macOS `sips-316`. They contain no
external photographs, fonts or image assets. One is opaque; the other has an
alpha ramp. The HEIC files are 568 and 957 bytes respectively.
[inputs.json](inputs.json) records source/candidate hashes, dimensions, generator
versions and encoder results. These tiny patterns are not a camera corpus.

From the repository root, with the locked dependencies installed:

```sh
python3 docs/research/2026-09-17/heic-native-spike/prepare.py
node node_modules/playwright/cli.js install webkit
node docs/research/2026-09-17/heic-native-spike/probe.mjs chromium
node docs/research/2026-09-17/heic-native-spike/probe.mjs webkit
```

The preparation command may require access to macOS image services. The initial
sandboxed encoder attempts failed with IOSurface errors; their
[inventory](inputs-sandbox-failed.json) and [log](prepare-sandbox.log) are retained.
The same generator succeeded with system-service access. This was an environment
restriction, not an app decoder result. Regeneration can change encoded bytes
across OS versions; compare inventories rather than assuming identical encoders.

[probe.mjs](probe.mjs) verifies input hashes, serves only its own HTML, worker
and input files, blocks external requests, and observes three native paths:
`createImageBitmap(Blob)`, `HTMLImageElement.decode()` and worker
`createImageBitmap` plus `OffscreenCanvas` readback. It closes bitmaps, revokes
object URLs, terminates the worker and has browser/worker deadlines. It records
unsupported paths as observations; a zero process exit is not a HEIC support or
quality assertion. No application modules or redistributed decoder are loaded.

## Observed results

| Browser / input | Bitmap | Image element | Worker | RGB difference from source PNG, mean / maximum | Alpha difference |
| --- | --- | --- | --- | ---: | ---: |
| Chromium / opaque | Rejected | Rejected | Rejected | Not measured | Not measured |
| Chromium / alpha | Rejected | Rejected | Rejected | Not measured | Not measured |
| WebKit / opaque | Decoded | Decoded | Decoded | 0.413 / 2 | 0 |
| WebKit / alpha | Decoded | Decoded | Decoded | 0.410 / 28 | 0 |

All successful routes returned 256 × 192 pixels. The reported differences use
8-bit channel units, and all three WebKit routes gave the same metrics. There
were no external requests or uncaught page errors. Chromium returned decoding
errors for these inputs; this is not a claim about every Chromium distribution
or future version. The maximum alpha-fixture RGB difference of 28 is retained;
no predeclared image-quality tolerance has been met by this observation.

Raw reports: [Chromium](chromium-observations.json), [WebKit](webkit-observations.json).
The executable hashes are recorded. WebKit's executable is a launcher, so the
report also hashes its 6,906-file/link runtime tree. The
[verification receipt](verification.json) binds inputs, scripts, logs and reports.

## Interpretation and remaining work

The worker path is a viable candidate for the native-import spike on this test
runtime. It supports investigating admission before decode and transfer to the
Pillow editing pipeline. It does not justify adding HEIC to the app's advertised
input list yet. The app still rejects HEIC as documented in the
[dependency review](../../../HEIC_IMPORT_RESEARCH.md).

The PNG comparison uses the same browser graphics stack and is not an independent
decoder/color reference. HEIC is lossy here; do not treat these files as exact
pixel-parity fixtures. There is no observation of real Photos/Files pickers,
EXIF/HEIF transformations, primary-image selection, depth/gain maps, HDR/P3,
malformed input, large native allocations, durable normalization or app recovery.

Playwright supplies a patched WebKit build and does not automate branded Safari;
its result cannot replace the declared physical Safari/iPhone matrix.
[Playwright browser documentation](https://playwright.dev/docs/browsers#webkit)
The fallback decoder, bounded container inspection, color contract, full-size
memory/cleanup stress and physical-device qualification all remain open.
