# Grouped story creation

Implementation checkpoint: 26 September 2026, including durable photo batches. Source implementation only;
browser, package, device and regression testing are deferred at the user's
request. This is not a production-readiness certificate.

## Workflow

In Photo stories, choose **Make several stories**. Select photos, or choose a
folder where the browser offers directory selection. Review groups of 6–12
photos before creating anything. Grouping can span the selection or preserve
each exact parent folder. Picker order is available; folder selection defaults
to file-name order. Review the actual photo order in each group.

The sheet offers four explicit leftover policies:

- Decide before creating: incomplete groups block creation.
- Rebalance: redistribute photos within each bucket into groups of 6–12. This
  may change the requested group size. Folders with fewer than six still need
  more photos or the leave-out policy.
- Include a smaller final group: only when it contains at least six photos.
- Leave leftovers out: show the excluded photos before creating the stories.

Unsupported file names/types are listed separately. File signatures and image
capabilities are checked during import; a supported extension does not bypass
inspection. Invalid or animated photos stop their group with an actionable
error. Empty files and groups over 96 MiB are flagged in the preview.

Rename or exclude individual groups. Choose Scrapbook, Depth cover or Film
diary, with bundled or device fonts. Depth cover still requires manual subject
selection in each story's Cutout tool. Each saved story contains its own applied
preset revision and can be edited independently. Group previews are paginated
in sets of 20; they show membership and order, not rendered artwork.

Creation uses the existing Pillow import scheduler and commits each story and
its assets atomically. Only the active group's sources are read. Integrity-read
and font allowances are reserved in addition to worker estimates. Completed
stories survive Pause; Continue resumes the unfinished groups in the same
sheet. An explicit Skip failed story action permits moving past an error.

**Export created stories** opens the existing durable batch exporter with those
stories selected in their original group order. Review shapes, format and
destination before copying/exporting. This handoff does not start an export
automatically.

## Durable export batches

After reviewing photo groups, choose **Create a durable export batch** to bypass
the editable library's 128 MiB asset budget. Choose shapes, format and either
browser download/share staging or a writable destination folder. This route
currently accepts presets that need no subject mask, including Scrapbook and
Film diary. Depth cover stays in the editable-story route for manual subject
selection. Individual batch crops/captions cannot currently be edited in place.

The job and its full source metadata manifest save together. Import then has
two passes: inspect each group and save its exact scene/source hashes, then
reserve storage for the complete collection and copy verified photo/font bytes
into job-owned storage. Group snapshots commit atomically with progress. The
output manifest is sealed only after every group is copied; rendering uses the
existing concurrent scheduler and resumable output pipeline.

Pause, close and reload preserve inspection plans and completed group copies.
Reopen the batch under **Export saved stories**, reselect the original photos or
the same folder, and choose **Continue importing photo groups**. Groups already
copied do not require their original files. Inspected but uncopied photos must
match both saved metadata and SHA-256. Photos never inspected have only their
original name, path, size and modification time pinned until the first read;
the app does not claim a content fingerprint for unread files. Ambiguous source
names/metadata require selecting a folder with distinct relative paths.

The preset definition, manifest hashes and completed scene plans are versioned
and frozen. Changing import-generation semantics requires a new compatible
schema/renderer contract; it must not silently regenerate existing plans.
The new job-store version is 5, with a separate `photo-imports` store. Forgetting
a batch removes its import plans, source snapshots and staged outputs together.

Browser output retains the existing 2 GiB structural staging allowance. Folder
output reserves its local source/metadata cache against available browser quota
and other pending jobs. A folder destination therefore does not imply unlimited
browser storage. There is no new measured collection-size or throughput claim.
Source reads occur inside a bounded group memory reservation; inspector workers
can remain warm between groups while they fit the shared memory budget.

## Limits and remaining work

The editable-story path uses the existing shared **128 MiB
project/recovery asset budget** applies across all stories; each group's input
is limited to **96 MiB**. The sheet shows available library space and estimated
source/font bytes. Identical stored assets deduplicate, and the save transaction
enforces the budget even if another tab writes meanwhile. Browser quota may
be lower. A budget failure preserves earlier saved stories.

The metadata planner accepts up to 12,000 selected files and 1,000 groups. These
are structural bounds, not measured capacity promises. There is no new
large-collection or mobile-throughput claim.

For editable library imports, unfinished selection state lives only in the open
sheet. Closing or reloading keeps saved stories but requires a new selection for
unfinished groups. Durable export batches preserve their import plan and offer
source reselection as described above. Neither route uploads photos or promises
that processing continues while a phone browser is suspended.

Syntax and module-loading checks passed. The existing database-upgrade check's
expected version was updated, but no test suite was run. Browser/device import,
upgrade/recovery, source-change rejection, quota competition, packaging and
throughput qualification remain deferred.

No automatic semantic grouping, automatic segmentation, HEIC decoding,
background execution, or physical-device qualification was added in this slice.
