import { getBlobBytes, parseFigBinary, parseVectorNetworkBlob, resolveVectorNodePaths, parseSVGPathData } from 'openfig-core';
import {
  canSwapComponentTo, createComponentSet, createDocument, createId, createNode, isMaskSource,
  MAX_DOCUMENT_TREE_DEPTH, parseDocument, setComponentPropertyValue, switchComponentInstanceVariant
} from './model.js';
import { assertSafeRasterDimensions, inspectRasterDimensions } from './image-engine.js';
import { createImageFill } from './image-fills.js';
import { createAutoLayout } from './layout-engine.js';
import { nodeToParentTransform, transformPoint } from './transform-geometry.js';
import {
  MAX_BACKGROUND_BLURS_PER_LAYER, MAX_DROP_SHADOWS_PER_LAYER,
  MAX_INNER_SHADOWS_PER_LAYER, MAX_LAYER_BLURS_PER_LAYER, MAX_NOISE_EFFECTS_PER_LAYER, MAX_SHADOW_SPREAD
} from './layer-effects.js';
import { preflightFigArchive, FIG_IMPORT_LIMITS } from './fig-import-preflight.js';
import { isValidLayerBlendMode } from './layer-blend.js';
import { normalizeStrokeDashArray } from './stroke-style.js';
import { DEFAULT_IMAGE_TILE_SCALE, isValidImageTileScale } from './image-tile.js';
import { MAX_POLYGON_POINTS, MAX_STAR_POINTS, MIN_STAR_POINTS } from './polygon-corners.js';

const MAX_WARNINGS = 40;
const MAX_NAME_LENGTH = 512;
const EPSILON = 1e-5;
const MAX_VECTOR_BLOB_BYTES = 512 * 1024;
const MAX_VECTOR_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_VECTOR_PATH_CHARS = 512 * 1024;
const MAX_VECTOR_PATH_SOURCE_CHARS = 4 * 1024 * 1024;
const MAX_VECTOR_GEOMETRY_ENTRIES = 2_048;

function finite(value, fallback = 0, minimum = -1_000_000_000, maximum = 1_000_000_000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function safeName(value, fallback = 'Untitled') {
  const name = String(value || '').replace(/[\x00-\x1f\x7f]/gu, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return name || fallback;
}

function guidKey(guid) {
  if (!guid || !Number.isSafeInteger(guid.sessionID) || !Number.isSafeInteger(guid.localID)) return null;
  return `${guid.sessionID}:${guid.localID}`;
}

function idOf(node) { return guidKey(node?.guid); }

function positionOrder(left, right) {
  const a = String(left.parentIndex?.position || '');
  const b = String(right.parentIndex?.position || '');
  return a < b ? -1 : a > b ? 1 : 0;
}

function hexColor(color) {
  if (!color || ![color.r, color.g, color.b].every(value => Number.isFinite(value))) return null;
  const channel = value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function paintOpacity(paint) {
  const alpha = Number.isFinite(paint?.color?.a) ? paint.color.a : 1;
  return finite(paint?.opacity, 1, 0, 1) * finite(alpha, 1, 0, 1);
}

const figLayerBlendModes = Object.freeze({
  NORMAL: 'normal', DARKEN: 'darken', MULTIPLY: 'multiply', COLOR_BURN: 'color-burn',
  LIGHTEN: 'lighten', SCREEN: 'screen', COLOR_DODGE: 'color-dodge', OVERLAY: 'overlay',
  SOFT_LIGHT: 'soft-light', HARD_LIGHT: 'hard-light', DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color',
  LUMINOSITY: 'luminosity'
});

function mapLayerBlendMode(source, overrides, report, name) {
  if (source.blendMode == null || source.blendMode === '') return;
  const sourceMode = String(source.blendMode).toUpperCase();
  const mapped = figLayerBlendModes[sourceMode];
  if (mapped && isValidLayerBlendMode(mapped)) {
    if (mapped !== 'normal') overrides.blendMode = mapped;
    return;
  }
  const detail = sourceMode === 'PASS_THROUGH'
    ? 'Pass-through group blending has no equivalent editable layer mode and was reset to normal.'
    : mapped
      ? `The Figma layer blend mode “${sourceMode}” is not supported by the local renderer and was reset to normal.`
      : `The unknown Figma layer blend mode “${sourceMode.slice(0, 80)}” was reset to normal.`;
  warn(report, 'flattened', 'BLEND_MODE', name, detail);
}

function mappedPaintBlendMode(paint, report, name, warningType = 'PAINT_BLEND') {
  if (paint?.blendMode == null || paint.blendMode === '') return {};
  const sourceMode = String(paint.blendMode).toUpperCase();
  if (sourceMode === 'NORMAL') return {};
  const knownLayerMode = figLayerBlendModes[sourceMode];
  if (knownLayerMode && isValidLayerBlendMode(knownLayerMode)) return { blendMode: knownLayerMode };
  const detail = sourceMode === 'PASS_THROUGH'
    ? 'PASS_THROUGH is not a paint blend mode supported by the local renderer and was reset to normal.'
    : `The unsupported paint blend mode “${sourceMode.slice(0, 80)}” was reset to normal.`;
  warn(report, 'flattened', warningType, name, detail);
  return {};
}

function mapEffectBlendMode(source, effect, report, name) {
  if (source.blendMode == null || source.blendMode === '') return;
  const sourceMode = String(source.blendMode).toUpperCase();
  const mapped = figLayerBlendModes[sourceMode];
  if (mapped && isValidLayerBlendMode(mapped)) {
    if (mapped !== 'normal') effect.blendMode = mapped;
    return;
  }
  const detail = sourceMode === 'PASS_THROUGH'
    ? 'PASS_THROUGH is not supported on an individual effect and was reset to normal.'
    : `The unsupported effect blend mode “${sourceMode.slice(0, 80)}” was reset to normal.`;
  warn(report, 'flattened', 'EFFECT_BLEND', name, detail);
}

// Text runs do not share the editable local fill stack. Preserve an import
// review warning for text paint blends even when the mode itself is supported
// for ordinary fill and stroke paints.
function warnPaintBlend(paint, report, name, warningType = 'PAINT_BLEND') {
  if (paint?.blendMode == null || paint.blendMode === '' || String(paint.blendMode).toUpperCase() === 'NORMAL') return;
  const sourceMode = String(paint.blendMode).toUpperCase();
  const knownLayerMode = figLayerBlendModes[sourceMode];
  const detail = knownLayerMode && isValidLayerBlendMode(knownLayerMode)
    ? `The ${sourceMode} paint blend cannot be represented on a local text run and was reset to normal.`
    : sourceMode === 'PASS_THROUGH'
      ? 'PASS_THROUGH is not a paint blend mode supported by the local text model and was reset to normal.'
      : `The unsupported paint blend mode “${sourceMode.slice(0, 80)}” was reset to normal.`;
  warn(report, 'flattened', warningType, name, detail);
}

function gradientGeometry(paint, type) {
  const transform = paint.transform;
  const identity = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
  const matrix = transform == null ? identity : transform;
  if (!matrix || !['m00', 'm01', 'm02', 'm10', 'm11', 'm12'].every(key => Number.isFinite(matrix[key]))) return null;
  const determinant = matrix.m00 * matrix.m11 - matrix.m10 * matrix.m01;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const point = (x, y) => ({
    x: (matrix.m11 * x - matrix.m01 * y + matrix.m01 * matrix.m12 - matrix.m11 * matrix.m02) / determinant,
    y: (-matrix.m10 * x + matrix.m00 * y + matrix.m10 * matrix.m02 - matrix.m00 * matrix.m12) / determinant
  });
  const handles = type === 'radial'
    ? [point(0.5, 0.5), point(1, 0.5), point(0.5, 1)]
    : [point(0, 0.5), point(1, 0.5), point(0.5, 1)];
  if (handles.some(handle => !Number.isFinite(handle.x) || !Number.isFinite(handle.y)
    || Math.abs(handle.x) > 1_000_000 || Math.abs(handle.y) > 1_000_000)) return null;
  if (type === 'angular') {
    // Angular paints in the local model rotate around the layer center. Keep
    // the source transform's orientation while explicitly reporting the one
    // geometry constraint the local angular paint cannot retain.
    const center = point(0.5, 0.5);
    const xAxis = handles[1];
    const angle = ((Math.atan2(xAxis.y - center.y, xAxis.x - center.x) * 180 / Math.PI + 90) % 360 + 360) % 360;
    return { angle, centered: Math.hypot(center.x - 0.5, center.y - 0.5) < 1e-5 };
  }
  return { geometry: { handles } };
}

function mapGradientPaint(paint, node, report) {
  const type = ({ GRADIENT_LINEAR: 'linear', GRADIENT_RADIAL: 'radial', GRADIENT_ANGULAR: 'angular' })[paint.type];
  const stops = paint.stops;
  if (!type || !Array.isArray(stops) || stops.length < 2 || stops.length > 8) {
    warn(report, 'unsupported', 'GRADIENT', node.name, 'This gradient needs 2–8 valid color stops and a supported gradient type.');
    return null;
  }
  const normalizedStops = stops.map((stop, index) => {
    const color = hexColor(stop?.color);
    const position = stop?.position;
    const alpha = stop?.color?.a == null ? 1 : stop.color.a;
    if (!color || !Number.isFinite(position) || position < 0 || position > 1 || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
    return { id: createId('stop'), color, opacity: alpha, position, index };
  });
  if (normalizedStops.some(stop => !stop)) {
    warn(report, 'unsupported', 'GRADIENT', node.name, 'A gradient with invalid stop colors, alpha, or positions was omitted.');
    return null;
  }
  normalizedStops.sort((left, right) => left.position - right.position || left.index - right.index);
  normalizedStops.forEach(stop => delete stop.index);
  const mappedGeometry = gradientGeometry(paint, type);
  if (!mappedGeometry) {
    warn(report, 'unsupported', 'GRADIENT_GEOMETRY', node.name, 'The gradient transform is malformed or degenerate, so this paint was omitted.');
    return null;
  }
  if (type === 'angular' && !mappedGeometry.centered) {
    warn(report, 'flattened', 'GRADIENT_GEOMETRY', node.name, 'The angular gradient center was moved to the layer center because the local editor stores angular gradients around the layer center.');
  }
  const { centered, ...geometry } = mappedGeometry;
  return {
    id: createId('fill'), type, visible: true,
    opacity: finite(paint.opacity, 1, 0, 1),
    gradient: { type, angle: type === 'angular' ? geometry.angle : 0, ...('geometry' in geometry ? { geometry: geometry.geometry } : {}), stops: normalizedStops }
  };
}

function findImageHash(paint) {
  const hash = paint?.image?.hash;
  if (typeof hash === 'string' && /^[a-f0-9]{40}$/iu.test(hash)) return hash.toLowerCase();
  if (ArrayBuffer.isView(hash) || Array.isArray(hash)) {
    if (hash.length !== 20) return null;
    const bytes = Array.from(hash);
    if (bytes.length === 20 && bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
  }
  return null;
}

const figImageFilterFields = Object.freeze({
  exposure: 'exposure', contrast: 'contrast', saturation: 'saturation', temperature: 'temperature',
  tint: 'tint', highlights: 'highlights', shadows: 'shadows'
});

function mapImageFilters(filters, report, name) {
  if (filters == null) return {};
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    warn(report, 'flattened', 'IMAGE_FILTER', name, 'Image filters were malformed and reset to their defaults.');
    return {};
  }
  const adjustments = {};
  let omitted = false;
  for (const [sourceField, value] of Object.entries(filters)) {
    const targetField = figImageFilterFields[sourceField];
    if (!targetField || !Number.isFinite(value) || value < -1 || value > 1) {
      omitted = true;
      continue;
    }
    // Figma stores image-filter sliders in [-1, 1]; the local adjustment
    // model uses percentage points in [-100, 100].
    adjustments[targetField] = value * 100;
  }
  if (omitted) {
    warn(report, 'flattened', 'IMAGE_FILTER', name, 'Unknown or out-of-range image filters were reset; supported filter values were retained.');
  }
  return adjustments;
}

function rasterMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.subarray(0, 6)))) return 'image/gif';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4e) return 'image/x-portable-anymap';
  return '';
}

function createReport(version, fileName) {
  return {
    source: safeName(fileName, 'Imported .fig'),
    formatVersion: version,
    sourceNodes: 0,
    importedNodes: 0,
    pages: 0,
    unsupportedTypes: {},
    flattenedTypes: {},
    warnings: [],
    warningsTruncated: false
  };
}

function warn(report, kind, type, name, detail = '') {
  const table = kind === 'flattened' ? report.flattenedTypes : report.unsupportedTypes;
  const safeType = typeof type === 'string' && type ? type.slice(0, 128) : 'UNKNOWN';
  Object.defineProperty(table, safeType, {
    value: (Object.hasOwn(table, safeType) ? table[safeType] : 0) + 1,
    enumerable: true, writable: true, configurable: true
  });
  if (report.warnings.length < MAX_WARNINGS) {
    report.warnings.push({ kind, type: safeType, name: safeName(name, safeType), detail: String(detail || '').slice(0, 1_000) });
  }
  else report.warningsTruncated = true;
}

function makeImageAsset(hash, sourceName, parsedImages, assetsById, report) {
  const filename = [...parsedImages.keys()].find(key => key.toLowerCase() === hash);
  const bytes = filename ? parsedImages.get(filename) : null;
  if (!(bytes instanceof Uint8Array) || !bytes.length) {
    warn(report, 'unsupported', 'IMAGE_FILL', sourceName, 'The file did not contain the referenced image bytes.');
    return null;
  }
  const id = `fig-image-${hash}`;
  if (assetsById.has(id)) return assetsById.get(id);
  const mimeType = rasterMime(bytes);
  if (!mimeType) {
    warn(report, 'unsupported', 'IMAGE_FILL', sourceName, 'The embedded image format is not supported by the local image engine.');
    return null;
  }
  let dimensions;
  try {
    assertSafeRasterDimensions(bytes);
    dimensions = inspectRasterDimensions(bytes);
  } catch (error) {
    warn(report, 'unsupported', 'IMAGE_FILL', sourceName, error.message || 'The embedded image failed size validation.');
    return null;
  }
  const asset = {
    id, name: safeName(filename, `fig-image-${hash.slice(0, 8)}`), type: mimeType,
    bytes: bytes.slice(), width: dimensions.width, height: dimensions.height
  };
  assetsById.set(id, asset);
  return asset;
}

function mapPaints(paints, node, context, { allowFill = true } = {}) {
  if (!Array.isArray(paints)) return [];
  if (!allowFill) {
    if (paints.some(paint => paint?.visible !== false)) warn(context.report, 'unsupported', 'FILL', node.name, 'This layer type cannot keep fill paints in the local document.');
    return [];
  }
  const supported = [];
  for (const paint of paints.slice(0, 32)) {
    if (!paint || paint.visible === false || finite(paint.opacity, 1, 0, 1) === 0) continue;
    const blend = mappedPaintBlendMode(paint, context.report, node.name);
    if (paint.type === 'SOLID') {
      const color = hexColor(paint.color);
      if (!color) { warn(context.report, 'unsupported', 'PAINT', node.name, 'A fill color could not be decoded.'); continue; }
      supported.push({ id: createId('fill'), type: 'solid', visible: true, opacity: paintOpacity(paint), color, ...blend });
      continue;
    }
    if (paint.type === 'IMAGE') {
      const hash = findImageHash(paint);
      const asset = hash ? makeImageAsset(hash, node.name, context.parsedImages, context.assetsById, context.report) : null;
      if (!asset) continue;
      context.imageLibrary.set(asset.id, {
        assetId: asset.id, name: asset.name, type: asset.type, width: asset.width, height: asset.height
      });
      const scaleMode = String(paint.scaleMode || '').toUpperCase();
      const fit = scaleMode === 'TILE' ? 'tile' : ['FIT', 'CONTAIN'].includes(scaleMode) ? 'contain' : 'cover';
      const rotation = paint.rotation == null ? 0 : Number(paint.rotation);
      const transforms = Number.isInteger(rotation) && rotation % 90 === 0 ? { rotation } : {};
      if (paint.rotation != null && !Object.hasOwn(transforms, 'rotation')) {
        warn(context.report, 'flattened', 'IMAGE_ROTATION', node.name, 'Image fill rotations outside 90-degree increments were reset to 0 degrees.');
      }
      const scalingFactor = paint.scalingFactor == null ? DEFAULT_IMAGE_TILE_SCALE : Number(paint.scalingFactor);
      if (paint.imageTransform) warn(context.report, 'flattened', 'IMAGE_TRANSFORM', node.name, 'The image crop transform uses the nearest supported fill mode.');
      if (scaleMode === 'TILE' && !isValidImageTileScale(scalingFactor)) {
        warn(context.report, 'flattened', 'IMAGE_TILE_SCALE', node.name, 'The tile percentage exceeded the local safe range and was reset to 100%.');
      }
      if (scaleMode === 'STRETCH') warn(context.report, 'flattened', 'IMAGE_SCALE', node.name, 'Stretch scaling was reduced to Fill.');
      supported.push({
        id: createId('fill'), type: 'image', visible: true, opacity: paintOpacity(paint), ...blend,
        imageFill: createImageFill(asset.id, {
          fit,
          transforms,
          adjustments: mapImageFilters(paint.filters, context.report, node.name),
          ...(fit === 'tile' ? { scalingFactor: isValidImageTileScale(scalingFactor) ? scalingFactor : DEFAULT_IMAGE_TILE_SCALE } : {})
        })
      });
      continue;
    }
    if (['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR'].includes(paint.type)) {
      const gradient = mapGradientPaint(paint, node, context.report);
      if (gradient) supported.push({ ...gradient, ...blend });
      continue;
    }
    warn(context.report, 'unsupported', paint.type || 'PAINT', node.name, 'This paint type was omitted; solid, gradient, and image fills are supported.');
  }
  if (paints.length > 32) warn(context.report, 'unsupported', 'PAINT_STACK', node.name, 'Only the first 32 paint layers were considered.');
  return supported;
}

