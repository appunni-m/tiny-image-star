const numericProperties = ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fillOpacity', 'strokeWidth', 'radius', 'fontSize', 'lineHeight', 'letterSpacing'];
const colorProperties = ['fill', 'stroke', 'color'];

function interpolateColor(from, to, progress) {
  const fromMatch = /^#([0-9a-f]{6})$/i.exec(String(from || ''));
  const toMatch = /^#([0-9a-f]{6})$/i.exec(String(to || ''));
  if (!fromMatch || !toMatch) return null;
  const fromValue = Number.parseInt(fromMatch[1], 16);
  const toValue = Number.parseInt(toMatch[1], 16);
  const channels = [16, 8, 0].map(shift => {
    const start = (fromValue >> shift) & 255;
    const end = (toValue >> shift) & 255;
    return Math.round(start + (end - start) * progress).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

function canMatch(from, to) {
  if (!from || !to || from.type !== to.type) return false;
  if (from.type === 'text' && from.text !== to.text) return false;
  if (from.type === 'image' && from.assetId !== to.assetId) return false;
  if (from.type === 'boolean' && from.operation !== to.operation) return false;
  if (from.type === 'path' && JSON.stringify(from.points || []) !== JSON.stringify(to.points || [])) return false;
  return true;
}

function siblingKeys(nodes) {
  const counts = new Map();
  return nodes.map(node => {
    const base = `${node.type}\u0000${node.name || ''}`;
    const occurrence = counts.get(base) || 0;
    counts.set(base, occurrence + 1);
    return `${base}\u0000${occurrence}`;
  });
}

function layerOpacity(node) {
  return Number.isFinite(node.opacity) ? Math.max(0, Math.min(1, node.opacity)) : 1;
}

function fadeLayer(node, progress, entering) {
  const copy = structuredClone(node);
  if (copy.visible !== false) {
    copy.visible = true;
    copy.opacity = layerOpacity(node) * (entering ? progress : 1 - progress);
  }
  return copy;
}

function interpolateLayer(from, to, progress) {
  const copy = structuredClone(to);
  for (const property of numericProperties) {
    if (Number.isFinite(from[property]) && Number.isFinite(to[property])) copy[property] = from[property] + (to[property] - from[property]) * progress;
  }
  for (const property of colorProperties) {
    const variable = property === 'fill' ? 'fillVariableId' : property === 'stroke' ? 'strokeVariableId' : 'textVariableId';
    if (from[variable] || to[variable]) continue;
    const color = interpolateColor(from[property], to[property], progress);
    if (color) copy[property] = color;
  }
  if (from.visible === false && to.visible !== false) {
    copy.visible = true;
    copy.opacity = layerOpacity(to) * progress;
  } else if (from.visible !== false && to.visible === false) {
    copy.visible = true;
    copy.opacity = layerOpacity(from) * (1 - progress);
  } else if (from.visible === false && to.visible === false) copy.visible = false;
  copy.children = blendChildren(from.children || [], to.children || [], progress);
  return copy;
}

function blendChildren(fromChildren, toChildren, progress) {
  const fromKeys = siblingKeys(fromChildren);
  const toKeys = siblingKeys(toChildren);
  const sourceByKey = new Map(fromChildren.map((node, index) => [fromKeys[index], { node, index }]));
  const matchedSourceIndexes = new Set();
  const result = toChildren.map((node, index) => {
    const match = sourceByKey.get(toKeys[index]);
    if (match && canMatch(match.node, node)) {
      matchedSourceIndexes.add(match.index);
      return interpolateLayer(match.node, node, progress);
    }
    return fadeLayer(node, progress, true);
  });
  for (let index = 0; index < fromChildren.length; index += 1) {
    if (!matchedSourceIndexes.has(index)) result.push(fadeLayer(fromChildren[index], progress, false));
  }
  return result;
}

export function interpolateSmartFrame(fromFrame, toFrame, progress) {
  if (fromFrame?.type !== 'frame' || toFrame?.type !== 'frame') throw new TypeError('Smart animation requires two frames.');
  const amount = Math.max(0, Math.min(1, Number.isFinite(Number(progress)) ? Number(progress) : 0));
  const frame = structuredClone(toFrame);
  for (const property of ['width', 'height', 'opacity']) {
    if (Number.isFinite(fromFrame[property]) && Number.isFinite(toFrame[property])) frame[property] = fromFrame[property] + (toFrame[property] - fromFrame[property]) * amount;
  }
  const fill = interpolateColor(fromFrame.fill, toFrame.fill, amount);
  if (fill && !fromFrame.fillVariableId && !toFrame.fillVariableId) frame.fill = fill;
  frame.children = blendChildren(fromFrame.children || [], toFrame.children || [], amount);
  return frame;
}
