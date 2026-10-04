import { addNode, cloneDocument, createId, findNode, findNodeAcrossPages, getNodeColor, getNodeGeometry, getNodePropertyValue, validateDocument } from './model.js';
import { parentLocalToPageTransform, transformPoint } from './transform-geometry.js';

export const layerClipboardSchema = 'tiny-image-star/layer-clipboard/1';
const maxClipboardItems = 1000;
const maxClipboardNodes = 20_000;
const variablePropertyTypes = {
  x: 'number', y: 'number', width: 'number', height: 'number', rotation: 'number',
  visible: 'boolean', opacity: 'number', radius: 'number', text: 'string',
  fontSize: 'number', lineHeight: 'number', lineHeightUnit: 'string', letterSpacing: 'number',
  'autoLayout.axis': 'string', 'autoLayout.align': 'string', 'autoLayout.justify': 'string', 'autoLayout.wrapDistribution': 'string',
  'autoLayout.mainSizing': 'string', 'autoLayout.crossSizing': 'string',
  'autoLayout.wrap': 'boolean', 'autoLayout.autoPositioning': 'boolean',
  'autoLayout.columns': 'number', 'autoLayout.rows': 'number',
  'autoLayout.rowGap': 'number', 'autoLayout.columnGap': 'number',
  'autoLayout.padding.top': 'number', 'autoLayout.padding.right': 'number',
  'autoLayout.padding.bottom': 'number', 'autoLayout.padding.left': 'number'
};
const variablePropertyTypesByNode = {
  x: null, y: null, width: null, height: null, rotation: null,
  visible: null, opacity: null,
  radius: new Set(['rectangle', 'frame', 'section', 'image']),
  text: new Set(['text']), fontSize: new Set(['text']), lineHeight: new Set(['text']), lineHeightUnit: new Set(['text']), letterSpacing: new Set(['text']),
  'autoLayout.axis': new Set(['frame']), 'autoLayout.align': new Set(['frame']),
  'autoLayout.justify': new Set(['frame']), 'autoLayout.mainSizing': new Set(['frame']),
  'autoLayout.wrapDistribution': new Set(['frame']),
  'autoLayout.crossSizing': new Set(['frame']), 'autoLayout.wrap': new Set(['frame']),
  'autoLayout.autoPositioning': new Set(['frame']), 'autoLayout.columns': new Set(['frame']),
  'autoLayout.rows': new Set(['frame']), 'autoLayout.rowGap': new Set(['frame']),
  'autoLayout.columnGap': new Set(['frame']), 'autoLayout.padding.top': new Set(['frame']),
  'autoLayout.padding.right': new Set(['frame']), 'autoLayout.padding.bottom': new Set(['frame']),
  'autoLayout.padding.left': new Set(['frame'])
};

function plainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function setNodePropertyValue(node, property, value) {
  const segments = property.split('.');
  const key = segments.pop();
  let target = node;
  for (const segment of segments) {
    if (!plainRecord(target[segment])) target[segment] = {};
    target = target[segment];
  }
  target[key] = value;
}

function resolvedSnapshot(document, node) {
  const values = {};
  if (node.typographyStyleId) values.textWrapStyle = getNodePropertyValue(document, node, 'textWrapStyle');
  if (node.fillVariableId || node.fillStyleId) values.fill = getNodeColor(document, node, 'fill');
  if (node.textVariableId || node.textStyleId) values.color = getNodeColor(document, node, 'text');
  if (node.strokeVariableId) values.stroke = getNodeColor(document, node, 'stroke');
  for (const property of Object.keys(variablePropertyTypes)) {
    if (node.variableBindings?.[property]) values[property] = getNodePropertyValue(document, node, property);
  }
  return values;
}

function findInstancePropertyTarget(instance, targetSourceId) {
  let found = null;
  const visit = (node, isRoot = false) => {
    if (node.componentSourceId === targetSourceId) { found = node; return; }
    if (!isRoot && node.isInstance) return;
    for (const child of node.children || []) visit(child);
  };
  visit(instance, true);
  return found;
}

