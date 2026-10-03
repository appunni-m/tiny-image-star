const POINTS_PER_INCH = 72;
const MILLIMETERS_PER_INCH = 25.4;

export const PDF_PAGE_PRESETS = Object.freeze({
  a4: Object.freeze({ name: 'A4', widthMm: 210, heightMm: 297 }),
  a3: Object.freeze({ name: 'A3', widthMm: 297, heightMm: 420 }),
  letter: Object.freeze({ name: 'US Letter', widthMm: 215.9, heightMm: 279.4 }),
  legal: Object.freeze({ name: 'US Legal', widthMm: 215.9, heightMm: 355.6 }),
});

const MAX_RASTER_PIXELS = 16_000_000;
const MAX_RASTER_AXIS = 16_384;

/** Resolve a standard/custom sheet to a PDF MediaBox and a bounded raster size. */
export function planPdfPage({
  preset = 'a4',
  orientation = 'portrait',
  widthMm,
  heightMm,
  dpi = 144,
  marginMm = 12,
} = {}) {
  if (orientation !== 'portrait' && orientation !== 'landscape') throw new TypeError('Choose portrait or landscape orientation.');
  if (!Number.isSafeInteger(dpi) || dpi < 72 || dpi > 300) throw new RangeError('PDF raster resolution must be between 72 and 300 DPI.');
  if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > 50) throw new RangeError('PDF margins must be between 0 and 50 mm.');

  let pageWidthMm;
  let pageHeightMm;
  let label;
  if (preset === 'custom') {
    pageWidthMm = Number(widthMm);
    pageHeightMm = Number(heightMm);
    label = 'Custom';
  } else {
    const paper = PDF_PAGE_PRESETS[preset];
    if (!paper) throw new TypeError('Choose a supported PDF paper size.');
    pageWidthMm = paper.widthMm;
    pageHeightMm = paper.heightMm;
    label = paper.name;
  }
  if (![pageWidthMm, pageHeightMm].every(value => Number.isFinite(value) && value >= 25 && value <= 2000)) {
    throw new RangeError('PDF page dimensions must be between 25 and 2,000 mm.');
  }
  if (marginMm * 2 >= Math.min(pageWidthMm, pageHeightMm)) {
    throw new RangeError('PDF margins must be smaller than half of the shorter page edge.');
  }
  if ((orientation === 'landscape' && pageWidthMm < pageHeightMm)
    || (orientation === 'portrait' && pageWidthMm > pageHeightMm)) {
    [pageWidthMm, pageHeightMm] = [pageHeightMm, pageWidthMm];
  }

  const pixelsPerMm = dpi / MILLIMETERS_PER_INCH;
  const pixelWidth = Math.round(pageWidthMm * pixelsPerMm);
  const pixelHeight = Math.round(pageHeightMm * pixelsPerMm);
  if (pixelWidth > MAX_RASTER_AXIS || pixelHeight > MAX_RASTER_AXIS
    || pixelWidth * pixelHeight > MAX_RASTER_PIXELS) {
    throw new RangeError(`This PDF page is too large to rasterize safely at ${dpi} DPI. Choose smaller dimensions.`);
  }
  return Object.freeze({
    label,
    orientation,
    widthMm: pageWidthMm,
    heightMm: pageHeightMm,
    widthPt: pageWidthMm / MILLIMETERS_PER_INCH * POINTS_PER_INCH,
    heightPt: pageHeightMm / MILLIMETERS_PER_INCH * POINTS_PER_INCH,
    widthPx: pixelWidth,
    heightPx: pixelHeight,
    marginPx: Math.round(marginMm * pixelsPerMm),
    dpi,
  });
}

/** Fit the complete page artwork inside the paper margins without cropping. */
export function fitPdfContent(sourceWidth, sourceHeight, page) {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError('PDF artwork dimensions must be positive and finite.');
  }
  if (!page || !Number.isSafeInteger(page.widthPx) || !Number.isSafeInteger(page.heightPx)
    || !Number.isSafeInteger(page.marginPx) || page.widthPx <= 0 || page.heightPx <= 0 || page.marginPx < 0) {
    throw new TypeError('A valid PDF page plan is required.');
  }
  const availableWidth = page.widthPx - page.marginPx * 2;
  const availableHeight = page.heightPx - page.marginPx * 2;
  if (availableWidth <= 0 || availableHeight <= 0) throw new RangeError('PDF margins leave no room for artwork.');
  const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return Object.freeze({
    x: (page.widthPx - width) / 2,
    y: (page.heightPx - height) / 2,
    width,
    height,
    scale,
  });
}

/** Scale export source pixels into a bounded renderer scale for the chosen sheet. */
export function pdfContentRenderScale(bounds, { maxPixels = MAX_RASTER_PIXELS, preferredScale = 1.5 } = {}) {
  const width = Number(bounds?.width);
  const height = Number(bounds?.height);
  const area = width * height;
  if (![width, height].every(value => Number.isFinite(value) && value > 0)
    || !Number.isFinite(area)
    || !Number.isSafeInteger(maxPixels) || maxPixels <= 0
    || !Number.isFinite(preferredScale) || preferredScale <= 0) {
    throw new TypeError('A valid page bound and positive render budget are required.');
  }
  const areaScale = Math.sqrt(maxPixels / area);
  const axisScale = MAX_RASTER_AXIS / Math.max(width, height);
  return Math.min(preferredScale, areaScale, axisScale);
}

export const PDF_PAGE_LAYOUT_LIMITS = Object.freeze({
  maxRasterAxis: MAX_RASTER_AXIS,
  maxRasterPixels: MAX_RASTER_PIXELS,
  pointsPerInch: POINTS_PER_INCH,
  millimetersPerInch: MILLIMETERS_PER_INCH,
});
