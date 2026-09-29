import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { cpus, totalmem, platform, release, arch } from "node:os";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { root, manifestPath, loadSpec, validateManifest, validateInputs, exact, unique, digest, json, sha256 } from "./spec.mjs";
import { implementation } from "./execute.mjs";
import { chromium } from "playwright";
import { validateCollectionSamples } from "./collection-evidence.mjs";

const outputRoot = ".migration-results";
let activeIdentity;
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
async function tree(directory) {
  const files = [];
  for (const e of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const p = `${directory}/${e.name}`;
    if (e.isDirectory()) files.push(...await tree(p));
    else if (e.isFile()) files.push(p);
    else throw new Error(`Unexpected non-regular input ${p}`);
  }
  return files.sort();
}
let browserRuntimeIdentity;
async function targetIdentity(profile = { id: "node-wasm", target_id: "app-engine", backend: "wasm-cpu", features: ["png"] }) {
  const paths = [...await tree("src"), ...await tree("scripts/migration"), "wasm/pillow_rs_js.js", "wasm/pillow_rs_js_bg.wasm", "package-lock.json"];
  const hashes = [];
  for (const p of paths) hashes.push([p, await digest(p)]);
  if (profile.id !== "node-wasm" && !browserRuntimeIdentity) browserRuntimeIdentity = (async () => `Playwright ${(await json("node_modules/playwright/package.json")).version}; Chromium executable SHA-256 ${sha256(await readFile(chromium.executablePath()))}`)();
  return { target_profile: profile.id, target_id: profile.target_id, revision: `${git("rev-parse", "HEAD")}:${sha256(JSON.stringify(hashes))}`,
    dirty: Boolean(git("status", "--porcelain")), runtime: profile.id === "node-wasm" ? process.version : await browserRuntimeIdentity, backend: profile.backend, features: profile.features };
}
function laneProfiles(spec, lane) {
  const ids = lane === "parity" ? spec.cases.flatMap((c) => c.target_profiles) : lane === "coverage" ? spec.plans.map((p) => p.target_profile)
    : spec.workloads.flatMap((w) => w.subjects.filter((s) => s.kind === "target_profile").map((s) => s.id));
  return [...new Set(ids)].map((id) => spec.profiles.get(id));
}
async function identity(spec, lane, runId, started) {
  const targets = await Promise.all(laneProfiles(spec, lane).map(targetIdentity));
  const manifestDigest = await digest(manifestPath);
  if (activeIdentity) {
    assert.deepEqual(targets, activeIdentity.targets, "Target or measurement code changed during execution");
    assert.equal(manifestDigest, activeIdentity.manifest, "Manifest changed during execution");
    for (const input of spec.inputs) assert.equal(await digest(input.path), input.sha256, "Input changed during execution");
    for (const asset of spec.assets) assert.equal(await digest(asset.locator), asset.sha256, "Corpus changed during execution");
  }
  return { run_id: runId, started_at: started, finished_at: new Date().toISOString(),
    manifest: { path: manifestPath, schema: spec.manifest.schema, sha256: manifestDigest },
    inputs: spec.inputs, assets: spec.assets, oracles: spec.manifest.oracles.map((o) => ({ oracle_id: o.id, name: o.name, version: o.version, runtime: process.version })),
    targets, command: { command_id: lane, ...Object.fromEntries(Object.entries(spec.commands.get(lane)).filter(([k]) => k !== "id")) } };
}
function invoke(spec, subject, cases, options = {}) {
  const request = { subject, cases, operations: spec.manifest.surfaces.flatMap((s) => s.operations), benchmark: options.benchmark ?? null };
  const output = execFileSync(process.execPath, ["scripts/migration/execute.mjs", "worker"], {
    cwd: root, input: JSON.stringify(request), encoding: "utf8", timeout: 300000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, TZ: "UTC", LANG: "C", ...(options.coverage ? { NODE_V8_COVERAGE: resolve(root, options.coverage) } : {}) },
  });
  return JSON.parse(output);
}
export function validateWorkflow(value, c) {
  exact(value, "case_id status observations"); assert.equal(value.case_id, c.case_id); assert.equal(value.status, "completed");
  unique(value.observations.map((o) => o.step_id)); assert.deepEqual(value.observations.map((o) => o.step_id).sort(), [...c.observations].sort());
  for (const o of value.observations) {
    if (o.status === "ok") { exact(o, "step_id status value"); assert.ok(o.value && typeof o.value === "object"); }
    else { exact(o, "step_id status error"); assert.equal(o.status, "error"); exact(o.error, "class kind message stage code"); }
  }
}
export function compare(source, target, c) {
  validateWorkflow(source, c); validateWorkflow(target, c);
  const diffs = [];
  for (const s of source.observations) {
    const t = target.observations.find((o) => o.step_id === s.step_id);
    try { assert.deepEqual(t, s); }
    catch {
      diffs.push({ step_id: s.step_id, path: "observation", kind: "value_mismatch", source: s, target: t, message: "Exact public observation mismatch" });
    }
  }
  return { outcome: diffs.length ? "fail" : "pass", diffs };
}
function validateReturned(results, cases) {
  assert.ok(Array.isArray(results)); unique(results.map((r) => r.case_id));
  assert.deepEqual(results.map((r) => r.case_id).sort(), cases.map((c) => c.case_id).sort(), "source/target returned ID set");
  for (const r of results) validateWorkflow(r, cases.find((c) => c.case_id === r.case_id));
}
async function save(lane, result, runDirectory) {
  await writeFile(resolve(root, runDirectory, `${lane}.json`), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(resolve(root, outputRoot, `${lane}-latest.json`), `${JSON.stringify({ path: `${runDirectory}/${lane}.json` })}\n`);
}
async function parity(spec, runDirectory, runId, started) {
  const source = invoke(spec, "legacy", spec.cases), target = invoke(spec, "node-wasm", spec.cases);
  validateReturned(source, spec.cases); validateReturned(target, spec.cases);
  const comparisons = spec.cases.map((c) => {
    const s = source.find((r) => r.case_id === c.case_id), t = target.find((r) => r.case_id === c.case_id);
    return { case_id: c.case_id, target_profile: "node-wasm", requirements: c.covers, source: s, target: t, ...compare(s, t, c) };
  });
  const passed = comparisons.filter((c) => c.outcome === "pass").length;
  const result = { schema: "migration-parity/parity-result@1", identity: await identity(spec, "parity", runId, started), status: "completed",
    summary: { selected: comparisons.length, executed: comparisons.length, passed, failed: comparisons.length - passed, not_run: 0, infrastructure_errors: 0 }, comparisons, infrastructure_errors: [] };
  await save("parity", result, runDirectory);
  console.log(`Parity ${passed}/${comparisons.length} comparisons pass; run ${runId}`);
  for (const c of comparisons.filter((c) => c.outcome !== "pass")) console.error(`${c.case_id}: ${JSON.stringify(c.diffs).slice(0, 1500)}`);
  return result;
}
async function coverage(spec, runDirectory, runId, started) {
  const plans = [];
  for (const plan of spec.plans) {
    const directory = `${runDirectory}/v8-${plan.plan_id}`; await mkdir(resolve(root, directory), { recursive: true });
    const selected = spec.cases.filter((c) => plan.selectors.parity_case_ids.includes(c.case_id));
    validateReturned(invoke(spec, "node-wasm", selected, { coverage: directory }), selected);
    for (const id of plan.selectors.command_ids) {
      const c = spec.commands.get(id);
      execFileSync(c.argv[0] === "node" ? process.execPath : c.argv[0], c.argv.slice(1), { cwd: resolve(root, c.cwd), timeout: c.timeout_seconds * 1000,
        env: { ...process.env, NODE_V8_COVERAGE: resolve(root, directory) }, stdio: "pipe" });
    }
    const raw = [];
    for (const p of await tree(directory)) raw.push(...(await json(p)).result);
    const components = [];
    for (const id of plan.component_ids) {
      const definition = spec.components.get(id), files = [];
      for (const path of definition.paths) {
        const functions = new Map();
        for (const script of raw.filter((s) => s.url === pathToFileURL(resolve(root, path)).href)) for (const fn of script.functions) {
          const range = fn.ranges[0], key = `${range.startOffset}:${range.endOffset}:${fn.functionName}`;
          functions.set(key, (functions.get(key) ?? 0) + range.count);
        }
        assert.ok(functions.size, `coverage was not ingested for ${path}`);
        files.push({ path, dimensions: [{ dimension: "function", covered: [...functions.values()].filter((n) => n > 0).length, total: functions.size,
          uncovered: [...functions].filter(([, n]) => n === 0).map(([k]) => `${path}:${k}`) }] });
      }
      const covered = files.reduce((n, f) => n + f.dimensions[0].covered, 0), total = files.reduce((n, f) => n + f.dimensions[0].total, 0);
      components.push({ component_id: id, files, thresholds: definition.thresholds.map((t) => ({ ...t, covered, total, outcome: covered / total * 100 >= t.minimum_percent ? "pass" : "fail" })) });
    }
    plans.push({ plan_id: plan.plan_id, target_profile: plan.target_profile, requirements: plan.covers, selected: plan.selectors,
      execution: { status: "completed", tests_passed: selected.length + plan.selectors.command_ids.length, tests_failed: 0 }, components });
  }
  const result = { schema: "migration-parity/coverage-result@1", identity: await identity(spec, "coverage", runId, started), status: "completed",
    collector: { name: "V8 NODE_V8_COVERAGE", version: process.versions.v8, snapshot_id: runId, artifact_ingested: true },
    summary: { plans_selected: plans.length, plans_executed: plans.length, plans_not_run: 0, tests_passed: plans.reduce((n, p) => n + p.execution.tests_passed, 0), tests_failed: 0 },
    plans, infrastructure_errors: [] };
  await save("coverage", result, runDirectory);
  for (const p of plans) for (const c of p.components) for (const t of c.thresholds) console.log(`Coverage ${c.component_id}: ${t.covered}/${t.total} functions, threshold ${t.minimum_percent}% ${t.outcome}; snapshot ${runId}`);
  return result;
}
function stats(samples) {
  const a = [...samples].sort((a, b) => a - b), mean = a.reduce((s, n) => s + n, 0) / a.length;
  const percentile = (q) => a[Math.max(0, Math.ceil(a.length * q) - 1)];
  return { min: a[0], median: a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2,
    mean, p95: percentile(.95), p99: percentile(.99), max: a.at(-1), total: null, weighted_mean: null,
    standard_deviation: Math.sqrt(a.reduce((s, n) => s + (n - mean) ** 2, 0) / a.length) };
}
async function latest(lane) {
  try { const pointer = await json(`${outputRoot}/${lane}-latest.json`); exact(pointer, "path"); assert.ok(pointer.path.startsWith(`${outputRoot}/`) && !pointer.path.includes("..")); return await json(pointer.path); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
async function compatible(spec, evidence, lane, { allowDirty = false } = {}) {
  if (!evidence) return ["missing evidence"];
  validateEvidence(spec, evidence, lane);
  if (lane === "benchmark" && evidence.status === "completed") await validateRawBenchmark(spec, evidence);
  const mismatches = [], current = await Promise.all(laneProfiles(spec, lane).map(targetIdentity));
  if (evidence.status !== "completed" || evidence.infrastructure_errors.length) mismatches.push("status");
  if (evidence.identity.manifest.sha256 !== await digest(manifestPath)) mismatches.push("manifest.sha256");
  if (JSON.stringify(evidence.identity.inputs) !== JSON.stringify(spec.inputs)) mismatches.push("inputs");
  if (JSON.stringify(evidence.identity.targets) !== JSON.stringify(current)) mismatches.push("targets");
  if (JSON.stringify(evidence.identity.assets) !== JSON.stringify(spec.assets)) mismatches.push("assets");
  if (!allowDirty && evidence.identity.targets.some((t) => t.dirty)) mismatches.push("targets.dirty");
  if (evidence.identity.oracles[0]?.runtime !== process.version || evidence.identity.oracles[0]?.version !== spec.manifest.oracles[0].version) mismatches.push("oracles");
  return mismatches;
}
function commandRun(command, request) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command.argv[0] === "node" ? process.execPath : command.argv[0], command.argv.slice(1),
      { cwd: resolve(root, command.cwd), stdio: ["pipe", "ignore", "inherit"], env: { ...process.env, TZ: "UTC", LANG: "C" } });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Collection benchmark command timed out")); }, command.timeout_seconds * 1000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`Collection benchmark command exited ${code}`)); });
    child.stdin.on("error", reject); child.stdin.end(JSON.stringify(request));
  });
}
function measuredSubject(subject, samples, count, rawPath) {
  return { ...subject, status: "completed", measurements: [
    { metric: "latency", unit: "millisecond", sample_count: samples.length, statistics: stats(samples), raw_samples_ref: rawPath },
    { metric: "throughput", unit: "images_per_second", sample_count: samples.length, statistics: stats(samples.map((n) => count * 1000 / n)), raw_samples_ref: rawPath },
  ] };
}
function evaluateBudgets(spec, w, subjects, correctness) {
  return w.covers.flatMap((id) => {
    const r = spec.requirements.get(id), b = r.budget; if (!b) return [];
    const median = (id) => subjects.find((s) => s.id === id && s.status === "completed")?.measurements.find((m) => m.metric === b.metric)?.statistics[b.statistic];
    return r.target_profiles.map((subjectId) => {
      const value = median(subjectId), base = median(b.baseline_subject);
      const observed = Number.isFinite(value) && Number.isFinite(base) && base > 0 ? value / base : null;
      return { requirement_id: id, subject_id: subjectId, baseline_subject: b.baseline_subject, metric: b.metric, statistic: b.statistic,
        operator: b.operator, required: b.value, observed, unit: b.unit,
        outcome: correctness.outcome !== "pass" || observed === null ? "not_proven" : observed <= b.value ? "pass" : "fail" };
    });
  });
}
const workloadGroup = (w) => JSON.stringify({ input: w.input, measurement: w.measurement });
function peerSubjects(spec, input, results) {
  const peers = new Set(spec.workloads.filter((w) => workloadGroup(w) === workloadGroup(input)).map((w) => w.workload_id));
  return results.filter((w) => peers.has(w.workload_id)).flatMap((w) => w.subjects);
}
async function benchmark(spec, runDirectory, runId, started) {
  const gate = await latest("parity");
  assert.deepEqual(await compatible(spec, gate, "parity", { allowDirty: true }), [], "benchmark needs current passing comparison evidence");
  const workloads = [], infrastructure_errors = [], browsers = new Set(), groups = new Map();
  for (const w of spec.workloads) {
    let subjects = [], correctness;
    if (w.input.kind === "parity_case") {
      assert.equal(gate.comparisons.find((c) => c.case_id === w.input.case_id && c.target_profile === "node-wasm")?.outcome, "pass");
      const c = spec.cases.find((c) => c.case_id === w.input.case_id);
      for (const s of w.subjects) {
        const samples = invoke(spec, s.id, [c], { benchmark: w.measurement });
        assert.equal(samples.length, w.measurement.samples); assert.ok(samples.every((v) => Number.isFinite(v) && v > 0));
        const rawPath = `${w.workload_id}-${s.id}.json`; await writeFile(resolve(root, runDirectory, rawPath), JSON.stringify(samples));
        subjects.push(measuredSubject(s, samples, 1, rawPath));
      }
      correctness = { gate: "parity_pass", outcome: "pass", evidence_id: gate.identity.run_id };
    } else {
      const rawPath = `${w.workload_id}-samples.json`;
      try {
        const key = workloadGroup(w);
        if (groups.has(key)) {
          const prior = groups.get(key); subjects = prior.subjects.filter((s) => w.subjects.some((v) => v.id === s.id)); correctness = prior.correctness;
          workloads.push({ workload_id: w.workload_id, requirements: w.covers, measurement_policy: w.measurement, correctness, subjects, budgets: [] });
          continue;
        }
        const shared = { ...w, subjects: spec.workloads.filter((v) => workloadGroup(v) === key).flatMap((v) => v.subjects) };
        unique(shared.subjects.map((s) => s.id));
        assert.ok(shared.subjects.some((s) => spec.profiles.get(s.id).features.includes("concurrency:1")), "a live serial reference is required");
        await commandRun(spec.commands.get(w.input.command_id), { profiles: shared.subjects.map((s) => spec.profiles.get(s.id)), measurement: w.measurement, artifactPath: resolve(root, runDirectory, rawPath) });
        const raw = await json(`${runDirectory}/${rawPath}`);
        validateCollectionSamples(raw, shared, spec.commands.get(w.input.command_id).argv[2], { profiles: spec.profiles, input: spec.collections.get(w.workload_id) });
        browsers.add(raw.browser);
        const transportFailures = raw.records.filter((r) => r.status === "fail" && !r.job && !r.warmups.some((j) => j.failures.length));
        if (raw.errors.length || raw.external.length || transportFailures.length) infrastructure_errors.push({ scope: "runner", id: w.workload_id, kind: "browser_execution",
          message: JSON.stringify({ errors: raw.errors, external: raw.external, failures: transportFailures.map((r) => r.error) }).slice(0, 2000) });
        const gatesPass = !raw.errors.length && !raw.external.length && raw.records.filter((r) => ["reference", "gate"].includes(r.phase)).every((r) => r.status === "pass")
          && raw.subjects.filter((s) => s.eligible).every((s) => raw.records.some((r) => r.subject === s.id && r.phase === "gate" && r.status === "pass"));
        for (const subject of shared.subjects) {
          const eligibility = raw.subjects.find((s) => s.id === subject.id);
          const records = raw.records.filter((r) => r.subject === subject.id && r.phase === "measurement");
          if (!eligibility.eligible) subjects.push({ ...subject, status: "not_run", measurements: [] });
          else if (gatesPass && records.length === w.measurement.samples && records.every((r) => r.status === "pass")) {
            subjects.push(measuredSubject(subject, records.map((r) => r.job.elapsedMs), records[0].job.completed, rawPath));
          } else subjects.push({ ...subject, status: "failed", measurements: [] });
        }
        correctness = { gate: "successful_execution", outcome: gatesPass && subjects.every((s) => s.status !== "failed") ? "pass" : "fail", evidence_id: `${runId}/${rawPath}` };
        groups.set(key, { subjects, correctness });
        subjects = subjects.filter((s) => w.subjects.some((v) => v.id === s.id));
      } catch (error) {
        infrastructure_errors.push({ scope: "runner", id: w.workload_id, kind: "collection_execution", message: error.message.slice(0, 2000) });
        const sharedSubjects = spec.workloads.filter((v) => workloadGroup(v) === workloadGroup(w)).flatMap((v) => v.subjects).map((s) => ({ ...s, status: "not_run", measurements: [] }));
        subjects = sharedSubjects.filter((s) => w.subjects.some((v) => v.id === s.id));
        correctness = { gate: "successful_execution", outcome: "not_proven", evidence_id: `${runId}/${rawPath}` };
        groups.set(workloadGroup(w), { subjects: sharedSubjects, correctness });
      }
    }
    workloads.push({ workload_id: w.workload_id, requirements: w.covers, measurement_policy: w.measurement,
      correctness, subjects, budgets: [] });
    await writeFile(resolve(root, runDirectory, "benchmark-partial.json"), JSON.stringify(workloads, null, 2) + "\n");
  }
  for (const w of workloads) {
    const input = spec.workloads.find((v) => v.workload_id === w.workload_id);
    w.budgets = evaluateBudgets(spec, input, peerSubjects(spec, input, workloads), w.correctness);
  }
  const budgets = workloads.flatMap((w) => w.budgets), measured = workloads.filter((w) => w.subjects.some((s) => s.status === "completed")).length;
  const result = { schema: "migration-parity/benchmark-result@1", identity: await identity(spec, "benchmark", runId, started), status: infrastructure_errors.length ? "infrastructure_failed" : "completed",
    environment: { machine_id: sha256(`${platform()}:${arch()}:${cpus()[0]?.model}:${totalmem()}`).slice(0, 16), os: `${platform()} ${release()}`, architecture: arch(), cpu: cpus()[0]?.model ?? "unknown", memory_bytes: totalmem(), power_mode: "unknown", toolchain: `Node ${process.version}, V8 ${process.versions.v8}; Chromium ${[...browsers].join(", ") || "not measured"}` },
    summary: { workloads_selected: workloads.length, workloads_measured: measured, workloads_not_run: workloads.length - measured, budgets_passed: budgets.filter((b) => b.outcome === "pass").length, budgets_failed: budgets.filter((b) => b.outcome === "fail").length, budgets_not_proven: budgets.filter((b) => b.outcome === "not_proven").length },
    workloads, suites: [], infrastructure_errors };
  await save("benchmark", result, runDirectory);
  await writeCollectionReport(spec, result, runDirectory);
  for (const b of budgets) console.log(`${b.requirement_id}: ${b.observed?.toFixed(3) ?? "not measured"} / limit ${b.required}: ${b.outcome}; run ${runId}`);
  return result;
}

