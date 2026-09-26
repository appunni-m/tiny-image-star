# Manual cutout editing

Implemented 17 September 2026 toward §5 and phases 3–4 of the
[migration plan](../MIGRATION_PLAN.md). The story workspace now exposes the
existing mask compositor through **Cutout**. This is the manual/imported-mask
path; automatic segmentation, a finished Depth cover recipe, visible connected
cutouts and the release quality gates remain open.

## What a user can do

Choose a photo on the current slide, import a still PNG mask, or use Restore and
Erase to paint a mask. Imports must match the upright source dimensions and be
under 16 MB. Use an 8-bit PNG.
16-bit mask imports are explicitly rejected: a direct probe of the pinned engine
converted the 16-bit values 32768 and 65535 to the same 8-bit value, 255. This
would destroy soft coverage. The guard is exercised with a real 16-bit PNG.
**White subject on black** converts the PNG to grayscale;
**PNG transparency** uses its alpha channel. Existing source transparency is
multiplied by the mask, preserving partially transparent source pixels.

Brush size, soft edge and opacity are adjustable. A continuous stroke uses the
maximum coverage of its segments, so retracing or receiving more pointer events
does not unintentionally multiply opacity. Pointer interruption discards the
uncommitted stroke. Strokes are bounded to 512 points; an overlong stroke is
explicitly refused. Restore paints visibility; it does not restore the imported
mask's historical values. Undo brush/Redo brush restore preceding mask states.

The panel offers Cutout, Mask and Original views. **Whole photo** fits a bounded
1024-pixel preview. **100%, 200% and 400% source pixels** fetch a region of the
upright original without resampling. At 100%, each image pixel occupies one CSS
pixel; higher levels use nearest-pixel enlargement. These levels describe CSS
size, not a device's physical display density. The region is at most 1024 × 1024
pixels and normally much smaller on a phone. Changing detail level centers the
view on the brush. Move view supports dragging; direction buttons and keyboard
arrows provide non-drag alternatives. Resizing the viewport refreshes its region.

Brush diameter is adjustable in source pixels, down to one pixel for ordinary
photos. A one-pixel tap snaps to the targeted pixel's center, so tapping near a
corner does not miss every pixel. In detail mode, keyboard arrows move one
source pixel, or ten with Shift; Space/Enter paint a spot. Labeled position
sliders, **Show brush area** and **Paint this spot** provide another explicit
alternative to dragging. Painting a spot outside the displayed region is
disabled until it is inspected. Zooming/panning leaves the mask, local undo/redo
branch and project history unchanged. Fine hair/edge quality still requires
representative photographic review.

The Cutout sheet gives the phone's tool/view controls and editable preview
priority. At 375 × 667 it uses a taller sheet than the simpler story tools;
Apply and Cancel remain explicit. At 200% text the sheet scrolls without
horizontal overflow and tested buttons remain at least 44 pixels high. See the
[whole-photo capture](research/2026-09-17/cutout-phone.png) and
[detail capture](research/2026-09-17/cutout-detail-phone.png), using synthetic
fixtures. They verify layout, not photographic edge quality or physical-phone
usability. Detail resizing also has a 320-pixel-width/200% text regression.

Apply waits for mask processing and the resulting story preview. A failed
import or brush request keeps the previous mask and disables Apply until a
successful retry/change. Cancel restores the exact pre-tool story. All imports
and repairs in one opening become one story undo entry. Source replacement
removes its old subject mask. Color/style changes retain the source-specific
mask; masks remain private project assets, separate from reusable style files.

## Rendering, admission and asset lifetime

- [Mask validation and painting](../src/compositor/mask-spec.js) use normalized
  upright source coordinates and a full-resolution one-channel pixel plane.
  Soft coverage and opacity are applied in an admitted worker. Pixel changes
  are encoded by the pinned Pillow runtime as an 8-bit grayscale PNG.
- The [mask renderer](../src/compositor/mask.js) verifies source and saved-mask
  hashes before decode, checks upright dimensions, rejects animation and
  validates PNG imports before conversion. Source opening shares the existing
  EXIF-to-upright scene path. This does not complete the full camera/color matrix.
- Detail regions use integer source coordinates and must fit inside the source,
  with at most 1024 pixels per side. They are cropped before preview encoding;
  no resize filter is used on that path. A read-only request cannot include an
  import, reset or brush stroke, and does not encode/return a new full-size mask.
  [View geometry](../src/story/mask-view.js) maps input and overlays back to the
  same normalized source coordinates. Painting remains disabled until the
  browser has decoded the new displayed region. This decode completes before
  committing the mask or history, so a failed decode and Retry cannot apply a
  half-opacity stroke twice. The old displayed region remains intact on failure.
- The [worker client](../src/processing/mask-client.js) freezes metadata and
  copies source bytes only after shared CPU/memory admission. Its estimates
  include decode/conversion planes, brush coverage, encodes, hashing and bounded
  previews. Cancellation uses the same worker termination and unfinished-read
  accounting as other tasks. No source is uploaded.
  Detail views still decode the full source and mask: their admission reserves
  that work. A small output tile is not a claim of region-only decoding or lower
  full-source memory requirements. Navigation does not retain a tile cache.
