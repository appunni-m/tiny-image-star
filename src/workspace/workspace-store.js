export const WORKSPACE_FORMAT_VERSION = 1;
export const WORKSPACE_METADATA_DIRECTORY = '.tiny-image-star';
export const WORKSPACE_MANIFEST_FILE = 'workspace.json';
export const WORKSPACE_DESIGNS_DIRECTORY = 'designs';
export const WORKSPACE_TRANSACTIONS_DIRECTORY = 'transactions';
export const MAX_WORKSPACE_MANIFEST_BYTES = 16 * 1024;

const APP_ID = 'tiny-image-star';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MANIFEST_KEYS = ['formatVersion', 'appId', 'workspaceId', 'createdAt', 'updatedAt'];

export class WorkspaceStoreError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'WorkspaceStoreError';
    this.code = code;
  }
}

function isNotFound(error) {
  return error?.name === 'NotFoundError';
}

function assertDirectoryHandle(handle) {
  if (!handle || (handle.kind != null && handle.kind !== 'directory')
    || typeof handle.getDirectoryHandle !== 'function' || typeof handle.getFileHandle !== 'function') {
    throw new WorkspaceStoreError('UNSUPPORTED_HANDLE', 'This browser did not provide a writable folder handle.');
  }
}

function assertId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new WorkspaceStoreError('INVALID_ID', `Invalid ${label}.`);
  }
  return value;
}

function assertPermissionMethods(handle) {
  if (typeof handle.queryPermission !== 'function') {
    throw new WorkspaceStoreError('UNSUPPORTED_PERMISSION_API', 'This browser cannot verify folder write permission.');
  }
}

async function requireReadWritePermission(handle) {
  assertPermissionMethods(handle);
  let permission;
  try { permission = await handle.queryPermission({ mode: 'readwrite' }); }
  catch (error) { throw new WorkspaceStoreError('PERMISSION_CHECK_FAILED', 'Could not verify access to the selected folder.', error); }
  if (permission !== 'granted') {
    throw new WorkspaceStoreError('PERMISSION_REQUIRED', 'Folder access is needed. Re-select the folder and grant read and write permission.');
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || Object.keys(manifest).length !== MANIFEST_KEYS.length
    || Object.keys(manifest).some(key => !MANIFEST_KEYS.includes(key))) {
    throw new WorkspaceStoreError('MANIFEST_INVALID', 'The selected folder has an invalid Tiny Image Star workspace manifest.');
  }
  if (manifest.formatVersion !== WORKSPACE_FORMAT_VERSION || manifest.appId !== APP_ID) {
    throw new WorkspaceStoreError('WORKSPACE_VERSION_UNSUPPORTED', 'This folder was created by an unsupported workspace version.');
  }
  if (typeof manifest.workspaceId !== 'string' || !ID_PATTERN.test(manifest.workspaceId)) {
    throw new WorkspaceStoreError('MANIFEST_INVALID', 'The workspace manifest contains an invalid workspace ID.');
  }
  if (!Number.isSafeInteger(manifest.createdAt) || manifest.createdAt < 0
    || !Number.isSafeInteger(manifest.updatedAt) || manifest.updatedAt < manifest.createdAt) {
    throw new WorkspaceStoreError('MANIFEST_INVALID', 'The workspace manifest contains invalid timestamps.');
  }
  return Object.freeze({ ...manifest });
}

async function readManifest(metadataDirectory) {
  let fileHandle;
  try { fileHandle = await metadataDirectory.getFileHandle(WORKSPACE_MANIFEST_FILE, { create: false }); }
  catch (error) {
    if (isNotFound(error)) throw new WorkspaceStoreError('MANIFEST_MISSING', 'The selected folder is not a Tiny Image Star workspace.', error);
    throw new WorkspaceStoreError('MANIFEST_READ_FAILED', 'Could not open the workspace manifest.', error);
  }
  try {
    const file = await fileHandle.getFile();
    if (!Number.isSafeInteger(file.size) || file.size > MAX_WORKSPACE_MANIFEST_BYTES) {
      throw new WorkspaceStoreError('MANIFEST_TOO_LARGE', 'The workspace manifest exceeds its safety limit.');
    }
    return validateManifest(JSON.parse(await file.text()));
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    throw new WorkspaceStoreError('MANIFEST_INVALID', 'The selected folder has an unreadable workspace manifest.', error);
  }
}

async function writeJsonFile(directory, fileName, value, { create = true } = {}) {
  let fileHandle;
  try { fileHandle = await directory.getFileHandle(fileName, { create }); }
  catch (error) { throw new WorkspaceStoreError('FILE_OPEN_FAILED', `Could not open ${fileName}.`, error); }
  let writable;
  try {
    writable = await fileHandle.createWritable({ keepExistingData: false });
    await writable.write(JSON.stringify(value));
    await writable.close();
  } catch (error) {
    try { await writable?.abort?.(); } catch {}
    throw new WorkspaceStoreError('FILE_WRITE_FAILED', `Could not save ${fileName}.`, error);
  }
}

