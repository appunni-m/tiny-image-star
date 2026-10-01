import { validateCollaborationMessage } from './protocol.js';

const DEFAULT_MAX_PENDING_OPERATIONS = 256;
const DEFAULT_MAX_PENDING_BYTES = 2 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 768 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const encoder = new TextEncoder();

export class GuestForkRecoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GuestForkRecoveryError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new GuestForkRecoveryError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeJsonCopy(value, label, budget = { nodes: 0 }, depth = 0) {
  budget.nodes += 1;
  if (budget.nodes > 20_000 || depth > 24) fail('INVALID_DATA', `${label} is too complex.`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (encoder.encode(value).byteLength > 256 * 1024) fail('INVALID_DATA', `${label} contains an oversized string.`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_DATA', `${label} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 10_000) fail('INVALID_DATA', `${label} contains an unsupported array.`);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) fail('INVALID_DATA', `${label} contains a sparse or decorated array.`);
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('INVALID_DATA', `${label} contains an accessor.`);
      result.push(safeJsonCopy(descriptor.value, label, budget, depth + 1));
    }
    return result;
  }
  if (!isPlainObject(value)) fail('INVALID_DATA', `${label} must contain plain JSON data.`);
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || RESERVED_KEYS.has(key)) fail('INVALID_DATA', `${label} contains a reserved key.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('INVALID_DATA', `${label} contains an accessor.`);
    result[key] = safeJsonCopy(descriptor.value, label, budget, depth + 1);
  }
  return result;
}

function assertId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail('INVALID_ID', `${label} is invalid.`);
}

function assertRevision(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_REVISION', `${label} must be a non-negative safe integer.`);
}

function copySnapshot(snapshot, revision, headHash, designId, sessionId) {
  const validated = validateCollaborationMessage({
    v: 1, kind: 'SNAPSHOT', designId, sessionId, actorId: 'host', revision, headHash, snapshot
  }, { direction: 'host-to-guest' });
  return validated.snapshot;
}

function validateOperation(operation, designId, sessionId) {
  const validated = validateCollaborationMessage({
    v: 1, kind: 'OPERATION', designId, sessionId, actorId: 'guest', operation
  }, { direction: 'guest-to-host' });
  return validated.operation;
}

function encodeBytes(value) {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function makeForkId() {
  if (globalThis.crypto?.randomUUID) return `fork-${globalThis.crypto.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `fork-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Keep guest edits safe when a host session rejects a change or disconnects.
 * This is deliberately a state machine, not a merge engine: fork contents remain
 * local until a person explicitly chooses how to reuse them.
 */
export function createGuestForkRecovery({
  designId,
  sessionId,
  hostHead,
  hostRevision,
  initialReplicaSnapshot,
  persistFork,
  closeSession,
  maxPendingOperations = DEFAULT_MAX_PENDING_OPERATIONS,
  maxPendingBytes = DEFAULT_MAX_PENDING_BYTES
}) {
  assertId(designId, 'Design ID');
  assertId(sessionId, 'Session ID');
  assertRevision(hostRevision, 'Host revision');
  if (!hostHead || hostHead.sequence !== hostRevision || typeof hostHead.commitHash !== 'string' || !/^[a-f0-9]{64}$/u.test(hostHead.commitHash)) {
    fail('INVALID_HEAD', 'The fork base must identify an exact verified host commit.');
  }
  if (typeof persistFork !== 'function' || typeof closeSession !== 'function') {
    throw new TypeError('persistFork and closeSession callbacks are required.');
  }
  if (!Number.isSafeInteger(maxPendingOperations) || maxPendingOperations < 1 || maxPendingOperations > 4096) {
    throw new RangeError('maxPendingOperations must be between 1 and 4096.');
  }
  if (!Number.isSafeInteger(maxPendingBytes) || maxPendingBytes < 1 || maxPendingBytes > 64 * 1024 * 1024) {
    throw new RangeError('maxPendingBytes must be between 1 byte and 64 MiB.');
  }

  const initialSnapshot = copySnapshot(initialReplicaSnapshot, hostRevision, hostHead.commitHash, designId, sessionId);
  let acknowledgedSnapshot = safeJsonCopy(initialSnapshot, 'Initial replica snapshot');
  let acknowledgedRevision = hostRevision;
  let acknowledgedHead = safeJsonCopy(hostHead, 'Host head');
  let pending = [];
  let pendingBytes = 0;
  let status = 'connected';
  let freezeReason = null;
  let forkId = null;
  let forkPayload = null;
  let closePromise = null;
  let savePromise = null;
  let saveError = null;
  let saveAttempts = 0;

  const copyForkPayload = () => safeJsonCopy(forkPayload, 'Fork payload');

  function freeze(reason) {
    if (status !== 'connected') return savePromise ?? Promise.resolve(state());
    status = 'saving-fork';
    freezeReason = safeJsonCopy(reason, 'Freeze reason');
    forkId = makeForkId();
    forkPayload = {
      forkId,
      designId: `fork-${forkId.slice(5)}`,
      source: {
        designId,
        sessionId,
        hostHead: safeJsonCopy(acknowledgedHead, 'Acknowledged host head'),
        hostRevision: acknowledgedRevision
      },
      snapshot: safeJsonCopy(acknowledgedSnapshot, 'Acknowledged replica snapshot'),
      pendingOperations: pending.map(entry => safeJsonCopy(entry.operation, 'Pending operation')),
      pendingOperationIds: pending.map(entry => entry.operation.opId),
      reason: safeJsonCopy(freezeReason, 'Freeze reason'),
      createdAt: new Date().toISOString()
    };
    // Freeze proposals synchronously, then close the previous session exactly once.
    try {
      closePromise = Promise.resolve(closeSession({ designId, sessionId, reason: safeJsonCopy(freezeReason, 'Freeze reason') }))
        .catch(error => { closeError = error instanceof Error ? error.message : String(error); });
    } catch (error) {
      closeError = error instanceof Error ? error.message : String(error);
      closePromise = Promise.resolve();
    }
    return persist();
  }

  let closeError = null;

  function persist() {
    if (status === 'fork-saved') return Promise.resolve(state());
    if (savePromise) return savePromise;
    status = 'saving-fork';
    saveError = null;
    saveAttempts += 1;
    const thisAttempt = (async () => {
      await closePromise;
      try {
        const outcome = await persistFork(copyForkPayload());
        if (outcome === false) throw new Error('Fork persistence did not confirm a saved result.');
        status = 'fork-saved';
        saveError = null;
      } catch (error) {
        status = 'fork-unsaved';
        saveError = error instanceof Error ? error.message : String(error);
      }
      savePromise = null;
      return state();
    })();
    savePromise = thisAttempt;
    return thisAttempt;
  }

  function state() {
    return {
      status,
      canPropose: status === 'connected',
      saved: status === 'fork-saved',
      blocked: status === 'fork-unsaved',
      designId,
      sessionId,
      hostHead: safeJsonCopy(acknowledgedHead, 'Acknowledged host head'),
      acknowledgedRevision,
      acknowledgedSnapshot: safeJsonCopy(acknowledgedSnapshot, 'Acknowledged replica snapshot'),
      pendingOperations: pending.map(entry => safeJsonCopy(entry.operation, 'Pending operation')),
      pendingBytes,
      freezeReason: freezeReason == null ? null : safeJsonCopy(freezeReason, 'Freeze reason'),
      forkId,
      saveError,
      closeError,
      saveAttempts
    };
  }

  function propose(operation) {
    if (status !== 'connected') fail('SESSION_FROZEN', 'The old session is frozen; save or inspect the local fork.');
    const copied = validateOperation(operation, designId, sessionId);
    if (pending.some(entry => entry.operation.opId === copied.opId)) fail('DUPLICATE_OPERATION', 'This operation ID is already pending.');
    const expectedBaseRevision = acknowledgedRevision + pending.length;
    if (copied.baseRevision !== expectedBaseRevision) fail('STALE_BASE_REVISION', `Operation base revision must be ${expectedBaseRevision}.`);
    const bytes = encodeBytes(copied);
    if (pending.length + 1 > maxPendingOperations || pendingBytes + bytes > maxPendingBytes) {
      fail('PENDING_LIMIT', 'Pending guest edits reached their safe in-memory limit; stop editing and save a local copy.');
    }
    pending.push({ operation: copied, bytes });
    pendingBytes += bytes;
    return safeJsonCopy(copied, 'Proposed operation');
  }

  function acknowledge(message, operationResult) {
    if (status !== 'connected') return { accepted: false, reason: 'SESSION_FROZEN', state: state() };
    const ack = validateCollaborationMessage(message, { direction: 'host-to-guest' });
    if (ack.kind !== 'ACK' || ack.designId !== designId || ack.sessionId !== sessionId) {
      fail('INVALID_ACK', 'ACK does not belong to this guest session.');
    }
    const first = pending[0];
    if (!first || first.operation.opId !== ack.opId) fail('ACK_ORDER', 'ACK must acknowledge the oldest pending operation.');
    if (!operationResult || typeof operationResult !== 'object') {
      return { accepted: false, reason: 'RESULT_REQUIRED', state: state() };
    }
    const suppliedSnapshot = Object.hasOwn(operationResult, 'snapshot')
      ? operationResult.snapshot
      : operationResult.result?.snapshot;
    if (suppliedSnapshot === undefined) return { accepted: false, reason: 'RESULT_REQUIRED', state: state() };
    const suppliedRevision = operationResult.revision ?? operationResult.result?.revision ?? ack.revision;
    if (suppliedRevision !== ack.revision || ack.revision !== acknowledgedRevision + 1) {
      fail('ACK_REVISION', 'ACK revision must advance the verified replica by exactly one.');
    }
    const nextSnapshot = copySnapshot(suppliedSnapshot, ack.revision, ack.headHash, designId, sessionId);
    const nextHead = operationResult.head ?? operationResult.result?.head;
    // All validation occurs before mutating the confirmed state or dropping work.
    if (nextHead !== undefined) {
      safeJsonCopy(nextHead, 'Acknowledged host head');
      if (nextHead.sequence !== ack.revision || nextHead.commitHash !== ack.headHash) {
        fail('ACK_HEAD', 'ACK commit hash does not match its acknowledged host head.');
      }
    }
    pending.shift();
    pendingBytes -= first.bytes;
    acknowledgedSnapshot = nextSnapshot;
    acknowledgedRevision = ack.revision;
    if (nextHead !== undefined) acknowledgedHead = safeJsonCopy(nextHead, 'Acknowledged host head');
    return { accepted: true, state: state() };
  }

  function reject(message) {
    const rejection = validateCollaborationMessage(message, { direction: 'host-to-guest' });
    if (rejection.kind !== 'REJECT' || rejection.designId !== designId || rejection.sessionId !== sessionId) {
      fail('INVALID_REJECT', 'REJECT does not belong to this guest session.');
    }
    return freeze({
      type: 'reject', code: rejection.code, opId: rejection.opId, revision: rejection.revision,
      observedHostHead: { sequence: rejection.revision, commitHash: rejection.headHash }
    });
  }

  function disconnect(reason = 'transport-disconnected') {
    const copiedReason = typeof reason === 'string'
      ? { type: 'disconnect', reason: reason.slice(0, 256) }
      : { type: 'disconnect', detail: safeJsonCopy(reason, 'Disconnect reason') };
    return freeze(copiedReason);
  }

  function retrySave() {
    if (status !== 'fork-unsaved') fail('RETRY_UNAVAILABLE', 'A fork can only be retried after a save failure.');
    return persist();
  }

  return Object.freeze({
    get state() { return state(); },
    propose,
    acknowledge,
    reject,
    disconnect,
    retrySave
  });
}
