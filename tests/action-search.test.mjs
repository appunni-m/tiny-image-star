import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeActionSearchText, searchActions } from '../src/action-search.js';
import { createEditorToolActions } from '../src/editor-tool-tasks.js';
import { createEditorLayerActions } from '../src/editor-layer-tasks.js';

const [html, main, styles, readme] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
]);

const actions = [
  { id: 'add-image', label: 'Add image', description: 'Choose a photo from this device.', keywords: ['images', 'photo', 'photos', 'picture', 'pictures', 'import', 'crop image'] },
  { id: 'crop-image', label: 'Crop image', description: 'Drag over the part to keep, then finish the crop.', keywords: ['trim', 'cut', 'photo', 'photos', 'image', 'images', 'cropping'] },
  { id: 'create-frame', label: 'Draw a frame', description: 'Choose the Frame tool, then drag on the canvas or select a size preset.', keywords: ['create a frame', 'create frame', 'artboard', 'phone screen'] },
  { id: 'create-component', label: 'Create a component from this layer', description: 'Turn the selected layer and its children into a reusable component.', keywords: ['component', 'components', 'make component', 'reusable component', 'create reusable'] },
  { id: 'add-text', label: 'Add text', description: 'Choose the text tool, then click or drag on the canvas.', keywords: ['type', 'label', 'title', 'copy'] },
  { id: 'export-pdf', label: 'Export page as PDF', description: 'Choose a paper size and save a local PDF.', keywords: ['print', 'document'] },
  { id: 'erase-image-object', label: 'Erase an object from an image', description: 'Brush over the object, then finish erasing.', keywords: ['erase object', 'erase objects', 'remove object', 'remove objects', 'remove person', 'remove people', 'magic erase'] },
  { id: 'isolate-image-subject', label: 'Cut out or isolate a subject', description: 'Draw around the subject and create a transparent layer.', keywords: ['select subject', 'isolate subject', 'transparent cutout'] },
  { id: 'remove-image-background', label: 'Remove image background', description: 'Make the image transparent and keep the original.', keywords: ['remove background', 'remove backgrounds', 'transparent background', 'background removal', 'photo background', 'image background'] },
  { id: 'expand-image', label: 'Expand image edges', description: 'Set how much canvas to add at each edge.', keywords: ['expand image', 'uncrop', 'outpaint', 'extend photo edges'] },
  { id: 'boost-image-resolution', label: 'Boost image resolution 4×', description: 'Upscale the image locally and keep the source.', keywords: ['upscale image', 'upscale photo', 'higher resolution', 'super resolution'] },
  { id: 'apply-image-recipe', label: 'Apply a recipe to selected images', description: 'Apply the same saved edits to every selected image.', keywords: ['batch', 'bulk', 'preset', 'process images', 'apply edits', 'multi select', 'multiple images', 'choose images'] },
];

test('action search understands full questions, aliases, and accented text', () => {
  assert.equal(normalizeActionSearchText('  Cómo recortar — IMAGE!  '), 'como recortar image');
  assert.deepEqual(searchActions(actions, 'How do I crop an image?').map(action => action.id), ['crop-image', 'add-image']);
  assert.deepEqual(searchActions(actions, 'How do you crop an image?').map(action => action.id), ['crop-image', 'add-image']);
  assert.deepEqual(searchActions(actions, 'How do I create a component?').map(action => action.id), ['create-component']);
  assert.deepEqual(searchActions(actions, 'create a frame').map(action => action.id), ['create-frame']);
  assert.deepEqual(searchActions(actions, 'draw a frame').map(action => action.id), ['create-frame']);
  assert.deepEqual(searchActions(actions, 'crop images').map(action => action.id), ['crop-image', 'add-image']);
  assert.deepEqual(searchActions(actions, 'cropping photos').map(action => action.id), ['crop-image']);
  assert.deepEqual(searchActions(actions, 'photo').map(action => action.id), ['add-image', 'crop-image', 'remove-image-background', 'expand-image', 'boost-image-resolution']);
  assert.deepEqual(searchActions(actions, 'paper size').map(action => action.id), ['export-pdf']);
  assert.deepEqual(searchActions(actions, 'erase object').map(action => action.id), ['erase-image-object']);
  assert.deepEqual(searchActions(actions, 'cut out subject').map(action => action.id), ['isolate-image-subject']);
  assert.deepEqual(searchActions(actions, 'transparent background').map(action => action.id), ['remove-image-background']);
  assert.deepEqual(searchActions(actions, 'uncrop photo').map(action => action.id), ['expand-image']);
  assert.deepEqual(searchActions(actions, 'upscale photo').map(action => action.id), ['boost-image-resolution']);
  assert.deepEqual(searchActions(actions, 'How do I remove the background from a photo?').map(action => action.id), ['remove-image-background']);
  assert.deepEqual(searchActions(actions, 'How do I select multiple images for a recipe?').map(action => action.id), ['apply-image-recipe']);
});

