import { getNodeColor, getNodePropertyValue } from './model.js';
import { transformTextCase, wrapTextWithMeasure } from './text-layout.js';

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

const supportedTypes = new Set(['frame', 'section', 'group', 'rectangle', 'ellipse', 'line', 'text', 'star', 'polygon', 'path']);
const identity = [1, 0, 0, 1, 0, 0];
const emptyDocument = { variables: [], variableCollections: [], colorStyles: [], pages: [] };

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

function fillAttributes(document, node, { text = false } = {}) {
  const value = text ? color(document, node, 'text') : color(document, node, 'fill');
  const fill = value === 'transparent' ? 'none' : value;
  const opacity = getNodePropertyValue(document, node, 'opacity') ?? 1;
  const fillOpacity = node.fillOpacity ?? 1;
  if (![Number(opacity), Number(fillOpacity)].every(Number.isFinite) || opacity < 0 || opacity > 1 || fillOpacity < 0 || fillOpacity > 1) {
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

function unsupportedFeature(node) {
  if (!supportedTypes.has(node.type)) return `${node.type || 'unknown'} layers`;
  if (node.mask) return 'mask groups';
  if ((node.effects || []).some(effect => effect.visible !== false)) return 'visible layer effects';
  if (node.blendMode && node.blendMode !== 'normal') return `blend mode "${node.blendMode}"`;
  if (node.fillGradient) return 'gradient fills';
  if (node.imageFill) return 'image fills';
  if (node.type === 'group' && node.maskSourceId) return 'mask groups';
  return null;
}

function isNodeVisible(document, node) {
  return getNodePropertyValue(document, node, 'visible') !== false;
}

function validateTree(nodes, document) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') throw new TypeError('SVG export received an invalid layer.');
    if (!isNodeVisible(document, node)) continue;
    const unsupported = unsupportedFeature(node);
    if (unsupported) throw new SvgExportError(unsupported, node);
    dimensions(node);
    if (!Array.isArray(node.children || [])) throw new TypeError(`SVG export requires a child layer list on ${node.name || node.id || '(unnamed)'}.`);
    validateTree(node.children || [], document);
  }
}

function shapeMarkup(node, document, measureText) {
  const fill = fillAttributes(document, node, { text: node.type === 'text' });
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
  const text = transformTextCase(String(getNodePropertyValue(document, node, 'text') ?? ''), node.textCase || 'none');
  if (!text) return [{ displayText: '', index: 0, naturalWidth: 0, width: 0 }];
  if (Number(node.width) <= 0) throw new TypeError(`SVG export cannot faithfully render text in a zero-width box on layer ${node.name || node.id || '(unnamed)'}.`);
  if (typeof measureText !== 'function') throw new TypeError(`SVG export requires canvas text measurement to match editor wrapping on layer ${node.name || node.id || '(unnamed)'}.`);
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

function renderTree(nodes, document, context, includePosition = true, measureText) {
  let markup = '';
  for (const node of nodes || []) {
    if (!isNodeVisible(document, node)) continue;
    const index = context.nextIndex++;
    const transform = nodeMatrix(node, { includePosition });
    const opacity = Number(getNodePropertyValue(document, node, 'opacity') ?? 1);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new TypeError(`SVG export requires valid opacity on layer ${node.name || node.id || '(unnamed)'}.`);
    const title = node.name ? `<title>${escapeXml(node.name)}</title>` : '';
    const metadata = ` data-tiny-image-star-type="${escapeXml(node.type)}"${node.id ? ` data-tiny-image-star-node-id="${escapeXml(node.id)}"` : ''}`;
    let ownShape = shapeMarkup(node, document, measureText);
    if (node.type === 'line' && !node.stroke) ownShape = ownShape.replace(/ stroke="none" stroke-width="[^"]*"\/>$/, ' stroke="none"/>');
    const childClipId = node.clip ? `tis-clip-${index}` : null;
    if (childClipId) context.defs.push(clipDefinition(document, childClipId, node));
    const childNodes = node.children?.length
      ? `<g${childClipId ? ` clip-path="url(#${childClipId})"` : ''}>${renderTree(node.children, document, context, true, measureText)}</g>`
      : '';
    markup += `<g${matrixAttribute(transform)} opacity="${number(opacity)}"${metadata}>${title}${ownShape}${childNodes}</g>`;
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
    for (const node of list || []) {
      if (!isNodeVisible(document, node)) continue;
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
        for (const { index, width: lineWidth } of textLines(node, document, measureText)) {
          const startX = node.align === 'center' ? (width - lineWidth) / 2 : node.align === 'right' ? width - lineWidth : 0;
          const top = index * lineHeight - fontSize * .15;
          const bottom = Math.max(index * lineHeight + fontSize * 1.25, index * lineHeight + fontSize * (node.textDecoration === 'underline' ? 1.03 : .55));
          for (const [x, y] of [[startX, top], [startX + lineWidth, top], [startX, bottom], [startX + lineWidth, bottom]]) include(transformPoint(matrix, x, y), bounds);
        }
      }
      const strokeWidth = node.stroke && Number(node.strokeWidth) > 0 ? Number(node.strokeWidth) / 2 : 0;
      if (strokeWidth) { bounds.minX -= strokeWidth; bounds.minY -= strokeWidth; bounds.maxX += strokeWidth; bounds.maxY += strokeWidth; }
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
export function exportNodeToSvg(node, { document = null, width, height, measureText } = {}) {
  if (!node || typeof node !== 'object') throw new TypeError('SVG export requires a layer.');
  document ||= emptyDocument;
  validateTree([node], document);
  const bounds = getBounds([node], { document, includePosition: false, measureText });
  const context = { defs: [], nextIndex: 0 };
  const markup = renderTree([node], document, context, false, measureText);
  return svgDocument(markup, context.defs, bounds, { width, height });
}

/**
 * Export a page's layers as a self-contained, editable SVG, fitting the viewBox to visible content.
 * Pages with text layers require a canvas-based `measureText` callback.
 */
export function exportPageToSvg(page, { document = null, width, height, measureText } = {}) {
  if (!page || !Array.isArray(page.children)) throw new TypeError('SVG export requires a page with child layers.');
  document ||= emptyDocument;
  validateTree(page.children, document);
  const bounds = getBounds(page.children, { document, measureText });
  const context = { defs: [], nextIndex: 0 };
  const markup = renderTree(page.children, document, context, true, measureText);
  return svgDocument(markup, context.defs, bounds, { width, height });
}
