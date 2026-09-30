const clone = value => structuredClone(value);

function requireDocument(document) {
  if (!document || !Array.isArray(document.pages)) throw new TypeError('A document with a pages array is required.');
}

function makeUniquePageName(pages, base) {
  const names = new Set(pages.map(page => String(page.name || '').trim().toLocaleLowerCase()));
  const sourceName = String(base || 'Page').trim() || 'Page';
  const match = /^(.*?)(?: copy(?: (\d+))?)?$/i.exec(sourceName);
  const stem = `${match?.[1]?.trim() || sourceName} copy`;
  let suffix = match?.[2] ? Number(match[2]) + 1 : 1;
  let candidate = suffix === 1 ? stem : `${stem} ${suffix}`;
  while (names.has(candidate.toLocaleLowerCase())) {
    suffix += 1;
    candidate = `${stem} ${suffix}`;
  }
  return candidate;
}

/** Duplicate a page after its source, renewing all layer ids and internal prototype links. */
export function duplicatePage(document, pageId, { createId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}` } = {}) {
  requireDocument(document);
  const index = document.pages.findIndex(page => page.id === pageId);
  if (index < 0) return null;
  const source = document.pages[index];
  const duplicate = clone(source);
  const newPageId = createId('page');
  if (typeof newPageId !== 'string' || !newPageId || document.pages.some(page => page.id === newPageId)) throw new TypeError('Page id factory must return a unique non-empty id.');
  duplicate.id = newPageId;
  duplicate.name = makeUniquePageName(document.pages, source.name);
  const ids = new Map();
  const renew = node => {
    const oldId = node.id;
    const nextId = createId(node.type || 'layer');
    if (typeof nextId !== 'string' || !nextId || ids.has(nextId)) throw new TypeError('Layer id factory must return unique non-empty ids.');
    ids.set(oldId, nextId);
    node.id = nextId;
    for (const child of node.children || []) renew(child);
  };
  for (const node of duplicate.children || []) renew(node);
  for (const node of duplicate.children || []) {
    const rewrite = item => {
      for (const interaction of item.interactions || []) {
        if (ids.has(interaction.destinationId)) {
          interaction.destinationId = ids.get(interaction.destinationId);
          interaction.destinationPageId = newPageId;
        }
      }
      for (const child of item.children || []) rewrite(child);
    };
    rewrite(node);
  }
  document.pages.splice(index + 1, 0, duplicate);
  return duplicate;
}

/** Rename a page after trimming whitespace. Returns the renamed page or null. */
export function renamePage(document, pageId, name) {
  requireDocument(document);
  const page = document.pages.find(item => item.id === pageId);
  const normalized = typeof name === 'string' ? name.trim() : '';
  if (!page || !normalized) return null;
  page.name = normalized;
  return page;
}

/** Delete a page, its comments, and links targeting it; the last page is protected. */
export function deletePage(document, pageId) {
  requireDocument(document);
  if (document.pages.length <= 1) return false;
  const index = document.pages.findIndex(page => page.id === pageId);
  if (index < 0) return false;
  const removedNodeIds = new Set();
  const collect = nodes => nodes.forEach(node => {
    if (typeof node.id === 'string') removedNodeIds.add(node.id);
    collect(node.children || []);
  });
  collect(document.pages[index].children || []);
  document.pages.splice(index, 1);
  document.comments = (document.comments || []).filter(comment => comment.pageId !== pageId);
  for (const page of document.pages) {
    const walk = nodes => nodes.forEach(node => {
      if (Array.isArray(node.interactions)) {
        node.interactions = node.interactions.filter(interaction => interaction.destinationPageId !== pageId
          && !(interaction.destinationPageId == null && removedNodeIds.has(interaction.destinationId)));
        if (!node.interactions.length) delete node.interactions;
      }
      walk(node.children || []);
    });
    walk(page.children || []);
  }
  if (Array.isArray(document.prototypeFlows)) {
    document.prototypeFlows = document.prototypeFlows.filter(flow => flow.pageId !== pageId);
    if (!document.prototypeFlows.some(flow => flow.id === document.prototypeStartFlowId)) {
      const replacement = document.prototypeFlows[0] || null;
      document.prototypeStartFlowId = replacement?.id ?? null;
      document.prototypeStartPoint = replacement
        ? { pageId: replacement.pageId, nodeId: replacement.nodeId }
        : null;
    }
  } else if (document.prototypeStartPoint?.pageId === pageId) {
    document.prototypeStartPoint = null;
  }
  if (document.activePageId === pageId || !document.pages.some(page => page.id === document.activePageId)) {
    document.activePageId = document.pages[Math.min(index, document.pages.length - 1)].id;
  }
  return true;
}

/** Move a page to a zero-based position while keeping the active page id stable. */
export function reorderPage(document, pageId, index) {
  requireDocument(document);
  const from = document.pages.findIndex(page => page.id === pageId);
  if (from < 0 || !Number.isInteger(index)) return false;
  const to = Math.max(0, Math.min(document.pages.length - 1, index));
  if (from === to) return true;
  const [page] = document.pages.splice(from, 1);
  document.pages.splice(to, 0, page);
  if (!document.pages.some(item => item.id === document.activePageId)) document.activePageId = document.pages[0]?.id ?? null;
  return true;
}
