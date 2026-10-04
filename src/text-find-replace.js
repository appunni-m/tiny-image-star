const textRunStyleKeys = new Set([
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontAxes', 'fontFeatures', 'lineHeight', 'lineHeightUnit',
  'letterSpacing', 'color', 'textDecoration', 'baselineShift'
]);

function walkPage(nodes, visitor, parents = []) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') continue;
    visitor({ node, parents });
    walkPage(node.children, visitor, [...parents, node]);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function textReplacementUnavailableReason(node, parents = []) {
  if (node?.variableBindings?.text) return 'Text is linked to a variable. Edit the variable value instead.';
  if (node?.componentSourceId || node?.isComponent || node?.isInstance
    || parents.some(parent => parent?.componentSourceId || parent?.isComponent || parent?.isInstance)) {
    return 'Text belongs to a component or instance. Edit its source or exposed property instead.';
  }
  if (node?.locked || parents.some(parent => parent?.locked)) return 'This text layer or one of its parent layers is locked.';
  return '';
}

/** Find literal matches only inside the requested page. Indices are UTF-16 offsets, like the editor. */
export function findPageTextMatches(document, pageId, query, {
  caseSensitive = false,
  resolveText = node => node.text
} = {}) {
  const literal = String(query ?? '').replace(/\r\n?/gu, '\n');
  if (!literal) return [];
  const page = document?.pages?.find(candidate => candidate.id === pageId);
  if (!page || typeof resolveText !== 'function') return [];
  const expression = new RegExp(escapeRegExp(literal), caseSensitive ? 'gu' : 'giu');
  const matches = [];
  walkPage(page.children, ({ node, parents }) => {
    if (node.type !== 'text') return;
    let text;
    try { text = String(resolveText(node, document) ?? ''); }
    catch { return; }
    const storedText = String(node.text ?? '');
    const textRunsMatch = !Array.isArray(node.textRuns)
      || node.textRuns.map(run => String(run?.text ?? '')).join('') === storedText;
    const readOnlyReason = textReplacementUnavailableReason(node, parents)
      || (text !== storedText ? 'Resolved text is derived from another value and cannot be replaced here.' : '')
      || (!textRunsMatch ? 'Rich-text data does not match this layer, so replacement is unavailable until it is repaired.' : '');
    expression.lastIndex = 0;
    let found;
    while ((found = expression.exec(text))) {
      matches.push({
        pageId,
        nodeId: node.id,
        start: found.index,
        end: found.index + found[0].length,
        text: found[0],
        readOnlyReason
      });
      // Queries cannot be empty, but keep progress explicit for future regex support.
      if (found[0].length === 0) expression.lastIndex += 1;
    }
  });
  return matches;
}

/** Cycle through ordered page matches; without an active match, begin at the requested edge. */
export function nextTextMatchIndex(matches, currentIndex, direction = 1) {
  if (!Array.isArray(matches) || !matches.length) return -1;
  const step = Number(direction) < 0 ? -1 : 1;
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= matches.length) {
    return step > 0 ? 0 : matches.length - 1;
  }
  return (currentIndex + step + matches.length) % matches.length;
}

