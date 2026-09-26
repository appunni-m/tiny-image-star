const MiB = 1024 * 1024;
export const STAGING_SCHEMA = "tinystar/scene-staging@1";
export const MAX_STAGING_BYTES = 2048 * MiB;
export const STORAGE_HEADROOM = 16 * MiB;
export const EXPORT_GROUP_FILES = 8;
export const EXPORT_GROUP_BYTES = 32 * MiB;
const bytes = value => Number.isSafeInteger(value) && value >= 0;

// A conservative encoded-size allowance, not a measured file-size prediction.
export function stagedOutputAllowance(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error("Invalid staged output dimensions.");
  const size = width * height * 8 + MiB;
  if (!Number.isSafeInteger(size) || size > MAX_STAGING_BYTES) throw new Error("This output is too large for browser staging. Choose smaller dimensions or a save folder.");
  return size;
}

export function stagedGroupPlan(group) {
  const outputs = group.items.map(item => {
    const shape = group.project.variants.find(shape => shape.id === item.variantId);
    return stagedOutputAllowance(shape?.width, shape?.height);
  });
  return { sha256: group.sha256, sourceBytes: Object.values(group.project.assets).reduce((sum, asset) => sum + asset.byteLength, 0),
    metadataBytes: group.byteLength * 2 + outputs.length * 4096, outputBytes: outputs.reduce((sum, size) => sum + size, 0), count: outputs.length };
}

export function stagingPlan(groups) {
  if (!Array.isArray(groups) || !groups.length || groups.length > 1000) throw new Error("Invalid browser staging plan.");
  for (const group of groups) if (Object.keys(group).sort().join() !== "count,metadataBytes,outputBytes,sha256,sourceBytes"
    || !/^[a-f0-9]{64}$/.test(group.sha256) || ![group.sourceBytes, group.metadataBytes, group.outputBytes, group.count].every(bytes)
    || group.count < 1 || group.count > 80 || !group.outputBytes) throw new Error("Invalid browser staging group.");
  const totalBytes = groups.reduce((sum, group) => sum + group.sourceBytes + group.metadataBytes + group.outputBytes, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_STAGING_BYTES) throw new Error("This batch needs more than 2 GiB of staging allowance. Select fewer stories or use a save folder.");
  return { schema: STAGING_SCHEMA, groups: structuredClone(groups), totalBytes };
}

export function remainingStagingBytes(job) {
  if (job.outputMode !== "browser" || !job.staging) return 0;
  const plan = stagingPlan(job.staging.groups);
  if (plan.schema !== job.staging.schema || plan.totalBytes !== job.staging.totalBytes) throw new Error("The saved browser staging plan changed.");
  // Stored bytes are included in StorageManager.estimate(); committed work
  // releases its full allowance, including compression headroom.
  const spent = job.stagingSpent ?? 0;
  if (!bytes(spent) || spent > plan.totalBytes) throw new Error("Invalid browser storage reservation.");
  return plan.totalBytes - spent;
}

export function assertStagingCapacity(estimate, reservedBytes) {
  if (!estimate || !Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage) || estimate.quota <= 0 || estimate.usage < 0
    || !bytes(reservedBytes)) throw new Error("This browser cannot estimate available storage. Use a save folder or export an individual story.");
  if (estimate.quota - estimate.usage < reservedBytes + STORAGE_HEADROOM) throw Object.assign(new Error("Not enough browser storage for this batch and other pending batches. Free space or forget a batch, then retry. Completed files are preserved."), {code:"STORAGE_FULL"});
}
