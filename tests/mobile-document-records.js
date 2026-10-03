function containsNodeId(nodes, ids) {
  for (const node of nodes || []) {
    ids.delete(node.id);
    if (ids.size === 0) return true;
    if (containsNodeId(node.children, ids)) return true;
  }
  return false;
}

export function latestRecordContainingNodeIds(records, nodeIds) {
  const expectedIds = [...new Set(nodeIds)];
  return records
    .filter(record => {
      const remaining = new Set(expectedIds);
      for (const page of record.document?.pages || []) {
        if (containsNodeId(page.children, remaining)) return true;
      }
      return false;
    })
    .sort((left, right) => right.savedAt - left.savedAt)[0] || null;
}
