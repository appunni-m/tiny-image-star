const graphemeSegmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export function textGraphemes(text) {
  const value = String(text ?? '');
  if (graphemeSegmenter) return [...graphemeSegmenter.segment(value)].map(part => part.segment);
  return Array.from(value);
}

export function measureTrackedText(ctx, text, letterSpacing = 0) {
  const value = String(text ?? '');
  const count = textGraphemes(value).length;
  return ctx.measureText(value).width + Math.max(0, count - 1) * (Number(letterSpacing) || 0);
}

export function wrapText(ctx, text, maxWidth, letterSpacing = 0) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measureTrackedText(ctx, candidate, letterSpacing) > maxWidth) { lines.push(line); line = word; }
      else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

export function calculateTextBox(ctx, node, { fontSize = node.fontSize, lineHeight = node.lineHeight, letterSpacing = node.letterSpacing, text = node.text } = {}) {
  const width = Math.max(0, Number(node.width) || 0);
  const height = Math.max(0, Number(node.height) || 0);
  const mode = node.textFit || 'auto-height';
  if (mode === 'fixed') return { width, height };

  const size = Math.max(1, Number(fontSize) || 24);
  const lineHeightPx = size * Math.max(.1, Number(lineHeight) || 1.25);
  const spacing = Number(letterSpacing) || 0;
  const textValue = String(text ?? '');
  ctx.font = `${node.fontStyle === 'italic' ? 'italic ' : ''}${node.fontWeight || 400} ${size}px ${node.fontFamily || 'Arial, sans-serif'}`;

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
