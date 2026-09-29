export const horizontalConstraints = [
  ['left', 'Left'], ['right', 'Right'], ['left-right', 'Left and right'], ['center', 'Center'], ['scale', 'Scale']
];
export const verticalConstraints = [
  ['top', 'Top'], ['bottom', 'Bottom'], ['top-bottom', 'Top and bottom'], ['center', 'Center'], ['scale', 'Scale']
];

export function captureChildGeometry(frame) {
  return new Map((frame.children || []).map(child => [child.id, { x: child.x, y: child.y, width: child.width, height: child.height }]));
}

export function applyFrameConstraints(frame, oldWidth, oldHeight, newWidth, newHeight, snapshot = null) {
  if (!frame || frame.type !== 'frame' || frame.autoLayout) return;
  const dx = newWidth - oldWidth;
  const dy = newHeight - oldHeight;
  const scaleX = oldWidth ? newWidth / oldWidth : 1;
  const scaleY = oldHeight ? newHeight / oldHeight : 1;
  for (const child of frame.children || []) {
    const original = snapshot?.get(child.id) || child;
    const horizontal = child.constraints?.horizontal || 'left';
    const vertical = child.constraints?.vertical || 'top';
    if (horizontal === 'right') child.x = original.x + dx;
    else if (horizontal === 'left-right') { child.x = original.x; child.width = Math.max(1, original.width + dx); }
    else if (horizontal === 'center') child.x = original.x + dx / 2;
    else if (horizontal === 'scale') { child.x = original.x * scaleX; child.width = Math.max(1, original.width * scaleX); }
    if (vertical === 'bottom') child.y = original.y + dy;
    else if (vertical === 'top-bottom') { child.y = original.y; child.height = Math.max(1, original.height + dy); }
    else if (vertical === 'center') child.y = original.y + dy / 2;
    else if (vertical === 'scale') { child.y = original.y * scaleY; child.height = Math.max(1, original.height * scaleY); }
  }
}
