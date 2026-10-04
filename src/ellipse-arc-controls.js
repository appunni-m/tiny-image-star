import { ellipseArcParameters } from './ellipse-arc.js';

const TAU = Math.PI * 2;

function pointOnEllipse(node, angle, radius = 1) {
  return {
    x: node.width / 2 + Math.abs(node.width) / 2 * radius * Math.cos(angle),
    y: node.height / 2 + Math.abs(node.height) / 2 * radius * Math.sin(angle)
  };
}

export function ellipseArcControlHandles(node, zoom = 1) {
  if (!node || node.type !== 'ellipse' || !Number.isFinite(node.width) || !Number.isFinite(node.height)
    || !(Math.abs(node.width) > 0) || !(Math.abs(node.height) > 0)) return [];
  const { start, end, sweep, innerRadius, full } = ellipseArcParameters(node);
  const handles = [];
  const minimumRadiusOnScreen = Math.min(Math.abs(node.width), Math.abs(node.height)) / 2 * Math.max(.08, Number(zoom) || 1);
  const separation = full ? Math.min(Math.PI / 2, 14 / Math.max(.01, minimumRadiusOnScreen)) : 0;
  handles.push({ kind: 'start', label: 'Start', point: pointOnEllipse(node, start - separation) });
  handles.push({ kind: 'end', label: 'End', point: pointOnEllipse(node, end + separation) });
  if (!full || innerRadius > 0) {
    const angle = full ? start : start + sweep / 2;
    handles.push({ kind: 'innerRadius', label: 'Inner', point: pointOnEllipse(node, angle, innerRadius) });
  }
  return handles;
}

export function ellipseArcAngleFromPointer(node, localPoint) {
  if (!(Math.abs(node?.width) > 0) || !(Math.abs(node?.height) > 0)
    || !Number.isFinite(localPoint?.x) || !Number.isFinite(localPoint?.y)) return null;
  const x = (localPoint.x - node.width / 2) / (Math.abs(node.width) / 2);
  const y = (localPoint.y - node.height / 2) / (Math.abs(node.height) / 2);
  const angle = Math.atan2(y, x);
  return (angle % TAU + TAU) % TAU;
}

export function ellipseArcInnerRadiusFromPointer(node, localPoint) {
  if (!(Math.abs(node?.width) > 0) || !(Math.abs(node?.height) > 0)
    || !Number.isFinite(localPoint?.x) || !Number.isFinite(localPoint?.y)) return null;
  const x = (localPoint.x - node.width / 2) / (Math.abs(node.width) / 2);
  const y = (localPoint.y - node.height / 2) / (Math.abs(node.height) / 2);
  return Math.max(0, Math.min(1, Math.hypot(x, y)));
}

export function ellipseArcDataFromPointer(node, kind, localPoint, { startLocal = localPoint, initialArcData = null } = {}) {
  const { start, end, innerRadius } = ellipseArcParameters({ ...node, arcData: initialArcData || node.arcData });
  if (kind === 'start' || kind === 'end') {
    const angle = ellipseArcAngleFromPointer(node, localPoint);
    if (angle == null) return null;
    const referenceAngle = ellipseArcAngleFromPointer(node, startLocal);
    if (referenceAngle == null) return null;
    const difference = ((angle - referenceAngle + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const authoredAngle = kind === 'start' ? start : end;
    const movedAngle = ((authoredAngle + difference) % TAU + TAU) % TAU;
    // Keep the canonical 2π endpoint until a real drag crosses it; this preserves a complete ellipse.
    const nextAngle = Math.abs(difference) <= 1e-10 && kind === 'end' && end === TAU ? TAU : movedAngle;
    return kind === 'start'
      ? { startingAngle: nextAngle, endingAngle: end, innerRadius }
      : { startingAngle: start, endingAngle: nextAngle, innerRadius };
  }
  if (kind === 'innerRadius') {
    const radius = ellipseArcInnerRadiusFromPointer(node, localPoint);
    return radius == null ? null : { startingAngle: start, endingAngle: end, innerRadius: radius };
  }
  return null;
}
