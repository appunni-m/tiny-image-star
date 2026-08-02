# Tiny Image Star

Tiny Image Star is a privacy-first browser image editor intended for
open-source distribution on GitHub Pages. It opens one image or a set of local
images into one recipe workflow: direct framing, rotation, resizing,
comparison, conversion, and save. A set stays attached to the canvas in an
image tray; the single **Add images** action uses that same workspace for one or
many files, and **Results** opens a contextual output drawer once a set is active.
Image data is not sent to a server. In an image set, the selected recipe is a
shared layer and a manual canvas correction is a per-image layer, so
changing the destination does not silently replace that correction.

## Current status

The first browser slice is intentionally small: it supports a single-image
canvas, pan and zoom, crop framing, keep-whole-image versus fill-frame resizing,
rotate/flip, adjustments, undo/redo/reset, local preset recipes, direct Save
when one verified format is available (or a compact metadata-only sheet when
choices are needed), and the same recipe applied to an image set with an
original/result grid. One selected result saves directly. In browsers that
allow a page to choose and write a folder, several selected results are written
straight into one uniquely named folder. Other browsers show a short save queue:
each click starts exactly one selected file in the browser's normal Downloads
location, avoiding blocked automatic downloads. No archive is created. New files can
be added without losing completed previews; each card
shows the destination, output dimensions, file size, and size change. An item
can be corrected on the canvas as a marked local override without changing the
shared recipe. Cancelled or failed updates can be retried, completed previews
can be cleared without losing unresolved cards. Saved images include a UTC
date/time in their name; a multi-image save uses one unique date/time and
destination name for its folder. The
edited canvas switches to the generated result when it is ready, and Download
is disabled while an edit is still catching up. Format conversion and
the optional **Smaller file (lossy)**
toggle are capability-driven: they appear only after the browser adapter has
verified the corresponding output bytes. Unsupported formats—including AVIF
today—are not silently converted or shown as available. Image-set jobs use a
 bounded, pixel-aware pool of browser workers so several small files can update
 at once without blocking the canvas, while large inputs reduce concurrency to
 protect memory. Requested output dimensions are bounded by the same per-image
safety budget, and a batch’s compressed byte total is rejected before the app
reads an oversized set into memory.

For very large folders, the app uses a separate execution path behind the same
recipe workflow. It discovers up to 100,000 supported images into a durable
metadata-only manifest, processes a bounded number at a time, and writes every
completed result directly to the chosen folder. It does not keep collection
bytes or previews in memory, build an archive, or add 100,000 result cards to
the page. The job can be paused, resumed after refresh, retried, and forgotten
without deleting already-saved output files. This path is shown only in current
desktop browsers that provide direct folder access; other browsers retain the
smaller one-or-many workflow instead of making an unsafe scale claim.

Images can enter through the chooser, drag/drop, or clipboard paste; image
paste leaves normal text fields alone. When several images are open, the tray
starts with **Apply changes to: All images**. After a direct canvas correction,
one visible action applies only the changes made in that editing session to all
images, selected images, or this image. Relative crops scale to each source;
existing per-image corrections remain separate and are not silently replaced.
The tray can also apply a human-readable destination
to all, selected, or the active image without leaving the canvas. Scoped choices
are marked on affected cards and remain separate from manual canvas corrections.
**Results** opens the active set as a contextual result drawer, with an explicit
Back to editor action; clearing the last reviewed result returns to the canvas
automatically. When there is no active set, **Add images** keeps the user on the
calm editor start screen and opens the collection file chooser, so a one-image
import and a multi-image import take the same path.
Format is always discoverable once an image is open. Compression quality is
presented as **Low (80)**, **Medium (95, default)**, or **High (100)** only when
the verified output encoder supports it; exact custom quality remains in
Advanced. Opening one tray item preserves its image-set context; changing the shared
destination refreshes that canvas while retaining the item’s marked local
correction. The active set also has a browser-local recovery snapshot: a
refresh offers Restore, Clear saved session, or Not now. One image uses the same
collection recovery model as many images, restoring its source plus latest
operations. Only source bytes and recipe/selection/override metadata are
retained under a 64 MiB budget; outputs are
regenerated locally after restore, and in-memory history is intentionally not
persisted. The **Local data** control in the footer shows the saved recipe and
recovery-copy counts and can clear those stored records without closing the
image currently open.

