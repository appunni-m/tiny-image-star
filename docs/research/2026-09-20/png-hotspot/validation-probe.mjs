import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { implementation } from '/Users/lazytrot/work/tiny-image-star/scripts/migration/execute.mjs';
const root = '/Users/lazytrot/work/tiny-image-star';
const fixture = JSON.parse(await readFile(`${root}/tests/fixtures/inputs/parity/engine.json`, 'utf8')).cases[0];
const impl = await implementation('node-wasm'), args = fixture.steps[0].arguments;
const output = await impl.adapter.renderWithApi(impl.api, { ...args.file.value, bytes: Uint8Array.from(args.file.value.bytes) }, args.settings.value);
const invalid = Uint8Array.from(output.bytes), view = new DataView(invalid.buffer);
let payload;
for (let offset = 8; offset + 12 <= invalid.length;) {
  const length = view.getUint32(offset);
  if (String.fromCharCode(...invalid.slice(offset + 4, offset + 8)) === 'IDAT') { payload = { offset, length }; break; }
  offset += length + 12;
}
assert.ok(payload && payload.length > 2);
// The zlib CMF byte must identify compression method 8; method 15 is invalid.
invalid[payload.offset + 8] = (invalid[payload.offset + 8] & 0xf0) | 0x0f;
let crc = 0xffffffff;
for (const byte of invalid.slice(payload.offset + 4, payload.offset + 8 + payload.length)) {
  crc ^= byte;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
}
view.setUint32(payload.offset + 8 + payload.length, (crc ^ 0xffffffff) >>> 0);
const observations = [];
for (const [name, bytes] of [['valid', output.bytes], ['invalid-deflate-valid-chunk-crc', invalid]]) {
  const image = impl.api.Image.open(bytes);
  try {
    const row = { name, sha256: createHash('sha256').update(bytes).digest('hex'), width: image.width, height: image.height, headerCheckPassed: image.width === output.width && image.height === output.height };
    try { image.load(); row.fullDecodePassed = image.getpixel(0,0).length > 0; }
    catch (error) { row.fullDecodePassed = false; row.error = String(error); }
    observations.push(row);
  } finally { image.free(); }
}
assert.ok(observations.every(o => o.headerCheckPassed));
assert.equal(observations[0].fullDecodePassed, true);
assert.equal(observations[1].fullDecodePassed, false);
await writeFile('/tmp/tinystar-png-validation-probe.json', JSON.stringify({ schema: 'tinystar/png-validation-diagnostic@1', recorded_at: new Date().toISOString(), observations }, null, 2) + '\n');
await writeFile('/tmp/tinystar-png-invalid-deflate.png', invalid);
console.log(JSON.stringify(observations));
