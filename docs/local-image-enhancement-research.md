# Local image enhancement feasibility

Reviewed 2026-10-03 against official model repositories and ONNX Runtime Web documentation. This document records the candidate review and the remaining release evidence; model integration alone does not establish acceptable phone performance or production readiness.

## Decision

Tiny Image Star now includes an explicit local 4× resolution-boost action and saved-recipe/batch integration using the pinned Real-ESRGAN general x4v3 ONNX conversion. The model is bundled with the deployed app and loaded only when needed; inference stays in a WebAssembly worker. This clears the architecture and bounded-input/output integration gate, not the release gate: full browser workflows, output-quality comparisons, low-memory recovery, and representative Android/iOS performance remain unverified. Do not describe the operation as prompt-guided editing or promise mobile speed. Keep multi-gigabyte diffusion weights out of the default app.

## Resolution boost candidates

| Candidate | Evidence | Fit and limits |
| --- | --- | --- |
| Open Model Zoo `single-image-super-resolution-1032` | The official model card reports 0.030M parameters, 29.29 dB PSNR versus 26.79 dB for bicubic on its test set, and 11.654 GFLOPs. Its documented graph takes a fixed 480×270 image plus a 1920×1080 bicubic image and returns 1080p. | About 120 KB of FP32 weights by parameter-count calculation, but no official ONNX/browser artifact was found. This is a useful conversion baseline, not a general-resolution photo-restoration product; its published metric does not establish perceptual quality on user images. Verify the weight license separately before distribution. |
| Real-ESRGAN `RealESRGAN_x4plus` | The official model zoo describes it as a general-image 4× model. The official inference entry point uses a 23-block RRDBNet and has tile-size/padding controls for reducing peak inference memory. The repository code is BSD-3-Clause; its release provides a PyTorch checkpoint of roughly 64 MiB. | Best researched candidate for photo restoration, but upstream does not provide an official ONNX/WASM package. Export, operator compatibility, quantization, tile seams, alpha behavior, output memory, and phone latency remain to be proven. Audit the checkpoint terms separately from the code license before shipping weights. |
| Real-ESRGAN `realesr-general-x4v3` | The official model zoo calls this a smaller general-image model that uses less GPU memory and time, with weaker deblur and denoise capability. Its inference script supports tiling and variable output scale. | A promising lower-cost comparison candidate. The upstream evidence is for its own inference stack, not ONNX Runtime Web or mobile CPU; weight size and browser speed still need measurement. |

