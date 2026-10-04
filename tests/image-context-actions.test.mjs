import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const imageLibrary = await readFile(new URL('../src/image-library-view.js', import.meta.url), 'utf8');

test('the canvas image action bar exposes crop, save-recipe, and batch-recipe controls', () => {
  assert.match(html, /id="image-crop-toolbar" role="toolbar" aria-label="Image actions" aria-describedby="image-crop-toolbar-hint"/);
  assert.match(html, /id="image-context-adjustments"[^>]*>Adjust image<\/button>/);
  assert.match(html, /id="image-context-save-recipe"[^>]*>Save recipe<\/button>/);
  assert.match(html, /id="image-crop-toolbar-undo"[^>]*hidden>Undo crop<\/button>/);
  assert.match(html, /id="image-crop-toolbar-done"[^>]*>Crop image<\/button>/);
  assert.match(html, /id="image-context-recipe"[^>]*aria-label="Choose a saved recipe to apply to selected images"/);
  assert.match(html, /id="image-context-apply-recipe"[^>]*disabled>Apply recipe<\/button>/);
  assert.match(html, /Choose Crop image, drag across what to keep, then Finish crop\./);
  assert.match(main, /Choose Crop image, drag across what to keep, then Finish crop\./);
  assert.match(main, /Unlock this image to crop it\. Adjust image opens controls; Save recipe reuses edits\./,
    'a locked image should explain why the crop action is unavailable');
  assert.match(css, /\.image-crop-toolbar-copy span \{[^}]*font-size: 12px;[^}]*line-height: 1\.4/,
    'the crop gesture instructions should be readable on desktop as well as mobile');
});

