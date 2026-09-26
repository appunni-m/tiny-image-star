# Generated Pillow-RS browser runtime

The files `pillow_rs_js.js` and `pillow_rs_js_bg.wasm` are generated artifacts
consumed by Tiny Image Star's app-owned adapter. Do not edit either file by
hand or replace only one member of the pair.

Upstream source: <https://github.com/appunni-m/pillow-rs>

The pair is copied unchanged from `pillow-rs@12.2.0-alpha.1`, pinned in the npm
lockfile. Its npm provenance identifies source commit
`310788f9fcadc85b02263b383c5a6ea094b000c6`. The app does not rebuild upstream.
Package integrity and per-file hashes are recorded in [runtime.json](runtime.json)
and enforced by `scripts/stage-pillow-runtime.mjs` in the application source
checkout. That build tool is not included in the deployed static files.
Current SHA-256 checksums:

```text
3d4251ad14e3731e680286d3ea9d8f25af932448596eaa2af09474ebcfd1b5ed  pillow_rs_js.js
08dfff0b10424b6ece937574aefd4c07d1d4f8ac95643e7c4d5138ab720d5a96  pillow_rs_js_bg.wasm
```

Use `npm run stage:runtime` after installing the locked package and
`npm run check:runtime` to check it without changing files. Pages builds stage
from the installed package, preserve the generated JS/WASM bytes, and validate
that transport sidecars decompress to those exact bytes. No `wasm-opt` step is
applied. The old pair and adapter are retained under `tests/oracles/legacy/`;
their original upstream source revision remains unknown.

A future artifact update must record:

- the exact Pillow-RS commit;
- the exact npm release, lockfile integrity and verified provenance;
- any transformation of published artifacts and its toolchain;
- both new SHA-256 checksums; and
- the result of `npm run verify:all` against the replacement.

Pillow-RS is distributed under the MIT-CMU license. The upstream license text
copied for this runtime is in `PILLOW_RS_LICENSE.txt`. Tiny Image Star's own
application license is a separate, currently pending owner decision.
