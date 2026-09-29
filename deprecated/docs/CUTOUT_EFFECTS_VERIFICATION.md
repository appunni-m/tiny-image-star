# Cutout outlines, shadows and reusable finishes

Recorded 2026-09-17. This implements subject decoration for the manual/imported
cutout workflow in migration §5 and adds a reusable finish component to §5A.
The [migration ledger](MIGRATION_STATUS.md) retains the remaining complete scope.

## Editing and saved behavior

Cutout → Outline & shadow offers separate switches for a colored outline and
shadow, an own-slide preview, and controls for width, color, shadow strength,
softness and horizontal/vertical offset. Distances use the canonical slide
height, so the same stored parameters adapt to both supported output shapes.
The source mask, crop, photo treatment and original file remain independently
editable. Temporarily switching a finish off and on within the sheet restores
its adjusted parameters. Applying the sheet commits one history entry; Cancel
or browser Back restores the earlier revision.

Connected copies inherit the starting finish and can subsequently be edited
independently of the original photo. A connected copy's finish applies to both
halves. Removing/replacing a mask preserves the finish parameters but suspends
their rendering and shows a review warning. Undo or a new subject selection
restores the effects. No automatic segmentation or new model pack is implied.

Save my style has an optional **Cutout finish** component and an explicit source
photo chooser. The style contains only outline/shadow parameters, without source
IDs, photos, masks, captions or crop geometry. Applying it changes existing
subject selections in the selected slide or whole story; photos without masks
are left unchanged. The selection UI explains this boundary and that connected
subjects also change on the neighboring slide. A scope without a selected
subject is rejected. Color-only styles preserve the existing cutout finish.

## Rendering contract

`cutoutEffects` is optional, schema 1, on scene image nodes only. Validation
rejects unknown fields, unsupported versions, nonfinite numbers, invalid colors,
outline width above 2% of slide height, blur above 3%, offsets beyond ±5% and
opacity outside 0–1. Style definitions declare `cutout-effects-v1` and freeze
the applied revision. Unsupported older readers fail their strict schema rather
than discarding these settings. The app's broader immutable compositor-release
identity remains an open migration gate.

The outline is an exact grayscale maximum over an integer-radius circular
neighborhood. Sliding row windows share work across equal disk widths. The
implementation retains one-level alpha and soft coverage instead of thresholding
the mask into a binary contour. Radius rounds to a canonical pixel, with one
pixel minimum for a positive width. Source alpha and the subject mask combine
before effect generation. The shadow uses the outlined silhouette, Pillow's
Gaussian blur, integer canonical offsets, a chosen color and strength.

Rendering transforms/clips the foreground into a padded viewport, derives the
decoration, composes the complete group, applies photo opacity once and crops
back to the requested slide. Adjacent slides receive the same surrounding
pixels. Padding accounts for outline, blur support and either offset direction.
This permits an off-page subject's visible shadow to be rendered without a
story-wide bitmap. Missing masks produce a visible warning and the original
photo fallback; they do not outline the unselected photo rectangle.

For depth titles, decorated foreground and original-photo inputs preserve the
existing word/subject composition. The original-photo branch protects the
subject portion and places the decoration over the remaining background.
The title keeps its independent opacity. A decoration with zero coverage
preserves the original bytes. Fully disabled effects use the previous rendering
path. Previews still downsample the canonical Pillow result once, and Pillow
encodes the final PNG/JPEG.

## Resources and concurrency

Scene admission now reserves the padded native images and JavaScript buffers
before copying/decoding source assets. It budgets the largest live decorated
layer, not an entire stitched story, and gives effects a separate scheduler work
class. Existing shared origin admission still applies. These are conservative
estimates, not complete native/GPU memory measurements.

A policy-only capacity probe also exposes a remaining camera-photo limitation.
For a 1080×1920 slide with the default outline/shadow, a 4000×3000 source and
matching mask (5 MiB and 1 MiB encoded) reserve about 549 MiB, or 683 MiB with
a depth title. Both exceed the 512 MiB default when `deviceMemory` is absent,
before other retained previews/assets are counted. The corresponding
2000×1500 estimates are about 343/477 MiB. These are calculated reservations,
not measured memory or successful device runs. Large camera sources therefore
need a qualified bounded-resolution working-copy/decode strategy before this
workflow can promise general phone compatibility or high concurrency. Do not
raise the limit or lower estimates merely to make the example pass.

The subsequent [scene materialization optimization](SCENE_MATERIALIZATION_VERIFICATION.md)
avoids repeated lazy transform work and detaches loaded viewports from their
source pipelines. Its paired diagnostic results preserve pixels. It leaves
these capacity estimates and the working-copy requirement unchanged.

