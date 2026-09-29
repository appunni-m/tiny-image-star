const DEFAULT_PADDING = Object.freeze({ top: 16, right: 16, bottom: 16, left: 16 });
const MAX_FRAME_SIZE = 16_000;

export function createAutoLayout(direction = "vertical") {
  return {
    direction: direction === "horizontal" ? "horizontal" : "vertical",
    spacing: 12,
    padding: { ...DEFAULT_PADDING },
    justify: "start",
    align: "start",
    primarySizing: "hug",
    counterSizing: "hug",
  };
}

export function normalizeAutoLayout(value) {
  const base = createAutoLayout(value?.direction);
  const choices = (candidate, allowed, fallback) => allowed.includes(candidate) ? candidate : fallback;
  const padding = value?.padding && typeof value.padding === "object" ? value.padding : {};
  const bounded = (candidate, fallback, max = 1000) => Number.isFinite(Number(candidate)) ? Math.min(max, Math.max(0, Number(candidate))) : fallback;
  base.spacing = bounded(value?.spacing, base.spacing);
  base.padding = Object.fromEntries(Object.keys(DEFAULT_PADDING).map((side) => [side, bounded(padding[side], DEFAULT_PADDING[side])]));
  base.justify = choices(value?.justify, ["start", "center", "end", "space-between"], "start");
  base.align = choices(value?.align, ["start", "center", "end", "stretch"], "start");
  base.primarySizing = choices(value?.primarySizing, ["hug", "fixed"], "hug");
  base.counterSizing = choices(value?.counterSizing, ["hug", "fixed"], "hug");
  return base;
}

export function normalizeLayoutSizing(value) {
  return {
    primary: value?.primary === "fill" ? "fill" : "fixed",
    counter: value?.counter === "fill" ? "fill" : "fixed",
  };
}

export function inferAutoLayout(nodes) {
  const visible = nodes.filter((node) => !node.hidden);
  if (visible.length < 2) return { direction: "vertical", spacing: 12, order: visible };
  const centers = visible.map((node) => ({ node, x: node.x + node.w / 2, y: node.y + node.h / 2 }));
  const spread = (key) => Math.max(...centers.map((point) => point[key])) - Math.min(...centers.map((point) => point[key]));
  const direction = spread("x") >= spread("y") ? "horizontal" : "vertical";
  const axis = direction === "horizontal" ? "x" : "y";
  const ordered = centers.slice().sort((a, b) => a[axis] - b[axis]);
  const gaps = ordered.slice(1).map((point, index) => direction === "horizontal"
    ? point.node.x - (ordered[index].node.x + ordered[index].node.w)
    : point.node.y - (ordered[index].node.y + ordered[index].node.h)).filter((gap) => gap >= 0);
  const spacing = gaps.length ? Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) : 12;
  return { direction, spacing, order: ordered.map((point) => point.node) };
}

function sizeAlong(node, axis) { return axis === "x" ? node.w : node.h; }
function setSizeAlong(node, axis, size) { if (axis === "x") node.w = size; else node.h = size; }
function setCoordinateAlong(node, axis, value) { if (axis === "x") node.x = value; else node.y = value; }

