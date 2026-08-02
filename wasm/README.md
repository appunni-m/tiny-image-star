# Generated Pillow-RS browser runtime

The files `pillow_rs_js.js` and `pillow_rs_js_bg.wasm` are generated artifacts
consumed by Tiny Image Star's app-owned adapter. Do not edit either file by
hand or replace only one member of the pair.

Upstream source: <https://github.com/appunni-m/pillow-rs>

The exact source revision/build invocation for the currently checked-in pair
was not recorded when it was copied. That is provenance debt, not permission to
guess a revision. The current SHA-256 checksums are:

```text
36433b78090749bbd6463236bcaafb64f6ed7f6ee7cfd080a516724957587c14  pillow_rs_js.js
89b09da572b3361d5bac7fd338334e34ce61c6e29b02d06056504e33ee5d10be  pillow_rs_js_bg.wasm
```

A future artifact update must record:

- the exact Pillow-RS commit;
- the complete `wasm-pack` command and enabled features;
- toolchain and `wasm-pack` versions;
- both new SHA-256 checksums; and
- the result of `npm run verify:all` against the replacement.

Pillow-RS is distributed under the MIT-CMU license. The upstream license text
copied for this runtime is in `PILLOW_RS_LICENSE.txt`. Tiny Image Star's own
application license is a separate, currently pending owner decision.
