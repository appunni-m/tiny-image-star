export const layerEffectTypes = new Set(['drop-shadow', 'layer-blur']);

export function isValidLayerEffects(effects) {
  if (!Array.isArray(effects) || effects.length > 8) return false;
  const ids = new Set();
  for (const effect of effects) {
    if (!effect || typeof effect.id !== 'string' || !effect.id || ids.has(effect.id)
      || !layerEffectTypes.has(effect.type) || typeof effect.visible !== 'boolean') return false;
    ids.add(effect.id);
    if (effect.type === 'layer-blur') {
      if (!Number.isFinite(effect.radius) || effect.radius < 0 || effect.radius > 100) return false;
    } else if (!/^#[0-9a-f]{6}$/i.test(effect.color)
      || !Number.isFinite(effect.opacity) || effect.opacity < 0 || effect.opacity > 1
      || !Number.isFinite(effect.offsetX) || Math.abs(effect.offsetX) > 1000
      || !Number.isFinite(effect.offsetY) || Math.abs(effect.offsetY) > 1000
      || !Number.isFinite(effect.blur) || effect.blur < 0 || effect.blur > 100) return false;
  }
  return true;
}

function cssColorWithOpacity(color, opacity) {
  const value = Number.parseInt(color.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(1, opacity))})`;
}

export function buildLayerEffectFilter(effects, scale = 1) {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return (effects || []).filter(effect => effect?.visible !== false).map(effect => {
    if (effect.type === 'layer-blur') return `blur(${Math.max(0, effect.radius) * factor}px)`;
    if (effect.type === 'drop-shadow') {
      return `drop-shadow(${effect.offsetX * factor}px ${effect.offsetY * factor}px ${Math.max(0, effect.blur) * factor}px ${cssColorWithOpacity(effect.color, effect.opacity)})`;
    }
    return '';
  }).filter(Boolean).join(' ') || 'none';
}

export function layerEffectPadding(effects) {
  let x = 0; let y = 0;
  for (const effect of effects || []) {
    if (effect?.visible === false) continue;
    if (effect.type === 'layer-blur') {
      x += effect.radius * 3; y += effect.radius * 3;
    } else if (effect.type === 'drop-shadow') {
      x += Math.abs(effect.offsetX) + effect.blur * 3;
      y += Math.abs(effect.offsetY) + effect.blur * 3;
    }
  }
  return { x, y };
}