Primary references: [Open Model Zoo model card](https://github.com/openvinotoolkit/open_model_zoo/blob/master/models/intel/single-image-super-resolution-1032/README.md), [Real-ESRGAN model zoo](https://github.com/xinntao/Real-ESRGAN/blob/master/docs/model_zoo.md), [official tiled inference script](https://github.com/xinntao/Real-ESRGAN/blob/master/inference_realesrgan.py), [Real-ESRGAN code license](https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE), and [checkpoint release](https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.1.0).

## Runtime and safety constraints

ONNX Runtime Web documents WASM as the CPU provider and recommends it for very small models or environments without a supported GPU. CPU inference should prefer uint8 quantized weights when available; float16 is not native to CPU and may be slow. WASM threading depends on cross-origin isolation. WebGPU can accelerate heavier models on supported browsers, but it cannot be the only path: the current ONNX Runtime browser matrix does not list WebGPU on iOS browsers. These are runtime capabilities, not model-specific latency promises. See [ONNX Runtime Web performance guidance](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html), [deployment guidance](https://onnxruntime.ai/docs/tutorials/web/deploy.html), and [browser support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/web.html).

Upscaling by 4× in each dimension creates 16× as many output pixels. A 1-megapixel input becomes 16 megapixels: an RGBA8 output alone is about 64 MiB, and a three-channel float32 output tensor is about 192 MiB before model activations, source buffers, and the editor's retained previews. Tiling can bound intermediate activations but does not make the final full-resolution image free. Any implementation must therefore have explicit source-pixel, output-pixel, tile, and memory admission limits; serialize model inference within the shared worker budget; support cancellation that drains the worker before releasing buffers; and leave the original asset recoverable.

## Reproducible ONNX/WASM probe

The upstream Real-ESRGAN v0.3.0 release adds the tiny `realesr-general-x4v3` model and warns that its performance may be limited; the model zoo describes it as a general-scene model with weaker deblur and denoise than the larger models. A community ONNX conversion is available from [SkillSafe AI](https://huggingface.co/skillsafe-ai/realesr-general-x4v3); the tested FP32 file was 4,866,428 bytes with SHA-256 `a946f7a9397021b9b6b7e71df3d2821b04cc09ff244423b7ca79cb191ce4a00e`. The official release describes the x4v3 model as small and multi-scale, while the converted model card reports dynamic NCHW input and x4 output. Treat the conversion and its claims as a candidate artifact, not as an upstream release. See the [v0.3.0 release](https://github.com/xinntao/Real-ESRGAN/releases) and [official model zoo](https://github.com/xinntao/Real-ESRGAN/blob/master/docs/model_zoo.md).

The reproducible [single-thread WASM probe](../scripts/research/super-resolution-wasm-probe.mjs) uses the project's pinned `onnxruntime-web` package. Run it with a local model path; it verifies finite outputs, x4 shapes, median inference time after warmup, artifact hash, and process RSS. On 2026-10-02, Node 24.18.0 on macOS arm64, one WASM thread, 32-pixel warmup, and two measured runs per size produced:

| Input | Output | Median inference | Process RSS after run |
| ---: | ---: | ---: | ---: |
| 64 × 64 | 256 × 256 | 217 ms | 211 MiB |
| 128 × 128 | 512 × 512 | 865 ms | 221 MiB |
| 256 × 256 | 1,024 × 1,024 | 3.52 s | 286 MiB |
| 384 × 384 | 1,536 × 1,536 | 7.91 s | 396 MiB |

This is a WASM operator/shape smoke and a CPU sizing warning, not an image-quality, browser, or device benchmark. It excludes decode, tile overlap, alpha restoration, preview replacement, and output encoding. At this single-thread speed, extrapolating from the 256- and 384-pixel runs suggests roughly 54 seconds per megapixel of source on this host; that extrapolation is diagnostic only. The run also increased process RSS from 59 MiB before session creation to 396 MiB after the largest input. The probe is not a performance benchmark for the integrated tiled path, and it is not evidence that large-image or bulk use is acceptable on phones.

## Remaining release gate

1. Compare the pinned ONNX output with the upstream model on deterministic real-photo patches; measure perceptual quality and visible tile seams, not only tensor tolerance.
2. Measure cold and warm startup, peak memory, and end-to-end latency on desktop and representative Android/iOS devices using the deployed browser worker. The current desktop WASM probe is only a CPU sizing warning; it is not a mobile benchmark.
3. Verify cancellation, tab changes, reload, quota failure, undo, recipe retry, and large-batch behavior through the complete browser workflow, then repeat on low-memory phones.
4. Keep the current input/output caps and serialized AI lane until those measurements justify changing them. WebGPU remains an optional experiment and must not replace the CPU/WASM path.

Until this gate passes, describe resolution boost as an available local feature with explicit size limits, not as production-validated mobile performance. A bicubic enlargement may be labeled separately but must not be presented as recovered detail.

## Prompt-guided editing and generation

Figma Design's current image workflow can generate a new image from a text prompt, edit an image with a prompt and optional reference images, and boost resolution; see [Figma's image AI documentation](https://help.figma.com/hc/en-us/articles/24004542669463-Generate-and-edit-images-with-Figma-AI). No production-suitable, distributable phone/WASM model for prompt-guided image editing or generation has passed this research gate. New on-device and open-weight releases improve the research landscape, but they do not yet meet this app's combined licensing, browser-runtime, and memory requirements:

| Candidate | Primary-source evidence | Why it does not meet this app's gate |
| --- | --- | --- |
| DreamLite | Official project reports a 0.39B model and four-step 1024 × 1024 editing at about three seconds on an iPhone 17 Pro. The mobile path uses 4-bit Qwen-VL plus fp16 VAE/UNet and documents Core ML + MLX deployment. | Checkpoints are gated and restricted to non-commercial research use; public redistribution is prohibited. The iPhone result does not prove browser/WASM execution. |
| Mobile-O | Official project describes a Qwen2-0.5B vision-language component, a 512 × 512 diffusion decoder, and a sub-2-GB native iOS footprint. | Models, source, and app are CC BY-NC-SA 4.0, with commercial use prohibited. Its released deployment is MLX/Core ML; no official ONNX/WebAssembly browser path is documented. |
| Boogu-Image-0.1 Edit-Turbo | Official repository describes Apache-2.0 image editing, a four-step distilled variant, and 1K output. | The edit family has 10B parameters and the documented inference stack targets PyTorch/CUDA. Apache-2.0 licensing does not make this a phone/WASM-sized model. |

**Inference from these primary sources:** none of these candidates currently satisfies all three requirements: a license suitable for Tiny Image Star distribution, an official browser/WASM runtime artifact, and representative mobile latency/memory. See the [DreamLite repository](https://github.com/ByteVisionLab/DreamLite), [Mobile-O repository](https://github.com/Amshaker/Mobile-O), and [Boogu-Image repository](https://github.com/boogu-project/Boogu-Image).

ONNX Runtime Web lists WebAssembly as available across its supported desktop and mobile browser matrix, while its WebGPU matrix excludes Safari and iOS Chrome. The current prompt-edit candidates above do not provide official ONNX/WASM graphs, so exporting them would be a separate conversion project and would still run on the much slower CPU path on iOS. See the [official ONNX Runtime Web support table](https://onnxruntime.ai/docs/get-started/with-javascript/web.html).

Stable Diffusion inpainting checkpoints and full pipelines are multi-gigabyte; mobile GPU support is not universal, while CPU/WASM diffusion has high cold-start, memory, and latency risk. MI-GAN already used for erasing/expansion is not prompt-conditioned and is not a substitute. Keep prompt editing out of the core path until a smaller, distributable model pack has a verified license, output quality, local-only behavior, and target-device performance. An experimental optional model pack must not change the normal offline editor's download or memory footprint. No weights from these candidates have been added to the deployment.

The broader Figma comparison is recorded in the [design-editor parity ledger](design-editor-parity.md); Figma's currently documented image tools include prompt editing and resolution boost, while this project must meet a stricter local-processing constraint. No prompt-generation or prompt-edit model weights have been added to the deployment.
