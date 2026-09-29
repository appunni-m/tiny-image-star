# Local Studio

An independent, local-first design editor being built from a clean repository root. The previous Tiny Image Star application and its Figma experiment are archived under [`deprecated/`](deprecated/).

The new app is plain browser code with no remote services or runtime packages. Its current foundation includes a canvas workspace, frame and shape tools, selection and movement, layer selection, property editing, local document persistence, undo/redo, project import/export, and PNG export for a selected layer.

Run it with Node.js 20 or newer:

```sh
npm run dev
```

Then open <http://127.0.0.1:8000/>. Set `PORT` to use a different port. Run the model tests with `npm test`.

The app is an early foundation, not a feature-complete Figma replacement yet. Text editing, pen/vector paths, nested layers and constraints, components, prototypes, collaboration, and the bulk recipe workflow remain future work.
