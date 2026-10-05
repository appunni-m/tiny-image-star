import { findNode, getBooleanStrokePath, getBooleanVectorPath, getBooleanVectorGeometryKey, prepareBooleanVectorPath, resolveBooleanSourceNode, getNodeColor, getNodeGeometry, getNodePropertyValue, getNodeTextPath } from './model.js';
import { registerBooleanVectorGeometryProvider } from './boolean-vector-geometry.js';
import { getBooleanTextGeometryOptions, registerBooleanTextGeometryProvider } from './boolean-text-geometry.js';
import { projectBooleanVectorPaintTree } from './boolean-vector-export-preflight.js';
import { layoutGuideGridLines, layoutGuideRegions } from './layout-guides.js';
import { vectorNetworkEdgeForPair, vectorNetworkEdgePairIndex, vectorNetworkEdgePoints, vectorNetworkVertexPoint, vectorNodePoint, vectorPathContours } from './vector-path.js';
import { vectorNetworkFacePathCommands } from './vector-network-corners.js';
import { layoutPlainText, layoutTextRuns, measureTrackedText, requiresComplexTextShaping, resolvedLineHeight, textGraphemes, transformTextCase } from './text-layout.js';
import { buildLayerEffectFilter, layerEffectPadding, supportsShadowSpread } from './layer-effects.js';
import { progressiveBlurStepCount, progressiveBlurWeights } from './progressive-blur.js';
import { morphShadowAlpha } from './shadow-spread.js';
import { createNoisePixelGrid, noiseSeedForLayer } from './noise-effect.js';
import { createTextureEdgeAlphas, MAX_TEXTURE_MASK_PIXELS, textureSeedForLayer } from './texture-effect.js';
import { firstBackdropEffect, glassEffectOverscan, glassVisibleForNode, MAX_GLASS_AXIS, MAX_GLASS_PIXELS, refractGlassBackdrop } from './glass-effect.js';
import { createGradientPaint, fillStackForNode, gradientTypes, resolveGradientGeometry } from './fills.js';
import { canvasBlendOperation } from './layer-blend.js';
import { applyStrokeStyle } from './stroke-style.js';
import { applyLuminanceMaskAlpha, initializeLuminanceMaskWasm, isLuminanceMaskWasmReady } from './luminance-mask.js';
import { isUniformStrokeSideWidths, strokeSideNames, strokeSideWidths, strokeStackForNode } from './strokes.js';
import { rectangleStrokeSideJoins, rectangleStrokeSidePaths } from './stroke-side-geometry.js';
import { strokeEndpointDecorations } from './stroke-decorations.js';
import { effectiveStrokeAlignment, strokeGeometryBounds, strokePaintPadding } from './stroke-alignment.js';
import { hasVisibleRenderedPaint, paintHasVisibleAlpha, renderNodeInkBounds, transformInkBounds, RENDER_INK_BOUNDS_LIMITS } from './render-ink-bounds.js';
import { collectTextOutlineGeometry } from './text-outline-geometry.js';
import { canvasTextInkBounds, decorationStyleForRun, nativeInkContoursForShapedText, parseLocalGlyphContours, textDecorationGeometry, traceTextDecorationContours } from './text-decoration.js';
import { canvasTextLineMetrics } from './text-line-metrics.js';
import { resolvedTextLetterSpacing } from './text-letter-spacing.js';
import { getTransformHandles, multiplyAffine, nodeLocalToPage, nodeLocalToPageTransform, nodeToParentTransform, pageToNodeLocal, transformPoint } from './transform-geometry.js';
import { isScrollableFrame, isStickyScrollFrame, presentationChildrenInPaintOrder, scrollOffsetForPresentationChild } from './prototype-scroll-position.js';
import { selectionBounds } from './group-transform.js';
import { planScaleTransform } from './scale-transform.js';
import { drawAlignmentGuides } from './smart-guides.js';
import { canShowPreviousImagePreview, imagePreviewKey, imagePreviewMatchesSettings, imagePreviewRequiresRenderedPixels, imagePreviewSettingsForNode } from './image-preview-runtime.js';
import { collectVisibleImagePreviewKeys } from './visible-image-previews.js';
import { gridTrackResizeHandles } from './grid-track-editing.js';
import { imageCropPixels, normalizeImageTransforms } from './image-transforms.js';
import { DEFAULT_IMAGE_TILE_SCALE, imageTilePatternTransform, imageTileSourceDimensions } from './image-tile.js';
import { canvasFontWeight } from './font-variation.js';
import { clampCornerRadii, containsPointInRoundedRect, cornerRadiusKeys, traceRoundedRectPath } from './corner-radii.js';
import { regularShapeVertices, traceRoundedPolygonPath } from './polygon-corners.js';
import { traceEllipseArc } from './ellipse-arc.js';
import { starControlHandles } from './star-controls.js';
import { ellipseArcControlHandles } from './ellipse-arc-controls.js';
import { booleanSourceTransform } from './boolean-geometry.js';
import { hitTestBooleanStrokeGeometry, hitTestVisibleGeometry } from './shape-hit-testing.js';
import { canvasPixelFromClientPoint, resizeCanvasSurface, sampleColorAt } from './eyedropper.js';
import { variableStrokeOutlineFromSamples } from './variable-stroke-geometry.js';
import { drawTextAlongPath } from './text-on-path.js';
import { resolveTextPositionView } from './text-position.js';
import { canvasLeadingTrimMetrics } from './text-leading-trim.js';
export { measureTrackedText, wrapText } from './text-layout.js';

const MAX_BOOLEAN_SURFACE_PIXELS = 4_000_000;
const MAX_BOOLEAN_SURFACE_AXIS = 4096;
const EFFECT_PAINT_STAGEABLE_TYPES = new Set(['rectangle', 'ellipse', 'image', 'line', 'polygon', 'star', 'path', 'network', 'text', 'boolean']);
const MAX_BACKGROUND_BLUR_PIXELS = 4_000_000;
const MAX_BACKGROUND_BLUR_AXIS = 4096;

function progressiveBlurRadius(effect, progress) {
  const start = Number.isFinite(effect?.startRadius) ? effect.startRadius : effect?.radius || 0;
  const end = Number.isFinite(effect?.radius) ? effect.radius : start;
  return start + (end - start) * progress;
}

function progressiveBlurGradient(context, points, tierIndex, tierCount) {
  if (typeof context?.createLinearGradient !== 'function' || !Array.isArray(points) || points.length !== 2) return null;
  const [start, end] = points;
  if (![start?.x, start?.y, end?.x, end?.y].every(Number.isFinite)
    || Math.hypot(end.x - start.x, end.y - start.y) < 0.001) return null;
  const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
  for (let index = 0; index < tierCount; index += 1) {
    const progress = index / (tierCount - 1);
    const weight = progressiveBlurWeights(progress, tierCount)[tierIndex];
    gradient.addColorStop(progress, `rgba(255, 255, 255, ${weight})`);
  }
  return gradient;
}

function maskProgressiveBlurTier(context, gradient, width, height) {
  if (!gradient || typeof context?.fillRect !== 'function') return false;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.filter = 'none';
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.restore();
  return true;
}
const MAX_FONT_OUTLINE_PATH_ENTRIES = 4096;
const MAX_FONT_OUTLINE_PATH_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_FONT_OUTLINE_PATH_BYTES = 256 * 1024;
const fontOutlinePathCache = new Map();
let fontOutlinePathCacheBytes = 0;

function remotePresenceColor(actorId) {
  let hash = 2166136261;
  for (const char of String(actorId || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 78% 38%)`;
}

export function canvasLocalOffsetForScreenTranslation(transform, scaleX, scaleY, offsetX, offsetY) {
  if (!transform || ![transform.a, transform.b, transform.c, transform.d, scaleX, scaleY, offsetX, offsetY].every(Number.isFinite)) return null;
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) return null;
  const screenX = offsetX * scaleX;
  const screenY = offsetY * scaleY;
  return {
    x: (transform.d * screenX - transform.c * screenY) / determinant,
    y: (-transform.b * screenX + transform.a * screenY) / determinant
  };
}

function translateContextByScreenPixels(ctx, canvas, x, y, zoom) {
  if ((!x && !y) || typeof ctx.translate !== 'function') return;
  const transform = ctx.getTransform?.();
  const rect = canvas?.getBoundingClientRect?.();
  const scaleX = rect?.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect?.height > 0 ? canvas.height / rect.height : 1;
  const localOffset = canvasLocalOffsetForScreenTranslation(transform, scaleX, scaleY, x, y);
  if (localOffset) ctx.translate(localOffset.x, localOffset.y);
  else ctx.translate(x / Math.max(.08, zoom || 1), y / Math.max(.08, zoom || 1));
}

function cachedFontOutlinePath(data) {
  if (typeof globalThis.Path2D !== 'function' || !data || data.length * 2 > MAX_FONT_OUTLINE_PATH_BYTES) return null;
  let entry = fontOutlinePathCache.get(data);
  if (entry) {
    fontOutlinePathCache.delete(data);
    fontOutlinePathCache.set(data, entry);
    return entry.path;
  }
  let path;
  try { path = new globalThis.Path2D(data); }
  catch { return null; }
  const size = data.length * 2;
  entry = { path, size };
  while (fontOutlinePathCache.size >= MAX_FONT_OUTLINE_PATH_ENTRIES
    || fontOutlinePathCacheBytes + size > MAX_FONT_OUTLINE_PATH_CACHE_BYTES) {
    const oldest = fontOutlinePathCache.entries().next().value;
    if (!oldest) break;
    fontOutlinePathCache.delete(oldest[0]);
    fontOutlinePathCacheBytes -= oldest[1].size;
  }
  fontOutlinePathCache.set(data, entry);
  fontOutlinePathCacheBytes += size;
  return path;
}

function shapedTextWidth(shaped, fontSize, letterSpacing = 0, context = null, scaleX = 1) {
  if (Array.isArray(shaped?.mixedRuns)) {
    let width = 0;
    for (const [index, run] of shaped.mixedRuns.entries()) {
      const segmentWidth = run.shaped
        ? shapedTextWidth(run.shaped, fontSize, letterSpacing, context, scaleX)
        : context ? measureTrackedText(context, run.text, letterSpacing / scaleX) * scaleX : null;
      if (segmentWidth == null) return null;
      width += segmentWidth;
      if (index < shaped.mixedRuns.length - 1) width += Number(letterSpacing) || 0;
    }
    return width;
  }
  if (!shaped || shaped.missingGlyph || !Array.isArray(shaped.glyphs) || !(shaped.upem > 0)) return null;
  const scale = Math.max(.001, Number(fontSize) || 24) / shaped.upem;
  let advances = 0;
  let clusterBoundaries = 0;
  for (let index = 0; index < shaped.glyphs.length; index += 1) {
    const glyph = shaped.glyphs[index];
    advances += Number(glyph.xAdvance) || 0;
    if (index > 0 && glyph.cluster !== shaped.glyphs[index - 1].cluster) clusterBoundaries += 1;
  }
  return Math.max(0, advances * scale * scaleX + Math.max(0, clusterBoundaries) * (Number(letterSpacing) || 0));
}

function drawShapedText(ctx, shaped, text, x, topY, fontSize, letterSpacing = 0, paintMode = 'fill', clusterText = null, placement = {}) {
  const scaleX = placement.textPositionScaleX || 1;
  x += placement.textPositionOffsetX || 0;
  if (Array.isArray(shaped?.mixedRuns)) {
    let offset = 0;
    for (const [index, run] of shaped.mixedRuns.entries()) {
      const baseline = Number.isFinite(placement.textLineBaseline) ? placement.textLineBaseline : topY + (Number(run.shaped?.extents?.ascender) || 0) * fontSize / (run.shaped?.upem || 1);
      const localTop = Number.isFinite(placement.textLineBaseline) && run.shaped?.upem > 0 && Number.isFinite(run.shaped.extents?.ascender)
        ? baseline - run.shaped.extents.ascender * fontSize / run.shaped.upem : topY;
      const childPlacement = { ...placement, textPositionOffsetX: 0, textPositionScaleX: scaleX };
      const drewLocally = run.shaped && drawShapedText(ctx, run.shaped, run.text, x + offset, localTop, fontSize, letterSpacing, paintMode, null, childPlacement);
      if (!drewLocally) {
        const metrics = canvasTextLineMetrics(ctx, { ...placement, fontSize }, run.text);
        const fallbackTop = Number.isFinite(placement.textLineBaseline) && metrics ? baseline - metrics.topBaseline : topY;
        drawTrackedTextPaint(ctx, run.text, x + offset, fallbackTop, letterSpacing, undefined, paintMode, childPlacement);
      }
      const width = run.shaped && drewLocally
        ? shapedTextWidth(run.shaped, fontSize, letterSpacing, ctx, scaleX)
        : measureTrackedText(ctx, run.text, letterSpacing / scaleX) * scaleX;
      offset += width ?? 0;
      if (index < shaped.mixedRuns.length - 1) offset += Number(letterSpacing) || 0;
    }
    return true;
  }
  const collectGlyph = typeof ctx.drawLocalGlyphPath === 'function';
  const strokeTransform = collectGlyph ? ctx.captureTextStrokeTransform?.() : undefined;
  if ((!collectGlyph && typeof globalThis.Path2D !== 'function') || !shaped || !Array.isArray(shaped.glyphs)
    || shaped.missingGlyph || !shaped.extents || !(shaped.upem > 0)
    || typeof ctx[paintMode === 'stroke' ? 'stroke' : 'fill'] !== 'function') return false;
  const size = Math.max(.001, Number(fontSize) || 24);
  const scale = size / shaped.upem;
  const ascender = Number(shaped.extents.ascender);
  if (!Number.isFinite(ascender)) return false;
  const paths = collectGlyph ? null : shaped.glyphs.map(glyph => glyph.path ? cachedFontOutlinePath(glyph.path) : null);
  if (!collectGlyph && shaped.glyphs.some((glyph, index) => glyph.path && !paths[index])) return false;
  // Authored text strokes use pixel widths and dash lengths. Transform glyph
  // paths rather than the context, which otherwise scales those stroke styles
  // down by fontSize / unitsPerEm along with the font's coordinates.
  const pixelStroke = paintMode === 'stroke' && !collectGlyph;
  if (pixelStroke && typeof globalThis.Path2D.prototype?.addPath !== 'function') return false;
  if (!pixelStroke) {
    ctx.save();
    ctx.translate(x, topY + ascender * scale);
    ctx.scale(scale * scaleX, -scale);
  }
  const clusterStarts = collectGlyph ? [...new Set(shaped.glyphs.map(glyph => glyph.cluster))].sort((left, right) => left - right) : null;
  const clusterEnds = collectGlyph ? new Map(clusterStarts.map((start, index) => [start, clusterStarts[index + 1] ?? text.length])) : null;
  let penX = 0;
  let tracking = 0;
  let previousCluster = null;
  for (const [index, glyph] of shaped.glyphs.entries()) {
    if (previousCluster !== null && glyph.cluster !== previousCluster) tracking += Number(letterSpacing) / (scale * scaleX) || 0;
    const path = collectGlyph ? glyph.path : paths[index];
    if (path) {
      const offsetX = penX + (Number(glyph.xOffset) || 0) + tracking;
      const offsetY = Number(glyph.yOffset) || 0;
      if (pixelStroke) {
        const pixelPath = new globalThis.Path2D();
        pixelPath.addPath(path, { a: scale * scaleX, b: 0, c: 0, d: -scale,
          e: x + offsetX * scale * scaleX, f: topY + (ascender - offsetY) * scale });
        ctx.stroke(pixelPath);
      } else {
        ctx.save(); ctx.translate(offsetX, offsetY);
        if (collectGlyph) ctx.drawLocalGlyphPath(glyph.path, { paintMode, glyphId: glyph.id, cluster: glyph.cluster,
          text: clusterText ?? text.slice(glyph.cluster, clusterEnds.get(glyph.cluster)),
          ...(strokeTransform ? { strokeTransform } : {}) });
        else ctx.fill(path);
        ctx.restore();
      }
    }
    penX += Number(glyph.xAdvance) || 0;
    previousCluster = glyph.cluster;
  }
  if (!pixelStroke) ctx.restore();
  return true;
}

function drawShapeBuilderRegions(ctx, regions, zoom = 1) {
  if (!Array.isArray(regions) || !regions.length) return;
  ctx.save();
  ctx.fillStyle = 'rgba(13,153,255,.24)';
  ctx.strokeStyle = '#0879cb';
  ctx.lineWidth = 1.5 / Math.max(.08, zoom);
  ctx.setLineDash([4 / Math.max(.08, zoom), 2 / Math.max(.08, zoom)]);
  for (const contours of regions) {
    if (!Array.isArray(contours) || !contours.length) continue;
    ctx.beginPath();
    for (const contour of contours) {
      if (!Array.isArray(contour) || !contour.length) continue;
      ctx.moveTo(contour[0].p0.x, contour[0].p0.y);
      for (const curve of contour) ctx.bezierCurveTo(curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y, curve.p3.x, curve.p3.y);
      ctx.closePath();
    }
    ctx.fill('evenodd');
    ctx.stroke();
  }
  ctx.restore();
}

function booleanSurfaceDimensions(logicalWidth, logicalHeight, requestedScale) {
  const width = Number.isFinite(logicalWidth) && logicalWidth > 0 ? logicalWidth : 1;
  const height = Number.isFinite(logicalHeight) && logicalHeight > 0 ? logicalHeight : 1;
  const deviceScale = Math.min(2, Math.max(.08, Number.isFinite(requestedScale) ? requestedScale : 1));
  // Divide square roots separately so a finite but very large logical area
  // does not overflow to Infinity and collapse the preview scale to zero.
  const pixelScale = Math.sqrt(MAX_BOOLEAN_SURFACE_PIXELS) / Math.sqrt(width) / Math.sqrt(height);
  const axisScale = MAX_BOOLEAN_SURFACE_AXIS / Math.max(width, height);
  const scale = Math.min(deviceScale, pixelScale, axisScale);
  let pixelWidth = Math.max(1, Math.min(MAX_BOOLEAN_SURFACE_AXIS, Math.ceil(width * scale)));
  let pixelHeight = Math.max(1, Math.min(MAX_BOOLEAN_SURFACE_AXIS, Math.ceil(height * scale)));

  // Ceil preserves detail for ordinary surfaces, but can add a few pixels
  // beyond the area budget. Correct both axes proportionally in one step;
  // reducing one pixel at a time could require millions of iterations for
  // very large, equal-aspect inputs.
  const surfaceArea = pixelWidth * pixelHeight;
  if (surfaceArea > MAX_BOOLEAN_SURFACE_PIXELS) {
    const correction = Math.sqrt(MAX_BOOLEAN_SURFACE_PIXELS / surfaceArea);
    pixelWidth = Math.max(1, Math.floor(pixelWidth * correction));
    pixelHeight = Math.max(1, Math.floor(pixelHeight * correction));
  }
  // Guard against floating-point rounding at the budget boundary.
  while (pixelWidth * pixelHeight > MAX_BOOLEAN_SURFACE_PIXELS) {
    if (pixelWidth / width >= pixelHeight / height && pixelWidth > 1) pixelWidth -= 1;
    else if (pixelHeight > 1) pixelHeight -= 1;
    else break;
  }
  return { width: pixelWidth, height: pixelHeight };
}

function booleanNodeCacheState(document, node) {
  return {
    ...node,
    ...getNodeGeometry(document, node),
    opacity: getNodePropertyValue(document, node, 'opacity'),
    visible: getNodePropertyValue(document, node, 'visible'),
    radius: getNodePropertyValue(document, node, 'radius'),
    ...(node.type === 'text' ? {
      text: getNodePropertyValue(document, node, 'text'),
      fontFamily: getNodePropertyValue(document, node, 'fontFamily'),
      fontSize: getNodePropertyValue(document, node, 'fontSize'),
      fontWeight: getNodePropertyValue(document, node, 'fontWeight'),
      fontStyle: getNodePropertyValue(document, node, 'fontStyle'),
      lineHeight: getNodePropertyValue(document, node, 'lineHeight'),
      letterSpacing: getNodePropertyValue(document, node, 'letterSpacing'),
      paragraphSpacing: getNodePropertyValue(document, node, 'paragraphSpacing'),
      firstLineIndent: getNodePropertyValue(document, node, 'firstLineIndent')
    } : {}),
    children: (node.children || []).map(child => booleanNodeCacheState(document, child))
  };
}

function drawTextMask(ctx, node, document, x, y, width, height, shapeText = null, maskMode = true) {
  const vectorMask = maskMode === 'vector';
  const visibleGlyphFill = !vectorMask || fillStackForNode(node).some(fill => fill.visible);
  return drawTextLayerContent(ctx, node, document, x, y, width, height, {
    colorOverride: '#ffffff', fillOpacity: vectorMask ? 1 : node.fillOpacity ?? 1,
    overrideRunColors: true, shapeText, forceDecorationGeometry: vectorMask,
    ...(!visibleGlyphFill ? { decorationsOnly: true, decorationMode: 'independent' } : {})
  });
}

function drawPlainText(ctx, node, document, x, y, width, height, colorOverride = undefined, options = {}) {
  const sourceText = getNodePropertyValue(document, node, 'text');
  const textColor = colorOverride ?? getNodeColor(document, node, 'text');
  const fillOpacity = options.fillOpacity ?? node.fillOpacity ?? 1;
  const paintMode = options.paintMode || 'fill';
  const includeDecorations = options.includeDecorations !== false;
  if (paintMode !== 'stroke') ctx.fillStyle = rgba(textColor, fillOpacity);
  const text = transformTextCase(sourceText, node.textCase || 'none');
  const fontSize = getNodePropertyValue(document, node, 'fontSize');
  const fontFamily = getNodePropertyValue(document, node, 'fontFamily') || 'Arial, sans-serif';
  const fontWeight = getNodePropertyValue(document, node, 'fontWeight') || 400;
  const fontStyle = getNodePropertyValue(document, node, 'fontStyle') || 'normal';
  const lineHeightScale = getNodePropertyValue(document, node, 'lineHeight');
  const authoredLetterSpacing = getNodePropertyValue(document, node, 'letterSpacing');
  const letterSpacing = resolvedTextLetterSpacing({ ...node, letterSpacing: authoredLetterSpacing, fontSize: fontSize || 24 });
  const paragraphSpacing = getNodePropertyValue(document, node, 'paragraphSpacing');
  const firstLineIndent = getNodePropertyValue(document, node, 'firstLineIndent');
  ctx.font = `${fontStyle === 'italic' ? 'italic ' : ''}${canvasFontWeight(fontWeight, node.fontAxes)} ${fontSize || 24}px ${fontFamily}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const shapeStyle = {
    fontFamily,
    fontSize: fontSize || 24,
    fontWeight: Number(fontWeight) || 400,
    fontStyle,
    fontAxes: node.fontAxes,
    fontFeatures: node.fontFeatures, leadingTrim: node.leadingTrim, baselineShift: node.baselineShift,
    lineHeight: lineHeightScale || 1.25, lineHeightUnit: node.lineHeightUnit || 'ratio',
    letterSpacing: authoredLetterSpacing || 0, letterSpacingUnit: node.letterSpacingUnit
  };
  const shapedWidth = value => {
    const shaped = options.shapeText?.(value, shapeStyle);
    return shapedTextWidth(shaped, shapeStyle.fontSize, letterSpacing, ctx);
  };
  const measureText = value => shapedWidth(value) ?? measureTrackedText(ctx, value, letterSpacing);
  const lineHeight = resolvedLineHeight(lineHeightScale || 1.25, fontSize || 24, node.lineHeightUnit || 'ratio');
  const layout = layoutPlainText(text, Math.max(1, width), measureText, {
    lineHeight, paragraphSpacing, listSpacing: node.listSpacing,
    textWrapStyle: node.textWrapStyle || 'auto',
    paragraphStyles: node.paragraphStyles, markerStyle: {
      fontFamily, fontSize: fontSize || 24,
      fontWeight: canvasFontWeight(fontWeight, node.fontAxes), fontStyle,
      fontAxes: node.fontAxes, fontFeatures: node.fontFeatures, letterSpacing: authoredLetterSpacing || 0, letterSpacingUnit: node.letterSpacingUnit, color: textColor,
      leadingTrim: node.leadingTrim, baselineShift: node.leadingTrim?.type === 'CAP_HEIGHT' ? node.baselineShift : 0
    },
    firstLineIndent, align: node.align,
    textTruncation: node.textTruncation, maxLines: node.maxLines,
    maxHeight: node.maxHeight, boxHeight: height,
    leadingTrim: node.leadingTrim, leadingTrimStyle: shapeStyle, shapeText: options.shapeText,
    leadingTrimMetrics: options.leadingTrimMetrics || (style => canvasLeadingTrimMetrics(ctx, style)),
    strictLeadingTrim: options.strictLeadingTrim,
    textStyle: shapeStyle, textLineMetrics: options.textLineMetrics || (!ctx.isTextGeometryContext ? ((style, value) => canvasTextLineMetrics(ctx, style, value)) : undefined),
    strictTextLineMetrics: options.strictTextLineMetrics
  });
  const textY = y + textVerticalOffset(height, layout.height, node.verticalAlign || 'top');
  layout.lines.forEach(line => {
    const lineY = textY + line.y + (Number.isFinite(line.topOffset) ? line.topOffset : -(node.leadingTrim?.type === 'CAP_HEIGHT' ? Number(node.baselineShift || 0) : 0));
    const baselineY = Number.isFinite(line.baselineY) ? textY + line.baselineY + (line.baselineOffset || 0) : undefined;
    const placement = { ...shapeStyle, ...(Number.isFinite(baselineY) ? { textLineBaseline: baselineY } : {}) };
    if (line.marker && !options.decorationsOnly) drawParagraphMarker(ctx, line.marker, x, textY + line.y, {
      fontFamily, fontSize: fontSize || 24,
      fontWeight: canvasFontWeight(fontWeight, node.fontAxes), fontStyle,
      letterSpacing: authoredLetterSpacing || 0, letterSpacingUnit: node.letterSpacingUnit, color: textColor,
      baselineShift: node.leadingTrim?.type === 'CAP_HEIGHT' ? node.baselineShift : 0
    }, fillOpacity, paintMode, options.shapeText);
    const availableWidth = Math.max(1, width - line.indent);
    const lineAlign = line.align || node.align || 'left';
    const offsetX = line.indent + (lineAlign === 'center' ? (availableWidth - line.width) / 2 : lineAlign === 'right' ? availableWidth - line.width : 0);
    let shaped = null; const ink = { inkContours: [], fallbackInkBounds: [] };
    if (line.justify) drawJustifiedPlainText(ctx, line.displayText, x + offsetX, lineY, letterSpacing, line.justificationExtraSpace, paintMode,
      options.shapeText, placement, { ...ink, collectInk: node.textDecorationSkipInk, decorationsOnly: options.decorationsOnly });
    else {
      shaped = options.shapeText?.(line.displayText, shapeStyle);
      if (!options.decorationsOnly && !drawShapedText(ctx, shaped, line.displayText, x + offsetX, lineY, shapeStyle.fontSize, letterSpacing, paintMode, null, placement)) {
        drawTrackedTextPaint(ctx, line.displayText, x + offsetX, lineY, letterSpacing, availableWidth, paintMode);
      }
    }
    if (includeDecorations && paintMode !== 'stroke') drawTextDecoration(ctx, x + offsetX, baselineY ?? lineY, line.width, fontSize || 24, node.textDecoration || 'none', {
      style: decorationStyleForRun(node), shaped, text: line.displayText, letterSpacing,
      baseline: Number.isFinite(baselineY), inkTop: lineY, glyphBaselineY: baselineY,
      ...(line.justify ? ink : {}), mode: options.decorationMode,
      forceGeometryColor: options.forceDecorationGeometry
    });
  });
  return layout;
}

export function drawTextLayerContent(ctx, node, document, x, y, width, height, {
  colorOverride = undefined, fillOpacity = node.fillOpacity ?? 1,
  paintMode = 'fill', includeDecorations = true, overrideRunColors = false, shapeText = null,
  decorationMode = 'all', decorationsOnly = false, forceDecorationGeometry = false,
  leadingTrimMetrics, strictLeadingTrim = false, textLineMetrics, strictTextLineMetrics = Boolean(shapeText?.isPreparedTextExport)
} = {}) {
  const text = getNodePropertyValue(document, node, 'text');
  if (!node.__textPositionResolved) node = resolveTextPositionView({ ...node, text }, { shapeText }).node;
  const truncate = node.textTruncation === 'ending';
  if (truncate) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
  }
  try {
    if (node.textPath) {
      const color = colorOverride ?? getNodeColor(document, node, 'text');
      if (paintMode !== 'stroke') ctx.fillStyle = rgba(color, fillOpacity);
      const fontSize = getNodePropertyValue(document, node, 'fontSize') || 24;
      const fontFamily = getNodePropertyValue(document, node, 'fontFamily') || 'Arial, sans-serif';
      const fontWeight = getNodePropertyValue(document, node, 'fontWeight') || 400;
      const fontStyle = getNodePropertyValue(document, node, 'fontStyle') || 'normal';
      const letterSpacing = getNodePropertyValue(document, node, 'letterSpacing') || 0;
      return drawTextAlongPath(ctx, text, node, x, y,
        (value, style) => {
          ctx.font = richFont(style);
          return measureTrackedText(ctx, value, resolvedTextLetterSpacing(style) / (style.textPositionScaleX || 1)) * (style.textPositionScaleX || 1);
        }, {
          fillOpacity, paintMode, fontSize, letterSpacing, letterSpacingUnit: node.letterSpacingUnit,
          fontWeight: canvasFontWeight(fontWeight, node.fontAxes), fontStyle,
          fontFamily, color, fontFeatures: node.fontFeatures,
          overrideRunColors: overrideRunColors || colorOverride !== undefined,
          includeDecorations, shapeText, drawShaped: drawShapedText, decorationsOnly,
          decorate: ({ style, segment, baseline, shapedTop, parentAlpha }) => drawTextDecoration(ctx,
            -segment.advance / 2, baseline, segment.advance, style.fontSize, style.textDecoration, {
              style, text: segment.text, baseline: true, mode: decorationMode, parentAlpha,
              forceGeometryColor: forceDecorationGeometry,
              inkContours: style.textDecorationSkipInk ? nativeInkContoursForShapedText(segment.shaped,
                { x: (segment.shapedStartX ?? -segment.advance / 2) + (style.textPositionOffsetX || 0), y: shapedTop, fontSize: style.fontSize,
                  scaleX: style.textPositionScaleX || 1 }) : undefined,
              fallbackInkBounds: style.textDecorationSkipInk && !segment.shaped
                ? canvasTextInkBounds(ctx, segment.text, { x: -segment.advance / 2 + (style.textPositionOffsetX || 0), y: baseline,
                  scaleX: style.textPositionScaleX || 1 }) : undefined
            })
        });
    }
    const currentRuns = Array.isArray(node.textRuns) && node.textRuns.map(run => run.text).join('') === text;
    if (!currentRuns) {
      return drawPlainText(ctx, node, document, x, y, width, height, colorOverride, {
        fillOpacity, paintMode, includeDecorations, shapeText, decorationMode, decorationsOnly, forceDecorationGeometry, leadingTrimMetrics, strictLeadingTrim, textLineMetrics, strictTextLineMetrics
      });
    }

    const color = colorOverride ?? getNodeColor(document, node, 'text');
    const runs = overrideRunColors
      ? node.textRuns.map(run => ({ ...run, color }))
      : node.textRuns;
    return drawTextRuns(ctx, runs, x, y, width, {
      fontFamily: getNodePropertyValue(document, node, 'fontFamily') || 'Arial, sans-serif',
      fontSize: getNodePropertyValue(document, node, 'fontSize') || 24,
      fontWeight: getNodePropertyValue(document, node, 'fontWeight') || 400,
      fontStyle: getNodePropertyValue(document, node, 'fontStyle') || 'normal',
      fontAxes: node.fontAxes,
      fontFeatures: node.fontFeatures,
      lineHeight: getNodePropertyValue(document, node, 'lineHeight') || 1.25,
      lineHeightUnit: node.lineHeightUnit || 'ratio',
      letterSpacing: getNodePropertyValue(document, node, 'letterSpacing') || 0,
      letterSpacingUnit: node.letterSpacingUnit,
      color,
      textCase: node.textCase || 'none',
      textDecoration: node.textDecoration || 'none',
      ...decorationStyleForRun(node),
      textPosition: node.textPosition, baselineShift: node.baselineShift, leadingTrim: node.leadingTrim,
      paragraphSpacing: getNodePropertyValue(document, node, 'paragraphSpacing') || 0,
      listSpacing: node.listSpacing || 0,
      paragraphStyles: node.paragraphStyles || [],
      textWrapStyle: node.textWrapStyle || 'auto',
      firstLineIndent: getNodePropertyValue(document, node, 'firstLineIndent') || 0,
      align: node.align || 'left',
      verticalAlign: node.verticalAlign || 'top',
      textTruncation: node.textTruncation,
      maxLines: node.maxLines,
      maxHeight: node.maxHeight,
      height,
      fillOpacity,
      paintMode,
      includeDecorations,
      shapeText, decorationMode, decorationsOnly, forceDecorationGeometry, leadingTrimMetrics, strictLeadingTrim, textLineMetrics, strictTextLineMetrics
    });
  } finally {
    if (truncate) ctx.restore();
  }
}

