# Reusable depth-title styles: 20 September 2026

This records the [depth-style addition](../../../STYLE_LIBRARY_VERIFICATION.md#depth-style-addition-20-september-2026)
inside the existing story workspace. It does not certify the authored Depth
cover recipe, automatic segmentation, a large-folder compositor or production
readiness.

## Change and behavior

Save my style can include a chosen photo's depth-title type, color/shadow,
photo-relative placement and original-photo/page background choice. The
`depthTitle` component is declarative, bounded, and requires `depth-title-v1`.
The style contains no photo, mask, caption or depth-title words. Custom fonts
still require a supported licensed asset pack.

Application respects This slide/Whole story, preserves source-specific crop
and mask repairs and existing words, and shows eligible/skipped photo counts.
New titles use the destination story's name. Existing title placements stay
unless the user explicitly resets them; text/opacity overrides survive reset.
Connected subjects receive one shared title change across both slides.
Maskless scopes are unavailable rather than silently receiving another photo's
mask. The existing scene renderer and scheduler execute the resulting graph.

## Retained checks

| Command/check | Result |
| --- | --- |
| `node --test tests/styles.test.mjs` before implementation | Five new regressions failed because capture did not support depth settings; nine existing tests passed. [Log](before.log). |
| `node --test tests/styles.test.mjs tests/cutout-effects.test.mjs` after implementation | 20/20 pass. The cutout-scope assertion follows the new “this slide” wording. [Log](after.log). |
| `npm run verify` | Existing application checks and 124 deterministic tests pass: 28 scheduler, 96 model/diagnostic. [Log](verify.log). |
| `TINY_IMAGE_STAR_DEPTH_STYLE_ARTIFACTS=1 npm run verify:browser` | Full source Chromium suite passes, including actual style download, private-content exclusion, existing/new title application, keep/reset positions, undo/redo, exact reload and ordered export. [Log](browser.log). |
| `node scripts/assemble-pages.mjs _site` and `npm run check:pages` | Build and 179-file artifact pass. [Build](build.log), [artifact](artifact.log). |
| `TINY_IMAGE_STAR_BROWSER_ROOT=_site npm run verify:browser` | Full packaged Chromium suite passes with the same depth-style sequence. [Log](packaged-browser.log). |
| `npm run migration:parity` | 33/33, `parity-548629d0-e5fd-4630-9935-ac1aab2e24e3`. [Log](parity.log). |
| `npm run migration:coverage` | 27/34 adapter functions, declared 70% threshold passes; `coverage-e7dbc14e-a566-42ba-923c-5eefd4016570`. [Log](coverage.log). |
| `npm run migration:check` and strict fixture audit | Specification/anti-cheat checks and static fixture audit pass. [Specification](spec.log), [audit](parity-audit.log). |
| `npm run migration:status` | All lanes remain unproven for release: dirty source for parity/coverage; dirty and different target for the prior benchmark. [Aggregate](migration-status.json). |
| `npm run check:docs` and strict documentation inventory | Local links pass. Inventory has zero structural errors and seven existing review findings, including unresolved app licensing. [Links](docs.log), [inventory](doc-inventory.json). |

The [phone screenshot](depth-style-phone.png) was visually inspected. It shows
the scoped effect explanation, position choice, save/import/export actions and
fixed Apply control at 375×667. It illustrates controls on synthetic input;
it is not a real-photo layout-quality assessment. The browser check also uses
a 32px root font to catch horizontal overflow, not platform text-size settings.

## Identity and limits

The [verification receipt](verification.json) binds logs, the screenshot,
[target identity](target.json), [96 target source inputs](source-files.json),
and [179 packaged files](packaged-files.json). The
[source archive](verified-source.tar.gz) includes those 96 inputs plus the
changed tests and browser runner; it is not a complete repository checkout.
The [tested site archive](tested-site.tar.gz) contains every packaged file.
Archive members and post-test file hashes are rechecked against the inventories.
This README is excluded from the receipt so the explanation can be updated.

No scheduler, renderer, codec or Pillow runtime bytes changed in this step.
No throughput benchmark or separate folder crash/recovery-fault suite was
rerun. The full browser suites do cover the existing real folder workflow,
pause/retry/recovery and concurrency checks. They establish correctness under
those conditions, not improved throughput or thermal behavior.

The prior bounded-startup benchmark retains its 15 passing, two failing and
four unproven budgets as historical observations. Its target identity differs
from this style change. The worktree remains dirty and no deployment, physical
phone, OS share destination, screen-reader task, user study, production font or
release-owner qualification is claimed.
