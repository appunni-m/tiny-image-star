import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CollaborationProtocolError,
  decodeCollaborationMessage,
  encodeCollaborationMessage,
  MAX_ASSET_CHUNK_BYTES,
  MAX_ASSET_BYTES,
  MAX_CONTROL_MESSAGE_BYTES,
  validateCollaborationMessage
} from '../src/collaboration/protocol.js';

const context = { v: 1, designId: 'design-a', sessionId: 'session-a', actorId: 'actor-a' };
const digest = 'a'.repeat(64);
const opBase = { opId: 'op-a', baseRevision: 3, pageId: 'page-a' };

function message(kind, fields = {}) {
  return { ...context, kind, ...(['WELCOME', 'ACK', 'REJECT', 'SNAPSHOT'].includes(kind) ? { headHash: digest } : {}), ...fields };
}

function assertProtocolError(fn, code) {
  assert.throws(fn, error => {
    assert.ok(error instanceof CollaborationProtocolError);
    assert.equal(error.name, 'CollaborationProtocolError');
    if (code) assert.equal(error.code, code);
    return true;
  });
}

const operations = [
  { ...opBase, type: 'SetProperty', targetId: 'node-a', property: 'fills.0.opacity', value: 0.75 },
  { ...opBase, type: 'InsertNode', nodeId: 'node-b', parentId: 'frame-a', index: 0, node: { id: 'node-b', type: 'shape', bounds: { x: 1.5, y: -2, width: 40, height: 20 } } },
  { ...opBase, type: 'DeleteNode', nodeId: 'node-b' },
  { ...opBase, type: 'MoveNode', nodeId: 'node-b', parentId: null, index: 4 },
  { ...opBase, type: 'ReplaceText', nodeId: 'text-a', text: 'New label' },
  { opId: 'op-a', baseRevision: 3, type: 'ReplaceSnapshot', snapshot: { id: 'design-a', pages: [] } },
  { opId: 'op-a', baseRevision: 3, type: 'AddAsset', assetId: 'asset-a', mimeType: 'image/png', byteLength: 12, sha256: digest },
  { opId: 'op-a', baseRevision: 3, type: 'RemoveAsset', assetId: 'asset-a' }
];

test('JSON message types round-trip with strict direction and preserve typed operations', () => {
  const messages = [
    message('HELLO', { lastRevision: 3 }),
    message('WELCOME', { hostActorId: 'host-a', revision: 4 }),
    ...operations.map(operation => message('OPERATION', { operation })),
    message('ACK', { opId: 'op-a', revision: 4 }),
    message('REJECT', { opId: 'op-a', revision: 4, code: 'STALE_REVISION' }),
    message('SNAPSHOT', { revision: 4, snapshot: { pages: [{ id: 'page-a', children: [] }] } }),
    message('FORK_NOTICE', { baseRevision: 3, forkId: 'fork-a', reason: 'DISCONNECTED' }),
    message('PING', { nonce: 'ping-a', sentAt: 1_700_000_000_000 }),
    message('PONG', { nonce: 'ping-a', sentAt: 1_700_000_000_000 }),
    message('ASSET_BEGIN', { flow: 'guest-to-host', transferId: 'transfer-a', assetId: 'asset-a', assetKind: 'image', mimeType: 'image/png', fontMetadata: null, byteLength: 32_768, chunkCount: 2, sha256: digest }),
    message('ASSET_END', { flow: 'guest-to-host', transferId: 'transfer-a', assetId: 'asset-a', assetKind: 'image', byteLength: 32_768, sha256: digest })
  ];
  for (const item of messages) {
    const encoded = encodeCollaborationMessage(item);
    assert.equal(typeof encoded, 'string', item.kind);
    assert.deepEqual(decodeCollaborationMessage(encoded), item, item.kind);
  }
  assert.deepEqual(validateCollaborationMessage(messages[2], { direction: 'guest-to-host' }), messages[2]);
  assertProtocolError(() => validateCollaborationMessage(messages[0], { direction: 'host-to-guest' }), 'INVALID_DIRECTION');
  assertProtocolError(() => validateCollaborationMessage(messages[1], { direction: 'guest-to-host' }), 'INVALID_DIRECTION');
  assert.deepEqual(validateCollaborationMessage(messages.at(-2), {
    direction: 'guest-to-host', context
  }), messages.at(-2));
  assertProtocolError(() => validateCollaborationMessage(messages.at(-2), { direction: 'host-to-guest' }), 'INVALID_DIRECTION');
  assertProtocolError(() => validateCollaborationMessage(message('ASSET_END', {
    flow: 'guest-to-host', transferId: 'transfer-a', assetId: 'asset-a', assetKind: 'image', byteLength: 32_768, sha256: digest
  }), { direction: 'host-to-guest' }), 'INVALID_DIRECTION');
  assertProtocolError(() => validateCollaborationMessage(messages.at(-2), {
    direction: 'guest-to-host', context: { ...context, actorId: 'other-peer' }
  }), 'CONTEXT_MISMATCH');
  assertProtocolError(() => validateCollaborationMessage(message('ASSET_BEGIN', {
    flow: 'guest-to-host', transferId: 'transfer-a', assetId: 'asset-a', assetKind: 'font', mimeType: 'image/png', fontMetadata: null,
    byteLength: 8, chunkCount: 1, sha256: digest
  })), 'INVALID_MESSAGE');
});

