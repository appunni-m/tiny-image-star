import { encodeStableDesignInvite } from './session-capsules.js';

export const SHARE_STORE_VERSION = 1;
export const MAX_SHARE_RECORD_BYTES = 16 * 1024;
export const MAX_CONSUMED_SESSIONS_PER_DESIGN = 10_000;

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_SESSION_TTL_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 30_000;
const encoder = new TextEncoder();

export class ShareStoreError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ShareStoreError';
    this.code = code;
  }
}

function fail(code, message, cause) { throw new ShareStoreError(code, message, cause); }
function isNotFound(error) { return error?.name === 'NotFoundError'; }
function safeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value) || value === '.' || value === '..') {
    fail('INVALID_ID', `Invalid ${label}.`);
  }
  return value;
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    fail('RECORD_INVALID', `The saved ${label} is invalid.`);
  }
}
function assertWorkspace(workspace, locks) {
  if (!workspace?.workspaceId || typeof workspace.getDesignDirectoryHandle !== 'function') {
    fail('INVALID_WORKSPACE', 'A verified local workspace is required.');
  }
  if (typeof locks?.request !== 'function') {
    fail('CROSS_TAB_LOCK_UNSUPPORTED', 'This browser cannot safely coordinate sharing changes across tabs.');
  }
  safeId(workspace.workspaceId, 'workspace ID');
}
async function requireWritePermission(workspace) {
  if (typeof workspace.directoryHandle?.queryPermission !== 'function') {
    fail('UNSUPPORTED_PERMISSION_API', 'This browser cannot verify workspace access before changing sharing state.');
  }
  let permission;
  try { permission = await workspace.directoryHandle.queryPermission({ mode: 'readwrite' }); }
  catch (error) { fail('PERMISSION_CHECK_FAILED', 'Could not verify workspace access before changing sharing state.', error); }
  if (permission !== 'granted') fail('PERMISSION_REQUIRED', 'Re-select the workspace folder and grant read and write access before continuing.');
}
function cryptoApi(crypto) {
  if (!crypto?.subtle || typeof crypto.getRandomValues !== 'function') fail('CRYPTO_UNAVAILABLE', 'Web Crypto is unavailable.');
  return crypto;
}
function randomId(crypto, size = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function validateIdentityJwk(jwk, publicJwk) {
  const fields = new Set(['kty', 'crv', 'x', 'y', 'd', 'ext', 'key_ops', 'alg', 'use']);
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk) || Object.keys(jwk).some(key => !fields.has(key))
    || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string' || jwk.d.length !== 43 || !BASE64URL.test(jwk.d)
    || typeof jwk.x !== 'string' || jwk.x.length !== 43 || !BASE64URL.test(jwk.x)
    || typeof jwk.y !== 'string' || jwk.y.length !== 43 || !BASE64URL.test(jwk.y)
    || jwk.x !== publicJwk?.x || jwk.y !== publicJwk?.y) {
    fail('IDENTITY_KEY_INVALID', 'The saved design identity key is invalid or does not match its public key.');
  }
}

async function readJson(directory, name, maxBytes, { missing = null, invalid = 'RECORD_INVALID' } = {}) {
  let handle;
  try { handle = await directory.getFileHandle(name, { create: false }); }
  catch (error) {
    if (isNotFound(error) && missing) fail(missing, `${name} is missing.`, error);
    if (isNotFound(error)) return null;
    fail(`${invalid}_READ_FAILED`, `Could not open ${name}.`, error);
  }
  try {
    const file = await handle.getFile();
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxBytes) fail('RECORD_TOO_LARGE', `${name} exceeds its safety limit.`);
    const text = await file.text();
    if (encoder.encode(text).byteLength > maxBytes) fail('RECORD_TOO_LARGE', `${name} exceeds its safety limit.`);
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ShareStoreError) throw error;
    fail(invalid, `${name} is corrupt or unreadable.`, error);
  }
}

async function writeImmutableJson(directory, name, record, maxBytes = MAX_SHARE_RECORD_BYTES) {
  const text = canonical(record);
  if (encoder.encode(text).byteLength > maxBytes) fail('RECORD_TOO_LARGE', `${name} exceeds its safety limit.`);
  let handle;
  try {
    handle = await directory.getFileHandle(name, { create: false });
    const existing = await handle.getFile();
    if (await existing.text() !== text) fail('IMMUTABLE_RECORD_COLLISION', `An existing ${name} has different contents.`);
    return;
  } catch (error) {
    if (!isNotFound(error)) {
      if (error instanceof ShareStoreError) throw error;
      fail('RECORD_READ_FAILED', `Could not verify existing ${name}.`, error);
    }
  }
  try { handle = await directory.getFileHandle(name, { create: true }); }
  catch (error) { fail('RECORD_WRITE_FAILED', `Could not create ${name}.`, error); }
  let writable;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(text);
    await writable.close();
  } catch (error) {
    try { await writable?.abort?.(); } catch {}
    fail('RECORD_WRITE_FAILED', `Could not save ${name}.`, error);
  }
  const reopened = await readJson(directory, name, maxBytes, { missing: 'RECORD_VERIFY_FAILED' });
  if (canonical(reopened) !== text) fail('RECORD_VERIFY_FAILED', `${name} did not reopen with the saved contents.`);
}

