import { canvasFontWeight } from './font-variation.js';
import { TEXT_DECORATION_PROPERTIES, textDecorationDefaults } from './text-decoration-style.js';
import { resolveTextPositionView } from './text-position.js';
import { createTextLeadingTrimResolver, canvasLeadingTrimMetrics } from './text-leading-trim.js';
import { resolveTextLineLayout, canvasTextLineMetrics } from './text-line-metrics.js';
import { inheritedTextLetterSpacing, resolvedTextLetterSpacing } from './text-letter-spacing.js';

const graphemeSegmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const wordSegmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
const thaiWordSegmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

const markPattern = /\p{M}/u;
const complexShapingText = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}\p{Extended_Pictographic}]/u;
// Unicode GL/WJ characters prohibit a line break on either side. In particular,
// treating NBSP as ordinary JavaScript whitespace splits values such as "10 MB"
// and can even drop the space when a soft wrap happens at that point.
const noBreakPattern = /[\u00a0\u2007\u202f\u2060\ufeff\u2011]/u;
const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const cjkOpeningPunctuation = /[〈《「『【〔〖〘〚〝（［｛｟«‘“]/u;
const cjkClosingPunctuation = /[〉》」』】〕〗〙〛〞〟）、。，．？！：；»’”]/u;
const cjkSmallKana = /[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶヷヸヹヺー]/u;
const regionalIndicatorPattern = /[\u{1f1e6}-\u{1f1ff}]/u;
const emojiModifierPattern = /[\u{1f3fb}-\u{1f3ff}]/u;
const emojiTagPattern = /[\u{e0020}-\u{e007f}]/u;
const prependPattern = /[\u0600-\u0605\u06dd\u070f\u0890\u0891\u08e2\u0d4e\u110bd\u110cd]/u;
const viramaPattern = /[\u094d\u09cd\u0a4d\u0acd\u0b4d\u0bcd\u0c4d\u0ccd\u0d4d\u0dca\u1039\u103a\u17d2\ua806\ua8c4\ua953\ua9c0\uaaf6\uabed\u10a3f\u11046\u11070\u11133\u111c0\u11235\u112ea\u1134d\u11442\u114c2\u115bf\u1163f\u116b6\u1172b\u11839\u1193d\u119e0\u11a34\u11a47\u11a99\u11c3f\u11d44\u11d45\u11d97\u11f41\u11f42]/u;

// Cap each measured candidate for pathological tokens while still allowing normal long lines.
const maxGraphemesPerProbe = 256;

function codePoint(value) { return value.codePointAt(0) || 0; }

function isHangulL(value) {
  const point = codePoint(value);
  return point >= 0x1100 && point <= 0x115f || point >= 0xa960 && point <= 0xa97c;
}
function isHangulV(value) {
  const point = codePoint(value);
  return point >= 0x1160 && point <= 0x11a7 || point >= 0xd7b0 && point <= 0xd7c6;
}
function isHangulT(value) {
  const point = codePoint(value);
  return point >= 0x11a8 && point <= 0x11ff || point >= 0xd7cb && point <= 0xd7fb;
}
function isHangulSyllable(value) {
  const point = codePoint(value);
  return point >= 0xac00 && point <= 0xd7a3;
}
function isHangulLv(value) {
  const point = codePoint(value);
  return isHangulSyllable(value) && (point - 0xac00) % 28 === 0;
}
function isHangulLvt(value) { return isHangulSyllable(value) && !isHangulLv(value); }

function fallbackGraphemes(text) {
  const points = Array.from(String(text ?? ''));
  const clusters = [];
  let regionalCount = 0;
  let previous = '';
  for (const point of points) {
    if (!clusters.length) {
      clusters.push([point]);
      regionalCount = regionalIndicatorPattern.test(point) ? 1 : 0;
      previous = point;
      continue;
    }
    const joinsHangul = isHangulL(previous) && (isHangulL(point) || isHangulV(point) || isHangulLv(point) || isHangulLvt(point))
      || (isHangulLv(previous) || isHangulV(previous)) && (isHangulV(point) || isHangulT(point))
      || (isHangulLvt(previous) || isHangulT(previous)) && isHangulT(point);
    const joinsPrevious = markPattern.test(point)
      || emojiModifierPattern.test(point)
      || emojiTagPattern.test(point)
      || point === '\u200d'
      || previous === '\u200d'
      || previous === '\r' && point === '\n'
      || regionalIndicatorPattern.test(point) && regionalCount % 2 === 1
      || prependPattern.test(previous)
      || viramaPattern.test(previous)
      || joinsHangul;
    if (joinsPrevious) clusters.at(-1).push(point);
    else clusters.push([point]);
    if (regionalIndicatorPattern.test(point)) regionalCount = regionalIndicatorPattern.test(previous) ? regionalCount + 1 : 1;
    else if (point !== '\u200d' && !markPattern.test(point)) regionalCount = 0;
    previous = point;
  }
  return clusters.map(cluster => cluster.join(''));
}

export function textGraphemes(text, segmenter = graphemeSegmenter) {
  const value = String(text ?? '');
  if (segmenter?.segment) return Array.from(segmenter.segment(value), part => part.segment);
  return fallbackGraphemes(value);
}

function thaiWordBreakOffsets(text, segmenter = thaiWordSegmenter) {
  const breaks = new Set();
  if (!segmenter?.segment) return breaks;
  for (const match of String(text ?? '').matchAll(/\p{Script=Thai}+/gu)) {
    try {
      for (const part of segmenter.segment(match[0])) {
        if (part.isWordLike) breaks.add(match.index + part.index + part.segment.length);
      }
    } catch {
      // Older or partial Segmenter implementations fall back to grapheme wrapping.
    }
  }
  return breaks;
}

function isCjkLineBreak(left, right) {
  if (!left || !right || cjkOpeningPunctuation.test(left) || cjkOpeningPunctuation.test(right)
    || cjkClosingPunctuation.test(right) || cjkSmallKana.test(right)) return false;
  return cjkPattern.test(left) || cjkPattern.test(right) || cjkClosingPunctuation.test(left);
}

function isCjkLineBreakCharacter(value) {
  return cjkPattern.test(value) || cjkOpeningPunctuation.test(value) || cjkClosingPunctuation.test(value) || cjkSmallKana.test(value);
}

function isBreakableWhitespace(value) {
  return /^\s+$/u.test(value) && !noBreakPattern.test(value);
}

function canBreakBetweenGraphemes(left, right) {
  return !noBreakPattern.test(left) && !noBreakPattern.test(right);
}

function discretionaryBreakKind(cluster) {
  if (cluster === '\u00ad') return 'soft-hyphen';
  if (cluster === '\u200b') return 'zero-width-space';
  return null;
}

function visibleTextWithoutDiscretionaryBreaks(text) {
  return String(text ?? '').replace(/[\u00ad\u200b]/gu, '');
}

function plainDiscretionaryUnits(clusters) {
  const units = [];
  for (const cluster of clusters) {
    const kind = discretionaryBreakKind(cluster);
    if (kind) {
      const previous = units.at(-1);
      if (previous && (kind === 'soft-hyphen' || !previous.breakAfter)) previous.breakAfter = kind;
    } else units.push({ text: cluster, breakAfter: null });
  }
  return units;
}

function plainUnitsText(units) { return units.map(unit => unit.text).join(''); }

function plainUnitsRawText(units) {
  return units.map(unit => unit.text + (unit.breakAfter === 'soft-hyphen' ? '\u00ad' : unit.breakAfter ? '\u200b' : '')).join('');
}

function findPlainDiscretionaryBreak(token, linePrefix, maxWidth, measure, segmenter = graphemeSegmenter) {
  const clusters = textGraphemes(token, segmenter);
  let visiblePrefix = '';
  let previousVisibleCluster = '';
  let selected = null;
  for (let index = 0; index < clusters.length; index += 1) {
    const firstKind = discretionaryBreakKind(clusters[index]);
    if (!firstKind) {
      visiblePrefix += clusters[index];
      previousVisibleCluster = clusters[index];
      continue;
    }
    let kind = firstKind;
    let end = index + 1;
    while (end < clusters.length && discretionaryBreakKind(clusters[end])) {
      if (discretionaryBreakKind(clusters[end]) === 'soft-hyphen') kind = 'soft-hyphen';
      end += 1;
    }
    const suffix = clusters.slice(end).join('');
    const nextVisibleCluster = clusters[end];
    if (visiblePrefix && nextVisibleCluster && canBreakBetweenGraphemes(previousVisibleCluster, nextVisibleCluster)) {
      const prefix = visiblePrefix + (kind === 'soft-hyphen' ? '-' : '');
      if (Number(measure(visibleTextWithoutDiscretionaryBreaks(`${linePrefix}${prefix}`))) <= maxWidth) {
        selected = { prefix, suffix };
      }
    }
    index = end - 1;
  }
  return selected;
}