test('asset chunks use bounded binary frames and round-trip without base64 expansion', () => {
  const bytes = Uint8Array.from({ length: 257 }, (_, index) => index & 0xff);
  const chunk = message('ASSET_CHUNK', { flow: 'guest-to-host', transferId: 'transfer-a', assetKind: 'image', index: 2, bytes });
  const encoded = encodeCollaborationMessage(chunk, { direction: 'guest-to-host' });
  assert.ok(encoded instanceof Uint8Array);
  assert.ok(encoded.byteLength < bytes.byteLength + 512);
  const decoded = decodeCollaborationMessage(encoded, { direction: 'guest-to-host' });
  assert.equal(decoded.kind, 'ASSET_CHUNK');
  assert.equal(decoded.index, 2);
  assert.deepEqual(decoded.bytes, bytes);
  assert.equal(decoded.flow, 'guest-to-host');
  assert.equal(decoded.assetKind, 'image');
  bytes[0] = 99;
  assert.equal(decoded.bytes[0], 0, 'decoded chunks are a defensive copy');
  assertProtocolError(() => encodeCollaborationMessage(chunk, { direction: 'host-to-guest' }), 'INVALID_DIRECTION');
});

test('messages and operations reject unknown versions, kinds, operations, and fields', () => {
  assertProtocolError(() => validateCollaborationMessage(message('NOPE')), 'UNKNOWN_KIND');
  assertProtocolError(() => validateCollaborationMessage({ ...message('HELLO', { lastRevision: 0 }), extra: true }), 'INVALID_MESSAGE');
  assertProtocolError(() => validateCollaborationMessage(message('HELLO', { lastRevision: 0, v: 2 })), 'UNSUPPORTED_VERSION');
  assertProtocolError(() => validateCollaborationMessage({ ...message('HELLO', { lastRevision: 0 }), v: 2 }), 'UNSUPPORTED_VERSION');
  assertProtocolError(() => validateCollaborationMessage(message('OPERATION', { operation: { ...opBase, type: 'MergeEverything' } })), 'UNKNOWN_OPERATION');
  assertProtocolError(() => validateCollaborationMessage(message('OPERATION', { operation: { ...operations[0], stealth: true } })), 'INVALID_MESSAGE');
  assertProtocolError(() => decodeCollaborationMessage('{broken json'), 'INVALID_MESSAGE');
});

test('operation IDs, revisions, property paths, finite JSON, and reserved keys are checked', () => {
  const good = operations[0];
  const invalid = [
    { ...good, opId: '../secret' },
    { ...good, baseRevision: -1 },
    { ...good, value: Number.NaN },
    { ...good, value: Infinity },
    { ...good, property: '__proto__.polluted' },
    { ...good, property: 'constructor.prototype.polluted' },
    { ...good, value: JSON.parse('{"__proto__":{"polluted":true}}') },
    { ...good, value: new Date() },
    { ...good, value: undefined }
  ];
  for (const operation of invalid) {
    assertProtocolError(() => validateCollaborationMessage(message('OPERATION', { operation })));
  }
  const deep = { value: 'end' };
  let current = deep;
  for (let i = 0; i < 30; i += 1) current = current.value = { value: current.value };
  assertProtocolError(() => validateCollaborationMessage(message('OPERATION', { operation: { ...good, value: deep } })), 'LIMIT_EXCEEDED');
});

