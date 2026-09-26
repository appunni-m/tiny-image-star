import { createServer } from "node:http";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), cache = resolve(process.env.TINY_IMAGE_STAR_SEGMENT_CACHE ?? resolve(root, ".segmentation-cache"));
const evidenceRoot = resolve(root, "docs/research/2026-09-17/segmentation"), manifest = JSON.parse(await readFile(`${evidenceRoot}/inputs.json`, "utf8"));
const runId = `segmentation-${randomUUID()}`, output = resolve(evidenceRoot, "runs", runId); await mkdir(output, { recursive: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
await cp(`${evidenceRoot}/inputs.json`, `${output}/inputs.json`);
const sources = {};
for (const file of ["segmentation-bakeoff.mjs", "segmentation-worker.js"]) {
  const bytes = await readFile(`${root}/scripts/research/${file}`);
  sources[file] = sha(bytes); await writeFile(`${output}/${file}.txt`, bytes);
}
for (const entry of [...manifest.sdk.files.map((entry) => ({ ...entry, name: entry.path, root: `${cache}/sdk` })), ...manifest.files.map((entry) => ({ ...entry, root: `${cache}/assets` }))]) {
  const data = await readFile(`${entry.root}/${entry.name}`);
  if (data.length !== entry.bytes || sha(data) !== entry.sha256) throw new Error(`Pinned asset mismatch: ${entry.name}`);
}
const inputs = [{ file: "astronaut.png", point: { x: .45, y: .4 } }, { file: "chelsea.png", point: { x: .55, y: .5 } }, { file: "coffee.png", point: { x: .45, y: .6 } }];
const cases = [];
for (const [id, file, interactive] of [["selfie", "selfie.tflite", false], ["multiclass", "multiclass.tflite", false], ["interactive-v2", "interactive.task", true]])
  for (const delegate of ["CPU", "GPU"]) cases.push({ id: `${id}-${delegate}`, file, interactive, delegate });
cases.push({ id: "selfie-CPU-nosimd", file: "selfie.tflite", interactive: false, delegate: "CPU", noSimd: true });
cases.push({ id: "selfie-CPU-no-webgl", file: "selfie.tflite", interactive: false, delegate: "CPU", noWebGL: true });
cases.push({ id: "selfie-CPU-csp", file: "selfie.tflite", interactive: false, delegate: "CPU", csp: true });
cases.push({ id: "selfie-CPU-blob-csp", file: "selfie.tflite", interactive: false, delegate: "CPU", blobCsp: true });
const selection = process.env.TINY_IMAGE_STAR_SEGMENT_CASES?.split(",");
if (selection?.some((id) => !cases.some((entry) => entry.id === id))) throw new Error("Unknown research case");
// Fixed seeded order avoids always warming the same model first. This is a
// functional bake-off with timing observations, not the phase-5 benchmark.
let state = 0x517e2026;
const selected = cases.filter((entry) => !selection || selection.includes(entry.id));
for (let i = selected.length - 1; i > 0; i--) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; const j = (state >>> 0) % (i + 1); [selected[i], selected[j]] = [selected[j], selected[i]]; }
const summary = { schema: 1, runId, startedAt: new Date().toISOString(), manifestSha256: sha(await readFile(`${evidenceRoot}/inputs.json`)),
  sources, sdk: { name: manifest.sdk.name, version: manifest.sdk.version, integrity: manifest.sdk.integrity }, requestedCases: selected.map((entry) => entry.id),
  repetitions: 5, notes: ["One inference worker at a time; each is terminated after its case.", "Local HTTP files; modelReadMs is not internet download latency.",
    "Wasm linear memory only, not process RSS or complete JS/GPU memory.", "Three public-domain/CC0 probes have no ground-truth mattes and do not qualify visual quality or subgroup fairness.",
    "The 2023 MagicTouch card does not establish the 2026 v2 artifact's exact model/license identity.",
    "Timings include synchronous inference, confidence readback, range validation and byte-mask conversion.",
    "GPU timings must be interpreted with the recorded renderer; SwiftShader is not hardware GPU performance."], cases: [] };
const save = () => writeFile(`${output}/results.json`, JSON.stringify(summary, null, 2) + "\n");
const workerPolicy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'; img-src 'self' blob:";
const documentPolicy = workerPolicy.replace("worker-src 'self'", "worker-src 'self' blob:");
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost"), path = url.pathname;
    if (path === "/research/segmentation-worker.js" && url.searchParams.get("csp") === "1") response.setHeader("Content-Security-Policy", workerPolicy);
    if (path === "/") { response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><meta charset="utf-8">${url.searchParams.get("csp") === "1" ? `<meta http-equiv="Content-Security-Policy" content="${documentPolicy}">` : ""}<title>Local segmentation research</title><p>Research only</p>`); return; }
    const mapping = [["/sdk/", `${cache}/sdk`], ["/assets/", `${cache}/assets`], ["/src/", `${root}/src`], ["/wasm/", `${root}/wasm`], ["/research/", `${root}/scripts/research`]];
    const match = mapping.find(([prefix]) => path.startsWith(prefix)); if (!match) throw new Error("Not found");
    const file = resolve(match[1], path.slice(match[0].length)); if (!file.startsWith(match[1] + "/")) throw new Error("Outside root");
    response.setHeader("Content-Type", { ".js": "text/javascript", ".wasm": "application/wasm", ".png": "image/png" }[extname(file)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", "no-store"); response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end("Not found"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done)); const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  summary.browser = browser.version(); summary.platform = { platform: process.platform, arch: process.arch, node: process.version };
  for (const entry of selected) {
    console.log(`Starting ${entry.id}`); const context = await browser.newContext(), page = await context.newPage(), external = [], logs = [];
    page.on("console", (message) => { if (["warning", "error"].includes(message.type()) && logs.length < 100) logs.push({ type: message.type(), text: message.text().slice(0, 1500) }); });
    await context.route("**/*", (route) => { if (!route.request().url().startsWith(origin + "/")) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
    try {
      await page.goto(entry.blobCsp ? `${origin}/?csp=1` : origin); const model = manifest.files.find((file) => file.name === entry.file);
      const result = await page.evaluate((options) => new Promise((resolve) => {
        const started = performance.now();
        const blobUrl = options.blobCsp ? URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(`${location.origin}/research/segmentation-worker.js`)});`], { type: "text/javascript" })) : null;
        const worker = new Worker(blobUrl ?? `/research/segmentation-worker.js${options.csp ? "?csp=1" : ""}`); let previous = started, maxGapMs = 0;
        const tick = setInterval(() => { const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - previous); previous = now; }, 25);
        const finish = (result) => { clearTimeout(timeout); clearInterval(tick); worker.terminate(); if (blobUrl) URL.revokeObjectURL(blobUrl); window.segmentationResult = result;
          resolve({ ...result, reports: result.reports?.map(({ mask, ...report }) => report), wallMs: performance.now() - started, maxMainThreadIntervalGapMs: maxGapMs,
            browserHints: { hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null, crossOriginIsolated } }); };
        const timeout = setTimeout(() => finish({ type: "failure", message: "Research case exceeded 120 seconds" }), 120000);
        worker.onmessage = ({ data }) => finish(data); worker.onerror = (error) => finish({ type: "failure", message: error.message }); worker.postMessage(options);
      }), { ...entry, sha256: model.sha256, inputs, repetitions: 5 });
      const record = { id: entry.id, modelSha256: model.sha256, workerCsp: entry.csp ? workerPolicy : null, documentCsp: entry.blobCsp ? documentPolicy : null, ...result, externalRequests: external, console: logs }; summary.cases.push(record);
      if (result.type === "result") {
        const artifacts = await page.evaluate(async () => {
          const { createPillowEngine } = await import("/src/engine/pillow.js"); await createPillowEngine(); const api = await import("/wasm/pillow_rs_js.js");
          const base64 = (bytes) => { let string = ""; for (let i = 0; i < bytes.length; i += 32768) string += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(string); };
          const artifacts = [];
          for (const report of window.segmentationResult.reports) {
            let source, rgba, mask, scaled, alpha, product;
            try {
              source = api.Image.open(new Uint8Array(await (await fetch(`/assets/${report.file}`)).arrayBuffer())); rgba = source.convert("RGBA", null);
              mask = api.fromBytesFn("L", report.maskWidth, report.maskHeight, new Uint8Array(report.mask), "raw"); scaled = mask.resize(rgba.width, rgba.height, "LANCZOS");
              alpha = rgba.getchannel(3); product = api.ImageChops.multiply(alpha, scaled); rgba.putalphaImageInput(product);
              artifacts.push({ file: report.file, mask: base64(scaled.saveWithInput("PNG", null)), cutout: base64(rgba.saveWithInput("PNG", null)) });
            } finally { product?.free(); alpha?.free(); scaled?.free(); mask?.free(); if (rgba !== source) rgba?.free(); source?.free(); }
          }
          window.segmentationResult = null; return artifacts;
        });
        for (const artifact of artifacts) for (const kind of ["mask", "cutout"]) await writeFile(`${output}/${entry.id}-${artifact.file.replace(/\.png$/, "")}-${kind}.png`, Buffer.from(artifact[kind], "base64"));
      }
      console.log(`${entry.id}: ${result.type}${result.message ? ` — ${result.message}` : ` — ${Math.round(result.wallMs)} ms, ${Math.round(Math.max(...result.timeline.map((entry) => entry.wasmBytes)) / 1048576)} MiB Wasm`}`);
    } catch (error) { summary.cases.push({ id: entry.id, type: "harness-failure", message: error.message, console: logs, externalRequests: external }); console.log(`${entry.id}: harness-failure ${error.message}`); }
    finally { await context.close(); await save(); }
  }
  for (const input of inputs) await cp(`${cache}/assets/${input.file}`, `${output}/${input.file}`);
  summary.finishedAt = new Date().toISOString(); await save(); console.log(`Research saved to ${output}`);
} finally { await browser.close(); await new Promise((done) => server.close(done)); }
