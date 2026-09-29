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
  if (entry.node.isInstance) throw new Error('Detach an instance before creating a new component.');
  if (entry.node.isComponent) return (document.components || []).find(component => component.id === entry.node.componentId) || null;
  const component = { id: createId('component'), name: String(name || entry.node.name).trim() || entry.node.name, pageId, rootNodeId: entry.node.id };
  entry.node.isComponent = true;
  entry.node.componentId = component.id;
  document.components ||= [];
  document.components.push(component);
  return component;
}

export function createComponentInstance(document, componentId) {
  const component = document.components?.find(item => item.id === componentId);
  const master = component && findNodeAcrossPages(document, component.rootNodeId);
  if (!component || !master || !master.node.isComponent) throw new Error('The main component no longer exists.');
  const instance = duplicateNode(document, master.node.id, master.page.id);
  if (!instance) throw new Error('Could not create a component instance.');
  const resetNested = node => {
    if (node !== instance && node.isComponent) { node.isComponent = false; node.isInstance = true; }
    for (const child of node.children || []) resetNested(child);
  };
  resetNested(instance);
  instance.isComponent = false;
  instance.isInstance = true;
  instance.componentId = componentId;
  instance.name = `${component.name} instance`;
  return instance;
}

export function detachComponentInstances(document, componentId) {
  for (const page of document.pages) walkNodes(page.children, ({ node }) => {
    if (node.isInstance && node.componentId === componentId) { delete node.isInstance; delete node.componentId; }
  });
}

export function detachComponentInstance(document, nodeId, pageId = document.activePageId) {
  const instance = findNode(document, nodeId, pageId)?.node;
  if (!instance?.isInstance) return false;
  const componentId = instance.componentId;
  delete instance.isInstance; delete instance.componentId;
  for (const child of instance.children || []) walkNodes([child], ({ node }) => {
    if (node.isInstance && node.componentId === componentId) { delete node.isInstance; delete node.componentId; }
  });
  return true;
}

function syncInstanceNode(instance, master, componentId, isRoot = false) {
  const stableId = instance?.id || createId(master.type);
  const rootX = instance?.x ?? master.x;
  const rootY = instance?.y ?? master.y;
  const oldChildren = instance?.children || [];
  const copy = clone(master);
  const children = (master.children || []).map((child, index) => syncInstanceNode(oldChildren[index], child, componentId));
  Object.assign(instance || {}, copy, { id: stableId, children, x: isRoot ? rootX : copy.x, y: isRoot ? rootY : copy.y });
  if (isRoot) {
    instance.componentId = componentId;
    instance.isInstance = true;
    delete instance.isComponent;
  } else if (instance !== null && copy.isComponent) {
    instance.isComponent = false;
    instance.isInstance = true;
  }
  return instance || { ...copy, id: stableId, children };
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
    syncInstanceNode(instance, master, componentId, true);
    instance.name = `${component.name} instance`;
  }
  return instances.length;
}

export function syncAllComponentInstances(document) {
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
      if (node.children && !Array.isArray(node.children)) throw new TypeError('Layer children must be a list.');
      if (node.autoLayout && (node.type !== 'frame' || !['horizontal', 'vertical'].includes(node.autoLayout.axis) || !Number.isFinite(Number(node.autoLayout.gap)))) throw new TypeError(`Invalid auto layout on layer ${node.name || node.id}.`);
      if (node.interactions != null && (!Array.isArray(node.interactions) || node.interactions.some(item => !item || typeof item.id !== 'string' || item.action !== 'navigate' || typeof item.destinationId !== 'string'))) throw new TypeError(`Invalid prototype interactions on layer ${node.name || node.id}.`);
      if (node.constraints != null && (!['left', 'right', 'left-right', 'center', 'scale'].includes(node.constraints.horizontal) || !['top', 'bottom', 'top-bottom', 'center', 'scale'].includes(node.constraints.vertical))) throw new TypeError(`Invalid frame constraints on layer ${node.name || node.id}.`);
    });
  }
  if (!pageIds.has(document.activePageId)) throw new TypeError('The active page does not exist.');
  if (document.components != null) {
    if (!Array.isArray(document.components)) throw new TypeError('Components must be a list.');
    const componentIds = new Set();
    for (const component of document.components) {
      const root = findNodeAcrossPages(document, component.rootNodeId);
      if (!component.id || componentIds.has(component.id) || !root?.node.isComponent || root.node.componentId !== component.id) throw new TypeError('Invalid or duplicate component.');
      componentIds.add(component.id);
    }
    for (const page of document.pages) walkNodes(page.children, ({ node }) => {
      if (node.isComponent && !componentIds.has(node.componentId)) throw new TypeError(`Missing component definition on layer ${node.name || node.id}.`);
      if (node.isInstance && !componentIds.has(node.componentId)) throw new TypeError(`Missing component source on layer ${node.name || node.id}.`);
    });
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
