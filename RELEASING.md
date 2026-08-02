# Release and Pages deployment guide

Tiny Image Star has no tagged release or package publication process yet. The
only current distribution is the GitHub Pages site built from `main`. A formal
application license and complete Pillow-RS provenance are required before
calling a tagged distribution open source; see [README.md](README.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Pre-release gate

From a clean checkout:

```bash
make install
make setup-browser
make verify
make package-pages
```

`make verify` runs the real byte/state checks and the headless browser smoke
suite. `make package-pages` recreates `_site/` inside the repository and then
checks that the payload contains only:

- `index.html` and `styles.css`;
- the application `src/` tree; and
- the generated `wasm/` runtime and notices.

The package check must pass before a main-branch deployment. It does not copy
README files, tests, `.github/`, `node_modules/`, local images, or development
secrets into the site.

## Generated runtime changes

If the checked-in Pillow-RS pair changes, stop and update its provenance before
deployment:

1. record the exact upstream revision and build command;
2. record toolchain and `wasm-pack` versions;
3. update both SHA-256 checksums and preserve the upstream license text; and
4. rerun `make verify` against the pair.

Do not replace only one generated file and do not edit Pillow-RS in this
repository.

## What GitHub Actions does

Pull requests run the verification matrix on Node.js 20 and 24 and assemble
the Pages payload, but do not deploy it. Pushes to `main` and manual workflow
runs repeat the same gate; only after verification and artifact validation does
the deploy job receive the Pages write and OIDC permissions.

## Recovery from a bad deployment

1. Confirm the deployed symptom and identify the `main` revision in the Pages
   workflow run.
2. Reproduce locally with `make verify` and `make package-pages`.
3. Revert the offending change with a reviewed commit, or submit the smallest
   corrective change.
4. Let the normal `main` workflow deploy the corrected artifact.
5. Record any user-visible boundary or migration note in the relevant docs.

This repository does not promise instant rollback, immutable releases, or a
backup of browser-local user data. Files already downloaded by users are not
managed by the Pages workflow.
