# Migration execution ledger

Authority: [the complete migration plan](../MIGRATION_PLAN.md). This ledger tracks implementation and release evidence separately. A working implementation is not a passed production gate. The full plan remains the objective.

## Current checkpoint: 26 September 2026

The latest implementation adds grouped story creation, durable photo batches,
and a mobile text-overlay sheet for independent batches (All/Selected/This
image) and frozen large-folder recipes. The overlay includes four adjustable
typography starters and can be saved as part of a reusable full image recipe.
Standalone overlay-only presets and broader layered typography/layout,
cutout presets and size variants remain open. Auto batch scheduling now starts
with up to eight workers on well-provisioned devices and requires a queued wave
of comparable work before expanding further.

Automated checks for this tree pass: `npm run verify:all` (40 scheduler and
151 project/model tests, Chromium workflows, WebKit staged export, security,
folder recovery and documentation); `make package-pages` (251-file artifact);
and the optimized `_site` Chromium suite. The last full canonical collection
matrix completed on the preceding clean revision: 14 timing budgets passed, 3
failed and 4 were not proven. The focused follow-up for the scheduler change
passed all 19 small-cold reference, gate and measurement jobs, with Auto at
1.051× fixed-eight latency. A full cold/warm small and camera matrix on the
current committed revision remains open, as do phone hardware, external share
destinations, deployment headers, pilot results and final release-owner approval.

## Previous checkpoint: mobile batch staging

The latest local change adds browser-stored story outputs for download/share,
quota planning across pending batches, atomic output/counter commits, storage-
pressure pause, bounded groups, and prepared-file lifetime independent of stored
Blobs. Focused source workflows pass in Chromium (1/4/8 workers) and regular-
profile WebKit (1/4/7, its reported CPU budget). Each verifies 48 outputs against
serial rendering, plus reload without the source library, quota rollback,
competing reservations, corrupt-output rejection, cross-tab memory admission,
actual download events, gesture-bound share stubs, Back and 200% text.

The tested WebKit private profile rejects native Blob persistence. The app now
reports an actionable storage error and leaves no partial story. This is an
explicit unsupported-window boundary, not successful private-window storage.
The deterministic suite passes 190 tests (39 scheduler, 151 model/diagnostic).
The new maintained gate is `npm run verify:staged-browser`.

**Completed for the current tree:** source and optimized-package browser
regressions, package/security/recovery checks, and current adapter parity and
coverage. The maintained WebKit staged-export check passes locally; CI
integration, physical phones, real share targets, and native memory/throughput
qualification remain open. Earlier sealed records certify their archived
revisions, not these new files.

The complete objective is not achieved. See the
[remaining-work summary](REMAINING_WORK.md) for the finite release work still
open.

