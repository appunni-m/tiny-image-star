/** Whether an image recipe batch still owns work or has workers draining. */
export function isImageRecipeBatchActive(batch) {
  return Boolean(batch && (!batch.done || batch.inflight > 0));
}

/** A batch can only leave the progress bar after all submitted work settles. */
export function canDismissImageRecipeBatch(batch) {
  return Boolean(batch && batch.done && batch.inflight === 0);
}

/** Stop admitting targets and let already-running renders settle. */
export function cancelImageRecipeBatch(batch) {
  if (!isImageRecipeBatchActive(batch)) return false;
  batch.cancelled = true;
  batch.next = batch.targets.length;
  batch.paused = false;
  completeImageRecipeBatchIfDrained(batch);
  return true;
}

/** Finish after admission stops and every submitted render has settled. */
export function completeImageRecipeBatchIfDrained(batch) {
  if (!batch || batch.inflight !== 0) return false;
  if (!batch.cancelled && batch.next < batch.targets.length) return false;
  batch.done = true;
  return true;
}

/** Count one terminal target result; canceled work is not completed or skipped. */
export function recordImageRecipeBatchTarget(batch, { failed = false, superseded = false, skipped = false, canceled = false, targetId = null } = {}) {
  if (canceled) return false;
  batch.completed += 1;
  if (failed) {
    batch.failed += 1;
    if (typeof targetId === 'string' && targetId && Array.isArray(batch.failedTargets) && !batch.failedTargets.includes(targetId)) {
      batch.failedTargets.push(targetId);
    }
  }
  if (superseded) batch.superseded = (batch.superseded || 0) + 1;
  if (skipped) batch.skipped = (batch.skipped || 0) + 1;
  return true;
}
