/** Maximum number of OpenType feature overrides on one text style. */
export const MAX_FONT_FEATURES = 32;
/** OpenType feature values are serialized as bounded unsigned 16-bit integers. */
export const MAX_FONT_FEATURE_VALUE = 65_535;

/** Validate a map of four-byte OpenType feature tags to unsigned values. */
export function isValidFontFeatureValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
  const keys = Object.keys(values);
  if (keys.length < 1 || keys.length > MAX_FONT_FEATURES) return false;
  return keys.every(tag => /^[\x20-\x7e]{4}$/u.test(tag) && /[^ ]/u.test(tag)
    && Number.isInteger(values[tag]) && values[tag] >= 0 && values[tag] <= MAX_FONT_FEATURE_VALUE);
}

/** Set or clear one OpenType feature without discarding other overrides. */
export function setFontFeatureValue(values, tag, value) {
  if (typeof tag !== 'string' || !/^[\x20-\x7e]{4}$/u.test(tag) || !/[^ ]/u.test(tag)
    || (value !== null && (!Number.isInteger(value) || value < 0 || value > MAX_FONT_FEATURE_VALUE))) {
    throw new TypeError('An OpenType feature needs a printable four-character tag and a bounded integer value.');
  }
  const next = { ...(isValidFontFeatureValues(values) ? values : {}) };
  if (value === null) delete next[tag];
  else next[tag] = value;
  if (Object.keys(next).length > MAX_FONT_FEATURES) throw new TypeError('A text style cannot contain more than 32 OpenType features.');
  return next;
}

/** Return deterministic CSS `font-feature-settings` text for a feature map. */
export function fontFeatureSettings(values) {
  if (!isValidFontFeatureValues(values)) return '';
  return Object.keys(values).sort().map(tag => `${JSON.stringify(tag)} ${values[tag]}`).join(', ');
}

/** Parse the interoperable four-byte-tag/integer subset of feature settings. */
export function parseFontFeatureSettings(value) {
  const input = String(value ?? '').trim();
  if (input.toLowerCase() === 'normal') return {};
  const values = {};
  let offset = 0;
  const token = /"((?:\\["\\]|[^"\\]){4})"\s+(\d+)/iy;
  while (offset < input.length) {
    while (/\s/u.test(input[offset] || '')) offset += 1;
    token.lastIndex = offset;
    const match = token.exec(input);
    if (!match) return null;
    const tag = match[1].replace(/\\(["\\])/gu, '$1');
    const featureValue = Number(match[2]);
    if (!/^[\x20-\x7e]{4}$/u.test(tag) || !/[^ ]/u.test(tag)
      || !Number.isInteger(featureValue) || featureValue > MAX_FONT_FEATURE_VALUE || Object.hasOwn(values, tag)) return null;
    values[tag] = featureValue;
    offset = token.lastIndex;
    while (/\s/u.test(input[offset] || '')) offset += 1;
    if (offset >= input.length) break;
    if (input[offset] !== ',') return null;
    offset += 1;
  }
  return isValidFontFeatureValues(values) ? values : null;
}
