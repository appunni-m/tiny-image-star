import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import * as api from "../wasm/pillow_rs_js.js";
import { renderWithApi, runtimeCapabilities } from "../src/engine/pillow.js";

api.initSync({ module: await readFile(new URL("../wasm/pillow_rs_js_bg.wasm", import.meta.url)) });
const capabilities = runtimeCapabilities(api);
const bytes = Buffer.from((await readFile(new URL("fixtures/rgb-small.png.base64", import.meta.url), "utf8")).trim(), "base64");
test("opt-in timing observations preserve complete PNG/JPEG outputs and ordinary result shape", async () => {
  for (const format of ["png", "jpeg"]) {
    const file = { name: "sample.png", bytes }, settings = { format, brightness: 1, contrast: 1, maxWidth: 4, maxHeight: 4 };
    const ordinary = await renderWithApi(api, file, settings, capabilities);
    const { diagnostics, ...observed } = await renderWithApi(api, { ...file, diagnostics: true }, settings, capabilities);
    assert.deepEqual(observed, ordinary);
    assert.equal(diagnostics.schema, "tinystar/render-timings@1");
    assert.deepEqual(Object.keys(diagnostics).sort(), ["materializeEncodeMs", "outputValidationMs", "pipelineSetupMs", "schema"]);
    for (const key of ["materializeEncodeMs", "outputValidationMs", "pipelineSetupMs"]) assert.ok(Number.isFinite(diagnostics[key]) && diagnostics[key] >= 0);
    assert.deepEqual(await renderWithApi(api, { ...file, diagnostics: "true" }, settings, capabilities), ordinary, "only an explicit boolean opts in");
  }
});
