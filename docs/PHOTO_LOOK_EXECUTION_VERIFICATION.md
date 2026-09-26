# Photo looks across images and folders

Implemented 17 September 2026 for §5A/§5B of the
[migration plan](../MIGRATION_PLAN.md). The photo-color component of the shared
style library now works on independent images and large-folder jobs. Typography,
layouts, cutouts, output variants and grouped story execution remain separate
required integrations. This is not completion of the entire preset workstream.

## User workflow

**Photo look** is available in the image tray, Results and the phone's native
Batch sheet. The chooser offers For these photos, Saved and Recent, with
favorites and previews made from the user's source photo. It explicitly applies
photo colors; the selected style's paper, typography, layout and output settings
are not silently presented as applied. Styles without a Look component explain
that they cannot supply photo colors. Unsupported required capabilities and
renderer versions remain unavailable.

Choose All images, Selected images or This image. A meaningful photo-color
strength slider and **No photo look** are available. Browsing, moving the slider
and changing scope only affect the chooser's preview. Apply remains disabled
until the actual worker preview succeeds; an error exposes Retry preview.
Cancel/Escape leaves the image set unchanged.

Apply copies the chosen component into the shared or per-image edit layer.
Manual crop, rotation, flip, brightness, contrast and text corrections remain
separate. Choosing a built-in output destination retains the creative look.
The dedicated **Undo look change** action restores the preceding look fields
without reverting subsequent unrelated corrections. Its bounded history is
in memory; this does not claim one unified undo stack across every legacy image
and batch operation. Recovery retains the applied definition, revision and
strength after changes to or deletion from the style library.

The folder form follows Source → Recipe → Photo look → Save results to. Finish
discovery and choose Photo look before selecting the output destination; the
form explains that this destination fixes the recipe and look. The chooser
renders the first source image. Apply atomically saves
a new private recipe containing the copied base recipe and photo look. A failed
transaction retains the old job and the open draft for retry. Source, output and
start controls stay fenced during the choice/commit. The look locks when an
output destination is attached, so it cannot change halfway through a job.

The folder sample is currently one image. Representative multi-aspect sampling,
measured time estimates, grouped stories and variants remain required by the
full bulk plan. Existing folder ownership, source checks and output journaling
continue to apply.

## Rendering and storage contract

The [bounded component format](../src/compositor/photo-look.js) stores a schema
version, source style ID/revision/name, compatible engine/compositor versions,
brightness/contrast/saturation/grayscale-mix parameters and strength. It contains
no source image, caption, exact crop, layout, executable content or remote asset.
The [style adapter](../src/styles/photo-look.js) validates the source style and
copies only the explicitly selected photo-color component. Recovery validates
shared and per-image bindings before changing the open image set; unknown
component versions are preserved rather than coerced.

Pillow applies the resolved photo treatment after geometry/resize and before
the existing manual adjustments and text. The existing transform order remains
unchanged when no look is present. Strength interpolates numeric appearance
parameters from their neutral values; 0% skips those adjustments and reproduces
the original transform output exactly. Full exports use one final PNG/JPEG
encode. Old adjustable-quality requests remain explicit errors.

The [preview path](../src/styles/photo-look-preview.js) renders the actual output,
then uses Pillow to downsample those encoded pixels into a bounded PNG. Thus JPEG
flattening/encoding is reflected in its preview. This costs more than resizing
the source first; the scheduler accounts for the additional buffers. The actual
export pipeline does not incur the extra preview encode.

All previews use the existing shared admission scheduler: active preview has
priority over gallery thumbnails, copies occur after admission, visible cards
load lazily and departed cards cancel their work. A folder sample is inspected
once per chooser/scope and its dimensions are shared by its previews. Source
retention, preview blobs and decoded preview planes are registered with the
scheduler and released on close. A completed logical preview client now waits
for its task to finish before retiring, allowing physical workers to be reused.
Look processing and downsampled previews have distinct timing classes and
additional memory estimates. These changes do not complete whole-app retained
memory accounting or cross-tab CPU admission.

## Evidence

- Seven [model tests](../tests/photo-look.test.mjs) cover immutable extraction,
  0% strength, malformed/future settings, unsupported engines/capabilities,
  all/selected/this scopes, preservation of unrelated edits, stale-undo refusal,
  copied folder output settings, memory estimates and pre-restore validation.
- The [browser regression](../tests/photo-look.browser.mjs) compares actual
  image-set output with direct Pillow rendering and independently applies the
  published Pillow brightness/contrast/color primitives to check the pixels.
  A manual flip survives look changes, one-image scope, Undo and an output-preset
  change. Reload preserves the output bytes.
- Real OPFS folder processing produces the same bytes as image-set processing
  for the same source/settings. An injected IndexedDB quota error preserves the
  original recipe, keeps destination selection fenced and permits a successful
  retry of the chosen look.
- A translucent 1100 × 800 fixture verifies that both PNG and JPEG previews are
  exact Pillow downsamplings of the actual encoded output. Zero-strength output
  matches the unstyled transform byte for byte. Every alpha value in the PNG
  remains unchanged by the photo-color operations.
- Twelve previews at each of 1/2/4/8 workers return identical output and stay
  within the scheduler's declared concurrency/memory limits. Releasing them
  returns retained accounting to its starting value. These small fixtures prove
  correctness and accounting behavior, not throughput, observed RSS or sustained
  phone performance.
- Phone Chromium at 375 × 667 exercises the native Batch sheet, a genuine worker
  decode failure and retry, Saved/favorites, keyboard focus after library refresh,
  200% text without horizontal sheet overflow, and touch targets of at least
  44 pixels. At default text size all three initial choices, with source-photo
  thumbnails, are fully visible above the fixed Apply footer without scrolling.
  Updating then deleting a custom style still permits byte-identical
  recovery. See the [200% capture](research/2026-09-17/photo-look-phone.png) and
  [default-size capture](research/2026-09-17/photo-look-phone-default.png).
- `npm run verify`: passes runtime integrity, app checks, 11 scheduler tests and
  65 project/style/recovery tests.
- `npm run migration:parity`: 33/33 existing comparisons pass in run
  `parity-c5ca8611-4db5-4649-8fdc-ddcc6f9320dd`. This verifies the inventoried old
  PNG behavior; it is not a claim of reference parity for a newly added feature.

The full `npm run verify:browser` suites passed against both the source tree and
the optimized `_site` artifact, including the existing editor, story, recovery,
folder and responsive-layout regressions. After the final HTML-only folder-step
reorder and performance-help correction, the focused desktop/phone photo-look
suite passed against the source and the rebuilt artifact. The final artifact
contains 149 validated files: app JavaScript is 402,346 bytes (128,547 bytes in
Brotli sidecars), CSS is 60,189 bytes (9,510 Brotli), and the unchanged published
WASM is 4,548,741 bytes (1,170,855 Brotli). These are packaging sizes, not runtime
memory or load-time measurements.

No deployment, performance benchmark or production-readiness claim accompanies
this change. The earlier failed microbenchmark remains recorded. Finished launch
recipes, real-photo visual review, richer style components, complete preflight,
physical-device testing and release gates remain in the
[execution ledger](MIGRATION_STATUS.md).
