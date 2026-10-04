const encoder = new TextEncoder();
import { decodePdfImageDataUri, PdfImageFormatError } from './pdf-image.js';

const LIMITS = Object.freeze({
  maxPages: 100,
  maxPageDimension: 14_400,
  maxCoordinate: 10_000_000,
  maxPageSvgCharacters: 64 * 1024 * 1024,
  maxAggregateSvgCharacters: 128 * 1024 * 1024,
  maxTransparencyGroups: 10_000,
  maxOutputBytes: 512 * 1024 * 1024,
});

/**
 * A fail-closed PDF writer for the self-contained SVG emitted by svg-export.js.
 * It keeps supported geometry as PDF paths and shading functions (never
 * screenshots the page). Paths, solid paints, gradients, clips, and embedded
 * PNG/JPEG image XObjects and isolated group-opacity forms remain editable PDF
 * objects. Printable ASCII text with simple positioned lines uses standard
 * Helvetica PDF fonts; custom fonts, rich text, gradient strokes, filters,
 * luminance masks, and blend modes are rejected with feature-specific errors.
 */
export class PdfVectorExportError extends TypeError {
  constructor(feature, detail = '') {
    super(`Vector PDF export does not support ${feature}${detail ? `: ${detail}` : '.'}`);
    this.name = 'PdfVectorExportError';
    this.feature = feature;
  }
}

/** Fail before SVG conversion when a source-layer effect cannot survive vector PDF. */
export function assertVectorPdfEffectsSupported(node) {
  if (node?.effects?.some(effect => effect?.type === 'noise' && effect.visible !== false)) {
    throw new PdfVectorExportError('noise effects', `layer “${node.name || 'Layer'}” cannot be represented; hide/remove the noise effect or use raster PDF`);
  }
  if (node?.effects?.some(effect => effect?.type === 'texture' && effect.visible !== false)) {
    throw new PdfVectorExportError('texture effects', `layer “${node.name || 'Layer'}” cannot be represented; use raster PDF or hide/remove the texture effect`);
  }
  return true;
}

function fail(feature, detail) {
  throw new PdfVectorExportError(feature, detail);
}

function finite(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > LIMITS.maxCoordinate) {
    throw new RangeError(`Vector PDF export requires a finite ${label} within ±${LIMITS.maxCoordinate}.`);
  }
  return result;
}

function pdfNumber(value) {
  const rounded = Math.abs(value) < 1e-12 ? 0 : Number(value.toPrecision(12));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function decodeXml(text) {
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '&') { output += text[index]; continue; }
    const end = text.indexOf(';', index + 1);
    if (end < 0) throw new TypeError('SVG contains an unterminated XML entity.');
    const entity = text.slice(index + 1, end);
    if (entity === 'amp') output += '&';
    else if (entity === 'lt') output += '<';
    else if (entity === 'gt') output += '>';
    else if (entity === 'quot') output += '"';
    else if (entity === 'apos') output += "'";
    else if (/^#(?:x[0-9a-f]+|\d+)$/i.test(entity)) {
      const code = entity[1].toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      if (!Number.isInteger(code) || !(code === 0x9 || code === 0xa || code === 0xd
        || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd)
        || (code >= 0x10000 && code <= 0x10ffff))) {
        throw new TypeError('SVG contains an invalid XML character reference.');
      }
      output += String.fromCodePoint(code);
    } else throw new TypeError(`SVG contains an unsupported XML entity &${entity};.`);
    index = end;
  }
  return output;
}

function parseAttributes(source) {
  const attributes = Object.create(null);
  let cursor = 0;
  const pattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/gy;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    if (cursor >= source.length || source[cursor] === '/') break;
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match) throw new TypeError('SVG contains malformed attributes.');
    const name = match[1];
    if (Object.hasOwn(attributes, name)) throw new TypeError(`SVG repeats the ${name} attribute.`);
    attributes[name] = decodeXml(match[3] ?? match[4] ?? '');
    cursor = pattern.lastIndex;
  }
  return attributes;
}

function assertAttributes(node, allowed) {
  for (const name of Object.keys(node.attributes || {})) {
    if (allowed.has(name) || name.startsWith('data-')) continue;
    fail(`SVG <${node.name}> attribute ${name}`, 'the attribute has no PDF mapping');
  }
}

const paintAttributes = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray'
]);
const shapeAttributes = {
  path: new Set(['d', ...paintAttributes]),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry', ...paintAttributes]),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry', ...paintAttributes]),
  polygon: new Set(['points', ...paintAttributes]),
};

function parseSvg(svg) {
  if (typeof svg !== 'string' || !svg.trim()) throw new TypeError('Vector PDF export requires an SVG string.');
  if (svg.length > LIMITS.maxPageSvgCharacters) throw new RangeError(`SVG page exceeds ${LIMITS.maxPageSvgCharacters} characters.`);
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) throw new TypeError('SVG document types and custom entities are not accepted.');
  const root = { name: '#document', attributes: Object.create(null), children: [] };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g;
  let cursor = 0;
  for (const match of svg.matchAll(token)) {
    if (match.index !== cursor) throw new TypeError('SVG contains malformed XML.');
    cursor += match[0].length;
    const value = match[0];
    if (value.startsWith('<!--') || value.startsWith('<?')) continue;
    if (value.startsWith('</')) {
      const name = value.slice(2, -1).trim();
      if (stack.length === 1 || stack.at(-1).name !== name) throw new TypeError('SVG elements are not properly nested.');
      stack.pop();
      continue;
    }
    if (value.startsWith('<')) {
      const selfClosing = /\/\s*>$/.test(value);
      const inner = value.slice(1, selfClosing ? value.lastIndexOf('/') : -1).trim();
      const split = inner.search(/\s/);
      const name = split < 0 ? inner : inner.slice(0, split);
      const attributeSource = split < 0 ? '' : inner.slice(split + 1);
      if (!/^[A-Za-z][A-Za-z0-9:_-]*$/.test(name)) throw new TypeError('SVG contains an invalid element name.');
      const node = { name, attributes: parseAttributes(attributeSource), children: [] };
      stack.at(-1).children.push(node);
      if (!selfClosing) {
        if (stack.length >= 256) throw new RangeError('SVG nesting exceeds the supported depth of 256 elements.');
        stack.push(node);
      }
      continue;
    }
    if (value.trim()) stack.at(-1).children.push({ name: '#text', text: decodeXml(value), children: [] });
  }
  if (cursor !== svg.length || stack.length !== 1) throw new TypeError('SVG contains incomplete XML.');
  if (root.children.length !== 1 || root.children[0].name !== 'svg') throw new TypeError('Vector PDF export requires one SVG root element.');
  return root.children[0];
}

function parseRoot(svgRoot) {
  assertAttributes(svgRoot, new Set(['xmlns', 'width', 'height', 'viewBox']));
  const rawViewBox = (svgRoot.attributes.viewBox || '').trim().split(/[\s,]+/).map(Number);
  if (rawViewBox.length !== 4 || !rawViewBox.every(Number.isFinite) || rawViewBox[2] <= 0 || rawViewBox[3] <= 0) {
    throw new TypeError('Vector PDF export requires a positive four-number SVG viewBox.');
  }
  const viewBox = rawViewBox.map(value => finite(value, 'viewBox coordinate'));
  const parseLength = (value, label) => {
    const match = /^(\d+(?:\.\d*)?|\.\d+)(?:px)?$/.exec(String(value || ''));
    if (!match) throw new TypeError(`Vector PDF export requires SVG ${label} in pixels.`);
    return finite(match[1], label);
  };
  const width = parseLength(svgRoot.attributes.width, 'width');
  const height = parseLength(svgRoot.attributes.height, 'height');
  if (width <= 0 || height <= 0 || width > LIMITS.maxPageDimension || height > LIMITS.maxPageDimension) {
    throw new RangeError(`Vector PDF page dimensions must be between 0 and ${LIMITS.maxPageDimension} points.`);
  }
  return { viewBox, width, height };
}

