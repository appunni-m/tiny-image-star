import { getLargeJob, getManifestPage, readStagedSceneOutput } from "./store.js";
import { digestBytes } from "./output.js";
import { getProcessingScheduler } from "../processing/client.js";
import { EXPORT_GROUP_BYTES, EXPORT_GROUP_FILES } from "./staging-plan.js";

const aborted = signal => { if (signal?.aborted) throw new DOMException("File preparation cancelled.", "AbortError"); };

export async function prepareStagedFiles(jobId, start = 0, { signal, pool = getProcessingScheduler() } = {}) {
  const job = await getLargeJob(jobId);
  if (job?.outputMode !== "browser" || !Number.isSafeInteger(start) || start < 0) throw new Error("Choose a staged story batch.");
  const selected = []; let total = 0, cursor = start, finished = false;
  while (cursor < job.discovered && !finished) {
    aborted(signal);
    const rows = await getManifestPage(jobId, cursor, 64);
    if (!rows.length) break;
    for (const row of rows) {
      if (row.status === "completed") {
        if (selected.length && (selected.length === EXPORT_GROUP_FILES || total + row.outputBytes > EXPORT_GROUP_BYTES)) { finished = true; break; }
        if (!Number.isSafeInteger(row.outputBytes) || row.outputBytes < 1) throw new Error("Invalid staged file size.");
        selected.push(row); total += row.outputBytes;
      }
      cursor = row.index + 1;
    }
  }
  if (!selected.length) throw new Error("No ready files from this point. Prepare from the beginning after retrying pending outputs.");
  const owner = `staged-export:${crypto.randomUUID()}`, files = [], urls = [];
  // Blob/File references, a digest buffer and temporary hashing overlap are
  // covered before fetching the first stored Blob.
  await pool.reserveRetainedBytes(owner, total * 4 + 1024 * 1024, { signal });
  try {
    for (const expected of selected) {
      aborted(signal);
      const { entry, record } = await readStagedSceneOutput(jobId, expected.index);
      if (!record || !(record.blob instanceof Blob) || record.blob.size !== expected.outputBytes
        || record.digest !== expected.outputDigest || entry.outputDigest !== expected.outputDigest) throw new Error("A staged file is missing or changed. Its batch receipt has been preserved.");
      const bytes = await record.blob.arrayBuffer();
      if (await digestBytes(bytes) !== expected.outputDigest) throw new Error("A staged file is missing or changed. Its batch receipt has been preserved.");
      aborted(signal);
      // Own these verified bytes: some engines invalidate an IDB-backed Blob
      // after its record is removed, even while a share sheet retains it.
      const file = new File([bytes], entry.outputPath.replaceAll("/", "-"), { type: entry.format === "jpeg" ? "image/jpeg" : "image/png" });
      files.push(file); urls.push(URL.createObjectURL(file));
    }
    pool.setRetainedBytes(owner, total * 2);
    let references = 1, disposed = false;
    const release = () => { if (--references === 0) { pool.setRetainedBytes(owner, 0); pool.releaseIdle(); } };
    return { files, urls, indices: selected.map(row => row.index), next: cursor, hasMore: cursor < job.discovered,
      retain: () => { if (disposed) throw new Error("These files are no longer prepared."); references++; let released = false; return () => { if (!released) { released = true; release(); } }; },
      dispose: () => { if (disposed) return; disposed = true; urls.forEach(url => URL.revokeObjectURL(url)); release(); } };
  } catch (error) { urls.forEach(url => URL.revokeObjectURL(url)); pool.setRetainedBytes(owner, 0); throw error; }
}
