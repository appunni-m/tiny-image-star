import { getNodeColor, getNodeGeometry, getNodePropertyValue } from './model.js';
import { layoutPlainText, layoutTextRuns, transformTextCase } from './text-layout.js';
import { fillStackForNode, isValidFillStack, isValidGradientFill } from './fills.js';
import { isImageFillSupported, isValidImageFill } from './image-fills.js';
import { isValidImageTransforms } from './image-transforms.js';
import { isValidLayerEffects, layerEffectPadding } from './layer-effects.js';
import { isValidLayerBlendMode } from './layer-blend.js';
import { strokeDashArray } from './stroke-style.js';
import { vectorNetworkEdgePoints, vectorNetworkVertexPoint } from './vector-path.js';
import { imagePreviewKey } from './image-preview-runtime.js';

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

const supportedTypes = new Set(['frame', 'section', 'group', 'rectangle', 'ellipse', 'line', 'text', 'star', 'polygon', 'path', 'network', 'image']);
const identity = [1, 0, 0, 1, 0, 0];
const emptyDocument = { variables: [], variableCollections: [], colorStyles: [], pages: [] };
const safeRasterTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

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
  return { href: `data:${type};base64,${encoded}`, width: Number(asset.bitmap?.width || asset.width), height: Number(asset.bitmap?.height || asset.height) };
}

function imageFit(node) {
  return node.type === 'image' ? (node.fit ?? 'cover') : node.imageFill.fit;
}

