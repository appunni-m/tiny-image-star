import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { History } from '../src/history.js';
import { createDocument, createNode, validateDocument } from '../src/model.js';
import {
  findPageTextMatches,
  nextTextMatchIndex,
  planPageTextReplacement,
  replaceTextRunRange,
  textReplacementUnavailableReason
} from '../src/text-find-replace.js';

function fixture() {
  const document = createDocument();
  const page = document.pages[0];
  return { document, page };
}

function addText(page, options = {}) {
  const node = createNode('text', { x: 0, y: 0, width: 220, height: 48, ...options });
  page.children.push(node);
  return node;
}

test('find is literal, Unicode case-insensitive by default, and confined to the selected page', () => {
  const { document, page } = fixture();
  const otherPage = { id: 'other-page', name: 'Other', children: [], guides: [] };
  document.pages.push(otherPage);
  const one = addText(page, { id: 'one', text: 'A [word] 😀 WORD' });
  addText(otherPage, { id: 'other', text: '[word]' });

  assert.deepEqual(findPageTextMatches(document, page.id, ''), []);
  assert.deepEqual(findPageTextMatches(document, 'missing-page', 'word'), []);
  assert.deepEqual(findPageTextMatches(document, page.id, '[word]').map(match => [match.nodeId, match.start, match.end]), [
    ['one', 2, 8]
  ]);
  assert.deepEqual(findPageTextMatches(document, page.id, 'word').map(match => [match.start, match.text]), [
    [3, 'word'], [12, 'WORD']
  ]);
  assert.deepEqual(findPageTextMatches(document, page.id, 'word', { caseSensitive: true }).map(match => match.text), ['word']);
  assert.equal(one.text, 'A [word] 😀 WORD');
});

test('find navigation advances and wraps in both directions, including an empty result set', () => {
  const matches = [{}, {}, {}];
  assert.equal(nextTextMatchIndex([], -1, 1), -1);
  assert.equal(nextTextMatchIndex(matches, -1, 1), 0);
  assert.equal(nextTextMatchIndex(matches, -1, -1), 2);
  assert.equal(nextTextMatchIndex(matches, 2, 1), 0);
  assert.equal(nextTextMatchIndex(matches, 0, -1), 2);
});

test('find returns explicit read-only reasons for text variables, components, and locked ancestry', () => {
  const { document, page } = fixture();
  const bound = addText(page, { id: 'bound', text: 'Bound copy', variableBindings: { text: 'copy' } });
  const component = createNode('frame', { id: 'component', name: 'Master', isComponent: true, children: [] });
  const componentText = createNode('text', { id: 'component-text', text: 'Master copy' });
  component.children.push(componentText);
  page.children.push(component);
  const locked = createNode('frame', { id: 'locked', locked: true, children: [] });
  const lockedText = createNode('text', { id: 'locked-text', text: 'Locked copy' });
  locked.children.push(lockedText);
  page.children.push(locked);

  const reasons = new Map(findPageTextMatches(document, page.id, 'copy').map(match => [match.nodeId, match.readOnlyReason]));
  assert.match(reasons.get(bound.id), /linked to a variable/i);
  assert.match(reasons.get(componentText.id), /component or instance/i);
  assert.match(reasons.get(lockedText.id), /locked/i);
  assert.equal(textReplacementUnavailableReason(componentText, [component]), reasons.get(componentText.id));
});

test('resolved derived text is findable but cannot be written back into a different stored value', () => {
  const { document, page } = fixture();
  addText(page, { id: 'derived', text: 'template' });
  const resolveText = node => node.id === 'derived' ? 'resolved copy' : node.text;
  const matches = findPageTextMatches(document, page.id, 'copy', { resolveText });
  assert.equal(matches.length, 1);
  assert.match(matches[0].readOnlyReason, /derived from another value/i);
  const plan = planPageTextReplacement(document, page.id, 'copy', 'new label', { resolveText });
  assert.equal(plan.document, null);
  assert.equal(plan.replacedCount, 0);
  assert.equal(document.pages[0].children[0].text, 'template');
});

