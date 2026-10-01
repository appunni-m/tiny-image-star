import { createHostOperationEngine } from './host-operation-engine.js';
import { createGuestForkRecovery } from './guest-fork-recovery.js';
import { createCollaborationAssetReceiver, sendCollaborationAsset } from './asset-transfer.js';
import {
  decodeCollaborationMessage,
  encodeCollaborationMessage,
  validateCollaborationMessage
} from './protocol.js';
import { verifyAnswerCapsule } from './session-capsules.js';
import { createHostWebRtcSession, createGuestWebRtcSession } from './webrtc-session-transport.js';
import {
  consumeAnswerSessionOnce,
  createShareGrant,
  loadShareGrant,
  revokeShareGrant
} from './share-store.js';
import { collectDesignAssetRequirements, commitDesign, openDesign } from '../workspace/design-store.js';
import { readImageAsset, saveImageAsset } from '../workspace/asset-store.js';
import {
  listWorkspaceFontAssets,
  readWorkspaceFontAsset,
  saveWorkspaceFontAsset
} from '../workspace/font-store.js';
import { MAX_ASSET_BYTES } from './protocol.js';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_QUEUED_MESSAGES = 128;
const MAX_QUEUED_MESSAGE_BYTES = 2 * 1024 * 1024;

function queuedMessageBytes(raw) {
  if (typeof raw === 'string') return raw.length * 3;
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  if (ArrayBuffer.isView(raw)) return raw.byteLength;
  return MAX_QUEUED_MESSAGE_BYTES + 1;
}

function enqueueBounded(queueState, raw, run, onOverflow, onFailure) {
  const bytes = queuedMessageBytes(raw);
  if (bytes > MAX_QUEUED_MESSAGE_BYTES
    || queueState.messages + 1 > MAX_QUEUED_MESSAGES
    || queueState.bytes + bytes > MAX_QUEUED_MESSAGE_BYTES) {
    onOverflow();
    return;
  }
  queueState.messages += 1;
  queueState.bytes += bytes;
  queueState.queue = queueState.queue.then(() => run(raw)).catch(onFailure).finally(() => {
    queueState.messages -= 1;
    queueState.bytes -= bytes;
  });
}

function assertId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}
function makeActorId(crypto, prefix) {
  let suffix;
  if (typeof crypto?.randomUUID === 'function') suffix = crypto.randomUUID().replace(/-/g, '');
  else if (typeof crypto?.getRandomValues === 'function') {
    suffix = [...crypto.getRandomValues(new Uint8Array(18))].map(value => value.toString(16).padStart(2, '0')).join('');
  } else throw new Error('Secure random numbers are unavailable.');
  return `${prefix}-${suffix}`;
}
function listen(target, type, handler) {
  target?.addEventListener?.(type, handler);
  return () => target?.removeEventListener?.(type, handler);
}
function safeSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}
function requireWorkspace(workspace, locks) {
  if (!workspace?.workspaceId || typeof workspace.getDesignDirectoryHandle !== 'function') throw new TypeError('A verified writable workspace is required.');
  if (typeof locks?.request !== 'function') throw new Error('Cross-tab Web Locks are required for safe collaboration writes.');
}
function sendMessage(channel, message, direction) {
  if (!channel || channel.readyState !== 'open') throw new Error('The live connection is not open.');
  channel.send(encodeCollaborationMessage(message, {
    direction,
    context: { designId: message.designId, sessionId: message.sessionId, actorId: message.actorId }
  }));
}

