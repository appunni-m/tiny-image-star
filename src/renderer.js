import { findNode, getNodeColor, getNodeGeometry, getNodePropertyValue } from './model.js';
import { layoutGuideGridLines, layoutGuideRegions } from './layout-guides.js';
import { vectorNetworkEdgeForPair, vectorNetworkEdgePairIndex, vectorNetworkEdgePoints, vectorNetworkVertexPoint, vectorNodePoint, vectorPathContours } from './vector-path.js';
import { layoutPlainText, layoutTextRuns, measureTrackedText, textGraphemes, transformTextCase } from './text-layout.js';
import { buildLayerEffectFilter, layerEffectPadding } from './layer-effects.js';
import { createNoisePixelGrid, noiseSeedForLayer } from './noise-effect.js';
import { createTextureEdgeAlphas, MAX_TEXTURE_MASK_PIXELS, textureSeedForLayer } from './texture-effect.js';
import { firstBackdropEffect, glassEffectOverscan, glassVisibleForNode, MAX_GLASS_AXIS, MAX_GLASS_PIXELS, refractGlassBackdrop } from './glass-effect.js';
import { createGradientPaint, fillStackForNode, resolveGradientGeometry } from './fills.js';
import { canvasBlendOperation } from './layer-blend.js';
import { applyStrokeStyle } from './stroke-style.js';
import { strokeStackForNode } from './strokes.js';
import { strokeEndpointDecorations } from './stroke-decorations.js';
import { getTransformHandles, nodeLocalToPage, nodeLocalToPageTransform, pageToNodeLocal, transformPoint } from './transform-geometry.js';
import { selectionBounds } from './group-transform.js';
import { drawAlignmentGuides } from './smart-guides.js';
import { imagePreviewKey } from './image-preview-runtime.js';
import { clampCornerRadii, containsPointInRoundedRect, cornerRadiusKeys, traceRoundedRectPath } from './corner-radii.js';
import { booleanSourceTransform } from './boolean-geometry.js';
import { hitTestVisibleGeometry } from './shape-hit-testing.js';
import { canvasPixelFromClientPoint, resizeCanvasSurface, sampleColorAt } from './eyedropper.js';
import { variableStrokeOutlineFromSamples } from './variable-stroke-geometry.js';
export { measureTrackedText, wrapText } from './text-layout.js';

const MAX_BOOLEAN_SURFACE_PIXELS = 4_000_000;
const MAX_BOOLEAN_SURFACE_AXIS = 4096;
const MAX_BACKGROUND_BLUR_PIXELS = 4_000_000;
const MAX_BACKGROUND_BLUR_AXIS = 4096;

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
      fontSize: getNodePropertyValue(document, node, 'fontSize'),
      lineHeight: getNodePropertyValue(document, node, 'lineHeight'),
      letterSpacing: getNodePropertyValue(document, node, 'letterSpacing')
    } : {}),
    children: (node.children || []).map(child => booleanNodeCacheState(document, child))
  };
}

function drawTextMask(ctx, node, document, x, y, width, height) {
  const text = getNodePropertyValue(document, node, 'text');
  const richTextIsCurrent = Array.isArray(node.textRuns) && node.textRuns.map(run => run.text).join('') === text;
  if (!richTextIsCurrent) return drawPlainText(ctx, node, document, x, y, width, height, '#ffffff');
  const sourceRuns = richTextIsCurrent ? node.textRuns : [{ text }];
  const maskRuns = sourceRuns.map(run => ({ ...run, color: '#ffffff' }));
  return drawTextRuns(ctx, maskRuns, x, y, width, {
    fontFamily: node.fontFamily || 'Arial, sans-serif',
    fontSize: getNodePropertyValue(document, node, 'fontSize') || 24,
    fontWeight: getNodePropertyValue(document, node, 'fontWeight') || 400,
    fontStyle: node.fontStyle || 'normal',
    lineHeight: getNodePropertyValue(document, node, 'lineHeight') || 1.25,
    letterSpacing: getNodePropertyValue(document, node, 'letterSpacing') || 0,
    color: '#ffffff',
    textCase: node.textCase || 'none',
    textDecoration: node.textDecoration || 'none',
    paragraphSpacing: node.paragraphSpacing || 0,
    listSpacing: node.listSpacing || 0,
    paragraphStyles: node.paragraphStyles || [],
    firstLineIndent: node.firstLineIndent || 0,
    align: node.align || 'left',
    verticalAlign: node.verticalAlign || 'top',
    height,
    fillOpacity: node.fillOpacity ?? 1
  });
}

