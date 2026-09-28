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

The remaining product migration is the larger workspace rebuild. The existing
single-image editor, results gallery, and story composer are still separate
interaction models; there is not yet a shared Figma-style page canvas with
general image layers, frame/group/shape objects, a complete layer tree, and a
context-sensitive property inspector. Calling the app a Figma copy or claiming
full parity would be premature.

## Migration sequence

### 0. Freeze the product boundary

Resolve whether “all features” means the Design editor model or the full Figma
product family. Create a finite parity inventory with explicit supported,
deferred, and excluded rows. Do not begin a wholesale UI replacement while
“all” is undefined.

### 1. Make one document/page the center of the app

Use one document model for pages, frames, image objects, text, shapes, layer
order, and per-object operation state. Reuse the existing scene node/asset
schema and history where they fit. Add selection identity and page membership
without duplicating source image bytes for each preview or recipe revision.

### 2. Establish the live image contract

Keep a pinned source asset in memory per active image object, an ordered,
serializable operation stack, and one latest preview revision. Slider and
canvas interactions schedule a new render from the source plus the current
stack. A stale worker result can never replace a newer revision. Display the
latest result in the same canvas object; commit edits to document history, not
to repeatedly re-encoded source bytes.

### 3. Rebuild the editor shell around the canvas

Move from the current tray-plus-editor destinations to a Figma-like layout:
left pages/layers, central pan/zoom canvas, contextual right inspector, and a
compact toolbar. Keep image adjustments and crop/resize controls contextual to
image selection. Make the same document usable at phone width with full-screen
canvas, sheets, and touch equivalents for pointer/context actions.

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
