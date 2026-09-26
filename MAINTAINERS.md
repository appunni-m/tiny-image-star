# Maintainer guide

Tiny Image Star is a pre-release static browser application. This guide records
the repository workflow that is true today; it is not a promise of a formal
maintainer team, response time, or release cadence.

## Ownership and decisions

- `main` is the only supported development branch. There are no tagged
  versions, backport branches, or published package artifacts.
- Product and architecture changes should start with a focused GitHub issue or
  pull request discussion. Keep user-visible language simple and preserve the
  private, browser-only boundary.
- The repository owner controls release, Pages, dependency, and license
  decisions. The application license is still an explicit pre-release gate;
  do not imply that source availability grants reuse rights.
- Security reports use [SECURITY.md](SECURITY.md), not a public issue.

## Review and CI contract

Every change should be reproducible from a clean checkout with Node.js 20 or
newer:

```bash
make install
make setup-browser
make verify
```

`make verify` delegates to `npm run verify:all`, including deterministic,
source-browser, folder-recovery and documentation-link checks. The configured
GitHub Actions workflow uses Node.js 20 and 24 with Chromium on Linux and also
checks registry signatures and migration specification/parity/coverage.
Its build runs `make package-pages`, checks the output allowlist and Brotli
round trips, and runs the browser suite against `_site` before upload.
The published Pillow JS/WASM pair stays unchanged; there is no Binaryen step.
Only non-pull-request events may deploy to Pages. App minification reduces
transfer size; it is not a security or source-hiding mechanism.

This is the inspected workflow configuration, not proof of a successful remote
run. The long collection benchmark, device/pilot evidence and remaining launch
gates are separate. Use [RELEASING.md](RELEASING.md) for the complete local
command sequence and the limits of the current deployment/recovery process.

Reviewers should ask for:

- user-visible behavior and deterministic or browser-smoke evidence;
- output-byte, format, storage, permission, and memory-boundary changes;
- no accidental image uploads, telemetry, remote fonts, or cloud processing;
- no hand-edited Pillow-RS generated files; and
- documentation updates when commands, limits, support, or trust claims change.

## Dependency maintenance

Dependabot proposes monthly npm and GitHub Actions updates. A dependency
update is not accepted solely because its lockfile changed: run `make verify`
and inspect the resulting output/interaction boundaries. Keep CI action major
versions current and review their release notes before updating a workflow.

## Generated image-engine artifacts

`wasm/pillow_rs_js.js` and `wasm/pillow_rs_js_bg.wasm` are one generated pair.
The current app stages an exact published npm package. For an update, verify its
registry integrity/provenance and source revision, update the dependency,
lockfile and approved staging identity together, retain paired file/license
hashes, and run source, adapter, packaged-artifact and performance checks.
Record the results and actual toolchain. See [wasm/README.md](wasm/README.md),
[RELEASING.md](RELEASING.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
Do not edit the external Pillow-RS checkout or one generated member of the pair.

## Triage and recovery

Use [SUPPORT.md](SUPPORT.md) to route bugs, feature requests, and sanitized
diagnostics. Before changing a recovery or local-storage schema, document the
version boundary, migration/clear behavior, and browser permission impact.

If a Pages deployment is wrong, follow [RELEASING.md](RELEASING.md): verify the
artifact first, revert the offending `main` change through a normal reviewed
commit, and rerun the workflow. Avoid force-pushing or deleting deployment
state as a first response.
