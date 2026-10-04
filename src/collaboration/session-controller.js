import { createHostOperationEngine } from './host-operation-engine.js';
import { createGuestForkRecovery } from './guest-fork-recovery.js';
import { createCollaborationAssetReceiver, sendCollaborationAsset } from './asset-transfer.js';
import {
  COLLABORATION_PROTOCOL_VERSION,
  decodeCollaborationMessage,
  encodeCollaborationMessage,
  validateCollaborationMessage
} from './protocol.js';
import { verifyAnswerCapsule } from './session-capsules.js';
import { planGuestOperationSnapshots } from './guest-operation-planner.js';
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

function createSignalWaiter(waiters, key, timeoutMs, signal, timeoutMessage) {
  if (waiters.has(key)) throw new Error('A duplicate collaboration signal is already pending.');
  let timer;
  let abortHandler;
  let settled = false;
  let resolvePromise;
  let rejectPromise;
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abortHandler);
    waiters.delete(key);
  };
  const finish = error => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) rejectPromise(error);
    else resolvePromise();
  };
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  abortHandler = () => finish(new Error('The live asset transfer was cancelled.'));
  waiters.set(key, finish);
  timer = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
  signal?.addEventListener?.('abort', abortHandler, { once: true });
  if (signal?.aborted) abortHandler();
  return {
    promise,
    cancel: reason => finish(reason instanceof Error ? reason : new Error('The live asset transfer was cancelled.'))
  };
}

function resolveSignalWaiter(waiters, key) {
  const finish = waiters.get(key);
  if (!finish) return false;
  finish();
  return true;
}

