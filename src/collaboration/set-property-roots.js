import { TEXT_DECORATION_PROPERTIES } from '../text-decoration-style.js';

// Keep guest planning and host validation on the same explicit edit surface.
// Document validation remains authoritative for each node type and value; this
// list only prevents operations from rewriting identity and hierarchy fields.
const roots = new Set([
  'name', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'locked',
  'blendMode', 'fill', 'fills', 'fillOpacity', 'fillStyleId', 'stroke', 'strokeWidth',
  'strokeOpacity', 'strokeCap', 'strokeJoin', 'strokePattern', 'strokeDashArray', 'strokeMiterLimit', 'strokeAlignment',
  'strokes', 'radius', 'cornerRadii', 'cornerSmoothing', 'clip', 'mask', 'maskMode', 'maskSourceId', 'effects',
  'effectStyleId', 'color', 'constraints', 'autoLayout', 'layoutPositioning', 'layoutSizingMain',
  'layoutSizingCross', 'layoutAlignSelf', 'layoutSizingX', 'layoutSizingY', 'minWidth', 'maxWidth',
  'minHeight', 'maxHeight', 'gridCell', 'fillGradient', 'imageFill', 'fillVariableId',
  'textVariableId', 'strokeVariableId', 'variableModes', 'variableBindings', 'points',
  'subpaths', 'fillRule', 'innerRadius', 'arcData', 'lineReverseY', 'closed', 'vertices', 'vertexRadii', 'edges',
  'faces', 'operation', 'exportSettings', 'outputFormat', 'outputQuality', 'layoutGuides',
  'interactions', 'fixedPositionWhenScrolling', 'scrollPosition', 'overflowBehavior', 'text',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontAxes', 'fontFeatures', 'lineHeight', 'lineHeightUnit',
  'letterSpacing', 'paragraphSpacing', 'firstLineIndent', 'listSpacing', 'paragraphStyles',
  'textRuns', 'textStyleId', 'typographyStyleId', 'align', 'verticalAlign', 'textFit',
  'textTruncation', 'maxLines', 'textCase', 'textDecoration', 'textWrapStyle', ...TEXT_DECORATION_PROPERTIES, 'fit', 'scalingFactor',
  'adjustments', 'transforms', 'fileName', 'sourceWidth', 'sourceHeight'
]);

export function isCollaborationSetPropertyRoot(property) {
  return typeof property === 'string' && roots.has(property);
}
