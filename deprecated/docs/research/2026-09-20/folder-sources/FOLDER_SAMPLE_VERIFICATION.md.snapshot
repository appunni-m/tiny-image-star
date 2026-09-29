# Folder recipe previews and exception review

Implemented 20 September 2026 for migration §5B. This adds review around the
existing per-image folder recipe renderer. Grouped stories, independent-image
scene styles and multiple output variants in durable folder jobs remain open.

## User workflow

After scanning a folder, **Preview sample** shows the complete planned output
count, the copied recipe and the chosen destination when available. There is
one planned output per source in this execution mode. Failed sources can reduce
the actual number saved; retry does not repeat successful writes.

The sample selector reads metadata in pages of at most 512 records and retains
at most 12 chosen entries. It includes the largest encoded file of each supported
format, the smallest file and the first/middle/last discovery positions. JPEG
and TIFF filename aliases share buckets. Ties and ordering are deterministic.
This is sampling by file size, type and order, not a scan of every photo's
aspect ratio or semantic content. Unsampled sources can still fail or crop poorly.

Each preview executes the actual output recipe: EXIF handling, crop/rotation,
resizing, color/photo look, text and selected encoding. Only after that full
render does the worker create a PNG thumbnail of at most 512 pixels on its
long edge. The card displays the actual full output dimensions, format and
encoded size. The preview does not write destination files, claim manifest
entries, increment attempts/counters or freeze an editable recipe.

Before a job starts, preview font bytes are validated from the local library.
After a rendering contract is frozen, previews use the same job-owned verified
font snapshots as folder exports. Clearing the font library or reloading does
not silently substitute another font. Missing/changed source and font failures
appear on individual sample cards.
Unbound library FontFace descriptors are ignored before the job starts, matching
the byte-only font contract used by the eventual export.

The later [source binding change](FOLDER_SOURCE_VERIFICATION.md) also checks
already-bound source hashes during admitted preview reads. It does not update
the job identity or accept replacement bytes on the user's behalf.

**Retry failed samples** retains successful thumbnails and only repeats failed
sample work. **Only samples needing attention** shows failures and every sample
using a crop/fill rule, so users can inspect framing. This is a manual review
prompt; it does not certify subject placement, mask quality or safe cropping.
Done/Escape cancels unfinished admission/preparation and releases thumbnail
URLs/reservations. The opener is enabled before keyboard focus returns.

## Large-job exception review

**Only files needing attention** uses the existing `[jobId, status]` database
index and a bounded cursor window. It does not load all failures or all source
bytes. Dense virtual row positions are separate from original manifest indices;
the source identity stays unchanged when filtering. Tap a failed row or press
Enter/Space to open its full path/error text. The existing failed-only retry
flow repairs those sources while preserving completed exports. After repair,
the empty filtered view says that no files need attention.

## Scheduling, memory and estimates

Inspection and full render use the same resource scheduler as the editor,
folder writes and scene composition. Source bytes and verified font records
are read only in admitted preparation. Inspection is separate from full render
admission; a dimension/size rejection does not start the full recipe render.
Full render estimates reserve image/encoding surfaces, font snapshot work and
the thumbnail stage. Returned encoded bytes, Blob construction and displayed
thumbnail pixels receive a retained-memory reservation before task admission
is released. Closing also prevents delayed preparation from reading new source
bytes or recreating the sheet. These reservations are estimates, not measured
browser process memory or complete native font-cache accounting.

After at least two successful samples and one second of elapsed work, a sample
estimate extrapolates measured sample wall time to the full folder. It includes
selection/inspection/preview overhead and is biased toward the chosen large
files; it excludes destination writes. The UI labels it as an estimate and
explains that saving/device changes can extend it. Failures suppress this
estimate. During processing, the remaining-time estimate is recomputed from
actual finished entries and elapsed time in the current run, including saves.
Resume starts a new measurement window. Estimates are not throughput claims.

## Verification scope

[Model checks](../tests/folder-sample.test.mjs) exercise 100,000 metadata entries,
format coverage, size extremes, deterministic ties, small/empty sets, immutability
and estimate prerequisites. The
[browser regression](../tests/folder-sample.browser.mjs) compares 27 real
crop/color/custom-font preview outputs at worker peaks 1/4/8 against direct
serial references, including full-output metadata and native preview decoding.
It exercises an injected admission failure, a corrupt source, successful-preview
retention, unchanged job counters/contract before processing, 200% text, focus,
full failure details, actual output writes, failed-source repair, font-library
clear/reload and cancellation cleanup.

These browser checks use headless Chromium, a 375 × 667 viewport and
browser-managed OPFS directories behind a substituted picker. They exercise
the real database, worker and write paths, but do not qualify a physical phone,
native operating-system picker, permission re-prompt or filesystem crash.

A separate 100,000-entry IndexedDB fixture reads the last ten of 50,000 failures
through the status index while entry-store `getAll` is made to throw. This
verifies bounded review over a large metadata manifest. It is not a 100,000-image
processing benchmark or physical-filesystem capacity qualification.

The [dated record](research/2026-09-20/folder-samples/README.md) retains terminal
results, screenshots and exact source/artifact hashes. Physical phones, real
photo quality/crop evaluation, exhaustive aspect sampling, source/application
identity completion, grouped recipes, full collection composition, sustained
throughput and the remaining production gates are still open.
