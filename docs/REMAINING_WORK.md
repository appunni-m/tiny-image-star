# Remaining migration work

Checkpoint: 26 September 2026. The current source and optimized Pages artifact
pass the automated browser, security and recovery gates. Auto bulk scheduling
now uses a resource-gated eight-worker start and grows beyond eight only when a
full same-class wave is still queued. A focused small-image comparison meets
the 1.10 Auto budget. Its canonical cold/warm small and camera matrix is now
complete: all 16 eligible Auto concurrency comparisons passed. The separate
PNG engine timing budget failed at 1.807× against 1.50×, and four fixed-16
comparisons were unavailable under the host's 11-token CPU budget. The full
[migration plan](../MIGRATION_PLAN.md) remains incomplete; automated checks do
not establish production readiness.
The original plan estimated 12–16 weeks with two experienced engineers, design
and physical-device QA for the complete delivery; that is not an estimate of
time remaining now.

## Verification and qualification still open

The full canonical matrix on clean revision `bfa9439` completed with 16 passing,
1 failing and 4 unproven budgets. Auto passed every eligible comparison across
cold/warm small and camera workloads; fixed-16 was unavailable under the real
11-token CPU budget. The PNG engine microbenchmark measured 1.807× against its
1.50× limit. The earlier pre-tuning failures and focused follow-up are retained
in the [dated record](research/2026-09-26/auto-concurrency/README.md). Integrate
the maintained WebKit staged-export gate in CI and retain versioned release
evidence. Real phones and share destinations are separate release gates. The
tested WebKit private window cannot persist Blobs; the app explains the failure
and preserves prior data.

## Engineering still open

- [Automatic editable-story grouping](GROUPED_STORY_IMPORT.md) is implemented in
  source: folder/fixed groups, explicit leftover policies, rename/exclude,
  curated presets, sequential atomic saves, pause/continue and selected export
  handoff. Editable stories still use the shared 128 MiB library budget. A new
  direct-to-batch route stores frozen import plans and photo/font snapshots
  outside that budget, supports source reselection after reload, and shares
  quota reservations with other batches. Browser quota and per-group processing
  limits still apply. Both grouping paths pass current source/package browser
  workflows; physical picker, storage and stress qualification remains open.
  Editing a copied batch group in place is not implemented.
- Continue typography/layout/cutout presets and size variants for independent
  images and bulk jobs. A bounded first slice now adds a mobile short-caption or
  signature overlay to interactive batches (All/Selected/This image) and to a
  frozen large-folder recipe, with four built-in typography starter styles.
  Saved full recipes can now include the overlay. Standalone overlay-only
  presets, layered layouts, and test/device qualification remain open; this does
  not complete the shared compositor.
- Automatic subject selection: integrate a licensed model only after quality,
  privacy and memory gates pass. Manual cutouts/depth/connected effects exist.
- Camera imports and color: HEIC adapter/fallback, real picker compatibility,
  complete EXIF, sRGB/P3/HDR/alpha and metadata/privacy policy qualification.
- Offline and recovery: versioned PWA updates, offline packs, archive import,
  eviction/update handling, complete source/application identity and lifetime.
- Performance and capacity: resolve the tiny-PNG timing failure, qualify heavy
  effects and complete retained/native memory, then run sustained real
  collections at 100, 1,000 and 10,000 before advertising them.

## Release work that needs people, devices or deployment access

- Real iPhone and Android testing: photo pickers, keyboards, permissions, native
  share/save targets, accessibility, thermal/background behavior, 30-minute
  stress and 100-cycle cleanup/crash/storage tests.
- Representative real-photo, typography, crop, cutout-edge and seam review;
  12–15 observed creator comparisons against existing tools.
- Deploy and verify HTTP security headers (the public deployment gate currently
  fails); complete compiled-runtime security/license review, select the app
  license, establish immutable releases, monitoring, rollback and incident owner.
- Run the planned consented 20–30-person, two-week pilot, fix launch blockers,
  and obtain release-owner signoff with no open P0/P1 defects.

## A finite stopping point

Current work is limited to implementation slices with explicit completion
notes; test campaigns and production qualification remain deferred. The full plan cannot honestly
be marked 100% complete on automated browser tests alone. No completion date or
production-readiness percentage has been established for the remaining work.
