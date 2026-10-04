import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stylesheet = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

function enclosingRuleBlock(startIndex) {
  const open = stylesheet.indexOf('{', startIndex);
  assert.notEqual(open, -1, 'expected an opening CSS block');
  let depth = 0;
  for (let index = open; index < stylesheet.length; index += 1) {
    if (stylesheet[index] === '{') depth += 1;
    if (stylesheet[index] === '}') {
      depth -= 1;
      if (depth === 0) return { content: stylesheet.slice(open + 1, index), open, close: index };
    }
  }
  assert.fail('expected the CSS block to close');
}

function mediaBlock(query, occurrence = 0) {
  const marker = `@media ${query} {`;
  let from = 0;
  let index = -1;
  for (let count = 0; count <= occurrence; count += 1) {
    index = stylesheet.indexOf(marker, from);
    assert.notEqual(index, -1, `expected @media ${query}`);
    from = index + marker.length;
  }
  return enclosingRuleBlock(index).content;
}

test('local component publish and place actions have phone-sized touch targets and a scrollable list', () => {
  const ruleIndex = stylesheet.indexOf('.local-library-publish, .local-library-component { min-height: 44px;');
  assert.notEqual(ruleIndex, -1, 'component actions should keep a 44px minimum height on phones');
  const mobileStart = stylesheet.lastIndexOf('@media (max-width: 820px)', ruleIndex);
  assert.notEqual(mobileStart, -1, 'phone target sizes should be inside the mobile layout rules');
  const mobileBlock = enclosingRuleBlock(mobileStart);
  assert.ok(ruleIndex > mobileBlock.open && ruleIndex < mobileBlock.close, 'touch target override belongs to the mobile media block');
  assert.match(mobileBlock.content, /\.component-library-list\s*\{[^}]*max-height:\s*min\(35dvh, 280px\)/);
  assert.match(stylesheet.match(/\.component-library-list\s*\{([^}]*)\}/)?.[1] || '', /overflow:\s*auto/);
});

test('reusable image cards stay compact while keeping 44px phone actions and a narrow-screen fallback', () => {
  assert.match(stylesheet, /\.image-library-card\s*\{[^}]*grid-template-columns:\s*42px\s+minmax\(0,\s*1fr\)\s+auto/,
    'desktop image cards should keep the thumbnail, filename and actions on one compact row');
  assert.match(stylesheet, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.image-library-card\s*\{\s*grid-template-columns:\s*56px\s+minmax\(0,\s*1fr\)\s+auto;[\s\S]*?\.image-library-actions button\s*\{\s*width:\s*44px;\s*min-width:\s*44px;\s*min-height:\s*44px/,
    'phone image actions should remain finger-sized');
  assert.match(stylesheet, /@media \(max-width: 380px\)\s*\{[\s\S]*?\.image-library-card\s*\{\s*grid-template-columns:\s*44px\s+minmax\(0,\s*1fr\)/);
  assert.match(stylesheet, /@media \(max-width: 380px\)\s*\{[\s\S]*?\.image-library-actions\s*\{\s*grid-column:\s*1 \/ -1/,
    'the action pair should wrap below the image metadata on the narrowest phones');
});

test('coarse-pointer phone navigation and canvas menus have 44px touch targets', () => {
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)', 1);
  assert.match(coarsePhone, /\.mobile-panel-toggle, \.present-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/);
  assert.match(coarsePhone, /\.present-button\s*\{[^}]*width:\s*44px/);
  assert.match(coarsePhone, /#share-button\s*\{[^}]*min-height:\s*44px/);
  assert.match(coarsePhone, /\.canvas-top-actions \.canvas-action-button\s*\{[^}]*width:\s*44px[^}]*min-width:\s*44px[^}]*height:\s*44px[^}]*min-height:\s*44px/);
  assert.match(coarsePhone, /\.page-row-menu\s*\{[^}]*flex-basis:\s*44px/);
  assert.match(coarsePhone, /\.page-row-menu > summary\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
  assert.match(coarsePhone, /\.section-heading > \.tiny-icon-button/);
});

test('the layer reorder drag handle has a full 44px touch target on coarse-pointer phones', () => {
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)', 0);
  assert.match(coarsePhone, /\.layer-reorder-handle\s*\{[^}]*width:\s*44px[^}]*min-width:\s*44px[^}]*height:\s*44px[^}]*flex-basis:\s*44px[^}]*touch-action:\s*none/,
    'the drag-only layer reorder handle should be easy to acquire without yielding the gesture to page scrolling');
});

