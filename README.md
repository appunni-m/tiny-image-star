# Figma Local

Figma Local is a local-first design-editor rebuild. It has a page and layer document model, a canvas workspace with layer and property panels, and a mobile layout with slide-in side panels. Design data and image sources stay in this browser profile on this device.

The editor currently supports pages, nested frames, editable vector paths, live non-destructive Boolean groups (union, subtract, intersect, exclude), text, selection and transforms, multi-select, undo and redo, auto layout, responsive frame constraints, linked components, instances and variant sets, shared color styles, color-variable collections with modes and frame-level theme overrides, local image placement, and `.flocal` package import/export. Boolean operands remain as editable child layers and can be separated again. The Pen tool creates multi-point open or closed paths; dragging while placing a point creates Bézier handles, and selected paths expose anchors and handles for direct canvas editing. Double-click a curve to insert an anchor while preserving its Bézier shape, or use the path inspector controls to add an anchor on touch devices and remove the selected anchor. Closed paths can have fills. Pillow-RS is vendored under `wasm/` with an integrity manifest and license. Image originals remain in memory while editing; a dedicated local Web Worker renders adjustment previews from the original source so edits update the same image layer without compounding. Image recipes can be saved from an image and applied to a multi-selection using an in-place batch bar with pause, cancel, progress, and worker controls.

Prototype interactions can connect layers to frames with click/tap or hover triggers, set a starting point, configure transitions, open centered or edge-positioned overlays, dim the presentation background, dismiss overlays from their own interactions or outside clicks, and move back through overlay and navigation history. These links are stored with the local document.

This is an active rebuild, not full Figma parity or production certification. Boolean previews use a bounded-resolution local canvas composite while keeping their source vectors editable. Linked component instances retain local property, geometry, and child-order overrides while main component structure and styling synchronize. Component sets support named variant properties, per-instance variant switching, and override migration across structurally matching layers. Advanced Figma capabilities still to build include vector networks, numeric/string/Boolean variables and aliases, richer text and layout behavior, richer prototype actions and smart animation, comments and collaboration, Dev Mode, `.fig` import, and complete export controls. The editor does not claim compatibility with Figma files or cloud services.

## Run locally

```sh
npm run dev
```

Open `http://127.0.0.1:8000`. No image or design data is uploaded by the app. The local server sends cross-origin isolation headers needed for the WebAssembly worker.

## Verify

```sh
npm test
npm run verify:static
```

The browser workflow smoke can be opened at `http://127.0.0.1:8000/tests/browser-smoke.html` while the server is running. It exercises Pillow-RS previews, recipes, local packages, linked component variants, multi-point pen drawing, closed paths, Bézier handle editing, shape-preserving anchor insertion and deletion, color-variable modes and frame overrides, and the prototype presentation flow.
