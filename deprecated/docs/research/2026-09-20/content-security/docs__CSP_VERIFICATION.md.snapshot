# Content Security Policy verification

Implemented 20 September 2026. This is a browser enforcement milestone, not a
completed security audit or production release. The [execution ledger](MIGRATION_STATUS.md)
retains all other migration gates.

## Policy and resource requirements

[index.html](../index.html) declares the policy immediately after the charset,
before scripts, stylesheet or favicon. [security-policy.mjs](../scripts/security-policy.mjs)
checks that placement and the exact reviewed value during deterministic
verification, assembly and artifact validation. It generates the artifact's
`_headers` file from the same policy; artifact validation rejects drift.

| Resource | Allowed behavior |
| --- | --- |
| Default | Deny resources unless explicitly allowed below |
| Scripts | Same-origin application modules; WASM compilation via `wasm-unsafe-eval`; no JavaScript `unsafe-eval`, inline handlers/scripts, data/blob scripts |
| Workers | Same-origin URL workers; no data/blob worker entry points |
| Styles | Same-origin CSS; runtime CSS property assignments work; injected style elements/attributes are denied |
| Images | Same-origin, blob and data URLs for local previews/favicon |
| Fonts | Same-origin fonts; verified bytes can construct a FontFace |
| Connections | Same-origin and local blob reads; no foreign fetch/POST/import/redirect/beacon destination |
| Manifest | Same-origin only; this allowance does not implement a PWA |
| Objects, frames, base URL, network forms | Denied; dialog forms still work |

The HTTP policy adds `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The document
also declares a referrer meta policy. No reporting service or image telemetry
was added. CSP is not a complete exfiltration boundary: same-origin requests
are allowed, and approved file sharing/navigation are different browser paths.

## Actual browser enforcement

[verify-security.mjs](../scripts/verify-security.mjs) serves the source or exact
assembled artifact in two modes: document meta only, and the reviewed HTTP
headers on every response. It tests real Chromium and Playwright WebKit at a
375 × 667 viewport. The [probe module](../tests/helpers/csp-probe.js) runs as a
normal same-origin script/worker, avoiding DevTools eval exemptions.

- Legitimate checks run the actual published WASM and shared processing pool:
  four outputs at two simultaneous workers, native PNG decode, verified bundled
  font loading/FontFace, image preview and a real blob download.
- Attack checks attempt inline/event/data/blob/foreign scripts, eval/Function,
  foreign fetch and POST, redirect and dynamic import, beacon, stylesheet,
  font/image/object/frame loading, injected CSS, base replacement, network form
  submission and blob worker creation. Expected code never runs. The page
  emits enforced violation events and the controlled foreign receiver gets
  zero requests from protected contexts.
- HTTP worker probes reject eval/Function and foreign fetch/POST/redirect/import
  while WASM and local blob reads work. Chromium exposes worker violation
  events. The tested WebKit build exposes none; rejected operations and zero
  receiver traffic establish the result instead.
- A negative control uses the **same** test worker and reachable localhost
  receiver under document-meta-only delivery. Eval/Function execute and four
  synthetic requests arrive. This proves both the test transport and the
  missing worker protection, without using user images or an external service.
- The same-origin embedding control succeeds with meta-only delivery and is
  blocked by the HTTP policy. The test waits for frame loading, rather than
  treating an initially empty frame as a pass.

Run:

```bash
npm run verify:security
TINY_IMAGE_STAR_SECURITY_BROWSERS=chromium,webkit npm run verify:security
make package-pages
TINY_IMAGE_STAR_BROWSER_ROOT=_site TINY_IMAGE_STAR_SECURITY_BROWSERS=chromium,webkit npm run verify:security
```

Install both engines first with
`make setup-browser BROWSER_INSTALL_ARGS="chromium webkit"`.
`TINY_IMAGE_STAR_SECURITY_REPORT=/absolute/path/report.json` retains detailed
events and observations. CI runs both engines for source and packaged policies;
the complete source/packaged Chromium suites continue to exercise the app with
the document policy and no test-server HTTP policy.

## Hosting boundary and release check

The [W3C CSP specification](https://www.w3.org/TR/CSP3/#meta-element) explains
the meta delivery and header-only directive limits. Normal worker policies
come from their own script response; see
[MDN's worker CSP guidance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy).
The generated file follows the documented
[Cloudflare Pages static header format](https://developers.cloudflare.com/pages/configuration/headers/).
This prepares an artifact for a compatible host; it does not deploy or migrate
hosting. Functions/dynamic responses would need their own header handling.

The repository still deploys through GitHub Pages. The dated public document
and image/folder worker HEAD checks returned HTTP 200 without CSP,
frame-denial, nosniff or referrer headers. HEAD is an observation, not a
substitute for checking the responses a browser loads. The new command checks
actual GET responses, including WASM:

```bash
npm run check:deployment-security -- https://appunni-m.github.io/tiny-image-star/
```

It intentionally fails until the deployed responses match the reviewed policy.
No remote headers or deployed bytes were changed by this work. The release
must use an isolated application origin, configure the policy on worker
responses, rerun this check and verify browser workflows/rollback on the actual
host. A same-origin allowlist trusts every executable resource on that origin.

## Evidence and limits

The [dated record](research/2026-09-20/content-security/README.md) retains logs,
browser observations, deployment responses and exact source/artifact hashes.
Full regression and focused enforcement results are separate from throughput
evidence. There is no new performance claim or physical iOS/Android security
qualification. The existing npm advisory result does not cover compiled Rust
dependencies, browser decoders, app logic, model licenses or incident response.
Those gates and a security review of imported content remain open.
