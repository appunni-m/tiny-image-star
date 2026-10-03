import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, applyTypographyStyle, createComponent, createComponentInstance, createDocument, createNode, createTypographyStyle, findNode, validateDocument } from '../src/model.js';
import { calculateTextBox, layoutPlainText, layoutTextRuns, normalizeTextParagraphStyles, preserveAutoWidthTextAnchor, resolvedLineHeight, textGraphemes, transformTextCase } from '../src/text-layout.js';
import { importSvgToLayers } from '../src/svg-import.js';

function context() {
  return {
    font: '',
    measureText(text) {
      return { width: [...String(text)].reduce((width, character) => width + (character === ' ' ? 5 : 10), 0) };
    }
  };
}

function fontAwareContext() {
  return {
    font: '',
    measureText(text) {
      const size = Number(/([\d.]+)px/.exec(this.font)?.[1] || 10);
      return { width: [...String(text)].length * size / 2 };
    }
  };
}

function textGeometry(node) {
  return { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation };
}

function alignedTopAnchor(node) {
  const width = node.width;
  const height = node.height;
  const localX = node.align === 'center' ? width / 2 : node.align === 'right' ? width : 0;
  const radians = node.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: node.x + width / 2 + cosine * (localX - width / 2) + sine * height / 2,
    y: node.y + height / 2 + sine * (localX - width / 2) - cosine * height / 2
  };
}

test('resolves Auto, pixel, percent, and legacy ratio line heights through text layout', () => {
  assert.equal(resolvedLineHeight(1, 20, 'auto'), 24);
  assert.equal(resolvedLineHeight(18, 20, 'pixels'), 18);
  assert.equal(resolvedLineHeight(135, 20, 'percent'), 27);
  assert.equal(resolvedLineHeight(1.5, 20), 30);

  const layout = unit => layoutTextRuns([{ text: 'a\nb' }], Infinity, {
    fontSize: 20, lineHeight: unit.value, lineHeightUnit: unit.name, letterSpacing: 0
  }, text => [...text].length * 10);
  assert.equal(layout({ name: 'pixels', value: 18 }).height, 36);
  assert.equal(layout({ name: 'percent', value: 135 }).height, 54);
  assert.equal(layout({ name: 'auto', value: 1 }).height, 48);
  assert.equal(layout({ name: 'ratio', value: 1.5 }).height, 60);
});

test('ending truncation keeps the maximum visible lines and appends a fitting ellipsis', () => {
  const measure = value => [...String(value)].length * 10;
  const layout = layoutPlainText('abcdefgh', 30, measure, {
    lineHeight: 10, textTruncation: 'ending', maxLines: 2
  });
  assert.deepEqual(layout.lines.map(line => line.displayText), ['abc', 'de…']);
  assert.equal(layout.height, 20);
  assert.ok(layout.lines.every(line => measure(line.displayText) <= 30));
});

test('ending truncation respects the text box height and clips a later paragraph with an ellipsis', () => {
  const measure = value => [...String(value)].length * 10;
  const layout = layoutPlainText('first\nsecond', 60, measure, {
    lineHeight: 10, textTruncation: 'ending', boxHeight: 10
  });
  assert.deepEqual(layout.lines.map(line => line.displayText), ['first…']);
  assert.equal(layout.height, 10);
});

test('ending truncation never exposes a partially visible line at a fractional height limit', () => {
  const measure = value => [...String(value)].length * 10;
  const layout = layoutPlainText('one\ntwo', 50, measure, {
    lineHeight: 12, textTruncation: 'ending', maxHeight: 18
  });
  assert.deepEqual(layout.lines.map(line => line.displayText), ['one…']);
  assert.equal(layout.height, 12);
});

test('rich ending truncation keeps the ellipsis in the final visible grapheme style', () => {
  const layout = layoutTextRuns([
    { text: 'a', fontWeight: 700 },
    { text: 'bc' }
  ], 20, { fontSize: 10, lineHeight: 10, letterSpacing: 0 }, value => [...String(value)].length * 10, {
    textTruncation: 'ending', maxLines: 1
  });
  assert.equal(layout.lines[0].displayText, 'a…');
  assert.equal(layout.lines[0].parts.length, 1);
  assert.equal(layout.lines[0].parts[0].style.fontWeight, 700);
});

test('auto-height text respects a finite max height while calculating truncated bounds', () => {
  const node = createNode('text', {
    text: 'one\ntwo\nthree', width: 80, height: 80, fontSize: 10, lineHeight: 1,
    textFit: 'auto-height', textTruncation: 'ending', maxHeight: 18
  });
  const size = calculateTextBox(context(), node);
  assert.equal(size.height, 18);
});

test('auto-height relayout uses pixel line height', () => {
  const node = createNode('text', {
    text: 'one two three four', width: 40, height: 20, fontSize: 10,
    lineHeight: 18, lineHeightUnit: 'pixels', textFit: 'auto-height'
  });
  const size = calculateTextBox(context(), node);
  assert.ok(size.height >= 4 * 18);
  assert.equal(node.lineHeightUnit, 'pixels');
});

test('text box measurement accepts resolved font and paragraph properties', () => {
  const ctx = fontAwareContext();
  const measuredStyles = [];
  const node = createNode('text', {
    text: 'one\ntwo\nthree\nfour\nfive', width: 100, height: 20, fontSize: 10, lineHeight: 1,
    textFit: 'auto-height'
  });
  const size = calculateTextBox(ctx, node, {
    fontFamily: 'Editorial Sans', fontWeight: 700, fontStyle: 'italic',
    paragraphSpacing: 5, firstLineIndent: 7,
    shapeText(text, style) {
      measuredStyles.push({ fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontStyle: style.fontStyle });
      return null;
    }
  });
  assert.equal(ctx.font, 'italic 700 10px Editorial Sans');
  assert.deepEqual(size, { width: 100, height: 74 }, 'auto-height uses the resolved paragraph gap');
  assert.ok(measuredStyles.length > 0 && measuredStyles.every(style => style.fontFamily === 'Editorial Sans'
    && style.fontWeight === 700 && style.fontStyle === 'italic'),
  'font shaping receives the resolved typography properties');
});

