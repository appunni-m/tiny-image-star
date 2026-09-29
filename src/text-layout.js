const graphemeSegmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const wordSegmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;

export function textGraphemes(text) {
  const value = String(text ?? '');
  if (graphemeSegmenter) return [...graphemeSegmenter.segment(value)].map(part => part.segment);
  return Array.from(value);
}

export function transformTextCase(text, mode = 'none') {
  const value = String(text ?? '');
  if (mode === 'uppercase') return value.toUpperCase();
  if (mode === 'lowercase') return value.toLowerCase();
  if (mode !== 'capitalize') return value;
  if (wordSegmenter) {
    return [...wordSegmenter.segment(value)].map(part => {
      if (!part.isWordLike) return part.segment;
      const first = textGraphemes(part.segment)[0] || '';
      return first.toUpperCase() + part.segment.slice(first.length);
    }).join('');
  }
  return value.replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_match, boundary, letter) => `${boundary}${letter.toUpperCase()}`);
}

export function measureTrackedText(ctx, text, letterSpacing = 0) {
  const value = String(text ?? '');
  const count = textGraphemes(value).length;
  return ctx.measureText(value).width + Math.max(0, count - 1) * (Number(letterSpacing) || 0);
}

export function wrapText(ctx, text, maxWidth, letterSpacing = 0) {
  return wrapTextWithMeasure(text, maxWidth, candidate => measureTrackedText(ctx, candidate, letterSpacing));
}

export function wrapTextWithMeasure(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

const richTextStyleKeys = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'textDecoration'];

