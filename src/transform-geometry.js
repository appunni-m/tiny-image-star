/** Pure affine geometry shared by canvas transform drawing and pointer handling. */

const EPSILON = 1e-12;

/** Return the signed shortest angular step between two radian samples. */
export function shortestAngleDelta(previousAngle, nextAngle) {
  if (!Number.isFinite(previousAngle) || !Number.isFinite(nextAngle)) {
    throw new TypeError('Rotation angles must be finite radians.');
  }
  let delta = nextAngle - previousAngle;
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export const IDENTITY_AFFINE = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

function finiteGeometry(node) {
  return node && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(Number(node[key])))
    && Number.isFinite(Number(node.rotation ?? 0));
}

function assertGeometry(node, label = 'Node') {
  if (!finiteGeometry(node) || Number(node.width) < 0 || Number(node.height) < 0) {
    throw new TypeError(`${label} transform needs finite x, y, width, height, and rotation values.`);
  }
  if (node.affineTransform != null) {
    const { a, b, c, d } = node.affineTransform;
    const determinant = a * d - b * c;
    if (![a, b, c, d, determinant].every(Number.isFinite) || Math.abs(determinant) <= EPSILON) {
      throw new TypeError(`${label} affine transform must be finite and invertible.`);
    }
  }
}

/** Return left ∘ right for Canvas-style affine matrices. */
export function multiplyAffine(left, right) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f
  };
}

export function transformPoint(matrix, point) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f
  };
}

/** Transform a displacement without applying translation. */
export function transformVector(matrix, vector) {
  return {
    x: matrix.a * vector.x + matrix.c * vector.y,
    y: matrix.b * vector.x + matrix.d * vector.y
  };
}

export function invertAffine(matrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= EPSILON) throw new TypeError('Cannot invert a singular affine transform.');
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant
  };
}

/**
 * Transform node-local coordinates into its parent's coordinates. This matches
 * SceneRenderer.drawNode: translate to the node bounds, then rotate around the
 * node center, while descendants inherit every ancestor's transform.
 */
export function nodeToParentTransform(node) {
  assertGeometry(node);
  const radians = Number(node.rotation || 0) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const cx = Number(node.width) / 2;
  const cy = Number(node.height) / 2;
  const rotationAboutCenter = {
    a: cosine, b: sine, c: -sine, d: cosine,
    e: cx - cosine * cx + sine * cy,
    f: cy - sine * cx - cosine * cy
  };
  const linear = node.affineTransform || IDENTITY_AFFINE;
  const affine = { a: linear.a, b: linear.b, c: linear.c, d: linear.d, e: 0, f: 0 };
  return multiplyAffine(
    multiplyAffine({ ...IDENTITY_AFFINE, e: Number(node.x), f: Number(node.y) }, affine),
    rotationAboutCenter
  );
}

/**
 * Compose a node-local to page-space transform. `ancestors` must be ordered
 * from outermost page child through the node's immediate parent.
 */
export function nodeLocalToPageTransform(node, ancestors = []) {
  if (!Array.isArray(ancestors)) throw new TypeError('Ancestors must be an array ordered from outermost to innermost.');
  let result = IDENTITY_AFFINE;
  for (const ancestor of ancestors) result = multiplyAffine(result, nodeToParentTransform(ancestor));
  return multiplyAffine(result, nodeToParentTransform(node));
}

export function parentLocalToPageTransform(ancestors = []) {
  if (!Array.isArray(ancestors)) throw new TypeError('Ancestors must be an array ordered from outermost to innermost.');
  let result = IDENTITY_AFFINE;
  for (const ancestor of ancestors) result = multiplyAffine(result, nodeToParentTransform(ancestor));
  return result;
}

export function nodeLocalToPage(node, point, ancestors = []) {
  return transformPoint(nodeLocalToPageTransform(node, ancestors), point);
}

export function pageToNodeLocal(node, point, ancestors = []) {
  return transformPoint(invertAffine(nodeLocalToPageTransform(node, ancestors)), point);
}

/** Map a page-space point into the node's unrotated parent coordinate space. */
export function pageToNodeParentLocal(node, point, ancestors = []) {
  const local = pageToNodeLocal(node, point, ancestors);
  return { x: Number(node.x) + local.x, y: Number(node.y) + local.y };
}

export function pageToParentLocal(point, ancestors = []) {
  return transformPoint(invertAffine(parentLocalToPageTransform(ancestors)), point);
}

const HANDLE_NAMES = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);