test('replace-one and replace-all prepare detached, single-page document updates', () => {
  const { document, page } = fixture();
  const first = addText(page, { id: 'first', text: 'Blue blue BLUE' });
  const second = addText(page, { id: 'second', text: 'Blue outside' });
  const otherPage = { id: 'other-page', name: 'Other', children: [], guides: [] };
  otherPage.children.push(createNode('text', { id: 'other', text: 'Blue' }));
  document.pages.push(otherPage);
  const matches = findPageTextMatches(document, page.id, 'blue');

  const one = planPageTextReplacement(document, page.id, 'blue', 'Teal', { targetMatch: matches[1] });
  assert.equal(one.replacedCount, 1);
  assert.equal(one.document.pages[0].children[0].text, 'Blue Teal BLUE');
  assert.equal(one.document.pages[0].children[1].text, 'Blue outside');
  assert.equal(one.document.pages[1].children[0].text, 'Blue');

  const all = planPageTextReplacement(document, page.id, 'blue', 'Teal');
  assert.equal(all.replacedCount, 4);
  assert.equal(all.document.pages[0].children[0].text, 'Teal Teal Teal');
  assert.equal(all.document.pages[0].children[1].text, 'Teal outside');
  assert.equal(document.pages[0].children[0], first);
  assert.equal(document.pages[0].children[1], second);
  assert.equal(document.pages[0].children[0].text, 'Blue blue BLUE');
  const caseFix = planPageTextReplacement(document, page.id, 'blue', 'BLUE');
  assert.equal(caseFix.replacedCount, 3, 'exactly unchanged matches are not counted as replacements');
  assert.equal(caseFix.document.pages[0].children[0].text, 'BLUE BLUE BLUE');
  const noOp = planPageTextReplacement(document, page.id, 'Blue', 'Blue', { caseSensitive: true });
  assert.equal(noOp.replacedCount, 0);
  assert.equal(noOp.document, null);
  assert.equal(validateDocument(all.document), true);
});

test('replace-all skips protected matches with their reasons and reports only writable replacements', () => {
  const { document, page } = fixture();
  addText(page, { id: 'editable', text: 'copy' });
  addText(page, { id: 'bound', text: 'copy', variableBindings: { text: 'copy' } });
  const instance = createNode('frame', { id: 'instance', isInstance: true, children: [] });
  instance.children.push(createNode('text', { id: 'instance-text', text: 'copy' }));
  page.children.push(instance);

  const plan = planPageTextReplacement(document, page.id, 'copy', 'art');
  assert.equal(plan.replacedCount, 1);
  assert.deepEqual(plan.changedNodeIds, ['editable']);
  assert.equal(plan.skippedMatches.length, 2);
  assert.match(plan.skippedMatches[0].readOnlyReason, /variable/i);
  assert.match(plan.skippedMatches[1].readOnlyReason, /component or instance/i);
  assert.equal(plan.document.pages[0].children[0].text, 'art');
  assert.equal(plan.document.pages[0].children[1].text, 'copy');
  assert.equal(plan.document.pages[0].children[2].children[0].text, 'copy');
});

test('replacements preserve rich-text run styling across a match spanning multiple runs', () => {
  const sourceText = 'pre ABC post';
  const runs = [
    { text: 'pre A', fontWeight: 400 },
    { text: 'BC', fontWeight: 700, color: '#ff0000' },
    { text: ' post', fontStyle: 'italic' }
  ];
  const result = replaceTextRunRange(runs, sourceText, 4, 7, 'XY');
  assert.deepEqual(result, [
    { text: 'pre XY', fontWeight: 400 },
    { text: ' post', fontStyle: 'italic' }
  ]);
  assert.equal(result.map(run => run.text).join(''), 'pre XY post');
  assert.equal(replaceTextRunRange(runs, 'mismatch', 0, 1, 'x'), null);
});

test('planned replacements persist rich runs and refuse inconsistent run data', () => {
  const { document, page } = fixture();
  const rich = addText(page, {
    id: 'rich', text: 'Hello world',
    textRuns: [{ text: 'Hello ', fontWeight: 400 }, { text: 'world', fontWeight: 700, color: '#2255cc' }]
  });
  const plan = planPageTextReplacement(document, page.id, 'world', 'team');
  const updated = plan.document.pages[0].children[0];
  assert.equal(updated.text, 'Hello team');
  assert.deepEqual(updated.textRuns, [
    { text: 'Hello ', fontWeight: 400 }, { text: 'team', fontWeight: 700, color: '#2255cc' }
  ]);
  assert.equal(validateDocument(plan.document), true);
  assert.equal(rich.text, 'Hello world');

  const inconsistent = addText(page, { id: 'inconsistent', text: 'copy', textRuns: [{ text: 'other', fontWeight: 700 }] });
  const matches = findPageTextMatches(document, page.id, 'copy');
  assert.match(matches.find(match => match.nodeId === inconsistent.id).readOnlyReason, /rich-text data does not match/i);
  const refused = planPageTextReplacement(document, page.id, 'copy', 'art');
  assert.equal(refused.replacedCount, 0);
  assert.equal(refused.document, null);
});

