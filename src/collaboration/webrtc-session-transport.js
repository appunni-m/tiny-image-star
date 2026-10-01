import {
  createAnswerCapsule,
  createOfferCapsule,
  verifyAnswerCapsule,
  verifyOfferCapsule
} from './session-capsules.js';

export const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 15_000;
export const DEFAULT_CONNECTION_TIMEOUT_MS = 20_000;
export const DEFAULT_DATA_CHANNEL_LABEL = 'tiny-image-star/v1';

/** A typed failure raised by the user-mediated WebRTC capsule transport. */
export class WebRtcSessionTransportError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'WebRtcSessionTransportError';
    this.code = code;
  }
}

function transportError(code, message, cause) {
  return new WebRtcSessionTransportError(code, message, cause ? { cause } : {});
}

function listen(target, type, listener) {
  if (typeof target?.addEventListener === 'function') {
    target.addEventListener(type, listener);
    return () => target.removeEventListener?.(type, listener);
  }
  const property = `on${type}`;
  const previous = target?.[property];
  if (target && typeof target === 'object') {
    target[property] = event => {
      try { previous?.call(target, event); } finally { listener(event); }
    };
    return () => {
      if (target[property]) target[property] = previous ?? null;
    };
  }
  return () => {};
}

function validateTimeout(value, name) {
  if (!Number.isFinite(value) || value <= 0 || value > 10 * 60_000) {
    throw new RangeError(`${name} must be between 1 ms and 10 minutes.`);
  }
}

function createPeerConnection(factory, iceServers) {
  if (typeof factory !== 'function') {
    throw transportError('PEER_CONNECTION_UNAVAILABLE', 'WebRTC is unavailable in this browser.');
  }
  if (!Array.isArray(iceServers)) throw new TypeError('iceServers must be an array.');
  try {
    // No rendezvous or relay is contacted by this module. The default is direct ICE only;
    // callers may explicitly provide their own STUN/TURN configuration.
    let constructable = true;
    try { Reflect.construct(function EmptyConstructor() {}, [], factory); } catch { constructable = false; }
    return constructable ? new factory({ iceServers }) : factory({ iceServers });
  } catch (cause) {
    throw transportError('PEER_CONNECTION_UNAVAILABLE', 'Could not create a WebRTC peer connection.', cause);
  }
}

