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

`make verify` delegates to the single project gate, `npm run verify:all`.
GitHub Actions runs it on Node.js 20 and 24, with Chromium installed on Linux.
The workflow then runs `make package-pages` and checks the output allowlist
before uploading it. Only non-pull-request events may deploy to Pages.

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
For an update, record the Pillow-RS source revision, complete build command,
toolchain versions, both checksums, upstream license material, and the result
of `make verify` in [wasm/README.md](wasm/README.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Do not edit the external
Pillow-RS checkout from this repository.

## Triage and recovery

Use [SUPPORT.md](SUPPORT.md) to route bugs, feature requests, and sanitized
diagnostics. Before changing a recovery or local-storage schema, document the
version boundary, migration/clear behavior, and browser permission impact.

If a Pages deployment is wrong, follow [RELEASING.md](RELEASING.md): verify the
artifact first, revert the offending `main` change through a normal reviewed
commit, and rerun the workflow. Avoid force-pushing or deleting deployment
state as a first response.
