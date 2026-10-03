/** Whether an image recipe batch still owns work or has workers draining. */
export function isImageRecipeBatchActive(batch) {
  return Boolean(batch && (!batch.done || batch.inflight > 0));
}

const failedTargetIndexes = new WeakMap();

function rememberFailedTarget(batch, targetId) {
  if (typeof targetId !== 'string' || !targetId || !Array.isArray(batch.failedTargets)) return;
  let targetIndex = failedTargetIndexes.get(batch);
  if (!targetIndex || targetIndex.size !== batch.failedTargets.length) {
    targetIndex = new Set(batch.failedTargets);
    failedTargetIndexes.set(batch, targetIndex);
  }
  if (targetIndex.has(targetId)) return;
  targetIndex.add(targetId);
  batch.failedTargets.push(targetId);
}

/** Fence rollback and preview restoration even when a target failed before its render was queued. */
export function imageRecipeRenderIsCurrent(batch, targetId, initialVersion, currentVersion) {
  if (!batch?.renderVersions?.has(targetId)) return Object.is(initialVersion, currentVersion);
  return Object.is(batch.renderVersions.get(targetId), currentVersion);
}

/**
 * Return only currently-owned renders whose version still belongs to this
 * recipe. Cancellation work stays proportional to in-flight concurrency,
 * rather than scanning every target already admitted in a large batch.
 */
export function activeImageRecipeRenderTargets(batch, currentRenderVersion) {
  if (typeof currentRenderVersion !== 'function') throw new TypeError('Recipe render cancellation needs a current-version lookup.');
  if (!(batch?.activeControllers instanceof Map) || !(batch.renderVersions instanceof Map)) return [];
  const targets = [];
  for (const targetId of batch.activeControllers.keys()) {
    const recipeVersion = batch.renderVersions.get(targetId);
    if (recipeVersion != null && recipeVersion === currentRenderVersion(targetId)) targets.push(targetId);
  }
  return targets;
}

/**
 * Restore a target's original image, then validate that the admitted batch and
 * exact editable layer are still current before allowing any recipe mutation.
 * `onAdmit` runs synchronously after the checks, so callers can mutate/save and
 * dispatch the render without another async gap between validation and use.
 */
export async function hydrateAndAdmitImageRecipeTarget({
  ensureResident,
  assetId,
  previewKey,
  generation,
  isGenerationCurrent,
  isBatchCurrent,
  resolveTarget,
  expectedNode,
  isEditableTarget,
  onAdmit,
}) {
  await ensureResident(assetId, previewKey, generation);
  if (!isGenerationCurrent() || !isBatchCurrent()) return { status: 'cancelled' };

  const entry = resolveTarget();
  if (!entry || entry.node !== expectedNode || entry.node.assetId !== assetId || !isEditableTarget(entry)) {
    return { status: 'skipped' };
  }

  return { status: 'admitted', value: onAdmit(entry) };
}

function monotonicNow(now) {
  if (Number.isFinite(now)) return now;
  return globalThis.performance?.now?.() ?? Date.now();
}

function elapsedActiveMilliseconds(batch, now) {
  const elapsed = Math.max(0, Number(batch?.activeElapsedMs) || 0);
  if (!Number.isFinite(batch?.activeSince)) return elapsed;
  return elapsed + Math.max(0, monotonicNow(now) - batch.activeSince);
}

