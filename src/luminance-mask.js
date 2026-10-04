// SVG's luminance-to-alpha matrix coefficients for sRGB mask content.
export const SVG_LUMINANCE_COEFFICIENTS = Object.freeze({ red: 0.2125, green: 0.7154, blue: 0.0721 });

function linearizeSrgb(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Convert an RGBA pixel buffer to white pixels whose alpha is luminance × source alpha. */
export function applyLuminanceMaskAlpha(imageData, { colorSpace = 'srgb' } = {}) {
  const data = imageData?.data;
  if (!data || typeof data.length !== 'number' || data.length % 4 !== 0
    || !ArrayBuffer.isView(data) || !['srgb', 'linearRGB'].includes(colorSpace)) {
    throw new TypeError('A luminance mask requires RGBA ImageData and a supported color space.');
  }
  for (let index = 0; index < data.length; index += 4) {
    const red = colorSpace === 'linearRGB' ? linearizeSrgb(data[index]) : data[index] / 255;
    const green = colorSpace === 'linearRGB' ? linearizeSrgb(data[index + 1]) : data[index + 1] / 255;
    const blue = colorSpace === 'linearRGB' ? linearizeSrgb(data[index + 2]) : data[index + 2] / 255;
    const alpha = data[index + 3] / 255;
    const luminance = red * SVG_LUMINANCE_COEFFICIENTS.red
      + green * SVG_LUMINANCE_COEFFICIENTS.green
      + blue * SVG_LUMINANCE_COEFFICIENTS.blue;
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = Math.round(255 * alpha * luminance);
  }
  return imageData;
}
