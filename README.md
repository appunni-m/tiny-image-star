# Tiny Image Star

Tiny Image Star is a local-first visual design editor. It provides pages and nested layers, a canvas workspace with layer and property panels, and a responsive mobile layout with slide-in side panels. Design documents and image sources stay in the current browser profile on this device.

The editor supports editable vector paths, live non-destructive Boolean groups, editable alpha-mask groups, text, selection and transforms, multi-select, undo and redo, horizontal and vertical auto layout, grid auto layout with independent row and column gaps, manual cell placement and spans, responsive frame constraints, and frame layout guides with combined uniform grids, fixed or stretch rows and columns, local visibility, and a global Shift+G toggle. It also supports linked components, instances and variant sets, reusable color styles, and typed variables with per-mode aliases and frame-level theme overrides. Variable bindings can drive paint, text, font size, line height, letter spacing, opacity, radius, and visibility. Local images are placed and edited through Pillow-RS WebAssembly; previews always render from the original image held in memory, so adjustments do not compound. Saved image recipes can be applied to a multi-selection from the canvas or Layers panel using an in-place batch bar with pause, cancel, progress, and worker controls. Local design files can be imported and exported as `.flocal` packages.

Prototype interactions can connect layers to frames with click/tap or hover triggers, set a starting point, configure transitions, open centered or edge-positioned overlays, dim the presentation background, dismiss overlays from their own interactions or outside clicks, and move back through overlay and navigation history. These links are stored with the local document.

This is an active rebuild, not production certification or complete parity with mature collaborative design tools. Boolean previews use a bounded-resolution local canvas composite while keeping their source vectors editable. Linked component instances retain local property, geometry, and child-order overrides while main component structure and styling synchronize. Component sets support named variant properties, per-instance variant switching, and override migration across structurally matching layers. Areas still under development include vector networks, broader variable bindings across dimensions and layout, richer text and layout behavior, advanced prototype actions and smart animation, comments and collaboration, developer handoff tools, proprietary design-file import, and export workflows beyond layer-level raster formats. Tiny Image Star does not claim compatibility with third-party project files or cloud services.

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

With the server running, open `http://127.0.0.1:8000/tests/browser-smoke.html` to run the browser workflow smoke. It exercises image previews and recipes, local packages, components and variants, vector-path editing, variable values and bindings, grid auto layout, Boolean operations, prototype presentation, and mask rendering. Open `http://127.0.0.1:8000/tests/mask-smoke.html` to verify editable mask creation and release through the Layers context menu and Layer options menu, `http://127.0.0.1:8000/tests/export-smoke.html` to verify saved per-layer raster exports, or `http://127.0.0.1:8000/tests/guides-smoke.html` to verify combined frame guides, visibility toggles, fixed positioning, and mobile controls.
