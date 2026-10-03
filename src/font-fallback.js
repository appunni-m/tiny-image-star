import { textGraphemes } from './text-layout.js';

const MAX_FALLBACK_TEXT_CODE_UNITS = 32_768;
const defaultIgnorable = /\p{Default_Ignorable_Code_Point}/u;
const letterOrNumber = /[\p{Letter}\p{Number}]/u;
const extendedPictographic = /\p{Extended_Pictographic}/u;
const scriptDetectors = [
  [/\p{Script=Latin}/u, 'Latn'], [/\p{Script=Arabic}/u, 'Arab'], [/\p{Script=Hebrew}/u, 'Hebr'],
  [/\p{Script=Cyrillic}/u, 'Cyrl'], [/\p{Script=Greek}/u, 'Grek'], [/\p{Script=Armenian}/u, 'Armn'],
  [/\p{Script=Georgian}/u, 'Geor'], [/\p{Script=Ethiopic}/u, 'Ethi'], [/\p{Script=Devanagari}/u, 'Deva'],
  [/\p{Script=Bengali}/u, 'Beng'], [/\p{Script=Gurmukhi}/u, 'Guru'], [/\p{Script=Gujarati}/u, 'Gujr'],
  [/\p{Script=Oriya}/u, 'Orya'], [/\p{Script=Tamil}/u, 'Taml'], [/\p{Script=Telugu}/u, 'Telu'],
  [/\p{Script=Kannada}/u, 'Knda'], [/\p{Script=Malayalam}/u, 'Mlym'], [/\p{Script=Sinhala}/u, 'Sinh'],
  [/\p{Script=Thai}/u, 'Thai'], [/\p{Script=Lao}/u, 'Laoo'], [/\p{Script=Tibetan}/u, 'Tibt'],
  [/\p{Script=Myanmar}/u, 'Mymr'], [/\p{Script=Khmer}/u, 'Khmr'], [/\p{Script=Han}/u, 'Hani'],
  [/\p{Script=Hiragana}/u, 'Hira'], [/\p{Script=Katakana}/u, 'Kana'], [/\p{Script=Hangul}/u, 'Hang'],
  [/\p{Script=Cherokee}/u, 'Cher'], [/\p{Script=Canadian_Aboriginal}/u, 'Cans']
];

function codePointInCoverage(coverage, codePoint) {
  if (!coverage || !Number.isSafeInteger(codePoint)) return false;
  let low = 0;
  let high = coverage.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const value = coverage[middle];
    if (value === codePoint) return true;
    if (value < codePoint) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

function fontCoversGrapheme(font, grapheme) {
  let hasVisibleCodePoint = false;
  for (const character of grapheme) {
    if (defaultIgnorable.test(character)) continue;
    hasVisibleCodePoint = true;
    if (!codePointInCoverage(font.coverage, character.codePointAt(0))) return false;
  }
  return hasVisibleCodePoint || Boolean(font.coverage?.length);
}

function scriptForGrapheme(grapheme) {
  for (const character of grapheme) {
    for (const [pattern, tag] of scriptDetectors) if (pattern.test(character)) return tag;
  }
  if (extendedPictographic.test(grapheme)) return null;
  // Unrecognized letters are left to the browser's complete script shaping
  // stack. Common punctuation and spacing can safely join a neighboring run.
  return letterOrNumber.test(grapheme) ? null : 'Zyyy';
}

function resolveCommonScripts(scripts) {
  return scripts.map((script, index) => {
    if (script !== 'Zyyy') return script;
    for (let before = index - 1; before >= 0; before -= 1) {
      if (scripts[before] && scripts[before] !== 'Zyyy') return scripts[before];
    }
    for (let after = index + 1; after < scripts.length; after += 1) {
      if (scripts[after] && scripts[after] !== 'Zyyy') return scripts[after];
    }
    return 'Zyyy';
  });
}

/** Split text at grapheme-safe font and script boundaries, preserving source order. */
export function itemizeLocalFontRuns(text, fonts = [], segmentText = textGraphemes) {
  if (typeof text !== 'string' || text.length > MAX_FALLBACK_TEXT_CODE_UNITS || typeof segmentText !== 'function') {
    throw new TypeError('The text is outside the supported font fallback limits.');
  }
  if (!text) return [];
  const graphemes = segmentText(text);
  const scripts = resolveCommonScripts(graphemes.map(scriptForGrapheme));
  const runs = [];
  for (let index = 0; index < graphemes.length; index += 1) {
    const grapheme = graphemes[index];
    const script = scripts[index];
    const font = script ? fonts.find(candidate => fontCoversGrapheme(candidate, grapheme)) : null;
    const fontId = font?.id || null;
    const previous = runs.at(-1);
    if (previous && previous.fontId === fontId && previous.script === script) previous.text += grapheme;
    else runs.push({ text: grapheme, fontId, script });
  }
  return runs;
}

/** Parse CSS font-family syntax without splitting commas inside quoted names. */
export function fontFamilyStack(fontFamily) {
  const families = [];
  let token = '';
  let quote = '';
  let escaped = false;
  for (const character of String(fontFamily || '')) {
    if (quote) {
      token += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
      token += character;
    } else if (character === ',') {
      families.push(token);
      token = '';
    } else token += character;
  }
  families.push(token);
  return families.map(value => value.trim().replace(/^("|')(.*)\1$/u, '$2').replace(/\\(["'\\])/gu, '$1'))
    .filter(Boolean);
}
