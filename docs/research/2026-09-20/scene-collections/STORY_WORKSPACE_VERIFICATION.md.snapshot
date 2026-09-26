# Mobile story workspace

Update, 20 September: the [authored recipe catalog](STORY_RECIPE_VERIFICATION.md)
now supplies Scrapbook, Depth cover and Film diary compositions, attached
decorations and cover/detail/closing typography. New workspace stories start
with Scrapbook; old saved stories retain their graph. The earlier color-only
choices described below now live in Photo looks. [Revision-two fonts](STORY_FONT_VERIFICATION.md)
now ship with the recipes and are retained with saved stories; an explicit
device-font alternative preserves words and placement. Representative typography
and full recipe/device qualification remain open.

The later [multiple-shape export workflow](STORY_EXPORT_VERIFICATION.md) adds
an upfront output count, Portrait/Tall/Both selection, independent failures,
pause/continue, retry-only-failed and an attention filter. Output choices also
round-trip through saved styles. Choices survive reload; prepared files and
queue progress remain local to the open export sheet. Native sharing retains
its own encoded-byte reservation until the share promise settles.

Recorded 2026-09-17. The scene API now has a visible workflow, available through
**Make a story** on the empty canvas and in navigation (More on phones). This
is an implemented part of migration phases 3–4, not completion of the authored
recipe, cutout, performance or production release gates.

## Working flow

Choose 6–12 PNG, JPEG or still WebP photos and a title. The assembler places
every chosen photo once, in order, across 4–8 slides with a cover, one/two-photo
pages and a closing page. Import inspects actual bytes in admitted workers,
checks animation and hashes source identity. It retains immutable File/Blob
sources instead of decoding every original into a DOM image. The aggregate
source limit is 96 MiB; existing story recovery retains its shared 128 MiB
asset-store limit. These limits do not establish physical-device capacity.

The viewport has a compact header, dominant rendered artwork, a horizontal
filmstrip and Look/Layout/Photos/Text/Adjust controls. Controls use the existing
Light/Dark/System theme. Native modal sheets keep the image editor's keyboard
shortcuts from changing hidden work. Browser history closes a tool before the
story; cancelling a tool restores its pre-edit document. Undo/redo treats all
previews within a tool as one command. The previous image/set/folder workflows
remain available when leaving the story.

- **Look:** Scrapbook, Film diary and a neutral Clean treatment, with previews
  made from the current photo composition. Whole-story and this-slide scope,
  and a separate appearance-strength control, preserve geometry and captions.
  Definitions and revision numbers are copied into the document. The local
  [style library](STYLE_LIBRARY_VERIFICATION.md) adds Saved/Recent, favorites,
  My styles, inclusion choices and bounded `.tstyle` import/export.
- **Layout:** tilted or straight frames, slide reorder with updated numbering,
  and 1080×1350/1080×1920 output variants. The selected variant survives reload
  and participates in cancel/undo. New stories use [adaptive photo-print
  layouts](ADAPTIVE_LAYOUT_VERIFICATION.md), including row/stack choices,
  per-shape manual positions and explicit keep/reset review. Older stories
  retain their layout until the user chooses Adapt to photos.
- **Photos:** replace a slot using another imported photo, adjust its focal
  position, zoom into a crop, or reset to the full photo. Replacement removes the old source's mask
  dependency. It does not delete the original asset needed by undo.
- **Text:** edit the caption and preferred size. The scene renderer handles
  wrapping/shrinking and exposes clipping for review.
- **Adjust:** local brightness, contrast and saturation, with an action to
  return to the shared look.

Scrapbook and Film diary are initial treatments on the paper-print layout.
Clean is a useful neutral choice, **not a substitute for the planned Depth
cover recipe**. The launch catalog still needs finished authored layouts,
portrait/landscape and count-extreme visual review, licensed fonts/textures,
cutout integration, legacy/per-image style migration and licensed asset packs.

## Rendering and export

