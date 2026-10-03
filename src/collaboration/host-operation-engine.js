import {
  addNode,
  findNode,
  findNodeAcrossPages,
  moveNode,
  parseDocument,
  removeNode,
  updateNode,
  validateDocument
} from '../model.js';
import { COLLABORATION_PROTOCOL_VERSION, validateCollaborationMessage } from './protocol.js';
import { isCollaborationSetPropertyRoot } from './set-property-roots.js';

const PROTOCOL_VERSION = COLLABORATION_PROTOCOL_VERSION;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_ACCEPTED_OPERATION_COUNT = 352;
const MAX_ACCEPTED_OPERATION_BYTES = 32 * 1024;
const REPLAY_ENTRY_OVERHEAD_BYTES = 512;
const UTF8 = new TextEncoder();
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function clone(value) {
  return structuredClone(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError(`${label} is invalid.`);
}

function validAssetRecord(asset) {
  return isPlainObject(asset)
    && typeof asset.assetId === 'string' && ID_PATTERN.test(asset.assetId)
    && typeof asset.mimeType === 'string' && MIME_PATTERN.test(asset.mimeType)
    && Number.isSafeInteger(asset.byteLength) && asset.byteLength >= 1 && asset.byteLength <= MAX_ASSET_BYTES
    && typeof asset.sha256 === 'string' && HASH_PATTERN.test(asset.sha256);
}

function assetManifest(document) {
  if (document.collaborationAssets == null) return [];
  if (!Array.isArray(document.collaborationAssets)
    || document.collaborationAssets.length > 100_000
    || document.collaborationAssets.some(asset => !validAssetRecord(asset))
    || new Set(document.collaborationAssets.map(asset => asset.assetId)).size !== document.collaborationAssets.length) {
    throw new TypeError('The collaboration asset manifest is invalid.');
  }
  return document.collaborationAssets;
}

function sameAssetManifest(left, right) {
  const stable = manifest => assetManifest(manifest)
    .map(({ assetId, mimeType, byteLength, sha256 }) => ({ assetId, mimeType, byteLength, sha256 }))
    .sort((a, b) => a.assetId.localeCompare(b.assetId));
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function operationPropertyIsAllowed(path) {
  if (isCollaborationSetPropertyRoot(path)) return true;
  // A few properties are frequently edited as individual nested values. The
  // rest of each object remains replaceable only through its whitelisted root.
  const safeSegment = '[A-Za-z][A-Za-z0-9_-]*';
  const safeIndex = '(?:0|[1-9][0-9]{0,5})';
  return new RegExp(`^(?:autoLayout|constraints|cornerRadii|adjustments|transforms|imageFill|gridCell)\\.${safeSegment}(?:\\.${safeSegment}){0,3}$`).test(path)
    || new RegExp(`^vertexRadii\\.${safeIndex}$`).test(path)
    || new RegExp(`^(?:fills|strokes)\\.${safeIndex}\\.${safeSegment}(?:\\.${safeSegment}){0,2}$`).test(path);
}

function assignAllowedProperty(node, property, value) {
  if (!operationPropertyIsAllowed(property)) throw operationError('UNSUPPORTED_OPERATION', `Property ${property} is not allowed for remote edits.`);
  const segments = property.split('.');
  if (segments.some(segment => RESERVED.has(segment))) throw operationError('INVALID_OPERATION', 'Property path contains a reserved key.');
  if (segments.length === 1) {
    if (property === 'fontAxes' && value === null) {
      delete node.fontAxes;
      return;
    }
    if (property === 'fontFeatures' && value === null) {
      delete node.fontFeatures;
      return;
    }
    node[property] = clone(value);
    return;
  }
  let target = node;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(target)) {
      if (!/^(?:0|[1-9][0-9]{0,5})$/.test(segment)) throw operationError('INVALID_OPERATION', 'Property path contains an invalid array index.');
      target = target[Number(segment)];
    } else if (isPlainObject(target) && Object.hasOwn(target, segment)) {
      target = target[segment];
    } else {
      throw operationError('INVALID_OPERATION', 'Property path does not target an existing value.');
    }
    if (!target || typeof target !== 'object') throw operationError('INVALID_OPERATION', 'Property path does not target an object.');
  }
  const last = segments.at(-1);
  if (Array.isArray(target)) {
    if (!/^(?:0|[1-9][0-9]{0,5})$/.test(last) || Number(last) >= target.length) throw operationError('INVALID_OPERATION', 'Property path does not target an existing array item.');
    target[Number(last)] = clone(value);
  } else if (isPlainObject(target) && Object.hasOwn(target, last)) {
    target[last] = clone(value);
  } else {
    throw operationError('INVALID_OPERATION', 'Property path does not target an existing property.');
  }
}

function operationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hasAssetReference(document, assetId) {
  const pending = [document.pages];
  const seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (key === 'assetId' && child === assetId) return true;
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return false;
}

function siblingsFor(document, pageId, parentId) {
  const page = document.pages.find(candidate => candidate.id === pageId);
  if (!page) throw operationError('INVALID_OPERATION', 'The target page does not exist.');
  if (parentId == null) return page.children;
  const parent = findNode(document, parentId, pageId)?.node;
  if (!parent) throw operationError('INVALID_OPERATION', 'The target parent layer does not exist on that page.');
  if (!Array.isArray(parent.children)) throw operationError('INVALID_OPERATION', 'The target parent cannot contain layers.');
  return parent.children;
}

function applyOperation(document, operation) {
  switch (operation.type) {
    case 'ReplaceSnapshot': {
      let replacement;
      try { replacement = parseDocument(operation.snapshot); }
      catch { throw operationError('INVALID_OPERATION', 'The replacement design snapshot is invalid.'); }
      if (replacement.id !== document.id) throw operationError('PERMISSION_DENIED', 'A collaboration edit cannot replace the design identity.');
      // Asset bytes are transferred and verified independently from document
      // operations. A broad snapshot must not forge, discard, or rewrite the
      // host's asset manifest; those changes go through AddAsset/RemoveAsset.
      try {
        if (!sameAssetManifest(document, replacement)) {
          throw operationError('UNSUPPORTED_OPERATION', 'Asset manifest changes must use the verified asset operations.');
        }
      } catch (error) {
        if (error?.code) throw error;
        throw operationError('INVALID_OPERATION', 'The replacement design has an invalid asset manifest.');
      }
      // This is local provenance for a design that was itself started from a
      // recovered guest fork. It is not an editable shared setting and the
      // guest-side proposal intentionally omits it.
      if (document.settings?.collaborationSource && replacement.settings) {
        replacement.settings.collaborationSource = clone(document.settings.collaborationSource);
      }
      // The owner controls the shared view. A guest may edit the document, but
      // its snapshot cannot move the master's canonical active page.
      if (replacement.pages.some(page => page.id === document.activePageId)) {
        replacement.activePageId = document.activePageId;
      }
      return replacement;
    }
    case 'SetProperty': {
      const entry = findNode(document, operation.targetId, operation.pageId);
      if (!entry) throw operationError('INVALID_OPERATION', 'The target layer does not exist on that page.');
      assignAllowedProperty(entry.node, operation.property, operation.value);
      break;
    }
    case 'InsertNode': {
      if (!document.pages.some(page => page.id === operation.pageId)) throw operationError('INVALID_OPERATION', 'The target page does not exist.');
      if (findNodeAcrossPages(document, operation.nodeId)) throw operationError('CONFLICT', 'The inserted layer ID already exists.');
      const siblings = siblingsFor(document, operation.pageId, operation.parentId);
      if (operation.index > siblings.length) throw operationError('INVALID_OPERATION', 'The insertion index is outside the target layer list.');
      addNode(document, clone(operation.node), {
        pageId: operation.pageId,
        parentId: operation.parentId,
        index: operation.index
      });
      break;
    }
    case 'DeleteNode':
      if (!removeNode(document, operation.nodeId, operation.pageId)) throw operationError('INVALID_OPERATION', 'The target layer does not exist on that page.');
      break;
    case 'MoveNode': {
      const source = findNode(document, operation.nodeId, operation.pageId);
      if (!source) throw operationError('INVALID_OPERATION', 'The layer to move does not exist on that page.');
      const targetSiblings = siblingsFor(document, operation.pageId, operation.parentId);
      const sameList = source.parent
        ? source.parent.id === operation.parentId
        : operation.parentId == null;
      const maxIndex = sameList ? Math.max(0, targetSiblings.length - 1) : targetSiblings.length;
      if (operation.index > maxIndex) throw operationError('INVALID_OPERATION', 'The move index is outside the target layer list.');
      if (!moveNode(document, operation.nodeId, {
        pageId: operation.pageId,
        parentId: operation.parentId,
        index: operation.index
      })) throw operationError('INVALID_OPERATION', 'The layer could not be moved.');
      break;
    }
    case 'ReplaceText': {
      const entry = findNode(document, operation.nodeId, operation.pageId);
      if (!entry || entry.node.type !== 'text') throw operationError('INVALID_OPERATION', 'The target text layer does not exist on that page.');
      const patch = { text: operation.text };
      if (Array.isArray(entry.node.paragraphStyles)) {
        const paragraphs = operation.text.split(/\r\n|\r|\n/u);
        patch.paragraphStyles = paragraphs.map((_, index) => clone(entry.node.paragraphStyles[index] || {}));
      }
      updateNode(document, operation.nodeId, patch, operation.pageId);
      delete entry.node.textRuns;
      break;
    }
    case 'AddAsset': {
      if (!Array.isArray(document.collaborationAssets)) document.collaborationAssets = [];
      const existing = document.collaborationAssets.find(asset => asset.assetId === operation.assetId);
      if (existing) throw operationError('CONFLICT', 'The asset is already present in the design manifest.');
      document.collaborationAssets.push({
        assetId: operation.assetId,
        mimeType: operation.mimeType,
        byteLength: operation.byteLength,
        sha256: operation.sha256
      });
      break;
    }
    case 'RemoveAsset': {
      const manifest = assetManifest(document);
      const index = manifest.findIndex(asset => asset.assetId === operation.assetId);
      if (index < 0) throw operationError('ASSET_MISSING', 'The asset is not present in the design manifest.');
      if (hasAssetReference(document, operation.assetId)) throw operationError('CONFLICT', 'The asset is still referenced by a layer.');
      document.collaborationAssets = manifest.filter((_, assetIndex) => assetIndex !== index);
      // Asset bytes are owned by the local asset store and are never deleted by
      // this manifest-only collaboration operation.
      break;
    }
    default:
      throw operationError('UNSUPPORTED_OPERATION', 'The operation type is unsupported.');
  }
  return document;
}

