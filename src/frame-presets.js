/**
 * Curated starter frame sizes for common design targets.
 *
 * Figma documents these preset categories, but this intentionally small list
 * is not an exhaustive copy of Figma's changing device catalog. Dimensions
 * are canvas pixels; paper sizes use the nearest whole-pixel equivalent at
 * 96 px/in.
 * https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design
 */
export const FRAME_PRESET_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'phone', name: 'Phone' }),
  Object.freeze({ id: 'tablet', name: 'Tablet' }),
  Object.freeze({ id: 'desktop', name: 'Desktop' }),
  Object.freeze({ id: 'presentation', name: 'Presentation' }),
  Object.freeze({ id: 'watch', name: 'Watch' }),
  Object.freeze({ id: 'paper', name: 'Paper' }),
  Object.freeze({ id: 'social', name: 'Social media' }),
]);

const presetDefinitions = [
  { id: 'phone-compact', category: 'phone', name: 'Compact phone', width: 360, height: 800 },
  { id: 'phone-standard', category: 'phone', name: 'Standard phone', width: 393, height: 852 },
  { id: 'phone-large', category: 'phone', name: 'Large phone', width: 440, height: 956 },

  { id: 'tablet-small', category: 'tablet', name: 'Small tablet', width: 744, height: 1133 },
  { id: 'tablet-standard', category: 'tablet', name: 'Standard tablet', width: 820, height: 1180 },
  { id: 'tablet-large', category: 'tablet', name: 'Large tablet', width: 1024, height: 1366 },

  { id: 'desktop-laptop', category: 'desktop', name: 'Laptop', width: 1366, height: 768 },
  { id: 'desktop-standard', category: 'desktop', name: 'Desktop', width: 1440, height: 900 },
  { id: 'desktop-large', category: 'desktop', name: 'Large desktop', width: 1920, height: 1080 },

  { id: 'presentation-widescreen', category: 'presentation', name: 'Widescreen · 16:9', width: 1920, height: 1080 },
  { id: 'presentation-classic', category: 'presentation', name: 'Classic · 4:3', width: 1440, height: 1080 },
  { id: 'presentation-vertical', category: 'presentation', name: 'Vertical · 9:16', width: 1080, height: 1920 },

  { id: 'watch-40mm', category: 'watch', name: '40 mm watch', width: 324, height: 394 },
  { id: 'watch-45mm', category: 'watch', name: '45 mm watch', width: 396, height: 484 },

  { id: 'paper-a4', category: 'paper', name: 'A4', width: 794, height: 1123 },
  { id: 'paper-letter', category: 'paper', name: 'US Letter', width: 816, height: 1056 },
  { id: 'paper-a3', category: 'paper', name: 'A3', width: 1123, height: 1587 },

  { id: 'social-square', category: 'social', name: 'Square post', width: 1080, height: 1080 },
  { id: 'social-portrait', category: 'social', name: 'Portrait post · 4:5', width: 1080, height: 1350 },
  { id: 'social-story', category: 'social', name: 'Story · 9:16', width: 1080, height: 1920 },
  { id: 'social-landscape', category: 'social', name: 'Landscape post', width: 1200, height: 628 },
];

export const FRAME_PRESETS = Object.freeze(presetDefinitions.map(preset => Object.freeze(preset)));

const presetById = new Map(FRAME_PRESETS.map(preset => [preset.id, preset]));
const categoryById = new Map(FRAME_PRESET_CATEGORIES.map(category => [category.id, category]));

/** Return a catalog entry by stable ID, or null when it is not in this catalog. */
export function getFramePreset(id) {
  return presetById.get(id) ?? null;
}

/** Group presets in catalog category order for a category-first picker. */
export function groupFramePresetsByCategory(presets = FRAME_PRESETS) {
  if (!Array.isArray(presets)) throw new TypeError('Frame presets must be an array.');
  const grouped = new Map(FRAME_PRESET_CATEGORIES.map(category => [category.id, []]));
  for (const preset of presets) {
    const bucket = grouped.get(preset?.category);
    if (!bucket || !categoryById.has(preset.category)) {
      throw new TypeError(`Unknown frame preset category: ${String(preset?.category)}.`);
    }
    bucket.push(preset);
  }
  return FRAME_PRESET_CATEGORIES.map(category => Object.freeze({
    ...category,
    presets: Object.freeze([...grouped.get(category.id)]),
  }));
}
