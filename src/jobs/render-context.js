import { readFontRecord } from "../editor/fonts.js";
import { textFontRequirements, verifyFontRecord, MAX_TEXT_FONT_BYTES, textError } from "../compositor/fonts.js";
import { normalizeFormat } from "../formats.js";
import { outputFormatForJob, settingsForLargeJob } from "./core.js";
import { assertFolderRecipe, folderJobDigest, folderRecipeDigest } from "./render-contract.js";
import { getLargeJob, getClaimedEntry, freezeLargeJob, readLargeJobFont } from "./store.js";
import { withJobSnapshotGate } from "./ownership.js";

export async function folderRenderJob(message) {
  return (await folderRenderRequest(message)).job;
}

export async function folderRenderRequest(message) {
  const job = await getLargeJob(message.jobId);
  await assertFolderRecipe(job, message.recipe);
  if (message.format != null && normalizeFormat(message.format) !== outputFormatForJob(job)) throw new Error("The queued output format no longer matches this folder job.");
  const entry = await getClaimedEntry(message.jobId, message.entry.index, message.entry.claimId, message.owner);
  if (entry.status !== "processing") throw new Error("This image is no longer processing.");
  return { job, entry };
}

// Only called inside an admitted full-render task. The existing text estimate
// reserves eight times the bounded font bytes for reads, hashes, storage copies
// and rasterization; metadata inspection never reads the font snapshots.
export async function folderRenderContext(message, job) {
  const settings = settingsForLargeJob(job.recipe, outputFormatForJob(job));
  const requirements = textFontRequirements(settings.textLayers).required;
  if (job.renderContract.recipeSha256 === null) {
    job = await withJobSnapshotGate(job.id, async () => {
      const current = await folderRenderJob(message);
      // Another admitted task may have committed while this one waited. The
      // library can now be gone; use the committed job-owned snapshot instead.
      if (current.renderContract.recipeSha256 !== null) return current;
      let records = [], bytes = 0;
      for (const requirement of requirements.values()) {
        const record = await verifyFontRecord(await readFontRecord(requirement.id), requirement);
        bytes += record.bytes.byteLength;
        if (bytes > MAX_TEXT_FONT_BYTES) throw textError("The fonts in this job exceed the 32 MiB font limit.", "font-limit");
        records.push(record);
      }
      const contract = { ...current.renderContract, recipeSha256: await folderJobDigest(current),
        fonts: records.map(record => ({ id: record.id, sha256: record.sha256, byteLength: record.bytes.byteLength })).sort((a,b) => a.id.localeCompare(b.id)) };
      const frozen = await freezeLargeJob(current.id, current.recipe, contract, records, message.owner, outputFormatForJob(current));
      records = null;
      return frozen;
    });
  }
  await assertFolderRecipe(job, message.recipe);
  if (job.renderContract.fonts.length !== requirements.size) throw textError("This job's saved fonts no longer match its recipe. Its outputs are preserved.", "font-integrity");
  const fontRecords = await readFolderFontRecords(job);
  return { settings, fontRecords, renderDigest: await folderRecipeDigest(job.renderContract) };
}

// Sample previews read the same pinned font bytes when a job has started.
// Before that, they validate library bytes without freezing an editable recipe.
export async function readFolderFontRecords(job, { allowLibrary = false } = {}) {
  await assertFolderRecipe(job);
  const requirements = textFontRequirements(settingsForLargeJob(job.recipe, outputFormatForJob(job)).textLayers).required;
  if (job.renderContract.recipeSha256 === null) {
    if (!allowLibrary) throw textError("This job's font snapshot is not ready.", "font-missing");
    const records = []; let bytes = 0;
    for (const requirement of requirements.values()) {
      const stored = await readFontRecord(requirement.id);
      // Match the eventual byte-only job snapshot. Library FontFace metadata
      // is not part of the frozen rendering contract and cannot affect preview.
      const record = await verifyFontRecord(stored && { id: stored.id, sha256: stored.sha256, bytes: stored.bytes }, requirement);
      bytes += record.bytes.byteLength;
      if (bytes > MAX_TEXT_FONT_BYTES) throw textError("The fonts in this job exceed the 32 MiB font limit.", "font-limit");
      records.push(record);
    }
    return records;
  }
  if (job.renderContract.fonts.length !== requirements.size) throw textError("This job's saved fonts no longer match its recipe.", "font-integrity");
  const fontRecords = [];
  for (const requirement of requirements.values()) {
    const reference = job.renderContract.fonts.find(font => font.id === requirement.id);
    if (!reference) throw textError("A font snapshot for this folder job is missing. Start a new job after adding the font again.", "font-missing");
    const stored = await readLargeJobFont(job.id, reference.id);
    if (!(stored?.bytes instanceof Blob) || stored.bytes.size !== reference.byteLength) throw textError("A font snapshot for this folder job is missing or damaged. Start a new job after adding the font again.", "font-integrity");
    // Only byte identity is frozen in this contract. In particular, unbound
    // stored FontFace descriptors must not influence CSS font matching.
    const record = await verifyFontRecord({ id: stored.id, sha256: stored.sha256, bytes: await stored.bytes.arrayBuffer() },
      { ...requirement, sha256: reference.sha256, bytes: reference.byteLength });
    if (requirement.sha256 && record.sha256 !== requirement.sha256 || record.bytes.byteLength !== reference.byteLength) throw textError("A folder font snapshot failed its integrity check.", "font-integrity");
    fontRecords.push(record);
  }
  return fontRecords;
}
