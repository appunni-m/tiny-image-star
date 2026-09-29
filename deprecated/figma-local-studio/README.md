# Local Studio

An independent, local-first design editor being built from a clean repository root. The previous Tiny Image Star application and its Figma experiment are archived under [`deprecated/`](deprecated/).

The new app is plain browser code with no remote services. It includes a canvas workspace, frame and shape tools, selection and movement, layer selection, property editing, local document persistence, undo/redo, project import/export, and PNG export. Images are retained in the tab and in local IndexedDB; brightness, contrast, saturation, and blur previews are rendered from the original image by the pinned Pillow-RS WebAssembly runtime in a dedicated worker.

Run it with Node.js 20 or newer:

```sh
npm run dev
```

Then open <http://127.0.0.1:8000/>. Set `PORT` to use a different port. Run the model tests with `npm test`.

The app is an early foundation, not a feature-complete Figma replacement yet. Rich text, pen/vector paths, nested layers and constraints, components, prototyping, collaboration, and the requested contextual bulk recipe workflow remain future work.

The WASM runtime and its license are in [`wasm/`](wasm/); the package/version and source commit are recorded in `wasm/runtime.json`.