function gradientOffset(value) {
  const text = String(value ?? '');
  const percent = text.endsWith('%');
  const parsed = Number(percent ? text.slice(0, -1) : text);
  const offset = percent ? parsed / 100 : parsed;
  if (!Number.isFinite(offset) || offset < 0 || offset > 1) {
    throw new TypeError('SVG gradient stop offsets must be between 0 and 1.');
  }
  return offset;
}

function gradientCoordinate(value, label) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(value ?? ''))) {
    fail('non-numeric gradient coordinates', 'only unitless userSpaceOnUse coordinates from the editor are supported');
  }
  return finite(value, label);
}

function parseGradientTransform(value) {
  if (value == null || value === '') return null;
  const match = /^matrix\(\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)\s*\)$/.exec(value);
  if (!match) fail('gradientTransform', 'only a finite, invertible SVG matrix(a b c d e f) is supported');
  const matrix = match.slice(1).map((component, index) => finite(component, `gradient transform component ${index + 1}`));
  const [a, b, c, d] = matrix;
  if (a * d - b * c === 0) fail('singular gradientTransform', 'the affine gradient basis must be invertible');
  return matrix;
}

function parseGradient(definition) {
  const linear = definition.name === 'linearGradient';
  assertAttributes(definition, new Set([
    'id', 'gradientUnits', 'gradientTransform', 'spreadMethod',
    ...(linear ? ['x1', 'y1', 'x2', 'y2'] : ['cx', 'cy', 'r', 'fx', 'fy', 'fr']),
  ]));
  if (definition.attributes.gradientUnits !== 'userSpaceOnUse') {
    fail('object-bounding-box gradients', 'Tiny Image Star exports userSpaceOnUse gradient coordinates');
  }
  // Preserve the editor's affine gradient basis. PDF's shading coordinates
  // remain in this canonical space and the matrix is applied when the
  // shading is painted, inside the shape's already-established clip.
  const transform = parseGradientTransform(definition.attributes.gradientTransform);
  const spreadMethod = definition.attributes.spreadMethod || 'pad';
  if (spreadMethod !== 'pad') fail(`${spreadMethod} gradient spread`, 'only SVG pad extension is supported');
  const coordinates = linear
    ? ['x1', 'y1', 'x2', 'y2'].map(key => gradientCoordinate(definition.attributes[key], `gradient ${key}`))
    : ['cx', 'cy', 'r'].map(key => gradientCoordinate(definition.attributes[key], `radial gradient ${key}`));
  if (!linear && coordinates[2] <= 0) throw new TypeError('Radial SVG gradients require a positive radius.');
  // Tiny Image Star emits concentric radial gradients (one center, inner
  // radius zero). Other SVG focal-circle forms do not map directly to this
  // editor's supported radial gradient model.
  if (!linear && (definition.attributes.fx != null || definition.attributes.fy != null || definition.attributes.fr != null)) {
    fail('off-center or two-circle radial gradients', 'only the editor radial gradient with one center and zero inner radius is supported');
  }
  const stops = [];
  for (const child of definition.children) {
    if (child.name === '#text') continue;
    if (child.name !== 'stop') fail(`gradient child <${child.name}>`);
    assertAttributes(child, new Set(['offset', 'stop-color', 'stop-opacity']));
    if (child.children.length) throw new TypeError('SVG gradient stops must be empty elements.');
    if (child.attributes['stop-opacity'] != null && Number(child.attributes['stop-opacity']) !== 1) {
      fail('gradient stop alpha', 'PDF color shadings require opaque stops; shape fill opacity is supported separately');
    }
    const color = child.attributes['stop-color'];
    const components = colorComponents(color, 'gradient stop');
    const position = gradientOffset(child.attributes.offset);
    if (stops.length && position <= stops.at(-1).position) {
      if (position === stops.at(-1).position) fail('duplicate gradient stop offsets', 'PDF stitching functions require strictly increasing bounds');
      throw new TypeError('SVG gradient stop offsets must preserve their nondecreasing order.');
    }
    stops.push({ position, components });
  }
  if (stops.length < 2 || stops.length > 8) {
    throw new TypeError('Vector PDF export requires gradients with between 2 and 8 color stops.');
  }
  const segments = [];
  const bounds = [];
  const first = stops[0];
  const last = stops.at(-1);
  if (first.position > 0) {
    segments.push({ c0: first.components, c1: first.components });
    bounds.push(first.position);
  }
  for (let index = 0; index < stops.length - 1; index += 1) {
    const left = stops[index];
    const right = stops[index + 1];
    segments.push({ c0: left.components, c1: right.components });
    if (right.position < 1) bounds.push(right.position);
  }
  if (last.position < 1) segments.push({ c0: last.components, c1: last.components });
  return { type: linear ? 'linear' : 'radial', coordinates, segments, bounds, transform };
}

function maskRegion(node) {
  const attrs = node.attributes;
  const parseRegion = (value, label) => {
    if (value == null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
      fail('mask region units', 'only explicit user-space numeric regions are supported');
    }
    return finite(value, label);
  };
  if ((attrs.maskUnits || 'objectBoundingBox') !== 'userSpaceOnUse'
    || (attrs.maskContentUnits && attrs.maskContentUnits !== 'userSpaceOnUse')) {
    fail('object-bounding-box masks', 'only userSpaceOnUse mask regions and contents are supported');
  }
  const x = parseRegion(attrs.x, 'mask region x');
  const y = parseRegion(attrs.y, 'mask region y');
  const width = parseRegion(attrs.width, 'mask region width');
  const height = parseRegion(attrs.height, 'mask region height');
  if (width <= 0 || height <= 0) throw new TypeError('SVG mask regions must have positive dimensions.');
  return { x, y, width, height };
}

function scanDefinitions(svgRoot) {
  const clips = new Map();
  const gradients = new Map();
  const masks = new Map();
  const ids = new Set();
  const collect = (node) => {
    if (node.name === 'defs') {
      assertAttributes(node, new Set());
      for (const definition of node.children) {
        if (definition.name === '#text') continue;
        if (definition.name === 'clipPath') {
          assertAttributes(definition, new Set(['id', 'clipPathUnits']));
          const id = definition.attributes.id;
          if (!id || ids.has(id)) throw new TypeError('SVG definitions require unique IDs.');
          ids.add(id);
          if (definition.attributes.clipPathUnits && definition.attributes.clipPathUnits !== 'userSpaceOnUse') {
            fail('object-bounding-box clipping', 'only userSpaceOnUse clip paths are supported');
          }
          const shapes = definition.children.filter(child => child.name !== '#text');
          if (shapes.length !== 1) fail('compound clip paths', 'one vector shape per clip path is supported');
          clips.set(id, shapes[0]);
        } else if (definition.name === 'linearGradient' || definition.name === 'radialGradient') {
          const id = definition.attributes.id;
          if (!id || ids.has(id)) throw new TypeError('SVG definitions require unique IDs.');
          ids.add(id);
          gradients.set(id, parseGradient(definition));
        } else if (definition.name === 'filter') {
          fail('layer effects', 'SVG filter effects cannot be preserved by the current PDF writer');
        } else if (definition.name === 'mask') {
          assertAttributes(definition, new Set([
            'id', 'maskUnits', 'maskContentUnits', 'mask-type', 'x', 'y', 'width', 'height'
          ]));
          const id = definition.attributes.id;
          if (!id || ids.has(id)) throw new TypeError('SVG definitions require unique IDs.');
          ids.add(id);
          if ((definition.attributes['mask-type'] || 'luminance') !== 'alpha') {
            fail('luminance masks', 'PDF export supports alpha masks only');
          }
          masks.set(id, { node: definition, region: maskRegion(definition) });
        } else {
          fail(`SVG definition <${definition.name}>`);
        }
      }
      return;
    }
    if (node.children) node.children.forEach(collect);
  };
  collect(svgRoot);
  return { clips, gradients, masks };
}

