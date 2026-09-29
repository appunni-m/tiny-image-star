import { cloneDocument, createId, findNode, findNodeAcrossPages, getNodeColor, getNodePropertyValue, validateDocument } from './model.js';

export const layerClipboardSchema = 'tiny-image-star/layer-clipboard/1';
const maxClipboardItems = 1000;
const maxClipboardNodes = 20_000;
const variablePropertyTypes = {
  visible: 'boolean', opacity: 'number', radius: 'number', text: 'string',
  fontSize: 'number', lineHeight: 'number', letterSpacing: 'number'
};
const variablePropertyTypesByNode = {
  visible: null, opacity: null,
  radius: new Set(['rectangle', 'frame', 'section', 'image']),
  text: new Set(['text']), fontSize: new Set(['text']), lineHeight: new Set(['text']), letterSpacing: new Set(['text'])
};

function plainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolvedSnapshot(document, node) {
  const values = {};
  if (node.fillVariableId || node.fillStyleId) values.fill = getNodeColor(document, node, 'fill');
  if (node.textVariableId || node.textStyleId) values.color = getNodeColor(document, node, 'text');
  if (node.strokeVariableId) values.stroke = getNodeColor(document, node, 'stroke');
  for (const property of Object.keys(variablePropertyTypes)) {
    if (node.variableBindings?.[property]) values[property] = getNodePropertyValue(document, node, property);
  }
  return values;
}

/** Capture an immutable, same-document layer clipboard without copying local image bytes. */
export function createLayerClipboard(document, entries, { mode = 'copy', pageId = document?.activePageId } = {}) {
  if (!document || typeof document.id !== 'string' || !Array.isArray(entries) || !entries.length) throw new TypeError('Select one or more layers first.');
  if (!['copy', 'cut'].includes(mode)) throw new TypeError('Choose copy or cut clipboard mode.');
  if (!document.pages?.some(page => page.id === pageId)) throw new TypeError('The clipboard source page no longer exists.');
  if (entries.length > maxClipboardItems) throw new RangeError(`Copy up to ${maxClipboardItems} layers at a time.`);

  // Bound the full selection before structuredClone allocates clipboard snapshots.
  const seenIds = new Set();
  const pending = entries.map(entry => entry?.node);
  let nodeCount = 0;
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !node.id || typeof node.type !== 'string'
      || (node.children != null && !Array.isArray(node.children))) {
      throw new TypeError('The selected layers contain malformed layer data.');
    }
    nodeCount += 1;
    if (nodeCount > maxClipboardNodes) throw new RangeError(`Clipboard layers exceed the ${maxClipboardNodes.toLocaleString()}-layer safety limit.`);
    if (seenIds.has(node.id)) throw new TypeError('The selected layers overlap or contain duplicate layer IDs. Select each layer tree only once.');
    seenIds.add(node.id);
    for (const child of node.children || []) pending.push(child);
  }

  const items = entries.map(entry => {
    if (!entry?.node || typeof entry.node.id !== 'string' || !entry.node.id || !Number.isInteger(entry.index) || entry.index < 0) {
      throw new TypeError('The selected layers are no longer available.');
    }
    return {
      parentId: entry.parent?.id || null,
      sourceIndex: entry.index,
      sourcePageId: pageId,
      pageX: entry.parents.reduce((sum, parent) => sum + parent.x, 0) + entry.node.x,
      pageY: entry.parents.reduce((sum, parent) => sum + parent.y, 0) + entry.node.y,
      node: structuredClone(entry.node),
      resolved: Object.fromEntries((() => {
        const values = {};
        const addResolved = tree => {
          values[tree.id] = resolvedSnapshot(document, tree);
          for (const child of tree.children || []) addResolved(child);
        };
        addResolved(entry.node);
        return Object.entries(values);
      })())
    };
  });

  return { schema: layerClipboardSchema, documentId: document.id, sourcePageId: pageId, mode, pasteCount: 0, items };
}

