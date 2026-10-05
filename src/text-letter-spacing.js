const unitFor = unit => {
  const value = unit ?? 'pixels';
  if (value !== 'pixels' && value !== 'percent') throw new TypeError('Letter spacing uses pixels or percent.');
  return value;
};
const numberFor = value => {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) throw new TypeError('Letter spacing must be finite.');
  return number;
};
const fontSizeFor = value => {
  const number = Number(value ?? 24);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError('Letter spacing requires a positive finite font size.');
  return number;
};

/** Scalar pixel argument for measurement/paint; never persist this over authored percentages. */
export function resolvedLetterSpacing(value, fontSize, unit = 'pixels') {
  const number = numberFor(value);
  const result = unitFor(unit) === 'percent' ? number * fontSizeFor(fontSize) / 100 : number;
  if (!Number.isFinite(result)) throw new RangeError('Resolved letter spacing exceeds finite geometry.');
  return result;
}

/** Resolve from the effective runtime font size, including synthesized scripts. */
export function resolvedTextLetterSpacing(style = {}) {
  return resolvedLetterSpacing(style.letterSpacing, style.fontSize, style.letterSpacingUnit);
}

/** Convert an authored value once when changing units at a known font size. */
export function convertLetterSpacing(value, fontSize, fromUnit, toUnit) {
  const from = unitFor(fromUnit); const to = unitFor(toUnit);
  const number = numberFor(value);
  if (from === to) return number;
  const pixels = resolvedLetterSpacing(number, fontSize, from);
  const result = to === 'percent' ? pixels / fontSizeFor(fontSize) * 100 : pixels;
  if (!Number.isFinite(result)) throw new RangeError('Converted letter spacing exceeds finite geometry.');
  return result;
}

/** An explicit legacy run number stays pixels even inside a percentage layer. */
export function inheritedTextLetterSpacing(base = {}, run = {}) {
  return { letterSpacing: run.letterSpacing ?? base.letterSpacing ?? 0,
    letterSpacingUnit: run.letterSpacingUnit ?? (run.letterSpacing !== undefined ? 'pixels' : base.letterSpacingUnit ?? 'pixels') };
}