async function validateRawBenchmark(spec, evidence) {
  assert.match(evidence.identity.run_id, /^benchmark-[a-f0-9-]+$/);
  const cache = new Map();
  for (const w of evidence.workloads) {
    const input = spec.workloads.find((v) => v.workload_id === w.workload_id);
    for (const subject of w.subjects.filter((s) => s.status === "completed")) {
      const ref = subject.measurements[0].raw_samples_ref;
      assert.ok(typeof ref === "string" && /^[a-zA-Z0-9_.-]+\.json$/.test(ref));
      assert.ok(subject.measurements.every((m) => m.raw_samples_ref === ref));
      if (!cache.has(ref)) cache.set(ref, await json(`${outputRoot}/${evidence.identity.run_id}/${ref}`));
      const raw = cache.get(ref); let samples, count = 1;
      if (input.input.kind === "parity_case") { samples = raw; assert.ok(Array.isArray(samples) && samples.every((n) => Number.isFinite(n) && n > 0)); }
      else {
        const shared = { ...input, subjects: spec.workloads.filter((v) => workloadGroup(v) === workloadGroup(input)).flatMap((v) => v.subjects) };
        validateCollectionSamples(raw, shared, spec.commands.get(input.input.command_id).argv[2], { profiles: spec.profiles, input: spec.collections.get(input.workload_id) });
        const records = raw.records.filter((r) => r.phase === "measurement" && r.subject === subject.id);
        assert.equal(records.length, input.measurement.samples); assert.ok(records.every((r) => r.status === "pass"));
        samples = records.map((r) => r.job.elapsedMs); count = records[0].job.completed;
      }
      assert.equal(samples.length, input.measurement.samples);
      assert.deepEqual(subject, measuredSubject({ kind: subject.kind, id: subject.id }, samples, count, ref), "summary statistics differ from raw samples");
    }
  }
}

