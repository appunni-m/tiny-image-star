# Local Figma-style image editor: product reset

Status: product reset and first implementation slice, 2026-09-28. This replaces
the previous product direction; it is not a claim of Figma affiliation or
complete feature parity.

## Product goal

Build a local-first image and visual-design editor with Figma's recognizable
workspace model: a page navigator and layer tree on the left, a zoomable canvas
in the center, a contextual property inspector on the right, and direct
selection/manipulation of image, text, shape, and frame objects. Image decode,
editing, preview, composition, and export stay on-device and use the pinned
Pillow-RS WebAssembly engine for raster operations.

One image remains one image object throughout editing. Its original bytes and
ordered edit state remain in memory for the active session. Every edit updates
the preview for that same object; undo, redo, and changing controls rerender
from the source plus the complete edit state. This avoids cumulative
re-encoding artifacts while keeping the visible work in place.

The only requested feature beyond the chosen Figma scope is bulk recipes:

1. Right-click an edited image object and save its image operations as a named,
   versioned local recipe.
2. Select multiple image objects on a page, right-click, and choose a saved
   recipe.
3. Apply it to the selected objects in place. A persistent job bar reports
   progress and exposes pause/resume/cancel, throughput, and the live
   processing-speed/concurrency control.
4. On touch devices, long-press or use the object's overflow action for the
   same menu.

Output format is part of the saved recipe and can be overridden in an active
processing job without changing the saved recipe. Existing local privacy and
bounded-memory rules remain product requirements.

## Scope decision still needed

