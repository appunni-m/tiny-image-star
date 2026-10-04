import { getNodeColor, getNodeGeometry, getNodePropertyValue, variableModeForNode } from './model.js';
import { buildLayerEffectBoxShadow, buildLayerEffectFilter } from './layer-effects.js';
import { gradientFillToCSS } from './fills.js';
import { nodeLocalToPage } from './transform-geometry.js';
import { vectorPathContours } from './vector-path.js';
import { strokeSideMode, strokeSideWidths, strokeStackForNode } from './strokes.js';
import { resolvedLineHeight } from './text-layout.js';
import { fontFeatureSettings } from './font-features.js';

function hasFillablePathContour(node) {
  return vectorPathContours(node).some(contour => contour.closed && contour.points.length >= 2);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Number(parsed.toFixed(4))) : '0';
}

function borderRadiusCss(document, node) {
  if (node.type === 'polygon' || node.type === 'star') return null;
  if (node.cornerRadii) {
    const values = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].map(side => Math.max(0, Number(node.cornerRadii[side]) || 0));
    if (values.some(Boolean)) return values.map(value => `${number(value)}px`).join(' ');
    return null;
  }
  const radius = Number(getNodePropertyValue(document, node, 'radius')) || 0;
  return radius ? `${number(radius)}px` : null;
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

function colorVariableToken(document, node, kind) {
  const property = ({ fill: 'fillVariableId', text: 'textVariableId', stroke: 'strokeVariableId' })[kind];
  const variableId = property && node?.[property];
  const variable = variableId && document.variables?.find(item => item.id === variableId && item.type === 'color');
  const collection = variable && document.variableCollections?.find(item => item.id === variable.collectionId);
  if (!variable || !collection) return null;
  const modeId = variableModeForNode(document, collection.id, node) || collection.defaultModeId;
  const mode = collection.modes?.find(item => item.id === modeId);
  if (!mode) return null;
  const name = `--tis-${cssIdentifier(collection.name)}-${cssIdentifier(variable.name)}-${cssIdentifier(variable.id)}-${cssIdentifier(mode.id)}`;
  return { name, value: getNodeColor(document, node, kind) };
}

function cssColorWithVariable(document, node, kind, alpha = 1) {
  const value = getNodeColor(document, node, kind);
  const fallback = cssColor(value, alpha);
  if (Number(alpha) < 1) return fallback;
  const token = colorVariableToken(document, node, kind);
  return token && fallback ? `var(${token.name}, ${fallback})` : fallback;
}

function cssVariableDefinitions(document, entries) {
  const definitions = new Map();
  for (const { node } of entries) {
    for (const kind of ['fill', 'text', 'stroke']) {
      const token = colorVariableToken(document, node, kind);
      const value = token && cssColor(token.value);
      if (token && value) definitions.set(token.name, value);
    }
  }
  if (!definitions.size) return '';
  return `:root {\n${[...definitions].map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}`;
}

function cssClass(node) {
  const identity = String(node.id || '').slice(-6).replace(/[^a-z0-9_-]/gi, '').toLowerCase();
  return `${cssIdentifier(node.name)}${identity ? `-${identity}` : ''}`;
}

const codegenEffectNames = Object.freeze({ glass: 'Glass', noise: 'Noise', texture: 'Texture' });