function unsupportedImageFill(node, fill, assets, imagePreviews, previewKey = node.id) {
  if (!isImageFillSupported(node) || !isValidImageFill(fill)) return 'image fills';
  const image = resolveLocalImage(node, assets, fill.assetId, imagePreviews, previewKey);
  if (image.error) return 'image fills';
  if (!image.isPreview && Object.values(fill.adjustments || {}).some(value => Number(value) !== 0)) return 'raster image adjustments';
  if (fill.transforms != null && !isValidImageTransforms(fill.transforms)) {
    throw new TypeError(`SVG export requires valid image transforms on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  if (!image.isPreview && (fill.transforms?.crop || Number(fill.transforms?.rotation || 0) % 360 !== 0)) return 'raster image crop or rotation';
  if (!['cover', 'contain'].includes(fill.fit)) return 'image fill fit mode';
  if (!(image.width > 0) || !(image.height > 0)) return 'image fills';
  return null;
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

function number(value) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new TypeError('SVG export requires finite numeric values.');
  const rounded = Math.abs(result) < 1e-12 ? 0 : Number(result.toPrecision(12));
  return Object.is(rounded, -0) ? '0' : String(rounded);
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
  return [cos, sin, -sin, cos, x + cx - cos * cx + sin * cy, y + cy - sin * cx - cos * cy];
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

function gradientDefinition(node, index, gradient = node.fillGradient, id = `tis-gradient-${index}`) {
  if (!gradient) return null;
  if (!isValidGradientFill(gradient)) throw new TypeError(`SVG export requires a valid gradient fill on layer ${node.name || node.id || '(unnamed)'}.`);
  const { width, height } = dimensions(node);
  const stops = gradient.stops.map(stop => `<stop offset="${number(stop.position)}" stop-color="${escapeXml(stop.color)}"/>`).join('');
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

function strokeAttributes(document, node) {
  const strokeWidth = Number(node.strokeWidth || 0);
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0) throw new TypeError(`SVG export requires a valid stroke width on layer ${node.name || node.id || '(unnamed)'}.`);
  const resolved = node.stroke && strokeWidth ? color(document, node, 'stroke') : 'none';
  const stroke = resolved === 'transparent' ? 'none' : resolved;
  const pattern = ['solid', 'dashed', 'dotted'].includes(node.strokePattern) ? node.strokePattern : 'solid';
  const cap = pattern === 'dotted' ? 'round' : ['butt', 'round', 'square'].includes(node.strokeCap) ? node.strokeCap : 'butt';
  const join = ['miter', 'round', 'bevel'].includes(node.strokeJoin) ? node.strokeJoin : 'miter';
  const miterLimit = Number(node.strokeMiterLimit ?? 10);
  if (!Number.isFinite(miterLimit) || miterLimit < 1 || miterLimit > 1000) throw new TypeError(`SVG export requires a valid stroke miter limit on layer ${node.name || node.id || '(unnamed)'}.`);
  const dash = resolved !== 'none' ? strokeDashArray({ strokeWidth, strokePattern: pattern }) : [];
  const miter = resolved !== 'none' && join === 'miter' && miterLimit !== 4 ? ` stroke-miterlimit="${number(miterLimit)}"` : '';
  return ` stroke="${escapeXml(stroke)}" stroke-width="${number(strokeWidth)}"${cap === 'butt' ? '' : ` stroke-linecap="${cap}"`}${join === 'miter' ? '' : ` stroke-linejoin="${join}"`}${miter}${dash.length ? ` stroke-dasharray="${dash.map(number).join(' ')}"` : ''}`;
}

function radius(document, node) {
  const raw = Number(getNodePropertyValue(document, node, 'radius') ?? 0);
  if (!Number.isFinite(raw)) throw new TypeError(`SVG export requires a finite corner radius on layer ${node.name || node.id || '(unnamed)'}.`);
  const value = Math.max(0, raw);
  return Math.min(value, Number(node.width) / 2, Number(node.height) / 2);
}

function unsupportedFeature(node, assets, imagePreviews = null) {
  if (!supportedTypes.has(node.type)) return `${node.type || 'unknown'} layers`;
  if (Array.isArray(node.fills)) {
    if (!isValidFillStack(node.fills, node, { isValidImageFill, isImageFillSupported })) {
      throw new TypeError(`SVG export requires a valid fill stack on layer ${node.name || node.id || '(unnamed)'}.`);
    }
    for (let index = 0; index < node.fills.length; index += 1) {
      const fill = node.fills[index];
      if (fill.type !== 'image' || !fill.visible || fill.opacity <= 0) continue;
      const problem = unsupportedImageFill(node, fill.imageFill, assets, imagePreviews, imagePreviewKey(node.id, fill.id));
      if (problem) return problem;
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
    if (!image.isPreview && (transforms?.crop || Number(transforms?.rotation || 0) % 360 !== 0)) return 'raster image crop or rotation';
    const fit = imageFit(node);
    if (!['cover', 'contain'].includes(fit)) return node.type === 'image' ? 'image layer fit mode' : 'image fill fit mode';
    if (!(image.width > 0) || !(image.height > 0)) return node.type === 'image' ? 'image layers' : 'image fills';
    if (node.imageFill && (!Number.isFinite(Number(node.fillOpacity ?? 1)) || Number(node.fillOpacity ?? 1) < 0 || Number(node.fillOpacity ?? 1) > 1)) {
      throw new TypeError(`SVG export requires valid fill opacity on layer ${node.name || node.id || '(unnamed)'}.`);
    }
  }
  if (!Array.isArray(node.fills) && node.fillGradient && !['frame', 'section', 'group', 'rectangle', 'ellipse', 'star', 'polygon', 'network'].includes(node.type)
    && !(node.type === 'path' && node.closed)) return 'gradient fills';
  if (!Array.isArray(node.fills) && node.type === 'network' && node.fillGradient && !(node.faces || []).length) return 'gradient fills on open vector networks';
  if (node.effects != null && !isValidLayerEffects(node.effects)) throw new TypeError(`SVG export requires valid layer effects on layer ${node.name || node.id || '(unnamed)'}.`);
  if (node.blendMode != null && !isValidLayerBlendMode(node.blendMode)) throw new TypeError(`SVG export requires a supported blend mode on layer ${node.name || node.id || '(unnamed)'}.`);
  if (!Array.isArray(node.fills) && node.fillGradient && !isValidGradientFill(node.fillGradient)) throw new TypeError(`SVG export requires a valid gradient fill on layer ${node.name || node.id || '(unnamed)'}.`);
  if (node.type === 'group' && node.maskSourceId && !node.mask) return 'mask groups';
  return null;
}

function isNodeVisible(document, node) {
  return getNodePropertyValue(document, node, 'visible') !== false;
}

const svgMaskSourceTypes = new Set(['rectangle', 'ellipse', 'star', 'polygon', 'path', 'network']);

function validateMaskGroup(node, document) {
  if (node.type !== 'group' || !Array.isArray(node.children) || node.children.length < 2 || typeof node.maskSourceId !== 'string') {
    throw new SvgExportError('mask groups', node);
  }
  if (!(Number(node.width) > 0) || !(Number(node.height) > 0)) throw new SvgExportError('zero-size mask groups', node);
  const source = node.children.find(child => child?.id === node.maskSourceId);
  if (!source) throw new SvgExportError('mask groups with a missing source', node);
  if (!isNodeVisible(document, source)) return source;
  if (!svgMaskSourceTypes.has(source.type)) throw new SvgExportError(`${source.type || 'unknown'} alpha mask contents`, source);
  if (source.type === 'path' && source.closed !== true) throw new SvgExportError('open path alpha mask contents', source);
  if (source.type === 'network' && !(source.faces || []).length) throw new SvgExportError('open vector network alpha mask contents', source);
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

function validateTree(nodes, document, assets, imagePreviews = null, ignoredNodeIds = new Set()) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') throw new TypeError('SVG export received an invalid layer.');
    if (ignoredNodeIds.has(node.id)) continue;
    if (!isNodeVisible(document, node)) continue;
    const maskSource = node.mask ? validateMaskGroup(node, document) : null;
    const unsupported = unsupportedFeature(node, assets, imagePreviews);
    if (unsupported) throw new SvgExportError(unsupported, node);
    dimensions({ ...node, ...getNodeGeometry(document, node) });
    if (!Array.isArray(node.children || [])) throw new TypeError(`SVG export requires a child layer list on ${node.name || node.id || '(unnamed)'}.`);
    const ignoredChildren = maskSource ? new Set([...ignoredNodeIds, maskSource.id]) : ignoredNodeIds;
    validateTree(node.children || [], document, assets, imagePreviews, ignoredChildren);
  }
}

function shapeMarkup(node, document, measureText, gradientId = null, { fillValue, fillOpacity, includeStroke = true } = {}) {
  const fill = fillAttributes(document, node, { text: node.type === 'text', gradientId, fillValue, fillOpacity });
  const stroke = includeStroke ? strokeAttributes(document, node) : '';
  switch (node.type) {
    case 'frame':
    case 'section':
    case 'group':
    case 'rectangle': {
      const r = radius(document, node);
      return `<rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" rx="${number(r)}" ry="${number(r)}"${fill}${stroke}/>`;
    }
    case 'ellipse':
      return `<ellipse cx="${number(node.width / 2)}" cy="${number(node.height / 2)}" rx="${number(node.width / 2)}" ry="${number(node.height / 2)}"${fill}${stroke}/>`;
    case 'line':
      return `<path d="M 0 0 L ${number(node.width)} ${number(node.height)}" fill="none"${stroke}/>`;
    case 'star': {
      const count = Math.max(3, Math.min(32, Number(node.points) || 5));
      const radius = Math.min(node.width, node.height) / 2;
      const inner = node.innerRadius == null ? 0.48 : Number(node.innerRadius);
      if (!Number.isFinite(inner) || inner < 0 || inner > 1) throw new TypeError(`SVG export requires a valid star ratio on layer ${node.name || node.id || '(unnamed)'}.`);
      const points = Array.from({ length: Math.ceil(count * 2) }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI / count;
        const distance = radius * (index % 2 ? inner : 1);
        return `${number(node.width / 2 + Math.cos(angle) * distance)},${number(node.height / 2 + Math.sin(angle) * distance)}`;
      }).join(' ');
      return `<polygon points="${points}"${fill}${stroke}/>`;
    }
    case 'polygon': {
      const count = Math.max(3, Math.min(32, Number(node.points) || 6));
      const points = Array.from({ length: Math.ceil(count) }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
        return `${number(node.width / 2 + Math.cos(angle) * node.width / 2)},${number(node.height / 2 + Math.sin(angle) * node.height / 2)}`;
      }).join(' ');
      return `<polygon points="${points}"${fill}${stroke}/>`;
    }
    case 'path': {
      const points = node.points || [];
      if (points.length < 2) return '';
      const point = (item, part) => {
        const anchor = { x: Number(item.x) * node.width, y: Number(item.y) * node.height };
        const handle = item[part];
        return handle ? { x: anchor.x + Number(handle.x || 0) * node.width, y: anchor.y + Number(handle.y || 0) * node.height } : anchor;
      };
      let path = `M ${number(point(points[0], 'anchor').x)} ${number(point(points[0], 'anchor').y)}`;
      const segments = node.closed ? points.length : points.length - 1;
      for (let index = 0; index < segments; index += 1) {
        const previous = points[index];
        const current = points[(index + 1) % points.length];
        const end = point(current, 'anchor');
        const c1 = point(previous, 'out');
        const c2 = point(current, 'in');
        if (previous.out || current.in) path += ` C ${number(c1.x)} ${number(c1.y)} ${number(c2.x)} ${number(c2.y)} ${number(end.x)} ${number(end.y)}`;
        else path += ` L ${number(end.x)} ${number(end.y)}`;
      }
      if (node.closed) path += ' Z';
      return `<path d="${path}"${node.closed ? fill : ' fill="none"'}${stroke}/>`;
    }
    case 'network':
      // Network faces and edges are emitted individually below so SVG retains their graph topology.
      return '';
    case 'text':
      return textMarkup(node, document, measureText);
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