Current-slide previews, filmstrip thumbnails, look thumbnails and export all
call the [same scene renderer](SCENE_COMPOSITOR_VERIFICATION.md). They share the
global processing queue with the image editor and folder jobs. Source buffers
are copied only after admission; current previews take priority and obsolete
thumbnail tasks are cancelled. Closing sheets releases their look/export object
URLs, and closing the workspace releases rendered preview resources.

The workspace charges retained source sizes, preview/thumbnail encoded bytes
and decoded planes, look previews and staged export files to the shared ledger.
Canonical composition still precedes preview downsampling. Storage hashing,
browser cache/decoder allocation and actual process memory require further
measurement; this is not a claim of complete memory accounting.

Export freezes the current document revision and prepares PNG or fixed-setting
JPEG in slide order. The UI reports count, dimensions, size, text and layout warnings.
It offers actual-file sharing only after preparation and a positive `canShare`
check. The Share button invokes the share sheet from a fresh user click; an
ordered list of individual download links remains available. It does not claim
that opening/closing the OS share sheet means a destination saved the files.
Changing format or closing export cancels work and releases staged results.

## Recovery and conflicts

Committed edits autosave to the existing transactional story store. Previews
inside a tool are not saved as committed edits. The saved-story list reopens
the exact graph, sources, recipe definition and selected variant. A failed save
is visible and retryable. A conflicting tab's saved revision is preserved; the
user can save their open edit as a separate project with **Save a copy**.

Local data cleanup now includes saved story records and their unreferenced
assets. The open composition stays available in memory and does not immediately
recreate a cleared saved copy. A later edit enables saving again. The existing
private backup includes stories; archive import remains unfinished.

## Evidence

[The workspace browser test](../tests/story-workspace.browser.mjs) uses native
dialogs, actual IndexedDB, the real published Pillow WASM and a 375×667 touch
viewport. Its six generated landscape/portrait PNGs are synthetic diagnostics,
not stock photos or evidence of recipe quality with real portraits.

It checks assembly, source replacement/reflow, crop zoom, per-shape manual
positions, overlap/clipping warnings, keep/reset/cancel/undo, captions, repeated
look previews with one undo, output-variant cancel/reload, four independently decoded
1080×1920 JPEG exports in order, an actual download event, browser Back, competing
tabs and conflict-copy preservation. It waits for every filmstrip and own-photo
look preview to render. The share API is replaced by a test double solely to
verify ordered File objects and live user activation; real OS destinations remain
unqualified. Source and assembled Pages builds run the same workflow.

Normal-size controls meet the 44-pixel secondary-control target and the stage
exceeds 55% of the reference viewport. Larger-text checks use a 32px root font
and verify workspace/sheet width; this does not replace platform text scaling,
virtual keyboard, landscape, VoiceOver/TalkBack or physical touch testing.
The first larger-text run exposed a 549px implicit grid column inside the
375px dialog. A bounded width probe showed that an explicit `minmax(0, 1fr)`
root column restored all measured workspace widths to 375px. The fix constrains
the grid track while allowing the tool strip to scroll; it does not clip the
overflow or shrink the user's text. The regression retains the same text size.
[Light](research/2026-09-17/story-phone-light.png) and
[dark](research/2026-09-17/story-phone-dark.png) reference screenshots were
visually inspected after thumbnails and theme transitions completed.

Reloading with saved manual positions exposed a separate browser-history
regression: opening the studio pushed a new entry over a stale entry from the
previous page instance, so Back could leave it open. Modal entries now carry a
page-instance identifier; old entries act as closed rather than reopening
stale sheets. The regression reloads while a manual override is saved, checks
identical rendered pixels, and later verifies tool Back, studio Back and the
older history entry. Unrelated browser-history fields are preserved.

Thirty-three Node project/model/layout/style tests include every photo count from 6 through 12,
both viewport variants, exact photo placement coverage, strength/geometry
separation, preserved crops/focal points and reversible slide numbering.

Remaining work includes finished authored recipes and real-photo layout review, connected story
artwork controls, cutout creation/repair, production font/typography coverage,
legacy and bulk style integration, archive import/offline packs, representative bulk
and device performance, user studies and all release gates in the
[migration ledger](MIGRATION_STATUS.md).
