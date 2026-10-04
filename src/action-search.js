const SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'around', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from',
  'how', 'i', 'in', 'into', 'is', 'it', 'make', 'me', 'my', 'need', 'of', 'on', 'our', 'please', 'should',
  'show', 'some', 'that', 'the', 'this', 'to', 'want', 'was', 'we', 'were', 'what', 'with', 'you', 'your'
]);

export function normalizeActionSearchText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function actionSearchFields(action) {
  const keywords = Array.isArray(action.keywords) ? action.keywords.join(' ') : action.keywords || '';
  return {
    label: normalizeActionSearchText(action.label),
    description: normalizeActionSearchText(action.description),
    keywords: normalizeActionSearchText(keywords),
  };
}

function fieldHasTerm(field, term) {
  return field.split(' ').some(word => word === term || word.startsWith(term));
}

/** Search the editor's currently available actions, preserving source order for ties. */
export function searchActions(actions, query, { limit = 12 } = {}) {
  if (!Array.isArray(actions)) throw new TypeError('Action search needs an action list.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Action search limit must be between one and one hundred.');
  const normalizedQuery = normalizeActionSearchText(query);
  const terms = normalizedQuery.split(' ').filter(term => term && !SEARCH_STOP_WORDS.has(term));
  if (!terms.length) return actions.slice(0, limit);

  return actions.map((action, index) => {
    const fields = actionSearchFields(action);
    const termScores = terms.map(term => {
      if (fields.label === term) return 18;
      if (fields.label.startsWith(term)) return 12;
      if (fieldHasTerm(fields.label, term)) return 8;
      if (fieldHasTerm(fields.description, term)) return 4;
      if (fieldHasTerm(fields.keywords, term)) return 3;
      return -1;
    });
    const score = termScores.some(value => value < 0) ? -1 : termScores.reduce((sum, value) => sum + value, 0);
    return { action, index, score };
  }).filter(result => result.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(result => result.action);
}
