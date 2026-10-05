import { decodePdfImageDataUri, PdfImageFormatError } from './pdf-image.js';
import { transformTextCase } from './text-layout.js';
import * as model from './model.js';

const encoder = new TextEncoder();

const LIMITS = Object.freeze({
  maxPages: 100,
  maxPageDimension: 14_400,
  maxCoordinate: 10_000_000,
  maxPageSvgCharacters: 64 * 1024 * 1024,
  maxAggregateSvgCharacters: 128 * 1024 * 1024,
  maxTransparencyGroups: 10_000,
  maxPdfTextGlyphs: 65_536,
  maxPdfTextPathCharacters: 64 * 1024 * 1024,
  maxPdfTextGlyphPathCharacters: 1_000_000,
  maxPdfTextRuns: 32_768,
  maxPdfTextMetadataCharacters: 8 * 1024 * 1024,
  maxOutputBytes: 512 * 1024 * 1024,
});

/**
 * A fail-closed PDF writer for the self-contained SVG emitted by svg-export.js.
 * It keeps supported geometry as PDF paths and shading functions (never
 * screenshots the page). Paths, solid paints, gradients, clips, and embedded
 * PNG/JPEG image XObjects and isolated group-opacity forms remain editable PDF
 * objects. Simple positioned text in the printable ASCII and
 * WinAnsi/Windows-1252 extended Latin repertoire uses standard Helvetica PDF
 * fonts. Measured, flat inline rich-text runs also use standard Helvetica
 * variants when the SVG contains the editor's PDF placement metadata. Custom
 * underline styles, thicknesses, offsets, colors and verified Skip ink gaps
 * arrive as ordinary self-contained filled paths and retain vector geometry.
 * Retained local glyph contours and bounded Type3/ToUnicode semantics arrive
 * separately from the SVG export. The semantics use those same real contours
 * in nonpainting text mode, so they add searchable/copyable text without
 * changing page pixels. Raw
 * custom-font SVG text and textPath nodes,
 * gradient strokes, unsupported filter graphs, colored/translucent luminance
 * masks, and blend modes are rejected with feature-specific errors. A single user-space feDropShadow on a simple vector fill keeps its
 * geometry as vector paths and its bounded blur as a transparent image XObject.
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

/**
 * Visit the layers that the SVG/PDF paint stream actually draws. A prepared
 * vector Boolean is one path with its original identity and result paints;
 * its editable operands are geometry inputs, not additional painted layers.
 * Preparation remains asynchronous and must finish before this synchronous
 * traversal starts. Legacy Boolean traversal retains its existing behavior.
 */
export function walkVectorPdfPaintNodes(document, roots, visit, {
  resolveBoolean = (snapshot, node) => model.getBooleanVectorPath(snapshot, node)
} = {}) {
  if (!Array.isArray(roots) || typeof visit !== 'function' || typeof resolveBoolean !== 'function') throw new TypeError('Vector PDF paint traversal requires roots, a visitor, and a Boolean resolver.');
  if(roots.length>model.MAX_DOCUMENT_NODE_COUNT)throw new RangeError('Vector PDF paint traversal exceeds the bounded design tree.');
  const stack=roots.map(node=>({node,parents:[]})).reverse();
  const seen=new Set();
  while(stack.length){
    const entry=stack.pop();const sourceNode=entry.node;
    if(!sourceNode||typeof sourceNode!=='object')throw new TypeError('Vector PDF requires readable layer geometry.');
    if(model.getNodePropertyValue(document,sourceNode,'visible')===false
      ||Number(model.getNodePropertyValue(document,sourceNode,'opacity')??1)===0)continue;
    if(seen.has(sourceNode)||seen.size>=model.MAX_DOCUMENT_NODE_COUNT||entry.parents.length>=model.MAX_DOCUMENT_TREE_DEPTH)throw new RangeError('Vector PDF paint traversal exceeds the bounded design tree.');
    seen.add(sourceNode);
    let node=sourceNode;
    if(sourceNode.type==='boolean'&&sourceNode.booleanGeometry==='vector'){
      try{node=resolveBoolean(document,sourceNode);}
      catch(error){throw new PdfVectorExportError('Boolean geometry',`layer “${sourceNode.name||'Boolean'}”: ${error.message||'prepare the result before exporting'}`);}
      if(!node||node.type!=='path'||node.id!==sourceNode.id||!Array.isArray(node.children)||node.children.length
        ||node.closed!==true||!Array.isArray(node.points)||node.subpaths!=null&&!Array.isArray(node.subpaths))throw new PdfVectorExportError('Boolean geometry',`layer “${sourceNode.name||'Boolean'}” has no complete prepared result path`);
    }
    visit({node,sourceNode,parents:entry.parents});
    if(node!==sourceNode)continue;
    const children=node.children||[];
    if(!Array.isArray(children))throw new TypeError('Vector PDF requires readable child layers.');
    if(children.length>model.MAX_DOCUMENT_NODE_COUNT-seen.size-stack.length)throw new RangeError('Vector PDF paint traversal exceeds the bounded design tree.');
    const parents=[...entry.parents,sourceNode];
    for(let index=children.length-1;index>=0;index--)stack.push({node:children[index],parents});
  }
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
  if (Object.is(rounded, -0)) return '0';
  const text = String(rounded);
  if (!/[eE]/.test(text)) return text;

  // PDF real numbers do not use exponent notation. Expand the exponent after
  // rounding so even very small valid SVG dimensions and coordinates remain
  // valid PDF tokens.
  const [mantissa, exponentText] = text.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const decimalIndex = unsigned.indexOf('.') < 0 ? unsigned.length : unsigned.indexOf('.');
  const digits = unsigned.replace('.', '');
  const shiftedIndex = decimalIndex + exponent;
  const magnitude = shiftedIndex <= 0
    ? `0.${'0'.repeat(-shiftedIndex)}${digits}`
    : shiftedIndex >= digits.length
      ? `${digits}${'0'.repeat(shiftedIndex - digits.length)}`
      : `${digits.slice(0, shiftedIndex)}.${digits.slice(shiftedIndex)}`;
  return `${negative ? '-' : ''}${magnitude}`;
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
  circle: new Set(['cx', 'cy', 'r', ...paintAttributes]),
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
    if (value.trim() || ['text', 'tspan'].includes(stack.at(-1).name)) {
      stack.at(-1).children.push({ name: '#text', text: decodeXml(value), children: [] });
    }
  }
  if (cursor !== svg.length || stack.length !== 1) throw new TypeError('SVG contains incomplete XML.');
  if (root.children.length !== 1 || root.children[0].name !== 'svg') throw new TypeError('Vector PDF export requires one SVG root element.');
  return root.children[0];
}

function parseRoot(svgRoot) {
  assertAttributes(svgRoot, new Set(['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio']));
  const rawViewBox = (svgRoot.attributes.viewBox || '').trim().split(/[\s,]+/).map(Number);
  if (rawViewBox.length !== 4 || !rawViewBox.every(Number.isFinite) || rawViewBox[2] <= 0 || rawViewBox[3] <= 0) {
    throw new TypeError('Vector PDF export requires a positive four-number SVG viewBox.');
  }
  const viewBox = rawViewBox.map(value => finite(value, 'viewBox coordinate'));
  const parseLength = (value, label) => {
    const match = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)(?:px)?$/.exec(String(value || ''));
    if (!match) throw new TypeError(`Vector PDF export requires SVG ${label} in pixels.`);
    return finite(match[1], label);
  };
  const width = parseLength(svgRoot.attributes.width, 'width');
  const height = parseLength(svgRoot.attributes.height, 'height');
  if (width <= 0 || height <= 0 || width > LIMITS.maxPageDimension || height > LIMITS.maxPageDimension) {
    throw new RangeError(`Vector PDF page dimensions must be between 0 and ${LIMITS.maxPageDimension} points.`);
  }
  const alignmentTokens = (svgRoot.attributes.preserveAspectRatio || 'xMidYMid meet').trim().split(/\s+/).filter(Boolean);
  if (alignmentTokens[0] === 'defer') alignmentTokens.shift();
  let preserveAspectRatio;
  if (alignmentTokens[0] === 'none' && alignmentTokens.length === 1) {
    preserveAspectRatio = { mode: 'none' };
  } else {
    const match = /^(xMin|xMid|xMax)(YMin|YMid|YMax)$/.exec(alignmentTokens[0] || '');
    const mode = alignmentTokens[1] || 'meet';
    if (!match || !['meet', 'slice'].includes(mode) || alignmentTokens.length > 2) {
      fail('SVG preserveAspectRatio', 'only none or xMin/xMid/xMax with YMin/YMid/YMax and meet/slice is supported');
    }
    preserveAspectRatio = {
      mode,
      alignX: { xMin: 0, xMid: 0.5, xMax: 1 }[match[1]],
      alignY: { YMin: 0, YMid: 0.5, YMax: 1 }[match[2]],
    };
  }
  return { viewBox, width, height, preserveAspectRatio };
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

