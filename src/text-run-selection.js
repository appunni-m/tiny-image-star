/** Summarize one property across the runs that overlap a UTF-16 editor range. */
function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

export function summarizeTextRunRange(runs, start, end, resolveValue, normalize = value => value) {
  if (!Array.isArray(runs) || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end <= start || typeof resolveValue !== 'function') {
    return { selected: false, mixed: false, value: null };
  }
  const values = [];
  let cursor = 0;
  for (const run of runs) {
    const text = typeof run?.text === 'string' ? run.text : '';
    const runEnd = cursor + text.length;
    if (cursor < end && runEnd > start) values.push(resolveValue(run));
    cursor = runEnd;
  }
  if (!values.length) return { selected: false, mixed: false, value: null };
  const first = normalize(values[0]);
  return {
    selected: true,
    mixed: values.some(value => !sameValue(normalize(value), first)),
    value: values[0]
  };
}
