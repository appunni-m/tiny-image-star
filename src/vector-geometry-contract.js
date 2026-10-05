export const VECTOR_GEOMETRY_LIMITS = Object.freeze({
  maxInputCommands: 20_000, maxContours: 4_096, maxFillGroups: 1_024,
  maxOutputValues: 400_000, maxOutputPoints: 20_000,
  maxCoordinate: 10_000_000, maxQueue: 8,
  requestTimeoutMs: 15_000, idleTimeoutMs: 15_000,
  conicTolerance: .01, maxConicDepth: 16,
  maxHeapBytes: 256 * 1024 * 1024
});

export class VectorGeometryError extends Error {
  constructor(message, code = 'UNSUPPORTED_VECTOR_GEOMETRY') {
    super(message); this.name = 'VectorGeometryError'; this.code = code;
  }
}

export function vectorGeometryAbortError() {
  const error = new Error('The vector operation was cancelled.'); error.name = 'AbortError'; return error;
}

const fail = message => { throw new VectorGeometryError(message); };
const coordinate = value => {
  if (!Number.isFinite(value) || Math.abs(value) > VECTOR_GEOMETRY_LIMITS.maxCoordinate) fail('Vector coordinates must be finite and within the local geometry limit.');
  return value;
};
const point = value => {
  if (!value || typeof value !== 'object') fail('Every vector command needs readable points.');
  return { x: coordinate(value.x), y: coordinate(value.y) };
};
const angle = value => {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) fail('Vector arc angles exceed the supported local geometry limit.');
  return value;
};

/** Validate and copy only geometry fields before a request enters the worker queue. */
export function normalizeVectorOutlineRequest(geometry, sourceStroke) {
  if (!geometry || typeof geometry !== 'object' || !sourceStroke || typeof sourceStroke !== 'object') fail('A vector shape and stroke are required.');
  let commandCount = 0; let contourCount = 0;
  const contours = value => {
    if (!Array.isArray(value)) fail('Vector contour arrays are required.');
    if ((contourCount += value.length) > VECTOR_GEOMETRY_LIMITS.maxContours) fail('The vector operation exceeds its bounded contour limit.');
    return value.map(contour => {
      if (!contour || !Array.isArray(contour.commands) || typeof contour.closed !== 'boolean') fail('Each vector contour needs commands and a closed setting.');
      if ((commandCount += contour.commands.length) > VECTOR_GEOMETRY_LIMITS.maxInputCommands) fail('The vector operation exceeds its bounded input command limit.');
      return { start: point(contour.start), closed: contour.closed, commands: contour.commands.map(command => {
        const result = { type: command?.type, start: point(command?.start), end: point(command?.end) };
        if (result.type === 'quadratic') result.control = point(command.control);
        else if (result.type === 'cubic') { result.control1 = point(command.control1); result.control2 = point(command.control2); }
        else if (result.type === 'arc' || result.type === 'ellipse') {
          result.center = point(command.center); result.startAngle = angle(command.startAngle); result.endAngle = angle(command.endAngle);
          if (typeof command.anticlockwise !== 'boolean') fail('Arc direction must be explicit.');
          result.anticlockwise = command.anticlockwise;
          if (result.type === 'arc') { result.radius = coordinate(command.radius); if (result.radius < 0) fail('Arc radii cannot be negative.'); }
          else { result.radiusX = coordinate(command.radiusX); result.radiusY = coordinate(command.radiusY); result.rotation = angle(command.rotation);
            if (result.radiusX < 0 || result.radiusY < 0) fail('Ellipse radii cannot be negative.'); }
        } else if (result.type !== 'line') fail('An unsupported native vector command cannot be outlined.');
        return result;
      }) };
    });
  };
  const fillRule = rule => {
    if (!['nonzero', 'evenodd'].includes(rule)) fail('A supported vector fill rule is required.');
    return rule;
  };
  if (!Array.isArray(geometry.fillGroups) || geometry.fillGroups.length > VECTOR_GEOMETRY_LIMITS.maxFillGroups) fail('The vector operation exceeds its fill-group limit.');
  const shape = {
    fillRule: fillRule(geometry.fillRule),
    fillGroups: geometry.fillGroups.map(group => ({ fillRule: fillRule(group?.fillRule), contours: contours(group?.contours) })),
    strokeContours: contours(geometry.strokeContours), alignedStrokeContours: contours(geometry.alignedStrokeContours)
  };
  if (geometry.rectangleSideGeometry) {
    const rectangle = geometry.rectangleSideGeometry;
    if (!rectangle.radii || typeof rectangle.radii !== 'object') fail('Rectangle side geometry needs its resolved radii.');
    shape.rectangleSideGeometry = { width: coordinate(rectangle.width), height: coordinate(rectangle.height),
      smoothing: rectangle.smoothing, radii: Object.fromEntries(['topLeft','topRight','bottomRight','bottomLeft'].map(key => [key, coordinate(rectangle.radii[key])])) };
    if (shape.rectangleSideGeometry.width < 0 || shape.rectangleSideGeometry.height < 0
      || Object.values(shape.rectangleSideGeometry.radii).some(value => value < 0)
      || !Number.isFinite(rectangle.smoothing) || rectangle.smoothing < 0 || rectangle.smoothing > 1) fail('Rectangle side geometry is invalid.');
  }
  const stroke = {};
  for (const key of ['width','cap','join','pattern','miterLimit','alignment','sideMode','startDecoration','endDecoration']) {
    if (Object.hasOwn(sourceStroke,key)) stroke[key] = sourceStroke[key];
  }
  stroke.cap ??= 'butt'; stroke.join ??= 'miter'; stroke.pattern ??= 'solid'; stroke.miterLimit ??= 10;
  stroke.alignment ??= 'center'; stroke.sideMode ??= 'all';
  if (!Number.isFinite(stroke.width) || stroke.width < 0 || stroke.width > 100_000
    || !['butt','round','square'].includes(stroke.cap) || !['miter','round','bevel'].includes(stroke.join)
    || !['solid','dashed','dotted','custom'].includes(stroke.pattern)
    || !['inside','center','outside'].includes(stroke.alignment)
    || !Number.isFinite(stroke.miterLimit) || stroke.miterLimit < 1 || stroke.miterLimit > 1000) fail('The stroke geometry settings are invalid.');
  if (![undefined,'none'].includes(stroke.startDecoration) || ![undefined,'none'].includes(stroke.endDecoration)) fail('Outline stroke does not yet support endpoint decorations. Remove them before outlining.');
  if (!['all','top','right','bottom','left','custom'].includes(stroke.sideMode)) fail('The stroke side mode is invalid.');
  if (stroke.sideMode !== 'all' && !shape.rectangleSideGeometry) fail('Individual side weights require rectangle or frame geometry.');
  if (stroke.sideMode === 'custom') {
    if (!sourceStroke.sideWidths || typeof sourceStroke.sideWidths !== 'object') fail('Custom side weights are missing.');
    stroke.sideWidths = Object.fromEntries(['top','right','bottom','left'].map(key => [key, sourceStroke.sideWidths[key]]));
    if (Object.values(stroke.sideWidths).some(value => !Number.isFinite(value) || value < 0 || value > 100_000)) fail('Custom side weights are invalid.');
  }
  if (stroke.pattern === 'custom') {
    if (!Array.isArray(sourceStroke.dashArray) || sourceStroke.dashArray.length !== 2) fail('Outline stroke currently supports one dash and one gap. Simplify this custom dash array before outlining.');
    stroke.dashArray = [...sourceStroke.dashArray];
    if (stroke.dashArray.some(value => !Number.isFinite(value) || value < 0 || value > 100_000) || stroke.dashArray.every(value => value === 0)) fail('Custom dash lengths are invalid.');
    if (stroke.dashArray[1] === 0) fail('Outline stroke cannot yet preserve a zero-length dash gap. Use a positive gap or a solid stroke.');
  }
  if (stroke.alignment !== 'center' && !shape.fillGroups.length) fail('Inside and outside outlines need closed geometric fill coverage.');
  return { geometry: shape, stroke };
}

