import {
  CollaborationProtocolError,
  COLLABORATION_PROTOCOL_VERSION,
  MAX_ASSET_BYTES,
  MAX_ASSET_CHUNK_BYTES,
  decodeCollaborationMessage,
  encodeCollaborationMessage,
  validateCollaborationMessage
} from './protocol.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DIRECTIONS = new Set(['host-to-guest', 'guest-to-host']);
const ASSET_KINDS = new Set(['image', 'font']);
const DEFAULT_BUFFER_LIMIT = 1024 * 1024;
const MAX_BUFFER_LIMIT = 4 * 1024 * 1024;
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
const DEFAULT_RECEIVE_TIMEOUT_MS = 30_000;
const MAX_TRACKED_TRANSFER_IDS = 4096;
const UTF8 = new TextEncoder();
const activeChannelDirections = new WeakMap();

export class CollaborationAssetTransferError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'CollaborationAssetTransferError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new CollaborationAssetTransferError(code, message, cause ? { cause } : undefined);
}

function assertId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail('INVALID_ID', `${label} is invalid.`);
  return value;
}

function assertDirection(value) {
  if (!DIRECTIONS.has(value)) fail('INVALID_DIRECTION', 'Asset transfer direction must be host-to-guest or guest-to-host.');
  return value;
}

function normalizeContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)
    || context.v !== COLLABORATION_PROTOCOL_VERSION || Object.keys(context).length !== 4
    || Object.keys(context).some(key => !['v', 'designId', 'sessionId', 'actorId'].includes(key))) {
    fail('INVALID_CONTEXT', 'A complete protocol, design, session, and sender actor context is required.');
  }
  return {
    v: COLLABORATION_PROTOCOL_VERSION,
    designId: assertId(context.designId, 'Design ID'),
    sessionId: assertId(context.sessionId, 'Session ID'),
    actorId: assertId(context.actorId, 'Sender actor ID')
  };
}

function expectedContext(context) {
  return { designId: context.designId, sessionId: context.sessionId, actorId: context.actorId };
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  fail('INVALID_BYTES', 'Asset content must be an ArrayBuffer or Uint8Array.');
}

function assertCrypto(crypto) {
  if (typeof crypto?.subtle?.digest !== 'function') fail('CRYPTO_UNAVAILABLE', 'SHA-256 hashing is unavailable.');
}

async function sha256(bytes, crypto) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function assertChannel(channel) {
  if (!channel || typeof channel !== 'object' || typeof channel.send !== 'function') fail('INVALID_CHANNEL', 'A WebRTC DataChannel is required.');
}

function claimChannel(channel, transferDirection) {
  assertChannel(channel);
  if (transferDirection !== 'outbound' && transferDirection !== 'inbound') {
    fail('INVALID_DIRECTION', 'Asset transfer direction must be outbound or inbound.');
  }
  let active = activeChannelDirections.get(channel);
  if (!active) {
    active = new Set();
    activeChannelDirections.set(channel, active);
  }
  if (active.has(transferDirection)) {
    fail('TRANSFER_IN_PROGRESS', `An ${transferDirection} asset transfer is already active on this DataChannel.`);
  }
  active.add(transferDirection);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active.delete(transferDirection);
    if (!active.size) activeChannelDirections.delete(channel);
  };
}

function assertReady(channel) {
  if (channel.readyState !== 'open') fail('CHANNEL_CLOSED', 'The collaboration DataChannel is not open.');
}

