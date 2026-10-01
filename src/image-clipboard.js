const imageTypeExtensions = new Map([
  ['image/avif', 'avif'],
  ['image/bmp', 'bmp'],
  ['image/gif', 'gif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/tiff', 'tiff'],
  ['image/webp', 'webp'],
]);

export function clipboardImageFilename(type, index = 1) {
  const extension = imageTypeExtensions.get(String(type || '').toLowerCase()) || 'png';
  const sequence = Number.isInteger(index) && index > 0 ? index : 1;
  return `pasted-image-${sequence}.${extension}`;
}

function clipboardImageFile(file) {
  return file && typeof file.type === 'string' && file.type.toLowerCase().startsWith('image/')
    ? file
    : null;
}

export function getClipboardImageFiles(clipboardData) {
  if (!clipboardData) return [];
  const files = [];
  const seen = new Set();
  const append = file => {
    const image = clipboardImageFile(file);
    if (!image || seen.has(image)) return;
    seen.add(image);
    files.push(image);
  };

  for (const item of Array.from(clipboardData.items || [])) {
    if (item?.kind !== 'file' || typeof item.getAsFile !== 'function') continue;
    try { append(item.getAsFile()); } catch { /* A stale or protected clipboard item is skipped. */ }
  }
  if (!files.length) {
    for (const file of Array.from(clipboardData.files || [])) append(file);
  }
  return files;
}

/** Route a paste event without swallowing text entry or browser-native text paste. */
export function routeClipboardPaste(event, {
  canEdit = true,
  isEditingText = false,
  hasLayerClipboard = false,
  importImages = () => {},
  pasteLayers = () => {},
} = {}) {
  if (!canEdit || isEditingText) return 'ignored';
  const images = getClipboardImageFiles(event?.clipboardData);
  if (images.length) {
    event.preventDefault();
    importImages(images);
    return 'images';
  }
  if (!hasLayerClipboard) return 'unhandled';
  event.preventDefault();
  pasteLayers();
  return 'layers';
}
