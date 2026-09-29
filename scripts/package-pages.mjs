import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "_site");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ["index.html", "styles.css"]) await cp(join(root, file), join(output, file));
for (const directory of ["src", "wasm"]) await cp(join(root, directory), join(output, directory), { recursive: true });
await writeFile(join(output, ".nojekyll"), "");
console.log("Packaged the local-first design app and verified WASM runtime for Pages.");