async function writeCollectionReport(spec, result, directory) {
  const lines = ["# Collection benchmark observations", "", `Run: ${result.identity.run_id}.`, "",
    `Environment: ${result.environment.os}; ${result.environment.cpu}; ${result.environment.toolchain}. Power/thermal state is unknown.`, "",
    `Worktree dirty: ${result.identity.targets.some((t) => t.dirty)}. These headless desktop observations are not physical-phone or release qualification.`, "",
    "Job timing includes source scan through journaled output commit. Additional independent decoder and exact-byte checks are outside the interval. Stage timings overlap the render interval and do not sum to job wall time. Wasm values below are the largest reported worker heap, not process RAM.", ""];
  const seen = new Set();
  const number = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "—";
  const distribution = (values) => values.length ? `${number(stats(values).median)} / ${number(stats(values).p95)}` : "—";
  for (const w of result.workloads) {
    const input = spec.workloads.find((v) => v.workload_id === w.workload_id);
    if (input.input.kind !== "command" || seen.has(workloadGroup(input))) continue;
    seen.add(workloadGroup(input));
    const ref = w.correctness.evidence_id?.split("/").at(-1);
    let raw; try { raw = await json(`${directory}/${ref}`); } catch { lines.push(`## ${w.workload_id}`, "", "Execution did not produce readable raw evidence.", ""); continue; }
    lines.push(`## ${w.workload_id}`, "", `Browser hints: ${raw.device?.hardwareConcurrency ?? "unknown"} logical CPUs, ${raw.device?.deviceMemory ?? "unknown"} GiB memory. Destination: ${raw.destination}.`, "",
      "| Setting | Jobs | Median / range (s) | Images/s median | Peak active | Peak reservation (MiB) | Largest worker Wasm (MiB) |", "| --- | ---: | --- | ---: | ---: | ---: | ---: |");
    const peers = peerSubjects(spec, input, result.workloads);
    for (const subject of raw.subjects) {
      const measured = peers.find((s) => s.id === subject.id);
      const rows = raw.records.filter((r) => r.subject === subject.id && r.phase === "measurement" && r.status === "pass");
      if (measured?.status !== "completed") { lines.push(`| ${subject.id} | 0 | ${subject.reason ?? measured?.status ?? "not run"} | — | — | — | — |`); continue; }
      const jobs = rows.map((r) => r.job), timing = stats(jobs.map((j) => j.elapsedMs / 1000));
      lines.push(`| ${subject.id} | ${jobs.length} | ${number(timing.median)} / ${number(timing.min)}–${number(timing.max)} | ${number(stats(jobs.map((j) => j.completed * 1000 / j.elapsedMs)).median)} | ${Math.max(...jobs.flatMap((j) => j.scheduler.map((s) => s.active)))} | ${number(Math.max(...jobs.flatMap((j) => j.scheduler.map((s) => s.estimatedBytes))) / 1048576, 1)} | ${number(Math.max(...jobs.flatMap((j) => j.items.map((i) => i.result.heapBytes))) / 1048576, 1)} |`);
    }
    lines.push("", "Per-image/stage values are median / p95 milliseconds, pooled across the five measured jobs. Startup values include only workers started inside measured jobs; warmup starts remain in raw evidence.", "",
      "| Setting | Image completion | Source read | Source checks/hash | Setup | Materialize/encode | Output validation | Journal save | Worker startup | Timer delay |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const subject of peers.filter((s) => s.status === "completed")) {
      const jobs = raw.records.filter((r) => r.subject === subject.id && r.phase === "measurement" && r.status === "pass").map((r) => r.job);
      const items = jobs.flatMap((j) => j.items), d = items.map((i) => i.result.diagnostics);
      lines.push(`| ${subject.id} | ${distribution(items.map((i) => i.elapsedMs))} | ${distribution(d.map((i) => i.sourceReadMs))} | ${distribution(d.map((i) => i.sourceDigestMs))} | ${distribution(d.map((i) => i.render.pipelineSetupMs))} | ${distribution(d.map((i) => i.render.materializeEncodeMs))} | ${distribution(d.map((i) => i.render.outputValidationMs))} | ${distribution(d.map((i) => i.journalSaveMs))} | ${distribution(jobs.flatMap((j) => j.startups.map((s) => s.elapsedMs)))} | ${distribution(jobs.flatMap((j) => j.eventLoopLagMs))} |`);
    }
    lines.push("", `Raw samples and correctness checks: [${ref}](${ref}).`, "");
  }
  lines.push("## Declared budget outcomes", "", "| Requirement | Observed ratio | Limit | Outcome |", "| --- | ---: | ---: | --- |");
  for (const b of result.workloads.flatMap((w) => w.budgets)) lines.push(`| ${b.requirement_id} | ${number(b.observed, 3)} | ${b.required} | ${b.outcome} |`);
  await writeFile(resolve(root, directory, "collections.md"), lines.join("\n") + "\n");
}

