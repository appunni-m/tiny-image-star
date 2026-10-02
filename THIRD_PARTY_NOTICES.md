# Third-party notices

The local `.fig` import worker bundles the following MIT-licensed packages. Their notices apply to the bundled portions of this project:

- `openfig-core` 0.4.1 — copyright (c) rcoenen, as identified in the package metadata.
- `fflate` 0.8.3 — copyright (c) Arjun Barrett, 2026.
- `fzstd` 0.1.1 — copyright (c) Arjun Barrett, 2020.
- `kiwi-schema` 0.5.0 — copyright (c) Evan Wallace, 2020.

The build-only `esbuild` 0.28.2 dependency is also MIT-licensed; copyright (c) Evan Wallace, 2020. Its code is not included in the deployed importer bundle.

The local object-erase worker bundles `onnxruntime-web` 1.30.0, Copyright (c) Microsoft Corporation, under the MIT License. The pinned MI-GAN-512 Places2 ONNX pipeline model was published by Picsart AI Research under MIT; its complete upstream `LICENSE-WEIGHTS` text is shipped at `wasm/models/MI-GAN-LICENSE.txt`.

The local object-isolation worker bundles `@mediapipe/tasks-vision` 1.0.1, Copyright (c) The MediaPipe Authors, under Apache License 2.0. Its SIMD and non-SIMD WebAssembly assets are pinned in `wasm/object-isolation-runtime.json`; the license text is included at `wasm/mediapipe/APACHE-2.0.txt`. The MagicTouch Interactive Segmenter v2 int8 model is Copyright (c) Google LLC, distributed under Apache License 2.0 as stated by the official task archive and model card. The exact model artifact, provenance, generation, hash, and license are recorded in `wasm/object-isolation-runtime.json`; its source is Google's `interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task` artifact.

The local font inspector bundles `woff2-encoder` 2.0.0, Copyright (c) 2023-present Kyedo, under the MIT License. Its browser worker embeds WebAssembly compiled from Google's WOFF2 and Brotli libraries, which are also MIT-licensed. The package license and both upstream license texts, along with the worker checksum, are recorded in `wasm/woff2-runtime.json` and shipped under `wasm/woff2/`.

The local typography preview worker bundles `harfbuzzjs` 1.6.2, under the MIT License. Its pinned WebAssembly runtime and worker checksum are recorded in `wasm/harfbuzz-runtime.json`; the complete package license is shipped at `wasm/harfbuzz/LICENSE.txt`.

The variable-font test fixture `tests/fixtures/fonts/inter-latin-variable.woff2` is Inter Variable Latin from `@fontsource-variable/inter` 5.3.0, Copyright 2016 The Inter Project Authors, under the SIL Open Font License 1.1. Its complete upstream license is included beside the fixture at `tests/fixtures/fonts/OFL.txt`.

The `.fig` compatibility samples in `tests/fixtures/fig-import/` are copied from OpenFig-org/openfig-core's test corpus at the commit named in that directory's README. The upstream package metadata declares MIT; the fixture directory contains its attribution and license notice.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