function validateClipboardEnvelope(clipboard, document) {
  if (!plainRecord(clipboard) || clipboard.schema !== layerClipboardSchema || !Array.isArray(clipboard.items)
    || clipboard.items.length < 1 || clipboard.items.length > maxClipboardItems || !['copy', 'cut'].includes(clipboard.mode)
    || !Number.isSafeInteger(clipboard.pasteCount) || clipboard.pasteCount < 0 || clipboard.pasteCount > 10_000) {
    throw new TypeError('The layer clipboard is invalid or empty. Copy the layers again and retry.');
  }
  if (clipboard.documentId !== document.id) throw new Error('Layer copy and paste is available within the same open design.');
  if (typeof clipboard.sourcePageId !== 'string') throw new TypeError('The layer clipboard has no source page. Copy the layers again and retry.');
  const ids = new Set();
  let count = 0;
  const visit = (node, path = new Set()) => {
    count += 1;
    if (count > maxClipboardNodes) throw new RangeError(`Clipboard layers exceed the ${maxClipboardNodes.toLocaleString()}-layer safety limit.`);
    if (!plainRecord(node) || typeof node.id !== 'string' || !node.id || typeof node.type !== 'string' || path.has(node)) throw new TypeError('The layer clipboard contains a malformed layer. Copy the layers again and retry.');
    if (ids.has(node.id)) throw new TypeError('The layer clipboard contains duplicate layer IDs. Copy the layers again and retry.');
    ids.add(node.id);
    if (node.children != null && !Array.isArray(node.children)) throw new TypeError('The layer clipboard contains malformed children. Copy the layers again and retry.');
    const nextPath = new Set(path); nextPath.add(node);
    for (const child of node.children || []) visit(child, nextPath);
  };
  for (const item of clipboard.items) {
    if (!plainRecord(item) || (item.parentId != null && typeof item.parentId !== 'string') || !Number.isInteger(item.sourceIndex) || item.sourceIndex < 0
      || typeof item.sourcePageId !== 'string' || !Number.isFinite(item.pageX) || !Number.isFinite(item.pageY)
      || !plainRecord(item.resolved)) throw new TypeError('The layer clipboard contains a malformed item. Copy the layers again and retry.');
    visit(item.node);
  }
  return ids;
}

function freshId(prefix, reserved) {
  let id;
  do { id = createId(prefix); } while (reserved.has(id));
  reserved.add(id);
  return id;
}

function detachBrokenComponentTree(node) {
  delete node.isComponent; delete node.isInstance; delete node.componentId; delete node.componentOverrides;
  delete node.componentSourceId; delete node.componentSourceKey; delete node.componentNameIsInherited;
  for (const child of node.children || []) detachBrokenComponentTree(child);
}

