import { clampCornerRadii, cornerRadiusKeys, isValidCornerRadii, traceRoundedRectPath } from './corner-radii.js';
import { isValidEllipseArcData, traceEllipseArc } from './ellipse-arc.js';
import { MAX_POLYGON_POINTS, MAX_STAR_POINTS, MIN_STAR_POINTS, isValidVertexRadii, regularShapeVertices, traceRoundedPolygonPath } from './polygon-corners.js';
import { vectorNetworkEdgeForPair, vectorNetworkEdgePairIndex, vectorPathContours } from './vector-path.js';
import { vectorNetworkFacePathCommands } from './vector-network-corners.js';

export const NATIVE_PATH_GEOMETRY_LIMITS = Object.freeze({
  maxInputItems: 20_000,
  maxContours: 10_000,
  maxCommands: 100_000,
  maxCoordinate: 10_000_000,
  maxRoundedNetworkWork: 2_000_000
});

export class NativePathGeometryError extends TypeError {
  constructor(reason) {
    super(`Cannot extract vector geometry: ${reason}`);
    this.name = 'NativePathGeometryError';
    this.code = 'UNSUPPORTED_NATIVE_PATH_GEOMETRY';
  }
}

const fail = reason => { throw new NativePathGeometryError(reason); };
const rectangularTypes = new Set(['rectangle', 'frame', 'section', 'group', 'image']);
const commandTypes = new Set(['line', 'quadratic', 'cubic', 'arc', 'ellipse']);
const point = (x, y) => ({ x: coordinate(x), y: coordinate(y) });
const origin = Object.freeze({ x: 0, y: 0 });

function coordinate(value) {
  if (!Number.isFinite(value) || Math.abs(value) > NATIVE_PATH_GEOMETRY_LIMITS.maxCoordinate) {
    fail('coordinates must be finite and within the 10,000,000-pixel local limit.');
  }
  return Object.is(value, -0) ? 0 : value;
}

function validPoint(value) {
  if (!value || typeof value !== 'object') fail('path points need x and y coordinates.');
  return point(value.x, value.y);
}

function countInput(state, amount) {
  state.items += amount;
  if (state.items > NATIVE_PATH_GEOMETRY_LIMITS.maxInputItems) fail('the source exceeds the 20,000-item geometry limit.');
}

function radius(value, label = 'corner radius') {
  if (!Number.isFinite(value) || value < 0 || value > 100_000) fail(`${label} must be between 0 and 100,000 pixels.`);
  return value;
}

function validateDimensions(node) {
  coordinate(node.width); coordinate(node.height);
  if (node.width < 0 || node.height < 0) fail('width and height must be nonnegative.');
}

function ellipsePoint(cx, cy, rx, ry, rotation, angle) {
  const x = rx * Math.cos(angle); const y = ry * Math.sin(angle);
  return point(cx + x * Math.cos(rotation) - y * Math.sin(rotation),
    cy + x * Math.sin(rotation) + y * Math.cos(rotation));
}

/** Geometry-only recorder for the editor's public canonical Canvas tracers. */
class PathRecorder {
  constructor(state) { this.state = state; this.contours = []; this.current = null; this.position = null; }

  moveTo(x, y) {
    if (++this.state.contours > NATIVE_PATH_GEOMETRY_LIMITS.maxContours) fail('the source exceeds the 10,000-contour limit.');
    const start = point(x, y);
    this.current = { start, commands: [], closed: false };
    this.contours.push(this.current);
    this.position = start;
  }

  append(command) {
    if (++this.state.commands > NATIVE_PATH_GEOMETRY_LIMITS.maxCommands) fail('the source exceeds the 100,000-command limit.');
    this.current.commands.push(command);
    this.position = command.end;
  }

  lineTo(x, y) {
    const end = point(x, y);
    if (!this.current) { this.moveTo(x, y); return; }
    this.append({ type: 'line', start: this.position, end });
  }

