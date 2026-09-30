import { getNodeColor, getNodeGeometry, getNodePropertyValue } from './model.js';
import { buildLayerEffectFilter } from './layer-effects.js';
import { gradientFillToCSS } from './fills.js';

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

const genericFontFamilies = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'emoji', 'math', 'fangsong']);

function cssFontFamily(value) {
  return String(value || 'Arial, sans-serif').split(',').map(entry => {
    const family = entry.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!family) return '';
    return genericFontFamilies.has(family.toLowerCase()) ? family.toLowerCase() : cssString(family);
  }).filter(Boolean).join(', ');
}

function cssIdentifier(value) {
  const token = String(value || 'layer').normalize('NFKD').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return token || 'layer';
}

function cssClass(node) {
  const identity = String(node.id || '').slice(-6).replace(/[^a-z0-9_-]/gi, '').toLowerCase();
  return `${cssIdentifier(node.name)}${identity ? `-${identity}` : ''}`;
}

function escapeMarkup(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function cssColor(color, alpha = 1) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || ''));
  if (!match) return color === 'transparent' ? 'transparent' : null;
  const value = Number.parseInt(match[1], 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255];
  const opacity = Math.max(0, Math.min(1, Number(alpha) || 0));
  return opacity >= 1 ? `#${match[1].toLowerCase()}` : `rgba(${channels.join(', ')}, ${number(opacity)})`;
}

