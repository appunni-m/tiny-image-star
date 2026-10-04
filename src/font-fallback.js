import { textGraphemes } from './text-layout.js';
import { unicodeScriptFor } from './unicode-script.js';

const MAX_FALLBACK_TEXT_CODE_UNITS = 32_768;
const defaultIgnorable = /\p{Default_Ignorable_Code_Point}/u;
const letterOrNumber = /[\p{Letter}\p{Number}]/u;
const extendedPictographic = /\p{Extended_Pictographic}/u;
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
  let hasUnclassifiedLetterOrNumber = false;
  for (const character of grapheme) {
    const script = unicodeScriptFor(character.codePointAt(0));
    if (script && !['Zyyy', 'Zinh', 'Zzzz'].includes(script)) return script;
    if (script === 'Zzzz' && letterOrNumber.test(character)) hasUnclassifiedLetterOrNumber = true;
  }
  if (extendedPictographic.test(grapheme) || hasUnclassifiedLetterOrNumber) return null;
  // Unicode Common and Inherited characters can safely join a neighboring run.
  return 'Zyyy';
}

function resolveCommonScripts(scripts) {
  return scripts.map((script, index) => {
    if (script !== 'Zyyy') return script;
    for (let before = index - 1; before >= 0; before -= 1) {
      if (scripts[before] && !['Zyyy', 'Zinh'].includes(scripts[before])) return scripts[before];
    }
    for (let after = index + 1; after < scripts.length; after += 1) {
      if (scripts[after] && !['Zyyy', 'Zinh'].includes(scripts[after])) return scripts[after];
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