On narrow screens, the same workspace keeps five primary tools in a fixed
bottom bar, puts rotate/flip/zoom/Fit screen in a compact quick-action row, and opens
detailed controls as a bottom sheet. Pinch and double-tap Fit are wired for
touch-capable browsers; real-device accessibility and text-zoom validation
remain part of release QA.

The planned product contract and dependency findings are in:

- [`PRODUCT_UX_AUDIT.md`](PRODUCT_UX_AUDIT.md) — complete feature, interface,
  architecture, market-pattern, and redesign review
- [`LARGE_FOLDER_PLAN.md`](LARGE_FOLDER_PLAN.md) — bounded-memory 100,000-file
  execution and recovery contract
- [`SCOPE.md`](SCOPE.md)
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)
- [`EDITOR_REDESIGN.md`](EDITOR_REDESIGN.md)
- [`PILLOW_RS_ISSUES.md`](PILLOW_RS_ISSUES.md)

## Run locally

The initial slice is a static site and needs no development server framework:

```bash
python3 -m http.server 0 --bind 127.0.0.1
```

The terminal prints the randomly selected port; open that local URL. The page
must be served over HTTP because browser workers and the image engine are not
reliable from `file://` URLs. Random-port URLs are temporary and change whenever
the server is restarted.

The included `.github/workflows/pages.yml` assembles the static files and
deploys them through GitHub Pages after the repository's Pages source is set to
GitHub Actions.

## Verification

Run the immediate regression contract after any change:

```bash
npm run verify
```

For local save-triggered reruns of that same fast suite:

```bash
npm run verify:watch
```

The slower browser interaction smoke is separate from the fast watcher. Its
Playwright development dependency is declared in `package.json`; install the
project dependencies once with `npm install`. It checks responsive control
geometry at desktop and 390px widths, failing on overlap or horizontal
overflow:

```bash
npm run verify:browser
```

To run the byte-level and browser checks together:

```bash
npm run verify:all
```

To profile a real local folder without retaining generated benchmark outputs:

```bash
npm run profile:folder -- /path/to/images 64
```

The final number is the evenly distributed sample count. The report separates
folder discovery, reads, image opening, PNG encoding, output verification, and
temporary output writing. See [`LARGE_FOLDER_PLAN.md`](LARGE_FOLDER_PLAN.md#measured-performance)
for the current 8,192-file baseline.

`verify:all` intentionally fails when project dependencies have not been
installed; this prevents a claimed full check from silently becoming only a
static check.

See [`VERIFICATION_MATRIX.md`](VERIFICATION_MATRIX.md) for feature coverage,
the deterministic fixture, and the browser-download boundary.

## Privacy

There is no application backend, account system, analytics requirement, upload
endpoint, or paid service. The browser loads the static application and WASM
artifact; image bytes are processed locally.

## Boundaries

The currently verified operational output is PNG. The input contract has real
fixtures for JPEG, PNG, GIF, BMP, WebP, TIFF, ICO, and EXIF-JPEG; browser-
unfriendly still inputs can use a local PNG display proxy while the original
bytes remain the source for processing. Animated GIF/WebP inputs are detected
and rejected with an explicit message; animation preservation, color-profile
preservation, and additional output formats remain gated on end-to-end
fixtures. The UI is ready to surface another output format only when the
browser adapter reports a working encoder and the saved bytes pass those
checks. AVIF remains unavailable until its decode/encode path is verified end
to end. SVG, HEIC/HEIF, JPEG XL, PSD, PDF, camera RAW, and animation editing
are not part of the current still-image contract.

The checked-in generated artifact is treated as the source of truth at runtime.
The external Pillow-RS checkout is intentionally left untouched by this project;
when a newer generated artifact is copied in, `npm run verify:all` probes its
encoders and exposes only formats whose emitted bytes pass the full checks.

Before public reuse, add the project's chosen `LICENSE`, contribution guide,
and private security-reporting route; they are not present in this checkout yet.
