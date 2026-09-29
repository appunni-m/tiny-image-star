export const FRAME = Object.freeze({ width: 1440, height: 1000, name: "Landing page" });

let sequence = 0;
export function makeId(prefix = "layer") {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

const text = (id, name, content, x, y, width, size, fill, options = {}) => ({
  id, name, type: "text", text: content, x, y, w: width, h: options.h ?? size * 1.25,
  fontSize: options.fontSize ?? size, fontFamily: options.fontFamily ?? "Inter, sans-serif", fontWeight: options.fontWeight ?? 400,
  lineHeight: options.lineHeight ?? 1.16, fill, section: options.section ?? "Hero", align: options.align ?? "left",
  opacity: 1, hidden: false, locked: false,
});

const rect = (id, name, x, y, w, h, fill, options = {}) => ({
  id, name, type: "rect", x, y, w, h, fill, radius: options.radius ?? 0,
  stroke: options.stroke ?? "", strokeWidth: options.strokeWidth ?? 0, section: options.section ?? "Hero",
  opacity: options.opacity ?? 1, hidden: false, locked: false,
});

const ellipse = (id, name, x, y, w, h, fill, options = {}) => ({
  id, name, type: "ellipse", x, y, w, h, fill, section: options.section ?? "Hero", opacity: options.opacity ?? 1,
  hidden: false, locked: false,
});

export function createDefaultDocument() {
  return {
    version: 1,
    title: "Northstar — Weekend escapes",
    frame: { ...FRAME },
    nodes: [
      rect("nav-rule", "Navigation divider", 92, 99, 1256, 1, "#e8e5de", { section: "Navigation" }),
      text("brand", "Brand", "northstar", 94, 61, 240, 27, "#242522", { section: "Navigation", fontFamily: "Georgia, serif", fontSize: 21, fontWeight: 700 }),
      text("nav-stays", "Navigation / Stays", "Stays", 878, 62, 70, 20, "#545550", { section: "Navigation", fontSize: 13, fontWeight: 500 }),
      text("nav-stories", "Navigation / Stories", "Stories", 982, 62, 80, 20, "#545550", { section: "Navigation", fontSize: 13, fontWeight: 500 }),
      text("nav-journal", "Navigation / Journal", "Journal", 1093, 62, 80, 20, "#545550", { section: "Navigation", fontSize: 13, fontWeight: 500 }),
      rect("nav-button", "Navigation / Button", 1201, 46, 146, 42, "#252721", { section: "Navigation", radius: 21 }),
      text("nav-button-label", "Navigation / Button label", "Plan a getaway", 1215, 72, 120, 17, "#ffffff", { section: "Navigation", fontSize: 12, fontWeight: 600 }),
      text("hero-kicker", "Eyebrow", "STAYS THAT TAKE YOU SOMEWHERE", 96, 193, 425, 18, "#777b60", { section: "Hero", fontSize: 10, fontWeight: 700 }),
      text("hero-heading", "Heading", "Find a little\nmore wonder.", 92, 286, 592, 176, "#262722", { section: "Hero", fontFamily: "Georgia, serif", fontSize: 76, fontWeight: 400, lineHeight: 1.04, h: 176 }),
      text("hero-copy", "Intro paragraph", "Quiet places, considered stays, and the long way\nround. Your next favourite place is closer than\nyou think.", 98, 518, 490, 72, "#65675e", { section: "Hero", fontSize: 16, lineHeight: 1.55, h: 76 }),
      rect("hero-cta", "Explore button", 96, 638, 206, 53, "#66704a", { section: "Hero", radius: 26 }),
      text("hero-cta-label", "Explore button / Label", "Explore the collection  ↗", 116, 670, 172, 16, "#ffffff", { section: "Hero", fontSize: 12, fontWeight: 650 }),
      text("hero-note", "Small note", "CURATED FOR THE UNHURRIED", 96, 734, 300, 13, "#898b80", { section: "Hero", fontSize: 9, fontWeight: 650 }),
      { id: "landscape", name: "Alpine lake illustration", type: "landscape", x: 706, y: 142, w: 648, h: 574, section: "Hero", opacity: 1, hidden: false, locked: false },
      rect("card-one", "Card / background", 96, 835, 396, 94, "#eeece3", { section: "Places", radius: 8 }),
      ellipse("card-one-dot", "Card / icon", 119, 858, 46, 46, "#d9dcc7", { section: "Places" }),
      text("card-one-title", "Card / Title", "Small stays, big horizons", 183, 869, 270, 17, "#35362f", { section: "Places", fontSize: 13, fontWeight: 650 }),
      text("card-one-copy", "Card / Description", "Somewhere to wake up a little different.", 183, 894, 280, 14, "#77786e", { section: "Places", fontSize: 10 }),
      rect("card-two", "Card / background 2", 522, 835, 396, 94, "#edf0eb", { section: "Places", radius: 8 }),
      ellipse("card-two-dot", "Card / icon 2", 545, 858, 46, 46, "#d0ddd5", { section: "Places" }),
      text("card-two-title", "Card / Title 2", "A slower kind of weekend", 609, 869, 270, 17, "#35362f", { section: "Places", fontSize: 13, fontWeight: 650 }),
      text("card-two-copy", "Card / Description 2", "Let the best part be how long you stay.", 609, 894, 280, 14, "#77786e", { section: "Places", fontSize: 10 }),
      rect("card-three", "Card / background 3", 948, 835, 396, 94, "#f1eae4", { section: "Places", radius: 8 }),
      ellipse("card-three-dot", "Card / icon 3", 971, 858, 46, 46, "#e7d3c2", { section: "Places" }),
      text("card-three-title", "Card / Title 3", "Made for the out-of-office", 1035, 869, 270, 17, "#35362f", { section: "Places", fontSize: 13, fontWeight: 650 }),
      text("card-three-copy", "Card / Description 3", "A few nights can change your whole week.", 1035, 894, 280, 14, "#77786e", { section: "Places", fontSize: 10 }),
    ],
    groups: [
      { id: "places", name: "Places", collapsed: false },
      { id: "hero", name: "Hero", collapsed: false },
      { id: "navigation", name: "Navigation", collapsed: false },
    ],
  };
}

export function createBlankPage(name = "Page") {
  return {
    id: makeId("page"), name,
    frame: { width: FRAME.width, height: FRAME.height, name: "Frame" },
    nodes: [], groups: [],
  };
}

export function createLayer(type, x, y, overrides = {}) {
  const count = sequence + 1;
  const defaults = {
    rect: { name: "Rectangle", w: 180, h: 110, fill: "#d9d2ff", radius: 2, section: "Hero" },
    ellipse: { name: "Ellipse", w: 120, h: 120, fill: "#f2b35d", section: "Hero" },
    text: { name: "Text", text: "Type something", w: 260, h: 48, fontSize: 32, fontFamily: "Inter, sans-serif", fontWeight: 500, lineHeight: 1.2, fill: "#26262a", section: "Hero" },
    frame: { name: "Frame", w: 360, h: 240, fill: "#ffffff", stroke: "#d6d6dc", strokeWidth: 1, radius: 0, section: "Hero" },
  };
  const base = defaults[type] ?? defaults.rect;
  return { id: makeId(type), type, x, y, ...base, opacity: 1, hidden: false, locked: false, ...overrides, name: overrides.name ?? `${base.name} ${count}` };
}

export function selectionBounds(nodes) {
  const visible = nodes.filter((node) => !node.hidden && Number.isFinite(node.x) && Number.isFinite(node.y)
    && Number.isFinite(node.w) && Number.isFinite(node.h) && node.w > 0 && node.h > 0);
  if (!visible.length) return null;
  const left = Math.min(...visible.map((node) => node.x));
  const top = Math.min(...visible.map((node) => node.y));
  const right = Math.max(...visible.map((node) => node.x + node.w));
  const bottom = Math.max(...visible.map((node) => node.y + node.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const HANDLE_DIRECTIONS = Object.freeze({
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0],
  se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
});

export function resizedBounds(bounds, handle, point, { preserveAspect = false, minSize = 8 } = {}) {
  const direction = HANDLE_DIRECTIONS[handle];
  if (!bounds || !direction) return bounds;
  const [dx, dy] = direction;
  const right = bounds.x + bounds.w;
  const bottom = bounds.y + bounds.h;
  let left = bounds.x;
  let top = bounds.y;
  let width = bounds.w;
  let height = bounds.h;

  if (dx < 0) { width = Math.max(minSize, right - point.x); left = right - width; }
  if (dx > 0) width = Math.max(minSize, point.x - bounds.x);
  if (dy < 0) { height = Math.max(minSize, bottom - point.y); top = bottom - height; }
  if (dy > 0) height = Math.max(minSize, point.y - bounds.y);

  if (preserveAspect && dx !== 0 && dy !== 0) {
    const aspect = bounds.w / bounds.h;
    const widthChange = Math.abs(width / bounds.w - 1);
    const heightChange = Math.abs(height / bounds.h - 1);
    if (widthChange >= heightChange) height = Math.max(minSize, width / aspect);
    else width = Math.max(minSize, height * aspect);
    if (dx < 0) left = right - width;
    if (dy < 0) top = bottom - height;
  }

  return { x: left, y: top, w: width, h: height };
}

export function scaleNodesToBounds(nodes, from, to) {
  if (!from || !to || from.w <= 0 || from.h <= 0) return;
  const sx = to.w / from.w;
  const sy = to.h / from.h;
  const textScale = Math.sqrt(Math.abs(sx * sy));
  for (const node of nodes) {
    if (node.locked || node.hidden) continue;
    node.x = to.x + (node.x - from.x) * sx;
    node.y = to.y + (node.y - from.y) * sy;
    node.w = Math.max(1, node.w * sx);
    node.h = Math.max(1, node.h * sy);
    if (node.type === "text") node.fontSize = Math.max(1, (node.fontSize ?? 16) * textScale);
  }
}
