import { addNode, cloneDocument, createId, createNode, findNode } from './model.js';

/** Prepare a transparent cutout layer without changing the source image. */
export function prepareObjectIsolationLayer(document, {
  pageId = document?.activePageId,
  sourceId,
  assetId,
  width,
  height,
  name
} = {}) {
  if (!document || typeof pageId !== 'string' || typeof sourceId !== 'string' || typeof assetId !== 'string' || !assetId) {
    throw new TypeError('Object isolation needs a source image, page, and local asset.');
  }
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new TypeError('The isolated image dimensions are invalid.');
  }
  const entry = findNode(document, sourceId, pageId);
  if (!entry || entry.node.type !== 'image') throw new Error('The source image is no longer on this page.');
  if (entry.node.locked || entry.parents.some(parent => parent.locked)) {
    throw new Error('Unlock the source image and its parent layers before adding an isolated layer.');
  }
  const source = entry.node;
  const sourceSignature = JSON.stringify(source);
  const sourceWidth = source.sourceWidth || width;
  const sourceHeight = source.sourceHeight || height;
  if (sourceWidth !== width || sourceHeight !== height) {
    throw new Error('The isolated image dimensions no longer match the source image.');
  }
  const parent = entry.parent;
  const layer = createNode('image', {
    id: createId('image'),
    name: name || `${source.name || 'Image'} · isolated`,
    fileName: `${(source.fileName || source.name || 'image').replace(/\.[^.]+$/u, '')}-isolated.png`,
    assetId,
    sourceWidth: width,
    sourceHeight: height,
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
    rotation: source.rotation || 0,
    opacity: 1,
    visible: true,
    locked: false,
    blendMode: 'normal',
    fit: source.fit === 'contain' ? 'contain' : 'cover',
    adjustments: structuredClone(source.adjustments || {}),
    transforms: structuredClone(source.transforms || {}),
    radius: source.radius || 0,
    cornerRadii: source.cornerRadii ? structuredClone(source.cornerRadii) : undefined,
    constraints: source.constraints ? structuredClone(source.constraints) : undefined,
    ...(parent?.autoLayout ? { layoutPositioning: 'absolute' } : {}),
    outputFormat: 'png',
    outputQuality: 100
  });
  if (parent?.autoLayout) {
    // An overlay must not become another flow item or move the original image.
    delete layer.gridCell;
    delete layer.layoutSizingMain;
    delete layer.layoutSizingCross;
  }
  const parentId = parent?.id ?? null;
  const index = entry.index + 1;
  // addNode owns component-slot and container validation. Run it on a clone
  // before any asset is persisted so unsafe insertions leave no orphan output.
  const preflight = cloneDocument(document);
  addNode(preflight, structuredClone(layer), { pageId, parentId, index });
  return { layer, parentId, index, pageId, source, sourceSignature, parents: entry.parents };
}

/** Insert a previously prepared isolated layer immediately above its source. */
export function insertObjectIsolationLayer(document, prepared) {
  if (!prepared || !prepared.layer || typeof prepared.pageId !== 'string') {
    throw new TypeError('A prepared isolated image layer is required.');
  }
  const current = findNode(document, prepared.source?.id, prepared.pageId);
  if (!current || current.node !== prepared.source) throw new Error('The source image changed before the isolated layer could be added.');
  if (JSON.stringify(current.node) !== prepared.sourceSignature) {
    throw new Error('The source image changed before the isolated layer could be added.');
  }
  addNode(document, prepared.layer, { pageId: prepared.pageId, parentId: prepared.parentId, index: prepared.index });
  return prepared.layer;
}
