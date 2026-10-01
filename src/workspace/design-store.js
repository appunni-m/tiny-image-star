import { parseDocument, serializeDocument } from '../model.js';
import { WorkspaceStoreError } from './workspace-store.js';

export const DESIGN_STORE_FORMAT_VERSION = 1;
export const MAX_DESIGN_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const MAX_DESIGN_COMMITS = 4_096;
export const MAX_DESIGN_HISTORY_BYTES = 512 * 1024 * 1024;

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ASSET_HASH = /^[a-f0-9]{64}$/;
const MAX_IMAGE_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_ASSET_METADATA_BYTES = 4 * 1024;
const encoder = new TextEncoder();

function fail(code, message, cause) { throw new WorkspaceStoreError(code, message, cause); }
function notFound(error) { return error?.name === 'NotFoundError'; }
function assertId(value, label) {
  if (typeof value !== 'string' || !ID.test(value) || value === '.' || value === '..') fail('INVALID_ID', `Invalid ${label}.`);
  return value;
}
function assertWorkspace(workspace, locks) {
  if (!workspace?.workspaceId || typeof workspace.getDesignDirectoryHandle !== 'function'
    || typeof workspace.designsDirectory?.getDirectoryHandle !== 'function') fail('INVALID_WORKSPACE', 'A verified workspace is required.');
  if (typeof locks?.request !== 'function') fail('CROSS_TAB_LOCK_UNSUPPORTED', 'This browser cannot safely serialize design writes across tabs.');
}
function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}
async function hashJson(value, crypto) {
  if (typeof crypto?.subtle?.digest !== 'function') fail('CRYPTO_UNAVAILABLE', 'Cryptographic hashing is unavailable in this browser.');
  const bytes = encoder.encode(stableJson(value));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function readJson(directory, name, maxBytes, missingCode, invalidCode) {
  let handle;
  try { handle = await directory.getFileHandle(name, { create: false }); }
  catch (error) {
    if (notFound(error) && missingCode) fail(missingCode, `${name} is missing.`, error);
    if (notFound(error)) fail(invalidCode, `${name} is missing.`, error);
    fail(`${invalidCode}_READ_FAILED`, `Could not open ${name}.`, error);
  }
  try {
    const file = await handle.getFile();
    if (!Number.isSafeInteger(file.size) || file.size > maxBytes) fail('SNAPSHOT_TOO_LARGE', `${name} exceeds its size limit.`);
    const text = await file.text();
    if (encoder.encode(text).byteLength > maxBytes) fail('SNAPSHOT_TOO_LARGE', `${name} exceeds its size limit.`);
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail(invalidCode, `${name} is corrupt or unreadable.`, error);
  }
}
async function writeImmutableJson(directory, name, value, maxBytes) {
  const text = stableJson(value);
  if (encoder.encode(text).byteLength > maxBytes) fail('SNAPSHOT_TOO_LARGE', 'The design snapshot exceeds its safety limit.');
  let handle;
  try {
    handle = await directory.getFileHandle(name, { create: false });
    const existing = await handle.getFile();
    if (!Number.isSafeInteger(existing.size) || existing.size > maxBytes) {
      fail('IMMUTABLE_RECORD_TOO_LARGE', 'An existing immutable design record exceeds its safety limit.');
    }
    const existingText = await existing.text();
    if (existingText !== text) fail('IMMUTABLE_COMMIT_COLLISION', 'An existing immutable design record has different contents.');
    return;
  } catch (error) {
    if (!(notFound(error))) {
      if (error instanceof WorkspaceStoreError) throw error;
      fail('COMMIT_WRITE_FAILED', 'Could not check for an existing immutable design commit.', error);
    }
  }
  try { handle = await directory.getFileHandle(name, { create: true }); }
  catch (error) { fail('COMMIT_WRITE_FAILED', 'Could not create an immutable design commit.', error); }
  let writable;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(text);
    await writable.close();
  } catch (error) {
    try { await writable?.abort?.(); } catch {}
    try { await directory.removeEntry?.(name); } catch {}
    fail('COMMIT_WRITE_FAILED', 'Could not close the immutable design commit.', error);
  }
  // A closed write is not acknowledged until the contents can be reopened and verified.
  const reopened = await readJson(directory, name, maxBytes, null, 'COMMIT_VERIFY_FAILED');
  if (stableJson(reopened) !== text) {
    try { await directory.removeEntry?.(name); } catch {}
    fail('COMMIT_VERIFY_FAILED', 'The closed design commit did not reopen byte-for-byte.');
  }
}
async function writeHead(directory, head) {
  let handle;
  try { handle = await directory.getFileHandle('HEAD.json', { create: true }); }
  catch (error) { fail('HEAD_WRITE_FAILED', 'Could not create the recoverable design head.', error); }
  let writable;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(stableJson(head));
    await writable.close();
  } catch (error) {
    try { await writable?.abort?.(); } catch {}
    fail('HEAD_WRITE_FAILED', 'Could not update the recoverable design head.', error);
  }
  const verified = await readJson(directory, 'HEAD.json', 4096, null, 'HEAD_VERIFY_FAILED');
  if (stableJson(verified) !== stableJson(head)) fail('HEAD_VERIFY_FAILED', 'The recovered design head did not reopen correctly.');
}
async function writePending(directory, pending) {
  await writeHeadNamed(directory, 'PENDING.json', pending, 'PENDING_WRITE_FAILED', 'PENDING_VERIFY_FAILED');
}
async function writeHeadNamed(directory, name, value, writeCode, verifyCode) {
  let handle;
  try { handle = await directory.getFileHandle(name, { create: true }); }
  catch (error) { fail(writeCode, `Could not create ${name}.`, error); }
  let writable;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(stableJson(value));
    await writable.close();
  } catch (error) {
    try { await writable?.abort?.(); } catch {}
    fail(writeCode, `Could not update ${name}.`, error);
  }
  const reopened = await readJson(directory, name, 4096, null, verifyCode);
  if (stableJson(reopened) !== stableJson(value)) fail(verifyCode, `${name} did not reopen correctly.`);
}
async function readPending(metadata) {
  try { return await readJson(metadata, 'PENDING.json', 4096, 'PENDING_MISSING', 'PENDING_INVALID'); }
  catch (error) {
    if (error.code === 'PENDING_MISSING') return null;
    throw error;
  }
}
async function clearPending(metadata) {
  try { await metadata.removeEntry('PENDING.json'); }
  catch (error) { if (!notFound(error)) throw error; }
}
function assertHead(head, designId) {
  if (!head || head.formatVersion !== DESIGN_STORE_FORMAT_VERSION || head.designId !== designId
    || !HASH.test(head.commitHash) || !Number.isSafeInteger(head.sequence) || head.sequence < 1) {
    fail('HEAD_INVALID', 'The design HEAD is invalid.');
  }
  return head;
}
async function listCommitFiles(directory) {
  if (typeof directory.values !== 'function') fail('RECOVERY_UNSUPPORTED', 'This browser cannot safely inspect commit history for recovery.');
  const files = [];
  let totalBytes = 0;
  try {
    for await (const handle of directory.values()) {
      if (handle.kind !== 'file' || !/^[a-f0-9]{64}\.json$/.test(handle.name)) continue;
      const file = await handle.getFile();
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_DESIGN_SNAPSHOT_BYTES + 16_384) {
        fail('COMMIT_TOO_LARGE', `Commit ${handle.name} exceeds its safety limit.`);
      }
      totalBytes += file.size;
      if (files.length >= MAX_DESIGN_COMMITS || totalBytes > MAX_DESIGN_HISTORY_BYTES) {
        fail('RECOVERY_LIMIT', 'Design history exceeds its commit-count or aggregate byte limit.');
      }
      files.push({ name: handle.name, size: file.size });
    }
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    fail('RECOVERY_FAILED', 'Could not inspect design commit history.', error);
  }
  return files;
}

