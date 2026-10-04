import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, styles, readme] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
]);

test('multi-layer Inspector explains when Tidy up is available and labels the control', () => {
  const inspector = main.match(/const tidyControls = content\.querySelector\('\.multi-align-controls'\)[\s\S]*?if \(activeImageBatchSelected\)/)?.[0] || '';
  assert.match(inspector, /tidyButton\.textContent = 'Tidy up'/);
  assert.match(inspector, /aria-label', 'Tidy up selected layers'/);
  assert.match(inspector, /title = 'Arrange a clear row, column, or grid while keeping its common spacing'/);
  assert.match(inspector, /tidyButton\.disabled = !tidyUpAvailable/);
  assert.match(inspector, /tidyButton\.setAttribute\('aria-describedby', 'tidy-up-help'\)/);
  assert.match(inspector, /Select 3 or more layers in one row or column, or a rectangular grid\.[\s\S]*?share an unlocked parent outside Auto layout/);
  assert.match(main, /id: 'tidy-up-selection', label: 'Tidy up selected layers'[\s\S]*?keywords: \[[^\]]*'tidy up'[^\]]*'arrange grid'/,
    'the same action should be discoverable from Help search');
  assert.match(main, /if \(action === 'align-selection'\) alignSelectedLayers\(details\.alignMode\);\s*else if \(action === 'tidy-up-selection'\) tidyUpSelectedLayers\(\)/,
    'the visible button should run the matching operation');
});

test('Tidy up targets are large enough on a phone and README shows where to find the command', () => {
  assert.match(styles, /@media \(max-width: 820px\) \{[\s\S]*?\.multi-align-button\s*\{[^}]*min-height:\s*44px/,
    'alignment controls, including Tidy up, should meet the phone touch target size');
  assert.match(readme, /To arrange selected layers,[\s\S]*?select three or more siblings,[\s\S]*?Align & distribute[\s\S]*?Tidy up[\s\S]*?rectangular grid/,
    'the user guide should explain the action in terms of selection and its location');
});
