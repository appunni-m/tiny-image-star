import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch, release } from "node:os";
import { chromium } from "playwright";
import * as binding from "../../wasm/pillow_rs_js.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const depthFork = process.argv.includes("--depth-fork");
const baselineOption = process.argv.indexOf("--baseline");
if (baselineOption >= 0) assert.ok(process.argv[baselineOption + 1] && !process.argv[baselineOption + 1].startsWith("--"), "--baseline requires a pre-change scene file.");
const baselinePath = baselineOption >= 0 ? resolve(root, process.argv[baselineOption + 1]) : resolve(root, "src/compositor/scene.js");
const baselineScene = await readFile(baselinePath, "utf8");
assert.ok(!baselineScene.includes("layer.load();"), "Use --baseline with a retained pre-materialization scene source.");
const runId = `scene-memory-${randomUUID()}`;
const output = resolve(root, "docs/research/2026-09-17/scene-memory", runId);
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const wasmBytes = await readFile(resolve(root, "wasm/pillow_rs_js_bg.wasm"));
const runtime = JSON.parse(await readFile(resolve(root, "wasm/runtime.json"), "utf8"));
assert.equal(hash(wasmBytes), runtime.files["pillow_rs_js_bg.wasm"], "Published WASM integrity changed.");
assert.equal(hash(await readFile(resolve(root, "wasm/pillow_rs_js.js"))), runtime.files["pillow_rs_js.js"], "Published JavaScript binding integrity changed.");
binding.initSync({ module: wasmBytes });
const fixtures = [];
for (const [width, height] of [[2000, 1500], [4000, 3000]]) {
  const raw = new Uint8Array(width * height * 4), coverage = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, distance = Math.hypot((x - width * .5) / (width * .36), (y - height * .5) / (height * .46));
    raw.set([Math.floor(x * 255 / width), Math.floor(y * 255 / height), (x + y) % 256, 160 + (x % 96)], i * 4);
    coverage[i] = Math.round(Math.max(0, Math.min(1, (1 - distance) * 18)) * 255);
  }
  let image, mask, rgb;
  try {
    image = binding.fromBytesFn("RGBA", width, height, raw, "raw");
    mask = binding.fromBytesFn("L", width, height, coverage, "raw");
    const maskBytes = mask.saveWithInput("PNG", null), maskPath = `${width}x${height}-mask.png`;
    await writeFile(resolve(output, maskPath), maskBytes);
    rgb = image.convert("RGB", null);
    for (const format of ["PNG", "JPEG"]) {
      const photoBytes = (format === "PNG" ? image : rgb).saveWithInput(format, null);
      const photoPath = `${width}x${height}.${format === "PNG" ? "png" : "jpg"}`;
      await writeFile(resolve(output, photoPath), photoBytes);
      fixtures.push({ width, height, type: format === "PNG" ? "image/png" : "image/jpeg", photoPath, maskPath,
        photoSha256: hash(photoBytes), maskSha256: hash(maskBytes), photoBytes: photoBytes.length, maskBytes: maskBytes.length });
    }
  } finally { rgb?.free(); mask?.free(); image?.free(); }
}
const sources = [];
for (const path of ["src/compositor/scene.js", "src/compositor/cutout-effects.js", "src/compositor/vector.js", "src/compositor/depth.js",
  "src/processing/policy.js", "src/engine/pillow.js", "scripts/research/scene-memory-probe.mjs", "scripts/research/scene-memory-worker.js", "wasm/runtime.json"]) {
  const bytes = await readFile(resolve(root, path)); sources.push({ path, byteLength: bytes.length, sha256: hash(bytes) });
}
// Two explicitly recorded server-side variants; production sources are never
// edited by this probe. Each case gets a fresh worker and uncached modules.
const layerBoundary = "layer = source.transformWithInput([plan.width, plan.height], 0, matrix, 3, 1, [0, 0, 0, 0]);";
const subjectBoundary = "subject = source.transformWithInput([plan.width, plan.height], 0, matrix, 3, 1, [0, 0, 0, 0]);";
assert.ok(baselineScene.includes(layerBoundary) && baselineScene.includes(subjectBoundary));
const materializedScene = baselineScene.replace(layerBoundary, `${layerBoundary}\n    layer.load();`)
  .replace(subjectBoundary, `${subjectBoundary} subject.load();`);
const forkScene = materializedScene.replace(layerBoundary, `if (node.depthText) source.load();\n    ${layerBoundary}`);
const variants = depthFork ? [{ id: "materialized", source: materializedScene }, { id: "fork-materialized", source: forkScene }]
  : [{ id: "baseline", source: baselineScene }, { id: "materialized", source: materializedScene }];