The finish preview reuses the current rendered slide URL and accounts for an
additional decoded surface. Stale images lose their source while a new revision
renders. Closing the sheet clears both finish and connected-spread image sources;
later status/thumbnail updates cannot repopulate a closed sheet. Worker and
native-image cleanup follows success, cancellation and error paths.

## Verification

The new deterministic tests compare circular dilation against an independent
neighborhood oracle, including single-row/column images, corners, soft masks and
transparent boundaries. Premultiplied layer-stack calculations independently
check depth decoration. They also cover strict schema/ranges, grouped history,
connected copies, missing-mask retention, off-page effect visibility, padded
admission and scoped parameter-only preset reuse.

The [phone control screenshot](research/2026-09-17/cutout-effects-phone.png)
was visually inspected: the primary switches precede the own-slide preview;
sliders and colors are under Fine tune finish. The source suite also caught a
stale-panel regression during connected-copy removal. Status refreshed after
the node was deleted but before its replacement panel mounted. The finish panel
now tolerates that interval and clears its old preview. The isolated existing
connected-cutout and new finish suites both passed after the correction.

Four [real-photo examples](research/2026-09-17/cutout-finishes/evidence.json)
compare [plain](research/2026-09-17/cutout-finishes/plain.png),
[outline](research/2026-09-17/cutout-finishes/outline.png),
[shadow](research/2026-09-17/cutout-finishes/shadow.png) and
[combined](research/2026-09-17/cutout-finishes/combined.png) treatments at
1080×1350. The combined result was visually inspected. The NASA/Eileen Collins
public-domain source and pre-existing research mask are identified by hashes;
credits are printed in the outputs. These use the uncorrected portrait-model
mask from the earlier spike. Stray coverage and rough areas near the arm become
more noticeable with an outline, confirming the need for mask repair rather
than certifying model quality. This is one photo, not a representative corpus.
Reproduce it from the repository root with
`node scripts/research/cutout-effects-photo-proof.mjs`.

The deterministic suites pass 13 scheduler and 90 model/style/recovery tests
(103 total, including six new finish tests). Published/legacy adapter comparisons
remain 33/33 in run `parity-f7798da3-1008-4c9e-9f4d-8cfac8392cc1`.

The focused browser run exercises the real published Pillow pair and
independently decoded output. Six connected-spread cases—two aspect ratios,
each with no depth title, original-photo depth background or page depth
background—have zero channel difference from a continuous double-width render.
Rotated/cropped soft masks, source alpha, opacity and offset shadows are included.
An independent point-mask fixture checks outline geometry and exact spatial
color/alpha values. Preview equals the canonical Pillow downsample exactly.
Worker counts 1/2/4 produce identical results with no admission-counter
violations; these are correctness checks, not throughput measurements.

The 375×667 phone-emulation workflow passes own-slide preview/cleanup, 200% text,
grouped undo/redo, Back/cancel, both shapes, reload, saved finish reuse,
missing-mask retention and actual saved PNG export. Browser emulation does not
qualify a physical phone.

Both final full Chromium processes exited successfully: the source run with
`TINY_IMAGE_STAR_EFFECTS_ARTIFACTS=1 npm run verify:browser`, followed by
`TINY_IMAGE_STAR_BROWSER_ROOT=_site npm run verify:browser`. Existing editor,
batch, folder, style, recovery, storage and mobile-shell regressions also pass.
The [verification record](research/2026-09-17/cutout-finishes/verification/result.json)
contains seven hashed logs, the earlier connected-copy removal failure and its
successful regression rerun, 154 source/test input hashes, 179 packaged file
hashes and the capacity-probe inputs/estimates.

The final Pages artifact contains 179 files. App JavaScript totals 462,247
minified bytes (150,858 bytes in Brotli sidecars); CSS totals 62,679/9,837 bytes.
The unchanged published WASM remains 4,548,741 bytes (1,170,855 Brotli).
These are artifact sizes, not transfer-time, memory or speed measurements.
The build validates syntax and sidecar round trips; documentation links and
`git diff --check` also pass. No deployment was performed.

## Remaining release evidence

The synthetic regression fixtures are not a representative hair/fur/glass/skin
quality corpus. Real photographs require edge/halo review at source resolution
and final export scale, plus authored recipe review. Physical iOS/Android
responsiveness, sustained processing, native/GPU memory, screen readers and the
complete preset release gates remain open. This component currently applies to
story subjects; legacy per-image and large-folder cutout recipes remain separate
unfinished work. Automatic subject selection retains all
[model research gates](SEGMENTATION_RESEARCH.md).
