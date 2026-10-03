import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import QRCode from 'qrcode';
import {
  createLiveAnswerQrPayload,
  createLiveInvitationQrPayload,
  createQrTransferAssembler,
  createQrTransferFrames,
  qrTransferLimits,
  readLiveQrPayload
} from '../src/collaboration/qr-transport.js';

test('multi-frame QR handoffs reassemble in any order and ignore repeated camera frames', async () => {
  const original = `Tiny Image Star invitation payload ${'abc-123_'.repeat(420)}`;
  const { id, checksum, frames } = await createQrTransferFrames(original, { crypto: webcrypto });
  assert.match(id, /^[A-Za-z0-9_-]{16}$/u);
  assert.match(checksum, /^[a-f0-9]{64}$/u);
  assert.ok(frames.length > 1);
  assert.ok(frames.length <= qrTransferLimits.maxFrames);
  assert.ok(frames.every(frame => frame.length <= 900));
  for (const frame of frames) assert.ok(QRCode.create(frame, { errorCorrectionLevel: 'M' }).version <= 24);

  const assembler = createQrTransferAssembler({ crypto: webcrypto });
  assert.deepEqual(await assembler.accept(frames.at(-1)), { status: 'progress', received: 1, total: frames.length });
  assert.deepEqual(await assembler.accept(frames.at(-1)), { status: 'duplicate', received: 1, total: frames.length });
  let result;
  for (const frame of frames.slice(0, -1).reverse()) result = await assembler.accept(frame);
  assert.equal(result.status, 'complete');
  assert.equal(result.value, original);
  assert.deepEqual(assembler.progress(), { received: 0, total: 0 });
});

test('QR assembly refuses mixed transfers, conflicting duplicates, corrupt data, and oversized payloads', async () => {
  const first = await createQrTransferFrames('first'.repeat(180), { crypto: webcrypto });
  const second = await createQrTransferFrames('second'.repeat(180), { crypto: webcrypto });
  const assembler = createQrTransferAssembler({ crypto: webcrypto });
  await assembler.accept(first.frames[0]);
  assert.deepEqual(await assembler.accept(second.frames[0]), { status: 'different-transfer', received: 1, total: first.frames.length });

  const conflicting = first.frames[0].replace(/.$/u, first.frames[0].endsWith('A') ? 'B' : 'A');
  await assert.rejects(assembler.accept(conflicting), /conflicts/u);
  assembler.reset();

  const tampered = [...first.frames];
  tampered[0] = tampered[0].replace(/\.([A-Za-z0-9_-]+)$/u, (_match, chunk) => `.${chunk.slice(0, -1)}${chunk.endsWith('A') ? 'B' : 'A'}`);
  for (const frame of tampered.slice(1)) await assembler.accept(frame);
  await assert.rejects(assembler.accept(tampered[0]), /checksum/u);
  await assert.rejects(createQrTransferFrames('x'.repeat(qrTransferLimits.maxTransferBytes + 1), { crypto: webcrypto }), /size limit/u);
  await assert.rejects(assembler.accept('tistqr1.bad.1.1.not-a-checksum.bad'), /metadata/u);
});

test('live QR payloads carry only the required invitation and offer, or one guest answer', () => {
  const invitation = 'https://tiny-image-star.example/#tisd1.example-capability';
  const offer = `tisc1.${'a'.repeat(128)}`;
  assert.deepEqual(readLiveQrPayload(createLiveInvitationQrPayload(invitation, offer)), {
    kind: 'live-invitation', invitation, offer
  });
  const answer = `tisc1.${'b'.repeat(128)}`;
  assert.deepEqual(readLiveQrPayload(createLiveAnswerQrPayload(answer)), { kind: 'live-answer', answer });
  assert.throws(() => createLiveInvitationQrPayload(invitation, 'https://wrong.example/'), /invalid/u);
  assert.throws(() => readLiveQrPayload(JSON.stringify({ v: 1, kind: 'live-answer', answer, secret: 'unexpected' })), /valid live-sharing/u);
  assert.throws(() => readLiveQrPayload('https://attacker.example/'), /not a Tiny Image Star/u);
});
