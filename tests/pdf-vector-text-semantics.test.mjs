import test from 'node:test';
import assert from 'node:assert/strict';
import { createMultipageVectorPdf, createVectorPdf } from '../src/pdf-vector-export.js';

const encode = value => JSON.stringify(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

function semanticSvg({ text = 'A ', upem = 2048, glyphs = null, extra = '' } = {}) {
  const records = glyphs || [
    { d: 'M0 0L500 0L500 700L0 700Z', matrix: [0.02, 0, 0, 0.02, 10, 50], xAdvance: 600, yAdvance: 0, cluster: 0, text: 'A' },
    { d: '', matrix: [0.02, 0, 0, 0.02, 22, 50], xAdvance: 250, yAdvance: 0, cluster: 1, text: ' ' },
  ];
  const paths = records.map(glyph => `<path d="${glyph.d}" data-tiny-image-star-pdf-glyph="${encode({
    matrix: glyph.matrix, xAdvance: glyph.xAdvance, yAdvance: glyph.yAdvance,
    cluster: glyph.cluster, text: glyph.text,
  })}"/>`).join('');
  const run = encode({ text, upem, ascender: 1536, descender: -512 });
  return `<svg width="100px" height="100px" viewBox="0 0 100 100"><path d="M0 0L4 0L4 4Z" fill="#000000"/><g data-tiny-image-star-pdf-text="1" opacity="0"><g data-tiny-image-star-pdf-run="${run}">${paths}</g></g>${extra}</svg>`;
}

function latinPdf(pdf) { return Buffer.from(pdf).toString('latin1'); }

test('retained glyph semantics become nonpainting Type3 text with cluster ToUnicode and normalized metrics', () => {
  const pdf = createVectorPdf(semanticSvg());
  const source = latinPdf(pdf);
  assert.match(source, /\/Subtype \/Type3/);
  assert.match(source, /\/FontMatrix \[0\.001 0 0 0\.001 0 0\]/);
  assert.match(source, /\/Ascent 750/);
  assert.match(source, /\/Descent -250/);
  assert.match(source, /\/FirstChar 1 \/LastChar 2 \/Widths \[292\.96875 122\.0703125\]/);
  assert.match(source, /\/ToUnicode \d+ 0 R/);
  assert.match(source, /3 Tr/);
  assert.match(source, /40\.96 0 0 40\.96 10 50 Tm/);
  assert.match(source, /40\.96 0 0 40\.96 22 50 Tm/);
  assert.match(source, /<01> <0041>/);
  assert.match(source, /<02> <0020>/);
  // The visible SVG path remains painted; the semantic text is separate and
  // uses text rendering mode 3 so it contributes no additional ink.
  assert.match(source, /0 0 m[\s\S]*f/);
});

test('shared shaped clusters form one composite Type3 character with a single Unicode mapping', () => {
  const glyphs = [
    { d: 'M0 0L400 0L400 500Z', matrix: [0.01, 0, 0, 0.01, 5, 20], xAdvance: 500, yAdvance: 0, cluster: 0, text: 'fi' },
    { d: 'M0 0L100 0L100 100Z', matrix: [0.01, 0, 0, 0.01, 9, 23], xAdvance: 0, yAdvance: 0, cluster: 0, text: 'fi' },
  ];
  const source = latinPdf(createVectorPdf(semanticSvg({ text: 'fi', glyphs })));
  assert.match(source, /\/FirstChar 1 \/LastChar 1/);
  assert.equal((source.match(/<01> <00660069>/g) || []).length, 1);
  assert.match(source, /20\.48 0 0 20\.48 5 20 Tm/);
  assert.match(source, /0\.48828125 0 0 0\.48828125 195\.3125 146\.484375 cm/);
});

test('malformed or incomplete semantic records fail closed', () => {
  const valid = semanticSvg();
  const cases = [
    valid.replace('opacity="0"', 'opacity="0.1"'),
    valid.replace('data-tiny-image-star-pdf-text="1"', 'data-tiny-image-star-pdf-text="2"'),
    valid.replace('data-tiny-image-star-pdf-text="1"', 'data-tiny-image-star-pdf-text="1" data-extra="x"'),
    valid.replace('<g data-tiny-image-star-pdf-run=', '<g clip-path="url(#anything)" data-tiny-image-star-pdf-run='),
    valid.replace('data-tiny-image-star-pdf-glyph="', 'data-tiny-image-star-pdf-glyph="{&quot;unexpected&quot;:true} '),
    valid.replace('&quot;cluster&quot;:1', '&quot;cluster&quot;:3'),
    valid.replace('&quot;matrix&quot;:[0.02,0,0,0.02,22,50]', '&quot;matrix&quot;:[0,0,0,0,22,50]'),
    valid.replace('&quot;cluster&quot;:0,&quot;text&quot;:&quot;A&quot;', '&quot;cluster&quot;:0,&quot;cluster&quot;:0,&quot;text&quot;:&quot;A&quot;'),
    valid.replace('&quot;upem&quot;:2048', '&quot;upem&quot;:0'),
    valid.replace('&quot;ascender&quot;:1536,&quot;descender&quot;:-512', '&quot;ascender&quot;:-512,&quot;descender&quot;:1536'),
    valid.replace('d="M0 0L500 0L500 700L0 700Z"', `d="${' '.repeat(1_000_001)}"`),
  ];
  for (const svg of cases) assert.throws(() => createVectorPdf(svg), /positioned glyph metadata/);
});

test('text semantic glyph limits are shared across pages in a multipage PDF', () => {
  const pageWithSpaces = count => {
    const text = ' '.repeat(count);
    const glyphs = Array.from({ length: count }, (_, cluster) => ({
      d: '', matrix: [1, 0, 0, 1, cluster, 0], xAdvance: 1, yAdvance: 0, cluster, text: ' ',
    }));
    return semanticSvg({ text, glyphs });
  };
  const pages = [pageWithSpaces(21_846), pageWithSpaces(21_846), pageWithSpaces(21_846)];
  assert.throws(() => createMultipageVectorPdf(pages), /per-document count limit/);
});
