import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import {
  createAnswerCapsule,
  createOfferCapsule,
  createStableDesignInvite,
  decodeStableDesignInvite,
  encodeStableDesignInvite,
  MAX_SESSION_DESCRIPTION_BYTES,
  verifyAnswerCapsule,
  verifyOfferCapsule
} from '../src/collaboration/session-capsules.js';

const crypto = webcrypto;
const baseTime = 1_800_000_000_000;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function sdp(label = 'session') {
  return [
    'v=0',
    `o=- ${label.length + 1} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'c=IN IP4 0.0.0.0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=ice-ufrag:example',
    'a=ice-pwd:examplepasswordexamplepassword',
    'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    `a=x-label:${label}`
  ].join('\r\n') + '\r\n';
}

async function fixture(designId = 'design-01') {
  const owner = await createStableDesignInvite({ designId, crypto });
  return { ...owner, fragment: `#${owner.encodedInvite}` };
}

function mutateToken(token, mutate) {
  const encoded = token.slice('tisc1.'.length);
  const json = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4), 'base64').toString('utf8');
  const envelope = JSON.parse(json);
  mutate(envelope);
  const next = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  return `tisc1.${next}`;
}

function alterSignatureUnusedBits(token) {
  return mutateToken(token, envelope => {
    const signature = envelope.signature;
    const index = alphabet.indexOf(signature.at(-1));
    assert.ok(index >= 0 && (index & 3) === 0 && index < 60);
    envelope.signature = `${signature.slice(0, -1)}${alphabet[index + 1]}`;
  });
}

test('stable design invitation round-trips and signs a live offer and matching answer', async () => {
  const owner = await fixture();
  const guestInvite = decodeStableDesignInvite(owner.fragment);
  assert.deepEqual(guestInvite, owner.invite);
  assert.equal(encodeStableDesignInvite(guestInvite), owner.encodedInvite);

  const offer = await createOfferCapsule({
    invite: owner.invite,
    identityPrivateKey: owner.identityPrivateKey,
    sdp: sdp('offer'),
    issuedAt: baseTime,
    crypto
  });
  const verifiedOffer = await verifyOfferCapsule(offer.token, { expectedInvite: guestInvite, now: baseTime + 1, crypto });
  assert.equal(verifiedOffer.sessionId, offer.session.sessionId);
  assert.equal(verifiedOffer.kind, 'offer');

  const answer = await createAnswerCapsule(offer.token, {
    expectedInvite: guestInvite,
    sdp: sdp('answer'),
    issuedAt: baseTime + 2,
    now: baseTime + 2,
    crypto
  });
  const verifiedAnswer = await verifyAnswerCapsule(answer, offer.token, { expectedInvite: owner.invite, now: baseTime + 3, crypto });
  assert.equal(verifiedAnswer.sessionId, verifiedOffer.sessionId);
  assert.equal(verifiedAnswer.nonce, verifiedOffer.nonce);
  assert.equal(verifiedAnswer.kind, 'answer');
});

test('offer signatures reject tampering and invitations from another design identity', async () => {
  const owner = await fixture();
  const offer = await createOfferCapsule({
    invite: owner.invite,
    identityPrivateKey: owner.identityPrivateKey,
    sdp: sdp('original'),
    issuedAt: baseTime,
    crypto
  });
  const tampered = mutateToken(offer.token, envelope => { envelope.payload.sdp = 'v=0\r\no=- changed'; });
  await assert.rejects(verifyOfferCapsule(tampered, { expectedInvite: owner.invite, now: baseTime + 1, crypto }), /invalid WebRTC data-channel session description/i);
  const changedButValidSdp = mutateToken(offer.token, envelope => { envelope.payload.sdp = sdp('changed'); });
  await assert.rejects(verifyOfferCapsule(changedButValidSdp, { expectedInvite: owner.invite, now: baseTime + 1, crypto }), /signature is invalid/i);
  await assert.rejects(verifyOfferCapsule(alterSignatureUnusedBits(offer.token), { expectedInvite: owner.invite, now: baseTime + 1, crypto }), /signature is invalid/i);

  const differentIdentity = await fixture(owner.invite.designId);
  await assert.rejects(
    verifyOfferCapsule(offer.token, { expectedInvite: differentIdentity.invite, now: baseTime + 1, crypto }),
    /does not match this design invitation/i
  );
  await assert.rejects(
    createOfferCapsule({ invite: owner.invite, identityPrivateKey: differentIdentity.identityPrivateKey, sdp: sdp(), issuedAt: baseTime, crypto }),
    /does not match the design identity/i
  );
});

test('offer and answer capsules enforce expiration and session binding', async () => {
  const owner = await fixture();
  const first = await createOfferCapsule({ invite: owner.invite, identityPrivateKey: owner.identityPrivateKey, sdp: sdp('offer-1'), issuedAt: baseTime, ttlMs: 60_000, crypto });
  const second = await createOfferCapsule({ invite: owner.invite, identityPrivateKey: owner.identityPrivateKey, sdp: sdp('offer-2'), issuedAt: baseTime, ttlMs: 60_000, crypto });
  const answer = await createAnswerCapsule(first.token, { expectedInvite: owner.invite, sdp: sdp('answer-1'), issuedAt: baseTime + 1, now: baseTime + 1, crypto });

  await assert.rejects(verifyOfferCapsule(first.token, { expectedInvite: owner.invite, now: baseTime + 60_001, crypto }), /invalid or expired/i);
  await assert.rejects(verifyAnswerCapsule(answer, second.token, { expectedInvite: owner.invite, now: baseTime + 2, crypto }), /does not match this live session/i);
  await assert.rejects(createAnswerCapsule(first.token, { expectedInvite: owner.invite, sdp: sdp('late'), issuedAt: baseTime + 60_001, now: baseTime + 60_001, crypto }), /invalid or expired/i);
  await assert.rejects(createAnswerCapsule(first.token, { expectedInvite: owner.invite, sdp: sdp('future'), issuedAt: baseTime + 31_002, now: baseTime + 1, crypto }), /invalid or expired/i);
});

test('capsule parsing rejects malformed, noncanonical, oversized and invalid inputs', async () => {
  const owner = await fixture();
  await assert.rejects(verifyOfferCapsule('tisc1.%%%%', { expectedInvite: owner.invite, now: baseTime, crypto }), /invalid|unsupported/i);
  await assert.rejects(verifyOfferCapsule(`tisc1.${'A'.repeat(90_000)}`, { expectedInvite: owner.invite, now: baseTime, crypto }), /size limit|oversized/i);
  await assert.rejects(
    createOfferCapsule({ invite: owner.invite, identityPrivateKey: owner.identityPrivateKey, sdp: `m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n${'x'.repeat(MAX_SESSION_DESCRIPTION_BYTES + 1)}`, issuedAt: baseTime, crypto }),
    /oversized session description/i
  );
  await assert.rejects(
    createOfferCapsule({ invite: owner.invite, identityPrivateKey: owner.identityPrivateKey, sdp: sdp(), issuedAt: baseTime, ttlMs: 600_001, crypto }),
    /invalid session lifetime/i
  );
  await assert.rejects(createStableDesignInvite({ designId: '../design', crypto }), /invalid design ID/i);
  const malformed = structuredClone(owner.invite);
  malformed.capabilityPublicKey.x = 'short';
  await assert.rejects(Promise.resolve().then(() => encodeStableDesignInvite(malformed)), /invalid capability public key/i);
});