// Every generated shape is fixed; validation happens before joins, never after.
export function validateEvidence(spec, e, lane) {
  const extras = { parity: "comparisons", coverage: "collector plans", benchmark: "environment workloads suites" };
  exact(e, `schema identity status summary infrastructure_errors ${extras[lane]}`); assert.equal(e.schema, `migration-parity/${lane}-result@1`);
  const i = e.identity; exact(i, "run_id started_at finished_at manifest inputs assets oracles targets command");
  exact(i.manifest, "path schema sha256"); assert.equal(i.manifest.path, manifestPath); assert.equal(i.manifest.schema, spec.manifest.schema);
  i.inputs.forEach((v) => exact(v, "path schema sha256")); i.assets.forEach((v) => exact(v, "input_path item_id asset_id kind locator sha256"));
  i.oracles.forEach((v) => exact(v, "oracle_id name version runtime")); i.targets.forEach((v) => exact(v, "target_profile target_id revision dirty runtime backend features"));
  assert.deepEqual(i.targets.map((t) => t.target_profile), laneProfiles(spec, lane).map((p) => p.id)); assert.equal(i.oracles.length, 1); exact(i.command, "command_id argv cwd timeout_seconds"); assert.equal(i.command.command_id, lane);
  for (const v of e.infrastructure_errors) exact(v, "scope id kind message");
  if (lane === "parity") {
    exact(e.summary, "selected executed passed failed not_run infrastructure_errors"); assert.equal(e.summary.selected, spec.cases.length);
    unique(e.comparisons.map((c) => c.case_id)); assert.equal(e.comparisons.length, spec.cases.length);
    for (const c of e.comparisons) {
      exact(c, "case_id target_profile requirements source target outcome diffs"); const input = spec.cases.find((v) => v.case_id === c.case_id); assert.ok(input);
      assert.equal(c.target_profile, "node-wasm"); assert.deepEqual(c.requirements, input.covers);
      const actual = compare(c.source, c.target, input); assert.deepEqual({ outcome: c.outcome, diffs: c.diffs }, actual, "stored comparison cannot hide mismatches");
      c.diffs.forEach((d) => exact(d, "step_id path kind source target message"));
    }
    assert.equal(e.summary.passed, e.comparisons.filter((c) => c.outcome === "pass").length); assert.equal(e.summary.failed, e.comparisons.filter((c) => c.outcome === "fail").length);
  } else if (lane === "coverage") {
    exact(e.collector, "name version snapshot_id artifact_ingested"); assert.equal(e.collector.artifact_ingested, true); assert.equal(e.collector.snapshot_id, i.run_id);
    exact(e.summary, "plans_selected plans_executed plans_not_run tests_passed tests_failed"); assert.equal(e.plans.length, spec.plans.length);
    for (const p of e.plans) {
      exact(p, "plan_id target_profile requirements selected execution components"); const input = spec.plans.find((v) => v.plan_id === p.plan_id); assert.ok(input);
      assert.deepEqual(p.requirements, input.covers); assert.deepEqual(p.selected, input.selectors); exact(p.execution, "status tests_passed tests_failed");
      for (const c of p.components) {
        exact(c, "component_id files thresholds"); assert.ok(input.component_ids.includes(c.component_id));
        for (const f of c.files) { exact(f, "path dimensions"); assert.ok(spec.components.get(c.component_id).paths.includes(f.path)); for (const d of f.dimensions) { exact(d, "dimension covered total uncovered"); assert.equal(d.dimension, "function"); assert.ok(Number.isInteger(d.covered) && Number.isInteger(d.total) && d.covered >= 0 && d.covered <= d.total); } }
        for (const t of c.thresholds) { exact(t, "dimension minimum_percent covered total outcome"); assert.equal(t.outcome, t.covered / t.total * 100 >= t.minimum_percent ? "pass" : "fail"); }
      }
    }
  } else {
    exact(e.environment, "machine_id os architecture cpu memory_bytes power_mode toolchain");
    exact(e.summary, "workloads_selected workloads_measured workloads_not_run budgets_passed budgets_failed budgets_not_proven"); assert.deepEqual(e.suites, []); assert.equal(e.workloads.length, spec.workloads.length);
    unique(e.workloads.map((w) => w.workload_id));
    for (const w of e.workloads) {
      exact(w, "workload_id requirements measurement_policy correctness subjects budgets"); const input = spec.workloads.find((v) => v.workload_id === w.workload_id); assert.ok(input);
      assert.deepEqual(w.requirements, input.covers); assert.deepEqual(w.measurement_policy, input.measurement); exact(w.correctness, "gate outcome evidence_id");
      assert.deepEqual(w.subjects.map(({ kind, id }) => ({ kind, id })), input.subjects);
      assert.equal(w.correctness.gate, input.measurement.correctness_gate); assert.ok(["pass", "fail", "not_proven"].includes(w.correctness.outcome));
      for (const s of w.subjects) {
        exact(s, "kind id status measurements"); assert.ok(["completed", "failed", "not_run"].includes(s.status));
        assert.equal(s.measurements.length, s.status === "completed" ? input.measurement.metrics.length : 0);
        if (s.status === "completed") { assert.equal(w.correctness.outcome, "pass"); assert.deepEqual(s.measurements.map((m) => m.metric), input.measurement.metrics); }
        for (const m of s.measurements) { exact(m, "metric unit sample_count statistics raw_samples_ref"); exact(m.statistics, "min median mean p95 p99 max total weighted_mean standard_deviation"); assert.equal(m.sample_count, input.measurement.samples); assert.ok(m.statistics.median > 0); }
      }
      for (const b of w.budgets) exact(b, "requirement_id subject_id baseline_subject metric statistic operator required observed unit outcome");
      assert.deepEqual(w.budgets, evaluateBudgets(spec, input, peerSubjects(spec, input, e.workloads), w.correctness), "stored budget cannot hide missing or failing subjects");
    }
    const measured = e.workloads.filter((w) => w.subjects.some((s) => s.status === "completed")).length, budgets = e.workloads.flatMap((w) => w.budgets);
    assert.deepEqual(e.summary, { workloads_selected: e.workloads.length, workloads_measured: measured, workloads_not_run: e.workloads.length - measured,
      budgets_passed: budgets.filter((b) => b.outcome === "pass").length, budgets_failed: budgets.filter((b) => b.outcome === "fail").length, budgets_not_proven: budgets.filter((b) => b.outcome === "not_proven").length });
  }
}

