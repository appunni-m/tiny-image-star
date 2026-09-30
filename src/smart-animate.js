import { isValidGradientFill } from './fills.js';
import { isValidLayerEffects } from './layer-effects.js';
import { cornerRadiiForNode, cornerRadiusKeys } from './corner-radii.js';

const numericProperties = ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fillOpacity', 'strokeWidth', 'strokeMiterLimit', 'radius', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];
const colorProperties = ['fill', 'stroke', 'color'];
const textNodeNumericProperties = ['paragraphSpacing', 'firstLineIndent', 'listSpacing'];
const textRunNumericProperties = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];
const midpointProperties = [
  ...colorProperties, 'fills',
  'fillStyleId', 'fillGradient', 'imageFill', 'fillVariableId', 'strokeVariableId', 'textVariableId',
  'blendMode', 'effects', 'fontFamily', 'fontStyle', 'textCase', 'textDecoration', 'paragraphStyles', 'align', 'verticalAlign', 'textFit', 'textStyleId',
  'strokePattern', 'strokeCap', 'strokeJoin', 'fillRule'
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

function fillBindingKey(node, fill) {
  // The current editor binds fill variables/styles at the node's primary-fill
  // level. Keep the per-fill keys too, so imported or future bound paints use
  // the same conservative compatibility rule.
  return JSON.stringify({
    nodeVariable: node.fillVariableId || null,
    nodeStyle: node.fillStyleId || null,
    nodeBinding: node.variableBindings?.fill || null,
    variable: fill.variableId || fill.fillVariableId || null,
    style: fill.styleId || fill.fillStyleId || null,
    binding: fill.variableBindings || null
  });
}

function canInterpolateFillStack(fromNode, toNode) {
  const from = fromNode.fills;
  const to = toNode.fills;
  return Array.isArray(from) && Array.isArray(to)
    && from.length === to.length
    && fillBindingKey(fromNode, from[0] || {}) === fillBindingKey(toNode, to[0] || {})
    && from.every((fill, index) => {
      const destination = to[index];
      if (!fill || !destination || fill.type !== destination.type
          || fill.visible !== destination.visible
          || fillBindingKey(fromNode, fill) !== fillBindingKey(toNode, destination)) return false;
      if (fill.type === 'linear' || fill.type === 'radial') {
        return canInterpolateGradient(fill.gradient, destination.gradient);
      }
      return ['solid', 'image'].includes(fill.type);
    });
}

function interpolateFillStack(fromNode, toNode, progress) {
  if (progress === 0) return structuredClone(fromNode.fills);
  if (progress === 1) return structuredClone(toNode.fills);
  if (!canInterpolateFillStack(fromNode, toNode)) return null;

  const boundPrimary = Boolean(toNode.fillVariableId || toNode.fillStyleId || toNode.variableBindings?.fill);
  return toNode.fills.map((fill, index) => {
    const start = fromNode.fills[index];
    const categorical = progress < 0.5 ? start : fill;
    const result = structuredClone(categorical);
    if (Number.isFinite(start.opacity) && Number.isFinite(fill.opacity)) {
      result.opacity = start.opacity + (fill.opacity - start.opacity) * progress;
    }
    if (fill.type === 'solid') {
      const boundPaint = Boolean(fill.variableId || fill.fillVariableId || fill.styleId || fill.fillStyleId || fill.variableBindings);
      if (!(index === 0 && boundPrimary) && !boundPaint) {
        const color = interpolateColor(start.color, fill.color, progress);
        if (color) result.color = color;
        else if (progress >= 0.5) result.color = structuredClone(fill.color);
      }
    } else if (fill.type === 'linear' || fill.type === 'radial') {
      const boundPaint = Boolean(fill.variableId || fill.fillVariableId || fill.styleId || fill.fillStyleId || fill.variableBindings);
      if (!boundPaint) result.gradient = interpolateGradient(start.gradient, fill.gradient, progress);
    }
    // Image fills deliberately retain the source reference before halfway and
    // take the destination reference at halfway; their crop/fit semantics are
    // categorical, while the fill's own opacity remains continuous.
    return result;
  });
}

function canInterpolateEffects(from, to) {
  return Array.isArray(from) && Array.isArray(to)
    && from.length === to.length
    && isValidLayerEffects(from) && isValidLayerEffects(to)
    && from.every((effect, index) => {
      const destination = to[index];
      if (effect.type !== destination.type || effect.visible !== destination.visible) return false;
      // Shadow colors are only interpolated as six-digit hex values. Keep the
      // entire stack on its existing midpoint fallback if either endpoint
      // cannot be represented by that color interpolation path.
      return effect.type === 'layer-blur'
        || interpolateColor(effect.color, destination.color, 0.5) !== null;
    });
}

function interpolateEffects(from, to, progress) {
  if (progress === 0) return structuredClone(from);
  if (progress === 1) return structuredClone(to);
  if (!canInterpolateEffects(from, to)) return null;

  const categoricalSource = progress < 0.5 ? from : to;
  return to.map((effect, index) => {
    const start = from[index];
    const result = structuredClone(categoricalSource[index]);
    if (effect.type === 'drop-shadow' || effect.type === 'inner-shadow') {
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
  if (from.type === 'network' && !canInterpolateNetwork(from, to)) return false;
  return true;
}

function isFiniteNetworkPoint(point) {
  return Boolean(point && typeof point === 'object' && !Array.isArray(point)
    && finiteStyleNumber(point.x) !== null && finiteStyleNumber(point.y) !== null);
}

function hasUniqueIds(records) {
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || typeof record.id !== 'string' || !record.id || ids.has(record.id)) return false;
    ids.add(record.id);
  }
  return ids;
}

function isValidNetwork(node) {
  if (!Array.isArray(node.vertices) || !Array.isArray(node.edges) || !Array.isArray(node.faces)) return false;
  const vertexIds = hasUniqueIds(node.vertices);
  const edgeIds = hasUniqueIds(node.edges);
  const faceIds = hasUniqueIds(node.faces);
  if (!vertexIds || !edgeIds || !faceIds) return false;
  if (node.vertices.some(vertex => !isFiniteNetworkPoint(vertex))) return false;
  if (node.edges.some(edge => typeof edge.from !== 'string' || typeof edge.to !== 'string'
      || !vertexIds.has(edge.from) || !vertexIds.has(edge.to) || edge.from === edge.to
      || ['control1', 'control2'].some(key => edge[key] != null && !isFiniteNetworkPoint(edge[key])))) return false;
  const connections = new Map(node.vertices.map(vertex => [vertex.id, new Set()]));
  for (const edge of node.edges) {
    connections.get(edge.from).add(edge.to);
    connections.get(edge.to).add(edge.from);
  }
  if (node.faces.some(face => !Array.isArray(face.vertexIds) || face.vertexIds.length < 3
      || new Set(face.vertexIds).size !== face.vertexIds.length
      || face.vertexIds.some((id, index) => typeof id !== 'string' || !vertexIds.has(id)
        || !connections.get(id)?.has(face.vertexIds[(index + 1) % face.vertexIds.length])))) return false;
  return true;
}

function canInterpolateNetwork(from, to) {
  if (!isValidNetwork(from) || !isValidNetwork(to)
      || from.vertices.length !== to.vertices.length
      || from.edges.length !== to.edges.length
      || from.faces.length !== to.faces.length) return false;

  // Array order is part of the graph's authored traversal order. IDs keep each
  // geometric record paired while incidence and ring order preserve topology.
  if (from.vertices.some((vertex, index) => vertex.id !== to.vertices[index].id)) return false;
  if (from.edges.some((edge, index) => {
    const target = to.edges[index];
    return edge.id !== target.id || edge.from !== target.from || edge.to !== target.to;
  })) return false;
  return from.faces.every((face, index) => {
    const target = to.faces[index];
    return face.id === target.id && face.vertexIds.length === target.vertexIds.length
      && face.vertexIds.every((vertexId, vertexIndex) => vertexId === target.vertexIds[vertexIndex]);
  });
}

function interpolateNetworkPoint(from, to, progress) {
  return {
    x: interpolateFiniteNumber(from.x, to.x, progress),
    y: interpolateFiniteNumber(from.y, to.y, progress)
  };
}

function interpolateFiniteNumber(from, to, progress) {
  const start = Number(from);
  const end = Number(to);
  // The difference can overflow when finite endpoints have opposite signs.
  // A weighted sum is safe in that case; same-sign deltas remain bounded.
  return (start < 0) !== (end < 0)
    ? start * (1 - progress) + end * progress
    : start + (end - start) * progress;
}

function interpolateNetwork(from, to, progress) {
  if (progress === 0) return structuredClone(from);
  if (progress === 1) return structuredClone(to);

  const copy = structuredClone(to);
  copy.vertices = to.vertices.map((target, index) => {
    const source = from.vertices[index];
    const vertex = structuredClone(progress < 0.5 ? source : target);
    Object.assign(vertex, interpolateNetworkPoint(source, target, progress));
    return vertex;
  });
  const sourceVertices = new Map(from.vertices.map(vertex => [vertex.id, vertex]));
  const targetVertices = new Map(to.vertices.map(vertex => [vertex.id, vertex]));
  copy.edges = to.edges.map((target, index) => {
    const source = from.edges[index];
    const edge = structuredClone(progress < 0.5 ? source : target);
    const sourceStart = sourceVertices.get(source.from);
    const sourceEnd = sourceVertices.get(source.to);
    const targetStart = targetVertices.get(target.from);
    const targetEnd = targetVertices.get(target.to);
    for (const [property, endpoint] of [['control1', 'from'], ['control2', 'to']]) {
      const sourceControl = source[property] ?? (endpoint === 'from' ? sourceStart : sourceEnd);
      const targetControl = target[property] ?? (endpoint === 'from' ? targetStart : targetEnd);
      if (source[property] == null && target[property] == null) {
        // Keep ordinary line edges ordinary; they follow their endpoints.
        if (Object.prototype.hasOwnProperty.call(edge, property)) edge[property] = null;
        continue;
      }
      edge[property] = interpolateNetworkPoint(sourceControl, targetControl, progress);
    }
    return edge;
  });
  copy.faces = to.faces.map((target, index) => {
    const source = from.faces[index];
    // Paint references and other categorical face settings switch together,
    // while direct color and opacity edits remain continuous.
    const face = structuredClone(progress < 0.5 ? source : target);
    if (!source.fillVariableId && !target.fillVariableId) {
      const fill = interpolateColor(source.fill, target.fill, progress);
      if (fill) face.fill = fill;
    }
    const sourceOpacity = finiteStyleNumber(source.fillOpacity);
    const targetOpacity = finiteStyleNumber(target.fillOpacity);
    if (sourceOpacity !== null && targetOpacity !== null) {
      face.fillOpacity = interpolateFiniteNumber(sourceOpacity, targetOpacity, progress);
    }
    return face;
  });
  return copy;
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
  const contours = node => [{ points: node.points, closed: node.closed ?? false }, ...(node.subpaths || [])];
  const fromContours = contours(from);
  const toContours = contours(to);
  if (fromContours.length !== toContours.length) return false;
  for (let contourIndex = 0; contourIndex < fromContours.length; contourIndex += 1) {
    const fromContour = fromContours[contourIndex];
    const toContour = toContours[contourIndex];
    if (typeof fromContour.closed !== 'boolean' || typeof toContour.closed !== 'boolean' || fromContour.closed !== toContour.closed
      || !Array.isArray(fromContour.points) || !Array.isArray(toContour.points) || fromContour.points.length !== toContour.points.length) return false;
    for (let index = 0; index < fromContour.points.length; index += 1) {
      if (!isValidPathPoint(fromContour.points[index]) || !isValidPathPoint(toContour.points[index])) return false;
    }
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

function interpolateCornerRadii(copy, from, to, progress, resolveRadius = null) {
  if (progress === 0 || progress === 1) {
    // Keep authored endpoint structure exact, including whether the layer uses
    // one linked radius or four independent values.
    snapProperty(copy, from, to, 'cornerRadii', progress);
    return;
  }
  if (from.cornerRadii == null && to.cornerRadii == null) return;

  // A linked radius represents the same value at all four corners. Expanding
  // it for the transition lets a layer smoothly enter or leave independent
  // corner mode without changing either authored endpoint.
  const radiusFor = node => finiteStyleNumber(resolveRadius?.(node)) ?? finiteStyleNumber(node.radius) ?? 0;
  const fromRadii = cornerRadiiForNode(from, radiusFor(from));
  const toRadii = cornerRadiiForNode(to, radiusFor(to));
  copy.cornerRadii = Object.fromEntries(cornerRadiusKeys.map(key => [
    key,
    fromRadii[key] + (toRadii[key] - fromRadii[key]) * progress
  ]));
}

function fadeLayer(node, progress, entering) {
  const copy = structuredClone(node);
  if (copy.visible !== false) {
    copy.visible = true;
    copy.opacity = layerOpacity(node) * (entering ? progress : 1 - progress);
  }
  return copy;
}

function interpolateLayer(from, to, progress, resolveRadius = null) {
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
  interpolateCornerRadii(copy, from, to, progress, resolveRadius);
  for (const property of colorProperties) {
    const variable = property === 'fill' ? 'fillVariableId' : property === 'stroke' ? 'strokeVariableId' : 'textVariableId';
    if (from[variable] || to[variable]) continue;
    const color = interpolateColor(from[property], to[property], progress);
    if (color) copy[property] = color;
  }
  if (!from.fillVariableId && !to.fillVariableId && canInterpolateGradient(from.fillGradient, to.fillGradient)) {
    copy.fillGradient = interpolateGradient(from.fillGradient, to.fillGradient, progress);
  }
  const fills = interpolateFillStack(from, to, progress);
  if (fills) copy.fills = fills;
  if (from.visible === false && to.visible !== false) {
    copy.visible = true;
    copy.opacity = layerOpacity(to) * progress;
  } else if (from.visible !== false && to.visible === false) {
    copy.visible = true;
    copy.opacity = layerOpacity(from) * (1 - progress);
  } else if (from.visible === false && to.visible === false) copy.visible = false;
  if (from.type === 'text' && to.type === 'text') {
    for (const property of textNodeNumericProperties) {
      const hasStart = Object.prototype.hasOwnProperty.call(from, property);
      const hasEnd = Object.prototype.hasOwnProperty.call(to, property);
      const start = hasStart && from[property] != null ? finiteStyleNumber(from[property]) : 0;
      const end = hasEnd && to[property] != null ? finiteStyleNumber(to[property]) : 0;
      if ((hasStart && start === null) || (hasEnd && end === null)) continue;
      if (progress === 0) {
        if (hasStart) copy[property] = structuredClone(from[property]);
        else delete copy[property];
      } else if (progress === 1) {
        if (hasEnd) copy[property] = structuredClone(to[property]);
        else delete copy[property];
      } else copy[property] = start + (end - start) * progress;
    }
    const textRuns = interpolateTextRuns(from.textRuns, to.textRuns, progress);
    if (textRuns) copy.textRuns = textRuns;
    else snapProperty(copy, from, to, 'textRuns', progress);
  }
  if (from.type === 'path' && to.type === 'path') {
    copy.points = interpolatePathPoints(from.points, to.points, progress);
    const fromSubpaths = from.subpaths || [];
    const toSubpaths = to.subpaths || [];
    if (toSubpaths.length) {
      copy.subpaths = toSubpaths.map((subpath, index) => ({
        ...structuredClone(subpath),
        points: interpolatePathPoints(fromSubpaths[index].points, subpath.points, progress)
      }));
    } else delete copy.subpaths;
  }
  if (from.type === 'network' && to.type === 'network') {
    const network = interpolateNetwork(from, to, progress);
    copy.vertices = network.vertices;
    copy.edges = network.edges;
    copy.faces = network.faces;
  }
  copy.children = blendChildren(from.children || [], to.children || [], progress, resolveRadius);
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

function blendChildren(fromChildren, toChildren, progress, resolveRadius = null) {
  const fromKeys = siblingKeys(fromChildren);
  const toKeys = siblingKeys(toChildren);
  const sourceByKey = new Map(fromChildren.map((node, index) => [fromKeys[index], { node, index }]));
  const matchedSourceIndexes = new Set();
  const result = toChildren.map((node, index) => {
    const match = sourceByKey.get(toKeys[index]);
    if (match && canMatch(match.node, node)) {
      matchedSourceIndexes.add(match.index);
      return interpolateLayer(match.node, node, progress, resolveRadius);
    }
    return fadeLayer(node, progress, true);
  });
  for (let index = 0; index < fromChildren.length; index += 1) {
    if (!matchedSourceIndexes.has(index)) result.push(fadeLayer(fromChildren[index], progress, false));
  }
  return result;
}

export function interpolateSmartFrame(fromFrame, toFrame, progress, options = {}) {
  if (fromFrame?.type !== 'frame' || toFrame?.type !== 'frame') throw new TypeError('Smart animation requires two frames.');
  const amount = Math.max(0, Math.min(1, Number.isFinite(Number(progress)) ? Number(progress) : 0));
  const resolveRadius = typeof options?.resolveRadius === 'function' ? options.resolveRadius : null;
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
  interpolateCornerRadii(frame, fromFrame, toFrame, amount, resolveRadius);
  const fill = interpolateColor(fromFrame.fill, toFrame.fill, amount);
  if (fill && !fromFrame.fillVariableId && !toFrame.fillVariableId) frame.fill = fill;
  if (!fromFrame.fillVariableId && !toFrame.fillVariableId && canInterpolateGradient(fromFrame.fillGradient, toFrame.fillGradient)) {
    frame.fillGradient = interpolateGradient(fromFrame.fillGradient, toFrame.fillGradient, amount);
  }
  const fills = interpolateFillStack(fromFrame, toFrame, amount);
  if (fills) frame.fills = fills;
  frame.children = blendChildren(fromFrame.children || [], toFrame.children || [], amount, resolveRadius);
  return frame;
}
