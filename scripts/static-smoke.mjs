import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const index = await readFile(resolve(root, 'index.html'), 'utf8');
assert.match(index, /href="\.\/styles\.css"/, 'the deployed page must load its stylesheet with a relative URL');
assert.match(index, /src="\.\/src\/main\.js"/, 'the deployed page must load its editor module with a relative URL');
assert.doesNotMatch(index, /(?:src|href)="\/(?!\/)/, 'the deployed page must not use root-absolute assets');

for (const path of [
  'styles.css', 'src/main.js', 'src/design-token-interop.js', 'src/image-fills.js', 'src/layer-blend.js', 'src/layout-guides.js', 'src/inspect.js', 'src/smart-animate.js', 'src/image-worker.js', 'wasm/pillow_rs_js.js',
  'wasm/pillow_rs_js_bg.wasm', 'wasm/runtime.json', 'wasm/PILLOW_RS_LICENSE.txt'
]) await access(resolve(root, path));

const worker = await readFile(resolve(root, 'src/image-worker.js'), 'utf8');
assert.match(worker, /\.\.\/wasm\/pillow_rs_js\.js/, 'the worker must load the local Pillow-RS runtime');
const runtime = JSON.parse(await readFile(resolve(root, 'wasm/runtime.json'), 'utf8'));
assert.equal(runtime.package, 'pillow-rs');
assert.match(runtime.version, /^12\./);
console.log('Static deployment inputs and local WASM runtime: PASS');
