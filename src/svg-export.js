import { getNodeColor, getNodeGeometry, getNodePropertyValue } from './model.js';
import { layoutTextRuns, transformTextCase, wrapTextWithMeasure } from './text-layout.js';
import { isValidGradientFill } from './fills.js';
import { isImageFillSupported, isValidImageFill } from './image-fills.js';
import { isValidImageTransforms } from './image-transforms.js';
import { isValidLayerEffects, layerEffectPadding } from './layer-effects.js';
import { isValidLayerBlendMode } from './layer-blend.js';

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

const supportedTypes = new Set(['frame', 'section', 'group', 'rectangle', 'ellipse', 'line', 'text', 'star', 'polygon', 'path', 'image']);
const identity = [1, 0, 0, 1, 0, 0];
const emptyDocument = { variables: [], variableCollections: [], colorStyles: [], pages: [] };
const safeRasterTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

function resolveLocalImage(node, assets, assetId) {
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

function gradientDefinition(node, index) {
  const gradient = node.fillGradient;
  if (!gradient) return null;
  if (!isValidGradientFill(gradient)) throw new TypeError(`SVG export requires a valid gradient fill on layer ${node.name || node.id || '(unnamed)'}.`);
  const id = `tis-gradient-${index}`;
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

function fillAttributes(document, node, { text = false, gradientId = null } = {}) {
  const value = text ? color(document, node, 'text') : color(document, node, 'fill');
  const fill = gradientId ? `url(#${gradientId})` : value === 'transparent' ? 'none' : value;
  const fillOpacity = node.fillOpacity ?? 1;
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
  return ` stroke="${escapeXml(stroke)}" stroke-width="${number(strokeWidth)}"`;
}

function radius(document, node) {
  const raw = Number(getNodePropertyValue(document, node, 'radius') ?? 0);
  if (!Number.isFinite(raw)) throw new TypeError(`SVG export requires a finite corner radius on layer ${node.name || node.id || '(unnamed)'}.`);
  const value = Math.max(0, raw);
  return Math.min(value, Number(node.width) / 2, Number(node.height) / 2);
}

function unsupportedFeature(node, assets) {
  if (!supportedTypes.has(node.type)) return `${node.type || 'unknown'} layers`;
  if (node.mask) return 'mask groups';
  if (node.type === 'image' || node.imageFill) {
    if (node.imageFill && (!isImageFillSupported(node) || !isValidImageFill(node.imageFill))) return 'image fills';
    const image = resolveLocalImage(node, assets, node.type === 'image' ? node.assetId : node.imageFill?.assetId);
    if (image.error) return image.error;
    const adjustments = node.type === 'image' ? node.adjustments : node.imageFill.adjustments;
    if (adjustments && Object.values(adjustments).some(value => Number(value) !== 0)) return 'raster image adjustments';
    const transforms = node.type === 'image' ? node.transforms : node.imageFill.transforms;
    if (transforms != null && !isValidImageTransforms(transforms)) throw new TypeError(`SVG export requires valid image transforms on layer ${node.name || node.id || '(unnamed)'}.`);
    if (transforms?.crop || Number(transforms?.rotation || 0) % 360 !== 0) return 'raster image crop or rotation';
    const fit = imageFit(node);
    if (!['cover', 'contain'].includes(fit)) return node.type === 'image' ? 'image layer fit mode' : 'image fill fit mode';
    if (!(image.width > 0) || !(image.height > 0)) return node.type === 'image' ? 'image layers' : 'image fills';
    if (node.imageFill && (!Number.isFinite(Number(node.fillOpacity ?? 1)) || Number(node.fillOpacity ?? 1) < 0 || Number(node.fillOpacity ?? 1) > 1)) {
      throw new TypeError(`SVG export requires valid fill opacity on layer ${node.name || node.id || '(unnamed)'}.`);
    }
  }
  if (node.fillGradient && !['frame', 'section', 'group', 'rectangle', 'ellipse', 'star', 'polygon'].includes(node.type)
    && !(node.type === 'path' && node.closed)) return 'gradient fills';
  if (node.effects != null && !isValidLayerEffects(node.effects)) throw new TypeError(`SVG export requires valid layer effects on layer ${node.name || node.id || '(unnamed)'}.`);
  if (node.blendMode != null && !isValidLayerBlendMode(node.blendMode)) throw new TypeError(`SVG export requires a supported blend mode on layer ${node.name || node.id || '(unnamed)'}.`);
  if (node.fillGradient && !isValidGradientFill(node.fillGradient)) throw new TypeError(`SVG export requires a valid gradient fill on layer ${node.name || node.id || '(unnamed)'}.`);
  if (node.type === 'group' && node.maskSourceId) return 'mask groups';
  return null;
}

function isNodeVisible(document, node) {
  return getNodePropertyValue(document, node, 'visible') !== false;
}

function validateTree(nodes, document, assets) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') throw new TypeError('SVG export received an invalid layer.');
    if (!isNodeVisible(document, node)) continue;
    const unsupported = unsupportedFeature(node, assets);
    if (unsupported) throw new SvgExportError(unsupported, node);
    dimensions({ ...node, ...getNodeGeometry(document, node) });
    if (!Array.isArray(node.children || [])) throw new TypeError(`SVG export requires a child layer list on ${node.name || node.id || '(unnamed)'}.`);
    validateTree(node.children || [], document, assets);
  }
}

