import { SECURITY_HEADERS } from "./security-policy.mjs";

const input = process.argv[2];
if (!input) throw new Error("Usage: npm run check:deployment-security -- https://host.example/app/");
const base = new URL(input);
if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || !base.pathname.endsWith("/")) {
  throw new Error("Use an HTTPS application directory URL ending in /, without credentials, query or fragment.");
}
const report = { schema: "tinystar/deployment-security-check@1", recordedAt: new Date().toISOString(), base: base.href, passed: true, responses: [] };
for (const [path, type] of [["", "text/html"], ["src/worker.js", "javascript"], ["src/jobs/large-worker.js", "javascript"], ["wasm/pillow_rs_js_bg.wasm", "application/wasm"]]) {
  const url = new URL(path, base), row = { url: url.href, errors: [] };
  try {
    // Check actual GET responses. HEAD handlers and redirect targets can have
    // different policies; neither may stand in for the loaded worker response.
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20000), cache: "no-store" });
    row.status = response.status;
    row.headers = Object.fromEntries([...Object.keys(SECURITY_HEADERS), "Content-Type"].map((name) => [name, response.headers.get(name)]));
    await response.body?.cancel();
    if (response.status !== 200) row.errors.push(`Expected HTTP 200, received ${response.status}.`);
    const mime = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
    if (!(type === "javascript" ? ["text/javascript", "application/javascript"].includes(mime) : mime === type)) row.errors.push(`Unexpected ${path || "document"} MIME type: ${mime ?? "missing"}.`);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (response.headers.get(name) !== value) row.errors.push(`${name} does not match the reviewed deployment policy.`);
  } catch (error) { row.errors.push(error.message); }
  if (row.errors.length) report.passed = false;
  report.responses.push(row);
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