  quadraticCurveTo(cx, cy, x, y) {
    if (!this.current) this.moveTo(cx, cy);
    this.append({ type: 'quadratic', start: this.position, control: point(cx, cy), end: point(x, y) });
  }

  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    if (!this.current) this.moveTo(c1x, c1y);
    this.append({ type: 'cubic', start: this.position,
      control1: point(c1x, c1y), control2: point(c2x, c2y), end: point(x, y) });
  }

  ellipse(cx, cy, radiusX, radiusY, rotation, startAngle, endAngle, anticlockwise = false) {
    coordinate(cx); coordinate(cy); coordinate(radiusX); coordinate(radiusY);
    if (radiusX < 0 || radiusY < 0 || ![rotation, startAngle, endAngle].every(Number.isFinite)) fail('ellipse commands need finite angles and nonnegative radii.');
    const start = ellipsePoint(cx, cy, radiusX, radiusY, rotation, startAngle);
    const end = ellipsePoint(cx, cy, radiusX, radiusY, rotation, endAngle);
    if (!this.current) this.moveTo(start.x, start.y);
    // Canvas connects an existing contour to the arc start before tracing it.
    if (this.position.x !== start.x || this.position.y !== start.y) this.lineTo(start.x, start.y);
    this.append({ type: 'ellipse', start, end, center: point(cx, cy), radiusX, radiusY,
      rotation, startAngle, endAngle, anticlockwise: Boolean(anticlockwise) });
  }

  arc(cx, cy, value, startAngle, endAngle, anticlockwise = false) {
    this.ellipse(cx, cy, value, value, 0, startAngle, endAngle, anticlockwise);
    const command = this.current.commands.at(-1);
    command.type = 'arc'; command.radius = value;
    delete command.radiusX; delete command.radiusY; delete command.rotation;
  }

  closePath() {
    if (!this.current) return;
    this.current.closed = true;
    this.position = this.current.start;
  }

  rect(x, y, width, height) {
    this.moveTo(x, y); this.lineTo(x + width, y);
    this.lineTo(x + width, y + height); this.lineTo(x, y + height); this.closePath();
  }
}

function rectangularContours(node, state) {
  const smoothing = node.cornerSmoothing ?? 0;
  if (!Number.isFinite(smoothing) || smoothing < 0 || smoothing > 1) fail('corner smoothing must be between 0 and 1.');
  if (node.cornerRadii != null && !isValidCornerRadii(node.cornerRadii)) fail('rectangle corner radii are invalid.');
  const fallback = radius(node.radius ?? 0);
  const radii = clampCornerRadii(node.width, node.height,
    node.cornerRadii || Object.fromEntries(cornerRadiusKeys.map(key => [key, fallback])));
  const recorder = new PathRecorder(state);
  if (cornerRadiusKeys.every(key => radii[key] === 0)) recorder.rect(0, 0, node.width, node.height);
  else traceRoundedRectPath(recorder, 0, 0, node.width, node.height, radii, smoothing);
  return { contours: recorder.contours, radii, smoothing };
}

function pathContours(node, state) {
  if (!Array.isArray(node.points) || node.subpaths != null && !Array.isArray(node.subpaths)) fail('paths need point and subpath arrays.');
  if ((node.subpaths?.length ?? 0) + 1 > NATIVE_PATH_GEOMETRY_LIMITS.maxContours) fail('the source exceeds the 10,000-contour limit.');
  const contours = vectorPathContours(node);
  for (const contour of contours) {
    if (!Array.isArray(contour.points) || typeof contour.closed !== 'boolean') fail('every path contour needs points and a closed setting.');
    countInput(state, contour.points.length);
    for (const item of contour.points) {
      validPoint(item);
      if (item.in != null) validPoint(item.in);
      if (item.out != null) validPoint(item.out);
    }
  }
  const recorder = new PathRecorder(state);
  const hasHandle = (item, part) => item[part] != null && (item[part].x !== 0 || item[part].y !== 0);
  const anchor = item => point(item.x * node.width, item.y * node.height);
  const handle = (item, part) => point(item.x * node.width + (item[part]?.x ?? 0) * node.width,
    item.y * node.height + (item[part]?.y ?? 0) * node.height);
  const segment = (start, end) => {
    const finish = anchor(end);
    if (hasHandle(start, 'out') || hasHandle(end, 'in')) {
      const c1 = handle(start, 'out'); const c2 = handle(end, 'in');
      recorder.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, finish.x, finish.y);
    } else recorder.lineTo(finish.x, finish.y);
  };
  for (const contour of contours) {
    const points = contour.points;
    if (!points.length) continue;
    const first = anchor(points[0]); recorder.moveTo(first.x, first.y);
    for (let index = 1; index < points.length; index += 1) segment(points[index - 1], points[index]);
    if (contour.closed) {
      if (hasHandle(points.at(-1), 'out') || hasHandle(points[0], 'in')) segment(points.at(-1), points[0]);
      recorder.closePath();
    }
  }
  return recorder.contours;
}

