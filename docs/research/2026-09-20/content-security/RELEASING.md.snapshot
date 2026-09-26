# Release and Pages deployment guide

Updated 20 September 2026 against the current build scripts and workflow.
The repository configures a static GitHub Pages deployment for pushes to `main`
and manual workflow runs. It does not yet implement an immutable application
release/rollback process. A passing local build is not production signoff; the
[migration release gates](MIGRATION_PLAN.md#9-production-readiness-is-a-release-gate-not-a-percentage)
and [execution ledger](docs/MIGRATION_STATUS.md) remain authoritative.

The app's own license still needs an owner decision. The integrated Pillow
package now has recorded source/artifact identity; complete dependency-license
review and verified provenance evidence remain separate gates. See
[third-party notices](THIRD_PARTY_NOTICES.md).

## Pre-release gate

Use Node.js 20 or newer and GNU Make 3.81 or newer. The configured CI matrix is
Node 20 and 24; local evidence names the actual runtime used. Dependency and
browser installation, and registry-signature verification, need network access.
From a clean checkout, the repository commands are:

```bash
make install
npm audit signatures
make setup-browser
make verify
make setup-browser BROWSER_INSTALL_ARGS="chromium webkit"
TINY_IMAGE_STAR_SECURITY_BROWSERS=chromium,webkit npm run verify:security
npm run migration:check
npm run migration:parity
npm run migration:coverage
make package-pages
TINY_IMAGE_STAR_BROWSER_ROOT=_site make verify-browser
TINY_IMAGE_STAR_BROWSER_ROOT=_site TINY_IMAGE_STAR_SECURITY_BROWSERS=chromium,webkit npm run verify:security
npm run migration:benchmark
npm run migration:status
```

`make verify` runs runtime-integrity, deterministic, source Chromium,
document/worker CSP, folder-recovery and local-document-link checks. CSP tests
default to Chromium; CI also installs and tests WebKit. The migration commands validate
the declared public slice, execute the frozen adapter comparison, collect
managed coverage, and record benchmark evidence. The collection benchmark is
long-running and intentionally returns failure when a timing budget fails;
retain that result. Dirty-target evidence remains unproven for release even
when individual comparisons pass. These commands do not run physical-phone
qualification, user studies or the rollback drill.

`make package-pages` recreates `_site/` inside the repository, stages the exact
locked Pillow package, minifies application JavaScript/CSS, emits Brotli
sidecars, and checks the payload. The artifact contains only:

- `index.html` and optimized `styles.css` plus its Brotli sidecar;
- `_headers`, the reviewed static-host HTTP security policy;
- the application `src/` tree; and
- the `wasm/` runtime, pinned identity metadata, upstream license/notice files,
  and Brotli sidecars.

Both generated Pillow files remain byte-identical to the published package.
This pipeline does not run `wasm-opt` or minify the generated binding;
`WASM_OPT_REQUIRED` is no longer part of its contract. Brotli transport sidecars
are checked against their original bytes. The assembled app opts into the WASM
sidecar where browser decompression is supported, with the original WASM path
as fallback. App JS/CSS sidecars are generated, but this workflow does not
configure host `Content-Encoding` behavior for them. Their sizes are not proof
of bytes transferred by a deployed browser. Minification is not source secrecy.

The package check must pass before a main-branch deployment. It does not copy
README files, tests, `.github/`, `node_modules/`, local images, or development
secrets into the site.

### Required HTTP policy

The document's meta CSP protects the page but cannot secure normal URL workers
or prevent the app from being framed. `_headers` uses the Cloudflare Pages
static-asset format; GitHub Pages does not activate it. A hosting migration or
an equivalent response-header layer is still required for the full security
gate. Apply the reviewed headers to **all** responses, including both worker
entry scripts, and verify the actual HTTPS deployment with:

```bash
npm run check:deployment-security -- https://host.example/app/
```

Replace the example with the actual application directory. The command checks
GET responses for the document, image worker, folder worker and WASM, rejects
redirects and missing/different policy headers, checks MIME types, and exits
nonzero on failure. A passing header check does not identify deployed bytes or
replace browser/rollback qualification. See [CSP evidence](docs/CSP_VERIFICATION.md).

## Generated runtime changes

An engine upgrade is an explicit dependency change, not a local Rust rebuild:

1. Select an immutable published package and verify its registry integrity,
   source/provenance evidence, capabilities and notices.
2. Update the exact dependency/lockfile and the approved identity in
   [stage-pillow-runtime.mjs](scripts/stage-pillow-runtime.mjs). Review both
   generated file hashes and the upstream license hash.
3. Run `npm run stage:runtime`, then `npm run check:runtime`. Staging resolves
   the installed package through its exported package metadata and rejects
   mismatched package, lockfile or generated bytes.
4. Run the full source, adapter, packaged-artifact and benchmark checks above.
   Record the application revision, runtime metadata, toolchain, commands,
   output logs and artifact hashes. Review format/error/recipe migrations and
   the ability of the rollback artifact to read existing projects.

Do not replace only one generated file and do not edit Pillow-RS in this
repository.

## What GitHub Actions does

The [workflow](.github/workflows/pages.yml) configures Node 20/24 verification,
`npm audit signatures`, Chromium checks, Chromium/WebKit CSP checks, folder recovery, and migration
specification/parity/coverage. A Node 24 build assembles and validates the Pages
artifact, then runs the Chromium suite and both-browser CSP profiles against that directory. Pull requests
do not upload/deploy it. Main pushes and manual runs can deploy after those
jobs; the deploy job holds Pages-write and OIDC permissions.

This describes configured automation, not an inspected successful remote run.
The workflow does not run the long collection benchmark, enforce all product
release gates, archive a qualified immutable rollback release, or implement
cohort rollout. A deployable workflow result is not evidence that those gates
passed. Manual dispatch must select the intended, reviewed revision.

## Recovery from a bad deployment

1. Confirm the deployed symptom and identify the `main` revision in the Pages
   workflow run.
2. Preserve a non-sensitive reproduction and available workflow/artifact logs.
   Reproduce with source and packaged checks; offer project backup before any
   browser-storage reset. Do not use a storage wipe as a rollback procedure.
3. Revert the offending change with a reviewed commit, or submit the smallest
   corrective change.
4. Let the normal `main` workflow deploy the corrected artifact.
5. Record any user-visible boundary or migration note in the relevant docs.

This is the current corrective-deployment path, not a rehearsed instant
rollback. Older application versions must not destructively rewrite newer
projects or presets. Preserve incompatible data and the user's ability to back
it up; UI project backup is not a server-side backup service. Downloaded files
are not managed by the Pages workflow.

Before general availability, the plan additionally requires a named release and
incident owner, immutable artifact retention, a synthetic load/render/export
health check, demonstrated host headers/cache/base-path behavior, a rollback
drill, device/accessibility/performance evidence, consented pilot results and
all product-truth/license gates. None is proved by this guide alone.