async function aggregate(spec) {
  const results = {}, evidence = [], stale = [];
  for (const lane of ["parity", "coverage", "benchmark"]) {
    const e = await latest(lane); let reasons;
    try { reasons = await compatible(spec, e, lane); } catch (error) { reasons = [`invalid: ${error.message}`]; }
    results[lane] = { e, reasons };
    if (!reasons.length) evidence.push({ lane, run_id: e.identity.run_id, snapshot_id: lane === "coverage" ? e.collector.snapshot_id : null });
    else if (e) stale.push({ lane, run_id: e.identity?.run_id ?? "invalid", reason: reasons.join(", "), identity_diff: reasons });
  }
  const operations = spec.manifest.surfaces.flatMap((s) => s.operations.flatMap((o) => {
    const profiles = [...new Set(o.requirements.flatMap((r) => r.target_profiles))];
    return profiles.map((profile) => {
      const status = { surface: s.id, operation: o.id, target_profile: profile, classification: o.classification, support: o.targets[0].support.status,
        requirements: o.requirements.filter((r) => r.target_profiles.includes(profile)).map((r) => r.id) };
      for (const lane of ["parity", "coverage", "benchmark"]) {
        const { e, reasons } = results[lane], applicable = o[lane].applicability === "required" && o[lane].target_profiles.includes(profile);
        const input = lane === "parity" ? spec.cases : lane === "coverage" ? spec.plans : spec.workloads;
        const ids = input.filter((v) => v.covers.some((id) => status.requirements.includes(id))
          && (lane === "parity" ? v.target_profiles.includes(profile) : lane === "coverage" ? v.target_profile === profile : v.subjects.some((s) => s.id === profile)))
          .map((v) => v.case_id ?? v.plan_id ?? v.workload_id);
        let failed = false, missing = false;
        if (e && !reasons.length) {
          if (lane === "parity") failed = e.comparisons.some((c) => ids.includes(c.case_id) && c.target_profile === profile && c.outcome !== "pass");
          else if (lane === "coverage") failed = e.plans.some((p) => ids.includes(p.plan_id) && p.components.some((c) => c.thresholds.some((t) => t.outcome !== "pass")));
          else for (const w of e.workloads.filter((w) => ids.includes(w.workload_id))) {
            failed ||= w.correctness.outcome === "fail" || w.subjects.some((s) => s.id === profile && s.status === "failed") || w.budgets.some((b) => b.subject_id === profile && b.outcome === "fail");
            missing ||= w.correctness.outcome === "not_proven" || !w.subjects.some((s) => s.id === profile && s.status === "completed") || w.budgets.some((b) => b.subject_id === profile && b.outcome === "not_proven");
          }
        }
        const applicability = applicable ? "required" : "not_applicable";
        status[lane] = { applicability, input_ids: ids, outcome: !applicable ? "not_applicable" : reasons.length ? "not_proven" : failed ? "fail" : missing ? "not_proven" : "pass",
          evidence_id: applicable && !reasons.length ? e.identity.run_id : null,
          details: !applicable ? [o[lane].reason ?? "This profile is outside the declared lane scope."] : [...reasons, ...(missing ? ["A required subject or comparison was not measured."] : [])] };
      }
      return status;
    });
  }));
  const endpointCount = spec.manifest.surfaces.reduce((n, s) => n + s.operations.length, 0);
  const completeness = [{ dimension: "inventory_representation", target_profile: null, numerator: endpointCount, denominator: spec.inventory.length, evidence_id: null },
    { dimension: "operation_contracts", target_profile: null, numerator: endpointCount, denominator: endpointCount, evidence_id: null }];
  for (const profile of spec.profiles.keys()) for (const lane of ["parity", "coverage", "benchmark"]) {
    const count = [...spec.requirements.values()].filter((r) => r.lanes.includes(lane) && r.target_profiles.includes(profile)).length;
    completeness.push({ dimension: `${lane}_input_mapping`, target_profile: profile, numerator: count, denominator: count, evidence_id: null });
  }
  const report = { schema: "migration-parity/status-report@1", manifest: { path: manifestPath, schema: spec.manifest.schema, sha256: await digest(manifestPath) }, target_profiles: await Promise.all([...spec.profiles.values()].map(targetIdentity)), evidence, completeness, operations, stale_or_incompatible_evidence: stale };
  await mkdir(resolve(root, outputRoot), { recursive: true }); await writeFile(resolve(root, outputRoot, "status.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
async function docs(spec, report) {
  const header = `Generated by scripts/migration/run.mjs v1; ${report.schema}.\n\nManifest: ${manifestPath} (${spec.manifest.schema}), SHA-256 ${report.manifest.sha256}.\n`;
  const declared = `${header}\nDeclared scope: ${spec.manifest.scope.id} (${spec.manifest.scope.mode}). ${spec.inventory.length} endpoints; ${spec.cases.length} input-only workflows.\n\n` + spec.manifest.surfaces.flatMap((s) => s.operations.map((o) => `- ${s.id}.${o.id}: ${o.source.signature}; ${o.requirements.length} declared requirements.\n`)).join("");
  const status = `${header}\nTarget node-wasm: ${report.target_profiles[0].revision}. Dirty: ${report.target_profiles[0].dirty}.\n\n` + report.operations.map((o) => `- ${o.operation} (${o.target_profile}): parity **${o.parity.outcome}**; coverage **${o.coverage.outcome}**; benchmark **${o.benchmark.outcome}**.\n`).join("")
    + `\nEvidence: ${report.evidence.map((e) => `${e.lane} ${e.run_id}, snapshot ${e.snapshot_id ?? "none"}`).join("; ") || "none compatible"}.\n\n`
    + report.stale_or_incompatible_evidence.map((e) => `- ${e.lane} ${e.run_id}: **not_proven** (${e.reason}).\n`).join("");
  await mkdir(resolve(root, "docs/generated"), { recursive: true });
  await writeFile(resolve(root, spec.manifest.documentation.specification_outputs[0]), declared);
  await writeFile(resolve(root, spec.manifest.documentation.evidence_outputs[0]), status);
}
async function check(spec) {
  const bad = structuredClone(spec.manifest); bad.unrecognized = true; assert.throws(() => validateManifest(bad));
  bad.schema = "migration-parity/manifest@99"; delete bad.unrecognized; assert.throws(() => validateManifest(bad));
  const badInputs = structuredClone(spec.docs); badInputs.parity[0].cases[0].expected = {}; assert.throws(() => validateInputs(spec.manifest, badInputs));
  const badCollection = structuredClone(spec.docs); badCollection.benchmark[1].workloads[0].expected_output_hash = "0".repeat(64); assert.throws(() => validateInputs(spec.manifest, badCollection));
  const wrongCommand = structuredClone(spec.manifest); wrongCommand.commands.find((c) => c.id === "collection-small").argv[2] = "../secret"; assert.throws(() => validateInputs(wrongCommand, spec.docs));
  const missingSubject = structuredClone(spec.docs); missingSubject.benchmark[1].workloads[0].subjects = []; assert.throws(() => validateInputs(spec.manifest, missingSubject));
  const c = spec.cases[0], a = { case_id: c.case_id, status: "completed", observations: [{ step_id: "call", status: "ok", value: { bytes: [1, 2] } }] };
  const b = structuredClone(a); b.observations[0].value.bytes[1] = 3; assert.equal(compare(a, b, c).outcome, "fail");
  b.observations[0].extra = 1; assert.throws(() => compare(a, b, c)); assert.throws(() => validateReturned([a, a], [c]));
  for (const p of await tree("src")) if (p.endsWith(".js")) assert.doesNotMatch(await readFile(resolve(root, p), "utf8"), /tests\/(?:fixtures|oracles)|migration\/execute/);
  const current = await latest("parity");
  if (current) {
    const stale = structuredClone(current); stale.identity.manifest.sha256 = "0".repeat(64); assert.ok((await compatible(spec, stale, "parity")).includes("manifest.sha256"));
    const dirty = structuredClone(current); dirty.identity.targets[0].dirty = true; assert.ok((await compatible(spec, dirty, "parity")).includes("targets.dirty"));
    const hidden = structuredClone(current); hidden.comparisons[0].target.observations[0].value.bytes[0] ^= 1; assert.throws(() => validateEvidence(spec, hidden, "parity"));
  }
  console.log(`Specification and anti-cheat checks pass: ${spec.inventory.length} endpoints, ${spec.cases.length} cases.`);
}

async function main() {
  const lane = process.argv[2] ?? "parity", spec = await loadSpec();
  if (lane === "inventory") { console.log(JSON.stringify(spec.inventory)); return; }
  if (lane === "oracle-identity") { await implementation("legacy"); console.log(JSON.stringify(await json("tests/oracles/legacy-integrity.json"))); return; }
  if (lane === "target-identity") { await implementation("node-wasm"); console.log(JSON.stringify(await targetIdentity())); return; }
  if (lane === "check") { await check(spec); return; }
  if (["aggregate", "docs"].includes(lane)) { const report = await aggregate(spec); if (lane === "docs") await docs(spec, report); console.log(`${lane}: ${report.evidence.length} compatible lanes; ${report.stale_or_incompatible_evidence.length} unproven lanes`); return; }
  assert.ok(["parity", "coverage", "benchmark"].includes(lane), `unknown lane: ${lane}`);
  const started = new Date().toISOString(), runId = `${lane}-${randomUUID()}`, directory = `${outputRoot}/${runId}`;
  await mkdir(resolve(root, directory), { recursive: true });
  activeIdentity = { targets: await Promise.all(laneProfiles(spec, lane).map(targetIdentity)), manifest: await digest(manifestPath) };
  const result = await ({ parity, coverage, benchmark })[lane](spec, directory, runId, started);
  validateEvidence(spec, result, lane);
  if (result.status !== "completed" || result.summary.failed || result.summary.budgets_failed || result.workloads?.some((w) => w.correctness.outcome === "fail") || result.plans?.some((p) => p.components.some((c) => c.thresholds.some((t) => t.outcome === "fail")))) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
