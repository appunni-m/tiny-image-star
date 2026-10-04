import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('PDF sheet export distinguishes printable paper size from fixed frame dimensions', () => {
  assert.match(html, /id="export-selection"[^>]*>Export image<\/button>/,
    'the Inspector quick export must identify itself as an image download rather than imply PDF export');
  assert.match(html, /Image \/ ZIP · PDF via \? Help/);
  assert.match(main, /function syncQuickExportControl\(\)[\s\S]*?button\.textContent = imageArchive \? 'Export ZIP' : selected\.length > 1 \? 'Export selection' : 'Export image'[\s\S]*?search “Export page as PDF/,
    'the quick export should identify multi-image ZIP output and direct PDF users to the visible Help action');
  assert.match(main, /function renderInspector\(\)[\s\S]*?syncQuickExportControl\(\)/,
    'the quick export label should track the current selection');
  assert.match(html, /id="page-pdf-dialog"[\s\S]*?id="page-pdf-size"[\s\S]*?value="custom"/);
  assert.match(html, /id="page-pdf-orientation"[\s\S]*?portrait[\s\S]*?landscape/);
  assert.match(html, /id="page-pdf-custom-width"[\s\S]*?id="page-pdf-custom-height"/);
  assert.match(main, /A Page is an open workspace\. Frames are fixed-size areas inside it\. Choose a paper size when exporting a PDF\./,
    'the inspector should distinguish the open canvas from a fixed-size frame and printed PDF sheet');
  assert.match(html, /To set a fixed design size, create or select a frame and set its width and height in Design properties\./);
  assert.match(main, /\{ label: 'Current page · fit artwork to paper…', action: openPagePdfDialog \}/);
  assert.match(html, /image-based PDF[\s\S]*?For editable vector output/);
  assert.match(main, /\{ labelOnly: true, label: 'PDF' \}[\s\S]*?Current page · image-based PDF, one page per frame[\s\S]*?Current page · editable vector, one page per frame[\s\S]*?\{ labelOnly: true, label: 'SVG' \}/,
    'export options should be grouped by format and identify which artwork will be exported');
  assert.match(main, /async function exportActivePagePdf\(pagePlan\)[\s\S]*?getPageContentBounds\([\s\S]*?renderExportBlob\(rootIds,[\s\S]*?rawPng: true/,
    "page export must render the page's actual visible content instead of selecting frames only");
  assert.match(main, /pdfWidth: pagePlan\.widthPt,[\s\S]*?pdfHeight: pagePlan\.heightPt/,
    'the selected physical paper size must set the output PDF MediaBox');
  assert.match(main, /format: 'jpeg', quality: 92,[\s\S]*?createMultipagePdf\(\[/,
    'final flattened PDF page pixels must pass through the local Pillow-RS JPEG encoder');
  const submitStart = main.indexOf("$('#page-pdf-form').addEventListener('submit'");
  const submitEnd = main.indexOf("$('#canvas-menu').addEventListener", submitStart);
  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  const submit = main.slice(submitStart, submitEnd);
  assert.match(submit, /await exportActivePagePdf\(pagePlan\)/, 'keep the export dialog open until the result is known');
  assert.match(submit, /Could not create the PDF:/, 'show a persistent, actionable error instead of only a short toast');
  assert.match(submit, /PDF export canceled\. No file was downloaded/);
  assert.match(main, /state\.pagePdfAbortController\.abort\(\)/, 'the dialog cancel button must stop the page export');
  assert.match(html, /id="page-pdf-status" role="status" aria-live="polite"/);
});
