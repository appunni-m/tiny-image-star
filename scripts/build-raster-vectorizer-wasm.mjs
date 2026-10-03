import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crate = resolve(root, 'wasm/raster-vectorizer');
const expectedRustVersion = '1.96.1';
const output = (command, args) => {
  const result = spawnSync(command, args, { cwd: crate, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
};
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: crate, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
};
const rustVersion = output('rustc', ['--version']).match(/^rustc\s+(\S+)/)?.[1];
if (rustVersion !== expectedRustVersion) {
  throw new Error(`Raster vectorizer WASM requires Rust ${expectedRustVersion}; found ${rustVersion || 'unknown'}. Run rustup toolchain install ${expectedRustVersion} --target wasm32-unknown-unknown.`);
}
run('cargo', ['build', '--locked', '--target', 'wasm32-unknown-unknown', '--release']);
const wasm = await readFile(resolve(crate, 'target/wasm32-unknown-unknown/release/tiny_image_star_raster_vectorizer.wasm'));
const source = await readFile(resolve(crate, 'src/lib.rs'));
const manifest = {
  name: 'Tiny Image Star local raster vectorizer',
  version: '0.1.0',
  algorithm: 'RGBA palette quantization, exact pixel-cell boundary tracing, closed contour simplification',
  limits: { maximumPixels: 1_048_576, maximumColors: 16, maximumContoursPerColor: 10_000, maximumPointsPerColor: 20_000, maximumPointsTotal: 60_000 },
  toolchain: { rust: expectedRustVersion, target: 'wasm32-unknown-unknown', optimization: 'release-size-lto' },
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  wasm: { file: 'raster-vectorizer.wasm', byteLength: wasm.byteLength, sha256: createHash('sha256').update(wasm).digest('hex') }
};
await writeFile(resolve(root, 'wasm/raster-vectorizer.wasm'), wasm);
await writeFile(resolve(root, 'wasm/raster-vectorizer-runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built local raster vectorizer WASM (${wasm.byteLength} bytes, Rust ${expectedRustVersion}).`);
