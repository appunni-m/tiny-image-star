const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function replaceImage(current, next) {
  if (next !== current) current.free();
  return next;
}

export function decodeOriginal(api, bytes, { maxPixels = 80_000_000 } = {}) {
  let image;
  try {
    image = api.Image.open(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > maxPixels) throw new RangeError('This image is too large to edit in this browser.');
    image.load();
    return image;
  } catch (error) {
    image?.free?.();
    throw error;
  }
}

export function renderImage(source, adjustments = {}) {
  let image = source.copy();
  const brightness = clamp(adjustments.brightness, -100, 100);
  const contrast = clamp(adjustments.contrast, -100, 100);
  const saturation = clamp(adjustments.saturation, -100, 100);
  const blur = clamp(adjustments.blur, 0, 24);
  try {
    if (brightness) image = replaceImage(image, image.enhanceBrightness(1 + brightness / 100));
    if (contrast) image = replaceImage(image, image.enhanceContrast(1 + contrast / 100));
    if (saturation) image = replaceImage(image, image.enhanceColor(1 + saturation / 100));
    if (blur) image = replaceImage(image, image.gaussianBlur(blur));
    const output = image.saveWithInput('PNG', null);
    return { bytes: new Uint8Array(output), width: image.width, height: image.height };
  } finally { image.free(); }
}
