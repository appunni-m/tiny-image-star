# ISNet background-removal model notice

The bundled `isnet-general-use-q8.onnx` is a dynamic-int8 ONNX conversion of the ISNet general-use model from the official [DIS repository](https://github.com/xuebinqin/DIS), source revision `b6764e20381f6f42a70f83fa3324181529ed1403`, distributed by the [Ko033 Transformers.js model repository](https://huggingface.co/Ko033/isnet-general-use-onnx) at revision `5349b617911fd60c619b52f32e2b593517b78df3`.

The source model and architecture are licensed under Apache-2.0. The separately converted ONNX artifact is provided under the same model license; see [ISNET-DIS-LICENSE.txt](ISNET-DIS-LICENSE.txt). The conversion repository documents its input as `float32 [1, 3, height, width]`, normalized as `pixel / 255 - 0.5`, and its output as a `float32 [1, 1, height, width]` foreground-confidence map. Tiny Image Star runs the model locally through ONNX Runtime WebAssembly; source images are not uploaded.

The upstream research project notes that general-use segmentation quality varies by subject category. The result is an editable local mask preview and should be reviewed before production export.