test('model validation accepts supported line-height units and rejects malformed values', () => {
  for (const [lineHeight, lineHeightUnit] of [[1.25, 'ratio'], [1, 'auto'], [18, 'pixels'], [135, 'percent']]) {
    const document = createDocument();
    addNode(document, createNode('text', { text: 'Line', lineHeight, lineHeightUnit }));
    assert.doesNotThrow(() => validateDocument(document));
  }
  for (const overrides of [
    { lineHeight: 0, lineHeightUnit: 'pixels' },
    { lineHeight: 100_001, lineHeightUnit: 'percent' },
    { lineHeight: 1, lineHeightUnit: 'em' },
    { lineHeight: null, lineHeightUnit: 'pixels' }
  ]) {
    const document = createDocument();
    addNode(document, createNode('text', { text: 'Bad', ...overrides }));
    assert.throws(() => validateDocument(document), /line.height/i);
  }
  const legacy = createDocument();
  addNode(legacy, createNode('text', { text: 'Legacy', lineHeight: 1.4 }));
  assert.doesNotThrow(() => validateDocument(legacy));
});

test('auto-width fits the widest explicit line and keeps newline height', () => {
  const node = createNode('text', { text: 'one\ntwo words', fontSize: 20, lineHeight: 1.25, letterSpacing: 2, textFit: 'auto-width' });
  assert.deepEqual(calculateTextBox(context(), node), { width: 103, height: 54 });
});

test('auto-width includes first-line indentation in width and paragraph gaps in height', () => {
  const node = createNode('text', {
    text: 'ab\nc', fontSize: 20, lineHeight: 1, paragraphSpacing: 7,
    firstLineIndent: 12, textFit: 'auto-width'
  });
  assert.deepEqual(calculateTextBox(context(), node), { width: 34, height: 51 });

  node.firstLineIndent = 0;
  node.paragraphSpacing = 0;
  assert.deepEqual(calculateTextBox(context(), node), { width: 22, height: 44 });
});

test('auto-height wraps to the fixed width while fixed text keeps its explicit box', () => {
  const ctx = context();
  const node = createNode('text', { text: 'one two three', width: 50, height: 22, fontSize: 10, lineHeight: 1.2, textFit: 'auto-height' });
  assert.deepEqual(calculateTextBox(ctx, node), { width: 50, height: 40 });
  node.textFit = 'fixed';
  assert.deepEqual(calculateTextBox(ctx, node), { width: 50, height: 22 });
});

test('plain and rich paragraph layout apply spacing and first-line indentation', () => {
  const measured = value => [...String(value)].reduce((width, character) => width + (character === ' ' ? 5 : 10), 0);
  const plain = layoutPlainText('one two\nthree\nfour five', 80, measured, {
    lineHeight: 10, paragraphSpacing: 6, firstLineIndent: 12
  });
  assert.deepEqual(plain.lines.map(({ displayText, paragraphIndex, firstLine, indent, y }) => ({
    displayText, paragraphIndex, firstLine, indent, y
  })), [
    { displayText: 'one two', paragraphIndex: 0, firstLine: true, indent: 12, y: 0 },
    { displayText: 'three', paragraphIndex: 1, firstLine: true, indent: 12, y: 16 },
    { displayText: 'four', paragraphIndex: 2, firstLine: true, indent: 12, y: 32 },
    { displayText: 'five', paragraphIndex: 2, firstLine: false, indent: 0, y: 42 }
  ]);
  assert.equal(plain.height, 52);
  assert.equal(plain.width, 77);

  const rich = layoutTextRuns([{ text: 'one two\nthree' }], 60, {
    fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
    lineHeight: 1, letterSpacing: 0, paragraphSpacing: 7, firstLineIndent: 10
  }, value => [...String(value)].length * 5);
  assert.deepEqual(rich.lines.map(({ displayText, indent, y, paragraphIndex }) => ({ displayText, indent, y, paragraphIndex })), [
    { displayText: 'one two', indent: 10, y: 0, paragraphIndex: 0 },
    { displayText: 'three', indent: 10, y: 17, paragraphIndex: 1 }
  ]);
  assert.equal(rich.height, 27);

  const crlf = layoutPlainText('first\r\nsecond', Infinity, value => [...String(value)].length * 10, {
    lineHeight: 10, paragraphSpacing: 4, firstLineIndent: 8
  });
  assert.deepEqual(crlf.lines.map(({ displayText, y, indent }) => ({ displayText, y, indent })), [
    { displayText: 'first', y: 0, indent: 8 },
    { displayText: 'second', y: 14, indent: 8 }
  ]);
});

test('plain list layout emits nested markers, hangs wrapped lines, and separates item spacing from paragraph spacing', () => {
  const measure = value => [...String(value)].length * 5;
  const list = layoutPlainText('alpha beta\nchild\ngrand\nnext\nbody\nbody two', 100, measure, {
    lineHeight: 10,
    paragraphSpacing: 9,
    listSpacing: 3,
    paragraphStyles: [
      { listStyle: 'numbered', listLevel: 0, listStart: 3 },
      { listStyle: 'numbered', listLevel: 1 },
      { listStyle: 'numbered', listLevel: 2 },
      { listStyle: 'numbered', listLevel: 0 },
      { listStyle: 'none' },
      { listStyle: 'none' }
    ]
  });

  assert.deepEqual(list.lines.filter(line => line.marker).map(line => [line.paragraphIndex, line.marker.text, line.indent]), [
    [0, '3.', 18], [1, 'a.', 42], [2, 'i.', 66], [3, '4.', 18]
  ]);
  assert.equal(list.lines[0].displayText, 'alpha beta');
  assert.equal(list.lines[0].firstLine, true);
  assert.deepEqual(normalizeTextParagraphStyles('a\r\nb\rc', [{ listStyle: 'bulleted', listLevel: 0 }]), [
    { listStyle: 'bulleted', listLevel: 0 }, { listStyle: 'none', listLevel: 0 }, { listStyle: 'none', listLevel: 0 }
  ], 'paragraph records align with CRLF and CR paragraph delimiters');

  const wrapped = layoutPlainText('alpha beta', 55, measure, {
    lineHeight: 10,
    paragraphStyles: [{ listStyle: 'bulleted', listLevel: 0 }]
  });
  assert.deepEqual(wrapped.lines.map(line => [line.displayText, line.indent, Boolean(line.marker)]), [
    ['alpha', 13, true], ['beta', 13, false]
  ], 'continuation lines keep the hanging text indent without repeating the marker');

  const spaced = layoutPlainText('one\ntwo\nbody\nbody two', 100, measure, {
    lineHeight: 10, paragraphSpacing: 9, listSpacing: 3,
    paragraphStyles: [
      { listStyle: 'bulleted', listLevel: 0 }, { listStyle: 'bulleted', listLevel: 0 },
      { listStyle: 'none' }, { listStyle: 'none' }
    ]
  });
  assert.deepEqual(spaced.lines.map(line => line.y), [0, 13, 32, 51],
    'list spacing applies between list items while paragraph spacing applies at list boundaries and plain paragraphs');
});