async function writeReplaceableJson(directory, name, record, maxBytes = MAX_SHARE_RECORD_BYTES) {
  const text = canonical(record);
  if (encoder.encode(text).byteLength > maxBytes) fail('RECORD_TOO_LARGE', `${name} exceeds its safety limit.`);
  let handle;
  try { handle = await directory.getFileHandle(name, { create: true }); }
  catch (error) { fail('RECORD_WRITE_FAILED', `Could not open ${name}.`, error); }
  let writable;
  try {
    writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(text);
    await writable.close();
  } catch (error) {
    try { await writable?.abort?.(); } catch {}
    fail('RECORD_WRITE_FAILED', `Could not save ${name}.`, error);
  }
  const reopened = await readJson(directory, name, maxBytes, { missing: 'RECORD_VERIFY_FAILED' });
  if (canonical(reopened) !== text) fail('RECORD_VERIFY_FAILED', `${name} did not reopen with the saved contents.`);
}

async function openShareDirectories(workspace, designId, { create = false } = {}) {
  safeId(designId, 'design ID');
  let design;
  try { design = await workspace.getDesignDirectoryHandle(designId, { create: false }); }
  catch (error) { fail('DESIGN_NOT_FOUND', 'The design must exist in this workspace before it can be shared.', error); }
  try {
    const metadata = await design.getDirectoryHandle('.tiny-image-star', { create });
    let sharing;
    try { sharing = await metadata.getDirectoryHandle('sharing', { create }); }
    catch (error) {
      // A design that has never been shared has no sharing directory yet. Treat
      // that normal state as an empty store when reading; creating the first
      // grant will initialize it under the same cross-tab lock.
      if (!create && isNotFound(error)) return null;
      throw error;
    }
    const grants = await sharing.getDirectoryHandle('grants', { create });
    const revoked = await sharing.getDirectoryHandle('revoked', { create });
    const sessions = await metadata.getDirectoryHandle('sessions', { create });
    return { metadata, sharing, grants, revoked, sessions };
  } catch (error) {
    if (error instanceof ShareStoreError) throw error;
    fail('SHARE_STORE_OPEN_FAILED', 'Could not open the design sharing store.', error);
  }
}

function assertGrant(grant, designId) {
  exactKeys(grant, ['formatVersion', 'designId', 'shareId', 'createdAt', 'invite'], 'share grant');
  if (grant.formatVersion !== SHARE_STORE_VERSION || grant.designId !== designId || !SAFE_ID.test(grant.shareId)
    || !Number.isSafeInteger(grant.createdAt) || grant.createdAt < 0
    || !grant.invite || grant.invite.designId !== designId || grant.invite.shareId !== grant.shareId) {
    fail('GRANT_INVALID', 'The saved share grant is invalid.');
  }
  let encodedInvite;
  try { encodedInvite = encodeStableDesignInvite(grant.invite); }
  catch (error) { fail('GRANT_INVALID', 'The saved share invitation is invalid.', error); }
  return { ...grant, encodedInvite };
}

async function readIdentity(sharing, crypto) {
  const value = await readJson(sharing, 'identity.json', MAX_SHARE_RECORD_BYTES, { invalid: 'IDENTITY_KEY_INVALID' });
  if (!value) return null;
  exactKeys(value, ['formatVersion', 'publicKey', 'privateKeyJwk'], 'design identity');
  if (value.formatVersion !== SHARE_STORE_VERSION) fail('IDENTITY_KEY_INVALID', 'The saved design identity version is unsupported.');
  validateIdentityJwk(value.privateKeyJwk, value.publicKey);
  let privateKey;
  try { privateKey = await crypto.subtle.importKey('jwk', value.privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']); }
  catch (error) { fail('IDENTITY_KEY_INVALID', 'The saved design identity key cannot be imported.', error); }
  try {
    const publicKey = await crypto.subtle.importKey('jwk', value.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, challenge);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, challenge)) {
      fail('IDENTITY_KEY_INVALID', 'The saved design identity public and private keys do not match.');
    }
  } catch (error) {
    if (error instanceof ShareStoreError) throw error;
    fail('IDENTITY_KEY_INVALID', 'The saved design identity key pair is invalid.', error);
  }
  return value;
}

