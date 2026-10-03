import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const packages = {
  qrcode: { version: '1.5.4', integrity: 'sha512-1ca71Zgiu6ORjHqFBDpnSMTR2ReToX4l1Au1VFLyVeBTFavzQnv5JxMFr3ukHVKpSrSA2MCk0lNJSykjUfz7Zg==', license: 'MIT' },
  'qr-scanner': { version: '1.4.2', integrity: 'sha512-kV1yQUe2FENvn59tMZW6mOVfpq9mGxGf8l6+EGaXUOd4RBOLg7tRC83OrirM5AtDvZRpdjdlXURsHreAOSPOUw==', license: 'MIT' }
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const lockfile = JSON.parse(await readFile('package-lock.json', 'utf8'));

for (const [name, expected] of Object.entries(packages)) {
  const packageInfo = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  const locked = lockfile.packages[`node_modules/${name}`];
  assert.equal(packageInfo.version, expected.version, `${name} must match the reviewed package release`);
  assert.equal(packageInfo.license, expected.license, `${name} must retain its reviewed license`);
  assert.equal(locked?.version, expected.version, `${name} must match the lockfile version`);
  assert.equal(locked?.integrity, expected.integrity, `${name} must match the reviewed registry artifact`);
}

await mkdir('src/collaboration', { recursive: true });
await build({
  entryPoints: ['src/collaboration/qr-runtime.js'],
  outfile: 'src/collaboration/qr-runtime.bundle.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['browser'],
  legalComments: 'eof',
  sourcemap: false,
  minify: true
});

const bundle = await readFile('src/collaboration/qr-runtime.bundle.js');
const manifest = {
  schema: 1,
  packages,
  licenses: { qrcode: 'MIT', 'qr-scanner': 'MIT' },
  runtime: {
    bundle: '../src/collaboration/qr-runtime.bundle.js',
    sizeBytes: bundle.byteLength,
    sha256: sha256(bundle),
    scannerWorker: 'embedded in the local bundle as a Blob worker; no runtime network request',
    cameraPermission: 'requested only after the user presses Start camera',
    fallback: 'scan a saved QR image or use the existing copy/paste controls'
  }
};
await writeFile('wasm/collaboration-qr-runtime.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built local QR sharing tools (${bundle.byteLength} bytes, worker source embedded).`);
