import {
  addNode, addVariableMode, addCommentReply, alignLayers, applyColorStyle, applyTypographyStyle, applyEffectStyle, bindColorVariable, bindVariable, canAlignLayers, canBindVariable, applyImageRecipe, canCombineBoolean, canGroupLayers, canUngroupLayers, canSwapComponentTo, cloneDocument, combineBoolean, createColorStyle, createColorVariable, createTypographyStyle, createEffectStyle, createVariable, createComponent, createComponentInstance, createComponentSet, createCommentThread,
  addComponentVariantFromMaster, createComponentProperty, createDocument, createExportSetting, createFillLayer, createGradientFill, createId, createImageRecipe, createLayoutGuide, createLayerEffect, createNode, createVariableCollection, deleteColorStyle, deleteEffectStyle, deleteVariable, deleteVariableCollection, detachComponentInstance, duplicateNode, findNode,
  findNodeAcrossPages, getActivePage, getNodeColor, getNodeGeometry, getNodePropertyValue, parseDocument, reconcilePrototypeScrollInteractions, removeNode, reorderNode, renameColorStyle, renameTypographyStyle, resolveVariableValue, resolveVariableValueWithModeOverrides, serializeDocument, setColorVariableValue, setVariableAlias, setVariableValue, setComponentVariantProperty, setFrameVariableMode, updateColorStyle, updateTypographyStyle, updateEffectStyle, deleteTypographyStyle, validateDocument, variableModeForNode,
  canCreateMaskGroup, createMaskGroup, groupLayers, releaseMaskGroup, removeCommentThread, setCommentResolved, separateBoolean, prepareBooleanBake, applyBooleanBake, switchComponentInstanceVariant, syncAllComponentInstances, syncComponentInstances, ungroupLayers,
  removeComponentVariantFromSet, resetComponentSlotContent, setComponentPropertyValue, setComponentSlotContent, updateNode, walkNodes
} from './model.js';
import { createImageFill, defaultImageAdjustments } from './image-fills.js';
import { clipboardImageFilename, routeClipboardPaste } from './image-clipboard.js';
import { createImageTransforms, flipImageTransforms, rotateImageTransforms } from './image-transforms.js';
import { calculateImageCropDisplayBounds, imageCropFromDisplayDrag, imageCropFromDisplayRect, imageCropToDisplayRect, moveImageCropHandle } from './image-crop-geometry.js';
import { calculateImageFillCropWindow, moveImageFillCropWindow, zoomImageFillCropWindow } from './image-fill-geometry.js';
import { createFallbackImage, createPillowFallbackImage, fallbackImageDimensions } from './fallback-image-bitmap.js';
import { imageDecodeFailureMessage, isImageImportCandidate, requiresPillowFallback } from './image-intake.js';
import { addFillLayer, detachPrimaryFillBinding, ensureFillStack, fillStackForNode, gradientFillToCSS, gradientTypes, insertGradientStop, isFillStackSupported, isValidGradientFill, moveFillLayer, removeFillLayer, resolveGradientGeometry, syncLegacyFillFields, updateFillLayer } from './fills.js';
import { addStroke, createStroke, detachPrimaryStrokeBinding, ensureStrokeStack, MAX_STROKES_PER_NODE, moveStroke, removeStroke, strokeStackForNode, syncLegacyStrokeFields, updateStroke } from './strokes.js';
import { layerBlendModes, layerBlendModeLabels } from './layer-blend.js';
import { firstBackdropEffect, glassEffectOverscan, glassVectorExportBlockReason, glassVisibleForNode } from './glass-effect.js';
import { MAX_DROP_SHADOWS_PER_LAYER, MAX_GLASS_EFFECTS_PER_LAYER, MAX_INNER_SHADOWS_PER_LAYER, MAX_NOISE_EFFECTS_PER_LAYER, MAX_TEXTURE_EFFECTS_PER_LAYER, moveLayerEffect } from './layer-effects.js';
import { History } from './history.js';
import { deepestContainerAtPagePoint, getPresentationScrollOffset, scrollableFramePathAtPagePoint, SceneRenderer, hitTestPage, screenToWorld, selectionOverlayGeometry, selectionGroupHandles, sliceSelectionHandles, worldToScreen } from './renderer.js';
import { calculateTextBox, measureTrackedText, normalizeTextParagraphStyles, preserveAutoWidthTextAnchor } from './text-layout.js';
import { summarizeTextRunRange } from './text-run-selection.js';
import { assertSafeRasterDimensions, IMAGE_HEADER_SCAN_BYTES, inspectRasterDimensions, LocalImageEngine, MAX_IMAGE_SOURCE_PIXELS } from './image-engine.js';
import { assertImagePayloadMatchesPreflight, defaultRetainedImageMemoryBudget, estimateAssetMemoryBytes, estimateBitmapBytes, estimatePreviewMemoryBytes, estimatePreviewMemoryReservationBytes, ImageMemoryLimitError, releaseImageMemoryReservations, RetainedImageMemoryBudget, transformedImageDimensions, withImageMemoryReservation } from './image-memory-budget.js';
import { encodeRenderedImageOutput } from './image-output.js';
import { collectLiveImageAssetIds, collectLiveImagePreviewNodeIds, imagePreviewFailureStatus, imagePreviewKey, pruneImageAssetRuntime, pruneImagePreviewRuntime, setImagePreviewFailureStatus } from './image-preview-runtime.js';
import { buildLocalPackageBlob, claimRecipeBatchRecovery, deleteFontAsset, deleteImageAsset, deleteRecipeBatchRecovery, deleteStoredDocument, DocumentSaveConflictError, duplicateStoredDocument, importLocalPackage, listComponentLibraries, listDocumentVersions, listFontAssets, listSavedDocuments, loadComponentLibrary, loadDocumentById, loadDocumentRecordById, loadDocumentVersion, loadFontAsset, loadImageAsset, loadImageAssetMetadata, loadImageAssetThumbnail, loadLatestDocument, loadLatestValidDocument, loadRecipeBatchRecovery, loadWorkspaceDirectoryHandle, localPackageFilename, MAX_LOCAL_PACKAGE_BYTES, publishStoredComponent, RecipeBatchRecoveryLeaseError, renameStoredDocument, saveComponentLibrary, saveDocument, saveDocumentVersion, saveFontAsset, saveImageAssetBytes, saveImageAssetThumbnail, saveRecipeBatchRecovery, saveWorkspaceDirectoryHandle, unpackLocalPackage } from './storage.js';
import { collectReferencedAssets, migrateIndexedDbToWorkspace } from './workspace/migration.js';
import { commitDesign as commitWorkspaceDesign, createDesign as createWorkspaceDesign, deleteDesign as deleteWorkspaceDesign, openDesign as openWorkspaceDesign } from './workspace/design-store.js';
import { deleteImageAsset as deleteWorkspaceImageAsset, readImageAsset as readWorkspaceImageAsset, saveImageAsset as saveWorkspaceImageAsset } from './workspace/asset-store.js';
import { deleteWorkspaceFontAsset, listWorkspaceFontAssets, readWorkspaceFontAsset, saveWorkspaceFontAsset } from './workspace/font-store.js';
import { createWorkspace, listWorkspaceDesignIds, openWorkspace, pickWorkspaceDirectory, requestWorkspacePermission, WorkspaceStoreError } from './workspace/workspace-store.js';
import { defaultLocalFontFamily, inspectLocalFontFormat, loadLocalFontFace, mapLocalFontAssets, MAX_LOCAL_FONT_BYTES, unloadLocalFontFace, validateLocalFontAsset } from './font-assets.js';
import { icon } from './icons.js';
import { cornerRadiusKeys } from './corner-radii.js';
import { strokeDecorationTypes } from './stroke-decorations.js';
import { applyAutoLayout as applyAutoLayoutEngine, createAutoLayout } from './layout-engine.js';
import { applyAutoLayoutSuggestion, suggestAutoLayout } from './layout-inference.js';
import { interpolateSmartFrame } from './smart-animate.js';
import { buildInspectOutput } from './inspect.js';
import { exportNodeToSvg, exportPageToSvg } from './svg-export.js';
import { createMultipagePdf, PDF_PACKAGER_LIMITS } from './pdf-packager.js';
import { orderedVisibleFrameIds } from './pdf-export-plan.js';
import { installHorizontalTabListKeyboard } from './tab-list-keyboard.js';
import { assertVectorPdfEffectsSupported, createMultipageVectorPdf, PdfVectorExportError } from './pdf-vector-export.js';
import { addVectorPdfEmbeddedImageBytes, hasRasterImageEdits, planVectorPdfRasterSource, VectorPdfImageBudgetError } from './pdf-raster-plan.js';
import { importSvgToLayers } from './svg-import.js';
import { parseLocalFigFile } from './fig-import-worker-client.js';
import { importDtcgTokens, mergeDtcgTokens, stringifyDtcgTokens } from './design-token-interop.js';
import { addPrototypeInteraction, applyPrototypeInteraction, backPrototypeSession, clearPrototypeHoverInteraction, createPrototypeSession, easePrototypeProgress, findClickableInteraction, findFrameAtPoint, findPrototypeDelayInteraction, getPrototypeStartFrame, listPrototypeFrames, normalizePrototypeLinkUrl, prototypeEasingTimingFunction, removePrototypeInteraction, restartPrototypeSession, resolvePrototypePresentationStart, schedulePrototypeDelay, updatePrototypeInteraction } from './prototype.js';
import { planPrototypeScrollTo } from './prototype-scroll.js';
import { createPrototypeFlow, deletePrototypeFlow, listPrototypeFlows, renamePrototypeFlow, setPrototypeFlowStartPoint, setPrototypeStartFlow } from './prototype.js';
import { deletePage as deleteManagedPage, duplicatePage as duplicateManagedPage, renamePage as renameManagedPage, reorderPage as reorderManagedPage } from './page-management.js';
import { applyFrameConstraints, captureChildGeometry, horizontalConstraints, verticalConstraints } from './constraints.js';
import { createLayerClipboard, pasteLayerClipboard } from './layer-clipboard.js';
import { applyAppearance, snapshotAppearance } from './appearance-clipboard.js';
import { canMoveLayerOneVisualRow, installLayerReorder, layerOrderShortcutDirection, moveLayerOneVisualRow } from './layer-order.js';
import { createStoredZip } from './store-zip.js';
import { assertImageArchiveFits, planImageArchive } from './image-export-plan.js';
import { isValidSliceDimensionInput, MAX_SLICE_EXPORT_PIXELS, planSliceRasterExport, planSliceRenderSurface, sliceExportContentSignature, sliceRasterBoundsIntersect, sliceRenderBleedPixels } from './slice-export-plan.js';
import { canDismissImageRecipeBatch, cancelImageRecipeBatch, completeImageRecipeBatchIfDrained, formatImageRecipeBatchTiming, imageRecipeBatchTiming, isImageRecipeBatchActive, pauseImageRecipeBatchClock, recordImageRecipeBatchTarget, resumeImageRecipeBatchClock, startImageRecipeBatchClock } from './bulk-recipe-state.js';
import { getTransformHandles, nodeLocalToPage, pageToNodeLocal, pageToNodeParentLocal, pageToParentLocal, resizeOrientedRect, shortestAngleDelta } from './transform-geometry.js';
import { shapeCreationGeometry } from './shape-creation-geometry.js';
import { appendLassoPoint, clipMarqueePolygonThroughAncestors, createLassoSelectionTest, isMarqueeLayerVisible, marqueeSelectsPolygon } from './marquee-selection.js';
import { variableStrokeOutlineFromSamples } from './variable-stroke-geometry.js';
import { normalizeVectorAnchorSelection, removeVectorPathAnchors, setVectorPathAnchorTranslation, toggleVectorAnchorSelection, vectorAnchorKey } from './vector-anchor-selection.js';
import { resizeSelection, rotateSelection, selectionAspectRatio, selectionBounds, selectionMoveBlockReason, translateSelection } from './group-transform.js';
import {
  appendVectorNetworkPathResolved, closestVectorNetworkEdge, closestVectorSegment, insertVectorNetworkPoint, insertVectorNodePoint,
  longestVectorNetworkEdge, longestVectorSegment, removeVectorNetworkVertex, removeVectorNodePoint,
  getVectorNetworkVertexMode, setVectorNetworkEdgeControlPoint, setVectorNetworkVertexMode, setVectorNetworkVertexPoint, setVectorNodePoint, setVectorNodePointMode, vectorGeometryFromAnchors,
  reverseVectorPathContour, vectorNetworkEdgePoints, vectorNetworkGeometryFromAnchors, vectorNetworkGeometryFromFreehandSamples, vectorNetworkVertexPoint, vectorNodePoint, vectorPathContours
} from './vector-path.js';
import { snapToAlignmentGuides } from './smart-guides.js';
import { clientToPageGuidePosition, findNearestGuideWithinCssTolerance } from './ruler-guide-geometry.js';
import { generateRulerTicks } from './ruler-scale.js';
import { nearestScreenHandle } from './selection-hit-testing.js';
import { createComponentLibrary, createLinkedInstanceSnapshot, updateLinkedInstanceSnapshot, validateLinkedInstanceSnapshot } from './component-library.js';
import { applyLinkedComponentUpdate, componentTreeForPublication, createLinkedEditorInstance, recordLinkedComponentOverride } from './linked-component-editor.js';
import { addComponentVariantAxis, componentSetAssetMarkup, removeComponentVariantAxis, renameComponentSet, renameComponentVariantAxis } from './component-set-editor.js';
import { createThemePreferenceController } from './theme-preference.js';
import { contextMenuItems, contextMenuNavigationTarget, focusFirstContextMenuItem, menuFocusReturnTarget, mobilePanelTabTarget, shouldDismissDesktopMenuOnTab } from './menu-keyboard.js';
import { toolbarNavigationTarget } from './toolbar-keyboard.js';
import { imageRecipeBatchAnnouncement } from './bulk-recipe-a11y.js';
import { MAX_TEXT_RUN_BASELINE_SHIFT, normalizeTextRunBaselineShift, transformTextRunsInRange } from './text-run-editing.js';
import { addImageLibraryEntries, addImageLibraryEntry, MAX_IMAGE_LIBRARY_ENTRIES, migrateImageLibraryEntry, removeImageLibraryEntry } from './image-asset-library.js';
import { scopeImageAssetReferences } from './image-asset-restoration.js';
import { mountImageLibraryView } from './image-library-view.js';
import { createImageLibraryThumbnailBlob } from './image-library-thumbnail.js';
import { createHostSessionController, createGuestSessionController } from './collaboration/session-controller.js';
import { decodeStableDesignInvite } from './collaboration/session-capsules.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const themePreferences = createThemePreferenceController();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const CPU_LIMIT = Math.min(8, Math.max(1, navigator.hardwareConcurrency || 4));
const PDF_EXPORT_JPEG_LIMIT = Math.min(128 * 1024 * 1024, PDF_PACKAGER_LIMITS.maxAggregateJpegBytes - 1);
const IMAGE_LIBRARY_THUMBNAIL_CACHE_LIMIT = 128;
const TYPOGRAPHY_STYLE_PROPERTIES = new Set([
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'paragraphSpacing', 'firstLineIndent', 'listSpacing', 'textCase', 'textDecoration'
]);
const state = {
  document: createDocument(), selectedIds: [], selectedVectorPoint: null, selectedVectorPoints: [], vectorPointSelectMode: false, tool: 'select', zoom: 1, panX: 0, panY: 0,
  gradientGeometryTarget: null,
  assets: new Map(), fontAssets: new Map(), fontFaces: new Map(), previews: new Map(), previewUrls: new Map(), previewAssetIds: new Map(), previewVersions: new Map(), imageStatus: new Map(), renderVersion: new Map(), assetThumbnailImages: new Map(), imageLibraryThumbnailUrls: new Map(), imageLibraryThumbnailLoads: new Map(), imageLibraryView: null,
  draftNode: null, penDraft: null, penHover: null, pencilDraft: null, marquee: null, smartGuides: [], interaction: null, pointerMap: new Map(),
  sidebarTab: 'layers', inspectorTab: 'design', clipboard: [], appearanceClipboard: null, controlEdit: false, layerSelectionMode: false,
  componentSetSelectedVariants: new Map(),
  bulk: null, pendingRecipeRecovery: null, textNodeId: null, textSelection: null, spaceDown: false, ready: false, layerSearch: '', showLayoutGuides: true, showRulers: false, selectedRulerGuideId: null, outlineMode: false,
  statusTimer: null, saveTimer: null, saveChain: Promise.resolve(), saveRevision: 0, documentStorageRevision: null,
  workspace: null, workspaceHandle: null, workspaceHead: null, workspacePermissionNeeded: false,
  workspaceVerifiedImageIds: new Map(), workspaceVerifiedFontIds: new Map(),
  liveCollaboration: null, liveReplicaHead: null, liveReplicaDesignId: null,
  documentSaveConflict: null, versionSaveLabel: 'Autosaved version', documentTransitioning: false, pendingImageImports: 0, lastLayerSelection: null,
  documentGeneration: 0,
  imageExportAbortController: null,
  localPackageBuilding: false,
  pendingLocalShare: null,
  pendingLocalShareTimer: 0,
  pendingVariableDialog: null, pendingCommentAnchor: null, activeCommentId: null,
  layoutGuideControlEdit: false,
  prototypeSourceId: null, prototypeEditingInteractionId: null, prototypeDestinationId: null,
  prototypeAction: 'navigate', prototypeUrl: 'https://', prototypeTrigger: 'on-click', prototypeTransition: 'instant', prototypeEasing: 'ease-in-out', prototypeDuration: 300, prototypeDelay: 1000,
  prototypeVariableCollectionId: null, prototypeVariableModeId: null,
  prototypeConditionVariableId: null, prototypeConditionOperator: 'equals', prototypeConditionValue: null,
  prototypeVariantTargetId: null, prototypeScrollTargetId: null, prototypeScrollAlignment: 'nearest',
  imageCropMode: false, imageCropOverlay: null, imageCropDraftSelection: null, imageFillCropTarget: null,
  componentPropertyTargetId: null, componentPropertyType: 'BOOLEAN',
  componentLibraries: [], componentLibraryTargetId: null,
  componentSlotDialog: null,
  prototypeOverlayPosition: 'center', prototypeOverlayOutsideClick: true, prototypeOverlayBackground: true,
  prototypeOverlayBackgroundColor: '#000000', prototypeOverlayBackgroundOpacity: 0.32,
  presenting: null
};
const history = new History(120);
const imageMemoryBudget = new RetainedImageMemoryBudget({ limitBytes: defaultRetainedImageMemoryBudget() });
const canvas = $('#scene-canvas');
const canvasScroll = $('#canvas-scroll');
let renderer;
let pendingRecipeNodeId = null;
let selectedEffectStyleId = '';
let bulkBarTicker = null;
let bulkConcurrencyTimer = 0;
const RECIPE_BATCH_LEASE_RENEW_MS = 30_000;
let recipeRecoveryExpiryTimer = 0;
let latestPageLayerIds = [];
let layerRowsById = new Map();
const collapsedLayerIds = new Set();
let currentToastTimer = 0;
let presentationAnimationFrame = 0;
const presentationTransitionFrames = new Set();
let presentationDelayCancel = null;
const imageEngine = new LocalImageEngine({ maxWorkers: CPU_LIMIT, onChange: updateImageEngineState });
const previewTimers = new Map();
const previewsEvictedForCapacity = new Set();
let nextImageRenderVersion = 0;
let presentRenderer = null;
let presentRenderState = null;
let presentRuntimeDocument = null;
let presentationPointerGesture = null;
const presentationDragThreshold = 7;
let textMeasureContext = null;
let pendingFontImport = null;
let pendingFigImport = null;
let gradientStopDrag = null;

function activePage() { return getActivePage(state.document); }
function pageGuides(page = activePage()) { return Array.isArray(page?.guides) ? page.guides : []; }
function clampGuidePosition(position) { return Math.max(-1e9, Math.min(1e9, position)); }
function guidePositionForClient(event, axis) {
  const rect = canvas.getBoundingClientRect();
  return clampGuidePosition(clientToPageGuidePosition({
    client: { x: event.clientX, y: event.clientY }, rect,
    pan: { x: state.panX, y: state.panY }, zoom: state.zoom, axis
  }));
}
function guideAtClientPoint(event) {
  if (!state.showRulers || state.presenting || state.documentTransitioning) return null;
  const guides = pageGuides();
  const hit = ['x', 'y'].map(axis => {
    const position = guidePositionForClient(event, axis);
    const nearest = findNearestGuideWithinCssTolerance(position,
      guides.filter(guide => guide.axis === axis).map(guide => guide.position),
      { zoom: state.zoom, tolerancePx: 7 });
    return nearest ? guides.find(guide => guide.axis === axis && guide.position === nearest.position) : null;
  }).filter(Boolean);
  return hit[0] || null;
}
function rulerDropZoneContains(event, axis) {
  const rect = canvas.getBoundingClientRect();
  return axis === 'x' ? event.clientY < rect.top + 24 : event.clientX < rect.left + 26;
}
function rulerGestureHasEnteredCanvas(event, axis) {
  const rect = canvas.getBoundingClientRect();
  return axis === 'x' ? event.clientY >= rect.top + 24 : event.clientX >= rect.left + 26;
}
function updateRulerGuideGesture(event) {
  const interaction = state.interaction;
  if (!interaction || !['ruler-guide-create', 'ruler-guide-move'].includes(interaction.kind)
    || interaction.pointerId !== event.pointerId) return;
  const page = state.document.pages.find(item => item.id === interaction.pageId);
  if (!page) { cancelCanvasInteraction({ pointerId: event.pointerId }); return; }
  if (!interaction.guideId && interaction.kind === 'ruler-guide-create' && rulerGestureHasEnteredCanvas(event, interaction.axis)) {
    if (pageGuides(page).length >= 500) {
      showToast('A page can have up to 500 ruler guides.');
      cancelCanvasInteraction({ pointerId: event.pointerId });
      return;
    }
    interaction.historyTransaction = beginCanvasHistoryTransaction('Add ruler guide');
    page.guides ||= [];
    const guide = { id: createId('guide'), axis: interaction.axis, position: guidePositionForClient(event, interaction.axis) };
    page.guides.push(guide);
    interaction.guideId = guide.id;
    interaction.changed = true;
    state.selectedRulerGuideId = guide.id;
  } else if (interaction.guideId) {
    const guide = pageGuides(page).find(item => item.id === interaction.guideId);
    if (!guide) { cancelCanvasInteraction({ pointerId: event.pointerId }); return; }
    const position = guidePositionForClient(event, interaction.axis);
    interaction.changed ||= !Object.is(guide.position, position);
    guide.position = position;
  }
  renderer.invalidate();
}
function finishRulerGuideGesture(event) {
  const interaction = state.interaction;
  if (!interaction || !['ruler-guide-create', 'ruler-guide-move'].includes(interaction.kind)
    || interaction.pointerId !== event.pointerId) return false;
  updateRulerGuideGesture(event);
  if (state.interaction !== interaction) return true;
  const page = state.document.pages.find(item => item.id === interaction.pageId);
  const guides = pageGuides(page);
  const droppedBack = interaction.guideId && rulerDropZoneContains(event, interaction.axis);
  if (droppedBack) {
    page.guides = guides.filter(guide => guide.id !== interaction.guideId);
    state.selectedRulerGuideId = null;
  }
  state.interaction = null;
  const committed = commitCanvasHistoryTransaction(interaction);
  if (committed) queueSave();
  renderer.invalidate();
  return true;
}
function handleRulerPointerDown(event, axis) {
  if (event.button !== 0 || !state.showRulers || state.documentTransitioning || state.presenting || state.imageCropMode
    || isImageRecipeBatchActive(state.bulk) || state.interaction || state.tool !== 'select') return;
  event.preventDefault();
  event.currentTarget.focus({ preventScroll: true });
  event.currentTarget.setPointerCapture?.(event.pointerId);
  state.interaction = {
    kind: 'ruler-guide-create', axis, pointerId: event.pointerId,
    pageId: state.document.activePageId, guideId: null, historyTransaction: null, changed: false
  };
}
function handleRulerKeyboard(event) {
  if (!state.showRulers || state.documentTransitioning || state.presenting || state.imageCropMode || isImageRecipeBatchActive(state.bulk)) return;
  const axis = event.currentTarget === $('#ruler-horizontal') ? 'x' : 'y';
  if (event.key === 'Escape') {
    state.selectedRulerGuideId = null;
    renderer.invalidate();
    event.preventDefault(); event.stopPropagation();
    return;
  }
  const guides = pageGuides();
  const selected = guides.find(guide => guide.id === state.selectedRulerGuideId);
  if (event.key === 'Enter') {
    if (guides.length >= 500) { showToast('A page can have up to 500 ruler guides.'); return; }
    const length = axis === 'x' ? canvas.clientWidth : canvas.clientHeight;
    const pan = axis === 'x' ? state.panX : state.panY;
    checkpoint('Add ruler guide');
    const guide = { id: createId('guide'), axis, position: clampGuidePosition((length / 2 - pan) / state.zoom) };
    activePage().guides ||= [];
    activePage().guides.push(guide);
    state.selectedRulerGuideId = guide.id;
    queueSave(); renderer.invalidate();
    event.preventDefault(); event.stopPropagation();
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
    checkpoint('Remove ruler guide');
    activePage().guides = guides.filter(guide => guide.id !== selected.id);
    state.selectedRulerGuideId = null;
    queueSave(); renderer.invalidate();
    event.preventDefault(); event.stopPropagation();
    return;
  }
  const direction = axis === 'x'
    ? (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)
    : (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0);
  if (!selected || selected.axis !== axis || !direction) return;
  checkpoint('Move ruler guide');
  selected.position = clampGuidePosition(selected.position + direction * (event.shiftKey ? 10 : 1));
  queueSave(); renderer.invalidate();
  event.preventDefault(); event.stopPropagation();
}
function drawRulerScales(currentState) {
  if (!currentState.showRulers) return;
  drawRulerScale($('#ruler-horizontal'), 'x', currentState);
  drawRulerScale($('#ruler-vertical'), 'y', currentState);
}
function drawRulerScale(rail, axis, currentState) {
  const surface = rail?.querySelector('canvas');
  if (!surface) return;
  const rect = rail.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (surface.width !== width) surface.width = width;
  if (surface.height !== height) surface.height = height;
  const context = surface.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const horizontal = axis === 'x';
  const viewportLength = horizontal ? rect.width : rect.height;
  const screenPan = horizontal ? currentState.panX : currentState.panY;
  const ticks = generateRulerTicks({ viewportLength, zoom: currentState.zoom, screenPan }).ticks;
  const color = getComputedStyle(rail).color;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 1;
  context.font = '9px system-ui, sans-serif';
  context.textBaseline = 'top';
  for (const tick of ticks) {
    context.beginPath();
    if (horizontal) {
      context.moveTo(Math.round(tick.position) + .5, rect.height);
      context.lineTo(Math.round(tick.position) + .5, rect.height - (tick.major ? 7 : 3));
      context.stroke();
      if (tick.major) context.fillText(tick.label, tick.position + 2, 2);
    } else {
      context.moveTo(rect.width, Math.round(tick.position) + .5);
      context.lineTo(rect.width - (tick.major ? 7 : 3), Math.round(tick.position) + .5);
      context.stroke();
      if (tick.major) {
        context.save();
        context.translate(12, tick.position);
        context.rotate(-Math.PI / 2);
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(tick.label, 0, 0);
        context.restore();
      }
    }
  }
}
function selectedEntries() { return state.selectedIds.map(id => findNode(state.document, id)).filter(Boolean); }
function selectedNodes() { return selectedEntries().map(entry => entry.node); }
function resolvedGeometry(node) { return getNodeGeometry(state.document, node); }
function isLocalLinkedComponent(node) { return node?.linkedComponent?.schema === 'tiny-image-star/linked-component-instance/1'; }
const systemFontFamilyPresets = ['Inter, Arial, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'monospace', 'system-ui, sans-serif', 'Verdana, sans-serif', 'Trebuchet MS, sans-serif', 'Times New Roman, serif', 'Courier New, monospace'];

function renderFontFamilyOptions() {
  const datalist = $('#font-family-options');
  if (!datalist) return;
  datalist.replaceChildren();
  const families = new Set([...systemFontFamilyPresets, ...[...state.fontAssets.values()].map(font => font.family)]);
  for (const family of families) {
    const option = document.createElement('option');
    option.value = family;
    datalist.append(option);
  }
}

function renderLocalFontAssets() {
  const list = $('#font-assets-list');
  if (!list) return;
  list.replaceChildren();
  const fonts = [...state.fontAssets.values()];
  if (!fonts.length) {
    const empty = document.createElement('div'); empty.className = 'local-fonts-empty';
    empty.textContent = 'Add a font file to use it in text layers and portable design files.';
    list.append(empty);
  }
  for (const font of fonts) {
    const row = document.createElement('div'); row.className = 'local-font-row'; row.dataset.fontAssetId = font.id;
    const sample = document.createElement('span'); sample.className = 'local-font-sample'; sample.textContent = 'Aa';
    sample.style.fontFamily = `"${font.family.replace(/["\\]/gu, '')}"`;
    sample.style.fontWeight = String(font.weight); sample.style.fontStyle = font.style;
    const copy = document.createElement('span'); copy.className = 'local-font-copy';
    const family = document.createElement('strong'); family.className = 'local-font-family'; family.textContent = font.family;
    const detail = document.createElement('small'); detail.textContent = `${font.weight} · ${font.style} · ${font.name}`;
    copy.append(family, detail);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'tiny-icon-button local-font-remove';
    remove.dataset.action = 'remove-local-font'; remove.dataset.fontId = font.id; remove.textContent = '×';
    remove.title = `Remove ${font.family} ${font.weight} ${font.style}`;
    remove.setAttribute('aria-label', `Remove local font ${font.family}, ${font.weight} ${font.style}`);
    row.append(sample, copy, remove); list.append(row);
  }
  renderFontFamilyOptions();
}

async function refreshLocalFontAssets({ showFailureToast = false } = {}) {
  const records = await listActiveFontAssets();
  for (const face of state.fontFaces.values()) unloadLocalFontFace(face);
  state.fontFaces.clear();
  state.fontAssets = new Map(records.map(font => [font.id, font]));
  if (typeof FontFace === 'function' && document.fonts?.add) {
    // Keep binary reads and browser font parsing bounded when a device has a large local font catalog.
    const results = await mapLocalFontAssets(records, async font => {
      const saved = await loadActiveFontAsset(font.id);
      if (!saved) return { id: font.id, error: true };
      try { return { id: font.id, face: await loadLocalFontFace(saved) }; }
      catch { return { id: font.id, error: true }; }
    }, 2);
    for (const result of results) if (result.face) state.fontFaces.set(result.id, result.face);
    if (showFailureToast && results.some(result => result.error)) showToast('Some local fonts could not be loaded. Their text uses the browser fallback until you replace the font file.');
  }
  renderLocalFontAssets();
}

function familyStackUses(fontFamily, family) {
  const tokens = [];
  let token = '';
  let quote = '';
  let escaped = false;
  for (const character of String(fontFamily || '')) {
    if (quote) {
      token += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
      token += character;
    } else if (character === ',') {
      tokens.push(token); token = '';
    } else token += character;
  }
  tokens.push(token);
  const normalize = value => value.trim().replace(/^("|')(.*)\1$/u, '$2').replace(/\\(["'\\])/gu, '$1');
  return tokens.some(value => normalize(value).toLocaleLowerCase() === family.toLocaleLowerCase());
}

function documentUsesFontFamily(design, family) {
  const visited = new WeakSet();
  const visit = value => {
    if (!value || typeof value !== 'object' || visited.has(value)) return false;
    visited.add(value);
    if (Array.isArray(value)) return value.some(visit);
    return Object.entries(value).some(([key, child]) => key === 'fontFamily'
      ? familyStackUses(child, family)
      : visit(child));
  };
  return visit(design);
}

async function openLocalFontImport(file) {
  if (!file) return;
  try {
    if (file.size > MAX_LOCAL_FONT_BYTES) throw new TypeError(`Font files must be ${MAX_LOCAL_FONT_BYTES / 1024 / 1024} MB or smaller.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const format = inspectLocalFontFormat(file.name, bytes);
    pendingFontImport = { id: createId('font'), name: file.name, type: format.type, bytes };
    $('#font-family-name').value = defaultLocalFontFamily(file.name);
    $('#font-weight-value').value = '400';
    $('#font-style-value').value = 'normal';
    $('#font-import-file-name').textContent = `${file.name} · ${Math.ceil(bytes.byteLength / 1024)} KB`;
    $('#font-import-dialog').showModal();
    $('#font-family-name').focus({ preventScroll: true });
  } catch (error) {
    showToast(error.message || 'Could not read this font file.');
    $('#font-input').value = '';
  }
}

async function savePendingLocalFont() {
  if (!pendingFontImport) return;
  const family = $('#font-family-name').value.trim();
  const weight = Number($('#font-weight-value').value);
  const style = $('#font-style-value').value;
  const candidate = validateLocalFontAsset({ ...pendingFontImport, family, weight, style });
  const matching = [...state.fontAssets.values()].find(font => font.family.toLocaleLowerCase() === family.toLocaleLowerCase()
    && font.weight === weight && font.style === style);
  if (matching) {
    const existing = await loadActiveFontAsset(matching.id);
    if (existing?.bytes.length === candidate.bytes.length && existing.bytes.every((byte, index) => byte === candidate.bytes[index])) {
      $('#font-import-dialog').close('duplicate');
      showToast(`${family} ${weight} ${style} is already installed.`);
      return;
    }
    throw new TypeError(`A different ${weight} ${style} face for “${family}” is already installed. Choose another family name.`);
  }
  const face = await loadLocalFontFace(candidate, { register: false });
  if (state.workspace) {
    const snapshot = JSON.parse(serializeDocument(state.document));
    await enqueueWorkspaceSnapshot(snapshot);
    await saveWorkspaceFontAsset(state.workspace, snapshot.id, candidate);
    workspaceIdCache(state.workspaceVerifiedFontIds, snapshot.id).add(candidate.id);
  } else await saveFontAsset(candidate);
  try { document.fonts.add(face); }
  catch (error) {
    if (state.workspace) await deleteWorkspaceFontAsset(state.workspace, state.document.id, candidate.id);
    else await deleteFontAsset(candidate.id);
    throw error;
  }
  state.fontAssets.set(candidate.id, { id: candidate.id, name: candidate.name, type: candidate.type, family: candidate.family, weight: candidate.weight, style: candidate.style });
  state.fontFaces.set(candidate.id, face);
  renderLocalFontAssets();
  renderInspector();
  renderer.invalidate();
  $('#font-import-dialog').close('imported');
  showToast(`Local font “${family}” is ready to use.`);
}

async function removeLocalFont(id) {
  const font = state.fontAssets.get(id);
  if (!font) return;
  const remove = globalThis.confirm?.(`Remove ${font.family} ${font.weight} ${font.style} from this browser? Designs using this face will use a fallback font. Local design packages already exported keep their copy.`);
  if (remove === false) return;
  if (state.workspace) {
    await deleteWorkspaceFontAsset(state.workspace, state.document.id, id);
    workspaceIdCache(state.workspaceVerifiedFontIds, state.document.id).delete(id);
  } else await deleteFontAsset(id);
  unloadLocalFontFace(state.fontFaces.get(id));
  state.fontFaces.delete(id);
  state.fontAssets.delete(id);
  renderLocalFontAssets();
  renderInspector();
  renderer.invalidate();
  showToast(`Local font “${font.family}” removed.`);
}
function hasValidLocalComponentSnapshot(node) {
  if (!isLocalLinkedComponent(node)) return false;
  try { return validateLinkedInstanceSnapshot(node.linkedComponent); }
  catch { return false; }
}
function componentInstanceRoot(nodeId) {
  const entry = findNode(state.document, nodeId);
  if (!entry) return null;
  return [...entry.parents, entry.node].reverse().find(node => node.isInstance || isLocalLinkedComponent(node)) || null;
}
function recordComponentOverride(instanceRoot, node, property) {
  if (!instanceRoot || !node.componentSourceId) return;
  const key = property.split('.')[0];
  if (isLocalLinkedComponent(instanceRoot)) {
    if (!hasValidLocalComponentSnapshot(instanceRoot)) return;
    if (key === 'id' || key === 'type' || key === 'children' || key === 'componentId' || key === 'componentOverrides'
      || key === 'componentPropertyValues' || key === 'isComponent' || key === 'isInstance'
      || (node.id === instanceRoot.id && ['x', 'y', 'name'].includes(key))) return;
    try {
      recordLinkedComponentOverride(instanceRoot.linkedComponent, node.componentSourceId, key, node[key]);
    } catch (error) {
      console.warn('Could not record local component override', error);
    }
    return;
  }
  if (node.id === instanceRoot.id && (key === 'x' || key === 'y')) return;
  instanceRoot.componentOverrides ||= {};
  instanceRoot.componentOverrides[node.componentSourceId] ||= {};
  instanceRoot.componentOverrides[node.componentSourceId][key] = node[key] === undefined ? null : structuredClone(node[key]);
}
function recordNodeComponentOverrides(node, properties) {
  const instanceRoot = componentInstanceRoot(node.id);
  for (const property of properties) recordComponentOverride(instanceRoot, node, property);
}
function setNodePropertyValue(node, property, value) {
  const variableId = node.variableBindings?.[property];
  if (!variableId) { node[property] = value; return true; }
  const variable = state.document.variables?.find(item => item.id === variableId);
  if (!variable) return false;
  const modeId = variableModeForNode(state.document, variable.collectionId, node);
  return setVariableValue(state.document, variableId, value, modeId);
}
function imageNodes(page = activePage()) {
  const nodes = [];
  if (page) walkNodes(page.children, ({ node }) => { if (node.type === 'image') nodes.push(node); });
  return nodes;
}
function rootSelectedIds() {
  const selected = new Set(state.selectedIds);
  return selectedEntries().filter(entry => !entry.parents.some(parent => selected.has(parent.id))).map(entry => entry.node.id);
}
function orderedRootSelectedEntries() {
  const selected = new Set(rootSelectedIds());
  const order = new Map();
  let nextOrder = 0;
  walkNodes(activePage()?.children || [], ({ node }) => order.set(node.id, nextOrder++));
  return selectedEntries().filter(entry => selected.has(entry.node.id)).sort((left, right) => (order.get(left.node.id) ?? 0) - (order.get(right.node.id) ?? 0));
}
function hasClipboardLayers() { return Boolean(state.clipboard?.schema && state.clipboard.items?.length); }
function storageDestinationName() {
  const name = state.workspaceHandle?.name || state.workspace?.directoryHandle?.name;
  return name ? `folder “${name}”` : 'the browser';
}
function syncStorageModeLabel() {
  const folderMode = Boolean(state.workspace);
  const pendingFolder = Boolean(state.workspacePermissionNeeded && state.workspaceHandle);
  const mode = folderMode ? 'folder' : 'browser';
  const label = folderMode
    ? `Folder workspace · ${state.workspaceHandle?.name || 'selected folder'}`
    : pendingFolder ? `Folder access needed · ${state.workspaceHandle.name || 'saved folder'}` : 'Browser storage';
  const chip = $('#storage-mode-chip');
  if (chip) {
    chip.textContent = folderMode ? 'Folder' : pendingFolder ? 'Reconnect' : 'Browser';
    chip.title = folderMode ? `Saving to ${label}` : pendingFolder ? `${label}. Reconnect before editing.` : 'Saving in this browser profile';
    chip.setAttribute('aria-label', chip.title);
    chip.dataset.mode = pendingFolder ? 'reconnect' : mode;
  }
  const footer = $('#storage-mode-label');
  if (footer) footer.textContent = label;
}
function savingStatusText() { return 'Saving locally…'; }
function savedStatusText() { return 'Saved locally'; }
function failedStatusText() { return state.workspace ? 'Folder save failed' : 'Browser save failed'; }
function setSaveState(kind, text) {
  const element = $('#save-state');
  element.classList.toggle('is-saving', kind === 'saving');
  element.classList.toggle('is-error', kind === 'error');
  element.lastElementChild.textContent = text;
}

function workspaceNotFound(error, code) {
  return error instanceof WorkspaceStoreError && error.code === code;
}

function workspaceSeedDocument(documentData) {
  const seed = createDocument();
  seed.id = documentData.id;
  seed.name = documentData.name;
  seed.pages = documentData.pages.map((page, index) => ({
    id: page.id,
    name: page.name || `Page ${index + 1}`,
    children: [],
    guides: []
  }));
  seed.activePageId = seed.pages.some(page => page.id === documentData.activePageId)
    ? documentData.activePageId : seed.pages[0].id;
  return seed;
}

function imageAssetName(documentData, assetId) {
  const libraryEntry = (documentData?.imageLibrary || []).find(entry => entry.assetId === assetId);
  if (libraryEntry?.name) return libraryEntry.name;
  for (const reference of imageAssetReferencesAcrossPages(documentData)) {
    if (reference.assetId === assetId && reference.name) return reference.name;
  }
  return assetId;
}

function workspaceIdCache(cache, designId) {
  let ids = cache.get(designId);
  if (!ids) { ids = new Set(); cache.set(designId, ids); }
  return ids;
}

async function ensureWorkspaceSnapshotAssets(documentData) {
  const workspace = state.workspace;
  if (!workspace) return;
  const references = collectReferencedAssets(documentData);
  const imageIds = workspaceIdCache(state.workspaceVerifiedImageIds, documentData.id);
  for (const assetId of references.imageAssetIds) {
    if (imageIds.has(assetId)) continue;
    try {
      await readWorkspaceImageAsset(workspace, documentData.id, assetId);
      imageIds.add(assetId);
      continue;
    } catch (error) {
      if (!workspaceNotFound(error, 'ASSET_NOT_FOUND')) throw error;
    }
    const source = await loadImageAsset(assetId);
    if (!source?.bytes) throw new Error(`Image source “${imageAssetName(documentData, assetId)}” is missing from this device and the selected folder.`);
    await saveWorkspaceImageAsset(workspace, documentData.id, assetId, source.bytes, { mimeType: source.type });
    imageIds.add(assetId);
  }

  const fontIds = workspaceIdCache(state.workspaceVerifiedFontIds, documentData.id);
  const referencedFontSpecs = references.fontSpecs;
  if (!referencedFontSpecs.length) return;
  const fontCatalog = await listFontAssets();
  const usedFonts = fontCatalog.filter(font => referencedFontSpecs.some(spec =>
    spec.family.toLocaleLowerCase() === font.family.toLocaleLowerCase()
      && spec.weight === font.weight && spec.style === font.style));
  for (const font of usedFonts) {
    if (fontIds.has(font.id)) continue;
    try {
      await readWorkspaceFontAsset(workspace, documentData.id, font.id);
      fontIds.add(font.id);
      continue;
    } catch (error) {
      if (!workspaceNotFound(error, 'FONT_NOT_FOUND')) throw error;
    }
    const source = await loadFontAsset(font.id);
    if (!source?.bytes) throw new Error(`Local font “${font.family}” is missing from this device and the selected folder.`);
    await saveWorkspaceFontAsset(workspace, documentData.id, source);
    fontIds.add(font.id);
  }
}

async function persistWorkspaceSnapshot(snapshot) {
  const workspace = state.workspace;
  if (!workspace) throw new Error('No folder workspace is active.');
  let opened;
  try { opened = await openWorkspaceDesign(workspace, snapshot.id); }
  catch (error) {
    if (!workspaceNotFound(error, 'DESIGN_NOT_FOUND')) throw error;
    await createWorkspaceDesign(workspace, workspaceSeedDocument(snapshot));
    opened = await openWorkspaceDesign(workspace, snapshot.id);
  }
  await ensureWorkspaceSnapshotAssets(snapshot);
  const current = JSON.stringify(opened.document);
  const candidate = JSON.stringify(snapshot);
  if (current === candidate) {
    if (state.document.id === snapshot.id) state.workspaceHead = opened.head;
    return opened;
  }
  const pageId = snapshot.activePageId && snapshot.pages.some(page => page.id === snapshot.activePageId)
    ? snapshot.activePageId : snapshot.pages[0]?.id;
  if (!pageId) throw new Error('A workspace design must contain at least one page.');
  const expectedHead = state.document.id === snapshot.id && state.workspaceHead
    ? state.workspaceHead : opened.head;
  const committed = await commitWorkspaceDesign(workspace, snapshot.id, snapshot, { expectedHead, pageId });
  if (committed.acknowledged !== true) throw new Error('The folder workspace did not confirm a durable design save.');
  if (state.document.id === snapshot.id) state.workspaceHead = committed.head;
  return committed;
}

function enqueueWorkspaceSnapshot(snapshot) {
  const next = state.saveChain.catch(() => {}).then(() => persistWorkspaceSnapshot(snapshot));
  state.saveChain = next.catch(() => {});
  return next;
}

async function loadActiveImageAssetMetadata(assetId, documentData = state.document) {
  const catalog = await loadImageAssetMetadata(assetId);
  if (!state.workspace) return catalog;
  if (catalog) return catalog;
  const saved = await readWorkspaceImageAsset(state.workspace, documentData.id, assetId);
  const dimensions = inspectRasterDimensions(saved.bytes);
  return {
    id: assetId,
    name: imageAssetName(documentData, assetId),
    type: saved.metadata.mimeType,
    byteLength: saved.metadata.byteLength,
    dimensions: dimensions ? { width: dimensions.width, height: dimensions.height, pixels: dimensions.pixels,
      ...(Number.isInteger(dimensions.orientation) && dimensions.orientation !== 1 ? { orientation: dimensions.orientation } : {}) } : null
  };
}

async function loadActiveImageAsset(assetId) {
  if (!state.workspace) return loadImageAsset(assetId);
  const saved = await readWorkspaceImageAsset(state.workspace, state.document.id, assetId);
  const catalog = await loadImageAssetMetadata(assetId);
  return {
    id: assetId,
    name: catalog?.name || imageAssetName(state.document, assetId),
    type: saved.metadata.mimeType,
    bytes: saved.bytes
  };
}

async function persistActiveImageAsset(assetId, name, mimeType, bytes) {
  if (!state.workspace) return saveImageAssetBytes(assetId, name, mimeType, bytes);
  const snapshot = JSON.parse(serializeDocument(state.document));
  await enqueueWorkspaceSnapshot(snapshot);
  const result = await saveWorkspaceImageAsset(state.workspace, snapshot.id, assetId, bytes, { mimeType });
  workspaceIdCache(state.workspaceVerifiedImageIds, snapshot.id).add(assetId);
  return result;
}

async function listActiveFontAssets() {
  if (!state.workspace) return listFontAssets();
  return (await listWorkspaceFontAssets(state.workspace, state.document.id)).map(({ metadata, bytes }) => ({
    id: metadata.id, name: metadata.name, type: metadata.type, family: metadata.family,
    weight: metadata.weight, style: metadata.style, byteLength: bytes.byteLength
  }));
}

async function loadActiveFontAsset(fontId) {
  if (!state.workspace) return loadFontAsset(fontId);
  const saved = await readWorkspaceFontAsset(state.workspace, state.document.id, fontId);
  return validateLocalFontAsset({ ...saved.metadata, bytes: saved.bytes });
}

async function initializeWorkspaceForHandle(handle, { migrate = true } = {}) {
  let workspace;
  try { workspace = await openWorkspace(handle); }
  catch (error) {
    if (!workspaceNotFound(error, 'MANIFEST_MISSING')) throw error;
    workspace = await createWorkspace(handle);
  }
  if (migrate) {
    const result = await migrateIndexedDbToWorkspace(workspace, {
      onProgress: progress => {
        if (progress?.status === 'running') setSaveState('saving', `Migrating · ${progress.designIndex + 1}/${progress.designCount}`);
      }
    });
    if (result.status !== 'complete') {
      const first = result.errors[0];
      throw new Error(first
        ? `Folder migration paused at ${first.designId}: ${first.message}. The folder was not activated; choose it again to resume safely.`
        : 'Folder migration is incomplete. The folder was not activated; choose it again to resume safely.');
    }
  }
  const designIds = await listWorkspaceDesignIds(workspace);
  const designId = designIds.includes(state.document.id) ? state.document.id : designIds[0];
  if (!designId) throw new Error('The selected folder has no completed designs. Save a design before reconnecting this workspace.');
  const opened = await openWorkspaceDesign(workspace, designId);
  await saveWorkspaceDirectoryHandle(handle);
  return { workspace, opened };
}

async function activateWorkspace(handle, { migrate = true, reconnect = false } = {}) {
  if (state.documentTransitioning) throw new Error('Wait for the current design switch to finish before changing storage.');
  if (state.pendingImageImports || isImageRecipeBatchActive(state.bulk)) throw new Error('Finish the current image import or recipe batch before changing storage.');
  if (migrate && !state.workspacePermissionNeeded && !(await persistCurrentDocumentNow())) {
    throw new Error('The current design could not be saved before folder migration.');
  }
  state.documentTransitioning = true;
  $('.workspace').inert = true;
  setSaveState('saving', migrate ? 'Preparing folder workspace…' : 'Reconnecting folder…');
  try {
    const { workspace, opened } = await initializeWorkspaceForHandle(handle, { migrate });
    const previousDocument = state.document;
    state.imageExportAbortController?.abort();
    releaseImageRuntimeForDocumentSwitch();
    state.workspace = workspace;
    state.workspaceHandle = handle;
    state.workspaceHead = opened.head;
    state.workspacePermissionNeeded = false;
    $('#document-name').readOnly = false;
    state.document = opened.document;
    state.pendingRecipeRecovery = await recipeRecoveryForDocument(opened.document.id);
    state.workspaceVerifiedImageIds.clear();
    state.workspaceVerifiedFontIds.clear();
    const assetIds = collectReferencedAssets(opened.document).imageAssetIds;
    state.workspaceVerifiedImageIds.set(opened.document.id, new Set(assetIds));
    try {
      const fonts = await listWorkspaceFontAssets(workspace, opened.document.id);
      state.workspaceVerifiedFontIds.set(opened.document.id, new Set(fonts.map(font => font.metadata.id)));
    } catch (error) {
      if (!workspaceNotFound(error, 'FONT_NOT_FOUND')) throw error;
    }
    state.documentSaveConflict = null;
    state.versionSaveLabel = reconnect ? 'Reopened folder workspace' : 'Moved to folder workspace';
    state.documentStorageRevision = (await loadDocumentRecordById(opened.document.id))?.revision ?? null;
    syncStorageModeLabel();
    renderUI();
    await refreshLocalFontAssets({ showFailureToast: true });
    await restoreImageAssets(++state.documentGeneration);
    if (previousDocument !== state.document) history.undoStack.length = history.redoStack.length = 0;
    setSaveState('saved', savedStatusText());
    showToast(reconnect ? 'Folder workspace reconnected. Your design is open from that folder.' : 'Folder workspace ready. Designs save to the selected folder.');
    return true;
  } catch (error) {
    setSaveState('error', failedStatusText());
    throw error;
  } finally {
    state.documentTransitioning = false;
    $('.workspace').inert = Boolean(state.workspacePermissionNeeded || state.pendingRecipeRecovery);
  }
}

async function chooseWorkspaceFolder() {
  try {
    // Keep the native picker call in the menu action's user activation.
    const pickerResult = pickWorkspaceDirectory();
    const handle = await pickerResult;
    const existingPermission = await handle.queryPermission({ mode: 'readwrite' });
    if (existingPermission !== 'granted') {
      const requestedPermission = await requestWorkspacePermission(handle);
      if (requestedPermission !== 'granted') throw new Error('Folder access was not granted. Choose the folder again and allow read and write access.');
    }
    let sameAsSaved = false;
    try { sameAsSaved = Boolean(state.workspaceHandle && await state.workspaceHandle.isSameEntry?.(handle)); }
    catch { sameAsSaved = false; }
    if (sameAsSaved && state.workspace) {
      state.workspaceHandle = handle;
      await saveWorkspaceDirectoryHandle(handle);
      syncStorageModeLabel();
      showToast('This folder workspace is already active.');
      return;
    }
    if (sameAsSaved && state.workspacePermissionNeeded) {
      await activateWorkspace(handle, { migrate: false, reconnect: true });
      return;
    }
    await activateWorkspace(handle, { migrate: true });
  } catch (error) {
    if (error?.name !== 'AbortError') showToast(error.message || 'Could not open the selected folder workspace.');
  }
}

async function reconnectWorkspaceFolder() {
  try {
    const handle = state.workspaceHandle || await loadWorkspaceDirectoryHandle();
    if (!handle) throw new Error('Choose a folder workspace first.');
    const permission = await requestWorkspacePermission(handle);
    if (permission !== 'granted') throw new Error('Folder access was not granted. Choose the folder again and allow read and write access.');
    await activateWorkspace(handle, { migrate: false, reconnect: true });
  } catch (error) { showToast(error.message || 'Could not reconnect the folder workspace.'); }
}

function enqueueDocumentSave(snapshot, versionName = 'Autosaved version', recordVersion = true) {
  const next = state.saveChain.catch(() => {}).then(async () => {
    const conflict = state.documentSaveConflict;
    const persistedSnapshot = conflict
      ? { ...snapshot, id: conflict.recoveryId, name: conflict.recoveryName }
      : snapshot;
    let savedRevision = null;
    if (state.workspace) {
      await persistWorkspaceSnapshot(persistedSnapshot);
      try {
        savedRevision = await saveDocument(persistedSnapshot, { expectedRevision: state.documentStorageRevision });
        state.documentStorageRevision = savedRevision;
      } catch (error) {
        // IndexedDB is only a library/index mirror after folder mode is active.
        // The workspace commit has already been verified and remains authoritative.
        console.warn('The folder save succeeded, but its optional browser library mirror could not be updated.', error);
      }
    } else {
      savedRevision = conflict
        ? await saveDocument(persistedSnapshot)
        : await saveDocument(persistedSnapshot, { expectedRevision: state.documentStorageRevision });
      if (conflict) conflict.saved = true;
      else state.documentStorageRevision = savedRevision;
    }
    let versionError = null;
    if (recordVersion) {
      try { await saveDocumentVersion(persistedSnapshot, { name: versionName }); }
      catch (error) { versionError = error; }
    }
    return { versionError, recoveryCopy: Boolean(conflict) };
  });
  state.saveChain = next.catch(() => {});
  return next;
}
async function preserveDocumentSaveConflict(snapshot, error) {
  if (!state.documentSaveConflict) {
    let latestSnapshot = snapshot;
    try { latestSnapshot = JSON.parse(serializeDocument(state.document)); }
    catch { /* Keep the last validated autosave snapshot for recovery. */ }
    const sourceName = String(latestSnapshot.name || 'Untitled').trim().slice(0, 92) || 'Untitled';
    const recoveryName = `${sourceName} (recovered edits)`;
    state.documentSaveConflict = {
      sourceDocumentId: error.documentId,
      expectedRevision: error.expectedRevision,
      actualRevision: error.actualRevision,
      recoveryId: createId('recovery'),
      recoveryName,
      saved: false
    };
    showToast(`Another tab saved a newer version. This tab will stop overwriting it; your edits are being saved as “${recoveryName}”.`, 8000);
  }
  const recovery = state.documentSaveConflict;
  const latestSnapshot = JSON.parse(serializeDocument(state.document));
  const result = await enqueueDocumentSave(latestSnapshot, 'Recovered edits from another tab', false);
  recovery.saved = result.recoveryCopy;
  return recovery;
}
function setDocumentEditingBlocked(blocked) {
  $('.topbar').inert = blocked;
  $('.workspace').inert = blocked || state.workspacePermissionNeeded;
}
function queueSave({ refreshLayerTree = true } = {}) {
  if (!state.ready) return;
  state.saveRevision += 1;
  if (syncAllComponentInstances(state.document)) {
    reconcileImagePreviewRuntime();
    if (refreshLayerTree) renderLayers();
    renderer?.invalidate();
  }
  const saveOwner = state.bulk || null;
  if (saveOwner) {
    saveOwner.savePending = true;
    saveOwner.saveError = null;
  }
  setSaveState('saving', savingStatusText());
  if (state.documentTransitioning) {
    if (saveOwner && state.bulk === saveOwner) saveOwner.savePending = false;
    return;
  }
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    state.saveTimer = null;
    const revision = state.saveRevision;
    try {
      reconcileImageAssetRuntime();
      const snapshot = JSON.parse(serializeDocument(state.document));
      const { versionError, recoveryCopy } = await enqueueDocumentSave(snapshot, state.versionSaveLabel, !isImageRecipeBatchActive(state.bulk));
      let awaitingHost = false;
      const live = state.liveCollaboration;
      if (live?.role === 'guest' && live.replicaReady && live.controller
        && ['connected', 'pending'].includes(live.controller.state)) {
        const proposalSnapshot = JSON.parse(JSON.stringify(snapshot));
        proposalSnapshot.id = live.hostDesignId;
        if (proposalSnapshot.settings) delete proposalSnapshot.settings.collaborationSource;
        try {
          live.controller.proposeSnapshot(proposalSnapshot);
          awaitingHost = true;
        } catch (error) {
          // The local folder checkpoint is already durable. Freeze the old
          // session and let fork recovery preserve this copy if its pending
          // operation budget or protocol state has been reached.
          showToast(`Your local copy is saved. Live edits stopped safely: ${error.message || 'the pending edit limit was reached'}.`, 7000);
          live.controller.close();
        }
      }
      if (revision === state.saveRevision) {
        setSaveState(recoveryCopy ? 'error' : awaitingHost ? 'saving' : 'saved', recoveryCopy ? 'Conflict · copy saved' : awaitingHost ? 'Waiting for owner save' : versionError ? `Saved · ${storageDestinationName()} · history unavailable` : savedStatusText());
        if (saveOwner && state.bulk === saveOwner) {
          saveOwner.savePending = false;
          saveOwner.saveError = recoveryCopy ? 'This tab is saving edits as a separate recovery copy because another tab saved a newer revision.' : null;
          renderBulkBar();
        }
        if ($('#version-history-dialog')?.open) void renderDocumentVersionHistory();
      }
    } catch (error) {
      if (revision === state.saveRevision) {
        if (error instanceof DocumentSaveConflictError) {
          try {
            const conflict = await preserveDocumentSaveConflict(snapshot, error);
            setSaveState('error', conflict.saved ? 'Conflict · copy saved' : 'Conflict · copy unavailable');
            if (!conflict.saved) showToast('Your edits remain open in this tab, but the separate recovery copy could not be saved. Export a local copy before closing.');
          } catch (recoveryError) {
            setSaveState('error', 'Conflict · copy unavailable');
            showToast(`The newer saved design was preserved, but this tab could not save its recovery copy: ${recoveryError.message || 'local storage failed'}. Export a local copy before closing.`, 8000);
          }
      } else {
        setSaveState('error', failedStatusText());
        showToast(error.message || `Could not save this design to ${storageDestinationName()}.`);
      }
        if (saveOwner && state.bulk === saveOwner) {
          saveOwner.savePending = false;
          saveOwner.saveError = state.documentSaveConflict
            ? 'This tab is saving edits as a separate recovery copy because another tab saved a newer revision.'
            : error.message || 'The local save failed.';
          renderBulkBar();
        }
      }
    }
  }, 260);
}
function checkpoint(label) { history.checkpoint(state.document, label); state.versionSaveLabel = label; }
function beginCanvasHistoryTransaction(label) { return history.beginTransaction(state.document, label); }
function clearVectorAnchorSelection({ resetMode = true } = {}) {
  state.selectedVectorPoint = null;
  state.selectedVectorPoints = [];
  if (resetMode) state.vectorPointSelectMode = false;
}
function setVectorAnchorSelection(anchors, primary = null) {
  const selected = normalizeVectorAnchorSelection(anchors);
  state.selectedVectorPoints = selected;
  state.selectedVectorPoint = primary && selected.some(item => vectorAnchorKey(item) === vectorAnchorKey(primary))
    ? { ...primary }
    : selected.length ? { ...selected[selected.length - 1] } : null;
  return selected;
}
function toggleVectorAnchor(anchor) {
  const selected = toggleVectorAnchorSelection(state.selectedVectorPoints, anchor);
  setVectorAnchorSelection(selected, selected.some(item => vectorAnchorKey(item) === vectorAnchorKey(anchor)) ? anchor : null);
  return selected;
}
function commitCanvasHistoryTransaction(interaction) {
  const transaction = interaction?.historyTransaction;
  const committed = history.commitTransaction(transaction, state.document);
  if (interaction) interaction.historyTransaction = null;
  if (!committed) return false;
  state.versionSaveLabel = transaction.label;
  return true;
}
function setSelection(ids, { keepInspector = false, refreshLayers = true } = {}) {
  const valid = ids.filter(id => findNode(state.document, id));
  const previousSelectedIds = state.selectedIds;
  const nextSelectedIds = [...new Set(valid)];
  if (state.imageCropMode && (nextSelectedIds.length !== 1 || nextSelectedIds[0] !== previousSelectedIds[0])) {
    if (['image-crop', 'image-fill-crop'].includes(state.interaction?.kind)) cancelCanvasInteraction({ pointerId: state.interaction.pointerId });
    state.imageCropMode = false;
    state.imageFillCropTarget = null;
    state.imageCropDraftSelection = null;
  }
  state.selectedIds = nextSelectedIds;
  if (state.gradientGeometryTarget
    && (state.selectedIds.length !== 1 || state.selectedIds[0] !== state.gradientGeometryTarget.nodeId)) {
    state.gradientGeometryTarget = null;
  }
  syncActiveImageSource();
  if (refreshLayers) renderLayers();
  else {
    syncRenderedLayerSelection(previousSelectedIds, state.selectedIds);
    syncLayerSelectionModeControl();
  }
  state.smartGuides = [];
  const selectedVectorNode = state.selectedIds.length === 1 ? findNode(state.document, state.selectedIds[0])?.node : null;
  if (state.selectedVectorPoint && (state.selectedIds.length !== 1 || state.selectedIds[0] !== state.selectedVectorPoint.nodeId)) clearVectorAnchorSelection();
  else if (state.selectedVectorPoints.length && (selectedVectorNode?.type !== 'path' || state.selectedVectorPoints.some(anchor => anchor.nodeId !== selectedVectorNode.id))) clearVectorAnchorSelection();
  syncImageCropOverlay();
  if (!keepInspector) renderInspector();
  updateSelectionStatus();
  renderer?.invalidate();
}
function selectedImageAssetId() {
  const selected = selectedNodes();
  if (selected.length !== 1) return null;
  const node = selected[0];
  if (node.type === 'image') return node.assetId || null;
  if (node.imageFill?.assetId) return node.imageFill.assetId;
  const imageFill = node.fills?.find(fill => fill.type === 'image' && fill.visible !== false && (fill.opacity ?? 1) > 0)?.imageFill;
  return imageFill?.assetId || null;
}
function syncActiveImageSource() { imageEngine.setActiveSource(selectedImageAssetId()); }
function updateSelectionStatus() {
  const nodes = selectedNodes();
  $('#selection-status').textContent = nodes.length === 0 ? `Tool · ${state.tool}` : nodes.length === 1 ? `${nodes[0].name} · ${nodes[0].type}` : `${nodes.length} layers selected`;
  if (nodes.length === 1) $('#position-status').textContent = `${Math.round(nodes[0].x)}, ${Math.round(nodes[0].y)} · ${Math.round(nodes[0].width)} × ${Math.round(nodes[0].height)}`;
  else $('#position-status').textContent = `${Math.round(state.zoom * 100)}%`;
}
function showToast(message, duration = 2500) {
  const region = $('#toast-region');
  region.replaceChildren();
  const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message;
  region.append(toast);
  clearTimeout(currentToastTimer);
  currentToastTimer = setTimeout(() => toast.remove(), duration);
}
function setDesignToolTabStop(target) {
  if (!target) return;
  $$('#bottom-toolbar .tool-button').forEach(button => { button.tabIndex = button === target ? 0 : -1; });
}
function installDesignToolToolbarKeyboard() {
  const toolbar = $('#bottom-toolbar');
  const buttons = () => [...toolbar.querySelectorAll('.tool-button:not(:disabled)')];
  const selected = toolbar.querySelector('.tool-button[aria-pressed="true"]');
  setDesignToolTabStop(selected || buttons()[0]);
  toolbar.addEventListener('focusin', event => {
    const target = event.target.closest?.('.tool-button');
    if (target && toolbar.contains(target)) setDesignToolTabStop(target);
  });
  toolbar.addEventListener('keydown', event => {
    const active = event.target.closest?.('.tool-button');
    if (!active || !toolbar.contains(active)) return;
    const target = toolbarNavigationTarget(buttons(), active, event.key, getComputedStyle(toolbar).direction);
    if (!target) return;
    event.preventDefault();
    setDesignToolTabStop(target);
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });
}
function setTool(tool) {
  if (state.penDraft && tool !== 'pen' && !finishPenPath(false, { selectAfter: false })) cancelPenPath();
  if (state.pencilDraft && tool !== 'pencil') cancelPencilStroke();
  if (tool !== 'comment' && state.pendingCommentAnchor) state.pendingCommentAnchor = null;
  state.tool = tool;
  $$('.tool-button').forEach(button => {
    const selected = button.dataset.tool === tool;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
    if (selected) setDesignToolTabStop(button);
  });
  canvas.className = `tool-${tool}`;
  updateSelectionStatus();
  renderInspector();
}

function applyEyedropperColor(color) {
  const targets = selectedNodes().filter(node => !node.locked && (node.type === 'text' || isFillStackSupported(node)));
  if (!targets.length) {
    showToast('Select an editable layer with a fill before sampling a color.');
    return false;
  }
  const changed = targets.some(node => {
    if (node.type === 'text') return node.color !== color || Boolean(node.textStyleId || node.textVariableId)
      || (node.textRuns || []).some(run => run.color !== color);
    const primary = fillStackForNode(node)[0];
    return !primary || primary.type !== 'solid' || primary.color !== color
      || Boolean(node.fillStyleId || node.fillVariableId || node.variableBindings?.fill)
      || (node.type === 'network' && (node.faces || []).some(face => face.fill !== color));
  });
  if (!changed) {
    showToast(`The selected layer already uses ${color}.`);
    setTool('select');
    return false;
  }
  checkpoint('Sample color');
  for (const node of targets) {
    if (node.type === 'text') {
      node.color = color;
      delete node.textStyleId;
      delete node.textVariableId;
      if (node.variableBindings) {
        delete node.variableBindings.text;
        if (!Object.keys(node.variableBindings).length) delete node.variableBindings;
      }
      if (Array.isArray(node.textRuns)) node.textRuns = node.textRuns.map(run => ({ ...run, color }));
      recordNodeComponentOverrides(node, ['color', 'textStyleId', 'textVariableId', 'variableBindings', 'textRuns']);
      continue;
    }
    const fills = ensureFillStack(node);
    let primary = fills[0];
    if (!primary) {
      primary = createFillLayer('solid', { color });
      fills.push(primary);
    }
    detachPrimaryFillBinding(node, primary, getNodeColor(state.document, node, 'fill'));
    primary.type = 'solid';
    primary.color = color;
    delete primary.gradient;
    delete primary.imageFill;
    if (node.type === 'network') for (const face of node.faces || []) face.fill = color;
    syncLegacyFillFields(node);
    recordNodeComponentOverrides(node, ['fills', 'fill', 'fillOpacity', 'fillGradient', 'imageFill', 'fillStyleId', 'fillVariableId', 'variableBindings', ...(node.type === 'network' ? ['faces'] : [])]);
  }
  renderLayers();
  queueSave();
  setTool('select');
  renderer.invalidate();
  showToast(`Applied ${color} to ${targets.length} layer${targets.length === 1 ? '' : 's'}.`);
  return true;
}

function sampleEyedropperAt(event) {
  try {
    const color = renderer?.sampleColor(event.clientX, event.clientY);
    if (!color) {
      showToast('Move the eyedropper over the canvas to sample a color.');
      return;
    }
    applyEyedropperColor(color);
  } catch (error) {
    showToast(error.message || 'The local design could not be sampled.');
  }
}

function renderPageList() {
  const list = $('#pages-list'); list.replaceChildren();
  for (const [index, page] of state.document.pages.entries()) {
    const row = document.createElement('div');
    row.className = `page-row${page.id === state.document.activePageId ? ' is-active' : ''}`;
    row.dataset.pageId = page.id; row.setAttribute('role', 'listitem'); row.setAttribute('aria-selected', String(page.id === state.document.activePageId));
    row.innerHTML = `<button class="page-row-select" type="button" data-page-select="${escapeHtml(page.id)}" aria-current="${page.id === state.document.activePageId ? 'page' : 'false'}"><span class="page-row-icon">▧</span><span class="page-row-name">${escapeHtml(page.name)}</span></button><details class="page-row-menu"><summary aria-label="Actions for ${escapeHtml(page.name)}" title="Page actions">···</summary><div class="page-actions-menu"><button type="button" data-page-action="rename" data-page-id="${escapeHtml(page.id)}">Rename</button><button type="button" data-page-action="duplicate" data-page-id="${escapeHtml(page.id)}">Duplicate</button><button type="button" data-page-action="move-up" data-page-id="${escapeHtml(page.id)}"${index === 0 ? ' disabled' : ''}>Move up</button><button type="button" data-page-action="move-down" data-page-id="${escapeHtml(page.id)}"${index === state.document.pages.length - 1 ? ' disabled' : ''}>Move down</button><button class="page-delete-action" type="button" data-page-action="delete" data-page-id="${escapeHtml(page.id)}"${state.document.pages.length <= 1 ? ' disabled title="A design must keep at least one page"' : ''}>Delete</button></div></details>`;
    list.append(row);
  }
  const page = activePage();
  $('#canvas-page-name').textContent = page?.name || 'Page';
}

function syncLayerSelectionModeControl() {
  const selectMode = $('#layer-select-mode');
  if (!selectMode) return;
  selectMode.textContent = state.layerSelectionMode ? 'Done' : 'Select';
  selectMode.setAttribute('aria-label', state.layerSelectionMode ? 'Finish selecting layers' : 'Select multiple layers');
  selectMode.setAttribute('aria-pressed', String(state.layerSelectionMode));
  selectMode.classList.toggle('is-active', state.layerSelectionMode);
}
function syncRenderedLayerSelection(previousIds, nextIds) {
  const previous = new Set(previousIds);
  const next = new Set(nextIds);
  const update = (id, selected) => {
    const row = layerRowsById.get(id);
    if (!row) return;
    row.classList.toggle('is-selected', selected);
    row.setAttribute('aria-selected', String(selected));
  };
  for (const id of previous) if (!next.has(id)) update(id, false);
  for (const id of next) if (!previous.has(id)) update(id, true);
}
function renderLayers() {
  const list = $('#layers-list'); list.replaceChildren();
  layerRowsById = new Map();
  syncLayerSelectionModeControl();
  list.setAttribute('aria-multiselectable', 'true');
  const page = activePage();
  latestPageLayerIds = [];
  const search = state.layerSearch.trim().toLowerCase();
  const matchingSelf = node => !search || node.name.toLowerCase().includes(search);
  const matchingNode = node => matchingSelf(node) || (node.children || []).some(matchingNode);
  let firstVisibleId = null;
  const addRows = (nodes, container, depth = 0, lockedParent = false) => {
    const visibleNodes = nodes.map((node, index) => ({ node, index })).reverse().filter(({ node }) => matchingNode(node));
    for (const { node, index } of visibleNodes) {
      if (!matchingNode(node)) continue;
      const forceExpandedForSearch = Boolean(search && (node.children || []).some(matchingNode));
      const effectivelyCollapsed = collapsedLayerIds.has(node.id) && !forceExpandedForSearch;
      latestPageLayerIds.push(node.id);
      const row = document.createElement('div');
      row.className = `layer-row${state.selectedIds.includes(node.id) ? ' is-selected' : ''}${getNodePropertyValue(state.document, node, 'visible') ? '' : ' layer-hidden'}${node.locked ? ' layer-locked' : ''}`;
      row.setAttribute('role', 'treeitem'); row.setAttribute('aria-selected', String(state.selectedIds.includes(node.id)));
      row.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
      row.setAttribute('aria-level', String(depth + 1));
      row.setAttribute('aria-posinset', String(visibleNodes.findIndex(item => item.node === node) + 1));
      row.setAttribute('aria-setsize', String(visibleNodes.length));
      if (node.children?.length) {
        row.setAttribute('aria-expanded', String(!effectivelyCollapsed));
        row.setAttribute('aria-owns', `layer-children-${encodeURIComponent(node.id)}`);
      }
      row.dataset.layerId = node.id; row.dataset.layerType = node.type; row.tabIndex = -1; row.draggable = true;
      if (!firstVisibleId) firstVisibleId = node.id;
      row.style.paddingLeft = `${7 + depth * 13}px`;
      row.style.setProperty('--layer-indent', `${7 + depth * 13}px`);
      const siblings = nodes;
      const lockedInChain = node.locked || lockedParent;
      const upNeighbor = siblings[index + 1]; const downNeighbor = siblings[index - 1];
      const iconName = node.type === 'frame' || node.type === 'group' ? 'layerFrame' : node.type === 'text' ? 'layerText' : node.type === 'image' ? 'layerImage' : node.type === 'ellipse' ? 'layerEllipse' : node.type === 'section' ? 'layerSection' : node.type === 'slice' ? 'layerSlice' : node.type === 'path' || node.type === 'network' || node.type === 'boolean' ? 'layerVector' : 'rectangleSmall';
      const chevron = node.children?.length
        ? `<button type="button" class="layer-chevron" data-action="layer-toggle" tabindex="-1" aria-label="${effectivelyCollapsed ? 'Expand' : 'Collapse'} ${escapeHtml(node.name)}" aria-expanded="${!effectivelyCollapsed}">${effectivelyCollapsed ? '›' : '⌄'}</button>`
        : '<span class="layer-chevron-placeholder" aria-hidden="true"></span>';
      const reorderHandle = `<button type="button" class="layer-reorder-handle" data-layer-drag-handle tabindex="-1" aria-label="Reorder ${escapeHtml(node.name)}. Drag with touch or pen; use Alt+ArrowUp or Alt+ArrowDown with a keyboard." title="Drag to reorder"><span aria-hidden="true">⠿</span></button>`;
      const componentMarker = node.isComponent ? '◆' : node.isInstance ? '◇' : node.mask ? '◩' : '';
      row.title = node.mask ? 'Mask group · use Layer options or Inspector to release' : '';
      row.innerHTML = `${chevron}<span class="layer-icon" aria-hidden="true">${componentMarker || icon(iconName, 14)}</span><span class="layer-name">${escapeHtml(node.name)}</span>${reorderHandle}<button type="button" class="layer-order-control" data-action="layer-move-up" tabindex="-1" aria-label="Move ${escapeHtml(node.name)} up" title="Move up"${state.layerSelectionMode || lockedInChain || !upNeighbor || upNeighbor.locked ? ' disabled' : ''}>↑</button><button type="button" class="layer-order-control" data-action="layer-move-down" tabindex="-1" aria-label="Move ${escapeHtml(node.name)} down" title="Move down"${state.layerSelectionMode || lockedInChain || !downNeighbor || downNeighbor.locked ? ' disabled' : ''}>↓</button><button type="button" class="layer-visibility" data-action="visibility" tabindex="-1" aria-label="Toggle visibility" title="Toggle visibility">${icon('eye', 13)}</button><button type="button" class="layer-actions-menu" data-action="layer-actions-menu" tabindex="-1" aria-label="More actions for ${escapeHtml(node.name)}" aria-haspopup="menu" aria-expanded="false" aria-controls="context-menu" title="More actions">⋯</button>`;
      container.append(row);
      layerRowsById.set(node.id, row);
      if (node.children?.length) {
        const group = document.createElement('div');
        group.setAttribute('role', 'group');
        group.id = `layer-children-${encodeURIComponent(node.id)}`;
        group.hidden = effectivelyCollapsed;
        container.append(group);
        if (!group.hidden) addRows(node.children, group, depth + 1, lockedInChain);
      }
    }
  };
  if (page) addRows(page.children, list);
  const focusedId = document.activeElement?.closest?.('[data-layer-id]')?.dataset.layerId;
  const rovingId = layerRowsById.has(focusedId) ? focusedId
    : layerRowsById.has(state.lastLayerSelection) ? state.lastLayerSelection
      : layerRowsById.has(state.selectedIds[0]) ? state.selectedIds[0] : firstVisibleId;
  if (rovingId) layerRowsById.get(rovingId).tabIndex = 0;
  $('#empty-layers').hidden = latestPageLayerIds.length > 0;
  $('#layers-list').hidden = latestPageLayerIds.length === 0;
}

function section(title, body, iconName = null) {
  return `<section class="property-section"><div class="property-heading">${iconName ? `<span>${icon(iconName, 13)} </span>` : ''}<span>${title}</span></div>${body}</section>`;
}
function numberField(label, prop, value, step = 1, min = null, max = null, disabled = false, ariaLabel = label) {
  return `<div class="property-field"><label>${label}</label><input class="prop-input" data-prop="${prop}" type="number" step="${step}"${min == null ? '' : ` min="${min}"`}${max == null ? '' : ` max="${max}"`}${disabled ? ' disabled' : ''} value="${Number.isFinite(Number(value)) ? Number(value) : 0}" aria-label="${ariaLabel}" /></div>`;
}
function selectionNumberField(label, property, value, { step = 1, min = null, max = null, disabled = false, mixed = false } = {}) {
  const shownValue = !mixed && Number.isFinite(value) ? ` value="${value}"` : '';
  return `<div class="property-field"><label>${label}</label><input class="prop-input" data-prop="selection.${property}" type="number" step="${step}"${min == null ? '' : ` min="${min}"`}${max == null ? '' : ` max="${max}"`}${disabled ? ' disabled' : ''}${shownValue}${mixed ? ' placeholder="Mixed"' : ''} aria-label="Selection ${property}" /></div>`;
}
function optionalNumberField(label, prop, value) {
  return `<label class="size-limit-field"><span>${label}</span><input class="prop-input" data-prop="${prop}" data-optional-number type="number" min="0" step="1" value="${Number.isFinite(value) ? value : ''}" placeholder="None" title="Leave blank for no limit" aria-label="${label}"/></label>`;
}
function sliderField(label, prop, value, min, max, step = 1, disabled = false) {
  return `<div class="slider-row"><label>${label}</label><input class="prop-input" data-prop="${prop}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${escapeHtml(label)}"${disabled ? ' disabled' : ''}/><output>${Number(value).toFixed(step < 1 ? 2 : 0)}${prop === 'opacity' ? '%' : ''}</output></div>`;
}
function colorField(label, prop, value, opacity = 100) {
  const safe = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff';
  return `<div class="fill-row"><label class="color-swatch" title="${label}"><input class="prop-input" data-prop="${prop}" type="color" value="${safe}" aria-label="${label} color"/></label><input class="prop-input color-value" data-prop="${prop}" type="text" value="${safe}" maxlength="7" aria-label="${label} color value"/><input class="prop-input fill-opacity" data-prop="fillOpacity" type="number" min="0" max="100" value="${opacity}" title="Opacity percent"/></div>`;
}
function networkFaceControls(node) {
  return (node.faces || []).map((face, index) => {
    const color = /^#[0-9a-f]{6}$/i.test(face.fill || '') ? face.fill : getNodeColor(state.document, node, 'fill');
    const safeColor = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#ffffff';
    const opacity = Math.round((face.fillOpacity ?? 1) * 100);
    const label = `Region ${index + 1}`;
    return `<div class="network-face-control"><div class="network-face-heading"><span>${label}</span><output>${opacity}%</output></div><div class="network-face-fields"><label class="color-swatch" title="${label} fill"><input type="color" data-network-face-fill="${escapeHtml(face.id)}" value="${safeColor}" aria-label="${label} fill color"${node.locked ? ' disabled' : ''}/></label><input type="range" min="0" max="100" value="${opacity}" data-network-face-opacity="${escapeHtml(face.id)}" aria-label="${label} opacity"${node.locked ? ' disabled' : ''}/></div></div>`;
  }).join('');
}
function variableBindingControl(node, kind) {
  const property = { fill: 'fillVariableId', text: 'textVariableId', stroke: 'strokeVariableId' }[kind];
  const variables = state.document.variables || [];
  const selected = node[property] || '';
  const options = variables.filter(variable => variable.type === 'color').map(variable => {
    const collection = state.document.variableCollections?.find(item => item.id === variable.collectionId);
    return `<option value="${escapeHtml(variable.id)}"${selected === variable.id ? ' selected' : ''}>${escapeHtml(variable.name)} · ${escapeHtml(collection?.name || 'Collection')}</option>`;
  }).join('');
  return `<label class="variable-binding-row"><span>Variable</span><select class="select-field" data-variable-binding="${kind}" aria-label="${kind} color variable"><option value="">No variable</option>${options}</select></label>`;
}
function variablePropertyBindingControl(node, property, label) {
  const type = {
    x: 'number', y: 'number', width: 'number', height: 'number', rotation: 'number', visible: 'boolean', opacity: 'number', radius: 'number',
    text: 'string', fontSize: 'number', lineHeight: 'number', letterSpacing: 'number',
    'autoLayout.axis': 'string', 'autoLayout.align': 'string', 'autoLayout.justify': 'string',
    'autoLayout.mainSizing': 'string', 'autoLayout.crossSizing': 'string', 'autoLayout.wrap': 'boolean',
    'autoLayout.autoPositioning': 'boolean', 'autoLayout.columns': 'number', 'autoLayout.rows': 'number', 'autoLayout.rowGap': 'number',
    'autoLayout.columnGap': 'number', 'autoLayout.padding.top': 'number', 'autoLayout.padding.right': 'number',
    'autoLayout.padding.bottom': 'number', 'autoLayout.padding.left': 'number'
  }[property];
  const selected = node.variableBindings?.[property] || '';
  const matchingVariables = (state.document.variables || []).filter(variable => variable.type === type);
  if (!matchingVariables.length && !selected) return '';
  const options = matchingVariables.map(variable => {
    const collection = state.document.variableCollections?.find(item => item.id === variable.collectionId);
    return `<option value="${escapeHtml(variable.id)}"${selected === variable.id ? ' selected' : ''}>${escapeHtml(variable.name)} · ${escapeHtml(collection?.name || 'Collection')}</option>`;
  }).join('');
  return `<label class="variable-binding-row"><span>${escapeHtml(label)}</span><select class="select-field" data-variable-property-binding="${property}" aria-label="${escapeHtml(label)} variable"><option value="">No variable</option>${options}</select></label>`;
}
function gradientGeometryTargetFor(node, { fillId = '', strokeId = '' } = {}) {
  return {
    nodeId: node.id,
    ...(fillId ? { fillId } : {}),
    ...(strokeId ? { strokeId } : {})
  };
}
function gradientGeometryTargetMatches(left, right) {
  return Boolean(left && right && left.nodeId === right.nodeId
    && (left.fillId || '') === (right.fillId || '')
    && (left.strokeId || '') === (right.strokeId || ''));
}
function gradientGeometryControls(node, gradient, { fillId = '', strokeId = '' } = {}) {
  if (gradient.type === 'angular') return '';
  const target = gradientGeometryTargetFor(node, { fillId, strokeId });
  const active = gradientGeometryTargetMatches(state.gradientGeometryTarget, target);
  const ownerData = `data-gradient-node-id="${escapeHtml(node.id)}"${fillId ? ` data-fill-id="${escapeHtml(fillId)}"` : ''}${strokeId ? ` data-stroke-id="${escapeHtml(strokeId)}"` : ''}`;
  const entry = findNodeAcrossPages(state.document, node.id);
  const disabled = node.locked || entry?.parents.some(parent => parent.locked);
  const geometry = { ...node, ...resolvedGeometry(node) };
  const handles = resolveGradientGeometry(gradient, { width: geometry.width, height: geometry.height })?.handles || [];
  const labels = gradient.type === 'linear' ? ['Start', 'End', 'Width'] : ['Center', 'Radius axis 1', 'Radius axis 2'];
  const fields = handles.map((point, index) => {
    const x = Number((point.x / Math.max(1, geometry.width) * 100).toFixed(2));
    const y = Number((point.y / Math.max(1, geometry.height) * 100).toFixed(2));
    return `<div class="gradient-geometry-point" role="group" aria-label="${labels[index]} handle"><strong>${labels[index]}</strong><label>X %<input type="number" step="0.1" data-gradient-geometry-field data-gradient-geometry-index="${index}" data-gradient-geometry-axis="x" ${ownerData} value="${x}" aria-label="${labels[index]} handle X position in percent"${disabled ? ' disabled' : ''}/></label><label>Y %<input type="number" step="0.1" data-gradient-geometry-field data-gradient-geometry-index="${index}" data-gradient-geometry-axis="y" ${ownerData} value="${y}" aria-label="${labels[index]} handle Y position in percent"${disabled ? ' disabled' : ''}/></label></div>`;
  }).join('');
  return `<div class="gradient-geometry-controls"><button class="add-fill gradient-geometry-toggle" type="button" data-action="toggle-gradient-geometry" ${ownerData} aria-pressed="${active}"${disabled || handles.length !== 3 ? ' disabled' : ''}>${active ? 'Done editing on canvas' : 'Edit geometry on canvas'}</button><div class="image-properties-note">Drag the ${gradient.type === 'linear' ? 'start, end, and width' : 'center and radius axis'} handles on the canvas, or set their normalized positions here.</div><div class="gradient-geometry-fields"${active ? '' : ' hidden'}>${fields}</div></div>`;
}
function gradientStopRail(node, gradient, { fillId = '', strokeId = '' } = {}) {
  const background = gradientFillToCSS(gradient);
  if (!background) return '';
  const ownerData = `data-gradient-node-id="${escapeHtml(node.id)}"${fillId ? ` data-fill-id="${escapeHtml(fillId)}"` : ''}${strokeId ? ` data-stroke-id="${escapeHtml(strokeId)}"` : ''}`;
  const handles = gradient.stops.map((stop, index) => `<button class="gradient-stop-handle" type="button" role="slider" aria-orientation="horizontal" aria-label="Gradient stop ${index + 1} position" aria-valuemin="0" aria-valuemax="100" aria-valuestep="1" aria-valuenow="${Math.round(stop.position * 100)}" aria-valuetext="${Math.round(stop.position * 100)} percent" title="Drag to move stop ${index + 1}; use arrow keys to adjust" data-gradient-stop-handle data-gradient-stop-id="${escapeHtml(stop.id)}" style="left:${Number((stop.position * 100).toFixed(4))}%;--gradient-stop-color:${escapeHtml(stop.color)}"${node.locked ? ' disabled' : ''}></button>`).join('');
  return `<div class="gradient-stop-rail" role="group" aria-label="Gradient color stops"><div class="gradient-stop-track" data-gradient-stop-track ${ownerData} style="--gradient-preview:${escapeHtml(background)}">${handles}</div></div>`;
}
function gradientFillControls(node, gradient = node.fillGradient, fillId = '') {
  if (!gradient) return '';
  const fillData = fillId ? ` data-fill-id="${escapeHtml(fillId)}"` : '';
  const stops = gradient.stops.map((stop, index) => `<div class="gradient-stop-row" data-gradient-stop-row data-gradient-stop-id="${escapeHtml(stop.id)}"><label><span>Stop ${index + 1}</span><input type="color" data-gradient-field="color"${fillData} data-gradient-stop-id="${escapeHtml(stop.id)}" value="${escapeHtml(stop.color)}" aria-label="Gradient stop ${index + 1} color"${node.locked ? ' disabled' : ''}/></label><label><span>${Math.round(stop.position * 100)}%</span><input type="number" min="0" max="100" step="1" data-gradient-field="position"${fillData} data-gradient-stop-id="${escapeHtml(stop.id)}" value="${Math.round(stop.position * 100)}" aria-label="Gradient stop ${index + 1} position"${node.locked ? ' disabled' : ''}/></label><button class="tiny-icon-button" type="button" data-action="remove-gradient-stop"${fillData} data-stop-id="${escapeHtml(stop.id)}" aria-label="Remove gradient stop ${index + 1}"${node.locked || gradient.stops.length <= 2 ? ' disabled' : ''}>×</button></div>`).join('');
  const angle = ['linear', 'angular'].includes(gradient.type) && !gradient.geometry ? `<div class="property-grid"><div class="property-field"><label>${gradient.type === 'angular' ? 'Start angle' : '°'}</label><input type="number" min="0" max="359" step="1" data-gradient-field="angle"${fillData} value="${gradient.angle}" aria-label="${gradient.type === 'angular' ? 'Angular gradient start angle' : 'Gradient angle'}"${node.locked ? ' disabled' : ''}/></div></div>` : '';
  return `${angle}${gradientGeometryControls(node, gradient, { fillId })}<div class="gradient-editor">${gradientStopRail(node, gradient, { fillId })}<div class="gradient-stops">${stops}</div><button class="add-fill" type="button" data-action="add-gradient-stop"${fillData}${node.locked || gradient.stops.length >= 8 ? ' disabled' : ''}>＋ Add color stop</button><div class="image-properties-note">Tap or click the gradient to add a stop. Drag a stop to move it.</div></div>`;
}
function imageFillSources() {
  const sources = new Map();
  for (const reference of imageAssetReferencesAcrossPages()) {
    if (sources.has(reference.assetId)) continue;
    const asset = state.assets.get(reference.assetId);
    sources.set(reference.assetId, { assetId: reference.assetId, name: asset?.name || reference.name || 'Image' });
  }
  for (const entry of state.document.imageLibrary || []) {
    if (!sources.has(entry.assetId)) sources.set(entry.assetId, { assetId: entry.assetId, name: state.assets.get(entry.assetId)?.name || entry.name || 'Image' });
  }
  return [...sources.values()];
}
function imageFillControls(node, imageFill = node.imageFill, fillId = '') {
  if (!imageFill) return '';
  const fillData = fillId ? ` data-fill-id="${escapeHtml(fillId)}"` : '';
  const sources = imageFillSources();
  const options = sources.map(source => `<option value="${escapeHtml(source.assetId)}"${imageFill.assetId === source.assetId ? ' selected' : ''}>${escapeHtml(source.name)}</option>`).join('');
  const adjustments = { ...defaultImageAdjustments, ...imageFill.adjustments };
  const previewKey = imagePreviewKey(node.id, fillId || null);
  const geometry = resolvedGeometry(node);
  const fields = [['exposure', 'Exposure', -100, 100], ['temperature', 'Temperature', -100, 100], ['tint', 'Tint', -100, 100], ['brightness', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100], ['saturation', 'Saturation', -100, 100], ['highlights', 'Highlights', -100, 100], ['shadows', 'Shadows', -100, 100], ['sharpness', 'Sharpness', -100, 100], ['blur', 'Blur', 0, 24]].map(([field, label, min, max]) => `<div class="slider-row"><label>${label}</label><input type="range" min="${min}" max="${max}" step="1" value="${adjustments[field]}" data-image-fill-field="adjustments.${field}"${fillData} aria-label="Image fill ${label.toLowerCase()}"${node.locked ? ' disabled' : ''}/><output>${adjustments[field]}</output></div>`).join('');
  const transforms = imageTransformControls(imageFill.transforms, 'fill', node.locked, fillId);
  const asset = state.assets.get(imageFill.assetId);
  const fillCropActive = state.imageCropMode && state.imageFillCropTarget?.nodeId === node.id && state.imageFillCropTarget?.fillId === fillId;
  const fillCropAvailable = Number.isSafeInteger(asset?.sourceWidth) && Number.isSafeInteger(asset?.sourceHeight);
  const fillCropButton = `<button class="add-fill image-crop-mode-button" type="button" data-action="toggle-image-crop-mode" data-transform-target="fill" data-fill-id="${escapeHtml(fillId)}" aria-pressed="${fillCropActive}"${node.locked || !fillCropAvailable || imageFill.fit !== 'cover' ? ' disabled' : ''}>${fillCropActive ? 'Done adjusting image' : 'Adjust image on canvas'}</button>${fillCropActive ? '<div class="image-properties-note image-crop-mode-hint">Drag to reposition. Pinch with two fingers to zoom and move; Escape finishes. The image stays clipped to this shape.</div>' : imageFill.fit !== 'cover' ? '<div class="image-properties-note">Choose Fill to reposition or zoom this image on the canvas.</div>' : ''}`;
  let zoomPercent = 100;
  if (fillCropAvailable && imageFill.fit === 'cover') {
    const currentTransforms = createImageTransforms(imageFill.transforms || {});
    const currentWindow = calculateImageFillCropWindow({ frameWidth: geometry.width, frameHeight: geometry.height, sourceWidth: asset.sourceWidth, sourceHeight: asset.sourceHeight, transforms: currentTransforms, fit: 'cover' });
    const baseWindow = calculateImageFillCropWindow({ frameWidth: geometry.width, frameHeight: geometry.height, sourceWidth: asset.sourceWidth, sourceHeight: asset.sourceHeight, transforms: { ...currentTransforms, crop: null }, fit: 'cover' });
    zoomPercent = Math.min(800, Math.max(100, Math.round((baseWindow.right - baseWindow.left) / (currentWindow.right - currentWindow.left) * 100)));
  }
  const zoomControl = `<div class="slider-row image-fill-zoom-control"><label>Zoom</label><input type="range" min="100" max="800" step="1" value="${zoomPercent}" data-image-fill-zoom data-fill-id="${escapeHtml(fillId)}" aria-label="Image fill zoom"${node.locked || !fillCropAvailable || imageFill.fit !== 'cover' ? ' disabled' : ''}/><output>${zoomPercent}%</output></div>`;
  const tone = imageToneControls(adjustments, { fillId, disabled: node.locked });
  return `<div class="image-fill-controls"><label class="image-fill-source"><span>Image</span><select class="select-field" data-image-fill-field="assetId"${fillData} aria-label="Image fill source"${node.locked || sources.length < 2 ? ' disabled' : ''}>${options}</select></label><label class="image-fill-source"><span>Scale</span><select class="select-field" data-image-fill-field="fit"${fillData} aria-label="Image fill scale"${node.locked ? ' disabled' : ''}><option value="cover"${imageFill.fit === 'cover' ? ' selected' : ''}>Fill</option><option value="contain"${imageFill.fit === 'contain' ? ' selected' : ''}>Fit</option></select></label>${fields}${tone}${zoomControl}${fillCropButton}${transforms}<div class="image-engine-status" data-image-fill-status="${escapeHtml(previewKey)}">${escapeHtml(state.imageStatus.get(previewKey) || 'Ready · Pillow-RS WebAssembly')}</div><div class="image-properties-note">Image treatments run locally through Pillow-RS WASM.</div></div>`;
}
function imageToneControls(adjustments, { fillId = '', disabled = false } = {}) {
  const fillData = fillId ? ` data-fill-id="${escapeHtml(fillId)}"` : '';
  const field = (key, label) => fillId
    ? `data-image-fill-field="adjustments.${key}"${fillData}`
    : `class="prop-input" data-prop="adjustments.${key}"`;
  const checkbox = (key, label) => `<label class="image-fill-source"><span>${label}</span><input type="checkbox" ${field(key, label)} aria-label="${fillId ? 'Image fill ' : ''}${label}"${adjustments[key] ? ' checked' : ''}${disabled ? ' disabled' : ''}/></label>`;
  const slider = (key, label, min, max, value, offText = '') => `<div class="slider-row"><label>${label}</label><input type="range" min="${min}" max="${max}" step="1" value="${value}" ${field(key, label)} aria-label="${fillId ? 'Image fill ' : ''}${label.toLowerCase()}"${disabled || (key === 'solarizeThreshold' && !adjustments.solarize) ? ' disabled' : ''}/><output>${offText}</output></div>`;
  const posterize = Number(adjustments.posterizeBits) || 0;
  const threshold = Number.isInteger(adjustments.solarizeThreshold) ? adjustments.solarizeThreshold : 0;
  return `<div class="image-tone-controls">${checkbox('autoContrast', 'Auto contrast')}${slider('posterizeBits', 'Posterize', 0, 8, posterize, posterize ? `${posterize} bit` : 'Off')}${checkbox('solarize', 'Solarize')}${slider('solarizeThreshold', 'Threshold', 0, 255, threshold, String(threshold))}${checkbox('invert', 'Invert')}</div>`;
}
function syncImageToneControls(input, adjustments, disabled = false) {
  if (!input || (input.dataset.prop !== 'adjustments.solarize' && input.dataset.imageFillField !== 'adjustments.solarize')) return;
  const threshold = input.closest('.image-tone-controls')?.querySelector('[data-prop="adjustments.solarizeThreshold"], [data-image-fill-field="adjustments.solarizeThreshold"]');
  if (!threshold) return;
  threshold.disabled = disabled || !adjustments.solarize;
  threshold.value = String(adjustments.solarizeThreshold);
  if (threshold.nextElementSibling) threshold.nextElementSibling.value = String(adjustments.solarizeThreshold);
}
function imageTransformControls(transforms, target, disabled = false, fillId = '', nodeId = null) {
  const crop = transforms?.crop || { left: 0, top: 0, right: 1, bottom: 1 };
  const fillData = fillId ? ` data-fill-id="${escapeHtml(fillId)}"` : '';
  const imageNode = nodeId ? findNode(state.document, nodeId)?.node : null;
  const imageAsset = imageNode?.assetId ? state.assets.get(imageNode.assetId) : null;
  const cropAvailable = imageNode?.type === 'image'
    && Number.isSafeInteger(imageAsset?.sourceWidth || imageNode.sourceWidth)
    && Number.isSafeInteger(imageAsset?.sourceHeight || imageNode.sourceHeight);
  const cropTool = target === 'layer'
    ? `<button class="add-fill image-crop-mode-button" type="button" data-action="toggle-image-crop-mode" aria-pressed="${state.imageCropMode && state.selectedIds[0] === nodeId}"${disabled || !cropAvailable ? ' disabled' : ''}>${state.imageCropMode && state.selectedIds[0] === nodeId ? 'Done cropping' : 'Crop on canvas'}</button>${state.imageCropMode && state.selectedIds[0] === nodeId ? '<div class="image-properties-note image-crop-mode-hint">The full source stays visible. The current edit appears inside the crop; the uncropped image provides context. Drag to choose a crop or move a handle; Escape finishes the crop.</div>' : ''}`
    : '';
  const edges = [['left', 'Left'], ['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom']].map(([edge, label]) =>
    `<label class="property-field"><span class="field-caption">${label}</span><input type="number" min="0" max="100" step="1" value="${Math.round(crop[edge] * 100)}" data-image-transform-field="${edge}" data-image-transform-target="${target}"${fillData} aria-label="Crop ${label.toLowerCase()} percent"${disabled ? ' disabled' : ''} /></label>`).join('');
  return `<div class="image-transform-controls"><div class="property-heading">Crop · percent of source</div><div class="property-grid">${edges}</div>${cropTool}<div class="property-inline"><button class="add-fill" type="button" data-action="rotate-image" data-direction="left" data-transform-target="${target}"${fillData} aria-label="Rotate image left 90 degrees"${disabled ? ' disabled' : ''}>↶ Rotate left</button><button class="add-fill" type="button" data-action="rotate-image" data-direction="right" data-transform-target="${target}"${fillData} aria-label="Rotate image right 90 degrees"${disabled ? ' disabled' : ''}>↷ Rotate right</button></div><div class="property-inline"><button class="add-fill" type="button" data-action="flip-image" data-direction="horizontal" data-transform-target="${target}"${fillData} aria-pressed="${Boolean(transforms?.flipHorizontal)}"${disabled ? ' disabled' : ''}>⇋ Flip horizontal</button><button class="add-fill" type="button" data-action="flip-image" data-direction="vertical" data-transform-target="${target}"${fillData} aria-pressed="${Boolean(transforms?.flipVertical)}"${disabled ? ' disabled' : ''}>⇵ Flip vertical</button></div><button class="add-fill" type="button" data-action="reset-image-transforms" data-transform-target="${target}"${fillData}${disabled || (!transforms?.crop && !transforms?.rotation && !transforms?.flipHorizontal && !transforms?.flipVertical) ? ' disabled' : ''}>Reset image transforms</button><div class="image-properties-note">Crop, rotation, and flips stay editable and are included in saved recipes.</div></div>`;
}
function transformSection(node) {
  const geometry = resolvedGeometry(node);
  const opacity = getNodePropertyValue(state.document, node, 'opacity');
  const entry = transformEntriesForSelection().find(item => item.node.id === node.id);
  const hugAxes = node.type === 'frame' && node.autoLayout && entry
    ? ['width', 'height'].filter(property => selectionDimensionIsHugged([entry], property)) : [];
  const hugNote = hugAxes.length
    ? `<div class="image-properties-note">Resize handles for ${hugAxes.join(' and ')} are disabled while this frame hugs that axis. Set the matching Hug sizing to Fixed first.</div>`
    : '';
  const body = `<div class="property-grid">${numberField('X', 'x', geometry.x)}${numberField('Y', 'y', geometry.y)}${numberField('W', 'width', geometry.width, 1, null, null, node.locked || hugAxes.includes('width'), 'Width')}${numberField('H', 'height', geometry.height, 1, null, null, node.locked || hugAxes.includes('height'), 'Height')}${numberField('↻', 'rotation', geometry.rotation, 1)}${numberField('◐', 'opacity', Math.round((opacity ?? 1) * 100))}</div>${hugNote}${variablePropertyBindingControl(node, 'x', 'X')}${variablePropertyBindingControl(node, 'y', 'Y')}${variablePropertyBindingControl(node, 'width', 'Width')}${variablePropertyBindingControl(node, 'height', 'Height')}${variablePropertyBindingControl(node, 'rotation', 'Rotation')}${variablePropertyBindingControl(node, 'opacity', 'Opacity')}${variablePropertyBindingControl(node, 'visible', 'Visibility')}`;
  return section('Position', body);
}
function slicePositionSection(node) {
  const geometry = resolvedGeometry(node);
  return section('Slice bounds', `<div class="property-grid">${numberField('X', 'x', geometry.x, 1, null, null, node.locked)}${numberField('Y', 'y', geometry.y, 1, null, null, node.locked)}${numberField('W', 'width', geometry.width, 1, 1, 100_000, node.locked, 'Width')}${numberField('H', 'height', geometry.height, 1, 1, 100_000, node.locked, 'Height')}</div><div class="image-properties-note">The dashed region exports the artwork underneath it. Slice outlines stay out of image, SVG, PDF, and prototype output.</div>`);
}
function sliceExportGeometry(node) {
  return { ...node, ...resolvedGeometry(node), rotation: 0 };
}
function blendingSection(node) {
  const selected = node.blendMode || 'normal';
  const options = layerBlendModes.map(mode => `<option value="${mode}"${selected === mode ? ' selected' : ''}>${layerBlendModeLabels[mode]}</option>`).join('');
  return section('Blending', `<select class="prop-input select-field blend-mode-select" data-prop="blendMode" aria-label="Layer blend mode"${node.locked ? ' disabled' : ''}>${options}</select>`);
}
function strokeStackControls(node) {
  const strokes = strokeStackForNode(node);
  if (!strokes.length) return '';
  const supportsEndpointDecorations = node.type === 'line' || node.type === 'network'
    || (node.type === 'path' && vectorPathContours(node).some(contour => !contour.closed && contour.points?.length >= 2));
  const rows = strokes.map((stroke, index) => {
    const id = escapeHtml(stroke.id);
    const name = strokes.length === 1 ? 'Stroke' : `Stroke ${index + 1}`;
    const color = index === 0 && node.strokeVariableId ? getNodeColor(state.document, node, 'stroke') : stroke.color;
    const safeColor = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#1e1e1e';
    const cap = stroke.pattern === 'dotted' ? 'round' : stroke.cap;
    const select = (field, label, value, options, disabled = false) => {
      const choices = options.map(([key, text]) => `<option value="${key}"${value === key ? ' selected' : ''}>${text}</option>`).join('');
      return `<label class="stroke-field"><span>${label}</span><select data-stroke-field="${field}" data-stroke-id="${id}" aria-label="${name} ${label.toLowerCase()}"${node.locked || disabled ? ' disabled' : ''}>${choices}</select></label>`;
    };
    const primaryControls = index === 0
      ? (stroke.gradient ? '' : `${variableBindingControl(node, 'stroke')}<button class="add-fill" type="button" data-action="create-color-variable" data-kind="stroke"${node.locked ? ' disabled' : ''}>＋ Create stroke variable</button>`)
      : '';
    const decorationControls = supportsEndpointDecorations
      ? `${select('startDecoration', 'Start', stroke.startDecoration ?? 'none', [['none', 'None'], ['arrow', 'Arrow'], ['triangle', 'Triangle']])}${select('endDecoration', 'End', stroke.endDecoration ?? 'none', [['none', 'None'], ['arrow', 'Arrow'], ['triangle', 'Triangle']])}`
      : '';
    const opacity = Math.round(stroke.opacity * 100);
    const gradient = stroke.gradient;
    const paintControls = `<div class="stroke-paint-controls">${select('paint', 'Paint', gradient?.type || 'solid', [['solid', 'Solid color'], ['linear', 'Linear gradient'], ['radial', 'Radial gradient'], ['angular', 'Angular gradient']])}${gradient ? `<div class="stroke-gradient-controls">${['linear', 'angular'].includes(gradient.type) && !gradient.geometry ? `<label class="stroke-field"><span>${gradient.type === 'angular' ? 'Start angle' : 'Angle'}</span><input type="number" data-stroke-field="gradientAngle" data-stroke-id="${id}" min="0" max="359" step="1" value="${gradient.angle}" aria-label="${name} gradient angle"${node.locked ? ' disabled' : ''}/></label>` : ''}${gradientGeometryControls(node, gradient, { strokeId: stroke.id })}${gradientStopRail(node, gradient, { strokeId: id })}<div class="gradient-stops">${gradient.stops.map((stop, stopIndex) => `<div class="gradient-stop-row" data-gradient-stop-row data-gradient-stop-id="${escapeHtml(stop.id)}"><label><span>Stop ${stopIndex + 1}</span><input type="color" data-stroke-field="gradientStopColor" data-stroke-id="${id}" data-stroke-gradient-stop-id="${escapeHtml(stop.id)}" value="${escapeHtml(stop.color)}" aria-label="${name} gradient stop ${stopIndex + 1} color"${node.locked ? ' disabled' : ''}/></label><label><span>${Math.round(stop.position * 100)}%</span><input type="number" min="0" max="100" step="1" data-stroke-field="gradientStopPosition" data-stroke-id="${id}" data-stroke-gradient-stop-id="${escapeHtml(stop.id)}" value="${Math.round(stop.position * 100)}" aria-label="${name} gradient stop ${stopIndex + 1} position"${node.locked ? ' disabled' : ''}/></label><button class="tiny-icon-button" type="button" data-action="remove-stroke-gradient-stop" data-stroke-id="${id}" data-stop-id="${escapeHtml(stop.id)}" aria-label="Remove ${name.toLowerCase()} gradient stop ${stopIndex + 1}"${node.locked || gradient.stops.length <= 2 ? ' disabled' : ''}>×</button></div>`).join('')}</div><button class="add-fill" type="button" data-action="add-stroke-gradient-stop" data-stroke-id="${id}"${node.locked || gradient.stops.length >= 8 ? ' disabled' : ''}>＋ Add color stop</button><div class="image-properties-note">Tap or click the gradient to add a stop. Drag a stop to move it.</div></div>` : ''}</div>`;
    return `<div class="layer-effect-card stroke-stack-card" data-stroke-row="${id}">
      <div class="layer-effect-heading">
        <strong>${name}</strong>
        <label><input type="checkbox" data-stroke-field="visible" data-stroke-id="${id}"${stroke.visible ? ' checked' : ''} aria-label="Show ${name.toLowerCase()}"${node.locked ? ' disabled' : ''}/> Show</label>
        <button class="tiny-icon-button" type="button" data-action="move-stroke" data-stroke-id="${id}" data-direction="up" aria-label="Move ${name.toLowerCase()} earlier"${node.locked || index === 0 ? ' disabled' : ''}>↑</button>
        <button class="tiny-icon-button" type="button" data-action="move-stroke" data-stroke-id="${id}" data-direction="down" aria-label="Move ${name.toLowerCase()} later"${node.locked || index === strokes.length - 1 ? ' disabled' : ''}>↓</button>
        <button class="tiny-icon-button" type="button" data-action="remove-stroke" data-stroke-id="${id}" aria-label="Remove ${name.toLowerCase()}"${node.locked ? ' disabled' : ''}>×</button>
      </div>
      <div class="stroke-field-grid">
        ${paintControls}
        ${gradient ? '' : `<label class="stroke-field"><span>Color</span><input type="color" data-stroke-field="color" data-stroke-id="${id}" value="${escapeHtml(safeColor)}" aria-label="${name} color"${node.locked ? ' disabled' : ''}/></label>`}
        <label class="stroke-field"><span>Width</span><input type="number" data-stroke-field="width" data-stroke-id="${id}" min="0" max="100000" step="0.5" value="${Number(stroke.width)}" aria-label="${name} width"${node.locked ? ' disabled' : ''}/></label>
        <div class="slider-row stroke-opacity-row"><label for="stroke-opacity-${id}">Opacity</label><input id="stroke-opacity-${id}" type="range" min="0" max="100" step="1" value="${opacity}" data-stroke-field="opacity" data-stroke-id="${id}" aria-label="${name} opacity"${node.locked ? ' disabled' : ''}/><output>${opacity}%</output></div>
        ${select('pattern', 'Pattern', stroke.pattern, [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']])}
        ${select('cap', 'Cap', cap, [['butt', 'Butt'], ['round', 'Round'], ['square', 'Square']], stroke.pattern === 'dotted')}
        ${select('join', 'Join', stroke.join, [['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']])}
        <label class="stroke-field"><span>Miter limit</span><input type="number" data-stroke-field="miterLimit" data-stroke-id="${id}" min="1" max="1000" step="0.5" value="${Number(stroke.miterLimit)}" aria-label="${name} miter limit"${node.locked ? ' disabled' : ''}/></label>
        ${decorationControls}
      </div>
      ${primaryControls}
    </div>`;
  }).join('');
  return `<div class="stroke-stack" role="group" aria-label="Ordered strokes">${rows}<div class="image-properties-note">Strokes render in order; later strokes sit above earlier ones. Each stroke keeps its own solid color or linear, radial, or angular gradient, width, opacity, cap, join, and pattern.${supportsEndpointDecorations ? ' Open line ends can use no decoration, an arrow, or a filled triangle.' : ''}</div></div>`;
}
function cornerRadiusControls(node) {
  if (!['rectangle', 'frame', 'section', 'image'].includes(node.type)) return '';
  if (node.cornerRadii) {
    const fields = [
      ['topLeft', 'Top left'], ['topRight', 'Top right'],
      ['bottomLeft', 'Bottom left'], ['bottomRight', 'Bottom right']
    ].map(([side, label]) => numberField(label, `cornerRadii.${side}`, node.cornerRadii[side], 1, 0, 100_000, node.locked, `${label} corner radius`)).join('');
    return `<div class="corner-radius-controls"><div class="property-heading">Independent corners</div><div class="property-grid">${fields}</div><div class="image-properties-note">Independent corners use local values and detach this layer from a shared radius variable.</div><button class="add-fill" type="button" data-action="link-corners"${node.locked ? ' disabled' : ''}>Link corners · use average</button></div>`;
  }
  const radiusValue = getNodePropertyValue(state.document, node, 'radius');
  return `<div class="corner-radius-controls"><div class="property-grid">${numberField('◒', 'radius', radiusValue || 0, 1, 0, 100_000, node.locked, 'Corner radius')}</div>${variablePropertyBindingControl(node, 'radius', 'Corner radius')}<button class="add-fill" type="button" data-action="unlink-corners"${node.locked ? ' disabled' : ''}>Set independent corners</button></div>`;
}
function fillStackControls(node) {
  const fills = fillStackForNode(node);
  const sources = imageFillSources();
  const rows = fills.map((fill, index) => {
    const id = escapeHtml(fill.id);
    const name = fills.length === 1 ? 'Fill' : `Fill ${index + 1}`;
    const typeOptions = [['solid', 'Solid'], ['linear', 'Linear gradient'], ['radial', 'Radial gradient'], ['angular', 'Angular gradient'], ['image', 'Image']]
      .map(([value, label]) => `<option value="${value}"${fill.type === value ? ' selected' : ''}${value === 'image' && !sources.length && fill.type !== 'image' ? ' disabled' : ''}>${label}</option>`).join('');
    const paint = fill.type === 'solid'
      ? `<label class="image-fill-source"><span>Color</span><input type="color" data-fill-field="color" data-fill-id="${id}" value="${/^#[0-9a-f]{6}$/i.test(fill.color) ? escapeHtml(fill.color) : '#d9d9d9'}" aria-label="${name} color"${node.locked ? ' disabled' : ''}/></label>`
      : gradientTypes.has(fill.type)
        ? gradientFillControls(node, fill.gradient, fill.id)
        : imageFillControls(node, fill.imageFill, fill.id);
    const canAddImage = Boolean(sources.length || fill.type === 'image');
    return `<div class="layer-effect-card fill-stack-card" data-fill-row="${id}"><div class="layer-effect-heading"><strong>${name}</strong><label><input type="checkbox" data-fill-field="visible" data-fill-id="${id}"${fill.visible ? ' checked' : ''} aria-label="Show ${name.toLowerCase()}"${node.locked ? ' disabled' : ''}/> Show</label><button class="tiny-icon-button" type="button" data-action="move-fill-layer" data-fill-id="${id}" data-direction="up" aria-label="Move ${name.toLowerCase()} earlier"${node.locked || index === 0 ? ' disabled' : ''}>↑</button><button class="tiny-icon-button" type="button" data-action="move-fill-layer" data-fill-id="${id}" data-direction="down" aria-label="Move ${name.toLowerCase()} later"${node.locked || index === fills.length - 1 ? ' disabled' : ''}>↓</button><button class="tiny-icon-button" type="button" data-action="remove-fill-layer" data-fill-id="${id}" aria-label="Remove ${name.toLowerCase()}"${node.locked ? ' disabled' : ''}>×</button></div><label class="fill-type-row"><span>Paint</span><select class="select-field" data-fill-field="type" data-fill-id="${id}" aria-label="${name} type"${node.locked ? ' disabled' : ''}>${typeOptions}</select></label><div class="slider-row"><label for="fill-opacity-${id}">Opacity</label><input id="fill-opacity-${id}" type="range" min="0" max="100" step="1" value="${Math.round(fill.opacity * 100)}" data-fill-field="opacity" data-fill-id="${id}" aria-label="${name} opacity"${node.locked ? ' disabled' : ''}/><output>${Math.round(fill.opacity * 100)}%</output></div>${paint}</div>`;
  }).join('');
  const disabled = node.locked || fills.length >= 32;
  const imageButton = `<button class="add-fill" type="button" data-action="add-fill-layer" data-fill-type="image"${disabled || !sources.length ? ' disabled' : ''}>＋ Image fill</button>`;
  return `<div class="fill-stack" role="group" aria-label="Ordered fills">${rows}${fills.length >= 32 ? '<div class="image-properties-note">A layer can have up to 32 fills.</div>' : ''}<div class="style-actions fill-stack-actions"><button class="add-fill" type="button" data-action="add-fill-layer" data-fill-type="solid"${disabled ? ' disabled' : ''}>＋ Solid fill</button><button class="add-fill" type="button" data-action="add-fill-layer" data-fill-type="linear"${disabled ? ' disabled' : ''}>＋ Linear</button><button class="add-fill" type="button" data-action="add-fill-layer" data-fill-type="radial"${disabled ? ' disabled' : ''}>＋ Radial</button><button class="add-fill" type="button" data-action="add-fill-layer" data-fill-type="angular"${disabled ? ' disabled' : ''}>＋ Angular</button>${imageButton}</div><div class="image-properties-note">Fills render in order; the later fills sit above the earlier ones.</div></div>`;
}
function appearanceSection(node) {
  const hasFill = isFillStackSupported(node);
  const fills = hasFill ? fillStackControls(node) : '';
  const canBindPrimaryFill = hasFill && fillStackForNode(node)[0]?.type === 'solid';
  const fillBinding = canBindPrimaryFill ? variableBindingControl(node, 'fill') : '';
  const stroke = strokeStackControls(node);
  const radius = cornerRadiusControls(node);
  const fillStyleActions = canBindPrimaryFill
    ? `<button class="add-fill" data-action="create-color-style">${node.fillStyleId ? '✦ Linked color style' : '＋ Create color style'}</button><button class="add-fill" data-action="create-color-variable" data-kind="fill">＋ Create fill variable</button>`
    : '';
  const canAddStroke = !['text', 'boolean'].includes(node.type);
  const strokeCount = strokeStackForNode(node).length;
  const addStrokeAction = canAddStroke ? `<button class="add-fill" data-action="add-stroke"${node.locked || strokeCount >= MAX_STROKES_PER_NODE ? ' disabled' : ''}>＋ Add stroke</button>` : '';
  const styleActions = node.type === 'text'
    ? ''
    : node.type === 'path' || (node.type === 'network' && !hasFill)
    ? `<div class="style-actions">${addStrokeAction}</div>`
    : node.type === 'boolean'
      ? fillStyleActions ? `<div class="style-actions">${fillStyleActions}</div>` : ''
      : `<div class="style-actions">${addStrokeAction}${fillStyleActions}</div>`;
  const body = `${fills}${fillBinding}${stroke}${styleActions}${radius}`;
  return section('Appearance', body);
}
function strokeSection(node) {
  const strokeCount = strokeStackForNode(node).length;
  const addStroke = `<button class="add-fill" type="button" data-action="add-stroke"${node.locked || strokeCount >= MAX_STROKES_PER_NODE ? ' disabled' : ''}>＋ Add stroke</button>`;
  return section('Stroke', `${strokeStackControls(node)}<div class="style-actions">${addStroke}</div>`);
}
function imageAdjustmentsSection(node) {
  const adjustments = { ...defaultImageAdjustments, ...node.adjustments };
  const status = state.imageStatus.get(node.id) || 'Ready · Pillow-RS WebAssembly';
  const statusClass = status.startsWith('Updated') || status.startsWith('Ready') ? 'image-engine-status' : '';
  const body = `${imageTransformControls(node.transforms, 'layer', node.locked, '', node.id)}${sliderField('Exposure', 'adjustments.exposure', adjustments.exposure, -100, 100, 1, node.locked)}${sliderField('Temperature', 'adjustments.temperature', adjustments.temperature, -100, 100, 1, node.locked)}${sliderField('Tint', 'adjustments.tint', adjustments.tint, -100, 100, 1, node.locked)}${sliderField('Brightness', 'adjustments.brightness', adjustments.brightness, -100, 100, 1, node.locked)}${sliderField('Contrast', 'adjustments.contrast', adjustments.contrast, -100, 100, 1, node.locked)}${sliderField('Highlights', 'adjustments.highlights', adjustments.highlights, -100, 100, 1, node.locked)}${sliderField('Shadows', 'adjustments.shadows', adjustments.shadows, -100, 100, 1, node.locked)}${sliderField('Saturation', 'adjustments.saturation', adjustments.saturation, -100, 100, 1, node.locked)}${sliderField('Sharpness', 'adjustments.sharpness', adjustments.sharpness, -100, 100, 1, node.locked)}${sliderField('Blur', 'adjustments.blur', adjustments.blur, 0, 24, 1, node.locked)}${imageToneControls(adjustments, { disabled: node.locked })}<div class="image-engine-status ${statusClass}" id="image-engine-status">${escapeHtml(status)}</div><p class="image-properties-note">Every preview starts from the original image held in memory. Your image never leaves this device.</p>`;
  return section('Image adjustments', body);
}
function isActiveImageRecipeTarget(nodeId) {
  return isImageRecipeBatchActive(state.bulk) && state.bulk.targets.includes(nodeId);
}
function imageRecipeOptions(selectedId = '') {
  const recipes = state.document.recipes || [];
  return recipes.length
    ? recipes.map(recipe => `<option value="${escapeHtml(recipe.id)}"${recipe.id === selectedId ? ' selected' : ''}>${escapeHtml(recipe.name)}</option>`).join('')
    : '<option value="">No saved recipes yet</option>';
}
function singleImageRecipesSection(node) {
  const recipes = state.document.recipes || [];
  const apply = recipes.length
    ? `<label class="field-label" for="selection-image-recipe">Apply a saved recipe</label><select class="select-field recipe-picker" id="selection-image-recipe" aria-label="Choose image recipe">${imageRecipeOptions()}</select><button class="add-fill" type="button" data-action="apply-image-recipe" data-node-id="${escapeHtml(node.id)}">Apply to this image</button>`
    : '<div class="image-properties-note">Save a look from an edited image to reuse it here or across a batch.</div>';
  return section('Image recipes', `<button class="add-fill recipe-save-button" type="button" data-action="save-image-recipe" data-node-id="${escapeHtml(node.id)}">＋ Save current look as recipe</button>${apply}`);
}
function selectionImageRecipesSection(imageCount) {
  const recipes = state.document.recipes || [];
  const picker = recipes.length
    ? `<label class="field-label" for="selection-image-recipe">Recipe</label><select class="select-field recipe-picker" id="selection-image-recipe" aria-label="Choose image recipe">${imageRecipeOptions()}</select><button class="primary-button recipe-apply-button" type="button" data-action="apply-selection-image-recipe">Apply to ${imageCount} image${imageCount === 1 ? '' : 's'}</button>`
    : '<div class="image-properties-note">Save a look from one image first, then apply it to selected images here.</div>';
  return section('Image recipes', `<div class="image-properties-note">${imageCount} image${imageCount === 1 ? '' : 's'} selected. Recipe changes are applied to these image layers in place.</div>${picker}`);
}
function effectNumberField(label, effect, field, step = 1, min = 0, max = 100, disabled = false) {
  return `<div class="property-field"><label>${label}</label><input data-effect-field="${field}" data-effect-id="${escapeHtml(effect.id)}" type="number" step="${step}" min="${min}" max="${max}" value="${Number(effect[field])}" aria-label="${label}"${disabled ? ' disabled' : ''}/></div>`;
}
function effectStylesSection({ canSave = false } = {}) {
  const styles = state.document.effectStyles || [];
  if (!styles.some(style => style.id === selectedEffectStyleId)) selectedEffectStyleId = '';
  const entries = selectedEntries();
  const canApply = entries.length > 0 && entries.every(({ node, parents }) => !node.locked && !parents.some(parent => parent.locked));
  const singleLayer = entries.length === 1;
  const picker = styles.length
    ? `<label class="field-label" for="effect-style-select">Saved effect style</label><select id="effect-style-select" class="select-field" aria-label="Choose saved effect style"><option value="">Choose a style…</option>${styles.map(style => `<option value="${escapeHtml(style.id)}"${style.id === selectedEffectStyleId ? ' selected' : ''}>${escapeHtml(style.name)} · ${style.effects.length} effect${style.effects.length === 1 ? '' : 's'}</option>`).join('')}</select><div class="style-actions"><button class="add-fill" type="button" data-effect-style-action="apply"${canApply && selectedEffectStyleId ? '' : ' disabled'}>Apply to selection</button><button class="add-fill" type="button" data-effect-style-action="update"${canSave && singleLayer && selectedEffectStyleId ? '' : ' disabled'}>Update from layer</button><button class="add-fill" type="button" data-effect-style-action="delete"${selectedEffectStyleId ? '' : ' disabled'}>Delete style</button></div><div class="image-properties-note">Applying copies the entire ordered stack. Updates affect future applications.</div>`
    : '<div class="image-properties-note">Save a layer’s complete ordered effect stack to reuse it on other layers.</div>';
  const save = canSave ? '<button class="add-fill" type="button" data-effect-style-action="save">＋ Save current effects as style</button>' : '';
  return section('Effect styles', `${save}${picker}`);
}
function layerEffectsSection(node) {
  const effects = node.effects || [];
  const entry = selectedEntries().find(item => item.node.id === node.id);
  const locked = node.locked || Boolean(entry?.parents.some(parent => parent.locked));
  const rows = effects.map((effect, index) => {
    const name = effect.type === 'drop-shadow' ? 'Drop shadow' : effect.type === 'inner-shadow' ? 'Inner shadow' : effect.type === 'background-blur' ? 'Background blur' : effect.type === 'noise' ? 'Noise' : effect.type === 'texture' ? 'Texture' : effect.type === 'glass' ? 'Glass' : 'Layer blur';
    const noiseColorFields = effect.mode === 'multi' ? '' : `<div class="effect-color-row noise-colors"><label><span>${effect.mode === 'duo' ? 'Color 1' : 'Color'}</span><input type="color" data-effect-field="color" data-effect-id="${escapeHtml(effect.id)}" value="${escapeHtml(effect.color)}" aria-label="Noise color 1"${locked ? ' disabled' : ''}/></label>${effect.mode === 'duo' ? `<label><span>Color 2</span><input type="color" data-effect-field="color2" data-effect-id="${escapeHtml(effect.id)}" value="${escapeHtml(effect.color2)}" aria-label="Noise color 2"${locked ? ' disabled' : ''}/></label>` : ''}</div>`;
    const noiseFields = `<div class="property-grid"><label class="property-field"><span>Color count</span><select class="select-field" data-effect-field="mode" data-effect-id="${escapeHtml(effect.id)}" aria-label="Noise color count"${locked ? ' disabled' : ''}><option value="mono"${effect.mode === 'mono' ? ' selected' : ''}>Mono</option><option value="duo"${effect.mode === 'duo' ? ' selected' : ''}>Duo</option><option value="multi"${effect.mode === 'multi' ? ' selected' : ''}>Multi</option></select></label>${effectNumberField('X size (px)', effect, 'sizeX', 1, 1, 100, locked)}${effectNumberField('Y size (px)', effect, 'sizeY', 1, 1, 100, locked)}</div>${noiseColorFields}<label class="effect-opacity"><span>Density</span><input type="range" min="0" max="100" step="1" value="${effect.density}" data-effect-field="density" data-effect-id="${escapeHtml(effect.id)}" aria-label="Noise density"${locked ? ' disabled' : ''}/><output>${Math.round(effect.density)}%</output></label><label class="effect-opacity"><span>${effect.mode === 'multi' ? 'Opacity' : 'Color opacity'}</span><input type="range" min="0" max="100" step="1" value="${Math.round(effect.opacity * 100)}" data-effect-field="opacity" data-effect-id="${escapeHtml(effect.id)}" aria-label="Noise opacity"${locked ? ' disabled' : ''}/><output>${Math.round(effect.opacity * 100)}%</output></label>`;
    const textureFields = `<div class="property-grid">${effectNumberField('X size', effect, 'sizeX', 0.1, 0.1, 100, locked)}${effectNumberField('Y size', effect, 'sizeY', 0.1, 0.1, 100, locked)}${effectNumberField('Radius', effect, 'radius', 0.1, 0, 100, locked)}</div><label class="effect-clip"><input type="checkbox" data-effect-field="clipToShape" data-effect-id="${escapeHtml(effect.id)}" aria-label="Clip texture to shape"${effect.clipToShape ? ' checked' : ''}${locked ? ' disabled' : ''}/><span>Clip to shape</span></label>`;
    const glassSlider = (label, field) => `<label class="effect-opacity glass-effect-slider"><span>${label}</span><input type="range" min="0" max="100" step="1" value="${Math.round(effect[field])}" data-effect-field="${field}" data-effect-id="${escapeHtml(effect.id)}" aria-label="Glass ${label.toLowerCase()}"${locked ? ' disabled' : ''}/><output>${Math.round(effect[field])}%</output></label>`;
    const glassFields = `<label class="glass-angle-field"><span>Light angle</span><input type="number" min="0" max="360" step="1" value="${Number(effect.lightAngle)}" data-effect-field="lightAngle" data-effect-id="${escapeHtml(effect.id)}" aria-label="Glass light angle in degrees"${locked ? ' disabled' : ''}/><b>°</b></label>${glassSlider('Light intensity', 'lightIntensity')}${glassSlider('Refraction', 'refraction')}${glassSlider('Depth', 'depth')}${glassSlider('Dispersion', 'dispersion')}${glassSlider('Frost', 'frost')}${glassSlider('Splay', 'splay')}`;
    const fields = effect.type === 'noise'
      ? noiseFields
      : effect.type === 'texture'
      ? textureFields
      : effect.type === 'glass'
      ? glassFields
      : ['drop-shadow', 'inner-shadow'].includes(effect.type)
      ? `<div class="effect-color-row"><label><span>Color</span><input type="color" data-effect-field="color" data-effect-id="${escapeHtml(effect.id)}" value="${escapeHtml(effect.color)}" aria-label="${name} color" /></label><label class="effect-opacity"><span>Opacity</span><input type="range" min="0" max="100" step="1" value="${Math.round(effect.opacity * 100)}" data-effect-field="opacity" data-effect-id="${escapeHtml(effect.id)}" aria-label="${name} opacity" /><output>${Math.round(effect.opacity * 100)}%</output></label></div><div class="property-grid">${effectNumberField('X', effect, 'offsetX', 1, -1000, 1000)}${effectNumberField('Y', effect, 'offsetY', 1, -1000, 1000)}${effectNumberField('Blur', effect, 'blur', 1, 0, 100)}</div>`
      : `<div class="property-grid">${effectNumberField('Radius', effect, 'radius', 1, 0, 100)}</div>`;
    return `<div class="layer-effect-card" data-effect-row="${escapeHtml(effect.id)}"><div class="layer-effect-heading"><strong>${name}</strong><label><input type="checkbox" data-effect-field="visible" data-effect-id="${escapeHtml(effect.id)}" ${effect.visible ? 'checked' : ''} aria-label="Show ${name.toLowerCase()}"${locked ? ' disabled' : ''}/> Show</label><button class="tiny-icon-button" type="button" data-action="move-layer-effect" data-effect-id="${escapeHtml(effect.id)}" data-direction="up" aria-label="Move ${name.toLowerCase()} up" title="Move up"${locked || index === 0 ? ' disabled' : ''}>↑</button><button class="tiny-icon-button" type="button" data-action="move-layer-effect" data-effect-id="${escapeHtml(effect.id)}" data-direction="down" aria-label="Move ${name.toLowerCase()} down" title="Move down"${locked || index === effects.length - 1 ? ' disabled' : ''}>↓</button><button class="tiny-icon-button" type="button" data-action="remove-layer-effect" data-effect-id="${escapeHtml(effect.id)}" aria-label="Remove ${name.toLowerCase()}"${locked ? ' disabled' : ''}>×</button></div>${fields}</div>`;
  }).join('');
  const dropShadowCount = effects.filter(effect => effect.type === 'drop-shadow').length;
  const innerShadowCount = effects.filter(effect => effect.type === 'inner-shadow').length;
  const noiseCount = effects.filter(effect => effect.type === 'noise').length;
  const textureCount = effects.filter(effect => effect.type === 'texture').length;
  const glassCount = effects.filter(effect => effect.type === 'glass').length;
  const blurAlreadyUsed = effects.some(effect => effect.type === 'layer-blur' || effect.type === 'background-blur');
  const note = `<div class="image-properties-note">Up to ${MAX_DROP_SHADOWS_PER_LAYER} drop shadows, ${MAX_INNER_SHADOWS_PER_LAYER} inner shadows, ${MAX_NOISE_EFFECTS_PER_LAYER} noise effects, one texture, one Glass, plus one layer or background blur.</div><div class="image-properties-note">Order is saved. Glass and background blur share a backdrop slot: the first visible one wins. Glass is hidden over a 100%-opacity fill. Preview uses local backdrop refraction and direct-light highlights; it does not simulate environmental reflections.</div><div class="image-properties-note">Texture, inner shadow, and noise use dedicated passes before outer blur/drop-shadow filters. Reordering these effect types changes the saved stack but not their grouped render passes.</div>${effects.length ? '' : '<div class="image-properties-note">Effects stay editable and are saved with this design.</div>'}`;
  const buttons = `<div class="style-actions"><button class="add-fill" type="button" data-action="add-layer-effect" data-effect-type="drop-shadow"${locked || dropShadowCount >= MAX_DROP_SHADOWS_PER_LAYER ? ' disabled' : ''}>＋ Drop shadow</button><button class="add-fill" type="button" data-action="add-layer-effect" data-effect-type="inner-shadow"${locked || innerShadowCount >= MAX_INNER_SHADOWS_PER_LAYER ? ' disabled' : ''}>＋ Inner shadow</button><button class="add-fill" type="button" data-action="add-layer-effect" data-effect-type="noise"${locked || noiseCount >= MAX_NOISE_EFFECTS_PER_LAYER ? ' disabled' : ''}>＋ Noise</button><button class="add-fill" type="button" data-action="add-layer-effect" data-effect-type="texture"${locked || textureCount >= MAX_TEXTURE_EFFECTS_PER_LAYER ? ' disabled' : ''}>＋ Texture</button><button class="add-fill" type="button" data-action="add-layer-effect" data-effect-type="glass"${locked || glassCount >= MAX_GLASS_EFFECTS_PER_LAYER ? ' disabled' : ''}>＋ Glass</button><button class="add-fill" type="button" data-action="add-layer-effect" data-effect-type="layer-blur"${locked || blurAlreadyUsed ? ' disabled' : ''}>＋ Layer blur</button><button class="add-fill" type="button" data-action="add-layer-effect" data-effect-type="background-blur"${locked || blurAlreadyUsed ? ' disabled' : ''}>＋ Background blur</button></div>`;
  return section('Effects', `${rows}${note}${buttons}`);
}
function exportSettingsSection(node) {
  const settings = node.exportSettings || [];
  const formats = [['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']];
  const scales = [0.5, 0.75, 1, 1.5, 2, 3, 4];
  const slicePage = node.type === 'slice' ? activePage() : null;
  const sliceBackdropWorldBleed = slicePage ? sliceExportBackdropWorldBleed(slicePage, node) : 0;
  const rows = settings.map(setting => {
    const options = formats.map(([value, label]) => `<option value="${value}"${setting.format === value ? ' selected' : ''}>${label}</option>`).join('');
    const scaleOptions = scales.map(value => `<option value="${value}"${setting.scale === value ? ' selected' : ''}>${value}×</option>`).join('');
    let size;
    let sizeError = '';
    try {
      if (node.type === 'slice') {
        const plan = planSliceRasterExport(sliceExportGeometry(node), { scale: setting.scale, padding: setting.padding ?? 0 });
        planSliceRenderSurface(plan, sliceRenderBleedPixels(sliceBackdropWorldBleed, setting.scale));
        size = plan.outputSize;
      } else size = exportDimensions(node.id, setting.scale);
    } catch (error) {
      sizeError = error.message || 'Outside the local export budget.';
      size = null;
    }
    const quality = setting.format === 'png' ? '' : `<label class="export-quality"><span>Quality</span><input type="range" min="1" max="100" step="1" value="${setting.quality}" data-export-field="quality" data-export-id="${escapeHtml(setting.id)}" aria-label="Export quality"/><output aria-live="polite">${setting.quality}%</output></label>`;
    const padding = node.type === 'slice' ? `<label class="export-suffix"><span>Padding · px</span><input type="number" min="0" max="10000" step="1" value="${setting.padding ?? 0}" data-export-field="padding" data-export-id="${escapeHtml(setting.id)}" aria-label="Slice export padding in pixels"/></label>` : '';
    return `<div class="export-setting-row" data-export-row="${escapeHtml(setting.id)}"><div class="export-setting-controls"><label><span>Format</span><select class="select-field" data-export-field="format" data-export-id="${escapeHtml(setting.id)}" aria-label="Export format">${options}</select></label><label><span>Scale</span><select class="select-field" data-export-field="scale" data-export-id="${escapeHtml(setting.id)}" aria-label="Export scale">${scaleOptions}</select></label></div><label class="export-suffix"><span>Suffix</span><input type="text" maxlength="24" value="${escapeHtml(setting.suffix)}" placeholder="@2x" data-export-field="suffix" data-export-id="${escapeHtml(setting.id)}" aria-label="Export suffix"/></label>${padding}${quality}<div class="export-setting-actions"><span>${size ? `${size.width} × ${size.height} px` : escapeHtml(sizeError)}</span><button class="secondary-button" type="button" data-action="export-setting" data-export-id="${escapeHtml(setting.id)}"${size ? '' : ' disabled'}>Export</button><button class="tiny-icon-button" type="button" data-action="remove-export-setting" data-export-id="${escapeHtml(setting.id)}" aria-label="Remove export setting">×</button></div></div>`;
  }).join('');
  const message = settings.length ? '' : `<div class="image-properties-note">Add one or more PNG, JPG, or WebP sizes for this ${node.type === 'slice' ? 'slice' : 'layer'}.</div>`;
  const add = settings.length >= 8 ? '<div class="image-properties-note">This layer has reached the 8-setting limit.</div>' : `<button class="add-fill" type="button" data-action="add-export-setting">＋ Add ${node.type === 'slice' ? 'slice export' : 'export setting'}</button>`;
  const rasterPdf = node.type === 'frame'
    ? '<button class="add-fill" type="button" data-action="export-raster-pdf">Download 1× raster PDF</button><div class="image-properties-note">This local PDF is a flattened 1× export. Use vector PDF for supported shapes or editable SVG for full vector artwork.</div>'
    : '';
  const vectorPdf = node.type === 'frame'
    ? '<button class="add-fill" type="button" data-action="export-vector-pdf">Download vector PDF</button><div class="image-properties-note">Keeps supported shapes and paths editable, embeds untouched PNG/JPEG images as image objects, and renders edited images to local PNG previews. Text, unsupported image formats, filters, masks, blend modes, and unsupported effects need raster PDF.</div>'
    : '';
  const svgExport = node.type === 'slice' ? '' : '<button class="add-fill" type="button" data-action="export-svg">Download editable SVG</button><div class="image-properties-note">SVG is the editable vector export. It preserves vector shapes and text, embeds local raster images, and includes supported linear/radial gradients, shadows, blur, blend modes, masks, and Boolean union, subtract, intersect, and exclude. Angular gradients are canvas-editable but require raster export because SVG/PDF vector export cannot preserve them. Crop, quarter-turn rotation, and flips stay editable; edited images use their local PNG previews. Vector networks become ordinary SVG paths, so graph editing controls are not retained. Non-normal Boolean operand blending and unsupported gradient placements are not included.</div>';
  return section('Export', `${rows}${message}${add}${rasterPdf}${vectorPdf}${svgExport}`);
}
const autoLayoutBindingProperties = [
  ['autoLayout.axis', 'Flow direction'], ['autoLayout.align', 'Alignment'], ['autoLayout.justify', 'Distribution'],
  ['autoLayout.mainSizing', 'Main size'], ['autoLayout.crossSizing', 'Cross size'], ['autoLayout.wrap', 'Wrap'],
  ['autoLayout.autoPositioning', 'Grid auto position'], ['autoLayout.columns', 'Grid columns'], ['autoLayout.rows', 'Grid rows'],
  ['autoLayout.columnGap', 'Horizontal gap'], ['autoLayout.rowGap', 'Vertical gap'],
  ['autoLayout.padding.top', 'Top padding'], ['autoLayout.padding.right', 'Right padding'],
  ['autoLayout.padding.bottom', 'Bottom padding'], ['autoLayout.padding.left', 'Left padding']
];
function resolveAutoLayoutSettings(node) {
  const settings = createAutoLayout(node.autoLayout || {});
  for (const [property] of autoLayoutBindingProperties) {
    if (!node.variableBindings?.[property]) continue;
    const value = getNodePropertyValue(state.document, node, property);
    const keys = property.slice('autoLayout.'.length).split('.');
    let target = settings;
    for (const key of keys.slice(0, -1)) target = target[key];
    target[keys.at(-1)] = value;
  }
  return createAutoLayout(settings);
}
function gridTrackEditor(node, axis, count, tracks, fallbackMode) {
  const title = axis === 'columnTracks' ? 'Columns' : 'Rows';
  const shortTitle = axis === 'columnTracks' ? 'Column' : 'Row';
  const rows = Array.from({ length: Math.max(1, Math.min(64, count)) }, (_, index) => {
    const track = tracks[index] || (fallbackMode === 'fill' ? { mode: 'fill', weight: 1 } : { mode: fallbackMode });
    const mode = ['fixed', 'hug', 'fill'].includes(track.mode) ? track.mode : fallbackMode;
    const modeOptions = [['fixed', 'Fixed'], ['hug', 'Hug content'], ['fill', 'Fill available']]
      .map(([value, label]) => `<option value="${value}"${mode === value ? ' selected' : ''}>${label}</option>`).join('');
    const valueControl = mode === 'hug'
      ? '<span class="grid-track-content">Content size</span>'
      : `<label class="grid-track-value"><span>${mode === 'fixed' ? 'Pixels' : 'Weight'}</span><input type="number" min="${mode === 'fixed' ? 0 : 0.01}" max="100000" step="${mode === 'fixed' ? 1 : 0.1}" value="${mode === 'fixed' ? track.value : track.weight ?? 1}" data-prop="autoLayout.${axis}.${index}.${mode === 'fixed' ? 'value' : 'weight'}" aria-label="${shortTitle} ${index + 1} ${mode === 'fixed' ? 'size in pixels' : 'fill weight'}"${node.locked ? ' disabled' : ''}/></label>`;
    return `<div class="grid-track-row"><span class="grid-track-name">${shortTitle} ${index + 1}</span><select class="prop-input select-field" data-prop="autoLayout.${axis}.${index}.mode" aria-label="${shortTitle} ${index + 1} sizing"${node.locked ? ' disabled' : ''}>${modeOptions}</select>${valueControl}</div>`;
  }).join('');
  return `<details class="grid-track-editor"><summary>${title} sizing</summary><div class="grid-track-list">${rows}</div></details>`;
}
function visibleGridRowCount(node, layout) {
  if (layout.rows !== 'auto') return layout.rows;
  return (node.children || []).filter(child => child.visible && child.layoutPositioning !== 'absolute')
    .reduce((max, child) => Math.max(max, (child.gridCell?.row || 1) + (child.gridCell?.rowSpan || 1) - 1), 1);
}
function updateAutoLayoutGridTrack(node, key, value) {
  const match = /^(columnTracks|rowTracks)\.(\d+)\.(mode|value|weight)$/.exec(key);
  if (!match) return false;
  const [, axis, rawIndex, field] = match;
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0 || index >= 64) return false;
  const fallbackMode = axis === 'columnTracks' || node.autoLayout.rows !== 'auto' ? 'fill' : 'hug';
  node.autoLayout[axis] ||= [];
  let track = node.autoLayout[axis][index] || (fallbackMode === 'fill' ? { mode: 'fill', weight: 1 } : { mode: 'hug' });
  if (field === 'mode') {
    track = value === 'fixed'
      ? { mode: 'fixed', value: track.mode === 'fixed' ? track.value : 120 }
      : value === 'fill'
        ? { mode: 'fill', weight: track.mode === 'fill' ? track.weight : 1 }
        : { mode: 'hug' };
  } else if (field === 'value' && track.mode === 'fixed') {
    track.value = Math.max(0, Math.min(100_000, Number.isFinite(Number(value)) ? Number(value) : 120));
  } else if (field === 'weight' && track.mode === 'fill') {
    track.weight = Math.max(0.01, Math.min(100_000, Number.isFinite(Number(value)) ? Number(value) : 1));
  }
  node.autoLayout[axis][index] = track;
  return true;
}
function applyAutoLayout(frame) {
  if (!frame?.autoLayout) return applyAutoLayoutEngine(frame);
  const baseSettings = createAutoLayout(frame.autoLayout);
  const hasBindings = autoLayoutBindingProperties.some(([property]) => frame.variableBindings?.[property]);
  if (!hasBindings) return applyAutoLayoutEngine(frame);
  const resolvedSettings = resolveAutoLayoutSettings(frame);
  const result = applyAutoLayoutEngine(frame, resolvedSettings);
  frame.autoLayout = baseSettings;
  return result;
}
function relayoutVariableBoundFrames() {
  const affected = new Map();
  for (const page of state.document.pages || []) walkNodes(page.children || [], ({ node, parents }) => {
    if (node.type !== 'frame' || !node.autoLayout || !autoLayoutBindingProperties.some(([property]) => node.variableBindings?.[property])) return;
    for (let index = 0; index < parents.length; index += 1) {
      const frame = parents[index];
      if (frame.type === 'frame' && frame.autoLayout) affected.set(frame.id, { node: frame, depth: index + 1 });
    }
    affected.set(node.id, { node, depth: parents.length + 1 });
  });
  for (const { node } of [...affected.values()].sort((left, right) => right.depth - left.depth)) applyAutoLayout(node);
}
function autoLayoutSection(node) {
  if (!node.autoLayout) {
    const suggestion = suggestAutoLayout(node);
    const pending = state.autoLayoutSuggestion?.frameId === node.id ? state.autoLayoutSuggestion : null;
    const isCurrent = Boolean(pending && suggestion.supported && pending.signature === suggestion.signature);
    const paddingText = settings => `T ${settings.padding.top} · R ${settings.padding.right} · B ${settings.padding.bottom} · L ${settings.padding.left}`;
    const description = suggestion.supported
      ? `${suggestion.pattern === 'grid' ? `${suggestion.cells.reduce((max, cell) => Math.max(max, cell.row), 0)} × ${suggestion.settings.columns} regular grid · columns ${suggestion.settings.columnGap}px / rows ${suggestion.settings.rowGap}px` : `${suggestion.pattern === 'horizontal' ? 'horizontal row' : 'vertical column'} · ${suggestion.pattern === 'horizontal' ? suggestion.settings.columnGap : suggestion.settings.rowGap}px gap`} · padding ${paddingText(suggestion.settings)}`
      : suggestion.reason;
    const preview = isCurrent
      ? `<div class="auto-layout-suggestion-preview"><strong>Suggested ${suggestion.pattern} layout</strong><span>${escapeHtml(description)}</span><span>${suggestion.flowIds.length} layers will flow${suggestion.absoluteIds.length ? `; ${suggestion.absoluteIds.length} uncertain layer${suggestion.absoluteIds.length === 1 ? '' : 's'} will keep their positions` : ''}.</span></div><div class="auto-layout-suggestion-actions"><button class="primary-button" type="button" data-action="apply-auto-layout-suggestion">Apply suggestion</button><button class="secondary-button" type="button" data-action="cancel-auto-layout-suggestion">Cancel</button></div>`
      : pending
        ? '<div class="image-properties-note">The frame changed since this suggestion. Review a fresh suggestion before applying.</div>'
        : '';
    const suggestLabel = pending && !isCurrent ? 'Review updated suggestion' : 'Suggest auto layout';
    const suggest = `<button class="add-fill auto-layout-suggest-button" type="button" data-action="suggest-auto-layout"${suggestion.supported ? '' : ' disabled'}>${suggestLabel}</button>`;
    const note = suggestion.supported
      ? 'Review the inferred direction, spacing, and padding before applying. Uncertain layers remain fixed in place.'
      : suggestion.reason;
    return section('Layout', `${suggest}${preview}<div class="image-properties-note">${escapeHtml(note)}</div><button class="add-fill" type="button" data-action="auto-layout-toggle">＋ Add auto layout manually</button>`);
  }
  const layout = resolveAutoLayoutSettings(node);
  const select = (prop, value, values) => `<select class="prop-input select-field" data-prop="autoLayout.${prop}" aria-label="${prop}">${values.map(([key, label]) => `<option value="${key}"${String(value) === key ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  const axis = select('axis', layout.axis, [['vertical','Vertical'],['horizontal','Horizontal'],['grid','Grid']]);
  const minimumGap = layout.axis === 'grid' ? 0 : -100_000;
  const padding = `<div class="property-grid">${numberField('Top', 'autoLayout.padding.top', layout.padding.top, 1, 0)}${numberField('Right', 'autoLayout.padding.right', layout.padding.right, 1, 0)}${numberField('Bottom', 'autoLayout.padding.bottom', layout.padding.bottom, 1, 0)}${numberField('Left', 'autoLayout.padding.left', layout.padding.left, 1, 0)}</div>`;
  const variableProperties = autoLayoutBindingProperties.map(([property, label]) => variablePropertyBindingControl(node, property, label)).filter(Boolean).join('');
  const variableBindings = variableProperties ? `<details class="auto-layout-variable-bindings"><summary>Bind layout properties</summary>${variableProperties}</details>` : '';
  const body = layout.axis === 'grid'
    ? `<div class="property-grid"><span class="field-caption">Flow</span>${axis}${numberField('Columns', 'autoLayout.columns', layout.columns, 1, 1, 64)}<span class="field-caption">Rows</span>${select('rows', layout.rows, [['auto','Auto'], ...Array.from({ length: 64 }, (_, index) => [String(index + 1), String(index + 1)])])}${numberField('Horizontal gap', 'autoLayout.columnGap', layout.columnGap, 1, 0, 100_000)}${numberField('Vertical gap', 'autoLayout.rowGap', layout.rowGap, 1, 0, 100_000)}<label class="field-caption" for="auto-layout-auto-positioning">Auto position</label><input class="prop-input" data-prop="autoLayout.autoPositioning" type="checkbox" id="auto-layout-auto-positioning" ${layout.autoPositioning ? 'checked' : ''}/></div>${gridTrackEditor(node, 'columnTracks', layout.columns, layout.columnTracks, 'fill')}${gridTrackEditor(node, 'rowTracks', visibleGridRowCount(node, layout), layout.rowTracks, layout.rows === 'auto' ? 'hug' : 'fill')}${padding}<div class="image-properties-note">Each track can stay fixed, hug its contents, or share remaining space by weight. Grid cells flow in layer order; turn off Auto position to edit a layer’s row and column.</div>${variableBindings}<button class="add-fill" data-action="auto-layout-toggle">− Remove auto layout</button>`
    : `<div class="property-grid"><span class="field-caption">Flow</span>${axis}${numberField('Horizontal gap', 'autoLayout.columnGap', layout.columnGap, 1, minimumGap, 100_000)}${numberField('Vertical gap', 'autoLayout.rowGap', layout.rowGap, 1, minimumGap, 100_000)}<span class="field-caption">Align</span>${select('align', layout.align, [['start','Start'],['center','Center'],['end','End'],['stretch','Stretch']])}<span class="field-caption">Distribute</span>${select('justify', layout.justify, [['start','Packed'],['center','Center'],['end','End'],['space-between','Space between'],['space-around','Space around'],['space-evenly','Space evenly']])}<span class="field-caption">Main size</span>${select('mainSizing', layout.mainSizing, [['fixed','Fixed'],['hug','Hug contents']])}<span class="field-caption">Cross size</span>${select('crossSizing', layout.crossSizing, [['fixed','Fixed'],['hug','Hug contents']])}<label class="field-caption" for="auto-layout-wrap">Wrap</label><input class="prop-input" data-prop="autoLayout.wrap" type="checkbox" id="auto-layout-wrap" ${layout.wrap ? 'checked' : ''}/></div>${padding}<div class="image-properties-note">Negative gaps overlap adjacent layers.</div>${variableBindings}<button class="add-fill" data-action="auto-layout-toggle">− Remove auto layout</button>`;
  return section('Auto layout', body);
}
function guideNumberField(guide, label, property, value, min = 0, max = 10_000, step = 1) {
  return `<label class="layout-guide-field"><span>${label}</span><input type="number" min="${min}" max="${max}" step="${step}" value="${value}" data-guide-id="${escapeHtml(guide.id)}" data-guide-field="${property}" aria-label="${label}"/></label>`;
}
function layoutGuidesSection(node) {
  const guides = node.layoutGuides || [];
  const types = [['grid','Grid'],['columns','Columns'],['rows','Rows']];
  const rows = guides.map(guide => {
    const typeOptions = types.map(([value, label]) => `<option value="${value}"${guide.type === value ? ' selected' : ''}>${label}</option>`).join('');
    const alignmentOptions = guide.type === 'columns'
      ? [['stretch','Stretch'],['left','Left'],['center','Center'],['right','Right']]
      : [['stretch','Stretch'],['top','Top'],['center','Center'],['bottom','Bottom']];
    const alignment = guide.type === 'grid' ? '' : `<label class="layout-guide-field"><span>Type</span><select data-guide-id="${escapeHtml(guide.id)}" data-guide-field="alignment" aria-label="Guide placement">${alignmentOptions.map(([value, label]) => `<option value="${value}"${guide.alignment === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
    const geometry = guide.type === 'grid'
      ? guideNumberField(guide, 'Size', 'size', guide.size, 1, 500)
      : `<div class="layout-guide-fields">${guideNumberField(guide, 'Count', 'count', guide.count, 1, 64)}${alignment}${guide.alignment === 'stretch' ? `${guideNumberField(guide, 'Margin', 'margin', guide.margin)}${guideNumberField(guide, 'Gutter', 'gutter', guide.gutter)}` : `${guideNumberField(guide, guide.type === 'columns' ? 'Width' : 'Height', 'bandSize', guide.bandSize, 1)}${['left','right','top','bottom'].includes(guide.alignment) ? guideNumberField(guide, 'Offset', 'offset', guide.offset) : ''}`}</div>`;
    return `<div class="layout-guide-card" data-layout-guide="${escapeHtml(guide.id)}"><div class="layout-guide-heading"><button class="tiny-icon-button layout-guide-visibility" type="button" data-action="toggle-layout-guide" data-guide-id="${escapeHtml(guide.id)}" aria-label="${guide.visible ? 'Hide' : 'Show'} this guide" aria-pressed="${guide.visible}">${guide.visible ? '◉' : '○'}</button><select data-guide-id="${escapeHtml(guide.id)}" data-guide-field="type" aria-label="Layout guide type">${typeOptions}</select><button class="tiny-icon-button layout-guide-remove" type="button" data-action="remove-layout-guide" data-guide-id="${escapeHtml(guide.id)}" aria-label="Remove layout guide">×</button></div>${geometry}<div class="layout-guide-appearance"><label><span>Color</span><input type="color" value="${escapeHtml(guide.color)}" data-guide-id="${escapeHtml(guide.id)}" data-guide-field="color" aria-label="Guide color"/></label><label class="layout-guide-opacity"><span>Opacity</span><input type="range" min="0" max="100" step="1" value="${Math.round(guide.opacity * 100)}" data-guide-id="${escapeHtml(guide.id)}" data-guide-field="opacity" aria-label="Guide opacity"/><output>${Math.round(guide.opacity * 100)}%</output></label></div></div>`;
  }).join('');
  const add = guides.length >= 32
    ? '<div class="image-properties-note">This frame has reached the 32-guide limit.</div>'
    : `<div class="layout-guide-adds">${types.map(([type, label]) => `<button type="button" data-action="add-layout-guide" data-guide-type="${type}">＋ ${label}</button>`).join('')}</div>`;
  const empty = guides.length ? '' : '<div class="image-properties-note">Add grid, row, or column guides. Combine them to build a precise frame layout.</div>';
  const rotationHint = guides.length ? '<div class="image-properties-note">Guides are shown while this frame is unrotated.</div>' : '';
  return section('Layout guides', `${rows}${empty}${rotationHint}${add}`);
}
function gridPlacementSection(node, parent) {
  const cell = { row: 1, column: 1, rowSpan: 1, columnSpan: 1, alignX: 'start', alignY: 'start', ...(node.gridCell || {}) };
  const automatic = parent.autoLayout.autoPositioning !== false;
  const select = (prop, value, values) => `<select class="prop-input select-field" data-prop="gridCell.${prop}" aria-label="${prop}">${values.map(([key, label]) => `<option value="${key}"${value === key ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  const sizing = (property, value) => `<select class="prop-input select-field" data-prop="${property}" aria-label="${property}"><option value="fixed"${value !== 'fill' ? ' selected' : ''}>Fixed</option><option value="fill"${value === 'fill' ? ' selected' : ''}>Fill cell</option></select>`;
  return section('Grid placement', `<div class="property-grid">${numberField('Row', 'gridCell.row', cell.row, 1, 1, 64, automatic)}${numberField('Column', 'gridCell.column', cell.column, 1, 1, 64, automatic)}${numberField('Row span', 'gridCell.rowSpan', cell.rowSpan, 1, 1, 64)}${numberField('Column span', 'gridCell.columnSpan', cell.columnSpan, 1, 1, 64)}<span class="field-caption">Align X</span>${select('alignX', cell.alignX, [['start','Left'],['center','Center'],['end','Right']])}<span class="field-caption">Align Y</span>${select('alignY', cell.alignY, [['start','Top'],['center','Center'],['end','Bottom']])}<span class="field-caption">Width</span>${sizing('layoutSizingX', node.layoutSizingX)}<span class="field-caption">Height</span>${sizing('layoutSizingY', node.layoutSizingY)}</div>${automatic ? '<div class="image-properties-note">Turn off Auto position on the grid frame to edit row and column.</div>' : ''}`);
}
function autoLayoutChildPositioningSection(node) {
  const absolute = node.layoutPositioning === 'absolute';
  return section('Position in auto layout', `<label class="field-caption" for="auto-layout-positioning">Placement</label><select id="auto-layout-positioning" class="prop-input select-field" data-prop="layoutPositioning" aria-label="Position in auto layout"><option value="flow"${absolute ? '' : ' selected'}>Auto layout flow</option><option value="absolute"${absolute ? ' selected' : ''}>Absolute</option></select><div class="image-properties-note">Absolute layers stay at their X/Y position and do not affect the frame’s flow. Position and size them in the section above.</div>`);
}
function constraintsSection(node) {
  const constraints = { horizontal: 'left', vertical: 'top', ...(node.constraints || {}) };
  const select = (prop, value, values) => `<select class="prop-input select-field" data-prop="constraints.${prop}" aria-label="${prop} constraint">${values.map(([key, label]) => `<option value="${key}"${value === key ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  return section('Constraints', `<div class="property-grid"><span class="field-caption">Horizontal</span>${select('horizontal', constraints.horizontal, horizontalConstraints)}<span class="field-caption">Vertical</span>${select('vertical', constraints.vertical, verticalConstraints)}</div><div class="image-properties-note">Pins and scales this layer when its parent frame changes size.</div>`);
}
function sizeLimitsSection(node, parent) {
  if (!node.autoLayout && !parent?.autoLayout) return '';
  const fields = `<div class="property-grid size-limits-grid">${optionalNumberField('Min width', 'minWidth', node.minWidth)}${optionalNumberField('Max width', 'maxWidth', node.maxWidth)}${optionalNumberField('Min height', 'minHeight', node.minHeight)}${optionalNumberField('Max height', 'maxHeight', node.maxHeight)}</div><div class="image-properties-note">Leave a value blank for no limit. Limits are in pixels and apply as this layer resizes.</div>`;
  return section('Size limits', fields);
}
function componentPropertyTargets(root) {
  const targets = [];
  const visit = (node, isRoot = false) => {
    targets.push(node);
    if (!isRoot && node.isInstance) return;
    for (const child of node.children || []) visit(child);
  };
  visit(root, true);
  return targets;
}
function defaultVariableMode(collection) {
  return collection?.modes?.find(mode => mode.id === collection.defaultModeId) || collection?.modes?.[0] || null;
}
function componentInstancePropertyControls(component, instance) {
  const rows = (component?.componentProperties || []).map(property => {
    const current = Object.hasOwn(instance.componentPropertyValues || {}, property.id)
      ? instance.componentPropertyValues[property.id] : property.defaultValue;
    const label = `<span>${escapeHtml(property.name)}</span>`;
    if (property.type === 'BOOLEAN') return `<label class="component-property-value">${label}<input type="checkbox" data-component-property-value="${escapeHtml(property.id)}" data-instance-id="${escapeHtml(instance.id)}"${current ? ' checked' : ''} aria-label="${escapeHtml(property.name)}"/></label>`;
    if (property.type === 'TEXT') return `<label class="component-property-value">${label}<input type="text" maxlength="1000000" data-component-property-value="${escapeHtml(property.id)}" data-instance-id="${escapeHtml(instance.id)}" value="${escapeHtml(current)}" aria-label="${escapeHtml(property.name)}"/></label>`;
    if (property.type === 'SLOT') {
      const count = Array.isArray(current) ? current.length : 0;
      const hasOverride = Object.hasOwn(instance.componentPropertyValues || {}, property.id);
      return `<div class="component-slot-value"><div class="component-slot-copy"><strong>${escapeHtml(property.name)}</strong><small>${hasOverride ? `${count} custom layer${count === 1 ? '' : 's'}` : 'Using default content'}</small></div><button class="secondary-button" type="button" data-action="choose-component-slot-content" data-instance-id="${escapeHtml(instance.id)}" data-property-id="${escapeHtml(property.id)}">${hasOverride ? 'Replace…' : 'Choose content…'}</button>${hasOverride ? `<button class="tiny-icon-button component-slot-reset" type="button" data-action="reset-component-slot" data-instance-id="${escapeHtml(instance.id)}" data-property-id="${escapeHtml(property.id)}" aria-label="Reset ${escapeHtml(property.name)} to component default" title="Reset to component default">↺</button>` : ''}</div>`;
    }
    const validCandidates = (state.document.components || []).filter(candidate => canSwapComponentTo(state.document, component.id, candidate.id));
    const preferredCandidates = property.preferredComponentIds?.length
      ? validCandidates.filter(candidate => property.preferredComponentIds.includes(candidate.id))
      : validCandidates;
    const currentCandidate = state.document.components?.find(item => item.id === current);
    const candidates = currentCandidate && canSwapComponentTo(state.document, component.id, currentCandidate.id)
      && !preferredCandidates.some(item => item.id === currentCandidate.id)
      ? [...preferredCandidates, currentCandidate]
      : preferredCandidates;
    const choices = candidates.map(candidate => `<option value="${escapeHtml(candidate.id)}"${candidate.id === current ? ' selected' : ''}>${escapeHtml(candidate.name)}</option>`).join('');
    return `<label class="component-property-value">${label}<select class="select-field" data-component-property-value="${escapeHtml(property.id)}" data-instance-id="${escapeHtml(instance.id)}" aria-label="${escapeHtml(property.name)} component">${choices}</select></label>`;
  }).join('');
  return rows ? `<div class="component-property-values">${rows}</div>` : '';
}
function componentPropertyDefinitions(component, root) {
  const targets = componentPropertyTargets(root);
  const selectedTarget = targets.find(target => target.id === state.componentPropertyTargetId) || targets[0];
  const supportedTypes = [['BOOLEAN', 'Visibility']];
  if (selectedTarget?.type === 'text') supportedTypes.push(['TEXT', 'Text']);
  if (selectedTarget?.isInstance) supportedTypes.push(['INSTANCE_SWAP', 'Instance swap']);
  if (selectedTarget && selectedTarget.id !== component.rootNodeId && ['frame', 'group', 'section'].includes(selectedTarget.type)) supportedTypes.push(['SLOT', 'Content slot']);
  const selectedType = supportedTypes.some(([type]) => type === state.componentPropertyType) ? state.componentPropertyType : supportedTypes[0]?.[0] || 'BOOLEAN';
  const definitions = (component.componentProperties || []).map(property => {
    const target = targets.find(item => item.id === property.targetSourceId);
    const summary = property.type === 'BOOLEAN' ? 'Visibility' : property.type === 'TEXT' ? 'Text' : property.type === 'SLOT' ? 'Flexible slot' : 'Instance swap';
    return `<div class="component-property-definition"><strong>${escapeHtml(property.name)}</strong><small>${summary}${target ? ` · ${escapeHtml(target.name)}` : ''}</small></div>`;
  }).join('');
  const targetOptions = targets.map(target => `<option value="${escapeHtml(target.id)}"${target.id === selectedTarget?.id ? ' selected' : ''}>${escapeHtml(target.name)}</option>`).join('');
  const typeOptions = supportedTypes.map(([type, label]) => `<option value="${type}"${type === selectedType ? ' selected' : ''}>${label}</option>`).join('');
  const editor = targets.length && (component.componentProperties || []).length < 100
    ? `<div class="component-property-editor"><input class="text-field" id="component-property-name" maxlength="80" value="" placeholder="Property name" aria-label="New component property name"/><select class="select-field" id="component-property-target" aria-label="Component property target">${targetOptions}</select><select class="select-field" id="component-property-type" aria-label="Component property type">${typeOptions}</select><button class="add-fill" data-action="create-component-property" data-component-id="${escapeHtml(component.id)}" data-target-id="${escapeHtml(selectedTarget.id)}" data-property-type="${selectedType}">＋ Add property</button></div>`
    : '';
  return `<div class="component-property-editor-wrap"><div class="component-property-heading">Component properties <span>${(component.componentProperties || []).length}/100</span></div>${definitions || '<div class="image-properties-note">Expose text, visibility, a nested instance, or a content slot as a reusable control.</div>'}${component.componentProperties?.length >= 100 ? '<div class="image-properties-note">This component has reached the 100-property limit.</div>' : editor}</div>`;
}
function componentLibraryOptions(selectedId = state.componentLibraryTargetId) {
  const libraries = state.componentLibraries || [];
  const selected = libraries.some(library => library.id === selectedId) ? selectedId : (libraries[0]?.id || '');
  state.componentLibraryTargetId = selected || null;
  return `<option value=""${selected ? '' : ' selected'}>Create a new local library…</option>${libraries.map(library => `<option value="${escapeHtml(library.id)}"${library.id === selected ? ' selected' : ''}>${escapeHtml(library.name)}</option>`).join('')}`;
}
function componentSection(node) {
  const linkedInstance = componentInstanceRoot(node.id);
  if (linkedInstance) {
    if (isLocalLinkedComponent(linkedInstance)) {
      const link = linkedInstance.linkedComponent;
      if (!hasValidLocalComponentSnapshot(linkedInstance)) {
        return section('Local component', `<div class="image-properties-note">This library link is damaged. The editable layers are still here, but this instance cannot be updated.</div><button class="add-fill" data-action="detach-local-component" data-instance-id="${escapeHtml(linkedInstance.id)}">Remove broken link and keep layers</button>`);
      }
      const library = state.componentLibraries.find(item => item.id === link.libraryId)?.library;
      const component = library?.components.find(item => item.id === link.componentId);
      const latest = component?.versions.at(-1)?.revision ?? link.sourceRevision;
      const hasUpdate = latest > link.sourceRevision;
      const updateButton = hasUpdate
        ? `<button class="add-fill" data-action="update-local-component" data-instance-id="${escapeHtml(linkedInstance.id)}">↻ Update to revision ${latest}</button>`
        : '<div class="image-properties-note">This instance is on the latest local revision. Layer edits are kept as compatible overrides.</div>';
      return section('Local component', `<div class="component-link-copy"><strong>${escapeHtml(link.sourceSnapshot.name || linkedInstance.name)}</strong><span>${escapeHtml(library?.name || 'Library unavailable')} · revision ${link.sourceRevision}${hasUpdate ? ` · revision ${latest} available` : ''}</span></div>${updateButton}<button class="add-fill" data-action="publish-local-instance" data-instance-id="${escapeHtml(linkedInstance.id)}">Publish current edits as a new revision</button><button class="add-fill" data-action="detach-local-component" data-instance-id="${escapeHtml(linkedInstance.id)}">Detach from library</button>`);
    }
    const component = state.document.components?.find(item => item.id === linkedInstance.componentId);
    const set = state.document.componentSets?.find(item => item.id === component?.componentSetId);
    const label = node.id === linkedInstance.id ? 'Linked instance · local edits remain as overrides' : 'Layer inside a linked instance · local edits remain as overrides';
    const selectors = set ? set.properties.map(property => {
      const selected = component.variantProperties?.[property.name] || '';
      const options = property.values.map(value => `<option value="${escapeHtml(value)}"${selected === value ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
      return `<label class="variant-control"><span>${escapeHtml(property.name)}</span><select class="prop-input select-field" data-variant-property="${escapeHtml(property.name)}" data-instance-id="${escapeHtml(linkedInstance.id)}" aria-label="${escapeHtml(property.name)} variant">${options}</select></label>`;
    }).join('') : '';
    const propertyControls = componentInstancePropertyControls(component, linkedInstance);
    return section('Instance', `<div class="component-link-copy"><strong>${escapeHtml(set?.name || component?.name || 'Missing component')}</strong><span>${label}</span></div>${selectors ? `<div class="variant-controls">${selectors}</div>` : ''}${propertyControls}<button class="add-fill" data-action="detach-component-instance" data-instance-id="${escapeHtml(linkedInstance.id)}">Detach instance</button>`);
  }
  if (node.isComponent) {
    const component = state.document.components?.find(item => item.id === node.componentId);
    const set = state.document.componentSets?.find(item => item.id === component?.componentSetId);
    const variantFields = set ? set.properties.map(property => `<label class="variant-control"><span>${escapeHtml(property.name)}</span><input class="prop-input" data-variant-master-property="${escapeHtml(property.name)}" data-component-id="${escapeHtml(component.id)}" value="${escapeHtml(component.variantProperties?.[property.name] || '')}" aria-label="${escapeHtml(property.name)} variant value"/></label>`).join('') : '';
    const variantLabel = set ? `Variant in ${set.name} · changes update linked instances` : 'Main component · changes update linked instances';
    const libraryPublish = `<label class="field-caption" for="component-library-target">Publish to local library</label><select id="component-library-target" class="select-field" aria-label="Target local component library">${componentLibraryOptions()}</select><button class="add-fill" data-action="publish-local-component" data-component-id="${escapeHtml(node.componentId)}">↑ Publish current revision</button>`;
    const publishedCount = (node.publishedLibraryRefs || []).length;
    return section('Component', `<div class="component-link-copy"><strong>${escapeHtml(component?.name || node.name)}</strong><span>${escapeHtml(variantLabel)}</span></div>${variantFields ? `<div class="variant-controls">${variantFields}</div>` : ''}${component ? componentPropertyDefinitions(component, node) : ''}<button class="add-fill" data-action="create-component-instance" data-component-id="${escapeHtml(node.componentId)}">＋ Create instance</button>${libraryPublish}${publishedCount ? `<div class="image-properties-note">Published in ${publishedCount} local librar${publishedCount === 1 ? 'y' : 'ies'}.</div>` : ''}`);
  }
  if (node.isInstance) {
    const component = state.document.components?.find(item => item.id === node.componentId);
    const propertyControls = componentInstancePropertyControls(component, node);
    return section('Instance', `<div class="component-link-copy"><strong>${escapeHtml(component?.name || 'Missing component')}</strong><span>Linked instance · local edits remain as overrides</span></div>${propertyControls}<button class="add-fill" data-action="detach-component-instance">Detach instance</button>`);
  }
  return section('Component', '<button class="add-fill" data-action="create-component">◇ Create component</button><div class="image-properties-note">Create a reusable main component from this layer and its children.</div>');
}
function textSection(node) {
  const fontSize = getNodePropertyValue(state.document, node, 'fontSize');
  const lineHeight = getNodePropertyValue(state.document, node, 'lineHeight');
  const letterSpacing = getNodePropertyValue(state.document, node, 'letterSpacing');
  const paragraphSpacing = node.paragraphSpacing || 0;
  const listSpacing = node.listSpacing || 0;
  const firstLineIndent = node.firstLineIndent || 0;
  const textFit = node.textFit || 'auto-height';
  const weightOptions = [[100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semi bold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']]
    .map(([weight, label]) => `<option value="${weight}"${Number(node.fontWeight || 400) === weight ? ' selected' : ''}>${label}</option>`).join('');
  const styleOptions = [['normal', 'Regular'], ['italic', 'Italic']]
    .map(([value, label]) => `<option value="${value}"${(node.fontStyle || 'normal') === value ? ' selected' : ''}>${label}</option>`).join('');
  const linkedStyle = state.document.typographyStyles?.find(style => style.id === node.typographyStyleId);
  const styleStatus = linkedStyle
    ? `<div class="image-properties-note">Text style · ${escapeHtml(linkedStyle.name)} · typography changes update this layer.</div><button class="add-fill" data-action="detach-typography-style">Detach text style</button>`
    : '';
  const body = `<div class="property-grid"><input class="prop-input select-field typography-font-family" data-prop="fontFamily" type="text" maxlength="160" list="font-family-options" value="${escapeHtml(node.fontFamily || '')}" placeholder="Font family" aria-label="Font family"/><select class="prop-input select-field" data-prop="textFit" aria-label="Text resize mode" style="grid-column:span 2"><option value="fixed"${textFit === 'fixed' ? ' selected' : ''}>Fixed size</option><option value="auto-height"${textFit === 'auto-height' ? ' selected' : ''}>Auto height</option><option value="auto-width"${textFit === 'auto-width' ? ' selected' : ''}>Auto width</option></select>${numberField('Size', 'fontSize', fontSize, 1)}<select class="prop-input select-field" data-prop="fontWeight" aria-label="Font weight">${weightOptions}</select>${numberField('Line', 'lineHeight', lineHeight, .05)}${numberField('↔', 'letterSpacing', letterSpacing || 0, .1)}${numberField('Para', 'paragraphSpacing', paragraphSpacing, 1, 0, 10000, false, 'Paragraph spacing')}${numberField('List gap', 'listSpacing', listSpacing, 1, 0, 10000, false, 'List item spacing')}${numberField('Indent', 'firstLineIndent', firstLineIndent, 1, 0, 10000, false, 'First-line indent')}<select class="prop-input select-field" data-prop="fontStyle" aria-label="Font style">${styleOptions}</select><select class="prop-input select-field" data-prop="align" aria-label="Text align"><option value="left"${node.align === 'left' ? ' selected' : ''}>Left</option><option value="center"${node.align === 'center' ? ' selected' : ''}>Center</option><option value="right"${node.align === 'right' ? ' selected' : ''}>Right</option><option value="justify"${node.align === 'justify' ? ' selected' : ''}>Justify</option></select></div><div class="image-properties-note">Use a system or locally added font; choose a family or type a name. Auto height wraps to the box width.</div>${variablePropertyBindingControl(node, 'fontSize', 'Font size')}${variablePropertyBindingControl(node, 'lineHeight', 'Line height')}${variablePropertyBindingControl(node, 'letterSpacing', 'Letter spacing')}<div style="margin-top:9px">${colorField('Text color', 'color', getNodeColor(state.document, node, 'text'), 100)}${variableBindingControl(node, 'text')}</div>${variablePropertyBindingControl(node, 'text', 'Text content')}<button class="add-fill" data-action="edit-text">Edit text content</button><button class="add-fill" data-action="create-typography-style">＋ Save text style</button>${styleStatus}<button class="add-fill" data-action="create-color-style">${node.textStyleId ? '✦ Linked text color' : '＋ Create text color style'}</button><button class="add-fill" data-action="create-color-variable" data-kind="text">＋ Create color variable</button>`;
  const textCase = ['none', 'uppercase', 'lowercase', 'capitalize'].includes(node.textCase) ? node.textCase : 'none';
  const textDecoration = ['none', 'underline', 'line-through'].includes(node.textDecoration) ? node.textDecoration : 'none';
  const verticalAlign = ['top', 'middle', 'bottom'].includes(node.verticalAlign) ? node.verticalAlign : 'top';
  const renderingControls = `<div class="property-grid"><select class="prop-input select-field" data-prop="textCase" aria-label="Text case"><option value="none"${textCase === 'none' ? ' selected' : ''}>As typed</option><option value="uppercase"${textCase === 'uppercase' ? ' selected' : ''}>UPPERCASE</option><option value="lowercase"${textCase === 'lowercase' ? ' selected' : ''}>lowercase</option><option value="capitalize"${textCase === 'capitalize' ? ' selected' : ''}>Capitalize</option></select><select class="prop-input select-field" data-prop="textDecoration" aria-label="Text decoration"><option value="none"${textDecoration === 'none' ? ' selected' : ''}>No decoration</option><option value="underline"${textDecoration === 'underline' ? ' selected' : ''}>Underline</option><option value="line-through"${textDecoration === 'line-through' ? ' selected' : ''}>Strikethrough</option></select><select class="prop-input select-field" data-prop="verticalAlign" aria-label="Vertical align"><option value="top"${verticalAlign === 'top' ? ' selected' : ''}>Top</option><option value="middle"${verticalAlign === 'middle' ? ' selected' : ''}>Middle</option><option value="bottom"${verticalAlign === 'bottom' ? ' selected' : ''}>Bottom</option></select></div>`;
  return section('Typography', body.replace('</div><div class="image-properties-note">', `</div>${renderingControls}<div class="image-properties-note">`));
}
function frameVariableModesSection(frame) {
  const collections = state.document.variableCollections || [];
  if (!collections.length) return '';
  const controls = collections.map(collection => {
    const selected = frame.variableModes?.[collection.id] || '';
    const modes = collection.modes.map(mode => `<option value="${escapeHtml(mode.id)}"${selected === mode.id ? ' selected' : ''}>${escapeHtml(mode.name)}</option>`).join('');
    return `<label class="frame-variable-mode"><span>${escapeHtml(collection.name)}</span><select class="select-field" data-frame-variable-mode="${escapeHtml(collection.id)}"><option value="">Inherit</option>${modes}</select></label>`;
  }).join('');
  return section('Variables', `${controls}<div class="image-properties-note">Nested layers use the closest frame mode override.</div>`);
}
function frameOverflowSection(frame) {
  const options = [['none', 'No scrolling'], ['vertical', 'Vertical'], ['horizontal', 'Horizontal'], ['both', 'Vertical and horizontal']];
  const selected = ['none', 'vertical', 'horizontal', 'both'].includes(frame.overflowBehavior) ? frame.overflowBehavior : 'none';
  return section('Overflow', `<select class="prop-input select-field" data-prop="overflowBehavior" aria-label="Frame overflow behavior"${frame.locked ? ' disabled' : ''}>${options.map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`).join('')}</select><div class="image-properties-note">Presentation lets users drag inside this clipped frame to reveal content beyond its edges.</div>`);
}
function inspectPanel() {
  const entries = selectedEntries();
  if (!entries.length) return '<div class="inspect-empty"><strong>Inspect design values</strong><span>Select a layer to review its page-space geometry, resolved styles, and copyable handoff data.</span></div>';
  const output = buildInspectOutput(state.document, entries);
  const number = value => Number.isFinite(Number(value)) ? String(Number(Number(value).toFixed(2))) : '0';
  const cards = output.layers.map(layer => {
    const properties = [
      ['Position', `${number(layer.position.x)}, ${number(layer.position.y)} px`],
      ['Size', `${number(layer.size.width)} × ${number(layer.size.height)} px`],
      ['Rotation', `${number(layer.rotation)}°`],
      ['Opacity', `${Math.round(layer.opacity * 100)}%`]
    ];
    if (layer.color) properties.push(['Color', `<span class="inspect-color"><i style="background:${escapeHtml(layer.color)}"></i>${escapeHtml(layer.color)}</span>`]);
    if (layer.stroke) properties.push(['Stroke', `${escapeHtml(layer.stroke.color)} · ${number(layer.stroke.width)} px`]);
    if (layer.typography) properties.push(['Type', `${number(layer.typography.fontSize)} px · ${escapeHtml(layer.typography.fontFamily || 'Arial')}`]);
    if (layer.image) properties.push(['Source', `${number(layer.image.sourceWidth || layer.size.width)} × ${number(layer.image.sourceHeight || layer.size.height)} px`]);
    if (layer.autoLayout) properties.push(['Layout', layer.autoLayout.axis === 'grid' ? `Grid · ${layer.autoLayout.columns} columns` : `${layer.autoLayout.axis} auto layout`]);
    if (layer.layout) {
      const placement = layer.layout.positioning === 'absolute' ? 'Absolute' : 'Flow';
      const sizing = layer.layout.axis === 'grid'
        ? `W ${layer.layout.sizing.width} · H ${layer.layout.sizing.height}`
        : `Main ${layer.layout.sizing.main} · Cross ${layer.layout.sizing.cross}`;
      properties.push(['Placement', `${placement} · ${layer.layout.axis} · ${sizing}`]);
      if (layer.layout.gridCell && Object.keys(layer.layout.gridCell).length) {
        const cell = layer.layout.gridCell;
        properties.push(['Grid cell', `${cell.row || 1}, ${cell.column || 1} · ${cell.rowSpan || 1} × ${cell.columnSpan || 1}`]);
      }
    }
    if (layer.constraints) properties.push(['Constraints', `${layer.constraints.horizontal} · ${layer.constraints.vertical}`]);
    return `<article class="inspect-layer-card"><header><strong>${escapeHtml(layer.name)}</strong><span>${escapeHtml(layer.type)} · ${escapeHtml(layer.parent)}</span></header><dl>${properties.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${label === 'Color' ? value : escapeHtml(value)}</dd></div>`).join('')}</dl>${layer.text ? `<div class="inspect-text-value"><span>Text content</span><p>${escapeHtml(layer.text)}</p></div>` : ''}</article>`;
  }).join('');
  const css = output.css || '/* Select a layer to generate CSS. */';
  const html = output.html || '<!-- Select a layer to generate an HTML structure. -->';
  const json = output.json || '[]';
  const jsx = output.jsx || 'export default function TinyImageStarHandoff() { return null; }';
  const vue = output.vue || '<template><!-- Select a layer to generate a Vue scaffold. --></template>\n<style></style>\n';
  return `<div class="inspect-panel"><div class="inspect-intro"><span>LOCAL HANDOFF</span><strong>${entries.length === 1 ? 'Layer values' : `${entries.length} selected layers`}</strong><small>Resolved from the current local design · positions are relative to the page</small></div><div class="inspect-layer-list">${cards}</div><section class="inspect-code-card"><header><div><strong>CSS</strong><span>Layout and style starting point</span></div><button class="inspect-copy" type="button" data-inspect-copy="css">Copy CSS</button></header><pre><code>${escapeHtml(css)}</code></pre><p>Vector paths, masks, and Boolean geometry remain exact in the layer JSON below.</p></section><section class="inspect-code-card"><header><div><strong>HTML structure</strong><span>Nested layer markup scaffold</span></div><button class="inspect-copy" type="button" data-inspect-copy="html">Copy HTML</button></header><pre><code>${escapeHtml(html)}</code></pre><p>Local image sources and vector geometry stay in the layer JSON.</p></section><section class="inspect-code-card"><header><div><strong>React component</strong><span>Ready-to-adapt JSX scaffold</span></div><button class="inspect-copy" type="button" data-inspect-copy="jsx">Copy JSX</button></header><pre><code>${escapeHtml(jsx)}</code></pre><p>Adapt this scaffold to your app; connect local images and vector or mask assets there.</p></section><section class="inspect-code-card"><header><div><strong>Vue 3 component</strong><span>Adaptable single-file component scaffold</span></div><button class="inspect-copy" type="button" data-inspect-copy="vue">Copy SFC</button></header><pre><code>${escapeHtml(vue)}</code></pre><p>Adapt this scaffold to your app; connect local images and vector or mask assets there.</p></section><section class="inspect-code-card inspect-json-card"><header><div><strong>Layer JSON</strong><span>Exact selected layer data</span></div><button class="inspect-copy" type="button" data-inspect-copy="json">Copy JSON</button></header><details><summary>View structured data</summary><pre><code>${escapeHtml(json)}</code></pre></details></section></div>`;
}
function buildPrototypeInteractionCondition() {
  const variable = state.document.variables?.find(item => item.id === state.prototypeConditionVariableId);
  if (!variable) return null;
  const rawValue = state.prototypeConditionValue ?? String(resolveVariableValue(state.document, variable.id));
  let value = String(rawValue);
  if (variable.type === 'number') {
    if (!value.trim()) throw new TypeError('Enter a valid number for the prototype condition.');
    value = Number(rawValue);
    if (!Number.isFinite(value)) throw new TypeError('Enter a valid number for the prototype condition.');
  } else if (variable.type === 'boolean') value = rawValue === 'true';
  if (variable.type === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('Choose a valid color for the prototype condition.');
  return { variableId: variable.id, type: variable.type, operator: state.prototypeConditionOperator, value };
}

function syncPrototypeConnectPrompt() {
  const prompt = $('#prototype-connect-prompt');
  const message = $('#prototype-connect-message');
  if (!prompt || !message) return;
  if (!state.prototypeSourceId) {
    prompt.hidden = true;
    canvas.removeAttribute('aria-describedby');
    return;
  }
  const verb = innerWidth <= 820 ? 'Tap' : 'Click';
  const instruction = state.prototypeAction === 'open-overlay'
    ? `${verb} a frame on this page to show as an overlay.`
    : state.prototypeAction === 'swap-overlay'
      ? `${verb} a frame on this page to swap into the overlay.`
      : `${verb} a destination frame on this page to connect.`;
  message.textContent = `${instruction} Press Escape or Cancel to stop.`;
  prompt.hidden = false;
  canvas.setAttribute('aria-describedby', message.id);
}

function clearPrototypeConnectPrompt() {
  state.prototypeSourceId = null;
  syncPrototypeConnectPrompt();
}

function clearPrototypeConnectPromptIfSourceMissing() {
  if (!state.prototypeSourceId) return false;
  const source = findNode(state.document, state.prototypeSourceId)?.node;
  if (source && source.type !== 'slice') return false;
  clearPrototypeConnectPrompt();
  return true;
}

function cancelPrototypeConnection() {
  if (!state.prototypeSourceId) return;
  clearPrototypeConnectPrompt();
  renderInspector();
  renderer?.invalidate();
  canvas.focus({ preventScroll: true });
}

function prototypeInspector() {
  const node = selectedNodes()[0] || null;
  const nodeInteractions = node?.interactions || [];
  if (node?.type === 'slice') {
    const legacyInteractions = nodeInteractions.map(interaction => `<div class="prototype-interaction-row"><span class="prototype-interaction-copy"><strong>Unavailable slice interaction</strong><small>Slices are export regions and cannot trigger prototype actions.</small></span><button class="tiny-icon-button" type="button" data-action="remove-prototype-interaction" data-interaction-id="${escapeHtml(interaction.id)}" aria-label="Remove unavailable slice interaction" title="Remove unavailable slice interaction">×</button></div>`).join('');
    return `<div class="prototype-inspector"><section class="prototype-section"><div class="prototype-section-label">Prototype</div><p class="prototype-hint">Slices define export regions. Select a frame or artwork layer to add prototype interactions.</p>${legacyInteractions}</section></div>`;
  }
  const editingInteraction = nodeInteractions.find(interaction => interaction.id === state.prototypeEditingInteractionId) || null;
  if (state.prototypeEditingInteractionId && !editingInteraction) {
    state.prototypeEditingInteractionId = null;
    state.prototypeDestinationId = null;
  }
  const entry = node ? findNode(state.document, node.id) : null;
  const frame = node?.type === 'frame' ? node : [...(entry?.parents || [])].reverse().find(parent => parent.type === 'frame');
  const presentationFrame = frame;
  const scrollTargets = [];
  if (presentationFrame) walkNodes(presentationFrame.children || [], ({ node: target, parents }) => {
    if (target.id === node?.id || ![presentationFrame, ...parents].some(parent => parent.type === 'frame' && ['vertical', 'horizontal', 'both'].includes(parent.overflowBehavior))) return;
    scrollTargets.push(target);
  });
  const editingScrollTargetId = editingInteraction?.action === 'scroll-to' ? editingInteraction.scrollTargetId : null;
  const selectedScrollTarget = scrollTargets.find(target => target.id === state.prototypeScrollTargetId)
    || scrollTargets.find(target => target.id === editingScrollTargetId)
    || scrollTargets[0]
    || null;
  const variantSourceComponent = node?.isInstance ? state.document.components?.find(item => item.id === node.componentId) : null;
  const variantSourceSet = variantSourceComponent?.componentSetId && state.document.componentSets?.find(item => item.id === variantSourceComponent.componentSetId);
  const variantTargets = (variantSourceSet?.componentIds || []).map(id => state.document.components?.find(item => item.id === id)).filter(item => item && item.id !== variantSourceComponent?.id);
  const selectedVariantTarget = variantTargets.find(item => item.id === state.prototypeVariantTargetId) || variantTargets[0] || null;
  const start = getPrototypeStartFrame(state.document, node?.id);
  const flows = listPrototypeFlows(state.document);
  const selectedFlow = flows.find(flow => flow.id === state.document.prototypeStartFlowId) || flows[0] || null;
  const flowControls = `<div class="prototype-flow-controls"><label>Prototype flow<select class="select-field" id="prototype-flow-select" aria-label="Select prototype flow"><option value=""${selectedFlow ? '' : ' selected'}>No saved flows</option>${flows.map(flow => `<option value="${escapeHtml(flow.id)}"${flow.id === selectedFlow?.id ? ' selected' : ''}>${escapeHtml(flow.name)}</option>`).join('')}</select></label><div class="prototype-flow-actions"><button class="secondary-button" type="button" data-action="prototype-create-flow"${frame || start ? '' : ' disabled'}>＋ New flow</button><button class="secondary-button" type="button" data-action="prototype-rename-flow"${selectedFlow ? '' : ' disabled'}>Rename</button><button class="secondary-button" type="button" data-action="prototype-delete-flow"${selectedFlow ? '' : ' disabled'}>Delete</button></div></div>`;
  const startBody = frame
    ? `<div class="prototype-current-frame"><span>${escapeHtml(frame.name)}</span><button class="secondary-button" data-action="prototype-start"${selectedFlow ? '' : ' disabled'}>${selectedFlow?.pageId === state.document.activePageId && selectedFlow?.nodeId === frame.id ? 'Starting point' : 'Set as starting point'}</button></div>`
    : `<p class="prototype-hint">${start ? `Present starts at “${escapeHtml(start.frame.name)}”.` : 'Create a frame to make a prototype.'}</p>`;
  const interactions = nodeInteractions.map(interaction => {
    const target = interaction.destinationId ? findNode(state.document, interaction.destinationId, interaction.destinationPageId)?.node : null;
    const scrollTarget = interaction.action === 'scroll-to' ? findNode(state.document, interaction.scrollTargetId, state.document.activePageId)?.node : null;
    const targetPage = interaction.destinationPageId ? state.document.pages.find(page => page.id === interaction.destinationPageId) : null;
    const variableCollection = state.document.variableCollections?.find(collection => collection.id === interaction.collectionId);
    const variableMode = variableCollection?.modes.find(mode => mode.id === interaction.modeId);
    const targetVariant = interaction.action === 'change-variant' ? state.document.components?.find(item => item.id === interaction.targetVariantId) : null;
    const actionLabel = interaction.action === 'open-overlay' ? `Open overlay · ${interaction.overlayPosition || 'center'}` : interaction.action === 'swap-overlay' ? 'Swap overlay' : interaction.action === 'close-overlay' ? 'Close overlay' : interaction.action === 'back' ? 'Back' : interaction.action === 'open-link' ? 'Open link' : interaction.action === 'set-variable-mode' ? `Set ${variableCollection?.name || 'variable mode'}` : interaction.action === 'change-variant' ? 'Change variant' : interaction.action === 'scroll-to' ? `Scroll to · ${interaction.scrollAlignment || 'nearest'}` : 'Navigate to';
    const triggerLabel = interaction.trigger === 'while-hovering' ? 'While hovering' : interaction.trigger === 'after-delay' ? `After ${(interaction.delay / 1000).toFixed(1)} s` : interaction.trigger === 'on-press' ? 'On press / touch down' : interaction.trigger === 'on-drag' ? 'On drag' : 'On click / tap';
    const destinationLabel = target ? `${target.name} · ${targetPage?.name || 'Page'}` : interaction.action === 'scroll-to' ? (scrollTarget?.name || 'Missing scroll target') : interaction.action === 'change-variant' ? `${targetVariant?.name || 'Missing variant'} · ${variantSourceSet?.name || 'Component set'}` : interaction.action === 'close-overlay' ? 'Current overlay' : interaction.action === 'back' ? 'Previous screen' : interaction.action === 'open-link' ? interaction.url : interaction.action === 'set-variable-mode' ? `${variableMode?.name || 'Missing mode'} · ${variableCollection?.name || 'Missing collection'}` : 'Missing frame';
    const conditionVariable = interaction.condition && state.document.variables?.find(item => item.id === interaction.condition.variableId);
    const conditionOperatorText = {
      equals: 'is', 'not-equals': 'is not', 'greater-than': 'is greater than',
      'greater-than-or-equal': 'is at least', 'less-than': 'is less than', 'less-than-or-equal': 'is at most'
    }[interaction.condition?.operator] || 'is';
    const conditionLabel = conditionVariable ? ` · If ${conditionVariable.name} ${conditionOperatorText} ${String(interaction.condition.value)}` : '';
    const selected = interaction.id === state.prototypeEditingInteractionId;
    return `<div class="prototype-interaction-row${selected ? ' is-editing' : ''}"><span class="prototype-interaction-icon">${interaction.action === 'close-overlay' ? '×' : interaction.action === 'back' ? '←' : interaction.action === 'open-overlay' || interaction.action === 'swap-overlay' ? '▱' : interaction.action === 'scroll-to' ? '↓' : '↗'}</span><span class="prototype-interaction-copy"><strong>${escapeHtml(triggerLabel)} · ${escapeHtml(actionLabel)}</strong><small>${escapeHtml(destinationLabel)}${interaction.transition && interaction.transition !== 'instant' ? ` · ${escapeHtml(interaction.easing || 'ease-in-out')}` : ''}${escapeHtml(conditionLabel)}</small></span><button class="prototype-edit-button" type="button" data-action="edit-prototype-interaction" data-interaction-id="${escapeHtml(interaction.id)}" aria-label="Edit ${escapeHtml(triggerLabel)} ${escapeHtml(actionLabel)} interaction">${selected ? 'Editing' : 'Edit'}</button><button class="tiny-icon-button" data-action="remove-prototype-interaction" data-interaction-id="${escapeHtml(interaction.id)}" aria-label="Remove interaction" title="Remove interaction">×</button></div>`;
  }).join('');
  const needsDestination = ['navigate', 'open-overlay', 'swap-overlay'].includes(state.prototypeAction);
  const needsScrollTarget = state.prototypeAction === 'scroll-to' && !selectedScrollTarget;
  const connectState = !editingInteraction && state.prototypeSourceId === node?.id ? `<div class="prototype-connect-hint">${state.prototypeAction === 'open-overlay' ? 'Click the frame to show as an overlay.' : state.prototypeAction === 'swap-overlay' ? 'Click the frame to swap into the overlay.' : 'Click a destination frame on the canvas.'} Press Escape to cancel.</div>` : '';
  const overlayControls = state.prototypeAction === 'open-overlay' ? `<label>Position<select id="prototype-overlay-position" class="select-field">${[['center','Center'],['top-left','Top left'],['top-center','Top center'],['top-right','Top right'],['left-center','Left center'],['right-center','Right center'],['bottom-left','Bottom left'],['bottom-center','Bottom center'],['bottom-right','Bottom right']].map(([value, label]) => `<option value="${value}"${state.prototypeOverlayPosition === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label><span>Dismiss on outside click</span><input id="prototype-overlay-outside" type="checkbox"${state.prototypeOverlayOutsideClick ? ' checked' : ''}/></label><label><span>Show background</span><input id="prototype-overlay-background" type="checkbox"${state.prototypeOverlayBackground ? ' checked' : ''}/></label>${state.prototypeOverlayBackground ? `<label>Background<input id="prototype-overlay-color" type="color" value="${state.prototypeOverlayBackgroundColor}"/><input id="prototype-overlay-opacity" type="range" min="0" max="100" value="${Math.round(state.prototypeOverlayBackgroundOpacity * 100)}" aria-label="Overlay background opacity"/></label>` : ''}` : '';
  const transitionChoices = state.prototypeAction === 'scroll-to'
    ? [['instant', 'Instant'], ['scroll', 'Animated scroll']]
    : [['instant', 'Instant'], ['dissolve', 'Dissolve'], ['move-left', 'Move in · left'], ['move-right', 'Move in · right'], ...(state.prototypeAction === 'navigate' ? [['smart-animate', 'Smart animate']] : [])];
  const transitionOptions = transitionChoices
    .map(([value, label]) => `<option value="${value}"${state.prototypeTransition === value ? ' selected' : ''}>${label}</option>`).join('');
  const easingOptions = [['ease-in-out', 'Ease in and out'], ['linear', 'Linear'], ['ease-in', 'Ease in'], ['ease-out', 'Ease out']]
    .map(([value, label]) => `<option value="${value}"${state.prototypeEasing === value ? ' selected' : ''}>${label}</option>`).join('');
  const easingControl = state.prototypeTransition === 'instant' ? '' : `<label>Easing<select id="prototype-easing" class="select-field">${easingOptions}</select></label>`;
  const hasTimedTransition = needsDestination || state.prototypeAction === 'scroll-to';
  const variableCollections = state.document.variableCollections || [];
  const canUseDelayTrigger = ['navigate', 'open-overlay', 'swap-overlay'].includes(state.prototypeAction);
  const triggerOptions = `<option value="on-click"${state.prototypeTrigger === 'on-click' ? ' selected' : ''}>On click / tap</option><option value="on-press"${state.prototypeTrigger === 'on-press' ? ' selected' : ''}>On press / touch down</option><option value="on-drag"${state.prototypeTrigger === 'on-drag' ? ' selected' : ''}>On drag</option><option value="while-hovering"${state.prototypeTrigger === 'while-hovering' ? ' selected' : ''}>While hovering</option>${canUseDelayTrigger ? `<option value="after-delay"${state.prototypeTrigger === 'after-delay' ? ' selected' : ''}>After delay</option>` : ''}`;
  const conditionVariables = state.document.variables || [];
  const conditionVariable = conditionVariables.find(variable => variable.id === state.prototypeConditionVariableId) || null;
  const rawConditionValue = conditionVariable
    ? state.prototypeConditionValue ?? String(resolveVariableValue(state.document, conditionVariable.id))
    : '';
  const conditionValueControl = conditionVariable?.type === 'boolean'
    ? `<select id="prototype-condition-value" class="select-field" aria-label="Condition value"><option value="true"${rawConditionValue === 'true' ? ' selected' : ''}>True</option><option value="false"${rawConditionValue === 'false' ? ' selected' : ''}>False</option></select>`
    : conditionVariable?.type === 'color'
      ? `<input id="prototype-condition-value" type="color" value="${/^#[0-9a-f]{6}$/i.test(rawConditionValue) ? escapeHtml(rawConditionValue) : '#000000'}" aria-label="Condition color"/>`
      : conditionVariable?.type === 'number'
        ? `<input id="prototype-condition-value" class="text-input" type="number" step="any" value="${escapeHtml(rawConditionValue)}" aria-label="Condition number"/>`
        : conditionVariable
          ? `<input id="prototype-condition-value" class="text-input" type="text" value="${escapeHtml(rawConditionValue)}" aria-label="Condition text"/>`
          : '';
  const supportedConditionOperators = [
    ['equals', 'Equals'], ['not-equals', 'Does not equal'],
    ...(conditionVariable?.type === 'number' ? [
      ['greater-than', 'Greater than'], ['greater-than-or-equal', 'Greater than or equal to'],
      ['less-than', 'Less than'], ['less-than-or-equal', 'Less than or equal to']
    ] : [])
  ];
  if (conditionVariable && !supportedConditionOperators.some(([operator]) => operator === state.prototypeConditionOperator)) state.prototypeConditionOperator = 'equals';
  const conditionControls = `<label>Only if variable<select id="prototype-condition-variable" class="select-field"><option value=""${conditionVariable ? '' : ' selected'}>Always</option>${conditionVariables.map(variable => `<option value="${escapeHtml(variable.id)}"${variable.id === conditionVariable?.id ? ' selected' : ''}>${escapeHtml(variable.name)} · ${escapeHtml(variable.type)}</option>`).join('')}</select></label>${conditionVariable ? `<label>Condition<select id="prototype-condition-operator" class="select-field">${supportedConditionOperators.map(([operator, label]) => `<option value="${operator}"${state.prototypeConditionOperator === operator ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label>Value${conditionValueControl}</label>` : ''}`;
  const prototypeCollection = variableCollections.find(collection => collection.id === state.prototypeVariableCollectionId) || variableCollections[0] || null;
  const prototypeModes = prototypeCollection?.modes || [];
  const selectedPrototypeMode = prototypeModes.find(mode => mode.id === state.prototypeVariableModeId) || defaultVariableMode(prototypeCollection);
  const variableModeControls = state.prototypeAction === 'set-variable-mode'
    ? prototypeCollection
      ? `<label>Collection<select id="prototype-variable-collection" class="select-field">${variableCollections.map(collection => `<option value="${escapeHtml(collection.id)}"${collection.id === prototypeCollection.id ? ' selected' : ''}>${escapeHtml(collection.name)}</option>`).join('')}</select></label><label>Mode<select id="prototype-variable-mode" class="select-field">${prototypeModes.map(mode => `<option value="${escapeHtml(mode.id)}"${mode.id === selectedPrototypeMode?.id ? ' selected' : ''}>${escapeHtml(mode.name)}</option>`).join('')}</select></label>`
      : '<p class="prototype-hint">Create a variable collection and modes before adding this action.</p>'
    : '';
  const variantControls = state.prototypeAction === 'change-variant'
    ? variantTargets.length
      ? `<label>Change this instance to<select id="prototype-variant-target" class="select-field" aria-label="Target component variant">${variantTargets.map(item => `<option value="${escapeHtml(item.id)}"${item.id === selectedVariantTarget?.id ? ' selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(Object.entries(item.variantProperties || {}).map(([name, value]) => `${name}=${value}`).join(', '))}</option>`).join('')}</select></label>`
      : '<p class="prototype-hint">Select a linked component instance in a variant set to add this action.</p>'
    : '';
  const needsVariantTarget = state.prototypeAction === 'change-variant' && !selectedVariantTarget;
  const scrollToControls = state.prototypeAction === 'scroll-to'
    ? selectedScrollTarget
      ? `<label>Scroll to layer<select id="prototype-scroll-target" class="select-field" aria-label="Scroll target layer">${scrollTargets.map(target => `<option value="${escapeHtml(target.id)}"${target.id === selectedScrollTarget.id ? ' selected' : ''}>${escapeHtml(target.name)}</option>`).join('')}</select></label><label>Alignment<select id="prototype-scroll-alignment" class="select-field" aria-label="Scroll target alignment">${[['nearest','Nearest visible edge'],['start','Align to start'],['center','Center in viewport'],['end','Align to end']].map(([value, label]) => `<option value="${value}"${value === (editingInteraction?.scrollAlignment || state.prototypeScrollAlignment) ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`
      : '<p class="prototype-hint">Add a scrollable frame, then choose one of its layers as the target.</p>'
    : '';
  const destinationFrames = listPrototypeFrames(state.document);
  const destinationControl = editingInteraction && needsDestination
    ? `<label>Destination<select id="prototype-destination" class="select-field" aria-label="Prototype destination"><option value="" disabled${state.prototypeDestinationId ? '' : ' selected'}>Choose a frame</option>${destinationFrames.map(({ page, frame }) => `<option value="${escapeHtml(frame.id)}"${frame.id === state.prototypeDestinationId ? ' selected' : ''}>${escapeHtml(page.name)} · ${escapeHtml(frame.name)}</option>`).join('')}</select></label>`
    : '';
  const actionButtonLabel = editingInteraction ? 'Save interaction' : `＋ Add ${state.prototypeAction === 'navigate' ? 'interaction' : state.prototypeAction.replace('-', ' ')}`;
  const controls = node ? `<div class="prototype-controls"><label>Trigger<select id="prototype-trigger" class="select-field">${triggerOptions}</select></label><label>Action<select id="prototype-action" class="select-field"><option value="navigate"${state.prototypeAction === 'navigate' ? ' selected' : ''}>Navigate to</option><option value="open-overlay"${state.prototypeAction === 'open-overlay' ? ' selected' : ''}>Open overlay</option><option value="swap-overlay"${state.prototypeAction === 'swap-overlay' ? ' selected' : ''}>Swap overlay</option><option value="scroll-to"${state.prototypeAction === 'scroll-to' ? ' selected' : ''}>Scroll to layer</option><option value="close-overlay"${state.prototypeAction === 'close-overlay' ? ' selected' : ''}>Close overlay</option><option value="back"${state.prototypeAction === 'back' ? ' selected' : ''}>Back</option><option value="open-link"${state.prototypeAction === 'open-link' ? ' selected' : ''}>Open link</option><option value="set-variable-mode"${state.prototypeAction === 'set-variable-mode' ? ' selected' : ''}>Set variable mode</option><option value="change-variant"${state.prototypeAction === 'change-variant' ? ' selected' : ''}>Change to variant</option></select></label>${destinationControl}${conditionControls}${variableModeControls}${variantControls}${scrollToControls}${state.prototypeAction === 'open-link' ? `<label>URL<input id="prototype-url" class="text-input" type="url" value="${escapeHtml(state.prototypeUrl)}" placeholder="https://example.com or mailto:hello@example.com" /></label>` : ''}${state.prototypeTrigger === 'after-delay' && canUseDelayTrigger ? `<label>Wait <span id="prototype-delay-value">${(state.prototypeDelay / 1000).toFixed(1)} s</span><input id="prototype-delay" type="range" min="100" max="10000" step="100" value="${state.prototypeDelay}" aria-label="After-delay trigger wait" /></label>` : ''}${hasTimedTransition ? `<label>Transition<select id="prototype-transition" class="select-field">${transitionOptions}</select></label>${easingControl}<label>Duration <span id="prototype-duration-value">${(state.prototypeDuration / 1000).toFixed(1)} s</span><input id="prototype-duration" type="range" min="0" max="2000" step="100" value="${state.prototypeDuration}" /></label>${overlayControls}` : ''}<div class="prototype-action-buttons"><button class="primary-button prototype-add-link" data-action="prototype-connect"${(state.prototypeAction === 'set-variable-mode' && !prototypeCollection) || needsVariantTarget || needsScrollTarget ? ' disabled' : ''}>${escapeHtml(actionButtonLabel)}</button>${editingInteraction ? '<button class="secondary-button" type="button" data-action="cancel-prototype-interaction-edit">Cancel</button>' : ''}</div>${connectState}</div>` : '<p class="prototype-hint">Select a layer to add an interaction, or choose a frame above to set the starting point.</p>';
  const sourceLabel = node ? `<div class="prototype-section-label">${escapeHtml(node.name)} interactions</div>${interactions || '<div class="prototype-empty-links">No interactions yet</div>'}` : '';
  return `<div class="prototype-inspector"><section class="prototype-section"><div class="prototype-section-label">Prototype flows</div>${flowControls}${startBody}<button class="primary-button prototype-present-button" data-action="present">▶ Present${selectedFlow ? ` · ${escapeHtml(selectedFlow.name)}` : ''}</button></section>${node ? `<section class="prototype-section">${sourceLabel}${controls}</section>` : ''}<section class="prototype-section prototype-help"><strong>Prototype links</strong><span>Connect layers to frames, or add a variant action to a component instance. Variable modes and component variants change only the active presentation.</span></section></div>`;
}

function pageComments(pageId = activePage()?.id) {
  return (state.document.comments || []).filter(comment => comment.pageId === pageId);
}

function commentTimestamp(timestamp) {
  try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp); }
  catch { return 'Saved locally'; }
}

function commentPanel() {
  const comments = pageComments();
  const active = comments.find(comment => comment.id === state.activeCommentId);
  const ordered = [...comments].sort((a, b) => a.createdAt - b.createdAt);
  const numberById = new Map(ordered.map((comment, index) => [comment.id, index + 1]));
  const composer = (replyTo = null) => `<form class="comment-compose" data-comment-form="${replyTo ? 'reply' : 'new'}"${replyTo ? ` data-thread-id="${escapeHtml(replyTo)}"` : ''}><label for="comment-draft">${replyTo ? 'Write a reply' : 'Add a comment'}</label><textarea id="comment-draft" maxlength="4000" rows="3" placeholder="Share a clear note…" required></textarea><div class="comment-compose-actions"><span>Saved with this design</span><div>${replyTo ? '' : '<button class="secondary-button" type="button" data-comment-action="cancel">Cancel</button>'}<button class="primary-button" type="submit">${replyTo ? 'Reply' : 'Post comment'}</button></div></div></form>`;
  const newDraft = state.pendingCommentAnchor ? `<div class="comment-anchor-hint">New comment at ${Math.round(state.pendingCommentAnchor.x)}, ${Math.round(state.pendingCommentAnchor.y)} px</div>${composer()}` : '';
  if (active) {
    const messages = active.messages.map(message => `<article class="comment-message"><header><strong>${escapeHtml(message.author)}</strong><time>${escapeHtml(commentTimestamp(message.createdAt))}</time></header><p>${escapeHtml(message.text)}</p></article>`).join('');
    return `<div class="comments-panel"><header class="comments-panel-header"><div><strong>Comment ${numberById.get(active.id)}</strong><span>${active.resolved ? 'Resolved · saved in this file' : 'Saved in this file on this device'}</span></div><button class="comment-text-button" data-comment-action="back">All comments</button></header>${messages}<div class="comment-thread-actions"><button class="secondary-button" data-comment-action="resolve" data-thread-id="${escapeHtml(active.id)}">${active.resolved ? 'Reopen thread' : 'Resolve thread'}</button><button class="comment-delete-button" data-comment-action="delete" data-thread-id="${escapeHtml(active.id)}" aria-label="Delete comment thread">Delete</button></div>${composer(active.id)}</div>`;
  }
  const visible = [...comments].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
  const rows = visible.map(comment => {
    const first = comment.messages[0];
    const preview = first.text.length > 82 ? `${first.text.slice(0, 79)}…` : first.text;
    return `<button class="comment-thread-row${comment.resolved ? ' is-resolved' : ''}" data-comment-action="open" data-thread-id="${escapeHtml(comment.id)}"><span class="comment-mini-pin">${numberById.get(comment.id)}</span><span class="comment-row-copy"><strong>${escapeHtml(preview)}</strong><small>${comment.messages.length} message${comment.messages.length === 1 ? '' : 's'} · ${comment.resolved ? 'Resolved' : commentTimestamp(comment.updatedAt)}</small></span><span class="comment-row-arrow">›</span></button>`;
  }).join('');
  const overflow = comments.length > visible.length ? `<p class="comment-list-limit">Showing the latest 100 of ${comments.length} threads on this page.</p>` : '';
  const empty = comments.length || state.pendingCommentAnchor ? '' : '<div class="comments-empty"><span>◌</span><strong>No comments on this page</strong><p>Choose Comment, then tap a spot on the canvas to leave a note.</p></div>';
  return `<div class="comments-panel"><header class="comments-panel-header"><div><strong>Review notes</strong><span>Stored locally with this design</span></div><button class="comment-new-button" data-comment-action="new">＋ Comment</button></header>${newDraft}${empty}<div class="comment-thread-list">${rows}</div>${overflow}</div>`;
}

function setInspectorTab(tab) {
  state.inspectorTab = tab;
  if (tab !== 'prototype') clearPrototypeConnectPrompt();
  syncInspectorTabAccessibility(tab);
  renderInspector();
  renderer?.invalidate();
}

function syncInspectorTabAccessibility(selectedTab = state.inspectorTab) {
  let selected = null;
  $$('.inspector-tab').forEach(item => {
    const active = item.dataset.inspectorTab === selectedTab;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    if (active) selected = item;
  });
  if (selected?.id) $('#inspector-content')?.setAttribute('aria-labelledby', selected.id);
}

function syncSidebarTabAccessibility(selectedTab = state.sidebarTab) {
  $$('.sidebar-tab').forEach(item => {
    const active = item.dataset.sidebarTab === selectedTab;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
  });
  $('#layers-section').hidden = selectedTab !== 'layers';
  $('#assets-section').hidden = selectedTab !== 'assets';
}

function beginCommentAt(point) {
  const page = activePage();
  if (!page) return;
  state.pendingCommentAnchor = { pageId: page.id, x: point.x, y: point.y };
  state.activeCommentId = null;
  setInspectorTab('comments');
  if (innerWidth <= 820 && !$('#right-panel').classList.contains('is-open')) toggleMobilePanel('right');
  requestAnimationFrame(() => $('#comment-draft')?.focus());
}

function openCommentThread(threadId) {
  const comment = pageComments().find(item => item.id === threadId);
  if (!comment) return;
  state.pendingCommentAnchor = null;
  state.activeCommentId = threadId;
  state.panX = canvas.clientWidth / 2 - comment.x * state.zoom;
  state.panY = canvas.clientHeight / 2 - comment.y * state.zoom;
  setInspectorTab('comments');
  if (innerWidth <= 820 && !$('#right-panel').classList.contains('is-open')) toggleMobilePanel('right');
}

function handleCommentAction(button) {
  const action = button.dataset.commentAction;
  const threadId = button.dataset.threadId;
  if (action === 'new') {
    state.pendingCommentAnchor = null;
    state.activeCommentId = null;
    setTool('comment');
    setInspectorTab('comments');
    showToast('Tap a point on the canvas to add a comment.');
  } else if (action === 'open') openCommentThread(threadId);
  else if (action === 'back') { state.activeCommentId = null; state.pendingCommentAnchor = null; renderInspector(); }
  else if (action === 'cancel') { state.pendingCommentAnchor = null; renderInspector(); }
  else if (action === 'resolve') {
    const comment = pageComments().find(item => item.id === threadId);
    if (!comment) return;
    checkpoint(comment.resolved ? 'Reopen comment thread' : 'Resolve comment thread');
    setCommentResolved(state.document, threadId, !comment.resolved);
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'delete') {
    if (!pageComments().some(item => item.id === threadId)) return;
    if (!confirm('Delete this comment thread from the local design?')) return;
    checkpoint('Delete comment thread'); removeCommentThread(state.document, threadId);
    state.activeCommentId = null; renderInspector(); queueSave(); renderer.invalidate();
  }
}

function submitCommentForm(form) {
  const textarea = form.querySelector('textarea');
  const text = textarea?.value.trim();
  if (!text) { textarea?.focus(); return; }
  try {
    if (form.dataset.commentForm === 'new') {
      if ((state.document.comments || []).length >= 10_000) { showToast('This design has reached the 10,000 comment thread limit.'); return; }
      const anchor = state.pendingCommentAnchor;
      if (!anchor || !state.document.pages.some(page => page.id === anchor.pageId)) { showToast('Choose a point on the canvas before posting.'); return; }
      checkpoint('Add comment');
      const thread = createCommentThread(state.document, { ...anchor, text });
      state.pendingCommentAnchor = null; state.activeCommentId = thread.id;
    } else {
      const threadId = form.dataset.threadId;
      checkpoint('Reply to comment');
      addCommentReply(state.document, threadId, text);
    }
    renderInspector(); queueSave(); renderer.invalidate();
  } catch (error) { showToast(error.message || 'Could not save this comment.'); }
}

function renderInspector() {
  const content = $('#inspector-content');
  if (state.inspectorTab !== 'design') {
    if (state.inspectorTab === 'prototype') { content.innerHTML = prototypeInspector(); return; }
    if (state.inspectorTab === 'inspect') { content.innerHTML = inspectPanel(); return; }
    if (state.inspectorTab === 'comments') { content.innerHTML = commentPanel(); return; }
    content.innerHTML = '<div class="prototype-placeholder">Choose a properties tab.</div>';
    return;
  }
  const entries = selectedEntries();
  if (!entries.length) {
    const page = activePage();
    content.innerHTML = `<div class="inspector-empty"><div class="empty-layer-icon">✣</div><strong>Nothing selected</strong><span>Choose a layer or create something on the canvas. Everything is saved locally as you work.</span></div>${section('Page', `<div class="property-heading" style="font-weight:400;color:#777">${escapeHtml(page?.name || 'Page 1')}</div><button class="add-fill" data-action="create-frame">＋ Create a frame</button>`)}`;
    return;
  }
  if (entries.length > 1) {
    const containsSlice = entries.some(entry => entry.node.type === 'slice');
    const imageCount = entries.filter(entry => entry.node.type === 'image').length;
    const activeImageBatchSelected = entries.some(entry => entry.node.type === 'image' && isActiveImageRecipeTarget(entry.node.id));
    const alignments = [['left', 'Left'], ['center-x', 'Center X'], ['right', 'Right'], ['distribute-horizontal', 'H space'], ['top', 'Top'], ['center-y', 'Center Y'], ['bottom', 'Bottom'], ['distribute-vertical', 'V space']];
    const controls = alignments.map(([mode, label]) => `<button class="multi-align-button" type="button" data-action="align-selection" data-align-mode="${mode}" aria-label="${label === 'H space' ? 'Distribute horizontally' : label === 'V space' ? 'Distribute vertically' : `Align ${label.toLowerCase()}`}" title="${label === 'H space' ? 'Distribute horizontally' : label === 'V space' ? 'Distribute vertically' : `Align ${label.toLowerCase()}`}"${canAlignLayers(state.document, state.selectedIds, mode) ? '' : ' disabled'}>${label}</button>`).join('');
    const transformEntries = transformEntriesForSelection();
    const bounds = selectionBounds(transformEntries);
    const canTransform = !containsSlice && canTransformSelectionTogether(transformEntries);
    const movementBlock = selectionInspectorMovementBlock(transformEntries);
    const isLocked = transformEntries.some(({ node, ancestors }) => node.locked || ancestors.some(parent => parent.locked));
    const commonValue = values => values.every(value => Math.abs(value - values[0]) < 1e-6) ? values[0] : null;
    const rotations = transformEntries.map(({ node }) => Number(node.rotation) || 0);
    const opacities = transformEntries.map(({ node }) => Number(getNodePropertyValue(state.document, node, 'opacity') ?? 1) * 100);
    const rotation = commonValue(rotations);
    const opacity = commonValue(opacities);
    const hugWidth = selectionDimensionIsHugged(transformEntries, 'width');
    const hugHeight = selectionDimensionIsHugged(transformEntries, 'height');
    const transformNote = movementBlock === 'auto-layout'
      ? 'Auto layout controls these positions. Change spacing or alignment in the parent frame.'
      : movementBlock === 'locked' || isLocked
        ? 'Unlock every selected layer and its parent before editing shared properties.'
        : movementBlock === 'shared-position-variable'
          ? 'Position is controlled by a variable. Unbind it before moving the selection.'
          : !canTransform
            ? 'Some selected geometry is variable-bound or managed by auto layout.'
            : hugWidth || hugHeight
              ? `Position and size use page-space visual bounds. Auto layout Hug controls ${[hugWidth && 'width', hugHeight && 'height'].filter(Boolean).join(' and ')}; edit its sizing mode first.`
              : 'Position and size use page-space visual bounds. Mixed angle or opacity displays as Mixed; editing either sets that value on every selected layer.';
    const selectionFields = `${selectionNumberField('X', 'x', bounds.x, { disabled: Boolean(movementBlock) })}${selectionNumberField('Y', 'y', bounds.y, { disabled: Boolean(movementBlock) })}${selectionNumberField('W', 'width', bounds.width, { min: 1, max: 100_000, disabled: !canTransform || hugWidth || bounds.width <= 0 })}${selectionNumberField('H', 'height', bounds.height, { min: 1, max: 100_000, disabled: !canTransform || hugHeight || bounds.height <= 0 })}${selectionNumberField('Angle', 'rotation', rotation, { disabled: !canTransform, mixed: rotation == null })}${selectionNumberField('Opacity', 'opacity', opacity, { min: 0, max: 100, disabled: isLocked || containsSlice, mixed: opacity == null })}`;
    const alignNote = entries.some(entry => entry.parent?.autoLayout) ? 'Auto layout controls child positions; change spacing or alignment in the parent frame.' : 'Align uses visual bounds. Distribute needs at least three sibling layers.';
    content.innerHTML = `<div class="multi-selection-card"><strong>${entries.length} layers selected</strong><span>${imageCount ? `${imageCount} image${imageCount === 1 ? '' : 's'} in selection. Saved recipes apply to image layers only.` : 'Use the Layers panel to change their order.'}</span></div>${imageCount ? selectionImageRecipesSection(imageCount) : ''}${containsSlice ? '' : effectStylesSection({ canSave: false })}${section('Align & distribute', `<div class="multi-align-controls">${controls}</div><div class="image-properties-note">${alignNote}</div>`)}${section('Selection', `<div class="property-grid multi-selection-property-grid">${selectionFields}</div><div class="image-properties-note">${containsSlice ? 'Slice position can move with alignment, but resize and angle edits are available only when the slice is selected by itself.' : transformNote}</div>`)}`;
    if (activeImageBatchSelected) {
      const note = document.createElement('div');
      note.className = 'image-properties-note image-batch-edit-lock';
      note.textContent = 'Selected images are in the active recipe batch. Inspector controls unlock after the batch finishes.';
      content.prepend(note);
      for (const control of content.querySelectorAll('input, select, textarea, button')) control.disabled = true;
    }
    return;
  }
  const node = entries[0].node;
  if (node.type === 'slice') {
    content.innerHTML = `${slicePositionSection(node)}${exportSettingsSection(node)}`;
    return;
  }
  let body = componentSection(node) + transformSection(node) + blendingSection(node);
  if (node.type === 'image' && isActiveImageRecipeTarget(node.id)) {
    body = `<div class="image-properties-note image-batch-edit-lock">This image is in the active recipe batch. Manual edits remain available, and newer edits replace stale batch previews.</div>${body}`;
  }
  if (node.type === 'boolean') {
    const operations = [['union', 'Union'], ['subtract', 'Subtract'], ['intersect', 'Intersect'], ['exclude', 'Exclude']];
    body += section('Boolean', `<select class="prop-input select-field" data-prop="operation" aria-label="Boolean operation">${operations.map(([value, label]) => `<option value="${value}"${node.operation === value ? ' selected' : ''}>${label}</option>`).join('')}</select><button class="add-fill" data-action="separate-boolean" style="margin-top:8px">Separate Boolean</button><button class="add-fill" data-action="bake-boolean" style="margin-top:8px">Bake to vector path</button><div class="image-properties-note">Baking preserves supported cubic Bézier paths and rounded rectangles as editable curves; ellipses use bounded-error cubic approximation. Open or non-manifold vector networks, tangent or ambiguous intersections, transparency, mode-bound geometry, and blended operands are refused with an explanation.</div>`);
  }
  if (node.type === 'group' && node.mask) {
    const maskSource = node.children.find(child => child.id === node.maskSourceId);
    body += section('Mask', `<div class="image-properties-note">${escapeHtml(maskSource?.name || 'Vector shape')} masks the editable layers inside this group.</div><button class="add-fill" data-action="release-mask">Release mask</button>`);
  }
  if (node.type === 'text') body += textSection(node);
  if (node.type === 'image') body += imageAdjustmentsSection(node) + singleImageRecipesSection(node);
  if (node.type === 'polygon') {
    body += section('Polygon', `${numberField('Sides', 'points', node.points ?? 6, 1, 3, 32, node.locked, 'Polygon sides')}<div class="image-properties-note">Choose between 3 and 32 sides. The shape updates live on the canvas.</div>`);
  } else if (node.type === 'star') {
    body += section('Star', `<div class="property-grid">${numberField('Points', 'points', node.points ?? 5, 1, 3, 32, node.locked, 'Star point count')}${numberField('Inner radius', 'innerRadius', node.innerRadius ?? 0.48, .01, 0, 1, node.locked, 'Star inner radius ratio')}</div><div class="image-properties-note">Set 3–32 outer points and an inner radius ratio from 0 to 1.</div>`);
  }
  if (node.type === 'path') {
    const contours = vectorPathContours(node);
    const selectedPoint = state.selectedVectorPoint?.nodeId === node.id;
    const selectedAnchorCount = normalizeVectorAnchorSelection(state.selectedVectorPoints, node.id).length;
    const selectedContourIndex = selectedPoint ? state.selectedVectorPoint.contourIndex || 0 : 0;
    const selectedContour = contours[selectedContourIndex] || contours[0];
    const pointCount = contours.reduce((sum, contour) => sum + contour.points.length, 0);
    const selectedAnchorIndex = selectedPoint ? state.selectedVectorPoint.index : -1;
    const selectedAnchor = Number.isInteger(selectedAnchorIndex) ? selectedContour?.points[selectedAnchorIndex] : null;
    const hasClosedContour = contours.some(contour => contour.closed && contour.points.length >= 2);
    const pathEntry = entries[0];
    const anchorLocked = node.locked || pathEntry.parents.some(parent => parent.locked);
    const anchorMode = selectedAnchor ? `<label class="field-label" for="vector-anchor-mode">Selected anchor mode</label><select id="vector-anchor-mode" class="select-field" data-vector-anchor-mode aria-label="Selected anchor mode" style="width:100%;min-height:44px"${anchorLocked ? ' disabled' : ''}><option value="corner"${(selectedAnchor.mode || 'corner') === 'corner' ? ' selected' : ''}>Corner</option><option value="smooth"${selectedAnchor.mode === 'smooth' ? ' selected' : ''}>Smooth</option><option value="symmetric"${selectedAnchor.mode === 'symmetric' ? ' selected' : ''}>Symmetric</option></select>` : '';
    const fillRule = hasClosedContour ? `<label class="field-label" for="vector-fill-rule">Fill rule</label><select id="vector-fill-rule" class="select-field prop-input" data-prop="fillRule" aria-label="Vector fill rule"${anchorLocked ? ' disabled' : ''}><option value="nonzero"${(node.fillRule || 'nonzero') === 'nonzero' ? ' selected' : ''}>Nonzero</option><option value="evenodd"${node.fillRule === 'evenodd' ? ' selected' : ''}>Even-odd</option></select>` : '';
    body += section('Vector', `${anchorMode}<label class="field-caption" style="display:flex;align-items:center;gap:8px"><input class="prop-input" data-prop="closed" type="checkbox" ${selectedContour?.closed ? 'checked' : ''}${anchorLocked ? ' disabled' : ''}/> Close selected contour</label>${fillRule}<div class="image-properties-note">${contours.length} contours · ${pointCount} points · double-click a segment to insert; drag anchors and handles to refine it.</div><div class="vector-point-actions"><button class="add-fill" data-action="toggle-vector-anchor-select-mode" aria-pressed="${state.vectorPointSelectMode}"${anchorLocked ? ' disabled' : ''}>${state.vectorPointSelectMode ? 'Done selecting anchors' : 'Select multiple anchors'}</button><button class="add-fill" data-action="insert-vector-point"${anchorLocked ? ' disabled' : ''}>＋ Add point</button><button class="add-fill" data-action="delete-vector-point"${anchorLocked || !selectedPoint ? ' disabled' : ''}>− Delete${selectedAnchorCount > 1 ? ` ${selectedAnchorCount} anchors` : ' point'}</button><button class="add-fill" data-action="reverse-vector-contour"${anchorLocked || (selectedContour?.points?.length || 0) < 2 ? ' disabled' : ''}>↻ Reverse contour direction</button><button class="add-fill" data-action="add-vector-contour"${anchorLocked || contours.length >= 10_000 ? ' disabled' : ''}>＋ Add contour</button><button class="add-fill" data-action="remove-vector-contour"${anchorLocked || !selectedPoint || selectedContourIndex === 0 ? ' disabled' : ''}>− Remove selected contour</button></div><div class="image-properties-note" role="status">${state.vectorPointSelectMode ? `Tap anchors to select or clear them (${selectedAnchorCount} selected); turn this mode off, then drag any selected anchor to move them together.` : selectedAnchorCount > 1 ? `${selectedAnchorCount} anchors selected. Drag any selected anchor to move them together; use Delete to remove them.` : 'Turn on Select multiple anchors to collect anchors across contours, then drag one to move them together.'}</div>`);
    if (hasClosedContour) body += appearanceSection(node);
    else body += strokeSection(node);
  } else if (node.type === 'network') {
    const selectedVertexId = state.selectedVectorPoint?.nodeId === node.id ? state.selectedVectorPoint.vertexId : null;
    const selectedVertex = selectedVertexId ? node.vertices.find(vertex => vertex.id === selectedVertexId) : null;
    const anchorMode = selectedVertex ? `<label class="field-label" for="vector-anchor-mode">Selected anchor mode</label><select id="vector-anchor-mode" class="select-field" data-vector-anchor-mode aria-label="Selected anchor mode" style="width:100%;min-height:44px"${node.locked || entries[0].parents.some(parent => parent.locked) ? ' disabled' : ''}><option value="corner"${getVectorNetworkVertexMode(node, selectedVertexId) === 'corner' ? ' selected' : ''}>Corner</option><option value="smooth"${getVectorNetworkVertexMode(node, selectedVertexId) === 'smooth' ? ' selected' : ''}>Smooth</option><option value="symmetric"${getVectorNetworkVertexMode(node, selectedVertexId) === 'symmetric' ? ' selected' : ''}>Symmetric</option></select>` : '';
    body += section('Vector network', `${anchorMode}<div class="image-properties-note">${node.vertices.length} points · ${node.edges.length} edges · ${node.faces.length} closed regions. Select a point to set its handle mode; branched junctions remain independently editable.</div><div class="vector-point-actions"><button class="add-fill" data-action="insert-vector-point">＋ Add point</button><button class="add-fill" data-action="delete-vector-point"${selectedVertex ? '' : ' disabled'}>− Delete point</button></div>`);
    const primaryFill = fillStackForNode(node)[0];
    const faceColorsEditable = Array.isArray(node.fills) ? primaryFill?.type === 'solid' : !node.imageFill;
    if (node.faces.length && faceColorsEditable) body += section('Region fills', networkFaceControls(node));
    body += appearanceSection(node);
  } else if (!['image', 'text', 'line'].includes(node.type)) body += appearanceSection(node);
  else if (node.type === 'line') body += strokeSection(node);
  body += effectStylesSection({ canSave: true }) + layerEffectsSection(node);
  if (node.type === 'frame') body += frameVariableModesSection(node) + frameOverflowSection(node) + autoLayoutSection(node) + layoutGuidesSection(node);
  const parent = entries[0].parent;
  if (parent?.autoLayout) {
    body += autoLayoutChildPositioningSection(node);
    if (node.layoutPositioning !== 'absolute') {
      if (parent.autoLayout.axis === 'grid') body += gridPlacementSection(node, { ...parent, autoLayout: createAutoLayout(parent.autoLayout) });
      else {
        const sizing = node.layoutSizingMain || 'hug';
        const axis = parent.autoLayout.axis === 'horizontal' ? 'Width' : 'Height';
        const cross = node.layoutSizingCross || 'hug';
        body += section('Layout sizing', `<div class="property-heading" style="font-weight:400;color:#777">${axis} in auto layout</div><select class="prop-input select-field" data-prop="layoutSizingMain" aria-label="Main axis sizing" style="width:100%"><option value="hug"${sizing === 'hug' ? ' selected' : ''}>Hug contents</option><option value="fill"${sizing === 'fill' ? ' selected' : ''}>Fill container</option></select><div class="property-heading" style="font-weight:400;color:#777;margin-top:8px">Cross axis sizing</div><select class="prop-input select-field" data-prop="layoutSizingCross" aria-label="Cross axis sizing" style="width:100%"><option value="hug"${cross === 'hug' ? ' selected' : ''}>Fixed size</option><option value="fill"${cross === 'fill' ? ' selected' : ''}>Fill container</option></select>`);
      }
    }
  } else if (parent?.type === 'frame') body += constraintsSection(node);
  body += sizeLimitsSection(node, parent);
  if (node.type === 'image') body += section('Image', `<div class="property-heading" style="font-weight:400;color:#777">${escapeHtml(node.fileName || node.name)}</div><div class="property-grid"><select class="prop-input select-field" data-prop="fit" aria-label="Image fill mode"><option value="cover">Fill</option><option value="contain">Fit</option></select><button class="add-fill" data-action="reset-image">Reset image</button><label class="image-output-field"><span>Output format</span><select class="prop-input select-field" data-prop="outputFormat" aria-label="Image output format"><option value="png"${(node.outputFormat ?? 'png') === 'png' ? ' selected' : ''}>PNG</option><option value="jpeg"${node.outputFormat === 'jpeg' ? ' selected' : ''}>JPEG</option><option value="webp"${node.outputFormat === 'webp' ? ' selected' : ''}>WebP</option></select></label><label class="image-output-field"><span>Quality</span><input class="prop-input" data-prop="outputQuality" type="range" min="1" max="100" step="1" value="${node.outputQuality ?? 90}" aria-label="Image output quality"/><output>${node.outputQuality ?? 90}%</output></label></div><button class="add-fill" type="button" data-action="export-edited-source">Download edited original</button><div class="image-properties-note">This exports the crop, rotation, flips, and adjustments at the original image resolution. JPEG/WebP quality is applied in the local Pillow-RS WASM worker. Format and quality are also saved in recipes for batch export.</div>`);
  body += exportSettingsSection(node);
  content.innerHTML = body;
  for (const input of content.querySelectorAll('[data-prop="fontFamily"],[data-prop="fontWeight"],[data-prop="align"],[data-prop="verticalAlign"],[data-prop="fit"],[data-prop="textFit"]')) input.value = String(node[input.dataset.prop] ?? input.value);
}

function renderLocalComponentLibraries() {
  const list = $('#component-library-list');
  if (!list) return;
  list.replaceChildren();
  const selectedMaster = selectedNodes().length === 1 && selectedNodes()[0].isComponent;
  if (!(state.componentLibraries || []).length) {
    const empty = document.createElement('div'); empty.className = 'components-empty local-library-empty';
    empty.textContent = 'Save a component here to reuse it in any design on this device.';
    list.append(empty);
    return;
  }
  for (const item of state.componentLibraries) {
    const library = item.library;
    if (!library) continue;
    const card = document.createElement('section'); card.className = 'local-library-card';
    const header = document.createElement('div'); header.className = 'local-library-header';
    const title = document.createElement('strong'); title.textContent = library.name;
    const revision = document.createElement('small'); revision.textContent = `r${library.revision}`;
    header.append(title, revision);
    const publish = document.createElement('button'); publish.type = 'button'; publish.className = 'local-library-publish';
    publish.dataset.publishLocalComponent = library.id; publish.disabled = !selectedMaster;
    publish.textContent = '＋ Publish selected component';
    const entries = document.createElement('div'); entries.className = 'local-library-components';
    const components = library.components.map(component => ({ component, publication: component.versions.at(-1) }))
      .filter(entry => entry.publication);
    if (!components.length) {
      const emptyLibrary = document.createElement('div'); emptyLibrary.className = 'local-library-empty';
      emptyLibrary.textContent = 'Publish a component from this design to get started.';
      entries.append(emptyLibrary);
    }
    for (const { component, publication } of components) {
      const place = document.createElement('button'); place.type = 'button'; place.className = 'local-library-component';
      place.dataset.localLibraryId = library.id; place.dataset.localComponentId = component.id;
      place.title = `Place ${publication.name} from ${library.name} · revision ${publication.revision}`;
      const mark = document.createElement('span'); mark.className = 'component-card-icon'; mark.textContent = '◇';
      const name = document.createElement('span'); name.className = 'component-card-name'; name.textContent = publication.name;
      const version = document.createElement('small'); version.textContent = `r${publication.revision}`;
      place.append(mark, name, version); entries.append(place);
    }
    card.append(header, publish, entries);
    list.append(card);
  }
}

function cacheImageLibraryThumbnail(assetId, blob) {
  const previous = state.imageLibraryThumbnailUrls.get(assetId);
  if (previous) URL.revokeObjectURL(previous);
  const url = URL.createObjectURL(blob);
  state.imageLibraryThumbnailUrls.delete(assetId);
  state.imageLibraryThumbnailUrls.set(assetId, url);
  while (state.imageLibraryThumbnailUrls.size > IMAGE_LIBRARY_THUMBNAIL_CACHE_LIMIT) {
    const oldestAssetId = state.imageLibraryThumbnailUrls.keys().next().value;
    const oldestUrl = state.imageLibraryThumbnailUrls.get(oldestAssetId);
    state.imageLibraryThumbnailUrls.delete(oldestAssetId);
    URL.revokeObjectURL(oldestUrl);
  }
  return url;
}

async function persistImageLibraryThumbnail(assetId, bitmap, generation = state.documentGeneration) {
  const blob = await createImageLibraryThumbnailBlob(bitmap);
  if (generation !== state.documentGeneration
    || !state.document.imageLibrary?.some(item => item.assetId === assetId)) return '';
  try { await saveImageAssetThumbnail(assetId, new Uint8Array(await blob.arrayBuffer())); }
  catch (error) { console.warn('Could not save a compact local image thumbnail.', error); }
  if (generation !== state.documentGeneration
    || !state.document.imageLibrary?.some(item => item.assetId === assetId)) return '';
  return cacheImageLibraryThumbnail(assetId, blob);
}

function imageLibraryThumbnailBlob(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) return null;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  return new Blob([bytes], { type: jpeg ? 'image/jpeg' : 'image/png' });
}

function resolveImageLibraryThumbnail(entry) {
  const assetId = entry?.assetId;
  if (!assetId) return '';
  const cached = state.imageLibraryThumbnailUrls.get(assetId);
  if (cached) {
    state.imageLibraryThumbnailUrls.delete(assetId);
    state.imageLibraryThumbnailUrls.set(assetId, cached);
    return cached;
  }
  const pending = state.imageLibraryThumbnailLoads.get(assetId);
  if (pending) return pending;
  const generation = state.documentGeneration;
  const request = (async () => {
    let blob = null;
    try { blob = imageLibraryThumbnailBlob(await loadImageAssetThumbnail(assetId)); }
    catch { /* A resident decoded source can regenerate a missing thumbnail. */ }
    if (!blob) {
      const resident = state.assets.get(assetId);
      if (!resident?.bitmap) return '';
      return persistImageLibraryThumbnail(assetId, resident.bitmap, generation);
    }
    if (generation !== state.documentGeneration
      || !state.document.imageLibrary?.some(item => item.assetId === assetId)) return '';
    return cacheImageLibraryThumbnail(assetId, blob);
  })();
  state.imageLibraryThumbnailLoads.set(assetId, request);
  return request.finally(() => {
    if (state.imageLibraryThumbnailLoads.get(assetId) === request) state.imageLibraryThumbnailLoads.delete(assetId);
  });
}

function renderAssetsTab() {
  state.assetThumbnailImages.clear();
  const placedImages = $('#placed-image-assets');
  placedImages.replaceChildren();
  for (const node of imageNodes()) {
    const asset = state.assets.get(node.assetId);
    const card = document.createElement('button'); card.className = 'asset-card'; card.dataset.layerId = node.id; card.title = `Place ${node.name}`;
    const thumb = document.createElement('span'); thumb.className = 'asset-thumb';
    const image = document.createElement('img'); image.alt = ''; image.src = state.previewUrls.get(node.id) || asset?.bitmapUrl || '';
    state.assetThumbnailImages.set(node.id, image);
    thumb.append(image);
    const name = document.createElement('span'); name.className = 'asset-card-name'; name.textContent = node.name;
    card.append(thumb, name); placedImages.append(card);
  }
  const components = $('#components-list');
  const expandedComponentSets = new Set([...components.querySelectorAll('[data-component-set-editor][open]')].map(item => item.dataset.componentSetEditor));
  components.replaceChildren();
  const variableCollections = $('#variable-collections-list'); variableCollections.replaceChildren();
  const collections = state.document.variableCollections || [];
  const exportTokens = $('#export-design-tokens');
  if (exportTokens) exportTokens.disabled = !(state.document.variables || []).length;
  if (!collections.length) {
    const empty = document.createElement('div'); empty.className = 'variables-empty'; empty.textContent = 'Create typed variables, aliases, and theme modes for this design.'; variableCollections.append(empty);
  }
  for (const collection of collections) {
    const card = document.createElement('section'); card.className = 'variable-collection-card';
    const header = document.createElement('div'); header.className = 'variable-collection-header';
    const title = document.createElement('strong'); title.textContent = collection.name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'tiny-icon-button'; remove.dataset.action = 'delete-variable-collection'; remove.dataset.collectionId = collection.id; remove.setAttribute('aria-label', `Delete ${collection.name} variable collection`); remove.title = 'Delete collection'; remove.textContent = '×';
    header.append(title, remove);
    const controls = document.createElement('div'); controls.className = 'variable-collection-controls';
    const mode = document.createElement('select'); mode.className = 'select-field'; mode.dataset.variableDefaultMode = collection.id; mode.setAttribute('aria-label', `${collection.name} default mode`);
    for (const item of collection.modes) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; option.selected = item.id === collection.defaultModeId; mode.append(option); }
    const addMode = document.createElement('button'); addMode.type = 'button'; addMode.className = 'variable-mode-add'; addMode.dataset.action = 'add-variable-mode'; addMode.dataset.collectionId = collection.id; addMode.textContent = '+ Mode';
    controls.append(mode, addMode);
    const rows = document.createElement('div'); rows.className = 'variable-rows';
    const variables = (state.document.variables || []).filter(variable => variable.collectionId === collection.id);
    for (const variable of variables) {
      const row = document.createElement('div'); row.className = 'variable-row';
      const heading = document.createElement('div'); heading.className = 'variable-item-heading';
      if (variable.type === 'color') {
        const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'variable-apply'; apply.dataset.variableApply = variable.id; apply.title = `Apply ${variable.name} to selected layers`;
        const swatch = document.createElement('span'); swatch.className = 'variable-swatch'; swatch.style.backgroundColor = resolveVariableValue(state.document, variable.id) || '#ffffff';
        const name = document.createElement('span'); name.className = 'variable-name'; name.textContent = variable.name;
        apply.append(swatch, name); heading.append(apply);
      } else {
        const name = document.createElement('span'); name.className = 'variable-name'; name.textContent = variable.name; heading.append(name);
      }
      const kind = document.createElement('span'); kind.className = 'variable-type-badge'; kind.textContent = variable.type;
      const removeVariable = document.createElement('button'); removeVariable.type = 'button'; removeVariable.className = 'tiny-icon-button variable-remove'; removeVariable.dataset.action = 'delete-variable'; removeVariable.dataset.variableId = variable.id; removeVariable.setAttribute('aria-label', `Delete ${variable.name}`); removeVariable.title = 'Delete variable'; removeVariable.textContent = '×';
      heading.append(kind, removeVariable);
      const values = document.createElement('div'); values.className = 'variable-mode-values';
      for (const item of collection.modes) {
        const modeRow = document.createElement('div'); modeRow.className = 'variable-mode-value';
        const modeName = document.createElement('span'); modeName.className = 'variable-mode-name'; modeName.textContent = item.name;
        const alias = document.createElement('select'); alias.className = 'select-field variable-alias'; alias.dataset.variableAlias = variable.id; alias.dataset.modeId = item.id; alias.setAttribute('aria-label', `${variable.name} ${item.name} alias`);
        const literalOption = document.createElement('option'); literalOption.value = ''; literalOption.textContent = 'Value'; alias.append(literalOption);
        for (const target of state.document.variables || []) {
          if (target.id === variable.id || target.type !== variable.type) continue;
          const option = document.createElement('option'); option.value = target.id; option.textContent = `${target.collectionId === collection.id ? '' : `${state.document.variableCollections.find(entry => entry.id === target.collectionId)?.name || 'Collection'} · `}${target.name}`; alias.append(option);
        }
        const aliasId = variable.aliasesByMode?.[item.id] || '';
        alias.value = aliasId;
        const input = document.createElement('input'); input.className = 'variable-value'; input.dataset.variableValue = variable.id; input.dataset.modeId = item.id; input.disabled = Boolean(aliasId);
        if (variable.type === 'boolean') {
          input.type = 'checkbox'; input.checked = Boolean(variable.valuesByMode?.[item.id]);
        } else {
          input.type = variable.type === 'color' ? 'color' : variable.type === 'number' ? 'number' : 'text';
          if (input.type === 'number') input.step = 'any';
          input.value = String(variable.valuesByMode?.[item.id] ?? (variable.type === 'color' ? '#1e1e1e' : ''));
        }
        input.title = `${variable.name} · ${item.name}`; input.setAttribute('aria-label', `${variable.name} ${item.name} value`);
        modeRow.append(modeName, alias, input); values.append(modeRow);
      }
      row.append(heading, values); rows.append(row);
    }
    const addVariable = document.createElement('button'); addVariable.type = 'button'; addVariable.className = 'add-fill'; addVariable.dataset.action = 'add-variable'; addVariable.dataset.collectionId = collection.id; addVariable.textContent = '＋ New variable';
    card.append(header, controls, rows, addVariable); variableCollections.append(card);
  }
  const componentItems = state.document.components || [];
  const componentSetItems = state.document.componentSets || [];
  const groupedComponentIds = new Set(componentSetItems.flatMap(set => set.componentIds));
  if (!componentItems.length) {
    const empty = document.createElement('div'); empty.className = 'components-empty'; empty.textContent = 'Create a component from any layer.'; components.append(empty);
  }
  for (const set of componentSetItems) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = componentSetAssetMarkup(state.document, set, {
      open: expandedComponentSets.has(set.id),
      selectedComponentId: state.componentSetSelectedVariants.get(set.id)
    });
    if (wrapper.firstElementChild) components.append(wrapper.firstElementChild);
  }
  for (const component of componentItems.filter(item => !groupedComponentIds.has(item.id))) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'component-card'; card.dataset.componentId = component.id; card.title = `Create an instance of ${component.name}`;
    const mark = document.createElement('span'); mark.className = 'component-card-icon'; mark.textContent = '◇';
    const name = document.createElement('span'); name.className = 'component-card-name'; name.textContent = component.name;
    card.append(mark, name); components.append(card);
  }
  renderLocalComponentLibraries();
  const styles = $('#color-styles-list'); styles.replaceChildren();
  const colorStyles = state.document.colorStyles || [];
  if (!colorStyles.length) {
    const empty = document.createElement('div'); empty.className = 'color-styles-empty'; empty.textContent = 'Create styles from a solid Fill or Text color.'; styles.append(empty);
  }
  for (const style of colorStyles) {
    const row = document.createElement('div'); row.className = 'color-style-row';
    const card = document.createElement('button'); card.type = 'button'; card.className = 'color-style-card'; card.dataset.colorStyleId = style.id; card.title = `Apply ${style.name} · ${style.value}`;
    const swatch = document.createElement('span'); swatch.className = 'color-style-swatch'; swatch.style.background = style.value;
    const name = document.createElement('span'); name.className = 'color-style-name'; name.textContent = style.name;
    card.append(swatch, name);
    const actions = document.createElement('div'); actions.className = 'typography-style-actions';
    const update = document.createElement('button'); update.type = 'button'; update.dataset.colorStyleAction = 'update'; update.dataset.colorStyleId = style.id; update.textContent = 'Update'; update.title = `Update ${style.name} from the selected layer`;
    const rename = document.createElement('button'); rename.type = 'button'; rename.dataset.colorStyleAction = 'rename'; rename.dataset.colorStyleId = style.id; rename.textContent = 'Rename'; rename.title = `Rename ${style.name}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.colorStyleAction = 'delete'; remove.dataset.colorStyleId = style.id; remove.textContent = '×'; remove.title = `Delete ${style.name}`; remove.setAttribute('aria-label', `Delete ${style.name}`);
    actions.append(update, rename, remove); row.append(card, actions); styles.append(row);
  }
  const textStyles = $('#text-styles-list'); textStyles.replaceChildren();
  const typographyStyles = state.document.typographyStyles || [];
  if (!typographyStyles.length) {
    const empty = document.createElement('div'); empty.className = 'typography-styles-empty'; empty.textContent = 'Save typography from a text layer to reuse it here.'; textStyles.append(empty);
  } else {
    const hint = document.createElement('div'); hint.className = 'typography-styles-hint'; hint.textContent = 'Applying links supported typography settings. Updates reach linked text; color, alignment, and resizing stay local.'; textStyles.append(hint);
  }
  for (const style of typographyStyles) {
    const row = document.createElement('div'); row.className = 'typography-style-row';
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'typography-style-apply'; apply.dataset.typographyStyleId = style.id; apply.title = `Apply ${style.name} to selected text`;
    const mark = document.createElement('span'); mark.className = 'typography-style-mark'; mark.textContent = 'Tt'; mark.style.fontFamily = style.fontFamily; mark.style.fontSize = `${Math.max(12, Math.min(22, style.fontSize))}px`; mark.style.fontWeight = String(style.fontWeight); mark.style.fontStyle = style.fontStyle; mark.style.color = '#1e1e1e'; mark.style.textAlign = 'left'; mark.style.textTransform = ['uppercase', 'lowercase', 'capitalize'].includes(style.textCase) ? style.textCase : 'none'; mark.style.textDecoration = ['underline', 'line-through'].includes(style.textDecoration) ? style.textDecoration : 'none';
    const copy = document.createElement('span'); copy.className = 'typography-style-copy';
    const name = document.createElement('span'); name.className = 'typography-style-name'; name.textContent = style.name;
    const detail = document.createElement('small'); detail.textContent = `${style.fontFamily} · ${style.fontSize}px · ${style.fontWeight}`;
    copy.append(name, detail); apply.append(mark, copy);
    const actions = document.createElement('div'); actions.className = 'typography-style-actions';
    const update = document.createElement('button'); update.type = 'button'; update.dataset.textStyleAction = 'update'; update.dataset.textStyleId = style.id; update.textContent = 'Update'; update.title = `Update ${style.name} from selected text`;
    const rename = document.createElement('button'); rename.type = 'button'; rename.dataset.textStyleAction = 'rename'; rename.dataset.textStyleId = style.id; rename.textContent = 'Rename'; rename.title = `Rename ${style.name}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.textStyleAction = 'delete'; remove.dataset.textStyleId = style.id; remove.textContent = '×'; remove.title = `Delete ${style.name}`; remove.setAttribute('aria-label', `Delete ${style.name}`);
    actions.append(update, rename, remove); row.append(apply, actions); textStyles.append(row);
  }
  renderLocalFontAssets();
  const imageLibraryCallbacks = {
    documentData: state.document,
    onAdd: () => $('#image-library-input').click(),
    onPlace: assetId => placeImageLibraryAsset(assetId),
    onRemove: assetId => removeImageFromLibrary(assetId),
    getThumbnail: resolveImageLibraryThumbnail,
    pageSize: 48
  };
  const libraryRoot = $('#image-library-root');
  if (!state.imageLibraryView) state.imageLibraryView = mountImageLibraryView(libraryRoot, imageLibraryCallbacks);
  else state.imageLibraryView.refresh(state.document);
}

function renderUI() {
  syncActiveImageSource();
  syncImageCropOverlay();
  $('#document-name').value = state.document.name;
  $('#canvas-file-name').textContent = state.document.name;
  renderPageList(); renderLayers(); renderInspector(); renderAssetsTab(); updateSelectionStatus(); updateZoomUI();
  renderer?.invalidate();
}

function updateImageAssetThumbnail(nodeId) {
  const thumbnail = state.assetThumbnailImages.get(nodeId);
  if (!thumbnail) return;
  const node = findNode(state.document, nodeId)?.node;
  const asset = node?.assetId ? state.assets.get(node.assetId) : null;
  thumbnail.src = state.previewUrls.get(nodeId) || asset?.bitmapUrl || '';
}

function pageLayerRows(page = activePage()) {
  const rows = [];
  if (page) walkNodes(page.children, entry => rows.push(entry));
  return rows;
}
function nodeTransformContext(node) {
  const entry = node ? findNode(state.document, node.id) : null;
  if (!entry) return null;
  const geometry = { ...node, ...resolvedGeometry(node) };
  const ancestors = entry.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
  return { entry, geometry, ancestors, origin: { x: geometry.x, y: geometry.y } };
}
function deepestContainerAt(point) {
  return deepestContainerAtPagePoint(activePage()?.children || [], point, state.document);
}
function parentLocalPenAnchors(anchors, parent, nodeGeometry = null) {
  if (!parent) return anchors.map(point => ({ ...point }));
  const toParent = point => nodeGeometry
    ? pageToNodeParentLocal(nodeGeometry, point, parent.ancestors)
    : pageToParentLocal(point, parent.ancestors);
  return anchors.map(point => ({
    ...point,
    ...toParent(point),
    ...(point.in ? { in: toParent(point.in) } : {}),
    ...(point.out ? { out: toParent(point.out) } : {})
  }));
}
function localizeToParent(node, pageX, pageY, parent, { anchor = 'top-left' } = {}) {
  const local = parent
    ? pageToParentLocal({ x: pageX, y: pageY }, parent.ancestors)
    : { x: pageX, y: pageY };
  const anchorX = anchor === 'center' ? node.width / 2 : 0;
  const anchorY = anchor === 'center' ? node.height / 2 : 0;
  node.x = local.x - anchorX;
  node.y = local.y - anchorY;
  addNode(state.document, node, { parentId: parent?.node.id ?? null });
  if (parent?.node.autoLayout) applyAutoLayout(parent.node);
}

function networkAnchorAt(world, node, pointerType = 'mouse') {
  if (!node || node.type !== 'network' || node.locked) return null;
  const context = nodeTransformContext(node);
  if (!context) return null;
  let best = null;
  for (const vertex of context.geometry.vertices || []) {
    const nodeLocalPoint = vectorNetworkVertexPoint(context.geometry, vertex.id, { x: 0, y: 0 });
    if (!nodeLocalPoint) continue;
    const pagePoint = nodeLocalToPage(context.geometry, nodeLocalPoint, context.ancestors);
    const parentPoint = vectorNetworkVertexPoint(context.geometry, vertex.id, context.origin);
    const distance = checkPointDistance(world, pagePoint);
    const tolerance = (pointerType === 'touch' ? 22 : 12) / Math.max(.08, state.zoom);
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { node, origin: context.origin, ancestors: context.ancestors, vertexId: vertex.id, localPoint: parentPoint, pagePoint, distance };
    }
  }
  return best;
}

function startPenPath(world, pointerType = 'mouse') {
  const selected = selectedNodes();
  const targetNetwork = selected.length === 1 && selected[0].type === 'network' && !selected[0].locked ? selected[0] : null;
  const closeTolerance = 10 / Math.max(.08, state.zoom);
  const draft = state.penDraft;
  if (draft) {
    const targetId = draft.targetNetworkId || draft.networkNodeId;
    const target = targetId ? findNode(state.document, targetId)?.node : targetNetwork;
    const existing = target ? networkAnchorAt(world, target, pointerType) : null;
    const first = draft.anchors[0];
    if (existing && draft.anchors.length >= 2) {
      const closesAtFirst = (first.vertexId && first.vertexId === existing.vertexId)
        || (!first.vertexId && checkPointDistance(world, first) <= closeTolerance);
      if (closesAtFirst) {
        if (draft.anchors.length >= 3) finishPenPath(true);
        else showToast('Add one more point before closing a region.');
        return;
      }
      const point = { ...existing.pagePoint, in: { ...existing.pagePoint }, out: { ...existing.pagePoint }, vertexId: existing.vertexId };
      draft.anchors.push(point);
      finishPenPath(false);
      return;
    }
    if (draft.anchors.length >= 3 && checkPointDistance(world, first) <= closeTolerance) {
      finishPenPath(true);
      return;
    }
    const penDraftBefore = structuredClone(draft);
    const pointPosition = world;
    const point = { ...pointPosition, in: { ...pointPosition }, out: { ...pointPosition } };
    draft.anchors.push(point);
    const pointIndex = draft.anchors.length - 1;
    state.interaction = { kind: 'pen-anchor', start: world, pointIndex, moved: false, penDraftBefore };
  } else {
    const existing = targetNetwork ? networkAnchorAt(world, targetNetwork, pointerType) : null;
    const point = existing ? existing.pagePoint : world;
    state.penDraft = {
      ...(targetNetwork ? { targetNetworkId: targetNetwork.id } : {}),
      anchors: [{ ...point, in: { ...point }, out: { ...point }, ...(existing ? { vertexId: existing.vertexId } : {}) }]
    };
    state.interaction = { kind: 'pen-anchor', start: world, pointIndex: 0, moved: false, penDraftBefore: null };
    showToast(existing ? 'Starting at a shared point · add a branch, connect another point, then press Enter.' : 'Click to add points · drag for curves · Enter to finish · Escape to cancel.', 5000);
  }
  state.penHover = world;
  $('#selection-status').textContent = 'Pen · draw connected vector networks · Enter finish · Esc cancel';
  renderer.invalidate();
}

function finishPenPath(closed = false, { selectAfter = true } = {}) {
  const draft = state.penDraft;
  if (!draft || draft.anchors.length < 2) return false;
  state.penDraft = null; state.penHover = null; state.interaction = null;
  const targetNetworkId = draft.targetNetworkId || draft.networkNodeId;
  const existing = targetNetworkId ? findNode(state.document, targetNetworkId)?.node : null;
  let node;
  if (existing?.type === 'network' && !existing.locked) {
    node = existing;
    checkpoint('Extend vector network');
    const context = nodeTransformContext(node);
    if (!context) return false;
    const anchors = parentLocalPenAnchors(draft.anchors, { ancestors: context.ancestors }, context.geometry);
    const geometryProperties = ['x', 'y', 'width', 'height'];
    const result = appendVectorNetworkPathResolved(node, anchors, context.geometry, {
      closed,
      writeGeometry: geometry => geometryProperties.every(property => setNodePropertyValue(node, property, geometry[property]))
    });
    if (!result?.addedEdges) { showToast('Add at least two distinct points to make a vector path.'); renderer.invalidate(); return false; }
    const boundGeometryProperties = geometryProperties.filter(property => node.variableBindings?.[property]);
    if (boundGeometryProperties.length) recordNodeComponentOverrides(node, ['variableBindings']);
    recordNodeComponentOverrides(node, ['vertices', 'edges', 'faces', ...geometryProperties.filter(property => !node.variableBindings?.[property])]);
  } else {
    checkpoint('Create vector network');
    const pageGeometry = vectorNetworkGeometryFromAnchors(draft.anchors, { closed });
    const center = { x: pageGeometry.x + pageGeometry.width / 2, y: pageGeometry.y + pageGeometry.height / 2 };
    const parent = deepestContainerAtPagePoint(activePage()?.children || [], center, state.document);
    const anchors = parentLocalPenAnchors(draft.anchors, parent);
    const geometry = vectorNetworkGeometryFromAnchors(anchors, { closed });
    node = createNode('network', geometry);
    addNode(state.document, node, { parentId: parent?.node.id ?? null });
    if (parent?.node.autoLayout) applyAutoLayout(parent.node);
  }
  if (selectAfter) setTool('select');
  setSelection([node.id]); queueSave(); renderer.invalidate();
  showToast(`${closed ? 'Closed region' : 'Vector path'} ${existing ? 'added to network' : 'created'} · select a point and use Pen to branch.`);
  return true;
}

function cancelPenPath() {
  state.penDraft = null; state.penHover = null; state.interaction = null;
  renderer.invalidate(); updateSelectionStatus();
}

const MAX_PENCIL_SAMPLES = 8192;
function startPencilStroke(world, event) {
  const pressureSensitive = event.pointerType === 'pen' && !event.shiftKey;
  const pressure = Number.isFinite(event.pressure) ? Math.max(0, Math.min(1, event.pressure)) : 0.5;
  state.pencilDraft = {
    pointerId: event.pointerId,
    pressureSensitive,
    variableWidth: false,
    initialPressure: pressure,
    maxWidth: 8,
    points: [{ x: world.x, y: world.y, ...(pressureSensitive ? { pressure } : {}) }]
  };
  state.interaction = { kind: 'pencil-stroke', pointerId: event.pointerId };
  $('#selection-status').textContent = pressureSensitive ? 'Pencil · draw with stylus pressure' : 'Pencil · draw a freehand vector path';
  renderer.invalidate();
}

function appendPencilSample(draft, point, pressure = null) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
  const points = draft.points;
  const minimumDistance = 1.25 / Math.max(.08, state.zoom);
  const normalizedPressure = draft.pressureSensitive
    ? (Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : points.at(-1)?.pressure ?? 0.5)
    : null;
  if (points.length && checkPointDistance(points.at(-1), point) < minimumDistance) {
    const previous = points.at(-1);
    if (draft.pressureSensitive && Math.abs(normalizedPressure - previous.pressure) >= .04) {
      points[points.length - 1] = { x: point.x, y: point.y, pressure: normalizedPressure };
      draft.variableWidth ||= Math.abs(normalizedPressure - draft.initialPressure) >= .08;
    }
    return;
  }
  if (points.length >= MAX_PENCIL_SAMPLES) {
    // Keep the stroke bounded while retaining its first and latest samples.
    draft.points = points.filter((_sample, index) => index % 2 === 0);
    if (draft.points.at(-1) !== points.at(-1)) draft.points.push(points.at(-1));
  }
  draft.points.push({ x: point.x, y: point.y, ...(draft.pressureSensitive ? { pressure: normalizedPressure } : {}) });
  if (draft.pressureSensitive) draft.variableWidth ||= Math.abs(normalizedPressure - draft.initialPressure) >= .08;
}

function appendPencilPointerEvent(event, draft) {
  let coalesced = [];
  try { coalesced = event.getCoalescedEvents?.() || []; } catch { /* Use the dispatched event when coalesced samples are unavailable. */ }
  const append = sample => {
    let pressure = sample.pressure;
    if (draft.pressureSensitive && (sample.type === 'pointerup' || sample.type === 'pointercancel') && pressure === 0) pressure = draft.points.at(-1)?.pressure;
    appendPencilSample(draft, screenToWorld(sample, canvas, state), pressure);
  };
  for (const sample of coalesced) append(sample);
  append(event);
}

function cancelPencilStroke({ retainPointer = false } = {}) {
  const pointerId = state.pencilDraft?.pointerId;
  state.pencilDraft = null;
  if (!retainPointer && pointerId != null) state.pointerMap.delete(pointerId);
  if (state.interaction?.kind === 'pencil-stroke') state.interaction = null;
  renderer.invalidate();
  updateSelectionStatus();
}

function finishPencilStroke(event) {
  const draft = state.pencilDraft;
  if (!draft) return false;
  state.pencilDraft = null;
  state.interaction = null;
  if (event.type === 'pointercancel') {
    renderer.invalidate();
    updateSelectionStatus();
    return false;
  }

  appendPencilPointerEvent(event, draft);
  renderer.invalidate();
  if (draft.points.length < 2) {
    updateSelectionStatus();
    showToast('Draw a little longer to create a Pencil path.');
    return false;
  }

  try {
    const tolerance = 1.25 / Math.max(.08, state.zoom);
    const pageOutline = draft.variableWidth
      ? variableStrokeOutlineFromSamples(draft.points, { maxWidth: draft.maxWidth }) : null;
    const pageGeometry = draft.variableWidth
      ? pageOutline && vectorGeometryFromAnchors(pageOutline, { closed: true })
      : vectorNetworkGeometryFromFreehandSamples(draft.points, { tolerance, maxAnchors: 1024 });
    if (!pageGeometry) { updateSelectionStatus(); showToast('Draw a little longer to create a Pencil path.'); return false; }
    const center = { x: pageGeometry.x + pageGeometry.width / 2, y: pageGeometry.y + pageGeometry.height / 2 };
    const parent = deepestContainerAtPagePoint(activePage()?.children || [], center, state.document);
    const geometry = draft.variableWidth
      ? vectorGeometryFromAnchors(parentLocalPenAnchors(pageOutline, parent), { closed: true })
      : vectorNetworkGeometryFromFreehandSamples(parentLocalPenAnchors(draft.points, parent), { tolerance, maxAnchors: 1024 });
    if (!geometry) { updateSelectionStatus(); showToast('Draw a little longer to create a Pencil path.'); return false; }
    const node = createNode(draft.variableWidth ? 'path' : 'network', geometry);
    node.name = draft.variableWidth ? 'Pressure Pencil path' : 'Pencil path';
    if (draft.variableWidth) {
      node.fill = '#1e1e1e';
      node.fillOpacity = 1;
      node.stroke = null;
      node.strokeWidth = 0;
      node.closed = true;
    }
    if (parent?.node.autoLayout) node.layoutPositioning = 'absolute';
    checkpoint('Draw freehand vector path');
    addNode(state.document, node, { parentId: parent?.node.id ?? null });
    if (parent?.node.autoLayout) applyAutoLayout(parent.node);
    setSelection([node.id]);
    queueSave();
    renderer.invalidate();
    showToast('Pencil path created · select a point to refine the curve.');
    return true;
  } catch (error) {
    updateSelectionStatus();
    showToast(error instanceof RangeError
      ? 'This Pencil stroke is too detailed to preserve. Draw it more simply or at a lower zoom.'
      : 'The Pencil stroke could not be converted to a vector path.');
    return false;
  }
}

function rotatePoint(point, center, degrees) {
  if (!degrees) return point;
  const angle = degrees * Math.PI / 180;
  const dx = point.x - center.x; const dy = point.y - center.y;
  return { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function hasClosedPathContour(node) {
  return vectorPathContours(node).some(contour => contour.closed && contour.points.length >= 2);
}

function vectorPathControlAt(world, pointerType = 'mouse') {
  const nodes = selectedNodes();
  const node = nodes.length === 1 && ['path', 'network'].includes(nodes[0].type) && !nodes[0].locked ? nodes[0] : null;
  if (!node || state.tool !== 'select') return null;
  const entry = findNode(state.document, node.id);
  if (!entry || entry.parents.some(parent => parent.locked)) return null;
  const ancestors = entry.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
  const geometry = { ...node, ...resolvedGeometry(node) };
  const origin = { x: 0, y: 0 };
  const toPage = point => nodeLocalToPage(geometry, point, ancestors);
  const tolerance = (pointerType === 'touch' ? 22 : 9) / Math.max(.08, state.zoom);
  let best = null;
  if (node.type === 'network') {
    for (const edge of node.edges || []) {
      const points = vectorNetworkEdgePoints(geometry, edge.id, origin);
      if (!points) continue;
      for (const [part, handle, anchor] of [['control1', points[1], points[0]], ['control2', points[2], points[3]]]) {
        if (!edge[part]) continue;
        const point = toPage(handle);
        const distance = checkPointDistance(world, point);
        if (distance <= tolerance && (!best || distance < best.distance)) best = { node, origin, ancestors, edgeId: edge.id, part, distance };
      }
    }
    for (const vertex of node.vertices || []) {
      const point = toPage(vectorNetworkVertexPoint(geometry, vertex.id, origin));
      const distance = checkPointDistance(world, point);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { node, origin, ancestors, vertexId: vertex.id, part: 'anchor', distance };
    }
    return best;
  }
  for (const [contourIndex, contour] of vectorPathContours(node).entries()) {
    for (let index = 0; index < contour.points.length; index += 1) {
      for (const part of ['in', 'out', 'anchor']) {
        if (part !== 'anchor') {
          const handle = contour.points[index][part];
          if (!handle || (Number(handle.x) === 0 && Number(handle.y) === 0)) continue;
        }
        const point = toPage(vectorNodePoint(geometry, index, part, origin, contourIndex));
        const distance = checkPointDistance(world, point);
        if (distance <= tolerance && (!best || distance < best.distance)) best = { node, origin, ancestors, contourIndex, index, part, distance };
      }
    }
  }
  return best;
}

function insertPathPoint(node, segmentIndex, t = .5, origin = nodeTransformContext(node)?.origin || { x: node.x, y: node.y }, contourIndex = 0) {
  if (!node || !['path', 'network'].includes(node.type) || node.locked) return false;
  if (node.type === 'network') {
    const vertexId = insertVectorNetworkPoint(node, segmentIndex, t, origin);
    if (!vertexId) return false;
    clearVectorAnchorSelection();
    state.selectedVectorPoint = { nodeId: node.id, vertexId };
    recordNodeComponentOverrides(node, ['vertices', 'edges', 'faces']);
  } else {
    const pointIndex = insertVectorNodePoint(node, segmentIndex, t, origin, contourIndex);
    if (pointIndex < 0) return false;
    setVectorAnchorSelection([{ nodeId: node.id, contourIndex, index: pointIndex }]);
    recordNodeComponentOverrides(node, contourIndex === 0 ? ['points'] : ['subpaths']);
  }
  renderInspector(); renderer.invalidate(); queueSave();
  showToast('Vector point inserted. The Bézier curve keeps its original shape.');
  return true;
}

function addPathContour(nodeId = selectedNodes()[0]?.id) {
  const node = nodeId ? findNode(state.document, nodeId)?.node : null;
  if (node?.type !== 'path' || node.locked || vectorPathContours(node).length >= 10_000) return false;
  checkpoint('Add vector contour');
  node.subpaths ||= [];
  node.subpaths.push({ closed: false, points: [
    { x: .4, y: .5, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
    { x: .6, y: .5, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }
  ] });
  const contourIndex = node.subpaths.length;
  setVectorAnchorSelection([{ nodeId: node.id, contourIndex, index: 0 }]);
  recordNodeComponentOverrides(node, ['subpaths']);
  renderInspector(); renderer.invalidate(); queueSave();
  showToast('Contour added. Drag its anchors and close it when ready.');
  return true;
}

function removeSelectedPathContour(nodeId = selectedNodes()[0]?.id) {
  const node = nodeId ? findNode(state.document, nodeId)?.node : null;
  const selected = state.selectedVectorPoint;
  const contourIndex = selected?.nodeId === node?.id ? selected.contourIndex || 0 : 0;
  if (node?.type !== 'path' || node.locked || contourIndex < 1 || !Array.isArray(node.subpaths)) return false;
  checkpoint('Remove vector contour');
  node.subpaths.splice(contourIndex - 1, 1);
  clearVectorAnchorSelection();
  recordNodeComponentOverrides(node, ['subpaths']);
  renderInspector(); renderer.invalidate(); queueSave();
  showToast('Contour removed.');
  return true;
}

function reverseSelectedPathContour(nodeId = selectedNodes()[0]?.id) {
  const entry = nodeId ? findNode(state.document, nodeId) : null;
  const node = entry?.node;
  const selected = state.selectedVectorPoint;
  const contourIndex = selected?.nodeId === node?.id ? selected.contourIndex || 0 : 0;
  const contour = vectorPathContours(node)[contourIndex];
  if (node?.type !== 'path' || node.locked || entry.parents.some(parent => parent.locked) || !contour || contour.points.length < 2) return false;
  const pointCount = contour.points.length;
  checkpoint('Reverse vector contour');
  if (!reverseVectorPathContour(node, contourIndex)) return false;
  const selectedAnchors = normalizeVectorAnchorSelection(state.selectedVectorPoints, node.id);
  if (selectedAnchors.length) {
    const remapped = selectedAnchors.map(anchor => anchor.contourIndex === contourIndex
      ? { ...anchor, index: pointCount - 1 - anchor.index } : anchor);
    setVectorAnchorSelection(remapped, selected?.nodeId === node.id && (selected.contourIndex || 0) === contourIndex
      ? { ...selected, index: pointCount - 1 - selected.index } : selected);
  } else if (selected?.nodeId === node.id && (selected.contourIndex || 0) === contourIndex) {
    setVectorAnchorSelection([{ ...selected, index: pointCount - 1 - selected.index }]);
  }
  recordNodeComponentOverrides(node, contourIndex === 0 ? ['points'] : ['subpaths']);
  renderInspector(); renderer.invalidate(); queueSave();
  showToast('Contour direction reversed. Its Bézier curves keep the same shape.');
  return true;
}

function insertPathPointOnLongestSegment(nodeId = selectedNodes()[0]?.id) {
  const node = nodeId ? findNode(state.document, nodeId)?.node : null;
  if (!node || !['path', 'network'].includes(node.type)) return;
  const context = nodeTransformContext(node);
  if (!context) return;
  const segment = node.type === 'network' ? longestVectorNetworkEdge(node, context.origin) : longestVectorSegment(node, context.origin);
  if (!segment) { showToast('This vector shape has no segment to split.'); return; }
  checkpoint('Insert vector point');
  insertPathPoint(node, node.type === 'network' ? segment.edgeId : segment.segmentIndex, segment.t, context.origin, segment.contourIndex || 0);
}

function insertPathPointAtWorld(world) {
  let node = selectedNodes().length === 1 && ['path', 'network'].includes(selectedNodes()[0].type) ? selectedNodes()[0] : null;
  if (!node) {
    const hit = hitTestPage(activePage(), world, null, state.document, null, state.zoom);
    if (!['path', 'network'].includes(hit?.type)) return false;
    node = hit;
    setSelection([node.id]);
  }
  if (node.locked || vectorPathControlAt(world)) return false;
  const context = nodeTransformContext(node);
  if (!context) return false;
  const parentPoint = pageToParentLocal(world, context.ancestors);
  const localWorld = unrotateForPath(parentPoint, context.geometry, context.origin);
  const closest = node.type === 'network'
    ? closestVectorNetworkEdge(context.geometry, localWorld, context.origin)
    : closestVectorSegment(context.geometry, localWorld, context.origin);
  if (!closest || closest.distance > 12 / Math.max(.08, state.zoom)) return false;
  checkpoint('Insert vector point');
  return insertPathPoint(node, node.type === 'network' ? closest.edgeId : closest.segmentIndex, closest.t, context.origin, closest.contourIndex || 0);
}

function updateVectorAnchorMode(input) {
  const selected = state.selectedVectorPoint;
  const entry = selected?.nodeId ? findNode(state.document, selected.nodeId) : null;
  const node = entry?.node;
  const contourIndex = selected?.contourIndex || 0;
  const pathContour = node?.type === 'path' ? vectorPathContours(node)[contourIndex] : null;
  const pathPoint = pathContour && Number.isInteger(selected.index) ? pathContour.points?.[selected.index] : null;
  const networkVertex = node?.type === 'network' && selected.vertexId ? node.vertices?.find(vertex => vertex.id === selected.vertexId) : null;
  if (!pathPoint && !networkVertex) { renderInspector(); return false; }
  if (node.locked || entry.parents.some(parent => parent.locked)) {
    renderInspector();
    showToast('Unlock this vector layer before changing an anchor.');
    return false;
  }
  if (!['corner', 'smooth', 'symmetric'].includes(input.value)) { renderInspector(); return false; }
  const currentMode = node.type === 'network'
    ? getVectorNetworkVertexMode(node, selected.vertexId)
    : pathPoint.mode || 'corner';
  if (currentMode === input.value) return true;

  checkpoint('Change vector anchor mode');
  const changed = node.type === 'network'
    ? setVectorNetworkVertexMode(node, selected.vertexId, input.value, { origin: nodeTransformContext(node)?.origin })
    : setVectorNodePointMode(node, selected.index, input.value, { contourIndex });
  if (!changed) {
    renderInspector();
    showToast('That anchor mode could not be applied.');
    return false;
  }
  recordNodeComponentOverrides(node, node.type === 'network' ? ['vertices', 'edges'] : contourIndex === 0 ? ['points'] : ['subpaths']);
  renderInspector(); queueSave(); renderer.invalidate();
  return true;
}

function deleteSelectedPathAnchors(node, anchors) {
  const entry = findNode(state.document, node.id);
  if (!entry || node.locked || entry.parents.some(parent => parent.locked)) {
    showToast('Unlock the path and its parent frames before deleting anchors.');
    return false;
  }
  const selected = normalizeVectorAnchorSelection(anchors, node.id);
  if (selected.length < 2) return false;
  if (!removeVectorPathAnchors(node, selected, { dryRun: true })) {
    showToast('Each contour must keep at least two anchors. Nothing was deleted.');
    return false;
  }
  checkpoint('Delete vector anchors');
  const removed = removeVectorPathAnchors(node, selected);
  if (!removed) return false;
  clearVectorAnchorSelection();
  recordNodeComponentOverrides(node, [...new Set(selected.map(anchor => anchor.contourIndex === 0 ? 'points' : 'subpaths'))]);
  renderInspector(); renderLayers(); renderer.invalidate(); queueSave();
  showToast(`${removed} vector anchors deleted.`);
  return true;
}

function deleteSelectedVectorPoint(nodeId = state.selectedVectorPoint?.nodeId) {
  const node = nodeId ? findNode(state.document, nodeId)?.node : null;
  if (node?.type === 'path') {
    const selectedAnchors = normalizeVectorAnchorSelection(state.selectedVectorPoints, node.id);
    if (selectedAnchors.length > 1) return deleteSelectedPathAnchors(node, selectedAnchors);
  }
  const entry = node ? findNode(state.document, node.id) : null;
  if (node?.locked || entry?.parents.some(parent => parent.locked)) {
    showToast('Unlock the layer and its parent frames before deleting an anchor.');
    return false;
  }
  const index = state.selectedVectorPoint?.index;
  const contourIndex = state.selectedVectorPoint?.contourIndex || 0;
  if (!node || state.selectedVectorPoint?.nodeId !== node.id) return false;
  checkpoint('Delete vector point');
  if (node.type === 'network') {
    if (!removeVectorNetworkVertex(node, state.selectedVectorPoint.vertexId)) { showToast('That point cannot be removed without destroying the network.'); return false; }
    clearVectorAnchorSelection();
    recordNodeComponentOverrides(node, ['vertices', 'edges', 'faces']);
  } else if (node.type === 'path' && Number.isInteger(index)) {
    const contour = vectorPathContours(node)[contourIndex];
    if (!contour || contour.points.length <= 2) { showToast('A vector contour must keep at least two points.'); return false; }
    removeVectorNodePoint(node, index, contourIndex);
    const nextAnchor = { nodeId: node.id, contourIndex, index: Math.min(index, contour.points.length - 1) };
    setVectorAnchorSelection([nextAnchor]);
    recordNodeComponentOverrides(node, contourIndex === 0 ? ['points'] : ['subpaths']);
  } else return false;
  renderInspector(); renderLayers(); renderer.invalidate(); queueSave();
  showToast('Vector point deleted.');
  return true;
}

function unrotateForPath(world, node, origin) {
  const geometry = resolvedGeometry(node);
  const center = { x: origin.x + geometry.width / 2, y: origin.y + geometry.height / 2 };
  return rotatePoint(world, center, -geometry.rotation);
}

function checkPointDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function transformEntriesForSelection() {
  return orderedRootSelectedEntries().map(entry => ({
    entry,
    node: { ...entry.node, ...resolvedGeometry(entry.node) },
    ancestors: entry.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }))
  }));
}
function applyInspectorSelectionPatches(patches, properties, frameStates = new Map()) {
  for (const patch of patches) {
    const node = findNode(state.document, patch.id)?.node;
    if (!node) continue;
    const changedProperties = properties.filter(property => Object.hasOwn(patch, property)
      && !Object.is(getNodePropertyValue(state.document, node, property), patch[property]));
    for (const property of properties) {
      if (!Object.hasOwn(patch, property)) continue;
      if (property === 'opacity') setNodePropertyValue(node, property, patch[property]);
      else node[property] = patch[property];
    }
    const frameState = frameStates.get(node.id);
    if (frameState) {
      const geometry = resolvedGeometry(node);
      if (node.autoLayout) applyAutoLayout(node);
      else applyFrameConstraints(node, frameState.width, frameState.height, geometry.width, geometry.height, frameState.childGeometry);
    }
    const boundProperties = changedProperties.filter(property => node.variableBindings?.[property]);
    if (boundProperties.length) recordNodeComponentOverrides(node, ['variableBindings']);
    recordNodeComponentOverrides(node, changedProperties.filter(property => !node.variableBindings?.[property]));
    if (frameState) {
      const instanceRoot = componentInstanceRoot(node.id);
      if (instanceRoot) for (const child of node.children || []) {
        const before = frameState.childGeometry.get(child.id);
        if (!before) continue;
        const changedChildGeometry = ['x', 'y', 'width', 'height'].filter(property => !Object.is(before[property], child[property]));
        if (changedChildGeometry.length) recordNodeComponentOverrides(child, changedChildGeometry);
      }
    }
  }
  renderer.invalidate();
}
function selectionResizeBounds(entries, bounds, property, targetSize) {
  const handle = property === 'width' ? 'e' : 's';
  const origin = property === 'width' ? bounds.x : bounds.y;
  const center = property === 'width' ? bounds.center.y : bounds.center.x;
  const makePatches = candidateSize => resizeSelection(entries, bounds, handle,
    property === 'width' ? { x: origin + candidateSize, y: center } : { x: center, y: origin + candidateSize }, { minSize: 1 });
  const measure = patches => {
    const byId = new Map(patches.map(patch => [patch.id, patch]));
    const updated = entries.map(({ node, ancestors }) => ({
      node: { ...node, ...byId.get(node.id) },
      ancestors: ancestors.map(parent => ({ ...parent, ...byId.get(parent.id) }))
    }));
    const nextBounds = selectionBounds(updated);
    return { patches, value: nextBounds[property] };
  };
  const rotated = entries.some(({ node, ancestors }) => [node, ...ancestors].some(item => Math.abs(Number(item.rotation) || 0) > 1e-7));
  if (!rotated) {
    const exact = measure(makePatches(targetSize));
    if (Math.abs(exact.value - targetSize) > Math.max(1e-4, targetSize * 1e-7)) {
      throw new RangeError(`The selected layers cannot reach a ${property} of ${targetSize}.`);
    }
    return exact.patches;
  }
  let low = 0;
  let high = Math.max(1, bounds[property], targetSize);
  let highResult = measure(makePatches(high));
  while (highResult.value < targetSize && high < 1_000_000) {
    high = Math.min(1_000_000, high * 2);
    highResult = measure(makePatches(high));
  }
  const lowResult = measure(makePatches(low));
  if (lowResult.value > targetSize + 1e-5 || highResult.value < targetSize - 1e-5) {
    throw new RangeError(`The selected layers cannot reach a ${property} of ${targetSize} with their current rotations.`);
  }
  let best = Math.abs(lowResult.value - targetSize) <= Math.abs(highResult.value - targetSize) ? lowResult : highResult;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (low + high) / 2;
    const candidate = measure(makePatches(middle));
    if (Math.abs(candidate.value - targetSize) < Math.abs(best.value - targetSize)) best = candidate;
    if (candidate.value < targetSize) low = middle;
    else high = middle;
  }
  if (Math.abs(best.value - targetSize) > Math.max(1e-4, targetSize * 1e-7)) {
    throw new RangeError(`The selected layers cannot reach a ${property} of ${targetSize} with their current rotations.`);
  }
  return best.patches;
}
function updateSelectionInspectorInput(input) {
  const property = input.dataset.prop.slice('selection.'.length);
  if (!['x', 'y', 'width', 'height', 'rotation', 'opacity'].includes(property) || !input.value.trim()) return;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  const entries = transformEntriesForSelection();
  if (!entries.length) return;
  const bounds = selectionBounds(entries);
  let patches;
  let properties;
  let frameStates = new Map();
  if (property === 'opacity') {
    if (entries.some(({ node, ancestors }) => node.locked || ancestors.some(parent => parent.locked))) return;
    const opacity = Math.max(0, Math.min(100, value)) / 100;
    patches = entries.map(({ node }) => ({ id: node.id, opacity }));
    properties = ['opacity'];
  } else if (property === 'x' || property === 'y') {
    if (selectionInspectorMovementBlock(entries)) return;
    const delta = { x: property === 'x' ? value - bounds.x : 0, y: property === 'y' ? value - bounds.y : 0 };
    patches = translateSelection(entries, delta);
    properties = ['x', 'y'];
  } else {
    if (!canTransformSelectionTogether(entries)) return;
    if (property === 'width' || property === 'height') {
      const size = Math.max(1, Math.min(100_000, value));
      if (selectionDimensionIsHugged(entries, property)) return;
      try { patches = selectionResizeBounds(entries, bounds, property, size); }
      catch (error) { showToast(error.message || `Could not set selection ${property}.`); return; }
      properties = ['x', 'y', 'width', 'height'];
      frameStates = new Map(entries.filter(({ node }) => node.type === 'frame')
        .map(({ node }) => [node.id, { width: node.width, height: node.height, childGeometry: captureChildGeometry(node) }]));
    } else {
      const rotation = value;
      patches = entries.map(({ node }) => ({ id: node.id, x: node.x, y: node.y, rotation }));
      properties = ['rotation'];
    }
  }
  if (!state.controlEdit) { checkpoint('Edit selection properties'); state.controlEdit = true; }
  applyInspectorSelectionPatches(patches, properties, frameStates);
}
function canTransformSelectionTogether(entries) {
  return entries.length > 0 && entries.every(({ node, ancestors }) =>
    !node.locked && !ancestors.some(parent => parent.locked)
    && !(ancestors.at(-1)?.autoLayout && node.layoutPositioning !== 'absolute')
    && !['x', 'y', 'width', 'height', 'rotation'].some(property => node.variableBindings?.[property]));
}
function selectionDimensionIsHugged(entries, property) {
  return entries.some(({ node }) => {
    if (node.type !== 'frame' || !node.autoLayout) return false;
    const layout = resolveAutoLayoutSettings(node);
    if (layout.axis === 'grid') return false;
    const horizontal = layout.axis === 'horizontal';
    const sizing = property === 'width'
      ? horizontal ? layout.mainSizing : layout.crossSizing
      : horizontal ? layout.crossSizing : layout.mainSizing;
    return sizing === 'hug';
  });
}
function selectionInspectorMovementBlock(entries) {
  if (!entries.length) return 'empty';
  if (entries.some(({ node, ancestors }) => node.locked || ancestors.some(parent => parent.locked))) return 'locked';
  if (entries.some(({ node, ancestors }) => ancestors.at(-1)?.autoLayout && node.layoutPositioning !== 'absolute')) return 'auto-layout';
  if (entries.some(({ node }) => node.variableBindings?.x || node.variableBindings?.y)) return 'shared-position-variable';
  return null;
}
function commentPinAt(world) {
  const comments = [...pageComments()].sort((a, b) => a.createdAt - b.createdAt);
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    if (checkPointDistance(world, comments[index]) <= 12 / Math.max(.08, state.zoom)) return comments[index];
  }
  return null;
}
function resizeHandleAt(event) {
  const entries = transformEntriesForSelection();
  if (!entries.length) return null;
  if (entries.length > 1 && entries.some(({ node }) => node.type === 'slice')) return null;
  const hitRadius = event.pointerType === 'touch' ? 22 : 8;
  const nearestHandle = (handles, { includeRotate = true } = {}) => nearestScreenHandle(
    { x: event.clientX, y: event.clientY },
    [
      ...Object.entries(handles.resize).map(([name, position]) => ({ kind: 'resize', name, point: worldToScreen(position, canvas, state) })),
      ...(includeRotate && handles.rotate ? [{ kind: 'rotate', point: worldToScreen(handles.rotate, canvas, state) }] : [])
    ],
    hitRadius
  );
  if (entries.length > 1) {
    if (!canTransformSelectionTogether(entries)) return null;
    const bounds = selectionBounds(entries);
    const handles = selectionGroupHandles(bounds, { rotateOffset: 24 / Math.max(.08, state.zoom) });
    const hit = nearestHandle(handles);
    if (!hit) return null;
    if (hit.kind === 'rotate') return { kind: 'group-rotate', entries, ids: entries.map(item => item.node.id), bounds, center: bounds.center };
    return { kind: 'group-resize', entries, ids: entries.map(item => item.node.id), bounds, handle: hit.name };
  }
  const { entry, node: geometry, ancestors } = entries[0];
  const node = entry.node;
  if (geometry.locked || ancestors.some(parent => parent.locked)) return null;
  if (node.type === 'slice') {
    if (['x', 'y', 'width', 'height', 'rotation'].some(property => node.variableBindings?.[property])) return null;
    const sliceGeometry = { ...geometry, rotation: 0 };
    const handles = sliceSelectionHandles(sliceGeometry);
    const hit = handles ? nearestHandle(handles, { includeRotate: false }) : null;
    return hit?.kind === 'resize'
      ? { kind: 'resize', name: hit.name, node, entry, geometry: sliceGeometry, ancestors }
      : null;
  }
  const handles = getTransformHandles(geometry, ancestors, { rotateOffset: 24 / Math.max(.08, state.zoom) });
  const hit = nearestHandle(handles);
  if (!hit) return null;
  if (hit.kind === 'resize') {
    const entry = { node, ancestors };
    const horizontalHug = selectionDimensionIsHugged([entry], 'width');
    const verticalHug = selectionDimensionIsHugged([entry], 'height');
    if ((horizontalHug && /[ew]/.test(hit.name)) || (verticalHug && /[ns]/.test(hit.name))) return null;
  }
  if (hit.kind === 'rotate') return { kind: 'rotate', node, entry, geometry, ancestors, center: nodeLocalToPage(geometry, { x: geometry.width / 2, y: geometry.height / 2 }, ancestors) };
  return { kind: 'resize', name: hit.name, node, entry, geometry, ancestors };
}
function pageBoundsForEntry(entry) {
  const geometry = { ...entry.node, ...resolvedGeometry(entry.node) };
  const ancestors = entry.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
  const corners = selectionOverlayGeometry(geometry, ancestors, { zoom: 1, rotateOffset: 0 }).corners;
  const left = Math.min(...corners.map(point => point.x));
  const top = Math.min(...corners.map(point => point.y));
  const right = Math.max(...corners.map(point => point.x));
  const bottom = Math.max(...corners.map(point => point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
function alignmentTargetBounds(movingEntries) {
  const movingIds = new Set(movingEntries.map(entry => entry.node.id));
  return pageLayerRows().filter(({ node, parents }) => !movingIds.has(node.id)
    && !parents.some(parent => movingIds.has(parent.id))
    && [node, ...parents].every(layer => getNodePropertyValue(state.document, layer, 'visible'))
  ).map(pageBoundsForEntry);
}
function selectedNodeDragStart(node, world, shiftKey, altKey = false) {
  if (!shiftKey && !state.selectedIds.includes(node.id)) setSelection([node.id]);
  const entry = findNode(state.document, node.id);
  const entries = orderedRootSelectedEntries();
  const moveBlockReason = selectionMoveBlockReason(entries.map(item => ({ node: item.node, ancestors: item.parents })));
  if (moveBlockReason === 'locked') {
    showToast('Unlock the selected layers and parent frames before moving them together.');
    return;
  }
  if (state.selectedIds.length === 1 && entry?.parent?.autoLayout && node.layoutPositioning !== 'absolute') {
    state.interaction = {
      kind: 'reorder', node, parent: entry.parent, start: world, duplicateOnDrag: Boolean(altKey), duplicated: false,
      originalSelectedIds: [...state.selectedIds],
      historyTransaction: beginCanvasHistoryTransaction(altKey ? 'Duplicate and reorder layers' : 'Reorder auto layout items')
    };
    return;
  }
  if (moveBlockReason === 'auto-layout') {
    showToast('Auto layout controls these positions. Select absolute-positioned layers to move them as a group.');
    return;
  }
  if (moveBlockReason === 'shared-position-variable') {
    showToast('Unlink position variables before moving layers together.');
    return;
  }
  const historyTransaction = beginCanvasHistoryTransaction('Move layers');
  const originals = new Map(entries.map(item => {
    const geometry = { ...item.node, ...resolvedGeometry(item.node) };
    const ancestors = item.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
    return [item.node.id, { x: geometry.x, y: geometry.y, ancestors }];
  }));
  const movingBounds = entries.map(pageBoundsForEntry);
  const targetBounds = alignmentTargetBounds(entries);
  state.smartGuides = [];
  state.interaction = {
    kind: 'move', start: world, originals, movingBounds, targetBounds, shiftKey,
    duplicateOnDrag: Boolean(altKey), duplicated: false, originalSelectedIds: [...state.selectedIds], historyTransaction
  };
}

function duplicateSelectionForCanvasDrag(interaction) {
  const reorderParentId = interaction.kind === 'reorder' ? interaction.parent?.id : null;
  const entries = orderedRootSelectedEntries();
  if (!entries.length) return false;
  const clipboard = createLayerClipboard(state.document, entries, { mode: 'copy', pageId: activePage().id });
  const result = pasteLayerClipboard(state.document, clipboard, { pageId: activePage().id, offset: 0 });
  if (!result.nodes.length) return false;

  state.document = result.document;
  const duplicatedEntries = result.nodes.map(node => findNode(state.document, node.id)).filter(Boolean);
  if (interaction.kind === 'reorder') {
    const duplicated = duplicatedEntries[0];
    const parent = reorderParentId && findNode(state.document, reorderParentId)?.node;
    if (!duplicated || !parent?.autoLayout) throw new Error('The auto layout parent is no longer available.');
    interaction.node = duplicated.node;
    interaction.parent = parent;
    applyAutoLayout(parent);
  } else {
    interaction.originals = new Map(duplicatedEntries.map(entry => {
      const geometry = { ...entry.node, ...resolvedGeometry(entry.node) };
      const ancestors = entry.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
      return [entry.node.id, { x: geometry.x, y: geometry.y, ancestors }];
    }));
    interaction.movingBounds = duplicatedEntries.map(pageBoundsForEntry);
    interaction.targetBounds = alignmentTargetBounds(duplicatedEntries);
  }
  interaction.duplicated = true;
  if (interaction.historyTransaction) interaction.historyTransaction.label = interaction.kind === 'reorder'
    ? 'Duplicate and reorder layers' : 'Duplicate and move layers';
  reconcileImageAssetRuntime();
  setSelection(result.nodes.map(node => node.id));
  return true;
}

function beginImageCropInteraction(event, world) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  const context = syncImageCropOverlay();
  if (!node || !context) { showToast('Select an image with loaded dimensions to crop it on canvas.'); return; }
  const local = pageToNodeLocal(context.geometry, world, context.ancestors);
  const handle = imageCropHandleAt(event, context);
  const visibleBounds = imageCropVisibleBounds(context);
  const withinImage = local.x >= visibleBounds.left && local.x <= visibleBounds.left + visibleBounds.width
    && local.y >= visibleBounds.top && local.y <= visibleBounds.top + visibleBounds.height;
  if (!handle && !withinImage) return;
  const transforms = createImageTransforms(node.transforms || {});
  state.imageCropDraftSelection = null;
  state.interaction = {
    kind: 'image-crop', mode: handle ? 'handle' : 'select', pointerId: event.pointerId,
    node, geometry: context.geometry, ancestors: context.ancestors,
    sourceWidth: context.sourceWidth, sourceHeight: context.sourceHeight,
    rotation: transforms.rotation, bounds: context.virtualBounds,
    flipHorizontal: transforms.flipHorizontal, flipVertical: transforms.flipVertical,
    visibleBounds,
    originalTransforms: transforms, transforms,
    crop: transforms.crop || { left: 0, top: 0, right: 1, bottom: 1 },
    handle: handle?.name || null,
    handleOffset: handle ? { x: local.x - handle.localPoint.x, y: local.y - handle.localPoint.y } : { x: 0, y: 0 },
    start: local, end: local, moved: false,
    changed: false, lastPreviewAt: 0
  };
  renderer.invalidate();
  event.preventDefault();
}

function imageFillTarget(node, fillId) {
  if (!node || typeof fillId !== 'string') return null;
  if (Array.isArray(node.fills)) return node.fills.find(fill => fill.id === fillId && fill.type === 'image')?.imageFill || null;
  const legacy = fillStackForNode(node).find(fill => fill.id === fillId && fill.type === 'image');
  return legacy ? node.imageFill || null : null;
}

function localPointForImageFillClient(point, interaction) {
  const world = screenToWorld({ clientX: point.x, clientY: point.y }, canvas, state);
  return pageToNodeLocal(interaction.context.geometry, world, interaction.context.ancestors);
}

function beginImageFillCropInteraction(event, world) {
  const target = state.imageFillCropTarget;
  const node = target?.nodeId === state.selectedIds[0] ? findNode(state.document, target.nodeId)?.node : null;
  const context = node && imageFillCropContext(node, target.fillId);
  if (!node || !context || node.locked) return;
  const local = pageToNodeLocal(context.geometry, world, context.ancestors);
  if (local.x < 0 || local.y < 0 || local.x > context.geometry.width || local.y > context.geometry.height) return;
  const imageFill = imageFillTarget(node, context.fillId);
  if (!imageFill) return;
  const transforms = createImageTransforms(imageFill.transforms || {});
  const crop = imageCropFromDisplayRect(context.crop, transforms.rotation, transforms);
  state.interaction = {
    kind: 'image-fill-crop', mode: 'drag', pointerId: event.pointerId,
    node, fillId: context.fillId, target: imageFill, context,
    sourceWidth: context.sourceWidth, sourceHeight: context.sourceHeight,
    rotation: transforms.rotation, flipHorizontal: transforms.flipHorizontal, flipVertical: transforms.flipVertical,
    bounds: context.virtualBounds, crop, transforms,
    lastLocal: local, changed: false, lastPreviewAt: 0
  };
  renderer.invalidate();
  event.preventDefault();
}

function beginImageFillCropPinch(interaction) {
  if (interaction?.kind !== 'image-fill-crop' || state.pointerMap.size < 2) return false;
  const pointers = [...state.pointerMap.entries()].slice(0, 2).map(([pointerId, point]) => ({
    pointerId, point, local: localPointForImageFillClient(point, interaction)
  }));
  const distance = checkPointDistance(pointers[0].point, pointers[1].point);
  if (distance < 1) return false;
  interaction.mode = 'pinch';
  interaction.pointerIds = pointers.map(pointer => pointer.pointerId);
  interaction.pinchStartDistance = distance;
  interaction.pinchStartBounds = interaction.bounds;
  interaction.pinchStartFocal = {
    x: (pointers[0].local.x + pointers[1].local.x) / 2,
    y: (pointers[0].local.y + pointers[1].local.y) / 2
  };
  interaction.pinchStartCrop = interaction.crop;
  interaction.pinchStartTransforms = interaction.transforms;
  return true;
}

function applyImageFillCrop(interaction, crop) {
  if (!interaction.changed && !interaction.transforms.crop && interaction.crop
    && ['left', 'top', 'right', 'bottom'].every(edge => Math.abs(crop[edge] - interaction.crop[edge]) < 1e-10)) return false;
  const transforms = createImageTransforms({ ...interaction.transforms, crop });
  if (JSON.stringify(transforms) === JSON.stringify(interaction.target.transforms || createImageTransforms())) return false;
  if (!interaction.historyTransaction) interaction.historyTransaction = beginCanvasHistoryTransaction('Adjust image fill');
  if (!Array.isArray(interaction.node.fills)) {
    const materialized = ensureFillStack(interaction.node).find(fill => fill.id === interaction.fillId && fill.type === 'image');
    if (!materialized) return false;
    interaction.target = materialized.imageFill;
  }
  interaction.target.transforms = transforms;
  interaction.transforms = transforms;
  interaction.crop = transforms.crop;
  interaction.changed = true;
  const now = performance.now();
  if (now - interaction.lastPreviewAt >= 140) {
    interaction.lastPreviewAt = now;
    schedulePreview(interaction.node, true, interaction.fillId);
  }
  syncImageCropOverlay();
  renderer.invalidate();
  return true;
}

function moveImageFillCropInteraction(interaction, event) {
  if (interaction.mode === 'pinch') {
    const points = interaction.pointerIds.map(pointerId => state.pointerMap.get(pointerId)).filter(Boolean);
    if (points.length < 2) return;
    const local = points.map(point => localPointForImageFillClient(point, interaction));
    const focal = { x: (local[0].x + local[1].x) / 2, y: (local[0].y + local[1].y) / 2 };
    const pointerDistance = checkPointDistance(points[0], points[1]);
    const deltaX = focal.x - interaction.pinchStartFocal.x;
    const deltaY = focal.y - interaction.pinchStartFocal.y;
    const bounds = interaction.pinchStartBounds || interaction.bounds;
    const moved = moveImageFillCropWindow({
      crop: interaction.pinchStartCrop, deltaX, deltaY, bounds,
      sourceWidth: interaction.sourceWidth, sourceHeight: interaction.sourceHeight,
      rotation: interaction.rotation, flipHorizontal: interaction.flipHorizontal, flipVertical: interaction.flipVertical
    });
    const crop = zoomImageFillCropWindow({
      crop: moved, zoom: pointerDistance / interaction.pinchStartDistance, focal, bounds,
      sourceWidth: interaction.sourceWidth, sourceHeight: interaction.sourceHeight,
      rotation: interaction.rotation, flipHorizontal: interaction.flipHorizontal, flipVertical: interaction.flipVertical
    });
    applyImageFillCrop(interaction, crop);
    return;
  }
  if (interaction.pointerId !== event.pointerId) return;
  const local = localPointForImageFillClient({ x: event.clientX, y: event.clientY }, interaction);
  const deltaX = local.x - interaction.lastLocal.x;
  const deltaY = local.y - interaction.lastLocal.y;
  interaction.lastLocal = local;
  if (Math.hypot(deltaX, deltaY) < 1e-4) return;
  const crop = moveImageFillCropWindow({
    crop: interaction.crop, deltaX, deltaY, bounds: interaction.bounds,
    sourceWidth: interaction.sourceWidth, sourceHeight: interaction.sourceHeight,
    rotation: interaction.rotation, flipHorizontal: interaction.flipHorizontal, flipVertical: interaction.flipVertical
  });
  applyImageFillCrop(interaction, crop);
}

function finishImageFillCropInteraction(interaction) {
  state.interaction = null;
  if (interaction.changed) {
    const fills = Array.isArray(interaction.node.fills) ? interaction.node.fills : null;
    const fill = fills?.find(item => item.id === interaction.fillId);
    if (fill && fill === fills[0]) syncLegacyFillFields(interaction.node);
    recordNodeComponentOverrides(interaction.node, fills
      ? ['fills', ...(fill === fills[0] ? ['imageFill'] : [])]
      : ['imageFill']);
    commitCanvasHistoryTransaction(interaction);
    schedulePreview(interaction.node, true, interaction.fillId);
    renderInspector();
    queueSave();
  }
  syncImageCropOverlay();
  renderer.invalidate();
}

function onCanvasPointerDown(event) {
  if (state.documentTransitioning) return;
  if (event.button !== 0 && event.button !== 1) return;
  state.pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType });
  canvas.setPointerCapture?.(event.pointerId);
  if (state.imageCropMode && state.imageFillCropTarget && !state.spaceDown && event.button === 0) {
    if (state.pointerMap.size === 2 && [...state.pointerMap.values()].every(point => point.pointerType !== 'mouse')) {
      if (beginImageFillCropPinch(state.interaction)) { event.preventDefault(); return; }
    } else if (state.pointerMap.size === 1) {
      beginImageFillCropInteraction(event, screenToWorld(event, canvas, state));
      return;
    }
  }
  if (state.pointerMap.size === 2 && [...state.pointerMap.values()].every(point => point.pointerType !== 'mouse')) {
    const interruptedInteraction = state.interaction;
    if (interruptedInteraction?.kind === 'pencil-stroke') {
      cancelPencilStroke({ retainPointer: true });
    } else if (interruptedInteraction?.kind === 'draw') {
      // A second finger takes over navigation. Discard an unfinished shape so
      // it cannot remain as a ghost preview after the pinch has ended.
      state.draftNode = null;
      state.interaction = null;
      renderer.invalidate();
    } else if (interruptedInteraction?.kind === 'lasso') {
      // A second finger takes over navigation. Discard an unfinished freeform
      // selection instead of completing an accidental selection on pointer-up.
      state.interaction = null;
      renderer.invalidate();
    } else if (interruptedInteraction) {
      // Finish edits at the last one-finger position before switching gesture
      // ownership. The ordinary pointer-up path records overrides and saves
      // moves, transforms, and vector-control edits consistently.
      const activePointer = [...state.pointerMap.entries()].find(([pointerId]) => pointerId !== event.pointerId);
      if (activePointer) {
        const [pointerId, position] = activePointer;
        onCanvasPointerUp({ pointerId, type: 'pointerup' });
        state.pointerMap.set(pointerId, position);
      }
    }
    const points = [...state.pointerMap.values()];
    state.interaction = { kind: 'pinch', distance: checkPointDistance(points[0], points[1]), zoom: state.zoom, center: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, panX: state.panX, panY: state.panY };
    event.preventDefault(); return;
  }
  if (event.button === 1 || state.spaceDown || (state.tool === 'hand' && !state.imageCropMode)) {
    state.interaction = { kind: 'pan', clientX: event.clientX, clientY: event.clientY, panX: state.panX, panY: state.panY };
    canvas.classList.add('is-panning'); event.preventDefault(); return;
  }
  if (isImageRecipeBatchActive(state.bulk)) {
    showToast('Canvas edits are paused while the image recipe batch is running. You can still pan and use the Layers panel.');
    state.pointerMap.delete(event.pointerId);
    return;
  }
  const world = screenToWorld(event, canvas, state);
  // Crop mode owns ordinary canvas taps regardless of the active drawing or
  // prototype tool. Space/middle-button pan and two-finger pinch remain usable.
  if (state.imageCropMode) { beginImageCropInteraction(event, world); return; }
  if (state.tool === 'lasso') {
    const additive = event.shiftKey || (event.pointerType !== 'mouse' && state.selectedIds.length > 0);
    state.interaction = { kind: 'lasso', pointerId: event.pointerId, points: [world], additive };
    renderer.invalidate(); event.preventDefault(); return;
  }
  if (state.tool === 'eyedropper') {
    sampleEyedropperAt(event);
    event.preventDefault();
    return;
  }
  const commentPin = commentPinAt(world);
  if (commentPin) { openCommentThread(commentPin.id); event.preventDefault(); return; }
  if (state.tool === 'comment') { beginCommentAt(world); event.preventDefault(); return; }
  if (clearPrototypeConnectPromptIfSourceMissing()) {
    renderInspector();
    showToast('The prototype source is unavailable. Select a supported layer to start a new connection.');
    event.preventDefault(); return;
  }
  if (state.prototypeSourceId) {
    const target = findFrameAtPoint(activePage(), world, state.document);
    if (!target) { showToast('Choose a frame as the interaction destination.'); return; }
    if (target.id === state.prototypeSourceId) { showToast('Choose a different destination frame.'); return; }
    try {
      const condition = buildPrototypeInteractionCondition();
      checkpoint('Add prototype interaction');
      addPrototypeInteraction(state.document, state.prototypeSourceId, target.id, {
        action: state.prototypeAction,
        trigger: state.prototypeTrigger,
        delay: state.prototypeDelay,
        transition: state.prototypeTransition,
        easing: state.prototypeEasing,
        duration: state.prototypeDuration,
        condition,
        overlayPosition: state.prototypeOverlayPosition,
        overlayOutsideClick: state.prototypeOverlayOutsideClick,
        overlayBackground: state.prototypeOverlayBackground,
        overlayBackgroundColor: state.prototypeOverlayBackgroundColor,
        overlayBackgroundOpacity: state.prototypeOverlayBackgroundOpacity
      });
      const interactionSource = findNode(state.document, state.prototypeSourceId)?.node;
      if (interactionSource) recordNodeComponentOverrides(interactionSource, ['interactions']);
      clearPrototypeConnectPrompt();
      renderInspector(); queueSave(); renderer.invalidate();
      showToast(state.prototypeAction === 'open-overlay' ? `Overlay “${target.name}” added.` : `Connected to “${target.name}”.`);
    } catch (error) { showToast(error.message); }
    event.preventDefault(); return;
  }
  if (state.tool === 'pen') { startPenPath(world, event.pointerType); event.preventDefault(); return; }
  if (state.tool === 'pencil') { startPencilStroke(world, event); event.preventDefault(); return; }
  if (state.tool === 'select') {
    if (state.showRulers && !state.presenting) {
      const guide = guideAtClientPoint(event);
      if (guide) {
        state.selectedRulerGuideId = guide.id;
        $(`#ruler-${guide.axis === 'x' ? 'horizontal' : 'vertical'}`).focus({ preventScroll: true });
        state.interaction = {
          kind: 'ruler-guide-move', axis: guide.axis, guideId: guide.id,
          pageId: state.document.activePageId, pointerId: event.pointerId,
          historyTransaction: beginCanvasHistoryTransaction('Move ruler guide'), changed: false
        };
        renderer.invalidate(); event.preventDefault(); return;
      }
    }
    const gradientHandle = gradientGeometryHandleAt(event);
    if (gradientHandle) {
      const handles = normalizedGradientHandles(gradientHandle);
      if (!handles) return;
      state.interaction = {
        kind: 'gradient-geometry', ...gradientHandle, handles,
        pointerId: event.pointerId, changed: false,
        historyTransaction: beginCanvasHistoryTransaction('Edit gradient geometry')
      };
      event.preventDefault(); return;
    }
    const vectorControl = vectorPathControlAt(world, event.pointerType);
    if (vectorControl) {
      if (vectorControl.node.type === 'network') {
        clearVectorAnchorSelection();
        state.selectedVectorPoint = vectorControl.part === 'anchor' ? { nodeId: vectorControl.node.id, vertexId: vectorControl.vertexId } : null;
        state.interaction = { kind: 'network-control', ...vectorControl, historyTransaction: beginCanvasHistoryTransaction('Edit vector network') };
      } else {
        const anchor = { nodeId: vectorControl.node.id, contourIndex: vectorControl.contourIndex || 0, index: vectorControl.index };
        if (vectorControl.part === 'anchor' && (state.vectorPointSelectMode || event.shiftKey)) {
          toggleVectorAnchor(anchor);
          renderInspector(); renderer.invalidate();
          event.preventDefault(); return;
        }
        if (vectorControl.part !== 'anchor') {
          state.vectorPointSelectMode = false;
          setVectorAnchorSelection([anchor], anchor);
          state.interaction = { kind: 'vector-control', ...vectorControl, historyTransaction: beginCanvasHistoryTransaction('Edit vector path') };
        } else {
          const selectedAnchors = normalizeVectorAnchorSelection(state.selectedVectorPoints, vectorControl.node.id);
          const isPartOfGroup = selectedAnchors.length > 1
            && selectedAnchors.some(item => vectorAnchorKey(item) === vectorAnchorKey(anchor));
          state.vectorPointSelectMode = false;
          if (!isPartOfGroup) setVectorAnchorSelection([anchor], anchor);
          else setVectorAnchorSelection(selectedAnchors, anchor);
          if (isPartOfGroup) {
            const geometry = { ...vectorControl.node, ...resolvedGeometry(vectorControl.node) };
            const origins = new Map(selectedAnchors.map(item => {
              const points = item.contourIndex === 0 ? vectorControl.node.points : vectorControl.node.subpaths?.[item.contourIndex - 1]?.points;
              const point = points?.[item.index];
              return [vectorAnchorKey(item), { x: point?.x, y: point?.y }];
            }));
            state.interaction = {
              kind: 'vector-anchor-group', node: vectorControl.node, anchors: selectedAnchors, geometry,
              ancestors: vectorControl.ancestors, startLocal: pageToNodeLocal(geometry, world, vectorControl.ancestors), origins,
              changedContours: new Set(), historyTransaction: beginCanvasHistoryTransaction('Move vector anchors')
            };
          } else {
            state.interaction = { kind: 'vector-control', ...vectorControl, historyTransaction: beginCanvasHistoryTransaction('Edit vector path') };
          }
        }
      }
      event.preventDefault(); return;
    }
    const handle = resizeHandleAt(event);
    if (handle) {
      if (handle.kind === 'rotate') {
        const angle = Math.atan2(world.y - handle.center.y, world.x - handle.center.x);
        state.interaction = { kind: 'rotate', node: handle.node, entry: handle.entry, center: handle.center, startAngle: angle, lastAngle: angle, rotationDelta: 0, rotation: handle.geometry.rotation || 0, historyTransaction: beginCanvasHistoryTransaction('Rotate layer') };
      } else if (handle.kind === 'group-rotate') {
        const startAngle = Math.atan2(world.y - handle.center.y, world.x - handle.center.x);
        state.interaction = { ...handle, kind: 'group-rotate', lastAngle: startAngle, delta: 0, historyTransaction: beginCanvasHistoryTransaction('Rotate layers') };
      } else if (handle.kind === 'group-resize') {
        const frameStates = new Map(handle.entries
          .filter(({ node }) => node.type === 'frame')
          .map(({ node }) => [node.id, { width: node.width, height: node.height, childGeometry: captureChildGeometry(node) }]));
        state.interaction = { ...handle, kind: 'group-resize', frameStates, historyTransaction: beginCanvasHistoryTransaction('Resize layers') };
      } else {
        const geometry = handle.geometry;
        state.interaction = { kind: 'resize', handle: handle.name, node: handle.node, entry: handle.entry, ancestors: handle.ancestors, rect: geometry, width: geometry.width, height: geometry.height, historyTransaction: beginCanvasHistoryTransaction('Resize layer') };
        if (handle.node.type === 'frame') state.interaction.childGeometry = captureChildGeometry(handle.node);
      }
      event.preventDefault(); return;
    }
    const hit = hitTestPage(activePage(), world, (node, point, x, y) => renderer?.hitTestBoolean(node, point, x, y) ?? true, state.document, null, state.zoom);
    if (hit) {
      if (event.shiftKey) {
        const ids = state.selectedIds.includes(hit.id) ? state.selectedIds.filter(id => id !== hit.id) : [...state.selectedIds, hit.id];
        setSelection(ids);
        if (!ids.includes(hit.id)) return;
      } else if (!state.selectedIds.includes(hit.id)) setSelection([hit.id]);
      if (!hit.locked) selectedNodeDragStart(hit, world, event.shiftKey, event.altKey);
      return;
    }
    const previousSelection = [...state.selectedIds];
    if (!event.shiftKey) setSelection([]);
    state.marquee = { x1: world.x, y1: world.y, x2: world.x, y2: world.y };
    state.interaction = { kind: 'marquee', start: world, additive: event.shiftKey, previousSelection };
    renderer.invalidate(); return;
  }
  if (state.tool === 'image') { $('#image-input').click(); return; }
  if (state.tool === 'text') { createTextAt(world); return; }
  const typeByTool = { frame: 'frame', section: 'section', slice: 'slice', rectangle: 'rectangle', ellipse: 'ellipse', line: 'line', polygon: 'polygon', star: 'star' };
  const type = typeByTool[state.tool];
  if (!type) return;
  const node = createNode(type, { x: world.x, y: world.y, width: 1, height: 1 });
  state.draftNode = node;
  state.interaction = { kind: 'draw', type, start: world, moved: false };
  renderer.invalidate();
  event.preventDefault();
}

function updateDraftShapeGeometry(interaction, world, event) {
  const dx = world.x - interaction.start.x;
  const dy = world.y - interaction.start.y;
  interaction.moved ||= Math.hypot(dx, dy) > 4 / state.zoom;
  const node = state.draftNode;
  if (!node) return;
  const geometry = shapeCreationGeometry(interaction.type, interaction.start, world, {
    shiftKey: event.shiftKey,
    altKey: event.altKey
  });
  Object.assign(node, geometry);
  if (node.type !== 'line') delete node.lineReverseY;
  if (node.type === 'path') node.points = [{ x: dx < 0 ? 1 : 0, y: dy < 0 ? 1 : 0 }, { x: dx < 0 ? 0 : 1, y: dy < 0 ? 0 : 1 }];
  state.draftNode = node;
}

function onCanvasPointerMove(event) {
  if (state.pointerMap.has(event.pointerId)) state.pointerMap.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType });
  const interaction = state.interaction;
  if (!interaction) {
    if (state.penDraft && state.tool === 'pen') { state.penHover = screenToWorld(event, canvas, state); renderer.invalidate(); }
    return;
  }
  if (interaction.kind === 'ruler-guide-move') { updateRulerGuideGesture(event); return; }
  if (interaction.kind === 'pinch' && state.pointerMap.size >= 2) {
    const points = [...state.pointerMap.values()];
    const distance = checkPointDistance(points[0], points[1]);
    const nextZoom = Math.max(.08, Math.min(8, interaction.zoom * (distance / Math.max(1, interaction.distance))));
    const rect = canvas.getBoundingClientRect();
    const centerX = (points[0].x + points[1].x) / 2 - rect.left;
    const centerY = (points[0].y + points[1].y) / 2 - rect.top;
    const worldX = (centerX - interaction.panX) / interaction.zoom;
    const worldY = (centerY - interaction.panY) / interaction.zoom;
    state.zoom = nextZoom; state.panX = centerX - worldX * nextZoom; state.panY = centerY - worldY * nextZoom;
    updateZoomUI(); renderer.invalidate(); return;
  }
  if (interaction.kind === 'pan') {
    state.panX = interaction.panX + event.clientX - interaction.clientX;
    state.panY = interaction.panY + event.clientY - interaction.clientY;
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'pencil-stroke') {
    if (interaction.pointerId === event.pointerId && state.pencilDraft?.pointerId === event.pointerId) {
      appendPencilPointerEvent(event, state.pencilDraft);
      renderer.invalidate();
    }
    return;
  }
  const world = screenToWorld(event, canvas, state);
  if (interaction.kind === 'lasso') {
    if (interaction.pointerId !== event.pointerId) return;
    appendLassoPoint(interaction.points, world, { minDistance: 1.25 / Math.max(.08, state.zoom) });
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'image-fill-crop') {
    if (!state.imageCropMode || state.selectedIds.length !== 1 || state.selectedIds[0] !== interaction.node.id) {
      cancelCanvasInteraction({ pointerId: event.pointerId });
      return;
    }
    moveImageFillCropInteraction(interaction, event);
    return;
  }
  if (interaction.kind === 'image-crop') {
    if (interaction.pointerId !== event.pointerId) return;
    if (!state.imageCropMode || state.selectedIds.length !== 1 || state.selectedIds[0] !== interaction.node.id) {
      cancelCanvasInteraction({ pointerId: event.pointerId });
      return;
    }
    const local = pageToNodeLocal(interaction.geometry, world, interaction.ancestors);
    const cropPoint = interaction.mode === 'select' ? clampImageCropPoint(local, interaction.visibleBounds) : local;
    interaction.end = cropPoint;
    interaction.moved ||= checkPointDistance(interaction.start, cropPoint) > 2 / Math.max(.08, state.zoom);
    if (interaction.mode === 'select') {
      state.imageCropDraftSelection = { nodeId: interaction.node.id, start: interaction.start, end: cropPoint };
      renderer.invalidate();
      return;
    }
    if (!interaction.moved) return;
    const crop = moveImageCropHandle({
      crop: interaction.crop, handle: interaction.handle,
      point: { x: local.x - interaction.handleOffset.x, y: local.y - interaction.handleOffset.y },
      bounds: interaction.bounds, rotation: interaction.rotation,
      flipHorizontal: interaction.flipHorizontal, flipVertical: interaction.flipVertical,
      sourceWidth: interaction.sourceWidth, sourceHeight: interaction.sourceHeight
    });
    const transforms = createImageTransforms({ ...interaction.transforms, crop });
    if (JSON.stringify(transforms) === JSON.stringify(interaction.node.transforms || createImageTransforms())) return;
    if (!interaction.changed) interaction.historyTransaction = beginCanvasHistoryTransaction('Crop image');
    interaction.changed = true;
    interaction.crop = transforms.crop;
    interaction.transforms = transforms;
    interaction.node.transforms = transforms;
    syncImageCropOverlay();
    const now = performance.now();
    if (now - interaction.lastPreviewAt >= 140) {
      interaction.lastPreviewAt = now;
      schedulePreview(interaction.node, true);
    }
    renderer.invalidate();
    return;
  }
  if (interaction.kind === 'pen-anchor') {
    const point = state.penDraft?.anchors[interaction.pointIndex];
    if (!point) return;
    interaction.moved ||= checkPointDistance(world, interaction.start) > 3 / state.zoom;
    point.out = { ...world };
    point.in = { x: point.x - (world.x - point.x), y: point.y - (world.y - point.y) };
    state.penHover = world; renderer.invalidate(); return;
  }
  if (interaction.kind === 'gradient-geometry') {
    if (interaction.pointerId !== event.pointerId) return;
    if (moveGradientGeometryHandle(interaction, world)) renderer.invalidate();
    return;
  }
  if (interaction.kind === 'vector-control') {
    const geometry = { ...interaction.node, ...resolvedGeometry(interaction.node) };
    const local = pageToNodeLocal(geometry, world, interaction.ancestors);
    setVectorNodePoint(interaction.node, interaction.index, interaction.part, local, {
      origin: interaction.origin,
      symmetric: interaction.part !== 'anchor' && !event.altKey,
      contourIndex: interaction.contourIndex || 0
    });
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'vector-anchor-group') {
    const local = pageToNodeLocal(interaction.geometry, world, interaction.ancestors);
    const delta = { x: local.x - interaction.startLocal.x, y: local.y - interaction.startLocal.y };
    if ((delta.x || delta.y) && setVectorPathAnchorTranslation(interaction.node, interaction.anchors, delta, interaction.geometry, interaction.origins)) {
      interaction.anchors.forEach(anchor => interaction.changedContours.add(anchor.contourIndex));
      renderer.invalidate();
    }
    return;
  }
  if (interaction.kind === 'network-control') {
    const geometry = { ...interaction.node, ...resolvedGeometry(interaction.node) };
    const local = pageToNodeLocal(geometry, world, interaction.ancestors);
    if (interaction.part === 'anchor') setVectorNetworkVertexPoint(interaction.node, interaction.vertexId, local, interaction.origin);
    else setVectorNetworkEdgeControlPoint(interaction.node, interaction.edgeId, interaction.part, local, interaction.origin);
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'move') {
    if (interaction.duplicateOnDrag && !interaction.duplicated) {
      const distance = checkPointDistance(interaction.start, world);
      const threshold = 4 / Math.max(.08, state.zoom);
      if (distance <= threshold) return;
      try {
        if (!duplicateSelectionForCanvasDrag(interaction)) {
          showToast('Select one or more layers to duplicate.');
          cancelCanvasInteraction({ pointerId: event.pointerId });
          return;
        }
      } catch (error) {
        showToast(error.message || 'Could not duplicate these layers.');
        cancelCanvasInteraction({ pointerId: event.pointerId });
        return;
      }
    }
    const pageDx = world.x - interaction.start.x; const pageDy = world.y - interaction.start.y;
    const movement = event.altKey
      ? { x: pageDx, y: pageDy, guides: [] }
      : snapToAlignmentGuides(interaction.movingBounds, interaction.targetBounds,
        { x: pageDx, y: pageDy }, 7 / Math.max(.08, state.zoom));
    state.smartGuides = movement.guides;
    const movedWorld = { x: interaction.start.x + movement.x, y: interaction.start.y + movement.y };
    const grid = state.document.settings.grid || 8;
    for (const [id, original] of interaction.originals) {
      const node = findNode(state.document, id)?.node;
      if (!node) continue;
      const startLocal = pageToParentLocal(interaction.start, original.ancestors);
      const currentLocal = pageToParentLocal(movedWorld, original.ancestors);
      let dx = currentLocal.x - startLocal.x; let dy = currentLocal.y - startLocal.y;
      if (state.document.settings.snap && !event.altKey && !movement.guides.length) { dx = Math.round(dx / grid) * grid; dy = Math.round(dy / grid) * grid; }
      setNodePropertyValue(node, 'x', original.x + dx);
      setNodePropertyValue(node, 'y', original.y + dy);
    }
    $('#position-status').textContent = `${Math.round(movement.x)}, ${Math.round(movement.y)} moved${movement.guides.length ? ' · Aligned' : ''}`;
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'group-rotate') {
    const angle = Math.atan2(world.y - interaction.center.y, world.x - interaction.center.x);
    interaction.delta += shortestAngleDelta(interaction.lastAngle, angle) * 180 / Math.PI;
    interaction.lastAngle = angle;
    const rotationDelta = event.shiftKey ? Math.round(interaction.delta / 15) * 15 : interaction.delta;
    for (const patch of rotateSelection(interaction.entries, interaction.center, rotationDelta)) {
      const node = findNode(state.document, patch.id)?.node;
      if (!node) continue;
      node.x = patch.x; node.y = patch.y; node.rotation = patch.rotation;
    }
    $('#position-status').textContent = `${Math.round(rotationDelta)}° · ${interaction.ids.length} layers`;
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'group-resize') {
    const aspectRatio = selectionAspectRatio(interaction.bounds);
    const patches = resizeSelection(interaction.entries, interaction.bounds, interaction.handle, world, {
      aspectRatio: event.shiftKey ? aspectRatio : undefined
    });
    for (const patch of patches) {
      const node = findNode(state.document, patch.id)?.node;
      if (!node) continue;
      for (const property of ['x', 'y', 'width', 'height']) node[property] = patch[property];
      const frame = interaction.frameStates.get(node.id);
      if (frame) {
        const geometry = resolvedGeometry(node);
        if (node.autoLayout) applyAutoLayout(node);
        else applyFrameConstraints(node, frame.width, frame.height, geometry.width, geometry.height, frame.childGeometry);
      }
    }
    $('#position-status').textContent = `${interaction.ids.length} layers resized`;
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'rotate') {
    const angle = Math.atan2(world.y - interaction.center.y, world.x - interaction.center.x);
    const delta = shortestAngleDelta(interaction.lastAngle, angle);
    interaction.rotationDelta += delta * 180 / Math.PI;
    interaction.lastAngle = angle;
    const nextRotation = interaction.rotation + interaction.rotationDelta;
    setNodePropertyValue(interaction.node, 'rotation', event.shiftKey ? Math.round(nextRotation / 15) * 15 : nextRotation);
    $('#position-status').textContent = `${Math.round(resolvedGeometry(interaction.node).rotation)}° rotation`;
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'reorder' && interaction.duplicateOnDrag && !interaction.duplicated) {
    if (checkPointDistance(interaction.start || world, world) <= 4 / Math.max(.08, state.zoom)) return;
    try {
      if (!duplicateSelectionForCanvasDrag(interaction)) {
        showToast('Select one or more layers to duplicate.');
        cancelCanvasInteraction({ pointerId: event.pointerId });
        return;
      }
    } catch (error) {
      showToast(error.message || 'Could not duplicate these layers.');
      cancelCanvasInteraction({ pointerId: event.pointerId });
      return;
    }
  }
  if (interaction.kind === 'reorder') {
    const parent = interaction.parent;
    const parentWorld = absolutePosition(parent.id);
    const axis = parent.autoLayout.axis;
    const localMain = axis === 'horizontal' ? world.x - parentWorld.x : world.y - parentWorld.y;
    const siblings = parent.children.filter(item => item.id !== interaction.node.id && item.visible && item.layoutPositioning !== 'absolute');
    const targetIndex = siblings.findIndex(item => {
      const center = axis === 'horizontal' ? item.x + item.width / 2 : item.y + item.height / 2;
      return localMain < center;
    });
    const remaining = parent.children.filter(item => item.id !== interaction.node.id);
    const target = targetIndex < 0 ? null : siblings[targetIndex];
    const insertionIndex = target ? remaining.indexOf(target) : remaining.length;
    reorderNode(state.document, interaction.node.id, insertionIndex);
    applyAutoLayout(parent);
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'resize') {
    const aspectRatio = event.shiftKey && interaction.rect.height ? interaction.rect.width / interaction.rect.height : undefined;
    const resized = resizeOrientedRect(interaction.rect, interaction.handle, world, interaction.ancestors, { aspectRatio });
    for (const property of ['x', 'y', 'width', 'height']) setNodePropertyValue(interaction.node, property, resized[property]);
    const geometry = resolvedGeometry(interaction.node);
    if (interaction.node.type === 'frame' && interaction.node.autoLayout) applyAutoLayout(interaction.node);
    else if (interaction.node.type === 'frame') applyFrameConstraints(interaction.node, interaction.width, interaction.height, geometry.width, geometry.height, interaction.childGeometry);
    const parent = findNode(state.document, interaction.node.id)?.parent;
    if (parent?.autoLayout) applyAutoLayout(parent);
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'draw') {
    updateDraftShapeGeometry(interaction, world, event);
    renderer.invalidate(); return;
  }
  if (interaction.kind === 'marquee') {
    state.marquee.x2 = world.x; state.marquee.y2 = world.y; renderer.invalidate();
  }
}

function onCanvasPointerUp(event) {
  state.pointerMap.delete(event.pointerId);
  const interaction = state.interaction;
  if (!interaction) return;
  if (interaction.kind === 'ruler-guide-move') { finishRulerGuideGesture(event); return; }
  if (interaction.kind === 'image-fill-crop') {
    if (interaction.mode === 'pinch' && interaction.pointerIds?.includes(event.pointerId) && state.pointerMap.size) {
      const [pointerId, point] = state.pointerMap.entries().next().value;
      interaction.mode = 'drag';
      interaction.pointerId = pointerId;
      interaction.lastLocal = localPointForImageFillClient(point, interaction);
      interaction.crop = interaction.transforms.crop || interaction.crop;
      delete interaction.pointerIds;
      delete interaction.pinchStartCrop;
      delete interaction.pinchStartTransforms;
      delete interaction.pinchStartBounds;
      return;
    }
    if (interaction.mode === 'pinch' && interaction.pointerIds?.includes(event.pointerId) && !state.pointerMap.size) {
      finishImageFillCropInteraction(interaction);
      return;
    }
    if (interaction.mode === 'drag' && interaction.pointerId === event.pointerId) {
      finishImageFillCropInteraction(interaction);
      return;
    }
    return;
  }
  if (interaction.kind === 'image-crop') {
    if (interaction.pointerId !== event.pointerId) return;
    if (!state.imageCropMode || state.selectedIds.length !== 1 || state.selectedIds[0] !== interaction.node.id) {
      cancelCanvasInteraction({ pointerId: event.pointerId });
      return;
    }
    let changed = interaction.changed;
    if (interaction.mode === 'select' && interaction.moved) {
      const world = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
        ? screenToWorld(event, canvas, state) : null;
      const pointer = world ? pageToNodeLocal(interaction.geometry, world, interaction.ancestors) : interaction.end;
      const end = clampImageCropPoint(pointer, interaction.visibleBounds);
      const crop = imageCropFromDisplayDrag({
        start: interaction.start, end, bounds: interaction.bounds,
        rotation: interaction.rotation, sourceWidth: interaction.sourceWidth,
        sourceHeight: interaction.sourceHeight,
        flipHorizontal: interaction.flipHorizontal, flipVertical: interaction.flipVertical
      });
      if (crop) {
        const transforms = createImageTransforms({ ...interaction.originalTransforms, crop });
        if (JSON.stringify(transforms) !== JSON.stringify(interaction.node.transforms || createImageTransforms())) {
          interaction.historyTransaction = beginCanvasHistoryTransaction('Crop image');
          interaction.node.transforms = transforms;
          interaction.transforms = transforms;
          changed = true;
        }
      }
    }
    state.interaction = null;
    state.imageCropDraftSelection = null;
    if (changed) {
      commitCanvasHistoryTransaction(interaction);
      recordNodeComponentOverrides(interaction.node, ['transforms']);
      schedulePreview(interaction.node, true);
      renderInspector();
      queueSave();
    }
    syncImageCropOverlay();
    renderer.invalidate();
    return;
  }
  if (interaction.kind === 'pencil-stroke') {
    if (interaction.pointerId === event.pointerId) finishPencilStroke(event);
    return;
  }
  if (interaction.kind === 'pinch' && state.pointerMap.size < 2) { state.interaction = null; return; }
  if (interaction.kind === 'pan') { canvas.classList.remove('is-panning'); state.interaction = null; return; }
  if (interaction.kind === 'lasso') {
    if (interaction.pointerId !== event.pointerId) return;
    if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      appendLassoPoint(interaction.points, screenToWorld(event, canvas, state), { minDistance: 0 });
    }
    const hasArea = interaction.points.length >= 3 && interaction.points.some((point, index) => index > 1
      && Math.abs((interaction.points[1].x - interaction.points[0].x) * (point.y - interaction.points[0].y)
        - (interaction.points[1].y - interaction.points[0].y) * (point.x - interaction.points[0].x)) > 1e-9);
    if (hasArea) {
      const selects = createLassoSelectionTest(interaction.points);
      const hits = pageLayerRows().filter(({ node, parents }) => {
        if (!isMarqueeLayerVisible(node, parents, state.document)) return false;
        const geometry = { ...node, ...resolvedGeometry(node) };
        const ancestors = parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
        const corners = selectionOverlayGeometry(geometry, ancestors, { zoom: 1, rotateOffset: 0 }).corners;
        const visiblePolygon = clipMarqueePolygonThroughAncestors(corners, ancestors, state.document);
        return visiblePolygon.length > 0 && selects(visiblePolygon);
      }).map(entry => entry.node.id);
      setSelection(interaction.additive ? [...state.selectedIds, ...hits] : hits);
    } else {
      // A tap with the lasso tool remains useful on phones: select the topmost
      // layer under the pointer without requiring a tiny drag threshold.
      const point = interaction.points[0];
      const hit = point && hitTestPage(activePage(), point,
        (node, target, x, y) => renderer?.hitTestBoolean(node, target, x, y) ?? true,
        state.document, null, state.zoom);
      if (hit) setSelection(interaction.additive ? [...state.selectedIds, hit.id] : [hit.id]);
      else if (!interaction.additive) setSelection([]);
    }
    state.interaction = null; renderer.invalidate(); return;
  }
  if (interaction.kind === 'pen-anchor') {
    const point = state.penDraft?.anchors[interaction.pointIndex];
    if (point && !interaction.moved) { point.in = { x: point.x, y: point.y }; point.out = { x: point.x, y: point.y }; }
    state.interaction = null; renderer.invalidate(); return;
  }
  if (interaction.kind === 'gradient-geometry') {
    if (interaction.pointerId !== event.pointerId) return;
    state.interaction = null;
    if (!commitCanvasHistoryTransaction(interaction)) { renderer.invalidate(); return; }
    recordGradientTrackChange(interaction);
    renderInspector(); queueSave(); renderer.invalidate(); return;
  }
  if (interaction.kind === 'vector-control') {
    if (!commitCanvasHistoryTransaction(interaction)) { state.interaction = null; renderInspector(); renderer.invalidate(); return; }
    recordNodeComponentOverrides(interaction.node, (interaction.contourIndex || 0) === 0 ? ['points'] : ['subpaths']);
    state.interaction = null; renderInspector(); queueSave(); renderer.invalidate(); return;
  }
  if (interaction.kind === 'vector-anchor-group') {
    if (!commitCanvasHistoryTransaction(interaction)) { state.interaction = null; renderInspector(); renderer.invalidate(); return; }
    const properties = [...new Set([...interaction.changedContours].map(contourIndex => contourIndex === 0 ? 'points' : 'subpaths'))];
    if (properties.length) recordNodeComponentOverrides(interaction.node, properties);
    state.interaction = null; renderInspector(); queueSave(); renderer.invalidate(); return;
  }
  if (interaction.kind === 'network-control') {
    if (!commitCanvasHistoryTransaction(interaction)) { state.interaction = null; renderInspector(); renderer.invalidate(); return; }
    recordNodeComponentOverrides(interaction.node, ['vertices', 'edges', 'faces']);
    state.interaction = null; renderInspector(); queueSave(); renderer.invalidate(); return;
  }
  if (['move', 'resize', 'rotate', 'group-resize', 'group-rotate', 'reorder'].includes(interaction.kind)) {
    if (!commitCanvasHistoryTransaction(interaction)) {
      state.interaction = null; state.smartGuides = []; renderer.invalidate(); return;
    }
    const editedIds = interaction.kind === 'move' ? [...interaction.originals.keys()]
      : interaction.kind === 'group-resize' || interaction.kind === 'group-rotate' ? [...interaction.ids]
        : interaction.node ? [interaction.node.id] : [];
    if (interaction.kind === 'reorder') editedIds.push(interaction.parent?.id);
    for (const id of editedIds.filter(Boolean)) {
      const node = findNode(state.document, id)?.node;
      if (!node) continue;
      if (interaction.kind === 'reorder') {
        const instanceRoot = componentInstanceRoot(id);
        if (instanceRoot && node.componentSourceId) {
          instanceRoot.componentOverrides ||= {};
          instanceRoot.componentOverrides[node.componentSourceId] ||= {};
          instanceRoot.componentOverrides[node.componentSourceId].__childOrder = node.children.map(child => child.componentSourceId);
        }
      } else {
        const properties = interaction.kind === 'resize' || interaction.kind === 'group-resize' ? ['x', 'y', 'width', 'height']
          : interaction.kind === 'rotate' ? ['rotation']
            : interaction.kind === 'group-rotate' ? ['x', 'y', 'rotation'] : ['x', 'y'];
        const original = interaction.kind === 'move' ? interaction.originals.get(id)
          : interaction.kind === 'group-resize' || interaction.kind === 'group-rotate'
            ? interaction.entries.find(entry => entry.node.id === id)?.node
            : interaction.geometry || interaction.node;
        const changedProperties = properties.filter(property => original
          && !Object.is(getNodePropertyValue(state.document, node, property), original[property]));
        if (changedProperties.some(property => node.variableBindings?.[property])) recordNodeComponentOverrides(node, ['variableBindings']);
        recordNodeComponentOverrides(node, changedProperties.filter(property => !node.variableBindings?.[property]));
      }
    }
    const resizedFrameIds = interaction.kind === 'resize' && interaction.node?.type === 'frame' ? [interaction.node.id]
      : interaction.kind === 'group-resize' ? interaction.ids.filter(id => findNode(state.document, id)?.node.type === 'frame') : [];
    for (const frameId of resizedFrameIds) {
      const frameNode = findNode(state.document, frameId)?.node;
      const instanceRoot = componentInstanceRoot(frameId);
      const frameState = interaction.kind === 'group-resize' ? interaction.frameStates.get(frameId) : { childGeometry: interaction.childGeometry };
      if (instanceRoot && frameNode && frameState?.childGeometry) for (const child of frameNode.children || []) {
        const before = frameState.childGeometry.get(child.id);
        if (!before) continue;
        const changedChildGeometry = ['x', 'y', 'width', 'height'].filter(property => !Object.is(before[property], child[property]));
        if (changedChildGeometry.length) recordNodeComponentOverrides(child, changedChildGeometry);
      }
    }
    state.interaction = null; state.smartGuides = []; renderLayers(); renderInspector(); queueSave(); renderer.invalidate(); return;
  }
  if (interaction.kind === 'marquee') {
    const hits = pageLayerRows().filter(({ node, parents }) => {
      if (!isMarqueeLayerVisible(node, parents, state.document)) return false;
      const geometry = { ...node, ...resolvedGeometry(node) };
      const ancestors = parents.map(parent => ({
        ...parent,
        ...resolvedGeometry(parent)
      }));
      const corners = selectionOverlayGeometry(geometry, ancestors, { zoom: 1, rotateOffset: 0 }).corners;
      const visiblePolygon = clipMarqueePolygonThroughAncestors(corners, ancestors, state.document);
      if (!visiblePolygon.length) return false;
      return marqueeSelectsPolygon(
        { x: state.marquee.x1, y: state.marquee.y1 },
        { x: state.marquee.x2, y: state.marquee.y2 },
        visiblePolygon
      );
    }).map(entry => entry.node.id);
    setSelection(interaction.additive ? [...state.selectedIds, ...hits] : hits);
    state.marquee = null; state.interaction = null; renderer.invalidate(); return;
  }
  if (interaction.kind === 'draw') {
    updateDraftShapeGeometry(interaction, screenToWorld(event, canvas, state), event);
    const node = state.draftNode;
    state.draftNode = null; state.interaction = null;
    if (!interaction.moved) {
      if (node.type === 'frame') { node.width = 390; node.height = 844; }
      else if (node.type === 'section') { node.width = 480; node.height = 320; }
      else if (node.type === 'line' || node.type === 'path') { node.width = 120; node.height = 1; if (node.type === 'path') node.points = [{ x: 0, y: 0 }, { x: 1, y: 0 }]; }
      else { node.width = 120; node.height = 80; }
      node.x -= node.width / 2; node.y -= node.height / 2;
    }
    checkpoint(`Create ${node.type}`);
    const center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    const parent = ['section', 'slice'].includes(node.type) ? null : deepestContainerAt(center);
    localizeToParent(node, center.x, center.y, parent, { anchor: 'center' });
    setSelection([node.id]); queueSave(); renderer.invalidate(); return;
  }
}

function cancelCanvasInteraction(event) {
  const interaction = state.interaction;
  if (event?.pointerId != null) state.pointerMap.delete(event.pointerId);
  if (!interaction) return;
  if (interaction.kind === 'image-fill-crop' && interaction.mode === 'pinch'
    && interaction.pointerIds?.includes(event?.pointerId) && state.pointerMap.size) {
    const [pointerId, point] = state.pointerMap.entries().next().value;
    interaction.mode = 'drag';
    interaction.pointerId = pointerId;
    interaction.lastLocal = localPointForImageFillClient(point, interaction);
    interaction.crop = interaction.transforms.crop || interaction.crop;
    delete interaction.pointerIds;
    delete interaction.pinchStartCrop;
    delete interaction.pinchStartTransforms;
    delete interaction.pinchStartBounds;
    return;
  }
  const ownsPointer = interaction.kind === 'image-fill-crop' && interaction.mode === 'pinch'
    ? interaction.pointerIds?.includes(event?.pointerId)
    : interaction.pointerId === event?.pointerId;
  if (interaction.pointerId != null && event?.pointerId != null && !ownsPointer) return;
  if (interaction.kind === 'pencil-stroke') {
    cancelPencilStroke();
    state.pointerMap.clear();
    return;
  }

  let restoredDocument = false;
  if (interaction.historyTransaction) {
    const snapshot = history.cancelTransaction(interaction.historyTransaction);
    if (snapshot) {
      state.document = snapshot;
      const selection = interaction.kind === 'move' && interaction.duplicated
        ? interaction.originalSelectedIds : state.selectedIds;
      state.selectedIds = selection.filter(id => findNode(state.document, id));
      clearVectorAnchorSelection();
      restoredDocument = true;
    }
  }
  state.interaction = null;
  if (interaction.kind.startsWith('ruler-guide-')
    && !pageGuides().some(guide => guide.id === state.selectedRulerGuideId)) state.selectedRulerGuideId = null;
  if (interaction.kind === 'pan') { state.panX = interaction.panX; state.panY = interaction.panY; }
  if (interaction.kind === 'pinch') {
    state.zoom = interaction.zoom; state.panX = interaction.panX; state.panY = interaction.panY;
    updateZoomUI();
  }
  if (interaction.kind === 'draw') state.draftNode = null;
  if (interaction.kind === 'marquee') {
    state.marquee = null;
    setSelection(interaction.previousSelection || []);
  }
  if (interaction.kind === 'pen-anchor') {
    state.penDraft = interaction.penDraftBefore ? structuredClone(interaction.penDraftBefore) : null;
    state.penHover = null;
  }
  if (interaction.kind === 'image-crop') state.imageCropDraftSelection = null;
  state.pointerMap.clear();
  state.smartGuides = [];
  canvas.classList.remove('is-panning');

  if (restoredDocument) {
    reconcileImagePreviewRuntime();
    if (event?.preserveUI) {
      // A panel pointerdown cancels the canvas gesture before the browser sends
      // that same pointer sequence to the panel. Keep its target mounted so the
      // user's intended click/tap is not swallowed by this rollback render.
      syncImageCropOverlay();
      updateSelectionStatus();
      renderer.invalidate();
    } else renderUI();
    if (interaction.node?.type === 'image') {
      const restoredNode = findNode(state.document, interaction.node.id)?.node;
      if (restoredNode) schedulePreview(restoredNode, true);
    } else if (interaction.kind === 'image-fill-crop') {
      const restoredNode = findNode(state.document, interaction.node.id)?.node;
      if (restoredNode) schedulePreview(restoredNode, true, interaction.fillId);
    }
    queueSave();
  } else {
    syncImageCropOverlay();
    updateSelectionStatus();
    renderer.invalidate();
  }
}

function resizeTextNode(node) {
  if (node?.type !== 'text') return false;
  textMeasureContext ||= document.createElement('canvas').getContext('2d');
  if (!textMeasureContext) return false;
  const before = resolvedGeometry(node);
  const layoutNode = { ...node, ...before };
  const size = calculateTextBox(textMeasureContext, layoutNode, {
    fontSize: getNodePropertyValue(state.document, node, 'fontSize'),
    lineHeight: getNodePropertyValue(state.document, node, 'lineHeight'),
    letterSpacing: getNodePropertyValue(state.document, node, 'letterSpacing'),
    paragraphSpacing: node.paragraphSpacing,
    firstLineIndent: node.firstLineIndent,
    listSpacing: node.listSpacing,
    paragraphStyles: node.paragraphStyles,
    text: getNodePropertyValue(state.document, node, 'text')
  });
  if (!node.variableBindings?.width) node.width = size.width;
  if (!node.variableBindings?.height) node.height = size.height;
  const after = resolvedGeometry(node);
  preserveAutoWidthTextAnchor(node, before, after);
  return before.width !== after.width || before.height !== after.height;
}

function resizeTextLayers(roots, variableId = null) {
  const layoutParents = new Set();
  walkNodes(roots, ({ node, parent }) => {
    if (node.type !== 'text') return;
    const bindings = node.variableBindings || {};
    const sizeProperties = ['text', 'fontSize', 'lineHeight', 'letterSpacing', 'width', 'height'];
    if (variableId && !sizeProperties.some(property => bindings[property] === variableId)) return;
    if (!variableId && !sizeProperties.some(property => bindings[property])) return;
    if (resizeTextNode(node) && parent?.autoLayout) layoutParents.add(parent);
  });
  for (const parent of layoutParents) applyAutoLayout(parent);
}

const textRunStyleKeys = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'textDecoration', 'baselineShift'];
const textBlockTags = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE']);
function textRunDataAttribute(property) { return `data-run-${property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`; }
function normalizeTextRunStyle(source = {}) {
  const style = {};
  for (const property of textRunStyleKeys) {
    let value = source[property];
    if (value == null) continue;
    if (property === 'fontFamily') {
      value = String(value).trim();
      if (!value || value.length > 160 || /[\x00-\x1f]/.test(value)) continue;
    } else if (property === 'fontWeight') {
      value = Number(value);
      if (!Number.isInteger(value) || value < 1 || value > 1000) continue;
    } else if (['fontSize', 'lineHeight'].includes(property)) {
      value = Number(value);
      if (!Number.isFinite(value) || value <= 0 || value > (property === 'lineHeight' ? 100 : 100_000)) continue;
    } else if (property === 'letterSpacing') {
      value = Number(value);
      if (!Number.isFinite(value) || Math.abs(value) > 10_000) continue;
    } else if (property === 'baselineShift') {
      value = normalizeTextRunBaselineShift(value);
      if (value == null) continue;
    } else if (property === 'fontStyle') {
      value = String(value);
      if (!['normal', 'italic'].includes(value)) continue;
    } else if (property === 'textDecoration') {
      value = String(value);
      if (!['none', 'underline', 'line-through'].includes(value)) continue;
    } else if (property === 'color') {
      value = String(value);
      if (!/^#[0-9a-f]{6}$/i.test(value)) continue;
      value = value.toLowerCase();
    }
    style[property] = value;
  }
  return style;
}
function appendTextRun(runs, text, style) {
  if (!text) return;
  const normalized = normalizeTextRunStyle(style);
  const previous = runs.at(-1);
  const keys = textRunStyleKeys.filter(property => normalized[property] != null);
  if (previous && keys.every(property => previous[property] === normalized[property])
    && Object.keys(previous).every(property => property === 'text' || normalized[property] != null && previous[property] === normalized[property])) previous.text += text;
  else runs.push({ text, ...normalized });
}
function normalizeTextRuns(runs) {
  const normalized = [];
  for (const run of runs || []) appendTextRun(normalized, String(run.text || '').replace(/\r\n?/g, '\n'), run);
  return normalized;
}
function parseTextRunColor(value) {
  const text = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  const match = text.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  if (parts.some(part => part < 0 || part > 255)) return null;
  return `#${parts.map(part => part.toString(16).padStart(2, '0')).join('')}`;
}
function textRunStyleForElement(element, inherited) {
  const style = { ...inherited };
  const tag = element.tagName;
  if (tag === 'B' || tag === 'STRONG') style.fontWeight = 700;
  if (tag === 'I' || tag === 'EM') style.fontStyle = 'italic';
  for (const property of textRunStyleKeys) {
    const encoded = element.getAttribute(textRunDataAttribute(property));
    let value = encoded != null ? encoded : element.style?.[property];
    if (property === 'fontWeight' && value) value = value === 'bold' ? 700 : value === 'normal' ? 400 : Number(value);
    if (property === 'fontStyle' && value) value = value === 'italic' ? 'italic' : 'normal';
    if (property === 'fontSize' || property === 'lineHeight' || property === 'letterSpacing' || property === 'baselineShift') {
      if (value != null && value !== '') value = Number.parseFloat(value);
    }
    if (property === 'color' && value) value = parseTextRunColor(value);
    if (property === 'textDecoration' && value) {
      const decoration = String(value).split(/\s+/).find(item => ['underline', 'line-through', 'none'].includes(item));
      value = decoration || null;
    }
    if (value != null && value !== '') {
      const normalized = normalizeTextRunStyle({ [property]: value });
      if (normalized[property] != null) style[property] = normalized[property];
    }
  }
  return style;
}
function readTextEditorContent(root) {
  const runs = [];
  let text = '';
  const paragraphStyles = [];
  const append = (value, style) => {
    const next = String(value).replace(/\r\n?/g, '\n');
    if (!next) return;
    appendTextRun(runs, next, style);
    text += next;
  };
  const visit = (node, inherited = {}, rootNode = false) => {
    if (node.nodeType === Node.TEXT_NODE) { append(node.nodeValue || '', inherited); return; }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') { append('\n', inherited); return; }
    if (node.nodeType === Node.ELEMENT_NODE && !rootNode && textBlockTags.has(node.tagName) && text && !text.endsWith('\n')) append('\n', inherited);
    const style = node.nodeType === Node.ELEMENT_NODE ? textRunStyleForElement(node, inherited) : inherited;
    for (const child of node.childNodes) visit(child, style, false);
  };
  const children = [...root.childNodes];
  const paragraphBlocks = children.length && children.every(child => child.nodeType === Node.ELEMENT_NODE
    && (child.dataset.editorParagraph === 'true' || textBlockTags.has(child.tagName)));
  if (paragraphBlocks) {
    children.forEach((paragraph, index) => {
      for (const child of paragraph.childNodes) visit(child, {}, false);
      const listStyle = ['bulleted', 'numbered'].includes(paragraph.dataset.editorListStyle) ? paragraph.dataset.editorListStyle : 'none';
      const listLevel = Number(paragraph.dataset.editorListLevel);
      const listStart = Number(paragraph.dataset.editorListStart);
      paragraphStyles.push({
        listStyle,
        listLevel: listStyle !== 'none' && Number.isInteger(listLevel) ? listLevel : 0,
        ...(listStyle === 'numbered' && Number.isInteger(listStart) ? { listStart } : {}),
        ...(['left', 'center', 'right', 'justify'].includes(paragraph.dataset.editorParagraphAlign)
          ? { align: paragraph.dataset.editorParagraphAlign } : {})
      });
      if (index < children.length - 1) append('\n', {});
    });
  } else {
    for (const child of children) visit(child, {}, false);
    paragraphStyles.push(...normalizeTextParagraphStyles(text));
  }
  return { text, runs: normalizeTextRuns(runs), paragraphStyles: normalizeTextParagraphStyles(text, paragraphStyles) };
}
function editorListMarkerLabels(paragraphStyles) {
  const counters = new Map();
  const activeStyles = new Map();
  const alpha = value => {
    let number = value; let label = '';
    while (number > 0 && label.length < 12) { number -= 1; label = String.fromCharCode(97 + number % 26) + label; number = Math.floor(number / 26); }
    return label || 'a';
  };
  const roman = value => {
    if (value > 3999) return String(value);
    let number = value; let label = '';
    for (const [amount, symbol] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) {
      while (number >= amount) { label += symbol; number -= amount; }
    }
    return label;
  };
  return paragraphStyles.map(style => {
    if (style.listStyle === 'none') { counters.clear(); activeStyles.clear(); return ''; }
    const level = style.listLevel || 0;
    for (const current of [...activeStyles.keys()]) if (current > level) activeStyles.delete(current);
    for (const current of [...counters.keys()]) if (current > level) counters.delete(current);
    if (activeStyles.get(level) !== style.listStyle) counters.delete(level);
    activeStyles.set(level, style.listStyle);
    if (style.listStyle === 'bulleted') return '•';
    const count = style.listStart ?? (counters.get(level) || 0) + 1;
    counters.set(level, count);
    const format = level % 3;
    return `${format === 1 ? alpha(count) : format === 2 ? roman(count) : count}.`;
  });
}
function renderTextEditorRuns(editor, runs, paragraphStyles = []) {
  editor.replaceChildren();
  const paragraphs = [[]];
  for (const run of runs) {
    const pieces = String(run.text || '').split('\n');
    pieces.forEach((piece, index) => {
      if (piece) paragraphs.at(-1).push({ ...run, text: piece });
      if (index < pieces.length - 1) paragraphs.push([]);
    });
  }
  const styles = normalizeTextParagraphStyles(paragraphs.map(items => items.map(run => run.text).join('')).join('\n'), paragraphStyles);
  const markers = editorListMarkerLabels(styles);
  for (const [index, paragraphRuns] of paragraphs.entries()) {
    const paragraph = document.createElement('div');
    paragraph.dataset.editorParagraph = 'true';
    paragraph.className = 'text-editor-paragraph';
    if (index > 0) paragraph.classList.add('text-editor-paragraph-following');
    const paragraphStyle = styles[index];
    if (paragraphStyle.align) {
      paragraph.dataset.editorParagraphAlign = paragraphStyle.align;
      paragraph.style.textAlign = paragraphStyle.align;
    }
    if (paragraphStyle.listStyle !== 'none') {
      paragraph.dataset.editorListStyle = paragraphStyle.listStyle;
      paragraph.dataset.editorListLevel = String(paragraphStyle.listLevel);
      paragraph.dataset.editorListMarker = markers[index];
      paragraph.style.paddingInlineStart = `${32 + paragraphStyle.listLevel * 24}px`;
      paragraph.style.setProperty('--editor-list-marker-left', `${paragraphStyle.listLevel * 24}px`);
      if (paragraphStyle.listStart != null) paragraph.dataset.editorListStart = String(paragraphStyle.listStart);
    }
    for (const run of paragraphRuns) {
      const span = document.createElement('span');
      if (textRunStyleKeys.some(property => run[property] != null)) span.dataset.textRun = 'true';
      for (const property of textRunStyleKeys) {
        const value = run[property];
        if (value == null) continue;
        span.setAttribute(textRunDataAttribute(property), String(value));
        if (property === 'baselineShift') {
          span.style.position = 'relative';
          span.style.top = `${-value * state.zoom}px`;
        } else span.style[property] = property === 'fontSize' || property === 'letterSpacing' ? `${value * state.zoom}px` : String(value);
      }
      span.textContent = run.text;
      paragraph.append(span);
    }
    editor.append(paragraph);
  }
}
function trimTextRuns(runs, length) {
  let remaining = length;
  const result = [];
  for (const run of runs) {
    if (remaining <= 0) break;
    const text = run.text.slice(0, remaining);
    if (text) result.push({ ...run, text });
    remaining -= text.length;
  }
  return normalizeTextRuns(result);
}
function editorPointOffset(editor, node, offset) {
  if (node !== editor && !editor.contains(node)) return null;
  try {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(node, offset);
    return readTextEditorContent(range.cloneContents()).text.length;
  } catch { return null; }
}
function currentTextSelection() {
  const editor = $('#text-editor-overlay');
  const selection = document.getSelection();
  if (!selection?.rangeCount || !state.textNodeId) return null;
  const range = selection.getRangeAt(0);
  const start = editorPointOffset(editor, range.startContainer, range.startOffset);
  const end = editorPointOffset(editor, range.endContainer, range.endOffset);
  return start == null || end == null ? null : { start: Math.min(start, end), end: Math.max(start, end) };
}
function rememberTextSelection() {
  const range = currentTextSelection();
  if (range) state.textSelection = range;
  return range || state.textSelection;
}
function setTextEditorSelection(editor, start, end = start) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  if (!textNodes.length) { const empty = document.createTextNode(''); editor.append(empty); textNodes.push(empty); }
  const pointAt = position => {
    const target = Math.max(0, position);
    const paragraphs = [...editor.children];
    if (paragraphs.length && paragraphs.every(paragraph => paragraph.dataset.editorParagraph === 'true')) {
      let paragraphStart = 0;
      for (const [index, paragraph] of paragraphs.entries()) {
        const paragraphLength = readTextEditorContent(paragraph).text.length;
        const paragraphEnd = paragraphStart + paragraphLength;
        if (target >= paragraphStart && target <= paragraphEnd) {
          if (!paragraphLength) return { node: paragraph, offset: 0 };
          for (const node of textNodes) {
            if (!paragraph.contains(node)) continue;
            const start = editorPointOffset(editor, node, 0);
            const end = editorPointOffset(editor, node, node.length);
            if (start != null && end != null && target >= start && target <= end) return { node, offset: target - start };
          }
          return { node: paragraph, offset: 0 };
        }
        paragraphStart = paragraphEnd + (index < paragraphs.length - 1 ? 1 : 0);
      }
    }
    for (const node of textNodes) {
      const start = editorPointOffset(editor, node, 0);
      const end = editorPointOffset(editor, node, node.length);
      if (start != null && end != null && target >= start && target <= end) return { node, offset: target - start };
      if (start != null && target < start) return { node, offset: 0 };
    }
    const last = textNodes.at(-1);
    return { node: last, offset: last.length };
  };
  const from = pointAt(start); const to = pointAt(end);
  const range = document.createRange();
  range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
  const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
}
function textBaseStyle(node) {
  return {
    fontFamily: node.fontFamily || 'Arial, sans-serif',
    fontSize: getNodePropertyValue(state.document, node, 'fontSize') || 24,
    fontWeight: Number(node.fontWeight || 400),
    fontStyle: node.fontStyle || 'normal',
    lineHeight: getNodePropertyValue(state.document, node, 'lineHeight') || 1.25,
    letterSpacing: getNodePropertyValue(state.document, node, 'letterSpacing') || 0,
    baselineShift: 0,
    color: getNodeColor(state.document, node, 'text') || '#1e1e1e',
    textDecoration: ['underline', 'line-through'].includes(node.textDecoration) ? node.textDecoration : 'none'
  };
}
function effectiveTextRunValue(run, property, node) {
  return run[property] ?? textBaseStyle(node)[property];
}
function selectedTextRunValues(runs, start, end, property, node) {
  const values = [];
  let cursor = 0;
  for (const run of runs) {
    const next = cursor + run.text.length;
    if (next > start && cursor < end) values.push(effectiveTextRunValue(run, property, node));
    cursor = next;
  }
  return values;
}
function rangeUsesTextStyle(runs, start, end, property, node, predicate) {
  const values = selectedTextRunValues(runs, start, end, property, node);
  return values.length > 0 && values.every(predicate);
}
function textParagraphIndexesForRange(text, range) {
  const value = String(text ?? '');
  const starts = [0];
  for (let index = 0; index < value.length; index += 1) if (value[index] === '\n') starts.push(index + 1);
  const start = Math.max(0, Math.min(value.length, Number(range?.start) || 0));
  const end = Math.max(start, Math.min(value.length, Number(range?.end) || 0));
  if (start === end) {
    let paragraph = 0;
    while (paragraph + 1 < starts.length && starts[paragraph + 1] <= start) paragraph += 1;
    return [paragraph];
  }
  const selected = [];
  for (let index = 0; index < starts.length; index += 1) {
    const paragraphEnd = index + 1 < starts.length ? starts[index + 1] - 1 : value.length;
    if (start < paragraphEnd && end > starts[index]) selected.push(index);
  }
  if (selected.length) return selected;
  let paragraph = 0;
  while (paragraph + 1 < starts.length && starts[paragraph + 1] <= start) paragraph += 1;
  return [paragraph];
}
function formatSelectedParagraphs(action) {
  const editor = $('#text-editor-overlay');
  const current = readTextEditorContent(editor);
  const range = rememberTextSelection();
  if (!range) return;
  const styles = normalizeTextParagraphStyles(current.text, current.paragraphStyles);
  const indexes = textParagraphIndexesForRange(current.text, range);
  if (['left', 'center', 'right', 'justify'].includes(action)) {
    for (const index of indexes) styles[index] = { ...styles[index], align: action };
  } else if (action === 'bulleted' || action === 'numbered') {
    const alreadyApplied = indexes.every(index => styles[index]?.listStyle === action);
    for (const index of indexes) {
      styles[index] = { ...styles[index], listStyle: alreadyApplied ? 'none' : action, listLevel: alreadyApplied ? 0 : styles[index]?.listLevel || 0 };
      if (alreadyApplied || action !== 'numbered') delete styles[index].listStart;
    }
  } else {
    for (const index of indexes) {
      const style = styles[index];
      if (style.listStyle === 'none') continue;
      const level = action === 'indent' ? Math.min(4, style.listLevel + 1) : Math.max(0, style.listLevel - 1);
      styles[index] = { ...style, listLevel: level };
    }
  }
  renderTextEditorRuns(editor, current.runs, styles);
  state.textSelection = range;
  setTextEditorSelection(editor, range.start, range.end);
  editor.focus({ preventScroll: true });
  updateTextFormatToolbar();
}
function positionTextFormatToolbar() {
  const editor = $('#text-editor-overlay'); const toolbar = $('#text-format-toolbar'); const canvasScroll = $('#canvas-scroll');
  if (!state.textNodeId || editor.hidden || toolbar.hidden) return;
  const editorLeft = Number.parseFloat(editor.style.left) || 8;
  const editorTop = Number.parseFloat(editor.style.top) || 8;
  const toolbarWidth = toolbar.offsetWidth; const toolbarHeight = toolbar.offsetHeight;
  const left = Math.max(8, Math.min(editorLeft, canvasScroll.clientWidth - toolbarWidth - 8));
  const above = editorTop - toolbarHeight - 8;
  const below = editorTop + (Number.parseFloat(editor.style.minHeight) || 32) + 8;
  const top = above >= 8 ? above : Math.min(below, canvasScroll.clientHeight - toolbarHeight - 8);
  toolbar.style.left = `${left}px`; toolbar.style.top = `${Math.max(8, top)}px`;
}
function setTextFormatControlValue(control, value, mixed = false) {
  if (!control) return;
  const baseLabel = control.dataset.baseAriaLabel || control.getAttribute('aria-label') || control.id;
  control.dataset.baseAriaLabel = baseLabel;
  control.dataset.mixed = String(Boolean(mixed));
  control.setAttribute('aria-label', mixed ? `${baseLabel}, mixed values` : baseLabel);
  if (mixed) control.title = 'Mixed formatting';
  else control.removeAttribute('title');

  if (control.type === 'color') {
    if (!mixed && /^#[0-9a-f]{6}$/i.test(String(value))) control.value = value;
    return;
  }
  if (control.tagName === 'SELECT') {
    let mixedOption = control.querySelector('[data-mixed-option]');
    if (mixed) {
      if (!mixedOption) {
        mixedOption = document.createElement('option');
        mixedOption.value = '';
        mixedOption.textContent = 'Mixed';
        mixedOption.disabled = true;
        mixedOption.dataset.mixedOption = 'true';
        control.prepend(mixedOption);
      }
      control.value = '';
      return;
    }
    mixedOption?.remove();
    control.querySelectorAll('[data-dynamic-value]').forEach(option => option.remove());
    const nextValue = String(value ?? '');
    let option = [...control.options].find(item => item.value === nextValue);
    if (!option && nextValue) {
      option = document.createElement('option');
      option.value = nextValue;
      option.textContent = nextValue;
      option.dataset.dynamicValue = 'true';
      control.append(option);
    }
    control.value = nextValue;
    return;
  }
  control.value = mixed ? '' : String(value ?? '');
  if (mixed) control.placeholder = 'Mixed';
  else control.removeAttribute('placeholder');
}
function updateTextFormatToolbar() {
  const toolbar = $('#text-format-toolbar'); const editor = $('#text-editor-overlay');
  if (!state.textNodeId || editor.hidden) { toolbar.hidden = true; return; }
  toolbar.hidden = false;
  const node = findNode(state.document, state.textNodeId)?.node;
  const current = readTextEditorContent(editor);
  const range = rememberTextSelection();
  const selected = Boolean(range && range.end > range.start && range.end <= current.text.length);
  const bold = toolbar.querySelector('[data-text-format="bold"]'); const italic = toolbar.querySelector('[data-text-format="italic"]');
  bold.disabled = !selected; italic.disabled = !selected;
  bold.setAttribute('aria-pressed', String(selected && rangeUsesTextStyle(current.runs, range.start, range.end, 'fontWeight', node, value => Number(value) >= 600)));
  italic.setAttribute('aria-pressed', String(selected && rangeUsesTextStyle(current.runs, range.start, range.end, 'fontStyle', node, value => value === 'italic')));
  const paragraphIndexes = textParagraphIndexesForRange(current.text, range || { start: 0, end: 0 });
  const paragraphStyles = normalizeTextParagraphStyles(current.text, current.paragraphStyles);
  const listButtons = [...toolbar.querySelectorAll('[data-paragraph-format]')];
  const alignButtons = [...toolbar.querySelectorAll('[data-paragraph-align]')];
  const canIndent = paragraphIndexes.some(index => paragraphStyles[index]?.listStyle !== 'none' && paragraphStyles[index].listLevel < 4);
  const canOutdent = paragraphIndexes.some(index => paragraphStyles[index]?.listStyle !== 'none' && paragraphStyles[index].listLevel > 0);
  for (const button of listButtons) {
    const action = button.dataset.paragraphFormat;
    if (action === 'bulleted' || action === 'numbered') {
      button.setAttribute('aria-pressed', String(paragraphIndexes.every(index => paragraphStyles[index]?.listStyle === action)));
    } else {
      button.setAttribute('aria-pressed', 'false');
      button.disabled = action === 'indent' ? !canIndent : !canOutdent;
      continue;
    }
    button.disabled = false;
  }
  for (const button of alignButtons) {
    const align = button.dataset.paragraphAlign;
    button.setAttribute('aria-pressed', String(paragraphIndexes.every(index => (paragraphStyles[index]?.align || node.align || 'left') === align)));
    button.disabled = false;
  }
  const size = $('#text-format-size'); const lineHeight = $('#text-format-line-height'); const color = $('#text-format-color');
  const family = $('#text-format-family'); const weight = $('#text-format-weight');
  const spacing = $('#text-format-spacing'); const decoration = $('#text-format-decoration'); const baselineShift = $('#text-format-baseline-shift');
  for (const control of [size, lineHeight, color, family, weight, spacing, decoration, baselineShift]) control.disabled = !selected;
  const base = textBaseStyle(node);
  const summarize = (property, normalize = value => value) => selected
    ? summarizeTextRunRange(current.runs, range.start, range.end,
      run => effectiveTextRunValue(run, property, node), normalize)
    : { selected: false, mixed: false, value: null };
  const familyState = summarize('fontFamily', value => String(value).trim());
  const weightState = summarize('fontWeight', value => Number(value));
  const sizeState = summarize('fontSize', value => Number(value));
  const lineHeightState = summarize('lineHeight', value => Number(value));
  const spacingState = summarize('letterSpacing', value => Number(value));
  const baselineShiftState = summarize('baselineShift', value => Number(value));
  const decorationState = summarize('textDecoration');
  const colorState = summarize('color', value => String(value).toLowerCase());
  setTextFormatControlValue(family, familyState.selected ? familyState.value : base.fontFamily, familyState.mixed);
  setTextFormatControlValue(weight, weightState.selected ? weightState.value : base.fontWeight, weightState.mixed);
  setTextFormatControlValue(size, sizeState.selected ? Math.max(1, Math.min(512, Math.round(sizeState.value))) : base.fontSize, sizeState.mixed);
  setTextFormatControlValue(lineHeight, lineHeightState.selected ? lineHeightState.value : base.lineHeight, lineHeightState.mixed);
  setTextFormatControlValue(spacing, spacingState.selected ? spacingState.value : base.letterSpacing, spacingState.mixed);
  setTextFormatControlValue(baselineShift, baselineShiftState.selected ? baselineShiftState.value : 0, baselineShiftState.mixed);
  setTextFormatControlValue(decoration, decorationState.selected ? decorationState.value : base.textDecoration, decorationState.mixed);
  setTextFormatControlValue(color, parseTextRunColor(colorState.selected ? colorState.value : base.color) || '#1e1e1e', colorState.mixed);
  positionTextFormatToolbar();
}
function applyTextFormat(property, value) {
  const editor = $('#text-editor-overlay'); const node = findNode(state.document, state.textNodeId)?.node;
  const current = readTextEditorContent(editor); const range = rememberTextSelection();
  if (!node || !range || range.end <= range.start || range.end > current.text.length) return;
  const nextRuns = transformTextRunsInRange(current.runs, range.start, range.end, property, value);
  if (nextRuns.length > 10_000) { showToast('This text has reached the 10,000 style-run limit.'); return; }
  renderTextEditorRuns(editor, nextRuns, current.paragraphStyles);
  state.textSelection = range;
  setTextEditorSelection(editor, range.start, range.end);
  editor.focus({ preventScroll: true });
  updateTextFormatToolbar();
}
function toggleTextFormat(property) {
  const editor = $('#text-editor-overlay'); const node = findNode(state.document, state.textNodeId)?.node;
  const current = readTextEditorContent(editor); const range = rememberTextSelection();
  if (!node || !range || range.end <= range.start) return;
  if (property === 'fontWeight') {
    const bold = rangeUsesTextStyle(current.runs, range.start, range.end, property, node, value => Number(value) >= 600);
    applyTextFormat(property, bold ? 400 : 700);
  } else {
    const italic = rangeUsesTextStyle(current.runs, range.start, range.end, property, node, value => value === 'italic');
    applyTextFormat(property, italic ? 'normal' : 'italic');
  }
}

function createTextAt(world) {
  const node = createNode('text', { x: world.x, y: world.y, text: '', width: 240, height: 48 });
  checkpoint('Create text');
  const parent = deepestContainerAt(world);
  localizeToParent(node, world.x, world.y, parent);
  setSelection([node.id]);
  queueSave();
  editTextNode(node.id);
}

function editTextNode(nodeId) {
  const entry = findNode(state.document, nodeId);
  if (!entry || entry.node.type !== 'text') return;
  state.textNodeId = nodeId;
  state.textSelection = null;
  const editor = $('#text-editor-overlay');
  const absolute = absolutePosition(nodeId);
  const screen = worldToScreen(absolute, canvas, state);
  const canvasRect = canvasScroll.getBoundingClientRect();
  editor.style.left = `${screen.x - canvasRect.left}px`;
  editor.style.top = `${screen.y - canvasRect.top}px`;
  const textGeometry = resolvedGeometry(entry.node);
  editor.style.width = entry.node.textFit === 'auto-width' ? 'max-content' : `${Math.max(64, textGeometry.width * state.zoom)}px`;
  editor.style.minHeight = `${Math.max(28, textGeometry.height * state.zoom)}px`;
  editor.style.whiteSpace = entry.node.textFit === 'auto-width' ? 'pre' : 'pre-wrap';
  editor.style.textAlign = ['left', 'center', 'right', 'justify'].includes(entry.node.align) ? entry.node.align : 'left';
  editor.style.textTransform = ['uppercase', 'lowercase', 'capitalize'].includes(entry.node.textCase) ? entry.node.textCase : 'none';
  editor.style.textDecoration = ['underline', 'line-through'].includes(entry.node.textDecoration) ? entry.node.textDecoration : 'none';
  editor.style.fontFamily = entry.node.fontFamily;
  editor.style.fontWeight = String(entry.node.fontWeight || 400);
  editor.style.fontSize = `${getNodePropertyValue(state.document, entry.node, 'fontSize') * state.zoom}px`;
  editor.style.lineHeight = String(getNodePropertyValue(state.document, entry.node, 'lineHeight'));
  editor.style.letterSpacing = `${getNodePropertyValue(state.document, entry.node, 'letterSpacing') * state.zoom}px`;
  editor.style.setProperty('--text-first-line-indent', `${Math.max(0, Number(entry.node.firstLineIndent) || 0) * state.zoom}px`);
  editor.style.setProperty('--text-paragraph-spacing', `${Math.max(0, Number(entry.node.paragraphSpacing) || 0) * state.zoom}px`);
  editor.style.setProperty('--text-list-spacing', `${Math.max(0, Number(entry.node.listSpacing) || 0) * state.zoom}px`);
  editor.style.color = getNodeColor(state.document, entry.node, 'text');
  const text = getNodePropertyValue(state.document, entry.node, 'text');
  const existingRuns = Array.isArray(entry.node.textRuns) && entry.node.textRuns.map(run => run.text).join('') === text
    ? entry.node.textRuns : [{ text }];
  renderTextEditorRuns(editor, existingRuns, entry.node.paragraphStyles || []);
  $('#text-format-toolbar').hidden = false;
  $('#canvas-scroll').classList.add('is-text-editing');
  editor.hidden = false; editor.focus();
  if (!text) document.execCommand?.('selectAll', false, null);
  updateTextFormatToolbar();
}

function absolutePosition(nodeId) {
  const entry = findNode(state.document, nodeId);
  if (!entry) return { x: 0, y: 0 };
  const own = resolvedGeometry(entry.node);
  let x = own.x; let y = own.y;
  for (const parent of entry.parents) { const geometry = resolvedGeometry(parent); x += geometry.x; y += geometry.y; }
  return { x, y };
}

function commitTextEdit({ restoreFocus = false } = {}) {
  const editor = $('#text-editor-overlay');
  if (!state.textNodeId) return;
  const node = findNode(state.document, state.textNodeId)?.node;
  if (node) {
    const oldWidth = node.width; const oldHeight = node.height;
    const oldText = node.text;
    const oldRuns = node.textRuns ? JSON.stringify(node.textRuns) : null;
    const oldParagraphStyles = node.paragraphStyles ? JSON.stringify(node.paragraphStyles) : null;
    const content = readTextEditorContent(editor);
    let text = content.text;
    if (text.endsWith('\n')) text = text.slice(0, -1);
    const normalizedRuns = trimTextRuns(content.runs, text.length);
    const normalizedParagraphStyles = normalizeTextParagraphStyles(text, content.paragraphStyles);
    const richRuns = normalizedRuns.some(run => textRunStyleKeys.some(property => run[property] != null)) ? normalizedRuns : null;
    const nextTextFit = node.textFit || 'auto-height';
    const nextRuns = richRuns ? JSON.stringify(richRuns) : null;
    const hasParagraphFormatting = normalizedParagraphStyles.some(style => style.listStyle !== 'none' || style.align != null);
    const nextParagraphStyles = hasParagraphFormatting ? JSON.stringify(normalizedParagraphStyles) : null;
    const textChanged = oldText !== text || (node.variableBindings?.text && getNodePropertyValue(state.document, node, 'text') !== text);
    const runsChanged = oldRuns !== nextRuns;
    const paragraphStylesChanged = oldParagraphStyles !== nextParagraphStyles;
    const changed = textChanged || runsChanged || paragraphStylesChanged || node.textFit !== nextTextFit;
    if (changed) checkpoint('Edit text');
    setNodePropertyValue(node, 'text', text);
    node.text = text;
    if (richRuns) node.textRuns = normalizedRuns;
    else delete node.textRuns;
    if (hasParagraphFormatting) node.paragraphStyles = normalizedParagraphStyles;
    else delete node.paragraphStyles;
    node.textFit ||= 'auto-height';
    resizeTextNode(node);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot && textChanged) recordComponentOverride(instanceRoot, node, node.variableBindings?.text ? 'variableBindings' : 'text');
    if (instanceRoot && runsChanged) recordComponentOverride(instanceRoot, node, 'textRuns');
    if (instanceRoot && paragraphStylesChanged) recordComponentOverride(instanceRoot, node, 'paragraphStyles');
    if (instanceRoot && node.width !== oldWidth) recordComponentOverride(instanceRoot, node, 'width');
    if (instanceRoot && node.height !== oldHeight) recordComponentOverride(instanceRoot, node, 'height');
    const parent = findNode(state.document, node.id)?.parent;
    if (parent?.autoLayout) applyAutoLayout(parent);
  }
  editor.hidden = true; $('#text-format-toolbar').hidden = true; $('#canvas-scroll').classList.remove('is-text-editing'); state.textNodeId = null; state.textSelection = null;
  renderInspector(); renderLayers(); queueSave(); renderer.invalidate();
  if (restoreFocus) {
    // On phones the inspector is inert while the canvas editor is open. Reopen
    // the panel before returning focus to its text action, or focus() silently
    // fails and leaves keyboard users at the document body.
    if (innerWidth <= 820 && !$('#right-panel').classList.contains('is-open')) toggleMobilePanel('right');
    $('#inspector-content [data-action="edit-text"]')?.focus({ preventScroll: true });
  }
}

function initRichTextEditorEvents() {
  const editor = $('#text-editor-overlay'); const toolbar = $('#text-format-toolbar');
  const refresh = () => { rememberTextSelection(); updateTextFormatToolbar(); };
  editor.addEventListener('input', refresh);
  editor.addEventListener('keyup', refresh);
  editor.addEventListener('mouseup', refresh);
  editor.addEventListener('pointerup', refresh);
  editor.addEventListener('blur', event => {
    if (event.relatedTarget?.closest?.('#text-format-toolbar')) return;
    commitTextEdit();
  });
  editor.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); commitTextEdit({ restoreFocus: true }); }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); commitTextEdit({ restoreFocus: true }); }
  });
  toolbar.addEventListener('pointerdown', event => {
    rememberTextSelection();
    if (event.target.closest('button')) event.preventDefault();
  });
  toolbar.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      || !event.target.closest('.text-format-button, .text-format-done')) return;
    const controls = [...toolbar.querySelectorAll('.text-format-button:not(:disabled), .text-format-done:not(:disabled)')];
    const current = controls.indexOf(document.activeElement);
    if (current < 0) return;
    const currentRect = controls[current].getBoundingClientRect();
    const currentCenter = { x: currentRect.left + currentRect.width / 2, y: currentRect.top + currentRect.height / 2 };
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const candidates = controls.map((control, index) => {
      const rect = control.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const primary = vertical ? center.y - currentCenter.y : center.x - currentCenter.x;
      if (index === current || Math.sign(primary) !== direction) return null;
      const cross = vertical ? center.x - currentCenter.x : center.y - currentCenter.y;
      return { control, score: Math.abs(primary) + Math.abs(cross) * 2 };
    }).filter(Boolean).sort((left, right) => left.score - right.score);
    const target = candidates[0]?.control || controls[(current + direction + controls.length) % controls.length];
    target.focus({ preventScroll: true });
    event.preventDefault();
  });
  toolbar.addEventListener('click', event => {
    const button = event.target.closest('[data-text-format]');
    if (button?.dataset.textFormat === 'bold') toggleTextFormat('fontWeight');
    else if (button?.dataset.textFormat === 'italic') toggleTextFormat('fontStyle');
    else if (event.target.closest('[data-paragraph-format]')) formatSelectedParagraphs(event.target.closest('[data-paragraph-format]').dataset.paragraphFormat);
    else if (event.target.closest('[data-paragraph-align]')) formatSelectedParagraphs(event.target.closest('[data-paragraph-align]').dataset.paragraphAlign);
    else if (event.target.closest('[data-text-format-done]')) commitTextEdit({ restoreFocus: true });
  });
  toolbar.addEventListener('change', event => {
    if (event.target.id === 'text-format-family') {
      const value = event.target.value.trim();
      if (value && value.length <= 160) applyTextFormat('fontFamily', value);
      else updateTextFormatToolbar();
    } else if (event.target.id === 'text-format-weight') {
      const value = Number(event.target.value);
      if (Number.isInteger(value) && value >= 1 && value <= 1000) applyTextFormat('fontWeight', value);
    } else if (event.target.id === 'text-format-spacing') {
      if (!event.target.value.trim()) { updateTextFormatToolbar(); return; }
      const value = Number(event.target.value);
      if (Number.isFinite(value) && Math.abs(value) <= 10_000) applyTextFormat('letterSpacing', value);
      else updateTextFormatToolbar();
    } else if (event.target.id === 'text-format-baseline-shift') {
      if (!event.target.value.trim()) { updateTextFormatToolbar(); return; }
      const value = Number(event.target.value);
      if (Number.isFinite(value) && Math.abs(value) <= MAX_TEXT_RUN_BASELINE_SHIFT) applyTextFormat('baselineShift', value);
      else updateTextFormatToolbar();
    } else if (event.target.id === 'text-format-decoration') {
      if (['none', 'underline', 'line-through'].includes(event.target.value)) applyTextFormat('textDecoration', event.target.value);
    } else if (event.target.id === 'text-format-size') {
      if (!event.target.value.trim()) { updateTextFormatToolbar(); return; }
      const value = Number(event.target.value);
      if (Number.isFinite(value) && value > 0 && value <= 512) applyTextFormat('fontSize', value);
      else updateTextFormatToolbar();
    } else if (event.target.id === 'text-format-line-height') {
      if (!event.target.value.trim()) { updateTextFormatToolbar(); return; }
      const value = Number(event.target.value);
      if (Number.isFinite(value) && value > 0 && value <= 100) applyTextFormat('lineHeight', value);
      else updateTextFormatToolbar();
    } else if (event.target.id === 'text-format-color') {
      const value = parseTextRunColor(event.target.value);
      if (value) applyTextFormat('color', value);
    }
  });
  document.addEventListener('selectionchange', () => { if (state.textNodeId) refresh(); });
}

function updateZoomUI() {
  $('#zoom-readout').textContent = `${Math.round(state.zoom * 100)}%`;
  updateSelectionStatus();
}
function zoomAt(clientX, clientY, nextZoom) {
  const rect = canvas.getBoundingClientRect();
  const px = clientX == null ? rect.width / 2 : clientX - rect.left;
  const py = clientY == null ? rect.height / 2 : clientY - rect.top;
  const worldX = (px - state.panX) / state.zoom; const worldY = (py - state.panY) / state.zoom;
  state.zoom = Math.max(.08, Math.min(8, nextZoom));
  state.panX = px - worldX * state.zoom; state.panY = py - worldY * state.zoom;
  updateZoomUI(); renderer.invalidate();
}
function zoomToSelection() {
  const entries = selectedEntries();
  const ids = entries.length ? entries.map(entry => entry.node.id) : pageLayerRows().filter(entry => entry.node.type === 'frame').map(entry => entry.node.id);
  if (!ids.length) { state.zoom = 1; state.panX = canvas.clientWidth / 2; state.panY = canvas.clientHeight / 2; updateZoomUI(); renderer.invalidate(); return; }
  const corners = ids.flatMap(id => {
    const entry = findNode(state.document, id);
    if (!entry) return [];
    const node = { ...entry.node, ...resolvedGeometry(entry.node) };
    const ancestors = entry.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
    return selectionOverlayGeometry(node, ancestors, { zoom: 1, rotateOffset: 0 }).corners;
  });
  if (!corners.length) return;
  const x = Math.min(...corners.map(point => point.x)); const y = Math.min(...corners.map(point => point.y));
  const right = Math.max(...corners.map(point => point.x)); const bottom = Math.max(...corners.map(point => point.y));
  const zoom = Math.min(2, (canvas.clientWidth - 100) / Math.max(1, right - x), (canvas.clientHeight - 100) / Math.max(1, bottom - y));
  state.zoom = Math.max(.08, zoom); state.panX = (canvas.clientWidth - (right - x) * state.zoom) / 2 - x * state.zoom; state.panY = (canvas.clientHeight - (bottom - y) * state.zoom) / 2 - y * state.zoom;
  updateZoomUI(); renderer.invalidate();
}

function updateGradientInput(input) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  const stack = node && input.dataset.fillId ? ensureFillStack(node) : null;
  const layer = stack?.find(item => item.id === input.dataset.fillId);
  const gradient = layer?.gradient || node?.fillGradient;
  if (!gradient || node.locked) return;
  if (!state.controlEdit) { checkpoint('Edit gradient fill'); state.controlEdit = true; }
  if (input.dataset.gradientField === 'angle' && Number.isFinite(Number(input.value))) gradient.angle = Math.max(0, Math.min(359, Number(input.value)));
  else {
    const stop = gradient.stops.find(item => item.id === input.dataset.gradientStopId);
    if (!stop) return;
    if (input.dataset.gradientField === 'color') stop.color = input.value;
    else if (input.dataset.gradientField === 'position' && Number.isFinite(Number(input.value))) {
      stop.position = Math.max(0, Math.min(1, Number(input.value) / 100));
      gradient.stops.sort((a, b) => a.position - b.position);
    } else return;
  }
  if (layer) {
    syncLegacyFillFields(node);
    recordNodeComponentOverrides(node, ['fills', 'fillGradient']);
  } else recordNodeComponentOverrides(node, ['fillGradient']);
  const track = input.closest('.gradient-editor')?.querySelector('[data-gradient-stop-track]');
  if (track) syncGradientStopTrack(track, gradient);
  renderer.invalidate();
}

function gradientTrackContext(track) {
  const node = findNodeAcrossPages(state.document, track.dataset.gradientNodeId)?.node;
  if (!node || node.locked) return null;
  let fill = null; let stroke = null; let gradient = null;
  if (track.dataset.strokeId) {
    stroke = node.strokes?.find(item => item.id === track.dataset.strokeId) || null;
    gradient = stroke?.gradient || null;
  } else if (track.dataset.fillId) {
    fill = node.fills?.find(item => item.id === track.dataset.fillId) || null;
    if (fill) gradient = fill.gradient || null;
    else if (!node.fills && track.dataset.fillId === `legacy-fill:${node.id}`) gradient = node.fillGradient || null;
  } else gradient = node.fillGradient || null;
  return gradient ? { node, fill, stroke, gradient } : null;
}

function gradientGeometryContext(target = state.gradientGeometryTarget) {
  const entry = target?.nodeId ? findNodeAcrossPages(state.document, target.nodeId) : null;
  const node = entry?.node;
  if (!node || node.locked || entry.parents.some(parent => parent.locked)) return null;
  let fill = null; let stroke = null; let gradient = null;
  if (target.strokeId) {
    stroke = node.strokes?.find(item => item.id === target.strokeId) || null;
    gradient = stroke?.gradient || null;
  } else if (target.fillId) {
    fill = node.fills?.find(item => item.id === target.fillId) || null;
    gradient = fill?.gradient || null;
    if (!fill && !node.fills && target.fillId === `legacy-fill:${node.id}`) gradient = node.fillGradient || null;
  } else gradient = node.fillGradient || null;
  if (!gradient) return null;
  const geometry = { ...node, ...resolvedGeometry(node) };
  const ancestors = entry.parents.map(parent => ({ ...parent, ...resolvedGeometry(parent) }));
  const resolved = resolveGradientGeometry(gradient, { width: geometry.width, height: geometry.height });
  return resolved ? { node, fill, stroke, gradient, geometry, ancestors, handles: resolved.handles } : null;
}

function gradientGeometryHandleAt(event) {
  const target = state.gradientGeometryTarget;
  if (!target || state.selectedIds.length !== 1 || state.selectedIds[0] !== target.nodeId) return null;
  const context = gradientGeometryContext(target);
  if (!context) return null;
  const handles = context.handles.map((point, index) => ({
    index,
    point: worldToScreen(nodeLocalToPage(context.geometry, point, context.ancestors), canvas, state)
  }));
  const hit = nearestScreenHandle({ x: event.clientX, y: event.clientY }, handles, event.pointerType === 'touch' ? 24 : 12);
  return hit ? { ...context, handleIndex: hit.index } : null;
}

function normalizedGradientHandles(context) {
  const width = Math.max(1, context.geometry.width);
  const height = Math.max(1, context.geometry.height);
  if (![width, height].every(Number.isFinite)) return null;
  return context.handles.map(point => ({ x: point.x / width, y: point.y / height }));
}

function updateGradientGeometryInput(input) {
  const target = {
    nodeId: input.dataset.gradientNodeId,
    ...(input.dataset.fillId ? { fillId: input.dataset.fillId } : {}),
    ...(input.dataset.strokeId ? { strokeId: input.dataset.strokeId } : {})
  };
  const context = gradientGeometryContext(target);
  const index = Number(input.dataset.gradientGeometryIndex);
  const axis = input.dataset.gradientGeometryAxis;
  const value = Number(input.value) / 100;
  if (!context || !Number.isInteger(index) || index < 0 || index > 2 || !['x', 'y'].includes(axis)
    || !Number.isFinite(value) || Math.abs(value) > 1_000_000) return;
  const handles = context.gradient.geometry?.handles
    ? structuredClone(context.gradient.geometry.handles)
    : normalizedGradientHandles(context);
  if (!handles) return;
  const previous = handles[index][axis];
  handles[index][axis] = value;
  const candidate = { ...context.gradient, geometry: { ...(context.gradient.geometry || {}), handles } };
  if (!isValidGradientFill(candidate)) {
    input.setAttribute('aria-invalid', 'true');
    return;
  }
  input.removeAttribute('aria-invalid');
  if (Object.is(previous, value)) return;
  if (!state.controlEdit) { checkpoint('Edit gradient geometry'); state.controlEdit = true; }
  context.gradient.geometry = candidate.geometry;
  recordGradientTrackChange(context);
  renderer.invalidate();
}

function moveGradientGeometryHandle(interaction, world) {
  const local = pageToNodeLocal(interaction.geometry, world, interaction.ancestors);
  const next = structuredClone(interaction.handles);
  next[interaction.handleIndex] = {
    x: local.x / Math.max(1, interaction.geometry.width),
    y: local.y / Math.max(1, interaction.geometry.height)
  };
  const candidate = { ...interaction.gradient, geometry: { ...(interaction.gradient.geometry || {}), handles: next } };
  if (!isValidGradientFill(candidate)) return false;
  if (JSON.stringify(candidate.geometry.handles) === JSON.stringify(interaction.gradient.geometry?.handles)) return false;
  interaction.gradient.geometry = candidate.geometry;
  interaction.handles = next;
  interaction.changed = true;
  recordGradientTrackChange(interaction);
  return true;
}

function insertGradientStopInLargestGap(gradient) {
  const stops = [...(gradient?.stops || [])].sort((left, right) => left.position - right.position);
  if (stops.length < 2 || stops.length >= 8) return null;
  let left = stops[0]; let right = stops[1];
  for (let index = 1; index < stops.length - 1; index += 1) {
    if (stops[index + 1].position - stops[index].position > right.position - left.position) {
      left = stops[index]; right = stops[index + 1];
    }
  }
  return insertGradientStop(gradient, (left.position + right.position) / 2, createId('stop'));
}

function settleGradientEditBeforeGesture() {
  if (!state.controlEdit) return;
  clearTimeout(state.statusTimer);
  state.statusTimer = 0;
  state.controlEdit = false;
  renderLayers();
  renderAssetsTab();
  queueSave();
}

function beginGradientTrackEdit(label) {
  settleGradientEditBeforeGesture();
  checkpoint(label);
  state.controlEdit = true;
}

function recordGradientTrackChange(context) {
  const { node, fill, stroke } = context;
  if (stroke) {
    syncLegacyStrokeFields(node);
    recordNodeComponentOverrides(node, ['strokes', 'stroke', 'strokeWidth', 'strokeOpacity', 'strokeCap', 'strokeJoin', 'strokePattern', 'strokeMiterLimit', 'strokeVariableId', 'variableBindings']);
  } else if (fill) {
    syncLegacyFillFields(node);
    recordNodeComponentOverrides(node, ['fills', 'fillGradient']);
  } else recordNodeComponentOverrides(node, ['fillGradient']);
}

function syncGradientStopTrack(track, gradient, { reorder = true } = {}) {
  const background = gradientFillToCSS(gradient);
  if (!background) return;
  track.style.setProperty('--gradient-preview', background);
  if (reorder) for (const stop of gradient.stops) {
    const handle = [...track.querySelectorAll('[data-gradient-stop-handle]')]
      .find(item => item.dataset.gradientStopId === stop.id);
    if (handle) track.append(handle);
  }
  for (const handle of track.querySelectorAll('[data-gradient-stop-handle]')) {
    const current = gradient.stops.find(item => item.id === handle.dataset.gradientStopId);
    if (!current) continue;
    const percent = Math.round(current.position * 100);
    const index = gradient.stops.indexOf(current);
    handle.style.setProperty('--gradient-stop-color', current.color);
    handle.style.left = `${Number((current.position * 100).toFixed(4))}%`;
    handle.setAttribute('aria-valuenow', String(percent));
    handle.setAttribute('aria-valuetext', `${percent} percent`);
    handle.setAttribute('aria-label', `Gradient stop ${index + 1} position`);
    handle.title = `Drag to move stop ${index + 1}; use arrow keys to adjust`;
  }
  const controls = track.closest('.gradient-editor, .stroke-gradient-controls');
  const rowsContainer = controls?.querySelector('.gradient-stops');
  if (reorder && rowsContainer) for (const stop of gradient.stops) {
    const row = [...rowsContainer.querySelectorAll('[data-gradient-stop-row]')]
      .find(item => item.dataset.gradientStopId === stop.id);
    if (row) rowsContainer.append(row);
  }
  for (const row of controls?.querySelectorAll('[data-gradient-stop-row]') || []) {
    const current = gradient.stops.find(item => item.id === row.dataset.gradientStopId);
    if (!current) continue;
    const index = gradient.stops.indexOf(current);
    const percent = Math.round(current.position * 100);
    const labels = row.querySelectorAll('label span');
    if (labels[0]) labels[0].textContent = `Stop ${index + 1}`;
    if (labels[1]) labels[1].textContent = `${percent}%`;
    const colorInput = row.querySelector('input[type="color"]');
    const positionInput = row.querySelector('input[type="number"]');
    if (colorInput) colorInput.setAttribute('aria-label', `Gradient stop ${index + 1} color`);
    if (positionInput) {
      positionInput.value = String(percent);
      positionInput.setAttribute('aria-label', `Gradient stop ${index + 1} position`);
    }
    row.querySelector('button[data-action="remove-gradient-stop"], button[data-action="remove-stroke-gradient-stop"]')
      ?.setAttribute('aria-label', `Remove gradient stop ${index + 1}`);
  }
}

function moveGradientStop(track, stopId, position, { reorder = true } = {}) {
  const context = gradientTrackContext(track);
  if (!context || !Number.isFinite(position)) return false;
  const stop = context.gradient.stops.find(item => item.id === stopId);
  if (!stop) return false;
  const nextPosition = Math.max(0, Math.min(1, position));
  if (stop.position === nextPosition) return false;
  stop.position = nextPosition;
  context.gradient.stops.sort((left, right) => left.position - right.position);
  recordGradientTrackChange(context);
  syncGradientStopTrack(track, context.gradient, { reorder });
  renderer.invalidate();
  return true;
}

function addGradientStopAtPosition(track, position) {
  const context = gradientTrackContext(track);
  if (!context) return;
  const inserted = insertGradientStop(context.gradient, position, createId('stop'));
  if (!inserted) { showToast('A gradient can have up to 8 color stops.'); return; }
  settleGradientEditBeforeGesture();
  checkpoint('Add gradient stop');
  context.gradient.stops = inserted.stops;
  recordGradientTrackChange(context);
  renderInspector(); queueSave(); renderer.invalidate();
}

function beginGradientStopPointer(event) {
  const handle = event.target.closest('[data-gradient-stop-handle]');
  if (!handle || handle.disabled || event.button !== 0 || state.documentTransitioning || gradientStopDrag) return;
  const track = handle.closest('[data-gradient-stop-track]');
  const context = track && gradientTrackContext(track);
  if (!context || !context.gradient.stops.some(stop => stop.id === handle.dataset.gradientStopId)) return;
  settleGradientEditBeforeGesture();
  gradientStopDrag = { pointerId: event.pointerId, track, handle, stopId: handle.dataset.gradientStopId, changed: false };
  try { handle.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional in older embedded browsers. */ }
  handle.focus({ preventScroll: true });
  event.preventDefault();
}

function updateGradientStopPointer(event) {
  const drag = gradientStopDrag;
  if (!drag || drag.pointerId !== event.pointerId || state.documentTransitioning) return;
  const bounds = drag.track.getBoundingClientRect();
  if (!(bounds.width > 0)) return;
  const position = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const context = gradientTrackContext(drag.track);
  const stop = context?.gradient.stops.find(item => item.id === drag.stopId);
  if (!stop || stop.position === position) return;
  if (!drag.changed) {
    beginGradientTrackEdit('Move gradient stop');
    drag.changed = true;
  }
  moveGradientStop(drag.track, drag.stopId, position, { reorder: false });
}

function finishGradientStopPointer(event) {
  if (!gradientStopDrag || (event?.pointerId != null && gradientStopDrag.pointerId !== event.pointerId)) return;
  const { handle, pointerId, track, changed } = gradientStopDrag;
  gradientStopDrag = null;
  try { if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId); } catch { /* Pointer capture may already be gone. */ }
  if (changed) {
    const context = gradientTrackContext(track);
    if (context) syncGradientStopTrack(track, context.gradient);
  }
  if (changed || state.controlEdit) finishGradientStopInput();
}

function handleGradientStopKey(event) {
  const handle = event.target.closest('[data-gradient-stop-handle]');
  if (!handle || handle.disabled || state.documentTransitioning) return false;
  const track = handle.closest('[data-gradient-stop-track]');
  const context = track && gradientTrackContext(track);
  const stop = context?.gradient.stops.find(item => item.id === handle.dataset.gradientStopId);
  if (!stop) return false;
  const step = event.shiftKey ? 0.1 : 0.01;
  let position = stop.position;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') position -= step;
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') position += step;
  else if (event.key === 'Home') position = 0;
  else if (event.key === 'End') position = 1;
  else return false;
  event.preventDefault();
  event.stopPropagation();
  position = Math.max(0, Math.min(1, position));
  if (position !== stop.position) {
    if (!state.controlEdit) beginGradientTrackEdit('Move gradient stop');
    moveGradientStop(track, handle.dataset.gradientStopId, position);
    finishGradientStopInput();
  }
  return true;
}

function finishGradientStopInput() {
  if (!state.controlEdit) return;
  clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(() => {
    state.controlEdit = false;
    renderLayers();
    renderAssetsTab();
    queueSave();
  }, 160);
}

function updateFillInput(input) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  if (!node || node.locked) return;
  const fills = ensureFillStack(node);
  const fill = fills.find(item => item.id === input.dataset.fillId);
  if (!fill) return;
  const field = input.dataset.fillField;
  if (!state.controlEdit) { checkpoint('Edit fill'); state.controlEdit = true; }
  if (field === 'visible') updateFillLayer(node, fill.id, { visible: input.checked });
  else if (field === 'opacity' && Number.isFinite(Number(input.value))) {
    updateFillLayer(node, fill.id, { opacity: Math.max(0, Math.min(1, Number(input.value) / 100)) });
    if (input.nextElementSibling) input.nextElementSibling.value = `${input.value}%`;
  } else if (field === 'color' && /^#[0-9a-f]{6}$/i.test(input.value)) {
    updateFillLayer(node, fill.id, { color: input.value });
    if (fill === fills[0]) {
      delete node.fillVariableId;
      delete node.fillStyleId;
      if (node.variableBindings) delete node.variableBindings.fill;
    }
  }
  else if (field === 'type') {
    if (!['solid', 'linear', 'radial', 'angular', 'image'].includes(input.value)) return;
    let replacement;
    if (input.value === 'image') {
      const source = imageFillSources()[0];
      if (!source) { showToast('Place an image on the canvas before using it as a fill.'); renderInspector(); return; }
      replacement = createFillLayer('image', { assetId: source.assetId });
    } else {
      const resolvedColor = getNodeColor(state.document, node, 'fill');
      replacement = createFillLayer(input.value, input.value === 'solid' ? { color: /^#[0-9a-f]{6}$/i.test(resolvedColor) ? resolvedColor : '#d9d9d9' } : {});
    }
    const wasPrimary = fill === fills[0];
    for (const key of ['color', 'gradient', 'imageFill']) delete fill[key];
    Object.assign(fill, replacement, { id: fill.id, visible: fill.visible, opacity: fill.opacity });
    if (wasPrimary) {
      delete node.fillVariableId; delete node.fillStyleId;
      if (node.variableBindings) delete node.variableBindings.fill;
    }
  } else return;
  const isPrimary = ensureFillStack(node)[0] === fill;
  if (isPrimary) syncLegacyFillFields(node);
  if (field === 'type') reconcileImagePreviewRuntime();
  recordNodeComponentOverrides(node, ['fills', ...(isPrimary ? ['fill', 'fillOpacity', 'fillGradient', 'imageFill', 'fillStyleId', 'fillVariableId', 'variableBindings'] : [])]);
  renderer.invalidate();
}

function updateStrokeInput(input) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  if (!node || node.locked) return;
  const strokes = ensureStrokeStack(node);
  const stroke = strokes.find(item => item.id === input.dataset.strokeId);
  if (!stroke) return;
  const field = input.dataset.strokeField;
  const index = strokes.indexOf(stroke);
  if (!state.controlEdit) { checkpoint('Edit stroke'); state.controlEdit = true; }
  if (field === 'paint') {
    if (input.value === 'solid') updateStroke(node, stroke.id, { gradient: null });
    else if (['linear', 'radial', 'angular'].includes(input.value)) {
      if (index === 0) detachPrimaryStrokeBinding(node, stroke, getNodeColor(state.document, node, 'stroke'));
      const gradient = stroke.gradient ? structuredClone(stroke.gradient) : createGradientFill(input.value, /^#[0-9a-f]{6}$/i.test(stroke.color) ? stroke.color : '#1e1e1e');
      gradient.type = input.value;
      updateStroke(node, stroke.id, { gradient });
    } else return;
    renderInspector();
  } else if (field === 'gradientAngle' && stroke.gradient && Number.isFinite(Number(input.value))) {
    stroke.gradient.angle = Math.max(0, Math.min(359, Number(input.value)));
  } else if (field === 'gradientStopColor' && stroke.gradient && /^#[0-9a-f]{6}$/i.test(input.value)) {
    const stop = stroke.gradient.stops.find(item => item.id === input.dataset.strokeGradientStopId);
    if (!stop) return;
    stop.color = input.value;
  } else if (field === 'gradientStopPosition' && stroke.gradient && Number.isFinite(Number(input.value))) {
    const stop = stroke.gradient.stops.find(item => item.id === input.dataset.strokeGradientStopId);
    if (!stop) return;
    stop.position = Math.max(0, Math.min(1, Number(input.value) / 100));
    stroke.gradient.stops.sort((a, b) => a.position - b.position);
  } else if (field === 'color') {
    if (!/^#[0-9a-f]{6}$/i.test(input.value)) return;
    if (index === 0) detachPrimaryStrokeBinding(node, stroke, getNodeColor(state.document, node, 'stroke'));
    updateStroke(node, stroke.id, { color: input.value });
  } else if (field === 'visible') updateStroke(node, stroke.id, { visible: input.checked });
  else if (field === 'opacity' && Number.isFinite(Number(input.value))) {
    const opacity = Math.max(0, Math.min(1, Number(input.value) / 100));
    updateStroke(node, stroke.id, { opacity });
    if (input.nextElementSibling) input.nextElementSibling.value = `${Math.round(opacity * 100)}%`;
  } else if (field === 'width' && Number.isFinite(Number(input.value))) updateStroke(node, stroke.id, { width: Number(input.value) });
  else if (field === 'miterLimit' && Number.isFinite(Number(input.value))) updateStroke(node, stroke.id, { miterLimit: Number(input.value) });
  else if (field === 'cap' && ['butt', 'round', 'square'].includes(input.value)) updateStroke(node, stroke.id, { cap: input.value });
  else if (field === 'join' && ['miter', 'round', 'bevel'].includes(input.value)) updateStroke(node, stroke.id, { join: input.value });
  else if (field === 'pattern' && ['solid', 'dashed', 'dotted'].includes(input.value)) {
    updateStroke(node, stroke.id, input.value === 'dotted' ? { pattern: input.value, cap: 'round' } : { pattern: input.value });
    renderInspector();
  } else if (field === 'startDecoration' && strokeDecorationTypes.includes(input.value)) updateStroke(node, stroke.id, { startDecoration: input.value });
  else if (field === 'endDecoration' && strokeDecorationTypes.includes(input.value)) updateStroke(node, stroke.id, { endDecoration: input.value });
  else return;
  syncLegacyStrokeFields(node);
  recordNodeComponentOverrides(node, ['strokes', 'stroke', 'strokeWidth', 'strokeOpacity', 'strokeCap', 'strokeJoin', 'strokePattern', 'strokeMiterLimit', 'strokeVariableId', 'variableBindings']);
  const track = input.closest('.stroke-gradient-controls')?.querySelector('[data-gradient-stop-track]');
  if (track && stroke.gradient) syncGradientStopTrack(track, stroke.gradient);
  renderer.invalidate();
}

function updateLayerEffectInput(input) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  const effect = node?.effects?.find(item => item.id === input.dataset.effectId);
  if (!effect || node.locked) return;
  if (!state.controlEdit) { checkpoint('Edit layer effect'); state.controlEdit = true; }
  const field = input.dataset.effectField;
  if (field === 'visible') effect.visible = input.checked;
  else if (field === 'color') effect.color = input.value;
  else if (field === 'color2' && effect.type === 'noise' && /^#[0-9a-f]{6}$/i.test(input.value)) effect.color2 = input.value;
  else if (field === 'mode' && effect.type === 'noise' && ['mono', 'duo', 'multi'].includes(input.value)) {
    effect.mode = input.value;
    renderInspector();
  }
  else if (field === 'sizeX' || field === 'sizeY') {
    if (!['noise', 'texture'].includes(effect.type) || input.value === '' || !Number.isFinite(Number(input.value))) return;
    effect[field] = effect.type === 'texture'
      ? Math.max(0.1, Math.min(100, Number(input.value)))
      : Math.max(1, Math.min(100, Number(input.value)));
    input.value = String(effect[field]);
  }
  else if (field === 'clipToShape' && effect.type === 'texture') effect.clipToShape = input.checked;
  else if (field === 'density' && effect.type === 'noise' && Number.isFinite(Number(input.value))) {
    effect.density = Math.max(0, Math.min(100, Number(input.value)));
    input.nextElementSibling.value = `${Math.round(effect.density)}%`;
  }
  else if (field === 'opacity' && effect.type === 'noise' && Number.isFinite(Number(input.value))) {
    effect.opacity = Math.max(0, Math.min(1, Number(input.value) / 100));
    input.nextElementSibling.value = `${Math.round(effect.opacity * 100)}%`;
  }
  else if (field === 'opacity') {
    effect.opacity = Number(input.value) / 100;
    input.nextElementSibling.value = `${input.value}%`;
  } else if (field === 'radius' && effect.type === 'texture' && Number.isFinite(Number(input.value))) {
    effect.radius = Math.max(0, Math.min(100, Number(input.value)));
    input.value = String(effect.radius);
  } else if (effect.type === 'glass' && ['lightAngle', 'lightIntensity', 'refraction', 'depth', 'dispersion', 'frost', 'splay'].includes(field) && input.value !== '' && Number.isFinite(Number(input.value))) {
    const maximum = field === 'lightAngle' ? 360 : 100;
    effect[field] = Math.max(0, Math.min(maximum, Number(input.value)));
    input.value = String(effect[field]);
    if (input.nextElementSibling?.tagName === 'OUTPUT') input.nextElementSibling.value = `${Math.round(effect[field])}${field === 'lightAngle' ? '°' : '%'}`;
  } else if (['offsetX', 'offsetY', 'blur', 'radius'].includes(field) && Number.isFinite(Number(input.value))) effect[field] = Number(input.value);
  else return;
  recordNodeComponentOverrides(node, ['effects']);
  renderer.invalidate();
}

function updateImageFillInput(input) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  const fill = node && input.dataset.fillId ? ensureFillStack(node).find(item => item.id === input.dataset.fillId) : null;
  const imageFill = input.dataset.fillId ? fill?.imageFill : node?.imageFill;
  if (!imageFill || node.locked) return;
  if (!state.controlEdit) { checkpoint('Edit image fill'); state.controlEdit = true; }
  const field = input.dataset.imageFillField;
  if (field === 'assetId') {
    if (!imageFillSources().some(source => source.assetId === input.value)) return;
    imageFill.assetId = input.value;
  } else if (field === 'fit') imageFill.fit = input.value;
  else if (field.startsWith('adjustments.')) {
    const key = field.slice('adjustments.'.length);
    imageFill.adjustments = { ...defaultImageAdjustments, ...imageFill.adjustments };
    if (!Object.hasOwn(imageFill.adjustments, key)) return;
    imageFill.adjustments[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
    if (key === 'solarize') imageFill.adjustments.solarizeThreshold = input.checked ? (imageFill.adjustments.solarizeThreshold || 128) : 0;
    if (input.type === 'range' && input.nextElementSibling) input.nextElementSibling.value = input.value;
    syncImageToneControls(input, imageFill.adjustments, node.locked);
  } else return;
  if (fill) {
    if (fill === ensureFillStack(node)[0]) syncLegacyFillFields(node);
    recordNodeComponentOverrides(node, ['fills', ...(fill === ensureFillStack(node)[0] ? ['imageFill'] : [])]);
  } else recordNodeComponentOverrides(node, ['imageFill']);
  if (field === 'assetId' || field.startsWith('adjustments.')) schedulePreview(node, field === 'assetId', fill?.id || null);
  if (state.imageFillCropTarget?.nodeId === node.id && state.imageFillCropTarget?.fillId === (fill?.id || null)) syncImageCropOverlay();
  renderer.invalidate();
}

function imageTransformTarget(node, target, fillId = '') {
  if (target === 'fill') {
    if (fillId) {
      const fill = ensureFillStack(node).find(item => item.id === fillId);
      return fill?.type === 'image' ? fill.imageFill || null : null;
    }
    return node?.imageFill || null;
  }
  return node?.type === 'image' ? node : null;
}

function imageCropContext(node) {
  if (node?.type !== 'image') return null;
  const context = nodeTransformContext(node);
  const asset = state.assets.get(node.assetId);
  const sourceWidth = asset?.sourceWidth || node.sourceWidth;
  const sourceHeight = asset?.sourceHeight || node.sourceHeight;
  if (!context || !Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)) return null;
  const transforms = createImageTransforms(node.transforms || {});
  const sourceGeometry = calculateImageCropDisplayBounds({
    frameWidth: context.geometry.width,
    frameHeight: context.geometry.height,
    sourceWidth,
    sourceHeight,
    crop: null,
    rotation: transforms.rotation,
    flipHorizontal: transforms.flipHorizontal,
    flipVertical: transforms.flipVertical,
    fit: node.fit === 'contain' ? 'contain' : 'cover'
  });
  const virtualBounds = sourceGeometry.drawBounds;
  return {
    ...context, ...sourceGeometry,
    sourceWidth, sourceHeight, rotation: transforms.rotation, crop: transforms.crop,
    flipHorizontal: transforms.flipHorizontal, flipVertical: transforms.flipVertical,
    virtualBounds,
    drawBounds: imageCropRectInBounds(transforms.crop, transforms.rotation, virtualBounds, transforms)
  };
}

function imageFillCropContext(node, fillId) {
  if (!node || node.locked || typeof fillId !== 'string') return null;
  const context = nodeTransformContext(node);
  const fill = fillStackForNode(node).find(item => item.id === fillId && item.type === 'image');
  const imageFill = fill?.imageFill;
  const asset = imageFill?.assetId ? state.assets.get(imageFill.assetId) : null;
  const sourceWidth = asset?.sourceWidth;
  const sourceHeight = asset?.sourceHeight;
  if (!context || !imageFill || imageFill.fit !== 'cover'
    || !Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)) return null;
  const transforms = createImageTransforms(imageFill.transforms || {});
  const crop = calculateImageFillCropWindow({
    frameWidth: context.geometry.width,
    frameHeight: context.geometry.height,
    sourceWidth,
    sourceHeight,
    transforms,
    fit: 'cover'
  });
  const sourceCrop = imageCropFromDisplayRect(crop, transforms.rotation, transforms);
  const sourceGeometry = calculateImageCropDisplayBounds({
    frameWidth: context.geometry.width,
    frameHeight: context.geometry.height,
    sourceWidth,
    sourceHeight,
    crop: sourceCrop,
    rotation: transforms.rotation,
    flipHorizontal: transforms.flipHorizontal,
    flipVertical: transforms.flipVertical,
    fit: 'cover'
  });
  return {
    ...context, fillId, imageFill, assetId: imageFill.assetId,
    sourceWidth, sourceHeight, rotation: transforms.rotation,
    flipHorizontal: transforms.flipHorizontal, flipVertical: transforms.flipVertical,
    virtualBounds: sourceGeometry.drawBounds, crop
  };
}

function imageCropRectInBounds(crop, rotation, bounds, flips = {}) {
  const displayed = imageCropToDisplayRect(crop || { left: 0, top: 0, right: 1, bottom: 1 }, rotation, flips);
  return {
    left: bounds.left + displayed.left * bounds.width,
    top: bounds.top + displayed.top * bounds.height,
    width: (displayed.right - displayed.left) * bounds.width,
    height: (displayed.bottom - displayed.top) * bounds.height
  };
}

function syncImageCropOverlay() {
  if (!state.imageCropMode || state.selectedIds.length !== 1) {
    state.imageCropOverlay = null;
    state.imageCropDraftSelection = null;
    if (!state.imageCropMode || state.selectedIds.length !== 1) state.imageFillCropTarget = null;
    return null;
  }
  const node = findNode(state.document, state.selectedIds[0])?.node;
  if (state.imageFillCropTarget) {
    if (!node || node.id !== state.imageFillCropTarget.nodeId || node.locked) {
      state.imageCropMode = false;
      state.imageFillCropTarget = null;
      state.imageCropOverlay = null;
      return null;
    }
    const context = imageFillCropContext(node, state.imageFillCropTarget.fillId);
    if (!context) {
      state.imageCropMode = false;
      state.imageFillCropTarget = null;
      state.imageCropOverlay = null;
      return null;
    }
    const interaction = state.interaction?.kind === 'image-fill-crop'
      && state.interaction.node.id === node.id
      && state.interaction.fillId === context.fillId ? state.interaction : null;
    if (interaction) {
      interaction.context = context;
      interaction.bounds = context.virtualBounds;
    }
    state.imageCropOverlay = {
      kind: 'fill', nodeId: node.id, fillId: context.fillId,
      virtualBounds: context.virtualBounds,
      crop: interaction?.crop || context.crop,
      rotation: context.rotation,
      flipHorizontal: context.flipHorizontal,
      flipVertical: context.flipVertical
    };
    return context;
  }
  if (!node || node.type !== 'image' || node.locked) {
    state.imageCropMode = false;
    state.imageFillCropTarget = null;
    state.imageCropOverlay = null;
    state.imageCropDraftSelection = null;
    return null;
  }
  const context = imageCropContext(node);
  const interaction = state.interaction?.kind === 'image-crop' && state.interaction.node.id === node.id
    ? state.interaction : null;
  const virtualBounds = interaction?.bounds || context?.virtualBounds;
  const crop = interaction?.crop || context?.crop || null;
  state.imageCropOverlay = context ? {
    kind: 'layer', nodeId: node.id,
    drawBounds: imageCropRectInBounds(crop, interaction?.rotation ?? context.rotation, virtualBounds, {
      flipHorizontal: interaction?.flipHorizontal ?? context.flipHorizontal,
      flipVertical: interaction?.flipVertical ?? context.flipVertical,
    }),
    virtualBounds,
    crop,
    rotation: interaction?.rotation ?? context.rotation
  } : null;
  return context;
}

function imageCropHandlePoints(bounds) {
  const left = bounds.left; const top = bounds.top;
  const right = left + bounds.width; const bottom = top + bounds.height;
  const middleX = (left + right) / 2; const middleY = (top + bottom) / 2;
  return {
    nw: { x: left, y: top }, n: { x: middleX, y: top }, ne: { x: right, y: top },
    e: { x: right, y: middleY }, se: { x: right, y: bottom }, s: { x: middleX, y: bottom },
    sw: { x: left, y: bottom }, w: { x: left, y: middleY }
  };
}

function imageCropHandleAt(event, context) {
  if (!context) return null;
  const handles = Object.entries(imageCropHandlePoints(context.drawBounds)).map(([name, localPoint]) => ({
    kind: 'image-crop-handle', name,
    localPoint,
    point: worldToScreen(nodeLocalToPage(context.geometry, localPoint, context.ancestors), canvas, state)
  }));
  return nearestScreenHandle({ x: event.clientX, y: event.clientY }, handles, event.pointerType === 'touch' ? 24 : 12);
}

function imageCropVisibleBounds(context) {
  return { ...context.virtualBounds };
}

function clampImageCropPoint(point, bounds) {
  return {
    x: Math.max(bounds.left, Math.min(bounds.left + bounds.width, point.x)),
    y: Math.max(bounds.top, Math.min(bounds.top + bounds.height, point.y))
  };
}

function updateImageTransformInput(input) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  const targetName = input.dataset.imageTransformTarget;
  const target = imageTransformTarget(node, targetName, input.dataset.fillId);
  if (!node || !target || node.locked || input.value.trim() === '') return;
  const edge = input.dataset.imageTransformField;
  if (!['left', 'top', 'right', 'bottom'].includes(edge)) return;
  const percent = Number(input.value);
  if (!Number.isFinite(percent)) return;
  const value = Math.max(0, Math.min(100, percent)) / 100;
  const current = createImageTransforms(target.transforms || {});
  const crop = { ...(current.crop || { left: 0, top: 0, right: 1, bottom: 1 }) };
  const start = edge === 'left' ? 'left' : edge === 'top' ? 'top' : null;
  const end = edge === 'right' ? 'right' : edge === 'bottom' ? 'bottom' : null;
  const counterpart = start ? (edge === 'left' ? 'right' : 'bottom') : (edge === 'right' ? 'left' : 'top');
  crop[edge] = value;
  if (start && crop[edge] >= crop[counterpart]) {
    if (value >= 1) { crop[edge] = 0.99; crop[counterpart] = 1; }
    else crop[counterpart] = Math.min(1, value + 0.01);
  } else if (end && crop[edge] <= crop[counterpart]) {
    if (value <= 0) { crop[edge] = 0.01; crop[counterpart] = 0; }
    else crop[counterpart] = Math.max(0, value - 0.01);
  }
  const transforms = createImageTransforms({ ...current, crop });
  if (!state.controlEdit) { checkpoint('Crop image'); state.controlEdit = true; }
  target.transforms = transforms;
  if (input.nextElementSibling?.tagName === 'OUTPUT') input.nextElementSibling.value = `${Math.round(crop[edge] * 100)}%`;
  if (targetName === 'fill') {
    const fills = ensureFillStack(node);
    const fill = fills.find(item => item.id === input.dataset.fillId);
    if (!fill) return;
    if (fill === fills[0]) syncLegacyFillFields(node);
    recordNodeComponentOverrides(node, ['fills', ...(fill === fills[0] ? ['imageFill'] : [])]);
    schedulePreview(node, false, fill.id);
    if (state.imageFillCropTarget?.nodeId === node.id && state.imageFillCropTarget?.fillId === fill.id) syncImageCropOverlay();
  } else {
    recordNodeComponentOverrides(node, ['transforms']);
    schedulePreview(node);
    syncImageCropOverlay();
  }
  renderer.invalidate();
}

function updateImageFillZoomInput(input) {
  const node = selectedNodes().length === 1 ? selectedNodes()[0] : null;
  const fillId = input.dataset.fillId;
  const context = node && imageFillCropContext(node, fillId);
  let target = node && imageFillTarget(node, fillId);
  const value = Number(input.value);
  if (!node || !context || !target || node.locked || !Number.isFinite(value)) return;
  const current = createImageTransforms(target.transforms || {});
  const currentWindow = calculateImageFillCropWindow({
    frameWidth: context.geometry.width, frameHeight: context.geometry.height,
    sourceWidth: context.sourceWidth, sourceHeight: context.sourceHeight,
    transforms: current, fit: 'cover'
  });
  const baseWindow = calculateImageFillCropWindow({
    frameWidth: context.geometry.width, frameHeight: context.geometry.height,
    sourceWidth: context.sourceWidth, sourceHeight: context.sourceHeight,
    transforms: { ...current, crop: null }, fit: 'cover'
  });
  const currentZoom = (baseWindow.right - baseWindow.left) / (currentWindow.right - currentWindow.left);
  const crop = zoomImageFillCropWindow({
    crop: imageCropFromDisplayRect(currentWindow, current.rotation, current),
    zoom: (Math.max(100, Math.min(800, value)) / 100) / currentZoom,
    focal: { x: context.geometry.width / 2, y: context.geometry.height / 2 },
    bounds: context.virtualBounds,
    sourceWidth: context.sourceWidth, sourceHeight: context.sourceHeight,
    rotation: current.rotation, flipHorizontal: current.flipHorizontal, flipVertical: current.flipVertical
  });
  const transforms = createImageTransforms({ ...current, crop });
  if (JSON.stringify(transforms) === JSON.stringify(current)) return;
  if (!state.controlEdit) { checkpoint('Zoom image fill'); state.controlEdit = true; }
  if (!Array.isArray(node.fills)) {
    const materialized = ensureFillStack(node).find(item => item.id === fillId && item.type === 'image');
    if (!materialized) return;
    target = materialized.imageFill;
  }
  target.transforms = transforms;
  const fills = Array.isArray(node.fills) ? node.fills : null;
  const fill = fills?.find(item => item.id === fillId);
  if (fill && fill === fills[0]) syncLegacyFillFields(node);
  recordNodeComponentOverrides(node, fills
    ? ['fills', ...(fill === fills[0] ? ['imageFill'] : [])]
    : ['imageFill']);
  const active = state.imageFillCropTarget?.nodeId === node.id && state.imageFillCropTarget?.fillId === fillId;
  if (active) syncImageCropOverlay();
  if (input.nextElementSibling?.tagName === 'OUTPUT') input.nextElementSibling.value = `${Math.round(value)}%`;
  schedulePreview(node, false, fillId);
  renderer.invalidate();
}

function applyImageTransformAction(node, targetName, action, direction, fillId = '') {
  const target = imageTransformTarget(node, targetName, fillId);
  if (!target || node.locked) return;
  const current = createImageTransforms(target.transforms || {});
  let transforms;
  if (action === 'rotate-image') transforms = rotateImageTransforms(current, direction);
  else if (action === 'flip-image') transforms = flipImageTransforms(current, direction);
  else if (action === 'reset-image-transforms') transforms = createImageTransforms();
  else return;
  if (JSON.stringify(transforms) === JSON.stringify(current)) return;
  checkpoint(action === 'rotate-image' ? 'Rotate image' : action === 'flip-image' ? 'Flip image' : 'Reset image transforms');
  target.transforms = transforms;
  if (targetName === 'fill') {
    const fills = ensureFillStack(node);
    const fill = fills.find(item => item.id === fillId);
    if (!fill) return;
    if (fill === fills[0]) syncLegacyFillFields(node);
    recordNodeComponentOverrides(node, ['fills', ...(fill === fills[0] ? ['imageFill'] : [])]);
    schedulePreview(node, true, fill.id);
    if (state.imageFillCropTarget?.nodeId === node.id && state.imageFillCropTarget?.fillId === fill.id) syncImageCropOverlay();
  } else {
    recordNodeComponentOverrides(node, ['transforms']);
    schedulePreview(node, true);
    syncImageCropOverlay();
  }
  renderInspector(); queueSave(); renderer.invalidate();
}

function updateInspectorInput(event) {
  const input = event.target.closest('[data-prop]');
  const selected = selectedNodes();
  if (!input || !selected.length) return;
  if (selected.length === 1 && selected[0].type === 'slice' && ['width', 'height'].includes(input.dataset.prop)) {
    if (!isValidSliceDimensionInput(input.value)) {
      if (event.type === 'change') {
        const hadPendingEdit = state.controlEdit;
        state.controlEdit = false;
        renderInspector();
        if (hadPendingEdit) queueSave();
      }
      return;
    }
  }
  if (selected.length > 1 && selected.some(node => node.type === 'image' && isActiveImageRecipeTarget(node.id))) return;
  const prop = input.dataset.prop;
  if (prop.startsWith('adjustments.') && selected.some(node => node.type === 'image' && node.locked)) return;
  if (prop.startsWith('selection.')) { updateSelectionInspectorInput(input); return; }
  if (['width', 'height'].includes(prop) && selectedNodes().some(node => selectionDimensionIsHugged([{ node }], prop))) {
    const node = selectedNodes()[0];
    input.value = String(resolvedGeometry(node)[prop]);
    return;
  }
  if (prop === 'fontFamily' && !input.value.trim()) {
    if (event.type === 'change') input.value = selectedNodes()[0]?.fontFamily || 'Inter, Arial, sans-serif';
    return;
  }
  if (!state.controlEdit) { checkpoint('Edit properties'); state.controlEdit = true; }
  const value = input.dataset.optionalNumber !== undefined && !input.value.trim() ? null : input.type === 'checkbox' ? input.checked : input.type === 'number' || input.type === 'range' || prop === 'fontWeight' ? Number(input.value) : input.value;
  const propertyValue = prop === 'opacity' ? value / 100
    : prop === 'points' ? Math.max(3, Math.min(32, Math.round(Number.isFinite(value) ? value : 3)))
    : prop === 'innerRadius' ? Math.max(0, Math.min(1, Number.isFinite(value) ? value : .48))
      : ['paragraphSpacing', 'firstLineIndent', 'listSpacing'].includes(prop) ? Math.max(0, Math.min(10_000, Number.isFinite(value) ? value : 0))
        : value;
  if (input.type === 'range' && input.nextElementSibling) input.nextElementSibling.value = `${Math.round(value)}${['opacity', 'outputQuality'].includes(prop) ? '%' : ''}`;
  const adjustments = prop.startsWith('adjustments.');
  const layoutSetting = prop.startsWith('autoLayout.');
  const constraintSetting = prop.startsWith('constraints.');
  const gridCellSetting = prop.startsWith('gridCell.');
  const key = adjustments ? prop.slice('adjustments.'.length) : layoutSetting ? prop.slice('autoLayout.'.length) : constraintSetting ? prop.slice('constraints.'.length) : prop;
  for (const node of selectedNodes()) {
    const instanceRoot = componentInstanceRoot(node.id);
    if (node.type === 'text' && TYPOGRAPHY_STYLE_PROPERTIES.has(prop) && node.typographyStyleId) {
      delete node.typographyStyleId;
      if (instanceRoot) recordComponentOverride(instanceRoot, node, 'typographyStyleId');
    }
    const oldRawWidth = node.width; const oldRawHeight = node.height;
    const oldWidth = resolvedGeometry(node).width; const oldHeight = resolvedGeometry(node).height;
    let adjustedSizeLimit = null;
    const variableProperty = prop === 'fill' ? 'fillVariableId' : prop === 'color' ? 'textVariableId' : prop === 'stroke' ? 'strokeVariableId' : null;
    const boundVariableId = node.variableBindings?.[prop];
    if (prop === 'fillType') {
      if (value === 'solid') {
        if (instanceRoot) { node.fillGradient = null; node.imageFill = null; }
        else { delete node.fillGradient; delete node.imageFill; }
      } else if (value === 'image') {
        const source = imageFillSources()[0];
        if (!source) { showToast('Place an image on the canvas before using it as a fill.'); input.value = node.fillGradient?.type || 'solid'; return; }
        node.imageFill = createImageFill(source.assetId);
        if (instanceRoot) node.fillGradient = null; else delete node.fillGradient;
        if (instanceRoot) { node.fillVariableId = null; node.fillStyleId = null; }
        else { delete node.fillVariableId; delete node.fillStyleId; }
        schedulePreview(node, true);
      } else {
        const baseColor = getNodeColor(state.document, node, 'fill');
        if (instanceRoot) node.imageFill = null; else delete node.imageFill;
        if (!node.fillGradient) node.fillGradient = createGradientFill(value, /^#[0-9a-f]{6}$/i.test(baseColor || '') ? baseColor : '#d9d9d9');
        else node.fillGradient.type = value;
        if (instanceRoot) { node.fillVariableId = null; node.fillStyleId = null; }
        else { delete node.fillVariableId; delete node.fillStyleId; }
      }
    }
    else if (boundVariableId) setNodePropertyValue(node, prop, propertyValue);
    else if (prop === 'closed' && node.type === 'path') {
      const contourIndex = state.selectedVectorPoint?.nodeId === node.id ? state.selectedVectorPoint.contourIndex || 0 : 0;
      const contour = vectorPathContours(node)[contourIndex];
      if (contour) {
        if (contourIndex === 0) node.closed = value;
        else node.subpaths[contourIndex - 1].closed = value;
        recordNodeComponentOverrides(node, contourIndex === 0 ? ['closed'] : ['subpaths']);
      }
    }
    else if (adjustments) {
      node.adjustments = { ...node.adjustments, [key]: value };
      if (key === 'solarize') node.adjustments.solarizeThreshold = value ? (node.adjustments.solarizeThreshold || 128) : 0;
    }
    else if (constraintSetting) { node.constraints = { horizontal: 'left', vertical: 'top', ...(node.constraints || {}), [key]: value }; }
    else if (prop === 'layoutPositioning') {
      if (value === 'absolute') node.layoutPositioning = 'absolute';
      else delete node.layoutPositioning;
    }
    else if (variableProperty && instanceRoot) { delete node[variableProperty]; if (prop === 'fill') delete node.fillStyleId; if (prop === 'color') delete node.textStyleId; node[prop] = value; }
    else if (prop === 'fill' && node.fillVariableId) setColorVariableValue(state.document, node.fillVariableId, value, variableModeForNode(state.document, state.document.variables.find(item => item.id === node.fillVariableId)?.collectionId, node));
    else if (prop === 'color' && node.textVariableId) setColorVariableValue(state.document, node.textVariableId, value, variableModeForNode(state.document, state.document.variables.find(item => item.id === node.textVariableId)?.collectionId, node));
    else if (prop === 'stroke' && node.strokeVariableId) setColorVariableValue(state.document, node.strokeVariableId, value, variableModeForNode(state.document, state.document.variables.find(item => item.id === node.strokeVariableId)?.collectionId, node));
    else if (prop === 'fill' && instanceRoot) { delete node.fillStyleId; node.fill = value; }
    else if (prop === 'color' && instanceRoot) { delete node.textStyleId; node.color = value; }
    else if (prop === 'fill' && node.fillStyleId) {
      const style = state.document.colorStyles?.find(item => item.id === node.fillStyleId);
      if (style) style.value = value; else node.fill = value;
    } else if (prop === 'color' && node.textStyleId) {
      const style = state.document.colorStyles?.find(item => item.id === node.textStyleId);
      if (style) style.value = value; else node.color = value;
    }
    else if (layoutSetting) {
      node.autoLayout = createAutoLayout(node.autoLayout || {});
      if (key.startsWith('padding.')) {
        const side = key.slice('padding.'.length);
        if (['top', 'right', 'bottom', 'left'].includes(side)) node.autoLayout.padding[side] = value;
      } else if (/^(columnTracks|rowTracks)\./.test(key)) updateAutoLayoutGridTrack(node, key, propertyValue);
      else node.autoLayout[key] = value;
    } else if (gridCellSetting) {
      const parent = findNode(state.document, node.id)?.parent;
      node.gridCell ||= {};
      node.gridCell[key.slice('gridCell.'.length)] = value;
      if (parent?.autoLayout) applyAutoLayout(parent);
    } else if (['minWidth', 'maxWidth', 'minHeight', 'maxHeight'].includes(prop)) {
      node[prop] = propertyValue;
      const pair = { minWidth: 'maxWidth', maxWidth: 'minWidth', minHeight: 'maxHeight', maxHeight: 'minHeight' }[prop];
      if (propertyValue != null && Number.isFinite(node[pair]) && ((prop.startsWith('min') && propertyValue > node[pair]) || (prop.startsWith('max') && propertyValue < node[pair]))) {
        node[pair] = propertyValue;
        adjustedSizeLimit = pair;
      }
      const parent = findNode(state.document, node.id)?.parent;
      if (node.type === 'frame' && node.autoLayout) applyAutoLayout(node);
      if (parent?.autoLayout) applyAutoLayout(parent);
    }
    else if (prop.startsWith('cornerRadii.')) {
      const side = prop.slice('cornerRadii.'.length);
      if (cornerRadiusKeys.includes(side)) {
        const baseRadius = Math.max(0, Number(getNodePropertyValue(state.document, node, 'radius')) || 0);
        node.cornerRadii ||= Object.fromEntries(cornerRadiusKeys.map(corner => [corner, baseRadius]));
        node.cornerRadii[side] = Math.max(0, Math.min(100_000, Number(propertyValue) || 0));
      }
    }
    else if (prop === 'points' || prop === 'innerRadius' || prop === 'paragraphSpacing' || prop === 'firstLineIndent' || prop === 'listSpacing') node[prop] = propertyValue;
    else if (prop === 'opacity' || prop === 'fillOpacity') node[prop] = value / 100;
    else node[prop] = value;
    if (node.type === 'text' && ['fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'firstLineIndent', 'listSpacing', 'textFit', 'textCase', 'text', 'width'].includes(prop)) {
      const resized = resizeTextNode(node);
      const parent = findNode(state.document, node.id)?.parent;
      if (boundVariableId && ['text', 'fontSize', 'lineHeight', 'letterSpacing'].includes(prop)) resizeTextLayers(state.document.pages.flatMap(page => page.children), boundVariableId);
      else if (resized && parent?.autoLayout) applyAutoLayout(parent);
    }
    const geometry = resolvedGeometry(node);
    if ((prop === 'width' || prop === 'height') && node.type === 'frame' && !node.autoLayout) applyFrameConstraints(node, oldWidth, oldHeight, geometry.width, geometry.height);
    if (node.type === 'image' && adjustments) {
      if (key === 'solarize') syncImageToneControls(input, node.adjustments, node.locked);
      schedulePreview(node);
    }
    if (prop === 'width' || prop === 'height' || prop === 'layoutSizingMain' || prop === 'layoutSizingCross' || prop === 'layoutSizingX' || prop === 'layoutSizingY') {
      if (node.type === 'frame' && node.autoLayout) applyAutoLayout(node);
      const parent = findNode(state.document, node.id)?.parent;
      if (parent?.autoLayout) applyAutoLayout(parent);
    }
    if (layoutSetting && node.type === 'frame' && node.autoLayout) {
      applyAutoLayout(node);
      const parent = findNode(state.document, node.id)?.parent;
      if (parent?.autoLayout) applyAutoLayout(parent);
    }
    if (prop === 'layoutPositioning') {
      const parent = findNode(state.document, node.id)?.parent;
      if (parent?.autoLayout) applyAutoLayout(parent);
    }
    if (instanceRoot) {
      const overrideProperty = prop === 'closed' && state.selectedVectorPoint?.nodeId === node.id && (state.selectedVectorPoint.contourIndex || 0) > 0 ? 'subpaths' : prop;
      recordComponentOverride(instanceRoot, node, boundVariableId ? 'variableBindings' : layoutSetting ? 'autoLayout' : gridCellSetting ? 'gridCell' : prop === 'fillType' ? 'fillGradient' : overrideProperty);
      if (prop === 'fillType' && value !== 'solid') {
        recordComponentOverride(instanceRoot, node, 'fillVariableId');
        recordComponentOverride(instanceRoot, node, 'fillStyleId');
      }
      if (prop === 'fillType') recordComponentOverride(instanceRoot, node, 'imageFill');
      if (node.width !== oldRawWidth) recordComponentOverride(instanceRoot, node, 'width');
      if (node.height !== oldRawHeight) recordComponentOverride(instanceRoot, node, 'height');
      if (adjustedSizeLimit) recordComponentOverride(instanceRoot, node, adjustedSizeLimit);
    }
  }
  if (prop === 'overflowBehavior') {
    const removedRoutes = reconcilePrototypeScrollInteractions(state.document, node => recordNodeComponentOverrides(node, ['interactions']));
    if (removedRoutes) showToast(`Removed ${removedRoutes} scroll-to interaction${removedRoutes === 1 ? '' : 's'} without a scrollable target.`);
  }
  renderer.invalidate();
}

function updateNetworkFaceInput(input) {
  const node = selectedNodes().length === 1 && selectedNodes()[0].type === 'network' ? selectedNodes()[0] : null;
  const face = node?.faces?.find(item => item.id === input.dataset.networkFaceFill || item.id === input.dataset.networkFaceOpacity);
  if (!node || node.locked || !face) return;
  if (!state.controlEdit) { checkpoint('Edit vector region'); state.controlEdit = true; }
  if (input.matches('[data-network-face-fill]')) face.fill = input.value;
  else {
    face.fillOpacity = Number(input.value) / 100;
    input.parentElement.parentElement.querySelector('output').value = `${input.value}%`;
  }
  recordNodeComponentOverrides(node, ['faces']);
  renderer.invalidate();
}

function finishInspectorInput() {
  if (gradientStopDrag) return;
  if (!state.controlEdit) return;
  clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(() => { state.controlEdit = false; renderLayers(); renderInspector(); renderAssetsTab(); queueSave(); }, 160);
}
function schedulePreview(node, immediate = false, fillId = null) {
  const previewKey = imagePreviewKey(node.id, fillId);
  const pageId = findNodeAcrossPages(state.document, node.id)?.page.id || state.document.activePageId;
  const fill = fillId
    ? node.fills?.find(item => item.id === fillId) || fillStackForNode(node).find(item => item.id === fillId)
    : null;
  const previous = previewTimers.get(previewKey);
  if (previous) clearTimeout(previous);
  const replacementKey = `preview:${previewKey}`;
  state.renderVersion.set(previewKey, ++nextImageRenderVersion);
  imageEngine.cancelQueuedByKey(replacementKey);
  state.imageStatus.set(previewKey, 'Updating preview…');
  const imageFill = fill?.imageFill || (!fillId ? node.imageFill : null);
  const assetId = imageFill?.assetId || node.assetId;
  const adjustments = imageFill?.adjustments || node.adjustments;
  const transforms = imageFill?.transforms || node.transforms;
  const generation = state.documentGeneration;
  const version = state.renderVersion.get(previewKey);
  const run = async () => {
    try {
      if (!state.assets.get(assetId)?.sourceBytes) await restoreImageAssets(generation, { assetIds: [assetId] });
      if (generation !== state.documentGeneration || state.renderVersion.get(previewKey) !== version) return;
      if (!state.assets.get(assetId)?.sourceBytes) throw new Error('The original image source is unavailable. Reimport it before continuing.');
      await renderImagePreview(node.id, assetId, adjustments, transforms, fillId, null, pageId);
    } catch (error) {
      state.imageStatus.set(previewKey, imagePreviewFailureStatus(error));
      showToast(error.message || 'Could not update the image preview.');
      renderInspector();
    }
  };
  let timer;
  timer = setTimeout(() => {
    if (previewTimers.get(previewKey) !== timer) return;
    previewTimers.delete(previewKey);
    run();
  }, immediate ? 0 : 110);
  previewTimers.set(previewKey, timer);
  if (state.selectedIds.includes(node.id)) {
    if (fillId) updateSelectedImageStatus(node.id, previewKey, fillId);
    else for (const status of [$('#image-engine-status'), $('[data-image-fill-status]')].filter(Boolean)) { status.textContent = 'Updating preview…'; status.classList.remove('image-engine-status'); }
  }
}
function updateSelectedImageStatus(nodeId, previewKey = nodeId, fillId = null) {
  if (!state.selectedIds.includes(nodeId)) return;
  const statusText = state.imageStatus.get(previewKey) || '';
  const isReady = statusText.startsWith('Ready') || statusText.startsWith('Updated');
  const fillStatus = $$('[data-image-fill-status]').find(status => status.dataset.imageFillStatus === previewKey);
  const statuses = fillId ? [fillStatus] : [$('#image-engine-status')];
  for (const status of statuses.filter(Boolean)) {
    status.textContent = statusText;
    status.classList.toggle('image-engine-status', isReady);
  }
}

function assetMemoryKey(assetId) { return `asset:${assetId}`; }
function previewMemoryKey(previewKey) { return `preview:${previewKey}`; }
function retainedImageLimitMessage() {
  const megabytes = Math.round(imageMemoryBudget.limitBytes / 1048576);
  return new ImageMemoryLimitError(`This image would exceed Tiny Image Star’s ${megabytes} MiB local image-memory limit. Import fewer or smaller images, or open a new design to release this design’s image resources.`);
}
function markImagePreviewFallbackShown(error) {
  try {
    if (!error || (typeof error !== 'object' && typeof error !== 'function')) throw new TypeError('Preview failure is not an error object.');
    error.previewFallbackShown = true;
    return error;
  } catch {
    const wrapped = new Error(error instanceof Error ? error.message : String(error ?? 'The edited preview could not be created.'), { cause: error });
    if (error?.name) wrapped.name = error.name;
    wrapped.previewFallbackShown = true;
    return wrapped;
  }
}
function releasePreviewResources(previewKey) {
  const preview = state.previews.get(previewKey);
  state.previews.delete(previewKey);
  try { preview?.close?.(); } catch { /* browser bitmap disposal is best-effort */ }
  const url = state.previewUrls.get(previewKey);
  state.previewUrls.delete(previewKey);
  try { if (url) URL.revokeObjectURL(url); } catch { /* URL may already be revoked */ }
  state.previewAssetIds.delete(previewKey);
  try { imageMemoryBudget.release(previewMemoryKey(previewKey)); } catch { /* always finish dropping preview references */ }
  if (!previewKey.startsWith('image-fill:')) updateImageAssetThumbnail(previewKey);
  renderer?.invalidate();
}

async function renderImagePreview(nodeId, assetId, adjustments, transforms = {}, fillId = null, queueGroup = null, pageId = state.document.activePageId) {
  const previewKey = imagePreviewKey(nodeId, fillId);
  const generation = state.documentGeneration;
  const asset = state.assets.get(assetId);
  if (!asset?.sourceBytes) throw new Error('The original image could not be found on this device.');
  if (state.selectedIds.length === 1 && state.selectedIds[0] === nodeId) imageEngine.setActiveSource(assetId);
  const version = ++nextImageRenderVersion;
  state.renderVersion.set(previewKey, version);
  state.imageStatus.set(previewKey, 'Processing locally…');
  updateSelectedImageStatus(nodeId, previewKey, fillId);
  const sourceDimensions = inspectRasterDimensions(asset.sourceBytes);
  if (!sourceDimensions) throw new Error('Tiny Image Star could not verify this image size before rendering.');
  const outputDimensions = transformedImageDimensions(sourceDimensions.width, sourceDimensions.height, transforms);
  const previewAdmission = estimatePreviewMemoryReservationBytes(outputDimensions);
  if (previewAdmission.retainedBytes > imageMemoryBudget.limitBytes) throw retainedImageLimitMessage();
  let reservation = null;
  let bitmap = null;
  let previewUrl = null;
  let releasedPreviewForCapacity = false;
  try {
    const currentMemoryKey = previewMemoryKey(previewKey);
    reservation = imageMemoryBudget.reserve(previewAdmission.retainedBytes, { kind: 'preview-pending' });
    if (!reservation && imageMemoryBudget.canFit(previewAdmission.retainedBytes, { excluding: [currentMemoryKey] })) {
      // A replacement may need the old bitmap released before its worker is
      // dispatched. Keep the original source bitmap as the visible fallback.
      releasePreviewResources(previewKey);
      releasedPreviewForCapacity = true;
      previewsEvictedForCapacity.add(previewKey);
      reservation = imageMemoryBudget.reserve(previewAdmission.retainedBytes, { kind: 'preview-pending' });
    }
    if (!reservation) throw retainedImageLimitMessage();

    return await withImageMemoryReservation(imageMemoryBudget, reservation, async () => {
      const imageNode = !fillId ? findNode(state.document, nodeId, pageId)?.node : null;
      const outputFormat = imageNode?.type === 'image' ? imageNode.outputFormat ?? 'png' : 'png';
      const outputQuality = imageNode?.type === 'image' ? imageNode.outputQuality ?? 90 : 90;
      const result = await imageEngine.render(assetId, asset.sourceBytes, adjustments, transforms, {
        replaceKey: `preview:${previewKey}`, format: outputFormat, quality: outputQuality,
        queueGroup,
      });
      if (generation !== state.documentGeneration || state.renderVersion.get(previewKey) !== version) return false;
      if (result.width !== outputDimensions.width || result.height !== outputDimensions.height) {
        throw new Error('The local image preview dimensions did not match the verified source size.');
      }
      if (result.bytes.byteLength > previewAdmission.encodedByteLength) {
        throw retainedImageLimitMessage();
      }
      const retainedBytes = estimatePreviewMemoryBytes({ width: result.width, height: result.height, encodedByteLength: result.bytes.byteLength });
      const previewBlob = new Blob([result.bytes], { type: result.mimeType || 'image/png' });
      bitmap = await createImageBitmap(previewBlob);
      previewUrl = URL.createObjectURL(previewBlob);
      if (generation !== state.documentGeneration || state.renderVersion.get(previewKey) !== version) return false;
      releasePreviewResources(previewKey);
      imageMemoryBudget.commit(reservation, currentMemoryKey, { bytes: retainedBytes, kind: 'preview' });
      reservation = null;
      previewsEvictedForCapacity.delete(previewKey);
      state.previewUrls.set(previewKey, previewUrl);
      state.previews.set(previewKey, bitmap);
      state.previewAssetIds.set(previewKey, assetId);
      state.previewVersions.set(previewKey, (state.previewVersions.get(previewKey) || 0) + 1);
      previewUrl = null;
      bitmap = null;
      state.imageStatus.set(previewKey, 'Updated · Pillow-RS WASM');
      renderer.invalidate(); if (!fillId) updateImageAssetThumbnail(nodeId);
      updateSelectedImageStatus(nodeId, previewKey, fillId);
      return true;
    });
  } catch (error) {
    if (generation !== state.documentGeneration || state.renderVersion.get(previewKey) !== version) return false;
    if ((releasedPreviewForCapacity || previewsEvictedForCapacity.has(previewKey)) && !state.previews.has(previewKey)) {
      error = markImagePreviewFallbackShown(error);
      state.imageStatus.set(previewKey, imagePreviewFailureStatus(error));
      renderer?.invalidate();
      if (!fillId) updateImageAssetThumbnail(nodeId);
      updateSelectedImageStatus(nodeId, previewKey, fillId);
    }
    throw error;
  } finally {
    try { bitmap?.close?.(); } catch { /* browser bitmap disposal is best-effort */ }
    try { if (previewUrl) URL.revokeObjectURL(previewUrl); } catch { /* URL may already be revoked */ }
  }
}

function reconcileImagePreviewRuntime() {
  const livePreviewKeys = collectLiveImagePreviewNodeIds(state.document);
  for (const previewKey of state.renderVersion.keys()) {
    if (!livePreviewKeys.has(previewKey)) imageEngine.cancelQueuedByKey(`preview:${previewKey}`);
  }
  const releasedKeys = new Set([...state.previews.keys(), ...state.previewUrls.keys()].filter(key => !livePreviewKeys.has(key)));
  const released = pruneImagePreviewRuntime({
    liveNodeIds: livePreviewKeys,
    timers: previewTimers,
    previews: state.previews,
    previewUrls: state.previewUrls,
    previewAssetIds: state.previewAssetIds,
    previewVersions: state.previewVersions,
    imageStatus: state.imageStatus,
    renderVersion: state.renderVersion,
  });
  for (const previewKey of releasedKeys) imageMemoryBudget.release(previewMemoryKey(previewKey));
  for (const previewKey of previewsEvictedForCapacity) if (!livePreviewKeys.has(previewKey)) previewsEvictedForCapacity.delete(previewKey);
  return released;
}

function reconcileImageAssetRuntime() {
  const snapshots = [
    state.document,
    ...history.undoStack.map(step => step.document),
    ...history.redoStack.map(step => step.document),
  ];
  return pruneImageAssetRuntime({
    liveAssetIds: collectLiveImageAssetIds(snapshots, state.clipboard?.items?.map(item => item.node) || []),
    assets: state.assets,
    disposeSource: assetId => imageEngine.dispose(assetId),
    releaseMemory: assetId => imageMemoryBudget.release(assetMemoryKey(assetId)),
  });
}

function setZoomButtonHandlers() {
  $('#zoom-in').addEventListener('click', () => zoomAt(null, null, state.zoom * 1.2));
  $('#zoom-out').addEventListener('click', () => zoomAt(null, null, state.zoom / 1.2));
  $('#zoom-readout').addEventListener('click', () => zoomAt(null, null, 1));
  $('#zoom-fit').addEventListener('click', zoomToSelection);
  canvas.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) { zoomAt(event.clientX, event.clientY, state.zoom * Math.exp(-event.deltaY * .002)); }
    else { state.panX -= event.deltaX; state.panY -= event.deltaY; renderer.invalidate(); }
    event.preventDefault();
  }, { passive: false });
}

function chooseImageFiles() { $('#image-input').click(); }
function removeImageFromLibrary(assetId) {
  const entry = state.document.imageLibrary?.find(item => item.assetId === assetId);
  if (!entry || state.documentTransitioning) return false;
  checkpoint(`Remove ${entry.name} from image library`);
  if (!removeImageLibraryEntry(state.document, assetId)) return false;
  renderUI(); queueSave();
  showToast(`Removed “${entry.name}” from the image library. Placed images are unchanged.`);
  return true;
}

async function placeImageLibraryAsset(assetId) {
  if (state.documentTransitioning) throw new Error('Wait for the current design switch to finish before placing an image.');
  const entry = state.document.imageLibrary?.find(item => item.assetId === assetId);
  if (!entry) throw new Error('That source image is no longer in this design’s library.');
  const generation = state.documentGeneration;
  if (!state.assets.get(assetId)?.sourceBytes) {
    await restoreImageAssets(generation, { assetIds: [assetId] });
  }
  if (generation !== state.documentGeneration || state.documentTransitioning) return false;
  const asset = state.assets.get(assetId);
  if (!asset?.sourceBytes || !asset.bitmap) throw new Error(`The original image “${entry.name}” could not be restored. Reimport the source file and try again.`);
  const width = Math.max(1, asset.bitmap.width || asset.sourceWidth || entry.width);
  const height = Math.max(1, asset.bitmap.height || asset.sourceHeight || entry.height);
  const center = { x: (canvas.clientWidth / 2 - state.panX) / state.zoom, y: (canvas.clientHeight / 2 - state.panY) / state.zoom };
  const fileName = asset.name || entry.name;
  const node = createNode('image', {
    id: createId('image'), name: fileName.replace(/\.[^.]+$/, ''), fileName, assetId,
    width, height, sourceWidth: asset.sourceWidth || entry.width, sourceHeight: asset.sourceHeight || entry.height,
    x: center.x - width / 2, y: center.y - height / 2, fit: 'cover'
  });
  const parent = deepestContainerAt(center);
  checkpoint(`Place ${entry.name}`);
  localizeToParent(node, center.x, center.y, parent, { anchor: 'center' });
  state.imageStatus.set(node.id, 'Processing locally…');
  renderImagePreview(node.id, assetId, node.adjustments, node.transforms).catch(error => {
    state.imageStatus.set(node.id, imagePreviewFailureStatus(error));
    showToast(error.message || 'Could not render the image preview.');
  });
  setSelection([node.id]); queueSave(); renderer.invalidate();
  return true;
}

async function importImageFiles(files, point = null, { place = true, input = $('#image-input') } = {}) {
  if (state.documentTransitioning) {
    showToast('Wait for the current design switch to finish before importing images.');
    return;
  }
  const generation = state.documentGeneration;
  const inputs = [...files].filter(isImageImportCandidate);
  if (!inputs.length) { showToast(`Choose an image file to ${place ? 'place on the canvas' : 'add to the local image library'}.`); return; }
  state.pendingImageImports += 1;
  try {
  checkpoint(`${place ? 'Place' : 'Add'} ${inputs.length} image${inputs.length === 1 ? '' : 's'}${place ? '' : ' to image library'}`);
  const defaultWorld = point || { x: (canvas.clientWidth / 2 - state.panX) / state.zoom, y: (canvas.clientHeight / 2 - state.panY) / state.zoom };
  let imported = 0;
  let placedCount = 0;
  const memoryLimitedFiles = [];
  for (const [index, file] of inputs.entries()) {
    const fileName = typeof file.name === 'string' && file.name.trim()
      ? file.name
      : clipboardImageFilename(file.type, index + 1);
    const displayName = fileName.split(/[\\/]/u).at(-1)?.replace(/[\x00-\x1f\x7f]/gu, ' ').slice(0, 512).trim() || `Image ${index + 1}`;
    let assetId = null;
    let assetReservation = null;
    let decodeReservation = null;
    let bitmap = null;
    let bitmapUrl = null;
    let retainedAsset = false;
    let assetWriteAttempted = false;
    let placed = false;
    let retainedInLibrary = false;
    let pillowFallbackUsed = false;
    try {
      assetId = createId('asset');
      const headerBytes = new Uint8Array(await file.slice(0, IMAGE_HEADER_SCAN_BYTES).arrayBuffer());
      const sourceDimensions = assertSafeRasterDimensions(headerBytes);
      const fallbackDimensions = fallbackImageDimensions(sourceDimensions.width, sourceDimensions.height);
      const assetBytes = estimateAssetMemoryBytes({ sourceByteLength: file.size, bitmapWidth: fallbackDimensions.width, bitmapHeight: fallbackDimensions.height });
      assetReservation = imageMemoryBudget.reserve(assetBytes, { kind: 'asset-pending' });
      if (!assetReservation) throw retainedImageLimitMessage();
      decodeReservation = imageMemoryBudget.reserve(estimateBitmapBytes(sourceDimensions.width, sourceDimensions.height), { kind: 'decode-transient' });
      if (!decodeReservation) throw retainedImageLimitMessage();
      const sourceBytes = new Uint8Array(await file.arrayBuffer());
      const verifiedDimensions = assertSafeRasterDimensions(sourceBytes);
      assertImagePayloadMatchesPreflight({ expectedDimensions: sourceDimensions, expectedByteLength: file.size, actualDimensions: verifiedDimensions, actualByteLength: sourceBytes.byteLength });
      let fallback;
      if (requiresPillowFallback(sourceBytes)) {
        pillowFallbackUsed = true;
        try {
          fallback = await createPillowFallbackImage(() => imageEngine.render(assetId, sourceBytes, {}, {}));
        } catch (error) {
          if (error instanceof ImageMemoryLimitError) throw error;
          throw new Error(imageDecodeFailureMessage(sourceBytes, error));
        }
      } else fallback = await createFallbackImage(file);
      if (fallback.sourceWidth !== verifiedDimensions.width || fallback.sourceHeight !== verifiedDimensions.height) {
        fallback.bitmap.close?.();
        throw new Error('The locally decoded image orientation did not match its verified source dimensions.');
      }
      bitmap = fallback.bitmap;
      const { sourceWidth, sourceHeight } = fallback;
      imageMemoryBudget.releaseReservation(decodeReservation); decodeReservation = null;
      if (generation !== state.documentGeneration) { bitmap.close?.(); bitmap = null; imageMemoryBudget.releaseReservation(assetReservation); assetReservation = null; continue; }
      const width = bitmap.width; const height = bitmap.height;
      bitmapUrl = URL.createObjectURL(file);
      assetWriteAttempted = true;
      await persistActiveImageAsset(assetId, fileName, file.type, sourceBytes);
      if (generation !== state.documentGeneration) { bitmap.close?.(); bitmap = null; URL.revokeObjectURL(bitmapUrl); bitmapUrl = null; imageMemoryBudget.releaseReservation(assetReservation); assetReservation = null; continue; }
      imageMemoryBudget.commit(assetReservation, assetMemoryKey(assetId), { bytes: assetBytes, kind: 'asset' });
      assetReservation = null;
      retainedAsset = true;
      state.assets.set(assetId, { id: assetId, name: displayName, type: file.type, sourceBytes, bitmap, bitmapUrl, sourceWidth, sourceHeight });
      bitmap = null; bitmapUrl = null;
      addImageLibraryEntry(state.document, { assetId, name: displayName, type: file.type || '', width: sourceWidth, height: sourceHeight });
      retainedInLibrary = true;
      imported += 1;
      try { await persistImageLibraryThumbnail(assetId, state.assets.get(assetId)?.bitmap, generation); }
      catch (error) { console.warn('Could not create a compact local image thumbnail.', error); }
      if (place) {
        const node = createNode('image', { id: createId('image'), name: fileName.replace(/\.[^.]+$/, ''), fileName, assetId, width, height, sourceWidth, sourceHeight, x: defaultWorld.x - width / 2 + index * 24, y: defaultWorld.y - height / 2 + index * 24, fit: 'cover' });
        const center = { x: node.x + width / 2, y: node.y + height / 2 };
        const parent = deepestContainerAt(center);
        localizeToParent(node, center.x, center.y, parent, { anchor: 'center' });
        placed = true;
        placedCount += 1;
        state.imageStatus.set(node.id, 'Processing locally…');
        renderImagePreview(node.id, assetId, node.adjustments, node.transforms).catch(error => { state.imageStatus.set(node.id, imagePreviewFailureStatus(error)); showToast(error.message); });
        state.selectedIds = [node.id];
      }
    } catch (error) {
      if (decodeReservation) imageMemoryBudget.releaseReservation(decodeReservation);
      if (assetReservation) imageMemoryBudget.releaseReservation(assetReservation);
      bitmap?.close?.();
      if (bitmapUrl) URL.revokeObjectURL(bitmapUrl);
      if (retainedAsset && !placed && !retainedInLibrary && assetId) {
        const retained = state.assets.get(assetId);
        retained?.bitmap?.close?.();
        if (retained?.bitmapUrl) URL.revokeObjectURL(retained.bitmapUrl);
        if (!retained) { bitmap?.close?.(); if (bitmapUrl) URL.revokeObjectURL(bitmapUrl); }
        state.assets.delete(assetId);
        imageMemoryBudget.release(assetMemoryKey(assetId));
      }
      if (error instanceof ImageMemoryLimitError) memoryLimitedFiles.push(fileName);
      else showToast(`${fileName}: ${error.message || 'Could not load image.'}`);
    } finally {
      if (assetWriteAttempted && !placed && !retainedInLibrary && assetId) {
        try {
          if (state.workspace) await deleteWorkspaceImageAsset(state.workspace, state.document.id, assetId);
          else await deleteImageAsset(assetId);
        } catch (error) { showToast(`${fileName}: the failed import could not be removed from local storage (${error.message || 'storage error'}).`); }
      }
      if (pillowFallbackUsed && !placed && !retainedInLibrary && assetId) imageEngine.dispose(assetId);
    }
  }
  if (imported) { renderUI(); queueSave(); }
  if (memoryLimitedFiles.length) {
    const examples = memoryLimitedFiles.slice(0, 3).join(', ');
    const more = memoryLimitedFiles.length > 3 ? `, and ${memoryLimitedFiles.length - 3} more` : '';
    showToast(`${place ? `${placedCount} placed` : `${imported} added to the image library`} · ${memoryLimitedFiles.length} skipped at the local memory limit: ${examples}${more}.`);
  } else if (imported) {
    if (place && placedCount === imported) showToast(`${placedCount} image${placedCount === 1 ? '' : 's'} placed. Source images stay in this design’s library.`);
    else if (place) showToast(`${imported} source image${imported === 1 ? '' : 's'} added to the library · ${placedCount} placed.`);
    else showToast(`${imported} image${imported === 1 ? '' : 's'} added to this design’s library.`);
  }
  } finally {
    state.pendingImageImports -= 1;
    input.value = '';
  }
}

async function restoreImageAssets(generation = state.documentGeneration, { assetIds = [] } = {}) {
  const references = scopeImageAssetReferences(imageAssetReferencesAcrossPages(), assetIds);
  const requestedLibraryAssets = new Set(assetIds);
  for (const entry of state.document.imageLibrary || []) {
    if (!requestedLibraryAssets.has(entry.assetId)) continue;
    references.push({
      node: { id: `image-library:${entry.assetId}` },
      previewKey: `image-library:${entry.assetId}`,
      assetId: entry.assetId,
      name: entry.name,
      librarySource: true
    });
  }
  const unavailableAssetIds = new Set();
  let memoryLimitedCount = 0;
  for (const reference of references) {
    if (generation !== state.documentGeneration) return;
    const { node, fillId = null, previewKey = imagePreviewKey(node.id), assetId, name, adjustments, transforms, librarySource = false } = reference;
    if (unavailableAssetIds.has(assetId)) { state.imageStatus.set(previewKey, 'Local image memory limit reached'); continue; }
    const reservations = { assetReservation: null, decodeReservation: null };
    let bitmap = null;
    let bitmapUrl = null;
    let retainedAsset = false;
    let pillowFallbackUsed = false;
    try {
      const existing = state.assets.get(assetId);
      if (existing?.sourceBytes) {
        if (!librarySource) renderImagePreview(node.id, assetId, adjustments, transforms, fillId).catch(error => {
            setImagePreviewFailureStatus(state.imageStatus, previewKey, error);
            updateSelectedImageStatus(node.id, previewKey, fillId);
            showToast(error.message || 'Could not restore the image preview.');
          });
        continue;
      }
      const metadata = await loadActiveImageAssetMetadata(assetId);
      if (generation !== state.documentGeneration) return;
      if (!metadata) { state.imageStatus.set(previewKey, 'Original image missing'); continue; }
      const sourceDimensions = metadata.dimensions;
      if (!sourceDimensions || !Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < 1
        || !Number.isSafeInteger(sourceDimensions.width) || sourceDimensions.width < 1
        || !Number.isSafeInteger(sourceDimensions.height) || sourceDimensions.height < 1
        || sourceDimensions.pixels !== sourceDimensions.width * sourceDimensions.height
        || sourceDimensions.pixels > MAX_IMAGE_SOURCE_PIXELS) {
        throw new Error('Tiny Image Star cannot safely restore this saved image. Reimport the original source file.');
      }
      const fallbackDimensions = fallbackImageDimensions(sourceDimensions.width, sourceDimensions.height);
      const assetBytes = estimateAssetMemoryBytes({ sourceByteLength: metadata.byteLength, bitmapWidth: fallbackDimensions.width, bitmapHeight: fallbackDimensions.height });
      reservations.assetReservation = imageMemoryBudget.reserve(assetBytes, { kind: 'asset-pending' });
      if (!reservations.assetReservation) throw retainedImageLimitMessage();
      reservations.decodeReservation = imageMemoryBudget.reserve(estimateBitmapBytes(sourceDimensions.width, sourceDimensions.height), { kind: 'decode-transient' });
      if (!reservations.decodeReservation) throw retainedImageLimitMessage();
      const saved = await loadActiveImageAsset(assetId);
      if (generation !== state.documentGeneration) { releaseImageMemoryReservations(imageMemoryBudget, reservations); return; }
      if (!saved) { releaseImageMemoryReservations(imageMemoryBudget, reservations); state.imageStatus.set(previewKey, 'Original image missing'); continue; }
      const sourceBytes = saved.bytes instanceof Uint8Array ? saved.bytes : new Uint8Array(saved.bytes);
      const actualDimensions = assertSafeRasterDimensions(sourceBytes);
      assertImagePayloadMatchesPreflight({
        expectedDimensions: sourceDimensions,
        expectedByteLength: metadata.byteLength,
        actualDimensions,
        actualByteLength: sourceBytes.byteLength
      });
      let fallback;
      if (requiresPillowFallback(sourceBytes)) {
        pillowFallbackUsed = true;
        try {
          fallback = await createPillowFallbackImage(() => imageEngine.render(assetId, sourceBytes, {}, {}));
        } catch (error) {
          if (error instanceof ImageMemoryLimitError) throw error;
          throw new Error(imageDecodeFailureMessage(sourceBytes, error));
        }
      } else fallback = await createFallbackImage(new Blob([sourceBytes], { type: saved.type || 'image/png' }));
      if (fallback.sourceWidth !== actualDimensions.width || fallback.sourceHeight !== actualDimensions.height) {
        fallback.bitmap.close?.();
        throw new Error('The locally decoded image orientation did not match its verified source dimensions.');
      }
      bitmap = fallback.bitmap;
      imageMemoryBudget.releaseReservation(reservations.decodeReservation);
      reservations.decodeReservation = null;
      if (generation !== state.documentGeneration) {
        bitmap.close?.(); bitmap = null; releaseImageMemoryReservations(imageMemoryBudget, reservations);
        if (pillowFallbackUsed) imageEngine.dispose(assetId);
        return;
      }
      bitmapUrl = URL.createObjectURL(new Blob([sourceBytes], { type: saved.type || 'image/png' }));
      imageMemoryBudget.commit(reservations.assetReservation, assetMemoryKey(assetId), { bytes: assetBytes, kind: 'asset' });
      reservations.assetReservation = null;
      retainedAsset = true;
      state.assets.set(assetId, { id: assetId, name: saved.name || name, type: saved.type, sourceBytes, bitmap, bitmapUrl, sourceWidth: actualDimensions.width, sourceHeight: actualDimensions.height });
      bitmap = null; bitmapUrl = null;
      if (!librarySource) {
        state.imageStatus.set(previewKey, 'Restoring local preview…');
        renderImagePreview(node.id, assetId, adjustments, transforms, fillId).catch(error => { state.imageStatus.set(previewKey, imagePreviewFailureStatus(error)); showToast(error.message); });
      }
    } catch (error) {
      releaseImageMemoryReservations(imageMemoryBudget, reservations);
      if (pillowFallbackUsed && !retainedAsset) imageEngine.dispose(assetId);
      bitmap?.close?.(); if (bitmapUrl) URL.revokeObjectURL(bitmapUrl);
      if (retainedAsset) {
        const retained = state.assets.get(assetId);
        retained?.bitmap?.close?.(); if (retained?.bitmapUrl) URL.revokeObjectURL(retained.bitmapUrl);
        state.assets.delete(assetId); imageMemoryBudget.release(assetMemoryKey(assetId));
      }
      if (generation !== state.documentGeneration) return;
      state.imageStatus.set(previewKey, error instanceof ImageMemoryLimitError ? 'Local image memory limit reached' : 'Could not restore image');
      if (error instanceof ImageMemoryLimitError) { unavailableAssetIds.add(assetId); memoryLimitedCount += 1; }
      else showToast(error.message);
    }
  }
  if (memoryLimitedCount && generation === state.documentGeneration) showToast(`${memoryLimitedCount} saved image${memoryLimitedCount === 1 ? '' : 's'} could not be restored because this design reached the local memory limit.`);
  if (generation === state.documentGeneration) renderAssetsTab();
}

function syncBulkBarTicker() {
  if (state.bulk && !state.bulk.done) {
    if (!bulkBarTicker) bulkBarTicker = window.setInterval(renderBulkBar, 500);
    return;
  }
  if (bulkBarTicker) window.clearInterval(bulkBarTicker);
  bulkBarTicker = null;
}

function stopRecipeBatchLeaseHeartbeat(bulk) {
  if (!bulk?.leaseTimer) return false;
  window.clearTimeout(bulk.leaseTimer);
  bulk.leaseTimer = 0;
  return true;
}

function loseRecipeBatchLease(bulk, error) {
  if (!bulk || state.bulk !== bulk || bulk.ownershipLost) return false;
  stopRecipeBatchLeaseHeartbeat(bulk);
  bulk.ownershipLost = true;
  bulk.leaseError = error?.message || 'This tab no longer owns the recovery record.';
  setDocumentEditingBlocked(true);
  if (cancelImageRecipeBatch(bulk)) {
    for (const id of bulk.targets.slice(0, bulk.next)) {
      const recipeVersion = bulk.renderVersions.get(id);
      if (recipeVersion == null || recipeVersion !== state.renderVersion.get(id)) continue;
      imageEngine.cancelQueuedByKey(`preview:${imagePreviewKey(id)}`);
    }
    imageEngine.resumeQueueGroup(bulk.queueGroup);
    if (bulk.done) restoreImageRecipeBatchConcurrency(bulk);
  }
  showToast('This tab lost its recipe recovery lease. New work has stopped; reload after the other tab finishes to continue safely.', 8000);
  renderBulkBar();
  return true;
}

function scheduleRecipeBatchLeaseHeartbeat(bulk) {
  stopRecipeBatchLeaseHeartbeat(bulk);
  if (!bulk || state.bulk !== bulk || bulk.ownershipLost) return false;
  bulk.leaseTimer = window.setTimeout(async () => {
    bulk.leaseTimer = 0;
    if (state.bulk !== bulk || bulk.ownershipLost) return;
    try {
      const renewed = await saveRecipeBatchRecovery({
        documentId: state.document.id,
        ownerToken: bulk.ownerToken,
        recipe: bulk.recipe,
        pageId: bulk.pageId,
        targetIds: bulk.targets,
        status: bulk.cancelled ? 'cancelled' : 'running'
      });
      if (state.bulk !== bulk || bulk.ownershipLost) return;
      bulk.leaseExpiresAt = renewed.leaseExpiresAt;
      scheduleRecipeBatchLeaseHeartbeat(bulk);
    } catch (error) {
      loseRecipeBatchLease(bulk, error);
    }
  }, RECIPE_BATCH_LEASE_RENEW_MS);
  return true;
}

function scheduleBulkConcurrency(bulk, immediate = false) {
  if (bulkConcurrencyTimer) window.clearTimeout(bulkConcurrencyTimer);
  bulkConcurrencyTimer = 0;
  const apply = () => {
    bulkConcurrencyTimer = 0;
    if (state.bulk !== bulk || bulk.done || bulk.cancelled) return;
    imageEngine.setConcurrency(bulk.concurrency);
    renderBulkBar();
  };
  if (immediate) apply();
  else bulkConcurrencyTimer = window.setTimeout(apply, 100);
}

async function recipeRecoveryForDocument(documentId) {
  try {
    let recovery = await loadRecipeBatchRecovery(documentId);
    if (recovery?.status === 'complete' && recovery.leaseExpiresAt <= Date.now()) {
      const ownerToken = createId('recipe-run');
      try {
        await claimRecipeBatchRecovery({ ...recovery, ownerToken }, { expectedOwnerToken: recovery.ownerToken });
        await deleteRecipeBatchRecovery(documentId, ownerToken);
        return null;
      } catch (error) {
        if (!(error instanceof RecipeBatchRecoveryLeaseError)) throw error;
        recovery = await loadRecipeBatchRecovery(documentId);
      }
    }
    return recovery;
  } catch (error) {
    console.warn('Could not check for an interrupted image recipe', error);
    showToast('Could not check this design for an interrupted image recipe. Your saved image edits are unchanged.');
    return null;
  }
}

function renderRecipeRecoveryPrompt(recovery = state.pendingRecipeRecovery) {
  const dialog = $('#recipe-recovery-dialog');
  if (!recovery) {
    if (recipeRecoveryExpiryTimer) window.clearTimeout(recipeRecoveryExpiryTimer);
    recipeRecoveryExpiryTimer = 0;
    if (dialog.open) dialog.close();
    return;
  }
  const leaseActive = Number.isFinite(recovery.leaseExpiresAt) && recovery.leaseExpiresAt > Date.now();
  const keepButton = $('#recipe-recovery-keep');
  const resumeButton = $('#recipe-recovery-resume');
  $('#recipe-recovery-recipe').textContent = recovery.recipe.name || 'Image recipe';
  $('#recipe-recovery-copy').textContent = leaseActive
    ? `Another tab still owns this ${recovery.recipe.name || 'image recipe'} batch. Keep and resume will unlock after its lease expires; saved work remains safe.`
    : `${recovery.targetIds.length} image layer${recovery.targetIds.length === 1 ? '' : 's'} were in this batch. Resume the saved recipe, or keep the image edits that were already saved.`;
  keepButton.disabled = leaseActive;
  resumeButton.disabled = leaseActive;
  if (!dialog.open) {
    $('#recipe-recovery-status').textContent = '';
    setDocumentEditingBlocked(true);
    dialog.showModal();
  }
  if (recipeRecoveryExpiryTimer) window.clearTimeout(recipeRecoveryExpiryTimer);
  recipeRecoveryExpiryTimer = leaseActive
    ? window.setTimeout(async () => {
      recipeRecoveryExpiryTimer = 0;
      if (state.pendingRecipeRecovery !== recovery) return;
      const current = await loadRecipeBatchRecovery(recovery.documentId).catch(() => recovery);
      if (state.pendingRecipeRecovery !== recovery) return;
      state.pendingRecipeRecovery = current;
      if (!current) setDocumentEditingBlocked(false);
      renderRecipeRecoveryPrompt(current);
    }, Math.min(0x7fffffff, Math.max(100, recovery.leaseExpiresAt - Date.now() + 100)))
    : 0;
}

async function keepInterruptedRecipeChanges() {
  const recovery = state.pendingRecipeRecovery;
  if (!recovery) return false;
  const keepButton = $('#recipe-recovery-keep'); const resumeButton = $('#recipe-recovery-resume');
  keepButton.disabled = true; resumeButton.disabled = true;
  $('#recipe-recovery-status').textContent = 'Keeping the saved image edits…';
  try {
    const ownerToken = createId('recipe-run');
    await claimRecipeBatchRecovery({ ...recovery, ownerToken }, { expectedOwnerToken: recovery.ownerToken });
    await deleteRecipeBatchRecovery(recovery.documentId, ownerToken);
    state.pendingRecipeRecovery = null;
    $('#recipe-recovery-dialog').close();
    setDocumentEditingBlocked(false);
    return true;
  } catch (error) {
    $('#recipe-recovery-status').textContent = error.message || 'Could not clear the recovery record. Your saved edits are unchanged; try again.';
    const leaseActive = error instanceof RecipeBatchRecoveryLeaseError && error.reason === 'active';
    keepButton.disabled = leaseActive;
    resumeButton.disabled = leaseActive;
    if (leaseActive) {
      state.pendingRecipeRecovery = await loadRecipeBatchRecovery(recovery.documentId).catch(() => recovery);
      renderRecipeRecoveryPrompt();
    }
    return false;
  }
}

function resumeInterruptedRecipe() {
  const recovery = state.pendingRecipeRecovery;
  if (!recovery) return false;
  if (recovery.leaseExpiresAt > Date.now()) {
    renderRecipeRecoveryPrompt(recovery);
    return false;
  }
  const started = startRecipe(structuredClone(recovery.recipe), recovery.targetIds, {
    concurrency: Math.min(2, CPU_LIMIT), pageId: recovery.pageId, recoveryOnFailure: recovery,
    expectedRecoveryOwnerToken: recovery.ownerToken
  });
  if (!started) return false;
  state.pendingRecipeRecovery = null;
  $('#recipe-recovery-dialog').close();
  setDocumentEditingBlocked(false);
  return true;
}

function renderBulkBar() {
  const bar = $('#bulk-bar'); const bulk = state.bulk;
  bar.hidden = !bulk;
  const announcer = $('#bulk-announcer');
  if (!bulk) {
    if (announcer.textContent) announcer.textContent = '';
    syncBulkBarTicker();
    return;
  }
  const engineMetrics = imageEngine.metrics();
  const batchMetrics = imageEngine.queueGroupMetrics(bulk.queueGroup);
  const total = bulk.targets.length;
  const skipped = bulk.skipped || 0;
  const updated = Math.max(0, bulk.completed - bulk.failed - (bulk.superseded || 0) - (bulk.skippedLocked || 0) - skipped);
  const lockedSkipped = (bulk.excludedLocked || 0) + (bulk.skippedLocked || 0);
  const drained = canDismissImageRecipeBatch(bulk);
  const dismissible = drained && !bulk.savePending && !bulk.journalPending && !bulk.ownershipLost;
  const normalTitle = bulk.cancelled ? 'Recipe stopped' : bulk.done ? (bulk.failed ? 'Recipe finished with errors' : bulk.superseded ? 'Recipe applied · edits preserved' : lockedSkipped ? 'Recipe applied · locked images skipped' : skipped ? 'Recipe finished · unavailable images skipped' : 'Recipe applied') : bulk.paused ? 'Processing paused' : `Applying ${bulk.recipe.name}`;
  $('#bulk-title').textContent = bulk.ownershipLost ? 'Recipe lease lost · reload to recover' : bulk.recoveryError ? 'Saved · recovery cleanup pending' : bulk.saveError ? 'Recipe changes not saved' : bulk.savePending && bulk.done ? 'Saving recipe changes…' : bulk.paused ? 'Processing paused' : bulk.journalPending && !bulk.done ? `Preparing ${bulk.recipe.name}…` : normalTitle;
  const announcement = imageRecipeBatchAnnouncement(bulk);
  if (announcer.textContent !== announcement) announcer.textContent = announcement;
  $('#bulk-subtitle').textContent = bulk.ownershipLost
    ? 'Another tab owns this batch now. This tab stopped processing and will not write more recipe changes; reload after the other tab finishes.'
    : bulk.saveError
    ? bulk.recoveryError ? 'The image edits are saved, but the recovery marker could not be cleared. Retry to finish safely.' : drained ? 'The edits remain in this tab. Retry the local save before closing this bar.' : 'A local save failed. The batch will drain before retry is offered.'
    : bulk.journalPending && !bulk.done
      ? 'Saving a recovery point before any image is changed…'
    : bulk.savePending && bulk.done
      ? 'Writing the completed recipe state to this device…'
      : bulk.cancelled
    ? `${updated} updated · ${bulk.targets.length - bulk.completed} left untouched${bulk.failed ? ` · ${bulk.failed} failed` : ''}${lockedSkipped ? ` · ${lockedSkipped} locked skipped` : ''}${skipped ? ` · ${skipped} removed or unavailable skipped` : ''}`
    : bulk.done
      ? `${updated} updated in place${bulk.failed ? ` · ${bulk.failed} failed` : ''}${bulk.superseded ? ` · ${bulk.superseded} newer edits preserved` : ''}${lockedSkipped ? ` · ${lockedSkipped} locked skipped` : ''}${skipped ? ` · ${skipped} removed or unavailable skipped` : ''}`
      : bulk.paused
        ? `Queue held · ${bulk.inflight} admitted image${bulk.inflight === 1 ? '' : 's'} may still be finishing`
        : `Editing original layers · ${bulk.inflight} queued or processing`;
  $('#bulk-progress-fill').style.width = `${total ? Math.min(100, (bulk.completed / total) * 100) : 0}%`;
  $('#bulk-progress-label').textContent = `${bulk.completed} / ${total}`;
  $('#bulk-rate').textContent = formatImageRecipeBatchTiming(bulk);
  const timing = imageRecipeBatchTiming(bulk);
  $('#bulk-rate').title = `Average batch throughput. Paused time and paused completions are excluded.${timing.etaSeconds === null ? '' : ` Estimated ${Math.ceil(timing.etaSeconds)} seconds of active batch time remain.`}`;
  $('#bulk-speed').value = bulk.concurrency;
  const speedValue = $('#bulk-speed-value');
  speedValue.textContent = `${bulk.concurrency} worker${bulk.concurrency === 1 ? '' : 's'}`;
  speedValue.dataset.activeWorkers = String(engineMetrics.active);
  speedValue.dataset.workersReady = String(engineMetrics.workersReady);
  speedValue.setAttribute('aria-label', `${bulk.concurrency} maximum workers; ${engineMetrics.active} active; ${engineMetrics.workersReady} ready`);
  speedValue.title = `Engine limit: ${engineMetrics.concurrency} worker${engineMetrics.concurrency === 1 ? '' : 's'} configured. Batch cap: ${bulk.concurrency} worker${bulk.concurrency === 1 ? '' : 's'}; ${batchMetrics.active} active and ${batchMetrics.queued} queued in this batch; ${engineMetrics.active} total active jobs. Estimated shared WASM working set: ${Math.round(engineMetrics.activeRenderBytes / 1048576)} of ${Math.round(engineMetrics.maxActiveRenderBytes / 1048576)} MiB; memory admission can lower actual parallelism.`;
  $('#bulk-spinner').classList.toggle('is-done', bulk.done || bulk.cancelled);
  $('#bulk-spinner').classList.toggle('is-paused', bulk.paused);
  $('#bulk-pause').hidden = bulk.done || bulk.cancelled;
  $('#bulk-pause').textContent = bulk.paused ? 'Resume' : 'Pause';
  $('#bulk-cancel').hidden = bulk.done || bulk.cancelled;
  $('#bulk-cancel').disabled = Boolean(bulk.journalPending);
  $('#bulk-speed').disabled = bulk.done || bulk.cancelled || Boolean(bulk.journalPending);
  $('#bulk-retry').hidden = !dismissible || !bulk.failedTargets?.length;
  $('#bulk-retry').textContent = `Retry failed${bulk.failedTargets?.length ? ` (${bulk.failedTargets.length})` : ''}`;
  $('#bulk-done').hidden = !drained || bulk.savePending || bulk.journalPending || bulk.ownershipLost;
  $('#bulk-done').disabled = false;
  $('#bulk-done').textContent = bulk.recoveryError ? 'Retry cleanup' : bulk.saveError ? 'Retry save' : 'Done';
  syncBulkBarTicker();
}

function snapshotRecipeField(object, key) {
  const present = Object.hasOwn(object, key);
  return { present, value: present ? structuredClone(object[key]) : undefined };
}

function snapshotRecipeState(node) {
  return {
    adjustments: { ...(node.adjustments || {}) },
    transforms: snapshotRecipeField(node, 'transforms'),
    fit: snapshotRecipeField(node, 'fit'),
    opacity: snapshotRecipeField(node, 'opacity'),
    opacityBinding: snapshotRecipeField(node.variableBindings || {}, 'opacity'),
    outputFormat: snapshotRecipeField(node, 'outputFormat'),
    outputQuality: snapshotRecipeField(node, 'outputQuality'),
    effects: snapshotRecipeField(node, 'effects'),
    blendMode: snapshotRecipeField(node, 'blendMode')
  };
}

function recipeFieldMatches(current, expected) {
  return current.present === expected.present
    && (!current.present || JSON.stringify(current.value) === JSON.stringify(expected.value));
}

function rollbackRecipeStateIfUnchanged(node, before, applied) {
  let changed = false;
  const changedProperties = new Set();
  const currentAdjustments = { ...(node.adjustments || {}) };
  const adjustmentKeys = new Set([
    ...Object.keys(before.adjustments),
    ...Object.keys(applied.adjustments),
    ...Object.keys(currentAdjustments)
  ]);
  for (const key of adjustmentKeys) {
    const stillApplied = Object.hasOwn(currentAdjustments, key) === Object.hasOwn(applied.adjustments, key)
      && (!Object.hasOwn(applied.adjustments, key) || Object.is(currentAdjustments[key], applied.adjustments[key]));
    if (!stillApplied) continue;
    if (Object.hasOwn(before.adjustments, key)) currentAdjustments[key] = before.adjustments[key];
    else delete currentAdjustments[key];
    changed = true;
    changedProperties.add('adjustments');
  }
  if (changed) node.adjustments = currentAdjustments;

  const currentTransforms = snapshotRecipeField(node, 'transforms');
  const recipeTransforms = applied.transforms;
  if (currentTransforms.present === recipeTransforms.present && currentTransforms.present
    && JSON.stringify(currentTransforms.value) === JSON.stringify(recipeTransforms.value)) {
    if (before.transforms.present) node.transforms = structuredClone(before.transforms.value);
    else delete node.transforms;
    changed = true;
    changedProperties.add('transforms');
  }

  for (const key of ['fit', 'opacity', 'outputFormat', 'outputQuality']) {
    const current = snapshotRecipeField(node, key);
    const recipeValue = applied[key];
    if (current.present !== recipeValue.present || (current.present && !Object.is(current.value, recipeValue.value))) continue;
    const previous = before[key];
    if (previous.present) node[key] = previous.value;
    else delete node[key];
    changed = true;
    changedProperties.add(key);
  }
  for (const key of ['effects', 'blendMode']) {
    const current = snapshotRecipeField(node, key);
    if (!recipeFieldMatches(current, applied[key])) continue;
    const previous = before[key];
    if (recipeFieldMatches(current, previous)) continue;
    if (previous.present) node[key] = structuredClone(previous.value);
    else delete node[key];
    changed = true;
    changedProperties.add(key);
  }
  const currentOpacityBinding = snapshotRecipeField(node.variableBindings || {}, 'opacity');
  if (recipeFieldMatches(currentOpacityBinding, applied.opacityBinding)
    && !recipeFieldMatches(currentOpacityBinding, before.opacityBinding)) {
    const variableBindings = { ...(node.variableBindings || {}) };
    if (before.opacityBinding.present) variableBindings.opacity = before.opacityBinding.value;
    else delete variableBindings.opacity;
    if (Object.keys(variableBindings).length) node.variableBindings = variableBindings;
    else delete node.variableBindings;
    changed = true;
    changedProperties.add('variableBindings');
  }
  if (changed) recordNodeComponentOverrides(node, [...changedProperties]);
  return changed;
}

function isEditableImageRecipeTarget(entry) {
  return entry?.node?.type === 'image'
    && !entry.node.locked
    && !(entry.parents || []).some(parent => parent.locked);
}

function scheduleBulk() {
  const bulk = state.bulk;
  if (!bulk || bulk.journalPending || bulk.paused || bulk.cancelled || bulk.done || bulk.ownershipLost) return;
  while (bulk.inflight < bulk.concurrency && bulk.next < bulk.targets.length) {
    const id = bulk.targets[bulk.next++];
    const entry = findNode(state.document, id, bulk.pageId);
    if (!entry || entry.node.type !== 'image') {
      recordImageRecipeBatchTarget(bulk, { skipped: true });
      continue;
    }
    if (!isEditableImageRecipeTarget(entry)) {
      bulk.skippedLocked += 1;
      recordImageRecipeBatchTarget(bulk);
      continue;
    }
    const node = entry.node; const before = snapshotRecipeState(node);
    const previousStatus = state.imageStatus.get(id);
    bulk.previousStatuses.set(id, previousStatus);
    const pendingPreview = previewTimers.get(id);
    if (pendingPreview) {
      clearTimeout(pendingPreview);
      previewTimers.delete(id);
    }
    if (pendingPreview || previousStatus === 'Updating preview…' || previousStatus === 'Processing locally…') {
      bulk.restorePreviews.add(id);
    }
    applyImageRecipe(state.document, id, bulk.recipe, bulk.pageId);
    const recipeOverrides = ['adjustments', 'transforms', 'fit', 'outputFormat', 'outputQuality'];
    if (Object.hasOwn(bulk.recipe, 'opacity') && bulk.recipe.opacity != null) recipeOverrides.push('opacity');
    if (bulk.recipe.effects != null) recipeOverrides.push('effects');
    if (bulk.recipe.blendMode != null) recipeOverrides.push('blendMode');
    const appliedOpacityBinding = snapshotRecipeField(node.variableBindings || {}, 'opacity');
    if (!recipeFieldMatches(before.opacityBinding, appliedOpacityBinding)) recipeOverrides.push('variableBindings');
    recordNodeComponentOverrides(node, recipeOverrides);
    // Persist in-place recipe state as soon as it is admitted. A slow first
    // render must not leave already-edited targets only in volatile memory.
    queueSave({ refreshLayerTree: false });
    const applied = snapshotRecipeState(node);
    bulk.inflight += 1; state.imageStatus.set(id, 'Processing recipe…');
    updateSelectedImageStatus(id);
    const previousRenderVersion = state.renderVersion.get(id);
    const preview = renderImagePreview(id, node.assetId, node.adjustments, node.transforms, null, bulk.queueGroup, bulk.pageId);
    const recipeRenderVersion = state.renderVersion.get(id);
    if (recipeRenderVersion !== previousRenderVersion) bulk.renderVersions.set(id, recipeRenderVersion);
    preview.then(rendered => {
      if (state.bulk !== bulk) return;
      if (bulk.ownershipLost) {
        rollbackRecipeStateIfUnchanged(node, before, applied);
        if (bulk.renderVersions.get(id) === state.renderVersion.get(id)) schedulePreview(node, true);
        recordImageRecipeBatchTarget(bulk, { canceled: true });
        return;
      }
      if (!rendered) {
        const error = new Error('A newer image edit replaced this recipe preview before it could be displayed.');
        error.name = 'AbortError';
        error.superseded = true;
        throw error;
      }
      recordImageRecipeBatchTarget(bulk);
    }).catch(error => {
      if (state.bulk !== bulk) return;
      if (bulk.ownershipLost) {
        rollbackRecipeStateIfUnchanged(node, before, applied);
        if (bulk.renderVersions.get(id) === state.renderVersion.get(id)) schedulePreview(node, true);
        recordImageRecipeBatchTarget(bulk, { canceled: true });
        return;
      }
      const wasCanceledBeforeRender = bulk.cancelled && error.name === 'AbortError' && !error.superseded;
      const renderStillCurrent = bulk.renderVersions.get(id) === state.renderVersion.get(id);
      const currentEntry = findNode(state.document, id, bulk.pageId);
      const targetRemovedOrChanged = !currentEntry || currentEntry.node.type !== 'image';
      const canRestoreBeforeState = renderStillCurrent && !error.superseded && !targetRemovedOrChanged;
      if (canRestoreBeforeState) rollbackRecipeStateIfUnchanged(node, before, applied);
      if (wasCanceledBeforeRender) {
        if (renderStillCurrent) {
          const previousStatus = bulk.previousStatuses.get(id);
          if (canRestoreBeforeState && bulk.restorePreviews.has(id)) {
            schedulePreview(node, true);
          } else {
            const stablePreviousStatus = previousStatus && !previousStatus.startsWith('Processing') && !previousStatus.startsWith('Updating preview')
              ? previousStatus
              : null;
            state.imageStatus.set(id, stablePreviousStatus || (state.previews.has(id) ? 'Updated · Pillow-RS WASM' : 'Ready · original image'));
            updateSelectedImageStatus(id);
          }
        }
        recordImageRecipeBatchTarget(bulk, { canceled: true });
        return;
      }
      if (targetRemovedOrChanged) {
        recordImageRecipeBatchTarget(bulk, { skipped: true });
        return;
      }
      const replacedByNewerEdit = !bulk.cancelled && error.name === 'AbortError' && !renderStillCurrent;
      if (error.superseded || replacedByNewerEdit) {
        // Keep recipe values beneath the user's newer edit and preserve its status.
        recordImageRecipeBatchTarget(bulk, { superseded: true });
      } else {
        if (canRestoreBeforeState && bulk.restorePreviews.has(id)) {
          schedulePreview(node, true);
        } else {
          state.imageStatus.set(id, error.previewFallbackShown ? 'Recipe failed · showing original' : 'Recipe failed');
          updateSelectedImageStatus(id);
        }
        recordImageRecipeBatchTarget(bulk, { failed: true, targetId: id });
        showToast(`${node.name}: ${error.message}`);
      }
    }).finally(() => {
      if (state.bulk !== bulk) return;
      bulk.inflight -= 1;
      if (!bulk.ownershipLost) queueSave({ refreshLayerTree: false });
      renderer.invalidate();
      if (!bulk.paused && !bulk.cancelled) scheduleBulk();
      completeImageRecipeBatchIfDrained(bulk);
      if (bulk.done) {
        bulk.paused = false;
        imageEngine.resumeQueueGroup(bulk.queueGroup);
        restoreImageRecipeBatchConcurrency(bulk);
      }
      renderBulkBar();
    });
  }
  completeImageRecipeBatchIfDrained(bulk);
  if (bulk.done) {
    bulk.paused = false;
    imageEngine.resumeQueueGroup(bulk.queueGroup);
    restoreImageRecipeBatchConcurrency(bulk);
  }
  renderBulkBar();
}

function restoreImageRecipeBatchConcurrency(bulk) {
  if (!bulk || bulk.concurrencyRestored || !Number.isSafeInteger(bulk.previousEngineConcurrency)) return false;
  bulk.concurrencyRestored = true;
  if (bulkConcurrencyTimer) window.clearTimeout(bulkConcurrencyTimer);
  bulkConcurrencyTimer = 0;
  imageEngine.releaseQueueGroup(bulk.queueGroup);
  imageEngine.setConcurrency(bulk.previousEngineConcurrency);
  renderInspector();
  return true;
}

function startRecipe(recipe, targets, { concurrency = Math.min(2, CPU_LIMIT), pageId = state.document.activePageId, replaceCompletedBatch = false, recoveryOnFailure = null, expectedRecoveryOwnerToken = recoveryOnFailure?.ownerToken ?? null } = {}) {
  if (state.interaction || state.imageCropMode) {
    showToast('Finish the current canvas edit before starting an image recipe batch.');
    return false;
  }
  if (isImageRecipeBatchActive(state.bulk)) {
    showToast('The current recipe batch is active and will keep processing. Finish or stop it before starting another.');
    renderBulkBar();
    return false;
  }
  if (state.bulk && (!replaceCompletedBatch || !canDismissImageRecipeBatch(state.bulk) || state.bulk.savePending || state.bulk.journalPending)) {
    showToast('Finish the current recipe result before starting another image recipe batch.');
    return false;
  }
  const entries = [...new Set(targets)].map(id => ({ id, entry: findNode(state.document, id, pageId) }))
    .filter(item => item.entry?.node.type === 'image');
  const lockedCount = entries.filter(item => !isEditableImageRecipeTarget(item.entry)).length;
  const unique = entries.filter(item => isEditableImageRecipeTarget(item.entry)).map(item => item.id);
  if (!unique.length) { showToast('Select one or more unlocked image layers first.'); return false; }
  if (lockedCount) showToast(`${lockedCount} locked image${lockedCount === 1 ? '' : 's'} skipped.`);
  const ownerToken = createId('recipe-run');
  checkpoint(`Apply ${recipe.name} to ${unique.length} image${unique.length === 1 ? '' : 's'}`);
  const replacedBulk = replaceCompletedBatch ? state.bulk : null;
  state.bulk = {
    recipe: structuredClone(recipe), pageId, targets: unique, ownerToken, leaseExpiresAt: 0, leaseTimer: 0, ownershipLost: false, queueGroup: createId('recipe-batch'), next: 0, completed: 0, failed: 0, superseded: 0, skipped: 0, excludedLocked: lockedCount, skippedLocked: 0, inflight: 0, concurrency,
    previousEngineConcurrency: imageEngine.concurrency, concurrencyRestored: false,
    paused: false, cancelled: false, done: false, journalPending: true, savePending: false, saveError: null,
    previousStatuses: new Map(), renderVersions: new Map(), restorePreviews: new Set(), failedTargets: [],
    recoveryOnFailure: recoveryOnFailure ? structuredClone(recoveryOnFailure) : null
  };
  const bulk = state.bulk;
  startImageRecipeBatchClock(bulk);
  renderInspector();
  renderBulkBar();
  const claimOptions = {};
  if (recoveryOnFailure) claimOptions.expectedOwnerToken = expectedRecoveryOwnerToken;
  else if (replacedBulk) claimOptions.replaceOwnerToken = replacedBulk.ownerToken;
  void claimRecipeBatchRecovery({
    documentId: state.document.id,
    ownerToken,
    recipe: bulk.recipe,
    pageId: bulk.pageId,
    targetIds: bulk.targets,
    status: 'running'
  }, claimOptions).then(claimed => {
    if (state.bulk !== bulk) return;
    bulk.leaseExpiresAt = claimed.leaseExpiresAt;
    bulk.journalPending = false;
    scheduleRecipeBatchLeaseHeartbeat(bulk);
    imageEngine.setConcurrency(bulk.concurrency);
    renderBulkBar(); scheduleBulk();
  }).catch(async error => {
    if (state.bulk !== bulk) return;
    state.bulk = replacedBulk;
    restoreImageRecipeBatchConcurrency(bulk);
    renderBulkBar(); renderInspector();
    if (bulk.recoveryOnFailure && state.document.id === bulk.recoveryOnFailure.documentId) {
      state.pendingRecipeRecovery = await loadRecipeBatchRecovery(bulk.recoveryOnFailure.documentId).catch(() => null)
        || bulk.recoveryOnFailure;
      renderRecipeRecoveryPrompt();
    } else if (error instanceof RecipeBatchRecoveryLeaseError && error.reason === 'active') {
      showToast('This design already has an image recipe batch running in another tab. Wait for it to finish before starting another.', 8000);
    } else if (error instanceof RecipeBatchRecoveryLeaseError && error.reason === 'stale') {
      showToast('An interrupted image recipe needs to be resolved before another batch can start. Reload this design to recover it.', 8000);
    }
    if (!(error instanceof RecipeBatchRecoveryLeaseError)) {
      showToast(`The recipe was not started because its recovery point could not be saved: ${error.message || 'Local storage failed.'}`);
    }
  });
  return true;
}

function cancelBulkRecipe() {
  const bulk = state.bulk;
  if (!cancelImageRecipeBatch(bulk)) return false;
  for (const id of bulk.targets.slice(0, bulk.next)) {
    const recipeVersion = bulk.renderVersions.get(id);
    if (recipeVersion == null || recipeVersion !== state.renderVersion.get(id)) continue;
    imageEngine.cancelQueuedByKey(`preview:${imagePreviewKey(id)}`);
  }
  imageEngine.resumeQueueGroup(bulk.queueGroup);
  if (bulk.done) restoreImageRecipeBatchConcurrency(bulk);
  renderBulkBar();
  return true;
}

function retryFailedRecipeTargets() {
  const previous = state.bulk;
  if (!canDismissImageRecipeBatch(previous) || !previous.failedTargets?.length) return false;
  return startRecipe(structuredClone(previous.recipe), [...new Set(previous.failedTargets)], { concurrency: previous.concurrency, pageId: previous.pageId, replaceCompletedBatch: true });
}

function saveRecipeFor(nodeId) {
  const node = findNode(state.document, nodeId)?.node;
  if (!node || node.type !== 'image') return;
  pendingRecipeNodeId = nodeId;
  const adjustments = node.adjustments || {};
  const active = ['exposure', 'temperature', 'tint', 'brightness', 'contrast', 'highlights', 'shadows', 'saturation', 'sharpness', 'blur'].filter(key => Number(adjustments[key] || 0) !== 0)
    .map(key => `${key[0].toUpperCase()}${key.slice(1)} ${adjustments[key]}`);
  if (adjustments.autoContrast) active.push('Auto contrast');
  if (Number(adjustments.posterizeBits) > 0) active.push(`Posterize ${adjustments.posterizeBits} bit`);
  if (adjustments.solarize) active.push(`Solarize at ${adjustments.solarizeThreshold}`);
  if (adjustments.invert) active.push('Invert');
  const transforms = createImageTransforms(node.transforms || {});
  if (transforms.crop) active.push(`Crop ${Math.round(transforms.crop.left * 100)}%/${Math.round(transforms.crop.top * 100)}% to ${Math.round(transforms.crop.right * 100)}%/${Math.round(transforms.crop.bottom * 100)}%`);
  if (transforms.rotation) active.push(`Rotate ${transforms.rotation}°`);
  if (transforms.flipHorizontal) active.push('Flip horizontal');
  if (transforms.flipVertical) active.push('Flip vertical');
  $('#recipe-name').value = `${node.name} look`;
  $('#recipe-preview-summary').dataset.editSummary = active.length ? active.join(' · ') : 'Original image look · No adjustments';
  $('#recipe-format').value = node.outputFormat ?? 'png';
  $('#recipe-quality').value = String(node.outputQuality ?? 90);
  syncRecipeOutputControls();
  $('#recipe-dialog').showModal(); $('#recipe-name').focus(); $('#recipe-name').select();
}

function syncRecipeOutputControls() {
  const format = $('#recipe-format').value;
  const quality = $('#recipe-quality');
  const qualityValue = $('#recipe-quality-value');
  quality.disabled = format === 'png';
  qualityValue.textContent = `${quality.value}%`;
  const label = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' }[format] || 'PNG';
  const output = format === 'png' ? `Output ${label}` : `Output ${label} · ${quality.value}% quality`;
  const editSummary = $('#recipe-preview-summary').dataset.editSummary || 'Original image look · No adjustments';
  $('#recipe-preview-summary').textContent = `${editSummary} · ${output}`;
}

function saveTypographyStyleFor(nodeId) {
  const node = findNode(state.document, nodeId)?.node;
  if (node?.type !== 'text') { showToast('Select a text layer to save its typography.'); return; }
  const name = prompt('Text style name', `${node.name} text`);
  if (name == null) return;
  try {
    checkpoint('Create text style');
    const style = createTypographyStyle(state.document, node.id, name);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'typographyStyleId');
    renderUI(); queueSave(); showToast(`Text style “${style.name}” saved.`);
  } catch (error) { showToast(error.message); }
}

function applyStyleToSelection(styleId) {
  const style = state.document.colorStyles?.find(item => item.id === styleId);
  if (!style || !state.selectedIds.length) { showToast('Select a compatible layer to apply this style.'); return; }
  const compatible = selectedNodes().filter(node => style.kind === 'text' ? node.type === 'text' : isFillStackSupported(node));
  if (!compatible.length) { showToast(style.kind === 'text' ? 'Select a text layer to apply this style.' : 'Select a shape or frame to apply this style.'); return; }
  checkpoint(`Apply ${style.name}`);
  for (const node of compatible) {
    applyColorStyle(state.document, node.id, style.id);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) {
      if (style.kind === 'text') recordComponentOverride(instanceRoot, node, 'textStyleId');
      else recordNodeComponentOverrides(node, ['fills', 'fill', 'fillOpacity', 'fillGradient', 'imageFill', 'fillStyleId', 'fillVariableId', 'variableBindings']);
    }
  }
  renderUI(); queueSave();
}

function updateColorStyleFromSelection(styleId) {
  const style = state.document.colorStyles?.find(item => item.id === styleId);
  const nodes = selectedNodes().filter(node => style?.kind === 'text' ? node.type === 'text'
    : isFillStackSupported(node) && fillStackForNode(node)[0]?.type === 'solid');
  if (!style) { showToast('This color style no longer exists.'); return; }
  if (nodes.length !== 1) { showToast('Select one compatible layer to update a color style.'); return; }
  checkpoint(`Update ${style.name}`);
  if (!updateColorStyle(state.document, style.id, nodes[0].id)) { showToast('Could not update this color style.'); return; }
  renderUI(); queueSave(); renderer.invalidate();
  showToast(`Updated “${style.name}” for every linked layer.`);
}

function renameColorStyleInAssets(styleId) {
  const style = state.document.colorStyles?.find(item => item.id === styleId);
  if (!style) { showToast('This color style no longer exists.'); return; }
  const name = prompt('Color style name', style.name);
  if (name == null) return;
  if (name.trim() === style.name) return;
  checkpoint(`Rename ${style.name}`);
  if (!renameColorStyle(state.document, style.id, name)) { showToast('Enter a color style name of 1–160 characters.'); return; }
  renderUI(); queueSave(); showToast(`Renamed color style to “${style.name}”.`);
}

function removeColorStyleFromAssets(styleId) {
  const style = state.document.colorStyles?.find(item => item.id === styleId);
  if (!style) { showToast('This color style no longer exists.'); return; }
  checkpoint(`Delete ${style.name}`);
  deleteColorStyle(state.document, style.id);
  renderUI(); queueSave(); renderer.invalidate();
  showToast(`Deleted “${style.name}” and kept its current color on linked layers.`);
}

function applyTypographyStyleToSelection(styleId) {
  const style = state.document.typographyStyles?.find(item => item.id === styleId);
  const compatible = selectedNodes().filter(node => node.type === 'text');
  if (!style || !compatible.length) { showToast('Select one or more text layers to apply this style.'); return; }
  checkpoint(`Apply ${style.name}`);
  const overriddenProperties = ['typographyStyleId', ...TYPOGRAPHY_STYLE_PROPERTIES, 'variableBindings', 'width', 'height'];
  for (const property of ['color', 'align', 'verticalAlign']) if (Object.hasOwn(style, property)) overriddenProperties.push(property);
  const layoutParents = new Set();
  for (const node of compatible) {
    applyTypographyStyle(state.document, node.id, style.id);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) for (const property of overriddenProperties) recordComponentOverride(instanceRoot, node, property);
    if (resizeTextNode(node)) {
      const parent = findNode(state.document, node.id)?.parent;
      if (parent?.autoLayout) layoutParents.add(parent);
    }
  }
  for (const parent of layoutParents) applyAutoLayout(parent);
  renderUI(); queueSave(); renderer.invalidate();
  showToast(`Applied “${style.name}” to ${compatible.length} text layer${compatible.length === 1 ? '' : 's'}.`);
}

function updateTypographyStyleFromSelection(styleId) {
  const style = state.document.typographyStyles?.find(item => item.id === styleId);
  const nodes = selectedNodes().filter(node => node.type === 'text');
  if (!style) { showToast('This text style no longer exists.'); return; }
  if (nodes.length !== 1) { showToast('Select one text layer to update a style.'); return; }
  checkpoint(`Update ${style.name}`);
  if (!updateTypographyStyle(state.document, style.id, nodes[0].id)) { showToast('Could not update this text style.'); return; }
  const layoutParents = new Set();
  for (const page of state.document.pages) walkNodes(page.children || [], ({ node, parent }) => {
    if (node.type !== 'text' || node.typographyStyleId !== style.id) return;
    if (resizeTextNode(node) && parent?.autoLayout) layoutParents.add(parent);
  });
  for (const parent of layoutParents) applyAutoLayout(parent);
  renderUI(); queueSave(); renderer.invalidate(); showToast(`Updated “${style.name}” on linked text layers.`);
}

function renameTypographyStyleInAssets(styleId) {
  const style = state.document.typographyStyles?.find(item => item.id === styleId);
  if (!style) { showToast('This text style no longer exists.'); return; }
  const name = prompt('Text style name', style.name);
  if (name == null || name.trim() === style.name) return;
  checkpoint(`Rename ${style.name}`);
  if (!renameTypographyStyle(state.document, style.id, name)) { showToast('Enter a text style name of 1–120 characters.'); return; }
  renderUI(); queueSave(); showToast(`Renamed text style to “${style.name}”.`);
}

function detachTypographyStyleFromSelection() {
  const nodes = selectedNodes().filter(node => node.type === 'text' && node.typographyStyleId);
  if (!nodes.length) return;
  checkpoint('Detach text style');
  for (const node of nodes) {
    delete node.typographyStyleId;
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'typographyStyleId');
  }
  renderUI(); queueSave();
}

function saveEffectStyleFor(nodeId) {
  const node = findNode(state.document, nodeId)?.node;
  if (!node) { showToast('Select a layer before saving an effect style.'); return; }
  const name = prompt('Effect style name', `${node.name} effects`);
  if (name == null) return;
  try {
    checkpoint('Create effect style');
    const style = createEffectStyle(state.document, node.id, name);
    selectedEffectStyleId = style.id;
    renderUI(); queueSave(); showToast(`Effect style “${style.name}” saved.`);
  } catch (error) { showToast(error.message); }
}

function applyEffectStyleToSelection() {
  const style = state.document.effectStyles?.find(item => item.id === selectedEffectStyleId);
  const entries = selectedEntries();
  if (!style) { showToast('Choose an effect style first.'); return; }
  if (!entries.length) { showToast('Select one or more layers to apply this effect style.'); return; }
  if (entries.some(({ node, parents }) => node.locked || parents.some(parent => parent.locked))) {
    showToast('Unlock every selected layer and its parent before applying an effect style.'); return;
  }
  checkpoint(`Apply ${style.name}`);
  for (const { node } of entries) {
    applyEffectStyle(state.document, node.id, style.id);
    recordNodeComponentOverrides(node, ['effects']);
  }
  renderUI(); queueSave(); renderer.invalidate();
  showToast(`Applied “${style.name}” to ${entries.length} layer${entries.length === 1 ? '' : 's'}.`);
}

function updateEffectStyleFromSelection() {
  const style = state.document.effectStyles?.find(item => item.id === selectedEffectStyleId);
  const nodes = selectedNodes();
  if (!style) { showToast('Choose an effect style first.'); return; }
  if (nodes.length !== 1) { showToast('Select one layer to update an effect style.'); return; }
  checkpoint(`Update ${style.name}`);
  if (!updateEffectStyle(state.document, style.id, nodes[0].id)) { showToast('Could not update this effect style.'); return; }
  renderUI(); queueSave(); showToast(`Updated “${style.name}” for future applications.`);
}

function removeEffectStyleFromAssets() {
  const style = state.document.effectStyles?.find(item => item.id === selectedEffectStyleId);
  if (!style) { showToast('Choose an effect style first.'); return; }
  checkpoint(`Delete ${style.name}`);
  deleteEffectStyle(state.document, style.id);
  selectedEffectStyleId = '';
  renderUI(); queueSave(); showToast(`Deleted “${style.name}”.`);
}

function handleEffectStyleAction(action) {
  if (action === 'save') saveEffectStyleFor(selectedNodes()[0]?.id);
  else if (action === 'apply') applyEffectStyleToSelection();
  else if (action === 'update') updateEffectStyleFromSelection();
  else if (action === 'delete') removeEffectStyleFromAssets();
}

function removeTypographyStyleFromAssets(styleId) {
  const style = state.document.typographyStyles?.find(item => item.id === styleId);
  if (!style) return;
  checkpoint(`Delete ${style.name}`);
  deleteTypographyStyle(state.document, style.id);
  renderUI(); queueSave(); showToast(`Deleted “${style.name}”.`);
}

function applyColorVariableToSelection(variableId, requestedKind = null) {
  if (!state.selectedIds.length) { showToast('Select a layer to bind a color variable.'); return; }
  if (variableId && !state.document.variables?.some(variable => variable.id === variableId && variable.type === 'color')) { showToast('This color variable no longer exists.'); return; }
  const nodes = selectedNodes();
  const changes = nodes.map(node => {
    if (node.type === 'slice') return null;
    const kind = requestedKind || (node.type === 'text' ? 'text' : node.type === 'line' || (node.type === 'path' && !hasClosedPathContour(node)) || (node.type === 'network' && !node.faces?.length) ? 'stroke' : 'fill');
    const compatible = kind === 'text' ? node.type === 'text'
      : kind === 'fill' ? !['text', 'image', 'line'].includes(node.type) && (node.type !== 'path' || hasClosedPathContour(node)) && (node.type !== 'network' || (node.faces || []).length > 0)
        : !['text', 'image', 'group', 'boolean'].includes(node.type);
    return compatible ? { node, kind } : null;
  }).filter(Boolean);
  if (!changes.length) { showToast('This color variable is not compatible with the selection.'); return; }
  checkpoint(variableId ? 'Bind color variable' : 'Remove color variable');
  for (const { node, kind } of changes) {
    bindColorVariable(state.document, node.id, variableId || null, kind);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, { fill: 'fillVariableId', text: 'textVariableId', stroke: 'strokeVariableId' }[kind]);
  }
  renderUI(); queueSave(); renderer.invalidate();
}

function applyVariablePropertyToSelection(property, variableId) {
  if (!state.selectedIds.length) { showToast('Select a layer before binding a variable.'); return; }
  const nodes = selectedNodes();
  const compatible = nodes.filter(node => node.type !== 'slice' && canBindVariable(state.document, node.id, variableId || null, property));
  if (!compatible.length) { renderUI(); showToast('That variable type is not compatible with the selected layer property.'); return; }
  checkpoint(variableId ? `Bind ${property} variable` : `Unbind ${property} variable`);
  for (const node of compatible) {
    bindVariable(state.document, node.id, variableId || null, property);
    if (node.type === 'text') resizeTextLayers([node]);
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'variableBindings');
  }
  if (property.startsWith('autoLayout.')) relayoutVariableBoundFrames();
  renderUI(); queueSave(); renderer.invalidate();
}

function createColorVariableFromSelection(kind = null) {
  const nodes = selectedNodes();
  if (!nodes.length) { showToast('Select a layer before creating a color variable.'); return; }
  const source = nodes.find(node => kind === 'text' ? node.type === 'text' : kind === 'stroke' ? !['text', 'image', 'group', 'boolean'].includes(node.type) : !['text', 'image', 'line'].includes(node.type) && (node.type !== 'path' || hasClosedPathContour(node)) && (node.type !== 'network' || (node.faces || []).length > 0));
  if (!source) { showToast('Select a compatible color layer first.'); return; }
  const variableKind = kind || (source.type === 'text' ? 'text' : source.type === 'line' || (source.type === 'path' && !hasClosedPathContour(source)) || (source.type === 'network' && !source.faces?.length) ? 'stroke' : 'fill');
  const current = getNodeColor(state.document, source, variableKind);
  openVariableNameDialog({
    type: 'selection', colorKind: variableKind, colorValue: /^#[0-9a-f]{6}$/i.test(current) ? current : '#1e1e1e',
    title: 'Create color variable', label: 'Variable name', copy: 'Create a reusable color and bind it to the selected layer.', defaultName: `${source.name} color`
  });
}

function selectedColorForVariable() {
  const node = selectedNodes()[0];
  if (!node) return '#1e1e1e';
  return getNodeColor(state.document, node, node.type === 'text' ? 'text' : node.type === 'line' || (node.type === 'path' && !hasClosedPathContour(node)) || (node.type === 'network' && !node.faces?.length) ? 'stroke' : 'fill');
}

function handleVariableAssetsAction(action, details = {}) {
  if (action === 'add-variable-collection') {
    openVariableNameDialog({ type: 'collection', title: 'Create variable collection', label: 'Collection name', copy: 'Collections group color variables and their theme modes.', defaultName: 'Colors' });
  } else if (action === 'add-variable-mode') {
    const collection = state.document.variableCollections?.find(item => item.id === details.collectionId);
    if (!collection) return;
    openVariableNameDialog({ type: 'mode', collectionId: collection.id, title: 'Create mode', label: 'Mode name', copy: `Add a theme mode to ${collection.name}. Existing values start from the collection default mode.`, defaultName: `Mode ${collection.modes.length + 1}` });
  } else if (action === 'add-variable') {
    const collection = state.document.variableCollections?.find(item => item.id === details.collectionId);
    if (!collection) return;
    openVariableNameDialog({ type: 'variable', collectionId: collection.id, title: 'Create variable', label: 'Variable name', copy: `Add a typed design token to ${collection.name}.`, defaultName: `Variable ${(state.document.variables || []).filter(item => item.collectionId === collection.id).length + 1}` });
  } else if (action === 'delete-variable') {
    checkpoint('Delete variable'); deleteVariable(state.document, details.variableId);
  } else if (action === 'delete-variable-collection') {
    checkpoint('Delete variable collection'); deleteVariableCollection(state.document, details.collectionId);
  } else return;
  renderUI(); queueSave(); renderer.invalidate();
}

function openVariableNameDialog(options) {
  const dialog = $('#variable-dialog');
  const input = $('#variable-name');
  state.pendingVariableDialog = options;
  $('#variable-dialog-title').textContent = options.title;
  $('#variable-dialog-copy').textContent = options.copy;
  $('#variable-name-label').textContent = options.label;
  $('#variable-type-field').hidden = options.type !== 'variable';
  $('#variable-type').value = options.variableType || 'color';
  input.value = options.defaultName || '';
  dialog.returnValue = '';
  dialog.showModal();
  input.focus(); input.select();
}

function commitVariableNameDialog() {
  const pending = state.pendingVariableDialog;
  state.pendingVariableDialog = null;
  if (!pending || $('#variable-dialog').returnValue !== 'save') return;
  const name = $('#variable-name').value.trim();
  if (!name) { showToast('Enter a name before creating this item.'); return; }
  try {
    if (pending.type === 'mode') {
      const collection = state.document.variableCollections?.find(item => item.id === pending.collectionId);
      if (!collection) throw new Error('The variable collection no longer exists.');
      if (collection.modes.some(mode => mode.name.toLowerCase() === name.toLowerCase())) throw new Error('Choose a unique name for this mode.');
      checkpoint('Add variable mode'); addVariableMode(state.document, collection.id, name);
    } else if (pending.type === 'variable') {
      const collection = state.document.variableCollections?.find(item => item.id === pending.collectionId);
      if (!collection) throw new Error('The variable collection no longer exists.');
      if ((state.document.variables || []).some(variable => variable.collectionId === collection.id && variable.name.toLowerCase() === name.toLowerCase())) throw new Error('A variable with that name already exists in this collection.');
      const variableType = $('#variable-type').value;
      const initialValue = variableType === 'color' ? selectedColorForVariable() : variableType === 'number' ? 0 : variableType === 'boolean' ? false : '';
      checkpoint(`Create ${variableType} variable`); createVariable(state.document, collection.id, name, variableType, initialValue);
    } else if (pending.type === 'collection') {
      checkpoint('Create variable collection'); createVariableCollection(state.document, name);
    } else if (pending.type === 'selection') {
      const nodes = selectedNodes();
      if (!nodes.length) throw new Error('Select a layer before creating a color variable.');
      const collection = state.document.variableCollections?.[0] || null;
      if (collection && (state.document.variables || []).some(variable => variable.collectionId === collection.id && variable.name.toLowerCase() === name.toLowerCase())) throw new Error('A variable with that name already exists in this collection.');
      checkpoint('Create color variable');
      const targetCollection = collection || createVariableCollection(state.document, 'Colors');
      const variable = createColorVariable(state.document, targetCollection.id, name, pending.colorValue || '#1e1e1e');
      for (const node of nodes) {
        const kind = pending.colorKind || (node.type === 'text' ? 'text' : node.type === 'line' || (node.type === 'path' && !hasClosedPathContour(node)) || (node.type === 'network' && !node.faces?.length) ? 'stroke' : 'fill');
        if (!bindColorVariable(state.document, node.id, variable.id, kind)) continue;
        const instanceRoot = componentInstanceRoot(node.id);
        if (instanceRoot) recordComponentOverride(instanceRoot, node, { fill: 'fillVariableId', text: 'textVariableId', stroke: 'strokeVariableId' }[kind]);
      }
      showToast(`Color variable “${variable.name}” created.`);
    } else return;
  } catch (error) { showToast(error.message || 'Could not create this variable item.'); return; }
  renderUI(); queueSave(); renderer.invalidate();
}

function showMenu(items, x, y, returnFocusElement = null, menuLabel = 'Editor actions') {
  const menu = $('#context-menu');
  menu._returnFocusElement?.setAttribute('aria-expanded', 'false');
  menu.replaceChildren(); menu.hidden = false; menu._returnFocusElement = returnFocusElement; menu._focusAfterAction = null;
  menu.setAttribute('aria-label', menuLabel);
  if (returnFocusElement?.hasAttribute?.('aria-expanded')) returnFocusElement.setAttribute('aria-expanded', 'true');
  for (const item of items) {
    if (item.separator) { const divider = document.createElement('div'); divider.className = 'menu-separator'; menu.append(divider); continue; }
    if (item.labelOnly) { const label = document.createElement('div'); label.className = 'menu-label'; label.textContent = item.label; menu.append(label); continue; }
    const button = document.createElement('button'); button.type = 'button'; button.disabled = Boolean(item.disabled); button.className = item.className || ''; button.setAttribute('role', 'menuitem');
    if (item.role) button.setAttribute('role', item.role);
    if (item.checked != null) button.setAttribute('aria-checked', String(Boolean(item.checked)));
    const label = document.createElement('span'); label.textContent = item.label;
    button.append(label);
    if (item.shortcut) { const shortcut = document.createElement('span'); shortcut.className = 'shortcut'; shortcut.textContent = item.shortcut; button.append(shortcut); }
    button.addEventListener('click', () => {
      const returnFocus = menu._returnFocusElement;
      const returnLayerId = returnFocus?.closest('[data-layer-id]')?.dataset.layerId;
      returnFocus?.setAttribute('aria-expanded', 'false');
      menu.hidden = true; menu._returnFocusElement = null;
      item.action?.();
      const focusAfterAction = menu._focusAfterAction;
      menu._focusAfterAction = null;
      if (!document.querySelector('dialog[open]')) {
        if (focusAfterAction?.isConnected) focusAfterAction.focus({ preventScroll: true });
        else if (returnFocus) {
          const currentRow = (returnLayerId && layerRowsById.get(returnLayerId)) || layerRowsById.get(state.selectedIds[0]);
          const fallback = currentRow?.querySelector('[data-action="layer-actions-menu"]')
            || currentRow
            || $('#layer-select-mode');
          const target = menuFocusReturnTarget(returnFocus, fallback);
          if (!target?.closest('[inert]')) target?.focus({ preventScroll: true });
          else if (!$('#bulk-bar').hidden) $('#bulk-bar')?.focus({ preventScroll: true });
        }
      }
    });
    menu.append(button);
  }
  const width = menu.offsetWidth; const height = menu.offsetHeight;
  menu.style.maxHeight = `${Math.max(120, innerHeight - 16)}px`;
  menu.style.overflowY = 'auto';
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
  focusFirstContextMenuItem(menu);
}
function closeMenu() {
  const menu = $('#context-menu');
  menu._returnFocusElement?.setAttribute('aria-expanded', 'false');
  menu.hidden = true;
  menu._returnFocusElement = null;
}

function openNodeMenu(nodeId, x, y, commentAnchor = null, returnFocusElement = null) {
  const node = findNode(state.document, nodeId)?.node;
  const linkedInstance = componentInstanceRoot(nodeId);
  const nodePosition = absolutePosition(nodeId);
  const commentPoint = commentAnchor || { x: nodePosition.x + (node?.width || 0) / 2, y: nodePosition.y + (node?.height || 0) / 2 };
  if (!state.selectedIds.includes(nodeId)) setSelection([nodeId]);
  const images = selectedNodes().filter(item => item.type === 'image');
  const items = [
    { label: 'Add comment here', action: () => beginCommentAt(commentPoint) },
    { separator: true },
    { label: 'Copy layers', shortcut: '⌘C', action: copySelected },
    { label: 'Cut layers', shortcut: '⌘X', action: cutSelected },
    { label: 'Paste layers', shortcut: '⌘V', action: () => pasteSelectedLayers(), disabled: !hasClipboardLayers() },
    ...(node && node.type !== 'slice' ? [
      { separator: true },
      { label: 'Copy properties', shortcut: propertyClipboardShortcut('c'), action: () => copyAppearanceFrom(nodeId) },
      { label: 'Paste properties', shortcut: propertyClipboardShortcut('v'), action: pasteAppearanceToSelection, disabled: !state.appearanceClipboard || !appearanceTargetEntries().length }
    ] : []),
    { separator: true },
    { label: 'Duplicate', shortcut: '⌘D', action: duplicateSelected },
    { label: 'Rename', shortcut: '↵', action: () => renameSelected() },
    ...(node ? [{
      label: getNodePropertyValue(state.document, node, 'visible') ? 'Hide layer' : 'Show layer',
      action: () => {
        checkpoint('Toggle visibility');
        setNodePropertyValue(node, 'visible', !getNodePropertyValue(state.document, node, 'visible'));
        renderUI(); queueSave();
      }
    }] : []),
    { label: 'Bring to front', action: () => reorderSelected('front') },
    { label: 'Send to back', action: () => reorderSelected('back') },
    { separator: true },
    { label: 'Delete', shortcut: '⌫', action: deleteSelected }
  ];
  const selectedMainComponents = selectedNodes().filter(item => item.isComponent);
  const canCombine = canCombineBoolean(state.document, state.selectedIds);
  const selectedBoolean = selectedNodes().length === 1 && selectedNodes()[0].type === 'boolean' ? selectedNodes()[0] : null;
  const selectedGroup = selectedNodes().length === 1 && selectedNodes()[0].type === 'group' ? selectedNodes()[0] : null;
  if (canGroupLayers(state.document, rootSelectedIds())) items.unshift({ label: `Group ${rootSelectedIds().length} layers`, shortcut: '⌘G', action: groupSelectedLayers }, { separator: true });
  if (selectedGroup && canUngroupLayers(state.document, selectedGroup.id)) items.unshift({ label: 'Ungroup', shortcut: '⌘⇧G', action: () => ungroupSelectedLayers(selectedGroup.id) }, { separator: true });
  if (canCreateMaskGroup(state.document, rootSelectedIds())) items.unshift({ label: 'Use as mask', action: maskSelectedLayers }, { separator: true });
  if (node?.type === 'group' && node.mask) items.unshift({ label: 'Release mask', action: () => releaseSelectedMask(node.id) }, { separator: true });
  if (canCombine) {
    items.unshift(
      { label: 'Combine as Union', action: () => combineSelectedBoolean('union') },
      { label: 'Combine as Subtract', action: () => combineSelectedBoolean('subtract') },
      { label: 'Combine as Intersect', action: () => combineSelectedBoolean('intersect') },
      { label: 'Combine as Exclude', action: () => combineSelectedBoolean('exclude') },
      { separator: true }
    );
  }
  if (selectedBoolean) {
    items.unshift(
      { label: 'Bake to vector path', action: () => bakeSelectedBoolean(selectedBoolean.id) },
      { label: 'Separate Boolean', action: () => separateSelectedBoolean(selectedBoolean.id) },
      { label: 'Boolean operation', labelOnly: true },
      ...[['union','Union'],['subtract','Subtract'],['intersect','Intersect'],['exclude','Exclude']].map(([operation, label]) => ({
        label: label === selectedBoolean.operation ? `✓ ${label}` : label,
        action: () => setBooleanOperation(selectedBoolean.id, operation)
      })),
      { separator: true }
    );
  }
  if (selectedNodes().length > 1 && selectedMainComponents.length === selectedNodes().length) {
    items.unshift({ label: `Combine ${selectedMainComponents.length} as variants`, action: combineSelectedComponents }, { separator: true });
  }
  if (linkedInstance) items.splice(0, 0, { label: 'Detach component instance', action: () => detachInstance(linkedInstance.id) }, { separator: true });
  else if (node?.isComponent) items.splice(0, 0, { label: 'Create component instance', action: () => createInstanceAt(node.componentId) }, { separator: true });
  else if (node && node.type !== 'slice') items.splice(0, 0, { label: 'Create component', action: () => makeComponent(node.id) }, { separator: true });
  if (node?.type === 'slice') items.splice(0, 0, { label: 'Export slice', action: () => exportSliceById(nodeId) }, { separator: true });
  if (node?.type === 'image') {
    items.splice(0, 0, { label: 'Save image recipe…', action: () => saveRecipeFor(nodeId) }, { separator: true });
  }
  if (node?.type === 'text') {
    items.splice(0, 0, { label: 'Save text style…', action: () => saveTypographyStyleFor(nodeId) }, { separator: true });
  }
  if (images.length) {
    items.push({ separator: true }, { label: images.length > 1 ? `Export ${images.length} images as ZIP` : 'Export selected image', action: exportSelectionPng });
    items.push({ separator: true }, { label: `Apply recipe to ${images.length} image${images.length === 1 ? '' : 's'}`, labelOnly: true });
    if (state.document.recipes.length) for (const recipe of state.document.recipes) items.push({
      label: recipe.name,
      className: 'recipe-option',
      action: () => {
        state.layerSelectionMode = false;
        renderLayers();
        closeMobilePanels({ restoreFocus: false });
        if (startRecipe(recipe, images.map(item => item.id))) {
          $('#context-menu')._focusAfterAction = $('#bulk-bar');
        }
      }
    });
    else items.push({ label: 'Save a recipe from an edited image first', className: 'recipe-option is-empty', disabled: true });
  }
  const compatibleStyles = (state.document.colorStyles || []).filter(style => style.kind === 'text'
    ? selectedNodes().some(item => item.type === 'text')
    : selectedNodes().some(item => isFillStackSupported(item)));
  if (compatibleStyles.length) items.push({ separator: true }, { label: 'Apply color style', labelOnly: true }, ...compatibleStyles.map(style => ({ label: style.name, action: () => applyStyleToSelection(style.id) })));
  const textTargets = selectedNodes().filter(item => item.type === 'text');
  const typographyStyles = state.document.typographyStyles || [];
  if (textTargets.length && typographyStyles.length) items.push({ separator: true }, { label: 'Apply text style', labelOnly: true }, ...typographyStyles.map(style => ({ label: style.name, action: () => applyTypographyStyleToSelection(style.id) })));
  showMenu(items, x, y, returnFocusElement, 'Layer actions');
}

function combineSelectedBoolean(operation) {
  const ids = rootSelectedIds();
  try {
    checkpoint(`Combine as ${operation}`);
    const group = combineBoolean(state.document, ids, operation);
    setSelection([group.id]); renderUI(); queueSave(); renderer.invalidate();
    showToast(`${operation[0].toUpperCase()}${operation.slice(1)} Boolean group created. Its source layers remain editable.`);
  } catch (error) { showToast(error.message || 'These layers cannot be combined.'); }
}

function groupSelectedLayers() {
  const ids = rootSelectedIds();
  try {
    checkpoint('Group layers');
    const group = groupLayers(state.document, ids);
    setSelection([group.id]); renderUI(); queueSave();
    showToast(`${ids.length} layers grouped.`);
  } catch (error) { showToast(error.message || 'These layers cannot be grouped.'); }
}

function alignSelectedLayers(mode) {
  const ids = state.selectedIds;
  if (!canAlignLayers(state.document, ids, mode)) { showToast('Select unlocked sibling layers outside auto layout to align them.'); return; }
  const labels = { left: 'left', 'center-x': 'horizontal centers', right: 'right', top: 'top', 'center-y': 'vertical centers', bottom: 'bottom', 'distribute-horizontal': 'horizontally', 'distribute-vertical': 'vertically' };
  checkpoint(mode.startsWith('distribute-') ? `Distribute layers ${labels[mode]}` : `Align layers ${labels[mode]}`);
  const changed = alignLayers(state.document, ids, mode);
  for (const node of changed) {
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) {
      recordComponentOverride(instanceRoot, node, 'x');
      recordComponentOverride(instanceRoot, node, 'y');
    }
  }
  renderUI(); queueSave(); renderer.invalidate();
  showToast(mode.startsWith('distribute-') ? `Layers distributed ${labels[mode]}.` : `Layers aligned by ${labels[mode]}.`);
}

function ungroupSelectedLayers(groupId = selectedNodes()[0]?.id) {
  try {
    checkpoint('Ungroup layers');
    const children = ungroupLayers(state.document, groupId);
    setSelection(children.map(child => child.id)); renderUI(); queueSave();
    showToast(`${children.length} layers ungrouped.`);
  } catch (error) { showToast(error.message || 'This group cannot be ungrouped.'); }
}

function maskSelectedLayers() {
  const ids = rootSelectedIds();
  try {
    checkpoint('Create mask group');
    const group = createMaskGroup(state.document, ids);
    setSelection([group.id]); renderUI(); queueSave(); renderer.invalidate();
    showToast(`Mask group created from “${group.children.find(child => child.id === group.maskSourceId)?.name || 'Vector shape'}”. Its source layers remain editable.`);
  } catch (error) { showToast(error.message || 'These layers cannot form a mask.'); }
}

function releaseSelectedMask(groupId = selectedNodes()[0]?.id) {
  try {
    checkpoint('Release mask');
    const children = releaseMaskGroup(state.document, groupId);
    setSelection(children.map(child => child.id)); renderUI(); queueSave(); renderer.invalidate();
    showToast('Mask released. The source layers remain editable.');
  } catch (error) { showToast(error.message); }
}

function setBooleanOperation(nodeId, operation) {
  const node = findNode(state.document, nodeId)?.node;
  if (!node || node.type !== 'boolean' || node.operation === operation) return;
  checkpoint(`Change Boolean operation to ${operation}`);
  node.operation = operation;
  const instanceRoot = componentInstanceRoot(node.id);
  if (instanceRoot) recordComponentOverride(instanceRoot, node, 'operation');
  renderUI(); queueSave(); renderer.invalidate();
}

function separateSelectedBoolean(nodeId = selectedNodes()[0]?.id) {
  try {
    checkpoint('Separate Boolean');
    const children = separateBoolean(state.document, nodeId);
    setSelection(children.map(child => child.id)); renderUI(); queueSave(); renderer.invalidate();
    showToast('Boolean source shapes separated.');
  } catch (error) { showToast(error.message); }
}

function bakeSelectedBoolean(nodeId = selectedNodes()[0]?.id) {
  try {
    const plan = prepareBooleanBake(state.document, nodeId);
    checkpoint('Bake Boolean to vector path');
    const path = applyBooleanBake(state.document, plan);
    clearVectorAnchorSelection();
    setSelection([path.id]); renderUI(); queueSave(); renderer.invalidate();
    showToast('Boolean baked to an editable vector path. Use the vector tool to edit its contours.');
  } catch (error) { showToast(error.message || 'This Boolean group cannot be baked exactly.'); }
}

function openFileMenu(x, y, commentAnchor = null, returnFocusElement = null) {
  const exportIds = orderedRootSelection();
  const exportNodes = exportIds.map(id => findNode(state.document, id)?.node).filter(Boolean);
  const selectedFrame = exportIds.length === 1 && exportNodes.length === 1 && exportNodes[0].type === 'frame';
  const exportLabel = exportNodes.length > 1 && exportNodes.length === exportIds.length && exportNodes.every(node => node.type === 'image')
    ? `Export ${exportNodes.length} images as ZIP`
    : 'Export selected layer as PNG';
  showMenu([
    ...(commentAnchor ? [{ label: 'Add comment here', action: () => beginCommentAt(commentAnchor) }, { separator: true }] : []),
    { label: 'Your designs…', action: openDesignLibrary },
    { label: 'Version history…', action: openVersionHistory },
    { label: state.workspace ? `Folder workspace · ${state.workspaceHandle?.name || 'active'}` : 'Choose folder workspace…', action: chooseWorkspaceFolder },
    ...(state.workspaceHandle && !state.workspace ? [{ label: 'Reconnect folder workspace…', action: reconnectWorkspaceFolder }] : []),
    { label: 'Share live…', action: () => dispatchWorkspaceCollaborationIntent('tiny-image-star:share-live') },
    { label: 'Join live session…', action: () => dispatchWorkspaceCollaborationIntent('tiny-image-star:join-live') },
    { label: 'New design', shortcut: '⌘N', action: newDesign },
    { label: 'Open local design…', action: () => $('#open-file-input').click() },
    { label: 'Import SVG as editable layers…', action: () => $('#svg-input').click() },
    { separator: true },
    { label: 'Share local design…', action: shareDesignFile },
    { label: 'Save local copy…', shortcut: '⌘⇧S', action: exportDesign },
    { label: 'Copy selected layers', shortcut: '⌘C', action: copySelected, disabled: !rootSelectedIds().length },
    { label: 'Cut selected layers', shortcut: '⌘X', action: cutSelected, disabled: !rootSelectedIds().length },
    { label: 'Paste layers', shortcut: '⌘V', action: () => pasteSelectedLayers(), disabled: !hasClipboardLayers() },
    { label: 'Duplicate selected layers', shortcut: '⌘D', action: duplicateSelected, disabled: !rootSelectedIds().length },
    { label: exportLabel, action: exportSelectionPng, disabled: state.selectedIds.length === 0 },
    { label: 'Export selected frame as 1× raster PDF', action: () => { exportSelectedFrameRasterPdf(exportIds[0]).catch(error => showToast(error.message || 'Could not export this frame as a raster PDF.')); }, disabled: !selectedFrame },
    { label: 'Export current page frames as multipage raster PDF', action: () => { exportActivePageRasterPdf().catch(error => showToast(error.message || 'Could not export this page as a raster PDF.')); } },
    { label: 'Export selected frame as vector PDF', action: () => { exportSelectedFrameVectorPdf(exportIds[0]).catch(error => showToast(error.message || 'Could not export this frame as a vector PDF.')); }, disabled: !selectedFrame },
    { label: 'Export current page frames as multipage vector PDF', action: () => { exportActivePageVectorPdf().catch(error => showToast(error.message || 'Could not export this page as a vector PDF.')); } },
    { label: 'Export selected layer as SVG', action: () => { exportSelectedNodeSvg(rootSelectedIds()[0]).catch(error => showToast(error.message || 'Could not export this layer as SVG.')); }, disabled: rootSelectedIds().length !== 1 },
    { label: 'Export current page as SVG', action: () => { exportActivePageSvg().catch(error => showToast(error.message || 'Could not export this page as SVG.')); } },
    { separator: true },
    { label: `${state.showLayoutGuides ? '✓' : '○'} Layout guides`, shortcut: '⇧G', action: toggleLayoutGuides },
    { separator: true },
    { labelOnly: true, label: 'Appearance' },
    ...[
      ['system', 'System'],
      ['light', 'Light'],
      ['dark', 'Dark']
    ].map(([value, label]) => ({ label, role: 'menuitemradio', checked: themePreferences.getPreference() === value, action: () => themePreferences.setPreference(value) })),
    { separator: true },
    { label: 'Undo', shortcut: '⌘Z', action: undo, disabled: !history.canUndo || isImageRecipeBatchActive(state.bulk) },
    { label: 'Redo', shortcut: '⌘⇧Z', action: redo, disabled: !history.canRedo || isImageRecipeBatchActive(state.bulk) }
  ], x, y, returnFocusElement, 'File actions');
}
function dispatchWorkspaceCollaborationIntent(eventName) {
  const event = new CustomEvent(eventName, {
    cancelable: true,
    detail: Object.freeze({
      document: JSON.parse(serializeDocument(state.document)),
      workspace: state.workspace,
      workspaceHandle: state.workspaceHandle,
      head: state.workspaceHead,
      storageMode: state.workspace ? 'workspace' : 'browser'
    })
  });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) showToast('Live collaboration controls are not connected yet.');
}

function liveDialog() { return $('#live-collaboration-dialog'); }
function liveStatus(role, message) {
  const target = role === 'host' ? $('#live-host-status') : $('#live-guest-status');
  if (target) target.textContent = message || '';
}
function liveTerminal(status) {
  return ['closed', 'revoked', 'failed', 'timeout', 'disconnected', 'overloaded', 'rejected', 'diverged', 'fork-saved', 'fork-unsaved', 'disconnected-before-snapshot'].includes(status);
}
function liveIceServers(role) {
  const checked = role === 'host' ? $('#live-stun-opt-in').checked : $('#live-guest-stun-opt-in').checked;
  return checked ? [{ urls: 'stun:stun.l.google.com:19302' }] : [];
}
function setLiveEditorBlocked(blocked) {
  const shouldBlock = Boolean(blocked || state.pendingRecipeRecovery || state.workspacePermissionNeeded);
  $('.topbar').inert = shouldBlock;
  $('.workspace').inert = shouldBlock;
}
function openLiveDialog(role) {
  const dialog = liveDialog();
  $('#live-host-panel').hidden = role !== 'host';
  $('#live-guest-panel').hidden = role !== 'guest';
  $('#live-collaboration-title').textContent = role === 'host' ? 'Share live design' : 'Join live design';
  dialog.showModal();
}
async function prepareLiveWorkspace() {
  if (state.workspace) return true;
  await chooseWorkspaceFolder();
  if (!state.workspace) throw new Error('Choose a writable folder workspace before starting live collaboration.');
  return true;
}
function invitationFromText(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('Paste the design invitation first.');
  if (/^https?:\/\//i.test(text)) {
    let url;
    try { url = new URL(text); } catch { throw new Error('The invitation link is invalid.'); }
    if (!url.hash) throw new Error('This link has no design invitation fragment.');
    return decodeStableDesignInvite(url.hash);
  }
  return decodeStableDesignInvite(text);
}
async function copyLiveField(fieldId) {
  const field = $(`#${fieldId}`);
  if (!field?.value) { showToast('There is nothing to copy yet.'); return; }
  try {
    await navigator.clipboard.writeText(field.value);
    showToast('Copied. Send this capsule through a channel you trust.');
  } catch {
    field.focus(); field.select();
    showToast('The text is selected. Copy it using your device’s copy command.');
  }
}
async function shareLiveCapsules() {
  const text = `Tiny Image Star live design\n\nInvitation:\n${$('#live-invite-value').value}\n\nOne-time session offer (expires soon):\n${$('#live-offer-value').value}`;
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ title: 'Tiny Image Star live design', text }); return; }
    catch (error) { if (error?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); showToast('Invitation and offer copied. Send them through a channel you trust.'); }
  catch { $('#live-invite-value').focus(); $('#live-invite-value').select(); showToast('Share is unavailable. Copy the invitation and offer separately.'); }
}

async function startLiveHost() {
  const current = state.liveCollaboration;
  if (current?.role === 'host' && !liveTerminal(current.status)) { openLiveDialog('host'); return; }
  try {
    await prepareLiveWorkspace();
    if (!(await persistCurrentDocumentNow())) throw new Error('Save the current design before sharing it.');
    const session = { role: 'host', status: 'preparing', controller: null, designId: state.document.id };
    state.liveCollaboration = session;
    liveStatus('host', 'Preparing the design and signed session offer…');
    $('#live-start-host').disabled = true;
    setLiveEditorBlocked(true);
    const controller = await createHostSessionController({
      workspace: state.workspace,
      designId: state.document.id,
      iceServers: liveIceServers('host'),
      onState: status => {
        session.status = status;
        const copy = {
          'preparing': 'Preparing the session…', 'waiting-answer': 'Offer ready. Send the invitation and offer to your guest.',
          'verifying-answer': 'Verifying the guest’s answer…', 'connecting': 'Connecting directly to the guest…',
          'waiting-guest': 'Connection open. Waiting for the guest to finish joining…',
          'connected': 'Guest connected. Your folder is the canonical saved copy.',
          'sending-assets': 'Sending required images and fonts over the encrypted peer connection…',
          'revoked': 'Sharing stopped and the invitation was revoked.', 'closed': 'Live session closed.',
          'failed': 'The live session failed. Check the capsules and try again.', 'timeout': 'The live session timed out.',
          'overloaded': 'The peer sent too many messages. The session was closed safely.',
          'rejected': 'The guest session was rejected.', 'diverged': 'The guest diverged from the saved head; sharing stopped.'
        };
        liveStatus('host', copy[status] || `Live session: ${status}.`);
        if (liveTerminal(status)) setLiveEditorBlocked(false);
      },
      onSnapshot: (snapshot, head) => {
        const next = parseDocument(snapshot);
        if (next.id !== session.designId) return;
        state.document = next;
        state.workspaceHead = head;
        state.workspaceVerifiedImageIds.set(next.id, new Set(collectReferencedAssets(next).imageAssetIds));
        state.documentGeneration += 1;
        renderUI();
        void refreshLocalFontAssets().then(() => restoreImageAssets(state.documentGeneration)).then(() => renderer?.invalidate())
          .catch(error => showToast(error.message || 'The host could not refresh a newly shared asset.'));
      },
      approveIncomingAsset: async asset => globalThis.confirm?.(`Allow the guest to add this ${asset.assetKind} to “${state.document.name}”?\n\n${asset.assetId} · ${Math.ceil(asset.byteLength / 1024)} KB${asset.fontMetadata ? `\n${asset.fontMetadata.family} ${asset.fontMetadata.weight} ${asset.fontMetadata.style}` : ''}\n\nThe bytes will be written only into this design’s selected workspace folder.`) === true,
      onAssetTransfer: result => {
        const detail = result.phase === 'received'
          ? `Guest assets saved · ${result.count} item${result.count === 1 ? '' : 's'} · ${Math.ceil(result.totalBytes / (1024 * 1024))} MiB`
          : `Sent ${result.assetKind || 'asset'} · ${Math.ceil(result.byteLength / 1024)} KB`;
        $('#live-transfer-status').textContent = detail;
      }
    });
    session.controller = controller;
    $('#live-start-host').hidden = true;
    $('#live-accept-answer').hidden = false;
    const link = new URL(location.href);
    link.hash = controller.invitation;
    $('#live-invite-value').value = link.toString();
    $('#live-offer-value').value = controller.offerCapsule;
    $('#live-share-capsules').hidden = false;
    $('#live-stop-host').hidden = false;
    liveStatus('host', 'Offer ready. Send both items to your guest; the offer expires after a few minutes.');
  } catch (error) {
    if (state.liveCollaboration?.role === 'host') state.liveCollaboration = null;
    setLiveEditorBlocked(false);
    liveStatus('host', error.message || 'Could not prepare this live session.');
    showToast(error.message || 'Could not prepare this live session.');
  } finally { $('#live-start-host').disabled = false; }
}

async function ensureLiveReplicaDesign(session) {
  if (session.localHead) return session.localHead;
  if (session.createPromise) return session.createPromise;
  session.createPromise = (async () => {
    if (!state.workspace) throw new Error('A writable folder workspace is required for the local shared-design copy.');
    const seed = createDocument();
    seed.id = session.localDesignId;
    seed.name = 'Incoming shared design';
    await createWorkspaceDesign(state.workspace, seed);
    const opened = await openWorkspaceDesign(state.workspace, session.localDesignId);
    session.localHead = opened.head;
    state.workspaceVerifiedImageIds.set(session.localDesignId, new Set());
    state.workspaceVerifiedFontIds.set(session.localDesignId, new Set());
    return session.localHead;
  })().catch(error => { session.createPromise = null; throw error; });
  return session.createPromise;
}

async function persistLiveReplicaSnapshot(session, snapshot) {
  await ensureLiveReplicaDesign(session);
  const localSnapshot = JSON.parse(JSON.stringify(snapshot));
  localSnapshot.id = session.localDesignId;
  const saved = await enqueueWorkspaceSnapshot(localSnapshot);
  session.localHead = saved.head;
  state.liveReplicaHead = saved.head;
  state.workspaceHead = saved.head;
  return saved;
}

async function installLiveReplicaSnapshot(session, hostSnapshot, hostHead = null) {
  if (session.replicaReady) {
    session.hostRevision = session.controller?.revision ?? session.hostRevision;
    const head = hostHead || session.hostHead;
    if (head?.commitHash && state.document.settings) {
      session.hostHead = { sequence: head.sequence, commitHash: head.commitHash };
      state.document.settings.collaborationSource = {
        designId: session.hostDesignId,
        sessionId: session.sessionId,
        sequence: head.sequence,
        commitHash: head.commitHash,
        pendingOperationIds: session.controller?.fork?.pendingOperations?.map(operation => operation.opId) || []
      };
      const local = JSON.parse(serializeDocument(state.document));
      void persistLiveReplicaSnapshot(session, local).catch(error => {
        liveStatus('guest', `The accepted host revision could not be recorded in your folder: ${error.message || 'storage error'}`);
        setLiveEditorBlocked(true);
        void session.controller?.close?.();
      });
    }
    const fork = session.controller?.fork;
    liveStatus('guest', fork?.status === 'fork-unsaved'
      ? `Connection ended; local fork could not be saved: ${fork.saveError || 'storage failed'}. Retry the save before continuing.`
      : 'Connected. Edits are saved to your local folder and sent to the owner for durable approval.');
    return;
  }
  await ensureLiveReplicaDesign(session);
  const localSnapshot = JSON.parse(JSON.stringify(hostSnapshot));
  localSnapshot.id = session.localDesignId;
  localSnapshot.settings ||= { unit: 'px', grid: 8, snap: true };
  if (hostHead?.commitHash) {
    session.hostHead = { sequence: hostHead.sequence, commitHash: hostHead.commitHash };
    localSnapshot.settings.collaborationSource = {
      designId: session.hostDesignId,
      sessionId: session.sessionId,
      sequence: hostHead.sequence,
      commitHash: hostHead.commitHash,
      pendingOperationIds: []
    };
  }
  await persistLiveReplicaSnapshot(session, localSnapshot);
  state.imageExportAbortController?.abort();
  releaseImageRuntimeForDocumentSwitch();
  state.document = parseDocument(localSnapshot);
  state.workspaceHead = session.localHead;
  state.liveReplicaHead = session.localHead;
  state.documentStorageRevision = (await loadDocumentRecordById(localSnapshot.id))?.revision ?? null;
  state.documentSaveConflict = null;
  state.pendingRecipeRecovery = await recipeRecoveryForDocument(localSnapshot.id);
  state.selectedIds = [];
  history.undoStack.length = history.redoStack.length = 0;
  session.replicaReady = true;
  renderUI();
  await refreshLocalFontAssets({ showFailureToast: true });
  await restoreImageAssets(++state.documentGeneration);
  setLiveEditorBlocked(false);
  if (state.pendingRecipeRecovery) setDocumentEditingBlocked(true);
  setSaveState('saved', 'Local shared copy saved');
  liveStatus('guest', 'Connected. Edits are saved to your local folder and sent to the owner for durable approval.');
  $('#live-stop-guest').hidden = false;
  renderer?.invalidate();
}

async function startLiveGuest() {
  const existing = state.liveCollaboration;
  if (existing?.role === 'guest' && !liveTerminal(existing.status)) { openLiveDialog('guest'); return; }
  let session = null;
  try {
    const invite = invitationFromText($('#live-join-invite').value);
    const offerCapsule = $('#live-join-offer').value.trim();
    if (!offerCapsule) throw new Error('Paste the owner’s one-time offer first.');
    await prepareLiveWorkspace();
    if (!(await persistCurrentDocumentNow())) throw new Error('Save the current design before joining a live session.');
    const localSeed = createDocument();
    session = {
      role: 'guest', status: 'preparing-answer', controller: null, hostDesignId: invite.designId,
      localDesignId: localSeed.id, localHead: null, replicaReady: false, hostRevision: null,
      createPromise: null, sessionId: null, hostHead: null
    };
    state.liveCollaboration = session;
    state.liveReplicaDesignId = session.localDesignId;
    state.liveReplicaHead = null;
    setLiveEditorBlocked(true);
    liveStatus('guest', 'Verifying the signed offer and creating a private peer connection…');
    const controller = await createGuestSessionController({
      expectedInvite: invite,
      offerCapsule,
      iceServers: liveIceServers('guest'),
      onState: status => {
        session.status = status;
        const copy = {
          'preparing-answer': 'Preparing your answer capsule…', 'answer-ready': 'Answer ready. Send it to the owner through the same trusted channel.',
          'authenticating': 'Answer sent. Authenticating the owner and receiving the current design…',
          'connected': 'Connected. Your local copy is saved in the chosen folder.',
          'pending': 'Your local copy is safe; the owner is saving this edit…',
          'fork-saved': 'The owner is unavailable or the session diverged. Your work is saved as a local fork.',
          'fork-unsaved': 'The connection ended, but the local fork needs a storage retry.',
          'disconnected-before-snapshot': 'The connection ended before the design arrived. No edits were made.',
          'failed': 'The live session failed before it could finish connecting.', 'closed': 'Live session closed.'
        };
        liveStatus('guest', copy[status] || `Live session: ${status}.`);
        $('#live-retry-fork').hidden = status !== 'fork-unsaved';
        if (status === 'fork-unsaved') setLiveEditorBlocked(true);
        else if (session.replicaReady && ['connected', 'pending', 'fork-saved'].includes(status)) setLiveEditorBlocked(status === 'pending');
        else if (liveTerminal(status)) setLiveEditorBlocked(false);
        if (session.replicaReady && status === 'connected') setSaveState('saved', 'Owner saved changes');
      },
      onSnapshot: (snapshot, revision, hostHead) => {
        session.hostRevision = revision;
        session.hostHead = hostHead || session.hostHead;
        void installLiveReplicaSnapshot(session, snapshot, hostHead).catch(error => {
          liveStatus('guest', `Could not save the shared design to this folder: ${error.message || 'storage error'}`);
          showToast(error.message || 'Could not save the shared design to this folder.');
          void controller.close();
        });
      },
      onAsset: async asset => {
        try {
          await ensureLiveReplicaDesign(session);
          if (asset.assetKind === 'image') {
            await saveWorkspaceImageAsset(state.workspace, session.localDesignId, asset.assetId, asset.bytes, { mimeType: asset.mimeType });
            workspaceIdCache(state.workspaceVerifiedImageIds, session.localDesignId).add(asset.assetId);
          } else {
            if (!asset.fontMetadata) throw new Error('The owner sent a font without its required metadata.');
            const candidate = validateLocalFontAsset({
              id: asset.assetId, name: asset.fontMetadata.name, type: asset.mimeType,
              family: asset.fontMetadata.family, weight: asset.fontMetadata.weight,
              style: asset.fontMetadata.style, bytes: asset.bytes
            });
            await saveWorkspaceFontAsset(state.workspace, session.localDesignId, candidate);
            workspaceIdCache(state.workspaceVerifiedFontIds, session.localDesignId).add(asset.assetId);
          }
        } finally { asset.bytes.fill(0); }
      },
      approveIncomingAsset: async asset => globalThis.confirm?.(`Accept this ${asset.assetKind} from the design owner?\n\n${asset.assetId} · ${Math.ceil(asset.byteLength / 1024)} KB${asset.fontMetadata ? `\n${asset.fontMetadata.family} ${asset.fontMetadata.weight} ${asset.fontMetadata.style}` : ''}\n\nIt will be stored in your selected workspace folder.`) === true,
      persistFork: async fork => {
        // Edits are already checkpointed locally before each proposal. Persist the
        // latest canvas snapshot again at disconnect so a quota/permission error
        // remains visible and can be retried from the live-session panel.
        await state.saveChain.catch(() => {});
        if (!session.replicaReady) return false;
        const snapshot = JSON.parse(serializeDocument(state.document));
        snapshot.id = session.localDesignId;
        snapshot.name = `${snapshot.name || 'Shared design'} (local fork)`;
        const saved = await persistLiveReplicaSnapshot(session, snapshot);
        session.forkPayload = fork;
        session.localHead = saved.head;
        return true;
      },
      onFork: result => {
        session.status = result.status;
        $('#live-retry-fork').hidden = result.status !== 'fork-unsaved';
        $('#live-stop-guest').hidden = result.status === 'fork-saved';
        if (result.status === 'fork-saved') {
          state.document.name = `${state.document.name.replace(/ \(local fork\)$/u, '')} (local fork)`;
          setLiveEditorBlocked(false);
          setSaveState('saved', 'Local fork saved');
          renderUI();
          showToast('The live session ended. Your design and pending edits are saved in your folder as a local fork.', 6000);
        } else if (result.status === 'fork-unsaved') {
          setLiveEditorBlocked(true);
          showToast(`Your local fork could not be saved: ${result.saveError || 'storage unavailable'}. Retry the save before editing.`, 8000);
        } else if (result.status === 'disconnected-before-snapshot') {
          setLiveEditorBlocked(false);
        }
      },
      onAssetTransfer: result => {
        const field = $('#live-guest-transfer-status');
        field.textContent = result.phase === 'received'
          ? `Received ${result.count} item${result.count === 1 ? '' : 's'} · ${Math.ceil(result.totalBytes / (1024 * 1024))} MiB`
          : `Sent ${result.assetKind || 'asset'} · ${Math.ceil(result.byteLength / 1024)} KB`;
      }
    });
    session.controller = controller;
    session.sessionId = controller.sessionId;
    $('#live-guest-answer').value = controller.answerCapsule;
    $('#live-copy-answer').hidden = false;
    $('#live-stop-guest').hidden = false;
    liveStatus('guest', 'Answer ready. Send it to the owner; the session offer expires after a few minutes.');
    controller.ready.then(() => liveStatus('guest', 'Connected to the owner. Verifying the snapshot and saving a local copy…'))
      .catch(error => liveStatus('guest', error.message || 'Could not connect to the owner.'));
  } catch (error) {
    if (session && !session.controller) state.liveCollaboration = null;
    if (!session?.replicaReady) setLiveEditorBlocked(false);
    liveStatus('guest', error.message || 'Could not join the live session.');
    showToast(error.message || 'Could not join the live session.');
  }
}

async function stopLiveHost() {
  const session = state.liveCollaboration;
  if (session?.role !== 'host' || !session.controller) return;
  $('#live-stop-host').disabled = true;
  try {
    await session.controller.revoke();
    session.status = 'revoked';
    liveStatus('host', 'Sharing stopped and the stable invitation was revoked.');
    setLiveEditorBlocked(false);
    $('#live-collaboration-dialog').close('revoked');
  } catch (error) { liveStatus('host', error.message || 'Could not revoke this invitation.'); }
  finally { $('#live-stop-host').disabled = false; }
}

async function stopLiveGuest() {
  const session = state.liveCollaboration;
  if (session?.role !== 'guest' || !session.controller) return;
  $('#live-stop-guest').disabled = true;
  try { session.controller.close(); }
  catch (error) { liveStatus('guest', error.message || 'Could not leave the live session.'); }
  finally { $('#live-stop-guest').disabled = false; }
}

function startJoinFromStableLink() {
  const hash = location.hash;
  if (!hash.startsWith('#tisd1.')) return false;
  $('#live-join-invite').value = `${location.origin}${location.pathname}${location.search}${hash}`;
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  openLiveDialog('guest');
  liveStatus('guest', 'Invitation loaded. Paste the owner’s fresh session offer to continue.');
  return true;
}
function toggleLayoutGuides() { state.showLayoutGuides = !state.showLayoutGuides; renderer.invalidate(); }
function toggleOutlineMode() {
  state.outlineMode = !state.outlineMode;
  const button = $('#outline-mode');
  button.classList.toggle('is-active', state.outlineMode);
  button.setAttribute('aria-pressed', String(state.outlineMode));
  button.title = state.outlineMode ? 'Exit outline view' : 'Show outline view';
  renderer.invalidate();
}

function deleteSelected() {
  const ids = rootSelectedIds(); if (!ids.length) return;
  checkpoint('Delete layers');
  for (const id of ids) removeNode(state.document, id);
  clearPrototypeConnectPromptIfSourceMissing();
  reconcileImagePreviewRuntime();
  state.selectedIds = []; clearVectorAnchorSelection(); renderUI(); queueSave();
}
function copySelected() {
  const entries = orderedRootSelectedEntries();
  if (!entries.length) { showToast('Select one or more layers to copy.'); return; }
  try {
    state.clipboard = createLayerClipboard(state.document, entries, { mode: 'copy', pageId: activePage().id });
    reconcileImageAssetRuntime();
    showToast(`Copied ${entries.length} layer${entries.length === 1 ? '' : 's'}.`);
  } catch (error) { showToast(error.message || 'Could not copy these layers.'); }
}
function propertyClipboardShortcut(key) {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad/i.test(platform) ? `⌥⌘${key.toUpperCase()}` : `Ctrl+Alt+${key.toUpperCase()}`;
}
function effectiveAppearanceSource(node) {
  const source = structuredClone(node);
  source.opacity = getNodePropertyValue(state.document, node, 'opacity') ?? node.opacity;
  if (node.variableBindings?.radius) source.radius = getNodePropertyValue(state.document, node, 'radius');
  for (const property of ['fontSize', 'lineHeight', 'letterSpacing']) {
    if (node.variableBindings?.[property]) source[property] = getNodePropertyValue(state.document, node, property);
  }
  if (node.type === 'text' && (node.textVariableId || node.textStyleId)) source.color = getNodeColor(state.document, node, 'text');
  if (node.fillVariableId || node.fillStyleId) {
    const fills = fillStackForNode(source);
    if (fills[0]?.type === 'solid') {
      fills[0].color = getNodeColor(state.document, node, 'fill');
      source.fills = fills;
      syncLegacyFillFields(source);
    }
  }
  if (node.strokeVariableId) {
    const strokes = strokeStackForNode(source);
    if (strokes[0]) {
      strokes[0].color = getNodeColor(state.document, node, 'stroke');
      source.strokes = strokes;
      syncLegacyStrokeFields(source);
    }
  }
  return source;
}
function copyAppearanceFrom(nodeId = null) {
  const node = nodeId ? findNode(state.document, nodeId)?.node : selectedNodes()[0];
  if (!node || node.type === 'slice' || (!nodeId && selectedNodes().length !== 1)) {
    showToast('Select one editable layer to copy its properties.');
    return;
  }
  try {
    state.appearanceClipboard = snapshotAppearance(effectiveAppearanceSource(node));
    showToast(`Copied properties from “${node.name}”.`);
  } catch (error) {
    state.appearanceClipboard = null;
    showToast(error.message || 'Could not copy these properties.');
  }
}
function appearanceTargetEntries() {
  return selectedEntries().filter(entry => entry.node.type !== 'slice'
    && !entry.node.locked && !entry.parents.some(parent => parent.locked));
}
function pasteAppearanceToSelection() {
  if (!state.appearanceClipboard) { showToast('Copy properties from a layer first.'); return; }
  if (state.documentTransitioning || state.pendingRecipeRecovery || state.localPackageBuilding
    || state.presenting || isImageRecipeBatchActive(state.bulk) || state.interaction) {
    showToast('Finish the current editor action before pasting properties.');
    return;
  }
  const entries = appearanceTargetEntries();
  if (!entries.length) { showToast('Select at least one unlocked layer to paste properties.'); return; }
  try {
    const results = entries.map(entry => ({ entry, result: applyAppearance(entry.node, state.appearanceClipboard) }))
      .filter(({ result }) => result.hasChanges)
      .sort((left, right) => left.entry.depth - right.entry.depth);
    if (!results.length) {
      showToast('The selected layers already have these properties or do not support the copied appearance.');
      return;
    }
    checkpoint('Paste properties');
    const parentsToLayout = new Set();
    for (const { entry, result } of results) {
      const liveEntry = findNode(state.document, entry.node.id);
      const list = liveEntry?.parent ? liveEntry.parent.children : activePage()?.children;
      if (!liveEntry || !list || list[liveEntry.index] !== liveEntry.node) continue;
      list[liveEntry.index] = result.node;
      const changed = new Set(result.changedFamilies);
      const componentProperties = new Set();
      if (changed.has('opacity')) componentProperties.add('opacity');
      if (changed.has('blendMode')) componentProperties.add('blendMode');
      if (changed.has('fills')) {
        for (const property of ['fill', 'fills', 'fillOpacity', 'fillGradient', 'imageFill', 'fillStyleId', 'fillVariableId']) componentProperties.add(property);
      }
      if (changed.has('strokes')) {
        for (const property of ['stroke', 'strokes', 'strokeWidth', 'strokeOpacity', 'strokeCap', 'strokeJoin', 'strokePattern', 'strokeMiterLimit', 'strokeVariableId']) componentProperties.add(property);
      }
      if (changed.has('effects')) componentProperties.add('effects');
      if (changed.has('radii')) {
        componentProperties.add('radius'); componentProperties.add('cornerRadii');
      }
      if (changed.has('textStyle')) {
        for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'firstLineIndent', 'listSpacing', 'color', 'align', 'verticalAlign', 'textCase', 'textDecoration', 'textStyleId', 'textVariableId']) componentProperties.add(property);
        if (resizeTextNode(result.node)) {
          componentProperties.add('width'); componentProperties.add('height');
          if (entry.parent?.autoLayout) parentsToLayout.add(entry.parent.id);
        }
      }
      if (JSON.stringify(entry.node.variableBindings || null) !== JSON.stringify(result.node.variableBindings || null)) componentProperties.add('variableBindings');
      recordNodeComponentOverrides(result.node, [...componentProperties]);
    }
    for (const parentId of parentsToLayout) {
      const parent = findNode(state.document, parentId)?.node;
      if (parent) applyAutoLayout(parent);
    }
    renderUI(); queueSave(); renderer.invalidate();
    const skipped = entries.length - results.length;
    showToast(`Pasted properties to ${results.length} layer${results.length === 1 ? '' : 's'}${skipped ? `; ${skipped} skipped` : ''}.`);
  } catch (error) {
    showToast(error.message || 'Could not paste these properties.');
  }
}
function cutSelected() {
  const entries = orderedRootSelectedEntries();
  if (!entries.length) { showToast('Select one or more layers to cut.'); return; }
  let containsMainComponent = false;
  for (const entry of entries) walkNodes([entry.node], ({ node }) => { if (node.isComponent) containsMainComponent = true; });
  if (containsMainComponent || entries.some(entry => entry.parents.some(parent => parent.isInstance))) {
    showToast('Cut the whole component instance, or duplicate a main component before moving it.');
    return;
  }
  try {
    const clipboard = createLayerClipboard(state.document, entries, { mode: 'cut', pageId: activePage().id });
    const nextDocument = cloneDocument(state.document);
    for (const entry of entries) if (!removeNode(nextDocument, entry.node.id, activePage().id)) throw new Error('One of the selected layers no longer exists.');
    validateDocument(nextDocument);
    checkpoint('Cut layers');
    state.document = nextDocument;
    clearPrototypeConnectPromptIfSourceMissing();
    reconcileImagePreviewRuntime();
    state.clipboard = clipboard;
    reconcileImageAssetRuntime();
    state.selectedIds = []; clearVectorAnchorSelection();
    renderUI(); queueSave();
    showToast(`Cut ${entries.length} layer${entries.length === 1 ? '' : 's'}. Paste to move them back into this design.`);
  } catch (error) { showToast(error.message || 'Could not cut these layers.'); }
}
function pasteSelectedLayers({ duplicate = false } = {}) {
  try {
    const clipboard = duplicate
      ? (() => { const entries = orderedRootSelectedEntries(); return entries.length ? createLayerClipboard(state.document, entries, { mode: 'copy', pageId: activePage().id }) : null; })()
      : state.clipboard;
    if (!clipboard) { showToast(duplicate ? 'Select one or more layers to duplicate.' : 'Copy or cut layers before pasting.'); return; }
    const result = pasteLayerClipboard(state.document, clipboard, { pageId: activePage().id });
    if (!result.nodes.length) return;
    checkpoint(duplicate ? 'Duplicate layers' : clipboard.mode === 'cut' ? 'Move cut layers' : 'Paste layers');
    state.document = result.document;
    if (!duplicate && state.clipboard === clipboard) {
      if (clipboard.mode === 'cut') state.clipboard = [];
      else clipboard.pasteCount = result.pasteCount;
    }
    reconcileImageAssetRuntime();
    setSelection(result.nodes.map(node => node.id));
    renderUI(); queueSave();
    showToast(duplicate ? `Duplicated ${result.nodes.length} layer${result.nodes.length === 1 ? '' : 's'}.` : `Pasted ${result.nodes.length} layer${result.nodes.length === 1 ? '' : 's'}.`);
  } catch (error) { showToast(error.message || 'Could not paste these layers.'); }
}
function onDocumentPaste(event) {
  const target = event.target;
  const isEditingText = Boolean(target?.matches?.('input, textarea, select, [contenteditable="true"]'));
  routeClipboardPaste(event, {
    canEdit: !state.documentTransitioning && !state.presenting && !document.querySelector('dialog[open]'),
    isEditingText,
    hasLayerClipboard: hasClipboardLayers(),
    importImages: files => { void importImageFiles(files); },
    pasteLayers: () => pasteSelectedLayers(),
  });
}
function duplicateSelected() {
  pasteSelectedLayers({ duplicate: true });
}
function renameSelected() {
  const node = selectedNodes()[0]; if (!node) return;
  const name = prompt('Rename layer', node.name); if (name == null) return;
  checkpoint('Rename layer'); node.name = name.trim() || node.name;
  const instanceRoot = componentInstanceRoot(node.id);
  if (instanceRoot) {
    if (instanceRoot.id === node.id) instanceRoot.componentNameIsInherited = false;
    recordComponentOverride(instanceRoot, node, 'name');
  }
  if (node.isComponent) {
    const component = state.document.components?.find(item => item.id === node.componentId);
    if (component) component.name = node.name;
  }
  renderUI(); queueSave();
}
function combineSelectedComponents() {
  const selected = selectedNodes();
  if (selected.length < 2 || selected.some(node => !node.isComponent)) { showToast('Select at least two main components to combine as variants.'); return; }
  const commonName = selected.map(node => state.document.components.find(item => item.id === node.componentId)?.name || node.name);
  const prefix = commonName[0].split('/')[0].trim();
  const name = prompt('Component set name', commonName.every(value => value.split('/')[0].trim() === prefix) ? prefix : 'Component set');
  if (name == null) return;
  try {
    checkpoint('Combine components as variants');
    const set = createComponentSet(state.document, selected.map(node => node.componentId), name);
    renderUI(); queueSave(); showToast(`Component set “${set.name}” created with ${set.componentIds.length} variants.`);
  } catch (error) { showToast(error.message); }
}
function changeInstanceVariant(instanceId, propertyName, value) {
  const instance = findNode(state.document, instanceId)?.node;
  const component = instance?.isInstance && state.document.components.find(item => item.id === instance.componentId);
  const set = component && state.document.componentSets?.find(item => item.id === component.componentSetId);
  if (!instance || !component || !set) return;
  const candidate = set.componentIds.map(id => state.document.components.find(item => item.id === id)).find(item =>
    item.variantProperties?.[propertyName] === value && set.properties.every(property => property.name === propertyName || item.variantProperties?.[property.name] === component.variantProperties?.[property.name])
  );
  if (!candidate) { showToast('That variant combination is not available.'); renderInspector(); return; }
  try {
    checkpoint(`Change ${set.name} ${propertyName}`);
    switchComponentInstanceVariant(state.document, instanceId, candidate.id);
    renderUI(); queueSave(); showToast(`${set.name} switched to ${value}.`);
  } catch (error) { showToast(error.message); renderInspector(); }
}
function changeInstanceComponentProperty(instanceId, propertyId, value) {
  const instance = findNode(state.document, instanceId)?.node;
  const property = instance?.isInstance
    ? state.document.components?.find(item => item.id === instance.componentId)?.componentProperties?.find(item => item.id === propertyId)
    : null;
  if (!instance || !property) return;
  try {
    checkpoint(`Change component property ${property.name}`);
    setComponentPropertyValue(state.document, instanceId, propertyId, value);
    renderUI(); queueSave(); renderer.invalidate();
  } catch (error) {
    showToast(error.message || `Could not update ${property.name}.`);
    renderInspector();
  }
}
function addComponentProperty(componentId, targetNodeId, type) {
  const name = $('#component-property-name')?.value.trim();
  if (!name) { showToast('Enter a name for this component property.'); $('#component-property-name')?.focus(); return; }
  try {
    checkpoint(`Add component property ${name}`);
    const property = createComponentProperty(state.document, componentId, { name, type, targetNodeId });
    syncComponentInstances(state.document, componentId);
    state.componentPropertyTargetId = targetNodeId;
    state.componentPropertyType = type;
    renderUI(); queueSave(); renderer.invalidate(); showToast(`${property.name} is ready on component instances.`);
  } catch (error) {
    showToast(error.message || 'Could not add this component property.');
  }
}
function componentSlotCandidateEntries(instanceId, pageId = state.document.activePageId) {
  const page = state.document.pages?.find(item => item.id === pageId);
  const instanceEntry = findNode(state.document, instanceId, pageId);
  if (!page || !instanceEntry) return [];
  const excludedIds = new Set([instanceId, ...instanceEntry.parents.map(parent => parent.id)]);
  const containingMainComponent = new Set();
  walkNodes(page.children || [], ({ node, parents }) => {
    if (!node.isComponent) return;
    containingMainComponent.add(node.id);
    for (const parent of parents) containingMainComponent.add(parent.id);
  });
  const rows = [];
  walkNodes(page.children || [], entry => {
    const { node, parents } = entry;
    if (node.type === 'slice' || excludedIds.has(node.id) || containingMainComponent.has(node.id) || parents.some(parent => parent.id === instanceId)) return;
    rows.push(entry);
  });
  return rows;
}
function renderComponentSlotCandidateList() {
  const dialogState = state.componentSlotDialog;
  if (!dialogState) return;
  const list = $('#component-slot-candidates');
  const query = dialogState.query.trim().toLocaleLowerCase();
  const matches = dialogState.entries.filter(({ node, parents }) => {
    const label = `${node.name || ''} ${node.type} ${parents.map(parent => parent.name || '').join(' ')}`.toLocaleLowerCase();
    return !query || label.includes(query);
  });
  const visible = matches.slice(0, 250);
  $('#component-slot-count').textContent = matches.length > visible.length
    ? `${matches.length.toLocaleString()} matches · showing the first ${visible.length}. Search to narrow the list.`
    : `${matches.length.toLocaleString()} layer${matches.length === 1 ? '' : 's'} available`;
  if (!visible.length) {
    list.innerHTML = '<div class="slot-picker-empty">No matching layers on this page.</div>';
    return;
  }
  list.innerHTML = visible.map(({ node, parents }) => {
    const checked = dialogState.selectedIds.has(node.id);
    const trail = [...parents.map(parent => parent.name), node.name].filter(Boolean).join(' / ');
    return `<label class="slot-picker-row" title="${escapeHtml(trail)}"><input type="checkbox" data-slot-candidate="${escapeHtml(node.id)}"${checked ? ' checked' : ''}/><span class="slot-picker-name">${escapeHtml(node.name || node.type)}</span><small>${escapeHtml(node.type)}</small></label>`;
  }).join('');
}
function openComponentSlotDialog(instanceId, propertyId) {
  const instance = findNode(state.document, instanceId)?.node;
  const component = instance?.isInstance && state.document.components?.find(item => item.id === instance.componentId);
  const property = component?.componentProperties?.find(item => item.id === propertyId && item.type === 'SLOT');
  if (!instance || !property) { showToast('This component slot is no longer available.'); return; }
  const entry = findNode(state.document, instanceId);
  const excludedIds = new Set([instanceId, ...(entry?.parents || []).map(parent => parent.id)]);
  const selectedIds = new Set(state.selectedIds.filter(id => {
    const selected = findNode(state.document, id);
    return selected && !excludedIds.has(id) && !selected.parents.some(parent => parent.id === instanceId);
  }));
  state.componentSlotDialog = {
    instanceId, propertyId, pageId: state.document.activePageId,
    selectedIds, query: '', entries: componentSlotCandidateEntries(instanceId)
  };
  $('#component-slot-dialog-title').textContent = `Choose ${property.name} content`;
  $('#component-slot-search').value = '';
  renderComponentSlotCandidateList();
  $('#component-slot-dialog').showModal();
  $('#component-slot-search').focus();
}
function applyComponentSlotDialog(dialogState = state.componentSlotDialog) {
  if (!dialogState) return;
  const selectedSet = dialogState.selectedIds;
  const selectedEntries = dialogState.entries.filter(entry => selectedSet.has(entry.node.id));
  const selectedRootEntries = selectedEntries.filter(entry => !entry.parents.some(parent => selectedSet.has(parent.id)));
  const nodes = selectedRootEntries.map(entry => entry.node);
  try {
    checkpoint('Set component slot content');
    const installed = setComponentSlotContent(state.document, dialogState.instanceId, dialogState.propertyId, nodes, dialogState.pageId);
    if (installed === false) throw new Error('This component slot is no longer available.');
    setSelection(installed.map(node => node.id));
    queueSave(); renderUI();
    showToast(nodes.length ? `Added ${nodes.length} layer${nodes.length === 1 ? '' : 's'} to the component slot.` : 'Component slot content cleared.');
  } catch (error) {
    showToast(error.message || 'Could not update this component slot.');
    renderInspector();
  }
}
function resetComponentSlot(instanceId, propertyId) {
  try {
    checkpoint('Reset component slot');
    if (!resetComponentSlotContent(state.document, instanceId, propertyId)) throw new Error('This component slot is no longer available.');
    setSelection([instanceId]);
    queueSave(); renderUI(); renderer.invalidate();
    showToast('Component slot restored to its default content.');
  } catch (error) { showToast(error.message || 'Could not reset this component slot.'); }
}
function changeMainVariantProperty(componentId, propertyName, value) {
  try {
    checkpoint(`Rename ${propertyName} variant`);
    setComponentVariantProperty(state.document, componentId, propertyName, value);
    renderUI(); queueSave(); showToast(`${propertyName} variant updated.`);
  } catch (error) { showToast(error.message); renderUI(); }
}
function editComponentSet(label, operation, successMessage = 'Component set updated.') {
  try {
    const nextDocument = cloneDocument(state.document);
    operation(nextDocument);
    validateDocument(nextDocument);
    checkpoint(label);
    state.document = nextDocument;
    renderUI(); queueSave(); renderer.invalidate();
    showToast(successMessage);
    return true;
  } catch (error) {
    showToast(error.message || 'Could not update this component set.');
    renderUI();
    return false;
  }
}
async function refreshLocalComponentLibraries({ refreshInspector = true } = {}) {
  const summaries = await listComponentLibraries();
  const libraries = await Promise.all(summaries.map(async summary => {
    try { return { ...summary, library: await loadComponentLibrary(summary.id) }; }
    catch (error) { console.warn(`Could not load local library “${summary.name}”`, error); return { ...summary, library: null }; }
  }));
  state.componentLibraries = libraries.filter(item => item.library);
  if (!state.componentLibraries.some(item => item.id === state.componentLibraryTargetId)) {
    state.componentLibraryTargetId = state.componentLibraries[0]?.id || null;
  }
  renderAssetsTab();
  if (refreshInspector) renderInspector();
  return state.componentLibraries;
}
async function createLocalComponentLibrary(name = null) {
  const value = name ?? prompt('Name this on-device component library', 'My components');
  if (value == null) return null;
  const library = createComponentLibrary({ id: createId('library'), name: value });
  await saveComponentLibrary(library);
  await refreshLocalComponentLibraries();
  showToast(`Local library “${library.name}” created on this device.`);
  return library;
}
async function resolveLocalComponentLibrary(id) {
  if (id) {
    const cached = state.componentLibraries.find(item => item.id === id)?.library;
    const library = cached || await loadComponentLibrary(id);
    if (!library) throw new Error('This local component library is no longer available.');
    return library;
  }
  return createLocalComponentLibrary();
}
async function publishComponentToLocalLibrary({ componentId = null, instanceId = null, libraryId = null } = {}) {
  const linkedRoot = instanceId ? findNode(state.document, instanceId)?.node : null;
  const isLinked = isLocalLinkedComponent(linkedRoot);
  if (instanceId && !isLinked) throw new Error('This linked component is no longer available.');
  const component = componentId ? state.document.components?.find(item => item.id === componentId) : null;
  const sourceRoot = isLinked ? linkedRoot : component && findNodeAcrossPages(state.document, component.rootNodeId)?.node;
  if (!sourceRoot || (!isLinked && !sourceRoot.isComponent)) throw new Error('Select a main component to publish to a local library.');
  const targetId = isLinked ? linkedRoot.linkedComponent.libraryId
    : libraryId || $('#component-library-target')?.value || state.componentLibraryTargetId || '';
  const library = await resolveLocalComponentLibrary(targetId);
  if (!library) return;
  const refs = sourceRoot.publishedLibraryRefs || [];
  const componentLibraryId = isLinked
    ? linkedRoot.linkedComponent.componentId
    : refs.find(ref => ref.libraryId === library.id)?.componentId || createId('library-component');
  const root = componentTreeForPublication(sourceRoot, { useSourceIds: isLinked, document: state.document });
  const name = isLinked ? sourceRoot.linkedComponent.sourceSnapshot.name : component?.name || sourceRoot.name;
  const publicationSource = isLinked ? sourceRoot.linkedComponent.sourceSnapshot : component;
  const result = await publishStoredComponent(library.id, {
    componentId: componentLibraryId,
    name,
    root,
    componentSetId: publicationSource?.componentSetId ?? null,
    variantProperties: publicationSource?.variantProperties ?? null,
    componentProperties: publicationSource?.componentProperties || []
  });

  checkpoint(isLinked ? 'Publish local component revision' : 'Publish component to local library');
  if (isLinked) {
    const linked = createLinkedInstanceSnapshot(result.library, componentLibraryId, { instanceId: sourceRoot.linkedComponent.id });
    applyLinkedComponentUpdate(sourceRoot, linked, { document: state.document });
  } else {
    const nextRefs = refs.filter(ref => ref.libraryId !== library.id);
    sourceRoot.publishedLibraryRefs = [...nextRefs, { libraryId: library.id, componentId: componentLibraryId }];
  }
  await refreshLocalComponentLibraries();
  renderUI(); queueSave(); renderer.invalidate();
  showToast(`“${name}” published to ${library.name} as revision ${result.publication.revision}.`);
}
async function placeLocalLibraryComponent(libraryId, componentId) {
  const library = await resolveLocalComponentLibrary(libraryId);
  const component = library.components.find(item => item.id === componentId);
  if (!component) throw new Error('This library component is no longer available.');
  const x = (canvas.clientWidth / 2 - state.panX) / state.zoom;
  const y = (canvas.clientHeight / 2 - state.panY) / state.zoom;
  const snapshot = createLinkedInstanceSnapshot(library, componentId, { instanceId: createId('linked-instance') });
  const instance = createLinkedEditorInstance(snapshot, { x, y, document: state.document });
  checkpoint('Place local library component');
  addNode(state.document, instance, { pageId: activePage().id });
  setSelection([instance.id]); renderUI(); queueSave(); renderer.invalidate();
  showToast(`“${snapshot.sourceSnapshot.name}” placed as a linked component.`);
}
async function updateLocalComponentInstance(instanceId) {
  const root = findNode(state.document, instanceId)?.node;
  if (!isLocalLinkedComponent(root)) throw new Error('This linked component is no longer available.');
  const library = await loadComponentLibrary(root.linkedComponent.libraryId);
  if (!library) throw new Error('The local library is unavailable. This instance still keeps its published snapshot.');
  const update = updateLinkedInstanceSnapshot(root.linkedComponent, library);
  checkpoint('Update local component instance');
  applyLinkedComponentUpdate(root, update.instance, { document: state.document });
  renderUI(); queueSave(); renderer.invalidate();
  const dropped = update.report.droppedOverrides.length;
  showToast(dropped
    ? `Updated to revision ${update.report.toRevision}; ${dropped} incompatible override${dropped === 1 ? ' was' : 's were'} removed.`
    : `Updated to revision ${update.report.toRevision}; compatible edits were preserved.`);
}
function detachLocalComponentInstance(instanceId) {
  const root = findNode(state.document, instanceId)?.node;
  if (!isLocalLinkedComponent(root)) { showToast('This linked component is no longer available.'); return; }
  checkpoint('Detach local component');
  walkNodes([root], ({ node }) => { delete node.componentSourceId; delete node.componentSourceKey; });
  delete root.linkedComponent;
  renderUI(); queueSave(); renderer.invalidate();
  showToast('Library link removed. The layers remain editable in this design.');
}
function makeComponent(nodeId = selectedNodes()[0]?.id) {
  const node = nodeId ? findNode(state.document, nodeId)?.node : null;
  if (!node) { showToast('Select a layer to create a component.'); return; }
  if (node.type === 'slice') { showToast('Slices are export regions and cannot become components.'); return; }
  if (componentInstanceRoot(node.id)) { showToast('Detach this instance before creating a component.'); return; }
  if (node.isComponent) { showToast('This layer is already a main component.'); return; }
  const name = prompt('Component name', node.name);
  if (name == null) return;
  try {
    checkpoint('Create component');
    const component = createComponent(state.document, node.id, name);
    renderUI(); queueSave(); showToast(`Component “${component.name}” created.`);
  } catch (error) { showToast(error.message); }
}
function createInstanceAt(componentId, position = null) {
  if (!componentId) return;
  const x = position?.x ?? (canvas.clientWidth / 2 - state.panX) / state.zoom;
  const y = position?.y ?? (canvas.clientHeight / 2 - state.panY) / state.zoom;
  try {
    checkpoint('Create component instance');
    const instance = createComponentInstance(state.document, componentId, { pageId: activePage().id, x, y });
    setSelection([instance.id]); renderUI(); queueSave();
    showToast('Component instance added to this page.');
  } catch (error) { showToast(error.message); }
}
function detachInstance(nodeId = selectedNodes()[0]?.id) {
  const linkedRoot = nodeId ? componentInstanceRoot(nodeId) : null;
  const rootId = linkedRoot?.id || nodeId;
  if (!rootId || !findNode(state.document, rootId)?.node.isInstance) { showToast('Select a component instance to detach.'); return; }
  checkpoint('Detach component instance');
  detachComponentInstance(state.document, rootId);
  renderUI(); queueSave(); showToast('Instance detached. It can now be edited independently.');
}
function reorderSelected(direction) {
  const ids = new Set(rootSelectedIds()); if (!ids.size) return;
  checkpoint(direction === 'front' ? 'Bring layers forward' : 'Send layers backward');
  const page = activePage();
  const reorder = nodes => {
    const chosen = nodes.filter(node => ids.has(node.id));
    const remaining = nodes.filter(node => !ids.has(node.id));
    const next = direction === 'front' ? [...remaining, ...chosen] : [...chosen, ...remaining];
    nodes.splice(0, nodes.length, ...next);
    for (const node of nodes) reorder(node.children || []);
  };
  reorder(page.children); renderUI(); queueSave();
}

function refreshHistoryImagePreviews(previousDocument) {
  for (const reference of imageAssetReferencesAcrossPages()) {
    const { node, fillId = null, previewKey = imagePreviewKey(node.id), assetId, adjustments, transforms } = reference;
    const previousNode = findNode(previousDocument, node.id)?.node;
    const previousSource = fillId
      ? previousNode?.fills?.find(item => item.id === fillId)?.imageFill
      : previousNode?.type === 'image' ? previousNode : previousNode?.imageFill;
    const previousSettings = previousSource
      ? JSON.stringify([previousSource.assetId, previousSource.adjustments || {}, previousSource.transforms || {}])
      : null;
    const currentSettings = JSON.stringify([assetId, adjustments || {}, transforms || {}]);
    if (previousSettings === currentSettings) continue;

    const timer = previewTimers.get(previewKey);
    if (timer) clearTimeout(timer);
    previewTimers.delete(previewKey);
    const asset = state.assets.get(assetId);
    if (!asset?.sourceBytes) {
      releasePreviewResources(previewKey);
      state.imageStatus.set(previewKey, 'Original image missing');
      continue;
    }
    state.imageStatus.set(previewKey, 'Updating preview…');
    renderImagePreview(node.id, assetId, adjustments, transforms, fillId).catch(error => {
      state.imageStatus.set(previewKey, imagePreviewFailureStatus(error));
      showToast(`${node.name}: ${error.message || 'Could not restore the image preview.'}`);
      if (state.selectedIds.includes(node.id)) renderInspector();
    });
  }
}
function undo() {
  if (state.interaction) { showToast('Finish or cancel the current canvas gesture before undoing.'); return; }
  if (isImageRecipeBatchActive(state.bulk)) { showToast('Pause or stop the active image recipe, then wait for its workers to finish before undoing.'); return; }
  const previousDocument = state.document;
  const next = history.undo(previousDocument);
  if (!next) return;
  state.versionSaveLabel = 'Undo';
  state.document = next;
  reconcileImagePreviewRuntime();
  refreshHistoryImagePreviews(previousDocument);
  state.selectedIds = state.selectedIds.filter(id => findNode(state.document, id));
  clearVectorAnchorSelection(); renderUI(); queueSave();
}
function redo() {
  if (state.interaction) { showToast('Finish or cancel the current canvas gesture before redoing.'); return; }
  if (isImageRecipeBatchActive(state.bulk)) { showToast('Pause or stop the active image recipe, then wait for its workers to finish before redoing.'); return; }
  const previousDocument = state.document;
  const next = history.redo(previousDocument);
  if (!next) return;
  state.versionSaveLabel = 'Redo';
  state.document = next;
  reconcileImagePreviewRuntime();
  refreshHistoryImagePreviews(previousDocument);
  state.selectedIds = state.selectedIds.filter(id => findNode(state.document, id));
  clearVectorAnchorSelection(); renderUI(); queueSave();
}
function newDesign() {
  return switchToDocument(createDocument(), { message: 'New local design created.', versionLabel: 'New design' });
}
function addPage() {
  const page = { id: createId('page'), name: `Page ${state.document.pages.length + 1}`, children: [], guides: [] };
  checkpoint('Add page'); state.document.pages.push(page); state.document.activePageId = page.id; state.selectedIds = []; clearVectorAnchorSelection(); state.pendingCommentAnchor = null; state.activeCommentId = null; renderUI(); queueSave();
}
function renamePage(pageId) {
  const page = state.document.pages.find(item => item.id === pageId); if (!page) return;
  const name = prompt('Rename page', page.name); if (name == null || !name.trim()) return;
  checkpoint('Rename page');
  if (!renameManagedPage(state.document, pageId, name)) return;
  renderUI(); queueSave();
}
function managePageAction(action, pageId) {
  const page = state.document.pages.find(item => item.id === pageId);
  if (!page) return;
  if (action === 'rename') { renamePage(pageId); return; }
  if (action === 'duplicate') {
    checkpoint('Duplicate page');
    const copy = duplicateManagedPage(state.document, pageId);
    if (!copy) return;
    state.document.activePageId = copy.id; state.selectedIds = []; clearVectorAnchorSelection();
    state.pendingCommentAnchor = null; state.activeCommentId = null; renderUI(); queueSave();
    showToast(`Duplicated “${page.name}” as “${copy.name}”.`); return;
  }
  if (action === 'delete') {
    if (state.document.pages.length <= 1) { showToast('A design must keep at least one page.'); return; }
    if (!confirm(`Delete “${page.name}” and its contents? This removes links targeting the page.`)) return;
    checkpoint('Delete page');
    if (!deleteManagedPage(state.document, pageId)) return;
    state.selectedIds = []; clearVectorAnchorSelection(); state.pendingCommentAnchor = null; state.activeCommentId = null;
    renderUI(); queueSave(); showToast(`Deleted “${page.name}”.`); return;
  }
  const from = state.document.pages.findIndex(item => item.id === pageId);
  const to = from + (action === 'move-up' ? -1 : action === 'move-down' ? 1 : 0);
  if (to === from || to < 0 || to >= state.document.pages.length) return;
  checkpoint('Reorder pages'); reorderManagedPage(state.document, pageId, to); renderUI(); queueSave();
}

function overlayPositionInFrame(position, frame, overlay) {
  if (position === 'center') return { x: (frame.width - overlay.width) / 2, y: (frame.height - overlay.height) / 2 };
  const xSide = position.endsWith('left') ? 'left' : position.endsWith('right') ? 'right' : 'center';
  const ySide = position.startsWith('top') ? 'top' : position.startsWith('bottom') ? 'bottom' : 'center';
  const gap = 16;
  return {
    x: xSide === 'left' ? gap : xSide === 'right' ? frame.width - overlay.width - gap : (frame.width - overlay.width) / 2,
    y: ySide === 'top' ? gap : ySide === 'bottom' ? frame.height - overlay.height - gap : (frame.height - overlay.height) / 2
  };
}

function isNodeInSubtree(root, nodeId) {
  let found = false;
  walkNodes([root], ({ node }) => { if (node.id === nodeId) found = true; });
  return found;
}

function presentationFrameContentBounds(frame, ancestors = []) {
  const document = presentRenderState?.document;
  const resolvedGeometry = getNodeGeometry(document, frame);
  const geometry = { ...frame, ...resolvedGeometry, x: frame.x, y: frame.y };
  const bounds = { right: geometry.width, bottom: geometry.height };
  const visit = (nodes, parentPath) => {
    for (const child of nodes || []) {
      if (!getNodePropertyValue(document, child, 'visible')) continue;
      const childGeometry = { ...child, ...getNodeGeometry(document, child) };
      const corners = [
        { x: 0, y: 0 }, { x: childGeometry.width, y: 0 },
        { x: childGeometry.width, y: childGeometry.height }, { x: 0, y: childGeometry.height }
      ].map(point => pageToNodeLocal(geometry, nodeLocalToPage(childGeometry, point, parentPath), ancestors));
      bounds.right = Math.max(bounds.right, ...corners.map(point => point.x));
      bounds.bottom = Math.max(bounds.bottom, ...corners.map(point => point.y));
      // A clipping or scrollable child contributes only its own viewport to this frame.
      const childClips = Boolean(child.clip) || (child.type === 'frame' && child.overflowBehavior !== 'none');
      if (!childClips && child.children?.length) visit(child.children, [...parentPath, childGeometry]);
    }
  };
  visit(frame.children, [...ancestors, geometry]);
  return bounds;
}

function presentationScrollLimits(frame, ancestors = []) {
  const behavior = frame?.overflowBehavior || 'none';
  const bounds = presentationFrameContentBounds(frame, ancestors);
  const horizontal = behavior === 'horizontal' || behavior === 'both';
  const vertical = behavior === 'vertical' || behavior === 'both';
  return {
    maxX: horizontal ? Math.max(0, bounds.right - frame.width) : 0,
    maxY: vertical ? Math.max(0, bounds.bottom - frame.height) : 0
  };
}

function presentationScrollableFramesAt(world) {
  const page = presentRenderState?.document?.pages?.[0];
  if (!page) return [];
  return scrollableFramePathAtPagePoint(
    page,
    world,
    (node, point, x, y) => presentRenderer?.hitTestBoolean(node, point, x, y) ?? true,
    presentRenderState.document,
    presentRenderState.presentationScrollOffsets,
    presentRenderState.zoom
  )
    .map(candidate => ({ ...candidate, limits: presentationScrollLimits(candidate.frame, candidate.ancestors) }))
    .filter(candidate => candidate.limits.maxX > 0 || candidate.limits.maxY > 0);
}

function scrollPresentationGesture(event, gesture) {
  if (!gesture?.scrollFramePath?.length || !presentRenderState?.presentationScrollOffsets) return false;
  const world = screenToWorld(event, $('#present-canvas'), presentRenderState);
  const screenDeltaX = event.clientX - gesture.startX;
  const screenDeltaY = event.clientY - gesture.startY;
  if (!gesture.scrollIntent) {
    const intentional = gesture.scrollFramePath.some(candidate => {
      const local = pageToNodeLocal(candidate.frame, world, candidate.ancestors);
      const deltaX = local.x - candidate.local.x;
      const deltaY = local.y - candidate.local.y;
      const behavior = candidate.frame.overflowBehavior;
      return ((behavior === 'horizontal' || behavior === 'both') && candidate.limits.maxX > 0 && Math.abs(deltaX) >= 8)
        || ((behavior === 'vertical' || behavior === 'both') && candidate.limits.maxY > 0 && Math.abs(deltaY) >= 8);
    });
    if (Math.hypot(screenDeltaX, screenDeltaY) < 8 || !intentional) return false;
    gesture.scrollIntent = true;
    gesture.pressInteraction = null;
    gesture.moved = true;
  }

  let remaining = { x: world.x - gesture.lastWorld.x, y: world.y - gesture.lastWorld.y };
  const candidates = gesture.scrollFramePath;
  let changed = false;
  for (const candidate of candidates) {
    const { frame, ancestors, limits } = candidate;
    const localOrigin = pageToNodeLocal(frame, { x: 0, y: 0 }, ancestors);
    const localEnd = pageToNodeLocal(frame, remaining, ancestors);
    const delta = { x: localEnd.x - localOrigin.x, y: localEnd.y - localOrigin.y };
    const current = getPresentationScrollOffset(presentRenderState, frame);
    const requested = {
      x: frame.overflowBehavior === 'horizontal' || frame.overflowBehavior === 'both' ? -delta.x : 0,
      y: frame.overflowBehavior === 'vertical' || frame.overflowBehavior === 'both' ? -delta.y : 0
    };
    const next = {
      x: Math.max(0, Math.min(limits.maxX, current.x + requested.x)),
      y: Math.max(0, Math.min(limits.maxY, current.y + requested.y))
    };
    const consumedLocal = { x: -(next.x - current.x), y: -(next.y - current.y) };
    const leftoverLocal = { x: delta.x - consumedLocal.x, y: delta.y - consumedLocal.y };
    const pageOrigin = nodeLocalToPage(frame, { x: 0, y: 0 }, ancestors);
    const pageEnd = nodeLocalToPage(frame, leftoverLocal, ancestors);
    remaining = { x: pageEnd.x - pageOrigin.x, y: pageEnd.y - pageOrigin.y };
    if (next.x !== current.x || next.y !== current.y) {
      presentRenderState.presentationScrollOffsets.set(frame.id, next);
      changed = true;
    }
  }
  gesture.lastWorld = world;
  gesture.scrolled = true;
  event.preventDefault?.();
  if (changed) renderPresentationFrame();
  return true;
}

function renderPresentationFrame(interaction = null, previousFrame = null, progress = null) {
  if (!state.presenting || !presentRenderState) return;
  const runtimeDocument = presentRuntimeDocument || state.document;
  const target = findNodeAcrossPages(runtimeDocument, state.presenting.frameId);
  if (!target || target.node.type !== 'frame') { showToast('This prototype destination no longer exists.'); $('#present-dialog').close(); return; }
  const applySessionVariableModes = frame => {
    const modes = state.presenting.variableModes || {};
    if (!Object.keys(modes).length) return frame;
    frame.variableModes = { ...(frame.variableModes || {}), ...modes };
    return frame;
  };
  const resolveTransitionRadius = node => node.variableBindings?.radius
    ? resolveVariableValueWithModeOverrides(runtimeDocument, node.variableBindings.radius, state.presenting.variableModes || {}, node)
    : node.radius;
  const displayFrame = applySessionVariableModes(previousFrame && Number.isFinite(progress)
    ? interpolateSmartFrame(previousFrame, target.node, progress, { resolveRadius: resolveTransitionRadius })
    : structuredClone(target.node));
  displayFrame.x = 0; displayFrame.y = 0;
  const sceneChildren = [displayFrame];
  for (const [index, overlayState] of state.presenting.overlays.entries()) {
    const overlayTarget = findNode(runtimeDocument, overlayState.frameId, overlayState.pageId) || findNodeAcrossPages(runtimeDocument, overlayState.frameId);
    if (!overlayTarget || overlayTarget.node.type !== 'frame') continue;
    if (overlayState.background) sceneChildren.push({
      id: `presentation-overlay-backdrop-${index}`, type: 'rectangle', name: 'Overlay background',
      x: 0, y: 0, width: displayFrame.width, height: displayFrame.height, rotation: 0,
      opacity: overlayState.backgroundOpacity, visible: true, fill: overlayState.backgroundColor,
      fillOpacity: 1, stroke: null, strokeWidth: 0, radius: 0, clip: false, children: []
    });
    const displayOverlay = applySessionVariableModes(structuredClone(overlayTarget.node));
    Object.assign(displayOverlay, overlayPositionInFrame(overlayState.position, displayFrame, displayOverlay));
    sceneChildren.push(displayOverlay);
  }
  presentRenderState.document = {
    activePageId: target.page.id, pages: [{ id: target.page.id, name: target.page.name, children: sceneChildren }],
    components: runtimeDocument.components || [], componentSets: runtimeDocument.componentSets || [],
    colorStyles: runtimeDocument.colorStyles || [], variableCollections: runtimeDocument.variableCollections || [], variables: runtimeDocument.variables || []
  };
  presentRenderState.assets = state.assets;
  presentRenderState.previews = state.previews;
  const rect = $('#present-canvas').getBoundingClientRect();
  const width = Math.max(1, rect.width); const height = Math.max(1, rect.height);
  const margin = Math.min(72, Math.max(24, Math.min(width, height) * .08));
  presentRenderState.zoom = Math.max(.05, Math.min(1.25, (width - margin * 2) / Math.max(1, displayFrame.width), (height - margin * 2) / Math.max(1, displayFrame.height)));
  presentRenderState.panX = (width - displayFrame.width * presentRenderState.zoom) / 2;
  presentRenderState.panY = (height - displayFrame.height * presentRenderState.zoom) / 2;
  $('#present-title').textContent = target.node.name;
  $('#present-back').disabled = state.presenting.stack.length === 0 && state.presenting.overlays.length === 0;
  $('#present-dialog').dataset.frameId = state.presenting.frameId;
  $('#present-dialog').dataset.overlayDepth = String(state.presenting.overlays.length);
  $('#present-dialog').dataset.navigationDepth = String(state.presenting.stack.length);
  const scrollOffset = getPresentationScrollOffset(presentRenderState, displayFrame);
  $('#present-dialog').dataset.scrollX = String(scrollOffset.x);
  $('#present-dialog').dataset.scrollY = String(scrollOffset.y);
  if (previousFrame && Number.isFinite(progress)) {
    $('#present-dialog').dataset.smartAnimating = 'true';
    $('#present-dialog').dataset.smartProgress = String(progress);
  } else {
    delete $('#present-dialog').dataset.smartAnimating;
    delete $('#present-dialog').dataset.smartProgress;
  }
  $('#present-dialog').style.setProperty('--present-duration', `${Math.max(0, interaction?.duration ?? 240)}ms`);
  $('#present-dialog').style.setProperty('--present-easing', prototypeEasingTimingFunction(interaction?.easing || 'ease-in-out'));
  if (interaction?.transition === 'smart-animate') {
    $('#present-canvas').style.opacity = '1';
    $('#present-canvas').style.transform = 'translateX(0)';
    presentRenderer?.invalidate();
  } else if (interaction?.transition && interaction.transition !== 'instant' && interaction.duration > 0) {
    const enterFrom = interaction.transition === 'move-left' ? 'translateX(22px)' : interaction.transition === 'move-right' ? 'translateX(-22px)' : 'translateX(0)';
    const canvasElement = $('#present-canvas');
    canvasElement.style.opacity = '0';
    canvasElement.style.transform = enterFrom;
    requestPresentationTransitionFrame(() => {
      presentRenderer?.invalidate();
      requestPresentationTransitionFrame(() => { canvasElement.style.opacity = '1'; canvasElement.style.transform = 'translateX(0)'; });
    });
  } else {
    $('#present-canvas').style.opacity = '1';
    $('#present-canvas').style.transform = 'translateX(0)';
    presentRenderer?.invalidate();
  }
}

function cancelPresentationAnimation() {
  if (presentationAnimationFrame) cancelAnimationFrame(presentationAnimationFrame);
  presentationAnimationFrame = 0;
  for (const frame of presentationTransitionFrames) cancelAnimationFrame(frame);
  presentationTransitionFrames.clear();
}

function requestPresentationTransitionFrame(callback) {
  let frame = 0;
  frame = requestAnimationFrame(() => {
    presentationTransitionFrames.delete(frame);
    callback();
  });
  presentationTransitionFrames.add(frame);
  return frame;
}

function clearPresentationDelay() {
  if (presentationDelayCancel) presentationDelayCancel();
  presentationDelayCancel = null;
  const dialog = $('#present-dialog');
  if (dialog) delete dialog.dataset.afterDelayPending;
}

function schedulePresentationDelay() {
  clearPresentationDelay();
  if (!state.presenting || !$('#present-dialog').open) return;
  const session = state.presenting;
  const topOverlay = session.overlays.at(-1);
  const pageId = topOverlay?.pageId || session.pageId;
  const frameId = topOverlay?.frameId || session.frameId;
  const found = findPrototypeDelayInteraction(presentRuntimeDocument || state.document, pageId, frameId, session);
  if (!found) return;
  presentationDelayCancel = schedulePrototypeDelay(found.interaction, () => {
    presentationDelayCancel = null;
    delete $('#present-dialog').dataset.afterDelayPending;
    if (state.presenting !== session || (session.overlays.at(-1)?.frameId || session.frameId) !== frameId
      || (session.overlays.at(-1)?.pageId || session.pageId) !== pageId) return;
    navigatePresentation(found.interaction);
  });
  $('#present-dialog').dataset.afterDelayPending = String(Boolean(presentationDelayCancel));
}

function animateSmartTransition(fromFrame, interaction) {
  cancelPresentationAnimation();
  const duration = Math.max(0, Number(interaction.duration) || 0);
  if (!duration) { renderPresentationFrame(); schedulePresentationDelay(); return; }
  const startTime = performance.now();
  const tick = now => {
    if (!state.presenting) { presentationAnimationFrame = 0; return; }
    const linear = Math.min(1, (now - startTime) / duration);
    const eased = easePrototypeProgress(linear, interaction.easing || 'ease-in-out');
    renderPresentationFrame(interaction, fromFrame, eased);
    if (linear < 1) presentationAnimationFrame = requestAnimationFrame(tick);
    else {
      presentationAnimationFrame = 0;
      renderPresentationFrame();
      schedulePresentationDelay();
    }
  };
  presentationAnimationFrame = requestAnimationFrame(tick);
}

function startPresentation(selectedId = null) {
  const { start, flowId } = resolvePrototypePresentationStart(state.document, selectedId);
  if (!start) { showToast('Create a frame before presenting this design.'); return; }
  cancelPresentationAnimation();
  const dialog = $('#present-dialog');
  state.presenting = createPrototypeSession(start, flowId);
  configurePresentationFlowPicker(flowId);
  presentationPointerGesture = null;
  presentRuntimeDocument = cloneDocument(state.document);
  presentRenderState = { document: null, assets: state.assets, previews: state.previews, selectedIds: [], presentationScrollOffsets: new Map(), zoom: 1, panX: 0, panY: 0, draftNode: null, marquee: null, inspectorTab: 'design' };
  $('#present-canvas').style.touchAction = 'none';
  dialog.showModal();
  requestAnimationFrame(() => {
    if (!presentRenderer) presentRenderer = new SceneRenderer($('#present-canvas'), () => presentRenderState);
    renderPresentationFrame();
    schedulePresentationDelay();
  });
}

function configurePresentationFlowPicker(flowId) {
  const picker = $('#present-flow-picker');
  const select = $('#present-flow-select');
  const flows = listPrototypeFlows(state.document);
  picker.hidden = flows.length === 0;
  const options = [];
  if (!flowId && flows.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Selected frame';
    options.push(option);
  }
  select.replaceChildren(...options, ...flows.map(flow => {
    const option = document.createElement('option');
    option.value = flow.id;
    option.textContent = flow.name;
    return option;
  }));
  select.value = flows.some(flow => flow.id === flowId)
    ? flowId
    : (options.some(option => option.value === '') ? '' : (flows[0]?.id || ''));
}

function restartPresentation(flowId = undefined) {
  if (!state.presenting || !presentRuntimeDocument || !presentRenderState) return;
  const requestedFlowId = flowId === undefined
    ? ($('#present-flow-picker').hidden ? state.presenting.flowId : ($('#present-flow-select').value || null))
    : (flowId || null);
  clearPresentationDelay();
  cancelPresentationAnimation();
  if (presentationPointerGesture) {
    const canvasElement = $('#present-canvas');
    try {
      if (canvasElement.hasPointerCapture(presentationPointerGesture.pointerId)) {
        canvasElement.releasePointerCapture(presentationPointerGesture.pointerId);
      }
    } catch { /* A synthetic or already-canceled pointer may have no capture. */ }
  }
  presentationPointerGesture = null;
  const session = restartPrototypeSession(state.document, state.presenting, requestedFlowId);
  if (!session) {
    $('#present-flow-select').value = state.presenting.flowId || '';
    showToast('That prototype flow is no longer available.');
    return;
  }
  state.presenting = session;
  // Variant interactions mutate the private runtime copy; restoring the source
  // document clears them along with session variable modes and hover state.
  presentRuntimeDocument = cloneDocument(state.document);
  presentRenderState.presentationScrollOffsets = new Map();
  $('#present-flow-select').value = session.flowId || '';
  const canvasElement = $('#present-canvas');
  canvasElement.style.transition = 'none';
  canvasElement.style.opacity = '1';
  canvasElement.style.transform = 'translateX(0)';
  canvasElement.getBoundingClientRect();
  canvasElement.style.removeProperty('transition');
  renderPresentationFrame();
  schedulePresentationDelay();
}

function navigatePresentation(interaction) {
  if (!state.presenting) return;
  const linkUrl = interaction.action === 'open-link' ? normalizePrototypeLinkUrl(interaction.url) : null;
  const runtimeDocument = presentRuntimeDocument || state.document;
  const source = interaction.action === 'navigate' && interaction.transition === 'smart-animate'
    ? findNode(runtimeDocument, state.presenting.frameId, state.presenting.pageId)?.node
    : null;
  const previousFrame = source ? structuredClone(source) : null;
  clearPresentationDelay();
  cancelPresentationAnimation();
  const result = applyPrototypeInteraction(runtimeDocument, state.presenting, interaction);
  if (!result) { showToast(interaction.action === 'close-overlay' ? 'There is no open overlay to close.' : 'This prototype destination no longer exists.'); return; }
  if (result === 'link-opened' && linkUrl) {
    window.open(linkUrl, '_blank', 'noopener,noreferrer');
    schedulePresentationDelay();
    return;
  }
  if (result === 'scroll-to') {
    try {
      const pageId = state.presenting.overlays?.at(-1)?.pageId || state.presenting.pageId;
      const plan = planPrototypeScrollTo(runtimeDocument, interaction.scrollTargetId, {
        pageId,
        screenFrameId: state.presenting.overlays?.at(-1)?.frameId || state.presenting.frameId,
        currentOffsets: presentRenderState?.presentationScrollOffsets || new Map(),
        alignment: interaction.scrollAlignment || 'nearest'
      });
      const duration = interaction.transition === 'scroll' ? Math.max(0, Number(interaction.duration) || 0) : 0;
      if (duration > 0 && plan.updates.length) {
        const startTime = performance.now();
        const tick = now => {
          if (!state.presenting || !presentRenderState) { presentationAnimationFrame = 0; return; }
          const linear = Math.min(1, (now - startTime) / duration);
          const eased = easePrototypeProgress(linear, interaction.easing || 'ease-in-out');
          const offsets = new Map(plan.offsets);
          for (const update of plan.updates) offsets.set(update.frameId, {
            x: update.from.x + (update.to.x - update.from.x) * eased,
            y: update.from.y + (update.to.y - update.from.y) * eased
          });
          presentRenderState.presentationScrollOffsets = offsets;
          renderPresentationFrame();
          if (linear < 1) presentationAnimationFrame = requestAnimationFrame(tick);
          else {
            presentationAnimationFrame = 0;
            presentRenderState.presentationScrollOffsets = plan.offsets;
            renderPresentationFrame();
            schedulePresentationDelay();
          }
        };
        presentationAnimationFrame = requestAnimationFrame(tick);
      } else {
        presentRenderState.presentationScrollOffsets = plan.offsets;
        renderPresentationFrame();
        schedulePresentationDelay();
      }
    } catch (error) {
      showToast(error.message || 'This layer can no longer be reached by scrolling.');
      schedulePresentationDelay();
    }
    return;
  }
  if (result === 'navigated' && previousFrame) animateSmartTransition(previousFrame, interaction);
  else { renderPresentationFrame(interaction); schedulePresentationDelay(); }
}

function presentationHitAtPointer(event) {
  if (!presentRenderState?.document) return null;
  const page = presentRenderState.document.pages[0];
  return hitTestPage(page, screenToWorld(event, $('#present-canvas'), presentRenderState), (node, point, x, y) => presentRenderer?.hitTestBoolean(node, point, x, y) ?? true, presentRenderState.document, presentRenderState.presentationScrollOffsets, presentRenderState.zoom);
}

function handlePresentationPointer(event, trigger, hitIdOverride = null) {
  if (!state.presenting || !presentRenderState?.document) return;
  if ($('#present-dialog').dataset.smartAnimating === 'true') return;
  const runtimeDocument = presentRuntimeDocument || state.document;
  let hit = hitIdOverride
    ? findNode(runtimeDocument, hitIdOverride, state.presenting.pageId) || findNodeAcrossPages(runtimeDocument, hitIdOverride)
    : presentationHitAtPointer(event);
  const topOverlayState = state.presenting.overlays.at(-1);
  if (trigger === 'on-click' && topOverlayState) {
    const overlayTarget = findNode(runtimeDocument, topOverlayState.frameId, topOverlayState.pageId) || findNodeAcrossPages(runtimeDocument, topOverlayState.frameId);
    const insideOverlay = hit && overlayTarget && isNodeInSubtree(overlayTarget.node, hit.id);
    if (!insideOverlay && topOverlayState.outsideClick) {
      state.presenting.overlays.pop();
      state.presenting.lastHoverInteractionId = null;
      clearPresentationDelay();
      renderPresentationFrame();
      schedulePresentationDelay();
      return;
    }
  }
  if (!hit) {
    if (trigger === 'while-hovering' && clearPrototypeHoverInteraction(runtimeDocument, state.presenting)) renderPresentationFrame();
    return;
  }
  let found = findClickableInteraction(runtimeDocument, state.presenting.pageId, hit.id, trigger, state.presenting);
  if (!found) {
    if (trigger === 'while-hovering' && clearPrototypeHoverInteraction(runtimeDocument, state.presenting)) renderPresentationFrame();
    return;
  }
  if (trigger === 'while-hovering' && state.presenting.lastHoverInteractionId === found.interaction.id) return;
  if (trigger === 'while-hovering' && state.presenting.lastHoverInteractionId) {
    const restoredVariant = clearPrototypeHoverInteraction(runtimeDocument, state.presenting);
    if (restoredVariant) {
      renderPresentationFrame();
      hit = presentationHitAtPointer(event);
      if (!hit) return;
      found = findClickableInteraction(runtimeDocument, state.presenting.pageId, hit.id, trigger, state.presenting);
      if (!found) return;
    }
  }
  navigatePresentation(found.interaction);
}

function triggerPresentationDrag(event, gesture) {
  if (!gesture || gesture.pointerId !== event.pointerId || gesture.dragTriggered) return false;
  const dx = Number(event.clientX) - gesture.startX;
  const dy = Number(event.clientY) - gesture.startY;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  if (dx * dx + dy * dy < presentationDragThreshold * presentationDragThreshold) return false;
  gesture.moved = true;
  if (!gesture.hitId || !state.presenting) return false;
  const runtimeDocument = presentRuntimeDocument || state.document;
  const found = findClickableInteraction(runtimeDocument, state.presenting.pageId, gesture.hitId, 'on-drag', state.presenting);
  if (!found) return false;
  gesture.dragTriggered = true;
  event.preventDefault?.();
  // The route has already been resolved against the original pointer-down hit.
  // Dispatch that exact interaction: resolving the pointer again after a move
  // can target a different layer (or no layer at all) when capture keeps the
  // pointer outside the source bounds.
  navigatePresentation(found.interaction);
  return true;
}

function handlePresentationPointerDown(event) {
  if (!state.presenting || !presentRenderState?.document || $('#present-dialog').dataset.smartAnimating === 'true'
    // Touch contact has no mouse button; engines may report -1 for it.
    || (event.pointerType !== 'touch' && event.button != null && event.button !== 0)
    || (presentationPointerGesture && presentationPointerGesture.pointerId !== event.pointerId)) return;
  const hit = presentationHitAtPointer(event);
  const world = screenToWorld(event, $('#present-canvas'), presentRenderState);
  const scrollFramePath = presentationScrollableFramesAt(world);
  const gesture = {
    pointerId: event.pointerId,
    startX: Number(event.clientX) || 0,
    startY: Number(event.clientY) || 0,
    hitId: hit?.id || null,
    scrollFramePath,
    lastFramePoint: scrollFramePath[0]?.local || { x: 0, y: 0 },
    lastWorld: world,
    moved: false,
    scrolled: false,
    pressTriggered: false,
    dragTriggered: false
  };
  presentationPointerGesture = gesture;
  try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Some synthetic and embedded pointers cannot be captured. */ }
  if (!gesture.hitId) return;
  const found = findClickableInteraction(presentRuntimeDocument || state.document, state.presenting.pageId, gesture.hitId, 'on-press', state.presenting);
  if (!found) return;
  if (gesture.scrollFramePath.length) { gesture.pressInteraction = found.interaction; return; }
  gesture.pressTriggered = true;
  event.preventDefault?.();
  navigatePresentation(found.interaction);
}

function handlePresentationPointerMove(event) {
  const gesture = presentationPointerGesture;
  if (gesture?.pointerId === event.pointerId && scrollPresentationGesture(event, gesture)) return;
  if (gesture?.pointerId === event.pointerId && triggerPresentationDrag(event, gesture)) return;
  if (gesture?.pointerId === event.pointerId && (gesture.pressTriggered || gesture.dragTriggered)) return;
  if (event.pointerType !== 'touch') handlePresentationPointer(event, 'while-hovering');
}

function handlePresentationPointerUp(event) {
  const gesture = presentationPointerGesture;
  if (!gesture) {
    handlePresentationPointer(event, 'on-click');
    return;
  }
  if (gesture.pointerId !== event.pointerId) return;
  presentationPointerGesture = null;
  if (scrollPresentationGesture(event, gesture) || triggerPresentationDrag(event, gesture) || gesture.moved || gesture.pressTriggered || gesture.dragTriggered) return;
  if (gesture.pressInteraction) { navigatePresentation(gesture.pressInteraction); return; }
  handlePresentationPointer(event, 'on-click');
}

function handlePresentationPointerCancel(event) {
  if (presentationPointerGesture?.pointerId === event.pointerId) presentationPointerGesture = null;
}

function backPresentation() {
  clearPresentationDelay();
  cancelPresentationAnimation();
  if (!backPrototypeSession(state.presenting)) return;
  renderPresentationFrame();
  schedulePresentationDelay();
}

async function buildLocalDesignPackage() {
  if (state.localPackageBuilding) throw new Error('A local design package is already being prepared. Wait for it to finish, then try again.');
  state.localPackageBuilding = true;
  try { return await buildLocalDesignPackageSnapshot(); }
  finally { state.localPackageBuilding = false; }
}

async function buildLocalDesignPackageSnapshot() {
  if (state.documentTransitioning) throw new Error('Wait for the current design switch to finish before sharing this design.');
  if (state.pendingImageImports) throw new Error('Wait for the current image import to finish before sharing this design.');
  if (isImageRecipeBatchActive(state.bulk)) throw new Error('Finish or stop the active image recipe batch before sharing this design.');
  const sourceDocument = state.document;
  const sourceGeneration = state.documentGeneration;
  const sourceRevision = state.saveRevision;
  const serializedDesign = serializeDocument(sourceDocument);
  const design = JSON.parse(serializedDesign);
  const assetReferences = [];
  const seenAssets = new Set();
  for (const reference of imageAssetReferencesAcrossPages(design)) {
    if (seenAssets.has(reference.assetId)) continue;
    seenAssets.add(reference.assetId);
    const metadata = await loadActiveImageAssetMetadata(reference.assetId, design);
    if (!metadata) throw new Error(`The local image “${reference.name || reference.assetId}” is missing or damaged. Restore it before sharing this design.`);
    assetReferences.push({ reference, metadata });
  }
  for (const entry of design.imageLibrary || []) {
    if (seenAssets.has(entry.assetId)) continue;
    seenAssets.add(entry.assetId);
    const metadata = await loadActiveImageAssetMetadata(entry.assetId, design);
    if (!metadata) throw new Error(`The library image “${entry.name || entry.assetId}” is missing or damaged. Reimport it before sharing this design.`);
    assetReferences.push({ reference: { assetId: entry.assetId, name: entry.name }, metadata });
  }
  const fontReferences = (await listActiveFontAssets()).filter(font => documentUsesFontFamily(design, font.family));
  const assetManifestBytes = new TextEncoder().encode(JSON.stringify(assetReferences.map(({ metadata }) => ({
    id: metadata.id, name: metadata.name, type: metadata.type, length: metadata.byteLength
  })))).byteLength;
  const fontManifestBytes = new TextEncoder().encode(JSON.stringify(fontReferences.map(font => ({
    id: font.id, name: font.name, type: font.type, family: font.family, weight: font.weight, style: font.style, length: font.byteLength
  })))).byteLength;
  // The serialized design string can expand by at most three UTF-8 bytes per
  // UTF-16 code unit. Reserve its full upper bound plus both asset catalogs
  // and the package envelope before any image/font binary is read.
  const manifestBudget = serializedDesign.length * 3 + assetManifestBytes + fontManifestBytes + 1024;
  if (!Number.isSafeInteger(manifestBudget) || manifestBudget > MAX_LOCAL_PACKAGE_BYTES) {
    throw new RangeError(`This design’s editable data exceeds the ${Math.floor(MAX_LOCAL_PACKAGE_BYTES / (1024 * 1024))} MiB local package limit.`);
  }
  let referencedBytes = manifestBudget;
  const admitBinaryLength = (length, label) => {
    if (!Number.isSafeInteger(length) || length < 0) throw new Error(`The saved size for ${label} is invalid. Repair the local asset before sharing this design.`);
    if (length > MAX_LOCAL_PACKAGE_BYTES - referencedBytes) {
      throw new RangeError(`This design’s images, fonts, and editable data exceed the ${Math.floor(MAX_LOCAL_PACKAGE_BYTES / (1024 * 1024))} MiB local package limit. Remove unused images or fonts and try again.`);
    }
    referencedBytes += length;
  };
  for (const { reference, metadata } of assetReferences) admitBinaryLength(metadata.byteLength, `image “${reference.name || reference.assetId}”`);
  for (const font of fontReferences) admitBinaryLength(font.byteLength, `font “${font.family}”`);

  // Check the complete binary budget before retrieving any source bytes. The
  // package builder applies the same hard limit including serialized design
  // metadata, and Blob parts avoid a second giant concatenated byte buffer.
  const assets = [];
  for (const { reference, metadata } of assetReferences) {
    const saved = await loadActiveImageAsset(reference.assetId);
    if (!saved || saved.bytes?.byteLength !== metadata.byteLength) {
      throw new Error(`The local image “${reference.name || reference.assetId}” is missing or damaged. Restore it before sharing this design.`);
    }
    assets.push({ id: saved.id, name: saved.name, type: saved.type, bytes: saved.bytes });
  }
  const fonts = [];
  for (const font of fontReferences) {
    const saved = await loadActiveFontAsset(font.id);
    if (!saved || saved.bytes.byteLength !== font.byteLength) throw new Error(`The local font “${font.family}” is missing or damaged. Reinstall it before sharing this design.`);
    fonts.push(saved);
  }
  if (state.document !== sourceDocument || state.documentGeneration !== sourceGeneration || state.saveRevision !== sourceRevision
    || state.documentTransitioning) {
    throw new Error('The design changed while its local package was being prepared. Try again to include the latest edits.');
  }
  return {
    blob: buildLocalPackageBlob(design, assets, fonts),
    filename: localPackageFilename(design.name),
    title: design.name || 'Tiny Image Star design',
    sourceDocument, sourceGeneration, sourceRevision
  };
}

async function exportDesign() {
  try {
    const file = await buildLocalDesignPackage();
    downloadBlob(file.blob, file.filename);
    showToast('Local design file downloaded.');
  } catch (error) { showToast(error.message || 'Could not export this local design.'); }
}

async function attemptNativeDesignShare(packageData, file, { retryOnActivation = false } = {}) {
  let shareFiles = false;
  try { shareFiles = Boolean(file && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })); }
  catch { shareFiles = false; }
  if (!shareFiles) return 'unsupported';
  try {
    // In the prepared-package retry path this call happens before the first
    // await, preserving the fresh button activation required by mobile share.
    const sharePromise = navigator.share({ title: packageData.title, text: 'Editable Tiny Image Star design file', files: [file] });
    await sharePromise;
    showToast('Local design file shared.');
    return 'shared';
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled';
    if (retryOnActivation && error?.name === 'NotAllowedError') {
      clearTimeout(state.pendingLocalShareTimer);
      const pending = { packageData, file };
      state.pendingLocalShare = pending;
      state.pendingLocalShareTimer = setTimeout(() => {
        if (state.pendingLocalShare === pending) state.pendingLocalShare = null;
        state.pendingLocalShareTimer = 0;
      }, 60_000);
      showToast('Your local package is ready. Tap Share again to open the device share sheet.');
      return 'retry';
    }
    return 'unsupported';
  }
}

async function shareDesignFile() {
  try {
    let pending = state.pendingLocalShare;
    clearTimeout(state.pendingLocalShareTimer);
    state.pendingLocalShareTimer = 0;
    state.pendingLocalShare = null;
    if (pending && pending.packageData.sourceDocument === state.document
      && pending.packageData.sourceGeneration === state.documentGeneration
      && pending.packageData.sourceRevision === state.saveRevision) {
      const status = await attemptNativeDesignShare(pending.packageData, pending.file);
      if (status === 'shared' || status === 'cancelled') return;
      downloadBlob(pending.packageData.blob, pending.packageData.filename);
      showToast('Local design file downloaded. You can send the .flocal file from your device.');
      return;
    }
    const packageData = await buildLocalDesignPackage();
    const canTryNativeShare = typeof File === 'function' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
    const file = canTryNativeShare ? new File([packageData.blob], packageData.filename, { type: packageData.blob.type }) : null;
    if (file) packageData.blob = file;
    const status = file ? await attemptNativeDesignShare(packageData, file, { retryOnActivation: true }) : 'unsupported';
    if (status === 'shared' || status === 'cancelled' || status === 'retry') return;
    downloadBlob(packageData.blob, packageData.filename);
    showToast('Local design file downloaded. You can send the .flocal file from your device.');
  } catch (error) { showToast(error.message || 'Could not share this local design file.'); }
}
function tokenCollectionNameFromFile(fileName) {
  const stem = String(fileName || '').replace(/\.tokens\.json$/i, '').replace(/\.json$/i, '');
  const base = stem.replace(/[{}.$\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 72) || 'Imported tokens';
  const existing = new Set((state.document.variableCollections || []).map(collection => collection.name.toLocaleLowerCase()));
  let name = base;
  let suffix = 2;
  while (existing.has(name.toLocaleLowerCase())) {
    const ending = ` ${suffix++}`;
    name = `${base.slice(0, 72 - ending.length)}${ending}`;
  }
  return name;
}
function importDesignTokens(file) {
  if (!file) return;
  const generation = state.documentGeneration;
  try {
    if (state.documentTransitioning) throw new Error('Wait for the current design switch to finish before importing tokens.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Token files must be 5 MB or smaller.');
    void file.text().then(text => {
      if (generation !== state.documentGeneration || state.documentTransitioning) throw new Error('The active design changed before token import finished. Choose the token file again.');
      const imported = importDtcgTokens(text, { collectionName: tokenCollectionNameFromFile(file.name) });
      const merged = mergeDtcgTokens(state.document, imported);
      checkpoint(`Import tokens from ${file.name}`);
      state.document = merged.document;
      state.controlEdit = false;
      renderUI(); queueSave(); renderer?.invalidate();
      const variableCount = imported.variables.length;
      const warning = merged.warnings[0];
      const detail = warning ? ` ${warning}` : '';
      showToast(`${variableCount} design token${variableCount === 1 ? '' : 's'} imported locally.${detail}`, warning ? 5000 : 3000);
    }).catch(error => showToast(error.message || 'Could not import these design tokens.'));
  } catch (error) {
    showToast(error.message || 'Could not import these design tokens.');
  }
}
function exportDesignTokens() {
  try {
    if (!(state.document.variables || []).length) throw new Error('Add a variable before exporting design tokens.');
    const json = stringifyDtcgTokens(state.document);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeExportName(state.document.name || 'Untitled').slice(0, 80)}.tokens.json`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('Design tokens downloaded as DTCG JSON.');
  } catch (error) {
    showToast(error.message || 'Could not export these design tokens.');
  }
}
async function persistCurrentDocumentNow() {
  if (!state.ready) return true;
  const saveOwner = state.bulk || null;
  if (saveOwner) {
    saveOwner.savePending = true;
    saveOwner.saveError = null;
    renderBulkBar();
  }
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  setSaveState('saving', savingStatusText());
  try {
    while (true) {
      const revision = state.saveRevision;
      const snapshot = JSON.parse(serializeDocument(state.document));
      const { versionError, recoveryCopy } = await enqueueDocumentSave(snapshot, state.versionSaveLabel, !isImageRecipeBatchActive(state.bulk));
      if (revision === state.saveRevision) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
        setSaveState(recoveryCopy ? 'error' : 'saved', recoveryCopy ? 'Conflict · copy saved' : versionError ? `Saved · ${storageDestinationName()} · history unavailable` : savedStatusText());
        if (saveOwner && state.bulk === saveOwner) {
          saveOwner.savePending = false;
          saveOwner.saveError = recoveryCopy ? 'This tab is saving edits as a separate recovery copy because another tab saved a newer revision.' : null;
          renderBulkBar();
        }
        if (recoveryCopy) showToast('Your edits are saved as a separate recovery copy. This tab will not overwrite the newer design.');
        return true;
      }
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
    }
  } catch (error) {
    if (error instanceof DocumentSaveConflictError) {
      try {
        const conflict = await preserveDocumentSaveConflict(JSON.parse(serializeDocument(state.document)), error);
        setSaveState('error', conflict.saved ? 'Conflict · copy saved' : 'Conflict · copy unavailable');
        if (conflict.saved) showToast('Your edits are saved as a separate recovery copy. This tab will not overwrite the newer design.');
        else showToast('Your edits remain open in this tab, but the separate recovery copy could not be saved. Export a local copy before closing.');
        if (saveOwner && state.bulk === saveOwner) {
          saveOwner.savePending = false;
          saveOwner.saveError = conflict.saved
            ? 'This tab is saving edits as a separate recovery copy because another tab saved a newer revision.'
            : 'The separate recovery copy could not be saved. Export a local copy before closing.';
          renderBulkBar();
        }
        return conflict.saved;
      } catch (recoveryError) {
        setSaveState('error', 'Conflict · copy unavailable');
        showToast(`The newer saved design was preserved, but this tab could not save its recovery copy: ${recoveryError.message || 'local storage failed'}. Export a local copy before closing.`, 8000);
      }
    } else {
      setSaveState('error', failedStatusText());
      showToast(error.message || `Could not save this design to ${storageDestinationName()} before switching files.`);
    }
    if (saveOwner && state.bulk === saveOwner) {
      saveOwner.savePending = false;
      saveOwner.saveError = error.message || 'The local save failed.';
      renderBulkBar();
    }
    return false;
  }
}

function releaseImageRuntimeForDocumentSwitch() {
  for (const timer of previewTimers.values()) clearTimeout(timer);
  previewTimers.clear();
  for (const nodeId of state.renderVersion.keys()) imageEngine.cancelQueuedByKey(`preview:${nodeId}`);
  for (const assetId of state.assets.keys()) imageEngine.dispose(assetId);
  for (const asset of state.assets.values()) {
    asset.bitmap?.close?.();
    if (asset.bitmapUrl) URL.revokeObjectURL(asset.bitmapUrl);
  }
  for (const bitmap of state.previews.values()) bitmap.close?.();
  for (const url of state.previewUrls.values()) URL.revokeObjectURL(url);
  previewsEvictedForCapacity.clear();
  state.assets.clear(); state.previews.clear(); state.previewUrls.clear(); state.previewAssetIds.clear();
  state.previewVersions.clear(); state.imageStatus.clear(); state.renderVersion.clear();
  imageMemoryBudget.releaseEntries();
}

function figImportLossCount(report = {}) {
  const count = table => Object.values(table || {}).reduce((total, value) => total + (Number.isSafeInteger(value) ? value : 0), 0);
  return { unsupported: count(report.unsupportedTypes), flattened: count(report.flattenedTypes) };
}

function openFigImportReview(result) {
  const dialog = $('#fig-import-dialog');
  const report = result.report || {};
  const losses = figImportLossCount(report);
  const hasLosses = losses.unsupported > 0 || losses.flattened > 0;
  const summary = [
    `${report.source || 'Local .fig file'}`,
    `format ${Number.isSafeInteger(report.formatVersion) ? report.formatVersion : 'unknown'}`,
    `${report.pages || 0} page${report.pages === 1 ? '' : 's'}`,
    `${report.importedNodes || 0} editable layer${report.importedNodes === 1 ? '' : 's'}`
  ].join(' · ');
  $('#fig-import-summary').textContent = summary;
  $('#fig-import-warning-block').hidden = !hasLosses;
  $('#fig-import-clean').hidden = hasLosses;
  $('#fig-import-confirm').textContent = hasLosses ? 'Import with changes' : 'Import design';
  $('#fig-import-loss-summary').textContent = `${losses.unsupported} unsupported item${losses.unsupported === 1 ? '' : 's'} may be omitted or changed; ${losses.flattened} feature${losses.flattened === 1 ? '' : 's'} will be simplified. Review the examples below.`;
  const list = $('#fig-import-warning-list');
  list.replaceChildren();
  for (const warning of report.warnings || []) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = `${String(warning.type || 'Layer').replace(/_/gu, ' ')} · ${warning.name || 'Unnamed layer'}`;
    item.append(title);
    if (warning.detail) {
      const detail = document.createElement('span');
      detail.textContent = warning.detail;
      item.append(detail);
    }
    list.append(item);
  }
  if (report.warningsTruncated) {
    const item = document.createElement('li');
    item.textContent = 'Showing the first 40 examples. The omitted and simplified totals include every affected item.';
    list.append(item);
  }
  pendingFigImport = result;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

async function confirmFigImport() {
  const result = pendingFigImport;
  if (!result) return;
  const button = $('#fig-import-confirm');
  button.disabled = true;
  try {
    const switched = await switchToDocument(result.document, {
      message: 'Design imported locally. Review the import report for any simplified features.',
      beforeSwitch: async nextDocument => Object.assign(nextDocument, (await importLocalPackage(nextDocument, result.assets || [])).document),
      versionLabel: 'Imported .fig design'
    });
    if (switched) $('#fig-import-dialog').close();
  } finally {
    button.disabled = false;
  }
}

async function switchToDocument(nextDocument, { saveCurrent = true, message = 'Local design opened on this device.', beforeSwitch = null, versionLabel = 'Opened design', expectedStorageRevision = undefined } = {}) {
  if (state.workspacePermissionNeeded) { showToast('Reconnect the saved folder workspace before opening or creating designs.'); return false; }
  if (state.localPackageBuilding) { showToast('Wait for the local design package to finish before switching designs.'); return false; }
  if (isImageRecipeBatchActive(state.bulk)) {
    showToast('Finish or stop the active image recipe before switching designs.');
    return false;
  }
  if (state.documentTransitioning) { showToast('A design switch is already in progress.'); return false; }
  if (state.interaction) { showToast('Finish the current canvas action before switching designs.'); return false; }
  if (state.pendingImageImports) { showToast('Wait for the current image import to finish before switching designs.'); return false; }
  const currentDocumentId = state.document.id;
  let nextWorkspaceHead = null;
  state.imageExportAbortController?.abort();
  state.documentTransitioning = true;
  setDocumentEditingBlocked(true);
  try {
    if (saveCurrent && !(await persistCurrentDocumentNow())) return false;
    if (nextDocument.id === currentDocumentId && state.documentSaveConflict) {
      showToast('This design changed in another tab. Its version was preserved, so restoring here is paused until you reopen the current design.');
      return false;
    }
    if (beforeSwitch) await beforeSwitch(nextDocument);
    if (state.workspace) {
      let opened;
      try { opened = await openWorkspaceDesign(state.workspace, nextDocument.id); }
      catch (error) {
        if (!workspaceNotFound(error, 'DESIGN_NOT_FOUND')) throw error;
        await persistWorkspaceSnapshot(JSON.parse(serializeDocument(nextDocument)));
        opened = await openWorkspaceDesign(state.workspace, nextDocument.id);
      }
      nextDocument = opened.document;
      nextWorkspaceHead = opened.head;
    }
    try { await ensureImageLibraryCompatibility(nextDocument); }
    catch (error) { console.warn('Could not add legacy image sources to the reusable image library.', error); }
    const nextStoredRecord = await loadDocumentRecordById(nextDocument.id);
    const sameDocumentAfterSave = saveCurrent && nextDocument.id === currentDocumentId;
    const nextStorageRevision = sameDocumentAfterSave
      ? state.documentStorageRevision ?? nextStoredRecord?.revision ?? null
      : expectedStorageRevision === undefined
        ? nextStoredRecord?.revision ?? null
        : expectedStorageRevision;
    const nextRecipeRecovery = await recipeRecoveryForDocument(nextDocument.id);
    clearTimeout(state.pendingLocalShareTimer);
    state.pendingLocalShareTimer = 0;
    state.pendingLocalShare = null;
    const generation = ++state.documentGeneration;
    state.clipboard = [];
    state.appearanceClipboard = null;
    releaseImageRuntimeForDocumentSwitch();
    state.document = nextDocument;
    state.workspaceHead = nextWorkspaceHead;
    state.documentStorageRevision = nextStorageRevision;
    state.documentSaveConflict = null;
    state.componentSetSelectedVariants.clear();
    state.versionSaveLabel = versionLabel;
    state.prototypeEditingInteractionId = null;
    state.prototypeDestinationId = null;
    state.prototypeSourceId = null;
    state.prototypeConditionVariableId = null;
    state.prototypeConditionOperator = 'equals';
    state.prototypeConditionValue = null;
    state.imageCropMode = false; state.imageCropOverlay = null; state.imageCropDraftSelection = null; state.imageFillCropTarget = null;
    state.selectedIds = []; clearVectorAnchorSelection(); state.smartGuides = []; state.pendingCommentAnchor = null; state.activeCommentId = null;
    state.draftNode = null; state.penDraft = null; state.penHover = null; state.pencilDraft = null; state.marquee = null; state.interaction = null;
    state.pointerMap.clear(); clearPrototypeConnectPrompt(); state.textNodeId = null; state.textSelection = null;
    state.bulk = null; state.pendingRecipeRecovery = nextRecipeRecovery; state.inspectorTab = 'design'; syncInspectorTabAccessibility('design');
    if (nextRecipeRecovery) setDocumentEditingBlocked(true);
    state.zoom = 1; state.panX = canvas.clientWidth / 2; state.panY = canvas.clientHeight / 2;
    history.undoStack.length = 0; history.redoStack.length = 0;
    renderBulkBar(); renderUI();
    if (state.workspace) await refreshLocalFontAssets({ showFailureToast: true });
    await restoreImageAssets(generation);
    renderRecipeRecoveryPrompt();
    showToast(message);
    return true;
  } catch (error) {
    showToast(error.message || 'Could not switch designs.');
    return false;
  } finally {
    state.documentTransitioning = false;
    setDocumentEditingBlocked(Boolean(state.pendingRecipeRecovery));
    if (state.document === nextDocument) queueSave();
  }
}

async function renderDesignLibrary() {
  const list = $('#design-library-list');
  list.setAttribute('aria-busy', 'true');
  list.replaceChildren();
  try {
    const indexedDocuments = await listSavedDocuments();
    let documents = indexedDocuments;
    if (state.workspace) {
      const indexedById = new Map(indexedDocuments.map(item => [item.id, item]));
      const folderDocuments = [];
      for (const id of await listWorkspaceDesignIds(state.workspace)) {
        const indexed = indexedById.get(id);
        try {
          const opened = await openWorkspaceDesign(state.workspace, id);
          folderDocuments.push({ id, name: opened.document.name || indexed?.name || 'Untitled',
            savedAt: indexed?.savedAt || null, revision: indexed?.revision ?? null });
        } catch (error) {
          if (error?.code !== 'DESIGN_DELETED') throw error;
          folderDocuments.push({ id, name: indexed?.name || 'Design deletion pending',
            savedAt: indexed?.savedAt || null, revision: indexed?.revision ?? null, pendingDeletion: true });
        }
      }
      documents = folderDocuments;
    }
    if (!documents.length) {
      list.innerHTML = `<div class="design-library-empty">Your local designs will appear here as you work. They are stored in ${state.workspace ? 'the selected folder' : 'this browser profile'}.</div>`;
      return;
    }
    list.innerHTML = documents.map(item => {
      const current = item.id === state.document.id;
      let date = 'Saved on this device';
      if (item.savedAt) {
        try { date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.savedAt)); } catch { /* Keep the local fallback label. */ }
      }
      const pendingStatus = item.pendingDeletion ? '<span class="design-file-date">Deletion pending · folder cleanup needs retry</span>' : `<span class="design-file-date">${escapeHtml(date)} · ${state.workspace ? 'Folder workspace' : 'This device'}</span>`;
      const actions = item.pendingDeletion
        ? `<button type="button" data-design-action="delete" data-design-id="${escapeHtml(item.id)}">Retry delete</button>`
        : `<button type="button" data-design-action="open" data-design-id="${escapeHtml(item.id)}"${current ? ' disabled aria-current="true"' : ''}>Open</button><button type="button" data-design-action="rename" data-design-id="${escapeHtml(item.id)}">Rename</button><button type="button" data-design-action="duplicate" data-design-id="${escapeHtml(item.id)}">Duplicate</button><button type="button" data-design-action="delete" data-design-id="${escapeHtml(item.id)}">Delete</button>`;
      return `<article class="design-file-row${current ? ' is-current' : ''}${item.pendingDeletion ? ' is-deletion-pending' : ''}"><div class="design-file-details"><span class="design-file-name">${escapeHtml(item.name)}${current ? ' · Current' : ''}</span>${pendingStatus}</div><div class="design-file-actions">${actions}</div></article>`;
    }).join('');
  } finally {
    list.setAttribute('aria-busy', 'false');
  }
}

async function openDesignLibrary() {
  const dialog = $('#design-library-dialog');
  const list = $('#design-library-list');
  if (!dialog.open) dialog.showModal();
  list.setAttribute('aria-busy', 'true');
  list.innerHTML = '<div class="design-library-empty">Loading your local designs…</div>';
  setDocumentEditingBlocked(true);
  try {
    if (!(await persistCurrentDocumentNow())) return;
    await renderDesignLibrary();
  } catch (error) { showToast(error.message || 'Could not read the local design library.'); }
  finally {
    list.setAttribute('aria-busy', 'false');
    if (!state.documentTransitioning) setDocumentEditingBlocked(false);
  }
}

async function handleDesignLibraryAction(action, id) {
  try {
    if (action === 'open') {
      const saved = await loadDocumentRecordById(id);
      let documentToOpen = null;
      if (state.workspace) documentToOpen = (await openWorkspaceDesign(state.workspace, id)).document;
      else if (saved?.document) documentToOpen = parseDocument(saved.document);
      if (!documentToOpen) { showToast('That saved design is no longer available.'); await renderDesignLibrary(); return; }
      const opened = await switchToDocument(documentToOpen, { expectedStorageRevision: saved?.revision ?? null });
      if (opened) { $('#design-library-dialog').close(); await renderDesignLibrary(); }
      return;
    }
    if (action === 'rename') {
      // Keep the record/document boundary consistent with the open action below:
      // loadDocumentById returns the document itself, while this flow also needs
      // the record metadata for a reliable fallback name.
      const saved = await loadDocumentRecordById(id);
      let sourceDocument = null;
      if (state.workspace) sourceDocument = (await openWorkspaceDesign(state.workspace, id)).document;
      else if (saved) sourceDocument = parseDocument(saved.document);
      if (!sourceDocument) { showToast('That saved design is no longer available.'); await renderDesignLibrary(); return; }
      const name = prompt('Rename local design', sourceDocument.name || saved?.name || 'Untitled');
      if (name == null) return;
      const nextName = String(name).trim();
      if (!nextName || nextName.length > 120) { showToast('A design name must contain 1–120 characters.'); return; }
      const isCurrent = id === state.document.id;
      if (state.workspace && isCurrent) {
        state.document.name = nextName;
        renderUI();
        if (!(await persistCurrentDocumentNow())) throw new Error('The folder workspace did not save the renamed design.');
      } else if (state.workspace) {
        const renamed = parseDocument(sourceDocument);
        renamed.name = nextName;
        const currentFolder = await openWorkspaceDesign(state.workspace, id);
        const result = await commitWorkspaceDesign(state.workspace, id, renamed, {
          expectedHead: currentFolder.head,
          pageId: renamed.activePageId || renamed.pages[0].id
        });
        if (result.acknowledged !== true) throw new Error('The folder workspace did not confirm the rename.');
        try {
          const indexed = await loadDocumentRecordById(id);
          await saveDocument(renamed, { expectedRevision: indexed?.revision ?? null });
        } catch (error) {
          console.warn('The folder rename succeeded, but its optional browser library mirror could not be updated.', error);
        }
      } else if (!(await renameStoredDocument(id, nextName, isCurrent ? { expectedRevision: state.documentStorageRevision } : {}))) {
        showToast('That saved design is no longer available.'); return;
      } else if (isCurrent) {
        state.documentStorageRevision = (state.documentStorageRevision ?? 0) + 1;
        state.document.name = nextName;
        renderUI(); await persistCurrentDocumentNow();
      }
      await renderDesignLibrary();
      return;
    }
    if (action === 'duplicate') {
      if (state.workspace) {
        const source = (await openWorkspaceDesign(state.workspace, id)).document;
        const duplicate = parseDocument(source);
        duplicate.id = createId('file');
        duplicate.name = `${String(source.name || 'Untitled').slice(0, 114)} copy`;
        let created = false;
        try {
          // Initialize a valid but empty revision first. The fully populated snapshot
          // is published only after every referenced asset has been copied and verified.
          const initial = await createWorkspaceDesign(state.workspace, workspaceSeedDocument(duplicate));
          created = true;
          const requirements = collectReferencedAssets(duplicate);
          for (const assetId of requirements.imageAssetIds) {
            const sourceAsset = await readWorkspaceImageAsset(state.workspace, id, assetId);
            await saveWorkspaceImageAsset(state.workspace, duplicate.id, assetId, sourceAsset.bytes, { mimeType: sourceAsset.metadata.mimeType });
          }
          const sourceFonts = await listWorkspaceFontAssets(state.workspace, id);
          const usedFonts = sourceFonts.filter(font => requirements.fontSpecs.some(spec =>
            spec.family.toLocaleLowerCase() === font.metadata.family.toLocaleLowerCase()
              && spec.weight === font.metadata.weight && spec.style === font.metadata.style));
          for (const font of usedFonts) await saveWorkspaceFontAsset(state.workspace, duplicate.id, font);
          const committed = await commitWorkspaceDesign(state.workspace, duplicate.id, duplicate, {
            expectedHead: initial.head,
            pageId: duplicate.activePageId || duplicate.pages[0].id
          });
          if (committed.acknowledged !== true) throw new Error('The folder workspace did not confirm the duplicate.');
          state.workspaceVerifiedImageIds.set(duplicate.id, new Set(requirements.imageAssetIds));
          state.workspaceVerifiedFontIds.set(duplicate.id, new Set(usedFonts.map(font => font.metadata.id)));
          try { await saveDocument(duplicate, { expectedRevision: null }); }
          catch (error) { console.warn('The folder duplicate succeeded, but its optional browser library mirror could not be updated.', error); }
        } catch (error) {
          if (created) {
            try { await state.workspace.designsDirectory.removeEntry(duplicate.id, { recursive: true }); }
            catch (cleanupError) { console.warn('Could not clean up the incomplete folder duplicate.', cleanupError); }
          }
          throw error;
        }
      } else {
        if (id === state.document.id && !(await persistCurrentDocumentNow())) return;
        const duplicate = await duplicateStoredDocument(id);
        if (!duplicate) { showToast('That saved design is no longer available.'); return; }
      }
      await renderDesignLibrary();
      showToast(`“${duplicate.name}” was added to your local designs.`);
      return;
    }
    if (action === 'delete') {
      if (isImageRecipeBatchActive(state.bulk)) { showToast('Finish or stop the active image recipe before deleting a design.'); return; }
      const live = state.liveCollaboration;
      const liveDesignId = live?.role === 'guest' ? live.localDesignId : live?.designId;
      if (liveDesignId === id && (live.status === 'fork-unsaved' || !liveTerminal(live.status))) {
        showToast('Leave the live session and save any pending local fork before deleting this design.'); return;
      }
      if (id === state.document.id && state.pendingRecipeRecovery) {
        showToast('Resolve this design’s interrupted image recipe before deleting it.'); return;
      }
      let saved;
      let pendingDeletion = false;
      if (state.workspace) {
        try { saved = (await openWorkspaceDesign(state.workspace, id)).document; }
        catch (error) {
          if (error?.code === 'DESIGN_DELETED') {
            pendingDeletion = true;
            const indexed = await loadDocumentRecordById(id);
            saved = indexed?.document ? parseDocument(indexed.document) : { name: indexed?.name || 'Design deletion pending' };
          } else if (workspaceNotFound(error, 'DESIGN_NOT_FOUND')) saved = null;
          else throw error;
        }
      } else saved = await loadDocumentById(id);
      if (!saved) { showToast('That saved design is no longer available.'); await renderDesignLibrary(); return; }
      const location = state.workspace ? `the “${state.workspaceHandle?.name || 'selected'}” workspace folder` : 'this device';
      const question = pendingDeletion
        ? `Finish deleting “${saved.name || 'Untitled'}” from ${location}? This cannot be undone.`
        : `Delete “${saved.name || 'Untitled'}” from ${location}? Its local versions and workspace assets will be removed. This cannot be undone.`;
      if (!confirm(question)) return;
      if (state.workspace) {
        if (id === state.document.id) {
          if (pendingDeletion) { showToast('This design is open in this tab but is marked for deletion. Export a local copy before closing it, then retry from another tab.'); return; }
          const switched = await switchToDocument(createDocument(), { message: 'A new local design is ready.' });
          if (!switched || !(await persistCurrentDocumentNow())) return;
        }
        try { await deleteWorkspaceDesign(state.workspace, id); }
        catch (error) {
          if (error?.code === 'DESIGN_DELETE_PENDING') await renderDesignLibrary();
          throw error;
        }
        state.workspaceVerifiedImageIds.delete(id);
        state.workspaceVerifiedFontIds.delete(id);
        try { await deleteStoredDocument(id); }
        catch (error) { console.warn('The workspace design was deleted, but its optional browser library mirror could not be cleaned up.', error); }
        if (liveDesignId === id) {
          state.liveCollaboration = null;
          state.liveReplicaHead = null;
          state.liveReplicaDesignId = null;
        }
        await renderDesignLibrary();
        showToast(`“${saved.name || 'Untitled'}” was deleted from the workspace.`);
        return;
      }
      if (id === state.document.id) {
        const switched = await switchToDocument(createDocument(), {
          message: 'Design deleted. A new local design is ready.',
          beforeSwitch: async () => {
            if (!await deleteStoredDocument(id)) throw new Error('That saved design is no longer available.');
          }
        });
        if (!switched) return;
      } else {
        await deleteStoredDocument(id);
      }
      await renderDesignLibrary();
    }
  } catch (error) { showToast(error.message || 'Could not update the local design library.'); }
}

async function renderDocumentVersionHistory() {
  const list = $('#version-history-list');
  if (!list) return;
  list.setAttribute('aria-busy', 'true');
  try {
    const versions = await listDocumentVersions(state.document.id);
    if (!versions.length) {
      list.innerHTML = '<div class="version-history-empty">No saved versions yet. Make an edit or name a checkpoint to start this design’s history.</div>';
      return;
    }
    list.innerHTML = versions.map(version => {
      let date = 'Saved on this device';
      if (version.createdAt) {
        try { date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(version.createdAt)); } catch { /* Keep the local fallback label. */ }
      }
      return `<article class="version-record"><div class="version-record-details"><span class="version-record-name">${escapeHtml(version.name)}</span><span class="version-record-date">${escapeHtml(date)} · This device</span></div><button class="secondary-button" type="button" data-version-action="restore" data-version-id="${escapeHtml(version.id)}">Restore</button></article>`;
    }).join('');
  } catch (error) {
    list.innerHTML = `<div class="version-history-empty">Version history is unavailable: ${escapeHtml(error.message || 'local storage could not be read.')}</div>`;
  } finally {
    list.setAttribute('aria-busy', 'false');
  }
}

async function openVersionHistory() {
  const dialog = $('#version-history-dialog');
  if (!dialog.open) dialog.showModal();
  setDocumentEditingBlocked(true);
  try {
    if (!(await persistCurrentDocumentNow())) return;
    await renderDocumentVersionHistory();
    $('#version-save-name').focus();
  } finally {
    if (!state.documentTransitioning) setDocumentEditingBlocked(false);
  }
}

async function saveNamedDocumentVersion(name) {
  if (isImageRecipeBatchActive(state.bulk)) { showToast('Wait until the image recipe batch finishes before saving a named version.'); return; }
  const versionName = String(name ?? '').trim();
  if (!versionName || versionName.length > 120) { showToast('A version name must contain 1–120 characters.'); return; }
  if (!(await persistCurrentDocumentNow())) return;
  if (state.documentSaveConflict) {
    showToast(`Open “${state.documentSaveConflict.recoveryName}” from Your designs to save a named checkpoint for your recovered edits.`);
    return;
  }
  try {
    const snapshot = JSON.parse(serializeDocument(state.document));
    await saveDocumentVersion(snapshot, { name: versionName, force: true });
    await renderDocumentVersionHistory();
    $('#version-save-name').value = '';
    showToast(`Saved “${versionName}” to this device’s version history.`);
  } catch (error) { showToast(error.message || 'Could not save this local version.'); }
}

async function restoreDocumentVersion(versionId) {
  if (isImageRecipeBatchActive(state.bulk)) { showToast('Finish or stop the active image recipe before restoring a version.'); return; }
  try {
    const version = await loadDocumentVersion(versionId, state.document.id);
    if (!version || version.document.id !== state.document.id) {
      showToast('That local version is no longer available for this design.');
      await renderDocumentVersionHistory();
      return;
    }
    const currentRecord = await loadDocumentRecordById(state.document.id);
    if (!currentRecord) throw new Error('This design was removed from local storage before the version could be restored.');
    const restored = await switchToDocument(parseDocument(version.document), {
      message: `Restored “${version.name}” from local version history.`,
      versionLabel: `Restored · ${version.name}`
    });
    if (restored) $('#version-history-dialog').close();
  } catch (error) { showToast(error.message || 'Could not restore this local version.'); }
}

function imageNodesAcrossPages() { const result = []; for (const page of state.document.pages) walkNodes(page.children, ({ node }) => { if (node.type === 'image') result.push(node); }); return result; }
function imageAssetReferencesAcrossPages(documentData = state.document) {
  const result = [];
  for (const page of documentData.pages || []) walkNodes(page.children, ({ node }) => {
    if (node.type === 'image' && node.assetId) result.push({ node, assetId: node.assetId, name: node.fileName || node.name, adjustments: node.adjustments, transforms: node.transforms, previewKey: imagePreviewKey(node.id) });
    if (Array.isArray(node.fills)) {
      node.fills.forEach(fill => {
        if (fill.type !== 'image' || !fill.imageFill?.assetId) return;
        result.push({ node, fillId: fill.id, previewKey: imagePreviewKey(node.id, fill.id), assetId: fill.imageFill.assetId, name: node.name, adjustments: fill.imageFill.adjustments, transforms: fill.imageFill.transforms });
      });
    } else if (node.imageFill?.assetId) {
      result.push({ node, previewKey: imagePreviewKey(node.id), assetId: node.imageFill.assetId, name: node.name, adjustments: node.imageFill.adjustments, transforms: node.imageFill.transforms });
    }
  });
  return result;
}

async function ensureImageLibraryCompatibility(documentData) {
  const existing = new Set((documentData.imageLibrary || []).map(entry => entry.assetId));
  const references = new Map();
  for (const reference of imageAssetReferencesAcrossPages(documentData)) {
    if (!reference.assetId || existing.has(reference.assetId) || references.has(reference.assetId)) continue;
    references.set(reference.assetId, reference);
  }
  if (!references.size || existing.size >= MAX_IMAGE_LIBRARY_ENTRIES) return false;
  const additions = [];
  const pending = [...references.values()].slice(0, MAX_IMAGE_LIBRARY_ENTRIES - existing.size);
  for (let offset = 0; offset < pending.length; offset += 8) {
    const batch = pending.slice(offset, offset + 8);
    const metadata = await Promise.all(batch.map(reference => loadActiveImageAssetMetadata(reference.assetId, documentData).catch(() => null)));
    for (let index = 0; index < batch.length; index += 1) {
      const entry = migrateImageLibraryEntry(batch[index], metadata[index]);
      if (entry) additions.push(entry);
    }
  }
  if (!additions.length) return false;
  addImageLibraryEntries(documentData, additions);
  return true;
}

function exportBoundsForNode(nodeId) {
  const entry = findNode(state.document, nodeId);
  if (!entry) return null;
  const node = entry.node;
  const stroke = node.stroke && node.strokeWidth ? node.strokeWidth / 2 : 0;
  const corners = [[-stroke, -stroke], [node.width + stroke, -stroke], [node.width + stroke, node.height + stroke], [-stroke, node.height + stroke]];
  const points = corners.map(([x, y]) => {
    const rotated = rotatePoint({ x, y }, { x: node.width / 2, y: node.height / 2 }, node.rotation || 0);
    let point = { x: rotated.x + node.x, y: rotated.y + node.y };
    for (let index = entry.parents.length - 1; index >= 0; index -= 1) {
      const parent = entry.parents[index];
      point = rotatePoint(point, { x: parent.width / 2, y: parent.height / 2 }, parent.rotation || 0);
      point.x += parent.x; point.y += parent.y;
    }
    return point;
  });
  const xs = points.map(point => point.x); const ys = points.map(point => point.y);
  const left = Math.min(...xs); const top = Math.min(...ys); const right = Math.max(...xs); const bottom = Math.max(...ys);
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function exportDimensions(nodeId, scale = 1) {
  const bounds = exportBoundsForNode(nodeId);
  return bounds ? { width: Math.ceil(bounds.width * scale), height: Math.ceil(bounds.height * scale) } : { width: 0, height: 0 };
}

function exportRenderTree(nodeId) {
  const entry = findNode(state.document, nodeId);
  if (!entry) return null;
  let branch = structuredClone(entry.node);
  for (let index = entry.parents.length - 1; index >= 0; index -= 1) {
    const parent = entry.parents[index];
    const wrapper = structuredClone(parent);
    const maskSource = parent.mask ? parent.children.find(child => child.id === parent.maskSourceId) : null;
    if (maskSource && maskSource.id !== branch.id) wrapper.children = [branch, structuredClone(maskSource)];
    else wrapper.children = [branch];
    wrapper.type = 'group'; wrapper.fill = 'transparent'; wrapper.stroke = null; wrapper.strokeWidth = 0;
    wrapper.fillOpacity = 0;
    delete wrapper.fillStyleId; delete wrapper.fillVariableId;
    if (wrapper.variableBindings) delete wrapper.variableBindings.fill;
    if (!maskSource || maskSource.id === branch.id) { wrapper.mask = false; delete wrapper.maskSourceId; }
    branch = wrapper;
  }
  return branch;
}

function orderedRootSelection() {
  const rows = pageLayerRows();
  const index = new Map(rows.map((entry, position) => [entry.node.id, position]));
  return rootSelectedIds().sort((left, right) => (index.get(left) ?? 0) - (index.get(right) ?? 0));
}

function hasDynamicFrameConstraints(node) {
  const horizontal = node?.constraints?.horizontal || 'left';
  const vertical = node?.constraints?.vertical || 'top';
  // The model stores left/top defaults on every node; only other modes can
  // shift or resize content when an ancestor frame changes size.
  return horizontal !== 'left' || vertical !== 'top';
}

function sliceExportImageDependencyNeeded(node, crop) {
  if (!crop) return true;
  const entry = findNode(state.document, node.id);
  if (!entry) return false;
  const chain = [...entry.parents, node];
  for (const candidate of chain) {
    if (getNodePropertyValue(state.document, candidate, 'visible') === false) return false;
    const opacity = getNodePropertyValue(state.document, candidate, 'opacity');
    if (Number.isFinite(opacity) && opacity <= 0) return false;
  }
  // Bounds from the stored tree are not sufficient when a variable, layout,
  // constraint, or effect can move/extend the rendered pixels. Keep those
  // sources in the refresh set; only cull clear, effect-free off-crop images.
  const unresolvedGeometry = chain.some(candidate =>
    ['x', 'y', 'width', 'height', 'rotation'].some(property => candidate.variableBindings?.[property])
      || Boolean(candidate.autoLayout)
      || hasDynamicFrameConstraints(candidate));
  const effectsCanBleed = chain.some(candidate => candidate.effectStyleId
    || (candidate.effects || []).some(effect => effect.visible !== false
      && (!Number.isFinite(effect.opacity) || effect.opacity > 0)));
  if (unresolvedGeometry || effectsCanBleed) return true;
  const bounds = exportBoundsForNode(node.id);
  return !bounds || sliceRasterBoundsIntersect(crop, bounds);
}

function sliceExportNodeMayAffectCrop(nodeId, crop) {
  const entry = findNode(state.document, nodeId);
  if (!entry) return false;
  const chain = [...entry.parents, entry.node];
  const unresolvedGeometry = chain.some(candidate =>
    ['x', 'y', 'width', 'height', 'rotation'].some(property => candidate.variableBindings?.[property])
      || Boolean(candidate.autoLayout)
      || hasDynamicFrameConstraints(candidate));
  const effectsCanExtendBounds = chain.some(candidate => candidate.effectStyleId
    || (candidate.effects || []).some(effect => effect.visible !== false
      && ['drop-shadow', 'layer-blur'].includes(effect.type)
      && (!Number.isFinite(effect.opacity) || effect.opacity > 0)));
  if (unresolvedGeometry || effectsCanExtendBounds) return true;
  const bounds = exportBoundsForNode(nodeId);
  return !bounds || sliceRasterBoundsIntersect(crop, bounds);
}

function sliceExportRootMayAffectCrop(rootId, crop) {
  const root = findNode(state.document, rootId)?.node;
  if (!root) return false;
  let mayAffect = false;
  walkNodes([root], ({ node }) => {
    if (!mayAffect && sliceExportNodeMayAffectCrop(node.id, crop)) mayAffect = true;
  });
  return mayAffect;
}

function sliceExportBackdropWorldBleed(page, crop, { onBackdropNode = null } = {}) {
  let maximumWorldBleed = 0;
  for (const root of page.children || []) {
    if (root.type === 'slice') continue;
    walkNodes([root], ({ node }) => {
      const effect = firstBackdropEffect(node.effects);
      if (!effect || (effect.type === 'background-blur' && !(effect.radius > 0))
        || (effect.type === 'glass' && !glassVisibleForNode(node))) return;
      const entry = findNode(state.document, node.id);
      if (!entry) return;
      const chain = [...entry.parents, node];
      if (chain.some(candidate => getNodePropertyValue(state.document, candidate, 'visible') === false
        || (Number.isFinite(getNodePropertyValue(state.document, candidate, 'opacity'))
          && getNodePropertyValue(state.document, candidate, 'opacity') <= 0))) return;
      const uncertainBounds = chain.some(candidate =>
        ['x', 'y', 'width', 'height', 'rotation'].some(property => candidate.variableBindings?.[property])
          || Boolean(candidate.autoLayout)
          || hasDynamicFrameConstraints(candidate));
      const bounds = exportBoundsForNode(node.id);
      if (!uncertainBounds && bounds && !sliceRasterBoundsIntersect(crop, bounds)) return;
      onBackdropNode?.(node);
      const worldBleed = effect.type === 'background-blur'
        ? effect.radius * 3
        : glassEffectOverscan(effect);
      maximumWorldBleed = Math.max(maximumWorldBleed, worldBleed);
    });
  }
  return maximumWorldBleed;
}

async function refreshImagesForExport(nodeIds, { crop = null } = {}) {
  const images = new Map();
  for (const id of nodeIds) {
    const node = findNode(state.document, id)?.node;
    if (node) walkNodes([node], ({ node: child }) => {
      if (child.type === 'image' && child.assetId && sliceExportImageDependencyNeeded(child, crop)) {
        const previewKey = imagePreviewKey(child.id);
        images.set(previewKey, { node: child, assetId: child.assetId, adjustments: child.adjustments, transforms: child.transforms, previewKey });
      }
      if (Array.isArray(child.fills)) {
        for (const fill of child.fills) {
          if (fill.type !== 'image' || !fill.visible || fill.opacity <= 0 || !fill.imageFill?.assetId
            || !sliceExportImageDependencyNeeded(child, crop)) continue;
          const previewKey = imagePreviewKey(child.id, fill.id);
          images.set(previewKey, { node: child, fillId: fill.id, previewKey, assetId: fill.imageFill.assetId, adjustments: fill.imageFill.adjustments, transforms: fill.imageFill.transforms });
        }
      } else if (child.imageFill?.assetId && sliceExportImageDependencyNeeded(child, crop)) {
        const previewKey = imagePreviewKey(child.id);
        images.set(previewKey, { node: child, previewKey, assetId: child.imageFill.assetId, adjustments: child.imageFill.adjustments, transforms: child.imageFill.transforms });
      }
    });
  }
  await Promise.all([...images.values()].map(async ({ node, fillId = null, previewKey, assetId, adjustments, transforms }) => {
    const asset = state.assets.get(assetId);
    if (!asset?.sourceBytes) throw new Error(`The original image for “${node.name}” is unavailable on this device.`);
    const status = state.imageStatus.get(previewKey) || '';
    const timer = previewTimers.get(previewKey);
    if (timer) { clearTimeout(timer); previewTimers.delete(previewKey); }
    if (timer || status === 'Updating preview…' || status === 'Processing locally…') {
      await renderImagePreview(node.id, assetId, adjustments, transforms, fillId);
    }
    const hasEdits = hasImageAdjustmentEdits(adjustments)
      || Boolean(transforms?.crop || transforms?.rotation || transforms?.flipHorizontal || transforms?.flipVertical);
    const previewMatchesAsset = state.previews.has(previewKey)
      && (state.previewAssetIds.get(previewKey) == null || state.previewAssetIds.get(previewKey) === assetId);
    if (!previewMatchesAsset && hasEdits) await renderImagePreview(node.id, assetId, adjustments, transforms, fillId);
  }));
}

function safeExportName(value) { return String(value || 'layer').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim() || 'layer'; }

function abortIfExportCanceled(signal) {
  if (signal?.aborted) throw new DOMException('Image export canceled.', 'AbortError');
}

async function renderExportBlob(ids, setting, baseName, { signal, assertCurrent = () => {}, refreshImages = true, replaceKey = null, queueGroup = null } = {}) {
  const checkCurrent = () => { abortIfExportCanceled(signal); assertCurrent(); };
  checkCurrent();
  if (!ids.length) throw new Error('Select a layer to export.');
  const selected = ids.map(id => findNode(state.document, id)?.node).filter(Boolean);
  if (selected.length !== ids.length) throw new Error('The selected layer is no longer available.');
  const slice = ids.length === 1 && selected[0]?.type === 'slice' ? selected[0] : null;
  if (!slice && selected.some(node => node.type === 'slice')) throw new Error('Export a slice by itself so its crop and export settings stay unambiguous.');
  const scale = Number(setting.scale) || 1;
  let left; let top; let width; let height; let renderIds = ids; let slicePlan = null; let sliceSurfacePlan = null;
  let sliceBackdropNodeIds = new Set();
  if (slice) {
    const page = activePage();
    if (!page || !page.children.some(root => root.id === slice.id)) throw new Error('Slices must be top-level layers on the active page.');
    const documentSnapshot = state.document;
    const generationSnapshot = state.documentGeneration;
    const pageIdSnapshot = state.document.activePageId;
    const pageSnapshot = page;
    const saveRevision = state.saveRevision;
    const sliceSignature = JSON.stringify(slice);
    const artworkSignature = sliceExportContentSignature(page.children);
    const callerAssertCurrent = assertCurrent;
    assertCurrent = () => {
      callerAssertCurrent();
      const current = findNode(state.document, slice.id)?.node;
      if (state.document !== documentSnapshot || state.documentGeneration !== generationSnapshot
        || state.documentTransitioning || state.document.activePageId !== pageIdSnapshot
        || activePage() !== pageSnapshot || state.saveRevision !== saveRevision
        || current !== slice || JSON.stringify(current) !== sliceSignature
        || sliceExportContentSignature(pageSnapshot.children) !== artworkSignature) {
        throw new Error('The design or slice changed before export finished. Try again.');
      }
    };
    slicePlan = planSliceRasterExport(sliceExportGeometry(slice), { scale, padding: setting.padding ?? 0 });
    ({ width, height } = slicePlan.outputSize);
    ({ x: left, y: top } = slicePlan.sourceCrop);
    const backdropWorldBleed = sliceExportBackdropWorldBleed(page, slicePlan.sourceCrop, {
      onBackdropNode: node => sliceBackdropNodeIds.add(node.id)
    });
    const bleed = sliceRenderBleedPixels(backdropWorldBleed, scale);
    sliceSurfacePlan = planSliceRenderSurface(slicePlan, bleed);
    renderIds = page.children.map(root => root.id);
  } else {
    const boundsList = ids.map(exportBoundsForNode).filter(Boolean);
    if (!boundsList.length) throw new Error('The selected layer is no longer available.');
    left = Math.min(...boundsList.map(item => item.x)); top = Math.min(...boundsList.map(item => item.y));
    const right = Math.max(...boundsList.map(item => item.x + item.width)); const bottom = Math.max(...boundsList.map(item => item.y + item.height));
    width = Math.max(1, Math.ceil((right - left) * scale)); height = Math.max(1, Math.ceil((bottom - top) * scale));
    if (width > 16_384 || height > 16_384 || width * height > 16_000_000) throw new Error(`This export would be ${width} × ${height} px. Choose a smaller scale to stay within the local memory limit.`);
  }
  checkCurrent();
  if (refreshImages) await refreshImagesForExport(renderIds, slicePlan ? { crop: slicePlan.sourceCrop } : {});
  checkCurrent();
  await document.fonts?.ready;
  checkCurrent();
  const output = document.createElement('canvas'); output.width = width; output.height = height;
  const outputContext = output.getContext('2d', { alpha: setting.format !== 'jpeg' });
  if (!outputContext) throw new Error('This browser could not create an export surface.');
  outputContext.imageSmoothingEnabled = true; outputContext.imageSmoothingQuality = 'high';
  if (setting.format === 'jpeg') { outputContext.fillStyle = '#fff'; outputContext.fillRect(0, 0, width, height); }
  const backdropSampler = slicePlan && sliceSurfacePlan.bleed > 0 ? document.createElement('canvas') : null;
  if (backdropSampler) {
    backdropSampler.width = sliceSurfacePlan.width;
    backdropSampler.height = sliceSurfacePlan.height;
  }
  const samplerContext = backdropSampler?.getContext('2d', { alpha: true }) || null;
  if (backdropSampler && !samplerContext) throw new Error('This browser could not create a backdrop export surface.');
  const baseRenderOptions = { showLayoutGuides: false, outlineMode: false, includeSlices: false };
  const drawExportScene = (context, renderOptions = baseRenderOptions, sceneIds = renderIds) => {
    for (const id of sceneIds) {
      const tree = exportRenderTree(id);
      if (tree) renderer.drawNode(context, tree, 0, 0, state.assets, false, false, renderOptions);
    }
  };
  if (slicePlan) {
    const { padding, sourceCrop } = slicePlan;
    const croppedRenderIds = renderIds.filter(id => sliceExportRootMayAffectCrop(id, sourceCrop));
    if (backdropSampler) {
      samplerContext.imageSmoothingEnabled = true; samplerContext.imageSmoothingQuality = 'high';
      samplerContext.setTransform(scale, 0, 0, scale,
        sliceSurfacePlan.bleed + padding.left - sourceCrop.x * scale,
        sliceSurfacePlan.bleed + padding.top - sourceCrop.y * scale);
      samplerContext.beginPath();
      samplerContext.rect(sourceCrop.x, sourceCrop.y, sourceCrop.width, sourceCrop.height);
      samplerContext.clip();

      const backdropOverlays = new Map();
      let backdropOverlayPixels = 0;
      const cropSamplerBounds = {
        left: sliceSurfacePlan.bleed + padding.left,
        top: sliceSurfacePlan.bleed + padding.top,
        right: sliceSurfacePlan.bleed + padding.left + sourceCrop.width * scale,
        bottom: sliceSurfacePlan.bleed + padding.top + sourceCrop.height * scale
      };
      const captureBackdropOverlay = (nodeId, overlay, geometry) => {
        if (!sliceBackdropNodeIds.has(nodeId) || backdropOverlays.has(nodeId)) return;
        const sourceLeft = Math.max(0, Math.floor((cropSamplerBounds.left - geometry.left) * geometry.rasterScale));
        const sourceTop = Math.max(0, Math.floor((cropSamplerBounds.top - geometry.top) * geometry.rasterScale));
        const sourceRight = Math.min(geometry.pixelWidth, Math.ceil((cropSamplerBounds.right - geometry.left) * geometry.rasterScale));
        const sourceBottom = Math.min(geometry.pixelHeight, Math.ceil((cropSamplerBounds.bottom - geometry.top) * geometry.rasterScale));
        if (sourceRight <= sourceLeft || sourceBottom <= sourceTop) return;
        const snapshotWidth = sourceRight - sourceLeft;
        const snapshotHeight = sourceBottom - sourceTop;
        const snapshotPixels = snapshotWidth * snapshotHeight;
        if (!Number.isSafeInteger(snapshotPixels) || backdropOverlayPixels + snapshotPixels > MAX_SLICE_EXPORT_PIXELS) {
          throw new RangeError(`Backdrop effects for this slice exceed the ${MAX_SLICE_EXPORT_PIXELS.toLocaleString()}-pixel local memory limit. Reduce the slice area or hide some backdrop effects.`);
        }
        const snapshot = document.createElement('canvas');
        snapshot.width = snapshotWidth;
        snapshot.height = snapshotHeight;
        const snapshotContext = snapshot.getContext('2d');
        if (!snapshotContext) throw new Error('This browser could not capture a backdrop effect for slice export.');
        snapshotContext.drawImage(overlay, sourceLeft, sourceTop, snapshotWidth, snapshotHeight, 0, 0, snapshotWidth, snapshotHeight);
        backdropOverlays.set(nodeId, {
          canvas: snapshot,
          offsetX: sourceLeft * geometry.logicalWidth / geometry.pixelWidth,
          offsetY: sourceTop * geometry.logicalHeight / geometry.pixelHeight,
          width: snapshotWidth * geometry.logicalWidth / geometry.pixelWidth,
          height: snapshotHeight * geometry.logicalHeight / geometry.pixelHeight
        });
        backdropOverlayPixels += snapshotPixels;
      };
      drawExportScene(samplerContext, { ...baseRenderOptions, captureBackdropOverlay }, croppedRenderIds);

      outputContext.save();
      outputContext.imageSmoothingEnabled = true; outputContext.imageSmoothingQuality = 'high';
      outputContext.setTransform(scale, 0, 0, scale, padding.left - sourceCrop.x * scale, padding.top - sourceCrop.y * scale);
      outputContext.beginPath();
      outputContext.rect(sourceCrop.x, sourceCrop.y, sourceCrop.width, sourceCrop.height);
      outputContext.clip();
      drawExportScene(outputContext, { ...baseRenderOptions, backdropOverlays }, croppedRenderIds);
      outputContext.restore();
    } else {
      outputContext.imageSmoothingEnabled = true; outputContext.imageSmoothingQuality = 'high';
      outputContext.setTransform(scale, 0, 0, scale, padding.left - sourceCrop.x * scale, padding.top - sourceCrop.y * scale);
      outputContext.beginPath();
      outputContext.rect(sourceCrop.x, sourceCrop.y, sourceCrop.width, sourceCrop.height);
      outputContext.clip();
      drawExportScene(outputContext, baseRenderOptions, croppedRenderIds);
    }
  } else {
    outputContext.imageSmoothingEnabled = true; outputContext.imageSmoothingQuality = 'high';
    outputContext.scale(scale, scale); outputContext.translate(-left, -top);
    drawExportScene(outputContext);
  }
  const mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[setting.format];
  const extension = { png: 'png', jpeg: 'jpg', webp: 'webp' }[setting.format];
  // The scene canvas is only a lossless composition surface. Final PNG, JPEG,
  // and WebP bytes (including lossy quality) are always produced by the
  // shared Pillow-RS worker, so browser codecs cannot silently change quality
  // or format support between devices.
  const rasterized = await new Promise((resolve, reject) => {
    try { output.toBlob(value => value ? resolve(value) : reject(new Error('The browser could not prepare this export for Pillow-RS.')), 'image/png'); }
    catch (error) { reject(error); }
  });
  checkCurrent();
  const sourceBytes = new Uint8Array(await rasterized.arrayBuffer());
  checkCurrent();
  const rasterAssetId = createId('raster-export');
  let rendered = null;
  let blob;
  try {
    rendered = await imageEngine.renderOutput(rasterAssetId, sourceBytes, {}, {}, {
      format: setting.format,
      quality: setting.quality,
      ...(replaceKey ? { replaceKey } : {}),
      ...(queueGroup ? { queueGroup } : {}),
    });
    checkCurrent();
    blob = encodeRenderedImageOutput(rendered, { format: setting.format, quality: setting.quality }).blob;
  } finally {
    rendered?.bytes?.fill(0);
    sourceBytes.fill(0);
    imageEngine.dispose(rasterAssetId);
  }
  checkCurrent();
  if (blob.type !== mime) throw new Error(`${setting.format.toUpperCase()} export is not supported by this browser.`);
  const suffix = String(setting.suffix || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim();
  const scaleSuffix = !suffix && scale !== 1 ? `@${String(scale).replace('.', '_')}x` : suffix;
  const filename = `${safeExportName(baseName)}${scaleSuffix}.${extension}`;
  return { blob, filename, width, height };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function renderAndDownload(ids, setting, baseName) {
  const result = await renderExportBlob(ids, setting, baseName);
  downloadBlob(result.blob, result.filename);
  return result;
}

async function exportLayerWithSetting(nodeId, settingId) {
  const node = findNode(state.document, nodeId)?.node;
  const setting = node?.exportSettings?.find(item => item.id === settingId);
  if (!node || !setting) throw new Error('The export setting no longer exists.');
  const result = await renderAndDownload([nodeId], setting, node.name);
  showToast(`Downloaded ${result.filename} · ${result.width} × ${result.height} px.`);
}

async function exportEditedImageSource(nodeId) {
  if (state.imageExportAbortController) {
    showToast('An image export is already running. Press Escape to cancel it.');
    return;
  }
  const entry = findNode(state.document, nodeId);
  const node = entry?.node;
  if (node?.type !== 'image' || !node.assetId) throw new Error('Select an image with a locally saved original.');
  const asset = state.assets.get(node.assetId);
  if (!asset?.sourceBytes) throw new Error(`The original image for “${node.name}” is unavailable on this device.`);
  const format = node.outputFormat ?? 'png';
  const quality = node.outputQuality ?? 90;
  if (!['png', 'jpeg', 'webp'].includes(format) || !Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error('Choose a supported image format and quality before exporting.');
  }
  const dimensions = assertSafeRasterDimensions(asset.sourceBytes);
  const transformed = transformedImageDimensions(dimensions.width, dimensions.height, node.transforms);

  const documentSnapshot = state.document;
  const generation = state.documentGeneration;
  const pageId = state.document.activePageId;
  const saveRevision = state.saveRevision;
  const nodeSignature = JSON.stringify(node);
  const replaceKey = `image-export:${nodeId}`;
  const controller = new AbortController();
  state.imageExportAbortController = controller;
  controller.signal.addEventListener('abort', () => imageEngine.cancelQueuedByKey(replaceKey), { once: true });
  let memoryReservation = null;
  const assertCurrent = () => {
    abortIfExportCanceled(controller.signal);
    const current = findNode(state.document, nodeId)?.node;
    if (state.document !== documentSnapshot || state.documentGeneration !== generation || state.documentTransitioning
      || state.document.activePageId !== pageId || state.saveRevision !== saveRevision
      || current !== node || JSON.stringify(current) !== nodeSignature) {
      throw new Error('The image or design changed before the edited original finished exporting. Try again.');
    }
  };
  try {
    assertCurrent();
    const memoryBytes = estimateBitmapBytes(transformed.width, transformed.height, 8);
    memoryReservation = imageMemoryBudget.reserve(memoryBytes, { kind: 'image-export' });
    if (!memoryReservation) {
      throw new ImageMemoryLimitError('There is not enough free local image memory for this full-resolution export. Close other large designs or resize the source image.', 'image-export');
    }
    showToast(`Rendering ${node.name || 'image'} from its original pixels… Press Escape to discard the result.`, 5000);
    const rendered = await imageEngine.renderOutput(node.assetId, asset.sourceBytes, node.adjustments, node.transforms, {
      format, quality, replaceKey, queueGroup: `image-export:${generation}`,
    });
    assertCurrent();
    if (rendered.width !== transformed.width || rendered.height !== transformed.height) {
      throw new Error('The full-resolution image dimensions changed during export. Try again.');
    }
    const encoded = await encodeRenderedImageOutput(rendered, { format, quality });
    assertCurrent();
    const extension = { png: 'png', jpeg: 'jpg', webp: 'webp' }[format];
    const filename = `${safeExportName(node.name)}.${extension}`;
    downloadBlob(encoded.blob, filename);
    showToast(`Downloaded edited original · ${encoded.width} × ${encoded.height} px · ${filename}.`);
  } finally {
    if (memoryReservation) imageMemoryBudget.releaseReservation(memoryReservation);
    if (state.imageExportAbortController === controller) state.imageExportAbortController = null;
  }
}

function downloadSvg(markup, filename) {
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function createSvgTextMeasurer() {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return undefined;
  return (text, node) => {
    const fontSize = getNodePropertyValue(state.document, node, 'fontSize') || 24;
    const fontWeight = getNodePropertyValue(state.document, node, 'fontWeight') || 400;
    const letterSpacing = getNodePropertyValue(state.document, node, 'letterSpacing') ?? 0;
    context.font = `${node.fontStyle === 'italic' ? 'italic ' : ''}${fontWeight} ${fontSize}px ${node.fontFamily || 'Arial, sans-serif'}`;
    return measureTrackedText(context, text, letterSpacing);
  };
}

function hasImageAdjustmentEdits(adjustments = {}) {
  return ['exposure', 'temperature', 'tint', 'brightness', 'contrast', 'highlights', 'shadows', 'saturation', 'sharpness', 'blur']
    .some(key => Number(adjustments[key] || 0) !== 0)
    || Boolean(adjustments.autoContrast || adjustments.solarize || adjustments.invert)
    || Number(adjustments.posterizeBits || 0) > 0;
}

async function imagePreviewsForSvgExport(rootNodeIds) {
  const formatLabel = 'SVG';
  await refreshImagesForExport(rootNodeIds);
  const references = new Map();
  for (const id of rootNodeIds) {
    const root = findNode(state.document, id)?.node;
    if (!root) continue;
    walkNodes([root], ({ node, parents }) => {
      if (parents.some(parent => getNodePropertyValue(state.document, parent, 'visible') === false)
        || getNodePropertyValue(state.document, node, 'visible') === false) return;
      if (node.type === 'image' && node.assetId) {
        const previewKey = imagePreviewKey(node.id);
        references.set(previewKey, { node, previewKey, assetId: node.assetId, adjustments: node.adjustments, transforms: node.transforms });
      }
      if (Array.isArray(node.fills)) {
        for (const fill of node.fills) {
          if (fill.type !== 'image' || !fill.visible || fill.opacity <= 0 || !fill.imageFill?.assetId) continue;
          const previewKey = imagePreviewKey(node.id, fill.id);
          references.set(previewKey, { node, fillId: fill.id, previewKey, assetId: fill.imageFill.assetId, adjustments: fill.imageFill.adjustments, transforms: fill.imageFill.transforms });
        }
      } else if (node.imageFill?.assetId) {
        const previewKey = imagePreviewKey(node.id);
        references.set(previewKey, { node, previewKey, assetId: node.imageFill.assetId, adjustments: node.imageFill.adjustments, transforms: node.imageFill.transforms });
      }
    });
  }

  const imagePreviews = new Map();
  const editedReferences = [...references.values()].filter(({ adjustments, transforms }) => hasRasterImageEdits(adjustments, transforms));
  const previewsToRefresh = editedReferences.filter(({ previewKey, assetId }) =>
    state.imageStatus.get(previewKey) !== 'Updated · Pillow-RS WASM'
    || !state.previews.has(previewKey)
    || state.previewAssetIds.get(previewKey) !== assetId);
  const refreshed = await Promise.all(previewsToRefresh.map(({ node, fillId = null, assetId, adjustments, transforms }) =>
    renderImagePreview(node.id, assetId, adjustments, transforms, fillId)));
  if (refreshed.some(rendered => rendered !== true)) {
    throw new Error(`An image changed while ${formatLabel} export was being prepared. Retry the export after its preview updates.`);
  }

  for (const { node, fillId = null, previewKey, assetId, adjustments, transforms } of editedReferences) {
    const preview = state.previews.get(previewKey);
    const previewUrl = state.previewUrls.get(previewKey);
    if (!preview || !previewUrl || state.previewAssetIds.get(previewKey) !== assetId) {
      throw new Error(`The edited preview for “${node.name}” is not ready for ${formatLabel} export.`);
    }
    const settingsSignature = JSON.stringify([assetId, adjustments || {}, transforms || {}]);
    const renderVersion = state.renderVersion.get(previewKey);
    const response = await fetch(previewUrl);
    if (!response.ok) throw new Error(`The edited preview for “${node.name}” could not be read for ${formatLabel} export.`);
    const previewBlob = await response.blob();
    const previewType = String(previewBlob.type || response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (!previewType) throw new Error(`The edited preview for “${node.name}” has no verified image format for ${formatLabel} export.`);
    const sourceBytes = new Uint8Array(await previewBlob.arrayBuffer());
    const currentNode = findNode(state.document, node.id)?.node;
    const currentImageFill = fillId
      ? currentNode?.fills?.find(fill => fill.id === fillId)?.imageFill
      : currentNode?.type === 'image' ? currentNode : currentNode?.imageFill;
    const currentSettings = [currentImageFill?.assetId, currentImageFill?.adjustments || {}, currentImageFill?.transforms || {}];
    if (!currentNode || state.renderVersion.get(previewKey) !== renderVersion
      || JSON.stringify(currentSettings) !== settingsSignature
      || state.imageStatus.get(previewKey) !== 'Updated · Pillow-RS WASM') {
      throw new Error(`The image “${node.name}” changed while ${formatLabel} export was being prepared. Retry the export after its preview updates.`);
    }
    imagePreviews.set(previewKey, {
      type: previewType,
      sourceBytes,
      width: preview.width,
      height: preview.height,
    });
  }
  return imagePreviews;
}

async function exportSelectedNodeSvg(nodeId) {
  const generation = state.documentGeneration;
  const node = findNode(state.document, nodeId)?.node;
  if (!node) throw new Error('The selected layer is no longer available.');
  const imagePreviews = await imagePreviewsForSvgExport([nodeId]);
  if (generation !== state.documentGeneration || findNode(state.document, nodeId)?.node !== node) throw new Error('The active design changed before SVG export finished.');
  const markup = exportNodeToSvg(node, { document: state.document, assets: state.assets, imagePreviews, measureText: createSvgTextMeasurer() });
  const filename = `${safeExportName(node.name)}.svg`;
  downloadSvg(markup, filename);
  showToast(`Downloaded editable SVG · ${filename}.`);
}

async function exportActivePageSvg() {
  const generation = state.documentGeneration;
  const page = activePage();
  if (!page) throw new Error('There is no active page to export.');
  const imagePreviews = await imagePreviewsForSvgExport(page.children.map(node => node.id));
  if (generation !== state.documentGeneration || activePage() !== page) throw new Error('The active design changed before SVG export finished.');
  const markup = exportPageToSvg(page, { document: state.document, assets: state.assets, imagePreviews, measureText: createSvgTextMeasurer() });
  const filename = `${safeExportName(page.name || 'Page')}.svg`;
  downloadSvg(markup, filename);
  showToast(`Downloaded editable page SVG · ${filename}.`);
}

async function exportRasterPdf(frameIds, { page = activePage(), baseName = page?.name || 'Page' } = {}) {
  if (state.imageExportAbortController) {
    showToast('An export is already running. Press Escape to cancel it.');
    return;
  }
  const uniqueIds = [...new Set(frameIds)];
  if (!uniqueIds.length) throw new Error('Choose at least one frame to export as a raster PDF.');
  const doc = state.document;
  const generation = state.documentGeneration;
  const pageId = page?.id;
  if (!page || page !== activePage()) throw new Error('The active page changed before PDF export started.');
  const pageSignature = JSON.stringify(page);
  const frames = uniqueIds.map(id => {
    const found = findNode(doc, id);
    if (found?.node?.type !== 'frame') throw new Error('Raster PDF export supports frames only.');
    return { id, node: found.node, signature: JSON.stringify(found.node) };
  });
  const assertCurrent = () => {
    abortIfExportCanceled(controller.signal);
    if (state.document !== doc || state.documentGeneration !== generation || state.documentTransitioning
      || state.document.activePageId !== pageId || activePage() !== page || JSON.stringify(page) !== pageSignature) {
      throw new Error('The design changed while the raster PDF was being prepared. Retry the export.');
    }
    for (const frame of frames) {
      const current = findNode(state.document, frame.id)?.node;
      if (current !== frame.node || JSON.stringify(current) !== frame.signature) {
        throw new Error(`Frame “${frame.node.name || 'Frame'}” changed while the raster PDF was being prepared. Retry the export.`);
      }
    }
  };
  const controller = new AbortController();
  const queueKey = `raster-pdf:${generation}:${Date.now()}`;
  state.imageExportAbortController = controller;
  controller.signal.addEventListener('abort', () => imageEngine.cancelQueuedByKey(queueKey), { once: true });
  const jpegPages = [];
  let pdfBytes = null;
  let aggregateBytes = 0;
  try {
    showToast(`Rendering ${frames.length} frame${frames.length === 1 ? '' : 's'} for raster PDF… Press Escape to cancel.`, 5000);
    for (let index = 0; index < frames.length; index += 1) {
      assertCurrent();
      const frame = frames[index];
      showToast(`Rendering PDF page ${index + 1} of ${frames.length}… Press Escape to cancel.`, 5000);
      const rendered = await renderExportBlob([frame.id], { format: 'jpeg', quality: 92, scale: 1, suffix: '' }, frame.node.name, {
        signal: controller.signal,
        assertCurrent,
        replaceKey: queueKey,
        queueGroup: `raster-pdf:${generation}`,
      });
      assertCurrent();
      if (rendered.blob.type !== 'image/jpeg') throw new Error('Pillow-RS did not return a JPEG page for the raster PDF.');
      if (aggregateBytes + rendered.blob.size > PDF_EXPORT_JPEG_LIMIT) {
        throw new RangeError(`This raster PDF exceeds the local ${Math.round(PDF_EXPORT_JPEG_LIMIT / 1024 / 1024)} MiB JPEG limit. Export fewer or smaller frames.`);
      }
      const jpeg = new Uint8Array(await rendered.blob.arrayBuffer());
      assertCurrent();
      if (jpeg.byteLength !== rendered.blob.size) throw new Error('The rendered JPEG page changed size while being read.');
      aggregateBytes += jpeg.byteLength;
      jpegPages.push({ jpeg, width: rendered.width, height: rendered.height });
    }
    assertCurrent();
    pdfBytes = createMultipagePdf(jpegPages, { maxAggregateJpegBytes: PDF_EXPORT_JPEG_LIMIT });
    assertCurrent();
    const filename = `${safeExportName(baseName)}${frames.length > 1 ? '-frames' : ''}.pdf`;
    downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), filename);
    showToast(`Downloaded ${frames.length}-page raster PDF · ${filename}. SVG remains the editable vector export.`);
  } catch (error) {
    if (error?.name === 'AbortError') showToast('Raster PDF export canceled. No PDF was downloaded.');
    else throw error;
  } finally {
    for (const pageItem of jpegPages) pageItem.jpeg.fill(0);
    pdfBytes?.fill(0);
    if (state.imageExportAbortController === controller) state.imageExportAbortController = null;
  }
}

async function exportSelectedFrameRasterPdf(frameId) {
  const frame = findNode(state.document, frameId)?.node;
  if (frame?.type !== 'frame') throw new Error('Select a frame to export a raster PDF.');
  await exportRasterPdf([frameId], { baseName: frame.name || 'Frame' });
}

async function exportActivePageRasterPdf() {
  const page = activePage();
  if (!page) throw new Error('There is no active page to export.');
  const frameIds = orderedVisibleFrameIds(page.children);
  if (!frameIds.length) throw new Error('The current page has no visible top-level frames to export.');
  await exportRasterPdf(frameIds, { page, baseName: page.name || 'Page' });
}

function assertVectorPdfTreeSupported(documentSnapshot, frame) {
  const assertRasterSource = (node, { assetId, adjustments, transforms }) => {
    const label = node.name || (node.type === 'image' ? 'Image' : 'Layer');
    const asset = state.assets.get(assetId);
    const plan = planVectorPdfRasterSource({ asset, adjustments, transforms });
    if (plan.kind === 'missing-source') {
      throw new PdfVectorExportError('local raster image source', `layer “${label}” has no retained original bytes; restore or reimport the image before exporting`);
    }
    if (plan.kind === 'invalid-adjustments') {
      throw new PdfVectorExportError('raster image adjustments', `layer “${label}” has unsupported or invalid settings; reset its image adjustments before exporting`);
    }
    if (plan.kind === 'unsupported') {
      const source = plan.sourceMimeType || 'unknown image format';
      throw new PdfVectorExportError('embedded raster image', `layer “${label}” uses ${source}; untouched vector-PDF images must be PNG or JPEG. Convert the source to PNG/JPEG or use raster PDF`);
    }
  };
  walkNodes([frame], ({ node, parents }) => {
    if (parents.some(parent => getNodePropertyValue(documentSnapshot, parent, 'visible') === false)
      || getNodePropertyValue(documentSnapshot, node, 'visible') === false) return;
    if (parents.some(parent => Number(getNodePropertyValue(documentSnapshot, parent, 'opacity') ?? 1) === 0)
      || Number(getNodePropertyValue(documentSnapshot, node, 'opacity') ?? 1) === 0) return;
    if (node.type === 'text') {
      throw new PdfVectorExportError('text', `layer “${node.name || 'Text'}” cannot be represented by the current vector PDF writer`);
    }
    if (node.type === 'image') assertRasterSource(node, node);
    const glassVectorBlock = glassVectorExportBlockReason(node);
    if (glassVectorBlock) throw new PdfVectorExportError('Glass effects', `layer “${node.name || 'Layer'}”: ${glassVectorBlock}`);
    assertVectorPdfEffectsSupported(node);
    const fills = Array.isArray(node.fills) ? node.fills : [];
    for (const fill of fills) {
      if (fill?.type !== 'image' || !fill.visible || Number(fill.opacity ?? 1) <= 0) continue;
      assertRasterSource(node, fill.imageFill || {});
    }
    if (!fills.length && node.imageFill && Number(node.fillOpacity ?? 1) > 0) {
      assertRasterSource(node, node.imageFill);
    }
  });
}

function vectorPdfRasterReferences(rootNodeIds) {
  const references = new Map();
  for (const id of rootNodeIds) {
    const root = findNode(state.document, id)?.node;
    if (!root) continue;
    walkNodes([root], ({ node, parents }) => {
      if (parents.some(parent => getNodePropertyValue(state.document, parent, 'visible') === false
        || Number(getNodePropertyValue(state.document, parent, 'opacity') ?? 1) === 0)
        || getNodePropertyValue(state.document, node, 'visible') === false
        || Number(getNodePropertyValue(state.document, node, 'opacity') ?? 1) === 0) return;
      if (node.type === 'image' && node.assetId) {
        const previewKey = imagePreviewKey(node.id);
        references.set(previewKey, {
          node, previewKey, assetId: node.assetId,
          adjustments: node.adjustments, transforms: node.transforms,
        });
      }
      if (Array.isArray(node.fills)) {
        for (const fill of node.fills) {
          if (fill.type !== 'image' || !fill.visible || Number(fill.opacity ?? 1) <= 0 || !fill.imageFill?.assetId) continue;
          const previewKey = imagePreviewKey(node.id, fill.id);
          references.set(previewKey, {
            node, fillId: fill.id, previewKey, assetId: fill.imageFill.assetId,
            adjustments: fill.imageFill.adjustments, transforms: fill.imageFill.transforms,
          });
        }
      } else if (node.imageFill?.assetId && Number(node.fillOpacity ?? 1) > 0) {
        const previewKey = imagePreviewKey(node.id);
        references.set(previewKey, {
          node, previewKey, assetId: node.imageFill.assetId,
          adjustments: node.imageFill.adjustments, transforms: node.imageFill.transforms,
        });
      }
    });
  }
  return [...references.values()].map(reference => {
    const asset = state.assets.get(reference.assetId);
    const plan = planVectorPdfRasterSource({ asset, adjustments: reference.adjustments, transforms: reference.transforms });
    return { ...reference, plan };
  });
}

async function vectorPdfImagePreviews(rootNodeIds, { controller, assertCurrent, pendingQueueKeys, queueGroup }) {
  const previews = new Map();
  let firstFailure = null;
  const references = vectorPdfRasterReferences(rootNodeIds);
  let aggregateImageBytes = 0;
  for (const { assetId, plan } of references) {
    if (plan.kind === 'source') {
      const sourceBytes = state.assets.get(assetId)?.sourceBytes;
      aggregateImageBytes = addVectorPdfEmbeddedImageBytes(aggregateImageBytes, sourceBytes.byteLength);
    } else if (plan.kind !== 'png-preview') {
      throw new PdfVectorExportError('embedded raster image', 'a visible image source changed after PDF preflight; retry the export');
    }
  }
  const previewReferences = references.filter(reference => reference.plan.kind === 'png-preview');
  for (const reference of previewReferences) {
    const asset = state.assets.get(reference.assetId);
    const sourceDimensions = inspectRasterDimensions(asset.sourceBytes);
    if (!sourceDimensions) {
      throw new PdfVectorExportError('edited raster image preview', `layer “${reference.node.name || 'Image'}” has an invalid or unsupported local source header`);
    }
    reference.expectedDimensions = transformedImageDimensions(sourceDimensions.width, sourceDimensions.height, reference.transforms);
  }
  const tasks = previewReferences.map(async ({ node, previewKey, assetId, adjustments, transforms, expectedDimensions }) => {
    abortIfExportCanceled(controller.signal);
    assertCurrent();
    const asset = state.assets.get(assetId);
    if (!asset?.sourceBytes) throw new PdfVectorExportError('local raster image source', `layer “${node.name || 'Image'}” no longer has retained original bytes`);
    const replaceKey = `vector-pdf-preview:${queueGroup}:${previewKey}`;
    pendingQueueKeys.add(replaceKey);
    let rendered = null;
    try {
      rendered = await imageEngine.render(assetId, asset.sourceBytes, adjustments ?? defaultImageAdjustments, transforms, {
        format: 'png', quality: 100, replaceKey, queueGroup,
      });
      abortIfExportCanceled(controller.signal);
      assertCurrent();
      if (rendered.mimeType !== 'image/png') throw new Error(`Pillow-RS returned ${rendered.mimeType || 'unknown bytes'} instead of PNG.`);
      if (rendered.width !== expectedDimensions.width || rendered.height !== expectedDimensions.height) {
        throw new Error('Pillow-RS returned dimensions that do not match the edited image.');
      }
      if (!(rendered.bytes instanceof Uint8Array) || rendered.bytes.byteLength === 0) {
        throw new Error('Pillow-RS returned an empty PNG preview.');
      }
      aggregateImageBytes = addVectorPdfEmbeddedImageBytes(aggregateImageBytes, rendered.bytes.byteLength);
      previews.set(previewKey, {
        type: 'image/png', sourceBytes: rendered.bytes,
        width: rendered.width, height: rendered.height,
      });
      rendered = null;
    } catch (error) {
      rendered?.bytes?.fill?.(0);
      if (error?.name !== 'AbortError' && !firstFailure) {
        firstFailure = error instanceof VectorPdfImageBudgetError
          ? error
          : new PdfVectorExportError('edited raster image preview', `layer “${node.name || 'Image'}” could not be rendered to PNG by local Pillow-RS (${error.message || 'unsupported source or edit'}). Use a local PNG/JPEG source with supported edits, or export as raster PDF`);
        controller.abort();
      }
      throw error;
    } finally {
      pendingQueueKeys.delete(replaceKey);
    }
  });
  const results = await Promise.allSettled(tasks);
  const clearPreviews = () => { for (const preview of previews.values()) preview.sourceBytes.fill(0); };
  if (firstFailure) { clearPreviews(); throw firstFailure; }
  const failed = results.find(result => result.status === 'rejected');
  if (failed) { clearPreviews(); throw failed.reason; }
  try {
    abortIfExportCanceled(controller.signal);
    assertCurrent();
  } catch (error) {
    clearPreviews();
    throw error;
  }
  return previews;
}

async function exportVectorPdf(frameIds, { page = activePage(), baseName = page?.name || 'Page' } = {}) {
  if (state.imageExportAbortController) throw new Error('An export is already running. Press Escape to cancel it.');
  const uniqueIds = [...new Set(frameIds)];
  if (!uniqueIds.length) throw new Error('Choose at least one frame to export as a vector PDF.');
  const documentSnapshot = state.document;
  const generation = state.documentGeneration;
  const pageId = page?.id;
  if (!page || page !== activePage()) throw new Error('The active page changed before vector PDF export started.');
  const pageSignature = JSON.stringify(page);
  const frames = uniqueIds.map(id => {
    const found = findNode(documentSnapshot, id);
    if (found?.node?.type !== 'frame') throw new Error('Vector PDF export supports frames only.');
    return { id, node: found.node, signature: JSON.stringify(found.node) };
  });
  const assertCurrent = () => {
    abortIfExportCanceled(controller.signal);
    if (state.document !== documentSnapshot || state.documentGeneration !== generation || state.documentTransitioning
      || state.document.activePageId !== pageId || activePage() !== page || JSON.stringify(page) !== pageSignature) {
      throw new Error('The design changed while the vector PDF was being prepared. Retry the export.');
    }
    for (const frame of frames) {
      const current = findNode(state.document, frame.id)?.node;
      if (current !== frame.node || JSON.stringify(current) !== frame.signature) {
        throw new Error(`Frame “${frame.node.name || 'Frame'}” changed while the vector PDF was being prepared. Retry the export.`);
      }
    }
  };
  const controller = new AbortController();
  const pendingQueueKeys = new Set();
  const queueGroup = `vector-pdf:${generation}:${Date.now()}`;
  state.imageExportAbortController = controller;
  controller.signal.addEventListener('abort', () => {
    for (const key of pendingQueueKeys) imageEngine.cancelQueuedByKey(key);
  }, { once: true });
  let imagePreviews = new Map();
  let pdfBytes = null;
  try {
    assertCurrent();
    showToast(`Preparing ${frames.length} frame${frames.length === 1 ? '' : 's'} for vector PDF… Press Escape to cancel.`, 5000);
    const measureText = createSvgTextMeasurer();
    for (const { node } of frames) {
      assertCurrent();
      assertVectorPdfTreeSupported(documentSnapshot, node);
    }
    imagePreviews = await vectorPdfImagePreviews(frames.map(frame => frame.id), {
      controller, assertCurrent, pendingQueueKeys, queueGroup,
    });
    assertCurrent();
    const svgPages = frames.map(({ node }) => {
      assertCurrent();
      return exportNodeToSvg(node, {
        document: documentSnapshot,
        assets: state.assets,
        imagePreviews,
        measureText,
      });
    });
    assertCurrent();
    pdfBytes = createMultipageVectorPdf(svgPages);
    assertCurrent();
    const filename = `${safeExportName(baseName)}${frames.length > 1 ? '-frames' : ''}.pdf`;
    downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), filename);
    showToast(`Downloaded ${frames.length}-page vector PDF · ${filename}.`);
  } catch (error) {
    if (error?.name === 'AbortError') showToast('Vector PDF export canceled. No PDF was downloaded.');
    else throw error;
  } finally {
    for (const preview of imagePreviews.values()) preview.sourceBytes?.fill?.(0);
    pdfBytes?.fill(0);
    if (state.imageExportAbortController === controller) state.imageExportAbortController = null;
  }
}

async function exportSelectedFrameVectorPdf(frameId) {
  const frame = findNode(state.document, frameId)?.node;
  if (frame?.type !== 'frame') throw new Error('Select a frame to export a vector PDF.');
  await exportVectorPdf([frameId], { baseName: frame.name || 'Frame' });
}

async function exportActivePageVectorPdf() {
  const page = activePage();
  if (!page) throw new Error('There is no active page to export.');
  const frameIds = orderedVisibleFrameIds(page.children);
  if (!frameIds.length) throw new Error('The current page has no visible top-level frames to export.');
  await exportVectorPdf(frameIds, { page, baseName: page.name || 'Page' });
}

async function exportSelectionPng() {
  const ids = orderedRootSelection();
  const selected = ids.map(id => findNode(state.document, id)?.node).filter(Boolean);
  if (ids.length > 1 && selected.length === ids.length && selected.every(node => node.type === 'image')) {
    await exportImageSelectionArchive(ids, selected);
    return;
  }
  const names = selected.map(node => node.name).filter(Boolean);
  const single = ids.length === 1 ? findNode(state.document, ids[0])?.node : null;
  const setting = single?.type === 'slice'
    ? single.exportSettings?.[0] || { format: 'png', scale: 1, suffix: '', quality: 90, padding: 0 }
    : single?.type === 'image'
      ? { format: single.outputFormat ?? 'png', scale: 1, suffix: '', quality: single.outputQuality ?? 90 }
      : { format: 'png', scale: 1, suffix: '', quality: 90 };
  try { await renderAndDownload(ids, setting, names.length === 1 ? names[0] : `selection-${names.length}`); }
  catch (error) { showToast(error.message || 'Could not export this selection.'); }
}

async function exportSliceById(sliceId) {
  const slice = findNode(state.document, sliceId)?.node;
  if (slice?.type !== 'slice') { showToast('This slice is no longer available.'); return; }
  const setting = slice.exportSettings?.[0] || { format: 'png', scale: 1, suffix: '', quality: 90, padding: 0 };
  try {
    const result = await renderAndDownload([sliceId], setting, slice.name);
    showToast(`Downloaded ${result.filename} · ${result.width} × ${result.height} px.`);
  } catch (error) {
    showToast(error.message || 'Could not export this slice.');
  }
}

async function exportImageSelectionArchive(ids, images) {
  if (state.imageExportAbortController) {
    showToast('An image export is already running. Press Escape to cancel it.');
    return;
  }
  let plan;
  try { plan = planImageArchive(images); }
  catch (error) { showToast(error.message || 'These images could not be exported together.'); return; }

  const generation = state.documentGeneration;
  const documentSnapshot = state.document;
  const pageId = state.document.activePageId;
  const saveRevision = state.saveRevision;
  const targets = plan.map(item => {
    const node = findNode(documentSnapshot, item.id)?.node;
    return { ...item, node, signature: JSON.stringify(node), assetId: node?.assetId, previewKey: imagePreviewKey(item.id) };
  });
  const controller = new AbortController();
  state.imageExportAbortController = controller;
  const assertCurrent = () => {
    abortIfExportCanceled(controller.signal);
    if (state.document !== documentSnapshot || state.documentGeneration !== generation || state.documentTransitioning
      || state.document.activePageId !== pageId || state.saveRevision !== saveRevision) {
      throw new Error('The design changed before the image archive finished. Try the export again.');
    }
    for (const target of targets) {
      const current = findNode(state.document, target.id)?.node;
      if (!current || current !== target.node || current.type !== 'image' || current.assetId !== target.assetId
        || JSON.stringify(current) !== target.signature) {
        throw new Error(`Image “${target.node?.name || target.id}” changed before the archive finished. Try the export again.`);
      }
    }
  };
  try {
    assertCurrent();
    await document.fonts?.ready;
    assertCurrent();
    const files = [];
    let outputBytes = 0;
    assertImageArchiveFits(plan, outputBytes);
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index];
      const target = targets[index];
      assertCurrent();
      showToast(`Preparing image ${index + 1} of ${plan.length}…`, 4000);
      await refreshImagesForExport([item.id]);
      assertCurrent();
      const previewVersion = state.renderVersion.get(target.previewKey) ?? null;
      const assertImageCurrent = () => {
        assertCurrent();
        if ((state.renderVersion.get(target.previewKey) ?? null) !== previewVersion) {
          throw new Error(`The processed preview for “${target.node.name}” changed before the archive finished. Try the export again.`);
        }
      };
      const baseName = item.filename.slice(0, -(item.format === 'jpeg' ? 4 : item.format === 'webp' ? 5 : 4));
      const rendered = await renderExportBlob([item.id], {
        format: item.format, scale: 1, suffix: '', quality: item.quality
      }, baseName, { signal: controller.signal, assertCurrent: assertImageCurrent, refreshImages: false });
      assertImageCurrent();
      const nextOutputBytes = outputBytes + rendered.blob.size;
      assertImageArchiveFits(plan, nextOutputBytes);
      outputBytes = nextOutputBytes;
      files.push({ name: item.filename, data: rendered.blob });
    }
    assertCurrent();
    const archive = await createStoredZip(files, { signal: controller.signal });
    assertCurrent();
    downloadBlob(archive, `${safeExportName(documentSnapshot.name || 'Images')}-images.zip`);
    showToast(`Downloaded ${files.length} separate images in one ZIP archive.`);
  } catch (error) {
    if (error?.name !== 'AbortError') showToast(error.message || 'Could not export the selected images.');
  } finally {
    if (state.imageExportAbortController === controller) state.imageExportAbortController = null;
  }
}

function updateLayoutGuide(input, finalize = false) {
  const node = selectedNodes()[0];
  const guide = node?.layoutGuides?.find(item => item.id === input.dataset.guideId);
  if (node?.type !== 'frame' || !guide) return;
  const property = input.dataset.guideField;
  let value = input.value;
  if (property === 'opacity') value = Number(value) / 100;
  else if (input.type === 'number') {
    value = Number(value);
    if (!Number.isFinite(value) || value < Number(input.min) || value > Number(input.max) || (property === 'count' && !Number.isInteger(value))) {
      if (finalize) {
        const hadEdit = state.layoutGuideControlEdit;
        state.layoutGuideControlEdit = false; renderInspector();
        if (hadEdit) queueSave();
      }
      return;
    }
  }
  if (property === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) return;
  if (guide[property] !== value) {
    if (!state.layoutGuideControlEdit) { checkpoint('Edit layout guide'); state.layoutGuideControlEdit = true; }
    guide[property] = value;
    if (property === 'type') {
      const valid = value === 'columns' ? ['stretch', 'left', 'center', 'right'] : value === 'rows' ? ['stretch', 'top', 'center', 'bottom'] : [];
      if (value !== 'grid' && !valid.includes(guide.alignment)) guide.alignment = 'stretch';
    }
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'layoutGuides');
    renderer.invalidate();
  }
  if (finalize && state.layoutGuideControlEdit) {
    state.layoutGuideControlEdit = false;
    renderInspector(); queueSave();
  }
}

function updateExportSetting(input) {
  const node = selectedNodes()[0];
  const setting = node?.exportSettings?.find(item => item.id === input.dataset.exportId);
  if (!node || !setting) return;
  const property = input.dataset.exportField;
  const value = ['scale', 'quality', 'padding'].includes(property) ? Number(input.value) : input.value;
  if (property === 'padding' && (node.type !== 'slice' || !Number.isInteger(value) || value < 0 || value > 10_000)) {
    renderInspector();
    return;
  }
  if (setting[property] === value) return;
  checkpoint('Update export setting');
  setting[property] = value;
  const instanceRoot = componentInstanceRoot(node.id);
  if (instanceRoot) recordComponentOverride(instanceRoot, node, 'exportSettings');
  renderInspector(); queueSave();
}

async function copyInspectText(kind) {
  const text = buildInspectOutput(state.document, selectedEntries())[kind];
  if (!text) { showToast('Select a layer before copying handoff data.'); return; }
  const label = ({ css: 'CSS', html: 'HTML', jsx: 'React JSX', vue: 'Vue SFC', json: 'Layer JSON' })[kind] || 'Handoff data';
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} copied.`);
    return;
  } catch { /* Use the selection-based fallback when clipboard access is unavailable. */ }
  const field = document.createElement('textarea');
  field.value = text; field.setAttribute('readonly', ''); field.setAttribute('aria-hidden', 'true');
  field.style.position = 'fixed'; field.style.left = '-9999px'; field.style.top = '0';
  document.body.append(field); field.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* A blocked clipboard can still be copied from the visible code block. */ }
  field.remove();
  showToast(copied ? `${label} copied.` : 'Clipboard unavailable. Select the code block and copy it.');
}

function applyInspectorAction(action, details = {}) {
  const node = selectedNodes()[0];
  if (node?.type === 'slice' && ['edit-prototype-interaction', 'prototype-connect', 'prototype-start', 'present'].includes(action)) {
    showToast('Slices are export regions and cannot trigger prototype actions.');
    return;
  }
  if (action === 'toggle-gradient-geometry') {
    if (!node || node.locked) return;
    const target = {
      nodeId: details.gradientNodeId || node.id,
      ...(details.fillId ? { fillId: details.fillId } : {}),
      ...(details.strokeId ? { strokeId: details.strokeId } : {})
    };
    if (!gradientGeometryContext(target)) return;
    state.gradientGeometryTarget = gradientGeometryTargetMatches(state.gradientGeometryTarget, target) ? null : target;
    for (const button of $$('[data-action="toggle-gradient-geometry"]')) {
      const buttonTarget = {
        nodeId: button.dataset.gradientNodeId,
        ...(button.dataset.fillId ? { fillId: button.dataset.fillId } : {}),
        ...(button.dataset.strokeId ? { strokeId: button.dataset.strokeId } : {})
      };
      const active = gradientGeometryTargetMatches(state.gradientGeometryTarget, buttonTarget);
      button.setAttribute('aria-pressed', String(active));
      button.textContent = active ? 'Done editing on canvas' : 'Edit geometry on canvas';
      const fields = button.parentElement?.querySelector('.gradient-geometry-fields');
      if (fields) fields.hidden = !active;
    }
    renderer.invalidate();
    return;
  }
  if (action === 'add-stroke-gradient-stop' || action === 'remove-stroke-gradient-stop') {
    if (!node || node.locked) return;
    const stroke = ensureStrokeStack(node).find(item => item.id === details.strokeId);
    if (!stroke?.gradient) return;
    const gradient = structuredClone(stroke.gradient);
    if (action === 'add-stroke-gradient-stop') {
      const inserted = insertGradientStopInLargestGap(gradient);
      if (!inserted) { showToast('A gradient can have up to 8 color stops.'); return; }
      checkpoint('Add stroke gradient stop');
      updateStroke(node, stroke.id, { gradient: inserted });
    } else {
      if (gradient.stops.length <= 2 || !gradient.stops.some(stop => stop.id === details.stopId)) return;
      gradient.stops = gradient.stops.filter(stop => stop.id !== details.stopId);
      checkpoint('Remove stroke gradient stop');
      updateStroke(node, stroke.id, { gradient });
    }
    recordNodeComponentOverrides(node, ['strokes', 'stroke', 'strokeWidth', 'strokeOpacity', 'strokeCap', 'strokeJoin', 'strokePattern', 'strokeMiterLimit']);
    renderInspector(); queueSave(); renderer.invalidate();
    return;
  }
  if (action === 'save-image-recipe') { saveRecipeFor(details.nodeId || node?.id); return; }
  if (action === 'toggle-image-crop-mode') {
    if (details.transformTarget === 'fill') {
      const context = node && imageFillCropContext(node, details.fillId);
      if (!context) { showToast('Choose an image fill using Fill before adjusting it on the canvas.'); return; }
      const alreadyActive = state.imageCropMode
        && state.imageFillCropTarget?.nodeId === node.id
        && state.imageFillCropTarget?.fillId === details.fillId;
      if (state.interaction?.kind === 'image-fill-crop') cancelCanvasInteraction();
      state.imageCropMode = !alreadyActive;
      state.imageFillCropTarget = alreadyActive ? null : { nodeId: node.id, fillId: details.fillId };
    } else {
      if (node?.type !== 'image' || node.locked || !imageCropContext(node)) return;
      if (state.interaction?.kind === 'image-crop') cancelCanvasInteraction({ pointerId: state.interaction.pointerId });
      state.imageCropMode = !state.imageCropMode;
      state.imageFillCropTarget = null;
    }
    state.imageCropDraftSelection = null;
    syncImageCropOverlay();
    renderInspector();
    renderer.invalidate();
    return;
  }
  if (['add-stroke', 'remove-stroke', 'move-stroke'].includes(action)) {
    if (!node || node.locked) return;
    const strokes = ensureStrokeStack(node);
    const previousPrimary = strokes[0];
    const hadPrimaryBinding = Boolean(node.strokeVariableId || node.variableBindings?.stroke);
    const previousPrimaryColor = hadPrimaryBinding ? getNodeColor(state.document, node, 'stroke') : null;
    if (action === 'add-stroke') {
      if (strokes.length >= MAX_STROKES_PER_NODE) { showToast(`A layer can have up to ${MAX_STROKES_PER_NODE} strokes.`); return; }
      checkpoint('Add stroke');
      addStroke(node, createStroke());
    } else {
      const index = strokes.findIndex(stroke => stroke.id === details.strokeId);
      if (index < 0) return;
      if (action === 'remove-stroke') {
        checkpoint('Remove stroke'); removeStroke(node, details.strokeId);
      } else {
        const nextIndex = index + (details.direction === 'up' ? -1 : 1);
        if (nextIndex < 0 || nextIndex >= strokes.length) return;
        checkpoint('Reorder strokes'); moveStroke(node, details.strokeId, details.direction);
      }
    }
    if (hadPrimaryBinding && strokes[0] !== previousPrimary) detachPrimaryStrokeBinding(node, previousPrimary, previousPrimaryColor);
    syncLegacyStrokeFields(node);
    recordNodeComponentOverrides(node, ['strokes', 'stroke', 'strokeWidth', 'strokeOpacity', 'strokeCap', 'strokeJoin', 'strokePattern', 'strokeMiterLimit', 'strokeVariableId', 'variableBindings']);
    renderInspector(); queueSave(); renderer.invalidate();
    return;
  }
  if (action === 'add-fill-layer' || action === 'remove-fill-layer' || action === 'move-fill-layer') {
    if (!node || node.locked) return;
    const fills = ensureFillStack(node);
    const previousPrimary = fills[0];
    const hadPrimaryBinding = Boolean(node.fillStyleId || node.fillVariableId || node.variableBindings?.fill);
    const previousPrimaryColor = hadPrimaryBinding ? getNodeColor(state.document, node, 'fill') : null;
    let primaryChanged = false;
    if (action === 'add-fill-layer') {
      if (fills.length >= 32) { showToast('A layer can have up to 32 fills.'); return; }
      const type = details.fillType || 'solid';
      try {
        const resolvedColor = getNodeColor(state.document, node, 'fill');
        const fill = type === 'image'
          ? createFillLayer('image', { assetId: imageFillSources()[0]?.assetId })
          : createFillLayer(type, type === 'solid' ? { color: /^#[0-9a-f]{6}$/i.test(resolvedColor) ? resolvedColor : '#d9d9d9' } : {});
        checkpoint('Add fill'); addFillLayer(node, fill);
      } catch (error) { showToast(error.message); return; }
    } else {
      const index = fills.findIndex(fill => fill.id === details.fillId);
      if (index < 0) return;
      if (action === 'remove-fill-layer') { checkpoint('Remove fill'); removeFillLayer(node, details.fillId); primaryChanged = fills[0] !== previousPrimary; }
      else {
        const nextIndex = index + (details.direction === 'up' ? -1 : 1);
        if (nextIndex < 0 || nextIndex >= fills.length) return;
        checkpoint('Reorder fills');
        moveFillLayer(node, details.fillId, details.direction);
        primaryChanged = fills[0] !== previousPrimary;
      }
    }
    if (primaryChanged && hadPrimaryBinding) detachPrimaryFillBinding(node, previousPrimary, previousPrimaryColor);
    syncLegacyFillFields(node);
    reconcileImagePreviewRuntime();
    recordNodeComponentOverrides(node, ['fills', 'fill', 'fillOpacity', 'fillGradient', 'imageFill', ...(primaryChanged ? ['fillStyleId', 'fillVariableId', 'variableBindings'] : [])]);
    renderInspector(); queueSave(); renderer.invalidate();
    return;
  }
  if (action === 'rotate-image' || action === 'flip-image' || action === 'reset-image-transforms') {
    applyImageTransformAction(node, details.transformTarget, action, details.direction, details.fillId);
    return;
  }
  if (action === 'apply-image-recipe' || action === 'apply-selection-image-recipe') {
    const recipeId = $('#selection-image-recipe')?.value;
    const recipe = state.document.recipes.find(item => item.id === recipeId);
    if (!recipe) { showToast('Choose a saved image recipe first.'); return; }
    const targets = action === 'apply-image-recipe'
      ? [details.nodeId || node?.id].filter(Boolean)
      : selectedNodes().filter(item => item.type === 'image').map(item => item.id);
    if (!targets.length) { showToast('Select one or more image layers first.'); return; }
    if (action === 'apply-selection-image-recipe') { state.layerSelectionMode = false; renderLayers(); }
    closeMobilePanels();
    startRecipe(recipe, targets);
    return;
  }
  if (action === 'align-selection') alignSelectedLayers(details.alignMode);
  else if (action === 'add-gradient-stop' && node && !node.locked) {
    const fill = details.fillId ? node.fills?.find(item => item.id === details.fillId) || null : null;
    const legacyPrimary = !node.fills && (!details.fillId || details.fillId === `legacy-fill:${node.id}`);
    const gradient = fill?.gradient || (legacyPrimary ? node.fillGradient : null);
    if (!gradient) return;
    const inserted = insertGradientStopInLargestGap(gradient);
    if (!inserted) { showToast('A gradient can have up to 8 color stops.'); return; }
    checkpoint('Add gradient stop');
    gradient.stops = inserted.stops;
    if (fill) { syncLegacyFillFields(node); recordNodeComponentOverrides(node, ['fills', 'fillGradient']); }
    else recordNodeComponentOverrides(node, ['fillGradient']);
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'remove-gradient-stop' && node && !node.locked) {
    const fill = details.fillId ? node.fills?.find(item => item.id === details.fillId) || null : null;
    const legacyPrimary = !node.fills && (!details.fillId || details.fillId === `legacy-fill:${node.id}`);
    const gradient = fill?.gradient || (legacyPrimary ? node.fillGradient : null);
    if (!gradient || gradient.stops.length <= 2 || !gradient.stops.some(stop => stop.id === details.stopId)) return;
    checkpoint('Remove gradient stop');
    gradient.stops = gradient.stops.filter(stop => stop.id !== details.stopId);
    if (fill) { syncLegacyFillFields(node); recordNodeComponentOverrides(node, ['fills', 'fillGradient']); }
    else recordNodeComponentOverrides(node, ['fillGradient']);
    renderInspector(); queueSave(); renderer.invalidate();
  }
  else if (action === 'add-layer-effect' && node && !node.locked) {
    const effectCount = type => (node.effects || []).filter(effect => effect.type === type).length;
    if (details.effectType === 'drop-shadow' && effectCount('drop-shadow') >= MAX_DROP_SHADOWS_PER_LAYER) { showToast(`A layer can have up to ${MAX_DROP_SHADOWS_PER_LAYER} drop shadows.`); return; }
    if (details.effectType === 'inner-shadow' && effectCount('inner-shadow') >= MAX_INNER_SHADOWS_PER_LAYER) { showToast(`A layer can have up to ${MAX_INNER_SHADOWS_PER_LAYER} inner shadows.`); return; }
    if (details.effectType === 'noise' && effectCount('noise') >= MAX_NOISE_EFFECTS_PER_LAYER) { showToast(`A layer can have up to ${MAX_NOISE_EFFECTS_PER_LAYER} noise effects.`); return; }
    if (details.effectType === 'texture' && effectCount('texture') >= MAX_TEXTURE_EFFECTS_PER_LAYER) { showToast(`A layer can have up to ${MAX_TEXTURE_EFFECTS_PER_LAYER} texture effect.`); return; }
    if (details.effectType === 'glass' && effectCount('glass') >= MAX_GLASS_EFFECTS_PER_LAYER) { showToast(`A layer can have up to ${MAX_GLASS_EFFECTS_PER_LAYER} Glass effect.`); return; }
    if (['layer-blur', 'background-blur'].includes(details.effectType)
      && node.effects?.some(effect => ['layer-blur', 'background-blur'].includes(effect.type))) {
      showToast('A layer can have one layer blur or one background blur, not both.'); return;
    }
    try {
      checkpoint('Add layer effect');
      node.effects ||= [];
      node.effects.push(createLayerEffect(details.effectType));
      recordNodeComponentOverrides(node, ['effects']);
      renderInspector(); queueSave(); renderer.invalidate();
    } catch (error) { showToast(error.message); }
  } else if (action === 'move-layer-effect' && node && !node.locked) {
    const entry = selectedEntries().find(item => item.node.id === node.id);
    if (entry?.parents.some(parent => parent.locked)) return;
    const currentIndex = (node.effects || []).findIndex(effect => effect.id === details.effectId);
    const nextIndex = details.direction === 'up' ? currentIndex - 1 : details.direction === 'down' ? currentIndex + 1 : -1;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= (node.effects || []).length) return;
    checkpoint('Reorder layer effects');
    moveLayerEffect(node.effects, details.effectId, details.direction);
    recordNodeComponentOverrides(node, ['effects']);
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'remove-layer-effect' && node && !node.locked) {
    if (!node.effects?.some(effect => effect.id === details.effectId)) return;
    checkpoint('Remove layer effect');
    node.effects = node.effects.filter(effect => effect.id !== details.effectId);
    recordNodeComponentOverrides(node, ['effects']);
    renderInspector(); queueSave(); renderer.invalidate();
  }
  else if (action === 'add-layout-guide' && node?.type === 'frame') {
    node.layoutGuides ||= [];
    if (node.layoutGuides.length >= 32) { showToast('A frame can have up to 32 layout guides.'); return; }
    checkpoint('Add layout guide'); node.layoutGuides.push(createLayoutGuide(details.guideType || 'grid'));
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'layoutGuides');
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'remove-layout-guide' && node?.type === 'frame') {
    const guides = node.layoutGuides || [];
    if (!guides.some(guide => guide.id === details.guideId)) return;
    checkpoint('Remove layout guide'); node.layoutGuides = guides.filter(guide => guide.id !== details.guideId);
    const instanceRoot = componentInstanceRoot(node.id);
    if (!node.layoutGuides.length) {
      if (instanceRoot) node.layoutGuides = [];
      else delete node.layoutGuides;
    }
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'layoutGuides');
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'toggle-layout-guide' && node?.type === 'frame') {
    const guide = node.layoutGuides?.find(item => item.id === details.guideId);
    if (!guide) return;
    checkpoint('Toggle layout guide'); guide.visible = !guide.visible;
    const instanceRoot = componentInstanceRoot(node.id);
    if (instanceRoot) recordComponentOverride(instanceRoot, node, 'layoutGuides');
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'add-export-setting' && node) {
    if ((node.exportSettings || []).length >= 8) { showToast('A layer can have up to 8 export settings.'); return; }
    checkpoint('Add export setting');
    node.exportSettings ||= [];
    node.exportSettings.push(createExportSetting(node.type === 'slice' ? { padding: 0 } : {}));
    renderInspector(); queueSave();
  } else if (action === 'remove-export-setting' && node) {
    const settings = node.exportSettings || [];
    if (!settings.some(setting => setting.id === details.exportId)) return;
    checkpoint('Remove export setting');
    node.exportSettings = settings.filter(setting => setting.id !== details.exportId);
    if (!node.exportSettings.length) delete node.exportSettings;
    renderInspector(); queueSave();
  } else if (action === 'export-setting' && node) {
    exportLayerWithSetting(node.id, details.exportId).catch(error => showToast(error.message || 'Could not export this layer.'));
  } else if (action === 'export-raster-pdf' && node?.type === 'frame') {
    void exportSelectedFrameRasterPdf(node.id).catch(error => showToast(error.message || 'Could not export this frame as a raster PDF.'));
  } else if (action === 'export-vector-pdf' && node?.type === 'frame') {
    void exportSelectedFrameVectorPdf(node.id).catch(error => showToast(error.message || 'Could not export this frame as a vector PDF.'));
  } else if (action === 'export-edited-source' && node?.type === 'image') {
    void exportEditedImageSource(node.id).catch(error => { if (error?.name !== 'AbortError') showToast(error.message || 'Could not export the edited original.'); });
  } else if (action === 'export-svg' && node) {
    exportSelectedNodeSvg(node.id).catch(error => showToast(error.message || 'Could not export this layer as SVG.'));
  } else if (action === 'create-component') makeComponent(node?.id);
  else if (action === 'publish-local-component') {
    void publishComponentToLocalLibrary({ componentId: details.componentId, libraryId: details.libraryId || null })
      .catch(error => showToast(error.message || 'Could not publish this component locally.'));
  } else if (action === 'publish-local-instance') {
    void publishComponentToLocalLibrary({ instanceId: details.instanceId })
      .catch(error => showToast(error.message || 'Could not publish this linked component revision.'));
  } else if (action === 'update-local-component') {
    void updateLocalComponentInstance(details.instanceId)
      .catch(error => showToast(error.message || 'Could not update this linked component.'));
  } else if (action === 'detach-local-component') detachLocalComponentInstance(details.instanceId);
  else if (action === 'combine-components') combineSelectedComponents();
  else if (action === 'create-component-property') addComponentProperty(details.componentId, details.targetId, details.propertyType);
  else if (action === 'choose-component-slot-content') openComponentSlotDialog(details.instanceId, details.propertyId);
  else if (action === 'reset-component-slot') resetComponentSlot(details.instanceId, details.propertyId);
  else if (action === 'create-component-instance') createInstanceAt(details.componentId || node?.componentId);
  else if (action === 'detach-component-instance') detachInstance(details.instanceId || node?.id);
  else if (action === 'prototype-create-flow') {
    const entry = node ? findNodeAcrossPages(state.document, node.id) : null;
    const frame = node?.type === 'frame' ? node : [...(entry?.parents || [])].reverse().find(parent => parent.type === 'frame');
    const target = frame ? { frame, page: entry?.page || activePage() } : getPrototypeStartFrame(state.document);
    if (!target) { showToast('Create a frame before adding a prototype flow.'); return; }
    try {
      checkpoint('Create prototype flow');
      const flow = createPrototypeFlow(state.document, target.frame.id, { pageId: target.page.id });
      setPrototypeStartFlow(state.document, flow.id);
      renderInspector(); queueSave(); showToast(`Created “${flow.name}”.`);
    } catch (error) { showToast(error.message || 'Could not create this prototype flow.'); }
  } else if (action === 'prototype-rename-flow') {
    const flow = state.document.prototypeFlows?.find(item => item.id === state.document.prototypeStartFlowId);
    if (!flow) return;
    const name = prompt('Rename prototype flow', flow.name);
    if (name == null || !name.trim()) return;
    try { checkpoint('Rename prototype flow'); renamePrototypeFlow(state.document, flow.id, name); renderInspector(); queueSave(); }
    catch (error) { showToast(error.message || 'Could not rename this prototype flow.'); }
  } else if (action === 'prototype-delete-flow') {
    const flow = state.document.prototypeFlows?.find(item => item.id === state.document.prototypeStartFlowId);
    if (!flow || !confirm(`Delete the “${flow.name}” prototype flow?`)) return;
    checkpoint('Delete prototype flow'); deletePrototypeFlow(state.document, flow.id); renderInspector(); queueSave();
  } else if (action === 'prototype-start') {
    const entry = node ? findNodeAcrossPages(state.document, node.id) : null;
    const frame = node?.type === 'frame' ? node : [...(entry?.parents || [])].reverse().find(parent => parent.type === 'frame');
    const flow = state.document.prototypeFlows?.find(item => item.id === state.document.prototypeStartFlowId);
    if (!frame || !flow) { showToast('Choose a prototype flow and select a frame first.'); return; }
    checkpoint('Set prototype flow starting frame');
    setPrototypeFlowStartPoint(state.document, flow.id, frame.id, entry?.page?.id || activePage().id);
    renderInspector(); queueSave(); showToast(`“${frame.name}” now starts “${flow.name}”.`);
  }
  else if (action === 'edit-prototype-interaction') {
    const interaction = node?.interactions?.find(item => item.id === details.interactionId);
    if (!node || !interaction) { showToast('This prototype interaction no longer exists.'); return; }
    state.prototypeEditingInteractionId = interaction.id;
    state.prototypeDestinationId = interaction.destinationId || null;
    state.prototypeAction = interaction.action;
    state.prototypeTrigger = interaction.trigger;
    state.prototypeTransition = interaction.transition || 'instant';
    state.prototypeEasing = interaction.easing || 'ease-in-out';
    state.prototypeDuration = Number.isFinite(interaction.duration) ? interaction.duration : 300;
    state.prototypeDelay = Number.isFinite(interaction.delay) ? interaction.delay : 1000;
    state.prototypeUrl = interaction.url || 'https://';
    state.prototypeVariableCollectionId = interaction.collectionId || null;
    state.prototypeVariableModeId = interaction.modeId || null;
    state.prototypeVariantTargetId = interaction.targetVariantId || null;
    state.prototypeScrollTargetId = interaction.scrollTargetId || null;
    state.prototypeScrollAlignment = interaction.scrollAlignment || 'nearest';
    state.prototypeConditionVariableId = interaction.condition?.variableId || null;
    state.prototypeConditionOperator = interaction.condition?.operator || 'equals';
    state.prototypeConditionValue = interaction.condition ? String(interaction.condition.value) : null;
    state.prototypeOverlayPosition = interaction.overlayPosition || 'center';
    state.prototypeOverlayOutsideClick = interaction.overlayOutsideClick !== false;
    state.prototypeOverlayBackground = interaction.overlayBackground !== false;
    state.prototypeOverlayBackgroundColor = interaction.overlayBackgroundColor || '#000000';
    state.prototypeOverlayBackgroundOpacity = Number.isFinite(interaction.overlayBackgroundOpacity) ? interaction.overlayBackgroundOpacity : 0.32;
    state.prototypeSourceId = null;
    renderInspector();
  } else if (action === 'cancel-prototype-interaction-edit') {
    state.prototypeEditingInteractionId = null;
    state.prototypeDestinationId = null;
    renderInspector();
  } else if (action === 'prototype-connect') {
    if (!node) { showToast('Select a layer to add an interaction.'); return; }
    if (state.prototypeEditingInteractionId) {
      try {
        const target = state.prototypeAction === 'navigate' || state.prototypeAction === 'open-overlay' || state.prototypeAction === 'swap-overlay'
          ? listPrototypeFrames(state.document).find(item => item.frame.id === ($('#prototype-destination')?.value || state.prototypeDestinationId))
          : null;
        const needsTarget = ['navigate', 'open-overlay', 'swap-overlay'].includes(state.prototypeAction);
        if (needsTarget && !target) { showToast('Choose a destination frame for this interaction.'); return; }
        const selectedCollection = state.document.variableCollections?.find(item => item.id === state.prototypeVariableCollectionId) || state.document.variableCollections?.[0];
        const selectedMode = selectedCollection?.modes.find(mode => mode.id === state.prototypeVariableModeId) || defaultVariableMode(selectedCollection);
        const condition = buildPrototypeInteractionCondition();
        const updateOptions = {
          action: state.prototypeAction, trigger: state.prototypeTrigger, delay: state.prototypeDelay,
          transition: state.prototypeTransition, easing: state.prototypeEasing, duration: state.prototypeDuration,
          condition, url: $('#prototype-url')?.value ?? state.prototypeUrl,
          collectionId: selectedCollection?.id, modeId: selectedMode?.id,
          targetVariantId: $('#prototype-variant-target')?.value || state.prototypeVariantTargetId,
          scrollTargetId: state.prototypeAction === 'scroll-to'
            ? ($('#prototype-scroll-target')?.value || state.prototypeScrollTargetId || null) : null,
          scrollAlignment: state.prototypeAction === 'scroll-to'
            ? ($('#prototype-scroll-alignment')?.value || state.prototypeScrollAlignment) : 'nearest',
          overlayPosition: state.prototypeOverlayPosition,
          overlayOutsideClick: state.prototypeOverlayOutsideClick,
          overlayBackground: state.prototypeOverlayBackground,
          overlayBackgroundColor: state.prototypeOverlayBackgroundColor,
          overlayBackgroundOpacity: state.prototypeOverlayBackgroundOpacity
        };
        // Validate the whole replacement on a private copy before recording
        // history. Invalid settings must not create a no-op undo step or clear
        // the redo stack.
        const updatedDocument = structuredClone(state.document);
        updatePrototypeInteraction(updatedDocument, node.id, state.prototypeEditingInteractionId, target?.frame.id || null, updateOptions, state.document.activePageId);
        checkpoint('Edit prototype interaction');
        state.document = updatedDocument;
        const updatedNode = findNode(state.document, node.id)?.node;
        if (updatedNode) recordNodeComponentOverrides(updatedNode, ['interactions']);
        state.prototypeEditingInteractionId = null;
        state.prototypeDestinationId = null;
        renderInspector(); queueSave(); renderer.invalidate();
        showToast('Prototype interaction updated.');
      } catch (error) { showToast(error.message); }
      return;
    }
    if (['close-overlay', 'back', 'open-link', 'set-variable-mode', 'change-variant', 'scroll-to'].includes(state.prototypeAction)) {
      try {
        const selectedCollection = state.document.variableCollections?.find(item => item.id === state.prototypeVariableCollectionId) || state.document.variableCollections?.[0];
        const selectedMode = selectedCollection?.modes.find(mode => mode.id === state.prototypeVariableModeId) || defaultVariableMode(selectedCollection);
        const condition = buildPrototypeInteractionCondition();
        const updatedDocument = structuredClone(state.document);
        addPrototypeInteraction(updatedDocument, node.id, null, {
          action: state.prototypeAction, trigger: state.prototypeTrigger,
          transition: state.prototypeTransition, easing: state.prototypeEasing, duration: state.prototypeDuration,
          condition,
          url: state.prototypeUrl,
          collectionId: selectedCollection?.id,
          modeId: selectedMode?.id,
          targetVariantId: $('#prototype-variant-target')?.value || state.prototypeVariantTargetId,
          scrollTargetId: state.prototypeAction === 'scroll-to'
            ? ($('#prototype-scroll-target')?.value || state.prototypeScrollTargetId || null) : null,
          scrollAlignment: state.prototypeAction === 'scroll-to'
            ? ($('#prototype-scroll-alignment')?.value || state.prototypeScrollAlignment) : 'nearest'
        });
        checkpoint(`Add ${state.prototypeAction} prototype interaction`);
        state.document = updatedDocument;
        const updatedNode = findNode(state.document, node.id)?.node;
        if (updatedNode) recordNodeComponentOverrides(updatedNode, ['interactions']);
        const label = state.prototypeAction === 'open-link' ? 'Open link' : state.prototypeAction === 'back' ? 'Back' : state.prototypeAction === 'set-variable-mode' ? 'Set variable mode' : state.prototypeAction === 'change-variant' ? 'Change to variant' : state.prototypeAction === 'scroll-to' ? 'Scroll to layer' : 'Close overlay';
        renderInspector();
        queueSave(); renderer.invalidate(); showToast(`${label} interaction added.`);
      } catch (error) { showToast(error.message); }
      return;
    }
    state.prototypeSourceId = node.id;
    state.inspectorTab = 'prototype';
    syncInspectorTabAccessibility('prototype');
    renderInspector();
    syncPrototypeConnectPrompt();
    if (innerWidth <= 820) closeMobilePanels({ restoreFocus: false });
    canvas.focus({ preventScroll: true });
    renderer.invalidate(); showToast('Choose a destination frame on the canvas.');
  } else if (action === 'remove-prototype-interaction') {
    const interactionId = details.interactionId;
    if (!node || !interactionId) return;
    checkpoint('Remove prototype interaction');
    removePrototypeInteraction(state.document, node.id, interactionId);
    if (state.prototypeEditingInteractionId === interactionId) {
      state.prototypeEditingInteractionId = null;
      state.prototypeDestinationId = null;
    }
    recordNodeComponentOverrides(node, ['interactions']);
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'present') startPresentation(node?.id);
  else if (action === 'separate-boolean' && node?.type === 'boolean') separateSelectedBoolean(node.id);
  else if (action === 'bake-boolean' && node?.type === 'boolean') bakeSelectedBoolean(node.id);
  else if (action === 'release-mask' && node?.type === 'group' && node.mask) releaseSelectedMask(node.id);
  else if (action === 'toggle-vector-anchor-select-mode' && node?.type === 'path' && !node.locked) {
    state.selectedVectorPoints = normalizeVectorAnchorSelection(state.selectedVectorPoints, node.id);
    state.vectorPointSelectMode = !state.vectorPointSelectMode;
    renderInspector(); renderer.invalidate();
  }
  else if (action === 'insert-vector-point' && ['path', 'network'].includes(node?.type)) insertPathPointOnLongestSegment(node.id);
  else if (action === 'delete-vector-point' && ['path', 'network'].includes(node?.type)) deleteSelectedVectorPoint(node.id);
  else if (action === 'reverse-vector-contour' && node?.type === 'path') reverseSelectedPathContour(node.id);
  else if (action === 'add-vector-contour' && node?.type === 'path') addPathContour(node.id);
  else if (action === 'remove-vector-contour' && node?.type === 'path') removeSelectedPathContour(node.id);
  else if (action === 'create-color-variable') createColorVariableFromSelection(details.kind || null);
  else if (action === 'create-color-style') {
    if (!node) { showToast('Select a layer with a solid Fill or Text color.'); return; }
    const current = getNodeColor(state.document, node, node.type === 'text' ? 'text' : 'fill');
    if (!/^#[0-9a-f]{6}$/i.test(current)) { showToast('Choose a solid color before creating a style.'); return; }
    const name = prompt('Color style name', `${node.name} color`);
    if (name == null) return;
    try {
      checkpoint('Create color style');
      const style = createColorStyle(state.document, node.id, name);
      const instanceRoot = componentInstanceRoot(node.id);
      if (instanceRoot) recordComponentOverride(instanceRoot, node, style.kind === 'text' ? 'textStyleId' : 'fillStyleId');
      renderUI(); queueSave(); showToast(`Color style “${style.name}” created.`);
    } catch (error) { showToast(error.message); }
  }
  else if (action === 'create-typography-style') {
    saveTypographyStyleFor(node?.id);
  }
  else if (action === 'detach-typography-style' && node?.type === 'text') {
    detachTypographyStyleFromSelection();
  }
  else if (action === 'edit-text' && node?.type === 'text') { closeMobilePanels(); editTextNode(node.id); }
  else if (action === 'reset-image' && node?.type === 'image') {
    checkpoint('Reset image'); node.adjustments = { ...defaultImageAdjustments }; node.transforms = createImageTransforms(); node.fit = 'cover';
    recordNodeComponentOverrides(node, ['adjustments', 'transforms', 'fit']);
    schedulePreview(node, true); renderInspector(); queueSave();
  } else if (action === 'create-frame') { setTool('frame'); showToast('Drag on the canvas to create a frame.'); }
  else if (action === 'unlink-corners' && node && ['rectangle', 'frame', 'section', 'image'].includes(node.type)) {
    if (node.locked) return;
    checkpoint('Set independent corners');
    const radius = Math.max(0, Math.min(100_000, Number(getNodePropertyValue(state.document, node, 'radius')) || 0));
    node.radius = radius;
    if (node.variableBindings) {
      delete node.variableBindings.radius;
      if (!Object.keys(node.variableBindings).length) delete node.variableBindings;
    }
    node.cornerRadii = Object.fromEntries(cornerRadiusKeys.map(key => [key, radius]));
    recordNodeComponentOverrides(node, ['radius', 'cornerRadii', 'variableBindings']);
    renderInspector(); queueSave(); renderer.invalidate();
  } else if (action === 'link-corners' && node?.cornerRadii) {
    if (node.locked) return;
    checkpoint('Link corners');
    const average = cornerRadiusKeys.reduce((sum, key) => sum + node.cornerRadii[key], 0) / cornerRadiusKeys.length;
    node.radius = average;
    if (node.variableBindings) {
      delete node.variableBindings.radius;
      if (!Object.keys(node.variableBindings).length) delete node.variableBindings;
    }
    delete node.cornerRadii;
    recordNodeComponentOverrides(node, ['radius', 'cornerRadii', 'variableBindings']);
    renderInspector(); queueSave(); renderer.invalidate();
  }
  else if (action === 'suggest-auto-layout' && node?.type === 'frame') {
    const suggestion = suggestAutoLayout(node);
    if (!suggestion.supported) { showToast(suggestion.reason); return; }
    state.autoLayoutSuggestion = { frameId: node.id, signature: suggestion.signature };
    renderInspector();
  } else if (action === 'apply-auto-layout-suggestion' && node?.type === 'frame') {
    const pending = state.autoLayoutSuggestion;
    if (!pending || pending.frameId !== node.id) return;
    const suggestion = suggestAutoLayout(node);
    if (!suggestion.supported) {
      state.autoLayoutSuggestion = null;
      renderInspector();
      showToast(suggestion.reason);
      return;
    }
    if (pending.signature !== suggestion.signature) {
      state.autoLayoutSuggestion = { frameId: node.id, signature: suggestion.signature };
      renderInspector();
      showToast('The frame changed. Review the updated suggestion before applying it.');
      return;
    }
    try {
      applyAutoLayoutSuggestion(structuredClone(node), suggestion);
      checkpoint('Apply suggested auto layout');
      const applied = applyAutoLayoutSuggestion(node, suggestion);
      const childrenById = new Map(node.children.map(item => [item.id, item]));
      recordNodeComponentOverrides(node, ['autoLayout']);
      for (const id of applied.movedIds) {
        const child = childrenById.get(id);
        if (child) recordNodeComponentOverrides(child, ['x', 'y']);
      }
      for (const id of applied.absoluteIds) {
        const child = childrenById.get(id);
        if (child) recordNodeComponentOverrides(child, ['layoutPositioning']);
      }
      if (suggestion.pattern === 'grid') for (const { id } of suggestion.cells) {
        const child = childrenById.get(id);
        if (child) recordNodeComponentOverrides(child, ['gridCell']);
      }
      state.autoLayoutSuggestion = null;
      renderInspector(); renderLayers(); renderer.invalidate(); queueSave();
      showToast(`Applied ${suggestion.pattern} auto layout to ${suggestion.flowIds.length} layers.`);
    } catch (error) { showToast(error.message || 'The layout suggestion could not be applied.'); }
  } else if (action === 'cancel-auto-layout-suggestion') {
    state.autoLayoutSuggestion = null;
    renderInspector();
  } else if (action === 'auto-layout-toggle') {
    if (!node || node.type !== 'frame') return;
    state.autoLayoutSuggestion = null;
    checkpoint(node.autoLayout ? 'Remove auto layout' : 'Add auto layout');
    if (node.autoLayout) {
      delete node.autoLayout;
      for (const property of Object.keys(node.variableBindings || {})) if (property.startsWith('autoLayout.')) delete node.variableBindings[property];
      if (!Object.keys(node.variableBindings || {}).length) delete node.variableBindings;
      recordNodeComponentOverrides(node, ['autoLayout', 'variableBindings']);
    }
    else { node.autoLayout = createAutoLayout(); applyAutoLayout(node); }
    renderInspector(); renderLayers(); renderer.invalidate(); queueSave();
  }
}

function updateImageEngineState(metrics) {
  const output = $('#bulk-speed-value');
  if (output && state.bulk) {
    output.textContent = `${state.bulk.concurrency} max worker${state.bulk.concurrency === 1 ? '' : 's'} · ${metrics.workersReady} ready · ${metrics.active} active`;
    output.title = `Engine limit: ${metrics.concurrency} worker${metrics.concurrency === 1 ? '' : 's'} · ${metrics.workersReady} ready. Estimated WASM working set: ${Math.round(metrics.activeRenderBytes / 1048576)} of ${Math.round(metrics.maxActiveRenderBytes / 1048576)} MiB; memory admission can lower actual parallelism.`;
  }
}

function toggleMobilePanel(panel) {
  if (innerWidth > 820) return;
  const left = $('#left-panel'); const right = $('#right-panel');
  const target = panel === 'left' ? left : right;
  const other = panel === 'left' ? right : left;
  const wasOpen = target.classList.contains('is-open');
  target.classList.toggle('is-open', !wasOpen);
  other.classList.remove('is-open');
  syncMobilePanelAccessibility();
  if (wasOpen) {
    (panel === 'left' ? $('#sidebar-toggle') : $('#inspector-toggle')).focus({ preventScroll: true });
    return;
  }
  const firstControl = target.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
  firstControl?.focus({ preventScroll: true });
}
function syncMobilePanelAccessibility() {
  const mobile = innerWidth <= 820;
  const scrim = $('#mobile-scrim');
  const canvasRegion = $('#canvas-region');
  const panels = [
    { panel: $('#left-panel'), toggle: $('#sidebar-toggle'), name: 'layers' },
    { panel: $('#right-panel'), toggle: $('#inspector-toggle'), name: 'properties' }
  ];
  let anyOpen = false;
  for (const { panel, toggle, name } of panels) {
    const open = mobile && panel.classList.contains('is-open');
    const closed = mobile && !open;
    anyOpen ||= open;
    panel.inert = closed;
    panel.setAttribute('aria-hidden', String(closed));
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', `${open ? 'Close' : 'Open'} ${name}`);
    toggle.title = `${open ? 'Close' : 'Open'} ${name}`;
  }
  canvasRegion.inert = anyOpen;
  canvasRegion.setAttribute('aria-hidden', String(anyOpen));
  scrim.classList.toggle('is-visible', anyOpen);
}
function closeMobilePanels({ restoreFocus = true } = {}) {
  if (innerWidth > 820) return;
  const left = $('#left-panel'); const right = $('#right-panel');
  const wasLeftOpen = left.classList.contains('is-open');
  const wasRightOpen = right.classList.contains('is-open');
  left.classList.remove('is-open');
  right.classList.remove('is-open');
  syncMobilePanelAccessibility();
  if (restoreFocus && wasLeftOpen) $('#sidebar-toggle').focus({ preventScroll: true });
  else if (restoreFocus && wasRightOpen) $('#inspector-toggle').focus({ preventScroll: true });
}
function trapMobilePanelTab(event) {
  if (event.key !== 'Tab' || innerWidth > 820 || document.querySelector('dialog[open]')) return false;
  const openPanel = $('#left-panel').classList.contains('is-open') ? $('#left-panel')
    : $('#right-panel').classList.contains('is-open') ? $('#right-panel') : null;
  const menu = $('#context-menu');
  if (!openPanel) return false;
  const toggle = openPanel.id === 'left-panel' ? $('#sidebar-toggle') : $('#inspector-toggle');
  const menuItems = menu.hidden ? [] : contextMenuItems(menu);
  const focusStops = [
    ...openPanel.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary:not([tabindex="-1"]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'),
    ...menuItems,
    toggle
  ].filter(element => element && element.tabIndex >= 0 && element.getClientRects().length
    && !element.closest('[hidden], [inert]'));
  if (!focusStops.length) return false;
  const target = mobilePanelTabTarget(focusStops, document.activeElement, event.shiftKey);
  if (!target) return false;
  target.focus({ preventScroll: true });
  event.preventDefault();
  return true;
}

function initEvents() {
  syncInspectorTabAccessibility();
  syncSidebarTabAccessibility();
  $$('.sidebar-tabs, .inspector-tabs').forEach(installHorizontalTabListKeyboard);
  for (const button of $$('.tool-button')) button.innerHTML = `${icon(button.querySelector('[data-icon]')?.dataset.icon || 'cursor', 18)}<kbd>${button.querySelector('kbd')?.textContent || ''}</kbd>`;
  installDesignToolToolbarKeyboard();
  window.addEventListener('tiny-image-star:share-live', event => {
    event.preventDefault();
    void (async () => {
      try { await prepareLiveWorkspace(); }
      catch (error) { showToast(error.message || 'Choose a writable folder before sharing.'); return; }
      if (state.liveCollaboration?.role === 'host' && !liveTerminal(state.liveCollaboration.status)) openLiveDialog('host');
      else {
        $('#live-start-host').hidden = false;
        $('#live-start-host').disabled = false;
        $('#live-accept-answer').hidden = true;
        $('#live-stop-host').hidden = true;
        $('#live-answer-value').value = '';
        $('#live-invite-value').value = '';
        $('#live-offer-value').value = '';
        $('#live-share-capsules').hidden = true;
        $('#live-transfer-status').textContent = '';
        liveStatus('host', 'Create an offer, then send both capsules to your guest using a trusted channel.');
        openLiveDialog('host');
      }
    })();
  });
  window.addEventListener('tiny-image-star:join-live', event => {
    event.preventDefault();
    if (state.liveCollaboration?.role === 'guest' && !liveTerminal(state.liveCollaboration.status)) openLiveDialog('guest');
    else {
      $('#live-guest-answer').value = '';
      $('#live-copy-answer').hidden = true;
      $('#live-retry-fork').hidden = true;
      $('#live-stop-guest').hidden = true;
      $('#live-guest-transfer-status').textContent = '';
      startJoinFromStableLink();
      if (!liveDialog().open) openLiveDialog('guest');
    }
  });
  $('#live-start-host').addEventListener('click', () => { void startLiveHost(); });
  $('#live-share-capsules').addEventListener('click', () => { void shareLiveCapsules(); });
  $('#live-accept-answer').addEventListener('click', async () => {
    const controller = state.liveCollaboration?.role === 'host' ? state.liveCollaboration.controller : null;
    if (!controller) { showToast('Create a session offer first.'); return; }
    const answer = $('#live-answer-value').value.trim();
    if (!answer) { liveStatus('host', 'Paste the guest’s answer capsule first.'); $('#live-answer-value').focus(); return; }
    $('#live-accept-answer').disabled = true;
    liveStatus('host', 'Verifying and applying the one-time guest answer…');
    try { await controller.acceptAnswer(answer); }
    catch (error) { liveStatus('host', error.message || 'Could not connect this guest.'); showToast(error.message || 'Could not connect this guest.'); }
    finally { $('#live-accept-answer').disabled = false; }
  });
  $('#live-join-session').addEventListener('click', () => { void startLiveGuest(); });
  $('#live-stop-host').addEventListener('click', () => { void stopLiveHost(); });
  $('#live-stop-guest').addEventListener('click', () => { void stopLiveGuest(); });
  $('#live-retry-fork').addEventListener('click', async () => {
    const session = state.liveCollaboration;
    if (session?.role !== 'guest' || !session.controller) return;
    $('#live-retry-fork').disabled = true;
    try { await session.controller.retryForkSave(); }
    catch (error) { liveStatus('guest', error.message || 'The local fork save still needs attention.'); }
    finally { $('#live-retry-fork').disabled = false; }
  });
  $('#live-collaboration-dialog').addEventListener('click', event => {
    const copy = event.target.closest('[data-copy-field]');
    if (copy) { void copyLiveField(copy.dataset.copyField); return; }
  });
  const liveDialogElement = $('#live-collaboration-dialog');
  $('#live-collaboration-close').addEventListener('click', () => {
    const session = state.liveCollaboration;
    if (session?.role === 'host' && !liveTerminal(session.status)) {
      showToast('Stop sharing and revoke the invitation before returning to editing.');
      return;
    }
    if (session?.role === 'guest' && !liveTerminal(session.status)) {
      showToast('Leave the live session first so Tiny Image Star can save your local fork.');
      return;
    }
    liveDialogElement.close();
  });
  liveDialogElement.addEventListener('cancel', event => {
    const session = state.liveCollaboration;
    if ((session?.role === 'host' || session?.role === 'guest') && !liveTerminal(session.status)) {
      event.preventDefault();
      showToast(session.role === 'host'
        ? 'Stop sharing and revoke the invitation before returning to editing.'
        : 'Leave the live session first so Tiny Image Star can save your local fork.');
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!state.interaction || canvas.contains(event.target)) return;
    // A canvas gesture owns the document until it ends. If the user starts a
    // second action in a panel or toolbar, cancel the gesture before that UI
    // can mutate the document behind its rollback snapshot.
    cancelCanvasInteraction({ pointerId: state.interaction.pointerId, preserveUI: true });
  }, true);
  $$('.tool-button').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.tool === 'image') chooseImageFiles(); else setTool(button.dataset.tool);
  }));
  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  canvas.addEventListener('pointermove', onCanvasPointerMove);
  canvas.addEventListener('pointerup', onCanvasPointerUp);
  canvas.addEventListener('pointercancel', cancelCanvasInteraction);
  canvas.addEventListener('lostpointercapture', event => {
    if (state.interaction && (state.pointerMap.has(event.pointerId) || state.interaction.kind === 'pinch')) cancelCanvasInteraction(event);
  });
  for (const [rail, axis] of [['#ruler-horizontal', 'x'], ['#ruler-vertical', 'y']]) {
    const element = $(rail);
    element.addEventListener('pointerdown', event => handleRulerPointerDown(event, axis));
    element.addEventListener('pointermove', updateRulerGuideGesture);
    element.addEventListener('pointerup', finishRulerGuideGesture);
    element.addEventListener('pointercancel', cancelCanvasInteraction);
    element.addEventListener('lostpointercapture', event => {
      if (state.interaction?.pointerId === event.pointerId && state.interaction.kind === 'ruler-guide-create') cancelCanvasInteraction(event);
    });
    element.addEventListener('keydown', handleRulerKeyboard);
  }
  canvas.addEventListener('dblclick', event => {
    if (state.tool !== 'select') return;
    const world = screenToWorld(event, canvas, state);
    const hit = hitTestPage(activePage(), world, (node, point, x, y) => renderer?.hitTestBoolean(node, point, x, y) ?? true, state.document, null, state.zoom);
    if (hit?.type === 'text') { editTextNode(hit.id); event.preventDefault(); return; }
    if (insertPathPointAtWorld(world)) event.preventDefault();
  });
  canvas.addEventListener('contextmenu', event => {
    event.preventDefault();
    const world = screenToWorld(event, canvas, state); const hit = hitTestPage(activePage(), world, (node, point, x, y) => renderer?.hitTestBoolean(node, point, x, y) ?? true, state.document, null, state.zoom);
    if (hit) openNodeMenu(hit.id, event.clientX, event.clientY, world, canvas);
    else if (state.selectedIds.length) openNodeMenu(state.selectedIds[0], event.clientX, event.clientY, world, canvas);
    else openFileMenu(event.clientX, event.clientY, world, canvas);
  });
  canvasScroll.addEventListener('dragover', event => { event.preventDefault(); $('#canvas-drop-overlay').classList.add('is-visible'); });
  canvasScroll.addEventListener('dragleave', event => { if (!canvasScroll.contains(event.relatedTarget)) $('#canvas-drop-overlay').classList.remove('is-visible'); });
  canvasScroll.addEventListener('drop', event => {
    event.preventDefault(); $('#canvas-drop-overlay').classList.remove('is-visible');
    const point = screenToWorld(event, canvas, state); importImageFiles(event.dataTransfer.files, point);
  });
  $('#image-input').addEventListener('change', event => importImageFiles(event.currentTarget.files, null, { input: event.currentTarget }));
  $('#image-library-input').addEventListener('change', event => importImageFiles(event.currentTarget.files, null, { place: false, input: event.currentTarget }));
  $('#add-local-font').addEventListener('click', () => {
    if (typeof FontFace !== 'function' || !document.fonts?.add) { showToast('This browser cannot load local font files.'); return; }
    $('#font-input').value = '';
    $('#font-input').click();
  });
  $('#font-input').addEventListener('change', event => { void openLocalFontImport(event.currentTarget.files?.[0]); });
  $('#font-import-form').addEventListener('submit', event => {
    if (event.submitter?.value !== 'import') return;
    event.preventDefault();
    const button = $('#font-import-confirm');
    button.disabled = true;
    void savePendingLocalFont().catch(error => showToast(error.message || 'Could not install this font.'))
      .finally(() => { button.disabled = false; });
  });
  $('#font-import-dialog').addEventListener('close', () => {
    pendingFontImport = null;
    $('#font-input').value = '';
  });
  $('#font-assets-list').addEventListener('click', event => {
    const button = event.target.closest('[data-action="remove-local-font"]');
    if (!button) return;
    void removeLocalFont(button.dataset.fontId).catch(error => showToast(error.message || 'Could not remove this font.'));
  });
  $('#fig-import-dialog').addEventListener('close', () => { pendingFigImport = null; });
  $('#fig-import-cancel').addEventListener('click', () => $('#fig-import-dialog').close());
  $('#fig-import-close').addEventListener('click', () => $('#fig-import-dialog').close());
  $('#fig-import-confirm').addEventListener('click', () => { void confirmFigImport(); });
  $('#open-file-input').addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > MAX_LOCAL_PACKAGE_BYTES) throw new RangeError(`This local design file is larger than the ${Math.floor(MAX_LOCAL_PACKAGE_BYTES / (1024 * 1024))} MiB local package limit.`);
      const prefix = typeof file.slice === 'function' ? new Uint8Array(await file.slice(0, 4).arrayBuffer()) : new Uint8Array();
      const isFigArchive = /\.fig$/iu.test(file.name || '') || (prefix[0] === 0x50 && prefix[1] === 0x4b);
      if (isFigArchive) {
        if (state.pendingImageImports) throw new Error('Wait for the current image import to finish before importing a design.');
        state.pendingImageImports += 1;
        try {
          const imported = await parseLocalFigFile(file);
          openFigImportReview(imported);
        } finally {
          state.pendingImageImports -= 1;
        }
        return;
      }
      const packageData = unpackLocalPackage(new Uint8Array(await file.arrayBuffer()));
      // Keep temporary font decoding serial so imported packages with many
      // local faces cannot multiply font parser memory on a phone.
      for (const font of packageData.fonts) await loadLocalFontFace(font, { register: false });
      const importedDocument = parseDocument(packageData.document);
      const switched = await switchToDocument(importedDocument, {
        message: 'Local design opened on this device.',
        beforeSwitch: async nextDocument => Object.assign(nextDocument, (await importLocalPackage(nextDocument, packageData.assets, packageData.fonts)).document)
      });
      if (switched) {
        await refreshLocalFontAssets({ showFailureToast: true });
        renderUI(); renderer.invalidate();
      }
    } catch (error) { showToast(error.message || 'This file is not a valid local design package.'); }
    input.value = '';
  });
  $('#svg-input').addEventListener('change', async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    state.pendingImageImports += 1;
    try {
      if (state.documentTransitioning) throw new Error('Wait for the current design switch to finish before importing an SVG.');
      const { nodes, width, height } = importSvgToLayers(await file.text());
      if (!nodes.length) throw new Error('This SVG contains no editable vector layers.');
      const imported = nodes;
      const bounds = canvas.getBoundingClientRect();
      const center = screenToWorld({ clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }, canvas, state);
      checkpoint(`Import ${file.name}`);
      for (const node of imported) {
        walkNodes([node], entry => { entry.node.id = createId(entry.node.type); });
        const name = file.name.replace(/\.svg$/i, '').trim().slice(0, 120);
        if (name) node.name = name;
        node.x = center.x - width / 2;
        node.y = center.y - height / 2;
        addNode(state.document, node, { pageId: state.document.activePageId });
      }
      setSelection(imported.map(node => node.id));
      renderUI(); queueSave(); renderer.invalidate();
      showToast(`${file.name} imported as editable layers.`);
    } catch (error) {
      showToast(error.message || 'Could not import this SVG.');
    } finally {
      state.pendingImageImports -= 1;
      input.value = '';
    }
  });
  setZoomButtonHandlers();
  $('#document-name').addEventListener('change', event => { if (state.documentTransitioning) return; const name = event.currentTarget.value.trim() || 'Untitled'; checkpoint('Rename design'); state.document.name = name; renderUI(); queueSave(); });
  $('#add-page').addEventListener('click', addPage);
  $('#pages-list').addEventListener('click', event => {
    const action = event.target.closest('[data-page-action]');
    if (action) { event.preventDefault(); managePageAction(action.dataset.pageAction, action.dataset.pageId); action.closest('details')?.removeAttribute('open'); return; }
    if (event.target.closest('.page-row-menu')) return;
    const selection = event.target.closest('[data-page-select]') || event.target.closest('.page-row')?.querySelector('[data-page-select]');
    if (!selection) return;
    const pageId = selection.dataset.pageSelect;
    if (pageId === state.document.activePageId) return;
    clearPrototypeConnectPrompt(); state.document.activePageId = pageId; state.selectedIds = []; clearVectorAnchorSelection(); state.pendingCommentAnchor = null; state.activeCommentId = null; renderUI();
  });
  $('#pages-list').addEventListener('dblclick', event => { const row = event.target.closest('[data-page-id]'); if (row && !event.target.closest('.page-row-menu')) renamePage(row.dataset.pageId); });
  $('#layer-select-mode').addEventListener('click', () => {
    state.layerSelectionMode = !state.layerSelectionMode;
    renderLayers();
  });
  $('#layers-list').addEventListener('focusin', event => {
    const row = event.target.closest('[data-layer-id]');
    if (!row) return;
    for (const candidate of layerRowsById.values()) candidate.tabIndex = candidate === row ? 0 : -1;
  });
  $('#layers-list').addEventListener('keydown', event => {
    const row = event.target.closest('[data-layer-id]');
    if (!row) return;
    const orderDirection = event.target === row ? layerOrderShortcutDirection(event) : null;
    if (orderDirection) {
      event.preventDefault(); event.stopPropagation();
      if (state.layerSelectionMode || !canMoveLayerOneVisualRow(state.document, row.dataset.layerId, orderDirection)) return;
      const nodeId = row.dataset.layerId;
      checkpoint(`Move layer ${orderDirection}`);
      if (moveLayerOneVisualRow(state.document, nodeId, orderDirection)) {
        setSelection([nodeId]); renderUI(); queueSave(); renderer.invalidate();
        layerRowsById.get(nodeId)?.focus({ preventScroll: true });
      }
      return;
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault(); event.stopPropagation();
      const node = findNode(state.document, row.dataset.layerId)?.node;
      if (!node) return;
      if (!state.selectedIds.includes(node.id)) setSelection([node.id], { refreshLayers: false });
      const menuButton = layerRowsById.get(node.id)?.querySelector('[data-action="layer-actions-menu"]');
      const bounds = row.getBoundingClientRect();
      openNodeMenu(node.id, bounds.right, bounds.bottom);
      const menu = $('#context-menu');
      menu._returnFocusElement = menuButton || row;
      menuButton?.setAttribute('aria-expanded', 'true');
      focusFirstContextMenuItem(menu);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      setSelection([row.dataset.layerId], { refreshLayers: false });
      return;
    }
    if (event.key === ' ') {
      event.preventDefault(); event.stopPropagation();
      const id = row.dataset.layerId;
      setSelection(state.selectedIds.includes(id)
        ? state.selectedIds.filter(selectedId => selectedId !== id)
        : [...state.selectedIds, id], { refreshLayers: false });
      state.lastLayerSelection = id;
      return;
    }
    const visibleRows = [...layerRowsById.values()].filter(candidate => candidate.getClientRects().length);
    const index = visibleRows.indexOf(row);
    let target = null;
    if (event.key === 'ArrowDown') target = visibleRows[Math.min(index + 1, visibleRows.length - 1)];
    else if (event.key === 'ArrowUp') target = visibleRows[Math.max(index - 1, 0)];
    else if (event.key === 'Home') target = visibleRows[0];
    else if (event.key === 'End') target = visibleRows.at(-1);
    else if (event.key === 'ArrowRight') {
      const node = findNode(state.document, row.dataset.layerId)?.node;
      if (node?.children?.length && collapsedLayerIds.has(node.id)) {
        collapsedLayerIds.delete(node.id); renderLayers();
        target = layerRowsById.get(node.id);
      } else if (node?.children?.length) target = layerRowsById.get(node.children.at(-1)?.id);
    } else if (event.key === 'ArrowLeft') {
      const node = findNode(state.document, row.dataset.layerId);
      if (node?.node.children?.length && !collapsedLayerIds.has(node.node.id)) {
        collapsedLayerIds.add(node.node.id); renderLayers();
        target = layerRowsById.get(node.node.id);
      } else if (node?.parent) target = layerRowsById.get(node.parent.id);
    } else return;
    event.preventDefault(); event.stopPropagation();
    if (target) {
      target.focus({ preventScroll: true });
      if (target !== row && !['Home', 'End'].includes(event.key)) setSelection([target.dataset.layerId], { refreshLayers: false });
    }
  });
  $('#layers-list').addEventListener('click', event => {
    const row = event.target.closest('[data-layer-id]'); if (!row) return;
    const node = findNode(state.document, row.dataset.layerId)?.node; if (!node) return;
    if (event.target.closest('[data-action="layer-toggle"]')) {
      if (collapsedLayerIds.has(node.id)) collapsedLayerIds.delete(node.id); else collapsedLayerIds.add(node.id);
      renderLayers(); layerRowsById.get(node.id)?.focus({ preventScroll: true });
      return;
    }
    const actionMenuButton = event.target.closest('[data-action="layer-actions-menu"]');
    if (actionMenuButton) {
      event.preventDefault();
      if (!state.selectedIds.includes(node.id)) setSelection([node.id], { refreshLayers: false });
      const currentButton = layerRowsById.get(node.id)?.querySelector('[data-action="layer-actions-menu"]') || actionMenuButton;
      const bounds = currentButton.getBoundingClientRect();
      openNodeMenu(node.id, bounds.right, bounds.top);
      const menu = $('#context-menu');
      menu._returnFocusElement = currentButton;
      currentButton.setAttribute('aria-expanded', 'true');
      focusFirstContextMenuItem(menu);
      return;
    }
    const moveControl = event.target.closest('[data-action="layer-move-up"], [data-action="layer-move-down"]');
    if (moveControl) {
      if (moveControl.disabled || state.layerSelectionMode) return;
      const direction = moveControl.dataset.action === 'layer-move-up' ? 'up' : 'down';
      checkpoint(`Move layer ${direction}`);
      if (moveLayerOneVisualRow(state.document, node.id, direction)) {
        setSelection([node.id]); renderUI(); queueSave(); renderer.invalidate();
      }
      return;
    }
    if (event.target.closest('[data-action="visibility"]')) { checkpoint('Toggle visibility'); setNodePropertyValue(node, 'visible', !getNodePropertyValue(state.document, node, 'visible')); renderUI(); queueSave(); return; }
    if (state.layerSelectionMode) {
      row.focus({ preventScroll: true });
      setSelection(state.selectedIds.includes(node.id) ? state.selectedIds.filter(id => id !== node.id) : [...state.selectedIds, node.id], { refreshLayers: false });
      state.lastLayerSelection = node.id;
      return;
    }
    row.focus({ preventScroll: true });
    if (event.shiftKey) {
      const rows = latestPageLayerIds; const a = rows.indexOf(state.lastLayerSelection || row.dataset.layerId); const b = rows.indexOf(row.dataset.layerId); const range = rows.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSelection([...new Set([...state.selectedIds, ...range])], { refreshLayers: false });
    } else if (event.metaKey || event.ctrlKey) {
      setSelection(state.selectedIds.includes(node.id) ? state.selectedIds.filter(id => id !== node.id) : [...state.selectedIds, node.id], { refreshLayers: false });
    } else setSelection([node.id], { refreshLayers: false });
    state.lastLayerSelection = node.id;
  });
  $('#layers-list').addEventListener('dblclick', event => { const row = event.target.closest('[data-layer-id]'); if (row) { setSelection([row.dataset.layerId]); renameSelected(); } });
  $('#layers-list').addEventListener('contextmenu', event => { const row = event.target.closest('[data-layer-id]'); if (!row) return; event.preventDefault(); openNodeMenu(row.dataset.layerId, event.clientX, event.clientY, null, row); });
  $('#inspector-content').addEventListener('input', event => {
    if (state.documentTransitioning) return;
    const gradientGeometryField = event.target.closest('[data-gradient-geometry-field]');
    if (gradientGeometryField) { updateGradientGeometryInput(gradientGeometryField); return; }
    const strokeField = event.target.closest('[data-stroke-field]');
    if (strokeField) { updateStrokeInput(strokeField); return; }
    const fillField = event.target.closest('[data-fill-field]');
    if (fillField) { updateFillInput(fillField); return; }
    const imageTransformField = event.target.closest('[data-image-transform-field]');
    if (imageTransformField) { updateImageTransformInput(imageTransformField); return; }
    const imageFillZoom = event.target.closest('[data-image-fill-zoom]');
    if (imageFillZoom) { updateImageFillZoomInput(imageFillZoom); return; }
    const imageFillField = event.target.closest('[data-image-fill-field]');
    if (imageFillField) { updateImageFillInput(imageFillField); return; }
    const gradientField = event.target.closest('[data-gradient-field]');
    if (gradientField) { updateGradientInput(gradientField); return; }
    const effectField = event.target.closest('[data-effect-field]');
    if (effectField) { updateLayerEffectInput(effectField); return; }
    const networkFace = event.target.closest('[data-network-face-fill], [data-network-face-opacity]');
    if (networkFace) { updateNetworkFaceInput(networkFace); return; }
    const quality = event.target.closest('[data-export-field="quality"]');
    if (quality) { quality.parentElement.querySelector('output').value = `${quality.value}%`; return; }
    const guideField = event.target.closest('[data-guide-field]');
    if (guideField) {
      if (guideField.dataset.guideField === 'opacity') guideField.parentElement.querySelector('output').value = `${guideField.value}%`;
      updateLayoutGuide(guideField);
      return;
    }
    updateInspectorInput(event);
    if (event.target.id === 'prototype-duration') {
      state.prototypeDuration = Number(event.target.value);
      $('#prototype-duration-value').textContent = `${(state.prototypeDuration / 1000).toFixed(1)} s`;
    }
    if (event.target.id === 'prototype-delay') {
      state.prototypeDelay = Number(event.target.value);
      $('#prototype-delay-value').textContent = `${(state.prototypeDelay / 1000).toFixed(1)} s`;
    }
    if (event.target.id === 'prototype-condition-value') state.prototypeConditionValue = event.target.value;
    if (event.target.id === 'prototype-overlay-opacity') state.prototypeOverlayBackgroundOpacity = Number(event.target.value) / 100;
  });
  $('#inspector-content').addEventListener('change', event => {
    if (state.documentTransitioning) return;
    if (event.target.id === 'effect-style-select') {
      selectedEffectStyleId = event.target.value;
      const styleExists = state.document.effectStyles?.some(style => style.id === selectedEffectStyleId) || false;
      const entries = selectedEntries();
      const canApply = entries.length > 0 && entries.every(({ node, parents }) => !node.locked && !parents.some(parent => parent.locked));
      for (const button of event.currentTarget.querySelectorAll('[data-effect-style-action]')) {
        const action = button.dataset.effectStyleAction;
        button.disabled = !styleExists || (action === 'apply' && !canApply) || (action === 'update' && entries.length !== 1);
      }
      return;
    }
    if (event.target.id === 'prototype-flow-select') {
      if (event.target.value && event.target.value !== state.document.prototypeStartFlowId) {
        try {
          checkpoint('Select prototype flow'); setPrototypeStartFlow(state.document, event.target.value);
          renderInspector(); queueSave();
        } catch (error) { showToast(error.message || 'Could not select this prototype flow.'); }
      }
      return;
    }
    if (event.target.id === 'component-library-target') {
      state.componentLibraryTargetId = event.target.value || null;
      return;
    }
    const vectorAnchorMode = event.target.closest('[data-vector-anchor-mode]');
    if (vectorAnchorMode) { updateVectorAnchorMode(vectorAnchorMode); return; }
    if (event.target.id === 'prototype-condition-value') { state.prototypeConditionValue = event.target.value; return; }
    if (event.target.id === 'prototype-condition-operator') { state.prototypeConditionOperator = event.target.value; return; }
    if (event.target.id === 'prototype-condition-variable') {
      state.prototypeConditionVariableId = event.target.value || null;
      const variable = state.document.variables?.find(item => item.id === state.prototypeConditionVariableId);
      state.prototypeConditionValue = variable ? String(resolveVariableValue(state.document, variable.id)) : null;
      renderInspector();
      return;
    }
    if (event.target.matches('[data-image-transform-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-image-fill-zoom]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-stroke-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-fill-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-image-fill-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-gradient-geometry-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-gradient-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-effect-field]')) { finishInspectorInput(); return; }
    if (event.target.matches('[data-network-face-fill], [data-network-face-opacity]')) { finishInspectorInput(); return; }
    const guideField = event.target.closest('[data-guide-field]');
    if (guideField) { updateLayoutGuide(guideField, true); return; }
    const exportField = event.target.closest('[data-export-field]');
    if (exportField) { updateExportSetting(exportField); return; }
    if (event.target.matches('[data-prop="fontFamily"]') && !event.target.value.trim()) {
      event.target.value = selectedNodes()[0]?.fontFamily || 'Inter, Arial, sans-serif';
      finishInspectorInput();
      return;
    }
    if (event.target.matches('[data-prop]')) finishInspectorInput();
    if (event.target.matches('[data-variable-binding]')) applyColorVariableToSelection(event.target.value, event.target.dataset.variableBinding);
    if (event.target.matches('[data-variable-property-binding]')) applyVariablePropertyToSelection(event.target.dataset.variablePropertyBinding, event.target.value);
    if (event.target.matches('[data-frame-variable-mode]')) {
      const frame = selectedNodes()[0];
      if (frame?.type === 'frame') {
        const collectionId = event.target.dataset.frameVariableMode;
        const modeId = event.target.value || null;
        const candidate = cloneDocument(state.document);
        if (!setFrameVariableMode(candidate, frame.id, collectionId, modeId)) {
          event.target.value = frame.variableModes?.[collectionId] || '';
          showToast('That mode conflicts with a bound value on this frame. Resolve the binding first.');
          return;
        }
        checkpoint('Set frame variable mode');
        if (!setFrameVariableMode(state.document, frame.id, collectionId, modeId)) {
          event.target.value = frame.variableModes?.[collectionId] || '';
          showToast('The frame mode could not be applied. Your previous mode was kept.');
          return;
        }
        resizeTextLayers([frame]);
        relayoutVariableBoundFrames();
        const instanceRoot = componentInstanceRoot(frame.id);
        if (instanceRoot) recordComponentOverride(instanceRoot, frame, 'variableModes');
        renderUI(); queueSave(); renderer.invalidate();
      }
    }
    if (event.target.id === 'component-property-target') {
      state.componentPropertyTargetId = event.target.value;
      renderInspector();
    }
    if (event.target.id === 'component-property-type') {
      state.componentPropertyType = event.target.value;
      renderInspector();
    }
    if (event.target.matches('[data-component-property-value]')) {
      const instanceId = event.target.dataset.instanceId;
      const propertyId = event.target.dataset.componentPropertyValue;
      const instance = findNode(state.document, instanceId)?.node;
      const property = state.document.components?.find(item => item.id === instance?.componentId)?.componentProperties?.find(item => item.id === propertyId);
      const value = property?.type === 'BOOLEAN' ? event.target.checked : event.target.value;
      changeInstanceComponentProperty(instanceId, propertyId, value);
    }
    if (event.target.matches('[data-variant-property]')) changeInstanceVariant(event.target.dataset.instanceId, event.target.dataset.variantProperty, event.target.value);
    if (event.target.matches('[data-variant-master-property]')) changeMainVariantProperty(event.target.dataset.componentId, event.target.dataset.variantMasterProperty, event.target.value);
    if (event.target.id === 'prototype-action') {
      const previousAction = state.prototypeAction;
      state.prototypeAction = event.target.value;
      if (state.prototypeSourceId && !['navigate', 'open-overlay', 'swap-overlay'].includes(state.prototypeAction)) clearPrototypeConnectPrompt();
      if (!['navigate', 'open-overlay', 'swap-overlay'].includes(state.prototypeAction) && state.prototypeTrigger === 'after-delay') state.prototypeTrigger = 'on-click';
      if (state.prototypeAction !== 'navigate' && state.prototypeTransition === 'smart-animate') state.prototypeTransition = 'dissolve';
      if (state.prototypeAction === 'scroll-to') state.prototypeTransition = 'scroll';
      else if (previousAction === 'scroll-to' && state.prototypeTransition === 'scroll') state.prototypeTransition = 'instant';
      if (state.prototypeAction === 'set-variable-mode') {
        const collection = state.document.variableCollections?.find(item => item.id === state.prototypeVariableCollectionId) || state.document.variableCollections?.[0];
        state.prototypeVariableCollectionId = collection?.id || null;
        state.prototypeVariableModeId = defaultVariableMode(collection)?.id || null;
      }
      renderInspector();
      syncPrototypeConnectPrompt();
    }
    if (event.target.id === 'prototype-variable-collection') {
      state.prototypeVariableCollectionId = event.target.value;
      state.prototypeVariableModeId = defaultVariableMode(state.document.variableCollections?.find(item => item.id === event.target.value))?.id || null;
      renderInspector();
    }
    if (event.target.id === 'prototype-variable-mode') state.prototypeVariableModeId = event.target.value;
    if (event.target.id === 'prototype-variant-target') state.prototypeVariantTargetId = event.target.value;
    if (event.target.id === 'prototype-destination') state.prototypeDestinationId = event.target.value || null;
    if (event.target.id === 'prototype-scroll-target') state.prototypeScrollTargetId = event.target.value || null;
    if (event.target.id === 'prototype-scroll-alignment') state.prototypeScrollAlignment = event.target.value;
    if (event.target.id === 'prototype-trigger') { state.prototypeTrigger = event.target.value; renderInspector(); }
    if (event.target.id === 'prototype-url') state.prototypeUrl = event.target.value;
    if (event.target.id === 'prototype-transition') { state.prototypeTransition = event.target.value; renderInspector(); }
    if (event.target.id === 'prototype-easing') state.prototypeEasing = event.target.value;
    if (event.target.id === 'prototype-duration') state.prototypeDuration = Number(event.target.value);
    if (event.target.id === 'prototype-delay') state.prototypeDelay = Number(event.target.value);
    if (event.target.id === 'prototype-overlay-position') state.prototypeOverlayPosition = event.target.value;
    if (event.target.id === 'prototype-overlay-outside') state.prototypeOverlayOutsideClick = event.target.checked;
    if (event.target.id === 'prototype-overlay-background') { state.prototypeOverlayBackground = event.target.checked; renderInspector(); }
    if (event.target.id === 'prototype-overlay-color') state.prototypeOverlayBackgroundColor = event.target.value;
    if (event.target.id === 'prototype-overlay-opacity') state.prototypeOverlayBackgroundOpacity = Number(event.target.value) / 100;
  });
  $('#inspector-content').addEventListener('pointerdown', beginGradientStopPointer);
  $('#inspector-content').addEventListener('pointermove', updateGradientStopPointer);
  $('#inspector-content').addEventListener('pointerup', finishGradientStopPointer);
  $('#inspector-content').addEventListener('pointercancel', finishGradientStopPointer);
  $('#inspector-content').addEventListener('lostpointercapture', finishGradientStopPointer);
  $('#inspector-content').addEventListener('keydown', handleGradientStopKey);
  $('#inspector-content').addEventListener('focusout', finishInspectorInput);
  $('#inspector-content').addEventListener('click', event => {
    const gradientHandle = event.target.closest('[data-gradient-stop-handle]');
    if (gradientHandle) return;
    const gradientTrack = event.target.closest('[data-gradient-stop-track]');
    if (gradientTrack) {
      const bounds = gradientTrack.getBoundingClientRect();
      if (bounds.width > 0) addGradientStopAtPosition(gradientTrack, (event.clientX - bounds.left) / bounds.width);
      return;
    }
    const commentAction = event.target.closest('[data-comment-action]');
    if (commentAction) { handleCommentAction(commentAction); return; }
    const copy = event.target.closest('[data-inspect-copy]');
    if (copy) { copyInspectText(copy.dataset.inspectCopy); return; }
    const effectStyleAction = event.target.closest('[data-effect-style-action]');
    if (effectStyleAction) { handleEffectStyleAction(effectStyleAction.dataset.effectStyleAction); return; }
    const button = event.target.closest('[data-action]');
    if (button) applyInspectorAction(button.dataset.action, button.dataset);
  });
  $('#inspector-content').addEventListener('submit', event => {
    const form = event.target.closest('[data-comment-form]');
    if (!form) return;
    event.preventDefault(); submitCommentForm(form);
  });
  $('#layers-section').addEventListener('dblclick', event => { if (event.target.id === 'empty-layers') setTool('frame'); });
  $('#search-layers').addEventListener('click', () => { $('#layer-search-wrap').hidden = !$('#layer-search-wrap').hidden; if (!$('#layer-search-wrap').hidden) $('#layer-search').focus(); });
  $('#layer-search').addEventListener('input', event => { state.layerSearch = event.currentTarget.value; renderLayers(); });
  $('#layer-options').addEventListener('click', event => {
    const items = [
      { label: 'Show all layers', action: () => { checkpoint('Show all layers'); walkNodes(activePage().children, ({ node }) => { setNodePropertyValue(node, 'visible', true); }); renderUI(); queueSave(); } },
      { label: 'Unlock all layers', action: () => { checkpoint('Unlock all layers'); walkNodes(activePage().children, ({ node }) => { node.locked = false; }); renderUI(); queueSave(); } },
      { label: 'Select all layers', shortcut: '⌘A', action: () => setSelection(pageLayerRows().map(entry => entry.node.id)) }
    ];
    const ids = rootSelectedIds();
    const node = selectedNodes()[0];
    if (canCreateMaskGroup(state.document, ids)) items.unshift({ label: 'Use selected layers as mask', action: maskSelectedLayers }, { separator: true });
    if (selectedNodes().length === 1 && node?.type === 'group' && node.mask) items.unshift({ label: 'Release selected mask', action: () => releaseSelectedMask(node.id) }, { separator: true });
    showMenu(items, event.clientX, event.clientY, event.currentTarget, 'Layer options');
  });
  $('#place-image-assets').addEventListener('click', chooseImageFiles);
  $('#import-design-tokens').addEventListener('click', () => {
    if (state.documentTransitioning) { showToast('Wait for the current design switch to finish before importing tokens.'); return; }
    $('#design-token-file-input').click();
  });
  $('#design-token-file-input').addEventListener('change', event => {
    const input = event.currentTarget;
    importDesignTokens(input.files?.[0]);
    input.value = '';
  });
  $('#export-design-tokens').addEventListener('click', exportDesignTokens);
  $('#add-variable-collection').addEventListener('click', () => handleVariableAssetsAction('add-variable-collection'));
  $('#variable-collections-list').addEventListener('click', event => {
    const apply = event.target.closest('[data-variable-apply]');
    if (apply) { applyColorVariableToSelection(apply.dataset.variableApply); return; }
    const action = event.target.closest('[data-action]');
    if (action) handleVariableAssetsAction(action.dataset.action, action.dataset);
  });
  $('#variable-collections-list').addEventListener('input', event => {
    const input = event.target.closest('[data-variable-value]');
    if (!input) return;
    if (input.type === 'number' && (!input.value || !Number.isFinite(Number(input.value)))) return;
    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    if (!state.controlEdit) { checkpoint('Edit variable'); state.controlEdit = true; }
    setVariableValue(state.document, input.dataset.variableValue, value, input.dataset.modeId);
    resizeTextLayers(state.document.pages.flatMap(page => page.children), input.dataset.variableValue);
    relayoutVariableBoundFrames();
    renderer.invalidate();
  });
  $('#variable-collections-list').addEventListener('change', event => {
    const alias = event.target.closest('[data-variable-alias]');
    if (alias) {
      const variable = state.document.variables?.find(item => item.id === alias.dataset.variableAlias);
      checkpoint(`Change ${variable?.name || 'variable'} alias`);
      if (!setVariableAlias(state.document, alias.dataset.variableAlias, alias.value || null, alias.dataset.modeId)) showToast('Aliases must target another variable of the same type and cannot create a cycle.');
      resizeTextLayers(state.document.pages.flatMap(page => page.children));
      relayoutVariableBoundFrames();
      state.controlEdit = false; renderUI(); queueSave(); renderer.invalidate(); return;
    }
    const mode = event.target.closest('[data-variable-default-mode]');
    if (mode) {
      const collection = state.document.variableCollections?.find(item => item.id === mode.dataset.variableDefaultMode);
      if (!collection || collection.defaultModeId === mode.value) return;
      checkpoint('Change default variable mode'); collection.defaultModeId = mode.value;
      resizeTextLayers(state.document.pages.flatMap(page => page.children));
      renderUI(); queueSave(); renderer.invalidate(); return;
    }
    if (event.target.matches('[data-variable-value]')) {
      state.controlEdit = false; renderUI(); queueSave(); renderer.invalidate();
    }
  });
  $('#create-component-library').addEventListener('click', () => {
    void createLocalComponentLibrary().catch(error => showToast(error.message || 'Could not create a local component library.'));
  });
  $('#component-library-list').addEventListener('click', event => {
    const publish = event.target.closest('[data-publish-local-component]');
    if (publish) {
      const component = selectedNodes()[0]?.componentId;
      void publishComponentToLocalLibrary({ componentId: component, libraryId: publish.dataset.publishLocalComponent })
        .catch(error => showToast(error.message || 'Could not publish this component locally.'));
      return;
    }
    const place = event.target.closest('[data-local-library-id][data-local-component-id]');
    if (place) void placeLocalLibraryComponent(place.dataset.localLibraryId, place.dataset.localComponentId)
      .catch(error => showToast(error.message || 'Could not place this local component.'));
  });
  $('#components-list').addEventListener('click', event => {
    const action = event.target.closest('[data-action="add-component-variant-axis"], [data-action="remove-component-variant-axis"], [data-action="add-component-variant-from-master"], [data-action="remove-component-variant-from-set"]');
    if (action) {
      const setId = action.dataset.setId;
      if (action.dataset.action === 'add-component-variant-axis') {
        const card = action.closest('.component-set-card');
        const name = card?.querySelector(`[data-component-set-new-axis="${setId}"]`)?.value;
        const value = card?.querySelector(`[data-component-set-new-value="${setId}"]`)?.value;
        editComponentSet('Add component variant axis', document => addComponentVariantAxis(document, setId, name, value), 'Variant axis added to every variant.');
      } else if (action.dataset.action === 'add-component-variant-from-master') {
        const card = action.closest('.component-set-card');
        const sourceComponentId = card?.querySelector(`[data-component-set-placement="${setId}"]`)?.value;
        const values = Object.fromEntries([...(card?.querySelectorAll(`[data-component-set-new-variant-value="${setId}"]`) || [])]
          .filter(input => input.value.trim())
          .map(input => [input.dataset.axisName, input.value]));
        let added = null;
        const committed = editComponentSet('Add component variant', document => {
          added = addComponentVariantFromMaster(document, setId, sourceComponentId, values);
        }, 'Variant added from the selected master.');
        if (committed && added) {
          state.componentSetSelectedVariants.set(setId, added.id);
          renderAssetsTab();
        }
      } else if (action.dataset.action === 'remove-component-variant-from-set') {
        const componentId = action.dataset.componentId;
        const committed = editComponentSet('Remove component variant from set', document => removeComponentVariantFromSet(document, setId, componentId), 'Variant removed from the set; its master and linked instances were kept.');
        if (committed) {
          const set = state.document.componentSets?.find(item => item.id === setId);
          if (set && !set.componentIds.includes(state.componentSetSelectedVariants.get(setId))) {
            state.componentSetSelectedVariants.set(setId, set.componentIds[0]);
          }
          renderAssetsTab();
        }
      } else {
        const axisName = action.dataset.axisName;
        editComponentSet(`Remove ${axisName} variant axis`, document => removeComponentVariantAxis(document, setId, axisName), `Variant axis “${axisName}” removed.`);
      }
      return;
    }
    const exactVariant = event.target.closest('[data-place-variant]');
    if (exactVariant) {
      const card = exactVariant.closest('.component-set-card');
      const setId = card?.dataset.componentSetPanel;
      if (setId) state.componentSetSelectedVariants.set(setId, exactVariant.dataset.placeVariant);
      createInstanceAt(exactVariant.dataset.placeVariant); return;
    }
    const placeSelected = event.target.closest('button[data-component-set-id]');
    if (placeSelected) {
      const card = placeSelected.closest('.component-set-card');
      const selectedId = card?.querySelector('[data-component-set-placement]')?.value;
      const set = state.document.componentSets?.find(item => item.id === placeSelected.dataset.componentSetId);
      if (set?.componentIds.includes(selectedId)) {
        state.componentSetSelectedVariants.set(set.id, selectedId);
        createInstanceAt(selectedId);
      }
      else showToast('Choose a variant from this component set first.');
      return;
    }
    const card = event.target.closest('button[data-component-id]');
    if (card) createInstanceAt(card.dataset.componentId);
  });
  $('#components-list').addEventListener('change', event => {
    const placement = event.target.closest('[data-component-set-placement]');
    if (placement) {
      state.componentSetSelectedVariants.set(placement.dataset.componentSetPlacement, placement.value);
      return;
    }
    const setName = event.target.closest('[data-component-set-name]');
    if (setName) {
      const setId = setName.dataset.setId;
      const set = state.document.componentSets?.find(item => item.id === setId);
      if (!set || set.name === setName.value.trim()) return;
      editComponentSet('Rename component set', document => renameComponentSet(document, setId, setName.value), 'Component set renamed.');
      return;
    }
    const axisName = event.target.closest('[data-component-set-axis-name]');
    if (axisName) {
      const setId = axisName.dataset.setId;
      const oldName = axisName.dataset.axisOldName;
      const value = axisName.value;
      if (value.trim() === oldName) return;
      editComponentSet('Rename component variant axis', document => renameComponentVariantAxis(document, setId, oldName, value), 'Variant axis renamed.');
      return;
    }
    const variantValue = event.target.closest('[data-variant-master-property]');
    if (variantValue) changeMainVariantProperty(variantValue.dataset.componentId, variantValue.dataset.variantMasterProperty, variantValue.value);
  });
  $('#color-styles-list').addEventListener('click', event => {
    const action = event.target.closest('[data-color-style-action]');
    if (action) {
      if (action.dataset.colorStyleAction === 'update') updateColorStyleFromSelection(action.dataset.colorStyleId);
      else if (action.dataset.colorStyleAction === 'rename') renameColorStyleInAssets(action.dataset.colorStyleId);
      else if (action.dataset.colorStyleAction === 'delete') removeColorStyleFromAssets(action.dataset.colorStyleId);
      return;
    }
    const style = event.target.closest('button[data-color-style-id]');
    if (style) applyStyleToSelection(style.dataset.colorStyleId);
  });
  $('#text-styles-list').addEventListener('click', event => {
    const action = event.target.closest('[data-text-style-action]');
    if (action) {
      if (action.dataset.textStyleAction === 'update') updateTypographyStyleFromSelection(action.dataset.textStyleId);
      else if (action.dataset.textStyleAction === 'rename') renameTypographyStyleInAssets(action.dataset.textStyleId);
      else if (action.dataset.textStyleAction === 'delete') removeTypographyStyleFromAssets(action.dataset.textStyleId);
      return;
    }
    const style = event.target.closest('[data-typography-style-id]');
    if (style) applyTypographyStyleToSelection(style.dataset.typographyStyleId);
  });
  $('#file-menu-button').addEventListener('click', event => openFileMenu(event.clientX || 72, event.clientY || 45, null, event.currentTarget));
  $('#main-menu-button').addEventListener('click', event => openFileMenu(event.clientX || 18, event.clientY || 45, null, event.currentTarget));
  $('#canvas-menu').addEventListener('click', event => openFileMenu(event.clientX || innerWidth - 36, event.clientY || 50, null, event.currentTarget));
  $('#design-library-close').addEventListener('click', () => $('#design-library-dialog').close());
  $('#design-library-export').addEventListener('click', exportDesign);
  $('#design-library-new').addEventListener('click', async () => {
    $('#design-library-dialog').close();
    await newDesign();
  });
  $('#design-library-list').addEventListener('click', event => {
    const button = event.target.closest('[data-design-action]');
    if (button) void handleDesignLibraryAction(button.dataset.designAction, button.dataset.designId);
  });
  $('#version-history-close').addEventListener('click', () => $('#version-history-dialog').close());
  $('#version-save-form').addEventListener('submit', event => {
    event.preventDefault();
    void saveNamedDocumentVersion($('#version-save-name').value);
  });
  $('#version-history-list').addEventListener('click', event => {
    const button = event.target.closest('[data-version-action="restore"]');
    if (button) void restoreDocumentVersion(button.dataset.versionId);
  });
  $('#share-button').addEventListener('click', () => { void shareDesignFile(); });
  $('#mode-button').addEventListener('click', () => { const nextTab = state.inspectorTab === 'prototype' ? 'design' : 'prototype'; clearPrototypeConnectPrompt(); setInspectorTab(nextTab); });
  $('#prototype-connect-cancel').addEventListener('click', cancelPrototypeConnection);
  $$('.inspector-tab').forEach(tab => tab.addEventListener('click', () => setInspectorTab(tab.dataset.inspectorTab)));
  $('#present-button').addEventListener('click', () => startPresentation());
  $('#present-back').addEventListener('click', backPresentation);
  $('#present-restart').addEventListener('click', () => restartPresentation());
  $('#present-flow-select').addEventListener('change', event => restartPresentation(event.currentTarget.value));
  $('#present-exit').addEventListener('click', () => $('#present-dialog').close());
  $('#present-dialog').addEventListener('close', () => {
    clearPresentationDelay();
    cancelPresentationAnimation();
    presentationPointerGesture = null;
    presentRenderer?.destroy(); presentRenderer = null; presentRenderState = null; presentRuntimeDocument = null; state.presenting = null;
    $('#present-canvas').style.removeProperty('touch-action');
    $('#present-canvas').style.opacity = '1'; $('#present-canvas').style.transform = 'translateX(0)';
  });
  $('#present-canvas').addEventListener('pointerdown', handlePresentationPointerDown);
  $('#present-canvas').addEventListener('pointerup', handlePresentationPointerUp);
  $('#present-canvas').addEventListener('pointercancel', handlePresentationPointerCancel);
  $('#present-canvas').addEventListener('lostpointercapture', handlePresentationPointerCancel);
  $('#present-canvas').addEventListener('pointermove', handlePresentationPointerMove);
  window.addEventListener('resize', () => { if (state.presenting) renderPresentationFrame(); });
  $$('.sidebar-tab').forEach(tab => tab.addEventListener('click', () => { state.sidebarTab = tab.dataset.sidebarTab; syncSidebarTabAccessibility(); }));
  $('#export-selection').addEventListener('click', exportSelectionPng);
  $('#recipe-dialog').addEventListener('close', () => {
    if ($('#recipe-dialog').returnValue !== 'save' || !pendingRecipeNodeId) return;
    const node = findNode(state.document, pendingRecipeNodeId)?.node; if (!node) return;
    checkpoint('Save image recipe');
    const recipe = createImageRecipe(node, $('#recipe-name').value, {
      format: $('#recipe-format').value,
      quality: Number($('#recipe-quality').value),
    }, state.document); state.document.recipes.push(recipe); pendingRecipeNodeId = null;
    queueSave(); renderInspector(); showToast(`Recipe “${recipe.name}” saved. Use Image recipes to apply it.`);
  });
  $('#recipe-format').addEventListener('change', syncRecipeOutputControls);
  $('#recipe-quality').addEventListener('input', syncRecipeOutputControls);
  $('#recipe-form').addEventListener('submit', event => { if (event.submitter?.value === 'save') $('#recipe-dialog').returnValue = 'save'; });
  $('#component-slot-search').addEventListener('input', event => {
    if (!state.componentSlotDialog) return;
    state.componentSlotDialog.query = event.currentTarget.value;
    renderComponentSlotCandidateList();
  });
  $('#component-slot-candidates').addEventListener('change', event => {
    const checkbox = event.target.closest('[data-slot-candidate]');
    if (!checkbox || !state.componentSlotDialog) return;
    if (checkbox.checked) state.componentSlotDialog.selectedIds.add(checkbox.dataset.slotCandidate);
    else state.componentSlotDialog.selectedIds.delete(checkbox.dataset.slotCandidate);
  });
  $('#component-slot-form').addEventListener('submit', event => {
    if (!['apply', 'cancel'].includes(event.submitter?.value)) event.preventDefault();
  });
  $('#component-slot-dialog').addEventListener('close', () => {
    const dialogState = state.componentSlotDialog;
    state.componentSlotDialog = null;
    if ($('#component-slot-dialog').returnValue === 'apply') applyComponentSlotDialog(dialogState);
  });
  $('#variable-dialog').addEventListener('close', commitVariableNameDialog);
  $('#variable-form').addEventListener('submit', event => { if (event.submitter?.value === 'save') $('#variable-dialog').returnValue = 'save'; });
  $('#bulk-speed').max = String(CPU_LIMIT);
  $('#bulk-speed').addEventListener('input', event => {
    if (!isImageRecipeBatchActive(state.bulk) || state.bulk.cancelled || state.bulk.journalPending) return;
    state.bulk.concurrency = Math.max(1, Math.min(CPU_LIMIT, Math.trunc(Number(event.currentTarget.value)) || 1));
    scheduleBulkConcurrency(state.bulk); renderBulkBar(); scheduleBulk();
  });
  $('#bulk-speed').addEventListener('change', () => {
    if (!isImageRecipeBatchActive(state.bulk) || state.bulk.cancelled || state.bulk.journalPending) return;
    scheduleBulkConcurrency(state.bulk, true);
  });
  $('#bulk-pause').addEventListener('click', () => {
    if (!isImageRecipeBatchActive(state.bulk) || state.bulk.cancelled) return;
    state.bulk.paused = !state.bulk.paused;
    if (state.bulk.paused) {
      pauseImageRecipeBatchClock(state.bulk);
      imageEngine.pauseQueueGroup(state.bulk.queueGroup);
    } else {
      resumeImageRecipeBatchClock(state.bulk);
      imageEngine.resumeQueueGroup(state.bulk.queueGroup);
    }
    renderBulkBar(); if (!state.bulk.paused) scheduleBulk();
  });
  $('#bulk-cancel').addEventListener('click', cancelBulkRecipe);
  $('#bulk-retry').addEventListener('click', retryFailedRecipeTargets);
  $('#bulk-done').addEventListener('click', async () => {
    const bulk = state.bulk;
    if (!bulk) return;
    if (!canDismissImageRecipeBatch(bulk) || bulk.savePending || bulk.journalPending) return;
    if (bulk.saveError && !bulk.recoveryError) {
      if (await persistCurrentDocumentNow() && state.bulk === bulk) renderBulkBar();
      return;
    }
    bulk.journalPending = true;
    bulk.recoveryError = false;
    renderBulkBar();
    if (!(await persistCurrentDocumentNow()) || state.bulk !== bulk) {
      bulk.journalPending = false;
      renderBulkBar();
      return;
    }
    stopRecipeBatchLeaseHeartbeat(bulk);
    try {
      await deleteRecipeBatchRecovery(state.document.id, bulk.ownerToken);
      if (state.bulk !== bulk) return;
      state.bulk = null;
      renderBulkBar(); renderInspector();
    } catch (error) {
      if (state.bulk !== bulk) return;
      bulk.journalPending = false;
      bulk.recoveryError = true;
      bulk.saveError = error.message || 'Could not clear the recipe recovery record.';
      showToast('The edits are saved, but the recipe recovery record could not be cleared. Retry cleanup before dismissing the batch.');
      renderBulkBar();
    }
  });
  const recoveryDialog = $('#recipe-recovery-dialog');
  recoveryDialog.addEventListener('cancel', event => event.preventDefault());
  $('#recipe-recovery-keep').addEventListener('click', () => { void keepInterruptedRecipeChanges(); });
  $('#recipe-recovery-resume').addEventListener('click', resumeInterruptedRecipe);
  $('#toggle-rulers').addEventListener('click', event => {
    if (state.interaction?.kind?.startsWith('ruler-guide-')) cancelCanvasInteraction({ pointerId: state.interaction.pointerId });
    state.showRulers = !state.showRulers;
    $('#ruler-horizontal').hidden = !state.showRulers;
    $('#ruler-vertical').hidden = !state.showRulers;
    event.currentTarget.classList.toggle('is-active', state.showRulers);
    event.currentTarget.setAttribute('aria-pressed', String(state.showRulers));
    if (!state.showRulers) state.selectedRulerGuideId = null;
    renderer.invalidate();
  });
  $('#outline-mode').addEventListener('click', toggleOutlineMode);
  $('#local-info').addEventListener('click', () => showToast('Design metadata and source images are stored in this browser only.'));
  $('#sidebar-toggle').addEventListener('click', () => toggleMobilePanel('left'));
  $('#inspector-toggle').addEventListener('click', () => toggleMobilePanel('right'));
  $('#mobile-scrim').addEventListener('click', () => closeMobilePanels());
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#context-menu') && !event.target.closest('#file-menu-button') && !event.target.closest('#main-menu-button')) closeMenu(); });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('paste', onDocumentPaste);
  initRichTextEditorEvents();
  installLayerReorder($('#layers-list'), {
    getDocument: () => state.document,
    getPageId: () => state.document.activePageId,
    canStart: () => !state.layerSelectionMode && !state.layerSearch.trim(),
    beforeChange: () => checkpoint('Reorder layers'),
    onChange: () => { renderUI(); queueSave(); renderer.invalidate(); }
  });
}

function onKeyDown(event) {
  if (state.documentTransitioning) return;
  if (state.workspacePermissionNeeded && event.key !== 'Escape') return;
  const contextMenu = $('#context-menu');
  if (event.key.toLowerCase() === 'escape' && state.prototypeSourceId && !document.querySelector('dialog[open]')) {
    if (!contextMenu.hidden) closeMenu();
    clearPrototypeConnectPrompt();
    if (innerWidth <= 820) closeMobilePanels({ restoreFocus: false });
    renderInspector();
    renderer.invalidate();
    canvas.focus({ preventScroll: true });
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape' && !contextMenu.hidden) {
    const returnFocus = contextMenu._returnFocusElement;
    const returnLayerId = returnFocus?.closest('[data-layer-id]')?.dataset.layerId;
    closeMenu();
    const currentRow = returnLayerId ? layerRowsById.get(returnLayerId) : null;
    const fallback = currentRow?.querySelector('[data-action="layer-actions-menu"]') || currentRow;
    const target = menuFocusReturnTarget(returnFocus, fallback);
    if (target && !target.closest('[inert]')) target.focus({ preventScroll: true });
    event.preventDefault();
    return;
  }
  const editing = event.target.matches('input, textarea, select, [contenteditable="true"]');
  if (event.key === 'Escape' && state.imageCropMode && !editing && !document.querySelector('dialog[open]')) {
    if (['image-crop', 'image-fill-crop'].includes(state.interaction?.kind)) cancelCanvasInteraction();
    state.imageCropMode = false;
    state.imageFillCropTarget = null;
    state.imageCropDraftSelection = null;
    syncImageCropOverlay();
    renderInspector();
    renderer.invalidate();
    canvas.focus({ preventScroll: true });
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape' && state.interaction && !editing && !document.querySelector('dialog[open]')) {
    cancelCanvasInteraction({ pointerId: state.interaction.pointerId });
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape' && state.imageExportAbortController && !editing && !document.querySelector('dialog[open]')) {
    state.imageExportAbortController.abort();
    showToast('Export stopped. Any active local render will finish without downloading its result.');
    event.preventDefault();
    return;
  }
  if (trapMobilePanelTab(event)) return;
  if (!contextMenu.hidden && contextMenu.contains(document.activeElement)) {
    const menuItems = contextMenuItems(contextMenu);
    const target = contextMenuNavigationTarget(menuItems, document.activeElement, event.key);
    if (target) {
      target.focus({ preventScroll: true });
      event.preventDefault();
      return;
    }
  }
  if (shouldDismissDesktopMenuOnTab(contextMenu, event, document.activeElement, innerWidth)) {
    const returnFocus = contextMenu._returnFocusElement;
    const returnLayerId = returnFocus?.closest('[data-layer-id]')?.dataset.layerId;
    const currentRow = (returnLayerId && layerRowsById.get(returnLayerId)) || layerRowsById.get(state.selectedIds[0]);
    const fallback = currentRow?.querySelector('[data-action="layer-actions-menu"]') || currentRow || canvas;
    const target = menuFocusReturnTarget(returnFocus, fallback);
    closeMenu();
    target?.focus({ preventScroll: true });
  }
  if (event.key.toLowerCase() === 'escape' && innerWidth <= 820
    && ($('#left-panel').classList.contains('is-open') || $('#right-panel').classList.contains('is-open'))
    && !document.querySelector('dialog[open]')) {
    closeMobilePanels();
    event.preventDefault();
    return;
  }
  if (event.code === 'Space' && !editing) { state.spaceDown = true; event.preventDefault(); }
  if (state.interaction) { event.preventDefault(); return; }
  if (editing) return;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (key === 'escape' && state.tool === 'eyedropper') { setTool('select'); event.preventDefault(); return; }
  if (mod && key === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelectedLayers() : groupSelectedLayers(); return; }
  if (event.shiftKey && key === 'g') { event.preventDefault(); toggleLayoutGuides(); return; }
  if (key === 'escape' && state.presenting?.overlays.length) { event.preventDefault(); backPresentation(); return; }
  if (state.pencilDraft && key === 'escape') { event.preventDefault(); cancelPencilStroke(); showToast('Pencil stroke cancelled.'); return; }
  if (state.penDraft && key === 'enter') { event.preventDefault(); finishPenPath(false); return; }
  if (state.penDraft && key === 'escape') { event.preventDefault(); cancelPenPath(); showToast('Vector path cancelled.'); return; }
  if (mod && event.altKey && key === 'c') { event.preventDefault(); copyAppearanceFrom(); return; }
  if (mod && event.altKey && key === 'v') { event.preventDefault(); pasteAppearanceToSelection(); return; }
  if (mod && key === 'c') { event.preventDefault(); copySelected(); return; }
  if (mod && key === 'x') { event.preventDefault(); cutSelected(); return; }
  // Let the native paste event expose external clipboard image data. The paste
  // handler chooses between placing an image and pasting our internal layers.
  if (mod && key === 'v') return;
  if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if (mod && key === 'y') { event.preventDefault(); redo(); return; }
  if (mod && key === 'd') { event.preventDefault(); duplicateSelected(); return; }
  if (mod && key === 'a') { event.preventDefault(); setSelection(pageLayerRows().map(entry => entry.node.id)); return; }
  if (mod && key === 's') { event.preventDefault(); event.shiftKey ? exportDesign() : queueSave(); return; }
  if (mod && key === 'n') { event.preventDefault(); newDesign(); return; }
  if ((key === 'delete' || key === 'backspace') && state.vectorPointSelectMode
    && selectedNodes().length === 1 && selectedNodes()[0].type === 'path' && !state.selectedVectorPoint) {
    showToast('No anchors are selected. Turn off anchor selection mode before deleting the path layer.');
    event.preventDefault();
    return;
  }
  if ((key === 'delete' || key === 'backspace') && state.selectedVectorPoint) {
    deleteSelectedVectorPoint();
    event.preventDefault();
    return;
  }
  if (key === 'delete' || key === 'backspace') { event.preventDefault(); deleteSelected(); return; }
  if (key === 'escape') { closeMenu(); setSelection([]); return; }
  if (event.shiftKey && !mod && key === 's' && !event.altKey) { event.preventDefault(); setTool('section'); return; }
  if (event.shiftKey && mod && key === 'k' && !event.altKey) { event.preventDefault(); chooseImageFiles(); return; }
  const tools = { v: 'select', h: 'hand', f: 'frame', s: 'slice', r: 'rectangle', o: 'ellipse', l: 'line', p: 'pen', t: 'text', c: 'comment', i: 'eyedropper', q: 'lasso' };
  if (tools[key] && !event.altKey) { setTool(tools[key]); return; }
  const delta = event.shiftKey ? 10 : 1;
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && selectedNodes().length) {
    const entries = orderedRootSelectedEntries();
    const blocked = selectionMoveBlockReason(entries.map(item => ({ node: item.node, ancestors: item.parents })));
    if (blocked) {
      const message = blocked === 'locked' ? 'Unlock the selected layers and parent frames before moving them.'
        : blocked === 'auto-layout' ? 'Auto layout controls these positions. Select absolute-positioned layers to nudge them.'
          : 'Unlink position variables before nudging these layers.';
      showToast(message); event.preventDefault(); return;
    }
    const dx = key === 'arrowleft' ? -delta : key === 'arrowright' ? delta : 0;
    const dy = key === 'arrowup' ? -delta : key === 'arrowdown' ? delta : 0;
    const patches = translateSelection(entries.map(item => ({ node: item.node, ancestors: item.parents })), { x: dx, y: dy });
    checkpoint('Nudge layers');
    applyInspectorSelectionPatches(patches, ['x', 'y']);
    renderer.invalidate(); renderLayers(); renderInspector(); queueSave(); event.preventDefault();
  }
}

function onKeyUp(event) {
  if (event.code === 'Space') { state.spaceDown = false; canvas.classList.remove('is-panning'); }
}

async function restoreSavedWorkspaceOnBoot() {
  let handle;
  try { handle = await loadWorkspaceDirectoryHandle(); }
  catch (error) {
    console.warn('Could not read the saved folder workspace reference.', error);
    return false;
  }
  if (!handle) return false;
  state.workspaceHandle = handle;
  let permission = 'prompt';
  try { permission = await handle.queryPermission({ mode: 'readwrite' }); }
  catch (error) { console.warn('Could not check folder workspace permission.', error); }
  if (permission !== 'granted') {
    state.workspacePermissionNeeded = true;
    syncStorageModeLabel();
    return false;
  }
  try {
    const workspace = await openWorkspace(handle);
    const designIds = await listWorkspaceDesignIds(workspace);
    const designId = designIds.includes(state.document.id) ? state.document.id : designIds[0];
    if (!designId) throw new Error('The selected folder workspace has no completed designs to open.');
    const opened = await openWorkspaceDesign(workspace, designId);
    state.workspace = workspace;
    state.workspaceHead = opened.head;
    state.document = opened.document;
    state.pendingRecipeRecovery = await recipeRecoveryForDocument(opened.document.id);
    state.documentStorageRevision = (await loadDocumentRecordById(opened.document.id))?.revision ?? null;
    state.workspaceVerifiedImageIds.set(opened.document.id, new Set(collectReferencedAssets(opened.document).imageAssetIds));
    const fonts = await listWorkspaceFontAssets(workspace, opened.document.id).catch(error => {
      if (workspaceNotFound(error, 'FONT_NOT_FOUND')) return [];
      throw error;
    });
    state.workspaceVerifiedFontIds.set(opened.document.id, new Set(fonts.map(font => font.metadata.id)));
    syncStorageModeLabel();
    return true;
  } catch (error) {
    console.warn('Could not reopen the saved folder workspace.', error);
    state.workspacePermissionNeeded = true;
    syncStorageModeLabel();
    showToast('The saved folder workspace could not be reopened. Reconnect it from the File menu before editing.');
    return false;
  }
}

async function boot() {
  let restoreReadSucceeded = false;
  let restoredSavedDocument = false;
  let migratedImageLibrary = false;
  try {
    const restoration = await loadLatestValidDocument(parseDocument);
    restoreReadSucceeded = true;
    if (restoration.document) {
      state.document = restoration.document;
      state.documentStorageRevision = restoration.revision;
      restoredSavedDocument = true;
      state.pendingRecipeRecovery = await recipeRecoveryForDocument(state.document.id);
    }
    if (restoration.invalidRecords.length) {
      console.warn('Some saved local design snapshots could not be opened.', restoration.invalidRecords);
      showToast(restoration.document
        ? 'A newer saved design could not be opened. Restored the most recent valid version; the damaged design remains in Your designs for manual repair.'
        : 'Saved designs could not be opened. Started a new design; damaged files remain in Your designs for manual repair.', 8000);
    }
  } catch (error) { console.warn('Could not restore local design', error); showToast('A saved design could not be restored. A new file is ready.'); }
  const reopenedFolder = await restoreSavedWorkspaceOnBoot();
  if (!state.workspace && !state.workspacePermissionNeeded) {
    try { migratedImageLibrary = await ensureImageLibraryCompatibility(state.document); }
    catch (error) { console.warn('Could not migrate legacy image sources into the reusable image library.', error); }
  }
  try { await refreshLocalFontAssets({ showFailureToast: true }); }
  catch (error) { console.warn('Could not restore local fonts', error); }
  renderer = new SceneRenderer(canvas, () => state, drawRulerScales);
  state.panX = canvas.clientWidth / 2; state.panY = canvas.clientHeight / 2;
  initEvents(); renderUI(); state.ready = true;
  if (state.pendingRecipeRecovery) setDocumentEditingBlocked(true);
  else if (state.workspacePermissionNeeded) {
    $('.workspace').inert = true;
    $('#document-name').readOnly = true;
  }
  try { await restoreImageAssets(); } catch (error) { showToast(error.message); }
  renderRecipeRecoveryPrompt();
  if (state.workspacePermissionNeeded) {
    setSaveState('error', 'Reconnect folder to edit');
  } else if (reopenedFolder) {
    setSaveState('saved', savedStatusText());
  } else if (restoreReadSucceeded) {
    if (restoredSavedDocument && migratedImageLibrary) await persistCurrentDocumentNow();
    else if (restoredSavedDocument) setSaveState('saved', savedStatusText());
    else await persistCurrentDocumentNow();
  } else if (!await loadLatestDocument().catch(() => null)) await persistCurrentDocumentNow();
  else setSaveState('saved', savedStatusText());
  document.documentElement.dataset.appReady = 'true';
  if (location.hash.startsWith('#tisd1.')) startJoinFromStableLink();
  void refreshLocalComponentLibraries().catch(error => console.warn('Could not load local component libraries', error));
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', () => { syncMobilePanelAccessibility(); renderer.invalidate(); });
  window.addEventListener('beforeunload', () => { imageEngine.destroy(); for (const item of state.assets.values()) { item.bitmap?.close?.(); if (item.bitmapUrl) URL.revokeObjectURL(item.bitmapUrl); } for (const bitmap of state.previews.values()) bitmap.close?.(); for (const url of state.previewUrls.values()) URL.revokeObjectURL(url); for (const url of state.imageLibraryThumbnailUrls.values()) URL.revokeObjectURL(url); imageMemoryBudget.clear(); });
}

syncMobilePanelAccessibility();
boot();
