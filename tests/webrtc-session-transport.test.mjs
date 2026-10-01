import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import {
  createAnswerCapsule,
  createOfferCapsule,
  createStableDesignInvite
} from '../src/collaboration/session-capsules.js';
import {
  createGuestWebRtcSession,
  createHostWebRtcSession,
  WebRtcSessionTransportError
} from '../src/collaboration/webrtc-session-transport.js';

const crypto = webcrypto;
const baseTime = 1_800_000_000_000;

function sdp(label) {
  return [
    'v=0',
    `o=- ${label.length + 1} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'c=IN IP4 0.0.0.0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=ice-ufrag:transport',
    'a=ice-pwd:transport-password-0123456789',
    'a=setup:actpass',
    'a=sctp-port:5000',
    `a=x-label:${label}`
  ].join('\r\n') + '\r\n';
}

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, values = {}) {
    const event = { type, target: this, ...values };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener.call(this, event);
    this[`on${type}`]?.call(this, event);
  }
}

class FakeDataChannel extends FakeEventTarget {
  constructor(label, options) {
    super();
    this.label = label;
    this.options = options;
    this.readyState = 'connecting';
    this.binaryType = 'blob';
    this.peer = null;
  }

  open() {
    if (this.readyState !== 'connecting') return;
    this.readyState = 'open';
    this.dispatch('open');
  }

  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatch('close');
    if (this.peer && this.peer.readyState !== 'closed') {
      this.peer.readyState = 'closed';
      this.peer.dispatch('close');
    }
  }
}

class FakeNetwork {
  constructor({ gather = true, open = true } = {}) {
    this.gather = gather;
    this.open = open;
    this.peers = [];
  }

  factory = class FakeRTCPeerConnection extends FakeEventTarget {
    constructor(configuration) {
      super();
      this.configuration = configuration;
      this.iceGatheringState = 'new';
      this.connectionState = 'new';
      this.localDescription = null;
      this.remoteDescription = null;
      this.createdChannels = [];
      this.closed = false;
      this.network = this.constructor.network;
      this.network.peers.push(this);
    }

    createDataChannel(label, options) {
      const channel = new FakeDataChannel(label, options);
      this.createdChannels.push(channel);
      return channel;
    }

    async createOffer() { return { type: 'offer', sdp: sdp(`offer-${this.network.peers.length}`) }; }
    async createAnswer() { return { type: 'answer', sdp: sdp(`answer-${this.network.peers.length}`) }; }

    async setLocalDescription(description) {
      this.localDescription = description;
      this.iceGatheringState = 'gathering';
      if (this.network.gather) queueMicrotask(() => {
        if (this.closed) return;
        this.iceGatheringState = 'complete';
        this.dispatch('icegatheringstatechange');
      });
    }

    async setRemoteDescription(description) {
      this.remoteDescription = description;
      if (description.type !== 'answer') return;
      const guest = this.network.peers.find(peer => peer !== this
        && peer.remoteDescription?.type === 'offer' && peer.localDescription?.type === 'answer');
      const hostChannel = this.createdChannels[0];
      if (!guest || !hostChannel) return;
      const guestChannel = new FakeDataChannel(hostChannel.label, {});
      hostChannel.peer = guestChannel;
      guestChannel.peer = hostChannel;
      guest.dispatch('datachannel', { channel: guestChannel });
      if (this.network.open) queueMicrotask(() => {
        hostChannel.open();
        guestChannel.open();
        this.connectionState = 'connected';
        guest.connectionState = 'connected';
        this.dispatch('connectionstatechange');
        guest.dispatch('connectionstatechange');
      });
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.connectionState = 'closed';
      this.dispatch('connectionstatechange');
    }
  };

  makeFactory() {
    this.factory.network = this;
    return this.factory;
  }
}

async function ownerFixture() {
  return createStableDesignInvite({ designId: 'design-transport-1', crypto });
}

function isTransportError(code) {
  return error => error instanceof WebRtcSessionTransportError && error.code === code;
}

test('host and guest exchange gathered signed capsules over an ordered reliable direct channel', async () => {
  const owner = await ownerFixture();
  const network = new FakeNetwork();
  const factory = network.makeFactory();
  const host = await createHostWebRtcSession({
    invite: owner.invite,
    identityPrivateKey: owner.identityPrivateKey,
    peerConnectionFactory: factory,
    crypto,
    now: () => baseTime
  });
  assert.equal(host.state, 'awaiting-answer');
  assert.deepEqual(host.peerConnection.configuration, { iceServers: [] });
  assert.deepEqual(host.dataChannel.options, { ordered: true });
  assert.equal(host.dataChannel.binaryType, 'arraybuffer');
  assert.equal(host.dataChannel.readyState, 'connecting');

  const guest = await createGuestWebRtcSession({
    offerCapsule: host.offerCapsule,
    expectedInvite: owner.invite,
    peerConnectionFactory: factory,
    crypto,
    now: () => baseTime + 1
  });
  assert.equal(guest.state, 'awaiting-connection');
  assert.deepEqual(guest.peerConnection.configuration, { iceServers: [] });
  assert.equal(guest.dataChannel, null);
  assert.equal(typeof guest.answerCapsule, 'string');

  const acceptedHost = await host.acceptAnswer(guest.answerCapsule);
  const openedGuestChannel = await guest.waitForOpen();
  assert.equal(acceptedHost, host);
  assert.equal(host.state, 'connected');
  assert.equal(guest.state, 'connected');
  assert.equal(openedGuestChannel.readyState, 'open');
  assert.equal(guest.dataChannel, openedGuestChannel);
  assert.equal(openedGuestChannel.binaryType, 'arraybuffer');
});

test('caller-supplied ICE servers are passed through explicitly', async () => {
  const owner = await ownerFixture();
  const network = new FakeNetwork();
  const factory = network.makeFactory();
  const iceServers = [{ urls: 'stun:stun.example.invalid:3478' }];
  const host = await createHostWebRtcSession({
    invite: owner.invite,
    identityPrivateKey: owner.identityPrivateKey,
    peerConnectionFactory: factory,
    iceServers,
    crypto,
    now: () => baseTime
  });
  assert.deepEqual(host.peerConnection.configuration.iceServers, iceServers);
  host.close();
});

test('malformed or expired guest capsules are rejected before peer connection construction', async () => {
  const owner = await ownerFixture();
  let creations = 0;
  class MustNotCreatePeerConnection {
    constructor() { creations += 1; }
  }
  await assert.rejects(createGuestWebRtcSession({
    offerCapsule: 'not-a-session-capsule',
    expectedInvite: owner.invite,
    peerConnectionFactory: MustNotCreatePeerConnection,
    crypto,
    now: () => baseTime
  }), isTransportError('CAPSULE_REJECTED'));

  const expired = await createOfferCapsule({
    invite: owner.invite,
    identityPrivateKey: owner.identityPrivateKey,
    sdp: sdp('expired'),
    issuedAt: baseTime,
    ttlMs: 20,
    crypto
  });
  await assert.rejects(createGuestWebRtcSession({
    offerCapsule: expired.token,
    expectedInvite: owner.invite,
    peerConnectionFactory: MustNotCreatePeerConnection,
    crypto,
    now: () => baseTime + 21
  }), isTransportError('CAPSULE_REJECTED'));
  assert.equal(creations, 0);
});

test('ICE gathering timeout closes the host peer and its channel', async () => {
  const owner = await ownerFixture();
  const network = new FakeNetwork({ gather: false });
  const factory = network.makeFactory();
  await assert.rejects(createHostWebRtcSession({
    invite: owner.invite,
    identityPrivateKey: owner.identityPrivateKey,
    peerConnectionFactory: factory,
    crypto,
    now: () => baseTime,
    iceGatheringTimeoutMs: 8
  }), isTransportError('ICE_GATHERING_TIMEOUT'));
  assert.equal(network.peers.length, 1);
  assert.equal(network.peers[0].closed, true);
  assert.equal(network.peers[0].createdChannels[0].readyState, 'closed');
});

test('host rejects an unverified answer before setRemoteDescription and cleans up', async () => {
  const owner = await ownerFixture();
  const network = new FakeNetwork();
  const host = await createHostWebRtcSession({
    invite: owner.invite,
    identityPrivateKey: owner.identityPrivateKey,
    peerConnectionFactory: network.makeFactory(),
    crypto,
    now: () => baseTime
  });
  await assert.rejects(host.acceptAnswer('malformed-answer'), isTransportError('CAPSULE_REJECTED'));
  assert.equal(host.peerConnection.remoteDescription, null);
  assert.equal(host.state, 'failed');
  assert.equal(host.peerConnection.closed, true);
});

test('host rejects a correctly signed answer that belongs to a different gathered offer', async () => {
  const owner = await ownerFixture();
  const network = new FakeNetwork();
  const host = await createHostWebRtcSession({
    invite: owner.invite,
    identityPrivateKey: owner.identityPrivateKey,
    peerConnectionFactory: network.makeFactory(),
    crypto,
    now: () => baseTime
  });
  const otherOffer = await createOfferCapsule({
    invite: owner.invite,
    identityPrivateKey: owner.identityPrivateKey,
    sdp: sdp('other-offer'),
    issuedAt: baseTime + 1,
    crypto
  });
  const mismatchedAnswer = await createAnswerCapsule(otherOffer.token, {
    expectedInvite: owner.invite,
    sdp: sdp('other-answer'),
    issuedAt: baseTime + 2,
    now: baseTime + 2,
    crypto
  });
  await assert.rejects(host.acceptAnswer(mismatchedAnswer), isTransportError('CAPSULE_REJECTED'));
  assert.equal(host.peerConnection.remoteDescription, null);
  assert.equal(host.peerConnection.closed, true);
});

test('connection timeout and an early channel close reject waiters and release resources', async () => {
  const owner = await ownerFixture();
  const network = new FakeNetwork({ open: false });
  const factory = network.makeFactory();
  const host = await createHostWebRtcSession({
    invite: owner.invite,
    identityPrivateKey: owner.identityPrivateKey,
    peerConnectionFactory: factory,
    crypto,
    now: () => baseTime,
    connectionTimeoutMs: 15
  });
  const guest = await createGuestWebRtcSession({
    offerCapsule: host.offerCapsule,
    expectedInvite: owner.invite,
    peerConnectionFactory: factory,
    crypto,
    now: () => baseTime + 1,
    connectionTimeoutMs: 100
  });
  const acceptance = host.acceptAnswer(guest.answerCapsule);
  for (let attempt = 0; attempt < 20 && !guest.dataChannel; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.ok(guest.dataChannel, 'host answer should deliver the incoming channel');
  guest.dataChannel.close();
  await assert.rejects(acceptance, error => error instanceof WebRtcSessionTransportError
    && ['DATA_CHANNEL_CLOSED', 'CONNECTION_TIMEOUT'].includes(error.code));
  assert.equal(host.peerConnection.closed, true);
  assert.equal(guest.peerConnection.closed, true);
  assert.ok(['failed', 'closed'].includes(host.state));
});

test('connection timeout without channel activity is bounded and closes the peer', async () => {
  const owner = await ownerFixture();
  const network = new FakeNetwork({ open: false });
  const factory = network.makeFactory();
  const host = await createHostWebRtcSession({
    invite: owner.invite,
    identityPrivateKey: owner.identityPrivateKey,
    peerConnectionFactory: factory,
    crypto,
    now: () => baseTime,
    connectionTimeoutMs: 8
  });
  const guest = await createGuestWebRtcSession({
    offerCapsule: host.offerCapsule,
    expectedInvite: owner.invite,
    peerConnectionFactory: factory,
    crypto,
    now: () => baseTime + 1,
    connectionTimeoutMs: 100
  });
  await assert.rejects(host.acceptAnswer(guest.answerCapsule), isTransportError('CONNECTION_TIMEOUT'));
  assert.equal(host.state, 'failed');
  assert.equal(host.peerConnection.closed, true);
  assert.equal(host.dataChannel.readyState, 'closed');
  assert.equal(guest.peerConnection.closed, true);
});
