# Bundled story-font evidence — 20 September 2026

This record covers the four-font pack and revision-two story recipes described
in [the implementation report](../../../STORY_FONT_VERIFICATION.md). It advances
the complete migration plan; it does not qualify a production release.

## Scope and immutable inputs

- Source Serif 4, Source Sans 3, Source Code Pro and Oswald are unmodified,
  pinned Google Fonts binaries with original OFL notices and metadata.
- The pack totals 2,240,276 uncompressed bytes. This is not a measured network
  transfer size or a claim about total font-cache memory.
- Revision-two recipes carry content-addressed font references; revision one
  remains exactly equal to the previous milestone's three definitions.
- Shared styles contain parameters and bounded references. Font bytes are
  retained with private story assets; private words/photos stay out of styles.
- Saved-font reuse was checked with font-file requests blocked after reopening
  a story in the loaded app. Whole-app offline boot/update is not implemented.

The [source identity](target.json) binds 115 inputs to
`89cc88caa09022ec007d2e11d8b22cf1b04fd7d6:8b784698d10727ee23cc9c687b5063ea01a3870441dd28c29b2fba288815a458`.
The worktree is dirty. The paired published Pillow JavaScript/WASM bytes are
unchanged from the prior authored-recipe archive.

[verified-source.tar.gz](verified-source.tar.gz) contains the 219 source,
test, runtime and build inputs in [archive-files.json](archive-files.json).
It excludes Git history, installed dependencies and broader documentation.
[tested-site.tar.gz](tested-site.tar.gz) contains the 202 assembled files in
[packaged-files.json](packaged-files.json). Archives are checked member by
member against their SHA-256 inventories, and working files are rechecked
after browser execution. Neither archive has been deployed.

## Checks and review

The [verification receipt](verification.json) records terminal results and
artifact hashes. The source and 202-file packaged Chromium suites, separate
folder recovery, 140 deterministic tests and 33 adapter parity comparisons
pass. The declared adapter coverage slice is 27/34 against its 70% threshold;
it is not whole-product coverage. Raw logs include the initial failures and their corrected
reruns: a model schema expectation, a test-file syntax error, saved-style
selection in a browser test, actual 200% button overflow, synchronous preview
compatibility and a sub-44px font-options target. Those failures are not erased
or counted as passes.

The deterministic suite has 140 tests, including seven font tests. These check
all pinned font/license hashes, independently read complete format 4/12 cmap
tables, validate style privacy/identity and verify bounded shared loading,
cancellation, glyph/face preflight and reversible device-font fallback.
Browser checks exercise actual FontFace decoding, distinct variable weights,
downloaded style files, failed/cancelled loads, saved-font reuse and exact undo.

Eighteen PNGs cover the three recipes, cover/detail/closing roles and both
output shapes. All eighteen were visually inspected, together with the recipe
sheet, device-font fallback and the [expanded 200% font options](font-options-scrolled-200-phone.png).
The [phone measurements](font-options-phone.json) record the option targets
and lack of horizontal overflow. The separate `font-options-200-phone.png`
captures the top of the enlarged intro; it is not the scrolled option review.

The photos and research mask use the same
[attribution and limitations](../../../../tests/fixtures/corpus/story-design-v1/ATTRIBUTION.md)
as the preceding authored-recipe milestone. Three photos do not establish
representative photographic, demographic, multilingual or long-caption quality.
Mask edges still show research-quality fringes in some dark compositions.
Browser flattened references share the production geometry resolver; an
independent attachment calculation is covered by a separate model test.

Eight slide jobs at each observed worker peak 1, 4 and 8 match live serial
output, with zero admission violations in [concurrency.json](concurrency.json).
That is rendering/concurrency correctness evidence, not a throughput benchmark
or complete retained-memory qualification. No benchmark was rerun for this
target; the earlier two failing timing budgets remain unresolved historical
evidence for a different source identity.

## Remaining gates

Physical iOS/Android typography and accessibility, cross-browser shaping,
representative recipe quality, complete font/cache accounting, slow-network
behavior, versioned offline packs and full per-image/grouped-folder composition
remain open. The app-code license, release operations, user study and pilot
also remain required. See the [execution ledger](../../../MIGRATION_STATUS.md).
