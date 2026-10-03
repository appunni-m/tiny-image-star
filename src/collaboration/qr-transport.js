const FRAME_PREFIX = 'tistqr1';
const CHUNK_CHARACTERS = 640;
const MAX_TRANSFER_BYTES = 102_400;
const MAX_FRAMES = 224;
const MAX_FRAME_CHARACTERS = 900;
const TRANSFER_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const utf8Encoder = new TextEncoder();

function assertCrypto(crypto) {
  if (!crypto?.subtle || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Secure local QR sharing requires Web Crypto.');
  }
  return crypto;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function base64UrlToBytes(value) {
  if (!value || !BASE64URL_PATTERN.test(value)) throw new TypeError('The QR transfer data is invalid.');
  const encoded = value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - value.length % 4) % 4);
  let binary;
  try { binary = atob(encoded); } catch { throw new TypeError('The QR transfer data is invalid.'); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytesToBase64Url(bytes) !== value) throw new TypeError('The QR transfer data is not canonical.');
  return bytes;
}

function parseQrFrame(frame) {
  if (typeof frame !== 'string' || frame.length > MAX_FRAME_CHARACTERS) throw new RangeError('The QR frame is oversized.');
  const parts = frame.split('.');
  if (parts.length !== 6 || parts[0] !== FRAME_PREFIX) throw new TypeError('This is not a Tiny Image Star live-sharing QR frame.');
  const [, id, indexText, countText, checksum, chunk] = parts;
  if (!TRANSFER_ID_PATTERN.test(id) || !/^[1-9]\d{0,2}$/u.test(indexText) || !/^[1-9]\d{0,2}$/u.test(countText)
    || !SHA256_PATTERN.test(checksum) || !BASE64URL_PATTERN.test(chunk) || chunk.length > CHUNK_CHARACTERS) {
    throw new TypeError('The QR frame metadata is invalid.');
  }
  const index = Number(indexText) - 1;
  const count = Number(countText);
  if (count > MAX_FRAMES || index >= count || (index < count - 1 && chunk.length !== CHUNK_CHARACTERS)) {
    throw new RangeError('The QR frame is outside the supported transfer limits.');
  }
  return { id, index, count, checksum, chunk };
}

/**
 * Split a bounded UTF-8 handoff payload into repeatable QR frames. Each frame
 * is independently decodable and the receiver verifies the complete SHA-256
 * digest before exposing the reconstructed text to collaboration code.
 */