function assertBufferOptions(maxBufferedAmount, timeoutMs) {
  const largestFrame = MAX_ASSET_CHUNK_BYTES + 2055;
  if (!Number.isSafeInteger(maxBufferedAmount) || maxBufferedAmount < largestFrame || maxBufferedAmount > MAX_BUFFER_LIMIT) {
    fail('INVALID_OPTIONS', `The DataChannel buffer limit must be between ${largestFrame} and ${MAX_BUFFER_LIMIT} bytes.`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    fail('INVALID_OPTIONS', 'The DataChannel drain timeout must be between 1 and 120000 milliseconds.');
  }
}

function checkAbort(signal) {
  if (signal?.aborted) fail('CANCELLED', 'Asset transfer was cancelled.', signal.reason);
}

async function waitForCapacity(channel, requiredBytes, maxBufferedAmount, deadline, signal) {
  const threshold = maxBufferedAmount - requiredBytes;
  while (true) {
    checkAbort(signal);
    assertReady(channel);
    const queued = channel.bufferedAmount;
    if (!Number.isFinite(queued) || queued < 0) fail('INVALID_CHANNEL', 'The DataChannel does not expose a valid bufferedAmount.');
    if (queued + requiredBytes <= maxBufferedAmount) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) fail('BACKPRESSURE_TIMEOUT', 'The DataChannel did not drain before the asset transfer timeout.');

    try { channel.bufferedAmountLowThreshold = threshold; } catch {}
    await new Promise((resolve, reject) => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        channel.removeEventListener?.('bufferedamountlow', finish);
        signal?.removeEventListener?.('abort', onAbort);
        resolve();
      };
      const onAbort = () => finish();
      channel.addEventListener?.('bufferedamountlow', finish, { once: true });
      signal?.addEventListener?.('abort', onAbort, { once: true });
      timer = setTimeout(finish, Math.min(25, remaining));
    });
  }
}

/**
 * Sends one bounded image or font transfer using control JSON around binary
 * chunks. `context.actorId` must identify the authenticated sender. The flow
 * field is repeated on every frame so the receiver can reject direction flips.
 */
export async function sendCollaborationAsset(channel, {
  context,
  direction,
  transferId,
  assetId,
  assetKind,
  mimeType,
  fontMetadata = null,
  bytes,
  crypto = globalThis.crypto,
  maxBufferedAmount = DEFAULT_BUFFER_LIMIT,
  drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
  signal
} = {}) {
  assertChannel(channel);
  assertReady(channel);
  context = normalizeContext(context);
  direction = assertDirection(direction);
  assertId(transferId, 'Transfer ID');
  assertId(assetId, 'Asset ID');
  if (!ASSET_KINDS.has(assetKind)) fail('INVALID_ASSET_KIND', 'Asset kind must be image or font.');
  if (typeof mimeType !== 'string') fail('INVALID_MIME_TYPE', 'Asset MIME type is required.');
  const source = toBytes(bytes);
  if (source.byteLength < 1 || source.byteLength > MAX_ASSET_BYTES) fail('SIZE_LIMIT', `Asset size must be between 1 and ${MAX_ASSET_BYTES} bytes.`);
  assertCrypto(crypto);
  assertBufferOptions(maxBufferedAmount, drainTimeoutMs);
  checkAbort(signal);

  const release = claimChannel(channel, 'outbound');
  const originalLowThreshold = channel.bufferedAmountLowThreshold;
  const stableBytes = source.slice();
  let digest;
  let chunkCount;
  const deadline = Date.now() + drainTimeoutMs;
  let chunksSent = 0;

  async function send(frame) {
    checkAbort(signal);
    const frameBytes = typeof frame === 'string' ? UTF8.encode(frame).byteLength : frame.byteLength;
    if (frameBytes > maxBufferedAmount) fail('FRAME_TOO_LARGE', 'A transfer frame exceeds the configured DataChannel buffer bound.');
    await waitForCapacity(channel, frameBytes, maxBufferedAmount, deadline, signal);
    try { channel.send(frame); }
    catch (error) { fail('CHANNEL_SEND_FAILED', 'The DataChannel rejected an asset transfer frame.', error); }
  }

  try {
    digest = await sha256(stableBytes, crypto);
    chunkCount = Math.ceil(stableBytes.byteLength / MAX_ASSET_CHUNK_BYTES);
    const common = { ...context, flow: direction, transferId, assetKind };
    const begin = encodeCollaborationMessage({
      ...common,
      kind: 'ASSET_BEGIN',
      assetId,
      mimeType,
      fontMetadata,
      byteLength: stableBytes.byteLength,
      chunkCount,
      sha256: digest
    }, { direction, context: expectedContext(context) });
    await send(begin);

    for (let index = 0; index < chunkCount; index += 1) {
      const offset = index * MAX_ASSET_CHUNK_BYTES;
      const chunk = stableBytes.subarray(offset, Math.min(offset + MAX_ASSET_CHUNK_BYTES, stableBytes.byteLength));
      const frame = encodeCollaborationMessage({ ...common, kind: 'ASSET_CHUNK', index, bytes: chunk }, {
        direction,
        context: expectedContext(context)
      });
      await send(frame);
      chunksSent += 1;
    }

    const end = encodeCollaborationMessage({
      ...common,
      kind: 'ASSET_END',
      assetId,
      byteLength: stableBytes.byteLength,
      sha256: digest
    }, { direction, context: expectedContext(context) });
    await send(end);
    return Object.freeze({ transferId, assetId, assetKind, byteLength: stableBytes.byteLength, chunkCount: chunksSent, sha256: digest });
  } finally {
    stableBytes.fill(0);
    try { channel.bufferedAmountLowThreshold = originalLowThreshold; } catch {}
    release();
  }
}

