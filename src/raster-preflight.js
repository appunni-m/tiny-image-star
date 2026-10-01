const MAX_METADATA_SCAN_BYTES = 1024 * 1024;
const MAX_WEBP_CHUNK_HEADERS = 4096;
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function asDataView(source) {
  if (source instanceof DataView) return source;
  if (source instanceof ArrayBuffer) return new DataView(source);
  if (ArrayBuffer.isView(source)) return new DataView(source.buffer, source.byteOffset, source.byteLength);
  return null;
}

function ascii(view, offset, value) {
  if (!view || offset < 0 || offset + value.length > view.byteLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (view.getUint8(offset + index) !== value.charCodeAt(index)) return false;
  }
  return true;
}

function safeDimensions(width, height) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) return null;
  const pixels = width * height;
  return Number.isSafeInteger(pixels) ? { width, height, pixels } : null;
}

function readTiffOrientation(view, payloadStart, payloadLength, { exifPrefix = false, invalidOrientation = 1 } = {}) {
  const payloadEnd = payloadStart + Math.min(payloadLength, MAX_METADATA_SCAN_BYTES);
  const start = exifPrefix && ascii(view, payloadStart, 'Exif\0\0') ? payloadStart + 6 : payloadStart;
  const end = payloadEnd;
  if (start + 8 > end) return invalidOrientation;
  const littleEndian = ascii(view, start, 'II');
  if (!littleEndian && !ascii(view, start, 'MM')) return invalidOrientation;
  const u16 = offset => offset >= start && offset + 2 <= end ? view.getUint16(offset, littleEndian) : null;
  const u32 = offset => offset >= start && offset + 4 <= end ? view.getUint32(offset, littleEndian) : null;
  if (u16(start + 2) !== 42) return invalidOrientation;
  const ifdOffset = u32(start + 4);
  if (ifdOffset === null || ifdOffset > end - start - 2) return invalidOrientation;
  const ifd = start + ifdOffset;
  const entryCount = u16(ifd);
  if (entryCount === null || entryCount > 4096 || ifd + 2 + entryCount * 12 > end) return invalidOrientation;
  for (let index = 0; index < entryCount; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (u16(entry) !== 0x0112) continue;
    if (u16(entry + 2) !== 3 || u32(entry + 4) !== 1) return invalidOrientation;
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : invalidOrientation;
  }
  return 1;
}

function exifOrientation(view, payloadStart, payloadLength) {
  if (payloadLength < 14 || !ascii(view, payloadStart, 'Exif\0\0')) return 1;
  return readTiffOrientation(view, payloadStart, payloadLength, { exifPrefix: true });
}

/** Read a WebP EXIF chunk by walking bounded RIFF chunk headers and skipping image payloads. */
export function inspectWebpExifOrientation(source) {
  const view = asDataView(source);
  if (!view || view.byteLength < 12 || !ascii(view, 0, 'RIFF') || !ascii(view, 8, 'WEBP')) {
    return { orientation: 1, pending: false };
  }
  const riffEnd = view.getUint32(4, true) + 8;
  if (!Number.isSafeInteger(riffEnd) || riffEnd < 12) return { orientation: 1, pending: false };
  const availableEnd = Math.min(view.byteLength, riffEnd);
  let offset = 12;
  let exifAdvertised = false;
  let scannedHeaders = 0;
  while (offset + 8 <= availableEnd && scannedHeaders < MAX_WEBP_CHUNK_HEADERS) {
    const chunkType = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
    );
    const chunkSize = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const chunkEnd = dataStart + chunkSize + (chunkSize & 1);
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > riffEnd) return { orientation: exifAdvertised ? null : 1, pending: false };

    if (chunkType === 'VP8X' && chunkSize >= 1 && dataStart + 1 <= availableEnd) {
      // VP8X feature flags set bit 3 when an EXIF chunk is present.
      exifAdvertised ||= Boolean(view.getUint8(dataStart) & 0x08);
    }
    if (chunkType === 'EXIF') {
      if (dataStart + chunkSize > view.byteLength) return { orientation: null, pending: riffEnd > view.byteLength };
      return {
        orientation: readTiffOrientation(view, dataStart, chunkSize, { exifPrefix: true, invalidOrientation: null }),
        pending: false,
      };
    }
    if (chunkEnd > view.byteLength) return { orientation: exifAdvertised ? null : 1, pending: riffEnd > view.byteLength };
    offset = chunkEnd;
    scannedHeaders += 1;
  }

  if (offset < riffEnd && scannedHeaders >= MAX_WEBP_CHUNK_HEADERS) {
    return { orientation: exifAdvertised ? null : 1, pending: false };
  }
  if (riffEnd > view.byteLength) return { orientation: exifAdvertised ? null : 1, pending: true };
  return { orientation: exifAdvertised ? null : 1, pending: false };
}

/**
 * Read bounded JPEG frame dimensions and the TIFF orientation tag in EXIF.
 * The dimensions are returned in display orientation; JPEG bytes themselves
 * stay untouched so callers can retain and re-open the original source.
 */
