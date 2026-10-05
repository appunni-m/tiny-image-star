const decorationStyles = new Set(['solid', 'dotted', 'wavy']);
const metricUnits = new Set(['auto', 'pixels', 'percent']);

export const TEXT_DECORATION_PROPERTIES = Object.freeze([
  'textDecorationStyle', 'textDecorationThickness', 'textDecorationOffset',
  'textDecorationColor', 'textDecorationSkipInk'
]);

function isMetric(value, { signed = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (value.unit === 'auto') return keys.length === 1;
  return (value.unit === 'pixels' || value.unit === 'percent') && keys.length === 2
    && typeof value.value === 'number' && Number.isFinite(value.value)
    && (signed ? Math.abs(value.value) <= 100_000 : value.value >= 0 && value.value <= 100_000);
}

function isDecorationColor(value) {
  if (value === 'auto') return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return value.type === 'solid' && /^#[0-9a-f]{6}$/i.test(value.color || '')
    && typeof value.opacity === 'number' && Number.isFinite(value.opacity)
    && value.opacity >= 0 && value.opacity <= 1
    && (value.visible === undefined || typeof value.visible === 'boolean')
    && keys.every(key => ['type', 'color', 'opacity', 'visible'].includes(key));
}

export function isValidTextDecorationProperty(property, value) {
  if (property === 'textDecorationStyle') return decorationStyles.has(value);
  if (property === 'textDecorationThickness') return isMetric(value);
  if (property === 'textDecorationOffset') return isMetric(value, { signed: true });
  if (property === 'textDecorationColor') return isDecorationColor(value);
  if (property === 'textDecorationSkipInk') return typeof value === 'boolean';
  return false;
}

export function normalizeTextDecorationStyle(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const keys = Object.keys(source);
  if (keys.some(key => !TEXT_DECORATION_PROPERTIES.includes(key))
    || keys.some(key => !isValidTextDecorationProperty(key, source[key]))) return null;
  return Object.fromEntries(keys.map(key => [key, structuredClone(source[key])]));
}

export function textDecorationDefaults(source = {}) {
  return {
    textDecorationStyle: source.textDecorationStyle ?? 'solid',
    textDecorationThickness: structuredClone(source.textDecorationThickness ?? { unit: 'auto' }),
    textDecorationOffset: structuredClone(source.textDecorationOffset ?? { unit: 'auto' }),
    textDecorationColor: structuredClone(source.textDecorationColor ?? 'auto'),
    textDecorationSkipInk: source.textDecorationSkipInk ?? false
  };
}