function shapeMarkup(node, document, measureText, gradientId = null) {
  const fill = fillAttributes(document, node, { text: node.type === 'text', gradientId });
  const stroke = strokeAttributes(document, node);
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
      const inner = Number(node.innerRadius) || 0.48;
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
    case 'text':
      return textMarkup(node, document, measureText);
    default:
      return '';
  }
}

function textLines(node, document, measureText) {
  const sourceText = String(getNodePropertyValue(document, node, 'text') ?? '');
  const text = transformTextCase(sourceText, node.textCase || 'none');
  if (!text) return [{ displayText: '', index: 0, naturalWidth: 0, width: 0 }];
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

  const measure = line => Number(measureText(line, node));
  const displayLines = wrapTextWithMeasure(text, Math.max(1, Number(node.width)), measure);
  return displayLines.map((displayText, index) => {
    const naturalWidth = measure(displayText);
    if (!Number.isFinite(naturalWidth) || naturalWidth < 0) throw new TypeError(`SVG export requires a finite text measurement on layer ${node.name || node.id || '(unnamed)'}.`);
    return { displayText, index, naturalWidth, width: Math.min(Number(node.width), naturalWidth) };
  });
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
  const richLines = lines.some(line => Array.isArray(line.parts));
  if (richLines) {
    const textOpacity = node.fillOpacity ?? 1;
    const decorations = [];
    const richTspans = lines.map(line => {
      const textLength = line.width > 0 ? ` textLength="${number(line.width)}" lengthAdjust="spacingAndGlyphs"` : '';
      const parts = line.parts.map(part => {
        const style = part.style;
        const partColor = style.color === 'transparent' ? 'none' : style.color;
        if (partColor !== 'none' && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(partColor)) {
          throw new TypeError(`SVG export supports solid hexadecimal text colors only on layer ${node.name || node.id || '(unnamed)'}.`);
        }
        const partMarkup = `<tspan font-family="${escapeXml(style.fontFamily)}" font-size="${number(style.fontSize)}" font-weight="${escapeXml(style.fontWeight)}" font-style="${style.fontStyle}" letter-spacing="${number(style.letterSpacing)}" fill="${escapeXml(partColor)}">${escapeXml(part.text)}</tspan>`;
        if (!['underline', 'line-through'].includes(style.textDecoration) || part.width <= 0) return partMarkup;
        const scaleX = line.naturalWidth > line.width && line.naturalWidth > 0 ? line.width / line.naturalWidth : 1;
        const lineStartX = node.align === 'center' ? (Number(node.width) - line.width) / 2 : node.align === 'right' ? Number(node.width) - line.width : 0;
        const x = lineStartX + part.offsetX * scaleX;
        const decorationWidth = Math.max(1, style.fontSize / 16);
        const y = line.y + style.fontSize * (style.textDecoration === 'underline' ? 1.03 : 0.55);
        const stroke = partColor === 'none' ? 'none' : partColor;
        decorations.push(`<path d="M ${number(x)} ${number(y)} L ${number(x + part.width * scaleX)} ${number(y)}" fill="none" stroke="${escapeXml(stroke)}" stroke-opacity="${number(textOpacity)}" stroke-width="${number(decorationWidth)}"/>`);
        return partMarkup;
      }).join('');
      return `<tspan x="${number(anchorX)}" y="${number(line.y)}"${textLength}>${parts}</tspan>`;
    }).join('');
    const element = `<text x="${number(anchorX)}" y="0" text-anchor="${align}" dominant-baseline="text-before-edge" font-family="${escapeXml(fontFamily)}" font-size="${number(fontSize)}" font-weight="${escapeXml(fontWeight)}" font-style="${node.fontStyle === 'italic' ? 'italic' : 'normal'}" letter-spacing="${number(letterSpacing)}"${textCase}${fillAttributes(document, node, { text: true })} data-tiny-image-star-text-wrap="canvas-word-wrap">${richTspans}</text>`;
    const border = node.stroke && Number(node.strokeWidth) > 0
      ? `<rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" fill="none"${strokeAttributes(document, node)}/>`
      : '';
    return element + border + decorations.join('');
  }
  const tspans = lines.map(({ displayText, index, width, naturalWidth }) => {
    // Constrain SVG's native font metrics to the editor-measured line width.
    const textLength = width > 0 ? ` textLength="${number(width)}" lengthAdjust="spacingAndGlyphs"` : '';
    return `<tspan x="${number(anchorX)}" y="${number(index * lineHeight)}"${textLength}>${escapeXml(displayText)}</tspan>`;
  }).join('');
  const element = `<text x="${number(anchorX)}" y="0" text-anchor="${align}" dominant-baseline="text-before-edge" font-family="${escapeXml(fontFamily)}" font-size="${number(fontSize)}" font-weight="${escapeXml(fontWeight)}" font-style="${node.fontStyle === 'italic' ? 'italic' : 'normal'}" letter-spacing="${number(letterSpacing)}"${textCase}${fillAttributes(document, node, { text: true })} data-tiny-image-star-text-wrap="canvas-word-wrap">${tspans}</text>`;
  const border = node.stroke && Number(node.strokeWidth) > 0
    ? `<rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" fill="none"${strokeAttributes(document, node)}/>`
    : '';
  const decoration = ['underline', 'line-through'].includes(node.textDecoration) ? node.textDecoration : null;
  const textColor = color(document, node, 'text');
  const textOpacity = node.fillOpacity ?? 1;
  const decorationWidth = Math.max(1, fontSize / 16);
  const decorations = decoration ? lines.map(({ index, width }) => {
    const x = node.align === 'center' ? (Number(node.width) - width) / 2 : node.align === 'right' ? Number(node.width) - width : 0;
    const y = index * lineHeight + fontSize * (decoration === 'underline' ? 1.03 : 0.55);
    return `<path d="M ${number(x)} ${number(y)} L ${number(x + width)} ${number(y)}" fill="none" stroke="${escapeXml(textColor === 'transparent' ? 'none' : textColor)}" stroke-opacity="${number(textOpacity)}" stroke-width="${number(decorationWidth)}"/>`;
  }).join('') : '';
  return element + border + decorations;
}