export async function createQrTransferFrames(value, { crypto = globalThis.crypto } = {}) {
  const provider = assertCrypto(crypto);
  if (typeof value !== 'string' || !value) throw new TypeError('A nonempty QR transfer payload is required.');
  const bytes = utf8Encoder.encode(value);
  if (!bytes.length || bytes.byteLength > MAX_TRANSFER_BYTES) throw new RangeError('The live-sharing QR payload exceeds its size limit.');
  const encoded = bytesToBase64Url(bytes);
  const count = Math.ceil(encoded.length / CHUNK_CHARACTERS);
  if (count < 1 || count > MAX_FRAMES) throw new RangeError('The live-sharing QR payload needs too many frames.');
  const randomId = provider.getRandomValues(new Uint8Array(12));
  const id = bytesToBase64Url(randomId);
  const checksum = Array.from(new Uint8Array(await provider.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const chunk = encoded.slice(index * CHUNK_CHARACTERS, (index + 1) * CHUNK_CHARACTERS);
    frames.push(`${FRAME_PREFIX}.${id}.${index + 1}.${count}.${checksum}.${chunk}`);
  }
  return { id, checksum, byteLength: bytes.byteLength, frames };
}

/** Assemble one QR transfer, rejecting mixing, conflicting duplicates, and corruption. */
export function createQrTransferAssembler({ crypto = globalThis.crypto } = {}) {
  const provider = assertCrypto(crypto);
  let transfer = null;

  async function accept(frameText) {
    const frame = parseQrFrame(frameText);
    if (!transfer) {
      transfer = { id: frame.id, count: frame.count, checksum: frame.checksum, chunks: new Map(), encodedBytes: 0 };
    } else if (transfer.id !== frame.id || transfer.count !== frame.count || transfer.checksum !== frame.checksum) {
      return { status: 'different-transfer', received: transfer.chunks.size, total: transfer.count };
    }

    const previous = transfer.chunks.get(frame.index);
    if (previous !== undefined && previous !== frame.chunk) throw new TypeError('A repeated QR frame conflicts with a frame already scanned.');
    if (previous === undefined) {
      transfer.chunks.set(frame.index, frame.chunk);
      transfer.encodedBytes += frame.chunk.length;
      if (transfer.encodedBytes > Math.ceil(MAX_TRANSFER_BYTES * 4 / 3)) {
        reset();
        throw new RangeError('The live-sharing QR transfer exceeds its size limit.');
      }
    }
    if (transfer.chunks.size < transfer.count) {
      return { status: previous === undefined ? 'progress' : 'duplicate', received: transfer.chunks.size, total: transfer.count };
    }

    const complete = transfer;
    const encoded = Array.from({ length: complete.count }, (_, index) => complete.chunks.get(index)).join('');
    reset();
    const bytes = base64UrlToBytes(encoded);
    if (!bytes.length || bytes.byteLength > MAX_TRANSFER_BYTES) throw new RangeError('The live-sharing QR payload exceeds its size limit.');
    const checksum = Array.from(new Uint8Array(await provider.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (checksum !== complete.checksum) throw new TypeError('The QR transfer checksum does not match. Scan the frames again.');
    let value;
    try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new TypeError('The completed QR transfer is not valid UTF-8.'); }
    return { status: 'complete', received: complete.count, total: complete.count, value };
  }

  function reset() { transfer = null; }
  function progress() { return transfer ? { received: transfer.chunks.size, total: transfer.count } : { received: 0, total: 0 }; }
  return { accept, reset, progress };
}

export function createLiveInvitationQrPayload(invitation, offer) {
  if (typeof invitation !== 'string' || invitation.length > 8_192 || typeof offer !== 'string' || !offer.startsWith('tisc1.') || offer.length > 90_000) {
    throw new TypeError('The live invitation and session offer are invalid.');
  }
  const value = JSON.stringify({ v: 1, kind: 'live-invitation', invitation, offer });
  if (utf8Encoder.encode(value).byteLength > MAX_TRANSFER_BYTES) throw new RangeError('The live invitation QR payload exceeds its size limit.');
  return value;
}

export function readLiveQrPayload(value) {
  if (typeof value !== 'string' || !value) throw new TypeError('The scanned QR data is empty.');
  if (utf8Encoder.encode(value).byteLength > MAX_TRANSFER_BYTES) throw new RangeError('The scanned live-sharing handoff exceeds its size limit.');
  let payload;
  try { payload = JSON.parse(value); }
  catch { throw new TypeError('The QR code is not a Tiny Image Star live-sharing capsule.'); }
  if (!payload || Object.getPrototypeOf(payload) !== Object.prototype || payload.v !== 1 || JSON.stringify(payload) !== value) {
    throw new TypeError('The QR code uses an unsupported live-sharing format.');
  }
  const keys = Object.keys(payload).sort().join(',');
  if (payload.kind === 'live-invitation' && keys === 'invitation,kind,offer,v'
    && typeof payload.invitation === 'string' && payload.invitation.length <= 8_192
    && typeof payload.offer === 'string' && payload.offer.startsWith('tisc1.') && payload.offer.length <= 90_000) {
    return { kind: payload.kind, invitation: payload.invitation, offer: payload.offer };
  }
  if (payload.kind === 'live-answer' && keys === 'answer,kind,v'
    && typeof payload.answer === 'string' && payload.answer.startsWith('tisc1.') && payload.answer.length <= 90_000) {
    return { kind: payload.kind, answer: payload.answer };
  }
  throw new TypeError('The QR code does not contain a valid live-sharing handoff.');
}

export function createLiveAnswerQrPayload(answer) {
  if (typeof answer !== 'string' || !answer.startsWith('tisc1.') || answer.length > 90_000) {
    throw new TypeError('The guest answer capsule is invalid.');
  }
  return JSON.stringify({ v: 1, kind: 'live-answer', answer });
}

export const qrTransferLimits = Object.freeze({ chunkCharacters: CHUNK_CHARACTERS, maxTransferBytes: MAX_TRANSFER_BYTES, maxFrames: MAX_FRAMES });
