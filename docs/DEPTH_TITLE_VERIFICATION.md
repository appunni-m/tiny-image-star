# Manual depth titles

Implemented toward §5 and phase 4 of the [migration plan](../MIGRATION_PLAN.md).
This adds editable text behind a manually selected subject in the story
workspace. It is not the finished authored **Depth cover** recipe, automatic
segmentation, a qualified production font pack or photographic edge-quality
certification. Those requirements remain in the [execution ledger](MIGRATION_STATUS.md).

## Phone workflow

**Text** separates **Caption** and **Depth title**. A caption stays independent
of the photo's depth title. **Apply words & edit subject** commits the current
words and opens Cutout for the chosen photo. The handoff captures a save before
the next tool can create a new draft. A subject can be imported or repaired using
the existing [source-pixel Cutout controls](MASK_EDITING_VERIFICATION.md).

With a subject mask, enable **Text behind this subject**, enter the title and
choose **Keep original photo** or **Use cutout over the page**. **Type and
placement** contains typeface, color, size and position controls. Title geometry
and font sizing follow the chosen photo in both 4:5 and 9:16 output shapes.
Crops, focal positioning, rotation and the saved aspect-specific photo frame
stay owned by the photo. The title does not require a second source-image layer.

The original source, subject mask and title remain separately editable. Mask
replacement preserves title settings. Photo replacement requires a new subject
mask; the words stay in front of the new original photo until that mask is
supplied, with a visible explanation in the preview, Text and export review.
The background choice remains saved for when the new mask is ready. A missing
mask is distinct from a supplied corrupt mask, which still fails its integrity
check. Reopening and supplying a new mask restores the effect without rebuilding
the title. Explicitly turning the depth-title control off removes the title and
keeps the cutout; Undo restores it.

Depth settings can also be captured with **Look → Save my style → Depth title**.
The shared style stores type, color/shadow, relative placement and background
choice, without the title words or subject mask. Applying it preserves existing
words and, by default, positions; newly created titles use the destination
story's name. Maskless photos stay unchanged, with affected counts shown before
commit. See [reusable depth styles](STYLE_LIBRARY_VERIFICATION.md#depth-style-addition-20-september-2026).

The initial font choices use the browser's built-in families. Existing pinned
font assets are supported by the compositor. Built-in fonts are not a claim of
identical typography across operating systems or a licensed production catalog.
Real-photo legibility, subject selection, placement quality, physical keyboards
and screen-reader tasks remain release work.

## Defined rendering behavior

The [project model](../src/project/model.js) stores an image's `depthTextId` and
`depthBackground` choice. Its title has one owner and immediately follows that
photo in each slide's layer list. The title's stored frame and text size are
relative to the photo. The resolver produces one output-specific geometry,
including rotation. Dangling, conflicting, reordered and incompatible links
are rejected. Older readers that do not recognize these optional fields reject
the document rather than silently rendering a different title; the saved data
must remain available through the existing recovery/backup boundary.

The scene planner binds the title to its photo group and excludes the standalone
title from the render loop. The [renderer](../src/compositor/scene.js) decodes
the source once, applies the crop/look once, and transforms the original and
masked subject with the same geometry. Source alpha and subject coverage are
multiplied once. The title is rasterized with its own opacity and style, then
[combined in premultiplied color](../src/compositor/depth.js) before final Pillow
composition and PNG/JPEG encoding.

Let `P` be the original photo's premultiplied RGB, `S` the subject's premultiplied
RGB, `A` the original alpha, `F` the subject alpha, `T` the text alpha and `C` the
text's straight RGB. Keeping the photo background produces:

```text
RGBpremult = (1 − T) P + T S + T (1 − F) C
alpha     = A + T (1 − A)
```

Where there is no text, the original photo is unchanged, including its alpha.
With the page background, the result is the ordinary subject-over-text stack:
`S + T (1 − F) C`, with alpha `F + T (1 − F)`. This avoids thickening a transparent
photo by drawing its complete original and foreground on top of each other.
The behavior is specified for the app's existing 8-bit image pipeline; wide-gamut,
HDR and complete camera/orientation qualification remain separate gates.

Depth scenes reserve additional native and JavaScript pixel buffers through the
shared scheduler and use a distinct Auto work class. Source/font bytes are still
read only after admission. Workers remain reusable and outputs use the existing
revision/cancellation contracts. These are conservative admission estimates,
not measured process memory or proof of sustained phone throughput.

## Evidence

Six [model/composition tests](../tests/depth.test.mjs) cover an independent
foreground/background layer-stack oracle, original-alpha preservation, the page
background, malformed links, one-step history, serialization, output geometry,
scoped looks, title preservation when masks change and exclusion of private
mask/source links from shared style files.

The [real browser checks](../tests/depth.browser.mjs) cover:

- one source decode and one mask decode, soft masks and translucent inputs;
- independent browser decoding against separately rendered photo/subject/text
  references, including crop, rotation, partial opacity and color adjustments;
- exact original output when the title is empty; page composition within the
  existing two-level allowance; exact final-downsample preview;
- a linked depth group spanning two viewports, compared with a single wide
  reference under the existing two-level seam tolerance;
- twelve real outputs at each admitted 1/2/4/8-worker setting, identical bytes
  and no declared CPU/memory admission violations;
- phone mask setup and word-to-Cutout handoff, editable text, Cancel and one-step
  story Undo/Redo, crop/reflow, exact reopening, quota rollback and retry;
- both background choices, 200% text layout and touch-target height;
- preserved titles after mask/source removal, visible normal-layout fallback,
  exact reopening in that state, new-mask restoration, and explicit refusal of
  corrupt masks instead of falling back;
- ordered independently decoded 1080 × 1920 PNG exports, with the depth slide's
  bytes matched to a separate render of its saved project.

The synthetic [phone capture](research/2026-09-17/depth-story-phone.png) was
visually inspected and shows the interaction/layout, not photographic subject
quality. The full Chromium suite passed against both final source and the
minified packaged site, including the existing editor, batch, folder, recovery
and shared-admission regressions. The packaged suite also exercised the Brotli
WASM loading path.

In both final source and packaged runs, the native reference cases had zero alpha error and
maximum premultiplied RGB errors of 1.637 and 1.687 out of 255, within the fixed
two-level allowance. Page composition and missing-mask fallback each differed
from their separate reference by at most one level. The connected fixture had
zero seam difference. Empty-title original preservation, downsampled previews,
saved reloads and 1/2/4/8-worker outputs were exact. These are small synthetic
correctness fixtures, not a visual-quality or throughput benchmark.

`npm run verify` passed 13 scheduler tests and 78 model/style/recovery tests.
The final package passes artifact checks with 169 files: JavaScript 442,123 bytes
(143,516 Brotli), CSS 61,447 bytes (9,710 Brotli), and unchanged published WASM
4,548,741 bytes (1,170,855 Brotli). These are sizes, not startup/performance results.
Legacy parity passes 33/33 comparisons in run
`parity-27b3eb4e-7976-4731-b130-81b38537e333`. That checks the original inventoried
engine surface, not reference parity for the new depth-title feature. The earlier
failed performance microbenchmark remains recorded and is not superseded here.
Documentation links pass across 38 Markdown files, and `git diff --check` passes.

No production-ready claim is made. Finished authored recipes, automatic-model
license/quality/memory gates, source-specific masks in reusable bulk recipes,
representative photographic review, physical-device
performance/accessibility and the full release gates remain required.
The subsequent [connected-cutout controls](CONNECTED_CUTOUT_VERIFICATION.md)
support shared depth titles across two neighboring slides and grouped reordering.