function makeController(peerConnection, role, timeoutMs) {
  let state = role === 'host' ? 'preparing-offer' : 'preparing-answer';
  let dataChannel = null;
  let disposed = false;
  const removers = [];
  const pendingRejectors = new Set();
  const channelWaiters = new Set();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const remove of removers.splice(0)) {
      try { remove(); } catch { /* Best-effort event cleanup. */ }
    }
  };

  const terminate = (nextState, error) => {
    if (state === 'closed' || state === 'failed') return;
    state = nextState;
    dispose();
    for (const reject of [...pendingRejectors]) reject(error);
    pendingRejectors.clear();
    channelWaiters.clear();
    try { dataChannel?.close?.(); } catch { /* Best effort. */ }
    try { peerConnection.close?.(); } catch { /* Best effort. */ }
  };

  const fail = error => terminate('failed', error instanceof Error ? error : transportError('SESSION_FAILED', 'The live session failed.'));

  const addCleanup = remove => {
    if (typeof remove !== 'function') return;
    if (disposed) {
      try { remove(); } catch { /* Best-effort event cleanup. */ }
    } else removers.push(remove);
  };

  const installChannel = channel => {
    if (!channel || typeof channel !== 'object') {
      fail(transportError('DATA_CHANNEL_UNAVAILABLE', 'The peer did not provide a usable data channel.'));
      return;
    }
    if (dataChannel && dataChannel !== channel) {
      try { channel.close?.(); } catch { /* Ignore unexpected extra channel. */ }
      fail(transportError('UNEXPECTED_DATA_CHANNEL', 'The peer opened more than one session data channel.'));
      return;
    }
    dataChannel = channel;
    try { channel.binaryType = 'arraybuffer'; }
    catch (cause) {
      fail(transportError('DATA_CHANNEL_UNSUPPORTED', 'The browser could not configure binary data delivery.', cause));
      return;
    }
    if (channel.binaryType !== 'arraybuffer') {
      fail(transportError('DATA_CHANNEL_UNSUPPORTED', 'The browser cannot deliver binary data as bounded ArrayBuffers.'));
      return;
    }
    removers.push(listen(channel, 'close', () => {
      if (state !== 'closed' && state !== 'failed') fail(transportError('DATA_CHANNEL_CLOSED', 'The live data channel closed.'));
    }));
    removers.push(listen(channel, 'error', event => {
      if (state !== 'closed' && state !== 'failed') fail(transportError('DATA_CHANNEL_ERROR', 'The live data channel failed.', event?.error));
    }));
    for (const resolve of [...channelWaiters]) resolve(channel);
    channelWaiters.clear();
  };

  removers.push(listen(peerConnection, 'connectionstatechange', () => {
    if (peerConnection.connectionState === 'failed') fail(transportError('PEER_CONNECTION_FAILED', 'The direct WebRTC connection failed.'));
    if (peerConnection.connectionState === 'closed' && state !== 'closed' && state !== 'failed') {
      fail(transportError('PEER_CONNECTION_CLOSED', 'The WebRTC peer connection closed.'));
    }
  }));

  const waitForOpen = () => {
    if (state === 'closed' || state === 'failed') return Promise.reject(transportError('SESSION_CLOSED', 'The live session is no longer available.'));
    return new Promise((resolve, reject) => {
      let done = false;
      let channel;
      let channelWaiter = null;
      const removals = [];
      const finish = (error, result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const remove of removals) remove();
        pendingRejectors.delete(rejectFromTermination);
        if (channelWaiter) channelWaiters.delete(channelWaiter);
        if (error) reject(error);
        else resolve(result);
      };
      const rejectFromTermination = error => finish(error);
      const onOpen = () => {
        if (channel?.readyState === 'open') {
          state = 'connected';
          finish(null, channel);
        }
      };
      const onClose = () => finish(transportError('DATA_CHANNEL_CLOSED', 'The live data channel closed before it opened.'));
      const onError = event => finish(transportError('DATA_CHANNEL_ERROR', 'The live data channel failed to open.', event?.error));
      const timer = setTimeout(() => {
        const error = transportError('CONNECTION_TIMEOUT', 'The direct WebRTC data channel did not open before the connection timeout.');
        finish(error);
        fail(error);
      }, timeoutMs);
      const bindChannel = value => {
        if (done) return;
        channel = value;
        removals.push(listen(channel, 'open', onOpen));
        removals.push(listen(channel, 'close', onClose));
        removals.push(listen(channel, 'error', onError));
        if (channel.readyState === 'open') onOpen();
        else if (channel.readyState === 'closed' || channel.readyState === 'closing') onClose();
      };
      pendingRejectors.add(rejectFromTermination);
      if (dataChannel) bindChannel(dataChannel);
      else {
        channelWaiter = value => bindChannel(value);
        channelWaiters.add(channelWaiter);
      }
    });
  };

  return {
    get state() { return state; },
    get dataChannel() { return dataChannel; },
    peerConnection,
    installChannel,
    waitForOpen,
    fail,
    addCleanup,
    close() {
      if (state === 'closed' || state === 'failed') return;
      terminate('closed', transportError('SESSION_CLOSED', 'The live session was closed.'));
    },
    setState(nextState) {
      if (state !== 'closed' && state !== 'failed') state = nextState;
    }
  };
}

