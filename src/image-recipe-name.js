export const MAX_IMAGE_RECIPE_NAME_LENGTH = 60;

function prefixWithinUtf16Length(value, maxLength) {
  let prefix = '';
  for (const character of value) {
    if (prefix.length + character.length > maxLength) break;
    prefix += character;
  }
  return prefix;
}

/** Build a layer-derived recipe name that always fits the persisted 60-unit limit. */
export function defaultImageRecipeName(layerName, suffix = ' look') {
  const tail = String(suffix);
  if (tail.length >= MAX_IMAGE_RECIPE_NAME_LENGTH) throw new TypeError('Image recipe name suffix is too long.');
  const source = String(layerName ?? '').replace(/[\x00-\x1f\x7f]/gu, ' ').trim() || 'Image';
  const available = MAX_IMAGE_RECIPE_NAME_LENGTH - tail.length;
  if (source.length <= available) return `${source}${tail}`;
  const prefix = prefixWithinUtf16Length(source, available - 1).trimEnd();
  return `${prefix}…${tail}`;
}
