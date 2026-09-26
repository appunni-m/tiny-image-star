# Tiny Image Star scope

## Product goal

Tiny Image Star is a static, client-only image editor hosted on GitHub Pages.
The image-editing experience is a focused canvas for one image: open it,
pan and zoom, frame it, compare original and edited, then save. The same
recipe, engine, output settings, and selection/export rules also accept an
image set. One image is simply the one-item case; the result grid appears when
there is more than one item. Image bytes never leave the browser.

The app is local-first and non-technical in its visible language. The canvas
owns direct manipulation; the Images surface owns fast visual decisions across
one or more results. They are two views of one workflow, not two processing
products. **Make a story** now adds a photo-composition workspace on the shared
renderer, scheduler and recovery store. It assembles 6–12 photos into 4–8
slides and exposes editable looks, captions, crop zoom, slide order and adaptive
portrait/tall photo-print layouts with per-shape positions. Manual cutouts,
depth titles and connected cutouts are available. Automatic subject selection
and the finished recipe catalog remain in progress; see
[story evidence](docs/STORY_WORKSPACE_VERIFICATION.md).

## Product language rule

The site is for people who want a quick result, not an explanation of its
implementation. The primary flow should say **private**, **offline**,
**preview**, **update**, **compare**, and **save**. It should not ask users to
understand WASM, workers, codecs, bindings, or other implementation details.
Technical capability and dependency notes belong in project documentation and
developer diagnostics, not in the main interface.

## First user workflows

### Single-image editor

1. Open or drop one image onto the canvas.
2. Pan, zoom, compare Original/Edited, choose Crop or Move, drag crop handles,
   and use Original, Square, 4:3, 3:4, 16:9, or 9:16 framing presets.
3. Rotate, flip, or adjust the image. Exact dimensions and aspect locking are
   available under **Advanced sizing**.
4. Undo, redo, reset, and save the latest verified output in the selected format.
5. Click **Save as preset** to name the visible recipe for later reuse.

### Text on the image

Text is an editor-owned layer rather than a dependency on a server or remote
font service. Add one or more text layers, type the words, choose a built-in
font, and drag the selected layer on the canvas. The green corner resizes it;
the small panel controls size, color, alignment, weight, and italic style.
Text layers are part of undo/reset, saved recipes, active-set overrides, and
the next generated output.

Custom fonts can be added by choosing or dropping a local `.ttf`, `.otf`,
`.woff`, or `.woff2` file. Google Fonts pages do not provide a dependable
browser contract for dragging a font binary directly into another site, so the
editor links there and asks the user to download the font file first. The font
bytes stay in this browser's local font store; the app does not fetch fonts or
send image/text data to Google.

Text presets work in the editor, image sets and large-folder direct-save jobs.
Workers rasterize text with the same geometry as the editor, and Pillow
composites it before final PNG/JPEG encoding. Custom font bytes are checked
against their references; missing fonts stop the affected output. The shared
scheduler budgets composition surfaces and font memory. See
[text composition evidence](docs/TEXT_COMPOSITOR_VERIFICATION.md) for limits
and the remaining physical-device and typography qualification.

### Presets and image sets

1. Open **Presets** and choose a human-readable destination such as **Instagram
   Post (Square)**, **Instagram Portrait**, **Instagram Story / Reel**, **X Post
   (Wide)**, **LinkedIn Post**, **YouTube Thumbnail**, **Website Banner**,
   **Profile Photo**, or **Keep original size**. These are familiar layout recipes,
   not claims about changing platform specifications.
2. For a custom workflow, start with a representative image, visually frame it
   on the canvas, choose fit/crop behavior, and save a clear name in two or
   three simple decisions. Advanced values remain inspectable behind a
   disclosure.
3. Choose a recipe before adding one or more files. The image grid shows each
   Original and After, the destination name, dimensions, size, and status while
   results are produced locally.
4. Select one, several, or all completed results. A single result saves in the
   active operational format. Multiple selected results are written into one
   uniquely named folder where the browser supports direct folder access;
   other browsers use an explicit one-file-at-a-time save queue. Outputs remain
   cached in memory only for the active image set.
5. Open any result in the same editor for a local correction. Returning to the
   image grid records a per-item override, visibly marks it, and never changes
   the shared recipe. The override can be reset or saved as a new preset.

