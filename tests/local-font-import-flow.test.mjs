import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [editor, browserWorkflow] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('./local-fonts-smoke.mjs', import.meta.url), 'utf8')
]);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(startAt, -1, `Missing source section ${start}`);
  assert.notEqual(endAt, -1, `Missing source section boundary ${end}`);
  return source.slice(startAt, endAt);
}

test('installing a local WOFF2 closes the dialog before slow axis inspection and safely upgrades later', () => {
  const install = section(editor, 'async function savePendingLocalFont()', 'async function inspectInstalledFontAxes(');
  assert.match(install, /loadLocalFontFace\(candidate, \{ register: false, variationAxes: \[\] \}\)/,
    'initial face loading must not decode WOFF2 axes on the import critical path');
  assert.doesNotMatch(install, /await inspectFontVariationAxes\(/,
    'the modal must not wait for the WASM axis inspector before saving');
  const closesDialog = install.indexOf("$('#font-import-dialog').close('imported')");
  const startsInspection = install.indexOf('void inspectInstalledFontAxes(candidate, installedFont, face)');
  assert.ok(closesDialog >= 0 && startsInspection > closesDialog,
    'background axis inspection starts after the font is installed and the dialog closes');

  const inspection = section(editor, 'async function inspectInstalledFontAxes(', 'async function removeLocalFont(');
  assert.match(inspection, /state\.fontAssets\.get\(candidate\.id\) !== installedFont/,
    'a removed or replaced font must not be reinstalled when inspection finishes');
  assert.match(inspection, /state\.fontFaces\.get\(candidate\.id\) !== initialFace/,
    'a stale axis result must not replace a newer face');
  assert.match(inspection, /axis\.tag === 'wght'/);
});

test('the WOFF2 smoke workflow waits for the asynchronous variable-face upgrade', () => {
  assert.match(browserWorkflow, /background variable WOFF2 axis inspection and face upgrade', 75_000\)/,
    'the workflow timeout must exceed the decoder’s 60-second bounded failure interval');
  assert.match(browserWorkflow, /row\?\.textContent\.includes\('opsz 14–32'\)[\s\S]*?face\.weight === '100 900'/,
    'the workflow should wait for both discovered axes and the upgraded variable FontFace');
});