function plainLineWithTrailingSoftHyphen(line, nextPiece, hasPendingWhitespace, maxWidth, measure, segmenter = graphemeSegmenter) {
  if (hasPendingWhitespace) return null;
  const lineClusters = textGraphemes(line, segmenter);
  let markerStart = lineClusters.length;
  let kind = null;
  while (markerStart > 0 && discretionaryBreakKind(lineClusters[markerStart - 1])) {
    const markerKind = discretionaryBreakKind(lineClusters[markerStart - 1]);
    if (markerKind === 'soft-hyphen') kind = markerKind;
    else kind ||= markerKind;
    markerStart -= 1;
  }
  if (kind !== 'soft-hyphen' || markerStart < 1) return null;
  const nextVisible = textGraphemes(nextPiece, segmenter).find(cluster => !discretionaryBreakKind(cluster));
  const previousVisible = lineClusters[markerStart - 1];
  if (!nextVisible || !canBreakBetweenGraphemes(previousVisible, nextVisible)) return null;
  const rendered = visibleTextWithoutDiscretionaryBreaks(line) + '-';
  return Number(measure(rendered)) <= maxWidth ? rendered : null;
}

function splitOverwideTokenByGrapheme(value, maxWidth, measure, segmenter) {
  if (!value || !Number.isFinite(maxWidth) || !(maxWidth > 0) || Number(measure(value)) <= maxWidth) return [value];
  const clusters = textGraphemes(value, segmenter);
  if (clusters.length < 2) return [value];
  const cjkAware = clusters.some(isCjkLineBreakCharacter);
  const chunks = [];
  let current = '';
  let currentClusters = 0;
  let previousCluster = '';
  for (const cluster of clusters) {
    const candidate = current + cluster;
    const legalBreak = canBreakBetweenGraphemes(previousCluster, cluster)
      && (!cjkAware || currentClusters >= maxGraphemesPerProbe || isCjkLineBreak(previousCluster, cluster));
    if (current && legalBreak && (currentClusters >= maxGraphemesPerProbe || Number(measure(candidate)) > maxWidth)) {
      chunks.push(current);
      current = cluster;
      currentClusters = 1;
      previousCluster = cluster;
    } else {
      current = candidate;
      currentClusters += 1;
      previousCluster = cluster;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitOverwideToken(token, maxWidth, measure, segmenter = graphemeSegmenter) {
  const value = String(token ?? '');
  if (!value) return [value];
  const clusters = textGraphemes(value, segmenter);
  const hasDiscretionaryBreak = clusters.some(cluster => discretionaryBreakKind(cluster));
  if (!hasDiscretionaryBreak) return splitOverwideTokenByGrapheme(value, maxWidth, measure, segmenter);

  const units = plainDiscretionaryUnits(clusters);
  const visible = plainUnitsText(units);
  if (!Number.isFinite(maxWidth) || !(maxWidth > 0) || Number(measure(visible)) <= maxWidth) return [value];

  const chunks = [];
  let remaining = units;
  while (remaining.length && Number(measure(plainUnitsText(remaining))) > maxWidth) {
    let selected = null;
    for (let index = 0; index < remaining.length - 1; index += 1) {
      const kind = remaining[index].breakAfter;
      if (!kind || !canBreakBetweenGraphemes(remaining[index].text, remaining[index + 1].text)) continue;
      const prefix = plainUnitsText(remaining.slice(0, index + 1)) + (kind === 'soft-hyphen' ? '-' : '');
      if (Number(measure(prefix)) <= maxWidth) selected = { index, prefix };
    }
    if (!selected) break;
    chunks.push(selected.prefix);
    remaining = remaining.slice(selected.index + 1);
  }
  if (chunks.length) {
    if (Number(measure(plainUnitsText(remaining))) > maxWidth) {
      chunks.push(...splitOverwideTokenByGrapheme(plainUnitsText(remaining), maxWidth, measure, segmenter));
    } else {
      const tail = plainUnitsRawText(remaining);
      if (tail) chunks.push(tail);
    }
    return chunks;
  }
  return splitOverwideTokenByGrapheme(visible, maxWidth, measure, segmenter);
}

function paragraphWrapPieces(text, maxWidth, measure, {
  graphemeSegmenter: graphemes = graphemeSegmenter,
  wordSegmenter: thaiWords = thaiWordSegmenter
} = {}) {
  const value = String(text ?? '');
  const clusters = textGraphemes(value, graphemes);
  const thaiBreaks = thaiWordBreakOffsets(value, thaiWords);
  const pieces = [];
  let word = '';
  let whitespace = '';
  let previous = '';
  let offset = 0;
  const flushWord = () => {
    if (!word) return;
    pieces.push(...splitOverwideToken(word, maxWidth, measure, graphemes));
    word = '';
  };
  const flushWhitespace = () => {
    if (!whitespace) return;
    pieces.push(whitespace);
    whitespace = '';
  };

  for (const cluster of clusters) {
    if (isBreakableWhitespace(cluster)) {
      flushWord();
      whitespace += cluster;
    } else {
      flushWhitespace();
      const thaiBoundary = !discretionaryBreakKind(previous) && !discretionaryBreakKind(cluster) && thaiBreaks.has(offset);
      const cjkBoundary = !discretionaryBreakKind(cluster) && isCjkLineBreak(previous, cluster);
      if (word && (thaiBoundary || cjkBoundary)) flushWord();
      word += cluster;
    }
    previous = cluster;
    offset += cluster.length;
  }
  flushWord();
  flushWhitespace();
  return pieces;
}

export function transformTextCase(text, mode = 'none') {
  const value = String(text ?? '');
  if (mode === 'uppercase') return value.toUpperCase();
  if (mode === 'lowercase') return value.toLowerCase();
  if (mode !== 'capitalize') return value;
  if (wordSegmenter) {
    return Array.from(wordSegmenter.segment(value), part => {
      if (!part.isWordLike) return part.segment;
      const first = textGraphemes(part.segment)[0] || '';
      return first.toUpperCase() + part.segment.slice(first.length);
    }).join('');
  }
  return value.replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_match, boundary, letter) => `${boundary}${letter.toUpperCase()}`);
}

export function measureTrackedText(ctx, text, letterSpacing = 0) {
  const value = String(text ?? '');
  const spacing = Number(letterSpacing) || 0;
  if (spacing && complexShapingText.test(value)) {
    if (typeof ctx.letterSpacing === 'string') {
      const previous = ctx.letterSpacing;
      try {
        ctx.letterSpacing = `${spacing}px`;
        return ctx.measureText(value).width;
      } finally { ctx.letterSpacing = previous; }
    }
    // Drawing each grapheme independently would destroy joining and bidi
    // order. Keep browser-shaped runs whole when native canvas tracking is not
    // available, and measure the same untracked fallback width.
    return ctx.measureText(value).width;
  }
  const count = textGraphemes(value).length;
  return ctx.measureText(value).width + Math.max(0, count - 1) * spacing;
}

export function requiresComplexTextShaping(text) {
  return complexShapingText.test(String(text ?? ''));
}

export function wrapText(ctx, text, maxWidth, letterSpacing = 0) {
  return wrapTextWithMeasure(text, maxWidth, candidate => measureTrackedText(ctx, candidate, letterSpacing));
}

export function wrapTextWithMeasure(text, maxWidth, measure, options = {}) {
  const mode = ['auto', 'balance', 'pretty'].includes(options.textWrapStyle) ? options.textWrapStyle : 'auto';
  const output = [];
  for (const paragraph of String(text ?? '').split(/\r\n|\r|\n/u)) {
    const lines = wrapParagraphAuto(paragraph, maxWidth, measure, options);
    output.push(...(mode === 'auto' || !Number.isFinite(Number(maxWidth))
      ? lines : applyWrapStyle(paragraph, Number(maxWidth), measure, lines, mode)));
  }
  return output;
}

function wrapParagraphAuto(paragraph, maxWidth, measure, options) {
  const lines = [];
  const pieces = paragraphWrapPieces(paragraph, maxWidth, measure, options);
  let line = '';
  let pendingWhitespace = '';
  for (const piece of pieces) {
    if (/^\s+$/u.test(piece)) {
      if (line) pendingWhitespace += piece;
      else line += piece;
      continue;
    }
    const candidate = `${line}${pendingWhitespace}${piece}`;
    const lineHasContent = line && !/^\s+$/u.test(line);
    if (lineHasContent && measure(visibleTextWithoutDiscretionaryBreaks(candidate)) > maxWidth) {
      const linePrefix = `${line}${pendingWhitespace}`;
      const discretionary = findPlainDiscretionaryBreak(piece, linePrefix, maxWidth, measure, options.graphemeSegmenter);
      if (discretionary) {
        lines.push(visibleTextWithoutDiscretionaryBreaks(`${linePrefix}${discretionary.prefix}`));
        line = discretionary.suffix;
      } else {
        const trailingHyphenLine = plainLineWithTrailingSoftHyphen(
          line, piece, Boolean(pendingWhitespace), maxWidth, measure, options.graphemeSegmenter
        );
        lines.push(trailingHyphenLine || visibleTextWithoutDiscretionaryBreaks(line));
        line = piece;
      }
    } else line = candidate;
    pendingWhitespace = '';
  }
  lines.push(visibleTextWithoutDiscretionaryBreaks(`${line}${pendingWhitespace}`));
  return lines;
}

const maxStyledWrapWords = 96;

function applyWrapStyle(paragraph, maxWidth, measure, autoLines, mode) {
  // Keep existing Unicode break opportunities for scripts and tokens that do
  // not form ordinary whitespace-delimited words.
  const words = paragraph.match(/\S+/gu) || [];
  if (words.length < 2 || words.length > maxStyledWrapWords
    || /[\u00ad\u200b\u00a0\u2007\u202f\u2060\ufeff\u2011]/u.test(paragraph)
    || textGraphemes(paragraph).some(cluster => isCjkLineBreakCharacter(cluster))) return autoLines;
  const separators = [...paragraph.matchAll(/\s+/gu)].map(match => match[0]);
  const requestedLines = autoLines.length;
  if (mode === 'balance') return partitionWords(words, separators, maxWidth, measure, requestedLines, false) || autoLines;
  for (let count = Math.min(requestedLines, words.length); count >= 1; count -= 1) {
    const result = partitionWords(words, separators, maxWidth, measure, count, true);
    if (result) return result;
  }
  return autoLines;
}

function partitionWords(words, separators, maxWidth, measure, lineCount, avoidOrphan) {
  const memo = new Map();
  const build = (start, linesLeft) => {
    if (start === words.length) return linesLeft === 0 ? { cost: 0, lines: [] } : null;
    if (linesLeft <= 0 || words.length - start < linesLeft) return null;
    const key = `${start}:${linesLeft}`;
    if (memo.has(key)) return memo.get(key);
    let best = null;
    for (let end = start; end <= words.length - linesLeft; end += 1) {
      const line = words.slice(start, end + 1).reduce((value, word, index) =>
        index ? `${value}${separators[start + index - 1] || ' '}${word}` : word, '');
      const width = Number(measure(line));
      if (width > maxWidth && end > start) break;
      if (width > maxWidth) continue;
      if (avoidOrphan && linesLeft === 1 && end === start && words.length > 1) continue;
      const rest = build(end + 1, linesLeft - 1);
      if (!rest) continue;
      const raggedness = maxWidth - width;
      const candidate = { cost: raggedness * raggedness + rest.cost, lines: [line, ...rest.lines] };
      if (!best || candidate.cost < best.cost) best = candidate;
    }
    memo.set(key, best);
    return best;
  };
  return build(0, lineCount)?.lines || null;
}

function nonNegativeTextMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10_000, number)) : 0;
}