“Figma copy / all features” can mean either the Design editor's interaction
model, or literal feature parity across Figma Design and related Figma
products. Figma's public guide describes a canvas, toolbar, page/layer
navigation, and contextual design/prototype inspector; its layer model includes
containers, frames, components, and nested children. See [Explore design
files](https://help.figma.com/hc/en-us/articles/15297425105303-Explore-design-files),
[Frames in Figma Design](https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design),
and [Layers 101](https://help.figma.com/hc/en-us/articles/26620239826199-Layers-101).

Figma also currently describes separate Design, FigJam, Dev Mode, Slides, and
Make products, with collaboration and sharing features. Those cloud/team
workflows cannot be reproduced as real-time multiplayer by a static, offline,
local-only app without adding a synchronization/signaling service. The offline
Figma guide itself distinguishes local design edits from cloud collaboration
and file-history features. See [What is Figma?](https://help.figma.com/hc/en-us/articles/14563969806359-What-is-Figma),
[Figma plans and features](https://help.figma.com/hc/en-us/articles/360040328273-Figma-plans-and-features),
and [What can I do offline in Figma?](https://help.figma.com/hc/en-us/articles/360040328553-What-can-I-do-offline-in-Figma).

Default for implementation until clarified: reproduce the Figma Design
workspace model for local visual editing, not the entire Figma product family
or its cloud collaboration services. Figma's current guide names canvas,
toolbar, navigation, layers/pages, and property inspection as the workspace
foundation. Its feature inventory also includes frames and sections, nested
layers, shapes and vector paths, components, auto layout, constraints, layout
grids, typography, fills/strokes/effects, export, and interactive prototypes.
See [Explore design files](https://help.figma.com/hc/en-us/articles/15297425105303-Explore-design-files),
[Layers 101](https://help.figma.com/hc/en-us/articles/26620239826199-Layers-101),
[Guide to auto layout](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout),
and [right sidebar properties](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar).
Treat these as a parity checklist and track each as supported, partial, or
pending before claiming feature completeness.

## Current project: keep, unify, or replace

| Area | Direction | Reason |
| --- | --- | --- |
| Pillow-RS WASM decode/encode and local worker assets | Keep | It already enforces the on-device image-processing boundary. |
| Processing scheduler, memory admission, reusable workers | Keep and surface per job | The current pool already bounds CPU and memory. The new bar should control and report this system rather than create a second scheduler. |
| Recipe catalog, frozen recipe revisions, per-job output format | Keep | These cover versioned recipes and deterministic processing inputs. |
| Project assets, layer nodes, history, recovery | Unify behind one document | The project model already has local image/text/shape nodes and history; the editor and story/batch flows currently use multiple separate state models. |
| Single-image editor and batch image gallery | Replace as separate destinations | Represent images as selectable page objects; opening an image focuses that object in the same workspace. |
| Story-specific workflow and navigation | Reassess against the confirmed Figma scope | Keep reusable image/text/shape/mask capabilities; remove product surfaces that do not map to the selected scope. |
| Context menu and persistent bulk job bar | Partial | Canvas/tray/result context actions and the global job bar exist; they still use the batch gallery model rather than shared page-layer commands. |

## Current migration state

The first vertical slice is implemented: the editor canvas, image-tray rows, and
result cards have image context actions; a saved recipe can be applied to the
captured multi-selection; the fixed job bar stays visible while the editor or
results view is open and provides progress, throughput/ETA, scheduler mode,
pause/resume, and cancel. The browser check verifies byte-stable in-memory
source editing, same-canvas preview updates, deterministic return to an earlier
edit value, multi-image in-place updates, and phone-width job-bar controls.

The visible design workspace now has a page navigator, layer tree, zoomable
canvas, selection tools, and contextual inspector. It edits image, text, shape,
and nested frame layers in a local project with undo/redo and browser recovery.
Image layers now support on-canvas source cropping: users can create, move, and
resize a normalized crop window over the retained original, then undo, redo, or
reset it while the same page layer is re-rendered through Pillow-RS WASM.
The shared inspector also exposes undoable 0–100% layer opacity for images,
text, shapes, and frames, with an immediate local WASM page preview.
Frames support inherited transforms, clipping, corner radius, constraints, and
horizontal/vertical Auto Layout. Auto Layout now includes wrap, independent row
and column spacing, padding, alignment/justification, and per-axis Fixed, Fill,
and Hug sizing. The Pillow-RS WASM scene renderer updates the same page preview;
design image bytes remain local and retained by the active project.

This is a material workspace milestone, not complete Figma parity. The app
still keeps its older single-image, batch, and story workspaces as separate
interaction models, and the design workspace lacks a general vector-path
editor, components/variants, variables, layout grids, effects and advanced fill
systems, prototype interactions, and many established keyboard/accessibility
behaviors. Auto Layout still lacks grid flow, min/max sizing, aspect-ratio
controls, and several advanced wrap/alignment behaviors. The supported-feature
inventory and cross-device release gates below remain open; do not describe the
project as a production-ready Figma copy.

## Figma Design parity inventory

| Area | Status | Current boundary |
| --- | --- | --- |
| Pages, layer tree, selection, canvas pan/zoom, inspector | Partial | A local design workspace exists, but legacy image, batch, and story workspaces are not one shared editor. |
| Images and Pillow-RS editing | Partial | Local WASM previews and exports support retained-source image layers, fit/crop, arbitrary canvas rotation, horizontal/vertical flips, color adjustments, direct source-crop creation/move/resize/reset with undo/redo, and opacity. More adjustment controls and remaining legacy operations are pending. |
| Frames, nesting, constraints, clipping | Partial | Nested frames and common constraints work; full frame behavior and section objects are not implemented. |
| Auto Layout | Partial | Horizontal/vertical flow, wrap, padding, gap, basic alignment, and per-axis Fixed/Fill/Hug work. Grid, absolute positioning, min/max, aspect-ratio, and advanced wrap alignment are pending. |
| Shapes and vectors | Partial | Primitive rectangle, rounded rectangle, and ellipse shapes exist; paths, pen editing, boolean operations, and SVG import/export are pending. |
| Typography | Partial | Editable text layers and bundled/device fonts exist; rich text runs, paragraph controls, OpenType controls, and complete type styles are pending. |
| Fills, strokes, and effects | Partial | Flat fills and limited strokes/shadows exist; gradients, multiple fills/strokes, blend modes, and the full effects stack are pending. |
| Components and design systems | Pending | Components, instances, variants, properties, libraries, and variables/tokens are not implemented. |
| Prototyping and interaction | Pending | Connections, triggers, transitions, overlays, and local prototype playback are not implemented. |
| Collaboration and file history | Pending | Local undo, redo, and recovery exist; comments, multiplayer editing, shared libraries, and file/version history do not. |
| Bulk recipes and processing bar | Supported, separate workflow | Recipes freeze their revision and target snapshot; processing updates selected images in place and exposes progress, pause/resume, cancel, and speed controls. |
| Phone/tablet editing | Partial | The canvas and core controls reflow to phone width; physical-device, keyboard, screen-reader, and tablet qualification is still required. |

This inventory targets the Figma Design editor rather than FigJam, Slides,
Dev Mode, or Make. It is a working parity checklist; every partial and pending
row remains part of the requested end state unless explicitly removed after
product review.

## Migration sequence

### 0. Keep the product boundary explicit

Treat the requested target as the Figma Design editor model plus the single
bulk-recipe feature. Keep that boundary explicit in the parity inventory above;
do not silently narrow it to the current implementation or extend it to
unrelated Figma products.

### 1. Make one document/page the center of the app

Use one document model for pages, frames, image objects, text, shapes, layer
order, and per-object operation state. Reuse the existing scene node/asset
schema and history where they fit. Add selection identity and page membership
without duplicating source image bytes for each preview or recipe revision.
`src/project/design-page.js` constructs a verified multi-page image document
and supplies serializable layer commands and selection snapshots. The visible
canvas now uses the page/layer model; unifying it with legacy editor, batch,
and story state is still required.

### 2. Establish the live image contract

Keep a pinned source asset in memory per active image object, an ordered,
serializable operation stack, and one latest preview revision. Slider and
canvas interactions schedule a new render from the source plus the current
stack. A stale worker result can never replace a newer revision. Display the
latest result in the same canvas object; commit edits to document history, not
to repeatedly re-encoded source bytes.

### 3. Finish the editor shell and responsive interaction model

The first Figma-like shell is in place: left pages/layers, central pan/zoom
canvas, contextual inspector, and a compact toolbar. Finish direct image
operation controls, complete layer manipulation and selection behavior, and
make the same document usable at phone/tablet widths with touch equivalents for
pointer and context actions. Then remove duplicated state between the design,
legacy image, batch, and story workspaces.

### 4. Add context-menu bulk recipes — initial slice delivered

Image context menu: “Save edits as recipe.” Multi-selection context menu:
“Apply recipe…” with versioned local recipe choices. Freeze the chosen recipe
revision and target IDs when the job starts. Each completed image updates its
own canvas object in place; failures leave original image data and other
completed objects intact.

### 5. Add the processing bar on the canvas page — initial slice delivered

Keep one visible bar for a running recipe job: completed/total, current phase,
images per second, estimate when stable, pause/resume/cancel, and speed mode.
Speed mode changes the shared scheduler live and remains bounded by its measured
CPU/memory budget. Do not promise a numeric worker count the device cannot
admit. Preserve output format with the frozen job snapshot.

### 6. Gate release on interaction and engine evidence

- The selected supported feature inventory is complete, with no “all Figma”
  claim beyond it.
- Every operation previews on the same selected object, and undo/redo/reload
  restore the correct operation revision.
- Context menus work with mouse, keyboard, and touch alternatives.
- Multi-selection jobs have deterministic target snapshots, immutable recipe
  versions, no missing/duplicate results, safe cancellation, and visible errors.
- Verify output parity, 1/2/4-worker scheduling within CPU and memory budgets,
  no image network requests, and PNG/JPEG byte integrity across Chromium and
  WebKit.
- Check phone, tablet, desktop, 200% text, keyboard-only use, screen readers,
  touch gestures, and physical-device safe-area/keyboard behavior before calling
  the app production-ready.

## Existing behavior relevant to the first implementation slice

The current app already has saved recipes, output-format state per recipe and
processing job, selection of multiple batch images, scoped recipe application,
in-place batch preview replacement, and global Auto/Max speed/Low resource
controls. The first implementation slice now registers context actions on the
editing canvas, image-tray rows, and result cards, plus a fixed global job bar
with progress, throughput/ETA, live scheduler mode, pause/resume, and cancel.
A focused browser workflow covers source-byte retention and same-canvas edit
previews, saving a recipe from one image, applying the captured recipe to a
multi-selection, switching views while a job runs, and phone-width controls.
The next migration phase is to unify the editor, batch gallery, story tools, and
project model in one page/layer workspace with a zoomable canvas and contextual
inspector.