function mapStrokes(paints, node, report) {
  if (!Array.isArray(paints)) return [];
  const strokes = [];
  const capValue = String(node.strokeCap || '').toUpperCase();
  const joinValue = String(node.strokeJoin || '').toUpperCase();
  const lineLike = ['LINE', 'VECTOR'].includes(String(node.type || '').toUpperCase());
  const standardCaps = ['NONE', 'ROUND', 'SQUARE', 'BUTT'];
  const representedDecorations = {
    ARROW_LINES: 'arrow', LINE_ARROW: 'arrow',
    ARROW_EQUILATERAL: 'triangle', TRIANGLE_ARROW: 'triangle',
    TRIANGLE_FILLED: 'triangle-inward', DIAMOND_FILLED: 'diamond', CIRCLE_FILLED: 'circle'
  };
  const decoration = lineLike ? representedDecorations[capValue] : undefined;
  // Do not silently turn a Figma cap shape into a plain butt cap. Missing cap
  // geometry changes the visual stroke, so omit that stroke and flag it for review.
  if (paints.some(paint => paint?.visible !== false && paintOpacity(paint) > 0)
    && capValue && !standardCaps.includes(capValue) && !Object.hasOwn(representedDecorations, capValue)) {
    warn(report, 'unsupported', 'STROKE_CAP', node.name,
      `The ${capValue} Figma stroke cap has no safe local representation; this stroke was omitted.`);
    return [];
  }
  let cap = ({ ROUND: 'round', SQUARE: 'square', BUTT: 'butt' })[capValue] || 'butt';
  const join = ({ ROUND: 'round', BEVEL: 'bevel', MITER: 'miter' })[joinValue] || 'miter';
  const rawDash = Array.isArray(node.dashPattern) ? node.dashPattern : [];
  const dash = rawDash.length ? normalizeStrokeDashArray(rawDash) : null;
  const weight = finite(node.strokeWeight, 1, 0, 100_000);
  const sideWeightProperties = {
    top: 'strokeTopWeight', right: 'strokeRightWeight',
    bottom: 'strokeBottomWeight', left: 'strokeLeftWeight'
  };
  const supportsIndividualSideWeights = ['RECTANGLE', 'FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SLIDE', 'SLOT'].includes(String(node.type || '').toUpperCase());
  const hasIndividualSideWeights = supportsIndividualSideWeights
    && Object.values(sideWeightProperties).some(property => Object.hasOwn(node, property));
  const sideWidths = hasIndividualSideWeights
    ? Object.fromEntries(Object.entries(sideWeightProperties).map(([side, property]) => [side, finite(node[property], weight, 0, 100_000)]))
    : null;
  const uniformSideWeights = sideWidths && Object.values(sideWidths).every(value => value === sideWidths.top);
  const width = uniformSideWeights ? sideWidths.top : weight;
  const sidePaint = sideWidths && !uniformSideWeights ? { sideMode: 'custom', sideWidths } : {};
  const close = (left, right) => Math.abs(left - right) <= Math.max(1, Math.abs(right)) * 1e-6;
  let pattern = 'solid';
  let dashArray;
  if (dash && dash.length === 2 && close(dash[0], width * 4) && close(dash[1], width * 2)) pattern = 'dashed';
  else if (dash && dash.length === 2 && close(dash[0], 0) && close(dash[1], width * 2)) pattern = 'dotted';
  else if (dash) { pattern = 'custom'; dashArray = dash; }
  else if (rawDash.length) warn(report, 'unsupported', 'STROKE_PATTERN', node.name, 'The custom dash pattern was invalid; the imported stroke uses a solid pattern.');
  if (pattern === 'dotted') cap = 'round';
  if (paints.length && joinValue && !['ROUND', 'BEVEL', 'MITER'].includes(joinValue)) warn(report, 'flattened', 'STROKE_JOIN', node.name, 'This stroke join was reduced to a miter join.');
  if (node.strokeAlign && node.strokeAlign !== 'CENTER') warn(report, 'flattened', 'STROKE_ALIGNMENT', node.name, 'Inside and outside stroke alignment were centered.');
  if (paints.length > 32) warn(report, 'unsupported', 'STROKE_STACK', node.name, 'Only the first 32 stroke paint layers were considered.');
  for (const paint of paints.slice(0, 32)) {
    if (!paint || paint.visible === false || paintOpacity(paint) <= 0) continue;
    if (['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR'].includes(paint.type)) {
      const mapped = mapGradientPaint(paint, node, report);
      if (!mapped) continue;
      strokes.push({
        id: createId('stroke'), color: mapped.gradient.stops[0].color,
        gradient: mapped.gradient, width, ...sidePaint,
        opacity: mapped.opacity, visible: true, cap, join, pattern,
        startDecoration: 'none', endDecoration: 'none',
        ...(decoration ? { startDecoration: decoration, endDecoration: decoration } : {}),
        ...(dashArray ? { dashArray: [...dashArray] } : {}),
        miterLimit: finite(node.strokeMiterLimit, 10, 1, 1000),
        ...mappedPaintBlendMode(paint, report, node.name)
      });
      continue;
    }
    if (paint.type !== 'SOLID' || !Number.isFinite(paint.color?.r)) {
      warn(report, 'unsupported', paint.type || 'STROKE', node.name, 'Only solid and gradient stroke paints are imported.');
      continue;
    }
    const blend = mappedPaintBlendMode(paint, report, node.name);
    const color = hexColor(paint.color);
    if (!color) continue;
    strokes.push({
      id: createId('stroke'), color, width, ...sidePaint,
      opacity: paintOpacity(paint), visible: true, cap, join, pattern,
      startDecoration: 'none', endDecoration: 'none',
      ...(decoration ? { startDecoration: decoration, endDecoration: decoration } : {}),
      ...(dashArray ? { dashArray: [...dashArray] } : {}),
      miterLimit: finite(node.strokeMiterLimit, 10, 1, 1000), ...blend
    });
  }
  return strokes;
}

function boundedEffectMetric(value, fallback, minimum, maximum, report, name, property) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    warn(report, 'flattened', 'EFFECT_METRIC', name, `The ${property} value was invalid and reset to ${fallback}.`);
    return fallback;
  }
  if (number < minimum || number > maximum) {
    warn(report, 'flattened', 'EFFECT_METRIC', name, `The ${property} value was clamped to the supported ${minimum}–${maximum} range.`);
    return Math.max(minimum, Math.min(maximum, number));
  }
  return number;
}

function mapLayerEffects(effects, node, report) {
  if (!Array.isArray(effects)) return [];
  const result = [];
  const counts = { 'drop-shadow': 0, 'inner-shadow': 0, 'layer-blur': 0, 'background-blur': 0, noise: 0 };
  const typeMap = {
    DROP_SHADOW: 'drop-shadow', INNER_SHADOW: 'inner-shadow',
    FOREGROUND_BLUR: 'layer-blur', BACKGROUND_BLUR: 'background-blur', NOISE: 'noise'
  };
  const limits = {
    'drop-shadow': MAX_DROP_SHADOWS_PER_LAYER,
    'inner-shadow': MAX_INNER_SHADOWS_PER_LAYER,
    'layer-blur': MAX_LAYER_BLURS_PER_LAYER,
    'background-blur': MAX_BACKGROUND_BLURS_PER_LAYER,
    noise: MAX_NOISE_EFFECTS_PER_LAYER
  };
  for (const source of effects) {
    if (!source || source.visible === false) continue;
    const type = typeMap[String(source.type || '').toUpperCase()];
    if (!type) {
      warn(report, 'unsupported', source.type || 'EFFECT', node.name, 'This Figma effect type has no equivalent editable local effect and was omitted.');
      continue;
    }
    if (counts[type] >= limits[type]) {
      warn(report, 'unsupported', 'EFFECT_STACK', node.name, `Additional ${type} effects exceed the local layer limit and were omitted.`);
      continue;
    }
    if ((type === 'layer-blur' || type === 'background-blur')
      && (counts['layer-blur'] + counts['background-blur']) > 0) {
      warn(report, 'unsupported', 'EFFECT_STACK', node.name, 'Only one foreground or background blur can be represented on a local layer; this additional blur was omitted.');
      continue;
    }

    const effect = { id: createId('effect'), type, visible: true };
    if (type === 'noise') {
      const mode = ({ MONOTONE: 'mono', DUOTONE: 'duo', MULTITONE: 'multi' })[String(source.noiseType || '').toUpperCase()];
      if (!mode) {
        warn(report, 'unsupported', 'NOISE_TYPE', node.name, 'This Noise effect uses an unknown color mode and was omitted.');
        continue;
      }
      const primaryColor = hexColor(source.color);
      const secondaryColor = hexColor(source.secondaryColor);
      if ((mode !== 'multi' && !primaryColor) || (mode === 'duo' && !secondaryColor)) {
        warn(report, 'unsupported', 'EFFECT_COLOR', node.name, `The ${mode} Noise effect did not have all required colors and was omitted.`);
        continue;
      }
      const colorAlpha = finite(source.color?.a, 1, 0, 1);
      const secondaryAlpha = finite(source.secondaryColor?.a, 1, 0, 1);
      if (mode === 'duo' && Math.abs(colorAlpha - secondaryAlpha) > EPSILON) {
        warn(report, 'unsupported', 'NOISE_ALPHA', node.name, 'The two Noise colors use different alpha values that the local effect cannot represent; this effect was omitted.');
        continue;
      }
      const size = boundedEffectMetric(source.noiseSize, 1, 1, 100, report, node.name, 'noise size');
      const vector = source.noiseSizeVector && typeof source.noiseSizeVector === 'object' ? source.noiseSizeVector : {};
      effect.mode = mode;
      effect.sizeX = boundedEffectMetric(vector.x, size, 1, 100, report, node.name, 'noise size x');
      effect.sizeY = boundedEffectMetric(vector.y, size, 1, 100, report, node.name, 'noise size y');
      effect.density = boundedEffectMetric(source.density, 40, 0, 100, report, node.name, 'noise density');
      effect.color = primaryColor || '#000000';
      effect.color2 = secondaryColor || '#ffffff';
      effect.opacity = boundedEffectMetric(source.opacity, colorAlpha, 0, 1, report, node.name, 'noise opacity');
      mapEffectBlendMode(source, effect, report, node.name);
    } else if (type === 'drop-shadow' || type === 'inner-shadow') {
      const color = hexColor(source.color);
      if (!color) {
        warn(report, 'unsupported', 'EFFECT_COLOR', node.name, `The ${type} had no valid color and was omitted.`);
        continue;
      }
      const offset = source.offset && typeof source.offset === 'object' ? source.offset : {};
      effect.color = color;
      effect.opacity = paintOpacity(source);
      effect.offsetX = boundedEffectMetric(offset.x, 0, -1000, 1000, report, node.name, 'effect offset x');
      effect.offsetY = boundedEffectMetric(offset.y, 0, -1000, 1000, report, node.name, 'effect offset y');
      effect.blur = boundedEffectMetric(source.radius, 0, 0, 100, report, node.name, 'effect blur radius');
      effect.spread = boundedEffectMetric(source.spread, 0, -MAX_SHADOW_SPREAD, MAX_SHADOW_SPREAD, report, node.name, 'shadow spread');
      if (type === 'drop-shadow') effect.showShadowBehindNode = source.showShadowBehindNode === true;
      mapEffectBlendMode(source, effect, report, node.name);
    } else {
      if (source.blurType != null && !['NORMAL', 'PROGRESSIVE'].includes(source.blurType)) {
        warn(report, 'unsupported', 'BLUR_TYPE', node.name, 'This blur type is not supported and the effect was omitted.');
        continue;
      }
      effect.radius = boundedEffectMetric(source.radius, 0, 0, 100, report, node.name, 'effect blur radius');
      effect.blurType = source.blurType === 'PROGRESSIVE' ? 'PROGRESSIVE' : 'NORMAL';
      if (effect.blurType === 'PROGRESSIVE') {
        const startOffset = source.startOffset;
        const endOffset = source.endOffset;
        if (![source.startRadius, startOffset?.x, startOffset?.y, endOffset?.x, endOffset?.y].every(Number.isFinite)) {
          warn(report, 'unsupported', 'PROGRESSIVE_BLUR_GEOMETRY', node.name,
            'This progressive blur had no valid start radius and end points and was omitted.');
          continue;
        }
        effect.startRadius = boundedEffectMetric(source.startRadius, 0, 0, 100, report, node.name, 'progressive blur start radius');
        effect.startOffset = {
          x: boundedEffectMetric(startOffset.x, 0, 0, 1, report, node.name, 'progressive blur start x'),
          y: boundedEffectMetric(startOffset.y, 0, 0, 1, report, node.name, 'progressive blur start y')
        };
        effect.endOffset = {
          x: boundedEffectMetric(endOffset.x, 1, 0, 1, report, node.name, 'progressive blur end x'),
          y: boundedEffectMetric(endOffset.y, 1, 0, 1, report, node.name, 'progressive blur end y')
        };
        if (Math.abs(effect.startOffset.x - effect.endOffset.x) <= EPSILON
          && Math.abs(effect.startOffset.y - effect.endOffset.y) <= EPSILON) {
          warn(report, 'unsupported', 'PROGRESSIVE_BLUR_GEOMETRY', node.name,
            'This progressive blur had identical start and end points and was omitted.');
          continue;
        }
      }
    }
    result.push(effect);
    counts[type] += 1;
  }
  return result;
}

function localTransform(source, report) {
  const transform = source.transform || {};
  const m00 = finite(transform.m00, 1); const m01 = finite(transform.m01, 0);
  const m10 = finite(transform.m10, 0); const m11 = finite(transform.m11, 1);
  const determinant = m00 * m11 - m01 * m10;
  const position = { x: finite(transform.m02), y: finite(transform.m12) };
  if (Math.abs(determinant) > 1e-12) {
    // For positive determinants, the polar angle isolates the closest pure
    // rotation and leaves a symmetric scale/shear residual. A reflection has
    // no unique polar rotation; use the first column's direction as a stable,
    // deterministic angle and retain the reflection in the residual matrix.
    const radians = determinant > 0
      ? Math.atan2(m10 - m01, m00 + m11)
      : Math.atan2(m10, m00);
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const residual = {
      a: m00 * cosine - m01 * sine,
      b: m10 * cosine - m11 * sine,
      c: m00 * sine + m01 * cosine,
      d: m10 * sine + m11 * cosine
    };
    const isIdentity = Math.abs(residual.a - 1) <= EPSILON && Math.abs(residual.b) <= EPSILON
      && Math.abs(residual.c) <= EPSILON && Math.abs(residual.d - 1) <= EPSILON;
    return {
      ...position,
      rotation: radians * 180 / Math.PI,
      ...(!isIdentity ? { affineTransform: residual } : {})
    };
  }
  warn(report, 'flattened', 'TRANSFORM', source.name, 'A singular transform was reduced to its closest rotation.');
  return { ...position, rotation: Math.atan2(m10, m00) * 180 / Math.PI };
}

function vectorContours(svgPath) {
  const commands = parseSVGPathData(svgPath);
  const contours = [];
  let current = null;
  for (const command of commands) {
    if (command.type === 'M') {
      if (current?.points.length) contours.push(current);
      current = { points: [{ x: command.x, y: command.y }], closed: false };
    } else if (command.type === 'L' && current?.points.length) {
      current.points.push({ x: command.x, y: command.y });
    } else if (command.type === 'C' && current?.points.length) {
      const previous = current.points.at(-1);
      const point = { x: command.x, y: command.y };
      previous.out = { x: command.c1x - previous.x, y: command.c1y - previous.y };
      point.in = { x: command.c2x - point.x, y: command.c2y - point.y };
      current.points.push(point);
    } else if (command.type === 'Z' && current?.points.length) {
      current.closed = true;
      contours.push(current);
      current = null;
    }
  }
  if (current?.points.length) contours.push(current);
  return contours;
}

function vectorChildren(source, resolved, context) {
  const children = [];
  const vectorEntries = [
    ...resolved.fill.map(path => ({ path, type: 'fill' })),
    ...resolved.stroke.map(path => ({ path, type: 'stroke' }))
  ];
  for (const { path, type } of vectorEntries) {
    if (typeof path.svgPath !== 'string' || path.svgPath.length > MAX_VECTOR_PATH_CHARS
      || context.totalVectorPathChars + path.svgPath.length > MAX_VECTOR_PATH_SOURCE_CHARS) {
      warn(context.report, 'unsupported', 'VECTOR_PATH', source.name, 'A vector path exceeds the safe geometry limit.');
      continue;
    }
    context.totalVectorPathChars += path.svgPath.length;
    let contours;
    try { contours = vectorContours(path.svgPath); }
    catch { warn(context.report, 'unsupported', 'VECTOR_PATH', source.name, 'A vector path could not be decoded.'); continue; }
    if (!contours.length || contours.reduce((total, contour) => total + contour.points.length, 0) > 20_000) {
      warn(context.report, 'unsupported', 'VECTOR_PATH', source.name, 'A vector path is empty or exceeds the safe point limit.');
      continue;
    }
    const invalidPoint = contours.some(contour => contour.points.some(point => ![point.x, point.y, point.in?.x, point.in?.y, point.out?.x, point.out?.y]
      .filter(value => value !== undefined).every(Number.isFinite)));
    if (invalidPoint) {
      warn(context.report, 'unsupported', 'VECTOR_PATH', source.name, 'A vector path contains invalid coordinates and was omitted.');
      continue;
    }
    const [first, ...rest] = contours;
    const width = finite(source.size?.x, 0, 0, 1_000_000);
    const height = finite(source.size?.y, 0, 0, 1_000_000);
    const paintSource = Array.isArray(path.paints) && path.paints.length ? path.paints : (type === 'fill' ? source.fillPaints : source.strokePaints);
    const node = createNode('path', {
      name: safeName(`${source.name} ${type}`, 'Vector path'), x: 0, y: 0,
      width, height, rotation: 0, opacity: 1, visible: true,
      points: first.points, closed: first.closed,
      ...(rest.length ? { subpaths: rest } : {}),
      fillRule: String(path.windingRule || '').toUpperCase() === 'EVENODD' ? 'evenodd' : 'nonzero',
      fills: type === 'fill'
        ? mapPaints(paintSource, source, context, { allowFill: contours.some(contour => contour.closed && contour.points.length >= 2) })
        : [],
      strokes: type === 'stroke' ? mapStrokes(paintSource, source, context) : []
    });
    children.push(node);
    context.report.importedNodes += 1;
  }
  return children;
}

