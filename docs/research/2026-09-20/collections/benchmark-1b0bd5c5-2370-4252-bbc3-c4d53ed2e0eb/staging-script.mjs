import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
export const PINNED_RUNTIME = Object.freeze({
  package: "pillow-rs",
  version: "12.2.0-alpha.1",
  integrity: "sha512-dPPpkm5JBKlsBce+C9cHLxVXfeJvW3HR9psDXhvxjD8PaloJgbR/PnXt5BqO5ftvQX+LdBG1LzhP01m2uvEJgw==",
  sourceCommit: "310788f9fcadc85b02263b383c5a6ea094b000c6",
  provenance: "https://registry.npmjs.org/-/npm/v1/attestations/pillow-rs@12.2.0-alpha.1",
  files: {
    "pillow_rs_js.js": "3d4251ad14e3731e680286d3ea9d8f25af932448596eaa2af09474ebcfd1b5ed",
    "pillow_rs_js_bg.wasm": "08dfff0b10424b6ece937574aefd4c07d1d4f8ac95643e7c4d5138ab720d5a96",
    "PILLOW_RS_LICENSE.txt": "8ca8cadb9e37b8b279e4363b6657fc5764b7090246e98397b0bc2bf9c90a8405",
  },
});
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function verifyRuntime(directory) {
  const recorded = JSON.parse(await readFile(join(directory, "runtime.json"), "utf8"));
  if (JSON.stringify(recorded) !== JSON.stringify(PINNED_RUNTIME)) throw new Error("Runtime metadata differs from the pinned release");
  for (const [name, digest] of Object.entries(PINNED_RUNTIME.files)) {
    if (sha256(await readFile(join(directory, name))) !== digest) throw new Error(`Runtime integrity mismatch: ${name}`);
  }
}

export async function stageRuntime(directory = join(root, "wasm"), { check = false } = {}) {
  // Resolve through the package's exported metadata; the app never deep-imports npm internals.
  const packageRoot = dirname(require.resolve("pillow-rs/package.json"));
  const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  if (metadata.version !== PINNED_RUNTIME.version
      || lock.packages["node_modules/pillow-rs"]?.integrity !== PINNED_RUNTIME.integrity
      || lock.packages[""]?.dependencies?.["pillow-rs"] !== PINNED_RUNTIME.version) {
    throw new Error("Installed Pillow-RS or lockfile does not match the approved exact release");
  }
  const contents = new Map();
  for (const [name, digest] of Object.entries(PINNED_RUNTIME.files)) {
    const source = name === "PILLOW_RS_LICENSE.txt" ? "LICENSE" : `pkg/core/${name}`;
    const bytes = await readFile(join(packageRoot, source));
    if (sha256(bytes) !== digest) throw new Error(`Published package integrity mismatch: ${name}`);
    contents.set(name, bytes);
  }
  if (!check) {
    await mkdir(directory, { recursive: true });
    for (const [name, bytes] of contents) await writeFile(join(directory, name), bytes);
    await writeFile(join(directory, "runtime.json"), `${JSON.stringify(PINNED_RUNTIME, null, 2)}\n`);
  }
  await verifyRuntime(directory);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stageRuntime(undefined, { check: process.argv.includes("--check") });
  console.log(`Pillow-RS ${PINNED_RUNTIME.version}: paired runtime integrity verified.`);
}
