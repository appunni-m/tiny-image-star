# Tiny Image Star Design

A local-first, Figma-inspired design workspace. This prototype is archived in
`deprecated/figma-rewrite/`; the previous image-editor implementation is in
the parent `deprecated/` folder.

The current foundation has an in-memory canvas document, independent pages,
editable layers, touch-sized resize handles, keyboard nudging, vector/text
tools, responsive inspector controls, and multi-page local project files that
include placed image originals. Pillow-RS WebAssembly performs image
decoding and edits on this device; the design canvas stays live while
properties change.

## Run locally

```sh
npm ci
npm run build
npm run serve
```

Then open <http://127.0.0.1:8000/>. `npm run build` stages the pinned local
Pillow-RS runtime and assembles the static Pages site in `_site/`.

This is an early foundation, not a claim of complete Figma parity. Online
collaboration, plugins, and every advanced design/prototyping feature still
need implementation.
