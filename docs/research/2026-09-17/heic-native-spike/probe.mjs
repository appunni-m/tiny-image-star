// Native browser capability observations only; no application code is imported.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const base = dirname(fileURLToPath(import.meta.url));
const kind = process.argv[2];
assert.ok(["chromium", "webkit"].includes(kind), "Choose chromium or webkit explicitly");
const engine = { chromium, webkit }[kind];
const inputBytes = await readFile(resolve(base, "inputs.json"));
const inventory = JSON.parse(inputBytes);
assert.equal(inventory.schema, "tinystar/heic-spike-inputs@1");
assert.ok(inventory.inputs.some((input) => input.encoder_status === 0), "No encoded HEIC input is available");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function runtimeTree(directory) {
  const files = [];
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = resolve(path, entry.name), name = relative(directory, file);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isSymbolicLink()) files.push([name, "link", await readlink(file)]);
      else if (entry.isFile()) files.push([name, "sha256", sha(await readFile(file))]);
      else throw new Error(`Unexpected browser runtime entry: ${name}`);
    }
  }
  await visit(directory);
  return { files: files.length, sha256: sha(JSON.stringify(files)) };
}
const files = new Map();
for (const input of inventory.inputs) {
  if (input.encoder_status !== 0) continue;
  for (const [path, digest] of [[input.source, input.source_sha256], [input.candidate, input.sha256]]) {
    assert.match(path, /^inputs\/(opaque|alpha)\.(png|heic)$/);
    const bytes = await readFile(resolve(base, path));
    assert.equal(sha(bytes), digest, "Spike input changed");
    files.set(`/${path}`, bytes);
  }
}
const workerCode = `onmessage = async ({data}) => {
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([data], { type: "image/heic" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    postMessage({ status: "decoded", width: bitmap.width, height: bitmap.height, pixels: pixels.data }, [pixels.data.buffer]);
  } catch (error) { postMessage({ status: "error", name: error.name, message: error.message }); }
  finally { bitmap?.close(); }
};`;
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; img-src blob: 'self';");
  if (request.url === "/") { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>HEIC capability probe</title>"); }
  else if (request.url === "/worker.js") { response.setHeader("Content-Type", "text/javascript"); response.end(workerCode); }
  else if (files.has(request.url)) { response.setHeader("Content-Type", request.url.endsWith(".heic") ? "image/heic" : "image/png"); response.end(files.get(request.url)); }
  else response.writeHead(404).end();
});
let browser, context;
const observations = [], external = [], errors = [];
const report = { schema: "tinystar/heic-native-observations@1", browser_kind: kind, browser: null,
  executable_sha256: sha(await readFile(engine.executablePath())),
  // WebKit's executable is a launcher; bind the accompanying native runtime too.
  webkit_runtime: kind === "webkit" ? await runtimeTree(dirname(engine.executablePath())) : null,
  input_inventory_sha256: sha(inputBytes), observations, external, errors,
  boundary: "Generated 256x192 basic fixtures; PNG comparison shares the browser stack. Not independent decoder quality, HDR, real picker, memory or physical-phone evidence." };
try {
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await engine.launch({ headless: true, executablePath: engine.executablePath() });
  report.browser = browser.version();
  context = await browser.newContext();
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  const deadline = setTimeout(() => { errors.push("Probe exceeded its 60-second browser deadline"); void context.close().catch(() => {}); }, 60_000);
  page.on("close", () => clearTimeout(deadline));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  for (const input of inventory.inputs.filter((input) => input.encoder_status === 0)) {
    const observation = await page.evaluate(async (input) => {
      const source = await (await fetch(`/${input.source}`)).blob();
      const blob = await (await fetch(`/${input.candidate}`)).blob();
      const reference = await createImageBitmap(source);
      const read = (image, width, height) => {
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d", { colorSpace: "srgb" }); ctx.drawImage(image, 0, 0);
        return { width, height, pixels: ctx.getImageData(0, 0, width, height).data };
      };
      const expected = read(reference, reference.width, reference.height); reference.close();
      const compare = (decoded) => {
        if (decoded.width !== expected.width || decoded.height !== expected.height) return { status: "wrong-dimensions", width: decoded.width, height: decoded.height };
        let rgb = 0, alpha = 0, maxRgb = 0, maxAlpha = 0;
        for (let i = 0; i < expected.pixels.length; i++) {
          const difference = Math.abs(decoded.pixels[i] - expected.pixels[i]);
          if (i % 4 === 3) { alpha += difference; maxAlpha = Math.max(maxAlpha, difference); }
          else { rgb += difference; maxRgb = Math.max(maxRgb, difference); }
        }
        return { status: "decoded", width: decoded.width, height: decoded.height,
          meanRgbDifference: rgb / (expected.width * expected.height * 3), maxRgbDifference: maxRgb,
          meanAlphaDifference: alpha / (expected.width * expected.height), maxAlphaDifference: maxAlpha };
      };
      const result = { id: input.id, bitmap: null, image_element: null, worker: null };
      let bitmap;
      try { bitmap = await createImageBitmap(blob); result.bitmap = compare(read(bitmap, bitmap.width, bitmap.height)); }
      catch (error) { result.bitmap = { status: "error", name: error.name, message: error.message }; }
      finally { bitmap?.close(); }
      const url = URL.createObjectURL(blob), image = new Image();
      try { image.src = url; await image.decode(); result.image_element = compare(read(image, image.naturalWidth, image.naturalHeight)); }
      catch (error) { result.image_element = { status: "error", name: error.name, message: error.message }; }
      finally { image.removeAttribute("src"); URL.revokeObjectURL(url); }
      const worker = new Worker("/worker.js");
      let timer;
      try {
        const bytes = await blob.arrayBuffer();
        const decoded = await new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Native decode exceeded 10 seconds")), 10_000);
          worker.onmessage = ({ data }) => resolve(data);
          worker.onerror = (event) => reject(new Error(event.message));
          worker.postMessage(bytes, [bytes]);
        });
        result.worker = decoded.status === "decoded" ? compare(decoded) : decoded;
      } catch (error) { result.worker = { status: "error", name: error.name, message: error.message }; }
      finally { clearTimeout(timer); worker.terminate(); }
      return result;
    }, input);
    observations.push(observation);
  }
} finally {
  await writeFile(resolve(base, `${kind}-observations.json`), JSON.stringify(report, null, 2) + "\n");
  await context?.close(); await browser?.close();
  if (server.listening) await new Promise((done) => server.close(done));
}
assert.equal(external.length, 0); assert.equal(errors.length, 0);
assert.equal(observations.length, inventory.inputs.filter((input) => input.encoder_status === 0).length);
console.log(JSON.stringify(report, null, 2));
