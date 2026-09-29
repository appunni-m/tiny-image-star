# Folder source binding and repair

Implemented 20 September 2026 as part of migration §5B. Source contents now have
a durable SHA-256 identity from their first admitted inspection or render.
The metadata-only discovery scan still does not read every image. A source
that has never reached inspection is therefore not a discovery-time content
snapshot; that broader release requirement remains open.

## Processing contract

Both the processing client and worker read the current claimed manifest entry.
They use the saved relative path and source/destination handles, rather than
trusting stale copies attached to queued messages. Recipe and claim checks
continue to reject a changed recipe, an old owner or a superseded attempt.

Inside an admitted worker task, the source is read and hashed before image
inspection/decoding. A strict IndexedDB transaction records its schema, SHA-256,
byte length and modification time under the current owner and claim. Different
bytes are rejected even if their length and modification time are unchanged.
The transaction finishes before inspection returns or full rendering begins.
The identity survives a paused attempt or page reload.

When inspection and rendering are separate tasks, the inspection digest also
travels with the full task. The second admitted read must match it. This closes
the gap between inspecting one input and rendering a replacement. Callers that
already supply dimensions still bind/check contents before full rendering.
Before journaled output starts, the writer checks the saved source digest again.
These checks operate on the actual read buffer; a later external change cannot
alter bytes already supplied to the renderer.

Hashing, its temporary copy and the durable metadata write take place inside
existing CPU/memory admission. Only the small identity record is persisted;
the job does not retain every original image in memory or IndexedDB. The existing
inspection and image estimates reserve source/hash copies. Estimates do not
measure browser RSS, native caches or sustained throughput.

## Repair and review

An ordinary resume preserves the bound identity. A replacement becomes a failed
entry with a request to check the file. **Retry failed** can accept one updated
source when no output save has begun; accepting it updates the saved size/time
and consumes that repair permission. A further replacement during the same
attempt is rejected. Successful entries are not retried.

An existing output intent permanently binds its source digest. Retry cannot
replace that source with different bytes, even when the original save was
interrupted. The existing output and journal remain available for recovery.
Starting a new job is required to produce a different result in that situation.

Sample previews check an existing source identity without modifying it. They
cannot silently preview replacement bytes as if those were the saved job's
source. Unstarted sources still use the earlier metadata checks until processing
records their first content identity.

This is an additive field in existing version-2 entry records; the IndexedDB
schema is unchanged. Previously completed entries without it are not recertified
or reprocessed. Existing output-journal digests remain authoritative. Older
version-1 jobs still retain the earlier rendering-contract upgrade fence.

## Verification and boundaries

Three [deterministic tests](../tests/folder-source.test.mjs) check strict identity
shape, immutable copies, identical-metadata replacements, single-use repair and
journal protection. The deterministic suite contains 181 checks: 38 scheduler
and 143 model/diagnostic checks.

The [Chromium regression](../tests/folder-source.browser.mjs) renders 27 real
Pillow outputs at worker peaks 1, 4 and 8. Every output matches a direct serial
render and decodes independently to the expected dimensions. Every completed
entry retains the source hash; admission violations are zero. It also exercises:

- Forged/stale message paths and source handles against the saved manifest.
- A replacement between real worker inspection and rendering, with no output
  created, followed by explicit repair and successful output.
- An already persisted identity surviving page/worker teardown and reload,
  followed by rejection of changed contents on ordinary resume.
- Racing first bindings, stale claims/owners, save-time digest checking,
  journal-protected retry and read-only sample rejection.

The same-size/time scenario uses real OPFS BMP inputs and a test shim that gives
both the page and worker a constant timestamp. It proves digest enforcement
independently of timestamp changes; it is not an operating-system timestamp or
physical-filesystem qualification. The reload fixture explicitly stores its
first identity before teardown; the separate race fixture proves the real
inspection worker performs that durable write.

The [dated verification record](research/2026-09-20/folder-sources/README.md)
retains exact source/package identities and terminal checks. Discovery-time
content snapshots of untouched files, immutable whole-application deployment,
grouped/multiple-variant folder composition, advertised collection sizes,
physical phones, sustained performance and all other release gates remain open.