| Workstream | Implementation | Evidence still required |
| --- | --- | --- |
| Published engine (§4, phase 1) | Exact package and unchanged paired staging; explicit fixed JPEG/PNG encoding; alpha flattening; compact palette preservation; truthful controls | 33/33 exact small-fixture comparisons and source/packaged Chromium pass; signed provenance verified. Representative performance qualification remains pending. |
| Product validation (§2, phase 0) | Research and workflow proposal recorded | 12–15 comparative sessions; 80% unaided, 30% faster, 70% output preference targets |
| Mobile/theme (§6, phase 2) | Light/Dark/System; compact image/editor sheets; visible story workspace with dominant artwork, filmstrip, contextual tools, browser Back and 200% text regression | Physical phone tasks, virtual keyboard/platform Back/landscape, full accessibility audit; [story evidence](STORY_WORKSPACE_VERIFICATION.md) |
| Project model (§7, phase 3) | Graph/history wired to image and story editors; source/slot replacement, local edits, variant selection and reorder; separate hashed assets, transactional recovery, two-tab conflict UI/copy action and backup | Complete source/history lifetime qualification, model pinning, archive import, eviction and physical storage qualification; [evidence](PROJECT_MODEL_VERIFICATION.md) |
| Presets (§5A, phase 3) | Initial looks, Saved/Recent/favorites/My styles, selected-field capture, scoped corrections, lazy own-photo previews, immutable revisions, bounded parameter-file sharing, transactional storage and private backup; [style evidence](STYLE_LIBRARY_VERIFICATION.md). [Photo colors](PHOTO_LOOK_EXECUTION_VERIFICATION.md) apply to independent images and folder jobs with strength, own-photo previews, scoped undo and copied recovery. A basic text overlay now applies to interactive batches and frozen large-folder recipes. Legacy recipe/destination definitions preserve originals, freeze revisions and require explicit unsupported-output replacement; [migration evidence](LEGACY_PRESET_MIGRATION.md) | [Authored catalog qualification](STORY_RECIPE_VERIFICATION.md), representative [bundled-font qualification](STORY_FONT_VERIFICATION.md), broader typography/layout/cutout execution across per-image/bulk jobs, grouped stories, variants and full preset release gates |
| Story compositor (§5, phases 3–4) | Visible 6–12-photo to 4–8-slide workflow; adaptive 4:5/9:16 row/stack layouts, consistent borders/type, crop zoom, per-shape manual positions with keep/reset and overlap review; [both-shape exports](STORY_EXPORT_VERIFICATION.md) with complete counts, pause, retained successes, retry-only-failed and attention filtering; [layout evidence](ADAPTIVE_LAYOUT_VERIFICATION.md). [Connected cutouts](CONNECTED_CUTOUT_VERIFICATION.md) share one subject across two slides and preserve joined blocks through reordering | [Authored recipes implemented](STORY_RECIPE_VERIFICATION.md); representative real-photo edge/seam/layout quality review, representative typography review; [pinned licensed fonts](STORY_FONT_VERIFICATION.md) are implemented; internal mask/seam [evidence](SCENE_COMPOSITOR_VERIFICATION.md) |
| Cutouts/depth (§5, phase 4) | [Manual Cutout tool](MASK_EDITING_VERIFICATION.md) adds PNG/luminance/alpha import, soft restore/erase, source-pixel inspection at 100–400%, one-pixel pointer/keyboard repair, bounded history and exact saved recovery. [Manual depth titles](DEPTH_TITLE_VERIFICATION.md) add photo-relative words, original/page backgrounds, source-alpha preservation and title-preserving mask/source changes. [Connected copies](CONNECTED_CUTOUT_VERIFICATION.md) add a spread preview, per-shape placement, independent mask edits and shared depth text. [Cutout finishes](CUTOUT_EFFECTS_VERIFICATION.md) add circular outlines, shadows and scoped parameter-only saved styles | [Depth cover quality qualification](STORY_RECIPE_VERIFICATION.md), [explicit working copies implemented](WORKING_COPY_VERIFICATION.md); reduced decode and maximum-effect memory, automatic model integration and HEIC spike, model license/quality/memory gates and representative edge/seam quality |
| Bulk jobs (§5B) | Utility workflow retained; owner epochs/attempt IDs, strict output intents, duplicate-safe counters, interrupted-write reconciliation and conflict preservation implemented. [Versioned rendering contracts](FOLDER_RENDER_CONTRACT_VERIFICATION.md) bind copied recipes, the declared renderer and job-owned verified font snapshots. [Folder sample/review](FOLDER_SAMPLE_VERIFICATION.md) adds complete-recipe thumbnails, planned counts, measured estimates, preserved-success preview retry, indexed failure filtering and full error details. [First-read source binding](FOLDER_SOURCE_VERIFICATION.md) detects content replacements through inspection, rendering, resume and saving. Text overlay can now be scoped in interactive batches or frozen into a large-folder recipe before choosing its output folder | [Saved-story grouped exports](SCENE_COLLECTION_VERIFICATION.md) now use immutable scene/asset snapshots and per-slide/shape journals. Automatic folder/fixed-size grouping, phone staging, full per-image scene presets, complete immutable source/application identity and broader quality review, physical filesystem/crash qualification and advertised-scale corpora; [recovery evidence](FOLDER_RECOVERY_VERIFICATION.md) |
| Shared concurrency (§8A) | Shared editor/batch/folder/scene admission, reusable lazy workers, deferred copies, header preflight, CPU/memory estimates and heap reporting, priority/aging, cancellation/timeouts, Auto/Max speed/Low resource; browser-held origin reservations now coordinate engine startup, CPU and currently accounted memory across tabs; real multi-worker checks and cross-tab job/write fencing | Full retained surface/cache/storage/model accounting, physical lifecycle and multi-version qualification, stage diagnostics and representative performance qualification; see [evidence](SHARED_SCHEDULER_VERIFICATION.md) |
| Performance qualification (§8A, phase 5) | [Scene materialization](SCENE_MATERIALIZATION_VERIFICATION.md) removes repeated lazy transform work. All four [desktop collection Auto blocks](COLLECTION_BENCHMARKS.md#auto-startup-calibration-matrix-20-september-2026) met the 10% target at the archived Auto-calibration revision; all checked outputs passed. Later folder-contract checks change the target identity | Requalify the current revision; tiny-PNG timing failure, heaviest mask/text/story family, required-device Auto and desktop 2× qualification, sustained physical phone and complete memory evidence |
| Import/color (§8) | [HEIC dependency review](HEIC_IMPORT_RESEARCH.md) and a two-fixture native probe: Playwright WebKit decodes through bitmaps, image elements and workers; Chromium rejects the same inputs. No app decoder integrated | Representative HEIC adapter/fallback qualification, real picker/Files matrix, EXIF 1–8, explicit sRGB/GPS policy, alpha/P3/HDR reference checks |
| Offline/storage/share (§8) | Transactional story recovery and saved-story list; prepared File sharing from a fresh click with ordered individual downloads | Physical share destinations and storage, archive import, versioned PWA/offline packs, checkpointed updates/eviction |
| Security/accessibility (§9) | [Document CSP and packaged HTTP policy](CSP_VERIFICATION.md): source/artifact Chromium and WebKit enforcement with real WASM, concurrent outputs, fonts and downloads; negative controls prove worker headers are necessary. [Dated npm advisory check](research/2026-09-20/dependency-audit/README.md): zero reported vulnerabilities for the locked npm tree | Live deployment header gate fails: HTTP policy is not deployed. Compiled-runtime dependency and full security/license audits, no image telemetry, WCAG 2.2 AA, keyboard, VoiceOver/TalkBack, 200% scaling |
| Physical reliability (§9) | Pending | Baseline iOS/Android matrix, 30-minute stress, 100-cycle cleanup, injected crashes/quota/stalled writes |
| Release operations (§9, phases 5–6) | Pending | Immutable artifact, synthetic health check, rollback drill, named incident owner, truthful license/privacy/feature claims, no P0/P1 |
| Pilot/launch (phases 5–6) | Pending | Consented 20–30-person, two-week pilot; dated evidence and release-owner signoff |

Tests that can run in this workspace will be implemented and executed here. Physical-device observations, consented user-study outcomes, and production ownership must be supplied by their actual participants; automated emulation cannot substitute for them. No production-readiness percentage is claimed.

The 20 September [durable grouped-story exports](SCENE_COLLECTION_VERIFICATION.md)
copy selected saved story revisions and assets into independent job-owned stores.
Complete slide/shape output counts are frozen before saving. Pause/reload and
failed-only retry preserve completed outputs, even after the original library
is cleared. The UI supports batch creation and paged failure review in browsers
with directory saving. Automatic photo-folder grouping and phone staging/share
fallback remain open; viewport tests do not qualify physical phones.
All 185 deterministic checks, full source and 231-file packaged Chromium,
separate recovery and eight source/package CSP profiles pass. The grouped
workflow compares 48 PNG outputs with serial references at observed peaks 1/4/8;
separate source and package probes each verify eight default-JPEG outputs.
Adapter parity is 33/33, and its declared coverage slice remains 27/35 against
the unchanged 70% threshold. The
[retained record](research/2026-09-20/scene-collections/README.md) binds 129
processing inputs and 253 source/test/build files. It does not qualify current
throughput or production readiness; release aggregation remains unproven.

The 20 September [folder source binding](FOLDER_SOURCE_VERIFICATION.md) records
SHA-256 at first admitted inspection/render, consumes explicit repair permission
once, and keeps journaled sources immutable. Saved manifest paths and directory
handles override stale queued copies. Same-size/time replacements, race/reload,
claim/owner/save fences and preview checks are covered; 27 concurrent outputs
match serial references at observed peaks 1/4/8. These checks do not freeze the
contents of untouched sources during discovery or qualify physical filesystem
behavior and throughput. The full immutable source/application gate remains open.
All 181 deterministic checks, full source/223-file packaged Chromium, separate
folder recovery and eight CSP profiles pass. Adapter parity is 33/33; its declared
coverage slice remains 27/35 against the unchanged 70% threshold. The
[retained record](research/2026-09-20/folder-sources/README.md) binds 125 processing
inputs and 247 source/test/build files. Release aggregation remains unproven.

The 20 September [folder sample/review workflow](FOLDER_SAMPLE_VERIFICATION.md)
adds bounded metadata sampling and actual full-recipe preview rendering before
folder output. Failed previews preserve successful thumbnails; actual job
failures have an indexed filter and readable keyboard/touch details. Crop rules
prompt manual review. The time estimate is explicitly based on observed work,
and the running estimate includes actual save time. These additions do not
complete scene-style/grouped-folder execution or physical capacity gates.

The earlier 20 September [CSP implementation](CSP_VERIFICATION.md) adds a restrictive
document policy and generated static-host response headers. Both source and
packaged profiles pass enforcement probes in Chromium and Playwright WebKit,
including real concurrent WASM processing and local font/download workflows.
Normal URL workers require their own response headers; a reachable localhost
negative control proves the gap in meta-only delivery. The public deployment
still fails the new GET-based header gate. No deployment change or complete
security qualification is claimed.

The earlier 20 September [multiple-shape export workflow](STORY_EXPORT_VERIFICATION.md)
adds complete output counts, ordered portrait/tall sets, preserved successful
files, pause/continue, retry-only-failed and attention filtering. Saved Output
styles now retain the chosen shapes; older output styles retain their one-shape
meaning. Eight new checks bring the deterministic total to 175. Reduced-size
paired exports match serial at observed worker peaks 1/4/8, and eight full-size
phone-workflow outputs pass exact-hash/native-decoder checks. Closing cancels
preparation, while a pending native Share keeps its own byte reservation until
the promise settles. Full source and 214-file packaged Chromium, recovery,
33/33 parity and the declared 27/35 coverage slice pass. The
[retained record](research/2026-09-20/story-exports/README.md) binds 121 target
inputs and 234 archived files. Prepared files/queue progress are not durable
across sheet closure or reload; grouped collection execution, full independent
image/folder composition, throughput and remaining production gates stay open.

The 20 September [folder rendering contracts](FOLDER_RENDER_CONTRACT_VERIFICATION.md)
freeze copied recipes, declared engine identity and private font snapshots in
version-2 jobs. Exclusive initial capture prevents duplicate library reads;
subsequent rendering and output writes remain concurrent. Stale workers use
committed snapshots, unbound font metadata cannot change matching, and stored
destinations override stale messages. Older job records and exports are preserved
without silently resuming against an unknown renderer. All 167 deterministic
checks, full source/210-file packaged Chromium and folder recovery pass; 49
focused outputs match the serial reference at observed peaks 1/4/8 after library
removal and reload. Adapter parity is 33/33 and declared coverage is 27/35.
The [retained record](research/2026-09-20/folder-contracts/README.md) binds 119
target inputs and 230 archived files. These checks change the target identity;
the previous canonical timing matrix remains historical, and current performance
and all remaining production gates stay open.

The 20 September [Auto startup calibration](research/2026-09-20/auto-calibration/README.md)
lets a bounded initial cohort follow useful arrivals and tests fewer workers
when an unmeasured initial guess adds no qualifying gain. Eight-sample comparisons,
resource admission and output validation are unchanged. All 162 deterministic
checks, source/package Chromium, recovery, 33/33 parity and the declared 27/35
adapter coverage slice passed. Canonical run `benchmark-6a30d31a-8f7b-40c1-8cd8-0c3d63aed3d7` checked 100 measured
jobs / 3,600 images and 174 total jobs / 6,264 outputs; all passed, including
final identity and raw-statistic checks. All four Auto blocks meet the 1.10 timing comparison against every eligible fixed setting. Its full budget ledger is
**16 pass, 1 fail, 4 not proven**; see the [exact remaining failures and device boundaries](COLLECTION_BENCHMARKS.md#auto-startup-calibration-matrix-20-september-2026).
The receipt binds 117 target inputs, 226 archived files and 206 packaged files.
Production and physical-device gates remain open.

The separate [tiny-PNG diagnosis](research/2026-09-20/png-hotspot/README.md), run
after the canonical matrix, isolates much of the small-input difference to full
output decoding in the current adapter. A PNG with invalid deflate data and a
valid chunk CRC passes the legacy-style dimension check but fails full decoding.
Validation and the timing budget remain unchanged; the performance failure is
still open. These bounded probes do not replace canonical qualification.

The earlier 20 September [existing-story source conversion](WORKING_COPY_VERIFICATION.md#existing-edited-photos-reversible-resolution)
adds an atomic photo-and-mask resolution choice in Photos. Crops, corrections,
frames, variant positions, connected subjects and depth text remain in place.
Untouched cutouts restore their exact original asset; painted reduced masks are
resized with an explicit detail warning. Hash-bound copies are reused, originals
are retained, and Apply/Cancel/undo/reload preserve the relationship. Seven new
model checks bring the deterministic total to 152 (28 scheduler, 124
model/diagnostic). The real-engine synthetic image/soft-mask workflow matches
direct Pillow Lanczos references at observed peaks 1, 4 and 8 with no admission
violations. It also covers edited-mask restoration, orientation policy, failed
conversion/retry and cancellation while selecting a different photo. The 200%
text review repaired the sheet's wrapped Cancel label. The
[retained record](research/2026-09-20/source-resolution/README.md) binds 117 target
inputs, 225 source/test/build files and 206 assembled files. Full source and
packaged Chromium suites and separate folder recovery pass. Adapter parity is
33/33; declared adapter coverage is 27/35 against the unchanged 70% threshold.
The dirty release aggregate and previous different-target benchmark remain
unproven. Full original decoding remains
required; this does not establish physical memory, representative crop/edge
quality, original-quality automatic export or throughput. The complete migration
and release gates remain open.

The preceding 20 September [working-copy implementation](WORKING_COPY_VERIFICATION.md)
adds an explicit 2,048px editing-source choice while retaining original assets.
Full-source decode and output/Blob/hash overlap remain in admission; source
switching and undo preserve the original relationship. Five model tests bring
the deterministic total to 145 (28 scheduler, 117 model/diagnostic). Focused
Chromium evidence covers a retained 12MP camera original, independent EXIF 1–8
coordinate references, alpha, observed 1/4/8-worker identity and saved phone UI
recovery. Default depth/outline/shadow fits the 512 MiB admission case; maximum
effects remain too large and fail before reads. Full source and 204-file
packaged Chromium suites and separate folder recovery pass; adapter parity is
33/33 and its declared coverage slice is 27/34. The
[retained record](research/2026-09-20/working-copies/README.md) binds 116 target
inputs, 222 source/test/build files and 204 assembled files to that milestone's
revision. The dirty release aggregate and stale throughput identity remain
unproven. This does not provide reduced decoding,
automatic original-quality export or physical-device memory qualification.

The earlier 20 September [bundled typography implementation](STORY_FONT_VERIFICATION.md)
adds four pinned OFL fonts to recipe revision two. Their original binaries,
licenses, source revision and hashes are retained. Shared styles carry verified
references; saved stories retain the bytes. Revision-one recipes are exactly
unchanged and remain the explicit device-font alternative. Failed/cancelled
loads preserve the current story, and unsupported characters offer a reversible
device-font fallback. Seven added model tests bring the deterministic total to
140 (28 scheduler, 112 model/diagnostic), including independent complete cmap
comparison. Full source and 202-file packaged Chromium suites and separate
folder recovery pass. Adapter parity is 33/33; the declared coverage slice is
27/34 against its 70% threshold. The [retained record](research/2026-09-20/story-fonts/README.md)
binds 115 target inputs, 219 source/test/build files and 202 packaged files to
this revision. Eight slide jobs match live serial at observed peaks 1, 4 and 8,
with no admission violations. This is correctness evidence; the dirty release
aggregate and different-target benchmark remain unproven. Physical typography, shaping, representative
quality, font/cache memory and the complete offline policy remain open.

The earlier 20 September [authored recipe implementation](STORY_RECIPE_VERIFICATION.md)
adds distinct Scrapbook, Depth cover and Film diary compositions, including
cover/body/closing typography, photo-attached decorations and a filled depth
cover. New stories begin with Scrapbook; saved stories and the earlier color-only
presets retain their definitions. Nine model regressions brought that milestone's
deterministic total to 133 (28 scheduler, 105 model/diagnostic). Eighteen real-photo
previews cover the three recipes, three slide roles and both output shapes.
Eight slide jobs produce identical live-serial output at observed concurrency
1, 4 and 8 with no admission violations. These are correctness checks, not a
new throughput qualification. At that milestone, production fonts, representative photographic and
typographic review, grouped/bulk composition, automatic subjects and physical
devices remain open. The previous benchmark has a different target identity.
Its full source and 181-file packaged Chromium suites passed; adapter parity
was 33/33 and coverage was 27/34 against the declared 70% threshold. The
[verification record](research/2026-09-20/story-designs/README.md) retains the
exact source/test/build files, tested site, raw checks and bounded visual review.
The release aggregate remains unproven for dirty source and stale benchmark
identity. No new throughput or physical-device qualification is claimed.

The earlier 20 September [depth-style addition](STYLE_LIBRARY_VERIFICATION.md#depth-style-addition-20-september-2026)
extends parameter-only saved styles to photo-relative depth typography, placement
and background choice. It preserves target words, masks and crops, supports
explicit keep/reset positions, and shares one title across connected subjects.
The sheet reports eligible/skipped photos and blocks scopes without a subject.
That milestone implemented story-wide saved style application; large-folder
depth composition remains open, and the authored catalog is advanced above.
Its five new model regressions brought the deterministic total to 124 (28
scheduler, 96 model/diagnostic). Adapter parity passes 33/33 and coverage remains
27/34 functions against the declared 70% gate. The aggregate still marks these
dirty-worktree results unproven for release. The earlier benchmark now also has
a different target identity after the style changes; its archived observations
remain intact and are not a new throughput qualification for this source.

The [collection workstream](COLLECTION_BENCHMARKS.md) adds real camera-sized
stimuli, complete output comparisons, strict raw-sample validation, and unchanged
source/input identity checks during measurements. The initial development matrix
exposed Auto staying at one worker when inspection and different image sizes
interleaved. Two regression tests reproduce that issue; the repaired scheduler
and opt-in render observations passed 106 deterministic checks. The subsequent
idle-gap correction added six maintained scheduler regressions, bringing that
total to 112. The subsequent [bounded startup](research/2026-09-17/collections/bounded-startup/README.md)
adds seven more, for 28 scheduler and 91 model/diagnostic checks (119 total).
Full source/packaged Chromium and recovery suites pass. Its completed canonical
run has 15 passing, 2 failing and 4 unproven timing budgets. Performance
claims still depend on the recorded canonical matrix and the remaining release
gates, not those unit tests or the retained development timings.

Its first complete canonical run, `benchmark-506853d1-a470-45e8-b41e-6d7abbc77482`,
passes output checks for 100 measured jobs / 3,600 images, with 6,264 checked
outputs including gates/warmups. Declared budgets are 10 pass, 7 fail and 4
unproven. Small-image fixed-eight throughput improved 5.90–6.26× over serial on
this desktop; camera jobs reached 1.97×. Warm camera Auto is within 0.6% of the
fastest tested fixed median, while the other Auto cases fail the 10% target.
A post-run red probe reproduced idle time causing false Auto backoff. The current
scheduler clears partial windows when work drains. The original probe passed
against that archived correction; the maintained suite tests the current policy.
Completed rerun `benchmark-e00ad0b2-5afe-4761-9318-91eed9a956db` passes
all 100 measured jobs / 3,600 outputs and final source/raw-evidence validation.
Warm Auto now observes 3.56 s versus the fastest fixed median of 3.91 s for small
images and 9.82 s versus 9.69 s for camera photos; both meet the 10% timing
target. Cold Auto remains outside it. The ledger is 11 pass, 6 fail and 4
unproven budgets, including the retained tiny PNG failure. The [startup analysis](research/2026-09-17/collections/idle-gap-fix/calibration-findings.md)
identifies the initial serial calibration as a separate performance problem.
Further qualification remains open. The measured source and all failures are
retained, and dirty-worktree status keeps release evidence unproven.

The 20 September bounded-startup run,
`benchmark-1b0bd5c5-2370-4252-bbc3-c4d53ed2e0eb`, again passes all 100 measured
jobs / 3,600 images (174 jobs / 6,264 outputs including gates/warmups) and final
identity/raw-data checks. Auto medians are 7.18 s small/cold, 3.46 s small/warm,
11.41 s camera/cold and 10.10 s camera/warm. Both camera blocks and warm small
images meet the fixed-setting timing comparisons. Cold small Auto and tiny PNG
remain failing; fixed 16 is unproven on this 11-token host. Its
[archived report and receipt](COLLECTION_BENCHMARKS.md) preserve the source and
tested site. This advances throughput qualification without closing the heavy
recipe, full memory/UI, physical-device or broader release gates.

The [scene materialization milestone](SCENE_MATERIALIZATION_VERIFICATION.md)
now passes full source and packaged Chromium suites, folder-recovery fault
checks, the existing 103 deterministic tests and 33/33 adapter comparisons in
run `parity-88c7f519-c6d4-4eeb-819a-36bb0934b036`. Explicitly loading reused
source/viewport pipelines removes repeated transform work. Twelve baseline
comparisons and four depth-source comparisons preserve encoded PNG bytes on
synthetic 3 MP/12 MP inputs. Instrumented times improve; Wasm-memory results
remain mixed and visible. The production code matches the measured candidate.
The 179-file artifact retains the published runtime unchanged. Admission
coefficients, the camera-source limit and all representative throughput/device
gates remain unchanged; these diagnostics do not satisfy the desktop 2× gate.

The cutout-finish milestone passes both complete source and packaged Chromium
suites after correcting a stale-panel failure during connected-copy removal.
The deterministic total is now 13 scheduler plus 90 model/style/recovery tests;
adapter comparisons remain 33/33 in run
`parity-f7798da3-1008-4c9e-9f4d-8cfac8392cc1`. All six new decorated spread cases
match their continuous references exactly. Saved finish reuse, grouped history,
mask removal/restoration, phone-emulated controls, recovery and actual export
pass. The 179-file packaged artifact retains the unchanged published WASM.
[Detailed evidence and retained logs](CUTOUT_EFFECTS_VERIFICATION.md) include
the earlier failure and successful reruns, rather than replacing that history.
One real-photo example visibly retains research-mask defects; it does not
qualify automatic selection or a representative quality corpus.

A calculated capacity check exposes further phone work: a 12 MP camera source
with a default cutout finish on a tall slide reserves about 549 MiB, or 683 MiB
with depth, exceeding the 512 MiB fallback budget before other retained assets.
Bounded working copies/decode need qualification. Multi-worker identity and
admission checks are not large-collection throughput measurements; the existing
failed latency budget and complete performance/physical-device gates remain open.

The [automatic-selection model spike](SEGMENTATION_RESEARCH.md) now has pinned,
independently reproducible SDK/model/photo inputs and a ten-case browser run.
Nine cases produced masks; forced no-WebGL failed. Portrait CPU observed 18.2 MiB
of Wasm memory versus 440.8 MiB for interactive v2 CPU; these exclude other
retained memory and do not qualify phones. Real output review found visible
selection defects. Both worker-header and static-document/blob-worker CSP
blocked SDK telemetry while producing identical masks. No model was integrated
into the app. Exact v2 weight licensing, representative quality, shared model
admission, production network policy and physical-device gates remain open.

The connected-cutout milestone now passes the full source and packaged Chromium
suites. Six additional model checks bring the deterministic total to 13 scheduler
and 84 model/style/recovery tests; legacy comparisons remain 33/33 in run
`parity-c665aef5-8f5b-4c6e-94ba-cb975f9e1598`. Joined slides/chain blocks reorder
without changing the cutout's rendered bytes. Both output shapes compare with
independently decoded wide references under the unchanged two-level allowance;
existing seam and odd-width fixtures measure zero. Phone creation, placement,
crop, Back, undo, recovery, pair changes, independent mask removal and saved
export comparisons pass. [Detailed evidence](CONNECTED_CUTOUT_VERIFICATION.md)
records the two raster-grid failures found and corrected. This does not qualify
representative photographic quality, sustained speed or the remaining release gates.

## Engine evidence and open technical work

- `npm run verify`: passed against the published runtime, with real JPEG output,
  alpha cases and fixed-setting behavior. The previous fake JPEG encoder test
  was replaced by real bytes. Existing transform, import and recovery checks remain.
- `npm run verify:browser`: source Chromium suite passed; independent browser
  decoding checks PNG transparency and JPEG flattening. Synthetic unavailable
  format cases now use AVIF, while real JPEG edits succeed.
- The packaged engine artifact also passed the full Chromium suite. Subsequent
  theme changes passed source Chromium checks (System changes, persistence and
  seven text-color contrast pairs in each theme). The subsequent phone shell
  passed source and exact packaged Chromium checks: modal focus and Escape, edit preservation,
  desktop restoration, reachable presets/batch controls, 200% text, and a
  dominant canvas with the tool dock on screen at 375×667. Screenshots were
  visually inspected. See [phone shell evidence](MOBILE_SHELL_VERIFICATION.md).
- `npm run migration:parity`: run
  `parity-654c1969-378b-493a-a207-ec42d0611f7b`, 33/33 comparisons passing across
  both inventoried PNG app endpoints. The old generated pair and dependency
  closure remain intact, with hashes. This is a slice of the plan.
- `npm run migration:coverage`: snapshot
  `coverage-762a7454-4d0d-4e75-9bc0-2b3b8c9150b5`, 27/33 V8 functions in the
  complete engine adapter directory executed. This is function coverage, not
  branch coverage or proof of product completeness.
- The first exact comparison exposed palette padding (97-byte legacy PNG
  became 853 bytes). Python Pillow 11.3.0 independently confirmed equal decoded
  RGBA pixels. The app now preserves the actual palette length and CRC; the
  published runtime remains unmodified. Exact comparisons pass without relaxed
  thresholds or case-specific handling.
- Warm 8×8 microbenchmarks varied between passing and failing the declared
  1.5× baseline limit. These noisy measurements remain in `.migration-results/`.
  Earlier run `benchmark-c014dcf7-5a18-49f5-969c-0fae65ffd82f` measured a
  1.928× median latency ratio and **failed** that budget. Do not replace this
  result with a selected best run.
  The newer collection run above also retains a failing 2.096× tiny-fixture
  ratio. The larger browser matrices provide separate engineering observations;
  they do not erase that failure or complete sustained device qualification.
- The text compositor now rasterizes in an admitted worker and uses Pillow for
  alpha composition and final PNG/JPEG encoding, including folder jobs. Real
  custom-font and 1/4/8-worker checks verify identical encoded output, explicit
  font failures and active-font retention after saved-data cleanup. Previous
  renderer recovery records are archived on migration. See
  [text compositor evidence](TEXT_COMPOSITOR_VERIFICATION.md). The subsequent
  scene API adds photo/text/shape layers, imported masks and a text-behind-subject
  composition. Connected-slide edges pass the unchanged two-level tolerance;
  the fixture measures zero at its seam. Preview exactly matches a final Pillow
  downsample of full export. Twelve scene outputs at each of 1/4/8 workers match.
  Story recovery preserves rendered bytes after reload and rejects simultaneous
  stale-tab saves, with quota rollback and shared-asset lifetime checks. See
  [scene and storage evidence](SCENE_COMPOSITOR_VERIFICATION.md). The subsequent
  [visible story workspace](STORY_WORKSPACE_VERIFICATION.md) assembles 6–12 photos
  into 4–8 slides, edits captions/framing/looks, preserves output variants across
  reload, exposes save-conflict copies and prepares ordered exports. Its phone
  workflow, browser Back and 200% text regression pass. Physical share targets,
  authored catalog quality qualification and representative font/typography
  review remain open.
- All work is uncommitted. Generated aggregate status deliberately reports
  dirty-target and stale evidence as unproven. It must be rerun for the eventual
  release revision; none of these records authorizes a production-ready claim.
- Folder recovery now passes real-browser ownership, duplicate-counter, file
  conflict and terminated-worker checks. Source and packaged UI suites exercise
  competing tabs and a simulated IndexedDB quota failure with a usable retry
  path. These do not substitute for native-folder, process-crash or power-loss
  qualification. See [folder recovery evidence](FOLDER_RECOVERY_VERIFICATION.md).

The legacy catalog now uses atomic entry/definition transactions, captured edit
tokens, bounded retry receipts and generation fences after clearing. Its two-tab
UI tests retain conflicting drafts and offer a new copy; malformed/future
catalogs remain read-only and available in private backups. This is storage
correctness evidence, not throughput qualification.

Next implementation work: qualify the authored recipe/layout catalog and extend
the new [story styles](STYLE_LIBRARY_VERIFICATION.md) through per-image/bulk
execution. Their [photo-color components](PHOTO_LOOK_EXECUTION_VERIFICATION.md)
now have own-photo previews, strength, scoped application/undo, recovery and
transactional folder selection. Selected saved stories now support durable
grouped slide/shape exports. Fresh-folder grouping, full per-image scene-style
execution, phone staging/sharing and complete representative-sample preflight
remain required.
Independent image scopes now retain different revisions of the same recipe ID,
and the folder selector names its frozen job definition after a library edit or
removal. Versioned recovery references preserve the selected definitions and
reject missing revisions; [selection evidence](RECIPE_SELECTION_VERIFICATION.md)
includes actual output comparisons and an archived schema upgrade. The
[historical recovery follow-on](HISTORICAL_RECOVERY_VERIFICATION.md) retains
complete saved image operations independently of current recipes and requires
explicit choices when the oldest snapshots never saved a custom base. It keeps
unavailable output intent and the original backups. Automatic source grouping,
durable phone outputs and representative scale tests remain separate requirements.
[Legacy recipe migration](LEGACY_PRESET_MIGRATION.md) retains original records
through verified reopening and freezes copied definitions. Real-photo
layout review, licensed fonts and the complete cutout/depth workflow remain in scope.
The [manual depth-title workflow](DEPTH_TITLE_VERIFICATION.md) now includes phone
controls, direct Cutout handoff, original-alpha preservation, one source decode,
both background choices, title-preserving source changes, exact recovery and
ordered output checks. Worker settings 1/2/4/8 produce identical bytes; the
linked-scene fixture has zero seam difference. This is correctness evidence,
not real-photo quality, automatic segmentation or throughput qualification.
The full source and packaged Chromium suites pass, as do 13 scheduler tests,
78 model/style/recovery tests and 33/33 legacy comparisons in run
`parity-27b3eb4e-7976-4731-b130-81b38537e333`. Folder
ownership and write reconciliation now have [browser evidence](FOLDER_RECOVERY_VERIFICATION.md);
physical filesystem and crash qualification remain open. The application
license and exact physical test devices were requested from the owner; neither
has been assumed or treated as approved. Project graph, authored recipes,
cutouts, offline recovery, scale evidence and the full launch gates above remain
in scope.
