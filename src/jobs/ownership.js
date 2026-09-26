import { beginJobOwnership } from "./store.js";

export const writeGateName = (jobId) => `tiny-image-star:folder-write:${jobId}`;
const ownerLockName = (jobId) => `tiny-image-star:folder-owner:${jobId}`;

export function jobLocksAvailable() { return typeof globalThis.navigator?.locks?.request === "function"; }

// No timeout/lease stealing: a suspended owner is still an owner. The browser
// releases locks when its context dies. The write gate also waits for workers
// belonging to that context before advancing the durable fencing epoch.
export function acquireJobOwnership(jobId) {
  if (!jobLocksAvailable()) return Promise.reject(new Error("Safe folder recovery requires a browser with Web Locks."));
  return new Promise((resolve, reject) => {
    let release;
    const held = new Promise((done) => { release = done; });
    const task = navigator.locks.request(ownerLockName(jobId), { ifAvailable: true }, async (lock) => {
      if (!lock) { resolve(null); return; }
      const acquired = await navigator.locks.request(writeGateName(jobId), () => beginJobOwnership(jobId, crypto.randomUUID()));
      let released = false;
      resolve({ ...acquired, jobId, release: async () => {
        if (!released) { released = true; release(); }
        await task;
      } });
      await held;
    });
    task.catch(reject);
  });
}

export function withJobWriteGate(jobId, callback) {
  if (!jobLocksAvailable()) throw new Error("Safe folder saving requires Web Locks.");
  return navigator.locks.request(writeGateName(jobId), { mode: "shared" }, callback);
}

// Capture the first immutable recipe/font snapshot once. Later rendering does
// not hold this lock, and ordinary output writes continue to share the gate.
export function withJobSnapshotGate(jobId, callback) {
  if (!jobLocksAvailable()) throw new Error("Safe folder saving requires Web Locks.");
  return navigator.locks.request(writeGateName(jobId), { mode: "exclusive" }, callback);
}
