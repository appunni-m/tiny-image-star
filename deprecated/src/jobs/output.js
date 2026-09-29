import { safeRelativeParts } from "./core.js";
import { commitManifestEntry, getClaimedEntry, getLargeJob, putOutputIntent } from "./store.js";
import { withJobWriteGate } from "./ownership.js";
import { assertFolderRecipe, folderRecipeDigest } from "./render-contract.js";
import { assertSourceDigest } from "./source-contract.js";

const OUTPUT_WRITE_CHUNK_BYTES = 4 * 1024 * 1024;
let exclusiveWritersVerified = false;

export async function digestBytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function destination(root, path) {
  const parts = safeRelativeParts(path);
  if (!parts.length || parts.join("/") !== path) throw new Error("Invalid output path.");
  const name = parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  return { directory, name };
}

async function existingFile(directory, name) {
  try { return await directory.getFileHandle(name); }
  catch (error) { if (error.name === "NotFoundError") return null; throw error; }
}

async function exclusiveWriter(handle) {
  const writable = await handle.createWritable({ mode: "exclusive" });
  if (!exclusiveWritersVerified) {
    // WebIDL ignores unknown options. Probe the actual exclusion behavior
    // before trusting it; an older browser must not silently use siloed writes.
    let second;
    try { second = await handle.createWritable({ mode: "exclusive" }); }
    catch (error) {
      if (error.name === "NoModificationAllowedError") exclusiveWritersVerified = true;
      else { await writable.abort().catch(() => {}); throw error; }
    }
    if (second) {
      await second.abort().catch(() => {});
      await writable.abort().catch(() => {});
      throw new Error("This browser cannot lock saved files safely. Update your browser before using folder jobs.");
    }
  }
  return writable;
}

// The intent survives a worker dying between file close and IndexedDB commit.
// A retry verifies saved bytes and commits once, without rewriting the file.
// Existing unrelated files and changed journaled outputs are never replaced.
export async function saveJournaledOutput({ jobId, entry, owner, outputRoot, outputPath, result, sourceDigest, renderDigest = null }) {
  const digest = await digestBytes(result.bytes);
  return withJobWriteGate(jobId, async () => {
    const current = await getClaimedEntry(jobId, entry.index, entry.claimId, owner);
    if (renderDigest !== null) {
      assertSourceDigest(current, sourceDigest);
      const job = await getLargeJob(jobId);
      await assertFolderRecipe(job);
      if (!job.renderContract.recipeSha256 || await folderRecipeDigest(job.renderContract) !== renderDigest) throw new Error("The folder rendering contract changed before saving. Existing outputs have been preserved.");
    }
    if (current.status === "completed") return { entry: current, recovered: true };
    if (current.status !== "processing") throw new Error("This image is no longer processing.");
    let intent = current.outputIntent;
    const hadIntent = Boolean(intent);
    if (intent && (intent.sourceDigest !== sourceDigest || intent.digest !== digest || intent.path !== outputPath || (intent.renderDigest ?? null) !== renderDigest)) {
      throw new Error("The source or recipe changed after a save began. Keep the saved output and start a new folder job.");
    }
    const { directory, name } = await destination(outputRoot, outputPath);
    let handle = await existingFile(directory, name);
    if (!intent) {
      if (handle) throw new Error(`A file already exists at ${outputPath}. It has not been replaced. Start a new job with an empty destination.`);
      intent = { version: 1, path: outputPath, digest, sourceDigest, renderDigest, bytes: result.bytes.byteLength,
        width: result.width, height: result.height, format: result.format, outputHandle: null };
      await putOutputIntent(jobId, entry.index, entry.claimId, intent, owner);
    }
    const complete = async (recovered) => {
      const committed = await commitManifestEntry(jobId, entry.index, entry.claimId, {
        status: "completed", outputPath: intent.path, outputDigest: intent.digest, outputBytes: intent.bytes,
        width: intent.width, height: intent.height, format: intent.format, error: null,
        ...(result.warnings ? {warnings:result.warnings} : {}),
      }, owner);
      return { ...committed, recovered };
    };
    if (handle) {
      const file = await handle.getFile();
      if (hadIntent && file.size === intent.bytes && await digestBytes(await file.arrayBuffer()) === intent.digest) return complete(true);
      const ownsEmptyFile = !file.size && intent.outputHandle && await handle.isSameEntry(intent.outputHandle);
      if (!ownsEmptyFile) throw new Error(`The file at ${outputPath} differs from the saved journal. It has not been replaced.`);
    } else {
      // There is no atomic create-if-absent FSA API. The job owns a dedicated
      // destination and the write gate serializes handoff. External filesystem
      // edits still require the post-open check below; they are not Web Locks.
      handle = await directory.getFileHandle(name, { create: true });
      intent = { ...intent, outputHandle: handle };
      await putOutputIntent(jobId, entry.index, entry.claimId, intent, owner);
    }
    const writable = await exclusiveWriter(handle);
    try {
      await getClaimedEntry(jobId, entry.index, entry.claimId, owner);
      if ((await handle.getFile()).size !== 0) throw new Error("The output changed before saving. It has not been replaced.");
      for (let offset = 0; offset < result.bytes.byteLength; offset += OUTPUT_WRITE_CHUNK_BYTES) {
        await writable.write(result.bytes.subarray(offset, Math.min(result.bytes.byteLength, offset + OUTPUT_WRITE_CHUNK_BYTES)));
      }
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    return complete(false);
  });
}
