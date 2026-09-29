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
const initialStyle = {
  fill: '#000000', fillAlpha: 1, fillColorAlpha: 1, fillOpacityValue: 1,
  stroke: null, strokeAlpha: 1, strokeColorAlpha: 1, strokeOpacityValue: 1, strokeWidth: 1,
  strokeLinecap: 'butt', strokeLinejoin: 'miter', fillRule: 'nonzero', opacity: 1,
  display: true, visibility: 'visible', visible: true
};

function fail(code, message, element = null) {
  throw new SvgImportError(code, message, element);
}

function decodeXml(value, element) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(value)) fail('invalid-xml', 'SVG contains an unescaped ampersand in an attribute.', element);
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
    if (!Number.isInteger(codePoint) || codePoint === 0 || codePoint > 0x10ffff
      || codePoint >= 0xd800 && codePoint <= 0xdfff
      || codePoint < 0x20 && ![9, 10, 13].includes(codePoint)) {
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
    if (text.slice(cursor, open).trim()) {
      const context = stack.at(-1)?.tag;
      if (['script', 'foreignObject'].includes(context)) fail('active-content', `SVG element <${context}> contains active or embedded content.`, context);
      fail('unsupported-text', 'SVG text content is unsupported; import outlined vector shapes instead.', context);
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
        fail('unsupported-text', 'SVG text content is unsupported; import outlined vector shapes instead.', context);
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
    stack.at(-1).children.push(node);
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

const inheritedProperties = new Set(['fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'color', 'visibility']);
const styleProperties = new Set([...inheritedProperties, 'opacity', 'display', 'visibility']);

function parseStyle(node, parentStyle) {
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
        const parsed = color(value, node.tag); values.fill = parsed.value; values.fillColorAlpha = parsed.alpha; break;
      }
      case 'stroke': {
        const parsed = color(value, node.tag); values.stroke = parsed.value; values.strokeColorAlpha = parsed.alpha; break;
      }
      case 'fill-opacity': values.fillOpacityValue = parseAlpha(value, key, node.tag); break;
      case 'stroke-opacity': values.strokeOpacityValue = parseAlpha(value, key, node.tag); break;
      case 'stroke-width': values.strokeWidth = length(value, key, node.tag); break;
      case 'opacity': values.opacity = parseAlpha(value, key, node.tag); break;
      case 'stroke-linecap':
        if (!['butt', 'round', 'square'].includes(value)) fail('invalid-stroke', 'SVG stroke-linecap must be butt, round, or square.', node.tag);
        if (value !== 'butt') fail('unsupported-stroke-style', `SVG stroke-linecap “${value}” cannot be represented by the editor.`, node.tag);
        values.strokeLinecap = value; break;
      case 'stroke-linejoin':
        if (!['miter', 'round', 'bevel'].includes(value)) fail('invalid-stroke', 'SVG stroke-linejoin must be miter, round, or bevel.', node.tag);
        if (value !== 'miter') fail('unsupported-stroke-style', `SVG stroke-linejoin “${value}” cannot be represented by the editor.`, node.tag);
        values.strokeLinejoin = value; break;
      case 'stroke-miterlimit': {
        const limit = finiteNumber(value, key, node.tag, { min: 1, max: 1000 });
        if (limit !== 10) fail('unsupported-stroke-style', 'The editor cannot preserve a custom SVG stroke-miterlimit.', node.tag);
        break;
      }
      case 'fill-rule':
        if (!['nonzero', 'evenodd'].includes(value)) fail('invalid-fill-rule', 'SVG fill-rule must be nonzero or evenodd.', node.tag);
        if (value !== 'nonzero') fail('unsupported-fill-rule', 'Even-odd SVG fills cannot be represented by the current vector path model.', node.tag);
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
  if (!Object.hasOwn(declarations, 'fill')) { values.fill = parentStyle.fill; values.fillColorAlpha = parentStyle.fillColorAlpha; }
  if (!Object.hasOwn(declarations, 'stroke')) { values.stroke = parentStyle.stroke; values.strokeColorAlpha = parentStyle.strokeColorAlpha; }
  if (!Object.hasOwn(declarations, 'fill-opacity')) values.fillOpacityValue = parentStyle.fillOpacityValue;
  if (!Object.hasOwn(declarations, 'stroke-opacity')) values.strokeOpacityValue = parentStyle.strokeOpacityValue;
  if (!Object.hasOwn(declarations, 'stroke-width')) values.strokeWidth = parentStyle.strokeWidth;
  if (!Object.hasOwn(declarations, 'stroke-linecap')) values.strokeLinecap = parentStyle.strokeLinecap;
  if (!Object.hasOwn(declarations, 'stroke-linejoin')) values.strokeLinejoin = parentStyle.strokeLinejoin;
  if (!Object.hasOwn(declarations, 'fill-rule')) values.fillRule = parentStyle.fillRule;
  values.fillAlpha = values.fillColorAlpha * values.fillOpacityValue;
  values.strokeAlpha = values.strokeColorAlpha * values.strokeOpacityValue;
  values.visible = values.visibility === 'visible';
  return values;
}

const geomAttrs = {
  svg: new Set(['xmlns', 'version', 'width', 'height', 'viewBox', 'preserveAspectRatio']),
  g: new Set(),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry']),
  circle: new Set(['cx', 'cy', 'r']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
  line: new Set(['x1', 'y1', 'x2', 'y2']),
  polyline: new Set(['points']), polygon: new Set(['points']), path: new Set(['d'])
};
const commonAttrs = new Set([
  'id', 'transform', 'style', 'fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'opacity', 'display', 'visibility', 'color', 'class',
  'href', 'xlink:href', 'xml:space', 'role', 'focusable'
]);

function checkElementAttributes(node) {
  const allowed = geomAttrs[node.tag];
  for (const key of Object.keys(node.attrs)) {
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
  const points = [];
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
    if (points.length) fail('unsupported-compound-path', 'SVG paths with multiple subpaths cannot be represented without changing fill holes.', element);
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
  if (points.length < 2) fail('invalid-path', 'SVG path needs at least two points.', element);
  return [{ points, closed }];
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
  for (const point of subpath.points) {
    include(mapPoint(matrix, point));
    if (point.in) include(mapPoint(matrix, { x: point.x + point.in.x, y: point.y + point.in.y }));
    if (point.out) include(mapPoint(matrix, { x: point.x + point.out.x, y: point.y + point.out.y }));
  }
  const actualWidth = maxX - minX; const actualHeight = maxY - minY;
  const width = actualWidth || 1; const height = actualHeight || 1;
  for (const point of subpath.points) {
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
    closed: subpath.closed, points: subpath.points, children: []
  });
  return { base, strokeWidth: style.strokeWidth * (scale ?? 1) };
}

function createPaintLayers(base, style, strokeWidth, prefix, serial, name, { fillAllowed = true } = {}) {
  const fillVisible = fillAllowed && style.fill && style.fillAlpha > 0;
  const strokeVisible = style.stroke && strokeWidth > 0 && style.strokeAlpha > 0;
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
    fillNode.fill = style.fill;
    fillNode.fillOpacity = style.fillAlpha;
    fillNode.closed = true;
    strokeNode.id = `${prefix}-${serial}-stroke`;
    strokeNode.name = `${cleanLayerName(name)} stroke`;
    strokeNode.x = 0;
    strokeNode.y = 0;
    strokeNode.opacity = style.strokeAlpha;
    strokeNode.fill = 'transparent';
    strokeNode.fillOpacity = 0;
    strokeNode.stroke = style.stroke;
    strokeNode.strokeWidth = strokeWidth;
    group.children = [fillNode, strokeNode];
    return [group];
  }
  const node = { ...base, id: `${prefix}-${serial}`, opacity: style.opacity, fill: 'transparent', stroke: null, strokeWidth: 0 };
  if (fillVisible) { node.fill = style.fill; node.fillOpacity = style.fillAlpha; node.closed = true; }
  if (strokeVisible) { node.stroke = style.stroke; node.strokeWidth = strokeWidth; node.opacity *= style.strokeAlpha; }
  return [node];
}

function boundsOf(nodes) {
  const visible = nodes.filter(node => node.width >= 0 && node.height >= 0);
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

function buildTree(node, parentMatrix, parentStyle, prefix, counter, budget) {
  if (node.tag === 'svg' && node !== counter.root) fail('unsupported-nested-svg', 'Nested <svg> viewports are not supported.', 'svg');
  const unsafe = new Set(['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'style', 'image', 'use', 'a']);
  if (unsafe.has(node.tag)) {
    const code = ['script', 'foreignObject'].includes(node.tag) ? 'active-content' : ['image', 'use'].includes(node.tag) ? 'external-reference' : 'unsupported-element';
    fail(code, `SVG element <${node.tag}> is not accepted.`, node.tag);
  }
  if (!geomAttrs[node.tag]) fail('unsupported-element', `SVG element <${node.tag}> is not supported.`, node.tag);
  checkElementAttributes(node);
  const style = parseStyle(node, parentStyle);
  if (!style.display || (node.tag !== 'g' && node.tag !== 'svg' && !style.visible)) return [];
  const matrix = matrixMultiply(parentMatrix, parseTransform(node.attrs.transform, node.tag));
  if (node.tag !== 'g' && node.tag !== 'svg') {
    const paths = elementPaths(node, budget);
    const output = [];
    for (const path of paths) {
      const name = localName(node);
      const { base, strokeWidth } = makePathNode(path, style, matrix, prefix, name);
      output.push(...createPaintLayers(base, style, strokeWidth, prefix, counter.next++, name, { fillAllowed: !path.noFill }));
    }
    return output;
  }
  const childLayers = [];
  for (const child of node.children) childLayers.push(...buildTree(child, matrix, style, prefix, counter, budget));
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
  const style = parseStyle(root, initialStyle);
  const children = [];
  for (const child of root.children) children.push(...buildTree(child, transformedRootMatrix, style, prefix, counter, budget));
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
