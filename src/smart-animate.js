import { gradientTypes, isValidGradientFill } from './fills.js';
import { isValidLayerEffects } from './layer-effects.js';
import { cornerRadiiForNode, cornerRadiusKeys } from './corner-radii.js';
import { isValidStrokeStack, strokeSideNames, strokeSideWidths } from './strokes.js';
import { isValidImageTransforms, normalizeImageTransforms } from './image-transforms.js';
import { defaultImageAdjustments, isValidImageFill } from './image-fills.js';
import { invertAffine, multiplyAffine, nodeToParentTransform } from './transform-geometry.js';

const numericProperties = ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fillOpacity', 'strokeWidth', 'strokeOpacity', 'strokeMiterLimit', 'radius', 'cornerSmoothing', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];
const colorProperties = ['fill', 'stroke', 'color'];
const textNodeNumericProperties = ['paragraphSpacing', 'firstLineIndent', 'listSpacing'];
const textRunNumericProperties = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'baselineShift'];
const textRunInheritanceDefaults = { fontSize: 24, fontWeight: 400, lineHeight: 1.25, letterSpacing: 0, baselineShift: 0 };
const textVariableBindingProperties = ['text', 'fontSize', 'lineHeight', 'letterSpacing'];
const midpointProperties = [
  ...colorProperties, 'fills', 'strokes',
  'fillStyleId', 'fillGradient', 'imageFill', 'transforms', 'fit', 'fillVariableId', 'strokeVariableId', 'textVariableId',
  'affineTransform', 'points', 'innerRadius', 'vertexRadii', 'arcData',
  'blendMode', 'effects', 'text', 'fontFamily', 'fontStyle', 'lineHeightUnit', 'textCase', 'textDecoration', 'paragraphStyles', 'align', 'verticalAlign', 'textFit', 'textStyleId',
  'strokePattern', 'strokeDashArray', 'strokeCap', 'strokeJoin', 'strokeAlignment', 'fillRule', 'clip', 'mask', 'maskMode', 'maskSourceId',
  'overflowBehavior', 'fixedPositionWhenScrolling', 'scrollPosition'
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
        ...((start.opacity != null || stop.opacity != null) ? {
          opacity: (start.opacity ?? 1) + ((stop.opacity ?? 1) - (start.opacity ?? 1)) * progress
        } : {}),
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

function interpolateFillStack(fromNode, toNode, progress, resolveImageTransition = null) {
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
      else {
        const transition = resolveImageTransition?.({
          kind: 'image-fill', fromNode, toNode, fromFill: start, toFill: fill, progress
        });
        if (transition) {
          result.__smartAnimateImageTransition = { ...structuredClone(transition), progress };
          return [result];
        }
        if (canCrossfadeFill(fromNode, toNode, start, fill)) return crossfadeFills(start, fill, index, progress);
      }
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
    && isValidStrokeStack(from, fromNode) && isValidStrokeStack(to, toNode)
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
    if (start.pattern === 'custom' && stroke.pattern === 'custom'
      && Array.isArray(start.dashArray) && Array.isArray(stroke.dashArray)
      && start.dashArray.length === stroke.dashArray.length) {
      result.dashArray = start.dashArray.map((value, dashIndex) => value + (stroke.dashArray[dashIndex] - value) * progress);
    }
    if (['rectangle', 'frame'].includes(fromNode.type) && fromNode.type === toNode.type
      && (Object.hasOwn(start, 'sideMode') || Object.hasOwn(start, 'sideWidths')
        || Object.hasOwn(stroke, 'sideMode') || Object.hasOwn(stroke, 'sideWidths'))) {
      const startWidths = strokeSideWidths(start);
      const endWidths = strokeSideWidths(stroke);
      result.sideMode = 'custom';
      result.sideWidths = Object.fromEntries(strokeSideNames.map(side => [
        side, startWidths[side] + (endWidths[side] - startWidths[side]) * progress
      ]));
    }
    return result;
  });
}

function canInterpolateEffectPair(from, to) {
  if (from.type !== to.type || from.visible !== to.visible) return false;
  if (from.type === 'noise' || from.type === 'texture' || from.type === 'glass') return true;
  if (['layer-blur', 'background-blur'].includes(from.type)
    && (from.blurType || 'NORMAL') !== (to.blurType || 'NORMAL')) return false;
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
    for (const property of ['opacity', 'offsetX', 'offsetY', 'blur', 'spread']) {
      const start = from[property] ?? 0;
      const end = to[property] ?? 0;
      result[property] = start + (end - start) * progress;
    }
    result.color = interpolateColor(from.color, to.color, progress) || result.color;
  } else if (to.type === 'layer-blur' || to.type === 'background-blur') {
    result.radius = from.radius + (to.radius - from.radius) * progress;
    if ((from.blurType || 'NORMAL') === 'PROGRESSIVE') {
      result.startRadius = from.startRadius + (to.startRadius - from.startRadius) * progress;
      for (const point of ['startOffset', 'endOffset']) {
        result[point] = {
          x: from[point].x + (to[point].x - from[point].x) * progress,
          y: from[point].y + (to[point].y - from[point].y) * progress
        };
      }
    }
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
      if (effect.blurType === 'PROGRESSIVE') result.startRadius *= tailProgress;
    } else if (effect.type === 'noise') {
      result.opacity *= tailProgress;
    }
    return result;
  });
  return [...shared, ...tail];
}

function hasUnsupportedSmartAnimateEffect(node) {
  return Array.isArray(node?.effects) && node.effects.some(effect => effect?.visible !== false
    && ['drop-shadow', 'inner-shadow'].includes(effect?.type));
}

