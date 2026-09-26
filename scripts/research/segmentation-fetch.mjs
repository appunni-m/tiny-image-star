// Reproduce the research cache only. No npm install, lifecycle hooks or app edits.
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2), check = args.includes("--check"), cacheArg = args.find((arg) => arg.startsWith("--cache="));
if (args.some((arg) => arg !== "--check" && !arg.startsWith("--cache="))) throw new Error("Usage: node scripts/research/segmentation-fetch.mjs [--check] [--cache=PATH]");
const cache = cacheArg ? resolve(cacheArg.slice(8)) : resolve(root, ".segmentation-cache");
const manifestPath = resolve(root, "docs/research/2026-09-17/segmentation/inputs.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const digest = (bytes, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding);
const valid = (bytes, entry) => bytes.length === entry.bytes && digest(bytes) === entry.sha256;
const readIfPresent = async (path) => { try { return await readFile(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
async function download(url, maxBytes) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: "error" });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw new Error(`Download exceeds byte limit: ${url}`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, bytes, { flag: "wx" }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
for (const entry of [...manifest.sdk.files.map((entry) => ({ ...entry, name: entry.path })), ...manifest.files]) {
  if (!/^[\w./-]+$/.test(entry.name) || entry.name.split("/").some((part) => ["", ".", ".."].includes(part))) throw new Error(`Unsafe manifest path: ${entry.name}`);
}
const missingSdk = [];
for (const entry of manifest.sdk.files) {
  const bytes = await readIfPresent(`${cache}/sdk/${entry.path}`);
  if (!bytes) { if (check) throw new Error(`Missing SDK file: ${entry.path}`); missingSdk.push(entry); }
  else if (!valid(bytes, entry)) throw new Error(`SDK hash/size mismatch: ${entry.path}; existing data was not replaced`);
}
if (missingSdk.length) {
  const archivePath = `${cache}/sdk.tgz`, existing = await readIfPresent(archivePath);
  const archive = existing ?? await download(manifest.sdk.url, 80 * 1024 * 1024);
  if (`sha512-${digest(archive, "sha512", "base64")}` !== manifest.sdk.integrity) throw new Error("SDK tarball integrity mismatch");
  if (!existing) await atomicWrite(archivePath, archive);
  // Extract each whitelisted member to stdout: no archive path, link or mode
  // gets permission to write into the filesystem. Validate before saving.
  for (const entry of missingSdk) {
    const bytes = execFileSync("tar", ["-xOf", archivePath, `package/${entry.path}`], { maxBuffer: entry.bytes + 1 });
    if (!valid(bytes, entry)) throw new Error(`SDK member mismatch: ${entry.path}`);
    await atomicWrite(`${cache}/sdk/${entry.path}`, bytes);
  }
}
for (const entry of manifest.files) {
  const path = `${cache}/assets/${entry.name}`, existing = await readIfPresent(path);
  if (existing) { if (!valid(existing, entry)) throw new Error(`Asset hash/size mismatch: ${entry.name}; existing data was not replaced`); }
  else {
    if (check) throw new Error(`Missing asset: ${entry.name}`);
    const bytes = await download(entry.url, entry.bytes);
    if (!valid(bytes, entry)) throw new Error(`Downloaded asset mismatch: ${entry.name}`);
    await atomicWrite(path, bytes);
  }
}
console.log(`Verified ${manifest.sdk.files.length} SDK files and ${manifest.files.length} assets in ${cache}`);
