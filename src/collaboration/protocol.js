const PROTOCOL_VERSION = 1;
const MESSAGE_PREFIX = 'tiny-image-star-collaboration';
const UTF8 = new TextEncoder();
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PROPERTY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MESSAGE_KINDS = new Set([
  'HELLO', 'WELCOME', 'OPERATION', 'ACK', 'REJECT', 'SNAPSHOT', 'ROOM_REVISION', 'VIEW_STATE', 'FORK_NOTICE',
  'PING', 'PONG', 'ASSET_BEGIN', 'ASSET_CHUNK', 'ASSET_END'
]);
const REJECTION_CODES = new Set([
  'STALE_REVISION', 'INVALID_OPERATION', 'ASSET_MISSING', 'PERMISSION_DENIED',
  'UNSUPPORTED_OPERATION', 'CONFLICT', 'LIMIT_EXCEEDED'
]);
const FORK_REASONS = new Set(['REJECTED', 'DISCONNECTED', 'DIVERGED']);
const MAX_DEPTH = 24;
const MAX_JSON_NODES = 20_000;
const MAX_ARRAY_ITEMS = 10_000;
const MAX_OBJECT_KEYS = 10_000;
const MAX_STRING_BYTES = 256 * 1024;

export const MAX_CONTROL_MESSAGE_BYTES = 1024 * 1024;
export const MAX_ASSET_CHUNK_BYTES = 16 * 1024;
export const MAX_ASSET_BYTES = 64 * 1024 * 1024;
export const MAX_ASSET_CHUNKS = MAX_ASSET_BYTES / MAX_ASSET_CHUNK_BYTES;
export const MAX_SNAPSHOT_BYTES = 768 * 1024;

const MESSAGE_FIELDS = {
  HELLO: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'lastRevision'],
  WELCOME: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'hostActorId', 'revision', 'headHash'],
  OPERATION: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'operation'],
  ACK: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'opId', 'revision', 'headHash'],
  REJECT: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'opId', 'revision', 'code', 'headHash'],
  SNAPSHOT: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'revision', 'headHash', 'snapshot'],
  ROOM_REVISION: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'revision', 'headHash', 'snapshot'],
  VIEW_STATE: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'sequence', 'pageId', 'zoom', 'centerX', 'centerY'],
  FORK_NOTICE: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'baseRevision', 'forkId', 'reason'],
  PING: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'nonce', 'sentAt'],
  PONG: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'nonce', 'sentAt'],
  ASSET_BEGIN: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'flow', 'transferId', 'assetId', 'assetKind', 'mimeType', 'fontMetadata', 'byteLength', 'chunkCount', 'sha256'],
  ASSET_CHUNK: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'flow', 'transferId', 'assetKind', 'index', 'bytes'],
  ASSET_END: ['v', 'kind', 'designId', 'sessionId', 'actorId', 'flow', 'transferId', 'assetId', 'assetKind', 'byteLength', 'sha256']
};

const GUEST_TO_HOST = new Set(['HELLO', 'OPERATION', 'FORK_NOTICE']);
const HOST_TO_GUEST = new Set(['WELCOME', 'ACK', 'REJECT', 'SNAPSHOT', 'ROOM_REVISION', 'VIEW_STATE']);

/** A stable, machine-readable failure from the collaboration wire contract. */
export class CollaborationProtocolError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'CollaborationProtocolError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CollaborationProtocolError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainDataRecord(value, label) {
  if (!isPlainObject(value)) fail('INVALID_MESSAGE', `${label} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || RESERVED_KEYS.has(key)) fail('INVALID_MESSAGE', `${label} contains a reserved or non-string key.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('INVALID_MESSAGE', `${label} contains an accessor or non-enumerable field.`);
    }
  }
}

function exactKeys(value, expected, label) {
  assertPlainDataRecord(value, label);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) {
    fail('INVALID_MESSAGE', `${label} has missing or unknown fields.`);
  }
}

function assertId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail('INVALID_MESSAGE', `${label} is invalid.`);
}