function shallowEqualStyle(left, right) {
  const leftKeys = Object.keys(left).filter(key => key !== 'text');
  const rightKeys = Object.keys(right).filter(key => key !== 'text');
  return leftKeys.length === rightKeys.length && leftKeys.every(key => {
    if (!Object.hasOwn(right, key)) return false;
    const a = left[key]; const b = right[key];
    return a === b || (a && b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
  });
}

function appendRun(target, source, value) {
  if (!value) return;
  const run = { ...source, text: value };
  const previous = target.at(-1);
  if (previous && shallowEqualStyle(previous, run)) previous.text += value;
  else target.push(run);
}

/** Replace a UTF-16 range; inserted characters inherit the first matched character's run style. */
export function replaceTextRunRange(runs, sourceText, start, end, replacement) {
  if (!Array.isArray(runs) || runs.map(run => String(run?.text ?? '')).join('') !== sourceText
    || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > sourceText.length) return null;
  const inserted = String(replacement ?? '').replace(/\r\n?/gu, '\n');
  const normalizedRuns = runs.map(run => ({ ...run, text: String(run?.text ?? '') }));
  let cursor = 0;
  let replacementStyle = {};
  const before = [];
  const after = [];
  for (const run of normalizedRuns) {
    const runStart = cursor;
    const runEnd = runStart + run.text.length;
    if (start >= runStart && start < runEnd) {
      replacementStyle = Object.fromEntries(Object.entries(run).filter(([key]) => textRunStyleKeys.has(key)));
    }
    const beforeEnd = Math.min(runEnd, start);
    if (beforeEnd > runStart) appendRun(before, run, run.text.slice(0, beforeEnd - runStart));
    const afterStart = Math.max(runStart, end);
    if (runEnd > afterStart) appendRun(after, run, run.text.slice(afterStart - runStart));
    cursor = runEnd;
  }
  const result = [...before];
  appendRun(result, replacementStyle, inserted);
  result.push(...after);
  return result;
}

function paragraphIndexAt(text, offset) {
  let index = 0;
  for (let cursor = 0; cursor < Math.min(text.length, offset); cursor += 1) if (text[cursor] === '\n') index += 1;
  return index;
}

function replaceParagraphRange(text, paragraphStyles, start, end, replacement) {
  if (!Array.isArray(paragraphStyles)) return null;
  const startParagraph = paragraphIndexAt(text, start);
  // A match ending just after a paragraph separator also consumes the following
  // paragraph's style because its remaining text joins the replaced paragraph.
  const endParagraph = paragraphIndexAt(text, end);
  const endOfEndingParagraph = text.indexOf('\n', end);
  const endingParagraphHasSuffix = end < (endOfEndingParagraph < 0 ? text.length : endOfEndingParagraph);
  const startOfStartingParagraph = text.lastIndexOf('\n', start - 1) + 1;
  const startingParagraphHasPrefix = start > startOfStartingParagraph;
  const replacementUsesEndingStyle = !startingParagraphHasPrefix && !replacement
    && endParagraph > startParagraph && endingParagraphHasSuffix;
  const styleParagraph = replacementUsesEndingStyle ? endParagraph : startParagraph;
  const startStyle = paragraphStyles[styleParagraph] || { listStyle: 'none', listLevel: 0 };
  const insertedParagraphs = replacement.split('\n').length;
  const nextText = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
  const nextStyles = [
    ...paragraphStyles.slice(0, startParagraph),
    ...Array.from({ length: insertedParagraphs }, () => structuredClone(startStyle)),
    ...paragraphStyles.slice(endParagraph + 1)
  ];
  const paragraphCount = nextText.split('\n').length;
  while (nextStyles.length < paragraphCount) nextStyles.push({ listStyle: 'none', listLevel: 0 });
  return nextStyles.slice(0, paragraphCount);
}

function findNodeInPage(page, nodeId) {
  let result = null;
  walkPage(page?.children, ({ node }) => { if (!result && node.id === nodeId) result = node; });
  return result;
}

function matchKey(match) { return `${match.pageId}\u0000${match.nodeId}\u0000${match.start}\u0000${match.end}\u0000${match.text}`; }

/** Prepare a detached document with one or all currently matching, writable text ranges replaced. */
export function planPageTextReplacement(document, pageId, query, replacement, {
  caseSensitive = false,
  targetMatch = null,
  resolveText = node => node.text
} = {}) {
  const allMatches = findPageTextMatches(document, pageId, query, { caseSensitive, resolveText });
  const candidates = targetMatch
    ? allMatches.filter(match => matchKey(match) === matchKey(targetMatch))
    : allMatches;
  const skippedMatches = candidates.filter(match => match.readOnlyReason);
  const writableMatches = candidates.filter(match => !match.readOnlyReason);
  const normalizedReplacement = String(replacement ?? '').replace(/\r\n?/gu, '\n');
  const effectiveMatches = writableMatches.filter(match => match.text !== normalizedReplacement);
  if (!effectiveMatches.length) {
    return { document: null, allMatches, skippedMatches, replacedCount: 0, changedNodeIds: [] };
  }
  const page = document.pages?.find(candidate => candidate.id === pageId);
  if (!page) return { document: null, allMatches: [], skippedMatches: [], replacedCount: 0, changedNodeIds: [] };
  const nextDocument = structuredClone(document);
  const nextPage = nextDocument.pages.find(candidate => candidate.id === pageId);
  const byNode = new Map();
  for (const match of effectiveMatches) {
    const list = byNode.get(match.nodeId) || [];
    list.push(match);
    byNode.set(match.nodeId, list);
  }
  const changedNodeIds = [];
  for (const [nodeId, nodeMatches] of byNode) {
    const sourceNode = findNodeInPage(page, nodeId);
    const nextNode = findNodeInPage(nextPage, nodeId);
    if (!sourceNode || !nextNode || sourceNode.type !== 'text' || nextNode.type !== 'text') continue;
    const originalText = String(resolveText(sourceNode, document) ?? '');
    // A custom resolver can expose derived text. Never write it back over the
    // layer's stored content; the default text binding is already read-only.
    if (originalText !== String(sourceNode.text ?? '')) continue;
    let currentText = originalText;
    const matchesDescending = [...nodeMatches].sort((left, right) => right.start - left.start);
    let runs = Array.isArray(sourceNode.textRuns) ? structuredClone(sourceNode.textRuns) : null;
    const runsMatch = !runs || runs.map(run => String(run?.text ?? '')).join('') === currentText;
    if (!runsMatch) runs = null;
    let paragraphStyles = Array.isArray(sourceNode.paragraphStyles) ? structuredClone(sourceNode.paragraphStyles) : null;
    for (const match of matchesDescending) {
      const from = currentText.slice(0, match.start);
      const to = currentText.slice(match.end);
      if (runs) runs = replaceTextRunRange(runs, currentText, match.start, match.end, normalizedReplacement);
      if (paragraphStyles) paragraphStyles = replaceParagraphRange(currentText, paragraphStyles, match.start, match.end, normalizedReplacement);
      currentText = `${from}${normalizedReplacement}${to}`;
    }
    nextNode.text = currentText;
    if (runs) nextNode.textRuns = runs;
    else delete nextNode.textRuns;
    if (paragraphStyles) nextNode.paragraphStyles = paragraphStyles;
    if (currentText !== String(sourceNode.text ?? '')
      || JSON.stringify(nextNode.textRuns || null) !== JSON.stringify(sourceNode.textRuns || null)
      || JSON.stringify(nextNode.paragraphStyles || null) !== JSON.stringify(sourceNode.paragraphStyles || null)) {
      changedNodeIds.push(nodeId);
    }
  }
  return {
    document: changedNodeIds.length ? nextDocument : null,
    allMatches,
    skippedMatches,
    replacedCount: changedNodeIds.length ? effectiveMatches.length : 0,
    changedNodeIds
  };
}
