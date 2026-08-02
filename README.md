# Tiny Image Star

Tiny Image Star is a private, browser-based image editor for quickly framing,
resizing, converting, and saving one image or a whole set. Images stay on your
device: there is no account, upload service, analytics endpoint, or application
backend.

> **Pre-release status:** the current verified export format is PNG. Additional
> formats appear only after the checked-in image engine proves that it can
> produce valid output bytes. The project does not yet have a chosen software
> license, so reuse rights remain pending; see [License status](#license-status).

## What works today

- One canvas for one image or an image set—there is no separate batch editor.
- Pan, zoom, visual crop handles, aspect presets, fit or fill resizing,
  rotate, flip, brightness, contrast, and grayscale.
- Immediate original/edited comparison, undo, redo, reset, and dirty-state
  feedback.
- Destination-based recipes, custom local presets, per-image corrections, and
  explicit apply-to-all/selected/this-image scope.
- Worker-backed processing, responsive result selection, direct single-image
  save, and folder-based multi-image save where the browser supports it.
- A bounded-memory large-folder path with pause, resume, and retry. It avoids
  retaining the entire collection or creating thousands of preview cards.
- Browser-local recovery for active work and a visible control for clearing
  saved recipes and recovery data.

The detailed implemented/blocked boundary is in
[the verification matrix](VERIFICATION_MATRIX.md). In particular, AVIF,
animation preservation, and non-PNG output are not currently claimed.

## Run it locally

Tiny Image Star is a static site. From the repository root, start any local
HTTP server; Python's built-in server is enough:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/>. Do not open `index.html` through a `file://` URL:
browser workers and the image engine require an HTTP origin.

For a random free port, replace `8000` with `0` and open the port printed by
Python.

## First image in four steps

1. Choose, drop, or paste one or more images.
2. Drag the image or crop frame and choose a familiar destination or shape.
3. Compare the original with the edited result and apply the change to this
   image, selected images, or all images.
4. Save the selected result. Multiple results use a folder when the browser
   offers direct folder access; otherwise the app presents an explicit
   one-file-at-a-time save queue.

Presets and recovery copies are stored only in this browser. A per-image
correction remains separate from the shared recipe, so later set-wide changes
do not silently erase it.

## Large folders

The large-folder path is shown only when the browser provides direct folder
read/write access. It discovers supported files into an IndexedDB metadata
manifest, processes a bounded number in parallel, and writes completed files
straight to the selected destination.

The code and regression suite model up to 100,000 manifest entries without
retaining source or output bytes for the collection. That is a design and
automated-contract result—not a claim that every browser/device has completed
a 100,000-image production run. See [the large-folder plan](LARGE_FOLDER_PLAN.md)
for memory boundaries, recovery semantics, and the dated benchmark method.

## Privacy and local data

The application source contains no network request for image processing,
telemetry, remote fonts, or analytics. The static host still receives normal
web requests for the HTML, JavaScript, CSS, and image-engine files.

Local state may include:

- recipes in browser local storage;
- active-session source bytes and operation metadata in IndexedDB, within the
  documented recovery budget; and
- large-folder manifest metadata plus browser-granted directory handles.

Use **Local data** in the application footer to inspect and clear saved recipes
and recovery records. Already downloaded files and files written to a chosen
output folder are outside that browser-local cleanup.

## Browser and format boundaries

The app needs JavaScript modules, Web Workers, WebAssembly, Canvas, Blob/Object
URL support, and IndexedDB. It detects optional capabilities at runtime instead
of inferring them from a browser name. Direct large-folder input/output needs a
browser-provided directory picker; the smaller one-or-many workflow remains
available when that feature is absent.

Verified still-image inputs have fixtures for JPEG, PNG, GIF, BMP, WebP, TIFF,
ICO, and EXIF-oriented JPEG. Animated GIF/WebP is rejected explicitly because
animation preservation is not implemented. SVG, HEIC/HEIF, JPEG XL, PSD, PDF,
camera RAW, and AVIF are outside the current verified contract.

## Development and verification

Contributors need Node.js 20 or newer. Install the locked development
dependency and the Chromium browser used by the smoke suite:

```bash
npm ci
npx playwright install chromium
```

Run the complete local/CI gate:

```bash
npm run verify:all
```

Useful narrower commands:

| Command | Purpose |
| --- | --- |
| `npm test` | Fast deterministic checks using real fixture bytes. |
| `npm run verify:watch` | Rerun the fast checks after relevant files change. |
| `npm run verify:browser` | Browser interactions, responsive layout, output bytes, and console errors. |
| `npm run profile:folder -- /path/to/images 64` | Profile an evenly distributed local sample without retaining benchmark outputs. |

`npm run verify:all` returns nonzero if either layer fails; it does not silently
skip the browser test. [CONTRIBUTING.md](CONTRIBUTING.md) explains repository
structure, generated files, and pull-request expectations.

GitHub Actions runs the same complete gate for pull requests and before a main
branch deployment. The Pages workflow publishes only `index.html`,
`styles.css`, `src/`, and `wasm/` after verification passes.

## Documentation map

- [Scope](SCOPE.md) — current product contract and explicit non-goals.
- [Verification matrix](VERIFICATION_MATRIX.md) — feature-by-feature automated
  evidence and residual browser boundaries.
- [Large-folder plan](LARGE_FOLDER_PLAN.md) — streaming-style collection model,
  recovery, and measured performance.
- [Engine evaluation](ENGINE_EVALUATION.md) and
  [Pillow-RS issues](PILLOW_RS_ISSUES.md) — dependency boundary and known
  binding gaps; this project does not edit Pillow-RS.
- [Implementation plan](IMPLEMENTATION_PLAN.md) and
  [editor redesign](EDITOR_REDESIGN.md) — delivery history and design intent.
- [Product UX audit](PRODUCT_UX_AUDIT.md) — detailed product research and
  follow-on opportunities, not a list of already-shipped promises.

## Help, contributions, and security

- Use [GitHub Issues](https://github.com/appunni-m/tiny-image-star/issues) for
  reproducible bugs and focused feature proposals. Read
  [SUPPORT.md](SUPPORT.md) before sharing diagnostics or image samples.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.
- Do not disclose an unpatched vulnerability in a public issue. Follow
  [SECURITY.md](SECURITY.md) for the private-reporting route and current support
  scope.

## License status

No license has been selected for the application code yet. Public source alone
does not grant permission to copy, modify, or redistribute it. A project owner
must add a recognized open-source license before describing a release as
open-source or accepting reusable contributions.

The checked-in generated Pillow-RS runtime has separate MIT-CMU terms; see
[the vendored runtime notice](wasm/README.md) and
[license text](wasm/PILLOW_RS_LICENSE.txt). Known direct development/runtime
notices and remaining provenance work are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
