import { readFile, writeFile } from 'node:fs/promises';
import { implementation } from '/Users/lazytrot/work/tiny-image-star/scripts/migration/execute.mjs';
const root = '/Users/lazytrot/work/tiny-image-star';
const fixture = JSON.parse(await readFile(`${root}/tests/fixtures/inputs/parity/engine.json`, 'utf8')).cases[0];
const args = fixture.steps[0].arguments;
const file = { ...args.file.value, bytes: Uint8Array.from(args.file.value.bytes), diagnostics: true };
const results = [];
for (const subject of ['legacy', 'node-wasm']) {
  const impl = await implementation(subject), calls = new Map(), restore = [];
  const record = (name, fn, receiver, args) => {
    const start = performance.now();
    try { return fn.apply(receiver, args); }
    finally { const row = calls.get(name) ?? { calls: 0, totalMs: 0 }; row.calls++; row.totalMs += performance.now() - start; calls.set(name, row); }
  };
  const wrap = (owner, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name); if (!descriptor) return;
    if (descriptor.value instanceof Function) Object.defineProperty(owner, name, { ...descriptor, value: function(...args) { return record(name, descriptor.value, this, args); } });
    else if (descriptor.get) Object.defineProperty(owner, name, { ...descriptor, get: function() { return record(`get ${name}`, descriptor.get, this, []); } });
    else return;
    restore.push(() => Object.defineProperty(owner, name, descriptor));
  };
  const api = { ...impl.api, exifOrientation: (...args) => record('exifOrientation', impl.api.exifOrientation, impl.api, args) };
  for (const name of ['save', 'saveWithInput', 'load', 'getpixel', 'free', 'width', 'height', 'mode']) wrap(api.Image.prototype, name);
  wrap(api.Image, 'open');
  try {
    for (let i = 0; i < 100; i++) await impl.adapter.renderWithApi(api, file, args.settings.value);
    calls.clear(); const stages = {}; const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const result = await impl.adapter.renderWithApi(api, file, args.settings.value);
      for (const [name, value] of Object.entries(result.diagnostics ?? {})) if (typeof value === 'number') stages[name] = (stages[name] ?? 0) + value;
    }
    results.push({ subject, count: 1000, elapsedMs: performance.now() - start,
      averageStagesMs: Object.fromEntries(Object.entries(stages).map(([name,value]) => [name,value/1000])),
      methods: Object.fromEntries([...calls].sort(([,a],[,b]) => b.totalMs-a.totalMs)) });
  } finally { restore.reverse().forEach(fn => fn()); }
}
await writeFile('/tmp/tinystar-png-stage-probe.json', JSON.stringify({ schema: 'tinystar/png-stage-diagnostic@1',
  recorded_at: new Date().toISOString(), limitation: 'Instrumented method timings have wrapper overhead and are not canonical measurements; getters/calls may share internal work.', results }, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
