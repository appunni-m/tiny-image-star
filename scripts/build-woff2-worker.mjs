import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const packageVersion = '2.0.0';
const packageInfo = JSON.parse(await readFile('node_modules/woff2-encoder/package.json', 'utf8'));
assert.equal(packageInfo.version, packageVersion, 'the local WOFF2 decoder must use its pinned tested version');
assert.equal(packageInfo.license, 'MIT', 'the local WOFF2 decoder must retain its MIT license');

await mkdir('wasm/woff2', { recursive: true });
const license = await readFile('node_modules/woff2-encoder/LICENSE');
await writeFile('wasm/woff2/LICENSE.txt', license);
const upstreamLicenses = {
  woff2: {
    file: 'wasm/woff2/GOOGLE-WOFF2-LICENSE.txt',
    bytes: await readFile('wasm/woff2/GOOGLE-WOFF2-LICENSE.txt')
  },
  brotli: {
    file: 'wasm/woff2/GOOGLE-BROTLI-LICENSE.txt',
    bytes: await readFile('wasm/woff2/GOOGLE-BROTLI-LICENSE.txt')
  }
};
await build({
  entryPoints: ['src/workers/woff2-decompress.worker.js'],
  outfile: 'src/workers/woff2-decompress-worker.bundle.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'eof',
  sourcemap: false,
  minify: true,
  metafile: false
});

const worker = await readFile('src/workers/woff2-decompress-worker.bundle.js');
const manifest = {
  schema: 1,
  decoder: {
    package: 'woff2-encoder',
    version: packageVersion,
    entryPoint: 'woff2-encoder/decompress',
    upstream: 'google/woff2 and google/brotli',
    license: 'MIT',
    licenseFile: 'woff2/LICENSE.txt',
    maxInputBytes: 20 * 1024 * 1024,
    maxDecodedBytes: 30 * 1024 * 1024,
    wasmEmbeddedInWorker: true
  },
  license: {
    sizeBytes: license.byteLength,
    sha256: createHash('sha256').update(license).digest('hex')
  },
  upstreamLicenses: Object.fromEntries(Object.entries(upstreamLicenses).map(([name, { file, bytes }]) => [name, {
    file: file.replace(/^wasm\//u, ''),
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }])),
  worker: {
    bundle: '../src/workers/woff2-decompress-worker.bundle.js',
    sizeBytes: worker.byteLength,
    sha256: createHash('sha256').update(worker).digest('hex')
  }
};
await writeFile('wasm/woff2-runtime.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built the pinned local WOFF2 decoder worker (${worker.byteLength} bytes, WASM embedded).`);
