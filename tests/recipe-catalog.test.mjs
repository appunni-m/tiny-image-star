import test from "node:test";
import assert from "node:assert/strict";
import { advanceRecipeCatalog, checkCatalogCommand, emptyRecipeCatalog, MAX_CATALOG_RECEIPTS, parseLegacyCatalog, recipeCommand, validateRecipeCatalog } from "../src/styles/catalog-model.js";

const recipe = (id = "one", name = "My recipe") => ({ id, name, operations: { format: "png", brightness: 1 } });
const hash = "a".repeat(64), otherHash = "b".repeat(64);
const put = (snapshot, value, token = null, op = crypto.randomUUID()) => recipeCommand(snapshot, "put", value, token, op);

test("legacy catalog parsing preserves complete data and fences unknown/malformed/duplicate records", () => {
  const original = [recipe()]; original[0].privateMetadata = { retained: true };
  const raw = JSON.stringify(original); assert.deepEqual(parseLegacyCatalog(raw), original); assert.deepEqual(parseLegacyCatalog(null), []);
  for (const value of ["broken", JSON.stringify({ version: 99, recipes: original }), JSON.stringify([recipe(), recipe()]),
    JSON.stringify([recipe(), null]), JSON.stringify([{ ...recipe(), operations: { run: "unknown" } }])]) assert.throws(() => parseLegacyCatalog(value), /preserved/);
  assert.equal(JSON.stringify(original), raw);
});

test("independent creates from the same snapshot merge without overwriting catalog entries", () => {
  const start = emptyRecipeCatalog(), first = put(start, recipe("first")), second = put(start, recipe("second"));
  const a = advanceRecipeCatalog(start, first, hash, "first@1"), both = advanceRecipeCatalog(a, second, otherHash, "second@1");
  assert.deepEqual(both.entries.map((entry) => entry.id), ["first", "second"]); assert.equal(both.revision, 2); assert.equal(start.entries.length, 0);
});

test("stale edits and edit/delete races cannot replace a newer version", () => {
  const start = emptyRecipeCatalog(), create = put(start, recipe()), existing = advanceRecipeCatalog(start, create, hash, "one@1");
  const edit = put(existing, recipe("one", "New name"), existing.entries[0].token), stale = put(existing, recipe("one", "Stale name"), existing.entries[0].token);
  const remove = recipeCommand(existing, "delete", "one", existing.entries[0].token);
  const edited = advanceRecipeCatalog(existing, edit, hash, "one@2");
  assert.throws(() => advanceRecipeCatalog(edited, stale, otherHash, "one@3"), { code: "CATALOG_CONFLICT" });
  assert.throws(() => advanceRecipeCatalog(edited, remove, otherHash), { code: "CATALOG_CONFLICT" });
  const deleted = advanceRecipeCatalog(existing, remove, otherHash);
  assert.throws(() => advanceRecipeCatalog(deleted, edit, hash, "one@2"), { code: "CATALOG_CONFLICT" });
});

test("a stale create cannot resurrect an ID created and then deleted since its snapshot", () => {
  const start = emptyRecipeCatalog(), stale = put(start, recipe()), created = advanceRecipeCatalog(start, put(start, recipe()), hash, "one@1");
  const removed = advanceRecipeCatalog(created, recipeCommand(created, "delete", "one", created.entries[0].token), hash);
  assert.throws(() => advanceRecipeCatalog(removed, stale, hash, "one@1"), { code: "CATALOG_CONFLICT" });
  const intentional = put(removed, recipe()); assert.equal(advanceRecipeCatalog(removed, intentional, hash, "one@1").entries.length, 1);
});

test("an exact retry is idempotent and a reused operation ID with different payload is refused", () => {
  const start = emptyRecipeCatalog(), command = put(start, recipe());
  const saved = advanceRecipeCatalog(start, command, hash, "one@1");
  assert.deepEqual(advanceRecipeCatalog(saved, command, hash, "one@1"), saved);
  assert.throws(() => checkCatalogCommand(saved, command, otherHash), { code: "CATALOG_CONFLICT" });
  const later = advanceRecipeCatalog(saved, put(saved, recipe("one", "Later"), saved.entries[0].token), otherHash, "one@2");
  assert.equal(checkCatalogCommand(later, command, hash), "replayed"); assert.deepEqual(advanceRecipeCatalog(later, command, hash, "one@1"), later);
});

test("bounded receipts reject retries older than the retained history instead of replaying them", () => {
  const start = emptyRecipeCatalog(), initial = put(start, recipe());
  let current = advanceRecipeCatalog(start, initial, hash, "one@1");
  for (let i = 0; i < MAX_CATALOG_RECEIPTS + 2; i++) current = advanceRecipeCatalog(current, put(current, recipe("one", `Edit ${i}`), current.entries[0].token), hash, `one@${i + 2}`);
  assert.equal(current.receipts.length, MAX_CATALOG_RECEIPTS);
  assert.throws(() => checkCatalogCommand(current, initial, hash), { code: "CATALOG_CONFLICT" });
});

test("clearing advances the generation so pending work from any tab cannot recreate recipes", () => {
  const command = put(emptyRecipeCatalog(), recipe());
  assert.throws(() => advanceRecipeCatalog(emptyRecipeCatalog(null, "after-clear"), command, hash, "one@1"), { code: "CATALOG_CONFLICT" });
});

test("catalog validation fences future schemas, missing histories, duplicate entries and extra fields", () => {
  const initial = emptyRecipeCatalog(), current = advanceRecipeCatalog(initial, put(initial, recipe()), hash, "one@1");
  for (const edit of [(value) => { value.version = 99; }, (value) => { value.receipts = []; }, (value) => { value.entries.push(value.entries[0]); },
    (value) => { value.future = true; }, (value) => { value.receipts[0].revision = 9; }]) {
    const value = structuredClone(current); edit(value); assert.throws(() => validateRecipeCatalog(value), /preserved/);
  }
  const id = "x".repeat(512), extended = advanceRecipeCatalog(initial, put(initial, recipe(id)), hash, `${id}@1`);
  assert.equal(extended.entries[0].id, id);
});