async function directoryExists(parent, name) {
  try { await parent.getDirectoryHandle(name, { create: false }); return true; }
  catch (error) { if (isNotFound(error)) return false; throw error; }
}

function makeWorkspace(directoryHandle, manifest, metadataDirectory, designsDirectory, transactionsDirectory) {
  const stableManifest = Object.freeze({ ...manifest });
  return Object.freeze({
    workspaceId: stableManifest.workspaceId,
    directoryHandle,
    metadataDirectory,
    designsDirectory,
    transactionsDirectory,
    get manifest() { return { ...stableManifest }; },
    async getDesignDirectoryHandle(designId, { create = false } = {}) {
      assertId(designId, 'design ID');
      try { return await designsDirectory.getDirectoryHandle(designId, { create }); }
      catch (error) {
        if (isNotFound(error)) throw new WorkspaceStoreError('DESIGN_NOT_FOUND', 'This design is not present in the selected workspace.', error);
        throw new WorkspaceStoreError('DESIGN_OPEN_FAILED', 'Could not open the design folder.', error);
      }
    },
    async getPageDirectoryHandle(designId, pageId, { create = false } = {}) {
      assertId(designId, 'design ID');
      assertId(pageId, 'page ID');
      let pagesDirectory;
      try {
        const designDirectory = await designsDirectory.getDirectoryHandle(designId, { create: false });
        pagesDirectory = await designDirectory.getDirectoryHandle('pages', { create: false });
        return await pagesDirectory.getDirectoryHandle(pageId, { create });
      } catch (error) {
        if (isNotFound(error)) throw new WorkspaceStoreError('PAGE_NOT_FOUND', 'This page is not present in the selected workspace.', error);
        throw new WorkspaceStoreError('PAGE_OPEN_FAILED', 'Could not open the page folder.', error);
      }
    }
  });
}

/** Open the native folder picker. Call directly from a user gesture. */
export async function pickWorkspaceDirectory(picker = globalThis.showDirectoryPicker) {
  if (typeof picker !== 'function') {
    throw new WorkspaceStoreError('FOLDER_PICKER_UNSUPPORTED', 'This browser cannot select a writable workspace folder.');
  }
  try { return await picker({ id: 'tiny-image-star-workspace', mode: 'readwrite' }); }
  catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new WorkspaceStoreError('FOLDER_PICKER_FAILED', 'Could not select the workspace folder.', error);
  }
}

/** Ask for permission only from a user-initiated action such as a Reconnect button. */
export async function requestWorkspacePermission(directoryHandle) {
  assertDirectoryHandle(directoryHandle);
  if (typeof directoryHandle.requestPermission !== 'function') {
    throw new WorkspaceStoreError('UNSUPPORTED_PERMISSION_API', 'This browser cannot request folder access. Re-select the workspace folder instead.');
  }
  try { return await directoryHandle.requestPermission({ mode: 'readwrite' }); }
  catch (error) { throw new WorkspaceStoreError('PERMISSION_REQUEST_FAILED', 'Could not request access to the selected folder.', error); }
}

/** Initialize a new workspace in the chosen folder; existing data is never replaced. */
export async function createWorkspace(directoryHandle, { crypto = globalThis.crypto, now = Date.now(), locks = globalThis.navigator?.locks } = {}) {
  assertDirectoryHandle(directoryHandle);
  await requireReadWritePermission(directoryHandle);
  if (!crypto?.getRandomValues || !Number.isSafeInteger(now) || now < 0) {
    throw new WorkspaceStoreError('INVALID_WORKSPACE_OPTIONS', 'Could not create a secure workspace identity.');
  }
  if (typeof locks?.request !== 'function') {
    throw new WorkspaceStoreError('CROSS_TAB_LOCK_UNSUPPORTED', 'This browser cannot safely initialize a workspace across multiple tabs.');
  }
  try {
    return await locks.request('tiny-image-star-workspace-initialize', { mode: 'exclusive' }, async () => {
      let metadataDirectory;
      try { metadataDirectory = await directoryHandle.getDirectoryHandle(WORKSPACE_METADATA_DIRECTORY, { create: true }); }
      catch (error) { throw new WorkspaceStoreError('METADATA_DIRECTORY_FAILED', 'Could not create workspace metadata.', error); }
      try {
        const existing = await metadataDirectory.getFileHandle(WORKSPACE_MANIFEST_FILE, { create: false });
        if (existing) throw new WorkspaceStoreError('WORKSPACE_EXISTS', 'This folder already contains a Tiny Image Star workspace. Open it to continue.');
      } catch (error) {
        if (error instanceof WorkspaceStoreError) throw error;
        if (!isNotFound(error)) throw new WorkspaceStoreError('MANIFEST_READ_FAILED', 'Could not check for an existing workspace.', error);
      }

      let designsDirectory;
      let transactionsDirectory;
      try {
        [designsDirectory, transactionsDirectory] = await Promise.all([
          directoryHandle.getDirectoryHandle(WORKSPACE_DESIGNS_DIRECTORY, { create: true }),
          metadataDirectory.getDirectoryHandle(WORKSPACE_TRANSACTIONS_DIRECTORY, { create: true })
        ]);
      } catch (error) { throw new WorkspaceStoreError('WORKSPACE_INITIALIZE_FAILED', 'Could not initialize workspace folders.', error); }

      const random = new Uint8Array(18);
      crypto.getRandomValues(random);
      const workspaceId = [...random].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const manifest = validateManifest({
        formatVersion: WORKSPACE_FORMAT_VERSION,
        appId: APP_ID,
        workspaceId,
        createdAt: now,
        updatedAt: now
      });
      await writeJsonFile(metadataDirectory, WORKSPACE_MANIFEST_FILE, manifest, { create: true });
      return makeWorkspace(directoryHandle, manifest, metadataDirectory, designsDirectory, transactionsDirectory);
    });
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    throw new WorkspaceStoreError('WORKSPACE_INITIALIZE_FAILED', 'Could not safely initialize this workspace.', error);
  }
}