const maxTextParagraphStyles = 100_000;
const maxTextListLevel = 4;
const listIndentStep = 24;
const listMarkerGap = 8;

function normalizedParagraphStyle(style) {
  const listStyle = ['bulleted', 'numbered'].includes(style?.listStyle) ? style.listStyle : 'none';
  const listLevel = Number.isInteger(style?.listLevel) && style.listLevel >= 0 && style.listLevel <= maxTextListLevel
    ? style.listLevel : 0;
  const normalized = { listStyle, listLevel: listStyle === 'none' ? 0 : listLevel };
  if (listStyle === 'numbered' && Number.isInteger(style?.listStart) && style.listStart >= 1 && style.listStart <= 999_999) {
    normalized.listStart = style.listStart;
  }
  if (['left', 'center', 'right', 'justify'].includes(style?.align)) normalized.align = style.align;
  if (['auto', 'balance', 'pretty'].includes(style?.textWrapStyle)) normalized.textWrapStyle = style.textWrapStyle;
  return normalized;
}

/** Return canonical metadata aligned one-to-one with CR/LF-delimited paragraphs. */
export function normalizeTextParagraphStyles(text, paragraphStyles = []) {
  const paragraphCount = String(text ?? '').replace(/\r\n?/gu, '\n').split('\n').length;
  if (paragraphCount > maxTextParagraphStyles) throw new RangeError('Text can contain at most 100,000 formatted paragraphs.');
  return Array.from({ length: paragraphCount }, (_, index) => normalizedParagraphStyle(paragraphStyles?.[index]));
}

function alphabeticCounter(value) {
  let number = Math.max(1, Math.floor(value));
  let label = '';
  while (number > 0 && label.length < 12) {
    number -= 1;
    label = String.fromCharCode(97 + number % 26) + label;
    number = Math.floor(number / 26);
  }
  return label || 'a';
}

function romanCounter(value) {
  let number = Math.max(1, Math.floor(value));
  if (number > 3999) return String(number);
  const symbols = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let label = '';
  for (const [amount, symbol] of symbols) while (number >= amount) { label += symbol; number -= amount; }
  return label;
}

function numberedListMarker(counter, level) {
  const format = level % 3;
  const label = format === 1 ? alphabeticCounter(counter) : format === 2 ? romanCounter(counter) : String(counter);
  return `${label}.`;
}

function createParagraphListPlans(paragraphStyles, paragraphCount, measureMarker, markerStyles = []) {
  const styles = Array.from({ length: paragraphCount }, (_, index) => normalizedParagraphStyle(paragraphStyles?.[index]));
  const counters = new Map();
  const activeStyles = new Map();
  const plans = styles.map((style, index) => {
    if (style.listStyle === 'none') {
      counters.clear(); activeStyles.clear();
      return { ...style, markerText: '', markerStyle: markerStyles[index] || null };
    }
    for (const level of [...activeStyles.keys()]) if (level > style.listLevel) activeStyles.delete(level);
    for (const level of [...counters.keys()]) if (level > style.listLevel) counters.delete(level);
    if (activeStyles.get(style.listLevel) !== style.listStyle) counters.delete(style.listLevel);
    activeStyles.set(style.listLevel, style.listStyle);
    let markerText = '•';
    if (style.listStyle === 'numbered') {
      const counter = style.listStart ?? (counters.get(style.listLevel) || 0) + 1;
      counters.set(style.listLevel, counter);
      markerText = numberedListMarker(counter, style.listLevel);
    }
    const markerStyle = markerStyles[index] || null;
    const naturalWidth = Math.max(0, Number(measureMarker(markerText, markerStyle)) || 0);
    return { ...style, markerText, markerStyle, naturalWidth, nestingIndent: style.listLevel * listIndentStep };
  });
  const columnWidths = new Map();
  for (const plan of plans) if (plan.listStyle !== 'none') {
    const key = `${plan.listStyle}:${plan.listLevel}`;
    columnWidths.set(key, Math.max(columnWidths.get(key) || 0, plan.naturalWidth || 0));
  }
  for (const plan of plans) if (plan.listStyle !== 'none') {
    plan.markerColumnWidth = columnWidths.get(`${plan.listStyle}:${plan.listLevel}`) || 0;
    plan.markerGap = listMarkerGap;
    plan.contentIndent = plan.nestingIndent + plan.markerColumnWidth + plan.markerGap;
    plan.markerAnchorX = plan.nestingIndent + plan.markerColumnWidth;
  }
  return plans;
}

function paragraphBreakSpacing(index, plans, paragraphSpacing, listSpacing) {
  if (index <= 0) return 0;
  return plans[index - 1]?.listStyle !== 'none' && plans[index]?.listStyle !== 'none'
    ? listSpacing : paragraphSpacing;
}

function wrapParagraphWithFirstLineWidth(text, firstLineWidth, continuationWidth, measure, options = {}) {
  const lines = [];
  const pieces = paragraphWrapPieces(text, Math.min(firstLineWidth, continuationWidth), measure, options);
  let line = '';
  let pendingWhitespace = '';
  let lineWidth = firstLineWidth;
  for (const piece of pieces) {
    if (isBreakableWhitespace(piece)) {
      if (line) pendingWhitespace += piece;
      else line += piece;
      continue;
    }
    const candidate = `${line}${pendingWhitespace}${piece}`;
    const lineHasContent = line && !/^\s+$/u.test(line);
    if (lineHasContent && measure(visibleTextWithoutDiscretionaryBreaks(candidate)) > lineWidth) {
      const linePrefix = `${line}${pendingWhitespace}`;
      const discretionary = findPlainDiscretionaryBreak(piece, linePrefix, lineWidth, measure, options.graphemeSegmenter);
      if (discretionary) {
        lines.push(visibleTextWithoutDiscretionaryBreaks(`${linePrefix}${discretionary.prefix}`));
        line = discretionary.suffix;
      } else {
        const trailingHyphenLine = plainLineWithTrailingSoftHyphen(
          line, piece, Boolean(pendingWhitespace), lineWidth, measure, options.graphemeSegmenter
        );
        lines.push(trailingHyphenLine || visibleTextWithoutDiscretionaryBreaks(line));
        line = piece;
      }
      lineWidth = continuationWidth;
    } else line = candidate;
    pendingWhitespace = '';
  }
  lines.push(visibleTextWithoutDiscretionaryBreaks(`${line}${pendingWhitespace}`));
  return lines;
}

