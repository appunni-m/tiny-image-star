import { isValidNoiseEffect } from './noise-effect.js';
import { isValidTextureEffect } from './texture-effect.js';
import { isValidGlassEffect, MAX_GLASS_EFFECTS_PER_LAYER } from './glass-effect.js';
import { fillStackForNode } from './fills.js';
import { isValidLayerBlendMode } from './layer-blend.js';

export { MAX_GLASS_EFFECTS_PER_LAYER };
export const MAX_SHADOW_SPREAD = 1000;
export const layerEffectTypes = new Set(['drop-shadow', 'inner-shadow', 'layer-blur', 'background-blur', 'noise', 'texture', 'glass']);
export const layerEffectBlendTypes = new Set(['drop-shadow', 'inner-shadow', 'noise']);
export const MAX_DROP_SHADOWS_PER_LAYER = 8;
export const MAX_INNER_SHADOWS_PER_LAYER = 8;
export const MAX_LAYER_BLURS_PER_LAYER = 1;
export const MAX_BACKGROUND_BLURS_PER_LAYER = 1;
export const MAX_NOISE_EFFECTS_PER_LAYER = 2;
export const MAX_TEXTURE_EFFECTS_PER_LAYER = 1;
export const MAX_EFFECTS_PER_LAYER = MAX_DROP_SHADOWS_PER_LAYER + MAX_INNER_SHADOWS_PER_LAYER + 1 + MAX_NOISE_EFFECTS_PER_LAYER + MAX_TEXTURE_EFFECTS_PER_LAYER + MAX_GLASS_EFFECTS_PER_LAYER;

export function isValidLayerEffects(effects) {
  if (!Array.isArray(effects) || effects.length > MAX_EFFECTS_PER_LAYER) return false;
  const ids = new Set();
  let layerBlurCount = 0;
  let backgroundBlurCount = 0;
  let dropShadowCount = 0;
  let innerShadowCount = 0;
  let noiseCount = 0;
  let textureCount = 0;
  let glassCount = 0;
  for (const effect of effects) {
    if (!effect || typeof effect.id !== 'string' || !effect.id || ids.has(effect.id)
      || !layerEffectTypes.has(effect.type) || typeof effect.visible !== 'boolean') return false;
    if (effect.blendMode != null && (!layerEffectBlendTypes.has(effect.type) || !isValidLayerBlendMode(effect.blendMode))) return false;
    ids.add(effect.id);
    if (effect.type === 'drop-shadow') dropShadowCount += 1;
    if (effect.type === 'inner-shadow') innerShadowCount += 1;
    if (effect.type === 'layer-blur') layerBlurCount += 1;
    if (effect.type === 'background-blur') backgroundBlurCount += 1;
    if (effect.type === 'noise') {
      noiseCount += 1;
      if (!isValidNoiseEffect(effect)) return false;
      continue;
    }
    if (effect.type === 'texture') {
      textureCount += 1;
      if (!isValidTextureEffect(effect)) return false;
      continue;
    }
    if (effect.type === 'glass') {
      glassCount += 1;
      if (!isValidGlassEffect(effect)) return false;
      continue;
    }
    if (effect.type === 'layer-blur' || effect.type === 'background-blur') {
      if (!Number.isFinite(effect.radius) || effect.radius < 0 || effect.radius > 100) return false;
    } else if (!/^#[0-9a-f]{6}$/i.test(effect.color)
      || !Number.isFinite(effect.opacity) || effect.opacity < 0 || effect.opacity > 1
      || !Number.isFinite(effect.offsetX) || Math.abs(effect.offsetX) > 1000
      || !Number.isFinite(effect.offsetY) || Math.abs(effect.offsetY) > 1000
      || !Number.isFinite(effect.blur) || effect.blur < 0 || effect.blur > 100
      || (effect.spread != null && (!Number.isFinite(effect.spread) || Math.abs(effect.spread) > MAX_SHADOW_SPREAD))) return false;
  }
  // Match the source editor's mutually exclusive, single blur effect slot.
  return dropShadowCount <= MAX_DROP_SHADOWS_PER_LAYER
    && innerShadowCount <= MAX_INNER_SHADOWS_PER_LAYER
    && layerBlurCount <= MAX_LAYER_BLURS_PER_LAYER
    && backgroundBlurCount <= MAX_BACKGROUND_BLURS_PER_LAYER
    && noiseCount <= MAX_NOISE_EFFECTS_PER_LAYER
    && textureCount <= MAX_TEXTURE_EFFECTS_PER_LAYER
    && glassCount <= MAX_GLASS_EFFECTS_PER_LAYER
    && !(layerBlurCount && backgroundBlurCount);
}