// Black/white vector masks encode geometric subtraction without depending on
// SVG luminance coefficients or color-space conversion. Reject other graphs
// rather than silently treating their colors or transparency as alpha.
function assertBinaryLuminanceMask(node, clips) {
  let shapes = 0;
  const reject = () => fail('luminance masks', 'only opaque black/white vector geometry in an explicit user-space region is supported');
  const visit = child => {
    if (child.name === '#text' || child.name === 'title') return;
    if (child.name === 'defs') {
      if (Object.keys(child.attributes).some(key => !key.startsWith('data-'))) reject();
      if (child.children.some(item => item.name !== '#text' && item.name !== 'clipPath')) reject();
      return;
    } else if (child.name === 'g') {
      if (Object.keys(child.attributes).some(key => !['transform', 'opacity', 'clip-path'].includes(key) && !key.startsWith('data-'))) reject();
      if (child.attributes['clip-path']) {
        const match = /^url\(#([^)]+)\)$/.exec(child.attributes['clip-path']);
        if (!match || !clips.has(match[1])) reject();
      }
    } else if (shapeAttributes[child.name]) {
      const allowed = new Set([...shapeAttributes[child.name], 'transform', 'opacity']);
      if (Object.keys(child.attributes).some(key => !allowed.has(key) && !key.startsWith('data-'))) reject();
      if (child.children.some(item => item.name !== '#text' && item.name !== 'title')) reject();
      for (const paint of [child.attributes.fill ?? '#000000', child.attributes.stroke ?? 'none']) {
        if (paint === 'none') continue;
        if (!/^#(?:000|fff|000000|ffffff)$/i.test(paint)) reject();
      }
      shapes += 1;
    } else reject();
    for (const key of ['opacity', 'fill-opacity', 'stroke-opacity']) {
      if (parseOpacity(child.attributes[key], `mask ${key}`) !== 1) reject();
    }
    child.children.forEach(visit);
  };
  node.children.forEach(visit);
  if (!shapes) reject();
}

function parseSimpleDropShadowFilter(definition) {
  assertAttributes(definition, new Set(['id', 'filterUnits', 'color-interpolation-filters', 'x', 'y', 'width', 'height']));
  if (definition.attributes['color-interpolation-filters'] != null && definition.attributes['color-interpolation-filters'] !== 'sRGB') {
    fail('filter color interpolation', 'only explicit sRGB interpolation is supported');
  }
  if (definition.attributes.filterUnits !== 'userSpaceOnUse') {
    fail('object-bounding-box layer effects', 'only explicit userSpaceOnUse drop-shadow filter regions are supported');
  }
  const region = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => {
    if (definition.attributes[key] == null) fail('implicit drop-shadow filter regions', 'explicit user-space x, y, width, and height are required');
    return [key, finite(definition.attributes[key], `drop-shadow filter ${key}`)];
  }));
  if (region.width <= 0 || region.height <= 0) throw new TypeError('SVG drop-shadow filter regions must have positive dimensions.');
  const primitives = definition.children.filter(child => child.name !== '#text');
  if (primitives.length !== 1 || primitives[0].name !== 'feDropShadow') {
    fail('layer-effect filter graphs', 'only one feDropShadow primitive on simple filled geometry is supported');
  }
  const primitive = primitives[0];
  assertAttributes(primitive, new Set(['in', 'dx', 'dy', 'stdDeviation', 'flood-color', 'flood-opacity', 'result']));
  if (primitive.children.length) throw new TypeError('SVG feDropShadow primitives must be empty elements.');
  if (primitive.attributes.in !== 'SourceGraphic') {
    fail('chained drop shadows', 'the supported feDropShadow input must be SourceGraphic');
  }
  const dx = finite(primitive.attributes.dx, 'drop-shadow dx');
  const dy = finite(primitive.attributes.dy, 'drop-shadow dy');
  const deviationText = String(primitive.attributes.stdDeviation ?? '');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(deviationText)) {
    fail('anisotropic drop-shadow blur', 'one nonnegative stdDeviation value is supported');
  }
  const stdDeviation = finite(deviationText, 'drop-shadow standard deviation');
  if (stdDeviation > 512) fail('oversized drop-shadow blur', 'standard deviation is limited to 512 SVG units');
  const floodColor = primitive.attributes['flood-color'];
  colorComponents(floodColor, 'drop-shadow');
  const floodOpacity = parseOpacity(primitive.attributes['flood-opacity'], 'drop-shadow flood opacity');
  return { ...region, dx, dy, stdDeviation, floodColor, floodOpacity };
}

function scanDefinitions(svgRoot) {
  const clips = new Map();
  const gradients = new Map();
  const masks = new Map();
  const filters = new Map();
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
          const id = definition.attributes.id;
          if (!id || ids.has(id)) throw new TypeError('SVG definitions require unique IDs.');
          ids.add(id);
          filters.set(id, parseSimpleDropShadowFilter(definition));
        } else if (definition.name === 'mask') {
          assertAttributes(definition, new Set([
            'id', 'maskUnits', 'maskContentUnits', 'mask-type', 'color-interpolation', 'x', 'y', 'width', 'height'
          ]));
          const id = definition.attributes.id;
          if (!id || ids.has(id)) throw new TypeError('SVG definitions require unique IDs.');
          ids.add(id);
          const kind = definition.attributes['mask-type'] || 'luminance';
          if (!['alpha', 'luminance'].includes(kind)) fail('mask type', 'expected alpha or luminance');
          if (definition.attributes['color-interpolation'] && definition.attributes['color-interpolation'] !== 'sRGB') {
            fail('mask color interpolation', 'only sRGB mask interpolation is supported');
          }
          if (kind === 'luminance') {
            // The editor places text-stroke clipping definitions inside the
            // mask that consumes them. Register only simple, local clip paths
            // from that scope; renderTree still ignores the nested <defs>.
            const registerNestedClips = node => {
              if (node.name === 'defs') {
                if (Object.keys(node.attributes).some(key => !key.startsWith('data-'))) {
                  fail('luminance masks', 'nested definitions may contain only local clip paths');
                }
                for (const nested of node.children) {
                  if (nested.name === '#text') continue;
                  if (nested.name !== 'clipPath') fail('luminance masks', 'nested definitions may contain only local clip paths');
                  assertAttributes(nested, new Set(['id', 'clipPathUnits']));
                  const nestedId = nested.attributes.id;
                  if (!nestedId || ids.has(nestedId)) throw new TypeError('SVG definitions require unique IDs.');
                  ids.add(nestedId);
                  if (nested.attributes.clipPathUnits && nested.attributes.clipPathUnits !== 'userSpaceOnUse') {
                    fail('luminance masks', 'nested clip paths must use userSpaceOnUse coordinates');
                  }
                  const shapes = nested.children.filter(item => item.name !== '#text');
                  if (shapes.length !== 1 || !shapeAttributes[shapes[0].name]
                    || shapes[0].children.some(item => item.name !== '#text' && item.name !== 'title')) {
                    fail('luminance masks', 'nested clip paths must contain one simple vector shape');
                  }
                  clips.set(nestedId, shapes[0]);
                }
                return;
              }
              node.children?.forEach(registerNestedClips);
            };
            registerNestedClips(definition);
            assertBinaryLuminanceMask(definition, clips);
          }
          masks.set(id, { node: definition, kind, region: maskRegion(definition) });
        } else {
          fail(`SVG definition <${definition.name}>`);
        }
      }
      return;
    }
    if (node.children) node.children.forEach(collect);
  };
  collect(svgRoot);
  return { clips, gradients, masks, filters };
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
  if (node.name === 'circle') {
    const radius = finite(node.attributes.r, 'circle radius');
    return ellipsePath({
      cx: node.attributes.cx ?? 0,
      cy: node.attributes.cy ?? 0,
      rx: radius,
      ry: radius,
    });
  }
  if (node.name === 'polygon') return polygonPath(node.attributes.points || '');
  if (node.name === 'text' || node.name === 'tspan') fail('text layers', 'only simple single-line ASCII text with a standard Helvetica font is supported');
  fail(`SVG element <${node.name}>`);
}

function transformPdfPoint(matrix, point) {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}

function multiplyPdfMatrices(left, right) {
  const [a, b, c, d, e, f] = left; const [g, h, i, j, k, l] = right;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j,
    a * k + c * l + e, b * k + d * l + f].map(value => finite(value, 'glyph transform'));
}

function inversePdfMatrix(matrix) {
  const [a, b, c, d, e, f] = matrix; const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) fail('positioned glyph transforms', 'singular glyph matrices are unsupported');
  return [d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant, (b * e - a * f) / determinant].map(value => finite(value, 'glyph inverse transform'));
}