function canMatch(from, to) {
  if (!from || !to || from.type !== to.type) return false;
  // Figma's public Smart Animate guide lists drop and inner shadows as
  // unsupported. Treat a layer with either visible effect at either endpoint
  // as unmatched and let the existing endpoint fade handle it. The guide says
  // unsupported properties trigger a default dissolve, but does not say
  // whether the fallback applies to the whole frame or only the affected
  // layer, so this local fallback is a conservative approximation.
  if (hasUnsupportedSmartAnimateEffect(from) || hasUnsupportedSmartAnimateEffect(to)) return false;
  if (from.type === 'image' && from.assetId !== to.assetId) return false;
  if (from.type === 'boolean' && from.operation !== to.operation) return false;
  if (from.type === 'path' && !canInterpolatePath(from, to)) return false;
  if (from.type === 'network' && !canInterpolateNetwork(from, to)) return false;
  return true;
}

const implicitTextStyleProperties = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontAxes', 'fontFeatures',
  'lineHeight', 'lineHeightUnit', 'letterSpacing', 'paragraphSpacing', 'firstLineIndent',
  'listSpacing', 'color', 'align', 'verticalAlign', 'textCase', 'textDecoration', 'textWrapStyle'
];
const implicitTextStyleDefaults = {
  fontFamily: 'Inter, Arial, sans-serif', fontSize: 24, fontWeight: 400, fontStyle: 'normal',
  lineHeight: 1.25, lineHeightUnit: 'ratio', letterSpacing: 0, paragraphSpacing: 0,
  firstLineIndent: 0, listSpacing: 0, color: '#1e1e1e', align: 'left', verticalAlign: 'top',
  textCase: 'none', textDecoration: 'none'
};
const implicitTextRunStyleProperties = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontAxes', 'fontFeatures',
  'lineHeight', 'lineHeightUnit', 'letterSpacing', 'baselineShift', 'color', 'textCase', 'textDecoration'
];

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function implicitTextStyleSignature(node) {
  // The text-name exception is only safe for a single, unambiguous text style.
  // Paragraph overrides and text-on-path geometry depend on source text ranges
  // or linked nodes, so leave those to ordinary name-based matching.
  if (node.paragraphStyles != null || node.textPath != null
    || (node.textRuns != null && (!Array.isArray(node.textRuns)
      || node.textRuns.some(run => !run || typeof run !== 'object' || Array.isArray(run))))) return null;
  const baseStyle = Object.fromEntries(implicitTextStyleProperties.map(property => [
    property, node[property] ?? implicitTextStyleDefaults[property] ?? null
  ]));
  const runs = node.textRuns == null ? null : node.textRuns.map(run => Object.fromEntries(
    implicitTextRunStyleProperties.map(property => [
      property, run[property] ?? node[property] ?? implicitTextStyleDefaults[property] ?? textRunInheritanceDefaults[property] ?? null
    ])
  ));
  const typographyBindings = Object.fromEntries(textVariableBindingProperties
    .filter(property => node.variableBindings?.[property])
    .map(property => [property, node.variableBindings[property]]));
  return stableSerialize({
    textStyleId: node.textStyleId ?? node.typographyStyleId ?? null,
    textVariableId: node.textVariableId ?? null,
    typographyBindings,
    baseStyle,
    runs
  });
}

function canImplicitlyMatchText(from, to) {
  if (from?.type !== 'text' || to?.type !== 'text'
    || typeof from.text !== 'string' || typeof to.text !== 'string'
    || from.text === to.text
    || from.name !== from.text || to.name !== to.text
    || !canMatch(from, to)) return false;
  const sourceStyle = implicitTextStyleSignature(from);
  return sourceStyle !== null && sourceStyle === implicitTextStyleSignature(to);
}

