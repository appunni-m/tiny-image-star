import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stylesheet = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const document = await readFile(new URL('../index.html', import.meta.url), 'utf8');

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

test('theme metadata and CSS advertise matching light and dark browser chrome', () => {
  assert.match(document, /<meta name="theme-color" content="#ffffff" media="\(prefers-color-scheme: light\)"\s*\/>/);
  assert.match(document, /<meta name="theme-color" content="#1b1d22" media="\(prefers-color-scheme: dark\)"\s*\/>/);
  assert.match(stylesheet, /:root\s*\{[^}]*color-scheme:\s*light dark/);
  assert.match(mediaBlock('(prefers-color-scheme: dark)'), /color-scheme:\s*dark/);
  assert.match(mediaBlock('(prefers-color-scheme: dark)'), /background:\s*#1b1d22/);
});

test('dark theme keeps mobile scroll affordance and selected layer controls on dark surfaces', () => {
  const darkMobile = mediaBlock('(prefers-color-scheme: dark) and (max-width: 820px)');
  assert.match(darkMobile, /\.bottom-toolbar::after\s*\{[^}]*linear-gradient\([^}]*rgba\(39,42,49/);
  assert.match(darkMobile, /\.left-panel, \.right-panel\s*\{[^}]*background:\s*var\(--panel\)/);
  assert.match(darkMobile, /\.layer-row\.is-selected \.layer-order-control:not\(:disabled\)[\s\S]*background:\s*#303b47/);
});

test('dark theme gives individually colored editor labels readable foregrounds', () => {
  const darkLabels = mediaBlock('(prefers-color-scheme: dark)', 1);
  for (const selector of [
    '.comment-message p', '.component-card-name', '.variable-binding-row',
    '.property-field label', '.typography-style-copy small', '.asset-card-name',
  ]) {
    assert.ok(darkLabels.includes(selector), `dark theme should cover ${selector}`);
  }
  assert.match(darkLabels, /color:\s*#a6acb6/);
  assert.match(darkLabels, /color:\s*#e0e4eb/);
});

test('independent corner controls keep readable labels and phone-sized touch targets', () => {
  const labels = ruleBlock(stylesheet.indexOf('.corner-radius-controls .property-field label'));
  assert.match(labels, /width:\s*auto/);
  assert.match(labels, /white-space:\s*nowrap/);
  const coarsePhone = mediaBlock('(max-width: 820px) and (pointer: coarse)');
  assert.match(coarsePhone, /\.corner-radius-controls \.property-field\s*\{[^}]*height:\s*44px[^}]*min-height:\s*44px/);
  assert.match(coarsePhone, /\.corner-radius-controls \.property-field input\s*\{[^}]*min-height:\s*42px[^}]*font-size:\s*16px/);
});

test('primary action colors meet text contrast in both themes', () => {
  const lightVariables = ruleBlock(stylesheet.indexOf(':root'));
  const darkVariables = mediaBlock('(prefers-color-scheme: dark)').match(/:root\s*\{([^}]*)\}/)?.[1];
  assert.ok(darkVariables, 'dark theme should declare its browser and action colors');
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
