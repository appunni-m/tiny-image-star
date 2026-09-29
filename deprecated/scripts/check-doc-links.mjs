import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const ignoredDirectories = new Set([".git", "node_modules", "_site", ".segmentation-cache"]);

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && [".md", ".markdown"].includes(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

function localTarget(rawTarget) {
  const target = rawTarget.trim().replace(/^<|>$/g, "").split(/\s+/)[0];
  if (!target || target.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(target) || /^mailto:/i.test(target)) return null;
  const withoutFragment = target.split(/[?#]/, 1)[0];
  return withoutFragment ? decodeURIComponent(withoutFragment) : ".";
}

const failures = [];
const markdown = await markdownFiles(projectRoot);
const linkPattern = /\[[^\]]*\]\(([^)\n]+)\)/g;
for (const file of markdown) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(linkPattern)) {
    const target = localTarget(match[1]);
    if (target === null) continue;
    const destination = resolve(dirname(file), target);
    try {
      await access(destination, constants.F_OK);
    } catch {
      const line = source.slice(0, match.index).split("\n").length;
      failures.push(`${relative(projectRoot, file)}:${line} -> ${target}`);
    }
  }
}

if (failures.length) {
  throw new Error(`Broken local documentation links:\n${failures.join("\n")}`);
}

console.log(`Documentation links OK: ${markdown.length} Markdown files checked.`);
