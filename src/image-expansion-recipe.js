import { normalizeImageExpansionRatio } from './image-expansion-geometry.js';

function sameRatio(left, right) {
  try {
    return JSON.stringify(normalizeImageExpansionRatio(left)) === JSON.stringify(normalizeImageExpansionRatio(right));
  } catch {
    return false;
  }
}

/** Plan the structural part of applying an expansion recipe to one image. */
export function planImageExpansionRecipeTransition(node, recipe) {
  if (node?.type !== 'image') throw new TypeError('Image expansion recipes require an image layer.');
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw new TypeError('An image recipe is required.');

  const hadExpansion = node.imageExpansion || null;
  const hasExpansionOverride = Object.hasOwn(recipe, 'imageExpansionPaddingRatio');
  const hasBackgroundRemovalOverride = Object.hasOwn(recipe, 'backgroundRemoved');
  const requestedRatio = hasExpansionOverride
    ? recipe.imageExpansionPaddingRatio
    : hadExpansion?.paddingRatio;
  if (hasExpansionOverride && requestedRatio !== null) normalizeImageExpansionRatio(requestedRatio);
  const backgroundStateWouldChange = hasBackgroundRemovalOverride
    && recipe.backgroundRemoved !== (node.backgroundRemoved === true);
  const expansionOperationRequested = hasExpansionOverride
    || (hasBackgroundRemovalOverride && Boolean(hadExpansion));
  const currentExpansionMatches = Boolean(hadExpansion && requestedRatio
    && sameRatio(hadExpansion.paddingRatio, requestedRatio));
  const keepCurrentExpansion = currentExpansionMatches && !backgroundStateWouldChange;

  return Object.freeze({
    hadExpansion: Boolean(hadExpansion),
    requestedRatio,
    expansionOperationRequested,
    keepCurrentExpansion,
    restoreExistingExpansion: Boolean(hadExpansion && expansionOperationRequested && !keepCurrentExpansion),
    applyExpansion: expansionOperationRequested,
    remapRecipeStrokes: Boolean(keepCurrentExpansion && Object.hasOwn(recipe, 'inpaintStrokes')
      && recipe.inpaintStrokes != null),
  });
}
