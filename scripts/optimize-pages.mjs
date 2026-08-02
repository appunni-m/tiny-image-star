import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { transform } from "esbuild";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function assertOutputDirectory(output) {
  const relativeOutput = relative(projectRoot, output);
  if (!relativeOutput || relativeOutput === ".." || relativeOutput.startsWith(`..${sep}`) || output === projectRoot) {
    throw new Error(`Pages output must be a child of the repository, not ${output}`);
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Pages output contains a non-regular entry: ${path}`);
  }
  return files;
}

function brotli(bytes) {
  return brotliCompressSync(bytes, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
    },
  });
}

async function writeBrotliSidecar(path, bytes) {
  const compressed = brotli(bytes);
  await writeFile(`${path}.br`, compressed);
  return compressed.byteLength;
}

async function minifyJavaScript(path) {
  const source = await readFile(path, "utf8");
  const result = await transform(source, {
    loader: "js",
    target: "es2020",
    minify: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    legalComments: "none",
    sourcemap: false,
  });
  const bytes = Buffer.from(result.code);
  await writeFile(path, bytes);
  return {
    sourceBytes: Buffer.byteLength(source),
    outputBytes: bytes.byteLength,
    brotliBytes: await writeBrotliSidecar(path, bytes),
  };
}

async function minifyCss(path) {
  const source = await readFile(path, "utf8");
  const result = await transform(source, {
    loader: "css",
    minify: true,
    sourcemap: false,
  });
  const bytes = Buffer.from(result.code);
  await writeFile(path, bytes);
  return {
    sourceBytes: Buffer.byteLength(source),
    outputBytes: bytes.byteLength,
    brotliBytes: await writeBrotliSidecar(path, bytes),
  };
}

async function runWasmOpt(path) {
  const wasmOpt = process.env.WASM_OPT ?? "wasm-opt";
  try {
    execFileSync(wasmOpt, ["--version"], { stdio: "ignore" });
  } catch {
    if (process.env.WASM_OPT_REQUIRED === "1") {
      throw new Error(`WASM_OPT_REQUIRED is set but ${wasmOpt} is not available`);
    }
    console.warn(`Pages optimization: ${wasmOpt} not found; keeping the release WASM bytes before Brotli compression.`);
    return { sourceBytes: (await stat(path)).size, outputBytes: (await stat(path)).size, optimized: false };
  }

  const temporaryDirectory = await mkdtemp(join(dirname(path), ".tiny-image-star-wasm-opt-"));
  const temporaryPath = join(temporaryDirectory, "optimized.wasm");
  try {
    execFileSync(wasmOpt, ["-Oz", "--strip-debug", path, "-o", temporaryPath], { stdio: "pipe" });
    const source = await readFile(path);
    const optimized = await readFile(temporaryPath);
    if (optimized.byteLength < source.byteLength) await writeFile(path, optimized);
    return {
      sourceBytes: source.byteLength,
      outputBytes: Math.min(source.byteLength, optimized.byteLength),
      optimized: optimized.byteLength < source.byteLength,
    };
  } catch (error) {
    if (process.env.WASM_OPT_REQUIRED === "1") {
      throw new Error(`wasm-opt failed: ${error?.message ?? error}`);
    }
    console.warn(`Pages optimization: ${wasmOpt} could not optimize the release WASM; keeping the original bytes.`);
    const size = (await stat(path)).size;
    return { sourceBytes: size, outputBytes: size, optimized: false };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function optimizePagesArtifact(output) {
  assertOutputDirectory(output);
  await access(output, fsConstants.R_OK);
  const outputInfo = await lstat(output);
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) throw new Error(`Pages output must be a real directory: ${output}`);

  const sourceFiles = (await walk(join(output, "src"))).filter((path) => extname(path) === ".js");
  sourceFiles.push(join(output, "wasm/pillow_rs_js.js"));
  const javascript = [];
  for (const path of sourceFiles) javascript.push(await minifyJavaScript(path));

  const css = await minifyCss(join(output, "styles.css"));
  const wasmPath = join(output, "wasm/pillow_rs_js_bg.wasm");
  const wasm = await runWasmOpt(wasmPath);
  const wasmBytes = await readFile(wasmPath);
  const wasmBrotliBytes = await writeBrotliSidecar(wasmPath, wasmBytes);

  const totals = (entries) => entries.reduce((total, entry) => ({
    sourceBytes: total.sourceBytes + entry.sourceBytes,
    outputBytes: total.outputBytes + entry.outputBytes,
    brotliBytes: total.brotliBytes + entry.brotliBytes,
  }), { sourceBytes: 0, outputBytes: 0, brotliBytes: 0 });
  const jsTotals = totals(javascript);
  console.log(`Pages optimization: JS ${jsTotals.sourceBytes} -> ${jsTotals.outputBytes} bytes; Brotli sidecars ${jsTotals.brotliBytes} bytes.`);
  console.log(`Pages optimization: CSS ${css.sourceBytes} -> ${css.outputBytes} bytes; Brotli sidecar ${css.brotliBytes} bytes.`);
  console.log(`Pages optimization: WASM ${wasm.sourceBytes} -> ${wasm.outputBytes} bytes${wasm.optimized ? " after wasm-opt -Oz" : ""}; Brotli sidecar ${wasmBrotliBytes} bytes.`);
}

const scriptPath = resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const requestedOutput = process.argv[2] ?? "_site";
  await optimizePagesArtifact(resolve(projectRoot, requestedOutput));
}
