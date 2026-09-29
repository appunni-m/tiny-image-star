# Explicit smaller editing copies

This advances the large-source memory path in migration §8. It does not provide
a reduced-resolution decoder: the published Pillow binding still decodes the
whole source before resizing it. Admission includes that full source cost.

## User behavior

**Make a story → Large photos → Use smaller editing copies** is an explicit,
initially unchecked choice. Sources over a 2,048px long edge receive an upright
PNG copy made with Pillow's Lanczos resize. Smaller sources keep their original
bytes. Ordinary imports remain unchanged. Existing stories can now opt in per
photo from Photos, as described below.

The choice explains that cropping can reveal less detail and that exports use
the selected copies. The Photos sheet labels copies and their dimensions; its
source picker also contains the retained originals. Choosing an arbitrary
replacement there resets its cutout. The dedicated resolution action preserves
the current cutout, as described below. The export
sheet reports when a project uses copies. Masks must match the currently chosen
source dimensions; an original-resolution external mask is not silently resized.

Originals and copies are separate hashed project assets. A copy records its
original asset ID, a fixed 2,048px limit and the versioned
`pillow-rs-lanczos-png@1` operation. The project engine already pins the paired
published runtime. Validation rejects missing originals, chains/cycles,
unsupported methods, wrong dimensions and non-upright/non-PNG copies. Original
deletion cannot leave a valid dangling copy. Recovery and private asset backups
include both sources. Parameter-only shared styles do not carry either image.

This is an explicit editing-source choice, not a transparent proxy that later
exports from the original automatically. Choosing an original can still exceed
the current device's processing budget. Automatic proxy/original substitution
would need separate mask, crop, preview/export and quality qualification.

## Ownership and bounds

The importer retains the existing 96 MiB original-source limit. Originals plus
generated copies are limited to 120 MiB, leaving space for the bundled story
fonts within the existing 128 MiB story-asset limit. The shared store can still
reject a save because other saved work consumes capacity; previous projects
remain intact and existing retry/backup controls apply.

Inspection and copy generation use the shared admitted worker pool. A copy
request reserves the full original decode and rechecks its length/hash before
the second transfer. Its estimate also reserves encoded-output, Blob and hash
snapshot overlap. Output ownership enters the importer ledger synchronously at
the worker's terminal message, before another task can be admitted. Originals
and completed copies stay counted until ownership passes to the story.
Failures/cancellation drain the outstanding consumers before releasing the
import reservation. No partially assembled project replaces the current one.

These are conservative admission estimates. They do not measure whole-browser
RSS, native decoder caches, OS file backing or physical-phone memory capacity.
Increasing worker count does not bypass the memory checks.

## Evidence and remaining checks

Five model tests cover immutable original lineage, invalid/deleted references,
explicit opt-in, unchanged small sources, full-decode admission, deferred reads,
output ownership, changed-source rejection and cancellation/draining. They use
a mock worker boundary for ownership tests, not a pixel-quality oracle.

The focused real-engine Chromium workflow uses the previously attributed
[12MP coast photograph](../tests/fixtures/corpus/collections-v1/ATTRIBUTION.md).
Its 4032×3024 original remains byte-identical; the copy is 2048×1536. A separate
synthetic JPEG exercises EXIF 1–8 against independently constructed coordinate
mappings, followed by the same declared Pillow Lanczos filter. Both results are
decoded with the browser before pixel comparison. All eight pixel comparisons
are exact at observed worker peaks 1, 4 and 8, with no admission violations.
An alpha-128 PNG keeps that alpha after reduction. This is correctness evidence,
not a cross-decoder or independent-resampling quality certification.

The phone-sized UI check covers explicit consent, 200% text, saved copies and
originals, exact reopened preview, source switching and undo. A tall story with
a depth title and the controls' default outline/shadow can render under the
512 MiB admission policy. That isolated scheduler case reuses one unique photo,
a uniform synthetic mask and device fonts; it does not qualify a full set of
unique camera photos plus all application caches. **Maximum outline/shadow values still exceed that
budget**, even with a reduced source, and are rejected before source reads.
The failed maximum-effects attempt is retained; its budget was not relaxed.

The import milestone's deterministic suite (145 tests: 28 scheduler, 117 model/diagnostic),
full source and 204-file packaged Chromium workflows, and separate folder
recovery pass. Adapter parity is 33/33; the declared adapter coverage slice is
27/34 against its 70% threshold, not whole-product coverage. The
[retained verification record](research/2026-09-20/working-copies/README.md)
contains exact archives, raw results, reviewed phone screenshots and file hashes.
The dirty release aggregate and the prior different-target benchmark remain
unproven; no new throughput claim is made. The following addition implements
conversion of existing edited sources. Physical devices, representative
visual quality at heavy crops, sustained high-concurrency collections, HEIC,
wide-gamut/HDR/color policy, automatic segmentation, full bulk composition and
complete retained-memory accounting remain open. The full migration plan is
still the objective.

## Existing edited photos: reversible resolution

In **Photos**, **Make smaller editing copy** reduces the selected image and its
current mask together. **Use original with current cutout** restores its
original photo. Both actions keep all framing, normalized crop, photo corrections,
variant positions, depth text, shared layout and connected-slide settings. A
connected subject remains one shared object across its two slides; separate
photos using the same original are unchanged. No layout reflow is triggered.

If a reduced mask is untouched and its original asset hash still matches, the
original mask is reused exactly. If the user painted the reduced mask, the
current mask is resized to the original dimensions. The sheet explains that
upsampling cannot recover finer cutout detail. Masks remain 8-bit grayscale PNGs;
image orientation follows the asset's declared policy, avoiding a second EXIF
rotation of an already-upright source. This is resampling of corresponding source
pixels, not automatic subject detection or a mask for an unrelated replacement.

Image and mask preparation share the resource scheduler. Both must finish before
one document command can be previewed. Apply commits the Photos sheet as one undo
step; Cancel, closing the sheet or changing the selected photo aborts pending
conversion. A session, tool and revision check rejects stale results. Errors
allow retry without replacing the current source. All outstanding consumers
drain before their reservation is released. Existing original files plus newly
generated outputs stay in the retained-memory ledger, and a 128 MiB unique-asset
limit is checked before the command is returned. Original sources are never
deleted by conversion; unchanged toggles reuse hash-bound copies.

New copy metadata includes the original SHA-256. Older saved copies without
this field remain readable but are not trusted as reusable conversion results.
Older app builds can reject these new asset fields; a versioned update and
mixed-version-tab release check is still required before deployment.
Mask replacement and connected-subject removal retain parent mask assets still
needed by a derived copy. Export uses whichever source the user selected; full
original-quality substitution at export is still not automatic.

Seven added model tests cover atomic history, metadata preservation, verified
lineage, legacy copies, exact versus edited-mask restoration, memory admission,
quota, sibling failure and cancellation/draining. The real-engine browser test
compares image and soft-mask pixels with direct Pillow Lanczos references decoded
by the browser. It covers observed 1/4/8-worker identity, grayscale encoding,
edited-mask upscaling, upright/EXIF policy, a colored-mask rejection, and phone
Apply/Cancel/undo/redo/reload/failure retry/selection cancellation. The 200% text
check includes the source controls and an unbroken Cancel label. The synthetic
fixture is 2052×513; it supplements the earlier 12MP import check, and does not
establish representative crop quality, physical-phone behavior or throughput.

Current verification and retained artifacts are recorded in the
[source-resolution evidence](research/2026-09-20/source-resolution/README.md).
