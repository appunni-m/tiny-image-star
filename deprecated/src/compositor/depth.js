// Straight-RGBA input/output. For word coverage T, blend the original photo
// where words are absent with the extracted foreground where words are present.
// The word itself contributes T * (1 - foregroundAlpha). This preserves the
// original photo exactly at T=0, including soft/transparent source pixels.
export function compositeDepthPixels(photo, subject, words, keepBackground = true) {
  if (![photo, subject, words].every((value) => value instanceof Uint8Array) || !photo.length
    || photo.length % 4 || photo.length !== subject.length || photo.length !== words.length) throw new Error("Depth layers must have matching RGBA dimensions.");
  for (let i = 0; i < photo.length; i += 4) {
    const t = words[i + 3] / 255;
    if (!t) { if (!keepBackground) photo.set(subject.subarray(i, i + 4), i); continue; }
    const a = photo[i + 3] / 255, f = subject[i + 3] / 255;
    const pWeight = keepBackground ? a * (1 - t) : 0;
    const fWeight = f * (keepBackground ? t : 1), tWeight = t * (1 - f);
    const alpha = pWeight + fWeight + tWeight;
    for (let c = 0; c < 3; c++) photo[i + c] = alpha ? Math.round((photo[i + c] * pWeight + subject[i + c] * fWeight + words[i + c] * tWeight) / alpha) : 0;
    photo[i + 3] = Math.round(alpha * 255);
  }
  return photo;
}
