import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, stylesheet, browserSmoke] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('./browser-smoke.mjs', import.meta.url), 'utf8')
]);

test('the inspector exposes an explicit delete-layer action for a single selected layer', () => {
  assert.match(source, /const deleteLayerControl = section\('Layer actions', `\<button class="delete-layer-button" type="button" data-action="delete-layer" data-layer-id="\$\{escapeHtml\(node\.id\)\}" aria-label="Delete layer \$\{escapeHtml\(node\.name\)\}">Delete layer<\/button>`\);/,
    'the destructive action should name and identify the exact layer instead of relying on point-edit mode');
  assert.match(source, /content\.innerHTML = `\$\{slicePositionSection\(node\)\}\$\{exportSettingsSection\(node\)\}\$\{deleteLayerControl\}`/,
    'slice layers should also expose the direct layer deletion action');
  assert.match(source, /let body = `\$\{deleteLayerControl\}\$\{componentSection\(node\)\}/,
    'all other single-layer inspector views should include the same direct action');
});

test('the multi-selection inspector deletes its captured layer IDs rather than a later selection', () => {
  assert.match(source, /data-action="delete-selected-layers" data-layer-ids="\$\{escapeHtml\(JSON\.stringify\(state\.selectedIds\)\)\}"/,
    'multi-delete captures the exact selected layer IDs when the inspector is rendered');
  const start = source.indexOf("if (action === 'delete-selected-layers') {");
  const end = source.indexOf("if (node?.type === 'slice'", start);
  assert.ok(start >= 0 && end > start, 'multi-layer delete action should have a bounded dispatch branch');
  const dispatch = source.slice(start, end);
  assert.match(dispatch, /JSON\.parse\(details\.layerIds \|\| '\[\]'\)/);
  assert.match(dispatch, /deleteSelected\(layerIds\);/);
  assert.doesNotMatch(dispatch, /deleteSelected\(state\.selectedIds\)/,
    'a changed selection must not redirect a stale inspector button to different layers');
});

test('vector point deletion remains distinct from the explicit layer delete action', () => {
  assert.match(source, /data-action="delete-vector-point"[^>]*>− Delete/,
    'the vector editor keeps its anchor-only control');
  assert.match(source, /if \(action === 'delete-layer'\)[\s\S]*?deleteSelected\(\[layerId\]\);/,
    'the inspector layer action bypasses anchor selection and deletes the captured node');
  assert.match(stylesheet, /\.delete-layer-button \{[^}]*min-height:\s*38px/);
  assert.match(stylesheet, /\.delete-layer-button \{ min-height:\s*44px; \}/,
    'the destructive action remains easy to tap on mobile');
  assert.match(stylesheet, /:root\[data-theme="dark"\] \.delete-layer-button \{ color:\s*#ff9b91/,
    'the action remains legible in the dark theme');
});

test('the deferred browser workflow verifies Inspector deletion in the UI and saved document', () => {
  const start = browserSmoke.indexOf("const inspectorDeleteLayer = createNode('rectangle'");
  const end = browserSmoke.indexOf("const compoundRow = app.querySelector", start);
  assert.ok(start >= 0 && end > start, 'the layer deletion browser fixture should have a bounded workflow');
  const workflow = browserSmoke.slice(start, end);
  assert.match(workflow, /data-action="delete-layer"/,
    'the browser flow should activate the same named Inspector action the user clicks');
  assert.match(workflow, /waitFor\(\(\) => !app\.querySelector/,
    'the target must disappear from the live layer tree');
  assert.match(workflow, /savedInspectorDeleteDocument/);
  assert.match(workflow, /did not persist removal/,
    'the test should also check the saved document, not only the rendered row');
});