test('coarse-pointer inspector and repeated edit actions meet the 44px target', () => {
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)', 1);
  for (const selector of [
    '.layer-select-mode', '.component-slot-value .secondary-button', '.component-slot-reset',
    '.local-font-remove', '.variable-mode-add', '.variable-apply', '.variable-remove',
    '.typography-style-actions button', '.comment-new-button', '.comment-thread-actions .secondary-button',
    '.inspect-copy', '.export-setting-actions .secondary-button', '.layout-guide-adds button',
    '.design-file-actions button', '.speed-control input'
  ]) {
    assert.ok(coarsePhone.includes(selector), `coarse-phone rules should enlarge ${selector}`);
  }
  assert.match(coarsePhone, /\.stroke-field input, \.stroke-field select,[\s\S]*?\.layout-guide-field select\s*\{[^}]*min-height:\s*44px[^}]*height:\s*44px/);
  assert.match(coarsePhone, /\.gradient-stop-row input\[type="color"\], \.gradient-stop-row input\[type="number"\]\s*\{[^}]*min-height:\s*44px[^}]*height:\s*44px/);
});

test('slice padding has a 44px touch target on narrow phone layouts', () => {
  const mobilePhone = mediaBlock('(max-width: 820px)', 0);
  assert.match(mobilePhone, /\.export-suffix input\[data-export-field="padding"\]\s*\{[^}]*min-height:\s*44px[^}]*height:\s*44px/);
});

test('common inspector geometry, fill, opacity, effect, and range controls are finger-friendly', () => {
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)', 1);
  assert.match(coarsePhone, /\.inspector-content \.property-field\s*\{[^}]*height:\s*44px[^}]*min-height:\s*44px/);
  assert.match(coarsePhone, /\.inspector-content \.property-field input\s*\{[^}]*min-height:\s*44px[^}]*height:\s*44px[^}]*font-size:\s*16px/);
  assert.match(coarsePhone, /\.inspector-content :where\(input:not\(\[type="checkbox"\]\)[\s\S]*?min-height:\s*44px[\s\S]*?font-size:\s*16px/);
  assert.match(coarsePhone, /\.inspector-content input\[type="range"\]\s*\{[^}]*min-height:\s*44px[^}]*padding-block:\s*8px/);
  assert.match(coarsePhone, /\.inspector-content input\[type="color"\]\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px[^}]*height:\s*44px/);
  assert.match(coarsePhone, /\.inspector-content \.fill-row \.color-swatch\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*flex:\s*0 0 44px/);
  assert.match(coarsePhone, /\.inspector-content \.color-value, \.inspector-content \.fill-opacity\s*\{[^}]*height:\s*44px[^}]*min-height:\s*44px/);
  assert.match(coarsePhone, /\.inspector-content \.layer-effect-heading label\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/);
  assert.match(coarsePhone, /\.inspector-content \.gradient-stop-row \.tiny-icon-button,[\s\S]*?width:\s*44px[\s\S]*?min-height:\s*44px/);
});

test('mobile inspector tabs size to their labels without losing touch targets', () => {
  const marker = '/* The landscape inspector is a narrow side drawer';
  const start = stylesheet.indexOf(marker);
  assert.notEqual(start, -1, 'expected the responsive inspector-tab rules');
  const mobileTabs = stylesheet.slice(start, stylesheet.indexOf('/* Respect cutouts', start));
  assert.match(mobileTabs, /@media \(max-width: 820px\)\s*\{\s*\.inspector-tabs\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/,
    'phone tabs should use their natural label widths instead of five equal clipped columns');
  assert.match(mobileTabs, /\.inspector-tab\s*\{[^}]*width:\s*auto[^}]*min-width:\s*44px[^}]*flex:\s*0 1 auto/,
    'flexible label widths must retain finger-sized tab targets');
});

