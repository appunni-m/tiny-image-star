import { MAX_STORED_ZIP_BYTES, MAX_STORED_ZIP_ENTRIES } from './store-zip.js';

const outputExtensions = Object.freeze({ png: 'png', jpeg: 'jpg', webp: 'webp' });

function safeBaseName(value) {
  return String(value || 'Image').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim() || 'Image';
}

/** Resolve each selected image's persisted raster format and make portable unique filenames. */
export function planImageArchive(images) {
  if (!Array.isArray(images) || images.length < 2) throw new TypeError('Choose at least two images for a batch export.');
  if (images.length > MAX_STORED_ZIP_ENTRIES) throw new RangeError(`An image archive can contain at most ${MAX_STORED_ZIP_ENTRIES.toLocaleString()} images.`);
  const ids = new Set();
  const filenames = new Set();
  return images.map((node, index) => {
    if (!node || node.type !== 'image' || typeof node.id !== 'string' || !node.id) {
      throw new TypeError(`Selected layer ${index + 1} is not a valid image layer.`);
    }
    if (ids.has(node.id)) throw new TypeError('The selected image list contains a duplicate layer.');
    ids.add(node.id);
    const format = node.outputFormat ?? 'png';
    if (!Object.hasOwn(outputExtensions, format)) throw new TypeError(`Image “${node.name || node.id}” has an unsupported output format.`);
    const quality = node.outputQuality ?? 90;
    if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new TypeError(`Image “${node.name || node.id}” has invalid output quality.`);
    const baseName = safeBaseName(node.name || 'Image');
    const extension = outputExtensions[format];
    let filename = `${baseName}.${extension}`.normalize('NFC');
    let duplicateIndex = 2;
    while (filenames.has(filename.toLocaleLowerCase('en-US'))) filename = `${baseName}-${duplicateIndex++}.${extension}`.normalize('NFC');
    filenames.add(filename.toLocaleLowerCase('en-US'));
    return { id: node.id, format, quality, filename };
  });
}

/** Check exact ZIP32 output size from metadata only; no Blob bytes are read. */
export function assertImageArchiveFits(plan, totalOutputBytes, maxArchiveBytes = MAX_STORED_ZIP_BYTES) {
  if (!Array.isArray(plan) || plan.length === 0) throw new TypeError('An image archive needs at least one planned image.');
  if (plan.length > MAX_STORED_ZIP_ENTRIES || plan.length > 0xffff) {
    throw new RangeError(`An image archive can contain at most ${MAX_STORED_ZIP_ENTRIES.toLocaleString()} images.`);
  }
  if (!Number.isSafeInteger(totalOutputBytes) || totalOutputBytes < 0) throw new TypeError('The accumulated image output size is invalid.');
  if (!Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes < 22) throw new RangeError('The image archive byte limit is invalid.');
  const headerBytes = 22 + plan.reduce((sum, item) => {
    if (typeof item?.filename !== 'string' || !item.filename) throw new TypeError('Each planned image needs a filename.');
    const filenameBytes = new TextEncoder().encode(item.filename.normalize('NFC')).byteLength;
    if (filenameBytes > 0xffff) throw new RangeError(`Image filename “${item.filename}” is too long for a ZIP archive.`);
    return sum + 76 + filenameBytes * 2;
  }, 0);
  const archiveBytes = headerBytes + totalOutputBytes;
  if (!Number.isSafeInteger(archiveBytes) || archiveBytes > 0xffff_ffff || archiveBytes > maxArchiveBytes) {
    throw new RangeError(`This image archive would exceed the ${Math.floor(maxArchiveBytes / (1024 * 1024))} MiB local limit. Export fewer images or use smaller source images, then retry.`);
  }
  return { headerBytes, outputBytes: totalOutputBytes, archiveBytes };
}
