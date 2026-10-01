import { getBlobBytes, parseFigBinary, resolveVectorNodePaths, parseSVGPathData } from 'openfig-core';
import { createDocument, createId, createNode, MAX_DOCUMENT_TREE_DEPTH, parseDocument } from './model.js';
import { assertSafeRasterDimensions, inspectRasterDimensions } from './image-engine.js';
import { createImageFill } from './image-fills.js';
import { createAutoLayout } from './layout-engine.js';
import { preflightFigArchive, FIG_IMPORT_LIMITS } from './fig-import-preflight.js';

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
    if (paint.type === 'SOLID') {
      const color = hexColor(paint.color);
      if (!color) { warn(context.report, 'unsupported', 'PAINT', node.name, 'A fill color could not be decoded.'); continue; }
      supported.push({ id: createId('fill'), type: 'solid', visible: true, opacity: paintOpacity(paint), color });
      if (paint.blendMode && paint.blendMode !== 'NORMAL') warn(context.report, 'flattened', 'PAINT_BLEND', node.name, 'A paint blend mode was reset to normal.');
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
      const fit = ['FIT', 'CONTAIN'].includes(scaleMode) ? 'contain' : 'cover';
      if (paint.imageTransform || paint.filters) warn(context.report, 'flattened', 'IMAGE_TRANSFORM', node.name, 'Image crop, tint and filter settings use the nearest fill mode.');
      if (['TILE', 'STRETCH'].includes(scaleMode)) warn(context.report, 'flattened', 'IMAGE_SCALE', node.name, 'Image tiling or stretch scaling was reduced to cover.');
      supported.push({
        id: createId('fill'), type: 'image', visible: true, opacity: paintOpacity(paint),
        imageFill: createImageFill(asset.id, { fit })
      });
      continue;
    }
    warn(context.report, 'unsupported', paint.type || 'PAINT', node.name, 'This paint type was omitted; solid and image fills are supported.');
  }
  if (paints.length > 32) warn(context.report, 'unsupported', 'PAINT_STACK', node.name, 'Only the first 32 paint layers were considered.');
  return supported;
}

function mapStrokes(paints, node, report) {
  if (!Array.isArray(paints)) return [];
  const strokes = [];
  const capValue = String(node.strokeCap || '').toUpperCase();
  const joinValue = String(node.strokeJoin || '').toUpperCase();
  let cap = ({ ROUND: 'round', SQUARE: 'square', BUTT: 'butt' })[capValue] || 'butt';
  const join = ({ ROUND: 'round', BEVEL: 'bevel', MITER: 'miter' })[joinValue] || 'miter';
  const dash = Array.isArray(node.dashPattern) ? node.dashPattern : [];
  const pattern = dash.length ? (dash[0] === 0 ? 'dotted' : 'dashed') : 'solid';
  if (pattern === 'dotted') cap = 'round';
  if (paints.length && capValue && !['ROUND', 'SQUARE', 'BUTT'].includes(capValue)) warn(report, 'flattened', 'STROKE_CAP', node.name, 'Arrow and custom endpoint caps were reduced to a standard line cap.');
  if (paints.length && joinValue && !['ROUND', 'BEVEL', 'MITER'].includes(joinValue)) warn(report, 'flattened', 'STROKE_JOIN', node.name, 'This stroke join was reduced to a miter join.');
  if (node.strokeAlign && node.strokeAlign !== 'CENTER') warn(report, 'flattened', 'STROKE_ALIGNMENT', node.name, 'Inside and outside stroke alignment were centered.');
  if (paints.length && dash.length) warn(report, 'flattened', 'STROKE_PATTERN', node.name, 'Custom dash lengths were reduced to a standard dashed or dotted stroke.');
  if (paints.length > 32) warn(report, 'unsupported', 'STROKE_STACK', node.name, 'Only the first 32 stroke paint layers were considered.');
  for (const paint of paints.slice(0, 32)) {
    if (!paint || paint.visible === false || paint.type !== 'SOLID' || !Number.isFinite(paint.color?.r)) {
      if (paint?.visible !== false) warn(report, 'unsupported', paint?.type || 'STROKE', node.name, 'Only solid stroke paints are imported.');
      continue;
    }
    const color = hexColor(paint.color);
    if (!color) continue;
    strokes.push({
      id: createId('stroke'), color, width: finite(node.strokeWeight, 1, 0, 100_000),
      opacity: paintOpacity(paint), visible: true, cap, join, pattern,
      miterLimit: finite(node.strokeMiterLimit, 10, 1, 1000), startDecoration: 'none', endDecoration: 'none'
    });
  }
  return strokes;
}

