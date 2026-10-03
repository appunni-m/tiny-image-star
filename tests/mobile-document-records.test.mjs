import test from 'node:test';
import assert from 'node:assert/strict';
import { latestRecordContainingNodeIds } from './mobile-document-records.js';

test('mobile workflows read the saved record containing their fixture layers', () => {
  const targetRecord = {
    id: 'target', savedAt: 10,
    document: { pages: [{ children: [{ id: 'image-a' }, { id: 'group', children: [{ id: 'image-b' }] }] }] }
  };
  const newerUnrelatedRecord = {
    id: 'unrelated', savedAt: 20,
    document: { pages: [{ children: [{ id: 'image-a' }] }] }
  };

  assert.equal(latestRecordContainingNodeIds([targetRecord, newerUnrelatedRecord], ['image-a', 'image-b']), targetRecord);
  assert.equal(latestRecordContainingNodeIds([targetRecord], ['missing']), null);
});