function clipDefinition(document, id, node) {
  const r = radius(document, node);
  return `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="${number(node.width)}" height="${number(node.height)}" rx="${number(r)}" ry="${number(r)}"/></clipPath>`;
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
    const gradient = gradientDefinition(node, index);
    if (gradient) context.defs.push(gradient.markup);
    let ownShape = shapeMarkup(node, document, measureText, gradient?.id || null);
    if (node.type === 'image' || node.imageFill) {
      const isLayer = node.type === 'image';
      const asset = resolveLocalImage(node, context.assets, isLayer ? node.assetId : node.imageFill.assetId);
      const fit = imageFit(node);
      const clipId = `tis-image-clip-${index}`;
      if (isLayer) {
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
    const childClipId = node.clip ? `tis-clip-${index}` : null;
    if (childClipId) context.defs.push(clipDefinition(document, childClipId, node));
    const filter = effectDefinition(node, index, document, measureText);
    if (filter) context.defs.push(filter.markup);
    const childNodes = node.children?.length
      ? `<g${childClipId ? ` clip-path="url(#${childClipId})"` : ''}>${renderTree(node.children, document, context, true, measureText)}</g>`
      : '';
    const blendMode = node.blendMode && node.blendMode !== 'normal' ? ` style="mix-blend-mode:${escapeXml(node.blendMode)}"` : '';
    markup += `<g${matrixAttribute(transform)} opacity="${number(opacity)}"${filter ? ` filter="url(#${filter.id})"` : ''}${blendMode}${metadata}>${title}${ownShape}${childNodes}</g>`;
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
      if (node.type === 'text') {
        const fontSize = Number(getNodePropertyValue(document, node, 'fontSize') || 24);
        const lineHeight = Number(getNodePropertyValue(document, node, 'lineHeight') || 1.25) * fontSize;
        for (const line of textLines(node, document, measureText)) {
          const lineWidth = line.width;
          const startX = node.align === 'center' ? (width - lineWidth) / 2 : node.align === 'right' ? width - lineWidth : 0;
          if (Array.isArray(line.parts)) {
            const scaleX = line.naturalWidth > line.width && line.naturalWidth > 0 ? line.width / line.naturalWidth : 1;
            const parts = line.parts.length ? line.parts : [{ offsetX: 0, width: line.width, style: { fontSize, textDecoration: node.textDecoration } }];
            for (const part of parts) {
              const size = part.style.fontSize;
              const x1 = startX + part.offsetX * scaleX;
              const x2 = x1 + part.width * scaleX;
              const top = line.y - size * .15;
              const decorationBottom = line.y + size * (part.style.textDecoration === 'underline' ? 1.03 : .55);
              const bottom = Math.max(line.y + size * 1.25, decorationBottom + Math.max(1, size / 16) / 2);
              for (const [x, y] of [[x1, top], [x2, top], [x1, bottom], [x2, bottom]]) include(transformPoint(matrix, x, y), bounds);
            }
          } else {
            const top = line.index * lineHeight - fontSize * .15;
            const bottom = Math.max(line.index * lineHeight + fontSize * 1.25, line.index * lineHeight + fontSize * (node.textDecoration === 'underline' ? 1.03 : .55));
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
      if (node.clip) {
        const clip = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const [x, y] of [[0, 0], [width, 0], [width, height], [0, height]]) include(transformPoint(matrix, x, y), clip);
        childClip = intersectBounds(childClip, clip);
      }
      if (childClip || !clipBounds) visit(node.children, matrix, false, childClip);
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
export function exportNodeToSvg(node, { document = null, assets = null, width, height, measureText } = {}) {
  if (!node || typeof node !== 'object') throw new TypeError('SVG export requires a layer.');
  document ||= emptyDocument;
  validateTree([node], document, assets);
  const bounds = getBounds([node], { document, includePosition: false, measureText });
  const context = { defs: [], nextIndex: 0, assets };
  const markup = renderTree([node], document, context, false, measureText);
  return svgDocument(markup, context.defs, bounds, { width, height });
}

/**
 * Export a page's layers as a self-contained, editable SVG, fitting the viewBox to visible content.
 * Pages with text layers require a canvas-based `measureText` callback.
 */
export function exportPageToSvg(page, { document = null, assets = null, width, height, measureText } = {}) {
  if (!page || !Array.isArray(page.children)) throw new TypeError('SVG export requires a page with child layers.');
  document ||= emptyDocument;
  validateTree(page.children, document, assets);
  const bounds = getBounds(page.children, { document, measureText });
  const context = { defs: [], nextIndex: 0, assets };
  const markup = renderTree(page.children, document, context, true, measureText);
  return svgDocument(markup, context.defs, bounds, { width, height });
}
