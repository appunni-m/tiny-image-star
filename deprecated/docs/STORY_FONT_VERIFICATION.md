# Bundled story typography

Recipe revision two adds a pinned font pack to Scrapbook, Depth cover and Film
diary. Existing revision-one definitions and saved projects keep their original
device-font behavior. All three retained revision-one definitions were compared
directly with the prior milestone's archived source and are exactly unchanged.

## Font assets and ownership

| Font | Recipe role | Uncompressed bytes | Weight range |
| --- | --- | ---: | --- |
| Source Serif 4 | Scrapbook and closing type | 1,209,508 | 200–900 |
| Source Sans 3 | Quiet captions | 646,340 | 200–900 |
| Source Code Pro | Film diary and page numbers | 212,340 | 200–900 |
| Oswald | Depth cover title | 172,088 | 200–700 |

The four original binaries total 2,240,276 bytes. Their exact Google Fonts
revision, original URLs, SHA-256 hashes, original copyright/license texts and
upstream metadata are in the [distributed pack](../src/assets/story-type-v1/README.md).
The pack is unmodified and carries SIL OFL 1.1 notices beside each font.
The Pages checker verifies the packaged binaries, licenses and metadata against
the pinned manifest. This does not resolve the separate application-code license.

A new recipe uses only its declared fonts; compatible visible recipe previews
can load more. A style contains bounded font references, sizes, hashes, license
identifiers and variable-face descriptors, without font bytes or download URLs.
Applied references are copied into project assets. The actual font bytes are
saved atomically with the story and included in its private asset backup.
Saving Text style or Depth title preserves these known licensed references;
arbitrary user fonts still require a supported redistribution pack.

Unknown font editions can remain identifiable imported styles, but cannot be
applied. No imported URL is fetched. Known pack requests use a fixed same-origin
path, omit credentials, reject redirects and check exact length and SHA-256.
The static host sees font-file requests; no third-party font service is used.

## Loading, rendering and failure behavior

The workspace shares concurrent requests for the same font. Cancelling one
consumer leaves other consumers intact; cancelling the last aborts the fetch.
Retained Blobs and a three-times-encoded-size temporary allowance enter the
workspace memory ledger. Scene admission separately includes its font estimate.
These estimates do not establish total browser/font-cache memory on real phones.

Applying a style waits for its font assets before mutating the document. Closing
the sheet or choosing another style cancels obsolete preparation. Missing or
corrupt bytes produce an explicit error and preserve the previous selection.
Reopened stories read their saved font bytes without fetching the pack. Other
stories can reuse verified font assets retained by saved projects. Clearing all
saved work can remove those retained assets. This is font reuse within a loaded
application; the complete offline/PWA boot and update policy remains unfinished.

Workers load real FontFace objects with the copied weight range. Their CSS
families distinguish variable descriptors from legacy default descriptors using
the same binary. Temporary faces are removed from the FontFaceSet after render.
The new Depth cover uses Oswald's supported 700 weight; revision one retains its
original 800 device-font setting. No claim of identical rasterization across
different browser or operating-system text engines is made.

Each pack font's Unicode cmap is inspected with fontTools 4.60.2, and the test
suite independently reads the pinned binary's format 4/12 table to compare every
supported codepoint range. The mapping follows the
[OpenType cmap specification](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap).
Regenerate or check the inspection in a source checkout with
`python3 scripts/generate-story-font-data.py --check` using that fontTools version.
The ordinary Node verification command does not require Python.

Unsupported characters or an unavailable weight/italic face block rendering
instead of silently substituting another font. This character check is not a
shaping or language-quality certification. **Text → Use device fonts for this
story** is an explicit, reversible fallback that preserves words, photos, masks
and placement. The creation screen and recipe sheet also offer device fonts
without a download. Their appearance can vary by platform.

## Verification scope

Seven maintained model tests cover source/license hashes, complete independent
cmap agreement, revision separation, safe style sharing, font identity conflicts,
unknown-pack handling, malformed references, glyph/style preflight, one-step
fallback/undo, bounded and hash-checked fetching, cancellation, deduplication and
reuse of stored sources. The complete deterministic suite contains 140 tests:
28 scheduler and 112 model/diagnostic checks.

The focused Chromium workflow passes at a 375×667 viewport. It checks native
variable-face loading, distinct 400/700 raster output, family isolation, actual
style download, failure/retry/cancellation, saved-font reload with font requests
blocked, unsupported characters, explicit fallback, 200% root text and exact undo.
The new fallback button exposed an overflow at 200% text; wrapping and the sheet's
grid sizing were corrected. A synchronous style-panel regression exposed an
unnecessary asynchronous yield; synchronous consumers retain their prior behavior.
The new font-options summary also failed a 44px touch-target regression. The
intro and recipe-sheet controls now have explicit phone-sized targets; their
download size is visible before expansion. The expanded intro was separately
scrolled into view, measured and visually reviewed at 200% text.

Eighteen updated recipe previews cover three recipes, cover/detail/closing roles
and both shapes. All were visually inspected. They use three real photos and a
retained research mask, with the same attribution and limitations as the
[authored recipe corpus](../tests/fixtures/corpus/story-design-v1/ATTRIBUTION.md).
The initial full browser run passed their exact flattened-decoration references
and live-serial comparisons at observed worker peaks 1, 4 and 8, then failed at
the synchronous-panel regression. The final source and 202-file packaged
Chromium suites now pass, including the touch-target correction. Separate
folder-recovery checks pass. The current adapter comparison is 33/33 and its
declared function-coverage slice is 27/34 against a 70% threshold; neither is
whole-product coverage. The [retained verification record](research/2026-09-20/story-fonts/README.md)
contains exact source/test/build and assembled-site archives, failed and passing
logs, reviewed previews and per-file hashes. The canonical release aggregate
remains unproven for the dirty target and stale benchmark identity. No new
throughput benchmark or physical-device qualification is claimed.

## Remaining production work

Physical iOS/Android and cross-browser typography, representative long-caption
and multilingual shaping review, accessible device tasks, sustained font/cache
memory, slow-network transfer behavior and the complete PWA update policy remain
open. The bulk/image style consumer still applies only photo-color components;
this change does not add full font/layout composition to grouped folder jobs.
The complete migration plan and production release gates remain the objective.
