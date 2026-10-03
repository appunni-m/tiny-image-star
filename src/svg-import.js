import { createDocument, createNode, validateDocument } from './model.js';
import { MAX_TEXT_RUN_BASELINE_SHIFT } from './text-run-editing.js';
import { isValidGradientBasis } from './fills.js';
import { isValidFontVariationValues, parseFontVariationSettings } from './font-variation.js';
import { isValidFontFeatureValues, parseFontFeatureSettings } from './font-features.js';
import { normalizeStrokeDashArray } from './stroke-style.js';

/** An SVG feature that cannot be represented safely as editable Tiny Image Star layers. */
export class SvgImportError extends TypeError {
  constructor(code, message, element = null) {
    super(message);
    this.name = 'SvgImportError';
    this.code = code;
    this.element = element;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SOURCE_LENGTH = 4 * 1024 * 1024;
const MAX_ELEMENTS = 50_000;
const MAX_DEPTH = 128;
const MAX_COORDINATE = 100_000_000;
const MAX_VECTOR_POINTS = 20_000;
const MAX_VECTOR_TOKENS = 100_000;
const MAX_NETWORK_METADATA_LENGTH = 1024 * 1024;
const MAX_NETWORK_VERTICES = 20_000;
const MAX_NETWORK_EDGES = 40_000;
const MAX_NETWORK_FACES = 10_000;
const NETWORK_METADATA_ATTRIBUTE = 'data-tiny-image-star-network-v1';
const MAX_GRADIENTS = 1_000;
const MAX_GRADIENT_STOPS = 8;
const MAX_GRADIENT_HANDLE_COORDINATE = 1_000_000;
const MAX_CLIP_PATHS = 1_000;
const MAX_MASKS = 1_000;
const MAX_FILTERS = 1_000;
const MAX_FILTER_EFFECTS = 8;
// One editable inner shadow is represented by six SVG filter primitives.
const MAX_FILTER_PRIMITIVES = MAX_FILTER_EFFECTS * 6;
const MAX_TEXT_LENGTH = 100_000;
const unsafeSvgElements = new Set(['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'style', 'image', 'use', 'a']);
const initialStyle = {
  fill: '#000000', fillAlpha: 1, fillColorAlpha: 1, fillOpacityValue: 1,
  stroke: null, strokeAlpha: 1, strokeColorAlpha: 1, strokeOpacityValue: 1, strokeWidth: 1,
  strokeCap: 'butt', strokeJoin: 'miter', strokePattern: 'solid', strokeMiterLimit: 4, strokeDashArray: null, fillGradient: null,
  fillRule: 'nonzero', clipRule: null, opacity: 1,
  fontFamily: 'sans-serif', fontSize: 16, fontWeight: 400, fontStyle: 'normal', textAnchor: 'start', baselineShift: 0,
  dominantBaseline: 'alphabetic', letterSpacing: 0, lineHeight: 1.25, textDecoration: 'none', textCase: 'none', xmlSpace: 'default',
  display: true, visibility: 'visible', visible: true
};

function fail(code, message, element = null) {
  throw new SvgImportError(code, message, element);
}

function validXmlCharacter(codePoint) {
  return codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
    || codePoint >= 0x20 && codePoint <= 0xd7ff
    || codePoint >= 0xe000 && codePoint <= 0xfffd
    || codePoint >= 0x10000 && codePoint <= 0x10ffff;
}

function hasInvalidXmlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (!validXmlCharacter(codePoint)) return true;
    if (codePoint > 0xffff) index += 1;
  }
  return false;
}

function decodeXml(value, element) {
  if (hasInvalidXmlCharacter(value)) {
    fail('invalid-xml-character', 'SVG contains a character that XML does not permit.', element);
  }
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(value)) fail('invalid-xml', 'SVG contains an unescaped ampersand in text or an attribute.', element);
  return value.replace(/&([^;]+);/g, (_whole, entity) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    let codePoint;
    if (/^#\d+$/.test(entity)) codePoint = Number(entity.slice(1));
    else if (/^#x[\da-f]+$/i.test(entity)) codePoint = Number.parseInt(entity.slice(2), 16);
    else fail('unsafe-entity', `SVG uses an undeclared XML entity (&${entity};).`, element);
    if (!Number.isInteger(codePoint) || !validXmlCharacter(codePoint)) {
      fail('invalid-xml-character', 'SVG contains a character that XML does not permit.', element);
    }
    return String.fromCodePoint(codePoint);
  });
}

function parseAttributes(source, tag) {
  const attrs = Object.create(null);
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    if (cursor >= source.length) break;
    const nameMatch = /^[A-Za-z_:][\w:.-]*/.exec(source.slice(cursor));
    if (!nameMatch) fail('invalid-xml', `SVG has a malformed attribute on <${tag}>.`, tag);
    const name = nameMatch[0];
    cursor += name.length;
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    if (source[cursor] !== '=') fail('invalid-xml', `SVG attribute ${name} on <${tag}> has no value.`, tag);
    cursor += 1;
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") fail('invalid-xml', `SVG attribute ${name} on <${tag}> must be quoted.`, tag);
    cursor += 1;
    const end = source.indexOf(quote, cursor);
    if (end < 0) fail('invalid-xml', `SVG attribute ${name} on <${tag}> is not closed.`, tag);
    if (Object.hasOwn(attrs, name)) fail('invalid-xml', `SVG repeats attribute ${name} on <${tag}>.`, tag);
    attrs[name] = decodeXml(source.slice(cursor, end), tag);
    cursor = end + 1;
  }
  return attrs;
}

function parseXml(source) {
  if (typeof source !== 'string' || !source.trim()) fail('invalid-input', 'Provide SVG markup as text.');
  if (source.length > MAX_SOURCE_LENGTH) fail('input-too-large', 'SVG markup exceeds the 4 MiB import limit.');
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const root = { tag: '#document', attrs: Object.create(null), children: [] };
  const stack = [root];
  let cursor = 0;
  let count = 0;
  while (cursor < text.length) {
    const open = text.indexOf('<', cursor);
    if (open < 0) {
      if (text.slice(cursor).trim()) fail('unsupported-text', 'Text outside SVG shape elements is not supported.');
      break;
    }
    const textContent = text.slice(cursor, open);
    if (textContent) {
      const parent = stack.at(-1);
      const context = parent?.tag;
      if (['script', 'foreignObject'].includes(context)) fail('active-content', `SVG element <${context}> contains active or embedded content.`, context);
      if (context === 'text' || context === 'tspan' || context === 'title') {
        const decoded = decodeXml(textContent, context);
        parent.textContent = (parent.textContent ?? '') + decoded;
        (parent.content ||= []).push(decoded);
      }
      else if (stack.some(entry => entry.tag === 'text')) { /* The text importer validates nested markup and preserves ordered tspan content. */ }
      else if (textContent.trim()) fail('unsupported-text', 'Text outside a supported <text> element is not accepted.', context);
    }
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4);
      if (end < 0 || text.slice(open + 4, end).includes('--')) fail('invalid-xml', 'SVG contains a malformed XML comment.');
      cursor = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9);
      if (end < 0) fail('invalid-xml', 'SVG contains an unclosed CDATA section.');
      if (text.slice(open + 9, end).trim()) {
        const context = stack.at(-1)?.tag;
        if (['script', 'foreignObject'].includes(context)) fail('active-content', `SVG element <${context}> contains active or embedded content.`, context);
        if (context === 'text' || context === 'tspan') fail('unsupported-text-feature', 'CDATA sections inside SVG text are not supported; use escaped character data.', context);
        fail('unsupported-text', 'Text outside a supported <text> element is not accepted.', context);
      }
      cursor = end + 3;
      continue;
    }
    if (/^<!DOCTYPE/i.test(text.slice(open, open + 10)) || text.startsWith('<!', open)) {
      fail('unsafe-declaration', 'SVG DTDs, entities, and declarations are not accepted.');
    }
    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2);
      if (end < 0) fail('invalid-xml', 'SVG contains an unclosed processing instruction.');
      const instruction = text.slice(open + 2, end).trim();
      if (open !== 0 || !/^xml(?:\s|$)/i.test(instruction)) fail('unsafe-processing-instruction', 'SVG processing instructions are not accepted.');
      cursor = end + 2;
      continue;
    }
    let end = open + 1;
    let quote = null;
    for (; end < text.length; end += 1) {
      const character = text[end];
      if (quote) { if (character === quote) quote = null; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end >= text.length) fail('invalid-xml', 'SVG contains an unclosed tag.');
    const rawTag = text.slice(open + 1, end).trim();
    cursor = end + 1;
    if (rawTag.startsWith('/')) {
      const closing = rawTag.slice(1).trim();
      if (!/^[A-Za-z_:][\w:.-]*$/.test(closing) || stack.length === 1 || stack.at(-1).qualifiedName !== closing) {
        fail('invalid-xml', `SVG has a mismatched closing tag </${closing}>.`);
      }
      stack.pop();
      continue;
    }
    const selfClosing = /\/\s*$/.test(rawTag);
    const content = selfClosing ? rawTag.replace(/\/\s*$/, '').trimEnd() : rawTag;
    const nameMatch = /^([A-Za-z_:][\w:.-]*)(?:\s|$)/.exec(content);
    if (!nameMatch) fail('invalid-xml', 'SVG has a malformed opening tag.');
    const qualifiedName = nameMatch[1];
    const tag = qualifiedName.includes(':') ? qualifiedName.slice(qualifiedName.lastIndexOf(':') + 1) : qualifiedName;
    const attrs = parseAttributes(content.slice(qualifiedName.length), tag);
    if (++count > MAX_ELEMENTS) fail('too-many-elements', `SVG contains more than ${MAX_ELEMENTS} elements.`);
    const node = { tag, qualifiedName, attrs, children: [], serial: count - 1 };
    if (qualifiedName.includes(':') && stack.length > 1) fail('unsupported-namespace', 'Prefixed SVG child elements are not accepted.', tag);
    const parent = stack.at(-1);
    parent.children.push(node);
    if (parent.tag === 'text' || parent.tag === 'tspan') (parent.content ||= []).push(node);
    if (!selfClosing) {
      if (stack.length >= MAX_DEPTH + 1) fail('too-deep', `SVG nesting exceeds ${MAX_DEPTH} elements.`, tag);
      stack.push(node);
    }
  }
  if (stack.length !== 1) fail('invalid-xml', `SVG tag <${stack.at(-1).tag}> is not closed.`, stack.at(-1).tag);
  if (root.children.length !== 1 || root.children[0].tag !== 'svg') fail('invalid-root', 'The document must have one <svg> root element.');
  const svg = root.children[0];
  if (svg.attrs.xmlns && svg.attrs.xmlns !== SVG_NS) fail('unsupported-namespace', 'Only the standard SVG namespace is supported.', 'svg');
  if (svg.qualifiedName.includes(':')) fail('unsupported-namespace', 'Use the default SVG namespace rather than a prefixed root element.', 'svg');
  return svg;
}

function finiteNumber(value, label, element, { min = -MAX_COORDINATE, max = MAX_COORDINATE } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) fail('invalid-number', `SVG ${label} must be a finite number from ${min} to ${max}.`, element);
  return number;
}

function length(value, label, element, fallback = null) {
  if (value == null || value === '') {
    if (fallback != null) return fallback;
    fail('missing-size', `SVG ${label} is required.`, element);
  }
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px)?$/i.exec(value.trim());
  if (!match) fail('unsupported-length', `SVG ${label} must use unitless or px dimensions.`, element);
  return finiteNumber(match[1], label, element, { min: 0, max: MAX_COORDINATE });
}

function coordinateLength(value, label, element, fallback = 0) {
  if (value == null || value === '') return fallback;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px)?$/i.exec(value.trim());
  if (!match) fail('unsupported-length', `SVG ${label} must use unitless or px coordinates.`, element);
  return finiteNumber(match[1], label, element);
}

function parseViewBox(value, element = 'svg') {
  if (value == null) return null;
  const values = numberList(value, 'viewBox', element);
  if (values.length !== 4 || values[2] <= 0 || values[3] <= 0) fail('invalid-viewbox', 'SVG viewBox must contain min-x, min-y, positive width, and positive height.', element);
  return values;
}