async function assertHistoryCapacity(commitsDirectory, record) {
  const files = await listCommitFiles(commitsDirectory);
  const currentBytes = files.reduce((total, file) => total + file.size, 0);
  const nextBytes = encoder.encode(stableJson(record)).byteLength;
  if (files.length + 1 > MAX_DESIGN_COMMITS || currentBytes + nextBytes > MAX_DESIGN_HISTORY_BYTES) {
    fail('DESIGN_HISTORY_LIMIT', 'The next commit would exceed the design history recovery limit.');
  }
}

async function scanCommits(commitsDirectory, designId, crypto) {
  const byHash = new Map();
  for (const { name } of await listCommitFiles(commitsDirectory)) {
    const hash = name.slice(0, -5);
    const record = await readJson(commitsDirectory, name, MAX_DESIGN_SNAPSHOT_BYTES + 16_384, null, 'COMMIT_CORRUPT');
    if (!record || record.formatVersion !== DESIGN_STORE_FORMAT_VERSION || record.designId !== designId
      || record.hash !== hash || !Number.isSafeInteger(record.sequence) || record.sequence < 1
      || typeof record.pageId !== 'string' || !ID.test(record.pageId)
      || !(record.previousHash === null || HASH.test(record.previousHash))
      || typeof record.snapshot !== 'string' || encoder.encode(record.snapshot).byteLength > MAX_DESIGN_SNAPSHOT_BYTES
      || await hashJson({ formatVersion: record.formatVersion, designId: record.designId, sequence: record.sequence,
        previousHash: record.previousHash, pageId: record.pageId, snapshot: record.snapshot }, crypto) !== hash) {
      fail('COMMIT_CORRUPT', `Commit ${hash} failed integrity validation.`);
    }
    let document;
    try { document = parseDocument(record.snapshot); }
    catch (error) { fail('SNAPSHOT_INVALID', `Commit ${hash} contains an invalid design snapshot.`, error); }
    if (document.id !== designId || !document.pages.some(page => page.id === record.pageId)) fail('SNAPSHOT_INVALID', `Commit ${hash} does not match its design/page identity.`);
    byHash.set(hash, { hash, previousHash: record.previousHash, sequence: record.sequence, pageId: record.pageId });
  }
  const children = new Map();
  for (const record of byHash.values()) {
    if (record.previousHash != null && !byHash.has(record.previousHash)) fail('COMMIT_CHAIN_BROKEN', 'A committed snapshot references a missing predecessor.');
    if (record.previousHash == null && record.sequence !== 1) fail('COMMIT_CHAIN_BROKEN', 'A root commit has an invalid sequence number.');
    if (record.previousHash != null && byHash.get(record.previousHash).sequence + 1 !== record.sequence) {
      fail('COMMIT_CHAIN_BROKEN', 'A design commit sequence does not follow its predecessor.');
    }
    const key = record.previousHash ?? '';
    children.set(key, (children.get(key) || 0) + 1);
  }
  if ([...children.values()].some(count => count > 1)) fail('RECOVERY_AMBIGUOUS', 'The design has multiple committed branches; automatic recovery stopped to protect both histories.');
  const tips = [...byHash.keys()].filter(hash => !children.has(hash));
  if (tips.length > 1) fail('RECOVERY_AMBIGUOUS', 'The design has multiple committed branches; automatic recovery stopped to protect both histories.');
  if (byHash.size && tips.length !== 1) fail('COMMIT_CHAIN_BROKEN', 'The design commit chain cannot be recovered safely.');
  const tip = tips[0] ? byHash.get(tips[0]) : null;
  if (tip) {
    const visited = new Set(); let current = tip;
    while (current) {
      if (visited.has(current.hash)) fail('COMMIT_CHAIN_BROKEN', 'The design commit chain contains a cycle.');
      visited.add(current.hash);
      current = current.previousHash ? byHash.get(current.previousHash) : null;
    }
    if (visited.size !== byHash.size) fail('RECOVERY_AMBIGUOUS', 'The design contains disconnected commit history; automatic recovery stopped.');
  }
  return tip;
}