async function ensureIdentity(sharing, crypto) {
  const current = await readIdentity(sharing, crypto);
  if (current) return current;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const record = {
    formatVersion: SHARE_STORE_VERSION,
    publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
    privateKeyJwk: await crypto.subtle.exportKey('jwk', pair.privateKey)
  };
  validateIdentityJwk(record.privateKeyJwk, record.publicKey);
  await writeImmutableJson(sharing, 'identity.json', record);
  return record;
}

async function readGrant(dirs, shareId, designId) {
  safeId(shareId, 'share ID');
  const grant = await readJson(dirs.grants, `${shareId}.json`, MAX_SHARE_RECORD_BYTES, { invalid: 'GRANT_INVALID' });
  if (!grant) return null;
  return assertGrant(grant, designId);
}

async function currentActiveGrant(dirs, designId) {
  const pointer = await readJson(dirs.sharing, 'ACTIVE.json', 1024, { invalid: 'ACTIVE_GRANT_INVALID' });
  if (!pointer) return null;
  exactKeys(pointer, ['formatVersion', 'designId', 'shareId'], 'active share pointer');
  if (pointer.formatVersion !== SHARE_STORE_VERSION || pointer.designId !== designId) fail('ACTIVE_GRANT_INVALID', 'The active share pointer does not match this design.');
  const grant = await readGrant(dirs, pointer.shareId, designId);
  if (!grant) fail('ACTIVE_GRANT_INVALID', 'The active share grant is missing.');
  const revoked = await readJson(dirs.revoked, `${grant.shareId}.json`, 1024, { invalid: 'REVOCATION_INVALID' });
  return revoked ? null : grant;
}

