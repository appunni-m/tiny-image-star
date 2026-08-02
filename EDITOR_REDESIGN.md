# Tiny Image Star editor redesign

## Product posture

Tiny Image Star is an editor for one image at a time, with a first-class batch
workflow beside it. The primary action is opening an image and manipulating
it on a central stage. Batch import and ZIP export reuse the same verified
recipe and engine boundary without turning the editor into a settings form.

The main interaction should feel like a small, calm Figma canvas:

1. Open one local image.
2. See it centered immediately on a checkerboard stage.
3. Pan and zoom directly on the stage.
4. Choose a small tool: move, crop, rotate, flip, or adjust.
5. See the current operation immediately, with a lightweight processing state.
6. Save the latest completed PNG output or save the visible recipe as a local
   preset.

## Layout

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Tiny Image Star       Editor  Images  Presets      Open  Save        │
├───────────────────────────────────────────────────┬──────────────────┤
│                                                     │ contextual      │
│                    canvas stage                    │ controls        │
│              image + crop frame/handles             │ crop / resize   │
│              pan / zoom / fit                       │ adjust / output │
├───────────────────────────────────────────────────┴──────────────────┤
│ Move  Crop  Adjust  Save     rotate  flip       zoom  Fit             │
└──────────────────────────────────────────────────────────────────────┘
```

The canvas stays central and the tool rail is a compact bottom toolbar on
desktop. The right side is contextual: it shows only the controls for the
active tool. Presets open as a side drawer over the current view, so choosing
a recipe never feels like leaving the editor. On narrow screens the toolbar
stays horizontal and the controls become an expandable bottom sheet.

The empty editor deliberately shows only the drop/choose action. Tool panels,
history, export, and status indicators appear after an image is open. This
keeps the first decision visual and avoids teaching users disabled controls.

## State and render boundary

The source file and serializable operations are canonical. View state is
separate and never changes the saved image:

```text
source bytes + operations ──> Pillow-RS worker ──> latest output bytes
             │
             └──────────────> browser canvas preview

view state: { tool, zoom, panX, panY }
operations: { crop, rotation, flipX, flipY, brightness, contrast, grayscale,
              resizeWidth, resizeHeight, resizeMode, format, lossy, quality }
```

Canvas/SVG/DOM owns selection outlines, crop handles, pan, zoom, and transient
feedback. Pillow-RS owns pixel transformations and the downloadable output.
The UI must never present a canvas screenshot as the saved file.

## Capability boundary

The first editor only exposes operations verified in the generated binding:

- crop and resize;
- 90° rotation and horizontal/vertical flip;
- brightness, contrast, grayscale;
- PNG output.

Blur, sharpen, arbitrary rotation, quality controls, metadata policy, and
additional output formats can be added only after the binding has an explicit
adapter method and a browser fixture test. AVIF remains unavailable until the
known WASM decode/encode gates are resolved. No feature is promised merely
because the Rust library contains an implementation.

## Readiness contract

The underlying engine still has explicit **Starting**, **Ready**, and
**Not ready** states, but healthy **Ready** is intentionally quiet in the
product UI. Users see a small activity indicator only while an image is being
processed, and an actionable message when something fails. The app never
shows “Updating preview” before real work starts and never treats a stale
result as a successful current export. Current output bytes are held only for
the active editor state and are discarded when the source or operations change.

The UI also keeps the output boundary honest: the save review sheet reports
the actual dimensions and byte size of the latest completed PNG, and the
download copy says that a download started rather than claiming that the
browser has finished saving the file.

## Delivery slices

1. Establish the calm editor shell, persistent Editor/Images navigation, and
   the central stage.
2. Add open-image, canvas preview, pan/zoom, crop selection, rotate, and flip.
3. Add contextual resize/adjust controls, undo/redo/reset, dirty state, and
   the export review sheet for the verified PNG path.
4. Keep batch workflows aligned with the editor: named local recipes apply to
   a batch, completed items are selected for export, and per-item canvas
   corrections remain explicit overrides. Additional files can be appended
   without discarding completed cards; each card shows output dimensions,
   output size, and the size change from its original.
5. Revisit additional formats only after the binding capability gates pass.