function richTextStyle(base, run) {
  const style = {};
  for (const key of richTextStyleKeys) style[key] = run[key] ?? base[key];
  style.fontFamily ||= 'Arial, sans-serif';
  style.fontSize = Math.max(1, Number(style.fontSize) || 24);
  style.fontWeight = Number(style.fontWeight) || 400;
  style.fontStyle = style.fontStyle === 'italic' ? 'italic' : 'normal';
  style.lineHeight = Math.max(.1, Number(style.lineHeight) || 1.25);
  style.letterSpacing = Number(style.letterSpacing) || 0;
  style.color ||= '#1e1e1e';
  style.textDecoration ||= 'none';
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

function measuredPartsWidth(parts, measure) {
  return parts.reduce((width, part) => width + Number(measure(part.text, part.style)), 0);
}

/**
 * Wrap and measure a rich-text run list using a caller-supplied font measurement function.
 * Each run only needs to specify style overrides; unspecified values inherit from baseStyle.
 * Returned run offsets are uncompressed natural positions. `width` is the visible line width
 * after matching the editor's max-width compression for a single unbreakable word.
 */
export function layoutTextRuns(runs, maxWidth, baseStyle, measure) {
  if (!Array.isArray(runs) || typeof measure !== 'function') throw new TypeError('Rich text layout requires runs and a measurement function.');
  const limit = Number(maxWidth);
  if (!(limit > 0) && limit !== Infinity) throw new TypeError('Rich text layout requires a positive maximum width.');
  const paragraphs = [{ words: [], current: [], pendingSpaceStyle: null }];
  const finishWord = paragraph => {
    if (!paragraph.current.length) return;
    paragraph.words.push({ parts: paragraph.current, spaceStyle: paragraph.words.length ? paragraph.pendingSpaceStyle : null });
    paragraph.current = [];
    paragraph.pendingSpaceStyle = null;
  };

  for (const character of transformRichCharacters(runs, baseStyle.textCase || 'none', baseStyle)) {
    const paragraph = paragraphs.at(-1);
    if (character.text === '\n' || character.text === '\r\n') {
      finishWord(paragraph);
      paragraphs.push({ words: [], current: [], pendingSpaceStyle: null });
    } else if (/^\s+$/u.test(character.text)) {
      finishWord(paragraph);
      if (paragraph.words.length && !paragraph.pendingSpaceStyle) paragraph.pendingSpaceStyle = character.style;
    } else appendRichPart(paragraph.current, character.text, character.style);
  }
  for (const paragraph of paragraphs) finishWord(paragraph);

  const rawLines = [];
  for (const paragraph of paragraphs) {
    let line = [];
    for (const word of paragraph.words) {
      const candidate = line.length
        ? [...line, { text: ' ', style: word.spaceStyle || line.at(-1).style }, ...word.parts]
        : word.parts;
      const mergedCandidate = [];
      for (const part of candidate) appendRichPart(mergedCandidate, part.text, part.style);
      if (line.length && measuredPartsWidth(mergedCandidate, measure) > limit) {
        rawLines.push(line);
        line = word.parts;
      } else line = mergedCandidate;
    }
    rawLines.push(line);
  }

  const fallback = richTextStyle(baseStyle, {});
  let y = 0;
  const lines = rawLines.map((parts, index) => {
    const naturalWidth = measuredPartsWidth(parts, measure);
    const lineWidth = Math.min(limit, naturalWidth);
    const lineHeight = parts.length
      ? Math.max(...parts.map(part => part.style.fontSize * part.style.lineHeight))
      : fallback.fontSize * fallback.lineHeight;
    let offsetX = 0;
    const resolvedHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : fallback.fontSize * fallback.lineHeight;
    const positionedParts = parts.map(part => {
      const width = Number(measure(part.text, part.style));
      const positioned = { ...part, offsetX, width };
      offsetX += width;
      return positioned;
    });
    const current = { index, y, parts: positionedParts, naturalWidth, width: lineWidth, lineHeight: resolvedHeight, displayText: positionedParts.map(part => part.text).join('') };
    y += resolvedHeight;
    return current;
  });
  return { lines, width: Math.max(0, ...lines.map(line => line.naturalWidth)), height: y };
}

export function calculateTextBox(ctx, node, { fontSize = node.fontSize, lineHeight = node.lineHeight, letterSpacing = node.letterSpacing, text = node.text } = {}) {
  const width = Math.max(0, Number(node.width) || 0);
  const height = Math.max(0, Number(node.height) || 0);
  const mode = node.textFit || 'auto-height';
  if (mode === 'fixed') return { width, height };

  const size = Math.max(1, Number(fontSize) || 24);
  const lineHeightPx = size * Math.max(.1, Number(lineHeight) || 1.25);
  const spacing = Number(letterSpacing) || 0;
  const textValue = transformTextCase(text, node.textCase || 'none');
  ctx.font = `${node.fontStyle === 'italic' ? 'italic ' : ''}${node.fontWeight || 400} ${size}px ${node.fontFamily || 'Arial, sans-serif'}`;

  const richRuns = node.textRuns;
  if (Array.isArray(richRuns) && richRuns.every(run => run && typeof run.text === 'string') && richRuns.map(run => run.text).join('') === String(text ?? '')) {
    const baseStyle = {
      fontFamily: node.fontFamily || 'Arial, sans-serif', fontSize: size,
      fontWeight: Number(node.fontWeight) || 400, fontStyle: node.fontStyle || 'normal',
      lineHeight: Math.max(.1, Number(lineHeight) || 1.25), letterSpacing: Number(letterSpacing) || 0,
      color: node.color || '#1e1e1e', textDecoration: node.textDecoration || 'none',
      textCase: node.textCase || 'none'
    };
    let layout;
    try {
      layout = layoutTextRuns(richRuns, mode === 'auto-width' ? Infinity : Math.max(1, width), baseStyle, (value, style) => {
        ctx.font = `${style.fontStyle === 'italic' ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
        return measureTrackedText(ctx, value, style.letterSpacing);
      });
    } finally {
      ctx.font = `${node.fontStyle === 'italic' ? 'italic ' : ''}${node.fontWeight || 400} ${size}px ${node.fontFamily || 'Arial, sans-serif'}`;
    }
    if (mode === 'auto-width') {
      return {
        width: Math.max(1, Math.min(100_000, Math.ceil(layout.width + 2))),
        height: Math.max(36, Math.ceil(layout.height + 4))
      };
    }
    return { width, height: Math.max(36, Math.ceil(layout.height + 4)) };
  }

  if (mode === 'auto-width') {
    const paragraphs = textValue.split('\n');
    const measured = Math.max(1, ...paragraphs.map(line => measureTrackedText(ctx, line, spacing)));
    return {
      width: Math.max(1, Math.min(100_000, Math.ceil(measured + 2))),
      height: Math.max(36, Math.ceil(paragraphs.length * lineHeightPx + 4))
    };
  }

  const lines = wrapText(ctx, textValue, Math.max(1, width), spacing);
  return { width, height: Math.max(36, Math.ceil(lines.length * lineHeightPx + 4)) };
}
