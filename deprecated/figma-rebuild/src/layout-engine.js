const clamp = (value, min = 0) => Math.max(min, Number.isFinite(Number(value)) ? Number(value) : 0);

export function createAutoLayout(overrides = {}) {
  return {
    axis: 'vertical', gap: 8, padding: { top: 16, right: 16, bottom: 16, left: 16 },
    align: 'start', justify: 'start', wrap: false, mainSizing: 'fixed', crossSizing: 'fixed',
    ...overrides,
    padding: typeof overrides.padding === 'object'
      ? { top: 16, right: 16, bottom: 16, left: 16, ...overrides.padding }
      : { top: overrides.padding ?? 16, right: overrides.padding ?? 16, bottom: overrides.padding ?? 16, left: overrides.padding ?? 16 }
  };
}

function groupedItems(frame, settings, flowItems) {
  const horizontal = settings.axis === 'horizontal';
  const padding = settings.padding;
  const availableMain = horizontal
    ? Math.max(0, frame.width - padding.left - padding.right)
    : Math.max(0, frame.height - padding.top - padding.bottom);
  if (!settings.wrap || settings.mainSizing === 'hug') return [flowItems];
  const groups = []; let group = []; let used = 0;
  for (const item of flowItems) {
    const size = horizontal ? item.width : item.height;
    const extra = group.length ? settings.gap : 0;
    if (group.length && used + extra + size > availableMain) { groups.push(group); group = []; used = 0; }
    if (group.length) used += settings.gap;
    group.push(item); used += size;
  }
  if (group.length) groups.push(group);
  return groups;
}

function distribute(items, mainAvailable, settings) {
  const horizontal = settings.axis === 'horizontal';
  const sizes = items.map(item => horizontal ? item.width : item.height);
  const occupied = sizes.reduce((sum, value) => sum + value, 0);
  const spare = Math.max(0, mainAvailable - occupied);
  let gap = settings.gap;
  let start = 0;
  if (settings.justify === 'center') start = spare / 2;
  else if (settings.justify === 'end') start = spare;
  else if (settings.justify === 'space-between' && items.length > 1) gap = Math.max(0, spare / (items.length - 1));
  return { start, gap };
}

export function applyAutoLayout(frame) {
  if (!frame || frame.type !== 'frame' || !frame.autoLayout) return frame;
  const settings = createAutoLayout(frame.autoLayout);
  const horizontal = settings.axis === 'horizontal';
  const padding = settings.padding;
  const flowItems = (frame.children || []).filter(node => node.visible && node.layoutPositioning !== 'absolute');
  const groups = groupedItems(frame, settings, flowItems);
  const gap = clamp(settings.gap);
  const mainAvailable = horizontal
    ? Math.max(0, frame.width - padding.left - padding.right)
    : Math.max(0, frame.height - padding.top - padding.bottom);
  const crossAvailable = horizontal
    ? Math.max(0, frame.height - padding.top - padding.bottom)
    : Math.max(0, frame.width - padding.left - padding.right);
  let crossCursor = horizontal ? padding.top : padding.left;
  let computedMain = 0;

  for (const group of groups) {
    const lineCross = group.reduce((max, item) => Math.max(max, horizontal ? item.height : item.width), 0);
    const fillItems = settings.mainSizing === 'fixed' ? group.filter(item => item.layoutSizingMain === 'fill') : [];
    if (fillItems.length) {
      const usedByFixedItems = group.filter(item => item.layoutSizingMain !== 'fill').reduce((sum, item) => sum + (horizontal ? item.width : item.height), 0);
      const remaining = Math.max(0, mainAvailable - usedByFixedItems - gap * Math.max(0, group.length - 1));
      const fillSize = Math.max(1, remaining / fillItems.length);
      for (const item of fillItems) { if (horizontal) item.width = fillSize; else item.height = fillSize; }
    }
    const content = distribute(group, mainAvailable, settings.mainSizing === 'hug' ? { ...settings, justify: 'start' } : settings);
    let mainCursor = (horizontal ? padding.left : padding.top) + (settings.mainSizing === 'hug' ? 0 : content.start);
    computedMain = Math.max(computedMain, group.reduce((sum, item) => sum + (horizontal ? item.width : item.height), 0) + Math.max(0, group.length - 1) * content.gap);
    for (const item of group) {
      const mainSize = horizontal ? item.width : item.height;
      const crossSize = horizontal ? item.height : item.width;
      const canStretch = settings.align === 'stretch' && item.layoutSizingCross !== 'fixed';
      const nextCrossSize = canStretch ? crossAvailable : crossSize;
      const alignOffset = settings.align === 'center' ? (lineCross - crossSize) / 2 : settings.align === 'end' ? lineCross - crossSize : 0;
      if (horizontal) {
        item.x = mainCursor;
        item.y = crossCursor + Math.max(0, alignOffset);
        if (canStretch) item.height = nextCrossSize;
      } else {
        item.x = crossCursor + Math.max(0, alignOffset);
        item.y = mainCursor;
        if (canStretch) item.width = nextCrossSize;
      }
      mainCursor += mainSize + content.gap;
    }
    crossCursor += lineCross + gap;
  }

  if (flowItems.length) {
    if (settings.mainSizing === 'hug') {
      if (horizontal) frame.width = computedMain + padding.left + padding.right;
      else frame.height = computedMain + padding.top + padding.bottom;
    }
    if (settings.crossSizing === 'hug') {
      const crossExtent = groups.reduce((sum, group) => sum + group.reduce((max, item) => Math.max(max, horizontal ? item.height : item.width), 0), 0) + Math.max(0, groups.length - 1) * gap;
      if (horizontal) frame.height = crossExtent + padding.top + padding.bottom;
      else frame.width = crossExtent + padding.left + padding.right;
    }
  }
  frame.autoLayout = settings;
  return frame;
}
