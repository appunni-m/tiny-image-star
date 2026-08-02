# Third-party notices

Tiny Image Star's deployed static artifact includes generated JavaScript and
WebAssembly from [Pillow-RS](https://github.com/appunni-m/pillow-rs), licensed
under MIT-CMU. The copied upstream license text and current checksums are in
[`wasm/`](wasm/README.md).

The exact Pillow-RS source revision and transitive Rust dependency-license
inventory for the currently checked-in generated pair were not recorded when
it was copied. That provenance must be completed before a tagged public release;
this notice does not guess at missing dependency terms.

Development dependencies are recorded in `package-lock.json`. Playwright is
licensed under Apache-2.0, and its optional `fsevents` dependency is licensed
under MIT according to the locked package metadata. They are used for local/CI
testing and are not copied into the GitHub Pages artifact.

Tiny Image Star's own application-code license is still pending an explicit
project-owner decision. See the README's license status.
