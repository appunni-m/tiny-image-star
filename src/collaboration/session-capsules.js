const CAPSULE_PREFIX = 'tisc1.';
const INVITE_PREFIX = 'tisd1.';
export const MAX_SESSION_CAPSULE_BYTES = 65_536;
export const MAX_STABLE_INVITE_BYTES = 4_096;
export const MAX_SESSION_DESCRIPTION_BYTES = 48_000;
export const DEFAULT_SESSION_TTL_MS = 5 * 60_000;
const MAX_SESSION_TTL_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 30_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const JWK_FIELDS = new Set(['kty', 'crv', 'x', 'y', 'd', 'ext', 'key_ops', 'alg', 'use']);
const utf8 = new TextEncoder();

function cryptoApi(provider = globalThis.crypto) {
  if (!provider?.subtle || typeof provider.getRandomValues !== 'function') throw new Error('Web Crypto is unavailable.');
  return provider;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalValue(value, depth = 0) {
  if (depth > 32) throw new TypeError('Capsule data is too deeply nested.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => canonicalValue(item, depth + 1));
  if (!isPlainObject(value)) throw new TypeError('Capsule data must be plain JSON.');
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new TypeError('Capsule data contains a reserved key.');
    output[key] = canonicalValue(value[key], depth + 1);
  }
  return output;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value, maxBytes) {
  if (typeof value !== 'string' || !value || !BASE64URL_PATTERN.test(value)
    || value.length > Math.ceil(maxBytes * 4 / 3) + 4) throw new TypeError('Invalid or oversized encoded data.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  let binary;
  try { binary = atob(base64); } catch { throw new TypeError('Invalid encoded data.'); }
  if (binary.length > maxBytes) throw new TypeError('Encoded data exceeds the size limit.');
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function encodeJson(prefix, value, maxBytes) {
  const bytes = utf8.encode(canonicalJson(value));
  if (bytes.length > maxBytes) throw new RangeError('Encoded payload exceeds the size limit.');
  return `${prefix}${bytesToBase64Url(bytes)}`;
}

function decodeJson(prefix, token, maxBytes) {
  if (typeof token !== 'string' || !token.startsWith(prefix)) throw new TypeError('Unsupported capsule format.');
  const encoded = token.slice(prefix.length);
  if (!encoded || encoded.length > Math.ceil(maxBytes * 4 / 3) + 4) throw new RangeError('Encoded payload exceeds the size limit.');
  let value;
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(encoded, maxBytes));
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) throw error;
    throw new TypeError('Invalid UTF-8 payload.');
  }
  if (bytesToBase64Url(utf8.encode(value)) !== encoded) throw new TypeError('Payload is not canonically encoded.');
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new TypeError('Invalid JSON payload.'); }
  if (canonicalJson(parsed) !== value) throw new TypeError('Payload is not canonically encoded.');
  return parsed;
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    throw new TypeError(`Invalid ${label}.`);
  }
}

function assertId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError(`Invalid ${label}.`);
}

function assertJwk(value, privateKey, label) {
  if (!isPlainObject(value) || Object.keys(value).some(key => !JWK_FIELDS.has(key))
    || value.kty !== 'EC' || value.crv !== 'P-256'
    || typeof value.x !== 'string' || value.x.length !== 43 || !BASE64URL_PATTERN.test(value.x)
    || typeof value.y !== 'string' || value.y.length !== 43 || !BASE64URL_PATTERN.test(value.y)
    || (privateKey ? (typeof value.d !== 'string' || value.d.length !== 43 || !BASE64URL_PATTERN.test(value.d)) : Object.hasOwn(value, 'd'))
    || (value.ext != null && typeof value.ext !== 'boolean')
    || (value.key_ops != null && (!Array.isArray(value.key_ops) || value.key_ops.some(item => typeof item !== 'string')))) {
    throw new TypeError(`Invalid ${label} key.`);
  }
}

function assertStableInvite(invite) {
  assertExactKeys(invite, ['v', 'designId', 'shareId', 'identityPublicKey', 'capabilityPublicKey', 'capabilityPrivateKey'], 'stable invite');
  if (invite.v !== 1) throw new TypeError('Unsupported stable invite version.');
  assertId(invite.designId, 'design ID');
  assertId(invite.shareId, 'share ID');
  assertJwk(invite.identityPublicKey, false, 'identity public');
  assertJwk(invite.capabilityPublicKey, false, 'capability public');
  assertJwk(invite.capabilityPrivateKey, true, 'capability private');
  if (invite.capabilityPrivateKey.x !== invite.capabilityPublicKey.x
    || invite.capabilityPrivateKey.y !== invite.capabilityPublicKey.y) throw new TypeError('Capability keys do not match.');
}