The utility workflow handles one still-image result per input; the story
workflow composes several inputs into ordered slides. Animated
GIF/WebP, multi-frame editing, layered formats, drawing, advanced filters,
metadata policy, persistent output caching, accounts, uploads,
monetization, server processing, GPU processing, and PWA installation are later
scopes.

## Preset and override model

Story photos now expose a **Cutout** tool with matching PNG mask import,
transparency-to-mask conversion and soft Restore/Erase brushes. Masks use the
full upright source and survive framing, look changes and saved recovery.
Replacing the source removes its old mask. Source-pixel regions at 100–400%
support fine repair, panning and keyboard navigation without changing history.
See [manual-mask evidence](docs/MASK_EDITING_VERIFICATION.md).

**Text → Depth title** places a photo-relative title behind the manually selected
subject. The original-photo and page-background choices preserve source alpha.
The words, placement and background choice survive mask removal or photo
replacement: until a new mask is supplied, the title stays in front of the
original photo with a visible explanation. Caption and title remain independent.
See [depth-title evidence](docs/DEPTH_TITLE_VERIFICATION.md).

**Cutout → Across slides** adds an independent subject copy across a neighboring
pair. Both halves share crop, mask, color, rotation and optional depth text;
position and size are saved per output shape. Joined pairs/chains reorder as
blocks so their seams remain connected. See
[connected-cutout evidence](docs/CONNECTED_CUTOUT_VERIFICATION.md). Automatic
segmentation and the finished authored Depth cover recipe remain open.

**Cutout → Outline & shadow** adds subject outlines, colored soft shadows and an
own-slide preview. A finish scales across shapes, is shared by both halves of a
connected copy and survives mask replacement as an inactive saved intent.
**Save my style → Cutout finish** captures parameters from a chosen photo and
reuses them on existing subject selections within the chosen scope. This does
not copy masks or create automatic selections. See
[cutout finish evidence and remaining gates](docs/CUTOUT_EFFECTS_VERIFICATION.md).

The shared style library's photo-color component now applies to independent
images and large-folder jobs through **Photo look**. It includes own-photo
previews, strength, all/selected/this-image scope, a dedicated undo action and
copied revision recovery. Folder look selection commits atomically before the
save folder is chosen. Story typography, layout and cutout components still
require separate integration into these workflows; see
[photo look evidence](docs/PHOTO_LOOK_EXECUTION_VERIFICATION.md).

Presets are local browser data, never account data. A saved recipe contains a
human-readable destination, a small ordered operation chain, a crop frame
relative to source dimensions, fit/crop behavior, and only verified output
choices. The simple builder leads with destination, framing behavior, and a
name; raw width, height, aspect lock, and output details remain under
**Advanced**.

The saved recipe catalog and immutable definitions commit together in IndexedDB.
Independent creates can merge across tabs; a stale edit or delete is refused.
Conflicting editor drafts offer a new-copy action. Legacy localStorage is kept
as an unchanged migration source. Unknown or malformed catalogs are read-only
and retained in private backups. Existing applied project/job copies do not
follow later library edits. Separate image scopes can use different revisions
of one recipe ID; new recovery copies carry exact references and definitions.
Folder selectors retain the job's actual version after a library change or
deletion. See [revision-selection evidence](docs/RECIPE_SELECTION_VERIFICATION.md)
for the tested behavior and remaining historical-recovery boundaries.

In the current reliable slice, the editor lets users compose crop, rotate,
flip, resize, and the verified adjustments into one recipe. The adapter applies
those operations in a fixed, tested order so a saved recipe behaves the same
in the editor and batch; arbitrary step reordering remains an Advanced
follow-on rather than an unverified promise.

An active image set has one shared recipe. Editing one item in the canvas creates a
per-item override layered over that recipe. The override is included in the
item's next preview and export automatically, is marked in the grid, and can be
reset to the shared recipe or saved as a new local preset. It must never mutate
the shared recipe silently.

## Realtime and instant-download contract

"Realtime" means:

- controls may emit many revisions while a pointer or slider is moving;
- processing runs in a dedicated Web Worker so the UI thread remains usable;
- each request carries a monotonically increasing revision number;
- stale worker results can never replace a newer preview or download;
- preview bytes and target-format output bytes are produced by the same
  revision;
- clicking Download does no image processing or encoding: it creates a Blob
  from the latest matching bytes and starts the download.

For large images, the worker may produce a bounded preview first and a
full-resolution export second. The UI must show `preview ready` versus `export
ready`; it must never present an older export as current. "Instant" therefore
means instant after the current export is ready, not zero encode time for an
arbitrarily large image or a slow lossy codec.