const svgPathToken = /[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/y;

class PathTokenReader {
  constructor(text, element) {
    this.text = text;
    this.element = element;
    this.cursor = 0;
    this.cached = undefined;
  }

  readRaw() {
    while (this.cursor < this.text.length && /[\s,]/.test(this.text[this.cursor])) this.cursor += 1;
    if (this.cursor >= this.text.length) return null;
    svgPathToken.lastIndex = this.cursor;
    const match = svgPathToken.exec(this.text);
    if (!match) fail('invalid-path', 'SVG path data contains an invalid token.', this.element);
    this.cursor = svgPathToken.lastIndex;
    return match[0];
  }

  peek() {
    if (this.cached === undefined) this.cached = this.readRaw();
    return this.cached;
  }

  next() {
    const value = this.peek();
    this.cached = undefined;
    return value;
  }
}

function numberList(value, label, element, maxItems = 16) {
  const reader = new PathTokenReader(value, element);
  const values = [];
  while (reader.peek() !== null) {
    const token = reader.next();
    if (/^[a-z]$/i.test(token)) fail('invalid-number-list', `SVG ${label} contains invalid characters.`, element);
    if (values.length >= maxItems) fail('resource-limit', `SVG ${label} exceeds its ${maxItems}-number limit.`, element);
    values.push(finiteNumber(token, label, element));
  }
  return values;
}

function reserveVectorBudget(budget, points, tokens, element) {
  if (budget.points + points > MAX_VECTOR_POINTS || budget.tokens + tokens > MAX_VECTOR_TOKENS) {
    fail('resource-limit', `SVG exceeds the cumulative vector import limit (${MAX_VECTOR_POINTS} points or ${MAX_VECTOR_TOKENS} path tokens).`, element);
  }
  budget.points += points;
  budget.tokens += tokens;
}

function matrixMultiply(left, right) {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

function parseTransform(value, element) {
  if (!value) return [1, 0, 0, 1, 0, 0];
  let cursor = 0;
  let result = [1, 0, 0, 1, 0, 0];
  const re = /([A-Za-z]+)\s*\(([^)]*)\)/gy;
  while (cursor < value.length) {
    while (/[\s,]/.test(value[cursor] || '')) cursor += 1;
    if (cursor >= value.length) break;
    re.lastIndex = cursor;
    const match = re.exec(value);
    if (!match) fail('invalid-transform', `SVG has an invalid transform on <${element}>.`, element);
    const args = numberList(match[2], 'transform', element);
    let next;
    switch (match[1]) {
      case 'matrix':
        if (args.length !== 6) fail('invalid-transform', 'matrix() requires six numbers.', element);
        next = args; break;
      case 'translate':
        if (args.length < 1 || args.length > 2) fail('invalid-transform', 'translate() requires one or two numbers.', element);
        next = [1, 0, 0, 1, args[0], args[1] ?? 0]; break;
      case 'scale':
        if (args.length < 1 || args.length > 2) fail('invalid-transform', 'scale() requires one or two numbers.', element);
        next = [args[0], 0, 0, args[1] ?? args[0], 0, 0]; break;
      case 'rotate': {
        if (args.length !== 1 && args.length !== 3) fail('invalid-transform', 'rotate() requires one number or an angle and center.', element);
        const angle = args[0] * Math.PI / 180;
        const rotation = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
        next = args.length === 1 ? rotation : matrixMultiply([1, 0, 0, 1, args[1], args[2]], matrixMultiply(rotation, [1, 0, 0, 1, -args[1], -args[2]]));
        break;
      }
      case 'skewX':
      case 'skewY': {
        if (args.length !== 1 || Math.abs(Math.cos(args[0] * Math.PI / 180)) < 1e-8) fail('invalid-transform', `${match[1]}() requires one finite angle below 90 degrees in magnitude.`, element);
        const tangent = Math.tan(args[0] * Math.PI / 180);
        next = match[1] === 'skewX' ? [1, 0, tangent, 1, 0, 0] : [1, tangent, 0, 1, 0, 0];
        break;
      }
      default: fail('unsupported-transform', `SVG transform ${match[1]}() is unsupported.`, element);
    }
    if (!next.every(Number.isFinite)) fail('invalid-transform', 'SVG transform has a non-finite result.', element);
    result = matrixMultiply(result, next);
    cursor = re.lastIndex;
  }
  return result;
}

function mapPoint(matrix, point) {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}

function importedNetwork(node, matrix, style, prefix, counter, metadataText) {
  if (node.tag !== 'g' || node.attrs['data-tiny-image-star-type'] !== 'network') {
    fail('invalid-network-metadata', 'Tiny Image Star network metadata must be attached to a marked <g> network wrapper.', node.tag);
  }
  if (metadataText.length > MAX_NETWORK_METADATA_LENGTH) {
    fail('resource-limit', `Tiny Image Star network metadata exceeds the ${MAX_NETWORK_METADATA_LENGTH}-character limit.`, node.tag);
  }
  let payload;
  try { payload = JSON.parse(metadataText); }
  catch { fail('invalid-network-metadata', 'Tiny Image Star network metadata is not valid JSON.', node.tag); }
  const geometry = payload?.geometry;
  if (!payload || Object.keys(payload).some(key => !['version', 'name', 'geometry', 'paint'].includes(key))
    || !geometry || Object.keys(geometry).some(key => !['width', 'height', 'vertices', 'edges', 'faces'].includes(key))
    || payload.version !== 1 || typeof payload.name !== 'string' || payload.name.length > 120
    || !geometry || !Number.isFinite(geometry.width) || geometry.width <= 0 || geometry.width > MAX_COORDINATE
    || !Number.isFinite(geometry.height) || geometry.height <= 0 || geometry.height > MAX_COORDINATE
    || !Array.isArray(geometry.vertices) || geometry.vertices.length < 2 || geometry.vertices.length > MAX_NETWORK_VERTICES
    || !Array.isArray(geometry.edges) || !geometry.edges.length || geometry.edges.length > MAX_NETWORK_EDGES
    || !Array.isArray(geometry.faces) || geometry.faces.length > MAX_NETWORK_FACES
    || !payload.paint || typeof payload.paint !== 'object' || Array.isArray(payload.paint)) {
    fail('invalid-network-metadata', 'Tiny Image Star network metadata has an invalid version or graph structure.', node.tag);
  }
  const allowedPaint = new Set(['fill', 'fillOpacity', 'stroke', 'strokeWidth', 'strokeOpacity', 'strokeCap', 'strokeJoin', 'strokePattern', 'strokeDashArray', 'strokeMiterLimit', 'strokes', 'fillGradient', 'fillRule']);
  if (Object.keys(payload.paint).some(key => !allowedPaint.has(key))) {
    fail('invalid-network-metadata', 'Tiny Image Star network metadata contains unsupported paint fields.', node.tag);
  }

  // Validate the untransformed graph first. Transform only after graph identities,
  // controls, and face boundaries have passed the same document rules as saved data.
  const source = createNode('network', {
    width: geometry.width, height: geometry.height,
    vertices: geometry.vertices, edges: geometry.edges, faces: geometry.faces,
    ...payload.paint
  });
  const sourceDocument = createDocument();
  sourceDocument.pages[0].children = [source];
  try { validateDocument(sourceDocument); }
  catch { fail('invalid-network-metadata', 'Tiny Image Star network metadata contains invalid vector graph data.', node.tag); }

  const corners = [
    mapPoint(matrix, { x: 0, y: 0 }), mapPoint(matrix, { x: geometry.width, y: 0 }),
    mapPoint(matrix, { x: geometry.width, y: geometry.height }), mapPoint(matrix, { x: 0, y: geometry.height })
  ];
  const x = Math.min(...corners.map(point => point.x));
  const y = Math.min(...corners.map(point => point.y));
  const width = Math.max(1, Math.max(...corners.map(point => point.x)) - x);
  const height = Math.max(1, Math.max(...corners.map(point => point.y)) - y);
  const convert = point => {
    const transformed = mapPoint(matrix, { x: Number(point.x) * geometry.width, y: Number(point.y) * geometry.height });
    return { x: (transformed.x - x) / width, y: (transformed.y - y) / height };
  };
  const vertices = geometry.vertices.map(vertex => ({
    ...vertex,
    ...convert(vertex),
    ...(vertex.split ? { split: {
      ...vertex.split,
      originalEdge: {
        ...vertex.split.originalEdge,
        ...Object.fromEntries(['control1', 'control2'].filter(part => vertex.split.originalEdge[part]).map(part => [part, convert(vertex.split.originalEdge[part])]))
      }
    } } : {})
  }));
  const edges = geometry.edges.map(edge => ({
    ...edge,
    ...Object.fromEntries(['control1', 'control2'].filter(part => edge[part]).map(part => [part, convert(edge[part])]))
  }));
  const scale = matrixScale(matrix);
  if (scale == null && (payload.paint.strokeWidth > 0 || payload.paint.strokes?.some(stroke => stroke.width > 0 && stroke.visible))) {
    fail('non-uniform-stroke-transform', 'Tiny Image Star vector network metadata uses a non-uniform transform with a visible stroke.', node.tag);
  }
  if (scale == null && vertices.some(vertex => Number(vertex.cornerRadius) > 0)) {
    fail('non-uniform-corner-radius-transform', 'Tiny Image Star vector network metadata uses a non-uniform transform with a rounded vertex.', node.tag);
  }
  const paint = { ...payload.paint };
  if (scale != null && scale !== 1) {
    if (Number.isFinite(paint.strokeWidth)) paint.strokeWidth *= scale;
    if (Array.isArray(paint.strokes)) paint.strokes = paint.strokes.map(stroke => ({ ...stroke, width: stroke.width * scale }));
    for (const vertex of vertices) if (Number.isFinite(vertex.cornerRadius)) vertex.cornerRadius *= scale;
  }
  const imported = createNode('network', {
    id: `${prefix}-network-${counter.next++}`, name: cleanLayerName(payload.name || localName(node)),
    x, y, width, height, rotation: 0, opacity: style.opacity,
    ...paint, vertices, edges, faces: geometry.faces
  });
  const document = createDocument();
  document.pages[0].children = [imported];
  try { validateDocument(document); }
  catch { fail('invalid-network-metadata', 'Transformed Tiny Image Star network metadata is invalid.', node.tag); }
  return imported;
}

function matrixScale(matrix) {
  const xScale = Math.hypot(matrix[0], matrix[1]);
  const yScale = Math.hypot(matrix[2], matrix[3]);
  const dot = matrix[0] * matrix[2] + matrix[1] * matrix[3];
  const tolerance = Math.max(1, xScale, yScale) * 1e-8;
  if (Math.abs(xScale - yScale) > tolerance || Math.abs(dot) > tolerance * Math.max(1, xScale, yScale)) return null;
  return (xScale + yScale) / 2;
}

function color(value, element) {
  const input = value.trim().toLowerCase();
  if (input === 'none' || input === 'transparent') return { value: null, alpha: 0 };
  const named = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
    gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', navy: '#000080', teal: '#008080',
    silver: '#c0c0c0', maroon: '#800000', lime: '#00ff00', aqua: '#00ffff', fuchsia: '#ff00ff', olive: '#808000'
  };
  if (Object.hasOwn(named, input)) return { value: named[input], alpha: 1 };
  let hex = input;
  if (/^#[\da-f]{3}$/i.test(hex)) hex = `#${[...hex.slice(1)].map(channel => channel + channel).join('')}`;
  if (/^#[\da-f]{4}$/i.test(hex)) {
    const channels = [...hex.slice(1)].map(channel => channel + channel);
    return { value: `#${channels.slice(0, 3).join('')}`, alpha: Number.parseInt(channels[3], 16) / 255 };
  }
  if (/^#[\da-f]{8}$/i.test(hex)) return { value: hex.slice(0, 7), alpha: Number.parseInt(hex.slice(7), 16) / 255 };
  if (/^#[\da-f]{6}$/i.test(hex)) return { value: hex, alpha: 1 };
  const rgb = /^rgba?\(\s*([^)]*)\s*\)$/.exec(input);
  if (rgb) {
    let components;
    if (rgb[1].includes(',')) components = rgb[1].split(',').map(part => part.trim());
    else components = rgb[1].replace(/\s*\/\s*/g, ' / ').trim().split(/\s+/);
    const slash = components.indexOf('/');
    let alphaValue = 1;
    if (slash >= 0) { alphaValue = parseAlpha(components.at(-1), 'color alpha', element); components = components.slice(0, slash); }
    else if (components.length === 4) alphaValue = parseAlpha(components.pop(), 'color alpha', element);
    if (components.length !== 3) fail('unsupported-color', `SVG color “${value}” is unsupported.`, element);
    const rgbValues = components.map(part => {
      if (/^[+-]?(?:\d+\.?\d*|\.\d+)%$/.test(part)) return Math.round(Math.max(0, Math.min(100, Number(part.slice(0, -1)))) * 2.55);
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(part)) fail('unsupported-color', `SVG color “${value}” is unsupported.`, element);
      return Math.round(Math.max(0, Math.min(255, Number(part))));
    });
    return { value: `#${rgbValues.map(channel => channel.toString(16).padStart(2, '0')).join('')}`, alpha: alphaValue };
  }
  fail('unsupported-color', `SVG color “${value}” is unsupported. Use solid hex, rgb(), or a supported color name.`, element);
}

function parseAlpha(value, label, element) {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(%?)$/.exec(String(value).trim());
  if (!match) fail('invalid-opacity', `SVG ${label} must be between zero and one.`, element);
  const result = Number(match[1]) / (match[2] ? 100 : 1);
  if (!Number.isFinite(result) || result < 0 || result > 1) fail('invalid-opacity', `SVG ${label} must be between zero and one.`, element);
  return result;
}

function gradientCoordinate(value, label, units, element, fallback) {
  if (value == null) return fallback;
  if (units === 'objectBoundingBox') {
    const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%)?$/i.exec(value.trim());
    if (!match) fail('unsupported-gradient', `SVG gradient ${label} must use a unitless or percentage object-bounding-box coordinate.`, element);
    const number = finiteNumber(match[1], `gradient ${label}`, element);
    return match[2] ? number / 100 : number;
  }
  return coordinateLength(value, `gradient ${label}`, element);
}

function gradientStops(node) {
  if (node.children.length < 2 || node.children.length > MAX_GRADIENT_STOPS) {
    fail('unsupported-gradient', `SVG gradients must contain between two and ${MAX_GRADIENT_STOPS} color stops.`, node.tag);
  }
  let previousPosition = -1;
  let commonAlpha = null;
  const stops = node.children.map(stop => {
    if (stop.tag !== 'stop' || stop.children.length) fail('unsupported-gradient', 'SVG gradients may contain only empty <stop> elements.', stop.tag);
    const allowed = new Set(['id', 'offset', 'stop-color', 'stop-opacity', 'style']);
    for (const key of Object.keys(stop.attrs)) {
      if (/^on/i.test(key)) fail('active-content', `SVG event handler attribute “${key}” is not accepted.`, 'stop');
      if (!allowed.has(key)) fail('unsupported-gradient', `SVG gradient stop attribute “${key}” is unsupported.`, 'stop');
    }
    const style = Object.create(null);
    if (stop.attrs.style != null) {
      for (const declaration of stop.attrs.style.split(';')) {
        if (!declaration.trim()) continue;
        const colon = declaration.indexOf(':');
        if (colon <= 0) fail('invalid-style', 'SVG gradient stop style is malformed.', 'stop');
        const name = declaration.slice(0, colon).trim().toLowerCase();
        if (!['stop-color', 'stop-opacity'].includes(name) || Object.hasOwn(style, name)) {
          fail('unsupported-gradient', `SVG gradient stop style “${name}” is unsupported or repeated.`, 'stop');
        }
        style[name] = declaration.slice(colon + 1).trim().replace(/\s*!important\s*$/i, '');
      }
    }
    const offsetText = stop.attrs.offset ?? '0';
    const offsetMatch = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%)?$/i.exec(offsetText.trim());
    if (!offsetMatch) fail('invalid-gradient', 'SVG gradient stop offsets must be numbers from zero to one or percentages.', 'stop');
    const rawPosition = finiteNumber(offsetMatch[1], 'gradient stop offset', 'stop', { min: 0, max: 1_000_000 }) / (offsetMatch[2] ? 100 : 1);
    const position = Math.min(1, Math.max(previousPosition, rawPosition));
    previousPosition = position;
    const parsedColor = color(style['stop-color'] ?? stop.attrs['stop-color'] ?? '#000000', 'stop');
    const alpha = parsedColor.alpha * parseAlpha(style['stop-opacity'] ?? stop.attrs['stop-opacity'] ?? '1', 'stop opacity', 'stop');
    if (commonAlpha == null) commonAlpha = alpha;
    else if (Math.abs(commonAlpha - alpha) > 1e-8) {
      fail('unsupported-gradient', 'The editor cannot preserve different opacity values between SVG gradient stops.', 'stop');
    }
    if (!parsedColor.value) fail('unsupported-gradient', 'Transparent SVG gradient stops are not supported.', 'stop');
    return { color: parsedColor.value, position };
  });
  return { stops, alpha: commonAlpha ?? 1 };
}

function parseGradient(node, ids) {
  if (!['linearGradient', 'radialGradient'].includes(node.tag)) fail('unsupported-gradient', 'Only SVG linearGradient and radialGradient definitions are supported.', node.tag);
  const id = node.attrs.id;
  if (!id || !/^[A-Za-z_][\w.-]*$/.test(id) || ids.has(id)) fail('invalid-gradient', 'Every SVG gradient must have a unique, simple id.', node.tag);
  const linear = node.tag === 'linearGradient';
  const allowed = new Set(['id', 'gradientUnits', 'gradientTransform', 'spreadMethod', ...(linear ? ['x1', 'y1', 'x2', 'y2'] : ['cx', 'cy', 'r', 'fx', 'fy', 'fr'])]);
  for (const key of Object.keys(node.attrs)) {
    if (/^(?:href|xlink:href)$/i.test(key)) fail('external-reference', 'SVG gradients cannot reference another element.', node.tag);
    if (!allowed.has(key)) fail('unsupported-gradient', `SVG gradient attribute “${key}” is unsupported.`, node.tag);
  }
  const units = node.attrs.gradientUnits ?? 'objectBoundingBox';
  if (!['objectBoundingBox', 'userSpaceOnUse'].includes(units)) fail('invalid-gradient', 'SVG gradientUnits must be objectBoundingBox or userSpaceOnUse.', node.tag);
  const spread = node.attrs.spreadMethod ?? 'pad';
  if (!['pad', 'reflect', 'repeat'].includes(spread)) fail('invalid-gradient', 'SVG gradient spreadMethod is invalid.', node.tag);
  if (spread !== 'pad') fail('unsupported-gradient', 'SVG repeating and reflecting gradient spreads are not supported.', node.tag);
  const transform = parseTransform(node.attrs.gradientTransform, node.tag);
  const { stops, alpha } = gradientStops(node);
  ids.add(id);
  if (linear) {
    return {
      id, type: 'linear', units, transform,
      x1: gradientCoordinate(node.attrs.x1, 'x1', units, node.tag, 0),
      y1: gradientCoordinate(node.attrs.y1, 'y1', units, node.tag, 0),
      x2: gradientCoordinate(node.attrs.x2, 'x2', units, node.tag, 1),
      y2: gradientCoordinate(node.attrs.y2, 'y2', units, node.tag, 0), stops, alpha
    };
  }
  const cx = gradientCoordinate(node.attrs.cx, 'cx', units, node.tag, 0.5);
  const cy = gradientCoordinate(node.attrs.cy, 'cy', units, node.tag, 0.5);
  const fx = gradientCoordinate(node.attrs.fx, 'fx', units, node.tag, cx);
  const fy = gradientCoordinate(node.attrs.fy, 'fy', units, node.tag, cy);
  const fr = gradientCoordinate(node.attrs.fr, 'fr', units, node.tag, 0);
  const r = gradientCoordinate(node.attrs.r, 'r', units, node.tag, 0.5);
  if (r <= 0 || fr !== 0 || Math.abs(fx - cx) > 1e-9 || Math.abs(fy - cy) > 1e-9) {
    fail('unsupported-gradient', 'The editor supports centered SVG radial gradients with a positive outer radius and no inner radius.', node.tag);
  }
  return { id, type: 'radial', units, transform, cx, cy, r, stops, alpha };
}

function filterNumber(value, label, element, { min = -MAX_COORDINATE, max = MAX_COORDINATE } = {}) {
  if (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
    fail('unsupported-filter', `SVG filter ${label} must be a unitless finite number.`, element);
  }
  return finiteNumber(value, `filter ${label}`, element, { min, max });
}

function filterDeviation(value, element, primitive, fallback = '0') {
  const values = numberList(value ?? fallback, 'filter stdDeviation', primitive, 2);
  if (!values.length || values.length > 2 || values.some(item => item < 0)
    || values.length === 2 && Math.abs(values[0] - values[1]) > 1e-9) {
    fail('unsupported-filter', 'SVG filter blur must use one nonnegative stdDeviation value or two equal values.', primitive);
  }
  return values[0];
}

function filterRegionLength(value, label, element, units, fallback, relativeDefault = false) {
  const text = String(value ?? fallback).trim();
  if (units === 'objectBoundingBox' || text.endsWith('%') || value == null && relativeDefault) {
    const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%)?$/i.exec(text);
    if (!match) fail('unsupported-filter-region', `SVG filter ${label} must use a unitless or percentage object-bounding-box value.`, element);
    const numeric = filterNumber(match[1], label, element);
    return { value: match[2] ? numeric / 100 : numeric, relative: true };
  }
  return { value: coordinateLength(text, `filter ${label}`, element), relative: false };
}

