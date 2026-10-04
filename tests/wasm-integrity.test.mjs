import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('local Pillow-RS runtime matches the checked-in integrity manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../wasm/runtime.json', import.meta.url), 'utf8'));
  const buildScript = await readFile(new URL('../scripts/build-pillow-runtime.mjs', import.meta.url), 'utf8');
  assert.equal(manifest.package, 'pillow-rs');
  assert.match(buildScript, new RegExp(`const sourceCommit = '${manifest.sourceCommit}'`),
    'the rebuild script must reproduce the exact upstream commit recorded for the vendored WASM');
  for (const patch of manifest.sourcePatches) {
    const bytes = await readFile(new URL(`../${patch.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), patch.sha256, `${patch.path} SHA-256`);
  }
  for (const [file, expected] of Object.entries(manifest.files)) {
    const bytes = await readFile(new URL(`../wasm/${file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `${file} SHA-256`);
  }
});
