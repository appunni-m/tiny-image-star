import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const packageVersion = '1.6.2';
const packageIntegrity = 'sha512-95c1vWuzoHjM19d5fQgPbz1wcv1pTa0UM9dZrdPgSMUEVuSwuzeVPkq6UhHHw3jLOkE9AYzzTP8XQkRBpPYpEg==';
const packageInfo = JSON.parse(await readFile('node_modules/harfbuzzjs/package.json', 'utf8'));
const lockfile = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(packageInfo.version, packageVersion, 'HarfBuzz.js must match the audited package release');
assert.equal(packageInfo.license, 'MIT', 'HarfBuzz.js must retain its upstream license');
assert.equal(lockfile.packages['node_modules/harfbuzzjs']?.version, packageVersion);
assert.equal(lockfile.packages['node_modules/harfbuzzjs']?.integrity, packageIntegrity,
  'HarfBuzz.js must match its audited npm registry integrity');

await mkdir('wasm/harfbuzz', { recursive: true });
await mkdir('src/workers', { recursive: true });
await copyFile('node_modules/harfbuzzjs/dist/harfbuzz.wasm', 'src/workers/harfbuzz.wasm');
const wasmBytes = await readFile('src/workers/harfbuzz.wasm');
const wasmIntegrity = {
  sizeBytes: 433_766,
  sha256: '684bda29aee2411d05e6859070a9b1a6b8d061025ededb5a8910098fd0cf10f4'
};
assert.equal(wasmBytes.byteLength, wasmIntegrity.sizeBytes, 'HarfBuzz WASM must match the audited artifact size');
assert.equal(createHash('sha256').update(wasmBytes).digest('hex'), wasmIntegrity.sha256,
  'HarfBuzz WASM must match the audited artifact checksum');

const licenseBytes = await readFile('node_modules/harfbuzzjs/LICENSE');
await writeFile('wasm/harfbuzz/LICENSE.txt', licenseBytes);
assert.equal(licenseBytes.byteLength, 1_079);
assert.equal(createHash('sha256').update(licenseBytes).digest('hex'), '5d09767b2cc476f08028b56d9384dc45061c5a3e90f9ad966e44addc8d26c8b1');
assert.match(licenseBytes.toString(), /Permission is hereby granted/);

await build({
  entryPoints: ['src/workers/font-shaping.worker.js'],
  outfile: 'src/workers/font-shaping-worker.bundle.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  external: ['module'],
  target: 'es2022',
  legalComments: 'eof',
  sourcemap: false,
  minify: true
});
const workerBytes = await readFile('src/workers/font-shaping-worker.bundle.js');
const manifest = {
  schema: 1,
  runtime: {
    package: 'harfbuzzjs', version: packageVersion, packageIntegrity,
    license: 'MIT', licenseFile: 'harfbuzz/LICENSE.txt',
    wasm: { file: '../src/workers/harfbuzz.wasm', ...wasmIntegrity },
    worker: {
      bundle: '../src/workers/font-shaping-worker.bundle.js',
      sizeBytes: workerBytes.byteLength,
      sha256: createHash('sha256').update(workerBytes).digest('hex')
    },
    limits: {
      maxFontBytes: 20 * 1024 * 1024,
      maxRetainedFontBytes: 64 * 1024 * 1024,
      maxCachedFaces: 4,
      maxTextCodeUnits: 32_768,
      maxGlyphsPerShape: 65_536,
      maxOutlinePathCharacters: 8 * 1024 * 1024,
      maxCachedShapeBytes: 8 * 1024 * 1024,
      maxCachedShapeEntries: 256
    }
  }
};
await writeFile('wasm/harfbuzz-runtime.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built the local HarfBuzz shaping worker (${workerBytes.byteLength} bytes JS, ${wasmBytes.byteLength} bytes WASM).`);
