import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { checkDocumentPolicy, SECURITY_HEADERS, securityHeadersFile } from "./security-policy.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const root = resolve(process.env.TINY_IMAGE_STAR_BROWSER_ROOT ?? projectRoot);
const index = await readFile(`${root}/index.html`, "utf8");
checkDocumentPolicy(index);
if (root !== projectRoot) assert.equal(await readFile(`${root}/_headers`, "utf8"), securityHeadersFile());
const fixture = Buffer.from((await readFile(`${projectRoot}/tests/fixtures/rgb-small.png.base64`, "utf8")).trim(), "base64");
const probes = await readFile(`${projectRoot}/tests/helpers/csp-probe.js`, "utf8");
const report = { schema: "tinystar/csp-browser-verification@1", root, runs: [] };
const sinkRequests = [];
const listen = (server) => new Promise((done) => server.listen(0, "127.0.0.1", () => done(`http://127.0.0.1:${server.address().port}`)));
const close = (server) => new Promise((done) => { server.closeAllConnections(); server.close(done); });
const sinkServer = createServer((request, response) => {
  sinkRequests.push({ method: request.method, path: request.url });
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Content-Type", "text/javascript");
  response.end("globalThis.__externalExecuted = true;");
});
const sink = await listen(sinkServer);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".ttf": "font/ttf" };

function checkProbes(result, label, document = false, requireEvents = true) {
  for (const name of ["eval", "function", "fetch", "post", "redirect", "import", "wasm", "blob"]) assert.equal(result[name], true, `${label}: ${name}`);
  assert.equal(result.executed, false, `${label}: forbidden code does not run`);
  if (document) for (const name of ["inlineStyleBlocked", "styleProperty", "baseUnchanged", "beaconBlocked", "font", "blobWorker"]) assert.equal(result[name], true, `${label}: ${name}`);
  // Some engines use the fallback directive name for CSP3 element/attribute
  // violations. Check the enforced category, while retaining exact events.
  const categories = new Set(result.violations.map((item) => item.directive.replace(/-(?:elem|attr)$/, "")));
  for (const name of !requireEvents ? [] : document ? ["script-src", "style-src", "connect-src", "font-src", "img-src", "worker-src", "frame-src", "object-src", "base-uri", "form-action"] : ["script-src", "connect-src"]) assert.ok(categories.has(name), `${label}: observed ${name} enforcement: ${JSON.stringify(result)}`);
  assert.ok(result.violations.every((item) => item.disposition === "enforce"), `${label}: not report-only`);
}

