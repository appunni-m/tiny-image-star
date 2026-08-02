import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const allowed = (path) => path === "index.html" || path === "styles.css" || path.startsWith("src/") || path.startsWith("wasm/");
const unexpected = files.filter((path) => !allowed(path));
if (unexpected.length) throw new Error(`Pages artifact contains unexpected files: ${unexpected.join(", ")}`);

const required = [
  "index.html",
  "styles.css",
  "src/main.js",
  "src/worker.js",
  "wasm/pillow_rs_js.js",
  "wasm/pillow_rs_js_bg.wasm",
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

console.log(`Pages artifact OK: ${files.length} files under ${relative(projectRoot, output)}/`);
