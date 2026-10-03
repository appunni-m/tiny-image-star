import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('page PDF export has a paper-size chooser and includes visible page artwork without requiring frames', () => {
  assert.match(html, /id="page-pdf-dialog"[\s\S]*?id="page-pdf-size"[\s\S]*?value="custom"/);
  assert.match(html, /id="page-pdf-orientation"[\s\S]*?portrait[\s\S]*?landscape/);
  assert.match(html, /id="page-pdf-custom-width"[\s\S]*?id="page-pdf-custom-height"/);
  assert.match(main, /\{ label: 'Export page to PDF…', action: openPagePdfDialog \}/);
  assert.match(main, /async function exportActivePagePdf\(pagePlan\)[\s\S]*?getPageContentBounds\([\s\S]*?renderExportBlob\(rootIds,[\s\S]*?rawPng: true/,
    "page export must render the page's actual visible content instead of selecting frames only");
  assert.match(main, /pdfWidth: pagePlan\.widthPt,[\s\S]*?pdfHeight: pagePlan\.heightPt/,
    'the selected physical paper size must set the output PDF MediaBox');
  assert.match(main, /format: 'jpeg', quality: 92,[\s\S]*?createMultipagePdf\(\[/,
    'final flattened PDF page pixels must pass through the local Pillow-RS JPEG encoder');
});
