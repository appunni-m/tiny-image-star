const clone = value => structuredClone(value);

export function createId(prefix = 'id') {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${id}`;
}

export function createDocument() {
  const pageId = createId('page');
  return {
    schema: 'figma-local/1',
    id: createId('file'),
    name: 'Untitled',
    activePageId: pageId,
    pages: [{ id: pageId, name: 'Page 1', children: [] }],
    components: [],
    componentSets: [],
    recipes: [],
    colorStyles: [],
    prototypeStartPoint: null,
    settings: { unit: 'px', grid: 8, snap: true }
  };
}

const defaults = {
  frame: { name: 'Frame', width: 390, height: 844, fill: '#ffffff', clip: true },
  section: { name: 'Section', width: 480, height: 320, fill: '#e6e6e6', clip: false },
  group: { name: 'Group', width: 120, height: 80, fill: 'transparent', clip: false },
  rectangle: { name: 'Rectangle', width: 120, height: 80, fill: '#d9d9d9', radius: 0 },
  ellipse: { name: 'Ellipse', width: 100, height: 100, fill: '#d9d9d9' },
  line: { name: 'Line', width: 120, height: 0, fill: 'transparent', stroke: '#1e1e1e', strokeWidth: 2 },
  star: { name: 'Star', width: 100, height: 100, fill: '#ffcd29', points: 5, innerRadius: 0.48 },
  polygon: { name: 'Polygon', width: 100, height: 100, fill: '#d9d9d9', points: 6 },
  text: { name: 'Text', width: 240, height: 48, text: 'Text', fontFamily: 'Inter, Arial, sans-serif', fontSize: 24, fontWeight: 400, lineHeight: 1.25, letterSpacing: 0, color: '#1e1e1e', align: 'left' },
  image: { name: 'Image', width: 320, height: 240, fill: '#eeeeee', assetId: null, fileName: 'Image', adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0 }, fit: 'cover' },
  path: { name: 'Vector', width: 120, height: 100, fill: 'transparent', stroke: '#1e1e1e', strokeWidth: 2, points: [] }
};
const componentOverrideProperties = new Set([
  'name', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'locked', 'fill', 'fillOpacity', 'fillStyleId',
  'stroke', 'strokeWidth', 'radius', 'clip', 'text', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
  'letterSpacing', 'color', 'textStyleId', 'align', 'fit', 'adjustments', 'constraints', 'autoLayout',
  'layoutSizingMain', 'layoutSizingCross', 'points', 'closed', '__childOrder'
]);

export function createNode(type, overrides = {}) {
  const preset = defaults[type];
  if (!preset) throw new TypeError(`Unsupported layer type: ${type}`);
  return {
    id: createId(type), type,
    name: preset.name,
    x: 0, y: 0, width: preset.width, height: preset.height,
    rotation: 0, opacity: 1, visible: true, locked: false,
    fill: preset.fill, stroke: preset.stroke ?? null,
    strokeWidth: preset.strokeWidth ?? 0,
    radius: preset.radius ?? 0,
    clip: preset.clip ?? false,
    constraints: { horizontal: 'left', vertical: 'top' },
    children: [],
    ...preset,
    ...overrides,
    constraints: { horizontal: 'left', vertical: 'top', ...(overrides.constraints || {}) },
    children: overrides.children ? clone(overrides.children) : []
  };
}

export function getActivePage(document) {
  return document.pages.find(page => page.id === document.activePageId) ?? document.pages[0] ?? null;
}

export function walkNodes(nodes, visitor, parent = null, depth = 0, parents = []) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const entry = { node, parent, depth, index, parents };
    visitor(entry);
    walkNodes(node.children ?? [], visitor, node, depth + 1, [...parents, node]);
  }
}

export function findNode(document, nodeId, pageId = document.activePageId) {
  const page = document.pages.find(item => item.id === pageId);
  if (!page) return null;
  let found = null;
  walkNodes(page.children, entry => { if (entry.node.id === nodeId) found = entry; });
  return found;
}

export function findNodeAcrossPages(document, nodeId) {
  for (const page of document.pages) {
    const entry = findNode(document, nodeId, page.id);
    if (entry) return { ...entry, page };
  }
  return null;
}

export function addNode(document, node, { parentId = null, pageId = document.activePageId, index } = {}) {
  const page = document.pages.find(item => item.id === pageId);
  if (!page) throw new Error('The target page no longer exists.');
  const parent = parentId ? findNode(document, parentId, pageId)?.node : null;
  if (parentId && !parent) throw new Error('The target parent layer no longer exists.');
  if (parent && !['frame', 'group'].includes(parent.type)) throw new Error('This layer cannot contain other layers.');
  const list = parent ? parent.children : page.children;
  const insertAt = index == null ? list.length : Math.max(0, Math.min(index, list.length));
  list.splice(insertAt, 0, node);
  return node;
}

export function removeNode(document, nodeId, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return null;
  const list = entry.parent ? entry.parent.children : getActivePage({ ...document, activePageId: pageId }).children;
  const [removed] = list.splice(entry.index, 1);
  const removedComponents = [];
  walkNodes([removed], ({ node }) => { if (node.isComponent && node.componentId) removedComponents.push(node.componentId); });
  for (const componentId of removedComponents) {
    document.components = (document.components || []).filter(component => component.id !== componentId);
    detachComponentInstances(document, componentId);
    removeComponentFromSets(document, componentId);
  }
  return removed;
}

export function updateNode(document, nodeId, patch, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return false;
  Object.assign(entry.node, typeof patch === 'function' ? patch(entry.node) : patch);
  return true;
}

export function flattenPage(page) {
  const result = [];
  walkNodes(page?.children ?? [], entry => result.push(entry));
  return result;
}

export function absoluteBounds(document, nodeId, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return null;
  let x = entry.node.x;
  let y = entry.node.y;
  for (const parent of entry.parents) { x += parent.x; y += parent.y; }
  return { x, y, width: entry.node.width, height: entry.node.height };
}

export function duplicateNode(document, nodeId, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) return null;
  const duplicate = clone(entry.node);
  const renew = node => { node.id = createId(node.type); node.name = node.name.endsWith(' copy') ? `${node.name.slice(0, -5)} copy 2` : `${node.name} copy`; for (const child of node.children ?? []) renew(child); };
  renew(duplicate);
  duplicate.x += 16;
  duplicate.y += 16;
  const list = entry.parent ? entry.parent.children : document.pages.find(page => page.id === pageId).children;
  list.splice(entry.index + 1, 0, duplicate);
  return duplicate;
}

export function renameNode(document, nodeId, name, pageId = document.activePageId) {
  return updateNode(document, nodeId, { name: String(name).trim() || 'Untitled layer' }, pageId);
}

export function createImageRecipe(imageNode, name) {
  if (!imageNode || imageNode.type !== 'image') throw new TypeError('Recipes can only be created from an image layer.');
  return {
    id: createId('recipe'),
    name: String(name).trim() || `${imageNode.name} recipe`,
    adjustments: { ...imageNode.adjustments },
    fit: imageNode.fit ?? 'cover',
    opacity: imageNode.opacity ?? 1,
    createdAt: new Date().toISOString()
  };
}

export function applyImageRecipe(document, nodeId, recipe, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry || entry.node.type !== 'image') return false;
  entry.node.adjustments = { ...recipe.adjustments };
  entry.node.fit = recipe.fit ?? entry.node.fit;
  entry.node.opacity = recipe.opacity ?? entry.node.opacity;
  return true;
}

export function getNodeColor(document, node, kind = node?.type === 'text' ? 'text' : 'fill') {
  if (!node) return '#000000';
  const styleId = kind === 'text' ? node.textStyleId : node.fillStyleId;
  const style = (document.colorStyles || []).find(item => item.id === styleId && item.kind === kind);
  if (style) return style.value;
  return kind === 'text' ? (node.color || '#1e1e1e') : (node.fill || '#ffffff');
}

export function createColorStyle(document, nodeId, name, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  if (!node) throw new Error('Select a layer before creating a color style.');
  const kind = node.type === 'text' ? 'text' : 'fill';
  const value = getNodeColor(document, node, kind);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('Color styles require a solid six-digit color.');
  const style = { id: createId('style'), name: String(name).trim() || `${node.name} color`, kind, value };
  document.colorStyles ||= [];
  document.colorStyles.push(style);
  if (kind === 'text') node.textStyleId = style.id;
  else node.fillStyleId = style.id;
  return style;
}

export function applyColorStyle(document, nodeId, styleId, pageId = document.activePageId) {
  const node = findNode(document, nodeId, pageId)?.node;
  const style = document.colorStyles?.find(item => item.id === styleId);
  if (!node || !style) return false;
  if (style.kind === 'text' && node.type === 'text') node.textStyleId = style.id;
  else if (style.kind === 'fill' && !['text', 'image', 'line', 'path'].includes(node.type)) node.fillStyleId = style.id;
  else return false;
  return true;
}

export function createComponent(document, nodeId, name = null, pageId = document.activePageId) {
  const entry = findNode(document, nodeId, pageId);
  if (!entry) throw new Error('Select a layer to create a component.');
  if (entry.node.isInstance || entry.parents.some(parent => parent.isInstance)) throw new Error('Detach an instance before creating a new component.');
  if (entry.node.isComponent) return (document.components || []).find(component => component.id === entry.node.componentId) || null;
  const component = { id: createId('component'), name: String(name || entry.node.name).trim() || entry.node.name, pageId, rootNodeId: entry.node.id };
  entry.node.isComponent = true;
  entry.node.componentId = component.id;
  document.components ||= [];
  document.components.push(component);
  return component;
}

function assignVariantNodeKeys(root, key = 'root') {
  root.variantNodeKey = key;
  for (let index = 0; index < (root.children || []).length; index += 1) assignVariantNodeKeys(root.children[index], `${key}/${index}`);
}

function componentVariantValues(component, setProperties) {
  const segments = String(component.name).split('/').map(value => value.trim());
  const suffix = segments.slice(1).join('/');
  if (suffix.includes('=')) {
    const parsed = Object.fromEntries(suffix.split(',').map(part => {
      const [name, ...values] = part.split('=');
      return [name.trim(), values.join('=').trim()];
    }).filter(([name, value]) => name && value));
    if (Object.keys(parsed).length) return parsed;
  }
  const key = setProperties[0]?.name || 'Variant';
  return { [key]: suffix || component.name };
}

export function createComponentSet(document, componentIds, name = null) {
  const uniqueIds = [...new Set(componentIds || [])];
  if (uniqueIds.length < 2) throw new TypeError('Select at least two main components to combine as variants.');
  const components = uniqueIds.map(id => document.components?.find(component => component.id === id));
  if (components.some(component => !component)) throw new Error('One or more selected main components no longer exist.');
  if (components.some(component => component.componentSetId)) throw new Error('A component is already part of a variant set.');
  const roots = components.map(component => findNodeAcrossPages(document, component.rootNodeId)?.node);
  if (roots.some(root => !root?.isComponent)) throw new Error('Every variant must have a valid main component.');
  const commonPrefix = components.map(component => String(component.name).split('/')[0].trim()).every(value => value === String(components[0].name).split('/')[0].trim())
    ? String(components[0].name).split('/')[0].trim()
    : components[0].name;
  const set = { id: createId('component-set'), name: String(name || commonPrefix).trim() || commonPrefix, componentIds: uniqueIds, properties: [] };
  const rawValues = components.map(component => componentVariantValues(component, set.properties));
  const propertyNames = [...new Set(rawValues.flatMap(properties => Object.keys(properties)))];
  const combinations = rawValues.map(properties => JSON.stringify(propertyNames.map(propertyName => String(properties[propertyName] || 'Default'))));
  if (new Set(combinations).size !== combinations.length) throw new Error('Each variant needs a unique combination of property values. Rename layers with distinct variant names before combining.');
  set.properties = propertyNames.map(propertyName => ({
    name: propertyName,
    values: [...new Set(rawValues.map(properties => String(properties[propertyName] || 'Default')))]
  }));
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    component.componentSetId = set.id;
    component.variantProperties = Object.fromEntries(set.properties.map(property => [property.name, String(rawValues[index][property.name] || 'Default')]));
    assignVariantNodeKeys(roots[index]);
  }
  document.componentSets ||= [];
  document.componentSets.push(set);
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    if (!node.isInstance || !uniqueIds.includes(node.componentId)) return;
    walkNodes([node], ({ node: instanceNode }) => {
      const source = instanceNode.componentSourceId && findNodeAcrossPages(document, instanceNode.componentSourceId)?.node;
      if (source?.variantNodeKey) instanceNode.componentSourceKey = source.variantNodeKey;
    });
  });
  return set;
}

export function setComponentVariantProperty(document, componentId, propertyName, value) {
  const component = document.components?.find(item => item.id === componentId);
  const set = component && document.componentSets?.find(item => item.id === component.componentSetId);
  const name = String(propertyName || '').trim(); const nextValue = String(value ?? '').trim();
  if (!component || !set || !name || !nextValue) throw new Error('Choose a component variant property and value.');
  if (!set.properties.some(property => property.name === name)) throw new Error(`Variant property “${name}” does not exist.`);
  const proposed = { ...(component.variantProperties || {}), [name]: nextValue };
  const duplicate = set.componentIds.filter(id => id !== componentId).some(id => {
    const other = document.components.find(item => item.id === id);
    return set.properties.every(property => (other.variantProperties?.[property.name] || '') === (proposed[property.name] || ''));
  });
  if (duplicate) throw new Error('That combination already exists in this component set.');
  component.variantProperties = proposed;
  const property = set.properties.find(item => item.name === name);
  property.values = [...new Set(set.componentIds.map(id => {
    const item = document.components.find(componentItem => componentItem.id === id);
    return item?.variantProperties?.[name];
  }).filter(Boolean))];
  return component.variantProperties;
}

export function switchComponentInstanceVariant(document, instanceId, targetComponentId, pageId = document.activePageId) {
  const instance = findNode(document, instanceId, pageId)?.node;
  const currentComponent = instance?.isInstance && document.components?.find(item => item.id === instance.componentId);
  const targetComponent = document.components?.find(item => item.id === targetComponentId);
  if (!currentComponent || !targetComponent || !currentComponent.componentSetId || currentComponent.componentSetId !== targetComponent.componentSetId) throw new Error('Choose a variant from this component set.');
  if (currentComponent.id === targetComponent.id) return false;
  const targetMaster = findNodeAcrossPages(document, targetComponent.rootNodeId)?.node;
  if (!targetMaster?.isComponent) throw new Error('The selected variant no longer exists.');
  const overridesByKey = new Map();
  for (const [sourceId, overrides] of Object.entries(instance.componentOverrides || {})) {
    const source = findNodeAcrossPages(document, sourceId)?.node;
    if (source?.variantNodeKey) overridesByKey.set(source.variantNodeKey, overrides);
  }
  const targetNodesByKey = new Map();
  walkNodes([targetMaster], ({ node }) => { if (node.variantNodeKey) targetNodesByKey.set(node.variantNodeKey, node); });
  const nextOverrides = {};
  for (const [key, overrides] of overridesByKey) {
    const targetNode = targetNodesByKey.get(key);
    if (!targetNode) continue;
    const migrated = clone(overrides);
    if (Array.isArray(migrated.__childOrder)) migrated.__childOrder = migrated.__childOrder.map(id => {
      const source = findNodeAcrossPages(document, id)?.node;
      return source?.variantNodeKey ? targetNodesByKey.get(source.variantNodeKey)?.id : null;
    }).filter(Boolean);
    nextOverrides[targetNode.id] = migrated;
  }
  instance.componentId = targetComponent.id;
  instance.componentOverrides = nextOverrides;
  if (instance.componentNameIsInherited !== false) instance.name = `${targetComponent.name} instance`;
  syncInstanceNode(instance, targetMaster, targetComponent.id, nextOverrides, true);
  return true;
}

function removeComponentFromSets(document, componentId) {
  document.componentSets ||= [];
  for (const set of [...document.componentSets]) {
    if (!set.componentIds.includes(componentId)) continue;
    set.componentIds = set.componentIds.filter(id => id !== componentId);
    const remaining = set.componentIds.map(id => document.components.find(component => component.id === id)).filter(Boolean);
    const hasVariantDifferences = set.properties.some(property => new Set(remaining.map(component => component.variantProperties?.[property.name]).filter(Boolean)).size > 1);
    if (remaining.length < 2 || !hasVariantDifferences) {
      for (const component of remaining) { delete component.componentSetId; delete component.variantProperties; }
      document.componentSets = document.componentSets.filter(item => item.id !== set.id);
    } else {
      set.properties = set.properties.map(property => ({ ...property, values: [...new Set(remaining.map(component => component.variantProperties?.[property.name]).filter(Boolean))] }));
    }
  }
}

export function createComponentInstance(document, componentId, { pageId = document.activePageId, parentId = null, x = null, y = null } = {}) {
  const component = document.components?.find(item => item.id === componentId);
  const master = component && findNodeAcrossPages(document, component.rootNodeId);
  if (!component || !master || !master.node.isComponent) throw new Error('The main component no longer exists.');
  const targetPage = document.pages.find(page => page.id === pageId);
  if (!targetPage) throw new Error('The target page no longer exists.');
  const instance = clone(master.node);
  const renew = (node, isRoot = false) => {
    const sourceId = node.id;
    node.id = createId(node.type);
    node.componentSourceId = sourceId;
    if (node.variantNodeKey) node.componentSourceKey = node.variantNodeKey;
    else delete node.componentSourceKey;
    if (node.isComponent) {
      node.isInstance = true;
      delete node.isComponent;
    }
    for (const child of node.children || []) renew(child);
    if (isRoot) {
      node.isInstance = true;
      node.componentId = componentId;
      node.componentOverrides = {};
      node.componentNameIsInherited = true;
      node.name = `${component.name} instance`;
      node.x = x != null && Number.isFinite(Number(x)) ? Number(x) : node.x + 16;
      node.y = y != null && Number.isFinite(Number(y)) ? Number(y) : node.y + 16;
    }
  };
  renew(instance, true);
  addNode(document, instance, { pageId, parentId });
  return instance;
}

export function detachComponentInstances(document, componentId) {
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    if (node.isInstance && node.componentId === componentId) clearComponentInstanceLink(node);
  });
}

function clearComponentInstanceLink(instance) {
  const componentId = instance.componentId;
  delete instance.isInstance; delete instance.componentId; delete instance.componentOverrides; delete instance.componentNameIsInherited;
  walkNodes(instance.children || [], ({ node, parents }) => {
    const belongsToNestedInstance = parents.some(parent => parent.isInstance && parent.componentId !== componentId);
    if (!belongsToNestedInstance) { delete node.componentSourceId; delete node.componentSourceKey; }
    if (node.isInstance && node.componentId === componentId) { delete node.isInstance; delete node.componentId; delete node.componentOverrides; }
  });
  delete instance.componentSourceId; delete instance.componentSourceKey;
}

export function detachComponentInstance(document, nodeId, pageId = document.activePageId) {
  const instance = findNode(document, nodeId, pageId)?.node;
  if (!instance?.isInstance) return false;
  clearComponentInstanceLink(instance);
  return true;
}

function syncInstanceNode(instance, master, componentId, overrides, isRoot = false) {
  const stableId = instance?.id || createId(master.type);
  const rootX = instance?.x ?? master.x;
  const rootY = instance?.y ?? master.y;
  const rootName = instance?.name ?? `${master.name} instance`;
  const componentOverrides = isRoot ? clone(instance?.componentOverrides || {}) : null;
  const oldChildren = instance?.children || [];
  const oldChildrenBySourceId = new Map(oldChildren.filter(child => child.componentSourceId).map(child => [child.componentSourceId, child]));
  const oldChildrenBySourceKey = new Map(oldChildren.filter(child => child.componentSourceKey).map(child => [child.componentSourceKey, child]));
  const copy = clone(master);
  let children = (master.children || []).map((child, index) => {
    const legacyChild = oldChildren[index]?.componentSourceId ? null : oldChildren[index];
    return syncInstanceNode(oldChildrenBySourceId.get(child.id) || oldChildrenBySourceKey.get(child.variantNodeKey) || legacyChild, child, componentId, overrides);
  });
  const nodeOverrides = overrides?.[master.id];
  if (Array.isArray(nodeOverrides?.__childOrder)) {
    const masterOrder = new Map((master.children || []).map((child, index) => [child.id, index]));
    const requestedOrder = new Map(nodeOverrides.__childOrder.map((id, index) => [id, index]));
    children = children.map((child, index) => ({ child, index })).sort((a, b) => {
      const rank = item => requestedOrder.has(item.child.componentSourceId)
        ? requestedOrder.get(item.child.componentSourceId)
        : nodeOverrides.__childOrder.length + (masterOrder.get(item.child.componentSourceId) ?? item.index);
      return rank(a) - rank(b) || a.index - b.index;
    }).map(item => item.child);
  }
  const target = Object.assign(instance || {}, copy, {
    id: stableId,
    componentSourceId: master.id,
    children,
    x: isRoot ? rootX : copy.x,
    y: isRoot ? rootY : copy.y,
    name: isRoot ? rootName : copy.name
  });
  if (isRoot) {
    target.componentId = componentId;
    target.isInstance = true;
    target.componentOverrides = componentOverrides;
    delete target.isComponent;
  } else if (copy.isComponent) {
    target.componentId = copy.componentId;
    target.isInstance = true;
    delete target.isComponent;
  } else if (copy.isInstance) {
    target.componentId = copy.componentId;
    target.isInstance = true;
    delete target.isComponent;
  } else {
    delete target.componentId;
    delete target.isComponent;
    delete target.isInstance;
  }
  if (master.variantNodeKey) target.componentSourceKey = master.variantNodeKey;
  else delete target.componentSourceKey;
  if (nodeOverrides && typeof nodeOverrides === 'object' && !Array.isArray(nodeOverrides)) {
    for (const [key, value] of Object.entries(nodeOverrides)) if (key !== '__childOrder' && componentOverrideProperties.has(key)) target[key] = clone(value);
  }
  return target;
}

export function syncComponentInstances(document, componentId) {
  const component = document.components?.find(item => item.id === componentId);
  const master = component && findNodeAcrossPages(document, component.rootNodeId)?.node;
  if (!component || !master) return 0;
  const instances = [];
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    if (node.isInstance && node.componentId === componentId) instances.push(node);
  });
  for (const instance of instances) {
    syncInstanceNode(instance, master, componentId, instance.componentOverrides || {}, true);
    if (instance.componentNameIsInherited !== false) instance.name = `${component.name} instance`;
  }
  return instances.length;
}

export function syncAllComponentInstances(document) {
  for (const set of document.componentSets || []) for (const componentId of set.componentIds) {
    const component = document.components?.find(item => item.id === componentId);
    const master = component && findNodeAcrossPages(document, component.rootNodeId)?.node;
    if (master) assignVariantNodeKeys(master);
  }
  let updated = 0;
  for (const component of document.components || []) updated += syncComponentInstances(document, component.id);
  return updated;
}

export function cloneDocument(document) { return clone(document); }

export function validateDocument(document) {
  if (!document || document.schema !== 'figma-local/1' || !Array.isArray(document.pages) || !document.pages.length) throw new TypeError('Invalid local design file.');
  const pageIds = new Set();
  const nodeIds = new Set();
  for (const page of document.pages) {
    if (!page.id || pageIds.has(page.id) || !Array.isArray(page.children)) throw new TypeError('Invalid or duplicate page.');
    pageIds.add(page.id);
    walkNodes(page.children, ({ node }) => {
      if (!node.id || nodeIds.has(node.id)) throw new TypeError('Invalid or duplicate layer.');
      nodeIds.add(node.id);
      if (!defaults[node.type] || ![node.x, node.y, node.width, node.height, node.rotation, node.opacity].every(Number.isFinite) || node.width < 0 || node.height < 0 || node.opacity < 0 || node.opacity > 1) throw new TypeError(`Invalid geometry or type on layer ${node.name || node.id}.`);
      if (node.type === 'path' && (!Array.isArray(node.points) || node.points.some(point => !point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y)) || ['in', 'out'].some(part => point[part] != null && (!Number.isFinite(Number(point[part].x)) || !Number.isFinite(Number(point[part].y))))) || (node.closed != null && typeof node.closed !== 'boolean'))) throw new TypeError(`Invalid vector path on layer ${node.name || node.id}.`);
      if (node.children && !Array.isArray(node.children)) throw new TypeError('Layer children must be a list.');
      if (node.autoLayout && (node.type !== 'frame' || !['horizontal', 'vertical'].includes(node.autoLayout.axis) || !Number.isFinite(Number(node.autoLayout.gap)))) throw new TypeError(`Invalid auto layout on layer ${node.name || node.id}.`);
      if (node.interactions != null && (!Array.isArray(node.interactions) || node.interactions.some(item => !item || typeof item.id !== 'string' || item.action !== 'navigate' || typeof item.destinationId !== 'string'))) throw new TypeError(`Invalid prototype interactions on layer ${node.name || node.id}.`);
      if (node.constraints != null && (!['left', 'right', 'left-right', 'center', 'scale'].includes(node.constraints.horizontal) || !['top', 'bottom', 'top-bottom', 'center', 'scale'].includes(node.constraints.vertical))) throw new TypeError(`Invalid frame constraints on layer ${node.name || node.id}.`);
      if (node.componentSourceId != null && typeof node.componentSourceId !== 'string') throw new TypeError(`Invalid component source layer on ${node.name || node.id}.`);
      if (node.componentSourceKey != null && typeof node.componentSourceKey !== 'string') throw new TypeError(`Invalid component source key on ${node.name || node.id}.`);
      if (node.variantNodeKey != null && typeof node.variantNodeKey !== 'string') throw new TypeError(`Invalid variant node key on ${node.name || node.id}.`);
      if (node.componentNameIsInherited != null && (typeof node.componentNameIsInherited !== 'boolean' || !node.isInstance)) throw new TypeError(`Invalid inherited component name on ${node.name || node.id}.`);
      if (node.componentOverrides != null) {
        if (!node.isInstance || typeof node.componentOverrides !== 'object' || Array.isArray(node.componentOverrides)) throw new TypeError(`Invalid component overrides on ${node.name || node.id}.`);
        for (const [sourceId, overrides] of Object.entries(node.componentOverrides)) {
          if (!sourceId || !overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).some(key => !componentOverrideProperties.has(key)) || (overrides.__childOrder != null && (!Array.isArray(overrides.__childOrder) || overrides.__childOrder.some(id => typeof id !== 'string')))) throw new TypeError(`Invalid component override on ${node.name || node.id}.`);
        }
      }
    });
  }
  if (!pageIds.has(document.activePageId)) throw new TypeError('The active page does not exist.');
  if (document.components != null) {
    if (!Array.isArray(document.components)) throw new TypeError('Components must be a list.');
    const componentIds = new Set();
    for (const component of document.components) {
      const root = findNodeAcrossPages(document, component.rootNodeId);
      if (!component.id || componentIds.has(component.id) || !root?.node.isComponent || root.node.componentId !== component.id) throw new TypeError('Invalid or duplicate component.');
      if (component.componentSetId != null && typeof component.componentSetId !== 'string') throw new TypeError('Invalid component set reference.');
      if (component.variantProperties != null && (!component.variantProperties || typeof component.variantProperties !== 'object' || Array.isArray(component.variantProperties) || Object.values(component.variantProperties).some(value => typeof value !== 'string' || !value))) throw new TypeError('Invalid component variant properties.');
      componentIds.add(component.id);
    }
    for (const page of document.pages) walkNodes(page.children, ({ node }) => {
      if (node.isComponent && !componentIds.has(node.componentId)) throw new TypeError(`Missing component definition on layer ${node.name || node.id}.`);
      if (node.isInstance && !componentIds.has(node.componentId)) throw new TypeError(`Missing component source on layer ${node.name || node.id}.`);
    });
  }
  if (document.componentSets != null) {
    if (!Array.isArray(document.componentSets)) throw new TypeError('Component sets must be a list.');
    const setIds = new Set(); const memberIds = new Set(); const components = document.components || [];
    for (const set of document.componentSets) {
      if (!set.id || setIds.has(set.id) || typeof set.name !== 'string' || !set.name.trim() || !Array.isArray(set.componentIds) || set.componentIds.length < 2 || new Set(set.componentIds).size !== set.componentIds.length || !Array.isArray(set.properties) || !set.properties.length) throw new TypeError('Invalid or duplicate component set.');
      setIds.add(set.id);
      const members = set.componentIds.map(id => components.find(component => component.id === id));
      if (members.some(component => !component || component.componentSetId !== set.id)) throw new TypeError('Component set members are missing or mismatched.');
      const propertyNames = new Set();
      for (const property of set.properties) {
        if (!property || typeof property.name !== 'string' || !property.name.trim() || propertyNames.has(property.name) || !Array.isArray(property.values) || !property.values.length || new Set(property.values).size !== property.values.length || property.values.some(value => typeof value !== 'string' || !value)) throw new TypeError('Invalid component variant property.');
        propertyNames.add(property.name);
        if (members.some(component => !property.values.includes(component.variantProperties?.[property.name]))) throw new TypeError(`Variant values are missing for property ${property.name}.`);
      }
      for (const component of members) memberIds.add(component.id);
      const combinations = members.map(component => JSON.stringify(set.properties.map(property => component.variantProperties[property.name])));
      if (new Set(combinations).size !== combinations.length) throw new TypeError('Component set contains duplicate variant combinations.');
    }
    for (const component of components) {
      if (component.componentSetId && (!setIds.has(component.componentSetId) || !memberIds.has(component.id))) throw new TypeError('Component points to a missing variant set.');
      if (!component.componentSetId && component.variantProperties != null) throw new TypeError('Variant properties require a component set.');
    }
  }
  if (!Array.isArray(document.recipes)) throw new TypeError('Recipes must be a list.');
  if (document.colorStyles != null) {
    if (!Array.isArray(document.colorStyles)) throw new TypeError('Color styles must be a list.');
    const styleIds = new Set();
    for (const style of document.colorStyles) {
      if (!style.id || styleIds.has(style.id) || !['fill', 'text'].includes(style.kind) || !/^#[0-9a-f]{6}$/i.test(style.value || '')) throw new TypeError('Invalid or duplicate color style.');
      styleIds.add(style.id);
    }
    for (const page of document.pages) walkNodes(page.children, ({ node }) => {
      if (node.fillStyleId && !styleIds.has(node.fillStyleId)) throw new TypeError(`Missing fill style on layer ${node.name || node.id}.`);
      if (node.textStyleId && !styleIds.has(node.textStyleId)) throw new TypeError(`Missing text style on layer ${node.name || node.id}.`);
    });
  }
  return true;
}

export function serializeDocument(document) {
  validateDocument(document);
  return JSON.stringify(document);
}

export function parseDocument(json) {
  const document = typeof json === 'string' ? JSON.parse(json) : clone(json);
  validateDocument(document);
  return document;
}