function drawPlainText(ctx, node, document, x, y, width, height, colorOverride = undefined) {
  const sourceText = getNodePropertyValue(document, node, 'text');
  const textColor = colorOverride ?? getNodeColor(document, node, 'text');
  ctx.fillStyle = rgba(textColor, node.fillOpacity ?? 1);
  const text = transformTextCase(sourceText, node.textCase || 'none');
  const fontSize = getNodePropertyValue(document, node, 'fontSize');
  const lineHeightScale = getNodePropertyValue(document, node, 'lineHeight');
  const letterSpacing = getNodePropertyValue(document, node, 'letterSpacing');
  ctx.font = `${node.fontStyle === 'italic' ? 'italic ' : ''}${node.fontWeight || 400} ${fontSize || 24}px ${node.fontFamily || 'Arial, sans-serif'}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const lineHeight = (fontSize || 24) * (lineHeightScale || 1.25);
  const layout = layoutPlainText(text, Math.max(1, width), value => measureTrackedText(ctx, value, letterSpacing), {
    lineHeight, paragraphSpacing: node.paragraphSpacing, listSpacing: node.listSpacing,
    paragraphStyles: node.paragraphStyles, markerStyle: {
      fontFamily: node.fontFamily || 'Arial, sans-serif', fontSize: fontSize || 24,
      fontWeight: node.fontWeight || 400, fontStyle: node.fontStyle || 'normal',
      letterSpacing: letterSpacing || 0, color: textColor
    },
    firstLineIndent: node.firstLineIndent, align: node.align
  });
  const textY = y + textVerticalOffset(height, layout.height, node.verticalAlign || 'top');
  layout.lines.forEach(line => {
    if (line.marker) drawParagraphMarker(ctx, line.marker, x, textY + line.y, {
      fontFamily: node.fontFamily || 'Arial, sans-serif', fontSize: fontSize || 24,
      fontWeight: node.fontWeight || 400, fontStyle: node.fontStyle || 'normal',
      letterSpacing: letterSpacing || 0, color: textColor
    }, node.fillOpacity ?? 1);
    const availableWidth = Math.max(1, width - line.indent);
    const lineAlign = line.align || node.align || 'left';
    const offsetX = line.indent + (lineAlign === 'center' ? (availableWidth - line.width) / 2 : lineAlign === 'right' ? availableWidth - line.width : 0);
    if (line.justify) drawJustifiedPlainText(ctx, line.displayText, x + offsetX, textY + line.y, letterSpacing, line.justificationExtraSpace);
    else drawTrackedText(ctx, line.displayText, x + offsetX, textY + line.y, letterSpacing, availableWidth);
    drawTextDecoration(ctx, x + offsetX, textY + line.y, line.width, fontSize || 24, node.textDecoration || 'none');
  });
  return layout;
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

function drawFittedImage(ctx, image, x, y, width, height, fit = 'cover') {
  if (!image || width <= 0 || height <= 0 || !image.width || !image.height) return false;
  const scale = fit === 'contain'
    ? Math.min(width / image.width, height / image.height)
    : Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
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

export function drawCropPreview(ctx, image, x, y, width, height, fit = 'cover', radius = 0) {
  if (!image || width <= 0 || height <= 0) return false;
  // The worker output already contains the selected crop and rotation. Show it
  // exactly as the committed image will render: fitted to the layer frame and
  // clipped to the same rounded bounds. The uncropped source remains beneath
  // this overlay to give the crop handles context.
  ctx.save();
  ctx.beginPath();
  roundedRect(ctx, x, y, width, height, radius);
  ctx.clip();
  const drawn = drawFittedImage(ctx, image, x, y, width, height, fit);
  ctx.restore();
  return drawn;
}

function imageForNode(node, assets, state, assetId = node.assetId, previewKey = node.id) {
  const cachedAssetId = state.previewAssetIds?.get(previewKey);
  const preview = state.previews?.get(previewKey);
  if (preview && (cachedAssetId == null || cachedAssetId === assetId)) return preview;
  return assets.get(assetId)?.bitmap ?? null;
}

function fillLayerColor(document, node, fill, index) {
  const linkedPrimary = index === 0 && (node.fillStyleId || node.fillVariableId || node.variableBindings?.fill);
  return linkedPrimary || (index === 0 && !Array.isArray(node.fills))
    ? getNodeColor(document, node, 'fill')
    : fill.color;
}

function fillCurrentPath(ctx, node) {
  if (node?.type === 'path') ctx.fill(node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
  else ctx.fill();
}

function drawFillStack(ctx, node, assets, state, x, y, width, height, colorOverride = null) {
  const fills = fillStackForNode(node);
  for (let index = 0; index < fills.length; index += 1) {
    const fill = fills[index];
    if (!fill.visible || fill.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha *= fill.opacity;
    if (fill.type === 'solid') {
      const color = colorOverride != null && index === 0
        ? colorOverride
        : fillLayerColor(state.document, node, fill, index);
      if (color && color !== 'transparent') { ctx.fillStyle = rgba(color, 1); fillCurrentPath(ctx, node); }
    } else if (fill.type === 'linear' || fill.type === 'radial') {
      const paint = createGradientPaint(ctx, fill.gradient, x, y, width, height);
      if (paint) { ctx.fillStyle = paint; fillCurrentPath(ctx, node); }
    } else if (fill.type === 'image') {
      const imageFill = fill.imageFill;
      const image = imageFill && imageForNode(node, assets, state, imageFill.assetId, imagePreviewKey(node.id, fill.id));
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
            drawFittedImage(ctx, preview, x, y, width, height, imageFill.fit);
          }
        } else drawFittedImage(ctx, image, x, y, width, height, imageFill.fit);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

function drawStrokeStack(ctx, node, document, x, y, width, height, tracePath = null) {
  const strokes = strokeStackForNode(node);
  for (let index = 0; index < strokes.length; index += 1) {
    const stroke = strokes[index];
    if (!stroke.visible || stroke.opacity <= 0 || stroke.width <= 0 || (!stroke.gradient && (!stroke.color || stroke.color === 'transparent'))) continue;
    ctx.save();
    ctx.globalAlpha *= stroke.opacity;
    ctx.lineWidth = stroke.width;
    const color = index === 0 && node.strokeVariableId
      ? getNodeColor(document, node, 'stroke')
      : stroke.color;
    if ((!stroke.gradient && (!color || color === 'transparent'))) { ctx.restore(); continue; }
    const paint = stroke.gradient ? createGradientPaint(ctx, stroke.gradient, x, y, width, height) : color;
    if (!paint) { ctx.restore(); continue; }
    ctx.strokeStyle = paint;
    applyStrokeStyle(ctx, stroke);
    if (tracePath) { ctx.beginPath(); tracePath(ctx); }
    ctx.stroke();
    drawStrokeEndpointDecorations(ctx, node, stroke, { x, y }, paint);
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
    ctx.moveTo(item.points[0].x, item.points[0].y);
    for (let index = 1; index < item.points.length; index += 1) ctx.lineTo(item.points[index].x, item.points[index].y);
    if (item.closed) {
      ctx.closePath();
      ctx.fill();
    } else ctx.stroke();
    ctx.restore();
  }
}

function roundedRect(ctx, x, y, width, height, radius) {
  const input = typeof radius === 'number'
    ? Object.fromEntries(cornerRadiusKeys.map(key => [key, radius]))
    : radius;
  const radii = clampCornerRadii(width, height, input);
  if (cornerRadiusKeys.every(key => radii[key] === 0)) { ctx.rect(x, y, width, height); return; }
  traceRoundedRectPath(ctx, x, y, width, height, radii);
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

/** Translate only a scrollable frame's contents; call after its viewport clip. */
export function applyPresentationScrollOffset(ctx, state, frame) {
  const offset = getPresentationScrollOffset(state, frame);
  if (offset.x || offset.y) ctx.translate(offset.x ? -offset.x : 0, offset.y ? -offset.y : 0);
  return offset;
}

function isScrollableFrame(node) {
  return node?.type === 'frame' && frameOverflowBehaviors.has(node.overflowBehavior)
    && node.overflowBehavior !== 'none';
}

function clipsNodeContents(node) {
  return Boolean(node?.clip) || isScrollableFrame(node);
}

/** Clip children to their frame viewport when clipping or presentation scrolling is enabled. */
export function clipNodeContents(ctx, node, x, y, radius = node?.cornerRadii ?? node?.radius ?? 0) {
  if (!clipsNodeContents(node)) return false;
  ctx.beginPath();
  roundedRect(ctx, x, y, node.width, node.height, radius || 0);
  ctx.clip();
  return true;
}

function starPath(ctx, cx, cy, radius, points, innerRatio) {
  const count = Math.max(3, Math.min(32, Number(points) || 5));
  for (let index = 0; index < count * 2; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI / count;
    const distance = radius * (index % 2 ? innerRatio : 1);
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function polygonPath(ctx, cx, cy, radiusX, radiusY, points) {
  const count = Math.max(3, Math.min(32, Number(points) || 6));
  for (let index = 0; index < count; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    const x = cx + Math.cos(angle) * radiusX;
    const y = cy + Math.sin(angle) * radiusY;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
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
  for (const edge of node.edges || []) {
    const points = vectorNetworkEdgePoints(node, edge.id, { x, y });
    if (!points) continue;
    const [start, control1, control2, end] = points;
    ctx.moveTo(start.x, start.y);
    if (edge.control1 || edge.control2) ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
    else ctx.lineTo(end.x, end.y);
  }
}

function traceVectorNetworkFace(ctx, node, face, x, y) {
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
  const value = String(text ?? '');
  const spacing = Number(letterSpacing) || 0;
  if (!spacing) { ctx.fillText(value, x, y, maxWidth); return; }
  if (typeof ctx.letterSpacing === 'string') {
    const previous = ctx.letterSpacing;
    try {
      ctx.letterSpacing = `${spacing}px`;
      ctx.fillText(value, x, y, maxWidth);
      return;
    } finally { ctx.letterSpacing = previous; }
  }
  const glyphs = textGraphemes(value);
  let prefix = '';
  for (let index = 0; index < glyphs.length; index += 1) {
    const glyph = glyphs[index];
    const position = ctx.measureText(prefix + glyph).width - ctx.measureText(glyph).width + index * spacing;
    ctx.fillText(glyph, x + position, y);
    prefix += glyph;
  }
}

function drawJustifiedPlainText(ctx, text, x, y, letterSpacing, extraSpace) {
  const segments = String(text ?? '').match(/\s+|\S+/gu) || [];
  let offset = 0;
  let hasTextBefore = false;
  for (const [index, segment] of segments.entries()) {
    const whitespace = /^\s+$/u.test(segment);
    drawTrackedText(ctx, segment, x + offset, y, letterSpacing);
    offset += measureTrackedText(ctx, segment, letterSpacing);
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

export function drawTextDecoration(ctx, x, y, width, fontSize, decoration) {
  if (!width || !['underline', 'line-through'].includes(decoration)) return false;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = Math.max(1, Number(fontSize) / 16 || 1);
  const lineY = y + Number(fontSize) * (decoration === 'underline' ? 1.03 : 0.55);
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
  return `${style.fontStyle === 'italic' ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

function drawParagraphMarker(ctx, marker, x, y, fallbackStyle, fillOpacity = 1) {
  const style = marker.style || fallbackStyle;
  ctx.save();
  ctx.font = richFont(style);
  ctx.fillStyle = rgba(style.color || fallbackStyle.color, fillOpacity);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const markerWidth = measureTrackedText(ctx, marker.text, style.letterSpacing);
  // Right-align within the marker column. Keeping this draw independent from
  // the text-line transform preserves a stable gutter for center/right text.
  drawTrackedText(ctx, marker.text, x + marker.anchorX - markerWidth, y, style.letterSpacing);
  ctx.restore();
}

/** Draws styled text runs using node-wide values as fallbacks for each run. */
export function drawTextRuns(ctx, runs, x, y, width, baseStyle = {}) {
  const previousFont = ctx.font;
  let layout;
  try {
    layout = layoutTextRuns(runs, Math.max(1, width), baseStyle, (text, style) => {
      ctx.font = richFont(style);
      return measureTrackedText(ctx, text, style.letterSpacing);
    });
  } finally {
    ctx.font = previousFont;
  }
  const { lines } = layout;
  const contentHeight = layout.height;
  let top = y + textVerticalOffset(baseStyle.height ?? contentHeight, contentHeight, baseStyle.verticalAlign);
  for (const line of lines) {
    if (line.marker) drawParagraphMarker(ctx, line.marker, x, top + line.y, richTextStyleForMarker(baseStyle), baseStyle.fillOpacity ?? 1);
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
        ctx.fillStyle = rgba(style.color, baseStyle.fillOpacity ?? 1);
        const start = offset;
        drawTrackedText(ctx, text, start, -Number(style.baselineShift || 0), style.letterSpacing);
        offset += measureTrackedText(ctx, text, style.letterSpacing);
        if (segments[index + 1]?.part === part) offset += Number(style.letterSpacing) || 0;
        const bounds = partBounds.get(part) || { start, end: offset };
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
        ctx.fillStyle = rgba(part.style.color, baseStyle.fillOpacity ?? 1);
        drawTextDecoration(ctx, bounds.start, -Number(part.style.baselineShift || 0), bounds.end - bounds.start, part.style.fontSize, part.style.textDecoration);
      }
      ctx.restore();
      continue;
    }
    for (const part of line.parts) {
      ctx.font = richFont(part.style);
      ctx.fillStyle = rgba(part.style.color, baseStyle.fillOpacity ?? 1);
      drawTrackedText(ctx, part.text, part.offsetX, -Number(part.style.baselineShift || 0), part.style.letterSpacing);
      drawTextDecoration(ctx, part.offsetX, -Number(part.style.baselineShift || 0), part.width, part.style.fontSize, part.style.textDecoration);
    }
    ctx.restore();
  }
  return { lines: lines.map(line => line.parts), height: contentHeight, verticalOffset: textVerticalOffset(baseStyle.height ?? contentHeight, contentHeight, baseStyle.verticalAlign) };
}

