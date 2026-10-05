import { convertLetterSpacing, inheritedTextLetterSpacing } from './text-letter-spacing.js';

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

const LETTER_SPACING_UNITS = new Set(['pixels', 'percent']);

function convertedRunSpacing(run, baseStyle, toUnit, resolveStyle) {
  const spacing = inheritedTextLetterSpacing(baseStyle, run);
  if (!LETTER_SPACING_UNITS.has(toUnit)) throw new TypeError('Letter spacing uses pixels or percent.');
  const effectiveStyle = { ...baseStyle, ...run, ...spacing };
  const resolved = typeof resolveStyle === 'function' ? resolveStyle(effectiveStyle) || {} : {};
  const fontSize = resolved.fontSize ?? effectiveStyle.fontSize;
  const value = convertLetterSpacing(spacing.letterSpacing, fontSize,
    spacing.letterSpacingUnit, toUnit);
  if (!Number.isFinite(value) || Math.abs(value) > 10_000) {
    throw new RangeError('Converted letter spacing exceeds the 10,000-unit text limit.');
  }
  return { ...run, letterSpacing: value, letterSpacingUnit: toUnit };
}

/**
 * Convert one UTF-16 rich-text selection between pixels and percent without
 * changing its physical spacing. Runs that inherited layer spacing are
 * materialized only inside the selected range.
 */
export function convertTextRunLetterSpacingUnit(runs, start, end, baseStyle, toUnit, { resolveStyle } = {}) {
  if (!Array.isArray(runs) || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start || typeof baseStyle !== 'object' || !baseStyle) {
    throw new TypeError('Choose a valid rich-text range to convert letter spacing.');
  }
  if (!LETTER_SPACING_UNITS.has(toUnit)) throw new TypeError('Letter spacing uses pixels or percent.');
  const result = [];
  let cursor = 0;
  let converted = false;
  for (const run of runs) {
    const text = typeof run?.text === 'string' ? run.text : '';
    const runStart = cursor;
    const runEnd = runStart + text.length;
    const overlapStart = Math.max(start, runStart);
    const overlapEnd = Math.min(end, runEnd);
    if (runStart < start) {
      const before = text.slice(0, start - runStart);
      if (before) result.push({ ...run, text: before });
    }
    if (overlapEnd > overlapStart) {
      const selection = text.slice(overlapStart - runStart, overlapEnd - runStart);
      result.push({ ...convertedRunSpacing(run, baseStyle, toUnit, resolveStyle), text: selection });
      converted = true;
    }
    if (runEnd > end) {
      const after = text.slice(Math.max(0, end - runStart));
      if (after) result.push({ ...run, text: after });
    }
    cursor = runEnd;
  }
  if (!converted || end > cursor || result.length > 10_000) {
    throw new RangeError('The selected letter-spacing range is invalid or exceeds the rich-text run limit.');
  }
  const merged = [];
  for (const run of result) {
    const previous = merged.at(-1);
    if (previous && sameRunStyle(previous, run)) previous.text += run.text;
    else merged.push(run);
  }
  if (merged.length > 10_000) throw new RangeError('Converted text exceeds the 10,000 rich-text run limit.');
  return merged;
}

/** Convert layer letter spacing and all its rich runs as one atomic patch. */
export function convertTextLayerLetterSpacingUnit(node, baseStyle, toUnit, { resolveStyle } = {}) {
  if (!node || node.type !== 'text' || typeof baseStyle !== 'object' || !baseStyle
    || !LETTER_SPACING_UNITS.has(toUnit)) throw new TypeError('Choose a valid text layer and letter-spacing unit.');
  const oldUnit = node.letterSpacingUnit || 'pixels';
  const effectiveBase = { ...baseStyle, letterSpacing: baseStyle.letterSpacing ?? node.letterSpacing ?? 0,
    letterSpacingUnit: oldUnit };
  const resolvedBase = typeof resolveStyle === 'function' ? resolveStyle(effectiveBase) || {} : {};
  const baseFontSize = resolvedBase.fontSize ?? effectiveBase.fontSize ?? node.fontSize;
  const baseValue = baseStyle.letterSpacing ?? node.letterSpacing ?? 0;
  const letterSpacing = convertLetterSpacing(baseValue, baseFontSize, oldUnit, toUnit);
  if (!Number.isFinite(letterSpacing) || Math.abs(letterSpacing) > 10_000) {
    throw new RangeError('Converted letter spacing exceeds the 10,000-unit text limit.');
  }
  const patch = { letterSpacing, letterSpacingUnit: toUnit };
  if (Array.isArray(node.textRuns) && node.textRuns.length) {
    const length = node.textRuns.reduce((sum, run) => sum + (typeof run?.text === 'string' ? run.text.length : 0), 0);
    patch.textRuns = convertTextRunLetterSpacingUnit(node.textRuns, 0, length, {
      ...baseStyle, letterSpacing: baseValue, letterSpacingUnit: oldUnit
    }, toUnit, { resolveStyle });
  }
  return patch;
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