test('image cropping explains the complete gesture before the user enters crop mode', () => {
  assert.match(html, /To crop, select an image and choose Crop image\./,
    'the empty Layers state should tell the user where cropping starts');
  assert.match(main, /To crop a photo, select it and choose Crop image\./,
    'the empty inspector should explain the end-to-end crop flow');
  assert.match(main, /Drag across the part you want to keep\. Drag an edge or corner to adjust it\. Undo crop reverses the last step; Finish crop keeps it\./,
    'crop mode should explain what to drag, how to keep the result, and where to find Undo');
  assert.match(html, /title="Drag over the part of the image to keep, then choose Finish crop"/,
    'the Crop image action should explain its result before entering crop mode');
  const fillControls = main.match(/function imageFillControls\(node, imageFill = node\.imageFill, fillId = ''\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fillControls, 'expected the image-fill controls');
  assert.match(fillControls, /'Crop \/ position image'[\s\S]*?Fill crops the image to this shape\. Choose Crop \/ position image to move or zoom what shows; use the Crop values below for precise adjustments\./,
    'the shape-fill control should use the word crop and explain that it changes which part of the image shows');
  assert.match(fillControls, /aria-label="\$\{fillCropActive \? 'Finish positioning image fill' : 'Crop or position image fill on canvas'\}"/,
    'the image-fill action should expose its crop and positioning purpose to assistive technology');
});

test('selected images provide a direct route to their edit controls, including on phones', () => {
  assert.match(main, /function openImageAdjustments\(nodeId\)[\s\S]*?setInspectorTab\('design'\)[\s\S]*?toggleMobilePanel\('right'\)[\s\S]*?data-property-section="image-adjustments"[\s\S]*?scrollIntoView/,
    'Adjust image should open Properties and scroll directly to the image controls');
  assert.match(main, /section\('Image adjustments', body, null, 'image-adjustments'\)/);
  assert.match(main, /\$\('#image-context-adjustments'\)\.addEventListener\('click',[\s\S]*?openImageAdjustments\(node\.id\)/);
  assert.match(css, /\.image-context-adjustments, \.image-context-save-recipe, \.image-context-undo \{[^}]*flex: 0 0 auto/);
  assert.match(css, /\.image-context-single \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/,
    'the three common phone actions should remain visible together');
  assert.match(css, /\.image-context-adjustments, \.image-context-save-recipe, \.image-context-undo, \.image-context-recipe-picker[^}]*min-height: 44px/,
    'all image actions must keep finger-sized touch targets');
});

test('crop and image-fill modes expose Undo only when the selected image changed', () => {
  assert.match(main, /const previousDocument = history\.undoStack\.at\(-1\)\?\.document/);
  assert.match(main, /const canUndoCurrentAdjustment = Boolean\(active && currentImageTarget && previousImageTarget/);
  assert.match(main, /undoCropAction\.hidden = !canUndoCurrentAdjustment/);
  assert.match(main, /\$\('#image-crop-toolbar-undo'\)\.addEventListener\('click',[\s\S]*?undo\(\)/);
  assert.match(css, /\.image-context-single\[data-crop-mode="true"\]\[data-crop-undo-available="true"\][^}]*grid-template-columns: repeat\(2/,
    'the phone bar should give Undo and Finish crop equal-width targets when Undo is available');
});

test('the recipe apply bar explains how to start and what the in-place batch changes', () => {
  assert.match(main, /state\.layerSelectionMode \? 'Done' : 'Select multiple'/,
    'the Layers action should name its multi-selection purpose');
  assert.match(main, /Choose Select multiple in Layers, then click or tap the image layers you want to update\./,
    'the disabled recipe action should explain how to get the needed selection');
  assert.match(main, /Apply the same saved edits to every selected image\./,
    'the task finder should explain what this action does');
  assert.match(main, /'multi select', 'multiple images', 'choose images'/,
    'the action finder should find the recipe flow from multi-selection language');
  assert.match(main, /This recipe updates these image layers in place\. Other selected layers are left unchanged\./);
  assert.match(main, /Select an edited image and choose Save recipe, then select the images to update and choose the saved recipe\./);
});

test('Assets keeps image work visible and groups secondary design-system tools', () => {
  const assets = html.match(/<section class="assets-section"[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(assets, 'the Assets tab should be present');
  const groups = [...assets.matchAll(/<details class="assets-group"([^>]*)>\s*<summary[^>]*>([^<]+)<\/summary>/g)];
  assert.deepEqual(groups.map(([, , label]) => label), ['Images', 'Components', 'Variables and styles', 'Local fonts']);
  assert.match(groups[0][1], /\bopen\b/, 'image placement should be visible as the default Assets task');
  for (const [, attributes] of groups.slice(1)) assert.doesNotMatch(attributes, /\bopen\b/,
    'less frequent controls should not lengthen the default image view');
  for (const id of ['assets-list', 'placed-image-assets', 'image-library-root', 'components-list', 'variable-collections-list', 'font-assets-list']) {
    assert.match(assets, new RegExp(`id="${id}"`), `keep the existing ${id} render target inside its group`);
  }
  assert.match(assets, /role="heading" aria-level="3"><span>On this page<\/span>/,
    'distinguish image layers placed on the active page from reusable originals');
  assert.match(imageLibrary, /<strong>Reusable images<\/strong><small>Original files for this design<\/small>/,
    'name the reusable-source library and explain that its items are originals');
});

test('mobile tool status and tooltips teach an action instead of only naming the tool', () => {
  const hints = main.match(/const DESIGN_TOOL_STATUS_HINTS = Object\.freeze\(\{([\s\S]*?)\n\}\);/)?.[1] || '';
  assert.ok(hints, 'the selected tool should expose a short contextual instruction in the mobile status line');
  const tools = [...html.matchAll(/data-tool="([^"]+)"/g)].map(([, tool]) => tool).filter(tool => tool !== 'image');
  for (const tool of tools) assert.match(hints, new RegExp(`\\b${tool}:\\s*'[^']*(?:tap|click|drag|choose|draw)`, 'i'),
    `${tool} should have a usable one-line instruction when hover is unavailable`);
  assert.match(html, /title="Frame \(F\) · choose a preset or drag on the canvas to draw"/);
  assert.match(html, /title="Rectangle \(R\) · drag on the canvas to draw"/);
  assert.match(css, /\.bottom-toolbar \.tool-button::after\s*\{[^}]*font-size:\s*10px;[^}]*line-height:\s*12px/,
    'phone tool labels should remain readable without hover');
  assert.match(css, /\.canvas-status\s*\{[^}]*top:\s*108px;[^}]*right:\s*10px;[^}]*max-width:\s*none;/s,
    'mobile instructions should sit below the zoom controls instead of competing with them');
  assert.match(css, /#selection-status\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/,
    'mobile instructions should wrap instead of truncating at the edge of the canvas');
  assert.match(css, /\.canvas-status \.status-divider, \.canvas-status #position-status \{ display: none; \}/,
    'duplicate zoom and position readouts should not take space from the phone instruction');
});

test('the Pen tool has touch controls to finish or cancel an open path', () => {
  assert.match(html, /id="pen-drawing-bar" role="toolbar" aria-label="Pen drawing actions" hidden/);
  assert.match(html, /id="pen-drawing-finish" type="button" disabled>Finish path/);
  assert.match(html, /id="pen-drawing-cancel" type="button">Cancel/);
  assert.match(main, /function syncPenDrawingBar\(\)[\s\S]*?state\.penDraft\.anchors\.length < 2/,
    'do not allow finishing until the path has enough points to create geometry');
  assert.match(main, /\$\('#pen-drawing-finish'\)\.addEventListener\('click',[\s\S]*?finishPenPath\(false\)/);
  assert.match(main, /\$\('#pen-drawing-cancel'\)\.addEventListener\('click',[\s\S]*?cancelPenPath\(\)/);
  assert.match(css, /\.pen-drawing-actions button\s*\{[^}]*min-height:\s*44px/,
    'Finish path and Cancel should be easy to tap on phones');
});

test('less frequent image AI operations use a discoverable, touch-sized disclosure', () => {
  const section = main.match(/function imageAiToolsSection\(node\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(section, /<summary class="property-heading"><span>More image tools<\/span><small>Remove background · erase · isolate · expand · upscale<\/small><\/summary>/,
    'the collapsed label should tell users which operations are inside');
  for (const tool of ['imageEraseControls', 'objectIsolationControls', 'backgroundRemovalControls', 'resolutionBoostControls', 'imageExpansionControls']) {
    assert.match(section, new RegExp(`\\$\\{${tool}\\(node\\)\\}`), `${tool} should stay available inside the group`);
  }
  assert.match(section, /const open = active \|\| hasSavedEdit \|\| state\.imageAiToolsExpandedNodeIds\.has\(node\.id\)/,
    'ongoing or reversible edits should open automatically, and a user-opened group should stay open after edits');
  assert.match(main, /addEventListener\('toggle',[\s\S]*?imageAiToolsExpandedNodeIds\.add[\s\S]*?imageAiToolsExpandedNodeIds\.delete/,
    'the disclosure should remember its open state by image layer');
  assert.match(css, /\.image-ai-tools > summary\s*\{[^}]*min-height:\s*40px/);
  assert.match(css, /\.image-ai-tools > summary\s*\{[^}]*min-height:\s*44px/,
    'the disclosure should remain easy to tap at phone width');
  assert.match(css, /\.image-ai-tools > summary > small\s*\{[^}]*font-size:\s*11px/,
    'the description of the collapsed tools should be legible on phones');
});

test('single-image and multi-image canvas actions route to the existing recipe and crop workflows', () => {
  const syncStart = main.indexOf('function syncImageCropToolbar()');
  const syncEnd = main.indexOf('\nfunction toggleSelectedImageCropMode()', syncStart);
  assert.ok(syncStart >= 0 && syncEnd > syncStart, 'expected the contextual image toolbar synchronizer');
  const sync = main.slice(syncStart, syncEnd);
  assert.match(sync, /const singleImage = state\.selectedIds\.length === 1 && isImage/);
  assert.match(sync, /const batchImages = selectedImages\.length > 1/);
  assert.match(sync, /Apply to \$\{selectedImages\.length\} images/);
  assert.match(sync, /Other selected layers are left unchanged/);
  assert.match(sync, /Boolean\(state\.bulk\)/, 'avoid stacking the context bar on top of the active batch bar');

  const actionsStart = main.indexOf("$('#image-context-save-recipe').addEventListener");
  const actionsEnd = main.indexOf("$('#shape-builder-bar').addEventListener", actionsStart);
  assert.ok(actionsStart >= 0 && actionsEnd > actionsStart, 'expected direct contextual image action handlers');
  const actions = main.slice(actionsStart, actionsEnd);
  assert.match(main, /\$\('#image-crop-toolbar-done'\)\.addEventListener\('click', toggleSelectedImageCropMode\)/);
  assert.match(actions, /saveRecipeFor\(node\.id\)/);
  assert.match(actions, /startRecipe\(recipe, targets\)/);
  assert.match(actions, /closeMobilePanels\(\{ restoreFocus: false \}\)/);
});

test('floating recipe controls retain finger-sized touch targets on mobile', () => {
  assert.match(css, /\.image-context-adjustments, \.image-context-save-recipe, \.image-context-undo, \.image-context-recipe-picker, \.image-context-apply-recipe, \.image-crop-toolbar-done\s*\{[^}]*min-height:\s*44px/);
});

test('the top-bar Share action opens live invitations and File keeps local package sharing', () => {
  assert.match(html, /id="share-button"[^>]*>Share<\/button>/);
  assert.match(main, /#share-button'\)\.addEventListener\('click', \(\) => dispatchWorkspaceCollaborationIntent\('tiny-image-star:share-live'\)\)/);
  const menuStart = main.indexOf('function openFileMenu(');
  const menuEnd = main.indexOf('\nfunction dispatchWorkspaceCollaborationIntent', menuStart);
  assert.ok(menuStart >= 0 && menuEnd > menuStart, 'expected the File menu action list');
  assert.match(main.slice(menuStart, menuEnd), /label: 'Send design file…', action: shareDesignFile/);
});
