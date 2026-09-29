# Figma Local

Figma Local is a local-first design-editor rebuild. It has a page and layer document model, a canvas workspace with layer and property panels, and a mobile layout with slide-in side panels. Design data and image sources stay in this browser profile on this device.

The editor currently supports pages, nested frames, editable vector paths, text, selection and transforms, multi-select, undo and redo, auto layout, responsive frame constraints, linked components, instances and variant sets, shared fill/text color styles, local image placement, and `.flocal` package import/export. The Pen tool creates multi-point open or closed paths; dragging while placing a point creates Bézier handles, and selected paths expose anchors and handles for direct canvas editing. Closed paths can have fills. Pillow-RS is vendored under `wasm/` with an integrity manifest and license. Image originals remain in memory while editing; a dedicated local Web Worker renders adjustment previews from the original source so edits update the same image layer without compounding. Image recipes can be saved from an image and applied to a multi-selection using an in-place batch bar with pause, cancel, progress, and worker controls.

Prototype interactions can connect layers to frames with click/tap or hover triggers, set a starting point, configure transitions, and run through a local Present view with Back navigation. These links are stored with the local document.

This is an active rebuild, not full Figma parity or production certification. Linked component instances retain local property, geometry, and child-order overrides while main component structure and styling synchronize. Component sets support named variant properties, per-instance variant switching, and override migration across structurally matching layers. Advanced Figma capabilities still to build include vector networks and node insertion/deletion, boolean operations, variable collections and modes, advanced text and layout behavior, prototype overlays and richer actions, comments and collaboration, Dev Mode, `.fig` import, and complete export controls. The editor does not claim compatibility with Figma files or cloud services.

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

The browser workflow smoke can be opened at `http://127.0.0.1:8000/tests/browser-smoke.html` while the server is running. It exercises Pillow-RS previews, recipes, local packages, linked component variants, multi-point pen drawing, closed paths, Bézier handle editing, and the prototype presentation flow.