test('beginner task suggestions lead to the matching action', () => {
  const suggestions = [
    ['How do I crop an image?', 'crop-image'],
    ['remove image background', 'remove-image-background'],
    ['add text', 'add-text'],
    ['apply recipe to selected images', 'apply-image-recipe'],
    ['export page as PDF', 'export-pdf']
  ];
  for (const [query, expectedId] of suggestions) {
    assert.ok(searchActions(actions, query).some(action => action.id === expectedId), `${query} should find ${expectedId}`);
  }
});

test('action search requires every meaningful term and preserves source order for ties', () => {
  assert.deepEqual(searchActions(actions, 'crop export').map(action => action.id), []);
  assert.deepEqual(searchActions(actions, 'crop').map(action => action.id), ['crop-image', 'add-image']);
  assert.deepEqual(searchActions(actions, 'image').map(action => action.id), ['add-image', 'crop-image', 'erase-image-object', 'remove-image-background', 'expand-image', 'boost-image-resolution', 'apply-image-recipe']);
  assert.deepEqual(searchActions(actions, 'photo', { limit: 1 }).map(action => action.id), ['add-image']);
});

test('action search validates its bounded result limit and action list', () => {
  assert.throws(() => searchActions(null, 'crop'), /action list/i);
  assert.throws(() => searchActions(actions, 'crop', { limit: 0 }), /between one and one hundred/i);
});

test('plain-language drawing and navigation tasks open the matching editor tools', () => {
  const openedTools = [];
  const toolActions = createEditorToolActions({ setTool: tool => openedTools.push(tool) });
  const cases = [
    ['How do I draw a rectangle?', 'draw-rectangle', 'rectangle'],
    ['make a circle', 'draw-ellipse', 'ellipse'],
    ['draw a star', 'draw-star', 'star'],
    ['make a polygon', 'draw-polygon', 'polygon'],
    ['pan the canvas', 'pan-canvas', 'hand'],
    ['sample a color', 'pick-color', 'eyedropper'],
    ['draw a bezier path', 'draw-pen-path', 'pen']
  ];
  for (const [query, expectedId, expectedTool] of cases) {
    const match = searchActions(toolActions, query)[0];
    assert.equal(match?.id, expectedId, `expected ${query} to find ${expectedId}`);
    match.run();
    assert.equal(openedTools.at(-1), expectedTool, `${expectedId} should open the matching canvas tool`);
  }
  assert.throws(() => createEditorToolActions(), /setTool function/);
});

test('drawing and navigation tasks explain why they are disabled during a batch', () => {
  const actions = createEditorToolActions({ setTool() {}, disabledReason: 'Finish or cancel the current image batch first.' });
  const rectangle = actions.find(action => action.id === 'draw-rectangle');
  assert.equal(rectangle.disabled, true);
  assert.equal(rectangle.unavailableReason, 'Finish or cancel the current image batch first.');
});

test('plain-language layer tasks search, respect selection state, and run their commands', () => {
  const called = [];
  const tasks = createEditorLayerActions({
    selectedCount: 2,
    pageLayerCount: 5,
    canGroup: true,
    canUngroup: true,
    group: () => called.push('group'),
    ungroup: () => called.push('ungroup'),
    duplicate: () => called.push('duplicate'),
    remove: () => called.push('delete'),
    selectAll: () => called.push('select-all'),
    deselectAll: () => called.push('deselect-all')
  });
  const cases = [
    ['duplicate a layer', 'duplicate-layers', 'duplicate'],
    ['group these layers', 'group-layers', 'group'],
    ['ungroup the group', 'ungroup-layers', 'ungroup'],
    ['delete selected layers', 'delete-layers', 'delete'],
    ['select all on this page', 'select-all-layers', 'select-all'],
    ['clear the selection', 'deselect-all-layers', 'deselect-all']
  ];
  for (const [query, expectedId, command] of cases) {
    const match = searchActions(tasks, query)[0];
    assert.equal(match?.id, expectedId, `expected ${query} to find ${expectedId}`);
    assert.equal(match.disabled, false);
    match.run();
    assert.equal(called.at(-1), command);
  }
  assert.throws(() => createEditorLayerActions(), /handlers for each layer command/);
});

