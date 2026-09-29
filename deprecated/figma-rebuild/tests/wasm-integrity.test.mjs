import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('local Pillow-RS runtime matches the checked-in integrity manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../wasm/runtime.json', import.meta.url), 'utf8'));
  assert.equal(manifest.package, 'pillow-rs');
  for (const [file, expected] of Object.entries(manifest.files)) {
    const bytes = await readFile(new URL(`../wasm/${file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `${file} SHA-256`);
  }
});