test('rich list layout keeps inline runs and uses the item text style for its marker', () => {
  const layout = layoutTextRuns([
    { text: 'Bold', fontWeight: 700, color: '#aa2211' },
    { text: ' item\nSecond', fontStyle: 'italic' }
  ], 120, {
    fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
    lineHeight: 1, letterSpacing: 0, paragraphSpacing: 7, listSpacing: 2,
    paragraphStyles: [{ listStyle: 'bulleted', listLevel: 0 }, { listStyle: 'numbered', listLevel: 0, listStart: 8 }]
  }, (value, style) => [...String(value)].length * (style.fontWeight === 700 ? 6 : 5));

  assert.deepEqual(layout.lines.map(line => [line.paragraphIndex, line.marker?.text, line.y]), [
    [0, '•', 0], [1, '8.', 12]
  ]);
  assert.equal(layout.lines[0].marker.style.fontWeight, 700);
  assert.equal(layout.lines[0].marker.style.color, '#aa2211');
  assert.deepEqual(layout.lines[0].parts.map(part => [part.text, part.style.fontWeight, part.style.fontStyle]), [
    ['Bold', 700, 'normal'], [' item', 400, 'italic']
  ], 'list metadata does not flatten rich text runs');
});

test('text auto-sizing accounts for list hanging indents and list item spacing', () => {
  const node = createNode('text', {
    text: 'one\ntwo\nthree\nfour\nfive', fontSize: 10, lineHeight: 1,
    textFit: 'auto-height', listSpacing: 4,
    paragraphStyles: Array.from({ length: 5 }, () => ({ listStyle: 'numbered', listLevel: 0 }))
  });
  const withSpacing = calculateTextBox(context(), node);
  node.listSpacing = 0;
  const withoutSpacing = calculateTextBox(context(), node);
  assert.equal(withSpacing.height - withoutSpacing.height, 16);
  assert.ok(withSpacing.width > 30, 'auto-width includes the number marker column and hanging indent');
});

test('plain and rich text layout preserve repeated, leading, and trailing spaces unless wrapping at them', () => {
  const measure = value => [...String(value)].reduce((width, character) => width + (character === ' ' ? 5 : 10), 0);
  const plain = layoutPlainText('  one   two  ', Infinity, measure, { lineHeight: 10 });
  assert.equal(plain.lines[0].displayText, '  one   two  ');
  assert.equal(plain.lines[0].naturalWidth, measure('  one   two  '));

  const wrapped = layoutPlainText('one   two', 50, measure, { lineHeight: 10 });
  assert.deepEqual(wrapped.lines.map(line => line.displayText), ['one', 'two'],
    'the whitespace at a soft-wrap boundary is omitted, while in-line whitespace remains exact');

  const baseStyle = {
    fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
    lineHeight: 1, letterSpacing: 0
  };
  const rich = layoutTextRuns([
    { text: '  one  ', fontWeight: 700 },
    { text: 'two   ' }
  ], Infinity, baseStyle, value => [...String(value)].length * 5);
  assert.equal(rich.lines[0].displayText, '  one  two   ');
  assert.deepEqual(rich.lines[0].parts.map(part => [part.text, part.style.fontWeight]), [
    ['  one  ', 700], ['two   ', 400]
  ], 'spaces retain the style of the rich-text run that supplied them');

  const richWrapped = layoutTextRuns([{ text: 'one   two' }], 30, baseStyle, value => [...String(value)].length * 5);
  assert.deepEqual(richWrapped.lines.map(line => line.displayText), ['one', 'two']);
});

test('Unicode nonbreaking spaces, word joiners, and nonbreaking hyphens never become soft-wrap boundaries', () => {
  const separators = ['\u00a0', '\u2007', '\u202f', '\u2060', '\u2011'];
  const measure = value => textGraphemes(value).length * 10;
  const baseStyle = {
    fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
    lineHeight: 1, letterSpacing: 0
  };

  for (const separator of separators) {
    const text = `A${separator}B`;
    const plain = layoutPlainText(text, 20, measure, { lineHeight: 10 });
    assert.deepEqual(plain.lines.map(line => line.displayText), [text],
      `plain text must keep U+${separator.codePointAt(0).toString(16).toUpperCase()} attached to both neighbors`);

    const rich = layoutTextRuns([{ text: 'A', fontWeight: 700 }, { text: separator }, { text: 'B', color: '#123456' }], 20, baseStyle,
      value => measure(value));
    assert.deepEqual(rich.lines.map(line => line.displayText), [text],
      `rich text must keep U+${separator.codePointAt(0).toString(16).toUpperCase()} attached across styled run boundaries`);
    assert.equal(rich.lines[0].parts.map(part => part.text).join(''), text,
      'the line layout preserves the source text even when the unbreakable sequence is wider than its box');
  }

  const measurementSpace = layoutPlainText('10\u00a0MB 12\u202fkg', 50, value => textGraphemes(value).reduce((width, cluster) => width + (cluster === ' ' ? 5 : 10), 0), {
    lineHeight: 10
  });
  assert.deepEqual(measurementSpace.lines.map(line => line.displayText), ['10\u00a0MB', '12\u202fkg'],
    'breakable spaces between values still wrap while unit separators remain intact');

  const longUnbreakableValue = `A${'\u00a0'.repeat(300)}B`;
  const narrowMeasure = value => textGraphemes(value).length;
  assert.deepEqual(layoutPlainText(longUnbreakableValue, 10, narrowMeasure, { lineHeight: 10 }).lines.map(line => line.displayText),
    [longUnbreakableValue], 'the long-token probe cap never breaks a no-break sequence');
  const longRich = layoutTextRuns([{ text: longUnbreakableValue }], 10, baseStyle, narrowMeasure);
  assert.deepEqual(longRich.lines.map(line => line.displayText), [longUnbreakableValue],
    'rich text also preserves a no-break sequence beyond the bounded-probe threshold');
});