/**
 * Creates a strict receiver for one peer's direction and identity. Only fully
 * ordered, length-checked, SHA-256 verified assets are returned to the caller.
 */
export function createCollaborationAssetReceiver({
  channel,
  direction,
  context,
  crypto = globalThis.crypto,
  maxBytes = MAX_ASSET_BYTES,
  transferTimeoutMs = DEFAULT_RECEIVE_TIMEOUT_MS
} = {}) {
  assertChannel(channel);
  direction = assertDirection(direction);
  context = normalizeContext(context);
  assertCrypto(crypto);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ASSET_BYTES) fail('INVALID_OPTIONS', 'The receiver asset size bound is invalid.');
  if (!Number.isSafeInteger(transferTimeoutMs) || transferTimeoutMs < 1 || transferTimeoutMs > 120_000) fail('INVALID_OPTIONS', 'The receiver transfer timeout is invalid.');

  const peerContext = expectedContext(context);
  let active = null;
  let activeTimer = 0;
  let releaseChannel = null;
  const seenTransferIds = new Set();
  let queue = Promise.resolve();

  function clearActive() {
    clearTimeout(activeTimer);
    activeTimer = 0;
    if (active?.bytes) active.bytes.fill(0);
    active = null;
    releaseChannel?.();
    releaseChannel = null;
  }

  function refreshActiveTimeout() {
    clearTimeout(activeTimer);
    activeTimer = setTimeout(() => clearActive(), transferTimeoutMs);
  }

  async function process(rawMessage) {
    let message;
    try {
      message = validateCollaborationMessage(rawMessage, { direction, context: peerContext });
    } catch (error) {
      clearActive();
      if (error instanceof CollaborationProtocolError) throw error;
      throw error;
    }
    if (!message.kind.startsWith('ASSET_')) fail('INVALID_MESSAGE', 'The asset receiver accepts only asset-transfer messages.');

    if (message.kind === 'ASSET_BEGIN') {
      if (active) {
        clearActive();
        fail('TRANSFER_IN_PROGRESS', 'A second asset began before the active transfer ended.');
      }
      if (seenTransferIds.has(message.transferId)) fail('REPLAYED_TRANSFER', 'This transfer ID has already been used in this session.');
      if (seenTransferIds.size >= MAX_TRACKED_TRANSFER_IDS) fail('TRANSFER_LIMIT', 'The session has reached its bounded asset transfer count.');
      if (message.byteLength > maxBytes) fail('SIZE_LIMIT', 'The incoming asset exceeds the configured receiver bound.');
      releaseChannel = claimChannel(channel, 'inbound');
      seenTransferIds.add(message.transferId);
      active = {
        transferId: message.transferId,
        assetId: message.assetId,
        assetKind: message.assetKind,
        mimeType: message.mimeType,
        fontMetadata: message.fontMetadata,
        flow: message.flow,
        actorId: message.actorId,
        byteLength: message.byteLength,
        chunkCount: message.chunkCount,
        sha256: message.sha256,
        nextIndex: 0,
        writtenBytes: 0,
        bytes: new Uint8Array(message.byteLength)
      };
      refreshActiveTimeout();
      return null;
    }

    if (!active) fail(message.kind === 'ASSET_CHUNK' ? 'UNEXPECTED_CHUNK' : 'UNEXPECTED_END', 'No asset transfer is active.');
    if (message.transferId !== active.transferId || message.flow !== active.flow
      || message.actorId !== active.actorId || message.assetKind !== active.assetKind) {
      clearActive();
      fail('TRANSFER_MISMATCH', 'Asset transfer context changed between frames.');
    }

    if (message.kind === 'ASSET_CHUNK') {
      if (message.index !== active.nextIndex) {
        const expectedIndex = active.nextIndex;
        clearActive();
        fail('OUT_OF_ORDER_CHUNK', `Expected chunk ${expectedIndex}; received ${message.index}.`);
      }
      const expectedLength = Math.min(MAX_ASSET_CHUNK_BYTES, active.byteLength - active.writtenBytes);
      if (message.bytes.byteLength !== expectedLength) {
        clearActive();
        fail('CHUNK_LENGTH_MISMATCH', 'Asset chunk length does not match the declared transfer length.');
      }
      active.bytes.set(message.bytes, active.writtenBytes);
      active.writtenBytes += message.bytes.byteLength;
      active.nextIndex += 1;
      refreshActiveTimeout();
      return null;
    }

    if (message.assetId !== active.assetId || message.assetKind !== active.assetKind
      || message.byteLength !== active.byteLength || message.sha256 !== active.sha256) {
      clearActive();
      fail('TRANSFER_MISMATCH', 'Asset end metadata does not match the begin frame.');
    }
    if (active.nextIndex !== active.chunkCount || active.writtenBytes !== active.byteLength) {
      const expected = active.nextIndex;
      clearActive();
      fail('INCOMPLETE_TRANSFER', `Asset ended after ${expected} of its declared chunks.`);
    }
    const completed = active;
    // ASSET_END is activity too. Give integrity verification its own bounded
    // window while retaining the timeout in case verification stalls.
    refreshActiveTimeout();
    const digest = await sha256(completed.bytes, crypto);
    if (digest !== completed.sha256) {
      clearActive();
      fail('DIGEST_MISMATCH', 'The received asset failed its SHA-256 integrity check.');
    }
    if (active !== completed) fail('CANCELLED', 'The asset transfer was cancelled before integrity verification completed.');
    active = null;
    clearTimeout(activeTimer);
    activeTimer = 0;
    releaseChannel?.();
    releaseChannel = null;
    return Object.freeze({
      transferId: completed.transferId,
      assetId: completed.assetId,
      assetKind: completed.assetKind,
      mimeType: completed.mimeType,
      fontMetadata: completed.fontMetadata,
      byteLength: completed.byteLength,
      sha256: digest,
      actorId: completed.actorId,
      bytes: completed.bytes
    });
  }

  function accept(rawMessage) {
    const result = queue.then(() => process(rawMessage));
    queue = result.catch(() => {});
    return result;
  }

  return Object.freeze({
    accept,
    acceptFrame(frame) {
      let decoded;
      try { decoded = decodeCollaborationMessage(frame, { direction, context: peerContext }); }
      catch (error) {
        clearActive();
        return Promise.reject(error);
      }
      return accept(decoded);
    },
    cancel() { clearActive(); },
    getActiveTransfer() {
      if (!active) return null;
      return Object.freeze({
        transferId: active.transferId,
        assetId: active.assetId,
        assetKind: active.assetKind,
        byteLength: active.byteLength,
        chunkCount: active.chunkCount,
        receivedChunks: active.nextIndex,
        receivedBytes: active.writtenBytes
      });
    }
  });
}
