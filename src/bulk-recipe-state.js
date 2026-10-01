/** Whether an image recipe batch still owns work or has workers draining. */
export function isImageRecipeBatchActive(batch) {
  return Boolean(batch && (!batch.done || batch.inflight > 0));
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

/** Start a fresh active-time clock for a new recipe run or targeted retry. */
export function startImageRecipeBatchClock(batch, now) {
  if (!batch) return false;
  batch.activeElapsedMs = 0;
  batch.activeSince = monotonicNow(now);
  batch.timingCompletions = 0;
  batch.timingCompletionTimes = [];
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
  const recentCompletions = completionTimes.filter(at => at >= recentStart && at <= elapsedMs);
  const recentImagesPerSecond = recentCompletions.length
    && elapsedMs - recentCompletions.at(-1) < recentWindowMs
    ? recentCompletions.length / (Math.max(1000, Math.min(recentWindowMs, elapsedMs - recentStart)) / 1000)
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
  return true;
}

/** Count one terminal target result; canceled work is not completed or skipped. */
export function recordImageRecipeBatchTarget(batch, { failed = false, superseded = false, skipped = false, canceled = false, targetId = null, now } = {}) {
  if (canceled) return false;
  batch.completed += 1;
  if (Number.isFinite(batch.activeSince) && !batch.paused) batch.timingCompletions = (Number(batch.timingCompletions) || 0) + 1;
  if (Number.isFinite(batch.activeSince) && !batch.paused) {
    const elapsedMs = elapsedActiveMilliseconds(batch, now);
    batch.timingCompletionTimes ||= [];
    batch.timingCompletionTimes.push(elapsedMs);
    batch.timingCompletionTimes = batch.timingCompletionTimes.filter(at => elapsedMs - at < 5000);
  }
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
