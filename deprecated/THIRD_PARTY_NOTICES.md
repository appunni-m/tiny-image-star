# Third-party notices

Tiny Image Star's assembled static artifact includes generated JavaScript and
WebAssembly from [Pillow-RS](https://github.com/appunni-m/pillow-rs), licensed
under MIT-CMU. The copied upstream license text and current checksums are in
[`wasm/`](wasm/README.md).

The exact package is `pillow-rs@12.2.0-alpha.1`, with source revision
`310788f9fcadc85b02263b383c5a6ea094b000c6`. Registry integrity, provenance URL
and paired file/license hashes are recorded in [runtime.json](wasm/runtime.json)
and verified by the staging script. The generated JS/WASM remain unchanged in
the assembled artifact. This records identity; it does not substitute for
cryptographic provenance verification or a complete transitive Rust/codec
dependency-license review. Those remain release evidence requirements.

Development dependencies are recorded in `package-lock.json`. Playwright is
licensed under Apache-2.0, and its optional `fsevents` dependency is licensed
under MIT according to the locked package metadata. They are used for local/CI
testing and are not copied into the GitHub Pages artifact. esbuild is a build
dependency and is likewise not served as part of the editor.

The story typography pack redistributes unmodified Source Serif 4, Source Sans
3, Source Code Pro and Oswald variable fonts under SIL OFL 1.1. Each original
license and copyright notice is included beside its binary in
[`src/assets/story-type-v1/`](src/assets/story-type-v1/README.md), and that
directory is included in the static artifact. The
[provenance record](src/assets/story-type-v1/provenance.json) pins the Google
Fonts source revision, original URLs, byte sizes and SHA-256 hashes. This pack
does not grant rights to other fonts imported by users.

The camera-photo benchmark corpus has separate source-specific attribution,
including a CC BY-SA photograph and CC0 sources; see
[its attribution record](tests/fixtures/corpus/collections-v1/ATTRIBUTION.md).
Test photographs and font fixtures are not copied into `_site/`. User-imported
fonts and images are user assets, not an application redistribution license.
Optional model/decoder/template assets require their own documented terms
before being added to a distributed build.

Tiny Image Star's own application-code license is still pending an explicit
project-owner decision. See the README's license status.