try {
  for (const browserName of (process.env.TINY_IMAGE_STAR_SECURITY_BROWSERS ?? "chromium").split(",")) {
    const browserType = { chromium, webkit }[browserName];
    assert.ok(browserType, `Unsupported test browser ${browserName}`);
    const browser = await browserType.launch({ headless: true });
    try {
      for (const mode of ["meta", "headers"]) {
        const requestsBefore = sinkRequests.length;
        const server = createServer(async (request, response) => {
          try {
            const url = new URL(request.url, "http://localhost");
            if (mode === "headers") for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
            response.setHeader("Content-Type", "text/javascript");
            if (url.pathname === "/__security/probe.js") return response.end(probes);
            if (url.pathname === "/__security/document.js") return response.end(`import { runDocumentProbes } from './probe.js'; const button=document.createElement('button'); button.id='run-csp-probes'; button.textContent='Run probes'; button.onclick=async()=>{try{window.__cspResult=await runDocumentProbes(${JSON.stringify(sink)});}catch(error){window.__cspError=error.stack;}}; document.body.append(button);`);
            if (url.pathname === "/__security/worker.js") return response.end(`import { runCodeProbes } from './probe.js'; runCodeProbes(${JSON.stringify(sink)}).then(result=>postMessage(result)).catch(error=>postMessage({error:error.stack}));`);
            if (url.pathname === "/__security/redirect") { response.writeHead(302, { Location: `${sink}/redirect` }); return response.end(); }
            if (url.pathname === "/__security/embed") { response.removeHeader("Content-Security-Policy"); response.setHeader("Content-Type", "text/html"); return response.end('<!doctype html><iframe src="/" onload="document.body.dataset.frameLoaded=\'true\'"></iframe>'); }
            const path = resolve(root, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
            if (!path.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
            const bytes = await readFile(path);
            response.setHeader("Content-Type", mime[extname(path)] ?? "application/octet-stream"); response.end(bytes);
          } catch { response.writeHead(404).end(); }
        });
        const origin = await listen(server);
        const context = await browser.newContext({ viewport: { width: 375, height: 667 }, acceptDownloads: true });
        try {
          const page = await context.newPage(), errors = [], violations = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.exposeFunction("recordCspViolation", (event) => violations.push(event));
          await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (event) => window.recordCspViolation({ directive: event.effectiveDirective, blocked: event.blockedURI })));
          const response = await page.goto(origin, { waitUntil: "networkidle" });
          assert.equal(response.headers()["content-security-policy"] ?? null, mode === "headers" ? SECURITY_HEADERS["Content-Security-Policy"] : null);
          await page.waitForFunction(() => document.querySelector("#engine-status")?.textContent === "Ready");
          await page.locator("#file-input").setInputFiles({ name: "csp-fixture.png", mimeType: "image/png", buffer: fixture });
          await page.waitForFunction(() => !document.querySelector("#save-button").disabled);
          // Real concurrent app workers, published WASM, same-origin verified
          // fonts, FontFace from bytes, native decoding and a blob download.
          const workflow = await page.evaluate(async (base64) => {
            const { getProcessingScheduler } = await import("./src/processing/client.js");
            const { imageWork } = await import("./src/processing/policy.js");
            const { storyFonts, loadStoryFont } = await import("./src/styles/font-pack.js");
            const pool = getProcessingScheduler(); await pool.ready(); pool.configure({ fixedConcurrency: 2 });
            const source = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
            const outputs = []; let peak = 0;
            const unsubscribe = pool.subscribe((state) => { peak = Math.max(peak, state.active); });
            await Promise.all(Array.from({ length: 4 }, (_, id) => pool.enqueue({
              estimate: imageWork({ width: 8, height: 8, encodedBytes: source.length }),
              prepare: () => { const bytes = source.slice().buffer; return { message: { type: "process", revision: id, jobId: "csp", files: [{ id, name: "fixture.png", bytes }], settings: { format: "png", brightness: 1, contrast: 1 } }, transfer: [bytes] }; },
              onMessage: (message) => { if (message.type === "result") outputs.push(message.output); },
            }).promise));
            unsubscribe(); pool.configure({ mode: "auto" });
            const font = storyFonts()[0], fontBlob = await loadStoryFont(font);
            const face = await new FontFace("SecurityTestFont", await fontBlob.arrayBuffer(), font.fontFace).load(); document.fonts.add(face);
            const output = new Blob([outputs[0]], { type: "image/png" }), url = URL.createObjectURL(output);
            const image = new Image(); image.src = url; await image.decode();
            const anchor = document.createElement("a"); anchor.id = "security-download"; anchor.href = url; anchor.download = "security-output.png"; anchor.textContent = "Download CSP test"; document.body.append(anchor);
            return { count: outputs.length, peak, dimensions: [image.naturalWidth, image.naturalHeight], font: face.status, bytes: output.size };
          }, fixture.toString("base64"));
          assert.deepEqual(workflow.dimensions, [8, 8]); assert.equal(workflow.count, 4); assert.equal(workflow.peak, 2); assert.equal(workflow.font, "loaded"); assert.ok(workflow.bytes > 0);
          const downloadEvent = page.waitForEvent("download"); await page.locator("#security-download").click(); const download = await downloadEvent; assert.equal(download.suggestedFilename(), "security-output.png"); assert.equal(await download.failure(), null);
          assert.deepEqual(violations, [], `${browserName}/${mode}: legitimate app operations do not violate CSP`);
          assert.deepEqual(errors, [], `${browserName}/${mode}: app page errors`);
          await page.addScriptTag({ url: `${origin}/__security/document.js`, type: "module" });
          await page.locator("#run-csp-probes").click();
          await page.waitForFunction(() => window.__cspResult || window.__cspError);
          const documentResult = await page.evaluate(() => window.__cspResult ?? { error: window.__cspError });
          checkProbes(documentResult, `${browserName}/${mode} document`, true);
          assert.equal(sinkRequests.length, requestsBefore, "document probes reach no foreign receiver");
          const workerResult = await page.evaluate(() => new Promise((resolve, reject) => {
              const worker = new Worker("/__security/worker.js", { type: "module" });
              const timeout = setTimeout(() => { worker.terminate(); reject(new Error("worker probe timeout")); }, 10000);
              worker.onmessage = ({ data }) => { clearTimeout(timeout); worker.terminate(); resolve(data); };
              worker.onerror = (event) => { clearTimeout(timeout); worker.terminate(); reject(new Error(event.message)); };
          }));
          if (mode === "headers") {
            // This WebKit build blocks the operations but exposes no worker
            // violation events. Exceptions + zero receiver traffic + the meta
            // negative control establish enforcement independently of events.
            checkProbes(workerResult, `${browserName}/${mode} worker`, false, browserName === "chromium");
            assert.equal(sinkRequests.length, requestsBefore, "HTTP-protected worker reaches no foreign receiver");
          } else {
            for (const name of ["eval", "function", "fetch", "post", "redirect", "import"]) assert.equal(workerResult[name], false, `negative control: document meta does not protect worker ${name}`);
            assert.equal(workerResult.executed, true, "unprotected worker runs the synthetic code control");
            assert.deepEqual(sinkRequests.slice(requestsBefore), [
              { method: "GET", path: "/fetch" }, { method: "POST", path: "/post" },
              { method: "GET", path: "/redirect" }, { method: "GET", path: "/module.js" },
            ], "unprotected negative control proves the receiver and requests work");
          }
          await page.goto(`${origin}/__security/embed`);
          await page.waitForFunction(() => document.body.dataset.frameLoaded === "true");
          assert.equal(await page.locator("iframe").evaluate((frame) => { try { return !!frame.contentDocument?.querySelector("#engine-status"); } catch { return false; } }), mode === "meta", "only HTTP policy prevents framing the app");
          report.runs.push({ browser: browserName, version: browser.version(), mode, workflow, document: documentResult, worker: workerResult, documentSinkRequests: 0, workerSinkRequests: sinkRequests.slice(requestsBefore), framingBlocked: mode === "headers" });
          console.log(`verify:security ${browserName}/${mode} PASS (document${mode === "headers" ? " + worker + embedding" : " only; unprotected-worker negative control confirmed"}, real WASM/font/2-worker export/download)`);
        } finally { await context.close(); await close(server); }
      }
    } finally { await browser.close(); }
  }
  if (process.env.TINY_IMAGE_STAR_SECURITY_REPORT) await writeFile(process.env.TINY_IMAGE_STAR_SECURITY_REPORT, `${JSON.stringify(report, null, 2)}\n`);
} finally { await close(sinkServer); }
