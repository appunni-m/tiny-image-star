import { parseDocument } from './model.js';

const MAX_DESIGN_NAME_LENGTH = 120;
const RECOVERY_FORK_SUFFIX = ' (recipe recovery copy)';

export function recipeRecoveryForkName(name) {
  const sourceName = String(name || '').trim() || 'Untitled';
  return `${sourceName.slice(0, MAX_DESIGN_NAME_LENGTH - RECOVERY_FORK_SUFFIX.length)}${RECOVERY_FORK_SUFFIX}`;
}

/** Create a validated, separately identified snapshot for recipe recovery. */
export function createRecipeRecoveryForkDocument(sourceDocument, forkId) {
  const source = parseDocument(sourceDocument);
  if (typeof forkId !== 'string' || !forkId.trim() || forkId === source.id) {
    throw new TypeError('A recovery copy needs a new design ID.');
  }
  const fork = structuredClone(source);
  fork.id = forkId;
  fork.name = recipeRecoveryForkName(source.name);
  return parseDocument(fork);
}

