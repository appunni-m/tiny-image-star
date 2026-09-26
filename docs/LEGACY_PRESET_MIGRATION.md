# Legacy preset migration

Implemented 2026-09-17 for §5A/§5B of the [migration plan](../MIGRATION_PLAN.md).
This is the compatibility migration for saved flat recipes and destination
presets. Applying the new story looks/layouts to independent images and grouped
folder jobs remains separate required work; this change does not complete the
whole preset or bulk workstream.

The follow-on [revision-selection work](RECIPE_SELECTION_VERIFICATION.md) lets
different images retain different revisions of the same recipe ID and keeps
the folder selector tied to its frozen job definition. It adds versioned
recovery references and archives the earlier envelope during migration.
The [historical recovery follow-on](HISTORICAL_RECOVERY_VERIFICATION.md) also
handles snapshots without copied definitions: recover complete saved image
operations, or explain missing custom settings and require a deliberate choice.

The active catalog now lives in IndexedDB alongside immutable definitions.
Each create, edit or delete commits its catalog entry and definition changes in
one transaction. The old localStorage value remains an untouched migration
source, not a second writable catalog. The [catalog model](../src/styles/catalog-model.js)
and [storage adapter](../src/styles/catalog.js) reject stale edits and preserve
drafts for recovery. This is distinct from processing concurrency: it prevents
lost edits across tabs without claiming faster image processing.

## What happens to saved recipes

On startup, the app copies existing `tiny-image-star.presets.v1` recipes into
the transactional style library. Their IDs, names, metadata, operation values,
relative crops and private text remain unchanged. Migration never rewrites or
deletes the original localStorage records. Each committed copy is reopened and
validated before the app uses it. A failed save or reopen leaves the original
available and displays a migration notice with the private-backup path.

Migration accepts the complete bounded original catalog or preserves it as
read-only. Malformed JSON, unknown formats of the catalog itself, duplicate IDs
and invalid recipes cannot be silently filtered into a partial migration.
Changes made by an older app to the original localStorage value also fence new
catalog writes, keeping both copies available for review in a private backup.

Exact duplicates reuse an immutable revision. A changed recipe gets the next
revision for the same ID, allocated inside a read/write transaction; concurrent
tabs cannot assign different definitions to one revision. Existing revisions
remain intact. Explicitly deleting a recipe removes its saved library revisions
as well; copies already applied to projects and jobs remain independent.

Independent creates from the same starting snapshot merge. Editing and deleting
use the entry token captured when editing began; a later catalog refresh never
silently replaces that token or the draft. A conflicting dialog retains its
fields and offers **Save as new recipe**. Applied project/set/job definitions
stay frozen when the library changes. Deleting and recreating an ID or clearing
saved data cannot authorize an older draft to overwrite it.

Every mutation has an operation ID and a hash of its original command. Retrying
the same uncertain commit reopens its receipt instead of allocating another
revision. The last 128 receipts are retained; commands older than that bounded
history are refused rather than guessed safe. Clearing the catalog advances
its generation, including for other tabs. Catalog and definition writes roll
back together on failure.

The database upgrades from version 1 to 2 without rewriting stored definitions.
Unknown future catalog records and newer database versions block recipe edits;
the private backup preserves the raw known catalog/style records and original
legacy text. A backup reads catalog pointers and style definitions from the same
transaction, so concurrent saves cannot split those two representations. The
clear-data action also refuses a newer database before any clear event, legacy
deletion or other-store cleanup begins, and leaves the backup controls usable.
The explicit **Clear saved data** action can discard an unknown catalog record
inside the supported database schema after its normal confirmation; it cannot
clear a newer database schema that this app does not understand.
This does not promise export of unknown future object stores or
binary formats. An older tab may need closing before the schema upgrade can
open; a blocked open reports that condition and does not keep a late connection.

The existing Presets screen shows migrated revision numbers. The image editor,
image-set settings and folder settings consume the copied definition. Single
image projects, image-set recovery and folder jobs retain it rather than
looking up live library settings while rendering. Recovery copies only the
recipes relevant to the active set, avoiding unrelated private recipes and
unnecessary metadata growth. Local-data counts avoid counting the old record
and its migrated copy twice. Private backups include the original source,
active catalog and definitions.

The nine existing destination choices have explicit versioned output definitions
with their existing IDs, names, dimensions and fit/crop rules. Built-in output
definitions are bundled; simply opening the app does not fill the saved library
with copies of them.

## Unsupported output needs an explicit choice

An old AVIF or unknown format remains identifiable. The image and folder
selectors do not silently convert it to PNG. Unsupported recipes cannot start
a folder job or be applied as a new image/set recipe; restored sets report the
affected images as exceptions. Saved adjustable-compression requests also need
an explicit choice when the pinned engine exposes only fixed encoder settings.

The Presets screen offers **Keep edits · use PNG/JPEG**. This first saves and
reopens the original revision, then verifies the replacement before updating
the active recipe. It preserves the original ID and all non-output operations,
including text and crops. The prior output intent remains in its old revision.
Cancelling local-data retention interrupts pending migrations and replacements.
Unavailable cards remain accessible groups whose replacement/delete controls
are usable; disabled state is not inherited by those recovery controls.

## Private compatibility format