function parseFilter(node, ids) {
  const id = node.attrs.id;
  if (!id || !/^[A-Za-z_][\w.-]*$/.test(id) || ids.has(id)) {
    fail('invalid-filter', 'Every SVG filter must have a unique, simple id.', node.tag);
  }
  const allowed = new Set(['id', 'filterUnits', 'primitiveUnits', 'x', 'y', 'width', 'height']);
  for (const key of Object.keys(node.attrs)) {
    if (/^(?:href|xlink:href)$/i.test(key)) fail('external-reference', 'SVG filters cannot reference another element.', node.tag);
    if (!allowed.has(key)) fail('unsupported-filter', `SVG filter attribute “${key}” is unsupported.`, node.tag);
  }
  const units = node.attrs.filterUnits ?? 'objectBoundingBox';
  const primitiveUnits = node.attrs.primitiveUnits ?? 'userSpaceOnUse';
  if (!['objectBoundingBox', 'userSpaceOnUse'].includes(units)) {
    fail('unsupported-filter', 'SVG filterUnits must be objectBoundingBox or userSpaceOnUse.', node.tag);
  }
  if (primitiveUnits !== 'userSpaceOnUse') {
    fail('unsupported-filter', 'SVG primitiveUnits="objectBoundingBox" cannot be represented faithfully; use userSpaceOnUse.', node.tag);
  }
  const region = units === 'userSpaceOnUse'
    ? {
      units,
      x: filterRegionLength(node.attrs.x, 'x', node.tag, units, '-10%', true),
      y: filterRegionLength(node.attrs.y, 'y', node.tag, units, '-10%', true),
      width: filterRegionLength(node.attrs.width, 'width', node.tag, units, '120%', true),
      height: filterRegionLength(node.attrs.height, 'height', node.tag, units, '120%', true)
    }
    : {
      units,
      x: filterRegionLength(node.attrs.x, 'x', node.tag, units, '-10%'),
      y: filterRegionLength(node.attrs.y, 'y', node.tag, units, '-10%'),
      width: filterRegionLength(node.attrs.width, 'width', node.tag, units, '120%'),
      height: filterRegionLength(node.attrs.height, 'height', node.tag, units, '120%')
    };
  if (!(region.width.value > 0) || !(region.height.value > 0)) fail('invalid-filter', 'SVG filter width and height must be positive.', node.tag);
  if (node.children.length > MAX_FILTER_PRIMITIVES) {
    fail('resource-limit', `SVG filters may contain at most ${MAX_FILTER_EFFECTS} editable effects.`, node.tag);
  }

  if (node.children.length === 1 && node.children[0].tag === 'feComponentTransfer') {
    const transfer = node.children[0];
    const alpha = transfer.children[0];
    if (Object.keys(transfer.attrs).length === 0 && transfer.children.length === 1
      && alpha?.tag === 'feFuncA' && alpha.children.length === 0
      && Object.keys(alpha.attrs).length === 2 && alpha.attrs.type === 'table' && alpha.attrs.tableValues === '1 0') {
      ids.add(id);
      return { id, region, effects: [], alphaInversion: true };
    }
    fail('unsupported-filter-graph', 'Only the editor’s exact alpha-inversion filter can be used inside an editable Boolean cutout mask.', node.tag);
  }

  let previousResult = 'SourceGraphic';
  const results = new Set(['SourceGraphic', 'SourceAlpha', 'BackgroundImage', 'BackgroundAlpha', 'FillPaint', 'StrokePaint']);
  const effects = [];
  const innerShadowTags = ['feGaussianBlur', 'feOffset', 'feComposite', 'feFlood', 'feComposite', 'feComposite'];
  const assertPrimitiveAttributes = (primitive, allowed, required = allowed) => {
    if (primitive.children.length) fail('unsupported-filter', `SVG <${primitive.tag}> cannot contain child elements.`, primitive.tag);
    for (const key of Object.keys(primitive.attrs)) {
      if (/^(?:href|xlink:href)$/i.test(key)) fail('external-reference', 'SVG filter primitives cannot reference another element.', primitive.tag);
      if (!allowed.has(key)) fail('unsupported-filter', `SVG <${primitive.tag}> attribute “${key}” is unsupported.`, primitive.tag);
    }
    for (const key of required) {
      if (!Object.hasOwn(primitive.attrs, key)) fail('unsupported-filter-graph', `The editor’s inner-shadow filter chain requires SVG <${primitive.tag}> attribute “${key}”.`, primitive.tag);
    }
  };
  const reserveResult = primitive => {
    const result = primitive.attrs.result;
    if (!result || result.length > 128 || !/^[A-Za-z_][\w.-]*$/.test(result) || results.has(result)) {
      fail('invalid-filter', `SVG <${primitive.tag}> result must be a unique simple name.`, primitive.tag);
    }
    results.add(result);
    return result;
  };
  for (let index = 0; index < node.children.length;) {
    const primitive = node.children[index];
    const possibleInnerShadow = node.children.slice(index, index + innerShadowTags.length);
    if (possibleInnerShadow.length === innerShadowTags.length
      && possibleInnerShadow.every((item, itemIndex) => item.tag === innerShadowTags[itemIndex])) {
      const [blur, offset, cutout, floodPrimitive, tint, composite] = possibleInnerShadow;
      const currentInput = previousResult;
      assertPrimitiveAttributes(blur, new Set(['in', 'stdDeviation', 'result']));
      assertPrimitiveAttributes(offset, new Set(['in', 'dx', 'dy', 'result']));
      assertPrimitiveAttributes(cutout, new Set(['in', 'in2', 'operator', 'result']));
      assertPrimitiveAttributes(floodPrimitive, new Set(['flood-color', 'flood-opacity', 'result']));
      assertPrimitiveAttributes(tint, new Set(['in', 'in2', 'operator', 'result']));
      assertPrimitiveAttributes(composite, new Set(['in', 'in2', 'operator', 'result']));

      if (blur.attrs.in !== currentInput || offset.attrs.in !== blur.attrs.result
        || cutout.attrs.in !== currentInput || cutout.attrs.in2 !== offset.attrs.result || cutout.attrs.operator !== 'out'
        || tint.attrs.in !== floodPrimitive.attrs.result || tint.attrs.in2 !== cutout.attrs.result || tint.attrs.operator !== 'in'
        || composite.attrs.in !== tint.attrs.result || composite.attrs.in2 !== currentInput || composite.attrs.operator !== 'over') {
        fail('unsupported-filter-graph', 'Only the editor’s exact Gaussian-blur, offset, alpha-cutout and color-composite inner-shadow chain can be represented as an editable effect.', primitive.tag);
      }

      const blurRadius = filterDeviation(blur.attrs.stdDeviation, blur.tag, blur);
      const offsetX = filterNumber(offset.attrs.dx, 'dx', offset);
      const offsetY = filterNumber(offset.attrs.dy, 'dy', offset);
      const flood = color(floodPrimitive.attrs['flood-color'], floodPrimitive.tag);
      const opacity = parseAlpha(floodPrimitive.attrs['flood-opacity'], 'filter flood-opacity', floodPrimitive.tag);
      reserveResult(blur);
      reserveResult(offset);
      reserveResult(cutout);
      reserveResult(floodPrimitive);
      reserveResult(tint);
      previousResult = reserveResult(composite);
      effects.push({
        type: 'inner-shadow', color: flood.value ?? '#000000', opacity: flood.alpha * opacity,
        offsetX, offsetY, blur: blurRadius
      });
      index += innerShadowTags.length;
      continue;
    }

    if (!['feGaussianBlur', 'feDropShadow'].includes(primitive.tag)) {
      fail('unsupported-filter', `SVG filter primitive <${primitive.tag}> cannot be edited here; only linear feGaussianBlur, feDropShadow and the editor’s exact inner-shadow chain are supported.`, primitive.tag);
    }
    const primitiveAllowed = primitive.tag === 'feGaussianBlur'
      ? new Set(['in', 'stdDeviation', 'result'])
      : new Set(['in', 'dx', 'dy', 'stdDeviation', 'flood-color', 'flood-opacity', 'result']);
    assertPrimitiveAttributes(primitive, primitiveAllowed, new Set());
    const input = primitive.attrs.in ?? previousResult;
    if (input !== previousResult) {
      fail('unsupported-filter-graph', `SVG filter primitive <${primitive.tag}> reads “${input}”; only a single SourceGraphic-to-result chain can be represented.`, primitive.tag);
    }
    const result = primitive.attrs.result == null ? null : reserveResult(primitive);
    previousResult = result ?? `#implicit-${index}`;
    if (primitive.tag === 'feGaussianBlur') {
      effects.push({ type: 'layer-blur', radius: filterDeviation(primitive.attrs.stdDeviation, primitive.tag, primitive) });
    } else {
      const deviation = filterDeviation(primitive.attrs.stdDeviation, primitive.tag, primitive, '2');
      const flood = color(primitive.attrs['flood-color'] ?? 'black', primitive.tag);
      const opacity = parseAlpha(primitive.attrs['flood-opacity'] ?? '1', 'filter flood-opacity', primitive.tag);
      effects.push({
        type: 'drop-shadow', color: flood.value ?? '#000000', opacity: flood.alpha * opacity,
        offsetX: filterNumber(primitive.attrs.dx ?? '2', 'dx', primitive.tag),
        offsetY: filterNumber(primitive.attrs.dy ?? '2', 'dy', primitive.tag), blur: deviation
      });
    }
    index += 1;
  }
  if (effects.length > MAX_FILTER_EFFECTS) {
    fail('unsupported-filter-graph', `SVG filter has more than ${MAX_FILTER_EFFECTS} effects and cannot be represented by this editor.`, node.tag);
  }
  if (effects.filter(effect => effect.type === 'layer-blur').length > 1) {
    fail('unsupported-filter-graph', 'SVG filters with more than one layer blur cannot be represented as editable effects.', node.tag);
  }
  ids.add(id);
  return { id, region, effects };
}

function parseMaskDefinition(node, ids, gradients) {
  const id = node.attrs.id;
  if (!id || !/^[A-Za-z_][\w.-]*$/.test(id) || ids.has(id)) {
    fail('invalid-mask', 'Every SVG mask must have a unique, simple id.', node.tag);
  }
  const allowed = new Set(['id', 'maskUnits', 'maskContentUnits', 'mask-type', 'data-tiny-image-star-mask-mode', 'x', 'y', 'width', 'height']);
  for (const key of Object.keys(node.attrs)) {
    if (/^on/i.test(key)) fail('active-content', `SVG event handler attribute “${key}” is not accepted.`, node.tag);
    if (!allowed.has(key)) fail('unsupported-mask', `SVG mask attribute “${key}” is unsupported.`, node.tag);
  }
  if (node.attrs.maskUnits !== 'userSpaceOnUse' || node.attrs.maskContentUnits !== 'userSpaceOnUse') {
    fail('unsupported-mask-units', 'Editable SVG masks require maskUnits and maskContentUnits="userSpaceOnUse".', node.tag);
  }
  const maskType = node.attrs['mask-type'] ?? 'luminance';
  if (!['alpha', 'luminance'].includes(maskType)) fail('unsupported-mask', 'SVG mask-type must be alpha or luminance.', node.tag);
  const localMaskMode = node.attrs['data-tiny-image-star-mask-mode'] ?? 'alpha';
  if (!['alpha', 'vector'].includes(localMaskMode) || (localMaskMode === 'vector' && maskType !== 'alpha')) {
    fail('unsupported-mask', 'Tiny Image Star vector masks must be encoded as alpha masks with the local mode marker.', node.tag);
  }
  const region = {
    x: coordinateLength(node.attrs.x, 'mask x', node.tag),
    y: coordinateLength(node.attrs.y, 'mask y', node.tag),
    width: length(node.attrs.width, 'mask width', node.tag),
    height: length(node.attrs.height, 'mask height', node.tag)
  };
  if (region.width <= 0 || region.height <= 0) fail('invalid-mask', 'SVG mask width and height must be positive.', node.tag);
  const mask = { id, maskType, localMaskMode, region, children: node.children };
  ids.add(id);

  // Validate every embedded element, including content in an unused mask, so
  // active content, linked assets and unsupported declarations cannot hide in
  // defs and become executable if a later edit adds a reference.
  const visit = (child, inherited) => {
    if (unsafeSvgElements.has(child.tag)) {
      const code = ['script', 'foreignObject'].includes(child.tag) ? 'active-content' : ['image', 'use'].includes(child.tag) ? 'external-reference' : 'unsupported-element';
      fail(code, `SVG element <${child.tag}> is not accepted inside a mask.`, child.tag);
    }
    if (child.tag === 'g' || clipPathGeometryTags.has(child.tag)) {
      checkElementAttributes(child);
      const style = parseStyle(child, inherited, gradients);
      if (style.clipPathRef) fail('unsupported-mask-graph', 'Clipping is unsupported inside an editable mask.', child.tag);
      for (const nested of child.children) visit(nested, style);
      return;
    }
    fail('unsupported-mask-graph', `SVG mask child <${child.tag}> cannot be represented as one editable local vector source.`, child.tag);
  };
  for (const child of node.children) visit(child, initialStyle);
  return mask;
}

function collectDefinitions(root) {
  const gradients = new Map();
  const clipPaths = new Map();
  const filters = new Map();
  const masks = new Map();
  const ids = new Set();
  let stopCount = 0;
  for (const defs of root.children.filter(child => child.tag === 'defs')) {
    for (const child of defs.children) {
      if (['linearGradient', 'radialGradient'].includes(child.tag)) {
        if (gradients.size >= MAX_GRADIENTS) fail('resource-limit', `SVG contains more than ${MAX_GRADIENTS} gradient definitions.`, 'defs');
        stopCount += child.children.length;
        if (stopCount > MAX_GRADIENTS * MAX_GRADIENT_STOPS) fail('resource-limit', 'SVG contains too many gradient stops.', 'defs');
        const gradient = parseGradient(child, ids);
        gradients.set(gradient.id, gradient);
      } else if (child.tag === 'clipPath') {
        // Parse clip-path styles after gradients so definition order does not
        // change whether a local gradient reference is accepted.
      } else if (child.tag === 'filter') {
        if (filters.size >= MAX_FILTERS) fail('resource-limit', `SVG contains more than ${MAX_FILTERS} filter definitions.`, 'defs');
        const filter = parseFilter(child, ids);
        filters.set(filter.id, filter);
      } else if (child.tag === 'mask') {
        // Parse mask content after gradients so definition order cannot change
        // whether a local paint reference is accepted.
      } else {
        fail('unsupported-definition', `<defs> element <${child.tag}> is not supported; only editable gradients, clip paths, masks, and filters are accepted.`, child.tag);
      }
    }
  }
  for (const defs of root.children.filter(child => child.tag === 'defs')) {
    for (const child of defs.children.filter(entry => entry.tag === 'clipPath')) {
      if (clipPaths.size >= MAX_CLIP_PATHS) fail('resource-limit', `SVG contains more than ${MAX_CLIP_PATHS} clip-path definitions.`, 'defs');
      const clipPath = parseClipPath(child, ids, gradients);
      clipPaths.set(clipPath.id, clipPath);
    }
  }
  for (const defs of root.children.filter(child => child.tag === 'defs')) {
    for (const child of defs.children.filter(entry => entry.tag === 'mask')) {
      if (masks.size >= MAX_MASKS) fail('resource-limit', `SVG contains more than ${MAX_MASKS} mask definitions.`, 'defs');
      const mask = parseMaskDefinition(child, ids, gradients);
      masks.set(mask.id, mask);
    }
  }
  return { gradients, clipPaths, filters, masks };
}

const inheritedProperties = new Set([
  'fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'color', 'visibility', 'font-family', 'font-size',
  'font-weight', 'font-style', 'font-variation-settings', 'font-feature-settings', 'text-anchor', 'dominant-baseline', 'baseline-shift', 'letter-spacing', 'line-height', 'text-decoration', 'text-transform'
]);
const styleProperties = new Set([...inheritedProperties, 'opacity', 'display', 'visibility', 'filter', 'clip-path', 'clip-rule', 'mask']);