function normalizeFamily(family) {
  return String(family || '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function sessionBudget({ maxSessionAssetBytes, maxSessionAssetCount }) {
  if (!Number.isSafeInteger(maxSessionAssetBytes) || maxSessionAssetBytes < 1 || maxSessionAssetBytes > 4 * 1024 * 1024 * 1024
    || !Number.isSafeInteger(maxSessionAssetCount) || maxSessionAssetCount < 1 || maxSessionAssetCount > 4096) {
    throw new RangeError('The live-session asset limits are invalid.');
  }
}

/**
 * Create a host-authoritative live session. Answers are verified and durably consumed
 * before SDP is applied; every guest operation rechecks revocation and is ACKed only
 * after `commitDesign` has closed, reopened, and advanced the workspace HEAD.
 */
export async function createHostSessionController({
  workspace,
  designId,
  iceServers = [],
  locks = globalThis.navigator?.locks,
  crypto = globalThis.crypto,
  now = () => Date.now(),
  onState = () => {},
  onSnapshot = () => {},
  peerConnectionFactory = globalThis.RTCPeerConnection,
  createTransport = createHostWebRtcSession,
  loadGrant = loadShareGrant,
  createGrant = createShareGrant,
  revokeGrant = revokeShareGrant,
  verifyAnswer = verifyAnswerCapsule,
  consumeAnswer = consumeAnswerSessionOnce,
  open = openDesign,
  commit = commitDesign,
  readImage = readImageAsset,
  listFonts = listWorkspaceFontAssets,
  readFont = readWorkspaceFontAsset,
  acceptImage = saveImageAsset,
  acceptFont = saveWorkspaceFontAsset,
  approveIncomingAsset = async () => false,
  sendAsset = sendCollaborationAsset,
  onAssetTransfer = () => {},
  maxSessionAssetBytes = 512 * 1024 * 1024,
  maxSessionAssetCount = 256,
  handshakeTimeoutMs = 20_000
} = {}) {
  requireWorkspace(workspace, locks);
  assertId(designId, 'Design ID');
  if (typeof handshakeTimeoutMs !== 'number' || !Number.isFinite(handshakeTimeoutMs) || handshakeTimeoutMs < 1 || handshakeTimeoutMs > 120_000) {
    throw new RangeError('The collaboration handshake timeout is invalid.');
  }
  sessionBudget({ maxSessionAssetBytes, maxSessionAssetCount });
  let state = 'preparing';
  let grant = await loadGrant(workspace, designId, { locks, crypto });
  if (!grant) grant = await createGrant(workspace, designId, { locks, crypto, now: now() });
  let durable = await open(workspace, designId, { locks, crypto });
  if (durable.designId !== designId || durable.document.id !== designId || !durable.pageIds.length) throw new Error('The opened workspace design identity is inconsistent.');
  const hostActorId = makeActorId(crypto, 'host');
  let transport;
  let engine = null;
  let guestActorId = null;
  let assetReceiver = null;
  let receivedAssetCount = 0;
  let receivedAssetBytes = 0;
  let incomingReservation = null;
  let disposed = false;
  const messageQueue = { queue: Promise.resolve(), messages: 0, bytes: 0 };
  let handshakeTimer = 0;
  const removers = [];
  const emit = next => { state = next; try { onState(next); } catch {} };
  const sessionId = () => transport?.session?.sessionId;
  const baseContext = () => ({ v: 1, designId, sessionId: sessionId(), actorId: hostActorId });

  function close(reason = 'closed') {
    if (disposed) return;
    disposed = true;
    clearTimeout(handshakeTimer);
    assetReceiver?.cancel?.();
    for (const remove of removers.splice(0)) { try { remove(); } catch {} }
    try { transport?.close?.(); } catch {}
    emit(reason);
  }

  function rejectGuest(message, code = 'PERMISSION_DENIED') {
    const opId = typeof message?.operation?.opId === 'string' && ID.test(message.operation.opId) ? message.operation.opId : 'invalid-operation';
    try {
      sendMessage(transport?.dataChannel, {
        ...baseContext(), kind: 'REJECT',
        opId, revision: engine?.getRevision?.() ?? durable.head.sequence,
        headHash: engine?.getHeadHash?.() ?? durable.head.commitHash, code
      }, 'host-to-guest');
    } catch {}
    close(code === 'CONFLICT' || code === 'STALE_REVISION' ? 'diverged' : 'rejected');
  }

  async function activeGrantOrClose() {
    const active = await loadGrant(workspace, designId, { locks, crypto });
    if (!active || active.shareId !== grant.shareId) {
      close('revoked');
      throw new Error('This live sharing link has been revoked.');
    }
  }

  async function acceptIncomingAsset(asset) {
    if (++receivedAssetCount > maxSessionAssetCount || receivedAssetBytes + asset.byteLength > maxSessionAssetBytes) {
      asset.bytes.fill(0);
      throw new Error('The guest exceeded this live session’s asset transfer budget.');
    }
    receivedAssetBytes += asset.byteLength;
    try {
      await locks.request(`tiny-image-star-share-edit:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
        await activeGrantOrClose();
        if (disposed) throw new Error('The live session was revoked before the asset could be stored.');
        if (asset.assetKind === 'image') {
          await acceptImage(workspace, designId, asset.assetId, asset.bytes, { mimeType: asset.mimeType, locks, crypto });
        } else {
          const fontMetadata = asset.fontMetadata;
          if (!fontMetadata) throw new Error('The incoming font is missing its family metadata.');
          await acceptFont(workspace, designId, {
            id: asset.assetId,
            name: fontMetadata.name,
            type: asset.mimeType,
            family: fontMetadata.family,
            weight: fontMetadata.weight,
            style: fontMetadata.style,
            bytes: asset.bytes
          }, { locks, crypto });
        }
      });
      try { onAssetTransfer({ phase: 'received', ...asset, bytes: undefined, totalBytes: receivedAssetBytes, count: receivedAssetCount }); } catch {}
    } finally {
      asset.bytes.fill(0);
    }
  }

  async function sendSnapshotAssets() {
    const requirements = collectDesignAssetRequirements(durable.document);
    let count = 0;
    let totalBytes = 0;
    const transfer = async ({ assetId, assetKind, mimeType, bytes, fontMetadata = null }) => {
      if (++count > maxSessionAssetCount || totalBytes + bytes.byteLength > maxSessionAssetBytes) {
        bytes.fill?.(0);
        throw new Error('The design assets exceed this live session’s transfer budget.');
      }
      totalBytes += bytes.byteLength;
      emit('sending-assets');
      const result = await sendAsset(transport.dataChannel, {
        context: { v: 1, designId, sessionId: sessionId(), actorId: hostActorId },
        direction: 'host-to-guest',
        transferId: makeActorId(crypto, 'transfer'), assetId, assetKind, mimeType, fontMetadata, bytes, crypto
      });
      try { onAssetTransfer({ phase: 'sent', ...result, totalBytes, count }); } catch {}
      return result;
    };

    for (const assetId of requirements.imageAssetIds) {
      const asset = await readImage(workspace, designId, assetId, { crypto });
      await transfer({ assetId, assetKind: 'image', mimeType: asset.metadata.mimeType, bytes: asset.bytes });
    }

    if (requirements.fontSpecs.length) {
      const specKeys = new Set(requirements.fontSpecs.map(spec => `${spec.family}\u0000${spec.weight}\u0000${spec.style}`));
      let fonts = [];
      try { fonts = await listFonts(workspace, designId, { crypto }); }
      catch (error) { if (error?.code !== 'FONT_NOT_FOUND') throw error; }
      const sentFaces = new Set();
      for (const font of fonts) {
        const meta = font.metadata;
        const key = `${normalizeFamily(meta.family)}\u0000${meta.weight}\u0000${meta.style}`;
        if (!specKeys.has(key) || sentFaces.has(key)) continue;
        sentFaces.add(key);
        await transfer({
          assetId: meta.id,
          assetKind: 'font',
          mimeType: meta.type,
          bytes: font.bytes,
          fontMetadata: { name: meta.name, family: meta.family, weight: meta.weight, style: meta.style }
        });
      }
    }
  }

  async function acceptHello(message) {
    if (guestActorId || message.designId !== designId || message.sessionId !== sessionId() || message.lastRevision < 0) {
      rejectGuest(message, 'PERMISSION_DENIED');
      return;
    }
    guestActorId = message.actorId;
    clearTimeout(handshakeTimer);
    engine = createHostOperationEngine({
      designId,
      sessionId: sessionId(),
      hostActorId,
      guestActorIds: [guestActorId],
      snapshot: durable.document,
      revision: durable.head.sequence,
      headHash: durable.head.commitHash,
      commit: async input => {
        await activeGrantOrClose();
        const saved = await commit(workspace, designId, input.snapshot, {
          expectedHead: durable.head,
          pageId: input.snapshot.activePageId || durable.pageIds[0],
          locks,
          crypto
        });
        if (saved.head.sequence !== input.revision) throw new Error('The durable workspace revision moved unexpectedly.');
        durable = saved;
        try { onSnapshot(safeSnapshot(saved.document), saved.head); } catch {}
        return saved;
      }
    });
    assetReceiver = createCollaborationAssetReceiver({
      channel: transport.dataChannel,
      direction: 'guest-to-host',
      context: { v: 1, designId, sessionId: sessionId(), actorId: guestActorId },
      crypto,
      maxBytes: MAX_ASSET_BYTES
    });
    sendMessage(transport.dataChannel, {
      ...baseContext(), kind: 'WELCOME', hostActorId, revision: durable.head.sequence, headHash: durable.head.commitHash
    }, 'host-to-guest');
    await sendSnapshotAssets();
    sendMessage(transport.dataChannel, {
      ...baseContext(), kind: 'SNAPSHOT', revision: durable.head.sequence, headHash: durable.head.commitHash,
      snapshot: safeSnapshot(durable.document)
    }, 'host-to-guest');
    emit('connected');
  }

  async function receive(raw) {
    if (disposed) return;
    let message;
    const expectedContext = { designId, sessionId: sessionId(), ...(guestActorId ? { actorId: guestActorId } : {}) };
    try { message = decodeCollaborationMessage(raw, { direction: 'guest-to-host', context: expectedContext }); }
    catch { rejectGuest(null, 'INVALID_OPERATION'); return; }
    try {
      if (message.kind.startsWith('ASSET_')) {
        if (!assetReceiver || message.actorId !== guestActorId) { rejectGuest(message, 'PERMISSION_DENIED'); return; }
        if (message.kind === 'ASSET_BEGIN') {
          if (incomingReservation || receivedAssetCount + 1 > maxSessionAssetCount
            || receivedAssetBytes + message.byteLength > maxSessionAssetBytes) {
            throw new Error('The guest exceeded this live session’s asset transfer budget.');
          }
          const approved = await approveIncomingAsset({
            direction: 'guest-to-host', assetId: message.assetId, assetKind: message.assetKind,
            mimeType: message.mimeType, byteLength: message.byteLength, fontMetadata: message.fontMetadata
          });
          if (approved !== true) { rejectGuest(message, 'PERMISSION_DENIED'); return; }
          incomingReservation = { transferId: message.transferId, byteLength: message.byteLength };
        }
        const completed = await assetReceiver.accept(message);
        if (completed) {
          incomingReservation = null;
          await acceptIncomingAsset(completed);
        }
        return;
      }
      if (message.kind === 'HELLO') { await acceptHello(message); return; }
      if (!engine || !guestActorId || message.actorId !== guestActorId
        || message.designId !== designId || message.sessionId !== sessionId()) {
        rejectGuest(message, 'PERMISSION_DENIED'); return;
      }
      if (message.kind === 'FORK_NOTICE') { close('guest-forked'); return; }
      if (message.kind !== 'OPERATION') { rejectGuest(message, 'UNSUPPORTED_OPERATION'); return; }
      await locks.request(`tiny-image-star-share-edit:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
        await activeGrantOrClose();
        if (disposed) return;
        const result = await engine.apply(message);
        if (disposed) return;
        sendMessage(transport.dataChannel, result, 'host-to-guest');
        if (result.kind === 'ACK') emit('connected');
        else close(result.code === 'STALE_REVISION' || result.code === 'CONFLICT' ? 'diverged' : 'rejected');
      });
    } catch (error) {
      if (!disposed) {
        if (error?.code === 'SHARE_REVOKED' || /revoked/i.test(error?.message || '')) close('revoked');
        else rejectGuest(message, 'CONFLICT');
      }
    }
  }

  try {
    transport = await createTransport({
      invite: grant.invite,
      identityPrivateKey: grant.identityPrivateKey,
      iceServers,
      crypto,
      now,
      peerConnectionFactory
    });
  } catch (error) {
    emit('failed');
    throw error;
  }
  const channel = transport.dataChannel;
  if (!channel) { close('failed'); throw new Error('The host WebRTC channel was not created.'); }
  removers.push(listen(channel, 'message', event => {
    enqueueBounded(messageQueue, event?.data, receive,
      () => close('overloaded'), () => close('failed'));
  }));
  removers.push(listen(channel, 'close', () => close('disconnected')));
  removers.push(listen(channel, 'error', () => close('failed')));
  emit('waiting-answer');
  handshakeTimer = setTimeout(() => close('timeout'), handshakeTimeoutMs);

  return Object.freeze({
    role: 'host',
    get state() { return state; },
    get offerCapsule() { return transport.offerCapsule; },
    get invitation() { return grant.encodedInvite; },
    get shareId() { return grant.shareId; },
    get head() { return durable.head; },
    acceptAnswer: async answerCapsule => {
      if (disposed || state !== 'waiting-answer') throw new Error('This host session is not waiting for an answer.');
      emit('verifying-answer');
      let answer;
      try { answer = await verifyAnswer(answerCapsule, transport.offerCapsule, { expectedInvite: grant.invite, now: now(), crypto }); }
      catch (error) { emit('waiting-answer'); throw error; }
      try { await consumeAnswer(workspace, answer, { locks, now: now() }); }
      catch (error) { emit('waiting-answer'); throw error; }
      const active = await loadGrant(workspace, designId, { locks, crypto });
      if (!active || active.shareId !== grant.shareId) { close('revoked'); throw new Error('This live sharing link has been revoked.'); }
      emit('connecting');
      try {
        await transport.acceptAnswer(answerCapsule);
        await transport.waitForOpen();
      } catch (error) {
        close('failed');
        throw error;
      }
      if (disposed) throw new Error('The host session closed before the guest was ready.');
      emit('waiting-guest');
      return true;
    },
    revoke: async () => {
      return locks.request(`tiny-image-star-share-edit:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
        const revoked = await revokeGrant(workspace, designId, { locks, now: now() });
        if (revoked) close('revoked');
        return revoked;
      });
    },
    close: () => close('closed')
  });
}

/**
 * Guest-side session adapter. It only reports a saved revision after the host ACK;
 * rejection or transport loss freezes further proposals and calls persistFork first.
 */
export async function createGuestSessionController({
  offerCapsule,
  expectedInvite,
  iceServers = [],
  crypto = globalThis.crypto,
  now = () => Date.now(),
  peerConnectionFactory = globalThis.RTCPeerConnection,
  createTransport = createGuestWebRtcSession,
  persistFork,
  onState = () => {},
  onSnapshot = () => {},
  onFork = () => {},
  closeSession = () => {},
  onAsset,
  approveIncomingAsset = async () => false,
  sendAsset = sendCollaborationAsset,
  onAssetTransfer = () => {},
  maxSessionAssetBytes = 512 * 1024 * 1024,
  maxSessionAssetCount = 256,
  maxPendingOperations = 256,
  maxPendingBytes = 2 * 1024 * 1024
} = {}) {
  assertId(expectedInvite?.designId, 'Design ID');
  if (typeof persistFork !== 'function') throw new TypeError('A local fork persistence callback is required.');
  sessionBudget({ maxSessionAssetBytes, maxSessionAssetCount });
  const designId = expectedInvite.designId;
  let state = 'preparing-answer';
  let transport;
  let disposed = false;
  let hostActorId = null;
  let hostRevision = null;
  let hostHeadHash = null;
  let recovery = null;
  let lastSnapshot = null;
  let assetReceiver = null;
  let receivedAssetCount = 0;
  let receivedAssetBytes = 0;
  let incomingReservation = null;
  const receivedAssetIds = new Set();
  let outgoingAssetCount = 0;
  let outgoingAssetBytes = 0;
  let outgoingAssetInProgress = false;
  let operationCounter = 0;
  const messageQueue = { queue: Promise.resolve(), messages: 0, bytes: 0 };
  const pendingByOp = new Map();
  const removers = [];
  const actorId = makeActorId(crypto, 'guest');
  const emit = next => { state = next; try { onState(next); } catch {} };
  const context = () => ({ v: 1, designId, sessionId: transport.session.sessionId, actorId });

  async function freezeWithFork(reason) {
    if (!recovery) { emit('disconnected-before-snapshot'); try { transport?.close?.(); } catch {} return null; }
    const result = reason?.kind === 'REJECT'
      ? await recovery.reject(reason)
      : await recovery.disconnect(reason);
    emit(result.status);
    try { onFork(result); } catch {}
    return result;
  }

  function closeFromRecovery() {
    disposed = true;
    assetReceiver?.cancel?.();
    for (const remove of removers.splice(0)) { try { remove(); } catch {} }
    try { transport?.close?.(); } catch {}
    try { closeSession({ designId, sessionId: transport?.session?.sessionId }); } catch {}
  }

  async function receive(raw) {
    if (disposed) return;
    const expectedContext = { designId, sessionId: transport.session.sessionId, ...(hostActorId ? { actorId: hostActorId } : {}) };
    const message = decodeCollaborationMessage(raw, { direction: 'host-to-guest', context: expectedContext });
    if (message.designId !== designId || message.sessionId !== transport.session.sessionId) throw new Error('A message belongs to a different live session.');
    if (message.kind.startsWith('ASSET_')) {
      if (!assetReceiver || message.actorId !== hostActorId) throw new Error('An asset arrived before the host identity was authenticated.');
      if (message.kind === 'ASSET_BEGIN') {
        if (incomingReservation || receivedAssetCount + 1 > maxSessionAssetCount
          || receivedAssetBytes + message.byteLength > maxSessionAssetBytes) {
          throw new Error('The host exceeded this live session’s asset transfer budget.');
        }
        const approved = await approveIncomingAsset({
          direction: 'host-to-guest', assetId: message.assetId, assetKind: message.assetKind,
          mimeType: message.mimeType, byteLength: message.byteLength, fontMetadata: message.fontMetadata
        });
        if (approved !== true) throw new Error('This shared asset was declined.');
        incomingReservation = { transferId: message.transferId, byteLength: message.byteLength };
      }
      const completed = await assetReceiver.accept(message);
      if (completed) {
        incomingReservation = null;
        if (typeof onAsset !== 'function') {
          completed.bytes.fill(0);
          throw new Error('This guest needs a local asset handler before receiving shared design images or fonts.');
        }
        if (++receivedAssetCount > maxSessionAssetCount || receivedAssetBytes + completed.byteLength > maxSessionAssetBytes) {
          completed.bytes.fill(0);
          throw new Error('The host exceeded this live session’s asset transfer budget.');
        }
        receivedAssetBytes += completed.byteLength;
        try {
          await onAsset({ ...completed, bytes: completed.bytes.slice() });
          if (completed.assetKind === 'image') receivedAssetIds.add(completed.assetId);
          try { onAssetTransfer({ phase: 'received', ...completed, bytes: undefined, totalBytes: receivedAssetBytes, count: receivedAssetCount }); } catch {}
        } finally { completed.bytes.fill(0); }
      }
      return;
    }
    if (message.kind === 'WELCOME') {
      if (hostActorId || message.actorId !== message.hostActorId) throw new Error('The host identity changed during this session.');
      hostActorId = message.hostActorId;
      hostRevision = message.revision;
      hostHeadHash = message.headHash;
      assetReceiver = createCollaborationAssetReceiver({
        channel: transport.dataChannel,
        direction: 'host-to-guest',
        context: { v: 1, designId, sessionId: transport.session.sessionId, actorId: hostActorId },
        crypto,
        maxBytes: MAX_ASSET_BYTES
      });
      return;
    }
    if (message.actorId !== hostActorId) throw new Error('A message was not sent by the authenticated host.');
    if (message.kind === 'SNAPSHOT') {
      if (hostRevision == null || message.revision !== hostRevision || message.headHash !== hostHeadHash) {
        throw new Error('The host snapshot does not match the exact head announced in its welcome message.');
      }
      if (!recovery) {
        lastSnapshot = safeSnapshot(message.snapshot);
        const requirements = collectDesignAssetRequirements(lastSnapshot);
        const missingImages = requirements.imageAssetIds.filter(assetId => !receivedAssetIds.has(assetId));
        if (missingImages.length) throw new Error(`The host snapshot is missing ${missingImages.length} referenced image assets.`);
        recovery = createGuestForkRecovery({
          designId,
          sessionId: transport.session.sessionId,
          hostHead: { sequence: hostRevision, commitHash: hostHeadHash },
          hostRevision,
          initialReplicaSnapshot: lastSnapshot,
          persistFork,
          closeSession: closeFromRecovery,
          maxPendingOperations,
          maxPendingBytes
        });
        emit('connected');
        try { onSnapshot(safeSnapshot(lastSnapshot), hostRevision, { sequence: hostRevision, commitHash: hostHeadHash }); } catch {}
        return;
      }
      if (recovery.state.pendingOperations.length) {
        void freezeWithFork({ type: 'diverged', reason: 'host-snapshot-advanced-with-pending-edits', revision: message.revision });
        return;
      }
      if (message.revision !== recovery.state.acknowledgedRevision || message.headHash !== recovery.state.hostHead.commitHash) {
        void freezeWithFork({ type: 'diverged', reason: 'host-snapshot-advanced', revision: message.revision });
      }
      return;
    }
    if (message.kind === 'ACK') {
      const operation = pendingByOp.get(message.opId);
      if (!operation) throw new Error('The host acknowledged an unknown operation.');
      const result = recovery.acknowledge(message, {
        snapshot: operation.snapshot, revision: message.revision,
        head: { sequence: message.revision, commitHash: message.headHash }
      });
      if (!result.accepted) throw new Error(`The host ACK could not be applied: ${result.reason}.`);
      pendingByOp.delete(message.opId);
      lastSnapshot = operation.snapshot;
      hostRevision = message.revision;
      hostHeadHash = message.headHash;
      emit(recovery.state.pendingOperations.length ? 'pending' : 'connected');
      try { onSnapshot(safeSnapshot(lastSnapshot), hostRevision, recovery.state.hostHead); } catch {}
      return;
    }
    if (message.kind === 'REJECT') {
      void freezeWithFork(message);
      return;
    }
    if (message.kind === 'FORK_NOTICE') {
      void freezeWithFork({ type: 'diverged', reason: message.reason, baseRevision: message.baseRevision });
      return;
    }
    throw new Error(`Unexpected host message ${message.kind}.`);
  }

  try {
    transport = await createTransport({ offerCapsule, expectedInvite, iceServers, crypto, now, peerConnectionFactory });
  } catch (error) {
    emit('failed');
    throw error;
  }
  const channel = transport.dataChannel;
  if (!channel) { transport.close(); emit('failed'); throw new Error('The guest WebRTC channel was not created.'); }
  removers.push(listen(channel, 'message', event => {
    enqueueBounded(messageQueue, event?.data, receive,
      () => { void freezeWithFork({ type: 'protocol-error', reason: 'message-queue-limit' }); },
      error => { void freezeWithFork({ type: 'protocol-error', message: error.message }); });
  }));
  removers.push(listen(channel, 'close', () => { void freezeWithFork('transport-disconnected'); }));
  removers.push(listen(channel, 'error', () => { void freezeWithFork('transport-error'); }));
  emit('answer-ready');
  const ready = transport.waitForOpen().then(() => {
    if (disposed) throw new Error('The guest session was closed before it connected.');
    emit('authenticating');
    sendMessage(channel, { ...context(), kind: 'HELLO', lastRevision: 0 }, 'guest-to-host');
    return true;
  }).catch(error => {
    void freezeWithFork({ type: 'connection-failed', message: error?.message || 'Connection failed.' });
    throw error;
  });

  return Object.freeze({
    role: 'guest',
    actorId,
    get sessionId() { return transport.session.sessionId; },
    get state() { return state; },
    get answerCapsule() { return transport.answerCapsule; },
    get snapshot() { return lastSnapshot && safeSnapshot(lastSnapshot); },
    get revision() { return recovery?.state.acknowledgedRevision ?? hostRevision; },
    get fork() { return recovery?.state ?? null; },
    ready,
    async sendAsset(asset) {
      if (!recovery || state !== 'connected') throw new Error('The host snapshot is not ready for asset transfer.');
      if (outgoingAssetInProgress) throw new Error('Wait for the current asset transfer to finish before sending another.');
      if (!asset || !['image', 'font'].includes(asset.assetKind) || !(asset.bytes instanceof Uint8Array)
        || !Number.isSafeInteger(asset.bytes.byteLength) || asset.bytes.byteLength < 1 || asset.bytes.byteLength > MAX_ASSET_BYTES) {
        throw new TypeError('A bounded image or font asset is required.');
      }
      if (outgoingAssetCount + 1 > maxSessionAssetCount || outgoingAssetBytes + asset.bytes.byteLength > maxSessionAssetBytes) {
        throw new Error('This guest exceeded the live session’s asset transfer budget.');
      }
      outgoingAssetInProgress = true;
      try {
        const result = await sendAsset(channel, {
          context: { v: 1, designId, sessionId: transport.session.sessionId, actorId },
          direction: 'guest-to-host',
          transferId: makeActorId(crypto, 'transfer'),
          assetId: asset.assetId,
          assetKind: asset.assetKind,
          mimeType: asset.mimeType,
          fontMetadata: asset.assetKind === 'font' ? asset.fontMetadata : null,
          bytes: asset.bytes,
          crypto
        });
        outgoingAssetCount += 1;
        outgoingAssetBytes += asset.bytes.byteLength;
        try { onAssetTransfer({ phase: 'sent', ...result, totalBytes: outgoingAssetBytes, count: outgoingAssetCount }); } catch {}
        return result;
      } finally { outgoingAssetInProgress = false; }
    },
    proposeSnapshot(snapshot) {
      if (!recovery || !['connected', 'pending'].includes(state)) throw new Error('The host snapshot is not ready for editing.');
      if (outgoingAssetInProgress) throw new Error('Wait for the current asset transfer to finish before applying its design changes.');
      const operation = {
        type: 'ReplaceSnapshot',
        opId: makeActorId(crypto, `op${++operationCounter}`),
        baseRevision: recovery.state.acknowledgedRevision + recovery.state.pendingOperations.length,
        snapshot: safeSnapshot(snapshot)
      };
      const proposal = recovery.propose(operation);
      pendingByOp.set(proposal.opId, proposal);
      sendMessage(channel, { ...context(), kind: 'OPERATION', operation: proposal }, 'guest-to-host');
      emit('pending');
      return proposal.opId;
    },
    async retryForkSave() {
      if (!recovery) throw new Error('There is no local fork to retry yet.');
      const result = await recovery.retrySave();
      emit(result.status);
      try { onFork(result); } catch {}
      return result;
    },
    close: () => { if (disposed) return; void freezeWithFork('user-closed'); }
  });
}
