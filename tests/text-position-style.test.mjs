import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, applyTypographyStyle, createComponent, createComponentInstance, createDocument, createNode, createTypographyStyle, parseDocument, serializeDocument, validateDocument } from '../src/model.js';
import { isValidTextPosition, TEXT_POSITIONS } from '../src/text-position-style.js';
import { transformTextRunsInRange } from '../src/text-run-editing.js';
import { summarizeTextRunRange } from '../src/text-run-selection.js';

test('semantic text positions are a strict optional enum', () => {
  assert.deepEqual(TEXT_POSITIONS, ['normal', 'superscript', 'subscript']);
  assert.ok(TEXT_POSITIONS.every(isValidTextPosition));
  for (const value of ['SUPER', 'superscript ', 'small-caps', null, 1]) assert.equal(isValidTextPosition(value), false);
});

test('text positions persist through layers, rich runs, typography styles, component overrides, and reload', () => {
  const document = createDocument();
  const text = createNode('text', { text: 'H₂O', textPosition: 'normal', textRuns: [
    { text: 'H', textPosition: 'normal' }, { text: '₂', textPosition: 'subscript' }, { text: 'O' }
  ] });
  addNode(document, text);
  const style = createTypographyStyle(document, text.id, 'Positioned');
  assert.equal(style.textPosition, 'normal');
  const output = createNode('text', { text: 'output', textPosition: 'subscript' });
  addNode(document, output);
  assert.equal(applyTypographyStyle(document, output.id, style.id), true);
  assert.equal(output.textPosition, 'normal');

  const plain = createNode('text', { text: 'plain' });
  addNode(document, plain);
  const plainStyle = createTypographyStyle(document, plain.id, 'Plain');
  const previouslyPositioned = createNode('text', { text: 'reset', textPosition: 'superscript' });
  addNode(document, previouslyPositioned);
  applyTypographyStyle(document, previouslyPositioned.id, plainStyle.id);
  assert.equal(previouslyPositioned.textPosition, undefined, 'applying a style without position clears stale positioning');

  const component = createComponent(document, text.id);
  const instance = createComponentInstance(document, component.id);
  instance.componentOverrides[text.id] = { textPosition: 'subscript' };
  validateDocument(document);
  const restored = parseDocument(serializeDocument(document));
  const restoredText = restored.pages[0].children.find(node => node.id === text.id);
  assert.equal(restoredText.textPosition, 'normal');
  assert.equal(restoredText.textRuns[1].textPosition, 'subscript');
  assert.deepEqual(instance.componentOverrides[text.id], { textPosition: 'subscript' });
});

test('model rejects unknown text positions at each persistence surface', () => {
  const fixture = () => {
    const document = createDocument();
    const text = createNode('text', { text:'x' }); addNode(document, text);
    const style = createTypographyStyle(document, text.id, 'Positioned');
    const component = createComponent(document, text.id);
    const instance = createComponentInstance(document, component.id);
    return { document, text, style, instance };
  };
  let value = fixture(); value.text.textPosition = 'raised';
  assert.throws(() => validateDocument(value.document), /text position/iu);
  value = fixture(); value.text.textRuns = [{ text:'x', textPosition:'raised' }];
  assert.throws(() => validateDocument(value.document), /text runs/iu);
  value = fixture(); value.style.textPosition = 'raised';
  assert.throws(() => validateDocument(value.document), /text style/iu);
  value = fixture(); value.instance.componentOverrides[value.text.id] = { textPosition:'raised' };
  assert.throws(() => validateDocument(value.document), /component text position/iu);
});

test('rich-run editing and mixed selection preserve semantic position', () => {
  const runs = [{ text: 'H2', textPosition: 'normal' }, { text: 'O', textPosition: 'subscript' }];
  assert.deepEqual(transformTextRunsInRange(runs, 1, 2, 'textPosition', 'superscript'), [
    { text: 'H', textPosition: 'normal' }, { text: '2', textPosition: 'superscript' }, { text: 'O', textPosition: 'subscript' }
  ]);
  assert.equal(summarizeTextRunRange(runs, 0, 3, run => run.textPosition ?? 'normal').mixed, true);
});