## Format contract

The current browser contract is intentionally narrower than the future format
matrix. The adapter exposes PNG and fixed-setting JPEG. Format conversion
is selected from this same output capability list; no conversion is faked by
renaming a file. Quality controls stay hidden because the pinned encoder has
no quality argument. JPEG flattens transparency onto white.

| Format | Input | Output | Acceptance status |
| --- | --- | --- | --- |
| PNG | yes | yes | current validated path |
| JPEG | yes | yes | fixed settings, RGB output, alpha flattening verified |
| GIF, BMP, WebP, TIFF, ICO | adapter-listed | no | output stays hidden until deliberately qualified |
| AVIF | no | no | codec disabled in the pinned package; outside the migration v1 export scope |

SVG, HEIC/HEIF, JPEG XL, PSD, PDF, camera RAW, and other formats are outside
the contract until a codec is deliberately added. The UI must expose the
actual runtime capability matrix and disable unavailable combinations instead
of silently falling back to another format. “Adapter-listed” describes the
current input capability metadata, not end-to-end support that has already
passed the fixture matrix.

The authorized [migration plan](MIGRATION_PLAN.md) supersedes the earlier AVIF
launch gate with a PNG/JPEG v1 scope. The app cannot claim complete format
support; AVIF remains unavailable until verified end to end.

## Processing design

The main thread owns the canvas, direct-manipulation state, preset library, and
image-set selection state. A worker owns one image-engine instance and
processing handles. Editor previews, sets, and folder jobs now share one
resource scheduler. It admits work against CPU and estimated memory budgets,
reuses engine instances, and prepares source copies only after admission.
Auto starts conservatively and samples comparable work; Max speed uses the
reported CPU budget subject to memory admission; Low resource requests one
worker. There is no fixed four-worker cap. Actual throughput qualification and
complete memory accounting remain open in the migration ledger. The active set
keeps completed output bytes in memory only. See [scheduler evidence and limits](docs/SHARED_SCHEDULER_VERIFICATION.md).

```text
source bytes + operation list ──> image worker ──> latest output bytes
          |                              |
          v                              v
  canvas preview                 editor save / batch grid
          |
  view state: pan + zoom + crop handles

image files + shared preset + per-item override
                         |
                         v
                 worker revisions
                         |
             original / after grid + direct save
```

The canonical state is original input bytes plus a serializable operation list.
View state is separate and never becomes the saved file. Rebuilding from the
canonical state makes reset, supersession, undo, per-item overrides, and future
preset editing deterministic. Each job returns `{revision, jobId, fileId,
output, metadata}`. All `ArrayBuffer`s crossing the worker boundary should be
transferred where possible. Old object URLs and engine image handles must be
released after replacement.

The worker implementation coalesces or supersedes stale work, rejects stale
results, and exposes cancellation at the app protocol boundary. Multiple
results must be written or queued only after each selected item is export-ready.

## Performance and safety gates

These are targets to measure, not current claims:

- no visible main-thread blocking during processing or multi-file save setup;
- preview updates at up to 30 revisions per second on ordinary images;
- no stale download after a control change;
- bounded input bytes, pixel count, frame count, and decoded memory;
- a visible processing state for slow operations and large files;
- superseded work is cancelled or discarded;
- every accepted format has decode, transform, encode, and download tests.

The benchmark matrix must include representative PNG, JPEG, GIF, BMP, WebP,
TIFF, ICO, and AVIF inputs; small, medium, and large images; and each preset.

## Dependency and engine boundary

The app may adapt or wrap a generated WASM API, but it must not edit the
pillow-rs checkout. Missing features and contradictory behavior are tracked in
[`PILLOW_RS_ISSUES.md`](PILLOW_RS_ISSUES.md).

The engine boundary should be narrow enough to replace Pillow-in-WASM if codec
or performance gates fail:

```text
ImageEngine
  inspect(bytes)
  render(bytes, operations, outputSettings)
  capabilities()
```

The current candidate is `pillow-rs` for its broad image operations, backed by
the `image-slash-star` codec layer. `image-slash-star` is a practical codec
candidate but is not itself the image-processing/editor engine. Native browser
Canvas APIs may be used only as a preview fallback; they cannot define the
all-format export contract.

The frontend must consume a stable npm package or a reproducible CI-built WASM
artifact. A local ignored `pkg/` directory is not a release dependency.