function cubicAxisAt(points, t) {
  const inverse = 1 - t;
  return inverse ** 3 * points[0] + 3 * inverse ** 2 * t * points[1]
    + 3 * inverse * t ** 2 * points[2] + t ** 3 * points[3];
}

function cubicAxisExtrema(points) {
  const [p0, p1, p2, p3] = points;
  const a = -p0 + 3 * p1 - 3 * p2 + p3; const b = 3 * p0 - 6 * p1 + 3 * p2; const c = -3 * p0 + 3 * p1;
  const qa = 3 * a; const qb = 2 * b; const roots = [];
  if (Math.abs(qa) < 1e-14) {
    if (Math.abs(qb) > 1e-14) roots.push(-c / qb);
  } else {
    const discriminant = qb * qb - 4 * qa * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      roots.push((-qb + root) / (2 * qa), (-qb - root) / (2 * qa));
    }
  }
  return [p0, p3, ...roots.filter(value => value > 0 && value < 1).map(value => cubicAxisAt(points, value))];
}

function fontPathBounds(data, matrix = [1, 0, 0, 1, 0, 0]) {
  if (!data.trim()) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const tokens = tokenizePath(data); let index = 0; let command = null;
  let x = 0; let y = 0; let startX = 0; let startY = 0;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const take = () => tokens[index++];
  const add = points => {
    const transformed = points.map(point => transformPdfPoint(matrix, point));
    const xs = cubicAxisExtrema(transformed.map(point => point.x));
    const ys = cubicAxisExtrema(transformed.map(point => point.y));
    bounds.minX = Math.min(bounds.minX, ...xs); bounds.minY = Math.min(bounds.minY, ...ys);
    bounds.maxX = Math.max(bounds.maxX, ...xs); bounds.maxY = Math.max(bounds.maxY, ...ys);
  };
  while (index < tokens.length) {
    if (typeof tokens[index] === 'string') command = take();
    if (command === 'M') {
      x = take(); y = take(); startX = x; startY = y;
      const q = transformPdfPoint(matrix, { x, y });
      bounds.minX = Math.min(bounds.minX, q.x); bounds.minY = Math.min(bounds.minY, q.y);
      bounds.maxX = Math.max(bounds.maxX, q.x); bounds.maxY = Math.max(bounds.maxY, q.y);
      command = 'L';
    } else if (command === 'L') {
      const end = { x: take(), y: take() }; const start = { x, y };
      add([start, { x: x + (end.x - x) / 3, y: y + (end.y - y) / 3 },
        { x: x + 2 * (end.x - x) / 3, y: y + 2 * (end.y - y) / 3 }, end]);
      x = end.x; y = end.y;
    } else if (command === 'C') {
      const points = [{ x, y }, { x: take(), y: take() }, { x: take(), y: take() }, { x: take(), y: take() }];
      add(points); x = points[3].x; y = points[3].y;
    } else if (command === 'Q') {
      const control = { x: take(), y: take() }; const end = { x: take(), y: take() };
      const start = { x, y };
      add([start, { x: x + (2 / 3) * (control.x - x), y: y + (2 / 3) * (control.y - y) },
        { x: end.x + (2 / 3) * (control.x - end.x), y: end.y + (2 / 3) * (control.y - end.y) }, end]);
      x = end.x; y = end.y;
    } else if (command === 'Z' || command === 'z') {
      const start = { x: startX, y: startY }; const current = { x, y };
      add([current, { x: x + (startX - x) / 3, y: y + (startY - y) / 3 },
        { x: x + 2 * (startX - x) / 3, y: y + 2 * (startY - y) / 3 }, start]);
      x = startX; y = startY; command = null;
    } else fail(`SVG path command ${command}`, 'only absolute M, L, Q, C, and Z commands are supported');
  }
  if (!Number.isFinite(bounds.minX)) fail('empty positioned glyphs', 'glyph outlines need at least one contour point');
  return bounds;
}

function utf16Hex(value, { bom = false } = {}) {
  let hex = bom ? 'FEFF' : '';
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) fail('positioned glyph Unicode', 'isolated surrogate values are not supported');
    if (code <= 0xffff) hex += code.toString(16).padStart(4, '0');
    else {
      const shifted = code - 0x10000;
      hex += (0xd800 + (shifted >> 10)).toString(16).padStart(4, '0');
      hex += (0xdc00 + (shifted & 0x3ff)).toString(16).padStart(4, '0');
    }
  }
  return hex.toUpperCase();
}

