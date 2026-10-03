import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRef = 'main';
const sourceCommit = 'e2f702ef121e98b3bbc307b412e5df78f29c85be';
// Keep these aligned with the upstream rust-toolchain.toml and CI env pins at
// sourceCommit so local WASM generation does not silently drift by PATH.
const expectedRustVersion = '1.96.1';
const expectedWasmPackVersion = '0.15.0';
const upstreamUrl = 'https://github.com/appunni-m/pillow-rs.git';
const patchRelativePath = 'patches/pillow-rs/encode-quality.patch';
const patchPath = resolve(root, patchRelativePath);
const buildDirectory = await mkdtemp(join(tmpdir(), 'tiny-image-star-pillow-rs-'));
const sourceDirectory = join(buildDirectory, 'pillow-rs');

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
}

function output(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
  return result.stdout.trim();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

try {
  run('git', ['clone', '--filter=blob:none', '--no-checkout', upstreamUrl, sourceDirectory], root);
  run('git', ['checkout', '--detach', sourceCommit], sourceDirectory);
  const rustVersion = output('rustc', ['--version'], sourceDirectory).match(/^rustc\s+(\S+)/)?.[1];
  if (rustVersion !== expectedRustVersion) {
    throw new Error(`Pillow-RS WASM must be built with Rust ${expectedRustVersion}; found ${rustVersion || 'an unknown version'}.`);
  }
  const wasmPackVersion = output('wasm-pack', ['--version'], sourceDirectory).match(/^wasm-pack\s+(\S+)/)?.[1];
  if (wasmPackVersion !== expectedWasmPackVersion) {
    throw new Error(`Pillow-RS WASM must be built with wasm-pack ${expectedWasmPackVersion}; found ${wasmPackVersion || 'an unknown version'}.`);
  }
  run('git', ['apply', '--check', patchPath], sourceDirectory);
  run('git', ['apply', patchPath], sourceDirectory);
  const wasmBuild = spawnSync('node', ['scripts/build_wasm.mjs', 'core', 'release'], {
    cwd: join(sourceDirectory, 'pillow-rs-js'),
    stdio: 'inherit',
    // Upstream CI deliberately disables optional compiler wrappers; a shared
    // local sccache daemon can serialize this build behind unrelated projects.
    env: { ...process.env, RUSTC_WRAPPER: '', MIGRATION_WASM_NO_OPT: '1' },
  });
  if (wasmBuild.error) throw wasmBuild.error;
  if (wasmBuild.status !== 0) throw new Error(`Pillow-RS WASM build failed with exit code ${wasmBuild.status}.`);

  const packageOutput = join(sourceDirectory, 'pillow-rs-js', 'pkg', 'core');
  const files = {
    'pillow_rs_js.js': await readFile(join(packageOutput, 'pillow_rs_js.js')),
    'pillow_rs_js_bg.wasm': await readFile(join(packageOutput, 'pillow_rs_js_bg.wasm')),
    'PILLOW_RS_LICENSE.txt': await readFile(resolve(root, 'wasm/PILLOW_RS_LICENSE.txt')),
  };
  for (const [name, bytes] of Object.entries(files)) {
    if (name !== 'PILLOW_RS_LICENSE.txt') await cp(join(packageOutput, name), resolve(root, 'wasm', name));
  }

  const cargo = await readFile(join(sourceDirectory, 'Cargo.toml'), 'utf8');
  const version = cargo.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error('Could not read the pinned Pillow-RS version from Cargo.toml.');
  const patchBytes = await readFile(patchPath);
  const fileHashes = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)]));
  const integrity = createHash('sha512');
  for (const name of Object.keys(fileHashes).sort()) {
    integrity.update(name).update('\0').update(files[name]).update('\0');
  }
  const manifest = {
    package: 'pillow-rs',
    version,
    sourceRef,
    sourceCommit,
    sourcePatch: { path: patchRelativePath, sha256: sha256(patchBytes) },
    buildToolchain: { rust: expectedRustVersion, wasmPack: expectedWasmPackVersion, wasmOpt: false },
    files: fileHashes,
    integrityAlgorithm: 'sha512 over each sorted filename, NUL, file bytes, NUL',
    integrity: `sha512-${integrity.digest('base64')}`,
    artifactSource: `Release-profile WASM compiled from upstream ${sourceRef} at commit ${sourceCommit} with the local JPEG/WebP quality patch and fixed build toolchain.`,
  };
  await writeFile(resolve(root, 'wasm/runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await rm(buildDirectory, { recursive: true, force: true });
}