/** Apply one validated typed edit with the exact reducer used by the host. */
export function applyHostTypedOperation(document, operation) {
  if (!document || operation?.type === 'ReplaceSnapshot') {
    throw operationError('UNSUPPORTED_OPERATION', 'A typed collaboration operation is required.');
  }
  const message = validateCollaborationMessage({
    v: PROTOCOL_VERSION,
    kind: 'OPERATION',
    designId: document.id,
    sessionId: 'local-reducer',
    actorId: 'local-reducer',
    operation
  }, { direction: 'guest-to-host' });
  const candidate = clone(document);
  applyOperation(candidate, message.operation);
  validateDocument(candidate);
  return candidate;
}

function resultCopy(result) {
  return { ...result };
}

function operationFingerprint(operation) {
  const input = UTF8.encode(JSON.stringify(operation));
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLength = input.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const words = new Uint32Array(64);
  const rotateRight = (value, amount) => (value >>> amount) | (value << (32 - amount));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return [...hash].map(word => word.toString(16).padStart(8, '0')).join('');
}

function replayEntryByteCost(acceptedKey, hostActorId, designId, sessionId, opId) {
  // Charge two bytes per retained character plus a conservative fixed object
  // allowance. The cache stores only this key, a fixed-size SHA-256 digest,
  // and the small ACK record; operation payloads are never retained.
  const retainedCharacters = acceptedKey.length + 64
    + 'ACK'.length + designId.length + sessionId.length + hostActorId.length + opId.length;
  return retainedCharacters * 2 + REPLAY_ENTRY_OVERHEAD_BYTES;
}