function buildType3ToUnicode(glyphs) {
  const chunks = [];
  for (let start = 0; start < glyphs.length; start += 100) {
    const entries = glyphs.slice(start, start + 100).map((glyph, index) => {
      const code = (start + index + 1).toString(16).padStart(2, '0').toUpperCase();
      return `<${code}> <${utf16Hex(glyph.text)}>`;
    });
    chunks.push(`${entries.length} beginbfchar\n${entries.join('\n')}\nendbfchar`);
  }
  return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n'
    + '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
    + '/CMapName /TISGlyphUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<01> <FF>\nendcodespacerange\n'
    + `${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}

function parseCanonicalMetadataJson(source, label, reject) {
  let parsed;
  try { parsed = JSON.parse(source); }
  catch { reject(`${label} contains malformed JSON`); }
  // The SVG exporter writes compact JSON.stringify output. Requiring that
  // exact representation rejects duplicate JSON keys instead of allowing
  // parser-dependent first/last-key wins for font placement or Unicode.
  if (JSON.stringify(parsed) !== source) reject(`${label} metadata is not canonical JSON`);
  return parsed;
}

function addType3Subset(context, sourceGlyphs, run) {
  const name = `F${context.fontNames.size + 1}`;
  const unitScale = 1000 / run.upem;
  const normalizedNumber = (value, label) => {
    if (!Number.isFinite(value) || Math.abs(value) > LIMITS.maxCoordinate) {
      fail('positioned glyph metrics', `${label} exceeds the bounded Type3 font coordinate range`);
    }
    return value;
  };
  const glyphs = sourceGlyphs.map((source, index) => {
    const anchor = source.glyphs[0]; const anchorInverse = inversePdfMatrix(anchor.matrix);
    const drawing = []; let bounds = null; let advance = 0;
    for (const glyph of source.glyphs) {
      advance += glyph.xAdvance;
      const relative = multiplyPdfMatrices(anchorInverse, glyph.matrix);
      const d = pathOperators(glyph.path, { closeOpen: true });
      const pathBounds = fontPathBounds(glyph.path, relative);
      bounds = bounds ? { minX: Math.min(bounds.minX, pathBounds.minX), minY: Math.min(bounds.minY, pathBounds.minY),
        maxX: Math.max(bounds.maxX, pathBounds.maxX), maxY: Math.max(bounds.maxY, pathBounds.maxY) } : pathBounds;
      const normalized = relative.map(value => normalizedNumber(value * unitScale, 'glyph matrix'));
      const isIdentity = normalized.every((value, index) => Math.abs(value - [1, 0, 0, 1, 0, 0][index]) < 1e-12);
      drawing.push('q', ...(isIdentity ? [] : [`${normalized.map(pdfNumber).join(' ')} cm`]), d, 'f', 'Q');
    }
    if (!bounds || !Number.isFinite(advance)) fail('positioned glyph metrics', 'glyph paths and advances must be finite');
    const metadata = source;
    const normalizedBounds = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]
      .map(value => normalizedNumber(value * unitScale, 'glyph bounds'));
    const normalizedAdvance = normalizedNumber(advance * unitScale, 'glyph advance');
    const charProc = `${pdfNumber(normalizedAdvance)} 0 ${normalizedBounds.map(pdfNumber).join(' ')} d1\n${drawing.join('\n')}\n`;
    return { code: index + 1, name: `g${String(index + 1).padStart(3, '0')}`, text: metadata.text,
      advance: normalizedAdvance, bounds: normalizedBounds, charProc,
      matrix: [anchor.matrix[0] * run.upem, anchor.matrix[1] * run.upem,
        anchor.matrix[2] * run.upem, anchor.matrix[3] * run.upem,
        anchor.matrix[4], anchor.matrix[5]] };
  });
  const scaleMetric = value => normalizedNumber(value * unitScale, 'font metric');
  const metricBox = [
    Math.min(0, ...glyphs.map(glyph => glyph.bounds[0])),
    Math.min(scaleMetric(run.descender), ...glyphs.map(glyph => glyph.bounds[1])),
    Math.max(0, ...glyphs.map(glyph => glyph.bounds[2])),
    Math.max(scaleMetric(run.ascender), ...glyphs.map(glyph => glyph.bounds[3])),
  ];
  const descriptor = {
    type: 'Type3', glyphs, toUnicode: buildType3ToUnicode(glyphs), bbox: metricBox,
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    ascent: scaleMetric(run.ascender), descent: scaleMetric(run.descender),
  };
  context.fontNames.set(name, name); context.fonts.set(name, descriptor);
  return { name, glyphs };
}

function parsePositionedPdfText(node, context) {
  const reject = detail => fail('positioned glyph metadata', detail);
  if (Object.keys(node.attributes).sort().join('|') !== 'data-tiny-image-star-pdf-text|opacity') reject('the semantic group has unexpected attributes');
  if (node.attributes['data-tiny-image-star-pdf-text'] !== '1' || parseOpacity(node.attributes.opacity, 'PDF text semantics opacity') !== 0) {
    reject('the nonpainting semantic group marker is invalid');
  }
  if (node.children.some(child => child.name === '#text' && child.text.trim())) reject('the semantic group cannot contain free text');
  const ops = [];
  let groupTextBudget = 0;
  for (const runNode of node.children.filter(child => child.name !== '#text')) {
    if (runNode.name !== 'g') reject('semantic runs must be groups');
    if (Object.keys(runNode.attributes).join('|') !== 'data-tiny-image-star-pdf-run') reject('semantic runs have unexpected attributes');
    if (runNode.children.some(child => child.name === '#text' && child.text.trim())) reject('semantic runs cannot contain free text');
    const run = parseCanonicalMetadataJson(runNode.attributes['data-tiny-image-star-pdf-run'], 'semantic run', reject);
    if (!run || typeof run !== 'object' || Array.isArray(run)
      || Object.keys(run).some(key => !['text', 'upem', 'ascender', 'descender'].includes(key))
      || Object.keys(run).length !== 4 || typeof run.text !== 'string' || run.text.length > 32768
      || !Number.isFinite(run.upem) || run.upem < 1 || run.upem > 1_000_000
      || !Number.isFinite(run.ascender) || !Number.isFinite(run.descender) || run.ascender <= run.descender
      || Math.abs(run.ascender) > 1_000_000 || Math.abs(run.descender) > 1_000_000) {
      reject('semantic run text and font metrics are incomplete or outside limits');
    }
    groupTextBudget += run.text.length * 2;
    if (groupTextBudget > 1024 * 1024) reject('semantic text exceeds the bounded Unicode budget');
    context.pdfTextBudget.runs += 1;
    context.pdfTextBudget.metadataCharacters += runNode.attributes['data-tiny-image-star-pdf-run'].length;
    if (context.pdfTextBudget.runs > LIMITS.maxPdfTextRuns || context.pdfTextBudget.metadataCharacters > LIMITS.maxPdfTextMetadataCharacters) {
      reject('semantic run metadata exceeds the document budget');
    }
    const clusterMap = new Map(); let pathCharacters = 0;
    for (const glyphNode of runNode.children.filter(child => child.name !== '#text')) {
      if (glyphNode.name !== 'path') reject('semantic glyphs must use actual vector path outlines');
      if (Object.keys(glyphNode.attributes).sort().join('|') !== 'd|data-tiny-image-star-pdf-glyph') reject('semantic glyphs have unexpected attributes');
      const glyph = parseCanonicalMetadataJson(glyphNode.attributes['data-tiny-image-star-pdf-glyph'], 'semantic glyph', reject);
      if (!glyph || typeof glyph !== 'object' || Array.isArray(glyph)
        || Object.keys(glyph).some(key => !['matrix', 'xAdvance', 'yAdvance', 'cluster', 'text'].includes(key))
        || Object.keys(glyph).length !== 5 || !Array.isArray(glyph.matrix) || glyph.matrix.length !== 6
        || !glyph.matrix.every(Number.isFinite) || glyph.matrix.some(value => Math.abs(value) > LIMITS.maxCoordinate)
        || !Number.isFinite(glyph.xAdvance) || Math.abs(glyph.xAdvance) > LIMITS.maxCoordinate
        || !Number.isFinite(glyph.yAdvance) || Math.abs(glyph.yAdvance) > LIMITS.maxCoordinate
        || Math.abs(glyph.yAdvance) > 1e-9 || !Number.isSafeInteger(glyph.cluster) || glyph.cluster < 0
        || glyph.cluster >= run.text.length || typeof glyph.text !== 'string' || !glyph.text
        || run.text.slice(glyph.cluster, glyph.cluster + glyph.text.length) !== glyph.text) {
        reject('a glyph matrix, advance, cluster, or Unicode mapping is invalid');
      }
      const [a, b, c, d] = glyph.matrix;
      if (Math.abs(a * d - b * c) < 1e-12) reject('singular glyph transforms are unsupported');
      const path = glyphNode.attributes.d || '';
      if (path.length > LIMITS.maxPdfTextGlyphPathCharacters) reject('a glyph outline exceeds the bounded per-glyph path data limit');
      pathCharacters += path.length;
      context.pdfTextBudget.pathCharacters += path.length;
      if (pathCharacters > LIMITS.maxPdfTextPathCharacters || context.pdfTextBudget.pathCharacters > LIMITS.maxPdfTextPathCharacters) {
        reject('glyph outlines exceed the bounded path data budget');
      }
      pathOperators(path, { closeOpen: true });
      context.pdfTextBudget.metadataCharacters += glyphNode.attributes['data-tiny-image-star-pdf-glyph'].length;
      if (context.pdfTextBudget.metadataCharacters > LIMITS.maxPdfTextMetadataCharacters) reject('semantic metadata exceeds the document budget');
      context.pdfTextBudget.glyphs += 1;
      if (context.pdfTextBudget.glyphs > LIMITS.maxPdfTextGlyphs) reject('glyph outlines exceed the per-document count limit');
      let cluster = clusterMap.get(glyph.cluster);
      if (!cluster) {
        cluster = { text: glyph.text, glyphs: [] }; clusterMap.set(glyph.cluster, cluster);
      } else if (cluster.text !== glyph.text) reject('glyphs sharing a cluster disagree about its text');
      cluster.glyphs.push({ ...glyph, path });
    }
    if (!clusterMap.size) {
      if (run.text) reject('nonempty semantic runs require actual glyph records');
      continue;
    }
    const clusters = [...clusterMap.entries()].sort((left, right) => left[0] - right[0]).map(([, cluster]) => cluster);
    let expectedClusterStart = 0;
    for (const [clusterStart, cluster] of [...clusterMap.entries()].sort((left, right) => left[0] - right[0])) {
      if (clusterStart !== expectedClusterStart) reject('glyph clusters do not cover the complete displayed run text');
      expectedClusterStart += cluster.text.length;
    }
    if (expectedClusterStart !== run.text.length) reject('glyph clusters do not cover the complete displayed run text');
    const subsets = [];
    for (let start = 0; start < clusters.length; start += 255) subsets.push(addType3Subset(context, clusters.slice(start, start + 255), run));
    for (const subset of subsets) for (const glyph of subset.glyphs) {
      ops.push('BT', `/${subset.name} 1 Tf`, '3 Tr', `${glyph.matrix.map(pdfNumber).join(' ')} Tm`, `<${glyph.code.toString(16).padStart(2, '0').toUpperCase()}> Tj`, 'ET');
    }
  }
  return ops.join('\n');
}

const WIN_ANSI_SPECIAL_BYTES = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

function winAnsiByte(character) {
  const codePoint = character.codePointAt(0);
  if (codePoint >= 0x20 && codePoint <= 0x7e) return codePoint;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint;
  return WIN_ANSI_SPECIAL_BYTES.get(codePoint) ?? null;
}

function pdfTextLiteral(value) {
  const bytes = [];
  for (const character of value) {
    const byte = winAnsiByte(character);
    if (byte == null) {
      fail('text glyph coverage', 'standard Helvetica PDF fonts support printable ASCII and WinAnsi/Windows-1252 Latin characters; use raster PDF for other glyphs');
    }
    bytes.push(byte);
  }
  // Keep the compact, readable PDF literals for ASCII output. High bytes must
  // be emitted as a hex string: UTF-8 encoding the PDF source would otherwise
  // turn one WinAnsi glyph code into multiple, incorrect glyph codes.
  if (bytes.every(byte => byte <= 0x7e)) {
    return `(${value.replace(/[\\()]/g, character => `\\${character}`)})`;
  }
  return `<${bytes.map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}>`;
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

function paintPositionedRichTextRuns(line, parentAttributes, parentSize, ascent, alpha, context) {
  const runs = line.children.filter(child => child.name !== '#text');
  if (!runs.length) return null;
  if (line.children.some(child => child.name === '#text' && child.text.length)) {
    fail('rich text', 'positioned rich-text lines require every run to carry measured PDF coordinates');
  }
  if (runs.some(run => run.name !== 'tspan')) {
    fail('rich text', 'only flat inline text runs with measured PDF positions are supported');
  }

  const commands = [];
  for (const run of runs) {
    const attrs = run.attributes;
    assertAttributes(run, new Set([
      'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
      'fill', 'baseline-shift', 'x', 'y', 'text-anchor', 'textLength', 'lengthAdjust',
    ]));
    if (attrs['data-tiny-image-star-pdf-rich-run'] !== '1'
      || ['x', 'y', 'width', 'natural-width'].some(name => attrs[`data-tiny-image-star-pdf-${name}`] == null)) {
      fail('rich text metrics', 'the SVG does not contain measured PDF positions and widths for every inline run');
    }
    if (run.children.some(child => child.name !== '#text')) {
      fail('rich text', 'nested styled spans need font shaping and per-run positioning');
    }
    const letterSpacing = finite(attrs['letter-spacing'] ?? 0, 'rich text letter spacing');
    if (letterSpacing !== 0) fail('letter spacing', 'the vector PDF text subset requires zero letter spacing on every run');
    const positioned = attrs['data-tiny-image-star-pdf-text-position'] != null;
    if (positioned && !['normal', 'superscript', 'subscript'].includes(attrs['data-tiny-image-star-pdf-text-position'])) {
      fail('text position', 'the generated run uses an unknown superscript/subscript mode');
    }
    const trimmed = attrs['data-tiny-image-star-pdf-leading-trim'] != null;
    if (trimmed && !['NONE', 'CAP_HEIGHT'].includes(attrs['data-tiny-image-star-pdf-leading-trim'])) {
      fail('leading trim', 'the generated run uses an unknown vertical trim mode');
    }
    const alphabetic = attrs['data-tiny-image-star-pdf-baseline'] != null;
    if (alphabetic && (attrs['data-tiny-image-star-pdf-baseline'] !== 'alphabetic'
      || parentAttributes['data-tiny-image-star-pdf-baseline'] !== 'alphabetic')) {
      fail('text baseline placement', 'the run baseline must match its generated alphabetic parent');
    }
    const measuredPlacement = positioned || trimmed || alphabetic;
    const shiftText = String(attrs['baseline-shift'] ?? 0);
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?$/iu.test(shiftText)) {
      fail('rich text baseline shifts', 'only bounded generated pixel offsets have a PDF mapping');
    }
    const baselineShift = finite(shiftText.replace(/px$/iu, ''), 'rich text baseline shift');
    if (baselineShift !== 0 && !measuredPlacement) fail('rich text baseline shifts', 'per-run baseline shifts need font-specific metrics; use raster PDF');
    const size = finite(attrs['font-size'] ?? parentSize, 'rich text font size');
    if (size <= 0) throw new TypeError('SVG rich text font sizes must be positive.');
    if (size !== parentSize && !measuredPlacement) {
      fail('rich text font metrics', 'inline runs must use the text layer font size so the measured baseline remains exact');
    }
    let runAscent = ascent;
    if (measuredPlacement) {
      if (attrs['data-tiny-image-star-pdf-run-ascent'] == null) fail('text position metrics', 'a positioned run needs measured standard-font ascent');
      runAscent = finite(attrs['data-tiny-image-star-pdf-run-ascent'], 'positioned text run ascent');
      if (!(runAscent > 0) || runAscent > size * 4 || Math.abs(baselineShift) > 100_000) {
        fail('text position metrics', 'the generated run size/ascent/offset exceeds the supported metric range');
      }
    }

    const value = run.children.map(child => child.text).join('');
    if (!value) continue;
    const literal = pdfTextLiteral(value);
    const x = finite(attrs['data-tiny-image-star-pdf-x'], 'rich text run x');
    const y = finite(attrs['data-tiny-image-star-pdf-y'], 'rich text run y') + (alphabetic ? 0 : runAscent) - baselineShift;
    const desiredWidth = finite(attrs['data-tiny-image-star-pdf-width'], 'rich text run width');
    const naturalWidth = finite(attrs['data-tiny-image-star-pdf-natural-width'], 'standard-font rich text run width');
    if (['x', 'y', 'text-anchor', 'textLength', 'lengthAdjust'].some(name => attrs[name] != null)) {
      if (!measuredPlacement || attrs['text-anchor'] !== 'start' || attrs.lengthAdjust !== 'spacingAndGlyphs'
        || Math.abs(finite(attrs.x, 'positioned SVG run x') - x) > 1e-8
        || Math.abs(finite(attrs.y, 'positioned SVG run y') - finite(attrs['data-tiny-image-star-pdf-y'], 'visible SVG run y')) > 1e-8
        || Math.abs(finite(attrs.textLength, 'positioned SVG run width') - desiredWidth) > 1e-8) {
        fail('text position metrics', 'the generated PDF position must match the visible SVG run position and width');
      }
    }
    if (desiredWidth <= 0 || naturalWidth <= 0) {
      fail('rich text font metrics', 'the editor did not provide positive measured run widths; use raster PDF');
    }
    const horizontalScale = desiredWidth / naturalWidth * 100;
    if (!Number.isFinite(horizontalScale) || horizontalScale <= 0 || horizontalScale > 10_000) {
      fail('rich text font metrics', 'the requested inline run width is outside the supported PDF text scale');
    }
    const font = textFont(attrs, context);
    const fill = colorOperator(attrs.fill ?? parentAttributes.fill ?? '#000000', 'fill');
    if (!fill) continue;
    const state = alphaState(alpha, 1, context.stateNames);
    commands.push(
      'q', `1 0 0 -1 0 ${pdfNumber(2 * y)} cm`, fill, state,
      'BT', `/${font} ${pdfNumber(size)} Tf`, `${pdfNumber(horizontalScale)} Tz`,
      `1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm`, `${literal} Tj`, 'ET', 'Q'
    );
  }
  return commands.flat().filter(Boolean).join('\n');
}

// Figma-style list markers are emitted as separately positioned SVG tspans.
// Their SVG textLength is measured using the user's local font, while vector
// PDF intentionally maps only Arial/Helvetica to the built-in Helvetica
// faces. Use the standard Helvetica AFM widths for the small marker alphabet
// supported by the editor (digits, Latin letters, period, and bullet), then
// horizontally scale to the SVG's measured width just like ordinary text.
const HELVETICA_MARKER_WIDTHS = Object.freeze({
  regular: Object.freeze({
    '.': 278,
    '0': 556, '1': 556, '2': 556, '3': 556, '4': 556,
    '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778,
    H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722,
    O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722,
    V: 667, W: 944, X: 667, Y: 667, Z: 611,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556,
    h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556,
    o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556,
    v: 500, w: 722, x: 500, y: 500, z: 500,
    '•': 350,
  }),
  bold: Object.freeze({
    '.': 278,
    '0': 556, '1': 556, '2': 556, '3': 556, '4': 556,
    '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
    A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722,
    H: 722, I: 333, J: 389, K: 722, L: 611, M: 889, N: 722,
    O: 722, P: 556, Q: 722, R: 667, S: 556, T: 611, U: 722,
    V: 667, W: 944, X: 667, Y: 667, Z: 611,
    a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611,
    h: 611, i: 278, j: 278, k: 556, l: 278, m: 889, n: 611,
    o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611,
    v: 556, w: 778, x: 556, y: 556, z: 500,
    '•': 350,
  }),
});

function standardHelveticaMarkerWidth(value, attributes, size) {
  const weight = String(attributes['font-weight'] || '400').toLowerCase();
  const widths = HELVETICA_MARKER_WIDTHS[weight === '700' || weight === 'bold' ? 'bold' : 'regular'];
  let units = 0;
  for (const character of value) {
    const width = widths[character];
    if (width == null) {
      fail('paragraph list marker metrics', 'the built-in Helvetica widths are unavailable for this marker; use raster PDF');
    }
    units += width;
  }
  return units * size / 1000;
}

function paintPositionedListMarker(marker, parentSize, ascent, alpha, context, alphabetic = false) {
  const attrs = marker.attributes;
  assertAttributes(marker, new Set([
    'x', 'y', 'text-anchor', 'text-transform', 'font-family', 'font-size',
    'font-weight', 'font-style', 'letter-spacing', 'fill', 'textLength', 'lengthAdjust',
  ]));
  if (marker.children.some(child => child.name !== '#text')) {
    fail('paragraph lists', 'nested marker spans are unsupported; use raster PDF');
  }
  if (attrs['text-transform'] != null && attrs['text-transform'] !== 'none') {
    fail('paragraph list marker transforms', 'transformed markers are unsupported; use raster PDF');
  }
  const letterSpacing = finite(attrs['letter-spacing'] ?? 0, 'list marker letter spacing');
  if (letterSpacing !== 0) fail('letter spacing', 'the vector PDF list-marker subset requires zero letter spacing');
  const size = finite(attrs['font-size'] ?? parentSize, 'list marker font size');
  if (size <= 0) throw new TypeError('SVG list marker font sizes must be positive.');
  if (size !== parentSize && !alphabetic) {
    fail('paragraph list marker metrics', 'list markers must use the text layer font size to preserve their measured baseline; use raster PDF');
  }

  const value = marker.children.map(child => child.text).join('');
  if (!value) return '';
  const literal = pdfTextLiteral(value);
  const anchor = attrs['text-anchor'] ?? 'start';
  if (anchor !== 'end') fail('paragraph list marker alignment', 'list markers need an end-aligned measured position');
  if (attrs['textLength'] == null || attrs.lengthAdjust !== 'spacingAndGlyphs') {
    fail('paragraph list marker metrics', 'list markers need measured textLength positioning; use raster PDF');
  }
  const desiredWidth = finite(attrs.textLength, 'list marker width');
  const naturalWidth = standardHelveticaMarkerWidth(value, attrs, size);
  if (desiredWidth <= 0 || naturalWidth <= 0) {
    fail('paragraph list marker metrics', 'the editor did not provide positive measured marker widths; use raster PDF');
  }
  const horizontalScale = desiredWidth / naturalWidth * 100;
  if (!Number.isFinite(horizontalScale) || horizontalScale <= 0 || horizontalScale > 10_000) {
    fail('paragraph list marker metrics', 'the requested marker width is outside the supported PDF text scale');
  }

  const x = finite(attrs.x, 'list marker x') - desiredWidth;
  const y = finite(attrs.y, 'list marker y') + ascent;
  const fill = colorOperator(attrs.fill ?? '#000000', 'fill');
  if (!fill) return '';
  const state = alphaState(alpha, 1, context.stateNames);
  const font = textFont(attrs, context);
  return [
    'q', `1 0 0 -1 0 ${pdfNumber(2 * y)} cm`, fill, state,
    'BT', `/${font} ${pdfNumber(size)} Tf`, `${pdfNumber(horizontalScale)} Tz`,
    `1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm`, `${literal} Tj`, 'ET', 'Q',
  ].filter(Boolean).join('\n');
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
  const textTransform = attrs['text-transform'] ?? 'none';
  if (!['none', 'uppercase', 'lowercase', 'capitalize'].includes(textTransform)) {
    fail('text transformations', `the text case “${textTransform}” is not supported; use raster PDF`);
  }
  if (attrs['xml:space'] != null && attrs['xml:space'] !== 'preserve') {
    fail('SVG text whitespace', 'only preserved SVG text whitespace is supported');
  }
  const letterSpacing = finite(attrs['letter-spacing'] ?? 0, 'text letter spacing');
  if (letterSpacing !== 0) fail('letter spacing', 'the vector PDF text subset currently requires zero letter spacing');
  const hasPositionedLines = node.children.some(child => child.name === 'tspan');
  const hasInlineRuns = node.children.some(line => line.name === 'tspan'
    && line.children.some(child => child.name === 'tspan'));
  const editorTextIsAlreadyTransformed = attrs['data-tiny-image-star-text-wrap'] === 'canvas-word-wrap';
  if (textTransform !== 'none' && hasInlineRuns && !editorTextIsAlreadyTransformed) {
    fail('rich text transformations', 'case conversion can cross styled run boundaries; use raster PDF');
  }
  // Editor SVG already contains the final case-transformed, measured text.
  // Re-transforming each wrapped line could capitalize a continuation line
  // that starts mid-word, so only apply SVG text-transform to untagged input.
  const transformText = value => editorTextIsAlreadyTransformed ? value : transformTextCase(value, textTransform);
  const hasEditorTextMetrics = attrs['data-tiny-image-star-pdf-ascent'] != null;
  if (hasPositionedLines && !hasEditorTextMetrics) {
    fail('rich text', 'positioned runs need measured PDF baseline and run-layout metadata; text paths and unmeasured runs are unsupported');
  }
  if (hasEditorTextMetrics && !hasPositionedLines) {
    fail('text line metrics', 'editor text metrics require positioned line spans');
  }
  if (hasPositionedLines && hasEditorTextMetrics) {
    const alphabetic = attrs['data-tiny-image-star-pdf-baseline'] != null;
    if (alphabetic && attrs['data-tiny-image-star-pdf-baseline'] !== 'alphabetic'
      || attrs['dominant-baseline'] !== (alphabetic ? 'alphabetic' : 'text-before-edge')) {
      fail('text baseline placement', 'positioned editor text must bind its visible baseline to its measured placement');
    }
    const ascent = finite(attrs['data-tiny-image-star-pdf-ascent'], 'measured text ascent');
    if (ascent <= 0) fail('text baseline placement', 'the editor did not provide a positive standard-font ascent; use raster PDF');
    if (node.children.some(child => child.name !== 'tspan')) {
      fail('rich text', 'positioned lines cannot mix direct text and nested spans');
    }
    const size = finite(attrs['font-size'] ?? 16, 'font size');
    if (size <= 0) throw new TypeError('SVG text font size must be positive.');
    const alpha = inheritedOpacity * parseOpacity(attrs['fill-opacity'], 'text fill opacity');
    textFont(attrs, context);
    const commands = [];
    for (const line of node.children) {
      if (line.attributes['data-tiny-image-star-list-marker'] != null) {
        const marker = paintPositionedListMarker(line, size, alphabetic ? 0 : ascent, alpha, context, alphabetic);
        if (marker) commands.push(marker);
        continue;
      }
      assertAttributes(line, new Set(['x', 'y', 'text-anchor', 'textLength', 'lengthAdjust', 'word-spacing']));
      if (line.children.some(child => child.name === 'tspan')) {
        if (line.attributes['word-spacing'] != null && finite(line.attributes['word-spacing'], 'text word spacing') !== 0) {
          fail('rich text justification', 'justified word spacing needs per-word PDF positions; use raster PDF');
        }
        const richLine = paintPositionedRichTextRuns(line, attrs, size, ascent, alpha, context);
        if (richLine) commands.push(richLine);
        continue;
      }
      if (line.attributes['word-spacing'] != null) {
        fail('text word spacing', 'justified text needs measured rich-run positioning; use raster PDF when those metrics are unavailable');
      }
      if (line.children.some(child => child.name !== '#text')) {
        fail('rich text', 'nested styled spans need font shaping and per-run positioning');
      }
      const fill = colorOperator(attrs.fill ?? '#000000', 'fill');
      if (!fill) return '';
      const state = alphaState(alpha, 1, context.stateNames);
      const font = textFont(attrs, context);
      const textAnchor = line.attributes['text-anchor'] ?? attrs['text-anchor'] ?? 'start';
      if (!['start', 'middle', 'end'].includes(textAnchor)) {
        fail('text alignment', 'positioned lines support only start, middle, or end text anchors');
      }
      const value = transformText(line.children.map(child => child.text).join(''));
      if (!value) continue;
      const literal = pdfTextLiteral(value);
      let x = finite(line.attributes.x, 'text line x');
      const y = finite(line.attributes.y, 'text line y') + (alphabetic ? 0 : ascent);
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
        if (textAnchor === 'middle') x -= desiredWidth / 2;
        else if (textAnchor === 'end') x -= desiredWidth;
      } else if (textAnchor !== 'start') {
        fail('text alignment', 'centered or right-aligned PDF lines need measured textLength; use raster PDF when line metrics are unavailable');
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
  if (attrs['text-anchor'] != null && attrs['text-anchor'] !== 'start') {
    fail('text alignment', 'centered or right-aligned SVG text needs positioned line metrics; use raster PDF');
  }
  const value = transformText(node.children.map(child => child.text).join(''));
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
      maskType: definition.kind === 'luminance' ? 'Luminosity' : 'Alpha',
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
  if (!match) fail('external masks', 'only local mask references are supported');
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

const SHADOW_RASTER_LIMITS = Object.freeze({ maxPixels: 4_000_000, maxAggregatePixels: 12_000_000, maxDimension: 4096, maxKernelWork: 40_000_000 });

function zlibStored(bytes) {
  // Shadow rasters contain a flat RGB color plus a soft alpha mask. A bounded
  // stored DEFLATE stream avoids a browser-only dependency in this module,
  // which is loaded directly as a native ES module by the app.
  const blockCount = Math.max(1, Math.ceil(bytes.length / 65_535));
  const output = new Uint8Array(2 + bytes.length + blockCount * 5 + 4);
  let offset = 0;
  output[offset++] = 0x78;
  output[offset++] = 0x01;
  for (let sourceOffset = 0; sourceOffset < bytes.length || sourceOffset === 0; sourceOffset += 65_535) {
    const length = Math.min(65_535, bytes.length - sourceOffset);
    const final = sourceOffset + length >= bytes.length;
    output[offset++] = final ? 1 : 0;
    output[offset++] = length & 0xff;
    output[offset++] = length >>> 8;
    const inverse = (~length) & 0xffff;
    output[offset++] = inverse & 0xff;
    output[offset++] = inverse >>> 8;
    output.set(bytes.subarray(sourceOffset, sourceOffset + length), offset);
    offset += length;
    if (final) break;
  }
  let s1 = 1;
  let s2 = 0;
  for (const byte of bytes) {
    s1 = (s1 + byte) % 65_521;
    s2 = (s2 + s1) % 65_521;
  }
  const adler = ((s2 << 16) | s1) >>> 0;
  output[offset++] = adler >>> 24;
  output[offset++] = adler >>> 16;
  output[offset++] = adler >>> 8;
  output[offset++] = adler & 0xff;
  return output;
}

function shadowShapeGeometry(node) {
  const attrs = node.attributes;
  // Validate every accepted SVG shape with the same geometry parser used by
  // the vector painter, then derive only the bounds needed by the bounded blur.
  shapePath(node);
  if (node.name === 'rect') {
    const x = finite(attrs.x ?? 0, 'shadow rectangle x');
    const y = finite(attrs.y ?? 0, 'shadow rectangle y');
    const width = finite(attrs.width, 'shadow rectangle width');
    const height = finite(attrs.height, 'shadow rectangle height');
    if (width <= 0 || height <= 0) throw new TypeError('Drop-shadow rectangles require positive dimensions.');
    const rx = Math.min(width / 2, Math.max(0, finite(attrs.rx ?? attrs.ry ?? 0, 'shadow rectangle x radius')));
    const ry = Math.min(height / 2, Math.max(0, finite(attrs.ry ?? attrs.rx ?? 0, 'shadow rectangle y radius')));
    return {
      type: 'rect', x, y, width, height, rx, ry,
      minX: finite(x, 'shadow rectangle left edge'), minY: finite(y, 'shadow rectangle top edge'),
      maxX: finite(x + width, 'shadow rectangle right edge'), maxY: finite(y + height, 'shadow rectangle bottom edge'),
    };
  }
  if (node.name === 'ellipse' || node.name === 'circle') {
    const radius = node.name === 'circle' ? finite(attrs.r, 'shadow circle radius') : null;
    const cx = finite(attrs.cx ?? 0, 'shadow ellipse center x');
    const cy = finite(attrs.cy ?? 0, 'shadow ellipse center y');
    const rx = radius ?? finite(attrs.rx, 'shadow ellipse radius x');
    const ry = radius ?? finite(attrs.ry, 'shadow ellipse radius y');
    if (rx <= 0 || ry <= 0) throw new TypeError('Drop-shadow ellipses require positive radii.');
    return {
      type: 'ellipse', cx, cy, rx, ry,
      minX: finite(cx - rx, 'shadow ellipse left edge'), minY: finite(cy - ry, 'shadow ellipse top edge'),
      maxX: finite(cx + rx, 'shadow ellipse right edge'), maxY: finite(cy + ry, 'shadow ellipse bottom edge'),
    };
  }
  if (node.name === 'polygon') {
    const points = attrs.points.trim().split(/[\s,]+/).filter(Boolean).map(value => finite(value, 'shadow polygon coordinate'));
    if (points.length < 6 || points.length % 2) fail('degenerate drop-shadow polygons', 'at least three coordinate pairs are required');
    if (points.length > 1024) fail('high-complexity drop-shadow polygons', 'shadow masks are limited to 512 vertices');
    const vertices = [];
    for (let index = 0; index < points.length; index += 2) vertices.push({ x: points[index], y: points[index + 1] });
    return {
      type: 'polygon', vertices,
      minX: Math.min(...vertices.map(point => point.x)), minY: Math.min(...vertices.map(point => point.y)),
      maxX: Math.max(...vertices.map(point => point.x)), maxY: Math.max(...vertices.map(point => point.y)),
      fillRule: attrs['fill-rule'] || 'nonzero',
    };
  }
  fail('drop shadows on this geometry', 'only rectangles, ellipses, circles, and simple polygons are supported');
}

function pointInsideShadowShape(shape, x, y) {
  if (shape.type === 'rect') {
    if (x < shape.minX || x > shape.maxX || y < shape.minY || y > shape.maxY) return false;
    if (!shape.rx || !shape.ry) return true;
    const cx = Math.max(shape.minX + shape.rx, Math.min(shape.maxX - shape.rx, x));
    const cy = Math.max(shape.minY + shape.ry, Math.min(shape.maxY - shape.ry, y));
    const dx = (x - cx) / shape.rx;
    const dy = (y - cy) / shape.ry;
    return dx * dx + dy * dy <= 1;
  }
  if (shape.type === 'ellipse') {
    const dx = (x - shape.cx) / shape.rx;
    const dy = (y - shape.cy) / shape.ry;
    return dx * dx + dy * dy <= 1;
  }
  let winding = 0;
  let crossings = 0;
  for (let index = 0; index < shape.vertices.length; index += 1) {
    const start = shape.vertices[index];
    const end = shape.vertices[(index + 1) % shape.vertices.length];
    if ((start.y <= y && end.y > y) || (start.y > y && end.y <= y)) {
      const crossX = start.x + ((y - start.y) * (end.x - start.x)) / (end.y - start.y);
      if (crossX > x) crossings += 1;
    }
    const cross = (end.x - start.x) * (y - start.y) - (x - start.x) * (end.y - start.y);
    if (start.y <= y && end.y > y && cross > 0) winding += 1;
    else if (start.y > y && end.y <= y && cross < 0) winding -= 1;
  }
  return shape.fillRule === 'evenodd' ? crossings % 2 === 1 : winding !== 0;
}

function gaussianBlur(alpha, width, height, sigma) {
  const radius = sigma > 0 ? Math.ceil(3 * sigma) : 0;
  if (radius > 256) fail('oversized drop-shadow blur kernel', 'the local Gaussian radius exceeds the bounded PDF workload');
  if (!radius) return alpha;
  const operations = width * height * (2 * radius + 1) * 2;
  if (!Number.isSafeInteger(operations) || operations > SHADOW_RASTER_LIMITS.maxKernelWork) {
    fail('drop-shadow blur workload', 'the requested blur exceeds the bounded local PDF raster budget');
  }
  const weights = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let index = -radius; index <= radius; index += 1) {
    const weight = Math.exp(-(index * index) / (2 * sigma * sigma));
    weights[index + radius] = weight;
    total += weight;
  }
  for (let index = 0; index < weights.length; index += 1) weights[index] /= total;
  const horizontal = new Float32Array(width * height);
  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceX = x + offset;
        if (sourceX >= 0 && sourceX < width) value += alpha[row + sourceX] * weights[offset + radius];
      }
      horizontal[row + x] = value;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceY = y + offset;
        if (sourceY >= 0 && sourceY < height) value += horizontal[sourceY * width + x] * weights[offset + radius];
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

function shadowImageForShape(shapeNode, filter, context) {
  const attrs = shapeNode.attributes;
  if (attrs.stroke && attrs.stroke !== 'none') {
    fail('drop shadows on stroked geometry', 'the supported raster shadow source must have a single solid fill and no stroke');
  }
  const fill = attrs.fill ?? '#000000';
  if (fill === 'none') return null;
  if (fill.startsWith('url(')) fail('drop shadows on gradient fills', 'only one solid source fill is supported');
  colorComponents(fill, 'drop-shadow source');
  const fillOpacity = parseOpacity(attrs['fill-opacity'], 'drop-shadow source fill opacity');
  if (fillOpacity === 0 || filter.floodOpacity === 0) return null;
  const shape = shadowShapeGeometry(shapeNode);
  const padding = filter.stdDeviation * 3;
  const boxWidth = shape.maxX - shape.minX + 2 * padding;
  const boxHeight = shape.maxY - shape.minY + 2 * padding;
  const density = Math.min(2, Math.sqrt(SHADOW_RASTER_LIMITS.maxPixels / (boxWidth * boxHeight)),
    SHADOW_RASTER_LIMITS.maxDimension / boxWidth, SHADOW_RASTER_LIMITS.maxDimension / boxHeight);
  if (!Number.isFinite(density) || density < 0.125) {
    fail('oversized drop-shadow source', 'the vector shape is too large for the bounded shadow raster budget');
  }
  const width = Math.max(1, Math.ceil(boxWidth * density));
  const height = Math.max(1, Math.ceil(boxHeight * density));
  const pixelCount = width * height;
  if (pixelCount > SHADOW_RASTER_LIMITS.maxPixels
    || context.shadowPixelCount + pixelCount > SHADOW_RASTER_LIMITS.maxAggregatePixels) {
    fail('drop-shadow raster budget', 'the page exceeds the bounded local shadow-raster pixel limit');
  }
  context.shadowPixelCount += pixelCount;
  const x = shape.minX - padding;
  const y = shape.minY - padding;
  const sourceAlpha = new Float32Array(pixelCount);
  const samples = [0.25, 0.75];
  const sampleWork = pixelCount * samples.length ** 2 * (shape.vertices?.length || 1);
  if (!Number.isSafeInteger(sampleWork) || sampleWork > SHADOW_RASTER_LIMITS.maxKernelWork) {
    fail('drop-shadow geometry workload', 'the source shape exceeds the bounded local shadow-raster budget');
  }
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let coverage = 0;
      for (const oy of samples) for (const ox of samples) {
        const sampleX = x + (px + ox) / density;
        const sampleY = y + (py + oy) / density;
        if (pointInsideShadowShape(shape, sampleX, sampleY)) coverage += 0.25;
      }
      sourceAlpha[py * width + px] = coverage * fillOpacity;
    }
  }
  const blurredAlpha = gaussianBlur(sourceAlpha, width, height, filter.stdDeviation * density);
  const shadowAlpha = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    shadowAlpha[index] = Math.max(0, Math.min(255, Math.round(blurredAlpha[index] * filter.floodOpacity * 255)));
  }
  const [red, green, blue] = colorComponents(filter.floodColor, 'drop-shadow').map(component => Math.round(component * 255));
  const colorBytes = new Uint8Array(pixelCount * 3);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 3;
    colorBytes[offset] = red;
    colorBytes[offset + 1] = green;
    colorBytes[offset + 2] = blue;
  }
  const descriptor = {
    width, height, displayWidth: width, displayHeight: height, orientation: 1,
    bitsPerComponent: 8, colorSpace: '/DeviceRGB', filter: 'FlateDecode', decodeParms: '',
    data: zlibStored(colorBytes),
    alpha: { bitsPerComponent: 8, data: zlibStored(shadowAlpha) },
  };
  const name = `Im${context.images.size + 1}`;
  context.images.set(name, descriptor);
  const imageMatrix = [
    width / density, 0, 0, -height / density,
    x + filter.dx, y + filter.dy + height / density,
  ];
  return `q\n${imageMatrix.map(pdfNumber).join(' ')} cm\n/${name} Do\nQ`;
}

function renderFilteredGroup(node, filter, context, opacity) {
  const visible = node.children.filter(child => child.name !== '#text' && child.name !== 'title');
  if (visible.length !== 1) fail('drop shadows on compound groups', 'one simple filled vector shape is supported per effect group');
  const shape = visible[0];
  if (!['rect', 'ellipse', 'circle', 'polygon'].includes(shape.name)) {
    fail('drop shadows on this geometry', 'only rectangles, ellipses, circles, and simple polygons are supported');
  }
  const shadow = shadowImageForShape(shape, filter, context);
  const renderedShape = renderTree(shape, { ...context, opacity: 1, inDefs: false });
  const filterClip = `${rectPath({ x: filter.x, y: filter.y, width: filter.width, height: filter.height })}\nW\nn`;
  const filteredContent = ['q', filterClip, shadow, renderedShape, 'Q'].filter(Boolean).join('\n');
  if (opacity === 1) return filteredContent;
  const formName = reserveForm(context);
  context.forms.set(formName, { content: `${filteredContent}\n` });
  const state = alphaState(opacity, opacity, context.stateNames);
  return `q\n${state}\n/${formName} Do\nQ`;
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
  if (node.name === 'g' && node.attributes['data-tiny-image-star-pdf-text'] != null) {
    return parsePositionedPdfText(node, context);
  }
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
    if (attrs.style) fail('blend modes and inline CSS', 'SVG styles cannot be represented by the current PDF writer');
    const matrix = transformMatrix(attrs.transform);
    const commands = ['q'];
    if (matrix) commands.push(matrix);
    if (attrs.filter) {
      if (attrs.mask || attrs['clip-path']) {
        fail('drop-shadow filters combined with masks or clipping', 'the filtered group must have no mask or group clip path');
      }
      const match = /^url\(#([^)]+)\)$/.exec(attrs.filter);
      if (!match) fail('external SVG filters', 'only local feDropShadow filter references are supported');
      const filter = definitions.filters.get(match[1]);
      if (!filter) throw new TypeError(`SVG references missing filter ${match[1]}.`);
      commands.push(renderFilteredGroup(node, filter, context, opacity * ownOpacity));
      commands.push('Q');
      return commands.filter(Boolean).join('\n');
    }
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
  if (['path', 'rect', 'ellipse', 'circle', 'polygon', 'text', 'tspan'].includes(node.name)) {
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

function compileSvg(svg, pdfTextBudget) {
  const root = parseSvg(svg);
  const { viewBox, width, height, preserveAspectRatio } = parseRoot(root);
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
    maskFormNames, buildingMaskIds, shadowPixelCount: 0,
    pdfTextBudget,
  };
  const [vx, vy, vbWidth, vbHeight] = viewBox;
  let sx = finite(width / vbWidth, 'viewport scale');
  let sy = finite(height / vbHeight, 'viewport scale');
  let e = finite(-vx * sx, 'viewport translation');
  let f = finite((vy + vbHeight) * sy, 'viewport translation');
  if (preserveAspectRatio.mode !== 'none') {
    const uniformScale = preserveAspectRatio.mode === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
    const alignX = (width - vbWidth * uniformScale) * preserveAspectRatio.alignX;
    const alignY = (height - vbHeight * uniformScale) * preserveAspectRatio.alignY;
    sx = uniformScale;
    sy = uniformScale;
    e = finite(alignX - vx * uniformScale, 'viewport translation');
    f = finite(height - alignY + vy * uniformScale, 'viewport translation');
  }
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
  const pdfTextBudget = { glyphs: 0, pathCharacters: 0, runs: 0, metadataCharacters: 0 };
  const compiled = pages.map(svg => compileSvg(svg, pdfTextBudget));
  let nextId = 3;
  const pageObjects = compiled.map(page => {
    const pageId = nextId++;
    const contentId = nextId++;
    const states = [...page.stateNames.entries()].map(([key, name]) => {
      if (key.startsWith('smask:')) {
        const [, maskFormName, opacity] = key.split(':');
        return { name, fillAlpha: opacity, strokeAlpha: opacity, maskFormName,
          maskType: page.forms.get(maskFormName)?.maskType || 'Alpha', objectId: nextId++ };
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
    const fonts = [...page.fonts.entries()].map(([name, descriptor]) => {
      const item = { name, descriptor, objectId: nextId++ };
      if (descriptor?.type === 'Type3') {
        item.charProcIds = descriptor.glyphs.map(() => nextId++);
        item.notdefId = nextId++;
        item.toUnicodeId = nextId++;
        item.descriptorId = nextId++;
      } else item.baseFont = descriptor;
      return item;
    });
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
        ? `/SMask << /S /${state.maskType} /G ${page.formObjects.find(form => form.name === state.maskFormName)?.objectId || 'null'} 0 R >>`
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
      if (item.descriptor?.type !== 'Type3') {
        objects[item.objectId] = `<< /Type /Font /Subtype /Type1 /BaseFont /${item.baseFont} /Encoding /WinAnsiEncoding >>`;
        continue;
      }
      const { descriptor } = item;
      const charEntries = descriptor.glyphs.map((glyph, index) => {
        objects[item.charProcIds[index]] = pdfStreamObject('', safePdfContent(glyph.charProc));
        return `/${glyph.name} ${item.charProcIds[index]} 0 R`;
      });
      objects[item.notdefId] = pdfStreamObject('', safePdfContent('0 0 0 0 0 0 d1\n'));
      const differences = descriptor.glyphs.map(glyph => `/${glyph.name}`).join(' ');
      const widths = descriptor.glyphs.map(glyph => pdfNumber(glyph.advance)).join(' ');
      objects[item.toUnicodeId] = pdfStreamObject('/Type /CMap', safePdfContent(descriptor.toUnicode));
      const boxText = descriptor.bbox.map(pdfNumber).join(' ');
      objects[item.descriptorId] = `<< /Type /FontDescriptor /FontName /TISSubset${item.objectId} /Flags 4`
        + ` /FontBBox [${boxText}] /ItalicAngle 0 /Ascent ${pdfNumber(descriptor.ascent)}`
        + ` /Descent ${pdfNumber(descriptor.descent)} /CapHeight ${pdfNumber(descriptor.ascent)} /StemV 80 >>`;
      objects[item.objectId] = `<< /Type /Font /Subtype /Type3 /Name /TISSubset${item.objectId}`
        + ` /FontBBox [${boxText}] /FontMatrix [0.001 0 0 0.001 0 0]`
        + ` /CharProcs << /.notdef ${item.notdefId} 0 R ${charEntries.join(' ')} >>`
        + ` /Encoding << /Type /Encoding /Differences [1 ${differences}] >>`
        + ` /FirstChar 1 /LastChar ${descriptor.glyphs.length} /Widths [${widths}]`
        + ` /Resources << >> /ToUnicode ${item.toUnicodeId} 0 R /FontDescriptor ${item.descriptorId} 0 R >>`;
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
