const MIN_FRAME_DIMENSION = 0.01;
const MAX_FRAME_DIMENSION = 100_000;

/** Plan an exact frame/content fit without changing the children visually. */
export function planFrameResizeToFit(frame, contentBounds, {
  geometryOf = node => ({ x: node.x, y: node.y, width: node.width, height: node.height })
} = {}) {
  if (!frame || frame.type !== 'frame') throw new TypeError('A frame is required to resize to fit its contents.');
  if (frame.autoLayout) throw new TypeError('Set this auto-layout frame to Hug contents before resizing it to fit.');
  if (typeof geometryOf !== 'function') throw new TypeError('Frame content-fit geometry must be a function.');
  if (!contentBounds || !['x', 'y', 'width', 'height'].every(property => Number.isFinite(contentBounds[property]))) {
    throw new TypeError('Visible frame content must have finite bounds.');
  }
  if (contentBounds.width < MIN_FRAME_DIMENSION || contentBounds.height < MIN_FRAME_DIMENSION
    || contentBounds.width > MAX_FRAME_DIMENSION || contentBounds.height > MAX_FRAME_DIMENSION) {
    throw new RangeError('Visible frame content exceeds the supported frame size.');
  }

  const before = geometryOf(frame);
  if (!before || !['x', 'y', 'width', 'height'].every(property => Number.isFinite(before[property]))
    || before.width < MIN_FRAME_DIMENSION || before.height < MIN_FRAME_DIMENSION) {
    throw new TypeError('The selected frame has invalid geometry.');
  }
  const angle = Number(before.rotation ?? frame.rotation ?? 0) * Math.PI / 180;
  const rotation = { cos: Math.cos(angle), sin: Math.sin(angle) };
  const affine = frame.affineTransform || { a: 1, b: 0, c: 0, d: 1 };
  const determinant = affine.a * affine.d - affine.b * affine.c;
  if (!Number.isFinite(angle) || ![affine.a, affine.b, affine.c, affine.d, determinant].every(Number.isFinite)
    || Math.abs(determinant) <= 1e-12) throw new TypeError('The selected frame has an invalid transform.');

  const { x: contentX, y: contentY, width, height } = contentBounds;
  const oldCenter = { x: before.width / 2, y: before.height / 2 };
  const newCenter = { x: width / 2, y: height / 2 };
  const rotationTranslation = center => ({
    x: center.x - rotation.cos * center.x + rotation.sin * center.y,
    y: center.y - rotation.sin * center.x - rotation.cos * center.y
  });
  const oldRotationTranslation = rotationTranslation(oldCenter);
  const newRotationTranslation = rotationTranslation(newCenter);
  const linear = {
    a: affine.a * rotation.cos + affine.c * rotation.sin,
    b: affine.b * rotation.cos + affine.d * rotation.sin,
    c: -affine.a * rotation.sin + affine.c * rotation.cos,
    d: -affine.b * rotation.sin + affine.d * rotation.cos
  };
  const oldTranslation = {
    x: before.x + affine.a * oldRotationTranslation.x + affine.c * oldRotationTranslation.y,
    y: before.y + affine.b * oldRotationTranslation.x + affine.d * oldRotationTranslation.y
  };
  const desiredTranslation = {
    x: oldTranslation.x + linear.a * contentX + linear.c * contentY,
    y: oldTranslation.y + linear.b * contentX + linear.d * contentY
  };
  const after = {
    x: desiredTranslation.x - affine.a * newRotationTranslation.x - affine.c * newRotationTranslation.y,
    y: desiredTranslation.y - affine.b * newRotationTranslation.x - affine.d * newRotationTranslation.y,
    width,
    height
  };
  if (!['x', 'y', 'width', 'height'].every(property => Number.isFinite(after[property]))) {
    throw new RangeError('The fitted frame geometry is outside the supported range.');
  }

  const children = (frame.children || []).map(child => {
    if (!child || typeof child.id !== 'string' || !child.id) throw new TypeError('Every direct frame child needs a stable ID.');
    const geometry = geometryOf(child);
    if (!geometry || !Number.isFinite(geometry.x) || !Number.isFinite(geometry.y)) {
      throw new TypeError(`Layer “${child.name || child.id}” has invalid position geometry.`);
    }
    return { id: child.id, before: { x: geometry.x, y: geometry.y }, after: { x: geometry.x - contentX, y: geometry.y - contentY } };
  });
  const changed = !Object.keys(after).every(property => Object.is(after[property], before[property]))
    || children.some(child => !Object.is(child.before.x, child.after.x) || !Object.is(child.before.y, child.after.y));

  return {
    changed,
    before,
    after,
    children,
    contentBounds: { x: contentX, y: contentY, width, height }
  };
}
