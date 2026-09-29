# Historical image-set recovery

Implemented 17 September 2026 for the recovery and preset requirements in the
[migration plan](../MIGRATION_PLAN.md). This closes the silent live-library
substitution path for older image sets. It does not recreate information that
the oldest app never saved or qualify the complete product for production.

## Three saved-data generations

1. **Copied definitions and exact references:** keep their existing immutable
   selections. Missing or malformed references still fail closed; a current
   library entry cannot repair them implicitly.
2. **Complete image operations without copied definitions:** recover each
   image's saved crop, rotation, flips, resize, adjustments, captions and output
   settings as private, source-specific recovered edits. Current recipe edits,
   renames and deletion do not supply their base settings. Complete image state
   takes precedence over a historical built-in when no copied definition exists.
3. **Original raw snapshots with only IDs and patches:** resolve the nine known
   built-ins from the frozen `89cc88c` definitions. Custom recipe definitions
   cannot be inferred from IDs. The user must explicitly choose **Restore using
   current recipes** or **Restore originals + saved corrections**. The former
   is unavailable when any needed recipe is absent; both explain that the old
   appearance may be unrecoverable. **Open Local data for backup** and **Not now**
   remain available without rewriting the pending snapshot.

The classification is based on the actual baseline session writer: its raw
records contain source bytes, selected recipe IDs, shared settings and local
patches, but no complete custom recipe definitions or resolved image state.
Intermediate project records can supply complete operations from their stored
image nodes. A partial patch is never treated as complete image state. Ambiguous
ID-only revision lists and unknown recovered-setting versions are refused.

The [resolver](../src/styles/session-recovery.js) and
[frozen built-ins](../src/styles/session-presets-v1.js) do not depend on future
changes to the active preset catalog. Metadata resolution keeps the same source
byte buffers and returns independent definition copies.

## Editing recovered work

Recovered settings retain absolute crops for the original source image. They
are labelled **Recovered edits**, have no invented original revision, and cannot
be applied as a shared preset or folder recipe. Users can save the current
adjustment as a reusable recipe through the existing relative-crop flow.

Known manual patches remain separate. Choosing another recipe for one image
retains those corrections and leaves other images unchanged. **Reset to
recovered edits** returns to the saved recovered view, including the original
manual correction; it does not claim to restore a missing historical preset.
Reference validation rejects a recovered definition attached to another source.

The existing version-2 envelope archives the entire earlier project record in
the same transaction. Original raw session records stay in their original
store and in private backups until the user's explicit clear action. This
does not bypass the existing quota, malformed-record or renderer fences.

Saved unsupported output formats and adjustable-compression requests remain
visible errors. Rendering controls and later engine capability announcements
cannot clear them. An unavailable format appears as the selected disabled option;
the user can choose a supported output. A missing quality override remains null.

## Verification

- Ten selection/recovery model tests cover exact references, changed/deleted
  library definitions, explicit choices, historical built-ins, source-buffer
  retention, independent copied definitions, partial operations, source binding,
  ambiguous IDs and future metadata refusal.
- [Browser regression](../tests/historical-recovery.browser.mjs) compares actual
  worker output hashes with direct Pillow renders of saved operations for two
  different source aspect ratios, including an absolute crop, rotation, caption,
  adjustments and a manual flip. It then deletes the current recipe, reloads,
  edits/resets one image and replaces only that image's recipe. These compare
  current-renderer interpretation of saved settings, not unrecorded output bytes
  from every historical engine version.
- Real IndexedDB checks verify a version-1 archive, version-2 recovery, unchanged
  references on a second reload and retention of the original raw record after
  each explicit recovery choice. The earlier selection regression compares the
  complete archived record with its source.
- Phone Chromium at 375 × 667 exercises both recovery choices and the backup
  dialog. At 200% text, the banner has no horizontal overflow and each visible
  action is at least 44 pixels high. The
  [phone capture](research/2026-09-17/historical-recovery-phone.png) was visually
  reviewed. This is emulation evidence, not a physical-device qualification.
- Unsupported AVIF and adjustable JPEG compression are checked before and after
  an actual engine-capability announcement. Explicit PNG replacement must produce
  outputs, while the raw backup retains the earlier output intent.

The old source-text assertion requiring capability updates to discard saved
compression was removed. Browser behavior now verifies the stronger requirement:
only an explicit user replacement changes an unavailable saved request.

Completed run results:

| Check | Result |
| --- | --- |
| `npm run verify` | Pass: paired runtime integrity, app checks, 11 scheduler tests and 58 project/style/recovery model tests |
| `npm run verify:browser` against source | Pass: complete suite, including the recovery regressions above |
| `npm run verify:browser` with `TINY_IMAGE_STAR_BROWSER_ROOT` pointing to `_site` | Pass: the same complete suite against the optimized artifact |
| `node scripts/assemble-pages.mjs` and `npm run check:pages` | Pass: 139 artifact files; JS 631,250 → 381,576 bytes; CSS 67,863 → 59,452 bytes; unchanged 4,548,741-byte published WASM |
| `npm run migration:check` | Pass: specification and anti-cheat checks, 2 endpoints and 33 inventoried cases |
| `npm run check:docs` and `git diff --check` | Pass: 35 Markdown files and clean patch whitespace |

No deployment or commit was made. No new parity, coverage or performance result
is claimed from the specification check. The earlier failed microbenchmark
remains the recorded result; these changes do not qualify throughput.
Performance, physical-device, user-study, pilot and release gates remain in the
[execution ledger](MIGRATION_STATUS.md).