/**
 * Create an ordered, host-authoritative mutation boundary for one active
 * collaboration session. `commit` must durably persist its candidate before
 * it resolves; the engine advances its in-memory head only after that resolve.
 *
 * Asset bytes must already have been received and verified by the caller
 * before it submits AddAsset. The operation only changes document metadata.
 */
export function createHostOperationEngine({
  designId,
  sessionId,
  hostActorId,
  guestActorIds,
  snapshot,
  revision,
  headHash = '0'.repeat(64),
  commit,
  onCommitted = () => {}
}) {
  assertId(designId, 'Design ID');
  assertId(sessionId, 'Session ID');
  assertId(hostActorId, 'Host actor ID');
  if (!Array.isArray(guestActorIds) || !guestActorIds.length || guestActorIds.some(id => typeof id !== 'string' || !ID_PATTERN.test(id))) {
    throw new TypeError('At least one valid guest actor ID is required.');
  }
  if (new Set(guestActorIds).size !== guestActorIds.length) throw new TypeError('Guest actor IDs must be unique.');
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('The starting revision must be a non-negative safe integer.');
  if (typeof headHash !== 'string' || !HASH_PATTERN.test(headHash)) throw new TypeError('The starting commit hash must be a SHA-256 digest.');
  if (typeof commit !== 'function') throw new TypeError('A durable commit callback is required.');

  let document = parseDocument(snapshot);
  validateDocument(document);
  if (document.id !== designId) throw new TypeError('The snapshot design ID does not match the collaboration session.');
  assetManifest(document);
  let currentRevision = revision;
  let currentHeadHash = headHash;
  const guestSessions = new Map(guestActorIds.map(actorId => [actorId, sessionId]));
  const accepted = new Map();
  let acceptedBytes = 0;
  let queue = Promise.resolve();

  const responseSessionId = message => (
    typeof message?.sessionId === 'string' && guestSessions.get(message?.actorId) === message.sessionId
      ? message.sessionId
      : sessionId
  );

  const makeReject = (message, code) => ({
    v: PROTOCOL_VERSION,
    kind: 'REJECT',
    designId,
    sessionId: responseSessionId(message),
    actorId: hostActorId,
    opId: typeof message?.operation?.opId === 'string' && ID_PATTERN.test(message.operation.opId)
      ? message.operation.opId
      : 'invalid-operation',
    revision: currentRevision,
    headHash: currentHeadHash,
    code
  });

  async function applyNow(rawMessage) {
    let message;
    try {
      message = validateCollaborationMessage(rawMessage, { direction: 'guest-to-host' });
    } catch {
      return makeReject(rawMessage, 'INVALID_OPERATION');
    }
    if (message.kind !== 'OPERATION') return makeReject(message, 'INVALID_OPERATION');
    if (message.designId !== designId || guestSessions.get(message.actorId) !== message.sessionId) {
      return makeReject(message, 'PERMISSION_DENIED');
    }
    const operation = message.operation;
    const acceptedKey = `${message.actorId}\u0000${operation.opId}`;
    const previous = accepted.get(acceptedKey);
    if (previous) {
      let fingerprint;
      try { fingerprint = operationFingerprint(operation); }
      catch { return makeReject(message, 'LIMIT_EXCEEDED'); }
      if (previous.fingerprint !== fingerprint) return makeReject(message, 'CONFLICT');
      return resultCopy(previous.result);
    }
    if (operation.baseRevision !== currentRevision) return makeReject(message, 'STALE_REVISION');
    if (currentRevision >= Number.MAX_SAFE_INTEGER) return makeReject(message, 'LIMIT_EXCEEDED');
    const entryBytes = replayEntryByteCost(acceptedKey, hostActorId, designId, sessionId, operation.opId);
    if (accepted.size >= MAX_ACCEPTED_OPERATION_COUNT || acceptedBytes + entryBytes > MAX_ACCEPTED_OPERATION_BYTES) {
      return makeReject(message, 'LIMIT_EXCEEDED');
    }
    let fingerprint;
    try { fingerprint = operationFingerprint(operation); }
    catch { return makeReject(message, 'LIMIT_EXCEEDED'); }

    let candidate;
    try {
      candidate = applyOperation(clone(document), operation);
      validateDocument(candidate);
      assetManifest(candidate);
    } catch (error) {
      const code = ['CONFLICT', 'ASSET_MISSING', 'PERMISSION_DENIED', 'UNSUPPORTED_OPERATION', 'LIMIT_EXCEEDED'].includes(error?.code)
        ? error.code
        : 'INVALID_OPERATION';
      return makeReject(message, code);
    }

    const nextRevision = currentRevision + 1;
    let durableResult;
    try {
      durableResult = await commit({
        designId,
        sessionId: message.sessionId,
        actorId: message.actorId,
        hostActorId,
        opId: operation.opId,
        expectedRevision: currentRevision,
        revision: nextRevision,
        operation: clone(operation),
        snapshot: clone(candidate)
      });
    } catch {
      return makeReject(message, 'CONFLICT');
    }
    const committedHash = durableResult?.head?.commitHash ?? durableResult?.headHash;
    if (typeof committedHash !== 'string' || !HASH_PATTERN.test(committedHash)) {
      return makeReject(message, 'CONFLICT');
    }

    // The state/head transition happens strictly after durable persistence.
    document = candidate;
    currentRevision = nextRevision;
    currentHeadHash = committedHash;
    const result = {
      v: PROTOCOL_VERSION,
      kind: 'ACK',
      designId,
      sessionId: message.sessionId,
      actorId: hostActorId,
      opId: operation.opId,
      revision: nextRevision,
      headHash: currentHeadHash
    };
    try {
      onCommitted({
        designId, sessionId: message.sessionId, actorId: message.actorId, opId: operation.opId,
        revision: nextRevision, headHash: currentHeadHash, snapshot: clone(document), operation: clone(operation)
      });
    } catch { /* A durable commit and its ACK must not be undone by a presence/fan-out observer. */ }
    accepted.set(acceptedKey, { fingerprint, result });
    acceptedBytes += entryBytes;
    return resultCopy(result);
  }

  return Object.freeze({
    getRevision: () => currentRevision,
    getHeadHash: () => currentHeadHash,
    getSnapshot: () => clone(document),
    hasPageId: pageId => typeof pageId === 'string' && document.pages.some(page => page.id === pageId),
    setActivePageId: pageId => {
      if (typeof pageId !== 'string' || !document.pages.some(page => page.id === pageId)) return false;
      document.activePageId = pageId;
      return true;
    },
    getReplayCacheStats: () => Object.freeze({
      entryCount: accepted.size,
      accountedBytes: acceptedBytes,
      maxEntries: MAX_ACCEPTED_OPERATION_COUNT,
      maxBytes: MAX_ACCEPTED_OPERATION_BYTES
    }),
    registerGuestSession(actorId, guestSessionId) {
      assertId(actorId, 'Guest actor ID');
      assertId(guestSessionId, 'Guest session ID');
      if (guestSessions.has(actorId)) throw new TypeError('The guest actor is already registered.');
      guestSessions.set(actorId, guestSessionId);
      return true;
    },
    removeGuestSession(actorId, guestSessionId) {
      if (guestSessions.get(actorId) !== guestSessionId) return false;
      return guestSessions.delete(actorId);
    },
    getGuestSessionCount: () => guestSessions.size,
    apply(rawMessage) {
      const result = queue.then(() => applyNow(rawMessage));
      queue = result.then(() => undefined, () => undefined);
      return result;
    }
  });
}