function parseFilterReference(value, element) {
  const input = String(value).trim();
  if (input === 'none') return null;
  const reference = /^url\(\s*(?:(['"])#([A-Za-z_][\w.-]*)\1|#([A-Za-z_][\w.-]*))\s*\)$/i.exec(input);
  if (reference) return reference[2] || reference[3];
  if (/^url\(/i.test(input)) fail('external-reference', 'SVG filter references must point to a local supported filter.', element);
  fail('unsupported-filter', 'SVG filter must be “none” or a local url(#filter-id) reference.', element);
}

function parseClipPathReference(value, element) {
  const input = String(value).trim();
  if (input === 'none') return null;
  const reference = /^url\(\s*(?:(['"])#([A-Za-z_][\w.-]*)\1|#([A-Za-z_][\w.-]*))\s*\)$/i.exec(input);
  if (reference) return reference[2] || reference[3];
  if (/^url\(/i.test(input)) fail('external-reference', 'SVG clip-path references must point to a local supported clip path.', element);
  fail('unsupported-clip-path', 'SVG clip-path must be “none” or a local url(#clip-id) reference.', element);
}

function parseMaskReference(value, element) {
  const input = String(value).trim();
  if (input === 'none') return null;
  const reference = /^url\(\s*(?:(['"])#([A-Za-z_][\w.-]*)\1|#([A-Za-z_][\w.-]*))\s*\)$/i.exec(input);
  if (reference) return reference[2] || reference[3];
  if (/^url\(/i.test(input)) fail('external-reference', 'SVG mask references must point to a local supported mask.', element);
  fail('unsupported-mask', 'SVG mask must be “none” or a local url(#mask-id) reference.', element);
}

function parseStyle(node, parentStyle, gradients = new Map()) {
  const values = { ...parentStyle, opacity: 1, display: parentStyle.display, visibility: parentStyle.visibility, filterRef: null, clipPathRef: null, maskRef: null };
  const declarations = Object.create(null);
  for (const [name, value] of Object.entries(node.attrs)) {
    if (inheritedProperties.has(name) || ['opacity', 'display', 'visibility', 'filter', 'clip-path', 'clip-rule', 'mask'].includes(name)) declarations[name] = value;
  }
  if (node.attrs.style != null) {
    for (const declaration of node.attrs.style.split(';')) {
      if (!declaration.trim()) continue;
      const colon = declaration.indexOf(':');
      if (colon <= 0) fail('invalid-style', `SVG style on <${node.tag}> is malformed.`, node.tag);
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim().replace(/\s*!important\s*$/i, '');
      if (!styleProperties.has(name)) fail('unsupported-style', `SVG style property “${name}” is unsupported.`, node.tag);
      if (Object.hasOwn(declarations, name) && node.attrs.style.split(';').filter(part => part.trim().toLowerCase().startsWith(`${name}:`)).length > 1) {
        fail('invalid-style', `SVG style repeats the ${name} property.`, node.tag);
      }
      declarations[name] = value;
    }
  }
  for (const [key, raw] of Object.entries(declarations)) {
    const value = raw.trim();
    if (value === 'inherit' && inheritedProperties.has(key)) continue;
    switch (key) {
      case 'fill': {
        const reference = /^url\(\s*#([A-Za-z_][\w.-]*)\s*\)$/i.exec(value);
        if (reference) {
          const gradient = gradients.get(reference[1]);
          if (!gradient) fail('missing-gradient', `SVG fill references missing gradient “${reference[1]}”.`, node.tag);
          values.fill = null; values.fillColorAlpha = 1; values.fillGradient = gradient;
        } else {
          if (/^url\(/i.test(value)) fail('external-reference', 'SVG paint references must point to a local supported gradient.', node.tag);
          const parsed = color(value, node.tag); values.fill = parsed.value; values.fillColorAlpha = parsed.alpha; values.fillGradient = null;
        }
        break;
      }
      case 'stroke': {
        const parsed = color(value, node.tag); values.stroke = parsed.value; values.strokeColorAlpha = parsed.alpha; break;
      }
      case 'fill-opacity': values.fillOpacityValue = parseAlpha(value, key, node.tag); break;
      case 'stroke-opacity': values.strokeOpacityValue = parseAlpha(value, key, node.tag); break;
      case 'stroke-width': values.strokeWidth = length(value, key, node.tag); break;
      case 'opacity': values.opacity = parseAlpha(value, key, node.tag); break;
      case 'font-family':
        if (!value.trim() || value.length > 160 || /[\x00-\x1f]/.test(value) || /url\s*\(/i.test(value)) {
          fail('invalid-text-font', 'SVG font-family must be a plain family name or family list no longer than 160 characters.', node.tag);
        }
        values.fontFamily = value; break;
      case 'font-size': {
        const size = length(value, key, node.tag);
        if (size <= 0 || size > 100_000) fail('invalid-text-font', 'SVG font-size must be greater than zero and at most 100000 px.', node.tag);
        values.fontSize = size; break;
      }
      case 'font-weight': {
        const weight = value === 'normal' ? 400 : value === 'bold' ? 700 : /^\d{1,4}$/.test(value) ? Number(value) : NaN;
        if (!Number.isInteger(weight) || weight < 1 || weight > 1000) fail('invalid-text-font', 'SVG font-weight must be normal, bold, or a number from 1 to 1000.', node.tag);
        values.fontWeight = weight; break;
      }
      case 'font-style':
        if (!['normal', 'italic', 'oblique'].includes(value)) fail('invalid-text-font', 'SVG font-style must be normal, italic, or oblique.', node.tag);
        values.fontStyle = value; break;
      case 'font-variation-settings': {
        const axes = parseFontVariationSettings(value);
        if (!axes || Object.keys(axes).length && !isValidFontVariationValues(axes)) {
          fail('invalid-text-font-variation', 'SVG font-variation-settings must contain unique four-character axis tags and finite values.', node.tag);
        }
        values.fontAxes = Object.keys(axes).length ? axes : undefined;
        break;
      }
      case 'font-feature-settings': {
        const features = parseFontFeatureSettings(value);
        if (!features || Object.keys(features).length && !isValidFontFeatureValues(features)) {
          fail('invalid-text-font-features', 'SVG font-feature-settings must contain unique four-character feature tags and bounded integer values.', node.tag);
        }
        values.fontFeatures = Object.keys(features).length ? features : undefined;
        break;
      }
      case 'text-anchor':
        if (!['start', 'middle', 'end'].includes(value)) fail('invalid-text-alignment', 'SVG text-anchor must be start, middle, or end.', node.tag);
        values.textAnchor = value; break;
      case 'dominant-baseline': {
        const baselines = new Set(['auto', 'text-before-edge', 'text-after-edge', 'central', 'middle', 'alphabetic', 'ideographic', 'hanging', 'mathematical', 'before-edge', 'after-edge']);
        if (!baselines.has(value)) fail('invalid-text-baseline', 'SVG dominant-baseline is not a recognized baseline value.', node.tag);
        values.dominantBaseline = value; break;
      }
      case 'baseline-shift': {
        const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px)?$/i.exec(value);
        const shift = match ? Number(match[1]) : NaN;
        if (!Number.isFinite(shift) || Math.abs(shift) > MAX_TEXT_RUN_BASELINE_SHIFT) {
          fail('unsupported-text-baseline-shift', `SVG baseline-shift must be a finite unitless or px length within ±${MAX_TEXT_RUN_BASELINE_SHIFT} px; keywords and percentages cannot be represented.`, node.tag);
        }
        values.baselineShift = shift; break;
      }
      case 'letter-spacing':
        values.letterSpacing = value === 'normal' ? 0 : coordinateLength(value, key, node.tag); break;
      case 'line-height': values.lineHeight = value; break;
      case 'text-decoration':
        if (!['none', 'underline', 'line-through', 'overline', 'blink'].includes(value)) fail('invalid-text-decoration', 'SVG text-decoration is not a recognized value.', node.tag);
        values.textDecoration = value; break;
      case 'text-transform':
        if (!['none', 'uppercase', 'lowercase', 'capitalize', 'full-width', 'full-size-kana'].includes(value)) fail('invalid-text-transform', 'SVG text-transform is not a recognized value.', node.tag);
        values.textCase = value; break;
      case 'stroke-linecap':
        if (!['butt', 'round', 'square'].includes(value)) fail('invalid-stroke', 'SVG stroke-linecap must be butt, round, or square.', node.tag);
        values.strokeCap = value; break;
      case 'stroke-linejoin':
        if (!['miter', 'round', 'bevel'].includes(value)) fail('invalid-stroke', 'SVG stroke-linejoin must be miter, round, or bevel.', node.tag);
        values.strokeJoin = value; break;
      case 'stroke-dasharray': {
        if (value === 'none') { values.strokePattern = 'solid'; values.strokeDashArray = null; break; }
        const dash = value.split(/[\s,]+/).filter(Boolean).map(part => length(part, 'stroke dash length', node.tag));
        const normalized = normalizeStrokeDashArray(dash);
        if (!normalized) fail('invalid-stroke', 'SVG stroke-dasharray must contain 1–16 finite, nonnegative lengths and at least one positive length.', node.tag);
        values.strokeDashArray = normalized;
        break;
      }
      case 'stroke-miterlimit': {
        values.strokeMiterLimit = finiteNumber(value, key, node.tag, { min: 1, max: 1000 });
        break;
      }
      case 'fill-rule':
        if (!['nonzero', 'evenodd'].includes(value)) fail('invalid-fill-rule', 'SVG fill-rule must be nonzero or evenodd.', node.tag);
        values.fillRule = value; break;
      case 'display':
        if (!['none', 'inline', 'block'].includes(value)) fail('unsupported-display', `SVG display value “${value}” is unsupported.`, node.tag);
        values.display = value !== 'none' && parentStyle.display; break;
      case 'filter': values.filterRef = parseFilterReference(value, node.tag); break;
      case 'clip-path': values.clipPathRef = parseClipPathReference(value, node.tag); break;
      case 'mask': values.maskRef = parseMaskReference(value, node.tag); break;
      case 'clip-rule':
        if (!['nonzero', 'evenodd'].includes(value)) fail('unsupported-clip-path', `SVG clip-rule “${value}” is unsupported.`, node.tag);
        values.clipRule = value;
        break;
      case 'visibility':
        if (!['visible', 'hidden', 'collapse'].includes(value)) fail('invalid-visibility', 'SVG visibility must be visible or hidden.', node.tag);
        values.visibility = value; break;
      case 'color': color(value, node.tag); break;
      default: fail('unsupported-style', `SVG style property “${key}” is unsupported.`, node.tag);
    }
  }
  if (!Object.hasOwn(declarations, 'fill')) { values.fill = parentStyle.fill; values.fillColorAlpha = parentStyle.fillColorAlpha; values.fillGradient = parentStyle.fillGradient; }
  if (!Object.hasOwn(declarations, 'stroke')) { values.stroke = parentStyle.stroke; values.strokeColorAlpha = parentStyle.strokeColorAlpha; }
  if (!Object.hasOwn(declarations, 'fill-opacity')) values.fillOpacityValue = parentStyle.fillOpacityValue;
  if (!Object.hasOwn(declarations, 'stroke-opacity')) values.strokeOpacityValue = parentStyle.strokeOpacityValue;
  if (!Object.hasOwn(declarations, 'stroke-width')) values.strokeWidth = parentStyle.strokeWidth;
  if (!Object.hasOwn(declarations, 'stroke-linecap')) values.strokeCap = parentStyle.strokeCap;
  if (!Object.hasOwn(declarations, 'stroke-linejoin')) values.strokeJoin = parentStyle.strokeJoin;
  if (!Object.hasOwn(declarations, 'stroke-miterlimit')) values.strokeMiterLimit = parentStyle.strokeMiterLimit;
  if (!Object.hasOwn(declarations, 'stroke-dasharray')) {
    values.strokeDashArray = parentStyle.strokeDashArray ?? null;
    values.strokePattern = parentStyle.strokePattern;
  }
  if (values.strokeDashArray) {
    const unit = values.strokeWidth;
    const close = (left, right) => Math.abs(left - right) <= Math.max(1, Math.abs(right)) * 1e-6;
    const dash = values.strokeDashArray;
    if (dash.length === 2 && close(dash[0], unit * 4) && close(dash[1], unit * 2)) {
      values.strokePattern = 'dashed';
    } else if (dash.length === 2 && close(dash[0], 0) && close(dash[1], unit * 2) && values.strokeCap === 'round') {
      values.strokePattern = 'dotted';
    } else values.strokePattern = 'custom';
  }
  for (const [property, styleKey] of [
    ['font-family', 'fontFamily'], ['font-size', 'fontSize'], ['font-weight', 'fontWeight'], ['font-style', 'fontStyle'], ['font-variation-settings', 'fontAxes'], ['font-feature-settings', 'fontFeatures'],
    ['text-anchor', 'textAnchor'], ['dominant-baseline', 'dominantBaseline'], ['baseline-shift', 'baselineShift'], ['letter-spacing', 'letterSpacing'],
    ['line-height', 'lineHeight'], ['text-decoration', 'textDecoration'], ['text-transform', 'textCase']
  ]) if (!Object.hasOwn(declarations, property)) values[styleKey] = parentStyle[styleKey];
  if (Object.hasOwn(node.attrs, 'xml:space')) {
    if (!['default', 'preserve'].includes(node.attrs['xml:space'])) fail('invalid-xml-space', 'SVG xml:space must be default or preserve.', node.tag);
    values.xmlSpace = node.attrs['xml:space'];
  } else values.xmlSpace = parentStyle.xmlSpace;
  if (!Object.hasOwn(declarations, 'fill-rule')) values.fillRule = parentStyle.fillRule;
  if (!Object.hasOwn(declarations, 'clip-rule')) values.clipRule = parentStyle.clipRule;
  if (typeof values.lineHeight === 'string') {
    const lineHeight = values.lineHeight.trim();
    if (lineHeight === 'normal') values.lineHeight = 1.25;
    else if (/^[+]?(?:\d+\.?\d*|\.\d+)(?:e[+]\d+)?$/i.test(lineHeight)) {
      values.lineHeight = finiteNumber(lineHeight, 'line-height', node.tag, { min: 0.1, max: 100 });
    } else {
      const pixels = length(lineHeight, 'line-height', node.tag);
      values.lineHeight = pixels / values.fontSize;
      if (values.lineHeight < 0.1 || values.lineHeight > 100) fail('invalid-text-line-height', 'SVG line-height must be between 0.1 and 100 times the font size.', node.tag);
    }
  }
  values.fillAlpha = values.fillColorAlpha * values.fillOpacityValue;
  values.strokeAlpha = values.strokeColorAlpha * values.strokeOpacityValue;
  if (values.stroke && values.strokeAlpha > 0 && values.strokeWidth > 0
    && values.strokePattern === 'dotted' && values.strokeCap !== 'round') {
    fail('unsupported-stroke-style', 'SVG dotted strokes require round line caps to remain visible in the editor.', node.tag);
  }
  values.visible = values.visibility === 'visible';
  return values;
}

const geomAttrs = {
  svg: new Set(['xmlns', 'version', 'width', 'height', 'viewBox', 'preserveAspectRatio']),
  g: new Set(), defs: new Set(['id']), clipPath: new Set(['id', 'clipPathUnits']),
  text: new Set(['x', 'y']), tspan: new Set(),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry']),
  circle: new Set(['cx', 'cy', 'r']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
  line: new Set(['x1', 'y1', 'x2', 'y2']),
  polyline: new Set(['points']), polygon: new Set(['points']), path: new Set(['d'])
};
const commonAttrs = new Set([
  'id', 'transform', 'style', 'fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'clip-path', 'mask', 'opacity', 'display', 'visibility', 'color', 'class',
  'href', 'xlink:href', 'xml:space', 'role', 'focusable', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variation-settings', 'font-feature-settings',
  'text-anchor', 'dominant-baseline', 'baseline-shift', 'letter-spacing', 'line-height', 'text-decoration', 'text-transform', 'filter'
]);

function checkElementAttributes(node) {
  const allowed = geomAttrs[node.tag];
  for (const key of Object.keys(node.attrs)) {
    if (node.tag === 'text' && ['dx', 'dy', 'rotate'].includes(key)
      || node.tag === 'tspan' && ['x', 'y', 'dx', 'dy', 'rotate'].includes(key)) {
      fail('unsupported-text-positioning', `SVG <${node.tag}> ${key} positioning cannot be preserved in the editable text layer.`, node.tag);
    }
    if (['text', 'tspan'].includes(node.tag) && ['textLength', 'lengthAdjust', 'writing-mode', 'glyph-orientation-horizontal', 'glyph-orientation-vertical'].includes(key)) {
      fail('unsupported-text-feature', `SVG <${node.tag}> attribute “${key}” is not supported by editable text layers.`, node.tag);
    }
    if (key === 'xmlns' && node.tag === 'svg' || key === 'version' && node.tag === 'svg' || key.startsWith('aria-') || key.startsWith('data-')) continue;
    if (/^on/i.test(key)) fail('active-content', `SVG event handler attribute “${key}” is not accepted.`, node.tag);
    if (key === 'href' || key === 'xlink:href') fail('external-reference', 'SVG href references are not accepted; embed local vector geometry instead.', node.tag);
    if (key === 'class') fail('unsupported-css', 'SVG class selectors and external stylesheets are not resolved. Use inline style properties.', node.tag);
    if (key.startsWith('xmlns:') && node.tag === 'svg') {
      if (node.attrs[key] !== SVG_NS && key === `xmlns:${node.qualifiedName?.split(':')[0]}`) fail('unsupported-namespace', 'The root SVG prefix must map to the standard SVG namespace.', node.tag);
      continue;
    }
    if (key === 'xml:space' || key === 'role' || key === 'focusable') continue;
    if (commonAttrs.has(key) || allowed?.has(key)) continue;
    fail('unsupported-attribute', `SVG attribute “${key}” is not supported on <${node.tag}>.`, node.tag);
  }
}

const clipPathGeometryTags = new Set(['rect', 'circle', 'ellipse', 'polygon', 'path']);

function parseClipPath(node, ids, gradients) {
  checkElementAttributes(node);
  const id = node.attrs.id;
  if (!id || !/^[A-Za-z_][\w.-]*$/.test(id) || ids.has(id)) {
    fail('invalid-clip-path', 'Every SVG clip path must have a unique, simple id.', node.tag);
  }
  const units = node.attrs.clipPathUnits ?? 'userSpaceOnUse';
  if (units !== 'userSpaceOnUse') {
    fail('unsupported-clip-path-units', 'Editable SVG clip paths currently require clipPathUnits="userSpaceOnUse".', node.tag);
  }
  let inherited = parseStyle(node, initialStyle, gradients);
  if (inherited.filterRef || inherited.clipPathRef) fail('unsupported-clip-path', 'Nested filters and clip paths inside clip-path definitions are unsupported.', node.tag);
  if (!inherited.display || !inherited.visible) {
    fail('unsupported-clip-path', 'Hidden SVG clip-path geometry cannot be represented as an editable mask.', node.tag);
  }
  let container = node;
  let nestedTransform = [1, 0, 0, 1, 0, 0];
  while (container.tag === 'clipPath' || container.tag === 'g') {
    if (container.children.length !== 1) {
      fail('unsupported-clip-path', 'An editable SVG clip path must contain one supported closed vector shape, optionally wrapped in single-child groups.', container.tag);
    }
    const child = container.children[0];
    if (unsafeSvgElements.has(child.tag)) {
      const code = ['script', 'foreignObject'].includes(child.tag) ? 'active-content' : ['image', 'use'].includes(child.tag) ? 'external-reference' : 'unsupported-element';
      fail(code, `SVG element <${child.tag}> is not accepted inside a clip path.`, child.tag);
    }
    if (child.tag !== 'g') break;
    checkElementAttributes(child);
    inherited = parseStyle(child, inherited, gradients);
    if (inherited.filterRef || inherited.clipPathRef) fail('unsupported-clip-path', 'Nested filters and clip paths inside clip-path definitions are unsupported.', child.tag);
    if (!inherited.display || !inherited.visible) {
      fail('unsupported-clip-path', 'Hidden SVG clip-path geometry cannot be represented as an editable mask.', child.tag);
    }
    nestedTransform = matrixMultiply(nestedTransform, parseTransform(child.attrs.transform, child.tag));
    container = child;
  }
  const shape = container.children[0];
  if (unsafeSvgElements.has(shape.tag)) {
    const code = ['script', 'foreignObject'].includes(shape.tag) ? 'active-content' : ['image', 'use'].includes(shape.tag) ? 'external-reference' : 'unsupported-element';
    fail(code, `SVG element <${shape.tag}> is not accepted inside a clip path.`, shape.tag);
  }
  if (!clipPathGeometryTags.has(shape.tag)) {
    fail('unsupported-clip-path', `SVG clip paths support rect, circle, ellipse, polygon, and path geometry; <${shape.tag}> is unsupported.`, shape.tag);
  }
  checkElementAttributes(shape);
  if (shape.children.length) fail('unsupported-clip-path', 'SVG clip-path shapes cannot contain nested elements.', shape.tag);
  const style = parseStyle(shape, inherited, gradients);
  if (style.filterRef || style.clipPathRef) {
    fail('unsupported-clip-path', 'Nested filters and clip paths inside clip-path definitions are unsupported.', shape.tag);
  }
  if (!style.display || !style.visible) {
    fail('unsupported-clip-path', 'Hidden SVG clip-path geometry cannot be represented as an editable mask.', shape.tag);
  }
  ids.add(id);
  return {
    id,
    transform: parseTransform(node.attrs.transform, node.tag),
    shape,
    shapeTransform: matrixMultiply(nestedTransform, parseTransform(shape.attrs.transform, shape.tag)),
    fillRule: style.clipRule ?? style.fillRule
  };
}

function arcCubics(start, rxInput, ryInput, rotation, largeArc, sweep, end, element) {
  let rx = Math.abs(rxInput); let ry = Math.abs(ryInput);
  if (!rx || !ry) return [{ end, control1: null, control2: null }];
  if (Math.abs(start.x - end.x) < 1e-12 && Math.abs(start.y - end.y) < 1e-12) return [];
  const phi = rotation * Math.PI / 180;
  const cos = Math.cos(phi); const sin = Math.sin(phi);
  const dx = (start.x - end.x) / 2; const dy = (start.y - end.y) / 2;
  const xp = cos * dx + sin * dy; const yp = -sin * dx + cos * dy;
  const scale = xp * xp / (rx * rx) + yp * yp / (ry * ry);
  if (scale > 1) { rx *= Math.sqrt(scale); ry *= Math.sqrt(scale); }
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp);
  const denominator = rx * rx * yp * yp + ry * ry * xp * xp;
  const sign = largeArc === sweep ? -1 : 1;
  const factor = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const cxp = factor * (rx * yp / ry);
  const cyp = factor * (-ry * xp / rx);
  const cx = cos * cxp - sin * cyp + (start.x + end.x) / 2;
  const cy = sin * cxp + cos * cyp + (start.y + end.y) / 2;
  const angleBetween = (u, v) => Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
  const u = { x: (xp - cxp) / rx, y: (yp - cyp) / ry };
  const v = { x: (-xp - cxp) / rx, y: (-yp - cyp) / ry };
  let startAngle = angleBetween({ x: 1, y: 0 }, u);
  let delta = angleBetween(u, v);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / segments;
  const toPoint = angle => ({
    x: cx + rx * cos * Math.cos(angle) - ry * sin * Math.sin(angle),
    y: cy + rx * sin * Math.cos(angle) + ry * cos * Math.sin(angle)
  });
  const derivative = angle => ({
    x: -rx * cos * Math.sin(angle) - ry * sin * Math.cos(angle),
    y: -rx * sin * Math.sin(angle) + ry * cos * Math.cos(angle)
  });
  const result = [];
  for (let index = 0; index < segments; index += 1) {
    const a0 = startAngle + step * index; const a1 = a0 + step;
    const amount = 4 / 3 * Math.tan((a1 - a0) / 4);
    const p0 = toPoint(a0); const p3 = index === segments - 1 ? end : toPoint(a1);
    const d0 = derivative(a0); const d1 = derivative(a1);
    result.push({ end: p3, control1: { x: p0.x + amount * d0.x, y: p0.y + amount * d0.y }, control2: { x: p3.x - amount * d1.x, y: p3.y - amount * d1.y } });
  }
  return result;
}

function preflightPath(d, element, budget) {
  const reader = new PathTokenReader(d, element);
  const parameters = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
  let command = null; let expected = 0; let consumed = 0; let tokens = 0; let points = 0;
  while (reader.peek() !== null) {
    const token = reader.next();
    if (/^[a-z]$/i.test(token)) {
      tokens += 1;
      if (tokens + budget.tokens > MAX_VECTOR_TOKENS) {
        fail('resource-limit', `SVG exceeds the cumulative vector import limit (${MAX_VECTOR_TOKENS} path tokens).`, element);
      }
      if (consumed) fail('invalid-path', `SVG path command ${command} is missing coordinates.`, element);
      command = token.toUpperCase();
      if (command === 'Z') { command = null; expected = 0; continue; }
      expected = parameters[command] || 0;
      if (!expected) fail('unsupported-path-command', `SVG path command ${token} is unsupported.`, element);
      continue;
    }
    if (!command) fail('invalid-path', 'SVG path data must begin with a path command.', element);
    const compactFlags = command === 'A' && consumed === 3 && /^[01]{2,}$/.test(token);
    if (compactFlags) {
      tokens += 2;
      if (token.length > 2) reader.cached = token.slice(2);
      consumed += 2;
      if (tokens + budget.tokens > MAX_VECTOR_TOKENS) {
        fail('resource-limit', `SVG exceeds the cumulative vector import limit (${MAX_VECTOR_TOKENS} path tokens).`, element);
      }
      continue;
    }
    tokens += 1;
    if (tokens + budget.tokens > MAX_VECTOR_TOKENS) {
      fail('resource-limit', `SVG exceeds the cumulative vector import limit (${MAX_VECTOR_TOKENS} path tokens).`, element);
    }
    consumed += 1;
    if (consumed === expected) {
      points += command === 'A' ? 4 : 1;
      if (points + budget.points > MAX_VECTOR_POINTS) {
        fail('resource-limit', `SVG exceeds the cumulative vector import limit (${MAX_VECTOR_POINTS} points).`, element);
      }
      consumed = 0;
      if (command === 'M') command = 'L';
    }
  }
  if (consumed) fail('invalid-path', `SVG path command ${command} is missing coordinates.`, element);
  if (!tokens) fail('invalid-path', 'SVG path data is missing or empty.', element);
  reserveVectorBudget(budget, points, tokens, element);
}

function parsePath(d, element, budget) {
  if (typeof d !== 'string' || d.length > 1_000_000) fail('invalid-path', 'SVG path data is missing or too large.', element);
  preflightPath(d, element, budget);
  const reader = new PathTokenReader(d, element);
  let command = null; let current = { x: 0, y: 0 }; let start = null;
  let previousCommand = null; let previousCubic = null; let previousQuadratic = null; let closed = false;
  let points = [];
  const contours = [];
  const isCommand = token => /^[a-zA-Z]$/.test(token || '');
  const hasNumber = () => reader.peek() !== null && !isCommand(reader.peek());
  const number = label => {
    if (!hasNumber()) fail('invalid-path', `SVG path command ${command} is missing ${label}.`, element);
    return finiteNumber(reader.next(), 'path coordinate', element);
  };
  const arcFlag = label => {
    if (!hasNumber()) fail('invalid-path', `SVG path command ${command} is missing ${label}.`, element);
    const token = reader.peek();
    if (!/^[01]+$/.test(token)) fail('invalid-path', `SVG arc ${label} must be zero or one.`, element);
    const flag = Number(token[0]);
    if (token.length === 1) reader.next();
    else reader.cached = token.slice(1);
    return flag;
  };
  const absolutePoint = (x, y, relative) => ({ x: relative ? current.x + x : x, y: relative ? current.y + y : y });
  const moveTo = point => {
    if (points.length) contours.push({ points, closed });
    points = [];
    current = point; start = { ...point }; points.push({ x: point.x, y: point.y }); closed = false;
  };
  const lineTo = point => {
    if (!start) fail('invalid-path', 'SVG path must begin with moveto.', element);
    points.push({ x: point.x, y: point.y }); current = point;
    previousCubic = null; previousQuadratic = null;
  };
  const cubicTo = (c1, c2, end) => {
    if (!start) fail('invalid-path', 'SVG path must begin with moveto.', element);
    const previous = points.at(-1);
    previous.out = { x: c1.x - previous.x, y: c1.y - previous.y };
    points.push({ x: end.x, y: end.y, in: { x: c2.x - end.x, y: c2.y - end.y } });
    current = end; previousCubic = c2; previousQuadratic = null;
  };
  const quadraticTo = (control, end) => {
    const c1 = { x: current.x + (control.x - current.x) * 2 / 3, y: current.y + (control.y - current.y) * 2 / 3 };
    const c2 = { x: end.x + (control.x - end.x) * 2 / 3, y: end.y + (control.y - end.y) * 2 / 3 };
    cubicTo(c1, c2, end); previousQuadratic = control;
  };
  while (reader.peek() !== null) {
    if (isCommand(reader.peek())) command = reader.next();
    else if (!command) fail('invalid-path', 'SVG path data must begin with a path command.', element);
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    if (!'MLHVCSQTAZ'.includes(upper)) fail('unsupported-path-command', `SVG path command ${command} is unsupported.`, element);
    if (upper === 'Z') {
      if (!start) fail('invalid-path', 'SVG closepath appears before moveto.', element);
      if (points.length < 2) fail('invalid-path', 'SVG path subpath needs at least two points.', element);
      if (Math.abs(current.x - start.x) > 1e-12 || Math.abs(current.y - start.y) > 1e-12) {
        // A cubic close segment stores its outgoing handle on the last point and incoming handle on the first.
        const last = points.at(-1);
        last.out = last.out || undefined;
        current = { ...start };
      }
      closed = true; command = null; previousCommand = 'Z'; previousCubic = null; previousQuadratic = null;
      continue;
    }
    if (!hasNumber()) fail('invalid-path', `SVG path command ${command} has no coordinates.`, element);
    let firstSet = true;
    while (hasNumber()) {
      const firstMovePair = firstSet;
      if (upper === 'M' || upper === 'L') {
        const point = absolutePoint(number('x'), number('y'), relative);
        if (upper === 'M' && firstSet) { moveTo(point); command = relative ? 'l' : 'L'; }
        else lineTo(point);
      } else if (upper === 'H') lineTo({ x: relative ? current.x + number('x') : number('x'), y: current.y });
      else if (upper === 'V') lineTo({ x: current.x, y: relative ? current.y + number('y') : number('y') });
      else if (upper === 'C') {
        const c1 = absolutePoint(number('x1'), number('y1'), relative);
        const c2 = absolutePoint(number('x2'), number('y2'), relative);
        const end = absolutePoint(number('x'), number('y'), relative);
        cubicTo(c1, c2, end);
      } else if (upper === 'S') {
        const c1 = previousCommand === 'C' || previousCommand === 'S'
          ? { x: 2 * current.x - (previousCubic?.x ?? current.x), y: 2 * current.y - (previousCubic?.y ?? current.y) } : { ...current };
        const c2 = absolutePoint(number('x2'), number('y2'), relative);
        const end = absolutePoint(number('x'), number('y'), relative);
        cubicTo(c1, c2, end);
      } else if (upper === 'Q') {
        const control = absolutePoint(number('cx'), number('cy'), relative);
        const end = absolutePoint(number('x'), number('y'), relative);
        quadraticTo(control, end);
      } else if (upper === 'T') {
        const control = previousCommand === 'Q' || previousCommand === 'T'
          ? { x: 2 * current.x - (previousQuadratic?.x ?? current.x), y: 2 * current.y - (previousQuadratic?.y ?? current.y) } : { ...current };
        const end = absolutePoint(number('x'), number('y'), relative);
        quadraticTo(control, end);
      } else if (upper === 'A') {
        const rx = number('rx'); const ry = number('ry'); const rotation = number('rotation');
        const large = arcFlag('large-arc flag'); const sweep = arcFlag('sweep flag');
        const end = absolutePoint(number('x'), number('y'), relative);
        const arcs = arcCubics(current, rx, ry, rotation, Boolean(large), Boolean(sweep), end, element);
        for (const arc of arcs) {
          if (arc.control1 && arc.control2) cubicTo(arc.control1, arc.control2, arc.end);
          else lineTo(arc.end);
        }
        if (!arcs.length) current = end;
      }
      firstSet = false;
      previousCommand = upper === 'M' && !firstMovePair ? 'L' : upper;
    }
  }
  if (points.length) contours.push({ points, closed });
  if (!contours.length || contours.some(contour => contour.points.length < 2)) fail('invalid-path', 'Every SVG path subpath needs at least two points.', element);
  return [{ points: contours[0].points, closed: contours[0].closed, ...(contours.length > 1 ? { subpaths: contours.slice(1) } : {}) }];
}

function ellipsePath(cx, cy, rx, ry) {
  const k = 0.5522847498307936;
  const points = [
    { x: cx + rx, y: cy, out: { x: 0, y: k * ry } },
    { x: cx, y: cy + ry, in: { x: k * rx, y: 0 }, out: { x: -k * rx, y: 0 } },
    { x: cx - rx, y: cy, in: { x: 0, y: k * ry }, out: { x: 0, y: -k * ry } },
    { x: cx, y: cy - ry, in: { x: -k * rx, y: 0 }, out: { x: k * rx, y: 0 } }
  ];
  points[0].in = { x: 0, y: -k * ry };
  return [{ points, closed: true }];
}

function rectPath(x, y, width, height, rx, ry, element) {
  if (width < 0 || height < 0) fail('invalid-geometry', 'SVG rectangle width and height must not be negative.', element);
  rx = rx ?? ry ?? 0; ry = ry ?? rx;
  if (rx < 0 || ry < 0) fail('invalid-geometry', 'SVG rectangle corner radii must not be negative.', element);
  rx = Math.min(rx, width / 2); ry = Math.min(ry, height / 2);
  if (!rx || !ry) return [{ points: [
    { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }
  ], closed: true }];
  const k = 0.5522847498307936;
  return [{ closed: true, points: [
    { x: x + rx, y, in: { x: -k * rx, y: 0 } },
    { x: x + width - rx, y, out: { x: k * rx, y: 0 } },
    { x: x + width, y: y + ry, in: { x: 0, y: -k * ry } },
    { x: x + width, y: y + height - ry, out: { x: 0, y: k * ry } },
    { x: x + width - rx, y: y + height, in: { x: k * rx, y: 0 }, out: { x: -k * rx, y: 0 } },
    { x: x + rx, y: y + height, in: { x: k * rx, y: 0 }, out: { x: -k * rx, y: 0 } },
    { x, y: y + height - ry, in: { x: 0, y: k * ry }, out: { x: 0, y: -k * ry } },
    { x, y: y + ry, in: { x: 0, y: k * ry }, out: { x: 0, y: -k * ry } }
  ] }];
}

function preflightPointList(value, tag, budget) {
  const reader = new PathTokenReader(value || '', tag);
  let tokens = 0;
  while (reader.peek() !== null) {
    const token = reader.next();
    if (/^[a-z]$/i.test(token)) fail('invalid-points', `<${tag}> points must be numeric x/y pairs.`, tag);
    tokens += 1;
    if (tokens + budget.tokens > MAX_VECTOR_TOKENS) {
      fail('resource-limit', `SVG exceeds the cumulative vector import limit (${MAX_VECTOR_TOKENS} path tokens).`, tag);
    }
  }
  if (tokens < 4 || tokens % 2) fail('invalid-points', `<${tag}> points must contain at least two x/y pairs.`, tag);
  const points = tokens / 2;
  reserveVectorBudget(budget, points, tokens, tag);
}

function parsePoints(value, tag) {
  const reader = new PathTokenReader(value || '', tag);
  const points = [];
  while (reader.peek() !== null) {
    const x = finiteNumber(reader.next(), 'point x', tag);
    const y = finiteNumber(reader.next(), 'point y', tag);
    points.push({ x, y });
  }
  return points;
}

function elementPaths(node, budget) {
  const a = node.attrs;
  const n = (name, fallback = 0) => ['x', 'y', 'cx', 'cy', 'x1', 'x2', 'y1', 'y2'].includes(name)
    ? coordinateLength(a[name], name, node.tag, fallback) : length(a[name], name, node.tag, fallback);
  if (node.tag === 'rect') {
    const width = n('width'); const height = n('height');
    const rx = a.rx == null ? null : n('rx'); const ry = a.ry == null ? null : n('ry');
    const normalizedRx = Math.min(rx ?? ry ?? 0, width / 2);
    const normalizedRy = Math.min(ry ?? rx ?? 0, height / 2);
    const points = normalizedRx && normalizedRy ? 8 : 4;
    reserveVectorBudget(budget, points, points * 3, node.tag);
    return rectPath(n('x'), n('y'), width, height, rx, ry, node.tag);
  }
  if (node.tag === 'circle') {
    const radius = n('r');
    if (radius < 0) fail('invalid-geometry', 'SVG circle radius must not be negative.', node.tag);
    reserveVectorBudget(budget, 4, 12, node.tag);
    return ellipsePath(n('cx'), n('cy'), radius, radius);
  }
  if (node.tag === 'ellipse') {
    const rx = n('rx'); const ry = n('ry');
    if (rx < 0 || ry < 0) fail('invalid-geometry', 'SVG ellipse radii must not be negative.', node.tag);
    reserveVectorBudget(budget, 4, 12, node.tag);
    return ellipsePath(n('cx'), n('cy'), rx, ry);
  }
  if (node.tag === 'line') {
    reserveVectorBudget(budget, 2, 6, node.tag);
    return [{ points: [{ x: n('x1'), y: n('y1') }, { x: n('x2'), y: n('y2') }], closed: false, noFill: true }];
  }
  if (node.tag === 'polyline' || node.tag === 'polygon') {
    preflightPointList(a.points, node.tag, budget);
    return [{ points: parsePoints(a.points, node.tag), closed: node.tag === 'polygon' }];
  }
  if (node.tag === 'path') return parsePath(a.d, node.tag, budget);
  fail('unsupported-element', `SVG element <${node.tag}> is not supported.`, node.tag);
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cleanLayerName(value) {
  const name = String(value || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 120);
  return name || 'Imported vector';
}

function gradientBounds(subpath) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const include = point => {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  };
  const contours = Array.isArray(subpath) ? subpath : [subpath];
  for (const contour of contours) for (const point of contour.points) include(point);
  const cubicAt = (p0, p1, p2, p3, t) => {
    const inverse = 1 - t;
    return inverse ** 3 * p0 + 3 * inverse ** 2 * t * p1 + 3 * inverse * t ** 2 * p2 + t ** 3 * p3;
  };
  const roots = (p0, p1, p2, p3) => {
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
  };
  for (const contour of contours) {
    const points = contour.points;
    const segmentCount = contour.closed ? points.length : Math.max(0, points.length - 1);
    for (let index = 0; index < segmentCount; index += 1) {
    const from = points[index]; const to = points[(index + 1) % points.length];
    const control1 = from.out ? { x: from.x + from.out.x, y: from.y + from.out.y } : from;
    const control2 = to.in ? { x: to.x + to.in.x, y: to.y + to.in.y } : to;
    for (const axis of ['x', 'y']) {
      const p0 = from[axis]; const p1 = control1[axis]; const p2 = control2[axis]; const p3 = to[axis];
      for (const t of roots(p0, p1, p2, p3)) {
        if (t > 0 && t < 1) include({ x: axis === 'x' ? cubicAt(p0, p1, p2, p3, t) : from.x, y: axis === 'y' ? cubicAt(p0, p1, p2, p3, t) : from.y });
      }
    }
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function applyGradientPoint(total, point, outputX, outputY) {
  const mapped = mapPoint(total, point);
  if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y) || Math.abs(mapped.x) > MAX_COORDINATE || Math.abs(mapped.y) > MAX_COORDINATE) {
    fail('coordinate-out-of-range', 'Transformed SVG gradient exceeds the supported coordinate range.', 'gradient');
  }
  return { x: mapped.x - outputX, y: mapped.y - outputY };
}

function resolveGradient(gradient, sourceBounds, matrix, outputBounds) {
  const box = gradient.units === 'objectBoundingBox'
    ? [sourceBounds.width, 0, 0, sourceBounds.height, sourceBounds.x, sourceBounds.y]
    : [1, 0, 0, 1, 0, 0];
  const total = matrixMultiply(matrix, matrixMultiply(box, gradient.transform));
  let angle = 0;
  const stops = gradient.stops;
  const localPoint = point => applyGradientPoint(total, point, outputBounds.x, outputBounds.y);
  let sourceHandles;
  if (gradient.type === 'linear') {
    const sourceDx = gradient.x2 - gradient.x1;
    const sourceDy = gradient.y2 - gradient.y1;
    if (Math.hypot(sourceDx, sourceDy) < 1e-12) fail('invalid-gradient', 'SVG linear gradients need distinct endpoints.', 'linearGradient');
    // A third point retains the complete affine gradient coordinate frame.
    // SVG only exposes its x-axis endpoints, but gradientTransform may skew
    // the orthogonal color bands; the mapped perpendicular basis captures it.
    sourceHandles = [
      { x: gradient.x1, y: gradient.y1 },
      { x: gradient.x2, y: gradient.y2 },
      { x: gradient.x1 - sourceDy, y: gradient.y1 + sourceDx }
    ];
    const localHandles = sourceHandles.map(localPoint);
    const [start, end] = localHandles;
    const localDx = end.x - start.x; const localDy = end.y - start.y;
    angle = (Math.atan2(localDy, localDx) * 180 / Math.PI + 360) % 360;
    sourceHandles = localHandles;
  } else {
    sourceHandles = [
      { x: gradient.cx, y: gradient.cy },
      { x: gradient.cx + gradient.r, y: gradient.cy },
      { x: gradient.cx, y: gradient.cy + gradient.r }
    ];
    sourceHandles = sourceHandles.map(localPoint);
  }
  const handles = sourceHandles.map(local => {
    const normalized = { x: local.x / outputBounds.width, y: local.y / outputBounds.height };
    if (![normalized.x, normalized.y].every(Number.isFinite)
      || Math.abs(normalized.x) > MAX_GRADIENT_HANDLE_COORDINATE
      || Math.abs(normalized.y) > MAX_GRADIENT_HANDLE_COORDINATE) {
      fail('coordinate-out-of-range', 'Transformed SVG gradient geometry exceeds the supported coordinate range.', 'gradient');
    }
    return normalized;
  });
  if (!isValidGradientBasis(handles)) {
    const message = gradient.type === 'linear'
      ? 'SVG linear gradient transforms must preserve a two-dimensional gradient coordinate frame.'
      : 'SVG radial gradient transforms must preserve a two-dimensional radius.';
    fail('unsupported-gradient', message, gradient.type === 'linear' ? 'linearGradient' : 'radialGradient');
  }
  return { type: gradient.type, angle, stops, alpha: gradient.alpha, geometry: { handles } };
}

function makePathNode(subpath, style, matrix, prefix, name) {
  const scale = matrixScale(matrix);
  if (style.stroke && style.strokeAlpha > 0 && style.strokeWidth > 0 && scale == null) {
    fail('non-uniform-stroke-transform', `SVG <${name}> uses a non-uniform or skewed transform with a visible stroke.`, 'path');
  }
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const include = point => {
    if (![point.x, point.y].every(Number.isFinite) || Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) {
      fail('coordinate-out-of-range', 'Transformed SVG geometry exceeds the supported coordinate range.', 'path');
    }
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  };
  const contours = [{ points: subpath.points, closed: subpath.closed }, ...(subpath.subpaths || [])];
  for (const contour of contours) for (const point of contour.points) {
    include(mapPoint(matrix, point));
    if (point.in) include(mapPoint(matrix, { x: point.x + point.in.x, y: point.y + point.in.y }));
    if (point.out) include(mapPoint(matrix, { x: point.x + point.out.x, y: point.y + point.out.y }));
  }
  const actualWidth = maxX - minX; const actualHeight = maxY - minY;
  const width = actualWidth || 1; const height = actualHeight || 1;
  const sourceBounds = gradientBounds(contours);
  const resolvedGradient = style.fillGradient && !subpath.noFill
    ? resolveGradient(style.fillGradient, sourceBounds, matrix, { x: minX, y: minY, width, height }) : null;
  for (const contour of contours) for (const point of contour.points) {
    const original = { x: point.x, y: point.y };
    const anchor = mapPoint(matrix, original);
    if (point.in) {
      const handle = mapPoint(matrix, { x: original.x + point.in.x, y: original.y + point.in.y });
      point.in = { x: actualWidth ? (handle.x - anchor.x) / width : 0, y: actualHeight ? (handle.y - anchor.y) / height : 0 };
    }
    if (point.out) {
      const handle = mapPoint(matrix, { x: original.x + point.out.x, y: original.y + point.out.y });
      point.out = { x: actualWidth ? (handle.x - anchor.x) / width : 0, y: actualHeight ? (handle.y - anchor.y) / height : 0 };
    }
    point.x = (anchor.x - minX) / width;
    point.y = (anchor.y - minY) / height;
  }
  const base = createNode('path', {
    id: `${prefix}-${name}-geometry`, name: cleanLayerName(name), x: minX, y: minY, width, height,
    rotation: 0, fill: 'transparent', stroke: null, strokeWidth: 0, fillOpacity: 1,
    closed: subpath.closed, points: subpath.points,
    ...(contours.length > 1 ? { subpaths: contours.slice(1) } : {}),
    fillRule: style.fillRule || 'nonzero', children: []
  });
  return { base, strokeWidth: style.strokeWidth * (scale ?? 1), fillGradient: resolvedGradient };
}

function createPaintLayers(base, style, strokeWidth, prefix, serial, name, { fillAllowed = true } = {}) {
  const gradientVisible = Boolean(style.fillGradient && style.fillAlpha * style.fillGradient.alpha > 0);
  const fillVisible = fillAllowed && ((style.fill && style.fillAlpha > 0) || gradientVisible);
  const strokeVisible = style.stroke && strokeWidth > 0 && style.strokeAlpha > 0;
  const setFill = node => {
    node.fill = style.fill || 'transparent';
    node.fillOpacity = style.fillGradient ? style.fillAlpha * style.fillGradient.alpha : style.fillAlpha;
    node.fillRule = style.fillRule || 'nonzero';
    if (style.fillGradient) {
      node.fillGradient = {
        type: style.fillGradient.type,
        angle: style.fillGradient.angle,
        stops: style.fillGradient.stops.map((stop, index) => ({
          id: `${prefix}-${serial}-gradient-stop-${index}`, color: stop.color, position: stop.position
        })),
        ...(style.fillGradient.geometry ? { geometry: structuredClone(style.fillGradient.geometry) } : {})
      };
    }
  };
  if (!fillVisible && !strokeVisible) return [];
  if (fillVisible && strokeVisible) {
    const group = createNode('group', {
      id: `${prefix}-${serial}-paint`, name: cleanLayerName(name), x: base.x, y: base.y, width: base.width, height: base.height,
      opacity: style.opacity, fill: 'transparent', children: [], clip: false
    });
    const strokeNode = structuredClone(base);
    const fillNode = base;
    fillNode.id = `${prefix}-${serial}-fill`;
    fillNode.name = `${cleanLayerName(name)} fill`;
    fillNode.x = 0;
    fillNode.y = 0;
    fillNode.opacity = 1;
    setFill(fillNode);
    fillNode.closed = true;
    if (Array.isArray(fillNode.subpaths)) fillNode.subpaths = fillNode.subpaths.map(contour => ({ ...contour, closed: true }));
    strokeNode.id = `${prefix}-${serial}-stroke`;
    strokeNode.name = `${cleanLayerName(name)} stroke`;
    strokeNode.x = 0;
    strokeNode.y = 0;
    strokeNode.opacity = style.strokeAlpha;
    strokeNode.fill = 'transparent';
    strokeNode.fillOpacity = 0;
    strokeNode.stroke = style.stroke;
    strokeNode.strokeWidth = strokeWidth;
    strokeNode.strokeCap = style.strokeCap;
    strokeNode.strokeJoin = style.strokeJoin;
    strokeNode.strokePattern = style.strokePattern;
    if (style.strokePattern === 'custom' && style.strokeDashArray) {
      strokeNode.strokeDashArray = style.strokeDashArray.map(value => value * (style.strokeWidth > 0 ? strokeWidth / style.strokeWidth : 1));
    }
    strokeNode.strokeMiterLimit = style.strokeMiterLimit;
    group.children = [fillNode, strokeNode];
    return [group];
  }
  const node = { ...base, id: `${prefix}-${serial}`, opacity: style.opacity, fill: 'transparent', stroke: null, strokeWidth: 0 };
  if (fillVisible) {
    setFill(node); node.closed = true;
    if (Array.isArray(node.subpaths)) node.subpaths = node.subpaths.map(contour => ({ ...contour, closed: true }));
  }
  if (strokeVisible) {
    node.stroke = style.stroke; node.strokeWidth = strokeWidth; node.opacity *= style.strokeAlpha;
    node.strokeCap = style.strokeCap; node.strokeJoin = style.strokeJoin; node.strokePattern = style.strokePattern;
    if (style.strokePattern === 'custom' && style.strokeDashArray) {
      node.strokeDashArray = style.strokeDashArray.map(value => value * (style.strokeWidth > 0 ? strokeWidth / style.strokeWidth : 1));
    }
    node.strokeMiterLimit = style.strokeMiterLimit;
  }
  return [node];
}

function boundsOf(nodes) {
  const visible = nodes.filter(node => node.width >= 0 && node.height >= 0).map(node => {
    const radians = (Number(node.rotation) || 0) * Math.PI / 180;
    const width = Math.abs(node.width * Math.cos(radians)) + Math.abs(node.height * Math.sin(radians));
    const height = Math.abs(node.height * Math.cos(radians)) + Math.abs(node.width * Math.sin(radians));
    return { x: node.x + (node.width - width) / 2, y: node.y + (node.height - height) / 2, width, height };
  });
  if (!visible.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...visible.map(node => node.x)); const top = Math.min(...visible.map(node => node.y));
  const right = Math.max(...visible.map(node => node.x + node.width)); const bottom = Math.max(...visible.map(node => node.y + node.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function effectPadding(effects) {
  let x = 0; let y = 0;
  for (const effect of effects || []) {
    if (effect.type === 'layer-blur') {
      x += effect.radius * 3;
      y += effect.radius * 3;
    } else if (effect.type === 'drop-shadow') {
      x += Math.abs(effect.offsetX) + effect.blur * 3;
      y += Math.abs(effect.offsetY) + effect.blur * 3;
    }
  }
  return { x, y };
}

function unionBounds(bounds) {
  const valid = bounds.filter(Boolean);
  if (!valid.length) return null;
  const left = Math.min(...valid.map(item => item.x));
  const top = Math.min(...valid.map(item => item.y));
  const right = Math.max(...valid.map(item => item.x + item.width));
  const bottom = Math.max(...valid.map(item => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function visualBoundsOf(nodes, parentX = 0, parentY = 0) {
  const bounds = [];
  for (const node of nodes || []) {
    const x = parentX + node.x;
    const y = parentY + node.y;
    const radians = (Number(node.rotation) || 0) * Math.PI / 180;
    const width = Math.abs(node.width * Math.cos(radians)) + Math.abs(node.height * Math.sin(radians));
    const height = Math.abs(node.height * Math.cos(radians)) + Math.abs(node.width * Math.sin(radians));
    const padding = effectPadding(node.effects);
    const strokeBleed = node.stroke && Number(node.strokeWidth) > 0 ? Number(node.strokeWidth) / 2 : 0;
    bounds.push({ x: x + (node.width - width) / 2 - padding.x - strokeBleed, y: y + (node.height - height) / 2 - padding.y - strokeBleed,
      width: width + (padding.x + strokeBleed) * 2, height: height + (padding.y + strokeBleed) * 2 });
    if (node.children?.length) bounds.push(visualBoundsOf(node.children, x, y));
  }
  return unionBounds(bounds);
}

function mappedFilterRegion(region, matrix, sourceBounds, element) {
  if (!sourceBounds || !(sourceBounds.width > 0) || !(sourceBounds.height > 0)) return null;
  const values = [region.x, region.y, region.width, region.height];
  if (values.some(value => value.relative)) {
    if (!values.every(value => value.relative)) {
      fail('unsupported-filter-region', 'SVG filter regions cannot mix relative and user-space coordinates.', element);
    }
    const [x, y, width, height] = values.map(value => value.value);
    const left = -x;
    const top = -y;
    const right = x + width - 1;
    const bottom = y + height - 1;
    const tolerance = 1e-8;
    if (left < 0 || top < 0 || right < 0 || bottom < 0
      || Math.abs(left - right) > tolerance || Math.abs(top - bottom) > tolerance
      || Math.abs(left - top) > tolerance) {
      fail('unsupported-filter-region', 'Only symmetric filter regions that expand equally in both axes can be represented faithfully.', element);
    }
    const margin = left;
    return { x: sourceBounds.x - sourceBounds.width * margin, y: sourceBounds.y - sourceBounds.height * margin,
      width: sourceBounds.width * (1 + 2 * margin), height: sourceBounds.height * (1 + 2 * margin) };
  }
  const [x, y, width, height] = values.map(value => value.value);
  const corners = [
    mapPoint(matrix, { x, y }), mapPoint(matrix, { x: x + width, y }),
    mapPoint(matrix, { x: x + width, y: y + height }), mapPoint(matrix, { x, y: y + height })
  ];
  const left = Math.min(...corners.map(point => point.x));
  const top = Math.min(...corners.map(point => point.y));
  const right = Math.max(...corners.map(point => point.x));
  const bottom = Math.max(...corners.map(point => point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function mapFilterEffects(filter, matrix, sourceNodes, prefix, serial, element) {
  if (!filter?.effects.length) return [];
  if (filter.effects.length > 8) fail('unsupported-filter-graph', 'SVG filter has more than 8 effects and cannot be represented by this editor.', element);
  const scale = matrixScale(matrix);
  const effects = filter.effects.map((effect, index) => {
    const blur = effect.type === 'layer-blur' ? effect.radius : effect.blur;
    if (blur > 0 && scale == null) {
      fail('unsupported-filter-transform', 'SVG blur under a non-uniform or skewed transform cannot be represented as an editable isotropic blur.', element);
    }
    const mappedBlur = blur * (scale ?? 1);
    const mapped = effect.type === 'layer-blur'
      ? { type: effect.type, radius: mappedBlur }
      : {
        type: effect.type,
        color: effect.color,
        opacity: effect.opacity,
        offsetX: matrix[0] * effect.offsetX + matrix[2] * effect.offsetY,
        offsetY: matrix[1] * effect.offsetX + matrix[3] * effect.offsetY,
        blur: mappedBlur
      };
    if (mapped.type === 'layer-blur'
      ? !Number.isFinite(mapped.radius) || mapped.radius < 0 || mapped.radius > 100
      : !Number.isFinite(mapped.blur) || mapped.blur < 0 || mapped.blur > 100
        || !Number.isFinite(mapped.offsetX) || Math.abs(mapped.offsetX) > 1000
        || !Number.isFinite(mapped.offsetY) || Math.abs(mapped.offsetY) > 1000) {
      fail('unsupported-filter-range', 'Transformed SVG filter values exceed the editor’s editable effect limits.', element);
    }
    return { id: `${prefix}-effect-${serial}-${index}`, visible: true, ...mapped };
  });
  const contentBounds = visualBoundsOf(sourceNodes);
  if (contentBounds) {
    const region = mappedFilterRegion(filter.region, matrix, contentBounds, element);
    const padding = effectPadding(effects);
    const required = { x: contentBounds.x - padding.x, y: contentBounds.y - padding.y,
      width: contentBounds.width + padding.x * 2, height: contentBounds.height + padding.y * 2 };
    const epsilon = Math.max(1, required.width, required.height) * 1e-7;
    if (!region || region.x > required.x + epsilon || region.y > required.y + epsilon
      || region.x + region.width < required.x + required.width - epsilon
      || region.y + region.height < required.y + required.height - epsilon) {
      fail('filter-region-clips-output', 'SVG filter region clips pixels produced by its blur or shadow; enlarge the filter region before importing.', element);
    }
  }
  return effects;
}

function attachFilterEffects(nodes, effects, prefix, serial, name) {
  if (!effects.length || !nodes.length) return nodes;
  if (nodes.length === 1) {
    nodes[0].effects = effects;
    return nodes;
  }
  const bounds = boundsOf(nodes);
  for (const child of nodes) translateLayer(child, bounds.x, bounds.y);
  return [createNode('group', {
    id: `${prefix}-filtered-${serial}`, name: cleanLayerName(name), x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height, opacity: 1, fill: 'transparent', effects, children: nodes
  })];
}

function attachClipPath(nodes, clipRef, clips, matrix, prefix, serial, name, budget) {
  if (!clipRef) return nodes;
  const clipPath = clips.get(clipRef);
  if (!clipPath) fail('missing-clip-path', `SVG layer references missing clip path “${clipRef}”.`, 'clipPath');
  if (!nodes.length) return nodes;
  const clipMatrix = matrixMultiply(matrix, matrixMultiply(clipPath.transform, clipPath.shapeTransform));
  const [geometry] = elementPaths(clipPath.shape, budget);
  if (!geometry || geometry.noFill) fail('unsupported-clip-path', 'SVG clip paths require fillable vector geometry.', clipPath.shape.tag);
  const maskSource = makePathNode(geometry, {
    ...initialStyle,
    fill: '#ffffff', fillAlpha: 1, fillGradient: null, fillRule: clipPath.fillRule,
    stroke: null, strokeAlpha: 0, strokeWidth: 0, opacity: 1
  }, clipMatrix, prefix, `clip-${serial}`).base;
  maskSource.id = `${prefix}-clip-source-${serial}`;
  maskSource.name = cleanLayerName(`${clipPath.shape.attrs.id || clipPath.shape.tag} clip source`);
  maskSource.fill = '#ffffff';
  maskSource.fillOpacity = 1;
  maskSource.fillRule = clipPath.fillRule;
  maskSource.opacity = 1;
  maskSource.stroke = null;
  maskSource.strokeWidth = 0;
  maskSource.closed = true;
  if (Array.isArray(maskSource.subpaths)) maskSource.subpaths = maskSource.subpaths.map(contour => ({ ...contour, closed: true }));
  const children = [...nodes, maskSource];
  const bounds = boundsOf(children);
  for (const child of children) translateLayer(child, bounds.x, bounds.y);
  return [createNode('group', {
    id: `${prefix}-clip-wrapper-${serial}`, name: cleanLayerName(name),
    x: bounds.x, y: bounds.y, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height),
    opacity: 1, fill: 'transparent', mask: true, maskSourceId: maskSource.id, children
  })];
}

function transformedRectBounds(matrix, x, y, width, height) {
  const corners = [
    mapPoint(matrix, { x, y }), mapPoint(matrix, { x: x + width, y }),
    mapPoint(matrix, { x: x + width, y: y + height }), mapPoint(matrix, { x, y: y + height })
  ];
  const minX = Math.min(...corners.map(point => point.x));
  const minY = Math.min(...corners.map(point => point.y));
  const maxX = Math.max(...corners.map(point => point.x));
  const maxY = Math.max(...corners.map(point => point.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function assertBoundsContained(inner, outer, element) {
  const epsilon = Math.max(1, outer.width, outer.height) * 1e-7;
  if (inner.x < outer.x - epsilon || inner.y < outer.y - epsilon
    || inner.x + inner.width > outer.x + outer.width + epsilon
    || inner.y + inner.height > outer.y + outer.height + epsilon) {
    fail('unsupported-mask-region', 'SVG mask region clips part of its vector source; enlarge the region before importing.', element);
  }
}

function maskSourcePath(mask, matrix, prefix, serial, budget, name = 'Mask source') {
  if (!mask.children || mask.children.length !== 1 || mask.children[0].tag !== 'g') {
    fail('unsupported-mask-graph', 'Editable SVG masks require one transformed <g> containing one closed vector shape.', 'mask');
  }
  const sourceGroup = mask.children[0];
  checkElementAttributes(sourceGroup);
  if (sourceGroup.children.length !== 1) {
    fail('unsupported-mask-graph', 'Editable SVG masks require one transformed <g> containing one closed vector shape.', 'mask');
  }
  const groupStyle = parseStyle(sourceGroup, initialStyle);
  if (groupStyle.filterRef || groupStyle.clipPathRef || groupStyle.maskRef || !groupStyle.visible || !groupStyle.display) {
    fail('unsupported-mask-graph', 'Nested filters, masks, clipping and hidden mask sources are unsupported.', sourceGroup.tag);
  }
  const shape = sourceGroup.children[0];
  if (!clipPathGeometryTags.has(shape.tag) || shape.children.length) {
    fail('unsupported-mask-graph', 'Editable SVG masks support one rect, circle, ellipse, polygon, or path source.', shape.tag);
  }
  checkElementAttributes(shape);
  const style = parseStyle(shape, groupStyle);
  if (style.filterRef || style.clipPathRef || style.maskRef || !style.visible || !style.display) {
    fail('unsupported-mask-graph', 'Nested filters, masks, clipping and hidden mask sources are unsupported.', shape.tag);
  }
  const vectorMask = mask.localMaskMode === 'vector';
  if ((style.fill !== '#ffffff' || style.fillColorAlpha !== 1) && !(vectorMask && style.fill == null)
    || style.fillGradient || (vectorMask
      ? (style.stroke != null && (style.stroke !== '#ffffff' || style.strokeAlpha !== 1))
      : style.stroke != null)) {
    fail('unsupported-mask-paint', 'Editable SVG masks must use opaque white vector geometry without gradients.', shape.tag);
  }
  const paths = elementPaths(shape, budget);
  if (paths.length !== 1 || (paths[0].noFill && (!vectorMask || !style.stroke || !(style.strokeWidth > 0)))) {
    fail('unsupported-mask-graph', 'Editable SVG masks require one closed fillable source, or a stroked path for a local vector mask.', shape.tag);
  }
  const sourceMatrix = matrixMultiply(matrix, matrixMultiply(
    parseTransform(sourceGroup.attrs.transform, sourceGroup.tag), parseTransform(shape.attrs.transform, shape.tag)
  ));
  const { base, strokeWidth } = makePathNode(paths[0], style, sourceMatrix, prefix, name);
  base.name = cleanLayerName(name);
  base.fill = style.fill || 'transparent';
  base.fillOpacity = vectorMask ? 1 : style.fillAlpha;
  base.fillRule = style.fillRule;
  base.opacity = groupStyle.opacity * style.opacity;
  if (vectorMask && style.stroke && strokeWidth > 0) {
    // Keep fill and stroke on the same editable path. The ordinary SVG paint
    // importer splits those into sibling layers, but a mask source must remain
    // one geometry node so the renderer can union its vector coverage once.
    base.stroke = style.stroke;
    base.strokeWidth = strokeWidth;
    base.strokeCap = style.strokeCap;
    base.strokeJoin = style.strokeJoin;
    base.strokePattern = style.strokePattern;
    if (style.strokePattern === 'custom' && style.strokeDashArray) {
      base.strokeDashArray = style.strokeDashArray.map(value => value * (style.strokeWidth > 0 ? strokeWidth / style.strokeWidth : 1));
    }
    base.strokeMiterLimit = style.strokeMiterLimit;
  }
  if (!vectorMask) {
    base.stroke = null;
    base.strokeWidth = 0;
    base.closed = true;
    if (Array.isArray(base.subpaths)) base.subpaths = base.subpaths.map(contour => ({ ...contour, closed: true }));
  }
  const regionBounds = transformedRectBounds(matrix, mask.region.x, mask.region.y, mask.region.width, mask.region.height);
  assertBoundsContained(boundsOf([base]), regionBounds, 'mask');
  return base;
}

function attachMask(nodes, maskRef, masks, matrix, prefix, serial, name, budget) {
  if (!maskRef) return nodes;
  const mask = masks.get(maskRef);
  if (!mask) fail('missing-mask', `SVG layer references missing mask “${maskRef}”.`, 'mask');
  if (!nodes.length) return nodes;
  const source = maskSourcePath(mask, matrix, prefix, serial, budget, `${name} mask source`);
  source.id = `${prefix}-mask-source-${serial}`;
  const children = [...nodes, source];
  const bounds = boundsOf(children);
  for (const child of children) translateLayer(child, bounds.x, bounds.y);
  return [createNode('group', {
    id: `${prefix}-mask-wrapper-${serial}`, name: cleanLayerName(name),
    x: bounds.x, y: bounds.y, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height),
    opacity: 1, fill: 'transparent', mask: true, maskMode: mask.localMaskMode || 'alpha', maskSourceId: source.id, children
  })];
}

function sameMaskRegion(left, right, element) {
  const close = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-7;
  if (![left.x, left.y, left.width, left.height].every((value, index) => close(value, [right.x, right.y, right.width, right.height][index]))) {
    fail('unsupported-mask-region', 'Editor Boolean mask graphs require matching user-space regions on every referenced mask.', element);
  }
}

function maskRect(node, region, { requireReference = false } = {}) {
  if (node.tag !== 'rect' || node.children.length) fail('unsupported-mask-graph', 'Editor Boolean masks require plain rectangular composition surfaces.', node.tag);
  checkElementAttributes(node);
  const style = parseStyle(node, initialStyle);
  if (!style.display || !style.visible || style.opacity !== 1 || style.fill !== '#ffffff' || style.fillColorAlpha !== 1
    || style.fillGradient || style.fillAlpha !== 1 || style.stroke || style.filterRef || style.clipPathRef) {
    fail('unsupported-mask-graph', 'Boolean mask composition surfaces must be visible, opaque white rectangles.', node.tag);
  }
  const x = coordinateLength(node.attrs.x, 'Boolean mask rectangle x', node.tag);
  const y = coordinateLength(node.attrs.y, 'Boolean mask rectangle y', node.tag);
  const width = length(node.attrs.width, 'Boolean mask rectangle width', node.tag);
  const height = length(node.attrs.height, 'Boolean mask rectangle height', node.tag);
  const rx = node.attrs.rx == null ? 0 : length(node.attrs.rx, 'Boolean mask rectangle rx', node.tag);
  const ry = node.attrs.ry == null ? rx : length(node.attrs.ry, 'Boolean mask rectangle ry', node.tag);
  if (x !== region.x || y !== region.y || width !== region.width || height !== region.height || rx !== 0 || ry !== 0) {
    fail('unsupported-mask-graph', 'Boolean mask composition surfaces must exactly match the mask region.', node.tag);
  }
  if (requireReference && !style.maskRef) fail('unsupported-mask-graph', 'Boolean union operands must be local mask references.', node.tag);
  if (!requireReference && style.maskRef) fail('unsupported-mask-graph', 'The final Boolean mask surface cannot contain another mask reference.', node.tag);
  return style.maskRef;
}

function inverseMaskOperand(mask, masks, filters, expectedRegion) {
  if (!mask || mask.maskType !== 'alpha') return null;
  sameMaskRegion(mask.region, expectedRegion, 'mask');
  if (mask.children.length !== 1 || mask.children[0].tag !== 'g') return null;
  const group = mask.children[0];
  if (group.children.length !== 1) return null;
  checkElementAttributes(group);
  const groupStyle = parseStyle(group, initialStyle);
  if (!groupStyle.filterRef || groupStyle.maskRef || groupStyle.clipPathRef || groupStyle.opacity !== 1 || group.attrs.transform) return null;
  const filter = filters.get(groupStyle.filterRef);
  if (!filter?.alphaInversion || filter.region.units !== 'userSpaceOnUse') return null;
  const filterRegion = {
    x: filter.region.x.value, y: filter.region.y.value,
    width: filter.region.width.value, height: filter.region.height.value
  };
  sameMaskRegion(filterRegion, expectedRegion, 'filter');
  const ref = maskRect(group.children[0], expectedRegion, { requireReference: true });
  return ref;
}

function booleanMaskGraph(mask, masks, filters) {
  if (!mask || mask.maskType !== 'alpha') fail('unsupported-mask-graph', 'Editor Boolean output requires an alpha mask definition.', 'mask');
  const region = mask.region;
  if (region.x !== 0 || region.y !== 0) fail('unsupported-mask-region', 'Editor Boolean masks must start at user-space origin.', 'mask');
  const operand = ref => {
    const value = masks.get(ref);
    if (!value || value.maskType !== 'alpha') fail('missing-mask', `Boolean mask references missing local operand mask “${ref}”.`, 'mask');
    sameMaskRegion(value.region, region, 'mask');
  };
  if (!mask.children.length) fail('unsupported-mask-graph', 'An empty Boolean mask cannot be reconstructed as editable operands.', 'mask');

  if (mask.children.every(child => child.tag === 'rect')) {
    const refs = mask.children.map(child => maskRect(child, region, { requireReference: true }));
    if (refs.length < 2) fail('unsupported-mask-graph', 'An editable Boolean operation requires at least two vector operands.', 'mask');
    refs.forEach(operand);
    return { operation: 'union', region, operandRefs: refs };
  }

  if (mask.children.length !== 1) fail('unsupported-mask-graph', 'Boolean output uses an unsupported mask composition graph.', 'mask');
  const refs = [];
  let current = mask.children[0];
  while (current.tag === 'g') {
    if (current.children.length !== 1) fail('unsupported-mask-graph', 'Boolean mask composition groups must contain one child.', current.tag);
    checkElementAttributes(current);
    const style = parseStyle(current, initialStyle);
    if (style.filterRef || style.clipPathRef || style.opacity !== 1 || current.attrs.transform) {
      fail('unsupported-mask-graph', 'Boolean mask composition groups cannot apply extra filters, transforms or opacity.', current.tag);
    }
    if (style.maskRef) refs.push(style.maskRef);
    current = current.children[0];
  }
  if (current.tag !== 'rect' || current.children.length) fail('unsupported-mask-graph', 'Boolean mask composition must end in its white rectangular surface.', current.tag);
  maskRect(current, region);
  if (refs.length < 2) fail('unsupported-mask-graph', 'An editable Boolean operation requires at least two vector operands.', 'mask');

  const inverted = refs.slice(1).map(ref => inverseMaskOperand(masks.get(ref), masks, filters, region));
  if (inverted.every(Boolean)) {
    operand(refs[0]);
    inverted.forEach(operand);
    return { operation: 'subtract', region, operandRefs: [refs[0], ...inverted] };
  }
  if (inverted.some(Boolean)) fail('unsupported-mask-graph', 'Boolean subtraction mixes supported and unsupported mask graphs.', 'mask');
  const direct = refs.slice(1).every(ref => {
    const value = masks.get(ref);
    const group = value?.children?.[0];
    return value?.maskType === 'alpha' && group?.tag === 'g' && group.children.length === 1
      && clipPathGeometryTags.has(group.children[0].tag) && group.children[0].children.length === 0;
  });
  if (!direct) fail('unsupported-mask-graph', 'Boolean mask references use unsupported nested or filtered operand graphs.', 'mask');
  refs.forEach(operand);
  return { operation: 'intersect', region, operandRefs: refs };
}

function booleanOperandNode(mask, matrix, prefix, serial, index, budget) {
  if (!mask || mask.maskType !== 'alpha') fail('unsupported-mask-graph', 'Boolean operands must be local alpha vector masks.', 'mask');
  const path = maskSourcePath(mask, matrix, prefix, `${serial}-operand-${index}`, budget, `Operand ${index + 1}`);
  path.id = `${prefix}-boolean-${serial}-operand-${index}`;
  path.name = `Operand ${index + 1}`;
  return path;
}

function importBooleanLayer(node, style, matrix, prefix, serial, masks, filters, budget) {
  if (!style.maskRef) fail('unsupported-mask-graph', 'Editor Boolean metadata requires a local result mask.', node.tag);
  if (style.maskRef === 'none' || style.clipPathRef) fail('unsupported-mask-graph', 'Editor Boolean output requires one local result mask without clipping.', node.tag);
  const visibleChildren = node.children.filter(child => child.tag !== 'title');
  if (node.children.some(child => child.tag === 'title' && (child.children.length || Object.keys(child.attrs).length))) {
    fail('invalid-mask', 'Boolean SVG title metadata cannot contain nested markup or attributes.', 'title');
  }
  if (visibleChildren.length !== 1 || visibleChildren[0].tag !== 'rect') {
    fail('unsupported-mask-graph', 'Editor Boolean output must contain exactly one rectangular painted result.', node.tag);
  }
  const shape = visibleChildren[0];
  checkElementAttributes(shape);
  const fillStyle = parseStyle(shape, initialStyle);
  if (!fillStyle.display || !fillStyle.visible || !fillStyle.fill || fillStyle.fillGradient
    || fillStyle.stroke || fillStyle.strokeWidth > 0 || fillStyle.filterRef || fillStyle.clipPathRef || fillStyle.maskRef) {
    fail('unsupported-mask-graph', 'Editor Boolean output currently supports a visible solid fill without strokes or nested effects.', shape.tag);
  }
  const x = coordinateLength(shape.attrs.x, 'Boolean result x', shape.tag);
  const y = coordinateLength(shape.attrs.y, 'Boolean result y', shape.tag);
  const width = length(shape.attrs.width, 'Boolean result width', shape.tag);
  const height = length(shape.attrs.height, 'Boolean result height', shape.tag);
  const rx = shape.attrs.rx == null ? 0 : length(shape.attrs.rx, 'Boolean result rx', shape.tag);
  const ry = shape.attrs.ry == null ? rx : length(shape.attrs.ry, 'Boolean result ry', shape.tag);
  if (x !== 0 || y !== 0 || rx !== 0 || ry !== 0 || width <= 0 || height <= 0) {
    fail('unsupported-mask-graph', 'Editor Boolean output requires an origin-aligned unrounded result rectangle.', shape.tag);
  }
  const graph = booleanMaskGraph(masks.get(style.maskRef), masks, filters);
  if (graph.region.width !== width || graph.region.height !== height) {
    fail('unsupported-mask-region', 'Boolean result rectangle and mask region must have matching dimensions.', node.tag);
  }
  const operationChildren = graph.operandRefs.map((ref, index) => booleanOperandNode(masks.get(ref), matrix, prefix, serial, index, budget));
  const resultBounds = transformedRectBounds(matrix, 0, 0, width, height);
  assertBoundsContained(boundsOf(operationChildren), resultBounds, node.tag);
  for (const child of operationChildren) translateLayer(child, resultBounds.x, resultBounds.y);
  const id = `${prefix}-boolean-${serial}`;
  return createNode('boolean', {
    id, name: cleanLayerName(localName(node)), x: resultBounds.x, y: resultBounds.y,
    width: Math.max(1, resultBounds.width), height: Math.max(1, resultBounds.height),
    opacity: style.opacity * fillStyle.opacity, fill: fillStyle.fill, fillOpacity: fillStyle.fillAlpha,
    operation: graph.operation, children: operationChildren
  });
}

function translateLayer(node, x, y) {
  node.x -= x; node.y -= y;
  return node;
}

function parsePreserveAspectRatio(value, vbWidth, vbHeight, width, height, element) {
  const words = (value || 'xMidYMid meet').trim().split(/\s+/).filter(Boolean);
  if (words[0] === 'defer') words.shift();
  if (words[0] === 'none') {
    if (words.length > 2) fail('invalid-preserve-aspect-ratio', 'SVG preserveAspectRatio none accepts at most a meet/slice token.', element);
    return { sx: width / vbWidth, sy: height / vbHeight, ax: 0, ay: 0 };
  }
  const align = /^(xMin|xMid|xMax)(YMin|YMid|YMax)$/.exec(words[0] || '');
  const mode = words[1] || 'meet';
  if (!align || !['meet', 'slice'].includes(mode) || words.length > 2) fail('invalid-preserve-aspect-ratio', 'SVG preserveAspectRatio is invalid.', element);
  const scale = mode === 'meet' ? Math.min(width / vbWidth, height / vbHeight) : Math.max(width / vbWidth, height / vbHeight);
  const spareX = width - vbWidth * scale; const spareY = height - vbHeight * scale;
  const ax = align[1] === 'xMin' ? 0 : align[1] === 'xMax' ? spareX : spareX / 2;
  const ay = align[2] === 'YMin' ? 0 : align[2] === 'YMax' ? spareY : spareY / 2;
  return { sx: scale, sy: scale, ax, ay };
}

function localName(node) {
  if (node.attrs['data-tiny-image-star-node-id']) {
    const title = node.children?.find(child => child.tag === 'title');
    if (title && !title.children.length && title.textContent?.trim()) return cleanLayerName(title.textContent);
  }
  return node.attrs.id ? cleanLayerName(node.attrs.id) : `${node.tag} ${node.serial}`;
}

function svgTextValue(node, style, gradients = new Map()) {
  const editorWrapped = node.attrs['data-tiny-image-star-text-wrap'] != null;
  if (editorWrapped && node.attrs['data-tiny-image-star-text-wrap'] !== 'canvas-word-wrap') {
    fail('unsupported-text-wrap', 'This Tiny Image Star SVG uses an unknown text-wrap encoding.', 'text');
  }
  const runStyleKeys = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontAxes', 'fontFeatures', 'lineHeight', 'letterSpacing', 'textDecoration', 'baselineShift', 'fill', 'fillAlpha'];
  const segments = [];
  let rawLength = 0;
  const pushSegment = (text, runStyle) => {
    rawLength += text.length;
    if (rawLength > MAX_TEXT_LENGTH) fail('resource-limit', `SVG text exceeds the ${MAX_TEXT_LENGTH}-character import limit.`, 'text');
    if (text && runStyle.display && runStyle.visible) segments.push({ text, style: runStyle });
  };
  const validateTspanStyle = runStyle => {
    if (runStyle.opacity !== 1) fail('unsupported-text-opacity', 'SVG tspan opacity cannot be preserved per text run.', 'tspan');
    if (runStyle.fillGradient) fail('unsupported-text-paint', 'SVG gradient fills on text runs cannot be represented by editable text.', 'tspan');
    if (Math.abs(runStyle.fillAlpha - style.fillAlpha) > 1e-8) fail('unsupported-text-paint', 'SVG text runs with different fill opacity cannot be represented faithfully.', 'tspan');
    if (runStyle.stroke && runStyle.strokeAlpha > 0 && runStyle.strokeWidth > 0) {
      fail('unsupported-text-paint', 'SVG stroke paint on text runs cannot be represented by editable text.', 'tspan');
    }
    if (runStyle.textAnchor !== style.textAnchor || runStyle.dominantBaseline !== style.dominantBaseline
      || runStyle.textCase !== style.textCase || runStyle.xmlSpace !== style.xmlSpace) {
      fail('unsupported-text-feature', 'SVG tspan alignment, baseline, text transform, and whitespace mode must match the parent text layer.', 'tspan');
    }
    if (runStyle.fontStyle === 'oblique') fail('unsupported-text-font', 'Oblique SVG text runs are not supported; use normal or italic font-style.', 'tspan');
    if (!['none', 'underline', 'line-through'].includes(runStyle.textDecoration)) {
      fail('unsupported-text-decoration', 'SVG text runs support only none, underline, or line-through decoration.', 'tspan');
    }
  };
  let editorLineCount = 0;
  const collect = (parent, inheritedStyle) => {
    for (const item of parent.content || []) {
      if (typeof item === 'string') {
        if (editorWrapped && parent === node) {
          if (item.trim()) fail('unsupported-text-wrap', 'Tiny Image Star wrapped SVG text must contain positioned line tspans only.', 'text');
          continue;
        }
        pushSegment(item, inheritedStyle); continue;
      }
      if (['script', 'foreignObject'].includes(item.tag)) fail('active-content', `SVG element <${item.tag}> contains active or embedded content.`, item.tag);
      if (['image', 'use'].includes(item.tag) || Object.hasOwn(item.attrs, 'href') || Object.hasOwn(item.attrs, 'xlink:href')) {
        fail('external-reference', 'SVG text cannot contain linked or embedded elements.', item.tag);
      }
      if (Object.keys(item.attrs).some(key => /^on/i.test(key))) fail('active-content', 'SVG text contains an event handler attribute.', item.tag);
      if (item.tag !== 'tspan') fail('unsupported-text-feature', 'Only nested <tspan> elements with editable text styles are supported inside SVG <text>.', item.tag);
      const isEditorLine = editorWrapped && parent === node;
      if (isEditorLine) {
        if (item.attrs['data-tiny-image-star-list-marker'] != null) {
          fail('unsupported-text-list', 'Tiny Image Star SVG list markers cannot be represented as editable text runs.', 'tspan');
        }
        if (item.attrs['word-spacing'] != null) {
          fail('unsupported-text-spacing', 'Justified Tiny Image Star SVG text with word-spacing cannot be represented as editable text runs.', 'tspan');
        }
        for (const coordinate of ['x', 'y']) {
          const raw = item.attrs[coordinate];
          if (raw == null || /[\s,]/.test(raw)) fail('unsupported-text-positioning', 'Tiny Image Star line tspans require one x and y coordinate each.', 'tspan');
          coordinateLength(raw, `line tspan ${coordinate}`, 'tspan');
        }
        if (item.attrs.textLength != null) {
          const textLength = coordinateLength(item.attrs.textLength, 'textLength', 'tspan');
          if (!(textLength > 0)) fail('invalid-text-length', 'Tiny Image Star line tspan textLength must be positive.', 'tspan');
        }
        if (item.attrs.lengthAdjust != null && item.attrs.lengthAdjust !== 'spacingAndGlyphs') {
          fail('unsupported-text-spacing', 'Only Tiny Image Star spacingAndGlyphs line tspan adjustment is supported.', 'tspan');
        }
        const wrapperOnly = new Set(['x', 'y', 'textLength', 'lengthAdjust']);
        const checked = { ...item, attrs: Object.fromEntries(Object.entries(item.attrs).filter(([key]) => !wrapperOnly.has(key))) };
        checkElementAttributes(checked);
      } else {
        checkElementAttributes(item);
        if (item.attrs.transform != null) fail('unsupported-text-transform', 'Transforms on SVG tspan elements cannot be preserved as editable text runs.', 'tspan');
      }
      const runStyle = parseStyle(item, inheritedStyle, gradients);
      validateTspanStyle(runStyle);
      if (isEditorLine) {
        if (editorLineCount > 0) {
          rawLength += 1;
          if (rawLength > MAX_TEXT_LENGTH) fail('resource-limit', `SVG text exceeds the ${MAX_TEXT_LENGTH}-character import limit.`, 'text');
          segments.push({ text: '\n', style: runStyle, lineBreak: true });
        }
        editorLineCount += 1;
      }
      collect(item, runStyle);
    }
  };
  collect(node, style);
  const rawValue = segments.filter(segment => !segment.lineBreak).map(segment => segment.text).join('').replace(/\r\n?/g, '\n');
  if (style.xmlSpace === 'preserve' && (/[\t\n\r]/.test(rawValue) || /^ | $| {2,}/.test(rawValue))) {
    fail('unsupported-text-whitespace', 'SVG xml:space="preserve" text with tabs, line breaks, or repeated spaces cannot be represented faithfully.', 'text');
  }

  const normalized = [];
  const append = (character, runStyle) => {
    const previous = normalized.at(-1);
    const sameStyle = previous && runStyleKeys.every(key => Object.is(previous.style[key], runStyle[key]));
    if (sameStyle) previous.text += character;
    else normalized.push({ text: character, style: runStyle });
  };
  if (style.xmlSpace === 'default') {
    let pendingSpaceStyle = null;
    for (const segment of segments) {
      if (segment.lineBreak) {
        pendingSpaceStyle = null;
        append('\n', segment.style);
        continue;
      }
      for (const character of segment.text.replace(/\r\n?/g, '\n')) {
        if (/[\t\n\r ]/.test(character)) { pendingSpaceStyle ||= segment.style; continue; }
        if (pendingSpaceStyle && normalized.length) append(' ', pendingSpaceStyle);
        pendingSpaceStyle = null;
        append(character, segment.style);
      }
    }
  } else {
    for (const segment of segments) {
      if (segment.lineBreak) { append('\n', segment.style); continue; }
      for (const character of segment.text.replace(/\r\n?/g, '\n')) append(character, segment.style);
    }
  }
  const text = normalized.map(segment => segment.text).join('');
  if (text.length > MAX_TEXT_LENGTH) fail('resource-limit', `SVG text exceeds the ${MAX_TEXT_LENGTH}-character import limit.`, 'text');
  return { text, segments: normalized };
}

function validateNestedTextMarkup(node) {
  const pending = [...node.children];
  while (pending.length) {
    const child = pending.pop();
    if (['image', 'use'].includes(child.tag) || Object.hasOwn(child.attrs, 'href') || Object.hasOwn(child.attrs, 'xlink:href')) {
      fail('external-reference', 'SVG text cannot contain linked or embedded elements.', child.tag);
    }
    if (unsafeSvgElements.has(child.tag)) {
      const code = ['script', 'foreignObject'].includes(child.tag) ? 'active-content' : 'unsupported-element';
      fail(code, `SVG element <${child.tag}> is not accepted.`, child.tag);
    }
    for (const key of Object.keys(child.attrs)) {
      if (/^on/i.test(key)) fail('active-content', `SVG event handler attribute “${key}” is not accepted.`, child.tag);
    }
    pending.push(...child.children);
  }
}

function textLayer(node, style, matrix, prefix, serial, gradients) {
  const content = svgTextValue(node, style, gradients);
  const value = content.text;
  if (!value) return null;
  if (style.dominantBaseline !== 'text-before-edge') {
    fail('unsupported-text-baseline', 'Editable SVG text requires dominant-baseline="text-before-edge" so its top edge maps exactly to the text layer.', 'text');
  }
  if (style.fontStyle === 'oblique') fail('unsupported-text-font', 'Oblique SVG text is not supported; use normal or italic font-style.', 'text');
  if (!['none', 'underline', 'line-through'].includes(style.textDecoration)) {
    fail('unsupported-text-decoration', 'Only none, underline, and line-through SVG text decoration are supported.', 'text');
  }
  if (!['none', 'uppercase', 'lowercase', 'capitalize'].includes(style.textCase)) {
    fail('unsupported-text-transform', 'Only none, uppercase, lowercase, and capitalize SVG text transforms are supported.', 'text');
  }
  if (style.fillGradient) fail('unsupported-text-paint', 'SVG gradient fills on text cannot be represented by a solid editable text color.', 'text');
  if (style.stroke && style.strokeAlpha > 0 && style.strokeWidth > 0) {
    fail('unsupported-text-paint', 'SVG stroke paint on text cannot be represented by the editable text layer.', 'text');
  }
  const scale = matrixScale(matrix);
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  const tolerance = Math.max(1, scale || 0) * 1e-8;
  if (!(scale > 0) || determinant <= tolerance * tolerance) {
    fail('unsupported-text-transform', 'SVG text supports only positive uniform scale, translation, and rotation transforms.', 'text');
  }
  const angle = Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI;
  const xText = node.attrs.x == null ? '0' : node.attrs.x.trim();
  const yText = node.attrs.y == null ? '0' : node.attrs.y.trim();
  if (/[\s,]/.test(xText) || /[\s,]/.test(yText)) {
    fail('unsupported-text-positioning', 'SVG text x and y must each be a single coordinate; per-character positioning is unsupported.', 'text');
  }
  const x = coordinateLength(xText, 'text x', 'text');
  const y = coordinateLength(yText, 'text y', 'text');
  const textRuns = content.segments.map(segment => {
    const run = { text: segment.text };
    for (const [source, target] of [
      ['fontFamily', 'fontFamily'], ['fontSize', 'fontSize'], ['fontWeight', 'fontWeight'], ['fontStyle', 'fontStyle'], ['fontAxes', 'fontAxes'], ['fontFeatures', 'fontFeatures'],
      ['lineHeight', 'lineHeight'], ['letterSpacing', 'letterSpacing'], ['textDecoration', 'textDecoration']
    ]) if (!Object.is(segment.style[source], style[source])) run[target] = segment.style[source];
    if (segment.style.baselineShift !== 0) run.baselineShift = segment.style.baselineShift;
    const colorValue = segment.style.fill || '#000000';
    if (colorValue !== (style.fill || '#000000')) run.color = colorValue;
    return run;
  });
  const hasStyledRuns = textRuns.some(run => Object.keys(run).length > 1);
  const estimatedRunWidth = content.segments.reduce((sum, segment) => {
    const glyphCount = [...segment.text].length;
    return sum + glyphCount * segment.style.fontSize * 1.25
      + Math.max(0, glyphCount - 1) * Math.max(0, segment.style.letterSpacing);
  }, 0);
  const width = Math.max(1, Math.ceil(estimatedRunWidth + 2));
  if (!Number.isFinite(width) || width > 100_000) fail('resource-limit', 'SVG text would exceed the editor’s 100000 px text-layer width limit.', 'text');
  const outputFontSize = style.fontSize * scale;
  const maximumRunLineHeight = content.segments.reduce((maximum, segment) =>
    Math.max(maximum, segment.style.fontSize * segment.style.lineHeight), style.fontSize * style.lineHeight);
  const height = Math.max(36, Math.ceil(maximumRunLineHeight * scale + 4));
  const anchor = style.textAnchor === 'middle' ? 'center' : style.textAnchor === 'end' ? 'right' : 'left';
  const localLeft = anchor === 'center' ? x - width / 2 : anchor === 'right' ? x - width : x;
  const mappedTopLeft = mapPoint(matrix, { x: localLeft, y });
  const outputWidth = width * scale;
  const outputHeight = height * scale;
  const outputLetterSpacing = style.letterSpacing * scale;
  if (!Number.isFinite(outputFontSize) || outputFontSize <= 0 || outputFontSize > 100_000
    || !Number.isFinite(outputLetterSpacing) || Math.abs(outputLetterSpacing) > 10_000
    || !Number.isFinite(outputWidth) || outputWidth > 100_000
    || !Number.isFinite(outputHeight) || outputHeight > MAX_COORDINATE) {
    fail('resource-limit', 'Transformed SVG text exceeds the editor’s font, spacing, or text-layer size limits.', 'text');
  }
  const radians = angle * Math.PI / 180;
  const cosine = Math.cos(radians); const sine = Math.sin(radians);
  // Scene layers rotate around their center. Move the unrotated bounds so their
  // post-rotation top-left remains at the point transformed by the source SVG.
  const layerX = mappedTopLeft.x + cosine * outputWidth / 2 - sine * outputHeight / 2 - outputWidth / 2;
  const layerY = mappedTopLeft.y + sine * outputWidth / 2 + cosine * outputHeight / 2 - outputHeight / 2;
  if (![layerX, layerY, outputWidth, outputHeight].every(Number.isFinite)
    || Math.abs(layerX) > MAX_COORDINATE || Math.abs(layerY) > MAX_COORDINATE) {
    fail('coordinate-out-of-range', 'Transformed SVG text exceeds the supported coordinate range.', 'text');
  }
  return createNode('text', {
    id: `${prefix}-${serial}`, name: cleanLayerName(localName(node)),
    x: layerX, y: layerY, width: outputWidth, height: outputHeight, rotation: angle,
    opacity: style.opacity, text: value, textFit: 'auto-width',
    fontFamily: style.fontFamily, fontSize: outputFontSize, fontWeight: style.fontWeight,
    fontStyle: style.fontStyle, lineHeight: style.lineHeight, letterSpacing: outputLetterSpacing,
    ...(style.fontAxes ? { fontAxes: style.fontAxes } : {}),
    ...(style.fontFeatures ? { fontFeatures: style.fontFeatures } : {}),
    color: style.fill || '#000000', fillOpacity: style.fill ? style.fillColorAlpha * style.fillOpacityValue : 0,
    align: anchor, verticalAlign: 'top', textCase: style.textCase, textDecoration: style.textDecoration,
    ...(hasStyledRuns ? { textRuns: textRuns.map(run => {
      const baselineShift = run.baselineShift == null ? null : run.baselineShift * scale;
      if (baselineShift != null && Math.abs(baselineShift) > MAX_TEXT_RUN_BASELINE_SHIFT) {
        fail('resource-limit', `Transformed SVG baseline shift exceeds ±${MAX_TEXT_RUN_BASELINE_SHIFT} px.`, 'text');
      }
      return { ...run,
        ...(run.fontSize != null ? { fontSize: run.fontSize * scale } : {}),
        ...(run.letterSpacing != null ? { letterSpacing: run.letterSpacing * scale } : {}),
        ...(baselineShift != null ? { baselineShift } : {}),
        ...(run.lineHeight != null ? { lineHeight: run.lineHeight } : {})
      };
    }) } : {}),
    stroke: null, strokeWidth: 0, children: []
  });
}

function resolveNodeFilter(style, filters, matrix, sourceNodes, prefix, node, name = localName(node)) {
  if (!style.filterRef) return [];
  const filter = filters.get(style.filterRef);
  if (!filter) fail('missing-filter', `SVG layer references missing filter “${style.filterRef}”.`, node.tag);
  if (filter.alphaInversion) fail('unsupported-filter-graph', 'SVG alpha-inversion filters are supported only inside editor Boolean cutout masks.', node.tag);
  return mapFilterEffects(filter, matrix, sourceNodes, prefix, node.serial, name);
}

function buildTree(node, parentMatrix, parentStyle, prefix, counter, budget, gradients, filters, clipPaths, masks) {
  if (node.tag === 'svg' && node !== counter.root) fail('unsupported-nested-svg', 'Nested <svg> viewports are not supported.', 'svg');
  if (node.tag === 'defs') return [];
  if (node.tag === 'title') return [];
  if (node.tag === 'tspan') fail('unsupported-text-tspan', 'SVG <tspan> runs are not supported; use one plain text run per <text> element.', 'tspan');
  if (unsafeSvgElements.has(node.tag)) {
    const code = ['script', 'foreignObject'].includes(node.tag) ? 'active-content' : ['image', 'use'].includes(node.tag) ? 'external-reference' : 'unsupported-element';
    fail(code, `SVG element <${node.tag}> is not accepted.`, node.tag);
  }
  if (!geomAttrs[node.tag]) fail('unsupported-element', `SVG element <${node.tag}> is not supported.`, node.tag);
  checkElementAttributes(node);
  if (node.tag === 'text') validateNestedTextMarkup(node);
  const style = parseStyle(node, parentStyle, gradients);
  if (!style.display || (node.tag !== 'g' && node.tag !== 'svg' && !style.visible)) return [];
  const matrix = matrixMultiply(parentMatrix, parseTransform(node.attrs.transform, node.tag));
  if (node.attrs['data-tiny-image-star-type'] === 'boolean') {
    const booleanLayer = importBooleanLayer(node, style, matrix, prefix, node.serial, masks, filters, budget);
    booleanLayer.effects = resolveNodeFilter(style, filters, matrix, [booleanLayer], prefix, node);
    return [booleanLayer];
  }
  if (Object.hasOwn(node.attrs, NETWORK_METADATA_ATTRIBUTE)) {
    const network = importedNetwork(node, matrix, style, prefix, counter, node.attrs[NETWORK_METADATA_ATTRIBUTE]);
    const effects = resolveNodeFilter(style, filters, matrix, [network], prefix, node);
    const filtered = attachFilterEffects([network], effects, prefix, node.serial, localName(node));
    return attachMask(attachClipPath(filtered, style.clipPathRef, clipPaths, matrix, prefix, node.serial, localName(node), budget),
      style.maskRef, masks, matrix, prefix, node.serial, localName(node), budget);
  }
  if (node.tag === 'text') {
    const serial = counter.next++;
    const layer = textLayer(node, style, matrix, prefix, serial, gradients);
    const layers = layer ? [layer] : [];
    const effects = resolveNodeFilter(style, filters, matrix, layers, prefix, node);
    const filtered = attachFilterEffects(layers, effects, prefix, node.serial, localName(node));
    return attachMask(attachClipPath(filtered, style.clipPathRef, clipPaths, matrix, prefix, node.serial, localName(node), budget),
      style.maskRef, masks, matrix, prefix, node.serial, localName(node), budget);
  }
  if (node.tag !== 'g' && node.tag !== 'svg') {
    const paths = elementPaths(node, budget);
    const output = [];
    for (const path of paths) {
      const name = localName(node);
      const serial = counter.next++;
      const { base, strokeWidth, fillGradient } = makePathNode(path, style, matrix, prefix, name);
      output.push(...createPaintLayers(base, { ...style, fillGradient }, strokeWidth, prefix, serial, name, { fillAllowed: !path.noFill }));
    }
    const effects = resolveNodeFilter(style, filters, matrix, output, prefix, node);
    const filtered = attachFilterEffects(output, effects, prefix, node.serial, localName(node));
    return attachMask(attachClipPath(filtered, style.clipPathRef, clipPaths, matrix, prefix, node.serial, localName(node), budget),
      style.maskRef, masks, matrix, prefix, node.serial, localName(node), budget);
  }
  const childLayers = [];
  for (const child of node.children) childLayers.push(...buildTree(child, matrix, style, prefix, counter, budget, gradients, filters, clipPaths, masks));
  const effects = resolveNodeFilter(style, filters, matrix, childLayers, prefix, node);
  if (!childLayers.length) {
    if (!style.visible) return [];
    const group = createNode('group', {
      id: `${prefix}-${counter.next++}`, name: cleanLayerName(localName(node)), x: 0, y: 0, width: 0, height: 0,
      opacity: style.opacity, effects, children: []
    });
    return attachMask(attachClipPath([group], style.clipPathRef, clipPaths, matrix, prefix, node.serial, localName(node), budget),
      style.maskRef, masks, matrix, prefix, node.serial, localName(node), budget);
  }
  const bounds = boundsOf(childLayers);
  for (const child of childLayers) translateLayer(child, bounds.x, bounds.y);
  const group = createNode('group', {
    id: `${prefix}-${counter.next++}`, name: cleanLayerName(localName(node)), x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height, opacity: style.opacity, fill: 'transparent', effects, children: childLayers
  });
  const filtered = attachFilterEffects([group], effects, prefix, node.serial, localName(node));
  return attachMask(attachClipPath(filtered, style.clipPathRef, clipPaths, matrix, prefix, node.serial, localName(node), budget),
    style.maskRef, masks, matrix, prefix, node.serial, localName(node), budget);
}

/**
 * Parse safe SVG markup into deterministic editable vector layers.
 *
 * This importer keeps geometry local: every returned shape is a path layer,
 * while SVG groups remain editable group layers. Input that needs scripts,
 * linked assets, CSS references, or unsupported paint semantics is rejected.
 */
export function importSvgToLayers(source, { viewportWidth = null, viewportHeight = null } = {}) {
  const root = parseXml(source);
  const { gradients, clipPaths, filters, masks } = collectDefinitions(root);
  for (const node of [root, ...root.children]) checkElementAttributes(node);
  const viewBox = parseViewBox(root.attrs.viewBox);
  const suppliedWidth = viewportWidth == null ? null : length(String(viewportWidth), 'viewport width', 'svg');
  const suppliedHeight = viewportHeight == null ? null : length(String(viewportHeight), 'viewport height', 'svg');
  const percentageDimension = (value, label, supplied, fallback) => {
    if (value == null) return length(value, label, 'svg', fallback);
    const percentage = /^([+]?(?:\d+\.?\d*|\.\d+)(?:e[+]\d+)?)%$/.exec(value.trim());
    if (percentage) {
      if (supplied == null) fail('viewport-required', `SVG percentage ${label} needs viewport${label === 'width' ? 'Width' : 'Height'}.`, 'svg');
      const amount = finiteNumber(percentage[1], `${label} percentage`, 'svg', { min: 0, max: 100_000 });
      return finiteNumber(supplied * amount / 100, label, 'svg', { min: 0, max: MAX_COORDINATE });
    }
    if (value.trim().endsWith('%')) fail('invalid-size', `SVG ${label} percentage is invalid.`, 'svg');
    return length(value, label, 'svg', fallback);
  };
  const width = percentageDimension(root.attrs.width, 'width', suppliedWidth, suppliedWidth ?? viewBox?.[2] ?? 300);
  const height = percentageDimension(root.attrs.height, 'height', suppliedHeight, suppliedHeight ?? viewBox?.[3] ?? 150);
  if (width <= 0 || height <= 0) fail('invalid-size', 'SVG viewport width and height must be greater than zero.', 'svg');
  const [minX, minY, vbWidth, vbHeight] = viewBox ?? [0, 0, width, height];
  const aspect = parsePreserveAspectRatio(root.attrs.preserveAspectRatio, vbWidth, vbHeight, width, height, 'svg');
  const rootMatrix = [aspect.sx, 0, 0, aspect.sy, aspect.ax - minX * aspect.sx, aspect.ay - minY * aspect.sy];
  const transformedRootMatrix = matrixMultiply(parseTransform(root.attrs.transform, 'svg'), rootMatrix);
  const hash = stableHash(source);
  const prefix = `svg-${hash}`;
  const counter = { next: 0, root };
  const budget = { points: 0, tokens: 0 };
  const style = parseStyle(root, initialStyle, gradients);
  const children = [];
  for (const child of root.children) children.push(...buildTree(child, transformedRootMatrix, style, prefix, counter, budget, gradients, filters, clipPaths, masks));
  const effects = resolveNodeFilter(style, filters, transformedRootMatrix, children, prefix, root, root.attrs.id || 'Imported SVG');
  const rootChildren = attachMask(
    attachClipPath(children, style.clipPathRef, clipPaths, transformedRootMatrix, prefix, root.serial, root.attrs.id || 'Imported SVG', budget),
    style.maskRef, masks, transformedRootMatrix, prefix, root.serial, root.attrs.id || 'Imported SVG', budget
  );
  const layers = [];
  for (const child of rootChildren) layers.push(translateLayer(child, 0, 0));
  const rootLayer = createNode('frame', {
    id: `${prefix}-root`, name: cleanLayerName(root.attrs.id || 'Imported SVG'), x: 0, y: 0, width, height,
    fill: 'transparent', opacity: style.opacity, stroke: null, strokeWidth: 0, clip: true, effects, children: layers
  });
  const validationDocument = createDocument();
  validationDocument.pages[0].children = [rootLayer];
  validateDocument(validationDocument);
  return { width, height, viewBox: viewBox ? [...viewBox] : [0, 0, width, height], nodes: [rootLayer] };
}
