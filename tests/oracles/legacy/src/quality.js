export const QUALITY_LEVELS = Object.freeze([
  Object.freeze({ id: "low", label: "Low", value: 80, description: "Smallest file" }),
  Object.freeze({ id: "medium", label: "Medium", value: 95, description: "Recommended" }),
  Object.freeze({ id: "high", label: "High", value: 100, description: "Largest file" }),
]);

export const DEFAULT_QUALITY = 95;

export function normalizeQuality(value, fallback = DEFAULT_QUALITY) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(100, Math.round(number))) : fallback;
}

export function qualityLevelForValue(value) {
  const normalized = normalizeQuality(value);
  return QUALITY_LEVELS.find((level) => level.value === normalized) ?? null;
}

export function qualityLabel(value) {
  const normalized = normalizeQuality(value);
  return qualityLevelForValue(normalized)?.label ?? `Custom (${normalized})`;
}
