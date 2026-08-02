import { DEFAULT_QUALITY } from "./quality.js";

export const DESTINATION_PRESETS = [
  { id: "keep-original", name: "Edit without resizing", description: "Keep dimensions while converting, compressing, or adjusting.", width: null, height: null, mode: "fit", aspect: null },
  { id: "instagram-square", name: "Instagram Post (Square)", description: "A familiar square layout.", width: 1080, height: 1080, mode: "crop", aspect: 1 },
  { id: "instagram-portrait", name: "Instagram Portrait", description: "A familiar portrait layout.", width: 1080, height: 1350, mode: "crop", aspect: 4 / 5 },
  { id: "instagram-story", name: "Instagram Story / Reel", description: "A familiar tall layout.", width: 1080, height: 1920, mode: "crop", aspect: 9 / 16 },
  { id: "x-post", name: "X Post (Wide)", description: "A wide social layout.", width: 1600, height: 900, mode: "crop", aspect: 16 / 9 },
  { id: "linkedin-post", name: "LinkedIn Post", description: "A landscape social layout.", width: 1200, height: 627, mode: "crop", aspect: 1200 / 627 },
  { id: "youtube-thumbnail", name: "YouTube Thumbnail", description: "A wide video thumbnail layout.", width: 1280, height: 720, mode: "crop", aspect: 16 / 9 },
  { id: "website-banner", name: "Website Banner", description: "A wide banner layout.", width: 1600, height: 600, mode: "crop", aspect: 8 / 3 },
  { id: "profile-photo", name: "Profile Photo", description: "A compact square profile layout.", width: 512, height: 512, mode: "crop", aspect: 1 },
];

export const PRESETS = DESTINATION_PRESETS.map((preset) => ({
  ...preset,
  operations: {
    cropRelative: null,
    rotation: 0,
    flipX: false,
    flipY: false,
    resizeWidth: preset.width,
    resizeHeight: preset.height,
    resizeMode: preset.mode,
    aspectLocked: true,
    brightness: 1,
    contrast: 1,
    grayscale: false,
    lossy: false,
    quality: DEFAULT_QUALITY,
    format: "png",
  },
}));

export function presetById(id) {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];
}

export function settingsForPreset(id) {
  const preset = presetById(id);
  return { presetId: preset.id, ...preset.operations };
}