async function openDesignDirectories(workspace, designId, { create = false } = {}) {
  assertId(designId, 'design ID');
  let designDirectory;
  try { designDirectory = await workspace.getDesignDirectoryHandle(designId, { create }); }
  catch (error) { throw error; }
  const metadata = await designDirectory.getDirectoryHandle('.tiny-image-star', { create });
  const commits = await metadata.getDirectoryHandle('commits', { create });
  const pages = await designDirectory.getDirectoryHandle('pages', { create });
  return { designDirectory, metadata, commits, pages };
}

function collectImageAssetIds(document) {
  const result = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'assetId' || /imageAssetId$/i.test(key)) && typeof child === 'string' && child) result.add(child);
      visit(child);
    }
  };
  visit(document);
  return result;
}

function collectFontSpecs(document) {
  const result = new Map();
  const visited = new WeakSet();
  let visitedCount = 0;
  const normalizeFamily = value => value.trim().replace(/^(["'])(.*)\1$/u, '$2').trim()
    .replace(/\\(["'\\])/gu, '$1').replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
  const parseFamilyStack = value => {
    const parts = [];
    let current = '';
    let quote = '';
    let escaped = false;
    for (const character of value) {
      if (escaped) { current += character; escaped = false; continue; }
      if (character === '\\' && quote) { current += character; escaped = true; continue; }
      if ((character === '"' || character === "'") && (!quote || quote === character)) {
        quote = quote ? '' : character;
        current += character;
      } else if (character === ',' && !quote) {
        const family = normalizeFamily(current);
        if (family) parts.push(family);
        current = '';
      } else current += character;
    }
    const finalFamily = normalizeFamily(current);
    if (finalFamily) parts.push(finalFamily);
    return parts;
  };
  const visit = (value, inherited, depth) => {
    if (!value || typeof value !== 'object') return;
    if (depth > 128 || ++visitedCount > 1_000_000) fail('REFERENCE_SCAN_LIMIT', 'The design has too many nested records to scan safely.');
    if (visited.has(value)) return;
    visited.add(value);
    const font = { ...inherited };
    if (typeof value.fontFamily === 'string' && value.fontFamily.trim()) font.family = value.fontFamily;
    if (Object.hasOwn(value, 'fontWeight') && value.fontWeight != null) {
      const weight = typeof value.fontWeight === 'string' && /^\d+$/u.test(value.fontWeight) ? Number(value.fontWeight) : value.fontWeight;
      if (Number.isInteger(weight) && weight >= 1 && weight <= 1000) font.weight = weight;
    }
    if (Object.hasOwn(value, 'fontStyle') && value.fontStyle != null) font.style = value.fontStyle === 'italic' ? 'italic' : 'normal';
    if (font.family && (typeof value.fontFamily === 'string' || Object.hasOwn(value, 'fontWeight') || Object.hasOwn(value, 'fontStyle'))) {
      for (const family of parseFamilyStack(font.family)) {
        const spec = { family, weight: font.weight ?? 400, style: font.style ?? 'normal' };
        result.set(`${spec.family}\u0000${spec.weight}\u0000${spec.style}`, spec);
      }
    }
    for (const child of Object.values(value)) visit(child, font, depth + 1);
  };
  visit(document, { weight: 400, style: 'normal' }, 0);
  return [...result.values()].sort((left, right) => left.family.localeCompare(right.family)
    || left.weight - right.weight || left.style.localeCompare(right.style));
}

/** Return image IDs and font faces referenced by one validated design snapshot. */
export function collectDesignAssetRequirements(document) {
  const validated = parseDocument(document);
  return Object.freeze({
    imageAssetIds: Object.freeze([...collectImageAssetIds(validated)].sort()),
    fontSpecs: Object.freeze(collectFontSpecs(validated).map(spec => Object.freeze(spec)))
  });
}

async function writePageRevisions(dirs, commit) {
  for (const page of commit.document.pages) {
    const pageId = assertId(page.id, 'page ID');
    const directory = await dirs.pages.getDirectoryHandle(pageId, { create: true });
    const revisions = await directory.getDirectoryHandle('revisions', { create: true });
    const record = { formatVersion: DESIGN_STORE_FORMAT_VERSION, designId: commit.designId,
      pageId, commitHash: commit.hash, page };
    await writeImmutableJson(revisions, `${commit.hash}.json`, record, MAX_DESIGN_SNAPSHOT_BYTES + 16_384);
  }
}

async function verifyPageRevisions(dirs, commit) {
  await writePageRevisions(dirs, commit);
  for (const page of commit.document.pages) {
    const revisions = await (await dirs.pages.getDirectoryHandle(page.id, { create: false })).getDirectoryHandle('revisions', { create: false });
    const stored = await readJson(revisions, `${commit.hash}.json`, MAX_DESIGN_SNAPSHOT_BYTES + 16_384, null, 'PAGE_SNAPSHOT_INVALID');
    if (!stored || stored.formatVersion !== DESIGN_STORE_FORMAT_VERSION || stored.designId !== commit.designId
      || stored.pageId !== page.id || stored.commitHash !== commit.hash || stableJson(stored.page) !== stableJson(page)) {
      fail('PAGE_SNAPSHOT_INVALID', `The materialized page ${page.id} does not match its committed design snapshot.`);
    }
  }
}

async function assertReferencedAssetsPresent(designDirectory, designId, document, crypto) {
  const assetIds = collectImageAssetIds(document);
  if (!assetIds.size) return;
  let assets;
  try { assets = await designDirectory.getDirectoryHandle('assets', { create: false }); }
  catch (error) { fail('ASSET_MISSING', 'The design references image assets that are not saved in its folder.', error); }
  let metadataDirectory;
  let blobsDirectory;
  try {
    [metadataDirectory, blobsDirectory] = await Promise.all([
      assets.getDirectoryHandle('metadata', { create: false }), assets.getDirectoryHandle('blobs', { create: false })
    ]);
  } catch (error) { fail('ASSET_MISSING', 'The design references image assets that are not saved in its folder.', error); }
  for (const assetId of assetIds) {
    if (!ASSET_ID.test(assetId) || assetId === '.' || assetId === '..') fail('ASSET_ID_INVALID', 'A design contains an image asset ID that cannot be stored safely.');
    const metadata = await readJson(metadataDirectory, `${assetId}.json`, MAX_ASSET_METADATA_BYTES, null, 'ASSET_METADATA_INVALID');
    if (!metadata || Object.keys(metadata).length !== 7 || metadata.formatVersion !== 1 || metadata.designId !== designId
      || metadata.assetId !== assetId || !ASSET_HASH.test(metadata.contentHash)
      || !Number.isSafeInteger(metadata.byteLength) || metadata.byteLength < 1 || metadata.byteLength > MAX_IMAGE_ASSET_BYTES
      || typeof metadata.mimeType !== 'string' || !/^image\/[a-z0-9][a-z0-9.+-]{0,63}$/i.test(metadata.mimeType)
      || !Number.isSafeInteger(metadata.createdAt) || metadata.createdAt < 0) {
      fail('ASSET_METADATA_INVALID', `Image asset ${assetId} has invalid metadata.`);
    }
    let blob;
    try { blob = await blobsDirectory.getFileHandle(metadata.contentHash, { create: false }); }
    catch (error) { fail('ASSET_MISSING', `Image asset ${assetId} is missing its source bytes.`, error); }
    let file;
    try { file = await blob.getFile(); }
    catch (error) { fail('ASSET_READ_FAILED', `Image asset ${assetId} cannot be reopened.`, error); }
    if (!Number.isSafeInteger(file.size) || file.size !== metadata.byteLength) fail('ASSET_CORRUPT', `Image asset ${assetId} does not match its saved byte length.`);
    let bytes;
    try { bytes = new Uint8Array(await file.arrayBuffer()); }
    catch (error) { fail('ASSET_READ_FAILED', `Image asset ${assetId} cannot be read for integrity verification.`, error); }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const contentHash = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
    if (contentHash !== metadata.contentHash) fail('ASSET_CORRUPT', `Image asset ${assetId} failed its content hash check.`);
  }
}

/** Creates a design using its existing safe document/page IDs and one durable initial snapshot. */
export async function createDesign(workspace, sourceDocument, { crypto = globalThis.crypto, locks = globalThis.navigator?.locks, now = Date.now() } = {}) {
  assertWorkspace(workspace, locks);
  if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_OPTIONS', 'Invalid design creation time.');
  const source = parseDocument(sourceDocument);
  const designId = assertId(source.id, 'design ID');
  const pageIds = source.pages.map(page => assertId(page.id, 'page ID'));
  if (new Set(pageIds).size !== pageIds.length) fail('INVALID_ID', 'Design page IDs must be unique.');
  const document = source;
  const initialCommit = await makeCommit(designId, null, 1, pageIds[0], document, crypto);
  const creationMarker = { formatVersion: DESIGN_STORE_FORMAT_VERSION, designId, createdAt: now,
    pageIds, initialCommitHash: initialCommit.hash };
  return locks.request(`tiny-image-star-design:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
    let designDirectory;
    let resuming = false;
    let storedCreation = creationMarker;
    try {
      designDirectory = await workspace.getDesignDirectoryHandle(designId, { create: false });
      let marker;
      try { marker = await readJson(designDirectory, 'CREATE.json', 16 * 1024, null, 'CREATE_MARKER_INVALID'); }
      catch (error) {
        if (error.code === 'CREATE_MARKER_INVALID') fail('DESIGN_CREATE_INCOMPLETE', 'This design folder has no valid creation marker. Existing data was left untouched.', error);
        throw error;
      }
      if (!marker || marker.formatVersion !== creationMarker.formatVersion || marker.designId !== designId
        || marker.initialCommitHash !== initialCommit.hash || stableJson(marker.pageIds) !== stableJson(pageIds)
        || !Number.isSafeInteger(marker.createdAt) || marker.createdAt < 0) {
        fail('DESIGN_EXISTS', 'A design with this ID already exists. Existing workspace data was not replaced.');
      }
      storedCreation = marker;
      resuming = true;
    } catch (error) {
      if (error instanceof WorkspaceStoreError && error.code === 'DESIGN_EXISTS') throw error;
      if (!(error instanceof WorkspaceStoreError) || error.code !== 'DESIGN_NOT_FOUND') throw error;
      designDirectory = await workspace.getDesignDirectoryHandle(designId, { create: true });
      // CREATE.json is the ownership proof for safely retrying partial initialization.
      await writeImmutableJson(designDirectory, 'CREATE.json', creationMarker, 16 * 1024);
    }
    const dirs = await openDesignDirectories(workspace, designId, { create: true });
    for (const pageId of pageIds) await dirs.pages.getDirectoryHandle(assertId(pageId, 'page ID'), { create: true });
    const identity = { formatVersion: DESIGN_STORE_FORMAT_VERSION, designId, createdAt: storedCreation.createdAt, pageIds };
    await writeImmutableJson(dirs.metadata, 'design.json', identity, 16 * 1024);
    const recordName = `${initialCommit.hash}.json`;
    if (resuming) {
      try { await readCommit(dirs.commits, initialCommit.hash, designId, crypto); }
      catch (error) {
        if (!['COMMIT_MISSING', 'COMMIT_CORRUPT', 'SNAPSHOT_INVALID', 'SNAPSHOT_TOO_LARGE'].includes(error.code)) throw error;
        try { await dirs.commits.removeEntry(recordName); } catch (removeError) { if (!notFound(removeError)) throw removeError; }
      }
    }
    await writeImmutableJson(dirs.commits, recordName, initialCommit.record, MAX_DESIGN_SNAPSHOT_BYTES + 16_384);
    const verified = await readCommit(dirs.commits, initialCommit.hash, designId, crypto);
    if (verified.document.id !== designId) fail('COMMIT_VERIFY_FAILED', 'The initial snapshot did not validate after reopening.');
    await verifyPageRevisions(dirs, verified);
    const head = { formatVersion: DESIGN_STORE_FORMAT_VERSION, designId, sequence: 1, commitHash: initialCommit.hash };
    await writeHead(dirs.metadata, head);
    return Object.freeze({ designId, pageIds: Object.freeze([...pageIds]), document: verified.document, head: Object.freeze(head) });
  });
}

async function makeCommit(designId, previousHash, sequence, pageId, document, crypto) {
  const snapshot = serializeDocument(parseDocument(document));
  if (encoder.encode(snapshot).byteLength > MAX_DESIGN_SNAPSHOT_BYTES) fail('SNAPSHOT_TOO_LARGE', 'The design snapshot exceeds its safety limit.');
  const payload = { formatVersion: DESIGN_STORE_FORMAT_VERSION, designId, sequence, previousHash, pageId, snapshot };
  const hash = await hashJson(payload, crypto);
  return { hash, record: { ...payload, hash } };
}

async function readCommit(commits, hash, designId, crypto) {
  if (!HASH.test(hash)) fail('HEAD_INVALID', 'The design HEAD contains an invalid commit hash.');
  const record = await readJson(commits, `${hash}.json`, MAX_DESIGN_SNAPSHOT_BYTES + 16_384, 'COMMIT_MISSING', 'COMMIT_CORRUPT');
  if (!record || record.hash !== hash || record.designId !== designId || record.formatVersion !== DESIGN_STORE_FORMAT_VERSION
    || await hashJson({ formatVersion: record.formatVersion, designId: record.designId, sequence: record.sequence,
      previousHash: record.previousHash, pageId: record.pageId, snapshot: record.snapshot }, crypto) !== hash) {
    fail('COMMIT_CORRUPT', 'The referenced design commit failed integrity validation.');
  }
  let document;
  try { document = parseDocument(record.snapshot); }
  catch (error) { fail('SNAPSHOT_INVALID', 'The design commit contains an invalid snapshot.', error); }
  if (document.id !== designId || !document.pages.some(page => page.id === record.pageId)) fail('SNAPSHOT_INVALID', 'The design snapshot identity is inconsistent.');
  return { ...record, document };
}

async function recoverHead(dirs, designId, identity, crypto, pending = null) {
  const tip = await scanCommits(dirs.commits, designId, crypto);
  if (!tip) fail('COMMIT_MISSING', 'The design has no durable snapshot.');
  const tipRecord = await readCommit(dirs.commits, tip.hash, designId, crypto);
  if (pending) {
    if (!pending || pending.formatVersion !== DESIGN_STORE_FORMAT_VERSION || pending.designId !== designId
      || !pending.baseHead || !HASH.test(pending.baseHead.commitHash) || !Number.isSafeInteger(pending.baseHead.sequence)
      || !HASH.test(pending.commitHash) || !Number.isSafeInteger(pending.sequence)
      || pending.sequence !== pending.baseHead.sequence + 1
      || (tip.hash !== pending.baseHead.commitHash && tip.hash !== pending.commitHash)) {
      fail('PENDING_INVALID', 'The interrupted design write cannot be reconciled safely.');
    }
  }
  const head = { formatVersion: DESIGN_STORE_FORMAT_VERSION, designId, sequence: tip.sequence, commitHash: tip.hash };
  let indexed = null;
  try { indexed = assertHead(await readJson(dirs.metadata, 'HEAD.json', 4096, null, 'HEAD_INVALID'), designId); }
  catch (error) { if (error.code !== 'HEAD_INVALID') throw error; }
  if (!indexed || indexed.commitHash !== tip.hash || indexed.sequence !== tip.sequence) await writeHead(dirs.metadata, head);
  if (pending) {
    if (tip.hash === pending.commitHash) await clearPending(dirs.metadata);
    else if (tip.hash === pending.baseHead.commitHash) await clearPending(dirs.metadata);
  }
  await verifyPageRevisions(dirs, tipRecord);
  return { tip, document: tipRecord.document, head };
}

/** Reopen and validate the recoverable commit chain; repairs HEAD only for one unambiguous chain. */
export async function openDesign(workspace, designId, { crypto = globalThis.crypto, locks = globalThis.navigator?.locks } = {}) {
  assertWorkspace(workspace, locks);
  return locks.request(`tiny-image-star-design:${workspace.workspaceId}:${assertId(designId, 'design ID')}`, { mode: 'exclusive' }, async () => {
    const dirs = await openDesignDirectories(workspace, designId);
    const identity = await readJson(dirs.metadata, 'design.json', 16 * 1024, 'DESIGN_MISSING', 'DESIGN_INVALID');
    if (identity?.formatVersion !== DESIGN_STORE_FORMAT_VERSION || identity.designId !== designId
      || !Number.isSafeInteger(identity.createdAt) || !Array.isArray(identity.pageIds) || !identity.pageIds.length
      || identity.pageIds.length > 10_000 || new Set(identity.pageIds).size !== identity.pageIds.length
      || identity.pageIds.some(id => !ID.test(id))) fail('DESIGN_INVALID', 'The design identity is invalid.');
    const recovered = await recoverHead(dirs, designId, identity, crypto, await readPending(dirs.metadata));
    return Object.freeze({ designId, pageIds: Object.freeze(recovered.document.pages.map(page => page.id)), document: recovered.document,
      head: Object.freeze(recovered.head) });
  });
}

/** Return all image IDs retained by any verified snapshot, for safe manual asset collection. */
export async function listDesignAssetReferences(workspace, designId, { crypto = globalThis.crypto, locks = globalThis.navigator?.locks } = {}) {
  assertWorkspace(workspace, locks);
  const safeDesignId = assertId(designId, 'design ID');
  return locks.request(`tiny-image-star-design:${workspace.workspaceId}:${safeDesignId}`, { mode: 'exclusive' }, async () => {
    const dirs = await openDesignDirectories(workspace, safeDesignId);
    const identity = await readJson(dirs.metadata, 'design.json', 16 * 1024, 'DESIGN_MISSING', 'DESIGN_INVALID');
    if (identity?.formatVersion !== DESIGN_STORE_FORMAT_VERSION || identity.designId !== safeDesignId
      || !Number.isSafeInteger(identity.createdAt) || !Array.isArray(identity.pageIds) || !identity.pageIds.length
      || identity.pageIds.length > 10_000 || new Set(identity.pageIds).size !== identity.pageIds.length
      || identity.pageIds.some(id => !ID.test(id))) fail('DESIGN_INVALID', 'The design identity is invalid.');
    const recovered = await recoverHead(dirs, safeDesignId, identity, crypto, await readPending(dirs.metadata));
    const references = new Set();
    const fontSpecs = new Map();
    for (const { name } of await listCommitFiles(dirs.commits)) {
      const hash = name.slice(0, -5);
      const record = await readCommit(dirs.commits, hash, safeDesignId, crypto);
      for (const assetId of collectImageAssetIds(record.document)) references.add(assetId);
      for (const spec of collectFontSpecs(record.document)) fontSpecs.set(`${spec.family}\u0000${spec.weight}\u0000${spec.style}`, spec);
    }
    return Object.freeze({ head: Object.freeze(recovered.head), assetIds: Object.freeze([...references].sort()),
      fontSpecs: Object.freeze([...fontSpecs.values()].sort((left, right) => left.family.localeCompare(right.family)
        || left.weight - right.weight || left.style.localeCompare(right.style))) });
  });
}

/** Append a complete validated snapshot. A stale expectedHead fails before creating any new record. */
export async function commitDesign(workspace, designId, document, { expectedHead, pageId, crypto = globalThis.crypto,
  locks = globalThis.navigator?.locks } = {}) {
  assertWorkspace(workspace, locks);
  assertId(designId, 'design ID');
  assertId(pageId, 'page ID');
  if (!expectedHead || !HASH.test(expectedHead.commitHash) || !Number.isSafeInteger(expectedHead.sequence)) fail('EXPECTED_HEAD_REQUIRED', 'A verified expected design head is required.');
  const candidate = parseDocument(document);
  if (candidate.id !== designId || !candidate.pages.some(page => page.id === pageId)) fail('SNAPSHOT_INVALID', 'The proposed snapshot does not match the design and page.');
  return locks.request(`tiny-image-star-design:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
    const dirs = await openDesignDirectories(workspace, designId);
    const identity = await readJson(dirs.metadata, 'design.json', 16 * 1024, 'DESIGN_MISSING', 'DESIGN_INVALID');
    if (!Array.isArray(identity.pageIds) || !identity.pageIds.length || identity.pageIds.length > 10_000
      || new Set(identity.pageIds).size !== identity.pageIds.length || identity.pageIds.some(id => !ID.test(id))) {
      fail('DESIGN_INVALID', 'The design creation page manifest is invalid.');
    }
    const candidatePageIds = candidate.pages.map(page => assertId(page.id, 'page ID'));
    if (!candidatePageIds.length || candidatePageIds.length > 10_000 || new Set(candidatePageIds).size !== candidatePageIds.length) {
      fail('SNAPSHOT_INVALID', 'The proposed snapshot contains invalid or duplicate pages.');
    }
    const pending = await readPending(dirs.metadata);
    let current;
    if (pending) {
      current = await recoverHead(dirs, designId, identity, crypto, pending);
    } else {
      const indexed = assertHead(await readJson(dirs.metadata, 'HEAD.json', 4096, 'HEAD_MISSING', 'HEAD_INVALID'), designId);
      if (indexed.commitHash !== expectedHead.commitHash || indexed.sequence !== expectedHead.sequence) {
        fail('HEAD_CONFLICT', 'The design changed since this edit began.', { currentHead: indexed });
      }
      const currentRecord = await readCommit(dirs.commits, indexed.commitHash, designId, crypto);
      if (currentRecord.sequence !== indexed.sequence) fail('HEAD_INVALID', 'HEAD does not match the current immutable commit.');
      current = { tip: currentRecord, document: currentRecord.document, head: indexed };
    }
    if (current.tip.hash !== expectedHead.commitHash || current.tip.sequence !== expectedHead.sequence) {
      fail('HEAD_CONFLICT', 'The design changed since this edit began.', { currentHead: current.head });
    }
    await assertReferencedAssetsPresent(dirs.designDirectory, designId, candidate, crypto);
    const record = await makeCommit(designId, current.tip.hash, current.tip.sequence + 1, pageId, candidate, crypto);
    // Keep the existing recoverable chain within the same limits enforced during recovery.
    // This check runs before PENDING, commit, page revision, or HEAD writes.
    await assertHistoryCapacity(dirs.commits, record.record);
    await writePending(dirs.metadata, { formatVersion: DESIGN_STORE_FORMAT_VERSION, designId,
      baseHead: current.head, sequence: current.tip.sequence + 1, commitHash: record.hash });
    await writeImmutableJson(dirs.commits, `${record.hash}.json`, record.record, MAX_DESIGN_SNAPSHOT_BYTES + 16_384);
    const verified = await readCommit(dirs.commits, record.hash, designId, crypto);
    if (serializeDocument(verified.document) !== serializeDocument(candidate)) fail('COMMIT_VERIFY_FAILED', 'The saved snapshot differs from the proposed design.');
    await verifyPageRevisions(dirs, verified);
    const nextHead = { formatVersion: DESIGN_STORE_FORMAT_VERSION, designId, sequence: current.tip.sequence + 1, commitHash: record.hash };
    await writeHead(dirs.metadata, nextHead);
    try { await clearPending(dirs.metadata); } catch { /* The durable HEAD is authoritative; reopen will reconcile the marker. */ }
    return Object.freeze({ document: verified.document, head: Object.freeze(nextHead), acknowledged: true });
  });
}
