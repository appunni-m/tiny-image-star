# Existing-story source resolution — 20 September 2026

This adds reversible source-size changes to edited photos in the Photos sheet.
See [user behavior and limits](../../../WORKING_COPY_VERIFICATION.md#existing-edited-photos-reversible-resolution).
The full migration remains open; nothing is deployed by this change.

The browser observations in this directory use a synthetic 2052×513 image and a
soft grayscale mask. Four image/mask pairs produce identical encoded output at
observed worker peaks 1, 4 and 8, with no admission violations in that matrix.
Image and mask pixels match direct Pillow Lanczos references decoded by the
browser. The reference shares Pillow's resampler; this is a pipeline/ownership
check, not independent filter-quality certification or a performance benchmark.

An edited reduced mask restores to original dimensions with the edited band
preserved and zero pixel difference against a direct resize of that current
mask. The upright JPEG case ignores embedded EXIF as declared, while the
EXIF-to-upright case applies it. A colored PNG is rejected as a saved grayscale
mask. Phone-viewport checks cover Apply/Cancel, current metadata, connected
subjects, exact original-mask restoration, undo/redo, stored bytes and reload,
held worker preparation, selection cancellation, injected failure and retry.

The first visual review found the header's Cancel label splitting at 200% text.
The header now wraps as a unit and retains the label on one line. This is
emulated touch/browser evidence; physical phones, assistive technology and
virtual keyboards remain separate gates.

The full source and 206-file packaged Chromium suites, separate folder recovery
and all 152 deterministic checks (28 scheduler, 124 model/diagnostic) pass.
Adapter parity is 33/33. Its declared function-coverage slice is 27/35 against
the unchanged 70% threshold; it is not whole-product coverage. The new conversion
path has the separate real-engine and model checks described above.

[verification.json](verification.json) retains terminal results and artifact
hashes. [target.json](target.json) identifies the dirty worktree as
`89cc88caa09022ec007d2e11d8b22cf1b04fd7d6:f51a4a71119596962cee7fe8ebf1c56d9648e98afa206f97d74dc3d7920d9d3b`.
[source-files.json](source-files.json) binds 117 target inputs.
[verified-source.tar.gz](verified-source.tar.gz) contains the 225 source,
runtime, test and build inputs listed in [archive-files.json](archive-files.json).
[tested-site.tar.gz](tested-site.tar.gz) contains all 206 assembled files in
[packaged-files.json](packaged-files.json). Archive members and live files were
rechecked after browser execution; the paired published runtime is unchanged.
The source archive excludes Git history, installed dependencies and broader
documentation. [Browser observations](browser-observations.json) and the
[visual review](visual-review.md) describe the bounded checks.

Existing sealed import, font and recipe records are unchanged. The prior
benchmark's timing failures and different source identity are not resolved by
these checks. Full original decoding is still required. Maximum-effect memory,
physical devices, representative crop/edge quality, mixed-version updates,
complete bulk composition and the remaining production gates remain open.
