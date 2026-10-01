import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function assertBalancedCssBlocks(source) {
  const opens = [];
  let quote = null;
  let escaped = false;
  let comment = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (comment) {
      if (current === '*' && next === '/') { comment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === '/' && next === '*') { comment = true; index += 1; continue; }
    if (current === '"' || current === "'") { quote = current; continue; }
    if (current === '{') opens.push(index);
    else if (current === '}') {
      if (!opens.length) {
        const line = source.slice(0, index).split('\n').length;
        throw new Error(`Unmatched closing brace in styles.css at line ${line}.`);
      }
      opens.pop();
    }
  }
  if (comment || quote || opens.length) throw new Error('Unclosed comment, string, or block in styles.css.');
}

const index = await readFile(resolve(root, 'index.html'), 'utf8');
assert.match(index, /href="\.\/styles\.css"/, 'the deployed page must load its stylesheet with a relative URL');
assert.match(index, /src="\.\/src\/main\.js"/, 'the deployed page must load its editor module with a relative URL');
assert.doesNotMatch(index, /(?:src|href)="\/(?!\/)/, 'the deployed page must not use root-absolute assets');
assertBalancedCssBlocks(await readFile(resolve(root, 'styles.css'), 'utf8'));

for (const path of [
  'styles.css', 'src/main.js', 'src/design-token-interop.js', 'src/appearance-clipboard.js', 'src/image-fills.js', 'src/image-output.js', 'src/layer-blend.js', 'src/layout-guides.js', 'src/inspect.js', 'src/smart-animate.js', 'src/image-worker.js', 'src/pdf-vector-export.js', 'src/tab-list-keyboard.js', 'src/variable-stroke-geometry.js', 'src/vector-anchor-selection.js', 'src/slice-export-plan.js', 'wasm/pillow_rs_js.js',
  'wasm/pillow_rs_js_bg.wasm', 'wasm/runtime.json', 'wasm/PILLOW_RS_LICENSE.txt'
]) await access(resolve(root, path));

const worker = await readFile(resolve(root, 'src/image-worker.js'), 'utf8');
assert.match(worker, /\.\.\/wasm\/pillow_rs_js\.js/, 'the worker must load the local Pillow-RS runtime');
const runtime = JSON.parse(await readFile(resolve(root, 'wasm/runtime.json'), 'utf8'));
const runtimeBuilder = await readFile(resolve(root, 'scripts/build-pillow-runtime.mjs'), 'utf8');
const readme = await readFile(resolve(root, 'README.md'), 'utf8');
assert.equal(runtime.package, 'pillow-rs');
assert.match(runtime.version, /^12\./);
assert.match(runtime.sourceCommit, /^[a-f0-9]{40}$/);
assert.equal(runtime.sourceRef, 'v12.2.0-alpha.5');
assert.equal(runtime.version, '12.2.0-alpha.5');
assert.equal(runtime.sourceRef, runtimeBuilder.match(/const sourceRef = '([^']+)';/)?.[1],
  'the vendored runtime must name the exact upstream Pillow-RS tag pinned by the build script');
assert.equal(runtime.sourceCommit, runtimeBuilder.match(/const sourceCommit = '([a-f0-9]{40})';/)?.[1],
  'the vendored runtime must be built from the exact Pillow-RS commit pinned by the build script');
assert.ok(readme.includes(`https://github.com/appunni-m/pillow-rs/commit/${runtime.sourceCommit}`),
  'README provenance must match the pinned Pillow-RS runtime commit');
assert.equal(runtime.sourcePatch.path, 'patches/pillow-rs/encode-quality.patch');
assert.deepEqual(runtime.buildToolchain, { rust: '1.96.1', wasmPack: '0.15.0', wasmOpt: false });
assert.equal(runtime.buildToolchain.rust, runtimeBuilder.match(/const expectedRustVersion = '([^']+)';/)?.[1]);
assert.equal(runtime.buildToolchain.wasmPack, runtimeBuilder.match(/const expectedWasmPackVersion = '([^']+)';/)?.[1]);
const runtimePatch = await readFile(resolve(root, runtime.sourcePatch.path));
assert.equal(createHash('sha256').update(runtimePatch).digest('hex'), runtime.sourcePatch.sha256);
const runtimeIntegrity = createHash('sha512');
for (const name of Object.keys(runtime.files).sort()) {
  const bytes = await readFile(resolve(root, 'wasm', name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), runtime.files[name], `${name} must match its pinned checksum`);
  runtimeIntegrity.update(name).update('\0').update(bytes).update('\0');
}
assert.equal(runtime.integrityAlgorithm, 'sha512 over each sorted filename, NUL, file bytes, NUL');
assert.equal(runtime.integrity, `sha512-${runtimeIntegrity.digest('base64')}`);
const pillowRuntime = await readFile(resolve(root, 'wasm/pillow_rs_js.js'), 'utf8');
assert.match(pillowRuntime, /saveWithQuality\(/, 'the vendored WASM binding must expose local JPEG/WebP quality controls');
console.log('Static deployment inputs and local WASM runtime: PASS');