function componentSlotMutationContext(document, entry) {
  if (!entry?.node) return null;
  const ancestry = [...(entry.parents || []), entry.node];
  let best = null;
  for (let instanceDepth = 0; instanceDepth < ancestry.length; instanceDepth += 1) {
    const instance = ancestry[instanceDepth];
    if (!instance.isInstance) continue;
    const component = document.components?.find(item => item.id === instance.componentId);
    if (!component) continue;
    for (const property of component.componentProperties || []) {
      if (property.type !== 'SLOT') continue;
      const target = findInstancePropertyTarget(instance, property.targetSourceId);
      const targetDepth = ancestry.indexOf(target);
      if (!target || targetDepth < 0 || targetDepth > ancestry.length - 1) continue;
      if (best && (instanceDepth < best.instanceDepth || (instanceDepth === best.instanceDepth && targetDepth <= best.targetDepth))) continue;
      best = {
        instance, component, property, target, instanceDepth, targetDepth,
        overridden: Object.hasOwn(instance.componentPropertyValues || {}, property.id)
      };
    }
  }
  return best;
}

function detachCopiedInstanceSourceLinks(node, insideLinkedInstance = false) {
  if (!insideLinkedInstance) {
    delete node.componentSourceId;
    delete node.componentSourceKey;
    delete node.variantNodeKey;
  }
  const childrenBelongToLinkedInstance = insideLinkedInstance || node.isInstance === true;
  for (const child of node.children || []) detachCopiedInstanceSourceLinks(child, childrenBelongToLinkedInstance);
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
    const transformedParents = entry.parents.map(parent => ({ ...parent, ...getNodeGeometry(document, parent) }));
    const nodeGeometry = getNodeGeometry(document, entry.node);
    const pagePosition = transformPoint(parentLocalToPageTransform(transformedParents), { x: nodeGeometry.x, y: nodeGeometry.y });
    return {
      parentId: entry.parent?.id || null,
      sourceIndex: entry.index,
      sourcePageId: pageId,
      sourceInsideInstance: entry.parents.some(parent => parent.isInstance),
      pageX: pagePosition.x,
      pageY: pagePosition.y,
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
      || (item.sourceInsideInstance != null && typeof item.sourceInsideInstance !== 'boolean')
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
  const typographyStyles = new Set((document.typographyStyles || []).map(style => style.id));
  const variables = new Map((document.variables || []).map(variable => [variable.id, variable]));
  const collections = new Map((document.variableCollections || []).map(collection => [collection.id, new Set(collection.modes.map(mode => mode.id))]));

  if (node.fillStyleId && !colors.has(node.fillStyleId)) { node.fill = fallbacks.fill ?? node.fill; delete node.fillStyleId; }
  if (node.textStyleId && !colors.has(node.textStyleId)) { node.color = fallbacks.color ?? node.color; delete node.textStyleId; }
  if (node.typographyStyleId && !typographyStyles.has(node.typographyStyleId)) {
    if (fallbacks.textWrapStyle !== undefined) node.textWrapStyle = fallbacks.textWrapStyle;
    delete node.typographyStyleId;
  }
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
        if (fallbacks[property] !== undefined) setNodePropertyValue(node, property, fallbacks[property]);
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
      const componentProperties = (sourceComponent.componentProperties || []).map(property => {
        const sourceIds = Array.isArray(property.targetSourceIds) ? property.targetSourceIds : [property.targetSourceId];
        const targetSourceIds = sourceIds.map(sourceId => idMap.ids.get(sourceId));
        if (!targetSourceIds.length || targetSourceIds.some(sourceId => !sourceId)) return null;
        const copy = {
          ...structuredClone(property),
          id: freshId('component-property', idMap.reserved),
          targetSourceId: targetSourceIds[0]
        };
        if (targetSourceIds.length > 1) copy.targetSourceIds = targetSourceIds;
        else delete copy.targetSourceIds;
        return copy;
      }).filter(Boolean);
      componentRecords.push({
        id: componentId,
        name: `${sourceComponent.name} copy`,
        pageId,
        rootNodeId: node.id,
        ...(componentProperties.length ? { componentProperties } : {})
      });
    }
  } else if (node.isInstance) {
    const component = (document.components || []).find(item => item.id === node.componentId);
    const sourceId = idMap.originalForClone.get(node.id);
    if (!component || !findNodeAcrossPages(document, component.rootNodeId) || (node.componentSourceId && node.componentSourceId !== component.rootNodeId && sourceId)) detachBrokenComponentTree(node);
  } else if (node.componentId) delete node.componentId;
  if (node.componentOverrides) {
    for (const [sourceId, overrides] of Object.entries(node.componentOverrides)) {
      if (overrides?.variableBindings) {
        for (const [property, variableId] of Object.entries(overrides.variableBindings)) {
          const variable = variables.get(variableId);
          const compatibleNodeTypes = variablePropertyTypesByNode[property];
          const sourceNode = findNodeAcrossPages(document, sourceId)?.node;
          if (!variable || variable.type !== variablePropertyTypes[property]
            || (compatibleNodeTypes && sourceNode && !compatibleNodeTypes.has(sourceNode.type))) delete overrides.variableBindings[property];
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
      if (interaction.action === 'scroll-to') {
        const targetId = idMap.ids.get(interaction.scrollTargetId)
          || (typeof interaction.scrollTargetId === 'string' && findNode(document, interaction.scrollTargetId, pageId) ? interaction.scrollTargetId : null);
        return targetId ? { ...interaction, scrollTargetId: targetId } : null;
      }
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
    if (item.sourceInsideInstance) detachCopiedInstanceSourceLinks(node);
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
    const parentEntry = item.parentId && item.sourcePageId === pageId ? findNode(candidate, item.parentId, pageId) : null;
    const parent = parentEntry?.node || null;
    const targetParentId = parent && ['frame', 'section', 'group', 'boolean'].includes(parent.type) ? parent.id : null;
    if (targetParentId && (parent.isInstance || parentEntry.parents.some(ancestor => ancestor.isInstance))) {
      const context = componentSlotMutationContext(candidate, parentEntry);
      if (!context?.overridden) {
        throw new Error('Cannot paste into linked component layers. Paste into an overridden content slot or outside the component instance.');
      }
    }
    const key = targetParentId || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      ...item,
      targetParentId,
      restoreSourceParent: item.sourcePageId === pageId && (item.parentId || null) === targetParentId
    });
  }

  const inserted = [];
  for (const [parentKey, items] of groups) {
    items.sort((a, b) => a.sourceIndex - b.sourceIndex);
    const parentId = parentKey || null;
    const list = parentId ? findNode(candidate, parentId, pageId).node.children : candidatePage.children;
    const restoreCutPositions = clipboard.mode === 'cut' && clipboard.sourcePageId === pageId
      && items.every(item => item.restoreSourceParent);
    for (const item of items) {
      if (!parentId && (item.parentId || item.sourcePageId !== pageId)) {
        item.node.x = item.pageX;
        item.node.y = item.pageY;
      }
      item.node.x += pasteOffset;
      item.node.y += pasteOffset;
      const index = restoreCutPositions ? Math.min(item.sourceIndex, list.length) : list.length;
      addNode(candidate, item.node, { pageId, parentId, index });
      inserted.push(item.node);
    }
  }
  const pruneInvalidScrollInteractions = node => {
    const entry = findNode(candidate, node.id, pageId);
    if (Array.isArray(node.interactions)) {
      node.interactions = node.interactions.filter(interaction => {
        if (interaction.action !== 'scroll-to') return true;
        const target = findNode(candidate, interaction.scrollTargetId, pageId);
        const sourceFrame = entry && [...entry.parents, entry.node].find(layer => layer.type === 'frame');
        const targetFrame = target && [...target.parents, target.node].find(layer => layer.type === 'frame');
        return Boolean(target && sourceFrame && targetFrame?.id === sourceFrame.id
          && target.parents.some(layer => layer.type === 'frame' && ['vertical', 'horizontal', 'both'].includes(layer.overflowBehavior)));
      });
      if (!node.interactions.length) delete node.interactions;
    }
    for (const child of node.children || []) pruneInvalidScrollInteractions(child);
  };
  for (const node of inserted) pruneInvalidScrollInteractions(node);
  candidate.components.push(...componentRecords);
  validateDocument(candidate);
  return { document: candidate, nodes: inserted, pasteCount: copyPasteNumber };
}
