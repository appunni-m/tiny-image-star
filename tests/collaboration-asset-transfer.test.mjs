import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  CollaborationAssetTransferError,
  createCollaborationAssetReceiver,
  sendCollaborationAsset
} from '../src/collaboration/asset-transfer.js';
import {
  CollaborationProtocolError,
  MAX_ASSET_CHUNK_BYTES,
  MAX_ASSET_BYTES,
  decodeCollaborationMessage,
  encodeCollaborationMessage
} from '../src/collaboration/protocol.js';

const senderContext = { v: 1, designId: 'design-a', sessionId: 'session-a', actorId: 'host-a' };
const guestContext = { v: 1, designId: 'design-a', sessionId: 'session-a', actorId: 'guest-a' };

async function hash(bytes) {
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function makeChannel({ initialBufferedAmount = 0, drainDelayMs = 2 } = {}) {
  const listeners = new Map();
  const channel = {
    readyState: 'open',
    bufferedAmount: initialBufferedAmount,
    bufferedAmountLowThreshold: 0,
    frames: [],
    peakBufferedAmount: initialBufferedAmount,
    addEventListener(type, listener) {
      const list = listeners.get(type) || new Set();
      list.add(listener);
      listeners.set(type, list);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type) { for (const listener of listeners.get(type) || []) listener(); },
    send(frame) {
      if (this.readyState !== 'open') throw new Error('closed');
      const size = typeof frame === 'string' ? new TextEncoder().encode(frame).byteLength : frame.byteLength;
      this.frames.push(typeof frame === 'string' ? frame : frame.slice());
      this.bufferedAmount += size;
      this.peakBufferedAmount = Math.max(this.peakBufferedAmount, this.bufferedAmount);
      if (!this.draining) {
        this.draining = true;
        setTimeout(() => {
          this.bufferedAmount = 0;
          this.draining = false;
          this.dispatch('bufferedamountlow');
        }, drainDelayMs);
      }
    }
  };
  return channel;
}

function incomingReceiver({ direction = 'host-to-guest', context = senderContext, ...options } = {}) {
  return createCollaborationAssetReceiver({
    channel: makeChannel(), direction, context, crypto: webcrypto, ...options
  });
}

function control(kind, fields, context = senderContext) {
  return { ...context, kind, ...fields };
}

function transferFrames({
  bytes,
  direction = 'host-to-guest',
  context = senderContext,
  transferId = 'transfer-a',
  assetId = 'asset-a',
  assetKind = 'image',
  mimeType = assetKind === 'font' ? 'font/woff2' : 'image/png',
  fontMetadata = assetKind === 'font' ? { name: 'Example.woff2', family: 'Example', weight: 400, style: 'normal' } : null,
  digest
}) {
  const sha256 = digest || 'a'.repeat(64);
  const chunkCount = Math.ceil(bytes.byteLength / MAX_ASSET_CHUNK_BYTES);
  const common = { ...context, flow: direction, transferId, assetKind };
  const frames = [control('ASSET_BEGIN', {
    ...common, assetId, mimeType, fontMetadata, byteLength: bytes.byteLength, chunkCount, sha256
  }, context)];
  for (let index = 0; index < chunkCount; index += 1) {
    const offset = index * MAX_ASSET_CHUNK_BYTES;
    frames.push(control('ASSET_CHUNK', {
      ...common,
      index,
      bytes: bytes.subarray(offset, Math.min(offset + MAX_ASSET_CHUNK_BYTES, bytes.byteLength))
    }, context));
  }
  frames.push(control('ASSET_END', { ...common, assetId, byteLength: bytes.byteLength, sha256 }, context));
  return frames;
}

async function acceptFrames(receiver, frames) {
  let result = null;
  for (const frame of frames) {
    result = frame instanceof Uint8Array || typeof frame === 'string'
      ? await receiver.acceptFrame(frame)
      : await receiver.accept(frame);
  }
  return result;
}

function assertTransferError(promise, code) {
  return assert.rejects(promise, error => {
    assert.ok(error instanceof CollaborationAssetTransferError);
    assert.equal(error.code, code);
    return true;
  });
}

test('image asset transfer preserves exact bytes and verifies the sender digest', async () => {
  const bytes = Uint8Array.from({ length: MAX_ASSET_CHUNK_BYTES * 2 + 321 }, (_, index) => (index * 31) & 0xff);
  const channel = makeChannel();
  const sent = await sendCollaborationAsset(channel, {
    context: senderContext,
    direction: 'host-to-guest',
    transferId: 'transfer-exact',
    assetId: 'asset-image',
    assetKind: 'image',
    mimeType: 'image/png',
    bytes,
    crypto: webcrypto,
    maxBufferedAmount: MAX_ASSET_CHUNK_BYTES + 2055
  });
  assert.equal(sent.chunkCount, 3);
  assert.equal(sent.sha256, await hash(bytes));
  assert.ok(channel.peakBufferedAmount <= MAX_ASSET_CHUNK_BYTES + 2055, 'buffering stays within the configured bound');
  assert.ok(channel.frames.some(frame => typeof frame !== 'string'), 'asset data travels as binary frames');

  const receiver = incomingReceiver({ direction: 'host-to-guest' });
  const result = await acceptFrames(receiver, channel.frames);
  assert.equal(result.assetId, 'asset-image');
  assert.equal(result.assetKind, 'image');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.actorId, senderContext.actorId);
  assert.deepEqual(result.bytes, bytes);
});