export function inspectJpegMetadata(source) {
  const view = asDataView(source);
  if (!view || view.byteLength < 4 || view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) return null;
  let offset = 2;
  let orientation = 1;
  let foundFrame = null;
  const limit = Math.min(view.byteLength, MAX_METADATA_SCAN_BYTES);
  while (offset + 4 <= limit) {
    if (view.getUint8(offset) !== 0xff) return null;
    while (offset < limit && view.getUint8(offset) === 0xff) offset += 1;
    if (offset >= limit) return null;
    const marker = view.getUint8(offset++);
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > limit) return null;
    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > limit) return null;
    if (marker === 0xe1 && segmentLength >= 8) {
      const nextOrientation = exifOrientation(view, offset + 2, segmentLength - 2);
      if (nextOrientation !== 1) orientation = nextOrientation;
    }
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return null;
      foundFrame ||= { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
    }
    offset += segmentLength;
  }
  if (!foundFrame) return null;
  const swapsAxes = orientation >= 5;
  const dimensions = safeDimensions(swapsAxes ? foundFrame.height : foundFrame.width, swapsAxes ? foundFrame.width : foundFrame.height);
  return dimensions ? { ...dimensions, orientation } : null;
}

/** Return a valid EXIF orientation for a JPEG, or 1 when none is present. */
export function jpegExifOrientation(source) {
  return inspectJpegMetadata(source)?.orientation ?? 1;
}

/** Read dimensions from a classic TIFF header without decoding pixel data. */
function inspectTiffMetadata(source) {
  const view = asDataView(source);
  if (!view || view.byteLength < 8) return null;
  const littleEndian = ascii(view, 0, 'II');
  if (!littleEndian && !ascii(view, 0, 'MM')) return null;
  const u16 = offset => offset >= 0 && offset + 2 <= view.byteLength ? view.getUint16(offset, littleEndian) : null;
  const u32 = offset => offset >= 0 && offset + 4 <= view.byteLength ? view.getUint32(offset, littleEndian) : null;
  if (u16(2) !== 42) return null;
  const ifdOffset = u32(4);
  if (ifdOffset === null || ifdOffset > view.byteLength - 2) return null;
  const ifd = ifdOffset;
  const count = u16(ifd);
  if (count === null || count > 4096 || ifd + 2 + count * 12 + 4 > view.byteLength) return null;
  let width = null;
  let height = null;
  let orientation = 1;
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const valueCount = u32(entry + 4);
    if (tag === 274) {
      if (type === 3 && valueCount === 1) {
        const value = u16(entry + 8);
        if (value >= 1 && value <= 8) orientation = value;
      }
      continue;
    }
    if (tag !== 256 && tag !== 257) continue;
    if (valueCount !== 1 || (type !== 3 && type !== 4)) return null;
    const value = type === 3 ? u16(entry + 8) : u32(entry + 8);
    if (value === null || value < 1) return null;
    if (tag === 256) width = value;
    else height = value;
  }
  if (!width || !height) return null;
  const swapsAxes = orientation >= 5;
  const dimensions = safeDimensions(swapsAxes ? height : width, swapsAxes ? width : height);
  return dimensions ? { ...dimensions, orientation } : null;
}

export function inspectTiffDimensions(source) {
  const metadata = inspectTiffMetadata(source);
  if (!metadata) return null;
  const { orientation, ...dimensions } = metadata;
  return dimensions;
}

/** Return a valid classic-TIFF orientation, or 1 when no supported tag exists. */
export function tiffOrientation(source) {
  return inspectTiffMetadata(source)?.orientation ?? 1;
}

/** Read EXIF/TIFF orientation from a supported local raster container. */
export function rasterOrientation(source) {
  const format = identifyRasterContainer(source);
  if (format === 'tiff') return tiffOrientation(source);
  if (format === 'jpeg') return jpegExifOrientation(source);
  if (format === 'webp') return inspectWebpExifOrientation(source).orientation;
  return 1;
}

/** Identify container signatures used to explain unsupported local codecs. */
export function identifyRasterContainer(source) {
  const view = asDataView(source);
  if (!view || view.byteLength < 2) return 'unknown';
  if (view.getUint8(0) === 0xff && view.getUint8(1) === 0xd8) return 'jpeg';
  if (view.getUint8(0) === 0x89 && ascii(view, 1, 'PNG\r\n\u001a\n')) return 'png';
  if (ascii(view, 0, 'GIF87a') || ascii(view, 0, 'GIF89a')) return 'gif';
  if (ascii(view, 0, 'BM')) return 'bmp';
  if (ascii(view, 0, 'II') || ascii(view, 0, 'MM')) return 'tiff';
  if (ascii(view, 0, 'RIFF') && ascii(view, 8, 'WEBP')) return 'webp';
  if (view.getUint8(0) === 0x50 && '123456'.includes(String.fromCharCode(view.getUint8(1)))) return 'pnm';
  if (view.byteLength >= 16 && ascii(view, 4, 'ftyp')) {
    const boxLength = view.getUint32(0);
    const end = Math.min(view.byteLength, boxLength >= 16 ? boxLength : view.byteLength, MAX_METADATA_SCAN_BYTES);
    const brands = [];
    for (let offset = 8; offset + 4 <= end; offset += 4) {
      const brand = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
      brands.push(brand);
    }
    if (brands.some(brand => brand === 'avif' || brand === 'avis')) return 'avif';
    if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx', 'heif', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand))) return 'heif';
  }
  return 'unknown';
}