/**
 * Figma only applies shadow spread to rectangles and ellipses, and to clipped
 * frames/components/instances that have a visible fill. Keep stored values on
 * unsupported nodes so changing their type does not destroy authored data.
 */
export function supportsShadowSpread(node) {
  if (!node) return false;
  if (node.type === 'rectangle' || node.type === 'ellipse') return true;
  if (!(node.type === 'frame' || node.isComponent || node.isInstance) || node.clip !== true) return false;
  return fillStackForNode(node).some(fill => {
    if (!fill || fill.visible === false) return false;
    const opacity = Number.isFinite(fill.opacity) ? fill.opacity : 1;
    if (opacity < 0.01 || (fill.type === 'solid' && (!fill.color || fill.color === 'transparent'))) return false;
    if (['linear', 'radial', 'angular'].includes(fill.type)) {
      return Array.isArray(fill.gradient?.stops)
        && fill.gradient.stops.some(stop => (stop?.opacity ?? 1) * opacity >= 0.01);
    }
    return true;
  });
}

/** Move one effect within its authored stack without changing the stack's entries. */
export function moveLayerEffect(effects, effectId, direction) {
  if (!Array.isArray(effects) || !['up', 'down'].includes(direction)) return false;
  const index = effects.findIndex(effect => effect?.id === effectId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= effects.length) return false;
  [effects[index], effects[target]] = [effects[target], effects[index]];
  return true;
}

function cssColorWithOpacity(color, opacity) {
  const value = Number.parseInt(color.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(1, opacity))})`;
}

export function buildLayerEffectFilter(effects, scale = 1) {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  // CSS filters can only blend shadows in normal mode. Other effect blend
  // modes need the renderer's live backdrop and must never be approximated.
  const visible = (effects || []).filter(effect => effect?.visible !== false
    && (effect.blendMode == null || effect.blendMode === 'normal'));
  const layerBlurs = visible.filter(effect => effect.type === 'layer-blur')
    .map(effect => `blur(${Math.max(0, effect.radius) * factor}px)`);
  const dropShadows = visible.filter(effect => effect.type === 'drop-shadow')
    .map(effect => `drop-shadow(${effect.offsetX * factor}px ${effect.offsetY * factor}px ${Math.max(0, effect.blur) * factor}px ${cssColorWithOpacity(effect.color, effect.opacity)})`);
  // Figma renders layer blur above paints and drop shadows below them, even
  // when those two effect types are interleaved in the authored list.
  return [...layerBlurs, ...dropShadows].join(' ') || 'none';
}

export function buildLayerEffectBoxShadow(effects) {
  return (effects || []).filter(effect => effect?.type === 'inner-shadow' && effect.visible !== false
    && (effect.blendMode == null || effect.blendMode === 'normal')).map(effect =>
    `inset ${effect.offsetX}px ${effect.offsetY}px ${Math.max(0, effect.blur)}px ${cssColorWithOpacity(effect.color, effect.opacity)}`
  ).join(', ') || 'none';
}

export function layerEffectPadding(effects) {
  let x = 0; let y = 0;
  for (const effect of effects || []) {
    if (effect?.visible === false) continue;
    if (effect.type === 'background-blur') continue;
    if (effect.type === 'layer-blur') {
      x += effect.radius * 3; y += effect.radius * 3;
    } else if (effect.type === 'drop-shadow') {
      const spread = Math.max(0, effect.spread ?? 0);
      x += Math.abs(effect.offsetX) + effect.blur * 3 + spread;
      y += Math.abs(effect.offsetY) + effect.blur * 3 + spread;
    } else if (effect.type === 'texture' && !effect.clipToShape) {
      x += effect.radius + 1;
      y += effect.radius + 1;
    }
  }
  return { x, y };
}