function sanitizeExternalReferences(node, fallbacks, document, pageId, idMap, componentRecords) {
  const colors = new Set((document.colorStyles || []).map(style => style.id));
  const variables = new Map((document.variables || []).map(variable => [variable.id, variable]));
  const collections = new Map((document.variableCollections || []).map(collection => [collection.id, new Set(collection.modes.map(mode => mode.id))]));

  if (node.fillStyleId && !colors.has(node.fillStyleId)) { node.fill = fallbacks.fill ?? node.fill; delete node.fillStyleId; }
  if (node.textStyleId && !colors.has(node.textStyleId)) { node.color = fallbacks.color ?? node.color; delete node.textStyleId; }
  for (const [property, fallbackProperty] of [['fillVariableId', 'fill'], ['textVariableId', 'color'], ['strokeVariableId', 'stroke']]) {
    const variable = variables.get(node[property]);
    if (node[property] && (!variable || variable.type !== 'color')) {
      if (fallbacks[fallbackProperty] != null) node[fallbackProperty] = fallbacks[fallbackProperty];
      delete node[property];
    }
  }
  if (node.variableBindings) {
    for (const [property, variableId] of Object.entries(node.variableBindings)) {
      const variable = variables.get(variableId);
      const compatibleNodeTypes = variablePropertyTypesByNode[property];
      if (!variable || variable.type !== variablePropertyTypes[property] || (compatibleNodeTypes && !compatibleNodeTypes.has(node.type))) {
        if (fallbacks[property] !== undefined) node[property] = fallbacks[property];
        delete node.variableBindings[property];
      }
    }
    if (!Object.keys(node.variableBindings).length) delete node.variableBindings;
  }
  if (node.variableModes) {
    for (const [collectionId, modeId] of Object.entries(node.variableModes)) if (!collections.get(collectionId)?.has(modeId)) delete node.variableModes[collectionId];
    if (!Object.keys(node.variableModes).length) delete node.variableModes;
  }

  if (node.isComponent) {
    const sourceComponent = (document.components || []).find(component => component.id === node.componentId && component.rootNodeId === idMap.originalForClone.get(node.id));
    if (!sourceComponent) {
      delete node.isComponent; delete node.componentId;
    } else {
      const componentId = freshId('component', idMap.reserved);
      node.componentId = componentId;
      delete node.variantNodeKey;
      componentRecords.push({ id: componentId, name: `${sourceComponent.name} copy`, pageId, rootNodeId: node.id });
    }
  } else if (node.isInstance) {
    const component = (document.components || []).find(item => item.id === node.componentId);
    const sourceId = idMap.originalForClone.get(node.id);
    if (!component || !findNodeAcrossPages(document, component.rootNodeId) || (node.componentSourceId && node.componentSourceId !== component.rootNodeId && sourceId)) detachBrokenComponentTree(node);
  } else if (node.componentId) delete node.componentId;
  if (node.componentOverrides) {
    for (const overrides of Object.values(node.componentOverrides)) {
      if (overrides?.variableBindings) {
        for (const [property, variableId] of Object.entries(overrides.variableBindings)) {
          if (!variables.has(variableId) || !variablePropertyTypes[property]) delete overrides.variableBindings[property];
        }
        if (!Object.keys(overrides.variableBindings).length) delete overrides.variableBindings;
      }
    }
  }

  if (node.mask && !idMap.ids.has(node.maskSourceId)) { node.mask = false; delete node.maskSourceId; }
  else if (node.maskSourceId && idMap.ids.has(node.maskSourceId)) node.maskSourceId = idMap.ids.get(node.maskSourceId);
  if (Array.isArray(node.interactions)) {
    node.interactions = node.interactions.map(interaction => {
      if (!plainRecord(interaction)) return null;
      if (interaction.action === 'close-overlay') return interaction;
      const destination = idMap.ids.get(interaction.destinationId) || (typeof interaction.destinationId === 'string' && findNodeAcrossPages(document, interaction.destinationId) ? interaction.destinationId : null);
      return destination ? { ...interaction, destinationId: destination } : null;
    }).filter(Boolean);
  }

}

function itemFallbacksForNode(clipboard, nodeId) {
  for (const item of clipboard.items) {
    if (item.resolved[nodeId]) return item.resolved[nodeId];
  }
  return {};
}

function renameCopyTree(node) {
  node.name = node.name.endsWith(' copy') ? `${node.name.slice(0, -5)} copy 2` : `${node.name} copy`;
  for (const child of node.children || []) renameCopyTree(child);
}

