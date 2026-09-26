import test from "node:test";
import assert from "node:assert/strict";
import { createLargeJob } from "../src/jobs/core.js";
import { ENGINE_IDENTITY } from "../src/project/model.js";
import { assertFolderContract, assertFolderRecipe, folderRecipeDigest } from "../src/jobs/render-contract.js";

const job = () => createLargeJob({ id: "folder", recipe: { id: "recipe", name: "Caption", operations: { format: "png", brightness: 1 } } });
const font = (id, bytes = 1024) => ({ id: `font-${id.toString(16).padStart(16,"0")}`, sha256: "a".repeat(64), byteLength: bytes });

test("new folder jobs pin the renderer without sharing mutable contract objects", () => {
  const a = job(), b = job();
  assert.equal(a.version, 2); assert.equal(assertFolderContract(a).recipeSha256, null);
  a.renderContract.engine.version = "changed";
  assert.deepEqual(assertFolderContract(b).engine, ENGINE_IDENTITY);
  assert.throws(() => assertFolderContract(a), /different renderer/);
});

test("older and unknown contracts remain identifiable instead of silently adopting this renderer", () => {
  assert.throws(() => assertFolderContract(null), /no longer available/);
  const old = job(); old.version = 1; delete old.renderContract;
  assert.throws(() => assertFolderContract(old), /predates frozen rendering/);
  for (const patch of [{ schema: "future" }, { unexpected: true }, { recipeSha256: "bad" }, { fonts: null }, { fonts: [font(1)] }]) {
    const value = job(); Object.assign(value.renderContract, patch);
    assert.throws(() => assertFolderContract(value));
  }
});

test("recipe hashes are canonical and include actual text and all recipe parameters", async () => {
  assert.equal(await folderRecipeDigest({ a: 1, b: { c: 2, d: 3 } }), await folderRecipeDigest({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(await folderRecipeDigest({ text: "Trip" }), await folderRecipeDigest({ text: "Trip!" }));
  await assert.rejects(() => folderRecipeDigest({ text: "あ".repeat(800_000) }), /too large/);
});

test("both stale queued edits and altered persisted recipes fail against the frozen identity", async () => {
  const value = job(); value.renderContract.recipeSha256 = await assertFolderRecipe(value);
  await assertFolderRecipe(value);
  await assert.rejects(() => assertFolderRecipe(value, { ...value.recipe, name: "Changed" }), /queued recipe/);
  value.recipe.operations.brightness = 1.2;
  await assert.rejects(() => assertFolderRecipe(value), /changed after processing began/);
});

test("font snapshots enforce unique identities, exact fields and per-font and total bounds", () => {
  const value = job(); value.renderContract.recipeSha256 = "b".repeat(64);
  for (const invalid of [[font(1,0)], [font(1,16*1024*1024+1)], [font(1),font(1)],
    Array.from({ length: 9 }, (_,i) => font(i)), [font(1,16*1024*1024),font(2,16*1024*1024),font(3)],
    [{ ...font(1), sha256: "bad" }], [{ ...font(1), url: "https://invalid.example/font" }]]) {
    value.renderContract.fonts = invalid; assert.throws(() => assertFolderContract(value));
  }
  value.renderContract.fonts = [font(1,16*1024*1024),font(2,16*1024*1024)];
  assert.equal(assertFolderContract(value).fonts.length, 2);
});
