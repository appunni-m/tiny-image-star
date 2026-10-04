import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start, `${name} should have a bounded implementation`);
  return source.slice(start, end);
}

test('mask Inspector offers supported luminance mode and explains brightness and opacity', () => {
  const inspector = functionBody('renderInspector');
  const start = inspector.indexOf("if (node.type === 'group' && node.mask) {");
  const end = inspector.indexOf("if (node.type === 'text')", start);
  assert.ok(start >= 0 && end > start, 'the mask controls should have a bounded Inspector section');
  const maskControls = inspector.slice(start, end);

  assert.match(maskControls, /isMaskSource\(maskSource, 'vector'\)/,
    'vector mode must retain its source compatibility check');
  assert.match(maskControls, /isMaskSource\(maskSource, 'luminance'\)/,
    'luminance mode must be offered only for a supported source');
  assert.match(maskControls, /<option value="alpha"/);
  assert.match(maskControls, /<option value="vector"/);
  assert.match(maskControls, /<option value="luminance"[\s\S]*?disabled/,
    'unsupported luminance sources should be visibly unavailable');
  assert.match(maskControls, /Brightness and opacity control reveal:[\s\S]*?white shows the layers below, black hides them[\s\S]*?gray or translucent areas show them partly/,
    'the luminance explanation should say how brightness, opacity, white, black, and gray affect the result');
  assert.match(maskControls, /Alpha mode uses the source’s transparency/,
    'alpha masking should keep its distinct existing explanation');
  assert.match(maskControls, /Vector mode uses visible fill and stroke geometry at full opacity/,
    'vector masking should keep its distinct existing explanation');
});

test('both layer context menus offer luminance masks without removing alpha or vector actions', () => {
  const nodeMenu = functionBody('openNodeMenu');
  assert.match(nodeMenu, /canCreateMaskGroup\(state\.document, rootSelectedIds\(\), state\.document\.activePageId, 'luminance'\)/);
  assert.match(nodeMenu, /Use as luminance mask · bright reveals, black hides[\s\S]*?maskSelectedLayers\('luminance'\)/);
  assert.match(nodeMenu, /Use as alpha mask[\s\S]*?maskSelectedLayers\('alpha'\)/);
  assert.match(nodeMenu, /Use as vector mask[\s\S]*?maskSelectedLayers\('vector'\)/);

  const layerMenuStart = source.indexOf("$('#layer-options').addEventListener('click', event => {");
  const layerMenuEnd = source.indexOf("$('#place-image-assets').addEventListener", layerMenuStart);
  assert.ok(layerMenuStart >= 0 && layerMenuEnd > layerMenuStart,
    'the touch-friendly layer options menu should have a bounded handler');
  const layerMenu = source.slice(layerMenuStart, layerMenuEnd);
  assert.match(layerMenu, /canCreateMaskGroup\(state\.document, ids, state\.document\.activePageId, 'luminance'\)/);
  assert.match(layerMenu, /Use selected layers as luminance mask · bright reveals, black hides[\s\S]*?maskSelectedLayers\('luminance'\)/);
  assert.match(layerMenu, /Use selected layers as alpha mask[\s\S]*?maskSelectedLayers\('alpha'\)/);
  assert.match(layerMenu, /Use selected layers as vector mask[\s\S]*?maskSelectedLayers\('vector'\)/);
});

test('creating a luminance mask names its mode and explains its reveal behavior', () => {
  const createMask = functionBody('maskSelectedLayers');
  assert.match(createMask, /maskMode === 'luminance' \? 'Luminance'/,
    'the creation confirmation must not call luminance mode Alpha');
  assert.match(createMask, /Bright, opaque areas reveal; black or transparent areas hide\./,
    'the creation confirmation should explain luminance visibility in plain language');
  assert.match(createMask, /checkpoint\(`Create \$\{modeName\.toLowerCase\(\)\} mask group`\)/,
    'undo history should name the selected mask mode');
});
