import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, bindVariable, createDocument, createGradientFill, createNode, createVariable, createVariableCollection, setVariableValue } from '../src/model.js';
import { exportNodeToSvg } from '../src/svg-export.js';
import { createVectorPdf, PdfVectorExportError } from '../src/pdf-vector-export.js';
import { assertVectorPdfTextSupported } from '../src/pdf-text-support.js';

function pdfText(bytes) { return Buffer.from(bytes).toString('latin1'); }

function pdfMeasurer() {
  const measure = (text, style = {}) => [...String(text)].length * Number(style.fontSize || 16)
    * (Number(style.fontWeight) >= 700 ? 0.6 : 0.5);
  measure.pdfNaturalWidth = (text, style = {}) => [...String(text)].length * Number(style.fontSize || 16)
    * (Number(style.fontWeight) >= 700 ? 0.58 : 0.48);
  measure.pdfBaselineOffset = style => Number(style.fontSize || 16) * 0.72;
  return measure;
}

function exportText(properties) {
  const document = createDocument();
  const node = createNode('text', {
    fontFamily: 'Arial, sans-serif', fontSize: 16, fontWeight: 400, fontStyle: 'normal',
    width: 180, height: 64, ...properties
  });
  assert.equal(assertVectorPdfTextSupported(document, node), true);
  const svg = exportNodeToSvg(node, { document, measureText: pdfMeasurer() });
  return { node, svg, pdf: createVectorPdf(svg), document };
}

test('preflight permits and exports plain WinAnsi text and case conversion', () => {
  const { svg, pdf } = exportText({ text: 'crème €', textCase: 'uppercase' });
  assert.match(svg, /text-transform="uppercase"/);
  assert.match(pdfText(pdf), /<4352C84D452080> Tj/);
});

test('preflight resolves typography against the supplied design snapshot', () => {
  const document = createDocument();
  const collection = createVariableCollection(document, 'Typography');
  const family = createVariable(document, collection.id, 'Family', 'string', 'Arial, sans-serif');
  const node = createNode('text', {
    name: 'Bound typography', text: 'Café', fontFamily: 'Arial, sans-serif', fontSize: 16, width: 120, height: 24
  });
  addNode(document, node);
  assert.equal(bindVariable(document, node.id, family.id, 'fontFamily'), true);
  const snapshot = structuredClone(document);
  assert.equal(assertVectorPdfTextSupported(snapshot, node), true);
  assert.doesNotThrow(() => createVectorPdf(exportNodeToSvg(node, { document: snapshot, measureText: pdfMeasurer() })));
  assert.equal(setVariableValue(document, family.id, 'Inter'), true);
  assert.throws(() => assertVectorPdfTextSupported(document, node), error =>
    error instanceof PdfVectorExportError && error.feature === 'custom text fonts' && /Bound typography/u.test(error.message));
  assert.equal(assertVectorPdfTextSupported(snapshot, node), true,
    'a later mode value cannot change the earlier export snapshot');
});

test('preflight permits measured flat rich runs with standard variants, colors, and decoration', () => {
  const { svg, pdf } = exportText({
    text: 'Crème €', align: 'center', textCase: 'uppercase', textRuns: [
      { text: 'Crème ', color: '#204060' },
      { text: '€', fontWeight: 700, fontStyle: 'italic', color: '#e11d48', textDecoration: 'underline' },
    ]
  });
  const output = pdfText(pdf);
  assert.match(svg, /data-tiny-image-star-pdf-rich-run="1"/);
  assert.match(output, /<4352C84D4520>/, 'the editor applies case conversion before exporting positioned run text');
  assert.match(output, /\/BaseFont \/Helvetica-BoldOblique/);
  assert.match(output, /<80> Tj/);
  assert.match(output, / re\s*W\s*n| m\s*[\d. -]+\s*l\s*S/s,
    'text decoration is emitted as a vector path');
});

