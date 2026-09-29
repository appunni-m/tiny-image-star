import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

if (!process.argv[2] || process.argv.slice(3).some((arg) => arg !== "--screenshot")) throw new Error("Usage: node scripts/research/segmentation-report.mjs RUN_DIRECTORY [--screenshot]");
const dir = resolve(process.argv[2]), result = JSON.parse(await readFile(`${dir}/results.json`, "utf8"));
if (!result.finishedAt) throw new Error("Do not report an unfinished run");
const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const median = (values) => { const a = [...values].sort((a, b) => a - b), i = Math.floor(a.length / 2); return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2; };
const number = (value) => value == null ? "—" : value.toFixed(1);
const rows = result.cases.map((entry) => {
  const timings = entry.reports?.flatMap((report) => report.timings) ?? [];
  return { id: entry.id, status: entry.type, initMs: entry.initMs ?? null,
    maskCallMedianMs: timings.length ? median(timings) : null,
    maskCallRangeMs: timings.length ? [Math.min(...timings), Math.max(...timings)] : null,
    setImageCallMs: entry.reports?.map(({ file, setImageMs, encodeMs }) => ({ file, ms: setImageMs ?? encodeMs ?? null })) ?? [],
    peakObservedWasmMiB: entry.timeline?.length ? Math.max(...entry.timeline.map((entry) => entry.wasmBytes)) / 1048576 : null,
    wallMs: entry.wallMs ?? null, mainThreadIntervalMaxMs: entry.maxMainThreadIntervalGapMs ?? null,
    renderer: entry.renderer ?? null, externalRequests: entry.externalRequests, failure: entry.message ?? null };
});
await writeFile(`${dir}/summary.json`, JSON.stringify({ runId: result.runId, rows }, null, 2) + "\n");
const artifacts = [];
for (const name of (await readdir(dir)).filter((name) => name.endsWith(".png") && name !== "review.png").sort()) {
  const bytes = await readFile(`${dir}/${name}`); artifacts.push({ name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await writeFile(`${dir}/artifacts.json`, JSON.stringify(artifacts, null, 2) + "\n");
const existing = new Set(artifacts.map((entry) => entry.name));
const models = ["selfie-CPU", "multiclass-CPU", "interactive-v2-CPU"];
const figure = (title, image, mask) => `<figure><figcaption>${esc(title)}</figcaption>${existing.has(image) ? `<a href="${image}" class="checker"><img src="${image}" alt="${esc(title)} result"></a>${mask ? `<details><summary>Inspect mask</summary><a href="${mask}"><img src="${mask}" alt="${esc(title)} mask"></a></details>` : ""}` : "<p>No successful output in this run.</p>"}</figure>`;
const gallery = ["astronaut", "chelsea", "coffee"].map((name) => `<section><h2>${name}</h2><div class="grid">${figure("Original", `${name}.png`)}${models.map((id) => figure(id, `${id}-${name}-cutout.png`, `${id}-${name}-mask.png`)).join("")}</div></section>`).join("");
const table = `<div class="table"><table><thead><tr><th>Case</th><th>Result</th><th>Init ms</th><th>Mask call median ms</th><th>Observed Wasm MiB</th><th>Total wall ms</th></tr></thead><tbody>${rows.map((entry) => `<tr><td>${esc(entry.id)}</td><td>${esc(entry.failure ?? entry.status)}</td><td>${number(entry.initMs)}</td><td>${number(entry.maskCallMedianMs)}</td><td>${number(entry.peakObservedWasmMiB)}</td><td>${number(entry.wallMs)}</td></tr>`).join("")}</tbody></table></div>`;
await writeFile(`${dir}/review.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Segmentation research — ${esc(basename(dir))}</title><style>
*{box-sizing:border-box}body{margin:0 auto;padding:28px;max-width:1400px;font:16px/1.5 system-ui;color:#1d2935;background:#f5f4f0}h1{margin:0;font-size:28px}h2{margin:12px 0 8px}p{max-width:1050px;margin:8px 0}.note{padding:12px 16px;background:#fff0ce;border-left:4px solid #8b6500;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}figure{margin:0;padding:10px;background:white;border:1px solid #cbd3da;border-radius:8px}figcaption{font-weight:650;margin-bottom:8px}img{display:block;width:100%;height:250px;object-fit:contain}.checker{display:block;background:repeating-conic-gradient(#e1e5e7 0% 25%,#fff 0% 50%) 50%/20px 20px}details{margin-top:8px}summary{cursor:pointer;min-height:32px}.table{overflow:auto;margin-top:24px}table{border-collapse:collapse;width:100%;background:white;font-size:14px}th,td{text-align:left;padding:8px;border:1px solid #cbd3da}footer{margin-top:20px;font-size:14px}@media(max-width:700px){body{padding:16px}.grid{grid-template-columns:1fr 1fr}img{height:200px}}
</style><h1>Segmentation: measured research probes</h1><p>${esc(result.runId)} · ${esc(result.browser)} · ${esc(result.platform.platform)}/${esc(result.platform.arch)}</p><div class="note">Three small public-domain/CC0 images, no ground-truth mattes. These are exploratory results, not production quality or phone performance qualification. Portrait models are intentionally shown on out-of-task pet/product probes. Interactive v2 uses a supplied positive point.</div>${gallery}${table}<p>Mask calls include inference, readback, validation and byte conversion. The additional interactive setImage() call time does not isolate encoder execution; see <a href="summary.json">summary</a>. GPU cases used the recorded renderer, which may be software SwiftShader. Wasm memory excludes JS, graphics and process overhead.</p><p><a href="results.json">Full results and network attempts</a> · <a href="artifacts.json">Image hashes</a> · <a href="inputs.json">Pinned inputs</a></p><footer>Images: NASA/Eileen Collins portrait (public domain); Chelsea by Stefan van der Walt (CC0); coffee by Rachel Michetti, courtesy Pikolo Espresso Bar (CC0). Source: scikit-image v0.25.2. <a href="https://scikit-image.org/docs/stable/api/skimage.data.html">Provenance</a>. Derived cutouts and masks were generated locally. No endorsement is implied.</footer></html>`);
console.log(`${dir}/review.html`);
if (process.argv.includes("--screenshot")) {
  const { chromium } = await import("playwright"), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(`${dir}/review.html`).href);
    await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
    await page.screenshot({ path: `${dir}/review.png`, fullPage: true });
  } finally { await browser.close(); }
}