function indentWithinWidth(indent, width) {
  return Number.isFinite(width) ? Math.min(indent, Math.max(0, width - 1)) : indent;
}

function justificationGapCount(text) {
  const value = String(text ?? '');
  let gaps = 0;
  let hasTextBefore = false;
  for (const match of value.matchAll(/\s+|\S+/gu)) {
    if (/^\s+$/u.test(match[0])) {
      const next = value.slice(match.index + match[0].length);
      if (hasTextBefore && /^\S/u.test(next)) gaps += textGraphemes(match[0]).length;
    } else hasTextBefore = true;
  }
  return gaps;
}

function textOverflowLimit(lines, { maxLines, maxHeight, boxHeight, heightForLines }) {
  const lineLimit = Number.isInteger(maxLines) && maxLines > 0 ? maxLines : Infinity;
  const heights = [maxHeight, boxHeight].filter(value => value != null).map(Number).filter(value => Number.isFinite(value) && value >= 0);
  const heightLimit = heights.length ? Math.min(...heights) : Infinity;
  let count = 0;
  for (const line of lines) {
    const lineTop = Number(line.y) || 0;
    const lineBottom = heightForLines ? heightForLines(lines, count + 1) : lineTop + (Number(line.lineHeight) || 0);
    if (count >= lineLimit || !heightForLines && lineTop >= heightLimit || lineBottom > heightLimit) break;
    count += 1;
  }
  return count;
}

function truncatePlainLine(line, width, measure, graphemes) {
  const clusters = textGraphemes(line.displayText, graphemes);
  while (clusters.length && /^\s+$/u.test(clusters.at(-1))) clusters.pop();
  while (clusters.length && Number(measure(`${clusters.join('')}…`)) > width) clusters.pop();
  const displayText = `${clusters.join('')}…`;
  const naturalWidth = Math.max(0, Number(measure(displayText)) || 0);
  line.displayText = displayText;
  line.naturalWidth = naturalWidth;
  line.width = Number.isFinite(width) ? Math.min(width, naturalWidth) : naturalWidth;
  line.justify = false;
  line.justificationExtraSpace = 0;
}

function groupRichClusters(clusters) {
  const parts = [];
  for (const cluster of clusters) appendRichPart(parts, cluster.text, cluster.style);
  return parts;
}

function truncateRichLine(line, width, measure, graphemes, fallbackStyle) {
  const clusters = line.parts.flatMap(part => textGraphemes(part.text, graphemes).map(text => ({ text, style: part.style })));
  while (clusters.length && /^\s+$/u.test(clusters.at(-1).text)) clusters.pop();
  const candidateWidth = values => measuredPartsWidth(groupRichClusters(values), measure);
  const styleForEllipsis = () => [...clusters].reverse().find(cluster => !/^\s+$/u.test(cluster.text))?.style
    || clusters.at(-1)?.style || fallbackStyle;
  while (clusters.length) {
    const ellipsisStyle = styleForEllipsis();
    if (candidateWidth([...clusters, { text: '…', style: ellipsisStyle }]) <= width) break;
    clusters.pop();
  }
  const ellipsisStyle = styleForEllipsis();
  const parts = groupRichClusters([...clusters, { text: '…', style: ellipsisStyle }]);
  let offsetX = 0;
  line.parts = parts.map(part => {
    const partWidth = Math.max(0, Number(measure(part.text, part.style)) || 0);
    const positioned = { ...part, offsetX, width: partWidth };
    offsetX += partWidth;
    return positioned;
  });
  line.displayText = parts.map(part => part.text).join('');
  line.naturalWidth = offsetX;
  line.width = Number.isFinite(width) ? Math.min(width, offsetX) : offsetX;
  line.justify = false;
  line.justificationExtraSpace = 0;
}

function applyTextTruncation(layout, {
  textTruncation = 'disabled', maxLines = null, maxHeight = null, boxHeight = null,
  width = Infinity, measure, rich = false, graphemes = graphemeSegmenter, fallbackStyle = null, heightForLines
} = {}) {
  if (textTruncation !== 'ending') return layout;
  const visibleCount = textOverflowLimit(layout.lines, { maxLines, maxHeight, boxHeight, heightForLines });
  if (visibleCount >= layout.lines.length) return layout;
  const lines = layout.lines.slice(0, visibleCount);
  const lastLine = lines.at(-1);
  if (lastLine && typeof measure === 'function') {
    const availableWidth = Number.isFinite(width) ? Math.max(1, width - (Number(lastLine.indent) || 0)) : Infinity;
    if (rich) truncateRichLine(lastLine, availableWidth, measure, graphemes, fallbackStyle);
    else truncatePlainLine(lastLine, availableWidth, measure, graphemes);
  }
  const nextWidth = Math.max(0, ...lines.flatMap(line => [
    (Number(line.indent) || 0) + (Number(line.naturalWidth) || 0),
    line.marker ? (Number(line.marker.x) || 0) + (Number(line.marker.width) || 0) : 0
  ]));
  const last = lines.at(-1);
  return { ...layout, lines, width: nextWidth, height: last ? Number(last.y || 0) + Number(last.lineHeight || 0) : 0 };
}

/** Lay out unstyled text while treating explicit newlines as paragraph breaks. */
export function layoutPlainText(text, maxWidth, measure, {
  lineHeight = 0,
  paragraphSpacing = 0,
  firstLineIndent = 0,
  align = 'left',
  listSpacing = 0,
  paragraphStyles = [],
  textWrapStyle = 'auto',
  markerStyle = null,
  textTruncation = 'disabled',
  maxLines = null,
  maxHeight = null,
  boxHeight = null,
  wordSegmenter = thaiWordSegmenter,
  graphemeSegmenter: graphemes = graphemeSegmenter,
  leadingTrim, leadingTrimStyle = markerStyle || {}, shapeText = measure?.shapeText,
  leadingTrimMetrics = measure?.leadingTrimMetrics, strictLeadingTrim = false,
  textStyle = leadingTrimStyle, textLineMetrics = measure?.textLineMetrics, strictTextLineMetrics = false
} = {}) {
  if (typeof measure !== 'function') throw new TypeError('Text layout requires a measurement function.');
  const limit = Number(maxWidth);
  if (!(limit > 0) && limit !== Infinity) throw new TypeError('Text layout requires a positive maximum width.');
  const spacing = nonNegativeTextMetric(paragraphSpacing);
  const itemSpacing = nonNegativeTextMetric(listSpacing);
  const requestedIndent = nonNegativeTextMetric(firstLineIndent);
  const lineHeightPx = Math.max(0, Number(lineHeight) || 0);
  const lines = [];
  let y = 0;
  let width = 0;
  const paragraphs = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const plans = createParagraphListPlans(paragraphStyles, paragraphs.length, marker => measure(marker), paragraphs.map(() => markerStyle));

  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const plan = plans[paragraphIndex];
    y += paragraphBreakSpacing(paragraphIndex, plans, spacing, itemSpacing);
    const isListItem = plan.listStyle !== 'none';
    const firstIndent = paragraph || isListItem
      ? indentWithinWidth((isListItem ? plan.contentIndent : 0) + requestedIndent, limit) : 0;
    const continuationIndent = isListItem ? indentWithinWidth(plan.contentIndent, limit) : 0;
    const availableWidth = Number.isFinite(limit) ? Math.max(1, limit - firstIndent) : Infinity;
    const wrapStyle = plan.textWrapStyle || textWrapStyle;
    const wrapped = isListItem
      ? wrapParagraphWithFirstLineWidth(paragraph, availableWidth, Number.isFinite(limit) ? Math.max(1, limit - continuationIndent) : Infinity, measure, {
        wordSegmenter, graphemeSegmenter: graphemes
      })
      : wrapTextWithMeasure(paragraph, availableWidth, measure, { wordSegmenter, graphemeSegmenter: graphemes, textWrapStyle: wrapStyle });
    for (const [paragraphLineIndex, displayText] of wrapped.entries()) {
      const naturalWidth = Number(measure(displayText));
      const lineIndent = paragraphLineIndex === 0 ? firstIndent : continuationIndent;
      const lineLimit = Number.isFinite(limit) ? Math.max(1, limit - lineIndent) : Infinity;
      const gaps = justificationGapCount(displayText);
      const paragraphAlign = plan.align || align;
      const justify = paragraphAlign === 'justify' && Number.isFinite(lineLimit) && paragraphLineIndex < wrapped.length - 1 && gaps > 0 && naturalWidth < lineLimit;
      const visibleWidth = justify ? lineLimit : Number.isFinite(lineLimit) ? Math.min(lineLimit, naturalWidth) : naturalWidth;
      lines.push({
        displayText,
        align: paragraphAlign,
        index: lines.length,
        paragraphIndex,
        firstLine: paragraphLineIndex === 0,
        indent: lineIndent,
        listStyle: plan.listStyle,
        listLevel: plan.listLevel,
        marker: paragraphLineIndex === 0 && isListItem ? {
          listStyle: plan.listStyle, listLevel: plan.listLevel,
          text: plan.markerText, x: plan.nestingIndent, anchorX: plan.markerAnchorX,
          width: plan.naturalWidth, columnWidth: plan.markerColumnWidth, style: plan.markerStyle
        } : null,
        naturalWidth,
        width: visibleWidth,
        justify,
        justificationExtraSpace: justify ? (lineLimit - naturalWidth) / gaps : 0,
        y,
        lineHeight: lineHeightPx
      });
      width = Math.max(width, lineIndent + naturalWidth, paragraphLineIndex === 0 && isListItem ? plan.nestingIndent + plan.naturalWidth : 0);
      y += lineHeightPx;
    }
  }
  const trim = createTextLeadingTrimResolver({ ...leadingTrimStyle, leadingTrim: leadingTrim ?? leadingTrimStyle.leadingTrim }, {
    shapeText, measureMetrics: leadingTrimMetrics, strict: strictLeadingTrim });
  const metricLayout = resolveTextLineLayout({ lines, width, height: y }, { baseStyle: textStyle, shapeText, measureMetrics: textLineMetrics, strict: strictTextLineMetrics });
  const truncated = applyTextTruncation(metricLayout, {
    textTruncation, maxLines, maxHeight, boxHeight, width: limit, measure, graphemes,
    ...(trim.active ? { heightForLines: trim.heightForLines } : {})
  });
  return trim.resolve(truncated === metricLayout ? truncated : resolveTextLineLayout(truncated, { baseStyle: textStyle, shapeText, measureMetrics: textLineMetrics, strict: strictTextLineMetrics, preserveLineBoxes: true }));
}

