# npm advisory check — 20 September 2026

`npm audit --json` completed with exit code 0 and **zero reported vulnerabilities**
at every severity. The [raw response](npm-audit.json) records 31 dependency
entries, including development and optional packages. npm's category totals
overlap and should not be added together. The [verification record](verification.json)
binds this response to the package and lockfile hashes. The command used npm
11.16.0; it did not run `audit fix` or change dependencies.

The command asks the configured registry about known dependency advisories;
this is a dated result for that registry's coverage. [npm audit documentation](https://docs.npmjs.com/cli/v11/commands/npm-audit/).
It does not audit the Rust crates compiled into Pillow's WASM, browser image/font
decoders, application authorization/storage logic, licenses, or deployed headers.
Zero reported advisories is not a vulnerability-free certification.

A separate source inspection found no CSP declaration in `index.html`, the
Pages workflow, or the assembly/check scripts. No live hosting headers were
inspected in this check. The application-owned network code inspected loads
the paired WASM asset and the pinned same-origin font pack; that source review
does not replace a complete network/threat-model assessment. The existing
[security policy](../../../../SECURITY.md) and
[migration release gates](../../../MIGRATION_STATUS.md) still apply. CSP testing,
compiled-runtime dependency coverage, license/ownership review and deployment
qualification remain open.
