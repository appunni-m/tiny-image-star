import assert from "node:assert/strict";
import { exact, unique } from "./spec.mjs";
import { profileConcurrency } from "./collection-input.mjs";
import { deviceBudget } from "../../src/processing/policy.js";

const nonnegative = (v) => assert.ok(Number.isFinite(v) && v >= 0);
export function validateCollectionSamples(raw, workload, inputPath, { profiles, input }) {
  exact(raw, "schema inputPath device browser destination seed cacheMeaning timingBoundary memoryMeaning subjects order records errors external");
  assert.equal(raw.schema, "tinystar/collection-samples@1"); assert.equal(raw.inputPath, inputPath);
  exact(raw.device, "hardwareConcurrency deviceMemory userAgent budget"); exact(raw.device.budget, "cpu memory");
  assert.deepEqual(raw.device.budget, deviceBudget(raw.device)); assert.equal(raw.seed, input.random_seed);
  assert.ok(Number.isInteger(raw.device.budget.cpu) && raw.device.budget.cpu >= 1); assert.ok(raw.device.budget.memory > 0);
  assert.equal(typeof raw.browser, "string");
  assert.deepEqual(raw.subjects.map((s) => s.id), workload.subjects.map((s) => s.id));
  for (const s of raw.subjects) {
    exact(s, "id concurrency eligible reason"); assert.equal(s.eligible, s.concurrency === null || s.concurrency <= raw.device.budget.cpu);
    assert.equal(s.concurrency, profileConcurrency(profiles.get(s.id)));
    if (!s.eligible) assert.equal(typeof s.reason, "string"); else assert.equal(s.reason, null);
  }
  unique(raw.records.map((r) => `${r.subject}/${r.phase}/${r.sample}`));
  for (const r of raw.records) {
    exact(r, "subject phase sample status warmups job verification error");
    assert.ok(raw.subjects.some((s) => s.id === r.subject && s.eligible));
    assert.ok(["reference", "gate", "measurement"].includes(r.phase));
    assert.ok(["pass", "fail"].includes(r.status));
    if (r.phase === "measurement") assert.ok(Number.isInteger(r.sample) && r.sample >= 0 && r.sample < workload.measurement.samples);
    if (r.status !== "pass") { assert.equal(typeof r.error, "string"); continue; }
    assert.equal(r.error, null);
    assert.equal(r.warmups.length, r.phase === "measurement" ? workload.measurement.warmup_iterations : 0);
    for (const j of [...r.warmups, r.job]) {
      exact(j, "jobId elapsedMs scanMs items failures outputBytes completed eventLoopLagMs maxEventLoopLagMs scheduler workersStarted startups startupSamplesTruncated finalScheduler");
      assert.ok(j.elapsedMs > 0); nonnegative(j.scanMs); assert.ok(j.scanMs <= j.elapsedMs);
      assert.deepEqual(j.failures, []); assert.ok(j.completed > 0); assert.equal(j.completed, j.items.length);
      unique(j.items.map((i) => i.index)); assert.deepEqual(j.items.map((i) => i.index).sort((a, b) => a - b), input.sequence.map((_, i) => i));
      for (const i of j.items) {
        exact(i, "index elapsedMs result"); nonnegative(i.elapsedMs);
        const v = i.result;
        exact(v, "type jobId index claimId recovered outputPath sourceBytes outputBytes width height format heapBytes diagnostics");
        assert.equal(v.type, "result"); assert.equal(v.index, i.index); assert.equal(v.jobId, j.jobId);
        assert.ok(v.outputBytes > 0 && v.heapBytes > 0 && v.width > 0 && v.height > 0);
        const d = v.diagnostics; exact(d, "schema engineWaitMs sourceReadMs sourceDigestMs renderMs journalSaveMs render");
        assert.equal(d.schema, "tinystar/folder-timings@1");
        for (const key of ["engineWaitMs", "sourceReadMs", "sourceDigestMs", "renderMs", "journalSaveMs"]) nonnegative(d[key]);
        exact(d.render, "schema pipelineSetupMs materializeEncodeMs outputValidationMs"); assert.equal(d.render.schema, "tinystar/render-timings@1");
        for (const key of ["pipelineSetupMs", "materializeEncodeMs", "outputValidationMs"]) nonnegative(d.render[key]);
      }
      assert.equal(j.outputBytes, j.items.reduce((n, i) => n + i.result.outputBytes, 0));
      j.eventLoopLagMs.forEach(nonnegative); nonnegative(j.maxEventLoopLagMs);
      for (const s of j.scheduler) {
        exact(s, "atMs active workers limit estimatedBytes pendingReadBytes pendingOutputBytes reason");
        assert.ok(s.active <= raw.device.budget.cpu && s.estimatedBytes <= raw.device.budget.memory);
      }
      exact(j.finalScheduler, "estimatedBytes retainedBytes active workers queued limit cpuBudget memoryBudget");
      assert.equal(j.finalScheduler.active, 0); assert.equal(j.finalScheduler.queued, 0);
      for (const s of j.startups) { exact(s, "kind elapsedMs heapBytes"); nonnegative(s.elapsedMs); assert.ok(s.heapBytes > 0); }
    }
    exact(r.verification, "decoded exactByteComparisons bytesTotal");
    assert.equal(r.verification.decoded, r.job.completed); assert.equal(r.verification.bytesTotal, r.job.outputBytes);
    if (r.phase !== "reference") assert.equal(r.verification.exactByteComparisons, r.job.completed);
  }
  for (const [index, order] of raw.order.entries()) {
    unique(order); assert.ok(index < workload.measurement.samples);
    assert.deepEqual(raw.records.filter((r) => r.phase === "measurement" && r.sample === index).map((r) => r.subject), order);
  }
  if (raw.records.some((r) => r.phase === "measurement")) {
    const references = raw.records.filter((r) => r.phase === "reference"); assert.equal(references.length, 1); assert.equal(references[0].status, "pass");
    assert.equal(raw.subjects.find((s) => s.id === references[0].subject).concurrency, 1);
    assert.equal(raw.order.length, workload.measurement.samples);
    for (const s of raw.subjects.filter((s) => s.eligible)) {
      const gate = raw.records.find((r) => r.subject === s.id && r.phase === "gate"); assert.ok(gate);
      const trials = raw.records.filter((r) => r.subject === s.id && r.phase === "measurement");
      assert.equal(trials.length, gate.status === "pass" ? workload.measurement.samples : 0);
    }
  }
}
