import { gradientTypes, isValidGradientFill } from './fills.js';
import { isValidLayerEffects } from './layer-effects.js';
import { cornerRadiiForNode, cornerRadiusKeys } from './corner-radii.js';
import { isValidStrokeStack } from './strokes.js';
import { isValidImageTransforms, normalizeImageTransforms } from './image-transforms.js';
import { defaultImageAdjustments, isValidImageFill } from './image-fills.js';

const numericProperties = ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fillOpacity', 'strokeWidth', 'strokeOpacity', 'strokeMiterLimit', 'radius', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];
const colorProperties = ['fill', 'stroke', 'color'];
const textNodeNumericProperties = ['paragraphSpacing', 'firstLineIndent', 'listSpacing'];
const textRunNumericProperties = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'baselineShift'];
const textRunInheritanceDefaults = { fontSize: 24, fontWeight: 400, lineHeight: 1.25, letterSpacing: 0, baselineShift: 0 };
const textVariableBindingProperties = ['text', 'fontSize', 'lineHeight', 'letterSpacing'];
const midpointProperties = [
  ...colorProperties, 'fills', 'strokes',
  'fillStyleId', 'fillGradient', 'imageFill', 'transforms', 'fit', 'fillVariableId', 'strokeVariableId', 'textVariableId',
  'affineTransform',
  'blendMode', 'effects', 'text', 'fontFamily', 'fontStyle', 'lineHeightUnit', 'textCase', 'textDecoration', 'paragraphStyles', 'align', 'verticalAlign', 'textFit', 'textStyleId',
  'strokePattern', 'strokeCap', 'strokeJoin', 'fillRule'
];

const AFFINE_DETERMINANT_EPSILON = 1e-12;

function validAffineTransform(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['a', 'b', 'c', 'd'].every(key => Number.isFinite(value[key]))) return false;
  const determinant = value.a * value.d - value.b * value.c;
  return Number.isFinite(determinant) && Math.abs(determinant) > AFFINE_DETERMINANT_EPSILON;
}

function positivePolarParts(matrix, reflected) {
  // A fixed reflection on the right turns a negative-determinant matrix into
  // a positive-determinant one. The remaining polar factors are a rotation
  // and a symmetric positive-definite stretch matrix.
  const positive = reflected
    ? { a: -matrix.a, b: -matrix.b, c: matrix.c, d: matrix.d }
    : matrix;
  const angle = Math.atan2(positive.b - positive.c, positive.a + positive.d);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const s00 = cosine * positive.a + sine * positive.b;
  const s01a = cosine * positive.c + sine * positive.d;
  const s10 = -sine * positive.a + cosine * positive.b;
  const s11 = -sine * positive.c + cosine * positive.d;
  const s01 = (s01a + s10) / 2;
  const stretchDeterminant = s00 * s11 - s01 * s01;
  if (![angle, s00, s01, s11, stretchDeterminant].every(Number.isFinite)
    || s00 <= 0 || s11 <= 0 || stretchDeterminant <= AFFINE_DETERMINANT_EPSILON) return null;
  return { angle, s00, s01, s11 };
}