function assertRevision(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_MESSAGE', `${label} must be a non-negative safe integer.`);
}

function assertFiniteInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_MESSAGE', `${label} is out of range.`);
}

function assertString(value, label, maxBytes = 64 * 1024, { allowEmpty = true } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || UTF8.encode(value).byteLength > maxBytes) {
    fail('INVALID_MESSAGE', `${label} must be a bounded string.`);
  }
}

function copyJsonValue(value, label, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) fail('LIMIT_EXCEEDED', `${label} contains too many values.`);
  if (depth > MAX_DEPTH) fail('LIMIT_EXCEEDED', `${label} is nested too deeply.`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    assertString(value, label, MAX_STRING_BYTES);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_MESSAGE', `${label} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_ARRAY_ITEMS) {
      fail('LIMIT_EXCEEDED', `${label} contains an unsupported or oversized array.`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (!/^(0|[1-9]\d*)$/.test(String(key)) || Number(key) >= value.length))) {
      fail('INVALID_MESSAGE', `${label} contains a sparse or decorated array.`);
    }
    const result = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        fail('INVALID_MESSAGE', `${label} contains an accessor or missing array item.`);
      }
      result[index] = copyJsonValue(descriptor.value, label, state, depth + 1);
    }
    return result;
  }
  if (!isPlainObject(value)) fail('INVALID_MESSAGE', `${label} must contain plain JSON values only.`);
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_OBJECT_KEYS) fail('LIMIT_EXCEEDED', `${label} contains too many object fields.`);
  const result = {};
  for (const key of keys) {
    if (typeof key !== 'string' || RESERVED_KEYS.has(key)) fail('INVALID_MESSAGE', `${label} contains a reserved or non-string key.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('INVALID_MESSAGE', `${label} contains an accessor or non-enumerable field.`);
    }
    result[key] = copyJsonValue(descriptor.value, label, state, depth + 1);
  }
  return result;
}

function assertJsonObject(value, label) {
  if (!isPlainObject(value)) fail('INVALID_MESSAGE', `${label} must be a plain JSON object.`);
  return copyJsonValue(value, label);
}

function assertHash(value, label = 'SHA-256 digest') {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail('INVALID_MESSAGE', `${label} must be 64 lowercase hexadecimal characters.`);
}

function assertMimeType(value) {
  if (typeof value !== 'string' || value.length > 127 || !MIME_TYPE_PATTERN.test(value)) fail('INVALID_MESSAGE', 'Asset MIME type is invalid.');
}

function assertAssetKind(value, mimeType) {
  if (value !== 'image' && value !== 'font') fail('INVALID_MESSAGE', 'Asset kind must be image or font.');
  if (mimeType !== undefined) {
    const supported = value === 'image'
      ? /^image\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mimeType)
      : ['font/woff2', 'font/woff', 'font/otf', 'font/ttf'].includes(mimeType);
    if (!supported) fail('INVALID_MESSAGE', `MIME type does not match ${value} asset kind.`);
  }
}

function validateFontMetadata(value, assetKind) {
  if (assetKind === 'image') {
    if (value !== null) fail('INVALID_MESSAGE', 'Image assets cannot include font metadata.');
    return null;
  }
  exactKeys(value, ['name', 'family', 'weight', 'style'], 'Font asset metadata');
  assertString(value.name, 'Font filename', 255, { allowEmpty: false });
  assertString(value.family, 'Font family', 120, { allowEmpty: false });
  if (/[\x00-\x1f\x7f]/u.test(value.name) || /[\x00-\x1f\x7f]/u.test(value.family)
    || !Number.isInteger(value.weight) || value.weight < 1 || value.weight > 1000
    || !['normal', 'italic'].includes(value.style)) fail('INVALID_MESSAGE', 'Font asset metadata is invalid.');
  return { name: value.name, family: value.family, weight: value.weight, style: value.style };
}

function assertContext(message) {
  if (message.v !== PROTOCOL_VERSION) fail('UNSUPPORTED_VERSION', `Unsupported collaboration protocol version: ${String(message.v)}.`);
  if (!MESSAGE_KINDS.has(message.kind)) fail('UNKNOWN_KIND', `Unknown collaboration message kind: ${String(message.kind)}.`);
  assertId(message.designId, 'Design ID');
  assertId(message.sessionId, 'Session ID');
  assertId(message.actorId, 'Actor ID');
}

function assertExpectedContext(message, expected) {
  if (expected === undefined) return;
  assertPlainDataRecord(expected, 'Expected message context');
  for (const key of Reflect.ownKeys(expected)) {
    if (key === 'v') {
      if (expected.v !== PROTOCOL_VERSION) fail('UNSUPPORTED_VERSION', 'Expected peer context uses an unsupported protocol version.');
      continue;
    }
    if (!['designId', 'sessionId', 'actorId'].includes(key)) fail('INVALID_MESSAGE', 'Expected message context contains an unknown field.');
    assertId(expected[key], `Expected ${key}`);
    if (message[key] !== expected[key]) fail('CONTEXT_MISMATCH', `Collaboration ${key} does not match the authenticated peer context.`);
  }
}

function validateOperation(operation) {
  assertPlainDataRecord(operation, 'Operation');
  if (typeof operation.type !== 'string') fail('INVALID_MESSAGE', 'Operation must have a typed payload.');
  const common = ['type', 'opId', 'baseRevision'];
  assertId(operation.opId, 'Operation ID');
  assertRevision(operation.baseRevision, 'Operation base revision');
  switch (operation.type) {
    case 'SetProperty': {
      exactKeys(operation, [...common, 'pageId', 'targetId', 'property', 'value'], 'SetProperty operation');
      assertId(operation.pageId, 'Page ID');
      assertId(operation.targetId, 'Target ID');
      if (typeof operation.property !== 'string' || !PROPERTY_PATTERN.test(operation.property)
        || operation.property.split('.').some(part => RESERVED_KEYS.has(part))) {
        fail('INVALID_MESSAGE', 'SetProperty property path is invalid.');
      }
      return { ...operation, value: copyJsonValue(operation.value, 'SetProperty value') };
    }
    case 'InsertNode': {
      exactKeys(operation, [...common, 'pageId', 'nodeId', 'parentId', 'index', 'node'], 'InsertNode operation');
      assertId(operation.pageId, 'Page ID');
      assertId(operation.nodeId, 'Node ID');
      if (operation.parentId !== null) assertId(operation.parentId, 'Parent node ID');
      assertFiniteInteger(operation.index, 0, 1_000_000, 'Insertion index');
      const node = assertJsonObject(operation.node, 'Inserted node');
      if (node.id !== operation.nodeId) fail('INVALID_MESSAGE', 'Inserted node ID must match nodeId.');
      return { ...operation, node };
    }
    case 'DeleteNode':
      exactKeys(operation, [...common, 'pageId', 'nodeId'], 'DeleteNode operation');
      assertId(operation.pageId, 'Page ID');
      assertId(operation.nodeId, 'Node ID');
      return { ...operation };
    case 'MoveNode':
      exactKeys(operation, [...common, 'pageId', 'nodeId', 'parentId', 'index'], 'MoveNode operation');
      assertId(operation.pageId, 'Page ID');
      assertId(operation.nodeId, 'Node ID');
      if (operation.parentId !== null) assertId(operation.parentId, 'Parent node ID');
      assertFiniteInteger(operation.index, 0, 1_000_000, 'Move index');
      return { ...operation };
    case 'ReplaceText':
      exactKeys(operation, [...common, 'pageId', 'nodeId', 'text'], 'ReplaceText operation');
      assertId(operation.pageId, 'Page ID');
      assertId(operation.nodeId, 'Node ID');
      assertString(operation.text, 'Replacement text', 256 * 1024);
      return { ...operation };
    case 'ReplaceSnapshot': {
      exactKeys(operation, [...common, 'snapshot'], 'ReplaceSnapshot operation');
      const snapshot = assertJsonObject(operation.snapshot, 'Replacement snapshot');
      if (UTF8.encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES) {
        fail('LIMIT_EXCEEDED', 'Replacement snapshot exceeds the snapshot size limit.');
      }
      return { ...operation, snapshot };
    }
    case 'AddAsset':
      exactKeys(operation, [...common, 'assetId', 'mimeType', 'byteLength', 'sha256'], 'AddAsset operation');
      assertId(operation.assetId, 'Asset ID');
      assertMimeType(operation.mimeType);
      assertFiniteInteger(operation.byteLength, 1, MAX_ASSET_BYTES, 'Asset byte length');
      assertHash(operation.sha256);
      return { ...operation };
    case 'RemoveAsset':
      exactKeys(operation, [...common, 'assetId'], 'RemoveAsset operation');
      assertId(operation.assetId, 'Asset ID');
      return { ...operation };
    default:
      fail('UNKNOWN_OPERATION', `Unknown operation type: ${operation.type}.`);
  }
}

function validateDirection(kind, direction, message) {
  if (direction === undefined || direction === 'any') return;
  if (direction !== 'guest-to-host' && direction !== 'host-to-guest') fail('INVALID_DIRECTION', 'Message direction must be guest-to-host or host-to-guest.');
  if (kind === 'ASSET_BEGIN' || kind === 'ASSET_CHUNK' || kind === 'ASSET_END') {
    if (message.flow !== direction) fail('INVALID_DIRECTION', `Asset flow ${String(message.flow)} cannot be received on the ${direction} path.`);
    return;
  }
  if (direction === 'guest-to-host' && HOST_TO_GUEST.has(kind)) fail('INVALID_DIRECTION', `${kind} is a host-to-guest message.`);
  if (direction === 'host-to-guest' && GUEST_TO_HOST.has(kind)) fail('INVALID_DIRECTION', `${kind} is a guest-to-host message.`);
}

function assertFlow(flow) {
  if (flow !== 'guest-to-host' && flow !== 'host-to-guest') fail('INVALID_DIRECTION', 'Asset flow must be guest-to-host or host-to-guest.');
}

function validateMessageFields(message) {
  exactKeys(message, MESSAGE_FIELDS[message.kind], `${message.kind} message`);
  assertContext(message);
  switch (message.kind) {
    case 'HELLO': assertRevision(message.lastRevision, 'Last known revision'); break;
    case 'WELCOME':
      assertId(message.hostActorId, 'Host actor ID');
      assertRevision(message.revision, 'Workspace revision');
      assertHash(message.headHash, 'Host commit hash');
      break;
    case 'OPERATION': return { ...message, operation: validateOperation(message.operation) };
    case 'ACK':
      assertId(message.opId, 'Operation ID');
      assertRevision(message.revision, 'Acknowledged revision');
      assertHash(message.headHash, 'Host commit hash');
      break;
    case 'REJECT':
      assertId(message.opId, 'Operation ID');
      assertRevision(message.revision, 'Current revision');
      assertHash(message.headHash, 'Host commit hash');
      if (!REJECTION_CODES.has(message.code)) fail('INVALID_MESSAGE', 'Rejection code is unsupported.');
      break;
    case 'SNAPSHOT':
    case 'ROOM_REVISION': {
      assertRevision(message.revision, 'Snapshot revision');
      assertHash(message.headHash, 'Snapshot commit hash');
      const snapshot = assertJsonObject(message.snapshot, 'Snapshot');
      const snapshotBytes = UTF8.encode(JSON.stringify(snapshot)).byteLength;
      if (snapshotBytes > MAX_SNAPSHOT_BYTES) fail('LIMIT_EXCEEDED', 'Snapshot exceeds the snapshot size limit.');
      return { ...message, snapshot };
    }
    case 'VIEW_STATE':
      assertFiniteInteger(message.sequence, 1, Number.MAX_SAFE_INTEGER, 'View-state sequence');
      assertId(message.pageId, 'View-state page ID');
      if (!Number.isFinite(message.zoom) || message.zoom < 0.08 || message.zoom > 8) {
        fail('INVALID_MESSAGE', 'View-state zoom must be between 0.08 and 8.');
      }
      if (!Number.isFinite(message.centerX) || Math.abs(message.centerX) > 10_000_000
        || !Number.isFinite(message.centerY) || Math.abs(message.centerY) > 10_000_000) {
        fail('INVALID_MESSAGE', 'View-state center coordinates are out of range.');
      }
      break;
    case 'FORK_NOTICE':
      assertRevision(message.baseRevision, 'Fork base revision');
      assertId(message.forkId, 'Fork ID');
      if (!FORK_REASONS.has(message.reason)) fail('INVALID_MESSAGE', 'Fork reason is unsupported.');
      break;
    case 'PING':
    case 'PONG':
      assertId(message.nonce, 'Ping nonce');
      if (!Number.isSafeInteger(message.sentAt) || message.sentAt < 0) fail('INVALID_MESSAGE', 'Ping timestamp is invalid.');
      break;
    case 'ASSET_BEGIN': {
      assertFlow(message.flow);
      assertId(message.transferId, 'Transfer ID');
      assertId(message.assetId, 'Asset ID');
      assertAssetKind(message.assetKind, message.mimeType);
      assertMimeType(message.mimeType);
      const fontMetadata = validateFontMetadata(message.fontMetadata, message.assetKind);
      assertFiniteInteger(message.byteLength, 1, MAX_ASSET_BYTES, 'Asset byte length');
      const chunks = Math.ceil(message.byteLength / MAX_ASSET_CHUNK_BYTES);
      assertFiniteInteger(message.chunkCount, 1, MAX_ASSET_CHUNKS, 'Asset chunk count');
      if (message.chunkCount !== chunks) fail('INVALID_MESSAGE', 'Asset chunk count does not match byteLength.');
      assertHash(message.sha256);
      return { ...message, fontMetadata };
      break;
    }
    case 'ASSET_CHUNK':
      assertFlow(message.flow);
      assertAssetKind(message.assetKind);
      assertId(message.transferId, 'Transfer ID');
      assertFiniteInteger(message.index, 0, MAX_ASSET_CHUNKS - 1, 'Asset chunk index');
      if (!(message.bytes instanceof Uint8Array) || message.bytes.byteLength < 1 || message.bytes.byteLength > MAX_ASSET_CHUNK_BYTES) {
        fail('INVALID_CHUNK', `Asset chunks must contain between 1 and ${MAX_ASSET_CHUNK_BYTES} bytes.`);
      }
      return { ...message, bytes: message.bytes.slice() };
    case 'ASSET_END':
      assertFlow(message.flow);
      assertId(message.transferId, 'Transfer ID');
      assertId(message.assetId, 'Asset ID');
      assertAssetKind(message.assetKind);
      assertFiniteInteger(message.byteLength, 1, MAX_ASSET_BYTES, 'Asset byte length');
      assertHash(message.sha256);
      break;
    default:
      fail('UNKNOWN_KIND', `Unknown collaboration message kind: ${String(message.kind)}.`);
  }
  return { ...message };
}

/**
 * Validate a collaboration message and return a defensive, bounded copy.
 * This checks wire shape only; it does not apply or authorize an edit.
 */
export function validateCollaborationMessage(message, { direction = 'any', context } = {}) {
  assertPlainDataRecord(message, 'Collaboration message');
  if (typeof message.kind !== 'string' || !MESSAGE_KINDS.has(message.kind)) {
    fail('UNKNOWN_KIND', `Unknown collaboration message kind: ${String(message.kind)}.`);
  }
  validateDirection(message.kind, direction, message);
  const validated = validateMessageFields(message);
  assertExpectedContext(validated, context);
  const bytes = UTF8.encode(JSON.stringify(validated)).byteLength;
  if (bytes > MAX_CONTROL_MESSAGE_BYTES) fail('LIMIT_EXCEEDED', 'Collaboration message exceeds the control-message size limit.');
  return validated;
}

function validateChunkMessage(message) {
  return validateCollaborationMessage(message);
}

function encodeChunkFrame(message) {
  const chunk = validateChunkMessage(message);
  const header = {
    v: chunk.v,
    kind: chunk.kind,
    designId: chunk.designId,
    sessionId: chunk.sessionId,
    actorId: chunk.actorId,
    flow: chunk.flow,
    transferId: chunk.transferId,
    assetKind: chunk.assetKind,
    index: chunk.index
  };
  const headerBytes = UTF8.encode(JSON.stringify(header));
  if (headerBytes.byteLength > 2048) fail('LIMIT_EXCEEDED', 'Asset chunk header exceeds its size limit.');
  const frame = new Uint8Array(7 + headerBytes.byteLength + chunk.bytes.byteLength);
  frame.set([0x54, 0x49, 0x53, 0x43], 0); // TISC
  frame[4] = PROTOCOL_VERSION;
  new DataView(frame.buffer).setUint16(5, headerBytes.byteLength, false);
  frame.set(headerBytes, 7);
  frame.set(chunk.bytes, 7 + headerBytes.byteLength);
  return frame;
}

function asBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  fail('INVALID_CHUNK', 'Binary collaboration data must be an ArrayBuffer or Uint8Array.');
}

function decodeChunkFrame(data, { direction = 'any', context } = {}) {
  const frame = asBytes(data);
  if (frame.byteLength > MAX_ASSET_CHUNK_BYTES + 2055 || frame.byteLength < 8) fail('INVALID_CHUNK', 'Asset chunk frame has an invalid size.');
  if (frame[0] !== 0x54 || frame[1] !== 0x49 || frame[2] !== 0x53 || frame[3] !== 0x43) fail('INVALID_CHUNK', 'Asset chunk frame magic is invalid.');
  if (frame[4] !== PROTOCOL_VERSION) fail('UNSUPPORTED_VERSION', `Unsupported binary collaboration version: ${frame[4]}.`);
  const headerLength = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint16(5, false);
  if (headerLength < 2 || headerLength > 2048 || 7 + headerLength >= frame.byteLength) fail('INVALID_CHUNK', 'Asset chunk frame header is invalid.');
  let header;
  try {
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame.subarray(7, 7 + headerLength)));
  } catch {
    fail('INVALID_CHUNK', 'Asset chunk frame header is malformed.');
  }
  exactKeys(header, ['v', 'kind', 'designId', 'sessionId', 'actorId', 'flow', 'transferId', 'assetKind', 'index'], 'Asset chunk header');
  const bytes = frame.slice(7 + headerLength);
  const message = validateCollaborationMessage({ ...header, bytes }, { direction, context });
  return message;
}

/** Encode a validated message as JSON text or a compact binary asset-chunk frame. */
export function encodeCollaborationMessage(message, { direction = 'any', context } = {}) {
  const validated = validateCollaborationMessage(message, { direction, context });
  if (validated.kind === 'ASSET_CHUNK') return encodeChunkFrame(validated);
  const encoded = JSON.stringify(validated);
  if (UTF8.encode(encoded).byteLength > MAX_CONTROL_MESSAGE_BYTES) fail('LIMIT_EXCEEDED', 'Collaboration message exceeds the control-message size limit.');
  return encoded;
}

/** Decode a text control message or binary ASSET_CHUNK frame. */
export function decodeCollaborationMessage(data, { direction = 'any', context } = {}) {
  if (typeof data !== 'string') return decodeChunkFrame(data, { direction, context });
  if (UTF8.encode(data).byteLength > MAX_CONTROL_MESSAGE_BYTES) fail('LIMIT_EXCEEDED', 'Collaboration message exceeds the control-message size limit.');
  let parsed;
  try { parsed = JSON.parse(data); } catch { fail('INVALID_MESSAGE', 'Collaboration message is not valid JSON.'); }
  return validateCollaborationMessage(parsed, { direction, context });
}

/*
 * Integration boundary: this module validates bytes and shapes only. The host
 * must independently authorize and apply an operation, persist the accepted
 * mutation before sending ACK, and send REJECT when it cannot commit. Guests
 * must save a local fork after a reject or disconnect; the wire contract never
 * merges a fork back into the host design.
 */
