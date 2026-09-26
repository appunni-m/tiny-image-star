# Browser content policy — 20 September 2026

This advances migration §9 with an enforced document CSP, generated static-host
HTTP policy, source/package guards and browser enforcement tests. The
[behavior and hosting boundary](../../../CSP_VERIFICATION.md) describe allowed
resources and what still requires a production header configuration.

The [source observations](source-security.json) and
[packaged observations](packaged-security.json) each contain four runs:
Chromium and Playwright WebKit, each under meta-only and HTTP-header delivery.
Real WASM, four outputs at two simultaneous workers, native image decode,
bundled font loading/FontFace and blob downloads pass. Protected contexts block
the tested code/network/resource/form attempts. The localhost receiver observes
zero requests from protected contexts.

The meta-only worker is an intentional negative control: it executes synthetic
eval/Function code and makes four synthetic requests to the reachable localhost
receiver. The identical worker with HTTP CSP does neither. No user images are
sent by these probes. Both engines expose document violations; this WebKit
build exposes no worker violation events, so its worker evidence uses rejected
operations and receiver observations. Meta-only embedding succeeds; HTTP
frame-denial blocks it.

## Verification

| Check | Result |
| --- | --- |
| [Source CSP](source-security.log) | Four browser/policy combinations pass |
| [Packaged CSP](packaged-security.log) | Four browser/policy combinations pass |
| [Deterministic suite](unit.log) | 175 pass: 38 scheduler, 137 model/diagnostic |
| [Full source browser suite](source-browser.log) | Pass with document meta policy |
| [Full packaged browser suite](packaged-browser.log) | Pass with document meta policy |
| [Folder recovery](recovery.log) | Pass |
| [Package validation](package.log) | 215 files, including generated `_headers` |
| [Adapter parity](parity.json) | 33/33 comparisons pass |
| [Declared coverage](coverage.json) | 27/35 functions; unchanged 70% threshold passes |
| [Specification](migration-check.log) and [fixture audit](fixture-audit.log) | Pass |
| [Live deployment GET check](deployment-security.json) | **Fail:** all four resources return 200 with expected MIME but lack all four reviewed security headers |
| [Earlier public HEAD observations](live-headers.json) | Document and both workers return 200 without those headers |
| [Release aggregation](aggregate.log) | Unproven; complete release gates remain open |

The live read-only checks did not modify or deploy anything. The current
GitHub Pages workflow does not activate `_headers`. A compatible static host
or equivalent HTTP response layer is still needed; generating a file is not
evidence of deployed worker or framing protection.

`verification.json` is the final receipt. [Source inventory](archive-files.json)
and [source archive](verified-source.tar.gz) include the exact app, scripts,
tests, runtime, package metadata and CI workflow. The separate
[processing inventory](source-files.json) retains the canonical engine target;
that identity does not cover HTML/build/test policy changes. The receipt also
records a hash of the complete archived inventory. The
[packaged inventory](packaged-files.json) binds the
[tested site](tested-site.tar.gz), including HTML and `_headers`. Historical
documentation snapshots are retained as `.snapshot` files.

Reproduce using `npm run verify`, `npm run verify:browser`,
`npm run verify:folder-recovery`, `make package-pages`, the packaged browser
suite and both-browser `verify:security` commands in the linked guide. Install
Chromium/WebKit first. The snapshot and seal scripts retain the original local
workspace path and need adjustment when restored elsewhere.

These runs make no new throughput or physical-mobile qualification claim.
The full security/license/dependency review, physical devices, release/rollback
and the remaining creative/bulk migration work are still open.