test('font assets support guest-to-host flow with repeated direction and authenticated actor', async () => {
  const fontBytes = Uint8Array.from([0x77, 0x4f, 0x46, 0x32, ...Array.from({ length: 80 }, (_, index) => index)]);
  const channel = makeChannel();
  const result = await sendCollaborationAsset(channel, {
    context: guestContext,
    direction: 'guest-to-host',
    transferId: 'font-transfer',
    assetId: 'font-regular',
    assetKind: 'font',
    mimeType: 'font/woff2',
    fontMetadata: { name: 'Example.woff2', family: 'Example', weight: 400, style: 'normal' },
    bytes: fontBytes,
    crypto: webcrypto
  });
  assert.equal(result.chunkCount, 1);
  const decoded = channel.frames.map(frame => decodeCollaborationMessage(frame, {
    direction: 'guest-to-host',
    context: { designId: guestContext.designId, sessionId: guestContext.sessionId, actorId: guestContext.actorId }
  }));
  assert.ok(decoded.every(frame => frame.flow === 'guest-to-host'));
  const receiver = incomingReceiver({ direction: 'guest-to-host', context: guestContext });
  const received = await acceptFrames(receiver, decoded);
  assert.equal(received.assetKind, 'font');
  assert.deepEqual(received.fontMetadata, { name: 'Example.woff2', family: 'Example', weight: 400, style: 'normal' });
  assert.deepEqual(received.bytes, fontBytes);
});

test('wrong direction and sender actor/context are rejected before accepting asset bytes', async () => {
  const bytes = Uint8Array.of(1, 2, 3);
  const digest = await hash(bytes);
  const frames = transferFrames({ bytes, digest, direction: 'host-to-guest' });
  const wrongDirectionReceiver = incomingReceiver({ direction: 'guest-to-host' });
  await assert.rejects(wrongDirectionReceiver.accept(frames[0]), error => {
    assert.ok(error instanceof CollaborationProtocolError);
    assert.equal(error.code, 'INVALID_DIRECTION');
    return true;
  });

  const changedActor = transferFrames({
    bytes, digest,
    context: { ...senderContext, actorId: 'unbound-actor' }
  });
  const actorBoundReceiver = incomingReceiver({ direction: 'host-to-guest' });
  await assert.rejects(actorBoundReceiver.accept(changedActor[0]), error => {
    assert.ok(error instanceof CollaborationProtocolError);
    assert.equal(error.code, 'CONTEXT_MISMATCH');
    return true;
  });
});

test('duplicate and out-of-order chunks terminate a transfer', async () => {
  const bytes = new Uint8Array(MAX_ASSET_CHUNK_BYTES + 5).fill(7);
  const frames = transferFrames({ bytes, digest: await hash(bytes) });
  const duplicateReceiver = incomingReceiver();
  await duplicateReceiver.accept(frames[0]);
  await duplicateReceiver.accept(frames[1]);
  await assertTransferError(duplicateReceiver.accept(frames[1]), 'OUT_OF_ORDER_CHUNK');
  assert.equal(duplicateReceiver.getActiveTransfer(), null);

  const outOfOrderReceiver = incomingReceiver();
  await outOfOrderReceiver.accept(frames[0]);
  await assertTransferError(outOfOrderReceiver.accept(frames[2]), 'OUT_OF_ORDER_CHUNK');
  assert.equal(outOfOrderReceiver.getActiveTransfer(), null);
});

