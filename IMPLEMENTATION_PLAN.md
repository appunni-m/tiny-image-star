# Tiny Image Star implementation plan

This plan is deliberately staged around observable contracts. It keeps the
browser app useful while AVIF and generic output support are still dependency
gates.

## Phase 0 — establish the engine contract

Create an app-owned `ImageEngine` adapter and capability matrix. The adapter
must expose:

- initialization readiness;
- still-image inspection;
- rendering from source bytes plus serializable operations;
- preview bytes and export bytes;
- output format, dimensions, byte size, and diagnostics;
- cancellation/supersession behavior.

The first concrete adapter targets the generated `pillow-rs-js` package. It
must not expose raw package details to UI code.

Before claiming format support, run a fixture matrix for PNG, JPEG, GIF, BMP,
WebP, TIFF, ICO, and AVIF. Each fixture must cover import, one transform,
output encoding, Blob download, and metadata-stripping behavior.

## Phase 1 — editor-first browser app

Use a small static TypeScript/JavaScript frontend suitable for GitHub Pages:

```text
index.html
styles.css
src/
  main.js                 small editor bootstrap/composition entry
  editor/                 canvas state, events, rendering, and processing
  batch.js                local presets, result grid, selection, overrides
  worker.js               worker protocol and engine lifecycle
  engine/pillow.js        pillow-rs adapter
  formats.js              capability labels, file filters, and output names
  presets.js              serializable preset definitions
  jobs/core.js            durable-job records, names, and bounded scheduling
  jobs/store.js           IndexedDB metadata manifest
  jobs/controller.js      discovery, recovery, and virtual result list
  jobs/large-worker.js    one-file transform and direct folder write
wasm/                     generated package artifact or release copy
.github/workflows/
  pages.yml               static GitHub Pages deployment
```

The first editor vertical slice should support:

1. single-image open/drop;
2. central canvas with pan, zoom, fit, original/edited comparison, crop handles,
   framing presets, rotate, flip, and direct preview;
3. undo, redo, reset, and unsaved-change state;
4. exact resize controls and aspect lock behind an Advanced disclosure;
5. worker-backed output with dimensions, file size, readiness, and matching save
   bytes; the UI exposes only formats reported by the adapter;
6. a visual Save as preset flow that stores crop frames relative to source
   dimensions in browser-local storage.

Do not hide unsupported AVIF behind a PNG fallback.

## Phase 2 — destination presets and one-or-more image workflow

Add a first-class Presets home and Images view beside the editor. The primary
preset picker must be outcome-based rather than pixel-first. Start with
familiar layout recipes such as Instagram Post (Square), Instagram Portrait,
Instagram Story / Reel, X Post (Wide), LinkedIn Post, YouTube Thumbnail,
Website Banner, Profile Photo, and Keep original size. These names describe familiar
layouts and do not claim current platform specifications.

Each preset is local browser data and pure serializable data:

```ts
type Preset = {
  id: string;
  name: string;
  destination: string;
  operations: {
    cropRelative?: { x: number; y: number; width: number; height: number } | null;
    resizeWidth?: number;
    resizeHeight?: number;
    resizeMode: "fit" | "crop";
    rotation: 0 | 90 | 180 | 270;
    flipX: boolean;
    flipY: boolean;
    format: string;
  };
};
```

The first slice composes the available operations into one reusable recipe and
applies them in a fixed, tested order shared by editor and batch. Users can
combine crop, fit/crop resize, rotation, flip, and verified adjustments before
saving; arbitrary step reordering belongs behind Advanced after it has a
separate engine contract and regression coverage.

The simple preset builder is destination → crop/fit → name. The
representative-image canvas is the source of a custom crop frame; Advanced
reveals exact dimensions and verified output details. A saved preset can be
named, edited on canvas, duplicated, deleted, and applied to a new batch.

The Images view must use the same recipe and output contract as the canvas. A
single imported image is still the one-item case; several images reveal the
visual result grid. It must:

- accept one or multiple files, or a folder, after a preset is selected;
- show an immediate original/after grid with destination name, status,
  dimensions, and output size;
- keep completed output bytes in memory for the active image set only;
- select one, several, or all results;
- save one selected result directly and multiple selected results into one
  uniquely named folder, without creating an archive;
- support Ctrl/Cmd+S for the current selected output(s);
- open one item in the editor and return without losing the batch or shared
  preset;
- layer a marked per-item override over the shared recipe, with Reset to preset
  and Save override as preset actions.

Do not silently mutate the shared preset when an item is corrected.

## Phase 3 — scale, recovery, and responsiveness

- Use bounded preview dimensions for large sources.
- Schedule full-resolution output for the latest revision.
- Transfer `ArrayBuffer`s rather than cloning them.
- Coalesce slider jobs and discard stale responses.
- Use a bounded pool of browser workers for image sets; cap concurrency so a
  large folder does not overwhelm the device, and retire failed workers while
  truthfully marking any unfinished items.
- Route large folders through a durable metadata manifest. Discover lazily,
  process with a small worker pool, write each file directly, and virtualize the
  status list. Never aggregate collection output bytes or create an archive.
- Show cancellation/error states instead of claiming a result succeeded.
- Keep the engine state independent from image-processing progress. Healthy
  Ready may remain available internally but stays quiet in the product UI;
  show activity only for real work and actionable copy for failures.
- Add a safe recovery path for large inputs and cross-origin/browser save edge
  cases; drag-out remains unavailable unless verified in the target browsers.
- Add an automated performance matrix and memory-limit tests.

## Phase 4 — format completion

AVIF and all other formats become enabled only after the dependency gates in
`PILLOW_RS_ISSUES.md` are resolved and the browser fixture matrix passes.
If the current Pillow binding remains incomplete, implement a separate
app-owned WASM facade or replace the codec/engine behind `ImageEngine`; do not
modify the pillow-rs checkout.

## GitHub Pages release shape

The release workflow must:

1. check out the app and the exact engine source/artifact;
2. build or obtain the WASM package reproducibly;
3. build the static frontend with the correct relative base path;
4. inspect that JS, WASM, CSS, and legal files are in the artifact;
5. deploy the artifact to GitHub Pages;
6. run a browser smoke test against the deployed path.

The app remains fully static: no API routes, secrets, accounts, uploads, or
server-side image work.

## Acceptance criteria for the first release

- A single image opens into a central canvas without network requests for image
  data.
- Pan, zoom, fit, Original/Edited comparison, crop handles and stable aspect
  presets work before export.
- Fit preserves the whole image; Crop fills the requested frame and visibly
  communicates that edges may be trimmed.
- Rotate, flip, undo, redo, reset, and unsaved-change state are reliable.
- Users can save and reuse a named local preset without an account.
- A new batch can select a destination before import and see original/after
  previews as outputs complete.
- A batch item can be corrected in the same editor and return as a marked
  per-item override without mutating the shared preset.
- Single selection saves directly; multiple selections save into one uniquely
  named directory containing only export-ready outputs.
- The UI remains responsive while worker jobs run.
- A newer control revision cannot be overwritten by an older worker response.
- Download uses bytes already generated for the displayed revision.
- Folder output contains only selected, export-ready results with stable names.
- A 100,000-file job retains only manifest metadata and visible rows in the
  page; source/output buffers are bounded by worker count.
- Closing the page during a completed scan restores interrupted entries as
  pending. Closing it during discovery restarts metadata discovery without
  creating duplicate output names.
- PNG is the currently verified output. Other formats become visible only when
  the adapter reports a working encoder and their bytes pass fixture verification.
- Privacy behavior is documented and can be observed in browser network tools.
- Unsupported codecs fail with an actionable message.
