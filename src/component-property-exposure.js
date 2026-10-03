function componentRoot(document, component) {
  const targetId = component?.rootNodeId;
  if (!targetId) return null;
  let result = null;
  const visit = nodes => {
    for (const node of nodes || []) {
      if (node?.id === targetId) { result = node; return true; }
      if (visit(node?.children)) return true;
    }
    return false;
  };
  for (const page of document?.pages || []) if (visit(page.children)) break;
  return result;
}

function componentScopeIndex(root) {
  const byId = new Map();
  const byVariantKey = new Map();
  const visit = (node, isRoot = false) => {
    if (!node || typeof node !== 'object') return;
    byId.set(node.id, node);
    if (node.variantNodeKey) byVariantKey.set(node.variantNodeKey, node);
    // An instance's children are owned by its linked component, outside the
    // containing component's source scope.
    if (!isRoot && node.isInstance) return;
    for (const child of node.children || []) visit(child);
  };
  visit(root, true);
  return { byId, byVariantKey };
}

/** Number of controls contributed by a component, including variant axes. */
export function componentPropertyDefinitionCount(document, component) {
  const set = document?.componentSets?.find(item => item.id === component?.componentSetId);
  return (Array.isArray(component?.componentProperties) ? component.componentProperties.length : 0)
    + (Array.isArray(set?.properties) ? set.properties.length : 0);
}

/** Resolve nested-instance exposures onto the selected member of a variant set. */
export function componentExposedNestedInstanceSourceIds(document, component) {
  const currentRoot = componentRoot(document, component);
  if (!component || !currentRoot) return [];
  const currentIndex = componentScopeIndex(currentRoot);
  const sources = new Set();
  const set = document.componentSets?.find(item => item.id === component.componentSetId);
  const peers = set
    ? set.componentIds.map(id => document.components?.find(item => item.id === id)).filter(Boolean)
    : [component];
  for (const peer of peers) {
    const peerIndex = peer.id === component.id ? currentIndex : componentScopeIndex(componentRoot(document, peer));
    if (!peerIndex) continue;
    for (const sourceId of peer.exposedNestedInstances || []) {
      const source = peerIndex.byId.get(sourceId);
      const target = source?.variantNodeKey
        ? currentIndex.byVariantKey.get(source.variantNodeKey)
        : currentIndex.byId.get(sourceId);
      if (target?.isInstance) sources.add(target.id);
    }
  }
  return [...sources];
}

/** Resolve the complete property groups exposed from one component instance. */
export function componentPropertyExposureGroups(document, ownerComponent, ownerInstance) {
  const exposedIds = componentExposedNestedInstanceSourceIds(document, ownerComponent);
  if (!exposedIds.length || !Array.isArray(ownerInstance?.children)) return [];
  const ownerScope = componentScopeIndex(componentRoot(document, ownerComponent));
  const requested = new Set(exposedIds);
  const nestedInstances = new Map();
  const nestedInstancesByKey = new Map();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.isInstance) {
      if (requested.has(node.componentSourceId) && !nestedInstances.has(node.componentSourceId)) {
        nestedInstances.set(node.componentSourceId, node);
      }
      if (node.componentSourceKey && !nestedInstancesByKey.has(node.componentSourceKey)) {
        nestedInstancesByKey.set(node.componentSourceKey, node);
      }
      // An instance's children belong to its own component scope; parent
      // exposure never searches through that boundary.
      return;
    }
    for (const child of node.children || []) visit(child);
  };
  for (const child of ownerInstance.children) visit(child);

  const groups = [];
  for (const sourceId of exposedIds) {
    const instance = nestedInstances.get(sourceId) || (() => {
      const source = ownerScope.byId.get(sourceId);
      return source?.variantNodeKey ? nestedInstancesByKey.get(source.variantNodeKey) : null;
    })();
    if (!instance || instance.visible === false) continue;
    const component = document.components?.find(item => item.id === instance.componentId);
    const properties = Array.isArray(component?.componentProperties) ? component.componentProperties : [];
    const set = document.componentSets?.find(item => item.id === component?.componentSetId);
    const variantProperties = Array.isArray(set?.properties) ? set.properties : [];
    if (!component || (!properties.length && !variantProperties.length)) continue;
    groups.push({ instance, component, properties, variantProperties });
  }
  return groups;
}

/** Map a component-property source layer to its visible instance layer ID. */
export function componentPropertyTargetInstanceId(instance, targetSourceId) {
  if (!instance || typeof targetSourceId !== 'string' || !targetSourceId) return null;
  let targetId = null;
  const visit = (node, isRoot = false) => {
    if (!node || typeof node !== 'object' || targetId) return;
    if (node.componentSourceId === targetSourceId || node.nestedComponentSourceId === targetSourceId) {
      targetId = node.id || null;
      return;
    }
    if (!isRoot && node.isInstance) return;
    for (const child of node.children || []) visit(child);
  };
  visit(instance, true);
  return targetId;
}