function shortestRadianDelta(from, to) {
  let delta = to - from;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  else if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

function interpolateAffineTransform(from, to, progress) {
  const source = from || { a: 1, b: 0, c: 0, d: 1 };
  const target = to || { a: 1, b: 0, c: 0, d: 1 };
  if (!validAffineTransform(source) || !validAffineTransform(target)) return null;
  const sourceDeterminant = source.a * source.d - source.b * source.c;
  const targetDeterminant = target.a * target.d - target.b * target.c;
  const reflected = sourceDeterminant < 0;
  // Crossing between a reflected and non-reflected transform necessarily
  // passes through a singular matrix. Keep that categorical change at the
  // midpoint so hit testing and rendering never receive a non-invertible one.
  if (reflected !== (targetDeterminant < 0)) return null;
  const start = positivePolarParts(source, reflected);
  const end = positivePolarParts(target, reflected);
  if (!start || !end) return null;
  const angle = start.angle + shortestRadianDelta(start.angle, end.angle) * progress;
  const s00 = interpolateFiniteNumber(start.s00, end.s00, progress);
  const s01 = interpolateFiniteNumber(start.s01, end.s01, progress);
  const s11 = interpolateFiniteNumber(start.s11, end.s11, progress);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  let result = {
    a: cosine * s00 - sine * s01,
    b: sine * s00 + cosine * s01,
    c: cosine * s01 - sine * s11,
    d: sine * s01 + cosine * s11
  };
  if (reflected) result = { ...result, a: -result.a, b: -result.b };
  return validAffineTransform(result) ? result : null;
}

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
  if (!isValidGradientFill(from) || !isValidGradientFill(to)
      || from.type !== to.type || from.stops.length !== to.stops.length) return false;

  // Geometry is stored in normalized layer coordinates, so matching geometry
  // can be interpolated without needing either node's bounds. A transition
  // between geometry and angle-only legacy gradients needs those bounds to
  // derive equivalent handles; keep that transition on the existing midpoint
  // snapshot path instead of guessing.
  const fromHasGeometry = from.geometry != null;
  const toHasGeometry = to.geometry != null;
  if (fromHasGeometry !== toHasGeometry) return false;
  if (fromHasGeometry && (!isValidGradientGeometry(from.geometry) || !isValidGradientGeometry(to.geometry))) return false;
  return true;
}

function isValidGradientGeometry(geometry) {
  return Boolean(geometry && typeof geometry === 'object' && !Array.isArray(geometry)
    && Array.isArray(geometry.handles) && geometry.handles.length === 3
    && geometry.handles.every(handle => handle && typeof handle === 'object' && !Array.isArray(handle)
      && Number.isFinite(handle.x) && Number.isFinite(handle.y)));
}

// Canvas and SVG gradient transforms become unstable well before their affine
// basis reaches an exactly zero determinant. Compare the basis area against
// the square of its longest axis so this remains scale-independent and also
// catches one axis collapsing while the other stays finite.
function hasStableGradientBasis(geometry) {
  if (!isValidGradientGeometry(geometry)) return false;
  const [origin, xAxis, yAxis] = geometry.handles;
  const ux = xAxis.x - origin.x;
  const uy = xAxis.y - origin.y;
  const vx = yAxis.x - origin.x;
  const vy = yAxis.y - origin.y;
  const xLengthSquared = ux * ux + uy * uy;
  const yLengthSquared = vx * vx + vy * vy;
  const scaleSquared = Math.max(xLengthSquared, yLengthSquared);
  const area = ux * vy - uy * vx;
  return Number.isFinite(scaleSquared) && Number.isFinite(area)
    && scaleSquared > 0 && Math.abs(area) > scaleSquared * 1e-8;
}

function interpolateGradient(from, to, progress) {
  if (progress === 0) return structuredClone(from);
  if (progress === 1) return structuredClone(to);
  const angle = interpolateRotation(from.angle, to.angle, progress);
  const result = {
    ...structuredClone(to),
    angle: ((angle % 360) + 360) % 360,
    ...(from.geometry != null ? {
      geometry: {
        ...structuredClone(to.geometry),
        handles: to.geometry.handles.map((handle, index) => ({
          ...structuredClone(handle),
          x: from.geometry.handles[index].x + (handle.x - from.geometry.handles[index].x) * progress,
          y: from.geometry.handles[index].y + (handle.y - from.geometry.handles[index].y) * progress
        }))
      }
    } : {}),
    stops: to.stops.map((stop, index) => {
      const start = from.stops[index];
      return {
        ...structuredClone(stop),
        position: start.position + (stop.position - start.position) * progress,
        color: interpolateColor(start.color, stop.color, progress) || stop.color
      };
    })
  };
  if (result.geometry && !hasStableGradientBasis(result.geometry)) {
    // Keep all other animated gradient properties continuous, but never feed
    // an almost-singular matrix to a renderer. Geometry changes are discrete
    // only inside the narrow degenerate interval, with the same midpoint rule
    // used for incompatible paint snapshots elsewhere in Smart Animate.
    result.geometry = structuredClone(progress < 0.5 ? from.geometry : to.geometry);
  }
  return result;
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
      return Boolean(fill && destination && fill.visible === destination.visible
        && fillBindingKey(fromNode, fill) === fillBindingKey(toNode, destination)
        && isRenderableFill(fill) && isRenderableFill(destination));
    });
}

