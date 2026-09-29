# Authored story recipes: 20 September 2026

This records the implementation and verification of three distinct story
compositions. It advances [the authored catalog](../../../STORY_RECIPE_VERIFICATION.md)
without certifying production fonts, representative photographic quality,
automatic selection, grouped bulk composition or physical phones.

## User-visible behavior

| Recipe | Treatment |
| --- | --- |
| Scrapbook | Warm paper, tilted prints, attached tape and serif cover/detail/closing type. |
| Depth cover | Filled cover framing, editable type behind the imported/selected cover subject, straight interior pages and a separate closing treatment. |
| Film diary | Dark paper, straight film-edge frames, attached perforations and monospaced cover/detail/closing type. |

New stories start with Scrapbook. Existing saved stories remain unchanged until
the user chooses a recipe. The previous color-only choices retain their IDs and
definitions under Photo looks. For this story shows the three whole-story
recipes using the user's photos, with an explanation when Depth cover needs a
cover mask. Choosing another recipe preserves existing title words and masks.

Recipes copy their bounded cover/body/closing definitions into the project.
Generated tape and film details follow the photo's actual position, rotation
and output shape. Replacement removes only validated recipe-owned decorations.
Private words, photos, source identifiers and masks are absent from the actual
downloaded style file. Generic system fonts are still used.

## Verification

| Check | Result |
| --- | --- |
| `npm run verify` | Application checks and 133 deterministic tests pass: 28 scheduler and 105 model/diagnostic. [Log](final-verify.log). |
| Full source Chromium suite | Pass, including actual recipe previews/downloads, mask preflight, preview cancellation, replacement, undo/redo, exact reload, 200% root text, fit selection and ordered PNG exports. [Log](final-browser.log). |
| Authored composition concurrency | Eight slide jobs at configured and observed worker peaks 1/4/8 match their live serial encoded outputs. Zero observed CPU/memory admission violations. [Raw hashes](concurrency.json). |
| Build and artifact validation | 181 packaged files; published JS/WASM bytes unchanged. [Observed build result](build-observation.json), [file hashes](packaged-files.json). |
| Full packaged Chromium suite | Pass with the same authored-recipe, mobile, recovery, output and concurrency checks. [Log](packaged-browser.log). |
| `npm run migration:parity` | 33/33 exact comparisons, run `parity-2261e174-989f-41ef-9a24-8006cb1e5c72`. [Log](parity.log). |
| `npm run migration:coverage` | 27/34 adapter functions; declared 70% gate passes, snapshot `coverage-2b4340e2-ff7e-4075-b910-bd755a797370`. [Log](coverage.log). |
| Manifest check and strict fixture audit | Pass; no static audit findings. [Specification](spec.log), [audit](parity-audit.log). |
| Migration release aggregate | All three lanes remain unproven because of dirty source and incompatible prior benchmark identity. [Retained status](migration-status.json). |
| Documentation links and strict inventory | Local links pass; zero structural errors and seven existing review findings, including unresolved application licensing. [Links](docs.log), [inventory](doc-inventory.json). |

The initial implementation and fill-frame refinement logs are retained alongside
the final checks. The [fill-frame regression](fill-before.log) first failed on
the small cover area; the revised layout passes. No comparison threshold or
benchmark budget was relaxed. No throughput benchmark was rerun for this change.

## Visual review and evidence boundaries

Eighteen [render records](renders.json) cover all three recipes, cover/detail/
closing roles and portrait/tall shapes. These use three real photographs and
one retained research mask, not eighteen unique subjects or ground-truth masks.
The [input notice](../../../../tests/fixtures/corpus/story-design-v1/ATTRIBUTION.md)
records attribution and the mask's research-only provenance. No segmentation
SDK or model is bundled or executed by this addition.

All initial previews were visually inspected. The initial tall Depth cover had
too much empty space; both revised covers were inspected after adding filled
framing. The initial [portrait](initial-cover-review/depth-cover-portrait-1.png)
and [tall](initial-cover-review/depth-cover-tall-1.png) images are retained beside
the revised [portrait](depth-cover-portrait-1.png) and [tall](depth-cover-tall-1.png)
outputs. The final [phone sheet](recipes-phone.png) was also inspected at 375×667.
This is a limited composition review, not representative quality qualification.

Browser decoration references flatten the graph through the production geometry
resolver; they check integration and do not constitute an independent geometry
oracle. A separate model test calculates the expected attached shape center
using independent trigonometry after a manual photo transform. Live serial
hash comparisons establish worker-count invariance, not independent rendering
correctness, throughput, complete retained memory or thermal behavior.

## Reproducible identity

The [target identity](target.json) is
`89cc88caa09022ec007d2e11d8b22cf1b04fd7d6:34e8ed67215a4e6cb451d6c49039204a5b0e6a59a26fc7d5e4824b45bcf1f1c0`.
Its [97 target inputs](source-files.json) are bound separately from the broader
[197-file source/test/build snapshot](archive-files.json). The
[source archive](verified-source.tar.gz) includes application code, scripts,
tests/fixtures, runtime files and build entry points. It excludes Git history,
installed dependencies and the broader documentation/research tree; it is not
a full repository checkout. The [tested site archive](tested-site.tar.gz)
contains every packaged file. Archive contents were checked against their hashes.
The `verification.json` receipt binds these inventories, logs, previews and
archives, with source/package hashes rechecked after the browser runs. The
[target-source patch](change.patch) compares this milestone against the retained
depth-style source snapshot. This README is excluded from the receipt.

The existing Pillow pair, scene renderer and scheduler are unchanged. Photo
attachment resolution, recipe compilation, layout fit and style UI are new.
The prior collection benchmark's two failed budgets remain preserved; these
correctness results do not turn that historical run into a qualification of
this source. No deployment, user study, physical phone, screen reader, production
font pack or release-owner signoff is claimed.