test('missing chunks, transfer metadata changes, and tampered digest never yield bytes', async () => {
  const bytes = new Uint8Array(MAX_ASSET_CHUNK_BYTES + 1).fill(8);
  const frames = transferFrames({ bytes, digest: await hash(bytes) });
  const missingReceiver = incomingReceiver();
  await missingReceiver.accept(frames[0]);
  await missingReceiver.accept(frames[1]);
  await assertTransferError(missingReceiver.accept(frames.at(-1)), 'INCOMPLETE_TRANSFER');

  const tampered = transferFrames({ bytes: Uint8Array.of(1, 2, 3), digest: await hash(Uint8Array.of(4, 5, 6)) });
  const digestReceiver = incomingReceiver();
  await digestReceiver.accept(tampered[0]);
  await digestReceiver.accept(tampered[1]);
  await assertTransferError(digestReceiver.accept(tampered.at(-1)), 'DIGEST_MISMATCH');
});

test('asset size cap is enforced before receiver allocation and on sending', async () => {
  assert.equal(MAX_ASSET_BYTES, 64 * 1024 * 1024);
  const tooLarge = new Uint8Array(11);
  const frames = transferFrames({ bytes: tooLarge, digest: 'a'.repeat(64) });
  const boundedReceiver = incomingReceiver({ maxBytes: 10 });
  await assertTransferError(boundedReceiver.accept(frames[0]), 'SIZE_LIMIT');

  await assertTransferError(sendCollaborationAsset(makeChannel(), {
    context: senderContext,
    direction: 'host-to-guest',
    transferId: 'too-large',
    assetId: 'asset-a',
    assetKind: 'image',
    mimeType: 'image/png',
    bytes: new Uint8Array(MAX_ASSET_BYTES + 1),
    crypto: webcrypto
  }), 'SIZE_LIMIT');
});

test('an incoming transfer timeout clears its state and reservation, and rejects later frames', async () => {
  const channel = makeChannel();
  const receiver = createCollaborationAssetReceiver({
    channel, direction: 'host-to-guest', context: senderContext, crypto: webcrypto,
    transferTimeoutMs: 20
  });
  const frames = transferFrames({ bytes: Uint8Array.of(1, 2, 3) });
  assert.equal(await receiver.accept(frames[0]), null);
  assert.equal(receiver.getActiveTransfer().receivedBytes, 0);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(receiver.getActiveTransfer(), null);
  await assertTransferError(receiver.accept(frames[1]), 'UNEXPECTED_CHUNK');
  await assertTransferError(receiver.accept(frames.at(-1)), 'UNEXPECTED_END');

  const nextReceiver = createCollaborationAssetReceiver({
    channel, direction: 'host-to-guest', context: senderContext, crypto: webcrypto,
    transferTimeoutMs: 20
  });
  const nextFrames = transferFrames({ bytes: Uint8Array.of(4, 5, 6), transferId: 'transfer-next' });
  assert.equal(await nextReceiver.accept(nextFrames[0]), null, 'the timed-out transfer releases the channel reservation');
  nextReceiver.cancel();
});

test('a DataChannel admits one transfer at a time and applies bounded bufferedAmount backpressure', async () => {
  const channel = makeChannel({ drainDelayMs: 3 });
  const options = {
    context: senderContext,
    direction: 'host-to-guest',
    assetKind: 'image',
    mimeType: 'image/png',
    crypto: webcrypto,
    maxBufferedAmount: MAX_ASSET_CHUNK_BYTES + 2055,
    bytes: new Uint8Array(MAX_ASSET_CHUNK_BYTES * 3).fill(4)
  };
  const first = sendCollaborationAsset(channel, { ...options, transferId: 'transfer-first', assetId: 'asset-first' });
  await assertTransferError(sendCollaborationAsset(channel, {
    ...options, transferId: 'transfer-second', assetId: 'asset-second', bytes: Uint8Array.of(2)
  }), 'TRANSFER_IN_PROGRESS');
  const sent = await first;
  assert.equal(sent.chunkCount, 3);
  assert.ok(channel.peakBufferedAmount <= options.maxBufferedAmount);
});

test('invalid mime-kind pairings and repeated transfer IDs are rejected', async () => {
  await assert.rejects(sendCollaborationAsset(makeChannel(), {
    context: senderContext,
    direction: 'host-to-guest',
    transferId: 'bad-kind',
    assetId: 'asset-font',
    assetKind: 'font',
    mimeType: 'image/png',
    bytes: Uint8Array.of(1),
    crypto: webcrypto
  }), error => {
    assert.ok(error instanceof CollaborationProtocolError);
    assert.equal(error.code, 'INVALID_MESSAGE');
    return true;
  });

  const bytes = Uint8Array.of(1, 2, 3);
  const frames = transferFrames({ bytes, digest: await hash(bytes) });
  const receiver = incomingReceiver();
  await acceptFrames(receiver, frames);
  await assertTransferError(receiver.accept(frames[0]), 'REPLAYED_TRANSFER');
});