function absolutePosition(document, entry) {
  const own = getNodeGeometry(document, entry.node);
  let x = Number(own.x) || 0;
  let y = Number(own.y) || 0;
  for (const parent of entry.parents || []) {
    const geometry = getNodeGeometry(document, parent);
    x += Number(geometry.x) || 0;
    y += Number(geometry.y) || 0;
  }
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

function strokePatternStyle(node) {
  return ['dashed', 'dotted'].includes(node.strokePattern) ? node.strokePattern : 'solid';
}

function cssForEntry(document, entry) {
  const node = entry.node;
  const geometry = getNodeGeometry(document, node);
  const position = absolutePosition(document, entry);
  const parentLayout = entry.parents?.at(-1)?.autoLayout || null;
  const selector = `.${cssClass(node)}`;
  const declarations = [
    ...(parentLayout ? ['/* Placement is controlled by the parent auto layout. */', 'position: relative;'] : [
      'position: absolute;',
      `left: ${number(position.x)}px;`,
      `top: ${number(position.y)}px;`
    ]),
    `width: ${number(geometry.width)}px;`,
    `height: ${number(geometry.height)}px;`,
    'box-sizing: border-box;',
    `opacity: ${number(getNodePropertyValue(document, node, 'opacity') ?? 1)};`
  ];
  const additionalRules = [];
  for (const [property, cssProperty] of [['minWidth', 'min-width'], ['maxWidth', 'max-width'], ['minHeight', 'min-height'], ['maxHeight', 'max-height']]) {
    if (Number.isFinite(node[property])) declarations.push(`${cssProperty}: ${number(node[property])}px;`);
  }
  if (parentLayout?.axis === 'grid') {
    const cell = node.gridCell || {};
    if (Number.isInteger(cell.column)) declarations.push(`grid-column: ${cell.column} / span ${Math.max(1, Number(cell.columnSpan) || 1)};`);
    if (Number.isInteger(cell.row)) declarations.push(`grid-row: ${cell.row} / span ${Math.max(1, Number(cell.rowSpan) || 1)};`);
  } else if (parentLayout) {
    if (node.layoutSizingMain === 'fill') declarations.push('flex: 1 1 0;', ...(parentLayout.axis === 'horizontal' ? [Number.isFinite(node.minWidth) ? '' : 'min-width: 0;'] : [Number.isFinite(node.minHeight) ? '' : 'min-height: 0;']).filter(Boolean));
    else declarations.push('flex: 0 0 auto;');
    if (node.layoutSizingCross === 'fill') declarations.push('align-self: stretch;');
  }
  const rotation = Number(geometry.rotation) || 0;
  if (rotation) declarations.push(`transform: rotate(${number(rotation)}deg);`, 'transform-origin: center;');
  const effectFilter = buildLayerEffectFilter(node.effects);
  if (effectFilter !== 'none') declarations.push(`filter: ${effectFilter};`);
  if (node.blendMode && node.blendMode !== 'normal') declarations.push(`mix-blend-mode: ${node.blendMode};`);

  if (node.type === 'text') {
    const fontSize = Number(getNodePropertyValue(document, node, 'fontSize')) || 24;
    const lineHeight = Number(getNodePropertyValue(document, node, 'lineHeight')) || 1.25;
    const paragraphSpacing = Math.max(0, Number(node.paragraphSpacing) || 0);
    // Match canvas and SVG text layout: leave at least one pixel for text in
    // narrow boxes so a large indent cannot push the first line outside.
    const firstLineIndent = Math.min(
      Math.max(0, Number(node.firstLineIndent) || 0),
      Math.max(0, Number(geometry.width) - 1)
    );
    const color = cssColor(getNodeColor(document, node, 'text'));
    if (color) declarations.push(`color: ${color};`);
    declarations.push(
      `font-family: ${cssFontFamily(node.fontFamily)};`,
      `font-size: ${number(fontSize)}px;`,
      `font-weight: ${number(node.fontWeight || 400)};`,
      `font-style: ${node.fontStyle === 'italic' ? 'italic' : 'normal'};`,
      `line-height: ${number(fontSize * lineHeight)}px;`,
      `letter-spacing: ${number(getNodePropertyValue(document, node, 'letterSpacing') || 0)}px;`,
      'display: block;',
      `text-align: ${['left', 'center', 'right'].includes(node.align) ? node.align : 'left'};`,
      ...(['middle', 'bottom'].includes(node.verticalAlign) ? [
        'display: flex;',
        'flex-direction: column;',
        `justify-content: ${node.verticalAlign === 'middle' ? 'center' : 'flex-end'};`
      ] : []),
      `text-transform: ${['uppercase', 'lowercase', 'capitalize'].includes(node.textCase) ? node.textCase : 'none'};`,
      `text-decoration: ${['underline', 'line-through'].includes(node.textDecoration) ? node.textDecoration : 'none'};`
    );
    const paragraphClass = `${cssClass(node)}__paragraph`;
    additionalRules.push(
      `.${paragraphClass} {\n  display: block;\n  margin: 0;\n  min-height: ${number(fontSize * lineHeight)}px;\n  text-indent: ${number(firstLineIndent)}px;\n  white-space: pre-wrap;\n}`,
      `.${cssClass(node)} > .${paragraphClass} + .${paragraphClass} {\n  margin-block-start: ${number(paragraphSpacing)}px;\n}`
    );
  } else if (node.type === 'image') {
    declarations.push(`object-fit: ${node.fit === 'contain' ? 'contain' : 'cover'};`);
    const radius = Number(getNodePropertyValue(document, node, 'radius')) || 0;
    if (radius) declarations.push(`border-radius: ${number(radius)}px;`);
  } else {
    const fill = getNodeColor(document, node, 'fill');
    const background = cssColor(fill, node.fillOpacity ?? 1);
    const gradientBackground = gradientFillToCSS(node.fillGradient, node.fillOpacity ?? 1);
    if (node.imageFill && node.type !== 'line' && (node.type !== 'path' || node.closed !== false)) declarations.push('/* Local image fill source and adjustments are retained in layer JSON. */');
    else if (gradientBackground && node.type !== 'line' && (node.type !== 'path' || node.closed !== false)) declarations.push(`background: ${gradientBackground};`);
    else if (background && node.type !== 'line' && (node.type !== 'path' || node.closed !== false)) declarations.push(`background-color: ${background};`);
    if (node.type === 'line') {
      const stroke = cssColor(getNodeColor(document, node, 'stroke'));
      if (stroke && Number(node.strokeWidth) > 0) declarations.push(`border-top: ${number(node.strokeWidth)}px ${strokePatternStyle(node)} ${stroke};`);
      declarations.push('/* Exact line geometry is retained in layer JSON. */');
    } else if (node.stroke && Number(node.strokeWidth) > 0) {
      const stroke = cssColor(getNodeColor(document, node, 'stroke'));
      if (stroke) declarations.push(`border: ${number(node.strokeWidth)}px ${strokePatternStyle(node)} ${stroke};`);
    }
    if (node.stroke && Number(node.strokeWidth) > 0
      && ((node.strokeCap && node.strokeCap !== 'butt') || (node.strokeJoin && node.strokeJoin !== 'miter')
        || (node.strokeMiterLimit != null && node.strokeMiterLimit !== 10))) {
      declarations.push(`/* Vector stroke cap/join/miter limit (${node.strokePattern === 'dotted' ? 'round' : node.strokeCap || 'butt'}/${node.strokeJoin || 'miter'}/${node.strokeMiterLimit ?? 10}) remain exact in layer JSON. */`);
    }
    const radius = Number(getNodePropertyValue(document, node, 'radius')) || 0;
    if (radius) declarations.push(`border-radius: ${number(radius)}px;`);
  }

  if (node.type === 'frame' && node.clip) declarations.push('overflow: hidden;');
  if (getNodePropertyValue(document, node, 'visible') === false) declarations.push('display: none;');
  declarations.push(...autoLayoutDeclarations(node.autoLayout));
  if (node.type === 'path' || node.type === 'network' || node.type === 'boolean' || node.mask) declarations.push('/* Vector, Boolean, and mask geometry is retained in layer JSON. */');
  return `${selector} {\n${declarations.map(declaration => `  ${declaration}`).join('\n')}\n}${additionalRules.length ? `\n${additionalRules.join('\n')}` : ''}`;
}

function markupForNode(document, node) {
  const className = cssClass(node);
  const type = escapeMarkup(node.type || 'layer');
  if (node.type === 'text') {
    const value = getNodePropertyValue(document, node, 'text') ?? '';
    const paragraphs = String(value).replace(/\r\n?/g, '\n').split('\n')
      .map(paragraph => `<span class="${className}__paragraph">${escapeMarkup(paragraph)}</span>`).join('');
    return `<span class="${className}" data-layer-type="text">${paragraphs}</span>`;
  }
  if (node.type === 'image') {
    const label = escapeMarkup(node.fileName || node.name || 'Local image');
    return `<div class="${className}" data-layer-type="image" role="img" aria-label="${label}"><!-- Set the source to the local image asset in your app. --></div>`;
  }
  const children = (node.children || []).map(child => markupForNode(document, child)).join('\n');
  const content = children ? `\n${children}\n` : '';
  return `<div class="${className}" data-layer-type="${type}">${content}</div>`;
}

function jsxString(value) {
  return JSON.stringify(String(value ?? '')).replace(/[\u2028\u2029]/g, character => character === '\u2028' ? '\\u2028' : '\\u2029');
}

function jsxForNode(document, node, depth = 0) {
  const indent = '  '.repeat(depth);
  const className = jsxString(cssClass(node));
  const type = jsxString(node.type || 'layer');
  if (node.type === 'text') {
    const paragraphs = String(getNodePropertyValue(document, node, 'text') ?? '').replace(/\r\n?/g, '\n').split('\n')
      .map(paragraph => `${indent}  <span className={${jsxString(`${cssClass(node)}__paragraph`)}}>{${jsxString(paragraph)}}</span>`).join('\n');
    return `${indent}<span className={${className}} data-layer-type={${jsxString('text')}}>\n${paragraphs}\n${indent}</span>`;
  }
  if (node.type === 'image') {
    const label = jsxString(node.fileName || node.name || 'Local image');
    return `${indent}<div className={${className}} data-layer-type={${type}} role={${jsxString('img')}} aria-label={${label}}>{/* Set the source to the local image asset in your app. */}</div>`;
  }
  const children = (node.children || []).map(child => jsxForNode(document, child, depth + 1));
  if (!children.length) return `${indent}<div className={${className}} data-layer-type={${type}} />`;
  return `${indent}<div className={${className}} data-layer-type={${type}}>\n${children.join('\n')}\n${indent}</div>`;
}

function reactComponent(css, roots, document) {
  const intro = "import React from 'react';\n\n";
  if (!roots.length) return `${intro}export default function TinyImageStarHandoff() {\n  return null;\n}\n`;
  const children = roots.map(entry => jsxForNode(document, entry.node, roots.length > 1 ? 4 : 3));
  const content = children.length === 1 ? children[0] : `      <>\n${children.join('\n')}\n      </>`;
  return `${intro}const styles = ${jsxString(css)};\n\nexport default function TinyImageStarHandoff() {\n  return (\n    <>\n      <style>{styles}</style>\n${content}\n    </>\n  );\n}\n`;
}

function treeEntries(root) {
  const entries = [];
  const visit = (node, parents) => {
    entries.push({ node, parents });
    for (const child of node.children || []) visit(child, [...parents, node]);
  };
  visit(root.node, root.parents || []);
  return entries;
}

function summaryForEntry(document, entry) {
  const node = entry.node;
  const geometry = getNodeGeometry(document, node);
  const position = absolutePosition(document, entry);
  const fill = getNodeColor(document, node, node.type === 'text' ? 'text' : 'fill');
  const summary = {
    id: node.id,
    name: node.name,
    type: node.type,
    parent: entry.parents?.at(-1)?.name || 'Page',
    position,
    size: { width: geometry.width, height: geometry.height },
    rotation: Number(geometry.rotation) || 0,
    opacity: getNodePropertyValue(document, node, 'opacity') ?? 1
  };
  if (fill) summary.color = fill;
  if (node.fillGradient) summary.fillGradient = node.fillGradient;
  if (node.imageFill) summary.imageFill = node.imageFill;
  if (node.blendMode && node.blendMode !== 'normal') summary.blendMode = node.blendMode;
  if (node.stroke && Number(node.strokeWidth) > 0) summary.stroke = {
    color: getNodeColor(document, node, 'stroke'), width: node.strokeWidth,
    cap: node.strokePattern === 'dotted' ? 'round' : node.strokeCap || 'butt',
    join: node.strokeJoin || 'miter', miterLimit: node.strokeMiterLimit ?? 10, pattern: strokePatternStyle(node)
  };
  if (node.type === 'text') {
    summary.text = getNodePropertyValue(document, node, 'text');
    summary.typography = {
      fontFamily: node.fontFamily,
      fontSize: getNodePropertyValue(document, node, 'fontSize'),
      fontWeight: node.fontWeight,
      fontStyle: node.fontStyle || 'normal',
      lineHeight: getNodePropertyValue(document, node, 'lineHeight'),
      letterSpacing: getNodePropertyValue(document, node, 'letterSpacing'),
      paragraphSpacing: Number(node.paragraphSpacing) || 0,
      firstLineIndent: Number(node.firstLineIndent) || 0,
      align: node.align,
      verticalAlign: ['top', 'middle', 'bottom'].includes(node.verticalAlign) ? node.verticalAlign : 'top',
      textCase: ['none', 'uppercase', 'lowercase', 'capitalize'].includes(node.textCase) ? node.textCase : 'none',
      textDecoration: ['none', 'underline', 'line-through'].includes(node.textDecoration) ? node.textDecoration : 'none'
    };
  }
  if (node.type === 'image') summary.image = { fileName: node.fileName, fit: node.fit, sourceWidth: node.sourceWidth, sourceHeight: node.sourceHeight };
  if (node.autoLayout) summary.autoLayout = node.autoLayout;
  if (node.effects?.length) summary.effects = node.effects;
  const sizeLimits = Object.fromEntries(['minWidth', 'maxWidth', 'minHeight', 'maxHeight'].filter(property => Number.isFinite(node[property])).map(property => [property, node[property]]));
  if (Object.keys(sizeLimits).length) summary.sizeLimits = sizeLimits;
  return summary;
}

export function buildInspectOutput(document, entries) {
  const selected = Array.isArray(entries) ? entries.filter(entry => entry?.node) : [];
  const selectedIds = new Set(selected.map(entry => entry.node.id));
  const roots = selected.filter(entry => !(entry.parents || []).some(parent => selectedIds.has(parent.id)));
  const includedEntries = roots.flatMap(treeEntries);
  const css = includedEntries.map(entry => cssForEntry(document, entry)).join('\n\n');
  return {
    layers: selected.map(entry => summaryForEntry(document, entry)),
    css,
    html: roots.map(entry => markupForNode(document, entry.node)).join('\n'),
    json: JSON.stringify(selected.length === 1 ? selected[0].node : selected.map(entry => entry.node), null, 2),
    jsx: reactComponent(css, roots, document)
  };
}