test('narrow mobile inspector sliders have finger-sized hit areas even without coarse-pointer emulation', () => {
  const mobileViewport = mediaBlock('(max-width: 820px)', 3);
  assert.match(mobileViewport, /.inspector-content input\[type="range"\]\s*\{[^}]*min-height:\s*44px[^}]*padding-block:\s*8px/);
});

test('grid track controls expose sizing and weighted fill with phone-sized controls', () => {
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)', 1);
  assert.match(mainSource, /function gridTrackEditor\(node, axis, count, tracks, fallbackMode, locked = node\.locked\)/);
  assert.match(mainSource, /\['fixed', 'Fixed'\], \['hug', 'Hug content'\], \['fill', 'Fill available'\]/);
  assert.match(mainSource, /data-prop="autoLayout\.\$\{axis\}\.\$\{index\}\.\$\{mode === 'fixed' \? 'value' : 'weight'\}"/);
  assert.match(stylesheet, /\.grid-track-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*\.6fr\)\s+minmax\(0,\s*1\.1fr\)\s+minmax\(0,\s*\.9fr\)\s+34px\s+34px/,
    'desktop grid-track columns must be allowed to shrink inside the fixed-width inspector');
  const mobile = mediaBlock('(max-width: 820px)', 0);
  assert.match(mobile, /\.grid-track-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*\.4fr\)\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*\.8fr\)\s+44px\s+44px/,
    'mobile grid-track columns must shrink while preserving 44px actions');
  assert.match(coarsePhone, /\.grid-track-row \.select-field, \.grid-track-value\s*\{[^}]*min-height:\s*44px[^}]*height:\s*44px/);
  assert.match(coarsePhone, /\.grid-track-delete, \.grid-track-move-menu-button\s*\{[^}]*width:\s*44px[^}]*min-width:\s*44px[^}]*height:\s*44px/,
    'grid track delete and reorder controls stay finger-sized on phones');
});

test('coarse-pointer checkbox settings expose a 44px row target and retain usable checkboxes', () => {
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)', 1);
  const coarseBase = mediaBlock('(max-width: 820px) and (pointer: coarse)', 0);
  assert.match(coarsePhone, /\.component-property-value\s*\{[^}]*min-height:\s*44px/);
  assert.match(coarsePhone, /\.prototype-controls label:has\(input\[type="checkbox"\]\)\s*\{[^}]*min-height:\s*44px/);
  assert.match(coarsePhone, /\.field-caption:has\(input\[type="checkbox"\]\),[\s\S]*?\.field-caption\[for="auto-layout-wrap"\]\s*\{[^}]*min-height:\s*44px[^}]*display:\s*flex[^}]*align-items:\s*center/);
  assert.match(coarsePhone, /\.field-caption:has\(input\[type="checkbox"\]\) input\[type="checkbox"\],[\s\S]*?#auto-layout-auto-positioning, #auto-layout-wrap\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/);
  assert.match(coarseBase, /\.property-section :where\(button:not\(\.tiny-icon-button\)\)\s*\{[^}]*min-height:\s*44px/);
});

test('prototype inspector controls stay reachable and fit narrow phone panels', () => {
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)', 1);
  assert.match(coarsePhone, /\.prototype-flow-controls \.select-field\s*\{[^}]*min-height:\s*44px/);
  assert.match(coarsePhone, /\.prototype-current-frame > span\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
  assert.match(coarsePhone, /\.prototype-current-frame \.secondary-button\s*\{[^}]*min-width:\s*0[^}]*min-height:\s*44px[^}]*height:\s*44px/);
  assert.match(coarsePhone, /\.prototype-controls #prototype-overlay-color\s*\{[^}]*min-height:\s*44px[^}]*height:\s*44px/);
  assert.match(stylesheet, /\.left-panel, \.right-panel\s*\{[^}]*width:\s*min\(360px,\s*92vw\)/);
});

