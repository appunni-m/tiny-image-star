const fillScopes = new Set(['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL']);

export const variableScopeGroups = Object.freeze({
  color: Object.freeze([
    Object.freeze({ label: 'Any color property', scopes: Object.freeze([['ALL_SCOPES', 'All properties']]) }),
    Object.freeze({ label: 'Fills', scopes: Object.freeze([['ALL_FILLS', 'All fill fields'], ['FRAME_FILL', 'Frame fill'], ['SHAPE_FILL', 'Shape fill'], ['TEXT_FILL', 'Text fill']]) }),
    Object.freeze({ label: 'Other color properties', scopes: Object.freeze([['STROKE_COLOR', 'Stroke'], ['EFFECT_COLOR', 'Effects']]) })
  ]),
  number: Object.freeze([
    Object.freeze({ label: 'Any number property', scopes: Object.freeze([['ALL_SCOPES', 'All properties']]) }),
    Object.freeze({ label: 'Layout and geometry', scopes: Object.freeze([['GAP', 'Auto layout gap and padding'], ['CORNER_RADIUS', 'Corner radius'], ['WIDTH_HEIGHT', 'Width and height']]) }),
    Object.freeze({ label: 'Appearance', scopes: Object.freeze([['OPACITY', 'Layer opacity'], ['COLOR_OPACITY', 'Color opacity'], ['STROKE_FLOAT', 'Stroke'], ['EFFECT_FLOAT', 'Effects']]) }),
    Object.freeze({ label: 'Typography', scopes: Object.freeze([['FONT_WEIGHT', 'Font weight'], ['FONT_SIZE', 'Font size'], ['LINE_HEIGHT', 'Line height'], ['LETTER_SPACING', 'Letter spacing'], ['PARAGRAPH_SPACING', 'Paragraph spacing'], ['PARAGRAPH_INDENT', 'Paragraph indent']]) }),
    Object.freeze({ label: 'Content', scopes: Object.freeze([['TEXT_CONTENT', 'Text content']]) })
  ]),
  string: Object.freeze([
    Object.freeze({ label: 'Any text property', scopes: Object.freeze([['ALL_SCOPES', 'All properties']]) }),
    Object.freeze({ label: 'Typography', scopes: Object.freeze([['FONT_FAMILY', 'Font family'], ['FONT_STYLE', 'Font style']]) }),
    Object.freeze({ label: 'Content', scopes: Object.freeze([['TEXT_CONTENT', 'Text content']]) })
  ])
});

const variableScopesByType = Object.freeze(Object.fromEntries(
  Object.entries(variableScopeGroups).map(([type, groups]) => [type, new Set(groups.flatMap(group => group.scopes.map(([scope]) => scope)))])
));

/** Missing scopes in older local files retain the original all-properties behavior. */
export function variableScopesFor(variable) {
  if (!variable || variable.type === 'boolean') return [];
  if (!Object.hasOwn(variable, 'scopes')) return ['ALL_SCOPES'];
  return normalizeVariableScopes(variable.type, variable.scopes);
}

/** Return a canonical scope array, or null when a type/special-scope combination is invalid. */
export function normalizeVariableScopes(type, scopes) {
  if (type === 'boolean' || !Array.isArray(scopes) || !variableScopesByType[type]) return null;
  if (scopes.some(scope => typeof scope !== 'string' || !variableScopesByType[type].has(scope))) return null;
  const unique = new Set(scopes);
  if (unique.has('ALL_SCOPES') && unique.size !== 1) return null;
  if (type === 'color' && unique.has('ALL_FILLS') && [...fillScopes].some(scope => unique.has(scope))) return null;
  const order = [...variableScopesByType[type]];
  return order.filter(scope => unique.has(scope));
}

export function isValidVariableScopes(type, scopes) {
  return normalizeVariableScopes(type, scopes) !== null;
}

/** Scopes control picker visibility only; they are not binding authorization. */
export function variableScopeAllows(variable, propertyScope = null) {
  if (!variable) return false;
  if (variable.type === 'boolean') return true;
  const scopes = variableScopesFor(variable);
  if (!scopes) return false;
  if (scopes.includes('ALL_SCOPES')) return true;
  if (!propertyScope) return false;
  if (scopes.includes('ALL_FILLS') && fillScopes.has(propertyScope)) return true;
  return scopes.includes(propertyScope);
}

export function colorVariableScope(kind, node) {
  if (kind === 'text') return 'TEXT_FILL';
  if (kind === 'stroke') return 'STROKE_COLOR';
  return node?.type === 'frame' ? 'FRAME_FILL' : 'SHAPE_FILL';
}

export function variablePropertyScope(property) {
  if (['width', 'height'].includes(property)) return 'WIDTH_HEIGHT';
  if (property === 'opacity') return 'OPACITY';
  if (property === 'radius') return 'CORNER_RADIUS';
  if (property === 'text') return 'TEXT_CONTENT';
  if (property === 'fontFamily') return 'FONT_FAMILY';
  if (property === 'fontWeight') return 'FONT_WEIGHT';
  if (property === 'fontStyle') return 'FONT_STYLE';
  if (property === 'fontSize') return 'FONT_SIZE';
  if (property === 'lineHeight') return 'LINE_HEIGHT';
  if (property === 'letterSpacing') return 'LETTER_SPACING';
  if (property === 'paragraphSpacing') return 'PARAGRAPH_SPACING';
  if (property === 'firstLineIndent') return 'PARAGRAPH_INDENT';
  if (property === 'autoLayout.columnGap' || property === 'autoLayout.rowGap' || property.startsWith('autoLayout.padding.')) return 'GAP';
  // Figma has no scope for position, rotation, visibility, or this editor's
  // extended layout settings. Only All properties variables appear there.
  return null;
}
