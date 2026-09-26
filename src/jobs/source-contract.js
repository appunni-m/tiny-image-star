export const FOLDER_SOURCE_SCHEMA = "tinystar/folder-source@1";
const digestPattern = /^[a-f0-9]{64}$/;

export function assertSourceIdentity(value) {
  if (!value || Object.keys(value).sort().join(" ") !== "bytes lastModified schema sha256"
    || value.schema !== FOLDER_SOURCE_SCHEMA || !digestPattern.test(value.sha256)
    || !Number.isSafeInteger(value.bytes) || value.bytes < 0
    || !Number.isSafeInteger(value.lastModified) || value.lastModified < 0) {
    throw new Error("The saved source identity is invalid. Existing outputs are preserved.");
  }
  return value;
}

// A failed attempt may explicitly accept repaired bytes, but only before any
// output intent exists. Accepting a repair consumes that permission once.
export function bindSourceIdentity(entry, observed) {
  assertSourceIdentity(observed);
  if (entry.sourceIdentity != null) assertSourceIdentity(entry.sourceIdentity);
  if (entry.outputIntent && entry.outputIntent.sourceDigest !== observed.sha256) {
    throw new Error("The source changed after a save began. Keep the saved output and start a new folder job.");
  }
  if (!entry.allowSourceChange && (entry.sourceBytes !== observed.bytes || entry.lastModified !== observed.lastModified
    || entry.sourceIdentity && entry.sourceIdentity.sha256 !== observed.sha256)) {
    throw new Error("This source changed after it was checked. Check the image, then use Retry failed to accept the updated source.");
  }
  return { ...entry, sourceIdentity: { ...observed }, sourceBytes: observed.bytes,
    lastModified: observed.lastModified, allowSourceChange: false };
}

export function assertSourceDigest(entry, digest) {
  if (assertSourceIdentity(entry.sourceIdentity).sha256 !== digest) {
    throw new Error("This source changed after it was checked. Check the image, then use Retry failed to accept the updated source.");
  }
}
