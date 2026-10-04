import { getNodeColor, getNodeGeometry, getNodePropertyValue, getNodeTextPath, isMaskSource } from './model.js';
import { layoutPlainText, layoutTextRuns, resolvedLineHeight, textGraphemes, transformTextCase } from './text-layout.js';
import { fillStackForNode, gradientTypes, isValidFillStack, isValidGradientBasis, isValidGradientFill } from './fills.js';
import { glassVectorExportBlockReason } from './glass-effect.js';
import { isImageFillSupported, isValidImageFill } from './image-fills.js';
import { imageCropPixels, isValidImageTransforms, normalizeImageTransforms } from './image-transforms.js';
import { DEFAULT_IMAGE_TILE_SCALE, imageTilePatternTransform, imageTileSourceDimensions, isValidImageTileScale } from './image-tile.js';
import { isValidLayerEffects, layerEffectPadding, supportsShadowSpread } from './layer-effects.js';
import { isValidLayerBlendMode } from './layer-blend.js';
import { strokeDashArray } from './stroke-style.js';
import { isUniformStrokeSideWidths, isValidStrokeStack, strokeSideNames, strokeSideWidths, strokeStackForNode } from './strokes.js';
import { rectangleStrokeSideJoins, rectangleStrokeSidePaths } from './stroke-side-geometry.js';
import { strokeEndpointDecorations } from './stroke-decorations.js';
import { vectorNetworkEdgePoints, vectorNetworkVertexPoint, vectorPathContours } from './vector-path.js';
import { vectorNetworkFacePathCommands } from './vector-network-corners.js';
import { imagePreviewKey } from './image-preview-runtime.js';
import { clampCornerRadii, cornerRadiusKeys, isValidCornerRadii, roundedRectSvgPath } from './corner-radii.js';
import { MAX_POLYGON_POINTS, MAX_STAR_POINTS, MIN_STAR_POINTS, isValidVertexRadii, regularShapeVertices, roundedPolygonSvgPath } from './polygon-corners.js';
import { booleanSourceTransform } from './boolean-geometry.js';
import { MAX_TEXT_RUN_BASELINE_SHIFT } from './text-run-editing.js';
import { flattenTextPath, textPathSpans, textPathSvgData } from './text-on-path.js';
import { fontVariationSettings } from './font-variation.js';
import { fontFeatureSettings } from './font-features.js';
import { ellipseArcSvgPathData, isValidEllipseArcData } from './ellipse-arc.js';

/** An SVG export cannot preserve an editor feature that the SVG serializer does not implement. */
export class SvgExportError extends TypeError {
  constructor(feature, node) {
    const label = node?.name ? ` "${node.name}"` : '';
    super(`SVG export does not support ${feature} on layer${label}.`);
    this.name = 'SvgExportError';
    this.feature = feature;
    this.nodeId = node?.id ?? null;
    this.nodeName = node?.name ?? null;
  }
}

const supportedTypes = new Set(['frame', 'section', 'group', 'rectangle', 'ellipse', 'line', 'text', 'star', 'polygon', 'path', 'network', 'image', 'boolean']);
const identity = [1, 0, 0, 1, 0, 0];
const emptyDocument = { variables: [], variableCollections: [], colorStyles: [], pages: [] };
const safeRasterTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const MAX_NETWORK_METADATA_LENGTH = 1024 * 1024;

