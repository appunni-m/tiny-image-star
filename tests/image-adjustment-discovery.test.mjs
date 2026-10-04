import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('image controls are grouped by the task users want to do', () => {
  const section = main.match(/function imageAdjustmentsSection\(node\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(section, 'expected the image adjustment inspector section');
  assert.match(section, /'Crop & transform', 'Choose what shows · rotate · flip', imageTransformControls/);
  assert.match(section, /'Light & color', 'Exposure · brightness · contrast · color'/);
  assert.match(section, /'Detail & effects', 'Sharpness · blur · stylized effects'/);
  assert.match(section, /sliderField\('Exposure'/);
  assert.match(section, /sliderField\('Brightness'/);
  assert.match(section, /sliderField\('Contrast'/);
  assert.match(section, /sliderField\('Sharpness'/);
  assert.match(section, /sliderField\('Blur'/);
  assert.match(section, /imageToneControls\(adjustments/);
  assert.match(section, /image never leaves this device/);
});

test('the crop and common color groups start open; advanced effects start collapsed', () => {
  const section = main.match(/function imageAdjustmentsSection\(node\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(section, /'Crop & transform'[\s\S]*?imageTransformControls\([\s\S]*?, true\)/);
  assert.match(section, /'Light & color'[\s\S]*?\]\.join\(''\), true\)/);
  assert.match(section, /'Detail & effects'[\s\S]*?\]\.join\(''\)\);/);
  assert.match(main, /imageAdjustmentDisclosureByNodeId: new Map\(\)/);
  assert.match(main, /data-image-adjustment-group=\"\$\{key\}\" data-image-adjustment-node-id/);
  assert.match(main, /state\.imageAdjustmentDisclosureByNodeId\.set\(adjustmentDisclosure\.dataset\.imageAdjustmentNodeId/,
    'disclosure choices should survive inspector rerenders while the user edits');
});

test('adjustment disclosures retain visible summaries and phone-sized targets', () => {
  assert.match(css, /\.image-adjustment-group > summary\s*\{[^}]*min-height:\s*42px/);
  assert.match(css, /\.image-adjustment-group > summary:focus-visible/);
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.image-adjustment-group > summary\s*\{[^}]*min-height:\s*48px/);
  assert.match(css, /\.image-adjustment-group > summary > small\s*\{[^}]*color:\s*var\(--muted\)/);
});