const scenes = depthFork ? [["depth-finish", true, true]] : [["cutout", false, false], ["finish", true, false], ["depth-finish", true, true]];
for (const variant of variants) {
  variant.sha256 = hash(variant.source);
  await writeFile(resolve(output, `scene-${variant.id}.js`), variant.source);
}
let activeVariant = variants[0];
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>Scene memory research</title>"); return; }
    const path = resolve(root, pathname.slice(1));
    if (!path.startsWith(`${root}${sep}`) || !["src/", "wasm/", "scripts/research/"].some((prefix) => relative(root, path).startsWith(prefix))) throw new Error("Not served");
    response.setHeader("Content-Type", ({ ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" })[extname(path)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    response.end(pathname === "/src/compositor/scene.js" ? activeVariant.source : await readFile(path));
  } catch { response.statusCode = 404; response.end(); }
});
let browser;
const results = [], externalRequests = [], errors = [];
try {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) { externalRequests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  for (const fixture of fixtures) for (const [label, finish, depth] of scenes) for (const variant of variants) {
    activeVariant = variant;
    const name = `${fixture.photoPath.replace(/\./g, "-")}-${label}-${variant.id}`;
    const photo = await readFile(resolve(output, fixture.photoPath)), mask = await readFile(resolve(output, fixture.maskPath));
    const result = await page.evaluate(({ photo, mask, ...input }) => new Promise((resolve) => {
      const worker = new Worker("/scripts/research/scene-memory-worker.js", { type: "module" });
      const timer = setTimeout(() => { worker.terminate(); resolve({ status: "fail", error: { message: "Research worker timed out after 120 seconds." } }); }, 120_000);
      worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); resolve({ status: "fail", error: { message: event.message } }); };
      worker.onmessage = async ({ data }) => {
        clearTimeout(timer); worker.terminate();
        if (data.bytes) { data.bytes = [...data.bytes]; }
        resolve(data);
      };
      const p = Uint8Array.from(photo), m = Uint8Array.from(mask);
      worker.postMessage({ ...input, photo: p.buffer, mask: m.buffer }, [p.buffer, m.buffer]);
    }), { ...fixture, name, finish, depth, photo: [...photo], mask: [...mask] });
    if (result.bytes) { await writeFile(resolve(output, `${name}.png`), new Uint8Array(result.bytes)); delete result.bytes; }
    results.push({ name, fixture: fixture.photoPath, finish, depth, variant: variant.id, servedSceneSha256: variant.sha256, ...result });
    await writeFile(resolve(output, "partial.json"), JSON.stringify(results, null, 2) + "\n");
    console.log(`${name}: ${result.status}; Wasm ${result.finalHeap ? (result.finalHeap / 1048576).toFixed(1) : "unavailable"} MiB; ${result.error?.message ?? Math.round(result.elapsedMs) + " ms"}`);
  }
  const report = { schema: 1, runId, recordedAt: new Date().toISOString(), environment: { node: process.version, platform: platform(), arch: arch(), os: release(), browser: browser.version() },
    scope: "Sequential fresh-worker lifetime trace of synthetic scenes. Wasm linear-memory observations are not RSS, native live allocations, JavaScript/GPU memory, or physical-phone qualification. Instrumented timings are not throughput benchmarks.",
    comparison: depthFork ? "viewport-versus-depth-source-fork" : "baseline-versus-viewport", baselineSource: { path: relative(root, baselinePath), sha256: hash(baselineScene) },
    wasmSha256: hash(wasmBytes), sources, variants: variants.map(({ id, sha256 }) => ({ id, sha256 })), fixtures, results, externalRequests, errors };
  await writeFile(resolve(output, "result.json"), JSON.stringify(report, null, 2) + "\n");
  assert.equal(results.length, fixtures.length * scenes.length * variants.length); assert.equal(errors.length, 0); assert.equal(externalRequests.length, 0);
  assert.ok(results.every((result) => result.status === "pass"), "Some research cases failed; their evidence is retained.");
  for (let i = 0; i < results.length; i += 2) assert.equal(results[i].output.sha256, results[i + 1].output.sha256, `Materialization changed output: ${results[i].name}`);
  for (const source of sources) assert.equal(hash(await readFile(resolve(root, source.path))), source.sha256, `Source changed during the run: ${source.path}`);
  console.log(`Saved ${relative(root, output)}`);
} finally { await browser?.close(); if (server.listening) await new Promise((done) => server.close(done)); }