test('soft hyphens and zero-width spaces create only discretionary plain and rich line breaks', () => {
  const measure = value => textGraphemes(value).length * 10;
  const sourceSoftHyphen = 'ab\u00adcd';
  const sourceZeroWidthSpace = 'ab\u200bcd';
  const plainOptions = { lineHeight: 10 };

  const softWrapped = layoutPlainText(sourceSoftHyphen, 30, measure, plainOptions);
  assert.deepEqual(softWrapped.lines.map(line => line.displayText), ['ab-', 'cd'],
    'a chosen soft-hyphen opportunity renders one visible hyphen');
  assert.equal(sourceSoftHyphen, 'ab\u00adcd', 'layout does not rewrite the stored source string');
  assert.ok(softWrapped.lines.every(line => !line.displayText.includes('\u00ad')),
    'the invisible source marker is not emitted as display text');

  const zeroWidthWrapped = layoutPlainText(sourceZeroWidthSpace, 30, measure, plainOptions);
  assert.deepEqual(zeroWidthWrapped.lines.map(line => line.displayText), ['ab', 'cd'],
    'a chosen zero-width-space opportunity creates a break without a visible character');
  assert.ok(zeroWidthWrapped.lines.every(line => !line.displayText.includes('\u200b')));

  for (const source of [sourceSoftHyphen, sourceZeroWidthSpace]) {
    assert.deepEqual(layoutPlainText(source, 50, measure, plainOptions).lines.map(line => line.displayText), ['abcd'],
      'unselected discretionary markers are invisible and do not split a word');
  }
  assert.deepEqual(layoutPlainText('aa a\u00adbc', 50, measure, plainOptions).lines.map(line => line.displayText), ['aa a-', 'bc'],
    'a soft-hyphen opportunity may use the remaining width on the current line');
  assert.deepEqual(layoutPlainText('aa a\u200bbc', 50, measure, plainOptions).lines.map(line => line.displayText), ['aa a', 'bc'],
    'a zero-width-space opportunity may use the remaining width without adding a glyph');
  assert.deepEqual(layoutPlainText('abcd', 40, measure, plainOptions).lines.map(line => line.displayText), ['abcd'],
    'ordinary words receive no new discretionary break points');

  const baseStyle = {
    fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
    lineHeight: 1, letterSpacing: 0
  };
  const richSoftRuns = [
    { text: 'ab' }, { text: '\u00ad', fontWeight: 700, color: '#ff0000' }, { text: 'cd' }
  ];
  const richSoft = layoutTextRuns(richSoftRuns, 30, baseStyle, measure);
  assert.deepEqual(richSoft.lines.map(line => line.displayText), ['ab-', 'cd'],
    'rich text honors a soft-hyphen opportunity even when its marker is in a separate run');
  assert.deepEqual(richSoft.lines[0].parts.map(part => [part.text, part.style.fontWeight, part.style.color]), [
    ['ab', 400, '#1e1e1e'], ['-', 700, '#ff0000']
  ], 'the visible hyphen inherits the discretionary marker run style');
  assert.equal(richSoftRuns.map(run => run.text).join(''), sourceSoftHyphen,
    'rich source runs retain their original soft-hyphen character');

  const richContextualSoftRuns = [
    { text: 'aa a' }, { text: '\u00ad', fontWeight: 700, color: '#ff0000' }, { text: 'bc' }
  ];
  const richContextualSoft = layoutTextRuns(richContextualSoftRuns, 50, baseStyle, measure);
  assert.deepEqual(richContextualSoft.lines.map(line => line.displayText), ['aa a-', 'bc'],
    'rich soft-hyphen wrapping can use remaining line width across styled runs');
  const contextualHyphen = richContextualSoft.lines[0].parts.find(part => part.text === '-');
  assert.equal(contextualHyphen.style.fontWeight, 700);
  assert.equal(contextualHyphen.style.color, '#ff0000');

  const richZeroRuns = [{ text: 'ab' }, { text: '\u200b', color: '#ff0000' }, { text: 'cd' }];
  const richZero = layoutTextRuns(richZeroRuns, 30, baseStyle, measure);
  assert.deepEqual(richZero.lines.map(line => line.displayText), ['ab', 'cd'],
    'rich text honors a zero-width-space opportunity across styled-run boundaries');
  assert.ok(richZero.lines.every(line => line.parts.every(part => !/[\u00ad\u200b]/u.test(part.text))));
  assert.equal(richZeroRuns.map(run => run.text).join(''), sourceZeroWidthSpace,
    'rich source runs retain their original zero-width-space character');

  const richContextualZero = layoutTextRuns([
    { text: 'aa a' }, { text: '\u200b', color: '#ff0000' }, { text: 'bc' }
  ], 50, baseStyle, measure);
  assert.deepEqual(richContextualZero.lines.map(line => line.displayText), ['aa a', 'bc'],
    'rich zero-width-space wrapping can use remaining line width across styled runs');

  const richList = layoutTextRuns([
    { text: 'aa a' }, { text: '\u00ad', fontWeight: 700 }, { text: 'bc' }
  ], 80, { ...baseStyle, firstLineIndent: 10, paragraphStyles: [{ listStyle: 'bulleted' }] }, measure);
  assert.deepEqual(richList.lines.map(line => [line.displayText, line.indent]), [['aa a-', 28], ['bc', 18]],
    'rich discretionary wrapping respects list marker gutters and first-line indentation');
  assert.ok(richList.lines.every(line => line.indent + line.naturalWidth <= 80),
    'rich list line widths stay inside the available paragraph box');

  const plainList = layoutPlainText('aa a\u00adbc', 80, measure, {
    lineHeight: 10, firstLineIndent: 10, paragraphStyles: [{ listStyle: 'bulleted' }]
  });
  assert.deepEqual(plainList.lines.map(line => [line.displayText, line.indent]), [['aa a-', 28], ['bc', 18]],
    'discretionary wrapping respects the indented first-line width and list hanging indent');
  assert.ok(plainList.lines.every(line => line.indent + line.naturalWidth <= 80),
    'list line natural widths remain within the text box after discretionary wrapping');

  for (const source of ['A\u00ad\u00a0B', 'A\u00a0\u00adB', 'A\u200b\u202fB']) {
    const visible = source.replace(/[\u00ad\u200b]/gu, '');
    assert.deepEqual(layoutPlainText(source, 20, measure, plainOptions).lines.map(line => line.displayText), [visible],
      'a discretionary marker cannot create a break beside a Unicode no-break character');
    const richRuns = [...source].map((text, index) => index === 1 ? { text, color: '#ff0000' } : { text });
    assert.deepEqual(layoutTextRuns(richRuns, 20, baseStyle, measure).lines.map(line => line.displayText), [visible],
      'rich discretionary markers respect no-break characters across run boundaries');
  }

  assert.deepEqual(layoutPlainText('ab\u200b\u00adcd', 30, measure, plainOptions).lines.map(line => line.displayText), ['ab-', 'cd'],
    'adjacent discretionary markers at one boundary choose the soft hyphen as the visible break');
  assert.deepEqual(layoutTextRuns([{ text: 'ab' }, { text: '\u200b\u00ad' }, { text: 'cd' }], 30, baseStyle, measure)
    .lines.map(line => line.displayText), ['ab-', 'cd'],
  'rich adjacent markers keep the same soft-hyphen preference');
  assert.deepEqual(layoutPlainText('\u00ad\u200b', 50, measure, plainOptions).lines.map(line => line.displayText), [''],
    'marker-only plain paragraphs render no discretionary glyph');
  assert.deepEqual(layoutTextRuns([{ text: '\u00ad\u200b' }], 50, baseStyle, measure).lines.map(line => line.displayText), [''],
    'marker-only rich paragraphs render no discretionary glyph');
  assert.deepEqual(layoutPlainText('\u00adab\u200b', 50, measure, plainOptions).lines.map(line => line.displayText), ['ab'],
    'leading and trailing discretionary markers disappear when no break can use them');
  assert.deepEqual(layoutTextRuns([{ text: '\u00adab\u200b' }], 50, baseStyle, measure).lines.map(line => line.displayText), ['ab'],
    'rich leading and trailing markers disappear when no break can use them');

  const richUnbroken = layoutTextRuns(richSoftRuns, 50, baseStyle, measure);
  assert.deepEqual(richUnbroken.lines.map(line => line.displayText), ['abcd'],
    'rich text hides an unused soft hyphen and avoids a visible hyphen when no break is taken');
  assert.deepEqual(layoutTextRuns([{ text: 'abcd' }], 40, baseStyle, measure).lines.map(line => line.displayText), ['abcd'],
    'ordinary rich text receives no new discretionary break points');
});