const verbArguments = Object.freeze({ 0: 2, 1: 2, 2: 4, 3: 5, 4: 6, 5: 0 });

/** Validate native Skia commands before retaining or interpreting worker output. */
export function validateVectorOutlineResult(value) {
  if (!value || !(value.commands instanceof Float32Array) || value.commands.length > VECTOR_GEOMETRY_LIMITS.maxOutputValues
    || !['nonzero','evenodd'].includes(value.fillRule)) fail('The local vector worker returned invalid geometry.');
  let cursor = 0; let points = 0; let hasContour = false;
  while (cursor < value.commands.length) {
    const verb = value.commands[cursor++]; const size = verbArguments[verb];
    if (size == null || cursor + size > value.commands.length) fail('The local vector worker returned a malformed path command.');
    if (verb === 0) hasContour = true;
    else if (!hasContour) fail('The local vector worker returned a path without a starting point.');
    if (verb !== 5 && ++points > VECTOR_GEOMETRY_LIMITS.maxOutputPoints) fail('The outlined vector exceeds its bounded output point limit.');
    for (let index = 0; index < size; index++) {
      const item = value.commands[cursor + index];
      if (verb === 3 && index === 4) { if (!Number.isFinite(item) || item <= 0) fail('The outlined conic has an unsupported rational weight.'); }
      else coordinate(item);
    }
    cursor += size;
  }
  if (!value.bounds || ['left','top','right','bottom'].some(key => !Number.isFinite(value.bounds[key])
    || Math.abs(value.bounds[key]) > VECTOR_GEOMETRY_LIMITS.maxCoordinate)
    || value.bounds.right < value.bounds.left || value.bounds.bottom < value.bounds.top) fail('The local vector worker returned invalid bounds.');
  return value;
}
