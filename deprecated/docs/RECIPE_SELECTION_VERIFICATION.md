# Recipe revision selection

Implemented 2026-09-17 for §5A/§5B of the [migration plan](../MIGRATION_PLAN.md).
This extends the [transactional recipe catalog](LEGACY_PRESET_MIGRATION.md)
through image-set selection, recovery and the folder UI. It does not complete
story-style execution in bulk, grouping, variants, scale or production gates.

## Applied revisions are independent

The [selection model](../src/styles/selection.js) identifies a recipe by its ID
and immutable revision, using an unambiguous encoded pair. An unversioned copy
has a distinct identity. IDs containing delimiters cannot collide. A second
definition claiming the same identity with different settings is refused.

The image set records exact references for the shared recipe, the default for
new images and each per-image recipe override. Different images can use two
versions of the same ID. **This image**, **Selected images** and **All images**
compare these references rather than just the ID. A mixed selection displays
**Different recipes or versions**. Custom choices show their version number.
Applying to all resets scoped recipe choices while keeping manual corrections.
Applying another recipe trims pinned definitions to those still used by the
open set and its default for new images; unused history does not grow with
every selection.

Library edits and deletion do not replace applied definitions. Clearing saved
local data also preserves recipes and corrections in the open image set.
Explicit subsequent edits can create a new recovery copy, as with other open
work. Saved-library cards still reflect the actual library.

Folder choices include the exact definition stored in the job even when the
library renames, updates or deletes that ID. The selector names that saved
version; a newer library version appears separately. Before choosing an output
folder, an explicit selection can update the job transactionally. Once its
output is chosen or processing begins, the existing job keeps its frozen
definition. This does not implement changing a running job into a new job.

## Recovery format and fences

New image-set recovery uses envelope version 2 with validated references and
the complete copied definitions. The project document and session metadata
must agree. Unknown reference versions, missing revisions, mismatched IDs,
duplicate identities, invalid wrappers and inconsistent file maps fail before
restoration or replacement. These new records never repair a missing reference
by looking up a live library entry. The bundle digest includes its references.

Envelope version 1 remains readable. ID-only snapshots with copied definitions
resolve those copies without silently substituting library entries. Saving the resulting
version 2 record archives the complete version 1 record in the same transaction.
The browser regression compares every field of that archive with the original. Source
buffers are reused while resolving references, rather than duplicated for a
metadata migration. Backups retain both envelope versions; garbage collection
recognizes the new format and preserves unknown records.

Older app code already refuses recovery envelopes other than version 1, so it
cannot overwrite this version 2 envelope through its normal recovery saver.
The current saver also refuses an attempted same-project downgrade that drops
exact references. This is a format fence, not a claim that arbitrary older
service workers or external tools have been qualified.

The follow-on [historical recovery work](HISTORICAL_RECOVERY_VERIFICATION.md)
uses complete saved image operations when copied definitions are missing. The
oldest ID-and-patch records use frozen built-ins or require an explicit recovery
choice for missing custom definitions. No original custom recipe is inferred
from a mutable current library entry.

## Browser and model evidence

[Six model tests](../tests/recipe-selection.test.mjs) verify separate selections
for one ID, delimiter-safe identities, duplicate-definition refusal, malformed
references, old copied-definition migration and reopening without a library.

[The browser regression](../tests/recipe-selection.browser.mjs) uses two tabs
and the actual Pillow runtime. It applies version 1 to two images, flips one,
and applies version 2 only to that image. Its first corrected output is compared
with an independent direct Pillow render. The other output remains byte-identical.
It then updates and deletes the library recipe, verifies a folder job still
labels and renders version 2, reloads the image set and compares exact output
hashes. Both applied definitions survive. It also verifies selected-scope
changes, preservation after clearing saved data, missing-reference read/write
fences and the archived version 1 upgrade.

The phone test waits for the actual mobile layout, opens its Batch sheet and
checks a 44-pixel or larger selector within a 375×667 viewport. At 200% root text
size the sheet has no horizontal overflow. Long buttons wrap and output controls
stack. [Phone screenshot](research/2026-09-17/recipe-version-phone.png).
These are emulated layout checks; touch, virtual keyboards, screen readers and
physical-device stress remain unqualified.

During verification, the installed Playwright implementation treated a Promise
returned by `waitForFunction` as immediately truthy. Those asynchronous waits
could therefore stop before a database or lock condition was true. The shared
[awaited polling helper](../tests/helpers/wait-for-async.mjs) now handles all
such calls in the browser and folder-recovery suites. Existing synchronous
DOM predicates retain `waitForFunction`. Conditions are asserted after awaiting
the actual read; fixed sleeps are not used to substitute for readiness.

Final verification on 2026-09-17:

- `npm run verify`: passed, including 54 project/layout/style/catalog/selection
  tests and eleven scheduler tests.
- `npm run verify:browser`: complete source suite passed.
- `npm run verify:folder-recovery`: passed real IndexedDB, OPFS, Web Locks,
  concurrent journal writes, ownership handoff and terminated-worker recovery.
- `node scripts/assemble-pages.mjs _site` and
  `node scripts/check-pages-artifact.mjs _site`: passed, 135 files, unchanged
  published WASM. Optimized JS is 372,202 bytes; CSS is 59,367 bytes.
- `TINY_IMAGE_STAR_BROWSER_ROOT=_site npm run verify:browser`: complete
  packaged suite passed, including existing image, folder, story, storage,
  theme and mobile flows. No unexpected external requests or page errors.
- `npm run migration:check`: specification/anti-cheat checks passed for two
  endpoints and 33 cases; the parity oracle was not modified.
- Documentation links (34 Markdown files) and `git diff --check`: passed.

This work is uncommitted and has not been deployed. Throughput benchmarking was
not rerun for these selection, recovery and layout changes.

## Remaining delivery scope

The new story look/layout format still needs per-image and grouped-folder
consumers, representative sampling, output variants, capacity estimates and
exception review. This work provides selection/recovery correctness for the
existing private legacy-compatible recipes. Throughput, native filesystem
failure, physical-phone limits, licensed assets and the full release gates
remain separate requirements. No deployment or performance claim follows from
these checks.
