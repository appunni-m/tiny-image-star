/** Maximum baseline displacement for one rich-text run, measured in editor px. */
export const MAX_TEXT_RUN_BASELINE_SHIFT = 10_000;

/** Canonicalize a UI value; zero stays the implicit default and invalid values are ignored. */
export function normalizeTextRunBaselineShift(value) {
  const shift = Number(value);
  if (!Number.isFinite(shift) || Math.abs(shift) > MAX_TEXT_RUN_BASELINE_SHIFT || shift === 0) return null;
  return shift;
}

function sameRunStyle(left, right) {
  const leftKeys = Object.keys(left).filter(key => key !== 'text');
  const rightKeys = Object.keys(right).filter(key => key !== 'text');
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.hasOwn(right, key) && sameStyleValue(left[key], right[key]));
}

function sameStyleValue(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.hasOwn(right, key) && sameStyleValue(left[key], right[key]));
}

/**
 * Apply a style value to a UTF-16 editor range, splitting runs only at the range
 * boundaries and merging adjacent runs again when their styles match.
 */
export function transformTextRunsInRange(runs, start, end, property, value) {
  if (!Array.isArray(runs) || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start || typeof property !== 'string') return Array.isArray(runs) ? structuredClone(runs) : [];
  const result = [];
  let cursor = 0;
  for (const run of runs) {
    const text = typeof run?.text === 'string' ? run.text : '';
    const runStart = cursor;
    const runEnd = runStart + text.length;
    if (runStart < start) {
      const before = text.slice(0, Math.max(0, start - runStart));
      if (before) result.push({ ...run, text: before });
    }
    const overlapStart = Math.max(runStart, start);
    const overlapEnd = Math.min(runEnd, end);
    if (overlapEnd > overlapStart) {
      const middle = text.slice(overlapStart - runStart, overlapEnd - runStart);
      result.push({ ...run, text: middle, [property]: value });
    }
    if (runEnd > end) {
      const after = text.slice(Math.max(0, end - runStart));
      if (after) result.push({ ...run, text: after });
    }
    cursor = runEnd;
  }
  const merged = [];
  for (const run of result) {
    const previous = merged.at(-1);
    if (previous && sameRunStyle(previous, run)) previous.text += run.text;
    else merged.push(run);
  }
  return merged;
}