export function resolvedLineHeight(value, fontSize, unit = 'ratio') {
  const size = Math.max(1, Number(fontSize) || 24);
  const amount = Number(value);
  if (unit === 'auto') return size * 1.2;
  if (!Number.isFinite(amount) || amount <= 0) return size * 1.25;
  if (unit === 'pixels') return amount;
  if (unit === 'percent') return size * amount / 100;
  return size * amount;
}

const richTextStyleKeys = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontAxes', 'fontFeatures', 'lineHeight', 'lineHeightUnit', 'letterSpacing', 'letterSpacingUnit', 'color', 'textDecoration', ...TEXT_DECORATION_PROPERTIES, 'baselineShift', 'textPosition', 'authoredFontSize', 'textPositionScaleX', 'textPositionOffsetX', 'textPositionTopOffset', 'textPositionBaselineOffset', 'leadingTrim'];

function richTextStyle(base, run) {
  const style = {};
  for (const key of richTextStyleKeys) style[key] = run[key] ?? base[key];
  if (run.lineHeight !== undefined && run.lineHeightUnit === undefined) style.lineHeightUnit = 'ratio';
  style.fontFamily ||= 'Arial, sans-serif';
  style.fontSize = Math.max(style.authoredFontSize ? .001 : 1, Number(style.fontSize) || 24);
  style.fontWeight = Number(style.fontWeight) || 400;
  style.fontStyle = style.fontStyle === 'italic' ? 'italic' : 'normal';
  style.lineHeight = Math.max(.1, Number(style.lineHeight) || 1.25);
  style.lineHeightUnit = ['auto', 'pixels', 'percent'].includes(style.lineHeightUnit) ? style.lineHeightUnit : 'ratio';
  Object.assign(style, inheritedTextLetterSpacing(base, run));
  style.letterSpacing = Number(style.letterSpacing) || 0;
  style.color ||= '#1e1e1e';
  style.textDecoration ||= 'none';
  Object.assign(style, textDecorationDefaults(style));
  style.baselineShift = Number(style.baselineShift) || 0;
  return style;
}