test('keyboard focus remains visible across buttons and form controls in both themes', () => {
  assert.match(stylesheet, /button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\);\s*outline-offset:\s*2px;/);
  assert.match(stylesheet, /:root\s*\{[^}]*--focus-ring:\s*#005fcc/);
  assert.match(stylesheet, /:root\[data-theme="dark"\]\s*\{[^}]*--focus-ring:\s*#8bc7ff/);
  assert.match(stylesheet, /\.document-name:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)/);
});

test('very narrow coarse-pointer phones do not shrink layer actions below 44px', () => {
  const narrowCoarse = mediaBlock('(max-width: 360px) and (pointer: coarse)');
  assert.match(narrowCoarse, /\.layer-row \.layer-order-control, \.layer-row \.layer-visibility, \.layer-row \.layer-actions-menu\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*flex:\s*0 0 44px/);
});

test('mobile layer visibility controls keep a 40px target and expand to 44px on touch devices', () => {
  const mobile = mediaBlock('(max-width: 820px)');
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)', 0);
  assert.match(mobile, /\.layer-order-control\s*\{[^}]*width:\s*40px[^}]*height:\s*40px[^}]*flex-basis:\s*40px/,
    'phone row-order actions must remain touch-sized even when the browser reports a fine pointer');
  assert.match(coarsePhone, /\.layer-row \.layer-order-control, \.layer-row \.layer-visibility\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*flex:\s*0 0 44px/,
    'coarse-pointer layer actions should meet the 44px touch target');
  assert.match(mobile, /\.layer-visibility\s*\{[^}]*width:\s*40px[^}]*height:\s*40px[^}]*flex-basis:\s*40px/);
  assert.match(coarsePhone, /\.layer-row \.layer-visibility\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*flex:\s*0 0 44px/);

  const selectedRowRequiredAt390 = 18 + 36 + 18 + 32 + 4 * 40 + 7 * 3 + 5;
  const panelContentAt390 = Math.min(360, 390 * 0.92) - 16;
  assert.ok(selectedRowRequiredAt390 <= panelContentAt390,
    'four visible layer actions, drag handle, and capped indentation fit inside the 390px phone panel');
});

test('short mobile viewports use a full-height side inspector and keep the canvas scrim below the top bar', () => {
  const shortMobile = mediaBlock('(max-width: 820px) and (max-height: 560px)');
  assert.match(shortMobile, /\.right-panel\s*\{[^}]*top:\s*0[^}]*right:\s*0[^}]*bottom:\s*0[^}]*left:\s*auto/);
  assert.match(shortMobile, /\.right-panel\s*\{[^}]*width:\s*min\(400px,\s*max\(280px,\s*54vw\)\)[^}]*max-width:\s*100%[^}]*height:\s*auto[^}]*max-height:\s*none/,
    'the preferred landscape drawer width should clamp to the workspace on extra-narrow phones');
  assert.match(shortMobile, /\.right-panel\.is-open\s*\{[^}]*transform:\s*translateX\(0\)/);
  assert.match(shortMobile, /\.app-shell\.mobile-inspector-open\s*>\s*\.mobile-scrim\.is-visible\s*\{[^}]*top:\s*calc\(45px\s*\+\s*env\(safe-area-inset-top\)\)[^}]*bottom:\s*0/);
  assert.match(shortMobile, /:root\[data-theme="dark"\][\s\S]*?\.mobile-scrim\.is-visible\s*\{[^}]*background:\s*rgba\(0,\s*0,\s*0,\s*\.42\)/);
  assert.match(stylesheet, /\.right-panel\s*\{[^}]*height:\s*min\(50dvh,\s*500px\)/,
    'taller mobile viewports should retain the portrait bottom-sheet layout');
  const mobile = mediaBlock('(max-width: 820px)', 0);
  assert.match(mobile, /\.workspace\s*\{[^}]*min-width:\s*0[^}]*width:\s*100%/,
    'mobile inspector positioning must use the viewport-bounded workspace');
  assert.match(stylesheet, /\.app-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    'the app shell must constrain its implicit grid column to the viewport');
});

