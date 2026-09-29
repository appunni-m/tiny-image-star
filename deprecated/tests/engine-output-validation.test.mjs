import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import * as api from "../wasm/pillow_rs_js.js";
import { renderWithApi, runtimeCapabilities } from "../src/engine/pillow.js";

api.initSync({ module: await readFile(new URL("../wasm/pillow_rs_js_bg.wasm", import.meta.url)) });
const capabilities = runtimeCapabilities(api);
const fixture = JSON.parse(await readFile(new URL("fixtures/inputs/parity/engine.json", import.meta.url), "utf8"))
  .cases.find((item) => item.case_id === "TinyImageStar.Engine.renderWithApi.original");
const fileValue = fixture.steps[0].arguments.file.value;
const settings = fixture.steps[0].arguments.settings.value;
const sourceBytes = Uint8Array.from(fileValue.bytes);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function corruptDeflate(bytes) {
  const corrupted = bytes.slice();
  const view = new DataView(corrupted.buffer);
  for (let offset = 8; offset + 12 <= corrupted.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...corrupted.subarray(offset + 4, offset + 8));
    if (length > corrupted.length - offset - 12) throw new Error("invalid fixture PNG");
    if (type === "IDAT") {
      corrupted[offset + 8] = 0;
      view.setUint32(offset + 8 + length, crc32(corrupted.subarray(offset + 4, offset + 8 + length)));
      return corrupted;
    }
    offset += length + 12;
  }
  throw new Error("fixture PNG has no IDAT chunk");
}

function fixtureFile(bytes = sourceBytes) {
  return { ...fileValue, bytes };
}

test("PNG validation reuses only an unchanged, fully decoded source", async (t) => {
  await t.test("identical output fully loads the source without reopening the output", async () => {
    const originalOpen = api.Image.open;
    const originalLoad = api.Image.prototype.load;
    let opens = 0;
    let loads = 0;
    api.Image.open = function (...args) { opens += 1; return originalOpen.apply(this, args); };
    api.Image.prototype.load = function (...args) { loads += 1; return originalLoad.apply(this, args); };
    try {
      const result = await renderWithApi(api, fixtureFile(), structuredClone(settings), capabilities);
      assert.deepEqual(result.bytes, sourceBytes);
      assert.equal(opens, 1, "matching encoded bytes should avoid reopening the same PNG");
      assert.ok(loads >= 1, "the source must still be fully decoded");
    } finally {
      api.Image.open = originalOpen;
      api.Image.prototype.load = originalLoad;
    }
  });

  await t.test("corrupted encoded bytes still go through full output decoding", async () => {
    const originalSave = api.Image.prototype.saveWithInput;
    api.Image.prototype.saveWithInput = function (...args) {
      return corruptDeflate(originalSave.apply(this, args));
    };
    try {
      await assert.rejects(renderWithApi(api, fixtureFile(), structuredClone(settings), capabilities), /format unavailable/);
    } finally {
      api.Image.prototype.saveWithInput = originalSave;
    }
  });

  await t.test("malformed source deflate is rejected even when the chunk CRC is valid", async () => {
    await assert.rejects(renderWithApi(api, fixtureFile(corruptDeflate(sourceBytes)), structuredClone(settings), capabilities));
  });
});