async function synchronizeAssetChannel({
  assetChannel, context, direction, waiters, timeoutMs, signal, crypto
}) {
  const barrierId = makeActorId(crypto, 'barrier');
  const waiter = createSignalWaiter(
    waiters, barrierId, timeoutMs, signal, 'The peer did not confirm that the image assets were saved.'
  );
  try {
    sendMessage(assetChannel, { ...context, kind: 'ASSET_BARRIER', barrierId }, direction);
    await waiter.promise;
  } catch (error) {
    waiter.cancel(error);
    throw error;
  }
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
export async function createHostSessionController(options = {}) {
  const {
    workspace,
    designId,
    iceServers = [],
    locks = globalThis.navigator?.locks,
    crypto = globalThis.crypto,
    now = () => Date.now(),
    scheduleTimeout = globalThis.setTimeout?.bind(globalThis),
    cancelTimeout = globalThis.clearTimeout?.bind(globalThis),
    onState = () => {},
    onSnapshot = () => {},
    onPresence = () => {},
    getViewState = () => null,
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
    maxRoomPeers = 4,
    handshakeTimeoutMs = 20_000,
    assetBarrierTimeoutMs = 30_000,
    room: sharedRoom = null
  } = options;
  requireWorkspace(workspace, locks);
  assertId(designId, 'Design ID');
  if (typeof handshakeTimeoutMs !== 'number' || !Number.isFinite(handshakeTimeoutMs) || handshakeTimeoutMs < 1 || handshakeTimeoutMs > 120_000) {
    throw new RangeError('The collaboration handshake timeout is invalid.');
  }
  if (!Number.isSafeInteger(assetBarrierTimeoutMs) || assetBarrierTimeoutMs < 1 || assetBarrierTimeoutMs > 120_000) {
    throw new RangeError('The collaboration asset barrier timeout is invalid.');
  }
  if (typeof scheduleTimeout !== 'function' || typeof cancelTimeout !== 'function') {
    throw new TypeError('Collaboration timeout functions are unavailable.');
  }
  sessionBudget({ maxSessionAssetBytes, maxSessionAssetCount });
  let state = 'preparing';
  if (!Number.isSafeInteger(maxRoomPeers) || maxRoomPeers < 1 || maxRoomPeers > 8) throw new RangeError('A live room supports between one and eight guests.');
  let grant = sharedRoom?.grant ?? await loadGrant(workspace, designId, { locks, crypto });
  if (!grant) grant = await createGrant(workspace, designId, { locks, crypto, now: now() });
  let durable = sharedRoom?.durable ?? await open(workspace, designId, { locks, crypto });
  if (durable.designId !== designId || durable.document.id !== designId || !durable.pageIds.length) throw new Error('The opened workspace design identity is inconsistent.');
  const hostActorId = sharedRoom?.hostActorId ?? makeActorId(crypto, 'host');
  const roomState = sharedRoom || {
    workspaceId: workspace.workspaceId,
    designId,
    grant,
    durable,
    hostActorId,
    maxPeers: maxRoomPeers,
    maxAssetBytes: maxSessionAssetBytes,
    maxAssetCount: maxSessionAssetCount,
    engine: null,
    members: new Map(),
    sessions: new Set(),
    snapshotListeners: new Set(),
    primarySnapshotCallback: onSnapshot,
    primarySnapshotListener: null,
    viewStateSequence: 0,
    hostPresenceSequence: 0,
    presences: new Map(),
    presenceSequences: new Map(),
    transferredAssetBytes: 0,
    transferredAssetCount: 0,
    stopped: false,
    stopAll: null
  };
  if (roomState.designId !== designId || roomState.workspaceId !== workspace.workspaceId
    || roomState.grant.shareId !== grant.shareId || roomState.hostActorId !== hostActorId) {
    throw new Error('The live peer does not belong to the active design room.');
  }
  if (roomState.maxAssetBytes !== maxSessionAssetBytes || roomState.maxAssetCount !== maxSessionAssetCount) {
    throw new Error('Every peer in a live room must use the same aggregate asset budget.');
  }
  if (roomState.stopped) throw new Error('This live room has already been stopped.');
  if (roomState.sessions.size >= roomState.maxPeers) throw new Error(`This live room has reached its ${roomState.maxPeers}-guest limit.`);
  const sessionSlot = { close: null };
  roomState.sessions.add(sessionSlot);
  let transport;
  let engine = roomState.engine;
  let guestActorId = null;
  let assetReceiver = null;
  let incomingReservation = null;
  let disposed = false;
  const messageQueue = { queue: Promise.resolve(), messages: 0, bytes: 0 };
  const assetMessageQueue = { queue: Promise.resolve(), messages: 0, bytes: 0 };
  let handshakeTimer = null;
  const removers = [];
  const emit = next => { state = next; try { onState(next); } catch {} };
  const sessionId = () => transport?.session?.sessionId;
  const baseContext = () => ({ v: COLLABORATION_PROTOCOL_VERSION, designId, sessionId: sessionId(), actorId: hostActorId });
  const ownsRoom = !sharedRoom;
  const snapshotListener = (snapshot, head) => {
    if (ownsRoom ? !roomState.stopped : !disposed) {
      try { onSnapshot(safeSnapshot(snapshot), head); } catch {}
    }
  };
  const registeredSnapshotListener = ownsRoom || onSnapshot !== roomState.primarySnapshotCallback;
  if (ownsRoom) roomState.primarySnapshotListener = snapshotListener;
  if (registeredSnapshotListener) roomState.snapshotListeners.add(snapshotListener);

  if (!roomState.stopAll) {
    roomState.stopAll = reason => {
      if (roomState.stopped) return;
      roomState.stopped = true;
      for (const slot of [...roomState.sessions]) {
        try { slot.close?.(reason); } catch {}
      }
      roomState.snapshotListeners.clear();
      roomState.primarySnapshotListener = null;
    };
  }

  function close(reason = 'closed') {
    if (disposed) return;
    disposed = true;
    roomState.sessions.delete(sessionSlot);
    if (registeredSnapshotListener && !ownsRoom) roomState.snapshotListeners.delete(snapshotListener);
    if (guestActorId) {
      const member = roomState.members.get(guestActorId);
      if (member?.sessionId === sessionId()) {
        const activePresence = roomState.presences.get(guestActorId);
        if (activePresence) {
          const sequence = Math.max(
            roomState.presenceSequences.get(guestActorId) || 0,
            activePresence.sequence
          );
          if (sequence >= Number.MAX_SAFE_INTEGER) {
            roomState.presenceSequences.set(guestActorId, Number.MAX_SAFE_INTEGER);
          } else {
            roomState.presenceSequences.set(guestActorId, sequence + 1);
          }
          const inactive = {
            ...activePresence,
            sequence: Math.min(Number.MAX_SAFE_INTEGER, sequence + 1),
            active: false, cursorX: null, cursorY: null, selectedIds: []
          };
          roomState.presences.delete(guestActorId);
          try { onPresence({ ...inactive }); } catch {}
          for (const other of roomState.members.values()) {
            if (other !== member && other.ready) {
              try {
                sendMessage(other.channel, {
                  v: COLLABORATION_PROTOCOL_VERSION, kind: 'PRESENCE', designId, sessionId: other.sessionId, actorId: hostActorId,
                  ...inactive
                }, 'host-to-guest');
              } catch { other.close('failed'); }
            }
          }
        }
        roomState.members.delete(guestActorId);
        try { member.abortController?.abort(reason); } catch {}
        member.queuedRevisions.length = 0;
        member.queuedRevisionBytes = 0;
      }
      try { roomState.engine?.removeGuestSession?.(guestActorId, sessionId()); } catch {}
    }
    if (incomingReservation) {
      incomingReservation.release?.();
      incomingReservation = null;
    }
    if (handshakeTimer != null) cancelTimeout(handshakeTimer);
    handshakeTimer = null;
    assetReceiver?.cancel?.();
    for (const remove of removers.splice(0)) { try { remove(); } catch {} }
    try { transport?.close?.(); } catch {}
    emit(reason);
  }
  sessionSlot.close = close;

  function publishViewState(viewState) {
    if (roomState.stopped || !roomState.engine || roomState.members.size === 0) return false;
    if (!viewState || !roomState.engine.hasPageId(viewState.pageId)) return false;
    if (roomState.viewStateSequence >= Number.MAX_SAFE_INTEGER) throw new Error('The live view sequence limit was reached.');
    const sequence = roomState.viewStateSequence + 1;
    for (const member of roomState.members.values()) {
      if (!member.ready) continue;
      sendMessage(member.channel, {
        v: COLLABORATION_PROTOCOL_VERSION, kind: 'VIEW_STATE', designId, sessionId: member.sessionId, actorId: hostActorId,
        sequence, pageId: viewState.pageId, zoom: viewState.zoom,
        centerX: viewState.centerX, centerY: viewState.centerY
      }, 'host-to-guest');
    }
    roomState.engine.setActivePageId(viewState.pageId);
    roomState.viewStateSequence = sequence;
    return true;
  }

  function publishPresence(presence) {
    if (roomState.stopped || !roomState.engine || !presence
      || !roomState.engine.hasPageId(presence.pageId)) return false;
    if (roomState.hostPresenceSequence >= Number.MAX_SAFE_INTEGER) throw new Error('The live presence sequence limit was reached.');
    const record = {
      peerActorId: hostActorId,
      sequence: ++roomState.hostPresenceSequence,
      active: presence.active !== false,
      pageId: presence.pageId,
      cursorX: presence.active === false ? null : (presence.cursorX ?? null),
      cursorY: presence.active === false ? null : (presence.cursorY ?? null),
      selectedIds: presence.active === false ? [] : [...new Set((presence.selectedIds || []).slice(0, 128))]
    };
    validateCollaborationMessage({ ...baseContext(), kind: 'PRESENCE', ...record });
    if (record.active) roomState.presences.set(hostActorId, record);
    else roomState.presences.delete(hostActorId);
    for (const member of roomState.members.values()) {
      if (!member.ready) continue;
      sendMessage(member.channel, {
        v: COLLABORATION_PROTOCOL_VERSION, kind: 'PRESENCE', designId, sessionId: member.sessionId, actorId: hostActorId, ...record
      }, 'host-to-guest');
    }
    return true;
  }

  function rejectGuest(message, code = 'PERMISSION_DENIED') {
    const opId = typeof message?.operation?.opId === 'string' && ID.test(message.operation.opId) ? message.operation.opId : 'invalid-operation';
    try {
      sendMessage(transport?.dataChannel, {
        ...baseContext(), kind: 'REJECT',
        opId, revision: engine?.getRevision?.() ?? roomState.durable.head.sequence,
        headHash: engine?.getHeadHash?.() ?? roomState.durable.head.commitHash, code
      }, 'host-to-guest');
    } catch {}
    close(code === 'CONFLICT' || code === 'STALE_REVISION' ? 'diverged' : 'rejected');
  }

  async function activeGrantOrClose() {
    const active = await loadGrant(workspace, designId, { locks, crypto });
    if (!active || active.shareId !== roomState.grant.shareId) {
      roomState.stopAll('revoked');
      throw new Error('This live sharing link has been revoked.');
    }
  }

  function reserveRoomAsset(byteLength) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 1
      || roomState.transferredAssetCount + 1 > roomState.maxAssetCount
      || roomState.transferredAssetBytes + byteLength > roomState.maxAssetBytes) {
      throw new Error('The live room exceeded its aggregate asset transfer budget.');
    }
    roomState.transferredAssetCount += 1;
    roomState.transferredAssetBytes += byteLength;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      roomState.transferredAssetCount = Math.max(0, roomState.transferredAssetCount - 1);
      roomState.transferredAssetBytes = Math.max(0, roomState.transferredAssetBytes - byteLength);
    };
  }

  async function acceptIncomingAsset(asset) {
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
      if (guestActorId) roomState.members.get(guestActorId)?.assetIds.add(asset.assetId);
      try {
        onAssetTransfer({ phase: 'received', ...asset, bytes: undefined,
          totalBytes: roomState.transferredAssetBytes, count: roomState.transferredAssetCount });
      } catch {}
    } finally {
      asset.bytes.fill(0);
    }
  }

  async function sendSnapshotAssets(snapshot, member) {
    const requirements = collectDesignAssetRequirements(snapshot);
    let sentAssetCount = 0;
    const transfer = async ({ assetId, assetKind, mimeType, bytes, fontMetadata = null }) => {
      let release;
      try {
        release = reserveRoomAsset(bytes.byteLength);
        emit('sending-assets');
        const result = await sendAsset(member.assetChannel, {
          context: { v: COLLABORATION_PROTOCOL_VERSION, designId, sessionId: member.sessionId, actorId: hostActorId },
          direction: 'host-to-guest',
          transferId: makeActorId(crypto, 'transfer'), assetId, assetKind, mimeType, fontMetadata,
          bytes, crypto, signal: member.abortController.signal
        });
        member.assetIds.add(assetId);
        sentAssetCount += 1;
        try {
          onAssetTransfer({ phase: 'sent', ...result,
            totalBytes: roomState.transferredAssetBytes, count: roomState.transferredAssetCount });
        } catch {}
        return result;
      } catch (error) {
        release?.();
        throw error;
      } finally {
        bytes.fill?.(0);
      }
    };

    for (const assetId of requirements.imageAssetIds) {
      if (member.assetIds.has(assetId)) continue;
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
        if (member.assetIds.has(meta.id)) continue;
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
    if (member.separateAssetChannel && sentAssetCount > 0) {
      await synchronizeAssetChannel({
        assetChannel: member.assetChannel,
        context: { v: COLLABORATION_PROTOCOL_VERSION, designId, sessionId: member.sessionId, actorId: hostActorId },
        direction: 'host-to-guest',
        waiters: member.assetBarrierWaiters,
        timeoutMs: assetBarrierTimeoutMs,
        signal: member.abortController.signal,
        crypto
      });
    }
  }

  async function sendRoomRevision(member, entry) {
    if (!member.ready || roomState.members.get(member.actorId) !== member) return;
    await sendSnapshotAssets(entry.snapshot, member);
    if (!member.ready || roomState.members.get(member.actorId) !== member) return;
    sendMessage(member.channel, {
      v: COLLABORATION_PROTOCOL_VERSION, kind: 'ROOM_REVISION', designId, sessionId: member.sessionId, actorId: hostActorId,
      revision: entry.revision, headHash: entry.headHash, snapshot: safeSnapshot(entry.snapshot)
    }, 'host-to-guest');
    member.deliveredRevision = entry.revision;
  }

  function queueMemberRevision(member, entry, { alreadyCounted = false } = {}) {
    if (roomState.members.get(member.actorId) !== member) return;
    const bytes = alreadyCounted ? entry.bytes : JSON.stringify(entry.snapshot).length * 3;
    if (!alreadyCounted) {
      if (member.queuedRevisionCount + 1 > 8 || member.queuedRevisionBytes + bytes > 4 * 1024 * 1024) {
        member.close('sync-overflow');
        return;
      }
      member.queuedRevisionCount += 1;
      member.queuedRevisionBytes += bytes;
    }
    if (!member.ready) {
      if (!alreadyCounted) member.queuedRevisions.push({ ...entry, bytes });
      return;
    }
    if (entry.revision <= member.enqueuedRevision) {
      member.queuedRevisionCount = Math.max(0, member.queuedRevisionCount - 1);
      member.queuedRevisionBytes = Math.max(0, member.queuedRevisionBytes - bytes);
      return;
    }
    if (entry.revision !== member.enqueuedRevision + 1) {
      member.close('stale-sync');
      return;
    }
    member.enqueuedRevision = entry.revision;
    member.fanoutQueue = member.fanoutQueue.then(async () => {
      try {
        await sendRoomRevision(member, entry);
      } catch {
        member.close('failed');
      } finally {
        member.queuedRevisionCount = Math.max(0, member.queuedRevisionCount - 1);
        member.queuedRevisionBytes = Math.max(0, member.queuedRevisionBytes - bytes);
      }
    });
  }

  function queueRoomRevision(entry, authorActorId) {
    for (const member of roomState.members.values()) {
      if (member.actorId !== authorActorId) queueMemberRevision(member, entry);
    }
  }

  function queuePendingRevisions(member) {
    const pending = member.queuedRevisions.splice(0).sort((left, right) => left.revision - right.revision);
    for (const entry of pending) queueMemberRevision(member, entry, { alreadyCounted: true });
    return member.fanoutQueue;
  }

  async function acceptHello(message) {
    if (guestActorId || message.designId !== designId || message.sessionId !== sessionId() || message.lastRevision < 0) {
      rejectGuest(message, 'PERMISSION_DENIED');
      return;
    }
    guestActorId = message.actorId;
    if (handshakeTimer != null) cancelTimeout(handshakeTimer);
    handshakeTimer = null;
    if (!roomState.engine) {
      roomState.engine = createHostOperationEngine({
        designId,
        sessionId: sessionId(),
        hostActorId,
        guestActorIds: [guestActorId],
        snapshot: roomState.durable.document,
        revision: roomState.durable.head.sequence,
        headHash: roomState.durable.head.commitHash,
        commit: async input => {
          await activeGrantOrClose();
          const current = roomState.durable;
          const saved = await commit(workspace, designId, input.snapshot, {
            expectedHead: current.head,
            pageId: input.snapshot.activePageId || current.pageIds[0],
            locks,
            crypto
          });
          if (saved.head.sequence !== input.revision) throw new Error('The durable workspace revision moved unexpectedly.');
          roomState.durable = saved;
          for (const listener of [...roomState.snapshotListeners]) {
            try { listener(safeSnapshot(saved.document), saved.head); } catch {}
          }
          return saved;
        },
        onCommitted: input => queueRoomRevision(input, input.actorId)
      });
    } else {
      roomState.engine.registerGuestSession(guestActorId, sessionId());
    }
    engine = roomState.engine;
    const member = {
      actorId: guestActorId,
      sessionId: sessionId(),
      channel: transport.dataChannel,
      assetChannel: transport.assetDataChannel || transport.dataChannel,
      separateAssetChannel: Boolean(transport.assetDataChannel && transport.assetDataChannel !== transport.dataChannel),
      assetReady: false,
      assetReadyWaiters: new Map(),
      assetBarrierWaiters: new Map(),
      close,
      ready: false,
      assetIds: new Set(),
      queuedRevisions: [],
      queuedRevisionBytes: 0,
      queuedRevisionCount: 0,
      deliveredRevision: null,
      enqueuedRevision: null,
      fanoutQueue: Promise.resolve(),
      lastPresenceSequence: 0,
      presenceTokens: 30,
      presenceUpdatedAt: now(),
      abortController: new AbortController()
    };
    roomState.members.set(guestActorId, member);
    assetReceiver = createCollaborationAssetReceiver({
      channel: member.assetChannel,
      direction: 'guest-to-host',
      context: { v: COLLABORATION_PROTOCOL_VERSION, designId, sessionId: sessionId(), actorId: guestActorId },
      crypto,
      maxBytes: MAX_ASSET_BYTES
    });
    const initialSnapshot = roomState.engine.getSnapshot();
    const initialRevision = roomState.engine.getRevision();
    const initialHeadHash = roomState.engine.getHeadHash();
    sendMessage(transport.dataChannel, {
      ...baseContext(), kind: 'WELCOME', hostActorId, revision: initialRevision, headHash: initialHeadHash
    }, 'host-to-guest');
    if (member.separateAssetChannel) {
      const readyWaiter = createSignalWaiter(
        member.assetReadyWaiters,
        'ready',
        assetBarrierTimeoutMs,
        member.abortController.signal,
        'The guest did not prepare its image channel.'
      );
      try { await readyWaiter.promise; }
      catch (error) { readyWaiter.cancel(error); throw error; }
    }
    await sendSnapshotAssets(initialSnapshot, member);
    sendMessage(transport.dataChannel, {
      ...baseContext(), kind: 'SNAPSHOT', revision: initialRevision, headHash: initialHeadHash,
      snapshot: safeSnapshot(initialSnapshot)
    }, 'host-to-guest');
    member.deliveredRevision = initialRevision;
    member.enqueuedRevision = initialRevision;
    member.ready = true;
    emit('connected');
    await queuePendingRevisions(member);
    try { publishViewState(getViewState()); } catch { /* A failed initial view hint must not block the authenticated design snapshot. */ }
    for (const presence of roomState.presences.values()) {
      sendMessage(member.channel, {
        v: COLLABORATION_PROTOCOL_VERSION, kind: 'PRESENCE', designId, sessionId: member.sessionId, actorId: hostActorId, ...presence
      }, 'host-to-guest');
    }
  }

  function acceptPresence(message) {
    const member = roomState.members.get(guestActorId);
    if (!member || !member.ready || message.peerActorId !== guestActorId) {
      rejectGuest(message, 'PERMISSION_DENIED');
      return;
    }
    if (message.sequence <= member.lastPresenceSequence) return;
    member.lastPresenceSequence = message.sequence;
    const timestamp = Number(now());
    const elapsed = Number.isFinite(timestamp) ? Math.max(0, timestamp - member.presenceUpdatedAt) : 0;
    member.presenceTokens = Math.min(30, member.presenceTokens + elapsed * 0.03);
    member.presenceUpdatedAt = Number.isFinite(timestamp) ? timestamp : member.presenceUpdatedAt;
    if (member.presenceTokens < 1) return;
    member.presenceTokens -= 1;
    // A guest can locally change pages before its saved page operation has
    // reached the host. Ignore that transient reference rather than tearing
    // down a valid editing session.
    if (!roomState.engine.hasPageId(message.pageId)) return;
    const lastRoomSequence = roomState.presenceSequences.get(guestActorId) || 0;
    if (lastRoomSequence >= Number.MAX_SAFE_INTEGER) {
      close('presence-sequence-limit');
      return;
    }
    const record = {
      peerActorId: guestActorId,
      sequence: lastRoomSequence + 1,
      active: message.active,
      pageId: message.pageId,
      cursorX: message.cursorX,
      cursorY: message.cursorY,
      selectedIds: [...message.selectedIds]
    };
    roomState.presenceSequences.set(guestActorId, record.sequence);
    if (record.active) roomState.presences.set(guestActorId, record);
    else roomState.presences.delete(guestActorId);
    try { onPresence({ ...record, selectedIds: [...record.selectedIds] }); } catch {}
    for (const other of roomState.members.values()) {
      if (other === member || !other.ready) continue;
      sendMessage(other.channel, {
        v: COLLABORATION_PROTOCOL_VERSION, kind: 'PRESENCE', designId, sessionId: other.sessionId, actorId: hostActorId, ...record
      }, 'host-to-guest');
    }
  }

  async function receive(raw, viaAssetChannel = false) {
    if (disposed) return;
    let message;
    const expectedContext = { designId, sessionId: sessionId(), ...(guestActorId ? { actorId: guestActorId } : {}) };
    try { message = decodeCollaborationMessage(raw, { direction: 'guest-to-host', context: expectedContext }); }
    catch { rejectGuest(null, 'INVALID_OPERATION'); return; }
    try {
      if (message.kind === 'ASSET_BARRIER') {
        if (!viaAssetChannel || !guestActorId || message.actorId !== guestActorId) {
          rejectGuest(message, 'PERMISSION_DENIED');
          return;
        }
        sendMessage(transport.dataChannel, {
          v: COLLABORATION_PROTOCOL_VERSION, kind: 'ASSET_BARRIER_ACK', designId, sessionId: sessionId(), actorId: hostActorId,
          barrierId: message.barrierId
        }, 'host-to-guest');
        return;
      }
      if (message.kind.startsWith('ASSET_')) {
        if (!assetReceiver || message.actorId !== guestActorId) { rejectGuest(message, 'PERMISSION_DENIED'); return; }
        if (message.kind === 'ASSET_BEGIN') {
          if (incomingReservation) throw new Error('This guest already has an active asset transfer.');
          const release = reserveRoomAsset(message.byteLength);
          incomingReservation = { transferId: message.transferId, byteLength: message.byteLength, release };
          try {
            const approved = await approveIncomingAsset({
              direction: 'guest-to-host', assetId: message.assetId, assetKind: message.assetKind,
              mimeType: message.mimeType, byteLength: message.byteLength, fontMetadata: message.fontMetadata
            });
            if (disposed) { release(); incomingReservation = null; return; }
            if (approved !== true) {
              release();
              incomingReservation = null;
              rejectGuest(message, 'PERMISSION_DENIED');
              return;
            }
          } catch (error) {
            release();
            if (incomingReservation?.release === release) incomingReservation = null;
            throw error;
          }
        }
        const completed = await assetReceiver.accept(message);
        if (completed) {
          const reservation = incomingReservation;
          incomingReservation = null;
          try { await acceptIncomingAsset(completed); }
          catch (error) { reservation?.release?.(); throw error; }
        }
        return;
      }
      if (message.kind === 'HELLO') { await acceptHello(message); return; }
      if (!engine || !guestActorId || message.actorId !== guestActorId
        || message.designId !== designId || message.sessionId !== sessionId()) {
        rejectGuest(message, 'PERMISSION_DENIED'); return;
      }
      if (message.kind === 'FORK_NOTICE') { close('guest-forked'); return; }
      if (message.kind === 'PRESENCE') { acceptPresence(message); return; }
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

  function dispatchHostAssetSignal(raw) {
    let message;
    try {
      message = decodeCollaborationMessage(raw, {
        direction: 'guest-to-host',
        context: { designId, sessionId: sessionId(), ...(guestActorId ? { actorId: guestActorId } : {}) }
      });
    } catch { return false; }
    if (message.kind !== 'ASSET_READY' && message.kind !== 'ASSET_BARRIER_ACK') return false;
    const member = roomState.members.get(message.actorId);
    if (!member || !member.separateAssetChannel || member.sessionId !== sessionId()) {
      close('protocol-error');
      return true;
    }
    if (message.kind === 'ASSET_READY') {
      if (member.assetReady) {
        close('protocol-error');
        return true;
      }
      member.assetReady = true;
      resolveSignalWaiter(member.assetReadyWaiters, 'ready');
    } else if (!resolveSignalWaiter(member.assetBarrierWaiters, message.barrierId)) {
      close('protocol-error');
    }
    return true;
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
    close('failed');
    throw error;
  }
  const channel = transport.dataChannel;
  if (!channel) { close('failed'); throw new Error('The host WebRTC channel was not created.'); }
  removers.push(listen(channel, 'message', event => {
    if (dispatchHostAssetSignal(event?.data)) return;
    enqueueBounded(messageQueue, event?.data, raw => receive(raw, false),
      () => close('overloaded'), () => close('failed'));
  }));
  removers.push(listen(channel, 'close', () => close('disconnected')));
  removers.push(listen(channel, 'error', () => close('failed')));
  const assetChannel = transport.assetDataChannel;
  if (assetChannel && assetChannel !== channel) {
    removers.push(listen(assetChannel, 'message', event => {
      enqueueBounded(assetMessageQueue, event?.data, raw => receive(raw, true),
        () => close('asset-overloaded'), () => close('failed'));
    }));
    removers.push(listen(assetChannel, 'close', () => close('disconnected')));
    removers.push(listen(assetChannel, 'error', () => close('failed')));
  }
  emit('waiting-answer');
  const offerExpiry = transport.session?.expiresAt;
  const offerWaitMs = Number.isSafeInteger(offerExpiry) ? offerExpiry - now() : handshakeTimeoutMs;
  if (offerWaitMs <= 0) {
    close('timeout');
    throw new Error('The session offer expired before it could be shared.');
  }
  // The manual offer/answer relay may cross apps and take several minutes. Keep
  // the host alive for the signed offer's own validity window; the shorter
  // handshake timeout is only for the guest's first HELLO after the channel opens.
  handshakeTimer = scheduleTimeout(() => close('timeout'), offerWaitMs);

  return Object.freeze({
    role: 'host',
    get state() { return state; },
    get offerCapsule() { return transport.offerCapsule; },
    get invitation() { return grant.encodedInvite; },
    get shareId() { return grant.shareId; },
    get head() { return roomState.durable.head; },
    get guestCount() { return roomState.members.size; },
    addGuestSession: overrides => {
      if (roomState.stopped) throw new Error('This live room has already been stopped.');
      return createHostSessionController({ ...options, ...(overrides || {}), room: roomState });
    },
    acceptAnswer: async answerCapsule => {
      if (disposed || state !== 'waiting-answer') throw new Error('This host session is not waiting for an answer.');
      emit('verifying-answer');
      let answer;
      try { answer = await verifyAnswer(answerCapsule, transport.offerCapsule, { expectedInvite: grant.invite, now: now(), crypto }); }
      catch (error) { if (!disposed) emit('waiting-answer'); throw error; }
      if (disposed || (Number.isSafeInteger(answer.expiresAt) && now() > answer.expiresAt)) {
        if (!disposed) close('timeout');
        throw new Error('The session offer expired before the answer was accepted.');
      }
      try { await consumeAnswer(workspace, answer, { locks, now: now() }); }
      catch (error) { if (!disposed) emit('waiting-answer'); throw error; }
      if (disposed) throw new Error('The host session expired before the answer was accepted.');
      if (handshakeTimer != null) cancelTimeout(handshakeTimer);
      handshakeTimer = null;
      const active = await loadGrant(workspace, designId, { locks, crypto });
      if (!active || active.shareId !== roomState.grant.shareId) {
        roomState.stopAll('revoked');
        throw new Error('This live sharing link has been revoked.');
      }
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
      if (!guestActorId) handshakeTimer = scheduleTimeout(() => close('timeout'), handshakeTimeoutMs);
      return true;
    },
    revoke: async () => {
      return locks.request(`tiny-image-star-share-edit:${workspace.workspaceId}:${designId}`, { mode: 'exclusive' }, async () => {
        const revoked = await revokeGrant(workspace, designId, { locks, now: now() });
        if (revoked) roomState.stopAll('revoked');
        return revoked;
      });
    },
    publishViewState,
    publishPresence,
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
  onViewState = () => {},
  onPresence = () => {},
  onFork = () => {},
  closeSession = () => {},
  canAdoptRoomRevision = () => true,
  onAsset,
  approveIncomingAsset = async () => false,
  sendAsset = sendCollaborationAsset,
  onAssetTransfer = () => {},
  maxSessionAssetBytes = 512 * 1024 * 1024,
  maxSessionAssetCount = 256,
  maxPendingOperations = 256,
  maxPendingBytes = 2 * 1024 * 1024,
  assetBarrierTimeoutMs = 30_000
} = {}) {
  assertId(expectedInvite?.designId, 'Design ID');
  if (typeof persistFork !== 'function') throw new TypeError('A local fork persistence callback is required.');
  sessionBudget({ maxSessionAssetBytes, maxSessionAssetCount });
  if (!Number.isSafeInteger(assetBarrierTimeoutMs) || assetBarrierTimeoutMs < 1 || assetBarrierTimeoutMs > 120_000) {
    throw new RangeError('The collaboration asset barrier timeout is invalid.');
  }
  const designId = expectedInvite.designId;
  let state = 'preparing-answer';
  let transport;
  let disposed = false;
  let hostActorId = null;
  let hostRevision = null;
  let hostHeadHash = null;
  let lastViewState = null;
  let lastViewSequence = 0;
  let presenceSequence = 0;
  const lastPresenceSequences = new Map();
  let recovery = null;
  let lastSnapshot = null;
  let lastProposedSnapshot = null;
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
  const assetMessageQueue = { queue: Promise.resolve(), messages: 0, bytes: 0 };
  const assetBarrierWaiters = new Map();
  const assetAbortController = new AbortController();
  const pendingByOp = new Map();
  const removers = [];
  const actorId = makeActorId(crypto, 'guest');
  const emit = next => { state = next; try { onState(next); } catch {} };
  const context = () => ({ v: COLLABORATION_PROTOCOL_VERSION, designId, sessionId: transport.session.sessionId, actorId });

  async function freezeWithFork(reason) {
    if (!recovery) { emit('disconnected-before-snapshot'); assetAbortController.abort(); try { transport?.close?.(); } catch {} return null; }
    const result = reason?.kind === 'REJECT'
      ? await recovery.reject(reason)
      : await recovery.disconnect(reason);
    emit(result.status);
    try { onFork(result); } catch {}
    return result;
  }

  function closeFromRecovery() {
    disposed = true;
    assetAbortController.abort();
    assetReceiver?.cancel?.();
    for (const remove of removers.splice(0)) { try { remove(); } catch {} }
    try { transport?.close?.(); } catch {}
    try { closeSession({ designId, sessionId: transport?.session?.sessionId }); } catch {}
  }

  async function receive(raw, viaAssetChannel = false) {
    if (disposed) return;
    const expectedContext = { designId, sessionId: transport.session.sessionId, ...(hostActorId ? { actorId: hostActorId } : {}) };
    const message = decodeCollaborationMessage(raw, { direction: 'host-to-guest', context: expectedContext });
    if (message.designId !== designId || message.sessionId !== transport.session.sessionId) throw new Error('A message belongs to a different live session.');
    if (message.kind === 'ASSET_BARRIER') {
      if (!viaAssetChannel || !hostActorId || message.actorId !== hostActorId) throw new Error('An asset barrier was not sent by the authenticated host.');
      sendMessage(transport.dataChannel, {
        v: COLLABORATION_PROTOCOL_VERSION, kind: 'ASSET_BARRIER_ACK', designId, sessionId: transport.session.sessionId, actorId,
        barrierId: message.barrierId
      }, 'guest-to-host');
      return;
    }
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
        channel: transport.assetDataChannel || transport.dataChannel,
        direction: 'host-to-guest',
        context: { v: COLLABORATION_PROTOCOL_VERSION, designId, sessionId: transport.session.sessionId, actorId: hostActorId },
        crypto,
        maxBytes: MAX_ASSET_BYTES
      });
      if (transport.assetDataChannel && transport.assetDataChannel !== transport.dataChannel) {
        sendMessage(transport.dataChannel, { ...context(), kind: 'ASSET_READY' }, 'guest-to-host');
      }
      return;
    }
    if (message.actorId !== hostActorId) throw new Error('A message was not sent by the authenticated host.');
    if (message.kind === 'VIEW_STATE') {
      if (!recovery || !lastSnapshot) throw new Error('The host sent view state before the authenticated design snapshot.');
      if (!lastSnapshot.pages.some(page => page.id === message.pageId)) throw new Error('The host view references a page outside the shared design.');
      if (message.sequence <= lastViewSequence) return;
      lastViewSequence = message.sequence;
      lastViewState = {
        sequence: message.sequence, pageId: message.pageId, zoom: message.zoom,
        centerX: message.centerX, centerY: message.centerY
      };
      try { onViewState({ ...lastViewState }); } catch {}
      return;
    }
    if (message.kind === 'PRESENCE') {
      if (!recovery || !lastSnapshot) throw new Error('The host sent presence before the authenticated design snapshot.');
      const lastSequence = lastPresenceSequences.get(message.peerActorId) || 0;
      if (message.sequence <= lastSequence) return;
      lastPresenceSequences.set(message.peerActorId, message.sequence);
      // Presence may overtake a page-creating ROOM_REVISION on another peer's
      // independent DataChannel. Ignore it until the replica catches up.
      if (!lastSnapshot.pages.some(page => page.id === message.pageId)) return;
      try {
        onPresence({
          peerActorId: message.peerActorId,
          sequence: message.sequence,
          active: message.active,
          pageId: message.pageId,
          cursorX: message.cursorX,
          cursorY: message.cursorY,
          selectedIds: [...message.selectedIds]
        });
      } catch {}
      return;
    }
    if (message.kind === 'SNAPSHOT') {
      if (hostRevision == null || message.revision !== hostRevision || message.headHash !== hostHeadHash) {
        throw new Error('The host snapshot does not match the exact head announced in its welcome message.');
      }
      if (!recovery) {
        lastSnapshot = safeSnapshot(message.snapshot);
        lastProposedSnapshot = safeSnapshot(message.snapshot);
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
        await onSnapshot(safeSnapshot(lastSnapshot), hostRevision, { sequence: hostRevision, commitHash: hostHeadHash }, { source: 'initial' });
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
    if (message.kind === 'ROOM_REVISION') {
      if (!recovery || !lastSnapshot) throw new Error('The room advanced before this guest received its authenticated design snapshot.');
      if (recovery.state.pendingOperations.length) {
        void freezeWithFork({
          type: 'diverged',
          reason: 'room-advanced-with-pending-edits',
          revision: message.revision
        });
        return;
      }
      let canAdopt = false;
      try { canAdopt = canAdoptRoomRevision() === true; } catch {}
      if (!canAdopt) {
        void freezeWithFork({ type: 'diverged', reason: 'local-edit-in-progress', revision: message.revision });
        return;
      }
      const nextSnapshot = safeSnapshot(message.snapshot);
      const requiredImages = collectDesignAssetRequirements(nextSnapshot).imageAssetIds;
      const missingImages = requiredImages.filter(assetId => !receivedAssetIds.has(assetId));
      if (missingImages.length) throw new Error(`The room revision is missing ${missingImages.length} referenced image assets.`);
      const adopted = recovery.adoptRoomRevision(message);
      if (!adopted.accepted) {
        void freezeWithFork({ type: 'diverged', reason: adopted.reason, revision: message.revision });
        return;
      }
      lastSnapshot = safeSnapshot(adopted.state.acknowledgedSnapshot);
      lastProposedSnapshot = safeSnapshot(lastSnapshot);
      hostRevision = adopted.state.acknowledgedRevision;
      hostHeadHash = adopted.state.hostHead.commitHash;
      emit('connected');
      await onSnapshot(safeSnapshot(lastSnapshot), hostRevision, adopted.state.hostHead, { source: 'room-revision' });
      return;
    }
    if (message.kind === 'ACK') {
      const pending = pendingByOp.get(message.opId);
      if (!pending) throw new Error('The host acknowledged an unknown operation.');
      const acknowledgedSnapshot = safeSnapshot(pending.snapshot);
      if (lastViewState && acknowledgedSnapshot.pages.some(page => page.id === lastViewState.pageId)) {
        acknowledgedSnapshot.activePageId = lastViewState.pageId;
      }
      const result = recovery.acknowledge(message, {
        snapshot: acknowledgedSnapshot, revision: message.revision,
        head: { sequence: message.revision, commitHash: message.headHash }
      });
      if (!result.accepted) throw new Error(`The host ACK could not be applied: ${result.reason}.`);
      pendingByOp.delete(message.opId);
      lastSnapshot = acknowledgedSnapshot;
      hostRevision = message.revision;
      hostHeadHash = message.headHash;
      emit(recovery.state.pendingOperations.length ? 'pending' : 'connected');
      if (!recovery.state.pendingOperations.length) lastProposedSnapshot = safeSnapshot(acknowledgedSnapshot);
      await onSnapshot(safeSnapshot(lastSnapshot), hostRevision, recovery.state.hostHead, { source: 'ack' });
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

  function dispatchGuestAssetSignal(raw) {
    let message;
    try {
      message = decodeCollaborationMessage(raw, {
        direction: 'host-to-guest',
        context: { designId, sessionId: transport?.session?.sessionId, ...(hostActorId ? { actorId: hostActorId } : {}) }
      });
    } catch { return false; }
    if (message.kind !== 'ASSET_BARRIER_ACK') return false;
    if (message.actorId !== hostActorId || !resolveSignalWaiter(assetBarrierWaiters, message.barrierId)) {
      void freezeWithFork({ type: 'protocol-error', reason: 'unexpected-asset-barrier-ack' });
    }
    return true;
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
    if (dispatchGuestAssetSignal(event?.data)) return;
    enqueueBounded(messageQueue, event?.data, raw => receive(raw, false),
      () => { void freezeWithFork({ type: 'protocol-error', reason: 'message-queue-limit' }); },
      error => { void freezeWithFork({ type: 'protocol-error', message: error.message }); });
  }));
  removers.push(listen(channel, 'close', () => { void freezeWithFork('transport-disconnected'); }));
  removers.push(listen(channel, 'error', () => { void freezeWithFork('transport-error'); }));
  const assetChannel = transport.assetDataChannel;
  if (assetChannel && assetChannel !== channel) {
    removers.push(listen(assetChannel, 'message', event => {
      enqueueBounded(assetMessageQueue, event?.data, raw => receive(raw, true),
        () => { void freezeWithFork({ type: 'protocol-error', reason: 'asset-message-queue-limit' }); },
        error => { void freezeWithFork({ type: 'protocol-error', message: error.message }); });
    }));
    removers.push(listen(assetChannel, 'close', () => { void freezeWithFork('transport-disconnected'); }));
    removers.push(listen(assetChannel, 'error', () => { void freezeWithFork('transport-error'); }));
  }
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
    get viewState() { return lastViewState && { ...lastViewState }; },
    publishPresence(presence) {
      if (!recovery || !['connected', 'pending'].includes(state)) return false;
      if (!presence || !lastSnapshot.pages.some(page => page.id === presence.pageId)) return false;
      if (presenceSequence >= Number.MAX_SAFE_INTEGER) throw new Error('The local presence sequence limit was reached.');
      const message = {
        ...context(), kind: 'PRESENCE', peerActorId: actorId, sequence: ++presenceSequence,
        active: presence.active !== false,
        pageId: presence.pageId,
        cursorX: presence.active === false ? null : (presence.cursorX ?? null),
        cursorY: presence.active === false ? null : (presence.cursorY ?? null),
        selectedIds: presence.active === false ? [] : [...new Set((presence.selectedIds || []).slice(0, 128))]
      };
      sendMessage(channel, message, 'guest-to-host');
      return true;
    },
    get revision() { return recovery?.state.acknowledgedRevision ?? hostRevision; },
    get fork() { return recovery?.state ?? null; },
    markLocalEditsPending() { return recovery?.markLocalEditsPending() ?? false; },
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
        const result = await sendAsset(assetChannel || channel, {
          context: { v: COLLABORATION_PROTOCOL_VERSION, designId, sessionId: transport.session.sessionId, actorId },
          direction: 'guest-to-host',
          transferId: makeActorId(crypto, 'transfer'),
          assetId: asset.assetId,
          assetKind: asset.assetKind,
          mimeType: asset.mimeType,
          fontMetadata: asset.assetKind === 'font' ? asset.fontMetadata : null,
          bytes: asset.bytes,
          crypto
        });
        if (assetChannel && assetChannel !== channel) {
          await synchronizeAssetChannel({
            assetChannel,
            context: { v: COLLABORATION_PROTOCOL_VERSION, designId, sessionId: transport.session.sessionId, actorId },
            direction: 'guest-to-host',
            waiters: assetBarrierWaiters,
            timeoutMs: assetBarrierTimeoutMs,
            signal: assetAbortController.signal,
            crypto
          });
        }
        outgoingAssetCount += 1;
        outgoingAssetBytes += asset.bytes.byteLength;
        if (asset.assetKind === 'image') receivedAssetIds.add(asset.assetId);
        try { onAssetTransfer({ phase: 'sent', ...result, totalBytes: outgoingAssetBytes, count: outgoingAssetCount }); } catch {}
        return result;
      } catch (error) {
        if (assetChannel && assetChannel !== channel) {
          void freezeWithFork({ type: 'asset-transfer-failed', message: error?.message || 'Asset transfer failed.' });
        }
        throw error;
      } finally { outgoingAssetInProgress = false; }
    },
    proposeSnapshot(snapshot) {
      if (!recovery || !['connected', 'pending'].includes(state)) throw new Error('The host snapshot is not ready for editing.');
      if (outgoingAssetInProgress) throw new Error('Wait for the current asset transfer to finish before applying its design changes.');
      const targetSnapshot = safeSnapshot(snapshot);
      const baseSnapshot = lastProposedSnapshot || recovery.state.acknowledgedSnapshot;
      const plan = planGuestOperationSnapshots(baseSnapshot, targetSnapshot);
      if (plan?.length === 0) return null;
      const planned = plan?.length ? plan : [{
        operation: { type: 'ReplaceSnapshot', snapshot: targetSnapshot },
        snapshot: targetSnapshot
      }];
      const firstBaseRevision = recovery.state.acknowledgedRevision + recovery.state.pendingOperations.length;
      const proposals = planned.map(({ operation, snapshot: expectedSnapshot }, index) => ({
        operation: {
          ...operation,
          opId: makeActorId(crypto, `op${++operationCounter}`),
          baseRevision: firstBaseRevision + index
        },
        snapshot: safeSnapshot(expectedSnapshot)
      }));
      const pendingState = recovery.state;
      const plannedBytes = proposals.reduce((sum, { operation }) => (
        sum + new TextEncoder().encode(JSON.stringify(operation)).byteLength
      ), 0);
      if (pendingState.pendingOperations.length + proposals.length > maxPendingOperations
        || pendingState.pendingBytes + plannedBytes > maxPendingBytes) {
        throw new Error('Pending guest edits reached the safe session limit; save your local copy before continuing.');
      }
      // Stage the whole deterministic plan before sending. If admission fails,
      // no partial wire sequence is emitted; the existing local checkpoint can
      // then be preserved as a fork by the caller.
      const accepted = proposals.map(({ operation, snapshot: expectedSnapshot }) => {
        const proposal = recovery.propose(operation);
        pendingByOp.set(proposal.opId, { snapshot: expectedSnapshot });
        return proposal;
      });
      lastProposedSnapshot = targetSnapshot;
      try {
        for (const proposal of accepted) {
          sendMessage(channel, { ...context(), kind: 'OPERATION', operation: proposal }, 'guest-to-host');
        }
      } catch (error) {
        // Once a proposal has been staged, a synchronous DataChannel send
        // failure can leave an unknown prefix of the operation plan in flight.
        // Stop editing and persist the full local checkpoint as a fork instead
        // of leaving the replica appearing connected with stranded operations.
        void freezeWithFork({
          type: 'connection-failed',
          reason: 'proposal-send-failed',
          message: error?.message || 'The live connection could not send the edit.'
        });
        throw error;
      }
      emit('pending');
      return accepted.at(-1).opId;
    },
    async retryForkSave() {
      if (!recovery) throw new Error('There is no local fork to retry yet.');
      const result = await recovery.retrySave();
      emit(result.status);
      try { onFork(result); } catch {}
      return result;
    },
    close: () => {
      if (disposed) return;
      try {
        if (recovery && ['connected', 'pending'].includes(state)) {
          sendMessage(channel, {
            ...context(), kind: 'PRESENCE', peerActorId: actorId, sequence: ++presenceSequence,
            active: false, pageId: lastSnapshot?.activePageId || lastSnapshot?.pages?.[0]?.id,
            cursorX: null, cursorY: null, selectedIds: []
          }, 'guest-to-host');
        }
      } catch {}
      void freezeWithFork('user-closed');
    }
  });
}
