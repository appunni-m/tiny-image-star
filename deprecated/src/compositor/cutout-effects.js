import { cutoutEffectMetrics } from "./cutout-effects-spec.js";

// Exact maximum over a discrete circular neighborhood. Group disk rows with
// the same horizontal radius, then reuse a linear sliding-window maximum.
// This preserves soft coverage without thresholding hair or translucent pixels.
export function dilateDisk(alpha, width, height, radius) {
  if (!(alpha instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || alpha.length !== width * height || !Number.isInteger(radius) || radius < 0) throw new Error("Invalid outline mask.");
  if (!radius) return alpha.slice();
  const groups = new Map();
  for (let dy = -radius; dy <= radius; dy++) {
    const rx = Math.floor(Math.sqrt(radius * radius - dy * dy));
    if (!groups.has(rx)) groups.set(rx, []); groups.get(rx).push(dy);
  }
  const output = new Uint8Array(alpha.length), row = new Uint8Array(width), queue = new Int32Array(width);
  for (const [rx, offsets] of groups) for (let y = 0; y < height; y++) {
    const start = y * width; let head = 0, tail = 0, next = 0;
    for (let x = 0; x < width; x++) {
      const right = Math.min(width - 1, x + rx);
      while (next <= right) {
        while (tail > head && alpha[start + queue[tail - 1]] <= alpha[start + next]) tail--;
        queue[tail++] = next++;
      }
      while (head < tail && queue[head] < x - rx) head++;
      row[x] = alpha[start + queue[head]];
    }
    for (const dy of offsets) {
      const targetY = y + dy; if (targetY < 0 || targetY >= height) continue;
      const target = targetY * width;
      for (let x = 0; x < width; x++) if (row[x] > output[target + x]) output[target + x] = row[x];
    }
  }
  return output;
}

const rgb = (color) => [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));

/** An RGBA decoration behind the foreground; dimensions include the halo. */
export function renderCutoutDecoration(api, foreground, node, canonicalHeight) {
  const { outline, shadow, blur, x, y } = cutoutEffectMetrics(node, canonicalHeight), width = foreground.width, height = foreground.height;
  let channel, expanded, blurred;
  try {
    channel = foreground.getchannel(3);
    const alpha = channel.toBytes(), border = outline ? dilateDisk(alpha, width, height, outline) : alpha;
    if (shadow) {
      expanded = api.fromBytesFn("L", width, height, border, "raw");
      blurred = blur ? expanded.gaussianBlur(blur) : expanded;
    }
    const shade = blurred?.toBytes(), output = new Uint8Array(width * height * 4);
    const borderColor = outline ? rgb(node.cutoutEffects.outline.color) : [0, 0, 0], shadowColor = shadow ? rgb(shadow.color) : [0, 0, 0];
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
      const index = py * width + px, sx = px - x, sy = py - y;
      const a = outline ? border[index] / 255 : 0;
      const b = shadow && sx >= 0 && sy >= 0 && sx < width && sy < height ? shade[sy * width + sx] / 255 * shadow.opacity * (1 - a) : 0;
      const opacity = a + b;
      for (let c = 0; c < 3; c++) output[index * 4 + c] = opacity ? Math.round((borderColor[c] * a + shadowColor[c] * b) / opacity) : 0;
      output[index * 4 + 3] = Math.round(opacity * 255);
    }
    return api.fromBytesFn("RGBA", width, height, output, "raw");
  } finally { if (blurred !== expanded) blurred?.free(); expanded?.free(); channel?.free(); }
}

// Decorate both depth inputs before their existing word/foreground mix. The
// original-photo branch places decoration above the background portion while
// protecting subject coverage. At zero decoration it preserves every byte.
export function decorateDepthPixels(photo, subject, decoration) {
  if (![photo, subject, decoration].every((data) => data instanceof Uint8Array && data.length === photo.length) || photo.length % 4) throw new Error("Cutout decoration dimensions must match.");
  for (let i = 0; i < photo.length; i += 4) {
    const e = decoration[i + 3] / 255; if (!e) continue;
    const a = photo[i + 3] / 255, f = subject[i + 3] / 255;
    const protectedCoverage = Math.min(a, f), pWeight = a - e * (a - protectedCoverage), eWeight = e * (1 - protectedCoverage);
    const pAlpha = pWeight + eWeight, dWeight = e * (1 - f), dAlpha = f + dWeight;
    for (let c = 0; c < 3; c++) {
      photo[i + c] = pAlpha ? Math.round((photo[i + c] * pWeight + decoration[i + c] * eWeight) / pAlpha) : 0;
      subject[i + c] = dAlpha ? Math.round((subject[i + c] * f + decoration[i + c] * dWeight) / dAlpha) : 0;
    }
    photo[i + 3] = Math.round(pAlpha * 255); subject[i + 3] = Math.round(dAlpha * 255);
  }
  return { photo, subject };
}

export function applyLayerOpacity(image, opacity) {
  if (opacity == null || opacity === 1) return;
  let alpha;
  try { alpha = image.getchannel(3); const lut = Uint8Array.from({ length: 256 }, (_, value) => Math.round(value * opacity));
    const scaled = alpha.point(lut); try { image.putalphaImageInput(scaled); } finally { scaled.free(); }
  } finally { alpha?.free(); }
}