test('layer tasks explain missing selection and current batch restrictions', () => {
  const handlers = { group() {}, ungroup() {}, duplicate() {}, remove() {}, selectAll() {}, deselectAll() {} };
  const empty = createEditorLayerActions({ ...handlers });
  assert.equal(empty.find(action => action.id === 'duplicate-layers').unavailableReason, 'Select a layer first.');
  assert.equal(empty.find(action => action.id === 'select-all-layers').unavailableReason, 'This page has no layers yet.');
  const busy = createEditorLayerActions({
    ...handlers,
    selectedCount: 2,
    pageLayerCount: 2,
    disabledReason: 'Finish or cancel the current image batch first.'
  });
  assert.equal(busy.find(action => action.id === 'group-layers').disabled, true);
  assert.equal(busy.find(action => action.id === 'group-layers').unavailableReason, 'Finish or cancel the current image batch first.');
});

test('task search accurately explains that results open tools instead of promising walkthroughs', () => {
  assert.match(html, /id="quick-actions-dialog"[^>]*aria-labelledby="quick-actions-title"/);
  assert.match(html, /id="quick-actions-search"[^>]*role="combobox"[^>]*aria-controls="quick-actions-results"/);
  assert.match(html, /id="quick-actions-results"[^>]*role="listbox"/);
  assert.match(html, /id="quick-actions-title">Find a task or action/);
  const searchInput = html.match(/<input class="text-field quick-actions-search" id="quick-actions-search"[^>]*>/)?.[0] || '';
  const searchHelp = html.match(/<p class="quick-actions-help" id="quick-actions-help">([^<]*)<\/p>/)?.[1] || '';
  assert.match(searchInput, /placeholder="Try “crop a photo”"/);
  assert.doesNotMatch(searchInput, /How do (?:I|you)/, 'the placeholder should not imply search returns a how-to guide');
  assert.match(searchHelp, /Search for a tool or task in your own words/);
  assert.match(searchHelp, /Choose a result to open its tool or control/);
  assert.match(searchHelp, /description says what it does/);
  assert.match(searchHelp, /Disabled results explain what you need first/);
  assert.doesNotMatch(searchHelp, /How do (?:I|you)|walkthrough|next steps/i,
    'Help search copy should describe action discovery, not promise a guided answer');
  assert.match(html, /id="quick-actions-empty"[^>]*>No matching action\.[\s\S]*shorter word/);
  assert.match(main, /\{ label: 'Search actions…', shortcut: '⌘K', action: \(\) => openQuickActions\(\) \}/);
  assert.match(main, /key === 'k'[\s\S]*?openQuickActions\(\)/);
  assert.match(main, /id: 'crop-image', label: 'Crop image'[\s\S]*?drag to select the area to keep[\s\S]*?toggleSelectedImageCropMode/i);
  assert.match(main, /import \{ createEditorToolActions \} from '\.\/editor-tool-tasks\.js'/);
  assert.match(main, /import \{ createEditorLayerActions \} from '\.\/editor-layer-tasks\.js'/);
  assert.match(main, /const drawingAndNavigationActions = createEditorToolActions\(\{ setTool, disabledReason: batchReason \}\)[\s\S]*?\.\.\.drawingAndNavigationActions/,
    'the task finder should expose the existing drawing and navigation tools');
  assert.match(main, /const layerActions = createEditorLayerActions\([\s\S]*?group: groupSelectedLayers,[\s\S]*?duplicate: duplicateSelected,[\s\S]*?remove: deleteSelected,[\s\S]*?\.\.\.layerActions/,
    'the task finder should expose selection-aware group, duplicate, delete, and selection commands');
  assert.match(main, /id: 'crop-image',[\s\S]*?keywords: \[[^\]]*'images'[^\]]*'cropping'/);
  assert.match(main, /Select an image layer first, or choose Add image if none is on this page\./);
  assert.match(main, /id: 'add-image', label: 'Add image'[\s\S]*?Add an image before cropping it[\s\S]*?keywords: \[[^\]]*'crop image'/);
  assert.match(main, /const componentSource = selection\.length === 1 \? selection\[0\] : null[\s\S]*?const componentCreationReason = batchReason[\s\S]*?Detach this component instance before creating a main component\./,
    'component help should only run when the selected layer can become a main component');
  assert.match(main, /id: 'create-component', label: 'Create a component from this layer'[\s\S]*?Place copies later from Assets → Components\.[\s\S]*?run: \(\) => makeComponent\(componentSource\.id\)/,
    'component search results should explain both creation and where to place reusable copies');
  assert.match(main, /id: 'save-image-recipe'[\s\S]*?saveRecipeFor\(selectedImage\.id\)/);
  assert.match(main, /id: 'apply-image-recipe'[\s\S]*?image-context-recipe/);
  assert.match(main, /function openImageAiControls\(nodeId, controlSelector\)[\s\S]*?state\.imageAiToolsExpandedNodeIds\.add\(nodeId\)[\s\S]*?control\?\.focus/);
  for (const action of ['erase-image-object', 'isolate-image-subject', 'remove-image-background', 'expand-image', 'boost-image-resolution']) {
    assert.match(main, new RegExp(`id: '${action}'`), `the action finder should expose ${action}`);
  }
  assert.match(main, /openImageAiControls\(selectedImage\.id, '\[data-action="toggle-image-background-removal"\]'\)/);
  assert.match(main, /function syncLayerSelectionModeControl\(\)[\s\S]*?state\.layerSelectionMode \? 'Done' : 'Select multiple'/);
  assert.match(main, /Apply the same saved edits to every selected image\./);
  assert.match(main, /'multi select', 'multiple images', 'choose images'/);
  assert.match(main, /const exportingImageArchive = exportRoots\.length > 1 && exportRoots\.every\(node => node\.type === 'image'\)/);
  assert.match(main, /label: exportingImageArchive \? `Export \$\{exportRoots\.length\} images as ZIP` : 'Export selection as PNG'/);
  assert.match(styles, /\.quick-actions-dialog \{[^}]*max-height:/);
  assert.match(styles, /\.quick-action-option \{[^}]*min-height: 56px/);
  assert.match(readme, /Search actions…[\s\S]*?⌘K \/ Ctrl\+K[\s\S]*?To crop a photo layer: add and select an image/);
});

