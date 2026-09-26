# Research evidence: 16 September 2026

Supports the [migration plan](../../../MIGRATION_PLAN.md). No application runtime or dependency lockfile was changed during this research.

## Files

- [release-evidence.json](release-evidence.json): npm publication metadata, observed tags, integrity, inspected alpha provenance, current-app test results and emulated mobile geometry.
- [pillow-capability-probe.json](pillow-capability-probe.json): real Node execution of both published WASM packages on repository fixtures and small generated images.
- [probe-published-pillow.mjs](probe-published-pillow.mjs): the exploratory probe. It records failures rather than acting as a production acceptance test.

The package registry was fetched directly over HTTPS. Both tarball SHA-512 values matched the corresponding `dist.integrity`. Provenance payload inspection is recorded separately from signature/transparency verification, which was not performed.

## Reproduce

Download the exact tarball URLs recorded in `release-evidence.json`. Before executing them, compare their SHA-512 integrity values with the recorded values and the public registry. Extract the packages into a temporary directory with this structure:

```text
<artifact-directory>/
  v0.1.3/package/node.js
  v0.1.3/package/pkg/core/...
  v12.2.0-alpha.1/package/node.js
  v12.2.0-alpha.1/package/pkg/core/...
```

Run from the Tiny Image Star repository root with Node.js 20+:

```bash
node docs/research/2026-09-16/probe-published-pillow.mjs \
  /absolute/path/to/artifact-directory \
  /absolute/path/to/new-probe-results.json
```

No installation scripts or application dependency changes are required. The probe imports the extracted package's Node entry point and invokes its bundled WASM. It decodes all current fixtures, forces loading/raw-byte access, encodes a small RGB image using `saveWithInput`, reopens output, and records selected operation results.

These checks are deliberately narrow: they are not an independent-decoder comparison, quality-control test, EXIF transpose validation, broad pixel-parity test, font test, memory benchmark, security audit, or browser/mobile certification. The source-image fixtures are tiny. Failures are evidence to investigate, not automatically a project release failure outside the stated scope.

## Current app baseline

Application commit: `89cc88c`. The deterministic verifier passed. The existing Chromium smoke passed after rerunning it with localhost permission; the initial sandboxed combined check could not bind a local server. The documentation checker passed. No claim is made that the new package has passed the application's full browser suite.

The local application was inspected in the embedded browser at 390 × 844 with the repository's small PNG fixture. Canvas top was 481.65625 CSS px and canvas height 362.3046875 CSS px. Page height was 1339 CSS px. These are a particular loaded state, not universal responsive-layout measurements. Viewport override was reset and the inspection tab was closed afterward.

## Subsequent implementation evidence

During execution of the migration plan, `npm audit signatures --json
--include-attestations` (npm 11.16.0, Node v24.18.0) verified registry signatures
for 6/6 installed packages and attestations for 5 packages, including
`pillow-rs@12.2.0-alpha.1`. The complete public verification output is retained
in [verified-npm-attestations.json](verified-npm-attestations.json). This is
additional evidence after the initial payload-only provenance inspection.

The published pair is now staged from the exact npm lockfile, and the app's
deterministic and Chromium source-browser suites have passed with it. Migration
comparisons and current caveats are tracked in the
[execution ledger](../../MIGRATION_STATUS.md) and
[engine parity scope](../../ENGINE_PARITY_SCOPE.md). Physical-device, general
concurrency, and production launch gates remain open.
