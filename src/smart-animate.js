import { isValidGradientFill } from './fills.js';
import { isValidLayerEffects } from './layer-effects.js';

const numericProperties = ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fillOpacity', 'strokeWidth', 'radius', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];
const colorProperties = ['fill', 'stroke', 'color'];
const textRunNumericProperties = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];
const midpointProperties = [
  ...colorProperties,
  'fillStyleId', 'fillGradient', 'imageFill', 'fillVariableId', 'strokeVariableId', 'textVariableId',
  'blendMode', 'effects', 'fontFamily', 'fontStyle', 'textCase', 'textDecoration', 'align', 'verticalAlign', 'textFit', 'textStyleId'
];

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

function canInterpolateGradient(from, to) {
  return isValidGradientFill(from) && isValidGradientFill(to)
    && from.type === to.type && from.stops.length === to.stops.length;
}

function interpolateGradient(from, to, progress) {
  if (progress === 0) return structuredClone(from);
  if (progress === 1) return structuredClone(to);
  const angle = interpolateRotation(from.angle, to.angle, progress);
  return {
    ...structuredClone(to),
    angle: ((angle % 360) + 360) % 360,
    stops: to.stops.map((stop, index) => {
      const start = from.stops[index];
      return {
        ...structuredClone(stop),
        position: start.position + (stop.position - start.position) * progress,
        color: interpolateColor(start.color, stop.color, progress) || stop.color
      };
    })
  };
}

function canInterpolateEffects(from, to) {
  return Array.isArray(from) && Array.isArray(to)
    && from.length === to.length
    && isValidLayerEffects(from) && isValidLayerEffects(to)
    && from.every((effect, index) => effect.type === to[index].type);
}

function interpolateEffects(from, to, progress) {
  if (progress === 0) return structuredClone(from);
  if (progress === 1) return structuredClone(to);
  if (!canInterpolateEffects(from, to)) return null;

  const categoricalSource = progress < 0.5 ? from : to;
  return to.map((effect, index) => {
    const start = from[index];
    const result = structuredClone(categoricalSource[index]);
    if (effect.type === 'drop-shadow') {
      for (const property of ['opacity', 'offsetX', 'offsetY', 'blur']) {
        result[property] = start[property] + (effect[property] - start[property]) * progress;
      }
      result.color = interpolateColor(start.color, effect.color, progress) || result.color;
    } else if (effect.type === 'layer-blur') {
      result.radius = start.radius + (effect.radius - start.radius) * progress;
    }
    return result;
  });
}

function canMatch(from, to) {
  if (!from || !to || from.type !== to.type) return false;
  if (from.type === 'text' && from.text !== to.text) return false;
  if (from.type === 'image' && from.assetId !== to.assetId) return false;
  if (from.type === 'boolean' && from.operation !== to.operation) return false;
  if (from.type === 'path' && !canInterpolatePath(from, to)) return false;
  if (from.type === 'network' && JSON.stringify([from.vertices || [], from.edges || [], from.faces || []]) !== JSON.stringify([to.vertices || [], to.edges || [], to.faces || []])) return false;
  return true;
}

function isFinitePathCoordinate(value) {
  return finiteStyleNumber(value) !== null;
}

function isValidPathPoint(point) {
  if (!point || typeof point !== 'object' || Array.isArray(point)
      || !isFinitePathCoordinate(point.x) || !isFinitePathCoordinate(point.y)) return false;
  return ['in', 'out'].every(part => point[part] == null || (
    typeof point[part] === 'object' && !Array.isArray(point[part])
      && isFinitePathCoordinate(point[part].x) && isFinitePathCoordinate(point[part].y)
  ));
}

function canInterpolatePath(from, to) {
  const fromClosed = from.closed ?? false;
  const toClosed = to.closed ?? false;
  if (typeof fromClosed !== 'boolean' || typeof toClosed !== 'boolean' || fromClosed !== toClosed) return false;
  if (!Array.isArray(from.points) || !Array.isArray(to.points) || from.points.length !== to.points.length) return false;
  for (let index = 0; index < from.points.length; index += 1) {
    if (!isValidPathPoint(from.points[index]) || !isValidPathPoint(to.points[index])) return false;
  }
  return true;
}

