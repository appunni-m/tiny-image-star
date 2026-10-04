import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, styles] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
]);

test('first-use instructions prioritize starting and cropping over page-size terminology', () => {
  const guide = html.match(/<section class="empty-canvas-guide"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(guide, /Add a photo, draw a frame, or add text to start a design\./);
  assert.match(guide, /Crop a photo[\s\S]*?<ol>[\s\S]*?Add image[\s\S]*?Click or tap the photo[\s\S]*?Crop image[\s\S]*?Drag over what you want to keep[\s\S]*?Finish crop/);
  assert.doesNotMatch(guide, /PDF|fixed-size sheet/,
    'the first task card should not front-load export or page/frame distinctions');
});

test('crop mode gives a short next-step instruction while retaining help in the crop selector', () => {
  assert.match(html, /id="image-crop-toolbar-hint">Choose Crop image, drag to choose what stays, then finish\./);
  const sync = main.match(/function syncImageCropToolbar\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(sync, /Drag inside to choose what stays; release to apply\. Drag an edge or corner to refine\. Finish crop exits; Undo restores it\. Use Hand or Space-drag to pan\./);
  assert.match(styles, /\.image-crop-toolbar\[data-crop-mode="true"\]\s*\{\s*top:\s*8px;\s*bottom:\s*auto;/,
    'crop instructions should dock above the canvas so they do not hide the image edge being edited');
  assert.match(styles, /\.image-crop-toolbar\[data-crop-mode="true"\]\s*\{\s*top:\s*calc\(8px \+ env\(safe-area-inset-top\)\);\s*bottom:\s*auto;/,
    'active crop actions should respect a phone safe area without returning over the bottom crop edge');
  assert.match(html, /Choose a crop shape\./,
    'the crop-ratio control should explain its choices without expanding the main canvas instruction');
});

test('image shortcut tooltip names the modifier supported on each platform', () => {
  const tooltips = main.match(/function installDesignToolTooltips\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(tooltips, /navigator\.userAgentData\?\.platform \|\| navigator\.platform/);
  assert.match(tooltips, /\? '⇧⌘K' : 'Shift\+Ctrl\+K'/);
  assert.match(main, /event\.shiftKey && mod && key === 'k' && !event\.altKey/,
    'the displayed shortcut should match the cross-platform image-picker shortcut handler');
});

test('a single layer selection on a phone opens its Design properties after leaving Layers', () => {
  const keydownStart = main.indexOf("$('#layers-list').addEventListener('keydown', event => {");
  const clickStart = main.indexOf("$('#layers-list').addEventListener('click', event => {");
  const doubleClickStart = main.indexOf("$('#layers-list').addEventListener('dblclick'", clickStart);
  assert.ok(keydownStart >= 0 && clickStart > keydownStart && doubleClickStart > clickStart);
  const keydown = main.slice(keydownStart, clickStart);
  const click = main.slice(clickStart, doubleClickStart);
  assert.match(keydown, /if \(event\.key === 'Enter'\)[\s\S]*?const nodeId = row\.dataset\.layerId;[\s\S]*?setSelection\(\[nodeId\][\s\S]*?showMobileDesignPropertiesForLayer\(nodeId\)/);
  assert.match(click, /else setSelection\(\[node\.id\][\s\S]*?state\.lastLayerSelection = node\.id;\s*if \(innerWidth <= 820 && !state\.layerSelectionMode && !event\.shiftKey && !event\.metaKey && !event\.ctrlKey\) scheduleMobileLayerPropertiesOpen\(node\.id\)/);
  assert.match(click, /if \(state\.layerSelectionMode\)[\s\S]*?setSelection\([\s\S]*?return;/,
    'recipe multi-select keeps Layers open so users can select the full set');
  assert.match(main, /function showMobileDesignPropertiesForLayer\(nodeId\)[\s\S]*?state\.selectedIds\.length !== 1 \|\| state\.selectedIds\[0\] !== nodeId[\s\S]*?if \(state\.inspectorTab !== 'design'\) setInspectorTab\('design'\);[\s\S]*?toggleMobilePanel\('right'\)/,
    'the selection handoff must open the selected layer’s Design properties, not leave both drawers closed');
  assert.match(main, /function scheduleMobileLayerPropertiesOpen\(nodeId\)[\s\S]*?state\.selectedIds\.length !== 1 \|\| state\.selectedIds\[0\] !== nodeId[\s\S]*?setTimeout[\s\S]*?showMobileDesignPropertiesForLayer\(nodeId\)/,
    'the delayed handoff must be canceled if the selection or drawer state changes');
  assert.match(main, /\$\('#layers-list'\)\.addEventListener\('dblclick'[\s\S]*?clearTimeout\(mobileLayerDrawerCloseTimer\)[\s\S]*?renameSelected\(\)/,
    'the delayed close should preserve the double-click rename action');
});

test('phone recipe-selection guidance remains readable at the layer-selection step', () => {
  assert.match(html, /layer-selection-hint"[^>]*hidden>Tap image layers in Layers or on the canvas to select them\. Choose Done, then choose a saved recipe\. Other layers stay unchanged\./);
  const phoneStyles = styles.match(/@media \(max-width: 820px\) \{[\s\S]*?\.layer-select-mode \{[^}]*\}[\s\S]*?\.layer-selection-hint \{[^}]*\}/)?.[0] || '';
  assert.match(phoneStyles, /\.layer-select-mode\s*\{[^}]*font-size:\s*12px/);
  assert.match(phoneStyles, /\.layer-selection-hint\s*\{[^}]*font-size:\s*13px[^}]*line-height:\s*1\.45/);
});

test('component property help highlights all of a multi-target control’s layers', () => {
  assert.match(main, /data-component-property-target-source-ids="\$\{escapeHtml\(JSON\.stringify\(targetSourceIds\)\)\}"/);
  assert.match(main, /componentPropertyTargetInstanceIds\(instance, targetSourceIds\)/);
  assert.match(main, /componentPropertyHighlightNodeIds = nodeIds/);
});
