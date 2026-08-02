const DB_NAME = "tiny-image-star.large-jobs";
const DB_VERSION = 1;
const JOB_STORE = "jobs";
const ENTRY_STORE = "entries";

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("Local job storage failed.")), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("Local job storage was interrupted.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Local job storage failed.")), { once: true });
  });
}

export function largeJobStorageAvailable() {
  return typeof globalThis.indexedDB !== "undefined" && typeof globalThis.IDBKeyRange !== "undefined";
}

export function openLargeJobDatabase() {
  if (!largeJobStorageAvailable()) return Promise.reject(new Error("Local job recovery is unavailable in this browser."));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(JOB_STORE)) database.createObjectStore(JOB_STORE, { keyPath: "id" });
        if (!database.objectStoreNames.contains(ENTRY_STORE)) {
          const entries = database.createObjectStore(ENTRY_STORE, { keyPath: ["jobId", "index"] });
          entries.createIndex("by_job_status", ["jobId", "status"], { unique: false });
        }
      });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error ?? new Error("Local job storage could not start.")), { once: true });
    });
  }
  return databasePromise;
}

export async function putLargeJob(job) {
  const database = await openLargeJobDatabase();
  const transaction = database.transaction(JOB_STORE, "readwrite");
  transaction.objectStore(JOB_STORE).put(job);
  await transactionDone(transaction);
  return job;
}

export async function getLargeJob(jobId) {
  const database = await openLargeJobDatabase();
  const transaction = database.transaction(JOB_STORE, "readonly");
  const result = await requestResult(transaction.objectStore(JOB_STORE).get(jobId));
  await transactionDone(transaction);
  return result ?? null;
}

export async function listLargeJobs() {
  const database = await openLargeJobDatabase();
  const transaction = database.transaction(JOB_STORE, "readonly");
  const jobs = await requestResult(transaction.objectStore(JOB_STORE).getAll());
  await transactionDone(transaction);
  return jobs.sort((left, right) => Number(right.updatedAt) - Number(left.updatedAt));
}

export async function putManifestEntries(entries) {
  if (!entries.length) return;
  const database = await openLargeJobDatabase();
  const transaction = database.transaction(ENTRY_STORE, "readwrite");
  const store = transaction.objectStore(ENTRY_STORE);
  for (const entry of entries) store.put(entry);
  await transactionDone(transaction);
}

export async function getManifestPage(jobId, start, count) {
  if (count <= 0) return [];
  const database = await openLargeJobDatabase();
  const transaction = database.transaction(ENTRY_STORE, "readonly");
  const store = transaction.objectStore(ENTRY_STORE);
  const range = IDBKeyRange.bound([jobId, Math.max(0, start)], [jobId, Math.max(0, start + count - 1)]);
  const entries = await requestResult(store.getAll(range));
  await transactionDone(transaction);
  return entries;
}

export async function claimPendingEntries(jobId, count) {
  if (count <= 0) return [];
  const database = await openLargeJobDatabase();
  const transaction = database.transaction(ENTRY_STORE, "readwrite");
  const index = transaction.objectStore(ENTRY_STORE).index("by_job_status");
  const request = index.openCursor(IDBKeyRange.only([jobId, "pending"]));
  const claimed = [];
  await new Promise((resolve, reject) => {
    request.addEventListener("error", () => reject(request.error ?? new Error("Pending work could not be read.")), { once: true });
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor || claimed.length >= count) {
        resolve();
        return;
      }
      const entry = { ...cursor.value, status: "processing", attempts: Number(cursor.value.attempts ?? 0) + 1, error: null };
      cursor.update(entry);
      claimed.push(entry);
      cursor.continue();
    });
  });
  await transactionDone(transaction);
  return claimed;
}

export async function commitManifestEntry(jobId, index, entryPatch, jobPatch) {
  const database = await openLargeJobDatabase();
  const transaction = database.transaction([ENTRY_STORE, JOB_STORE], "readwrite");
  const entries = transaction.objectStore(ENTRY_STORE);
  const jobs = transaction.objectStore(JOB_STORE);
  const entry = await requestResult(entries.get([jobId, index]));
  const job = await requestResult(jobs.get(jobId));
  if (!entry || !job) {
    transaction.abort();
    throw new Error("The saved folder job is incomplete.");
  }
  const nextEntry = { ...entry, ...entryPatch };
  const {
    completedDelta = 0,
    failedDelta = 0,
    outputBytesDelta = 0,
    ...jobValues
  } = jobPatch;
  const nextJob = {
    ...job,
    ...jobValues,
    completed: Number(job.completed ?? 0) + Number(completedDelta),
    failed: Number(job.failed ?? 0) + Number(failedDelta),
    outputBytes: Number(job.outputBytes ?? 0) + Number(outputBytesDelta),
    updatedAt: Date.now(),
  };
  entries.put(nextEntry);
  jobs.put(nextJob);
  await transactionDone(transaction);
  return { entry: nextEntry, job: nextJob };
}

async function resetStatus(jobId, fromStatus, toStatus) {
  const database = await openLargeJobDatabase();
  const transaction = database.transaction(ENTRY_STORE, "readwrite");
  const index = transaction.objectStore(ENTRY_STORE).index("by_job_status");
  const request = index.openCursor(IDBKeyRange.only([jobId, fromStatus]));
  let changed = 0;
  await new Promise((resolve, reject) => {
    request.addEventListener("error", () => reject(request.error ?? new Error("Saved work could not be reset.")), { once: true });
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.update({ ...cursor.value, status: toStatus, error: null });
      changed += 1;
      cursor.continue();
    });
  });
  await transactionDone(transaction);
  return changed;
}

export function resetInterruptedEntries(jobId) {
  return resetStatus(jobId, "processing", "pending");
}

export function retryFailedEntries(jobId) {
  return resetStatus(jobId, "failed", "pending");
}

export async function clearManifestEntries(jobId) {
  const database = await openLargeJobDatabase();
  const transaction = database.transaction(ENTRY_STORE, "readwrite");
  transaction.objectStore(ENTRY_STORE).delete(IDBKeyRange.bound([jobId, 0], [jobId, Number.MAX_SAFE_INTEGER]));
  await transactionDone(transaction);
}

export async function deleteLargeJob(jobId) {
  const database = await openLargeJobDatabase();
  const transaction = database.transaction([ENTRY_STORE, JOB_STORE], "readwrite");
  transaction.objectStore(JOB_STORE).delete(jobId);
  transaction.objectStore(ENTRY_STORE).delete(IDBKeyRange.bound([jobId, 0], [jobId, Number.MAX_SAFE_INTEGER]));
  await transactionDone(transaction);
}