function assertSdp(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')
    || utf8.encode(value).length > MAX_SESSION_DESCRIPTION_BYTES) throw new TypeError('Invalid or oversized session description.');
  if (/(^|[^\r])\r(?!\n)/.test(value)) throw new TypeError('Invalid WebRTC session description.');
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== 'v=0' || !lines.some(line => line.startsWith('o='))
    || !lines.some(line => line.startsWith('s=')) || !lines.some(line => line.startsWith('t='))
    || !lines.some(line => /^m=application\s+\d+\s+[^\s]+\s+webrtc-datachannel(?:\s|$)/i.test(line))) {
    throw new TypeError('Invalid WebRTC data-channel session description.');
  }
}

function assertTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid ${label}.`);
}

function assertSessionWindow(issuedAt, expiresAt, now) {
  assertTimestamp(issuedAt, 'issue time');
  assertTimestamp(expiresAt, 'expiry time');
  assertTimestamp(now, 'clock');
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_SESSION_TTL_MS || issuedAt > now + CLOCK_SKEW_MS || now > expiresAt) {
    throw new Error('Session capsule is invalid or expired.');
  }
}

function stripSignature(envelope) {
  assertExactKeys(envelope, ['payload', 'signature'], 'signed capsule');
  if (typeof envelope.signature !== 'string' || !BASE64URL_PATTERN.test(envelope.signature)) throw new TypeError('Invalid capsule signature.');
  return envelope.payload;
}

function assertEnvelope(payload, expectedKind, expectedKeys) {
  assertExactKeys(payload, expectedKeys, `${expectedKind} capsule`);
  if (payload.v !== 1 || payload.kind !== expectedKind) throw new TypeError('Unsupported capsule version or kind.');
  assertId(payload.designId, 'design ID');
  assertId(payload.shareId, 'share ID');
  assertId(payload.sessionId, 'session ID');
  if (typeof payload.nonce !== 'string' || !BASE64URL_PATTERN.test(payload.nonce) || payload.nonce.length < 32 || payload.nonce.length > 64) {
    throw new TypeError('Invalid session nonce.');
  }
  assertTimestamp(payload.issuedAt, 'issue time');
  assertTimestamp(payload.expiresAt, 'expiry time');
  assertSdp(payload.sdp);
}

function randomToken(crypto, bytes = 24) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function importPublicKey(crypto, jwk) {
  assertJwk(jwk, false, 'public');
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
}

async function importPrivateKey(crypto, jwk) {
  assertJwk(jwk, true, 'private');
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
}

async function sign(crypto, privateKey, payload) {
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, utf8.encode(canonicalJson(payload)));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verify(crypto, publicKey, payload, signature) {
  const signatureBytes = base64UrlToBytes(signature, 128);
  if (signatureBytes.length !== 64 || bytesToBase64Url(signatureBytes) !== signature) return false;
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signatureBytes, utf8.encode(canonicalJson(payload)));
}

function decodeCapsule(token) {
  const envelope = decodeJson(CAPSULE_PREFIX, token, MAX_SESSION_CAPSULE_BYTES);
  const payload = stripSignature(envelope);
  if (!isPlainObject(payload)) throw new TypeError('Invalid capsule payload.');
  return { envelope, payload };
}

/** Create fresh, extractable P-256 keys for a design identity and its share capability. */
export async function createStableDesignInvite({ designId, shareId, crypto = globalThis.crypto } = {}) {
  const provider = cryptoApi(crypto);
  assertId(designId, 'design ID');
  const stableShareId = shareId ?? randomToken(provider);
  assertId(stableShareId, 'share ID');
  const identityPair = await provider.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const capabilityPair = await provider.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const invite = {
    v: 1,
    designId,
    shareId: stableShareId,
    identityPublicKey: await provider.subtle.exportKey('jwk', identityPair.publicKey),
    capabilityPublicKey: await provider.subtle.exportKey('jwk', capabilityPair.publicKey),
    capabilityPrivateKey: await provider.subtle.exportKey('jwk', capabilityPair.privateKey)
  };
  assertStableInvite(invite);
  return {
    invite,
    encodedInvite: encodeStableDesignInvite(invite),
    identityPrivateKey: identityPair.privateKey,
    identityPublicKey: identityPair.publicKey
  };
}

/** Encode the stable invitation for placement in a URL fragment. */
export function encodeStableDesignInvite(invite) {
  assertStableInvite(invite);
  return encodeJson(INVITE_PREFIX, invite, MAX_STABLE_INVITE_BYTES);
}

/** Decode a stable invitation from a fragment; fragment secrets must be removed from the address bar by the caller. */
export function decodeStableDesignInvite(fragment) {
  const token = String(fragment ?? '').replace(/^#/, '');
  const invite = decodeJson(INVITE_PREFIX, token, MAX_STABLE_INVITE_BYTES);
  assertStableInvite(invite);
  return invite;
}

/** Sign one gathered WebRTC offer with the persistent design identity key. */
export async function createOfferCapsule({ invite, identityPrivateKey, sdp, issuedAt = Date.now(), ttlMs = DEFAULT_SESSION_TTL_MS, crypto = globalThis.crypto } = {}) {
  const provider = cryptoApi(crypto);
  assertStableInvite(invite);
  assertSdp(sdp);
  assertTimestamp(issuedAt, 'issue time');
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_SESSION_TTL_MS) throw new RangeError('Invalid session lifetime.');
  if (!Number.isSafeInteger(issuedAt + ttlMs)) throw new RangeError('Session expiry exceeds the supported clock range.');
  const payload = {
    v: 1,
    kind: 'offer',
    designId: invite.designId,
    shareId: invite.shareId,
    sessionId: randomToken(provider, 18),
    nonce: randomToken(provider, 32),
    issuedAt,
    expiresAt: issuedAt + ttlMs,
    sdp
  };
  const signature = await sign(provider, identityPrivateKey, payload);
  const publicKey = await importPublicKey(provider, invite.identityPublicKey);
  if (!await verify(provider, publicKey, payload, signature)) throw new Error('Signing key does not match the design identity.');
  const token = encodeJson(CAPSULE_PREFIX, { payload, signature }, MAX_SESSION_CAPSULE_BYTES);
  return { token, session: { designId: payload.designId, shareId: payload.shareId, sessionId: payload.sessionId, nonce: payload.nonce, issuedAt, expiresAt: payload.expiresAt } };
}

/** Verify an offer against the stable invite already trusted by the guest. */
export async function verifyOfferCapsule(token, { expectedInvite, now = Date.now(), crypto = globalThis.crypto } = {}) {
  const provider = cryptoApi(crypto);
  assertStableInvite(expectedInvite);
  const { envelope, payload } = decodeCapsule(token);
  assertEnvelope(payload, 'offer', ['v', 'kind', 'designId', 'shareId', 'sessionId', 'nonce', 'issuedAt', 'expiresAt', 'sdp']);
  assertSessionWindow(payload.issuedAt, payload.expiresAt, now);
  if (payload.designId !== expectedInvite.designId || payload.shareId !== expectedInvite.shareId) {
    throw new Error('Offer does not match this design invitation.');
  }
  const publicKey = await importPublicKey(provider, expectedInvite.identityPublicKey);
  if (!await verify(provider, publicKey, payload, envelope.signature)) throw new Error('Offer signature is invalid.');
  return payload;
}

/** Create an answer bound to the verified offer's one-time session and capability key. */
export async function createAnswerCapsule(token, { expectedInvite, sdp, issuedAt = Date.now(), now = Date.now(), crypto = globalThis.crypto } = {}) {
  const provider = cryptoApi(crypto);
  const offer = await verifyOfferCapsule(token, { expectedInvite, now, crypto: provider });
  assertSdp(sdp);
  assertTimestamp(issuedAt, 'issue time');
  assertTimestamp(now, 'clock');
  if (issuedAt < offer.issuedAt - CLOCK_SKEW_MS || issuedAt > now + CLOCK_SKEW_MS
    || issuedAt > offer.expiresAt || offer.expiresAt - issuedAt > MAX_SESSION_TTL_MS || now > offer.expiresAt) {
    throw new Error('Session capsule is invalid or expired.');
  }
  const payload = {
    v: 1,
    kind: 'answer',
    designId: offer.designId,
    shareId: offer.shareId,
    sessionId: offer.sessionId,
    nonce: offer.nonce,
    issuedAt,
    expiresAt: offer.expiresAt,
    sdp
  };
  const capabilityPrivateKey = await importPrivateKey(provider, expectedInvite.capabilityPrivateKey);
  const signature = await sign(provider, capabilityPrivateKey, payload);
  return encodeJson(CAPSULE_PREFIX, { payload, signature }, MAX_SESSION_CAPSULE_BYTES);
}

/** Verify an answer against the exact, still-live offer and the locally stored share capability. */
export async function verifyAnswerCapsule(token, offerToken, { expectedInvite, now = Date.now(), crypto = globalThis.crypto } = {}) {
  const provider = cryptoApi(crypto);
  const offer = await verifyOfferCapsule(offerToken, { expectedInvite, now, crypto: provider });
  const { envelope, payload } = decodeCapsule(token);
  assertEnvelope(payload, 'answer', ['v', 'kind', 'designId', 'shareId', 'sessionId', 'nonce', 'issuedAt', 'expiresAt', 'sdp']);
  assertSessionWindow(payload.issuedAt, payload.expiresAt, now);
  if (payload.designId !== offer.designId || payload.shareId !== offer.shareId || payload.sessionId !== offer.sessionId
    || payload.nonce !== offer.nonce || payload.expiresAt !== offer.expiresAt
    || payload.issuedAt < offer.issuedAt - CLOCK_SKEW_MS) throw new Error('Answer does not match this live session.');
  const publicKey = await importPublicKey(provider, expectedInvite.capabilityPublicKey);
  if (!await verify(provider, publicKey, payload, envelope.signature)) throw new Error('Answer capability proof is invalid.');
  return payload;
}