function isRenderableFill(fill) {
  if (fill?.type === 'solid') return typeof fill.color === 'string';
  if (gradientTypes.has(fill?.type)) return isValidGradientFill(fill.gradient);
  return fill?.type === 'image' && isValidImageFill(fill.imageFill);
}

function hasFillBinding(node, fill) {
  return Boolean(node.fillVariableId || node.fillStyleId || node.variableBindings?.fill
    || fill.variableId || fill.fillVariableId || fill.styleId || fill.fillStyleId || fill.variableBindings);
}

function imageAdjustmentsAreDefault(adjustments = {}) {
  return Boolean(adjustments && typeof adjustments === 'object' && !Array.isArray(adjustments)
    && Object.keys(adjustments).every(property => Object.hasOwn(defaultImageAdjustments, property))
    && Object.entries(defaultImageAdjustments).every(([property, value]) => (adjustments[property] ?? value) === value));
}

function imageFillCanRenderLive(imageFill) {
  if (!imageFill || !isValidImageFill({ ...imageFill, adjustments: imageFill.adjustments || {} })) return false;
  return imageAdjustmentsAreDefault(imageFill.adjustments);
}

function canCrossfadeFill(fromNode, toNode, from, to) {
  if (!from.visible || !to.visible || hasFillBinding(fromNode, from) || hasFillBinding(toNode, to)) return false;
  if (from.type === 'image' && !imageFillCanRenderLive(from.imageFill)) return false;
  if (to.type === 'image' && !imageFillCanRenderLive(to.imageFill)) return false;
  return true;
}

function fadedFill(fill, index, side, amount) {
  const copy = structuredClone(fill);
  const originalId = typeof fill.id === 'string' ? fill.id : 'paint';
  copy.id = `smart-animate:${index}:${side}:${originalId.slice(-180)}`;
  copy.opacity = (Number.isFinite(fill.opacity) ? fill.opacity : 1) * amount;
  if (copy.type === 'image' && imageFillCanRenderLive(copy.imageFill)) copy.__smartAnimateLiveImageFill = true;
  return copy;
}

function crossfadeFills(from, to, index, progress) {
  return [
    fadedFill(from, index, 'source', 1 - progress),
    fadedFill(to, index, 'target', progress)
  ];
}

function interpolateFillStack(fromNode, toNode, progress) {
  if (progress === 0) return structuredClone(fromNode.fills);
  if (progress === 1) return structuredClone(toNode.fills);
  if (!canInterpolateFillStack(fromNode, toNode)) return null;

  const boundPrimary = Boolean(toNode.fillVariableId || toNode.fillStyleId || toNode.variableBindings?.fill);
  return toNode.fills.flatMap((fill, index) => {
    const start = fromNode.fills[index];
    const categorical = progress < 0.5 ? start : fill;
    const result = structuredClone(categorical);
    if (Number.isFinite(start.opacity) && Number.isFinite(fill.opacity)) {
      result.opacity = start.opacity + (fill.opacity - start.opacity) * progress;
    }
    if (start.type !== fill.type) {
      return canCrossfadeFill(fromNode, toNode, start, fill)
        ? crossfadeFills(start, fill, index, progress) : [result];
    }
    if (fill.type === 'solid') {
      const boundPaint = Boolean(fill.variableId || fill.fillVariableId || fill.styleId || fill.fillStyleId || fill.variableBindings);
      if (!(index === 0 && boundPrimary) && !boundPaint) {
        const color = interpolateColor(start.color, fill.color, progress);
        if (color) result.color = color;
        else return canCrossfadeFill(fromNode, toNode, start, fill)
          ? crossfadeFills(start, fill, index, progress) : [result];
      }
    } else if (gradientTypes.has(fill.type)) {
      const boundPaint = Boolean(fill.variableId || fill.fillVariableId || fill.styleId || fill.fillStyleId || fill.variableBindings);
      if (!boundPaint && canInterpolateGradient(start.gradient, fill.gradient)) result.gradient = interpolateGradient(start.gradient, fill.gradient, progress);
      else if (!boundPaint && canCrossfadeFill(fromNode, toNode, start, fill)) {
        return crossfadeFills(start, fill, index, progress);
      }
    } else if (fill.type === 'image') {
      const imageFill = interpolateImageFill(start.imageFill, fill.imageFill, progress);
      if (imageFill && imageFillCanRenderLive(start.imageFill) && imageFillCanRenderLive(fill.imageFill)) {
        result.imageFill = imageFill;
        result.__smartAnimateLiveImageFill = true;
      }
      else if (canCrossfadeFill(fromNode, toNode, start, fill)) return crossfadeFills(start, fill, index, progress);
    }
    // Same-source crops interpolate above; configurations that need processed
    // previews stay on the existing midpoint snapshot path.
    return [result];
  });
}