test('message, snapshot, asset, and chunk limits fail with typed errors', () => {
  const huge = 'x'.repeat(MAX_CONTROL_MESSAGE_BYTES + 1);
  assertProtocolError(() => decodeCollaborationMessage(huge), 'LIMIT_EXCEEDED');
  assertProtocolError(() => validateCollaborationMessage(message('SNAPSHOT', {
    revision: 0,
    snapshot: { data: ['x'.repeat(200 * 1024), 'y'.repeat(200 * 1024), 'z'.repeat(200 * 1024), 'w'.repeat(200 * 1024)] }
  })), 'LIMIT_EXCEEDED');
  assertProtocolError(() => validateCollaborationMessage(message('OPERATION', {
    operation: { opId: 'op-large', baseRevision: 0, type: 'ReplaceSnapshot', snapshot: { data: [
      'a'.repeat(200 * 1024), 'b'.repeat(200 * 1024), 'c'.repeat(200 * 1024), 'd'.repeat(200 * 1024)
    ] } }
  })), 'LIMIT_EXCEEDED');
  assertProtocolError(() => validateCollaborationMessage(message('ASSET_BEGIN', {
    flow: 'guest-to-host', transferId: 't', assetId: 'a', assetKind: 'image', mimeType: 'image/png', fontMetadata: null, byteLength: MAX_ASSET_BYTES + 1,
    chunkCount: 1, sha256: digest
  })), 'INVALID_MESSAGE');
  assertProtocolError(() => validateCollaborationMessage(message('ASSET_BEGIN', {
    flow: 'guest-to-host', transferId: 't', assetId: 'a', assetKind: 'image', mimeType: 'image/png', fontMetadata: null, byteLength: 16_385,
    chunkCount: 1, sha256: digest
  })), 'INVALID_MESSAGE');
  assertProtocolError(() => encodeCollaborationMessage(message('ASSET_CHUNK', {
    flow: 'guest-to-host', transferId: 'transfer-a', assetKind: 'image', index: 0, bytes: new Uint8Array(MAX_ASSET_CHUNK_BYTES + 1)
  })), 'INVALID_CHUNK');
  assertProtocolError(() => encodeCollaborationMessage(message('ASSET_CHUNK', {
    flow: 'guest-to-host', transferId: 'transfer-a', assetKind: 'image', index: 0, bytes: new Uint8Array()
  })), 'INVALID_CHUNK');
  assert.equal(MAX_ASSET_CHUNK_BYTES, 16 * 1024);
  assert.equal(MAX_CONTROL_MESSAGE_BYTES, 1024 * 1024);
});

test('malformed and tampered binary chunk frames are rejected', () => {
  const valid = encodeCollaborationMessage(message('ASSET_CHUNK', {
    flow: 'guest-to-host', transferId: 'transfer-a', assetKind: 'image', index: 0, bytes: Uint8Array.of(1, 2, 3)
  }));
  const badMagic = valid.slice();
  badMagic[0] ^= 0xff;
  assertProtocolError(() => decodeCollaborationMessage(badMagic), 'INVALID_CHUNK');
  const badVersion = valid.slice();
  badVersion[4] = 7;
  assertProtocolError(() => decodeCollaborationMessage(badVersion), 'UNSUPPORTED_VERSION');
  assertProtocolError(() => decodeCollaborationMessage(new Uint8Array(7)), 'INVALID_CHUNK');
  assertProtocolError(() => decodeCollaborationMessage(new Uint8Array([1, 2, 3])), 'INVALID_CHUNK');
});

test('JSON input rejects accessors, unsafe prototypes, and values that are not plain JSON', () => {
  const accessorMessage = message('HELLO', { lastRevision: 0 });
  Object.defineProperty(accessorMessage, 'designId', { enumerable: true, get: () => 'design-a' });
  assertProtocolError(() => validateCollaborationMessage(accessorMessage), 'INVALID_MESSAGE');

  const customPrototype = Object.create({ inherited: true });
  Object.assign(customPrototype, message('HELLO', { lastRevision: 0 }));
  assertProtocolError(() => validateCollaborationMessage(customPrototype), 'INVALID_MESSAGE');

  const sparse = new Array(2);
  assertProtocolError(() => validateCollaborationMessage(message('OPERATION', {
    operation: { ...operations[0], value: sparse }
  })), 'INVALID_MESSAGE');
});
