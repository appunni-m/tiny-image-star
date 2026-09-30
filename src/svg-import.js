import { createDocument, createNode, validateDocument } from './model.js';

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
const MAX_TEXT_LENGTH = 100_000;
const unsafeSvgElements = new Set(['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'style', 'image', 'use', 'a']);
const initialStyle = {
  fill: '#000000', fillAlpha: 1, fillColorAlpha: 1, fillOpacityValue: 1,
  stroke: null, strokeAlpha: 1, strokeColorAlpha: 1, strokeOpacityValue: 1, strokeWidth: 1,
  strokeCap: 'butt', strokeJoin: 'miter', strokePattern: 'solid', strokeMiterLimit: 4, strokeDashArray: null, fillGradient: null,
  fillRule: 'nonzero', opacity: 1,
  fontFamily: 'sans-serif', fontSize: 16, fontWeight: 400, fontStyle: 'normal', textAnchor: 'start',
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
  const allowedPaint = new Set(['fill', 'fillOpacity', 'stroke', 'strokeWidth', 'strokeOpacity', 'strokeCap', 'strokeJoin', 'strokePattern', 'strokeMiterLimit', 'strokes', 'fillGradient', 'fillRule']);
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
  const paint = { ...payload.paint };
  if (scale != null && scale !== 1) {
    if (Number.isFinite(paint.strokeWidth)) paint.strokeWidth *= scale;
    if (Array.isArray(paint.strokes)) paint.strokes = paint.strokes.map(stroke => ({ ...stroke, width: stroke.width * scale }));
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

function collectGradients(root) {
  const gradients = new Map();
  const ids = new Set();
  let stopCount = 0;
  for (const defs of root.children.filter(child => child.tag === 'defs')) {
    for (const child of defs.children) {
      if (!['linearGradient', 'radialGradient'].includes(child.tag)) {
        fail('unsupported-gradient', '<defs> may contain only supported gradient definitions.', child.tag);
      }
      if (gradients.size >= MAX_GRADIENTS) fail('resource-limit', `SVG contains more than ${MAX_GRADIENTS} gradient definitions.`, 'defs');
      stopCount += child.children.length;
      if (stopCount > MAX_GRADIENTS * MAX_GRADIENT_STOPS) fail('resource-limit', 'SVG contains too many gradient stops.', 'defs');
      const gradient = parseGradient(child, ids);
      gradients.set(gradient.id, gradient);
    }
  }
  return gradients;
}

const inheritedProperties = new Set([
  'fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-miterlimit', 'fill-rule', 'color', 'visibility', 'font-family', 'font-size',
  'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'line-height', 'text-decoration', 'text-transform'
]);
const styleProperties = new Set([...inheritedProperties, 'opacity', 'display', 'visibility']);

function parseStyle(node, parentStyle, gradients = new Map()) {
  const values = { ...parentStyle, opacity: 1, display: parentStyle.display, visibility: parentStyle.visibility };
  const declarations = Object.create(null);
  for (const [name, value] of Object.entries(node.attrs)) {
    if (inheritedProperties.has(name) || ['opacity', 'display', 'visibility'].includes(name)) declarations[name] = value;
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
      case 'text-anchor':
        if (!['start', 'middle', 'end'].includes(value)) fail('invalid-text-alignment', 'SVG text-anchor must be start, middle, or end.', node.tag);
        values.textAnchor = value; break;
      case 'dominant-baseline': {
        const baselines = new Set(['auto', 'text-before-edge', 'text-after-edge', 'central', 'middle', 'alphabetic', 'ideographic', 'hanging', 'mathematical', 'before-edge', 'after-edge']);
        if (!baselines.has(value)) fail('invalid-text-baseline', 'SVG dominant-baseline is not a recognized baseline value.', node.tag);
        values.dominantBaseline = value; break;
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
        if (!dash.length || dash.some(item => item < 0) || dash.every(item => item === 0)) fail('invalid-stroke', 'SVG stroke-dasharray must contain a positive dash length.', node.tag);
        values.strokeDashArray = dash;
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
    const normalized = values.strokeDashArray.length % 2 ? [...values.strokeDashArray, ...values.strokeDashArray] : values.strokeDashArray;
    const unit = values.strokeWidth;
    const close = (left, right) => Math.abs(left - right) <= Math.max(1, Math.abs(right)) * 1e-6;
    if (normalized.length === 2 && close(normalized[0], unit * 4) && close(normalized[1], unit * 2)) values.strokePattern = 'dashed';
    else if (normalized.length === 2 && close(normalized[0], 0) && close(normalized[1], unit * 2)) values.strokePattern = 'dotted';
    else fail('unsupported-stroke-style', 'SVG custom dash arrays cannot be represented; use solid, 4:2 dashed, or round 0:2 dotted strokes.', node.tag);
  }
  for (const [property, styleKey] of [
    ['font-family', 'fontFamily'], ['font-size', 'fontSize'], ['font-weight', 'fontWeight'], ['font-style', 'fontStyle'],
    ['text-anchor', 'textAnchor'], ['dominant-baseline', 'dominantBaseline'], ['letter-spacing', 'letterSpacing'],
    ['line-height', 'lineHeight'], ['text-decoration', 'textDecoration'], ['text-transform', 'textCase']
  ]) if (!Object.hasOwn(declarations, property)) values[styleKey] = parentStyle[styleKey];
  if (Object.hasOwn(node.attrs, 'xml:space')) {
    if (!['default', 'preserve'].includes(node.attrs['xml:space'])) fail('invalid-xml-space', 'SVG xml:space must be default or preserve.', node.tag);
    values.xmlSpace = node.attrs['xml:space'];
  } else values.xmlSpace = parentStyle.xmlSpace;
  if (!Object.hasOwn(declarations, 'fill-rule')) values.fillRule = parentStyle.fillRule;
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
  g: new Set(), defs: new Set(['id']),
  text: new Set(['x', 'y']), tspan: new Set(),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry']),
  circle: new Set(['cx', 'cy', 'r']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
  line: new Set(['x1', 'y1', 'x2', 'y2']),
  polyline: new Set(['points']), polygon: new Set(['points']), path: new Set(['d'])
};
const commonAttrs = new Set([
  'id', 'transform', 'style', 'fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-miterlimit', 'fill-rule', 'opacity', 'display', 'visibility', 'color', 'class',
  'href', 'xlink:href', 'xml:space', 'role', 'focusable', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'letter-spacing', 'line-height', 'text-decoration', 'text-transform'
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

function gradientColorAt(stops, position) {
  if (position <= stops[0].position) return stops[0].color;
  if (position >= stops.at(-1).position) return stops.at(-1).color;
  const rightIndex = stops.findIndex(stop => stop.position >= position);
  const left = stops[rightIndex - 1]; const right = stops[rightIndex];
  if (right.position === left.position) return right.color;
  const amount = (position - left.position) / (right.position - left.position);
  const channels = [1, 3, 5].map(offset => {
    const from = Number.parseInt(left.color.slice(offset, offset + 2), 16);
    const to = Number.parseInt(right.color.slice(offset, offset + 2), 16);
    return Math.round(from + (to - from) * amount).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

function clippedGradientStops(stops, sourceStart, sourceEnd, targetStart, targetEnd) {
  const span = sourceEnd - sourceStart;
  if (!(span > 1e-10) || !(targetEnd > targetStart)) fail('invalid-gradient', 'SVG gradient endpoints have no visible span.', 'gradient');
  const start = (targetStart - sourceStart) / span;
  const end = (targetEnd - sourceStart) / span;
  const result = [{ color: gradientColorAt(stops, start), position: 0 }];
  for (const stop of stops) {
    if (stop.position <= start + 1e-9 || stop.position >= end - 1e-9) continue;
    result.push({ color: stop.color, position: (stop.position - start) / (end - start) });
  }
  result.push({ color: gradientColorAt(stops, end), position: 1 });
  if (result.length > MAX_GRADIENT_STOPS) fail('unsupported-gradient', 'The mapped SVG gradient needs too many stops for an editable fill.', 'gradient');
  return result;
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
  let stops = gradient.stops;
  if (gradient.type === 'linear') {
    const start = applyGradientPoint(total, { x: gradient.x1, y: gradient.y1 }, outputBounds.x, outputBounds.y);
    const end = applyGradientPoint(total, { x: gradient.x2, y: gradient.y2 }, outputBounds.x, outputBounds.y);
    const dx = end.x - start.x; const dy = end.y - start.y;
    if (Math.hypot(dx, dy) < 1e-8) fail('invalid-gradient', 'SVG linear gradients need distinct endpoints.', 'linearGradient');
    angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    const radians = angle * Math.PI / 180;
    const halfLength = Math.abs(Math.cos(radians)) * outputBounds.width / 2 + Math.abs(Math.sin(radians)) * outputBounds.height / 2;
    const center = { x: outputBounds.width / 2, y: outputBounds.height / 2 };
    const centerProjection = center.x * Math.cos(radians) + center.y * Math.sin(radians);
    const startProjection = start.x * Math.cos(radians) + start.y * Math.sin(radians);
    const endProjection = end.x * Math.cos(radians) + end.y * Math.sin(radians);
    stops = clippedGradientStops(gradient.stops, startProjection, endProjection, centerProjection - halfLength, centerProjection + halfLength);
  } else {
    const scale = matrixScale(total);
    if (scale == null) fail('unsupported-gradient', 'The editor cannot preserve elliptical or skewed SVG radial gradients.', 'radialGradient');
    const center = applyGradientPoint(total, { x: gradient.cx, y: gradient.cy }, outputBounds.x, outputBounds.y);
    const radius = gradient.r * scale;
    const targetRadius = Math.hypot(outputBounds.width, outputBounds.height) / 2;
    const tolerance = Math.max(1, outputBounds.width, outputBounds.height) * 1e-6;
    if (Math.hypot(center.x - outputBounds.width / 2, center.y - outputBounds.height / 2) > tolerance || radius <= 0) {
      fail('unsupported-gradient', 'The editor supports only centered SVG radial gradients.', 'radialGradient');
    }
    const visibleGradientEnd = targetRadius / radius;
    if (visibleGradientEnd >= 1) stops = gradient.stops.map(stop => ({ ...stop, position: stop.position / visibleGradientEnd }));
    else {
      stops = gradient.stops.filter(stop => stop.position < visibleGradientEnd)
        .map(stop => ({ ...stop, position: stop.position / visibleGradientEnd }));
      const edgeColor = gradientColorAt(gradient.stops, visibleGradientEnd);
      if (!stops.length) stops.push({ color: edgeColor, position: 0 });
      if (stops.at(-1)?.position === 1) stops[stops.length - 1].color = edgeColor;
      else stops.push({ color: edgeColor, position: 1 });
    }
    if (stops.length > MAX_GRADIENT_STOPS) fail('unsupported-gradient', 'The mapped SVG radial gradient needs too many stops for an editable fill.', 'radialGradient');
  }
  return { type: gradient.type, angle, stops, alpha: gradient.alpha };
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
        }))
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
  return node.attrs.id ? cleanLayerName(node.attrs.id) : `${node.tag} ${node.serial}`;
}

function svgTextValue(node, style, gradients = new Map()) {
  const runStyleKeys = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textDecoration', 'fill', 'fillAlpha'];
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
  const collect = (parent, inheritedStyle) => {
    for (const item of parent.content || []) {
      if (typeof item === 'string') { pushSegment(item, inheritedStyle); continue; }
      if (['script', 'foreignObject'].includes(item.tag)) fail('active-content', `SVG element <${item.tag}> contains active or embedded content.`, item.tag);
      if (['image', 'use'].includes(item.tag) || Object.hasOwn(item.attrs, 'href') || Object.hasOwn(item.attrs, 'xlink:href')) {
        fail('external-reference', 'SVG text cannot contain linked or embedded elements.', item.tag);
      }
      if (Object.keys(item.attrs).some(key => /^on/i.test(key))) fail('active-content', 'SVG text contains an event handler attribute.', item.tag);
      if (item.tag !== 'tspan') fail('unsupported-text-feature', 'Only nested <tspan> elements with editable text styles are supported inside SVG <text>.', item.tag);
      checkElementAttributes(item);
      if (item.attrs.transform != null) fail('unsupported-text-transform', 'Transforms on SVG tspan elements cannot be preserved as editable text runs.', 'tspan');
      const runStyle = parseStyle(item, inheritedStyle, gradients);
      validateTspanStyle(runStyle);
      collect(item, runStyle);
    }
  };
  collect(node, style);
  const rawValue = segments.map(segment => segment.text).join('').replace(/\r\n?/g, '\n');
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
      for (const character of segment.text.replace(/\r\n?/g, '\n')) {
        if (/[\t\n\r ]/.test(character)) { pendingSpaceStyle ||= segment.style; continue; }
        if (pendingSpaceStyle && normalized.length) append(' ', pendingSpaceStyle);
        pendingSpaceStyle = null;
        append(character, segment.style);
      }
    }
  } else {
    for (const segment of segments) {
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
      ['fontFamily', 'fontFamily'], ['fontSize', 'fontSize'], ['fontWeight', 'fontWeight'], ['fontStyle', 'fontStyle'],
      ['lineHeight', 'lineHeight'], ['letterSpacing', 'letterSpacing'], ['textDecoration', 'textDecoration']
    ]) if (!Object.is(segment.style[source], style[source])) run[target] = segment.style[source];
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
    color: style.fill || '#000000', fillOpacity: style.fill ? style.fillColorAlpha * style.fillOpacityValue : 0,
    align: anchor, verticalAlign: 'top', textCase: style.textCase, textDecoration: style.textDecoration,
    ...(hasStyledRuns ? { textRuns: textRuns.map(run => ({ ...run,
      ...(run.fontSize != null ? { fontSize: run.fontSize * scale } : {}),
      ...(run.letterSpacing != null ? { letterSpacing: run.letterSpacing * scale } : {}),
      ...(run.lineHeight != null ? { lineHeight: run.lineHeight } : {})
    })) } : {}),
    stroke: null, strokeWidth: 0, children: []
  });
}

function buildTree(node, parentMatrix, parentStyle, prefix, counter, budget, gradients) {
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
  if (Object.hasOwn(node.attrs, NETWORK_METADATA_ATTRIBUTE)) {
    return [importedNetwork(node, matrix, style, prefix, counter, node.attrs[NETWORK_METADATA_ATTRIBUTE])];
  }
  if (node.tag === 'text') {
    const serial = counter.next++;
    const layer = textLayer(node, style, matrix, prefix, serial, gradients);
    return layer ? [layer] : [];
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
    return output;
  }
  const childLayers = [];
  for (const child of node.children) childLayers.push(...buildTree(child, matrix, style, prefix, counter, budget, gradients));
  if (!childLayers.length) {
    if (!style.visible) return [];
    const group = createNode('group', {
      id: `${prefix}-${counter.next++}`, name: cleanLayerName(localName(node)), x: 0, y: 0, width: 0, height: 0,
      opacity: style.opacity, children: []
    });
    return [group];
  }
  const bounds = boundsOf(childLayers);
  for (const child of childLayers) translateLayer(child, bounds.x, bounds.y);
  const group = createNode('group', {
    id: `${prefix}-${counter.next++}`, name: cleanLayerName(localName(node)), x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height, opacity: style.opacity, fill: 'transparent', children: childLayers
  });
  return [group];
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
  const gradients = collectGradients(root);
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
  for (const child of root.children) children.push(...buildTree(child, transformedRootMatrix, style, prefix, counter, budget, gradients));
  const layers = [];
  for (const child of children) layers.push(translateLayer(child, 0, 0));
  const rootLayer = createNode('frame', {
    id: `${prefix}-root`, name: cleanLayerName(root.attrs.id || 'Imported SVG'), x: 0, y: 0, width, height,
    fill: 'transparent', opacity: style.opacity, stroke: null, strokeWidth: 0, clip: true, children: layers
  });
  const validationDocument = createDocument();
  validationDocument.pages[0].children = [rootLayer];
  validateDocument(validationDocument);
  return { width, height, viewBox: viewBox ? [...viewBox] : [0, 0, width, height], nodes: [rootLayer] };
}