function interpolatePathPoints(fromPoints, toPoints, progress) {
  if (progress === 0) return structuredClone(fromPoints);
  if (progress === 1) return structuredClone(toPoints);
  return toPoints.map((toPoint, index) => {
    const fromPoint = fromPoints[index];
    const point = structuredClone(toPoint);
    point.x = Number(fromPoint.x) + (Number(toPoint.x) - Number(fromPoint.x)) * progress;
    point.y = Number(fromPoint.y) + (Number(toPoint.y) - Number(fromPoint.y)) * progress;
    for (const part of ['in', 'out']) {
      const fromHandle = fromPoint[part];
      const toHandle = toPoint[part];
      if (fromHandle == null && toHandle == null) continue;
      const start = fromHandle ?? { x: 0, y: 0 };
      const end = toHandle ?? { x: 0, y: 0 };
      point[part] = {
        x: Number(start.x) + (Number(end.x) - Number(start.x)) * progress,
        y: Number(start.y) + (Number(end.y) - Number(start.y)) * progress
      };
    }
    return point;
  });
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

function snapProperty(copy, from, to, property, progress) {
  const source = progress < 0.5 ? from : to;
  if (Object.prototype.hasOwnProperty.call(source, property)) copy[property] = structuredClone(source[property]);
  else delete copy[property];
}

function snapProperties(copy, from, to, progress) {
  for (const property of midpointProperties) snapProperty(copy, from, to, property, progress);
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
  snapProperties(copy, from, to, progress);
  const effects = interpolateEffects(from.effects, to.effects, progress);
  if (effects) copy.effects = effects;
  for (const property of numericProperties) {
    const start = finiteStyleNumber(from[property]);
    const end = finiteStyleNumber(to[property]);
    if (start === null || end === null) continue;
    copy[property] = property === 'rotation' ? interpolateRotation(from[property], to[property], progress)
      : progress === 0 ? from[property]
      : progress === 1 ? to[property]
        : start + (end - start) * progress;
  }
  for (const property of colorProperties) {
    const variable = property === 'fill' ? 'fillVariableId' : property === 'stroke' ? 'strokeVariableId' : 'textVariableId';
    if (from[variable] || to[variable]) continue;
    const color = interpolateColor(from[property], to[property], progress);
    if (color) copy[property] = color;
  }
  if (!from.fillVariableId && !to.fillVariableId && canInterpolateGradient(from.fillGradient, to.fillGradient)) {
    copy.fillGradient = interpolateGradient(from.fillGradient, to.fillGradient, progress);
  }
  if (from.visible === false && to.visible !== false) {
    copy.visible = true;
    copy.opacity = layerOpacity(to) * progress;
  } else if (from.visible !== false && to.visible === false) {
    copy.visible = true;
    copy.opacity = layerOpacity(from) * (1 - progress);
  } else if (from.visible === false && to.visible === false) copy.visible = false;
  if (from.type === 'text' && to.type === 'text') {
    const textRuns = interpolateTextRuns(from.textRuns, to.textRuns, progress);
    if (textRuns) copy.textRuns = textRuns;
    else snapProperty(copy, from, to, 'textRuns', progress);
  }
  if (from.type === 'path' && to.type === 'path') {
    copy.points = interpolatePathPoints(from.points, to.points, progress);
  }
  copy.children = blendChildren(from.children || [], to.children || [], progress);
  return copy;
}

function finiteStyleNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function shortestRotationDelta(from, to) {
  const difference = (to % 360) - (from % 360);
  const wrapped = ((difference % 360) + 360) % 360;
  if (wrapped === 180) return difference < 0 ? -180 : 180;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function interpolateRotation(from, to, progress) {
  if (progress === 0) return from;
  if (progress === 1) return to;
  const start = Number(from);
  const end = Number(to);
  return start + shortestRotationDelta(start, end) * progress;
}

function interpolateTextRuns(fromRuns, toRuns, progress) {
  if (!Array.isArray(fromRuns) || !Array.isArray(toRuns) || fromRuns.length !== toRuns.length) return null;
  if (fromRuns.some((run, index) => run.text !== toRuns[index].text)) return null;

  return toRuns.map((toRun, index) => {
    const fromRun = fromRuns[index];
    const run = structuredClone(toRun);
    for (const property of textRunNumericProperties) {
      const start = finiteStyleNumber(fromRun[property]);
      const end = finiteStyleNumber(toRun[property]);
      if (start === null || end === null) continue;
      run[property] = progress === 0 ? fromRun[property]
        : progress === 1 ? toRun[property]
          : start + (end - start) * progress;
    }
    if (fromRun.color != null && toRun.color != null) {
      const color = interpolateColor(fromRun.color, toRun.color, progress);
      if (color) run.color = progress === 0 ? fromRun.color : progress === 1 ? toRun.color : color;
    }
    return run;
  });
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
  snapProperties(frame, fromFrame, toFrame, amount);
  for (const property of ['width', 'height', 'opacity', 'rotation']) {
    if (Number.isFinite(fromFrame[property]) && Number.isFinite(toFrame[property])) {
      frame[property] = property === 'rotation' ? interpolateRotation(fromFrame[property], toFrame[property], amount)
        : amount === 0 ? fromFrame[property]
          : amount === 1 ? toFrame[property]
            : fromFrame[property] + (toFrame[property] - fromFrame[property]) * amount;
    }
  }
  const fill = interpolateColor(fromFrame.fill, toFrame.fill, amount);
  if (fill && !fromFrame.fillVariableId && !toFrame.fillVariableId) frame.fill = fill;
  if (!fromFrame.fillVariableId && !toFrame.fillVariableId && canInterpolateGradient(fromFrame.fillGradient, toFrame.fillGradient)) {
    frame.fillGradient = interpolateGradient(fromFrame.fillGradient, toFrame.fillGradient, amount);
  }
  frame.children = blendChildren(fromFrame.children || [], toFrame.children || [], amount);
  return frame;
}
