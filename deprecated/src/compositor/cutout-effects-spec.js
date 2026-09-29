// Widths, blur and offsets are fractions of the canonical slide height.
export function validateCutoutEffects(value) {
  const fail = () => { const error = new Error("Invalid cutout outline or shadow."); error.code = "INVALID_PROJECT"; throw error; };
  const object = (entry, allowed) => { if (!entry || Array.isArray(entry) || Object.getPrototypeOf(entry) !== Object.prototype
    || Object.keys(entry).some((key) => !allowed.includes(key))) fail(); };
  const number = (entry, min, max) => { if (!Number.isFinite(entry) || typeof entry !== "number" || entry < min || entry > max) fail(); };
  const color = (entry) => { if (typeof entry !== "string" || !/^#[0-9a-f]{6}$/i.test(entry)) fail(); };
  object(value, ["schema", "outline", "shadow"]); if (value.schema !== 1) fail();
  if (value.outline != null) { object(value.outline, ["color", "width"]); color(value.outline.color); number(value.outline.width, 0, .02); }
  if (value.shadow != null) {
    object(value.shadow, ["color", "opacity", "blur", "x", "y"]); color(value.shadow.color); number(value.shadow.opacity, 0, 1);
    number(value.shadow.blur, 0, .03); number(value.shadow.x, -.05, .05); number(value.shadow.y, -.05, .05);
  }
  return value;
}

export function cutoutEffectMetrics(node, height) {
  const effect = node.maskId ? node.cutoutEffects : null;
  const outline = effect?.outline?.width > 0 ? Math.max(1, Math.round(effect.outline.width * height)) : 0;
  const shadow = effect?.shadow?.opacity > 0 ? effect.shadow : null;
  const blur = shadow ? shadow.blur * height : 0, x = shadow ? Math.round(shadow.x * height) : 0, y = shadow ? Math.round(shadow.y * height) : 0;
  // Pillow's finite Gaussian approximation needs surrounding transparent
  // pixels. Reserve conservatively beyond its box-filter support and offset.
  const padding = outline || shadow ? outline + Math.ceil(blur * 4) + Math.max(Math.abs(x), Math.abs(y)) + 4 : 0;
  return { outline, shadow, blur, x, y, padding };
}
