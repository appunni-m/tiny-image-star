// Diagnostic only. Do not run concurrently with the canonical browser matrix.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { implementation } from '/Users/lazytrot/work/tiny-image-star/scripts/migration/execute.mjs';

const root = '/Users/lazytrot/work/tiny-image-star';
const source = JSON.parse(await readFile(`${root}/tests/fixtures/inputs/parity/engine.json`, 'utf8'));
const fixture = source.cases.find(c => c.case_id === 'TinyImageStar.Engine.renderWithApi.original');
const args = fixture.steps[0].arguments;
const file = { ...args.file.value, bytes: Uint8Array.from(args.file.value.bytes) };
const settings = args.settings.value;
const old = await implementation('legacy'), current = await implementation('node-wasm');
const implementations = [
  { id: 'legacy-adapter-legacy-runtime', api: old.api, adapter: old.adapter },
  { id: 'current-adapter-current-runtime', api: current.api, adapter: current.adapter },
  { id: 'legacy-adapter-current-runtime', api: current.api, adapter: old.adapter },
  { id: 'current-adapter-legacy-runtime', api: old.api, adapter: current.adapter },
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = [];
for (const item of implementations) {
  try {
    const rendered = await item.adapter.renderWithApi(item.api, file, settings);
    const decoded = item.api.Image.open(rendered.bytes);
    try { item.signature = { width: rendered.width, height: rendered.height, pixelHash: hash(decoded.toBytes()), byteHash: hash(rendered.bytes) }; }
    finally { decoded.free(); }
    for (let i = 0; i < 100; i++) await item.adapter.renderWithApi(item.api, file, settings);
  } catch (error) { item.error = String(error); }
}
for (let repetition = 0; repetition < 5; repetition++) {
  // Rotate balanced order; these are bounded development probes, not qualification.
  for (let offset = 0; offset < implementations.length; offset++) {
    const item = implementations[(offset + repetition) % implementations.length];
    if (item.error) continue;
    const began = performance.now();
    for (let i = 0; i < 1000; i++) await item.adapter.renderWithApi(item.api, file, settings);
    rows.push({ id: item.id, repetition, averageMs: (performance.now() - began) / 1000 });
  }
}
const signatures = implementations.map(({ id, signature, error }) => ({ id, signature, error }));
const supported = signatures.filter(r => r.signature);
for (const row of supported) assert.equal(row.signature.pixelHash, supported[0].signature.pixelHash, row.id);
const result = { schema: 'tinystar/png-hotspot-diagnostic@1', recorded_at: new Date().toISOString(),
  limitation: 'Single-process direct adapter measurements, rotated order, shared initialized modules; excludes canonical executeWorkflow observation serialization and cannot replace the canonical budget.',
  fixture: fixture.case_id, signatures, samples: rows };
await writeFile('/tmp/tinystar-png-hotspot-probe.json', JSON.stringify(result, null, 2) + '\n');
for (const item of implementations) {
  const samples = rows.filter(r => r.id === item.id).map(r => r.averageMs).sort((a,b) => a-b);
  console.log(JSON.stringify({ id: item.id, error: item.error, medianMs: samples[2], minMs: samples[0], maxMs: samples.at(-1) }));
}