test('discretionary breaks compose with CJK and Thai wrapping in plain and rich text', () => {
  const cjkMeasure = value => textGraphemes(value).reduce((width, cluster) => width + (cluster === '-' ? 5 : 10), 0);
  const plainOptions = { lineHeight: 10 };
  const baseStyle = {
    fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
    lineHeight: 1, letterSpacing: 0
  };
  const richLines = (text, width, measure) => layoutTextRuns([{ text }], width, baseStyle, measure).lines.map(line => line.displayText);

  for (const [width, expected] of [[20, ['日本', '語文', '章']], [25, ['日本-', '語文', '章']]]) {
    assert.deepEqual(layoutPlainText(`日本\u00ad語文章`, width, cjkMeasure, plainOptions).lines.map(line => line.displayText), expected,
      'a CJK soft hyphen is shown only if its chosen break and hyphen fit the line');
    assert.deepEqual(richLines(`日本\u00ad語文章`, width, cjkMeasure), expected,
      'rich CJK wrapping matches the plain-text discretionary break');
  }
  for (const width of [20, 25]) {
    const baseline = layoutPlainText('日本語文章', width, cjkMeasure, plainOptions).lines.map(line => line.displayText);
    assert.deepEqual(layoutPlainText(`日本\u200b語文章`, width, cjkMeasure, plainOptions).lines.map(line => line.displayText), baseline,
      'a zero-width marker preserves natural CJK wrap opportunities');
    assert.deepEqual(richLines(`日本\u200b語文章`, width, cjkMeasure), baseline,
      'rich zero-width markers preserve natural CJK wrapping');
  }

  const thaiMeasure = value => textGraphemes(value).length * 10;
  for (const marker of ['\u00ad', '\u200b']) {
    for (const width of [30, 40]) {
      const expected = marker === '\u00ad' && width === 40 ? ['ไทย-', 'ภาษา']
        : width === 40 ? ['ไทย', 'ภาษา'] : ['ไทย', 'ภาษ', 'า'];
      const source = `ไทย${marker}ภาษา`;
      assert.deepEqual(layoutPlainText(source, width, thaiMeasure, plainOptions).lines.map(line => line.displayText), expected,
        'Thai marker breaks preserve dictionary wrapping and still handle an overwide suffix');
      assert.deepEqual(richLines(source, width, thaiMeasure), expected,
        'rich Thai marker breaks match plain wrapping and suffix fallback');
    }
  }
});