function lowerBound(values, start, value) {
  let low = start;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values, start, value) {
  let low = start;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function trimTimingCompletions(batch, cutoff) {
  const times = batch.timingCompletionTimes;
  let head = Number.isSafeInteger(batch.timingCompletionHead) ? batch.timingCompletionHead : 0;
  while (head < times.length && times[head] < cutoff) head += 1;
  batch.timingCompletionHead = head;
  // Keep pruning amortized O(1): compact only after a substantial prefix has
  // become dead, rather than copying the rolling window on every image.
  if (head >= 1024 && head * 2 >= times.length) {
    times.splice(0, head);
    batch.timingCompletionHead = 0;
  }
}

/** Start a fresh active-time clock for a new recipe run or targeted retry. */
export function startImageRecipeBatchClock(batch, now) {
  if (!batch) return false;
  batch.activeElapsedMs = 0;
  batch.activeSince = monotonicNow(now);
  batch.timingCompletions = 0;
  batch.timingCompletionTimes = [];
  batch.timingCompletionHead = 0;
  return true;
}

/** Freeze active time while a batch is paused; repeated pauses are harmless. */
export function pauseImageRecipeBatchClock(batch, now) {
  if (!batch || !Number.isFinite(batch.activeSince)) return false;
  batch.activeElapsedMs = elapsedActiveMilliseconds(batch, now);
  batch.activeSince = null;
  return true;
}

/** Resume the active-time clock without counting the paused interval. */
export function resumeImageRecipeBatchClock(batch, now) {
  if (!batch || batch.done || batch.cancelled || Number.isFinite(batch.activeSince)) return false;
  batch.activeSince = monotonicNow(now);
  return true;
}

/** Return elapsed active time, average target throughput, and remaining work. */
export function imageRecipeBatchTiming(batch, now) {
  if (!batch) return { elapsedMs: 0, imagesPerSecond: 0, recentImagesPerSecond: 0, remaining: 0, etaSeconds: null };
  const elapsedMs = elapsedActiveMilliseconds(batch, now);
  const completed = Math.max(0, Number(batch.completed) || 0);
  const timingCompletions = Number.isFinite(batch.timingCompletions)
    ? Math.max(0, batch.timingCompletions)
    : completed;
  const total = Array.isArray(batch.targets) ? batch.targets.length : completed;
  const remaining = Math.max(0, total - completed);
  const imagesPerSecond = elapsedMs > 0 ? timingCompletions / (elapsedMs / 1000) : 0;
  const completionTimes = Array.isArray(batch.timingCompletionTimes) ? batch.timingCompletionTimes : [];
  const recentWindowMs = 5000;
  const recentStart = Math.max(0, elapsedMs - recentWindowMs);
  const completionHead = Array.isArray(batch.timingCompletionTimes) && Number.isSafeInteger(batch.timingCompletionHead)
    ? Math.min(batch.timingCompletionHead, completionTimes.length)
    : 0;
  const recentFirst = lowerBound(completionTimes, completionHead, recentStart);
  const recentEnd = upperBound(completionTimes, recentFirst, elapsedMs);
  const recentCount = recentEnd - recentFirst;
  const lastCompletion = recentCount ? completionTimes[recentEnd - 1] : -Infinity;
  const recentImagesPerSecond = recentCount
    && elapsedMs - lastCompletion < recentWindowMs
    ? recentCount / (Math.max(1000, Math.min(recentWindowMs, elapsedMs - recentStart)) / 1000)
    : 0;
  const etaSeconds = !batch.cancelled && imagesPerSecond > 0 && remaining > 0 ? remaining / imagesPerSecond : null;
  return { elapsedMs, imagesPerSecond, recentImagesPerSecond, remaining, etaSeconds };
}

function formatRate(imagesPerSecond) {
  if (!(imagesPerSecond > 0)) return null;
  if (imagesPerSecond < 0.1) return '<0.1 images/s';
  return `${imagesPerSecond < 10 ? imagesPerSecond.toFixed(1) : Math.round(imagesPerSecond)} images/s`;
}

function formatEta(seconds) {
  const total = Math.max(1, Math.ceil(seconds));
  if (total < 60) return `about ${total}s`;
  if (total < 3600) return `about ${Math.floor(total / 60)}m ${total % 60}s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `about ${hours}h ${minutes}m`;
}

/** Human-readable in-place bar status that never predicts canceled work. */
export function formatImageRecipeBatchTiming(batch, now) {
  if (!batch) return 'Ready';
  const timing = imageRecipeBatchTiming(batch, now);
  const rate = formatRate(timing.imagesPerSecond);
  const recentRate = formatRate(timing.recentImagesPerSecond) || '0.0 images/s';
  const liveRate = `now ${recentRate}`;
  if (batch.cancelled) {
    if (!batch.done) return 'Stopping · admitted images are finishing';
    return rate ? `Stopped · ${rate} average · ${liveRate}` : 'Stopped · no timed renders';
  }
  if (batch.done) return rate ? `Complete · ${rate} average · ${liveRate}` : 'Complete · no timed renders';
  if (batch.paused) {
    if (!rate) return `Paused · waiting for the first result · ${liveRate}`;
    return timing.etaSeconds === null
      ? `Paused · ${rate} average · ${liveRate}`
      : `Paused · ${rate} average · ${formatEta(timing.etaSeconds)} after resume · ${liveRate}`;
  }
  if (!rate) return `Starting · ${timing.remaining} image${timing.remaining === 1 ? '' : 's'} left · ${liveRate}`;
  if (timing.elapsedMs < 1000 || timing.etaSeconds === null) return `${rate} average · ${liveRate} · estimating ETA`;
  return `${rate} average · ${liveRate} · ${formatEta(timing.etaSeconds)} left`;
}

/** A batch can only leave the progress bar after all submitted work settles. */
export function canDismissImageRecipeBatch(batch) {
  return Boolean(batch && batch.done && batch.inflight === 0);
}

/** Stop admitting targets and let already-running renders settle. */
export function cancelImageRecipeBatch(batch, now) {
  if (!isImageRecipeBatchActive(batch)) return false;
  // Cancellation resumes already-admitted renders so their drain time and
  // terminal results remain part of the final average even if the queue was
  // paused when the user canceled.
  if (batch.paused && batch.inflight > 0) resumeImageRecipeBatchClock(batch, now);
  batch.cancelled = true;
  batch.next = batch.targets.length;
  batch.paused = false;
  completeImageRecipeBatchIfDrained(batch, now);
  return true;
}

/** Finish after admission stops and every submitted render has settled. */
export function completeImageRecipeBatchIfDrained(batch, now) {
  if (!batch || batch.inflight !== 0) return false;
  if (!batch.cancelled && batch.next < batch.targets.length) return false;
  batch.done = true;
  pauseImageRecipeBatchClock(batch, now);
  // These per-target maps only fence or restore in-flight work. A completed
  // batch keeps its target IDs and failed IDs for recovery/retry, but retaining
  // a render-version/status entry for every image needlessly pins O(batch
  // size) memory while the result bar remains open (especially on mobile).
  batch.activeControllers?.clear?.();
  batch.renderVersions?.clear?.();
  batch.previousStatuses?.clear?.();
  batch.restorePreviews?.clear?.();
  return true;
}

/** Count one terminal target result; canceled work is not completed or skipped. */
export function recordImageRecipeBatchTarget(batch, { failed = false, superseded = false, skipped = false, canceled = false, targetId = null, now } = {}) {
  if (canceled) return false;
  batch.completed += 1;
  // Skipped targets never enter the image pipeline. Counting them as image
  // throughput can inflate both the live rate and ETA when a large selection
  // contains deleted, unavailable, or otherwise ineligible layers.
  const timedCompletion = !skipped && Number.isFinite(batch.activeSince) && !batch.paused;
  if (timedCompletion) batch.timingCompletions = (Number(batch.timingCompletions) || 0) + 1;
  if (timedCompletion) {
    batch.timingCompletionTimes ||= [];
    const elapsedMs = Math.max(
      elapsedActiveMilliseconds(batch, now),
      batch.timingCompletionTimes.at(-1) || 0,
    );
    batch.timingCompletionTimes.push(elapsedMs);
    trimTimingCompletions(batch, Math.max(0, elapsedMs - 5000));
  }
  if (failed) {
    batch.failed += 1;
    rememberFailedTarget(batch, targetId);
  }
  if (superseded) batch.superseded = (batch.superseded || 0) + 1;
  if (skipped) batch.skipped = (batch.skipped || 0) + 1;
  return true;
}
