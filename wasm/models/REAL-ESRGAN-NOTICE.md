# Real-ESRGAN general x4v3 model notice

This directory contains `realesr-general-x4v3.onnx`, a browser-oriented conversion of the Real-ESRGAN general x4v3 model.

- Architecture and weights: Real-ESRGAN `SRVGGNetCompact`, copyright 2021 Xintao Wang, BSD-3-Clause. The full license is in `REAL-ESRGAN-LICENSE.txt`.
- License source: [`LICENSE`](https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/LICENSE) at pinned commit `a4abfb2979a7bbff3f69f58f58ae324608821e27`.
- Upstream checkpoint: [`realesr-general-x4v3.pth`](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth), SHA-256 `8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292`.
- Conversion: [`skillsafe-ai/realesr-general-x4v3`](https://huggingface.co/skillsafe-ai/realesr-general-x4v3/tree/042a40bc4c918349ad3e2e607a68ae509a4c27b5), recipe SHA-256 `bc93d30609e3b981c4c61bec23b2c8df737241e9ed64aa99879b21949579fc4f`.
- ONNX artifact SHA-256: `a946f7a9397021b9b6b7e71df3d2821b04cc09ff244423b7ca79cb191ce4a00e`.
- The conversion maintainer reports maximum absolute CPU output error below `4.5e-6` against the pinned PyTorch checkpoint on seeded test inputs. This validates conversion parity, not perceptual quality on every image or parity with Figma's proprietary model.

The model is loaded only after the user starts **Boost resolution**. It executes on this device through ONNX Runtime WebAssembly. Image bytes are not sent to the model publisher or a processing service.
