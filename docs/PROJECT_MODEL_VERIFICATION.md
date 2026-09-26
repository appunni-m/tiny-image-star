# Project documents, history and recovery

Recorded 2026-09-17. This implements part of migration §7 and the persistence
foundation for §5A. It does not complete the story editor, curated presets or
production gates. The [execution ledger](MIGRATION_STATUS.md) retains that scope.

## Live integration

The existing canvas now holds a versioned project document. Its legacy image
node supplies the operations sent to the Pillow worker. Inspector edits and
direct manipulation preview a document revision; finishing an edit records one
reversible command. Undo/redo applies inverse/forward commands by stable node
ID. History is bounded to 100 commands and 2 MiB of command metadata, with no
image buffers. New edits discard redo. Repeated slider previews remain one
undo action, while cancel can return to the starting document.

The legacy node retains the original upright-source pixel crop coordinates,
including fractional values, and declares the order: EXIF normalization, crop,
rotation, flips, resize, grayscale/brightness/contrast adjustment, text, encode.
This avoids silently changing the old renderer during schema migration. The
actual pinned JS/WASM SHA-256 values and package/adapter versions are recorded.
A document requiring a different renderer is preserved and blocked from being
silently rendered or overwritten by the current one.

## Layer graph and coordinates

Projects have stable asset, slide and node IDs, an ordered slide list, shared
settings, local overrides, output variants, deterministic seed and dependency
references. Original source bytes are outside this graph. Structural validation
bounds metadata, counts, depth, numeric values and references; binary payloads,
executable values, prototype keys and remote source URLs are rejected.

The resolver supports image, text and shape geometry in addition to the legacy
node. Slide-local frames are fractions of a viewport. A connected node uses
slide widths horizontally and slide height vertically, anchored to a stable
slide ID. Each viewport resolves separately; no stitched bitmap is allocated.
Shared appearance resolves before scoped look bases, manual node values and
slide-local patches. The optional image `appearanceBase` keeps a scoped style
separate from manual corrections; older nodes resolve as before. Older app
versions reject this new node key rather than silently ignoring a scoped look.
Changing a source reference invalidates dependent slide render descriptions.

These generic nodes now have a [worker scene renderer](SCENE_COMPOSITOR_VERIFICATION.md)
with masks, text metrics, connected-slide seam tests and preview/export
comparisons. The [visible story workspace](STORY_WORKSPACE_VERIFICATION.md)
now assembles photos and edits these nodes through command history. Stored
[variant frames and width-based type](ADAPTIVE_LAYOUT_VERIFICATION.md) support
reflow and manual override review. Finished authored recipes remain required work.

## Persistence and migration

New recovery writes use `tiny-image-star.projects` IndexedDB stores for document
records and content-addressed Blob assets. SHA-256 verifies source identity;
identical source bytes share an asset. Document/asset updates and removal of
unreferenced assets are one transaction. A strict-durability commit is followed
by metadata readback. Restoring verifies the source length and digest.

The previous `tiny-image-star.session` records are read without rewriting them.
Once restored and edited, a new project copy is saved and reopened; the old
record remains until an explicit clear. Unknown schemas, incompatible engines,
older revisions and conflicting content at the same revision cannot overwrite
the current saved project. Unknown versions remain available in the backup.
Project asset storage has a 128 MiB budget; each active recovery snapshot retains
the existing 64 MiB source limit. These are application limits, not device-RAM
or eviction guarantees.

Scene documents use the same content-addressed store through `writeStoryProject`
and `readStoryProject`. Images, masks and fonts save atomically. Opening returns
metadata and Blob handles; accessing an asset verifies its digest. Scene updates
also compare the caller's last saved revision inside the transaction, rejecting
stale saves from another tab even when that tab has a higher local edit revision.
Open revisions retain immutable Blob handles across later asset garbage
collection. See [scene recovery evidence](SCENE_COMPOSITOR_VERIFICATION.md).

Batch recovery preserves its existing scope and per-image overrides and copies
the applied legacy recipe definitions into the project. The recipe revision is
the SHA-256 of its canonical definitions. Restored projects use those copies
instead of silently following later library or built-in changes. Explicit
library edits update the active legacy recipe copy. The later
[legacy-style migration](LEGACY_PRESET_MIGRATION.md) adds immutable per-recipe
revisions and verified readback for image, set and folder consumers. New story
style application to independent images and grouped bulk jobs remains required.

## Backup archive

Local data now offers **Back up saved work**. The `.tstar` archive contains saved
recovery documents, original source assets, retained legacy snapshots, custom
font bytes and saved recipe metadata. It is private project data, including
captions, rather than a shareable style file. Asset binaries are Blob parts;
they are not expanded into base64 or arrays of pixel bytes.

The envelope is `TSTAR1\n`, a four-byte big-endian JSON-header byte count, the
UTF-8 header, then consecutive binary assets in header order. Every asset entry
declares its SHA-256, length and MIME type. Header `extras` uses `binaryAsset`
references for legacy/font buffers. Automated verification parses the archive
independently, checks every asset digest and exact final length, and confirms
that unknown project metadata is retained.

The backup download is implemented; **an in-app archive importer and its
conflict/space/version review are still pending**. Folder-job manifests and
externally saved folder outputs are outside this archive. Do not present it as
a backup of every file on the device or as a qualified backup/restore release
workflow yet.

## Evidence and remaining work

`npm run verify:project-model` passes thirty-three tests covering the pinned runtime hashes,
exact PNG/JPEG rendering across serialization, exact legacy geometry,
preview/commit/cancel/undo/redo, history limits, override precedence, connected
viewport geometry in both ratios, dependency invalidation, malformed data and
the known renderer upgrade without mutating the original document, scene style
validation, bounded preview dimensions, affine photo placement, story assembly
at every supported photo count, appearance/geometry separation and reversible
slide numbering.
These run in the ordinary `npm run verify` gate.

The Chromium suite uses real IndexedDB for migration, deduplication, reopen,
conflicting revisions, an injected quota failure, future-version preservation
and backup integrity. The UI suite also exercises existing crop/text/history
and scoped recipe workflows, recovery after reload, a real backup download with
font/recipe data, explicit cleanup, and mobile dialog layout. The underlying
image outputs still pass the existing real PNG/JPEG workflow checks.

The shared text path and retained renderer archives have
[separate verification](TEXT_COMPOSITOR_VERIFICATION.md). The multi-photo
renderer and scene storage have [additional browser checks](SCENE_COMPOSITOR_VERIFICATION.md),
including exact rendered reloads, real two-tab conflicts, quota rollback and
shared-asset collection. The [story workspace](STORY_WORKSPACE_VERIFICATION.md)
now uses this storage/history foundation and exposes conflict-copy handling.
Next work includes finished authored recipes, real-photo layout review and story-style bulk execution. History is currently
an in-memory editing-session facility; history persistence and retaining old
source versions for future source-replacement undo need qualification. Complete
font/model dependency pinning, project archive import, visible cross-tab
conflict handling, storage eviction recovery, full memory accounting and device
stress remain open. Physical observations and production readiness are not
inferred from these Chromium checks.
