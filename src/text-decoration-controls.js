import { isValidTextDecorationProperty, textDecorationDefaults } from './text-decoration-style.js';

/** Convert one UI field into a complete, validated property mutation. */
export function textDecorationControlPatch(source, field, raw, { fontSize = source.fontSize || 24, color = source.color || '#1e1e1e' } = {}) {
  const style = textDecorationDefaults(source);
  const size = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 24;
  let property; let value;
  if (field === 'style') { property = 'textDecorationStyle'; value = raw; }
  else if (field === 'skipInk') { property = 'textDecorationSkipInk'; value = raw; }
  else if (/^(thickness|offset)(Unit|Value)$/.test(field)) {
    const [, kind, part] = /^(thickness|offset)(Unit|Value)$/.exec(field);
    property = kind === 'thickness' ? 'textDecorationThickness' : 'textDecorationOffset';
    const current = style[property];
    if (part === 'Unit') {
      if (!['auto', 'pixels', 'percent'].includes(raw)) return null;
      const pixels = current.unit === 'auto' ? (kind === 'thickness' ? Math.max(1, size / 16) : 0)
        : current.unit === 'percent' ? current.value * size / 100 : current.value;
      value = raw === 'auto' ? { unit: 'auto' } : { unit: raw, value: raw === 'percent' ? pixels * 100 / size : pixels };
    } else {
      if (current.unit === 'auto' || typeof raw !== 'string' && typeof raw !== 'number'
        || String(raw).trim() === '') return null;
      value = { unit: current.unit, value: Number(raw) };
    }
  } else if (['colorMode', 'color', 'opacity', 'visible'].includes(field)) {
    property = 'textDecorationColor';
    const current = style.textDecorationColor;
    const fallbackColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#1e1e1e';
    const paint = current === 'auto' ? { type: 'solid', color: fallbackColor, opacity: 1 } : structuredClone(current);
    if (field === 'colorMode') {
      if (!['auto', 'custom'].includes(raw)) return null;
      value = raw === 'auto' ? 'auto' : paint;
    } else if (field === 'color') value = { ...paint, color: String(raw).toLowerCase() };
    else if (field === 'visible') value = { ...paint, visible: raw };
    else {
      if (String(raw).trim() === '') return null;
      value = { ...paint, opacity: Number(raw) / 100 };
    }
  } else return null;
  return isValidTextDecorationProperty(property, value) ? { property, value } : null;
}

/** CSS for the browser's live text editor and Inspect output. */
export function textDecorationCss(source, { zoom = 1 } = {}) {
  if (source.textDecoration !== 'underline') return {};
  const style = textDecorationDefaults(source);
  const metric = (value, offset = false) => value.unit === 'auto' ? 'auto'
    : value.unit === 'pixels' ? `${value.value * zoom}px`
    : offset ? `${value.value / 100}em` : `${value.value}%`;
  const color = style.textDecorationColor;
  return {
    textDecorationStyle: style.textDecorationStyle,
    textDecorationThickness: metric(style.textDecorationThickness),
    textUnderlineOffset: metric(style.textDecorationOffset, true),
    textDecorationColor: color === 'auto' ? 'currentColor' : color.visible === false ? 'transparent'
      : `rgba(${parseInt(color.color.slice(1, 3), 16)}, ${parseInt(color.color.slice(3, 5), 16)}, ${parseInt(color.color.slice(5, 7), 16)}, ${color.opacity})`,
    textDecorationSkipInk: style.textDecorationSkipInk ? 'auto' : 'none'
  };
}

/** Value equality for range controls; stored object key order is irrelevant. */
export function textStyleValuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && textStyleValuesEqual(left[key], right[key]));
}

/** Apply one field to a range while retaining each run's other underline settings. */
export function applyTextDecorationControlRange(runs, start, end, base, field, raw) {
  if (!Array.isArray(runs) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end <= start || end > runs.reduce((sum, run) => sum + run.text.length, 0)) return null;
  const result = []; let cursor = 0;
  for (const run of runs) {
    const next = cursor + run.text.length;
    if (next <= start || cursor >= end) result.push(structuredClone(run));
    else {
      const from = Math.max(0, start - cursor); const to = Math.min(run.text.length, end - cursor);
      const source = { ...base, ...run };
      const patch = textDecorationControlPatch(source, field, raw);
      if (!patch) return null;
      if (from) result.push({ ...structuredClone(run), text: run.text.slice(0, from) });
      result.push({ ...structuredClone(run), text: run.text.slice(from, to), [patch.property]: patch.value });
      if (to < run.text.length) result.push({ ...structuredClone(run), text: run.text.slice(to) });
    }
    cursor = next;
  }
  const merged = [];
  for (const run of result) {
    const previous = merged.at(-1);
    if (previous && textStyleValuesEqual({ ...previous, text: '' }, { ...run, text: '' })) previous.text += run.text;
    else merged.push(run);
  }
  return merged;
}