function transformRichCharacters(runs, textCase, baseStyle) {
  const characters = [];
  let offset = 0;
  for (const run of runs) {
    const style = richTextStyle(baseStyle, run);
    for (const text of textGraphemes(run.text)) {
      characters.push({ text, style, start: offset, end: offset + text.length });
      offset += text.length;
    }
  }
  if (textCase === 'uppercase') for (const item of characters) item.text = item.text.toUpperCase();
  else if (textCase === 'lowercase') for (const item of characters) item.text = item.text.toLowerCase();
  else if (textCase === 'capitalize') {
    const source = characters.map(item => item.text).join('');
    if (wordSegmenter) {
      let characterIndex = 0;
      for (const segment of wordSegmenter.segment(source)) {
        if (!segment.isWordLike) continue;
        while (characterIndex < characters.length && characters[characterIndex].start < segment.index) characterIndex += 1;
        if (characters[characterIndex]?.start === segment.index) characters[characterIndex].text = characters[characterIndex].text.toUpperCase();
      }
    } else {
      let inWord = false;
      for (const item of characters) {
        if (/^[\p{L}\p{N}]/u.test(item.text)) {
          if (!inWord) item.text = item.text.toUpperCase();
          inWord = true;
        } else if (!/^['’]$/u.test(item.text)) inWord = false;
      }
    }
  }
  return characters;
}

function appendRichPart(parts, text, style) {
  if (!text) return;
  const previous = parts.at(-1);
  if (previous && richTextStyleKeys.every(key => previous.style[key] === style[key])) previous.text += text;
  else parts.push({ text, style });
}

/** Displayed case spans shared by layout and glyph-feature preflight. */
export function textCaseStyleRuns(runs, textCase, baseStyle) {
  const parts = [];
  for (const character of transformRichCharacters(runs, textCase, baseStyle)) appendRichPart(parts, character.text, character.style);
  return parts;
}

function richUnitsRawParts(units) {
  const parts = [];
  for (const unit of units) {
    appendRichPart(parts, unit.text, unit.style);
    if (unit.breakAfter) {
      appendRichPart(parts, unit.breakAfter.kind === 'soft-hyphen' ? '\u00ad' : '\u200b', unit.breakAfter.style || unit.style);
    }
  }
  return parts;
}

function visibleRichParts(parts) {
  const visible = [];
  for (const part of parts) appendRichPart(visible, visibleTextWithoutDiscretionaryBreaks(part.text), part.style);
  return visible;
}

function flushTrailingRichWhitespace(paragraph) {
  if (!paragraph.words.length || !paragraph.pendingSpaceParts.length) return;
  const lastWord = paragraph.words.at(-1);
  for (const part of paragraph.pendingSpaceParts) appendRichPart(lastWord.parts, part.text, part.style);
  paragraph.pendingSpaceParts = [];
}

function measuredPartsWidth(parts, measure) {
  return visibleRichParts(parts).reduce((width, part) => width + Number(measure(part.text, part.style)), 0);
}

// Rich-text reflow explores candidate line breaks. Bound this optimization so
// large paragraphs keep the ordinary linear wrapping path and cannot turn a
// canvas measurement pass into cubic work.
function richParagraphText(words) {
  return words.map((word, index) => `${index ? word.separatorParts.map(part => part.text).join('') : ''}${word.parts.map(part => part.text).join('')}`).join('');
}

function canApplyRichWrapStyle(words, graphemes) {
  if (words.length < 2 || words.length > maxStyledWrapWords) return false;
  const text = richParagraphText(words);
  if (requiresComplexTextShaping(text)
    || /[\u00ad\u200b\u00a0\u2007\u202f\u2060\ufeff\u2011]/u.test(text)
    || textGraphemes(text, graphemes).some(cluster => isCjkLineBreakCharacter(cluster))) return false;
  return words.slice(1).every(word => word.separatorParts.length > 0
    && /^\s+$/u.test(word.separatorParts.map(part => part.text).join('')));
}

function partitionRichWords(words, widthForLine, measure, lineCount, avoidOrphan) {
  const memo = new Map();
  const candidateCache = new Map();
  const candidateFor = (start, end) => {
    const key = `${start}:${end}`;
    if (candidateCache.has(key)) return candidateCache.get(key);
    const parts = [];
    for (let index = start; index <= end; index += 1) {
      if (index > start) for (const part of words[index].separatorParts) appendRichPart(parts, part.text, part.style);
      for (const part of words[index].parts) appendRichPart(parts, part.text, part.style);
    }
    const candidate = { parts, width: measuredPartsWidth(parts, measure) };
    candidateCache.set(key, candidate);
    return candidate;
  };
  const build = (start, linesLeft) => {
    if (start === words.length) return linesLeft === 0 ? { cost: 0, ranges: [] } : null;
    if (linesLeft <= 0 || words.length - start < linesLeft) return null;
    const key = `${start}:${linesLeft}`;
    if (memo.has(key)) return memo.get(key);
    const lineIndex = lineCount - linesLeft;
    const lineLimit = widthForLine(lineIndex);
    let best = null;
    for (let end = start; end <= words.length - linesLeft; end += 1) {
      const candidate = candidateFor(start, end);
      if (candidate.width > lineLimit) continue;
      if (avoidOrphan && linesLeft === 1 && end === start && words.length > 1) continue;
      const rest = build(end + 1, linesLeft - 1);
      if (!rest) continue;
      const slack = lineLimit - candidate.width;
      const result = { cost: slack * slack + rest.cost, ranges: [[start, end], ...rest.ranges] };
      if (!best || result.cost < best.cost) best = result;
    }
    memo.set(key, best);
    return best;
  };
  const result = build(0, lineCount);
  if (!result) return null;
  return result.ranges.map(([start, end]) => candidateFor(start, end).parts);
}

function richWrapStyleLines(words, mode, autoLineCount, widthForLine, measure, graphemes) {
  if (!['balance', 'pretty'].includes(mode) || !Number.isFinite(widthForLine(0))
    || !canApplyRichWrapStyle(words, graphemes)) return null;
  if (mode === 'balance') return partitionRichWords(words, widthForLine, measure, autoLineCount, false);
  for (let lineCount = Math.min(autoLineCount, words.length); lineCount >= 1; lineCount -= 1) {
    const result = partitionRichWords(words, widthForLine, measure, lineCount, true);
    if (result) return result;
  }
  return null;
}

function richDiscretionaryUnits(parts, segmenter) {
  const units = [];
  for (const part of parts) {
    for (const text of textGraphemes(part.text, segmenter)) {
      const kind = discretionaryBreakKind(text);
      if (kind) {
        const previous = units.at(-1);
        if (previous && (kind === 'soft-hyphen' || !previous.breakAfter)) {
          previous.breakAfter = { kind, style: part.style };
        }
      } else units.push({ text, style: part.style, breakAfter: null });
    }
  }
  return units;
}

function richUnitsParts(units, breakAfter = null) {
  const parts = [];
  for (const unit of units) appendRichPart(parts, unit.text, unit.style);
  if (breakAfter?.kind === 'soft-hyphen') {
    appendRichPart(parts, '-', breakAfter.style || units.at(-1)?.style);
  }
  return parts;
}

function findRichDiscretionaryBreak(parts, linePrefixParts, maxWidth, measure, segmenter) {
  const units = richDiscretionaryUnits(parts, segmenter);
  if (!units.some(unit => unit.breakAfter)) return null;
  let selected = null;
  for (let index = 0; index < units.length - 1; index += 1) {
    const opportunity = units[index].breakAfter;
    if (!opportunity) continue;
    const prefixParts = [];
    for (const part of [...linePrefixParts, ...richUnitsParts(units.slice(0, index + 1), opportunity)]) {
      appendRichPart(prefixParts, part.text, part.style);
    }
    const suffixParts = richUnitsRawParts(units.slice(index + 1));
    if (suffixParts.length && canBreakBetweenGraphemes(units[index].text, units[index + 1].text)
      && measuredPartsWidth(prefixParts, measure) <= maxWidth) {
      selected = { prefixParts, suffixParts };
    }
  }
  return selected;
}

function richLineWithTrailingSoftHyphen(lineParts, nextParts, hasSeparator, maxWidth, measure, segmenter) {
  if (hasSeparator) return null;
  const clusters = lineParts.flatMap(part => textGraphemes(part.text, segmenter).map(text => ({ text, style: part.style })));
  let markerStart = clusters.length;
  let hyphenStyle = null;
  while (markerStart > 0 && discretionaryBreakKind(clusters[markerStart - 1].text)) {
    const marker = clusters[markerStart - 1];
    if (discretionaryBreakKind(marker.text) === 'soft-hyphen') hyphenStyle = marker.style;
    markerStart -= 1;
  }
  if (!hyphenStyle || markerStart < 1) return null;
  const nextVisible = nextParts
    .flatMap(part => textGraphemes(part.text, segmenter).map(text => ({ text, style: part.style })))
    .find(unit => !discretionaryBreakKind(unit.text));
  const previousVisible = clusters[markerStart - 1].text;
  if (!nextVisible || !canBreakBetweenGraphemes(previousVisible, nextVisible.text)) return null;
  const rendered = visibleRichParts(lineParts);
  appendRichPart(rendered, '-', hyphenStyle);
  return measuredPartsWidth(rendered, measure) <= maxWidth ? rendered : null;
}

function splitRichWordByWidth(word, maxWidth, measure, segmenter) {
  const units = richDiscretionaryUnits(word.parts, segmenter);
  const hasDiscretionaryBreak = units.some(unit => unit.breakAfter);
  if (!hasDiscretionaryBreak) {
    if (!Number.isFinite(maxWidth) || !(maxWidth > 0) || measuredPartsWidth(word.parts, measure) <= maxWidth) return [word];
  } else {
    const visibleParts = richUnitsParts(units);
    if (!Number.isFinite(maxWidth) || !(maxWidth > 0) || measuredPartsWidth(visibleParts, measure) <= maxWidth) {
      return [word];
    }

    const discretionaryChunks = [];
    let remaining = units;
    while (remaining.length && measuredPartsWidth(richUnitsParts(remaining), measure) > maxWidth) {
      let selected = null;
      for (let index = 0; index < remaining.length - 1; index += 1) {
        const opportunity = remaining[index].breakAfter;
        if (!opportunity || !canBreakBetweenGraphemes(remaining[index].text, remaining[index + 1].text)) continue;
        const candidate = richUnitsParts(remaining.slice(0, index + 1), opportunity);
        if (measuredPartsWidth(candidate, measure) <= maxWidth) selected = { index, parts: candidate };
      }
      if (!selected) break;
      discretionaryChunks.push({
        parts: selected.parts,
        separatorParts: discretionaryChunks.length ? [] : word.separatorParts
      });
      remaining = remaining.slice(selected.index + 1);
    }
    if (discretionaryChunks.length) {
      const tail = richUnitsRawParts(remaining);
      if (measuredPartsWidth(tail, measure) > maxWidth) {
        discretionaryChunks.push(...splitRichWordByWidth({ parts: tail, separatorParts: [] }, maxWidth, measure, segmenter));
      } else if (tail.length) discretionaryChunks.push({ parts: tail, separatorParts: [] });
      return discretionaryChunks;
    }
  }

  if (units.length < 2) return [word];
  const chunks = [];
  let parts = [];
  let graphemeCount = 0;
  let previousCluster = '';
  const cjkAware = units.some(unit => isCjkLineBreakCharacter(unit.text));
  const flush = () => {
    if (!parts.length) return;
    chunks.push({ parts, separatorParts: chunks.length ? [] : word.separatorParts });
    parts = [];
    graphemeCount = 0;
    previousCluster = '';
  };
  for (const unit of units) {
    const candidate = parts.map(part => ({ ...part }));
    appendRichPart(candidate, unit.text, unit.style);
    const legalBreak = canBreakBetweenGraphemes(previousCluster, unit.text)
      && (!cjkAware || graphemeCount >= maxGraphemesPerProbe || isCjkLineBreak(previousCluster, unit.text));
    if (parts.length && legalBreak && (graphemeCount >= maxGraphemesPerProbe || measuredPartsWidth(candidate, measure) > maxWidth)) flush();
    appendRichPart(parts, unit.text, unit.style);
    graphemeCount += 1;
    previousCluster = unit.text;
  }
  flush();
  return chunks;
}

/**
 * Wrap and measure a rich-text run list using a caller-supplied font measurement function.
 * Each run only needs to specify style overrides; unspecified values inherit from baseStyle.
 * Returned run offsets are natural positions. Long unbreakable tokens fall back to grapheme
 * line breaks so the editor does not compress an entire word to fit its text box.
 */
export function layoutTextRuns(runs, maxWidth, baseStyle, measure, {
  wordSegmenter: thaiWords = thaiWordSegmenter,
  graphemeSegmenter: graphemes = graphemeSegmenter,
  textTruncation = 'disabled', maxLines = null, maxHeight = null, boxHeight = null,
  shapeText = baseStyle.shapeText || measure?.shapeText, leadingTrimMetrics = measure?.leadingTrimMetrics,
  strictLeadingTrim = false, textLineMetrics = measure?.textLineMetrics, strictTextLineMetrics = false
} = {}) {
  if (!Array.isArray(runs) || typeof measure !== 'function') throw new TypeError('Rich text layout requires runs and a measurement function.');
  const limit = Number(maxWidth);
  if (!(limit > 0) && limit !== Infinity) throw new TypeError('Rich text layout requires a positive maximum width.');
  const paragraphs = [{ words: [], current: [], pendingSpaceParts: [] }];
  const finishWord = paragraph => {
    if (!paragraph.current.length) return;
    paragraph.words.push({
      parts: paragraph.current,
      separatorParts: paragraph.words.length ? paragraph.pendingSpaceParts : []
    });
    paragraph.current = [];
    paragraph.pendingSpaceParts = [];
  };

  const characters = transformRichCharacters(runs, baseStyle.textCase || 'none', baseStyle);
  const thaiBreaks = thaiWordBreakOffsets(characters.map(character => character.text).join(''), thaiWords);
  let textOffset = 0;
  let previousCluster = '';
  for (let characterIndex = 0; characterIndex < characters.length; characterIndex += 1) {
    const character = characters[characterIndex];
    const paragraph = paragraphs.at(-1);
    if (character.text === '\n' || character.text === '\r' || character.text === '\r\n') {
      finishWord(paragraph);
      flushTrailingRichWhitespace(paragraph);
      paragraphs.push({ words: [], current: [], pendingSpaceParts: [] });
      textOffset += character.text.length;
      previousCluster = '';
      if (character.text === '\r' && characters[characterIndex + 1]?.text === '\n') {
        textOffset += characters[characterIndex + 1].text.length;
        characterIndex += 1;
      }
    } else if (isBreakableWhitespace(character.text)) {
      if (paragraph.current.length) finishWord(paragraph);
      if (paragraph.words.length) appendRichPart(paragraph.pendingSpaceParts, character.text, character.style);
      else appendRichPart(paragraph.current, character.text, character.style);
      textOffset += character.text.length;
      previousCluster = '';
    } else {
      const thaiBoundary = !discretionaryBreakKind(previousCluster) && !discretionaryBreakKind(character.text)
        && thaiBreaks.has(textOffset);
      const cjkBoundary = !discretionaryBreakKind(character.text) && isCjkLineBreak(previousCluster, character.text);
      if (paragraph.current.length && (thaiBoundary || cjkBoundary)) finishWord(paragraph);
      appendRichPart(paragraph.current, character.text, character.style);
      textOffset += character.text.length;
      previousCluster = character.text;
    }
  }
  for (const paragraph of paragraphs) {
    finishWord(paragraph);
    flushTrailingRichWhitespace(paragraph);
  }

  const fallback = richTextStyle(baseStyle, {});
  const plans = createParagraphListPlans(
    baseStyle.paragraphStyles,
    paragraphs.length,
    (markerText, markerStyle) => measure(markerText, markerStyle || fallback),
    paragraphs.map(paragraph => paragraph.words[0]?.parts[0]?.style || paragraph.current[0]?.style || fallback)
  );
  const rawLines = [];
  const paragraphSpacing = nonNegativeTextMetric(baseStyle.paragraphSpacing);
  const listSpacing = nonNegativeTextMetric(baseStyle.listSpacing);
  const requestedIndent = nonNegativeTextMetric(baseStyle.firstLineIndent);
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const plan = plans[paragraphIndex];
    const isListItem = plan.listStyle !== 'none';
    const contentIndent = isListItem ? plan.contentIndent : 0;
    const firstIndent = indentWithinWidth(contentIndent + requestedIndent, limit);
    const continuationIndent = indentWithinWidth(contentIndent, limit);
    const wordWidthLimit = Number.isFinite(limit)
      ? Math.max(1, limit - Math.max(firstIndent, continuationIndent)) : Infinity;
    const words = paragraph.words.flatMap(word => splitRichWordByWidth(word, wordWidthLimit, measure, graphemes));
    const paragraphRawLines = [];
    let line = [];
    let firstLine = true;
    for (const word of words) {
      const candidate = line.length
        ? [...line, ...word.separatorParts, ...word.parts]
        : word.parts;
      const mergedCandidate = [];
      for (const part of candidate) appendRichPart(mergedCandidate, part.text, part.style);
      const indent = firstLine ? firstIndent : continuationIndent;
      const lineLimit = Number.isFinite(limit) ? Math.max(1, limit - indent) : Infinity;
      if (line.length && measuredPartsWidth(mergedCandidate, measure) > lineLimit) {
        const discretionary = findRichDiscretionaryBreak(
          word.parts, [...line, ...word.separatorParts], lineLimit, measure, graphemes
        );
        if (discretionary) {
          paragraphRawLines.push({ parts: discretionary.prefixParts, paragraphIndex, firstLine, plan });
          line = discretionary.suffixParts;
        } else {
          const trailingHyphenParts = richLineWithTrailingSoftHyphen(
            line, word.parts, word.separatorParts.length > 0, lineLimit, measure, graphemes
          );
          paragraphRawLines.push({ parts: trailingHyphenParts || line, paragraphIndex, firstLine, plan });
          line = word.parts;
        }
        firstLine = false;
      } else line = mergedCandidate;
    }
    paragraphRawLines.push({ parts: line, paragraphIndex, firstLine, plan });
    const wrapStyle = plan.textWrapStyle || baseStyle.textWrapStyle || 'auto';
    const styledLines = richWrapStyleLines(
      words, wrapStyle, paragraphRawLines.length,
      lineIndex => Number.isFinite(limit)
        ? Math.max(1, limit - (lineIndex === 0 ? firstIndent : continuationIndent)) : Infinity,
      measure, graphemes
    );
    if (styledLines) {
      rawLines.push(...styledLines.map((parts, lineIndex) => ({ parts, paragraphIndex, firstLine: lineIndex === 0, plan })));
    } else rawLines.push(...paragraphRawLines);
  }

  let y = 0;
  const lines = rawLines.map(({ parts, paragraphIndex, firstLine, plan }, index) => {
    if (firstLine && paragraphIndex > 0) y += paragraphBreakSpacing(paragraphIndex, plans, paragraphSpacing, listSpacing);
    const isListItem = plan.listStyle !== 'none';
    const contentIndent = isListItem ? plan.contentIndent : 0;
    const indent = isListItem
      ? indentWithinWidth(contentIndent + (firstLine ? requestedIndent : 0), limit)
      : parts.length && firstLine ? indentWithinWidth(requestedIndent, limit) : 0;
    const lineLimit = Number.isFinite(limit) ? Math.max(1, limit - indent) : Infinity;
    const visibleParts = visibleRichParts(parts);
    const naturalWidth = measuredPartsWidth(visibleParts, measure);
    const displayText = visibleParts.map(part => part.text).join('');
    const gaps = justificationGapCount(displayText);
    const isLastParagraphLine = index === rawLines.length - 1 || rawLines[index + 1].paragraphIndex !== paragraphIndex;
    const paragraphAlign = plan.align || baseStyle.align || 'left';
    const justify = paragraphAlign === 'justify' && Number.isFinite(lineLimit) && !isLastParagraphLine && gaps > 0 && naturalWidth < lineLimit;
    const lineWidth = justify ? lineLimit : Number.isFinite(lineLimit) ? Math.min(lineLimit, naturalWidth) : naturalWidth;
    const lineHeight = visibleParts.length
      ? Math.max(...visibleParts.map(part => resolvedLineHeight(part.style.lineHeight, part.style.authoredFontSize || part.style.fontSize, part.style.lineHeightUnit)))
      : resolvedLineHeight(fallback.lineHeight, fallback.fontSize, fallback.lineHeightUnit);
    let offsetX = 0;
    const resolvedHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : fallback.fontSize * fallback.lineHeight;
    const positionedParts = visibleParts.map(part => {
      const width = Number(measure(part.text, part.style));
      const positioned = { ...part, offsetX, width };
      offsetX += width;
      return positioned;
    });
    const marker = firstLine && isListItem ? {
      listStyle: plan.listStyle, listLevel: plan.listLevel,
      text: plan.markerText, x: plan.nestingIndent, anchorX: plan.markerAnchorX,
      width: plan.naturalWidth, columnWidth: plan.markerColumnWidth, style: plan.markerStyle
    } : null;
    const current = {
      index, paragraphIndex, firstLine, indent, y, parts: positionedParts, naturalWidth, width: lineWidth, align: paragraphAlign,
      justify, justificationExtraSpace: justify ? (lineLimit - naturalWidth) / gaps : 0,
      lineHeight: resolvedHeight, displayText, listStyle: plan.listStyle, listLevel: plan.listLevel, marker
    };
    y += resolvedHeight;
    return current;
  });
  const layout = {
    lines,
    width: Math.max(0, ...lines.flatMap(line => [line.indent + line.naturalWidth, line.marker ? line.marker.x + line.marker.width : 0])),
    height: y
  };
  const trim = createTextLeadingTrimResolver({ ...baseStyle, textRuns: runs }, {
    shapeText, measureMetrics: leadingTrimMetrics, strict: strictLeadingTrim });
  const metricLayout = resolveTextLineLayout(layout, { baseStyle, shapeText, measureMetrics: textLineMetrics, strict: strictTextLineMetrics });
  const truncated = applyTextTruncation(metricLayout, {
    textTruncation, maxLines, maxHeight, boxHeight, width: limit, measure, rich: true, graphemes,
    fallbackStyle: fallback, ...(trim.active ? { heightForLines: trim.heightForLines } : {})
  });
  return trim.resolve(truncated === metricLayout ? truncated : resolveTextLineLayout(truncated, { baseStyle, shapeText, measureMetrics: textLineMetrics, strict: strictTextLineMetrics, preserveLineBoxes: true }));
}

export function calculateTextBox(ctx, node, {
  fontFamily = node.fontFamily,
  fontSize = node.fontSize,
  fontWeight = node.fontWeight,
  fontStyle = node.fontStyle,
  lineHeight = node.lineHeight,
  lineHeightUnit = node.lineHeightUnit || 'ratio',
  letterSpacing = node.letterSpacing,
  letterSpacingUnit = node.letterSpacingUnit,
  paragraphSpacing = node.paragraphSpacing,
  firstLineIndent = node.firstLineIndent,
  listSpacing = node.listSpacing,
  paragraphStyles = node.paragraphStyles,
  text = node.text,
  shapeText = null
} = {}) {
  const width = Math.max(0, Number(node.width) || 0);
  const height = Math.max(0, Number(node.height) || 0);
  const mode = node.textFit || 'auto-height';
  if (mode === 'fixed') return { width, height };

  const size = Math.max(1, Number(fontSize) || 24);
  const lineHeightPx = resolvedLineHeight(lineHeight, size, lineHeightUnit);
  const authoredSpacing = Number(letterSpacing) || 0;
  const textValue = transformTextCase(text, node.textCase || 'none');
  const family = fontFamily || 'Arial, sans-serif';
  const weight = Number(fontWeight) || 400;
  const style = fontStyle || 'normal';
  let resolvedNode = { ...node, fontFamily: family, fontWeight: weight, fontStyle: style, fontSize: size, letterSpacing: authoredSpacing, letterSpacingUnit };
  if (!node.__textPositionResolved) resolvedNode = resolveTextPositionView(resolvedNode, { shapeText }).node;
  ctx.font = `${style === 'italic' ? 'italic ' : ''}${canvasFontWeight(weight, node.fontAxes)} ${size}px ${family}`;
  const measure = (value, textStyle = resolvedNode) => {
    const shaped = shapeText?.(value, textStyle);
    if (shaped && !shaped.missingGlyph && Array.isArray(shaped.glyphs) && shaped.upem > 0) {
      let advance = 0;
      let boundaries = 0;
      for (let index = 0; index < shaped.glyphs.length; index += 1) {
        advance += Number(shaped.glyphs[index].xAdvance) || 0;
        if (index > 0 && shaped.glyphs[index].cluster !== shaped.glyphs[index - 1].cluster) boundaries += 1;
      }
        return Math.max(0, advance * (Number(textStyle.fontSize) || size) / shaped.upem * (textStyle.textPositionScaleX || 1) + boundaries * resolvedTextLetterSpacing(textStyle));
    }
    const scaleX = textStyle.textPositionScaleX || 1;
    return measureTrackedText(ctx, value, resolvedTextLetterSpacing(textStyle) / scaleX) * scaleX;
  };

  const richRuns = resolvedNode.textRuns;
  if (Array.isArray(richRuns) && richRuns.every(run => run && typeof run.text === 'string') && richRuns.map(run => run.text).join('') === String(text ?? '')) {
    const baseStyle = {
      fontFamily: family, fontSize: size,
      fontWeight: weight, fontStyle: style, fontAxes: node.fontAxes, fontFeatures: node.fontFeatures,
      lineHeight: Math.max(.1, Number(lineHeight) || 1.25), letterSpacing: authoredSpacing, letterSpacingUnit,
      lineHeightUnit,
      paragraphSpacing: nonNegativeTextMetric(paragraphSpacing),
      firstLineIndent: nonNegativeTextMetric(firstLineIndent),
      listSpacing: nonNegativeTextMetric(listSpacing),
      paragraphStyles,
      textWrapStyle: node.textWrapStyle || 'auto',
      align: node.align || 'left',
      color: node.color || '#1e1e1e', textDecoration: node.textDecoration || 'none',
      ...textDecorationDefaults(node),
      textCase: node.textCase || 'none', leadingTrim: node.leadingTrim, baselineShift: node.baselineShift
    };
    let layout;
    try {
      layout = layoutTextRuns(richRuns, mode === 'auto-width' ? Infinity : Math.max(1, width), baseStyle, (value, style) => {
        ctx.font = `${style.fontStyle === 'italic' ? 'italic ' : ''}${canvasFontWeight(style.fontWeight, style.fontAxes)} ${style.fontSize}px ${style.fontFamily}`;
        return measure(value, style);
      }, {
        textTruncation: node.textTruncation,
        maxLines: node.maxLines,
        maxHeight: node.maxHeight,
        shapeText, leadingTrimMetrics: textStyle => canvasLeadingTrimMetrics(ctx, textStyle),
        textLineMetrics: (textStyle, value) => canvasTextLineMetrics(ctx, textStyle, value)
      });
    } finally {
      ctx.font = `${style === 'italic' ? 'italic ' : ''}${canvasFontWeight(weight, node.fontAxes)} ${size}px ${family}`;
    }
    if (mode === 'auto-width') {
      const measuredHeight = layout.leadingTrim || layout.textLineMetrics ? Math.max(.001, layout.height) : Math.max(36, Math.ceil(layout.height + 4));
      return {
        width: Math.max(1, Math.min(100_000, Math.ceil(layout.width + 2))),
        height: node.textTruncation === 'ending' && Number.isFinite(node.maxHeight)
          ? Math.min(measuredHeight, node.maxHeight) : measuredHeight
      };
    }
    const measuredHeight = layout.leadingTrim || layout.textLineMetrics ? Math.max(.001, layout.height) : Math.max(36, Math.ceil(layout.height + 4));
    return { width, height: node.textTruncation === 'ending' && Number.isFinite(node.maxHeight)
      ? Math.min(measuredHeight, node.maxHeight) : measuredHeight };
  }

  if (mode === 'auto-width') {
    const layout = layoutPlainText(textValue, Infinity,
      line => measure(line, { ...resolvedNode }),
      { lineHeight: lineHeightPx, paragraphSpacing, firstLineIndent, listSpacing, paragraphStyles, align: node.align || 'left',
        textWrapStyle: node.textWrapStyle || 'auto',
        leadingTrim: node.leadingTrim, leadingTrimStyle: resolvedNode, shapeText,
        leadingTrimMetrics: textStyle => canvasLeadingTrimMetrics(ctx, textStyle),
        textLineMetrics: (textStyle, value) => canvasTextLineMetrics(ctx, textStyle, value),
        textTruncation: node.textTruncation, maxLines: node.maxLines, maxHeight: node.maxHeight, markerStyle: {
        fontFamily: family, fontSize: size, fontWeight: weight,
        fontStyle: style, letterSpacing: authoredSpacing, letterSpacingUnit, color: node.color || '#1e1e1e'
      } });
    const measuredHeight = layout.leadingTrim || layout.textLineMetrics ? Math.max(.001, layout.height) : Math.max(36, Math.ceil(layout.height + 4));
    return {
      width: Math.max(1, Math.min(100_000, Math.ceil(layout.width + 2))),
      height: node.textTruncation === 'ending' && Number.isFinite(node.maxHeight)
        ? Math.min(measuredHeight, node.maxHeight) : measuredHeight
    };
  }

  const layout = layoutPlainText(textValue, Math.max(1, width),
    line => measure(line, { ...resolvedNode }),
    { lineHeight: lineHeightPx, paragraphSpacing, firstLineIndent, listSpacing, paragraphStyles, align: node.align || 'left',
      textWrapStyle: node.textWrapStyle || 'auto',
      leadingTrim: node.leadingTrim, leadingTrimStyle: resolvedNode, shapeText,
      leadingTrimMetrics: textStyle => canvasLeadingTrimMetrics(ctx, textStyle),
      textLineMetrics: (textStyle, value) => canvasTextLineMetrics(ctx, textStyle, value),
      textTruncation: node.textTruncation, maxLines: node.maxLines, maxHeight: node.maxHeight, markerStyle: {
      fontFamily: family, fontSize: size, fontWeight: weight,
      fontStyle: style, letterSpacing: authoredSpacing, letterSpacingUnit, color: node.color || '#1e1e1e'
    } });
  const measuredHeight = layout.leadingTrim || layout.textLineMetrics ? Math.max(.001, layout.height) : Math.max(36, Math.ceil(layout.height + 4));
  return { width, height: node.textTruncation === 'ending' && Number.isFinite(node.maxHeight)
    ? Math.min(measuredHeight, node.maxHeight) : measuredHeight };
}

/** Keep an auto-width text layer's aligned top anchor fixed as its measured box changes. */
export function preserveAutoWidthTextAnchor(node, before, after) {
  if (node?.type !== 'text' || node.textFit !== 'auto-width'
    || node.variableBindings?.x || node.variableBindings?.y
    || !before || !after
    || ![before.x, before.y, before.width, before.height, before.rotation,
      after.x, after.y, after.width, after.height, after.rotation].every(Number.isFinite)
    || before.width === after.width && before.height === after.height) return false;

  const anchor = geometry => {
    const width = geometry.width;
    const height = geometry.height;
    const localX = node.align === 'center' ? width / 2 : node.align === 'right' ? width : 0;
    const radians = geometry.rotation * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return {
      x: geometry.x + width / 2 + cosine * (localX - width / 2) + sine * height / 2,
      y: geometry.y + height / 2 + sine * (localX - width / 2) - cosine * height / 2
    };
  };
  const previousAnchor = anchor(before);
  const resizedAnchor = anchor(after);
  node.x += previousAnchor.x - resizedAnchor.x;
  node.y += previousAnchor.y - resizedAnchor.y;
  return true;
}