function networkMarkup(node, document, gradientId = null, { includeFills = true } = {}) {
  const faces = node.faces || [];
  const edgesByPair = networkEdgesByPair(node);
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
  const stroke = strokeAttributes(document, node);
  for (const edge of node.edges || []) {
    markup += `<path data-tiny-image-star-edge-id="${escapeXml(edge.id)}" data-tiny-image-star-from="${escapeXml(edge.from)}" data-tiny-image-star-to="${escapeXml(edge.to)}" d="${networkEdgePath(node, edge)}" fill="none"${stroke}/>`;
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
  return markup.replace(/\/>$/, `${metadata}/>`);
}

function renderShapeFillStack(node, document, context, index, measureText) {
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
      markup += markFillMarkup(`<image x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" preserveAspectRatio="xMidYMid ${fit === 'cover' ? 'slice' : 'meet'}" href="${image.href}" opacity="${number(fill.opacity)}" clip-path="url(#${clipId})"/>`, fill);
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
  // Strokes belong to the shape, not to individual paints, so export them once
  // above the complete stack just as the canvas renderer does.
  markup += shapeMarkup(node, document, measureText, null, { fillValue: 'transparent', fillOpacity: 0 });
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
    if (fill.type === 'linear' || fill.type === 'radial') {
      const gradient = gradientDefinition(node, index, fill.gradient, `tis-gradient-${index}-fill-${fillIndex}`);
      if (gradient) {
        gradientId = gradient.id;
        context.defs.push(gradient.markup);
      }
    } else if (fill.type === 'image') {
      image = resolveLocalImage(node, context.assets, fill.imageFill.assetId, context.imagePreviews, imagePreviewKey(node.id, fill.id));
    }
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
        markup += markFillMarkup(`<image x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" preserveAspectRatio="xMidYMid ${fill.imageFill.fit === 'cover' ? 'slice' : 'meet'}" href="${image.href}" opacity="${number(fill.opacity * faceOpacity)}" clip-path="url(#${faceClipId})" data-tiny-image-star-face-id="${faceId}"/>`, fill);
      } else {
        let paint;
        if (fill.type === 'solid') {
          paint = fillIndex === 0 && face.fill != null
            ? color(document, { ...node, fill: face.fill, fillVariableId: null, fillStyleId: null, variableBindings: {} }, 'fill')
            : stackSolidValue(document, node, fill, fillIndex);
          paint = paint === 'transparent' ? 'none' : paint;
        } else paint = `url(#${gradientId})`;
        markup += `<path data-tiny-image-star-face-id="${faceId}" d="${path}" fill="${escapeXml(paint)}" fill-opacity="${number(fill.opacity * faceOpacity)}" data-tiny-image-star-fill-id="${escapeXml(fill.id)}" data-tiny-image-star-fill-type="${escapeXml(fill.type)}"/>`;
      }
    });
  }
  // Emit network edges once, after all face paints.
  return markup + networkMarkup(node, document, null, { includeFills: false });
}

