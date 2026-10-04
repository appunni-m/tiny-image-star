import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const inspectorEmptyState = await readFile(new URL('../src/inspector-empty-state.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const imageLibrary = await readFile(new URL('../src/image-library-view.js', import.meta.url), 'utf8');

test('the canvas image action bar exposes crop, export, save-recipe, and batch-recipe controls', () => {
  assert.match(html, /id="image-crop-toolbar" role="toolbar" aria-label="Image actions" aria-describedby="image-crop-toolbar-hint"/);
  assert.match(html, /id="image-context-adjustments"[^>]*>Adjust image<\/button>/);
  assert.match(html, /id="image-context-save-recipe"[^>]*>Save recipe<\/button>/);
  assert.match(html, /id="image-context-export"[^>]*aria-label="Export selected image"[^>]*>Export image<\/button>/);
  assert.match(html, /id="image-crop-toolbar-undo"[^>]*hidden>Undo crop<\/button>/);
  assert.match(html, /id="image-crop-toolbar-done"[^>]*>Crop image<\/button>/);
  assert.match(html, /id="image-context-recipe"[^>]*aria-label="Choose a saved recipe to apply to selected images"/);
  assert.match(html, /id="image-context-apply-recipe"[^>]*disabled>Apply recipe<\/button>/);
  assert.match(html, /Choose Crop image, drag to choose what stays, then finish\./);
  assert.match(main, /Choose Crop image, drag to choose what stays, then choose Finish crop\./);
  assert.match(main, /Unlock this image to crop it\. Adjust image opens controls; Save recipe reuses edits\./,
    'a locked image should explain why the crop action is unavailable');
  assert.match(css, /\.image-crop-toolbar-copy span \{[^}]*font-size: 12px;[^}]*line-height: 1\.4/,
    'the crop gesture instructions should be readable on desktop as well as mobile');
});

test('open vector stroke controls expose Figma filled diamond and circle endpoints', () => {
  assert.match(main, /\['diamond', 'Filled diamond'\], \['circle', 'Filled circle'\]/);
  assert.match(main, /Open line ends can use an arrow, triangle, diamond, or circle marker\./);
  assert.match(main, /field === 'startDecoration' && strokeDecorationTypes\.includes\(input\.value\)/);
  assert.match(main, /field === 'endDecoration' && strokeDecorationTypes\.includes\(input\.value\)/);
});

test('image cropping explains the complete gesture before the user enters crop mode', () => {
  assert.match(html, /Choose <strong>Add image<\/strong> and select a photo file\.[\s\S]*?Click or tap the photo, then choose <strong>Crop image<\/strong>\.[\s\S]*?Drag over what you want to keep, then choose <strong>Finish crop<\/strong>/,
    'the empty-canvas start card should explain the complete photo crop path in order');
  assert.match(html, /Select a photo to crop, adjust, or save it as a recipe\./,
    'the Layers state should cue users to select a photo without repeating the full walkthrough');
  assert.match(inspectorEmptyState, /Select an item to edit its settings\. To start, add an image, draw a frame, or add text\./,
    'an empty workspace should retain its existing first-use guidance');
  assert.match(inspectorEmptyState, /No layer selected[\s\S]*?Select a layer on the canvas or in Layers to see and edit its properties\./,
    'a populated workspace should tell users how to reach the existing layers');
  assert.match(main, /const emptyState = inspectorEmptyState\(page\)/,
    'Properties should derive its empty-selection message from the current page');
  assert.doesNotMatch(main, /To crop: Add image → click or tap the photo → Crop image/,
    'the long crop sequence should appear once instead of competing in every empty panel');
  assert.match(main, /Drag inside to choose what stays; release to apply\. Drag an edge or corner to refine\. Finish crop exits; Undo restores it\. Use Hand or Space-drag to pan\./,
    'crop mode should explain the selection gesture, handle refinement, exit, undo, and panning without a dense paragraph');
  assert.match(main, /Cropping is unavailable because this image’s dimensions are missing\./,
    'disabled crop controls should explain the missing prerequisite');
  assert.match(html, /<option value="1:1">Square \(1:1\)<\/option>[\s\S]*?<option value="16:9">Widescreen \(16:9\)<\/option>/,
    'the crop-shape menu should use familiar ratio names');
  assert.match(html, /title="Drag to choose what stays; release to apply, then choose Finish crop"/,
    'the Crop image action should explain its result before entering crop mode');
  const fillControls = main.match(/function imageFillControls\(node, imageFill = node\.imageFill, fillId = ''\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fillControls, 'expected the image-fill controls');
  assert.match(fillControls, /'Reposition photo'[\s\S]*?the shape edge crops what you see/,
    'the shape-fill control should explain that the shape edge determines what part of the photo shows');
  assert.match(fillControls, /aria-label="\$\{fillCropActive \? 'Finish positioning the photo in this shape' : 'Reposition photo inside shape on canvas'\}"/,
    'the image-fill action should expose its crop and positioning purpose to assistive technology');
});

test('selected object identity and frame sizing context stay visible in Properties', () => {
  assert.match(main, /selected-layer-summary[\s\S]*?node\.name[\s\S]*?typeLabel[\s\S]*?contextLabel/,
    'Properties should identify the selected layer, its type, and where it lives');
  assert.match(main, /state\.tool !== 'select'[\s\S]*?Selected: \$\{selectionLabel\}/,
    'the canvas status should keep the selected layer visible while a drawing tool is active');
  assert.match(main, /Page is the workspace\. This frame sets the design width and height\. Export PDF sets the paper size\./,
    'frame properties should distinguish workspace, design dimensions, and PDF paper size');
  assert.match(css, /\.selected-layer-summary \{[^}]*display: grid/,
    'the selected layer summary should be visibly separated from its editing controls');
});

test('the empty canvas keeps one visually primary start action', () => {
  const startCard = html.match(/<div class="empty-canvas-card">[\s\S]*?<\/div>\s*<\/section>/)?.[0] || '';
  const layersEmpty = html.match(/<div class="empty-sidebar" id="empty-layers">[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  const inspectorEmpty = main.match(/if \(!entries\.length\) \{[\s\S]*?content\.innerHTML = `([\s\S]*?)`;[\s\S]*?return;/)?.[1] || '';
  assert.match(startCard, /class="primary-button"[^>]*data-empty-canvas-action="add-image"/,
    'the canvas should own the clearest primary action for starting a design');
  assert.match(layersEmpty, /class="secondary-button"[^>]*data-action="add-image"/,
    'the Layers shortcut should remain available without competing visually with the start card');
  assert.match(main, /const startActions = emptyState\.showStartActions[\s\S]*?class="secondary-button"[^>]*data-action="add-image"/,
    'the Properties shortcut should remain available without competing visually with the start card');
});

test('crop has a discoverable aspect-ratio control that locks drawing and handle resizing', () => {
  const ratio = html.match(/<label class="image-crop-ratio-control"[\s\S]*?<\/label>/)?.[0] || '';
  assert.ok(ratio, 'expected a labeled crop ratio control in the image action bar');
  assert.match(ratio, /Crop shape/);
  for (const choice of ['Free \\(any shape\\)', 'Square \\(1:1\\)', 'Portrait \\(4:5\\)', 'Landscape \\(3:2\\)', 'Widescreen \\(16:9\\)']) assert.match(ratio, new RegExp(`>${choice}<`));
  assert.match(main, /imageCropAspectRatio: 'free'/, 'the ratio is ephemeral tool state by default');
  assert.match(main, /aspectRatioControl\.hidden = !\(active && isImage\)/,
    'the control belongs to image layer crop, not the separate photo-fill positioning flow');
  assert.match(html, /aria-label="Crop shape"/);
  assert.match(main, /constrainImageCropDisplayDrag\(\{[\s\S]*?aspectRatio: currentImageCropAspectRatio\(\)/,
    'the live selection marquee and completed crop should use the selected ratio');
  assert.match(main, /moveImageCropHandle\(\{[\s\S]*?aspectRatio: currentImageCropAspectRatio\(\)/,
    'edge and corner resizing should preserve the selected ratio');
  assert.match(main, /Object\.hasOwn\(IMAGE_CROP_ASPECT_RATIOS, value\)/,
    'unsupported option values should not become crop state');
  assert.match(css, /\.image-crop-ratio-control select\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*44px/,
    'the ratio selector should remain finger-sized on mobile');
});

test('selected images provide a direct route to their edit controls, including on phones', () => {
  assert.match(main, /function openImageAdjustments\(nodeId\)[\s\S]*?setInspectorTab\('design'\)[\s\S]*?toggleMobilePanel\('right'\)[\s\S]*?data-property-section="image-adjustments"[\s\S]*?scrollIntoView/,
    'Adjust image should open Properties and scroll directly to the image controls');
  assert.match(main, /section\('Image adjustments', body, null, 'image-adjustments'\)/);
  assert.match(main, /\$\('#image-context-adjustments'\)\.addEventListener\('click',[\s\S]*?openImageAdjustments\(node\.id\)/);
  assert.match(css, /\.image-context-adjustments, \.image-context-save-recipe, \.image-context-undo, \.image-context-export \{[^}]*flex: 0 0 auto/);
  assert.match(css, /\.image-context-single \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/,
    'crop, recipe, adjustment, and export actions should remain visible together on phones');
  assert.match(css, /\.image-context-export \{ display: none; \}/,
    'desktop keeps the established Properties export route without duplicating the canvas action');
  assert.match(css, /\.image-context-export:not\(\[hidden\]\) \{ display: block; \}/,
    'the selected-image export action is exposed in the mobile canvas bar');
  assert.match(css, /\.image-context-adjustments, \.image-context-save-recipe, \.image-context-export, \.image-context-undo, \.image-context-recipe-picker[^}]*min-height: 44px/,
    'all image actions must keep finger-sized touch targets');
});

test('a selected image can be exported from its mobile canvas action bar without opening Properties', () => {
  const syncStart = main.indexOf('function syncImageCropToolbar()');
  const syncEnd = main.indexOf('\nfunction toggleSelectedImageCropMode()', syncStart);
  const sync = main.slice(syncStart, syncEnd);
  assert.match(sync, /const exportAction = \$\('#image-context-export'\)/);
  assert.match(sync, /exportAction\.hidden = active \|\| !singleImage/,
    'show export only for a single selected image and hide it during crop mode');
  assert.match(main, /\$\('#image-context-export'\)\.addEventListener\('click',[\s\S]*?node\?\.type === 'image'\) void exportSelectionPng\(\)/,
    'the contextual action should use the existing selected-image export path');
  assert.match(css, /\.image-context-single\[data-crop-mode="false"\] > button\s*\{[^}]*font-size: 10px[^}]*white-space: normal/,
    'four compact labels should fit the narrow phone action bar without shrinking tap targets');
});

test('small-phone zoom controls keep a visible Fit action for off-screen artwork', () => {
  assert.match(html, /id="zoom-fit" aria-label="Zoom to fit" title="Zoom to fit selection"><span aria-hidden="true">⌗<\/span><span class="fit-button-label">Fit<\/span><\/button>/,
    'the zoom-to-fit control should pair its icon with a concise phone label');
  assert.match(css, /\.fit-button-label\s*\{\s*display:\s*none;\s*\}/,
    'desktop should retain the compact icon control');
  assert.match(css, /\.fit-button\s*\{\s*display:\s*flex;\s*width:\s*auto;\s*min-width:\s*48px;\s*gap:\s*4px;\s*padding-inline:\s*6px;\s*font-size:\s*11px;\s*\}/,
    'small phones should have a finger-sized labeled fit action');
  assert.match(css, /\.fit-button > span:first-child\s*\{\s*display:\s*none;\s*\}/,
    'the redundant desktop icon should not crowd the clear phone label');
  assert.match(css, /\.fit-button-label\s*\{\s*display:\s*inline;\s*\}/,
    'small phones should expose the action name visually instead of relying on a tooltip');
});

test('the hand tool pans while crop stays open, and selected Assets images actually select their layer', () => {
  assert.match(main, /state\.imageCropMode && state\.imageFillCropTarget && state\.tool !== 'hand'/,
    'the Hand tool should bypass photo-fill crop drags');
  assert.match(main, /event\.button === 1 \|\| state\.spaceDown \|\| \(state\.tool === 'hand' && !state\.imageEraseMode && !state\.objectIsolationMode\)/,
    'the Hand tool should pan during photo crop mode instead of changing the crop');
  assert.match(main, /state\.tool === 'hand' && state\.imageCropMode[\s\S]*?Drag to pan · Select to crop/,
    'the visible status should explain how panning and crop gestures work together');
  assert.match(main, /Use Hand or Space-drag to pan/);
  assert.match(css, /#scene-canvas\.tool-hand \{ cursor: grab; \}/);
  assert.match(main, /card\.title = `Select \$\{node\.name\} on this page`/);
  assert.match(main, /\$\('#placed-image-assets'\)\.addEventListener\('click'[\s\S]*?setSelection\(\[node\.id\], \{ source: 'assets' \}\)/,
    'an image card in Assets → On this page should select its layer');
  assert.match(main, /candidate\.classList\.toggle\('is-selected'/);
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

test('long imported image names stay bounded in the save-recipe form and wrap in recipe dialogs', () => {
  assert.match(main, /\$\('#recipe-name'\)\.value = defaultImageRecipeName\(node\.name\)/,
    'a long image layer name should seed a valid bounded recipe name');
  assert.ok(/\$\('#recipe-dialog-copy'\)\.textContent = renaming[\s\S]*?Choose one saved recipe to replace with “\$\{node\.name\}”’s current look/.test(main),
    'recipe dialog guidance uses text content for the source filename instead of interpreting it as markup');
  assert.match(css, /\.modal-copy \{[^}]*overflow-wrap:\s*anywhere;/,
    'unbroken filenames in recipe guidance must wrap inside the phone-sized dialog');
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
  assert.match(html, /title="Frame \(F or A\) · choose a preset, click to create, or drag to draw"/);
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

test('a shape with one visible image fill exposes an unambiguous canvas crop and position action', () => {
  const target = main.match(/function uniqueVisibleShapeImageFill\(node\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(target, 'expected a helper that resolves one shape image fill for direct positioning');
  assert.match(target, /fill\.type === 'image'[\s\S]*?fill\.visible !== false[\s\S]*?\(fill\.opacity \?\? 1\) > 0/,
    'hidden and fully transparent image fills must not create a misleading crop action');
  assert.match(target, /fills\.length === 1 \? fills\[0\] : null/,
    'multiple visible image fills must keep using the explicitly targeted Inspector controls');

  const reason = main.match(/function shapeImageFillCropUnavailableReason\(node, fill\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(reason, /This photo is set to Fit or Tile\. Choose Fill in Design properties before positioning it inside the shape\./,
    'Fit and Tile fills should say exactly how to enable positioning');
  assert.match(reason, /imageFillCropContext\(node, fill\.id\)/,
    'the shortcut must share the crop-mode source and geometry eligibility checks');

  const syncStart = main.indexOf('function syncImageCropToolbar()');
  const syncEnd = main.indexOf('\nfunction toggleSelectedImageCropMode()', syncStart);
  const sync = main.slice(syncStart, syncEnd);
  assert.match(sync, /const shapeImageFill = uniqueVisibleShapeImageFill\(node\)/);
  assert.match(sync, /active \|\| singleImage \|\| singleShapeImageFill \|\| batchImages/,
    'the contextual bar should appear for the one unambiguous shape fill');
  assert.match(sync, /adjustAction\.hidden = active \|\| !singleImage/);
  assert.match(sync, /saveRecipeAction\.hidden = active \|\| !singleImage/,
    'shape selection must not expose image-layer-only Adjust and Save recipe actions');
  assert.match(sync, /action\.textContent = 'Reposition photo'/);
  assert.match(sync, /action\.disabled = Boolean\(unavailableReason\)/,
    'unusable or locked fills must remain visible with their specific explanation');
  assert.match(sync, /action\.textContent = adjustingFill \? 'Done positioning' : 'Finish crop'/,
    'the existing contextual action must finish image-fill positioning in place');
  assert.match(sync, /singleActions\.dataset\.imageFillContext = String\(singleShapeImageFill \|\| active && adjustingFill\)/,
    'phone layout should give the shape crop action and Finish control the full toolbar width');

  const toggleStart = main.indexOf('function toggleSelectedImageCropMode()');
  const toggleEnd = main.indexOf('\nfunction finishImageCropMode()', toggleStart);
  const toggle = main.slice(toggleStart, toggleEnd);
  assert.match(toggle, /const fill = uniqueVisibleShapeImageFill\(node\)/);
  assert.match(toggle, /state\.imageFillCropTarget = \{ nodeId: node\.id, fillId: fill\.id \}/,
    'starting from the canvas bar must enter the existing targeted fill-crop mode');

  assert.match(css, /\.image-context-single\[data-image-fill-context="true"\] #image-crop-toolbar-done \{ grid-column: 1 \/ -1; \}/,
    'the contextual action must remain a usable full-width target on phones');
});

test('floating recipe controls retain finger-sized touch targets on mobile', () => {
  assert.match(css, /\.image-context-adjustments, \.image-context-save-recipe, \.image-context-export, \.image-context-undo, \.image-context-recipe-picker, \.image-context-apply-recipe, \.image-crop-toolbar-done\s*\{[^}]*min-height:\s*44px/);
});

test('the top-bar Share action opens live invitations and File keeps local package sharing', () => {
  assert.match(html, /id="share-button"[^>]*>Share<\/button>/);
  assert.match(main, /#share-button'\)\.addEventListener\('click', \(\) => dispatchWorkspaceCollaborationIntent\('tiny-image-star:share-live'\)\)/);
  const menuStart = main.indexOf('function openFileMenu(');
  const menuEnd = main.indexOf('\nfunction dispatchWorkspaceCollaborationIntent', menuStart);
  assert.ok(menuStart >= 0 && menuEnd > menuStart, 'expected the File menu action list');
  assert.match(main.slice(menuStart, menuEnd), /label: 'Send design file…', action: shareDesignFile/);
});
