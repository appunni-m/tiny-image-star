# Smaller editing-copy evidence — 20 September 2026

This implements an explicit reduced-source choice from migration §8, with
originals retained in the project. See [behavior and limits](../../../WORKING_COPY_VERIFICATION.md).
The full migration and production gates remain open.

The source identity is
`89cc88caa09022ec007d2e11d8b22cf1b04fd7d6:39253708e0ad22d06c4034e9df064064fed99f845c0987ba44aa5b2bddd8a84c`.
[target.json](target.json) and [source-files.json](source-files.json) bind 116
inputs. The worktree is dirty; the published paired Pillow runtime is unchanged
from the preceding font milestone.

[verified-source.tar.gz](verified-source.tar.gz) contains the 222 source,
runtime, test and build inputs in [archive-files.json](archive-files.json).
It excludes Git history, installed dependencies and broader documentation.
[tested-site.tar.gz](tested-site.tar.gz) contains all 204 assembled files in
[packaged-files.json](packaged-files.json). Archive members and live files are
rechecked against SHA-256 inventories after browser execution. Nothing is deployed.

## Evidence

Terminal results and artifact hashes are in [verification.json](verification.json).
The source and 204-file packaged Chromium suites, separate folder recovery,
145 deterministic tests and 33 adapter parity comparisons pass. The declared
adapter coverage slice is 27/34 against a 70% threshold, not whole-product
coverage. The initial documentation audit ran before the receipt link existed;
that failure is retained separately from the final successful audit.
The [browser observations](browser-observations.json) record:

- A real 4032×3024 JPEG original, 2,546,597 bytes, remains unchanged. Its upright
  2048×1536 PNG editing copy is 3,697,204 bytes. Smaller pixel dimensions do not
  imply a smaller encoded file.
- Copy preparation peaked at 420,021,810 accounted bytes against a
  536,870,912-byte scheduler budget, including full decode and output/Blob/hash
  overlap. This is not browser RSS or a physical-phone memory measurement.
- Eight synthetic EXIF orientations match independent coordinate mappings
  exactly after the declared Pillow Lanczos filter and native browser decode.
  Fixed limits 1, 4 and 8 reach their corresponding copy-worker peaks, with
  identical encoded output and no admission violations in that matrix.
- An alpha-128 PNG keeps alpha 128 after reduction.
- A tall depth-title scene with default outline/shadow values renders with an
  estimate of 492,458,449 bytes including retained inputs. The fixture reuses
  one unique photo, a uniform synthetic mask and device fonts in an isolated
  scheduler. It does not account for every application/browser cache.
- Maximum outline/shadow values require an estimated 641,997,265 bytes and are
  rejected before source reads under the same budget. That limit remains open.

The source photo uses the existing
[collection-corpus attribution](../../../../tests/fixtures/corpus/collections-v1/ATTRIBUTION.md).
The synthetic masks and orientation patterns are functional fixtures, not
representative portrait-edge, camera-color or visual-quality samples. The
orientation oracle shares Pillow's resizing filter, so it independently checks
coordinate normalization, not the quality of that filter across decoders.

The phone workflow checks explicit opt-in, 200% text, six copies and six saved
originals, exact reopened preview, original selection and undo. The
[Photos sheet](photos-phone.png) and [200% import options](import-options-200-phone.png)
were visually reviewed. Measurements are in [import-options-phone.json](import-options-phone.json).
No physical phone, virtual keyboard or assistive technology was tested here.

Five maintained model tests cover lineage validation, immutable original
references, default and small-source byte preservation, full-source admission,
deferred rereads, output ownership, changed sources, malformed results and
cancellation/draining. Ownership tests use a mock worker boundary; pixel
assertions use the real browser workflow.

Raw logs retain the first diagnostics-field error and the initial expectation
that maximum effects would fit. The field was corrected, and maximum effects
remain an explicit expected rejection alongside the separately tested default
effect case. Budgets were not enlarged. No throughput benchmark was rerun.

## Remaining gates

Reduced decoding, maximum-effect memory, representative heavy-crop/color
quality, physical-phone memory and storage, HEIC, full bulk composition,
complete retained-cache accounting, sustained collections, user studies,
licensing/release ownership and the previous timing failures remain required.
In-place conversion of existing sources and their masks is not implemented;
the opt-in choice currently applies when creating a story.
Copies are opt-in editing sources; export does not silently return to the
original. Original-resolution masks must be explicitly matched to the selected
source. The [execution ledger](../../../MIGRATION_STATUS.md) retains the full scope.