test('preflight and PDF export accept imported single and stacked normal solid text fills', () => {
  const { svg, pdf } = exportText({ text: 'Imported text', fills: [
    { id: 'fill-one', type: 'solid', color: '#123456', opacity: 1, visible: true, blendMode: 'normal' },
    { id: 'fill-two', type: 'solid', color: '#abcdef', opacity: 0.5, visible: true, blendMode: 'normal' },
    { id: 'hidden-fill', type: 'solid', color: '#000000', opacity: 0, visible: true, blendMode: 'normal' },
  ] });
  assert.match(svg, /#123456/);
  assert.match(svg, /#abcdef/);
  assert.equal([...pdfText(pdf).matchAll(/Tj/g)].length, 2, 'both solid fills retain their text paint pass');
});

test('preflight permits bullet and numbered markers through vector PDF export', () => {
  for (const listStyle of ['bulleted', 'numbered']) {
    const { svg, pdf } = exportText({
      text: 'First item\nSecond item', width: 180, height: 64,
      paragraphStyles: [{ listStyle, listLevel: 0 }, { listStyle, listLevel: 0 }]
    });
    assert.match(svg, new RegExp(`data-tiny-image-star-list-marker="${listStyle}"`));
    assert.match(pdfText(pdf), /Tj/);
  }
});

test('preflight permits ending truncation and the final writer clips its WinAnsi ellipsis', () => {
  const { svg, pdf } = exportText({
    text: 'A long line that must be shortened', width: 56, height: 20,
    textTruncation: 'ending', maxLines: 1
  });
  assert.match(svg, /<clipPath/);
  assert.match(svg, /…/);
  assert.match(pdfText(pdf), /\/Subtype \/Form|W\s*n/s);
  assert.match(pdfText(pdf), /<[^>]*85> Tj/);
});

test('preflight permits rich ending truncation with case conversion and a clipped WinAnsi ellipsis', () => {
  const { svg, pdf } = exportText({
    text: 'A long line that must be shortened', textCase: 'uppercase',
    textRuns: [{ text: 'A long line that must be shortened', color: '#334455' }],
    width: 72, height: 20, textTruncation: 'ending', maxLines: 1
  });
  assert.match(svg, /<clipPath/);
  assert.match(svg, /…/);
  assert.match(pdfText(pdf), /<[^>]*85> Tj/);
  assert.match(pdfText(pdf), /41204C4F4E47/);
});

test('preflight rejects unsupported base and active-run font, spacing, and paint settings with the layer name', () => {
  const document = createDocument();
  const base = { text: 'Text', name: 'Unsupported sample', fontFamily: 'Arial, sans-serif', fontSize: 16, width: 120, height: 24 };
  const cases = [
    [{ ...base, fontFamily: 'Inter' }, 'custom text fonts'],
    [{ ...base, textRuns: [{ text: 'Text', fontFamily: 'Inter' }] }, 'custom text fonts'],
    [{ ...base, textRuns: [{ text: 'Text', fontSize: 0 }] }, 'rich text font metrics'],
    [{ ...base, textRuns: [{ text: 'Text', letterSpacing: 1 }] }, 'letter spacing'],
    [{ ...base, textRuns: [{ text: 'Text', baselineShift: Infinity }] }, 'rich text baseline shifts'],
    [{ ...base, textRuns: [{ text: 'Text', fontAxes: { wght: 500 } }] }, 'variable-font axes or OpenType features'],
    [{ ...base, textRuns: [{ text: 'Text', fontFeatures: { kern: 0 } }] }, 'variable-font axes or OpenType features'],
    [{ ...base, letterSpacing: 1 }, 'letter spacing'],
    [{ ...base, align: 'justify' }, 'text alignment'],
    [{ ...base, paragraphStyles: [{ listStyle: 'checkbox' }] }, 'paragraph lists'],
    [{ ...base, fills: [{ id: 'gradient', type: 'linear', gradient: createGradientFill('linear', '#123456'), visible: true, opacity: 1, blendMode: 'normal' }] }, 'text paint stacks'],
    [{ ...base, fills: [{ id: 'blended', type: 'solid', color: '#123456', visible: true, opacity: 1, blendMode: 'multiply' }] }, 'text paint stacks'],
    [{ ...base, stroke: '#000000', strokeWidth: 1 }, 'text outlines'],
    [{ ...base, blendMode: 'multiply' }, 'text layer blend modes'],
  ];
  for (const [properties, feature] of cases) {
    const node = createNode('text', properties);
    assert.throws(() => assertVectorPdfTextSupported(document, node), error =>
      error instanceof PdfVectorExportError && error.feature === feature && /Unsupported sample/u.test(error.message));
  }
});

test('preflight leaves actual Unicode glyph coverage to the final PDF writer', () => {
  const document = createDocument();
  const node = createNode('text', {
    name: 'CJK sample', text: '漢字', fontFamily: 'Arial, sans-serif', fontSize: 16, width: 120, height: 24
  });
  assert.equal(assertVectorPdfTextSupported(document, node), true);
  const svg = exportNodeToSvg(node, { document, measureText: pdfMeasurer() });
  assert.throws(() => createVectorPdf(svg), error => error instanceof PdfVectorExportError
    && error.feature === 'text glyph coverage');
});
