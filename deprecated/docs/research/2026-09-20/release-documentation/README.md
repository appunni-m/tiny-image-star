# Release documentation audit

Recorded 20 September 2026. Audience: maintainers packaging, upgrading and
recovering this static JavaScript/WASM application. This is a scoped correction
of the engine/release documents, not an open-source-readiness certification.

## Corrections supported by implementation

| Claim corrected | Source of truth and status |
| --- | --- |
| The app requires a local Rust rebuild and exposes only PNG output | `package.json`, lockfile, runtime staging, `src/engine/pillow.js`, and the completed source/packaged browser logs prove the app integrates the exact published package and qualified PNG/JPEG output. The old local-build notes are preserved under `research/2026-08-02/`. |
| The Pages build requires Binaryen or transforms the published WASM/binding | The assembly and optimizer scripts stage and verify the pinned pair, minify app JS/CSS, and generate transport sidecars. The current package check passes for 179 files; generated engine bytes match their pinned hashes. |
| Artifact source identity is unknown | The runtime metadata and stage verifier record/check package integrity, source commit and paired hashes. This does not establish cryptographic provenance verification or all transitive license terms. |
| `make verify` and CI imply the full launch gate | Make/package scripts and `.github/workflows/pages.yml` define their actual checks. The long collection benchmark, physical devices, pilot, named ownership and immutable rollback qualification remain separate. CI configuration was inspected; a successful remote CI run was not claimed. |
| A corrective deployment is an instant rollback or a user-data backup | The workflow has no immutable rollback/cohort implementation. Project backups and future-version fences are application features, not a server backup or permission to rewrite incompatible data. |

Updated [release guide](../../../../RELEASING.md),
[engine decision](../../../../ENGINE_EVALUATION.md),
[integration issues](../../../../PILLOW_RS_ISSUES.md), and
[third-party notices](../../../../THIRD_PARTY_NOTICES.md).
The [maintainer guide](../../../../MAINTAINERS.md) now follows the same published
artifact contract, and the [historical UX audit](../../../../PRODUCT_UX_AUDIT.md)
explicitly points readers past its obsolete PNG-only/quality-control findings.
The [encoder-options proposal](../../../PILLOW_ENCODER_OPTIONS_PROPOSAL.md)
is explicitly a local request, not an implemented upstream API or a submitted
external issue.

## Verification and remaining findings

The repository-native link checker passed for 56 Markdown files before this
report was added; its [log](source-links.log) is retained. It excludes `_site/`
and checks file existence, not every heading or remote URL. The skill's broader
[inventory](inventory-before.json) includes the built artifact and found one
real error: `_site/wasm/README.md` linked to the source-only staging script,
which is intentionally not shipped. After the benchmark's measured source and
tested site were archived, the notice was corrected to identify the source
checkout path and explain that the tool is not part of the deployed files.
Do not treat the narrower source-link result as proof that artifact
documentation is clean.

The inventory also flags the absent application license (an actual owner
decision), an unlabeled fence in an app evidence document (now labeled `text`), unlabeled fences in
a downloaded research SDK, and phrases such as “not production-ready” that
need contextual review. The negated claims inspected here correctly deny
qualification; they are not production promises. The downloaded SDK is not
shipped by the app and was not edited.

The command recipes were checked against Make/npm/workflow definitions and
existing executed logs. A new clean installation, registry signature audit,
remote deployment, rendered-document accessibility check, physical-device
qualification and rollback drill were not executed by this documentation
change. No runtime code, benchmark input or measurement threshold changed in
this audit. Local file/document inspection occurred during the benchmark;
no build or image regression suite overlapped its timing run.

The rebuilt 179-file site passes the artifact checker. A full hash comparison
against the archived tested site proves that only `wasm/README.md` changed;
served JS, CSS and WASM bytes are identical. The archived 167-file source
snapshot likewise differs only in that notice. Browser suites were therefore
not repeated for this documentation-only repair. The historical archive and
before-audit finding remain intact. The strict documentation inventory has no
remaining structural errors; review findings do not certify licensing or the
unexecuted release gates above.
The [final inventory](inventory-after.json) and [verification receipt](verification.json)
retain the exact checks, artifact comparison and remaining qualification limits.

The old source snapshot omitted one build-only helper. The new benchmark archive
separately retains `staging-script.mjs` for restoration as
`scripts/stage-pillow-runtime.mjs` over the base checkout. Its original measured
source archive and index were preserved rather than rewritten. Corpus binaries
remain at their existing pinned repository paths.
