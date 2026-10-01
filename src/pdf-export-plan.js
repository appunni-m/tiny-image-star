/** Return visible page-level frames in stable top-to-bottom, then left-to-right reading order. */
export function orderedVisibleFrameIds(children) {
  if (!Array.isArray(children)) return [];
  return children.map((node, index) => ({ node, index }))
    .filter(({ node }) => node?.type === 'frame' && node.visible !== false)
    .sort((left, right) => (Number(left.node.y) || 0) - (Number(right.node.y) || 0)
      || (Number(left.node.x) || 0) - (Number(right.node.x) || 0)
      || left.index - right.index)
    .map(({ node }) => node.id);
}
