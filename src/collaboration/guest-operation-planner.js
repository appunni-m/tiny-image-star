import {
  findNode,
  parseDocument,
  validateDocument
} from '../model.js';
import { applyHostTypedOperation } from './host-operation-engine.js';
import { COLLABORATION_PROTOCOL_VERSION, validateCollaborationMessage } from './protocol.js';
import { isCollaborationSetPropertyRoot } from './set-property-roots.js';

const MAX_PLANNED_OPERATIONS = 128;

function clone(value) {
  return structuredClone(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function equal(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function visitTree(document, callback) {
  for (const page of document.pages) {
    const visit = (nodes, parentId = null) => {
      nodes.forEach((node, index) => {
        callback({ node, pageId: page.id, parentId, index });
        visit(node.children || [], node.id);
      });
    };
    visit(page.children);
  }
}

function indexTree(document) {
  const entries = new Map();
  const siblings = new Map();
  visitTree(document, entry => {
    if (entries.has(entry.node.id)) throw new TypeError('Layer IDs must be unique across the design.');
    entries.set(entry.node.id, entry);
    const key = `${entry.pageId}\u0000${entry.parentId ?? ''}`;
    if (!siblings.has(key)) siblings.set(key, []);
    siblings.get(key).push(entry.node.id);
  });
  return { entries, siblings };
}

function listFor(document, pageId, parentId) {
  if (parentId == null) return document.pages.find(page => page.id === pageId)?.children;
  return findNode(document, parentId, pageId)?.node.children;
}

function stripPageChildren(document) {
  return {
    ...document,
    pages: document.pages.map(page => ({ ...page, children: [] }))
  };
}

function emitOperation(entries, operation, document) {
  if (entries.length >= MAX_PLANNED_OPERATIONS) throw new Error('Operation plan exceeds the bounded edit size.');
  const index = entries.length + 1;
  const withProtocolFields = {
    ...operation,
    opId: `plan-op-${index}`,
    baseRevision: index - 1
  };
  const candidate = applyHostTypedOperation(document, withProtocolFields);
  validateCollaborationMessage({
    v: COLLABORATION_PROTOCOL_VERSION,
    kind: 'SNAPSHOT',
    designId: candidate.id,
    sessionId: 'local-reducer',
    actorId: 'local-reducer',
    revision: index,
    headHash: '0'.repeat(64),
    snapshot: candidate
  }, { direction: 'host-to-guest' });
  for (const key of Object.keys(document)) delete document[key];
  Object.assign(document, candidate);
  entries.push({ operation: withProtocolFields, snapshot: clone(document) });
}

function structuralDistance(current, target) {
  const left = indexTree(current).entries;
  const right = indexTree(target).entries;
  let parentChanges = 0;
  let indexDistance = 0;
  for (const [id, wanted] of right) {
    const actual = left.get(id);
    if (!actual) return { parentChanges: Number.MAX_SAFE_INTEGER, indexDistance: Number.MAX_SAFE_INTEGER };
    if (actual.pageId !== wanted.pageId || actual.parentId !== wanted.parentId) parentChanges += 1;
    if (actual.parentId === wanted.parentId && actual.pageId === wanted.pageId) indexDistance += Math.abs(actual.index - wanted.index);
  }
  return { parentChanges, indexDistance };
}

function prepareNewSubtree(after, rootId, newIds) {
  const entry = findNode(after, rootId, after.activePageId)
    || after.pages.map(page => findNode(after, rootId, page.id)).find(Boolean);
  if (!entry) throw new Error('New layer is absent from the target snapshot.');
  if (!newIds.has(entry.node.id)) throw new Error('Insert roots must be new layers.');
  // An InsertNode payload cannot duplicate surviving identities. Include the
  // new-only branches now; the structural pass moves pre-existing descendants
  // into their final positions after all new containers have been inserted.
  const newOnly = node => ({
    ...clone(node),
    children: (node.children || []).filter(child => newIds.has(child.id)).map(newOnly)
  });
  return newOnly(entry.node);
}

function targetTreeRoots(document, ids) {
  const roots = [];
  visitTree(document, entry => {
    if (!ids.has(entry.node.id)) return;
    if (entry.parentId == null || !ids.has(entry.parentId)) roots.push(entry);
  });
  return roots;
}

function generatePropertyOperations(entries, working, target) {
  const currentNodes = indexTree(working).entries;
  const targetNodes = indexTree(target).entries;
  const ids = [...targetNodes.keys()].filter(id => currentNodes.has(id)).sort();
  for (const id of ids) {
    const current = findNode(working, id, currentNodes.get(id).pageId)?.node;
    const wanted = findNode(target, id, targetNodes.get(id).pageId)?.node;
    if (!current || !wanted || current.type !== wanted.type) throw new Error('Layer identity changed.');
    const setEndingBeforeMaxLines = wanted.type === 'text'
      && wanted.maxLines != null && wanted.textTruncation === 'ending';
    const keys = [...new Set([...Object.keys(current), ...Object.keys(wanted)])]
      .filter(key => !['id', 'type', 'children'].includes(key))
      .sort((left, right) => {
        const textPriority = Number(right === 'text') - Number(left === 'text');
        if (textPriority) return textPriority;
        const orderKey = key => setEndingBeforeMaxLines && key === 'textTruncation' ? 'maxLines\u0000' : key;
        return orderKey(left).localeCompare(orderKey(right));
      });
    for (const property of keys) {
      const hasCurrent = Object.hasOwn(current, property);
      const hasWanted = Object.hasOwn(wanted, property);
      const addsOptionalField = !hasCurrent && hasWanted;
      if (hasCurrent !== hasWanted && property !== 'fontAxes' && property !== 'fontFeatures' && !addsOptionalField) {
        throw new Error('A property removal cannot be represented by the host protocol.');
      }
      if (equal(current[property], wanted[property])) continue;
      if (property === 'text') {
        if (current.type !== 'text' || typeof wanted.text !== 'string') throw new Error('Text replacement is unsupported for this layer.');
        emitOperation(entries, {
          type: 'ReplaceText', pageId: targetNodes.get(id).pageId, nodeId: id, text: wanted.text
        }, working);
      } else {
        if (!isCollaborationSetPropertyRoot(property)) throw new Error(`Host SetProperty does not support ${property}.`);
        emitOperation(entries, {
          type: 'SetProperty', pageId: targetNodes.get(id).pageId, targetId: id,
          property, value: hasWanted ? clone(wanted[property]) : null
        }, working);
      }
    }
  }
}

function reconcileStructure(entries, working, target) {
  const targetTree = indexTree(target);
  const maxPasses = Math.min(MAX_PLANNED_OPERATIONS, targetTree.entries.size + 1);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const current = indexTree(working);
    const mismatches = [...targetTree.entries.entries()]
      .filter(([id, desired]) => {
        const actual = current.entries.get(id);
        return actual && (actual.pageId !== desired.pageId || actual.parentId !== desired.parentId);
      })
      .sort(([left], [right]) => left.localeCompare(right));
    if (!mismatches.length) break;
    if (mismatches.length > MAX_PLANNED_OPERATIONS - entries.length) {
      throw new Error('Reparent operation plan exceeds the bounded edit size.');
    }

    let selected = null;
    for (const [id, desired] of mismatches) {
      if (current.entries.get(id).pageId !== desired.pageId) continue;
      const siblings = listFor(working, desired.pageId, desired.parentId);
      if (!siblings) continue;
      const source = current.entries.get(id);
      const sameList = source.parentId === desired.parentId;
      const maximum = sameList ? Math.max(0, siblings.length - 1) : siblings.length;
      const index = Math.min(desired.index, maximum);
      try {
        const candidate = applyHostTypedOperation(working, {
          type: 'MoveNode', opId: 'plan-probe', baseRevision: 0,
          pageId: desired.pageId, nodeId: id, parentId: desired.parentId, index
        });
        const next = structuralDistance(candidate, target);
        const prior = structuralDistance(working, target);
        if (next.parentChanges < prior.parentChanges) {
          selected = { nodeId: id, pageId: desired.pageId, parentId: desired.parentId, index };
          break;
        }
      } catch { /* A later parent move may make this destination legal. */ }
    }
    if (!selected) throw new Error('The target hierarchy cannot be reached with host MoveNode operations.');
    emitOperation(entries, { type: 'MoveNode', ...selected }, working);
  }

  let tree = indexTree(working);
  if ([...targetTree.entries.keys()].some(id => {
    const actual = tree.entries.get(id);
    const desired = targetTree.entries.get(id);
    return !actual || actual.pageId !== desired.pageId || actual.parentId !== desired.parentId;
  })) throw new Error('The target hierarchy did not converge.');

  // With parent membership fixed, insertion-sort each sibling list into the
  // target order. Every emitted index is a valid final MoveNode index.
  const lists = [...targetTree.siblings.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [key, desiredIds] of lists) {
    const [pageId, parentIdRaw] = key.split('\u0000');
    const parentId = parentIdRaw || null;
    for (let wantedIndex = 0; wantedIndex < desiredIds.length; wantedIndex += 1) {
      const id = desiredIds[wantedIndex];
      tree = indexTree(working);
      const actual = tree.entries.get(id);
      if (!actual || actual.pageId !== pageId || actual.parentId !== parentId) throw new Error('Sibling membership differs from the target.');
      if (actual.index === wantedIndex) continue;
      emitOperation(entries, { type: 'MoveNode', pageId, nodeId: id, parentId, index: wantedIndex }, working);
    }
  }
}

/**
 * Compile a local before/after edit into the host's narrow typed-operation
 * protocol. Returns null whenever a change cannot be represented exactly.
 * Each `snapshot` is the validated document state immediately after its paired
 * operation, ready to supply as the expected snapshot for that operation's ACK.
 * Operation IDs and base revisions are deterministic placeholders; the caller
 * must replace them with live IDs and the current acknowledged revision.
 */
export function planGuestOperationSnapshots(beforeSnapshot, afterSnapshot) {
  try {
    // Operations and snapshots cross a JSON DataChannel. Normalize exactly at
    // that boundary so undefined object properties cannot make a local change
    // appear representable here but fail protocol validation at the host.
    const before = parseDocument(JSON.parse(JSON.stringify(beforeSnapshot)));
    const after = parseDocument(JSON.parse(JSON.stringify(afterSnapshot)));
    validateDocument(before);
    validateDocument(after);
    if (before.id !== after.id || !equal(stripPageChildren(before), stripPageChildren(after))) return null;

    const beforeTree = indexTree(before);
    const afterTree = indexTree(after);
    if (equal(before, after)) return [];

    const beforeIds = new Set(beforeTree.entries.keys());
    const afterIds = new Set(afterTree.entries.keys());
    const deletedIds = new Set([...beforeIds].filter(id => !afterIds.has(id)));
    const addedIds = new Set([...afterIds].filter(id => !beforeIds.has(id)));

    for (const id of beforeIds) {
      if (!afterIds.has(id)) continue;
      const left = beforeTree.entries.get(id);
      const right = afterTree.entries.get(id);
      if (left.pageId !== right.pageId || left.node.type !== right.node.type) return null;
    }

    // Added nodes must form complete new subtrees; an existing layer cannot be
    // duplicated inside the InsertNode payload.
    const insertRoots = targetTreeRoots(after, addedIds);
    for (const entry of insertRoots) {
      if (entry.parentId && !beforeIds.has(entry.parentId) && !addedIds.has(entry.parentId)) return null;
      if (!prepareNewSubtree(after, entry.node.id, addedIds)) return null;
    }

    const operations = [];
    const working = clone(before);

    // Insert parent payloads first at a bounded temporary position. Their
    // internal descendants arrive atomically with the root node.
    const orderedInsertRoots = insertRoots.slice().sort((left, right) =>
      left.pageId.localeCompare(right.pageId)
      || String(left.parentId ?? '').localeCompare(String(right.parentId ?? ''))
      || left.index - right.index
      || left.node.id.localeCompare(right.node.id));
    for (const entry of orderedInsertRoots) {
      const siblings = listFor(working, entry.pageId, entry.parentId);
      if (!siblings) throw new Error('Insert destination is not present in the base snapshot.');
      emitOperation(operations, {
        type: 'InsertNode', pageId: entry.pageId, nodeId: entry.node.id,
        parentId: entry.parentId, index: Math.min(entry.index, siblings.length),
        node: prepareNewSubtree(after, entry.node.id, addedIds)
      }, working);
    }

    // Lift surviving branches out of doomed subtrees before deleting their
    // old ancestor. Temporary root placement avoids cycles in reparent edits.
    for (;;) {
      const current = indexTree(working).entries;
      const survivor = [...current.entries()]
        .filter(([id, entry]) => afterIds.has(id) && deletedIds.has(entry.parentId))
        .sort(([left], [right]) => left.localeCompare(right))[0];
      if (!survivor) break;
      const [nodeId, entry] = survivor;
      const page = working.pages.find(candidate => candidate.id === entry.pageId);
      emitOperation(operations, {
        type: 'MoveNode', pageId: entry.pageId, nodeId, parentId: null, index: page.children.length
      }, working);
    }

    // Delete only maximal missing subtrees; descendants are removed with them.
    const deleteRoots = targetTreeRoots(before, deletedIds)
      .sort((left, right) => left.pageId.localeCompare(right.pageId) || left.node.id.localeCompare(right.node.id));
    for (const entry of deleteRoots) {
      emitOperation(operations, { type: 'DeleteNode', pageId: entry.pageId, nodeId: entry.node.id }, working);
    }

    reconcileStructure(operations, working, after);
    generatePropertyOperations(operations, working, after);

    if (!operations.length || !equal(working, after)) return null;
    return operations.map(entry => ({
      operation: clone(entry.operation),
      snapshot: clone(entry.snapshot)
    }));
  } catch {
    return null;
  }
}
