import { readdir, stat } from "node:fs/promises";
import { statSync, watchFile, unwatchFile } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const verifyPath = join(projectRoot, "scripts/verify.mjs");
const watchedRoots = ["src", "scripts", "tests"];
const watchedFiles = ["index.html", "styles.css"];
const relevantExtensions = new Set([".js", ".mjs", ".html", ".css", ".base64", ".wasm"]);
const watchedPaths = [];
let debounceTimer = null;
let running = false;
let queued = false;

async function filesUnder(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(path));
    else if (relevantExtensions.has(extname(entry.name))) found.push(path);
  }
  return found;
}

function schedule(reason) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runVerification(reason), 250);
}

function runVerification(reason) {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  console.log(`\nverify:watch running (${reason})`);
  const child = spawn(process.execPath, [verifyPath], { cwd: projectRoot, stdio: "inherit" });
  child.once("close", (code) => {
    running = false;
    console.log(`verify:watch ${code === 0 ? "PASS" : `FAIL (exit ${code ?? 1})`}`);
    if (queued) {
      queued = false;
      schedule("queued change");
    }
  });
  child.once("error", (error) => {
    running = false;
    console.error(`verify:watch could not start verification: ${error.message}`);
  });
}

for (const rootName of watchedRoots) {
  const root = join(projectRoot, rootName);
  if (await stat(root).then(() => true).catch(() => false)) watchedPaths.push(...await filesUnder(root));
}
for (const fileName of watchedFiles) {
  const filePath = join(projectRoot, fileName);
  if (statSync(filePath, { throwIfNoEntry: false })) watchedPaths.push(filePath);
}

for (const path of watchedPaths) {
  watchFile(path, { interval: 200, persistent: true }, (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) schedule(path.slice(projectRoot.length + 1));
  });
}

process.on("SIGINT", () => {
  for (const path of watchedPaths) unwatchFile(path);
  clearTimeout(debounceTimer);
  process.exit(0);
});

runVerification("initial");
console.log(`verify:watch watching ${watchedPaths.length} source/test files with 200ms polling and 250ms debounce. Press Ctrl+C to stop.`);
