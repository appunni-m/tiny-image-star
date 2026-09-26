# Folder rendering contracts — 20 September 2026

This advances migration §5B's immutable-job requirement. Version-2 folder jobs
retain the copied recipe, declared renderer identity and custom-font bytes needed
by all their outputs. Read the [behavior and boundaries](../../../FOLDER_RENDER_CONTRACT_VERIFICATION.md)
before interpreting these results as a broader release claim.

## Reproduced failures and fixes

- A task holding metadata from before font capture reread a library that had
  since been cleared. [Failing regression](pending-metadata-red.log). It now reads
  fresh job metadata under the capture gate and uses the committed snapshot.
- Arbitrary stored CSS font descriptors survived byte verification and could
  influence matching. [Failing regression](unbound-metadata-red.log). Snapshot
  reads now pass only validated identity and bytes to the compositor.
- The ordinary shared write gate allowed two initial captures simultaneously.
  [Failing regression](parallel-capture-red.log). Initial capture now takes that
  gate exclusively; subsequent rendering and output writes remain concurrent.

The red logs are pre-fix diagnostics, not qualification of the final revision.
The [final focused run](focused-green.log) includes all three regressions and
uses real Chromium workers, Pillow, IndexedDB, OPFS and Web Locks. It observes
one initial capture and one library read for two simultaneous tasks. Removing
library fonts, closing workers and reloading still produces 49 exact serial
outputs at observed worker peaks 1/4/8 with no admission violation. Two later
outputs intentionally fail for corrupt and missing private snapshots.

The same test covers saved destinations, atomic quota rollback/retry, immutable
recipe and renderer identity, stale owners, blocked database upgrades, preserved
version-1 records and exports, and snapshot cleanup when forgetting a job.

## Final verification

| Check | Result |
| --- | --- |
| [Deterministic suite](unit.log) | 167 pass: 38 scheduler, 129 model/diagnostic |
| [Source browser suite](source-browser.log) | Pass |
| [Optimized package browser suite](packaged-browser.log) | Pass |
| [Folder recovery](recovery.log) | Pass, including 24 concurrent output writes |
| [Package assembly and validation](package.log) | 210 files |
| [Adapter parity](parity.json) | 33/33 comparisons pass |
| [Declared adapter coverage](coverage.json) | 27/35 functions; unchanged 70% threshold passes |
| [Specification validation](migration-check.log) and [fixture audit](fixture-audit.log) | Pass |
| [Release aggregation](aggregate.log) | Unproven: dirty source and no compatible current timing result |

`verification.json` is the final hash receipt. The [target](target.json) binds
119 processing inputs in [source-files.json](source-files.json). The
[source archive](verified-source.tar.gz) contains 230 source/test/build files
listed in [archive-files.json](archive-files.json); the [tested site](tested-site.tar.gz)
contains 210 files listed in [packaged-files.json](packaged-files.json). Archives
and inventories are re-read and independently hashed when the receipt is sealed.
Documentation snapshots retain the original repository-relative paths; they are
historical text, not a second navigable documentation tree.

Reproduce from the source archive with its locked dependencies and Chromium:
`npm run verify`, `npm run verify:browser`, `npm run verify:folder-recovery`,
`make package-pages`, then the browser suite with `TINY_IMAGE_STAR_BROWSER_ROOT`
set to the absolute `_site` path. The [focused runner](focused-runner.mjs) uses
the original absolute workspace path; adjust that path when restoring elsewhere.
Canonical parity and coverage commands remain in `package.json`.

No benchmark inputs, timing budgets or output-validation requirements changed.
The collection harness now saves its selected output handle in the job, matching
the app's authoritative destination contract. Earlier canonical timing results
describe their earlier source revision; no new throughput claim is made here.
System fonts, complete app deployment identity, discovery-time source snapshots,
physical phones/filesystems, advertised collection sizes and production release
gates remain separately unqualified. Nothing was deployed.
