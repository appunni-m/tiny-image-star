# Tiny Image Star verification contract

The immediate regression command is:

```bash
npm run verify
```

It is dependency-light, returns nonzero on failure, and exercises the copied
fixture through the actual Pillow-RS adapter path. It checks transformed PNG
bytes, decoded dimensions, exact crop/rotate/flip pixel rows, all eight EXIF
orientations, indexed PNG, corrupt/truncated rejection, output-size rejection,
unsupported-format rejection, a capability-gated JPEG signature and quality
path, preset data, fresh editor state, module composition,
readiness/progress separation, worker revision/cancellation wiring, batch
selection wiring, input safety/duplicate handling, exact batch byte-limit
boundaries, pixel-aware worker scheduling, and the 100,000-entry metadata-only
folder-job contract.

The local save watcher reruns that same fast command after a 250 ms debounce:

```bash
npm run verify:watch
```

This is an opt-in local command, not a scheduled job or hook. It watches the
current source and test files with low-overhead polling. GitHub Actions runs
the complete `npm run verify:all` gate for pull requests and before Pages
deployment from `main`.

The slower browser interaction layer is separate from the save watcher:

```bash
npm run verify:browser
```

It drives the static app with the Playwright development dependency declared
in `package.json` and returns `2` with an install message if dependencies are
not installed. It checks actual page state, worker-backed previews,
interaction transitions, and console errors; it is intentionally not part of
the save watcher.

For a complete local/CI gate after `npm ci`, run:

```bash
npm run verify:all
```

This combines the real-byte contract and browser smoke. It is expected to
fail rather than silently skip the browser half when Playwright is absent.

## Feature matrix

`A` is covered by `npm run verify`; `B` is covered by the separate headless
browser smoke; `M` is the equivalent in-app browser check when a headless
browser cannot be launched.

The gate validates behavior and real output bytes. The project does not
currently produce a line/branch coverage artifact, so a passing run is not a
line-coverage percentage claim.

