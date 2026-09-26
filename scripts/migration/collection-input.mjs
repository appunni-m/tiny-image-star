import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { root, exact, unique, digest } from "./spec.mjs";

export async function collectionInput(path) {
  assert.ok(path.startsWith("tests/fixtures/corpus/") && !path.split("/").includes(".."));
  const input = JSON.parse(await readFile(resolve(root, path), "utf8"));
  exact(input, "schema corpus sequence recipe random_seed"); assert.equal(input.schema, "tinystar/collection-input@1");
  assert.ok(Number.isInteger(input.random_seed) && input.random_seed > 0);
  assert.ok(input.corpus.startsWith("tests/fixtures/corpus/") && !input.corpus.split("/").includes(".."));
  const corpus = JSON.parse(await readFile(resolve(root, input.corpus), "utf8"));
  exact(corpus, "schema assets"); assert.equal(corpus.schema, "tinystar/collection-corpus@1");
  unique(corpus.assets.map((a) => a.id));
  for (const a of corpus.assets) {
    exact(a, "id path sha256 width height media_type");
    assert.match(a.id, /^[a-z0-9-]+$/); assert.match(a.sha256, /^[a-f0-9]{64}$/);
    assert.ok(a.path.startsWith("tests/fixtures/corpus/") && !a.path.split("/").includes(".."));
    assert.ok(Number.isInteger(a.width) && a.width > 0 && Number.isInteger(a.height) && a.height > 0);
    assert.ok(["image/png", "image/jpeg"].includes(a.media_type));
    assert.equal(await digest(a.path), a.sha256, `Corpus asset changed: ${a.id}`);
  }
  assert.ok(Array.isArray(input.sequence) && input.sequence.length > 0 && input.sequence.length <= 1000);
  input.sequence.forEach((id) => assert.ok(corpus.assets.some((a) => a.id === id), `Unknown asset ${id}`));
  exact(input.recipe, "name operations"); assert.equal(typeof input.recipe.name, "string");
  exact(input.recipe.operations, "format resizeWidth resizeHeight");
  assert.ok(["png", "jpeg"].includes(input.recipe.operations.format));
  for (const key of ["resizeWidth", "resizeHeight"]) assert.ok(Number.isInteger(input.recipe.operations[key]) && input.recipe.operations[key] > 0);
  return { ...input, assets: corpus.assets.filter((a) => input.sequence.includes(a.id)) };
}

export function profileConcurrency(profile) {
  const features = profile.features.filter((f) => f.startsWith("concurrency:"));
  assert.equal(features.length, 1);
  const value = features[0].split(":")[1];
  assert.ok(["auto", "1", "2", "4", "8", "16"].includes(value));
  return value === "auto" ? null : Number(value);
}