function codegenEffectWarning(node) {
  const blendedEffects = (node?.effects || []).filter(effect => effect && effect.visible !== false
    && effect.blendMode && effect.blendMode !== 'normal');
  if (blendedEffects.length) {
    return 'Non-normal effect blend modes are preserved in layer data but need the live scene backdrop and are not reproduced by generated CSS.';
  }
  const effects = (node?.effects || []).filter(effect => effect && effect.visible !== false
    && Object.hasOwn(codegenEffectNames, effect.type));
  if (!effects.length) return null;
  const names = [...new Set(effects.map(effect => codegenEffectNames[effect.type]))].join(', ');
  return `Visible ${names} effect${effects.length === 1 ? ' is' : 's are'} preserved in layer data but not reproduced by generated CSS.`;
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

function generatedRootPosition(document, entry) {
  const own = getNodeGeometry(document, entry.node);
  const ancestors = (entry.parents || []).map(parent => ({ ...parent, ...getNodeGeometry(document, parent) }));
  const center = nodeLocalToPage(
    { ...entry.node, ...own },
    { x: Number(own.width) / 2, y: Number(own.height) / 2 },
    ancestors
  );
  return { x: center.x - Number(own.width) / 2, y: center.y - Number(own.height) / 2 };
}

function generatedRootRotation(document, entry) {
  const own = getNodeGeometry(document, entry.node);
  return (entry.parents || []).reduce((rotation, parent) => rotation + (Number(getNodeGeometry(document, parent).rotation) || 0), Number(own.rotation) || 0);
}

function autoLayoutDeclarations(layout, children = []) {
  if (!layout || typeof layout !== 'object') return [];
  if (layout.axis === 'grid') {
    const hasFractionalMinimum = ['columnTracks', 'rowTracks'].some(axis =>
      Array.isArray(layout[axis]) && layout[axis].some(track => Number.isFinite(track?.minWeight)));
    const trackBoundWarning = hasFractionalMinimum
      ? 'Fractional track minimums are preserved in layer JSON and Tiny Image Star local layout; CSS Grid cannot express these lower bounds directly.'
      : null;
    const trackCss = (track, fallback = 'fill') => {
      const mode = ['fixed', 'hug', 'fill'].includes(track?.mode) ? track.mode : fallback;
      const maximum = mode === 'fixed' ? `${number(track.value)}px`
        : mode === 'hug' ? 'max-content' : `${number(track.weight || 1)}fr`;
      if (track?.minContent) return `minmax(max-content, ${maximum})`;
      if (Number.isFinite(track?.minSize)) return `minmax(${number(track.minSize)}px, ${maximum})`;
      if (mode === 'fixed') return maximum;
      if (mode === 'hug') return maximum;
      return `minmax(0, ${maximum})`;
    };
    const columnCount = Math.max(1, Math.min(64, Math.floor(Number(layout.columns) || 1)));
    const columns = Array.isArray(layout.columnTracks)
      ? Array.from({ length: columnCount }, (_, index) => trackCss(layout.columnTracks[index]))
      : null;
    const requiredRows = children
      .filter(child => child.visible !== false && child.layoutPositioning !== 'absolute')
      .reduce((max, child) => Math.max(max, (Number(child.gridCell?.row) || 1) + Math.max(1, Number(child.gridCell?.rowSpan) || 1) - 1), 0);
    const rowCount = layout.rows === 'auto' || layout.rows == null
      ? Math.min(64, requiredRows)
      : Math.max(Math.min(64, Math.floor(Number(layout.rows) || 1)), Math.min(64, requiredRows));
    const rowFallback = layout.rows === 'auto' || layout.rows == null ? 'hug' : 'fill';
    const rows = rowCount && (Array.isArray(layout.rowTracks) || rowFallback === 'fill')
      ? Array.from({ length: rowCount }, (_, index) => trackCss(layout.rowTracks?.[index], rowFallback))
      : null;
    const padding = layout.padding || {};
    return [
      ...(trackBoundWarning ? [`/* ${trackBoundWarning} */`] : []),
      'display: grid;',
      columns ? `grid-template-columns: ${columns.join(' ')};` : `grid-template-columns: repeat(${columnCount}, minmax(0, 1fr));`,
      ...(rows ? [`grid-template-rows: ${rows.join(' ')};`] : ['grid-auto-rows: max-content;']),
      `padding: ${number(padding.top)}px ${number(padding.right)}px ${number(padding.bottom)}px ${number(padding.left)}px;`,
      `row-gap: ${number(layout.rowGap)}px;`,
      `column-gap: ${number(layout.columnGap)}px;`
    ];
  }
  const horizontal = layout.axis === 'horizontal';
  const padding = layout.padding || {};
  const align = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' }[layout.align] || 'flex-start';
  const justify = {
    start: 'flex-start', center: 'center', end: 'flex-end',
    'space-between': 'space-between', 'space-around': 'space-around', 'space-evenly': 'space-evenly'
  }[layout.justify] || 'flex-start';
  const rowGap = Number(layout.rowGap) || 0;
  const columnGap = Number(layout.columnGap) || 0;
  return [
    'display: flex;',
    `flex-direction: ${horizontal ? 'row' : 'column'};`,
    `row-gap: ${number(Math.max(0, rowGap))}px;`,
    `column-gap: ${number(Math.max(0, columnGap))}px;`,
    ...(rowGap < 0 || columnGap < 0 ? [`/* Negative overlap spacing (${number(rowGap)}px row, ${number(columnGap)}px column) remains exact in layer JSON; CSS gap cannot be negative. */`] : []),
    `padding: ${number(padding.top)}px ${number(padding.right)}px ${number(padding.bottom)}px ${number(padding.left)}px;`,
    `align-items: ${align};`,
    `justify-content: ${justify};`,
    ...(layout.wrap ? ['flex-wrap: wrap;'] : [])
  ];
}

function strokePatternStyle(node) {
  const pattern = node.strokePattern ?? node.pattern;
  return ['dashed', 'dotted', 'custom'].includes(pattern) ? pattern : 'solid';
}

function resolvedStroke(document, node, stroke, index) {
  return {
    color: stroke.gradient?.stops?.[0]?.color ?? (index === 0 && node.strokeVariableId ? getNodeColor(document, node, 'stroke') : stroke.color),
    ...(stroke.gradient ? { gradient: structuredClone(stroke.gradient) } : {}),
    width: stroke.width,
    opacity: stroke.opacity,
    visible: stroke.visible,
    cap: stroke.pattern === 'dotted' ? 'round' : stroke.cap,
    join: stroke.join,
    miterLimit: stroke.miterLimit,
    pattern: strokePatternStyle(stroke),
    ...(strokeSideMode(stroke) !== 'all' || stroke.sideWidths
      ? { sideMode: strokeSideMode(stroke), sideWidths: strokeSideWidths(stroke) }
      : {}),
    ...(stroke.pattern === 'custom' && Array.isArray(stroke.dashArray) ? { dashArray: [...stroke.dashArray] } : {})
  };
}

function cssForEntry(document, entry) {
  const node = entry.node;
  const geometry = getNodeGeometry(document, node);
  const codegenParents = entry.codegenParents || [];
  const isCodegenRoot = codegenParents.length === 0;
  const position = isCodegenRoot
    ? generatedRootPosition(document, entry)
    : { x: Number(geometry.x) || 0, y: Number(geometry.y) || 0 };
  const placementParent = codegenParents.at(-1) || entry.parents?.at(-1);
  const parentLayout = placementParent?.autoLayout || null;
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
    if (['start', 'center', 'end'].includes(cell.alignX)) declarations.push(`justify-self: ${cell.alignX};`);
    if (['start', 'center', 'end'].includes(cell.alignY)) declarations.push(`align-self: ${cell.alignY};`);
    if (node.layoutSizingX === 'fill') declarations.push('width: 100%;');
    if (node.layoutSizingY === 'fill') declarations.push('height: 100%;');
  } else if (parentLayout) {
    if (node.layoutSizingMain === 'fill') declarations.push('flex: 1 1 0;', ...(parentLayout.axis === 'horizontal' ? [Number.isFinite(node.minWidth) ? '' : 'min-width: 0;'] : [Number.isFinite(node.minHeight) ? '' : 'min-height: 0;']).filter(Boolean));
    else declarations.push('flex: 0 0 auto;');
    const selfAlignment = ({ start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' })[node.layoutAlignSelf];
    if (selfAlignment) declarations.push(`align-self: ${selfAlignment};`);
    else if (node.layoutSizingCross === 'fill') declarations.push('align-self: stretch;');
  }
  const rotation = isCodegenRoot && !parentLayout ? generatedRootRotation(document, entry) : Number(geometry.rotation) || 0;
  if (rotation) declarations.push(`transform: rotate(${number(rotation)}deg);`, 'transform-origin: center;');
  const effectFilter = buildLayerEffectFilter(node.effects);
  if (effectFilter !== 'none') declarations.push(`filter: ${effectFilter};`);
  const unsupportedEffectWarning = codegenEffectWarning(node);
  if (unsupportedEffectWarning) declarations.push(`/* ${unsupportedEffectWarning} */`);
  const backdropFilter = (node.effects || []).filter(effect => effect.type === 'background-blur' && effect.visible !== false)
    .map(effect => `blur(${number(effect.radius)}px)`).join(' ');
  if (backdropFilter) declarations.push(`backdrop-filter: ${backdropFilter};`);
  const effectBoxShadow = buildLayerEffectBoxShadow(node.effects);
  if (effectBoxShadow !== 'none') declarations.push(`box-shadow: ${effectBoxShadow};`);
  if (node.blendMode && node.blendMode !== 'normal') declarations.push(`mix-blend-mode: ${node.blendMode};`);

  if (node.type === 'text') {
    const fontSize = Number(getNodePropertyValue(document, node, 'fontSize')) || 24;
    const lineHeight = resolvedLineHeight(getNodePropertyValue(document, node, 'lineHeight') || 1.25, fontSize, node.lineHeightUnit || 'ratio');
    const paragraphSpacing = Math.max(0, Number(node.paragraphSpacing) || 0);
    // Match canvas and SVG text layout: leave at least one pixel for text in
    // narrow boxes so a large indent cannot push the first line outside.
    const firstLineIndent = Math.min(
      Math.max(0, Number(node.firstLineIndent) || 0),
      Math.max(0, Number(geometry.width) - 1)
    );
    const paragraphStyles = normalizedParagraphStyles(node.text, node.paragraphStyles);
    const hasListParagraphs = paragraphStyles.some(paragraph => paragraph.listStyle !== 'none');
    const listSpacing = Math.max(0, Number(node.listSpacing) || 0);
    const color = cssColorWithVariable(document, node, 'text');
    if (color) declarations.push(`color: ${color};`);
    declarations.push(
      `font-family: ${cssFontFamily(node.fontFamily)};`,
      `font-size: ${number(fontSize)}px;`,
      `font-weight: ${number(node.fontWeight || 400)};`,
      `font-style: ${node.fontStyle === 'italic' ? 'italic' : 'normal'};`,
      ...(fontFeatureSettings(node.fontFeatures) ? [`font-feature-settings: ${fontFeatureSettings(node.fontFeatures)};`] : []),
      `line-height: ${number(lineHeight)}px;`,
      `letter-spacing: ${number(getNodePropertyValue(document, node, 'letterSpacing') || 0)}px;`,
      'display: block;',
      `text-align: ${['left', 'center', 'right', 'justify'].includes(node.align) ? node.align : 'left'};`,
      ...(['middle', 'bottom'].includes(node.verticalAlign) ? [
        'display: flex;',
        'flex-direction: column;',
        `justify-content: ${node.verticalAlign === 'middle' ? 'center' : 'flex-end'};`
      ] : []),
      `text-transform: ${['uppercase', 'lowercase', 'capitalize'].includes(node.textCase) ? node.textCase : 'none'};`,
      `text-decoration: ${['underline', 'line-through'].includes(node.textDecoration) ? node.textDecoration : 'none'};`,
      ...(['balance', 'pretty'].includes(node.textWrapStyle) ? [`text-wrap: ${node.textWrapStyle};`] : [])
    );
    if (node.textTruncation === 'ending') {
      declarations.push('overflow: hidden;');
      if (Number.isSafeInteger(node.maxLines) && node.maxLines > 0) {
        declarations.push('display: -webkit-box;', '-webkit-box-orient: vertical;', `-webkit-line-clamp: ${node.maxLines};`);
      }
    }
    const paragraphClass = `${cssClass(node)}__paragraph`;
    additionalRules.push(
      `.${paragraphClass} {\n  display: block;\n  margin: 0;\n  min-height: ${number(lineHeight)}px;\n  text-indent: ${number(firstLineIndent)}px;\n  white-space: pre-wrap;\n}`,
      ...['balance', 'pretty'].map(style => `.${cssClass(node)} > .${paragraphClass}[data-text-wrap-style="${style}"] {\n  text-wrap: ${style};\n}`),
      `.${cssClass(node)} > .${paragraphClass} + .${paragraphClass} {\n  margin-block-start: ${number(paragraphSpacing)}px;\n}`
    );
    if (hasListParagraphs) {
      additionalRules.push(
        `.${cssClass(node)} > .${paragraphClass}[data-list-style] {\n  position: relative;\n}`,
        `.${cssClass(node)} > .${paragraphClass}[data-list-style]::before {\n  position: absolute;\n  left: 0;\n  width: 24px;\n  text-align: right;\n  white-space: nowrap;\n  text-indent: 0;\n  text-transform: none;\n  content: attr(data-list-marker);\n}`,
        ...Array.from({ length: 5 }, (_, level) => {
          const contentIndent = 32 + level * 24;
          const markerOffset = level * 24;
          return `.${cssClass(node)} > .${paragraphClass}[data-list-level="${level}"] {\n  padding-inline-start: ${contentIndent}px;\n}\n.${cssClass(node)} > .${paragraphClass}[data-list-level="${level}"]::before {\n  left: ${markerOffset}px;\n}`;
        }),
        `.${cssClass(node)} > .${paragraphClass}[data-list-style] + .${paragraphClass}[data-list-style] {\n  margin-block-start: ${number(listSpacing)}px;\n}`
      );
    }
  } else if (node.type === 'image') {
    declarations.push(`object-fit: ${node.fit === 'contain' ? 'contain' : 'cover'};`);
    const radius = borderRadiusCss(document, node);
    if (radius) declarations.push(`border-radius: ${radius};`);
    if (node.cornerSmoothing > 0) declarations.push(`/* Corner smoothing ${number(node.cornerSmoothing * 100)}% is retained in Tiny Image Star layer JSON; CSS border-radius cannot represent the same curve. */`);
  } else {
    const background = cssColorWithVariable(document, node, 'fill', node.fillOpacity ?? 1);
    const gradientBackground = gradientFillToCSS(node.fillGradient, node.fillOpacity ?? 1, {
      width: geometry.width,
      height: geometry.height
    });
    if (node.imageFill && node.type !== 'line' && (node.type !== 'path' || hasFillablePathContour(node))) declarations.push('/* Local image fill source and adjustments are retained in layer JSON. */');
    else if (gradientBackground && node.type !== 'line' && (node.type !== 'path' || hasFillablePathContour(node))) declarations.push(`background: ${gradientBackground};`);
    else if (background && node.type !== 'line' && (node.type !== 'path' || hasFillablePathContour(node))) declarations.push(`background-color: ${background};`);
    const strokeLayers = strokeStackForNode(node).map((stroke, index) => resolvedStroke(document, node, stroke, index));
    const primaryStroke = strokeLayers[0];
    if (node.type === 'line') {
      const stroke = primaryStroke?.visible ? cssColorWithVariable(document, node, 'stroke', primaryStroke.opacity) : null;
      if (stroke && primaryStroke.width > 0) declarations.push(`border-top: ${number(primaryStroke.width)}px ${primaryStroke.pattern === 'custom' ? 'dashed' : primaryStroke.pattern} ${stroke};`);
      declarations.push('/* Exact line geometry is retained in layer JSON. */');
    } else if (primaryStroke?.visible && Math.max(...Object.values(primaryStroke.sideWidths || { top: primaryStroke.width })) > 0) {
      const stroke = cssColorWithVariable(document, node, 'stroke', primaryStroke.opacity);
      if (stroke) {
        const maxWidth = Math.max(...Object.values(primaryStroke.sideWidths || { top: primaryStroke.width }));
        declarations.push(`border: ${number(maxWidth)}px ${primaryStroke.pattern === 'custom' ? 'dashed' : primaryStroke.pattern} ${stroke};`);
        const widths = primaryStroke.sideWidths;
        if (widths && !Object.values(widths).every(value => value === widths.top)) {
          declarations.push(`border-width: ${number(widths.top)}px ${number(widths.right)}px ${number(widths.bottom)}px ${number(widths.left)}px;`);
        }
      }
    }
    if (primaryStroke?.pattern === 'custom') declarations.push(`/* Custom stroke dash lengths ${primaryStroke.dashArray.join(' ')}px are preserved in layer JSON; CSS borders cannot reproduce custom dash arrays. */`);
    if (primaryStroke?.gradient) declarations.push('/* Linear/radial stroke gradient is preserved in layer JSON; this CSS border uses its first-stop color. */');
    if (primaryStroke?.visible && primaryStroke.width > 0
      && (primaryStroke.cap !== 'butt' || primaryStroke.join !== 'miter' || primaryStroke.miterLimit !== 10)) {
      declarations.push(`/* Vector stroke cap/join/miter limit (${primaryStroke.cap}/${primaryStroke.join}/${primaryStroke.miterLimit}) remain exact in layer JSON. */`);
    }
    if (Array.isArray(node.strokes) && strokeLayers.length > 1) declarations.push(`/* ${strokeLayers.length} ordered strokes are preserved in layer JSON; CSS border reflects only the first. */`);
    const radius = borderRadiusCss(document, node);
    if (radius) declarations.push(`border-radius: ${radius};`);
    if ((node.type === 'polygon' || node.type === 'star') && Number(getNodePropertyValue(document, node, 'radius')) > 0) {
      declarations.push(`/* Rounded vertices (${number(getNodePropertyValue(document, node, 'radius'))}px) are retained in Tiny Image Star layer JSON. */`);
    }
    if (node.cornerSmoothing > 0) declarations.push(`/* Corner smoothing ${number(node.cornerSmoothing * 100)}% is retained in Tiny Image Star layer JSON; CSS border-radius cannot represent the same curve. */`);
  }

  if (node.type === 'frame' && node.clip) declarations.push('overflow: hidden;');
  if (getNodePropertyValue(document, node, 'visible') === false) declarations.push('display: none;');
  declarations.push(...autoLayoutDeclarations(node.autoLayout, node.children || []));
  if (node.type === 'path' || node.type === 'network' || node.type === 'boolean' || node.mask) declarations.push('/* Vector, Boolean, and mask geometry is retained in layer JSON. */');
  return `${selector} {\n${declarations.map(declaration => `  ${declaration}`).join('\n')}\n}${additionalRules.length ? `\n${additionalRules.join('\n')}` : ''}`;
}

function markupForNode(document, node) {
  const className = cssClass(node);
  const type = escapeMarkup(node.type || 'layer');
  const effectWarning = codegenEffectWarning(node);
  const warning = effectWarning ? `<!-- ${effectWarning} -->\n` : '';
  if (node.type === 'text') {
    const value = getNodePropertyValue(document, node, 'text') ?? '';
    const styles = normalizedParagraphStyles(value, node.paragraphStyles);
    const markers = paragraphMarkerLabels(styles);
    const paragraphs = String(value).replace(/\r\n?/g, '\n').split('\n')
      .map((paragraph, index) => {
        const style = styles[index];
        const attributes = `${style.listStyle === 'none' ? ''
          : ` data-list-style="${style.listStyle}" data-list-level="${style.listLevel}" data-list-marker="${escapeMarkup(markers[index])}"`}${style.textWrapStyle ? ` data-text-wrap-style="${style.textWrapStyle}"` : ''}`;
        return `<span class="${className}__paragraph"${attributes}>${escapeMarkup(paragraph)}</span>`;
      }).join('');
    return `${warning}<span class="${className}" data-layer-type="text">${paragraphs}</span>`;
  }
  if (node.type === 'image') {
    const label = escapeMarkup(node.fileName || node.name || 'Local image');
    return `${warning}<div class="${className}" data-layer-type="image" role="img" aria-label="${label}"><!-- Set the source to the local image asset in your app. --></div>`;
  }
  const children = (node.children || []).map(child => markupForNode(document, child)).join('\n');
  const content = children ? `\n${children}\n` : '';
  return `${warning}<div class="${className}" data-layer-type="${type}">${content}</div>`;
}

function jsxString(value) {
  return JSON.stringify(String(value ?? '')).replace(/[\u2028\u2029]/g, character => character === '\u2028' ? '\\u2028' : '\\u2029');
}

function jsxForNode(document, node, depth = 0) {
  const indent = '  '.repeat(depth);
  const className = jsxString(cssClass(node));
  const type = jsxString(node.type || 'layer');
  const effectWarning = codegenEffectWarning(node);
  const warning = effectWarning ? `${indent}{/* ${effectWarning} */}\n` : '';
  if (node.type === 'text') {
    const value = String(getNodePropertyValue(document, node, 'text') ?? '');
    const styles = normalizedParagraphStyles(value, node.paragraphStyles);
    const markers = paragraphMarkerLabels(styles);
    const paragraphs = value.replace(/\r\n?/g, '\n').split('\n')
      .map((paragraph, index) => {
        const style = styles[index];
        const attributes = `${style.listStyle === 'none' ? ''
          : ` data-list-style={${jsxString(style.listStyle)}} data-list-level={${style.listLevel}} data-list-marker={${jsxString(markers[index])}}`}${style.textWrapStyle ? ` data-text-wrap-style={${jsxString(style.textWrapStyle)}}` : ''}`;
        return `${indent}  <span className={${jsxString(`${cssClass(node)}__paragraph`)}}${attributes}>{${jsxString(paragraph)}}</span>`;
      }).join('\n');
    return `${warning}${indent}<span className={${className}} data-layer-type={${jsxString('text')}}>\n${paragraphs}\n${indent}</span>`;
  }
  if (node.type === 'image') {
    const label = jsxString(node.fileName || node.name || 'Local image');
    return `${warning}${indent}<div className={${className}} data-layer-type={${type}} role={${jsxString('img')}} aria-label={${label}}>{/* Set the source to the local image asset in your app. */}</div>`;
  }
  const children = (node.children || []).map(child => jsxForNode(document, child, depth + 1));
  if (!children.length) return `${warning}${indent}<div className={${className}} data-layer-type={${type}} />`;
  return `${warning}${indent}<div className={${className}} data-layer-type={${type}}>\n${children.join('\n')}\n${indent}</div>`;
}

function normalizedParagraphStyles(text, paragraphStyles) {
  const paragraphCount = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').length;
  return Array.from({ length: paragraphCount }, (_, index) => {
    const source = Array.isArray(paragraphStyles) ? paragraphStyles[index] : null;
    const listStyle = ['bulleted', 'numbered'].includes(source?.listStyle) ? source.listStyle : 'none';
    const listLevel = listStyle !== 'none' && Number.isInteger(source?.listLevel) && source.listLevel >= 0 && source.listLevel <= 4
      ? source.listLevel : 0;
    const style = { listStyle, listLevel };
    if (['balance', 'pretty'].includes(source?.textWrapStyle)) style.textWrapStyle = source.textWrapStyle;
    if (listStyle === 'numbered' && Number.isInteger(source?.listStart) && source.listStart >= 1 && source.listStart <= 999_999) {
      style.listStart = source.listStart;
    }
    return style;
  });
}

function paragraphMarkerLabels(paragraphStyles) {
  const counters = new Map();
  const activeStyles = new Map();
  const alpha = value => {
    let numberValue = value;
    let label = '';
    while (numberValue > 0 && label.length < 12) {
      numberValue -= 1;
      label = String.fromCharCode(97 + numberValue % 26) + label;
      numberValue = Math.floor(numberValue / 26);
    }
    return label || 'a';
  };
  const roman = value => {
    if (value > 3999) return String(value);
    let numberValue = value;
    let label = '';
    for (const [amount, symbol] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) {
      while (numberValue >= amount) { label += symbol; numberValue -= amount; }
    }
    return label;
  };
  return paragraphStyles.map(style => {
    if (style.listStyle === 'none') {
      counters.clear(); activeStyles.clear();
      return '';
    }
    const level = style.listLevel;
    for (const current of [...activeStyles.keys()]) if (current > level) activeStyles.delete(current);
    for (const current of [...counters.keys()]) if (current > level) counters.delete(current);
    if (activeStyles.get(level) !== style.listStyle) counters.delete(level);
    activeStyles.set(level, style.listStyle);
    if (style.listStyle === 'bulleted') return '•';
    const count = style.listStart ?? (counters.get(level) || 0) + 1;
    counters.set(level, count);
    const format = level % 3;
    const label = format === 1 ? alpha(count) : format === 2 ? roman(count) : String(count);
    return `${label}.`;
  });
}

function reactComponent(css, roots, document) {
  const intro = "import React from 'react';\n\n";
  if (!roots.length) return `${intro}export default function TinyImageStarHandoff() {\n  return null;\n}\n`;
  const children = roots.map(entry => jsxForNode(document, entry.node, roots.length > 1 ? 4 : 3));
  const content = children.length === 1 ? children[0] : `      <>\n${children.join('\n')}\n      </>`;
  return `${intro}const styles = ${jsxString(css)};\n\nexport default function TinyImageStarHandoff() {\n  return (\n    <>\n      <style>{styles}</style>\n${content}\n    </>\n  );\n}\n`;
}

function vueString(value) {
  return JSON.stringify(String(value ?? '')).replace(/[\u2028\u2029]/g, character => character === '\u2028' ? '\\u2028' : '\\u2029');
}

function vueForNode(document, node, depth = 0) {
  const indent = '  '.repeat(depth);
  const className = escapeMarkup(cssClass(node));
  const type = escapeMarkup(node.type || 'layer');
  const effectWarning = codegenEffectWarning(node);
  const warning = effectWarning ? `${indent}<!-- ${effectWarning} -->\n` : '';
  if (node.type === 'text') {
    const value = String(getNodePropertyValue(document, node, 'text') ?? '');
    const styles = normalizedParagraphStyles(value, node.paragraphStyles);
    const markers = paragraphMarkerLabels(styles);
    const paragraphs = value.replace(/\r\n?/g, '\n').split('\n')
      .map((paragraph, index) => {
        const style = styles[index];
        const attributes = `${style.listStyle === 'none' ? ''
          : ` data-list-style="${style.listStyle}" data-list-level="${style.listLevel}" data-list-marker="${escapeMarkup(markers[index])}"`}${style.textWrapStyle ? ` data-text-wrap-style="${style.textWrapStyle}"` : ''}`;
        // v-text keeps authored text literal even when it contains Vue
        // interpolation delimiters, markup, or directive-looking content.
        return `${indent}  <span class="${escapeMarkup(`${cssClass(node)}__paragraph`)}"${attributes} v-text="${escapeMarkup(vueString(paragraph))}"></span>`;
      }).join('\n');
    return `${warning}${indent}<span class="${className}" data-layer-type="text">\n${paragraphs}\n${indent}</span>`;
  }
  if (node.type === 'image') {
    const label = escapeMarkup(node.fileName || node.name || 'Local image');
    return `${warning}${indent}<div class="${className}" data-layer-type="image" role="img" aria-label="${label}"><!-- Replace with an app asset or bind an image source. --></div>`;
  }
  const children = (node.children || []).map(child => vueForNode(document, child, depth + 1));
  if (!children.length) return `${warning}${indent}<div class="${className}" data-layer-type="${type}" />`;
  return `${warning}${indent}<div class="${className}" data-layer-type="${type}">\n${children.join('\n')}\n${indent}</div>`;
}

function vueSingleFileComponent(css, roots, document) {
  const template = roots.length
    ? roots.map(entry => vueForNode(document, entry.node, roots.length > 1 ? 1 : 0)).join('\n')
    : '<!-- Select a layer to generate a Vue template. -->';
  // Vue SFC style blocks are HTML raw-text elements. Escape '<' as a CSS
  // hexadecimal escape so a user-provided font family cannot close the block.
  const safeCss = css.replace(/</g, '\\3c ');
  return `<template>\n${template}\n</template>\n\n<style>\n${safeCss}\n</style>\n`;
}

function treeEntries(root) {
  const entries = [];
  const visit = (node, parents, codegenParents) => {
    entries.push({ node, parents, codegenParents });
    for (const child of node.children || []) visit(child, [...parents, node], [...codegenParents, node]);
  };
  visit(root.node, root.parents || [], []);
  return entries;
}

function summaryForEntry(document, entry) {
  const node = entry.node;
  const geometry = getNodeGeometry(document, node);
  // Match the copyable CSS root position. Summing local x/y values alone
  // loses the translation introduced by rotated parents.
  const position = generatedRootPosition(document, entry);
  const fill = getNodeColor(document, node, node.type === 'text' ? 'text' : 'fill');
  const summary = {
    id: node.id,
    name: node.name,
    type: node.type,
    parent: entry.parents?.at(-1)?.name || 'Page',
    position,
    size: { width: geometry.width, height: geometry.height },
    rotation: generatedRootRotation(document, entry),
    opacity: getNodePropertyValue(document, node, 'opacity') ?? 1
  };
  if (fill) summary.color = fill;
  if (node.fillGradient) summary.fillGradient = node.fillGradient;
  if (node.imageFill) summary.imageFill = node.imageFill;
  const radius = borderRadiusCss(document, node);
  if (radius) summary.borderRadius = radius;
  if (node.type === 'polygon' || node.type === 'star') {
    if (Array.isArray(node.vertexRadii)) summary.vertexRadii = node.vertexRadii.map(value => `${number(value)}px`);
    else {
      const vertexRadius = Number(getNodePropertyValue(document, node, 'radius')) || 0;
      if (vertexRadius) summary.cornerRadius = `${number(vertexRadius)}px`;
    }
  }
  if (node.type === 'network' && Array.isArray(node.vertices)) {
    const vertexCornerRadii = node.vertices
      .map((vertex, index) => ({ id: vertex.id, index, radius: Number(vertex.cornerRadius) || 0 }))
      .filter(vertex => vertex.radius > 0)
      .map(vertex => ({ id: vertex.id, index: vertex.index, radius: `${number(vertex.radius)}px` }));
    if (vertexCornerRadii.length) summary.vertexCornerRadii = vertexCornerRadii;
  }
  if (node.cornerSmoothing > 0) summary.cornerSmoothing = node.cornerSmoothing;
  if (node.blendMode && node.blendMode !== 'normal') summary.blendMode = node.blendMode;
  const strokes = strokeStackForNode(node).map((stroke, index) => resolvedStroke(document, node, stroke, index));
  if (strokes.length) {
    summary.stroke = strokes[0];
    if (Array.isArray(node.strokes)) summary.strokes = strokes;
  }
  if (node.type === 'text') {
    summary.text = getNodePropertyValue(document, node, 'text');
    summary.typography = {
      fontFamily: node.fontFamily,
      fontSize: getNodePropertyValue(document, node, 'fontSize'),
      fontWeight: node.fontWeight,
      fontStyle: node.fontStyle || 'normal',
      ...(node.fontAxes ? { fontAxes: structuredClone(node.fontAxes) } : {}),
      ...(node.fontFeatures ? { fontFeatures: structuredClone(node.fontFeatures) } : {}),
      lineHeight: getNodePropertyValue(document, node, 'lineHeight'),
      letterSpacing: getNodePropertyValue(document, node, 'letterSpacing'),
      paragraphSpacing: Number(node.paragraphSpacing) || 0,
      firstLineIndent: Number(node.firstLineIndent) || 0,
      listSpacing: Number(node.listSpacing) || 0,
      paragraphStyles: Array.isArray(node.paragraphStyles) ? node.paragraphStyles : [],
      align: node.align,
      verticalAlign: ['top', 'middle', 'bottom'].includes(node.verticalAlign) ? node.verticalAlign : 'top',
      textCase: ['none', 'uppercase', 'lowercase', 'capitalize'].includes(node.textCase) ? node.textCase : 'none',
      textDecoration: ['none', 'underline', 'line-through'].includes(node.textDecoration) ? node.textDecoration : 'none',
      textWrapStyle: ['auto', 'balance', 'pretty'].includes(node.textWrapStyle) ? node.textWrapStyle : 'auto',
      ...(node.textTruncation === 'ending' ? { textTruncation: node.textTruncation } : {}),
      ...(Number.isSafeInteger(node.maxLines) && node.maxLines > 0 ? { maxLines: node.maxLines } : {})
    };
  }
  if (node.type === 'image') summary.image = { fileName: node.fileName, fit: node.fit, sourceWidth: node.sourceWidth, sourceHeight: node.sourceHeight };
  if (node.autoLayout) summary.autoLayout = node.autoLayout;
  const parent = entry.parents?.at(-1);
  if (parent?.autoLayout) {
    summary.layout = {
      axis: parent.autoLayout.axis,
      positioning: node.layoutPositioning === 'absolute' ? 'absolute' : 'flow',
      sizing: parent.autoLayout.axis === 'grid'
        ? { width: node.layoutSizingX || 'fixed', height: node.layoutSizingY || 'fixed' }
        : {
            main: node.layoutSizingMain || 'fixed',
            cross: node.layoutSizingCross || 'fixed',
            ...(node.layoutAlignSelf ? { alignSelf: node.layoutAlignSelf } : {})
          },
      ...(parent.autoLayout.axis === 'grid' ? { gridCell: structuredClone(node.gridCell || {}) } : {})
    };
  } else if (parent?.type === 'frame') {
    summary.constraints = {
      horizontal: node.constraints?.horizontal || 'left',
      vertical: node.constraints?.vertical || 'top'
    };
  }
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
  const css = [cssVariableDefinitions(document, includedEntries), includedEntries.map(entry => cssForEntry(document, entry)).join('\n\n')]
    .filter(Boolean).join('\n\n');
  return {
    layers: selected.map(entry => summaryForEntry(document, entry)),
    css,
    html: roots.map(entry => markupForNode(document, entry.node)).join('\n'),
    json: JSON.stringify(selected.length === 1 ? selected[0].node : selected.map(entry => entry.node), null, 2),
    jsx: reactComponent(css, roots, document),
    vue: vueSingleFileComponent(css, roots, document)
  };
}
