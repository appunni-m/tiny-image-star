export const TEXT_POSITIONS = Object.freeze(['normal', 'superscript', 'subscript']);

export function isValidTextPosition(value) {
  return TEXT_POSITIONS.includes(value);
}
