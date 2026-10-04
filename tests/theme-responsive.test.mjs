import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stylesheet = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const document = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const renderer = await readFile(new URL('../src/renderer.js', import.meta.url), 'utf8');

function ruleBlock(startIndex) {
  const open = stylesheet.indexOf('{', startIndex);
  assert.notEqual(open, -1, 'expected an opening CSS block');
  let depth = 0;
  for (let index = open; index < stylesheet.length; index += 1) {
    if (stylesheet[index] === '{') depth += 1;
    if (stylesheet[index] === '}') {
      depth -= 1;
      if (depth === 0) return stylesheet.slice(open + 1, index);
    }
  }
  assert.fail('expected the CSS block to close');
}

function mediaBlock(query, occurrence = 0) {
  let from = 0;
  let index = -1;
  for (let count = 0; count <= occurrence; count += 1) {
    index = stylesheet.indexOf(`@media ${query} {`, from);
    assert.notEqual(index, -1, `expected @media ${query}`);
    from = index + 1;
  }
  return ruleBlock(index);
}

function luminance(hexColor) {
  const channels = hexColor.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16) / 255);
  const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('appearance can be selected in the app menu and updates browser chrome', () => {
  assert.match(document, /<meta name="theme-color" content="#ffffff"\s*\/>/);
  assert.doesNotMatch(document, /name="theme-color"[^>]*media=/);
  assert.ok(document.indexOf('src="./src/theme-bootstrap.js"') < document.indexOf('href="./styles.css"'),
    'the initial preference should be applied before the theme stylesheet paints');
  assert.match(stylesheet, /:root\s*\{[^}]*color-scheme:\s*light/);
  const darkRoot = ruleBlock(stylesheet.indexOf(':root[data-theme="dark"] {'));
  assert.match(darkRoot, /color-scheme:\s*dark/);
  assert.match(darkRoot, /background:\s*#1b1d22/);
  assert.match(main, /\['system', 'System'\]/);
  assert.match(main, /\['light', 'Light'\]/);
  assert.match(main, /\['dark', 'Dark'\]/);
  assert.match(main, /role: 'menuitemradio', checked: themePreferences\.getPreference\(\) === value/);
  assert.match(main, /createThemePreferenceController/);
  assert.match(stylesheet, /\.context-menu button\[role="menuitemradio"\]\[aria-checked="true"\]::before/);
  assert.match(mediaBlock('(max-width: 820px)'), /\.context-menu button\s*\{[^}]*min-height:\s*44px/);
});

test('dark theme keeps mobile scroll affordance and selected layer controls on dark surfaces', () => {
  assert.match(stylesheet, /@media \(max-width: 820px\) \{[\s\S]*?:root\[data-theme="dark"\] \.bottom-toolbar \.toolbar-more-tools:not\(\[hidden\]\)\s*\{[^}]*background:\s*var\(--floating-panel-background\)/);
  assert.match(stylesheet, /:root\[data-theme="dark"\] \.left-panel,[\s\S]*?:root\[data-theme="dark"\] \.right-panel\s*\{[^}]*background:\s*var\(--panel\)/);
  assert.match(stylesheet, /:root\[data-theme="dark"\] \.layer-row\.is-selected \.layer-order-control:not\(:disabled\)[\s\S]*background:\s*#303b47/);
  assert.match(stylesheet, /:root\[data-theme="dark"\] \.stroke-field input,[\s\S]*?background-color:\s*#30333a/);
  assert.match(stylesheet, /:root\[data-theme="dark"\] \.export-setting-actions \.tiny-icon-button,[\s\S]*?background-color:\s*#30333a/);
  assert.match(stylesheet, /:root\[data-theme="dark"\] \.layout-guide-adds button:hover[\s\S]*background-color:\s*#373b44/);
});

test('image adjustment sliders have accessible names and locked layers reject edits', () => {
  const slider = main.match(/function sliderField\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(slider, /aria-label="\$\{escapeHtml\(label\)\}"/, 'the shared inspector range helper names each slider');
  assert.match(slider, /disabled \? ' disabled' : ''/, 'the shared inspector range helper can disable locked images');
  const imageSection = main.match(/function imageAdjustmentsSection\(node\) \{[\s\S]*?return section\('Image adjustments', body, null, 'image-adjustments'\);\n\}/)?.[0] || '';
  assert.match(imageSection, /sliderField\('Exposure',[\s\S]*?node\.locked\)/);
  assert.match(imageSection, /sliderField\('Temperature',[\s\S]*?node\.locked\)/);
  assert.match(imageSection, /sliderField\('Tint',[\s\S]*?node\.locked\)/);
  const handler = main.match(/function updateInspectorInput\(event\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(handler, /prop\.startsWith\('adjustments\.'\) && selected\.some\(node => node\.type === 'image' && node\.locked\)/,
    'the delegated property handler also blocks scripted edits to locked images');
});

test('dark theme gives individually colored editor labels readable foregrounds', () => {
  for (const selector of [
    '.comment-message p', '.component-card-name', '.variable-binding-row',
    '.property-field label', '.typography-style-copy small', '.asset-card-name',
  ]) {
    assert.ok(stylesheet.includes(`:root[data-theme="dark"] ${selector}`), `dark theme should cover ${selector}`);
  }
  assert.match(stylesheet, /:root\[data-theme="dark"\] \.comment-message p[\s\S]*color:\s*#a6acb6/);
  assert.match(stylesheet, /:root\[data-theme="dark"\] \.comment-row-copy strong[\s\S]*color:\s*#e0e4eb/);
});

test('canvas backing pixels follow the themed dark workspace instead of washing it out', () => {
  assert.match(renderer, /closest\?\.\('\.canvas-region'\)[\s\S]*?getComputedStyle\?\.\(region\)\?\.backgroundColor/,
    'the drawing surface must use the actual active canvas-region color, not its transparent scroll parent');
  assert.doesNotMatch(renderer, /ctx\.fillStyle = '#e9e9e9'/,
    'the obsolete light canvas fill made neutral shapes blend into the workspace');
  assert.match(stylesheet, /--canvas-base:\s*#262a32/);
  assert.match(stylesheet, /:root\[data-theme="dark"\][\s\S]*?--canvas-base:\s*#20232a/);
});

test('independent corner controls keep readable labels and phone-sized touch targets', () => {
  const labels = ruleBlock(stylesheet.indexOf('.corner-radius-controls .property-field label'));
  assert.match(labels, /width:\s*auto/);
  assert.match(labels, /white-space:\s*nowrap/);
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)');
  assert.match(coarsePhone, /\.corner-radius-controls \.property-field\s*\{[^}]*height:\s*44px[^}]*min-height:\s*44px/);
  assert.match(coarsePhone, /\.corner-radius-controls \.property-field input\s*\{[^}]*min-height:\s*42px[^}]*font-size:\s*16px/);
});

test('gradient geometry controls stay hidden until enabled and fit the mobile inspector', () => {
  assert.match(stylesheet, /\.gradient-geometry-fields\[hidden\]\s*\{\s*display:\s*none\s*;?\s*\}/,
    'the explicit display grid must not override the HTML hidden state');
  assert.match(stylesheet, /:root\[data-theme="dark"\] \.gradient-geometry-point input[\s\S]*background-color:\s*#30333a/,
    'gradient coordinates should use dark-theme input surfaces');
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)', 1);
  assert.match(coarsePhone, /\.inspector-content \.gradient-geometry-point input\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*16px/,
    'coordinate inputs should remain comfortable and avoid mobile auto-zoom');
  assert.match(main, /function gradientGeometryHandleAt\(event\)[\s\S]*?event\.pointerType === 'touch' \? 24 : 12/,
    'canvas gradient handles should have enlarged touch hit areas');
});

test('coarse-pointer inspector actions retain their 44px target size', () => {
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)');
  assert.match(coarsePhone, /\.property-section :where\(button:not\(\.tiny-icon-button\)\)\s*\{[^}]*min-height:\s*44px/,
    'all inspector buttons should meet the 44px target with a low-specificity rule');
  assert.match(coarsePhone, /\.property-section \.add-fill,\s*\.property-section \.primary-button,\s*\.property-section \.secondary-button\s*\{[^}]*min-height:\s*44px/,
    'primary, secondary, and add-fill actions must override the generic target size');
});

test('primary action colors meet text contrast in both themes', () => {
  const lightVariables = ruleBlock(stylesheet.indexOf(':root'));
  const darkVariables = ruleBlock(stylesheet.indexOf(':root[data-theme="dark"] {'));
  const readVariable = (source, name) => source.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  for (const [themeName, variables] of [['light', lightVariables], ['dark', darkVariables]]) {
    const primary = readVariable(variables, '--primary-action-bg') ?? readVariable(lightVariables, '--primary-action-bg');
    const hover = readVariable(variables, '--primary-action-hover') ?? readVariable(lightVariables, '--primary-action-hover');
    assert.ok(primary, `${themeName} theme should define a primary action surface`);
    assert.ok(hover, `${themeName} theme should define a primary hover surface`);
    assert.ok(contrast('#ffffff', primary) >= 4.5, `${themeName} primary action text should meet WCAG AA`);
    assert.ok(contrast('#ffffff', hover) >= 4.5, `${themeName} primary hover text should meet WCAG AA`);
  }
  assert.doesNotMatch(stylesheet, /\.primary-button:hover\s*\{[^}]*background:\s*#[0-9a-f]{6}/i,
    'later theme polish must not replace the accessible hover color with a bright override');
  assert.ok(contrast('#8bc7ff', '#25272e') >= 3, 'dark button outlines should remain distinct from panel surfaces');
});

test('reduced motion clears transition delays and scroll snapping as well as animation time', () => {
  const reducedMotion = mediaBlock('(prefers-reduced-motion: reduce)');
  assert.match(reducedMotion, /transition-delay:\s*0s\s*!important/);
  assert.match(reducedMotion, /transition-duration:\s*\.01ms\s*!important/);
  assert.match(reducedMotion, /animation-duration:\s*\.01ms\s*!important/);
  assert.match(reducedMotion, /scroll-snap-type:\s*none\s*!important/);
});
