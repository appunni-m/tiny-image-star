# Folder rendering contracts and font recovery

This advances migration §5B's immutable-job requirement. Large-folder text already
uses the shared compositor; this change makes its custom-font inputs independent
of subsequent font-library changes. Grouped stories, multiple output variants,
the full bulk compositor and physical-device/large-corpus qualification remain
part of the migration.

## Job behavior

New jobs store format version 2 and a versioned rendering contract. It identifies
the published Pillow package, its JS/WASM hashes and the declared adapter and
compositor versions. Before the first full render, an admitted worker hashes the
copied recipe and saves the required custom fonts in a separate IndexedDB object
store. The font references and their private byte snapshots commit atomically.
Concurrent workers use the first complete snapshot. Metadata reads and result
pagination do not read every font into memory.

Initial capture takes the job's write gate exclusively and reads the current
record again after acquiring it. A worker holding pre-capture metadata therefore
uses a snapshot committed by another worker, even if the library has since been
cleared. This short preparation step is separate from rendering; completed-file
writes continue to share the gate and run concurrently.

Subsequent renders verify the saved recipe, renderer identity and font hashes.
They use the job's saved source and destination handles. The output journal also
records the rendering-contract digest and checks it before writing. Changing a
recipe or directory after processing starts requires a new job. Owner epochs
and per-entry claims continue to reject stale writers.

Removing a custom font from the library does not remove its job-owned copy.
Closing the tab and resuming the job uses that copy again. A missing or corrupt
snapshot fails the affected output rather than substituting a library or system
font. A missing library font before the initial snapshot can be added again and
the failed entries retried. Forgetting a job atomically removes its metadata,
entries and font snapshots; it leaves exported files alone. Local-data controls
explain that folder jobs manage their font copies separately.

Snapshots are stored as immutable Blobs. Their declared size is checked before
reading their buffers, and the compositor validates both identity and bytes.
Only the validated ID, SHA-256 and bytes enter the compositor. Arbitrary stored
CSS font descriptors cannot affect font matching without belonging to a future
explicitly versioned contract.
Existing limits remain eight custom fonts, 16 MiB per font and 32 MiB total.
Folder text admission reserves eight times the bounded font bytes for reads,
hashes, Blob/storage copies and rasterization, in addition to image and output
reservations. This is estimated admission accounting, not a process-RSS claim.

## Upgrade and recovery boundaries

The IndexedDB upgrade preserves version-1 job and entry records. Those jobs did
not record an engine/font snapshot, so this renderer refuses to silently resume
them. Their metadata remains readable, and their completed outputs stay intact.
The error asks the user to start a new job. No legacy output is re-certified by
assigning it a new contract. An older tab that blocks the database upgrade causes
a useful close-tab message; the upgrade can be retried after it closes.

This does not pin operating-system font files: legacy system-font choices remain
device-dependent. It does not provide a content-addressed application deployment,
a cryptographic identity for every JavaScript source module, or a model snapshot
for unimplemented inference operations. The declared renderer versions must be
maintained when their behavior changes. Existing source metadata checks, explicit
changed-source retry and per-output content digests remain; this is not a full
content snapshot of every file at discovery time. These are separate release
and source-identity gates.

The subsequent [source binding change](FOLDER_SOURCE_VERIFICATION.md) records
content identity at first admitted inspection and checks it through rendering,
resume and saving. It closes same-metadata replacement and stale-entry gaps,
while discovery-time snapshots of untouched sources remain unimplemented.

## Verification

Five deterministic tests cover immutable renderer copies, unsupported/older
contracts, canonical recipe digests, stale/persisted recipe changes and bounded
font manifests. The full deterministic suite passes 167 checks: 38 scheduler and
129 model/diagnostic checks.

The focused Chromium test uses real Pillow workers, IndexedDB, OPFS, Web Locks,
the pinned Noto Sans fixture and native image decoding. It saves the first output,
clears the font library, closes the workers, reloads the page and verifies sixteen
outputs at each of 1/4/8 workers. All 49 successful outputs match the live serial
reference, with the expected worker peaks and no admission violation. Two later
outputs deliberately fail on corrupt and missing snapshots; adding the original
font back to the library cannot conceal the missing job snapshot.

It also verifies immutable recipe/directory/contract updates, mismatched renderer
rejection, stale-owner rejection, atomic rollback after the font write but before
the job commit, a successful retry, snapshot cleanup on Forget, blocked-upgrade
recovery and preservation of older records and an existing output file.

Three reproduced regressions protect the initial-capture race, simultaneous
preparations and unbound font metadata. Two simultaneous preparations peak at
one active capture, read the library once and return the same rendering digest.
A worker with stale pending metadata still renders the exact saved type after
library removal. A stale message destination receives no files: the saved job
destination is authoritative. Extra stored CSS descriptors do not affect the
live serial reference or any of the 1/4/8-worker results.

Opt-in `tinystar/folder-timings@1` diagnostics retain their schema. Engine waiting
ends immediately after the engine is ready, image reads measure only acquisition,
and `sourceDigestMs` now includes job/font preparation and validation as well as
the image digest. All five stages are finite and nonnegative in the browser
checks. The expanded source-check stage must not be compared as a pure hashing
microbenchmark against older records; total job timing still includes all work.

The complete source and optimized 210-file packaged Chromium suites pass, as
does the separate recovery suite with 24 parallel writes and interrupted workers.
Adapter parity is 33/33; the declared function-coverage slice is 27/35 against its
unchanged 70% threshold. The [retained verification record](research/2026-09-20/folder-contracts/README.md)
binds 119 target inputs, 230 source/test/build files and 210 packaged files.
The aggregate remains unproven for release: this is a dirty development revision
and the earlier timing evidence is bound to a different source identity. These
additional job checks have not yet been performance-qualified.