function networkRoundTripMetadata(node) {
  const payload = {
    version: 1,
    name: node.name || '',
    geometry: {
      width: node.width,
      height: node.height,
      vertices: node.vertices,
      edges: node.edges,
      faces: node.faces
    },
    paint: Object.fromEntries([
      'fill', 'fillOpacity', 'stroke', 'strokeWidth', 'strokeOpacity', 'strokeCap',
      'strokeJoin', 'strokePattern', 'strokeDashArray', 'strokeMiterLimit', 'strokes', 'fillGradient', 'fillRule'
    ].filter(key => node[key] !== undefined).map(key => [key, node[key]]))
  };
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_NETWORK_METADATA_LENGTH) {
    throw new TypeError(`SVG export cannot preserve vector network metadata larger than ${MAX_NETWORK_METADATA_LENGTH} characters on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  return ` data-tiny-image-star-network-v1="${escapeXml(serialized)}"`;
}

function resolveLocalImage(node, assets, assetId, imagePreviews = null, previewKey = node.id) {
  const preview = imagePreviews?.get?.(previewKey) ?? imagePreviews?.[previewKey] ?? null;
  if (preview) {
    const type = String(preview.type || preview.mimeType || 'image/png').toLowerCase().split(';')[0].trim();
    const bytes = preview.sourceBytes ?? preview.bytes;
    if (!safeRasterTypes.has(type) || (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes))) {
      return { error: node.type === 'image' ? 'image layers' : 'image fills' };
    }
    const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!view.length) return { error: node.type === 'image' ? 'image layers' : 'image fills' };
    let binary = '';
    for (let offset = 0; offset < view.length; offset += 0x8000) binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
    const encoded = typeof btoa === 'function' ? btoa(binary) : Buffer.from(view).toString('base64');
    return { href: `data:${type};base64,${encoded}`, width: Number(preview.width), height: Number(preview.height), isPreview: true };
  }
  const asset = assets?.get?.(assetId) ?? assets?.[assetId];
  const type = String(asset?.type || asset?.mimeType || '').toLowerCase().split(';')[0].trim();
  if (!asset || !safeRasterTypes.has(type)) return { error: node.type === 'image' ? 'image layers' : 'image fills' };
  const bytes = asset.sourceBytes ?? asset.bytes;
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return { error: node.type === 'image' ? 'image layers' : 'image fills' };
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!view.length) return { error: node.type === 'image' ? 'image layers' : 'image fills' };
  let binary = '';
  for (let offset = 0; offset < view.length; offset += 0x8000) binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  const encoded = typeof btoa === 'function' ? btoa(binary) : Buffer.from(view).toString('base64');
  return {
    href: `data:${type};base64,${encoded}`,
    width: Number(asset.sourceWidth || asset.width || asset.bitmap?.width),
    height: Number(asset.sourceHeight || asset.height || asset.bitmap?.height)
  };
}

function imageFit(node) {
  return node.type === 'image' ? (node.fit ?? 'cover') : node.imageFill.fit;
}

function imageTileSourceSize(assets, assetId, image) {
  const asset = assets?.get?.(assetId) ?? assets?.[assetId];
  return {
    width: Number(asset?.sourceWidth || asset?.width || asset?.bitmap?.width || image.width),
    height: Number(asset?.sourceHeight || asset?.height || asset?.bitmap?.height || image.height)
  };
}

function imageTilePatternMarkup({ image, sourceWidth, sourceHeight, scalingFactor, transforms = {}, id }) {
  const normalized = normalizeImageTransforms(transforms || {});
  const tileSource = image.isPreview
    ? imageTileSourceDimensions(sourceWidth, sourceHeight, normalized.rotation)
    : { width: sourceWidth, height: sourceHeight };
  const geometry = tileSource && imageTilePatternTransform({
    imageWidth: Number(image.width), imageHeight: Number(image.height),
    sourceWidth: tileSource.width, sourceHeight: tileSource.height,
    scalingFactor: scalingFactor ?? DEFAULT_IMAGE_TILE_SCALE,
    rotation: image.isPreview ? 0 : normalized.rotation,
    flipHorizontal: image.isPreview ? false : normalized.flipHorizontal,
    flipVertical: image.isPreview ? false : normalized.flipVertical
  });
  if (!geometry) throw new TypeError('SVG export requires valid image tile dimensions and scale.');
  const { a, b, c, d, e, f } = geometry.matrix;
  const content = `<image x="0" y="0" width="${number(image.width)}" height="${number(image.height)}" preserveAspectRatio="none" transform="matrix(${[a, b, c, d, e, f].map(number).join(' ')})" href="${image.href}"/>`;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" x="0" y="0" width="${number(geometry.width)}" height="${number(geometry.height)}">${content}</pattern>`;
}

function addImageTilePattern(context, image, assets, assetId, scalingFactor, transforms, id) {
  const source = imageTileSourceSize(assets, assetId, image);
  const markup = imageTilePatternMarkup({
    image, sourceWidth: source.width, sourceHeight: source.height,
    scalingFactor, transforms, id
  });
  context.defs.push(markup);
  return `url(#${id})`;
}

function imageTileRectMarkup({ image, width, height, assets, assetId, scalingFactor, transforms, id, attributes = '', context }) {
  const fill = addImageTilePattern(context, image, assets, assetId, scalingFactor, transforms, id);
  return `<rect x="0" y="0" width="${number(width)}" height="${number(height)}" fill="${fill}"${attributes}/>`;
}

function rasterImageMarkup({ image, width, height, fit, transforms = {}, attributes = '' }) {
  const normalized = normalizeImageTransforms(transforms || {});
  const sourceWidth = Number(image.width);
  const sourceHeight = Number(image.height);
  if (!Number.isSafeInteger(sourceWidth) || sourceWidth <= 0 || !Number.isSafeInteger(sourceHeight) || sourceHeight <= 0) {
    throw new TypeError('SVG export requires positive source image dimensions.');
  }
  const crop = imageCropPixels(normalized.crop, Math.round(sourceWidth), Math.round(sourceHeight))
    || { left: 0, top: 0, right: Math.round(sourceWidth), bottom: Math.round(sourceHeight) };
  const cropWidth = crop.right - crop.left;
  const cropHeight = crop.bottom - crop.top;
  const rotated = normalized.rotation === 90 || normalized.rotation === 270;
  const outputWidth = rotated ? cropHeight : cropWidth;
  const outputHeight = rotated ? cropWidth : cropHeight;
  const preserveAspectRatio = `xMidYMid ${fit === 'cover' ? 'slice' : 'meet'}`;
  if (!normalized.crop && normalized.rotation === 0 && !normalized.flipHorizontal && !normalized.flipVertical) {
    return `<image x="0" y="0" width="${number(width)}" height="${number(height)}" preserveAspectRatio="${preserveAspectRatio}" href="${image.href}"${attributes}/>`;
  }
  const scale = fit === 'cover'
    ? Math.max(width / outputWidth, height / outputHeight)
    : Math.min(width / outputWidth, height / outputHeight);
  const offsetX = (width - outputWidth * scale) / 2;
  const offsetY = (height - outputHeight * scale) / 2;
  let matrix;
  switch (normalized.rotation) {
    case 90: matrix = [0, scale, -scale, 0, offsetX + crop.bottom * scale, offsetY - crop.left * scale]; break;
    case 180: matrix = [-scale, 0, 0, -scale, offsetX + crop.right * scale, offsetY + crop.bottom * scale]; break;
    case 270: matrix = [0, -scale, scale, 0, offsetX - crop.top * scale, offsetY + crop.right * scale]; break;
    default: matrix = [scale, 0, 0, scale, offsetX - crop.left * scale, offsetY - crop.top * scale]; break;
  }
  if (normalized.flipHorizontal || normalized.flipVertical) {
    const flip = [
      normalized.flipHorizontal ? -1 : 1, 0,
      0, normalized.flipVertical ? -1 : 1,
      normalized.flipHorizontal ? 2 * offsetX + outputWidth * scale : 0,
      normalized.flipVertical ? 2 * offsetY + outputHeight * scale : 0,
    ];
    matrix = multiply(flip, matrix);
  }
  // Keep clipping and paint attributes in the target box's coordinate space.
  // Transforming the image element itself would also transform its clip path,
  // moving the clip along with a crop or quarter-turn.
  return `<g${attributes}><image x="0" y="0" width="${number(sourceWidth)}" height="${number(sourceHeight)}" preserveAspectRatio="none" transform="matrix(${matrix.map(number).join(' ')})" href="${image.href}"/></g>`;
}

function unsupportedImageFill(node, fill, assets, imagePreviews, previewKey = node.id) {
  if (!isImageFillSupported(node) || !isValidImageFill(fill)) return 'image fills';
  const image = resolveLocalImage(node, assets, fill.assetId, imagePreviews, previewKey);
  if (image.error) return 'image fills';
  if (!image.isPreview && Object.values(fill.adjustments || {}).some(value => Number(value) !== 0)) return 'raster image adjustments';
  if (fill.transforms != null && !isValidImageTransforms(fill.transforms)) {
    throw new TypeError(`SVG export requires valid image transforms on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  if (!['cover', 'contain', 'tile'].includes(fill.fit)) return 'image fill fit mode';
  if (!(image.width > 0) || !(image.height > 0)) return 'image fills';
  return null;
}

function hasFillablePathContour(node) {
  return vectorPathContours(node).some(contour => contour.closed === true && contour.points.length >= 2);
}

function hasOnlyClosedPathContours(node) {
  const contours = vectorPathContours(node);
  return contours.length > 0 && contours.every(contour => contour.closed === true && contour.points.length >= 2);
}

function hasOnlyClosedRenderablePathContours(node) {
  const contours = vectorPathContours(node).filter(contour => contour.points.length > 0);
  return contours.length > 0 && contours.every(contour => contour.closed === true && contour.points.length >= 2);
}

function escapeXml(value) {
  const text = String(value ?? '');
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== 0x9 && codePoint !== 0xa && codePoint !== 0xd
      && !(codePoint >= 0x20 && codePoint <= 0xd7ff)
      && !(codePoint >= 0xe000 && codePoint <= 0xfffd)
      && !(codePoint >= 0x10000 && codePoint <= 0x10ffff)) {
      throw new TypeError('SVG export cannot include characters forbidden by XML 1.0.');
    }
  }
  return text.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}

function fontVariationAttribute(values) {
  const settings = fontVariationSettings(values);
  return settings ? ` font-variation-settings="${escapeXml(settings)}"` : '';
}

function fontFeatureAttribute(values) {
  const settings = fontFeatureSettings(values);
  return settings ? ` font-feature-settings="${escapeXml(settings)}"` : '';
}

function number(value) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new TypeError('SVG export requires finite numeric values.');
  const rounded = Math.abs(result) < 1e-12 ? 0 : Number(result.toPrecision(12));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function ellipseArcRoundTripMetadata(node) {
  if (node?.type !== 'ellipse' || !isValidEllipseArcData(node.arcData)) return '';
  const metadata = JSON.stringify({
    version: 1,
    width: Number(node.width),
    height: Number(node.height),
    arcData: {
      startingAngle: node.arcData.startingAngle,
      endingAngle: node.arcData.endingAngle,
      innerRadius: node.arcData.innerRadius
    }
  });
  return ` data-tiny-image-star-ellipse-arc-v1="${escapeXml(metadata)}"`;
}

function roundedRegularShapeRoundTripMetadata(document, node) {
  if (!['star', 'polygon'].includes(node?.type)) return '';
  const maximum = node.type === 'star' ? MAX_STAR_POINTS : MAX_POLYGON_POINTS;
  const defaultPoints = node.type === 'star' ? 5 : 6;
  const points = Math.max(MIN_STAR_POINTS, Math.min(maximum, Math.ceil(Number(node.points) || defaultPoints)));
  const innerRadius = node.type === 'star' ? Number(node.innerRadius ?? 0.48) : null;
  const radius = Number(getNodePropertyValue(document, node, 'radius') ?? node.radius ?? 0);
  const smoothing = cornerSmoothing(node);
  if (!Number.isFinite(radius) || radius < 0 || radius > 100_000
    || node.type === 'star' && (!Number.isFinite(innerRadius) || innerRadius < 0 || innerRadius > 1)
    || node.vertexRadii != null && !isValidVertexRadii(node.type, points, node.vertexRadii)) {
    throw new TypeError(`SVG export requires valid rounded ${node.type} geometry on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  if (!radius && !smoothing && !node.vertexRadii?.some(value => value > 0)) return '';
  const metadata = JSON.stringify({
    version: 1,
    width: Number(node.width),
    height: Number(node.height),
    points,
    ...(node.type === 'star' ? { innerRadius } : {}),
    radius,
    cornerSmoothing: smoothing,
    vertexRadii: node.vertexRadii || null
  });
  return ` data-tiny-image-star-rounded-shape-v1="${escapeXml(metadata)}"`;
}

function roundedRectangleRoundTripMetadata(document, node) {
  if (node?.type !== 'rectangle') return '';
  const radii = cornerRadii(document, node);
  const smoothing = cornerSmoothing(node);
  if (!smoothing && cornerRadiusKeys.every(key => radii[key] === radii.topLeft)) return '';
  const metadata = JSON.stringify({
    version: 1,
    width: Number(node.width),
    height: Number(node.height),
    cornerRadii: radii,
    cornerSmoothing: smoothing
  });
  return ` data-tiny-image-star-rounded-rectangle-v1="${escapeXml(metadata)}"`;
}

function hasPlainRegularShapeGeometry(node, document = emptyDocument) {
  if (!['star', 'polygon'].includes(node?.type)) return false;
  const radius = Number(getNodePropertyValue(document, node, 'radius') ?? node.radius ?? 0);
  return Number.isFinite(radius) && radius === 0 && cornerSmoothing(node) === 0
    && !node.vertexRadii?.some(value => Number(value) > 0);
}

function dimensions(node) {
  const width = Number(node?.width);
  const height = Number(node?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    throw new TypeError(`SVG export requires nonnegative finite dimensions on layer ${node?.name || node?.id || '(unnamed)'}.`);
  }
  return { width, height };
}

function multiply(left, right) {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

function nodeMatrix(node, { includePosition = true } = {}) {
  const { width, height } = dimensions(node);
  const rotation = Number(node.rotation || 0);
  const x = includePosition ? Number(node.x || 0) : 0;
  const y = includePosition ? Number(node.y || 0) : 0;
  if (![rotation, x, y].every(Number.isFinite)) throw new TypeError(`SVG export requires finite geometry on layer ${node.name || node.id || '(unnamed)'}.`);
  const radians = rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = width / 2;
  const cy = height / 2;
  const centeredRotation = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
  const affine = node.affineTransform || { a: 1, b: 0, c: 0, d: 1 };
  const determinant = affine.a * affine.d - affine.b * affine.c;
  if (![affine.a, affine.b, affine.c, affine.d, determinant].every(Number.isFinite)
    || Math.abs(determinant) <= 1e-12) {
    throw new TypeError(`SVG export requires a finite, invertible affine transform on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  return multiply([1, 0, 0, 1, x, y], multiply(
    [affine.a, affine.b, affine.c, affine.d, 0, 0], centeredRotation
  ));
}

function matrixAttribute(matrix) {
  if (matrix.every((value, index) => value === identity[index])) return '';
  return ` transform="matrix(${matrix.map(number).join(' ')})"`;
}

function color(document, node, kind) {
  const value = getNodeColor(document, node, kind) || (kind === 'stroke' ? 'none' : 'transparent');
  if (value === 'transparent' || value === 'none') return value;
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
    throw new TypeError(`SVG export supports solid hexadecimal colors only on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  return value;
}

function normalizedGradientHandles(node, gradient, width, height) {
  if (gradient.geometry == null) return null;
  const geometry = gradient.geometry;
  const invalid = () => new TypeError(`SVG export requires exactly three finite object-space gradient handles on layer ${node.name || node.id || '(unnamed)'}.`);
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)
    || Object.keys(geometry).some(key => key !== 'handles')
    || !Array.isArray(geometry.handles) || geometry.handles.length !== 3) throw invalid();
  for (const handle of geometry.handles) {
    if (!handle || typeof handle !== 'object' || Array.isArray(handle)
      || Object.keys(handle).some(key => key !== 'x' && key !== 'y')
      || !Number.isFinite(handle.x) || !Number.isFinite(handle.y)) throw invalid();
  }
  if (!isValidGradientBasis(geometry.handles)) {
    throw new TypeError(`SVG export cannot represent a degenerate gradient geometry on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  const [origin, first, second] = geometry.handles;
  const matrix = [
    (first.x - origin.x) * width, (first.y - origin.y) * height,
    (second.x - origin.x) * width, (second.y - origin.y) * height,
    origin.x * width, origin.y * height
  ];
  if (!matrix.every(Number.isFinite)) {
    throw new TypeError(`SVG export cannot represent a degenerate gradient geometry on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  const roundedMatrix = matrix.map(number);
  const roundedBasis = [
    { x: 0, y: 0 },
    { x: roundedMatrix[0] / width, y: roundedMatrix[1] / height },
    { x: roundedMatrix[2] / width, y: roundedMatrix[3] / height }
  ];
  // Preserve the compact normal form unless rounding would make the actual
  // serialized basis invalid; in that case emit round-trip-safe coordinates.
  const serializedMatrix = isValidGradientBasis(roundedBasis)
    ? roundedMatrix
    : matrix.map(gradientMatrixNumber);
  return { matrix: serializedMatrix.join(' ') };
}

// Unlike the general SVG number formatter, gradient transforms must retain
// tiny but valid axes: rounding them can turn a well-conditioned basis into a
// singular matrix on import.
function gradientMatrixNumber(value) {
  if (!Number.isFinite(value)) throw new TypeError('SVG export requires finite gradient matrix values.');
  return Object.is(value, -0) ? '0' : String(value);
}

function gradientDefinition(node, index, gradient = node.fillGradient, id = `tis-gradient-${index}`) {
  if (!gradient) return null;
  if (!isValidGradientFill(gradient)) throw new TypeError(`SVG export requires a valid gradient fill on layer ${node.name || node.id || '(unnamed)'}.`);
  if (gradient.type === 'angular') throw new SvgExportError('angular gradients (choose raster export to preserve the appearance)', node);
  const bounds = dimensions(node);
  // Canvas gradient creation clamps zero-sized axes to one pixel. Keep SVG
  // coordinates aligned for open paths and lines, whose authored height or
  // width can legitimately be zero.
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const stops = gradient.stops.map(stop => `<stop offset="${number(stop.position)}" stop-color="${escapeXml(stop.color)}"${(stop.opacity ?? 1) === 1 ? '' : ` stop-opacity="${number(stop.opacity)}"`}/>`).join('');
  const geometry = normalizedGradientHandles(node, gradient, width, height);
  if (geometry && gradient.type === 'linear') {
    return { id, markup: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0" gradientTransform="matrix(${geometry.matrix})">${stops}</linearGradient>` };
  }
  if (geometry && gradient.type === 'radial') {
    return { id, markup: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(${geometry.matrix})">${stops}</radialGradient>` };
  }
  if (gradient.type === 'linear') {
    const angle = gradient.angle * Math.PI / 180;
    const halfLength = Math.abs(Math.cos(angle)) * width / 2 + Math.abs(Math.sin(angle)) * height / 2;
    const centerX = width / 2; const centerY = height / 2;
    const dx = Math.cos(angle) * halfLength; const dy = Math.sin(angle) * halfLength;
    return { id, markup: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${number(centerX - dx)}" y1="${number(centerY - dy)}" x2="${number(centerX + dx)}" y2="${number(centerY + dy)}">${stops}</linearGradient>` };
  }
  const radialRadius = Math.max(1, Math.hypot(width, height) / 2);
  return { id, markup: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${number(width / 2)}" cy="${number(height / 2)}" r="${number(radialRadius)}">${stops}</radialGradient>` };
}

function fillAttributes(document, node, { text = false, gradientId = null, fillValue = undefined, fillOpacity: opacityOverride = undefined } = {}) {
  const value = fillValue === undefined ? (text ? color(document, node, 'text') : color(document, node, 'fill')) : fillValue;
  const fill = gradientId ? `url(#${gradientId})` : value === 'transparent' ? 'none' : value;
  const fillOpacity = opacityOverride ?? node.fillOpacity ?? 1;
  if (!Number.isFinite(Number(fillOpacity)) || fillOpacity < 0 || fillOpacity > 1) {
    throw new TypeError(`SVG export requires valid fill opacity on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  return ` fill="${escapeXml(fill)}" fill-opacity="${number(fillOpacity)}"`;
}

function strokeAttributes(document, node, strokeItem = undefined, strokeIndex = 0, gradientId = null) {
  const hasSavedStack = Array.isArray(node.strokes);
  const entry = strokeItem === undefined ? (hasSavedStack ? null : strokeStackForNode(node)[0] || null) : strokeItem;
  const strokeWidth = Number(entry ? entry.width : hasSavedStack ? 0 : node.strokeWidth || 0);
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0) throw new TypeError(`SVG export requires a valid stroke width on layer ${node.name || node.id || '(unnamed)'}.`);
  const rawColor = entry ? strokeIndex === 0 && node.strokeVariableId ? color(document, node, 'stroke') : entry.color : node.stroke;
  if (entry?.gradient && !isValidGradientFill(entry.gradient)) throw new TypeError(`SVG export requires a valid gradient stroke on layer ${node.name || node.id || '(unnamed)'}.`);
  if (entry?.gradient && !gradientId) throw new TypeError(`SVG export requires a gradient definition for the stroke on layer ${node.name || node.id || '(unnamed)'}.`);
  const resolved = (entry?.gradient || rawColor) && strokeWidth && (!entry || (entry.visible && entry.opacity > 0))
    ? entry?.gradient ? `url(#${gradientId})` : rawColor
    : 'none';
  const stroke = resolved === 'transparent' ? 'none' : resolved;
  const patternValue = entry ? entry.pattern : node.strokePattern;
  const capValue = entry ? entry.cap : node.strokeCap;
  const joinValue = entry ? entry.join : node.strokeJoin;
  const pattern = ['solid', 'dashed', 'dotted', 'custom'].includes(patternValue) ? patternValue : 'solid';
  const cap = pattern === 'dotted' ? 'round' : ['butt', 'round', 'square'].includes(capValue) ? capValue : 'butt';
  const join = ['miter', 'round', 'bevel'].includes(joinValue) ? joinValue : 'miter';
  const miterLimit = Number(entry ? entry.miterLimit : node.strokeMiterLimit ?? 10);
  if (!Number.isFinite(miterLimit) || miterLimit < 1 || miterLimit > 1000) throw new TypeError(`SVG export requires a valid stroke miter limit on layer ${node.name || node.id || '(unnamed)'}.`);
  const customDash = entry?.dashArray ?? node.strokeDashArray;
  const dash = resolved !== 'none' ? strokeDashArray({ strokeWidth, strokePattern: pattern, dashArray: customDash }) : [];
  const miter = resolved !== 'none' && join === 'miter' && miterLimit !== 4 ? ` stroke-miterlimit="${number(miterLimit)}"` : '';
  const opacity = Number(entry ? entry.opacity : node.strokeOpacity ?? 1);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new TypeError(`SVG export requires valid stroke opacity on layer ${node.name || node.id || '(unnamed)'}.`);
  return ` stroke="${escapeXml(stroke)}"${opacity === 1 ? '' : ` stroke-opacity="${number(opacity)}"`} stroke-width="${number(strokeWidth)}"${cap === 'butt' ? '' : ` stroke-linecap="${cap}"`}${join === 'miter' ? '' : ` stroke-linejoin="${join}"`}${miter}${dash.length ? ` stroke-dasharray="${dash.map(number).join(' ')}"` : ''}`;
}

function addStrokeGradientDefinition(node, stroke, strokeIndex, layerIndex, context) {
  if (!stroke?.gradient) return null;
  if (!isValidGradientFill(stroke.gradient)) throw new TypeError(`SVG export requires a valid gradient stroke on layer ${node.name || node.id || '(unnamed)'}.`);
  const id = `tis-gradient-${layerIndex}-stroke-${strokeIndex}`;
  if (context?.strokeGradientIds?.has(id)) return id;
  const definition = gradientDefinition(node, layerIndex, stroke.gradient, id);
  if (context?.defs) context.defs.push(definition.markup);
  if (context?.strokeGradientIds) context.strokeGradientIds.add(id);
  return definition.id;
}

function shapeStrokeStackMarkup(node, document, measureText, gradientId = null, context = null, layerIndex = 0) {
  if (!Array.isArray(node.strokes)) return '';
  const strokes = strokeStackForNode(node);
  return strokes.map((stroke, index) => {
    const sideWidths = ['rectangle', 'frame'].includes(node.type) ? strokeSideWidths(stroke) : null;
    const maximumSideWidth = sideWidths ? Math.max(...strokeSideNames.map(side => sideWidths[side])) : stroke.width;
    if (!stroke.visible || stroke.opacity <= 0 || maximumSideWidth <= 0 || (!stroke.gradient && (!stroke.color || stroke.color === 'transparent'))) return '';
    const strokeGradientId = addStrokeGradientDefinition(node, stroke, index, layerIndex, context);
    let markup;
    if (sideWidths && !isUniformStrokeSideWidths(sideWidths)) {
      const cornerRadius = Number(getNodePropertyValue(document, node, 'radius') ?? node.radius ?? 0);
      const runs = rectangleStrokeSidePaths(node.width, node.height,
        node.cornerRadii || Object.fromEntries(cornerRadiusKeys.map(key => [key, cornerRadius])), node.cornerSmoothing || 0);
      const encodedWidths = escapeXml(JSON.stringify(sideWidths));
      const paths = runs.map(run => {
        const width = sideWidths[run.side];
        if (!(width > 0)) return '';
        const d = `M ${number(run.points[0].x)} ${number(run.points[0].y)}${run.points.slice(1).map(point => ` L ${number(point.x)} ${number(point.y)}`).join('')}`;
        // Every run ends at an artificial corner bisector. Butt caps avoid
        // leaking the editable cap style there; explicit shared join geometry
        // below handles the actual corner transition.
        const attributes = strokeAttributes(document, node, {
          ...stroke, width, opacity: 1, cap: stroke.pattern === 'dotted' ? 'round' : 'butt'
        }, index, strokeGradientId);
        return `<path d="${d}" fill="none"${attributes} data-tiny-image-star-stroke-side="${run.side}"/>`;
      }).join('');
      const joins = (stroke.pattern === 'solid'
        ? rectangleStrokeSideJoins(runs, sideWidths, stroke.join, stroke.miterLimit)
        : []).map(patch => {
        const d = `M ${number(patch.points[0].x)} ${number(patch.points[0].y)}${patch.points.slice(1).map(point => ` L ${number(point.x)} ${number(point.y)}`).join('')} Z`;
        const fill = stroke.gradient ? `url(#${strokeGradientId})`
          : index === 0 && node.strokeVariableId ? color(document, node, 'stroke') : stroke.color;
        return `<path d="${d}" fill="${escapeXml(fill || 'none')}" stroke="none" data-tiny-image-star-stroke-join="${escapeXml(stroke.join)}"/>`;
      }).join('');
      markup = `<g data-tiny-image-star-stroke-side-widths="${encodedWidths}" data-tiny-image-star-stroke-base-width="${number(stroke.width)}" data-tiny-image-star-stroke-original-cap="${escapeXml(stroke.cap)}" data-tiny-image-star-stroke-original-miter-limit="${number(stroke.miterLimit)}" opacity="${number(stroke.opacity)}">${paths}${joins}</g>`;
    }
    else if (sideWidths) {
      const uniformStroke = { ...stroke, width: sideWidths.top };
      if (node.type === 'image') markup = roundedRectMarkup(node, document, ` fill="none"${strokeAttributes(document, node, uniformStroke, index, strokeGradientId)}`);
      else markup = shapeMarkup(node, document, measureText, gradientId, { fillValue: 'transparent', fillOpacity: 0, includeStroke: true, strokeItem: uniformStroke, strokeIndex: index, strokeGradientId });
    }
    else if (node.type === 'image') markup = roundedRectMarkup(node, document, ` fill="none"${strokeAttributes(document, node, stroke, index, strokeGradientId)}`);
    else if (node.type === 'text') markup = textMarkup(node, document, measureText, {
      fillValue: 'transparent', fillOpacity: 0, includeStroke: true,
      strokeItem: stroke, strokeIndex: index, strokeGradientId, clipSuffix: `stroke-${index}`
    });
    else markup = shapeMarkup(node, document, measureText, gradientId, { fillValue: 'transparent', fillOpacity: 0, includeStroke: true, strokeItem: stroke, strokeIndex: index, strokeGradientId });
    if (markup) markup = markup.replace(/^<([a-z][\w:-]*)\b/, `<$1 data-tiny-image-star-stroke-id="${escapeXml(stroke.id)}" data-tiny-image-star-stroke-order="${index}"${paintBlendStyle(stroke.blendMode)}`);
    return markup + strokeDecorationMarkup(node, document, stroke, index, strokeGradientId);
  }).join('');
}

function strokeDecorationMarkup(node, document, stroke, strokeIndex, gradientId = null) {
  const decorations = strokeEndpointDecorations(node, stroke, { x: 0, y: 0 });
  if (!decorations.length) return '';
  const rawColor = strokeIndex === 0 && node.strokeVariableId ? color(document, node, 'stroke') : stroke.color;
  const value = stroke.gradient ? (gradientId ? `url(#${gradientId})` : null) : rawColor === 'transparent' ? 'none' : rawColor;
  if (!value || value === 'none') return '';
  const metadata = ` data-tiny-image-star-stroke-id="${escapeXml(stroke.id)}" data-tiny-image-star-stroke-order="${strokeIndex}"${paintBlendStyle(stroke.blendMode)}`;
  const attributes = strokeAttributes(document, node, stroke, strokeIndex, gradientId).replace(/ stroke-dasharray="[^"]*"/, '');
  return decorations.map(item => {
    const role = ` data-tiny-image-star-decoration="${item.type}" data-tiny-image-star-decoration-end="${item.side}"`;
    if (item.type === 'circle') {
      return `<circle${metadata}${role} cx="${number(item.center.x)}" cy="${number(item.center.y)}" r="${number(item.radius)}" fill="${escapeXml(value)}" fill-opacity="${number(stroke.opacity)}" stroke="none"/>`;
    }
    const path = `M ${number(item.points[0].x)} ${number(item.points[0].y)}${item.points.slice(1).map(point => ` L ${number(point.x)} ${number(point.y)}`).join('')}${item.closed ? ' Z' : ''}`;
    if (item.closed) {
      return `<path${metadata}${role} d="${path}" fill="${escapeXml(value)}" fill-opacity="${number(stroke.opacity)}" stroke="none"/>`;
    }
    return `<path${metadata}${role} d="${path}" fill="none"${attributes} stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
}

function shapeWithStrokeStackMarkup(node, document, measureText, gradientId = null, context = null, layerIndex = 0) {
  const base = { ...node, stroke: null, strokeWidth: 0, strokeOpacity: 1, strokes: [] };
  return shapeMarkup(base, document, measureText, gradientId, { includeStroke: false })
    + shapeStrokeStackMarkup(node, document, measureText, gradientId, context, layerIndex);
}

function radius(document, node) {
  const raw = Number(getNodePropertyValue(document, node, 'radius') ?? 0);
  if (!Number.isFinite(raw)) throw new TypeError(`SVG export requires a finite corner radius on layer ${node.name || node.id || '(unnamed)'}.`);
  const value = Math.max(0, raw);
  return Math.min(value, Number(node.width) / 2, Number(node.height) / 2);
}

function cornerRadii(document, node) {
  if (node.cornerRadii != null && !isValidCornerRadii(node.cornerRadii)) {
    throw new TypeError(`SVG export requires valid independent corner radii on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  const values = node.cornerRadii || Object.fromEntries(cornerRadiusKeys.map(key => [key, radius(document, node)]));
  return clampCornerRadii(node.width, node.height, values);
}

function cornerSmoothing(node) {
  const value = node.cornerSmoothing ?? 0;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`SVG export requires corner smoothing from 0 to 1 on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  return value;
}

function roundedRectMarkup(node, document, attributes = '') {
  const radii = cornerRadii(document, node);
  const smoothing = cornerSmoothing(node);
  if (!smoothing && cornerRadiusKeys.every(key => radii[key] === radii.topLeft)) {
    return `<rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" rx="${number(radii.topLeft)}" ry="${number(radii.topLeft)}"${attributes}/>`;
  }
  return `<path d="${roundedRectSvgPath(node.width, node.height, radii, smoothing)}"${attributes}/>`;
}

function unsupportedFeature(node, assets, imagePreviews = null, document = emptyDocument) {
  if (!supportedTypes.has(node.type)) return `${node.type || 'unknown'} layers`;
  const fillValidationNode = node.type === 'text' ? { ...node, type: 'rectangle' } : node;
  if (Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill?.blendMode != null && !isValidLayerBlendMode(fill.blendMode)) {
        throw new TypeError(`SVG export requires a supported fill blend mode on layer ${node.name || node.id || '(unnamed)'}.`);
      }
    }
    if (!isValidFillStack(node.fills, fillValidationNode, { isValidImageFill, isImageFillSupported })) {
      throw new TypeError(`SVG export requires a valid fill stack on layer ${node.name || node.id || '(unnamed)'}.`);
    }
    for (let index = 0; index < node.fills.length; index += 1) {
      const fill = node.fills[index];
      if (fill.type !== 'image' || !fill.visible || fill.opacity <= 0) continue;
      const problem = unsupportedImageFill(fillValidationNode, fill.imageFill, assets, imagePreviews, imagePreviewKey(node.id, fill.id));
      if (problem) return problem;
    }
  }
  if (node.type === 'text' && Array.isArray(node.strokes) && !isValidStrokeStack(node.strokes, node)) {
    return 'invalid text stroke stacks';
  }
  for (const stroke of strokeStackForNode(node)) {
    if (stroke?.blendMode != null && !isValidLayerBlendMode(stroke.blendMode)) {
      throw new TypeError(`SVG export requires a supported stroke blend mode on layer ${node.name || node.id || '(unnamed)'}.`);
    }
  }
  if (node.type === 'image' || (!Array.isArray(node.fills) && node.imageFill)) {
    if (node.imageFill && (!isImageFillSupported(node) || !isValidImageFill(node.imageFill))) return 'image fills';
    const image = resolveLocalImage(node, assets, node.type === 'image' ? node.assetId : node.imageFill?.assetId, imagePreviews);
    if (image.error) return image.error;
    const adjustments = node.type === 'image' ? node.adjustments : node.imageFill.adjustments;
    if (!image.isPreview && adjustments && Object.values(adjustments).some(value => Number(value) !== 0)) return 'raster image adjustments';
    const transforms = node.type === 'image' ? node.transforms : node.imageFill.transforms;
    if (transforms != null && !isValidImageTransforms(transforms)) throw new TypeError(`SVG export requires valid image transforms on layer ${node.name || node.id || '(unnamed)'}.`);
    const fit = imageFit(node);
    if (!['cover', 'contain', 'tile'].includes(fit)) return node.type === 'image' ? 'image layer fit mode' : 'image fill fit mode';
    const scalingFactor = node.type === 'image' ? node.scalingFactor : node.imageFill?.scalingFactor;
    if (fit === 'tile' && scalingFactor != null && !isValidImageTileScale(scalingFactor)) {
      throw new TypeError(`SVG export requires a valid image tile scale on layer ${node.name || node.id || '(unnamed)'}.`);
    }
    if (!(image.width > 0) || !(image.height > 0)) return node.type === 'image' ? 'image layers' : 'image fills';
    if (node.imageFill && (!Number.isFinite(Number(node.fillOpacity ?? 1)) || Number(node.fillOpacity ?? 1) < 0 || Number(node.fillOpacity ?? 1) > 1)) {
      throw new TypeError(`SVG export requires valid fill opacity on layer ${node.name || node.id || '(unnamed)'}.`);
    }
  }
  if (!Array.isArray(node.fills) && node.fillGradient && !['frame', 'section', 'group', 'rectangle', 'ellipse', 'star', 'polygon', 'network', 'boolean'].includes(node.type)
    && !(node.type === 'path' && hasFillablePathContour(node))) return 'gradient fills';
  if (!Array.isArray(node.fills) && node.type === 'network' && node.fillGradient && !(node.faces || []).length) return 'gradient fills on open vector networks';
  if (node.effects != null && !isValidLayerEffects(node.effects)) throw new TypeError(`SVG export requires valid layer effects on layer ${node.name || node.id || '(unnamed)'}.`);
  if (node.effects?.some(effect => effect.type === 'drop-shadow' && effect.visible !== false
    && effect.opacity > 0 && effect.showShadowBehindNode !== true)
    && !svgDropShadowClipIsRedundant(node, document)) {
    return 'drop shadows hidden behind transparent node geometry (enable “Show behind transparent areas” for editable SVG export, or use raster export to preserve the current appearance)';
  }
  const hasVisiblePaintedStroke = strokeStackForNode(node).some(stroke => stroke?.visible !== false
    && Number(stroke.opacity ?? 1) > 0 && Number(stroke.width) > 0
    && (stroke.gradient || (stroke.color && stroke.color !== 'transparent')));
  if (['star', 'polygon'].includes(node.type) && hasVisiblePaintedStroke
    && node.effects?.some(effect => effect.type === 'inner-shadow' && effect.visible !== false && effect.opacity > 0)
    && !canExportPhasedLayerPaint(node, document)) {
    return 'inner shadows on regular shapes with incompatible fill, stroke, or corner geometry (use a plain shape with one compatible stroke, or raster export to preserve the current appearance)';
  }
  if (node.effects?.some(effect => effect.visible !== false && effect.blendMode && effect.blendMode !== 'normal')) {
    return 'per-effect blend modes (editable SVG filters cannot blend an individual effect against the live scene backdrop; use raster export or reset the effect blend mode to Normal)';
  }
  if (node.effects?.some(effect => effect.type === 'noise' && effect.visible !== false)) {
    return 'noise effects (random pixel grain cannot be represented by editable SVG filters; rasterize the layer or hide/remove the effect)';
  }
  if (node.effects?.some(effect => effect.type === 'texture' && effect.visible !== false)) {
    return 'texture effects (deterministic edge distress cannot be represented by editable SVG geometry; rasterize the layer or hide/remove the effect)';
  }
  if (node.effects?.some(effect => effect.type === 'layer-blur' && effect.visible !== false && effect.blurType === 'PROGRESSIVE')) {
    return 'progressive layer blur (editable SVG filters cannot vary blur radius across a layer; use raster export or change the effect to Uniform)';
  }
  if (glassVectorExportBlockReason(node)) return `Glass effects (${glassVectorExportBlockReason(node)})`;
  if (node.effects?.some(effect => effect.type === 'background-blur' && effect.visible !== false)) {
    return 'background blur effects (editable SVG filters cannot sample the pixels behind a layer)';
  }
  if (node.blendMode != null && !isValidLayerBlendMode(node.blendMode)) throw new TypeError(`SVG export requires a supported blend mode on layer ${node.name || node.id || '(unnamed)'}.`);
  if (!Array.isArray(node.fills) && node.fillGradient && !isValidGradientFill(node.fillGradient)) throw new TypeError(`SVG export requires a valid gradient fill on layer ${node.name || node.id || '(unnamed)'}.`);
  if (node.type === 'boolean') {
    if (!['union', 'subtract', 'intersect', 'exclude'].includes(node.operation || 'union')) return `Boolean ${node.operation || 'unknown'} operations`;
    if (!Array.isArray(node.children) || node.children.length < 2) return 'invalid Boolean group structures';
    const validOperand = child => child && ['rectangle', 'ellipse', 'star', 'polygon', 'path', 'network', 'text', 'boolean'].includes(child.type)
      && (child.type !== 'path' || hasOnlyClosedPathContours(child))
      && (child.type !== 'network' || (child.faces || []).length > 0);
    if (node.children.some(child => !validOperand(child))) return 'unsupported Boolean operands';
    const hiddenIntersection = (node.operation || 'union') === 'intersect' && node.children.some(child => !isNodeVisible(document, child));
    if (!hiddenIntersection && node.children.some(child => isNodeVisible(document, child)
      && ((child.blendMode || 'normal') !== 'normal' || hasNonNormalPaintBlend(child)))) return 'blended Boolean operands';
  }
  if (node.type === 'group' && node.maskSourceId && !node.mask) return 'mask groups';
  return null;
}

function isNodeVisible(document, node) {
  return getNodePropertyValue(document, node, 'visible') !== false;
}

// Opaque vector paint fully covers the shadow wherever the geometry mask clips
// it. In that restricted case an ordinary SVG drop-shadow (painted below the
// shape) has the same visible result. Keep every alpha-bearing or more complex
// paint path fail-closed.
function svgDropShadowClipIsRedundant(node, document) {
  const path = node.type === 'path';
  const regularShape = ['star', 'polygon'].includes(node.type);
  if (!['rectangle', 'ellipse', 'path', 'star', 'polygon'].includes(node.type)
    || node.children?.length
    || node.mask || node.maskSourceId
    || Array.isArray(node.fills) || node.fillGradient || node.imageFill
    || !path && !regularShape && ((node.strokes?.length ?? 0) > 0 || Number(node.strokeWidth ?? 0) !== 0)
    || (getNodePropertyValue(document, node, 'opacity') ?? node.opacity ?? 1) !== 1
    || (getNodePropertyValue(document, node, 'fillOpacity') ?? node.fillOpacity ?? 1) !== 1
    || (node.blendMode != null && node.blendMode !== 'normal')
    || hasNonNormalPaintBlend(node)
    || node.effects?.some(effect => effect.visible !== false
      && !['drop-shadow', 'inner-shadow', 'layer-blur'].includes(effect.type))) return false;
  if (path && !svgPathDropShadowClipIsRedundant(node, document)) return false;
  if (regularShape && !hasPlainRegularShapeGeometry(node, document)) return false;
  if (regularShape && !svgVectorDropShadowClipIsRedundant(node, document)) return false;
  if (node.type === 'ellipse' && (node.arcData
    && (Math.abs(node.arcData.endingAngle - node.arcData.startingAngle - Math.PI * 2) > 1e-9
      || node.arcData.innerRadius !== 0))) return false;
  if (node.type === 'rectangle'
    && (node.cornerRadii != null || (node.cornerSmoothing ?? 0) !== 0)) return false;
  return color(document, node, 'fill') !== 'transparent';
}

const svgMaskSourceTypes = new Set(['rectangle', 'ellipse', 'star', 'polygon', 'path', 'network', 'text', 'image', 'group', 'frame', 'section']);
const svgVectorMaskSourceTypes = new Set(['rectangle', 'ellipse', 'star', 'polygon', 'line', 'path', 'network']);
const svgLuminanceMaskSourceTypes = new Set(['rectangle', 'ellipse', 'star', 'polygon', 'line', 'path']);

function validateMaskGroup(node, document, assets, imagePreviews) {
  if (node.type !== 'group' || !Array.isArray(node.children) || node.children.length < 1 || typeof node.maskSourceId !== 'string') {
    throw new SvgExportError('mask groups', node);
  }
  if (!(Number(node.width) > 0) || !(Number(node.height) > 0)) throw new SvgExportError('zero-size mask groups', node);
  const source = node.children.find(child => child?.id === node.maskSourceId);
  if (!source) throw new SvgExportError('mask groups with a missing source', node);
  if (!isNodeVisible(document, source)) return source;
  const maskMode = node.maskMode || 'alpha';
  if (!['alpha', 'vector', 'luminance'].includes(maskMode)) throw new SvgExportError('unknown mask modes', node);
  if (maskMode === 'vector') {
    if (!svgVectorMaskSourceTypes.has(source.type) || !isMaskSource(source, 'vector')) {
      throw new SvgExportError(`${source.type || 'unknown'} vector mask contents`, source);
    }
    dimensions({ ...source, ...getNodeGeometry(document, source) });
    return source;
  }
  if (maskMode === 'luminance') {
    if (!svgLuminanceMaskSourceTypes.has(source.type)) throw new SvgExportError(`${source.type || 'unknown'} luminance mask contents`, source);
    if (Array.isArray(source.fills) || Array.isArray(source.strokes)) throw new SvgExportError('ordered paint stacks in luminance masks', source);
    if ((source.effects || []).some(effect => effect.visible !== false)
      || hasNonNormalPaintBlend(source) || (source.blendMode || 'normal') !== 'normal') {
      throw new SvgExportError('effects or blend modes in luminance masks', source);
    }
    if (source.type === 'path' && !hasFillablePathContour(source)
      && !(source.stroke && Number(source.strokeWidth) > 0)) {
      throw new SvgExportError('open, unpainted path luminance mask contents', source);
    }
    dimensions({ ...source, ...getNodeGeometry(document, source) });
    return source;
  }
  if (!svgMaskSourceTypes.has(source.type)) throw new SvgExportError(`${source.type || 'unknown'} alpha mask contents`, source);
  if (['image', 'group', 'frame', 'section'].includes(source.type)) {
    const unsupported = unsupportedFeature(source, assets, imagePreviews, document);
    if (unsupported) throw new SvgExportError(unsupported, source);
    if (source.children?.length) validateTree(source.children, document, assets, imagePreviews, new Set(), true);
  }
  if (source.type === 'path' && !hasFillablePathContour(source)) throw new SvgExportError('open path alpha mask contents', source);
  if (source.type === 'network' && !(source.faces || []).length) throw new SvgExportError('open vector network alpha mask contents', source);
  if (hasNonNormalPaintBlend(source)) throw new SvgExportError('paint blend modes in alpha-mask content', source);
  if ((source.blendMode || 'normal') !== 'normal') throw new SvgExportError('blended alpha mask contents', source);
  const fillOpacity = Number(source.fillOpacity ?? 1);
  if (!Number.isFinite(fillOpacity) || fillOpacity < 0 || fillOpacity > 1) {
    throw new TypeError(`SVG export requires valid fill opacity on alpha mask source ${source.name || source.id || '(unnamed)'}.`);
  }
  const opacity = Number(getNodePropertyValue(document, source, 'opacity') ?? 1);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new TypeError(`SVG export requires valid opacity on alpha mask source ${source.name || source.id || '(unnamed)'}.`);
  }
  dimensions({ ...source, ...getNodeGeometry(document, source) });
  return source;
}

function validateTree(nodes, document, assets, imagePreviews = null, ignoredNodeIds = new Set(), hasIsolatedPaintAncestor = false) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') throw new TypeError('SVG export received an invalid layer.');
    if (node.type === 'slice') continue;
    if (ignoredNodeIds.has(node.id)) continue;
    if (!isNodeVisible(document, node)) continue;
    const maskSource = node.mask ? validateMaskGroup(node, document, assets, imagePreviews) : null;
    const unsupported = unsupportedFeature(node, assets, imagePreviews, document);
    if (unsupported) throw new SvgExportError(unsupported, node);
    const nodeCreatesPaintIsolation = isolatesSvgPaintBackdrop(document, node, maskSource)
      || node.type === 'boolean';
    if (hasNonNormalPaintBlend(node) && (hasIsolatedPaintAncestor || nodeCreatesPaintIsolation)) {
      throw new SvgExportError('paint blend modes whose backdrop crosses an isolated SVG layer boundary (remove the isolating opacity, effect, mask, layer blend, or Boolean compositing, or use raster export)', node);
    }
    dimensions({ ...node, ...getNodeGeometry(document, node) });
    if (!Array.isArray(node.children || [])) throw new TypeError(`SVG export requires a child layer list on ${node.name || node.id || '(unnamed)'}.`);
    const ignoredChildren = maskSource ? new Set([...ignoredNodeIds, maskSource.id]) : ignoredNodeIds;
    validateTree(node.children || [], document, assets, imagePreviews, ignoredChildren,
      hasIsolatedPaintAncestor || nodeCreatesPaintIsolation);
  }
}

function shapeMarkup(node, document, measureText, gradientId = null, { fillValue, fillOpacity, includeStroke = true, strokeItem, strokeIndex = 0, strokeGradientId = null } = {}) {
  const fill = fillAttributes(document, node, { text: node.type === 'text', gradientId, fillValue, fillOpacity });
  const stroke = includeStroke ? strokeAttributes(document, node, strokeItem, strokeIndex, strokeGradientId) : '';
  switch (node.type) {
    case 'frame':
    case 'section':
    case 'group':
    case 'rectangle': {
      return roundedRectMarkup(node, document, `${fill}${stroke}`);
    }
    case 'boolean':
      return `<rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" rx="0" ry="0"${fill}${stroke}/>`;
    case 'ellipse': {
      const arcPath = ellipseArcSvgPathData(node);
      if (arcPath) return `<path d="${arcPath}" fill-rule="evenodd"${fill}${stroke}/>`;
      if (node.arcData && Math.abs(node.arcData.endingAngle - node.arcData.startingAngle) <= 1e-9) {
        return `<path d="" fill-rule="evenodd"${fill}${stroke}/>`;
      }
      return `<ellipse cx="${number(node.width / 2)}" cy="${number(node.height / 2)}" rx="${number(node.width / 2)}" ry="${number(node.height / 2)}"${fill}${stroke}/>`;
    }
    case 'line':
      return node.lineReverseY === true
        ? `<path d="M 0 ${number(node.height)} L ${number(node.width)} 0" fill="none"${stroke}/>`
        : `<path d="M 0 0 L ${number(node.width)} ${number(node.height)}" fill="none"${stroke}/>`;
    case 'star': {
      const count = Math.max(MIN_STAR_POINTS, Math.min(MAX_STAR_POINTS, Number(node.points) || 5));
      const inner = node.innerRadius == null ? 0.48 : Number(node.innerRadius);
      if (!Number.isFinite(inner) || inner < 0 || inner > 1) throw new TypeError(`SVG export requires a valid star ratio on layer ${node.name || node.id || '(unnamed)'}.`);
      const vertices = regularShapeVertices('star', node.width, node.height, count, inner);
      const shapeRadius = Number(getNodePropertyValue(document, node, 'radius') ?? node.radius ?? 0);
      const smoothing = cornerSmoothing(node);
      if (!Number.isFinite(shapeRadius) || shapeRadius < 0 || shapeRadius > 100_000) throw new TypeError(`SVG export requires a valid corner radius on layer ${node.name || node.id || '(unnamed)'}.`);
      if (node.vertexRadii != null && !isValidVertexRadii('star', count, node.vertexRadii)) throw new TypeError(`SVG export requires valid per-vertex radii on layer ${node.name || node.id || '(unnamed)'}.`);
      if (shapeRadius || smoothing || node.vertexRadii?.some(value => value > 0)) return `<path d="${roundedPolygonSvgPath(vertices, node.vertexRadii || shapeRadius, smoothing)}"${fill}${stroke}/>`;
      const points = vertices.map(vertex => `${number(vertex.x)},${number(vertex.y)}`).join(' ');
      return `<polygon points="${points}"${fill}${stroke}/>`;
    }
    case 'polygon': {
      const count = Math.max(MIN_STAR_POINTS, Math.min(MAX_POLYGON_POINTS, Number(node.points) || 6));
      const vertices = regularShapeVertices('polygon', node.width, node.height, count);
      const shapeRadius = Number(getNodePropertyValue(document, node, 'radius') ?? node.radius ?? 0);
      const smoothing = cornerSmoothing(node);
      if (!Number.isFinite(shapeRadius) || shapeRadius < 0 || shapeRadius > 100_000) throw new TypeError(`SVG export requires a valid corner radius on layer ${node.name || node.id || '(unnamed)'}.`);
      if (node.vertexRadii != null && !isValidVertexRadii('polygon', count, node.vertexRadii)) throw new TypeError(`SVG export requires valid per-vertex radii on layer ${node.name || node.id || '(unnamed)'}.`);
      if (shapeRadius || smoothing || node.vertexRadii?.some(value => value > 0)) return `<path d="${roundedPolygonSvgPath(vertices, node.vertexRadii || shapeRadius, smoothing)}"${fill}${stroke}/>`;
      const points = vertices.map(vertex => `${number(vertex.x)},${number(vertex.y)}`).join(' ');
      return `<polygon points="${points}"${fill}${stroke}/>`;
    }
    case 'path': {
      const contours = vectorPathContours(node);
      if (contours.every(contour => contour.points.length < 2)) return '';
      const point = (item, part) => {
        const anchor = { x: Number(item.x) * node.width, y: Number(item.y) * node.height };
        const handle = item[part];
        return handle ? { x: anchor.x + Number(handle.x || 0) * node.width, y: anchor.y + Number(handle.y || 0) * node.height } : anchor;
      };
      let path = '';
      for (const contour of contours) {
        const points = contour.points || [];
        if (points.length < 2) continue;
        path += `${path ? ' ' : ''}M ${number(point(points[0], 'anchor').x)} ${number(point(points[0], 'anchor').y)}`;
        const segments = contour.closed ? points.length : points.length - 1;
        for (let index = 0; index < segments; index += 1) {
          const previous = points[index];
          const current = points[(index + 1) % points.length];
          const end = point(current, 'anchor');
          const c1 = point(previous, 'out');
          const c2 = point(current, 'in');
          if (previous.out || current.in) path += ` C ${number(c1.x)} ${number(c1.y)} ${number(c2.x)} ${number(c2.y)} ${number(end.x)} ${number(end.y)}`;
          else path += ` L ${number(end.x)} ${number(end.y)}`;
        }
        if (contour.closed) path += ' Z';
      }
      const pathFill = hasFillablePathContour(node) ? fill : ' fill="none"';
      const fillRule = node.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
      return `<path d="${path}"${pathFill}${fillRule}${stroke}/>`;
    }
    case 'network':
      // Network faces and edges are emitted individually below so SVG retains their graph topology.
      return '';
    case 'text':
      return textMarkup(node, document, measureText, { fillValue, fillOpacity, includeStroke });
    default:
      return '';
  }
}

function networkEdgePath(node, edge) {
  const points = vectorNetworkEdgePoints(node, edge.id, { x: 0, y: 0 });
  if (!points) throw new TypeError(`SVG export requires valid vector network edges on layer ${node.name || node.id || '(unnamed)'}.`);
  const [start, control1, control2, end] = points;
  const d = edge.control1 || edge.control2
    ? `M ${number(start.x)} ${number(start.y)} C ${number(control1.x)} ${number(control1.y)} ${number(control2.x)} ${number(control2.y)} ${number(end.x)} ${number(end.y)}`
    : `M ${number(start.x)} ${number(start.y)} L ${number(end.x)} ${number(end.y)}`;
  return d;
}

function networkFacePath(node, face, edgesByPair) {
  const rounded = vectorNetworkFacePathCommands(node, face, { x: 0, y: 0 });
  if (rounded) {
    let d = `M ${number(rounded.start.x)} ${number(rounded.start.y)}`;
    for (const command of rounded.commands) {
      if (command.type === 'line') d += ` L ${number(command.end.x)} ${number(command.end.y)}`;
      else if (command.type === 'cubic') d += ` C ${number(command.control1.x)} ${number(command.control1.y)} ${number(command.control2.x)} ${number(command.control2.y)} ${number(command.end.x)} ${number(command.end.y)}`;
      else if (command.type === 'arc') {
        const sweep = command.endAngle - command.startAngle;
        const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
        const sweepFlag = sweep >= 0 ? 1 : 0;
        d += ` A ${number(command.radius)} ${number(command.radius)} 0 ${largeArc} ${sweepFlag} ${number(command.end.x)} ${number(command.end.y)}`;
      }
    }
    return `${d} Z`;
  }

  const ids = face.vertexIds || [];
  if (ids.length < 3) throw new TypeError(`SVG export requires valid vector network faces on layer ${node.name || node.id || '(unnamed)'}.`);
  const first = vectorNetworkVertexPoint(node, ids[0], { x: 0, y: 0 });
  if (!first) throw new TypeError(`SVG export requires valid vector network vertices on layer ${node.name || node.id || '(unnamed)'}.`);
  let d = `M ${number(first.x)} ${number(first.y)}`;
  for (let index = 0; index < ids.length; index += 1) {
    const fromId = ids[index]; const toId = ids[(index + 1) % ids.length];
    const edge = edgesByPair.get(`${fromId}\0${toId}`);
    const end = vectorNetworkVertexPoint(node, toId, { x: 0, y: 0 });
    if (!edge || !end) throw new TypeError(`SVG export requires each vector network face boundary to follow an edge on layer ${node.name || node.id || '(unnamed)'}.`);
    const points = vectorNetworkEdgePoints(node, edge.id, { x: 0, y: 0 });
    const reversed = edge.from !== fromId;
    const control1 = points[reversed ? 2 : 1]; const control2 = points[reversed ? 1 : 2];
    if (edge.control1 || edge.control2) d += ` C ${number(control1.x)} ${number(control1.y)} ${number(control2.x)} ${number(control2.y)} ${number(end.x)} ${number(end.y)}`;
    else d += ` L ${number(end.x)} ${number(end.y)}`;
  }
  return `${d} Z`;
}

function networkEdgesByPair(node) {
  const result = new Map();
  for (const edge of node.edges || []) {
    if (!edge || typeof edge.id !== 'string' || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      throw new TypeError(`SVG export requires valid vector network edges on layer ${node.name || node.id || '(unnamed)'}.`);
    }
    if (!result.has(`${edge.from}\0${edge.to}`)) result.set(`${edge.from}\0${edge.to}`, edge);
    if (!result.has(`${edge.to}\0${edge.from}`)) result.set(`${edge.to}\0${edge.from}`, edge);
  }
  return result;
}

function networkMarkup(node, document, gradientId = null, { includeFills = true, context = null, layerIndex = 0 } = {}) {
  const faces = node.faces || [];
  const edgesByPair = networkEdgesByPair(node);
  const roundedFaces = faces.map((face, index) => ({
    face, index, d: vectorNetworkFacePathCommands(node, face, { x: 0, y: 0 })
  })).filter(item => item.d);
  const roundedEdgeIds = new Set(roundedFaces.flatMap(({ face }) => {
    const ids = face.vertexIds || [];
    return ids.map((from, index) => edgesByPair.get(`${from}\0${ids[(index + 1) % ids.length]}`)?.id).filter(Boolean);
  }));
  let markup = '';
  const fillOpacity = Number(node.fillOpacity ?? 1);
  if (!Number.isFinite(fillOpacity) || fillOpacity < 0 || fillOpacity > 1) {
    throw new TypeError(`SVG export requires valid fill opacity on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  if (includeFills) faces.forEach((face, index) => {
    const path = networkFacePath(node, face, edgesByPair);
    const value = face.fill == null ? (gradientId ? null : color(document, node, 'fill')) : face.fill;
    const fill = gradientId && face.fill == null ? `url(#${gradientId})` : value === 'transparent' ? 'none' : color(document, { ...node, fill: value, fillVariableId: null, fillStyleId: null }, 'fill');
    const faceOpacity = Number(face.fillOpacity ?? 1);
    if (!Number.isFinite(faceOpacity) || faceOpacity < 0 || faceOpacity > 1) throw new TypeError(`SVG export requires valid face fill opacity on layer ${node.name || node.id || '(unnamed)'}.`);
    markup += `<path data-tiny-image-star-face-id="${escapeXml(face.id || index)}" d="${path}" fill="${escapeXml(fill)}" fill-opacity="${number(fillOpacity * faceOpacity)}"/>`;
  });
  const strokeEntries = Array.isArray(node.strokes) ? strokeStackForNode(node) : [null];
  for (let strokeIndex = 0; strokeIndex < strokeEntries.length; strokeIndex += 1) {
    const strokeItem = strokeEntries[strokeIndex];
    if (strokeItem && (!strokeItem.visible || strokeItem.opacity <= 0 || strokeItem.width <= 0 || (!strokeItem.gradient && (!strokeItem.color || strokeItem.color === 'transparent')))) continue;
    const strokeGradientId = addStrokeGradientDefinition(node, strokeItem, strokeIndex, layerIndex, context);
    const stroke = strokeItem ? strokeAttributes(document, node, strokeItem, strokeIndex, strokeGradientId) : strokeAttributes(document, node);
    const strokeMetadata = strokeItem ? ` data-tiny-image-star-stroke-id="${escapeXml(strokeItem.id)}" data-tiny-image-star-stroke-order="${strokeIndex}"${paintBlendStyle(strokeItem.blendMode)}` : '';
    for (const { face, index } of roundedFaces) {
      const edgeIds = (face.vertexIds || []).map((from, faceIndex) => (
        edgesByPair.get(`${from}\0${face.vertexIds[(faceIndex + 1) % face.vertexIds.length]}`)?.id
      )).filter(Boolean).join(' ');
      markup += `<path data-tiny-image-star-face-id="${escapeXml(face.id || index)}" data-tiny-image-star-edge-ids="${escapeXml(edgeIds)}"${strokeMetadata} d="${networkFacePath(node, face, edgesByPair)}" fill="none"${stroke}/>`;
    }
    for (const edge of node.edges || []) {
      if (roundedEdgeIds.has(edge.id)) continue;
      markup += `<path data-tiny-image-star-edge-id="${escapeXml(edge.id)}" data-tiny-image-star-from="${escapeXml(edge.from)}" data-tiny-image-star-to="${escapeXml(edge.to)}"${strokeMetadata} d="${networkEdgePath(node, edge)}" fill="none"${stroke}/>`;
    }
    if (strokeItem) markup += strokeDecorationMarkup(node, document, strokeItem, strokeIndex, strokeGradientId);
  }
  return markup;
}

function stackSolidValue(document, node, fill, index) {
  const linkedPrimary = index === 0 && (node.fillStyleId || node.fillVariableId || node.variableBindings?.fill);
  const value = linkedPrimary ? color(document, node, 'fill') : fill.color;
  if (value === 'transparent') return value;
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
    throw new TypeError(`SVG export supports solid hexadecimal colors only on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  return value;
}

function markFillMarkup(markup, fill) {
  if (!markup) return '';
  const metadata = ` data-tiny-image-star-fill-id="${escapeXml(fill.id)}" data-tiny-image-star-fill-type="${escapeXml(fill.type)}"`;
  const attributes = `${metadata}${paintBlendStyle(fill.blendMode)}`;
  if (markup.startsWith('<g')) return markup.replace(/^<g(?=[\s>])/, `<g${attributes}`);
  return markup.replace(/\/>$/, `${attributes}/>`);
}

function paintBlendStyle(mode) {
  return mode && mode !== 'normal' ? ` style="mix-blend-mode:${mode}"` : '';
}

function hasNonNormalPaintBlend(node) {
  const fills = Array.isArray(node.fills) ? node.fills : [];
  const strokes = strokeStackForNode(node);
  return fills.some(fill => fill?.blendMode && fill.blendMode !== 'normal')
    || strokes.some(stroke => stroke?.blendMode && stroke.blendMode !== 'normal');
}

function isolatesSvgPaintBackdrop(document, node, maskSource = null) {
  // SVG paint blend modes use prior painted scene content as their backdrop.
  // Opacity below one, filters, non-normal layer blending, and masks isolate a
  // group, so descendants cannot see the same backdrop as the live canvas.
  const opacity = Number(getNodePropertyValue(document, node, 'opacity') ?? 1);
  return (Number.isFinite(opacity) && opacity < 1)
    || (node.blendMode != null && node.blendMode !== 'normal')
    || Boolean(maskSource && isNodeVisible(document, maskSource))
    || Boolean(node.effects?.some(effect => effect.visible !== false));
}

function renderShapeFillStack(node, document, context, index, measureText, { includeStrokes = true } = {}) {
  if (node.type === 'text') return renderTextFillStack(node, document, context, index, measureText);
  const fills = node.fills;
  let markup = '';
  let hasImage = false;
  const clipId = `tis-fill-clip-${index}`;
  for (let fillIndex = 0; fillIndex < fills.length; fillIndex += 1) {
    const fill = fills[fillIndex];
    if (!fill.visible || fill.opacity <= 0) continue;
    if (fill.type === 'image') {
      hasImage = true;
      const image = resolveLocalImage(node, context.assets, fill.imageFill.assetId, context.imagePreviews, imagePreviewKey(node.id, fill.id));
      const fit = fill.imageFill.fit;
      const attributes = ` opacity="${number(fill.opacity)}" clip-path="url(#${clipId})"`;
      const imageMarkup = fit === 'tile'
        ? imageTileRectMarkup({
          image, width: node.width, height: node.height,
          assets: context.assets, assetId: fill.imageFill.assetId,
          scalingFactor: fill.imageFill.scalingFactor,
          transforms: fill.imageFill.transforms,
          id: `tis-image-tile-${index}-fill-${fillIndex}`, attributes, context
        })
        : rasterImageMarkup({
          image, width: node.width, height: node.height, fit,
          transforms: image.isPreview ? {} : fill.imageFill.transforms,
          attributes
        });
      markup += markFillMarkup(imageMarkup, fill);
      continue;
    }
    let gradientId = null;
    let value;
    if (fill.type === 'solid') value = stackSolidValue(document, node, fill, fillIndex);
    else {
      const gradient = gradientDefinition(node, index, fill.gradient, `tis-gradient-${index}-fill-${fillIndex}`);
      if (gradient) {
        gradientId = gradient.id;
        context.defs.push(gradient.markup);
      }
    }
    const painted = shapeMarkup(node, document, measureText, gradientId, {
      fillValue: value,
      fillOpacity: fill.opacity,
      includeStroke: false
    });
    markup += markFillMarkup(painted, fill);
  }
  if (hasImage) {
    const clipNode = {
      ...node, fill: '#ffffff', fillOpacity: 1, fillGradient: null, imageFill: null,
      fillStyleId: null, fillVariableId: null, stroke: null, strokeWidth: 0, variableBindings: {}
    };
    context.defs.push(`<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${shapeMarkup(clipNode, emptyDocument, measureText, null, { fillValue: '#ffffff', fillOpacity: 1, includeStroke: false })}</clipPath>`);
  }
  // Strokes belong to the shape, not to individual fills. Each ordered stroke
  // is emitted after the full fill stack so later strokes remain on top.
  if (includeStrokes) {
    markup += Array.isArray(node.strokes)
      ? shapeStrokeStackMarkup(node, document, measureText, null, context, index)
      : shapeMarkup(node, document, measureText, null, { fillValue: 'transparent', fillOpacity: 0 });
  }
  return markup;
}

function renderNetworkFillStack(node, document, context, index) {
  const fills = node.fills;
  const edgesByPair = networkEdgesByPair(node);
  let markup = '';
  for (let fillIndex = 0; fillIndex < fills.length; fillIndex += 1) {
    const fill = fills[fillIndex];
    if (!fill.visible || fill.opacity <= 0) continue;
    let gradientId = null;
    let image = null;
    if (gradientTypes.has(fill.type)) {
      const gradient = gradientDefinition(node, index, fill.gradient, `tis-gradient-${index}-fill-${fillIndex}`);
      if (gradient) {
        gradientId = gradient.id;
        context.defs.push(gradient.markup);
      }
    } else if (fill.type === 'image') {
      image = resolveLocalImage(node, context.assets, fill.imageFill.assetId, context.imagePreviews, imagePreviewKey(node.id, fill.id));
    }
    const tilePaint = fill.type === 'image' && fill.imageFill.fit === 'tile'
      ? addImageTilePattern(context, image, context.assets, fill.imageFill.assetId,
        fill.imageFill.scalingFactor, fill.imageFill.transforms, `tis-image-tile-${index}-fill-${fillIndex}`)
      : null;
    (node.faces || []).forEach((face, faceIndex) => {
      const faceOpacity = Number(face.fillOpacity ?? 1);
      if (!Number.isFinite(faceOpacity) || faceOpacity < 0 || faceOpacity > 1) {
        throw new TypeError(`SVG export requires valid face fill opacity on layer ${node.name || node.id || '(unnamed)'}.`);
      }
      const path = networkFacePath(node, face, edgesByPair);
      const faceId = escapeXml(face.id || faceIndex);
      if (fill.type === 'image') {
        const faceClipId = `tis-fill-clip-${index}-${fillIndex}-${faceIndex}`;
        context.defs.push(`<clipPath id="${faceClipId}" clipPathUnits="userSpaceOnUse"><path d="${path}"/></clipPath>`);
        const attributes = ` opacity="${number(fill.opacity * faceOpacity)}" clip-path="url(#${faceClipId})" data-tiny-image-star-face-id="${faceId}"`;
        const imageMarkup = tilePaint
          ? `<rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" fill="${tilePaint}"${attributes}/>`
          : rasterImageMarkup({
            image, width: node.width, height: node.height, fit: fill.imageFill.fit,
            transforms: image.isPreview ? {} : fill.imageFill.transforms,
            attributes
          });
        markup += markFillMarkup(imageMarkup, fill);
      } else {
        let paint;
        if (fill.type === 'solid') {
          paint = fillIndex === 0 && face.fill != null
            ? color(document, { ...node, fill: face.fill, fillVariableId: null, fillStyleId: null, variableBindings: {} }, 'fill')
            : stackSolidValue(document, node, fill, fillIndex);
          paint = paint === 'transparent' ? 'none' : paint;
        } else paint = `url(#${gradientId})`;
        markup += `<path data-tiny-image-star-face-id="${faceId}" d="${path}" fill="${escapeXml(paint)}" fill-opacity="${number(fill.opacity * faceOpacity)}" data-tiny-image-star-fill-id="${escapeXml(fill.id)}" data-tiny-image-star-fill-type="${escapeXml(fill.type)}"${paintBlendStyle(fill.blendMode)}/>`;
      }
    });
  }
  // Emit network edges once, after all face paints.
  return markup + networkMarkup(node, document, null, { includeFills: false, context, layerIndex: index });
}

function textLines(node, document, measureText) {
  const sourceText = String(getNodePropertyValue(document, node, 'text') ?? '');
  const text = transformTextCase(sourceText, node.textCase || 'none');
  const resolvedNode = {
    ...node,
    fontFamily: getNodePropertyValue(document, node, 'fontFamily'),
    fontWeight: getNodePropertyValue(document, node, 'fontWeight'),
    fontStyle: getNodePropertyValue(document, node, 'fontStyle'),
    paragraphSpacing: getNodePropertyValue(document, node, 'paragraphSpacing'),
    firstLineIndent: getNodePropertyValue(document, node, 'firstLineIndent')
  };
  const hasListMarker = Array.isArray(node.paragraphStyles) && node.paragraphStyles.some(paragraph => paragraph?.listStyle === 'bulleted' || paragraph?.listStyle === 'numbered');
  if (!text && !hasListMarker) {
    const fontSize = Number(getNodePropertyValue(document, node, 'fontSize') || 24);
    const lineHeight = resolvedLineHeight(getNodePropertyValue(document, node, 'lineHeight') || 1.25, fontSize, node.lineHeightUnit || 'ratio');
    return [{ displayText: '', index: 0, paragraphIndex: 0, firstLine: true, indent: 0, naturalWidth: 0, width: 0, y: 0, lineHeight }];
  }
  if (Number(node.width) <= 0) throw new TypeError(`SVG export cannot faithfully render text in a zero-width box on layer ${node.name || node.id || '(unnamed)'}.`);
  if (typeof measureText !== 'function') throw new TypeError(`SVG export requires canvas text measurement to match editor wrapping on layer ${node.name || node.id || '(unnamed)'}.`);

  const runs = node.textRuns;
  if (Array.isArray(runs) && runs.every(run => run && typeof run.text === 'string') && runs.map(run => run.text).join('') === sourceText) {
    const baseStyle = {
      fontFamily: resolvedNode.fontFamily || 'Arial, sans-serif',
      fontSize: getNodePropertyValue(document, node, 'fontSize') || 24,
      fontWeight: resolvedNode.fontWeight || 400,
      fontStyle: resolvedNode.fontStyle || 'normal',
      lineHeight: getNodePropertyValue(document, node, 'lineHeight') || 1.25,
      lineHeightUnit: node.lineHeightUnit || 'ratio',
      letterSpacing: getNodePropertyValue(document, node, 'letterSpacing') ?? 0,
      paragraphSpacing: resolvedNode.paragraphSpacing || 0,
      firstLineIndent: resolvedNode.firstLineIndent || 0,
      listSpacing: node.listSpacing || 0,
      paragraphStyles: node.paragraphStyles,
      textWrapStyle: node.textWrapStyle || 'auto',
      align: node.align || 'left',
      color: color(document, node, 'text'),
      textDecoration: node.textDecoration || 'none',
      textCase: node.textCase || 'none'
    };
    const layout = layoutTextRuns(runs, Math.max(1, Number(node.width)), baseStyle, (value, style) => {
      const measureNode = { ...resolvedNode, ...style, variableBindings: {} };
      return Number(measureText(value, measureNode));
    }, {
      textTruncation: node.textTruncation,
      maxLines: node.maxLines,
      maxHeight: node.maxHeight,
      boxHeight: node.height,
      textWrapStyle: node.textWrapStyle || 'auto'
    });
    for (const line of layout.lines) {
      if (![line.naturalWidth, line.width, line.y, line.lineHeight].every(Number.isFinite)
        || line.naturalWidth < 0 || line.width < 0 || line.y < 0 || line.lineHeight <= 0
        || line.parts.some(part => !Number.isFinite(part.offsetX) || !Number.isFinite(part.width) || part.width < 0)) {
        throw new TypeError(`SVG export requires finite text measurements on layer ${node.name || node.id || '(unnamed)'}.`);
      }
    }
    return layout.lines;
  }

  const fontSize = Number(getNodePropertyValue(document, node, 'fontSize') || 24);
  const lineHeight = resolvedLineHeight(getNodePropertyValue(document, node, 'lineHeight') || 1.25, fontSize, node.lineHeightUnit || 'ratio');
  const measure = line => Number(measureText(line, resolvedNode));
  const layout = layoutPlainText(text, Math.max(1, Number(node.width)), measure, {
    lineHeight,
    paragraphSpacing: resolvedNode.paragraphSpacing,
    firstLineIndent: resolvedNode.firstLineIndent,
    listSpacing: node.listSpacing,
    paragraphStyles: node.paragraphStyles,
    align: node.align || 'left',
    textWrapStyle: node.textWrapStyle || 'auto',
    textTruncation: node.textTruncation,
    maxLines: node.maxLines,
    maxHeight: node.maxHeight,
    boxHeight: node.height
  });
  return layout.lines.map(line => {
    const { displayText, index, indent } = line;
    const naturalWidth = measure(displayText);
    if (!Number.isFinite(naturalWidth) || naturalWidth < 0) throw new TypeError(`SVG export requires a finite text measurement on layer ${node.name || node.id || '(unnamed)'}.`);
    const availableWidth = Math.max(1, Number(node.width) - indent);
    return { ...line, naturalWidth, width: line.justify ? availableWidth : Math.min(availableWidth, naturalWidth) };
  });
}

function textVerticalOffset(node, lines, lineHeight) {
  const contentHeight = lines.reduce((height, line) => Math.max(height, Number(line.y || 0) + Number(line.lineHeight || lineHeight)), 0);
  const freeSpace = Math.max(0, Number(node.height) - contentHeight);
  if (node.verticalAlign === 'middle') return freeSpace / 2;
  if (node.verticalAlign === 'bottom') return freeSpace;
  return 0;
}

function clipTruncatedTextMarkup(node, markup, suffix = 'base') {
  if (node.textTruncation !== 'ending') return markup;
  const safeId = String(node.id || 'text').replace(/[^a-zA-Z0-9_-]/gu, '-');
  const safeSuffix = String(suffix).replace(/[^a-zA-Z0-9_-]/gu, '-');
  const clipId = `tis-text-clip-${safeId}-${safeSuffix}`;
  const width = Math.max(0, Number(node.width) || 0);
  const height = Math.max(0, Number(node.height) || 0);
  return `<defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="${number(width)}" height="${number(height)}"/></clipPath></defs><g clip-path="url(#${clipId})">${markup}</g>`;
}

function textLineStartX(node, line) {
  const width = Math.max(0, Number(node.width));
  const indent = Math.max(0, Number(line.indent) || 0);
  const availableWidth = Math.max(1, width - indent);
  const lineWidth = Math.max(0, Number(line.width) || 0);
  const align = line.align || node.align || 'left';
  if (align === 'center') return indent + (availableWidth - lineWidth) / 2;
  if (align === 'right') return indent + availableWidth - lineWidth;
  return indent;
}

function textLineAnchorX(node, line) {
  const start = textLineStartX(node, line);
  const align = line.align || node.align || 'left';
  if (align === 'center') return start + (Number(line.width) || 0) / 2;
  if (align === 'right') return start + (Number(line.width) || 0);
  return start;
}

function svgTextAnchor(align) {
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  return 'start';
}

function textListMarkerTspan(line, node, document, verticalOffset, fillOverride = undefined) {
  const marker = line.marker;
  if (!marker) return '';
  const style = marker.style || {
    fontFamily: getNodePropertyValue(document, node, 'fontFamily') || 'Arial, sans-serif',
    fontSize: Number(getNodePropertyValue(document, node, 'fontSize') || 24),
    fontWeight: getNodePropertyValue(document, node, 'fontWeight') || 400,
    fontStyle: getNodePropertyValue(document, node, 'fontStyle') === 'italic' ? 'italic' : 'normal',
    letterSpacing: getNodePropertyValue(document, node, 'letterSpacing') ?? 0,
    color: color(document, node, 'text')
  };
  const rawMarkerColor = fillOverride === undefined ? style.color || color(document, node, 'text') : fillOverride;
  const markerColor = rawMarkerColor === 'transparent' ? 'none' : rawMarkerColor;
  if (markerColor !== 'none' && !isSvgPaintValue(markerColor)) {
    throw new TypeError(`SVG export supports solid hexadecimal list marker colors only on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  const textLength = marker.width > 0 ? ` textLength="${number(marker.width)}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<tspan data-tiny-image-star-list-marker="${marker.listStyle || line.listStyle}" data-list-level="${line.listLevel}" x="${number(marker.anchorX)}" y="${number(line.y + verticalOffset)}" text-anchor="end" text-transform="none" font-family="${escapeXml(style.fontFamily || getNodePropertyValue(document, node, 'fontFamily') || 'Arial, sans-serif')}" font-size="${number(style.fontSize || getNodePropertyValue(document, node, 'fontSize') || 24)}" font-weight="${escapeXml(style.fontWeight || getNodePropertyValue(document, node, 'fontWeight') || 400)}" font-style="${style.fontStyle === 'italic' ? 'italic' : 'normal'}" letter-spacing="${number(style.letterSpacing ?? getNodePropertyValue(document, node, 'letterSpacing') ?? 0)}"${fontVariationAttribute(style.fontAxes || node.fontAxes)}${fontFeatureAttribute(style.fontFeatures || node.fontFeatures)} fill="${escapeXml(markerColor)}"${textLength}>${escapeXml(marker.text)}</tspan>`;
}

function isSvgPaintValue(value) {
  return typeof value === 'string'
    && (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) || value === 'none'
      || /^url\(#[-\w.]+\)$/u.test(value));
}

function richLineJustificationOffsets(line) {
  const segments = [];
  for (const part of line.parts) {
    for (const text of part.text.match(/\s+|\S+/gu) || []) segments.push({ text, part });
  }
  const offsets = new Map();
  let extraBefore = 0;
  let hasTextBefore = false;
  for (const [index, segment] of segments.entries()) {
    const { part, text } = segment;
    const metrics = offsets.get(part) || { before: extraBefore, within: 0 };
    if (/^\s+$/u.test(text)) {
      const nextText = segments.slice(index + 1).some(next => !/^\s+$/u.test(next.text));
      if (hasTextBefore && nextText) {
        const expanded = line.justificationExtraSpace * textGraphemes(text).length;
        metrics.within += expanded;
        extraBefore += expanded;
      }
    } else hasTextBefore = true;
    offsets.set(part, metrics);
  }
  return offsets;
}

function textMarkup(node, document, measureText, {
  fillValue, fillOpacity, includeStroke = true, clipSuffix = 'base',
  strokeItem, strokeIndex = 0, strokeGradientId = null
} = {}) {
  const fontSize = Number(getNodePropertyValue(document, node, 'fontSize') || 24);
  const lineHeight = Number(getNodePropertyValue(document, node, 'lineHeight') || 1.25) * fontSize;
  const letterSpacing = Number(getNodePropertyValue(document, node, 'letterSpacing') ?? 0);
  const fontWeight = getNodePropertyValue(document, node, 'fontWeight') || 400;
  const fontFamily = getNodePropertyValue(document, node, 'fontFamily') || 'Arial, sans-serif';
  const fontStyle = getNodePropertyValue(document, node, 'fontStyle') || 'normal';
  const resolvedNode = { ...node, fontFamily, fontWeight, fontStyle };
  if (![fontSize, lineHeight, letterSpacing, Number(fontWeight)].every(Number.isFinite) || fontSize <= 0 || lineHeight <= 0) {
    throw new TypeError(`SVG export requires valid text metrics on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  if (node.textPath) {
    const data = textPathSvgData(node.textPath);
    if (!data) throw new TypeError(`SVG export requires valid text path geometry on layer ${node.name || node.id || '(unnamed)'}.`);
    const safeId = String(node.id || 'text').replace(/[^a-zA-Z0-9_-]/gu, '-');
    const pathId = `tis-text-path-${safeId}-${strokeIndex}-${strokeItem?.id ? String(strokeItem.id).replace(/[^a-zA-Z0-9_-]/gu, '-') : 'fill'}`;
    const color = fillValue === undefined ? getNodeColor(document, node, 'text') : fillValue;
    const paint = color === 'transparent' ? 'none' : color;
    if (paint !== 'none' && !isSvgPaintValue(paint)) throw new TypeError(`SVG export supports solid hexadecimal text colors only on layer ${node.name || node.id || '(unnamed)'}.`);
    const strokeMarkup = includeStroke ? (strokeItem
      ? ` stroke="${escapeXml(strokeItem.color)}" stroke-opacity="${number(strokeItem.opacity)}" stroke-width="${number(strokeItem.width)}"`
      : '') : ' stroke="none"';
    const transform = ['uppercase', 'lowercase', 'capitalize'].includes(node.textCase) ? ` text-transform="${node.textCase}"` : '';
    const side = node.textPath.flipped ? ' side="right"' : '';
    const sourceText = String(getNodePropertyValue(document, node, 'text') ?? '');
    const text = transformTextCase(sourceText, node.textCase || 'none');
    const length = flattenTextPath(node.textPath).at(-1)?.distance || 0;
    const currentRuns = Array.isArray(node.textRuns)
      && node.textRuns.map(run => run.text).join('') === sourceText;
    const measuredSpans = textPathSpans(sourceText, { ...resolvedNode, fontSize, fontWeight, letterSpacing });
    const measured = measuredSpans.reduce((width, span, index) => {
      const naturalWidth = typeof measureText === 'function'
        ? Number(measureText(span.text, {
          ...resolvedNode,
          textPathRunStyle: { ...span.style, letterSpacing: 0 }
        }))
        : span.graphemeCount * span.style.fontSize * .6;
      const tracking = Math.max(0, span.graphemeCount - 1) * span.style.letterSpacing
        + (index < measuredSpans.length - 1 ? span.style.letterSpacing : 0);
      return width + naturalWidth + tracking;
    }, 0);
    const alignmentOffset = node.align === 'center' ? (length - measured) / 2 : node.align === 'right' ? length - measured : 0;
    const startOffset = number((Number(node.textPath.startOffset) || 0) + alignmentOffset);
    const pathText = currentRuns ? node.textRuns.map(run => {
      const runFamily = run.fontFamily || fontFamily;
      const runSize = Number(run.fontSize ?? fontSize);
      const runWeight = run.fontWeight ?? fontWeight;
      const runStyle = run.fontStyle === 'italic' || (!Object.hasOwn(run, 'fontStyle') && fontStyle === 'italic') ? 'italic' : 'normal';
      const runSpacing = Number(run.letterSpacing ?? letterSpacing);
      const rawColor = fillValue === undefined ? (run.color || getNodeColor(document, node, 'text')) : fillValue;
      const runColor = rawColor === 'transparent' ? 'none' : rawColor;
      if (runColor !== 'none' && !isSvgPaintValue(runColor)) {
        throw new TypeError(`SVG export supports solid hexadecimal text colors only on layer ${node.name || node.id || '(unnamed)'}.`);
      }
      const runDecoration = ['underline', 'line-through'].includes(run.textDecoration)
        ? ` text-decoration="${run.textDecoration}"` : '';
      const baselineShift = Number(run.baselineShift || 0);
      if (!Number.isFinite(baselineShift) || Math.abs(baselineShift) > MAX_TEXT_RUN_BASELINE_SHIFT) {
        throw new TypeError(`SVG export requires a bounded baseline shift on layer ${node.name || node.id || '(unnamed)'}.`);
      }
      const baseline = baselineShift ? ` baseline-shift="${number(baselineShift)}px"` : '';
      return `<tspan font-family="${escapeXml(runFamily)}" font-size="${number(runSize)}" font-weight="${escapeXml(runWeight)}" font-style="${runStyle}" letter-spacing="${number(runSpacing)}"${fontVariationAttribute(run.fontAxes || node.fontAxes)}${fontFeatureAttribute(run.fontFeatures || node.fontFeatures)} fill="${escapeXml(runColor)}"${runDecoration}${baseline}>${escapeXml(run.text)}</tspan>`;
    }).join('') : escapeXml(text);
    return clipTruncatedTextMarkup(node, `<defs><path id="${pathId}" d="${data}"/></defs><text font-family="${escapeXml(fontFamily)}" font-size="${number(fontSize)}" font-weight="${escapeXml(fontWeight)}" font-style="${fontStyle}" letter-spacing="${number(letterSpacing)}"${fontVariationAttribute(node.fontAxes)}${fontFeatureAttribute(node.fontFeatures)} fill="${escapeXml(paint)}" fill-opacity="${number(fillOpacity ?? node.fillOpacity ?? 1)}"${strokeMarkup}${transform}><textPath href="#${pathId}" xlink:href="#${pathId}" startOffset="${startOffset}"${side}>${pathText}</textPath></text>`, clipSuffix);
  }
  const align = node.align === 'center' ? 'middle' : node.align === 'right' ? 'end' : 'start';
  const anchorX = node.align === 'center' ? Number(node.width) / 2 : node.align === 'right' ? Number(node.width) : 0;
  const textCase = ['uppercase', 'lowercase', 'capitalize'].includes(node.textCase) ? ` text-transform="${node.textCase}"` : '';
  const lines = textLines(resolvedNode, document, measureText);
  const verticalOffset = textVerticalOffset(node, lines, lineHeight);
  const richLines = lines.some(line => Array.isArray(line.parts));
  if (richLines) {
    const textOpacity = fillOpacity ?? node.fillOpacity ?? 1;
    const decorations = [];
    const pdfAscent = typeof measureText?.pdfBaselineOffset === 'function'
      ? Number(measureText.pdfBaselineOffset({ ...resolvedNode, variableBindings: {} })) : NaN;
    const pdfAscentAttribute = Number.isFinite(pdfAscent) && pdfAscent > 0
      ? ` data-tiny-image-star-pdf-ascent="${number(pdfAscent)}"` : '';
    const richTspans = lines.map(line => {
      const textLength = line.width > 0 && !line.justify ? ` textLength="${number(line.width)}" lengthAdjust="spacingAndGlyphs"` : '';
      const wordSpacing = line.justify ? ` word-spacing="${number(line.justificationExtraSpace)}"` : '';
      const lineAnchorX = textLineAnchorX(node, line);
      const lineTextAnchor = svgTextAnchor(line.align || node.align || 'left');
      const lineTextAnchorOverride = lineTextAnchor === svgTextAnchor(node.align || 'left') ? '' : ` text-anchor="${lineTextAnchor}"`;
      const justificationOffsets = line.justify ? richLineJustificationOffsets(line) : null;
      const pdfScaleX = line.justify || line.naturalWidth <= 0 ? 1 : line.width / line.naturalWidth;
      const pdfLineStartX = textLineStartX(node, line);
      const parts = line.parts.map(part => {
        const style = part.style;
        const rawPartColor = fillValue === undefined ? style.color : fillValue;
        const partColor = rawPartColor === 'transparent' ? 'none' : rawPartColor;
        if (partColor !== 'none' && !isSvgPaintValue(partColor)) {
          throw new TypeError(`SVG export supports solid hexadecimal text colors only on layer ${node.name || node.id || '(unnamed)'}.`);
        }
        const baselineShift = Number(style.baselineShift || 0);
        if (!Number.isFinite(baselineShift) || Math.abs(baselineShift) > MAX_TEXT_RUN_BASELINE_SHIFT) {
          throw new TypeError(`SVG export requires a bounded baseline shift on layer ${node.name || node.id || '(unnamed)'}.`);
        }
        const baselineShiftAttribute = baselineShift === 0 ? '' : ` baseline-shift="${number(baselineShift)}px"`;
        const justification = justificationOffsets?.get(part);
        const pdfX = pdfLineStartX + (part.offsetX + (justification?.before || 0)) * pdfScaleX;
        const pdfY = line.y + verticalOffset;
        const pdfWidth = part.width * pdfScaleX + (justification?.within || 0);
        const pdfMetricStyle = { ...resolvedNode, ...style, variableBindings: {} };
        const pdfNaturalWidth = typeof measureText?.pdfNaturalWidth === 'function'
          ? [...part.text].reduce((total, character) => total + Number(measureText.pdfNaturalWidth(character, pdfMetricStyle)), 0)
          : NaN;
        const pdfRunAttributes = Number.isFinite(pdfX) && Number.isFinite(pdfY)
          && Number.isFinite(pdfWidth) && pdfWidth > 0
          && Number.isFinite(pdfNaturalWidth) && pdfNaturalWidth > 0
          ? ` data-tiny-image-star-pdf-rich-run="1" data-tiny-image-star-pdf-x="${number(pdfX)}" data-tiny-image-star-pdf-y="${number(pdfY)}" data-tiny-image-star-pdf-width="${number(pdfWidth)}" data-tiny-image-star-pdf-natural-width="${number(pdfNaturalWidth)}"`
          : '';
        const partMarkup = `<tspan font-family="${escapeXml(style.fontFamily)}" font-size="${number(style.fontSize)}" font-weight="${escapeXml(style.fontWeight)}" font-style="${style.fontStyle}" letter-spacing="${number(style.letterSpacing)}"${fontVariationAttribute(style.fontAxes || node.fontAxes)}${fontFeatureAttribute(style.fontFeatures || node.fontFeatures)}${baselineShiftAttribute} fill="${escapeXml(partColor)}"${pdfRunAttributes}>${escapeXml(part.text)}</tspan>`;
        if (!['underline', 'line-through'].includes(style.textDecoration) || part.width <= 0) return partMarkup;
        const scaleX = line.naturalWidth > line.width && line.naturalWidth > 0 ? line.width / line.naturalWidth : 1;
        const lineStartX = textLineStartX(node, line);
        const x = lineStartX + (part.offsetX + (justification?.before || 0)) * scaleX;
        const decoratedWidth = part.width + (justification?.within || 0);
        const decorationWidth = Math.max(1, style.fontSize / 16);
        const y = line.y + verticalOffset - baselineShift + style.fontSize * (style.textDecoration === 'underline' ? 1.03 : 0.55);
        const stroke = partColor === 'none' ? 'none' : partColor;
        decorations.push(`<path d="M ${number(x)} ${number(y)} L ${number(x + decoratedWidth * scaleX)} ${number(y)}" fill="none" stroke="${escapeXml(stroke)}" stroke-opacity="${number(textOpacity)}" stroke-width="${number(decorationWidth)}"/>`);
        return partMarkup;
      }).join('');
      return textListMarkerTspan(line, node, document, verticalOffset, fillValue)
        + `<tspan x="${number(lineAnchorX)}" y="${number(line.y + verticalOffset)}"${lineTextAnchorOverride}${textLength}${wordSpacing}>${parts}</tspan>`;
    }).join('');
    const stroke = includeStroke ? strokeAttributes(document, node, strokeItem, strokeIndex, strokeGradientId) : '';
    const element = `<text x="${number(anchorX)}" y="0" text-anchor="${align}" dominant-baseline="text-before-edge" xml:space="preserve" font-family="${escapeXml(fontFamily)}" font-size="${number(fontSize)}" font-weight="${escapeXml(fontWeight)}" font-style="${fontStyle === 'italic' ? 'italic' : 'normal'}" letter-spacing="${number(letterSpacing)}"${fontVariationAttribute(node.fontAxes)}${fontFeatureAttribute(node.fontFeatures)}${textCase}${fillAttributes(document, node, { text: true, fillValue, fillOpacity })}${stroke} data-tiny-image-star-text-wrap="canvas-word-wrap"${pdfAscentAttribute}>${richTspans}</text>`;
    return clipTruncatedTextMarkup(node, element + decorations.join(''), clipSuffix);
  }
  const tspans = lines.map(line => {
    const { displayText, width, naturalWidth } = line;
    const lineAnchorX = textLineAnchorX(node, line);
    const lineTextAnchor = svgTextAnchor(line.align || node.align || 'left');
    const lineTextAnchorOverride = lineTextAnchor === svgTextAnchor(node.align || 'left') ? '' : ` text-anchor="${lineTextAnchor}"`;
    // Constrain SVG's native font metrics to the editor-measured line width.
    const textLength = width > 0 && !line.justify ? ` textLength="${number(width)}" lengthAdjust="spacingAndGlyphs"` : '';
    const pdfWidth = typeof measureText?.pdfNaturalWidth === 'function'
      ? Number(measureText.pdfNaturalWidth(displayText, resolvedNode)) : NaN;
    const pdfWidthAttribute = Number.isFinite(pdfWidth) && pdfWidth > 0
      ? ` data-tiny-image-star-pdf-width="${number(pdfWidth)}"` : '';
    const wordSpacing = line.justify ? ` word-spacing="${number(line.justificationExtraSpace)}"` : '';
    return textListMarkerTspan(line, node, document, verticalOffset, fillValue)
      + `<tspan x="${number(lineAnchorX)}" y="${number(line.y + verticalOffset)}"${lineTextAnchorOverride}${textLength}${pdfWidthAttribute}${wordSpacing}>${escapeXml(displayText)}</tspan>`;
  }).join('');
  const stroke = includeStroke ? strokeAttributes(document, node, strokeItem, strokeIndex, strokeGradientId) : '';
  const pdfAscent = typeof measureText?.pdfBaselineOffset === 'function'
    ? Number(measureText.pdfBaselineOffset(resolvedNode)) : NaN;
  const pdfAscentAttribute = Number.isFinite(pdfAscent) && pdfAscent > 0
    ? ` data-tiny-image-star-pdf-ascent="${number(pdfAscent)}"` : '';
  const element = `<text x="${number(anchorX)}" y="0" text-anchor="${align}" dominant-baseline="text-before-edge" xml:space="preserve" font-family="${escapeXml(fontFamily)}" font-size="${number(fontSize)}" font-weight="${escapeXml(fontWeight)}" font-style="${fontStyle === 'italic' ? 'italic' : 'normal'}" letter-spacing="${number(letterSpacing)}"${fontVariationAttribute(node.fontAxes)}${fontFeatureAttribute(node.fontFeatures)}${textCase}${fillAttributes(document, node, { text: true, fillValue, fillOpacity })}${stroke} data-tiny-image-star-text-wrap="canvas-word-wrap"${pdfAscentAttribute}>${tspans}</text>`;
  const decoration = ['underline', 'line-through'].includes(node.textDecoration) ? node.textDecoration : null;
  const textColor = fillValue === undefined ? color(document, node, 'text') : fillValue;
  const textOpacity = fillOpacity ?? node.fillOpacity ?? 1;
  const decorationWidth = Math.max(1, fontSize / 16);
  const decorations = decoration ? lines.filter(line => line.width > 0).map(line => {
    const x = textLineStartX(node, line);
    const y = line.y + verticalOffset + fontSize * (decoration === 'underline' ? 1.03 : 0.55);
    return `<path d="M ${number(x)} ${number(y)} L ${number(x + line.width)} ${number(y)}" fill="none" stroke="${escapeXml(textColor === 'transparent' ? 'none' : textColor)}" stroke-opacity="${number(textOpacity)}" stroke-width="${number(decorationWidth)}"/>`;
  }).join('') : '';
  return clipTruncatedTextMarkup(node, element + decorations, clipSuffix);
}

function markTextFillMarkup(markup, fill) {
  if (!markup) return '';
  const metadata = ` data-tiny-image-star-fill-id="${escapeXml(fill.id)}" data-tiny-image-star-fill-type="${escapeXml(fill.type)}"${paintBlendStyle(fill.blendMode)}`;
  return `<g${metadata}>${markup}</g>`;
}

function addTextImagePattern(node, fill, fillIndex, layerIndex, context) {
  const image = resolveLocalImage(node, context.assets, fill.imageFill.assetId, context.imagePreviews, imagePreviewKey(node.id, fill.id));
  if (!(Number(node.width) > 0) || !(Number(node.height) > 0)) {
    throw new SvgExportError('image fills on zero-size text layers', node);
  }
  const id = `tis-text-image-fill-${layerIndex}-${fillIndex}`;
  if (fill.imageFill.fit === 'tile') {
    return addImageTilePattern(context, image, context.assets, fill.imageFill.assetId,
      fill.imageFill.scalingFactor, fill.imageFill.transforms, id);
  }
  const imageMarkup = rasterImageMarkup({
    image, width: node.width, height: node.height, fit: fill.imageFill.fit,
    transforms: image.isPreview ? {} : fill.imageFill.transforms
  });
  context.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" x="0" y="0" width="${number(node.width)}" height="${number(node.height)}">${imageMarkup}</pattern>`);
  return `url(#${id})`;
}

function renderTextFillStack(node, document, context, layerIndex, measureText) {
  let markup = '';
  for (let fillIndex = 0; fillIndex < node.fills.length; fillIndex += 1) {
    const fill = node.fills[fillIndex];
    if (!fill.visible || fill.opacity <= 0) continue;
    let fillValue;
    if (fill.type === 'solid') {
      const value = stackSolidValue(document, node, fill, fillIndex);
      fillValue = value === 'transparent' ? 'none' : value;
    } else if (fill.type === 'image') {
      fillValue = addTextImagePattern(node, fill, fillIndex, layerIndex, context);
    } else {
      const id = `tis-gradient-${layerIndex}-fill-${fillIndex}`;
      const gradient = gradientDefinition(node, layerIndex, fill.gradient, id);
      context.defs.push(gradient.markup);
      fillValue = `url(#${gradient.id})`;
    }
    const painted = textMarkup(node, document, measureText, {
      fillValue, fillOpacity: fill.opacity, includeStroke: false, clipSuffix: `fill-${fillIndex}`
    });
    markup += markTextFillMarkup(painted, fill);
  }
  // Text strokes trace glyph contours. Keep the complete ordered stack above
  // every fill, matching the vector renderer's paint order.
  if (Array.isArray(node.strokes)) {
    markup += shapeStrokeStackMarkup(node, document, measureText, null, context, layerIndex);
  } else {
    markup += textMarkup(node, document, measureText, { fillValue: 'transparent', fillOpacity: 0, includeStroke: true, clipSuffix: 'outline' });
  }
  return markup;
}

function clipDefinition(document, id, node) {
  return `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${roundedRectMarkup(node, document)}</clipPath>`;
}

function vectorMaskSourceMarkup(node, document, measureText, context, layerIndex) {
  const fills = fillStackForNode(node);
  const hasVisibleFill = node.type !== 'line' && fills.some(fill => fill.visible)
    && (node.type !== 'path' || hasFillablePathContour(node));
  const transform = matrixAttribute(nodeMatrix(node, { includePosition: true }));
  if (node.type === 'network') {
    const edgesByPair = networkEdgesByPair(node);
    const faces = hasVisibleFill ? (node.faces || []).map((face, index) =>
      `<path data-tiny-image-star-face-id="${escapeXml(face.id || index)}" d="${networkFacePath(node, face, edgesByPair)}" fill="#ffffff"/>`
    ).join('') : '';
    const strokes = strokeStackForNode(node).map(stroke => ({
      ...stroke, color: '#ffffff', opacity: 1, gradient: null, blendMode: 'normal'
    }));
    const whiteNetwork = { ...node, strokes, stroke: '#ffffff', strokeOpacity: 1 };
    return `<g${transform}>${faces}${networkMarkup(whiteNetwork, document, null, { includeFills: false, context, layerIndex })}</g>`;
  }
  const strokes = strokeStackForNode(node).filter(stroke => stroke.visible && stroke.width > 0
    && (stroke.gradient || stroke.color)).map(stroke => ({
    ...stroke, color: '#ffffff', opacity: 1, gradient: null, blendMode: 'normal'
  }));
  const whiteShape = {
    ...node,
    fill: '#ffffff', fillOpacity: 1, fillGradient: null, imageFill: null,
    fillStyleId: null, fillVariableId: null, stroke: null, strokeWidth: 0,
    radius: getNodePropertyValue(document, node, 'radius') ?? node.radius,
    variableBindings: {}
  };
  const fillValue = hasVisibleFill ? '#ffffff' : 'transparent';
  let paintedGeometry = '';
  if (strokes.length === 1) {
    paintedGeometry = shapeMarkup(whiteShape, document, measureText, null, {
      fillValue, fillOpacity: 1, includeStroke: true, strokeItem: strokes[0], strokeIndex: 0
    });
  } else {
    if (hasVisibleFill) paintedGeometry += shapeMarkup(whiteShape, document, measureText, null, {
      fillValue: '#ffffff', fillOpacity: 1, includeStroke: false
    });
    for (const [index, stroke] of strokes.entries()) {
      paintedGeometry += shapeMarkup(whiteShape, document, measureText, null, {
        fillValue: 'transparent', fillOpacity: 0, includeStroke: true, strokeItem: stroke, strokeIndex: index
      });
    }
  }
  return `<g${transform}>${paintedGeometry}</g>`;
}

function maskSourceMarkup(source, document, measureText, context, maskMode = 'alpha', layerIndex = 0) {
  const node = { ...source, ...getNodeGeometry(document, source) };
  if (maskMode === 'vector') return vectorMaskSourceMarkup(node, document, measureText, context, layerIndex);
  if (maskMode === 'luminance') {
    const gradient = gradientDefinition(node, layerIndex);
    if (gradient) context.defs.push(gradient.markup);
    const opacity = Number(getNodePropertyValue(document, node, 'opacity') ?? 1);
    return `<g${matrixAttribute(nodeMatrix(node, { includePosition: true }))} opacity="${number(opacity)}">${shapeMarkup(node, document, measureText, gradient?.id || null)}</g>`;
  }
  const opacity = Number(getNodePropertyValue(document, node, 'opacity') ?? 1);
  const fillOpacity = Number(node.fillOpacity ?? 1);
  const alpha = opacity * fillOpacity;
  const transform = matrixAttribute(nodeMatrix(node, { includePosition: true }));
  if (['image', 'group', 'frame', 'section'].includes(node.type)) {
    return renderTree([node], document, context, false, measureText);
  }
  if (node.type === 'network') {
    const edgesByPair = networkEdgesByPair(node);
    const faces = (node.faces || []).map((face, index) => {
      const path = networkFacePath(node, face, edgesByPair);
      const faceOpacity = Number(face.fillOpacity ?? 1);
      if (!Number.isFinite(faceOpacity) || faceOpacity < 0 || faceOpacity > 1) {
        throw new TypeError(`SVG export requires valid face fill opacity on alpha mask source ${node.name || node.id || '(unnamed)'}.`);
      }
      return `<path data-tiny-image-star-face-id="${escapeXml(face.id || index)}" d="${path}" fill="#ffffff" fill-opacity="${number(alpha * faceOpacity)}"/>`;
    }).join('');
    return `<g${transform}>${faces}</g>`;
  }
  const whiteShape = {
    ...node,
    fill: '#ffffff', fillOpacity: alpha, fillGradient: null, imageFill: null,
    fillStyleId: null, fillVariableId: null, stroke: null, strokeWidth: 0,
    radius: getNodePropertyValue(document, node, 'radius') ?? node.radius,
    variableBindings: node.type === 'text' ? { ...(node.variableBindings || {}) } : {}
  };
  const textMask = node.type === 'text';
  return `<g${transform}>${shapeMarkup(whiteShape, document, measureText, null, {
    ...(textMask ? { fillValue: '#ffffff' } : {}),
    fillOpacity: alpha,
    includeStroke: false
  })}</g>`;
}

function maskDefinition(group, source, index, document, measureText, context) {
  const id = `tis-mask-${index}`;
  const { width, height } = group;
  const maskMode = group.maskMode || 'alpha';
  const content = maskSourceMarkup(source, document, measureText, context, maskMode, index);
  const metadata = maskMode === 'vector' || maskMode === 'luminance'
    ? ` data-tiny-image-star-mask-mode="${maskMode}"` : '';
  const maskType = maskMode === 'luminance' ? 'luminance' : 'alpha';
  const colorInterpolation = maskMode === 'luminance' ? ' color-interpolation="sRGB"' : '';
  return {
    id,
    markup: `<mask id="${id}" mask-type="${maskType}"${colorInterpolation} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${number(width)}" height="${number(height)}"${metadata}>${content}</mask>`
  };
}

function effectDefinition(node, index, document, measureText, { effects: sourceEffects = node.effects || [], id = `tis-effect-${index}` } = {}) {
  const effects = (sourceEffects || []).filter(effect => effect.visible !== false);
  if (!effects.length) return null;
  const bounds = getBounds([node], { document, includePosition: false, measureText });
  let input = 'SourceGraphic';
  // The SVG source already combines a layer's fills and strokes. Apply inner
  // shadows to that paint, then run the top effect phase over the composite so
  // layer blur also softens the inner shadows, as it does on the Canvas. Drop
  // shadows remain behind the painted result. Preserve authored order within
  // each phase.
  const orderedEffects = [
    ...effects.filter(effect => effect.type === 'inner-shadow'),
    ...effects.filter(effect => effect.type === 'layer-blur'),
    ...effects.filter(effect => effect.type === 'drop-shadow')
  ];
  const primitives = orderedEffects.map((effect, effectIndex) => {
    const result = `${id}-result-${effectIndex}`;
    const spread = supportsShadowSpread(node) ? (effect.spread ?? 0) : 0;
    let primitive;
    if (effect.type === 'layer-blur') {
      primitive = `<feGaussianBlur in="${input}" stdDeviation="${number(effect.radius)}" result="${result}"/>`;
    } else if (effect.type === 'inner-shadow') {
      const blurred = `${result}-blur`;
      const spreadResult = `${result}-spread`;
      const offset = `${result}-offset`;
      const shape = `${result}-shape`;
      const paint = `${result}-paint`;
      const shadow = `${result}-shadow`;
      // Inner shadows are applied sequentially to the evolving surface by the
      // Canvas renderer. Use the current filter input for both its alpha mask
      // and blurred offset so each later shadow includes earlier shadows.
      const spreadInput = spread ? spreadResult : input;
      const morphology = spread
        ? `<feMorphology in="${input}" operator="${spread > 0 ? 'dilate' : 'erode'}" radius="${number(Math.abs(spread))}" result="${spreadResult}"/>`
        : '';
      primitive = `${morphology}<feGaussianBlur in="${spreadInput}" stdDeviation="${number(effect.blur)}" result="${blurred}"/><feOffset in="${blurred}" dx="${number(effect.offsetX)}" dy="${number(effect.offsetY)}" result="${offset}"/><feComposite in="${input}" in2="${offset}" operator="out" result="${shape}"/><feFlood flood-color="${escapeXml(effect.color)}" flood-opacity="${number(effect.opacity)}" result="${paint}"/><feComposite in="${paint}" in2="${shape}" operator="in" result="${shadow}"/><feComposite in="${shadow}" in2="${input}" operator="over" result="${result}"/>`;
    } else {
      if (!spread) {
        primitive = `<feDropShadow in="${input}" dx="${number(effect.offsetX)}" dy="${number(effect.offsetY)}" stdDeviation="${number(effect.blur)}" flood-color="${escapeXml(effect.color)}" flood-opacity="${number(effect.opacity)}" result="${result}"/>`;
      } else {
        const spreadResult = `${result}-spread`;
        const blurred = `${result}-blur`;
        const offset = `${result}-offset`;
        const paint = `${result}-paint`;
        const shadow = `${result}-shadow`;
        primitive = `<feMorphology in="${input}" operator="${spread > 0 ? 'dilate' : 'erode'}" radius="${number(Math.abs(spread))}" result="${spreadResult}"/><feGaussianBlur in="${spreadResult}" stdDeviation="${number(effect.blur)}" result="${blurred}"/><feOffset in="${blurred}" dx="${number(effect.offsetX)}" dy="${number(effect.offsetY)}" result="${offset}"/><feFlood flood-color="${escapeXml(effect.color)}" flood-opacity="${number(effect.opacity)}" result="${paint}"/><feComposite in="${paint}" in2="${offset}" operator="in" result="${shadow}"/><feComposite in="${input}" in2="${shadow}" operator="over" result="${result}"/>`;
      }
    }
    input = result;
    return primitive;
  }).join('');
  return { id, markup: `<filter id="${id}" filterUnits="userSpaceOnUse" x="${number(bounds.x)}" y="${number(bounds.y)}" width="${number(bounds.width)}" height="${number(bounds.height)}">${primitives}</filter>` };
}

function canExportPhasedLayerPaint(node, document = emptyDocument) {
  const regularShape = ['star', 'polygon'].includes(node.type);
  if (!['rectangle', 'ellipse', 'path', 'star', 'polygon'].includes(node.type) || node.children?.length || node.mask
    || node.type === 'path' && !hasOnlyClosedRenderablePathContours(node)
    || regularShape && !hasPlainRegularShapeGeometry(node, document)) return false;
  const effects = (node.effects || []).filter(effect => effect.visible !== false);
  if (!effects.some(effect => effect.type === 'inner-shadow')
    || effects.some(effect => !['inner-shadow', 'layer-blur', 'drop-shadow'].includes(effect.type)
      || effect.blendMode && effect.blendMode !== 'normal')) return false;

  const fills = fillStackForNode(node);
  if (!fills.length || fills.length > 32 || fills.some(fill => fill.type !== 'solid'
    || fill.visible === false || !(Number(fill.opacity ?? 1) > 0)
    || typeof fill.color !== 'string' || !/^(?:#(?:[\da-f]{3}|[\da-f]{6})|transparent)$/i.test(fill.color)
    || fill.blendMode && fill.blendMode !== 'normal')) return false;

  const strokes = strokeStackForNode(node);
  if (strokes.length > 1) return false;
  const stroke = strokes[0];
  if (stroke && stroke.visible !== false && Number(stroke.opacity ?? 1) > 0 && Number(stroke.width) > 0) {
    if (stroke.gradient || typeof stroke.color !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(stroke.color)
      || stroke.blendMode && stroke.blendMode !== 'normal'
      || stroke.startDecoration && stroke.startDecoration !== 'none'
      || stroke.endDecoration && stroke.endDecoration !== 'none') return false;
    if (node.type === 'rectangle' && !isUniformStrokeSideWidths(strokeSideWidths(stroke))) return false;
  }
  return true;
}

function svgPathDropShadowClipIsRedundant(node, document) {
  if (!hasOnlyClosedRenderablePathContours(node)) return false;
  const visibleStrokes = strokeStackForNode(node).filter(stroke => stroke?.visible !== false
    && Number(stroke.opacity ?? 1) > 0 && Number(stroke.width) > 0
    && (stroke.gradient || (stroke.color && stroke.color !== 'transparent')));
  if (!visibleStrokes.length) return true;
  if (visibleStrokes.length !== 1) return false;
  const [stroke] = visibleStrokes;
  const strokeColor = node.strokeVariableId ? color(document, node, 'stroke') : stroke.color;
  return Number(stroke.opacity ?? 1) === 1 && !stroke.gradient
    && (!stroke.blendMode || stroke.blendMode === 'normal')
    && typeof strokeColor === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(strokeColor);
}

function svgVectorDropShadowClipIsRedundant(node, document) {
  if (!hasPlainRegularShapeGeometry(node, document)) return false;
  const visibleStrokes = strokeStackForNode(node).filter(stroke => stroke?.visible !== false
    && Number(stroke.opacity ?? 1) > 0 && Number(stroke.width) > 0
    && (stroke.gradient || (stroke.color && stroke.color !== 'transparent')));
  if (!visibleStrokes.length) return true;
  if (visibleStrokes.length !== 1) return false;
  const [stroke] = visibleStrokes;
  const strokeColor = node.strokeVariableId ? color(document, node, 'stroke') : stroke.color;
  return Number(stroke.opacity ?? 1) === 1 && !stroke.gradient
    && (!stroke.blendMode || stroke.blendMode === 'normal')
    && typeof strokeColor === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(strokeColor);
}

function regularShapeStrokePadding(node) {
  const count = Math.max(MIN_STAR_POINTS, Math.min(
    node.type === 'star' ? MAX_STAR_POINTS : MAX_POLYGON_POINTS,
    Number(node.points) || (node.type === 'star' ? 5 : 6)
  ));
  const innerRadius = node.type === 'star' ? Number(node.innerRadius ?? 0.48) : null;
  const vertices = regularShapeVertices(node.type, Number(node.width), Number(node.height), count, innerRadius);
  let padding = 0;
  for (const stroke of strokeStackForNode(node)) {
    if (stroke?.visible === false || !(Number(stroke.opacity ?? 1) > 0) || !(Number(stroke.width) > 0)
      || (!stroke.gradient && (!stroke.color || stroke.color === 'transparent'))) continue;
    const width = Number(stroke.width);
    const halfWidth = width / 2;
    padding = Math.max(padding, halfWidth);
    const join = stroke.join || node.strokeJoin || 'miter';
    if (join !== 'miter') continue;
    const miterLimit = Number(stroke.miterLimit ?? node.strokeMiterLimit ?? 10);
    for (let index = 0; index < vertices.length; index += 1) {
      const previous = vertices[(index + vertices.length - 1) % vertices.length];
      const current = vertices[index];
      const next = vertices[(index + 1) % vertices.length];
      const incomingLength = Math.hypot(current.x - previous.x, current.y - previous.y);
      const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y);
      if (!(incomingLength > 0) || !(outgoingLength > 0)) continue;
      const incoming = { x: (current.x - previous.x) / incomingLength, y: (current.y - previous.y) / incomingLength };
      const outgoing = { x: (next.x - current.x) / outgoingLength, y: (next.y - current.y) / outgoingLength };
      const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
      if (Math.abs(cross) <= 1e-12) continue;
      for (const side of [-1, 1]) {
        const first = {
          x: current.x - incoming.y * halfWidth * side,
          y: current.y + incoming.x * halfWidth * side
        };
        const second = {
          x: current.x - outgoing.y * halfWidth * side,
          y: current.y + outgoing.x * halfWidth * side
        };
        const delta = { x: second.x - first.x, y: second.y - first.y };
        const alongIncoming = (delta.x * outgoing.y - delta.y * outgoing.x) / cross;
        const miter = { x: first.x + alongIncoming * incoming.x, y: first.y + alongIncoming * incoming.y };
        const distance = Math.hypot(miter.x - current.x, miter.y - current.y);
        // The stroke-width ratio is deliberately used as a conservative
        // bound across SVG miter-limit implementations.
        if (Number.isFinite(distance) && distance <= width * miterLimit) padding = Math.max(padding, distance);
      }
    }
  }
  return padding;
}

// Boolean operands contribute only their filled alpha silhouette in the editor.
// Keep each source as vector geometry in its own mask so SVG mask composition
// can reproduce source-over, destination-out, and destination-in alpha math.
function booleanOperandMaskDefinition(source, id, bounds, document, measureText, parentTransform = identity) {
  const node = { ...source, ...getNodeGeometry(document, source) };
  if (node.type === 'boolean') {
    const nested = booleanMaskDefinition(node, `${id}-result`, document, measureText);
    const opacity = Number(getNodePropertyValue(document, node, 'opacity') ?? 1);
    const fillOpacity = Array.isArray(node.fills) ? 1 : Number(node.fillOpacity ?? 1);
    if (![opacity, fillOpacity].every(Number.isFinite) || opacity < 0 || opacity > 1 || fillOpacity < 0 || fillOpacity > 1) {
      throw new TypeError(`SVG export requires valid opacity on layer ${node.name || node.id || '(unnamed)'}.`);
    }
    const transform = multiply(parentTransform, nodeMatrix(node));
    const markup = `<mask id="${id}" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${number(bounds.width)}" height="${number(bounds.height)}"><g${matrixAttribute(transform)} opacity="${number(opacity * fillOpacity)}"><rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" fill="#ffffff" mask="url(#${nested.id})"/></g></mask>`;
    return { id, markups: [...nested.markups, markup] };
  }
  const transform = multiply(parentTransform, nodeMatrix(node));
  const opacity = Number(getNodePropertyValue(document, node, 'opacity') ?? 1);
  const fillOpacity = Number(node.fillOpacity ?? 1);
  if (![opacity, fillOpacity].every(Number.isFinite) || opacity < 0 || opacity > 1 || fillOpacity < 0 || fillOpacity > 1) {
    throw new TypeError(`SVG export requires valid opacity on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  let contents;
  if (node.type === 'network') {
    const edgesByPair = networkEdgesByPair(node);
    contents = (node.faces || []).map(face => {
      const faceOpacity = Number(face.fillOpacity ?? 1);
      if (!Number.isFinite(faceOpacity) || faceOpacity < 0 || faceOpacity > 1) throw new TypeError(`SVG export requires valid face fill opacity on layer ${node.name || node.id || '(unnamed)'}.`);
      return `<path d="${networkFacePath(node, face, edgesByPair)}" fill="#ffffff" fill-opacity="${number(faceOpacity)}"/>`;
    }).join('');
  } else {
    // Text masks need the real document so mode-bound strings and font metrics
    // resolve the same way as the canvas. Geometry masks remain color-agnostic.
    const sourceDocument = node.type === 'text' ? document : emptyDocument;
    contents = shapeMarkup(node, sourceDocument, measureText, null, { fillValue: '#ffffff', fillOpacity: 1, includeStroke: false });
  }
  const markup = `<mask id="${id}" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${number(bounds.width)}" height="${number(bounds.height)}"><g${matrixAttribute(transform)} opacity="${number(opacity * fillOpacity)}">${contents}</g></mask>`;
  return { id, markups: [markup] };
}

function booleanMaskDefinition(node, id, document, measureText) {
  const { width, height } = dimensions(node);
  const operation = node.operation || 'union';
  if (operation === 'subtract' && !isNodeVisible(document, node.children[0])) {
    return { id, markups: [`<mask id="${id}" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${number(width)}" height="${number(height)}"></mask>`] };
  }
  if (operation === 'intersect' && node.children.some(child => !isNodeVisible(document, child))) {
    return { id, markups: [`<mask id="${id}" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${number(width)}" height="${number(height)}"></mask>`] };
  }
  const operands = [];
  const markups = [];
  const resolvedChildren = node.children.map(child => ({ ...child, ...getNodeGeometry(document, child) }));
  const source = booleanSourceTransform(resolvedChildren, width, height);
  const sourceMatrix = [source.scaleX, 0, 0, source.scaleY, -source.left * source.scaleX, -source.top * source.scaleY];
  for (let index = 0; index < resolvedChildren.length; index += 1) {
    const child = resolvedChildren[index];
    if (!isNodeVisible(document, child) && operation !== 'intersect') continue;
    const operand = booleanOperandMaskDefinition(child, `${id}-operand-${index}`, { width, height }, document, measureText, sourceMatrix);
    operands.push(operand);
    markups.push(...operand.markups);
  }
  let content = '';
  if (operation === 'union') {
    content = operands.map(operand => `<rect x="0" y="0" width="${number(width)}" height="${number(height)}" fill="#ffffff" mask="url(#${operand.id})"/>`).join('');
  } else if (operation === 'intersect') {
    content = `<g>${operands.map(operand => `<g mask="url(#${operand.id})">`).join('')}<rect x="0" y="0" width="${number(width)}" height="${number(height)}" fill="#ffffff"/>${'</g>'.repeat(operands.length)}</g>`;
  } else if (operation === 'subtract') {
    const [base, ...cutters] = operands;
    if (base) {
      let inner = `<rect x="0" y="0" width="${number(width)}" height="${number(height)}" fill="#ffffff"/>`;
      const inverted = [];
      for (let index = 0; index < cutters.length; index += 1) {
        const idSuffix = `${id}-inverse-${index}`;
        const filterId = `${idSuffix}-filter`;
        const maskId = `${idSuffix}-mask`;
        markups.push(`<filter id="${filterId}" filterUnits="userSpaceOnUse" x="0" y="0" width="${number(width)}" height="${number(height)}"><feComponentTransfer><feFuncA type="table" tableValues="1 0"/></feComponentTransfer></filter>`);
        markups.push(`<mask id="${maskId}" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${number(width)}" height="${number(height)}"><g filter="url(#${filterId})"><rect x="0" y="0" width="${number(width)}" height="${number(height)}" fill="#ffffff" mask="url(#${cutters[index].id})"/></g></mask>`);
        inverted.push(maskId);
      }
      inner = `<g mask="url(#${base.id})">${inverted.map(maskId => `<g mask="url(#${maskId})">`).join('')}${inner}${'</g>'.repeat(inverted.length)}</g>`;
      content = inner;
    }
  } else if (operation === 'exclude') {
    // Canvas uses source-over for the first visible operand, then Porter-Duff
    // XOR for every following operand. A stack of SVG masks would over-combine
    // partially transparent intersections, so materialize each vector mask as
    // a filter input and use feComposite's alpha-correct XOR operation.
    const surfaceIds = operands.map(operand => {
      const surfaceId = `${operand.id}-surface`;
      markups.push(`<g id="${surfaceId}"><rect x="0" y="0" width="${number(width)}" height="${number(height)}" fill="#ffffff" mask="url(#${operand.id})"/></g>`);
      return surfaceId;
    });
    let previousSurfaceId = surfaceIds[0];
    for (let index = 1; index < surfaceIds.length; index += 1) {
      const filterId = `${id}-exclude-${index}-filter`;
      const previousInput = `${filterId}-previous`;
      const operandInput = `${filterId}-operand`;
      const result = `${filterId}-result`;
      const filter = `<filter id="${filterId}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="${number(width)}" height="${number(height)}"><feImage href="#${previousSurfaceId}" x="0" y="0" width="${number(width)}" height="${number(height)}" preserveAspectRatio="none" result="${previousInput}"/><feImage href="#${surfaceIds[index]}" x="0" y="0" width="${number(width)}" height="${number(height)}" preserveAspectRatio="none" result="${operandInput}"/><feComposite in="${previousInput}" in2="${operandInput}" operator="xor" result="${result}"/></filter>`;
      markups.push(filter);
      if (index === surfaceIds.length - 1) {
        content = `<g filter="url(#${filterId})"><rect x="0" y="0" width="${number(width)}" height="${number(height)}" fill="#ffffff"/></g>`;
      } else {
        const resultSurfaceId = `${filterId}-surface`;
        markups.push(`<g id="${resultSurfaceId}"><rect x="0" y="0" width="${number(width)}" height="${number(height)}" fill="#ffffff" filter="url(#${filterId})"/></g>`);
        previousSurfaceId = resultSurfaceId;
      }
    }
    if (surfaceIds.length === 1) content = `<use href="#${surfaceIds[0]}"/>`;
  }
  markups.push(`<mask id="${id}" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${number(width)}" height="${number(height)}">${content}</mask>`);
  return { id, markups };
}

function renderTree(nodes, document, context, includePosition = true, measureText) {
  let markup = '';
  for (const sourceNode of nodes || []) {
    if (sourceNode?.type === 'slice') continue;
    if (!isNodeVisible(document, sourceNode)) continue;
    const node = {
      ...sourceNode,
      ...getNodeGeometry(document, sourceNode),
      ...(sourceNode.textPath ? { textPath: getNodeTextPath(document, sourceNode) } : {})
    };
    const index = context.nextIndex++;
    const transform = nodeMatrix(node, { includePosition });
    const opacity = Number(getNodePropertyValue(document, node, 'opacity') ?? 1);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new TypeError(`SVG export requires valid opacity on layer ${node.name || node.id || '(unnamed)'}.`);
    const title = node.name ? `<title>${escapeXml(node.name)}</title>` : '';
    const metadata = ` data-tiny-image-star-type="${escapeXml(node.type)}"${node.id ? ` data-tiny-image-star-node-id="${escapeXml(node.id)}"` : ''}${node.type === 'network' ? networkRoundTripMetadata(node) : ''}${ellipseArcRoundTripMetadata(node)}${roundedRegularShapeRoundTripMetadata(document, node)}${roundedRectangleRoundTripMetadata(document, node)}`;
    const hasFillStack = Array.isArray(node.fills);
    const gradient = node.mask || hasFillStack ? null : gradientDefinition(node, index);
    if (gradient) context.defs.push(gradient.markup);
    const phasedPaint = canExportPhasedLayerPaint(node, document);
    const booleanMask = node.type === 'boolean' ? booleanMaskDefinition(node, `tis-boolean-${index}`, document, measureText) : null;
    if (booleanMask) context.defs.push(...booleanMask.markups);
    // The canvas Boolean renderer paints the group's fill through the result
    // mask and does not draw a group outline.
    const paintNode = node.type === 'boolean' ? { ...node, stroke: null, strokeWidth: 0 } : node;
    let phasedPaintMarkup = null;
    if (phasedPaint) {
      const fillMarkup = hasFillStack
        ? renderShapeFillStack(paintNode, document, context, index, measureText, { includeStrokes: false })
        : shapeMarkup(paintNode, document, measureText, gradient?.id || null, { includeStroke: false });
      const visibleStroke = strokeStackForNode(paintNode).some(stroke => stroke.visible !== false
        && Number(stroke.opacity ?? 1) > 0 && Number(stroke.width) > 0
        && (stroke.gradient || (stroke.color && stroke.color !== 'transparent')));
      const strokeMarkup = !visibleStroke ? '' : Array.isArray(paintNode.strokes)
        ? shapeStrokeStackMarkup(paintNode, document, measureText, gradient?.id || null, context, index)
        : shapeMarkup(paintNode, document, measureText, gradient?.id || null, { fillValue: 'transparent', fillOpacity: 0 });
      phasedPaintMarkup = { fillMarkup, strokeMarkup };
    }
    let ownShape = phasedPaint ? '' : node.mask ? ''
      : hasFillStack && node.type === 'network' ? renderNetworkFillStack(paintNode, document, context, index)
        : hasFillStack ? renderShapeFillStack(paintNode, document, context, index, measureText)
          : node.type === 'network' ? networkMarkup(node, document, gradient?.id || null, { context, layerIndex: index })
            : Array.isArray(paintNode.strokes) ? shapeWithStrokeStackMarkup(paintNode, document, measureText, gradient?.id || null, context, index)
              : shapeMarkup(paintNode, document, measureText, gradient?.id || null);
    const maskSource = node.mask ? node.children.find(child => child?.id === node.maskSourceId) : null;
    const alphaMask = maskSource && isNodeVisible(document, maskSource)
      ? maskDefinition(node, maskSource, index, document, measureText, context)
      : null;
    if (alphaMask) context.defs.push(alphaMask.markup);
    if (node.type === 'image' || (node.imageFill && !hasFillStack)) {
      const isLayer = node.type === 'image';
      const assetId = isLayer ? node.assetId : node.imageFill.assetId;
      const asset = resolveLocalImage(node, context.assets, assetId, context.imagePreviews);
      const fit = imageFit(node);
      const clipId = `tis-image-clip-${index}`;
      if (!isLayer && node.type === 'network') {
        const edgesByPair = networkEdgesByPair(node);
        const transforms = asset.isPreview ? {} : node.imageFill.transforms;
        const tilePaint = fit === 'tile'
          ? addImageTilePattern(context, asset, context.assets, assetId,
            node.imageFill.scalingFactor, node.imageFill.transforms, `tis-image-tile-${index}`)
          : null;
        const fills = (node.faces || []).map((face, faceIndex) => {
          const facePath = networkFacePath(node, face, edgesByPair);
          const faceClipId = `${clipId}-${faceIndex}`;
          const faceOpacity = Number(face.fillOpacity ?? 1);
          if (!Number.isFinite(faceOpacity) || faceOpacity < 0 || faceOpacity > 1) throw new TypeError(`SVG export requires valid face fill opacity on layer ${node.name || node.id || '(unnamed)'}.`);
          context.defs.push(`<clipPath id="${faceClipId}" clipPathUnits="userSpaceOnUse"><path d="${facePath}"/></clipPath>`);
          const attributes = ` opacity="${number(Number(node.fillOpacity ?? 1) * faceOpacity)}" clip-path="url(#${faceClipId})"`;
          return tilePaint
            ? `<rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" fill="${tilePaint}"${attributes}/>`
            : rasterImageMarkup({ image: asset, width: node.width, height: node.height, fit, transforms, attributes });
        }).join('');
        ownShape = fills + networkMarkup(node, document, null, { includeFills: false, context, layerIndex: index });
      } else if (isLayer) {
        context.defs.push(`<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${roundedRectMarkup(node, document)}</clipPath>`);
        const attributes = ` clip-path="url(#${clipId})"`;
        ownShape = fit === 'tile'
          ? imageTileRectMarkup({
            image: asset, width: node.width, height: node.height,
            assets: context.assets, assetId, scalingFactor: node.scalingFactor,
            transforms: node.transforms, id: `tis-image-tile-${index}`, attributes, context
          })
          : rasterImageMarkup({
            image: asset, width: node.width, height: node.height, fit,
            transforms: asset.isPreview ? {} : node.transforms, attributes
          });
        if (Array.isArray(node.strokes)) ownShape += shapeStrokeStackMarkup(node, document, measureText, null, context, index);
        else if (node.stroke && Number(node.strokeWidth) > 0) ownShape += roundedRectMarkup(node, document, ` fill="none"${strokeAttributes(document, node)}`);
      } else {
        const clipNode = { ...node, fill: '#ffffff', fillOpacity: 1, fillGradient: null, imageFill: null, fillStyleId: null, fillVariableId: null, stroke: null, strokeWidth: 0, variableBindings: {} };
        context.defs.push(`<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${shapeMarkup(clipNode, emptyDocument, measureText)}</clipPath>`);
        const attributes = ` opacity="${number(node.fillOpacity ?? 1)}" clip-path="url(#${clipId})"`;
        ownShape = fit === 'tile'
          ? imageTileRectMarkup({
            image: asset, width: node.width, height: node.height,
            assets: context.assets, assetId, scalingFactor: node.imageFill.scalingFactor,
            transforms: node.imageFill.transforms, id: `tis-image-tile-${index}`, attributes, context
          })
          : rasterImageMarkup({
            image: asset, width: node.width, height: node.height, fit,
            transforms: asset.isPreview ? {} : node.imageFill.transforms, attributes
          });
        const outlineNode = { ...node, fill: '#000000', fillOpacity: 0, fillGradient: null, imageFill: null, fillStyleId: null, fillVariableId: null, variableBindings: {} };
        const outline = Array.isArray(node.strokes)
          ? shapeStrokeStackMarkup(outlineNode, document, measureText, null, context, index)
          : shapeMarkup(outlineNode, document, measureText).replace(/ fill="[^"]*" fill-opacity="[^"]*"/, ' fill="none"');
        ownShape += outline;
      }
    }
    if (node.type === 'line' && !node.stroke) ownShape = ownShape.replace(/ stroke="none" stroke-width="[^"]*"\/>$/, ' stroke="none"/>');
    const childClipId = node.clip && !node.mask ? `tis-clip-${index}` : null;
    if (childClipId) context.defs.push(clipDefinition(document, childClipId, node));
    const visibleEffects = (node.effects || []).filter(effect => effect.visible !== false);
    const innerEffects = phasedPaint ? visibleEffects.filter(effect => effect.type === 'inner-shadow') : [];
    const effectOrder = phasedPaint ? [
      ...visibleEffects.filter(effect => effect.type === 'inner-shadow'),
      ...visibleEffects.filter(effect => effect.type === 'layer-blur'),
      ...visibleEffects.filter(effect => effect.type === 'drop-shadow')
    ].map(effect => effect.type) : null;
    const topEffects = phasedPaint ? visibleEffects.filter(effect => effect.type !== 'inner-shadow') : null;
    const filter = phasedPaint
      ? effectDefinition(node, index, document, measureText, { effects: topEffects, id: `tis-effect-${index}` })
      : effectDefinition(node, index, document, measureText);
    if (filter) context.defs.push(filter.markup);
    if (phasedPaintMarkup) {
      const innerFilter = effectDefinition(node, index, document, measureText, {
        effects: innerEffects,
        id: `tis-effect-${index}${filter ? '-inner' : ''}`
      });
      if (innerFilter) context.defs.push(innerFilter.markup);
      const fill = `<g data-tiny-image-star-paint-stage="fill"${innerFilter ? ` filter="url(#${innerFilter.id})"` : ''}>${phasedPaintMarkup.fillMarkup}</g>`;
      const stroke = phasedPaintMarkup.strokeMarkup
        ? `<g data-tiny-image-star-paint-stage="stroke">${phasedPaintMarkup.strokeMarkup}</g>` : '';
      ownShape = fill + stroke;
    }
    const visibleChildren = node.type === 'boolean' ? [] : maskSource ? node.children.filter(child => child !== maskSource) : node.children;
    const childNodes = visibleChildren?.length
      ? `<g${childClipId ? ` clip-path="url(#${childClipId})"` : ''}>${renderTree(visibleChildren, document, context, true, measureText)}</g>`
      : '';
    const blendMode = node.blendMode && node.blendMode !== 'normal' ? ` style="mix-blend-mode:${escapeXml(node.blendMode)}"` : '';
    const maskAttribute = alphaMask ? ` mask="url(#${alphaMask.id})"` : booleanMask ? ` mask="url(#${booleanMask.id})"` : '';
    const paintPhaseMetadata = phasedPaintMarkup
      ? ` data-tiny-image-star-paint-phases="layer-v1" data-tiny-image-star-effect-order="${escapeXml(JSON.stringify(effectOrder))}"`
      : '';
    markup += `<g${matrixAttribute(transform)} opacity="${number(opacity)}"${filter ? ` filter="url(#${filter.id})"` : ''}${blendMode}${maskAttribute}${metadata}${paintPhaseMetadata}>${title}${ownShape}${childNodes}</g>`;
  }
  return markup;
}

function transformPoint(matrix, x, y) {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}

function intersectBounds(left, right) {
  if (!left) return right;
  if (!right) return left;
  const bounds = {
    minX: Math.max(left.minX, right.minX), minY: Math.max(left.minY, right.minY),
    maxX: Math.min(left.maxX, right.maxX), maxY: Math.min(left.maxY, right.maxY)
  };
  return bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY ? bounds : null;
}

function getBounds(nodes, { document = emptyDocument, includePosition = true, measureText } = {}) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const include = (point, bounds) => {
    bounds.minX = Math.min(bounds.minX, point.x); bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x); bounds.maxY = Math.max(bounds.maxY, point.y);
  };
  const visit = (list, parentMatrix, isRoot, clipBounds = null) => {
    for (const sourceNode of list || []) {
      if (sourceNode?.type === 'slice') continue;
      if (!isNodeVisible(document, sourceNode)) continue;
      const node = { ...sourceNode, ...getNodeGeometry(document, sourceNode) };
      const matrix = multiply(parentMatrix, nodeMatrix(node, { includePosition: !isRoot || includePosition }));
      const { width, height } = dimensions(node);
      const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const [x, y] of [[0, 0], [width, 0], [width, height], [0, height]]) {
        include(transformPoint(matrix, x, y), bounds);
      }
      if (['rectangle', 'frame'].includes(node.type)) {
        const sideExtents = { top: 0, right: 0, bottom: 0, left: 0 };
        for (const stroke of strokeStackForNode(node)) {
          if (stroke.visible === false || Number(stroke.opacity ?? 1) <= 0) continue;
          const sideWidths = strokeSideWidths(stroke);
          for (const side of strokeSideNames) sideExtents[side] = Math.max(sideExtents[side], sideWidths[side] / 2);
        }
        if (Object.values(sideExtents).some(value => value > 0)) {
          for (const [x, y] of [
            [-sideExtents.left, -sideExtents.top], [width + sideExtents.right, -sideExtents.top],
            [width + sideExtents.right, height + sideExtents.bottom], [-sideExtents.left, height + sideExtents.bottom]
          ]) include(transformPoint(matrix, x, y), bounds);
        }
      }
      if (node.type === 'path') {
        for (const contour of vectorPathContours(node)) {
          for (const item of contour.points || []) {
            const anchor = { x: Number(item.x) * width, y: Number(item.y) * height };
            include(transformPoint(matrix, anchor.x, anchor.y), bounds);
            for (const part of ['in', 'out']) if (item[part]) {
              const x = anchor.x + Number(item[part].x || 0) * width;
              const y = anchor.y + Number(item[part].y || 0) * height;
              include(transformPoint(matrix, x, y), bounds);
            }
          }
        }
      }
      if (node.type === 'network') {
        for (const vertex of node.vertices || []) {
          if (!vertex || !Number.isFinite(Number(vertex.x)) || !Number.isFinite(Number(vertex.y))) throw new TypeError(`SVG export requires finite vector network vertices on layer ${node.name || node.id || '(unnamed)'}.`);
          include(transformPoint(matrix, Number(vertex.x) * width, Number(vertex.y) * height), bounds);
        }
        for (const edge of node.edges || []) for (const part of ['control1', 'control2']) if (edge?.[part]) {
          if (!Number.isFinite(Number(edge[part].x)) || !Number.isFinite(Number(edge[part].y))) throw new TypeError(`SVG export requires finite vector network controls on layer ${node.name || node.id || '(unnamed)'}.`);
          include(transformPoint(matrix, Number(edge[part].x) * width, Number(edge[part].y) * height), bounds);
        }
      }
      if (['line', 'path', 'network'].includes(node.type)) {
        const strokes = strokeStackForNode(node);
        for (let strokeIndex = 0; strokeIndex < strokes.length; strokeIndex += 1) {
          const stroke = strokes[strokeIndex];
          if (!stroke.visible || stroke.opacity <= 0 || stroke.width <= 0 || (!stroke.gradient && (!stroke.color || stroke.color === 'transparent'))) continue;
          for (const decoration of strokeEndpointDecorations(node, stroke, { x: 0, y: 0 })) {
            if (decoration.type === 'circle') {
              const { x, y } = decoration.center;
              const radius = decoration.radius;
              for (const point of [{ x: x - radius, y: y - radius }, { x: x + radius, y: y - radius }, { x: x + radius, y: y + radius }, { x: x - radius, y: y + radius }]) {
                include(transformPoint(matrix, point.x, point.y), bounds);
              }
              continue;
            }
            const strokeRadius = decoration.type === 'arrow' ? stroke.width / 2 : 0;
            for (const vertex of decoration.points) {
              for (const [x, y] of [[vertex.x - strokeRadius, vertex.y - strokeRadius], [vertex.x + strokeRadius, vertex.y - strokeRadius], [vertex.x + strokeRadius, vertex.y + strokeRadius], [vertex.x - strokeRadius, vertex.y + strokeRadius]]) {
                include(transformPoint(matrix, x, y), bounds);
              }
            }
          }
        }
      }
      if (node.type === 'text') {
        const fontSize = Number(getNodePropertyValue(document, node, 'fontSize') || 24);
        const lineHeight = Number(getNodePropertyValue(document, node, 'lineHeight') || 1.25) * fontSize;
        const lines = textLines(node, document, measureText);
        const verticalOffset = textVerticalOffset(node, lines, lineHeight);
        for (const line of lines) {
          const lineWidth = line.width;
          if (line.marker) {
            const markerStyle = line.marker.style || {};
            const markerSize = Number(markerStyle.fontSize || fontSize);
            const markerTop = line.y + verticalOffset - markerSize * .15;
            const markerBottom = Math.max(line.y + verticalOffset + markerSize * 1.25, markerTop + markerSize);
            const markerLeft = line.marker.anchorX - line.marker.width;
            const markerRight = line.marker.anchorX;
            for (const [x, y] of [[markerLeft, markerTop], [markerRight, markerTop], [markerLeft, markerBottom], [markerRight, markerBottom]]) {
              include(transformPoint(matrix, x, y), bounds);
            }
          }
          if (lineWidth <= 0) continue;
          const startX = textLineStartX(node, line);
          if (Array.isArray(line.parts)) {
            const scaleX = line.naturalWidth > line.width && line.naturalWidth > 0 ? line.width / line.naturalWidth : 1;
            const parts = line.parts.length ? line.parts : [{ offsetX: 0, width: line.width, style: { fontSize, textDecoration: node.textDecoration } }];
            for (const part of parts) {
              const size = part.style.fontSize;
              const baselineShift = Number(part.style.baselineShift || 0);
              if (!Number.isFinite(baselineShift) || Math.abs(baselineShift) > MAX_TEXT_RUN_BASELINE_SHIFT) {
                throw new TypeError(`SVG export requires a bounded baseline shift on layer ${node.name || node.id || '(unnamed)'}.`);
              }
              const x1 = startX + part.offsetX * scaleX;
              const x2 = x1 + part.width * scaleX;
              const lineTop = line.y + verticalOffset;
              const shiftedLineTop = lineTop - baselineShift;
              const top = shiftedLineTop - size * .15;
              const decorationBottom = shiftedLineTop + size * (part.style.textDecoration === 'underline' ? 1.03 : .55);
              const bottom = Math.max(shiftedLineTop + size * 1.25, decorationBottom + Math.max(1, size / 16) / 2);
              for (const [x, y] of [[x1, top], [x2, top], [x1, bottom], [x2, bottom]]) include(transformPoint(matrix, x, y), bounds);
            }
          } else {
            const lineTop = line.y + verticalOffset;
            const top = lineTop - fontSize * .15;
            const bottom = Math.max(lineTop + fontSize * 1.25, lineTop + fontSize * (node.textDecoration === 'underline' ? 1.03 : .55));
            for (const [x, y] of [[startX, top], [startX + lineWidth, top], [startX, bottom], [startX + lineWidth, bottom]]) include(transformPoint(matrix, x, y), bounds);
          }
        }
      }
      if (!['rectangle', 'frame'].includes(node.type)) {
        const strokeWidth = node.stroke && Number(node.strokeWidth) > 0 ? Number(node.strokeWidth) / 2 : 0;
        if (strokeWidth) { bounds.minX -= strokeWidth; bounds.minY -= strokeWidth; bounds.maxX += strokeWidth; bounds.maxY += strokeWidth; }
      }
      const regularStrokePadding = ['star', 'polygon'].includes(node.type) ? regularShapeStrokePadding(node) : 0;
      if (regularStrokePadding) {
        for (const [x, y] of [
          [-regularStrokePadding, -regularStrokePadding], [width + regularStrokePadding, -regularStrokePadding],
          [width + regularStrokePadding, height + regularStrokePadding], [-regularStrokePadding, height + regularStrokePadding]
        ]) include(transformPoint(matrix, x, y), bounds);
      }
      const effectPadding = layerEffectPadding(node.effects);
      if (effectPadding.x || effectPadding.y) {
        for (const [x, y] of [
          [-effectPadding.x - regularStrokePadding, -effectPadding.y - regularStrokePadding],
          [width + effectPadding.x + regularStrokePadding, -effectPadding.y - regularStrokePadding],
          [width + effectPadding.x + regularStrokePadding, height + effectPadding.y + regularStrokePadding],
          [-effectPadding.x - regularStrokePadding, height + effectPadding.y + regularStrokePadding]
        ]) include(transformPoint(matrix, x, y), bounds);
      }
      const visibleBounds = intersectBounds(bounds, clipBounds);
      if (visibleBounds) {
        minX = Math.min(minX, visibleBounds.minX); minY = Math.min(minY, visibleBounds.minY);
        maxX = Math.max(maxX, visibleBounds.maxX); maxY = Math.max(maxY, visibleBounds.maxY);
      }
      let childClip = clipBounds;
      if (node.clip || node.mask) {
        const clip = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const [x, y] of [[0, 0], [width, 0], [width, height], [0, height]]) include(transformPoint(matrix, x, y), clip);
        childClip = intersectBounds(childClip, clip);
      }
      const childNodes = node.mask ? node.children.filter(child => child?.id !== node.maskSourceId) : node.children;
      if (childClip || !clipBounds) visit(childNodes, matrix, false, childClip);
    }
  };
  visit(nodes, identity, true, null);
  return Number.isFinite(minX) ? { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) } : { x: 0, y: 0, width: 1, height: 1 };
}

function svgDocument(markup, defs, bounds, { width, height } = {}) {
  const svgWidth = width == null ? bounds.width : Number(width);
  const svgHeight = height == null ? bounds.height : Number(height);
  if (!Number.isFinite(svgWidth) || !Number.isFinite(svgHeight) || svgWidth <= 0 || svgHeight <= 0) throw new TypeError('SVG output width and height must be positive finite numbers.');
  const defsMarkup = defs.length ? `<defs>${defs.join('')}</defs>` : '';
  const note = '<!-- Text wrapping and line positions are serialized as editable SVG tspans. -->';
  return `${note}<svg xmlns="http://www.w3.org/2000/svg" width="${number(svgWidth)}px" height="${number(svgHeight)}px" viewBox="${number(bounds.x)} ${number(bounds.y)} ${number(bounds.width)} ${number(bounds.height)}">${defsMarkup}${markup}</svg>`;
}

/** Return the visible page artwork's bounds using the same geometry as SVG export. */
export function getPageContentBounds(page, { document = null, measureText } = {}) {
  if (!page || !Array.isArray(page.children)) throw new TypeError('Page bounds require a page with child layers.');
  return getBounds(page.children, { document: document || emptyDocument, measureText });
}

/**
 * Export one editor layer as a self-contained, editable SVG, with its origin at the layer's bounds.
 * Text layers require a canvas-based `measureText` callback so SVG line breaks match the editor.
 */
export function exportNodeToSvg(node, { document = null, assets = null, imagePreviews = null, width, height, measureText } = {}) {
  if (!node || typeof node !== 'object') throw new TypeError('SVG export requires a layer.');
  if (node.type === 'slice') throw new SvgExportError('raster slice exports', node);
  document ||= emptyDocument;
  validateTree([node], document, assets, imagePreviews);
  const bounds = getBounds([node], { document, includePosition: false, measureText });
  const context = { defs: [], nextIndex: 0, assets, imagePreviews, strokeGradientIds: new Set() };
  const markup = renderTree([node], document, context, false, measureText);
  return svgDocument(markup, context.defs, bounds, { width, height });
}

/**
 * Export a page's layers as a self-contained, editable SVG, fitting the viewBox to visible content.
 * Pages with text layers require a canvas-based `measureText` callback.
 */
export function exportPageToSvg(page, { document = null, assets = null, imagePreviews = null, width, height, measureText } = {}) {
  if (!page || !Array.isArray(page.children)) throw new TypeError('SVG export requires a page with child layers.');
  document ||= emptyDocument;
  validateTree(page.children, document, assets, imagePreviews);
  const bounds = getBounds(page.children, { document, measureText });
  const context = { defs: [], nextIndex: 0, assets, imagePreviews, strokeGradientIds: new Set() };
  const markup = renderTree(page.children, document, context, true, measureText);
  return svgDocument(markup, context.defs, bounds, { width, height });
}