test('CJK text wraps at grapheme boundaries and observes common kinsoku punctuation rules', () => {
  const measure = value => textGraphemes(value).length * 10;
  const plain = layoutPlainText('日本語の文章', 20, measure, { lineHeight: 10 });
  assert.deepEqual(plain.lines.map(line => line.displayText), ['日本', '語の', '文章']);
  assert.ok(plain.lines.every(line => line.naturalWidth <= 20));

  const punctuation = layoutPlainText('漢、字。', 20, measure, { lineHeight: 10 });
  assert.deepEqual(punctuation.lines.map(line => line.displayText), ['漢、', '字。']);
  assert.ok(punctuation.lines.every(line => !/^[、。，．？！：；）］｝」』】]/u.test(line.displayText)),
    'a line should not begin with common CJK closing punctuation');
  assert.ok(punctuation.lines.every(line => !/[（［｛「『【]$/u.test(line.displayText)),
    'a line should not end with common CJK opening punctuation');
  assert.deepEqual(layoutPlainText('きゃく', 20, measure, { lineHeight: 10 }).lines.map(line => line.displayText), ['きゃ', 'く'],
    'Japanese small kana should not begin a new line');

  const baseStyle = { fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal', lineHeight: 1 };
  const rich = layoutTextRuns([{ text: '日本' }, { text: '語の文章', fontWeight: 700 }], 20, baseStyle,
    value => textGraphemes(value).length * 10);
  assert.deepEqual(rich.lines.map(line => line.displayText), ['日本', '語の', '文章']);
  assert.deepEqual(rich.lines[1].parts.map(part => [part.text, part.style.fontWeight]), [['語の', 700]],
    'CJK line breaking retains the style of the originating rich-text run');
});

test('Thai wrapping uses dictionary word boundaries when Intl.Segmenter is available and grapheme fallback otherwise', () => {
  const text = 'ประเทศไทยมีประชากรมาก';
  const measure = value => textGraphemes(value).length * 10;
  const base = { lineHeight: 10 };
  if (typeof Intl.Segmenter === 'function') {
    const native = layoutPlainText(text, 90, measure, base);
    assert.deepEqual(native.lines.map(line => line.displayText), ['ประเทศไทย', 'มีประชากร', 'มาก'],
      'Thai word boundaries should be preferred over arbitrary grapheme breaks');
    const rich = layoutTextRuns([{ text }], 90, {
      fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal', lineHeight: 1
    }, value => measure(value));
    assert.deepEqual(rich.lines.map(line => line.displayText), native.lines.map(line => line.displayText),
      'rich text uses the same Thai word boundaries as plain text');
  }

  const fallback = layoutPlainText(text, 90, value => textGraphemes(value, null).length * 10, {
    ...base, wordSegmenter: null, graphemeSegmenter: null
  });
  assert.deepEqual(fallback.lines.map(line => line.displayText), ['ประเทศไทย', 'มีประชากรม', 'าก']);
  assert.equal(fallback.lines.map(line => line.displayText).join(''), text, 'fallback wrapping preserves every original grapheme');
  assert.ok(fallback.lines.every(line => line.naturalWidth <= 90));
});

test('grapheme fallback keeps combining marks, emoji ZWJ/modifiers, flags, and Hangul jamo together', () => {
  const value = `A\u0301👩🏽‍💻🇹🇭\u1100\u1161\u11a8`;
  assert.deepEqual(textGraphemes(value, null), ['A\u0301', '👩🏽‍💻', '🇹🇭', '\u1100\u1161\u11a8']);

  const wrapped = layoutPlainText(value, 20, text => textGraphemes(text, null).length * 10, {
    lineHeight: 10, wordSegmenter: null, graphemeSegmenter: null
  });
  assert.equal(wrapped.lines.map(line => line.displayText).join(''), value);
  const knownClusters = new Set(textGraphemes(value, null));
  assert.ok(wrapped.lines.every(line => textGraphemes(line.displayText, null).every(cluster => knownClusters.has(cluster))),
    'soft wrapping may move complete graphemes but must not split them');

  const rich = layoutTextRuns([{ text: value }], 20, {
    fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal', lineHeight: 1
  }, text => textGraphemes(text, null).length * 10, { wordSegmenter: null, graphemeSegmenter: null });
  assert.equal(rich.lines.map(line => line.displayText).join(''), value);
  assert.ok(rich.lines.every(line => line.naturalWidth <= 20), 'rich fallback wraps only between complete graphemes');
});

test('long unbroken tokens use bounded grapheme breaks instead of a compressed single line', () => {
  const measure = value => textGraphemes(value).length * 10;
  const plain = layoutPlainText('abcdefghij', 30, measure, { lineHeight: 10 });
  assert.deepEqual(plain.lines.map(line => line.displayText), ['abc', 'def', 'ghi', 'j']);
  assert.ok(plain.lines.every(line => line.naturalWidth <= 30));

  const baseStyle = { fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal', lineHeight: 1 };
  const rich = layoutTextRuns([
    { text: 'ab' },
    { text: 'cdefghij', fontWeight: 700 }
  ], 30, baseStyle, value => textGraphemes(value).length * 10);
  assert.deepEqual(rich.lines.map(line => line.displayText), ['abc', 'def', 'ghi', 'j']);
  assert.ok(rich.lines.every(line => line.naturalWidth <= 30));
  assert.deepEqual(rich.lines[0].parts.map(part => [part.text, part.style.fontWeight]), [['ab', 400], ['c', 700]],
    'grapheme fallback keeps rich run styling intact across the inserted line break');

  const long = layoutPlainText('a'.repeat(600), 80, value => textGraphemes(value).length * 10, { lineHeight: 10 });
  assert.equal(long.lines.map(line => line.displayText).join(''), 'a'.repeat(600));
  assert.ok(long.lines.every(line => line.naturalWidth <= 80), 'long fallback work stays split into bounded-width lines');
});

test('rich text treats CR, LF, and CRLF as single paragraph breaks across run boundaries', () => {
  const plain = layoutPlainText('first\r\nsecond\rthird', Infinity, value => [...String(value)].length * 5, {
    lineHeight: 10, paragraphSpacing: 3
  });
  assert.deepEqual(plain.lines.map(({ displayText, y }) => ({ displayText, y })), [
    { displayText: 'first', y: 0 }, { displayText: 'second', y: 13 }, { displayText: 'third', y: 26 }
  ]);

  const result = layoutTextRuns([{ text: 'first\r' }, { text: '\nsecond\rthird' }], Infinity, {
    fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
    lineHeight: 1, letterSpacing: 0, paragraphSpacing: 3
  }, value => [...String(value)].length * 5);
  assert.deepEqual(result.lines.map(({ displayText, paragraphIndex, y }) => ({ displayText, paragraphIndex, y })), [
    { displayText: 'first', paragraphIndex: 0, y: 0 },
    { displayText: 'second', paragraphIndex: 1, y: 13 },
    { displayText: 'third', paragraphIndex: 2, y: 26 }
  ]);
});

test('justified plain and rich paragraphs fill only soft-wrapped lines and leave paragraph endings natural', () => {
  const measure = value => [...String(value)].length * 5;
  const plain = layoutPlainText('aa bb cc\ndd ee', 35, measure, { lineHeight: 10, align: 'justify' });
  assert.deepEqual(plain.lines.map(({ displayText, width, naturalWidth, justify, justificationExtraSpace }) => ({
    displayText, width, naturalWidth, justify, justificationExtraSpace
  })), [
    { displayText: 'aa bb', width: 35, naturalWidth: 25, justify: true, justificationExtraSpace: 10 },
    { displayText: 'cc', width: 10, naturalWidth: 10, justify: false, justificationExtraSpace: 0 },
    { displayText: 'dd ee', width: 25, naturalWidth: 25, justify: false, justificationExtraSpace: 0 }
  ]);

  const rich = layoutTextRuns([{ text: 'aa ' }, { text: 'bb cc\ndd ee' }], 35, {
    fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
    lineHeight: 1, letterSpacing: 0, align: 'justify'
  }, value => [...String(value)].length * 5);
  assert.deepEqual(rich.lines.map(({ displayText, width, naturalWidth, justify, justificationExtraSpace }) => ({
    displayText, width, naturalWidth, justify, justificationExtraSpace
  })), [
    { displayText: 'aa bb', width: 35, naturalWidth: 25, justify: true, justificationExtraSpace: 10 },
    { displayText: 'cc', width: 10, naturalWidth: 10, justify: false, justificationExtraSpace: 0 },
    { displayText: 'dd ee', width: 25, naturalWidth: 25, justify: false, justificationExtraSpace: 0 }
  ]);

  const repeatedSpaces = layoutPlainText('aa   bb cc', 45, measure, { lineHeight: 10, align: 'justify' });
  assert.equal(repeatedSpaces.lines[0].width, 45);
  assert.ok(Math.abs(repeatedSpaces.lines[0].justificationExtraSpace - 10 / 3) < 1e-10,
    'expansion is divided across each preserved whitespace grapheme');
});

test('paragraph alignment overrides the layer alignment for plain and rich text layout', () => {
  const measure = value => [...String(value)].length * 5;
  const paragraphStyles = [
    { align: 'center' },
    { align: 'justify' },
    { align: 'left' }
  ];
  const plain = layoutPlainText('aa bb cc\naa bb cc\naa bb', 35, measure, {
    lineHeight: 10, align: 'right', paragraphStyles
  });
  assert.deepEqual(plain.lines.map(({ paragraphIndex, align, justify }) => [paragraphIndex, align, justify]), [
    [0, 'center', false], [0, 'center', false],
    [1, 'justify', true], [1, 'justify', false],
    [2, 'left', false]
  ]);
  assert.equal(layoutPlainText('aa bb\ncc', 35, measure, { lineHeight: 10, align: 'center' }).lines[0].align, 'center',
    'paragraphs without an override inherit the layer alignment');

  const rich = layoutTextRuns([{ text: 'aa bb cc\naa bb cc\naa bb' }], 35, {
    fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 400, fontStyle: 'normal',
    lineHeight: 1, letterSpacing: 0, align: 'right', paragraphStyles
  }, measure);
  assert.deepEqual(rich.lines.map(({ paragraphIndex, align, justify }) => [paragraphIndex, align, justify]), [
    [0, 'center', false], [0, 'center', false],
    [1, 'justify', true], [1, 'justify', false],
    [2, 'left', false]
  ]);
});

test('paragraph spacing contributes to auto height and indentation reduces first-line wrap width', () => {
  const node = createNode('text', {
    text: 'aa bb\ncc dd\nee ff', width: 50, height: 20,
    fontSize: 10, lineHeight: 1.2, paragraphSpacing: 8, firstLineIndent: 10,
    textFit: 'auto-height'
  });
  const layout = layoutPlainText(node.text, node.width, value => [...String(value)].length * 10 + Math.max(0, [...String(value)].length - 1) * 5, {
    lineHeight: 12, paragraphSpacing: node.paragraphSpacing, firstLineIndent: node.firstLineIndent
  });
  assert.deepEqual(layout.lines.map(line => [line.displayText, line.indent, line.y]), [
    ['aa', 10, 0], ['bb', 0, 12], ['cc', 10, 32], ['dd', 0, 44], ['ee', 10, 64], ['ff', 0, 76]
  ]);
  assert.equal(calculateTextBox(context(), node).height, 92, 'auto height includes both paragraph gaps and wrapped lines');
});

test('rich text auto-sizing uses each run font, wrapping, and maximum line metrics', () => {
  const node = createNode('text', {
    text: 'one two', width: 70, height: 20, fontSize: 10, lineHeight: 1,
    textFit: 'auto-height',
    textRuns: [
      { text: 'one ', fontSize: 20 },
      { text: 'two', fontSize: 30, lineHeight: 1.5, fontWeight: 700 }
    ]
  });
  const ctx = fontAwareContext();
  assert.deepEqual(calculateTextBox(ctx, node), { width: 70, height: 69 });
  assert.equal(ctx.font, '400 10px Inter, Arial, sans-serif', 'rich measurement restores the node-wide font after measuring overrides');

  node.textFit = 'auto-width';
  assert.deepEqual(calculateTextBox(fontAwareContext(), node), { width: 87, height: 49 });
});

test('rich auto-sizing includes paragraph spacing and indented mixed-run line metrics', () => {
  const node = createNode('text', {
    text: 'ab\nc', width: 50, height: 20, fontSize: 10, lineHeight: 1,
    paragraphSpacing: 7, firstLineIndent: 12, textFit: 'auto-width',
    textRuns: [{ text: 'ab', fontSize: 20 }, { text: '\nc', fontSize: 30 }]
  });
  const ctx = fontAwareContext();
  assert.deepEqual(calculateTextBox(ctx, node), { width: 34, height: 61 });

  node.textFit = 'auto-height';
  node.width = 40;
  assert.deepEqual(calculateTextBox(ctx, node), { width: 40, height: 61 });
});

test('rich text sizing falls back to the legacy uniform path when runs do not match text', () => {
  const plain = createNode('text', { text: 'one two', width: 30, fontSize: 10, textFit: 'auto-height' });
  const mismatched = createNode('text', { ...plain, textRuns: [{ text: 'other text' }] });
  assert.deepEqual(calculateTextBox(context(), mismatched), calculateTextBox(context(), plain));
});

test('text case transformation is Unicode aware and feeds auto sizing', () => {
  assert.equal(transformTextCase('hello world', 'uppercase'), 'HELLO WORLD');
  assert.equal(transformTextCase('HELLO WORLD', 'lowercase'), 'hello world');
  assert.equal(transformTextCase("élan café don't", 'capitalize'), "Élan Café Don't");
  assert.equal(transformTextCase('hello world', 'none'), 'hello world');

  const node = createNode('text', { text: 'straße', textCase: 'uppercase', textFit: 'auto-width', fontSize: 10, lineHeight: 1 });
  assert.equal(calculateTextBox(context(), node).width, 72, 'expanded uppercase glyphs are included in the measured text width');
});

test('text edits and typography resizing preserve centered and right SVG text anchors', () => {
  for (const [svgAnchor, align] of [['middle', 'center'], ['end', 'right']]) {
    const imported = importSvgToLayers(`<svg width="300" height="160"><text x="160" y="60" text-anchor="${svgAnchor}"
      dominant-baseline="text-before-edge" font-family="Arial" font-size="20" transform="rotate(25 20 30)">A deliberately long imported SVG heading</text></svg>`);
    const node = imported.nodes[0].children.find(child => child.type === 'text');
    assert.equal(node.align, align);
    const angle = 25 * Math.PI / 180;
    const expectedAnchor = {
      x: 20 + Math.cos(angle) * 140 - Math.sin(angle) * 30,
      y: 30 + Math.sin(angle) * 140 + Math.cos(angle) * 30
    };
    const importedAnchor = alignedTopAnchor(node);
    assert.ok(Math.abs(importedAnchor.x - expectedAnchor.x) < 1e-8 && Math.abs(importedAnchor.y - expectedAnchor.y) < 1e-8,
      `${align} SVG anchor should start at its transformed x/y coordinate`);

    for (const edit of [
      () => { node.text = 'Short'; },
      () => { node.fontSize = 32; },
      () => { node.letterSpacing = 5; }
    ]) {
      const before = textGeometry(node);
      const anchorBefore = alignedTopAnchor(node);
      edit();
      const size = calculateTextBox(fontAwareContext(), node);
      node.width = size.width;
      node.height = size.height;
      assert.equal(preserveAutoWidthTextAnchor(node, before, textGeometry(node)), true);
      const anchorAfter = alignedTopAnchor(node);
      assert.ok(Math.abs(anchorAfter.x - anchorBefore.x) < 1e-8 && Math.abs(anchorAfter.y - anchorBefore.y) < 1e-8,
        `${align} SVG text anchor should survive text and typography edits`);
      assert.ok(Math.abs(anchorAfter.x - expectedAnchor.x) < 1e-8 && Math.abs(anchorAfter.y - expectedAnchor.y) < 1e-8,
        `${align} SVG text anchor should remain at its original transformed x/y coordinate`);
    }
  }
});

test('text resize modes are valid only on text layers and persist in design documents', () => {
  const document = createDocument();
  const text = createNode('text', { textFit: 'auto-width' });
  addNode(document, text);
  assert.equal(validateDocument(document), true);
  const invalid = structuredClone(document);
  invalid.pages[0].children[0].textFit = 'content-fit';
  assert.throws(() => validateDocument(invalid), /Invalid text resize mode/);
  const nonText = createNode('rectangle', { textFit: 'fixed' });
  addNode(document, nonText);
  assert.throws(() => validateDocument(document), /Invalid text resize mode/);
});

test('text case and decoration accept only supported values on text layers', () => {
  const document = createDocument();
  const text = createNode('text', { textCase: 'uppercase', textDecoration: 'underline' });
  addNode(document, text);
  assert.equal(validateDocument(document), true);
  for (const [property, invalidValue] of [['textCase', 'title-case'], ['textDecoration', 'overline']]) {
    const invalid = structuredClone(document);
    invalid.pages[0].children[0][property] = invalidValue;
    assert.throws(() => validateDocument(invalid), property === 'textCase' ? /Invalid text case/ : /Invalid text decoration/);
  }
  const nonText = createNode('rectangle', { textDecoration: 'underline' });
  addNode(document, nonText);
  assert.throws(() => validateDocument(document), /Invalid text decoration/);
});

test('text vertical alignment validates and remains layer-local when applying reusable text styles', () => {
  const document = createDocument();
  const text = createNode('text', { verticalAlign: 'bottom' });
  addNode(document, text);
  assert.equal(text.verticalAlign, 'bottom');
  assert.equal(validateDocument(document), true);

  const oldDocument = structuredClone(document);
  delete oldDocument.pages[0].children[0].verticalAlign;
  assert.equal(validateDocument(oldDocument), true, 'older files without the optional alignment field remain valid');

  const invalid = structuredClone(document);
  invalid.pages[0].children[0].verticalAlign = 'center';
  assert.throws(() => validateDocument(invalid), /Invalid text vertical alignment/);
  addNode(document, createNode('rectangle', { verticalAlign: 'bottom' }));
  assert.throws(() => validateDocument(document), /Invalid text vertical alignment/);
  document.pages[0].children.pop();

  const style = createTypographyStyle(document, text.id, 'Bottom text');
  assert.equal(style.verticalAlign, undefined, 'new typography styles do not capture layer-local vertical alignment');
  text.verticalAlign = 'top';
  assert.equal(applyTypographyStyle(document, text.id, style.id), true);
  assert.equal(text.verticalAlign, 'top', 'applying a new style preserves the layer alignment');

  text.verticalAlign = 'bottom';
  assert.equal(validateDocument(document), true, 'older typography styles may omit vertical alignment');
  assert.equal(applyTypographyStyle(document, text.id, style.id), true);
  assert.equal(text.verticalAlign, 'bottom', 'a style without the optional alignment field leaves the current value unchanged');

  const legacyStyle = { ...style, id: 'legacy-style', verticalAlign: 'middle', align: 'right', color: '#123456' };
  document.typographyStyles.push(legacyStyle);
  assert.equal(applyTypographyStyle(document, text.id, legacyStyle.id), true);
  assert.equal(text.verticalAlign, 'middle', 'legacy style alignment remains readable');
  assert.equal(text.align, 'right');
  assert.equal(text.color, '#123456');
});

test('text vertical alignment can be stored as an instance override for a nested component label', () => {
  const document = createDocument();
  const master = createNode('frame', { name: 'Button' });
  const label = createNode('text', { name: 'Label', text: 'Continue' });
  addNode(document, master); addNode(document, label, { parentId: master.id });
  const component = createComponent(document, master.id, 'Button');
  const instance = createComponentInstance(document, component.id);
  const instanceNode = findNode(document, instance.id).node;
  instanceNode.componentOverrides[label.id] = { verticalAlign: 'middle' };
  assert.equal(validateDocument(document), true);

  instanceNode.componentOverrides[label.id].verticalAlign = 'center';
  assert.throws(() => validateDocument(document), /Invalid component text vertical alignment override/);
});
