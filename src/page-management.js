import { MAX_MOTION_KEYFRAMES, MAX_MOTION_TRACKS } from './motion.js';

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

/** Duplicate a page after its source, renewing layer, motion, and internal prototype ids. */
export function duplicatePage(document, pageId, { createId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}` } = {}) {
  requireDocument(document);
  const index = document.pages.findIndex(page => page.id === pageId);
  if (index < 0) return null;
  const source = document.pages[index];
  const duplicate = clone(source);
  const usedIds = new Set();
  for (const page of document.pages) {
    if (typeof page.id === 'string') usedIds.add(page.id);
    for (const guide of page.guides || []) if (typeof guide?.id === 'string') usedIds.add(guide.id);
    const collectNodeIds = nodes => {
      for (const node of nodes || []) {
        if (typeof node?.id === 'string') usedIds.add(node.id);
        collectNodeIds(node?.children);
      }
    };
    collectNodeIds(page.children);
  }
  for (const track of document.motion?.tracks || []) {
    if (typeof track?.id === 'string') usedIds.add(track.id);
    for (const keyframe of track?.keyframes || []) {
      if (typeof keyframe?.id === 'string') usedIds.add(keyframe.id);
    }
  }
  const newPageId = createId('page');
  if (typeof newPageId !== 'string' || !newPageId.trim() || newPageId.trim() !== newPageId || usedIds.has(newPageId)) throw new TypeError('Page id factory must return a unique non-empty id.');
  usedIds.add(newPageId);
  duplicate.id = newPageId;
  duplicate.name = makeUniquePageName(document.pages, source.name);
  const ids = new Map();
  const renew = node => {
    const oldId = node.id;
    const nextId = createId(node.type || 'layer');
    if (typeof nextId !== 'string' || !nextId.trim() || nextId.trim() !== nextId || usedIds.has(nextId)) throw new TypeError('Layer id factory must return unique non-empty ids.');
    usedIds.add(nextId);
    ids.set(oldId, nextId);
    node.id = nextId;
    for (const child of node.children || []) renew(child);
  };
  for (const node of duplicate.children || []) renew(node);
  if (Object.hasOwn(source, 'guides') && !Array.isArray(source.guides)) throw new TypeError('Cannot duplicate a page with invalid ruler guides.');
  duplicate.guides = (duplicate.guides || []).map(guide => {
    const nextId = createId('guide');
    if (typeof nextId !== 'string' || !nextId.trim() || nextId.trim() !== nextId || usedIds.has(nextId)) throw new TypeError('Guide id factory must return unique non-empty ids.');
    usedIds.add(nextId);
    return { id: nextId, axis: guide.axis, position: guide.position };
  });
  for (const node of duplicate.children || []) {
    const rewrite = item => {
      for (const interaction of item.interactions || []) {
        if (ids.has(interaction.destinationId)) {
          interaction.destinationId = ids.get(interaction.destinationId);
          interaction.destinationPageId = newPageId;
        }
        if (ids.has(interaction.scrollTargetId)) interaction.scrollTargetId = ids.get(interaction.scrollTargetId);
      }
      for (const child of item.children || []) rewrite(child);
    };
    rewrite(node);
  }
  const copiedMotionTracks = (document.motion?.tracks || [])
    .filter(track => ids.has(track.nodeId))
    .map(track => {
      const nextTrackId = createId('motion-track');
      if (typeof nextTrackId !== 'string' || !nextTrackId.trim() || nextTrackId.trim() !== nextTrackId || usedIds.has(nextTrackId)) {
        throw new TypeError('Motion track id factory must return a unique non-empty id.');
      }
      usedIds.add(nextTrackId);
      const copy = clone(track);
      copy.id = nextTrackId;
      copy.nodeId = ids.get(track.nodeId);
      copy.keyframes = copy.keyframes.map(keyframe => {
        const nextKeyframeId = createId('keyframe');
        if (typeof nextKeyframeId !== 'string' || !nextKeyframeId.trim() || nextKeyframeId.trim() !== nextKeyframeId || usedIds.has(nextKeyframeId)) {
          throw new TypeError('Motion keyframe id factory must return a unique non-empty id.');
        }
        usedIds.add(nextKeyframeId);
        return { ...keyframe, id: nextKeyframeId };
      });
      return copy;
    });
  if (copiedMotionTracks.length) {
    const currentTracks = document.motion.tracks;
    const currentKeyframes = currentTracks.reduce((total, track) => total + track.keyframes.length, 0);
    const copiedKeyframes = copiedMotionTracks.reduce((total, track) => total + track.keyframes.length, 0);
    if (currentTracks.length + copiedMotionTracks.length > MAX_MOTION_TRACKS
      || currentKeyframes + copiedKeyframes > MAX_MOTION_KEYFRAMES) {
      throw new RangeError('Duplicating this page would exceed the motion document limits.');
    }
    document.motion.tracks.push(...copiedMotionTracks);
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
  if (document.motion?.tracks?.length) {
    document.motion.tracks = document.motion.tracks.filter(track => !removedNodeIds.has(track.nodeId));
  }
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
