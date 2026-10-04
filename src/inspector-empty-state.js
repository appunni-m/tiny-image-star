export function inspectorEmptyState(page) {
  const hasLayers = Array.isArray(page?.children) && page.children.length > 0;
  const containsImageContent = node => {
    if (!node || typeof node !== 'object' || node.visible === false || node.opacity === 0) return false;
    if (node.type === 'image' || node.imageFill?.assetId
      || (Array.isArray(node.fills) && node.fills.some(fill => fill?.type === 'image' && fill.visible !== false && (fill.opacity ?? 1) > 0))) return true;
    return Array.isArray(node.children) && node.children.some(containsImageContent);
  };
  const hasImages = Array.isArray(page?.children) && page.children.some(containsImageContent);
  return hasLayers
    ? {
      title: 'No layer selected',
      description: hasImages
        ? 'Select a photo or the shape containing it on the canvas or in Layers. Choose Crop image or Reposition photo in the canvas action bar.'
        : 'Select a layer on the canvas or in Layers to see and edit its properties.',
      showStartActions: false
    }
    : {
      title: 'Start designing',
      description: 'Select an item to edit its settings. To start, add an image, draw a frame, or add text.',
      showStartActions: true
    };
}
