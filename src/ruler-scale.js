// Keep ruler generation bounded even if a caller reports an unexpectedly
// large canvas viewport. At normal viewport sizes the spacing target is 80px.
export const MAX_RULER_TICKS = 512;

const TARGET_MAJOR_SPACING = 80;
const MINOR_SUBDIVISIONS = 5;
const NICE_MULTIPLIERS = [1, 2, 5, 10];

/**
 * Generate axis-independent ruler ticks for a canvas viewport.
 *
 * The transform is `screenPosition = worldValue * zoom + screenPan`, where
 * `screenPan` is the screen-space position of world coordinate zero. Returned
 * positions are in CSS pixels relative to the start of the viewport.
 *
 * @param {{viewportLength: number, zoom: number, screenPan: number}} viewport
 * @returns {{majorStep: number, minorStep: number, ticks: Array<{value: number, position: number, major: boolean, label: string|null}>}}
 */
export function generateRulerTicks({ viewportLength, zoom, screenPan } = {}) {
  const empty = { majorStep: 0, minorStep: 0, ticks: [] };
  if (!Number.isFinite(viewportLength) || viewportLength <= 0
      || !Number.isFinite(zoom) || zoom <= 0
      || !Number.isFinite(screenPan)) return empty;

  // Make the worst-case minor tick count about 500, leaving room for inclusive
  // endpoints and floating-point edge effects. The nice-number rounding below
  // only increases spacing, so this remains a strict upper bound in practice.
  const targetMajorPixels = Math.max(
    TARGET_MAJOR_SPACING,
    viewportLength * MINOR_SUBDIVISIONS / (MAX_RULER_TICKS - 12)
  );
  const targetMajorStep = targetMajorPixels / zoom;
  if (!Number.isFinite(targetMajorStep) || targetMajorStep <= 0) return empty;

  const majorStep = niceCeiling(targetMajorStep);
  const minorStep = majorStep / MINOR_SUBDIVISIONS;
  if (!Number.isFinite(majorStep) || majorStep <= 0
      || !Number.isFinite(minorStep) || minorStep <= 0) return empty;

  const worldStart = -screenPan / zoom;
  const worldEnd = (viewportLength - screenPan) / zoom;
  if (!Number.isFinite(worldStart) || !Number.isFinite(worldEnd)) return empty;

  const firstIndex = Math.ceil(worldStart / minorStep);
  const lastIndex = Math.floor(worldEnd / minorStep);
  if (!Number.isFinite(firstIndex) || !Number.isFinite(lastIndex)
      || Math.abs(firstIndex) > Number.MAX_SAFE_INTEGER
      || Math.abs(lastIndex) > Number.MAX_SAFE_INTEGER
      || lastIndex < firstIndex
      || lastIndex - firstIndex + 1 > MAX_RULER_TICKS) return empty;

  const ticks = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const value = index * minorStep;
    const position = value * zoom + screenPan;
    if (!Number.isFinite(value) || !Number.isFinite(position)) continue;
    // Permit tiny arithmetic drift at the edges while keeping every emitted
    // position inside the caller's viewport.
    const edgeTolerance = Math.max(1, viewportLength) * 1e-12;
    if (position < -edgeTolerance || position > viewportLength + edgeTolerance) continue;

    const major = index % MINOR_SUBDIVISIONS === 0;
    ticks.push({
      value: Object.is(value, -0) ? 0 : value,
      position: Math.min(viewportLength, Math.max(0, position)),
      major,
      label: major ? formatRulerLabel(value) : null
    });
  }

  return { majorStep, minorStep, ticks };
}

function niceCeiling(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const exponent = Math.floor(Math.log10(value));
  const decade = 10 ** exponent;
  if (!Number.isFinite(decade) || decade <= 0) return value;
  const normalized = value / decade;
  const multiplier = NICE_MULTIPLIERS.find(candidate => candidate >= normalized) ?? 10;
  const result = multiplier * decade;
  return Number.isFinite(result) && result > 0 ? result : value;
}

function formatRulerLabel(value) {
  if (Object.is(value, -0)) value = 0;
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9 || (magnitude > 0 && magnitude < 1e-6)) {
    return value.toExponential(2).replace(/\.00e/, 'e').replace(/(\.\d)0e/, '$1e');
  }
  return String(Number(value.toPrecision(6)));
}