function layoutFrame(frame, children) {
  const layout = frame.autoLayout;
  const visible = children.filter((node) => !node.hidden).slice().sort((a, b) => (a.layoutOrder ?? 0) - (b.layoutOrder ?? 0));
  if (!layout || !visible.length) return;
  const horizontal = layout.direction === "horizontal";
  const primaryAxis = horizontal ? "x" : "y";
  const counterAxis = horizontal ? "y" : "x";
  const primaryStart = horizontal ? "left" : "top";
  const primaryEnd = horizontal ? "right" : "bottom";
  const counterStart = horizontal ? "top" : "left";
  const counterEnd = horizontal ? "bottom" : "right";
  const padding = { ...DEFAULT_PADDING, ...layout.padding };
  const spacing = Math.max(0, Number(layout.spacing) || 0);
  const primaryFrameSize = horizontal ? frame.w : frame.h;
  const counterFrameSize = horizontal ? frame.h : frame.w;
  const primaryAvailable = Math.max(0, primaryFrameSize - padding[primaryStart] - padding[primaryEnd]);
  const counterAvailable = Math.max(0, counterFrameSize - padding[counterStart] - padding[counterEnd]);
  const primaryMode = layout.primarySizing === "fixed" ? "fixed" : "hug";
  const counterMode = layout.counterSizing === "fixed" ? "fixed" : "hug";
  const fillItems = visible.filter((node) => node.layoutSizing?.primary === "fill");
  const fixedPrimary = visible.filter((node) => !fillItems.includes(node));
  const primaryUsed = fixedPrimary.reduce((sum, node) => sum + sizeAlong(node, primaryAxis), 0) + spacing * Math.max(0, visible.length - 1);
  if (primaryMode === "hug") {
    const measured = primaryUsed + fillItems.reduce((sum, node) => sum + sizeAlong(node, primaryAxis), 0)
      + padding[primaryStart] + padding[primaryEnd];
    if (horizontal) frame.w = Math.min(MAX_FRAME_SIZE, Math.max(1, measured));
    else frame.h = Math.min(MAX_FRAME_SIZE, Math.max(1, measured));
  } else if (fillItems.length) {
    const fillSize = Math.max(1, (primaryAvailable - primaryUsed) / fillItems.length);
    for (const node of fillItems) setSizeAlong(node, primaryAxis, fillSize);
  }

  let maxCounter = 0;
  for (const node of visible) {
    const sizing = node.layoutSizing?.counter;
    if (counterMode === "fixed" && (layout.align === "stretch" || sizing === "fill")) setSizeAlong(node, counterAxis, counterAvailable);
    maxCounter = Math.max(maxCounter, sizeAlong(node, counterAxis));
  }
  if (counterMode === "hug") {
    const measured = maxCounter + padding[counterStart] + padding[counterEnd];
    if (horizontal) frame.h = Math.min(MAX_FRAME_SIZE, Math.max(1, measured));
    else frame.w = Math.min(MAX_FRAME_SIZE, Math.max(1, measured));
  }

  const finalPrimaryFrame = horizontal ? frame.w : frame.h;
  const finalCounterFrame = horizontal ? frame.h : frame.w;
  const finalPrimaryAvailable = Math.max(0, finalPrimaryFrame - padding[primaryStart] - padding[primaryEnd]);
  const finalCounterAvailable = Math.max(0, finalCounterFrame - padding[counterStart] - padding[counterEnd]);
  const occupied = visible.reduce((sum, node) => sum + sizeAlong(node, primaryAxis), 0) + spacing * Math.max(0, visible.length - 1);
  const remaining = Math.max(0, finalPrimaryAvailable - occupied);
  let offset = layout.justify === "center" ? remaining / 2 : layout.justify === "end" ? remaining : 0;
  let gap = spacing;
  if (layout.justify === "space-between" && visible.length > 1) gap += remaining / (visible.length - 1);
  let cursor = (horizontal ? frame.x : frame.y) + padding[primaryStart] + offset;
  for (const node of visible) {
    setCoordinateAlong(node, primaryAxis, cursor);
    const crossSize = sizeAlong(node, counterAxis);
    const counterSizing = node.layoutSizing?.counter;
    const align = counterMode === "fixed" && (layout.align === "stretch" || counterSizing === "fill") ? "start" : layout.align;
    const crossOffset = align === "center" ? (finalCounterAvailable - crossSize) / 2 : align === "end" ? finalCounterAvailable - crossSize : 0;
    setCoordinateAlong(node, counterAxis, (horizontal ? frame.y : frame.x) + padding[counterStart] + Math.max(0, crossOffset));
    cursor += sizeAlong(node, primaryAxis) + gap;
  }
}

export function layoutAutoLayoutTree(nodes, rootFrame) {
  const ancestors = new Set();
  function visit(frame, depth) {
    if (!frame?.autoLayout || depth > 64 || ancestors.has(frame.id)) return;
    ancestors.add(frame.id);
    const children = nodes.filter((node) => node.parentId === frame.id);
    layoutFrame(frame, children);
    for (const child of children) if (child.autoLayout) visit(child, depth + 1);
    ancestors.delete(frame.id);
  }
  visit(rootFrame, 0);
}