test('phone floating controls clear device cutouts and tools show visible labels', () => {
  const start = stylesheet.lastIndexOf('/* Respect cutouts and home indicators');
  assert.notEqual(start, -1);
  const block = enclosingRuleBlock(start);
  const phoneRules = block.content;
  assert.match(phoneRules, /\.bottom-toolbar,\s*\.bulk-bar\s*\{[^}]*left:\s*calc\(50% \+ \(env\(safe-area-inset-left\) - env\(safe-area-inset-right\)\) \/ 2\)/);
  assert.match(phoneRules, /\.bottom-toolbar\s*\{[^}]*max-width:\s*calc\(100vw - max\(8px, env\(safe-area-inset-left\) \+ 8px\) - max\(8px, env\(safe-area-inset-right\) \+ 8px\)\)/);
  assert.match(phoneRules, /\.bulk-bar\s*\{[^}]*width:\s*calc\(100vw - max\(8px, env\(safe-area-inset-left\) \+ 8px\) - max\(8px, env\(safe-area-inset-right\) \+ 8px\)\)[^}]*bottom:\s*calc\(76px \+ max\(env\(safe-area-inset-bottom\), 8px\)\)/);
  assert.match(phoneRules, /\.zoom-controls\s*\{[^}]*right:\s*max\(10px, env\(safe-area-inset-right\)\)/);
  assert.match(phoneRules, /\.modal\s*\{[^}]*max-height:\s*calc\(100dvh - max\(16px, env\(safe-area-inset-top\)\) - max\(16px, env\(safe-area-inset-bottom\)\)\)/);
  assert.match(phoneRules, /\.mobile-panel-toggle,[\s\S]*?\.canvas-top-actions \.canvas-action-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/);
  assert.match(phoneRules, /\.bottom-toolbar \.tool-button\s*\{[^}]*width:\s*60px[^}]*min-width:\s*60px[^}]*height:\s*48px[^}]*flex-direction:\s*column/);
  assert.match(phoneRules, /\.bottom-toolbar \.tool-button::after\s*\{[^}]*content:\s*attr\(data-tool-label\)/);
  const landscapeStart = stylesheet.lastIndexOf('@media (max-width: 820px) and (max-height: 520px)');
  assert.ok(landscapeStart > start, 'landscape bulk-bar clearance must override the portrait offset');
  assert.match(enclosingRuleBlock(landscapeStart).content, /\.bulk-bar\s*\{[^}]*bottom:\s*calc\(66px \+ max\(env\(safe-area-inset-bottom\), 8px\)\)/);
});

test('the mobile main menu keeps a full-width 44px hit target on narrow phones', () => {
  const marker = '@media (max-width: 820px) {';
  const mobileStart = stylesheet.lastIndexOf(marker);
  assert.notEqual(mobileStart, -1, 'expected final mobile safe-area and touch-target rules');
  const mobile = enclosingRuleBlock(mobileStart).content;
  assert.match(mobile, /\.topbar #main-menu-button\s*\{[^}]*width:\s*44px[^}]*min-width:\s*44px[^}]*min-height:\s*44px[^}]*flex:\s*0 0 44px/,
    'the main menu must remain easy to open even when the brand mark is compacted for a narrow viewport');
});

test('phone asset import and export actions meet the 44px touch target', () => {
  const mobileAssetRule = stylesheet.match(/@media \(max-width: 820px\)\s*\{[\s\S]*?\.assets-section\s*\{[^}]*scrollbar-gutter:\s*auto;[^}]*\}[\s\S]*?\.assets-section \.asset-section-action\s*\{([^}]*)\}/);
  assert.ok(mobileAssetRule, 'expected the phone Assets panel action rule');
  assert.match(mobileAssetRule[1], /min-height:\s*44px/,
    'Import and Export should remain full-sized targets on a touch screen');
});
