import { getNodeColor, getNodePropertyValue } from './model.js';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Number(parsed.toFixed(4))) : '0';
}

function cssString(value) {
  return `"${String(value ?? '').replace(/[\\"\n\r\f]/g, character => {
    if (character === '\\') return '\\\\';
    if (character === '"') return '\\"';
    return ' ';
  })}"`;
}

function cssIdentifier(value) {
  const token = String(value || 'layer').normalize('NFKD').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return token || 'layer';
}

function cssColor(color, alpha = 1) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || ''));
  if (!match) return color === 'transparent' ? 'transparent' : null;
  const value = Number.parseInt(match[1], 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255];
  const opacity = Math.max(0, Math.min(1, Number(alpha) || 0));
  return opacity >= 1 ? `#${match[1].toLowerCase()}` : `rgba(${channels.join(', ')}, ${number(opacity)})`;
}

function absolutePosition(entry) {
  let x = Number(entry.node.x) || 0;
  let y = Number(entry.node.y) || 0;
  for (const parent of entry.parents || []) { x += Number(parent.x) || 0; y += Number(parent.y) || 0; }
  return { x, y };
}

function autoLayoutDeclarations(layout) {
  if (!layout || typeof layout !== 'object') return [];
  if (layout.axis === 'grid') {
    return [
      'display: grid;',
      `grid-template-columns: repeat(${Math.max(1, Math.floor(Number(layout.columns) || 1))}, minmax(0, 1fr));`,
      `row-gap: ${number(layout.rowGap)}px;`,
      `column-gap: ${number(layout.columnGap)}px;`
    ];
  }
  const horizontal = layout.axis === 'horizontal';
  const padding = layout.padding || {};
  const align = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' }[layout.align] || 'flex-start';
  const justify = { start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between' }[layout.justify] || 'flex-start';
  return [
    'display: flex;',
    `flex-direction: ${horizontal ? 'row' : 'column'};`,
    `row-gap: ${number(layout.rowGap)}px;`,
    `column-gap: ${number(layout.columnGap)}px;`,
    `padding: ${number(padding.top)}px ${number(padding.right)}px ${number(padding.bottom)}px ${number(padding.left)}px;`,
    `align-items: ${align};`,
    `justify-content: ${justify};`,
    ...(layout.wrap ? ['flex-wrap: wrap;'] : [])
  ];
}

function cssForEntry(document, entry) {
  const node = entry.node;
  const position = absolutePosition(entry);
  const parentLayout = entry.parents?.at(-1)?.autoLayout || null;
  const identity = String(node.id || '').slice(-6).replace(/[^a-z0-9_-]/gi, '').toLowerCase();
  const selector = `.${cssIdentifier(node.name)}${identity ? `-${identity}` : ''}`;
  const declarations = [
    ...(parentLayout ? ['/* Placement is controlled by the parent auto layout. */', 'position: relative;'] : [
      'position: absolute;',
      `left: ${number(position.x)}px;`,
      `top: ${number(position.y)}px;`
    ]),
    `width: ${number(node.width)}px;`,
    `height: ${number(node.height)}px;`,
    'box-sizing: border-box;',
    `opacity: ${number(getNodePropertyValue(document, node, 'opacity') ?? 1)};`
  ];
  if (parentLayout?.axis === 'grid') {
    const cell = node.gridCell || {};
    if (Number.isInteger(cell.column)) declarations.push(`grid-column: ${cell.column} / span ${Math.max(1, Number(cell.columnSpan) || 1)};`);
    if (Number.isInteger(cell.row)) declarations.push(`grid-row: ${cell.row} / span ${Math.max(1, Number(cell.rowSpan) || 1)};`);
  } else if (parentLayout) {
    if (node.layoutSizingMain === 'fill') declarations.push('flex: 1 1 0;', ...(parentLayout.axis === 'horizontal' ? ['min-width: 0;'] : ['min-height: 0;']));
    else declarations.push('flex: 0 0 auto;');
    if (node.layoutSizingCross === 'fill') declarations.push('align-self: stretch;');
  }
  const rotation = Number(node.rotation) || 0;
  if (rotation) declarations.push(`transform: rotate(${number(rotation)}deg);`, 'transform-origin: center;');

  if (node.type === 'text') {
    const fontSize = Number(getNodePropertyValue(document, node, 'fontSize')) || 24;
    const lineHeight = Number(getNodePropertyValue(document, node, 'lineHeight')) || 1.25;
    const color = cssColor(getNodeColor(document, node, 'text'));
    if (color) declarations.push(`color: ${color};`);
    declarations.push(
      `font-family: ${cssString(node.fontFamily || 'Arial, sans-serif')};`,
      `font-size: ${number(fontSize)}px;`,
      `font-weight: ${number(node.fontWeight || 400)};`,
      `line-height: ${number(fontSize * lineHeight)}px;`,
      `letter-spacing: ${number(getNodePropertyValue(document, node, 'letterSpacing') || 0)}px;`,
      `text-align: ${['left', 'center', 'right'].includes(node.align) ? node.align : 'left'};`
    );
  } else if (node.type === 'image') {
    declarations.push(`object-fit: ${node.fit === 'contain' ? 'contain' : 'cover'};`);
    const radius = Number(getNodePropertyValue(document, node, 'radius')) || 0;
    if (radius) declarations.push(`border-radius: ${number(radius)}px;`);
  } else {
    const fill = getNodeColor(document, node, 'fill');
    const background = cssColor(fill, node.fillOpacity ?? 1);
    if (background && node.type !== 'line' && (node.type !== 'path' || node.closed !== false)) declarations.push(`background-color: ${background};`);
    if (node.type === 'line') {
      const stroke = cssColor(getNodeColor(document, node, 'stroke'));
      if (stroke && Number(node.strokeWidth) > 0) declarations.push(`border-top: ${number(node.strokeWidth)}px solid ${stroke};`);
      declarations.push('/* Exact line geometry is retained in layer JSON. */');
    } else if (node.stroke && Number(node.strokeWidth) > 0) {
      const stroke = cssColor(getNodeColor(document, node, 'stroke'));
      if (stroke) declarations.push(`border: ${number(node.strokeWidth)}px solid ${stroke};`);
    }
    const radius = Number(getNodePropertyValue(document, node, 'radius')) || 0;
    if (radius) declarations.push(`border-radius: ${number(radius)}px;`);
  }

  if (node.type === 'frame' && node.clip) declarations.push('overflow: hidden;');
  if (node.visible === false) declarations.push('display: none;');
  declarations.push(...autoLayoutDeclarations(node.autoLayout));
  if (node.type === 'path' || node.type === 'boolean' || node.mask) declarations.push('/* Vector, Boolean, and mask geometry is retained in layer JSON. */');
  return `${selector} {\n${declarations.map(declaration => `  ${declaration}`).join('\n')}\n}`;
}

function summaryForEntry(document, entry) {
  const node = entry.node;
  const position = absolutePosition(entry);
  const fill = getNodeColor(document, node, node.type === 'text' ? 'text' : 'fill');
  const summary = {
    id: node.id,
    name: node.name,
    type: node.type,
    parent: entry.parents?.at(-1)?.name || 'Page',
    position,
    size: { width: node.width, height: node.height },
    rotation: Number(node.rotation) || 0,
    opacity: getNodePropertyValue(document, node, 'opacity') ?? 1
  };
  if (fill) summary.color = fill;
  if (node.stroke && Number(node.strokeWidth) > 0) summary.stroke = { color: getNodeColor(document, node, 'stroke'), width: node.strokeWidth };
  if (node.type === 'text') {
    summary.text = getNodePropertyValue(document, node, 'text');
    summary.typography = {
      fontFamily: node.fontFamily,
      fontSize: getNodePropertyValue(document, node, 'fontSize'),
      fontWeight: node.fontWeight,
      lineHeight: getNodePropertyValue(document, node, 'lineHeight'),
      letterSpacing: getNodePropertyValue(document, node, 'letterSpacing'),
      align: node.align
    };
  }
  if (node.type === 'image') summary.image = { fileName: node.fileName, fit: node.fit, sourceWidth: node.sourceWidth, sourceHeight: node.sourceHeight };
  if (node.autoLayout) summary.autoLayout = node.autoLayout;
  return summary;
}

export function buildInspectOutput(document, entries) {
  const selected = Array.isArray(entries) ? entries.filter(entry => entry?.node) : [];
  return {
    layers: selected.map(entry => summaryForEntry(document, entry)),
    css: selected.map(entry => cssForEntry(document, entry)).join('\n\n'),
    json: JSON.stringify(selected.length === 1 ? selected[0].node : selected.map(entry => entry.node), null, 2)
  };
}
