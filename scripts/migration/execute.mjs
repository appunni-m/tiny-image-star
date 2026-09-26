import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { root, digest, json, exact } from "./spec.mjs";
import { verifyRuntime } from "../stage-pillow-runtime.mjs";

export async function implementation(subject) {
  assert.ok(["legacy", "node-wasm"].includes(subject));
  const legacy = subject === "legacy";
  if (legacy) {
    const identity = await json("tests/oracles/legacy-integrity.json");
    for (const [path, hash] of Object.entries(identity.files)) assert.equal(await digest(path), hash, `oracle identity: ${path}`);
  } else await verifyRuntime(resolve(root, "wasm"));
  const base = legacy ? "tests/oracles/legacy/" : "";
  const api = await import(pathToFileURL(resolve(root, `${base}wasm/pillow_rs_js.js`)));
  api.initSync({ module: await readFile(resolve(root, `${base}wasm/pillow_rs_js_bg.wasm`)) });
  const adapter = await import(pathToFileURL(resolve(root, `${base}src/engine/pillow.js`)));
  return { api, adapter };
}

export async function executeWorkflow(impl, c, operations) {
  const observations = [];
  for (const step of c.steps) {
    const op = operations.find((o) => o.id === step.operation);
    assert.ok(op && typeof impl.adapter[op.id] === "function", "public endpoint unavailable");
    const args = op.source.parameters.map((p) => {
      const value = step.arguments[p.id]?.value ?? p.omission.value;
      if (p.id === "api") { exact(value, "module"); assert.equal(value.module, "PillowBrowserApi"); return impl.api; }
      if (p.id === "file") return { ...value, bytes: Uint8Array.from(value.bytes) };
      return structuredClone(value);
    });
    let observation;
    try {
      const value = await impl.adapter[op.id](...args);
      // Byte arrays remain complete values, never hash-only comparisons.
      observation = { step_id: step.step_id, status: "ok", value: { ...value, bytes: Array.from(value.bytes) } };
    } catch (error) {
      observation = { step_id: step.step_id, status: "error", error: {
        class: error instanceof Error ? error.name : typeof error,
        kind: null, message: error instanceof Error ? error.message : String(error), stage: step.operation, code: error.code ?? null,
      } };
    }
    if (c.observations.includes(step.step_id)) observations.push(observation);
  }
  return { case_id: c.case_id, status: "completed", observations };
}

if (process.argv[2] === "worker") {
  let input = ""; for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input); exact(request, "subject cases operations benchmark");
  const impl = await implementation(request.subject);
  if (request.benchmark) {
    const m = request.benchmark, c = request.cases[0];
    for (let i = 0; i < m.warmup_iterations; i += 1) await executeWorkflow(impl, c, request.operations);
    const samples = [];
    for (let sample = 0; sample < m.samples; sample += 1) {
      const start = performance.now();
      for (let i = 0; i < m.measurement_iterations; i += 1) await executeWorkflow(impl, c, request.operations);
      samples.push((performance.now() - start) / m.measurement_iterations);
    }
    process.stdout.write(JSON.stringify(samples));
  } else {
    const results = [];
    for (const c of request.cases) results.push(await executeWorkflow(impl, c, request.operations));
    process.stdout.write(JSON.stringify(results));
  }
}