function createTextSurface(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = globalThis.document?.createElement?.('canvas');
  if (!canvas) return null;
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function createShadowSpreadSurface(source, spread) {
  if (!source || !Number.isFinite(spread) || spread === 0) return source;
  const width = source.width;
  const height = source.height;
  const sourceContext = source.getContext?.('2d');
  if (!sourceContext?.getImageData) return null;
  let imageData;
  try { imageData = sourceContext.getImageData(0, 0, width, height); }
  catch { return null; }
  const alpha = new Uint8Array(width * height);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = imageData.data[pixel * 4 + 3];
  let spreadAlpha;
  try { spreadAlpha = morphShadowAlpha(alpha, width, height, spread); }
  catch { return null; }
  for (let pixel = 0; pixel < spreadAlpha.length; pixel += 1) imageData.data[pixel * 4 + 3] = spreadAlpha[pixel];
  const result = createTextSurface(width, height);
  const resultContext = result?.getContext?.('2d');
  if (!resultContext?.putImageData) return null;
  resultContext.putImageData(imageData, 0, 0);
  return result;
}

function createShadowGeometryMask(node, document, rasterScale, pixelWidth, pixelHeight, padX = 0, padY = 0, shapeText = null) {
  if (node.type === 'boolean') {
    try { return createShadowGeometryMask(getBooleanStrokePath(document, node), document, rasterScale, pixelWidth, pixelHeight, padX, padY, shapeText); }
    catch { return null; }
  }
  const mask = createTextSurface(pixelWidth, pixelHeight);
  const context = mask?.getContext?.('2d');
  if (!context) return null;
  context.save();
  context.setTransform(rasterScale, 0, 0, rasterScale, padX * rasterScale, padY * rasterScale);
  if (node.affineTransform) {
    const { a, b, c, d } = node.affineTransform;
    context.translate(0, 0);
    context.transform(a, b, c, d, 0, 0);
    context.translate(0, 0);
  }
  if (node.rotation && typeof context.translate === 'function' && typeof context.rotate === 'function') {
    context.translate(node.width / 2, node.height / 2);
    context.rotate(node.rotation * Math.PI / 180);
    context.translate(-node.width / 2, -node.height / 2);
  }
  context.fillStyle = '#ffffff';
  const tracePath = pathContext => {
    if (node.type === 'ellipse') traceEllipseArc(pathContext, node);
    else if (['rectangle', 'frame', 'image'].includes(node.type)) roundedRect(pathContext, 0, 0, node.width, node.height, node.cornerRadii || node.radius || 0, node.cornerSmoothing || 0);
    else if (node.type === 'star' || node.type === 'polygon') {
      traceRoundedPolygonPath(pathContext, 0, 0,
        regularShapeVertices(node.type, node.width, node.height, node.points, node.innerRadius ?? 0.48),
        node.vertexRadii || node.radius || 0, node.cornerSmoothing || 0);
    } else if (node.type === 'path') traceVectorPath(pathContext, node, 0, 0);
    else if (node.type === 'network') traceVectorNetworkEdges(pathContext, node, 0, 0);
    else if (node.type === 'line') {
      pathContext.moveTo(0, node.lineReverseY === true ? node.height : 0);
      pathContext.lineTo(node.width, node.lineReverseY === true ? 0 : node.height);
    }
  };
  if (node.type === 'ellipse' && typeof context.ellipse === 'function') {
    context.beginPath();
    traceEllipseArc(context, node);
    context.fill();
  } else if (node.type === 'star' || node.type === 'polygon') {
    context.beginPath();
    tracePath(context);
    context.fill();
  } else if (node.type === 'path' && typeof context.beginPath === 'function') {
    context.beginPath();
    tracePath(context);
    if (pathHasClosedContour(node)) context.fill(node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
  } else if (node.type === 'network' && typeof context.beginPath === 'function') {
    for (const face of node.faces || []) {
      context.beginPath();
      if (traceVectorNetworkFace(context, node, face, 0, 0)) context.fill();
    }
  } else if (node.type === 'text') {
    drawTextMask(context, node, document, 0, 0, node.width, node.height, shapeText, 'vector');
  } else if (node.type === 'line') {
    // The line's stroke path below defines its geometry; its bounds are not a
    // filled rectangle.
  } else if (typeof context.beginPath === 'function' && typeof context.rect === 'function') {
    context.beginPath();
    roundedRect(context, 0, 0, node.width, node.height, node.cornerRadii || node.radius || 0, node.cornerSmoothing || 0);
    context.fill();
  } else if (typeof context.fillRect === 'function') context.fillRect(0, 0, node.width, node.height);
  else { context.restore(); return null; }
  if (['rectangle', 'frame', 'image', 'ellipse', 'star', 'polygon', 'path', 'network', 'line', 'text'].includes(node.type)) {
    // Include the authored stroke silhouette too; stroke opacity is ignored
    // for geometry, just as fill opacity is for this Figma effect option.
    const textOutline = node.type === 'text'
      ? outlineContext => drawTextLayerContent(outlineContext, node, document, 0, 0, node.width, node.height, {
        colorOverride: '#ffffff', fillOpacity: 1, paintMode: 'stroke', includeDecorations: false,
        overrideRunColors: true, shapeText
      })
      : null;
    const textGeometry = node.type === 'text'
      ? glyphContext => drawTextLayerContent(glyphContext, node, document, 0, 0, node.width, node.height, {
        colorOverride: '#ffffff', fillOpacity: 1, includeDecorations: false, overrideRunColors: true, shapeText
      })
      : null;
    drawStrokeStack(context, node, document, 0, 0, node.width, node.height, tracePath, 'vector', textOutline, textGeometry, 1,
      node.type === 'text' ? localTextInkBounds(document, node, shapeText, { forStroke: true }) : null);
  }
  context.restore();
  return mask;
}

function removeShadowBehindGeometry(shadowSurface, geometryMask) {
  if (!shadowSurface || !geometryMask) return false;
  const context = shadowSurface.getContext?.('2d');
  if (!context) return false;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'destination-out';
  context.filter = 'none';
  context.drawImage(geometryMask, 0, 0);
  context.restore();
  return true;
}

function resizeTextSurface(surface, width, height) {
  if (!surface) return createTextSurface(width, height);
  if (surface.width !== width) surface.width = width;
  if (surface.height !== height) surface.height = height;
  return surface;
}

function setTextSurfaceTransform(context, x, y, width, height, pixelWidth, pixelHeight) {
  const scaleX = pixelWidth / width;
  const scaleY = pixelHeight / height;
  context.setTransform(scaleX, 0, 0, scaleY, -x * scaleX, -y * scaleY);
  return { scaleX, scaleY };
}

function drawTextFillStack(ctx, node, document, assets, state, x, y, width, height, motionValues, surfaces, transitionRenderer = null) {
  if (!Array.isArray(node.fills) || width <= 0 || height <= 0) return false;
  const transform = ctx.getTransform?.();
  const requestedScale = transform ? Math.hypot(transform.a, transform.b)
    : (globalThis.devicePixelRatio || 1) * Math.max(.08, state.zoom || 1);
  const dimensions = booleanSurfaceDimensions(width, height, requestedScale);
  surfaces.glyph = resizeTextSurface(surfaces.glyph, dimensions.width, dimensions.height);
  surfaces.paint = resizeTextSurface(surfaces.paint, dimensions.width, dimensions.height);
  const glyphSurface = surfaces.glyph;
  const paintSurface = surfaces.paint;
  const glyphContext = glyphSurface?.getContext('2d');
  const paintContext = paintSurface?.getContext('2d');
  if (!glyphContext || !paintContext) return false;

  setTextSurfaceTransform(glyphContext, x, y, width, height, dimensions.width, dimensions.height);
  drawTextLayerContent(glyphContext, node, document, x, y, width, height, {
    colorOverride: '#ffffff', fillOpacity: 1, overrideRunColors: true, shapeText: state.shapeLocalTextRun, decorationMode: 'auto'
  });

  const motionFillIndex = node.fills.findIndex(fill => fill.type === 'solid');
  for (let index = 0; index < node.fills.length; index += 1) {
    const fill = node.fills[index];
    if (!fill.visible || fill.opacity <= 0) continue;
    paintContext.setTransform(1, 0, 0, 1, 0, 0);
    paintContext.globalAlpha = 1;
    paintContext.globalCompositeOperation = 'source-over';
    paintContext.clearRect(0, 0, dimensions.width, dimensions.height);
    setTextSurfaceTransform(paintContext, x, y, width, height, dimensions.width, dimensions.height);
    paintContext.beginPath();
    paintContext.rect(x, y, width, height);
    const paintNode = {
      ...node, type: 'rectangle', fills: [fill],
      stroke: null, strokeWidth: 0, strokes: []
    };
    drawFillStack(paintContext, paintNode, assets, state, x, y, width, height,
      null, motionValues, true, index, motionFillIndex, transitionRenderer);

    paintContext.save();
    paintContext.setTransform(1, 0, 0, 1, 0, 0);
    paintContext.globalAlpha = 1;
    paintContext.globalCompositeOperation = 'destination-in';
    paintContext.drawImage(glyphSurface, 0, 0);
    paintContext.restore();

    ctx.save();
    if (fill.blendMode && fill.blendMode !== 'normal') {
      ctx.globalCompositeOperation = canvasBlendOperation(fill.blendMode);
    }
    ctx.drawImage(paintSurface, x, y, width, height);
    ctx.restore();
  }
  return true;
}

const BLUE = '#0d99ff';
const frameOverflowBehaviors = new Set(['none', 'vertical', 'horizontal', 'both']);
const MAX_NOISE_CACHE_PIXELS = 2_000_000;
const MAX_NOISE_CACHE_ENTRIES = 8;

/** Return the selection outline and all transform handles in page coordinates. */
export function selectionOverlayGeometry(node, ancestors = [], { zoom = 1, rotateOffset = 24 } = {}) {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new TypeError('Selection overlay zoom must be a positive finite number.');
  const corners = [
    nodeLocalToPage(node, { x: 0, y: 0 }, ancestors),
    nodeLocalToPage(node, { x: node.width, y: 0 }, ancestors),
    nodeLocalToPage(node, { x: node.width, y: node.height }, ancestors),
    nodeLocalToPage(node, { x: 0, y: node.height }, ancestors)
  ];
  const handles = getTransformHandles(node, ancestors, { rotateOffset: rotateOffset / zoom });
  return { corners, handles };
}

/** Return the shared transform handles for an axis-aligned multi-layer box. */
export function selectionGroupHandles(bounds, { rotateOffset = 24 } = {}) {
  const { x, y, width, height } = bounds;
  const middleX = x + width / 2;
  const middleY = y + height / 2;
  const resize = {};
  if (width > 0 && height > 0) {
    Object.assign(resize, {
      nw: { x, y }, n: { x: middleX, y }, ne: { x: x + width, y },
      e: { x: x + width, y: middleY }, se: { x: x + width, y: y + height },
      s: { x: middleX, y: y + height }, sw: { x, y: y + height }, w: { x, y: middleY }
    });
  } else if (width > 0) {
    // A horizontal selection can be resized along X only. Avoid corner and
    // vertical handles because they would request scaling its zero-height axis.
    resize.e = { x: x + width, y: middleY };
    resize.w = { x, y: middleY };
  } else if (height > 0) {
    // A vertical selection can be resized along Y only.
    resize.n = { x: middleX, y };
    resize.s = { x: middleX, y: y + height };
  }
  return {
    resize,
    rotate: { x: middleX, y: y - rotateOffset }
  };
}

/** Return axis-aligned resize handles for a slice; slices intentionally have no rotation handle. */
export function sliceSelectionHandles(slice) {
  if (slice?.type !== 'slice' || ![slice.x, slice.y, slice.width, slice.height].every(Number.isFinite)
    || slice.width <= 0 || slice.height <= 0) return null;
  return { resize: selectionGroupHandles({ x: slice.x, y: slice.y, width: slice.width, height: slice.height }, { rotateOffset: 0 }).resize };
}

function rgba(hex, alpha = 1) {
  if (!hex || hex === 'transparent') return `rgba(0,0,0,0)`;
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? [...value].map(char => char + char).join('') : value;
  const number = Number.parseInt(normalized, 16);
  return `rgba(${number >> 16}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

export function drawFittedImage(ctx, image, x, y, width, height, fit = 'cover', scalingFactor = DEFAULT_IMAGE_TILE_SCALE, transforms = {}, tileSourceSize = null) {
  if (!image || width <= 0 || height <= 0 || !image.width || !image.height) return false;
  if (fit === 'tile') return drawTiledImage(ctx, image, x, y, width, height, scalingFactor, transforms, tileSourceSize);
  const scale = fit === 'contain'
    ? Math.min(width / image.width, height / image.height)
    : Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  return true;
}

export function drawTiledImage(ctx, image, x, y, width, height, scalingFactor = DEFAULT_IMAGE_TILE_SCALE, transforms = {}, tileSourceSize = null) {
  if (!image || width <= 0 || height <= 0 || !image.width || !image.height || typeof ctx?.createPattern !== 'function') return false;
  const normalized = normalizeImageTransforms({ ...transforms, crop: null });
  const sourceWidth = Number(tileSourceSize?.width) || image.width;
  const sourceHeight = Number(tileSourceSize?.height) || image.height;
  const geometry = imageTilePatternTransform({
    imageWidth: image.width, imageHeight: image.height,
    sourceWidth, sourceHeight, scalingFactor,
    rotation: normalized.rotation,
    flipHorizontal: normalized.flipHorizontal,
    flipVertical: normalized.flipVertical,
    x, y
  });
  if (!geometry) return false;
  const pattern = ctx.createPattern(image, 'repeat');
  if (!pattern || typeof pattern.setTransform !== 'function') return false;
  pattern.setTransform(geometry.matrix);
  ctx.save();
  try {
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y, width, height);
  } finally {
    ctx.restore();
  }
  return true;
}

function drawImageWithFitMode(ctx, image, node, assets, assetId, x, y, width, height, fit, scalingFactor, transforms, liveSource) {
  if (fit !== 'tile') {
    return liveSource
      ? drawImageWithTransforms(ctx, image, x, y, width, height, fit, transforms)
      : drawFittedImage(ctx, image, x, y, width, height, fit);
  }
  const asset = assetId ? assets.get(assetId) : null;
  const naturalWidth = Number(asset?.sourceWidth || asset?.width || asset?.bitmap?.width || image.width);
  const naturalHeight = Number(asset?.sourceHeight || asset?.height || asset?.bitmap?.height || image.height);
  if (liveSource) {
    return drawTiledImage(ctx, image, x, y, width, height, scalingFactor, transforms, {
      width: naturalWidth, height: naturalHeight
    });
  }
  const orientation = imageTileSourceDimensions(naturalWidth, naturalHeight, transforms?.rotation || 0);
  return drawTiledImage(ctx, image, x, y, width, height, scalingFactor, {}, orientation);
}

/** Draw from the immutable source using the live image crop/rotation/flip values. */
export function drawImageWithTransforms(ctx, image, x, y, width, height, fit = 'cover', transforms = {}, scalingFactor = DEFAULT_IMAGE_TILE_SCALE) {
  if (!image || width <= 0 || height <= 0 || !image.width || !image.height) return false;
  const normalized = normalizeImageTransforms(transforms);
  if (fit === 'tile') return drawTiledImage(ctx, image, x, y, width, height, scalingFactor, normalized);
  const crop = imageCropPixels(normalized.crop, image.width, image.height)
    || { left: 0, top: 0, right: image.width, bottom: image.height };
  const sourceWidth = crop.right - crop.left;
  const sourceHeight = crop.bottom - crop.top;
  if (sourceWidth <= 0 || sourceHeight <= 0) return false;
  const quarterTurn = normalized.rotation === 90 || normalized.rotation === 270;
  const orientedWidth = quarterTurn ? sourceHeight : sourceWidth;
  const orientedHeight = quarterTurn ? sourceWidth : sourceHeight;
  const scale = fit === 'contain'
    ? Math.min(width / orientedWidth, height / orientedHeight)
    : Math.max(width / orientedWidth, height / orientedHeight);
  if (!Number.isFinite(scale) || scale <= 0) return false;
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.save();
  try {
    ctx.translate(x + width / 2, y + height / 2);
    if (normalized.flipHorizontal || normalized.flipVertical) {
      ctx.scale(normalized.flipHorizontal ? -1 : 1, normalized.flipVertical ? -1 : 1);
    }
    ctx.rotate(normalized.rotation * Math.PI / 180);
    ctx.drawImage(image, crop.left, crop.top, sourceWidth, sourceHeight,
      -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  } finally {
    ctx.restore();
  }
  return true;
}

export function drawCropSourceImage(ctx, image, x, y, bounds, rotation = 0, flipHorizontal = false, flipVertical = false) {
  if (!image || !bounds || bounds.width <= 0 || bounds.height <= 0) return false;
  const turn = ((rotation % 360) + 360) % 360;
  const quarterTurn = turn === 90 || turn === 270;
  const imageWidth = quarterTurn ? bounds.height : bounds.width;
  const imageHeight = quarterTurn ? bounds.width : bounds.height;
  ctx.save();
  ctx.translate(x + bounds.left + bounds.width / 2, y + bounds.top + bounds.height / 2);
  if (flipHorizontal || flipVertical) ctx.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1);
  ctx.rotate(turn * Math.PI / 180);
  ctx.drawImage(image, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
  ctx.restore();
  return true;
}

export function drawCropPreview(ctx, image, x, y, width, height, fit = 'cover', radius = 0, smoothing = 0) {
  if (!image || width <= 0 || height <= 0) return false;
  // The worker output already contains the selected crop and rotation. Show it
  // exactly as the committed image will render: fitted to the layer frame and
  // clipped to the same rounded bounds. The uncropped source remains beneath
  // this overlay to give the crop handles context.
  ctx.save();
  ctx.beginPath();
  roundedRect(ctx, x, y, width, height, radius, smoothing);
  ctx.clip();
  const drawn = drawFittedImage(ctx, image, x, y, width, height, fit);
  ctx.restore();
  return drawn;
}

function imageForNode(node, assets, state, assetId = node.assetId, previewKey = node.id) {
  const settings = imagePreviewSettingsForNode(node, previewKey, assetId);
  const requiresRenderedPixels = imagePreviewRequiresRenderedPixels(settings);
  const cachedAssetId = state.previewAssetIds?.get(previewKey);
  const preview = state.previews?.get(previewKey);
  const previewIsCurrent = imagePreviewMatchesSettings(
    settings, cachedAssetId, state.previewSignatures?.get(previewKey)
  );
  if (preview && previewIsCurrent) return preview;
  const previewStatus = state.imageStatus?.get(previewKey) || '';
  const previewIsUpdating = /^(Updating preview|Processing locally|Processing recipe|Object erase)/.test(previewStatus);
  if (preview && previewIsUpdating && canShowPreviousImagePreview(
    settings, cachedAssetId, state.previewSignatures?.get(previewKey)
  )) return preview;
  // Never let an older retained bitmap or the original source masquerade as
  // the current appearance while a source, geometry, or erase edit is pending.
  // Adjustment-only updates may show the last frame above until the new one is ready.
  if (requiresRenderedPixels && !previewIsCurrent) return null;
  return assets.get(assetId)?.bitmap ?? null;
}

export function fillLayerColor(document, node, fill, index) {
  const linkedPrimary = index === 0 && (node.fillStyleId || node.fillVariableId || node.variableBindings?.fill);
  return linkedPrimary || (index === 0 && !Array.isArray(node.fills))
    ? getNodeColor(document, node, 'fill')
    : fill.color;
}

function fillCurrentPath(ctx, node) {
  if (node?.type === 'path') ctx.fill(node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
  else ctx.fill();
}

function drawFillStack(ctx, node, assets, state, x, y, width, height, colorOverride = null, motionValues = state.motionPreview?.get(node.id), maskMode = false, fillIndexOffset = 0, motionFillIndexOverride = null, transitionRenderer = null) {
  const fills = fillStackForNode(node);
  const vectorMask = maskMode === 'vector';
  const motionFillIndex = motionFillIndexOverride ?? fills.findIndex(fill => fill.type === 'solid');
  for (let index = 0; index < fills.length; index += 1) {
    const fill = fills[index];
    const paintIndex = index + fillIndexOffset;
    const animatedFill = paintIndex === motionFillIndex;
    const fillOpacity = animatedFill && Number.isFinite(motionValues?.fillOpacity) ? motionValues.fillOpacity : fill.opacity;
    if (!fill.visible || (!vectorMask && fillOpacity <= 0)) continue;
    ctx.save();
    if (vectorMask) {
      ctx.fillStyle = '#ffffff';
      fillCurrentPath(ctx, node);
      ctx.restore();
      continue;
    }
    // Paint blend modes are compositing operations for this paint. Applying
    // them on the active destination lets the paint see both the already
    // rendered page backdrop and earlier paints on this node, matching the
    // ordered fill stack instead of blending an isolated whole-node bitmap.
    if (!maskMode && fill.blendMode && fill.blendMode !== 'normal') ctx.globalCompositeOperation = canvasBlendOperation(fill.blendMode);
    ctx.globalAlpha *= fillOpacity;
    if (fill.type === 'solid') {
      const color = animatedFill && typeof motionValues?.fillColor === 'string'
        ? motionValues.fillColor
        : colorOverride != null && paintIndex === 0
        ? colorOverride
        : fillLayerColor(state.document, node, fill, paintIndex);
      if (color && color !== 'transparent') { ctx.fillStyle = rgba(color, 1); fillCurrentPath(ctx, node); }
    } else if (gradientTypes.has(fill.type)) {
      const paint = createGradientPaint(ctx, fill.gradient, x, y, width, height);
      if (paint) { ctx.fillStyle = paint; fillCurrentPath(ctx, node); }
    } else if (fill.type === 'image') {
      const imageFill = fill.imageFill;
      const imageTransition = fill.__smartAnimateImageTransition
        || (!Array.isArray(node.fills) ? node.__smartAnimateImageFillTransition : null);
      if (imageTransition) {
        ctx.save();
        if (node.type === 'path') ctx.clip(node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
        else ctx.clip();
        transitionRenderer?.drawSmartAnimateImageTransition(ctx, imageTransition, assets, state, x, y, width, height);
        ctx.restore();
        ctx.restore();
        continue;
      }
      const liveSource = (fill.__smartAnimateLiveImageFill || (!Array.isArray(node.fills) && node.__smartAnimateLiveImageFill)) && imageFill
        ? assets.get(imageFill.assetId)?.bitmap : null;
      const image = liveSource || (imageFill && imageForNode(node, assets, state, imageFill.assetId, imagePreviewKey(node.id, fill.id)));
      if (image) {
        ctx.save();
        if (node.type === 'path') ctx.clip(node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
        else ctx.clip();
        const cropOverlay = !state.presenting && state.imageCropMode
          && state.imageCropOverlay?.kind === 'fill'
          && state.imageCropOverlay.nodeId === node.id
          && state.imageCropOverlay.fillId === fill.id
          ? state.imageCropOverlay : null;
        const sourceImage = cropOverlay ? assets.get(imageFill.assetId)?.bitmap : null;
        if (cropOverlay && sourceImage) {
          drawCropSourceImage(ctx, sourceImage, x, y, cropOverlay.virtualBounds, cropOverlay.rotation,
            cropOverlay.flipHorizontal, cropOverlay.flipVertical);
          const preview = state.previews?.get(imagePreviewKey(node.id, fill.id));
          const previewAssetId = state.previewAssetIds?.get(imagePreviewKey(node.id, fill.id));
          const previewStatus = state.imageStatus?.get(imagePreviewKey(node.id, fill.id)) || '';
          if (preview && previewAssetId === imageFill.assetId
            && (previewStatus.startsWith('Ready') || previewStatus.startsWith('Updated'))) {
            drawImageWithFitMode(ctx, preview, node, assets, imageFill.assetId, x, y, width, height,
              imageFill.fit, imageFill.scalingFactor, imageFill.transforms, false);
          }
        } else drawImageWithFitMode(ctx, image, node, assets, imageFill.assetId, x, y, width, height,
          imageFill.fit, imageFill.scalingFactor, imageFill.transforms, Boolean(liveSource));
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

function drawStrokeGeometry(context, node, document, x, y, width, height, paintGlyphGeometry = null, traceOnly = false) {
  context.fillStyle = '#ffffff';
  if (paintGlyphGeometry) { paintGlyphGeometry(context); return; }
  context.beginPath();
  const radius = node.cornerRadii || getNodePropertyValue(document, node, 'radius') || 0;
  if (['rectangle', 'frame', 'image'].includes(node.type)) roundedRect(context, x, y, width, height, radius, node.cornerSmoothing || 0);
  else if (node.type === 'ellipse') traceEllipseArc(context, node, x, y, width, height);
  else if (node.type === 'star' || node.type === 'polygon') {
    traceRoundedPolygonPath(context, x, y, regularShapeVertices(node.type, width, height, node.points, node.innerRadius ?? .48),
      node.vertexRadii || Number(radius) || 0, node.cornerSmoothing || 0);
  } else if (node.type === 'path') traceVectorPath(context, node, x, y);
  else if (node.type === 'network') {
    // Fill faces separately: network faces may have opposite winding and
    // overlapping faces form a union rather than cancelling each other.
    for (const face of node.faces || []) {
      if (!traceOnly) context.beginPath();
      if (traceVectorNetworkFace(context, node, face, x, y) && !traceOnly) context.fill();
    }
    return;
  }
  if (!traceOnly) context.fill(node.type === 'path' && node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
}

function drawAlignedStroke(ctx, node, stroke, color, document, x, y, width, height, tracePath, maskMode, paintOutline, paintGlyphGeometry, textBounds) {
  const alignment = effectiveStrokeAlignment(node, stroke);
  const padding = strokePaintPadding(node, [{ ...stroke, opacity: 1, color: maskMode === 'vector' ? '#ffffff' : color }]) + 1;
  const geometryBounds = textBounds || strokeGeometryBounds({ ...node, width, height });
  const logicalWidth = geometryBounds.right - geometryBounds.left + 2 * padding;
  const logicalHeight = geometryBounds.bottom - geometryBounds.top + 2 * padding;
  const transform = ctx.getTransform?.();
  const requestedScale = transform
    ? Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c || 0, transform.d ?? transform.a))
    : 1;
  const dimensions = booleanSurfaceDimensions(logicalWidth, logicalHeight, requestedScale);
  const surface = createTextSurface(dimensions.width, dimensions.height);
  const geometry = createTextSurface(dimensions.width, dimensions.height);
  const paintContext = surface?.getContext?.('2d'); const geometryContext = geometry?.getContext?.('2d');
  if (!paintContext || !geometryContext) return false;
  const left = x + geometryBounds.left - padding; const top = y + geometryBounds.top - padding;
  setTextSurfaceTransform(paintContext, left, top, logicalWidth, logicalHeight, dimensions.width, dimensions.height);
  setTextSurfaceTransform(geometryContext, left, top, logicalWidth, logicalHeight, dimensions.width, dimensions.height);
  const centeredStroke = { ...stroke, color, alignment: 'center', opacity: 1, blendMode: 'normal' };
  const closedTrace = pathContext => drawStrokeGeometry(pathContext, node, document, x, y, width, height, null, true);
  const strokeTrace = node.type === 'network' ? closedTrace : tracePath || closedTrace;
  drawStrokeStack(paintContext, { ...node, strokes: [centeredStroke], strokeVariableId: undefined }, document,
    x, y, width, height, strokeTrace, maskMode, paintOutline, paintGlyphGeometry, 2);
  drawStrokeGeometry(geometryContext, node, document, x, y, width, height, paintGlyphGeometry);
  paintContext.setTransform(1, 0, 0, 1, 0, 0);
  paintContext.globalAlpha = 1;
  paintContext.globalCompositeOperation = alignment === 'inside' ? 'destination-in' : 'destination-out';
  paintContext.drawImage(geometry, 0, 0);
  // Each stroke is masked in isolation. Its opacity and blend are applied once
  // against the preceding paint stack, never to the geometric clip itself.
  ctx.drawImage(surface, left, top, logicalWidth, logicalHeight);
  return true;
}

function drawStrokeStack(ctx, node, document, x, y, width, height, tracePath = null, maskMode = false, paintOutline = null, paintGlyphGeometry = null, widthMultiplier = 1, textBounds = null) {
  const strokes = strokeStackForNode(node);
  const supportsIndividualSides = ['rectangle', 'frame'].includes(node.type);
  const hasIndividualSideStroke = supportsIndividualSides && strokes.some(stroke => !isUniformStrokeSideWidths(strokeSideWidths(stroke)));
  const rectangleSides = hasIndividualSideStroke
    ? rectangleStrokeSidePaths(width, height, node.cornerRadii || getNodePropertyValue(document, node, 'radius'), node.cornerSmoothing || 0)
    : null;
  const vectorMask = maskMode === 'vector';
  for (let index = 0; index < strokes.length; index += 1) {
    const stroke = strokes[index];
    const sideWidths = supportsIndividualSides ? strokeSideWidths(stroke) : null;
    const maximumSideWidth = sideWidths ? Math.max(...strokeSideNames.map(side => sideWidths[side])) : stroke.width;
    if (!stroke.visible || (!vectorMask && stroke.opacity <= 0) || maximumSideWidth <= 0
      || (!stroke.gradient && (!stroke.color || (!vectorMask && stroke.color === 'transparent')))) continue;
    ctx.save();
    // Strokes follow fills in the node paint order, so each stroke composites
    // against the visible backdrop and every earlier fill/stroke.
    if (!maskMode && stroke.blendMode && stroke.blendMode !== 'normal') ctx.globalCompositeOperation = canvasBlendOperation(stroke.blendMode);
    if (!vectorMask) ctx.globalAlpha *= stroke.opacity;
    const strokeHasIndividualSides = rectangleSides && sideWidths && !isUniformStrokeSideWidths(sideWidths);
    ctx.lineWidth = (sideWidths && !strokeHasIndividualSides ? sideWidths.top : stroke.width) * widthMultiplier;
    const color = index === 0 && node.strokeVariableId
      ? getNodeColor(document, node, 'stroke')
      : stroke.color;
    if ((!stroke.gradient && (!color || (!vectorMask && color === 'transparent')))) { ctx.restore(); continue; }
    if (effectiveStrokeAlignment(node, stroke) !== 'center') {
      drawAlignedStroke(ctx, node, stroke, color, document, x, y, width, height, tracePath, maskMode, paintOutline, paintGlyphGeometry, textBounds);
      ctx.restore();
      continue;
    }
    const paint = vectorMask ? '#ffffff' : stroke.gradient ? createGradientPaint(ctx, stroke.gradient, x, y, width, height) : color;
    if (!paint) { ctx.restore(); continue; }
    ctx.strokeStyle = paint;
    applyStrokeStyle(ctx, stroke);
    if (paintOutline) paintOutline(ctx);
    else if (strokeHasIndividualSides) {
      // Match Figma's rectangle/frame-only Individual strokes. The rounded
      // perimeter is split at the corner bisectors, then each side is painted
      // with its own width while retaining this stroke's paint and stack order.
      for (const run of rectangleSides) {
        const sideWidth = sideWidths[run.side];
        if (!(sideWidth > 0)) continue;
        applyStrokeStyle(ctx, { ...stroke, width: sideWidth });
        ctx.lineWidth = sideWidth * widthMultiplier;
        // Side-run endpoints are artificial corner bisectors. Keep solid
        // contours butt-ended and close them with explicit joins; dotted
        // contours require round caps to render their zero-length dashes.
        ctx.lineCap = stroke.pattern === 'dotted' ? 'round' : 'butt';
        ctx.beginPath();
        ctx.moveTo(x + run.points[0].x, y + run.points[0].y);
        for (let pointIndex = 1; pointIndex < run.points.length; pointIndex += 1) {
          ctx.lineTo(x + run.points[pointIndex].x, y + run.points[pointIndex].y);
        }
        ctx.stroke();
      }
      // The shared join polygons fill only the outside wedges left between
      // independently weighted side paths. They use the same stroke paint,
      // opacity, blend mode and exact geometry as SVG export.
      const joins = stroke.pattern === 'solid'
        ? rectangleStrokeSideJoins(rectangleSides, Object.fromEntries(strokeSideNames.map(side => [side, sideWidths[side] * widthMultiplier])), stroke.join, stroke.miterLimit)
        : [];
      if (joins.length) {
        ctx.fillStyle = paint;
        for (const patch of joins) {
          ctx.beginPath();
          ctx.moveTo(x + patch.points[0].x, y + patch.points[0].y);
          for (let pointIndex = 1; pointIndex < patch.points.length; pointIndex += 1) {
            ctx.lineTo(x + patch.points[pointIndex].x, y + patch.points[pointIndex].y);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    else {
      if (tracePath) { ctx.beginPath(); tracePath(ctx); }
      ctx.stroke();
      drawStrokeEndpointDecorations(ctx, node, stroke, { x, y }, paint);
    }
    ctx.restore();
  }
}

function hasBlendedFillPaint(node) {
  return Boolean(node?.__smartAnimateImageFillTransition)
    || (Array.isArray(node?.fills) && node.fills.some(fill => fill?.visible !== false
      && ((fill?.blendMode && fill.blendMode !== 'normal') || fill?.__smartAnimateImageTransition)));
}

function drawBooleanFillStack(renderer, ctx, node, maskSurface, assets, state, x, y) {
  const surface = renderer.booleanPaintSurface = resizeTextSurface(renderer.booleanPaintSurface, maskSurface.width, maskSurface.height);
  if (!surface) return;
  const paintContext = surface.getContext('2d');
  if (!paintContext) return;
  const scaleX = maskSurface.width / Math.max(1, node.width);
  const scaleY = maskSurface.height / Math.max(1, node.height);
  const fills = fillStackForNode(node);
  const animatedFillIndex = fills.findIndex(fill => fill.type === 'solid');
  for (let index = 0; index < fills.length; index += 1) {
    const fill = fills[index];
    const motion = state.motionPreview?.get(node.id);
    const fillOpacity = index === animatedFillIndex && Number.isFinite(motion?.fillOpacity) ? motion.fillOpacity : fill.opacity;
    if (!fill.visible || fillOpacity <= 0) continue;
    paintContext.save();
    paintContext.setTransform(1, 0, 0, 1, 0, 0);
    paintContext.clearRect(0, 0, surface.width, surface.height);
    paintContext.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    paintContext.globalAlpha = 1;
    paintContext.globalCompositeOperation = 'source-over';
    if (fill.type === 'solid') {
      const color = index === animatedFillIndex && typeof motion?.fillColor === 'string'
        ? motion.fillColor : fillLayerColor(state.document, node, fill, index);
      if (color && color !== 'transparent') { paintContext.fillStyle = rgba(color, 1); paintContext.fillRect(0, 0, node.width, node.height); }
    } else if (gradientTypes.has(fill.type)) {
      const paint = createGradientPaint(paintContext, fill.gradient, 0, 0, node.width, node.height);
      if (paint) { paintContext.fillStyle = paint; paintContext.fillRect(0, 0, node.width, node.height); }
    } else if (fill.type === 'image') {
      const imageFill = fill.imageFill;
      const imageTransition = fill.__smartAnimateImageTransition
        || (!Array.isArray(node.fills) ? node.__smartAnimateImageFillTransition : null);
      if (imageTransition) {
        renderer.drawSmartAnimateImageTransition(paintContext, imageTransition, assets, state, 0, 0, node.width, node.height);
      } else {
        const liveSource = fill.__smartAnimateLiveImageFill ? assets.get(imageFill.assetId)?.bitmap : null;
        const image = liveSource || imageForNode(node, assets, state, imageFill.assetId, imagePreviewKey(node.id, fill.id));
        if (image) {
          drawImageWithFitMode(paintContext, image, node, assets, imageFill.assetId, 0, 0, node.width, node.height,
            imageFill.fit, imageFill.scalingFactor, imageFill.transforms, Boolean(liveSource));
        }
      }
    }
    paintContext.setTransform(1, 0, 0, 1, 0, 0);
    paintContext.globalCompositeOperation = 'destination-in';
    paintContext.drawImage(maskSurface, 0, 0);
    paintContext.restore();

    ctx.save();
    ctx.globalAlpha *= fillOpacity;
    if (fill.blendMode && fill.blendMode !== 'normal') ctx.globalCompositeOperation = canvasBlendOperation(fill.blendMode);
    ctx.drawImage(surface, x, y, node.width, node.height);
    ctx.restore();
  }
}

function drawStrokeEndpointDecorations(ctx, node, stroke, origin, color) {
  for (const item of strokeEndpointDecorations(node, stroke, origin)) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = stroke.width;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (item.type === 'circle') {
      ctx.arc(item.center.x, item.center.y, item.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.moveTo(item.points[0].x, item.points[0].y);
    for (let index = 1; index < item.points.length; index += 1) ctx.lineTo(item.points[index].x, item.points[index].y);
    if (item.closed) {
      ctx.closePath();
      ctx.fill();
    } else ctx.stroke();
    ctx.restore();
  }
}

function roundedRect(ctx, x, y, width, height, radius, smoothing = 0) {
  const input = typeof radius === 'number'
    ? Object.fromEntries(cornerRadiusKeys.map(key => [key, radius]))
    : radius;
  const radii = clampCornerRadii(width, height, input);
  if (cornerRadiusKeys.every(key => radii[key] === 0)) { ctx.rect(x, y, width, height); return; }
  traceRoundedRectPath(ctx, x, y, width, height, radii, smoothing);
}

/** Return a sanitized presentation-only scroll offset for a frame. */
export function getPresentationScrollOffset(state, frame) {
  const behavior = frame?.type === 'frame' && frameOverflowBehaviors.has(frame.overflowBehavior)
    ? frame.overflowBehavior
    : 'none';
  const stored = typeof frame?.id === 'string' && state?.presentationScrollOffsets instanceof Map
    ? state.presentationScrollOffsets.get(frame.id)
    : null;
  const x = behavior === 'horizontal' || behavior === 'both' ? stored?.x : 0;
  const y = behavior === 'vertical' || behavior === 'both' ? stored?.y : 0;
  return {
    x: Number.isFinite(x) ? Math.max(0, x) : 0,
    y: Number.isFinite(y) ? Math.max(0, y) : 0
  };
}

/** Return a layer's rendered page-space origin, including scroll and sticky offsets. */
export function presentationNodePageOrigin(page, nodeId, document = null, presentationScrollOffsets = null) {
  if (!page || typeof nodeId !== 'string' || !nodeId) return null;
  const scrollState = { presentationScrollOffsets };
  let origin = null;
  const visit = (nodes, ancestors = [], parentScrollOffset = { x: 0, y: 0 }, parentScrollFrame = null, stickyScrollContext = null, layoutAncestors = []) => {
    for (const node of nodes || []) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      const geometry = document ? getNodeGeometry(document, node) : node;
      const rawNode = { ...node, ...geometry };
      const childScrollOffset = scrollOffsetForPresentationChild(
        parentScrollFrame, rawNode, parentScrollOffset, stickyScrollContext, layoutAncestors.slice(0, -1)
      );
      const resolvedNode = {
        ...rawNode,
        x: rawNode.x - childScrollOffset.x,
        y: rawNode.y - childScrollOffset.y
      };
      if (node.id === nodeId) {
        origin = nodeLocalToPage(resolvedNode, { x: 0, y: 0 }, ancestors);
        return true;
      }
      if (node.type === 'boolean') continue;
      const ownScrollOffset = getPresentationScrollOffset(scrollState, rawNode);
      const childStickyContext = scrollContextForChildren(rawNode, layoutAncestors, ownScrollOffset, stickyScrollContext);
      if (visit(node.children || [], [...ancestors, resolvedNode], ownScrollOffset, rawNode,
        childStickyContext, [...layoutAncestors, rawNode])) return true;
    }
    return false;
  };
  visit(page.children || []);
  return origin;
}

/** Translate only a scrollable frame's contents; call after its viewport clip. */
export function applyPresentationScrollOffset(ctx, state, frame) {
  const offset = getPresentationScrollOffset(state, frame);
  if (offset.x || offset.y) ctx.translate(offset.x ? -offset.x : 0, offset.y ? -offset.y : 0);
  return offset;
}

function scrollContextForChildren(node, ancestors, offset, inherited) {
  return isStickyScrollFrame(node) ? { frame: node, ancestors, offset } : inherited || null;
}

function renderOptionsForChildren(options, node, stickyScrollContext) {
  return {
    ...options,
    ...(options.effectPaintStageNodeId === node.id ? { effectPaintStage: undefined, effectPaintStageNodeId: undefined } : {}),
    presentationAncestors: [...(options.presentationAncestors || []), node],
    stickyScrollContext
  };
}

function paintsChildInEffectStage(node, child, options) {
  if (node.effectPaintMode !== 'staged' || options.effectPaintStageNodeId !== node.id || !options.effectPaintStage) return true;
  return (child.effectPaintPhase === 'stroke') === (options.effectPaintStage === 'stroke');
}

function stagedChildFillOpacity(node, child, document) {
  return node.effectPaintMode === 'staged' && node.effectFillMode === 'legacy' && !['stroke', 'decoration'].includes(child.effectPaintPhase)
    ? getNodePropertyValue(document, node, 'fillOpacity') ?? 1 : 1;
}

function stagedFillPaints(node, document) {
  const paints = []; let visited = 0;
  const visit = (current, depth) => {
    if (++visited > RENDER_INK_BOUNDS_LIMITS.maxNodes || depth > RENDER_INK_BOUNDS_LIMITS.maxDepth) {
      throw new RangeError('Outlined fill geometry exceeds the bounded layer-tree budget.');
    }
    if (getNodePropertyValue(document, current, 'visible') === false) return;
    if (current.mask) {
      const source = current.children?.find(child => child.id === current.maskSourceId) || current.children?.[0];
      for (const child of current.children || []) if (child !== source) visit(child, depth + 1);
    } else if (['group', 'frame', 'section'].includes(current.type)) {
      for (const child of current.children || []) visit(child, depth + 1);
    } else paints.push(...fillStackForNode(current));
  };
  for (const child of node.children || []) if (child.effectPaintPhase !== 'stroke') visit(child, 1);
  return paints;
}

function glassVisibleForRenderedNode(node, document) {
  if (node.effectPaintMode !== 'staged') return glassVisibleForNode(node);
  if ((node.effectFillMode || 'legacy') === 'legacy') return glassVisibleForNode({ ...node, fills: undefined,
    fill: getNodeColor(document, node, 'fill'), fillOpacity: getNodePropertyValue(document, node, 'fillOpacity') ?? 1 });
  return glassVisibleForNode({ ...node, fills: stagedFillPaints(node, document) });
}

function opaqueStagedFillTree(node, depth = 0, budget = { nodes: 0 }, legacy = node.effectFillMode === 'legacy') {
  if (++budget.nodes > RENDER_INK_BOUNDS_LIMITS.maxNodes || depth > RENDER_INK_BOUNDS_LIMITS.maxDepth) {
    throw new RangeError('Outlined backdrop geometry exceeds the bounded layer-tree budget.');
  }
  const bindings = { ...(node.variableBindings || {}) }; delete bindings.opacity; delete bindings.fillOpacity;
  return { ...node, opacity: 1, fillOpacity: 1, variableBindings: bindings, effects: [], blendMode: 'normal',
    ...(Array.isArray(node.fills) ? { fills: node.fills.map(fill => ({ ...fill, opacity: legacy && depth > 0 ? fill.opacity : 1 })) } : {}),
    children: (node.children || []).map(child => opaqueStagedFillTree(child, depth + 1, budget, legacy)) };
}

/** Replay actual fallback font metrics through the same layout/placement transforms. */
function canvasTextLayerInkBounds(document, node, shapeText, measureContext, forStroke) {
  if (typeof measureContext?.measureText !== 'function') return null;
  const bounds = { left: 0, top: 0, right: node.width, bottom: node.height };
  let measurements = 0; let points = 0; let unavailable = false;
  const states = []; const paths = new Map();
  const record = { matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    font: measureContext.font, textAlign: 'left', textBaseline: 'top', fillStyle: '#000000', strokeStyle: '#000000',
    globalAlpha: 1, lineWidth: 1 };
  const keys = Object.keys(record);
  const include = point => {
    if (++points > 100_000) throw new RangeError('Text ink measurement exceeds the bounded point budget.');
    const placed = transformPoint(record.matrix, point);
    if (![placed.x, placed.y].every(value => Number.isFinite(value) && Math.abs(value) <= RENDER_INK_BOUNDS_LIMITS.maxCoordinate)) throw new RangeError('Text ink measurement exceeds the finite coordinate budget.');
    bounds.left = Math.min(bounds.left, placed.x); bounds.right = Math.max(bounds.right, placed.x);
    bounds.top = Math.min(bounds.top, placed.y); bounds.bottom = Math.max(bounds.bottom, placed.y);
  };
  const contours = value => {
    for (const contour of value) {
      include(contour.start);
      for (const command of contour.commands) for (const key of ['end', 'control', 'control1', 'control2']) if (command[key]) include(command[key]);
    }
  };
  Object.assign(record, {
    save() { if (states.length >= 256) throw new RangeError('Text ink measurement exceeds the bounded transform depth.'); states.push(Object.fromEntries(keys.map(key => [key, record[key]]))); },
    restore() { Object.assign(record, states.pop()); },
    translate(x, y) { record.matrix = multiplyAffine(record.matrix, { a: 1, b: 0, c: 0, d: 1, e: x, f: y }); },
    scale(x, y) { record.matrix = multiplyAffine(record.matrix, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 }); },
    rotate(angle) { record.matrix = multiplyAffine(record.matrix, { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle), e: 0, f: 0 }); },
    beginPath() { record.path = []; }, moveTo(x, y) { record.path = [{ x, y }]; }, lineTo(x, y) { record.path.push({ x, y }); }, rect() {}, clip() {},
    measureText(text) {
      if (++measurements > 32_768) throw new RangeError('Text ink measurement exceeds the bounded measurement budget.');
      measureContext.font = record.font; measureContext.textAlign = record.textAlign; measureContext.textBaseline = record.textBaseline;
      if (typeof record.letterSpacing === 'string') measureContext.letterSpacing = record.letterSpacing;
      return measureContext.measureText(text);
    },
    fillText(text, x, y, maximumWidth) {
      const metrics = record.measureText(text);
      if (!['actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent'].every(key => Number.isFinite(metrics[key]))) { unavailable = true; return; }
      const scaleX = Number.isFinite(maximumWidth) && metrics.width > maximumWidth ? maximumWidth / metrics.width : 1;
      const left = x - metrics.actualBoundingBoxLeft * scaleX; const right = x + metrics.actualBoundingBoxRight * scaleX;
      const top = y - metrics.actualBoundingBoxAscent; const bottom = y + metrics.actualBoundingBoxDescent;
      for (const [x, y] of [[left, top], [right, top], [right, bottom], [left, bottom]]) include({ x, y });
    },
    strokeText(...args) { record.fillText(...args); },
    drawLocalGlyphPath(data) { let path = paths.get(data); if (!path) { path = parseLocalGlyphContours(data); paths.set(data, path); } contours(path); },
    drawLocalDecorationGeometry(value) { if (!forStroke) contours(value); },
    stroke() {
      if (forStroke) return;
      for (const point of record.path || []) for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) include({ x: point.x + x * record.lineWidth / 2, y: point.y + y * record.lineWidth / 2 });
    }
  });
  if (typeof measureContext.letterSpacing === 'string') { record.letterSpacing = ''; keys.push('letterSpacing'); }
  measureContext.save?.();
  try { drawTextLayerContent(record, node, document, 0, 0, node.width, node.height, { shapeText, includeDecorations: !forStroke, fillOpacity: 1 }); }
  finally { measureContext.restore?.(); }
  if (unavailable) return null;
  if (node.textTruncation === 'ending' || !forStroke && Array.isArray(node.fills)
    && !strokeStackForNode(node).some(stroke => stroke.visible !== false && stroke.opacity > 0 && stroke.width > 0)
    && ![node, ...(node.textRuns || [])].some(style => style.textDecorationColor && style.textDecorationColor !== 'auto' && style.textDecorationColor.visible !== false)) return { left: 0, top: 0, right: node.width, bottom: node.height };
  return bounds;
}

/** Actual local glyph control hull, or actual Canvas bounds for browser fallback fonts. */
export function localTextInkBounds(document, node, shapeText, { forStroke = false, measureContext } = {}) {
  if (typeof shapeText !== 'function') return canvasTextLayerInkBounds(document, node, shapeText, measureContext, forStroke);
  let collected;
  try { collected = collectTextOutlineGeometry(document, node, { shapeText }); }
  catch (error) {
    if (shapeText.isPreparedTextExport && ['TEXT_POSITION_PENDING', 'TEXT_LEADING_TRIM_PENDING', 'TEXT_LINE_METRICS_PENDING'].includes(error?.code)) throw error;
    return canvasTextLayerInkBounds(document, node, shapeText, measureContext, forStroke);
  }
  const bounds = { left: 0, top: 0, right: node.width, bottom: node.height };
  const contours = forStroke ? collected.geometry.strokeContours
    : collected.geometry.fillGroups.flatMap(group => group.contours);
  for (const contour of contours) {
    const include = point => {
      if (!point) return;
      bounds.left = Math.min(bounds.left, point.x); bounds.top = Math.min(bounds.top, point.y);
      bounds.right = Math.max(bounds.right, point.x); bounds.bottom = Math.max(bounds.bottom, point.y);
    };
    include(contour.start);
    for (const command of contour.commands) {
      include(command.end); include(command.control); include(command.control1); include(command.control2);
    }
  }
  // Explicit paint planes and truncation clip the completed glyph coverage.
  // Strokes remain unbounded by the fill plane unless truncation is enabled.
  if (collected.clipGeometry || (!forStroke && collected.fillClipGeometry && !collected.decorations.some(record => record.paint.independent)
    && !strokeStackForNode(node).some(stroke =>
    stroke.visible !== false && stroke.opacity > 0 && stroke.width > 0))) return { left: 0, top: 0, right: node.width, bottom: node.height };
  return bounds;
}

function clipsNodeContents(node) {
  return Boolean(node?.clip) || isScrollableFrame(node);
}

/** Clip children to their frame viewport when clipping or presentation scrolling is enabled. */
export function clipNodeContents(ctx, node, x, y, radius = node?.cornerRadii ?? node?.radius ?? 0, smoothing = node?.cornerSmoothing ?? 0) {
  if (!clipsNodeContents(node)) return false;
  ctx.beginPath();
  roundedRect(ctx, x, y, node.width, node.height, radius || 0, smoothing);
  ctx.clip();
  return true;
}

function hasHandle(point, part) {
  const handle = point?.[part];
  return Boolean(handle && (Number(handle.x) !== 0 || Number(handle.y) !== 0));
}

function traceVectorPath(ctx, node, x, y) {
  for (const [contourIndex, contour] of vectorPathContours(node).entries()) {
    const points = contour.points || [];
    if (!points.length) continue;
    const position = (index, part) => vectorNodePoint(node, index, part, { x, y }, contourIndex);
    const first = position(0, 'anchor');
    ctx.moveTo(first.x, first.y);
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const end = position(index, 'anchor');
      if (hasHandle(previous, 'out') || hasHandle(current, 'in')) {
        const control1 = position(index - 1, 'out');
        const control2 = position(index, 'in');
        ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
      } else ctx.lineTo(end.x, end.y);
    }
    if (contour.closed) {
      const last = points.at(-1);
      if (hasHandle(last, 'out') || hasHandle(points[0], 'in')) {
        const control1 = position(points.length - 1, 'out');
        const control2 = position(0, 'in');
        ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, first.x, first.y);
      }
      ctx.closePath();
    }
  }
}

function pathHasClosedContour(node) {
  return vectorPathContours(node).some(contour => contour.closed && contour.points.length >= 2);
}

function traceVectorNetworkEdges(ctx, node, x, y) {
  const edgesByPair = vectorNetworkEdgePairIndex(node);
  const roundedFaces = (node.faces || []).map(face => ({ face, path: vectorNetworkFacePathCommands(node, face, { x, y }) }))
    .filter(item => item.path);
  const roundedEdgeIds = new Set();
  for (const { face, path } of roundedFaces) {
    traceNetworkPathCommands(ctx, path);
    const ids = face.vertexIds || [];
    for (let index = 0; index < ids.length; index += 1) {
      const edge = vectorNetworkEdgeForPair(edgesByPair, ids[index], ids[(index + 1) % ids.length]);
      if (edge) roundedEdgeIds.add(edge.id);
    }
  }
  for (const edge of node.edges || []) {
    if (roundedEdgeIds.has(edge.id)) continue;
    const points = vectorNetworkEdgePoints(node, edge.id, { x, y });
    if (!points) continue;
    const [start, control1, control2, end] = points;
    ctx.moveTo(start.x, start.y);
    if (edge.control1 || edge.control2) ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
    else ctx.lineTo(end.x, end.y);
  }
}

function traceNetworkPathCommands(ctx, path) {
  if (!path?.start || !Array.isArray(path.commands)) return false;
  ctx.moveTo(path.start.x, path.start.y);
  for (const command of path.commands) {
    if (command.type === 'line') ctx.lineTo(command.end.x, command.end.y);
    else if (command.type === 'cubic') ctx.bezierCurveTo(
      command.control1.x, command.control1.y, command.control2.x, command.control2.y,
      command.end.x, command.end.y
    );
    else if (command.type === 'arc') ctx.arc(command.center.x, command.center.y, command.radius,
      command.startAngle, command.endAngle, command.endAngle < command.startAngle);
  }
  ctx.closePath();
  return true;
}

function traceVectorNetworkFace(ctx, node, face, x, y) {
  const rounded = vectorNetworkFacePathCommands(node, face, { x, y });
  if (rounded && traceNetworkPathCommands(ctx, rounded)) return true;
  const ids = face?.vertexIds || [];
  if (ids.length < 3) return false;
  const edgesByPair = vectorNetworkEdgePairIndex(node);
  const first = vectorNetworkVertexPoint(node, ids[0], { x, y });
  if (!first) return false;
  ctx.moveTo(first.x, first.y);
  for (let index = 0; index < ids.length; index += 1) {
    const fromId = ids[index]; const toId = ids[(index + 1) % ids.length];
    const edge = vectorNetworkEdgeForPair(edgesByPair, fromId, toId);
    const end = vectorNetworkVertexPoint(node, toId, { x, y });
    if (!edge || !end) return false;
    const points = vectorNetworkEdgePoints(node, edge.id, { x, y });
    const reversed = edge.from !== fromId;
    const control1 = points[reversed ? 2 : 1]; const control2 = points[reversed ? 1 : 2];
    if (edge.control1 || edge.control2) ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
    else ctx.lineTo(end.x, end.y);
  }
  ctx.closePath();
  return true;
}

export function drawTrackedText(ctx, text, x, y, letterSpacing = 0, maxWidth = undefined) {
  return drawTrackedTextPaint(ctx, text, x, y, letterSpacing, maxWidth, 'fill');
}

function drawTrackedTextPaint(ctx, text, x, y, letterSpacing = 0, maxWidth = undefined, paintMode = 'fill', placement = {}) {
  const scaleX = placement.textPositionScaleX || 1;
  if (scaleX !== 1 || placement.textPositionOffsetX) {
    ctx.save(); ctx.translate(x + (placement.textPositionOffsetX || 0), y); ctx.scale(scaleX, 1);
    drawTrackedTextPaint(ctx, text, 0, 0, letterSpacing / scaleX, maxWidth == null ? undefined : maxWidth / scaleX, paintMode);
    ctx.restore(); return;
  }
  const value = String(text ?? '');
  const spacing = Number(letterSpacing) || 0;
  const drawText = paintMode === 'stroke' ? ctx.strokeText.bind(ctx) : ctx.fillText.bind(ctx);
  if (!spacing) { drawText(value, x, y, maxWidth); return; }
  if (typeof ctx.letterSpacing === 'string') {
    const previous = ctx.letterSpacing;
    try {
      ctx.letterSpacing = `${spacing}px`;
      drawText(value, x, y, maxWidth);
      return;
    } finally { ctx.letterSpacing = previous; }
  }
  if (requiresComplexTextShaping(value)) {
    // Preserve native joining and bidirectional ordering if this browser does
    // not implement Canvas letterSpacing. Slightly relaxed tracking is safer
    // than splitting a script run into disconnected glyphs.
    drawText(value, x, y, maxWidth);
    return;
  }
  const glyphs = textGraphemes(value);
  let prefix = '';
  for (let index = 0; index < glyphs.length; index += 1) {
    const glyph = glyphs[index];
    const position = ctx.measureText(prefix + glyph).width - ctx.measureText(glyph).width + index * spacing;
    drawText(glyph, x + position, y);
    prefix += glyph;
  }
}

function drawJustifiedPlainText(ctx, text, x, y, letterSpacing, extraSpace, paintMode = 'fill', shapeText = null, style = null, options = {}) {
  const segments = String(text ?? '').match(/\s+|\S+/gu) || [];
  let offset = 0;
  let hasTextBefore = false;
  for (const [index, segment] of segments.entries()) {
    const whitespace = /^\s+$/u.test(segment);
    const shaped = style ? shapeText?.(segment, style) : null;
    const width = shapedTextWidth(shaped, style?.fontSize, letterSpacing, ctx);
    if (options.collectInk) {
      const contours = nativeInkContoursForShapedText(shaped, { x: x + offset, y, baselineY: style?.textLineBaseline, fontSize: style?.fontSize, letterSpacing });
      if (contours) options.inkContours.push(...contours.map(contour => ({ ...contour, group: `${index}:${contour.group}` })));
      else options.fallbackInkBounds.push(...canvasTextInkBounds(ctx, segment, { x: x + offset, y, letterSpacing }));
    }
    if (!options.decorationsOnly && !drawShapedText(ctx, shaped, segment, x + offset, y, style?.fontSize, letterSpacing, paintMode, null, style || {})) {
      drawTrackedTextPaint(ctx, segment, x + offset, y, letterSpacing, undefined, paintMode);
    }
    offset += width ?? measureTrackedText(ctx, segment, letterSpacing);
    // Drawing tokens separately removes the tracking between adjacent tokens.
    // Keep that boundary advance so justified text matches measuring the full line.
    if (index < segments.length - 1) offset += Number(letterSpacing) || 0;
    if (whitespace) {
      const nextText = segments.slice(index + 1).some(part => !/^\s+$/u.test(part));
      if (hasTextBefore && nextText) offset += extraSpace * textGraphemes(segment).length;
    } else hasTextBefore = true;
  }
  return offset;
}

export function drawTextDecoration(ctx, x, y, width, fontSize, decoration, {
  style = {}, shaped = null, text = '', letterSpacing = 0, inkContours, fallbackInkBounds,
  baseline = false, mode = 'all', forceGeometryColor = false, parentAlpha, inkTop = y, glyphBaselineY
} = {}) {
  if (!width || !['underline', 'line-through'].includes(decoration)) return false;
  const independent = decoration === 'underline' && style.textDecorationColor && style.textDecorationColor !== 'auto';
  if (mode === 'auto' && independent || mode === 'independent' && !independent) return false;
  if (decoration === 'underline' && style.textDecorationThickness?.unit !== 'auto' && style.textDecorationThickness?.value === 0) return false;
  if (independent && (forceGeometryColor || typeof ctx.drawLocalDecorationGeometry !== 'function' || ctx.skipInvisibleDecorations)
    && (style.textDecorationColor.visible === false || !forceGeometryColor && !(style.textDecorationColor.opacity > 0))) return false;
  const custom = decoration === 'underline' && (style.textDecorationStyle && style.textDecorationStyle !== 'solid'
    || style.textDecorationThickness?.unit && style.textDecorationThickness.unit !== 'auto'
    || style.textDecorationOffset?.unit && style.textDecorationOffset.unit !== 'auto' || independent || style.textDecorationSkipInk);
  if (custom) {
    const glyphs = style.textDecorationSkipInk ? inkContours ?? nativeInkContoursForShapedText(shaped, {
      x: x + (style.textPositionOffsetX || 0), y: inkTop, baselineY: glyphBaselineY, fontSize, letterSpacing, scaleX: style.textPositionScaleX || 1 }) : null;
    const fallback = style.textDecorationSkipInk ? fallbackInkBounds ?? (!glyphs ? canvasTextInkBounds(ctx, text, {
      x: x + (style.textPositionOffsetX || 0), y: inkTop, letterSpacing, scaleX: style.textPositionScaleX || 1 }) : []) : [];
    const geometry = textDecorationGeometry({ x, y, width, fontSize, decoration, style, baseline, inkContours: glyphs, fallbackInkBounds: fallback });
    if (!geometry.contours.length) return false;
    if (typeof ctx.drawLocalDecorationGeometry === 'function') {
      ctx.drawLocalDecorationGeometry(geometry.contours, { paint: forceGeometryColor
        ? { type: 'solid', color: '#ffffff', opacity: 1, visible: true } : geometry.paint, independent }); return true;
    }
    if (geometry.paint !== 'auto' && geometry.paint.visible === false) return false;
    ctx.save();
    if (forceGeometryColor) { ctx.fillStyle = '#ffffff'; ctx.globalAlpha = Number.isFinite(parentAlpha) ? parentAlpha : ctx.globalAlpha; }
    else if (geometry.paint !== 'auto') {
      ctx.fillStyle = geometry.paint.color;
      ctx.globalAlpha = (Number.isFinite(parentAlpha) ? parentAlpha : ctx.globalAlpha) * geometry.paint.opacity;
    }
    ctx.beginPath(); traceTextDecorationContours(ctx, geometry.contours); ctx.fill('nonzero'); ctx.restore();
    return true;
  }
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = Math.max(1, Number(fontSize) / 16 || 1);
  const lineY = y + Number(fontSize) * (decoration === 'underline' ? baseline ? .08 : 1.03 : baseline ? -.3 : .55);
  ctx.beginPath(); ctx.moveTo(x, lineY); ctx.lineTo(x + width, lineY); ctx.stroke();
  ctx.restore();
  return true;
}

/** Returns the non-negative vertical free-space offset for a text box. */
export function textVerticalOffset(boxHeight, contentHeight, alignment = 'top') {
  const box = Number(boxHeight);
  const content = Number(contentHeight);
  const freeSpace = Math.max(0, (Number.isFinite(box) ? box : 0) - (Number.isFinite(content) ? content : 0));
  if (alignment === 'middle') return freeSpace / 2;
  if (alignment === 'bottom') return freeSpace;
  return 0;
}

function richFont(style) {
  return `${style.fontStyle === 'italic' ? 'italic ' : ''}${canvasFontWeight(style.fontWeight, style.fontAxes)} ${style.fontSize}px ${style.fontFamily}`;
}

function drawParagraphMarker(ctx, marker, x, y, fallbackStyle, fillOpacity = 1, paintMode = 'fill', shapeText = null) {
  const style = marker.style || fallbackStyle;
  ctx.save();
  ctx.font = richFont(style);
  if (paintMode !== 'stroke') ctx.fillStyle = rgba(style.color || fallbackStyle.color, fillOpacity);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const shaped = shapeText?.(marker.text, style);
  const markerWidth = shapedTextWidth(shaped, style.fontSize, resolvedTextLetterSpacing(style), ctx, style.textPositionScaleX || 1)
    ?? measureTrackedText(ctx, marker.text, resolvedTextLetterSpacing(style) / (style.textPositionScaleX || 1)) * (style.textPositionScaleX || 1);
  // Right-align within the marker column. Keeping this draw independent from
  // the text-line transform preserves a stable gutter for center/right text.
  const top = y + (Number.isFinite(marker.topOffset) ? marker.topOffset : (style.textPositionTopOffset || 0) - (style.baselineShift || 0));
  const placement = { ...style, ...(Number.isFinite(marker.topOffset) ? { textLineBaseline: top + marker.textLineMetrics.topBaseline } : {}) };
  if (!drawShapedText(ctx, shaped, marker.text, x + marker.anchorX - markerWidth, top, style.fontSize, resolvedTextLetterSpacing(style), paintMode, null, placement)) {
    drawTrackedTextPaint(ctx, marker.text, x + marker.anchorX - markerWidth, top, resolvedTextLetterSpacing(style), undefined, paintMode, style);
  }
  ctx.restore();
}

/** Draws styled text runs using node-wide values as fallbacks for each run. */
export function drawTextRuns(ctx, runs, x, y, width, baseStyle = {}) {
  const paintMode = baseStyle.paintMode || 'fill';
  const includeDecorations = baseStyle.includeDecorations !== false;
  const previousFont = ctx.font;
  let layout;
  try {
    layout = layoutTextRuns(runs, Math.max(1, width), baseStyle, (text, style) => {
      ctx.font = richFont(style);
      const shaped = baseStyle.shapeText?.(text, style);
      return shapedTextWidth(shaped, style.fontSize, resolvedTextLetterSpacing(style), ctx, style.textPositionScaleX || 1)
        ?? measureTrackedText(ctx, text, resolvedTextLetterSpacing(style) / (style.textPositionScaleX || 1)) * (style.textPositionScaleX || 1);
    }, {
      textTruncation: baseStyle.textTruncation,
      maxLines: baseStyle.maxLines,
      maxHeight: baseStyle.maxHeight,
      boxHeight: baseStyle.height,
      textWrapStyle: baseStyle.textWrapStyle || 'auto',
      shapeText: baseStyle.shapeText,
      leadingTrimMetrics: baseStyle.leadingTrimMetrics || (style => canvasLeadingTrimMetrics(ctx, style)),
      strictLeadingTrim: baseStyle.strictLeadingTrim,
      textLineMetrics: baseStyle.textLineMetrics || (!ctx.isTextGeometryContext ? ((style, value) => canvasTextLineMetrics(ctx, style, value)) : undefined),
      strictTextLineMetrics: baseStyle.strictTextLineMetrics
    });
  } finally {
    ctx.font = previousFont;
  }
  const { lines } = layout;
  const contentHeight = layout.height;
  let top = y + textVerticalOffset(baseStyle.height ?? contentHeight, contentHeight, baseStyle.verticalAlign);
  for (const line of lines) {
    if (line.marker && !baseStyle.decorationsOnly) drawParagraphMarker(ctx, line.marker, x, top + line.y, richTextStyleForMarker(baseStyle),
      baseStyle.fillOpacity ?? 1, paintMode, baseStyle.shapeText);
    const availableWidth = Math.max(1, width - line.indent);
    const lineAlign = line.align || baseStyle.align || 'left';
    const offsetX = line.indent + (lineAlign === 'center' ? (availableWidth - line.width) / 2 : lineAlign === 'right' ? availableWidth - line.width : 0);
    const scaleX = line.naturalWidth > availableWidth && line.naturalWidth > 0 ? availableWidth / line.naturalWidth : 1;

    ctx.save();
    ctx.translate(x + offsetX, top + line.y);
    ctx.scale(scaleX, 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    if (line.justify) {
      const segments = [];
      for (const part of line.parts) {
        for (const text of part.text.match(/\s+|\S+/gu) || []) segments.push({ text, part });
      }
      let offset = 0;
      const partBounds = new Map();
      let hasTextBefore = false;
      for (const [index, segment] of segments.entries()) {
        const { part, text } = segment;
        const style = part.style;
        ctx.font = richFont(style);
        if (paintMode !== 'stroke') ctx.fillStyle = rgba(style.color, baseStyle.fillOpacity ?? 1);
        const start = offset;
        const shaped = baseStyle.shapeText?.(text, style);
        const top = Number.isFinite(part.topOffset) ? part.topOffset : (style.textPositionTopOffset || 0) - Number(style.baselineShift || 0);
        const baselineY = Number.isFinite(line.baselineY) ? line.baselineY - line.y + (part.baselineOffset || 0) : undefined;
        const placement = { ...style, ...(Number.isFinite(baselineY) ? { textLineBaseline: baselineY } : {}) };
        if (!baseStyle.decorationsOnly && !drawShapedText(ctx, shaped, text, start, top, style.fontSize, resolvedTextLetterSpacing(style), paintMode, null, placement)) {
          drawTrackedTextPaint(ctx, text, start, top, resolvedTextLetterSpacing(style), undefined, paintMode, style);
        }
        offset += shapedTextWidth(shaped, style.fontSize, resolvedTextLetterSpacing(style), ctx, style.textPositionScaleX || 1)
          ?? measureTrackedText(ctx, text, resolvedTextLetterSpacing(style) / (style.textPositionScaleX || 1)) * (style.textPositionScaleX || 1);
        if (segments[index + 1]?.part === part) offset += resolvedTextLetterSpacing(style);
        const bounds = partBounds.get(part) || { start, end: offset, inkContours: [], fallbackInkBounds: [] };
        if (style.textDecorationSkipInk) {
          const contours = nativeInkContoursForShapedText(shaped, { x: start + (style.textPositionOffsetX || 0), y: top, baselineY, fontSize: style.fontSize, letterSpacing: resolvedTextLetterSpacing(style), scaleX: style.textPositionScaleX || 1 });
          if (contours) bounds.inkContours.push(...contours.map(contour => ({ ...contour, group: `${index}:${contour.group}` })));
          else bounds.fallbackInkBounds.push(...canvasTextInkBounds(ctx, text, {
            x: start + (style.textPositionOffsetX || 0), y: top, letterSpacing: resolvedTextLetterSpacing(style), scaleX: style.textPositionScaleX || 1 }));
        }
        bounds.end = offset;
        partBounds.set(part, bounds);
        if (/^\s+$/u.test(text)) {
          const nextText = segments.slice(index + 1).some(next => !/^\s+$/u.test(next.text));
          if (hasTextBefore && nextText) offset += line.justificationExtraSpace * textGraphemes(text).length;
          bounds.end = offset;
        } else hasTextBefore = true;
      }
      for (const part of line.parts) {
        const bounds = partBounds.get(part);
        if (!bounds) continue;
        ctx.font = richFont(part.style);
        if (paintMode !== 'stroke') ctx.fillStyle = rgba(part.style.color, baseStyle.fillOpacity ?? 1);
        const partTop = Number.isFinite(part.topOffset) ? part.topOffset : (part.style.textPositionTopOffset || 0) - Number(part.style.baselineShift || 0);
        const baselineY = Number.isFinite(line.baselineY) ? line.baselineY - line.y + (part.baselineOffset || 0) : undefined;
        if (includeDecorations && paintMode !== 'stroke') drawTextDecoration(ctx, bounds.start, baselineY ?? partTop, bounds.end - bounds.start, part.style.fontSize, part.style.textDecoration, {
          style: part.style, ...bounds, baseline: Number.isFinite(baselineY), inkTop: partTop, glyphBaselineY: baselineY,
          mode: baseStyle.decorationMode, forceGeometryColor: baseStyle.forceDecorationGeometry
        });
      }
      ctx.restore();
      continue;
    }
    for (const part of line.parts) {
      ctx.font = richFont(part.style);
      if (paintMode !== 'stroke') ctx.fillStyle = rgba(part.style.color, baseStyle.fillOpacity ?? 1);
      const shaped = baseStyle.shapeText?.(part.text, part.style);
      const top = Number.isFinite(part.topOffset) ? part.topOffset : (part.style.textPositionTopOffset || 0) - Number(part.style.baselineShift || 0);
      const baselineY = Number.isFinite(line.baselineY) ? line.baselineY - line.y + (part.baselineOffset || 0) : undefined;
      const placement = { ...part.style, ...(Number.isFinite(baselineY) ? { textLineBaseline: baselineY } : {}) };
      if (!baseStyle.decorationsOnly && !drawShapedText(ctx, shaped, part.text, part.offsetX, top,
        part.style.fontSize, resolvedTextLetterSpacing(part.style), paintMode, null, placement)) {
        drawTrackedTextPaint(ctx, part.text, part.offsetX, top, resolvedTextLetterSpacing(part.style), undefined, paintMode, part.style);
      }
      if (includeDecorations && paintMode !== 'stroke') drawTextDecoration(ctx, part.offsetX, baselineY ?? top, part.width, part.style.fontSize, part.style.textDecoration, {
        style: part.style, shaped, text: part.text, letterSpacing: resolvedTextLetterSpacing(part.style),
        baseline: Number.isFinite(baselineY), inkTop: top, glyphBaselineY: baselineY,
        mode: baseStyle.decorationMode, forceGeometryColor: baseStyle.forceDecorationGeometry
      });
    }
    ctx.restore();
  }
  return { lines: lines.map(line => line.parts), height: contentHeight, verticalOffset: textVerticalOffset(baseStyle.height ?? contentHeight, contentHeight, baseStyle.verticalAlign),
    ...(layout.leadingTrim ? { leadingTrim: layout.leadingTrim } : {}), ...(layout.textLineMetrics ? { textLineMetrics: layout.textLineMetrics } : {}) };
}

function richTextStyleForMarker(baseStyle) {
  return {
    fontFamily: baseStyle.fontFamily || 'Arial, sans-serif',
    fontSize: Number(baseStyle.fontSize) || 24,
    fontWeight: baseStyle.fontWeight || 400,
    fontStyle: baseStyle.fontStyle || 'normal',
    fontAxes: baseStyle.fontAxes,
    fontFeatures: baseStyle.fontFeatures,
    letterSpacing: Number(baseStyle.letterSpacing) || 0, letterSpacingUnit: baseStyle.letterSpacingUnit,
    color: baseStyle.color || '#000000'
  };
}

export class SceneRenderer {
  constructor(canvas, getState, onDraw = null, { transparent = false, onMaskError = null, onStrokeError = null, onVectorGeometryReady = null } = {}) {
    this.canvas = canvas;
    this.transparent = Boolean(transparent);
    this.context = canvas.getContext('2d', { alpha: this.transparent, desynchronized: true });
    this.getState = getState;
    this.onDraw = typeof onDraw === 'function' ? onDraw : null;
    this.onMaskError = typeof onMaskError === 'function' ? onMaskError : null;
    this.onStrokeError = typeof onStrokeError === 'function' ? onStrokeError : null;
    this.onVectorGeometryReady = typeof onVectorGeometryReady === 'function' ? onVectorGeometryReady : null;
    this.visiblePreviewKeys = new Set();
    this.frame = 0;
    this.workspacePattern = null;
    this.booleanCache = new Map();
    this.booleanCachePixels = 0;
    this.luminanceMaskErrors = new Set();
    this.booleanStrokeErrors = new Map();
    this.booleanVectorPending = new Map();
    this.booleanVectorFailures = new Map();
    this.booleanVectorRetryTimer = null;
    this.booleanVectorPaths = new Map();
    this.booleanVectorPathBytes = 0;
    this.textPaintSurfaces = { glyph: null, paint: null };
    this.noiseCache = new Map();
    this.noiseCachePixels = 0;
    this.samplingSurface = null;
    this.resizeObserver = new ResizeObserver(() => this.invalidate());
    this.resizeObserver.observe(canvas.parentElement);
    this.invalidate();
  }

  invalidate() {
    if (this.destroyed || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  invalidateImagePreviewCache() {
    this.booleanCache.clear();
    this.booleanCachePixels = 0;
    this.invalidate();
  }

  workspaceBackgroundColor() {
    const view = this.canvas.ownerDocument?.defaultView || globalThis;
    const region = this.canvas.closest?.('.canvas-region') || this.canvas.parentElement;
    const color = region ? view.getComputedStyle?.(region)?.backgroundColor : null;
    return color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent' ? color : '#262a32';
  }

  workspaceBackgroundPattern(dpr) {
    const size = Math.max(1, Math.round(24 * dpr));
    if (this.workspacePattern?.size === size) return this.workspacePattern.pattern;
    const tile = this.canvas.ownerDocument?.createElement?.('canvas');
    if (!tile || typeof this.context.createPattern !== 'function') return null;
    tile.width = size;
    tile.height = size;
    const patternContext = tile.getContext('2d');
    if (!patternContext) return null;
    patternContext.fillStyle = 'rgba(255,255,255,.11)';
    patternContext.beginPath();
    patternContext.arc(size / 2, size / 2, .8 * size / 24, 0, Math.PI * 2);
    patternContext.fill();
    const pattern = this.context.createPattern(tile, 'repeat');
    this.workspacePattern = { size, tile, pattern };
    return pattern;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return { width, height, dpr, cssWidth: rect.width, cssHeight: rect.height };
  }

  drawSmartAnimateImageTransition(ctx, transition, assets, state, x, y, width, height) {
    if (!transition?.from || !transition?.to || width <= 0 || height <= 0) return false;
    const progress = Math.max(0, Math.min(1, Number(transition.progress) || 0));
    const resolveEndpoint = endpoint => {
      const status = state.imageStatus?.get(endpoint.previewKey) || '';
      const preview = state.previews?.get(endpoint.previewKey);
      if (preview && state.previewAssetIds?.get(endpoint.previewKey) === endpoint.assetId
        && state.previewSignatures?.get(endpoint.previewKey) === endpoint.signature
        && (status.startsWith('Ready') || status.startsWith('Updated'))) {
        return { image: preview, transforms: null };
      }
      if (endpoint.sourceRenderable) {
        const bitmap = assets.get(endpoint.assetId)?.bitmap;
        if (bitmap) return { image: bitmap, transforms: endpoint.transforms || {} };
      }
      return null;
    };
    const fromImage = resolveEndpoint(transition.from);
    const toImage = resolveEndpoint(transition.to);
    if (!fromImage && !toImage) return false;

    const transform = ctx.getTransform?.();
    const requestedScale = transform ? Math.hypot(transform.a, transform.b)
      : (globalThis.devicePixelRatio || 1) * Math.max(.08, state.zoom || 1);
    const dimensions = booleanSurfaceDimensions(width, height, requestedScale);
    this.imageTransitionSurface = resizeTextSurface(this.imageTransitionSurface, dimensions.width, dimensions.height);
    const surfaceContext = this.imageTransitionSurface?.getContext('2d');
    if (!surfaceContext) return false;
    surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
    surfaceContext.globalAlpha = 1;
    surfaceContext.globalCompositeOperation = 'source-over';
    surfaceContext.clearRect(0, 0, dimensions.width, dimensions.height);
    surfaceContext.setTransform(dimensions.width / width, 0, 0, dimensions.height / height, 0, 0);

    const drawEndpoint = (resolved, endpoint) => {
      if (resolved.transforms) return drawImageWithTransforms(surfaceContext, resolved.image, 0, 0, width, height, endpoint.fit, resolved.transforms);
      return drawFittedImage(surfaceContext, resolved.image, 0, 0, width, height, endpoint.fit);
    };
    if (fromImage && toImage) {
      const fromWeight = Math.max(0, Number(transition.from.opacity) || 0) * (1 - progress);
      const toWeight = Math.max(0, Number(transition.to.opacity) || 0) * progress;
      const totalWeight = fromWeight + toWeight;
      if (totalWeight <= 0) return false;
      surfaceContext.globalCompositeOperation = 'lighter';
      surfaceContext.globalAlpha = fromWeight / totalWeight;
      drawEndpoint(fromImage, transition.from);
      surfaceContext.globalAlpha = toWeight / totalWeight;
      drawEndpoint(toImage, transition.to);
    } else {
      // A preview may be evicted while a presentation is running. Use the
      // one verified endpoint that remains, at full weight, rather than
      // exposing a stale preview or producing a transparent hole.
      const endpoint = fromImage ? transition.from : transition.to;
      const resolved = fromImage || toImage;
      surfaceContext.globalCompositeOperation = 'source-over';
      surfaceContext.globalAlpha = 1;
      drawEndpoint(resolved, endpoint);
    }
    surfaceContext.globalAlpha = 1;
    surfaceContext.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.imageTransitionSurface, x, y, width, height);
    return true;
  }

  /** Sample the document scene on a private local surface, without editor overlays. */
  sampleColor(clientX, clientY) {
    const state = this.getState();
    const { width, height, dpr } = this.resize();
    const point = canvasPixelFromClientPoint({
      clientX, clientY, rect: this.canvas.getBoundingClientRect(), pixelWidth: width, pixelHeight: height
    });
    const page = state.document.pages.find(item => item.id === state.document.activePageId);
    if (!point || !page) return null;
    this.samplingSurface = resizeCanvasSurface(this.samplingSurface, width, height, () => (
      typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
    ));
    const context = this.samplingSurface.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new Error('This browser cannot sample the local design canvas.');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = this.workspaceBackgroundColor();
    context.fillRect(0, 0, width, height);
    context.setTransform(dpr * state.zoom, 0, 0, dpr * state.zoom, dpr * state.panX, dpr * state.panY);
    for (const node of page.children) {
      this.drawNode(context, node, 0, 0, state.assets, false, false, {
        outlineMode: false, showLayoutGuides: false, showEmptyFrameHint: false, showImageLoadingPlaceholder: false, includeSlices: false
      });
    }
    return sampleColorAt(context.getImageData(point.x, point.y, 1, 1), 0, 0);
  }

  draw() {
    const state = this.getState();
    this.pruneBooleanVectorRenderScope(state.document);
    const { width, height, dpr, cssWidth, cssHeight } = this.resize();
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!this.transparent) {
      // The canvas element covers .canvas-region's CSS background, so painting
      // a light gray here accidentally erased the dark workspace surface and
      // made new neutral shapes almost disappear. Read the active theme color
      // from the region so CSS remains the single source of truth.
      ctx.fillStyle = this.workspaceBackgroundColor();
      ctx.fillRect(0, 0, width, height);
      const pattern = this.workspaceBackgroundPattern(dpr);
      if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(0, 0, width, height); }
    }
    const page = state.document.pages.find(item => item.id === state.document.activePageId);
    if (!page) { this.visiblePreviewKeys.clear(); this.onDraw?.(state, { cssWidth, cssHeight, dpr }); return; }
    const zoom = Math.max(.08, Number(state.zoom) || 1);
    const previousVisiblePreviewKeys = this.visiblePreviewKeys;
    this.visiblePreviewKeys = collectVisibleImagePreviewKeys(page, state.document, {
      left: -state.panX / zoom,
      top: -state.panY / zoom,
      right: (cssWidth - state.panX) / zoom,
      bottom: (cssHeight - state.panY) / zoom
    }, { presentationScrollOffsets: state.presentationScrollOffsets });
    for (const previewKey of this.visiblePreviewKeys) {
      state.touchImagePreviewSource?.(previewKey);
      const preview = state.previews?.get(previewKey);
      if (preview) {
        // Map order is the preview LRU order. Drawing makes this entry recent.
        state.previews.delete(previewKey);
        state.previews.set(previewKey, preview);
      }
      if (!previousVisiblePreviewKeys.has(previewKey) && state.previewDeferredKeys?.has(previewKey)) {
        state.requestDeferredPreview?.(previewKey);
      }
    }
    ctx.setTransform(dpr * state.zoom, 0, 0, dpr * state.zoom, dpr * state.panX, dpr * state.panY);
    for (const node of page.children) this.drawNode(ctx, node, 0, 0, state.assets);
    if (state.shapeBuilder) drawShapeBuilderRegions(ctx, state.shapeBuilder.previewContours, state.zoom);
    this.drawSelection(ctx, page.children, state.shapeBuilder ? [] : state.selectedIds, 0, 0);
    this.drawRemotePresence(ctx, page, state);
    if (state.componentPropertyHighlightNodeIds?.length) {
      this.drawComponentPropertyHighlights(ctx, page.children, state.componentPropertyHighlightNodeIds);
    }
    drawAlignmentGuides(ctx, state.smartGuides, state.zoom);
    if (!state.presenting) this.drawCommentPins(ctx, page, state, cssWidth, cssHeight);
    if (state.inspectorTab === 'prototype') this.drawPrototypeConnections(ctx, page, state);
    if (state.draftNode) this.drawNode(ctx, state.draftNode, 0, 0, state.assets, true);
    if (state.penDraft) {
      let transform = null;
      const entry = state.penDraft.networkNodeId ? findNode(state.document, state.penDraft.networkNodeId) : null;
      if (entry) {
        const node = entry.node;
        const origin = entry.parents.reduce((point, parent) => ({ x: point.x + parent.x, y: point.y + parent.y }), { x: node.x, y: node.y });
        const center = { x: origin.x + node.width / 2, y: origin.y + node.height / 2 };
        const angle = (node.rotation || 0) * Math.PI / 180;
        transform = point => {
          const dx = point.x - center.x; const dy = point.y - center.y;
          return { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
        };
      }
      this.drawPenDraft(ctx, state.penDraft, state.penHover, state.zoom, transform);
    }
    if (state.pencilDraft) this.drawPencilDraft(ctx, state.pencilDraft, state.zoom);
    if (state.interaction?.kind === 'lasso' && state.interaction.points?.length) {
      const points = state.interaction.points;
      ctx.save();
      ctx.lineWidth = 1.5 / state.zoom;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = BLUE;
      ctx.fillStyle = 'rgba(13,153,255,.08)';
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      if (points.length >= 3) {
        ctx.closePath();
        ctx.fill('evenodd');
      }
      ctx.stroke();
      ctx.restore();
    }
    if (state.marquee) {
      const x = Math.min(state.marquee.x1, state.marquee.x2);
      const y = Math.min(state.marquee.y1, state.marquee.y2);
      const w = Math.abs(state.marquee.x2 - state.marquee.x1);
      const h = Math.abs(state.marquee.y2 - state.marquee.y1);
      ctx.save(); ctx.fillStyle = 'rgba(13,153,255,.10)'; ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / state.zoom;
      const crossing = state.marquee.x2 < state.marquee.x1;
      ctx.setLineDash(crossing ? [4 / state.zoom, 3 / state.zoom] : []);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.restore();
    }
    if (!state.presenting && state.showRulers && Array.isArray(page.guides)) this.drawRulerGuides(ctx, page.guides, state, cssWidth, cssHeight);
    this.onDraw?.(state, { cssWidth, cssHeight, dpr });
  }

  drawRulerGuides(ctx, guides, state, cssWidth, cssHeight) {
    ctx.save();
    ctx.lineWidth = 1 / Math.max(.08, state.zoom);
    ctx.setLineDash([]);
    for (const guide of guides) {
      if (!guide || (guide.axis !== 'x' && guide.axis !== 'y') || !Number.isFinite(guide.position)) continue;
      const selected = guide.id === state.selectedRulerGuideId;
      const coordinate = guide.position;
      ctx.strokeStyle = 'rgba(255,255,255,.92)';
      ctx.lineWidth = (selected ? 3 : 2) / Math.max(.08, state.zoom);
      ctx.beginPath();
      if (guide.axis === 'x') { ctx.moveTo(coordinate, -state.panY / state.zoom); ctx.lineTo(coordinate, (cssHeight - state.panY) / state.zoom); }
      else { ctx.moveTo(-state.panX / state.zoom, coordinate); ctx.lineTo((cssWidth - state.panX) / state.zoom, coordinate); }
      ctx.stroke();
      ctx.strokeStyle = selected ? '#006fc4' : '#0d99ff';
      ctx.lineWidth = 1 / Math.max(.08, state.zoom);
      ctx.beginPath();
      if (guide.axis === 'x') { ctx.moveTo(coordinate, -state.panY / state.zoom); ctx.lineTo(coordinate, (cssHeight - state.panY) / state.zoom); }
      else { ctx.moveTo(-state.panX / state.zoom, coordinate); ctx.lineTo((cssWidth - state.panX) / state.zoom, coordinate); }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawNode(ctx, node, parentX, parentY, assets, draft = false, maskMode = false, renderOptions = {}) {
    const state = this.getState();
    const document = state.document;
    if (!getNodePropertyValue(document, node, 'visible')) return;
    if (node.type === 'slice' && (state.presenting || renderOptions.includeSlices === false)) return;
    const motionValues = renderOptions.ignoreMotionPreview ? null : state.motionPreview?.get(node.id);
    const resolvedMotion = renderOptions.motionResolvedNodeId === node.id;
    node = {
      ...node,
      ...(!resolvedMotion ? getNodeGeometry(document, node) : {}),
      ...(!resolvedMotion && node.textPath ? { textPath: getNodeTextPath(document, node) } : {}),
      ...(!resolvedMotion ? motionValues || {} : {}),
      ...(node.type === 'slice' ? { rotation: 0 } : {})
    };
    if (node.type === 'boolean' && node.booleanGeometry === 'vector') {
      const resolveNode = resolved => renderOptions.ignoreMotionPreview ? resolved
        : { ...resolved, ...(state.motionPreview?.get(resolved.id) || {}) };
      try { node = renderOptions.booleanGeometryPlan
        ? projectBooleanVectorPaintTree(document, node, renderOptions.booleanGeometryPlan)
        : this.getRenderedBooleanVectorPath(node, { resolveNode }); }
      catch (error) {
        if (['BOOLEAN_VECTOR_PENDING', 'BOOLEAN_TEXT_PENDING'].includes(error.code) && !renderOptions.onRenderError) {
          this.loadBooleanVectorPath(node, { resolveNode });
        } else this.reportBooleanStrokeError(node, error, renderOptions);
        return;
      }
    }
    if (node.type === 'slice') {
      const x = parentX + node.x; const y = parentY + node.y;
      const width = node.width; const height = node.height;
      const cx = x + width / 2; const cy = y + height / 2;
      const inverseZoom = 1 / Math.max(.08, state.zoom || 1);
      ctx.save();
      if (node.rotation) { ctx.translate(cx, cy); ctx.rotate(node.rotation * Math.PI / 180); ctx.translate(-cx, -cy); }
      if (!(renderOptions.outlineMode ?? state.outlineMode)) {
        ctx.fillStyle = 'rgba(13,153,255,.055)';
        ctx.fillRect(x, y, width, height);
      }
      ctx.setLineDash([6 * inverseZoom, 4 * inverseZoom]);
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = inverseZoom;
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
      ctx.fillStyle = BLUE;
      ctx.font = `600 ${11 * inverseZoom}px Inter, Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(node.name || 'Slice', x, y - 4 * inverseZoom);
      ctx.restore();
      return;
    }
    const effects = (node.effects || []).filter(effect => effect.visible);
    const outline = !maskMode && !state.presenting && (renderOptions.outlineMode ?? state.outlineMode);
    const blendMode = node.blendMode || 'normal';
    const compositeBypassed = renderOptions.compositeBypassNodeId === node.id;
    const cropEditing = !state.presenting && state.imageCropMode && state.imageCropOverlay?.nodeId === node.id;
    const backdropEffect = firstBackdropEffect(effects);
    if (backdropEffect && renderOptions.backgroundBlurBypassNodeId !== node.id
      && !draft && !maskMode && !outline && !cropEditing && typeof ctx.filter === 'string') {
      if (backdropEffect.type === 'background-blur') {
        this.drawNodeWithBackgroundBlur(ctx, node, parentX, parentY, assets, [backdropEffect], renderOptions);
        return;
      }
      if (glassVisibleForRenderedNode(node, document)) {
        this.drawNodeWithGlass(ctx, node, parentX, parentY, assets, backdropEffect, renderOptions);
        return;
      }
    }
    const hasForegroundEffects = effects.some(effect => !['glass', 'background-blur'].includes(effect.type));
    const opacity = (!resolvedMotion ? motionValues?.opacity : undefined) ?? getNodePropertyValue(document, node, 'opacity');
    const isolateLayerOpacity = (node.booleanGeometry === 'vector' || node.type === 'text'
      || node.type === 'group' && node.effectPaintMode === 'staged') && Number(opacity ?? 1) < 1
      && renderOptions.effectBypassNodeId !== node.id;
    if ((hasForegroundEffects && renderOptions.effectBypassNodeId !== node.id || blendMode !== 'normal' && !compositeBypassed || isolateLayerOpacity)
      && !draft && !maskMode && !outline && !cropEditing && (typeof ctx.filter === 'string' || isolateLayerOpacity)) {
      this.drawNodeWithEffects(ctx, node, parentX, parentY, assets, effects, renderOptions);
      return;
    }
    const vectorMask = maskMode === 'vector';
    const radius = node.cornerRadii || getNodePropertyValue(document, node, 'radius');
    const cornerSmoothing = node.cornerSmoothing || 0;
    const x = parentX + node.x; const y = parentY + node.y;
    const width = node.width; const height = node.height;
    const cx = x + width / 2; const cy = y + height / 2;
    const effectPaintStage = !renderOptions.effectPaintStageNodeId || renderOptions.effectPaintStageNodeId === node.id
      ? renderOptions.effectPaintStage : undefined;
    const drawFillPaint = effectPaintStage !== 'stroke' && !(node.type === 'group' && node.effectPaintMode === 'staged');
    const drawStrokePaint = effectPaintStage !== 'fill';
    ctx.save();
    if (!vectorMask && blendMode !== 'normal' && !compositeBypassed) ctx.globalCompositeOperation = canvasBlendOperation(blendMode);
    if (!vectorMask) ctx.globalAlpha *= opacity ?? 1;
    if (node.affineTransform) {
      const { a, b, c, d } = node.affineTransform;
      ctx.translate(x, y);
      ctx.transform(a, b, c, d, 0, 0);
      ctx.translate(-x, -y);
    }
    if (node.rotation) { ctx.translate(cx, cy); ctx.rotate(node.rotation * Math.PI / 180); ctx.translate(-cx, -cy); }
    if (!draft && !state.presenting && (renderOptions.outlineMode ?? state.outlineMode)) {
      this.drawNodeOutline(ctx, node, x, y, assets, renderOptions);
      ctx.restore();
      return;
    }
    if (node.type === 'boolean') {
      this.drawBooleanGroup(ctx, node, x, y, assets, maskMode, renderOptions);
      if (draft) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.setLineDash([4, 3]); ctx.stroke(); }
      ctx.restore();
      return;
    }
    if (node.type === 'group' && node.mask && !maskMode) {
      this.drawMaskGroup(ctx, node, x, y, assets, renderOptions);
      if (draft) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.setLineDash([4, 3]); ctx.stroke(); }
      ctx.restore();
      return;
    }
    if (maskMode && node.type === 'text') {
      drawTextMask(ctx, node, document, x, y, width, height, state.shapeLocalTextRun, maskMode);
      if (vectorMask) drawStrokeStack(ctx, node, document, x, y, width, height, null, maskMode,
        outlineContext => drawTextLayerContent(outlineContext, node, document, x, y, width, height, {
          colorOverride: '#ffffff', fillOpacity: 1, paintMode: 'stroke', includeDecorations: false,
          overrideRunColors: true, shapeText: state.shapeLocalTextRun
        }), glyphContext => drawTextLayerContent(glyphContext, node, document, x, y, width, height, {
          colorOverride: '#ffffff', fillOpacity: 1, includeDecorations: false, overrideRunColors: true, shapeText: state.shapeLocalTextRun
        }), 1, localTextInkBounds(document, node, state.shapeLocalTextRun, { forStroke: true }));
      ctx.restore();
      return;
    }
    if (maskMode && node.type === 'image') {
      if (node.__smartAnimateImageTransition) {
        ctx.save();
        ctx.beginPath();
        roundedRect(ctx, x, y, width, height, radius || 0, cornerSmoothing);
        ctx.clip();
        this.drawSmartAnimateImageTransition(ctx, node.__smartAnimateImageTransition, assets, state, x, y, width, height);
        ctx.restore();
        ctx.restore();
        return;
      }
      const liveTransformSource = node.__smartAnimateLiveImageTransforms ? assets.get(node.assetId)?.bitmap : null;
      const image = liveTransformSource || imageForNode(node, assets, state);
      if (image) {
        ctx.save();
        ctx.beginPath();
        roundedRect(ctx, x, y, width, height, radius || 0, cornerSmoothing);
        ctx.clip();
        drawImageWithFitMode(ctx, image, node, assets, node.assetId, x, y, width, height,
          node.fit, node.scalingFactor, node.transforms, Boolean(liveTransformSource));
        ctx.restore();
      }
      ctx.restore();
      return;
    }
    if (maskMode && ['group', 'frame', 'section'].includes(node.type)) {
      if (width > 0 && height > 0) {
        const transform = ctx.getTransform?.();
        const requestedScale = transform ? Math.hypot(transform.a, transform.b)
          : (window.devicePixelRatio || 1) * Math.max(.08, state.zoom || 1);
        const { width: pixelWidth, height: pixelHeight } = booleanSurfaceDimensions(width, height, requestedScale);
        const surface = typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(pixelWidth, pixelHeight)
          : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
        const surfaceContext = surface.getContext('2d');
        if (surfaceContext) {
          surfaceContext.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
          const variableBindings = { ...(node.variableBindings || {}) };
          for (const property of ['x', 'y', 'width', 'height', 'rotation', 'opacity']) delete variableBindings[property];
          const localNode = { ...node, x: 0, y: 0, rotation: 0, opacity: 1, blendMode: 'normal', variableBindings };
          this.drawNode(surfaceContext, localNode, 0, 0, assets, false, false, {
            ...renderOptions, ignoreMotionPreview: true, outlineMode: false,
            showEmptyFrameHint: false, showLayoutGuides: false, includeSlices: false
          });
          ctx.drawImage(surface, x, y, width, height);
        }
      }
      ctx.restore();
      return;
    }
    ctx.beginPath();
    switch (node.type) {
      case 'frame':
      case 'section':
      case 'group':
      case 'rectangle':
        roundedRect(ctx, x, y, width, height, radius || 0, cornerSmoothing);
        break;
      case 'ellipse':
        traceEllipseArc(ctx, node, x, y, width, height);
        break;
      case 'line':
        if (node.lineReverseY === true) { ctx.moveTo(x, y + height); ctx.lineTo(x + width, y); }
        else { ctx.moveTo(x, y); ctx.lineTo(x + width, y + height); }
        break;
      case 'star':
        traceRoundedPolygonPath(ctx, x, y, regularShapeVertices('star', width, height, node.points, node.innerRadius ?? 0.48), node.vertexRadii || Number(radius) || 0, cornerSmoothing);
        break;
      case 'polygon':
        traceRoundedPolygonPath(ctx, x, y, regularShapeVertices('polygon', width, height, node.points), node.vertexRadii || Number(radius) || 0, cornerSmoothing);
        break;
      case 'path':
        traceVectorPath(ctx, node, x, y);
        break;
      case 'network':
        traceVectorNetworkEdges(ctx, node, x, y);
        break;
      default:
        ctx.rect(x, y, width, height);
    }

    if (node.type === 'image') {
      if (drawFillPaint && node.__smartAnimateImageTransition) {
        ctx.save();
        ctx.beginPath(); roundedRect(ctx, x, y, width, height, radius || 0, cornerSmoothing); ctx.clip();
        const drawn = this.drawSmartAnimateImageTransition(ctx, node.__smartAnimateImageTransition, assets, state, x, y, width, height);
        if (!drawn && renderOptions.showImageLoadingPlaceholder !== false) {
          ctx.fillStyle = '#d9d9d9'; ctx.fill();
          ctx.fillStyle = '#8a8a8a'; ctx.font = '12px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('Updating image…', cx, cy);
        }
        ctx.restore();
      } else if (drawFillPaint) {
        const asset = assets.get(node.assetId);
        const cropOverlay = cropEditing ? state.imageCropOverlay : null;
        const sourceImage = cropOverlay ? asset?.bitmap : null;
        const liveTransformSource = node.__smartAnimateLiveImageTransforms ? asset?.bitmap : null;
        const image = sourceImage || liveTransformSource || imageForNode(node, assets, state);
        if (image) {
          if (cropOverlay && sourceImage) {
            drawCropSourceImage(ctx, sourceImage, x, y, cropOverlay.virtualBounds, cropOverlay.rotation,
              cropOverlay.flipHorizontal, cropOverlay.flipVertical);
            const cropPreview = state.previews?.get(node.id);
            const previewAssetId = state.previewAssetIds?.get(node.id);
            const previewStatus = state.imageStatus?.get(node.id) || '';
            const previewReady = previewStatus.startsWith('Ready') || previewStatus.startsWith('Updated');
            if (cropPreview && previewAssetId === node.assetId && previewReady) {
              drawCropPreview(ctx, cropPreview, x, y, width, height, node.fit, radius || 0, cornerSmoothing);
            }
          }
          else {
            ctx.save();
            ctx.beginPath(); roundedRect(ctx, x, y, width, height, radius || 0, cornerSmoothing); ctx.clip();
            drawImageWithFitMode(ctx, image, node, assets, node.assetId, x, y, width, height,
              node.fit, node.scalingFactor, node.transforms, Boolean(liveTransformSource));
            ctx.restore();
          }
        } else {
          if (renderOptions.showImageLoadingPlaceholder !== false) {
            ctx.fillStyle = '#d9d9d9'; ctx.fill();
            ctx.fillStyle = '#8a8a8a'; ctx.font = '12px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const imageSettings = imagePreviewSettingsForNode(node, node.id, node.assetId);
            const needsRenderedPreview = imagePreviewRequiresRenderedPixels(imageSettings)
              && !imagePreviewMatchesSettings(imageSettings, state.previewAssetIds?.get(node.id), state.previewSignatures?.get(node.id));
            const previewPaused = state.previewDeferredKeys?.has(node.id);
            ctx.fillText(previewPaused ? 'Preview paused' : needsRenderedPreview ? 'Updating preview…' : 'Loading image…', cx, cy);
          }
        }
      }
      if (drawStrokePaint) drawStrokeStack(ctx, node, document, x, y, width, height, pathContext => roundedRect(pathContext, x, y, width, height, radius, cornerSmoothing), maskMode);
    } else if (node.type === 'text') {
      if (drawFillPaint && Array.isArray(node.fills) && !maskMode) {
        const surfaces = this.textPaintSurfaces || (this.textPaintSurfaces = { glyph: null, paint: null });
        const rendered = drawTextFillStack(ctx, node, document, assets, state, x, y, width, height, motionValues, surfaces, this);
        if (!rendered && node.fills.length) {
          // Keep text visible if a browser cannot allocate an auxiliary surface.
          drawTextLayerContent(ctx, node, document, x, y, width, height, { shapeText: state.shapeLocalTextRun });
        }
        if (rendered || !node.fills.length) drawTextLayerContent(ctx, node, document, x, y, width, height, {
          shapeText: state.shapeLocalTextRun, decorationsOnly: true, decorationMode: 'independent'
        });
      } else if (drawFillPaint && !Array.isArray(node.fills)) {
        drawTextLayerContent(ctx, node, document, x, y, width, height, { shapeText: state.shapeLocalTextRun });
      }
      if (drawStrokePaint) {
        drawStrokeStack(ctx, node, document, x, y, width, height, null, maskMode,
          outlineContext => drawTextLayerContent(outlineContext, node, document, x, y, width, height, {
            fillOpacity: 1, paintMode: 'stroke', includeDecorations: false, shapeText: state.shapeLocalTextRun
          }), glyphContext => drawTextLayerContent(glyphContext, node, document, x, y, width, height, {
            colorOverride: '#ffffff', fillOpacity: 1, includeDecorations: false, overrideRunColors: true, shapeText: state.shapeLocalTextRun
          }), 1, localTextInkBounds(document, node, state.shapeLocalTextRun, { forStroke: true }));
      }
    } else if (node.type === 'network') {
      if (vectorMask) {
        const hasVisibleFill = drawFillPaint && fillStackForNode(node).some(fill => fill.visible);
        if (hasVisibleFill) for (const face of node.faces || []) {
          ctx.beginPath();
          if (traceVectorNetworkFace(ctx, node, face, x, y)) {
            ctx.fillStyle = '#ffffff';
            ctx.fill();
          }
        }
      } else if (drawFillPaint) {
      const fills = fillStackForNode(node);
      for (const face of node.faces || []) {
        // Keep the original one-fill face behavior for old files: an image fill
        // always wins over a face color, while gradients yield to explicit
        // face colors. New stacks only let face colors override a solid first
        // paint; they must not replace an image or gradient paint.
        if (!Array.isArray(node.fills)) {
          const color = getNodeColor(document, node, 'fill');
          const liveSource = node.__smartAnimateLiveImageFill && node.imageFill ? assets.get(node.imageFill.assetId)?.bitmap : null;
          const fillImage = liveSource || (node.imageFill ? imageForNode(node, assets, state, node.imageFill.assetId) : null);
          const faceFill = face.fill ?? color;
          if ((!faceFill || faceFill === 'transparent') && !node.fillGradient && !node.imageFill) continue;
          ctx.beginPath();
          if (traceVectorNetworkFace(ctx, node, face, x, y)) {
            const gradient = !face.fill ? createGradientPaint(ctx, node.fillGradient, x, y, width, height) : null;
            ctx.save();
            ctx.globalAlpha *= (node.fillOpacity ?? 1) * (face.fillOpacity ?? 1);
            if (node.imageFill && (fillImage || node.__smartAnimateImageFillTransition)) {
              ctx.clip();
              if (node.__smartAnimateImageFillTransition) this.drawSmartAnimateImageTransition(ctx, node.__smartAnimateImageFillTransition, assets, state, x, y, width, height);
              else drawImageWithFitMode(ctx, liveSource || fillImage, node, assets, node.imageFill.assetId, x, y, width, height,
                node.imageFill.fit, node.imageFill.scalingFactor, node.imageFill.transforms, Boolean(liveSource));
            }
            else { ctx.fillStyle = gradient || rgba(faceFill || color || '#000000', 1); ctx.fill(); }
            ctx.restore();
          }
          continue;
        }
        for (let index = 0; index < fills.length; index += 1) {
          const fill = fills[index];
          const animatedFill = fill.type === 'solid' && index === fills.findIndex(item => item.type === 'solid');
          const fillOpacity = animatedFill && Number.isFinite(motionValues?.fillOpacity) ? motionValues.fillOpacity : fill.opacity;
          if (!fill.visible || fillOpacity <= 0) continue;
          ctx.beginPath();
          if (!traceVectorNetworkFace(ctx, node, face, x, y)) continue;
          ctx.save();
          if (!maskMode && fill.blendMode && fill.blendMode !== 'normal') ctx.globalCompositeOperation = canvasBlendOperation(fill.blendMode);
          ctx.globalAlpha *= fillOpacity * (face.fillOpacity ?? 1);
          if (face.fill != null && index === 0 && fill.type === 'solid') {
            ctx.fillStyle = rgba(face.fill, 1); ctx.fill();
          } else if (fill.type === 'solid') {
            const color = animatedFill && typeof motionValues?.fillColor === 'string'
              ? motionValues.fillColor : fillLayerColor(document, node, fill, index);
            if (color && color !== 'transparent') { ctx.fillStyle = rgba(color, 1); ctx.fill(); }
          } else if (gradientTypes.has(fill.type)) {
            const paint = createGradientPaint(ctx, fill.gradient, x, y, width, height);
            if (paint) { ctx.fillStyle = paint; ctx.fill(); }
          } else if (fill.type === 'image') {
            const imageTransition = fill.__smartAnimateImageTransition;
            if (imageTransition) {
              ctx.clip();
              this.drawSmartAnimateImageTransition(ctx, imageTransition, assets, state, x, y, width, height);
              ctx.restore();
              continue;
            }
            const liveSource = fill.__smartAnimateLiveImageFill ? assets.get(fill.imageFill.assetId)?.bitmap : null;
            const image = liveSource || imageForNode(node, assets, state, fill.imageFill.assetId, imagePreviewKey(node.id, fill.id));
            if (image) {
              ctx.clip();
              drawImageWithFitMode(ctx, image, node, assets, fill.imageFill.assetId, x, y, width, height,
                fill.imageFill.fit, fill.imageFill.scalingFactor, fill.imageFill.transforms, Boolean(liveSource));
            }
          }
          ctx.restore();
        }
      }
      }
      if (drawStrokePaint) drawStrokeStack(ctx, node, document, x, y, width, height,
        pathContext => traceVectorNetworkEdges(pathContext, node, x, y), maskMode);
    } else {
      if (drawFillPaint && node.type !== 'line' && (node.type !== 'path' || pathHasClosedContour(node))) drawFillStack(ctx, node, assets, state, x, y, width, height, null, motionValues, maskMode, 0, null, this);
      if (drawStrokePaint) drawStrokeStack(ctx, node, document, x, y, width, height, null, maskMode);
    }

    if (draft) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.setLineDash([4, 3]); ctx.stroke(); }
    if (node.children?.length) {
      const paintPlan = state.presentationLayerPlan?.frameId === node.id
        ? state.presentationLayerPlan.entries
        : null;
      if (Array.isArray(paintPlan)) {
        const entryByNode = new Map(paintPlan.map(entry => [entry.node, entry]));
        const presentationAncestors = renderOptions.presentationAncestors || [];
        for (const child of presentationChildrenInPaintOrder(node)) {
          if (!paintsChildInEffectStage(node, child, renderOptions)) continue;
          const entry = entryByNode.get(child);
          if (!entry) continue;
          const parentFrame = entry.clipFrame || node;
          const childGeometry = { ...child, ...getNodeGeometry(document, child) };
          ctx.save();
          ctx.globalAlpha *= stagedChildFillOpacity(node, child, document);
          if (entry.frameTransform) {
            const transform = entry.frameTransform;
            ctx.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
          }
          if (entry.transitionMotion) {
            const opacity = Number.isFinite(entry.transitionMotion.opacity)
              ? Math.max(0, Math.min(1, entry.transitionMotion.opacity))
              : 1;
            ctx.globalAlpha = (Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1) * opacity;
            translateContextByScreenPixels(ctx, this.canvas, entry.transitionMotion.x || 0, entry.transitionMotion.y || 0, state.zoom);
          }
          const clipRadius = parentFrame.cornerRadii || getNodePropertyValue(document, parentFrame, 'radius') || 0;
          clipNodeContents(ctx, parentFrame, x, y, clipRadius, parentFrame.cornerSmoothing || 0);
          const scrollOffset = applyPresentationScrollOffset(ctx, state, parentFrame);
          const stickyScrollContext = scrollContextForChildren(parentFrame, presentationAncestors, scrollOffset, renderOptions.stickyScrollContext);
          const childRenderOptions = renderOptionsForChildren({ ...renderOptions,
            ...(renderOptions.effectPaintStageNodeId === node.id ? { effectPaintStage: undefined, effectPaintStageNodeId: undefined } : {})
          }, parentFrame, stickyScrollContext);
          const effectiveOffset = scrollOffsetForPresentationChild(
            parentFrame, childGeometry, scrollOffset, stickyScrollContext, presentationAncestors
          );
          const compensationX = scrollOffset.x - effectiveOffset.x;
          const compensationY = scrollOffset.y - effectiveOffset.y;
          if (compensationX || compensationY) ctx.translate(compensationX, compensationY);
          this.drawNode(ctx, child, x, y, assets, draft, false, childRenderOptions);
          ctx.restore();
        }
      } else {
        clipNodeContents(ctx, node, x, y, radius);
        const scrollOffset = applyPresentationScrollOffset(ctx, state, node);
        const presentationAncestors = renderOptions.presentationAncestors || [];
        const stickyScrollContext = scrollContextForChildren(node, presentationAncestors, scrollOffset, renderOptions.stickyScrollContext);
        const childRenderOptions = renderOptionsForChildren(renderOptions, node, stickyScrollContext);
        for (const child of presentationChildrenInPaintOrder(node)) {
          if (!paintsChildInEffectStage(node, child, renderOptions)) continue;
          const fillOpacity = stagedChildFillOpacity(node, child, document);
          if (fillOpacity !== 1) { ctx.save(); ctx.globalAlpha *= fillOpacity; }
          const childGeometry = { ...child, ...getNodeGeometry(document, child) };
          const effectiveOffset = scrollOffsetForPresentationChild(
            node, childGeometry, scrollOffset, stickyScrollContext, presentationAncestors
          );
          const compensationX = scrollOffset.x - effectiveOffset.x;
          const compensationY = scrollOffset.y - effectiveOffset.y;
          if (compensationX || compensationY) {
            ctx.save();
            ctx.translate(compensationX, compensationY);
            this.drawNode(ctx, child, x, y, assets, draft, false, childRenderOptions);
            ctx.restore();
          } else this.drawNode(ctx, child, x, y, assets, draft, false, childRenderOptions);
          if (fillOpacity !== 1) ctx.restore();
        }
      }
    }
    if (node.type === 'frame' && !node.children.length && !draft && renderOptions.showEmptyFrameHint !== false) {
      ctx.strokeStyle = 'rgba(30,30,30,.14)'; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.strokeRect(x, y, width, height);
    }
    if (node.type === 'frame' && !draft && !state.presenting && renderOptions.showLayoutGuides !== false) this.drawLayoutGuides(ctx, node, x, y, state);
    ctx.restore();
  }

  applyInnerShadows(surface, effects, rasterScale, pixelWidth, pixelHeight, alphaSurface = surface, node = null) {
    const innerShadows = effects.filter(effect => effect?.type === 'inner-shadow' && effect.visible !== false && effect.opacity > 0);
    if (!innerShadows.length) return;
    const overlay = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(pixelWidth, pixelHeight)
      : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
    const overlayContext = overlay.getContext('2d');
    const surfaceContext = surface.getContext('2d');
    if (!overlayContext || !surfaceContext || !alphaSurface) return;
    const spreadMasks = new Map();
    for (const effect of innerShadows) {
      // Figma retains spread values on unsupported layers but does not apply
      // them there. Keep inner and drop shadows on the same eligibility path.
      const spread = supportsShadowSpread(node) ? (effect.spread ?? 0) * rasterScale : 0;
      let shadowSource = alphaSurface;
      if (spread) {
        if (!spreadMasks.has(spread)) spreadMasks.set(spread, createShadowSpreadSurface(alphaSurface, spread));
        shadowSource = spreadMasks.get(spread) || alphaSurface;
      }
      overlayContext.save();
      overlayContext.setTransform(1, 0, 0, 1, 0, 0);
      overlayContext.globalAlpha = 1;
      overlayContext.globalCompositeOperation = 'source-over';
      overlayContext.filter = 'none';
      overlayContext.clearRect(0, 0, pixelWidth, pixelHeight);
      overlayContext.fillStyle = effect.color;
      overlayContext.fillRect(0, 0, pixelWidth, pixelHeight);
      overlayContext.globalCompositeOperation = 'destination-out';
      overlayContext.filter = `blur(${Math.max(0, effect.blur) * rasterScale}px)`;
      overlayContext.drawImage(shadowSource, effect.offsetX * rasterScale, effect.offsetY * rasterScale);
      overlayContext.globalCompositeOperation = 'destination-in';
      overlayContext.filter = 'none';
      overlayContext.drawImage(alphaSurface, 0, 0);
      overlayContext.restore();

      surfaceContext.save();
      surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
      surfaceContext.globalCompositeOperation = canvasBlendOperation(effect.blendMode || 'normal');
      surfaceContext.globalAlpha = Math.max(0, Math.min(1, effect.opacity));
      surfaceContext.filter = 'none';
      surfaceContext.drawImage(overlay, 0, 0);
      surfaceContext.restore();
    }
  }

  applyDropShadows(surface, node, effects, rasterScale, pixelWidth, pixelHeight, padX = 0, padY = 0, shadowGeometryMask = null) {
    const shadows = effects.filter(effect => effect?.type === 'drop-shadow' && effect.visible !== false && effect.opacity > 0);
    const hidesShadowBehindNode = shadows.some(effect => effect.showShadowBehindNode !== true);
    const hasSpread = shadows.some(effect => supportsShadowSpread(node) && (effect.spread ?? 0) !== 0);
    if (!hasSpread && !hidesShadowBehindNode) return null;
    if (hidesShadowBehindNode && !shadowGeometryMask) {
      shadowGeometryMask = createShadowGeometryMask(node, this.getState?.()?.document || null,
        rasterScale, pixelWidth, pixelHeight, padX, padY, this.getState?.()?.shapeLocalTextRun || null);
    }
    if (hidesShadowBehindNode && !shadowGeometryMask) return null;
    let current = surface;
    let spare = createTextSurface(pixelWidth, pixelHeight);
    const colorMask = createTextSurface(pixelWidth, pixelHeight);
    const blurred = createTextSurface(pixelWidth, pixelHeight);
    const spareContext = spare?.getContext?.('2d');
    const colorContext = colorMask?.getContext?.('2d');
    const blurContext = blurred?.getContext?.('2d');
    if (!spareContext || !colorContext || !blurContext || typeof blurContext.filter !== 'string') return null;
    for (const effect of shadows) {
      const spread = supportsShadowSpread(node) ? (effect.spread ?? 0) * rasterScale : 0;
      const mask = spread ? createShadowSpreadSurface(current, spread) : current;
      if (!mask) return null;

      colorContext.save();
      colorContext.setTransform(1, 0, 0, 1, 0, 0);
      colorContext.globalAlpha = 1;
      colorContext.globalCompositeOperation = 'source-over';
      colorContext.filter = 'none';
      colorContext.clearRect(0, 0, pixelWidth, pixelHeight);
      colorContext.fillStyle = effect.color;
      colorContext.fillRect(0, 0, pixelWidth, pixelHeight);
      colorContext.globalCompositeOperation = 'destination-in';
      colorContext.drawImage(mask, 0, 0);
      colorContext.restore();

      blurContext.save();
      blurContext.setTransform(1, 0, 0, 1, 0, 0);
      blurContext.globalAlpha = 1;
      blurContext.globalCompositeOperation = 'source-over';
      blurContext.filter = `blur(${Math.max(0, effect.blur) * rasterScale}px)`;
      blurContext.clearRect(0, 0, pixelWidth, pixelHeight);
      blurContext.drawImage(colorMask, effect.offsetX * rasterScale, effect.offsetY * rasterScale);
      blurContext.restore();
      if (effect.showShadowBehindNode !== true) removeShadowBehindGeometry(blurred, shadowGeometryMask);

      spareContext.save();
      spareContext.setTransform(1, 0, 0, 1, 0, 0);
      spareContext.clearRect(0, 0, pixelWidth, pixelHeight);
      spareContext.globalCompositeOperation = 'source-over';
      spareContext.globalAlpha = Math.max(0, Math.min(1, effect.opacity));
      spareContext.drawImage(blurred, 0, 0);
      spareContext.globalAlpha = 1;
      spareContext.drawImage(current, 0, 0);
      spareContext.restore();

      const previous = current;
      current = spare;
      spare = previous;
    }
    return current;
  }

  drawDropShadowsWithBlendMode(ctx, source, node, effects, rasterScale, pixelWidth, pixelHeight,
    x, y, padX, padY, logicalWidth, logicalHeight, nodeOpacity, shadowGeometryMask = null, isolateFromBackdrop = false) {
    const shadows = effects.filter(effect => effect?.type === 'drop-shadow' && effect.visible !== false && effect.opacity > 0);
    if (!shadows.length) return false;
    let working = createTextSurface(pixelWidth, pixelHeight);
    const colorMask = createTextSurface(pixelWidth, pixelHeight);
    const blurred = createTextSurface(pixelWidth, pixelHeight);
    let workingContext = working?.getContext?.('2d');
    const colorContext = colorMask?.getContext?.('2d');
    const blurContext = blurred?.getContext?.('2d');
    if (!workingContext || !colorContext || !blurContext || typeof blurContext.filter !== 'string') return false;
    workingContext.drawImage(source, 0, 0);

    for (const effect of shadows) {
      const spread = supportsShadowSpread(node) ? (effect.spread ?? 0) * rasterScale : 0;
      const mask = spread ? createShadowSpreadSurface(working, spread) : working;
      if (!mask) return false;

      colorContext.save();
      colorContext.setTransform(1, 0, 0, 1, 0, 0);
      colorContext.globalAlpha = 1;
      colorContext.globalCompositeOperation = 'source-over';
      colorContext.filter = 'none';
      colorContext.clearRect(0, 0, pixelWidth, pixelHeight);
      colorContext.fillStyle = effect.color;
      colorContext.fillRect(0, 0, pixelWidth, pixelHeight);
      colorContext.globalCompositeOperation = 'destination-in';
      colorContext.drawImage(mask, 0, 0);
      colorContext.restore();

      blurContext.save();
      blurContext.setTransform(1, 0, 0, 1, 0, 0);
      blurContext.globalAlpha = 1;
      blurContext.globalCompositeOperation = 'source-over';
      blurContext.filter = `blur(${Math.max(0, effect.blur) * rasterScale}px)`;
      blurContext.clearRect(0, 0, pixelWidth, pixelHeight);
      blurContext.drawImage(colorMask, effect.offsetX * rasterScale, effect.offsetY * rasterScale);
      blurContext.restore();
      if (effect.showShadowBehindNode !== true) removeShadowBehindGeometry(blurred, shadowGeometryMask);

      // Layer blur and unclipped texture isolate effect blends from the live
      // backdrop. In that case blend into this layer's completed paint surface;
      // the node opacity is applied once when that surface is drawn to its parent.
      const blendContext = isolateFromBackdrop ? source.getContext?.('2d') : ctx;
      if (!blendContext) return false;
      blendContext.save();
      blendContext.globalCompositeOperation = canvasBlendOperation(effect.blendMode || 'normal');
      blendContext.filter = 'none';
      if (isolateFromBackdrop) {
        blendContext.setTransform(1, 0, 0, 1, 0, 0);
        blendContext.globalAlpha = Math.max(0, Math.min(1, effect.opacity));
        blendContext.drawImage(blurred, 0, 0, pixelWidth, pixelHeight);
      } else {
        blendContext.globalAlpha *= nodeOpacity * Math.max(0, Math.min(1, effect.opacity));
        blendContext.drawImage(blurred, x - padX, y - padY, logicalWidth, logicalHeight);
      }
      blendContext.restore();

      // Keep the source silhouette plus prior shadows without mutating the
      // foreground surface used for the final layer draw. Destination-over
      // also preserves Figma's ordering with earlier shadows above later ones.
      workingContext.save();
      workingContext.setTransform(1, 0, 0, 1, 0, 0);
      workingContext.globalCompositeOperation = 'destination-over';
      workingContext.globalAlpha = Math.max(0, Math.min(1, effect.opacity));
      workingContext.filter = 'none';
      workingContext.drawImage(blurred, 0, 0);
      workingContext.restore();
    }
    return true;
  }

  applyLayerBlurEffect(surface, effect, rasterScale, pixelWidth, pixelHeight, geometry = null) {
    if (!effect || effect.type !== 'layer-blur' || effect.visible === false) return true;
    const maximumRadius = effect.blurType === 'PROGRESSIVE'
      ? Math.max(effect.radius || 0, effect.startRadius || 0) : effect.radius;
    if (maximumRadius <= 0) return true;
    const ownerDocument = surface.ownerDocument || globalThis.document;
    const surfaceContext = surface.getContext('2d');
    const createSurface = () => typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(pixelWidth, pixelHeight)
      : ownerDocument?.createElement
        ? Object.assign(ownerDocument.createElement('canvas'), { width: pixelWidth, height: pixelHeight })
        : null;

    if (effect.blurType === 'PROGRESSIVE' && geometry
      && [geometry.width, geometry.height, geometry.padX, geometry.padY].every(Number.isFinite)) {
      try {
        const scratch = createSurface();
        const accumulation = createSurface();
        const scratchContext = scratch?.getContext('2d');
        const accumulationContext = accumulation?.getContext('2d');
        if (scratchContext && accumulationContext && surfaceContext && typeof scratchContext.filter === 'string'
          && typeof scratchContext.createLinearGradient === 'function' && typeof scratchContext.fillRect === 'function') {
          const angle = (Number(geometry.rotation) || 0) * Math.PI / 180;
          const points = [effect.startOffset, effect.endOffset].map(point => {
            const dx = geometry.width * point.x - geometry.width / 2;
            const dy = geometry.height * point.y - geometry.height / 2;
            return {
              x: (geometry.padX + geometry.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle)) * rasterScale,
              y: (geometry.padY + geometry.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)) * rasterScale
            };
          });
          const tierCount = progressiveBlurStepCount(effect, pixelWidth * pixelHeight);
          let supported = true;
          for (let index = 0; index < tierCount; index += 1) {
            const progress = index / (tierCount - 1);
            const gradient = progressiveBlurGradient(scratchContext, points, index, tierCount);
            if (!gradient) { supported = false; break; }
            scratchContext.save();
            scratchContext.setTransform(1, 0, 0, 1, 0, 0);
            scratchContext.filter = `blur(${Math.max(0, progressiveBlurRadius(effect, progress)) * rasterScale}px)`;
            scratchContext.globalCompositeOperation = 'source-over';
            scratchContext.clearRect(0, 0, pixelWidth, pixelHeight);
            scratchContext.drawImage(surface, 0, 0);
            scratchContext.restore();
            if (!maskProgressiveBlurTier(scratchContext, gradient, pixelWidth, pixelHeight)) { supported = false; break; }
            accumulationContext.save();
            accumulationContext.setTransform(1, 0, 0, 1, 0, 0);
            accumulationContext.filter = 'none';
            accumulationContext.globalCompositeOperation = index === 0 ? 'source-over' : 'lighter';
            if (index === 0) accumulationContext.clearRect(0, 0, pixelWidth, pixelHeight);
            accumulationContext.drawImage(scratch, 0, 0);
            accumulationContext.restore();
          }
          if (supported) {
            surfaceContext.save();
            surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
            surfaceContext.globalAlpha = 1;
            surfaceContext.globalCompositeOperation = 'source-over';
            surfaceContext.filter = 'none';
            surfaceContext.clearRect(0, 0, pixelWidth, pixelHeight);
            surfaceContext.drawImage(accumulation, 0, 0);
            surfaceContext.restore();
            return true;
          }
        }
      } catch { /* Fall back to the normal bounded blur if a progressive surface cannot be allocated. */ }
    }

    let scratch;
    try { scratch = createSurface(); } catch { return false; }
    const scratchContext = scratch?.getContext('2d');
    if (!scratchContext || !surfaceContext || typeof scratchContext.filter !== 'string') return false;

    scratchContext.save();
    scratchContext.setTransform(1, 0, 0, 1, 0, 0);
    scratchContext.globalAlpha = 1;
    scratchContext.globalCompositeOperation = 'source-over';
    scratchContext.filter = `blur(${Math.max(0, effect.radius) * rasterScale}px)`;
    scratchContext.clearRect(0, 0, pixelWidth, pixelHeight);
    scratchContext.drawImage(surface, 0, 0);
    scratchContext.restore();

    surfaceContext.save();
    surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
    surfaceContext.globalAlpha = 1;
    surfaceContext.globalCompositeOperation = 'source-over';
    surfaceContext.filter = 'none';
    surfaceContext.clearRect(0, 0, pixelWidth, pixelHeight);
    surfaceContext.drawImage(scratch, 0, 0);
    surfaceContext.restore();
    return true;
  }

  applyNoiseEffects(surface, node, effects, rasterScale, contentWidth, contentHeight, padX, padY, renderOptions = {}) {
    const noiseEffects = effects.filter(effect => effect?.type === 'noise' && effect.visible !== false);
    if (!noiseEffects.length) return;
    const surfaceContext = surface.getContext('2d');
    if (!surfaceContext) return;
    const ownerDocument = surface.ownerDocument || globalThis.document;
    this.noiseCache ||= new Map();
    this.noiseCachePixels ||= 0;
    for (const effect of noiseEffects) {
      const textureIndex = renderOptions.noiseEffectIndices?.get(node.id)?.get(effect.id)
        ?? (node.effects || []).findIndex(item => item.id === effect.id);
      const seed = noiseSeedForLayer(node.id, textureIndex);
      const cacheKey = JSON.stringify([node.id, textureIndex, rasterScale, contentWidth, contentHeight, effect]);
      let cacheEntry = this.noiseCache.get(cacheKey);
      if (cacheEntry) {
        this.noiseCache.delete(cacheKey);
        this.noiseCache.set(cacheKey, cacheEntry);
      } else {
        const grid = createNoisePixelGrid(effect, contentWidth, contentHeight, rasterScale, seed);
        const texture = typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(grid.width, grid.height)
          : ownerDocument?.createElement ? Object.assign(ownerDocument.createElement('canvas'), { width: grid.width, height: grid.height }) : null;
        const textureContext = texture?.getContext('2d');
        if (!textureContext?.createImageData || !textureContext.putImageData) continue;
        const imageData = textureContext.createImageData(grid.width, grid.height);
        imageData.data.set(grid.data);
        textureContext.putImageData(imageData, 0, 0);
        cacheEntry = { texture, pixels: grid.width * grid.height };
        if (cacheEntry.pixels <= MAX_NOISE_CACHE_PIXELS) {
          while (this.noiseCache.size >= MAX_NOISE_CACHE_ENTRIES
            || this.noiseCachePixels + cacheEntry.pixels > MAX_NOISE_CACHE_PIXELS) {
            const oldestKey = this.noiseCache.keys().next().value;
            if (oldestKey === undefined) break;
            this.noiseCachePixels -= this.noiseCache.get(oldestKey).pixels;
            this.noiseCache.delete(oldestKey);
          }
          this.noiseCache.set(cacheKey, cacheEntry);
          this.noiseCachePixels += cacheEntry.pixels;
        }
      }
      surfaceContext.save();
      surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
      surfaceContext.globalAlpha = 1;
      surfaceContext.imageSmoothingEnabled = false;
      const texture = cacheEntry.texture;
      const cellWidth = Math.max(1, Math.round(effect.sizeX * rasterScale));
      const cellHeight = Math.max(1, Math.round(effect.sizeY * rasterScale));
      const drawNoise = context => context.drawImage(texture, Math.round(padX * rasterScale), Math.round(padY * rasterScale),
        texture.width * cellWidth, texture.height * cellHeight);
      const blendMode = effect.blendMode || 'normal';
      if (blendMode === 'normal') {
        surfaceContext.globalCompositeOperation = 'source-atop';
        surfaceContext.filter = 'none';
        drawNoise(surfaceContext);
      } else {
        const overlay = typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(surface.width, surface.height)
          : ownerDocument?.createElement ? Object.assign(ownerDocument.createElement('canvas'), { width: surface.width, height: surface.height }) : null;
        const overlayContext = overlay?.getContext('2d');
        // Blend modes need the original layer alpha as a clip, then blend the
        // clipped color over the evolving layer surface.
        if (overlayContext) {
          overlayContext.save();
          overlayContext.setTransform(1, 0, 0, 1, 0, 0);
          overlayContext.globalCompositeOperation = 'source-over';
          overlayContext.globalAlpha = 1;
          overlayContext.filter = 'none';
          overlayContext.imageSmoothingEnabled = false;
          drawNoise(overlayContext);
          overlayContext.globalCompositeOperation = 'destination-in';
          overlayContext.imageSmoothingEnabled = true;
          overlayContext.drawImage(surface, 0, 0);
          overlayContext.restore();

          surfaceContext.globalCompositeOperation = canvasBlendOperation(blendMode);
          surfaceContext.filter = 'none';
          surfaceContext.drawImage(overlay, 0, 0);
        }
      }
      surfaceContext.restore();
    }
  }

  applyTextureEffects(surface, node, effects, pixelWidth, pixelHeight, rasterScale, renderOptions = {}) {
    const effect = effects.find(item => item?.type === 'texture' && item.visible !== false);
    if (!effect) return;
    const ownerDocument = surface.ownerDocument || globalThis.document;
    const createCanvas = (width, height) => typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : ownerDocument?.createElement ? Object.assign(ownerDocument.createElement('canvas'), { width, height }) : null;
    const maskScale = Math.min(1, Math.sqrt(MAX_TEXTURE_MASK_PIXELS / Math.max(1, pixelWidth * pixelHeight)), 2048 / pixelWidth, 2048 / pixelHeight);
    const maskWidth = Math.max(1, Math.floor(pixelWidth * maskScale));
    const maskHeight = Math.max(1, Math.floor(pixelHeight * maskScale));
    const effectiveScale = rasterScale * Math.min(maskWidth / pixelWidth, maskHeight / pixelHeight);
    const baseMask = createCanvas(maskWidth, maskHeight);
    const baseContext = baseMask?.getContext('2d');
    if (!baseContext?.createImageData || !baseContext.putImageData) return;
    baseContext.drawImage(surface, 0, 0, maskWidth, maskHeight);
    baseContext.globalCompositeOperation = 'source-in';
    baseContext.fillStyle = '#fff';
    baseContext.fillRect(0, 0, maskWidth, maskHeight);
    const baseImageData = baseContext.getImageData(0, 0, maskWidth, maskHeight);

    const blurredMask = createCanvas(maskWidth, maskHeight);
    const blurredContext = blurredMask?.getContext('2d');
    if (!blurredContext?.getImageData) return;
    const blurRadius = Math.max(.5, effect.radius * effectiveScale / 3);
    blurredContext.filter = `blur(${blurRadius}px)`;
    blurredContext.drawImage(baseMask, 0, 0);
    const blurredImageData = blurredContext.getImageData(0, 0, maskWidth, maskHeight);
    const textureIndex = renderOptions.textureEffectIndices?.get(node.id)?.get(effect.id)
      ?? (node.effects || []).findIndex(item => item.id === effect.id);
    const alphas = createTextureEdgeAlphas(baseImageData, blurredImageData, maskWidth, maskHeight, effect,
      effectiveScale, textureSeedForLayer(node.id, textureIndex));

    const makeAlphaMask = alpha => {
      const canvas = createCanvas(maskWidth, maskHeight);
      const context = canvas?.getContext('2d');
      if (!context?.createImageData || !context.putImageData) return null;
      const imageData = context.createImageData(maskWidth, maskHeight);
      for (let index = 0; index < alpha.length; index += 1) {
        const offset = index * 4;
        imageData.data[offset] = 255;
        imageData.data[offset + 1] = 255;
        imageData.data[offset + 2] = 255;
        imageData.data[offset + 3] = alpha[index];
      }
      context.putImageData(imageData, 0, 0);
      return canvas;
    };
    const insideMask = makeAlphaMask(alphas.inside);
    const surfaceContext = surface.getContext('2d');
    if (!insideMask || !surfaceContext) return;

    let outsideTexture = null;
    if (!effect.clipToShape && alphas.outside.some(alpha => alpha > 0)) {
      outsideTexture = createCanvas(pixelWidth, pixelHeight);
      const outsideContext = outsideTexture?.getContext('2d');
      const outsideMask = makeAlphaMask(alphas.outside);
      if (!outsideContext || !outsideMask) outsideTexture = null;
      else {
        outsideContext.filter = `blur(${blurRadius}px)`;
        outsideContext.drawImage(surface, 0, 0);
        outsideContext.filter = 'none';
        outsideContext.globalCompositeOperation = 'destination-in';
        outsideContext.imageSmoothingEnabled = true;
        outsideContext.drawImage(outsideMask, 0, 0, pixelWidth, pixelHeight);
      }
    }

    surfaceContext.save();
    surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
    surfaceContext.globalCompositeOperation = 'destination-in';
    surfaceContext.imageSmoothingEnabled = true;
    surfaceContext.drawImage(insideMask, 0, 0, pixelWidth, pixelHeight);
    if (outsideTexture) {
      surfaceContext.globalCompositeOperation = 'source-over';
      surfaceContext.drawImage(outsideTexture, 0, 0);
    }
    surfaceContext.restore();
  }

  drawNodeWithGlass(ctx, node, parentX, parentY, assets, effect, renderOptions = {}) {
    const source = ctx.canvas;
    const matrix = ctx.getTransform?.();
    const drawOwnContent = () => {
      const copy = { ...node, effects: (node.effects || []).filter(item => !['glass', 'background-blur'].includes(item.type)) };
      const originalEffectIndices = new Map((node.effects || []).map((item, index) => [item.id, index]));
      const noiseEffectIndices = new Map(renderOptions.noiseEffectIndices || []);
      noiseEffectIndices.set(node.id, originalEffectIndices);
      const textureEffectIndices = new Map(renderOptions.textureEffectIndices || []);
      textureEffectIndices.set(node.id, originalEffectIndices);
      this.drawNode(ctx, copy, parentX, parentY, assets, false, false, {
        ...renderOptions, noiseEffectIndices, textureEffectIndices, backgroundBlurBypassNodeId: node.id
      });
    };
    if (!source || !matrix || !glassVisibleForRenderedNode(node, this.getState().document)) { drawOwnContent(); return; }
    const scaleX = Math.hypot(matrix.a, matrix.b);
    const scaleY = Math.hypot(matrix.c, matrix.d);
    const displayScale = Math.max(.01, Math.sqrt(scaleX * scaleY));
    const nodeMatrix = nodeToParentTransform({ ...node, x: parentX + node.x, y: parentY + node.y });
    let ink;
    try { ink = this.renderInkBounds(node, renderOptions); }
    catch (error) { this.reportInkBoundsError(node, error, renderOptions); return; }
    const corners = [[ink.left, ink.top], [ink.right, ink.top], [ink.right, ink.bottom], [ink.left, ink.bottom]]
      .map(([x, y]) => transformPoint(matrix, transformPoint(nodeMatrix, { x, y })));
    const pad = glassEffectOverscan(effect) * displayScale;
    const left = Math.floor(Math.min(...corners.map(point => point.x)) - pad);
    const top = Math.floor(Math.min(...corners.map(point => point.y)) - pad);
    const right = Math.ceil(Math.max(...corners.map(point => point.x)) + pad);
    const bottom = Math.ceil(Math.max(...corners.map(point => point.y)) + pad);
    const logicalWidth = right - left;
    const logicalHeight = bottom - top;
    if (![left, top, logicalWidth, logicalHeight].every(Number.isFinite) || logicalWidth < 1 || logicalHeight < 1) { drawOwnContent(); return; }
    const cachedOverlay = renderOptions.backdropOverlays?.get(node.id);
    if (cachedOverlay) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = 'none';
      ctx.globalAlpha *= getNodePropertyValue(this.getState().document, node, 'opacity') ?? 1;
      ctx.globalCompositeOperation = canvasBlendOperation(node.blendMode || 'normal');
      ctx.drawImage(cachedOverlay.canvas, left + cachedOverlay.offsetX, top + cachedOverlay.offsetY,
        cachedOverlay.width, cachedOverlay.height);
      ctx.restore();
      drawOwnContent();
      return;
    }
    const rasterScale = Math.min(1, 2 / displayScale,
      Math.sqrt(MAX_GLASS_PIXELS / (logicalWidth * logicalHeight)),
      MAX_GLASS_AXIS / logicalWidth, MAX_GLASS_AXIS / logicalHeight);
    const pixelWidth = Math.max(1, Math.ceil(logicalWidth * rasterScale));
    const pixelHeight = Math.max(1, Math.ceil(logicalHeight * rasterScale));
    const createSurface = () => {
      if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(pixelWidth, pixelHeight);
      const ownerDocument = source.ownerDocument || globalThis.document;
      if (ownerDocument?.createElement) return Object.assign(ownerDocument.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
      return null;
    };
    const backdrop = createSurface();
    const work = createSurface();
    const shapeMask = createSurface();
    const backdropContext = backdrop?.getContext('2d');
    const workContext = work?.getContext('2d');
    const shapeContext = shapeMask?.getContext('2d');
    if (!backdropContext?.getImageData || !backdropContext.putImageData
      || !workContext?.getImageData || !shapeContext) { drawOwnContent(); return; }
    const sourceLeft = Math.max(0, left);
    const sourceTop = Math.max(0, top);
    const sourceRight = Math.min(source.width, right);
    const sourceBottom = Math.min(source.height, bottom);
    if (sourceRight > sourceLeft && sourceBottom > sourceTop) {
      backdropContext.drawImage(source, sourceLeft, sourceTop, sourceRight - sourceLeft, sourceBottom - sourceTop,
        (sourceLeft - left) * rasterScale, (sourceTop - top) * rasterScale,
        (sourceRight - sourceLeft) * rasterScale, (sourceBottom - sourceTop) * rasterScale);
    }

    const frostRadius = (effect.frost / 100) * 12 * displayScale * rasterScale;
    workContext.filter = frostRadius > 0 ? `blur(${frostRadius}px)` : 'none';
    workContext.drawImage(backdrop, 0, 0);
    let sampledBackdrop;
    try { sampledBackdrop = workContext.getImageData(0, 0, pixelWidth, pixelHeight); }
    catch { drawOwnContent(); return; }

    const setMaskTransform = context => context.setTransform(matrix.a * rasterScale, matrix.b * rasterScale,
      matrix.c * rasterScale, matrix.d * rasterScale, (matrix.e - left) * rasterScale, (matrix.f - top) * rasterScale);
    const opaqueFills = Array.isArray(node.fills) ? node.fills.map(fill => ({ ...fill, opacity: 1 })) : undefined;
    const stagedFillNode = node.effectPaintMode === 'staged' ? opaqueStagedFillTree(node) : node;
    const maskNode = {
      ...stagedFillNode, opacity: 1, fillOpacity: 1, ...(opaqueFills ? { fills: opaqueFills } : {}),
      variableBindings: {}, blendMode: 'normal', effects: [],
      children: node.effectPaintMode === 'staged' ? stagedFillNode.children : [],
      strokes: [], stroke: null, strokeWidth: 0
    };
    shapeContext.save();
    shapeContext.setTransform(1, 0, 0, 1, 0, 0);
    shapeContext.clearRect(0, 0, pixelWidth, pixelHeight);
    setMaskTransform(shapeContext);
    this.drawNode(shapeContext, maskNode, parentX, parentY, assets, false, false, {
      ...renderOptions, outlineMode: false, showEmptyFrameHint: false, showLayoutGuides: false,
      ...(node.effectPaintMode === 'staged' ? { effectPaintStage: 'fill', effectPaintStageNodeId: node.id } : {}),
      backgroundBlurBypassNodeId: node.id, effectBypassNodeId: node.id, compositeBypassNodeId: node.id
    });
    shapeContext.restore();

    const edgeBlur = Math.max(.65, (effect.depth / 100) * 12 * displayScale * rasterScale);
    workContext.save();
    workContext.setTransform(1, 0, 0, 1, 0, 0);
    workContext.clearRect(0, 0, pixelWidth, pixelHeight);
    // Blur completed coverage once in pixel coordinates. Font-space glyph
    // scaling must not shrink this radius or blur overlapping glyphs separately.
    workContext.filter = `blur(${edgeBlur}px)`;
    workContext.drawImage(shapeMask, 0, 0);
    workContext.restore();
    let edgeImageData;
    try { edgeImageData = workContext.getImageData(0, 0, pixelWidth, pixelHeight); }
    catch { drawOwnContent(); return; }
    let refracted;
    try { refracted = refractGlassBackdrop(sampledBackdrop, edgeImageData, pixelWidth, pixelHeight, effect, displayScale * rasterScale); }
    catch { drawOwnContent(); return; }
    // The shader returns portable bytes; Canvas requires a real ImageData.
    sampledBackdrop.data.set(refracted.data);
    backdropContext.putImageData(sampledBackdrop, 0, 0);
    backdropContext.save();
    backdropContext.globalCompositeOperation = 'destination-in';
    backdropContext.drawImage(shapeMask, 0, 0);
    backdropContext.restore();
    renderOptions.captureBackdropOverlay?.(node.id, backdrop, {
      left, top, logicalWidth, logicalHeight, pixelWidth, pixelHeight, rasterScale
    });

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha *= getNodePropertyValue(this.getState().document, node, 'opacity') ?? 1;
    ctx.globalCompositeOperation = canvasBlendOperation(node.blendMode || 'normal');
    ctx.drawImage(backdrop, left, top, logicalWidth, logicalHeight);
    ctx.restore();
    drawOwnContent();
  }

  drawNodeWithBackgroundBlur(ctx, node, parentX, parentY, assets, effects, renderOptions = {}) {
    const source = ctx.canvas;
    const matrix = ctx.getTransform?.();
    const visible = effects.filter(effect => effect.visible !== false);
    const radius = visible.reduce((maximum, effect) => Math.max(maximum, effect.radius || 0,
      effect.blurType === 'PROGRESSIVE' ? effect.startRadius || 0 : 0), 0);
    const drawOwnContent = () => {
      const copy = { ...node, effects: (node.effects || []).filter(effect => !['background-blur', 'glass'].includes(effect.type)) };
      const originalNoiseIndices = new Map((node.effects || []).map((effect, index) => [effect.id, index]));
      const noiseEffectIndices = new Map(renderOptions.noiseEffectIndices || []);
      noiseEffectIndices.set(node.id, originalNoiseIndices);
      const textureEffectIndices = new Map(renderOptions.textureEffectIndices || []);
      textureEffectIndices.set(node.id, originalNoiseIndices);
      this.drawNode(ctx, copy, parentX, parentY, assets, false, false, { ...renderOptions, noiseEffectIndices, textureEffectIndices, backgroundBlurBypassNodeId: node.id });
    };
    if (!source || !matrix || !visible.length || radius <= 0 || !Number.isFinite(radius)) { drawOwnContent(); return; }
    const scaleX = Math.hypot(matrix.a, matrix.b);
    const scaleY = Math.hypot(matrix.c, matrix.d);
    const displayScale = Math.max(.01, Math.sqrt(scaleX * scaleY));
    const nodeMatrix = nodeToParentTransform({ ...node, x: parentX + node.x, y: parentY + node.y });
    let ink;
    try { ink = this.renderInkBounds(node, renderOptions); }
    catch (error) { this.reportInkBoundsError(node, error, renderOptions); return; }
    const corners = [[ink.left, ink.top], [ink.right, ink.top], [ink.right, ink.bottom], [ink.left, ink.bottom]]
      .map(([x, y]) => transformPoint(matrix, transformPoint(nodeMatrix, { x, y })));
    const pad = radius * displayScale * 3;
    const left = Math.floor(Math.min(...corners.map(point => point.x)) - pad);
    const top = Math.floor(Math.min(...corners.map(point => point.y)) - pad);
    const right = Math.ceil(Math.max(...corners.map(point => point.x)) + pad);
    const bottom = Math.ceil(Math.max(...corners.map(point => point.y)) + pad);
    const logicalWidth = right - left;
    const logicalHeight = bottom - top;
    if (![left, top, logicalWidth, logicalHeight].every(Number.isFinite) || logicalWidth < 1 || logicalHeight < 1) { drawOwnContent(); return; }
    const cachedOverlay = renderOptions.backdropOverlays?.get(node.id);
    if (cachedOverlay) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = 'none';
      ctx.globalAlpha *= getNodePropertyValue(this.getState().document, node, 'opacity') ?? 1;
      ctx.globalCompositeOperation = canvasBlendOperation(node.blendMode || 'normal');
      ctx.drawImage(cachedOverlay.canvas, left + cachedOverlay.offsetX, top + cachedOverlay.offsetY,
        cachedOverlay.width, cachedOverlay.height);
      ctx.restore();
      drawOwnContent();
      return;
    }
    const rasterScale = Math.min(1, 2 / displayScale,
      Math.sqrt(MAX_BACKGROUND_BLUR_PIXELS / (logicalWidth * logicalHeight)),
      MAX_BACKGROUND_BLUR_AXIS / logicalWidth, MAX_BACKGROUND_BLUR_AXIS / logicalHeight);
    const pixelWidth = Math.max(1, Math.ceil(logicalWidth * rasterScale));
    const pixelHeight = Math.max(1, Math.ceil(logicalHeight * rasterScale));
    const createSurface = () => {
      if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(pixelWidth, pixelHeight);
      const ownerDocument = source.ownerDocument || globalThis.document;
      if (ownerDocument?.createElement) return Object.assign(ownerDocument.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
      return null;
    };
    const backdrop = createSurface();
    const result = createSurface();
    const backdropContext = backdrop?.getContext('2d');
    const resultContext = result?.getContext('2d');
    if (!backdropContext || !resultContext) { drawOwnContent(); return; }
    const sourceLeft = Math.max(0, left);
    const sourceTop = Math.max(0, top);
    const sourceRight = Math.min(source.width, right);
    const sourceBottom = Math.min(source.height, bottom);
    const effect = visible[0];
    const progressive = effect?.blurType === 'PROGRESSIVE' && effect.startOffset && effect.endOffset
      && sourceRight > sourceLeft && sourceBottom > sourceTop;
    const drawBackdropSource = filter => {
      backdropContext.save();
      backdropContext.setTransform(1, 0, 0, 1, 0, 0);
      backdropContext.clearRect(0, 0, pixelWidth, pixelHeight);
      backdropContext.filter = filter;
      if (sourceRight > sourceLeft && sourceBottom > sourceTop) {
        backdropContext.drawImage(source, sourceLeft, sourceTop, sourceRight - sourceLeft, sourceBottom - sourceTop,
          (sourceLeft - left) * rasterScale, (sourceTop - top) * rasterScale,
          (sourceRight - sourceLeft) * rasterScale, (sourceBottom - sourceTop) * rasterScale);
      }
      backdropContext.restore();
    };
    if (progressive && typeof backdropContext.createLinearGradient === 'function' && typeof backdropContext.fillRect === 'function') {
      const pointOnCanvas = offset => {
        const { x: worldX, y: worldY } = transformPoint(nodeMatrix, { x: node.width * offset.x, y: node.height * offset.y });
        const screenX = matrix.a * worldX + matrix.c * worldY + matrix.e;
        const screenY = matrix.b * worldX + matrix.d * worldY + matrix.f;
        return { x: (screenX - left) * rasterScale, y: (screenY - top) * rasterScale };
      };
      const points = [pointOnCanvas(effect.startOffset), pointOnCanvas(effect.endOffset)];
      const tierCount = progressiveBlurStepCount(effect, pixelWidth * pixelHeight);
      resultContext.save();
      resultContext.setTransform(1, 0, 0, 1, 0, 0);
      resultContext.clearRect(0, 0, pixelWidth, pixelHeight);
      resultContext.globalCompositeOperation = 'source-over';
      resultContext.filter = 'none';
      let supported = true;
      for (let index = 0; index < tierCount; index += 1) {
        const progress = index / (tierCount - 1);
        const gradient = progressiveBlurGradient(backdropContext, points, index, tierCount);
        if (!gradient) { supported = false; break; }
        drawBackdropSource(`blur(${progressiveBlurRadius(effect, progress) * displayScale * rasterScale}px)`);
        if (!maskProgressiveBlurTier(backdropContext, gradient, pixelWidth, pixelHeight)) { supported = false; break; }
        resultContext.globalCompositeOperation = index === 0 ? 'source-over' : 'lighter';
        resultContext.drawImage(backdrop, 0, 0);
      }
      resultContext.restore();
      if (!supported) {
        drawBackdropSource('none');
        resultContext.save();
        resultContext.setTransform(1, 0, 0, 1, 0, 0);
        resultContext.clearRect(0, 0, pixelWidth, pixelHeight);
        resultContext.globalCompositeOperation = 'source-over';
        resultContext.filter = `blur(${effect.radius * displayScale * rasterScale}px)`;
        resultContext.drawImage(backdrop, 0, 0);
        resultContext.restore();
      }
    } else {
      if (sourceRight > sourceLeft && sourceBottom > sourceTop) {
        backdropContext.drawImage(source, sourceLeft, sourceTop, sourceRight - sourceLeft, sourceBottom - sourceTop,
          (sourceLeft - left) * rasterScale, (sourceTop - top) * rasterScale,
          (sourceRight - sourceLeft) * rasterScale, (sourceBottom - sourceTop) * rasterScale);
      }
      resultContext.save();
      resultContext.filter = `blur(${radius * displayScale * rasterScale}px)`;
      resultContext.drawImage(backdrop, 0, 0);
      resultContext.restore();
    }
    backdropContext.clearRect(0, 0, pixelWidth, pixelHeight);
    backdropContext.setTransform(matrix.a * rasterScale, matrix.b * rasterScale, matrix.c * rasterScale, matrix.d * rasterScale,
      (matrix.e - left) * rasterScale, (matrix.f - top) * rasterScale);
    // Figma-style background blur is exposed by partially transparent fills.
    // Keep stroke pixels out of the mask: a stroked, unfilled shape must not
    // reveal a backdrop effect by itself. Raster image layers still contribute
    // their source alpha through drawNode's normal image-fill path.
    const maskNode = {
      ...node, opacity: 1, variableBindings: {}, blendMode: 'normal', effects: [],
      children: node.effectPaintMode === 'staged' ? node.children : [],
      strokes: [], stroke: null, strokeWidth: 0
    };
    this.drawNode(backdropContext, maskNode, parentX, parentY, assets, false, false, {
      ...renderOptions, outlineMode: false, showEmptyFrameHint: false, showLayoutGuides: false,
      ...(node.effectPaintMode === 'staged' ? { effectPaintStage: 'fill', effectPaintStageNodeId: node.id } : {}),
      backgroundBlurBypassNodeId: node.id, effectBypassNodeId: node.id, compositeBypassNodeId: node.id
    });
    resultContext.save();
    resultContext.globalCompositeOperation = 'destination-in';
    resultContext.drawImage(backdrop, 0, 0);
    resultContext.restore();
    renderOptions.captureBackdropOverlay?.(node.id, result, {
      left, top, logicalWidth, logicalHeight, pixelWidth, pixelHeight, rasterScale
    });

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha *= getNodePropertyValue(this.getState().document, node, 'opacity') ?? 1;
    ctx.globalCompositeOperation = canvasBlendOperation(node.blendMode || 'normal');
    ctx.drawImage(result, left, top, logicalWidth, logicalHeight);
    ctx.restore();
    drawOwnContent();
  }

  drawNodeWithEffects(ctx, node, parentX, parentY, assets, effects, renderOptions = {}) {
    const transform = ctx.getTransform?.();
    const displayScale = transform ? Math.hypot(transform.a, transform.b) : Math.max(.1, (window.devicePixelRatio || 1) * (this.getState().zoom || 1));
    const effectPadding = layerEffectPadding(effects);
    let geometryBounds;
    try { geometryBounds = transformInkBounds(this.renderInkBounds(node, { ...renderOptions, inkMeasureContext: ctx }), nodeToParentTransform({ ...node, x: 0, y: 0 })); }
    catch (error) { this.reportInkBoundsError(node, error, renderOptions); return; }
    const { left: minX, right: maxX, top: minY, bottom: maxY } = geometryBounds;
    // Include the transformed geometry and its effect apron. `drawNode` applies
    // affineTransform inside this surface, so padding from only the untransformed
    // width/height clips scaled and sheared content before its effects run.
    const padX = Math.ceil(Math.max(effectPadding.x - minX, effectPadding.x + maxX - node.width, 0));
    const padY = Math.ceil(Math.max(effectPadding.y - minY, effectPadding.y + maxY - node.height, 0));
    const logicalWidth = Math.max(1, node.width + padX * 2);
    const logicalHeight = Math.max(1, node.height + padY * 2);
    const pixelBudget = 4_000_000;
    const rasterScale = Math.min(2, Math.max(.05, displayScale), Math.sqrt(pixelBudget / (logicalWidth * logicalHeight)), 4096 / logicalWidth, 4096 / logicalHeight);
    const pixelWidth = Math.max(1, Math.ceil(logicalWidth * rasterScale));
    const pixelHeight = Math.max(1, Math.ceil(logicalHeight * rasterScale));
    const surface = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(pixelWidth, pixelHeight)
      : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
    const effectContext = surface.getContext('2d');
    if (!effectContext) {
      ctx.save();
      ctx.globalCompositeOperation = canvasBlendOperation(node.blendMode || 'normal');
      this.drawNode(ctx, node, parentX, parentY, assets, false, false, { ...renderOptions, effectBypassNodeId: node.id, compositeBypassNodeId: node.id });
      ctx.restore();
      return;
    }
    effectContext.setTransform(rasterScale, 0, 0, rasterScale, padX * rasterScale, padY * rasterScale);
    const copy = { ...node, x: 0, y: 0, opacity: 1, variableBindings: { ...(node.variableBindings || {}) },
      effects: (node.effects || []).filter(effect => !['background-blur', 'glass'].includes(effect.type)) };
    // SVG applies layer opacity to the filtered group result. Keep the Canvas
    // effect surface at full layer opacity too, then apply the resolved value
    // once when the completed surface is composited back to its parent.
    delete copy.variableBindings.opacity;
    delete copy.variableBindings.x;
    delete copy.variableBindings.y;
    // The caller has resolved this layer's motion already. Re-entering by the
    // same ID must keep the local origin and full surface opacity, while fill
    // animation and descendant motion remain live in their normal paint paths.
    const localRenderOptions = { ...renderOptions, motionResolvedNodeId: node.id,
      effectBypassNodeId: node.id, compositeBypassNodeId: node.id };
    // Plain paint layers use explicit fill, inner-shadow, and stroke phases.
    // Containers stay flattened, but their inner shadows sit below the top
    // effect stack (blur/noise/texture), matching the group effect order.
    const stagedGroup = node.type === 'group' && node.effectPaintMode === 'staged' && !node.mask;
    const stagePaints = stagedGroup || (!node.mask && (!(node.children?.length) || node.type === 'boolean')
      && EFFECT_PAINT_STAGEABLE_TYPES.has(node.type));
    const containerEffectOrder = !stagedGroup && (node.type === 'group' || node.type === 'frame' || node.type === 'section'
      || Boolean(node.mask) || (node.type !== 'boolean' && Boolean(node.children?.length)));
    const hasInnerShadow = effects.some(effect => effect.type === 'inner-shadow' && effect.visible !== false && effect.opacity > 0);
    let hasVisibleStroke;
    try {
      hasVisibleStroke = stagedGroup ? node.children.some(child => child.effectPaintPhase === 'stroke'
        && hasVisibleRenderedPaint(this.getState().document, child)) : stagePaints && strokeStackForNode(node).some((stroke, index) => {
        const color = index === 0 && node.strokeVariableId ? getNodeColor(this.getState().document, node, 'stroke') : stroke.color;
        if (!paintHasVisibleAlpha({ ...stroke, color })) return false;
        const sideWidths = strokeSideWidths(stroke);
        return Math.max(Number(stroke.width) || 0, ...strokeSideNames.map(side => Number(sideWidths?.[side]) || 0)) > 0;
      });
    } catch (error) { this.reportInkBoundsError(node, error, renderOptions); return; }
    const drawPaintStage = (context, stage) => this.drawNode(context, copy, 0, 0, assets, false, false, {
      ...localRenderOptions, effectPaintStage: stage, effectPaintStageNodeId: node.id
    });
    let stagedPaints = false;
    if (stagePaints) {
      drawPaintStage(effectContext, 'fill');
      let shadowAlphaSurface = surface;
      if (hasInnerShadow && hasVisibleStroke) {
        let silhouette = null;
        try {
          silhouette = typeof OffscreenCanvas === 'function'
            ? new OffscreenCanvas(pixelWidth, pixelHeight)
            : (surface.ownerDocument || globalThis.document)?.createElement
              ? Object.assign((surface.ownerDocument || globalThis.document).createElement('canvas'), { width: pixelWidth, height: pixelHeight })
              : null;
        } catch { /* Fall back to the existing combined-paint renderer below. */ }
        const silhouetteContext = silhouette?.getContext('2d');
        if (silhouetteContext) {
          silhouetteContext.drawImage(surface, 0, 0);
          silhouetteContext.setTransform(rasterScale, 0, 0, rasterScale, padX * rasterScale, padY * rasterScale);
          drawPaintStage(silhouetteContext, 'stroke');
          shadowAlphaSurface = silhouette;
          stagedPaints = true;
        }
      } else stagedPaints = true;

      if (stagedPaints) {
        if (hasInnerShadow) this.applyInnerShadows(surface, effects, rasterScale, pixelWidth, pixelHeight, shadowAlphaSurface, node);
        drawPaintStage(effectContext, 'stroke');
      } else {
        // Preserve the established appearance if a mixed-paint shadow cannot
        // allocate its bounded silhouette surface.
        effectContext.save();
        effectContext.setTransform(1, 0, 0, 1, 0, 0);
        effectContext.clearRect(0, 0, pixelWidth, pixelHeight);
        effectContext.restore();
        effectContext.setTransform(rasterScale, 0, 0, rasterScale, padX * rasterScale, padY * rasterScale);
        this.drawNode(effectContext, copy, 0, 0, assets, false, false, localRenderOptions);
      }
    } else {
      this.drawNode(effectContext, copy, 0, 0, assets, false, false, localRenderOptions);
    }
    const topEffects = effects.filter(effect => ['layer-blur', 'noise', 'texture'].includes(effect.type));
    const deferredLayerBlurIds = new Set();
    if (containerEffectOrder) this.applyInnerShadows(surface, effects, rasterScale, pixelWidth, pixelHeight, surface, node);
    for (const effect of topEffects) {
      if (effect.type === 'layer-blur') {
        if (!this.applyLayerBlurEffect(surface, effect, rasterScale, pixelWidth, pixelHeight,
          { width: node.width, height: node.height, rotation: node.rotation, padX, padY })) deferredLayerBlurIds.add(effect.id);
      } else if (effect.type === 'noise') {
        this.applyNoiseEffects(surface, node, [effect], rasterScale,
          Math.max(1, Math.ceil(node.width * rasterScale)), Math.max(1, Math.ceil(node.height * rasterScale)), padX, padY, renderOptions);
      } else this.applyTextureEffects(surface, node, [effect], pixelWidth, pixelHeight, rasterScale, renderOptions);
    }
    if (!stagedPaints && !containerEffectOrder) this.applyInnerShadows(surface, effects, rasterScale, pixelWidth, pixelHeight, surface, node);
    const x = parentX + node.x; const y = parentY + node.y;
    const currentState = this.getState();
    const nodeOpacity = (!renderOptions.ignoreMotionPreview && renderOptions.motionResolvedNodeId !== node.id
      ? currentState.motionPreview?.get(node.id)?.opacity : undefined)
      ?? getNodePropertyValue(currentState.document, node, 'opacity') ?? 1;
    const needsShadowGeometryMask = effects.some(effect => effect.type === 'drop-shadow' && effect.visible !== false
      && effect.opacity > 0 && effect.showShadowBehindNode !== true);
    const shadowGeometryMask = needsShadowGeometryMask
      ? stagedGroup ? this.createStagedShadowGeometryMask(copy, assets, rasterScale, pixelWidth, pixelHeight, padX, padY, localRenderOptions)
        : createShadowGeometryMask(copy, this.getState().document || null, rasterScale, pixelWidth, pixelHeight, padX, padY,
          this.getState().shapeLocalTextRun || null)
      : null;
    // If a bounded geometry mask cannot be allocated, omit only the affected
    // shadows rather than silently showing through transparent layer areas.
    const shadowEffects = needsShadowGeometryMask && !shadowGeometryMask
      ? effects.filter(effect => effect.type !== 'drop-shadow' || effect.showShadowBehindNode === true)
      : effects;
    const hasBlendedDropShadow = shadowEffects.some(effect => effect.type === 'drop-shadow' && effect.visible !== false
      && effect.opacity > 0 && effect.blendMode && effect.blendMode !== 'normal');
    const isolateDropShadowBlend = effects.some(effect => effect.visible !== false
      && (effect.type === 'layer-blur' || effect.type === 'texture' && effect.clipToShape === false));
    if (hasBlendedDropShadow) this.drawDropShadowsWithBlendMode(ctx, surface, node, shadowEffects,
      rasterScale, pixelWidth, pixelHeight, x, y, padX, padY, logicalWidth, logicalHeight, nodeOpacity, shadowGeometryMask,
      isolateDropShadowBlend);
    // If the bounded shadow surface cannot be allocated, omit this non-normal
    // effect instead of silently rendering it with the wrong blend mode.
    const spreadDropShadowSurface = hasBlendedDropShadow
      ? null : this.applyDropShadows(surface, node, shadowEffects, rasterScale, pixelWidth, pixelHeight,
        padX, padY, shadowGeometryMask);
    const renderedSurface = spreadDropShadowSurface || surface;
    const customDropShadowsApplied = Boolean(spreadDropShadowSurface);
    ctx.save();
    ctx.globalAlpha *= nodeOpacity;
    ctx.filter = buildLayerEffectFilter([
      ...effects.filter(effect => deferredLayerBlurIds.has(effect.id)),
      ...shadowEffects.filter(effect => effect.type === 'drop-shadow' && !hasBlendedDropShadow && !customDropShadowsApplied)
    ], displayScale);
    ctx.globalCompositeOperation = canvasBlendOperation(node.blendMode || 'normal');
    ctx.drawImage(renderedSurface, x - padX, y - padY, logicalWidth, logicalHeight);
    ctx.restore();
  }

  renderInkBounds(node, renderOptions = {}) {
    const state = this.getState();
    const resolveNode = original => original === node ? node : { ...original,
      ...getNodeGeometry(state.document, original),
      ...(!renderOptions.ignoreMotionPreview ? state.motionPreview?.get(original.id) || {} : {}),
      visible: getNodePropertyValue(state.document, original, 'visible') };
    return renderNodeInkBounds(state.document, node, { resolveNode,
      textBounds: text => localTextInkBounds(state.document, text, state.shapeLocalTextRun,
        { measureContext: renderOptions.inkMeasureContext || this.context }) });
  }

  reportInkBoundsError(node, error, renderOptions = {}) {
    renderOptions.onRenderError?.(node, error);
    const errors = this.inkBoundsErrors ||= new Set();
    if (errors.has(node.id)) return;
    if (errors.size >= 256) errors.delete(errors.values().next().value);
    errors.add(node.id);
    console.warn(`Layer “${node.name || node.id}” exceeds the bounded ink-compositing budget.`, error);
    this.onMaskError?.(node, error);
  }

  /** Geometry-only coverage of editable outlined children, never a paint plane. */
  createStagedShadowGeometryMask(node, assets, rasterScale, pixelWidth, pixelHeight, padX, padY, renderOptions = {}) {
    const mask = createTextSurface(pixelWidth, pixelHeight);
    const context = mask?.getContext?.('2d');
    if (!context) return null;
    context.setTransform(rasterScale, 0, 0, rasterScale, padX * rasterScale, padY * rasterScale);
    const state = this.getState(); let visited = 0; const active = new Set();
    const options = { ...renderOptions, effectPaintStage: undefined, effectPaintStageNodeId: undefined,
      outlineMode: false, showEmptyFrameHint: false, showLayoutGuides: false, includeSlices: false };
    const paint = (source, depth) => {
      if (++visited > RENDER_INK_BOUNDS_LIMITS.maxNodes || depth > RENDER_INK_BOUNDS_LIMITS.maxDepth || active.has(source)) {
        throw new RangeError('Outlined shadow geometry exceeds the bounded layer-tree budget.');
      }
      if (getNodePropertyValue(state.document, source, 'visible') === false) return;
      active.add(source);
      try {
        const resolved = source === node ? node : { ...source, ...getNodeGeometry(state.document, source),
          ...(!renderOptions.ignoreMotionPreview ? state.motionPreview?.get(source.id) || {} : {}) };
        if (['group', 'frame', 'section'].includes(resolved.type)) {
          context.save();
          try {
            const matrix = nodeToParentTransform(resolved);
            context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
            if (resolved.clip || isScrollableFrame(resolved)) clipNodeContents(context, resolved, 0, 0);
            // A generated alpha-mask's source holds the editable full glyph
            // geometry. Its rectangle child is merely a bounded paint plane.
            const maskSource = resolved.mask && (resolved.children?.find(child => child.id === resolved.maskSourceId) || resolved.children?.[0]);
            const maskContent = (resolved.children || []).filter(child => child !== maskSource);
            if (resolved.mask && maskContent.length && !maskContent.some(child =>
              getNodePropertyValue(state.document, child, 'visible') !== false && fillStackForNode(child).some(fill => fill.visible !== false))) return;
            const children = resolved.mask
              ? [maskSource].filter(Boolean)
              : resolved.children || [];
            for (const child of children) paint(child, depth + 1);
          } finally { context.restore(); }
        } else {
          if (!fillStackForNode(resolved).some(fill => fill.visible !== false)
            && !strokeStackForNode(resolved).some(stroke => stroke.visible !== false && stroke.width > 0)
            && resolved.type !== 'image') return;
          this.drawNode(context, resolved, 0, 0, assets, false, 'vector', {
            ...options, motionResolvedNodeId: resolved.id
          });
        }
      } finally { active.delete(source); }
    };
    try { paint(node, 0); }
    catch (error) { this.reportInkBoundsError(node, error, renderOptions); return null; }
    return mask;
  }

  drawNodeOutline(ctx, node, x, y, assets, renderOptions = {}) {
    const state = this.getState();
    const width = node.width; const height = node.height;
    const cx = x + width / 2; const cy = y + height / 2;
    const radius = node.cornerRadii || getNodePropertyValue(state.document, node, 'radius') || 0;
    const cornerSmoothing = node.cornerSmoothing || 0;
    let booleanBoundary = false;
    ctx.beginPath();
    if (node.type === 'slice') {
      ctx.rect(x, y, width, height);
      ctx.setLineDash([4 / (state.zoom || 1), 3 / (state.zoom || 1)]);
    } else if (node.type === 'boolean') {
      try {
        traceVectorPath(ctx, getBooleanStrokePath(state.document, node), x, y);
        ctx.setLineDash([]);
        booleanBoundary = true;
      } catch {
        ctx.rect(x, y, width, height);
        ctx.setLineDash([3 / (state.zoom || 1), 2 / (state.zoom || 1)]);
      }
    } else if (node.type === 'group' && node.mask) {
      ctx.rect(x, y, width, height);
      ctx.setLineDash([]);
    } else {
      switch (node.type) {
        case 'frame':
        case 'section':
        case 'group':
        case 'rectangle':
          roundedRect(ctx, x, y, width, height, radius, cornerSmoothing);
          break;
        case 'ellipse':
          traceEllipseArc(ctx, node, x, y, width, height);
          break;
        case 'line':
          if (node.lineReverseY === true) { ctx.moveTo(x, y + height); ctx.lineTo(x + width, y); }
          else { ctx.moveTo(x, y); ctx.lineTo(x + width, y + height); }
          break;
        case 'star':
          traceRoundedPolygonPath(ctx, x, y, regularShapeVertices('star', width, height, node.points, node.innerRadius ?? 0.48), node.vertexRadii || Number(radius) || 0, cornerSmoothing);
          break;
        case 'polygon':
          traceRoundedPolygonPath(ctx, x, y, regularShapeVertices('polygon', width, height, node.points), node.vertexRadii || Number(radius) || 0, cornerSmoothing);
          break;
        case 'path':
          traceVectorPath(ctx, node, x, y);
          break;
        case 'network':
          traceVectorNetworkEdges(ctx, node, x, y);
          break;
        case 'image':
          roundedRect(ctx, x, y, width, height, radius, cornerSmoothing);
          break;
        default:
          ctx.rect(x, y, width, height);
      }
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#626b78';
    ctx.lineWidth = 1 / (state.zoom || 1);
    ctx.lineJoin = 'round';
    ctx.stroke();
    if (booleanBoundary) return;

    if (node.children?.length) {
      ctx.save();
      clipNodeContents(ctx, node, x, y, radius);
      const scrollOffset = applyPresentationScrollOffset(ctx, state, node);
      const presentationAncestors = renderOptions.presentationAncestors || [];
      const stickyScrollContext = scrollContextForChildren(node, presentationAncestors, scrollOffset, renderOptions.stickyScrollContext);
      const childRenderOptions = renderOptionsForChildren(renderOptions, node, stickyScrollContext);
      for (const child of presentationChildrenInPaintOrder(node)) {
        const childGeometry = { ...child, ...getNodeGeometry(state.document, child) };
        const effectiveOffset = scrollOffsetForPresentationChild(
          node, childGeometry, scrollOffset, stickyScrollContext, presentationAncestors
        );
        const compensationX = scrollOffset.x - effectiveOffset.x;
        const compensationY = scrollOffset.y - effectiveOffset.y;
        if (compensationX || compensationY) {
          ctx.save();
          ctx.translate(compensationX, compensationY);
          this.drawNode(ctx, child, x, y, assets, false, false, childRenderOptions);
          ctx.restore();
        } else this.drawNode(ctx, child, x, y, assets, false, false, childRenderOptions);
      }
      ctx.restore();
    }
    if (node.type === 'frame' && renderOptions.showLayoutGuides !== false) this.drawLayoutGuides(ctx, node, x, y, state);
  }

  drawLayoutGuides(ctx, frame, x, y, state = this.getState()) {
    if (!state.showLayoutGuides || frame.rotation || !Array.isArray(frame.layoutGuides) || frame.width <= 0 || frame.height <= 0) return;
    const guides = frame.layoutGuides.filter(guide => guide.visible);
    if (!guides.length) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, frame.width, frame.height); ctx.clip();
    for (const guide of guides) {
      ctx.fillStyle = rgba(guide.color, guide.opacity);
      if (guide.type === 'grid') {
        const lines = layoutGuideGridLines(guide, frame.width, frame.height);
        if (!lines.verticals.length && !lines.horizontals.length) continue;
        ctx.beginPath();
        for (const position of lines.verticals) { ctx.moveTo(x + position, y); ctx.lineTo(x + position, y + frame.height); }
        for (const position of lines.horizontals) { ctx.moveTo(x, y + position); ctx.lineTo(x + frame.width, y + position); }
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1 / (state.zoom || 1);
        ctx.stroke();
      } else {
        for (const region of layoutGuideRegions(guide, frame.width, frame.height)) ctx.fillRect(x + region.x, y + region.y, region.width, region.height);
      }
    }
    ctx.restore();
  }

  drawMaskGroup(ctx, node, x, y, assets, renderOptions = {}) {
    if (!Array.isArray(node.children) || node.children.length < 1 || node.width <= 0 || node.height <= 0) return;
    const maskNode = node.children.find(child => child.id === node.maskSourceId) || node.children[0];
    const contentNodes = node.children.filter(child => child !== maskNode);
    if (!contentNodes.length) return;
    if (node.maskMode === 'luminance' && !isLuminanceMaskWasmReady()) {
      this.loadLuminanceMaskWasm(node, renderOptions);
      return;
    }
    const transform = ctx.getTransform?.();
    const requestedScale = transform ? Math.hypot(transform.a, transform.b) : (window.devicePixelRatio || 1) * Math.max(.08, this.getState().zoom || 1);
    const { width: pixelWidth, height: pixelHeight } = booleanSurfaceDimensions(node.width, node.height, requestedScale);
    let surface; let maskContext;
    try {
      surface = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(pixelWidth, pixelHeight)
        : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
      maskContext = surface.getContext('2d');
      if (!maskContext && (!node.maskMode || node.maskMode === 'alpha')) throw new Error('The alpha-mask content canvas is unavailable.');
    } catch (error) {
      if (!node.maskMode || node.maskMode === 'alpha') { this.reportAlphaMaskError(node, error, renderOptions); return; }
      throw error;
    }
    if (!maskContext) return;
    maskContext.setTransform(pixelWidth / node.width, 0, 0, pixelHeight / node.height, 0, 0);
    for (const child of contentNodes) this.drawNode(maskContext, child, 0, 0, assets, false, false, renderOptions);
    if (node.maskMode === 'vector') {
      const vectorSurface = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(pixelWidth, pixelHeight)
        : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
      const vectorContext = vectorSurface.getContext('2d');
      if (vectorContext) {
        vectorContext.setTransform(pixelWidth / node.width, 0, 0, pixelHeight / node.height, 0, 0);
        this.drawNode(vectorContext, maskNode, 0, 0, assets, false, 'vector', renderOptions);
        maskContext.setTransform(1, 0, 0, 1, 0, 0);
        maskContext.globalCompositeOperation = 'destination-in';
        maskContext.drawImage(vectorSurface, 0, 0);
      }
    } else if (node.maskMode === 'luminance') {
      const luminanceSurface = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(pixelWidth, pixelHeight)
        : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
      const luminanceContext = luminanceSurface.getContext('2d', { willReadFrequently: true });
      if (!luminanceContext) {
        this.reportLuminanceMaskError(node, new Error('The luminance-mask canvas is unavailable.'), renderOptions);
        return;
      }
      luminanceContext.setTransform(pixelWidth / node.width, 0, 0, pixelHeight / node.height, 0, 0);
      this.drawNode(luminanceContext, maskNode, 0, 0, assets, false, false, renderOptions);
      try {
        const pixels = luminanceContext.getImageData(0, 0, pixelWidth, pixelHeight);
        applyLuminanceMaskAlpha(pixels);
        luminanceContext.putImageData(pixels, 0, 0);
      } catch (error) {
        // A tainted or unsupported readback must never turn a luminance mask
        // into an unmasked export. Skip this group and report the failure once.
        this.reportLuminanceMaskError(node, error, renderOptions);
        return;
      }
      maskContext.setTransform(1, 0, 0, 1, 0, 0);
      maskContext.globalCompositeOperation = 'destination-in';
      maskContext.drawImage(luminanceSurface, 0, 0);
    } else {
      // Alpha is the completed source layer's alpha, including its ordered
      // paints, effects and layer opacity. Applying destination-in separately
      // for every paint multiplies coverage and can erase filled interiors.
      let alphaSurface; let alphaContext;
      try {
        alphaSurface = typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(pixelWidth, pixelHeight)
          : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
        alphaContext = alphaSurface.getContext('2d');
        if (!alphaContext) throw new Error('The alpha-mask canvas is unavailable.');
        alphaContext.setTransform(pixelWidth / node.width, 0, 0, pixelHeight / node.height, 0, 0);
        this.drawNode(alphaContext, maskNode, 0, 0, assets, false, false, renderOptions);
      } catch (error) {
        this.reportAlphaMaskError(node, error, renderOptions);
        return;
      }
      maskContext.setTransform(1, 0, 0, 1, 0, 0);
      maskContext.globalCompositeOperation = 'destination-in';
      maskContext.drawImage(alphaSurface, 0, 0);
    }
    maskContext.globalCompositeOperation = 'source-over';
    ctx.drawImage(surface, x, y, node.width, node.height);
  }

  reportAlphaMaskError(node, error, renderOptions = {}) {
    if (typeof renderOptions.onRenderError === 'function') renderOptions.onRenderError(node, error);
    const errors = this.alphaMaskErrors ||= new Set();
    if (errors.has(node.id)) return;
    if (errors.size >= 256) errors.delete(errors.values().next().value);
    errors.add(node.id);
    console.warn(`Alpha mask “${node.name || node.id}” could not be rendered safely; its masked content was omitted.`, error);
    const callbacks = new Set([renderOptions.onMaskError, this.onMaskError]);
    for (const callback of callbacks) {
      if (typeof callback !== 'function') continue;
      try { callback(node, error); }
      catch (callbackError) { console.warn('The alpha-mask warning handler failed.', callbackError); }
    }
  }

  reportLuminanceMaskError(node, error, renderOptions = {}) {
    if (typeof renderOptions.onRenderError === 'function') renderOptions.onRenderError(node, error);
    if (!this.luminanceMaskErrors.has(node.id)) {
      // Keep diagnostics bounded when a renderer is reused across many files.
      if (this.luminanceMaskErrors.size >= 256) {
        this.luminanceMaskErrors.delete(this.luminanceMaskErrors.values().next().value);
      }
      this.luminanceMaskErrors.add(node.id);
      console.warn(`Luminance mask “${node.name || node.id}” could not be rendered safely; its masked content was omitted.`, error);
      const callbacks = new Set([renderOptions.onMaskError, this.onMaskError]);
      for (const callback of callbacks) {
        if (typeof callback !== 'function') continue;
        try { callback(node, error); }
        catch (callbackError) { console.warn('The luminance-mask warning handler failed.', callbackError); }
      }
    }
  }

  loadLuminanceMaskWasm(node, renderOptions) {
    if (this.destroyed) return;
    if (this.luminanceMaskWasmError) {
      this.reportLuminanceMaskError(node, this.luminanceMaskWasmError, renderOptions);
      return;
    }
    if (this.luminanceMaskWasmLoading) return;
    this.luminanceMaskWasmLoading = initializeLuminanceMaskWasm().then(() => {
      this.luminanceMaskWasmLoading = null;
      if (!this.destroyed) this.invalidate();
    }).catch(error => {
      this.luminanceMaskWasmLoading = null;
      if (this.destroyed) return;
      this.luminanceMaskWasmError = error;
      this.reportLuminanceMaskError(node, error, renderOptions);
    });
  }

  drawBooleanGroup(ctx, node, x, y, assets, maskMode = false, renderOptions = {}) {
    const state = this.getState();
    if (renderOptions.effectPaintStage !== 'stroke') {
      const transform = ctx.getTransform?.();
      const contextScale = transform ? Math.hypot(transform.a, transform.b) : (window.devicePixelRatio || 1) * Math.max(.08, state.zoom || 1);
      const surface = this.getBooleanSurface(node, assets, maskMode, contextScale, renderOptions);
      if (!maskMode && hasBlendedFillPaint(node)) drawBooleanFillStack(this, ctx, node, surface, assets, state, x, y);
      else {
        ctx.save();
        if (maskMode !== 'vector' && !Array.isArray(node.fills)) ctx.globalAlpha *= node.fillOpacity ?? 1;
        ctx.drawImage(surface, x, y, node.width, node.height);
        ctx.restore();
      }
    }
    const hasDrawableStroke = strokeStackForNode(node).some((stroke, index) => {
      if (stroke.visible === false || (maskMode !== 'vector' && Number(stroke.opacity ?? 1) <= 0)
        || Math.max(...Object.values(strokeSideWidths(stroke))) <= 0) return false;
      const color = index === 0 && node.strokeVariableId ? getNodeColor(state.document, node, 'stroke') : stroke.color;
      if (maskMode === 'vector') return true;
      if (stroke.gradient) return stroke.gradient.stops?.some(stop => Number(stop.opacity ?? 1) > 0);
      return color && color !== 'transparent';
    });
    if (renderOptions.effectPaintStage === 'fill' || !hasDrawableStroke) return;
    try {
      const path = getBooleanStrokePath(state.document, node);
      drawStrokeStack(ctx, path, state.document, x, y, node.width, node.height,
        pathContext => traceVectorPath(pathContext, path, x, y), maskMode);
      this.booleanStrokeErrors?.delete(node.id);
    } catch (error) { this.reportBooleanStrokeError(node, error, renderOptions); }
  }

  resetBooleanVectorRenderScope(document) {
    this.getState().configureBooleanTextGeometry?.(document);
    this.booleanVectorPaths ||= new Map();
    this.booleanVectorPending ||= new Map();
    this.booleanVectorFailures ||= new Map();
    if (this.booleanVectorScopeDocument === document && this.booleanVectorScopePage === document.activePageId
      && this.booleanVectorUnregister?.isRegistered() && this.booleanVectorTextUnregister?.isRegistered()) return;
    this.booleanVectorUnregister?.();
    this.booleanVectorTextUnregister?.();
    for (const ticket of this.booleanVectorPending.values()) ticket.controller.abort();
    this.booleanVectorPending.clear(); this.booleanVectorFailures.clear();
    this.booleanVectorPaths.clear(); this.booleanVectorPathBytes = 0; this.booleanVectorBudgetError = null;
    this.booleanVectorScopeDocument = document; this.booleanVectorScopePage = document.activePageId;
    this.booleanVectorUnregister = registerBooleanVectorGeometryProvider(key => {
      if (this.destroyed || this.getState().document !== document || document.activePageId !== this.booleanVectorScopePage) return null;
      for (const entry of this.booleanVectorPaths.values()) if (entry.key === key) return entry;
      return null;
    });
    this.booleanVectorTextUnregister = registerBooleanTextGeometryProvider(document, key => {
      if (this.destroyed || this.getState().document !== document || document.activePageId !== this.booleanVectorScopePage) return null;
      for (const entry of this.booleanVectorPaths.values()) {
        const geometry = entry.textGeometryPlan?.geometryForKey(key);
        if (geometry) return geometry;
      }
      return null;
    });
  }

  pruneBooleanVectorRenderScope(document) {
    this.resetBooleanVectorRenderScope(document);
    const page = document.pages.find(value => value.id === document.activePageId);
    const live = new Set(); const stack = [...(page?.children || [])];
    while (stack.length) {
      const node = stack.pop();
      if (getNodePropertyValue(document, node, 'visible') === false) continue;
      if (node.type === 'boolean' && node.booleanGeometry === 'vector') live.add(node.id);
      else for (const child of node.children || []) stack.push(child);
    }
    for (const [id, entry] of this.booleanVectorPaths) if (!live.has(id)) {
      this.booleanVectorPaths.delete(id); this.booleanVectorPathBytes -= entry.bytes; this.booleanVectorBudgetError = null;
    }
    for (const [id, ticket] of this.booleanVectorPending) if (!live.has(id)) {
      ticket.controller.abort(); this.booleanVectorPending.delete(id);
    }
    for (const id of this.booleanVectorFailures.keys()) if (!live.has(id)) this.booleanVectorFailures.delete(id);
  }

  booleanVectorRenderKey(node, document, options = {}) {
    return getBooleanVectorGeometryKey(document, node, options);
  }

  booleanVectorPreparationKey(node, document, options = {}) {
    const settings = getBooleanTextGeometryOptions(document, options);
    const ancestors = new Set(); let count = 0;
    const visit = (source, depth = 0) => {
      if (!source || typeof source !== 'object' || ancestors.has(source) || depth > 32 || ++count > 256) {
        throw new Error('The Boolean sources exceed the local preparation limit.');
      }
      ancestors.add(source);
      const resolved = resolveBooleanSourceNode(document, source);
      const current = options.resolveNode?.(resolved) ?? resolved;
      const result = { ...current, children: (current.children || []).map(child => visit(child, depth + 1)) };
      ancestors.delete(source); return result;
    };
    // This admission key exists before glyph contours are ready. Recompute the
    // exact native key only after preparation; never pin a pending key as ink.
    const key = JSON.stringify([visit(node), document.variables, document.variableCollections,
      document.typographyStyles, document.colorStyles, settings.getFontRevision?.()]);
    if (key.length > 2 * 1024 * 1024) throw new Error('These Boolean sources exceed the local preparation memory limit.');
    return key;
  }

  retainBooleanVectorRenderPath(node, key, document, path) {
    const previous = this.booleanVectorPaths.get(node.id);
    const geometry = structuredClone({ points: path.points, closed: path.closed, fillRule: path.fillRule,
      ...(path.subpaths ? { subpaths: path.subpaths } : {}) });
    const bounds = structuredClone(path.__booleanGeometryBounds);
    const textGeometryPlan = path.__booleanTextGeometryPlan || null;
    const bytes = (key.length + JSON.stringify(geometry).length + JSON.stringify(bounds).length) * 2
      + (textGeometryPlan?.bytes || 0);
    const nextBytes = this.booleanVectorPathBytes - (previous?.bytes || 0) + bytes;
    // Visible regions must stay retained together. LRU eviction here causes a
    // redraw to continuously recompute a page larger than the shared cache.
    if (nextBytes > 32 * 1024 * 1024 || !previous && this.booleanVectorPaths.size >= 4096) {
      const error = new Error('This page exceeds the local Boolean preview geometry budget. Hide or remove some Boolean layers, or simplify their sources.');
      error.code = 'BOOLEAN_VECTOR_RENDER_LIMIT'; this.booleanVectorBudgetError = error; throw error;
    }
    this.booleanVectorPaths.set(node.id, { document, key, geometry, bounds, textGeometryPlan, bytes });
    this.booleanVectorPathBytes = nextBytes;
  }

  getRenderedBooleanVectorPath(node, options = {}) {
    const document = this.getState().document;
    this.resetBooleanVectorRenderScope(document);
    const key = this.booleanVectorRenderKey(node, document, options);
    const entry = this.booleanVectorPaths.get(node.id);
    if (entry?.document === document && entry.key === key) {
      const resolved = resolveBooleanSourceNode(document, node);
      const { children, ...own } = options.resolveNode?.(resolved) ?? resolved;
      return { ...own, ...structuredClone(entry.geometry), type: 'path', children: [], __booleanGeometryBounds: { ...entry.bounds } };
    }
    if (entry) {
      this.booleanVectorPaths.delete(node.id); this.booleanVectorPathBytes -= entry.bytes; this.booleanVectorBudgetError = null;
    }
    if (this.booleanVectorBudgetError) throw this.booleanVectorBudgetError;
    const path = getBooleanVectorPath(document, node, options);
    this.retainBooleanVectorRenderPath(node, key, document, path);
    return path;
  }

  loadBooleanVectorPath(node, options = {}) {
    if (this.destroyed) return;
    const document = this.getState().document;
    this.resetBooleanVectorRenderScope(document);
    if (this.booleanVectorBudgetError) { this.reportBooleanStrokeError(node, this.booleanVectorBudgetError); return; }
    let key;
    try { key = this.booleanVectorPreparationKey(node, document, options); }
    catch (error) { this.reportBooleanStrokeError(node, error); return; }
    const previous = this.booleanVectorPending.get(node.id);
    if (previous?.document === document && previous.key === key) return;
    if (!previous && this.booleanVectorPending.size >= 4) return;
    if (!options.retry && this.booleanVectorFailures.get(node.id)?.key === key
      && this.booleanVectorFailures.get(node.id)?.document === document) return;
    this.booleanVectorFailures.delete(node.id);
    previous?.controller.abort();
    const controller = new AbortController();
    const ticket = { key, document, pageId: document.activePageId, controller };
    this.booleanVectorPending.set(node.id, ticket);
    const prepare = this.getState().prepareBooleanVectorPath || prepareBooleanVectorPath;
    prepare(document, node, { ...options, signal: controller.signal }).then(path => {
      if (controller.signal.aborted || this.destroyed || this.getState().document !== document
        || document.activePageId !== ticket.pageId || this.booleanVectorPending.get(node.id) !== ticket) return;
      if (this.booleanVectorPreparationKey(node, document, options) !== key) return;
      this.retainBooleanVectorRenderPath(node, this.booleanVectorRenderKey(node, document, options), document, path);
    }).catch(error => {
      if (['BOOLEAN_VECTOR_QUEUE_FULL', 'VECTOR_GEOMETRY_QUEUE_FULL', 'BOOLEAN_TEXT_QUEUE_FULL'].includes(error.code)) {
        ticket.deferred = true;
        if (!this.destroyed && !this.booleanVectorRetryTimer) this.booleanVectorRetryTimer = setTimeout(() => {
          this.booleanVectorRetryTimer = null; this.invalidate();
        }, 400);
        return;
      }
      if (!controller.signal.aborted && !this.destroyed && this.getState().document === document
        && !['AbortError'].includes(error.name) && !['BOOLEAN_VECTOR_STALE', 'BOOLEAN_TEXT_STALE'].includes(error.code)) {
        if (this.booleanVectorFailures.size >= 256) this.booleanVectorFailures.delete(this.booleanVectorFailures.keys().next().value);
        this.booleanVectorFailures.set(node.id, { key, document });
        this.reportBooleanStrokeError(node, error);
      }
    }).finally(() => {
      if (this.booleanVectorPending.get(node.id) === ticket) {
        this.booleanVectorPending.delete(node.id);
        if (!ticket.deferred && !this.destroyed && this.getState().document === document) {
          this.invalidate(); this.onVectorGeometryReady?.(node);
        }
      }
    });
  }

  reportBooleanStrokeError(node, error, renderOptions = {}) {
    // Export collectors must hear every failure, even after the visible editor
    // already reported this source state. Only repeated UI warnings are muted.
    if (typeof renderOptions.onStrokeError === 'function') renderOptions.onStrokeError(node, error);
    if (typeof renderOptions.onRenderError === 'function') renderOptions.onRenderError(node, error);
    this.booleanStrokeErrors ||= new Map();
    if (this.booleanStrokeErrors.get(node.id) === error.message) return;
    if (this.booleanStrokeErrors.size >= 256) this.booleanStrokeErrors.delete(this.booleanStrokeErrors.keys().next().value);
    this.booleanStrokeErrors.set(node.id, error.message);
    console.warn(`Boolean outline “${node.name || node.id}” was omitted safely.`, error);
    if (typeof this.onStrokeError === 'function') this.onStrokeError(node, error);
  }

  getBooleanSurface(node, assets, maskMode = false, contextScale = null, renderOptions = {}) {
    const state = this.getState();
    const cacheContainsMaskOnly = !maskMode && hasBlendedFillPaint(node);
    const fill = maskMode ? '#ffffff' : cacheContainsMaskOnly ? '' : getNodeColor(state.document, node, 'fill');
    const requestedScale = contextScale ?? (window.devicePixelRatio || 1) * Math.max(.08, state.zoom || 1);
    const { width, height } = booleanSurfaceDimensions(node.width, node.height, requestedScale);
    const fillPreviewVersions = (node.fills || []).filter(fillLayer => fillLayer.type === 'image').map(fillLayer => {
      const previewKey = imagePreviewKey(node.id, fillLayer.id);
      return [previewKey, state.previewVersions?.get(previewKey) || 0, state.previewAssetIds?.get(previewKey) || null];
    });
    const legacyPreviewKey = !Array.isArray(node.fills) && node.imageFill ? imagePreviewKey(node.id) : null;
    const imagePreviewVersion = legacyPreviewKey
      ? [legacyPreviewKey, state.previewVersions?.get(legacyPreviewKey) || 0, state.previewAssetIds?.get(legacyPreviewKey) || null]
      : null;
    const resolvedChildren = node.children.map(child => booleanNodeCacheState(state.document, child));
    let cacheNode = node;
    if (cacheContainsMaskOnly) {
      // These paints are drawn against the live destination after the Boolean
      // mask is fetched. Excluding them prevents animation progress from
      // manufacturing a new cached alpha mask for every frame.
      cacheNode = { ...node };
      for (const property of ['fills', 'fill', 'fillGradient', 'imageFill', 'fillOpacity', 'fillVariableId', 'fillStyleId', '__smartAnimateImageFillTransition']) {
        delete cacheNode[property];
      }
    }
    const cacheMode = maskMode === 'vector' ? 'vector-mask' : maskMode ? 'alpha-mask' : 'paint';
    const key = `${cacheMode}|${JSON.stringify(cacheNode)}|${JSON.stringify(resolvedChildren)}|${fill}|${JSON.stringify([imagePreviewVersion, fillPreviewVersions])}|${width}x${height}`;
    let entry = this.booleanCache.get(key);
    if (entry) {
      this.booleanCache.delete(key);
      this.booleanCache.set(key, entry);
      if (typeof renderOptions.onRenderError === 'function') {
        for (const failure of entry.renderErrors || []) renderOptions.onRenderError(failure.node, failure.error);
      }
    } else {
      const renderErrors = [];
      const sourceRenderOptions = { ...renderOptions, effectPaintStage: undefined, onRenderError: (sourceNode, error) => {
        if (renderErrors.length < 256 && !renderErrors.some(failure => failure.node.id === sourceNode.id && failure.error.message === error.message)) {
          renderErrors.push({ node: sourceNode, error });
        }
        if (typeof renderOptions.onRenderError === 'function') renderOptions.onRenderError(sourceNode, error);
      } };
      const surface = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
      const mask = surface.getContext('2d');
      const pixelScaleX = width / Math.max(1, node.width);
      const pixelScaleY = height / Math.max(1, node.height);
      mask.setTransform(pixelScaleX, 0, 0, pixelScaleY, 0, 0);
      const sourceTransform = booleanSourceTransform(resolvedChildren, node.width, node.height);
      mask.setTransform(
        pixelScaleX * sourceTransform.scaleX, 0, 0, pixelScaleY * sourceTransform.scaleY,
        -pixelScaleX * sourceTransform.left * sourceTransform.scaleX,
        -pixelScaleY * sourceTransform.top * sourceTransform.scaleY
      );
      const operation = node.operation || 'union';
      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        const visible = Boolean(resolvedChildren[index].visible);
        if (!visible && operation !== 'intersect') continue;
        mask.save();
        if (index === 0 || operation === 'union') mask.globalCompositeOperation = 'source-over';
        else if (operation === 'subtract') mask.globalCompositeOperation = 'destination-out';
        else if (operation === 'intersect') mask.globalCompositeOperation = 'destination-in';
        else if (operation === 'exclude') mask.globalCompositeOperation = 'xor';
        this.drawNode(mask, child, 0, 0, assets, false, maskMode === 'vector' ? 'vector' : true,
          sourceRenderOptions);
        mask.restore();
        if (!visible && operation === 'intersect') {
          mask.setTransform(pixelScaleX, 0, 0, pixelScaleY, 0, 0);
          mask.clearRect(0, 0, node.width, node.height);
          break;
        }
      }
      // Boolean source geometry is scaled into the current group bounds above.
      // Paint the completed mask and group fills back in the unscaled surface box.
      mask.setTransform(pixelScaleX, 0, 0, pixelScaleY, 0, 0);
      if (hasBlendedFillPaint(node) && !maskMode) {
        // Keep only the Boolean alpha mask in the cache. Paint blend modes
        // depend on the live page backdrop, so they are drawn in order by
        // drawBooleanFillStack when this cached mask is presented.
      } else if (maskMode === 'vector') {
        // The operand union/intersection surface is already the vector mask;
        // source paints and their alpha must not modulate its geometry.
      } else if (Array.isArray(node.fills)) {
        const createSurface = () => typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(width, height)
          : Object.assign(document.createElement('canvas'), { width, height });
        const alphaSurface = createSurface();
        alphaSurface.getContext('2d').drawImage(surface, 0, 0);
        const paintSurface = createSurface();
        const paintContext = paintSurface.getContext('2d');
        paintContext.setTransform(width / Math.max(1, node.width), 0, 0, height / Math.max(1, node.height), 0, 0);
        mask.clearRect(0, 0, node.width, node.height);
        mask.globalCompositeOperation = 'source-over';
        for (let fillIndex = 0; fillIndex < node.fills.length; fillIndex += 1) {
          const fillLayer = node.fills[fillIndex];
          if (!fillLayer.visible || fillLayer.opacity <= 0) continue;
          paintContext.clearRect(0, 0, node.width, node.height);
          paintContext.globalCompositeOperation = 'source-over';
          paintContext.globalAlpha = fillLayer.opacity;
          if (fillLayer.type === 'solid') {
            const color = fillLayerColor(state.document, node, fillLayer, fillIndex);
            if (!color || color === 'transparent') continue;
            paintContext.fillStyle = color; paintContext.fillRect(0, 0, node.width, node.height);
          } else if (gradientTypes.has(fillLayer.type)) {
            const paint = createGradientPaint(paintContext, fillLayer.gradient, 0, 0, node.width, node.height);
            if (!paint) continue;
            paintContext.fillStyle = paint; paintContext.fillRect(0, 0, node.width, node.height);
          } else if (fillLayer.type === 'image') {
            const imageFill = fillLayer.imageFill;
            const liveSource = fillLayer.__smartAnimateLiveImageFill ? assets.get(imageFill.assetId)?.bitmap : null;
            const image = liveSource || imageForNode(node, assets, state, imageFill.assetId, imagePreviewKey(node.id, fillLayer.id));
            if (!image) continue;
            drawImageWithFitMode(paintContext, image, node, assets, imageFill.assetId, 0, 0, node.width, node.height,
              imageFill.fit, imageFill.scalingFactor, imageFill.transforms, Boolean(liveSource));
          }
          paintContext.globalAlpha = 1;
          paintContext.globalCompositeOperation = 'destination-in';
          paintContext.drawImage(alphaSurface, 0, 0, node.width, node.height);
          mask.globalAlpha = 1;
          mask.globalCompositeOperation = 'source-over';
          mask.drawImage(paintSurface, 0, 0, node.width, node.height);
        }
      } else {
        mask.save();
        mask.globalCompositeOperation = 'source-in';
        const liveSource = node.__smartAnimateLiveImageFill && node.imageFill ? assets.get(node.imageFill.assetId)?.bitmap : null;
        const fillImage = liveSource || (node.imageFill ? imageForNode(node, assets, state, node.imageFill.assetId) : null);
        if (fillImage) {
          drawImageWithFitMode(mask, fillImage, node, assets, node.imageFill.assetId, 0, 0, node.width, node.height,
            node.imageFill.fit, node.imageFill.scalingFactor, node.imageFill.transforms, Boolean(liveSource));
        }
        else {
          const resolvedFill = node.fillGradient
            ? createGradientPaint(mask, node.fillGradient, 0, 0, node.width, node.height)
            : node.fill;
          if (resolvedFill && resolvedFill !== 'transparent') {
            mask.fillStyle = resolvedFill;
            mask.fillRect(0, 0, node.width, node.height);
          }
        }
        mask.restore();
      }
      entry = { surface, pixels: width * height, renderErrors };
      this.booleanCache.set(key, entry);
      this.booleanCachePixels += entry.pixels;
      while (this.booleanCache.size > 6 || this.booleanCachePixels > 8_000_000) {
        const oldestKey = this.booleanCache.keys().next().value;
        if (oldestKey === key && this.booleanCache.size === 1) break;
        const oldest = this.booleanCache.get(oldestKey);
        this.booleanCache.delete(oldestKey);
        this.booleanCachePixels -= oldest.pixels;
      }
    }
    return entry.surface;
  }

  hitTestBoolean(node, point, originX, originY) {
    if (node.booleanGeometry === 'vector') {
      try {
        const local = pageToNodeLocal({ ...node, x: originX, y: originY }, point);
        return hitTestVisibleGeometry(getBooleanVectorPath(this.getState().document, node), local, { document: this.getState().document });
      } catch { return false; }
    }
    if (node.width <= 0 || node.height <= 0) return false;
    const center = { x: originX + node.width / 2, y: originY + node.height / 2 };
    const angle = -(node.rotation || 0) * Math.PI / 180;
    const dx = point.x - center.x; const dy = point.y - center.y;
    const localX = center.x + dx * Math.cos(angle) - dy * Math.sin(angle) - originX;
    const localY = center.y + dx * Math.sin(angle) + dy * Math.cos(angle) - originY;
    if (localX < 0 || localY < 0 || localX > node.width || localY > node.height) return false;
    const surface = this.getBooleanSurface(node, this.getState().assets, true);
    const pixelX = Math.min(surface.width - 1, Math.floor(localX / node.width * surface.width));
    const pixelY = Math.min(surface.height - 1, Math.floor(localY / node.height * surface.height));
    return surface.getContext('2d').getImageData(pixelX, pixelY, 1, 1).data[3] > 8;
  }

  drawPenDraft(ctx, draft, hover, zoom = 1, transform = null) {
    const points = (draft.anchors || []).map(point => transform ? {
      ...point,
      ...transform(point),
      in: transform(point.in), out: transform(point.out)
    } : point);
    if (!points.length) return;
    const scale = 1 / Math.max(.08, zoom || 1);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]; const current = points[index];
      if (previous.out.x !== previous.x || previous.out.y !== previous.y || current.in.x !== current.x || current.in.y !== current.y) ctx.bezierCurveTo(previous.out.x, previous.out.y, current.in.x, current.in.y, current.x, current.y);
      else ctx.lineTo(current.x, current.y);
    }
    if (hover && points.length) {
      const last = points.at(-1);
      if (last.out.x !== last.x || last.out.y !== last.y) ctx.bezierCurveTo(last.out.x, last.out.y, hover.x, hover.y, hover.x, hover.y);
      else ctx.lineTo(hover.x, hover.y);
    }
    ctx.setLineDash([6 * scale, 4 * scale]); ctx.lineWidth = 1.5 * scale; ctx.strokeStyle = BLUE; ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#ffffff'; ctx.strokeStyle = BLUE; ctx.lineWidth = scale;
    for (const point of points) {
      for (const part of ['in', 'out']) {
        const handle = point[part];
        if (handle.x === point.x && handle.y === point.y) continue;
        ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(handle.x, handle.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(handle.x, handle.y, 3.5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.rect(point.x - 4 * scale, point.y - 4 * scale, 8 * scale, 8 * scale); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  drawPencilDraft(ctx, draft, zoom = 1) {
    const points = draft?.points || [];
    if (!points.length) return;
    const scale = 1 / Math.max(.08, zoom || 1);
    if (draft.variableWidth) {
      const outline = variableStrokeOutlineFromSamples(points, { maxWidth: draft.maxWidth || 8 });
      if (outline) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(outline[0].x, outline[0].y);
        for (const point of outline.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(13,153,255,.55)';
        ctx.strokeStyle = BLUE;
        ctx.lineWidth = 1 / Math.max(.08, zoom || 1);
        ctx.fill(); ctx.stroke(); ctx.restore();
      }
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 2) ctx.lineTo(points[1].x, points[1].y);
    else {
      for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index];
        const next = points[index + 1];
        ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
      }
      const last = points.at(-1);
      ctx.lineTo(last.x, last.y);
    }
    ctx.lineWidth = 2.25 * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = BLUE;
    ctx.stroke();
    ctx.restore();
  }

  drawImageCropSelection(ctx, entry, overlay, draft, zoom = 1) {
    const { node, ancestors } = entry;
    const nodeTransform = nodeLocalToPageTransform(node, ancestors);
    const pagePoint = point => transformPoint(nodeTransform, point);
    const scale = 1 / Math.max(.08, zoom || 1);
    const isBounds = bounds => bounds
      && [bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)
      && bounds.width > 0 && bounds.height > 0;
    const cornersFor = bounds => [
      { x: bounds.left, y: bounds.top },
      { x: bounds.left + bounds.width, y: bounds.top },
      { x: bounds.left + bounds.width, y: bounds.top + bounds.height },
      { x: bounds.left, y: bounds.top + bounds.height }
    ].map(pagePoint);
    const drawBoundsPath = (bounds, { color, dash = [], lineWidth = 1.5 } = {}) => {
      if (!isBounds(bounds)) return false;
      const corners = cornersFor(bounds);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let index = 1; index < corners.length; index += 1) ctx.lineTo(corners[index].x, corners[index].y);
      ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth * scale;
      ctx.setLineDash?.(dash.map(value => value * scale));
      ctx.stroke();
      ctx.setLineDash?.([]);
      return true;
    };

    ctx.save();
    // The virtual outline exposes the full source extent when the current crop
    // is smaller than the image. Keep the active crop edge visually stronger.
    const virtual = overlay.virtualBounds;
    const current = overlay.drawBounds;
    const boundsDiffer = isBounds(virtual) && isBounds(current)
      && ['left', 'top', 'width', 'height'].some(key => Math.abs(virtual[key] - current[key]) > 1e-6);
    if (boundsDiffer) {
      const virtualCorners = cornersFor(virtual);
      const currentCorners = cornersFor(current);
      ctx.beginPath();
      for (const corners of [virtualCorners, currentCorners]) {
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let index = 1; index < corners.length; index += 1) ctx.lineTo(corners[index].x, corners[index].y);
        ctx.closePath();
      }
      ctx.fillStyle = 'rgba(17,24,39,.3)';
      ctx.fill('evenodd');
      drawBoundsPath(virtual, { color: 'rgba(255,255,255,.9)', dash: [3, 4], lineWidth: 1 });
    }
    const hasCurrentBounds = drawBoundsPath(current, { color: BLUE, dash: [6, 3], lineWidth: 1.5 });

    const selection = draft?.nodeId === node.id ? draft : null;
    if (selection && [selection.start?.x, selection.start?.y, selection.end?.x, selection.end?.y].every(Number.isFinite)) {
      const rect = {
        left: Math.min(selection.start.x, selection.end.x),
        top: Math.min(selection.start.y, selection.end.y),
        width: Math.abs(selection.end.x - selection.start.x),
        height: Math.abs(selection.end.y - selection.start.y)
      };
      if (isBounds(rect)) {
        const corners = cornersFor(rect);
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let index = 1; index < corners.length; index += 1) ctx.lineTo(corners[index].x, corners[index].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(13,153,255,.14)';
        ctx.fill();
        ctx.strokeStyle = BLUE;
        ctx.lineWidth = 2 * scale;
        ctx.setLineDash?.([4 * scale, 3 * scale]);
        ctx.stroke();
        ctx.setLineDash?.([]);
      }
    }

    if (hasCurrentBounds) {
      const bounds = current;
      const left = bounds.left; const top = bounds.top;
      const right = left + bounds.width; const bottom = top + bounds.height;
      const middleX = (left + right) / 2; const middleY = (top + bottom) / 2;
      const handles = [
        { x: left, y: top }, { x: middleX, y: top }, { x: right, y: top },
        { x: right, y: middleY }, { x: right, y: bottom }, { x: middleX, y: bottom },
        { x: left, y: bottom }, { x: left, y: middleY }
      ];
      const hitSize = 48 * scale;
      const visibleSize = 14 * scale;
      for (const point of handles) {
        const mapped = pagePoint(point);
        // Match the 24 CSS-pixel radius used by imageCropHandleAt(); this
        // transparent pad does not obscure the artwork.
        ctx.beginPath();
        ctx.rect(mapped.x - hitSize / 2, mapped.y - hitSize / 2, hitSize, hitSize);
        ctx.fillStyle = 'rgba(13,153,255,.001)';
        ctx.fill();
        ctx.beginPath();
        ctx.rect(mapped.x - visibleSize / 2, mapped.y - visibleSize / 2, visibleSize, visibleSize);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = BLUE;
        ctx.lineWidth = 1.5 * scale;
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawSelection(ctx, nodes, selectedIds, parentX, parentY) {
    const state = this.getState();
    const selected = [];
    const collect = (list, ancestors = []) => {
      for (const node of list) {
        const geometry = getNodeGeometry(state.document, node);
        const resolvedNode = { ...node, ...geometry, ...(state.motionPreview?.get(node.id) || {}), ...(node.type === 'slice' ? { rotation: 0 } : {}) };
        if (selectedIds.includes(node.id)) selected.push({ node: resolvedNode, ancestors });
        collect(node.children || [], [...ancestors, resolvedNode]);
      }
    };
    collect(nodes, []);
    if (!selected.length) return;
    const zoom = Math.max(.08, state.zoom || 1);
    const size = 6 / zoom;
    const cropOverlay = state.imageCropMode ? state.imageCropOverlay : null;
    const cropEntry = cropOverlay?.nodeId
      ? selected.find(entry => entry.node.id === cropOverlay.nodeId && entry.node.type === 'image') || null
      : null;
    ctx.save();
    ctx.strokeStyle = BLUE; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 1 / (state.zoom || 1);
    for (const entry of selected) {
      const selectionNode = entry.node.type === 'slice' ? { ...entry.node, rotation: 0 } : entry.node;
      const { corners } = selectionOverlayGeometry(selectionNode, entry.ancestors, { zoom, rotateOffset: 0 });
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let index = 1; index < corners.length; index += 1) ctx.lineTo(corners[index].x, corners[index].y);
      ctx.closePath(); ctx.stroke();
    }
    if (cropEntry) this.drawImageCropSelection(ctx, cropEntry, cropOverlay, state.imageCropDraftSelection, zoom);
    const selectedIdsSet = new Set(selectedIds);
    const roots = selected.filter(entry => !entry.ancestors.some(parent => selectedIdsSet.has(parent.id)));
    const groupTransformAllowed = roots.length > 1 && roots.every(({ node, ancestors }) =>
      node.type !== 'slice' && !node.locked && !ancestors.some(parent => parent.locked)
      && !(ancestors.at(-1)?.autoLayout && node.layoutPositioning !== 'absolute')
      && !['x', 'y', 'width', 'height', 'rotation'].some(property => node.variableBindings?.[property]));
    const cropTargetId = state.imageCropMode ? state.imageCropOverlay?.nodeId : null;
    const cropTargetIsRoot = cropTargetId && roots.some(entry => entry.node.id === cropTargetId);
    let scalePlan = null;
    if (state.tool === 'scale' && roots.length && !cropTargetIsRoot) {
      try {
        scalePlan = planScaleTransform(roots, 1, state.scaleAnchor, {
          resolveBoundProperty: (node, property) => getNodePropertyValue(state.document, node, property)
        });
      } catch { scalePlan = null; }
    }
    if (scalePlan?.bounds && scalePlan.patches.length) {
      const bounds = scalePlan.bounds;
      const handles = selectionGroupHandles(bounds, { rotateOffset: 0 });
      ctx.beginPath(); ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height); ctx.stroke();
      for (const point of Object.values(handles.resize)) {
        ctx.beginPath(); ctx.rect(point.x - size / 2, point.y - size / 2, size, size); ctx.fill(); ctx.stroke();
      }
      const anchorCoordinates = {
        'top-left': [0, 0], top: [.5, 0], 'top-right': [1, 0],
        left: [0, .5], center: [.5, .5], right: [1, .5],
        'bottom-left': [0, 1], bottom: [.5, 1], 'bottom-right': [1, 1]
      }[state.scaleAnchor] || [.5, .5];
      const anchor = { x: bounds.x + bounds.width * anchorCoordinates[0], y: bounds.y + bounds.height * anchorCoordinates[1] };
      ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 4 / zoom, 0, Math.PI * 2);
      ctx.fillStyle = BLUE; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5 / zoom; ctx.stroke();
    } else if (roots.length > 1 && groupTransformAllowed && !cropTargetIsRoot) {
      const bounds = selectionBounds(roots);
      const handles = selectionGroupHandles(bounds, { rotateOffset: 24 / zoom });
      const north = handles.resize.n;
      ctx.beginPath(); ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height); ctx.stroke();
      if (north) {
        ctx.beginPath(); ctx.moveTo(north.x, north.y); ctx.lineTo(handles.rotate.x, handles.rotate.y); ctx.stroke();
      }
      for (const point of Object.values(handles.resize)) {
        ctx.beginPath(); ctx.rect(point.x - size / 2, point.y - size / 2, size, size); ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(handles.rotate.x, handles.rotate.y, size * .65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (roots.length === 1 && roots[0].node.type === 'slice' && roots[0].node.id !== cropTargetId) {
      const { node } = roots[0];
      const sourceNode = findNode(state.document, node.id)?.node;
      const hasBoundGeometry = ['x', 'y', 'width', 'height', 'rotation'].some(property => sourceNode?.variableBindings?.[property]);
      const handles = !node.locked && !hasBoundGeometry ? sliceSelectionHandles({ ...node, rotation: 0 }) : null;
      for (const point of Object.values(handles?.resize || {})) {
        ctx.beginPath(); ctx.rect(point.x - size / 2, point.y - size / 2, size, size); ctx.fill(); ctx.stroke();
      }
    } else if (roots.length === 1 && roots[0].node.type !== 'slice' && roots[0].node.id !== cropTargetId) {
      const { node, ancestors } = roots[0];
      const overlay = selectionOverlayGeometry(node, ancestors, { zoom });
      const resizePoints = Object.values(overlay.handles.resize);
      const north = overlay.handles.resize.n;
      const rotate = overlay.handles.rotate;
      ctx.beginPath(); ctx.moveTo(north.x, north.y); ctx.lineTo(rotate.x, rotate.y); ctx.stroke();
      for (const point of resizePoints) {
        ctx.beginPath(); ctx.rect(point.x - size / 2, point.y - size / 2, size, size); ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(rotate.x, rotate.y, size * .65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      const nodeTransform = nodeLocalToPageTransform(node, ancestors);
      const pagePoint = point => transformPoint(nodeTransform, point);
      if (selected.length === 1 && node.type === 'star' && state.tool === 'select'
        && !state.layerSelectionMode && !state.presenting && !state.imageCropMode
        && !(state.inspectorTab === 'motion' && state.motionPreview)
        && !node.locked && !ancestors.some(parent => parent.locked)) {
        const source = findNode(state.document, node.id)?.node || node;
        const controls = starControlHandles({
          ...node,
          points: getNodePropertyValue(state.document, source, 'points') ?? source.points ?? node.points,
          innerRadius: getNodePropertyValue(state.document, source, 'innerRadius') ?? source.innerRadius ?? node.innerRadius,
          radius: getNodePropertyValue(state.document, source, 'radius') ?? source.radius ?? node.radius
        }, zoom);
        for (const handle of controls) {
          const point = pagePoint(handle.point);
          const active = state.interaction?.kind === 'star-control'
            && state.interaction.node?.id === node.id && state.interaction.handle?.kind === handle.kind;
          ctx.save();
          ctx.strokeStyle = BLUE;
          ctx.fillStyle = active ? BLUE : '#ffffff';
          ctx.lineWidth = 1.5 / zoom;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 5 / zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = active ? '#ffffff' : BLUE;
          ctx.font = `${9 / zoom}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const labelWidth = (handle.label.length * 5.5 + 10) / zoom;
          const labelHeight = 13 / zoom;
          const labelX = point.x - labelWidth / 2;
          const labelY = point.y + 8 / zoom;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
          ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);
          ctx.fillStyle = BLUE;
          ctx.fillText(handle.label, point.x, labelY + labelHeight / 2);
          ctx.restore();
        }
      }
      if (selected.length === 1 && node.type === 'ellipse' && state.tool === 'select'
        && !state.layerSelectionMode && !state.presenting && !state.imageCropMode
        && !(state.inspectorTab === 'motion' && state.motionPreview)
        && !node.locked && !ancestors.some(parent => parent.locked)) {
        const source = findNode(state.document, node.id)?.node || node;
        const controls = ellipseArcControlHandles({ ...node, arcData: source.arcData || node.arcData }, zoom);
        for (const handle of controls) {
          const point = pagePoint(handle.point);
          const active = state.interaction?.kind === 'ellipse-arc-control'
            && state.interaction.node?.id === node.id && state.interaction.handle?.kind === handle.kind;
          ctx.save();
          ctx.strokeStyle = BLUE;
          ctx.fillStyle = active ? BLUE : '#ffffff';
          ctx.lineWidth = 1.5 / zoom;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 5 / zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = active ? '#ffffff' : BLUE;
          ctx.font = `${9 / zoom}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const labelWidth = (handle.label.length * 5.5 + 10) / zoom;
          const labelHeight = 13 / zoom;
          const labelY = point.y + 8 / zoom;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(point.x - labelWidth / 2, labelY, labelWidth, labelHeight);
          ctx.strokeRect(point.x - labelWidth / 2, labelY, labelWidth, labelHeight);
          ctx.fillStyle = BLUE;
          ctx.fillText(handle.label, point.x, labelY + labelHeight / 2);
          ctx.restore();
        }
      }
      if (selected.length === 1 && state.tool === 'select' && !state.layerSelectionMode && !state.presenting
        && !(state.inspectorTab === 'motion' && state.motionPreview) && node.type === 'frame'
        && node.autoLayout?.axis === 'grid' && !node.locked && !ancestors.some(parent => parent.locked)) {
        for (const handle of gridTrackResizeHandles(node)) {
          const point = pagePoint(handle.point);
          const vertical = handle.axis === 'columnTracks';
          const width = (vertical ? 6 : 18) / zoom;
          const height = (vertical ? 18 : 6) / zoom;
          ctx.beginPath();
          ctx.rect(point.x - width / 2, point.y - height / 2, width, height);
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = BLUE;
          ctx.lineWidth = 1 / zoom;
          ctx.fill();
          ctx.stroke();
        }
      }
      if (selected.length === 1 && node.type === 'path') {
        const selection = this.getState().selectedVectorPoint;
        const selectedPointIndex = selection?.nodeId === node.id ? selection.index : -1;
        const selectedContourIndex = selection?.nodeId === node.id ? selection.contourIndex || 0 : -1;
        const selectedAnchorKeys = new Set((this.getState().selectedVectorPoints || [])
          .filter(anchor => anchor.nodeId === node.id)
          .map(anchor => `${anchor.contourIndex}\0${anchor.index}`));
        for (const [contourIndex, contour] of vectorPathContours(node).entries()) {
          for (const [index] of contour.points.entries()) {
            const anchor = pagePoint(vectorNodePoint(node, index, 'anchor', { x: 0, y: 0 }, contourIndex));
            for (const part of ['in', 'out']) {
              const control = pagePoint(vectorNodePoint(node, index, part, { x: 0, y: 0 }, contourIndex));
              if (Math.hypot(control.x - anchor.x, control.y - anchor.y) < size) continue;
              ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(control.x, control.y); ctx.stroke();
              ctx.beginPath(); ctx.arc(control.x, control.y, size * .65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }
            const selectedAnchor = selectedAnchorKeys.has(`${contourIndex}\0${index}`)
              || (selectedAnchorKeys.size === 0 && selectedContourIndex === contourIndex && selectedPointIndex === index);
            ctx.fillStyle = selectedAnchor ? BLUE : '#ffffff';
            ctx.beginPath(); ctx.rect(anchor.x - size * .6, anchor.y - size * .6, size * 1.2, size * 1.2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#ffffff';
          }
        }
      } else if (selected.length === 1 && node.type === 'network') {
        const selectedVertexId = this.getState().selectedVectorPoint?.nodeId === node.id ? this.getState().selectedVectorPoint.vertexId : null;
        for (const edge of node.edges || []) {
          const points = vectorNetworkEdgePoints(node, edge.id, { x: 0, y: 0 });
          if (!points) continue;
          const from = pagePoint(points[0]); const to = pagePoint(points[3]);
          for (const [part, handle, anchor] of [['control1', points[1], from], ['control2', points[2], to]]) {
            if (!edge[part]) continue;
            const pageHandle = pagePoint(handle);
            ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(pageHandle.x, pageHandle.y); ctx.stroke();
            ctx.beginPath(); ctx.arc(pageHandle.x, pageHandle.y, size * .65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        }
        for (const vertex of node.vertices || []) {
          const anchor = pagePoint(vectorNetworkVertexPoint(node, vertex.id, { x: 0, y: 0 }));
          if (!anchor) continue;
          ctx.fillStyle = selectedVertexId === vertex.id ? BLUE : '#ffffff';
          ctx.beginPath(); ctx.rect(anchor.x - size * .6, anchor.y - size * .6, size * 1.2, size * 1.2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#ffffff';
        }
      }
    }
    const eraseDraft = state.imageEraseDraft;
    const eraseEntry = eraseDraft?.nodeId ? selected.find(entry => entry.node.id === eraseDraft.nodeId && entry.node.type === 'image') : null;
    if (eraseEntry && Array.isArray(eraseDraft.points) && eraseDraft.points.length && Number.isFinite(eraseDraft.radius)) {
      const { node, ancestors } = eraseEntry;
      const pagePoint = point => nodeLocalToPage(node, point, ancestors);
      const clipCorners = [
        { x: 0, y: 0 }, { x: node.width, y: 0 },
        { x: node.width, y: node.height }, { x: 0, y: node.height }
      ].map(pagePoint);
      const points = eraseDraft.points.map(pagePoint);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(clipCorners[0].x, clipCorners[0].y);
      for (let index = 1; index < clipCorners.length; index += 1) ctx.lineTo(clipCorners[index].x, clipCorners[index].y);
      ctx.closePath(); ctx.clip();
      ctx.strokeStyle = 'rgba(230, 54, 70, .78)';
      ctx.fillStyle = 'rgba(230, 54, 70, .2)';
      ctx.lineWidth = Math.max(.5, eraseDraft.radius * 2);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (points.length === 1) {
        ctx.beginPath(); ctx.arc(points[0].x, points[0].y, eraseDraft.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
        ctx.stroke();
      }
      ctx.restore();
    }
    const isolationSourceId = state.objectIsolationSourceId;
    const isolationEntry = isolationSourceId
      ? selected.find(entry => entry.node.id === isolationSourceId && entry.node.type === 'image') : null;
    if (isolationEntry) {
      const { node, ancestors } = isolationEntry;
      const pagePoint = point => nodeLocalToPage(node, point, ancestors);
      const clipCorners = [
        { x: 0, y: 0 }, { x: node.width, y: 0 },
        { x: node.width, y: node.height }, { x: 0, y: node.height }
      ].map(pagePoint);
      const marks = [...(state.objectIsolationStrokes || []), ...(state.objectIsolationDraft ? [state.objectIsolationDraft] : [])];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(clipCorners[0].x, clipCorners[0].y);
      for (let index = 1; index < clipCorners.length; index += 1) ctx.lineTo(clipCorners[index].x, clipCorners[index].y);
      ctx.closePath(); ctx.clip();
      for (const mark of marks) {
        const points = (mark.previewPoints || mark.points || []).map(pagePoint);
        if (!points.length) continue;
        const lasso = mark.brushMode === 3;
        const excluded = mark.brushMode === 2;
        const color = lasso ? '#a855f7' : excluded ? '#ef4444' : '#19a974';
        ctx.strokeStyle = color;
        ctx.fillStyle = lasso ? 'rgba(168,85,247,.13)' : excluded ? 'rgba(239,68,68,.2)' : 'rgba(25,169,116,.2)';
        ctx.lineWidth = (lasso ? 2 : 12) / Math.max(.08, zoom);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
        if (lasso && points.length >= 3) {
          ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (points.length === 1) {
          ctx.beginPath(); ctx.arc(points[0].x, points[0].y, 6 / Math.max(.08, zoom), 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        } else ctx.stroke();
      }
      ctx.restore();
    }
    const gradientTarget = state.gradientGeometryTarget;
    if (!state.presenting && !state.imageCropMode && state.tool === 'select'
      && gradientTarget && selectedIds.length === 1 && selectedIds[0] === gradientTarget.nodeId) {
      const entry = selected.find(item => item.node.id === gradientTarget.nodeId);
      const node = entry?.node;
      const ancestors = entry?.ancestors || [];
      let gradient = null;
      if (node && !node.locked && !ancestors.some(parent => parent.locked)) {
        if (gradientTarget.strokeId) {
          gradient = node.strokes?.find(stroke => stroke.id === gradientTarget.strokeId)?.gradient || null;
        } else if (gradientTarget.fillId) {
          const fill = node.fills?.find(item => item.id === gradientTarget.fillId);
          gradient = fill?.gradient || (!node.fills && gradientTarget.fillId === `legacy-fill:${node.id}` ? node.fillGradient : null);
        } else gradient = node.fillGradient || null;
      }
      const geometry = gradient && resolveGradientGeometry(gradient, { width: node.width, height: node.height });
      if (geometry) {
        const points = geometry.handles.map(point => nodeLocalToPage(node, point, ancestors));
        const lineColors = ['#00a4ff', '#ab69ff'];
        for (let index = 1; index < points.length; index += 1) {
          ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); ctx.lineTo(points[index].x, points[index].y);
          ctx.strokeStyle = lineColors[index - 1]; ctx.lineWidth = 1.5 / zoom; ctx.setLineDash([5 / zoom, 4 / zoom]); ctx.stroke();
        }
        ctx.setLineDash([]);
        for (const [index, point] of points.entries()) {
          const radius = (index === 0 ? 7 : 6) / zoom;
          ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = index === 0 ? '#ffffff' : lineColors[index - 1];
          ctx.strokeStyle = '#17202b'; ctx.lineWidth = 1.5 / zoom; ctx.fill(); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  drawRemotePresence(ctx, page, state) {
    const peers = [...(state.remotePresence?.values?.() || [])]
      .filter(peer => peer.active && peer.pageId === page.id);
    if (!peers.length) return;
    const zoom = Math.max(0.08, Number(state.zoom) || 1);
    const ownersByNodeId = new Map();
    const selectedPeers = peers.filter(peer => peer.selectedIds?.length);
    for (const peer of selectedPeers) {
      const color = remotePresenceColor(peer.peerActorId);
      for (const id of peer.selectedIds) {
        const owners = ownersByNodeId.get(id) || [];
        owners.push(color);
        ownersByNodeId.set(id, owners);
      }
    }
    if (ownersByNodeId.size) {
      const collect = (nodes, ancestors = []) => {
        for (const node of nodes) {
          const colors = ownersByNodeId.get(node.id);
          const geometry = getNodeGeometry(state.document, node);
          const resolvedNode = { ...node, ...geometry, ...(state.motionPreview?.get(node.id) || {}), ...(node.type === 'slice' ? { rotation: 0 } : {}) };
          if (colors?.length) {
            const selectionNode = node.type === 'slice' ? { ...resolvedNode, rotation: 0 } : resolvedNode;
            const { corners } = selectionOverlayGeometry(selectionNode, ancestors, { zoom, rotateOffset: 0 });
            ctx.save();
            ctx.lineWidth = 2 / zoom;
            for (const [index, color] of colors.entries()) {
              ctx.strokeStyle = color;
              ctx.setLineDash(index ? [3 / zoom, 3 / zoom] : []);
              ctx.beginPath();
              ctx.moveTo(corners[0].x, corners[0].y);
              for (let point = 1; point < corners.length; point += 1) ctx.lineTo(corners[point].x, corners[point].y);
              ctx.closePath();
              ctx.stroke();
            }
            ctx.restore();
          }
          if (node.children?.length) collect(node.children, [...ancestors, resolvedNode]);
        }
      };
      collect(page.children);
    }
    for (const peer of peers) {
      if (!Number.isFinite(peer.cursorX) || !Number.isFinite(peer.cursorY)) continue;
      const color = remotePresenceColor(peer.peerActorId);
      const x = peer.cursorX;
      const y = peer.cursorY;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1 / zoom, 1 / zoom);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, 18); ctx.lineTo(5, 13); ctx.lineTo(9, 21);
      ctx.lineTo(12, 19); ctx.lineTo(8, 11); ctx.lineTo(15, 11); ctx.closePath();
      ctx.fill(); ctx.stroke();
      const label = `Guest ${String(peer.peerActorId).slice(-4)}`;
      ctx.font = '600 12px system-ui, sans-serif';
      const labelWidth = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(14, 18, labelWidth + 10, 20);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 19, 28);
      ctx.restore();
    }
  }

  drawComponentPropertyHighlights(ctx, nodes, targetIds) {
    const state = this.getState();
    const remaining = new Set((Array.isArray(targetIds) ? targetIds : [targetIds])
      .filter(targetId => typeof targetId === 'string' && targetId));
    if (!remaining.size) return 0;
    const targets = [];
    const visit = (list, ancestors = []) => {
      for (const node of list) {
        if (!remaining.size) return true;
        const geometry = getNodeGeometry(state.document, node);
        const resolvedNode = { ...node, ...geometry, ...(state.motionPreview?.get(node.id) || {}) };
        if (remaining.delete(node.id)) targets.push({ node: resolvedNode, ancestors });
        if (remaining.size && visit(node.children || [], [...ancestors, resolvedNode])) return true;
      }
      return false;
    };
    visit(nodes);
    const zoom = Math.max(.08, state.zoom || 1);
    let drawn = 0;
    for (const target of targets) {
      if (target.node.visible === false || target.ancestors.some(ancestor => ancestor.visible === false)) continue;
      const { corners } = selectionOverlayGeometry(target.node, target.ancestors, { zoom, rotateOffset: 0 });
      ctx.save();
      ctx.strokeStyle = '#9747ff';
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let index = 1; index < corners.length; index += 1) ctx.lineTo(corners[index].x, corners[index].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      drawn += 1;
    }
    return drawn;
  }

  drawComponentPropertyHighlight(ctx, nodes, targetId) {
    return this.drawComponentPropertyHighlights(ctx, nodes, [targetId]) > 0;
  }

  drawCommentPins(ctx, page, state, width, height) {
    const comments = [...(state.document.comments || [])]
      .filter(comment => comment.pageId === page.id)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (!comments.length) return;
    const zoom = Math.max(.08, state.zoom || 1);
    const minX = -state.panX / zoom - 24 / zoom;
    const minY = -state.panY / zoom - 24 / zoom;
    const maxX = (width - state.panX) / zoom + 24 / zoom;
    const maxY = (height - state.panY) / zoom + 24 / zoom;
    const radius = 10 / zoom;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 ${9 / zoom}px Inter, Arial, sans-serif`;
    for (let index = 0; index < comments.length; index += 1) {
      const comment = comments[index];
      if (comment.x < minX || comment.x > maxX || comment.y < minY || comment.y > maxY) continue;
      ctx.beginPath(); ctx.arc(comment.x, comment.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = comment.resolved ? '#76818c' : '#0d99ff'; ctx.fill();
      ctx.lineWidth = 2 / zoom; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      if (comment.id === state.activeCommentId) {
        ctx.beginPath(); ctx.arc(comment.x, comment.y, 13 / zoom, 0, Math.PI * 2);
        ctx.lineWidth = 2 / zoom; ctx.strokeStyle = '#1e1e1e'; ctx.stroke();
      }
      ctx.fillStyle = '#ffffff'; ctx.fillText(index < 99 ? String(index + 1) : '•', comment.x, comment.y + .5 / zoom);
    }
    ctx.restore();
  }

  drawPrototypeConnections(ctx, page, state) {
    const positions = new Map();
    const collect = (nodes, offsetX = 0, offsetY = 0) => {
      for (const node of nodes) {
        const x = offsetX + node.x;
        const y = offsetY + node.y;
        positions.set(node.id, { x, y, width: node.width, height: node.height, node });
        collect(node.children || [], x, y);
      }
    };
    collect(page.children);
    const destinationIds = new Set();
    for (const source of positions.values()) {
      for (const interaction of source.node.interactions || []) {
        if (!['navigate', 'open-overlay'].includes(interaction.action) || (interaction.destinationPageId && interaction.destinationPageId !== page.id)) continue;
        const destination = positions.get(interaction.destinationId);
        if (!destination) continue;
        destinationIds.add(interaction.destinationId);
        const startX = source.x + source.width / 2;
        const startY = source.y + source.height / 2;
        const endX = destination.x + destination.width / 2;
        const endY = destination.y + destination.height / 2;
        const pull = Math.max(34, Math.abs(endX - startX) * .42);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(startX + pull, startY, endX - pull, endY, endX, endY);
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 2 / (state.zoom || 1);
        ctx.setLineDash(state.prototypeSourceId === source.node.id ? [5 / state.zoom, 3 / state.zoom] : []);
        ctx.stroke();
        const angle = Math.atan2(endY - (endY - startY) * .1, endX - (endX - startX) * .1);
        const size = 7 / (state.zoom || 1);
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - Math.cos(angle - .45) * size, endY - Math.sin(angle - .45) * size);
        ctx.lineTo(endX - Math.cos(angle + .45) * size, endY - Math.sin(angle + .45) * size);
        ctx.closePath();
        ctx.fillStyle = '#8b5cf6';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(startX, startY, 4 / (state.zoom || 1), 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 2 / (state.zoom || 1);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const id of destinationIds) {
      const target = positions.get(id);
      if (!target) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(139,92,246,.75)';
      ctx.lineWidth = 1 / (state.zoom || 1);
      ctx.setLineDash([4 / state.zoom, 3 / state.zoom]);
      ctx.strokeRect(target.x - 4 / state.zoom, target.y - 4 / state.zoom, target.width + 8 / state.zoom, target.height + 8 / state.zoom);
      ctx.restore();
    }
  }

  destroy() {
    this.destroyed = true;
    for (const ticket of this.booleanVectorPending.values()) ticket.controller.abort();
    this.booleanVectorPending.clear();
    this.booleanVectorPaths?.clear(); this.booleanVectorPathBytes = 0; this.booleanVectorBudgetError = null;
    this.booleanVectorUnregister?.(); this.booleanVectorUnregister = null;
    this.booleanVectorTextUnregister?.(); this.booleanVectorTextUnregister = null;
    clearTimeout(this.booleanVectorRetryTimer);
    cancelAnimationFrame(this.frame); this.resizeObserver.disconnect();
  }
}

export function screenToWorld(event, canvas, state) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left - state.panX) / state.zoom, y: (event.clientY - rect.top - state.panY) / state.zoom };
}

export function worldToScreen(point, canvas, state) {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + state.panX + point.x * state.zoom, y: rect.top + state.panY + point.y * state.zoom };
}

function containsPointInClip(node, point, ancestors, document) {
  const geometry = document
    ? { ...node, ...getNodeGeometry(document, node), x: node.x, y: node.y }
    : node;
  const local = pageToNodeLocal(geometry, point, ancestors);
  const { width, height } = geometry;
  if (local.x < 0 || local.y < 0 || local.x > width || local.y > height) return false;
  const rawRadius = node.cornerRadii || (document ? getNodePropertyValue(document, node, 'radius') : node.radius) || 0;
  const radii = typeof rawRadius === 'number'
    ? Object.fromEntries(cornerRadiusKeys.map(key => [key, rawRadius]))
    : rawRadius;
  return containsPointInRoundedRect(local.x, local.y, width, height, radii, node.cornerSmoothing || 0);
}

function pointInsideAncestorClips(point, ancestors, document) {
  return ancestors.every((ancestor, index) => !clipsNodeContents(ancestor)
    || containsPointInClip(ancestor, point, ancestors.slice(0, index), document));
}

/** Find the deepest visible frame/group containing a point after ancestor clips. */
export function deepestContainerAtPagePoint(nodes, point, document = null) {
  let result = null;
  const visit = (items, ancestors = []) => {
    for (const node of items || []) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      if (!pointInsideAncestorClips(point, ancestors, document)) continue;
      const geometry = document ? { ...node, ...getNodeGeometry(document, node) } : node;
      if (['frame', 'group'].includes(node.type)) {
        const local = pageToNodeLocal(geometry, point, ancestors);
        if (local.x >= 0 && local.y >= 0 && local.x <= geometry.width && local.y <= geometry.height) {
          result = { node, ancestors: [...ancestors, geometry] };
        }
      }
      visit(node.children || [], [...ancestors, geometry]);
    }
  };
  visit(nodes);
  return result;
}

export function hitTestPage(page, point, containsBoolean = null, document = null, presentationScrollOffsets = null, zoom = 1, { allowClippedNodeIds = [], allowAnyClippedNodes = false } = {}) {
  const hits = [];
  const scrollState = { presentationScrollOffsets };
  const hitTolerance = 4 / Math.max(.08, Number.isFinite(zoom) ? zoom : 1);
  const clippedPickIds = new Set(allowClippedNodeIds);
  const clippedPickPathIds = new Set();
  if (clippedPickIds.size) {
    const markPickPaths = nodes => {
      let containsPickTarget = false;
      for (const node of nodes || []) {
        const target = clippedPickIds.has(node.id);
        const descendant = node.type !== 'boolean' && markPickPaths(node.children || []);
        if (target || descendant) {
          clippedPickPathIds.add(node.id);
          containsPickTarget = true;
        }
      }
      return containsPickTarget;
    };
    markPickPaths(page?.children || []);
  }
  const visit = (nodes, ancestors = [], parentScrollOffset = { x: 0, y: 0 }, parentScrollFrame = null, stickyScrollContext = null, layoutAncestors = []) => {
    for (const node of nodes) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      const insideAncestorClips = pointInsideAncestorClips(point, ancestors, document);
      const isClippedPickTarget = clippedPickIds.has(node.id);
      if (!insideAncestorClips && !allowAnyClippedNodes && !clippedPickPathIds.has(node.id)) continue;
      const geometry = document ? getNodeGeometry(document, node) : node;
      const rawNode = document ? { ...node, ...geometry } : node;
      let resolvedNode = rawNode;
      const childScrollOffset = scrollOffsetForPresentationChild(
        parentScrollFrame, rawNode, parentScrollOffset, stickyScrollContext, layoutAncestors.slice(0, -1)
      );
      if (childScrollOffset.x || childScrollOffset.y) {
        resolvedNode = {
          ...resolvedNode,
          x: resolvedNode.x - childScrollOffset.x,
          y: resolvedNode.y - childScrollOffset.y
        };
      }
      const localPoint = pageToNodeLocal(resolvedNode, point, ancestors);
      const inBounds = localPoint.x >= 0 && localPoint.y >= 0
        && localPoint.x <= geometry.width && localPoint.y <= geometry.height;
      let contained = false;
      if (node.type === 'boolean' && containsBoolean && node.booleanGeometry !== 'vector') {
        if (inBounds) {
          // The boolean raster is queried in page coordinates by existing callers.
          // Fold ancestor rotations into the node rotation and use its true page
          // center so that the callback sees the same rigid transform as drawing.
          const center = nodeLocalToPage(resolvedNode, { x: geometry.width / 2, y: geometry.height / 2 }, ancestors);
          const rotation = ancestors.reduce((sum, ancestor) => sum + Number(ancestor.rotation || 0), Number(geometry.rotation || 0));
          const booleanNode = { ...resolvedNode, rotation };
          contained = containsBoolean(booleanNode, point, center.x - geometry.width / 2, center.y - geometry.height / 2);
        }
        contained ||= hitTestBooleanStrokeGeometry(resolvedNode, localPoint, { tolerance: hitTolerance, document });
      } else contained = hitTestVisibleGeometry(resolvedNode, localPoint, { tolerance: hitTolerance, document });
      if (contained && (insideAncestorClips || isClippedPickTarget || allowAnyClippedNodes)) hits.push(resolvedNode);
      if (node.type !== 'boolean') {
        const ownScrollOffset = getPresentationScrollOffset(scrollState, resolvedNode);
        const childStickyContext = scrollContextForChildren(rawNode, layoutAncestors, ownScrollOffset, stickyScrollContext);
        visit(presentationChildrenInPaintOrder(node), [...ancestors, resolvedNode], ownScrollOffset, rawNode,
          childStickyContext, [...layoutAncestors, rawNode]);
      }
    }
  };
  visit(page.children || []);
  return hits.at(-1) ?? null;
}

/** Return the visible scroll-frame ancestry of the topmost hit, innermost first. */
export function scrollableFramePathAtPagePoint(page, point, containsBoolean = null, document = null, presentationScrollOffsets = null, zoom = 1) {
  const hit = hitTestPage(page, point, containsBoolean, document, presentationScrollOffsets, zoom);
  if (!hit) return [];
  const scrollState = { presentationScrollOffsets };
  const visit = (nodes, ancestors = [], parentScrollOffset = { x: 0, y: 0 }, parentScrollFrame = null, stickyScrollContext = null, layoutAncestors = []) => {
    for (const node of nodes || []) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      if (!pointInsideAncestorClips(point, ancestors, document)) continue;
      const geometry = document ? getNodeGeometry(document, node) : node;
      const rawNode = document ? { ...node, ...geometry } : node;
      let frame = rawNode;
      const childScrollOffset = scrollOffsetForPresentationChild(
        parentScrollFrame, rawNode, parentScrollOffset, stickyScrollContext, layoutAncestors.slice(0, -1)
      );
      if (childScrollOffset.x || childScrollOffset.y) {
        frame = {
          ...frame,
          x: frame.x - childScrollOffset.x,
          y: frame.y - childScrollOffset.y
        };
      }

      let path = null;
      if (node.id === hit.id) path = [];
      else if (node.type !== 'boolean') {
        const ownScrollOffset = getPresentationScrollOffset(scrollState, frame);
        const childStickyContext = scrollContextForChildren(rawNode, layoutAncestors, ownScrollOffset, stickyScrollContext);
        path = visit(presentationChildrenInPaintOrder(node), [...ancestors, frame], ownScrollOffset, rawNode,
          childStickyContext, [...layoutAncestors, rawNode]);
      }
      if (path) {
        if (isScrollableFrame(frame) && containsPointInClip(frame, point, ancestors, document)) {
          path.push({
            frame,
            ancestors,
            local: pageToNodeLocal(frame, point, ancestors)
          });
        }
        return path;
      }
    }
    return null;
  };
  return visit(page?.children || []) || [];
}