test('task help is directly reachable on touch and keeps the full instructions visible', () => {
  assert.match(html, /<button class="canvas-action-button" id="help-actions-button"[^>]*aria-label="Help and find an action"[^>]*>\? Help<\/button>/,
    'the canvas should label the help entry visibly without requiring hover or a keyboard shortcut');
  assert.match(main, /\$\('#help-actions-button'\)\.addEventListener\('click', \(\) => openQuickActions\(\)\)/,
    'the help button should open the searchable task actions');
  assert.match(styles, /\.quick-action-option-title\s*\{[^}]*overflow-wrap:\s*anywhere/,
    'long action names should wrap instead of hiding their defining words');
  assert.match(styles, /\.quick-action-option-description\s*\{[^}]*overflow-wrap:\s*anywhere/,
    'task instructions should remain readable on narrow screens');
  const descriptionRule = styles.match(/\.quick-action-option-description\s*\{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(descriptionRule, /(?:overflow:\s*hidden|white-space:\s*nowrap|text-overflow:\s*ellipsis)/,
    'action instructions should not be cut off at the end of one line');
  assert.match(html, /id="quick-actions-suggestions"[^>]*aria-label="Suggested tasks"[\s\S]*?Crop an image[\s\S]*?Remove background[\s\S]*?Add text[\s\S]*?Create a component[\s\S]*?Apply an image recipe[\s\S]*?Export PDF/,
    'the help screen should show concrete starter tasks before the user knows what to search for');
  assert.match(main, /const normalizedQuery = normalizeActionSearchText\(query\)[\s\S]*?suggestions\.hidden = Boolean\(normalizedQuery\)[\s\S]*?const actions = normalizedQuery \? searchActions\(quickActionCatalog\(\), query, \{ limit: 20 \}\) : \[\]/,
    'the initial help screen should stay focused on suggestions until a task is searched');
  assert.match(main, /empty\.hidden = !normalizedQuery \|\| actions\.length > 0/,
    'an empty initial query should not be presented as a failed search');
  assert.match(main, /import \{ normalizeActionSearchText, searchActions \} from '\.\/action-search\.js'/,
    'suggestion visibility should use the shared query normalization function');
  assert.match(main, /\$\('#quick-actions-suggestions'\)\.addEventListener\('click'[\s\S]*?input\.value = suggestion\.dataset\.quickActionQuery[\s\S]*?renderQuickActionResults\(input\.value\)/,
    'a starter task should fill the search without running it unexpectedly');
  assert.match(styles, /\.quick-action-suggestion\s*\{[^}]*min-height:\s*44px/,
    'starter tasks should have touch-sized targets on small screens');
  assert.match(html, /class="bottom-toolbar bottom-toolbar-shell"[^>]*role="group"[^>]*aria-label="Design tools"/);
  assert.match(html, /id="bottom-toolbar"[^>]*role="toolbar"[^>]*aria-label="Canvas tools\. Use More tools to reveal the next set, swipe or scroll horizontally/,
    'the mobile tool region should announce its tap, swipe, and scroll ways to reach hidden tools');
  assert.match(html, /id="toolbar-more-tools"[^>]*aria-label="Show more design tools"[^>]*hidden>More tools ›<\/button>/,
    'the phone toolbar should expose a real, tappable control rather than a passive overflow hint');
  assert.match(main, /function installDesignToolOverflowControl\(\)[\s\S]*?toolbarOverflowState[\s\S]*?toolbarOverflowDestination[\s\S]*?toolbar\.scrollTo\(/,
    'the overflow button should reveal the next group of tools and return to the first group at the end');
  assert.match(html, /class="bottom-toolbar-viewport" id="bottom-toolbar"[\s\S]*?<\/div>\s*<button class="toolbar-more-tools"/,
    'the overflow button should sit beside the scroll viewport so it cannot cover tool buttons');
  assert.match(styles, /\.bottom-toolbar-viewport\s*\{[^}]*overflow-x:\s*auto/,
    'only the tool viewport should scroll horizontally');
  assert.match(styles, /\.bottom-toolbar \.toolbar-more-tools:not\(\[hidden\]\)\s*\{[^}]*min-height:\s*44px/,
    'the visible phone overflow control should meet the touch target minimum');
});

test('empty canvas prioritizes direct start and crop actions while Properties explains page sizing', () => {
  assert.match(html, /<section class="empty-canvas-guide" id="empty-canvas-guide"[^>]*hidden>/);
  for (const action of ['add-image', 'create-frame', 'add-text']) {
    assert.match(html, new RegExp(`data-empty-canvas-action="${action}"`), `empty canvas should offer ${action}`);
  }
  assert.match(html, /Add a photo, draw a frame, or add text to start a design\.[\s\S]*?Crop a photo[\s\S]*?<li>Choose <strong>Add image<\/strong> and select a photo file\.<\/li>[\s\S]*?<li>Click or tap the photo, then choose <strong>Crop image<\/strong>\.<\/li>[\s\S]*?<li>Drag over what you want to keep, then choose <strong>Finish crop<\/strong>\.<\/li>/);
  const startGuide = html.match(/<section class="empty-canvas-guide"[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(startGuide, /PDF|fixed-size sheet/,
    'page-size concepts should not distract from starting and cropping on the empty canvas');
  assert.match(html, /class="empty-canvas-crop-help"[\s\S]*?<h3 id="empty-canvas-crop-title">Crop a photo<\/h3>[\s\S]*?<ol>[\s\S]*?<\/ol>/,
    'the crop route should stand out as a short, numbered sequence');
  assert.match(html, /data-action="create-frame">▧ Draw a frame/);
  assert.match(main, /data-action="create-frame">▧ Draw a frame/);
  assert.match(main, /id: 'create-frame', label: 'Draw a frame'[\s\S]*?keywords: \['create a frame', 'create frame'/,
    'the visible button and Help result should use the same action name while still understanding “create a frame” searches');
  assert.match(html, /id="layer-selection-hint"[^>]*hidden>Tap image layers in Layers or on the canvas to select them\./);
  assert.match(main, /function syncEmptyCanvasGuide\(\)[\s\S]*?Boolean\(page\.children\?\.length\)[\s\S]*?state\.emptyCanvasGuideDismissedPageId === page\.id/);
  assert.match(main, /\$\('#empty-canvas-guide'\)\.addEventListener\('click'[\s\S]*?setTool\('frame'\)[\s\S]*?setTool\('text'\)/);
  assert.match(main, /selectionHint\.hidden = !state\.layerSelectionMode/);
  assert.match(main, /Page is the workspace\. Use a frame to set the design width and height\. Export PDF sets the paper size\./);
  assert.match(html, /id="canvas-page-picker"[^>]*aria-label="Show pages"[^>]*title="Show pages and switch page"/);
  assert.match(main, /function openPagesList\(\)[\s\S]*?state\.sidebarTab = 'layers'[\s\S]*?toggleMobilePanel\('left'\)[\s\S]*?aria-current="page"/);
  assert.match(main, /\$\('#canvas-page-picker'\)\.addEventListener\('click', openPagesList\)/);
  assert.match(main, /id: 'show-pages', label: 'Show pages'[\s\S]*?keywords: \['switch page', 'change page'/);
  assert.match(main, /id: 'choose-workspace-folder'[\s\S]*?Choose a writable folder for local design files and live sharing[\s\S]*?run: chooseWorkspaceFolder/);
  assert.match(main, /id: 'create-frame', label: 'Draw a frame', description: 'Set a design’s width and height/);
  assert.match(html, /data-tool="select" data-tool-label="Select"[\s\S]*?aria-label="Select \/ Move"/);
  assert.match(styles, /\.empty-canvas-guide\s*\{[^}]*pointer-events:\s*none/);
  assert.match(styles, /\.empty-canvas-card\s*\{[^}]*pointer-events:\s*auto/);
  assert.match(styles, /#sidebar-toggle::after \{ content: 'Layers'; \}/);
  assert.match(styles, /#inspector-toggle::after \{ content: 'Properties'; \}/);
});

test('crop help distinguishes standalone photos from photos placed inside shapes', () => {
  assert.match(main, /id: 'crop-image-fill', label: 'Reposition photo inside shape'/);
  assert.match(main, /set Scale to Fill in Design properties, then choose Reposition photo/);
  assert.match(main, /Set Scale to Fill in Design properties first; this lets the photo extend past the shape edge/);
  assert.match(main, /applyInspectorAction\('toggle-image-crop-mode', \{ transformTarget: 'fill', fillId: selectedImageFill\.id \}\)/);
  assert.match(main, /This photo is inside a shape\. Use Reposition photo inside shape below\./);
  assert.match(main, /Visible source edges · %/);
  assert.match(main, /Visible crop \$\{edge\} edge, percent of source/);
  assert.match(styles, /\.canvas-scroll:has\(#image-crop-toolbar\[data-crop-mode="true"\]\) #scene-canvas\s*\{\s*cursor:\s*crosshair/);
  assert.match(readme, /To crop a photo inside a shape: select the shape and choose \*\*Reposition photo\*\* from its canvas action bar, or search \*\*Crop image inside shape\*\*/);
});

test('component help is reachable as a natural-language task and explains where to place copies', () => {
  assert.match(html, /data-quick-action-query="How do I create a component\?">Create a component/,
    'the first-use help screen should show reusable components as a concrete task');
  assert.match(main, /components\.append\(createAssetEmptyState\('components-empty', '◇', 'Select a layer, then choose Create component in Design properties or its layer menu\.'\)\)/,
    'the empty Components section should point to the actual creation controls');
  assert.deepEqual(searchActions(actions, 'make a reusable component').map(action => action.id), ['create-component']);
  assert.match(main, /componentCreationReason = batchReason \|\| \(!componentSource[\s\S]*?Slices are export regions and cannot become components\.[\s\S]*?This layer is already a main component\./,
    'the task should tell users why component creation is unavailable for their current selection');
});

test('PDF export is a visible peer to image export and opens the page-size controls', () => {
  assert.match(html, /<div class="inspector-footer" role="group" aria-label="Export artwork">[\s\S]*?id="export-selection"[\s\S]*?>Export image<\/button>[\s\S]*?id="export-page-pdf-button"[\s\S]*?>Export PDF<\/button>/,
    'users should not have to search Help to find PDF export beside image export');
  assert.match(main, /\$\('#export-page-pdf-button'\)\.addEventListener\('click', openPagePdfDialog\)/,
    'the visible PDF action should open the existing page export flow');
  assert.match(html, /id="page-pdf-size"[^>]*aria-label="PDF paper size"[\s\S]*?Custom size/,
    'the PDF flow should expose its existing paper-size choices');
  assert.match(readme, /choose \*\*Export PDF\*\* beside \*\*Export image\*\*[\s\S]*?paper size and orientation/i,
    'the user guide should match the new direct export route');
});
