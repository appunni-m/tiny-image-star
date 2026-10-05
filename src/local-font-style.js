import { fontFamilyStack } from './font-fallback.js';

/** Use the same family, face and variable-axis choices for preview and conversion. */
export function localFontsForStyle(style, availableFonts) {
  const available = Array.from(availableFonts || []);
  const requestedWeight = Number(style?.fontWeight) || 400;
  const score = font => {
    const weightAxis = font.axes?.find(axis => axis.tag === 'wght');
    const weightDistance = weightAxis && requestedWeight >= weightAxis.min && requestedWeight <= weightAxis.max
      ? 0 : Math.abs(Number(font.weight) - requestedWeight);
    const styleDistance = font.style === (style?.fontStyle || 'normal') ? 0 : 10_000;
    return styleDistance + weightDistance;
  };
  const ordered = []; const seen = new Set();
  for (const family of fontFamilyStack(style?.fontFamily)) {
    const matches = available.filter(font => font.family.toLocaleLowerCase() === family.toLocaleLowerCase())
      .sort((left, right) => score(left) - score(right) || left.id.localeCompare(right.id));
    const font = matches[0];
    if (font && !seen.has(font.id)) { seen.add(font.id); ordered.push(font); }
  }
  return ordered.slice(0, 4);
}

export function localFontAxisValues(font, style) {
  const requested = style?.fontAxes && typeof style.fontAxes === 'object' && !Array.isArray(style.fontAxes)
    ? style.fontAxes : {};
  const values = {};
  for (const axis of font.axes || []) {
    let value = Number.isFinite(requested[axis.tag]) ? requested[axis.tag] : axis.defaultValue;
    if (!Number.isFinite(requested[axis.tag])) {
      if (axis.tag === 'wght') value = Number(style?.fontWeight) || Number(font.weight) || axis.defaultValue;
      else if (axis.tag === 'opsz') value = Number(style?.fontSize) || axis.defaultValue;
      else if (axis.tag === 'ital' && style?.fontStyle === 'italic') value = 1;
      else if (axis.tag === 'slnt' && style?.fontStyle === 'italic') value = -12;
    }
    values[axis.tag] = Math.min(axis.max, Math.max(axis.min, value));
  }
  return values;
}