function regularContours(node, state) {
  const count = node.points ?? (node.type === 'star' ? 5 : 6);
  const maximum = node.type === 'star' ? MAX_STAR_POINTS : MAX_POLYGON_POINTS;
  if (!Number.isInteger(count) || count < MIN_STAR_POINTS || count > maximum) fail('regular shapes need a supported integer point count.');
  if (node.type === 'star' && (!Number.isFinite(node.innerRadius ?? 0.48) || (node.innerRadius ?? 0.48) < 0 || (node.innerRadius ?? 0.48) > 1)) fail('star inner radius must be between 0 and 1.');
  const fallback = radius(node.radius ?? 0);
  const smoothing = node.cornerSmoothing ?? 0;
  if (!Number.isFinite(smoothing) || smoothing < 0 || smoothing > 1) fail('corner smoothing must be between 0 and 1.');
  if (node.vertexRadii != null && !isValidVertexRadii(node.type, count, node.vertexRadii)) fail('regular shape vertex radii are invalid.');
  const vertices = regularShapeVertices(node.type, node.width, node.height, count, node.innerRadius ?? 0.48);
  countInput(state, vertices.length);
  const recorder = new PathRecorder(state);
  traceRoundedPolygonPath(recorder, 0, 0, vertices, node.vertexRadii || fallback, smoothing);
  return recorder.contours;
}

function validateNetwork(node, state) {
  if (!Array.isArray(node.vertices) || !Array.isArray(node.edges) || !Array.isArray(node.faces ?? [])) fail('networks need vertex, edge and face arrays.');
  countInput(state, node.vertices.length + node.edges.length + (node.faces?.length ?? 0));
  const vertices = new Map(); const edgeIds = new Set(); const faceIds = new Set();
  for (const vertex of node.vertices) {
    if (!vertex || typeof vertex.id !== 'string' || !vertex.id || vertex.id.length > 256 || vertices.has(vertex.id)) fail('network vertices need unique bounded identities.');
    validPoint(vertex);
    if (vertex.cornerRadius != null) radius(vertex.cornerRadius, 'network corner radius');
    vertices.set(vertex.id, point(vertex.x * node.width, vertex.y * node.height));
  }
  const edges = new Map();
  for (const edge of node.edges) {
    if (!edge || typeof edge.id !== 'string' || !edge.id || edge.id.length > 256 || edgeIds.has(edge.id)
      || !vertices.has(edge.from) || !vertices.has(edge.to)) fail('network edges need unique identities and existing endpoints.');
    edgeIds.add(edge.id);
    const start = vertices.get(edge.from); const end = vertices.get(edge.to);
    for (const control of [edge.control1, edge.control2]) if (control != null) validPoint(control);
    edges.set(edge.id, { start, end,
      control1: edge.control1 ? point(edge.control1.x * node.width, edge.control1.y * node.height) : start,
      control2: edge.control2 ? point(edge.control2.x * node.width, edge.control2.y * node.height) : end });
  }
  for (const face of node.faces || []) {
    if (!face || typeof face.id !== 'string' || !face.id || face.id.length > 256 || faceIds.has(face.id)
      || !Array.isArray(face.vertexIds) || face.vertexIds.length < 3) fail('network faces need unique identities and closed vertex cycles.');
    countInput(state, face.vertexIds.length);
    if (face.vertexIds.some(id => !vertices.has(id))) fail('network faces need existing vertex references.');
    faceIds.add(face.id);
  }
  return { vertices, edges };
}

function traceCommandContour(recorder, path) {
  recorder.moveTo(path.start.x, path.start.y);
  for (const command of path.commands) {
    if (command.type === 'line') recorder.lineTo(command.end.x, command.end.y);
    else if (command.type === 'quadratic') recorder.quadraticCurveTo(command.control.x, command.control.y, command.end.x, command.end.y);
    else if (command.type === 'cubic') recorder.bezierCurveTo(command.control1.x, command.control1.y,
      command.control2.x, command.control2.y, command.end.x, command.end.y);
    else if (command.type === 'arc') recorder.arc(command.center.x, command.center.y, command.radius,
      command.startAngle, command.endAngle, command.endAngle < command.startAngle);
    else fail('the canonical shape emitted an unsupported command.');
  }
  recorder.closePath();
}

