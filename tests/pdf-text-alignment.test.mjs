import test from 'node:test';
import assert from 'node:assert/strict';
import { vectorPdfTextAlignmentIssue } from '../src/pdf-text-alignment.js';

test('vector-PDF alignment accepts left, center, and right at layer and paragraph levels', () => {
  for (const align of ['left', 'center', 'right']) {
    assert.equal(vectorPdfTextAlignmentIssue({ align }), null);
    assert.equal(vectorPdfTextAlignmentIssue({ align: 'left', paragraphStyles: [{ align }] }), null);
  }
  assert.equal(vectorPdfTextAlignmentIssue({}), null, 'missing alignment uses left alignment');
  assert.equal(vectorPdfTextAlignmentIssue({ align: 'right', paragraphStyles: [{}] }), null,
    'paragraphs without an override inherit the layer alignment');
});

test('vector-PDF alignment identifies justified and unknown paragraph modes for raster fallback', () => {
  assert.match(vectorPdfTextAlignmentIssue({ align: 'justify' }), /justified text still needs raster PDF/u);
  assert.match(vectorPdfTextAlignmentIssue({ align: 'left', paragraphStyles: [{ align: 'justify' }] }), /justified text still needs raster PDF/u);
  assert.match(vectorPdfTextAlignmentIssue({ align: 'left', paragraphStyles: [{ align: 'distributed' }] }), /left, centered, and right-aligned/u);
});
