import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const version = "12.2.0-alpha.1";
const integrity = "sha512-dPPpkm5JBKlsBce+C9cHLxVXfeJvW3HR9psDXhvxjD8PaloJgbR/PnXt5BqO5ftvQX+LdBG1LzhP01m2uvEJgw==";
const expected = {
  "pillow_rs_js.js": "3d4251ad14e3731e680286d3ea9d8f25af932448596eaa2af09474ebcfd1b5ed",
  "pillow_rs_js_bg.wasm": "08dfff0b10424b6ece937574aefd4c07d1d4f8ac95643e7c4d5138ab720d5a96",
  "PILLOW_RS_LICENSE.txt": "8ca8cadb9e37b8b279e4363b6657fc5764b7090246e98397b0bc2bf9c90a8405",
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const packageRoot = dirname(require.resolve("pillow-rs/package.json"));
const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
if (metadata.version !== version || lock.packages["node_modules/pillow-rs"]?.integrity !== integrity || lock.packages[""]?.dependencies?.["pillow-rs"] !== version) {
  throw new Error("Installed Pillow-RS or lockfile does not match the pinned local runtime");
}
const files = new Map([
  ["pillow_rs_js.js", join(packageRoot, "pkg/core/pillow_rs_js.js")],
  ["pillow_rs_js_bg.wasm", join(packageRoot, "pkg/core/pillow_rs_js_bg.wasm")],
  ["PILLOW_RS_LICENSE.txt", join(packageRoot, "LICENSE")],
]);
const wasmDirectory = join(root, "wasm");
await mkdir(wasmDirectory, { recursive: true });
for (const [name, source] of files) {
  const bytes = await readFile(source);
  if (digest(bytes) !== expected[name]) throw new Error(`Pinned Pillow-RS runtime integrity mismatch: ${name}`);
  await copyFile(source, join(wasmDirectory, name));
}
const runtime = {
  package: "pillow-rs", version, integrity,
  sourceCommit: "310788f9fcadc85b02263b383c5a6ea094b000c6",
  files: Object.fromEntries(Object.entries(expected)),
};
await writeFile(join(wasmDirectory, "runtime.json"), `${JSON.stringify(runtime, null, 2)}\n`);
console.log(`Verified and staged local Pillow-RS WebAssembly ${version}.`);
