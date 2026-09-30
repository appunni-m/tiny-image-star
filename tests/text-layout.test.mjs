import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, applyTypographyStyle, createComponent, createComponentInstance, createDocument, createNode, createTypographyStyle, findNode, validateDocument } from '../src/model.js';
import { calculateTextBox, layoutPlainText, layoutTextRuns, preserveAutoWidthTextAnchor, transformTextCase } from '../src/text-layout.js';
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

test('text vertical alignment validates, defaults old documents to top, and round-trips in saved text styles', () => {
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
  assert.equal(style.verticalAlign, 'bottom');
  text.verticalAlign = 'top';
  assert.equal(applyTypographyStyle(document, text.id, style.id), true);
  assert.equal(text.verticalAlign, 'bottom');

  delete style.verticalAlign;
  text.verticalAlign = 'bottom';
  assert.equal(validateDocument(document), true, 'older typography styles may omit vertical alignment');
  assert.equal(applyTypographyStyle(document, text.id, style.id), true);
  assert.equal(text.verticalAlign, 'top', 'applying a legacy text style uses the historical top-aligned default');
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