function localTransform(source, report) {
  const transform = source.transform || {};
  const m00 = finite(transform.m00, 1); const m01 = finite(transform.m01, 0);
  const m10 = finite(transform.m10, 0); const m11 = finite(transform.m11, 1);
  const xScale = Math.hypot(m00, m10); const yScale = Math.hypot(m01, m11);
  const dot = m00 * m01 + m10 * m11;
  const reflected = m00 * m11 - m01 * m10 < 0;
  if (Math.abs(xScale - 1) > EPSILON || Math.abs(yScale - 1) > EPSILON || Math.abs(dot) > EPSILON || reflected) {
    warn(report, 'flattened', 'TRANSFORM', source.name, 'Scale, shear, or reflection was simplified; review this layer’s size and orientation.');
  }
  return {
    x: finite(transform.m02), y: finite(transform.m12),
    rotation: Math.atan2(m10, m00) * 180 / Math.PI
  };
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

function textProperties(source, context) {
  const characters = typeof source.textData?.characters === 'string' ? source.textData.characters : '';
  const style = source.textData?.style || source.style || {};
  const visiblePaints = Array.isArray(source.fillPaints)
    ? source.fillPaints.filter(item => item && item.visible !== false && paintOpacity(item) > 0)
    : [];
  const solidPaints = visiblePaints.filter(item => item.type === 'SOLID');
  const paint = solidPaints[0] || null;
  if (visiblePaints.some(item => item.type !== 'SOLID')) {
    warn(context.report, 'unsupported', 'TEXT_PAINT', source.name, 'Gradient, image, and patterned text paints were reduced to the first solid color or the local default.');
  }
  if (visiblePaints.length > 1) warn(context.report, 'flattened', 'TEXT_PAINT_STACK', source.name, 'Multiple text paints were reduced to the first solid color.');
  if (visiblePaints.some(item => item.blendMode && item.blendMode !== 'NORMAL')) warn(context.report, 'flattened', 'TEXT_PAINT_BLEND', source.name, 'Text paint blend modes were reset to normal.');
  const color = hexColor(paint?.color) || '#1e1e1e';
  if (paint && !hexColor(paint.color)) warn(context.report, 'unsupported', 'TEXT_PAINT', source.name, 'The text color could not be decoded and uses the local default.');
  if (source.textData?.characterStyleIDs?.length > 1
    || (Array.isArray(source.textData?.characterStyleOverrides) && source.textData.characterStyleOverrides.some(Boolean))) {
    warn(context.report, 'flattened', 'TEXT_STYLE', source.name, 'Mixed per-character text styles were reduced to the primary text style.');
  }
  const namedStyle = String(source.fontName?.style || '');
  const weightFromStyle = /(?:thin|hairline)/iu.test(namedStyle) ? 100
    : /(?:extra\s*light|ultra\s*light)/iu.test(namedStyle) ? 200
      : /\blight\b/iu.test(namedStyle) ? 300
        : /(?:semi\s*bold|demi\s*bold)/iu.test(namedStyle) ? 600
          : /\bmedium\b/iu.test(namedStyle) ? 500
            : /(?:extra\s*bold|ultra\s*bold)/iu.test(namedStyle) ? 800
              : /\b(?:bold|heavy|black)\b/iu.test(namedStyle) ? 700 : 400;
  const fontFamily = safeName(style.fontFamily || source.fontName?.family || source.fontFamily, 'Arial, sans-serif').slice(0, 160);
  const fontSize = finite(style.fontSize ?? source.fontSize, 24, 1, 100_000);
  const fontWeight = finite(style.fontWeight ?? source.fontWeight, weightFromStyle, 1, 1000);
  const lineHeightValue = style.lineHeight?.value ?? style.lineHeight ?? source.lineHeight?.value ?? source.lineHeight;
  const lineHeightUnit = style.lineHeight?.unit ?? source.lineHeight?.unit;
  const lineHeight = lineHeightUnit === 'PIXELS' && Number(lineHeightValue) > 0
    ? finite(lineHeightValue / fontSize, 1.25, 0.01, 100)
    : finite(lineHeightValue, 1.25, 0.01, 100);
  const verticalAlign = ({ TOP: 'top', CENTER: 'middle', BOTTOM: 'bottom' })[String(source.textAlignVertical || '').toUpperCase()] || 'top';
  const textFit = ({ HEIGHT: 'auto-height', WIDTH_AND_HEIGHT: 'auto-width', NONE: 'fixed', TRUNCATE: 'fixed' })[String(source.textAutoResize || '').toUpperCase()] || 'fixed';
  if (source.textAutoResize && !['HEIGHT', 'WIDTH_AND_HEIGHT', 'NONE', 'TRUNCATE'].includes(String(source.textAutoResize).toUpperCase())) {
    warn(context.report, 'flattened', 'TEXT_FIT', source.name, 'This text resizing mode was reduced to a fixed text box.');
  }
  return {
    opacity: finite(source.opacity, 1, 0, 1) * (paint ? paintOpacity(paint) : 1),
    text: characters,
    fontFamily,
    fontSize,
    fontWeight,
    fontStyle: style.italic === true || source.italic === true || /italic/iu.test(String(style.italic || source.italic || namedStyle)) ? 'italic' : 'normal',
    lineHeight,
    letterSpacing: finite(style.letterSpacing ?? source.letterSpacing, 0, -10_000, 10_000),
    color,
    align: ({ LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' })[String(source.textAlignHorizontal || '').toUpperCase()] || 'left',
    verticalAlign,
    textFit,
    textDecoration: ({ UNDERLINE: 'underline', STRIKETHROUGH: 'line-through', NONE: 'none' })[String(source.textDecoration || '').toUpperCase()] || 'none',
    paragraphSpacing: finite(source.paragraphSpacing, 0, 0, 10_000),
    firstLineIndent: finite(source.firstLineIndent, 0, 0, 10_000),
    listSpacing: finite(source.listSpacing, 0, 0, 10_000)
  };
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
  if (minimum && maximum && (minimum.mode !== maximum.mode
    || (minimum.mode === 'fixed' && minimum.value !== maximum.value)
    || (minimum.mode === 'fill' && minimum.weight !== maximum.weight))) {
    warn(report, 'flattened', 'AUTO_LAYOUT_GRID_TRACK_BOUNDS', name, 'This min/max grid track bound cannot be represented locally; it was approximated with the maximum sizing function.');
  }
  return maximum || minimum;
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
  if (wrap && contentAlignment && contentAlignment !== 'AUTO') {
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
      ...(Array.isArray(vectorData.fillGeometry) ? vectorData.fillGeometry : []),
      ...(Array.isArray(vectorData.strokeGeometry) ? vectorData.strokeGeometry : [])
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
    const overrides = {
      name, ...transform, width: finite(source.size?.x, 0, 0, 1_000_000), height: finite(source.size?.y, 0, 0, 1_000_000),
      visible: source.visible !== false, opacity: finite(source.opacity, 1, 0, 1), children: vectorChildren(source, paths, context)
    };
    mapChildAutoLayout(source, parentSource, overrides, context.report, name, context);
    const node = createNode('group', {
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
      mapChildAutoLayout(source, parentSource, overrides, context.report, name, context);
      const node = createNode('group', overrides);
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
  const fills = type === 'text' || type === 'line' ? [] : mapPaints(source.fillPaints, source, context);
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
  if (Array.isArray(source.effects) && source.effects.some(effect => effect?.visible !== false)) warn(context.report, 'unsupported', 'EFFECT', name, 'Layer effects were omitted.');
  if (source.blendMode && source.blendMode !== 'PASS_THROUGH' && source.blendMode !== 'NORMAL') {
    warn(context.report, 'flattened', 'BLEND_MODE', name, 'The layer blend mode was reset to normal.');
  }
  if (source.type === 'COMPONENT' || source.type === 'COMPONENT_SET' || source.type === 'INSTANCE' || source.type === 'SYMBOL') {
    warn(context.report, 'flattened', source.type, name, 'Component links and variant behavior were flattened into editable layers.');
  }
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
  const constraints = mapConstraints(source, context.report);
  if (constraints) overrides.constraints = constraints;
  if (source.isMask || source.maskType) warn(context.report, 'unsupported', 'MASK', name, 'Figma mask layers do not map to the local mask-group model and were imported as ordinary layers.');
  if (source.type === 'RECTANGLE' || source.type === 'ROUNDED_RECTANGLE') {
    const radii = source.rectangleCornerRadii;
    if (Array.isArray(radii) && radii.length === 4 && radii.every(Number.isFinite)) {
      overrides.cornerRadii = {
        topLeft: finite(radii[0], 0, 0, 100_000), topRight: finite(radii[1], 0, 0, 100_000),
        bottomRight: finite(radii[2], 0, 0, 100_000), bottomLeft: finite(radii[3], 0, 0, 100_000)
      };
      overrides.radius = 0;
    } else overrides.radius = finite(source.cornerRadius, 0, 0, 100_000);
  }
  if (type === 'star') {
    overrides.points = finite(source.pointCount, 5, 3, 32);
    overrides.innerRadius = finite(source.starInnerRadius, 0.48, 0, 1);
  }
  if (type === 'polygon') overrides.points = finite(source.pointCount, 6, 3, 32);
  if (type === 'boolean') {
    const operation = String(source.booleanOperation || '').toUpperCase();
    overrides.operation = ({ UNION: 'union', SUBTRACT: 'subtract', INTERSECT: 'intersect', EXCLUDE: 'exclude' })[operation] || 'union';
    if (!source.booleanOperation) warn(context.report, 'flattened', 'BOOLEAN_OPERATION', name, 'The Boolean operation defaulted to union because its operator was missing.');
  }
  if (type === 'text') {
    Object.assign(overrides, textProperties(source, context));
    if (source.textData?.paragraphStyle) warn(context.report, 'flattened', 'TEXT_PARAGRAPH', name, 'Paragraph layout settings were simplified.');
  }
  if (source.type === 'LINE') overrides.fill = 'transparent';
  if (type === 'boolean' && !isValidBooleanChildren(overrides.children)) {
    warn(context.report, 'flattened', 'BOOLEAN_OPERATION', name, 'The Boolean operator could not be represented safely; its operands were kept in an editable group.');
    const { operation: _operation, ...groupOverrides } = overrides;
    const node = createNode('group', groupOverrides);
    context.report.importedNodes += 1;
    return node;
  }
  const node = createNode(type, overrides);
  context.report.importedNodes += 1;
  return node;
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
      if (next) converted.push(next);
    }
    return createLayer(node, converted, context, pageId, depth, parentSource);
  } finally {
    context.traversalActive.delete(node);
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