/** Create a validated candidate design with the clipboard items inserted. The input document is never mutated. */
export function pasteLayerClipboard(document, clipboard, { pageId = document?.activePageId, offset = 16 } = {}) {
  if (!document || !Array.isArray(document.pages)) throw new TypeError('Open a valid design before pasting layers.');
  const sourceIds = validateClipboardEnvelope(clipboard, document);
  if (!document.pages.some(page => page.id === pageId)) throw new Error('The target page no longer exists.');
  if (!Number.isFinite(offset) || Math.abs(offset) > 10_000) throw new TypeError('The layer paste offset is invalid.');

  const candidate = cloneDocument(document);
  const candidatePage = candidate.pages.find(page => page.id === pageId);
  candidate.components ||= [];
  const reserved = new Set();
  for (const page of candidate.pages) {
    const collect = nodes => { for (const node of nodes || []) { reserved.add(node.id); collect(node.children); } };
    collect(page.children);
  }
  const clipboardIds = new Map();
  for (const oldId of sourceIds) clipboardIds.set(oldId, freshId('layer', reserved));
  const originalForClone = new Map([...clipboardIds].map(([oldId, newId]) => [newId, oldId]));
  const idMap = { ids: clipboardIds, originalForClone, reserved, clipboard };
  const componentRecords = [];
  const prepared = clipboard.items.map(item => {
    const node = structuredClone(item.node);
    const remapIds = tree => {
      tree.id = clipboardIds.get(tree.id);
      if (tree.effects) for (const effect of tree.effects) effect.id = freshId('effect', reserved);
      if (tree.exportSettings) for (const setting of tree.exportSettings) setting.id = freshId('export', reserved);
      if (tree.layoutGuides) for (const guide of tree.layoutGuides) guide.id = freshId('guide', reserved);
      if (tree.fillGradient?.stops) for (const stop of tree.fillGradient.stops) stop.id = freshId('stop', reserved);
      if (tree.interactions) for (const interaction of tree.interactions) interaction.id = freshId('interaction', reserved);
      for (const child of tree.children || []) remapIds(child);
    };
    remapIds(node);
    if (clipboard.mode === 'copy') renameCopyTree(node);
    const sanitize = tree => {
      sanitizeExternalReferences(tree, itemFallbacksForNode(clipboard, idMap.originalForClone.get(tree.id)), candidate, pageId, idMap, componentRecords);
      for (const child of tree.children || []) sanitize(child);
    };
    sanitize(node);
    return { node, parentId: item.parentId, sourceIndex: item.sourceIndex, sourcePageId: item.sourcePageId, pageX: item.pageX, pageY: item.pageY };
  });

  const copyPasteNumber = clipboard.mode === 'copy' ? clipboard.pasteCount + 1 : 0;
  const pasteOffset = clipboard.mode === 'copy' ? offset * copyPasteNumber : 0;
  const groups = new Map();
  for (const item of prepared) {
    const parent = item.parentId && item.sourcePageId === pageId ? findNode(candidate, item.parentId, pageId)?.node : null;
    const targetParentId = parent && ['frame', 'group', 'boolean'].includes(parent.type) ? parent.id : null;
    const key = targetParentId || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...item, targetParentId });
  }

  const inserted = [];
  for (const [parentKey, items] of groups) {
    items.sort((a, b) => a.sourceIndex - b.sourceIndex);
    const parentId = parentKey || null;
    const list = parentId ? findNode(candidate, parentId, pageId).node.children : candidatePage.children;
    const selectedAt = items.map(item => item.sourceIndex).filter(index => index <= list.length);
    const insertionIndex = clipboard.mode === 'cut' && clipboard.sourcePageId === pageId
      ? Math.min(...selectedAt, list.length)
      : list.length;
    let index = insertionIndex;
    for (const item of items) {
      if (!parentId && (item.parentId || item.sourcePageId !== pageId)) {
        item.node.x = item.pageX;
        item.node.y = item.pageY;
      }
      item.node.x += pasteOffset;
      item.node.y += pasteOffset;
      list.splice(index++, 0, item.node);
      inserted.push(item.node);
    }
  }
  candidate.components.push(...componentRecords);
  validateDocument(candidate);
  return { document: candidate, nodes: inserted, pasteCount: copyPasteNumber };
}
