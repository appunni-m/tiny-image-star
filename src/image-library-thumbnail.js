export const IMAGE_LIBRARY_THUMBNAIL_EDGE = 128;
export const MAX_IMAGE_LIBRARY_THUMBNAIL_BYTES = 48 * 1024;

/** Encode a predictable-size, local JPEG preview without modifying the source. */
export async function createImageLibraryThumbnailBlob(bitmap, { documentObject = globalThis.document } = {}) {
  if (!bitmap || !Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width < 1 || bitmap.height < 1) {
    throw new TypeError('A decoded image is required to create a thumbnail.');
  }
  if (!documentObject || typeof documentObject.createElement !== 'function') {
    throw new TypeError('A document canvas is required to create a thumbnail.');
  }
  const edge = IMAGE_LIBRARY_THUMBNAIL_EDGE;
  const inset = 6;
  const scale = Math.min(1, (edge - inset * 2) / bitmap.width, (edge - inset * 2) / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = documentObject.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot create image thumbnails.');
    context.fillStyle = '#f1f3f5';
    context.fillRect(0, 0, edge, edge);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (edge - width) / 2, (edge - height) / 2, width, height);
    if (typeof canvas.toBlob !== 'function') throw new Error('This browser cannot encode image thumbnails.');
    const encode = quality => new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the image thumbnail.')), 'image/jpeg', quality);
    });
    let blob = await encode(.78);
    if (blob.size > MAX_IMAGE_LIBRARY_THUMBNAIL_BYTES) blob = await encode(.52);
    if (blob.size > MAX_IMAGE_LIBRARY_THUMBNAIL_BYTES) throw new Error('The thumbnail is larger than the local catalog limit.');
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