async function setLocalAndGather(peerConnection, description, timeoutMs) {
  try {
    await peerConnection.setLocalDescription(description);
  } catch (cause) {
    throw transportError('LOCAL_DESCRIPTION_FAILED', 'Could not set the local WebRTC description.', cause);
  }
  if (peerConnection.iceGatheringState === 'complete') return;
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeGathering();
      removeConnection();
      if (error) reject(error);
      else resolve();
    };
    const onGatheringChange = () => {
      if (peerConnection.iceGatheringState === 'complete') finish();
    };
    const onConnectionChange = () => {
      if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
        finish(transportError('PEER_CONNECTION_FAILED', 'The WebRTC connection closed during ICE gathering.'));
      }
    };
    const removeGathering = listen(peerConnection, 'icegatheringstatechange', onGatheringChange);
    const removeConnection = listen(peerConnection, 'connectionstatechange', onConnectionChange);
    const timer = setTimeout(() => finish(transportError('ICE_GATHERING_TIMEOUT', 'ICE gathering did not finish before the configured timeout.')), timeoutMs);
    onGatheringChange();
  });
}

function sessionHandle(controller, role, extra = {}) {
  return Object.freeze({
    role,
    get state() { return controller.state; },
    get dataChannel() { return controller.dataChannel; },
    peerConnection: controller.peerConnection,
    waitForOpen: controller.waitForOpen,
    close: controller.close,
    ...extra
  });
}

/**
 * Create a direct host offer. The returned capsule is available only after non-trickle ICE
 * gathering finishes, so the caller can carry it to the guest through a user-chosen channel.
 * The returned data channel transports bytes only; callers must authenticate and validate
 * every application message separately.
 */
export async function createHostWebRtcSession({
  invite,
  identityPrivateKey,
  peerConnectionFactory = globalThis.RTCPeerConnection,
  iceServers = [],
  crypto = globalThis.crypto,
  now = () => Date.now(),
  iceGatheringTimeoutMs = DEFAULT_ICE_GATHERING_TIMEOUT_MS,
  connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS,
  dataChannelLabel = DEFAULT_DATA_CHANNEL_LABEL
} = {}) {
  validateTimeout(iceGatheringTimeoutMs, 'iceGatheringTimeoutMs');
  validateTimeout(connectionTimeoutMs, 'connectionTimeoutMs');
  const peerConnection = createPeerConnection(peerConnectionFactory, iceServers);
  const controller = makeController(peerConnection, 'host', connectionTimeoutMs);
  try {
    const dataChannel = peerConnection.createDataChannel(dataChannelLabel, { ordered: true });
    controller.installChannel(dataChannel);
    const offer = await peerConnection.createOffer();
    await setLocalAndGather(peerConnection, offer, iceGatheringTimeoutMs);
    const localSdp = peerConnection.localDescription?.sdp;
    const created = await createOfferCapsule({ invite, identityPrivateKey, sdp: localSdp, issuedAt: now(), crypto });
    controller.setState('awaiting-answer');

    const handle = sessionHandle(controller, 'host', {
      offerCapsule: created.token,
      session: created.session,
      async acceptAnswer(answerCapsule) {
        if (controller.state !== 'awaiting-answer') throw transportError('INVALID_STATE', 'This host session is not waiting for an answer.');
        controller.setState('verifying-answer');
        try {
          let answer;
          try {
            answer = await verifyAnswerCapsule(answerCapsule, created.token, { expectedInvite: invite, now: now(), crypto });
          } catch (cause) {
            throw transportError('CAPSULE_REJECTED', 'The answer capsule is invalid, expired, or belongs to another offer.', cause);
          }
          // Do not mutate RTCPeerConnection until the signed answer is bound to this exact offer.
          try {
            await peerConnection.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
          } catch (cause) {
            throw transportError('REMOTE_DESCRIPTION_FAILED', 'Could not apply the verified WebRTC answer.', cause);
          }
          controller.setState('connecting');
          await controller.waitForOpen();
          return handle;
        } catch (error) {
          controller.fail(error);
          throw error;
        }
      }
    });
    return handle;
  } catch (error) {
    controller.fail(error instanceof WebRtcSessionTransportError ? error : transportError('OFFER_CREATION_FAILED', 'Could not create the WebRTC offer.', error));
    throw error instanceof WebRtcSessionTransportError ? error : transportError('OFFER_CREATION_FAILED', 'Could not create the WebRTC offer.', error);
  }
}