function implicitTextDistance(from, to) {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  return Math.hypot(from.x - to.x, from.y - to.y);
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

function interpolateNetwork(from, to, progress, geometryProgress = progress) {
  if (geometryProgress === 0 && progress === 0) return structuredClone(from);
  if (geometryProgress === 1 && progress === 1) return structuredClone(to);

  const copy = structuredClone(to);
  const sourceVertices = indexNetworkRecords(from.vertices);
  const targetVertices = indexNetworkRecords(to.vertices);
  const sourceEdges = indexNetworkRecords(from.edges);
  const sourceFaces = indexNetworkRecords(from.faces);
  copy.vertices = to.vertices.map(target => {
    const source = sourceVertices.get(target.id);
    const vertex = structuredClone(progress < 0.5 ? source : target);
    Object.assign(vertex, interpolateNetworkPoint(source, target, geometryProgress));
    const sourceRadius = finiteStyleNumber(source.cornerRadius) ?? 0;
    const targetRadius = finiteStyleNumber(target.cornerRadius) ?? 0;
    const radius = interpolateFiniteNumber(sourceRadius, targetRadius, geometryProgress);
    if (radius > 0) vertex.cornerRadius = Math.max(0, Math.min(100_000, radius));
    else delete vertex.cornerRadius;
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
      edge[property] = interpolateNetworkPoint(sourceControl, targetControl, geometryProgress);
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
    point.x = interpolateFiniteNumber(fromPoint.x, toPoint.x, progress);
    point.y = interpolateFiniteNumber(fromPoint.y, toPoint.y, progress);
    for (const part of ['in', 'out']) {
      const fromHandle = fromPoint[part];
      const toHandle = toPoint[part];
      if (fromHandle == null && toHandle == null) continue;
      const start = fromHandle ?? { x: 0, y: 0 };
      const end = toHandle ?? { x: 0, y: 0 };
      point[part] = {
        x: interpolateFiniteNumber(start.x, end.x, progress),
        y: interpolateFiniteNumber(start.y, end.y, progress)
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

function matchSiblingNodes(fromChildren, toChildren) {
  const fromKeys = siblingKeys(fromChildren);
  const toKeys = siblingKeys(toChildren);
  const sourceByKey = new Map(fromChildren.map((node, index) => [fromKeys[index], { node, index }]));
  const matchesBySourceIndex = new Map();
  const matchesByDestinationIndex = new Map();
  const matchedSourceIndexes = new Set();

  for (let destinationIndex = 0; destinationIndex < toChildren.length; destinationIndex += 1) {
    const destination = toChildren[destinationIndex];
    const source = sourceByKey.get(toKeys[destinationIndex]);
    if (!source || !canMatch(source.node, destination)) continue;
    const match = {
      source: source.node,
      destination,
      sourceIndex: source.index,
      destinationIndex
    };
    matchesBySourceIndex.set(source.index, match);
    matchesByDestinationIndex.set(destinationIndex, match);
    matchedSourceIndexes.add(source.index);
  }

  // Figma also recognizes implicitly named text layers when their displayed
  // text changes: if the layer name is the text itself and the text style is
  // unchanged, pair the closest text layers by position. Explicitly renamed
  // layers still require an exact name match, and exact-name duplicate layers
  // above retain their authored sibling-index correspondence.
  const implicitCandidates = [];
  for (let destinationIndex = 0; destinationIndex < toChildren.length; destinationIndex += 1) {
    if (matchesByDestinationIndex.has(destinationIndex)) continue;
    const destination = toChildren[destinationIndex];
    for (let sourceIndex = 0; sourceIndex < fromChildren.length; sourceIndex += 1) {
      if (matchedSourceIndexes.has(sourceIndex)) continue;
      const source = fromChildren[sourceIndex];
      if (!canImplicitlyMatchText(source, destination)) continue;
      implicitCandidates.push({
        sourceIndex,
        destinationIndex,
        distance: implicitTextDistance(source, destination)
      });
    }
  }
  implicitCandidates.sort((left, right) => {
    if (left.distance !== right.distance) return left.distance < right.distance ? -1 : 1;
    return left.sourceIndex - right.sourceIndex || left.destinationIndex - right.destinationIndex;
  });
  for (const candidate of implicitCandidates) {
    if (matchedSourceIndexes.has(candidate.sourceIndex) || matchesByDestinationIndex.has(candidate.destinationIndex)) continue;
    const match = {
      source: fromChildren[candidate.sourceIndex],
      destination: toChildren[candidate.destinationIndex],
      sourceIndex: candidate.sourceIndex,
      destinationIndex: candidate.destinationIndex
    };
    matchesBySourceIndex.set(match.sourceIndex, match);
    matchesByDestinationIndex.set(match.destinationIndex, match);
    matchedSourceIndexes.add(match.sourceIndex);
  }

  return { matchesBySourceIndex, matchesByDestinationIndex, matchedSourceIndexes };
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
  copy.cornerRadii = Object.fromEntries(cornerRadiusKeys.map(key => {
    const value = interpolateFiniteNumber(fromRadii[key], toRadii[key], progress);
    return [key, Math.max(0, Math.min(100_000, value))];
  }));
}

function interpolateVertexRadii(copy, from, to, progress, resolveRadius = null) {
  if (progress === 0 || progress === 1) {
    snapProperty(copy, from, to, 'vertexRadii', progress);
    return;
  }
  if (!['star', 'polygon'].includes(from.type) || from.type !== to.type
    || (from.points ?? (from.type === 'star' ? 5 : 6)) !== (to.points ?? (to.type === 'star' ? 5 : 6))) return;
  if (from.vertexRadii == null && to.vertexRadii == null) return;
  const radiusFor = node => finiteStyleNumber(resolveRadius?.(node)) ?? finiteStyleNumber(node.radius) ?? 0;
  const count = from.type === 'star' ? 2 * Math.round(from.points ?? 5) : Math.round(from.points ?? 6);
  const fromRadii = Array.isArray(from.vertexRadii) && from.vertexRadii.length === count
    ? from.vertexRadii : Array.from({ length: count }, () => radiusFor(from));
  const toRadii = Array.isArray(to.vertexRadii) && to.vertexRadii.length === count
    ? to.vertexRadii : Array.from({ length: count }, () => radiusFor(to));
  if (![...fromRadii, ...toRadii].every(value => Number.isFinite(value) && value >= 0 && value <= 100_000)) return;
  copy.vertexRadii = fromRadii.map((radius, index) => Math.max(0, Math.min(100_000,
    interpolateFiniteNumber(radius, toRadii[index], progress))));
}

function interpolateEllipseArcData(copy, from, to, progress) {
  if (progress === 0 || progress === 1) {
    snapProperty(copy, from, to, 'arcData', progress);
    return;
  }
  if (from.type !== 'ellipse' || to.type !== 'ellipse' || (from.arcData == null && to.arcData == null)) return;
  const full = { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0 };
  const start = from.arcData || full;
  const end = to.arcData || full;
  copy.arcData = {
    startingAngle: interpolateFiniteNumber(start.startingAngle, end.startingAngle, progress),
    endingAngle: interpolateFiniteNumber(start.endingAngle, end.endingAngle, progress),
    innerRadius: Math.max(0, Math.min(1, interpolateFiniteNumber(start.innerRadius, end.innerRadius, progress)))
  };
}

function fadeLayer(node, progress, entering) {
  const copy = structuredClone(node);
  if (copy.visible !== false) {
    copy.visible = true;
    copy.opacity = layerOpacity(node) * (entering ? progress : 1 - progress);
  }
  return copy;
}

function interpolateLayer(from, to, progress, resolveRadius = null, geometryProgress = progress, resolveImageTransition = null, preserveFixedLayers = false) {
  // Figma keeps fixed-position layers anchored to their source position for
  // the duration of Smart Animate Matching Layers. The destination snapshot
  // takes over only at the exact endpoint, including when the fixed flag
  // changes sides. Standalone Smart Animate keeps its established behavior.
  if (preserveFixedLayers && (from.fixedPositionWhenScrolling === true || to.fixedPositionWhenScrolling === true) && progress < 1) {
    return structuredClone(from);
  }
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
    } else {
      const transition = resolveImageTransition?.({ kind: 'image-layer', fromNode: from, toNode: to, progress });
      if (transition) copy.__smartAnimateImageTransition = { ...structuredClone(transition), progress };
    }
  }
  if (from.imageFill && to.imageFill) {
    const imageFill = interpolateImageFill(from.imageFill, to.imageFill, progress);
    if (imageFill && imageFillCanRenderLive(from.imageFill) && imageFillCanRenderLive(to.imageFill)) {
      copy.imageFill = imageFill;
      if (!Array.isArray(copy.fills)) copy.__smartAnimateLiveImageFill = true;
    } else if (!Array.isArray(copy.fills)) {
      const transition = resolveImageTransition?.({ kind: 'legacy-image-fill', fromNode: from, toNode: to, progress });
      if (transition) copy.__smartAnimateImageFillTransition = { ...structuredClone(transition), progress };
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
    const propertyProgress = ['x', 'y', 'width', 'height', 'rotation'].includes(property) ? geometryProgress : progress;
    const value = property === 'rotation'
      ? interpolateRotation(from[property], to[property], propertyProgress)
      : propertyProgress === 0 ? from[property]
        : propertyProgress === 1 ? to[property]
          : interpolateFiniteNumber(start, end, propertyProgress);
    copy[property] = ['width', 'height'].includes(property) ? Math.max(0, value) : value;
  }
  if (geometryProgress !== 0 && geometryProgress !== 1) {
    const affineTransform = interpolateAffineTransform(from.affineTransform, to.affineTransform, geometryProgress);
    // snapProperties already installed the source/target value. A null result
    // intentionally keeps that safe midpoint fallback for malformed or
    // reflection-changing matrices.
    if (affineTransform) copy.affineTransform = affineTransform;
  }
  interpolateCornerRadii(copy, from, to, geometryProgress, resolveRadius);
  interpolateVertexRadii(copy, from, to, geometryProgress, resolveRadius);
  interpolateEllipseArcData(copy, from, to, progress);
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
  const fills = interpolateFillStack(from, to, progress, resolveImageTransition);
  if (fills) copy.fills = fills;
  const strokes = interpolateStrokeStack(from, to, progress);
  if (strokes) copy.strokes = strokes;
  if ((from.visible !== false) !== (to.visible !== false)) {
    // Visibility is categorical in Figma prototypes; it does not behave like
    // a dissolve. To animate a fade, authors keep the layer visible and change
    // its opacity instead. Switch the visibility snapshot at the midpoint and
    // keep opacity from the same endpoint so a hidden layer never ghost-fades.
    snapProperty(copy, from, to, 'visible', progress);
    snapProperty(copy, from, to, 'opacity', progress);
  }
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
    copy.points = interpolatePathPoints(from.points, to.points, geometryProgress);
    const fromSubpaths = from.subpaths || [];
    const toSubpaths = to.subpaths || [];
    if (toSubpaths.length) {
      copy.subpaths = toSubpaths.map((subpath, index) => ({
        ...structuredClone(subpath),
        points: interpolatePathPoints(fromSubpaths[index].points, subpath.points, geometryProgress)
      }));
    } else delete copy.subpaths;
  }
  if (from.type === 'network' && to.type === 'network') {
    const network = interpolateNetwork(from, to, progress, geometryProgress);
    copy.vertices = network.vertices;
    copy.edges = network.edges;
    copy.faces = network.faces;
  }
  const fromChildren = from.children || [];
  const toChildren = to.children || [];
  const siblingMatches = matchSiblingNodes(fromChildren, toChildren);
  copy.children = blendChildren(fromChildren, toChildren, progress, resolveRadius, geometryProgress, resolveImageTransition, preserveFixedLayers, siblingMatches);
  if (copy.maskSourceId) {
    const endpointChildren = progress < .5 ? fromChildren : toChildren;
    const maskIndex = endpointChildren.findIndex(child => child.id === copy.maskSourceId);
    const match = (progress < .5 ? siblingMatches.matchesBySourceIndex : siblingMatches.matchesByDestinationIndex).get(maskIndex);
    if (match) {
      // Matched children normally use destination IDs; fixed children can keep
      // their source snapshot. Bind the categorical mask to the rendered child.
      const holdsSource = preserveFixedLayers && progress < 1
        && (match.source.fixedPositionWhenScrolling === true || match.destination.fixedPositionWhenScrolling === true);
      copy.maskSourceId = holdsSource ? match.source.id : match.destination.id;
    }
  }
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

function blendChildren(fromChildren, toChildren, progress, resolveRadius = null, geometryProgress = progress, resolveImageTransition = null, preserveFixedLayers = false, siblingMatches = matchSiblingNodes(fromChildren, toChildren)) {

  // Back and spring easings can briefly leave [0, 1]. Keep layer presence and
  // order on the corresponding endpoint while matched geometry anticipates or
  // overshoots; zero-opacity entering layers can still affect masks and picks.
  if (progress === 0 || progress === 1) {
    const endpointChildren = progress === 0 ? fromChildren : toChildren;
    return endpointChildren.map((node, index) => {
      const match = progress === 0
        ? siblingMatches.matchesBySourceIndex.get(index)
        : siblingMatches.matchesByDestinationIndex.get(index);
      return match
        ? interpolateLayer(match.source, match.destination, progress, resolveRadius, geometryProgress, resolveImageTransition, preserveFixedLayers)
        : structuredClone(node);
    });
  }

  const destination = toChildren.map((node, index) => {
    const match = siblingMatches.matchesByDestinationIndex.get(index);
    if (match) {
      return { node: interpolateLayer(match.source, match.destination, progress, resolveRadius, geometryProgress, resolveImageTransition, preserveFixedLayers), sourceIndex: match.sourceIndex };
    }
    return { node: fadeLayer(node, progress, true), sourceIndex: null };
  });
  const nextMatched = new Array(fromChildren.length);
  const previousMatched = new Array(fromChildren.length);
  let nearest = -1;
  for (let index = fromChildren.length - 1; index >= 0; index -= 1) {
    nextMatched[index] = nearest;
    if (siblingMatches.matchedSourceIndexes.has(index)) nearest = index;
  }
  nearest = -1;
  for (let index = 0; index < fromChildren.length; index += 1) {
    previousMatched[index] = nearest;
    if (siblingMatches.matchedSourceIndexes.has(index)) nearest = index;
  }
  const beforeMatched = new Map();
  const afterMatched = new Map();
  const unanchored = [];
  for (let index = 0; index < fromChildren.length; index += 1) {
    if (siblingMatches.matchedSourceIndexes.has(index)) continue;

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

function normalizeSmartProgress(progress, options) {
  const requestedProgress = Number.isFinite(Number(progress)) ? Number(progress) : 0;
  const amount = Math.max(0, Math.min(1, requestedProgress));
  const allowOvershoot = options?.allowOvershoot === true;
  const geometryProgress = allowOvershoot
    ? Math.max(-2, Math.min(2, requestedProgress))
    : amount;
  return { requestedProgress, amount, allowOvershoot, geometryProgress };
}

function clearFramePaint(frame) {
  for (const property of [
    'fill', 'fillOpacity', 'fillStyleId', 'fillGradient', 'fillVariableId', 'fills', 'imageFill', 'fit', 'transforms',
    'stroke', 'strokeOpacity', 'strokeStyleId', 'strokeVariableId', 'strokeWidth', 'strokeMiterLimit',
    'strokePattern', 'strokeDashArray', 'strokeCap', 'strokeJoin', 'strokeAlignment', 'strokes', 'effects'
  ]) delete frame[property];

  if (frame.variableBindings && typeof frame.variableBindings === 'object' && !Array.isArray(frame.variableBindings)) {
    const bindings = { ...frame.variableBindings };
    delete bindings.fill;
    delete bindings.stroke;
    if (Object.keys(bindings).length) frame.variableBindings = bindings;
    else delete frame.variableBindings;
  }
  return frame;
}

function interpolateFrameProperties(fromFrame, toFrame, amount, geometryProgress, resolveRadius, resolveImageTransition, includePaint = true) {
  const frame = structuredClone(toFrame);
  snapProperties(frame, fromFrame, toFrame, amount);
  for (const property of ['width', 'height', 'opacity', 'rotation']) {
    if (Number.isFinite(fromFrame[property]) && Number.isFinite(toFrame[property])) {
      const channelProgress = property === 'opacity' ? amount : geometryProgress;
      const value = property === 'rotation' ? interpolateRotation(fromFrame[property], toFrame[property], channelProgress)
        : channelProgress === 0 ? fromFrame[property]
          : channelProgress === 1 ? toFrame[property]
            : interpolateFiniteNumber(fromFrame[property], toFrame[property], channelProgress);
      frame[property] = property === 'opacity' ? Math.max(0, Math.min(1, value))
        : ['width', 'height'].includes(property) ? Math.max(0, value) : value;
    }
  }
  interpolateCornerRadii(frame, fromFrame, toFrame, geometryProgress, resolveRadius);
  if (!includePaint) return frame;
  const fill = interpolateColor(fromFrame.fill, toFrame.fill, amount);
  if (fill && !fromFrame.fillVariableId && !toFrame.fillVariableId) frame.fill = fill;
  if (!fromFrame.fillVariableId && !toFrame.fillVariableId && canInterpolateGradient(fromFrame.fillGradient, toFrame.fillGradient)) {
    frame.fillGradient = interpolateGradient(fromFrame.fillGradient, toFrame.fillGradient, amount);
  }
  const fills = interpolateFillStack(fromFrame, toFrame, amount, resolveImageTransition);
  if (fills) frame.fills = fills;
  const strokes = interpolateStrokeStack(fromFrame, toFrame, amount);
  if (strokes) frame.strokes = strokes;
  return frame;
}

/**
 * Split a Smart Animate transition into matched child subtrees and unmatched
 * source/destination frames. Matching uses the same sibling name/type ordinal
 * and node compatibility checks as the full-frame interpolator.
 *
 * `matches` are in destination stack order and retain source/destination
 * indexes. The transparent `matchingFrame` contains matched and fixed roots;
 * the other frame shells contain endpoint-only roots. Every returned value is
 * detached from the inputs. `matchingStacking` is the legacy coarse
 * placement hint. `stackingOrder` retains the per-root order used by Smart
 * Animate, including destination roots and outgoing roots anchored to source
 * siblings, for renderers that need to interleave the layers.
 */
export function splitSmartFrameMatches(fromFrame, toFrame, progress, options = {}) {
  if (fromFrame?.type !== 'frame' || toFrame?.type !== 'frame') throw new TypeError('Smart animation requires two frames.');
  const { requestedProgress, amount, allowOvershoot, geometryProgress } = normalizeSmartProgress(progress, options);
  const fromChildren = Array.isArray(fromFrame.children) ? fromFrame.children : [];
  const toChildren = Array.isArray(toFrame.children) ? toFrame.children : [];
  const siblingMatches = matchSiblingNodes(fromChildren, toChildren);
  const resolveRadius = typeof options?.resolveRadius === 'function' ? options.resolveRadius : null;
  const resolveImageTransition = typeof options?.resolveImageTransition === 'function' ? options.resolveImageTransition : null;
  const sourceEndpoint = allowOvershoot ? requestedProgress === 0 : amount === 0;
  const destinationEndpoint = allowOvershoot ? requestedProgress === 1 : amount === 1;
  const matches = [...siblingMatches.matchesByDestinationIndex.values()].map(match => {
    const node = sourceEndpoint ? structuredClone(match.source)
      : destinationEndpoint ? structuredClone(match.destination)
        : interpolateLayer(match.source, match.destination, amount, resolveRadius, geometryProgress, resolveImageTransition, true);
    return {
      sourceIndex: match.sourceIndex,
      destinationIndex: match.destinationIndex,
      node
    };
  });
  const matchedSourceIndexes = siblingMatches.matchedSourceIndexes;
  const matchedDestinationIndexes = new Set(siblingMatches.matchesByDestinationIndex.keys());
  const fixedSourceIndexes = new Set(fromChildren.map((node, index) => index)
    .filter(index => !matchedSourceIndexes.has(index) && fromChildren[index].fixedPositionWhenScrolling === true));
  const fixedDestinationIndexes = new Set(toChildren.map((node, index) => index)
    .filter(index => !matchedDestinationIndexes.has(index) && toChildren[index].fixedPositionWhenScrolling === true));
  const destinationOverlayIndexes = new Set([...matchedDestinationIndexes, ...fixedDestinationIndexes]);
  let firstOverlayIndex = -1;
  for (const index of destinationOverlayIndexes) {
    if (firstOverlayIndex < 0 || index < firstOverlayIndex) firstOverlayIndex = index;
  }
  const matchingStacking = firstOverlayIndex >= 0
    && toChildren.some((_, index) => index > firstOverlayIndex && !destinationOverlayIndexes.has(index))
    ? 'below-destination'
    : 'above-destination';
  const sourceOnlyRoots = fromChildren
    .map((node, sourceIndex) => ({ sourceIndex, node }))
    .filter(({ sourceIndex }) => !matchedSourceIndexes.has(sourceIndex) && !fixedSourceIndexes.has(sourceIndex))
    .map(({ sourceIndex, node }) => ({ sourceIndex, node: structuredClone(node) }));
  const fixedSourceRoots = [...fixedSourceIndexes]
    .map(sourceIndex => ({ sourceIndex, node: structuredClone(fromChildren[sourceIndex]) }));
  const sourceFrame = clearFramePaint(structuredClone(fromFrame));
  const destinationFrame = clearFramePaint(structuredClone(toFrame));
  if (Array.isArray(sourceFrame.children)) {
    sourceFrame.children = sourceFrame.children.filter((_, index) => !matchedSourceIndexes.has(index) && !fixedSourceIndexes.has(index));
  }
  if (Array.isArray(destinationFrame.children)) {
    destinationFrame.children = destinationFrame.children.filter((_, index) => !matchedDestinationIndexes.has(index) && !fixedDestinationIndexes.has(index));
  }
  const matchingFrame = clearFramePaint(sourceEndpoint ? structuredClone(fromFrame)
    : destinationEndpoint ? structuredClone(toFrame)
      : interpolateFrameProperties(fromFrame, toFrame, amount, geometryProgress, resolveRadius, resolveImageTransition, false));
  const fixedSourceIds = new Set([...fixedSourceIndexes].map(index => fromChildren[index].id));
  const fixedDestinationIds = new Set([...fixedDestinationIndexes].map(index => toChildren[index].id));
  const matchedLayerIds = new Set([...siblingMatches.matchesByDestinationIndex.values()]
    .flatMap(match => [match.source.id, match.destination.id]));
  const animatedChildren = blendChildren(fromChildren, toChildren, amount, resolveRadius, geometryProgress, resolveImageTransition, true);
  const sourceIndexById = new Map(fromChildren.map((node, index) => [node.id, index]));
  const destinationIndexById = new Map(toChildren.map((node, index) => [node.id, index]));
  const matchedIndexesById = new Map();
  for (const match of siblingMatches.matchesByDestinationIndex.values()) {
    const indexes = { sourceIndex: match.sourceIndex, destinationIndex: match.destinationIndex };
    matchedIndexesById.set(match.source.id, indexes);
    matchedIndexesById.set(match.destination.id, indexes);
  }
  const stackingOrder = animatedChildren.map(node => {
    const matched = matchedIndexesById.get(node.id);
    const sourceIndex = matched?.sourceIndex ?? sourceIndexById.get(node.id) ?? null;
    const destinationIndex = matched?.destinationIndex ?? destinationIndexById.get(node.id) ?? null;
    const kind = matched ? 'matched'
      : fixedSourceIndexes.has(sourceIndex) ? 'fixed-source'
        : fixedDestinationIndexes.has(destinationIndex) ? 'fixed-destination'
          : sourceIndex !== null ? 'source' : 'destination';
    return { kind, sourceIndex, destinationIndex, node: structuredClone(node) };
  });
  const fixedAwareMatches = new Map(matches.map(match => [toChildren[match.destinationIndex].id, match.node]));
  matchingFrame.children = animatedChildren
    .filter(node => matchedLayerIds.has(node.id) || fixedSourceIds.has(node.id) || fixedDestinationIds.has(node.id))
    .map(node => structuredClone(fixedAwareMatches.get(node.id) || node));
  return {
    matches, sourceFrame, destinationFrame, matchingFrame, stackingOrder,
    sourceOnlyRoots, fixedSourceRoots,
    matchCount: matches.length,
    fixedSourceIndexes: [...fixedSourceIndexes],
    fixedDestinationIndexes: [...fixedDestinationIndexes],
    fixedLayerCount: fixedSourceIndexes.size + fixedDestinationIndexes.size,
    matchingStacking
  };
}

/**
 * Build the ordered paint pass for a split Smart Animate transition.
 * Matched roots interpolate in place; outgoing and entering roots use their
 * respective endpoint geometry and selected main-transition motion. Keeping
 * all root kinds in one pass preserves their overlap order during the move.
 */
export function smartAnimatePresentationPaintPlan(split, destinationFrame, incomingMotion = null, progress = 0, outgoingMotion = null) {
  if (!split || !Array.isArray(split.stackingOrder) || !Array.isArray(destinationFrame?.children)) return [];
  const matchFrame = split.matchingFrame;
  const sourceShell = split.sourceFrame;
  const destinationShell = split.destinationFrame;
  const matchToSource = multiplyAffine(
    invertAffine(nodeToParentTransform({ ...matchFrame, x: 0, y: 0 })),
    nodeToParentTransform({ ...sourceShell, x: 0, y: 0 })
  );
  const matchToDestination = multiplyAffine(
    invertAffine(nodeToParentTransform({ ...matchFrame, x: 0, y: 0 })),
    nodeToParentTransform({ ...destinationFrame, x: 0, y: 0 })
  );
  const matchingClipFrame = { ...matchFrame, x: 0, y: 0 };
  const sourceClipFrame = { ...sourceShell, x: 0, y: 0 };
  const destinationClipFrame = { ...destinationShell, x: 0, y: 0 };
  const sourceOnlyRoots = new Map((split.sourceOnlyRoots || []).map(root => [root.sourceIndex, root.node]));
  const fixedSourceRoots = new Map((split.fixedSourceRoots || []).map(root => [root.sourceIndex, root.node]));
  const plannedSourceIndexes = new Set();
  const fixedDestinationIndexes = new Set(split.fixedDestinationIndexes || []);
  const plannedDestinationIndexes = new Set();
  const plan = [];
  const makeSourceEntry = (index, fixed = false, matchedNode = null) => {
    const sourceNode = fixed ? fixedSourceRoots.get(index) : sourceOnlyRoots.get(index);
    const node = matchedNode || sourceNode;
    if (!node) return null;
    return {
      kind: fixed ? 'fixed-source' : 'source',
      sourceIndex: index,
      destinationIndex: null,
      node,
      clipFrame: fixed ? matchingClipFrame : sourceClipFrame,
      frameTransform: fixed ? null : matchToSource,
      transitionMotion: fixed ? null : outgoingMotion
    };
  };
  const makeDestinationEntry = (index, fixed = false) => {
    const node = destinationFrame.children[index];
    if (!node) return null;
    const copy = fixed ? structuredClone(node) : node;
    if (fixed) copy.opacity = (Number.isFinite(copy.opacity) ? copy.opacity : 1) * Math.max(0, Math.min(1, Number(progress) || 0));
    return {
      kind: fixed ? 'fixed-destination' : 'destination',
      sourceIndex: null,
      destinationIndex: index,
      node: copy,
      clipFrame: fixed ? matchingClipFrame : destinationClipFrame,
      frameTransform: fixed ? null : matchToDestination,
      transitionMotion: fixed ? null : incomingMotion
    };
  };

  for (const entry of split.stackingOrder) {
    if (entry.kind === 'source') {
      const planned = makeSourceEntry(entry.sourceIndex);
      if (!planned) continue;
      plannedSourceIndexes.add(entry.sourceIndex);
      plan.push(planned);
      continue;
    }
    if (entry.kind === 'destination') {
      const planned = makeDestinationEntry(entry.destinationIndex);
      if (!planned) continue;
      plannedDestinationIndexes.add(entry.destinationIndex);
      plan.push(planned);
      continue;
    }
    if (entry.kind === 'fixed-source') {
      const planned = makeSourceEntry(entry.sourceIndex, true, entry.node);
      if (!planned) continue;
      plannedSourceIndexes.add(entry.sourceIndex);
      plan.push(planned);
      continue;
    }
    if (!['matched', 'fixed-destination'].includes(entry.kind)) continue;
    plan.push({
      kind: entry.kind,
      sourceIndex: entry.sourceIndex,
      destinationIndex: entry.destinationIndex,
      node: entry.node,
      clipFrame: matchingClipFrame,
      frameTransform: null,
      transitionMotion: null
    });
    if (entry.destinationIndex !== null) plannedDestinationIndexes.add(entry.destinationIndex);
  }

  // Keep source-only roots in the same paint pass at both exact endpoints.
  // Their selected main-transition motion hides them at the destination end.
  for (const { sourceIndex } of split.sourceOnlyRoots || []) {
    if (plannedSourceIndexes.has(sourceIndex)) continue;
    const planned = makeSourceEntry(sourceIndex);
    if (!planned) continue;
    plan.push(planned);
    plannedSourceIndexes.add(sourceIndex);
  }
  for (const { sourceIndex, node } of split.fixedSourceRoots || []) {
    if (plannedSourceIndexes.has(sourceIndex)) continue;
    const planned = makeSourceEntry(sourceIndex, true, fadeLayer(node, progress, false));
    if (!planned) continue;
    plan.push(planned);
    plannedSourceIndexes.add(sourceIndex);
  }

  // At the exact source endpoint blendChildren has no entering roots yet.
  // Keep them in the destination's authored order so the main transition can
  // still bring the incoming frame into view from its start position.
  for (let index = 0; index < destinationFrame.children.length; index += 1) {
    if (plannedDestinationIndexes.has(index)) continue;
    const planned = makeDestinationEntry(index, fixedDestinationIndexes.has(index));
    if (!planned) continue;
    const nextDestination = plan.findIndex(entry => Number.isInteger(entry.destinationIndex) && entry.destinationIndex > index);
    if (nextDestination >= 0) plan.splice(nextDestination, 0, planned);
    else plan.push(planned);
  }
  return plan;
}

/** Build one ordered Smart Animate paint pass while swapping the top overlay. */
export function smartAnimateOverlaySwapPlan(sourceFrame, targetFrame, progress, options = {}) {
  if (sourceFrame?.type !== 'frame' || targetFrame?.type !== 'frame') return null;
  const { requestedProgress, amount, allowOvershoot, geometryProgress } = normalizeSmartProgress(progress, options);
  const split = splitSmartFrameMatches(sourceFrame, targetFrame, requestedProgress, options);
  const incomingMotion = { x: 0, y: 0, opacity: amount };
  const outgoingMotion = { x: 0, y: 0, opacity: 1 - amount };
  const entries = smartAnimatePresentationPaintPlan(split, targetFrame, incomingMotion, amount, outgoingMotion);
  // split.matchingFrame is deliberately paint-free because it is also used
  // as a clipping shell for children. The final overlay still needs its own
  // interpolated frame paint while those child layers share one paint pass.
  const frame = allowOvershoot && requestedProgress === 0
    ? structuredClone(sourceFrame)
    : allowOvershoot && requestedProgress === 1
      ? structuredClone(targetFrame)
      : interpolateFrameProperties(
        sourceFrame,
        targetFrame,
        amount,
        geometryProgress,
        typeof options?.resolveRadius === 'function' ? options.resolveRadius : null,
        typeof options?.resolveImageTransition === 'function' ? options.resolveImageTransition : null
      );
  const matchedSourceIds = split.matches
    .map(match => sourceFrame.children?.[match.sourceIndex]?.id)
    .filter(id => typeof id === 'string');
  const matchedDestinationIds = split.matches
    .map(match => targetFrame.children?.[match.destinationIndex]?.id)
    .filter(id => typeof id === 'string');
  return {
    frame: { ...frame, children: entries.map(entry => entry.node) },
    entries,
    matchCount: split.matchCount,
    fixedLayerCount: split.fixedLayerCount,
    matchedSourceIds,
    matchedDestinationIds,
    // Unmatched ordinary roots dissolve in and out with the overlay. Fixed
    // roots alone do not transfer between overlay surfaces, so they stay on
    // the normal frame interpolation path.
    hasAnimatedLayers: split.matchCount > 0 || entries.some(entry => entry.kind === 'source' || entry.kind === 'destination')
  };
}

export function interpolateSmartFrame(fromFrame, toFrame, progress, options = {}) {
  if (fromFrame?.type !== 'frame' || toFrame?.type !== 'frame') throw new TypeError('Smart animation requires two frames.');
  const { requestedProgress, amount, allowOvershoot, geometryProgress } = normalizeSmartProgress(progress, options);
  // The supported back and spring curves briefly exceed their endpoints. Keep
  // that easing for spatial transforms while bounding hostile/custom values to
  // a finite range. Direct callers retain the historical clamped behavior;
  // the presentation player opts in. Non-spatial channels and layer presence
  // always use `amount`.
  // Return the authored snapshots at the endpoints. Building the transition
  // tree from the destination and snapping only known fields can otherwise
  // leak destination-only metadata into the source frame, and zero-opacity
  // entering layers can still affect masks or hit testing in some renderers.
  if (allowOvershoot ? requestedProgress === 0 : amount === 0) return structuredClone(fromFrame);
  if (allowOvershoot ? requestedProgress === 1 : amount === 1) return structuredClone(toFrame);
  const resolveRadius = typeof options?.resolveRadius === 'function' ? options.resolveRadius : null;
  const resolveImageTransition = typeof options?.resolveImageTransition === 'function' ? options.resolveImageTransition : null;
  const frame = interpolateFrameProperties(fromFrame, toFrame, amount, geometryProgress, resolveRadius, resolveImageTransition);
  frame.children = blendChildren(fromFrame.children || [], toFrame.children || [], amount, resolveRadius, geometryProgress, resolveImageTransition);
  return frame;
}
