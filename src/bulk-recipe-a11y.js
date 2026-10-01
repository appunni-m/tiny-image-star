/** Build a concise batch announcement that stays stable during per-image progress updates. */
export function imageRecipeBatchAnnouncement(batch) {
  if (!batch) return '';
  const recipeName = String(batch.recipe?.name || 'image recipe');
  const total = Array.isArray(batch.targets) ? batch.targets.length : 0;
  const failed = Math.max(0, Number(batch.failed) || 0);
  const skipped = Math.max(0, Number(batch.skipped) || 0);
  const skippedLocked = Math.max(0, Number(batch.skippedLocked) || 0);
  const locked = skippedLocked + Math.max(0, Number(batch.excludedLocked) || 0);
  const updated = Math.max(0, (Number(batch.completed) || 0) - failed - skipped - skippedLocked - (Number(batch.superseded) || 0));

  if (batch.ownershipLost) return 'Another tab owns this recipe batch. Processing stopped in this tab.';
  if (batch.recoveryError) return 'Image edits are saved, but recipe recovery cleanup is still pending.';
  if (batch.saveError) return 'Recipe edits could not be saved. Retry save is available.';
  if (batch.paused) return 'Image recipe processing paused.';
  if (batch.cancelled) return 'Image recipe processing stopped.';
  if (batch.savePending && batch.done) return 'Recipe processing finished. Saving the changes to this device.';
  if (batch.journalPending && !batch.done) return `Preparing ${recipeName}; saving a recovery point before changing images.`;
  if (batch.done) {
    const details = [`${updated} updated`];
    if (failed) details.push(`${failed} failed`);
    if (Math.max(0, Number(batch.superseded) || 0)) details.push(`${Math.max(0, Number(batch.superseded) || 0)} newer edits preserved`);
    if (locked) details.push(`${locked} locked skipped`);
    if (skipped) details.push(`${skipped} unavailable skipped`);
    return `${recipeName} finished: ${details.join(', ')}.`;
  }
  return `Applying ${recipeName} to ${total} images.`;
}
