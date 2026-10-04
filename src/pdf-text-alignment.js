const VECTOR_PDF_PARAGRAPH_ALIGNMENTS = new Set(['left', 'center', 'right']);

/** Return a user-facing reason when a text layer cannot use vector-PDF alignment. */
export function vectorPdfTextAlignmentIssue(node) {
  const baseAlignment = node?.align || 'left';
  const paragraphAlignments = [baseAlignment, ...(Array.isArray(node?.paragraphStyles)
    ? node.paragraphStyles.map(paragraph => paragraph?.align || baseAlignment)
    : [])];
  return paragraphAlignments.some(align => !VECTOR_PDF_PARAGRAPH_ALIGNMENTS.has(align))
    ? 'left, centered, and right-aligned paragraphs are supported; justified text still needs raster PDF.'
    : null;
}
