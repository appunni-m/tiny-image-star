const clampAdjustment = value => Math.max(-100, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));

function replaceImage(current, next) {
  if (next !== current) current.free();
  return next;
}

export function openSourceImage(api, encodedBytes, { maxPixels = 50_000_000 } = {}) {
  let image;
  try {
    image = api.Image.open(encodedBytes instanceof Uint8Array ? encodedBytes : new Uint8Array(encodedBytes));
    if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > maxPixels) {
      throw new RangeError('This image is too large to edit in this browser.');
    }
    image.load();
    return image;
  } catch (error) {
    image?.free?.();
    throw error;
  }
}

export function renderAdjustedImage(source, adjustments = {}) {
  let image = source.copy();
  const brightness = clampAdjustment(adjustments.brightness);
  const contrast = clampAdjustment(adjustments.contrast);
  const saturation = clampAdjustment(adjustments.saturation);
  const blur = Math.max(0, Math.min(20, Number(adjustments.blur) || 0));
  try {
    if (brightness) image = replaceImage(image, image.enhanceBrightness(1 + brightness / 100));
    if (contrast) image = replaceImage(image, image.enhanceContrast(1 + contrast / 100));
    if (saturation) image = replaceImage(image, image.enhanceColor(1 + saturation / 100));
    if (blur) image = replaceImage(image, image.gaussianBlur(blur));
    const bytes = image.saveWithInput('PNG', null);
    return { bytes: new Uint8Array(bytes), width: image.width, height: image.height };
  } finally {
    image.free();
  }
}