function networkGeometry(node, state) {
  const { vertices, edges } = validateNetwork(node, state);
  const edgesByPair = vectorNetworkEdgePairIndex(node);
  const faces = []; const roundedEdges = new Set(); const roundedContours = [];
  const cornerVertices = new Set(node.vertices.filter(vertex => (vertex.cornerRadius ?? 0) > 0).map(vertex => vertex.id));
  const roundedCandidates = new Set((node.faces || []).filter(face => face.vertexIds.some(id => cornerVertices.has(id))));
  if (roundedCandidates.size * state.items > NATIVE_PATH_GEOMETRY_LIMITS.maxRoundedNetworkWork) fail('rounded network topology exceeds the bounded geometry work limit.');
  for (const face of node.faces || []) {
    const rounded = roundedCandidates.has(face) ? vectorNetworkFacePathCommands(node, face, origin) : null;
    const recorder = new PathRecorder(state);
    if (rounded) {
      traceCommandContour(recorder, rounded);
      roundedContours.push(...recorder.contours);
    } else {
      const first = vertices.get(face.vertexIds[0]); recorder.moveTo(first.x, first.y);
      for (let index = 0; index < face.vertexIds.length; index += 1) {
        const from = face.vertexIds[index]; const to = face.vertexIds[(index + 1) % face.vertexIds.length];
        const edge = vectorNetworkEdgeForPair(edgesByPair, from, to);
        if (!edge) fail('a network face does not follow its graph edges.');
        const geometry = edges.get(edge.id); const reversed = edge.from !== from;
        const end = reversed ? geometry.start : geometry.end;
        if (edge.control1 || edge.control2) {
          const c1 = reversed ? geometry.control2 : geometry.control1; const c2 = reversed ? geometry.control1 : geometry.control2;
          recorder.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
        } else recorder.lineTo(end.x, end.y);
      }
      recorder.closePath();
    }
    faces.push({ fillRule: 'nonzero', contours: recorder.contours });
    if (rounded) for (let index = 0; index < face.vertexIds.length; index += 1) {
      const edge = vectorNetworkEdgeForPair(edgesByPair, face.vertexIds[index], face.vertexIds[(index + 1) % face.vertexIds.length]);
      if (edge) roundedEdges.add(edge.id);
    }
  }
  const edgeRecorder = new PathRecorder(state);
  for (const edge of node.edges) {
    if (roundedEdges.has(edge.id)) continue;
    const geometry = edges.get(edge.id); edgeRecorder.moveTo(geometry.start.x, geometry.start.y);
    if (edge.control1 || edge.control2) edgeRecorder.bezierCurveTo(geometry.control1.x, geometry.control1.y,
      geometry.control2.x, geometry.control2.y, geometry.end.x, geometry.end.y);
    else edgeRecorder.lineTo(geometry.end.x, geometry.end.y);
  }
  return { fillRule: 'nonzero', fillGroups: faces,
    strokeContours: [...roundedContours, ...edgeRecorder.contours],
    alignedStrokeContours: faces.flatMap(face => face.contours) };
}

/**
 * Extract fresh geometry-only commands in node-local pixels. Callers resolve
 * variables first and apply node position/rotation/affine transforms once.
 *
 * Contours are {start:{x,y}, commands:[{type,start,end,...}], closed:boolean}.
 * Lines have no extra fields; quadratic/cubic commands retain their native
 * control/control1/control2 points. Arc commands retain center/radius and
 * startAngle/endAngle/anticlockwise. Ellipses retain center/radiusX/radiusY,
 * rotation and the same angular fields. No curves are flattened or converted
 * to approximate cubic arcs; a conic-capable stroker can consume them directly.
 *
 * `closed` records an actual Canvas closePath, not merely coincident endpoints
 * (rounded rectangles and full ellipses retain their authored cap/dash seams).
 * Fill implicitly closes contours. `fillGroups` combine additively: network
 * faces remain independent nonzero regions and must be unioned, never joined
 * into one winding path. Open-only paths and lines have no geometric fill.
 * Network center strokes keep independent open edges except rounded face
 * traces; aligned strokes use complete face contours with proper joins.
 * Rectangle/frame output also contains rectangleSideGeometry with numeric
 * width/height/radii/smoothing for the existing individual-side tracers.
 *
 * Text and Boolean expressions require separate glyph/operation resolution.
 * Paints, identities, assets, styles and descendants never enter this output.
 */