function textLines(node, document, measureText) {
  const sourceText = String(getNodePropertyValue(document, node, 'text') ?? '');
  const text = transformTextCase(sourceText, node.textCase || 'none');
  if (!text) {
    const fontSize = Number(getNodePropertyValue(document, node, 'fontSize') || 24);
    const lineHeight = fontSize * Number(getNodePropertyValue(document, node, 'lineHeight') || 1.25);
    return [{ displayText: '', index: 0, paragraphIndex: 0, firstLine: true, indent: 0, naturalWidth: 0, width: 0, y: 0, lineHeight }];
  }
  if (Number(node.width) <= 0) throw new TypeError(`SVG export cannot faithfully render text in a zero-width box on layer ${node.name || node.id || '(unnamed)'}.`);
  if (typeof measureText !== 'function') throw new TypeError(`SVG export requires canvas text measurement to match editor wrapping on layer ${node.name || node.id || '(unnamed)'}.`);

  const runs = node.textRuns;
  if (Array.isArray(runs) && runs.every(run => run && typeof run.text === 'string') && runs.map(run => run.text).join('') === sourceText) {
    const baseStyle = {
      fontFamily: node.fontFamily || 'Arial, sans-serif',
      fontSize: getNodePropertyValue(document, node, 'fontSize') || 24,
      fontWeight: node.fontWeight || 400,
      fontStyle: node.fontStyle || 'normal',
      lineHeight: getNodePropertyValue(document, node, 'lineHeight') || 1.25,
      letterSpacing: getNodePropertyValue(document, node, 'letterSpacing') ?? 0,
      paragraphSpacing: node.paragraphSpacing || 0,
      firstLineIndent: node.firstLineIndent || 0,
      color: color(document, node, 'text'),
      textDecoration: node.textDecoration || 'none',
      textCase: node.textCase || 'none'
    };
    const layout = layoutTextRuns(runs, Math.max(1, Number(node.width)), baseStyle, (value, style) => {
      const measureNode = { ...node, ...style, variableBindings: {} };
      return Number(measureText(value, measureNode));
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
  const lineHeight = fontSize * Number(getNodePropertyValue(document, node, 'lineHeight') || 1.25);
  const measure = line => Number(measureText(line, node));
  const layout = layoutPlainText(text, Math.max(1, Number(node.width)), measure, {
    lineHeight,
    paragraphSpacing: node.paragraphSpacing,
    firstLineIndent: node.firstLineIndent
  });
  return layout.lines.map(line => {
    const { displayText, index, indent } = line;
    const naturalWidth = measure(displayText);
    if (!Number.isFinite(naturalWidth) || naturalWidth < 0) throw new TypeError(`SVG export requires a finite text measurement on layer ${node.name || node.id || '(unnamed)'}.`);
    return { ...line, naturalWidth, width: Math.min(Number(node.width) - indent, naturalWidth) };
  });
}

function textVerticalOffset(node, lines, lineHeight) {
  const contentHeight = lines.reduce((height, line) => Math.max(height, Number(line.y || 0) + Number(line.lineHeight || lineHeight)), 0);
  const freeSpace = Math.max(0, Number(node.height) - contentHeight);
  if (node.verticalAlign === 'middle') return freeSpace / 2;
  if (node.verticalAlign === 'bottom') return freeSpace;
  return 0;
}

function textLineStartX(node, line) {
  const width = Math.max(0, Number(node.width));
  const indent = Math.max(0, Number(line.indent) || 0);
  const availableWidth = Math.max(1, width - indent);
  const lineWidth = Math.max(0, Number(line.width) || 0);
  if (node.align === 'center') return indent + (availableWidth - lineWidth) / 2;
  if (node.align === 'right') return indent + availableWidth - lineWidth;
  return indent;
}

function textLineAnchorX(node, line) {
  const start = textLineStartX(node, line);
  if (node.align === 'center') return start + (Number(line.width) || 0) / 2;
  if (node.align === 'right') return start + (Number(line.width) || 0);
  return start;
}

function textMarkup(node, document, measureText) {
  const fontSize = Number(getNodePropertyValue(document, node, 'fontSize') || 24);
  const lineHeight = Number(getNodePropertyValue(document, node, 'lineHeight') || 1.25) * fontSize;
  const letterSpacing = Number(getNodePropertyValue(document, node, 'letterSpacing') ?? 0);
  const fontWeight = getNodePropertyValue(document, node, 'fontWeight') || 400;
  if (![fontSize, lineHeight, letterSpacing, Number(fontWeight)].every(Number.isFinite) || fontSize <= 0 || lineHeight <= 0) {
    throw new TypeError(`SVG export requires valid text metrics on layer ${node.name || node.id || '(unnamed)'}.`);
  }
  const align = node.align === 'center' ? 'middle' : node.align === 'right' ? 'end' : 'start';
  const anchorX = node.align === 'center' ? Number(node.width) / 2 : node.align === 'right' ? Number(node.width) : 0;
  const fontFamily = node.fontFamily || 'Arial, sans-serif';
  const textCase = ['uppercase', 'lowercase', 'capitalize'].includes(node.textCase) ? ` text-transform="${node.textCase}"` : '';
  const lines = textLines(node, document, measureText);
  const verticalOffset = textVerticalOffset(node, lines, lineHeight);
  const richLines = lines.some(line => Array.isArray(line.parts));
  if (richLines) {
    const textOpacity = node.fillOpacity ?? 1;
    const decorations = [];
    const richTspans = lines.map(line => {
      const textLength = line.width > 0 ? ` textLength="${number(line.width)}" lengthAdjust="spacingAndGlyphs"` : '';
      const lineAnchorX = textLineAnchorX(node, line);
      const parts = line.parts.map(part => {
        const style = part.style;
        const partColor = style.color === 'transparent' ? 'none' : style.color;
        if (partColor !== 'none' && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(partColor)) {
          throw new TypeError(`SVG export supports solid hexadecimal text colors only on layer ${node.name || node.id || '(unnamed)'}.`);
        }
        const partMarkup = `<tspan font-family="${escapeXml(style.fontFamily)}" font-size="${number(style.fontSize)}" font-weight="${escapeXml(style.fontWeight)}" font-style="${style.fontStyle}" letter-spacing="${number(style.letterSpacing)}" fill="${escapeXml(partColor)}">${escapeXml(part.text)}</tspan>`;
        if (!['underline', 'line-through'].includes(style.textDecoration) || part.width <= 0) return partMarkup;
        const scaleX = line.naturalWidth > line.width && line.naturalWidth > 0 ? line.width / line.naturalWidth : 1;
        const lineStartX = textLineStartX(node, line);
        const x = lineStartX + part.offsetX * scaleX;
        const decorationWidth = Math.max(1, style.fontSize / 16);
        const y = line.y + verticalOffset + style.fontSize * (style.textDecoration === 'underline' ? 1.03 : 0.55);
        const stroke = partColor === 'none' ? 'none' : partColor;
        decorations.push(`<path d="M ${number(x)} ${number(y)} L ${number(x + part.width * scaleX)} ${number(y)}" fill="none" stroke="${escapeXml(stroke)}" stroke-opacity="${number(textOpacity)}" stroke-width="${number(decorationWidth)}"/>`);
        return partMarkup;
      }).join('');
      return `<tspan x="${number(lineAnchorX)}" y="${number(line.y + verticalOffset)}"${textLength}>${parts}</tspan>`;
    }).join('');
    const element = `<text x="${number(anchorX)}" y="0" text-anchor="${align}" dominant-baseline="text-before-edge" font-family="${escapeXml(fontFamily)}" font-size="${number(fontSize)}" font-weight="${escapeXml(fontWeight)}" font-style="${node.fontStyle === 'italic' ? 'italic' : 'normal'}" letter-spacing="${number(letterSpacing)}"${textCase}${fillAttributes(document, node, { text: true })} data-tiny-image-star-text-wrap="canvas-word-wrap">${richTspans}</text>`;
    const border = node.stroke && Number(node.strokeWidth) > 0
      ? `<rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" fill="none"${strokeAttributes(document, node)}/>`
      : '';
    return element + border + decorations.join('');
  }
  const tspans = lines.map(line => {
    const { displayText, width, naturalWidth } = line;
    const lineAnchorX = textLineAnchorX(node, line);
    // Constrain SVG's native font metrics to the editor-measured line width.
    const textLength = width > 0 ? ` textLength="${number(width)}" lengthAdjust="spacingAndGlyphs"` : '';
    return `<tspan x="${number(lineAnchorX)}" y="${number(line.y + verticalOffset)}"${textLength}>${escapeXml(displayText)}</tspan>`;
  }).join('');
  const element = `<text x="${number(anchorX)}" y="0" text-anchor="${align}" dominant-baseline="text-before-edge" font-family="${escapeXml(fontFamily)}" font-size="${number(fontSize)}" font-weight="${escapeXml(fontWeight)}" font-style="${node.fontStyle === 'italic' ? 'italic' : 'normal'}" letter-spacing="${number(letterSpacing)}"${textCase}${fillAttributes(document, node, { text: true })} data-tiny-image-star-text-wrap="canvas-word-wrap">${tspans}</text>`;
  const border = node.stroke && Number(node.strokeWidth) > 0
    ? `<rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" fill="none"${strokeAttributes(document, node)}/>`
    : '';
  const decoration = ['underline', 'line-through'].includes(node.textDecoration) ? node.textDecoration : null;
  const textColor = color(document, node, 'text');
  const textOpacity = node.fillOpacity ?? 1;
  const decorationWidth = Math.max(1, fontSize / 16);
  const decorations = decoration ? lines.filter(line => line.width > 0).map(line => {
    const x = textLineStartX(node, line);
    const y = line.y + verticalOffset + fontSize * (decoration === 'underline' ? 1.03 : 0.55);
    return `<path d="M ${number(x)} ${number(y)} L ${number(x + line.width)} ${number(y)}" fill="none" stroke="${escapeXml(textColor === 'transparent' ? 'none' : textColor)}" stroke-opacity="${number(textOpacity)}" stroke-width="${number(decorationWidth)}"/>`;
  }).join('') : '';
  return element + border + decorations;
}

function clipDefinition(document, id, node) {
  const r = radius(document, node);
  return `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" rx="${number(r)}" ry="${number(r)}"/></clipPath>`;
}

function maskSourceMarkup(source, document, measureText) {
  const node = { ...source, ...getNodeGeometry(document, source) };
  const opacity = Number(getNodePropertyValue(document, node, 'opacity') ?? 1);
  const fillOpacity = Number(node.fillOpacity ?? 1);
  const alpha = opacity * fillOpacity;
  const transform = matrixAttribute(nodeMatrix(node, { includePosition: true }));
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
    variableBindings: {}
  };
  return `<g${transform}>${shapeMarkup(whiteShape, document, measureText)}</g>`;
}

function maskDefinition(group, source, index, document, measureText) {
  const id = `tis-mask-${index}`;
  const { width, height } = group;
  const content = maskSourceMarkup(source, document, measureText);
  return {
    id,
    markup: `<mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${number(width)}" height="${number(height)}">${content}</mask>`
  };
}

function effectDefinition(node, index, document, measureText) {
  const effects = (node.effects || []).filter(effect => effect.visible !== false);
  if (!effects.length) return null;
  const id = `tis-effect-${index}`;
  const bounds = getBounds([node], { document, includePosition: false, measureText });
  let input = 'SourceGraphic';
  const primitives = effects.map((effect, effectIndex) => {
    const result = `${id}-result-${effectIndex}`;
    if (effect.type === 'layer-blur') {
      return `<feGaussianBlur in="${input}" stdDeviation="${number(effect.radius)}" result="${result}"/>`;
    }
    return `<feDropShadow in="${input}" dx="${number(effect.offsetX)}" dy="${number(effect.offsetY)}" stdDeviation="${number(effect.blur)}" flood-color="${escapeXml(effect.color)}" flood-opacity="${number(effect.opacity)}" result="${result}"/>`;
  }).map((primitive, indexInList) => {
    input = `${id}-result-${indexInList}`;
    return primitive;
  }).join('');
  return { id, markup: `<filter id="${id}" filterUnits="userSpaceOnUse" x="${number(bounds.x)}" y="${number(bounds.y)}" width="${number(bounds.width)}" height="${number(bounds.height)}">${primitives}</filter>` };
}

function renderTree(nodes, document, context, includePosition = true, measureText) {
  let markup = '';
  for (const sourceNode of nodes || []) {
    if (!isNodeVisible(document, sourceNode)) continue;
    const node = { ...sourceNode, ...getNodeGeometry(document, sourceNode) };
    const index = context.nextIndex++;
    const transform = nodeMatrix(node, { includePosition });
    const opacity = Number(getNodePropertyValue(document, node, 'opacity') ?? 1);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new TypeError(`SVG export requires valid opacity on layer ${node.name || node.id || '(unnamed)'}.`);
    const title = node.name ? `<title>${escapeXml(node.name)}</title>` : '';
    const metadata = ` data-tiny-image-star-type="${escapeXml(node.type)}"${node.id ? ` data-tiny-image-star-node-id="${escapeXml(node.id)}"` : ''}`;
    const hasFillStack = Array.isArray(node.fills);
    const gradient = node.mask || hasFillStack ? null : gradientDefinition(node, index);
    if (gradient) context.defs.push(gradient.markup);
    let ownShape = node.mask ? ''
      : hasFillStack && node.type === 'network' ? renderNetworkFillStack(node, document, context, index)
        : hasFillStack ? renderShapeFillStack(node, document, context, index, measureText)
          : node.type === 'network' ? networkMarkup(node, document, gradient?.id || null)
            : shapeMarkup(node, document, measureText, gradient?.id || null);
    const maskSource = node.mask ? node.children.find(child => child?.id === node.maskSourceId) : null;
    const alphaMask = maskSource && isNodeVisible(document, maskSource)
      ? maskDefinition(node, maskSource, index, document, measureText)
      : null;
    if (alphaMask) context.defs.push(alphaMask.markup);
    if (node.type === 'image' || (node.imageFill && !hasFillStack)) {
      const isLayer = node.type === 'image';
      const asset = resolveLocalImage(node, context.assets, isLayer ? node.assetId : node.imageFill.assetId, context.imagePreviews);
      const fit = imageFit(node);
      const clipId = `tis-image-clip-${index}`;
      if (!isLayer && node.type === 'network') {
        const edgesByPair = networkEdgesByPair(node);
        const fills = (node.faces || []).map((face, faceIndex) => {
          const facePath = networkFacePath(node, face, edgesByPair);
          const faceClipId = `${clipId}-${faceIndex}`;
          const faceOpacity = Number(face.fillOpacity ?? 1);
          if (!Number.isFinite(faceOpacity) || faceOpacity < 0 || faceOpacity > 1) throw new TypeError(`SVG export requires valid face fill opacity on layer ${node.name || node.id || '(unnamed)'}.`);
          context.defs.push(`<clipPath id="${faceClipId}" clipPathUnits="userSpaceOnUse"><path d="${facePath}"/></clipPath>`);
          return `<image x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" preserveAspectRatio="xMidYMid ${fit === 'cover' ? 'slice' : 'meet'}" href="${asset.href}" opacity="${number(Number(node.fillOpacity ?? 1) * faceOpacity)}" clip-path="url(#${faceClipId})"/>`;
        }).join('');
        ownShape = fills + networkMarkup(node, document, null, { includeFills: false });
      } else if (isLayer) {
        context.defs.push(`<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" rx="${number(radius(document, node))}" ry="${number(radius(document, node))}"/></clipPath>`);
        ownShape = `<image x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" preserveAspectRatio="xMidYMid ${fit === 'cover' ? 'slice' : 'meet'}" href="${asset.href}" clip-path="url(#${clipId})"/>`;
        if (node.stroke && Number(node.strokeWidth) > 0) ownShape += `<rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" rx="${number(radius(document, node))}" ry="${number(radius(document, node))}" fill="none"${strokeAttributes(document, node)}/>`;
      } else {
        const clipNode = { ...node, fill: '#ffffff', fillOpacity: 1, fillGradient: null, imageFill: null, fillStyleId: null, fillVariableId: null, stroke: null, strokeWidth: 0, variableBindings: {} };
        context.defs.push(`<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">${shapeMarkup(clipNode, emptyDocument, measureText)}</clipPath>`);
        ownShape = `<image x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" preserveAspectRatio="xMidYMid ${fit === 'cover' ? 'slice' : 'meet'}" href="${asset.href}" opacity="${number(node.fillOpacity ?? 1)}" clip-path="url(#${clipId})"/>`;
        const outlineNode = { ...node, fill: '#000000', fillOpacity: 0, fillGradient: null, imageFill: null, fillStyleId: null, fillVariableId: null, variableBindings: {} };
        const outline = shapeMarkup(outlineNode, document, measureText).replace(/ fill="[^"]*" fill-opacity="[^"]*"/, ' fill="none"');
        ownShape += outline;
      }
    }
    if (node.type === 'line' && !node.stroke) ownShape = ownShape.replace(/ stroke="none" stroke-width="[^"]*"\/>$/, ' stroke="none"/>');
    const childClipId = node.clip && !node.mask ? `tis-clip-${index}` : null;
    if (childClipId) context.defs.push(clipDefinition(document, childClipId, node));
    const filter = effectDefinition(node, index, document, measureText);
    if (filter) context.defs.push(filter.markup);
    const visibleChildren = maskSource ? node.children.filter(child => child !== maskSource) : node.children;
    const childNodes = visibleChildren?.length
      ? `<g${childClipId ? ` clip-path="url(#${childClipId})"` : ''}>${renderTree(visibleChildren, document, context, true, measureText)}</g>`
      : '';
    const blendMode = node.blendMode && node.blendMode !== 'normal' ? ` style="mix-blend-mode:${escapeXml(node.blendMode)}"` : '';
    const maskAttribute = alphaMask ? ` mask="url(#${alphaMask.id})"` : '';
    markup += `<g${matrixAttribute(transform)} opacity="${number(opacity)}"${filter ? ` filter="url(#${filter.id})"` : ''}${blendMode}${maskAttribute}${metadata}>${title}${ownShape}${childNodes}</g>`;
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
      if (!isNodeVisible(document, sourceNode)) continue;
      const node = { ...sourceNode, ...getNodeGeometry(document, sourceNode) };
      const matrix = multiply(parentMatrix, nodeMatrix(node, { includePosition: !isRoot || includePosition }));
      const { width, height } = dimensions(node);
      const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const [x, y] of [[0, 0], [width, 0], [width, height], [0, height]]) {
        include(transformPoint(matrix, x, y), bounds);
      }
      if (node.type === 'path') {
        for (const item of node.points || []) {
          const anchor = { x: Number(item.x) * width, y: Number(item.y) * height };
          include(transformPoint(matrix, anchor.x, anchor.y), bounds);
          for (const part of ['in', 'out']) if (item[part]) {
            const x = anchor.x + Number(item[part].x || 0) * width;
            const y = anchor.y + Number(item[part].y || 0) * height;
            include(transformPoint(matrix, x, y), bounds);
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
      if (node.type === 'text') {
        const fontSize = Number(getNodePropertyValue(document, node, 'fontSize') || 24);
        const lineHeight = Number(getNodePropertyValue(document, node, 'lineHeight') || 1.25) * fontSize;
        const lines = textLines(node, document, measureText);
        const verticalOffset = textVerticalOffset(node, lines, lineHeight);
        for (const line of lines) {
          const lineWidth = line.width;
          if (lineWidth <= 0) continue;
          const startX = textLineStartX(node, line);
          if (Array.isArray(line.parts)) {
            const scaleX = line.naturalWidth > line.width && line.naturalWidth > 0 ? line.width / line.naturalWidth : 1;
            const parts = line.parts.length ? line.parts : [{ offsetX: 0, width: line.width, style: { fontSize, textDecoration: node.textDecoration } }];
            for (const part of parts) {
              const size = part.style.fontSize;
              const x1 = startX + part.offsetX * scaleX;
              const x2 = x1 + part.width * scaleX;
              const lineTop = line.y + verticalOffset;
              const top = lineTop - size * .15;
              const decorationBottom = lineTop + size * (part.style.textDecoration === 'underline' ? 1.03 : .55);
              const bottom = Math.max(lineTop + size * 1.25, decorationBottom + Math.max(1, size / 16) / 2);
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
      const strokeWidth = node.stroke && Number(node.strokeWidth) > 0 ? Number(node.strokeWidth) / 2 : 0;
      if (strokeWidth) { bounds.minX -= strokeWidth; bounds.minY -= strokeWidth; bounds.maxX += strokeWidth; bounds.maxY += strokeWidth; }
      const effectPadding = layerEffectPadding(node.effects);
      if (effectPadding.x || effectPadding.y) {
        for (const [x, y] of [
          [-effectPadding.x, -effectPadding.y], [width + effectPadding.x, -effectPadding.y],
          [width + effectPadding.x, height + effectPadding.y], [-effectPadding.x, height + effectPadding.y]
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

/**
 * Export one editor layer as a self-contained, editable SVG, with its origin at the layer's bounds.
 * Text layers require a canvas-based `measureText` callback so SVG line breaks match the editor.
 */
export function exportNodeToSvg(node, { document = null, assets = null, imagePreviews = null, width, height, measureText } = {}) {
  if (!node || typeof node !== 'object') throw new TypeError('SVG export requires a layer.');
  document ||= emptyDocument;
  validateTree([node], document, assets, imagePreviews);
  const bounds = getBounds([node], { document, includePosition: false, measureText });
  const context = { defs: [], nextIndex: 0, assets, imagePreviews };
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
  const context = { defs: [], nextIndex: 0, assets, imagePreviews };
  const markup = renderTree(page.children, document, context, true, measureText);
  return svgDocument(markup, context.defs, bounds, { width, height });
}
