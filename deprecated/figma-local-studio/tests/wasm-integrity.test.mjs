import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('vendored Pillow-RS WebAssembly runtime matches its recorded integrity manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../wasm/runtime.json', import.meta.url), 'utf8'));
  assert.equal(manifest.package, 'pillow-rs');
  assert.equal(manifest.version, '12.2.0-alpha.1');
  for (const [file, expected] of Object.entries(manifest.files)) {
    const bytes = await readFile(new URL(`../wasm/${file}`, import.meta.url));
    const actual = createHash('sha256').update(bytes).digest('hex');
    assert.equal(actual, expected, `${file} checksum`);
  }
});
