export const EDITOR_NUMBER_STEP = 0.01;

/** Show editable canvas measurements at hundredth-point precision. */
export function formatEditorNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  const rounded = Number(number.toFixed(2));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