/**
 * Verify the user's invitation and host offer before allocating any WebRTC resources, then
 * build an answer capsule after ICE gathering completes. Signaling remains out of band.
 * The returned data channel is unauthenticated; callers must authenticate/validate messages.
 */
export async function createGuestWebRtcSession({
  offerCapsule,
  expectedInvite,
  peerConnectionFactory = globalThis.RTCPeerConnection,
  iceServers = [],
  crypto = globalThis.crypto,
  now = () => Date.now(),
  iceGatheringTimeoutMs = DEFAULT_ICE_GATHERING_TIMEOUT_MS,
  connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS,
  dataChannelLabel = DEFAULT_DATA_CHANNEL_LABEL
} = {}) {
  validateTimeout(iceGatheringTimeoutMs, 'iceGatheringTimeoutMs');
  validateTimeout(connectionTimeoutMs, 'connectionTimeoutMs');
  let offer;
  try {
    offer = await verifyOfferCapsule(offerCapsule, { expectedInvite, now: now(), crypto });
  } catch (cause) {
    throw transportError('CAPSULE_REJECTED', 'The offer capsule is invalid, expired, or does not match this invitation.', cause);
  }

  const peerConnection = createPeerConnection(peerConnectionFactory, iceServers);
  const controller = makeController(peerConnection, 'guest', connectionTimeoutMs);
  const removeIncomingChannel = listen(peerConnection, 'datachannel', event => {
    const channel = event?.channel;
    if (channel?.label !== dataChannelLabel) {
      try { channel?.close?.(); } catch { /* Best effort. */ }
      controller.fail(transportError('UNEXPECTED_DATA_CHANNEL', 'The host opened an unexpected data channel.'));
      return;
    }
    controller.installChannel(channel);
  });
  controller.addCleanup(removeIncomingChannel);
  try {
    try {
      await peerConnection.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    } catch (cause) {
      throw transportError('REMOTE_DESCRIPTION_FAILED', 'Could not apply the verified WebRTC offer.', cause);
    }
    let answer;
    try {
      answer = await peerConnection.createAnswer();
    } catch (cause) {
      throw transportError('ANSWER_CREATION_FAILED', 'Could not create a WebRTC answer.', cause);
    }
    await setLocalAndGather(peerConnection, answer, iceGatheringTimeoutMs);
    const issuedAt = now();
    let answerCapsule;
    try {
      answerCapsule = await createAnswerCapsule(offerCapsule, {
        expectedInvite,
        sdp: peerConnection.localDescription?.sdp,
        issuedAt,
        now: issuedAt,
        crypto
      });
    } catch (cause) {
      throw transportError('ANSWER_CAPSULE_FAILED', 'Could not create the signed WebRTC answer capsule.', cause);
    }
    controller.setState('awaiting-connection');
    return sessionHandle(controller, 'guest', {
      answerCapsule,
      session: {
        designId: offer.designId,
        shareId: offer.shareId,
        sessionId: offer.sessionId,
        nonce: offer.nonce,
        issuedAt: offer.issuedAt,
        expiresAt: offer.expiresAt
      }
    });
  } catch (error) {
    controller.fail(error instanceof WebRtcSessionTransportError ? error : transportError('ANSWER_CREATION_FAILED', 'Could not prepare the WebRTC answer.', error));
    throw error instanceof WebRtcSessionTransportError ? error : transportError('ANSWER_CREATION_FAILED', 'Could not prepare the WebRTC answer.', error);
  }
}