/** Create (or rotate after revocation) the design's stable, capability-bearing invite. */
export async function createShareGrant(workspace, designId, { crypto = globalThis.crypto, locks = globalThis.navigator?.locks, now = Date.now() } = {}) {
  assertWorkspace(workspace, locks);
  safeId(designId, 'design ID');
  crypto = cryptoApi(crypto);
  if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_OPTIONS', 'Invalid share creation time.');
  return locks.request(`tiny-image-star-share:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
    await requireWritePermission(workspace);
    const dirs = await openShareDirectories(workspace, designId, { create: true });
    if (await currentActiveGrant(dirs, designId)) fail('SHARE_ALREADY_ACTIVE', 'This design already has an active share link. Revoke it before creating a replacement.');
    const identity = await ensureIdentity(dirs.sharing, crypto);
    let identityPrivateKey;
    try { identityPrivateKey = await crypto.subtle.importKey('jwk', identity.privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']); }
    catch (error) { fail('IDENTITY_KEY_INVALID', 'The saved design identity key cannot be imported.', error); }
    const capabilityPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const invite = {
      v: 1,
      designId,
      shareId: randomId(crypto),
      identityPublicKey: identity.publicKey,
      capabilityPublicKey: await crypto.subtle.exportKey('jwk', capabilityPair.publicKey),
      capabilityPrivateKey: await crypto.subtle.exportKey('jwk', capabilityPair.privateKey)
    };
    let encodedInvite;
    try { encodedInvite = encodeStableDesignInvite(invite); }
    catch (error) { fail('GRANT_INVALID', 'Could not create a valid share invitation.', error); }
    const grant = { formatVersion: SHARE_STORE_VERSION, designId, shareId: invite.shareId, createdAt: now, invite };
    await writeImmutableJson(dirs.grants, `${invite.shareId}.json`, grant);
    await writeReplaceableJson(dirs.sharing, 'ACTIVE.json', { formatVersion: SHARE_STORE_VERSION, designId, shareId: invite.shareId });
    return Object.freeze({ ...grant, invite: structuredClone(invite), encodedInvite, identityPrivateKey });
  });
}

/** Load only the current, unrevoked invitation. Callers must still revalidate every capsule. */
export async function loadShareGrant(workspace, designId, { crypto = globalThis.crypto, locks = globalThis.navigator?.locks } = {}) {
  assertWorkspace(workspace, locks);
  safeId(designId, 'design ID');
  crypto = cryptoApi(crypto);
  return locks.request(`tiny-image-star-share:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
    await requireWritePermission(workspace);
    const dirs = await openShareDirectories(workspace, designId);
    if (!dirs) return null;
    const grant = await currentActiveGrant(dirs, designId);
    if (!grant) return null;
    const identity = await readIdentity(dirs.sharing, crypto);
    if (!identity || canonical(identity.publicKey) !== canonical(grant.invite.identityPublicKey)) fail('IDENTITY_KEY_INVALID', 'The active invitation is not bound to this design identity.');
    let identityPrivateKey;
    try { identityPrivateKey = await crypto.subtle.importKey('jwk', identity.privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']); }
    catch (error) { fail('IDENTITY_KEY_INVALID', 'The saved design identity key cannot be imported.', error); }
    return Object.freeze({ ...grant, identityPrivateKey });
  });
}

/** Revoke the current capability durably; old URLs fail closed on every later host lookup. */
export async function revokeShareGrant(workspace, designId, { locks = globalThis.navigator?.locks, now = Date.now() } = {}) {
  assertWorkspace(workspace, locks);
  safeId(designId, 'design ID');
  if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_OPTIONS', 'Invalid revocation time.');
  return locks.request(`tiny-image-star-share:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
    await requireWritePermission(workspace);
    const dirs = await openShareDirectories(workspace, designId);
    if (!dirs) return false;
    const grant = await currentActiveGrant(dirs, designId);
    if (!grant) return false;
    await writeImmutableJson(dirs.revoked, `${grant.shareId}.json`, { formatVersion: SHARE_STORE_VERSION, designId, shareId: grant.shareId, revokedAt: now }, 1024);
    return true;
  });
}

/**
 * Durably consume one verified answer session before the host sends design data.
 * The caller must first run verifyAnswerCapsule and check the active grant. The
 * DataChannel itself does not authorize access; host validation remains required.
 */
export async function consumeAnswerSessionOnce(workspace, answer, { locks = globalThis.navigator?.locks, now = Date.now() } = {}) {
  exactKeys(answer, ['v', 'kind', 'designId', 'shareId', 'sessionId', 'nonce', 'issuedAt', 'expiresAt', 'sdp'], 'verified answer');
  const designId = safeId(answer?.designId, 'design ID');
  const shareId = safeId(answer?.shareId, 'share ID');
  const sessionId = safeId(answer?.sessionId, 'session ID');
  assertWorkspace(workspace, locks);
  if (!Number.isSafeInteger(now) || now < 0 || answer?.kind !== 'answer' || answer?.v !== 1 || typeof answer.nonce !== 'string'
    || !BASE64URL.test(answer.nonce) || answer.nonce.length < 32 || answer.nonce.length > 64
    || !Number.isSafeInteger(answer.issuedAt) || answer.issuedAt < 0 || !Number.isSafeInteger(answer.expiresAt) || answer.expiresAt < 0
    || answer.expiresAt <= answer.issuedAt || answer.expiresAt - answer.issuedAt > MAX_SESSION_TTL_MS
    || answer.issuedAt > now + CLOCK_SKEW_MS || now > answer.expiresAt
    || typeof answer.sdp !== 'string' || encoder.encode(answer.sdp).byteLength < 1 || encoder.encode(answer.sdp).byteLength > 48_000) {
    fail('SESSION_INVALID', 'The verified answer session is invalid or expired.');
  }
  return locks.request(`tiny-image-star-share:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
    await requireWritePermission(workspace);
    const dirs = await openShareDirectories(workspace, designId, { create: true });
    const active = await currentActiveGrant(dirs, designId);
    if (!active || active.shareId !== shareId) fail('SHARE_REVOKED', 'This answer does not belong to the active share grant.');
    return locks.request(`tiny-image-star-session:${workspace.workspaceId}:${designId}:${sessionId}`, { mode: 'exclusive' }, async () => {
      const existing = await readJson(dirs.sessions, `${sessionId}.json`, 2048, { invalid: 'SESSION_RECORD_INVALID' });
      if (existing) fail('SESSION_REPLAYED', 'This one-time sharing session was already consumed.');
      const sessions = [];
      if (typeof dirs.sessions.values !== 'function') fail('SESSION_STORE_UNSUPPORTED', 'This browser cannot safely enforce one-time session use.');
      try {
        for await (const handle of dirs.sessions.values()) if (handle.kind === 'file' && handle.name.endsWith('.json')) sessions.push(handle.name);
      } catch (error) { fail('SESSION_STORE_READ_FAILED', 'Could not verify one-time session records.', error); }
      if (sessions.length >= MAX_CONSUMED_SESSIONS_PER_DESIGN) fail('SESSION_STORE_LIMIT', 'This design has reached its one-time session safety limit.');
      await writeImmutableJson(dirs.sessions, `${sessionId}.json`, {
        formatVersion: SHARE_STORE_VERSION, designId, shareId, sessionId, nonce: answer.nonce,
        expiresAt: answer.expiresAt, consumedAt: now
      }, 2048);
      return true;
    });
  });
}
