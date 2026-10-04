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
  const picker = functionBody('framePresetPicker', 'syncQuickExportControl');
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

  const setTool = functionBody('setTool', 'applyEyedropperColor');
  assert.match(setTool, /tool === 'frame' && !state\.selectedIds\.length && innerWidth <= 820[\s\S]*?toggleMobilePanel\('right'\)/,
    'on phones, entering the empty-selection Frame tool should reveal the drawer containing the preset picker');
  assert.match(picker, /Choose a preset below\. To draw a custom frame, close Properties and drag on the canvas\./,
    'the phone hint must explain how to return to the canvas before drawing');
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
  assert.match(source, /import \{[^}]*getFramePreset[^}]*groupFramePresetsByCategory[^}]*\} from '\.\/frame-presets\.js'/);
});

test('a selected frame can change to a preset while preserving constraints and local editor invariants', () => {
  const resizeSection = functionBody('framePresetResizeSection', 'propertyFieldLabelClass');
  assert.match(resizeSection, /FRAME_PRESETS\.filter/);
  assert.match(resizeSection, /data-frame-preset-select/);
  assert.match(resizeSection, /data-action="resize-frame-to-fit"/);
  assert.match(resizeSection, /aria-label="Resize frame to fit visible contents"/);
  assert.match(resizeSection, /Choose a preset to resize this frame/);
  assert.match(resizeSection, /Child layers follow their constraints/);

  const inspector = source.slice(source.indexOf('function renderInspector()'), source.indexOf('\nfunction ', source.indexOf('function renderInspector()') + 1));
  assert.match(inspector, /node\.type === 'frame' \? framePresetResizeSection\(node\) : ''/,
    'the frame preset field belongs to the existing selected-frame Inspector');

  const resize = functionBody('applyFramePresetToSelection', 'resizeSelectedFrameToFit');
  assert.match(resize, /entries\.length !== 1 \|\| entries\[0\]\.node\.type !== 'frame'/);
  assert.match(resize, /parents\.some\(parent => parent\.locked\)/);
  assert.match(resize, /widthBinding && widthBinding === heightBinding/,
    'one numeric variable cannot safely supply two different preset dimensions');
  assert.match(resize, /checkpoint\(`Resize frame to \$\{preset\.name\}`\)/);
  assert.match(resize, /resizeFrameToPreset\(node, preset/);
  assert.match(resize, /recordChangedChildGeometry\(node, result\.childrenBefore\)/);
  assert.match(resize, /recordChangedChildGeometry\(result\.parent, result\.parentChildrenBefore\)/);
  assert.match(source, /event\.target\.matches\('\[data-frame-preset-select\]'\)[\s\S]*?applyFramePresetToSelection\(event\.target\.value\)/,
    'the selected preset is applied through the Inspector change handler');
});

test('resize-to-fit measures visible artwork, preserves child placement, and has the Figma shortcut', () => {
  const resize = functionBody('resizeSelectedFrameToFit', 'applyInspectorAction');
  assert.match(resize, /getPageContentBounds\(\{ children: node\.children \|\| \[\] \}/,
    'the same transformed visible bounds used by SVG export determine the frame size');
  assert.match(resize, /planFrameResizeToFit\(node, bounds, \{ geometryOf: resolvedGeometry \}\)/);
  assert.match(resize, /child\.x = childPlan\.after\.x[\s\S]*?child\.y = childPlan\.after\.y/);
  assert.match(resize, /parent\?\.autoLayout\) applyAutoLayout\(parent\)/,
    'a containing auto-layout frame is recalculated after the selected frame changes size');
  assert.match(resize, /node\.autoLayout/,
    'auto-layout frames fail closed and direct users to Hug contents');
  assert.match(resize, /node\.variableBindings\?\./,
    'shared bound geometry is never silently changed by a fit operation');
  assert.match(source, /action === 'resize-frame-to-fit'\) \{ resizeSelectedFrameToFit\(\); \}/);
  assert.match(source, /mod && event\.altKey && event\.shiftKey && key === 'r'/,
    'Option/Alt + Shift + Command/Ctrl + R invokes resize-to-fit');
  assert.match(source, /import \{ planFrameResizeToFit \} from '\.\/frame-resize-to-fit\.js'/);
});

test('the existing canvas drag and click-to-create frame behavior remains available', () => {
  assert.match(source, /const typeByTool = \{ frame: 'frame'/,
    'Frame tool pointer gestures still enter the ordinary draw path');
  assert.match(source, /if \(interaction\.kind === 'draw'\) \{[\s\S]*?if \(!interaction\.moved\) \{[\s\S]*?clickParent = deepestContainerAt\(interaction\.start\)[\s\S]*?frameSizeForCanvasClick\(topLevelFrameSizesByDocument\.get\(state\.document\.id\)/,
    'a plain canvas click follows Figma default/recent-size behavior while dragging keeps custom dimensions');
});

test('frame preset labels stay readable and all controls are touch-sized on mobile', () => {
  assert.match(stylesheet, /\.frame-preset-option\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/);
  assert.match(stylesheet, /\.frame-preset-option > span:first-child\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(stylesheet, /\.frame-preset-dimensions\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(stylesheet, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.frame-preset-group > summary\s*\{[^}]*min-height:\s*44px/);
  assert.match(stylesheet, /\.frame-preset-option\s*\{\s*min-height:\s*46px/);
  assert.match(stylesheet, /\.frame-preset-resize-select\s*\{\s*min-height:\s*44px;\s*font-size:\s*16px/,
    'changing a selected frame preset remains comfortable on phones');
  assert.match(stylesheet, /\.frame-resize-to-fit\s*\{\s*min-height:\s*44px/,
    'resize-to-fit remains a comfortable tap target on phones');
});
