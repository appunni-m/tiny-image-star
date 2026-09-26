# Authored story recipes

Update, 20 September: [recipe revision two](STORY_FONT_VERIFICATION.md) adds
four pinned OFL fonts, saved-font reuse and an explicit device-font alternative.
The revision-one definitions and historical evidence below remain unchanged.
Representative typography and physical-device qualification remain open.

This implements the three named composition recipes from
[the migration plan](../MIGRATION_PLAN.md). It advances the launch catalog;
production fonts, representative creator/typography review, automatic subject
selection, physical phones and the full release gates remain open.

## What each recipe does

| Recipe | Composition |
| --- | --- |
| Scrapbook | Warm paper, tilted white prints, attached tape, large serif cover type, smaller detail captions and a distinct closing treatment. |
| Depth cover | A filled cover frame with editable words behind the selected cover subject; straight, quiet interior pages and a separate closing treatment. |
| Film diary | Dark paper, straight film-edge frames, attached perforation details, monospaced captions and separate cover/detail/closing sizes. |

The story workspace starts new projects with Scrapbook. Existing saved stories
keep their graphs and applied definitions. **Look → For this story** previews
the three recipes using the open photos. **Photo looks** retains the original
Scrapbook, Film diary and Clean color-only choices. Their old IDs and revisions
are unchanged; recipes use new `builtin:story-*` identities.

Recipes apply to the whole story. They preserve existing captions, crop/focal
repairs, masks and local photo-color corrections. **Keep adjusted positions**
keeps the existing per-shape/local frame overrides; clearing it resets those
positions while retaining local words and photo corrections. Recipe framing
includes its tilt choices. Preview, cancel, Apply and undo use the existing
single-transaction style workflow. Selecting a scope before choosing a style
does not implicitly reapply the document's previously saved recipe.

Depth cover requires a subject mask on the first cover photo. A mask on another
page does not satisfy that requirement. The unavailable card explains how to
select the cover subject and offers Scrapbook or Film diary as alternatives.
Only the cover photo receives depth type. Existing title words stay; a new
title uses the destination story's name. Captions remain separate. Selecting
another recipe preserves existing user depth titles and subject selections.

**Layout → Photo fit** offers Keep whole crop or Fill the frame. Depth cover
uses the latter on its cover, including the tall output; its interior pages and
the other recipes retain whole-crop framing. Filling a frame can crop the photo
further around its editable focal point. The UI directs users to Photos if the
subject is cut off. This is deterministic framing, not semantic crop safety.
The setting is saved with reusable layout styles and restored by undo/reload.

## Stored composition and validation

[Recipe definitions](../src/story/designs.js) are bounded parameters for three
roles: cover, body and closing. Each role contains layout constraints, built-in
caption/number typography, border color and a supported decoration choice.
The style declares `story-design-v1`; filled layout styles additionally require
`photo-fill-v1`. Imported recipes contain no code, remote
asset URLs or source IDs. The applied definition and role bindings are copied
into the project. Rendering uses stored frames and nodes, not a live catalog.
Reordering moves the existing page treatment with its slide and updates page
numbers. Applying another recipe assigns roles from the new order.

Decorations are ordinary shape nodes with a strict photo attachment. Their
stored frames are relative to the photo; resolution applies the photo's actual
variant/local frame and rotation. Crop/reflow, source replacement and manual
position changes cannot leave the tape or film details at an unrelated canvas
position. Attachments may target only scene images and must share the same
coordinate space and slide membership. Shape-to-shape cycles and dangling or
cross-slide references are rejected.

Recipe replacement removes only the generated decorations named in its checked
ownership record. Conflicting IDs or unrelated artwork fail before the project
changes. Generated details stay separate from the source photo and mask. A
plain color look changes photo/paper/type colors without replacing composition.
Older readers without these fields reject unsupported editing data rather than
silently dropping the attachments; private backups retain the saved record.

The illustrations are first-party vector shapes, with no downloaded texture
pack. Font choices still use platform built-in families. They do not establish
identical typography across operating systems or a licensed production font
catalog. The existing custom-font compositor is unchanged.

## Checks and visual review

[Nine recipe-model tests](../tests/story-designs.test.mjs) cover catalog and
old-look revision separation; counts 6–12 with square, portrait, landscape and
mixed sources; both output shapes; long captions; geometry and photo coverage;
mask/crop/local-word preservation; one-step undo; source replacement; saved
graph stability; fill-frame capture/reuse; cover-mask preflight; strength changes
that preserve the composition graph; and rejection
of malformed definitions, references and ownership records.

An independent coordinate calculation checks that a decoration follows a
manually positioned/rotated photo. It does not use the production resolver to
calculate its expected center. Legacy layout/model/style regressions remain in
the same maintained verification command.

The [browser workflow](../tests/story-designs.browser.mjs) uses the actual
published Pillow runtime, native dialogs, IndexedDB and a 375×667 touch viewport.
It checks own-photo recipe previews, explicit mask import, unavailable-depth
guidance, cancellation, replacement/undo/redo, exact rendered reload, 200% root
font width, fit selection, actual parameter-only recipe downloads, immutable
built-in identity enforcement, and ordered PNG export.

Eight authored slide jobs run at worker limits 1, 4 and 8. Observed peaks reach
each configured limit without CPU/memory admission violations, and every encoded
output matches its live serial reference. This checks concurrency invariance;
it is not an independent rendering oracle, throughput benchmark, full retained
memory measurement or physical-device qualification. The raw hashes and counts
are retained in [concurrency.json](research/2026-09-20/story-designs/concurrency.json).

Eighteen previews cover all three recipes, their cover/detail/closing pages,
and both output shapes. They use three real photographs and one retained
research mask—not eighteen distinct subjects or ground-truth masks. Each
render matches a reference graph in which the photo-relative decorations are
flattened to ordinary shape placement. This integration check reuses the
production geometry resolver; the independent coordinate oracle is the model
test above. PNGs are also decoded by the browser. Input attribution and limitations are in the
[fixture notice](../tests/fixtures/corpus/story-design-v1/ATTRIBUTION.md).

Visual inspection of the initial previews found excessive whitespace on the
tall Depth cover. Its revised fill-frame rule makes the cover image occupy the
available vertical area. The prior
[portrait](research/2026-09-20/story-designs/initial-cover-review/depth-cover-portrait-1.png)
and [tall](research/2026-09-20/story-designs/initial-cover-review/depth-cover-tall-1.png)
previews are retained beside the revised
[portrait](research/2026-09-20/story-designs/depth-cover-portrait-1.png) and
[tall](research/2026-09-20/story-designs/depth-cover-tall-1.png) examples. This
review establishes the observed composition behavior on these inputs; it does
not close photographic quality, legibility across varied subjects, model edge
quality, accessibility, sustained memory or phone performance gates.

Full independent-image/folder execution of these compositions, grouped story
jobs and production asset packs remain unfinished. The image/folder Photo look
consumer explicitly applies only a style's photo-color component.

## Recorded outcome

The full source and 181-file packaged Chromium suites pass, as do the application
checks and 133 deterministic tests (28 scheduler, 105 model/diagnostic). Adapter
parity is 33/33; function coverage is 27/34 against the declared 70% gate. The
[retained verification record](research/2026-09-20/story-designs/README.md) includes
the initial/refined previews, logs, source/test/build snapshot, exact tested site
and file hashes. The published Pillow pair remains unchanged. The dirty-source
aggregate remains unproven for release; the prior throughput benchmark has a
different target identity and was not rerun for this composition change.