function handleLocalPoint(node, name) {
  const { width, height } = node;
  const x = name.includes('w') ? 0 : name.includes('e') ? width : width / 2;
  const y = name.includes('n') ? 0 : name.includes('s') ? height : height / 2;
  return { x, y };
}

/** Exact page-space resize and rotate handle positions for a node. */
export function getTransformHandles(node, ancestors = [], { rotateOffset = 24 } = {}) {
  assertGeometry(node);
  if (!Number.isFinite(rotateOffset) || rotateOffset < 0) throw new TypeError('Rotate offset must be a finite non-negative distance.');
  const handles = Object.fromEntries(HANDLE_NAMES.map(name => [name, nodeLocalToPage(node, handleLocalPoint(node, name), ancestors)]));
  return {
    resize: handles,
    rotate: nodeLocalToPage(node, { x: node.width / 2, y: -rotateOffset }, ancestors)
  };
}

function oppositeHandle(name) {
  return [...name].map(character => character === 'n' ? 's' : character === 's' ? 'n' : character === 'e' ? 'w' : character === 'w' ? 'e' : '').join('');
}

function handleAxes(name) {
  if (!HANDLE_NAMES.includes(name)) throw new TypeError(`Unknown resize handle: ${name}`);
  return { x: name.includes('e') || name.includes('w'), y: name.includes('n') || name.includes('s') };
}

/**
 * Resize a rotated node from a page-space pointer while keeping its opposite
 * handle fixed in page space. The pointer is projected into the original
 * node's local axes. Crossing the opposite handle clamps the active dimension
 * to one unit to avoid negative dimensions or an implicit handle flip. For a
 * corner handle, an optional `aspectRatio` projects the pointer onto that
 * ratio in local space; edge handles remain one-dimensional.
 *
 * `rect` and returned x/y are in the immediate parent's coordinate space.
 */
export function resizeOrientedRect(rect, handle, pointerPage, ancestors = [], { minSize = 1, aspectRatio } = {}) {
  assertGeometry(rect, 'Rectangle');
  if (!Number.isFinite(pointerPage?.x) || !Number.isFinite(pointerPage?.y)) throw new TypeError('Resize pointer must have finite page coordinates.');
  if (!Number.isFinite(minSize) || minSize <= 0) throw new TypeError('Minimum resize size must be a positive finite number.');
  const axes = handleAxes(handle);
  if (aspectRatio !== undefined && (!Number.isFinite(aspectRatio) || aspectRatio <= 0)) throw new TypeError('Aspect ratio must be a positive finite number.');
  const fixedHandle = oppositeHandle(handle);
  const original = { ...rect, rotation: Number(rect.rotation || 0) };
  const pointerLocal = pageToNodeLocal(original, pointerPage, ancestors);
  const fixedLocal = handleLocalPoint(original, fixedHandle);
  let width = Number(original.width);
  let height = Number(original.height);

  if (axes.x && axes.y && aspectRatio !== undefined) {
    const rawWidth = Math.max(0, (handle.includes('e') ? 1 : -1) * (pointerLocal.x - fixedLocal.x));
    const rawHeight = Math.max(0, (handle.includes('s') ? 1 : -1) * (pointerLocal.y - fixedLocal.y));
    // Least-squares projection of the pointer offset onto width = ratio * height.
    height = Math.max(minSize, minSize / aspectRatio, (aspectRatio * rawWidth + rawHeight) / (aspectRatio ** 2 + 1));
    width = aspectRatio * height;
  } else if (axes.x) {
    const east = handle.includes('e');
    const movingX = east ? Math.max(fixedLocal.x + minSize, pointerLocal.x) : Math.min(fixedLocal.x - minSize, pointerLocal.x);
    width = Math.abs(movingX - fixedLocal.x);
  }
  if (!(axes.x && axes.y && aspectRatio !== undefined) && axes.y) {
    const south = handle.includes('s');
    const movingY = south ? Math.max(fixedLocal.y + minSize, pointerLocal.y) : Math.min(fixedLocal.y - minSize, pointerLocal.y);
    height = Math.abs(movingY - fixedLocal.y);
  }

  const resized = { ...original, x: 0, y: 0, width, height };
  const nextFixedLocal = handleLocalPoint(resized, fixedHandle);
  const fixedPage = nodeLocalToPage(original, fixedLocal, ancestors);
  const parentTransform = parentLocalToPageTransform(ancestors);
  const fixedParent = transformPoint(invertAffine(parentTransform), fixedPage);
  const fixedOffset = transformPoint(nodeToParentTransform(resized), nextFixedLocal);
  resized.x = fixedParent.x - fixedOffset.x;
  resized.y = fixedParent.y - fixedOffset.y;
  return resized;
}
