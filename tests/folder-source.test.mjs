import test from "node:test";
import assert from "node:assert/strict";
import { FOLDER_SOURCE_SCHEMA, assertSourceIdentity, bindSourceIdentity, assertSourceDigest } from "../src/jobs/source-contract.js";

const identity = (sha256 = "a".repeat(64)) => ({ schema: FOLDER_SOURCE_SCHEMA, sha256, bytes: 70, lastModified: 7 });
const entry = () => ({ sourceBytes: 70, lastModified: 7, status: "processing" });

test("source identities reject unknown fields, malformed digests and unbounded metadata", () => {
  for (const value of [null, {}, { ...identity(), sha256: "x" }, { ...identity(), bytes: -1 },
    { ...identity(), bytes: Number.MAX_SAFE_INTEGER + 1 }, { ...identity(), lastModified: NaN },
    { ...identity(), path: "other.png" }, { ...identity(), schema: "future" }]) assert.throws(() => assertSourceIdentity(value));
  assert.equal(assertSourceIdentity(identity()).bytes, 70);
});

test("first inspection binds immutable content, including replacements with identical metadata", () => {
  const before = entry(), observed = identity(), bound = bindSourceIdentity(before, observed);
  observed.sha256 = "b".repeat(64);
  assert.equal(before.sourceIdentity, undefined); assert.equal(bound.sourceIdentity.sha256, identity().sha256);
  assert.throws(() => bindSourceIdentity(bound, observed), /source changed/);
  assert.throws(() => bindSourceIdentity(before, { ...identity(), bytes: 71 }), /source changed/);
  assertSourceDigest(bound, identity().sha256);
  assert.throws(() => assertSourceDigest(bound, observed.sha256), /source changed/);
});

test("explicit failed retry accepts one repair and never changes a journaled source", () => {
  const bound = bindSourceIdentity(entry(), identity()), repaired = { ...identity("b".repeat(64)), bytes: 90, lastModified: 9 };
  const accepted = bindSourceIdentity({ ...bound, allowSourceChange: true }, repaired);
  assert.equal(accepted.allowSourceChange, false); assert.equal(accepted.sourceBytes, 90); assert.equal(accepted.lastModified, 9);
  assert.throws(() => bindSourceIdentity(accepted, identity()), /source changed/);
  const journaled = { ...bound, allowSourceChange: true, outputIntent: { sourceDigest: identity().sha256 } };
  assert.throws(() => bindSourceIdentity(journaled, repaired), /save began/);
  assert.equal(bindSourceIdentity(journaled, { ...identity(), lastModified: 8 }).sourceIdentity.lastModified, 8);
});
