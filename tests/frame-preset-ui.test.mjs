import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, stylesheet] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
]);

function functionBody(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} should have a bounded implementation`);
  return source.slice(start, end);
}

test('the empty-selection Frame tool inspector renders grouped, named, dimensioned preset buttons', () => {
  const picker = functionBody('framePresetPicker', 'propertyFieldLabelClass');
  assert.match(picker, /groupFramePresetsByCategory\(\)/);
  assert.match(picker, /groups\.map\(group => `<details class="frame-preset-group"/);
  assert.match(picker, /escapeHtml\(group\.name\)/);
  assert.match(picker, /data-action="create-frame-preset" data-preset-id="\$\{escapeHtml\(preset\.id\)\}"/);
  assert.match(picker, /escapeHtml\(preset\.name\)/);
  assert.match(picker, /\$\{preset\.width\} × \$\{preset\.height\}/);
  assert.match(picker, /innerWidth <= 820 \? 'phone' : 'desktop'/,
    'the initially expanded group should match the current phone or desktop viewport');

  const inspectorStart = source.indexOf('function renderInspector()');
  const inspectorEnd = source.indexOf('\nfunction ', inspectorStart + 1);
  const inspector = source.slice(inspectorStart, inspectorEnd);
  assert.match(inspector, /if \(!entries\.length\)[\s\S]*?state\.tool === 'frame' \? framePresetPicker\(\) : ''/,
    'presets are shown for the Frame tool only when no layer is selected');
});

test('choosing a preset creates and selects a top-level frame centered in the visible canvas world', () => {
  const creator = functionBody('createFrameFromPreset', 'applyInspectorAction');
  assert.match(creator, /const preset = getFramePreset\(presetId\)/);
  assert.match(creator, /state\.tool !== 'frame' \|\| selectedEntries\(\)\.length/,
    'stale inspector actions cannot create a preset after selection or tool state changes');
  assert.match(creator, /const bounds = canvas\.getBoundingClientRect\(\)/);
  assert.match(creator, /clientX: bounds\.left \+ bounds\.width \/ 2/);
  assert.match(creator, /clientY: bounds\.top \+ bounds\.height \/ 2/);
  assert.match(creator, /const center = screenToWorld\(/);
  assert.match(creator, /x: center\.x - preset\.width \/ 2/);
  assert.match(creator, /y: center\.y - preset\.height \/ 2/);
  assert.match(creator, /width: preset\.width[\s\S]*?height: preset\.height/);
  assert.match(creator, /addNode\(state\.document, frame, \{ pageId: page\.id \}\)/,
    'preset frames are added to the active page instead of nesting under whichever frame is at the viewport center');
  assert.match(creator, /setSelection\(\[frame\.id\]/);
  assert.match(creator, /queueSave\(\)[\s\S]*?renderer\.invalidate\(\)/);

  assert.match(source, /if \(action === 'create-frame-preset'\) \{ createFrameFromPreset\(details\.presetId\); \}/,
    'the inspector action routes the selected stable preset ID into the creator');
  assert.match(source, /import \{ getFramePreset, groupFramePresetsByCategory \} from '\.\/frame-presets\.js'/);
});

test('the existing canvas drag and click-to-create frame behavior remains available', () => {
  assert.match(source, /const typeByTool = \{ frame: 'frame'/,
    'Frame tool pointer gestures still enter the ordinary draw path');
  assert.match(source, /if \(interaction\.kind === 'draw'\) \{[\s\S]*?if \(!interaction\.moved\) \{[\s\S]*?if \(node\.type === 'frame'\) \{ node\.width = 390; node\.height = 844; \}/,
    'dragging keeps custom-size frames and a plain canvas click keeps the prior default frame size');
});

test('frame preset labels stay readable and all controls are touch-sized on mobile', () => {
  assert.match(stylesheet, /\.frame-preset-option\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/);
  assert.match(stylesheet, /\.frame-preset-option > span:first-child\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(stylesheet, /\.frame-preset-dimensions\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(stylesheet, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.frame-preset-group > summary\s*\{[^}]*min-height:\s*44px/);
  assert.match(stylesheet, /\.frame-preset-option\s*\{\s*min-height:\s*46px/);
});
