import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { optimizePagesArtifact } from "./optimize-pages.mjs";
import { stageRuntime } from "./stage-pillow-runtime.mjs";
import { checkDocumentPolicy, securityHeadersFile } from "./security-policy.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requestedOutput = process.argv[2] ?? "_site";
const output = resolve(projectRoot, requestedOutput);
const relativeOutput = relative(projectRoot, output);

if (!relativeOutput || relativeOutput === ".." || relativeOutput.startsWith(`..${sep}`) || output === projectRoot) {
  throw new Error(`Pages output must be a child of the repository, not ${output}`);
}

try {
  if ((await lstat(output)).isSymbolicLink()) throw new Error(`Pages output must not be a symbolic link: ${output}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

checkDocumentPolicy(await readFile(`${projectRoot}/index.html`, "utf8"));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(`${projectRoot}/index.html`, `${output}/index.html`);
await writeFile(`${output}/_headers`, securityHeadersFile());
await cp(`${projectRoot}/styles.css`, `${output}/styles.css`);
await cp(`${projectRoot}/src`, `${output}/src`, { recursive: true });
await writeFile(`${output}/src/engine/runtime-assets.js`, "export const USE_BROTLI_WASM = true;\n");
await cp(`${projectRoot}/wasm`, `${output}/wasm`, { recursive: true });
await stageRuntime(`${output}/wasm`);
await optimizePagesArtifact(output);

console.log(`Pages artifact assembled at ${relativeOutput}/`);
