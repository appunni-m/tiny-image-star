/** Build a reusable, mutation-aware index for node lookups on one document page. */
export function createPageNodeIndex(document, pageId, { nodeIds = null, preserveNodeIdentity = false } = {}) {
  let page = null;
  let indexedPages = null;
  let indexedPagePosition = -1;
  let byId = new Map();
  // A recipe batch needs one stable identity record per selected target. Keep
  // the captured node and its current path in that record so sparse batches do
  // not also retain a full-page map plus a second identity map.
  const targetRecords = preserveNodeIdentity && nodeIds != null
    ? new Map([...nodeIds]
      .filter(id => typeof id === 'string' && id)
      .map(id => [id, { expectedNode: undefined, entry: null }]))
    : null;
  const requestedIds = nodeIds == null || preserveNodeIdentity
    ? null
    : new Set([...nodeIds].filter(id => typeof id === 'string' && id));
  const hasTargetFilter = Boolean(targetRecords || requestedIds);
  if (preserveNodeIdentity && nodeIds == null) {
    throw new TypeError('Preserving target identity requires a target ID list.');
  }
  let initialIdentityScanComplete = false;
  let indexedTargetCount = 0;

  const lookupEntry = nodeId => targetRecords
    ? targetRecords.get(nodeId)?.entry || null
    : byId.get(nodeId) || null;

  const currentPage = () => {
    const pages = document?.pages || [];
    if (pages !== indexedPages) {
      indexedPages = pages;
      indexedPagePosition = pages.findIndex(candidate => candidate.id === pageId);
      return indexedPagePosition < 0 ? null : pages[indexedPagePosition];
    }
    const cachedPage = indexedPagePosition < 0 ? null : pages[indexedPagePosition];
    if (cachedPage?.id === pageId) return cachedPage;
    // Page arrays are mutable. If a reorder, removal, or insertion changes the
    // cached slot, pay for one lookup and keep the new position for later hits.
    indexedPagePosition = pages.findIndex(candidate => candidate.id === pageId);
    return indexedPagePosition < 0 ? null : pages[indexedPagePosition];
  };

  const rebuild = () => {
    page = currentPage();
    byId = new Map();
    indexedTargetCount = 0;
    if (targetRecords) for (const record of targetRecords.values()) record.entry = null;
    if (!page || !Array.isArray(page.children)) {
      if (targetRecords && !initialIdentityScanComplete) {
        for (const record of targetRecords.values()) record.expectedNode = null;
        initialIdentityScanComplete = true;
      }
      return;
    }

    const visited = new WeakSet();
    const stack = [{ nodes: page.children, index: 0, parentEntry: null }];
    let unresolvedTargets = targetRecords?.size ?? requestedIds?.size ?? Infinity;
    while (stack.length && unresolvedTargets > 0) {
      const current = stack.at(-1);
      if (current.index >= current.nodes.length) {
        stack.pop();
        continue;
      }
      const index = current.index++;
      const node = current.nodes[index];
      if (!node || typeof node !== 'object' || visited.has(node)) continue;
      visited.add(node);

      const validId = typeof node.id === 'string' && node.id;
      const targetRecord = validId ? targetRecords?.get(node.id) : null;
      const requested = !hasTargetFilter || Boolean(targetRecord || requestedIds?.has(node.id));
      let shouldIndex = Boolean(validId && requested);
      if (shouldIndex && targetRecords) {
        if (!initialIdentityScanComplete && targetRecord.expectedNode === undefined) {
          targetRecord.expectedNode = node;
        }
        shouldIndex = targetRecord.expectedNode === node;
      }

      const entry = shouldIndex ? {
        id: node.id,
        node,
        parentEntry: current.parentEntry,
        siblings: current.nodes,
        index
      } : null;
      if (entry) {
        if (targetRecords) {
          if (!targetRecord.entry) unresolvedTargets -= 1;
          targetRecord.entry = entry;
          indexedTargetCount += 1;
        } else {
          if (!byId.has(node.id) && requestedIds) unresolvedTargets -= 1;
          byId.set(node.id, entry);
        }
      }
      if (Array.isArray(node.children) && node.children.length) {
        // Keep only the active ancestry path. Selected descendants need this
        // lightweight chain to detect moves, while unrelated leaf nodes do
        // not become retained Map entries.
        const parentEntry = entry || {
          id: node.id,
          node,
          parentEntry: current.parentEntry,
          siblings: current.nodes,
          index
        };
        stack.push({ nodes: node.children, index: 0, parentEntry });
      }
    }

    if (targetRecords && !initialIdentityScanComplete) {
      // A requested ID absent at batch start is permanently outside that run;
      // a later layer reusing it must not become an accidental new target.
      for (const record of targetRecords.values()) {
        if (record.expectedNode === undefined) record.expectedNode = null;
      }
      initialIdentityScanComplete = true;
    }
  };

  const pageIsCurrent = () => page && currentPage() === page;

  const isCurrentPath = entry => {
    if (!page) return false;
    for (let current = entry; current; current = current.parentEntry) {
      const ownerChildren = current.parentEntry ? current.parentEntry.node.children : page.children;
      if (ownerChildren !== current.siblings || current.siblings[current.index] !== current.node
        || current.node.id !== current.id) return false;
    }
    return true;
  };

  const materialize = entry => {
    const parents = [];
    for (let parent = entry.parentEntry; parent; parent = parent.parentEntry) parents.push(parent.node);
    parents.reverse();
    return {
      node: entry.node,
      parent: entry.parentEntry?.node || null,
      parents,
      page
    };
  };

  rebuild();

  return {
    find(nodeId) {
      if (currentPage() !== page) rebuild();
      const targetRecord = targetRecords?.get(nodeId);
      let entry = lookupEntry(nodeId);
      if (!entry && targetRecord?.expectedNode) {
        // A previously located batch target may have been removed between
        // awaits. Recheck its pinned identity once so a restored same-object
        // target can remain valid without allowing an ID-reused replacement.
        rebuild();
        entry = lookupEntry(nodeId);
      }
      if (entry && !isCurrentPath(entry)) {
        rebuild();
        entry = lookupEntry(nodeId);
      }
      return entry ? {
        ...materialize(entry),
        document,
        isCurrent: () => pageIsCurrent() && isCurrentPath(entry)
      } : null;
    },
    get size() { return targetRecords ? indexedTargetCount : byId.size; }
  };
}