const fullImageCrop = Object.freeze({ left: 0, top: 0, right: 1, bottom: 1 });

function interpolateImageCrop(fromCrop, toCrop, progress) {
  if (fromCrop == null && toCrop == null) return null;
  const start = fromCrop || fullImageCrop;
  const end = toCrop || fullImageCrop;
  return {
    left: start.left + (end.left - start.left) * progress,
    top: start.top + (end.top - start.top) * progress,
    right: start.right + (end.right - start.right) * progress,
    bottom: start.bottom + (end.bottom - start.bottom) * progress
  };
}

function interpolateImageTransforms(fromAssetId, fromFit, fromTransforms, toAssetId, toFit, toTransforms, progress) {
  if (fromAssetId !== toAssetId || (fromFit ?? 'cover') !== (toFit ?? 'cover')
    || !isValidImageTransforms(fromTransforms) || !isValidImageTransforms(toTransforms)) return null;
  const from = normalizeImageTransforms(fromTransforms);
  const to = normalizeImageTransforms(toTransforms);
  // Flip state is a discrete orientation topology. A toggle mirrors the image
  // at the midpoint; the crop and rotation follow that same discrete snapshot.
  if (from.flipHorizontal !== to.flipHorizontal || from.flipVertical !== to.flipVertical) return null;

  const categorical = progress < 0.5 ? from : to;
  return {
    ...categorical,
    crop: interpolateImageCrop(from.crop, to.crop, progress),
    // Image transform rotation is deliberately quarter-turn-only in the
    // persisted/rendered representation. The layer's own rotation property
    // is already continuously interpolated by the normal layer path.
    rotation: categorical.rotation
  };
}

function interpolateImageFill(fromImageFill, toImageFill, progress) {
  if (!fromImageFill || !toImageFill) return null;
  const transforms = interpolateImageTransforms(
    fromImageFill.assetId, fromImageFill.fit, fromImageFill.transforms,
    toImageFill.assetId, toImageFill.fit, toImageFill.transforms, progress
  );
  if (!transforms) return null;
  return { ...structuredClone(progress < 0.5 ? fromImageFill : toImageFill), transforms };
}

function canInterpolateStrokeStack(fromNode, toNode) {
  const from = fromNode.strokes;
  const to = toNode.strokes;
  return Array.isArray(from) && Array.isArray(to)
    && from.length === to.length
    && isValidStrokeStack(from) && isValidStrokeStack(to)
    && from.every((stroke, index) => stroke.id === to[index].id
      && interpolateColor(stroke.color, to[index].color, .5) !== null);
}

function interpolateStrokeStack(fromNode, toNode, progress) {
  if (progress === 0) return structuredClone(fromNode.strokes);
  if (progress === 1) return structuredClone(toNode.strokes);
  if (!canInterpolateStrokeStack(fromNode, toNode)) return null;
  return toNode.strokes.map((stroke, index) => {
    const start = fromNode.strokes[index];
    const categorical = progress < .5 ? start : stroke;
    const result = structuredClone(categorical);
    result.color = interpolateColor(start.color, stroke.color, progress) || result.color;
    for (const property of ['width', 'opacity', 'miterLimit']) {
      result[property] = start[property] + (stroke[property] - start[property]) * progress;
    }
    return result;
  });
}

