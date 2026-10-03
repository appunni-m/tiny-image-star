const DEFAULT_LIMITS = Object.freeze({
  maxPages: 100,
  maxPageDimension: 14_400,
  maxPagePixels: 100_000_000,
  maxAggregateJpegBytes: 512 * 1024 * 1024,
});

const encoder = new TextEncoder();

function asByteView(value, index) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`Page ${index + 1} JPEG must be a Uint8Array or ArrayBuffer`);
}

function validateJpeg(bytes, index) {
  if (bytes.byteLength < 4
    || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.byteLength - 2] !== 0xff || bytes[bytes.byteLength - 1] !== 0xd9) {
    throw new TypeError(`Page ${index + 1} must contain a complete JPEG stream`);
  }
}

function validatePages(pages, maxAggregateJpegBytes) {
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > DEFAULT_LIMITS.maxPages) {
    throw new RangeError(`PDF must contain between 1 and ${DEFAULT_LIMITS.maxPages} pages`);
  }

  let aggregateBytes = 0;
  return pages.map((page, index) => {
    if (!page || typeof page !== 'object') throw new TypeError(`Page ${index + 1} must be an object`);
    const { width, height } = page;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`Page ${index + 1} dimensions must be positive safe integers`);
    }
    if (width > DEFAULT_LIMITS.maxPageDimension || height > DEFAULT_LIMITS.maxPageDimension
      || width * height > DEFAULT_LIMITS.maxPagePixels) {
      throw new RangeError(`Page ${index + 1} exceeds the supported PDF page dimensions`);
    }
    const jpeg = asByteView(page.jpeg, index);
    validateJpeg(jpeg, index);
    aggregateBytes += jpeg.byteLength;
    if (aggregateBytes > maxAggregateJpegBytes) {
      throw new RangeError(`JPEG payloads exceed ${maxAggregateJpegBytes} bytes`);
    }
    const pdfWidth = page.pdfWidth ?? width;
    const pdfHeight = page.pdfHeight ?? height;
    if (![pdfWidth, pdfHeight].every(value => Number.isFinite(value) && value > 0 && value <= DEFAULT_LIMITS.maxPageDimension)) {
      throw new RangeError(`Page ${index + 1} PDF dimensions must be positive finite values within the supported limit`);
    }
    const imageRect = page.imageRect || { x: 0, y: 0, width: pdfWidth, height: pdfHeight };
    if (!imageRect || ![imageRect.x, imageRect.y, imageRect.width, imageRect.height].every(Number.isFinite)
      || imageRect.x < 0 || imageRect.y < 0 || imageRect.width <= 0 || imageRect.height <= 0
      || imageRect.x + imageRect.width > pdfWidth + 1e-7 || imageRect.y + imageRect.height > pdfHeight + 1e-7) {
      throw new RangeError(`Page ${index + 1} image placement must fit inside its PDF page`);
    }
    return { width, height, pdfWidth, pdfHeight, imageRect, jpeg };
  });
}

/**
 * Package rendered RGB JPEG pages into a PDF. Pixel dimensions map directly
 * to PDF points by default; `pdfWidth`/`pdfHeight` and `imageRect` allow a
 * raster image to be fitted onto a correctly sized physical sheet. Input byte
 * views are consumed as-is; the returned Uint8Array owns the final PDF bytes.
 */
export function createMultipagePdf(inputPages, options = {}) {
  const maxAggregateJpegBytes = options.maxAggregateJpegBytes ?? DEFAULT_LIMITS.maxAggregateJpegBytes;
  if (!Number.isSafeInteger(maxAggregateJpegBytes) || maxAggregateJpegBytes <= 0
    || maxAggregateJpegBytes > DEFAULT_LIMITS.maxAggregateJpegBytes) {
    throw new RangeError(`maxAggregateJpegBytes must be between 1 and ${DEFAULT_LIMITS.maxAggregateJpegBytes}`);
  }
  const pages = validatePages(inputPages, maxAggregateJpegBytes);
  const objectCount = 2 + pages.length * 3;
  const parts = [];
  const offsets = new Array(objectCount + 1).fill(0);
  let length = 0;

  const push = (part) => {
    parts.push(part);
    length += part.byteLength;
  };
  const ascii = (text) => encoder.encode(text);
  const object = (id, bodyParts) => {
    offsets[id] = length;
    push(ascii(`${id} 0 obj\n`));
    for (const part of bodyParts) push(typeof part === 'string' ? ascii(part) : part);
    push(ascii('\nendobj\n'));
  };

  push(ascii('%PDF-1.4\n%'));
  push(Uint8Array.of(0xe2, 0xe3, 0xcf, 0xd3));
  push(ascii('\n'));
  object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ');
  object(2, [`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`]);

  pages.forEach(({ width, height, pdfWidth, pdfHeight, imageRect, jpeg }, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const resourceName = `Im${index + 1}`;
    const content = ascii(`q\n${imageRect.width} 0 0 ${imageRect.height} ${imageRect.x} ${imageRect.y} cm\n/${resourceName} Do\nQ\n`);

    object(pageId, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfWidth} ${pdfHeight}] `
        + `/Resources << /XObject << /${resourceName} ${imageId} 0 R >> >> `
        + `/Contents ${contentId} 0 R >>`,
    ]);
    object(imageId, [
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode `
        + `/Length ${jpeg.byteLength} >>\nstream\n`,
      jpeg,
      '\nendstream',
    ]);
    object(contentId, [
      `<< /Length ${content.byteLength} >>\nstream\n`,
      content,
      'endstream',
    ]);
  });

  const xrefOffset = length;
  push(ascii(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`));
  for (let id = 1; id <= objectCount; id += 1) {
    if (offsets[id] > 9_999_999_999) throw new RangeError('PDF exceeds the supported cross-reference offset range');
    push(ascii(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`));
  }
  push(ascii(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));

  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export const PDF_PACKAGER_LIMITS = DEFAULT_LIMITS;
