/** Summarize one property across the runs that overlap a UTF-16 editor range. */
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
    mixed: values.some(value => !Object.is(normalize(value), first)),
    value: values[0]
  };
}
