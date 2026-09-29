export const layerBlendModes = Object.freeze([
  'normal', 'darken', 'multiply', 'color-burn', 'lighten', 'screen', 'color-dodge',
  'overlay', 'soft-light', 'hard-light', 'difference', 'exclusion', 'hue',
  'saturation', 'color', 'luminosity'
]);

export const layerBlendModeLabels = Object.freeze({
  normal: 'Normal',
  darken: 'Darken',
  multiply: 'Multiply',
  'color-burn': 'Color burn',
  lighten: 'Lighten',
  screen: 'Screen',
  'color-dodge': 'Color dodge',
  overlay: 'Overlay',
  'soft-light': 'Soft light',
  'hard-light': 'Hard light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity'
});

export function isValidLayerBlendMode(mode) {
  return layerBlendModes.includes(mode);
}

export function canvasBlendOperation(mode = 'normal') {
  return mode === 'normal' ? 'source-over' : mode;
}