function canInterpolateEffectPair(from, to) {
  if (from.type !== to.type || from.visible !== to.visible) return false;
  if (from.type === 'noise' || from.type === 'texture' || from.type === 'glass') return true;
  // Shadow colors are only interpolated as six-digit hex values. Keep the
  // stack on its existing midpoint fallback if either endpoint cannot be
  // represented by that color interpolation path.
  return from.type === 'layer-blur' || from.type === 'background-blur'
    || interpolateColor(from.color, to.color, 0.5) !== null;
}

function interpolateEffectPair(from, to, progress) {
  const categoricalSource = progress < 0.5 ? from : to;
  const result = structuredClone(categoricalSource);
  if (to.type === 'drop-shadow' || to.type === 'inner-shadow') {
    for (const property of ['opacity', 'offsetX', 'offsetY', 'blur']) {
      result[property] = from[property] + (to[property] - from[property]) * progress;
    }
    result.color = interpolateColor(from.color, to.color, progress) || result.color;
  } else if (to.type === 'layer-blur' || to.type === 'background-blur') {
    result.radius = from.radius + (to.radius - from.radius) * progress;
  } else if (to.type === 'noise') {
    for (const property of ['sizeX', 'sizeY', 'density', 'opacity']) {
      result[property] = from[property] + (to[property] - from[property]) * progress;
    }
    result.color = interpolateColor(from.color, to.color, progress) || result.color;
    result.color2 = interpolateColor(from.color2, to.color2, progress) || result.color2;
  } else if (to.type === 'texture') {
    for (const property of ['sizeX', 'sizeY', 'radius']) {
      result[property] = from[property] + (to[property] - from[property]) * progress;
    }
  } else if (to.type === 'glass') {
    const angle = interpolateRotation(from.lightAngle, to.lightAngle, progress);
    result.lightAngle = ((angle % 360) + 360) % 360;
    for (const property of ['lightIntensity', 'refraction', 'depth', 'dispersion', 'frost', 'splay']) {
      result[property] = from[property] + (to[property] - from[property]) * progress;
    }
  }
  return result;
}

function canInterpolateEffects(from, to) {
  return Array.isArray(from) && Array.isArray(to)
    && from.length === to.length
    && isValidLayerEffects(from) && isValidLayerEffects(to)
    && from.every((effect, index) => canInterpolateEffectPair(effect, to[index]));
}

function interpolateEffects(from, to, progress) {
  if (progress === 0) return structuredClone(from);
  if (progress === 1) return structuredClone(to);
  if (!Array.isArray(from) || !Array.isArray(to)
      || !isValidLayerEffects(from) || !isValidLayerEffects(to)) return null;

  if (canInterpolateEffects(from, to)) {
    return to.map((effect, index) => interpolateEffectPair(from[index], effect, progress));
  }

  // A pure trailing insertion/removal has an unambiguous correspondence: all
  // shared effects stay in order and only the tail enters or exits. Animate
  // that tail through its natural zero-contribution value instead of popping
  // the complete stack at the midpoint. Other topology/visibility changes
  // keep the established discrete fallback.
  if (from.length === to.length) return null;
  const commonLength = Math.min(from.length, to.length);
  for (let index = 0; index < commonLength; index += 1) {
    if (!canInterpolateEffectPair(from[index], to[index])) return null;
  }

  const targetHasTail = to.length > from.length;
  const longer = targetHasTail ? to : from;
  if (longer.slice(commonLength).some(effect => ['texture', 'glass'].includes(effect.type))) return null;
  const tailProgress = targetHasTail ? progress : 1 - progress;
  const shared = Array.from({ length: commonLength }, (_, index) => {
    const result = interpolateEffectPair(from[index], to[index], progress);
    // Preserve IDs from the longer stack throughout the transition. The
    // shorter endpoint may reuse one of those IDs on a different effect.
    result.id = longer[index].id;
    return result;
  });
  const tail = longer.slice(commonLength).map(effect => {
    const result = structuredClone(effect);
    if (effect.type === 'drop-shadow' || effect.type === 'inner-shadow') {
      result.opacity *= tailProgress;
    } else if (effect.type === 'layer-blur' || effect.type === 'background-blur') {
      result.radius *= tailProgress;
    } else if (effect.type === 'noise') {
      result.opacity *= tailProgress;
    }
    return result;
  });
  return [...shared, ...tail];
}

