# Phone shell implementation evidence

Recorded 2026-09-16. This is implementation evidence for part of phase 2 in
[the migration plan](../MIGRATION_PLAN.md), not mobile production certification.

The loaded phone workspace now has a 56px header, the canvas, a horizontal
thumbnail/selection strip, and a six-tool dock. More contains presets, results,
history, rotate/flip/zoom, and appearance. Batch contains scope, destination,
verified output settings, selection, and save. Each editing tool opens its
contextual settings. Native dialogs provide modal focus containment and Escape;
closing a sheet keeps edits and restores focus. The real controls move between
phone sheets and their desktop positions without rebuilding their event state.

The header export action is labeled Export; its accessible name identifies the
current output format. Engine startup/failure status remains visible in the
header. Thumbnail framing warnings remain visible and accessible. Unsupported
encoder options stay hidden in sheets. Dynamic viewport units have a `vh`
fallback and safe-area padding is enabled.

Automated source and exact packaged `_site` Chromium checks passed with the
existing full regression suite. Runtime integrity, `npm run verify`, artifact
validation and documentation links also passed:

- The canvas begins approximately 106 CSS px below the top of a 390×844 screen
  and occupies 556 px (66% of its height). At 375×667 it occupies approximately
  379 px (57%); the editing dock fits inside the viewport.
- All six tools remain visible at 320/375/390px widths without overlap or clipped
  labels. Presets, batch settings, and all seven auxiliary image actions remain
  reachable. Desktop controls return after resizing out of phone layout.
- Closing and reopening settings preserves a real grayscale edit. Resizing to
  desktop preserves it too. Undo/reset, source/edited comparison, crop and text
  workflows retain the existing browser regression coverage.
- More uses a native modal dialog; keyboard traversal does not enter background
  controls, Escape dismisses it, and focus returns to its trigger. Navigation
  from More dismisses the sheet before opening Presets.
- Editor and Results have no page-wide horizontal overflow at 200% text size;
  the sheet's appearance selector remains reachable. The smaller screen test
  exposed an intrinsic canvas sizing bug; the stage now shrinks after viewport
  changes instead of retaining its previous canvas height.

Visual inspection used the repository's synthetic 8×8 PNG fixture, not a visual
quality or performance corpus. Reference screenshots are stored alongside the
research evidence: [canvas](research/2026-09-16/phone-canvas.png),
[small phone](research/2026-09-16/phone-small.png),
[More](research/2026-09-16/phone-more.png),
[Batch](research/2026-09-16/phone-batch.png), and
[Text](research/2026-09-16/phone-text.png).

Still required: real iOS/Android files and keyboard tests; physical safe areas;
platform Back navigation; landscape/keyboard-open states; VoiceOver/TalkBack;
complete WCAG audit; gesture and undo behavior for the forthcoming story graph;
and the phase 0/launch user studies. Browser emulation does not prove these.