[The compatibility model](../src/styles/legacy.js) stores
`tiny-image-star/legacy-style` version 1: stable ID, revision, name,
recipe/output category, exact engine identity including JS/WASM hashes,
per-image execution, explicit legacy operation order, and the complete original
recipe. The order is EXIF, crop, rotate, flip, resize, adjust, text, encode.
An unknown engine can remain preserved but cannot execute as the current one.

Definitions contain bounded declarative JSON. They reject executable/binary
values, unsafe properties, unknown operations, invalid geometry/flags/quality,
unsupported transform order and definitions over 256 KiB. Unknown or corrupt
nested style data is retained for backup rather than silently stripped.
They share the library's 100-revision and 2 MiB storage limits. Capacity or quota
failure preserves the original recipes and prior library state; the app does
not delete old revisions automatically to make room.

These private definitions intentionally retain legacy caption text and exact
crop intent. They are not public `.tstyle` parameter files: the story-style
import/export path rejects them, and the story picker filters by execution
format. Use the private `.tstar` backup for them. Licensed asset packs,
cross-device font installation and the broader public style adapter remain
required work.

## Verification

[Seven model tests](../tests/legacy-styles.test.mjs) cover every destination,
identity/order/engine preservation, private-field roundtrips, frozen consumer
settings, unsupported output/compression, folder job copies, engine refusal,
and malformed/future/oversized data.

[The browser regression](../tests/legacy-styles.browser.mjs) checks automatic
migration without rewriting the original JSON; actual Pillow rendering on
portrait, landscape and square sources; exact byte equality between the
original recipe, migrated image settings and folder settings; independent
output dimension checks; explicit AVIF-to-JPEG replacement retaining revision
one; repeated reload/two-tab migration; concurrent revision allocation; injected
quota and reopen failures with retry; and cancellation during data clearing.
It also applies a migrated recipe through the canvas UI, verifies the copied
definition in editor recovery, and checks that library removal leaves it intact.
An unversioned fallback explicitly clears the previous style identity rather
than attributing different settings to that revision.

[Eight catalog model tests](../tests/recipe-catalog.test.mjs) cover complete
original parsing, independent creates, edit/delete races, deleted-ID
resurrection, idempotent retries, reused-operation rejection, bounded receipt
history, generation changes and strict schema validation.

[The catalog browser regression](../tests/recipe-catalog.browser.mjs) uses two
real tabs to race creates and edits, exercises conflicting editor drafts and
**Save as new recipe**, and verifies that remote deletion leaves an applied
project unchanged. It injects quota failure after the definition write to prove
whole-transaction rollback, and a readback failure after commit to prove that a
retry creates only one definition. Clearing fences the other tab's stale draft.
Malformed/future/duplicate original catalogs and future catalog/database
versions remain unchanged and appear losslessly in actual downloaded backups.
The test observes a shared transaction for catalog/definition backup reads,
checks the v1-to-v2 schema upgrade, and exercises the refused clear through the UI.

At 375×667, conflict recovery fits without horizontal overflow and offers a
reachable button at least 44 pixels tall. At 200% text size the dialog still
fits horizontally. The [phone screenshot](research/2026-09-17/recipe-conflict-phone.png)
is browser emulation; physical touch, virtual keyboards and screen readers
remain separate qualification work. The recovery dialog scrolls vertically.

Final runs for this step on 2026-09-17:

- `npm run verify`: passed, including all 48 project/layout/style/migration/catalog
  tests and eleven scheduler tests.
- `npm run verify:browser`: the complete source suite passed.
- `node scripts/assemble-pages.mjs _site` and
  `node scripts/check-pages-artifact.mjs _site`: passed, 133 files. The published
  WASM remains unchanged.
- `TINY_IMAGE_STAR_BROWSER_ROOT=_site npm run verify:browser`: the complete
  packaged suite passed, including existing single-image, interactive batch,
  folder, story, storage, theme and mobile-layout workflows. No unexpected
  external requests or page errors were reported.
- `npm run migration:check`: passed the specification/anti-cheat checks for
  two endpoints and 33 cases. The immutable parity oracle was not changed.
- Documentation links (33 Markdown files) and `git diff --check`: passed.

Regression work fixed inherited disabled state on replacement buttons and
limited menu-state preservation to background migration refreshes. The folder
import test now waits for the actual canvas within its existing ten-second
timeout; filename/tray metadata alone did not prove that decoding had finished.
Catalog regressions also wait for committed create/delete results rather than
assuming synchronous localStorage updates. The conflict recovery button grew
from 36 to at least 44 pixels tall, and dialog buttons wrap at enlarged text.

Artifact verification exposed a pending folder-selection race: the summary
correctly kept showing the committed recipe while the destination button was
already usable. Holding a real IndexedDB write open reproduced it. Folder
controls now show **Saving your recipe choice…** and prevent destination/source
changes until persistence finishes. The browser regression holds that write,
checks disabled controls, releases it, then verifies both the durable recipe
and visible summary before continuing to output selection.
The working tree is uncommitted and this step did not deploy the site or rerun
throughput qualification.

These checks do not qualify large-collection throughput, native filesystem
recovery, physical-phone limits, model/font licensing, new story-look execution
in bulk, grouping/variants, or the remaining production release gates.