function canMatch(from, to) {
  if (!from || !to || from.type !== to.type) return false;
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

function indexNetworkRecords(records) {
  return new Map(records.map(record => [record.id, record]));
}

function canInterpolateNetwork(from, to) {
  if (!isValidNetwork(from) || !isValidNetwork(to)
      || from.vertices.length !== to.vertices.length
      || from.edges.length !== to.edges.length
      || from.faces.length !== to.faces.length) return false;

  // Record storage order is not topology. Match stable identities while
  // preserving directed edge endpoints and each face's authored ring order.
  const targetVertices = indexNetworkRecords(to.vertices);
  const targetEdges = indexNetworkRecords(to.edges);
  const targetFaces = indexNetworkRecords(to.faces);
  return from.vertices.every(vertex => targetVertices.has(vertex.id))
    && from.edges.every(edge => {
      const target = targetEdges.get(edge.id);
      return target && edge.from === target.from && edge.to === target.to;
    })
    && from.faces.every(face => {
      const target = targetFaces.get(face.id);
      return target && face.vertexIds.length === target.vertexIds.length
        && face.vertexIds.every((vertexId, index) => vertexId === target.vertexIds[index]);
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
  const sourceVertices = indexNetworkRecords(from.vertices);
  const targetVertices = indexNetworkRecords(to.vertices);
  const sourceEdges = indexNetworkRecords(from.edges);
  const sourceFaces = indexNetworkRecords(from.faces);
  copy.vertices = to.vertices.map(target => {
    const source = sourceVertices.get(target.id);
    const vertex = structuredClone(progress < 0.5 ? source : target);
    Object.assign(vertex, interpolateNetworkPoint(source, target, progress));
    return vertex;
  });
  copy.edges = to.edges.map(target => {
    const source = sourceEdges.get(target.id);
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
  copy.faces = to.faces.map(target => {
    const source = sourceFaces.get(target.id);
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
  if (from.type === 'image' && to.type === 'image') {
    const transforms = interpolateImageTransforms(
      from.assetId, from.fit, from.transforms,
      to.assetId, to.fit, to.transforms, progress
    );
    if (transforms && imageAdjustmentsAreDefault(from.adjustments) && imageAdjustmentsAreDefault(to.adjustments)) {
      copy.transforms = transforms;
      copy.__smartAnimateLiveImageTransforms = true;
    }
  }
  if (from.imageFill && to.imageFill) {
    const imageFill = interpolateImageFill(from.imageFill, to.imageFill, progress);
    if (imageFill && imageFillCanRenderLive(from.imageFill) && imageFillCanRenderLive(to.imageFill)) {
      copy.imageFill = imageFill;
      if (!Array.isArray(copy.fills)) copy.__smartAnimateLiveImageFill = true;
    }
  }
  const effects = interpolateEffects(from.effects, to.effects, progress);
  if (effects) copy.effects = effects;
  for (const property of numericProperties) {
    if (from.type === 'text' && to.type === 'text'
      && ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'].includes(property)
      && (hasTextTypographyBinding(from) || hasTextTypographyBinding(to))) {
      snapProperty(copy, from, to, property, progress);
      continue;
    }
    const start = finiteStyleNumber(from[property]);
    const end = finiteStyleNumber(to[property]);
    if (start === null || end === null) continue;
    copy[property] = property === 'rotation' ? interpolateRotation(from[property], to[property], progress)
      : progress === 0 ? from[property]
      : progress === 1 ? to[property]
        : start + (end - start) * progress;
  }
  if (progress > 0 && progress < 1) {
    const affineTransform = interpolateAffineTransform(from.affineTransform, to.affineTransform, progress);
    // snapProperties already installed the source/target value. A null result
    // intentionally keeps that safe midpoint fallback for malformed or
    // reflection-changing matrices.
    if (affineTransform) copy.affineTransform = affineTransform;
  }
  interpolateCornerRadii(copy, from, to, progress, resolveRadius);
  for (const property of colorProperties) {
    if (property === 'color' && from.type === 'text' && to.type === 'text'
      && (hasTextTypographyBinding(from) || hasTextTypographyBinding(to))) {
      snapProperty(copy, from, to, property, progress);
      continue;
    }
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
  const strokes = interpolateStrokeStack(from, to, progress);
  if (strokes) copy.strokes = strokes;
  if (from.visible === false && to.visible !== false) {
    copy.visible = true;
    copy.opacity = layerOpacity(to) * progress;
  } else if (from.visible !== false && to.visible === false) {
    copy.visible = true;
    copy.opacity = layerOpacity(from) * (1 - progress);
  } else if (from.visible === false && to.visible === false) copy.visible = false;
  if (from.type === 'text' && to.type === 'text') {
    snapTextVariableBindings(copy, from, to, progress);
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
    const textRuns = hasTextTypographyBinding(from) || hasTextTypographyBinding(to)
      ? null
      : interpolateTextRuns(from.textRuns, to.textRuns, progress, from, to);
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

function hasTextTypographyBinding(node) {
  return Boolean(node?.textStyleId || node?.textVariableId
    || textVariableBindingProperties.some(property => node?.variableBindings?.[property]));
}

function snapTextVariableBindings(copy, from, to, progress) {
  const source = progress < 0.5 ? from : to;
  const bindings = { ...(copy.variableBindings || {}) };
  for (const property of textVariableBindingProperties) delete bindings[property];
  for (const property of textVariableBindingProperties) {
    if (source.variableBindings?.[property]) bindings[property] = source.variableBindings[property];
  }
  if (Object.keys(bindings).length) copy.variableBindings = bindings;
  else delete copy.variableBindings;
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

function interpolateTextRuns(fromRuns, toRuns, progress, fromNode, toNode) {
  if (!Array.isArray(fromRuns) || !Array.isArray(toRuns) || fromRuns.length !== toRuns.length
    || typeof fromNode?.text !== 'string' || fromNode.text !== toNode?.text
    || fromRuns.map(run => run?.text).join('') !== fromNode.text
    || toRuns.map(run => run?.text).join('') !== toNode.text
    || fromRuns.some((run, index) => !run || !toRuns[index] || typeof run.text !== 'string' || run.text !== toRuns[index].text)) return null;

  return toRuns.map((toRun, index) => {
    const fromRun = fromRuns[index];
    const run = structuredClone(progress < 0.5 ? fromRun : toRun);
    for (const property of textRunNumericProperties) {
      if (fromRun[property] == null && toRun[property] == null) continue;
      const inherited = textRunInheritanceDefaults[property];
      const start = finiteStyleNumber(fromRun[property] ?? fromNode[property] ?? inherited);
      const end = finiteStyleNumber(toRun[property] ?? toNode[property] ?? inherited);
      if (start === null || end === null) continue;
      run[property] = start + (end - start) * progress;
    }
    if (fromRun.color != null || toRun.color != null) {
      const start = fromRun.color ?? fromNode.color ?? '#1e1e1e';
      const end = toRun.color ?? toNode.color ?? '#1e1e1e';
      const color = interpolateColor(start, end, progress);
      if (color) run.color = color;
    }
    return run;
  });
}

function blendChildren(fromChildren, toChildren, progress, resolveRadius = null) {
  const fromKeys = siblingKeys(fromChildren);
  const toKeys = siblingKeys(toChildren);
  const sourceByKey = new Map(fromChildren.map((node, index) => [fromKeys[index], { node, index }]));
  const matchedSourceIndexes = new Set();
  const destination = toChildren.map((node, index) => {
    const match = sourceByKey.get(toKeys[index]);
    if (match && canMatch(match.node, node)) {
      matchedSourceIndexes.add(match.index);
      return { node: interpolateLayer(match.node, node, progress, resolveRadius), sourceIndex: match.index };
    }
    return { node: fadeLayer(node, progress, true), sourceIndex: null };
  });
  const nextMatched = new Array(fromChildren.length);
  const previousMatched = new Array(fromChildren.length);
  let nearest = -1;
  for (let index = fromChildren.length - 1; index >= 0; index -= 1) {
    nextMatched[index] = nearest;
    if (matchedSourceIndexes.has(index)) nearest = index;
  }
  nearest = -1;
  for (let index = 0; index < fromChildren.length; index += 1) {
    previousMatched[index] = nearest;
    if (matchedSourceIndexes.has(index)) nearest = index;
  }
  const beforeMatched = new Map();
  const afterMatched = new Map();
  const unanchored = [];
  for (let index = 0; index < fromChildren.length; index += 1) {
    if (matchedSourceIndexes.has(index)) continue;

    // Exiting layers should keep their source stack position relative to the
    // nearest surviving sibling. Destination order remains authoritative for
    // matched and entering layers, so prefer the next surviving source sibling
    // as the insertion point; trailing exits follow their previous survivor.
    const exiting = { node: fadeLayer(fromChildren[index], progress, false), sourceIndex: index };
    const nextMatch = nextMatched[index];
    if (nextMatch >= 0) {
      if (!beforeMatched.has(nextMatch)) beforeMatched.set(nextMatch, []);
      beforeMatched.get(nextMatch).push(exiting);
      continue;
    }

    const previousMatch = previousMatched[index];
    if (previousMatch >= 0) {
      if (!afterMatched.has(previousMatch)) afterMatched.set(previousMatch, []);
      afterMatched.get(previousMatch).push(exiting);
      continue;
    }

    unanchored.push(exiting);
  }

  const result = [];
  for (const entry of destination) {
    if (entry.sourceIndex !== null) {
      for (const exiting of beforeMatched.get(entry.sourceIndex) || []) result.push(exiting);
    }
    result.push(entry);
    if (entry.sourceIndex !== null) {
      for (const exiting of afterMatched.get(entry.sourceIndex) || []) result.push(exiting);
    }
  }

  if (unanchored.length) {
    // With no matched sibling there is no semantic anchor. Retain each source
    // ordinal as the best available stack-position hint while the two stacks
    // crossfade independently. The ordered slot pass avoids repeated splices
    // when an entire layer stack is replaced.
    const outgoingAt = new Map();
    let finalLength = result.length;
    for (const entry of unanchored) {
      const slot = Math.min(entry.sourceIndex, finalLength);
      outgoingAt.set(slot, entry);
      finalLength += 1;
    }
    const ordered = [];
    let destinationIndex = 0;
    for (let slot = 0; slot < finalLength; slot += 1) {
      const outgoing = outgoingAt.get(slot);
      ordered.push(outgoing || result[destinationIndex++]);
    }
    return ordered.map(entry => entry.node);
  }

  return result.map(entry => entry.node);
}

export function interpolateSmartFrame(fromFrame, toFrame, progress, options = {}) {
  if (fromFrame?.type !== 'frame' || toFrame?.type !== 'frame') throw new TypeError('Smart animation requires two frames.');
  const amount = Math.max(0, Math.min(1, Number.isFinite(Number(progress)) ? Number(progress) : 0));
  // Return the authored snapshots at the endpoints. Building the transition
  // tree from the destination and snapping only known fields can otherwise
  // leak destination-only metadata into the source frame, and zero-opacity
  // entering layers can still affect masks or hit testing in some renderers.
  if (amount === 0) return structuredClone(fromFrame);
  if (amount === 1) return structuredClone(toFrame);
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
  const strokes = interpolateStrokeStack(fromFrame, toFrame, amount);
  if (strokes) frame.strokes = strokes;
  frame.children = blendChildren(fromFrame.children || [], toFrame.children || [], amount, resolveRadius);
  return frame;
}
