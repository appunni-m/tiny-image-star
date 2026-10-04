import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
]);
const stylesheet = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

function ruleBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `expected ${marker}`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `expected an opening brace for ${marker}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  assert.fail(`expected ${marker} block to close`);
}

test('recipe save dialog is named by its visible heading', () => {
  assert.match(html, /<dialog\b[^>]*id="recipe-dialog"[^>]*aria-labelledby="recipe-dialog-title"/);
  assert.match(html, /<h2\s+id="recipe-dialog-title">Save recipe<\/h2>/);
});

test('canvas selection and tool changes are announced without reading live coordinates', () => {
  assert.match(html, /id="selection-status" role="status" aria-live="polite" aria-atomic="true"/,
    'assistive technology should announce the selected layer or active tool');
  assert.match(html, /<span id="position-status">—<\/span>/,
    'high-frequency canvas position updates should stay outside the live region');
  assert.match(main, /function updateSelectionStatus\(\) \{[\s\S]*?\$\('#selection-status'\)\.textContent = state\.layerSelectionMode[\s\S]*?\$\('#position-status'\)\.textContent/,
    'selection and active tool changes should update the announcement while coordinates remain a separate field');
});

test('canvas tool buttons expose the active tool at startup and when it changes', () => {
  const toolbar = html.match(/<div class="bottom-toolbar" id="bottom-toolbar"[\s\S]*?<\/div>/)?.[0] || '';
  const toolButtons = [...toolbar.matchAll(/<button\b[^>]*>/g)].map(([tag]) => ({
    tag,
    className: tag.match(/\bclass="([^"]*)"/)?.[1] || '',
    tool: tag.match(/\bdata-tool="([^"]+)"/)?.[1] || '',
    pressed: tag.match(/\baria-pressed="(true|false)"/)?.[1],
    tabIndex: tag.match(/\btabindex="(-?\d+)"/)?.[1],
  }));
  assert.ok(toolButtons.length >= 15, 'the toolbar should expose its canvas tools');
  assert.match(toolbar, /role="toolbar"\s+aria-orientation="horizontal"/);
  for (const button of toolButtons) {
    assert.ok(button.tool, 'each toolbar button should identify its tool');
    assert.notEqual(button.pressed, undefined, `${button.tool} should have an initial pressed state`);
    assert.notEqual(button.tabIndex, undefined, `${button.tool} should have a roving tab stop state`);
    assert.equal(button.pressed, String(button.className.split(/\s+/).includes('is-selected')),
      `${button.tool} should expose the same initial selection that the UI shows`);
  }
  assert.equal(toolButtons.filter(button => button.pressed === 'true').length, 1,
    'exactly one canvas tool should be active at startup');
  assert.equal(toolButtons.filter(button => button.tabIndex === '0').length, 1,
    'Tab should enter the toolbar at one tool instead of stopping on every tool');
  assert.equal(toolButtons.find(button => button.pressed === 'true').tabIndex, '0',
    'the selected tool should be the toolbar entry point at startup');

  const setTool = main.match(/function setTool\(tool\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(setTool, /button\.setAttribute\('aria-pressed', String\(selected\)\)/,
    'choosing another canvas tool should update its accessible pressed state');
  assert.match(setTool, /const selected = button\.dataset\.tool === tool/,
    'the selected state should follow the active canvas tool');
  assert.match(setTool, /setDesignToolTabStop\(button\)/,
    'shortcut or pointer selection should keep one useful toolbar tab stop');

  const keyboard = main.match(/function installDesignToolToolbarKeyboard\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(keyboard, /toolbarNavigationTarget/);
  assert.match(keyboard, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(keyboard, /target\.scrollIntoView\?\.\(\{ block: 'nearest', inline: 'nearest' \}\)/,
    'keyboard navigation should reveal offscreen tools in the horizontally scrollable phone toolbar');
});

test('compact phones keep live Share reachable and preserve local-file actions in File', () => {
  const openMenu = main.match(/function openFileMenu\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(openMenu, /label: 'Send design file…', action: shareDesignFile/);
  assert.match(openMenu, /label: 'Save local copy…'.*action: exportDesign/u);
  assert.match(html, /id="share-button"[^>]*title="Invite someone to edit this design live">Share<\/button>/,
    'the top-bar Share button should describe live collaboration');
  assert.match(main, /#share-button'\)\.addEventListener\('click', \(\) => dispatchWorkspaceCollaborationIntent\('tiny-image-star:share-live'\)\)/,
    'the direct Share action should open the live invitation flow');
  const directShareRules = [...stylesheet.matchAll(/#share-button\s*\{([^}]*)\}/g)].map(([, declarations]) => declarations);
  assert.ok(directShareRules.some(declarations => /\bdisplay\s*:\s*flex\b/u.test(declarations)),
    'a phone-specific rule must keep the direct Share button visible');
  assert.ok(directShareRules.every(declarations => !/\bdisplay\s*:\s*none\b/u.test(declarations)),
    'later phone rules must not hide the direct Share button');
  const hierarchyStart = stylesheet.indexOf('/* Phone workspace hierarchy:');
  assert.notEqual(hierarchyStart, -1, 'expected the compact phone header layout');
  const phoneRules = ruleBlock(stylesheet.slice(hierarchyStart), '@media (max-width: 820px) {');
  assert.match(phoneRules, /\.topbar #share-button\s*\{[^}]*display:\s*flex[^}]*min-width:\s*48px[^}]*min-height:\s*40px/,
    'the direct Share control should keep a finger-sized target in the compact header');
  assert.match(main, /#main-menu-button'\)\.addEventListener\('click', event => openFileMenu\(/,
    'the phone main-menu control must open the menu containing the share action');
});

test('bulk controls keep interactions outside the live region and announce milestones only', () => {
  const bulkBar = html.match(/<div class="bulk-bar" id="bulk-bar"[\s\S]*?<\/div>\s*<dialog class="modal recipe-recovery-dialog"/)?.[0] || '';
  assert.match(bulkBar, /id="bulk-bar" role="region"[^>]*tabindex="-1" hidden>/);
  assert.doesNotMatch(bulkBar.match(/<div class="bulk-bar"[^>]*>/)?.[0] || '', /aria-live=/,
    'the interactive region must not make its slider and buttons a continuously changing live region');
  assert.match(bulkBar, /id="bulk-announcer" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(main, /const announcement = imageRecipeBatchAnnouncement\(bulk\)[\s\S]*?if \(announcer\.textContent !== announcement\) announcer\.textContent = announcement/,
    'unchanged milestone text should not be rewritten during frequent progress renders');
});

test('presentation controls meet the 44px coarse-pointer target without toolbar clipping', () => {
  const coarseQuery = '@media (max-width: 820px) and (pointer: coarse) {';
  const coarseStart = stylesheet.lastIndexOf(coarseQuery);
  assert.notEqual(coarseStart, -1, 'expected the final coarse-pointer phone overrides');
  const coarsePointerRules = ruleBlock(stylesheet.slice(coarseStart), coarseQuery);
  assert.match(coarsePointerRules, /\.presentation-control\s*\{[^}]*width:\s*44px[^}]*min-width:\s*44px[^}]*height:\s*44px[^}]*min-height:\s*44px[^}]*flex-basis:\s*44px/);
  assert.match(coarsePointerRules, /\.presentation-toolbar\s*\{[^}]*height:\s*60px/);
});