| User-visible feature | Check | Evidence / boundary |
| --- | --- | --- |
| Fresh Ready state | A + B/M | Worker reaches the internal `Ready` state; the healthy badge stays hidden in the empty UI and processing text is separate. |
| Calm empty editor and contextual workspace navigation | B/M | Browser verifies empty state hides disabled tool panels, hides stale activity/comparison controls, offers both Choose images and Choose a folder, routes one-file and multi-file imports through the same canvas/tray workspace, labels the active-set action `Results (N)`, and returns through `Back to editor`. It also proves the old competing Canvas and Return-to-set controls are absent. |
| File import | A + B/M | Deterministic PNG, JPEG, BMP, WebP, GIF, TIFF, ICO, indexed PNG, and all eight EXIF-JPEG orientations are decoded and re-encoded through the real adapter; the PNG fixture also carries varied alpha. Corrupt/truncated inputs are rejected. Browser imports PNG, TIFF, ICO, normal JPEG, and EXIF-oriented JPEG, visibly rejects an unsupported AVIF input without replacing the current image, exercises chooser, drag/drop, and multi-image clipboard import, protects text-field paste, and compares generated output bytes with the rendered canvas. Color-profile behavior remains a fixture boundary. |
| Input safety and mixed sets | A + B/M | Fast checks detect animated GIF/WebP, enforce decoded-pixel limits, stable fingerprints, and duplicate identity; browser imports a mixed PNG/animated-GIF set and keeps the valid preview while showing an actionable error for the animated item. |
| Pan, zoom, fit-to-screen | B/M | Zoom and Fit screen controls are automated; browser smoke performs a real Space-drag pan and asserts the canvas pixels move, dispatches a two-pointer pinch and double-tap fit-to-screen, and covers keyboard +/−/F navigation plus keyboard crop movement. A real-device touch/accessibility matrix remains a follow-on boundary. |
| Stale-download prevention and generated preview | B/M | Browser delays the worker, changes the size, asserts Download is disabled while the old result is invalidated, then decodes the actual generated PNG blob and compares every rendered canvas channel for 4×4 fit, direct 8×6 crop, advanced 4×4 crop, and a compound rotate/flip/adjust result before comparing Original and Edited snapshots. Broader input/color-profile parity remains a fixture-roadmap item. |
| Space-drag pan and visible keyboard shortcuts | B/M | Source wiring and live editor controls expose Space pan, +/−, F, C, Enter, Escape, undo, and Download shortcuts; browser smoke performs the Space-drag and covers the keyboard alternatives. |
| Crop presets and handles | A + B/M | Real crop dimensions and varied-alpha crop pixels are asserted; browser selects and shape-checks Original, Square, 4:3, 3:4, 16:9, and 9:16, applies a real 16:9 preset and compares its generated bytes with the canvas, performs a real pointer drag on a crop handle, uses Enter to apply plus arrow-key nudging with Escape cancel, then applies a manual crop. |
| Mixed-shape crop framing review | A + B/M | The framing helper detects source-shape differences when a shared crop destination can remove content; fast checks identify the flagged item, while browser smoke applies Square to square and portrait sources, shows a plain-language Review framing notice, marks the tray/card, verifies the flagged card, removes it, and confirms the notice clears. Keep whole image does not raise the warning. |
| Fit resize and exact Crop resize | A + B | Real 4×4 fit and exact crop output dimensions; browser deliberately opens Size, verifies locked and unlocked width/height behavior, changes Advanced sizing and both modes, then verifies the generated preview. |
| Rotate and flip | A + B | Real rotated dimensions and changed flip bytes; browser invokes the controls. |
| Brightness, contrast, grayscale | A + B | Real adjusted PNG bytes differ; browser drives the controls, checks signed percentage labels (`+25%`, `+20%`), and resets brightness to `0`. |
| Undo, redo, Reset, dirty state | B/M | Browser transition sequence asserts dirty visibility and history behavior. |
| Destination presets and scope | A + B/M | Preset names/dimensions are data-tested; browser selects outcome-named quick choices, opens More destinations, uses Website Banner in the tray, and exercises explicit All/Selected/This scope with per-item destination markers. The no-resize utility is named `Edit without resizing` and is not a primary destination. |
| Custom save/edit/duplicate/delete | B/M | Browser saves a named canvas recipe with final format and capability-gated lossy choice, verifies the stored recipe, applies that complete recipe into the active tray, exercises the currently unavailable JPEG path as an honest failed output rather than claiming success, restores the original shared destination, duplicates it, and deletes both local copies. |
| Batch limits and cancellation | A + B | Worker revision/cancel protocol, explicit Cancel updates behavior, and the 40-file interactive-preview limit are contract-tested. Before selection, browsers without writable-folder access label the fallback `Choose folder (up to 40)`. Browser smoke rejects 41 files with the memory-safety reason and the supported large-folder route, cancels from Results and the editor tray, then retries the cancelled cards to completion. |
| One-or-more image workflow | A + B/M | The same adapter, recipe, output settings, and save paths serve one image or many. A multi-file import stays in the canvas workspace; the tray applies a destination or current canvas changes to All, Selected, or This image; one result saves directly. Several use one uniquely named folder where writable-folder access exists, or an explicit one-click-per-file queue in other browsers. At 320px and 390px, the tray keeps its Save selected action in-bounds. |
| Unified active-set results drawer | B/M | With an active canvas image, `Results (N)` opens the result-first drawer while the editor remains the underlying workspace; `Back to editor` returns to the same canvas, Presets closes the drawer before opening, and clearing the last result returns automatically. There is no separate batch/single mode switch. |
| Batch preview grid | B/M | Browser waits for completed result-first cards, output dimensions, and verifies the original stays hidden until the press/release comparison action is held. |
| Add more images to an active image set | B/M | Browser appends a second fixture without removing the first, preserves the compact drop area, and keeps completed items selected. |
| Re-import the same file, Remove image, New set, Retry, and Clear completed | A + B/M | Source checks expose bounded recovery paths; browser smoke exercises append/remove, cancellation followed by Retry, Clear completed, and confirmed New set. Clear completed removes only ready previews. |
| Selection and Select all | B/M | Completed results are selected by default; browser clears, reselects, and checks Save enablement. |
| Individual and selected save | A + B | PNG signatures are real-byte tested; browser compares direct and per-image-override save bytes with generated previews. With writable-folder access, several selected outputs are written to one uniquely named browser-managed folder, read back, decoded, and checked to contain no archive. With folder access disabled, browser smoke proves the initial action launches zero downloads, the dialog contains no preview, every explicit click launches exactly one real PNG, filenames stay unique and ordered, and completion says downloads started rather than claiming disk writes. |
| Download sheet | A + B/M | The browser checks the metadata-only sheet for a capability with multiple choices, verifies dimensions/file size/format and no second image preview, then validates direct PNG bytes when the real artifact exposes only one verified format. |
| Single-image Download route | A + B | Fast checks validate generated PNG bytes; browser asserts the top-bar Download path and the absence of a duplicate preview. One and many images use the same selection/configuration model. |
| Keyboard shortcuts and ownership | B/M | Browser exercises unmodified Fit/Crop/zoom, Cmd/Ctrl+Z and redo, text-entry isolation, and Cmd/Ctrl+S. Results owns its save shortcut exclusively and invokes exactly one selected folder save; editor shortcuts yield to Results, Presets, open dialogs, browser Find/Copy, and native text-field undo. |
| Apply current edits and per-item override merge | A + B/M | Fast checks prove relative crop scaling, shared-edit merging, removal of only the applied override keys, and preservation of unrelated per-image corrections. Browser rotates one image, applies that change to all, opens another image to verify the shared rotation, then adds a local flip and confirms later destination/format changes do not silently replace it. |
| Active-set refresh recovery | A + B/M | Fast checks validate the versioned source-byte snapshot schema, shared override, quality, recipe scope, per-item destination, and override metadata. Browser proves one-image and multi-image restoration opens the canvas only after true source dimensions are known, preventing a no-resize recipe from becoming 1×1; generated outputs are rebuilt, not restored as truth. |
| Local data summary and clear | A + B/M | Fast checks cover the shared recipe key and byte formatting; browser creates a local recipe and recovery copy, opens the footer summary, verifies both counts and storage size, clears saved data with confirmation, keeps the open image usable, and refreshes without a stale recovery offer. |
| Hold-to-compare | B/M | Browser dispatches pointer down/up on the editor comparison control and asserts Original is active only while held; image-set cards expose the same press-to-see-original pattern. |
| Private/offline processing | B/M | The compound browser journey records every request and fails if any request has a body or leaves the local test origin; in-memory `blob:` preview URLs are explicitly allowed. Run `fb944f00-936b-481c-9fc7-c4b2e7829426` passed this check. This proves the current app flow does not upload image bytes, not that a future deployment can never add a third-party asset. |
| No console errors | B | Headless smoke collects console/page errors across the compound journey; run `fb944f00-936b-481c-9fc7-c4b2e7829426` passed with no console/page errors. |
| Responsive control layout and stable editor chrome | B/M | Browser smoke measures visible header, Add images/Results actions, recipe/output controls, the five primary tools, and selection controls at 320/375/390/768/1024/1440px widths. It also compares header height and workspace position across clean, dirty, processing, and ready states and requires Download to remain visible-but-disabled while output is stale. Results imports a long filename, opens destination/card menus, exercises a capability-gated multi-format state, checks 200% text size at 390px, and hit-tests then clicks a mobile card menu. It fails on overlap, clipped text, viewport escape, hidden controls leaking into the UI, targets below 44px on phones, or page overflow. |
| Truthful capability-driven formats | A + B/M | File pickers and drag/drop follow the runtime input list; output choices follow runtime encoder support, and unsupported files/formats get actionable messages. Format remains discoverable even when only PNG is verified, while unavailable formats and quality controls are not faked. Emitted bytes must pass signature and decode/dimension checks. |
| Format conversion and lossy compression | A + B/M | The fast suite probes the actual checked-in binding and renders every runtime-verified output format (currently PNG), then separately produces a JPEG-signature result through a fake verified adapter, proves quality reaches that encoder path, and proves a PNG-only `save()` cannot masquerade as JPEG. Browser smoke injects a verified multi-format capability, keeps Format visible, proves Low/Medium/High map to 80/95/100, verifies compression can be toggled without silently changing the chosen format, round-trips a JPEG/compression recipe, and requires unsupported JPEG output to fail honestly and disable Download. |
| Shared output settings across one and many images | A + B/M | Canvas, tray, Results, and saved recipes use the same verified format/lossy/quality state. Fast checks enforce Low=80, Medium=95 (default), High=100; browser verifies each choice and that format/quality values survive preset and per-image merges. |
| Destination preset semantics | A + B/M | Fast data checks cover exact dimensions/mode; browser selects a named destination in the editor, saves it through the visual preset dialog, checks the stored dimensions, and reuses named destinations in both tray and review surfaces. |
| Output and import safety limits | A + B/M | Fast checks reject oversized requested output before allocation, preserve still GIFs containing comma bytes in comments, reject valid multi-frame GIFs, enforce the shared pixel budget, and test exact batch-byte-limit acceptance versus one-byte-over rejection; batch preflights total input bytes before reading candidates. Browser covers the user-facing 40-file bound and actionable oversized/animated outcomes. |
| Parallel image-set processing | A + B/M | Fast checks prove the bounded pool is limited by hardware and decoded-pixel budget; browser smoke observes several results completing without blocking the canvas. Service workers are not used as image-compute workers. |
| 100,000-file bounded-memory contract | A + B/M | Fast checks construct 100,000 manifest records without source/output byte fields, cap active workers at four, and bound visible rows. The page stores only job/entry metadata in IndexedDB; the large worker reads and writes one file at a time and reports metadata only. Browser smoke exercises the same folder UI with real transformed outputs. Peak memory still depends on the largest concurrently decoded images, not just file count. |
| Large-folder discovery, direct output, pause/retry, and recovery | A + B/M | Start stays unavailable until metadata discovery is complete. Browser smoke chooses source/output directories, pauses and resumes pending work, creates a real failed input, proves the failed terminal state shows only `Retry N failed` rather than an ineffective Resume, repairs and retries it, reads direct results back, checks PNG signatures/dimensions, proves no archive exists, bounds result DOM rows, and reloads a saved discovered job. Interrupted processing entries reset to pending; interrupted discovery is cleared and restarted from the durable source handle. Browser permission can still require a person to approve access again after restart. |
| Contextual inspector and mobile controls sheet | B/M | Browser checks Move/Size/Adjust/Format panel switching, the top-bar Download path, the mobile Controls toggle, and the hidden legacy rail trigger; responsive layout checks the fixed primary bar, quick-action row, stage footer, bounded bottom sheet, and narrow batch comparison control. Reduced-motion, forced-colors, and high-contrast media emulation are also checked. Real-device touch/accessibility validation remains the boundary. |
| Accessible canvas state | A + B/M | Source checks require a dynamic canvas label; browser smoke verifies it names the current image, output size, and Keep whole image behavior. Keyboard crop movement, Enter/Escape, focus-visible styling, reduced-motion, forced-colors, and high-contrast emulation are covered. Screen-reader, real touch, RTL, and 200% text-zoom validation remain open. |

## Known automation boundary

The browser download event may be suppressed by a browser sandbox even after
the app has generated the correct single-file bytes and invoked the save
anchor. The fast test validates those bytes directly, while browser smoke also
exercises real download events for the explicit multi-file fallback. Multi-image
direct-folder and large-folder saves are additionally written into browser-managed directories,
then read back and decoded by the browser smoke. A native operating-system
folder picker and permission re-prompt still require real-browser/manual release
QA because headless automation replaces only that picker boundary.
No feature is marked passed solely because a label appeared in the DOM.
