import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectionInput, profileConcurrency } from "./collection-input.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const manifestPath = "tests/fixtures/manifest.yaml";
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
export const digest = async (path) => sha256(await readFile(resolve(root, path)));
export const exact = (value, keys, label = "object") => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label}: expected object`);
  assert.deepEqual(Object.keys(value).sort(), keys.split(" ").filter(Boolean).sort(), `${label}: unknown or missing field`);
};
export function unique(values, label = "IDs") {
  assert.ok(Array.isArray(values), `${label}: expected array`);
  assert.equal(new Set(values).size, values.length, `${label}: duplicates`);
  return values;
}
function path(value) {
  assert.equal(typeof value, "string");
  assert.ok(value && !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), `unsafe path: ${value}`);
}
const nonempty = (value) => assert.ok(typeof value === "string" && value.length > 0);
const refs = (values, registry) => unique(values).forEach((id) => assert.ok(registry.has(id), `unknown reference: ${id}`));
const registry = (items) => { unique(items.map((item) => item.id)); return new Map(items.map((item) => [item.id, item])); };

// Fixed contract, deliberately limited to the exact-comparison JS/WASM slice.
// Unsupported variants fail instead of being silently normalized or ignored.
export function validateManifest(m) {
  exact(m, "schema scope oracles targets target_profiles commands interfaces input_index coverage_components surfaces documentation", "manifest");
  assert.equal(m.schema, "migration-parity/manifest@2");
  exact(m.scope, "id mode inventory");
  assert.ok(["slice", "full"].includes(m.scope.mode));
  exact(m.scope.inventory, "authority revision command_id");
  Object.values(m.scope.inventory).forEach(nonempty);
  const commands = registry(m.commands);
  for (const c of m.commands) {
    exact(c, "id argv cwd timeout_seconds"); path(c.cwd);
    assert.ok(Array.isArray(c.argv) && c.argv.length); c.argv.forEach(nonempty);
    assert.ok(Number.isInteger(c.timeout_seconds) && c.timeout_seconds > 0);
  }
  refs([m.scope.inventory.command_id], commands);
  const oracles = registry(m.oracles), targets = registry(m.targets), profiles = registry(m.target_profiles);
  for (const o of m.oracles) {
    exact(o, "id name version runtime identity_command_id contract components");
    [o.name, o.version, o.runtime, o.contract].forEach(nonempty); refs([o.identity_command_id], commands);
    for (const c of o.components) { exact(c, "id name version"); Object.values(c).forEach(nonempty); }
  }
  for (const t of m.targets) {
    exact(t, "id name runtime identity_command_id contract");
    [t.name, t.runtime, t.contract].forEach(nonempty); refs([t.identity_command_id], commands);
  }
  for (const p of m.target_profiles) { exact(p, "id target_id backend features"); refs([p.target_id], targets); nonempty(p.backend); unique(p.features); }
  exact(m.interfaces, "parity coverage benchmark aggregation");
  exact(m.input_index, "parity coverage benchmark");
  for (const lane of ["parity", "coverage", "benchmark"]) {
    const i = m.interfaces[lane]; exact(i, "input_schema result_schema command_id");
    assert.equal(i.input_schema, `migration-parity/${lane}-input@1`); assert.equal(i.result_schema, `migration-parity/${lane}-result@1`);
    refs([i.command_id], commands); unique(m.input_index[lane]).forEach((p) => { path(p); assert.ok(p.startsWith(`inputs/${lane}/`)); });
  }
  exact(m.interfaces.aggregation, "input_schemas result_schema command_id");
  assert.deepEqual(m.interfaces.aggregation.input_schemas, ["parity", "coverage", "benchmark"].map((l) => `migration-parity/${l}-result@1`));
  assert.equal(m.interfaces.aggregation.result_schema, "migration-parity/status-report@1"); refs([m.interfaces.aggregation.command_id], commands);
  const components = registry(m.coverage_components);
  for (const c of m.coverage_components) {
    exact(c, "id target_profile paths dimensions thresholds"); refs([c.target_profile], profiles); unique(c.paths).forEach(path);
    assert.deepEqual(c.dimensions, ["function"], "this collector supports function coverage only");
    c.thresholds.forEach((t) => { exact(t, "dimension minimum_percent"); assert.equal(t.dimension, "function"); assert.ok(t.minimum_percent >= 0 && t.minimum_percent <= 100); });
  }
  const operations = new Map(), requirements = new Map();
  registry(m.surfaces);
  for (const s of m.surfaces) {
    exact(s, "id kind source_path storage_slug operations"); assert.equal(s.kind, "namespace"); path(s.source_path); nonempty(s.storage_slug);
    registry(s.operations);
    for (const o of s.operations) {
      exact(o, "id kind classification lifecycle source targets requirements parity coverage benchmark");
      assert.equal(o.kind, "function"); assert.equal(o.classification, "endpoint"); exact(o.lifecycle, "status"); assert.equal(o.lifecycle.status, "current");
      const key = `${s.id}.${o.id}`; assert.ok(!operations.has(key)); operations.set(key, o);
      exact(o.source, "oracle_id path signature parameters result"); refs([o.source.oracle_id], oracles); nonempty(o.source.path); nonempty(o.source.signature);
      registry(o.source.parameters);
      for (const p of o.source.parameters) {
        exact(p, "id style value_types omission"); assert.equal(p.style, "positional"); assert.deepEqual(p.value_types, ["record"]);
        if (p.omission.kind === "required") exact(p.omission, "kind");
        else { exact(p.omission, "kind value"); assert.equal(p.omission.kind, "literal"); assert.ok(p.omission.value && typeof p.omission.value === "object"); }
      }
      const result = o.source.result; exact(result, "shape observations error"); assert.equal(result.shape, "record");
      assert.equal(result.observations.length, 1);
      for (const v of result.observations) { exact(v, "path value_types comparison"); assert.equal(v.path, "value"); assert.deepEqual(v.value_types, ["record"]); exact(v.comparison, "kind"); assert.equal(v.comparison.kind, "exact"); }
      exact(result.error, "fields message"); assert.deepEqual(result.error.fields, ["class", "kind", "message", "stage", "code"]);
      assert.deepEqual(result.error.message, { mode: "exact", transforms: [], reason: null });
      assert.equal(o.targets.length, targets.size);
      for (const t of o.targets) { exact(t, "target_id path signature support"); refs([t.target_id], targets); nonempty(t.path); nonempty(t.signature); exact(t.support, "status"); assert.equal(t.support.status, "supported"); }
      for (const r of o.requirements) {
        exact(r, `id dimension description lanes target_profiles${r.budget ? " budget" : ""}`);
        assert.ok(!requirements.has(r.id)); requirements.set(r.id, { ...r, operation: key });
        assert.ok(["input_family", "error_path", "performance"].includes(r.dimension)); nonempty(r.description);
        refs(r.lanes, new Map(["parity", "coverage", "benchmark"].map((l) => [l, true]))); refs(r.target_profiles, profiles);
        if (r.budget) {
          exact(r.budget, "kind metric statistic operator value unit baseline_subject");
          assert.equal(r.budget.kind, "relative"); assert.equal(r.budget.metric, "latency"); assert.equal(r.budget.statistic, "median");
          assert.equal(r.budget.operator, "less_than_or_equal"); assert.equal(r.budget.unit, "ratio"); assert.ok(r.budget.value > 0); refs([r.budget.baseline_subject], new Map([...oracles, ...profiles]));
        }
      }
      for (const lane of ["parity", "coverage", "benchmark"]) {
        const p = o[lane];
        if (p.applicability === "not_applicable") { exact(p, "applicability reason"); nonempty(p.reason); assert.ok(!o.requirements.some((r) => r.lanes.includes(lane))); }
        else {
          exact(p, `applicability target_profiles${lane === "coverage" ? " component_ids" : lane === "benchmark" ? " metrics" : ""}`);
          assert.equal(p.applicability, "required"); refs(p.target_profiles, profiles);
          for (const profile of p.target_profiles) assert.ok(o.requirements.some((r) => r.lanes.includes(lane) && r.target_profiles.includes(profile)));
          if (lane === "coverage") refs(p.component_ids, components);
          if (lane === "benchmark") assert.deepEqual(p.metrics, ["latency", "throughput"]);
        }
      }
    }
  }
  exact(m.documentation, "command_id specification_outputs evidence_outputs"); refs([m.documentation.command_id], commands);
  [...m.documentation.specification_outputs, ...m.documentation.evidence_outputs].forEach(path);
  return { commands, oracles, targets, profiles, components, operations, requirements };
}

export function validateInputs(m, docs) {
  const index = validateManifest(m), cases = [], plans = [], workloads = [];
  for (const doc of docs.parity) {
    exact(doc, "schema cases"); assert.equal(doc.schema, m.interfaces.parity.input_schema);
    for (const c of doc.cases) {
      exact(c, "case_id surface operation covers target_profiles assets steps observations");
      refs(c.target_profiles, index.profiles); refs(c.covers, index.requirements); assert.ok(c.case_id.startsWith(`${c.surface}.${c.operation}.`));
      assert.deepEqual(c.assets, [], "this slice stores literal byte inputs");
      const seen = new Set();
      for (const s of c.steps) {
        exact(s, "step_id surface operation receiver arguments"); assert.equal(s.receiver, null); assert.ok(!seen.has(s.step_id)); seen.add(s.step_id);
        const op = index.operations.get(`${s.surface}.${s.operation}`); assert.ok(op, "unknown operation");
        const params = registry(op.source.parameters);
        for (const [name, v] of Object.entries(s.arguments)) {
          assert.ok(params.has(name), `unknown parameter: ${name}`); exact(v, "kind value"); assert.equal(v.kind, "literal");
          assert.ok(v.value && typeof v.value === "object" && !Array.isArray(v.value), "record argument required");
        }
        for (const p of params.values()) if (p.omission.kind === "required") assert.ok(p.id in s.arguments, `missing parameter: ${p.id}`);
        exact(s.arguments.api.value, "module"); assert.equal(s.arguments.api.value.module, "PillowBrowserApi");
        exact(s.arguments.file.value, "name bytes"); nonempty(s.arguments.file.value.name);
        assert.ok(Array.isArray(s.arguments.file.value.bytes) && s.arguments.file.value.bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255));
      }
      unique(c.observations).forEach((id) => assert.ok(seen.has(id), "unknown observed step"));
      const observed = new Set(c.steps.filter((s) => c.observations.includes(s.step_id)).map((s) => `${s.surface}.${s.operation}`));
      assert.ok(observed.has(`${c.surface}.${c.operation}`));
      for (const id of c.covers) { const r = index.requirements.get(id); assert.ok(r.lanes.includes("parity") && observed.has(r.operation)); }
      cases.push(c);
    }
  }
  const caseMap = new Map(cases.map((c) => [c.case_id, c])); unique(cases.map((c) => c.case_id));
  for (const doc of docs.coverage) {
    exact(doc, "schema plans"); assert.equal(doc.schema, m.interfaces.coverage.input_schema);
    for (const p of doc.plans) {
      exact(p, "plan_id covers target_profile selectors component_ids command_id"); exact(p.selectors, "parity_case_ids command_ids");
      refs(p.covers, index.requirements); refs([p.target_profile], index.profiles); refs([p.command_id, ...p.selectors.command_ids], index.commands);
      refs(p.selectors.parity_case_ids, caseMap); refs(p.component_ids, index.components);
      for (const id of p.covers) assert.ok(index.requirements.get(id).lanes.includes("coverage") && p.selectors.parity_case_ids.some((c) => caseMap.get(c).covers.includes(id)));
      plans.push(p);
    }
  }
  for (const doc of docs.benchmark) {
    exact(doc, "schema workloads suites"); assert.equal(doc.schema, m.interfaces.benchmark.input_schema); assert.deepEqual(doc.suites, []);
    for (const w of doc.workloads) {
      exact(w, "workload_id covers subjects input measurement"); refs(w.covers, index.requirements);
      for (const s of w.subjects) { exact(s, "kind id"); assert.ok(["oracle", "target_profile"].includes(s.kind)); refs([s.id], s.kind === "oracle" ? index.oracles : index.profiles); }
      if (w.input.kind === "parity_case") {
        exact(w.input, "kind case_id"); refs([w.input.case_id], caseMap);
        for (const id of w.covers) assert.ok(caseMap.get(w.input.case_id).covers.includes(id));
      } else {
        exact(w.input, "kind command_id"); assert.equal(w.input.kind, "command"); refs([w.input.command_id], index.commands);
        const command = index.commands.get(w.input.command_id);
        assert.deepEqual(command.argv.slice(0, 2), ["node", "scripts/migration/browser-collection.mjs"]); assert.equal(command.argv.length, 3);
        assert.equal(command.cwd, "."); path(command.argv[2]);
        for (const subject of w.subjects) { assert.equal(subject.kind, "target_profile"); profileConcurrency(index.profiles.get(subject.id)); }
      }
      for (const id of w.covers) assert.ok(index.requirements.get(id).lanes.includes("benchmark"));
      const v = w.measurement; exact(v, "boundary step_ids metrics warmup_iterations measurement_iterations samples concurrency cache_state correctness_gate");
      assert.equal(v.boundary, "whole_workflow"); assert.deepEqual(v.step_ids, []); assert.deepEqual(v.metrics, ["latency", "throughput"]);
      for (const k of ["warmup_iterations", "measurement_iterations", "samples", "concurrency"]) assert.ok(Number.isInteger(v[k]) && v[k] >= (k === "warmup_iterations" ? 0 : 1));
      assert.equal(v.concurrency, 1);
      if (w.input.kind === "parity_case") { assert.equal(v.cache_state, "warm"); assert.equal(v.correctness_gate, "parity_pass"); }
      else {
        assert.ok(["cold", "warm"].includes(v.cache_state)); assert.equal(v.correctness_gate, "successful_execution");
        assert.equal(v.warmup_iterations, v.cache_state === "cold" ? 0 : 1); assert.equal(v.measurement_iterations, 1); assert.ok(v.samples >= 5);
      }
      workloads.push(w);
    }
  }
  unique([...cases.map((c) => c.case_id), ...plans.map((p) => p.plan_id), ...workloads.map((w) => w.workload_id)]);
  for (const lane of ["parity", "coverage", "benchmark"]) for (const r of index.requirements.values()) if (r.lanes.includes(lane)) {
    const items = lane === "parity" ? cases : lane === "coverage" ? plans : workloads;
    for (const profile of r.target_profiles) assert.ok(items.some((i) => i.covers.includes(r.id)
      && (lane === "benchmark" ? i.subjects.some((s) => s.kind === "target_profile" && s.id === profile)
        : lane === "parity" ? i.target_profiles.includes(profile) : i.target_profile === profile)), `unmapped ${lane} requirement: ${r.id}/${profile}`);
  }
  return { ...index, cases, plans, workloads };
}

async function inputFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await inputFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) output.push(relative(resolve(root, "tests/fixtures"), full));
    else throw new Error(`Unexpected input entry: ${full}`);
  }
  return output.sort();
}

export async function loadSpec() {
  const manifest = await json(manifestPath), docs = {}, inputs = [];
  validateManifest(manifest);
  for (const lane of ["parity", "coverage", "benchmark"]) {
    assert.deepEqual(await inputFiles(resolve(root, `tests/fixtures/inputs/${lane}`)), [...manifest.input_index[lane]].sort(), "input index bijection");
    docs[lane] = [];
    for (const p of manifest.input_index[lane]) {
      const full = `tests/fixtures/${p}`, doc = await json(full); docs[lane].push(doc);
      inputs.push({ path: full, schema: doc.schema, sha256: await digest(full) });
    }
  }
  const index = validateInputs(manifest, docs);
  const assets = [], collections = new Map();
  for (const w of index.workloads.filter((w) => w.input.kind === "command")) {
    const p = index.commands.get(w.input.command_id).argv[2], input = await collectionInput(p);
    collections.set(w.workload_id, input);
    const docIndex = docs.benchmark.findIndex((d) => d.workloads.includes(w)); assert.ok(docIndex >= 0);
    const inputPath = `tests/fixtures/${manifest.input_index.benchmark[docIndex]}`;
    for (const a of [{ id: "command-input", path: p }, { id: "corpus", path: input.corpus }, ...input.assets]) {
      assets.push({ input_path: inputPath, item_id: w.workload_id, asset_id: a.id, kind: "ref", locator: a.path, sha256: await digest(a.path) });
    }
  }
  const source = await readFile(resolve(root, "tests/oracles/legacy/src/engine/pillow.js"), "utf8");
  const inventory = [...source.matchAll(/export (?:async )?function (\w+)\(api, file\b/g)].map((m) => m[1]).sort();
  assert.deepEqual(manifest.surfaces.flatMap((s) => s.operations.map((o) => o.id)).sort(), inventory, "public inventory bijection");
  return { manifest, docs, inputs, assets, collections, inventory, ...index };
}
