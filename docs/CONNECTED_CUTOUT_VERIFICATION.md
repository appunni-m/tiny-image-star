# Connected cutouts

Implemented toward §5 and phase 4 of the [migration plan](../MIGRATION_PLAN.md).
A manually selected subject can now be copied across two neighboring story
slides. This uses the existing published Pillow runtime, masks, scene renderer,
shared scheduler and transactional recovery store.

## Phone workflow and composition

Open **Cutout → Across slides** on a photo with a subject mask, then choose
**Add connected cutout**. This makes an independent copy above the existing
slide artwork. The original photo remains in its layout. The copy starts at
the join; on the last slide it uses the preceding pair.

The connected copy has a two-slide preview and controls for the joined pair,
horizontal/vertical position, size and rotation. It supports keyboard-operated
sliders and buttons; dragging is not required. Position and size are stored for
each output shape. Rotation, source, crop, mask, look and an optional depth title
are shared across both halves. **Refine this subject** exposes the existing
source-pixel mask controls. **Photos**, **Adjust** and **Text** can select the
connected copy as well.

Mask bytes are shared when the copy is created. A subsequent mask edit replaces
only that copy's mask reference. Removing either mask does not delete an asset
still used by the other photo. Without a mask, the copy shows its original photo
across both slides with a visible explanation in preview and export review.
Corrupt supplied assets still fail integrity checks. **Remove connected copy**
removes the copy and its linked title; ordinary source photos remain. Undo
restores the complete copy.

Joined slides move as one block. If several cutouts connect a chain of slides,
the entire chain moves together. Moving past another connected block exchanges
the blocks and preserves both internal orders. The Layout controls explain
this rule and disable moves beyond either story boundary. To separate slides,
move the cutout to another pair or remove its connected copy.

The spread preview reuses the existing bounded thumbnails; it creates no
additional rendering queue. The memory ledger conservatively reserves an extra
160 × 160 RGBA surface for each of its two image elements. Closing the sheet
clears their source URLs and releases those additional reservations.

## Document and renderer contract

An image may carry `connection: { schema: 1, rightSlideId }`, with `space: story`
and its left `anchorSlideId`. The model requires adjacent slides, exactly one
shared image node on each of the two slides, and no one-sided overrides on the
image or its linked depth title. Unknown connection fields/schemas and split
pairs are rejected. Moving the pair updates slide order without rewriting its
geometry. Moving the cutout to another pair carries its linked title too.

The renderer uses coordinates relative to each object's anchor and a raster
grid aligned to the object's integer origin. The first
native regression exposed a pixel change when an otherwise unchanged pair
moved in absolute story coordinates. Fixing the grid's origin preserves the
same sampling phase after reorder. The full regression suite then exposed an
odd-width, offset-anchor case in the older scene API. Aligning raster tiles to
the object's integer origin also keeps clipping/antialiasing independent of its
absolute story position. The existing seam and odd-viewport checks now both
measure zero difference against their wide references, within their unchanged
two-level tolerance. Existing story-space scene APIs use the same correction.

Changing either half invalidates both dependent previews. Unrelated slides do not
load assets solely because a connected copy exists elsewhere. The reusable style photo-count check excludes these
decorative copies; six source photos remain a six-photo story even when several
subjects are repeated. Layout presets do not rotate/reposition the connected
copy, and shared style files omit source/mask/connection identities.

## Verification

Six [model tests](../tests/connections.test.mjs) cover two-shape geometry,
dependency invalidation, independent mask ownership, grouped history,
block/chain moves, depth-title transfer, removal, strict validation, layout/style
compatibility and parameter-only sharing.

The [browser regression](../tests/connections.browser.mjs) compares independently
decoded PNG halves with a separately rendered wide reference, for portrait and
tall shapes, with source transparency, a soft mask, depth text, crop, rotation,
partial opacity and color adjustments. It retains the existing maximum
two-level seam tolerance and requires byte-exact halves after pair reordering.
Twelve outputs at each admitted 1/2/4/8-worker setting must match their reference
ordering and hashes without declared CPU/memory admission violations.

The phone checks exercise mask import, connected-copy creation, spread preview,
200% text/touch targets, per-shape positions, crop, browser Back, one-step
Undo/Redo, group moves, exact reopening, pair changes, removal, mask fallback and
ordered independently decoded 1080 × 1920 PNGs. Exported halves are compared with
separate renders of the saved document.

The full Chromium suite passed against final source and the minified packaged
site, including the Brotli WASM loading path and existing editor/batch/folder,
style, recovery, mask, depth-title and shared-admission regressions. In both
runs the new wide-reference differences were 2/0 levels for untransformed/
transformed portrait, and 0/0 for tall. All paired outputs stayed byte-exact
after reordering, and the independently rendered saved-export halves matched.
The synthetic
[phone capture](research/2026-09-17/connected-cutout-phone.png) was visually
inspected; it demonstrates layout and interaction, not photographic edge quality.

The final deterministic checks pass 13 scheduler tests and 84 model/style/recovery
tests. Legacy parity remains 33/33 in run
`parity-c665aef5-8f5b-4c6e-94ba-cb975f9e1598`; that covers the original inventoried
engine endpoints, not reference parity for the new connected-copy feature.
The prior failed performance microbenchmark remains recorded and is not
superseded by these correctness checks.

The package passes artifact checks with 173 files. Optimized JavaScript is
451,831 bytes (146,838 Brotli), CSS is 62,205 bytes (9,789 Brotli), and the unchanged
published WASM is 4,548,741 bytes (1,170,855 Brotli). These are artifact sizes,
not measured download/startup performance.
Documentation links pass across 39 Markdown files; `git diff --check` also passes.

## Remaining release work

This does not qualify automatic segmentation, licensed production assets,
real-photo edges/seams, sustained phone throughput, full native memory,
physical-device accessibility or the finished authored recipe catalog.
Those remain in the [execution ledger](MIGRATION_STATUS.md). The full migration
goal and release gates remain unchanged.