export function nativePathGeometryForNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) fail('a vector layer is required.');
  validateDimensions(node);
  const state = { items: 0, contours: 0, commands: 0 };
  if (node.type === 'network') return networkGeometry(node, state);
  let contours; let rectangleSideGeometry;
  if (rectangularTypes.has(node.type)) {
    const geometry = rectangularContours(node, state);
    contours = geometry.contours;
    if (node.type === 'rectangle' || node.type === 'frame') rectangleSideGeometry = {
      width: node.width, height: node.height, radii: geometry.radii, smoothing: geometry.smoothing
    };
  }
  else if (node.type === 'path') contours = pathContours(node, state);
  else if (node.type === 'star' || node.type === 'polygon') contours = regularContours(node, state);
  else if (node.type === 'ellipse') {
    if (node.arcData != null && !isValidEllipseArcData(node.arcData)) fail('ellipse arc geometry is invalid.');
    const recorder = new PathRecorder(state); traceEllipseArc(recorder, node, 0, 0, node.width, node.height);
    contours = recorder.contours;
  } else if (node.type === 'line') {
    if (node.lineReverseY != null && typeof node.lineReverseY !== 'boolean') fail('line direction must be boolean.');
    const recorder = new PathRecorder(state);
    recorder.moveTo(0, node.lineReverseY ? node.height : 0); recorder.lineTo(node.width, node.lineReverseY ? 0 : node.height);
    contours = recorder.contours;
  } else fail(`“${node.type || 'unknown'}” requires a separately resolved vector outline.`);
  if (node.fillRule != null && !['nonzero', 'evenodd'].includes(node.fillRule)) fail('fill rule must be nonzero or evenodd.');
  const fillRule = node.type === 'path' && node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
  const hasFill = node.type !== 'line' && contours.length > 0
    && (node.type !== 'path' || vectorPathContours(node).some(contour => contour.closed && contour.points.length >= 2));
  return { fillRule, fillGroups: hasFill ? [{ fillRule, contours }] : [], strokeContours: contours, alignedStrokeContours: contours,
    ...(rectangleSideGeometry ? { rectangleSideGeometry } : {}) };
}

function validateReplayContours(contours) {
  if (!Array.isArray(contours) || contours.length > NATIVE_PATH_GEOMETRY_LIMITS.maxContours) fail('a bounded contour array is required.');
  const methods = new Set(); let count = 0;
  for (const contour of contours) {
    methods.add('moveTo');
    validPoint(contour?.start);
    if (!Array.isArray(contour.commands) || typeof contour.closed !== 'boolean') fail('every contour needs commands and a closed setting.');
    if ((count += contour.commands.length) > NATIVE_PATH_GEOMETRY_LIMITS.maxCommands) fail('the source exceeds the 100,000-command limit.');
    if (contour.closed) methods.add('closePath');
    let position = contour.start;
    for (const command of contour.commands) {
      if (!commandTypes.has(command?.type)) fail('an unknown path command cannot be replayed.');
      validPoint(command.start); validPoint(command.end);
      if (command.start.x !== position.x || command.start.y !== position.y) fail('command endpoints must form one continuous contour.');
      position = command.end;
      if (command.type === 'line') methods.add('lineTo');
      else if (command.type === 'quadratic') { validPoint(command.control); methods.add('quadraticCurveTo'); }
      else if (command.type === 'cubic') { validPoint(command.control1); validPoint(command.control2); methods.add('bezierCurveTo'); }
      else {
        validPoint(command.center);
        if (![command.startAngle, command.endAngle].every(Number.isFinite) || typeof command.anticlockwise !== 'boolean') fail('arc angles and direction are invalid.');
        if (command.type === 'arc') { coordinate(command.radius); if (command.radius < 0) fail('arc radius cannot be negative.'); methods.add('arc'); }
        else { coordinate(command.radiusX); coordinate(command.radiusY);
          if (command.radiusX < 0 || command.radiusY < 0 || !Number.isFinite(command.rotation)) fail('ellipse radii and rotation are invalid.'); methods.add('ellipse'); }
      }
    }
  }
  return methods;
}

/** Replay validated geometry into a Canvas-style path context; never paint. */
export function traceNativePathContours(context, contours) {
  const methods = validateReplayContours(contours);
  if (!contours.length) return false;
  if (!context || [...methods].some(method => typeof context[method] !== 'function')) fail('the path context cannot trace every required native command.');
  for (const contour of contours) {
    context.moveTo(contour.start.x, contour.start.y);
    for (const command of contour.commands) {
      if (command.type === 'line') context.lineTo(command.end.x, command.end.y);
      else if (command.type === 'quadratic') context.quadraticCurveTo(command.control.x, command.control.y, command.end.x, command.end.y);
      else if (command.type === 'cubic') context.bezierCurveTo(command.control1.x, command.control1.y,
        command.control2.x, command.control2.y, command.end.x, command.end.y);
      else if (command.type === 'arc') context.arc(command.center.x, command.center.y, command.radius,
        command.startAngle, command.endAngle, command.anticlockwise);
      else context.ellipse(command.center.x, command.center.y, command.radiusX, command.radiusY, command.rotation,
        command.startAngle, command.endAngle, command.anticlockwise);
    }
    if (contour.closed) context.closePath();
  }
  return contours.length > 0;
}
