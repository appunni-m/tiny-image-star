/**
 * Pick a useful initial batch limit without treating phone memory like desktop
 * memory. The render engine still admits each image by its measured working
 * set, and users can change this cap live from the recipe bar.
 */
export function defaultImageRecipeConcurrency({ cpuBudget, deviceMemory, mobile = false } = {}) {
  if (!Number.isSafeInteger(cpuBudget) || cpuBudget < 1) {
    throw new RangeError('The image recipe CPU budget must be a positive integer.');
  }
  const knownLowMemory = Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4;
  return Math.min(cpuBudget, mobile || knownLowMemory ? 2 : 4);
}
