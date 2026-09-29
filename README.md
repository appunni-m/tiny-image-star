# Tiny Image Star

Tiny Image Star is a local-first visual design editor. It provides pages and nested layers, a canvas workspace with layer and property panels, and a responsive mobile layout with slide-in side panels. Design documents and image sources stay in the current browser profile on this device.

The editor supports editable vector paths and graph-backed Pen networks with shared junctions, branching strokes, closed fill regions with independent color and opacity, per-edge Bézier handles, curve-preserving point insertion, and topology-aware point deletion. Networks can be used as live Boolean operands and alpha masks. Other features include layer grouping and ungrouping, bounds-aware multi-selection alignment and distribution, live non-destructive Boolean groups, editable alpha-mask groups, text, selection and transforms, multi-select, undo and redo, horizontal and vertical auto layout, grid auto layout with independent row and column gaps, manual cell placement and spans, per-layer minimum and maximum sizing in auto layout, responsive frame constraints, frame layout guides, and an outline view. The Inspect panel shows resolved layer values and provides copyable CSS and exact local layer JSON. It also supports linked components, instances and variant sets, reusable color styles, and typed variables with per-mode aliases and frame-level theme overrides. Variable bindings can drive paint, text, font size, line height, letter spacing, opacity, radius, and visibility. Local images are placed and edited through Pillow-RS WebAssembly; previews always render from the original image held in memory, so adjustments do not compound. Saved image recipes can be applied to a multi-selection from the canvas or Layers panel using an in-place batch bar with pause, cancel, progress, and worker controls. Local design files can be imported and exported as `.flocal` packages.

Prototype interactions can connect layers to frames with click/tap or hover triggers, set a starting point, configure transitions including Smart Animate, open centered or edge-positioned overlays, dim the presentation background, dismiss overlays from their own interactions or outside clicks, and move back through overlay and navigation history. Smart Animate matches layers by name and parent hierarchy and interpolates position, size, rotation, opacity, and solid fills during frame navigation. These links are stored with the local document.

Canvas comments support anchored review threads, replies, resolution, and deletion. Threads are saved inside the local design file and included in `.flocal` exports; they do not sync between devices.

This is an active rebuild, not production certification or complete parity with mature collaborative design tools. Boolean previews use a bounded-resolution local canvas composite while keeping their source vectors editable. Linked component instances retain local property, geometry, and child-order overrides while main component structure and styling synchronize. Component sets support named variant properties, per-instance variant switching, and override migration across structurally matching layers. Areas still under development include advanced vector operations, broader variable bindings across dimensions and layout, richer text and layout behavior, advanced prototype actions and wider Smart Animate property/easing parity, cross-device comment sync and multiplayer, richer developer handoff and code export, proprietary design-file import, and export workflows beyond layer-level raster formats. Tiny Image Star does not claim compatibility with third-party project files or cloud services.

## Run locally

```sh
npm run dev
```

Open `http://127.0.0.1:8000`. The app does not upload image or design data. The local server sends cross-origin isolation headers needed by WebAssembly workers.

## Verify

```sh
npm test
npm run verify:static
```

With the server running, open `http://127.0.0.1:8000/tests/browser-smoke.html` to run the browser workflow smoke. It exercises image previews and recipes, local packages, components and variants, vector-path and vector-network editing, group and ungroup actions, multi-selection alignment, variable values and bindings, grid auto layout, Boolean operations, prototype presentation, and mask rendering. Open `http://127.0.0.1:8000/tests/mask-smoke.html` to verify editable mask creation and release through the Layers context menu and Layer options menu, `http://127.0.0.1:8000/tests/export-smoke.html` to verify saved per-layer raster exports, `http://127.0.0.1:8000/tests/guides-smoke.html` to verify frame guides and mobile controls, `http://127.0.0.1:8000/tests/outline-smoke.html` to verify outline mode, `http://127.0.0.1:8000/tests/inspect-smoke.html` to verify local CSS/JSON handoff, clipboard actions, and phone-sized controls, or `http://127.0.0.1:8000/tests/comments-smoke.html` to verify canvas comments, replies, resolution, local persistence, and phone controls.