function parseOpacity(value, feature) {
  const result = value == null ? 1 : Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 1) throw new TypeError(`SVG has invalid ${feature}.`);
  return result;
}

function colorComponents(value, feature = 'paint') {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) fail(`${feature} color ${JSON.stringify(value)}`, 'only hexadecimal solid colors are supported');
  const hex = match[1].length === 3 ? [...match[1]].map(part => part + part).join('') : match[1];
  return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function colorOperator(value, feature) {
  if (value == null || value === 'none') return null;
  if (value.startsWith('url(')) fail('gradient paints', 'expected a supported vector gradient reference');
  const values = colorComponents(value, feature);
  return `${values.map(pdfNumber).join(' ')} ${feature === 'fill' ? 'rg' : 'RG'}`;
}

function tokenizePath(value) {
  const tokens = [];
  const pattern = /\s+|,|([A-Za-z])|([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?)/gy;
  let cursor = 0;
  while (cursor < value.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(value);
    if (!match) throw new TypeError('SVG path data contains an unsupported token.');
    cursor = pattern.lastIndex;
    if (match[1]) tokens.push(match[1]);
    else if (match[2]) tokens.push(finite(match[2], 'path coordinate'));
  }
  return tokens;
}

function pathOperators(data, { closeOpen = false } = {}) {
  const tokens = tokenizePath(data);
  const output = [];
  let index = 0;
  let command = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let open = false;
  const take = () => {
    const value = tokens[index++];
    if (typeof value !== 'number') throw new TypeError('SVG path command has too few coordinates.');
    return value;
  };
  while (index < tokens.length) {
    if (typeof tokens[index] === 'string') command = tokens[index++];
    if (!command) throw new TypeError('SVG path data must begin with a command.');
    if (command === 'M') {
      x = take(); y = take(); startX = x; startY = y; open = true;
      output.push(`${pdfNumber(x)} ${pdfNumber(y)} m`);
      command = 'L';
    } else if (command === 'L') {
      x = take(); y = take(); open = true;
      output.push(`${pdfNumber(x)} ${pdfNumber(y)} l`);
    } else if (command === 'C') {
      const x1 = take(); const y1 = take(); const x2 = take(); const y2 = take();
      x = take(); y = take(); open = true;
      output.push(`${pdfNumber(x1)} ${pdfNumber(y1)} ${pdfNumber(x2)} ${pdfNumber(y2)} ${pdfNumber(x)} ${pdfNumber(y)} c`);
    } else if (command === 'Q') {
      const controlX = take(); const controlY = take();
      const endX = take(); const endY = take();
      // PDF has no quadratic path operator. Convert the SVG quadratic segment
      // exactly to its equivalent cubic Bézier using the current point and end.
      const firstControlX = x + (2 / 3) * (controlX - x);
      const firstControlY = y + (2 / 3) * (controlY - y);
      const secondControlX = endX + (2 / 3) * (controlX - endX);
      const secondControlY = endY + (2 / 3) * (controlY - endY);
      x = endX; y = endY; open = true;
      output.push(`${pdfNumber(firstControlX)} ${pdfNumber(firstControlY)} ${pdfNumber(secondControlX)} ${pdfNumber(secondControlY)} ${pdfNumber(x)} ${pdfNumber(y)} c`);
    } else if (command === 'Z' || command === 'z') {
      output.push('h'); x = startX; y = startY; open = false; command = null;
    } else {
      fail(`SVG path command ${command}`, 'only absolute M, L, Q, C, and Z commands are supported');
    }
  }
  if (closeOpen && open) output.push('h');
  return output.join('\n');
}

function rectPath(attributes) {
  const x = finite(attributes.x ?? 0, 'rectangle x');
  const y = finite(attributes.y ?? 0, 'rectangle y');
  const width = finite(attributes.width, 'rectangle width');
  const height = finite(attributes.height, 'rectangle height');
  if (width < 0 || height < 0) throw new TypeError('SVG rectangles cannot have negative dimensions.');
  const rx = Math.min(width / 2, Math.max(0, finite(attributes.rx ?? attributes.ry ?? 0, 'rectangle x radius')));
  const ry = Math.min(height / 2, Math.max(0, finite(attributes.ry ?? attributes.rx ?? 0, 'rectangle y radius')));
  if (!rx || !ry) return `${pdfNumber(x)} ${pdfNumber(y)} m ${pdfNumber(x + width)} ${pdfNumber(y)} l ${pdfNumber(x + width)} ${pdfNumber(y + height)} l ${pdfNumber(x)} ${pdfNumber(y + height)} l h`;
  const k = 0.5522847498307936;
  return [
    `${pdfNumber(x + rx)} ${pdfNumber(y)} m`,
    `${pdfNumber(x + width - rx)} ${pdfNumber(y)} l`,
    `${pdfNumber(x + width - rx + k * rx)} ${pdfNumber(y)} ${pdfNumber(x + width)} ${pdfNumber(y + ry - k * ry)} ${pdfNumber(x + width)} ${pdfNumber(y + ry)} c`,
    `${pdfNumber(x + width)} ${pdfNumber(y + height - ry)} l`,
    `${pdfNumber(x + width)} ${pdfNumber(y + height - ry + k * ry)} ${pdfNumber(x + width - rx + k * rx)} ${pdfNumber(y + height)} ${pdfNumber(x + width - rx)} ${pdfNumber(y + height)} c`,
    `${pdfNumber(x + rx)} ${pdfNumber(y + height)} l`,
    `${pdfNumber(x + rx - k * rx)} ${pdfNumber(y + height)} ${pdfNumber(x)} ${pdfNumber(y + height - ry + k * ry)} ${pdfNumber(x)} ${pdfNumber(y + height - ry)} c`,
    `${pdfNumber(x)} ${pdfNumber(y + ry)} l`,
    `${pdfNumber(x)} ${pdfNumber(y + ry - k * ry)} ${pdfNumber(x + rx - k * rx)} ${pdfNumber(y)} ${pdfNumber(x + rx)} ${pdfNumber(y)} c h`,
  ].join('\n');
}

function ellipsePath(attributes) {
  const cx = finite(attributes.cx ?? 0, 'ellipse center x');
  const cy = finite(attributes.cy ?? 0, 'ellipse center y');
  const rx = finite(attributes.rx, 'ellipse radius x');
  const ry = finite(attributes.ry, 'ellipse radius y');
  if (rx < 0 || ry < 0) throw new TypeError('SVG ellipse radii cannot be negative.');
  const k = 0.5522847498307936;
  return [
    `${pdfNumber(cx + rx)} ${pdfNumber(cy)} m`,
    `${pdfNumber(cx + rx)} ${pdfNumber(cy + k * ry)} ${pdfNumber(cx + k * rx)} ${pdfNumber(cy + ry)} ${pdfNumber(cx)} ${pdfNumber(cy + ry)} c`,
    `${pdfNumber(cx - k * rx)} ${pdfNumber(cy + ry)} ${pdfNumber(cx - rx)} ${pdfNumber(cy + k * ry)} ${pdfNumber(cx - rx)} ${pdfNumber(cy)} c`,
    `${pdfNumber(cx - rx)} ${pdfNumber(cy - k * ry)} ${pdfNumber(cx - k * rx)} ${pdfNumber(cy - ry)} ${pdfNumber(cx)} ${pdfNumber(cy - ry)} c`,
    `${pdfNumber(cx + k * rx)} ${pdfNumber(cy - ry)} ${pdfNumber(cx + rx)} ${pdfNumber(cy - k * ry)} ${pdfNumber(cx + rx)} ${pdfNumber(cy)} c h`,
  ].join('\n');
}

function polygonPath(value) {
  const numbers = value.trim().split(/[\s,]+/).filter(Boolean).map(item => finite(item, 'polygon coordinate'));
  if (numbers.length < 4 || numbers.length % 2) throw new TypeError('SVG polygon requires at least two coordinate pairs.');
  const [x, y, ...rest] = numbers;
  const commands = [`${pdfNumber(x)} ${pdfNumber(y)} m`];
  for (let index = 0; index < rest.length; index += 2) commands.push(`${pdfNumber(rest[index])} ${pdfNumber(rest[index + 1])} l`);
  commands.push('h');
  return commands.join('\n');
}

function shapePath(node, { closeOpen = false } = {}) {
  if (shapeAttributes[node.name]) assertAttributes(node, shapeAttributes[node.name]);
  if (node.name === 'path') return pathOperators(node.attributes.d || '', { closeOpen });
  if (node.name === 'rect') return rectPath(node.attributes);
  if (node.name === 'ellipse') return ellipsePath(node.attributes);
  if (node.name === 'polygon') return polygonPath(node.attributes.points || '');
  if (node.name === 'text' || node.name === 'tspan') fail('text layers', 'only simple single-line ASCII text with a standard Helvetica font is supported');
  fail(`SVG element <${node.name}>`);
}

function pdfTextLiteral(value) {
  if (!/^[\x20-\x7e]*$/.test(value)) {
    fail('non-ASCII text', 'only printable ASCII text can be represented by the standard PDF fonts');
  }
  return `(${value.replace(/[\\()]/g, character => `\\${character}`)})`;
}

function textFont(attributes, context) {
  const families = String(attributes['font-family'] || 'Helvetica').split(',')
    .map(family => family.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
  if (!families.length || families.some(family => !['arial', 'helvetica', 'sans-serif'].includes(family))) {
    fail('custom text fonts', 'only Arial, Helvetica, or sans-serif can use the built-in PDF font; use raster PDF to preserve other fonts');
  }
  const weight = String(attributes['font-weight'] || '400').toLowerCase();
  const style = String(attributes['font-style'] || 'normal').toLowerCase();
  if (!['400', 'normal', '700', 'bold'].includes(weight) || !['normal', 'italic'].includes(style)) {
    fail('text font variants', 'only regular, bold, italic, and bold italic standard fonts are supported');
  }
  const bold = weight === '700' || weight === 'bold';
  const standardName = `Helvetica${bold ? '-Bold' : ''}${style === 'italic' ? (bold ? 'Oblique' : '-Oblique') : ''}`;
  if (!context.fontNames.has(standardName)) {
    context.fontNames.set(standardName, `F${context.fontNames.size + 1}`);
    context.fonts.set(context.fontNames.get(standardName), standardName);
  }
  return context.fontNames.get(standardName);
}

function paintText(node, inheritedOpacity, context) {
  const attrs = node.attributes;
  assertAttributes(node, new Set([
    'x', 'y', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
    'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'xml:space',
    'dominant-baseline', 'letter-spacing', 'text-transform',
  ]));
  if ((attrs.stroke != null && attrs.stroke !== 'none') || Number(attrs['stroke-width'] || 0) > 0
    || (attrs['stroke-opacity'] != null && parseOpacity(attrs['stroke-opacity'], 'text stroke opacity') !== 0)) {
    fail('text strokes', 'outlined text requires glyph paths; use raster PDF');
  }
  if (attrs['text-anchor'] != null && attrs['text-anchor'] !== 'start') {
    fail('text alignment', 'only start-aligned SVG text is supported');
  }
  if (attrs['text-transform'] != null) {
    fail('text transformations', 'the text must already contain its final characters; use raster PDF to preserve transformed text');
  }
  if (attrs['xml:space'] != null && attrs['xml:space'] !== 'preserve') {
    fail('SVG text whitespace', 'only preserved SVG text whitespace is supported');
  }
  const letterSpacing = finite(attrs['letter-spacing'] ?? 0, 'text letter spacing');
  if (letterSpacing !== 0) fail('letter spacing', 'the vector PDF text subset currently requires zero letter spacing');
  const hasPositionedLines = node.children.some(child => child.name === 'tspan');
  const hasEditorTextMetrics = attrs['data-tiny-image-star-pdf-ascent'] != null;
  if (hasPositionedLines && !hasEditorTextMetrics) {
    fail('rich text', 'nested tspans need font shaping and run layout');
  }
  if (hasEditorTextMetrics && !hasPositionedLines) {
    fail('text line metrics', 'editor text metrics require positioned line spans');
  }
  if (hasPositionedLines && hasEditorTextMetrics) {
    if (attrs['dominant-baseline'] !== 'text-before-edge') {
      fail('text baseline placement', 'positioned editor text needs dominant-baseline="text-before-edge"');
    }
    const ascent = finite(attrs['data-tiny-image-star-pdf-ascent'], 'measured text ascent');
    if (ascent <= 0) fail('text baseline placement', 'the editor did not provide a positive standard-font ascent; use raster PDF');
    if (node.children.some(child => child.name !== 'tspan')) {
      fail('rich text', 'positioned lines cannot mix direct text and nested spans');
    }
    const size = finite(attrs['font-size'] ?? 16, 'font size');
    if (size <= 0) throw new TypeError('SVG text font size must be positive.');
    const fill = colorOperator(attrs.fill ?? '#000000', 'fill');
    if (!fill) return '';
    const alpha = inheritedOpacity * parseOpacity(attrs['fill-opacity'], 'text fill opacity');
    const state = alphaState(alpha, 1, context.stateNames);
    const font = textFont(attrs, context);
    const commands = [];
    for (const line of node.children) {
      assertAttributes(line, new Set(['x', 'y', 'text-anchor', 'textLength', 'lengthAdjust']));
      if (line.attributes['data-tiny-image-star-list-marker'] != null) {
        fail('paragraph lists', 'list marker spans need rich text positioning');
      }
      if (line.children.some(child => child.name !== '#text')) {
        fail('rich text', 'nested styled spans need font shaping and per-run positioning');
      }
      if (line.attributes['text-anchor'] != null && line.attributes['text-anchor'] !== 'start') {
        fail('text alignment', 'only left-aligned positioned lines are supported; use raster PDF for other alignments');
      }
      const value = line.children.map(child => child.text).join('');
      if (!value) continue;
      const literal = pdfTextLiteral(value);
      const x = finite(line.attributes.x, 'text line x');
      const y = finite(line.attributes.y, 'text line y') + ascent;
      let horizontalScale = 100;
      if (line.attributes.textLength != null) {
        if (line.attributes.lengthAdjust !== 'spacingAndGlyphs') {
          fail('text length adjustment', 'only spacingAndGlyphs can map to a PDF text scale');
        }
        const desiredWidth = finite(line.attributes.textLength, 'text line width');
        if (line.attributes['data-tiny-image-star-pdf-width'] == null) {
          fail('text line metrics', 'the editor did not provide the built-in Helvetica width; use raster PDF');
        }
        const standardFontWidth = finite(line.attributes['data-tiny-image-star-pdf-width'], 'standard-font text width');
        if (desiredWidth <= 0 || standardFontWidth <= 0) {
          fail('text line metrics', 'the editor could not provide positive standard-font line measurements; use raster PDF');
        }
        horizontalScale = desiredWidth / standardFontWidth * 100;
        if (!Number.isFinite(horizontalScale) || horizontalScale < 1 || horizontalScale > 10_000) {
          fail('text line metrics', 'the requested line width is outside the supported PDF text scale');
        }
      }
      // SVG positions lines from the top edge. The editor supplies the
      // standard Helvetica ascent measured in the same browser, and the PDF
      // text matrix then places the alphabetic baseline at that resolved point.
      commands.push(
        'q', `1 0 0 -1 0 ${pdfNumber(2 * y)} cm`, fill, state,
        'BT', `/${font} ${pdfNumber(size)} Tf`, `${pdfNumber(horizontalScale)} Tz`,
        `1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm`, `${literal} Tj`, 'ET', 'Q'
      );
    }
    return commands.flat().filter(Boolean).join('\n');
  }
  if (node.children.some(child => child.name !== '#text')) {
    fail('rich text', 'nested tspans and text paths need font shaping and run layout');
  }
  const value = node.children.map(child => child.text).join('');
  const literal = pdfTextLiteral(value);
  const x = finite(attrs.x, 'text x');
  const y = finite(attrs.y, 'text y');
  const size = finite(attrs['font-size'] ?? 16, 'font size');
  if (size <= 0) throw new TypeError('SVG text font size must be positive.');
  const fill = colorOperator(attrs.fill ?? '#000000', 'fill');
  if (!fill) return '';
  const alpha = inheritedOpacity * parseOpacity(attrs['fill-opacity'], 'text fill opacity');
  const state = alphaState(alpha, 1, context.stateNames);
  const font = textFont(attrs, context);
  // The SVG viewport CTM flips Y. Flip locally around the text baseline to keep
  // glyphs upright while preserving the SVG baseline position.
  return [
    'q', `1 0 0 -1 0 ${pdfNumber(2 * y)} cm`, fill, state,
    'BT', `/${font} ${pdfNumber(size)} Tf`, `1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm`, `${literal} Tj`, 'ET', 'Q',
  ].filter(Boolean).join('\n');
}

function transformMatrix(value) {
  if (!value) return null;
  const match = /^matrix\(\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)\s*\)$/.exec(value);
  if (!match) fail('SVG transforms', 'only the editor SVG matrix(a b c d e f) transform is supported');
  const values = match.slice(1).map(item => finite(item, 'transform component'));
  return `${values.map(pdfNumber).join(' ')} cm`;
}

function alphaState(fillAlpha, strokeAlpha, stateNames) {
  if (fillAlpha === 1 && strokeAlpha === 1) return '';
  const key = `${pdfNumber(fillAlpha)}:${pdfNumber(strokeAlpha)}`;
  if (!stateNames.has(key)) stateNames.set(key, `GS${stateNames.size + 1}`);
  return `/${stateNames.get(key)} gs`;
}

function reserveForm(context) {
  if (context.forms.size >= LIMITS.maxTransparencyGroups) {
    throw new RangeError(`Vector PDF exceeds ${LIMITS.maxTransparencyGroups} isolated transparency groups.`);
  }
  const name = `Fm${context.forms.size + 1}`;
  context.forms.set(name, null);
  return name;
}

function softMaskState(maskFormName, stateNames, opacity = 1) {
  const key = `smask:${maskFormName}:${pdfNumber(opacity)}`;
  if (!stateNames.has(key)) stateNames.set(key, `GS${stateNames.size + 1}`);
  return `/${stateNames.get(key)} gs`;
}

function maskFormFor(maskId, context) {
  if (context.buildingMaskIds.has(maskId)) fail('cyclic alpha masks', `mask ${maskId} references itself`);
  const existing = context.maskFormNames.get(maskId);
  if (existing) return existing;
  const definition = context.definitions.masks.get(maskId);
  if (!definition) throw new TypeError(`SVG references missing mask ${maskId}.`);
  const formName = reserveForm(context);
  context.maskFormNames.set(maskId, formName);
  context.buildingMaskIds.add(maskId);
  try {
    const formContent = definition.node.children.map(child => renderTree(child, {
      ...context, opacity: 1, inDefs: false,
    })).filter(Boolean).join('\n');
    context.forms.set(formName, {
      content: `${formContent}${formContent ? '\n' : ''}`,
      bbox: definition.region,
    });
  } catch (error) {
    context.forms.delete(formName);
    context.maskFormNames.delete(maskId);
    throw error;
  } finally {
    context.buildingMaskIds.delete(maskId);
  }
  return formName;
}

function maskReference(value) {
  const match = /^url\(#([^)]+)\)$/.exec(String(value || ''));
  if (!match) fail('external masks', 'only local alpha-mask references are supported');
  return match[1];
}

function formForChildren(node, context, { opacity = 1 } = {}) {
  const formName = reserveForm(context);
  const formContent = node.children.map(child => renderTree(child, {
    ...context, opacity, inDefs: false,
  })).filter(Boolean).join('\n');
  context.forms.set(formName, { content: `${formContent}${formContent ? '\n' : ''}` });
  return formName;
}

function gradientReference(value, gradients) {
  if (value == null || !value.startsWith('url(')) return null;
  const match = /^url\(#([^)]+)\)$/.exec(value);
  if (!match) fail('external gradient paints', 'only local SVG gradient references are supported');
  const gradient = gradients.get(match[1]);
  if (!gradient) throw new TypeError(`SVG references missing gradient ${match[1]}.`);
  return { id: match[1], gradient };
}

function shadingForGradient(reference, shadingNames, shadings) {
  if (!shadingNames.has(reference.id)) {
    const name = `Sh${shadingNames.size + 1}`;
    shadingNames.set(reference.id, name);
    shadings.set(name, reference.gradient);
  }
  return shadingNames.get(reference.id);
}

function paintPath(node, path, inheritedOpacity, { stateNames, gradients, shadingNames, shadings }) {
  const attrs = node.attributes;
  const fillGradient = gradientReference(attrs.fill, gradients);
  const strokeGradient = gradientReference(attrs.stroke, gradients);
  if (strokeGradient) fail('gradient strokes', 'PDF shadings cannot clip to a stroke outline in the current vector writer');
  const fill = fillGradient ? null : colorOperator(attrs.fill ?? '#000000', 'fill');
  const stroke = colorOperator(attrs.stroke ?? 'none', 'stroke');
  const fillOpacity = inheritedOpacity * parseOpacity(attrs['fill-opacity'], 'fill opacity');
  const strokeOpacity = inheritedOpacity * parseOpacity(attrs['stroke-opacity'], 'stroke opacity');
  const fillRule = attrs['fill-rule'] || 'nonzero';
  if (!['nonzero', 'evenodd'].includes(fillRule)) throw new TypeError('SVG has an invalid fill-rule.');
  const operators = [];
  if (fillGradient) {
    const shading = shadingForGradient(fillGradient, shadingNames, shadings);
    operators.push('q', path, fillRule === 'evenodd' ? 'W*' : 'W', 'n');
    const state = alphaState(fillOpacity, 1, stateNames);
    if (state) operators.push(state);
    if (fillGradient.gradient.transform) {
      operators.push('q', `${fillGradient.gradient.transform.map(pdfNumber).join(' ')} cm`, `/${shading} sh`, 'Q');
    } else {
      operators.push(`/${shading} sh`);
    }
    operators.push('Q');
  } else if (fill) {
    operators.push(fill);
    const state = alphaState(fillOpacity, 1, stateNames);
    if (state) operators.push(state);
    operators.push(path, fillRule === 'evenodd' ? 'f*' : 'f');
  }
  if (stroke) {
    const width = finite(attrs['stroke-width'] ?? 1, 'stroke width');
    if (width < 0) throw new TypeError('SVG stroke widths cannot be negative.');
    operators.push(colorOperator(attrs.stroke, 'stroke'));
    const state = alphaState(1, strokeOpacity, stateNames);
    if (state) operators.push(state);
    operators.push(`${pdfNumber(width)} w`);
    const cap = { butt: 0, round: 1, square: 2 }[attrs['stroke-linecap'] || 'butt'];
    const join = { miter: 0, round: 1, bevel: 2 }[attrs['stroke-linejoin'] || 'miter'];
    if (cap == null || join == null) throw new TypeError('SVG stroke cap or join is unsupported.');
    operators.push(`${cap} J`, `${join} j`);
    if (attrs['stroke-miterlimit'] != null) {
      const miter = finite(attrs['stroke-miterlimit'], 'stroke miter limit');
      if (miter < 1) throw new TypeError('SVG stroke miter limit must be at least 1.');
      operators.push(`${pdfNumber(miter)} M`);
    }
    if (attrs['stroke-dasharray'] && attrs['stroke-dasharray'] !== 'none') {
      const dash = attrs['stroke-dasharray'].trim().split(/[\s,]+/).map(value => finite(value, 'dash length'));
      if (!dash.length || dash.some(value => value < 0)) throw new TypeError('SVG stroke dash lengths must be nonnegative.');
      operators.push(`[${dash.map(pdfNumber).join(' ')}] 0 d`);
    } else operators.push('[] 0 d');
    operators.push(path, 'S');
  }
  return operators.length ? operators.join('\n') : '';
}

function imageDescriptor(href) {
  try {
    return decodePdfImageDataUri(href);
  } catch (error) {
    if (error instanceof PdfImageFormatError) fail('embedded raster image', error.message);
    throw error;
  }
}

function imageResource(href, context) {
  if (!context.imageNames.has(href)) {
    const name = `Im${context.imageNames.size + 1}`;
    context.imageNames.set(href, name);
    context.images.set(name, imageDescriptor(href));
  }
  return context.imageNames.get(href);
}

function imageOrientation(image) {
  const width = image.width;
  const height = image.height;
  // PDF image sample rows are addressed bottom-to-top relative to this
  // writer's SVG canvas (whose y axis is reflected by the page matrix). Apply
  // the vertical source-coordinate flip after the EXIF orientation transform
  // so a raw, un-oriented image's top row appears at the top of the design.
  const orientation = (() => {
  switch (image.orientation || 1) {
    case 2: return [-1, 0, 0, 1, width, 0];
    case 3: return [-1, 0, 0, -1, width, height];
    case 4: return [1, 0, 0, -1, 0, height];
    case 5: return [0, 1, 1, 0, 0, 0];
    case 6: return [0, 1, -1, 0, height, 0];
    case 7: return [0, -1, -1, 0, height, width];
    case 8: return [0, -1, 1, 0, 0, width];
    default: return [1, 0, 0, 1, 0, 0];
  }
  })();
  const [a, b, c, d, e, f] = orientation;
  return [a, b, -c, -d, e + c * height, f + d * height];
}

function imageClipPath(clipValue, definitions) {
  if (!clipValue) return null;
  const match = /^url\(#([^)]+)\)$/.exec(clipValue);
  if (!match) fail('external clip paths', 'only local clipPath references are supported');
  const shape = definitions.clips.get(match[1]);
  if (!shape) throw new TypeError(`SVG references missing clip path ${match[1]}.`);
  const clipRule = shape.attributes['clip-rule'] || shape.attributes['fill-rule'] || 'nonzero';
  if (!['nonzero', 'evenodd'].includes(clipRule)) throw new TypeError('SVG clip path has an invalid fill rule.');
  return `${shapePath(shape, { closeOpen: true })}\n${clipRule === 'evenodd' ? 'W*' : 'W'}\nn`;
}

function paintImage(node, inheritedOpacity, context) {
  const attrs = node.attributes;
  assertAttributes(node, new Set(['x', 'y', 'width', 'height', 'href', 'xlink:href', 'preserveAspectRatio', 'transform', 'opacity', 'clip-path', 'mask']));
  const opacity = inheritedOpacity * parseOpacity(attrs.opacity, 'image opacity');
  if (opacity === 0) return '';
  const href = attrs.href || attrs['xlink:href'];
  if (!href) fail('external raster images', 'embed the image as a PNG or JPEG data URL before vector PDF export');
  const imageName = imageResource(href, context);
  const image = context.images.get(imageName);
  const x = finite(attrs.x ?? 0, 'image x');
  const y = finite(attrs.y ?? 0, 'image y');
  const width = finite(attrs.width, 'image width');
  const height = finite(attrs.height, 'image height');
  if (width <= 0 || height <= 0) throw new TypeError('SVG image width and height must be positive.');
  const preserve = (attrs.preserveAspectRatio || 'xMidYMid meet').trim().replace(/\s+/g, ' ');
  let drawX = x;
  let drawY = y;
  let drawWidth = width;
  let drawHeight = height;
  if (preserve !== 'none') {
    if (!['xMidYMid meet', 'xMidYMid slice'].includes(preserve)) {
      fail('image preserveAspectRatio', 'only none, xMidYMid meet, and xMidYMid slice are supported');
    }
    const scaleX = width / image.displayWidth;
    const scaleY = height / image.displayHeight;
    const scale = preserve.endsWith('slice') ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    drawWidth = image.displayWidth * scale;
    drawHeight = image.displayHeight * scale;
    drawX += (width - drawWidth) / 2;
    drawY += (height - drawHeight) / 2;
  }

  const commands = ['q'];
  const transform = transformMatrix(attrs.transform);
  if (transform) commands.push(transform);
  const clip = imageClipPath(attrs['clip-path'], context.definitions);
  if (clip) commands.push(clip);
  if (preserve.endsWith('slice')) {
    commands.push(rectPath({ x, y, width, height }), 'W', 'n');
  }
  const state = alphaState(opacity, 1, context.stateNames);
  if (state) commands.push(state);

  const [a, b, c, d, e, f] = imageOrientation(image);
  const sx = drawWidth / image.displayWidth;
  const sy = drawHeight / image.displayHeight;
  const matrix = [
    sx * a * image.width,
    sy * b * image.width,
    sx * c * image.height,
    sy * d * image.height,
    drawX + sx * e,
    drawY + sy * f,
  ];
  commands.push(`${matrix.map(pdfNumber).join(' ')} cm`, `/${imageName} Do`, 'Q');
  return commands.join('\n');
}

function renderTree(node, context = {}) {
  const { definitions, stateNames, shadingNames, shadings, imageNames, images, forms, opacity = 1, inDefs = false } = context;
  if (node.name === '#text') return '';
  if (node.name === 'title') {
    assertAttributes(node, new Set());
    return '';
  }
  if (node.name === 'defs') return '';
  if (node.name === 'svg') {
    assertAttributes(node, new Set(['xmlns', 'width', 'height', 'viewBox']));
    return node.children.map(child => renderTree(child, {
      ...context, opacity, inDefs,
    })).join('\n');
  }
  if (node.name === 'g') {
    const attrs = node.attributes;
    assertAttributes(node, new Set(['transform', 'opacity', 'filter', 'mask', 'style', 'clip-path']));
    const ownOpacity = parseOpacity(attrs.opacity, 'group opacity');
    if (ownOpacity === 0 || opacity === 0) return '';
    if (attrs.filter) fail('layer effects', 'SVG filter effects cannot be preserved by PDF');
    if (attrs.style) fail('blend modes and inline CSS', 'SVG styles cannot be represented by the current PDF writer');
    const matrix = transformMatrix(attrs.transform);
    const commands = ['q'];
    if (matrix) commands.push(matrix);
    const clip = attrs['clip-path'];
    if (clip) {
      const match = /^url\(#([^)]+)\)$/.exec(clip);
      if (!match) fail('external clip paths', 'only local clipPath references are supported');
      const shape = definitions.clips.get(match[1]);
      if (!shape) throw new TypeError(`SVG references missing clip path ${match[1]}.`);
      const clipRule = shape.attributes['clip-rule'] || shape.attributes['fill-rule'] || 'nonzero';
      if (!['nonzero', 'evenodd'].includes(clipRule)) throw new TypeError('SVG clip path has an invalid fill rule.');
      commands.push(shapePath(shape, { closeOpen: true }), clipRule === 'evenodd' ? 'W*' : 'W', 'n');
    }
    if (attrs.mask) {
      const maskFormName = maskFormFor(maskReference(attrs.mask), context);
      const formName = formForChildren(node, context, { opacity: 1 });
      const groupOpacity = ownOpacity * opacity;
      if (groupOpacity !== 1) {
        const groupState = alphaState(groupOpacity, groupOpacity, stateNames);
        if (groupState) commands.push(groupState);
      }
      commands.push(softMaskState(maskFormName, stateNames), `/${formName} Do`);
    } else if (ownOpacity === 1) {
      for (const child of node.children) commands.push(renderTree(child, {
        ...context, opacity, inDefs,
      }));
    } else {
      const formName = reserveForm(context);
      const formContent = node.children.map(child => renderTree(child, {
        ...context, opacity: 1, inDefs,
      })).filter(Boolean).join('\n');
      forms.set(formName, { content: `${formContent}${formContent ? '\n' : ''}` });
      const state = alphaState(ownOpacity, ownOpacity, stateNames);
      if (state) commands.push(state);
      commands.push(`/${formName} Do`);
    }
    commands.push('Q');
    return commands.filter(Boolean).join('\n');
  }
  if (node.name === 'image') {
    if (inDefs) return '';
    if (node.attributes.mask) {
      const maskFormName = maskFormFor(maskReference(node.attributes.mask), context);
      const formName = reserveForm(context);
      const attributes = { ...node.attributes };
      delete attributes.mask;
      const content = paintImage({ ...node, attributes }, opacity, context);
      forms.set(formName, { content: `${content}${content ? '\n' : ''}` });
      return `q\n${softMaskState(maskFormName, stateNames)}\n/${formName} Do\nQ`;
    }
    return paintImage(node, opacity, { definitions, stateNames, imageNames, images });
  }
  if (node.name === 'text') {
    if (inDefs) return '';
    if (node.attributes.mask) fail('text alpha masks', 'masked text requires glyph outlines');
    return paintText(node, opacity, context);
  }
  if (['path', 'rect', 'ellipse', 'polygon', 'text', 'tspan'].includes(node.name)) {
    if (inDefs) return '';
    if (node.attributes.mask) {
      const maskFormName = maskFormFor(maskReference(node.attributes.mask), context);
      const formName = reserveForm(context);
      const attributes = { ...node.attributes };
      delete attributes.mask;
      const paintNode = { ...node, attributes };
      const content = paintPath(paintNode, shapePath(paintNode), opacity, {
        stateNames, gradients: definitions.gradients, shadingNames, shadings,
      });
      forms.set(formName, { content: `${content}${content ? '\n' : ''}` });
      return `q\n${softMaskState(maskFormName, stateNames)}\n/${formName} Do\nQ`;
    }
    return paintPath(node, shapePath(node), opacity, {
      stateNames, gradients: definitions.gradients, shadingNames, shadings,
    });
  }
  fail(`SVG element <${node.name}>`);
}

function compileSvg(svg) {
  const root = parseSvg(svg);
  const { viewBox, width, height } = parseRoot(root);
  const definitions = scanDefinitions(root);
  const stateNames = new Map();
  const shadingNames = new Map();
  const shadings = new Map();
  const imageNames = new Map();
  const images = new Map();
  const forms = new Map();
  const fontNames = new Map();
  const fonts = new Map();
  const maskFormNames = new Map();
  const buildingMaskIds = new Set();
  const renderContext = {
    definitions, stateNames, shadingNames, shadings, imageNames, images, forms, fontNames, fonts,
    maskFormNames, buildingMaskIds,
  };
  const [vx, vy, vbWidth, vbHeight] = viewBox;
  const sx = finite(width / vbWidth, 'viewport scale');
  const sy = finite(height / vbHeight, 'viewport scale');
  const e = finite(-vx * sx, 'viewport translation');
  const f = finite((vy + vbHeight) * sy, 'viewport translation');
  const content = [
    'q',
    `${pdfNumber(sx)} 0 0 ${pdfNumber(-sy)} ${pdfNumber(e)} ${pdfNumber(f)} cm`,
    ...root.children.map(child => renderTree(child, renderContext)),
    'Q',
  ].filter(Boolean).join('\n');
  return { width, height, content: `${content}\n`, stateNames, shadings, images, forms, fonts };
}

function safePdfContent(content) {
  // All content is generated from numeric operators and RGB values. Refuse
  // accidental non-ASCII/control text rather than emit an ambiguous stream.
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(content)) throw new TypeError('Generated PDF content must be ASCII.');
  return encoder.encode(content);
}

function pdfStreamObject(dictionary, bytes) {
  const prefix = encoder.encode(`<< /Length ${bytes.byteLength} ${dictionary} >>\nstream\n`);
  const suffix = encoder.encode('\nendstream');
  const output = new Uint8Array(prefix.byteLength + bytes.byteLength + suffix.byteLength);
  output.set(prefix, 0);
  output.set(bytes, prefix.byteLength);
  output.set(suffix, prefix.byteLength + bytes.byteLength);
  return output;
}

function resourceDictionary(content, page, { excludeFormName = null } = {}) {
  const used = pattern => new Set([...content.matchAll(pattern)].map(match => match[1]));
  const usedStates = used(/\/(GS\d+)\s+gs\b/g);
  const usedShadings = used(/\/(Sh\d+)\s+sh\b/g);
  const usedXObjects = used(/\/(Im\d+|Fm\d+)\s+Do\b/g);
  const usedFonts = used(/\/(F\d+)\s+[-+\d.eE]+\s+Tf\b/g);
  const resources = [];
  const states = page.states.filter(item => usedStates.has(item.name));
  const shadings = page.shadingObjects.filter(item => usedShadings.has(item.name));
  const images = page.imageObjects.filter(item => usedXObjects.has(item.name));
  const forms = page.formObjects.filter(item => item.name !== excludeFormName && usedXObjects.has(item.name));
  const fonts = page.fontObjects.filter(item => usedFonts.has(item.name));
  if (states.length) resources.push(`/ExtGState << ${states.map(item => `/${item.name} ${item.objectId} 0 R`).join(' ')} >>`);
  if (shadings.length) resources.push(`/Shading << ${shadings.map(item => `/${item.name} ${item.shadingId} 0 R`).join(' ')} >>`);
  const xObjects = [
    ...images.map(item => ({ name: item.name, objectId: item.imageId })),
    ...forms.map(item => ({ name: item.name, objectId: item.objectId })),
  ];
  if (xObjects.length) resources.push(`/XObject << ${xObjects.map(item => `/${item.name} ${item.objectId} 0 R`).join(' ')} >>`);
  if (fonts.length) resources.push(`/Font << ${fonts.map(item => `/${item.name} ${item.objectId} 0 R`).join(' ')} >>`);
  return `<< ${resources.join(' ')} >>`;
}

function createPdf(pages) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > LIMITS.maxPages) {
    throw new RangeError(`Vector PDF must contain between 1 and ${LIMITS.maxPages} pages.`);
  }
  let aggregateSvgCharacters = 0;
  for (const svg of pages) {
    if (typeof svg !== 'string') throw new TypeError('Every vector PDF page must be an SVG string.');
    aggregateSvgCharacters += svg.length;
    if (aggregateSvgCharacters > LIMITS.maxAggregateSvgCharacters) {
      throw new RangeError(`SVG pages exceed ${LIMITS.maxAggregateSvgCharacters} aggregate characters.`);
    }
  }
  const compiled = pages.map(compileSvg);
  let nextId = 3;
  const pageObjects = compiled.map(page => {
    const pageId = nextId++;
    const contentId = nextId++;
    const states = [...page.stateNames.entries()].map(([key, name]) => {
      if (key.startsWith('smask:')) {
        const [, maskFormName, opacity] = key.split(':');
        return { name, fillAlpha: opacity, strokeAlpha: opacity, maskFormName, objectId: nextId++ };
      }
      const [fillAlpha, strokeAlpha] = key.split(':');
      return { name, fillAlpha, strokeAlpha, objectId: nextId++ };
    });
    const shadings = [...page.shadings.entries()].map(([name, descriptor]) => {
      const shadingId = nextId++;
      const functionId = nextId++;
      const segmentFunctionIds = descriptor.segments.length > 1
        ? descriptor.segments.map(() => nextId++)
        : [];
      return { name, descriptor, shadingId, functionId, segmentFunctionIds };
    });
    const images = [...page.images.entries()].map(([name, descriptor]) => {
      const imageId = nextId++;
      const alphaId = descriptor.alpha ? nextId++ : null;
      return { name, descriptor, imageId, alphaId };
    });
    const fonts = [...page.fonts.entries()].map(([name, baseFont]) => ({ name, baseFont, objectId: nextId++ }));
    const forms = [...page.forms.entries()].map(([name, descriptor]) => ({ name, descriptor, objectId: nextId++ }));
    return { ...page, pageId, contentId, states, shadingObjects: shadings, imageObjects: images, fontObjects: fonts, formObjects: forms };
  });
  const objectCount = nextId - 1;
  const objects = new Array(objectCount + 1);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${pageObjects.length} /Kids [${pageObjects.map(page => `${page.pageId} 0 R`).join(' ')}] >>`;
  for (const page of pageObjects) {
    objects[page.pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(page.width)} ${pdfNumber(page.height)}] /Resources ${resourceDictionary(page.content, page)} /Contents ${page.contentId} 0 R >>`;
    const bytes = safePdfContent(page.content);
    objects[page.contentId] = `<< /Length ${bytes.byteLength} >>\nstream\n${page.content}endstream`;
    for (const state of page.states) {
      const softMask = state.maskFormName
        ? `/SMask << /S /Alpha /G ${page.formObjects.find(form => form.name === state.maskFormName)?.objectId || 'null'} 0 R >>`
        : '';
      if (softMask.includes('/G null')) throw new TypeError(`PDF alpha mask form ${state.maskFormName} was not compiled.`);
      objects[state.objectId] = `<< /Type /ExtGState /ca ${state.fillAlpha} /CA ${state.strokeAlpha} ${softMask} >>`;
    }
    for (const shading of page.shadingObjects) {
      const { descriptor } = shading;
      const type = descriptor.type === 'linear' ? 2 : 3;
      const coordinates = descriptor.type === 'linear'
        ? descriptor.coordinates
        : [descriptor.coordinates[0], descriptor.coordinates[1], 0,
          descriptor.coordinates[0], descriptor.coordinates[1], descriptor.coordinates[2]];
      objects[shading.shadingId] = `<< /ShadingType ${type} /ColorSpace /DeviceRGB /Coords [${coordinates.map(pdfNumber).join(' ')}] /Function ${shading.functionId} 0 R /Extend [true true] >>`;
      const type2Function = segment => `<< /FunctionType 2 /Domain [0 1] /C0 [${segment.c0.map(pdfNumber).join(' ')}] /C1 [${segment.c1.map(pdfNumber).join(' ')}] /N 1 >>`;
      if (shading.segmentFunctionIds.length === 0) {
        objects[shading.functionId] = type2Function(descriptor.segments[0]);
      } else {
        objects[shading.functionId] = `<< /FunctionType 3 /Domain [0 1] /Functions [${shading.segmentFunctionIds.map(id => `${id} 0 R`).join(' ')}] /Bounds [${descriptor.bounds.map(pdfNumber).join(' ')}] /Encode [${descriptor.segments.map(() => '0 1').join(' ')}] >>`;
        descriptor.segments.forEach((segment, index) => {
          objects[shading.segmentFunctionIds[index]] = type2Function(segment);
        });
      }
    }
    for (const item of page.imageObjects) {
      const { descriptor } = item;
      const mask = item.alphaId ? `/SMask ${item.alphaId} 0 R` : '';
      const imageDictionary = `/Type /XObject /Subtype /Image /Width ${descriptor.width} /Height ${descriptor.height}`
        + ` /ColorSpace ${descriptor.colorSpace} /BitsPerComponent ${descriptor.bitsPerComponent}`
        + ` /Filter /${descriptor.filter} ${descriptor.decodeParms || ''} ${descriptor.mask || ''} ${mask} /Interpolate true`;
      objects[item.imageId] = pdfStreamObject(imageDictionary, descriptor.data);
      if (item.alphaId) {
        const alphaDictionary = `/Type /XObject /Subtype /Image /Width ${descriptor.width} /Height ${descriptor.height}`
          + ` /ColorSpace /DeviceGray /BitsPerComponent ${descriptor.alpha.bitsPerComponent} /Filter /FlateDecode /Interpolate true`;
        objects[item.alphaId] = pdfStreamObject(alphaDictionary, descriptor.alpha.data);
      }
    }
    for (const item of page.fontObjects) {
      objects[item.objectId] = `<< /Type /Font /Subtype /Type1 /BaseFont /${item.baseFont} /Encoding /WinAnsiEncoding >>`;
    }
    for (const item of page.formObjects) {
      const bytes = safePdfContent(item.descriptor.content);
      const bounds = LIMITS.maxCoordinate;
      const formBounds = item.descriptor.bbox
        ? [item.descriptor.bbox.x, item.descriptor.bbox.y,
          item.descriptor.bbox.x + item.descriptor.bbox.width, item.descriptor.bbox.y + item.descriptor.bbox.height]
        : [-bounds, -bounds, bounds, bounds];
      const dictionary = `/Type /XObject /Subtype /Form /FormType 1 /BBox [${formBounds.map(pdfNumber).join(' ')}]`
        + ` /Matrix [1 0 0 1 0 0] /Resources ${resourceDictionary(item.descriptor.content, page, { excludeFormName: item.name })}`
        + ' /Group << /S /Transparency /CS /DeviceRGB /I true /K false >>';
      objects[item.objectId] = pdfStreamObject(dictionary, bytes);
    }
  }
  const parts = [];
  const offsets = new Array(objectCount + 1).fill(0);
  let length = 0;
  const push = value => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    if (length + bytes.byteLength > LIMITS.maxOutputBytes) {
      throw new RangeError(`Vector PDF exceeds ${LIMITS.maxOutputBytes} output bytes.`);
    }
    parts.push(bytes);
    length += bytes.byteLength;
  };
  push('%PDF-1.4\n');
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    push(objects[id]);
    push('\nendobj\n');
  }
  const xrefOffset = length;
  push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= objectCount; id += 1) {
    if (offsets[id] > 9_999_999_999) throw new RangeError('Vector PDF exceeds the supported cross-reference offset range.');
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

/** Convert one editor-generated, self-contained SVG document to vector PDF. */
export function createVectorPdf(svg) {
  return createPdf([svg]);
}

/** Convert multiple editor-generated SVG documents to vector PDF pages. */
export function createMultipageVectorPdf(svgs) {
  return createPdf(svgs);
}

export const PDF_VECTOR_EXPORT_LIMITS = LIMITS;