function richTextStyleForMarker(baseStyle) {
  return {
    fontFamily: baseStyle.fontFamily || 'Arial, sans-serif',
    fontSize: Number(baseStyle.fontSize) || 24,
    fontWeight: baseStyle.fontWeight || 400,
    fontStyle: baseStyle.fontStyle || 'normal',
    letterSpacing: Number(baseStyle.letterSpacing) || 0,
    color: baseStyle.color || '#000000'
  };
}

export class SceneRenderer {
  constructor(canvas, getState, onDraw = null) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.getState = getState;
    this.onDraw = typeof onDraw === 'function' ? onDraw : null;
    this.frame = 0;
    this.booleanCache = new Map();
    this.booleanCachePixels = 0;
    this.noiseCache = new Map();
    this.noiseCachePixels = 0;
    this.samplingSurface = null;
    this.resizeObserver = new ResizeObserver(() => this.invalidate());
    this.resizeObserver.observe(canvas.parentElement);
    this.invalidate();
  }

  invalidate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
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
    context.fillStyle = '#e9e9e9';
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
    const { width, height, dpr, cssWidth, cssHeight } = this.resize();
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#e9e9e9';
    ctx.fillRect(0, 0, width, height);
    const page = state.document.pages.find(item => item.id === state.document.activePageId);
    if (!page) { this.onDraw?.(state, { cssWidth, cssHeight, dpr }); return; }
    ctx.setTransform(dpr * state.zoom, 0, 0, dpr * state.zoom, dpr * state.panX, dpr * state.panY);
    for (const node of page.children) this.drawNode(ctx, node, 0, 0, state.assets);
    this.drawSelection(ctx, page.children, state.selectedIds, 0, 0);
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
    if (!page.children.length) this.drawEmptyHint(cssWidth, cssHeight, dpr, state);
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
    node = { ...node, ...getNodeGeometry(document, node), ...(node.type === 'slice' ? { rotation: 0 } : {}) };
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
    const outline = !state.presenting && (renderOptions.outlineMode ?? state.outlineMode);
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
      if (glassVisibleForNode(node)) {
        this.drawNodeWithGlass(ctx, node, parentX, parentY, assets, backdropEffect, renderOptions);
        return;
      }
    }
    const hasForegroundEffects = effects.some(effect => !['glass', 'background-blur'].includes(effect.type));
    if ((hasForegroundEffects && renderOptions.effectBypassNodeId !== node.id || blendMode !== 'normal' && !compositeBypassed)
      && !draft && !maskMode && !outline && !cropEditing && typeof ctx.filter === 'string') {
      this.drawNodeWithEffects(ctx, node, parentX, parentY, assets, effects, renderOptions);
      return;
    }
    const opacity = getNodePropertyValue(document, node, 'opacity');
    const radius = node.cornerRadii || getNodePropertyValue(document, node, 'radius');
    const x = parentX + node.x; const y = parentY + node.y;
    const width = node.width; const height = node.height;
    const cx = x + width / 2; const cy = y + height / 2;
    ctx.save();
    if (blendMode !== 'normal' && !compositeBypassed) ctx.globalCompositeOperation = canvasBlendOperation(blendMode);
    ctx.globalAlpha *= opacity ?? 1;
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
      drawTextMask(ctx, node, document, x, y, width, height);
      ctx.restore();
      return;
    }
    ctx.beginPath();
    switch (node.type) {
      case 'frame':
      case 'section':
      case 'group':
      case 'rectangle':
        roundedRect(ctx, x, y, width, height, radius || 0);
        break;
      case 'ellipse':
        ctx.ellipse(cx, cy, Math.abs(width) / 2, Math.abs(height) / 2, 0, 0, Math.PI * 2);
        break;
      case 'line':
        if (node.lineReverseY === true) { ctx.moveTo(x, y + height); ctx.lineTo(x + width, y); }
        else { ctx.moveTo(x, y); ctx.lineTo(x + width, y + height); }
        break;
      case 'star':
        starPath(ctx, cx, cy, Math.min(Math.abs(width), Math.abs(height)) / 2, node.points, node.innerRadius ?? 0.48);
        break;
      case 'polygon':
        polygonPath(ctx, cx, cy, Math.abs(width) / 2, Math.abs(height) / 2, node.points);
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

    if (maskMode) {
      ctx.globalAlpha *= node.fillOpacity ?? 1;
      ctx.fillStyle = '#fff';
      if (node.type === 'network') {
        for (const face of node.faces || []) {
          ctx.save();
          ctx.globalAlpha *= face.fillOpacity ?? 1;
          ctx.beginPath();
          if (traceVectorNetworkFace(ctx, node, face, x, y)) ctx.fill();
          ctx.restore();
        }
        ctx.restore();
        return;
      }
      if (node.type !== 'line' && (node.type !== 'path' || pathHasClosedContour(node))) fillCurrentPath(ctx, node);
      ctx.restore();
      return;
    }

    if (node.type === 'image') {
      const asset = assets.get(node.assetId);
      const cropOverlay = cropEditing ? state.imageCropOverlay : null;
      const sourceImage = cropOverlay ? asset?.bitmap : null;
      const image = sourceImage || imageForNode(node, assets, state);
      if (image) {
        if (cropOverlay && sourceImage) {
          drawCropSourceImage(ctx, sourceImage, x, y, cropOverlay.virtualBounds, cropOverlay.rotation,
            cropOverlay.flipHorizontal, cropOverlay.flipVertical);
          const cropPreview = state.previews?.get(node.id);
          const previewAssetId = state.previewAssetIds?.get(node.id);
          const previewStatus = state.imageStatus?.get(node.id) || '';
          const previewReady = previewStatus.startsWith('Ready') || previewStatus.startsWith('Updated');
          if (cropPreview && previewAssetId === node.assetId && previewReady) {
            drawCropPreview(ctx, cropPreview, x, y, width, height, node.fit, radius || 0);
          }
        }
        else {
          ctx.save();
          ctx.beginPath(); roundedRect(ctx, x, y, width, height, radius || 0); ctx.clip();
          drawFittedImage(ctx, image, x, y, width, height, node.fit);
          ctx.restore();
        }
      } else {
        if (renderOptions.showImageLoadingPlaceholder !== false) {
          ctx.fillStyle = '#d9d9d9'; ctx.fill();
          ctx.fillStyle = '#8a8a8a'; ctx.font = '12px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('Loading image…', cx, cy);
        }
      }
      drawStrokeStack(ctx, node, document, x, y, width, height, pathContext => roundedRect(pathContext, x, y, width, height, radius));
    } else if (node.type === 'text') {
      const sourceText = getNodePropertyValue(document, node, 'text');
      if (Array.isArray(node.textRuns) && node.textRuns.map(run => run.text).join('') === sourceText) {
        drawTextRuns(ctx, node.textRuns, x, y, width, {
          fontFamily: node.fontFamily || 'Arial, sans-serif',
          fontSize: getNodePropertyValue(document, node, 'fontSize') || 24,
          fontWeight: node.fontWeight || 400,
          fontStyle: node.fontStyle || 'normal',
          lineHeight: getNodePropertyValue(document, node, 'lineHeight') || 1.25,
          letterSpacing: getNodePropertyValue(document, node, 'letterSpacing') || 0,
          color: getNodeColor(document, node, 'text'),
          textCase: node.textCase || 'none',
          textDecoration: node.textDecoration || 'none',
          paragraphSpacing: node.paragraphSpacing || 0,
          listSpacing: node.listSpacing || 0,
          paragraphStyles: node.paragraphStyles || [],
          firstLineIndent: node.firstLineIndent || 0,
          align: node.align || 'left',
          verticalAlign: node.verticalAlign || 'top',
          height,
          fillOpacity: node.fillOpacity ?? 1
        });
      } else drawPlainText(ctx, node, document, x, y, width, height);
      drawStrokeStack(ctx, node, document, x, y, width, height, pathContext => pathContext.rect(x, y, width, height));
    } else if (node.type === 'network') {
      const fills = fillStackForNode(node);
      for (const face of node.faces || []) {
        // Keep the original one-fill face behavior for old files: an image fill
        // always wins over a face color, while gradients yield to explicit
        // face colors. New stacks only let face colors override a solid first
        // paint; they must not replace an image or gradient paint.
        if (!Array.isArray(node.fills)) {
          const color = getNodeColor(document, node, 'fill');
          const fillImage = node.imageFill ? imageForNode(node, assets, state, node.imageFill.assetId) : null;
          const faceFill = face.fill ?? color;
          if ((!faceFill || faceFill === 'transparent') && !node.fillGradient && !node.imageFill) continue;
          ctx.beginPath();
          if (traceVectorNetworkFace(ctx, node, face, x, y)) {
            const gradient = !face.fill ? createGradientPaint(ctx, node.fillGradient, x, y, width, height) : null;
            ctx.save();
            ctx.globalAlpha *= (node.fillOpacity ?? 1) * (face.fillOpacity ?? 1);
            if (node.imageFill && fillImage) { ctx.clip(); drawFittedImage(ctx, fillImage, x, y, width, height, node.imageFill.fit); }
            else { ctx.fillStyle = gradient || rgba(faceFill || color || '#000000', 1); ctx.fill(); }
            ctx.restore();
          }
          continue;
        }
        for (let index = 0; index < fills.length; index += 1) {
          const fill = fills[index];
          if (!fill.visible || fill.opacity <= 0) continue;
          ctx.beginPath();
          if (!traceVectorNetworkFace(ctx, node, face, x, y)) continue;
          ctx.save();
          ctx.globalAlpha *= fill.opacity * (face.fillOpacity ?? 1);
          if (face.fill != null && index === 0 && fill.type === 'solid') {
            ctx.fillStyle = rgba(face.fill, 1); ctx.fill();
          } else if (fill.type === 'solid') {
            const color = fillLayerColor(document, node, fill, index);
            if (color && color !== 'transparent') { ctx.fillStyle = rgba(color, 1); ctx.fill(); }
          } else if (fill.type === 'linear' || fill.type === 'radial') {
            const paint = createGradientPaint(ctx, fill.gradient, x, y, width, height);
            if (paint) { ctx.fillStyle = paint; ctx.fill(); }
          } else if (fill.type === 'image') {
            const image = imageForNode(node, assets, state, fill.imageFill.assetId, imagePreviewKey(node.id, fill.id));
            if (image) { ctx.clip(); drawFittedImage(ctx, image, x, y, width, height, fill.imageFill.fit); }
          }
          ctx.restore();
        }
      }
      drawStrokeStack(ctx, node, document, x, y, width, height, pathContext => traceVectorNetworkEdges(pathContext, node, x, y));
    } else {
      if (node.type !== 'line' && (node.type !== 'path' || pathHasClosedContour(node))) drawFillStack(ctx, node, assets, state, x, y, width, height);
      drawStrokeStack(ctx, node, document, x, y, width, height);
    }

    if (draft) { ctx.beginPath(); ctx.rect(x, y, width, height); ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.setLineDash([4, 3]); ctx.stroke(); }
    if (node.children?.length) {
      clipNodeContents(ctx, node, x, y, radius);
      applyPresentationScrollOffset(ctx, state, node);
      for (const child of node.children) this.drawNode(ctx, child, x, y, assets, draft, false, renderOptions);
    }
    if (node.type === 'frame' && !node.children.length && !draft && renderOptions.showEmptyFrameHint !== false) {
      ctx.strokeStyle = 'rgba(30,30,30,.14)'; ctx.lineWidth = 1 / (this.getState().zoom || 1); ctx.strokeRect(x, y, width, height);
    }
    if (node.type === 'frame' && !draft && !state.presenting && renderOptions.showLayoutGuides !== false) this.drawLayoutGuides(ctx, node, x, y, state);
    ctx.restore();
  }

  applyInnerShadows(surface, effects, rasterScale, pixelWidth, pixelHeight) {
    const innerShadows = effects.filter(effect => effect?.type === 'inner-shadow' && effect.visible !== false && effect.opacity > 0);
    if (!innerShadows.length) return;
    const overlay = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(pixelWidth, pixelHeight)
      : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
    const overlayContext = overlay.getContext('2d');
    const surfaceContext = surface.getContext('2d');
    if (!overlayContext || !surfaceContext) return;
    for (const effect of innerShadows) {
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
      overlayContext.drawImage(surface, effect.offsetX * rasterScale, effect.offsetY * rasterScale);
      overlayContext.globalCompositeOperation = 'destination-in';
      overlayContext.filter = 'none';
      overlayContext.drawImage(surface, 0, 0);
      overlayContext.restore();

      surfaceContext.save();
      surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
      surfaceContext.globalCompositeOperation = 'source-over';
      surfaceContext.globalAlpha = Math.max(0, Math.min(1, effect.opacity));
      surfaceContext.filter = 'none';
      surfaceContext.drawImage(overlay, 0, 0);
      surfaceContext.restore();
    }
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
      surfaceContext.globalCompositeOperation = 'source-atop';
      surfaceContext.globalAlpha = 1;
      surfaceContext.filter = 'none';
      surfaceContext.imageSmoothingEnabled = false;
      const texture = cacheEntry.texture;
      const cellWidth = Math.max(1, Math.round(effect.sizeX * rasterScale));
      const cellHeight = Math.max(1, Math.round(effect.sizeY * rasterScale));
      surfaceContext.drawImage(texture, Math.round(padX * rasterScale), Math.round(padY * rasterScale),
        texture.width * cellWidth, texture.height * cellHeight);
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
    if (!source || !matrix || !glassVisibleForNode(node)) { drawOwnContent(); return; }
    const scaleX = Math.hypot(matrix.a, matrix.b);
    const scaleY = Math.hypot(matrix.c, matrix.d);
    const displayScale = Math.max(.01, Math.sqrt(scaleX * scaleY));
    const angle = (Number(node.rotation) || 0) * Math.PI / 180;
    const centerX = parentX + node.x + node.width / 2;
    const centerY = parentY + node.y + node.height / 2;
    const corners = [[0, 0], [node.width, 0], [node.width, node.height], [0, node.height]].map(([dx, dy]) => {
      const px = parentX + node.x + dx - centerX;
      const py = parentY + node.y + dy - centerY;
      const localX = centerX + px * Math.cos(angle) - py * Math.sin(angle);
      const localY = centerY + px * Math.sin(angle) + py * Math.cos(angle);
      return { x: matrix.a * localX + matrix.c * localY + matrix.e, y: matrix.b * localX + matrix.d * localY + matrix.f };
    });
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
    const maskNode = {
      ...node, opacity: 1, fillOpacity: 1, ...(opaqueFills ? { fills: opaqueFills } : {}),
      variableBindings: {}, blendMode: 'normal', effects: [], children: [],
      strokes: [], stroke: null, strokeWidth: 0
    };
    shapeContext.save();
    shapeContext.setTransform(1, 0, 0, 1, 0, 0);
    shapeContext.clearRect(0, 0, pixelWidth, pixelHeight);
    setMaskTransform(shapeContext);
    this.drawNode(shapeContext, maskNode, parentX, parentY, assets, false, false, {
      ...renderOptions, outlineMode: false, showEmptyFrameHint: false, showLayoutGuides: false,
      backgroundBlurBypassNodeId: node.id, effectBypassNodeId: node.id, compositeBypassNodeId: node.id
    });
    shapeContext.restore();

    const edgeBlur = Math.max(.65, (effect.depth / 100) * 12 * displayScale * rasterScale);
    workContext.save();
    workContext.setTransform(1, 0, 0, 1, 0, 0);
    workContext.clearRect(0, 0, pixelWidth, pixelHeight);
    setMaskTransform(workContext);
    workContext.filter = `blur(${edgeBlur}px)`;
    this.drawNode(workContext, maskNode, parentX, parentY, assets, false, false, {
      ...renderOptions, outlineMode: false, showEmptyFrameHint: false, showLayoutGuides: false,
      backgroundBlurBypassNodeId: node.id, effectBypassNodeId: node.id, compositeBypassNodeId: node.id
    });
    workContext.restore();
    let edgeImageData;
    try { edgeImageData = workContext.getImageData(0, 0, pixelWidth, pixelHeight); }
    catch { drawOwnContent(); return; }
    let refracted;
    try { refracted = refractGlassBackdrop(sampledBackdrop, edgeImageData, pixelWidth, pixelHeight, effect, displayScale * rasterScale); }
    catch { drawOwnContent(); return; }
    backdropContext.putImageData(refracted, 0, 0);
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
    const radius = visible.reduce((maximum, effect) => Math.max(maximum, effect.radius), 0);
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
    const angle = (Number(node.rotation) || 0) * Math.PI / 180;
    const centerX = parentX + node.x + node.width / 2;
    const centerY = parentY + node.y + node.height / 2;
    const corners = [[0, 0], [node.width, 0], [node.width, node.height], [0, node.height]].map(([dx, dy]) => {
      const px = parentX + node.x + dx - centerX;
      const py = parentY + node.y + dy - centerY;
      const localX = centerX + px * Math.cos(angle) - py * Math.sin(angle);
      const localY = centerY + px * Math.sin(angle) + py * Math.cos(angle);
      return { x: matrix.a * localX + matrix.c * localY + matrix.e, y: matrix.b * localX + matrix.d * localY + matrix.f };
    });
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
    if (sourceRight > sourceLeft && sourceBottom > sourceTop) {
      backdropContext.drawImage(source, sourceLeft, sourceTop, sourceRight - sourceLeft, sourceBottom - sourceTop,
        (sourceLeft - left) * rasterScale, (sourceTop - top) * rasterScale,
        (sourceRight - sourceLeft) * rasterScale, (sourceBottom - sourceTop) * rasterScale);
    }
    resultContext.save();
    resultContext.filter = `blur(${radius * displayScale * rasterScale}px)`;
    resultContext.drawImage(backdrop, 0, 0);
    resultContext.restore();
    backdropContext.clearRect(0, 0, pixelWidth, pixelHeight);
    backdropContext.setTransform(matrix.a * rasterScale, matrix.b * rasterScale, matrix.c * rasterScale, matrix.d * rasterScale,
      (matrix.e - left) * rasterScale, (matrix.f - top) * rasterScale);
    // Figma-style background blur is exposed by partially transparent fills.
    // Keep stroke pixels out of the mask: a stroked, unfilled shape must not
    // reveal a backdrop effect by itself. Raster image layers still contribute
    // their source alpha through drawNode's normal image-fill path.
    const maskNode = {
      ...node, opacity: 1, variableBindings: {}, blendMode: 'normal', effects: [], children: [],
      strokes: [], stroke: null, strokeWidth: 0
    };
    this.drawNode(backdropContext, maskNode, parentX, parentY, assets, false, false, {
      ...renderOptions, outlineMode: false, showEmptyFrameHint: false, showLayoutGuides: false,
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
    const radians = (Number(node.rotation) || 0) * Math.PI / 180;
    const rotatedWidth = Math.abs(node.width * Math.cos(radians)) + Math.abs(node.height * Math.sin(radians));
    const rotatedHeight = Math.abs(node.height * Math.cos(radians)) + Math.abs(node.width * Math.sin(radians));
    const effectPadding = layerEffectPadding(effects);
    const padX = effectPadding.x + Math.max(0, rotatedWidth - node.width) / 2;
    const padY = effectPadding.y + Math.max(0, rotatedHeight - node.height) / 2;
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
    this.drawNode(effectContext, copy, 0, 0, assets, false, false, { ...renderOptions, effectBypassNodeId: node.id, compositeBypassNodeId: node.id });
    this.applyTextureEffects(surface, node, effects, pixelWidth, pixelHeight, rasterScale, renderOptions);
    this.applyInnerShadows(surface, effects, rasterScale, pixelWidth, pixelHeight);
    this.applyNoiseEffects(surface, node, effects, rasterScale,
      Math.max(1, Math.ceil(node.width * rasterScale)), Math.max(1, Math.ceil(node.height * rasterScale)), padX, padY, renderOptions);
    const x = parentX + node.x; const y = parentY + node.y;
    ctx.save();
    ctx.globalAlpha *= getNodePropertyValue(this.getState().document, node, 'opacity') ?? 1;
    ctx.filter = buildLayerEffectFilter(effects, displayScale);
    ctx.globalCompositeOperation = canvasBlendOperation(node.blendMode || 'normal');
    ctx.drawImage(surface, x - padX, y - padY, logicalWidth, logicalHeight);
    ctx.restore();
  }

  drawNodeOutline(ctx, node, x, y, assets, renderOptions = {}) {
    const state = this.getState();
    const width = node.width; const height = node.height;
    const cx = x + width / 2; const cy = y + height / 2;
    const radius = node.cornerRadii || getNodePropertyValue(state.document, node, 'radius') || 0;
    ctx.beginPath();
    if (node.type === 'slice') {
      ctx.rect(x, y, width, height);
      ctx.setLineDash([4 / (state.zoom || 1), 3 / (state.zoom || 1)]);
    } else if (node.type === 'boolean' || (node.type === 'group' && node.mask)) {
      ctx.rect(x, y, width, height);
      ctx.setLineDash(node.type === 'boolean' ? [3 / (state.zoom || 1), 2 / (state.zoom || 1)] : []);
    } else {
      switch (node.type) {
        case 'frame':
        case 'section':
        case 'group':
        case 'rectangle':
          roundedRect(ctx, x, y, width, height, radius);
          break;
        case 'ellipse':
          ctx.ellipse(cx, cy, Math.abs(width) / 2, Math.abs(height) / 2, 0, 0, Math.PI * 2);
          break;
        case 'line':
          if (node.lineReverseY === true) { ctx.moveTo(x, y + height); ctx.lineTo(x + width, y); }
          else { ctx.moveTo(x, y); ctx.lineTo(x + width, y + height); }
          break;
        case 'star':
          starPath(ctx, cx, cy, Math.min(Math.abs(width), Math.abs(height)) / 2, node.points, node.innerRadius ?? 0.48);
          break;
        case 'polygon':
          polygonPath(ctx, cx, cy, Math.abs(width) / 2, Math.abs(height) / 2, node.points);
          break;
        case 'path':
          traceVectorPath(ctx, node, x, y);
          break;
        case 'network':
          traceVectorNetworkEdges(ctx, node, x, y);
          break;
        case 'image':
          roundedRect(ctx, x, y, width, height, radius);
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

    if (node.children?.length) {
      ctx.save();
      clipNodeContents(ctx, node, x, y, radius);
      applyPresentationScrollOffset(ctx, state, node);
      for (const child of node.children) this.drawNode(ctx, child, x, y, assets, false, false, renderOptions);
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
    if (!Array.isArray(node.children) || node.children.length < 2 || node.width <= 0 || node.height <= 0) return;
    const transform = ctx.getTransform?.();
    const requestedScale = transform ? Math.hypot(transform.a, transform.b) : (window.devicePixelRatio || 1) * Math.max(.08, this.getState().zoom || 1);
    const { width: pixelWidth, height: pixelHeight } = booleanSurfaceDimensions(node.width, node.height, requestedScale);
    const surface = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(pixelWidth, pixelHeight)
      : Object.assign(document.createElement('canvas'), { width: pixelWidth, height: pixelHeight });
    const maskContext = surface.getContext('2d');
    maskContext.setTransform(pixelWidth / node.width, 0, 0, pixelHeight / node.height, 0, 0);
    const maskNode = node.children.find(child => child.id === node.maskSourceId) || node.children[0];
    for (const child of node.children) if (child !== maskNode) this.drawNode(maskContext, child, 0, 0, assets, false, false, renderOptions);
    maskContext.globalCompositeOperation = 'destination-in';
    this.drawNode(maskContext, maskNode, 0, 0, assets, false, true, renderOptions);
    maskContext.globalCompositeOperation = 'source-over';
    ctx.drawImage(surface, x, y, node.width, node.height);
  }

  drawBooleanGroup(ctx, node, x, y, assets, maskMode = false, renderOptions = {}) {
    const state = this.getState();
    const transform = ctx.getTransform?.();
    const contextScale = transform ? Math.hypot(transform.a, transform.b) : (window.devicePixelRatio || 1) * Math.max(.08, state.zoom || 1);
    const surface = this.getBooleanSurface(node, assets, maskMode, contextScale, renderOptions);
    ctx.save();
    if (!Array.isArray(node.fills)) ctx.globalAlpha *= node.fillOpacity ?? 1;
    ctx.drawImage(surface, x, y, node.width, node.height);
    ctx.restore();
  }

  getBooleanSurface(node, assets, maskMode = false, contextScale = null, renderOptions = {}) {
    const state = this.getState();
    const fill = maskMode ? '#ffffff' : getNodeColor(state.document, node, 'fill');
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
    const key = `${maskMode ? 'mask' : 'paint'}|${JSON.stringify(node)}|${JSON.stringify(resolvedChildren)}|${fill}|${JSON.stringify([imagePreviewVersion, fillPreviewVersions])}|${width}x${height}`;
    let entry = this.booleanCache.get(key);
    if (entry) {
      this.booleanCache.delete(key);
      this.booleanCache.set(key, entry);
    } else {
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
        this.drawNode(mask, child, 0, 0, assets, false, true, renderOptions);
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
      if (!maskMode && Array.isArray(node.fills)) {
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
          } else if (fillLayer.type === 'linear' || fillLayer.type === 'radial') {
            const paint = createGradientPaint(paintContext, fillLayer.gradient, 0, 0, node.width, node.height);
            if (!paint) continue;
            paintContext.fillStyle = paint; paintContext.fillRect(0, 0, node.width, node.height);
          } else if (fillLayer.type === 'image') {
            const imageFill = fillLayer.imageFill;
            const image = imageForNode(node, assets, state, imageFill.assetId, imagePreviewKey(node.id, fillLayer.id));
            if (!image) continue;
            drawFittedImage(paintContext, image, 0, 0, node.width, node.height, imageFill.fit);
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
        const fillImage = !maskMode && node.imageFill ? imageForNode(node, assets, state, node.imageFill.assetId) : null;
        if (fillImage) drawFittedImage(mask, fillImage, 0, 0, node.width, node.height, node.imageFill.fit);
        else {
          mask.fillStyle = !maskMode && node.fillGradient ? createGradientPaint(mask, node.fillGradient, 0, 0, node.width, node.height) || fill : fill;
          mask.fillRect(0, 0, node.width, node.height);
        }
        mask.restore();
      }
      entry = { surface, pixels: width * height };
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
      const visibleSize = 10 * scale;
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
        const resolvedNode = { ...node, ...geometry, ...(node.type === 'slice' ? { rotation: 0 } : {}) };
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
    if (roots.length > 1 && groupTransformAllowed && !cropTargetIsRoot) {
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

  drawEmptyHint(width, height, dpr, state) {
    const ctx = this.context;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(30,30,30,.52)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '500 13px Inter, Arial, sans-serif';
    ctx.fillText('Create a frame, draw a shape, or drop an image to begin', width / 2, height - 34);
    ctx.restore();
  }

  destroy() { cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); }
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
  return containsPointInRoundedRect(local.x, local.y, width, height, radii);
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

export function hitTestPage(page, point, containsBoolean = null, document = null, presentationScrollOffsets = null, zoom = 1) {
  const hits = [];
  const scrollState = { presentationScrollOffsets };
  const hitTolerance = 4 / Math.max(.08, Number.isFinite(zoom) ? zoom : 1);
  const visit = (nodes, ancestors = [], parentScrollOffset = { x: 0, y: 0 }) => {
    for (const node of nodes) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      if (!pointInsideAncestorClips(point, ancestors, document)) continue;
      const geometry = document ? getNodeGeometry(document, node) : node;
      let resolvedNode = document ? { ...node, ...geometry } : node;
      if (parentScrollOffset.x || parentScrollOffset.y) {
        resolvedNode = {
          ...resolvedNode,
          x: resolvedNode.x - parentScrollOffset.x,
          y: resolvedNode.y - parentScrollOffset.y
        };
      }
      const localPoint = pageToNodeLocal(resolvedNode, point, ancestors);
      const inBounds = localPoint.x >= 0 && localPoint.y >= 0
        && localPoint.x <= geometry.width && localPoint.y <= geometry.height;
      let contained = false;
      if (node.type === 'boolean' && containsBoolean) {
        if (inBounds) {
          // The boolean raster is queried in page coordinates by existing callers.
          // Fold ancestor rotations into the node rotation and use its true page
          // center so that the callback sees the same rigid transform as drawing.
          const center = nodeLocalToPage(resolvedNode, { x: geometry.width / 2, y: geometry.height / 2 }, ancestors);
          const rotation = ancestors.reduce((sum, ancestor) => sum + Number(ancestor.rotation || 0), Number(geometry.rotation || 0));
          const booleanNode = { ...resolvedNode, rotation };
          contained = containsBoolean(booleanNode, point, center.x - geometry.width / 2, center.y - geometry.height / 2);
        }
      } else contained = hitTestVisibleGeometry(resolvedNode, localPoint, { tolerance: hitTolerance, document });
      if (contained) hits.push(resolvedNode);
      if (node.type !== 'boolean') {
        const childScrollOffset = getPresentationScrollOffset(scrollState, resolvedNode);
        visit(node.children || [], [...ancestors, resolvedNode], childScrollOffset);
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
  const visit = (nodes, ancestors = [], parentScrollOffset = { x: 0, y: 0 }) => {
    for (const node of nodes || []) {
      if (document ? !getNodePropertyValue(document, node, 'visible') : !node.visible) continue;
      if (!pointInsideAncestorClips(point, ancestors, document)) continue;
      const geometry = document ? getNodeGeometry(document, node) : node;
      let frame = document ? { ...node, ...geometry } : node;
      if (parentScrollOffset.x || parentScrollOffset.y) {
        frame = {
          ...frame,
          x: frame.x - parentScrollOffset.x,
          y: frame.y - parentScrollOffset.y
        };
      }

      let path = null;
      if (node.id === hit.id) path = [];
      else if (node.type !== 'boolean') {
        path = visit(node.children || [], [...ancestors, frame], getPresentationScrollOffset(scrollState, frame));
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
