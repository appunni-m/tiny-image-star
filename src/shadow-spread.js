function morphAtRadius(alpha, width, height, radius, operation) {
  if (radius === 0) return Uint8Array.from(alpha);
  const horizontal = new Uint8Array(alpha.length);
  const result = new Uint8Array(alpha.length);
  const deque = new Uint32Array(Math.max(width, height));
  const isDilation = operation === 'dilate';
  const shouldPop = (previous, current) => isDilation ? previous <= current : previous >= current;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let head = 0;
    let tail = 0;
    let next = 0;
    for (let x = 0; x < width; x += 1) {
      const right = Math.min(width - 1, x + radius);
      while (next <= right) {
        const value = alpha[row + next];
        while (tail > head && shouldPop(alpha[row + deque[tail - 1]], value)) tail -= 1;
        deque[tail] = next;
        tail += 1;
        next += 1;
      }
      const left = x - radius;
      while (tail > head && deque[head] < left) head += 1;
      horizontal[row + x] = !isDilation && (left < 0 || x + radius >= width)
        ? 0
        : tail > head ? alpha[row + deque[head]] : 0;
    }
  }

  for (let x = 0; x < width; x += 1) {
    let head = 0;
    let tail = 0;
    let next = 0;
    for (let y = 0; y < height; y += 1) {
      const bottom = Math.min(height - 1, y + radius);
      while (next <= bottom) {
        const value = horizontal[next * width + x];
        while (tail > head && shouldPop(horizontal[deque[tail - 1] * width + x], value)) tail -= 1;
        deque[tail] = next;
        tail += 1;
        next += 1;
      }
      const top = y - radius;
      while (tail > head && deque[head] < top) head += 1;
      result[y * width + x] = !isDilation && (top < 0 || y + radius >= height)
        ? 0
        : tail > head ? horizontal[deque[head] * width + x] : 0;
    }
  }
  return result;
}

/** Apply bounded, grayscale square morphology to a canvas alpha channel. */
export function morphShadowAlpha(alpha, width, height, spread) {
  if (!(alpha instanceof Uint8Array || alpha instanceof Uint8ClampedArray)
    || !Number.isSafeInteger(width) || width < 1
    || !Number.isSafeInteger(height) || height < 1
    || alpha.length !== width * height
    || !Number.isFinite(spread)) {
    throw new TypeError('Shadow spread needs a valid alpha channel, dimensions, and finite spread.');
  }
  if (spread === 0) return Uint8Array.from(alpha);
  const operation = spread > 0 ? 'dilate' : 'erode';
  const radius = Math.min(Math.max(width, height), Math.abs(spread));
  const lowerRadius = Math.floor(radius);
  const upperRadius = Math.ceil(radius);
  const lower = morphAtRadius(alpha, width, height, lowerRadius, operation);
  if (upperRadius === lowerRadius) return lower;
  const upper = morphAtRadius(alpha, width, height, upperRadius, operation);
  const fractionalRadius = radius - lowerRadius;
  for (let index = 0; index < lower.length; index += 1) {
    lower[index] = Math.round(lower[index] * (1 - fractionalRadius) + upper[index] * fractionalRadius);
  }
  return lower;
}