function vectorNetworkFaceLoop(region, network) {
  if (!region || region.loops?.length !== 1 || !Array.isArray(region.loops[0])
    || region.loops[0].length < 3 || region.loops[0].length > network.segments.length) return null;
  const loop = region.loops[0];
  if (loop.some(index => !Number.isSafeInteger(index) || index < 0 || index >= network.segments.length)
    || new Set(loop).size !== loop.length) return null;
  for (const firstDirection of [1, -1]) {
    const first = network.segments[loop[0]];
    if (!first?.start || !first?.end) return null;
    let current = firstDirection === 1 ? first.start.vertex : first.end.vertex;
    const start = current;
    const vertexIndices = [];
    const segmentIndices = [];
    let valid = true;
    for (const segmentIndex of loop) {
      const segment = network.segments[segmentIndex];
      if (!segment?.start || !segment?.end) { valid = false; break; }
      const next = segment.start.vertex === current ? segment.end.vertex
        : segment.end.vertex === current ? segment.start.vertex : null;
      if (next == null) { valid = false; break; }
      vertexIndices.push(current);
      segmentIndices.push(segmentIndex);
      current = next;
    }
    if (valid && current === start && vertexIndices.length >= 3
      && new Set(vertexIndices).size === vertexIndices.length) return { vertexIndices, segmentIndices };
  }
  return null;
}

function vectorNetworkPathMatches(path, network, faceLoop, width, height) {
  if (typeof path?.svgPath !== 'string' || path.svgPath.length > MAX_VECTOR_PATH_CHARS) return false;
  const { vertexIndices, segmentIndices } = faceLoop || {};
  if (!Array.isArray(vertexIndices) || !Array.isArray(segmentIndices)
    || vertexIndices.length < 3 || vertexIndices.length !== segmentIndices.length) return false;
  let actual;
  try { actual = parseSVGPathData(path.svgPath); }
  catch { return false; }
  const point = index => network.vertices[index];
  const expected = [{ type: 'M', x: point(vertexIndices[0]).x, y: point(vertexIndices[0]).y }];
  for (let index = 0; index < vertexIndices.length; index += 1) {
    const from = vertexIndices[index];
    const to = vertexIndices[(index + 1) % vertexIndices.length];
    const segment = network.segments[segmentIndices[index]];
    if (!segment || !((segment.start.vertex === from && segment.end.vertex === to)
      || (segment.start.vertex === to && segment.end.vertex === from))) return false;
    if (index === vertexIndices.length - 1 && segment.isStraight) continue;
    const forward = segment.start.vertex === from;
    const start = point(from); const end = point(to);
    if (segment.isStraight) {
      expected.push({ type: 'L', x: end.x, y: end.y });
      continue;
    }
    const firstVertex = point(segment.start.vertex); const lastVertex = point(segment.end.vertex);
    const firstControl = { x: firstVertex.x + segment.start.dx, y: firstVertex.y + segment.start.dy };
    const lastControl = { x: lastVertex.x + segment.end.dx, y: lastVertex.y + segment.end.dy };
    const control1 = forward ? firstControl : lastControl;
    const control2 = forward ? lastControl : firstControl;
    expected.push({ type: 'C', c1x: control1.x, c1y: control1.y, c2x: control2.x, c2y: control2.y, x: end.x, y: end.y });
  }
  expected.push({ type: 'Z' });
  if (actual.length !== expected.length) return false;
  // The .fig command blob serializes coordinates to hundredths while the
  // vectorNetworkBlob keeps float32 values, so compare their declared geometry
  // within the command format's rounding precision.
  const tolerance = Math.max(0.02, Math.max(width, height) * 1e-7);
  return actual.every((command, index) => {
    const target = expected[index];
    if (command.type !== target.type) return false;
    if (target.type === 'Z') return true;
    const properties = target.type === 'C'
      ? ['c1x', 'c1y', 'c2x', 'c2y', 'x', 'y']
      : ['x', 'y'];
    return properties.every(property => Number.isFinite(command[property])
      && Math.abs(command[property] - target[property]) <= tolerance);
  });
}

function vectorNetworkHasUniqueEdges(network) {
  const pairs = new Set();
  for (const segment of network.segments) {
    if (!Number.isSafeInteger(segment?.start?.vertex) || !Number.isSafeInteger(segment?.end?.vertex)
      || segment.start.vertex < 0 || segment.end.vertex < 0
      || segment.start.vertex >= network.vertices.length || segment.end.vertex >= network.vertices.length
      || segment.start.vertex === segment.end.vertex
      || ![segment.start.dx, segment.start.dy, segment.end.dx, segment.end.dy].every(Number.isFinite)) return false;
    const key = segment.start.vertex < segment.end.vertex
      ? `${segment.start.vertex}:${segment.end.vertex}`
      : `${segment.end.vertex}:${segment.start.vertex}`;
    if (pairs.has(key)) return false;
    pairs.add(key);
  }
  return true;
}

/** Keep simple one-loop Figma vector regions as their editable network graph. */
function editableFigVectorNetwork(source, network, resolvedFillPaths) {
  const size = source.size || {};
  const normalizedSize = source.vectorData?.normalizedSize || {};
  const width = Number(size.x); const height = Number(size.y);
  const normalizedWidth = Number(normalizedSize.x); const normalizedHeight = Number(normalizedSize.y);
  const fillGeometry = Array.isArray(source.fillGeometry) ? source.fillGeometry : [];
  const strokeGeometry = Array.isArray(source.strokeGeometry) ? source.strokeGeometry : [];
  const styleOverrides = source.vectorData?.styleOverrideTable;
  if (!network || !Array.isArray(network.vertices) || !Array.isArray(network.segments) || !Array.isArray(network.regions)
    || network.vertices.length < 3 || network.vertices.length > 20_000
    || network.segments.length < 3 || network.segments.length > 20_000
    || network.regions.length < 1 || network.regions.length > MAX_VECTOR_GEOMETRY_ENTRIES
    || !Array.isArray(resolvedFillPaths) || resolvedFillPaths.length !== network.regions.length
    || fillGeometry.length !== network.regions.length || strokeGeometry.length !== 0
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || !Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight)
    || normalizedWidth <= 0 || normalizedHeight <= 0
    // Figma's raw network coordinates are in normalizedSize units. Keeping
    // exact source bounds avoids inferring an undocumented scale conversion.
    || Math.abs(width - normalizedWidth) > EPSILON || Math.abs(height - normalizedHeight) > EPSILON
    || fillGeometry.some(geometry => (geometry?.styleID ?? 0) !== 0)
    || (styleOverrides != null && (!Array.isArray(styleOverrides) || styleOverrides.length > 0))
    || network.vertices.some(vertex => vertex.styleID !== 0 || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)
      || Math.abs(vertex.x) > normalizedWidth * 1_000_000 || Math.abs(vertex.y) > normalizedHeight * 1_000_000)
    || network.regions.some(region => region?.styleID !== 0)
    || !vectorNetworkHasUniqueEdges(network)) return null;
  const faceLoops = network.regions.map(region => vectorNetworkFaceLoop(region, network));
  if (faceLoops.some(faceLoop => !faceLoop)) return null;
  const usedSegments = new Set(faceLoops.flatMap(faceLoop => faceLoop.segmentIndices));
  const usedVertices = new Set(faceLoops.flatMap(faceLoop => faceLoop.vertexIndices));
  if (usedSegments.size !== network.segments.length || usedVertices.size !== network.vertices.length) return null;
  const unmatchedRegions = new Set(faceLoops.map((_, index) => index));
  for (const path of resolvedFillPaths) {
    const matchingRegion = [...unmatchedRegions].find(index =>
      vectorNetworkPathMatches(path, network, faceLoops[index], width, height));
    if (matchingRegion == null) return null;
    unmatchedRegions.delete(matchingRegion);
  }
  if (unmatchedRegions.size) return null;

  const vertices = network.vertices.map((vertex, index) => ({
    id: `fig-v${index + 1}`, x: vertex.x / normalizedWidth, y: vertex.y / normalizedHeight
  }));
  const edges = network.segments.map((segment, index) => {
    const fromVertex = network.vertices[segment.start.vertex];
    const toVertex = network.vertices[segment.end.vertex];
    if (!fromVertex || !toVertex || ![segment.start.dx, segment.start.dy, segment.end.dx, segment.end.dy].every(Number.isFinite)) return null;
    const control1 = segment.start.dx || segment.start.dy ? {
      x: (fromVertex.x + segment.start.dx) / normalizedWidth,
      y: (fromVertex.y + segment.start.dy) / normalizedHeight
    } : null;
    const control2 = segment.end.dx || segment.end.dy ? {
      x: (toVertex.x + segment.end.dx) / normalizedWidth,
      y: (toVertex.y + segment.end.dy) / normalizedHeight
    } : null;
    if ([control1, control2].some(control => control && (!Number.isFinite(control.x) || !Number.isFinite(control.y)))) return null;
    return {
      id: `fig-e${index + 1}`, from: `fig-v${segment.start.vertex + 1}`, to: `fig-v${segment.end.vertex + 1}`,
      ...(control1 ? { control1 } : {}), ...(control2 ? { control2 } : {})
    };
  });
  if (edges.some(edge => !edge)) return null;
  return {
    vertices, edges,
    faces: faceLoops.map((faceLoop, index) => ({
      id: `fig-f${index + 1}`,
      vertexIds: faceLoop.vertexIndices.map(vertexIndex => `fig-v${vertexIndex + 1}`),
      fill: null, fillOpacity: 1
    }))
  };
}

function modelType(sourceType) {
  switch (sourceType) {
    case 'FRAME': case 'COMPONENT': case 'COMPONENT_SET': case 'INSTANCE': case 'SYMBOL': return 'frame';
    case 'GROUP': return 'group';
    case 'SECTION': return 'section';
    case 'RECTANGLE': case 'ROUNDED_RECTANGLE': return 'rectangle';
    case 'ELLIPSE': return 'ellipse';
    case 'LINE': return 'line';
    case 'STAR': return 'star';
    case 'REGULAR_POLYGON': case 'POLYGON': return 'polygon';
    case 'TEXT': return 'text';
    case 'BOOLEAN_OPERATION': return 'boolean';
    default: return null;
  }
}

function figTextLineHeight(value, fallbackValue = 1.25, fallbackUnit = 'ratio') {
  if (value == null) return { value: fallbackValue, unit: fallbackUnit };
  const metric = value && typeof value === 'object' ? value : { value };
  const unit = String(metric.unit || '').toUpperCase();
  if (unit === 'AUTO') return { value: 1, unit: 'auto' };
  const number = Number(metric.value);
  if (!Number.isFinite(number) || number <= 0) return { value: fallbackValue, unit: fallbackUnit };
  if (unit === 'PIXELS' || unit === 'PX') return { value: finite(number, fallbackValue, 0.01, 100_000), unit: 'pixels' };
  if (unit === 'PERCENT' || unit === 'PERCENTAGE') return { value: finite(number, fallbackValue, 0.01, 100_000), unit: 'percent' };
  return { value: finite(number, fallbackValue, 0.01, 100), unit: 'ratio' };
}

function figTextLetterSpacing(value, fontSize, fallback = 0) {
  if (value == null) return fallback;
  const metric = value && typeof value === 'object' ? value : { value };
  const number = Number(metric.value);
  if (!Number.isFinite(number)) return fallback;
  const unit = String(metric.unit || '').toUpperCase();
  if (unit === 'PERCENT' || unit === 'PERCENTAGE') return finite(number * fontSize / 100, fallback, -10_000, 10_000);
  if (unit && !['PIXELS', 'PX'].includes(unit)) return fallback;
  return finite(number, fallback, -10_000, 10_000);
}

function figEnumValueFromEmbeddedSchema(schema, fieldName, numericValue) {
  if (!Number.isSafeInteger(numericValue) || numericValue < 0 || !Array.isArray(schema?.definitions)) return null;
  const enumTypes = new Set(schema.definitions.flatMap(definition =>
    Array.isArray(definition?.fields)
      ? definition.fields.filter(field => field?.name === fieldName && typeof field.type === 'string').map(field => field.type)
      : []));
  if (enumTypes.size !== 1) return null;
  const enumType = [...enumTypes][0];
  const definitions = schema.definitions.filter(definition => definition?.kind === 'ENUM' && definition.name === enumType);
  if (definitions.length !== 1) return null;
  return definitions[0].fields?.find(field => field?.value === numericValue)?.name || null;
}

function figTextWrapStyle(value, context, name) {
  if (value == null) return 'auto';
  const raw = typeof value === 'string'
    ? value
    : figEnumValueFromEmbeddedSchema(context.parsed?.schema, 'textWrapStyle', value);
  const mapped = ({ AUTO: 'auto', BALANCE: 'balance', PRETTY: 'pretty' })[String(raw || '').toUpperCase()];
  if (mapped) return mapped;
  const valueLabel = typeof value === 'string' ? `“${value.slice(0, 80)}”`
    : Number.isSafeInteger(value) ? String(value) : `(${typeof value})`;
  warn(context.report, 'flattened', 'TEXT_WRAP_STYLE', name,
    `The text wrap style ${valueLabel} is unknown to this file's embedded schema or unsupported; automatic wrapping was used.`);
  return 'auto';
}

