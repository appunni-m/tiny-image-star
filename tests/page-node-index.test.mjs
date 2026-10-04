import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageNodeIndex } from '../src/page-node-index.js';

test('a page node index resolves 100,000 batch targets without rescanning sibling arrays', () => {
  const count = 100_000;
  let indexedReads = 0;
  const children = Array.from({ length: count }, (_, index) => ({
    id: `image-${index}`,
    type: 'image',
    locked: false,
    children: []
  }));
  const trackedChildren = new Proxy(children, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) indexedReads += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  const page = { id: 'page', children: trackedChildren };
  const document = { pages: [page] };
  const index = createPageNodeIndex(document, page.id, {
    nodeIds: children.map(node => node.id),
    preserveNodeIdentity: true
  });
  assert.equal(index.size, count);

  indexedReads = 0;
  for (let id = count - 1; id >= 0; id -= 1) {
    assert.equal(index.find(`image-${id}`)?.node, children[id]);
  }
  assert.equal(indexedReads, count,
    'each target lookup should validate one indexed location instead of traversing all 100,000 siblings');
});

test('sparse selection resolves only requested entries and stops after the last target is found', () => {
  const count = 100_000;
  let indexedReads = 0;
  const children = Array.from({ length: count }, (_, index) => ({
    id: `image-${index}`,
    type: 'image',
    locked: false,
    children: []
  }));
  const trackedChildren = new Proxy(children, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/u.test(property)) indexedReads += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  const page = { id: 'page', children: trackedChildren };
  const document = { pages: [page] };
  const selectedIds = ['image-1', 'image-2', 'image-3'];
  const index = createPageNodeIndex(document, page.id, { nodeIds: selectedIds });

  assert.equal(index.size, selectedIds.length,
    'a sparse batch should retain only its selected targets rather than all page nodes');
  assert.equal(indexedReads, selectedIds.length + 1,
    'the sparse walk should stop at the final selected target instead of indexing the rest of the 100,000-layer page');
  indexedReads = 0;
  for (const id of selectedIds) assert.equal(index.find(id)?.node.id, id);
  assert.equal(indexedReads, selectedIds.length,
    'repeated sparse-target lookups should validate one indexed slot each');
});

test('a sparse 100,000-layer batch retains only its requested image entries', () => {
  const count = 100_000;
  let indexedReads = 0;
  const children = Array.from({ length: count }, (_, index) => ({
    id: `image-${index}`,
    type: 'image',
    locked: false,
    children: []
  }));
  const trackedChildren = new Proxy(children, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) indexedReads += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  const page = { id: 'page', children: trackedChildren };
  const document = { pages: [page] };
  const index = createPageNodeIndex(document, page.id, { nodeIds: ['image-99999'] });
  assert.equal(index.size, 1, 'a one-image batch should not retain entries for the other 99,999 layers');
  assert.equal(index.find('image-99999')?.node, children.at(-1));
  assert.equal(index.find('image-0'), null, 'unrequested images are outside this batch index');
  assert.equal(indexedReads, count + 1,
    'the initial pass visits the page once and the selected target uses its indexed location');
});

test('bulk lookups reuse the active page slot and rescan only after page order changes', () => {
  const pageCount = 64;
  const targets = Array.from({ length: 100 }, (_, index) => ({
    id: `image-${index}`, type: 'image', locked: false, children: []
  }));
  let pageReads = 0;
  const rawPages = Array.from({ length: pageCount }, (_, index) => ({ id: `page-${index}`, children: [] }));
  rawPages.at(-1).children = targets;
  const pages = new Proxy(rawPages, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/u.test(property)) pageReads += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  const document = { pages };
  const targetIds = targets.map(node => node.id);
  const index = createPageNodeIndex(document, 'page-63', {
    nodeIds: targetIds,
    preserveNodeIdentity: true
  });

  pageReads = 0;
  for (const nodeId of targetIds) assert.ok(index.find(nodeId));
  assert.equal(pageReads, targetIds.length,
    'each target checks only the cached page slot rather than rescanning the page list');

  pages.reverse();
  pageReads = 0;
  assert.equal(index.find(targetIds[0])?.node, targets[0], 'the active page remains usable after reordering');
  assert.ok(pageReads <= 4, 'a stale slot should trigger only one bounded rescan and rebuild');

  pageReads = 0;
  assert.equal(index.find(targetIds[1])?.node, targets[1]);
  assert.equal(pageReads, 1, 'the new page slot is cached for subsequent target lookups');
});

test('page node indexes refresh after deletion, reordering, reparenting, and page replacement', () => {
  const moved = { id: 'moved', type: 'image', locked: false, children: [] };
  const retained = { id: 'retained', type: 'image', locked: false, children: [] };
  const nested = { id: 'nested', type: 'frame', locked: false, children: [moved] };
  const page = { id: 'page', children: [nested, retained] };
  const document = { pages: [page] };
  const index = createPageNodeIndex(document, page.id, { nodeIds: ['moved', 'retained', 'replacement'] });
  const indexedTarget = index.find(moved.id);

  assert.equal(indexedTarget?.document, document, 'indexed entries carry their owning document identity');
  assert.equal(indexedTarget?.parents[0], nested);
  assert.equal(indexedTarget?.isCurrent(), true);
  nested.locked = true;
  assert.equal(index.find(moved.id)?.parents[0].locked, true, 'parent lock changes are visible without rebuilding');

  page.children.reverse();
  assert.equal(index.find(retained.id)?.node, retained, 'reordering invalidates and rebuilds stale positions');
  assert.equal(index.find(moved.id)?.parents[0], nested);

  nested.children.splice(0, 1);
  assert.equal(indexedTarget?.isCurrent(), false, 'the captured batch entry becomes stale after its layer is moved');
  const destination = { id: 'destination', type: 'frame', locked: false, children: [moved] };
  page.children.push(destination);
  assert.equal(index.find(moved.id)?.parents[0], destination, 'reparenting returns the new ancestry');

  destination.children.splice(0, 1);
  assert.equal(index.find(moved.id), null, 'deleted layers are no longer returned from a stale index');

  const replacement = { id: 'page', children: [{ id: 'replacement', type: 'image', locked: false, children: [] }] };
  document.pages[0] = replacement;
  assert.equal(index.find('replacement')?.node, replacement.children[0], 'a replaced page receives a fresh index');
});

test('bulk target indexes keep their original node identity across deletion and same-ID replacement', () => {
  const original = { id: 'target', type: 'image', locked: false, children: [] };
  const sibling = { id: 'sibling', type: 'image', locked: false, children: [] };
  const page = { id: 'page', children: [original, sibling] };
  const document = { pages: [page] };
  const index = createPageNodeIndex(document, page.id, {
    nodeIds: ['target', 'sibling'],
    preserveNodeIdentity: true
  });
  const captured = index.find('target');
  assert.equal(captured?.node, original);
  assert.equal(captured?.isCurrent(), true);

  const replacement = { id: 'target', type: 'image', locked: false, children: [] };
  page.children.splice(0, 1, replacement);
  assert.equal(captured?.isCurrent(), false, 'the previously admitted node becomes stale after replacement');
  assert.equal(index.find('target'), null,
    'a batch must not silently retarget a deleted image to a new node that reuses its ID');
  assert.equal(index.find('sibling')?.node, sibling,
    'rebuilding after one stale target must keep other original batch targets resolvable');

  page.children.splice(0, 1, original);
  assert.equal(index.find('target')?.node, original,
    'the original target can be resolved again if the same object is restored to the page');
});