test('replace-all uses original non-overlapping matches, supports deletion and remaps paragraph styles', () => {
  const { document, page } = fixture();
  const node = addText(page, {
    id: 'paragraphs',
    text: 'red\nred\nend',
    paragraphStyles: [
      { listStyle: 'bulleted', listLevel: 0 },
      { listStyle: 'numbered', listLevel: 0 },
      { listStyle: 'none', listLevel: 0 }
    ]
  });
  const plan = planPageTextReplacement(document, page.id, 'red', 'new\ncopy');
  const updated = plan.document.pages[0].children[0];
  assert.equal(updated.text, 'new\ncopy\nnew\ncopy\nend');
  assert.equal(updated.paragraphStyles.length, 5);
  assert.deepEqual(updated.paragraphStyles.slice(0, 2), [
    { listStyle: 'bulleted', listLevel: 0 }, { listStyle: 'bulleted', listLevel: 0 }
  ]);
  assert.deepEqual(updated.paragraphStyles.slice(2, 4), [
    { listStyle: 'numbered', listLevel: 0 }, { listStyle: 'numbered', listLevel: 0 }
  ]);
  assert.equal(updated.paragraphStyles[4].listStyle, 'none');

  const newlineMatches = findPageTextMatches(document, page.id, 'red\n');
  assert.deepEqual(findPageTextMatches(document, page.id, 'red\r\n').map(match => match.start), newlineMatches.map(match => match.start));
  const deletion = planPageTextReplacement(document, page.id, 'red\n', '', { targetMatch: newlineMatches[0] });
  const deleted = deletion.document.pages[0].children[0];
  assert.equal(deleted.text, 'red\nend');
  assert.equal(deleted.paragraphStyles[0].listStyle, 'numbered', 'a surviving suffix takes its original paragraph style');
  assert.equal(node.text, 'red\nred\nend');
});

test('a multi-layer replace-all result is one undoable design change', () => {
  const { document, page } = fixture();
  addText(page, { id: 'one', text: 'replace me' });
  addText(page, { id: 'two', text: 'and replace me' });
  const plan = planPageTextReplacement(document, page.id, 'replace me', 'updated');
  assert.equal(plan.replacedCount, 2);
  const history = new History();
  history.checkpoint(document, 'Replace all text');
  assert.equal(history.undoStack.length, 1);
  const restored = history.undo(plan.document);
  assert.deepEqual(restored, document);
  assert.equal(history.redoStack.length, 1);
});

test('the editor exposes Find and Replace without turning action search into document search', async () => {
  const [html, main] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8')
  ]);
  assert.match(html, /id="find-text-button"[^>]*aria-label="Find and replace text"/);
  assert.match(html, /id="text-find-replace-dialog"[^>]*aria-modal="false"/);
  assert.match(html, /id="text-find-query"/);
  assert.match(html, /id="text-replace-query"/);
  assert.match(html, /Variable-linked, component, instance, and locked text is shown as read-only\./);
  assert.match(html, /data-quick-action-query="find and replace text">Find and replace text<\/button>/);
  assert.match(main, /id: 'find-replace-text', label: 'Find and replace text'/);
  assert.match(main, /\$\('#text-find-next'\)\.addEventListener\('click', \(\) => navigateTextFind\(1\)\)/);
  assert.match(main, /\$\('#text-find-previous'\)\.addEventListener\('click', \(\) => navigateTextFind\(-1\)\)/);
  assert.match(main, /\$\('#text-replace-current'\)\.addEventListener\('click', replaceCurrentTextMatch\)/);
  assert.match(main, /\$\('#text-replace-all'\)\.addEventListener\('click', replaceAllTextMatches\)/);
  assert.match(main, /key === 'f'[\s\S]{0,120}openTextFindReplace\(\)/);
});
