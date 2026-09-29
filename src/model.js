export const DOCUMENT_VERSION = 1;

export function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createNode(type, values = {}) {
  const defaults = {
    frame: { name: 'Frame', x: 0, y: 0, w: 1440, h: 900, fill: '#ffffff', stroke: '#d9d9de', strokeWidth: 1, radius: 0 },
    rect: { name: 'Rectangle', x: 80, y: 80, w: 240, h: 160, fill: '#d9d9d9', stroke: '#000000', strokeWidth: 0, radius: 0 },
    ellipse: { name: 'Ellipse', x: 80, y: 80, w: 160, h: 160, fill: '#d9d9d9', stroke: '#000000', strokeWidth: 0, radius: 0 },
    text: { name: 'Text', x: 80, y: 80, w: 260, h: 56, fill: '#1e1e1e', stroke: '#000000', strokeWidth: 0, radius: 0, text: 'Type something', fontSize: 32, fontWeight: 400 },
    pen: { name: 'Vector', x: 80, y: 80, w: 160, h: 120, fill: 'none', stroke: '#9747ff', strokeWidth: 3, radius: 0 }
  };
  if (!defaults[type]) throw new TypeError(`Unsupported node type: ${type}`);
  const overrides = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
  return { id: createId(), type, opacity: 1, parentId: null, ...defaults[type], ...overrides };
}

export function createInitialProject() {
  const frame = createNode('frame', { name: 'Desktop' });
  return {
    version: DOCUMENT_VERSION,
    id: createId(),
    name: 'Untitled',
    activePageId: 'page-1',
    pages: [{ id: 'page-1', name: 'Page 1', nodes: [frame] }]
  };
}

export function activePage(project) {
  return project.pages.find(page => page.id === project.activePageId) ?? project.pages[0];
}

export function findNode(project, nodeId) {
  return project.pages.flatMap(page => page.nodes).find(node => node.id === nodeId) ?? null;
}

export function descendants(nodes, id) {
  const result = [];
  const pending = [id];
  while (pending.length) {
    const parent = pending.pop();
    for (const node of nodes) if (node.parentId === parent) { result.push(node); pending.push(node.id); }
  }
  return result;
}

export function validateProject(value) {
  if (!value || typeof value !== 'object' || value.version !== DOCUMENT_VERSION || !Array.isArray(value.pages) || value.pages.length === 0) return false;
  const ids = new Set();
  for (const page of value.pages) {
    if (!page || typeof page.id !== 'string' || !Array.isArray(page.nodes)) return false;
    for (const node of page.nodes) {
      if (!node || typeof node.id !== 'string' || ids.has(node.id) || !['frame', 'rect', 'ellipse', 'text', 'pen'].includes(node.type)) return false;
      ids.add(node.id);
      for (const key of ['x', 'y', 'w', 'h']) if (!Number.isFinite(node[key])) return false;
      if (node.w < 0 || node.h < 0) return false;
    }
  }
  return value.pages.some(page => page.id === value.activePageId);
}

export function serializeProject(project) {
  return JSON.stringify(project);
}