function figTextAlignment(value, schema) {
  const raw = typeof value === 'string'
    ? value
    : figEnumValueFromEmbeddedSchema(schema, 'textAlignHorizontal', value);
  return ({ LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' })[String(raw || '').toUpperCase()] || null;
}

function mapFigParagraphStyles(source, characters, context) {
  const sourceStyles = source.textData?.paragraphStyle;
  if (!Array.isArray(sourceStyles) || sourceStyles.length !== characters.split(/\r\n|\r|\n/u).length
    || sourceStyles.length > 100_000) return null;
  const styles = [];
  let hasSupportedStyle = false;
  for (const paragraph of sourceStyles) {
    if (!paragraph || typeof paragraph !== 'object' || Array.isArray(paragraph)) return null;
    const style = {};
    if (paragraph.textWrapStyle != null) {
      hasSupportedStyle = true;
      const mapped = figTextWrapStyle(paragraph.textWrapStyle, context, source.name);
      style.textWrapStyle = mapped;
    }
    if (paragraph.textAlignHorizontal != null) {
      const mapped = figTextAlignment(paragraph.textAlignHorizontal, context.parsed?.schema);
      if (mapped) {
        hasSupportedStyle = true;
        style.align = mapped;
      }
    }
    styles.push(style);
  }
  return hasSupportedStyle ? styles : null;
}

function hasOnlySupportedFigParagraphStyles(source, text, schema) {
  const paragraphs = source.textData?.paragraphStyle;
  return Array.isArray(paragraphs) && paragraphs.length === String(text ?? '').split(/\r\n|\r|\n/u).length
    && paragraphs.length <= 100_000 && paragraphs.every(paragraph => paragraph && typeof paragraph === 'object'
    && !Array.isArray(paragraph) && Object.keys(paragraph).every(key => key === 'textWrapStyle' || key === 'textAlignHorizontal')
    && (paragraph.textAlignHorizontal == null || figTextAlignment(paragraph.textAlignHorizontal, schema)));
}

function inferredTextWeight(styleName) {
  const name = String(styleName || '');
  return /(?:thin|hairline)/iu.test(name) ? 100
    : /(?:extra\s*light|ultra\s*light)/iu.test(name) ? 200
      : /\blight\b/iu.test(name) ? 300
        : /(?:semi\s*bold|demi\s*bold)/iu.test(name) ? 600
          : /\bmedium\b/iu.test(name) ? 500
            : /(?:extra\s*bold|ultra\s*bold)/iu.test(name) ? 800
              : /\b(?:bold|heavy|black)\b/iu.test(name) ? 700 : 400;
}

function textRunStyleOverrides(style, base, context, name) {
  const result = {};
  const family = style.fontFamily || style.fontName?.family;
  if (typeof family === 'string' && family.trim()) {
    const value = safeName(family, base.fontFamily).slice(0, 160);
    if (value !== base.fontFamily) result.fontFamily = value;
  }
  const fontSize = Number(style.fontSize);
  if (Number.isFinite(fontSize) && fontSize > 0) {
    const value = finite(fontSize, base.fontSize, 1, 100_000);
    if (value !== base.fontSize) result.fontSize = value;
  }
  const fontNameStyle = style.fontName?.style || style.fontStyleName || '';
  const fontWeight = Number.isFinite(Number(style.fontWeight))
    ? finite(style.fontWeight, base.fontWeight, 1, 1000)
    : fontNameStyle ? inferredTextWeight(fontNameStyle) : null;
  if (fontWeight != null && fontWeight !== base.fontWeight) result.fontWeight = fontWeight;
  const italic = style.italic === true || String(style.fontStyle || '').toUpperCase() === 'ITALIC' || /italic/iu.test(String(fontNameStyle));
  const normalStyle = style.italic === false || ['NORMAL', 'REGULAR'].includes(String(style.fontStyle || '').toUpperCase());
  if ((italic || normalStyle) && (italic ? 'italic' : 'normal') !== base.fontStyle) result.fontStyle = italic ? 'italic' : 'normal';

  const sizeForMetrics = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : base.fontSize;
  if (style.lineHeight != null) {
    const metric = figTextLineHeight(style.lineHeight, base.lineHeight, base.lineHeightUnit || 'ratio');
    if (metric.value !== base.lineHeight || metric.unit !== (base.lineHeightUnit || 'ratio')) {
      result.lineHeight = metric.value;
      result.lineHeightUnit = metric.unit;
    }
  }
  if (style.letterSpacing != null) {
    const value = figTextLetterSpacing(style.letterSpacing, sizeForMetrics, base.letterSpacing);
    if (value !== base.letterSpacing) result.letterSpacing = value;
  }
  const decoration = String(style.textDecoration || '').toUpperCase();
  const textDecoration = ({ UNDERLINE: 'underline', STRIKETHROUGH: 'line-through', NONE: 'none' })[decoration];
  if (textDecoration && textDecoration !== base.textDecoration) result.textDecoration = textDecoration;

  if (typeof style.color === 'string' && /^#[0-9a-f]{6}$/iu.test(style.color) && style.color.toLowerCase() !== base.color.toLowerCase()) {
    result.color = style.color.toLowerCase();
  }
  const fills = Array.isArray(style.fills) ? style.fills : Array.isArray(style.fillPaints) ? style.fillPaints : null;
  if (fills) {
    const visibleFills = fills.filter(paint => paint && paint.visible !== false && paintOpacity(paint) > 0);
    const paint = visibleFills.find(item => item.type === 'SOLID');
    if (paint) {
      const color = hexColor(paint.color);
      if (color && color !== base.color.toLowerCase()) result.color = color;
      if (paintOpacity(paint) < 1) warn(context.report, 'flattened', 'TEXT_STYLE_OPACITY', name, 'Per-range text fill opacity was reset to opaque because editable text runs do not store range opacity.');
      if (visibleFills.some(item => item.type !== 'SOLID')) {
        warn(context.report, 'unsupported', 'TEXT_STYLE_PAINT', name, 'Per-range gradient, image, or patterned text paints cannot be represented by the local text-run model; the first solid color was used when present.');
      } else if (visibleFills.length > 1) {
        warn(context.report, 'flattened', 'TEXT_STYLE_PAINT', name, 'Per-range text paint stacks were reduced to their first solid color.');
      }
    } else if (visibleFills.length) {
      warn(context.report, 'unsupported', 'TEXT_STYLE_PAINT', name, 'Per-range gradient, image, or patterned text paints cannot be represented by the local text-run model and were reduced to the layer text color.');
    }
  }

  const supported = new Set([
    'fontFamily', 'fontName', 'fontSize', 'fontWeight', 'fontStyle', 'fontStyleName', 'italic',
    'lineHeight', 'letterSpacing', 'textDecoration', 'color', 'fills', 'fillPaints'
  ]);
  if (Object.keys(style).some(key => !supported.has(key))) {
    warn(context.report, 'flattened', 'TEXT_STYLE_PROPERTIES', name, 'Some per-range text properties are not represented by editable local text runs.');
  }
  return result;
}

function textRunsFromFigOverrides(source, characters, base, context) {
  if (!characters.length) return null;
  const textData = source.textData || {};
  const styleIds = Array.isArray(textData.characterStyleOverrides)
    ? textData.characterStyleOverrides
    : Array.isArray(textData.characterStyleIDs) ? textData.characterStyleIDs : null;
  if (!styleIds || !styleIds.some(id => id !== 0)) return null;
  const name = safeName(source.name, 'Text');
  const flatten = detail => {
    warn(context.report, 'flattened', 'TEXT_STYLE', name, detail);
    return null;
  };
  if (styleIds.length > characters.length || styleIds.some(id => !Number.isSafeInteger(id) || id < 0)) {
    return flatten('Character style references were malformed; the base text style was used.');
  }
  const table = textData.styleOverrideTable || source.styleOverrideTable;
  if (!table || typeof table !== 'object') return flatten('Character style references had no style override table; the base text style was used.');
  const getStyle = id => table instanceof Map ? table.get(id) ?? table.get(String(id)) : table[String(id)];
  const warnMissing = () => warn(context.report, 'flattened', 'TEXT_STYLE', name, 'A character style reference was missing or malformed; the affected characters use the base style.');
  const runs = [];
  const styleCache = new Map();
  let warnedMissing = false;
  let warnedSplitPair = false;
  for (let index = 0; index < characters.length;) {
    const codePoint = characters.codePointAt(index);
    const width = codePoint > 0xffff ? 2 : 1;
    let styleId = styleIds[index] || 0;
    if (width === 2 && (styleIds[index + 1] || 0) !== styleId) {
      if (!warnedSplitPair) {
        warn(context.report, 'flattened', 'TEXT_STYLE_SURROGATE', name, 'A character style boundary split a Unicode character; that character uses the base style.');
        warnedSplitPair = true;
      }
      styleId = 0;
    }
    let overrides = styleCache.get(styleId);
    if (overrides === undefined) {
      overrides = {};
      if (styleId) {
        const style = getStyle(styleId);
        if (style && typeof style === 'object' && !Array.isArray(style)) {
          overrides = textRunStyleOverrides(style, base, context, name);
        } else if (!warnedMissing) { warnMissing(); warnedMissing = true; }
      }
      styleCache.set(styleId, overrides);
    }
    const text = characters.slice(index, index + width);
    const previous = runs.at(-1);
    if (previous && JSON.stringify(previous.style) === JSON.stringify(overrides)) previous.text += text;
    else runs.push({ text, style: overrides });
    if (runs.length > 10_000) return flatten('The text has too many style runs to preserve safely; the base text style was used.');
    index += width;
  }
  if (!runs.some(run => Object.keys(run.style).length)) return null;
  return runs.map(run => ({ text: run.text, ...run.style }));
}

function textProperties(source, context) {
  const characters = typeof source.textData?.characters === 'string' ? source.textData.characters : '';
  const style = source.textData?.style || source.style || {};
  const visiblePaints = Array.isArray(source.fillPaints)
    ? source.fillPaints.filter(item => item && item.visible !== false && paintOpacity(item) > 0)
    : [];
  const solidPaints = visiblePaints.filter(item => item.type === 'SOLID');
  const paint = solidPaints[0] || null;
  const color = hexColor(paint?.color) || '#1e1e1e';
  if (paint && !hexColor(paint.color)) warn(context.report, 'unsupported', 'TEXT_PAINT', source.name, 'The text color could not be decoded and uses the local default.');
  const namedStyle = String(style.fontName?.style || source.fontName?.style || '');
  const fontFamily = safeName(style.fontFamily || style.fontName?.family || source.fontName?.family || source.fontFamily, 'Arial, sans-serif').slice(0, 160);
  const fontSize = finite(style.fontSize ?? source.fontSize, 24, 1, 100_000);
  const fontWeight = finite(style.fontWeight ?? source.fontWeight, inferredTextWeight(namedStyle), 1, 1000);
  const lineHeight = figTextLineHeight(style.lineHeight ?? source.lineHeight);
  const letterSpacing = figTextLetterSpacing(style.letterSpacing ?? source.letterSpacing, fontSize);
  const paragraphStyles = mapFigParagraphStyles(source, characters, context);
  const rawTextWrapStyle = source.textWrapStyle ?? style.textWrapStyle;
  const textWrapStyle = paragraphStyles && String(rawTextWrapStyle || '').toUpperCase() === 'MIXED'
    ? 'auto' : figTextWrapStyle(rawTextWrapStyle, context, source.name);
  const verticalAlign = ({ TOP: 'top', CENTER: 'middle', BOTTOM: 'bottom' })[String(source.textAlignVertical || '').toUpperCase()] || 'top';
  const textAutoResize = String(source.textAutoResize || '').toUpperCase();
  const textFit = ({ HEIGHT: 'auto-height', WIDTH_AND_HEIGHT: 'auto-width', NONE: 'fixed', TRUNCATE: 'fixed' })[textAutoResize] || 'fixed';
  if (source.textAutoResize && !['HEIGHT', 'WIDTH_AND_HEIGHT', 'NONE', 'TRUNCATE'].includes(textAutoResize)) {
    warn(context.report, 'flattened', 'TEXT_FIT', source.name, 'This text resizing mode was reduced to a fixed text box.');
  }
  let textTruncation;
  if (source.textTruncation != null) {
    const truncation = String(source.textTruncation).toUpperCase();
    textTruncation = ({ DISABLED: 'disabled', ENDING: 'ending' })[truncation];
    if (!textTruncation) warn(context.report, 'flattened', 'TEXT_TRUNCATION', source.name, 'This text truncation mode is unknown and was disabled.');
  }
  if (!textTruncation && textAutoResize === 'TRUNCATE') textTruncation = 'ending';
  let maxLines;
  if (Object.hasOwn(source, 'maxLines')) {
    if (source.maxLines === null) maxLines = null;
    else if (Number.isSafeInteger(source.maxLines) && source.maxLines >= 1) maxLines = source.maxLines;
    else warn(context.report, 'flattened', 'TEXT_MAX_LINES', source.name, 'The text maximum line count was invalid and was omitted.');
    if (maxLines != null && textTruncation !== 'ending') {
      warn(context.report, 'flattened', 'TEXT_MAX_LINES', source.name, 'A maximum line count requires ending truncation and was omitted.');
      maxLines = undefined;
    }
  }
  const properties = {
    // Layer paint opacity stays attached to each imported fill. The legacy
    // `color` field remains as a fallback for older local documents and runs.
    opacity: finite(source.opacity, 1, 0, 1),
    text: characters,
    fontFamily,
    fontSize,
    fontWeight,
    fontStyle: style.italic === true || source.italic === true || String(style.fontStyle || '').toUpperCase() === 'ITALIC' || /italic/iu.test(String(style.italic || source.italic || namedStyle)) ? 'italic' : 'normal',
    lineHeight: lineHeight.value,
    lineHeightUnit: lineHeight.unit,
    letterSpacing,
    color,
    align: ({ LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' })[String(source.textAlignHorizontal || '').toUpperCase()] || 'left',
    verticalAlign,
    textFit,
    textWrapStyle,
    ...(paragraphStyles ? { paragraphStyles } : {}),
    ...(textTruncation ? { textTruncation } : {}),
    ...(maxLines !== undefined ? { maxLines } : {}),
    textDecoration: ({ UNDERLINE: 'underline', STRIKETHROUGH: 'line-through', NONE: 'none' })[String(source.textDecoration || style.textDecoration || '').toUpperCase()] || 'none',
    paragraphSpacing: finite(source.paragraphSpacing, 0, 0, 10_000),
    firstLineIndent: finite(source.firstLineIndent, 0, 0, 10_000),
    listSpacing: finite(source.listSpacing, 0, 0, 10_000)
  };
  const textRuns = textRunsFromFigOverrides(source, characters, properties, context);
  return textRuns ? { ...properties, textRuns } : properties;
}

function mapConstraints(source, report) {
  if (!source?.constraints || typeof source.constraints !== 'object') return null;
  const constraint = (value, axis) => ({
    MIN: axis === 'horizontal' ? 'left' : 'top',
    MAX: axis === 'horizontal' ? 'right' : 'bottom',
    STRETCH: axis === 'horizontal' ? 'left-right' : 'top-bottom',
    CENTER: 'center', SCALE: 'scale'
  })[String(value || '').toUpperCase()];
  const horizontal = constraint(source.constraints.horizontal, 'horizontal');
  const vertical = constraint(source.constraints.vertical, 'vertical');
  if (!horizontal || !vertical) {
    warn(report, 'flattened', 'CONSTRAINTS', source.name, 'Unknown resize constraints were reset to the local defaults.');
    return null;
  }
  return { horizontal, vertical };
}

function isValidBooleanChildren(children) {
  const operands = new Set(['rectangle', 'ellipse', 'star', 'polygon', 'path', 'network', 'text', 'boolean']);
  return Array.isArray(children) && children.length >= 2 && children.every(child => operands.has(child.type)
    && (child.type !== 'path' || [{ points: child.points, closed: child.closed }, ...(child.subpaths || [])]
      .every(path => path.closed === true && Array.isArray(path.points) && path.points.length >= 2))
    && (child.type !== 'network' || child.faces?.length > 0));
}

const stackEnumValues = {
  stackMode: ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'],
  stackPrimarySizing: ['FIXED', 'RESIZE_TO_FIT', 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE'],
  stackCounterSizing: ['FIXED', 'RESIZE_TO_FIT', 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE'],
  stackPrimaryAlignItems: ['MIN', 'CENTER', 'MAX', 'SPACE_EVENLY', 'SPACE_BETWEEN'],
  stackCounterAlignItems: ['MIN', 'CENTER', 'MAX', 'BASELINE'],
  stackChildAlignSelf: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'AUTO', 'BASELINE'],
  stackPositioning: ['AUTO', 'ABSOLUTE'],
  stackWrap: ['NO_WRAP', 'WRAP'],
  stackCounterAlignContent: ['AUTO', 'SPACE_BETWEEN']
};

const gridEnumValues = {
  gridChildHorizontalAlign: ['AUTO', 'MIN', 'CENTER', 'MAX'],
  gridChildVerticalAlign: ['AUTO', 'MIN', 'CENTER', 'MAX'],
  gridAutoTracks: ['NONE', 'ROWS'],
  gridTrackSizingType: ['FLEX', 'FIXED', 'HUG']
};

function stackEnum(source, property) {
  const value = source?.[property];
  if (typeof value === 'string') return value.toUpperCase();
  if (Number.isInteger(value) && value >= 0) return stackEnumValues[property]?.[value] || null;
  return null;
}

function gridEnum(source, property) {
  const value = source?.[property];
  if (typeof value === 'string') return value.toUpperCase();
  if (Number.isInteger(value) && value >= 0) return gridEnumValues[property]?.[value] || null;
  return null;
}

function mapStackSizing(source, property, report, name) {
  const value = stackEnum(source, property);
  if (!value) return 'fixed';
  if (value === 'FIXED') return 'fixed';
  if (['RESIZE_TO_FIT', 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE'].includes(value)) return 'hug';
  warn(report, 'flattened', 'AUTO_LAYOUT_SIZING', name, `The ${property} value ${value} was kept at its imported frame size.`);
  return 'fixed';
}

function mapPrimaryAlignment(source, report, name) {
  const value = stackEnum(source, 'stackPrimaryAlignItems');
  const alignment = ({ MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'space-between', SPACE_AROUND: 'space-around', SPACE_EVENLY: 'space-evenly' })[value];
  if (alignment) return alignment;
  if (value) warn(report, 'flattened', 'AUTO_LAYOUT_ALIGNMENT', name, `Primary-axis alignment ${value} was reset to start.`);
  return 'start';
}

function mapCounterAlignment(source, report, name) {
  const value = stackEnum(source, 'stackCounterAlignItems');
  const alignment = ({ MIN: 'start', CENTER: 'center', MAX: 'end', STRETCH: 'stretch', AUTO: 'start' })[value];
  if (alignment) return alignment;
  if (value) warn(report, 'flattened', 'AUTO_LAYOUT_ALIGNMENT', name, `Counter-axis alignment ${value} was reset to start.`);
  return 'start';
}

function finiteLayoutMetric(source, property, fallback, report, name, { min = 0, max = 100_000, warning = 'AUTO_LAYOUT_METRIC' } = {}) {
  if (source?.[property] == null) return fallback;
  const value = Number(source[property]);
  if (!Number.isFinite(value) || value < min || value > max) {
    warn(report, 'flattened', warning, name, `${property} was outside the supported range and was reset to ${fallback}.`);
    return fallback;
  }
  return value;
}

function autoLayoutAxis(source) {
  const mode = stackEnum(source, 'stackMode');
  return mode === 'HORIZONTAL' ? 'horizontal' : mode === 'VERTICAL' ? 'vertical' : mode === 'GRID' ? 'grid' : null;
}

function supportsStackAutoLayout(source) {
  return ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SYMBOL'].includes(source?.type) && Boolean(autoLayoutAxis(source));
}

function mapAutoLayoutPadding(source, report, name) {
  const uniformPadding = typeof source.stackPadding === 'object' && source.stackPadding
    ? null : finiteLayoutMetric(source, 'stackPadding', 0, report, name, { warning: 'AUTO_LAYOUT_PADDING' });
  const horizontalPadding = finiteLayoutMetric(source, 'stackHorizontalPadding', uniformPadding ?? 0, report, name, { warning: 'AUTO_LAYOUT_PADDING' });
  const verticalPadding = finiteLayoutMetric(source, 'stackVerticalPadding', uniformPadding ?? 0, report, name, { warning: 'AUTO_LAYOUT_PADDING' });
  const objectPadding = typeof source.stackPadding === 'object' && source.stackPadding ? source.stackPadding : {};
  return {
    left: finiteLayoutMetric({ stackPaddingLeft: source.stackPaddingLeft ?? objectPadding.left ?? horizontalPadding }, 'stackPaddingLeft', horizontalPadding, report, name, { warning: 'AUTO_LAYOUT_PADDING' }),
    right: finiteLayoutMetric({ stackPaddingRight: source.stackPaddingRight ?? objectPadding.right ?? horizontalPadding }, 'stackPaddingRight', horizontalPadding, report, name, { warning: 'AUTO_LAYOUT_PADDING' }),
    top: finiteLayoutMetric({ stackPaddingTop: source.stackPaddingTop ?? objectPadding.top ?? verticalPadding }, 'stackPaddingTop', verticalPadding, report, name, { warning: 'AUTO_LAYOUT_PADDING' }),
    bottom: finiteLayoutMetric({ stackPaddingBottom: source.stackPaddingBottom ?? objectPadding.bottom ?? verticalPadding }, 'stackPaddingBottom', verticalPadding, report, name, { warning: 'AUTO_LAYOUT_PADDING' })
  };
}

function gridPositionEntries(source, property, report, name) {
  const value = source?.[property];
  if (value == null) return [];
  const entries = Array.isArray(value) ? value : value?.entries;
  if (!Array.isArray(entries)) {
    warn(report, 'flattened', 'AUTO_LAYOUT_GRID_TRACKS', name, `${property} could not be decoded; default grid tracks were used.`);
    return [];
  }
  if (entries.length > 64) warn(report, 'flattened', 'AUTO_LAYOUT_GRID_TRACKS', name, `${property} has more than 64 tracks; only the first 64 ordered tracks were imported.`);
  const valid = [];
  for (const entry of entries.slice(0, 4096)) {
    const id = guidKey(entry?.id);
    if (!id || typeof entry.position !== 'string') {
      warn(report, 'flattened', 'AUTO_LAYOUT_GRID_TRACKS', name, `${property} contains an invalid track identity or order and that track was omitted.`);
      continue;
    }
    valid.push({ id, position: entry.position });
  }
  valid.sort((left, right) => left.position < right.position ? -1 : left.position > right.position ? 1 : 0);
  return valid.slice(0, 64);
}

function gridTrackSizingFunction(value, report, name) {
  if (!value || typeof value !== 'object') return null;
  const rawType = value.type;
  const type = typeof rawType === 'string' ? rawType.toUpperCase()
    : Number.isInteger(rawType) && rawType >= 0 ? gridEnumValues.gridTrackSizingType[rawType] || null : null;
  if (!['FLEX', 'FIXED', 'HUG'].includes(type)) {
    warn(report, 'flattened', 'AUTO_LAYOUT_GRID_TRACK_SIZE', name, 'A grid track sizing type was unknown and the local default track size was used.');
    return null;
  }
  if (type === 'HUG') return { mode: 'hug' };
  const raw = Number(value.value ?? (type === 'FLEX' ? 1 : 0));
  if (!Number.isFinite(raw) || raw < 0 || raw > 100_000 || (type === 'FLEX' && raw === 0)) {
    warn(report, 'flattened', 'AUTO_LAYOUT_GRID_TRACK_SIZE', name, 'A grid track size was outside the supported range and the local default track size was used.');
    return null;
  }
  return type === 'FLEX' ? { mode: 'fill', weight: Math.max(0.01, raw) } : { mode: 'fixed', value: raw };
}

function mapGridTrackSize(source, report, name) {
  if (!source || typeof source !== 'object') return null;
  // Older exports may store the public type/value pair directly.
  if (source.type != null && source.minSizing == null && source.maxSizing == null) {
    return gridTrackSizingFunction(source, report, name);
  }
  const minimum = gridTrackSizingFunction(source.minSizing, report, name);
  const maximum = gridTrackSizingFunction(source.maxSizing, report, name);
  if (!minimum && !maximum) return null;
  if (Boolean(minimum) !== Boolean(maximum)) {
    warn(report, 'flattened', 'AUTO_LAYOUT_GRID_TRACK_BOUNDS', name, 'This grid track has only one valid min/max sizing function; the available value was used.');
  }
  if (!minimum || !maximum) return maximum || minimum;
  const sameSizing = minimum.mode === maximum.mode
    && (minimum.mode === 'fixed' ? minimum.value === maximum.value
      : minimum.mode === 'fill' ? minimum.weight === maximum.weight : true);
  if (sameSizing) return maximum;

  // Local tracks preserve fixed-pixel, content-based, and fractional lower
  // bounds alongside a flexible maximum sizing function.
  if (minimum.mode === 'fill') {
    if (maximum.mode === 'fill' && minimum.weight <= maximum.weight) {
      return { ...maximum, minWeight: minimum.weight };
    }
    warn(report, 'flattened', 'AUTO_LAYOUT_GRID_TRACK_BOUNDS', name, 'This flexible minimum track bound exceeds or conflicts with the maximum sizing function; the maximum sizing function was used.');
    return maximum;
  }
  if (minimum.mode === 'fixed' && maximum.mode === 'fixed' && minimum.value > maximum.value) {
    warn(report, 'flattened', 'AUTO_LAYOUT_GRID_TRACK_BOUNDS', name, 'This grid track minimum exceeds its fixed maximum; the maximum sizing function was used.');
    return maximum;
  }
  return {
    ...maximum,
    ...(minimum.mode === 'fixed' ? { minSize: minimum.value } : { minContent: true })
  };
}

function gridTrackDefinitions(source, property, orderedTracks, report, name) {
  const value = source?.[property];
  if (value == null) return [];
  const entries = Array.isArray(value) ? value : value?.entries;
  if (!Array.isArray(entries)) {
    warn(report, 'flattened', 'AUTO_LAYOUT_GRID_TRACKS', name, `${property} could not be decoded; default grid track sizes were used.`);
    return [];
  }
  const byId = new Map();
  for (const entry of entries.slice(0, 4096)) {
    const id = guidKey(entry?.id);
    if (!id || byId.has(id)) {
      warn(report, 'flattened', 'AUTO_LAYOUT_GRID_TRACKS', name, `${property} contains an invalid or duplicate track size; the affected entry was ignored.`);
      continue;
    }
    byId.set(id, mapGridTrackSize(entry.trackSize || entry.size || entry, report, name));
  }
  return orderedTracks.map(track => byId.get(track.id) || undefined);
}

function gridAnchorIndex(anchor, tracks) {
  const key = guidKey(anchor);
  return key ? tracks.findIndex(track => track.id === key) : -1;
}

function gridTracksForParent(source, context, report, name) {
  let tracks = context.gridTracksByParent.get(source);
  if (!tracks) {
    tracks = {
      columns: gridPositionEntries(source, 'gridColumns', report, name),
      rows: gridPositionEntries(source, 'gridRows', report, name)
    };
    context.gridTracksByParent.set(source, tracks);
  }
  return tracks;
}

function mapGridAutoLayout(source, report, name) {
  const columns = gridPositionEntries(source, 'gridColumns', report, name);
  const rows = gridPositionEntries(source, 'gridRows', report, name);
  const autoTracks = gridEnum(source, 'gridAutoTracks');
  const rowMode = autoTracks || 'NONE';
  if (autoTracks && !['NONE', 'ROWS'].includes(autoTracks)) {
    warn(report, 'flattened', 'AUTO_LAYOUT_GRID_ROWS', name, `Grid automatic-track mode ${autoTracks} was reset to fixed rows.`);
  }
  const reflow = source.gridReflowEnabled;
  if (reflow != null && typeof reflow !== 'boolean') warn(report, 'flattened', 'AUTO_LAYOUT_GRID_FLOW', name, 'The automatic grid-positioning setting was invalid; row-major flow was used.');
  const columnTracks = gridTrackDefinitions(source, 'gridColumnsSizing', columns, report, name);
  const rowTracks = gridTrackDefinitions(source, 'gridRowsSizing', rows, report, name);
  const rowGap = finiteLayoutMetric(source, 'gridRowGap', 0, report, name, { warning: 'AUTO_LAYOUT_GRID_GAP' });
  const columnGap = finiteLayoutMetric(source, 'gridColumnGap', 0, report, name, { warning: 'AUTO_LAYOUT_GRID_GAP' });
  return createAutoLayout({
    axis: 'grid', columns: Math.max(1, columns.length), rows: rowMode === 'ROWS' ? 'auto' : Math.max(1, rows.length),
    rowGap, columnGap, gap: columnGap, padding: mapAutoLayoutPadding(source, report, name),
    rowTracks, columnTracks, autoPositioning: typeof reflow === 'boolean' ? reflow : true
  });
}

function mapAutoLayout(source, report, name) {
  const mode = stackEnum(source, 'stackMode');
  const axis = autoLayoutAxis(source);
  if (!axis) {
    if (mode && mode !== 'NONE') warn(report, 'flattened', 'AUTO_LAYOUT', name, `Auto-layout mode ${mode} was flattened to the imported positions.`);
    return null;
  }

  if (axis === 'grid') return mapGridAutoLayout(source, report, name);

  const padding = mapAutoLayoutPadding(source, report, name);
  const gap = finiteLayoutMetric(source, 'stackSpacing', 0, report, name, { min: -100_000, warning: 'AUTO_LAYOUT_GAP' });
  const counterGap = finiteLayoutMetric(source, 'stackCounterSpacing', gap, report, name, { warning: 'AUTO_LAYOUT_GAP' });
  const wrapValue = stackEnum(source, 'stackWrap');
  const wrap = wrapValue === 'WRAP';
  if (wrapValue && !['WRAP', 'NO_WRAP'].includes(wrapValue)) warn(report, 'flattened', 'AUTO_LAYOUT_WRAP', name, `Wrap mode ${wrapValue} was reset to no-wrap.`);
  const contentAlignment = stackEnum(source, 'stackCounterAlignContent');
  const wrapDistribution = contentAlignment === 'SPACE_BETWEEN' ? 'space-between' : 'start';
  if (wrap && contentAlignment && !['AUTO', 'SPACE_BETWEEN'].includes(contentAlignment)) {
    warn(report, 'flattened', 'AUTO_LAYOUT_WRAP_ALIGNMENT', name, 'Wrapped-track distribution was reset to the local start alignment.');
  }

  return createAutoLayout({
    axis,
    gap,
    columnGap: axis === 'horizontal' ? gap : counterGap,
    rowGap: axis === 'vertical' ? gap : counterGap,
    padding,
    align: mapCounterAlignment(source, report, name),
    justify: mapPrimaryAlignment(source, report, name),
    mainSizing: mapStackSizing(source, 'stackPrimarySizing', report, name),
    crossSizing: mapStackSizing(source, 'stackCounterSizing', report, name),
    wrap,
    wrapDistribution,
    autoPositioning: true
  });
}

function mapChildAutoLayout(source, parentSource, overrides, report, name, context) {
  if (!supportsStackAutoLayout(parentSource)) return;
  const parentAxis = autoLayoutAxis(parentSource);
  const positioning = stackEnum(source, 'stackPositioning');
  if (positioning === 'ABSOLUTE') overrides.layoutPositioning = 'absolute';
  else if (positioning && positioning !== 'AUTO') warn(report, 'flattened', 'AUTO_LAYOUT_POSITION', name, `Positioning mode ${positioning} was kept in the auto-layout flow.`);

  if (parentAxis === 'grid') {
    if (overrides.layoutPositioning === 'absolute') return;
    const { columns, rows } = gridTracksForParent(parentSource, context, report, name);
    const column = gridAnchorIndex(source.gridColumnAnchor, columns);
    const row = gridAnchorIndex(source.gridRowAnchor, rows);
    const cell = {};
    if (column >= 0) cell.column = column + 1;
    else if (source.gridColumnAnchor != null && !parentSource.gridReflowEnabled) warn(report, 'flattened', 'AUTO_LAYOUT_GRID_PLACEMENT', name, 'The explicit grid column anchor could not be matched; the layer will use the next available cell.');
    if (row >= 0) cell.row = row + 1;
    else if (source.gridRowAnchor != null && !parentSource.gridReflowEnabled) warn(report, 'flattened', 'AUTO_LAYOUT_GRID_PLACEMENT', name, 'The explicit grid row anchor could not be matched; the layer will use the next available cell.');
    for (const [key, sourceKey] of [['rowSpan', 'gridRowSpan'], ['columnSpan', 'gridColumnSpan']]) {
      if (source[sourceKey] == null) continue;
      const value = Number(source[sourceKey]);
      if (Number.isInteger(value) && value >= 1 && value <= 64) cell[key] = value;
      else warn(report, 'flattened', 'AUTO_LAYOUT_GRID_SPAN', name, `${sourceKey} was invalid and the default span of 1 was used.`);
    }
    for (const [key, sourceKey] of [['alignX', 'gridChildHorizontalAlign'], ['alignY', 'gridChildVerticalAlign']]) {
      const alignment = gridEnum(source, sourceKey);
      const mapped = ({ MIN: 'start', CENTER: 'center', MAX: 'end' })[alignment];
      if (mapped) cell[key] = mapped;
      else if (alignment && alignment !== 'AUTO') warn(report, 'flattened', 'AUTO_LAYOUT_GRID_ALIGNMENT', name, `${sourceKey} value ${alignment} uses the default cell alignment.`);
    }
    if (Object.keys(cell).length) overrides.gridCell = cell;
    for (const [sourceKey, targetKey] of [['layoutSizingHorizontal', 'layoutSizingX'], ['layoutSizingVertical', 'layoutSizingY']]) {
      if (source[sourceKey] == null) continue;
      const sizing = String(source[sourceKey]).toUpperCase();
      if (sizing === 'FILL') overrides[targetKey] = 'fill';
      else if (sizing === 'FIXED') overrides[targetKey] = 'fixed';
      else if (sizing === 'HUG') {
        // The local grid model has no content-sized child mode. Keep the
        // imported dimensions and explain the sizing simplification.
        overrides[targetKey] = 'fixed';
        warn(report, 'flattened', 'AUTO_LAYOUT_GRID_SIZING', name, `${sourceKey} HUG sizing was kept at the imported layer size.`);
      } else {
        warn(report, 'flattened', 'AUTO_LAYOUT_GRID_SIZING', name, `${sourceKey} value ${sizing.slice(0, 80)} was kept at the imported layer size.`);
      }
    }
    if (source.stackChildPrimaryGrow != null && Number(source.stackChildPrimaryGrow) > 0) {
      warn(report, 'flattened', 'AUTO_LAYOUT_GRID_SIZING', name, 'Grid fill sizing could not be inferred from the flex growth field; imported layer size was preserved.');
    }
    for (const [sourceKey, minKey, maxKey] of [['minSize', 'minWidth', 'minHeight'], ['maxSize', 'maxWidth', 'maxHeight']]) {
      const value = source[sourceKey];
      if (!value || typeof value !== 'object') continue;
      for (const [coordinate, target] of [['x', minKey], ['y', maxKey]]) {
        const metric = value[coordinate];
        if (metric == null) continue;
        if (Number.isFinite(Number(metric)) && Number(metric) >= 0 && Number(metric) <= 100_000) overrides[target] = Number(metric);
        else warn(report, 'flattened', 'AUTO_LAYOUT_SIZE_LIMIT', name, `${sourceKey}.${coordinate} was invalid and was omitted.`);
      }
    }
    return;
  }

  const grow = source.stackChildPrimaryGrow;
  if (grow != null) {
    const amount = Number(grow);
    if (Number.isFinite(amount) && amount > 0) overrides.layoutSizingMain = 'fill';
    else if (!Number.isFinite(amount) || amount < 0) warn(report, 'flattened', 'AUTO_LAYOUT_SIZING', name, 'Invalid primary-axis growth was reset to fixed sizing.');
  }
  const self = stackEnum(source, 'stackChildAlignSelf');
  const alignSelf = ({ INHERIT: 'auto', AUTO: 'auto', MIN: 'start', CENTER: 'center', MAX: 'end', STRETCH: 'stretch' })[self];
  if (alignSelf) overrides.layoutAlignSelf = alignSelf;
  else if (self) warn(report, 'flattened', 'AUTO_LAYOUT_ALIGNMENT', name, `Child alignment ${self} follows the parent alignment.`);

  for (const [sourceKey, minKey, maxKey] of [['minSize', 'minWidth', 'minHeight'], ['maxSize', 'maxWidth', 'maxHeight']]) {
    const value = source[sourceKey];
    if (!value || typeof value !== 'object') continue;
    for (const [coordinate, target] of [['x', minKey], ['y', maxKey]]) {
      const metric = value[coordinate];
      if (metric == null) continue;
      if (Number.isFinite(Number(metric)) && Number(metric) >= 0 && Number(metric) <= 100_000) overrides[target] = Number(metric);
      else warn(report, 'flattened', 'AUTO_LAYOUT_SIZE_LIMIT', name, `${sourceKey}.${coordinate} was invalid and was omitted.`);
    }
  }
}

function createImportedNode(source, type, overrides) {
  // Lock state is a first-class Figma layer property. Keep it on every
  // converted node (including editable fallbacks) so the imported hierarchy
  // does not silently become easier to mutate than the source design.
  return createNode(type, { ...overrides, locked: source.locked === true });
}

function mapEllipseArcData(source, report, name) {
  const arcData = source.arcData;
  if (arcData == null) return null;
  const validRecord = arcData && typeof arcData === 'object' && !Array.isArray(arcData);
  const { startingAngle, endingAngle, innerRadius } = validRecord ? arcData : {};
  const valid = validRecord
    && Number.isFinite(startingAngle)
    && Number.isFinite(endingAngle)
    && Number.isFinite(innerRadius)
    && startingAngle >= 0 && startingAngle <= Math.PI * 2
    && endingAngle >= 0 && endingAngle <= Math.PI * 2
    && innerRadius >= 0 && innerRadius <= 1;
  if (!valid) {
    warn(report, 'flattened', 'ELLIPSE_ARC', name,
      'The ellipse arc settings were invalid or outside the supported angle/radius range; the layer was imported as a full ellipse.');
    return null;
  }
  return { startingAngle, endingAngle, innerRadius };
}

function createLayer(source, children, context, pageId, depth = 0, parentSource = null) {
  const type = modelType(source.type);
  const name = safeName(source.name, source.type || 'Imported layer');
  if (source.visible === false && source.type === 'CANVAS') return null;
  if (depth >= MAX_DOCUMENT_TREE_DEPTH) {
    warn(context.report, 'unsupported', source.type || 'NODE', name, 'This node exceeds the local layer nesting limit.');
    return null;
  }
  if (context.visited.has(source)) {
    warn(context.report, 'unsupported', source.type || 'NODE', name, 'This node is referenced more than once; the duplicate was skipped.');
    return null;
  }
  context.visited.add(source);

  if (source.type === 'VECTOR') {
    const vectorData = source.vectorData || {};
    const geometry = [
      ...(Array.isArray(source.fillGeometry) ? source.fillGeometry : []),
      ...(Array.isArray(source.strokeGeometry) ? source.strokeGeometry : [])
    ];
    if (geometry.length > MAX_VECTOR_GEOMETRY_ENTRIES) {
      warn(context.report, 'unsupported', 'VECTOR', name, 'This vector has too many separate geometry paths.');
      return null;
    }
    const blobIndices = new Set(geometry.map(entry => entry?.commandsBlob).filter(Number.isSafeInteger));
    if (Number.isSafeInteger(vectorData.vectorNetworkBlob)) blobIndices.add(vectorData.vectorNetworkBlob);
    let vectorBytes = 0;
    for (const blobIndex of blobIndices) {
      const blob = getBlobBytes(context.parsed, blobIndex);
      if (!(blob instanceof Uint8Array) || blob.byteLength > MAX_VECTOR_BLOB_BYTES) {
        warn(context.report, 'unsupported', 'VECTOR', name, 'This vector geometry is missing or exceeds the safe size limit.');
        return null;
      }
      vectorBytes += blob.byteLength;
    }
    if (context.totalVectorSourceBytes + vectorBytes > MAX_VECTOR_SOURCE_BYTES) {
      warn(context.report, 'unsupported', 'VECTOR', name, 'The file exceeds the safe total vector geometry limit.');
      return null;
    }
    context.totalVectorSourceBytes += vectorBytes;
    let paths = { fill: [], stroke: [] };
    try { paths = resolveVectorNodePaths(context.parsed, source); }
    catch { warn(context.report, 'unsupported', 'VECTOR', name, 'Its vector data could not be resolved.'); }
    const transform = localTransform(source, context.report);
    let importedNetwork = null;
    if (Number.isSafeInteger(vectorData.vectorNetworkBlob)) {
      try {
        const bytes = getBlobBytes(context.parsed, vectorData.vectorNetworkBlob);
        importedNetwork = editableFigVectorNetwork(source, parseVectorNetworkBlob(bytes), paths.fill);
      } catch { /* The resolved path fallback remains available. */ }
    }
    const visibleStrokePaint = (source.strokePaints || []).some(paint => paint?.visible !== false && paintOpacity(paint) > 0);
    const editableStrokeStyles = !visibleStrokePaint
      || (['CENTER', undefined, null].includes(source.strokeAlign)
        && !(Array.isArray(source.dashPattern) && source.dashPattern.length)
        && (!source.strokeCap || ['NONE', 'ROUND', 'SQUARE', 'BUTT', 'ARROW_LINES', 'LINE_ARROW', 'ARROW_EQUILATERAL', 'TRIANGLE_ARROW', 'TRIANGLE_FILLED', 'DIAMOND_FILLED', 'CIRCLE_FILLED'].includes(String(source.strokeCap).toUpperCase()))
        && (!source.strokeJoin || ['ROUND', 'BEVEL', 'MITER'].includes(String(source.strokeJoin).toUpperCase())));
    const directNetworkPathChars = paths.fill.reduce((total, path) => total + (path?.svgPath?.length ?? 0), 0);
    const editableNetworkPathsFitBudget = paths.fill.length > 0
      && paths.fill.every(path => typeof path?.svgPath === 'string' && path.svgPath.length <= MAX_VECTOR_PATH_CHARS)
      && context.totalVectorPathChars + directNetworkPathChars <= MAX_VECTOR_PATH_SOURCE_CHARS;
    if (importedNetwork && editableNetworkPathsFitBudget && editableStrokeStyles && paths.stroke.length === 0) {
      context.totalVectorPathChars += directNetworkPathChars;
      const overrides = {
        name, ...transform, width: finite(source.size?.x, 0, 0, 1_000_000), height: finite(source.size?.y, 0, 0, 1_000_000),
        visible: source.visible !== false, opacity: finite(source.opacity, 1, 0, 1),
        ...importedNetwork,
        fills: mapPaints(source.fillPaints, source, context),
        strokes: mapStrokes(source.strokePaints, source, context.report)
      };
      mapLayerBlendMode(source, overrides, context.report, name);
      const effects = mapLayerEffects(source.effects, source, context.report);
      if (effects.length) overrides.effects = effects;
      mapChildAutoLayout(source, parentSource, overrides, context.report, name, context);
      mapFixedPositionWhenScrolling(source, parentSource, overrides);
      context.report.importedNodes += 1;
      return createImportedNode(source, 'network', overrides);
    }
    const overrides = {
      name, ...transform, width: finite(source.size?.x, 0, 0, 1_000_000), height: finite(source.size?.y, 0, 0, 1_000_000),
      visible: source.visible !== false, opacity: finite(source.opacity, 1, 0, 1), children: vectorChildren(source, paths, context)
    };
    mapLayerBlendMode(source, overrides, context.report, name);
    const effects = mapLayerEffects(source.effects, source, context.report);
    if (effects.length) overrides.effects = effects;
    mapChildAutoLayout(source, parentSource, overrides, context.report, name, context);
    mapFixedPositionWhenScrolling(source, parentSource, overrides);
    const node = createImportedNode(source, 'group', {
      ...overrides
    });
    if (!node.children.length) {
      warn(context.report, 'unsupported', 'VECTOR', name, 'This vector contains no editable paths.');
      return null;
    }
    context.report.importedNodes += 1;
    return node;
  }

  if (!type) {
    if (children?.length) {
      const transform = localTransform(source, context.report);
      const overrides = {
        name, ...transform, width: finite(source.size?.x, 0, 0, 1_000_000), height: finite(source.size?.y, 0, 0, 1_000_000),
        visible: source.visible !== false, opacity: finite(source.opacity, 1, 0, 1), children
      };
      mapLayerBlendMode(source, overrides, context.report, name);
      const effects = mapLayerEffects(source.effects, source, context.report);
      if (effects.length) overrides.effects = effects;
      mapChildAutoLayout(source, parentSource, overrides, context.report, name, context);
      mapFixedPositionWhenScrolling(source, parentSource, overrides);
      const node = createImportedNode(source, 'group', overrides);
      warn(context.report, 'flattened', source.type || 'NODE', name, 'An unsupported container was kept as an editable group so its children remain available.');
      context.report.importedNodes += 1;
      return node;
    }
    warn(context.report, 'unsupported', source.type || 'NODE', name, 'This visible layer type was omitted.');
    return null;
  }

  const transform = localTransform(source, context.report);
  const width = finite(source.size?.x, type === 'line' ? 0 : 1, 0, 1_000_000);
  const height = finite(source.size?.y, type === 'line' ? 0 : 1, 0, 1_000_000);
  const overrides = {
    name, ...transform, width, height,
    opacity: finite(source.opacity, 1, 0, 1), visible: source.visible !== false,
    children: ['frame', 'group', 'section', 'boolean'].includes(type) ? (children || []) : []
  };
  mapLayerBlendMode(source, overrides, context.report, name);
  const fills = type === 'line' ? [] : mapPaints(source.fillPaints, source, context);
  if (type === 'line' && Array.isArray(source.fillPaints) && source.fillPaints.some(paint => paint?.visible !== false)) {
    warn(context.report, 'unsupported', 'LINE_FILL', name, 'Fill paints on lines are not supported by the local editor.');
  }
  let strokes = mapStrokes(source.strokePaints, source, context.report);
  if (type === 'boolean' && strokes.length) {
    warn(context.report, 'unsupported', 'STROKE', name, 'Strokes on Boolean groups are not supported by the local editor.');
    strokes = [];
  }
  if (fills.length) overrides.fills = fills;
  else if (['frame', 'section', 'rectangle', 'ellipse', 'star', 'polygon', 'boolean'].includes(type)) overrides.fill = 'transparent';
  if (strokes.length) overrides.strokes = strokes;
  else { overrides.stroke = null; overrides.strokeWidth = 0; }
  const effects = mapLayerEffects(source.effects, source, context.report);
  if (effects.length) overrides.effects = effects;
  if (source.type === 'FRAME') {
    overrides.clip = typeof source.clipsContent === 'boolean'
      ? source.clipsContent
      : typeof source.frameMaskDisabled === 'boolean' ? !source.frameMaskDisabled : false;
    const autoLayout = mapAutoLayout(source, context.report, name);
    if (autoLayout) overrides.autoLayout = autoLayout;
  }
  if (['COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SYMBOL'].includes(source.type)) {
    const autoLayout = mapAutoLayout(source, context.report, name);
    if (autoLayout) overrides.autoLayout = autoLayout;
  }
  mapChildAutoLayout(source, parentSource, overrides, context.report, name, context);
  mapFixedPositionWhenScrolling(source, parentSource, overrides);
  const constraints = mapConstraints(source, context.report);
  if (constraints) overrides.constraints = constraints;
  if (source.type === 'RECTANGLE' || source.type === 'ROUNDED_RECTANGLE' || source.type === 'FRAME') {
    const radii = source.rectangleCornerRadii;
    if (Array.isArray(radii) && radii.length === 4 && radii.every(Number.isFinite)) {
      overrides.cornerRadii = {
        topLeft: finite(radii[0], 0, 0, 100_000), topRight: finite(radii[1], 0, 0, 100_000),
        bottomRight: finite(radii[2], 0, 0, 100_000), bottomLeft: finite(radii[3], 0, 0, 100_000)
      };
      overrides.radius = 0;
    } else overrides.radius = finite(source.cornerRadius, 0, 0, 100_000);
  }
  if (['rectangle', 'frame', 'section', 'image', 'star', 'polygon'].includes(type) && Number.isFinite(source.cornerSmoothing)) {
    overrides.cornerSmoothing = finite(source.cornerSmoothing, 0, 0, 1);
  }
  if (['star', 'polygon'].includes(type)) overrides.radius = finite(source.cornerRadius, 0, 0, 100_000);
  if (type === 'star') {
    overrides.points = finite(source.pointCount, 5, MIN_STAR_POINTS, MAX_STAR_POINTS);
    overrides.innerRadius = finite(source.starInnerRadius, 0.48, 0, 1);
  }
  if (type === 'polygon') overrides.points = finite(source.pointCount, 6, MIN_STAR_POINTS, MAX_POLYGON_POINTS);
  if (type === 'ellipse') {
    const arcData = mapEllipseArcData(source, context.report, name);
    if (arcData) overrides.arcData = arcData;
  }
  if (type === 'boolean') {
    const operation = String(source.booleanOperation || '').toUpperCase();
    overrides.operation = ({ UNION: 'union', SUBTRACT: 'subtract', INTERSECT: 'intersect', EXCLUDE: 'exclude' })[operation] || 'union';
    if (!source.booleanOperation) warn(context.report, 'flattened', 'BOOLEAN_OPERATION', name, 'The Boolean operation defaulted to union because its operator was missing.');
  }
  if (type === 'text') {
    Object.assign(overrides, textProperties(source, context));
    if (overrides.maxLines != null && overrides.maxHeight != null) {
      delete overrides.maxLines;
      warn(context.report, 'flattened', 'TEXT_MAX_LINES', name, 'The imported text has both a maximum line count and an auto-layout maximum height; the generic auto-layout size limit was preserved and the maximum line count was omitted.');
    }
    if (source.textData?.paragraphStyle && !hasOnlySupportedFigParagraphStyles(source, overrides.text, context.parsed?.schema)) warn(context.report, 'flattened', 'TEXT_PARAGRAPH', name,
      'Per-paragraph indentation, list, unsupported alignment, or other paragraph layout settings were simplified.');
  }
  if (source.type === 'LINE') overrides.fill = 'transparent';
  if (type === 'boolean' && !isValidBooleanChildren(overrides.children)) {
    warn(context.report, 'flattened', 'BOOLEAN_OPERATION', name, 'The Boolean operator could not be represented safely; its operands were kept in an editable group.');
    const { operation: _operation, ...groupOverrides } = overrides;
    const node = createImportedNode(source, 'group', groupOverrides);
    context.report.importedNodes += 1;
    return node;
  }
  const node = createImportedNode(source, type, overrides);
  const sourceId = idOf(source);
  if (sourceId) {
    context.convertedNodesBySourceId.set(sourceId, node);
    context.sourcePagesBySourceId.set(sourceId, pageId);
  }
  context.report.importedNodes += 1;
  return node;
}

const componentOverrideProperties = [
  'name', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'locked', 'fill', 'fills', 'fillOpacity', 'fillStyleId',
  'stroke', 'strokeWidth', 'strokeOpacity', 'strokeCap', 'strokeJoin', 'strokePattern', 'strokeDashArray', 'strokeMiterLimit', 'strokes', 'radius',
  'cornerRadii', 'cornerSmoothing', 'clip', 'mask', 'text', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'lineHeightUnit', 'letterSpacing',
  'paragraphSpacing', 'firstLineIndent', 'listSpacing', 'paragraphStyles', 'textWrapStyle', 'fontStyle', 'color', 'textRuns', 'textStyleId',
  'typographyStyleId', 'align', 'verticalAlign', 'textFit', 'textTruncation', 'maxLines', 'textCase', 'textDecoration', 'fit', 'adjustments', 'transforms',
  'constraints', 'autoLayout', 'fillVariableId', 'textVariableId', 'strokeVariableId', 'variableModes', 'variableBindings',
  'effects', 'fillGradient', 'imageFill', 'blendMode', 'layoutPositioning', 'layoutSizingMain', 'layoutSizingCross',
  'layoutAlignSelf', 'layoutSizingX', 'layoutSizingY', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'gridCell', 'fixedPositionWhenScrolling', 'scrollPosition', 'points',
  'subpaths', 'fillRule', 'innerRadius', 'arcData', 'lineReverseY', 'closed', 'vertices', 'edges', 'faces', 'operation', 'exportSettings',
  'outputFormat', 'outputQuality', 'layoutGuides'
];

function sourceComponentGuid(value) {
  if (typeof value === 'string' && /^\d+:\d+$/u.test(value)) return value;
  if (value && typeof value === 'object') return guidKey(value.guid || value);
  return null;
}

function mapFixedPositionWhenScrolling(source, parentSource, overrides) {
  const sourceId = idOf(source);
  const fixedByParent = sourceId && Array.isArray(parentSource?.fixedChildren)
    && parentSource.fixedChildren.some(reference => sourceComponentGuid(reference) === sourceId);
  const explicitPosition = ['scroll', 'fixed', 'sticky'].includes(source.scrollPosition)
    ? source.scrollPosition : null;
  if (explicitPosition) overrides.scrollPosition = explicitPosition;
  else if (source.fixedPositionWhenScrolling === true || fixedByParent) overrides.scrollPosition = 'fixed';
  if (explicitPosition) overrides.fixedPositionWhenScrolling = explicitPosition === 'fixed';
  else if (source.fixedPositionWhenScrolling === true || fixedByParent) overrides.fixedPositionWhenScrolling = true;
}

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function figPropertyDisplayName(sourceName) {
  return safeName(String(sourceName || '').replace(/#\d+:\d+$/u, ''), 'Imported property').slice(0, 80);
}

function sourcePropertyDefinitions(source) {
  const definitions = source?.componentPropertyDefinitions;
  return definitions && typeof definitions === 'object' && !Array.isArray(definitions)
    ? Object.entries(definitions).slice(0, 100) : [];
}

function sourceComponentPropertyTargets(rootSourceId, propertyName, referenceField, childrenMap, sourcesById) {
  const targets = [];
  const active = new Set();
  const visit = (sourceId, isRoot = false) => {
    if (!sourceId || active.has(sourceId)) return;
    const source = sourcesById.get(sourceId);
    if (!source) return;
    active.add(sourceId);
    if (source.componentPropertyReferences?.[referenceField] === propertyName) targets.push(source);
    // A nested instance owns a separate property namespace. The instance layer
    // itself may be this component's swap target, but its descendants are not.
    if (isRoot || !['INSTANCE', 'SYMBOL'].includes(source.type)) {
      for (const child of childrenMap.get(sourceId) || []) visit(idOf(child));
    }
    active.delete(sourceId);
  };
  visit(rootSourceId, true);
  return targets;
}

function localInstancePropertyTarget(root, targetSourceId) {
  let target = null;
  const visit = (node, isRoot = false) => {
    if (!node || target) return;
    if (node.componentSourceId === targetSourceId || node.nestedComponentSourceId === targetSourceId) {
      target = node;
      return;
    }
    if (!isRoot && node.isInstance) return;
    for (const child of node.children || []) visit(child);
  };
  visit(root, true);
  return target;
}

function sourceExposedInstances(rootSourceId, childrenMap, sourcesById) {
  const exposed = [];
  const active = new Set();
  const visit = (sourceId, isRoot = false) => {
    if (!sourceId || active.has(sourceId)) return;
    const source = sourcesById.get(sourceId);
    if (!source) return;
    active.add(sourceId);
    if (!isRoot && ['INSTANCE', 'SYMBOL'].includes(source.type)) {
      if (source.isExposedInstance === true) exposed.push(source);
    } else {
      for (const child of childrenMap.get(sourceId) || []) visit(idOf(child));
    }
    active.delete(sourceId);
  };
  visit(rootSourceId, true);
  return exposed;
}

function resolveImportedComponentId(value, sourcesById, componentsBySourceId, sourceComponentsByKey) {
  if (typeof value !== 'string' || !value) return null;
  const direct = componentsBySourceId.get(value);
  if (direct) return direct.id;
  const byKey = sourceComponentsByKey.get(value);
  if (byKey) return componentsBySourceId.get(byKey)?.id || null;
  const sourceId = sourceComponentGuid(value);
  if (sourceId && sourcesById.has(sourceId)) return componentsBySourceId.get(sourceId)?.id || null;
  return null;
}

function applyFigVariantDefinitions(document, sourceSet, localSet, childrenMap, sourcesById, componentsBySourceId, context) {
  const definitions = sourcePropertyDefinitions(sourceSet).filter(([, definition]) => definition?.type === 'VARIANT');
  if (!definitions.length) return;
  const properties = [];
  const sourceNames = new Set();
  for (const [sourceName, definition] of definitions) {
    const name = figPropertyDisplayName(sourceName);
    const values = Array.isArray(definition.variantOptions)
      ? [...new Set(definition.variantOptions.filter(value => typeof value === 'string').map(value => value.trim()))]
      : [];
    if (!name || sourceNames.has(sourceName) || !values.length || values.some(value => !value || value.length > 80 || /[\x00-\x1f\x7f]/u.test(value))) {
      warn(context.report, 'flattened', 'COMPONENT_VARIANT_PROPERTY', sourceSet.name,
        `Variant property “${name}” has invalid or missing options; the name-derived variant axes were retained.`);
      return;
    }
    sourceNames.add(sourceName);
    properties.push({ name, values });
  }
  const members = (childrenMap.get(idOf(sourceSet)) || [])
    .map(source => ({ source, component: componentsBySourceId.get(idOf(source)) }))
    .filter(({ source, component }) => ['COMPONENT', 'SYMBOL'].includes(source.type) && component?.componentSetId === localSet.id);
  if (members.length !== localSet.componentIds.length) return;
  const valuesByComponent = new Map();
  const combinations = new Set();
  for (const { source, component } of members) {
    const raw = source.variantProperties && typeof source.variantProperties === 'object' ? source.variantProperties : {};
    const values = {};
    for (const [sourceName, definition] of definitions) {
      const displayName = figPropertyDisplayName(sourceName);
      const value = raw[sourceName] ?? raw[displayName];
      if (typeof value !== 'string' || !properties.find(property => property.name === displayName)?.values.includes(value)) {
        warn(context.report, 'flattened', 'COMPONENT_VARIANT_PROPERTY', source.name,
          `Variant “${displayName}” was not mapped because the source member has no matching value in its declared options; name-derived axes were retained.`);
        return;
      }
      values[displayName] = value;
    }
    const combination = JSON.stringify(properties.map(property => values[property.name]));
    if (combinations.has(combination)) {
      warn(context.report, 'flattened', 'COMPONENT_VARIANT_PROPERTY', sourceSet.name,
        'The source variant definitions map multiple members to the same combination; name-derived axes were retained.');
      return;
    }
    combinations.add(combination);
    valuesByComponent.set(component.id, values);
  }
  localSet.properties = properties;
  for (const { component } of members) component.variantProperties = valuesByComponent.get(component.id);
}

function preserveFigComponentProperties(document, parsed, childrenMap, context, sourcesById, componentsBySourceId, setsBySourceId) {
  const sourceComponentsByKey = new Map();
  for (const [sourceId, source] of sourcesById) {
    if (['COMPONENT', 'SYMBOL'].includes(source.type) && typeof source.key === 'string' && source.key) {
      sourceComponentsByKey.set(source.key, sourceId);
    }
  }
  const localSetBySourceKey = new Map();
  for (const [sourceId, source] of sourcesById) {
    if (source.type !== 'COMPONENT_SET' || typeof source.key !== 'string' || !source.key) continue;
    const localSet = setsBySourceId.get(sourceId);
    if (localSet) localSetBySourceKey.set(source.key, localSet);
  }

  const propertyMapsByComponentId = new Map();
  for (const [sourceId, component] of componentsBySourceId) {
    const source = sourcesById.get(sourceId);
    if (!source) continue;
    const exposedNestedInstances = sourceExposedInstances(sourceId, childrenMap, sourcesById)
      .map(exposedSource => context.convertedNodesBySourceId.get(idOf(exposedSource)))
      .filter(node => {
        if (node?.isInstance) return true;
        warn(context.report, 'flattened', 'COMPONENT_EXPOSED_INSTANCE', source.name,
          'An exposed nested instance could not be linked to an imported local component and was omitted from the exposed property list.');
        return false;
      })
      .map(node => node.id);
    if (exposedNestedInstances.length) component.exposedNestedInstances = [...new Set(exposedNestedInstances)].slice(0, 100);
    const parentId = source.parentIndex?.guid ? guidKey(source.parentIndex.guid) : null;
    const sourceSet = parentId ? sourcesById.get(parentId) : null;
    const definitions = new Map();
    if (sourceSet?.type === 'COMPONENT_SET') {
      for (const [name, definition] of sourcePropertyDefinitions(sourceSet)) {
        if (definition?.type !== 'VARIANT') definitions.set(name, definition);
      }
    }
    for (const [name, definition] of sourcePropertyDefinitions(source)) {
      if (definition?.type !== 'VARIANT') definitions.set(name, definition);
    }
    const propertyMap = new Map();
    const importedNames = new Set();
    for (const [sourceName, definition] of definitions) {
      const type = definition?.type;
      const referenceField = type === 'BOOLEAN' ? 'visible'
        : type === 'TEXT' ? 'characters'
          : type === 'INSTANCE_SWAP' ? 'mainComponent'
            : type === 'SLOT' ? 'slotContentId' : null;
      if (!referenceField) {
        warn(context.report, 'flattened', 'COMPONENT_PROPERTY', source.name,
          `The “${figPropertyDisplayName(sourceName)}” ${String(type || 'unknown')} property type is not represented by the local component property model.`);
        continue;
      }
      const targets = sourceComponentPropertyTargets(sourceId, sourceName, referenceField, childrenMap, sourcesById);
      if (!targets.length) {
        warn(context.report, 'flattened', 'COMPONENT_PROPERTY', source.name,
          `The “${figPropertyDisplayName(sourceName)}” property has no matching ${referenceField} layer reference and was not imported.`);
        continue;
      }
      if (targets.length > 100) {
        warn(context.report, 'flattened', 'COMPONENT_PROPERTY_LIMIT', source.name,
          `The “${figPropertyDisplayName(sourceName)}” property references more than the local 100-target limit and was not imported.`);
        continue;
      }
      if (targets.length > 1 && !['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'SLOT'].includes(type)) {
        warn(context.report, 'flattened', 'COMPONENT_PROPERTY', source.name,
          `The “${figPropertyDisplayName(sourceName)}” property targets multiple layers, but its ${type} value cannot be represented safely across several local targets; it was not imported.`);
        continue;
      }
      const sourceTarget = targets[0];
      const localTargets = targets.map(candidate => context.convertedNodesBySourceId.get(idOf(candidate)));
      const supportedTarget = type === 'BOOLEAN'
        || (type === 'TEXT' && localTargets.every(target => target?.type === 'text'))
        || (type === 'INSTANCE_SWAP' && localTargets.every(target => target?.isInstance))
        || (type === 'SLOT' && localTargets.every(target => ['frame', 'group', 'section'].includes(target?.type)));
      if (localTargets.some(target => !target) || !supportedTarget) {
        warn(context.report, 'flattened', 'COMPONENT_PROPERTY', sourceTarget.name,
          `The “${figPropertyDisplayName(sourceName)}” property target was not converted to a compatible editable layer.`);
        continue;
      }
      const target = localTargets[0];
      let defaultValue;
      if (type === 'BOOLEAN') {
        const targetDefaults = localTargets.map(candidate => candidate.visible);
        defaultValue = typeof definition.defaultValue === 'boolean' ? definition.defaultValue
          : targetDefaults.every(value => value === targetDefaults[0]) ? targetDefaults[0] : undefined;
      } else if (type === 'TEXT') {
        const targetDefaults = localTargets.map(candidate => candidate.text);
        defaultValue = typeof definition.defaultValue === 'string' ? definition.defaultValue
          : targetDefaults.every(value => value === targetDefaults[0]) ? targetDefaults[0] : undefined;
      }
      else if (type === 'INSTANCE_SWAP') {
        defaultValue = resolveImportedComponentId(definition.defaultValue, sourcesById, componentsBySourceId, sourceComponentsByKey)
          || (localTargets.every(candidate => candidate.componentId === target.componentId) ? target.componentId : undefined);
      } else defaultValue = [];
      const declaredDefaultDisagrees = (type === 'BOOLEAN' && typeof definition.defaultValue === 'boolean'
          && localTargets.some(candidate => candidate.visible !== definition.defaultValue))
        || (type === 'TEXT' && typeof definition.defaultValue === 'string'
          && localTargets.some(candidate => candidate.text !== definition.defaultValue))
        || (type === 'INSTANCE_SWAP' && typeof defaultValue === 'string'
          && localTargets.some(candidate => candidate.componentId !== defaultValue));
      if (declaredDefaultDisagrees) {
        warn(context.report, 'flattened', 'COMPONENT_PROPERTY', sourceTarget.name,
          `The “${figPropertyDisplayName(sourceName)}” declared default does not match every referenced layer; the binding was not imported.`);
        continue;
      }
      if ((type === 'BOOLEAN' && typeof defaultValue !== 'boolean')
        || (type === 'TEXT' && (typeof defaultValue !== 'string' || defaultValue.length > 1_000_000))
        || (type === 'INSTANCE_SWAP' && (typeof defaultValue !== 'string' || !canSwapComponentTo(document, component.id, defaultValue)))
        || (type === 'SLOT' && !Array.isArray(defaultValue))) {
        warn(context.report, 'flattened', 'COMPONENT_PROPERTY', sourceTarget.name,
          `The “${figPropertyDisplayName(sourceName)}” property has no safe local default for every linked layer and was not imported.`);
        continue;
      }
      let name = figPropertyDisplayName(sourceName);
      let suffix = 2;
      while (importedNames.has(name.toLocaleLowerCase())) name = `${figPropertyDisplayName(sourceName).slice(0, 74)} (${suffix++})`;
      if (name !== figPropertyDisplayName(sourceName)) {
        warn(context.report, 'flattened', 'COMPONENT_PROPERTY_NAME', source.name,
          `Duplicate component property labels were disambiguated as “${name}” in the local editor.`);
      }
      importedNames.add(name.toLocaleLowerCase());
      const property = {
        id: createId('component-property'), name, type,
        targetSourceId: target.id, defaultValue
      };
      if (localTargets.length > 1) property.targetSourceIds = localTargets.map(candidate => candidate.id);
      if (type === 'INSTANCE_SWAP' && Array.isArray(definition.preferredValues)) {
        const preferred = [];
        let unresolved = false;
        for (const value of definition.preferredValues) {
          let candidateIds = [];
          if (value?.type === 'COMPONENT') {
            const candidate = resolveImportedComponentId(value.key, sourcesById, componentsBySourceId, sourceComponentsByKey);
            if (candidate) candidateIds = [candidate];
          } else if (value?.type === 'COMPONENT_SET') {
            const candidateSet = localSetBySourceKey.get(value.key);
            if (candidateSet) candidateIds = [...candidateSet.componentIds];
          }
          if (!candidateIds.length) { unresolved = true; continue; }
          preferred.push(...candidateIds.filter(candidate => canSwapComponentTo(document, component.id, candidate)));
        }
        const uniquePreferred = [...new Set(preferred)];
        if (uniquePreferred.length) property.preferredComponentIds = uniquePreferred;
        if (unresolved) warn(context.report, 'flattened', 'COMPONENT_PROPERTY_PREFERRED', sourceTarget.name,
          `Some preferred swap choices for “${name}” refer to library components absent from this file and were omitted.`);
      }
      if (type === 'SLOT' && (definition.slotSettings || definition.preferredValues?.length)) {
        warn(context.report, 'flattened', 'COMPONENT_SLOT_SETTINGS', sourceTarget.name,
          `Slot insertion constraints or preferred values for “${name}” are not represented locally; the editable slot target was retained.`);
      }
      component.componentProperties ||= [];
      if (component.componentProperties.length >= 100) {
        warn(context.report, 'flattened', 'COMPONENT_PROPERTY_LIMIT', source.name,
          'Additional component properties exceed the local 100-property limit and were omitted.');
        continue;
      }
      component.componentProperties.push(property);
      propertyMap.set(sourceName, property);
    }
    propertyMapsByComponentId.set(component.id, propertyMap);
  }

  for (const [sourceSetId, localSet] of setsBySourceId) {
    const sourceSet = sourcesById.get(sourceSetId);
    if (sourceSet) applyFigVariantDefinitions(document, sourceSet, localSet, childrenMap, sourcesById, componentsBySourceId, context);
  }

  for (const source of parsed.nodes) {
    if (source.type !== 'INSTANCE') continue;
    const instance = context.convertedNodesBySourceId.get(idOf(source));
    if (!instance?.isInstance) continue;
    let component = document.components.find(item => item.id === instance.componentId);
    let map = propertyMapsByComponentId.get(component?.id);
    const sourceInstanceProperties = source.componentProperties && typeof source.componentProperties === 'object' && !Array.isArray(source.componentProperties)
      ? source.componentProperties : {};
    const variantValues = {};
    for (const [sourceName, value] of Object.entries(sourceInstanceProperties)) {
      if (value?.type === 'VARIANT' && typeof value.value === 'string') variantValues[figPropertyDisplayName(sourceName)] = value.value;
    }
    if (component?.componentSetId && Object.keys(variantValues).length) {
      const set = document.componentSets.find(item => item.id === component.componentSetId);
      const target = set?.componentIds.map(id => document.components.find(item => item.id === id)).find(candidate => candidate
        && Object.entries(variantValues).every(([name, value]) => candidate.variantProperties?.[name] === value));
      if (target && target.id !== component.id) {
        try {
          switchComponentInstanceVariant(document, instance.id, target.id, context.sourcePagesBySourceId.get(idOf(source)));
          component = target;
          map = propertyMapsByComponentId.get(component.id);
        } catch (error) {
          warn(context.report, 'flattened', 'COMPONENT_VARIANT_VALUE', source.name,
            `The selected variant values could not be applied: ${error.message}`);
        }
      } else if (!target) {
        warn(context.report, 'flattened', 'COMPONENT_VARIANT_VALUE', source.name,
          'The selected variant values did not match an imported component variant.');
      }
    }
    for (const [sourceName, value] of Object.entries(sourceInstanceProperties)) {
      if (!value || value.type === 'VARIANT' || value.type === 'SLOT') continue;
      const property = map?.get(sourceName);
      if (!property || value.type !== property.type) {
        if (value.type === 'SLOT') warn(context.report, 'flattened', 'COMPONENT_PROPERTY_VALUE', source.name,
          `The “${figPropertyDisplayName(sourceName)}” slot content cannot be safely reconstructed from this local .fig tree.`);
        continue;
      }
      let propertyValue = value.value;
      if (property.type === 'INSTANCE_SWAP') {
        propertyValue = resolveImportedComponentId(propertyValue, sourcesById, componentsBySourceId, sourceComponentsByKey)
          || propertyValue;
      }
      try {
        if (!setComponentPropertyValue(document, instance.id, property.id, propertyValue, context.sourcePagesBySourceId.get(idOf(source)))) {
          warn(context.report, 'flattened', 'COMPONENT_PROPERTY_VALUE', source.name,
            `The “${property.name}” instance value could not be applied to its imported component.`);
        }
      } catch (error) {
        warn(context.report, 'flattened', 'COMPONENT_PROPERTY_VALUE', source.name,
          `The “${property.name}” instance value could not be applied: ${error.message}`);
      }
    }
    for (const property of component?.componentProperties || []) {
      if (property.type !== 'SLOT') continue;
      const targetSourceIds = Array.isArray(property.targetSourceIds) ? property.targetSourceIds : [property.targetSourceId];
      const targets = targetSourceIds.map(targetSourceId => localInstancePropertyTarget(instance, targetSourceId));
      if (targets.some(target => !target || !['frame', 'group', 'section'].includes(target.type))) {
        warn(context.report, 'flattened', 'COMPONENT_PROPERTY_VALUE', source.name,
          `The “${property.name}” slot targets could not all be matched to compatible instance layers; slot content was not imported.`);
        continue;
      }
      if (!targets.some(target => target.children?.length)) continue;
      // Slot content is authored as ordinary child layers in .fig. Keep those
      // concrete nodes as this instance's slot value so a later component sync
      // does not replace them with the master slot contents.
      instance.componentPropertyValues ||= {};
      instance.componentPropertyValues[property.id] = targets.length === 1
        ? (targets[0].children || []).map(child => child.id)
        : targets.map(target => (target.children || []).map(child => child.id));
    }
  }
}

function preserveFigComponents(document, parsed, childrenMap, context) {
  const sourcesById = new Map(parsed.nodes.map(source => [idOf(source), source]).filter(([id]) => id));
  const sourceDepths = new Map();
  const sourceDepth = (sourceId, ancestry = new Set()) => {
    if (sourceDepths.has(sourceId)) return sourceDepths.get(sourceId);
    if (ancestry.has(sourceId)) return 0;
    const source = sourcesById.get(sourceId);
    const parentId = source?.parentIndex?.guid ? guidKey(source.parentIndex.guid) : null;
    if (!parentId || !sourcesById.has(parentId)) {
      sourceDepths.set(sourceId, 0);
      return 0;
    }
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(sourceId);
    const depth = sourceDepth(parentId, nextAncestry) + 1;
    sourceDepths.set(sourceId, depth);
    return depth;
  };
  const componentsBySourceId = new Map();
  const setsBySourceId = new Map();
  const modelBySourceId = context.convertedNodesBySourceId;
  const importedNodesById = new Map();
  const indexImportedNodes = nodes => nodes.forEach(node => {
    importedNodesById.set(node.id, node);
    indexImportedNodes(node.children || []);
  });
  document.pages.forEach(page => indexImportedNodes(page.children));
  for (const [sourceId, node] of modelBySourceId) {
    const attached = importedNodesById.get(node.id);
    if (attached) modelBySourceId.set(sourceId, attached);
  }

  for (const source of parsed.nodes) {
    if (!['COMPONENT', 'SYMBOL'].includes(source.type)) continue;
    const sourceId = idOf(source);
    const root = modelBySourceId.get(sourceId);
    if (!root) {
      warn(context.report, 'flattened', source.type, source.name, 'The source component layer could not be converted, so linked component behavior was not preserved.');
      continue;
    }
    const id = createId('component');
    root.isComponent = true;
    root.componentId = id;
    const component = { id, name: safeName(source.name, 'Imported component'), pageId: context.sourcePagesBySourceId.get(sourceId), rootNodeId: root.id };
    document.components ||= [];
    document.components.push(component);
    componentsBySourceId.set(sourceId, component);
  }

  for (const source of parsed.nodes) {
    if (source.type !== 'COMPONENT_SET') continue;
    const setId = idOf(source);
    const variants = (childrenMap.get(setId) || [])
      .filter(child => ['COMPONENT', 'SYMBOL'].includes(child.type))
      .map(child => componentsBySourceId.get(idOf(child)))
      .filter(Boolean);
    if (variants.length < 2) {
      warn(context.report, 'flattened', 'COMPONENT_SET', source.name, 'This variant set did not contain at least two converted local component masters; its layers remain editable but unlinked as variants.');
      continue;
    }
    try {
      const localSet = createComponentSet(document, variants.map(component => component.id), safeName(source.name, 'Imported variants'));
      setsBySourceId.set(setId, localSet);
    } catch (error) {
      warn(context.report, 'flattened', 'COMPONENT_SET', source.name, `Variant metadata could not be represented safely: ${error.message}`);
    }
  }

  const instanceSources = parsed.nodes.map((source, order) => ({ source, order, depth: sourceDepth(idOf(source)) }))
    .filter(({ source }) => source.type === 'INSTANCE')
    // Resolve inner instances first so an enclosing imported instance can
    // preserve both its own source mapping and the nested component mapping.
    .sort((left, right) => right.depth - left.depth || left.order - right.order)
    .map(({ source }) => source);
  for (const source of instanceSources) {
    const sourceId = idOf(source);
    const instance = modelBySourceId.get(sourceId);
    const targetSourceId = sourceComponentGuid(source.componentId);
    const component = targetSourceId ? componentsBySourceId.get(targetSourceId) : null;
    const masterSource = targetSourceId ? sourcesById.get(targetSourceId) : null;
    const master = targetSourceId ? modelBySourceId.get(targetSourceId) : null;
    if (!instance || !component || !master || !masterSource) {
      warn(context.report, 'flattened', 'INSTANCE', source.name,
        source.componentKey && !targetSourceId
          ? 'This instance refers to an external library component; the source library is not embedded in the file, so its visible layers were imported detached.'
          : 'The local component reference could not be resolved to an imported component master; visible layers were imported detached.');
      continue;
    }
    const masterParentId = masterSource.parentIndex?.guid ? guidKey(masterSource.parentIndex.guid) : null;
    const masterSetSource = masterParentId ? sourcesById.get(masterParentId) : null;
    const slotDefinitions = [
      ...(masterSetSource?.type === 'COMPONENT_SET' ? sourcePropertyDefinitions(masterSetSource) : []),
      ...sourcePropertyDefinitions(masterSource)
    ].filter(([, definition]) => definition?.type === 'SLOT');
    const slotSourceIds = new Set(slotDefinitions.flatMap(([propertyName]) =>
      sourceComponentPropertyTargets(targetSourceId, propertyName, 'slotContentId', childrenMap, sourcesById).map(idOf)));
    const localPairsBySourceId = new Map([[targetSourceId, { master, instance, nestedComponentBoundary: false }]]);
    const visitedPairs = new Set();
    const mapChildren = (masterSourceNode, instanceSourceNode, insideNestedComponent = false) => {
      const pairKey = `${idOf(masterSourceNode)}>${idOf(instanceSourceNode)}`;
      if (visitedPairs.has(pairKey)) return false;
      visitedPairs.add(pairKey);
      const masterChildren = childrenMap.get(idOf(masterSourceNode)) || [];
      const instanceChildren = childrenMap.get(idOf(instanceSourceNode)) || [];
      if (masterChildren.length !== instanceChildren.length) return false;
      const used = new Set();
      for (const instanceChild of instanceChildren) {
        const candidates = masterChildren.filter((masterChild, index) => !used.has(index)
          && masterChild.type === instanceChild.type && String(masterChild.name || '') === String(instanceChild.name || ''));
        if (candidates.length !== 1) return false;
        const masterChild = candidates[0];
        const childIndex = masterChildren.indexOf(masterChild);
        used.add(childIndex);
        const sourceChildId = idOf(masterChild);
        const localMasterChild = modelBySourceId.get(sourceChildId);
        const localInstanceChild = modelBySourceId.get(idOf(instanceChild));
        if (!sourceChildId || !localMasterChild || !localInstanceChild) return false;
        const nestedTargetSourceId = masterChild.type === 'INSTANCE'
          ? sourceComponentGuid(masterChild.componentId) : null;
        const nestedComponentBoundary = insideNestedComponent
          || Boolean(nestedTargetSourceId && componentsBySourceId.has(nestedTargetSourceId));
        localPairsBySourceId.set(sourceChildId, {
          master: localMasterChild, instance: localInstanceChild, nestedComponentBoundary
        });
        if (slotSourceIds.has(sourceChildId)) continue;
        if (!mapChildren(masterChild, instanceChild, nestedComponentBoundary)) return false;
      }
      return true;
    };
    if (!mapChildren(masterSource, source)) {
      warn(context.report, 'flattened', 'INSTANCE', source.name, 'Instance descendants could not be matched unambiguously to the component tree; visible layers remain editable, and this instance was left detached.');
      continue;
    }
    instance.isInstance = true;
    delete instance.isComponent;
    instance.componentId = component.id;
    instance.componentSourceId = master.id;
    instance.componentNameIsInherited = true;
    if (master.variantNodeKey) instance.componentSourceKey = master.variantNodeKey;
    const overrides = {};
    for (const [sourceNodeId, { master: masterNode, instance: instanceNode, nestedComponentBoundary }] of localPairsBySourceId) {
      if (sourceNodeId !== targetSourceId) {
        if (nestedComponentBoundary) {
          const nestedSourceId = instanceNode.nestedComponentSourceId || instanceNode.componentSourceId
            || masterNode.nestedComponentSourceId || masterNode.componentSourceId;
          if (nestedSourceId) instanceNode.nestedComponentSourceId = nestedSourceId;
        }
        instanceNode.componentSourceId = masterNode.id;
      }
      if (masterNode.variantNodeKey) instanceNode.componentSourceKey = masterNode.variantNodeKey;
      const properties = {};
      for (const property of componentOverrideProperties) {
        const sourceHas = Object.hasOwn(masterNode, property);
        const instanceHas = Object.hasOwn(instanceNode, property);
        if (sourceHas !== instanceHas || (sourceHas && !sameJsonValue(masterNode[property], instanceNode[property]))) {
          if (instanceHas) properties[property] = structuredClone(instanceNode[property]);
        }
      }
      if (Object.keys(properties).length) overrides[masterNode.id] = properties;
    }
    instance.componentOverrides = overrides;
    if (!Object.keys(overrides).length) delete instance.componentOverrides;
  }
  preserveFigComponentProperties(document, parsed, childrenMap, context, sourcesById, componentsBySourceId, setsBySourceId);
}

function buildChildrenMap(parsed) {
  const map = new Map();
  for (const node of parsed.nodes) {
    const parent = node.parentIndex?.guid;
    if (!parent) continue;
    const parentId = `${parent.sessionID}:${parent.localID}`;
    const children = map.get(parentId) || [];
    children.push(node);
    map.set(parentId, children);
  }
  for (const children of map.values()) children.sort(positionOrder);
  return map;
}

const localAlphaMaskSourceTypes = new Set([
  'rectangle', 'ellipse', 'star', 'polygon', 'path', 'network', 'boolean', 'text', 'image', 'group', 'frame', 'section'
]);

function localAlphaMaskSource(node) {
  if (!node || !localAlphaMaskSourceTypes.has(node.type)) return false;
  if (node.type === 'path') {
    return [{ points: node.points, closed: node.closed }, ...(node.subpaths || [])]
      .some(contour => contour.closed === true && Array.isArray(contour.points) && contour.points.length >= 2);
  }
  if (node.type === 'network') return (node.faces || []).length > 0;
  return true;
}

function maskModeOf(source) {
  if (source.maskType == null) return source.isMaskOutline === true ? 'VECTOR' : 'ALPHA';
  return typeof source.maskType === 'string' ? source.maskType.toUpperCase() : null;
}

function boundsForMaskStack(nodes) {
  let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
  let pointCount = 0;
  for (const node of nodes) {
    const transform = nodeToParentTransform(node);
    for (const point of [
      { x: 0, y: 0 }, { x: node.width, y: 0 },
      { x: node.width, y: node.height }, { x: 0, y: node.height }
    ]) {
      const transformed = transformPoint(transform, point);
      left = Math.min(left, transformed.x); top = Math.min(top, transformed.y);
      right = Math.max(right, transformed.x); bottom = Math.max(bottom, transformed.y);
      pointCount += 1;
    }
  }
  if (!pointCount || ![left, top, right, bottom].every(Number.isFinite) || Math.abs(left) > 1_000_000_000
    || Math.abs(top) > 1_000_000_000 || right - left > 1_000_000_000 || bottom - top > 1_000_000_000) return null;
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function keepUnmasked(entries, start, end) {
  return entries.slice(start, end).map(entry => entry.node).filter(Boolean);
}

/** Convert safe sibling mask stacks into the editor's live, editable mask-group model. */
function convertSiblingMaskStacks(entries, parentSource, context) {
  const converted = [];
  for (let index = 0; index < entries.length;) {
    const entry = entries[index];
    if (entry.source?.isMask !== true) {
      if (entry.node) converted.push(entry.node);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < entries.length && entries[end].source?.isMask !== true) end += 1;
    const stack = entries.slice(index, end);
    const mode = maskModeOf(entry.source);
    const localMode = mode === 'ALPHA' ? 'alpha' : mode === 'VECTOR' ? 'vector' : mode === 'LUMINANCE' ? 'luminance' : null;
    const name = safeName(entry.source?.name, 'Mask');
    let reason = null;
    if (!localMode) reason = `The ${mode || 'unknown'} mask mode is not supported by the local renderer; these layers were kept editable and unmasked.`;
    else if (!entry.node) reason = 'The mask source could not be converted, so the remaining layers were kept editable and unmasked.';
    else if (localMode === 'alpha' && !localAlphaMaskSource(entry.node)) reason = 'This mask source type is not supported by the local alpha-mask renderer; these layers were kept editable and unmasked.';
    else if (localMode === 'vector' && !isMaskSource(entry.node, 'vector')) reason = 'This mask source type is not supported by the local vector-mask renderer; these layers were kept editable and unmasked.';
    else if (localMode === 'luminance' && !isMaskSource(entry.node, 'luminance')) reason = 'This mask source type is not supported by the local luminance-mask renderer; these layers were kept editable and unmasked.';
    else if (!stack.slice(1).some(item => item.node)) reason = 'This mask has no converted following siblings to mask, so it was kept as an ordinary editable layer.';
    else if (supportsStackAutoLayout(parentSource)) reason = 'Grouping this mask stack would change its parent auto-layout flow; the layers were kept editable and unmasked.';

    if (reason) {
      warn(context.report, 'unsupported', 'MASK', name, reason);
      converted.push(...keepUnmasked(entries, index, end));
      index = end;
      continue;
    }

    const nodes = stack.map(item => item.node).filter(Boolean);
    const bounds = boundsForMaskStack(nodes);
    if (!bounds) {
      warn(context.report, 'unsupported', 'MASK', name, 'The mask stack has unsafe transformed bounds; its editable layers were left ungrouped.');
      converted.push(...nodes);
      index = end;
      continue;
    }
    for (const node of nodes) {
      node.x -= bounds.left;
      node.y -= bounds.top;
    }
    converted.push(createNode('group', {
      name: safeName(`${name} mask`, 'Mask group'),
      x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height,
      mask: true, maskMode: localMode, maskSourceId: entry.node.id, children: nodes
    }));
    context.report.importedNodes += 1;
    index = end;
  }
  return converted;
}

function recursivelyConvert(node, childrenMap, context, pageId, depth = 0, parentSource = null) {
  const name = safeName(node.name, node.type || 'Imported layer');
  if (depth >= MAX_DOCUMENT_TREE_DEPTH) {
    warn(context.report, 'unsupported', node.type || 'NODE', name, 'This node exceeds the local layer nesting limit.');
    return null;
  }
  if (context.traversalActive.has(node)) {
    warn(context.report, 'unsupported', node.type || 'NODE', name, 'A cyclic layer reference was skipped.');
    return null;
  }
  if (context.traversalSeen.has(node)) {
    warn(context.report, 'unsupported', node.type || 'NODE', name, 'This node is referenced more than once; the duplicate was skipped.');
    return null;
  }
  context.traversalSeen.add(node);
  context.traversalActive.add(node);
  try {
    const id = idOf(node);
    const isContainer = ['CANVAS', 'FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SYMBOL', 'GROUP', 'SECTION', 'BOOLEAN_OPERATION'].includes(node.type)
      || !modelType(node.type);
    const children = isContainer && id ? childrenMap.get(id) || [] : [];
    const converted = [];
    for (const child of children) {
      if (child.phase === 'REMOVED' || child.type === 'CANVAS' || child.type === 'DOCUMENT') continue;
      const next = recursivelyConvert(child, childrenMap, context, pageId, depth + 1, node);
      // Keep null conversions in this list so an omitted `isMask` node still
      // establishes the boundary where the preceding mask stack stops.
      converted.push({ source: child, node: next });
    }
    return createLayer(node, convertSiblingMaskStacks(converted, node, context), context, pageId, depth, parentSource);
  } finally {
    context.traversalActive.delete(node);
  }
}

function paintBlendIsolationReasons(node) {
  const reasons = [];
  if (Number(node.opacity ?? 1) < 1) reasons.push('reduced layer opacity');
  if (node.blendMode && node.blendMode !== 'normal') reasons.push('a layer blend mode');
  if (node.effects?.some(effect => effect?.visible !== false)) reasons.push('visible effects');
  if (node.mask) reasons.push('mask compositing');
  if (node.type === 'boolean') reasons.push('Boolean compositing');
  return reasons;
}

function warnIsolatedPaintBlends(nodes, report, inheritedReasons = []) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') continue;
    const reasons = [...new Set([...inheritedReasons, ...paintBlendIsolationReasons(node)])];
    const hasPaintBlend = (Array.isArray(node.fills) && node.fills.some(fill => fill?.visible !== false
      && fill?.opacity > 0 && fill?.blendMode && fill.blendMode !== 'normal'))
      || (Array.isArray(node.strokes) && node.strokes.some(stroke => stroke?.visible !== false
        && stroke?.opacity > 0 && stroke?.blendMode && stroke.blendMode !== 'normal'));
    if (hasPaintBlend && reasons.length) {
      warn(report, 'flattened', 'PAINT_BLEND_COMPOSITION', node.name,
        `This paint blend is inside or on ${reasons.join(', ')}. Its backdrop may render differently locally and should be reviewed.`);
    }
    warnIsolatedPaintBlends(node.children, report, reasons);
  }
}

/** Convert a bounded, parsed Figma Design document into the local editable scene model. */
export function convertFigDocument(parsed, { fileName = 'Imported design.fig', formatVersion = parsed?.header?.version ?? 0 } = {}) {
  if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length > FIG_IMPORT_LIMITS.nodes) {
    throw new RangeError(`The .fig file contains more than ${FIG_IMPORT_LIMITS.nodes.toLocaleString()} layers or has an invalid node tree.`);
  }
  const report = createReport(formatVersion, fileName);
  report.sourceNodes = parsed.nodes.length;
  const pages = parsed.nodes.filter(node => node.type === 'CANVAS' && node.internalOnly !== true).sort(positionOrder);
  if (!pages.length) throw new TypeError('This file contains no importable design pages.');
  if (pages.length > 250) throw new RangeError('The .fig file contains more than 250 pages; split it into smaller local copies before importing.');
  report.pages = pages.length;
  const childrenMap = buildChildrenMap(parsed);
  const document = createDocument();
  const fileStem = String(fileName || parsed.meta?.file_name || 'Imported design').replace(/\.fig$/iu, '').trim();
  document.name = safeName(fileStem, 'Imported design').slice(0, 120);
  document.pages = [];
  const context = {
    parsed,
    parsedImages: parsed.images instanceof Map ? parsed.images : new Map(),
    imageLibrary: new Map(),
    assetsById: new Map(),
    convertedNodesBySourceId: new Map(),
    sourcePagesBySourceId: new Map(),
    visited: new WeakSet(),
    traversalSeen: new WeakSet(),
    traversalActive: new WeakSet(),
    gridTracksByParent: new WeakMap(),
    totalVectorSourceBytes: 0,
    totalVectorPathChars: 0,
    report
  };
  for (const [index, sourcePage] of pages.entries()) {
    const pageId = createId('page');
    const sourcePageId = idOf(sourcePage);
    const children = (sourcePageId ? childrenMap.get(sourcePageId) || [] : [])
      .filter(node => node.phase !== 'REMOVED')
      .map(node => recursivelyConvert(node, childrenMap, context, pageId, 0))
      .filter(Boolean);
    document.pages.push({ id: pageId, name: safeName(sourcePage.name, `Page ${index + 1}`), children, guides: [] });
  }
  preserveFigComponents(document, parsed, childrenMap, context);
  for (const page of document.pages) warnIsolatedPaintBlends(page.children, report);
  for (const node of parsed.nodes) {
    if (context.traversalSeen.has(node) || node.phase === 'REMOVED'
      || node.type === 'DOCUMENT' || node.type === 'CANVAS') continue;
    warn(report, 'unsupported', node.type || 'NODE', node.name, 'This layer was not attached to an importable page and was omitted.');
  }
  document.activePageId = document.pages[0].id;
  document.imageLibrary = [...context.imageLibrary.values()];
  const validated = parseDocument(document);
  return {
    document: validated,
    assets: [...context.assetsById.values()].map(({ width, height, ...asset }) => asset),
    report
  };
}

/** Preflight, parse, and convert one local .fig file without contacting a service. */
export function importFigBytes(bytes, options = {}) {
  const preflight = preflightFigArchive(bytes);
  const parsed = parseFigBinary(preflight.entries.get('canvas.fig'));
  parsed.meta = preflight.meta || undefined;
  parsed.thumbnail = preflight.entries.get('thumbnail.png');
  parsed.images = new Map([...preflight.entries.entries()]
    .filter(([name]) => name.startsWith('images/') && name !== 'images/')
    .map(([name, data]) => [name.split('/').at(-1), data]));
  if (parsed.header.version !== preflight.version) throw new TypeError('The .fig version changed between preflight and parsing.');
  return convertFigDocument(parsed, { ...options, formatVersion: preflight.version });
}
