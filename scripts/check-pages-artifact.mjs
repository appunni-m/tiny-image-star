import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requestedOutput = process.argv[2] ?? "_site";
const output = resolve(projectRoot, requestedOutput);

async function walk(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(path, name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Pages artifact contains a non-regular entry: ${name}`);
  }
  return files.sort();
}

await access(output, constants.R_OK);
const outputInfo = await stat(output);
if (!outputInfo.isDirectory()) throw new Error(`Pages artifact is not a directory: ${output}`);

const files = await walk(output);
const allowed = (path) => path === "index.html" || path === "styles.css" || path === "styles.css.br" || path.startsWith("src/") || path.startsWith("wasm/");
const unexpected = files.filter((path) => !allowed(path));
if (unexpected.length) throw new Error(`Pages artifact contains unexpected files: ${unexpected.join(", ")}`);

const required = [
  "index.html",
  "styles.css",
  "src/main.js",
  "src/worker.js",
  "wasm/pillow_rs_js.js",
  "wasm/pillow_rs_js_bg.wasm",
  "styles.css.br",
  "src/main.js.br",
  "src/worker.js.br",
  "wasm/pillow_rs_js.js.br",
  "wasm/pillow_rs_js_bg.wasm.br",
];
for (const path of required) {
  const fullPath = join(output, path);
  const info = await stat(fullPath).catch(() => null);
  if (!info?.isFile() || info.size === 0) throw new Error(`Pages artifact is missing a non-empty required file: ${path}`);
}

const index = await readFile(join(output, "index.html"), "utf8");
if (!index.includes("./styles.css") || !index.includes("./src/main.js")) {
  throw new Error("Pages artifact index.html does not reference the checked-in app entry files.");
}

for (const path of ["src/main.js", "src/worker.js", "wasm/pillow_rs_js.js"]) {
  try {
    execFileSync(process.execPath, ["--check", join(output, path)], { stdio: "pipe" });
  } catch (error) {
    throw new Error(`Pages artifact JavaScript is not valid: ${path}\n${error?.stderr?.toString() ?? error?.message ?? error}`);
  }
}

for (const path of ["styles.css", "src/main.js", "src/worker.js", "wasm/pillow_rs_js.js", "wasm/pillow_rs_js_bg.wasm"]) {
  const source = await readFile(join(output, path));
  const compressed = await readFile(join(output, `${path}.br`));
  let decompressed;
  try {
    decompressed = brotliDecompressSync(compressed);
  } catch (error) {
    throw new Error(`Pages artifact Brotli sidecar is invalid: ${path}.br (${error?.message ?? error})`);
  }
  if (!Buffer.from(decompressed).equals(Buffer.from(source))) {
    throw new Error(`Pages artifact Brotli sidecar does not match its source: ${path}.br`);
  }
}

console.log(`Pages artifact OK: ${files.length} files under ${relative(projectRoot, output)}/`);