/** Reopen a saved workspace only after read/write permission is currently granted. */
export async function openWorkspace(directoryHandle) {
  assertDirectoryHandle(directoryHandle);
  await requireReadWritePermission(directoryHandle);
  let metadataDirectory;
  try { metadataDirectory = await directoryHandle.getDirectoryHandle(WORKSPACE_METADATA_DIRECTORY, { create: false }); }
  catch (error) {
    if (isNotFound(error)) throw new WorkspaceStoreError('MANIFEST_MISSING', 'The selected folder is not a Tiny Image Star workspace.', error);
    throw new WorkspaceStoreError('METADATA_DIRECTORY_FAILED', 'Could not open workspace metadata.', error);
  }
  const manifest = await readManifest(metadataDirectory);
  let designsDirectory;
  let transactionsDirectory;
  try {
    [designsDirectory, transactionsDirectory] = await Promise.all([
      directoryHandle.getDirectoryHandle(WORKSPACE_DESIGNS_DIRECTORY, { create: false }),
      metadataDirectory.getDirectoryHandle(WORKSPACE_TRANSACTIONS_DIRECTORY, { create: false })
    ]);
  } catch (error) {
    throw new WorkspaceStoreError('WORKSPACE_INCOMPLETE', 'Workspace folders are incomplete. Existing workspace data was not changed.', error);
  }
  return makeWorkspace(directoryHandle, manifest, metadataDirectory, designsDirectory, transactionsDirectory);
}

/**
 * List design folders with a valid Tiny Image Star creation marker. Call `openDesign`
 * for each returned ID before using it; this is an index of candidates, not integrity
 * validation of their commit chains.
 */
export async function listWorkspaceDesignIds(workspace) {
  if (!workspace?.workspaceId || typeof workspace.designsDirectory?.entries !== 'function') {
    throw new WorkspaceStoreError('DESIGN_LIST_UNSUPPORTED', 'This browser cannot list the selected workspace designs.');
  }
  const result = [];
  try {
    for await (const [name, handle] of workspace.designsDirectory.entries()) {
      if (handle.kind !== 'directory' || typeof name !== 'string' || !ID_PATTERN.test(name) || name === '.' || name === '..') continue;
      let markerHandle;
      try { markerHandle = await handle.getFileHandle('CREATE.json', { create: false }); }
      catch (error) { if (isNotFound(error)) continue; throw error; }
      const file = await markerHandle.getFile();
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 16 * 1024) continue;
      let marker;
      try { marker = JSON.parse(await file.text()); } catch { continue; }
      if (!marker || typeof marker !== 'object' || Array.isArray(marker)
        || Object.keys(marker).length !== 5
        || marker.formatVersion !== 1 || marker.designId !== name
        || !Number.isSafeInteger(marker.createdAt) || marker.createdAt < 0
        || !/^[a-f0-9]{64}$/.test(marker.initialCommitHash)
        || !Array.isArray(marker.pageIds) || marker.pageIds.length < 1 || marker.pageIds.length > 10_000
        || new Set(marker.pageIds).size !== marker.pageIds.length
        || marker.pageIds.some(id => typeof id !== 'string' || !ID_PATTERN.test(id))) continue;
      result.push(name);
    }
  } catch (error) {
    if (error instanceof WorkspaceStoreError) throw error;
    throw new WorkspaceStoreError('DESIGN_LIST_FAILED', 'Could not list design folders from the selected workspace.', error);
  }
  return Object.freeze(result.sort());
}

/** Select and initialize in one call for use directly within a user gesture. */
export async function pickAndCreateWorkspace(options = {}) {
  const { picker, ...workspaceOptions } = options;
  const directoryHandle = await pickWorkspaceDirectory(picker);
  return createWorkspace(directoryHandle, workspaceOptions);
}
