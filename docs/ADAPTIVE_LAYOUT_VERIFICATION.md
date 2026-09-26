# Adaptive photo-print layouts

Recorded 2026-09-17. This implements automatic photo-print reflow for the
[mobile story workspace](STORY_WORKSPACE_VERIFICATION.md). It is part of
phases 3–4, not completion of the three authored launch recipes or proof of
production readiness.

## Behaviour

New stories store independently computed 4:5 and 9:16 frames. For each page,
the solver considers side-by-side and stacked arrangements, fits each upright
photo without changing its proportions, and chooses the larger combined photo
area. A portrait pair changes from a row at 1080×1350 to a stack at 1080×1920.
Users can explicitly choose either arrangement. An infeasible candidate does
not suppress another valid automatic choice; an impossible explicit choice
fails without changing the document.

Border thickness, gaps, margins and type sizes are based on output width.
The fit includes the rotated border's extent, so tilted prints stay inside
their slots. The group is centred with its caption instead of stretching the
original normalized frames. Source crop bounds use the renderer's floor/ceil
pixel convention. Very narrow crops that cannot occupy at least one output
pixel are rejected with a correction message.

Caption length, line breaks and preferred type size reserve bounded space.
This is a deterministic estimate, not a font-shaping engine. Actual rendering
still measures, wraps and shrinks the text, with explicit overflow warnings.
Changing a source, crop, caption, preferred size or print rotation reflows the
affected page's variants in the same undo transaction. Other slides retain
their render descriptions. Look changes preserve geometry, crops and masks.

Photos exposes crop zoom, framing within the crop and a full-photo reset.
Layout exposes position and print size for the current output shape. The photo
and its border move together. Reflow keeps these manual frames by default;
**Reset adjusted positions** explicitly removes geometry overrides for both
shapes on that slide, preserving crops, captions and appearance. Apply creates
one undo entry; Cancel restores the document before opening the sheet.

Rotated-rectangle intersection and page-boundary checks flag overlaps and
off-page placements in the layout sheet, preview and export review. An overlap
may be intentional, so this is a review warning. It is not face detection,
semantic subject protection, a claim that every photo is well composed, or a
complete text/decoration collision solver.

## Stored contract

The project copies a bounded `photo-prints` version 1 definition, numerical
constraints and explicit per-slide bindings under `recipe.layout`. Managed
photos, borders, captions and page numbers must refer to distinct, slide-local
nodes of the expected kinds. Layout commands reject unknown versions,
properties, invalid constraints, missing nodes and cross-slide bindings.

The computed node `variantFrames` are stored in the document. Rendering and
reopening do not execute the solver or consult a newer catalog. Frame
precedence is local variant frame, local shared frame, node variant frame,
then the original node frame. Only the selected frame appears in a resolved
render description, so another variant's adjustment does not invalidate this
preview. `fontBasis: "width"` is optional; absent means the previous height
basis. Legacy image nodes reject variant frames.

The optional fields extend the existing scene contract without changing the
rendering of old documents. Older app versions have strict node/style keys
and reject these fields rather than silently using a different frame or font
size. The pinned Pillow engine bytes and existing compositor identity remain
unchanged. A later solver change must have a new layout version; changing
existing field semantics requires an explicit renderer migration.

Previously saved `paper-prints-v1` stories retain their exact frames and type
basis. **Adapt to photos** opts the selected slide into the current definition
as a reversible edit. Unknown future layout definitions can render their
frozen frames but cannot be silently adapted by this solver.

## Evidence and limits

Final checks for this change passed: `npm run verify` (24 project/layout and
11 scheduler tests), full `npm run verify:browser` against source and against
the assembled `_site` build, Pages artifact validation, 31-document link checks,
whitespace checks and the unchanged two-endpoint/33-case migration manifest.
The packaged build contains 119 files, 317,166 bytes of optimized JavaScript
and the unchanged 4,548,741-byte published WASM. These sizes are packaging
facts, not throughput or release-readiness measurements.

[Nine layout tests](../tests/story-layout.test.mjs) join the fifteen existing
project tests. They check every count from 6–12; portrait, landscape, square,
mixed and 32:1/1:32 diagnostic aspects; both outputs; long captions; rotated
border safety; actual row-to-stack changes; variant-local invalidation; crop
rounding; preserved masks/focal/appearance/text; source replacement; manual
keep/reset; reversible transactions; old-document opt-in; and malformed data.
The corpus checks geometry, not perceptual design quality.

The [scene browser test](../tests/scene-compositor.browser.mjs) compares actual
Pillow PNG renders against a plain graph with the selected frames and physical
text sizes baked into it, for both shapes. The [mobile browser test](../tests/story-workspace.browser.mjs)
exercises actual source replacement, crop zoom, position warnings, per-shape
overrides, keep/reset/cancel/undo, variant selection and exact saved reload.
It also exports and independently decodes ordered JPEGs. See the workspace
report for test-double and physical-device boundaries.

Remaining work includes finished Scrapbook/Depth cover/Film diary composition
rules, licensed typography and decorations, manual/imported cutouts and repair,
connected artwork editing, real-photo design review and observed phone tasks.
These layouts do not establish semantic image matching, generative editing,
bulk-story grouping, representative high-concurrency throughput or any of the
[production release gates](MIGRATION_STATUS.md).