- The [panel](../src/story/mask-panel.js) registers retained mask states,
  preview buffers/planes and import/hash temporaries. Local brush history holds
  at most 16 states and 24 MB of mask PNGs; earlier brush states are dropped with
  a visible message. URLs, pending tasks and the panel ledger are released on
  close or photo selection changes.
  Closing during preview decode detaches the pending image and keeps temporary
  buffers in admission until the decode settles and its URLs are released.
- A tool opening updates one draft mask asset per chosen photo, rather than
  adding a permanent asset for every stroke. [Mask commands](../src/story/masks.js)
  remove superseded assets only when no other node needs them. Story undo/redo
  retains its blob dependencies, with a 32 MB bound on additional history assets.
  Current originals and masks remain retained; a large current document can
  still exceed admission/storage limits and must be reduced by the user.
- Saves capture immutable Blob references for their exact project revision.
  Pending saves remain in the retained ledger even if a later edit prunes its
  source map. Existing transactional storage owns commit, quota rollback and
  concurrent-writer checks. New source bytes never enter command/history JSON.

These are application estimates and ownership contracts, not process-RAM
measurements. Whole-app decoded DOM/cache/model/storage accounting and sustained
physical-device qualification remain required.

## Evidence

Seven [model tests](../tests/masks.test.mjs) cover soft restore/erase behavior,
untouched pixels, sampling-density independence, malformed/oversized strokes,
memory bounds, one-step undo, crop/look preservation, source-mask exclusion from
shared style files, shared-mask references and history dependency pruning.
They also verify one-pixel repair on a 1600 × 1200 mask and bounded region/point
roundtrips at all supported zoom levels, including source edges and tiny images.

The [real browser regression](../tests/masks.browser.mjs) verifies:

- grayscale PNG normalization, alpha-channel imports, source-alpha multiplication
  and intermediate soft-mask values through the published Pillow engine;
- identical mask bytes for twelve real worker results at each of 1/2/4/8 workers,
  without declared CPU/memory admission violations;
- wrong-size, 16-bit and changed-hash refusal; a wrong-size import cannot be
  applied, and a successful new import after a first-load worker failure really
  updates the story rather than being mistaken for an unchanged initial preview;
- real phone-width pointer strokes and keyboard spots that change rendered
  pixels, local undo/redo, Cancel and a single story undo/redo for the tool edit;
- exact saved/reopened story pixels, failed IndexedDB mask-save rollback with
  successful Retry save, and source replacement followed by exact Undo;
- 200% text layout, touch-target sizes and no browser page errors.

The [source-pixel browser regression](../tests/mask-detail.browser.mjs) uses a
1537 × 1109 analytic pattern, larger than the overview resolution. Independent
browser decoding checks every pixel of all three views in four regions,
including source corners and a 430 × 800 crop. It checks real worker output
identity at 1/2/4/8 admitted workers and rejects invalid/mutating detail requests.
The actual phone story tool verifies 100/200/400% dimensions, a one-pixel pointer
tap near a pixel corner, an adjacent one-pixel keyboard repair, Undo/Redo across
panning, drag/button/keyboard navigation, a failed worker request and retry,
viewport resizing and 200% text. An injected browser image-decode failure retains
the original view and project; retry applies a half-opacity stroke exactly once.
Cancellation is exercised during both deferred source acquisition and held
browser decoding, including retention/release of the panel's admission bytes.
The saved full-size mask is decoded and checked for exactly three intended
changed pixels (two erased, one half visible). One story undo returns the original
composition.

The complete source and packaged Chromium suites passed for the source-pixel
feature, including existing image, story, photo-look, cross-tab scheduler, folder
and recovery regressions. After the final browser-decode transaction/cleanup
corrections, both cutout browser modules also passed against source and the final
packaged artifact. `npm run verify`
passes 13 scheduler tests and 72 model/style/recovery tests. The legacy engine
comparison remains 33/33 in
run `parity-6d5e65c9-6ed6-4c75-97db-a68729eb42c7`; that verifies the original
inventoried behavior, not reference parity for the new mask feature. The earlier
failed performance microbenchmark remains recorded and is not superseded here.

The final package passes the artifact checks and contains 163 files. Optimized
JavaScript is 432,902 bytes (140,006 bytes Brotli), CSS is 61,141 bytes (9,664 bytes
Brotli), and the unchanged WASM is 4,548,741 bytes (1,170,855 bytes Brotli). These
are artifact sizes, not measured download or startup performance.

The subsequent [manual depth-title controls](DEPTH_TITLE_VERIFICATION.md) have
separate alpha/occlusion, phone workflow and saved-recovery evidence.
This mask work does not establish automatic segmentation quality, the finished
authored Depth cover recipe, outline/shadow effects, real-photo visual quality,
sustained phone performance or production
readiness. Those remain requirements in the [execution ledger](MIGRATION_STATUS.md).
The subsequent [connected-cutout workflow](CONNECTED_CUTOUT_VERIFICATION.md)
reuses these masks for independent subject copies across adjacent slides.
